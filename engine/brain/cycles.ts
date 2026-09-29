/**
 * Brain Cycles — الدورة اليومية والأسبوعية للعقل (منطق خالص قابل للاختبار).
 *
 * الدورة اليومية تُنتج خطة عمل مرتّبة (قراءة إشارات → تحديث ذاكرة → كشف شذوذ →
 * تحليل → تقييم تجارب → تحديث توصيات → فرص تجارية → إجراءات تالية → قرارات تحتاج
 * المالك)، **ولا تنفّذ أي إجراء خارجي**.
 *
 * المراجعة الأسبوعية تجيب أسئلة صريحة: ما نجح؟ ما فشل؟ من استجاب؟ ماذا تغيّر؟
 * ماذا يجب أن يتوقّف/يستمر/يُختبر/يُكيَّف عبر المنصات؟
 *
 * لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import type { PlatformId } from '../social/adapter';
import type { Signal } from './perception/signals';
import { isFresh } from './perception/signals';
import type { ExplainableRecommendation } from './strategy/strategyEngine';
import type { Experiment } from './experiments/experimentEngine';
import type { PendingDecision } from './state';

export interface BrainCycleStep {
  step: string;
  outcome: string;
  /** هل أنتج هذا الخطوة أي عمل خارجي؟ (يجب أن تكون false دائماً هنا). */
  externalAction: false;
}

export interface DailyBrainCycleResult {
  steps: BrainCycleStep[];
  anomalies: string[];
  nextActions: string[];
  pendingDecisions: PendingDecision[];
  note: string;
}

/**
 * ينفّذ دورة يومية تحليلية فقط. أي «إجراء تالٍ» هو اقتراح داخلي، لا تنفيذ خارجي.
 */
export function runDailyBrainCycle(input: {
  now: number;
  signals: Signal[];
  recommendations: ExplainableRecommendation[];
  experiments: Experiment[];
  decisions: PendingDecision[];
  commercialOpportunities?: string[];
}): DailyBrainCycleResult {
  const steps: BrainCycleStep[] = [];
  const anomalies: string[] = [];

  // 1) قراءة الإشارات الجديدة.
  const fresh = input.signals.filter((s) => isFresh(s, input.now));
  const stale = input.signals.length - fresh.length;
  steps.push({
    step: 'قراءة الإشارات الجديدة',
    outcome: `${fresh.length} إشارة طازجة من ${input.signals.length}؛ ${stale} قديمة.`,
    externalAction: false,
  });

  // 2) كشف الشذوذ: إشارات قديمة أو مؤشرات غير متاحة بكثرة.
  if (stale > 0) anomalies.push(`${stale} إشارة تجاوزت سياسة الطزاجة — يلزم تحديثها.`);
  const unavailable = input.signals.filter((s) => s.availability === 'NOT_AVAILABLE');
  if (unavailable.length) anomalies.push(`${unavailable.length} مؤشراً غير متاح عبر الواجهات الرسمية (معلن صراحةً).`);

  // 3) تقييم التجارب النشطة.
  const running = input.experiments.filter((e) => e.status === 'running');
  steps.push({ step: 'تقييم التجارب النشطة', outcome: `${running.length} تجربة قيد التنفيذ.`, externalAction: false });

  // 4) تحديث التوصيات.
  const supported = input.recommendations.filter((r) => r.status === 'supported');
  steps.push({ step: 'تحديث التوصيات', outcome: `${supported.length} توصية مدعومة، ${input.recommendations.length - supported.length} بعيّنة ناقصة.`, externalAction: false });

  // 5) الفرص التجارية.
  const opportunities = input.commercialOpportunities || [];
  steps.push({ step: 'كشف الفرص التجارية', outcome: opportunities.length ? `${opportunities.length} فرصة محتملة.` : 'لا فرص موثّقة بإشارات شراء بعد.', externalAction: false });

  // 6) الإجراءات التالية (اقتراحات داخلية).
  const nextActions = [
    ...supported.slice(0, 3).map((r) => `راجع توصية: ${r.recommendation}`),
    ...opportunities.slice(0, 3).map((o) => `فرصة: ${o}`),
  ];
  steps.push({ step: 'إنشاء الإجراءات التالية', outcome: `${nextActions.length} إجراء داخلي مقترح (لا تنفيذ خارجي).`, externalAction: false });

  // 7) القرارات التي تحتاج المالك.
  steps.push({ step: 'تصعيد قرارات المالك', outcome: `${input.decisions.length} قراراً يحتاج مراجعة.`, externalAction: false });

  return {
    steps,
    anomalies,
    nextActions,
    pendingDecisions: input.decisions,
    note: 'الدورة اليومية تحليلية فقط: لا نشر ولا رد ولا تعديل — التنفيذ يخضع لبوابات الصلاحيات.',
  };
}

export interface WeeklyBrainReviewResult {
  whatWorked: string[];
  whatFailed: string[];
  whoResponded: string[];
  audienceChanges: string[];
  topicsGrew: string[];
  buyingSignals: string[];
  shouldStop: string[];
  shouldContinue: string[];
  shouldTest: string[];
  shouldAdaptAcrossPlatforms: string[];
  limitations: string[];
  note: string;
}

/**
 * مراجعة أسبوعية استراتيجية: تُجيب الأسئلة العشرة من بيانات حقيقية فقط، وأي سؤال
 * بلا دليل يُجاب صراحةً بأن البيانات غير كافية.
 */
export function runWeeklyBrainReview(input: {
  experiments: Experiment[];
  recommendations: ExplainableRecommendation[];
  /** موضوعات متكررة من التعليقات (اسم + عدد). */
  topics?: Array<{ topic: string; count: number }>;
  /** إشارات شراء موثّقة (نصوص). */
  buyingSignals?: string[];
  /** مرشّحات تكييف عبر المنصات (فرضيات، لا حقائق). */
  crossPlatformCandidates?: string[];
  platforms?: PlatformId[];
}): WeeklyBrainReviewResult {
  const concluded = input.experiments.filter((e) => e.status === 'concluded');
  const supported = input.recommendations.filter((r) => r.status === 'supported');

  const whatWorked = concluded.filter((e) => e.verdict === 'supports_hypothesis').map((e) => e.learning || e.hypothesis);
  const whatFailed = concluded.filter((e) => e.verdict === 'rejects_hypothesis').map((e) => e.learning || e.hypothesis);
  const inconclusive = concluded.filter((e) => e.verdict === 'inconclusive').length;

  const topics = input.topics || [];
  const topicsGrew = topics.filter((t) => t.count >= 3).map((t) => `${t.topic} (${t.count})`);

  return {
    whatWorked: whatWorked.length ? whatWorked : ['لا تجارب محسومة بنجاح هذا الأسبوع؛ لا ادعاء.'],
    whatFailed: whatFailed.length ? whatFailed : ['لا تجارب محسومة بفشل هذا الأسبوع.'],
    whoResponded: topics.length ? [`موضوعات تفاعل حقيقية: ${topics.map((t) => `${t.topic}(${t.count})`).join(', ')}`] : ['لا استجابات موثّقة كافية لوصف الجمهور المستجيب.'],
    audienceChanges: ['لا تُدَّعى تغيّرات جمهور بلا بيانات جمهور (غير متاحة عبر الواجهات الحالية).'],
    topicsGrew: topicsGrew.length ? topicsGrew : ['لا نمو موثّق في موضوعات هذا الأسبوع.'],
    buyingSignals: (input.buyingSignals && input.buyingSignals.length) ? input.buyingSignals : ['لا إشارات شراء موثّقة هذا الأسبوع.'],
    shouldStop: inconclusive >= 2 ? ['أوقف التجارب غير الحاسمة المتكررة بلا تغيير متغيّر.'] : ['لا شيء موثّق يستدعي الإيقاف.'],
    shouldContinue: supported.slice(0, 3).map((r) => r.recommendation),
    shouldTest: supported.slice(0, 2).map((r) => r.nextTest).filter(Boolean) as string[],
    shouldAdaptAcrossPlatforms: (input.crossPlatformCandidates && input.crossPlatformCandidates.length)
      ? input.crossPlatformCandidates.map((c) => `فرضية تكييف عبر المنصات (تحتاج اختباراً مستقلاً): ${c}`)
      : ['لا مرشّح تكييف موثّق؛ نجاح منصة لا يُعتبر دليل نجاح أخرى.'],
    limitations: [
      'المراجعة مبنية على بيانات فعلية فقط؛ الأسئلة بلا دليل تُجاب بعدم الكفاية.',
      'نجاح منصة لا يُعمَّم على أخرى؛ يُسجَّل كفرضية تكييف.',
    ],
    note: 'مراجعة أسبوعية صادقة: ما نجح/فشل/يُختبر موثّق؛ والمجهول معلن.',
  };
}
