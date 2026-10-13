/**
 * تحصين الحصص المجانية — منطق خالص قابل للاختبار (بلا شبكة/أسرار/AI).
 *
 * يثبت:
 *  - حارس الضغط (usagePressure): normal/watch/critical + المضاعف + التأجيل.
 *  - عدّاد ساعات تشغيل Render (accrueRenderUptime): تراكم/صمود/صفّر شهر/لا تضخّم.
 *  - مؤشّر Render: تقدير أدنى مقيس + احتساب أسوأ موثّق + عتبة تحذير.
 *  - مؤشّر Drive API: measured لنداءاتنا + تحويل الأنواع إلى وحدات موثّقة.
 *  - ثوابت الحدود الموثّقة (Neon compute/storage، Drive، Render).
 *  - أن كتلة الحصص الصحية لا تحمل أي حقل عميل ممنوع (بلا سرّ).
 */

import {
  FREE_TIER_QUOTAS,
  RENDER_RECOVERY_CENTER_ALLOWANCE_HOURS,
  accrueRenderUptime,
  buildDriveApiIndicator,
  buildRenderUptimeIndicator,
  dayKey,
  monthKey,
  type RenderUptimeState,
} from '../ops/freeTierUsage';
import {
  USAGE_PRESSURE_CRITICAL_RATIO,
  USAGE_PRESSURE_WATCH_RATIO,
  resolveUsagePressure,
  usagePressureIntervalMultiplier,
} from '../ops/usagePressure';
import {
  DRIVE_API_UNIT_COSTS,
  driveApiAccountingSnapshot,
  driveApiQuotaUnitsFor,
  recordDriveApiCall,
  rollDriveApiDay,
} from '../dr/driveApiAccounting';
import { PUBLIC_ENDPOINT_FORBIDDEN_CUSTOMER_FIELDS } from '../social/healthPrivacy';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const freshUptime = (): RenderUptimeState => ({ month: null, hoursThisMonth: 0, lastAccruedAt: null, firstSeenAt: null, updatedAt: null });

function run(): void {
  // ── 1) حارس الضغط ────────────────────────────────────────────────
  group('1) حارس ضغط الاستهلاك (usagePressure)');
  {
    const none = resolveUsagePressure([]);
    check('no signals => normal', none.level === 'normal');
    check('no signals => no slowDown', none.slowDown === false && none.deferNonCritical === false && none.deferCriticalTick === false);
    check('no signals => null percent', none.usedPercent === null);

    const low = resolveUsagePressure([{ usedPercent: 12, provider: 'neon' }, { usedPercent: 40, provider: 'drive' }]);
    check('below watch => normal', low.level === 'normal');
    check('below watch => no slowDown', low.slowDown === false);
    check('picks highest provider', low.usedPercent === 40 && low.provider === 'drive', `${low.provider}/${low.usedPercent}`);

    const watch = resolveUsagePressure([{ usedPercent: 80, provider: 'render' }]);
    check('at watch threshold => watch', watch.level === 'watch', watch.level);
    check('watch => slowDown but not defer', watch.slowDown === true && watch.deferNonCritical === false && watch.deferCriticalTick === false);
    check('watch multiplier = 2', usagePressureIntervalMultiplier('watch') === 2);

    const critical = resolveUsagePressure([{ usedPercent: 96, provider: 'neon' }]);
    check('at critical threshold => critical', critical.level === 'critical', critical.level);
    check('critical => slowDown + deferNonCritical', critical.slowDown === true && critical.deferNonCritical === true);
    check('critical => deferCriticalTick (backup tick deferred, not disabled)', critical.deferCriticalTick === true);
    check('critical multiplier = 1 (deferred anyway)', usagePressureIntervalMultiplier('critical') === 1);

    // null percent لا يُعلن ضغطاً (لا تخمين).
    const mixed = resolveUsagePressure([{ usedPercent: null, provider: 'drive' }, { usedPercent: 10, provider: 'neon' }]);
    check('null ignored, max of measured', mixed.usedPercent === 10 && mixed.level === 'normal', `${mixed.usedPercent}`);

    // عتبات مخصّصة.
    const custom = resolveUsagePressure([{ usedPercent: 55, provider: 'x' }], { watchRatio: 50, criticalRatio: 70 });
    check('custom watch ratio honored', custom.level === 'watch', custom.level);

    // نسبة خارج النطاق تُقصّ.
    const clamped = resolveUsagePressure([{ usedPercent: 250, provider: 'x' }]);
    check('percent clamped to 100', clamped.usedPercent === 100 && clamped.level === 'critical');

    check('constants sane', USAGE_PRESSURE_WATCH_RATIO === 80 && USAGE_PRESSURE_CRITICAL_RATIO === 95);
  }

  // ── 2) عدّاد ساعات Render ────────────────────────────────────────
  group('2) عدّاد ساعات تشغيل Render (accrueRenderUptime)');
  {
    let s = freshUptime();
    s = accrueRenderUptime(s, '2026-10-13T00:00:00.000Z');
    check('first call sets month + no accrual', s.month === '2026-10' && s.hoursThisMonth === 0, `${s.month}/${s.hoursThisMonth}`);
    check('firstSeenAt set', s.firstSeenAt === '2026-10-13T00:00:00.000Z');

    // 30 دقيقة لاحقاً ⇒ +0.5 ساعة.
    s = accrueRenderUptime(s, '2026-10-13T00:30:00.000Z');
    check('accrues 0.5h', Math.abs(s.hoursThisMonth - 0.5) < 1e-9, String(s.hoursThisMonth));

    // فجوة 10 ساعات (توقّف/نوم) ⇒ خطوة واحدة فقط ساعة (لا تضخّم).
    s = accrueRenderUptime(s, '2026-10-13T10:30:00.000Z');
    check('gap capped to 1h step', Math.abs(s.hoursThisMonth - 1.5) < 1e-9, String(s.hoursThisMonth));

    // صمود بعد restart: نُعيد بناء الحالة من المحفوظ (نفس الشهر).
    const restored: RenderUptimeState = { month: s.month, hoursThisMonth: s.hoursThisMonth, lastAccruedAt: s.lastAccruedAt, firstSeenAt: s.firstSeenAt, updatedAt: s.updatedAt };
    const afterRestart = accrueRenderUptime(restored, '2026-10-13T10:45:00.000Z');
    check('survives restart (+0.25h)', Math.abs(afterRestart.hoursThisMonth - 1.75) < 1e-9, String(afterRestart.hoursThisMonth));

    // شهر جديد ⇒ تصفير.
    const nextMonth = accrueRenderUptime(afterRestart, '2026-11-01T00:00:00.000Z');
    check('rolls to new month (reset)', nextMonth.month === '2026-11' && nextMonth.hoursThisMonth === 0, `${nextMonth.month}/${nextMonth.hoursThisMonth}`);

    // وقت غير صالح لا يُضيف.
    const bad = accrueRenderUptime(freshUptime(), 'not-a-date');
    check('invalid now returns unchanged', bad.hoursThisMonth === 0 && bad.month === null);
  }

  // ── 3) مؤشّر Render ──────────────────────────────────────────────
  group('3) مؤشّر ساعات Render (buildRenderUptimeIndicator)');
  {
    const ind = buildRenderUptimeIndicator({ measuredHoursThisMonth: 700, worstCaseWorkspaceHours: 700 + RENDER_RECOVERY_CENTER_ALLOWANCE_HOURS, limitHours: FREE_TIER_QUOTAS.renderWorkspaceMonthlyHours, alertThresholdPercent: 80 });
    check('provider render', ind.provider === 'render');
    check('basis estimated (no real API)', ind.basis === 'estimated');
    check('usedBytes = measured lower bound', ind.usedBytes === 700, String(ind.usedBytes));
    check('limit = 750 shared', ind.limitBytes === 750);
    check('percent from worst-case (760/750 => 100 clamped)', ind.usedPercent === 100, String(ind.usedPercent));
    check('warning true', ind.warning === true);
    check('note mentions shared + worst case', ind.note.includes('مشتركة') && ind.note.includes('هامش موثّق'));

    const low = buildRenderUptimeIndicator({ measuredHoursThisMonth: 100, worstCaseWorkspaceHours: 160, limitHours: 750, alertThresholdPercent: 80 });
    check('low usage no warning', low.warning === false && low.usedPercent === 21, `${low.usedPercent}`);
  }

  // ── 4) مؤشّر Drive API ───────────────────────────────────────────
  group('4) محاسبة ومؤشّر Google Drive API');
  {
    check('list cost 100', driveApiQuotaUnitsFor('list') === 100);
    check('read cost 5', driveApiQuotaUnitsFor('read') === 5);
    check('download cost 200', driveApiQuotaUnitsFor('download') === 200);
    check('edit cost 50', driveApiQuotaUnitsFor('edit') === 50);
    check('unit costs documented', DRIVE_API_UNIT_COSTS.list === 100 && DRIVE_API_UNIT_COSTS.download === 200);

    const ind = buildDriveApiIndicator({ callsToday: 42, unitsToday: 4200, limitUnits: FREE_TIER_QUOTAS.driveApiDailyQuotaUnits, alertThresholdPercent: 80 });
    check('driveApi provider', ind.provider === 'driveApi');
    check('measured basis (our calls only)', ind.basis === 'measured');
    check('units used', ind.usedBytes === 4200);
    check('limit 400M', ind.limitBytes === 400_000_000);
    check('percent tiny', ind.usedPercent === 0, String(ind.usedPercent));
    check('note honest about partial scope', ind.note.includes('نداءاتنا وحدها'));

    // عدّاد حقيقي: يسجّل ويصفّر عند تغيّر اليوم.
    const before = driveApiAccountingSnapshot();
    const day = '2026-10-13T09:00:00.000Z';
    rollDriveApiDay(day);
    recordDriveApiCall('list', day);
    recordDriveApiCall('read', day);
    const snap = driveApiAccountingSnapshot();
    check('two calls recorded', snap.callsToday >= 2, String(snap.callsToday));
    check('units accumulate (100+5)', snap.unitsToday >= 105, String(snap.unitsToday));
    check('day key set', snap.day === '2026-10-13', String(snap.day));
    rollDriveApiDay('2026-10-14T00:00:00.000Z');
    const nextDay = driveApiAccountingSnapshot();
    check('daily reset on new day', nextDay.callsToday === 0 && nextDay.unitsToday === 0 && nextDay.day === '2026-10-14');
    void before;
  }

  // ── 5) ثوابت الحدود الموثّقة ─────────────────────────────────────
  group('5) ثوابت الحدود الموثّقة (وثائق المزوّدين)');
  {
    check('neon storage 0.5 GiB', FREE_TIER_QUOTAS.neonStorageBytes === 512 * 1024 * 1024);
    check('neon transfer 5 GiB', FREE_TIER_QUOTAS.neonMonthlyTransferBytes === 5 * 1024 * 1024 * 1024);
    check('neon compute 100 CU-h', FREE_TIER_QUOTAS.neonMonthlyComputeCuHours === 100);
    check('drive storage 15 GiB', FREE_TIER_QUOTAS.driveStorageBytes === 15 * 1024 * 1024 * 1024);
    check('drive api 400M units/day', FREE_TIER_QUOTAS.driveApiDailyQuotaUnits === 400_000_000);
    check('render 750 shared hours', FREE_TIER_QUOTAS.renderWorkspaceMonthlyHours === 750);
    check('recovery allowance 60h documented', RENDER_RECOVERY_CENTER_ALLOWANCE_HOURS === 60);
    check('dayKey + monthKey', dayKey('2026-10-13T09:00:00Z') === '2026-10-13' && monthKey('2026-10-13T09:00:00Z') === '2026-10');
  }

  // ── 6) لا حقل عميل ممنوع في أي ناتج (بلا سرّ) ────────────────────
  group('6) بلا سرّ: النواتج لا تحمل حقول عملاء ممنوعة');
  {
    const blob = JSON.stringify({
      pressure: resolveUsagePressure([{ usedPercent: 99, provider: 'neon' }]),
      render: buildRenderUptimeIndicator({ measuredHoursThisMonth: 10, worstCaseWorkspaceHours: 70, limitHours: 750, alertThresholdPercent: 80 }),
      driveApi: buildDriveApiIndicator({ callsToday: 1, unitsToday: 5, limitUnits: 400_000_000, alertThresholdPercent: 80 }),
    });
    const forbidden = PUBLIC_ENDPOINT_FORBIDDEN_CUSTOMER_FIELDS.filter((k) => blob.includes(`"${k}"`));
    check('no forbidden customer fields', forbidden.length === 0, forbidden.join(','));
  }

  console.log(`\n${'='.repeat(60)}`);
  if (failures.length === 0) {
    console.log(`PASSED: ${passed} free-tier-hardening checks`);
  } else {
    console.log(`FAILED: ${failures.length} of ${passed + failures.length}`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exitCode = 1;
  }
}

run();
