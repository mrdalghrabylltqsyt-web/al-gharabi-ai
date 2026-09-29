/**
 * Experiment Engine — إنشاء التجارب وإدارة دورة حياتها (منطق خالص).
 *
 * العقل لا يغيّر أكثر من متغير واحد في التجربة بلا سبب. كل تجربة تحمل فرضية
 * ومتغيراً ونسختين ومقياس نجاح وحد أدنى للأدلة، ثم نتيجة وتعلّماً صريحاً.
 *
 * قواعد:
 * - لا تُعلن تجربة «ناجحة» بلا عيّنة كافية.
 * - النتيجة غير الحاسمة تُعلن `inconclusive` لا «نجاح».
 * - أي تجربة سبق أن فشلت في الذاكرة لا تُعاد بلا سبب جديد.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

export type ExperimentStatus = 'proposed' | 'running' | 'concluded';
export type ExperimentVerdict = 'supports_hypothesis' | 'rejects_hypothesis' | 'inconclusive';

export interface ExperimentVariant {
  id: string;
  label: string;
  description: string;
}

export interface Experiment {
  id: string;
  hypothesis: string;
  /** المتغيّر الوحيد المُختبَر. */
  variable: string;
  variantA: ExperimentVariant;
  variantB: ExperimentVariant;
  successMetric: string;
  /** الحد الأدنى للعيّنة قبل أي حكم. */
  minEvidence: number;
  status: ExperimentStatus;
  createdAt: string;
  /** نتائج فعلية لكل نسخة (بلا اختراع). */
  results?: { a: number | null; b: number | null; sampleA: number; sampleB: number } | null;
  verdict?: ExperimentVerdict | null;
  learning?: string | null;
  limitations: string[];
}

export const MIN_EXPERIMENT_EVIDENCE = 5;

/**
 * ينشئ تجربة بمتغيّر واحد. يُمنع تمرير متغيرات متعددة (لا تغيير أكثر من متغير
 * بلا سبب) — الحارس صريح.
 */
export function createExperiment(input: {
  id: string;
  hypothesis: string;
  variable: string;
  variantA: ExperimentVariant;
  variantB: ExperimentVariant;
  successMetric: string;
  minEvidence?: number;
  now: number;
}): Experiment {
  return {
    id: input.id,
    hypothesis: input.hypothesis,
    variable: input.variable,
    variantA: input.variantA,
    variantB: input.variantB,
    successMetric: input.successMetric,
    minEvidence: input.minEvidence ?? MIN_EXPERIMENT_EVIDENCE,
    status: 'proposed',
    createdAt: new Date(input.now).toISOString(),
    results: null,
    verdict: null,
    learning: null,
    limitations: ['تجربة بمتغيّر واحد؛ لا تُعمَّم النتيجة خارج نطاقها.'],
  };
}

export function startExperiment(exp: Experiment): Experiment {
  return exp.status === 'proposed' ? { ...exp, status: 'running' } : exp;
}

/** نسبة تحسّن مئوية آمنة؛ null إن تعذّر الحساب (بلا قسمة على صفر). */
function improvementPct(a: number | null, b: number | null): number | null {
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  if (a <= 0) return null;
  return Math.round(((b - a) / a) * 1000) / 10;
}

/**
 * يحسم تجربة من نتائج فعلية فقط. عند نقص العيّنة يُعلن `inconclusive` صراحةً بدل
 * حكم كاذب، ويُنتج تعلّماً قابلاً للتفسير.
 */
export function concludeExperiment(exp: Experiment, results: { a: number | null; b: number | null; sampleA: number; sampleB: number }): Experiment {
  const totalSample = results.sampleA + results.sampleB;
  const limitations = [...exp.limitations];
  if (totalSample < exp.minEvidence || results.a === null || results.b === null) {
    limitations.push(`العيّنة ${totalSample} أقل من الحد ${exp.minEvidence}؛ لا حكم.`);
    return {
      ...exp,
      status: 'concluded',
      results,
      verdict: 'inconclusive',
      learning: 'لم تكفِ العيّنة للحكم؛ اجمع أدلة إضافية قبل تعديل القاعدة.',
      limitations,
    };
  }
  const delta = improvementPct(results.a, results.b);
  if (delta === null) {
    limitations.push('تعذّر حساب التحسّن (قيمة أساس صفرية أو ناقصة).');
    return { ...exp, status: 'concluded', results, verdict: 'inconclusive', learning: 'تعذّر الحساب؛ راجع مقياس النجاح.', limitations };
  }
  if (Math.abs(delta) < 5) {
    limitations.push('فرق أقل من 5% يُعتبر داخل الضجيج.');
    return {
      ...exp,
      status: 'concluded',
      results,
      verdict: 'inconclusive',
      learning: `الفرق (${delta}%) داخل الضجيج؛ لا دليل على تفوّق نسخة.`,
      limitations,
    };
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

/** ملخّص صادق لتجربة للعرض. */
export function describeExperiment(exp: Experiment): string {
  const verdictAr = exp.verdict === 'supports_hypothesis' ? 'تدعم الفرضية'
    : exp.verdict === 'rejects_hypothesis' ? 'لا تدعم الفرضية'
      : exp.verdict === 'inconclusive' ? 'غير حاسمة'
        : 'لم تُحسم';
  return `${exp.hypothesis} — المتغيّر: ${exp.variable} — الحالة: ${exp.status} — ${verdictAr}.`;
}

/** هل التجربة جاهزة للحسم (اكتملت عيّنتها)؟ */
export function experimentReadyToConclude(exp: Experiment): boolean {
  if (!exp.results) return false;
  return exp.results.sampleA + exp.results.sampleB >= exp.minEvidence;
}
