/**
 * Central Brain Compatibility Facade — إسقاط الشكل القديم من الحالة canonical.
 *
 * المصدر الوحيد للحقيقة هو `buildRuntimeBrain` في `engine/brain/runtime.ts`. هذا
 * الملف **لا يبني عقلاً مستقلاً ولا يعيد تشغيل أي محرّك توصية/جمهور/تعلّم/تخطيط
 * مستقل**: يستقبل حالة العقل canonical (`CentralBrainState`) ويعيد الشكل القديم
 * (`CentralBrainSnapshot`) الذي تعتمده مسارات `/api/brain/*` وأداة الوكيل
 * `brain_snapshot` والجاهزية — للتوافق فقط.
 *
 * كل حقل مشتق من `state` مباشرةً:
 * - `learning` من `state.crossPlatformLearning` (مُشتق أصلاً من `state.records`).
 * - `recommendations` من `state.recommendations` (توصيات العقل canonical).
 * - `audience` من `state.audience` (نموذج الجمهور canonical).
 * - `contentPlan` من brief يُمرَّر (إدخال عرض قديم) عبر `buildContentPlan` الحتمي.
 */

import type { PlatformCapability } from '../social/adapter';
import { PLATFORM_SPECS } from '../social/registry';
import type { CentralBrainSnapshot, BrainDiagnosticsCounters } from '../social/centralBrain';
import { buildContentPlan, type ContentBrief } from '../social/contentIntelligence';
import type { RecommendationBundle, ExplainableRecommendation } from '../social/recommendationEngine';
import type { AudienceAnalysis, AudienceObservation } from '../social/audienceIntelligence';
import type { CentralBrainState } from './state';

export interface CompatSnapshotExtras {
  /** أوقات تفاعل حقيقية (سجل المراقب) — يُمرَّر للعرض فقط، لا يُعيد تشغيل محرّك توصية. */
  engagementTimestamps?: Array<string | null | undefined>;
  /** خطة محتوى إن قُدّم brief (اختيارية، كما في الشكل القديم). */
  contentBrief?: ContentBrief | null;
  recommendedPublishTime?: string | null;
  schedulingReason?: string;
}

/**
 * يُسقط توصيات العقل canonical إلى حزمة الشكل القديم (`RecommendationBundle`)
 * بلا إعادة حساب. أي نقص عيّنة يُعلن `insufficient_sample` صراحةً.
 */
function projectRecommendationBundle(state: CentralBrainState): RecommendationBundle {
  const recommendations: ExplainableRecommendation[] = state.recommendations.map((r) => ({
    kind: r.id.startsWith('rec-timing') ? 'publish_time' : 'content_type',
    recommendation: r.recommendation,
    reason: r.reason,
    evidence: r.evidence.join(' | '),
    source: r.source.join(' | '),
    sampleSize: r.sampleSize,
    confidence: r.confidence === 'high' ? 'medium' : r.confidence,
    status: r.status,
    limitations: r.limitations,
  }));
  const sampleSize = state.records.length;
  const sufficientSample = recommendations.some((r) => r.status === 'supported');
  const dataGaps: string[] = [];
  if (!sufficientSample) dataGaps.push(`لا توصيات مدعومة ببيانات كافية بعد (سجلات الأداء: ${sampleSize}).`);
  for (const p of state.platformStates) {
    const learning = state.crossPlatformLearning.byPlatform.find((s) => s.platform === p.platform);
    if (learning && !learning.sufficientSample) dataGaps.push(`عيّنة ${p.platform} غير كافية (${learning.sampleSize}).`);
  }
  return {
    sampleSize,
    sufficientSample,
    recommendations,
    dataGaps,
    note: 'توصيات مُسقطة من حالة العقل canonical نفسها (لا إعادة حساب). لا تضمن وصولاً ولا مشاهدات، والتنفيذ يخضع لبوابات الصلاحيات.',
  };
}

/** يُسقط نموذج الجمهور canonical إلى شكل التحليل القديم بلا إعادة حساب. */
function projectAudienceAnalysis(state: CentralBrainState): AudienceAnalysis | null {
  const model = state.audience;
  if (!model) return null;
  const observations: AudienceObservation[] = [];
  for (const segment of model.segments) {
    for (const ev of segment.evidence) {
      observations.push({
        observation: ev.statement,
        basis: ev.source,
        sampleSize: ev.sampleSize,
        confidence: segment.confidence === 'high' ? 'medium' : segment.confidence,
      });
    }
  }
  const topicCounts = new Map<string, number>();
  for (const segment of model.segments) {
    for (const topic of segment.interests) topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
  }
  return {
    platform: model.platform,
    observations,
    frequentTopics: [...topicCounts.entries()].sort((a, b) => b[1] - a[1]).map(([topic, count]) => ({ topic, count })),
    intentBreakdown: {},
    demographicsAvailable: false,
    note: 'تحليل جمهور مُسقط من نموذج العقل canonical نفسه (لا إعادة حساب). لا سمات شخصية حساسة.',
    limitations: [...model.limitations],
  };
}

/**
 * يعيد الشكل القديم للقطة العقل من الحالة canonical نفسها. كل حقل يُشتق من
 * `state` — لا مصدر بيانات ثانٍ، ولا استدعاء لأي مُجمِّع عقلي مستقل.
 */
export function toCentralBrainSnapshot(state: CentralBrainState, extras: CompatSnapshotExtras = {}): CentralBrainSnapshot {
  const platformViews = state.platformStates.map((ps) => {
    const spec = PLATFORM_SPECS.find((s) => s.platform === ps.platform);
    const caps = (spec?.capabilities || []) as PlatformCapability[];
    return {
      platform: ps.platform,
      capabilities: [...caps] as PlatformCapability[],
      readsComments: caps.includes('comments'),
      repliesToComments: caps.includes('comment_reply'),
      publishes: caps.includes('publish'),
      realConnector: Boolean(spec?.realConnector),
    };
  });

  const contentPlan = extras.contentBrief
    ? buildContentPlan({
        brief: extras.contentBrief,
        recommendedPublishTime: extras.recommendedPublishTime ?? null,
        schedulingReason: extras.schedulingReason,
      })
    : null;

  return {
    platforms: platformViews,
    learning: state.crossPlatformLearning,
    recommendations: projectRecommendationBundle(state),
    audience: projectAudienceAnalysis(state),
    contentPlan,
    ai: state.ai as BrainDiagnosticsCounters,
    limitations: state.limitations,
    note: 'لقطة العقل المركزي: إسقاط توافقي من الحالة canonical — بلا إعادة حساب ولا تنفيذ خارجي ولا أسرار.',
  };
}
