/**
 * Campaign → Sales → Profit Loop + ROI + Attribution + Experimentation (منطق خالص).
 *
 * الغرض: ربط الحملة بالمحتوى بالتفاعل بالطلب بالعميل بالبيع بالإيراد بالربح، ومقارنة
 * **المتوقّع بالفعلي**، وعدم إعلان نجاح حملة من مقاييس وهمية. ويضمّ:
 *   - دورة الحملة التجارية (كل رقم حقيقي أو null)
 *   - حماية الربح (لا ربح بلا إيراد موثّق + تكلفة موثوقة)
 *   - الإسناد (DIRECT/SUPPORTED/UNCERTAIN/NOT_ATTRIBUTABLE) مع شرح الدليل
 *   - التجارب (لا فائز بلا دليل كافٍ)
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر `nowMs`.
 */

import { buildRoiReport, type RoiFunnelInput, type RoiReport } from '../sales/roi';
import { computeAttribution, type AttributionChain, type AttributionResult } from '../digital/attribution';
import { compareExpectationVsReality, type ExpectationReality } from './learning';
import { isVanityMetric } from './northStar';

export interface CampaignCommercialLink {
  campaignId: string;
  objective: string;
  /** هل الهدف بيعي صريح؟ */
  salesObjective: boolean;
  contentRefs: string[];
  interactions: number | null;
  purchaseSignals: number | null;
  leads: number | null;
  requests: number | null;
  verifiedSales: number | null;
  verifiedRevenue: number | null;
  /** تكلفة موثوقة (null = غير متاح — لا تُخترع). */
  campaignCost: number | null;
  /** تكلفة المنتج الموثوقة (null = غير متاح). */
  productCost: number | null;
  /** مقياس وهمي إن استُخدم لأغراض العرض فقط (لا يُحسَّن عليه). */
  vanityMetric?: { metric: string; value: number | null };
  expected: { metric: string; value: number | null };
}

export interface CampaignCommercialReport {
  campaignId: string;
  objective: string;
  /** هل النجاح التجاري مُثبت (مبيعات/إيراد حقيقي)؟ */
  commerciallySuccessful: boolean | null;
  successBasis: string;
  /** هل رُفض إعلان نجاح بسبب مقياس وهمي؟ */
  vanityRejected: boolean;
  roi: RoiReport;
  profit: { value: number | null; state: 'AVAILABLE' | 'NOT_AVAILABLE'; reason: string };
  expectation: ExpectationReality;
  limitations: string[];
}

/**
 * يبني تقرير الحملة التجاري. **لا** يُعلن نجاحاً من مقاييس وهمية إن كان الهدف بيعياً؛
 * ولا ربح بلا إيراد وتكلفة.
 */
export function buildCampaignCommercialReport(link: CampaignCommercialLink): CampaignCommercialReport {
  const roiInput: RoiFunnelInput = {
    reach: null,
    engagement: null,
    inquiries: link.purchaseSignals,
    leads: link.leads,
    requests: link.requests,
    verifiedSales: link.verifiedSales,
    revenue: link.verifiedRevenue,
    campaignCost: link.campaignCost,
    source: `campaign:${link.campaignId}`,
  };
  const roi = buildRoiReport(roiInput);

  // الربح: فقط عند إيراد موثّق + تكلفة منتج/حملة موثوقة.
  let profitValue: number | null = null;
  let profitState: 'AVAILABLE' | 'NOT_AVAILABLE' = 'NOT_AVAILABLE';
  let profitReason: string;
  const costTotal = link.campaignCost !== null && link.productCost !== null ? link.campaignCost + link.productCost : null;
  if (link.verifiedRevenue !== null && costTotal !== null) {
    profitValue = link.verifiedRevenue - costTotal;
    profitState = 'AVAILABLE';
    profitReason = 'إيراد موثّق − (تكلفة حملة + تكلفة منتج) موثوقتين.';
  } else {
    profitReason = 'الربح غير متاح: يلزم إيراد موثّق + تكلفة حملة وتكلفة منتج موثوقتين. UNKNOWN ≠ صفر.';
  }

  const expectation = compareExpectationVsReality({ subject: link.campaignId, expected: link.expected.value, actual: link.verifiedSales });

  // النجاح التجاري: للهدف البيعي يُقاس بالمبيعات/الإيراد الحقيقي، لا بالمقياس الوهمي.
  let commerciallySuccessful: boolean | null = null;
  let successBasis: string;
  let vanityRejected = false;
  if (!link.salesObjective) {
    successBasis = 'الهدف غير بيعي صراحةً — يُقاس بهدفه الأصلي لا بالبيع.';
  } else if (link.verifiedSales === null && link.verifiedRevenue === null) {
    successBasis = 'لا مبيعات/إيراد موثّق — لا إعلان نجاح.';
  } else {
    const salesOk = (link.verifiedSales ?? 0) > 0 || (link.verifiedRevenue ?? 0) > 0;
    commerciallySuccessful = salesOk;
    successBasis = salesOk ? 'تحقّق بيع/إيراد موثّق.' : 'لا بيع موثّق رغم أي تفاعل.';
    if (!salesOk && link.vanityMetric && link.vanityMetric.value !== null && isVanityMetric(link.vanityMetric.metric)) {
      vanityRejected = true;
      successBasis += ` رُفض إعلان النجاح بناءً على «${link.vanityMetric.metric}» (مقياس وهمي).`;
    }
  }

  return {
    campaignId: link.campaignId,
    objective: link.objective,
    commerciallySuccessful,
    successBasis,
    vanityRejected,
    roi,
    profit: { value: profitValue, state: profitState, reason: profitReason },
    expectation,
    limitations: [
      'كل رقم من سجلات حقيقية؛ null = غير متاح لا صفر.',
      'لا سببية حملة→بيع بلا سلسلة معرّفات موثوقة.',
    ],
  };
}

// ---------------------------------------------------------------------------
// الإسناد (§14) — يشرح الدليل الذي يربط البيع بالحملة
// ---------------------------------------------------------------------------

export interface AttributionExplanation extends AttributionResult {
  question: string;
  answer: string;
}

/**
 * يجيب: «ما الدليل الذي يربط هذا البيع بهذه الحملة؟» — بلا سببية عند ضعف الدليل.
 */
export function explainAttribution(chain: AttributionChain): AttributionExplanation {
  const result = computeAttribution(chain);
  const answer = result.canClaimCausation
    ? `الدليل: ${result.linked.join(' → ')} — يمكن نسبة البيع للحملة (${result.state}).`
    : `الدليل ناقص (${result.missing.join(', ') || 'لا سلسلة'}) — لا تُعلن سببية؛ الحالة ${result.state}.`;
  return { ...result, question: 'ما الدليل الذي يربط هذا البيع بهذه الحملة؟', answer };
}

// ---------------------------------------------------------------------------
// التجارب (§15)
// ---------------------------------------------------------------------------

export type ExperimentVariable = 'hook' | 'cta' | 'offer_presentation' | 'product_presentation' | 'audience' | 'timing' | 'message' | 'follow_up_timing' | 'content_format';

export const EXPERIMENT_VARIABLE_LABELS_AR: Record<ExperimentVariable, string> = Object.freeze({
  hook: 'الافتتاحية', cta: 'نداء الإجراء', offer_presentation: 'تقديم العرض',
  product_presentation: 'تقديم المنتج', audience: 'الجمهور', timing: 'التوقيت',
  message: 'الرسالة', follow_up_timing: 'توقيت المتابعة', content_format: 'صيغة المحتوى',
});

export type ExperimentVerdict = 'SUPPORTS_HYPOTHESIS' | 'REJECTS_HYPOTHESIS' | 'INCONCLUSIVE';

export const EXPERIMENT_VERDICT_LABELS_AR: Record<ExperimentVerdict, string> = Object.freeze({
  SUPPORTS_HYPOTHESIS: 'يدعم الفرضية',
  REJECTS_HYPOTHESIS: 'يناقض الفرضية',
  INCONCLUSIVE: 'غير حاسم',
});

export interface MarketingExperimentRecord {
  id: string;
  hypothesis: string;
  variable: ExperimentVariable;
  variableLabelAr: string;
  variantA: string;
  variantB: string;
  /** نتائج حقيقية (null = غير متاح). */
  resultA: number | null;
  resultB: number | null;
  sampleA: number;
  sampleB: number;
  verdict: ExperimentVerdict;
  verdictLabelAr: string;
  /** الفائز (null عند عدم الحسم). */
  winner: 'A' | 'B' | null;
  reason: string;
  limitations: string[];
}

/** الحد الأدنى للعيّنة لكل متغيّر قبل إعلان فائز. */
export const MIN_EXPERIMENT_SAMPLE = 5;
/** الحد الأدنى للفرق النسبي لإعلان فائز (تجنّب ضجيج صغير). */
export const MIN_EXPERIMENT_DELTA_PCT = 15;

/**
 * يحكم على تجربة بمتغيّر واحد. **لا** يُعلن فائزاً بلا عيّنة كافية ولا بفرق كافٍ؛
 * الفرق الصغير يبقى INCONCLUSIVE. ولا تُصنع ثقة إحصائية وهمية.
 */
export function judgeExperiment(input: {
  id: string;
  hypothesis: string;
  variable: ExperimentVariable;
  variantA: string;
  variantB: string;
  resultA: number | null;
  resultB: number | null;
  sampleA: number;
  sampleB: number;
}): MarketingExperimentRecord {
  const limitations: string[] = [];
  let verdict: ExperimentVerdict;
  let winner: 'A' | 'B' | null = null;
  let reason: string;

  const insufficient = input.sampleA < MIN_EXPERIMENT_SAMPLE || input.sampleB < MIN_EXPERIMENT_SAMPLE
    || input.resultA === null || input.resultB === null;
  if (insufficient) {
    verdict = 'INCONCLUSIVE'; winner = null;
    reason = 'العيّنة/النتيجة غير كافية — لا فائز.';
    limitations.push('يلزم عيّنة ≥ الحد لكل متغيّر ونتيجة حقيقية.');
  } else {
    const a = input.resultA as number; const b = input.resultB as number;
    const denom = Math.max(Math.abs(a), Math.abs(b), 1);
    const deltaPct = Math.abs(a - b) / denom * 100;
    if (deltaPct < MIN_EXPERIMENT_DELTA_PCT) {
      verdict = 'INCONCLUSIVE'; winner = null;
      reason = `الفرق ${Math.round(deltaPct)}% < الحد ${MIN_EXPERIMENT_DELTA_PCT}% — غير حاسم.`;
      limitations.push('فرق صغير — لا يُعلن فائز.');
    } else if (a > b) {
      verdict = 'SUPPORTS_HYPOTHESIS'; winner = 'A'; reason = 'المتغيّر A أعلى بفرق كافٍ.';
    } else {
      verdict = 'REJECTS_HYPOTHESIS'; winner = 'B'; reason = 'المتغيّر B أعلى بفرق كافٍ.';
    }
  }

  limitations.push('الحكم على نتيجة حقيقية بفرق ذي دلالة عملية؛ لا ثقة إحصائية مُصنّعة.');
  return {
    id: input.id, hypothesis: input.hypothesis, variable: input.variable,
    variableLabelAr: EXPERIMENT_VARIABLE_LABELS_AR[input.variable],
    variantA: input.variantA, variantB: input.variantB,
    resultA: input.resultA, resultB: input.resultB, sampleA: input.sampleA, sampleB: input.sampleB,
    verdict, verdictLabelAr: EXPERIMENT_VERDICT_LABELS_AR[verdict], winner, reason, limitations,
  };
}

export interface CampaignLoopSummary {
  campaigns: number;
  commerciallySuccessful: number;
  vanityRejected: number;
  profitAvailable: number;
  experiments: number;
  experimentWinners: number;
  inconclusive: number;
  limitations: string[];
}

export function summarizeCampaignLoop(reports: CampaignCommercialReport[], experiments: MarketingExperimentRecord[]): CampaignLoopSummary {
  return {
    campaigns: reports.length,
    commerciallySuccessful: reports.filter((r) => r.commerciallySuccessful === true).length,
    vanityRejected: reports.filter((r) => r.vanityRejected).length,
    profitAvailable: reports.filter((r) => r.profit.state === 'AVAILABLE').length,
    experiments: experiments.length,
    experimentWinners: experiments.filter((e) => e.winner !== null).length,
    inconclusive: experiments.filter((e) => e.verdict === 'INCONCLUSIVE').length,
    limitations: ['لا إعلان نجاح حملة بيعية من مقاييس وهمية؛ ولا ربح بلا تكلفة موثوقة.'],
  };
}
