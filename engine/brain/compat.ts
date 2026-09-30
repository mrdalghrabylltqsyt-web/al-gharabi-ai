/**
 * Central Brain Compatibility Facade — إسقاط الشكل القديم من الحالة canonical.
 *
 * المصدر الوحيد للحقيقة هو `buildRuntimeBrain` في `engine/brain/runtime.ts`. هذا
 * الملف **لا يبني عقلاً مستقلاً ولا يجمع بيانات من جديد**: يستقبل حالة العقل
 * canonical (`CentralBrainState`) ويعيد الشكل القديم (`CentralBrainSnapshot`) الذي
 * تعتمده مسارات `/api/brain/*` وأداة الوكيل `brain_snapshot` والجاهزية — للتوافق
 * فقط، بلا business logic مكرر (يستدعي دوال العرض القائمة نفسها على بيانات
 * الحالة canonical).
 */

import type { PlatformCapability } from '../social/adapter';
import { PLATFORM_SPECS } from '../social/registry';
import type { CentralBrainSnapshot, BrainDiagnosticsCounters } from '../social/centralBrain';
import { summarizeCrossPlatformLearning } from '../social/platformLearning';
import { buildRecommendationBundle } from '../social/recommendationEngine';
import { analyzeCrossPlatformAudience } from '../social/audienceIntelligence';
import { buildContentPlan, type ContentBrief } from '../social/contentIntelligence';
import type { CentralBrainState } from './state';

export interface CompatSnapshotExtras {
  /** أوقات تفاعل حقيقية (سجل المراقب) لتحليل أوقات التوصية — إدخال قديم فقط. */
  engagementTimestamps?: Array<string | null | undefined>;
  /** خطة محتوى إن قُدّم brief (اختيارية، كما في الشكل القديم). */
  contentBrief?: ContentBrief | null;
  recommendedPublishTime?: string | null;
  schedulingReason?: string;
}

/**
 * يعيد الشكل القديم للقطة العقل من الحالة canonical نفسها. كل حقل يُشتق من
 * `state` (records/commentsByPlatform/ai/limitations/platformStates) — لا مصدر
 * بيانات ثانٍ، ولا استدعاء لأي مُجمِّع عقلي مستقل.
 */
export function toCentralBrainSnapshot(state: CentralBrainState, extras: CompatSnapshotExtras = {}): CentralBrainSnapshot {
  const platforms = state.platformStates.map((p) => p.platform);

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

  const learning = summarizeCrossPlatformLearning(state.records, platforms);
  const recommendations = platforms.length
    ? buildRecommendationBundle({ platforms, records: state.records, engagementTimestamps: extras.engagementTimestamps })
    : null;
  const audience = platforms.length
    ? analyzeCrossPlatformAudience({ platforms, records: state.records, commentsByPlatform: state.commentsByPlatform })
    : null;
  const contentPlan = extras.contentBrief
    ? buildContentPlan({
        brief: extras.contentBrief,
        recommendedPublishTime: extras.recommendedPublishTime ?? null,
        schedulingReason: extras.schedulingReason,
      })
    : null;

  return {
    platforms: platformViews,
    learning,
    recommendations,
    audience,
    contentPlan,
    ai: state.ai as BrainDiagnosticsCounters,
    limitations: state.limitations,
    note: 'لقطة العقل المركزي: تحليل وتخطيط وتوصيات قابلة للتفسير فقط — بلا تنفيذ خارجي وبلا أسرار.',
  };
}
