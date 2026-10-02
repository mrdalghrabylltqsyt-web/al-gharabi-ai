/**
 * Digital Sales — طبقة أحداث منظّمة آمنة الخصوصية (منطق خالص).
 *
 * الغرض: تسجيل أحداث تجارية ذات معنى كي تتعلّم منها الدفعة 4 — بلا بيانات شخصية
 * غير ضرورية، وبلا تعلّم من ادّعاءات بيع غير موثّقة، وبلا تحويل فرضية إلى حقيقة.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../../social/adapter';
import type { AttributionState } from './attribution';
import type { LeadStage } from './lead';

export type SalesEventType =
  | 'interaction'
  | 'purchase_signal'
  | 'lead_created'
  | 'qualification'
  | 'human_handoff'
  | 'follow_up_prepared'
  | 'follow_up_executed'
  | 'request'
  | 'negotiation'
  | 'lost'
  | 'unresolved'
  | 'verified_sale';

export const SALES_EVENT_LABELS_AR: Record<SalesEventType, string> = Object.freeze({
  interaction: 'تفاعل',
  purchase_signal: 'إشارة شراء',
  lead_created: 'إنشاء عميل محتمل',
  qualification: 'تأهيل',
  human_handoff: 'تسليم بشري',
  follow_up_prepared: 'تحضير متابعة',
  follow_up_executed: 'تنفيذ متابعة',
  request: 'طلب',
  negotiation: 'تفاوض',
  lost: 'خسارة',
  unresolved: 'غير محسوم',
  verified_sale: 'بيع موثّق',
});

export interface SalesEvent {
  eventId: string;
  type: SalesEventType;
  at: string;
  platform: PlatformId | 'cross_platform' | null;
  productId: string | null;
  leadId: string | null;
  campaignId: string | null;
  /** المفتاح المحلي للعميل — بلا بيانات شخصية. */
  customerKey: string | null;
  previousState: LeadStage | null;
  newState: LeadStage | null;
  evidence: string[];
  attribution: AttributionState | null;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  humanIntervention: boolean;
  outcome: string | null;
  /** هل الحدث صالح للتعلّم؟ أحداث البيع غير الموثّقة غير صالحة. */
  learningEligible: boolean;
}

/** أحداث لا تُعلَّم منها الدفعة 4 إلا إن كانت موثّقة فعلاً. */
const LEARNING_ELIGIBLE_TYPES: readonly SalesEventType[] = Object.freeze([
  'interaction', 'purchase_signal', 'lead_created', 'qualification', 'human_handoff',
  'follow_up_prepared', 'request', 'negotiation', 'lost', 'unresolved', 'verified_sale',
]);

/** الحقول الشخصية الممنوعة في الأحداث. */
export const EVENT_FORBIDDEN_FIELDS: readonly string[] = Object.freeze([
  'name', 'phone', 'email', 'address', 'national_id', 'age', 'gender', 'religion',
]);

/**
 * يُنشئ حدثاً منظّماً. لا يُعلَّم من ادّعاء بيع بلا معرّف بيع حقيقي؛ وبيع موثّق
 * يتطلّب دليل معرّف بيع.
 */
export function recordSalesEvent(input: {
  eventId: string;
  type: SalesEventType;
  platform?: PlatformId | 'cross_platform' | null;
  productId?: string | null;
  leadId?: string | null;
  campaignId?: string | null;
  customerKey?: string | null;
  previousState?: LeadStage | null;
  newState?: LeadStage | null;
  evidence?: string[];
  attribution?: AttributionState | null;
  reason: string;
  confidence?: 'high' | 'medium' | 'low';
  humanIntervention?: boolean;
  outcome?: string | null;
  /** معرّف بيع حقيقي — إلزامي لأحداث البيع الموثّق. */
  saleId?: string | null;
  nowMs: number;
}): { ok: true; event: SalesEvent } | { ok: false; code: string; error: string } {
  const evidence = Array.isArray(input.evidence) ? [...input.evidence] : [];
  if (input.type === 'verified_sale' && !input.saleId) {
    return { ok: false, code: 'NO_SALE_ID', error: 'لا حدث بيع موثّق بلا معرّف بيع حقيقي.' };
  }
  // لا تعلّم من حدث بيع بلا دليل معرّف بيع.
  const learningEligible =
    LEARNING_ELIGIBLE_TYPES.includes(input.type) &&
    (input.type !== 'verified_sale' || Boolean(input.saleId)) &&
    !(input.type === 'verified_sale' && evidence.length === 0);

  return {
    ok: true,
    event: {
      eventId: input.eventId,
      type: input.type,
      at: new Date(input.nowMs).toISOString(),
      platform: input.platform ?? null,
      productId: input.productId ?? null,
      leadId: input.leadId ?? null,
      campaignId: input.campaignId ?? null,
      customerKey: input.customerKey ?? null,
      previousState: input.previousState ?? null,
      newState: input.newState ?? null,
      evidence,
      attribution: input.attribution ?? null,
      reason: input.reason,
      confidence: input.confidence || 'medium',
      humanIntervention: Boolean(input.humanIntervention),
      outcome: input.outcome ?? null,
      learningEligible,
    },
  };
}

/**
 * يُنقّي حدثاً من أي حقل شخصي ممنوع قبل الحفظ. يُعيد الحقول المحذوفة للتفسير.
 */
export function stripSensitiveEventFields(event: Record<string, any>): { event: Record<string, any>; stripped: string[] } {
  const clone: Record<string, any> = { ...event };
  const stripped: string[] = [];
  for (const f of EVENT_FORBIDDEN_FIELDS) {
    if (f in clone) { delete clone[f]; stripped.push(f); }
  }
  return { event: clone, stripped };
}

/** ملخّص آمن للأحداث للتعلّم (بلا بيانات شخصية). */
export function summarizeSalesEvents(events: SalesEvent[]): {
  total: number;
  byType: Record<string, number>;
  learningEligible: number;
  verifiedSales: number;
} {
  const byType: Record<string, number> = {};
  let learningEligible = 0;
  let verifiedSales = 0;
  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    if (e.learningEligible) learningEligible += 1;
    if (e.type === 'verified_sale') verifiedSales += 1;
  }
  return { total: events.length, byType, learningEligible, verifiedSales };
}
