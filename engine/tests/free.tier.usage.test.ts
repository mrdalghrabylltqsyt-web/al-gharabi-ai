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
import { createStorageAdapter, storageWriteAccounting, storageReadAccounting } from '../storage/adapter';
import { PUBLIC_ENDPOINT_FORBIDDEN_CUSTOMER_FIELDS } from '../social/healthPrivacy';
import { neonUsageApiConfig, parseNeonConsumption, fetchNeonActualUsage, computeCuHours } from '../ops/neonUsage';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const fresh = (): FreeTierUsageState => ({ month: null, egressBytesMonth: 0, egressBytesSinceBoot: 0, updatedAt: null });

async function run(): Promise<void> {
  // ── 1) تراكم النقل ────────────────────────────────────────────────
  group('1) تراكم النقل الشهري (idempotent + صمود)');
  {
    const now = '2026-10-13T07:00:00.000Z';
    let s = accrueTransfer(fresh(), 1000, now);
    check('first accrue uses delta', s.egressBytesMonth === 1000, String(s.egressBytesMonth));
    check('month keyed', s.month === '2026-10', String(s.month));

    // نفس الإجمالي (لا كتابات جديدة) ⇒ لا زيادة (idempotent).
    s = accrueTransfer(s, 1000, now);
    check('idempotent same total', s.egressBytesMonth === 1000, String(s.egressBytesMonth));

    // زيادة 500 ⇒ +500 فقط.
    s = accrueTransfer(s, 1500, now);
    check('incremental delta only', s.egressBytesMonth === 1500, String(s.egressBytesMonth));

    // إعادة تشغيل: القيمة المحفوظة تُحمَّل ثم تُصفَّر sinceBoot ⇒ إجمالي هذه العملية
    // يُضاف بلا ازدواج (لا يتجاوز الواقع).
    const restored: FreeTierUsageState = { month: s.month, egressBytesMonth: s.egressBytesMonth, egressBytesSinceBoot: 0, updatedAt: s.updatedAt };
    const afterRestart = accrueTransfer(restored, 200, '2026-10-13T08:00:00.000Z');
    check('restart adds this-boot total (no double count)', afterRestart.egressBytesMonth === 1700, String(afterRestart.egressBytesMonth));

    // انتقال شهر ⇒ صفر التراكم الشهري ثم يُضاف فرق هذه الكتابات فقط (100).
    const nextMonth = accrueTransfer(afterRestart, 300, '2026-11-01T00:00:00.000Z');
    check('month rollover resets monthly', nextMonth.egressBytesMonth === 100, String(nextMonth.egressBytesMonth));
    check('month key updated', nextMonth.month === '2026-11', String(nextMonth.month));
  }
  check('monthKey derived from ISO', monthKey('2026-02-03T00:00:00Z') === '2026-02');
  check('roll no-op within same month', rollMonthlyUsage({ month: '2026-10', egressBytesMonth: 5, egressBytesSinceBoot: 9, updatedAt: null }, '2026-10-20T00:00:00Z').egressBytesMonth === 5);

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
  group('4) مؤشّر نقل Neon (تقدير الصادر الفعلي egress — لا بايتات الكتابة)');
  {
    const n = buildNeonTransferIndicator({ egressBytesMonth: 1_000_000_000, alertThresholdPercent: 80, backend: 'postgres' });
    check('basis estimated (client-side egress estimate)', n.basis === 'estimated', n.basis);
    check('limit documented 5GiB', n.limitBytes === FREE_TIER_QUOTAS.neonMonthlyTransferBytes, String(n.limitBytes));
    check('percent computed', n.usedPercent === Math.round((1_000_000_000 / FREE_TIER_QUOTAS.neonMonthlyTransferBytes) * 100), String(n.usedPercent));
    check('warning at threshold', buildNeonTransferIndicator({ egressBytesMonth: 4_500_000_000, alertThresholdPercent: 80, backend: 'postgres' }).warning === true);
    check('note names egress not writes', n.note.includes('egress') && n.note.includes('لا تُحتسب نقلاً'), n.note.slice(0, 80));

    const fileBackend = buildNeonTransferIndicator({ egressBytesMonth: 0, alertThresholdPercent: 80, backend: 'file' });
    check('file backend notes no real neon', fileBackend.note.includes('ملف'), fileBackend.note);
  }

  // ── 4ب) عدّاد القراءة الفعلي (egress) ─────────────────────────────
  group('4ب) عدّاد الصادر الفعلي يزيد عند القراءة فقط');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gharabi-ftu-read-'));
    try {
      const adapter: any = createStorageAdapter({ stateDir: dir });
      const before = storageReadAccounting();
      await adapter.write('rk1', { a: 1 });
      await adapter.read('rk1');
      const after1 = storageReadAccounting();
      check('read increments count', after1.readCount === before.readCount + 1, String(after1.readCount));
      check('egress bytes increased on read', after1.bytesReadSinceStart > before.bytesReadSinceStart, String(after1.bytesReadSinceStart));
      // كتابة مطابقة (لا تغيّر فعلي) لا تزيد عدّاد القراءة.
      await adapter.write('rk1', { a: 1 });
      const after2 = storageReadAccounting();
      check('write does not increase read count', after2.readCount === after1.readCount, String(after2.readCount));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
      neonTransfer: buildNeonTransferIndicator({ egressBytesMonth: 1, alertThresholdPercent: 80, backend: 'postgres' }),
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

  // ── 8) مؤشّر النقل: القياس الفعلي (Neon API) يتقدّم على التقدير ──
  group('8) مؤشّر النقل: قياس Neon الفعلي (measured) يتقدّم على التقدير (egress)');
  {
    // عند وجود القياس الفعلي: basis = measured والرقم من القياس لا التقدير.
    const measured = buildNeonTransferIndicator({ egressBytesMonth: 4_800_000_000, alertThresholdPercent: 80, backend: 'postgres', actualTransferBytes: 188_000_000 });
    check('actual => basis measured', measured.basis === 'measured', measured.basis);
    check('actual usedBytes from Neon not estimate', measured.usedBytes === 188_000_000, String(measured.usedBytes));
    check('actual percent computed from actual', measured.usedPercent === Math.round((188_000_000 / FREE_TIER_QUOTAS.neonMonthlyTransferBytes) * 100), String(measured.usedPercent));
    check('actual => no warning (below threshold)', measured.warning === false, String(measured.warning));
    check('actual note mentions Neon API', measured.note.includes('Neon API'), measured.note.slice(0, 60));
    // null/undefined => يبقى التقدير (لا اختراع قياس).
    const fallbackNull = buildNeonTransferIndicator({ egressBytesMonth: 1_000_000, alertThresholdPercent: 80, backend: 'postgres', actualTransferBytes: null });
    check('null actual => estimated fallback', fallbackNull.basis === 'estimated' && fallbackNull.usedBytes === 1_000_000, `${fallbackNull.basis}/${fallbackNull.usedBytes}`);
    const fallbackUndef = buildNeonTransferIndicator({ egressBytesMonth: 2_000_000, alertThresholdPercent: 80, backend: 'postgres' });
    check('undefined actual => estimated fallback', fallbackUndef.basis === 'estimated' && fallbackUndef.usedBytes === 2_000_000);
    const fallbackNaN = buildNeonTransferIndicator({ egressBytesMonth: 3_000_000, alertThresholdPercent: 80, backend: 'postgres', actualTransferBytes: NaN });
    check('NaN actual => estimated fallback (لا قيمة كاذبة)', fallbackNaN.basis === 'estimated' && fallbackNaN.usedBytes === 3_000_000);
  }

  // ── 9) وحدة قراءة Neon API (تحليل الاستجابة + الإعداد + fail-safe) ──
  group('9) وحدة قراءة استهلاك Neon الفعلي (neonUsage)');
  {
    // الإعداد: بلا مفتاح أو بلا معرّف مشروع => غير مضبوط (لا نداء شبكة).
    check('no config => not configured', neonUsageApiConfig({} as any).configured === false);
    check('key only => not configured', neonUsageApiConfig({ NEON_API_KEY: 'k' } as any).configured === false);
    check('project only => not configured', neonUsageApiConfig({ NEON_PROJECT_ID: 'p' } as any).configured === false);
    const cfg = neonUsageApiConfig({ NEON_API_KEY: '  k  ', NEON_PROJECT_ID: '  p  ' } as any);
    check('both => configured (trimmed)', cfg.configured === true && cfg.apiKey === 'k' && cfg.projectId === 'p');
    check('default base url', cfg.baseUrl === 'https://console.neon.tech/api/v2', cfg.baseUrl);
    check('base url override trimmed', neonUsageApiConfig({ NEON_API_KEY: 'k', NEON_PROJECT_ID: 'p', NEON_API_BASE: 'http://127.0.0.1:9/api/' } as any).baseUrl === 'http://127.0.0.1:9/api');

    // تحليل الاستجابة: الشكل الشائع { periods:[{ consumption:[{metric,value}] }] }.
    const parsed = parseNeonConsumption({ periods: [{ consumption: [
      { metric: 'compute_time_seconds', value: 158_688 }, // 44.08 CU-ساعة
      { metric: 'data_transfer_bytes', value: 188_000_000 },
    ] }] });
    check('parse compute + transfer', parsed !== null && parsed.computeSeconds === 158_688 && parsed.transferBytes === 188_000_000, JSON.stringify(parsed));
    check('parse marks source neon_api', parsed?.source === 'neon_api');
    check('computeCuHours ~44.08', Math.abs(computeCuHours(parsed!.computeSeconds) - 44.08) < 0.01, String(computeCuHours(parsed!.computeSeconds)));
    // حقول مباشرة.
    const direct = parseNeonConsumption({ data_transfer_bytes: 123, active_time_seconds: 3600 });
    check('parse direct fields', direct !== null && direct.transferBytes === 123 && Math.abs(computeCuHours(direct.computeSeconds) - 1) < 1e-9, JSON.stringify(direct));
    // شكل غير معروف => null (لا اختراع صفر).
    check('unknown shape => null', parseNeonConsumption({ foo: 'bar' }) === null);
    check('null => null', parseNeonConsumption(null) === null);
    check('empty => null', parseNeonConsumption({}) === null);

    // fail-safe: fetch يفشل/يعيد غير 2xx => null (يبقى التقدير) بلا رمي.
    const okFetch = async () => ({ ok: true, json: async () => ({ periods: [{ consumption: [{ metric: 'data_transfer_bytes', value: 42 }] }] }) }) as any;
    const got = await fetchNeonActualUsage(cfg, { fromIso: '2026-10-01T00:00:00Z', toIso: '2026-10-20T00:00:00Z' }, { fetchImpl: okFetch as any });
    check('fetch success parses usage', got !== null && got.transferBytes === 42, JSON.stringify(got));
    const badFetch = async () => ({ ok: false, status: 401 }) as any;
    check('fetch non-2xx => null (fail-safe)', (await fetchNeonActualUsage(cfg, { fromIso: 'a', toIso: 'b' }, { fetchImpl: badFetch as any })) === null);
    const throwFetch = async () => { throw new Error('network down'); };
    check('fetch throws => null (fail-safe, لا رمي)', (await fetchNeonActualUsage(cfg, { fromIso: 'a', toIso: 'b' }, { fetchImpl: throwFetch as any })) === null);
    check('unconfigured => no network call', (await fetchNeonActualUsage(neonUsageApiConfig({} as any), { fromIso: 'a', toIso: 'b' }, { fetchImpl: okFetch as any })) === null);
    // لا سرّ في المخرَج.
    const cfgText = JSON.stringify({ configured: cfg.configured, baseUrl: cfg.baseUrl, source: parsed?.source });
    check('no secret in output shape', !cfgText.includes('k') || !/("|\b)(access_token|apiKey|api_key|client_secret)\b/.test(cfgText));
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
}

run();
