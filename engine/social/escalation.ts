/**
 * التصعيد البشري (Human Escalation).
 *
 * الغرض: سجل تصعيد حقيقي لحالة تحتاج بشراً (شكوى/سعر/حساس/سبام/سؤال غير واضح)،
 * يحفظ سياقها (المنصة/الخيط/نص التعليق/سبب التصعيد) ولا يدّعي إشعاراً لم يقع.
 *
 * **لا نجاح وهمي**: إذا لم يُمرَّر مُبلِّغ (notifier) فعّال أو فشل، يُعلَن
 * `notificationDelivered: false` مع سبب صريح. لا يُدّعى إشعار أبداً بلا دليل.
 *
 * منطق صافٍ قابل للاختبار: لا شبكة ولا أسرار ولا ساعة حقيقية (الزمن يُمرَّر).
 * إعادة الاستخدام: المُبلِّغ يُحقن من الخادم (نفس `pushNotification` القائم).
 */

export type EscalationState = 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED';

export const ESCALATION_STATES: readonly EscalationState[] = Object.freeze(['PENDING', 'ACKNOWLEDGED', 'RESOLVED']);

export const ESCALATION_STATE_LABELS_AR: Readonly<Record<EscalationState, string>> = Object.freeze({
  PENDING: 'معلّق',
  ACKNOWLEDGED: 'مُطّلع عليه',
  RESOLVED: 'محلول',
});

export type EscalationReason =
  | 'price_unverified'
  | 'complaint'
  | 'sensitive'
  | 'spam'
  | 'unclear'
  | 'manual';

export const ESCALATION_REASON_LABELS_AR: Readonly<Record<EscalationReason, string>> = Object.freeze({
  price_unverified: 'استفسار سعر/قسط يحتاج معلومة موثّقة',
  complaint: 'شكوى تحتاج معالجة بشرية',
  sensitive: 'حالة حسّاسة (قانونية/شخصية)',
  spam: 'سبام يحتاج مراجعة',
  unclear: 'غير واضح — يحتاج تدخّل بشري',
  manual: 'تصعيد يدوي من المالك',
});

export interface EscalationRecord {
  id: string;
  platform: string | null;
  /** خيط/منشور المحادثة — يحفظ السياق ويُستخدم لمنع الإغلاق أثناء التصعيد. */
  conversationId: string | null;
  subjectId: string | null;
  externalId: string | null;
  /** نص التعليق/الرسالة الأصلية (سياق التصعيد). */
  commentText: string;
  reason: EscalationReason;
  reasonLabelAr: string;
  state: EscalationState;
  createdAt: string;
  updatedAt: string;
  /** هل وُصل إشعار فعلياً؟ لا يُدّعى `true` بلا مُبلِّغ ناجح. */
  notificationDelivered: boolean;
  notificationChannel: string | null;
  /** سبب عدم الإشعار عند الفشل/غياب القناة (بلا سرّ). */
  notificationError: string | null;
  acknowledgedBy: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface NotifierResult {
  delivered: boolean;
  channel: string | null;
  error: string | null;
}

export type EscalationNotifier = (record: Omit<EscalationRecord, 'notificationDelivered' | 'notificationChannel' | 'notificationError'>) => NotifierResult;

export function isEscalationOpen(record: EscalationRecord): boolean {
  return record.state === 'PENDING' || record.state === 'ACKNOWLEDGED';
}

/** هل يوجد تصعيد معلّق في محادثة معيّنة؟ يمنع إغلاق المحادثة. */
export function hasPendingEscalation(records: EscalationRecord[], conversationId: string | null): boolean {
  if (!conversationId) return false;
  return records.some((r) => r.conversationId === conversationId && isEscalationOpen(r));
}

export function createEscalationRecord(input: {
  id: string;
  platform: string | null;
  conversationId: string | null;
  subjectId: string | null;
  externalId: string | null;
  commentText: string;
  reason: EscalationReason;
  nowIso: string;
  notifier?: EscalationNotifier | null;
}): EscalationRecord {
  const base: Omit<EscalationRecord, 'notificationDelivered' | 'notificationChannel' | 'notificationError'> = {
    id: input.id,
    platform: input.platform,
    conversationId: input.conversationId,
    subjectId: input.subjectId,
    externalId: input.externalId,
    commentText: input.commentText,
    reason: input.reason,
    reasonLabelAr: ESCALATION_REASON_LABELS_AR[input.reason],
    state: 'PENDING',
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
    acknowledgedBy: null,
    resolvedBy: null,
    resolvedAt: null,
  };
  // الإشعار: لا يُدّعى نجاحه إلا إذا أعاد المُبلِّغ `delivered: true` فعلاً.
  let notificationDelivered = false;
  let notificationChannel: string | null = null;
  let notificationError: string | null = 'لم تُضبط قناة إشعار للمالك (لا ادّعاء إشعار).';
  if (input.notifier) {
    try {
      const r = input.notifier(base);
      notificationDelivered = r.delivered === true;
      notificationChannel = r.channel || null;
      notificationError = notificationDelivered ? null : (r.error || 'فشل إشعار المالك.');
    } catch (e) {
      notificationDelivered = false;
      notificationChannel = null;
      notificationError = e instanceof Error ? e.name : 'notifier_threw';
    }
  }
  return { ...base, notificationDelivered, notificationChannel, notificationError };
}

/** ينتقل بحالة تصعيد معلّق. الانتقالات الصالحة: PENDING→ACKNOWLEDGED→RESOLVED. */
export function transitionEscalation(
  record: EscalationRecord,
  event: 'acknowledge' | 'resolve',
  by: string,
  nowIso: string,
): EscalationRecord {
  if (event === 'acknowledge') {
    if (record.state !== 'PENDING') return record; // لا إطّلاع على غير المعلّق
    return { ...record, state: 'ACKNOWLEDGED', acknowledgedBy: by, updatedAt: nowIso };
  }
  // resolve
  if (record.state === 'RESOLVED') return record;
  return { ...record, state: 'RESOLVED', resolvedBy: by, resolvedAt: nowIso, updatedAt: nowIso };
}

/** يحدّد سبب التصعيد من تصنيف حتمي (بلا اختراع سبب). */
export function escalationReasonFor(input: {
  intent?: string | null;
  isSpam?: boolean;
  requiresHumanReview?: boolean;
  topic?: string | null;
}): EscalationReason | null {
  if (input.isSpam) return 'spam';
  if (input.intent === 'complaint') return 'complaint';
  if (input.intent === 'spam') return 'spam';
  if (input.topic === 'price') return 'price_unverified';
  if (input.requiresHumanReview) return 'sensitive';
  if (input.intent === 'question' || input.intent === 'other') return 'unclear';
  return null;
}
