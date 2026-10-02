/**
 * Digital Sales — خطّ العملاء المحتملين + التأهيل + انتقالات الحالة (منطق خالص).
 *
 * الغرض: تحويل إشارة الشراء إلى عميل محتمل مؤهّل ثم طلب ثم بيع موثّق — **بلا أي
 * تغيير حالة بلا دليل**. كل انتقال يسجّل: الحالة السابقة، الجديدة، الوقت، الدليل،
 * السبب، المصدر، الثقة، وتدخّل الإنسان إن وُجد.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../../social/adapter';

/** خطّ العملاء المحتملين. لا تُدمج المراحل: لكل منها دليلها. */
export type LeadStage =
  | 'NEW_SIGNAL'
  | 'QUALIFIED_LEAD'
  | 'FOLLOW_UP'
  | 'REQUEST'
  | 'NEGOTIATION'
  | 'VERIFIED_SALE'
  | 'LOST'
  | 'UNRESOLVED';

export const LEAD_STAGE_LABELS_AR: Record<LeadStage, string> = Object.freeze({
  NEW_SIGNAL: 'إشارة جديدة',
  QUALIFIED_LEAD: 'عميل محتمل مؤهّل',
  FOLLOW_UP: 'متابعة',
  REQUEST: 'طلب',
  NEGOTIATION: 'تفاوض',
  VERIFIED_SALE: 'بيع موثّق',
  LOST: 'خسارة',
  UNRESOLVED: 'غير محسوم',
});

export const LEAD_TERMINAL_STAGES: readonly LeadStage[] = Object.freeze(['VERIFIED_SALE', 'LOST', 'UNRESOLVED']);

/** ترتيب التقدّم الطبيعي (البيع ليس «درجة» بل حالة نهائية موثّقة). */
export const LEAD_FORWARD_ORDER: readonly LeadStage[] = Object.freeze([
  'NEW_SIGNAL', 'QUALIFIED_LEAD', 'FOLLOW_UP', 'REQUEST', 'NEGOTIATION',
]);

/** الحالات التي تسمح بالانتقال (من → إلى). */
const ALLOWED_TRANSITIONS: Record<LeadStage, readonly LeadStage[]> = Object.freeze({
  NEW_SIGNAL: ['QUALIFIED_LEAD', 'LOST', 'UNRESOLVED'],
  QUALIFIED_LEAD: ['FOLLOW_UP', 'REQUEST', 'NEGOTIATION', 'LOST', 'UNRESOLVED'],
  FOLLOW_UP: ['REQUEST', 'NEGOTIATION', 'LOST', 'UNRESOLVED'],
  REQUEST: ['NEGOTIATION', 'VERIFIED_SALE', 'LOST', 'UNRESOLVED'],
  NEGOTIATION: ['VERIFIED_SALE', 'LOST', 'UNRESOLVED'],
  VERIFIED_SALE: [],
  LOST: [],
  UNRESOLVED: [],
});

export type QualificationOutcome = 'NOT_ENOUGH_EVIDENCE' | 'QUALIFIED' | 'NEEDS_HUMAN_REVIEW';

export const QUALIFICATION_LABELS_AR: Record<QualificationOutcome, string> = Object.freeze({
  NOT_ENOUGH_EVIDENCE: 'الأدلة غير كافية',
  QUALIFIED: 'مؤهّل',
  NEEDS_HUMAN_REVIEW: 'يحتاج مراجعة بشرية',
});

export interface LeadEvidence {
  code: string;
  labelAr: string;
  source: string;
  weight: number;
}

export interface LeadTransition {
  from: LeadStage;
  to: LeadStage;
  at: string;
  evidence: string[];
  reason: string;
  source: string;
  confidence: 'high' | 'medium' | 'low';
  humanIntervention: boolean;
}

export interface LeadRecord {
  leadId: string;
  stage: LeadStage;
  platform: PlatformId | 'cross_platform';
  customerKey: string | null;
  productId: string | null;
  campaignId: string | null;
  conversationId: string | null;
  qualification: QualificationOutcome;
  /** الأدلة التي أدّت للتأهيل (تفسّر أي رقم). */
  evidence: LeadEvidence[];
  /** سجل الانتقالات الكامل — تدقيق لا يُحذف. */
  history: LeadTransition[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// التأهيل
// ---------------------------------------------------------------------------

/** عناصر الأدلة المتاحة للتأهيل (تُقرأ من إشارة الشراء/السياق، لا تُخترع). */
export interface QualificationEvidenceInput {
  purchaseSignal: boolean;
  productIdentified: boolean;
  priceRequested: boolean;
  availabilityRequested: boolean;
  installmentRequested: boolean;
  buyingTimeframe: boolean;
  requestToPurchase: boolean;
  reliableIdentity: boolean;
  conversationProgressed: boolean;
}

/** أوزان صريحة قابلة للتدقيق — لا «درجة تسويقية» اعتباطية. */
export const QUALIFICATION_WEIGHTS: Readonly<Record<keyof QualificationEvidenceInput, number>> = Object.freeze({
  requestToPurchase: 30,
  purchaseSignal: 20,
  productIdentified: 15,
  buyingTimeframe: 10,
  installmentRequested: 8,
  priceRequested: 5,
  availabilityRequested: 5,
  reliableIdentity: 5,
  conversationProgressed: 2,
});

export const QUALIFICATION_THRESHOLDS = Object.freeze({ qualified: 45, needsReview: 25 });

export interface QualificationResult {
  outcome: QualificationOutcome;
  /** درجة مفسَّرة قابلة للتدقيق (مجموع الأوزان المتحققة). */
  score: number;
  maxScore: number;
  evidence: LeadEvidence[];
  missing: string[];
  reason: string;
  limitations: string[];
}

const EVIDENCE_LABELS: Record<keyof QualificationEvidenceInput, string> = {
  purchaseSignal: 'إشارة شراء مؤكّدة',
  productIdentified: 'منتج محدّد',
  priceRequested: 'طلب السعر',
  availabilityRequested: 'طلب التوفر',
  installmentRequested: 'طلب التقسيط',
  buyingTimeframe: 'إطار زمني للشراء',
  requestToPurchase: 'طلب شراء صريح',
  reliableIdentity: 'هوية موثوقة',
  conversationProgressed: 'تقدّم في المحادثة',
};

/**
 * يؤهّل العميل بالأدلة. **لا** مؤهّل بلا إشارة شراء؛ ويحتاج إمّا طلب شراء صريحاً
 * أو منتجاً محدّداً. إذا توفّر دليل لكن بلا حسم، يُعلن `NEEDS_HUMAN_REVIEW`.
 */
export function qualifyLead(input: QualificationEvidenceInput): QualificationResult {
  const keys = Object.keys(QUALIFICATION_WEIGHTS) as Array<keyof QualificationEvidenceInput>;
  const evidence: LeadEvidence[] = [];
  let score = 0;
  const missing: string[] = [];
  for (const k of keys) {
    if (input[k]) {
      const weight = QUALIFICATION_WEIGHTS[k];
      score += weight;
      evidence.push({ code: k, labelAr: EVIDENCE_LABELS[k], source: 'qualification_evidence', weight });
    } else {
      missing.push(EVIDENCE_LABELS[k]);
    }
  }
  const maxScore = keys.reduce((s, k) => s + QUALIFICATION_WEIGHTS[k], 0);

  // قاعدة صلبة: بلا إشارة شراء = لا تأهيل (مهما تراكم الباقي).
  if (!input.purchaseSignal) {
    return {
      outcome: 'NOT_ENOUGH_EVIDENCE', score, maxScore, evidence, missing,
      reason: 'لا إشارة شراء — لا يُؤهَّل العميل.',
      limitations: ['التأهيل يتطلّب إشارة شراء حقيقية.'],
    };
  }
  // بلا منتج محدّد وبلا طلب شراء صريح ⇒ مراجعة بشرية.
  const decisive = input.productIdentified || input.requestToPurchase;
  if (!decisive) {
    return {
      outcome: 'NEEDS_HUMAN_REVIEW', score, maxScore, evidence, missing,
      reason: 'إشارة شراء موجودة لكن بلا منتج محدّد ولا طلب شراء صريح.',
      limitations: ['يحتاج تأكيد بشري لتحديد المنتج/الطلب.'],
    };
  }
  if (score >= QUALIFICATION_THRESHOLDS.qualified) {
    return {
      outcome: 'QUALIFIED', score, maxScore, evidence, missing,
      reason: `الأدلة كافية للتأهيل (درجة ${score} من ${maxScore}).`,
      limitations: ['التأهيل ليس بيعاً — البيع يحتاج سجل بيع موثّق.'],
    };
  }
  return {
    outcome: 'NEEDS_HUMAN_REVIEW', score, maxScore, evidence, missing,
    reason: `أدلة جزئية (درجة ${score} دون حدّ التأهيل ${QUALIFICATION_THRESHOLDS.qualified}).`,
    limitations: ['يحتاج دليلاً إضافياً أو مراجعة بشرية.'],
  };
}

// ---------------------------------------------------------------------------
// انتقالات الحالة
// ---------------------------------------------------------------------------

/** يحسب انتقالاً مبرّراً، أو يرفضه بلا دليل/مسار مسموح. */
export function planLeadTransition(input: {
  lead: LeadRecord;
  to: LeadStage;
  evidence: string[];
  reason: string;
  source: string;
  confidence?: 'high' | 'medium' | 'low';
  humanIntervention?: boolean;
  /** معرّف بيع حقيقي إلزامي للانتقال إلى VERIFIED_SALE. */
  saleId?: string | null;
  nowMs: number;
}): { ok: true; transition: LeadTransition; next: LeadRecord } | { ok: false; error: string; code: string } {
  const { lead, to } = input;
  const at = new Date(input.nowMs).toISOString();

  if (lead.stage === to) return { ok: false, error: 'الحالة الحالية هي نفسها المطلوبة.', code: 'NO_CHANGE' };
  if (LEAD_TERMINAL_STAGES.includes(lead.stage)) return { ok: false, error: `الحالة النهائية (${lead.stage}) لا تُنقض.`, code: 'TERMINAL_STATE' };
  if (!input.evidence || input.evidence.length === 0) return { ok: false, error: 'لا انتقال بلا دليل.', code: 'NO_EVIDENCE' };
  // لا بيع موثّق بلا معرّف بيع حقيقي — يُفحص قبل شرعية المسار ليُعلن السبب الدقيق.
  if (to === 'VERIFIED_SALE' && !input.saleId) return { ok: false, error: 'لا بيع موثّق بلا معرّف بيع حقيقي من السجل التجاري.', code: 'NO_SALE_ID' };
  if (!ALLOWED_TRANSITIONS[lead.stage].includes(to)) return { ok: false, error: `الانتقال ${lead.stage} → ${to} غير مسموح.`, code: 'ILLEGAL_TRANSITION' };

  const transition: LeadTransition = {
    from: lead.stage, to, at, evidence: [...input.evidence], reason: input.reason, source: input.source,
    confidence: input.confidence || 'medium', humanIntervention: Boolean(input.humanIntervention),
  };
  const next: LeadRecord = {
    ...lead,
    stage: to,
    history: [...lead.history, transition],
    updatedAt: at,
  };
  return { ok: true, transition, next };
}

/** ينشئ عميلاً محتملاً من إشارة شراء مؤهّلة. لا يُنشأ بلا إشارة. */
export function createLeadFromSignal(input: {
  leadId: string;
  platform: PlatformId | 'cross_platform';
  customerKey: string | null;
  productId: string | null;
  campaignId?: string | null;
  conversationId?: string | null;
  purchaseSignal: boolean;
  evidence: string[];
  reason: string;
  nowMs: number;
}): { ok: true; lead: LeadRecord } | { ok: false; code: string; error: string } {
  if (!input.purchaseSignal) return { ok: false, code: 'NO_PURCHASE_SIGNAL', error: 'لا يُنشأ عميل محتمل بلا إشارة شراء.' };
  if (!input.evidence.length) return { ok: false, code: 'NO_EVIDENCE', error: 'لا يُنشأ عميل محتمل بلا دليل.' };
  const at = new Date(input.nowMs).toISOString();
  const lead: LeadRecord = {
    leadId: input.leadId,
    stage: 'NEW_SIGNAL',
    platform: input.platform,
    customerKey: input.customerKey,
    productId: input.productId,
    campaignId: input.campaignId ?? null,
    conversationId: input.conversationId ?? null,
    qualification: 'NOT_ENOUGH_EVIDENCE',
    evidence: [],
    history: [{
      from: 'NEW_SIGNAL', to: 'NEW_SIGNAL', at, evidence: [...input.evidence],
      reason: input.reason, source: 'purchase_signal', confidence: 'medium', humanIntervention: false,
    }],
    createdAt: at,
    updatedAt: at,
  };
  return { ok: true, lead };
}

// ---------------------------------------------------------------------------
// أسباب الخسارة / عدم الحسم (بلا اختراع سبب)
// ---------------------------------------------------------------------------

export type LostReason =
  | 'price_resistance'
  | 'product_unavailable'
  | 'installment_issue'
  | 'customer_stopped_responding'
  | 'selected_another_product'
  | 'delayed_purchase'
  | 'insufficient_information'
  | 'weak_follow_up'
  | 'unknown';

export const LOST_REASON_LABELS_AR: Record<LostReason, string> = Object.freeze({
  price_resistance: 'مقاومة سعرية',
  product_unavailable: 'المنتج غير متوفر',
  installment_issue: 'مشكلة في التقسيط',
  customer_stopped_responding: 'توقّف العميل عن الرد',
  selected_another_product: 'اختار منتجاً آخر',
  delayed_purchase: 'تأجيل الشراء',
  insufficient_information: 'معلومات غير كافية',
  weak_follow_up: 'متابعة ضعيفة',
  unknown: 'سبب غير معروف',
});

/**
 * يصنّف سبب الخسارة **من دليل حقيقي فقط**. غياب الدليل ⇒ `unknown` (لا يُخترع).
 */
export function classifyLostReason(input: {
  evidenceCodes: string[];
  hadFollowUp: boolean;
  customerResponded: boolean;
}): { reason: LostReason; confidence: 'high' | 'medium' | 'low'; evidence: string[] } {
  const codes = new Set(input.evidenceCodes || []);
  const has = (...c: string[]) => c.some((x) => codes.has(x));
  if (has('price_objection', 'too_expensive', 'asked_discount')) return { reason: 'price_resistance', confidence: 'high', evidence: ['price_objection'] };
  if (has('out_of_stock', 'product_unavailable')) return { reason: 'product_unavailable', confidence: 'high', evidence: ['out_of_stock'] };
  if (has('installment_rejected', 'installment_issue')) return { reason: 'installment_issue', confidence: 'high', evidence: ['installment_issue'] };
  if (has('chose_other', 'selected_other_product')) return { reason: 'selected_another_product', confidence: 'medium', evidence: ['chose_other'] };
  if (has('delayed', 'not_now')) return { reason: 'delayed_purchase', confidence: 'medium', evidence: ['delayed'] };
  if (has('insufficient_info', 'data_unavailable')) return { reason: 'insufficient_information', confidence: 'medium', evidence: ['insufficient_info'] };
  if (!input.customerResponded) return { reason: 'customer_stopped_responding', confidence: 'medium', evidence: ['no_response'] };
  if (!input.hadFollowUp) return { reason: 'weak_follow_up', confidence: 'low', evidence: ['no_follow_up'] };
  return { reason: 'unknown', confidence: 'low', evidence: [] };
}
