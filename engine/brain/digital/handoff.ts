/**
 * Digital Sales — التسليم البشري (Human Handoff) (منطق خالص).
 *
 * الغرض: حين لا يستطيع العقل الإجابة بأمان، يُحوّل الحالة إلى موظف بشري **بلا
 * اختراع إجابة**. يسجّل سبب التسليم ودليله وسياقه والإجراء البشري الموصى به.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../../social/adapter';

export type HandoffReason =
  | 'missing_price'
  | 'uncertain_availability'
  | 'unclear_product_identity'
  | 'unusual_request'
  | 'negotiation'
  | 'discount_request'
  | 'complaint'
  | 'sensitive_customer_issue'
  | 'commercial_commitment'
  | 'conflicting_commercial_data'
  | 'insufficient_evidence';

export const HANDOFF_REASON_LABELS_AR: Record<HandoffReason, string> = Object.freeze({
  missing_price: 'السعر غير متوفّر',
  uncertain_availability: 'التوفر غير مؤكّد',
  unclear_product_identity: 'هوية المنتج غير واضحة',
  unusual_request: 'طلب غير معتاد',
  negotiation: 'تفاوض',
  discount_request: 'طلب خصم',
  complaint: 'شكوى',
  sensitive_customer_issue: 'مسألة عميل حساسة',
  commercial_commitment: 'التزام تجاري',
  conflicting_commercial_data: 'تعارض في البيانات التجارية',
  insufficient_evidence: 'أدلة غير كافية',
});

/** إجراء بشري موصى به لكل سبب. */
export const HANDOFF_RECOMMENDED_ACTION_AR: Record<HandoffReason, string> = Object.freeze({
  missing_price: 'تحقّق من السعر في السجل وحدّثه ثم أعد الإجابة.',
  uncertain_availability: 'تحقّق من المخزون الفعلي قبل الرد.',
  unclear_product_identity: 'اسأل العميل لتحديد المنتج بالضبط.',
  unusual_request: 'راجع الطلب يدوياً قبل أي التزام.',
  negotiation: 'تفاوض بشري ضمن الشروط المعتمدة فقط.',
  discount_request: 'راجع طلب الخصم ضمن السياسة المعتمدة — لا خصم آلي.',
  complaint: 'تعامل بشري مباشر مع الشكوى.',
  sensitive_customer_issue: 'حوّل لمسؤول بشري مختص.',
  commercial_commitment: 'لا التزام تجاري بلا اعتماد صريح.',
  conflicting_commercial_data: 'راجع تعارض البيانات قبل الرد.',
  insufficient_evidence: 'اجمع أدلة إضافية أو راجع يدوياً.',
});

export interface HandoffContext {
  platform: PlatformId | 'cross_platform';
  conversationId: string | null;
  leadId: string | null;
  productId: string | null;
  /** مقتطف النص فقط — بلا بيانات شخصية غير ضرورية. */
  snippet: string;
}

export interface HumanHandoff {
  required: boolean;
  reason: HandoffReason | null;
  reasonLabelAr: string | null;
  evidence: string[];
  context: HandoffContext;
  recommendedAction: string | null;
  /** لا يُخترع رد لتفادي التسليم. */
  fabricatedFallback: false;
  at: string;
}

/** يحوّل حالة إلى تسليم بشري بسبب صريح ودليل. */
export function buildHumanHandoff(input: {
  reason: HandoffReason;
  evidence: string[];
  context: HandoffContext;
  nowMs: number;
}): HumanHandoff {
  return {
    required: true,
    reason: input.reason,
    reasonLabelAr: HANDOFF_REASON_LABELS_AR[input.reason],
    evidence: [...input.evidence],
    context: { ...input.context, snippet: String(input.context.snippet || '').slice(0, 160) },
    recommendedAction: HANDOFF_RECOMMENDED_ACTION_AR[input.reason],
    fabricatedFallback: false,
    at: new Date(input.nowMs).toISOString(),
  };
}

/**
 * يقرّر هل يلزم تسليم بشري بناءً على حالة الإجابة/السياق. لا يُخفي التسليم
 * لتفادي «فشل» الرد.
 */
export function shouldHandoff(input: {
  answerState: 'ANSWERED' | 'DATA_NOT_AVAILABLE' | 'HUMAN_REVIEW' | 'PRODUCT_NOT_IDENTIFIED';
  productIdentityClear: boolean;
  mentionsDiscount: boolean;
  mentionsNegotiation: boolean;
  isComplaint: boolean;
  conflictingData: boolean;
}): { handoff: boolean; reason: HandoffReason | null } {
  if (input.conflictingData) return { handoff: true, reason: 'conflicting_commercial_data' };
  if (input.mentionsDiscount) return { handoff: true, reason: 'discount_request' };
  if (input.mentionsNegotiation) return { handoff: true, reason: 'negotiation' };
  if (input.isComplaint) return { handoff: true, reason: 'complaint' };
  if (!input.productIdentityClear || input.answerState === 'PRODUCT_NOT_IDENTIFIED') return { handoff: true, reason: 'unclear_product_identity' };
  if (input.answerState === 'DATA_NOT_AVAILABLE') return { handoff: true, reason: 'insufficient_evidence' };
  if (input.answerState === 'HUMAN_REVIEW') return { handoff: true, reason: 'commercial_commitment' };
  return { handoff: false, reason: null };
}
