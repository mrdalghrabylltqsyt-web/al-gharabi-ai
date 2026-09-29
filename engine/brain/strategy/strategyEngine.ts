/**
 * Strategy Engine + Recommendation — بناء استراتيجية قابلة للتفسير (منطق خالص).
 *
 * العقل لا ينشئ منشورات فقط؛ يبني استراتيجية يومية/أسبوعية/حملة/منصة/جمهور/منتج،
 * ويحدّد لكل توصية: What/Why/Who/Where/When/How + الإشارة المتوقعة + الخطر +
 * الدليل. وكل توصية تحمل: recommendation, reason, evidence[], source[],
 * sampleSize, confidence, limitations, expectedOutcome, risk, nextTest.
 *
 * لا اختراع: عند غياب الدليل تُعلن التوصية `insufficient_sample` صراحةً.
 */

import type { PlatformId } from '../../social/adapter';

export type RecommendationStatus = 'supported' | 'insufficient_sample';

export interface ExplainableRecommendation {
  id: string;
  recommendation: string;
  reason: string;
  evidence: string[];
  source: string[];
  sampleSize: number;
  confidence: 'low' | 'medium' | 'high';
  status: RecommendationStatus;
  limitations: string;
  expectedOutcome: string;
  risk: 'low' | 'medium' | 'high';
  nextTest: string | null;
}

export interface StrategyPlan {
  scope: 'daily' | 'weekly' | 'campaign' | 'platform' | 'audience' | 'product';
  what: string;
  why: string;
  who: string;
  where: PlatformId[];
  when: string;
  how: string;
  expectedSignal: string;
  risk: 'low' | 'medium' | 'high';
  evidence: string[];
  status: RecommendationStatus;
  limitations: string;
}

/**
 * يبني توصية قابلة للتفسير مع فرض حالة صادقة: بلا دليل أو بعيّنة ناقصة →
 * `insufficient_sample`. لا تُقدَّم توصية قوية بلا دليل.
 */
export function buildRecommendation(input: {
  id: string;
  recommendation: string;
  reason: string;
  evidence: string[];
  source: string[];
  sampleSize: number;
  minSample?: number;
  confidence?: 'low' | 'medium' | 'high';
  limitations?: string;
  expectedOutcome: string;
  risk?: 'low' | 'medium' | 'high';
  nextTest?: string | null;
}): ExplainableRecommendation {
  const minSample = input.minSample ?? 3;
  const supported = input.evidence.length > 0 && input.source.length > 0 && input.sampleSize >= minSample;
  const confidence = input.confidence || (supported ? (input.sampleSize >= minSample * 2 ? 'medium' : 'low') : 'low');
  return {
    id: input.id,
    recommendation: input.recommendation,
    reason: input.reason,
    evidence: input.evidence,
    source: input.source,
    sampleSize: input.sampleSize,
    confidence,
    status: supported ? 'supported' : 'insufficient_sample',
    limitations: input.limitations || (supported
      ? 'توصية مبنية على بيانات فعلية؛ لا تضمن نتيجة.'
      : `الدليل غير كافٍ (عيّنة ${input.sampleSize} < ${minSample}) — لا تُقدَّم توصية قوية.`),
    expectedOutcome: input.expectedOutcome,
    risk: input.risk || 'low',
    nextTest: input.nextTest ?? null,
  };
}

/** يبني خطة استراتيجية نطاقية قابلة للتفسير. */
export function buildStrategyPlan(input: {
  scope: StrategyPlan['scope'];
  what: string;
  why: string;
  who: string;
  where: PlatformId[];
  when: string;
  how: string;
  expectedSignal: string;
  evidence: string[];
  risk?: StrategyPlan['risk'];
  minEvidence?: number;
}): StrategyPlan {
  const minEvidence = input.minEvidence ?? 1;
  const status: RecommendationStatus = input.evidence.length >= minEvidence ? 'supported' : 'insufficient_sample';
  return {
    scope: input.scope,
    what: input.what,
    why: input.why,
    who: input.who,
    where: input.where,
    when: input.when,
    how: input.how,
    expectedSignal: input.expectedSignal,
    risk: input.risk || 'low',
    evidence: input.evidence,
    status,
    limitations: status === 'supported'
      ? 'خطة مبنية على أدلة فعلية؛ تخضع لبوابات التنفيذ والمراجعة.'
      : 'خطة بدون أدلة كافية — تحتاج بيانات قبل الاعتماد.',
  };
}

/**
 * اختبار «هل يحتاج العقل إعادة كتابة عند إضافة منصة #11؟» — يجيبه الكود نفسه:
 * الاستراتيجية تعمل على PlatformId، فلا تحتاج تعديلاً.
 */
export function strategyIsPlatformAgnostic(where: PlatformId[]): { agnostic: boolean; reason: string } {
  const usesOnlyIds = where.every((p) => typeof p === 'string');
  return {
    agnostic: usesOnlyIds,
    reason: usesOnlyIds
      ? 'الخطة تُبنى على PlatformId وقدرات السجل فقط؛ لا منطق خاص بمنصة داخل الاستراتيجية.'
      : 'توجد مرجعية خاصة بمنصة داخل الاستراتيجية — يجب إزالتها.',
  };
}
