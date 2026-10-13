/**
 * مؤشرات الحصص المجانية (نقل Neon + مساحة Drive) — منطق خالص + عدّاد الكتابة.
 *
 * يثبت: حساب التقدّم الشهري/idempotency/صفّر شهر، أن القياس نقل حقيقي عبر عدّاد
 * الكتابة الفعلي، تصنيف basis (measured/estimated)، عتبة تحذير مقصوصة، وحدود
 * المخطّط الموثّقة، وخلوّ المخرَج من أي حقل عميل ممنوع (بلا سرّ).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FREE_TIER_QUOTAS,
  resolveUsageAlertThreshold,
  monthKey,
  rollMonthlyUsage,
  accrueTransfer,
  buildDriveQuotaIndicator,
  buildNeonTransferIndicator,
  USAGE_ALERT_THRESHOLD_DEFAULT,
  type FreeTierUsageState,
} from '../ops/freeTierUsage';
import { createStorageAdapter, storageWriteAccounting } from '../storage/adapter';
import { PUBLIC_ENDPOINT_FORBIDDEN_CUSTOMER_FIELDS } from '../social/healthPrivacy';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const fresh = (): FreeTierUsageState => ({ month: null, transferBytesMonth: 0, transferBytesSinceBoot: 0, updatedAt: null });

async function run(): Promise<void> {
  // ── 1) تراكم النقل ────────────────────────────────────────────────
  group('1) تراكم النقل الشهري (idempotent + صمود)');
  {
    const now = '2026-10-13T07:00:00.000Z';
    let s = accrueTransfer(fresh(), 1000, now);
    check('first accrue uses delta', s.transferBytesMonth === 1000, String(s.transferBytesMonth));
    check('month keyed', s.month === '2026-10', String(s.month));

    // نفس الإجمالي (لا كتابات جديدة) ⇒ لا زيادة (idempotent).
    s = accrueTransfer(s, 1000, now);
    check('idempotent same total', s.transferBytesMonth === 1000, String(s.transferBytesMonth));

    // زيادة 500 ⇒ +500 فقط.
    s = accrueTransfer(s, 1500, now);
    check('incremental delta only', s.transferBytesMonth === 1500, String(s.transferBytesMonth));

    // إعادة تشغيل: القيمة المحفوظة تُحمَّل ثم تُصفَّر sinceBoot ⇒ إجمالي هذه العملية
    // يُضاف بلا ازدواج (لا يتجاوز الواقع).
    const restored: FreeTierUsageState = { month: s.month, transferBytesMonth: s.transferBytesMonth, transferBytesSinceBoot: 0, updatedAt: s.updatedAt };
    const afterRestart = accrueTransfer(restored, 200, '2026-10-13T08:00:00.000Z');
    check('restart adds this-boot total (no double count)', afterRestart.transferBytesMonth === 1700, String(afterRestart.transferBytesMonth));

    // انتقال شهر ⇒ صفر التراكم الشهري ثم يُضاف فرق هذه الكتابات فقط (100).
    const nextMonth = accrueTransfer(afterRestart, 300, '2026-11-01T00:00:00.000Z');
    check('month rollover resets monthly', nextMonth.transferBytesMonth === 100, String(nextMonth.transferBytesMonth));
    check('month key updated', nextMonth.month === '2026-11', String(nextMonth.month));
  }
  check('monthKey derived from ISO', monthKey('2026-02-03T00:00:00Z') === '2026-02');
  check('roll no-op within same month', rollMonthlyUsage({ month: '2026-10', transferBytesMonth: 5, transferBytesSinceBoot: 9, updatedAt: null }, '2026-10-20T00:00:00Z').transferBytesMonth === 5);

  // ── 2) عتبة التحذير ───────────────────────────────────────────────
  group('2) عتبة التحذير مقصوصة');
  check('default when undefined', resolveUsageAlertThreshold(undefined) === USAGE_ALERT_THRESHOLD_DEFAULT);
  check('clamp >95', resolveUsageAlertThreshold('200') === USAGE_ALERT_THRESHOLD_DEFAULT);
  check('reject <=0', resolveUsageAlertThreshold('0') === USAGE_ALERT_THRESHOLD_DEFAULT);
  check('accept 50', resolveUsageAlertThreshold('50') === 50);
  check('accept 95', resolveUsageAlertThreshold('95') === 95);

  // ── 3) مؤشّر مساحة Drive ──────────────────────────────────────────
  group('3) مؤشّر Drive (measured/estimated + تحذير)');
  {
    const m = buildDriveQuotaIndicator({ usageBytes: 1_500_000_000, limitBytes: null, liveRead: true, alertThresholdPercent: 80 });
    check('measured basis with live read', m.basis === 'measured', m.basis);
    check('limit falls back to documented 15GiB', m.limitBytes === FREE_TIER_QUOTAS.driveStorageBytes, String(m.limitBytes));
    check('percent computed', m.usedPercent === Math.round((1_500_000_000 / FREE_TIER_QUOTAS.driveStorageBytes) * 100), String(m.usedPercent));
    check('not warning below 80%', m.warning === false, String(m.warning));

    const est = buildDriveQuotaIndicator({ usageBytes: null, limitBytes: null, liveRead: false, alertThresholdPercent: 80 });
    check('estimated basis without reading', est.basis === 'estimated', est.basis);
    check('usedBytes null (no invention)', est.usedBytes === null, String(est.usedBytes));
    check('percent null when unknown', est.usedPercent === null, String(est.usedPercent));
    check('note mentions no-reading honestly', est.note.includes('لا قراءة'), est.note);

    const high = buildDriveQuotaIndicator({ usageBytes: 14_000_000_000, limitBytes: FREE_TIER_QUOTAS.driveStorageBytes, liveRead: true, alertThresholdPercent: 80 });
    check('warning above 80%', high.warning === true, String(high.usedPercent));
  }

  // ── 4) مؤشّر نقل Neon ─────────────────────────────────────────────
  group('4) مؤشّر نقل Neon (قياس داخلي)');
  {
    const n = buildNeonTransferIndicator({ transferBytesMonth: 1_000_000_000, alertThresholdPercent: 80, backend: 'postgres' });
    check('basis measured', n.basis === 'measured', n.basis);
    check('limit documented 5GiB', n.limitBytes === FREE_TIER_QUOTAS.neonMonthlyTransferBytes, String(n.limitBytes));
    check('percent computed', n.usedPercent === Math.round((1_000_000_000 / FREE_TIER_QUOTAS.neonMonthlyTransferBytes) * 100), String(n.usedPercent));
    check('warning at threshold', buildNeonTransferIndicator({ transferBytesMonth: 4_500_000_000, alertThresholdPercent: 80, backend: 'postgres' }).warning === true);

    const fileBackend = buildNeonTransferIndicator({ transferBytesMonth: 0, alertThresholdPercent: 80, backend: 'file' });
    check('file backend notes no real neon', fileBackend.note.includes('ملف'), fileBackend.note);
  }

  // ── 5) عدّاد الكتابة الفعلي ───────────────────────────────────────
  group('5) عدّاد الكتابة يزيد عند الكتابة الفعلية فقط');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gharabi-ftu-'));
    try {
      const adapter: any = createStorageAdapter({ stateDir: dir });
      const before = storageWriteAccounting();
      await adapter.write('k1', { hello: 'world' });
      const after1 = storageWriteAccounting();
      check('write increments count', after1.writeCount === before.writeCount + 1, String(after1.writeCount));
      check('bytes increased', after1.bytesWrittenSinceStart > before.bytesWrittenSinceStart, String(after1.bytesWrittenSinceStart));
      // Write identical value again ⇒ change-detection skips ⇒ no accounting increase.
      await adapter.write('k1', { hello: 'world' });
      const after2 = storageWriteAccounting();
      check('identical write not counted (no transfer)', after2.writeCount === after1.writeCount, String(after2.writeCount));
      // Different value again ⇒ counted.
      await adapter.write('k1', { hello: 'world2' });
      const after3 = storageWriteAccounting();
      check('changed write counted', after3.writeCount === after1.writeCount + 1, String(after3.writeCount));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ── 6) بلا سرّ: لا حقل عميل ممنوع ─────────────────────────────────
  group('6) خلوّ المخرَج من حقول العملاء الممنوعة');
  {
    const block = {
      neonTransfer: buildNeonTransferIndicator({ transferBytesMonth: 1, alertThresholdPercent: 80, backend: 'postgres' }),
      driveStorage: buildDriveQuotaIndicator({ usageBytes: 1, limitBytes: null, liveRead: true, alertThresholdPercent: 80 }),
    };
    const keys = new Set<string>();
    JSON.stringify(block, (k, v) => { if (k) keys.add(k); return v; });
    const forbidden = PUBLIC_ENDPOINT_FORBIDDEN_CUSTOMER_FIELDS.filter((f) => keys.has(f));
    check('no forbidden customer field key', forbidden.length === 0, forbidden.join(','));
    const text = JSON.stringify(block);
    check('no token-ish keys', !/("|\b)(access_token|refresh_token|client_secret|apiKey|api_key)\b/.test(text));
  }

  // ── 7) حدود موثّقة ────────────────────────────────────────────────
  group('7) حدود المخطّط المجاني الموثّقة');
  check('drive 15GiB', FREE_TIER_QUOTAS.driveStorageBytes === 15 * 1024 * 1024 * 1024);
  check('neon transfer 5GiB', FREE_TIER_QUOTAS.neonMonthlyTransferBytes === 5 * 1024 * 1024 * 1024);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
}

run();
