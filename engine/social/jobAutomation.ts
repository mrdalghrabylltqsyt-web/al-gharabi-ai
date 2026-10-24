/**
 * B4 — التنفيذ التلقائي الاختياري للمهام المعتمدة (منطق صافٍ قابل للاختبار).
 *
 * القاعدة الملزمة:
 *   - **الافتراضي معطَّل** (fail-closed): لا تنفيذ خارجي تلقائي حتى يفعّله المالك صراحةً.
 *   - **لا تنفيذ لمهمة غير معتمدة**: الحالة الوحيدة المقبولة هي `ready` (وهي لا تُمنح
 *     إلا لمهمة `approved` حان موعدها + المنصة موثّقة + القدرة موجودة).
 *   - **لا تكرار**: مهمة نُفّذت (`executed`) أو فشلت نهائياً (`failed`) لا تُعاد.
 *   - **انتظار الحصة صريح**: مهمة مُعلَّقة على تجدّد حصة YouTube (`quotaRetryAt` في
 *     المستقبل) لا تُعاد قبل موعدها.
 *
 * لا شبكة، لا أسرار، ولا ساعة حقيقية (الزمن يُمرَّر).
 */

export interface JobAutomationState {
  /** مفتاح المالك: نشر المعتمد تلقائياً في موعده — **الافتراضي معطَّل**. */
  autoExecuteApproved: boolean;
  /** آخر نتيجة تنفيذ تلقائي (بلا سرّ). */
  lastAutoRunAt: string | null;
  lastAutoResult: 'executed' | 'failed' | null;
  lastAutoJobId: string | null;
  /** إجمالي التنفيذ التلقائي الناجح/الفاشل منذ بدء القياس. */
  autoExecutedCount: number;
  autoFailedCount: number;
}

export function defaultJobAutomationState(): JobAutomationState {
  return {
    autoExecuteApproved: false,
    lastAutoRunAt: null,
    lastAutoResult: null,
    lastAutoJobId: null,
    autoExecutedCount: 0,
    autoFailedCount: 0,
  };
}

/** يُطبّع أي لقطة محفوظة (توافق خلفي: غياب الحقل ⇒ معطَّل). */
export function normalizeJobAutomationState(raw: unknown): JobAutomationState {
  const base = defaultJobAutomationState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  return {
    // أي قيمة غير true صريحة تُبقي التنفيذ التلقائي معطَّلاً.
    autoExecuteApproved: r.autoExecuteApproved === true,
    lastAutoRunAt: typeof r.lastAutoRunAt === 'string' ? r.lastAutoRunAt : null,
    lastAutoResult: r.lastAutoResult === 'executed' || r.lastAutoResult === 'failed' ? r.lastAutoResult : null,
    lastAutoJobId: typeof r.lastAutoJobId === 'string' ? r.lastAutoJobId : null,
    autoExecutedCount: Number.isFinite(r.autoExecutedCount) ? Math.max(0, Number(r.autoExecutedCount)) : 0,
    autoFailedCount: Number.isFinite(r.autoFailedCount) ? Math.max(0, Number(r.autoFailedCount)) : 0,
  };
}

/** يبدّل مفتاح التنفيذ التلقائي (للمالك). */
export function setJobAutoExecute(state: JobAutomationState, enabled: boolean): JobAutomationState {
  return { ...state, autoExecuteApproved: enabled === true };
}

export interface AutoExecuteDecisionInput {
  /** حالة المهمة الحالية. */
  status: string;
  /** هل المفتاح مفعّل من المالك؟ */
  enabled: boolean;
  /** موعد إعادة المحاولة بعد نفاد حصة YouTube (ISO) إن وُجد. */
  quotaRetryAt?: string | null;
  nowMs: number;
}

export type AutoExecuteDecisionCode =
  | 'ALLOW'
  | 'DISABLED'
  | 'NOT_READY'
  | 'QUOTA_WAIT';

/** قرار حتمي: هل تُنفَّذ هذه المهمة تلقائياً الآن؟ */
export function decideAutoExecute(input: AutoExecuteDecisionInput): { allow: boolean; code: AutoExecuteDecisionCode } {
  if (!input.enabled) return { allow: false, code: 'DISABLED' };
  // الحالة الوحيدة المقبولة: ready (لا queued/approved غير جاهزة، ولا executed/failed).
  if (String(input.status) !== 'ready') return { allow: false, code: 'NOT_READY' };
  const retryAt = input.quotaRetryAt ? Date.parse(String(input.quotaRetryAt)) : NaN;
  if (Number.isFinite(retryAt) && retryAt > input.nowMs) return { allow: false, code: 'QUOTA_WAIT' };
  return { allow: true, code: 'ALLOW' };
}

/** كتلة عرض عامة (بلا سرّ) للحالة/الجاهزية. */
export function jobAutomationPublicBlock(state: JobAutomationState) {
  return {
    autoExecuteApproved: state.autoExecuteApproved,
    defaultOff: true,
    lastAutoRunAt: state.lastAutoRunAt,
    lastAutoResult: state.lastAutoResult,
    lastAutoJobId: state.lastAutoJobId,
    autoExecutedCount: state.autoExecutedCount,
    autoFailedCount: state.autoFailedCount,
    note: 'تنفيذ المهام المعتمدة تلقائياً عند حلول موعدها — معطَّل افتراضياً حتى يفعّله المالك صراحةً.',
  };
}
