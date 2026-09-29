/**
 * Content Intelligence — مسار بناء المحتوى + جودة الفيديو + نموذج الأداء.
 *
 * المسار الملزم: Audience Need → Business Goal → Content Idea → Hook → Script →
 * Visual Plan → Title → Description → CTA → Hashtags → Platform Adaptation، مع
 * تفسير «لماذا اخترنا هذا المحتوى».
 *
 * جودة الفيديو تُفكَّر على مراحل (0-3s / 3-10s / القيمة / الدليل / الاعتراض /
 * CTA / الخاتمة) وتربط الأداء بالاحتفاظ. أي drop-off يُسجَّل كـ«مشكلة ملاحَظة»
 * باحتمال سبب وثقة صريحة — **لا ادعاء سبب يقيني بلا بيانات**.
 *
 * نموذج الأداء لا يُختصر إلى views: أبعاد متعددة + «لماذا أدّى»، بلا score واحد
 * يُقدَّم كحقيقة.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

export type VideoStage = 'hook_0_3' | 'build_3_10' | 'core_value' | 'proof' | 'objection_handling' | 'cta' | 'ending';

export const VIDEO_STAGE_LABELS_AR: Record<VideoStage, string> = Object.freeze({
  hook_0_3: 'الالتقاط (0–3 ثوانٍ)',
  build_3_10: 'البناء (3–10 ثوانٍ)',
  core_value: 'القيمة الجوهرية',
  proof: 'الدليل',
  objection_handling: 'معالجة الاعتراض',
  cta: 'دعوة الإجراء',
  ending: 'الخاتمة',
});

export interface StagePerformance {
  stage: VideoStage;
  /** نسبة بقاء مُلاحظة عند هذه المرحلة (من بيانات احتفاظ حقيقية) أو null. */
  retentionPct: number | null;
  /** هل البيانات متاحة لهذه المرحلة؟ */
  available: boolean;
  reason?: string;
}

export interface VideoQualityObservation {
  stage: VideoStage;
  problem: string;
  possibleCause: string;
  confidence: 'low' | 'medium' | 'high';
  suggestedExperiment: string;
  evidence: string;
  source: string;
}

/**
 * يحلّل جودة الفيديو من منحنى احتفاظ حقيقي فقط. عند غياب بيانات الاحتفاظ يُعلن
 * ذلك ولا يخترع drop-off. عند وجود drop-off ملاحَظ، يعطي احتمال سبب (لا يقيناً).
 */
export function analyzeVideoQuality(input: {
  /** نسب الاحتفاظ عند كل مرحلة (من Analytics حقيقي). */
  stageRetention: Partial<Record<VideoStage, number | null>>;
  /** هل بيانات الاحتفاظ متاحة أصلاً؟ */
  retentionAvailable: boolean;
  retentionSource: string;
  /** حد الانخفاض المئوي الذي يُعتبر drop-off ملاحَظاً. */
  dropThresholdPct?: number;
}): { observations: VideoQualityObservation[]; note: string; limitations: string[] } {
  const limitations: string[] = [];
  if (!input.retentionAvailable) {
    return {
      observations: [],
      note: 'لا تحليل جودة: بيانات الاحتفاظ غير متاحة عبر الواجهة الحالية — لا تُخترع.',
      limitations: ['تحليل مراحل الفيديو يحتاج منحنى احتفاظ حقيقياً (Analytics)؛ لا يُقدَّر.'],
    };
  }
  const threshold = input.dropThresholdPct ?? 15;
  const stages: VideoStage[] = ['hook_0_3', 'build_3_10', 'core_value', 'proof', 'objection_handling', 'cta', 'ending'];
  const observations: VideoQualityObservation[] = [];
  let prev: number | null = null;
  for (const stage of stages) {
    const val = input.stageRetention[stage];
    if (typeof val !== 'number') { limitations.push(`لا بيانات احتفاظ لمرحلة «${VIDEO_STAGE_LABELS_AR[stage]}».`); continue; }
    if (prev !== null) {
      const drop = prev - val;
      if (drop >= threshold) {
        observations.push({
          stage,
          problem: `انخفاض ملاحَظ في البقاء (${Math.round(drop)} نقطة) عند مرحلة «${VIDEO_STAGE_LABELS_AR[stage]}».`,
          possibleCause: 'قد يرتبط بضعف الالتقاط/الإيقاع أو انتقال غير واضح — احتمال لا يقين.',
          confidence: 'low',
          suggestedExperiment: `جرّب تعديل مرحلة «${VIDEO_STAGE_LABELS_AR[stage]}» كمتغيّر واحد وقس الاحتفاظ.`,
          evidence: `بقاء ${Math.round(val)}% مقابل ${Math.round(prev)}% في المرحلة السابقة.`,
          source: input.retentionSource,
        });
      }
    }
    prev = val;
  }
  return {
    observations,
    note: observations.length
      ? 'مشكلات ملاحَظة بأسباب محتملة فقط؛ لا يُدَّعى سبب يقيني بلا بيانات إضافية.'
      : 'لا drop-off ملاحَظ فوق الحد من بيانات الاحتفاظ المتاحة.',
    limitations: [...limitations, 'تحليل المراحل إرشادي؛ لا يُثبت سببية.'],
  };
}

// ---------------------------------------------------------------------------
// نموذج أداء متعدد الأبعاد (لا views فقط)
// ---------------------------------------------------------------------------

export type PerformanceDimension =
  | 'reach'
  | 'engagement'
  | 'retention'
  | 'audience_fit'
  | 'local_relevance'
  | 'buying_signals'
  | 'follower_growth'
  | 'conversation_quality'
  | 'conversion_evidence';

export const PERFORMANCE_DIMENSION_LABELS_AR: Record<PerformanceDimension, string> = Object.freeze({
  reach: 'الوصول',
  engagement: 'التفاعل',
  retention: 'الاحتفاظ',
  audience_fit: 'ملاءمة الجمهور',
  local_relevance: 'الملاءمة المحلية',
  buying_signals: 'إشارات الشراء',
  follower_growth: 'نمو المتابعين',
  conversation_quality: 'جودة المحادثة',
  conversion_evidence: 'دليل التحويل',
});

export interface PerformanceDimensionValue {
  dimension: PerformanceDimension;
  value: number | null;
  available: boolean;
  source: string | null;
  reason?: string;
}

export interface ContentPerformanceModel {
  dimensions: PerformanceDimensionValue[];
  whyItPerformed: string[];
  known: string[];
  inferred: string[];
  unknown: string[];
  nextTest: string[];
  note: string;
}

/**
 * يبني نموذج أداء متعدد الأبعاد من بيانات حقيقية فقط، ويفصل صراحةً بين المعروف
 * والاستنتاج والمجهول — بلا score واحد يُقدَّم كحقيقة.
 */
export function buildContentPerformanceModel(input: {
  platform: string;
  views: number | null;
  engagementRate: number | null;
  retentionPct: number | null;
  buyingSignals: number | null;
  followerDelta: number | null;
  conversationQuality: number | null;
}): ContentPerformanceModel {
  const p = input.platform;
  const dim = (dimension: PerformanceDimension, value: number | null, source: string, reason: string): PerformanceDimensionValue => ({
    dimension,
    value,
    available: value !== null,
    source: value !== null ? source : null,
    reason: value === null ? reason : undefined,
  });

  const dimensions: PerformanceDimensionValue[] = [
    dim('reach', input.views, `${p} API — views`, 'المؤشر غير متاح عبر الواجهة الرسمية.'),
    dim('engagement', input.engagementRate, `${p} API — نسبة تفاعل محسوبة`, 'يتطلب مؤشرات تفاعل متاحة.'),
    dim('retention', input.retentionPct, `${p} Analytics — احتفاظ`, 'يتطلب واجهة تحليلات الاحتفاظ ولم تُطلب.'),
    { dimension: 'audience_fit', value: null, available: false, source: null, reason: 'يحتاج بيانات جمهور جغرافية/اهتمامية غير متاحة — لا تُقدَّر.' },
    { dimension: 'local_relevance', value: null, available: false, source: null, reason: 'يحتاج بيانات جغرافية للجمهور غير متاحة — لا تُقدَّر.' },
    dim('buying_signals', input.buyingSignals, `${p} API — تصنيف تعليقات (استفسارات أعمال)`, 'لا تعليقات مقروءة لاشتقاق إشارات شراء.'),
    dim('follower_growth', input.followerDelta, `${p} API — تغيّر المتابعين/المشتركين`, 'المؤشر غير متاح عبر الواجهة الحالية.'),
    dim('conversation_quality', input.conversationQuality, `${p} API — تحليل نصوص التعليقات`, 'لا تعليقات مقروءة لتقييم جودة المحادثة.'),
    { dimension: 'conversion_evidence', value: null, available: false, source: null, reason: 'لا مصدر بيع/تحويل موثّق متصل — لا يُخترع.' },
  ];

  const known = dimensions.filter((d) => d.available).map((d) => `${PERFORMANCE_DIMENSION_LABELS_AR[d.dimension]}: ${d.value} (${d.source}).`);
  const unknown = dimensions.filter((d) => !d.available).map((d) => `${PERFORMANCE_DIMENSION_LABELS_AR[d.dimension]}: ${d.reason}`);
  const inferred: string[] = [];
  if (input.engagementRate !== null && input.views !== null) {
    inferred.push(input.engagementRate >= 2
      ? 'التفاعل النسبي أعلى من المتوسط الشائع — استنتاج من هذه العيّنة فقط.'
      : 'التفاعل النسبي منخفض — استنتاج من هذه العيّنة فقط.');
  }
  const whyItPerformed = known.length ? ['الأداء المرصود مبني على الأبعاد المتاحة أعلاه.'] : [];
  const nextTest = dimensions.some((d) => !d.available)
    ? ['شغّل واجهة تحليلات إضافية (احتفاظ/جمهور) لسدّ الأبعاد المجهولة قبل أي حكم.']
    : [];

  return {
    dimensions,
    whyItPerformed,
    known,
    inferred,
    unknown,
    nextTest,
    note: 'نموذج متعدد الأبعاد بلا score واحد كحقيقة. المعروف/المستنتج/المجهول مفصولة صراحةً.',
  };
}

// ---------------------------------------------------------------------------
// مسار المحتوى (Audience Need → ... → Platform Adaptation)
// ---------------------------------------------------------------------------

export interface ContentPathStep {
  step: string;
  value: string | null;
  source: string | null;
  available: boolean;
  reason?: string;
}

export interface ContentPath {
  steps: ContentPathStep[];
  whyThisContent: string;
  note: string;
}

/**
 * يبني مسار المحتوى المعلن ويشرح «لماذا هذا المحتوى» بدليل. لا يخترع حقائق؛ أي
 * خطوة بلا مصدر تُعلن `available: false`.
 */
export function buildContentPath(input: {
  audienceNeed: string | null;
  audienceNeedSource: string | null;
  businessGoal: string;
  contentIdea: string | null;
  hook: string | null;
  script: string | null;
  visualPlan: string | null;
  title: string | null;
  description: string | null;
  cta: string | null;
  hashtags: string[];
}): ContentPath {
  const step = (name: string, value: string | null, source: string | null): ContentPathStep => ({
    step: name,
    value,
    source,
    available: Boolean(value && value.trim()),
    reason: value && value.trim() ? undefined : 'لم تتوفر هذه الخطوة من بيانات حقيقية؛ لا تُخترع.',
  });
  const steps: ContentPathStep[] = [
    step('حاجة الجمهور', input.audienceNeed, input.audienceNeedSource),
    step('الهدف التجاري', input.businessGoal, 'تعريف الهدف في العقل'),
    step('فكرة المحتوى', input.contentIdea, input.contentIdea ? 'اشتقاق من الحاجة المتكررة' : null),
    step('الالتقاط (Hook)', input.hook, input.hook ? 'صياغة حتمية' : null),
    step('النص (Script)', input.script, input.script ? 'صياغة حتمية من حقائق مسجّلة' : null),
    step('الخطة البصرية', input.visualPlan, input.visualPlan ? 'تخطيط' : null),
    step('العنوان', input.title, input.title ? 'صياغة من بيانات مسجّلة' : null),
    step('الوصف', input.description, input.description ? 'صياغة من بيانات مسجّلة' : null),
    step('دعوة الإجراء', input.cta, input.cta ? 'سياسة المشروع' : null),
    step('الهاشتاغات', input.hashtags.length ? input.hashtags.join(' ') : null, input.hashtags.length ? 'وسوم من التصنيف المسجّل' : null),
    step('تكييف المنصة', null, 'طبقة تكييف المنصات القائمة'),
  ];
  const whyThisContent = input.audienceNeed
    ? `اختير المحتوى استجابةً لحاجة جمهور ملاحَظة: «${input.audienceNeed}» (المصدر: ${input.audienceNeedSource || 'غير محدد'}). الهدف: ${input.businessGoal}.`
    : `لا حاجة جمهور موثّقة؛ المحتوى عام نحو الهدف: ${input.businessGoal}.`;
  return {
    steps,
    whyThisContent,
    note: 'كل خطوة بمصدرها؛ الخطوات غير المتوفرة معلنة بلا اختراع.',
  };
}
