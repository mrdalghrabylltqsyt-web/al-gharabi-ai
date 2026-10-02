/**
 * Customer Lifecycle Intelligence + Lead Prioritization + Follow-up Learning
 * (منطق خالص).
 *
 * الغرض:
 *   - دورة حياة العميل الكاملة (PROSPECT → … → POST_SALE → REPEAT/CROSS-SELL) بلا اختراع
 *     تكرار شراء أو رضا أو نية مستقبلية.
 *   - ترتيب أولويات العملاء بأدلة **قابلة للتفسير** (لا درجة عشوائية).
 *   - التعلّم من نتائج المتابعة مع احترام الموافقة/الإلغاء/التكرار/الخصوصية.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر `nowMs`.
 */

import type { LeadStage } from '../digital/lead';

export type LifecycleStage =
  | 'PROSPECT' | 'LEAD' | 'REQUEST' | 'CUSTOMER' | 'VERIFIED_SALE'
  | 'POST_SALE' | 'REPEAT_OPPORTUNITY' | 'CROSS_SELL_OPPORTUNITY';

export const LIFECYCLE_STAGE_LABELS_AR: Record<LifecycleStage, string> = Object.freeze({
  PROSPECT: 'مهتم',
  LEAD: 'عميل محتمل',
  REQUEST: 'طلب',
  CUSTOMER: 'عميل',
  VERIFIED_SALE: 'بيع موثّق',
  POST_SALE: 'بعد البيع',
  REPEAT_OPPORTUNITY: 'فرصة شراء متكرّر (بدليل)',
  CROSS_SELL_OPPORTUNITY: 'فرصة بيع متقاطع (بدليل)',
});

export interface LifecycleInput {
  leadId: string;
  stage: LeadStage;
  /** معرّف بيع موثّق حقيقي (للتقدّم إلى CUSTOMER/VERIFIED_SALE/POST_SALE). */
  verifiedSaleId: string | null;
  /** موافقة صريحة للتواصل التسويقي (لازم لأي فرصة تكرار/بيع متقاطع). */
  marketingConsent: boolean;
  optedOut: boolean;
  /** دليل تكرار شراء حقيقي (بيعان موثّقان لنفس العميل). */
  verifiedPurchaseCount: number;
  /** منتجات اشتراها فعلاً (لمنع اختراع تقاطع). */
  purchasedProductIds: string[];
  /** منتج يُطلبه فعلاً وليس ضمن مشترياته (دليل بيع متقاطع). */
  requestedProductId: string | null;
}

export interface LifecycleState {
  leadId: string;
  stage: LifecycleStage;
  stageLabelAr: string;
  reason: string;
  evidence: string[];
  /** فرصة تكرار/تقاطع تُقترح **فقط** عند دليل + موافقة. */
  repeatOpportunity: boolean;
  crossSellOpportunity: boolean;
  limitations: string[];
}

/**
 * يحسم مرحلة دورة الحياة. **لا** يُعلن تكرار شراء أو رضا أو نية مستقبلية بلا دليل،
 * ولا فرصة تكرار/تقاطع بلا موافقة.
 */
export function resolveLifecycle(input: LifecycleInput): LifecycleState {
  const evidence: string[] = [];
  const limitations: string[] = [];
  let stage: LifecycleStage;
  let reason: string;

  if (input.verifiedSaleId) {
    evidence.push(`saleId=${input.verifiedSaleId}`);
    stage = 'VERIFIED_SALE';
    reason = 'بيع موثّق بمعرّف حقيقي.';
  } else if (input.stage === 'REQUEST' || input.stage === 'NEGOTIATION') {
    stage = 'REQUEST'; reason = 'طلب/تفاوض جارٍ بلا بيع موثّق.';
  } else if (input.stage === 'QUALIFIED_LEAD' || input.stage === 'FOLLOW_UP') {
    stage = 'LEAD'; reason = 'عميل محتمل مؤهّل بلا طلب بعد.';
  } else {
    stage = 'PROSPECT'; reason = 'تفاعل بلا إشارة شراء مؤهّلة.';
  }

  const repeat = input.verifiedSaleId !== null && input.verifiedPurchaseCount >= 2;
  if (repeat) { stage = 'POST_SALE'; evidence.push(`مشتريات موثّقة=${input.verifiedPurchaseCount}`); reason = 'مشتريات متعدّدة موثّقة.'; }

  const consentOk = input.marketingConsent && !input.optedOut;
  if (!consentOk) limitations.push('لا فرصة تكرار/تقاطع بلا موافقة تسويقية صريحة وبلا إلغاء.');

  const repeatOpportunity = repeat && consentOk && input.verifiedPurchaseCount >= 2;
  const crossSellOpportunity = Boolean(consentOk && input.requestedProductId && !input.purchasedProductIds.includes(input.requestedProductId));
  if (crossSellOpportunity) evidence.push(`طلب منتج غير مُشترى=${input.requestedProductId}`);

  if (repeatOpportunity) stage = 'REPEAT_OPPORTUNITY';
  if (crossSellOpportunity) stage = 'CROSS_SELL_OPPORTUNITY';

  limitations.push('لا يُفترض الرضا ولا نية شراء مستقبلية — الفرص من دليل حقيقي + موافقة فقط.');
  return {
    leadId: input.leadId,
    stage, stageLabelAr: LIFECYCLE_STAGE_LABELS_AR[stage], reason, evidence,
    repeatOpportunity, crossSellOpportunity, limitations,
  };
}

// ---------------------------------------------------------------------------
// ترتيب أولويات العملاء (§10)
// ---------------------------------------------------------------------------

export interface LeadPriorityInput {
  leadId: string;
  /** عناصر الأدلة (boolean = دليل متوفّر/غائب). */
  purchaseIntent: boolean;
  productCertainty: boolean;
  requestCompleteness: number; // 0..1
  buyingTimeframe: 'immediate' | 'soon' | 'later' | 'unknown';
  availabilityKnown: boolean;
  priceInstallmentInterest: boolean;
  hasPriorInteraction: boolean;
  followUpCount: number;
  unresolvedBlocker: boolean;
}

export interface LeadPriority {
  leadId: string;
  priority: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
  score: number;
  /** تفسير قابل للتدقيق لكل عنصر. */
  breakdown: Array<{ factor: string; value: string; points: number }>;
  reason: string;
}

/**
 * يرتّب أولوية العميل بأوزان صريحة موثّقة. كل نقطة لها تفسير — لا درجة عشوائية.
 */
export function prioritizeLead(input: LeadPriorityInput): LeadPriority {
  const breakdown: LeadPriority['breakdown'] = [];
  const add = (factor: string, value: string, points: number) => { breakdown.push({ factor, value, points }); return points; };
  let score = 0;
  score += add('نية الشراء', input.purchaseIntent ? 'موجودة' : 'غائبة', input.purchaseIntent ? 30 : 0);
  score += add('يقين المنتج', input.productCertainty ? 'مؤكّد' : 'غير مؤكّد', input.productCertainty ? 15 : 0);
  score += add('اكتمال الطلب', `${Math.round(input.requestCompleteness * 100)}%`, Math.round(input.requestCompleteness * 15));
  const tf = input.buyingTimeframe === 'immediate' ? 20 : input.buyingTimeframe === 'soon' ? 12 : input.buyingTimeframe === 'later' ? 5 : 0;
  score += add('إطار الشراء', input.buyingTimeframe, tf);
  score += add('التوفّر معروف', input.availabilityKnown ? 'نعم' : 'لا', input.availabilityKnown ? 5 : 0);
  score += add('اهتمام سعر/تقسيط', input.priceInstallmentInterest ? 'نعم' : 'لا', input.priceInstallmentInterest ? 10 : 0);
  score += add('تفاعل سابق', input.hasPriorInteraction ? 'نعم' : 'لا', input.hasPriorInteraction ? 5 : 0);
  score += add('عدد المتابعات', String(input.followUpCount), input.followUpCount > 0 ? 5 : 0);
  score += add('مانع غير محسوم', input.unresolvedBlocker ? 'يوجد' : 'لا يوجد', input.unresolvedBlocker ? 8 : 0);

  const priority = score >= 70 ? 'URGENT' : score >= 45 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW';
  return {
    leadId: input.leadId, priority, score, breakdown,
    reason: `الدرجة ${score} من ${breakdown.map((b) => `${b.factor}=${b.points}`).join(' + ')}.`,
  };
}

// ---------------------------------------------------------------------------
// التعلّم من نتائج المتابعة (§11)
// ---------------------------------------------------------------------------

export type FollowUpOutcome = 'RESPONDED' | 'NO_RESPONSE' | 'LED_TO_REQUEST' | 'LED_TO_SALE' | 'LOST' | 'UNRESOLVED';

export const FOLLOW_UP_OUTCOME_LABELS_AR: Record<FollowUpOutcome, string> = Object.freeze({
  RESPONDED: 'استجاب',
  NO_RESPONSE: 'لا استجابة',
  LED_TO_REQUEST: 'أدّى إلى طلب',
  LED_TO_SALE: 'أدّى إلى بيع',
  LOST: 'خسارة',
  UNRESOLVED: 'غير محسوم',
});

export interface FollowUpOutcomeRecord {
  followUpId: string;
  leadId: string;
  outcome: FollowUpOutcome;
  responseAt: string | null;
  sentAt: string;
  /** أيام حتى الاستجابة (null إن لا استجابة). */
  timeToResponseDays: number | null;
  failureReason: string | null;
  /** هل احتُرمت الموافقة/الإلغاء/التردد؟ */
  consentRespected: boolean;
  limitations: string[];
}

export interface FollowUpLearning {
  total: number;
  responseRate: number | null;
  conversionToSaleRate: number | null;
  averageTimeToResponseDays: number | null;
  successPatterns: string[];
  failureReasons: string[];
  privacyViolations: number;
  limitations: string[];
}

/**
 * يتعلّم من نتائج المتابعة. **لا** يُنشئ معدّلاً بمقام صفر (null عند غياب البيانات)،
 * ويعدّ أي خرق للخصوصية/الموافقة صراحةً.
 */
export function learnFromFollowUps(records: FollowUpOutcomeRecord[]): FollowUpLearning {
  const total = records.length;
  const responded = records.filter((r) => r.outcome !== 'NO_RESPONSE').length;
  const sales = records.filter((r) => r.outcome === 'LED_TO_SALE').length;
  const withResponseTime = records.filter((r) => r.timeToResponseDays !== null);
  const responseRate = total > 0 ? Math.round((responded / total) * 10_000) / 100 : null;
  const conversionToSaleRate = total > 0 ? Math.round((sales / total) * 10_000) / 100 : null;
  const averageTimeToResponseDays = withResponseTime.length
    ? Math.round((withResponseTime.reduce((s, r) => s + (r.timeToResponseDays as number), 0) / withResponseTime.length) * 100) / 100
    : null;

  const successPatterns: string[] = [];
  if (responded >= 3) successPatterns.push('المتابعة أدّت إلى استجابة في حالات مؤهّلة.');
  if (sales >= 1) successPatterns.push('متابعة أدّت إلى بيع موثّق (نمط يستحق التكرار باختبار).');

  const failureReasons = [...new Set(records.filter((r) => r.failureReason).map((r) => r.failureReason as string))];
  const privacyViolations = records.filter((r) => !r.consentRespected).length;

  return {
    total, responseRate, conversionToSaleRate, averageTimeToResponseDays,
    successPatterns, failureReasons, privacyViolations,
    limitations: [
      'المعدّلات null عند غياب البيانات (لا قسمة على صفر).',
      'لا سبام: تُحترم الموافقة/الإلغاء/التردد/قواعد المنصة.',
      privacyViolations > 0 ? `يوجد ${privacyViolations} سجل خرق للخصوصية — يلزم تصحيح فوري.` : 'لا خرق للخصوصية في السجلات.',
    ],
  };
}

export interface LifecycleSummary {
  total: number;
  byStage: Record<LifecycleStage, number>;
  repeatOpportunities: number;
  crossSellOpportunities: number;
  urgentLeads: number;
}

export function summarizeLifecycle(states: LifecycleState[], priorities: LeadPriority[]): LifecycleSummary {
  const byStage = Object.fromEntries(
    (Object.keys(LIFECYCLE_STAGE_LABELS_AR) as LifecycleStage[]).map((s) => [s, 0]),
  ) as Record<LifecycleStage, number>;
  for (const s of states) byStage[s.stage] = (byStage[s.stage] || 0) + 1;
  return {
    total: states.length,
    byStage,
    repeatOpportunities: states.filter((s) => s.repeatOpportunity).length,
    crossSellOpportunities: states.filter((s) => s.crossSellOpportunity).length,
    urgentLeads: priorities.filter((p) => p.priority === 'URGENT').length,
  };
}
