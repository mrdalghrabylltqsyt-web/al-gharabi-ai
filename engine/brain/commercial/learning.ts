/**
 * Learning Engine — محرّك التعلّم التجاري (منطق خالص).
 *
 * الغرض: تحويل النتائج **الموثّقة** إلى تعلّم منظّم قابل للتفسير، مع الفصل الصارم
 * بين ما نعرفه وما نفترضه. ويشمل:
 *   - دورة التعلّم (HYPOTHESIS → ACTION → RESULT → COMPARISON → INTERPRETATION → LEARNING)
 *   - التعلّم من الفشل (بأسباب بديلة واختبار تالٍ)
 *   - تحليل تغيّر المبيعات/الطلب/التحويل
 *   - التوقّع مقابل الواقع (CORRECT / OVER / UNDER / INCONCLUSIVE)
 *   - **مكافحة خداع الذات**: لا ادّعاء «تحسّن» بلا دليل قابل للقياس.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر `nowMs`.
 */

import type { CommercialTruthState } from './truth';

export type LearningVerdict = 'SUPPORTED' | 'CONTRADICTED' | 'INCONCLUSIVE' | 'INSUFFICIENT_DATA';

export const LEARNING_VERDICT_LABELS_AR: Record<LearningVerdict, string> = Object.freeze({
  SUPPORTED: 'مؤيّد بالدليل',
  CONTRADICTED: 'مناقض بالدليل',
  INCONCLUSIVE: 'غير حاسم',
  INSUFFICIENT_DATA: 'بيانات غير كافية',
});

/** مصدر التعلّم — من سجلات حقيقية فقط. */
export type LearningSource =
  | 'verified_sale' | 'verified_revenue' | 'verified_profit' | 'qualified_lead' | 'conversion'
  | 'campaign_outcome' | 'experiment' | 'follow_up_outcome' | 'lost_opportunity'
  | 'customer_objection' | 'demand_change';

export const LEARNING_SOURCE_LABELS_AR: Record<LearningSource, string> = Object.freeze({
  verified_sale: 'بيع موثّق',
  verified_revenue: 'إيراد موثّق',
  verified_profit: 'ربح موثّق',
  qualified_lead: 'عميل مؤهّل',
  conversion: 'تحويل',
  campaign_outcome: 'نتيجة حملة',
  experiment: 'تجربة',
  follow_up_outcome: 'نتيجة متابعة',
  lost_opportunity: 'فرصة مفقودة',
  customer_objection: 'اعتراض عميل',
  demand_change: 'تغيّر طلب',
});

export interface LearningRecord {
  id: string;
  hypothesis: string;
  action: string;
  result: string;
  comparison: string;
  interpretation: string;
  learning: string;
  verdict: LearningVerdict;
  source: LearningSource;
  /** حالة صدق التعلّم — التعلّم ليس حقيقة تجارية دائماً. */
  truthState: CommercialTruthState;
  evidence: string[];
  confidence: 'low' | 'medium' | 'high';
  sampleSize: number;
  limitations: string;
  at: string;
}

export interface LearningCycleInput {
  id: string;
  hypothesis: string;
  action: string;
  result: string;
  comparison: string;
  source: LearningSource;
  evidence: string[];
  sampleSize: number;
  /** نتيجة قابلة للقياس (null = غير متاح). */
  measuredValue?: number | null;
  baselineValue?: number | null;
  nowMs: number;
}

/** الحد الأدنى للعيّنة قبل إعلان تعلّم مؤيّد. */
export const MIN_LEARNING_SAMPLE = 3;

/**
 * يُنتج سجل تعلّم من دورة كاملة. لا يُعلن `SUPPORTED` بلا عيّنة كافية، ولا يرفع
 * التعلّم إلى حقيقة تجارية — يبقى استنتاجاً/فرضية حسب قوة الدليل.
 */
export function runLearningCycle(input: LearningCycleInput): LearningRecord {
  const at = new Date(input.nowMs).toISOString();
  let verdict: LearningVerdict;
  let truthState: CommercialTruthState;
  let confidence: 'low' | 'medium' | 'high';

  if (input.sampleSize < MIN_LEARNING_SAMPLE) {
    verdict = 'INSUFFICIENT_DATA';
    truthState = 'HYPOTHESIS';
    confidence = 'low';
  } else if (input.measuredValue !== null && input.measuredValue !== undefined && input.baselineValue !== null && input.baselineValue !== undefined) {
    if (input.measuredValue > input.baselineValue) { verdict = 'SUPPORTED'; truthState = 'DERIVED'; confidence = 'medium'; }
    else if (input.measuredValue < input.baselineValue) { verdict = 'CONTRADICTED'; truthState = 'DERIVED'; confidence = 'medium'; }
    else { verdict = 'INCONCLUSIVE'; truthState = 'OBSERVED'; confidence = 'low'; }
  } else {
    verdict = 'INCONCLUSIVE';
    truthState = 'OBSERVED';
    confidence = 'low';
  }

  return {
    id: input.id,
    hypothesis: input.hypothesis,
    action: input.action,
    result: input.result,
    comparison: input.comparison,
    interpretation: verdict === 'SUPPORTED'
      ? 'النتيجة تدعم الفرضية بالدليل المتاح.'
      : verdict === 'CONTRADICTED'
        ? 'النتيجة تناقض الفرضية — يلزم تعديل الاستراتيجية.'
        : verdict === 'INSUFFICIENT_DATA'
          ? 'الأدلة غير كافية للحكم — لا تعلّم مؤكّد بعد.'
          : 'الفرق غير حاسم — لا فائز بلا دليل كافٍ.',
    learning: `${input.result} — ${input.comparison}`,
    verdict,
    source: input.source,
    truthState,
    evidence: [...input.evidence],
    confidence,
    sampleSize: input.sampleSize,
    limitations: 'تعلّم من نتائج حقيقية؛ لا يُرقّى إلى حقيقة تجارية بلا تكرار الدليل.',
    at,
  };
}

// ---------------------------------------------------------------------------
// التعلّم من الفشل (§17)
// ---------------------------------------------------------------------------

export type FailureKind =
  | 'failed_campaign' | 'lost_lead' | 'unsuccessful_follow_up' | 'price_objection'
  | 'availability_problem' | 'weak_offer' | 'wrong_audience' | 'weak_content'
  | 'poor_cta' | 'operational_bottleneck';

export const FAILURE_KIND_LABELS_AR: Record<FailureKind, string> = Object.freeze({
  failed_campaign: 'حملة فاشلة',
  lost_lead: 'عميل مفقود',
  unsuccessful_follow_up: 'متابعة غير ناجحة',
  price_objection: 'اعتراض سعري',
  availability_problem: 'مشكلة توفّر',
  weak_offer: 'عرض ضعيف',
  wrong_audience: 'جمهور خاطئ',
  weak_content: 'محتوى ضعيف',
  poor_cta: 'نداء إجراء ضعيف',
  operational_bottleneck: 'عنق زجاجة تشغيلي',
});

export interface FailureAnalysis {
  kind: FailureKind;
  whatHappened: string;
  why: string | null;
  evidence: string[];
  confidence: 'low' | 'medium' | 'high';
  alternativeExplanations: string[];
  nextTest: string;
  /** لا قاعدة عامة من فشل واحد. */
  isUniversalRule: false;
  limitations: string;
}

export interface FailureAnalysisInput {
  kind: FailureKind;
  whatHappened: string;
  evidence: string[];
  sampleSize: number;
  reasonHypothesis?: string | null;
  alternativeExplanations?: string[];
  nextTest?: string;
}

/**
 * يحلّل فشلاً بصدق: بلا دليل ⇒ `why=null` ولا سبب مُختلق؛ ويعلن الأسباب البديلة
 * ويمنع تعميم فشل واحد كقاعدة.
 */
export function analyzeFailure(input: FailureAnalysisInput): FailureAnalysis {
  const hasEvidence = input.evidence.length > 0 && input.sampleSize >= 1;
  const strongEnough = input.sampleSize >= MIN_LEARNING_SAMPLE;
  return {
    kind: input.kind,
    whatHappened: input.whatHappened,
    why: hasEvidence ? (input.reasonHypothesis ?? null) : null,
    evidence: [...input.evidence],
    confidence: strongEnough ? 'medium' : 'low',
    alternativeExplanations: input.alternativeExplanations?.length
      ? [...input.alternativeExplanations]
      : ['التوقيت', 'العرض', 'الجمهور', 'السعر', 'التوفّر — كلها احتمالات تحتاج فصلاً.'],
    nextTest: input.nextTest || 'اختبار متغيّر واحد لعزل السبب.',
    isUniversalRule: false,
    limitations: strongEnough
      ? 'تحليل من عيّنة معقولة؛ لا يُعمَّم كقاعدة مطلقة.'
      : 'عيّنة صغيرة — لا يُعمَّم الفشل الواحد كقاعدة؛ يلزم تكرار.',
  };
}

// ---------------------------------------------------------------------------
// تحليل تغيّر المبيعات/الطلب/التحويل (§18)
// ---------------------------------------------------------------------------

export type ChangeDirection = 'INCREASED' | 'DECREASED' | 'UNCHANGED' | 'UNKNOWN';

export const CHANGE_DIRECTION_LABELS_AR: Record<ChangeDirection, string> = Object.freeze({
  INCREASED: 'ارتفع',
  DECREASED: 'انخفض',
  UNCHANGED: 'بلا تغيّر',
  UNKNOWN: 'غير معروف',
});

export interface ChangeAnalysis {
  subject: string;
  direction: ChangeDirection;
  current: number | null;
  previous: number | null;
  deltaPct: number | null;
  conclusion: string | null;
  evidence: string[];
  confidence: 'low' | 'medium' | 'high';
  alternativeExplanations: string[];
  limitations: string[];
  nextTest: string;
}

/**
 * يحلّل تغيّر مؤشر تجاري. بلا طرفين حقيقيين ⇒ `UNKNOWN` بلا استنتاج. ولا يُعلن سبباً
 * بلا دليل — بل يعلن الأسباب البديلة ويقترح اختباراً.
 */
export function analyzeChange(input: {
  subject: string;
  current: number | null;
  previous: number | null;
  evidence?: string[];
  reasonHypothesis?: string | null;
  sampleSize?: number;
}): ChangeAnalysis {
  const { current, previous } = input;
  const limitations: string[] = [];
  let direction: ChangeDirection = 'UNKNOWN';
  let deltaPct: number | null = null;

  if (current !== null && previous !== null) {
    if (previous === 0) { limitations.push('القيمة السابقة صفر — لا نسبة تغيّر.'); }
    else deltaPct = Math.round(((current - previous) / previous) * 10_000) / 100;
    if (current > previous) direction = 'INCREASED';
    else if (current < previous) direction = 'DECREASED';
    else direction = 'UNCHANGED';
  } else {
    limitations.push('طرف واحد على الأقل غير متاح — لا تحليل تغيّر.');
  }

  const sampleSize = input.sampleSize ?? 0;
  const hasReasonEvidence = (input.evidence?.length || 0) > 0 && sampleSize >= MIN_LEARNING_SAMPLE;
  const conclusion = hasReasonEvidence ? (input.reasonHypothesis ?? null) : null;
  if (!hasReasonEvidence) limitations.push('لا دليل كافٍ لسبب التغيّر — السبب غير معروف.');

  return {
    subject: input.subject,
    direction,
    current,
    previous,
    deltaPct,
    conclusion,
    evidence: [...(input.evidence || [])],
    confidence: hasReasonEvidence ? 'medium' : 'low',
    alternativeExplanations: ['موسمية', 'تغيّر عرض', 'تغيّر جمهور', 'تغيّر منافسة', 'تغيّر تشغيلي'],
    limitations,
    nextTest: 'عزل متغيّر واحد وقياس الأثر على المبيعات الموثّقة.',
  };
}

// ---------------------------------------------------------------------------
// التوقّع مقابل الواقع (§37)
// ---------------------------------------------------------------------------

export type ExpectationVerdict = 'CORRECT_PREDICTION' | 'OVER_ESTIMATION' | 'UNDER_ESTIMATION' | 'INCONCLUSIVE';

export const EXPECTATION_VERDICT_LABELS_AR: Record<ExpectationVerdict, string> = Object.freeze({
  CORRECT_PREDICTION: 'توقّع صحيح',
  OVER_ESTIMATION: 'مبالغة في التوقّع',
  UNDER_ESTIMATION: 'تقليل من التوقّع',
  INCONCLUSIVE: 'غير حاسم',
});

export interface ExpectationReality {
  subject: string;
  expected: number | null;
  actual: number | null;
  verdict: ExpectationVerdict;
  deltaPct: number | null;
  reason: string;
  limitations: string[];
}

/**
 * يقارن التوقّع بالواقع. نطاق ±20% يُعتبر «توقّع صحيح». بلا طرفين ⇒ غير حاسم.
 */
export function compareExpectationVsReality(input: { subject: string; expected: number | null; actual: number | null }): ExpectationReality {
  const { expected, actual } = input;
  const limitations: string[] = [];
  if (expected === null || actual === null) {
    limitations.push('التوقّع أو الواقع غير متاح — لا مقارنة.');
    return { subject: input.subject, expected, actual, verdict: 'INCONCLUSIVE', deltaPct: null, reason: 'لا مقارنة بلا طرفين حقيقيين.', limitations };
  }
  if (expected === 0) {
    limitations.push('التوقّع صفر — لا نسبة.');
    return { subject: input.subject, expected, actual, verdict: actual === 0 ? 'CORRECT_PREDICTION' : 'UNDER_ESTIMATION', deltaPct: null, reason: 'التوقّع صفر.', limitations };
  }
  const deltaPct = Math.round(((actual - expected) / expected) * 10_000) / 100;
  let verdict: ExpectationVerdict;
  if (Math.abs(deltaPct) <= 20) verdict = 'CORRECT_PREDICTION';
  else if (actual < expected) verdict = 'OVER_ESTIMATION';
  else verdict = 'UNDER_ESTIMATION';
  return {
    subject: input.subject, expected, actual, verdict, deltaPct,
    reason: verdict === 'CORRECT_PREDICTION' ? 'الواقع قريب من التوقّع (±20%).'
      : verdict === 'OVER_ESTIMATION' ? 'الواقع أقل من التوقّع.'
        : 'الواقع أعلى من التوقّع.',
    limitations,
  };
}

// ---------------------------------------------------------------------------
// مكافحة خداع الذات (§41)
// ---------------------------------------------------------------------------

export type ImprovementVerdict = 'IMPROVEMENT_PROVEN' | 'NO_IMPROVEMENT' | 'REGRESSION' | 'IMPROVEMENT_NOT_PROVEN';

export const IMPROVEMENT_VERDICT_LABELS_AR: Record<ImprovementVerdict, string> = Object.freeze({
  IMPROVEMENT_PROVEN: 'تحسّن مُثبت بالدليل',
  NO_IMPROVEMENT: 'لا تحسّن',
  REGRESSION: 'تراجع',
  IMPROVEMENT_NOT_PROVEN: 'التحسّن غير مُثبت',
});

export interface ImprovementClaim {
  subject: string;
  previousVerified: number | null;
  newVerified: number | null;
  sampleSize: number;
  periodDays: number;
  verdict: ImprovementVerdict;
  reason: string;
  /** لا يُعلن «تحسّن» بلا عيّنة ومدّة كافيتين. */
  canClaimImproved: boolean;
  limitations: string[];
}

export const MIN_IMPROVEMENT_SAMPLE = 5;
export const MIN_IMPROVEMENT_PERIOD_DAYS = 7;

/**
 * يقيّم ادّعاء تحسّن. **لا** يُعلن «تحسّن» لمجرد إنشاء وحدة/كتابة كود/نجاح اختبار.
 * يلزم: قيمتان موثّقتان + عيّنة ≥ الحد + مدّة ≥ الحد + فرق موجب.
 */
export function assessImprovement(input: {
  subject: string;
  previousVerified: number | null;
  newVerified: number | null;
  sampleSize: number;
  periodDays: number;
}): ImprovementClaim {
  const limitations: string[] = [];
  if (input.sampleSize < MIN_IMPROVEMENT_SAMPLE) limitations.push(`عيّنة أقل من الحد (${MIN_IMPROVEMENT_SAMPLE}).`);
  if (input.periodDays < MIN_IMPROVEMENT_PERIOD_DAYS) limitations.push(`مدّة أقل من الحد (${MIN_IMPROVEMENT_PERIOD_DAYS} يوماً).`);
  if (input.previousVerified === null || input.newVerified === null) limitations.push('قيمة موثّقة غائبة قبل/بعد.');

  if (input.previousVerified === null || input.newVerified === null || input.sampleSize < MIN_IMPROVEMENT_SAMPLE || input.periodDays < MIN_IMPROVEMENT_PERIOD_DAYS) {
    return { subject: input.subject, previousVerified: input.previousVerified, newVerified: input.newVerified, sampleSize: input.sampleSize, periodDays: input.periodDays, verdict: 'IMPROVEMENT_NOT_PROVEN', reason: 'لا ادّعاء تحسّن بلا قيمتين موثّقتين وعيّنة ومدّة كافيتين.', canClaimImproved: false, limitations };
  }
  if (input.newVerified > input.previousVerified) {
    return { subject: input.subject, previousVerified: input.previousVerified, newVerified: input.newVerified, sampleSize: input.sampleSize, periodDays: input.periodDays, verdict: 'IMPROVEMENT_PROVEN', reason: 'قيمة موثّقة أعلى بعد التدخّل بعيّنة ومدّة كافيتين.', canClaimImproved: true, limitations };
  }
  if (input.newVerified < input.previousVerified) {
    return { subject: input.subject, previousVerified: input.previousVerified, newVerified: input.newVerified, sampleSize: input.sampleSize, periodDays: input.periodDays, verdict: 'REGRESSION', reason: 'القيمة الموثّقة انخفضت.', canClaimImproved: false, limitations };
  }
  return { subject: input.subject, previousVerified: input.previousVerified, newVerified: input.newVerified, sampleSize: input.sampleSize, periodDays: input.periodDays, verdict: 'NO_IMPROVEMENT', reason: 'لا فرق في القيمة الموثّقة.', canClaimImproved: false, limitations };
}

export interface LearningSummary {
  total: number;
  supported: number;
  contradicted: number;
  inconclusive: number;
  insufficient: number;
  fromVerifiedSales: number;
  limitations: string[];
}

export function summarizeLearning(records: LearningRecord[]): LearningSummary {
  return {
    total: records.length,
    supported: records.filter((r) => r.verdict === 'SUPPORTED').length,
    contradicted: records.filter((r) => r.verdict === 'CONTRADICTED').length,
    inconclusive: records.filter((r) => r.verdict === 'INCONCLUSIVE').length,
    insufficient: records.filter((r) => r.verdict === 'INSUFFICIENT_DATA').length,
    fromVerifiedSales: records.filter((r) => r.source === 'verified_sale').length,
    limitations: [
      'التعلّم من نتائج حقيقية فقط؛ الافتراضات غير الموثّقة لا تُعلَّم منها.',
      'التعلّم ليس حقيقة تجارية دائمة — يُراجَع عند تغيّر الدليل.',
    ],
  };
}
