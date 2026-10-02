/**
 * العقل المركزي — وقت تشغيل 24/7 (Batch 5): منطق صافٍ قابل للاختبار.
 *
 * الغرض: تحويل العقل من on-read فقط إلى **مُشغِّل داخلي على الخادم** يبني العقل من
 * بيانات الإنتاج الحقيقية، يحوّل أحداث التعلّم إلى ذاكرة دائمة، ويحفظها عبر
 * **نفس** مسار الحفظ القائم (`persistBrainMemory`) — بلا نظام ذاكرة ثانٍ ولا جدول
 * جديد. لا يعتمد على المتصفح ولا على طلب HTTP.
 *
 * هذا الملف لا يعرف التطبيق: يستقبل كل شيء عبر `deps` (الوقت/الحالة/البناء/الحفظ)،
 * فلا شبكة ولا أسرار ولا ساعة حقيقية في المنطق نفسه.
 *
 * القواعد الحاكمة:
 * - قفل/lease واحد يمنع أي دورة متوازية، مع استرداد القفل المتقادم (لا جمود دائم).
 * - لا ادّعاء نجاح حفظ بلا نجاح فعلي: الحالة تُبنى من نتيجة `persist` الحقيقية.
 * - لا اختراع بيانات: الدورة تُعلن NO_NEW_DATA عند غياب أي سجل ذاكرة جديد.
 * - لا تتجاوز حدود السلطة: الدورة تحليل/تعلّم/حفظ فقط، بلا أي إجراء خارجي.
 */

import type { BrainMemoryRecord } from './memory/store';

/** حالات دورة العقل الصريحة (لا تُخفي الفشل). */
export const BRAIN_CYCLE_STATUSES = ['IDLE', 'RUNNING', 'SUCCESS', 'NO_NEW_DATA', 'SKIPPED_LOCKED', 'FAILED', 'DISABLED'] as const;
export type BrainCycleStatus = (typeof BRAIN_CYCLE_STATUSES)[number];

export const BRAIN_CYCLE_STATUS_LABELS_AR: Record<BrainCycleStatus, string> = Object.freeze({
  IDLE: 'في الانتظار',
  RUNNING: 'قيد التنفيذ',
  SUCCESS: 'نجحت وحفظت',
  NO_NEW_DATA: 'لا بيانات جديدة',
  SKIPPED_LOCKED: 'تُخطّيت (مقفلة)',
  FAILED: 'فشلت',
  DISABLED: 'معطّلة',
});

/** الإيقاع الافتراضي: كل 15 دقيقة (أبطأ من مراقب YouTube كل 5 دقائق). */
export const BRAIN_RUNTIME_DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
export const BRAIN_RUNTIME_MIN_INTERVAL_MS = 60 * 1000;
export const BRAIN_RUNTIME_MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** نبضة المؤقّت الداخلي: كل دقيقة، وتقرّر `isBrainRuntimeDue` إن كانت الدورة مستحقة. */
export const BRAIN_RUNTIME_TICK_MS = 60 * 1000;
/** مهلة القفل (lease): محدودة، فيُستردّ القفل المتقادم بعد انقضائها بلا جمود دائم. */
export const BRAIN_LOCK_DEFAULT_TTL_MS = 10 * 60 * 1000;
export const BRAIN_LOCK_MIN_TTL_MS = 60 * 1000;
export const BRAIN_LOCK_MAX_TTL_MS = 60 * 60 * 1000;

export const BRAIN_RUNTIME_INTERVAL_ENV = 'BRAIN_RUNTIME_INTERVAL_MS';
export const BRAIN_RUNTIME_ENABLED_ENV = 'BRAIN_RUNTIME_ENABLED';
export const BRAIN_LOCK_TTL_ENV = 'BRAIN_RUNTIME_LOCK_TTL_MS';

export const BRAIN_RUNTIME_TRIGGERS = ['scheduled', 'boot', 'manual'] as const;
export type BrainRuntimeTrigger = (typeof BRAIN_RUNTIME_TRIGGERS)[number];

/** قفل/lease دائم (يصمد بعد restart): من يملكه، متى أُخذ، ومتى ينتهي. */
export interface BrainRuntimeLock {
  owner: string;
  acquiredAtMs: number;
  expiresAtMs: number;
}

/** حالة وقت التشغيل المحفوظة (بلا أي سرّ). */
export interface BrainRuntimeState {
  status: BrainCycleStatus;
  lastStatus: BrainCycleStatus | null;
  lock: BrainRuntimeLock | null;
  lastCycleStartedAt: string | null;
  lastCycleCompletedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastTrigger: BrainRuntimeTrigger | string | null;
  cycleCount: number;
  successCount: number;
  noDataCount: number;
  skippedLockedCount: number;
  failedCount: number;
  staleLockRecoveries: number;
  lastDurationMs: number | null;
  lastNewEvents: number;
  lastNewMemoryRecords: number;
  totalNewMemoryRecords: number;
  lastMemoryTotal: number | null;
  persistenceSuccessCount: number;
  persistenceFailureCount: number;
}

export function emptyBrainRuntimeState(): BrainRuntimeState {
  return {
    status: 'IDLE',
    lastStatus: null,
    lock: null,
    lastCycleStartedAt: null,
    lastCycleCompletedAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastTrigger: null,
    cycleCount: 0,
    successCount: 0,
    noDataCount: 0,
    skippedLockedCount: 0,
    failedCount: 0,
    staleLockRecoveries: 0,
    lastDurationMs: null,
    lastNewEvents: 0,
    lastNewMemoryRecords: 0,
    totalNewMemoryRecords: 0,
    lastMemoryTotal: null,
    persistenceSuccessCount: 0,
    persistenceFailureCount: 0,
  };
}

function num(v: any, fallback = 0): number {
  return Number.isFinite(v) ? Number(v) : fallback;
}

/** يوحّد أي شكل محمّل/قديم إلى حالة صحيحة بلا إسقاط (توافق خلفي). */
export function normalizeBrainRuntimeState(raw: any): BrainRuntimeState {
  const base = emptyBrainRuntimeState();
  if (!raw || typeof raw !== 'object') return base;
  const status = (BRAIN_CYCLE_STATUSES as readonly string[]).includes(String(raw.status)) ? (raw.status as BrainCycleStatus) : base.status;
  const lastStatus = (BRAIN_CYCLE_STATUSES as readonly string[]).includes(String(raw.lastStatus)) ? (raw.lastStatus as BrainCycleStatus) : null;
  const lockRaw = raw.lock;
  const lock: BrainRuntimeLock | null =
    lockRaw && typeof lockRaw.owner === 'string' && Number.isFinite(lockRaw.expiresAtMs)
      ? { owner: String(lockRaw.owner), acquiredAtMs: num(lockRaw.acquiredAtMs), expiresAtMs: num(lockRaw.expiresAtMs) }
      : null;
  return {
    status,
    lastStatus,
    lock,
    lastCycleStartedAt: raw.lastCycleStartedAt ?? null,
    lastCycleCompletedAt: raw.lastCycleCompletedAt ?? null,
    lastSuccessAt: raw.lastSuccessAt ?? null,
    lastError: raw.lastError ?? null,
    lastTrigger: raw.lastTrigger ?? null,
    cycleCount: num(raw.cycleCount),
    successCount: num(raw.successCount),
    noDataCount: num(raw.noDataCount),
    skippedLockedCount: num(raw.skippedLockedCount),
    failedCount: num(raw.failedCount),
    staleLockRecoveries: num(raw.staleLockRecoveries),
    lastDurationMs: Number.isFinite(raw.lastDurationMs) ? Number(raw.lastDurationMs) : null,
    lastNewEvents: num(raw.lastNewEvents),
    lastNewMemoryRecords: num(raw.lastNewMemoryRecords),
    totalNewMemoryRecords: num(raw.totalNewMemoryRecords),
    lastMemoryTotal: Number.isFinite(raw.lastMemoryTotal) ? Number(raw.lastMemoryTotal) : null,
    persistenceSuccessCount: num(raw.persistenceSuccessCount),
    persistenceFailureCount: num(raw.persistenceFailureCount),
  };
}

/** هل وقت التشغيل مفعّل؟ (افتراضياً نعم؛ تعطيل صريح فقط عبر المتغيّر). */
export function resolveBrainRuntimeEnabled(env: Record<string, string | undefined> = {}): boolean {
  const raw = String(env?.[BRAIN_RUNTIME_ENABLED_ENV] ?? '').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off' || raw === 'no') return false;
  return true;
}

/** يحسم الإيقاع من البيئة بحدود آمنة (افتراضياً 15 دقيقة؛ لا إيقاع صفري/سلبي). */
export function resolveBrainRuntimeIntervalMs(env: Record<string, string | undefined> = {}): number {
  const n = Number(env?.[BRAIN_RUNTIME_INTERVAL_ENV]);
  if (!Number.isFinite(n) || n <= 0) return BRAIN_RUNTIME_DEFAULT_INTERVAL_MS;
  return Math.min(BRAIN_RUNTIME_MAX_INTERVAL_MS, Math.max(BRAIN_RUNTIME_MIN_INTERVAL_MS, Math.floor(n)));
}

/** مهلة القفل بحدود آمنة (افتراضياً 10 دقائق). */
export function resolveBrainLockTtlMs(env: Record<string, string | undefined> = {}): number {
  const n = Number(env?.[BRAIN_LOCK_TTL_ENV]);
  if (!Number.isFinite(n) || n <= 0) return BRAIN_LOCK_DEFAULT_TTL_MS;
  return Math.min(BRAIN_LOCK_MAX_TTL_MS, Math.max(BRAIN_LOCK_MIN_TTL_MS, Math.floor(n)));
}

/** هل حان موعد الدورة؟ لا تشغيل سابق ⇒ مستحقة (أول تشغيل). */
export function isBrainRuntimeDue(lastRunAtMs: number | null, nowMs: number, intervalMs: number): boolean {
  if (lastRunAtMs == null || !Number.isFinite(lastRunAtMs)) return true;
  if (!Number.isFinite(nowMs)) return false;
  return nowMs - lastRunAtMs >= Math.max(0, intervalMs);
}

/** يقرأ زمن آخر دورة من الحالة المحفوظة (ISO) إلى ميلي ثانية، أو null. */
export function parseBrainRuntimeLastRunAtMs(state: BrainRuntimeState | null | undefined): number | null {
  const raw = state?.lastCycleStartedAt;
  if (!raw) return null;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : null;
}

/** الموعد المتوقّع للدورة التالية (ميلي ثانية)، أو null إن لم تُشغَّل بعد. */
export function nextBrainRuntimeAtMs(lastRunAtMs: number | null, intervalMs: number): number | null {
  if (lastRunAtMs == null || !Number.isFinite(lastRunAtMs)) return null;
  return lastRunAtMs + Math.max(0, intervalMs);
}

/** هل القفل متقادم (انتهت مهلته)؟ */
export function isBrainLockStale(lock: BrainRuntimeLock | null | undefined, nowMs: number): boolean {
  if (!lock) return false;
  return !Number.isFinite(lock.expiresAtMs) || lock.expiresAtMs <= nowMs;
}

/**
 * محاولة أخذ القفل. القفل المتقادم (انتهت مهلته) يُستردّ تلقائياً فلا جمود دائم.
 * لا استيلاء على قفل حيّ — يُرفض الطلب.
 */
export function acquireBrainLock(
  current: BrainRuntimeLock | null | undefined,
  input: { owner: string; nowMs: number; ttlMs: number },
): { acquired: boolean; lock: BrainRuntimeLock | null; recovered: boolean } {
  const ttl = Math.max(BRAIN_LOCK_MIN_TTL_MS, Math.floor(input.ttlMs));
  const fresh: BrainRuntimeLock = { owner: input.owner, acquiredAtMs: input.nowMs, expiresAtMs: input.nowMs + ttl };
  if (!current) return { acquired: true, lock: fresh, recovered: false };
  if (isBrainLockStale(current, input.nowMs)) {
    // استرداد قفل متقادم (عملية سابقة تعطّلت): لا جمود دائم.
    return { acquired: true, lock: fresh, recovered: true };
  }
  return { acquired: false, lock: current, recovered: false };
}

/** يُفرج القفل فقط إن كان مالكه نفس صاحب الدورة (لا يُفرج قفل غيره). */
export function releaseBrainLock(
  current: BrainRuntimeLock | null | undefined,
  owner: string,
): { lock: BrainRuntimeLock | null; released: boolean } {
  if (!current) return { lock: null, released: false };
  if (current.owner !== owner) return { lock: current, released: false };
  return { lock: null, released: true };
}

/** يُقصّر أي خطأ إلى كود/رسالة قصيرة بلا أسرار (لا مسارات ولا رموز). */
export function sanitizeBrainRuntimeError(err: any): string {
  const raw = String(err?.code || err?.name || err?.message || err || 'cycle_failed');
  return raw.replace(/[^\p{L}\p{N}_.:\- ]/gu, '').slice(0, 80) || 'cycle_failed';
}

export interface BrainCycleResult {
  status: BrainCycleStatus;
  reason?: string;
  durationMs?: number;
  newEvents?: number;
  newMemoryRecords?: number;
  memoryTotal?: number | null;
  persisted?: boolean;
  error?: string;
}

/**
 * مدخلات دورة العقل: كل التبعيات مُحقونة (لا شبكة/أسرار). `build` و`persist`
 * يستخدمان منطق العقل ومسار الحفظ **القائمين** حرفياً.
 */
export interface BrainRuntimeCycleDeps {
  now: () => number;
  isEnabled: () => boolean;
  lockTtlMs: () => number;
  owner: () => string;
  getState: () => BrainRuntimeState;
  /** يحفظ الحالة (يصمد بعد restart). */
  setState: (next: BrainRuntimeState) => void;
  /** قفل داخل العملية (اختياري) يمنع حتى محاولة الدورة أثناء جريانها. */
  isInFlight?: () => boolean;
  setInFlight?: (v: boolean) => void;
  /** يبني العقل من بيانات حقيقية ويعيد سجلات الذاكرة الجديدة + العدّادات. */
  build: () => { newMemoryRecords: BrainMemoryRecord[]; learningEventsCount: number; memoryTotal: number };
  /** يحفظ عبر مسار الحفظ القائم؛ يُعيد نجاح/فشل الحفظ الفعلي + المجموع بعد الحفظ. */
  persist: (records: BrainMemoryRecord[]) => Promise<{ ok: boolean; added: number; total: number; error?: string }>;
}

/**
 * دورة عقل واحدة: قفل → بناء → تعلّم → حفظ → تحديث الحالة → إفراج.
 * لا تُرمي أبداً (تُسجّل الفشل وتُفرج القفل)، فلا تُسقط الخادم.
 */
export async function runBrainRuntimeCycle(
  deps: BrainRuntimeCycleDeps,
  trigger: BrainRuntimeTrigger = 'scheduled',
): Promise<BrainCycleResult> {
  const nowMs = deps.now();
  const state = deps.getState();

  if (!deps.isEnabled()) {
    deps.setState({ ...state, status: 'DISABLED', lastStatus: 'DISABLED', lastError: null, lastTrigger: trigger });
    return { status: 'DISABLED', reason: 'runtime_disabled' };
  }
  if (deps.isInFlight?.()) {
    const next: BrainRuntimeState = { ...state, status: 'SKIPPED_LOCKED', lastStatus: 'SKIPPED_LOCKED', skippedLockedCount: state.skippedLockedCount + 1, lastError: null, lastTrigger: trigger };
    deps.setState(next);
    return { status: 'SKIPPED_LOCKED', reason: 'in_flight' };
  }

  const owner = deps.owner();
  const lockRes = acquireBrainLock(state.lock, { owner, nowMs, ttlMs: deps.lockTtlMs() });
  if (!lockRes.acquired) {
    const next: BrainRuntimeState = { ...state, status: 'SKIPPED_LOCKED', lastStatus: 'SKIPPED_LOCKED', skippedLockedCount: state.skippedLockedCount + 1, lastError: null, lastTrigger: trigger };
    deps.setState(next);
    return { status: 'SKIPPED_LOCKED', reason: 'locked' };
  }

  // أُخذ القفل (مع استرداد المتقادم إن وُجد) — تُحفظ الحالة قبل أي عمل.
  deps.setState({
    ...state,
    lock: lockRes.lock,
    status: 'RUNNING',
    lastStatus: 'RUNNING',
    lastCycleStartedAt: new Date(nowMs).toISOString(),
    lastTrigger: trigger,
    cycleCount: state.cycleCount + 1,
    staleLockRecoveries: state.staleLockRecoveries + (lockRes.recovered ? 1 : 0),
    lastError: null,
  });
  deps.setInFlight?.(true);
  const started = Date.now();

  try {
    const built = deps.build();
    const records = Array.isArray(built.newMemoryRecords) ? built.newMemoryRecords : [];
    let persistResult: { ok: boolean; added: number; total: number; error?: string } = { ok: true, added: 0, total: built.memoryTotal };
    if (records.length) persistResult = await deps.persist(records);

    const durationMs = Date.now() - started;
    const added = persistResult.added || 0;
    // "لا بيانات جديدة" تشمل حالة تكرار كل السجلات (added=0) لا فقط غياب السجلات.
    const noData = records.length === 0 || added === 0;
    const status: BrainCycleStatus = persistResult.ok ? (noData ? 'NO_NEW_DATA' : 'SUCCESS') : 'FAILED';
    const completedAt = new Date().toISOString();
    const prev = deps.getState();
    const released = releaseBrainLock(prev.lock, owner).lock;
    deps.setState({
      ...prev,
      lock: released,
      status,
      lastStatus: status,
      lastCycleCompletedAt: completedAt,
      lastSuccessAt: persistResult.ok ? completedAt : prev.lastSuccessAt,
      lastError: persistResult.ok ? null : (persistResult.error || 'persist_failed'),
      lastDurationMs: durationMs,
      lastNewEvents: built.learningEventsCount || 0,
      lastNewMemoryRecords: added,
      totalNewMemoryRecords: prev.totalNewMemoryRecords + added,
      lastMemoryTotal: persistResult.total ?? built.memoryTotal,
      successCount: persistResult.ok ? prev.successCount + 1 : prev.successCount,
      noDataCount: noData ? prev.noDataCount + 1 : prev.noDataCount,
      failedCount: persistResult.ok ? prev.failedCount : prev.failedCount + 1,
      persistenceSuccessCount: persistResult.ok && records.length ? prev.persistenceSuccessCount + 1 : prev.persistenceSuccessCount,
      persistenceFailureCount: !persistResult.ok ? prev.persistenceFailureCount + 1 : prev.persistenceFailureCount,
    });
    return {
      status,
      durationMs,
      newEvents: built.learningEventsCount || 0,
      newMemoryRecords: added,
      memoryTotal: persistResult.total ?? built.memoryTotal,
      persisted: persistResult.ok,
      error: persistResult.ok ? undefined : (persistResult.error || 'persist_failed'),
    };
  } catch (err: any) {
    const prev = deps.getState();
    const released = releaseBrainLock(prev.lock, owner).lock;
    const error = sanitizeBrainRuntimeError(err);
    deps.setState({
      ...prev,
      lock: released,
      status: 'FAILED',
      lastStatus: 'FAILED',
      lastCycleCompletedAt: new Date().toISOString(),
      lastError: error,
      lastDurationMs: Date.now() - started,
      failedCount: prev.failedCount + 1,
    });
    return { status: 'FAILED', error };
  } finally {
    deps.setInFlight?.(false);
  }
}

/** لقطة حالة وقت التشغيل الصادقة (بلا أي سرّ) للصحة/الجاهزية/الواجهة. */
export function buildBrainRuntimeStatus(
  state: BrainRuntimeState,
  nowMs: number,
  intervalMs: number,
  opts: { enabled: boolean; scheduled: boolean; running: boolean },
) {
  const lastRunAtMs = parseBrainRuntimeLastRunAtMs(state);
  const next = nextBrainRuntimeAtMs(lastRunAtMs, intervalMs);
  const currentStatus: BrainCycleStatus = !opts.enabled
    ? 'DISABLED'
    : opts.running || state.status === 'RUNNING'
      ? 'RUNNING'
      : (state.lastStatus || state.status || 'IDLE');
  return {
    enabled: opts.enabled,
    scheduled: opts.scheduled,
    running: opts.running,
    status: currentStatus,
    statusLabelAr: BRAIN_CYCLE_STATUS_LABELS_AR[currentStatus],
    lastStatus: state.lastStatus,
    lastStatusLabelAr: state.lastStatus ? BRAIN_CYCLE_STATUS_LABELS_AR[state.lastStatus] : null,
    intervalMinutes: Math.round(intervalMs / 60000),
    intervalMs,
    lastCycleStartedAt: state.lastCycleStartedAt,
    lastCycleCompletedAt: state.lastCycleCompletedAt,
    lastSuccessAt: state.lastSuccessAt,
    lastTrigger: state.lastTrigger,
    nextRunAt: next == null ? null : new Date(next).toISOString(),
    due: isBrainRuntimeDue(lastRunAtMs, nowMs, intervalMs),
    cycleCount: state.cycleCount,
    successCount: state.successCount,
    noDataCount: state.noDataCount,
    skippedLockedCount: state.skippedLockedCount,
    failedCount: state.failedCount,
    staleLockRecoveries: state.staleLockRecoveries,
    lastDurationMs: state.lastDurationMs,
    lastNewEvents: state.lastNewEvents,
    lastNewMemoryRecords: state.lastNewMemoryRecords,
    totalNewMemoryRecords: state.totalNewMemoryRecords,
    lastMemoryTotal: state.lastMemoryTotal,
    persistenceSuccessCount: state.persistenceSuccessCount,
    persistenceFailureCount: state.persistenceFailureCount,
    lastError: state.lastError,
    lockHeld: Boolean(state.lock),
    lockExpiresAt: state.lock ? new Date(state.lock.expiresAtMs).toISOString() : null,
    lockStale: isBrainLockStale(state.lock, nowMs),
    executesExternalActions: false,
    geminiUsedOnCycles: false,
    note: 'وقت تشغيل العقل: تحليل/تعلّم/حفظ ذاكرة فقط — بلا أي إجراء خارجي وبلا استهلاك Gemini.',
  };
}
