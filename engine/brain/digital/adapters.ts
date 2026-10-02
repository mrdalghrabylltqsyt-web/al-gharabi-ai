/**
 * Digital Sales — حدّ موصلات المنصات (Adapter Boundary) (منطق خالص).
 *
 * الغرض: تحديد ما يقدّمه الموصل **فقط**: تفاعل وارد، سياق محادثة، معرّفات المنصة/
 * العميل، وقدرة تنفيذ صادر. **لا منطق تجاري داخل الموصل** — العقل المركزي هو
 * الوحيد الذي يملك الحقيقة التجارية.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../../social/adapter';

/** ما يجوز للموصل أن يقدّمه — لا أكثر. */
export interface IncomingInteraction {
  platform: PlatformId;
  externalId: string;
  text: string;
  /** معرّف عميل المنصة (إن وُجد) — بلا بيانات شخصية إضافية. */
  platformCustomerId?: string | null;
  conversationId?: string | null;
  /** معرّف منتج صريح من السياق إن وُجد (لا يُستنتج من النص هنا). */
  productRef?: string | null;
  campaignRef?: string | null;
  at: string;
}

export interface ConversationContext {
  conversationId: string | null;
  platform: PlatformId;
  platformCustomerId: string | null;
  /** عدد الرسائل السابقة (لقياس التقدّم) — لا محتواها الحسّاس. */
  priorMessages: number;
  priorProductQuestions: number;
  /** هل هذه أول رسالة؟ */
  isFirstMessage: boolean;
}

/** قدرة التنفيذ الصادر — تُقرأ من العقل، ولا تُنفّذ إلا بموافقة. */
export interface OutboundCapability {
  platform: PlatformId;
  canSendMessage: boolean;
  canPublish: boolean;
  /** هل الاتصال موثّق فعلاً من المزود؟ (Capability ≠ Connection ≠ Verification) */
  providerVerified: boolean;
}

/** عقد موصل المنصات — لا منطق تجاري هنا. */
export interface PlatformSalesAdapter {
  platform: PlatformId;
  /** يستقبل تفاعلاً ويطبّعه — بلا قرار تجاري. */
  toIncomingInteraction(raw: Record<string, unknown>): IncomingInteraction | null;
  /** يبني سياق المحادثة من بيانات المنصة فقط. */
  buildContext(input: IncomingInteraction): ConversationContext;
  /** يعلن قدرة التنفيذ الحقيقية. */
  outboundCapability(): OutboundCapability;
}

/** ما يُمنع أن يوجد في أي موصل (منطق تجاري). */
export const FORBIDDEN_ADAPTER_RESPONSIBILITIES: readonly string[] = Object.freeze([
  'product_identification',
  'price_lookup',
  'installment_calculation',
  'purchase_intent_decision',
  'lead_qualification',
  'offer_verification',
  'follow_up_decision',
  'human_handoff_decision',
  'attribution',
  'sales_state',
  'commercial_reasoning',
]);

/**
 * يتحقق أن موصلاً لا يعلن أي مسؤولية تجارية محظورة. يُستخدم في الاختبارات
 * كحرس حدود صريح.
 */
export function assertAdapterBoundary(declaredResponsibilities: string[]): { ok: boolean; violations: string[] } {
  const violations = (declaredResponsibilities || []).filter((r) => FORBIDDEN_ADAPTER_RESPONSIBILITIES.includes(r));
  return { ok: violations.length === 0, violations };
}

/** مصنع موصل بسيط يستقبل الدوال — للتجربة والاختبار بلا تكرار. */
export function createSalesAdapter(input: {
  platform: PlatformId;
  toIncoming: (raw: Record<string, unknown>) => IncomingInteraction | null;
  context: (i: IncomingInteraction) => ConversationContext;
  outbound: () => OutboundCapability;
}): PlatformSalesAdapter {
  return {
    platform: input.platform,
    toIncomingInteraction: input.toIncoming,
    buildContext: input.context,
    outboundCapability: input.outbound,
  };
}
