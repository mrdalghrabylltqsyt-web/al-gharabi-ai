/**
 * Central Brain Projections — إسقاطات توافقية بحتة من الحالة canonical.
 *
 * هذا الملف **ليس مصدر قرار ولا مصدر ذاكرة**: يستقبل `CentralBrainState` الناتج
 * من `buildRuntimeBrain` (المصدر الوحيد) ويعيد أشكالاً قديمة للتوافق فقط:
 * - `toMarketingDecisionProjection`: شكل القرار التسويقي القديم (`MarketingDecision`).
 * - `toOperationalMemoryProjection`: شكل الذاكرة التشغيلية القديم.
 *
 * قواعد ملزمة:
 * - لا إعادة حساب أي قرار/توصية/جمهور/تعلّم — كل حقل مشتق من الحالة مباشرةً.
 * - التصنيف هنا حتمي (بلا AI) ومُعاد استخدامه من `engine/social/comments.ts`.
 * - لا أسرار ولا شبكة ولا تنفيذ.
 */

import type { PlatformId } from '../social/adapter';
import { classifyComment } from '../social/comments';
import { PLATFORM_CONTENT_PROFILES } from '../social/contentIntelligence';
import { TIMING_WINDOW_LABELS_AR } from './timing/timingModel';
import type { CentralBrainState } from './state';

// ---------------------------------------------------------------------------
// القرار التسويقي (شكل قديم) — إسقاط من الحالة canonical
// ---------------------------------------------------------------------------

export interface AudienceProfileProjection {
  segments: string[];
  dataAvailable: boolean;
  note: string;
}

export interface ContentPlanItemProjection {
  platform: PlatformId;
  contentType: string;
  format: string;
  suggestedTiming: string;
  timingConfidence: 'estimated' | 'measured';
  reason: string;
  successMetric: string;
  metricAvailable: boolean;
}

export interface MarketingDecisionProjection {
  audience: AudienceProfileProjection;
  objective: string;
  plan: ContentPlanItemProjection[];
  learnings: string[];
  nextAdjustment: string;
  dataGaps: string[];
}

export interface MarketingDecisionProjectionInput {
  state: CentralBrainState;
  objective?: string | null;
  /** حقول الذاكرة القديمة (سجلات) للتوافق مع حقول `learnings`. */
  memory?: OperationalMemoryProjection | null;
}

/**
 * يُسقط حالة العقل canonical إلى شكل القرار التسويقي القديم. كل حقل مشتق من
 * `state` (الجمهور/التوصيات/التعلّم/الأداء) — لا بناء قرار مستقل.
 */
export function toMarketingDecisionProjection(input: MarketingDecisionProjectionInput): MarketingDecisionProjection {
  const { state } = input;

  // الجمهور: من نموذج الجمهور canonical مباشرةً.
  const audienceSegments = (state.audience?.segments || []).map((s) => s.label);
  const dataAvailable = (state.audience?.sampleSize || 0) > 0;

  // خطة المنصات: حتمية من ملفات المحتوى لكل منصة (لا منطق استراتيجي مستقل).
  const plan: ContentPlanItemProjection[] = state.platformStates.map((ps) => {
    const profile = PLATFORM_CONTENT_PROFILES[ps.platform];
    const learning = state.crossPlatformLearning.byPlatform.find((s) => s.platform === ps.platform);
    const metricAvailable = Boolean(learning?.sufficientSample);
    const timing = state.timingStrategy;
    const measured = Boolean(timing && timing.status === 'supported' && timing.window && state.records.length > 0);
    return {
      platform: ps.platform,
      contentType: profile?.format || 'منشور',
      format: profile?.format || 'صيغة قياسية',
      suggestedTiming: measured ? TIMING_WINDOW_LABELS_AR[timing!.window!] : 'مساءً (تقديري)',
      timingConfidence: measured ? 'measured' : 'estimated',
      reason: measured
        ? 'الصيغة حسب طبيعة المنصة، والتوقيت مدعوم ببيانات أداء مسجّلة.'
        : 'الصيغة حسب طبيعة المنصة؛ التوقيت تقديري حتى تتوفر بيانات أداء فعلية.',
      successMetric: 'views',
      metricAvailable,
    };
  });

  // التعلّم: من تعلّم العقل canonical (لا محرّك ثانٍ).
  const learnings: string[] = [];
  for (const s of state.crossPlatformLearning.byPlatform) {
    if (s.insights > 0) learnings.push(`على ${s.platform}: ${s.insights} نمط أداء مسجّل بعيّنة ${s.sampleSize}.`);
  }
  const frequentQuestions = input.memory?.frequentQuestions || [];
  if (frequentQuestions.length) learnings.push(`الأسئلة الأكثر تكراراً من الجمهور: ${frequentQuestions.slice(0, 3).join(' | ')}.`);
  if (!learnings.length) learnings.push('لم تُسجَّل أي مؤشرات أداء بعد؛ لا يمكن الجزم بأفضل منصة أو أفضل وقت بشكل موثوق.');

  // فجوات البيانات: من التعلّم canonical (مؤشرات غير متاحة + عيّنات ناقصة).
  const dataGaps: string[] = [];
  const insufficient = state.crossPlatformLearning.byPlatform.filter((s) => !s.sufficientSample).map((s) => s.platform);
  if (insufficient.length) dataGaps.push(`عيّنة أداء غير كافية على: ${insufficient.join(', ')}.`);
  const unavailableMetrics = new Set(state.crossPlatformLearning.unavailableByPlatform.map((u) => u.metric));
  if (unavailableMetrics.size) dataGaps.push(`مؤشرات غير متاحة عبر الواجهات الرسمية: ${[...unavailableMetrics].join(', ')} — لا تُخترع قيمتها.`);
  if (!dataAvailable) dataGaps.push('لا بيانات جمهور فعلية بعد؛ التوصيات مبنية على خصائص الصيغة لا على قياس.');

  const measuredAny = state.records.length > 0 && state.recommendations.some((r) => r.status === 'supported');
  const nextAdjustment = measuredAny
    ? 'قارن أداء المنشور القادم بأفضل منشور مسجل، وعدّل الصيغة نحو ما حقق أعلى وصول فعلي.'
    : 'ابدأ باختبار صيغتين مختلفتين على نفس المنصة، ثم سجّل النتائج لبناء قياس حقيقي قبل أي تعديل استراتيجي.';

  return {
    audience: {
      segments: audienceSegments,
      dataAvailable,
      note: state.audience?.note || 'لا نموذج جمهور بعد؛ لا تُخترع شرائح.',
    },
    objective: String(input.objective || 'تنمية تفاعل حقيقي وتحويلات مباشرة'),
    plan,
    learnings,
    nextAdjustment,
    dataGaps,
  };
}

// ---------------------------------------------------------------------------
// الذاكرة التشغيلية (شكل قديم) — إسقاط من الحالة canonical
// ---------------------------------------------------------------------------

export interface OperationalMemoryProjection {
  publishedCount: number;
  scheduledCount: number;
  platformBreakdown: Record<string, number>;
  contentTypeBreakdown: Record<string, number>;
  topComments: string[];
  frequentQuestions: string[];
  decisions: Array<{ decision: string; at: string; reason: string }>;
  strategiesTested: Array<{ strategy: string; outcome: string; at: string }>;
}

/** سجلات قديمة للتوافق (تُمرَّر من المخزن كما هي، بلا إعادة بناء قرار). */
export interface LegacyMemoryRecords {
  decisions?: Array<{ decision: string; at: string; reason: string }>;
  strategiesTested?: Array<{ strategy: string; outcome: string; at: string }>;
}

/**
 * يُسقط حالة العقل canonical إلى شكل الذاكرة التشغيلية القديم. العدّادات من
 * سجلات الأداء canonical، والأسئلة من تعليقات الحالة نفسها (تصنيف حتمي)،
 * والسجلات القديمة تُمرَّر كما هي (لا قرار يُعاد بناؤه هنا).
 */
export function toOperationalMemoryProjection(state: CentralBrainState, legacy: LegacyMemoryRecords = {}): OperationalMemoryProjection {
  const platformBreakdown: Record<string, number> = {};
  for (const r of state.records) platformBreakdown[r.platform] = (platformBreakdown[r.platform] || 0) + 1;

  const contentTypeBreakdown: Record<string, number> = {};
  for (const r of state.records) {
    const key = (r.contentType || r.productCategory || '').trim();
    if (key) contentTypeBreakdown[key] = (contentTypeBreakdown[key] || 0) + 1;
  }

  const allComments = Object.values(state.commentsByPlatform || {}).flat().filter(Boolean) as Array<{ text: string }>;
  const topComments = allComments.map((c) => String(c.text || '').slice(0, 80)).filter(Boolean).slice(0, 10);
  const frequentQuestions: string[] = [];
  for (const c of allComments) {
    const cls = classifyComment(String(c.text || ''));
    if (cls.isQuestion || cls.isBusinessInquiry) frequentQuestions.push(String(c.text || '').replace(/\s+/g, ' ').trim().slice(0, 80));
  }

  // "published" من سجلات النشر الحقيقية في الحالة canonical (لا من سجلات الأداء).
  return {
    publishedCount: state.publishSummary.published,
    scheduledCount: state.publishSummary.scheduled,
    platformBreakdown,
    contentTypeBreakdown,
    topComments,
    frequentQuestions: [...new Set(frequentQuestions.filter(Boolean))].slice(0, 10),
    decisions: (legacy.decisions || []).slice(0, 50),
    strategiesTested: (legacy.strategiesTested || []).slice(0, 50),
  };
}
