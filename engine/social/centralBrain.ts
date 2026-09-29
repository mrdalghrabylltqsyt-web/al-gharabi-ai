/**
 * Central Brain — المنسّق العام للعقل المركزي لكل المنصات.
 *
 * يجمع الطبقات العامة (Content Intelligence، Learning، Recommendation، Audience،
 * Comment Intelligence) في مخرَج واحد قابل للتفسير، ويعمل على `PlatformId`
 * وقدراتها فقط — فلا يعرف أي شيء خاص بمنصة بعينها. إضافة منصة جديدة لا تتطلب
 * تعديل هذا الملف، فقط تسجيلها بقدراتها في السجل.
 *
 * قواعد ملزمة:
 * - لا تنفيذ نشر/رد هنا: العقل يخطّط ويوصي، والتنفيذ يمر ببوابات الصلاحيات.
 * - كل مخرَج يحمل مصدره وعيّنته وحدوده.
 * - القدرة غير المعلنة للمنصة = غير متاحة صراحةً؛ لا يُدَّعى عكسها.
 */

import type { PlatformId, PlatformCapability } from './adapter';
import { PLATFORM_SPECS } from './registry';
import { buildContentPlan, type ContentBrief, type ContentPlan } from './contentIntelligence';
import { summarizeCrossPlatformLearning, type PlatformMetricRecord, type PlatformLearningSample } from './platformLearning';
import { buildRecommendationBundle, type RecommendationBundle } from './recommendationEngine';
import { analyzeCrossPlatformAudience, type AudienceAnalysis } from './audienceIntelligence';
import { classifyComment, generateReply, canAutoReply, type ClassifiedComment, type ReplyFactSet } from './comments';

// ---------------------------------------------------------------------------
// Comment Intelligence الموحّد
// ---------------------------------------------------------------------------

export type CommentPriority = 'urgent' | 'high' | 'normal' | 'low';
export type CommentResponsePolicy = 'reply' | 'escalate' | 'skip';

export interface CommentIntelligence {
  platform: PlatformId;
  classification: ClassifiedComment;
  priority: CommentPriority;
  policy: CommentResponsePolicy;
  /** هل تدعم المنصة قراءة التعليقات فعلاً؟ إن لا، فهذا الحكم نظري لا ادعاء. */
  platformReadsComments: boolean;
  /** هل تدعم المنصة الرد على التعليقات فعلاً؟ */
  platformReplies: boolean;
  /** القرار النهائي صادق مع قدرة المنصة. */
  decision: 'reply' | 'escalate' | 'skip' | 'unsupported';
  reason: string;
}

/** قدرات المنصة من المصدر الوحيد (السجل) — لا تُخترع قدرة. */
export function platformCapabilities(platform: PlatformId): readonly PlatformCapability[] {
  const spec = PLATFORM_SPECS.find((s) => s.platform === platform);
  return spec ? spec.capabilities : [];
}

function priorityFor(cls: ClassifiedComment): CommentPriority {
  if (cls.requiresHumanReview) return 'urgent';
  if (cls.isComplaint) return 'high';
  if (cls.isBusinessInquiry) return 'high';
  if (cls.isQuestion) return 'normal';
  if (cls.isPraise) return 'low';
  return 'normal';
}

/**
 * وحّد دورة التعليق على مستوى العقل: classify → sentiment → intent → priority →
 * response policy → reply/escalate/skip، مع احترام قدرة المنصة الفعلية. المنصة
 * التي لا توفّر واجهة تعليقات تُعلن `unsupported` بدل ادعاء قراءة/رد.
 */
export function buildCommentIntelligence(input: {
  platform: PlatformId;
  text: string;
}): CommentIntelligence {
  const caps = platformCapabilities(input.platform);
  const readsComments = caps.includes('comments');
  const replies = caps.includes('comment_reply');
  const cls = classifyComment(input.text);

  if (!readsComments) {
    return {
      platform: input.platform,
      classification: cls,
      priority: 'low',
      policy: 'skip',
      platformReadsComments: false,
      platformReplies: replies,
      decision: 'unsupported',
      reason: `المنصة ${input.platform} لا توفّر قراءة تعليقات عبر واجهتها الرسمية؛ لا يُدَّعى تحليل تعليقاتها.`,
    };
  }

  const priority = priorityFor(cls);
  let policy: CommentResponsePolicy;
  if (!canAutoReply(cls)) policy = cls.isSpam ? 'skip' : 'escalate';
  else policy = 'reply';
  // إن كانت المنصة تقرأ التعليقات لكن لا تردّ، يُحوَّل الرد لمراجعة/إحالة.
  if (policy === 'reply' && !replies) {
    return {
      platform: input.platform,
      classification: cls,
      priority,
      policy: 'escalate',
      platformReadsComments: true,
      platformReplies: false,
      decision: 'escalate',
      reason: 'المنصة لا توفّر الرد على التعليقات عبر واجهتها الرسمية؛ يُحوَّل للمراجعة البشرية.',
    };
  }
  const decision: CommentIntelligence['decision'] = policy === 'reply' ? 'reply' : policy === 'escalate' ? 'escalate' : 'skip';
  return {
    platform: input.platform,
    classification: cls,
    priority,
    policy,
    platformReadsComments: true,
    platformReplies: replies,
    decision,
    reason: decision === 'reply'
      ? 'تعليق حميد؛ يُسمح برد آلي حسب السياسة.'
      : decision === 'skip'
        ? 'سبام؛ لا يُرد عليه آلياً.'
        : 'يستوجب مراجعة بشرية قبل أي رد.',
  };
}

/** يبني رداً حتمياً مقترحاً للتعليق (بلا استهلاك حصة)، إن كانت السياسة تسمح. */
export function proposeCommentReply(intel: CommentIntelligence, facts: ReplyFactSet = {}, productHint?: string): { reply: string | null; policy: CommentResponsePolicy; reason: string } {
  if (intel.decision !== 'reply') return { reply: null, policy: intel.policy, reason: intel.reason };
  const merged: ReplyFactSet = { ...facts };
  if (productHint && !merged.productName) merged.productName = productHint;
  const generated = generateReply(intel.classification, merged, {});
  return { reply: generated.text || null, policy: 'reply', reason: generated.reason };
}

// ---------------------------------------------------------------------------
// لقطة العقل المركزي
// ---------------------------------------------------------------------------

export interface BrainDiagnosticsCounters {
  providerCalls: number;
  cacheHits: number;
  inflightJoins: number;
  guardBlocked: number;
  deterministic: number;
  fallback: number;
  providerErrors: number;
}

export interface CentralBrainSnapshot {
  /** المنصات المُدخلة مع حالة قدراتها (بلا ادعاء اتصال). */
  platforms: Array<{
    platform: PlatformId;
    capabilities: PlatformCapability[];
    readsComments: boolean;
    repliesToComments: boolean;
    publishes: boolean;
    realConnector: boolean;
  }>;
  learning: ReturnType<typeof summarizeCrossPlatformLearning>;
  recommendations: RecommendationBundle | null;
  audience: AudienceAnalysis | null;
  /** خطة محتوى إن قُدّم brief. */
  contentPlan: ContentPlan | null;
  ai: BrainDiagnosticsCounters;
  limitations: string[];
  note: string;
}

export interface BuildCentralBrainSnapshotInput {
  platforms: PlatformId[];
  /** سجلات أداء حقيقية من المنصات. */
  records?: PlatformMetricRecord[];
  previousRecords?: PlatformMetricRecord[];
  engagementTimestamps?: Array<string | null | undefined>;
  commentsByPlatform?: Partial<Record<PlatformId, Array<{ text: string; authorName?: string }>>>;
  contentBrief?: ContentBrief | null;
  recommendedPublishTime?: string | null;
  schedulingReason?: string;
  aiCounters?: BrainDiagnosticsCounters;
}

/**
 * يبني لقطة العقل المركزي: قدرات المنصات + التعلّم + التوصيات + الجمهور + خطة
 * المحتوى + عدّادات الحماية. لا تنفيذ ولا أسررا؛ فقط تحليل وتخطيط قابل للتفسير.
 */
export function buildCentralBrainSnapshot(input: BuildCentralBrainSnapshotInput): CentralBrainSnapshot {
  const platforms = input.platforms;
  const records = input.records || [];

  const platformViews = platforms.map((p) => {
    const caps = platformCapabilities(p);
    const spec = PLATFORM_SPECS.find((s) => s.platform === p);
    return {
      platform: p,
      capabilities: [...caps] as PlatformCapability[],
      readsComments: caps.includes('comments'),
      repliesToComments: caps.includes('comment_reply'),
      publishes: caps.includes('publish'),
      realConnector: Boolean(spec?.realConnector),
    };
  });

  const learning = summarizeCrossPlatformLearning(records, platforms);
  const recommendations = platforms.length
    ? buildRecommendationBundle({
        platforms,
        records,
        previousRecords: input.previousRecords,
        engagementTimestamps: input.engagementTimestamps,
      })
    : null;

  const hasAnyComments = Boolean(input.commentsByPlatform && Object.values(input.commentsByPlatform).some((c) => c && c.length));
  const audience = platforms.length
    ? analyzeCrossPlatformAudience({ platforms, records, commentsByPlatform: input.commentsByPlatform })
    : null;

  const contentPlan = input.contentBrief
    ? buildContentPlan({
        brief: input.contentBrief,
        recommendedPublishTime: input.recommendedPublishTime ?? null,
        schedulingReason: input.schedulingReason,
      })
    : null;

  const limitations: string[] = [];
  if (!records.length) limitations.push('لا سجلات أداء حقيقية بعد؛ التعلّم والتوصيات محدودة.');
  if (!hasAnyComments) limitations.push('لا تعليقات مقروءة عبر الواجهات الرسمية للتحليل الجماهيري.');
  limitations.push('المنصات التي لا توفّر مؤشراً أو تعليقات تُعلن ذلك صراحةً، ولا تُخترع قيمتها.');
  limitations.push('العقل لا ينشر ولا يرد تلقائياً؛ التنفيذ يخضع لبوابات الصلاحيات والمراجعة البشرية.');

  return {
    platforms: platformViews,
    learning,
    recommendations,
    audience,
    contentPlan,
    ai: input.aiCounters || { providerCalls: 0, cacheHits: 0, inflightJoins: 0, guardBlocked: 0, deterministic: 0, fallback: 0, providerErrors: 0 },
    limitations,
    note: 'لقطة العقل المركزي: تحليل وتخطيط وتوصيات قابلة للتفسير فقط — بلا تنفيذ خارجي وبلا أسرار.',
  };
}
