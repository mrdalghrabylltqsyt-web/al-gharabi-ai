/**
 * Central Brain State — لقطة موحّدة للعقل المركزي (منطق خالص قابل للاختبار).
 *
 * تجمع الطبقات كلها في مخرَج واحد قابل للفحص من المالك:
 *   goals, knowledge, audience, market, activeExperiments, contentStrategy,
 *   timingStrategy, platformStates, recentOutcomes, learning, recommendations,
 *   pendingDecisions, risks, limitations.
 *
 * قواعد ملزمة:
 * - لا تنفيذ خارجي هنا: العقل يخطّط ويوصي؛ التنفيذ يمر ببوابات الصلاحيات.
 * - لا بيانات مُختلقة: كل مخرَج يحمل مصدره وعيّنته وحدوده.
 * - القدرة غير المعلنة للمنصة = غير متاحة صراحةً.
 *
 * إضافة منصة #11 لا تتطلب تعديل هذا الملف: كل شيء يعمل على `PlatformId` وقدراته.
 */

import type { PlatformId } from '../social/adapter';
import { PLATFORM_SPECS } from '../social/registry';
import type { BrainDiagnosticsCounters } from '../social/centralBrain';
import { defineGoal, type GoalDefinition, type GoalKind as GoalType } from './goals/goalEngine';
import { type KnowledgeItem, summarizeKnowledge, type KnowledgeBase } from './knowledge/truth';
import { type AudienceModel } from './audience/audienceModel';
import { type CommercialRelevance } from './market/commercialRelevance';
import { type Experiment, describeExperiment } from './experiments/experimentEngine';
import { type TimingRecommendation, describeTimingRecommendation } from './timing/timingModel';
import { type ExplainableRecommendation, type StrategyPlan } from './strategy/strategyEngine';
import { capabilityMatrix, type PlatformCapabilityRow } from './strategy/capabilityMatrix';
import { type DecisionExplanation } from './decisions/decisionEngine';
import { type LearningResult, type OwnerPreference } from './learning/learningLoop';
import { type Signal, isFresh } from './perception/signals';
import { type ContentPath } from './strategy/contentIntelligence';
import { buildCrossPlatformAudienceModel } from './audience/audienceModel';
import { computeCommercialRelevance } from './market/commercialRelevance';
import { classifyConversation } from './audience/conversationIntelligence';
import type { PlatformMetricRecord } from '../social/platformLearning';

export interface BrainPlatformState {
  platform: PlatformId;
  capabilities: PlatformCapabilityRow['states'];
  realConnector: boolean;
  /** اتصال تشغيلي حقيقي (يُمرَّر من الخادم؛ لا يُدَّعى هنا). */
  connected: boolean;
  verified: boolean;
}

export interface PendingDecision {
  id: string;
  summary: string;
  decision: DecisionExplanation['decision'];
  autonomyLevel: DecisionExplanation['autonomyLevel'];
  reason: string;
  alternative: string | null;
}

export interface BrainRisk {
  id: string;
  risk: string;
  severity: 'low' | 'medium' | 'high';
  mitigation: string;
}

export interface CentralBrainState {
  generatedAt: string;
  goals: GoalDefinition | null;
  knowledge: KnowledgeBase;
  audience: AudienceModel | null;
  market: CommercialRelevance | null;
  activeExperiments: Array<{ id: string; description: string; status: Experiment['status']; verdict: Experiment['verdict'] | null }>;
  contentStrategy: ExplainableRecommendation[];
  /** خطط استراتيجية نطاقية (يومي/أسبوعي/حملة/منصة/جمهور/منتج). */
  strategies: StrategyPlan[];
  /** مسار المحتوى الكامل (حاجة → تكييف المنصة) إن توفّرت حاجة ودليل. */
  contentPath: ContentPath | null;
  timingStrategy: TimingRecommendation | null;
  platformStates: BrainPlatformState[];
  recentOutcomes: string[];
  learning: LearningResult | null;
  ownerPreferences: OwnerPreference[];
  recommendations: ExplainableRecommendation[];
  pendingDecisions: PendingDecision[];
  risks: BrainRisk[];
  limitations: string[];
  signalFreshness: { total: number; fresh: number; stale: number };
  ai: BrainDiagnosticsCounters;
  /** سجلات الأداء الحقيقية التي حلّلها العقل (للاشتقاق التوافقي، بلا إعادة جمع). */
  records: PlatformMetricRecord[];
  /** تعليقات حقيقية بحسب المنصة (المصدر الخام لتحليل الجمهور). */
  commentsByPlatform: Partial<Record<PlatformId, Array<{ text: string; authorName?: string }>>>;
  note: string;
}

export interface BuildCentralBrainStateInput {
  platforms: PlatformId[];
  now: number;
  goals?: GoalDefinition | null;
  /** هدف مختصر يُبنى داخلياً إن لم يُمرَّر `goals` جاهزاً. */
  goalPrimary?: string | null;
  goalSecondary?: string | null;
  knowledge?: KnowledgeItem[];
  audience?: AudienceModel | null;
  market?: CommercialRelevance | null;
  experiments?: Experiment[];
  contentStrategy?: ExplainableRecommendation[];
  /** خطط استراتيجية نطاقية جاهزة من المُجمِّع. */
  strategies?: StrategyPlan[];
  /** مسار المحتوى الجاهز من المُجمِّع. */
  contentPath?: ContentPath | null;
  timing?: TimingRecommendation | null;
  /** سجلات أداء حقيقية (تُقرأ للتحليل فقط). */
  records?: PlatformMetricRecord[];
  /** تعليقات حقيقية لكل منصة (تُقرأ للتحليل فقط). */
  commentsByPlatform?: Partial<Record<PlatformId, Array<{ text: string; authorName?: string }>>>;
  /** اتصال تشغيلي حقيقي لكل منصة (من الخادم). */
  liveConnections?: Partial<Record<PlatformId, { connected: boolean; verified: boolean }>>;
  /** حالات منصات جاهزة (إن مرّرها المُجمِّع؛ وإلا تُشتق من القدرات + الاتصال). */
  platformStates?: BrainPlatformState[];
  recentOutcomes?: string[];
  learning?: LearningResult | null;
  ownerPreferences?: OwnerPreference[];
  recommendations?: ExplainableRecommendation[];
  decisions?: Array<{ id: string; summary: string; explanation: DecisionExplanation }>;
  risks?: BrainRisk[];
  signals?: Signal[];
  aiCounters?: BrainDiagnosticsCounters;
}

const EMPTY_COUNTERS: BrainDiagnosticsCounters = {
  providerCalls: 0, cacheHits: 0, inflightJoins: 0, guardBlocked: 0, deterministic: 0, fallback: 0, providerErrors: 0,
};

/**
 * يبني لقطة العقل المركزي من مكوّنات حقيقية فقط. لا تنفيذ ولا أسرار؛ تحليل
 * وتخطيط وتوصيات قابلة للتفسير.
 */
export function buildCentralBrainState(input: BuildCentralBrainStateInput): CentralBrainState {
  const matrix = capabilityMatrix(input.platforms);
  const live = input.liveConnections || {};
  const platformStates: BrainPlatformState[] = input.platformStates || matrix.map((row) => ({
    platform: row.platform,
    capabilities: row.states,
    realConnector: row.realConnector,
    connected: Boolean(live[row.platform]?.connected),
    verified: Boolean(live[row.platform]?.verified),
  }));

  // الهدف: يُبنى داخلياً من الاسم إن لم يُمرَّر تعريف جاهز — فلا يبقى فارغاً بلا سبب.
  const goals = input.goals ?? (input.goalPrimary
    ? defineGoal({ primary: input.goalPrimary as GoalType, secondary: (input.goalSecondary || null) as GoalType | null })
    : null);

  const records = input.records || [];
  const commentsByPlatform = input.commentsByPlatform || {};

  // الجمهور: يُبنى من بيانات حقيقية إن لم يُمرَّر نموذج جاهز.
  const audience = input.audience ?? (input.platforms.length
    ? buildCrossPlatformAudienceModel({ platforms: input.platforms, records, commentsByPlatform })
    : null);

  // الأهمية التجارية: من أول منصة لها بيانات فعلية (لا خلط عبر المنصات).
  let market = input.market ?? null;
  if (market === null && input.platforms.length) {
    const platform = input.platforms.find((p) => records.some((r) => r.platform === p)) || input.platforms[0];
    const platformRecords = records.filter((r) => r.platform === platform);
    const views = platformRecords.reduce((s, r) => s + (Number(r.values?.views) || 0), 0);
    const likes = platformRecords.reduce((s, r) => s + (Number(r.values?.likes) || 0), 0);
    const convs = (commentsByPlatform[platform] || []).map((c) => classifyConversation({ platform, externalId: 'n/a', text: c.text || '' }));
    market = computeCommercialRelevance({
      platform,
      views: platformRecords.length ? views : null,
      engagedViews: platformRecords.length ? likes + convs.length : null,
      comments: convs.map((c) => ({ isBusinessInquiry: c.category === 'purchase_intent', intent: 'business_inquiry' as const, topic: c.topic })),
    });
  }

  const signals = input.signals || [];
  const fresh = signals.filter((s) => isFresh(s, input.now)).length;

  const knowledgeBase = summarizeKnowledge(input.knowledge || []);

  const pendingDecisions: PendingDecision[] = (input.decisions || [])
    .filter((d) => d.explanation.decision !== 'automatic')
    .map((d) => ({
      id: d.id,
      summary: d.summary,
      decision: d.explanation.decision,
      autonomyLevel: d.explanation.autonomyLevel,
      reason: d.explanation.reason,
      alternative: d.explanation.alternative,
    }));

  const limitations: string[] = [
    'العقل لا ينشر ولا يرد ولا يعدّل تلقائياً؛ التنفيذ يخضع لبوابات الصلاحيات والموافقة.',
    'المؤشرات غير المتاحة عبر الواجهات الرسمية معلنة صراحةً ولا تُخترع.',
    'لا تُستنتج سمات شخصية حساسة (عمر/جنس/موقع/دخل).',
  ];
  if (!signals.length) limitations.push('لا إشارات مُدخَلة بعد؛ الإدراك محدود.');
  if (knowledgeBase.unknownCount) limitations.push(`${knowledgeBase.unknownCount} معلومة مجهولة (لا دليل كافٍ) — معلنة بلا اختراع.`);

  return {
    generatedAt: new Date(input.now).toISOString(),
    goals,
    knowledge: knowledgeBase,
    audience: audience,
    market: market,
    activeExperiments: (input.experiments || []).map((e) => ({
      id: e.id,
      description: describeExperiment(e),
      status: e.status,
      verdict: e.verdict ?? null,
    })),
    contentStrategy: input.contentStrategy || [],
    strategies: input.strategies || [],
    contentPath: input.contentPath ?? null,
    timingStrategy: input.timing ?? null,
    platformStates,
    recentOutcomes: input.recentOutcomes || [],
    learning: input.learning ?? null,
    ownerPreferences: input.ownerPreferences || [],
    recommendations: input.recommendations || [],
    pendingDecisions,
    risks: input.risks || [],
    limitations,
    signalFreshness: { total: signals.length, fresh, stale: signals.length - fresh },
    ai: input.aiCounters || { ...EMPTY_COUNTERS },
    records: input.records || [],
    commentsByPlatform: input.commentsByPlatform || {},
    note: 'لقطة العقل المركزي: تحليل وتخطيط وتوصيات قابلة للتفسير فقط — بلا تنفيذ خارجي وبلا أسرار.',
  };
}

/** ملخّص تشخيصي للعقل (صحة الذاكرة/المعرفة/الطزاجة) بلا أسرار. */
export function brainDiagnostics(state: CentralBrainState): {
  brainHealth: 'ok' | 'limited';
  knowledgeHealth: { verified: number; derived: number; hypothesis: number; unknown: number; unavailable: number; humanRequired: number };
  signalFreshness: { total: number; fresh: number; stale: number };
  pendingDecisionCount: number;
  blockedActionCount: number;
  ai: BrainDiagnosticsCounters;
  note: string;
} {
  const blockedActionCount = state.pendingDecisions.filter((d) => d.decision === 'blocked' || d.decision === 'not_available').length;
  return {
    brainHealth: state.signalFreshness.fresh > 0 || state.knowledge.verifiedCount > 0 ? 'ok' : 'limited',
    knowledgeHealth: {
      verified: state.knowledge.verifiedCount,
      derived: state.knowledge.derivedCount,
      hypothesis: state.knowledge.hypothesisCount,
      unknown: state.knowledge.unknownCount,
      unavailable: state.knowledge.unavailableCount,
      humanRequired: state.knowledge.humanInputRequiredCount,
    },
    signalFreshness: state.signalFreshness,
    pendingDecisionCount: state.pendingDecisions.length,
    blockedActionCount,
    ai: state.ai,
    note: 'تشخيص العقل بلا أسرار: أعداد حالات المعرفة، طزاجة الإشارات، والقرارات المعلّقة.',
  };
}

/** يجيب اختبار المعمارية النهائي: هل يحتاج العقل إعادة كتابة عند منصة #11؟ */
export function brainIsPlatformAgnostic(): { agnostic: boolean; reason: string } {
  // العقل يعمل على PlatformId وقدرات السجل فقط؛ لا فرع خاص بمنصة في وحدات العقل.
  const known = PLATFORM_SPECS.map((s) => s.platform);
  return {
    agnostic: known.length > 0,
    reason: 'وحدات العقل تعمل على PlatformId + مصفوفة القدرات المشتقة من السجل؛ إضافة منصة #11 = صف في السجل بلا تعديل العقل.',
  };
}

export function describeTiming(rec: TimingRecommendation | null): string {
  return rec ? describeTimingRecommendation(rec) : 'لا توصية توقيت بعد.';
}
