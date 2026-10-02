/**
 * Market Opportunity Engine — أساس رصد الفرص السوقية بصدق معرفي (منطق خالص).
 *
 * الغرض: تحويل إشارات الطلب الحقيقية إلى **فرص** قابلة للتفسير، مع فصل صريح
 * بين ما هو **حقيقة ملاحَظة** وما هو **تفسير** وما هو **فرضية** وما هو **توصية**.
 * كل فرصة تحمل دليلها ومصدرها وفترتها وعيّنتها وثقتها وحدودها وإجراءً مقترحاً
 * ونتيجة متوقعة قابلة للقياس.
 *
 * **طبقة تحضير فقط**: لا تنفيذ ولا قرار نهائي ولا اختراع بيانات.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../../social/adapter';
import { type DemandAggregate, DEMAND_SIGNAL_LABELS_AR } from './demandSignals';

/**
 * الفصل المعرفي الملزم — لا يُدمج FACT مع HYPOTHESIS ولا مع RECOMMENDATION.
 * العقل يجب أن يقول صراحةً: «هذا ما رأيناه» / «هذا ما نستنتجه» / «هذه فرضية
 * تحتاج اختباراً» / «هذا ما نوصي به».
 */
export type EpistemicKind = 'FACT' | 'INTERPRETATION' | 'HYPOTHESIS' | 'RECOMMENDATION';

export const EPISTEMIC_LABELS_AR: Record<EpistemicKind, string> = Object.freeze({
  FACT: 'حقيقة ملاحَظة من بيانات',
  INTERPRETATION: 'تفسير مبني على الحقيقة',
  HYPOTHESIS: 'فرضية تحتاج اختباراً',
  RECOMMENDATION: 'توصية قابلة للتنفيذ',
});

export type OpportunityKind =
  | 'rising_category_demand'
  | 'repeated_product_request'
  | 'repeated_question'
  | 'recurring_objection'
  | 'missing_availability'
  | 'pricing_concern'
  | 'installment_concern'
  | 'content_opportunity'
  | 'audience_opportunity';

export const OPPORTUNITY_LABELS_AR: Record<OpportunityKind, string> = Object.freeze({
  rising_category_demand: 'ارتفاع طلب على فئة',
  repeated_product_request: 'طلب متكرر على منتج',
  repeated_question: 'سؤال متكرر',
  recurring_objection: 'اعتراض متكرر',
  missing_availability: 'منتج مطلوب غير متوفر',
  pricing_concern: 'تحفّظ على السعر',
  installment_concern: 'تحفّظ على التقسيط',
  content_opportunity: 'فرصة محتوى',
  audience_opportunity: 'فرصة جمهور',
});

/** مكوّن واحد للفرصة، موسوم بنوعه المعرفي (فصل صريح). */
export interface OpportunityComponent {
  epistemic: EpistemicKind;
  statement: string;
}

export interface MarketOpportunity {
  id: string;
  kind: OpportunityKind;
  platform: PlatformId | 'cross_platform';
  productId: string | null;
  /** المكوّنات مفصولة معرفياً — لا خلط. */
  fact: OpportunityComponent;
  interpretation: OpportunityComponent | null;
  hypothesis: OpportunityComponent;
  recommendation: OpportunityComponent;
  evidence: string[];
  source: string;
  periodDays: number | null;
  sampleSize: number;
  confidence: 'low' | 'medium' | 'high';
  /** هل بلغت العيّنة حدّ الكفاية لإعلان الفرصة؟ */
  sufficientSample: boolean;
  limitations: string;
  /** النتيجة المتوقعة القابلة للقياس (لا وعد). */
  expectedMeasurableOutcome: string;
  /** ما يحتاج موافقة/تدخّل المالك قبل أي تنفيذ. */
  requiresOwnerAction: boolean;
}

/** يحوّل تجميعة إشارة طلب إلى فرصة سوقية قابلة للتفسير — بلا اختراع. */
export function buildOpportunityFromDemand(input: {
  aggregate: DemandAggregate;
  platform?: PlatformId | 'cross_platform';
  /** هل المنتج مطلوب موثّق التوفر؟ غياب المعلومة ⇒ فرصة «توفر يحتاج تحقق». */
  availabilityVerified?: boolean;
  availabilityInStock?: boolean | null;
}): MarketOpportunity {
  const agg = input.aggregate;
  const label = DEMAND_SIGNAL_LABELS_AR[agg.kind];
  const productRef = agg.productId ? `المنتج ${agg.productId}` : 'منتج/موضوع غير محدّد';
  const period = agg.periodDays !== null ? `${agg.periodDays} يوماً` : 'فترة غير معروفة';

  let kind: OpportunityKind = 'repeated_question';
  if (agg.kind === 'installment_inquiry') kind = 'installment_concern';
  else if (agg.kind === 'price_inquiry') kind = 'pricing_concern';
  else if (agg.kind === 'availability_inquiry') kind = input.availabilityVerified && input.availabilityInStock === false ? 'missing_availability' : 'repeated_question';
  else if (agg.kind === 'objection') kind = 'recurring_objection';
  else if (agg.kind === 'product_request') kind = 'repeated_product_request';
  else if (agg.kind === 'purchase_intent') kind = 'rising_category_demand';

  const sufficient = agg.strength !== 'INSUFFICIENT_DATA';
  const factStatement = `${agg.count} إشارة ${label} على ${productRef} خلال ${period} (${agg.timedCount} موقّتة).`;
  const interpretation = sufficient
    ? `يبدو أن هناك اهتماماً حقيقياً بـ${productRef} يستحق محتوى/عرضاً موجّهاً.`
    : null;
  const hypothesis = `محتوى أو عرض واضح حول ${label}${agg.productId ? ` لـ${productRef}` : ''} سيرفع الإشارات المؤهّلة.`;
  const recommendation = kind === 'installment_concern' || kind === 'pricing_concern'
    ? 'وثّق السعر/عرض التقسيط الرسمي أولاً، ثم انشر شرحاً واضحاً بلا أرقام غير مسجّلة.'
    : 'أنشئ محتوى يجيب على هذا الطلب من بيانات المعرض الموثّقة فقط، مع دعوة للتواصل.';

  return {
    id: `opp:${agg.kind}:${agg.productId || 'general'}`,
    kind,
    platform: input.platform || 'cross_platform',
    productId: agg.productId,
    fact: { epistemic: 'FACT', statement: factStatement },
    interpretation: interpretation ? { epistemic: 'INTERPRETATION', statement: interpretation } : null,
    hypothesis: { epistemic: 'HYPOTHESIS', statement: hypothesis },
    recommendation: { epistemic: 'RECOMMENDATION', statement: recommendation },
    evidence: [...agg.evidence],
    source: agg.source,
    periodDays: agg.periodDays,
    sampleSize: agg.sampleSize,
    confidence: agg.confidence,
    sufficientSample: sufficient,
    limitations: agg.limitations,
    expectedMeasurableOutcome: 'زيادة الإشارات المؤهّلة (استفسارات/أسئلة) على المحتوى الجديد — تُقاس من التعليقات الفعلية.',
    requiresOwnerAction: kind === 'pricing_concern' || kind === 'installment_concern' || kind === 'missing_availability',
  };
}

/** فرصة محتوى مبنية على سؤال متكرر (بلا منتج محدّد). */
export function buildContentOpportunity(input: {
  platform: PlatformId | 'cross_platform';
  label: string;
  count: number;
  periodDays: number | null;
  source: string;
  sufficientSample: boolean;
  limitations: string;
}): MarketOpportunity {
  return {
    id: `opp:content:${input.label}`,
    kind: 'content_opportunity',
    platform: input.platform,
    productId: null,
    fact: { epistemic: 'FACT', statement: `${input.count} استفسار متكرر حول «${input.label}»${input.periodDays !== null ? ` خلال ${input.periodDays} يوماً` : ''}.` },
    interpretation: input.sufficientSample ? { epistemic: 'INTERPRETATION', statement: `الموضوع «${input.label}» يهمّ الجمهور فعلاً.` } : null,
    hypothesis: { epistemic: 'HYPOTHESIS', statement: `محتوى يشرح «${input.label}» سيلقى تفاعلاً ويولّد استفسارات أوضح.` },
    recommendation: { epistemic: 'RECOMMENDATION', statement: `أنشئ محتوى قصيراً يشرح «${input.label}» بلا أرقام غير مسجّلة.` },
    evidence: [`${input.count} إشارة حقيقية مصنّفة حول «${input.label}».`],
    source: input.source,
    periodDays: input.periodDays,
    sampleSize: input.count,
    confidence: input.count >= 9 ? 'high' : input.count >= 6 ? 'medium' : 'low',
    sufficientSample: input.sufficientSample,
    limitations: input.limitations,
    expectedMeasurableOutcome: 'ارتفاع أسئلة/استفسارات حول الموضوع — تُقاس من التعليقات الفعلية.',
    requiresOwnerAction: false,
  };
}

export interface OpportunitySummary {
  total: number;
  sufficient: number;
  insufficient: number;
  requiresOwnerAction: number;
  byKind: Record<string, number>;
  note: string;
}

/** ملخّص الفرص الصادق: يفصل ما له عيّنة كافية عمّا لا، ويُعلن ما يحتاج المالك. */
export function summarizeOpportunities(opportunities: MarketOpportunity[]): OpportunitySummary {
  const byKind: Record<string, number> = {};
  for (const o of opportunities) byKind[o.kind] = (byKind[o.kind] || 0) + 1;
  const sufficient = opportunities.filter((o) => o.sufficientSample).length;
  return {
    total: opportunities.length,
    sufficient,
    insufficient: opportunities.length - sufficient,
    requiresOwnerAction: opportunities.filter((o) => o.requiresOwnerAction).length,
    byKind,
    note: 'كل فرصة تفصل الحقيقة عن التفسير عن الفرضية عن التوصية؛ والعيّنة الناقصة تُعلن ولا تُخترع.',
  };
}

/**
 * تفرض الفصل المعرفي: لا فرصة بلا حقيقة ملاحَظة، ولا توصية تسبق فرضية. تُستخدم
 * كحرس في الاختبارات وفي الدفعة التالية.
 */
export function validateEpistemicSeparation(opportunity: MarketOpportunity): { valid: boolean; problems: string[] } {
  const problems: string[] = [];
  if (opportunity.fact.epistemic !== 'FACT') problems.push('fact يجب أن يكون FACT.');
  if (opportunity.hypothesis.epistemic !== 'HYPOTHESIS') problems.push('hypothesis يجب أن يكون HYPOTHESIS.');
  if (opportunity.recommendation.epistemic !== 'RECOMMENDATION') problems.push('recommendation يجب أن يكون RECOMMENDATION.');
  if (opportunity.interpretation && opportunity.interpretation.epistemic !== 'INTERPRETATION') problems.push('interpretation يجب أن يكون INTERPRETATION.');
  if (!opportunity.sufficientSample && opportunity.interpretation) problems.push('لا تفسير بلا عيّنة كافية.');
  if (!opportunity.evidence.length) problems.push('لا فرصة بلا دليل.');
  if (!opportunity.source) problems.push('لا فرصة بلا مصدر.');
  return { valid: problems.length === 0, problems };
}
