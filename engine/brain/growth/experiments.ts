/**
 * Marketing Experiments — تجارب تسويقية بمتغيّر واحد (منطق خالص).
 *
 * أنواع التجارب المدعومة: هوكان، CTA‑ان، طريقتا عرض منتج، جمهوران، توقيتان.
 * كل تجربة تحمل فرضية، متغيّراً واحداً، نسختين، مقياس نجاح، حدّاً أدنى للأدلة،
 * ثم نتيجة فعلية وتعلّماً.
 *
 * القواعد الملزمة:
 * - **لا حكم بلا عيّنة كافية**: دون الحد تُعلن `inconclusive`.
 * - **لا «فائز» بفرق داخل الضجيج** (< 5%).
 * - نتيجة تجربة واحدة لا تُثبت سببية قاطعة.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

export type GrowthExperimentStatus = 'proposed' | 'running' | 'concluded';
export type GrowthExperimentVerdict = 'supports_hypothesis' | 'rejects_hypothesis' | 'inconclusive';

export type ExperimentType =
  | 'two_hooks'
  | 'two_ctas'
  | 'product_presentation'
  | 'two_audiences'
  | 'two_timings';

export const EXPERIMENT_TYPE_LABELS_AR: Record<ExperimentType, string> = Object.freeze({
  two_hooks: 'هوكان مختلفان',
  two_ctas: 'دعوتان مختلفتان للتواصل',
  product_presentation: 'طريقتان لعرض المنتج',
  two_audiences: 'جمهوران مختلفان',
  two_timings: 'توقيتان مختلفان',
});

export interface ExperimentVariant {
  id: string;
  label: string;
  description: string;
}

export interface MarketingExperiment {
  id: string;
  type: ExperimentType;
  typeLabel: string;
  hypothesis: string;
  /** المتغيّر الوحيد المُختبَر. */
  variable: string;
  variantA: ExperimentVariant;
  variantB: ExperimentVariant;
  successMetric: string;
  minEvidence: number;
  status: GrowthExperimentStatus;
  /** مرجع الفرصة/الحملة التي أطلقت التجربة (إن وُجدت). */
  opportunityRef: string | null;
  createdAt: string;
  results: { a: number | null; b: number | null; sampleA: number; sampleB: number } | null;
  verdict: GrowthExperimentVerdict | null;
  learning: string | null;
  limitations: string[];
}

export const GROWTH_MIN_EXPERIMENT_EVIDENCE = 5;

export function createMarketingExperiment(input: {
  id: string;
  type: ExperimentType;
  hypothesis: string;
  variable: string;
  variantA: ExperimentVariant;
  variantB: ExperimentVariant;
  successMetric: string;
  opportunityRef?: string | null;
  minEvidence?: number;
  now: number;
}): MarketingExperiment {
  return {
    id: input.id,
    type: input.type,
    typeLabel: EXPERIMENT_TYPE_LABELS_AR[input.type],
    hypothesis: input.hypothesis,
    variable: input.variable,
    variantA: input.variantA,
    variantB: input.variantB,
    successMetric: input.successMetric,
    minEvidence: input.minEvidence ?? GROWTH_MIN_EXPERIMENT_EVIDENCE,
    status: 'proposed',
    opportunityRef: input.opportunityRef ?? null,
    createdAt: new Date(input.now).toISOString(),
    results: null,
    verdict: null,
    learning: null,
    limitations: ['تجربة بمتغيّر واحد؛ لا تُعمَّم النتيجة خارج نطاقها.'],
  };
}

export function startMarketingExperiment(exp: MarketingExperiment): MarketingExperiment {
  return exp.status === 'proposed' ? { ...exp, status: 'running' } : exp;
}

function improvementPct(a: number | null, b: number | null): number | null {
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  if (a <= 0) return null;
  return Math.round(((b - a) / a) * 1000) / 10;
}

/**
 * يحسم التجربة من نتائج فعلية فقط. عند نقص العيّنة أو الفرق داخل الضجيج يُعلن
 * `inconclusive` صراحةً بدل حكم كاذب.
 */
export function concludeMarketingExperiment(exp: MarketingExperiment, results: { a: number | null; b: number | null; sampleA: number; sampleB: number }): MarketingExperiment {
  const totalSample = results.sampleA + results.sampleB;
  const limitations = [...exp.limitations];
  if (totalSample < exp.minEvidence || results.a === null || results.b === null) {
    limitations.push(`العيّنة ${totalSample} أقل من الحد ${exp.minEvidence}؛ لا حكم.`);
    return { ...exp, status: 'concluded', results, verdict: 'inconclusive', learning: 'لم تكفِ العيّنة للحكم؛ اجمع أدلة إضافية قبل تعديل القاعدة.', limitations };
  }
  const delta = improvementPct(results.a, results.b);
  if (delta === null) {
    limitations.push('تعذّر حساب التحسّن (قيمة أساس صفرية أو ناقصة).');
    return { ...exp, status: 'concluded', results, verdict: 'inconclusive', learning: 'تعذّر الحساب؛ راجع مقياس النجاح.', limitations };
  }
  if (Math.abs(delta) < 5) {
    limitations.push('فرق أقل من 5% يُعتبر داخل الضجيج.');
    return { ...exp, status: 'concluded', results, verdict: 'inconclusive', learning: `الفرق (${delta}%) داخل الضجيج؛ لا دليل على تفوّق نسخة.`, limitations };
  }
  const supports = delta > 0;
  return {
    ...exp,
    status: 'concluded',
    results,
    verdict: supports ? 'supports_hypothesis' : 'rejects_hypothesis',
    learning: supports
      ? `النسخة B تفوّقت بـ${delta}% على ${exp.successMetric}؛ تدعم الفرضية (تُختبر على عيّنات أكبر).`
      : `النسخة B كانت أدنى بـ${Math.abs(delta)}% على ${exp.successMetric}؛ لا تدعم الفرضية.`,
    limitations: [...limitations, 'نتيجة تجربة واحدة لا تُثبت سببية قاطعة.'],
  };
}

/** هل التجربة جاهزة للحسم (اكتملت عيّنتها)؟ */
export function experimentReadyToConclude(exp: MarketingExperiment): boolean {
  if (!exp.results) return false;
  return exp.results.sampleA + exp.results.sampleB >= exp.minEvidence;
}

/**
 * يقترح تجربة من فرصة طلب — بلا تنفيذ. النوع يُشتقّ من طبيعة الطلب:
 * سؤال سعر ⇒ اختبار عرض/CTA؛ تقسيط ⇒ عرض منتج؛ غير ذلك ⇒ هوكان.
 */
export function proposeExperimentForOpportunity(input: {
  id: string;
  opportunityKind: string;
  opportunityRef: string;
  productName: string | null;
  now: number;
}): MarketingCampaignExperimentSuggestion {
  const ref = input.productName || 'المنتج';
  let type: ExperimentType = 'two_hooks';
  let variable = 'الهوك الافتتاحي';
  let hypothesis = `هوكان مختلفان لـ${ref} يغيّران معدّل الاستفسارات المؤهّلة.`;
  let successMetric = 'استفسارات مؤهّلة';
  if (input.opportunityKind === 'repeated_price_request' || input.opportunityKind === 'installment_interest') {
    type = 'product_presentation';
    variable = 'طريقة عرض السعر/التقسيط';
    hypothesis = `عرض السعر/التقسيط بوضوح يرفع الاستفسارات المؤهّلة لـ${ref}.`;
    successMetric = 'استفسارات سعر/تقسيط مؤهّلة';
  } else if (input.opportunityKind === 'recurring_complaint' || input.opportunityKind === 'repeated_objection') {
    type = 'two_ctas';
    variable = 'صياغة الدعوة للتواصل';
    hypothesis = `دعوة تواصل معالِجة للاعتراض ترفع التحويل لـ${ref}.`;
    successMetric = 'تحويل الاستفسار إلى عميل';
  }
  const exp = createMarketingExperiment({
    id: input.id,
    type,
    hypothesis,
    variable,
    variantA: { id: 'a', label: 'النسخة الحالية', description: 'الأساس المرجعي الحالي.' },
    variantB: { id: 'b', label: 'النسخة الجديدة', description: 'التغيير المقترح على المتغيّر الوحيد.' },
    successMetric,
    opportunityRef: input.opportunityRef,
    now: input.now,
  });
  return { experiment: exp, note: 'تجربة مقترحة بمتغيّر واحد؛ تُقاس من تفاعل حقيقي ولا تُحسم بلا عيّنة كافية.' };
}

export interface MarketingCampaignExperimentSuggestion {
  experiment: MarketingExperiment;
  note: string;
}

export interface ExperimentsSummary {
  total: number;
  proposed: number;
  running: number;
  concluded: number;
  inconclusive: number;
  note: string;
}

export function summarizeExperiments(exps: MarketingExperiment[]): ExperimentsSummary {
  return {
    total: exps.length,
    proposed: exps.filter((e) => e.status === 'proposed').length,
    running: exps.filter((e) => e.status === 'running').length,
    concluded: exps.filter((e) => e.status === 'concluded').length,
    inconclusive: exps.filter((e) => e.verdict === 'inconclusive').length,
    note: 'لا يُعلن فائز بلا عيّنة كافية؛ والفرق داخل الضجيج يُعلن غير حاسم.',
  };
}
