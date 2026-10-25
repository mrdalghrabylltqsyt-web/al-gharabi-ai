/**
 * دمج كتابات «مسك الدفاتر» لحالات المراقبين — توفير الخطة المجانية (Neon).
 *
 * الجذر: كل دورة مراقبة (كل 5 دقائق لكل من YouTube وMeta وTelegram) تعيد كتابة
 * كائن الحالة **كاملاً** إلى Neon لأن حقولاً تتغير في كل دورة حتى بلا أي حدث:
 * `lastPollAt` و`pollCount` و`lastScanned` وانتهاء القفل وأرقام المسح. كشف التغيّر
 * في المحوّل لا يمنعها (القيمة تغيّرت فعلاً). حالة YouTube تحمل سجل المعالجة
 * وطابور المحتوى (قد تبلغ ميغابايتات) — أي آلاف الكتابات الكبيرة يومياً بلا معنى،
 * وتُبقي حوسبة Neon مستيقظة.
 *
 * القاعدة: الحقول «المتطايرة» تُستبعد من بصمة الأهمية. إن لم تتغير البصمة منذ آخر
 * كتابة فعلية ولم تمضِ المهلة القصوى (30 دقيقة) ⇒ لا كتابة. أي تغيير حقيقي (تعليق
 * جديد، رد، خطأ، تحكم، طابور، تحرير قفل) يُكتب فوراً كما كان. أقصى فقد بعد انقطاع
 * مفاجئ = وقت آخر دورة وعدّاد الدورات (يُعاد حسابهما تلقائياً) — لا بيانات زبون.
 */

/** مهلة قصوى بين كتابتين فعليتين حتى بلا تغيير مهم (تحديث وقت آخر دورة). */
export const BOOKKEEPING_MAX_DELAY_MS = 30 * 60 * 1000;

/** حقول تتغير في كل دورة بلا معنى تشغيلي (مسارات بالنقطة؛ `*` = أي مفتاح). */
export const WATCHER_VOLATILE_PATHS: readonly string[] = Object.freeze([
  'lastPollAt',
  'pollCount',
  'lastScanned',
  'lease.acquiredAtMs',
  'lease.expiresAtMs',
  'deferral.lastDeferredAt',
  'platformStats.*.postsScanned',
  'platformStats.*.commentsVisible',
  'platformStats.*.commentsTotalReported',
  'platformStats.*.callsPerCycle',
  'platformStats.*.lastOkAt',
]);

function stripPath(node: any, parts: string[]): void {
  if (!node || typeof node !== 'object' || parts.length === 0) return;
  const [head, ...rest] = parts;
  const keys = head === '*' ? Object.keys(node) : [head];
  for (const k of keys) {
    if (!(k in node)) continue;
    if (rest.length === 0) delete node[k];
    else stripPath(node[k], rest);
  }
}

/** بصمة الأهمية: نسخة JSON من القيمة بلا الحقول المتطايرة. */
export function significantFingerprint(value: unknown, volatilePaths: readonly string[] = WATCHER_VOLATILE_PATHS): string {
  let clone: any;
  try { clone = JSON.parse(JSON.stringify(value ?? null)); } catch { return String(Math.random()); }
  for (const p of volatilePaths) stripPath(clone, p.split('.'));
  return JSON.stringify(clone);
}

export interface CoalesceMemo { fingerprint: string; atMs: number }

/**
 * هل تُكتب القيمة الآن؟ `force` (الإغلاق/المسارات الحرجة) يكتب دائماً. لا ذاكرة
 * سابقة (أول كتابة بعد الإقلاع) ⇒ كتابة.
 */
export function decideCoalescedWrite(
  prev: CoalesceMemo | undefined,
  value: unknown,
  nowMs: number,
  opts: { force?: boolean; maxDelayMs?: number; volatilePaths?: readonly string[] } = {},
): { write: boolean; memo: CoalesceMemo; reason: 'forced' | 'first' | 'changed' | 'max_delay' | 'bookkeeping_only' } {
  const fingerprint = significantFingerprint(value, opts.volatilePaths ?? WATCHER_VOLATILE_PATHS);
  const memo = { fingerprint, atMs: nowMs };
  if (opts.force) return { write: true, memo, reason: 'forced' };
  if (!prev) return { write: true, memo, reason: 'first' };
  if (prev.fingerprint !== fingerprint) return { write: true, memo, reason: 'changed' };
  if (nowMs - prev.atMs >= (opts.maxDelayMs ?? BOOKKEEPING_MAX_DELAY_MS)) return { write: true, memo, reason: 'max_delay' };
  return { write: false, memo: prev, reason: 'bookkeeping_only' };
}

/** مسك دفاتر وقت تشغيل العقل داخل حالة التحكم (عدّادات/طوابع/قفل الدورة). */
export const BRAIN_RUNTIME_VOLATILE_PATHS: readonly string[] = Object.freeze([
  'brainRuntime.status', 'brainRuntime.lastStatus', 'brainRuntime.lock',
  'brainRuntime.lastCycleStartedAt', 'brainRuntime.lastCycleCompletedAt', 'brainRuntime.lastSuccessAt',
  'brainRuntime.lastTrigger', 'brainRuntime.cycleCount', 'brainRuntime.successCount', 'brainRuntime.noDataCount',
  'brainRuntime.skippedLockedCount', 'brainRuntime.staleLockRecoveries', 'brainRuntime.lastDurationMs',
  'brainRuntime.lastNewEvents', 'brainRuntime.lastNewMemoryRecords', 'brainRuntime.totalNewMemoryRecords',
  'brainRuntime.lastMemoryTotal', 'brainRuntime.persistenceSuccessCount', 'brainRuntime.deferral.lastDeferredAt',
]);

/** مؤشرات الحصص (عرض فقط): تتغير مع كل طلب صحة؛ تغيّر الشهر وحده مهم. */
export const USAGE_INDICATOR_VOLATILE_PATHS: readonly string[] = Object.freeze([
  'updatedAt', 'egressBytesMonth', 'egressBytesSinceBoot',
  'renderUptime.hoursThisMonth', 'renderUptime.lastAccruedAt', 'renderUptime.updatedAt',
]);
