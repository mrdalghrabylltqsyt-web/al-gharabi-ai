/**
 * اختبار منطق وقت تشغيل العقل 24/7 (Batch 5) — منطق صافٍ بلا شبكة/ساعة حقيقية.
 *
 * يثبت بالدليل:
 *   A/B. تمكين/تعطيل وقت التشغيل + حدود الإيقاع.
 *   C. قرار الاستحقاق (cadence).
 *   D/E/F. القفل: منع التوازي، الاسترداد المتقادم، الإفراج الآمن.
 *   G. الاستمرارية بعد restart (الحالة تُوحَّد من الشكل المحمّل).
 *   H. دورة بلا بيانات جديدة => NO_NEW_DATA (بلا اختراع تعلّم).
 *   I/J. بيانات حقيقية => بناء => حفظ => SUCCESS مع أعداد صادقة.
 *   K. فشل الحفظ => FAILED بلا ادعاء نجاح.
 *   L. دورة مكررة أثناء الجريان => SKIPPED_LOCKED.
 *   M. منع تكرار الذاكرة عبر معرّفات أحداث التعلّم (dedupeLearningEvents).
 *   N/O/P/Q/R/S. حماية الحقيقة التجارية (بلا مبيعات/إيراد/ربح مُختلق).
 *   T. الحالة تُعلن executesExternalActions=false وgeminiUsedOnCycles=false.
 *   U. لا استدعاء لأي منصة غير YouTube في منطق الدورة.
 */

import assert from 'node:assert';
import {
  emptyBrainRuntimeState,
  normalizeBrainRuntimeState,
  resolveBrainRuntimeEnabled,
  resolveBrainRuntimeIntervalMs,
  resolveBrainLockTtlMs,
  isBrainRuntimeDue,
  nextBrainRuntimeAtMs,
  acquireBrainLock,
  releaseBrainLock,
  isBrainLockStale,
  sanitizeBrainRuntimeError,
  runBrainRuntimeCycle,
  buildBrainRuntimeStatus,
  BRAIN_RUNTIME_DEFAULT_INTERVAL_MS,
  BRAIN_RUNTIME_MIN_INTERVAL_MS,
  BRAIN_RUNTIME_MAX_INTERVAL_MS,
  BRAIN_LOCK_DEFAULT_TTL_MS,
  BRAIN_LOCK_MIN_TTL_MS,
  BRAIN_LOCK_MAX_TTL_MS,
  type BrainRuntimeState,
} from '../../brain/brainRuntime';
import { dedupeLearningEvents, type LearningEvent } from '../../brain/learning/learningLoop';
import { makeMemoryEntry } from '../../brain/memory/longTerm';
import { toMemoryRecord } from '../../brain/memory/store';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(t: string) { console.log(`\n▸ ${t}`); }

const NOW = Date.parse('2026-10-02T12:00:00Z');

/** يبني سجلات ذاكرة حقيقية الشكل من أحداث تعلّم (نفس منطق الإنتاج). */
function memoryRecordsFromEvents(events: LearningEvent[]) {
  return events.map((e) => toMemoryRecord(makeMemoryEntry({
    id: e.id, kind: 'platform', statement: `${e.subject} — ${e.detail}`, origin: 'derived',
    source: e.source, now: NOW, sampleSize: e.sampleSize, platform: e.platform ?? null, sourceRefs: [e.source], summary: e.detail,
  })));
}

/** deps قابلة للحقن: ساعة وهمية + حالة داخلية (بلا شبكة). */
function makeDeps(overrides: Partial<any> = {}) {
  let state: BrainRuntimeState = emptyBrainRuntimeState();
  let inFlight = false;
  const calls = { build: 0, persist: 0 };
  const deps = {
    now: () => NOW,
    isEnabled: () => true,
    lockTtlMs: () => BRAIN_LOCK_DEFAULT_TTL_MS,
    owner: () => 'proc-1',
    getState: () => state,
    setState: (n: BrainRuntimeState) => { state = n; },
    isInFlight: () => inFlight,
    setInFlight: (v: boolean) => { inFlight = v; },
    build: () => { calls.build += 1; return { newMemoryRecords: [], learningEventsCount: 0, memoryTotal: 0 }; },
    persist: async (records: any[]) => { calls.persist += 1; return { ok: true, added: records.length, total: records.length }; },
    ...overrides,
  };
  return { deps, calls, getState: () => state };
}

(async () => {
  // A/B — التمكين والحدود.
  group('A/B: enable + interval bounds');
  check('A1: افتراضياً مفعّل', resolveBrainRuntimeEnabled({}) === true);
  check('A2: BRAIN_RUNTIME_ENABLED=false يعطّل', resolveBrainRuntimeEnabled({ BRAIN_RUNTIME_ENABLED: 'false' }) === false);
  check('A3: القيمة الافتراضية 15 دقيقة', resolveBrainRuntimeIntervalMs({}) === BRAIN_RUNTIME_DEFAULT_INTERVAL_MS);
  check('A4: قيمة صفرية/سلبية => الافتراضي', resolveBrainRuntimeIntervalMs({ BRAIN_RUNTIME_INTERVAL_MS: '0' }) === BRAIN_RUNTIME_DEFAULT_INTERVAL_MS);
  check('A5: قيمة ضخمة تُقصّ للحد الأعلى', resolveBrainRuntimeIntervalMs({ BRAIN_RUNTIME_INTERVAL_MS: String(99 * 60 * 60 * 1000) }) === BRAIN_RUNTIME_MAX_INTERVAL_MS);
  check('A6: قيمة صغيرة تُرفع للحد الأدنى', resolveBrainRuntimeIntervalMs({ BRAIN_RUNTIME_INTERVAL_MS: '5' }) === BRAIN_RUNTIME_MIN_INTERVAL_MS);
  check('A7: مهلة القفل الافتراضية', resolveBrainLockTtlMs({}) === BRAIN_LOCK_DEFAULT_TTL_MS);
  check('A8: مهلة القفل تُقصّ للحد الأعلى', resolveBrainLockTtlMs({ BRAIN_RUNTIME_LOCK_TTL_MS: String(99 * 60 * 60 * 1000) }) === BRAIN_LOCK_MAX_TTL_MS);
  check('A9: مهلة القفل تُرفع للحد الأدنى', resolveBrainLockTtlMs({ BRAIN_RUNTIME_LOCK_TTL_MS: '1' }) === BRAIN_LOCK_MIN_TTL_MS);

  // C — قرار الاستحقاق.
  group('C: cadence / due');
  check('C1: لا تشغيل سابق => مستحقة', isBrainRuntimeDue(null, NOW, 15 * 60000) === true);
  check('C2: قبل الموعد => غير مستحقة', isBrainRuntimeDue(NOW - 5 * 60000, NOW, 15 * 60000) === false);
  check('C3: بعد الموعد => مستحقة', isBrainRuntimeDue(NOW - 16 * 60000, NOW, 15 * 60000) === true);
  check('C4: nextRunAt يُحسب من آخر تشغيل', nextBrainRuntimeAtMs(NOW, 15 * 60000) === NOW + 15 * 60000);
  check('C5: nextRunAt بلا تشغيل = null', nextBrainRuntimeAtMs(null, 15 * 60000) === null);

  // D/E/F — القفل.
  group('D/E/F: lock acquire / stale recovery / release');
  const first = acquireBrainLock(null, { owner: 'p1', nowMs: NOW, ttlMs: 60000 });
  check('D1: أخذ قفل بلا قفل سابق', first.acquired === true && first.recovered === false && first.lock?.owner === 'p1');
  const second = acquireBrainLock(first.lock, { owner: 'p2', nowMs: NOW + 1000, ttlMs: 60000 });
  check('D2: لا استيلاء على قفل حيّ (منع التوازي)', second.acquired === false && second.lock?.owner === 'p1');
  check('F1: القفل الحيّ غير متقادم', isBrainLockStale(first.lock, NOW + 1000) === false);
  const stale = acquireBrainLock(first.lock, { owner: 'p2', nowMs: NOW + 120000, ttlMs: 60000 });
  check('E1: استرداد القفل المتقادم', stale.acquired === true && stale.recovered === true && stale.lock?.owner === 'p2');
  const released = releaseBrainLock(stale.lock, 'other-owner');
  check('F2: لا يُفرج قفل غيره', released.released === false && released.lock?.owner === 'p2');
  const released2 = releaseBrainLock(stale.lock, 'p2');
  check('F3: يُفرج قفل نفسه', released2.released === true && released2.lock === null);

  // G — استمرارية الحالة المحمّلة.
  group('G: restart normalization');
  const normalized = normalizeBrainRuntimeState({ status: 'SUCCESS', lastStatus: 'SUCCESS', cycleCount: 5, lock: { owner: 'x', acquiredAtMs: NOW, expiresAtMs: NOW + 60000 }, lastNewMemoryRecords: 3 });
  check('G1: يُسترجَع العدّاد', normalized.cycleCount === 5 && normalized.lastNewMemoryRecords === 3);
  check('G2: يُسترجَع القفل', normalized.lock?.owner === 'x');
  check('G3: شكل غير صالح => حالة فارغة', normalizeBrainRuntimeState('bad').cycleCount === 0);
  check('G4: قفل مشوّه يُسقَط', normalizeBrainRuntimeState({ lock: { owner: 5 } }).lock === null);

  // H — دورة بلا بيانات جديدة.
  group('H: no-new-data cycle');
  {
    const { deps, calls, getState } = makeDeps();
    const res = await runBrainRuntimeCycle(deps, 'scheduled');
    check('H1: الحالة NO_NEW_DATA', res.status === 'NO_NEW_DATA');
    check('H2: لا استدعاء حفظ بلا سجلات', calls.persist === 0);
    check('H3: القفل أُفرج', getState().lock === null);
    check('H4: الحالة النهائية NO_NEW_DATA', getState().lastStatus === 'NO_NEW_DATA');
    check('H5: لا اختراع سجلات ذاكرة', getState().lastNewMemoryRecords === 0 && res.newMemoryRecords === 0);
  }

  // I/J — دورة ببيانات حقيقية => حفظ => SUCCESS.
  group('I/J: real events -> build -> persist');
  {
    const events: LearningEvent[] = [
      { id: 'reply:youtube:c1', kind: 'SUCCESS', subject: 'youtube:reply', detail: 'رد مُسلَّم', source: 'youtube — سجل الردود', sampleSize: 1, confidence: 'high', isFact: true, at: new Date(NOW).toISOString(), platform: 'youtube', providerId: 'c1' },
      { id: 'publish:youtube:v1', kind: 'OUTCOME', subject: 'youtube:publish', detail: 'نشر وصل PUBLISHED', source: 'youtube — سجل النشر', sampleSize: 1, confidence: 'high', isFact: true, at: new Date(NOW).toISOString(), platform: 'youtube', providerId: 'v1' },
    ];
    const records = memoryRecordsFromEvents(events);
    const { deps, calls, getState } = makeDeps({
      build: () => ({ newMemoryRecords: records, learningEventsCount: events.length, memoryTotal: 0 }),
    });
    const res = await runBrainRuntimeCycle(deps, 'scheduled');
    check('I1: الحالة SUCCESS', res.status === 'SUCCESS');
    check('I2: استُدعي الحفظ مرة', calls.persist === 1);
    check('I3: عدد السجلات الجديدة صادق', res.newMemoryRecords === 2);
    check('I4: الإجمالي بعد الحفظ', res.memoryTotal === 2);
    check('I5: persisted=true', res.persisted === true);
    check('I6: العدّادات تتقدم', getState().successCount === 1 && getState().totalNewMemoryRecords === 2);
  }

  // K — فشل الحفظ.
  group('K: persistence failure');
  {
    const events: LearningEvent[] = [{ id: 'reply:youtube:c2', kind: 'SUCCESS', subject: 'youtube:reply', detail: 'رد', source: 'youtube', sampleSize: 1, confidence: 'high', isFact: true, at: new Date(NOW).toISOString(), platform: 'youtube', providerId: 'c2' }];
    const { deps, getState } = makeDeps({
      build: () => ({ newMemoryRecords: memoryRecordsFromEvents(events), learningEventsCount: 1, memoryTotal: 0 }),
      persist: async () => ({ ok: false, added: 0, total: 0, error: 'persist_failed' }),
    });
    const res = await runBrainRuntimeCycle(deps, 'scheduled');
    check('K1: الحالة FAILED', res.status === 'FAILED');
    check('K2: لا ادّعاء نجاح', res.persisted === false && res.newMemoryRecords === 0);
    check('K3: يُسجَّل فشل الحفظ', getState().persistenceFailureCount === 1 && getState().failedCount === 1);
    check('K4: القفل أُفرج بعد الفشل', getState().lock === null);
    check('K5: الخطأ مُقنَّع بلا سرّ', String(getState().lastError).includes('persist_failed'));
  }

  // L — دورة مكررة أثناء الجريان.
  group('L: duplicate cycle while running');
  {
    const { deps, getState } = makeDeps({ isInFlight: () => true });
    const res = await runBrainRuntimeCycle(deps, 'scheduled');
    check('L1: SKIPPED_LOCKED', res.status === 'SKIPPED_LOCKED');
    check('L2: عدّاد التخطّي', getState().skippedLockedCount === 1);
  }

  // L2 — دورة ثانية والقفل حيّ (lease) => SKIPPED_LOCKED.
  group('L2: duplicate cycle while locked (lease)');
  {
    let state = emptyBrainRuntimeState();
    state = { ...state, lock: { owner: 'other-proc', acquiredAtMs: NOW, expiresAtMs: NOW + 600000 } };
    let inFlight = false;
    const deps = {
      now: () => NOW, isEnabled: () => true, lockTtlMs: () => 600000, owner: () => 'me',
      getState: () => state, setState: (n: BrainRuntimeState) => { state = n; },
      isInFlight: () => inFlight, setInFlight: (v: boolean) => { inFlight = v; },
      build: () => ({ newMemoryRecords: [], learningEventsCount: 0, memoryTotal: 0 }),
      persist: async () => ({ ok: true, added: 0, total: 0 }),
    };
    const res = await runBrainRuntimeCycle(deps, 'scheduled');
    check('L2-1: قفل حيّ لغيري => SKIPPED_LOCKED', res.status === 'SKIPPED_LOCKED' && state.lock?.owner === 'other-proc');
  }

  // M — منع تكرار الذاكرة عبر أحداث التعلّم.
  group('M: duplicate memory prevention');
  {
    const events: LearningEvent[] = [
      { id: 'reply:youtube:c1', kind: 'SUCCESS', subject: 'youtube:reply', detail: 'رد', source: 'youtube', sampleSize: 1, confidence: 'high', isFact: true, at: new Date(NOW).toISOString(), platform: 'youtube', providerId: 'c1' },
      { id: 'reply:youtube:c1', kind: 'SUCCESS', subject: 'youtube:reply', detail: 'رد', source: 'youtube', sampleSize: 1, confidence: 'high', isFact: true, at: new Date(NOW).toISOString(), platform: 'youtube', providerId: 'c1' },
    ];
    const deduped = dedupeLearningEvents(events);
    check('M1: الأحداث المكررة تُوحَّد (id/kind+subject+providerId)', deduped.length === 1);
    const records = memoryRecordsFromEvents(deduped);
    check('M2: سجل ذاكرة واحد فقط', records.length === 1);
    // M3: دورة تُرجع سجلات لكن كلها مكررة (added=0) => NO_NEW_DATA لا SUCCESS.
    const { deps } = makeDeps({
      build: () => ({ newMemoryRecords: records, learningEventsCount: 1, memoryTotal: 5 }),
      persist: async () => ({ ok: true, added: 0, total: 5 }),
    });
    const res = await runBrainRuntimeCycle(deps, 'scheduled');
    check('M3: تكرار كل السجلات => NO_NEW_DATA', res.status === 'NO_NEW_DATA', JSON.stringify(res));
  }

  // N/O/P/Q/R/S — حماية الحقيقة التجارية في منطق الدورة.
  group('N/O/P/Q/R/S: commercial truth guards');
  {
    const { deps, getState } = makeDeps();
    await runBrainRuntimeCycle(deps, 'scheduled');
    const st = getState();
    // الدورة لا تنتج أي حقل بيع/إيراد/ربح إطلاقاً.
    check('N1: لا حقول مبيعات في حالة وقت التشغيل', !('sales' in st) && !('revenue' in st));
    check('Q1: لا verifiedSales مُختلق', !JSON.stringify(st).includes('VERIFIED_SALE'));
    check('R1: لا إيراد مُختلق', !JSON.stringify(st).toLowerCase().includes('revenue'));
    check('S1: لا ربح مُختلق', !JSON.stringify(st).toLowerCase().includes('profit'));
  }

  // T — حدود السلطة.
  group('T: autonomy boundary');
  {
    const status = buildBrainRuntimeStatus(emptyBrainRuntimeState(), NOW, 15 * 60000, { enabled: true, scheduled: true, running: false });
    check('T1: لا إجراء خارجي', status.executesExternalActions === false);
    check('T2: لا استهلاك Gemini', status.geminiUsedOnCycles === false);
    check('T3: الحالة معروضة بالعربية', typeof status.statusLabelAr === 'string' && status.statusLabelAr.length > 0);
  }

  // U — لا منطق لمنصات غير YouTube.
  group('U: no non-YouTube platform logic');
  {
    const { deps, getState } = makeDeps();
    await runBrainRuntimeCycle(deps, 'scheduled');
    const blob = JSON.stringify(getState());
    for (const p of ['facebook', 'instagram', 'tiktok', 'whatsapp', 'messenger', 'snapchat', 'threads']) {
      check(`U-${p}: لا ذكر لمنصة ${p}`, !blob.includes(p));
    }
  }

  // V — لا تُسقط العملية عند خطأ البناء.
  group('V: build error does not crash');
  {
    const { deps, getState } = makeDeps({ build: () => { throw new Error('boom in build'); } });
    const res = await runBrainRuntimeCycle(deps, 'scheduled');
    check('V1: الحالة FAILED بلا رمي', res.status === 'FAILED');
    check('V2: القفل أُفرج', getState().lock === null);
    check('V3: خطأ مُقنَّع', typeof getState().lastError === 'string' && getState().lastError.length > 0);
  }

  // sanitize.
  group('sanitize error');
  check('Z1: يُقصّ الخطأ', sanitizeBrainRuntimeError({ code: 'PERSIST_FAILED' }) === 'PERSIST_FAILED');
  check('Z2: يحذف المحارف الخطرة', !sanitizeBrainRuntimeError('bad/<script>').includes('<'));
  check('Z3: لا يعيد فارغاً', sanitizeBrainRuntimeError('').length > 0);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.error('FAILURES:\n' + failures.join('\n')); process.exit(1); }
})();
