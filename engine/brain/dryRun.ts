/**
 * Brain Dry-Run — سيناريو تجريبي صريح يثبت أن العقل يعمل من الإدراك إلى التوصية
 * ثم **يتوقف قبل أي إجراء خارجي**.
 *
 * المخرَج يجيب صراحةً على الأسئلة التسعة:
 *   WHAT I KNOW / WHAT I INFER / WHAT I DON'T KNOW / WHAT I RECOMMEND / WHY /
 *   WHAT I WOULD TEST / WHAT REQUIRES OWNER APPROVAL
 *
 * لا تنفيذ خارجي إطلاقاً: كل المخرجات تحليل وتخطيط واقتراح.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../social/adapter';
import { buildPerceptionBundle, type Signal, type ConversationSignalInput } from './perception/signals';
import { buildAudienceModel, type AudienceModel } from './audience/audienceModel';
import { aggregateRepeatedNeeds, classifyConversation, proposeContentFromNeed, type ClassifiedConversation } from './audience/conversationIntelligence';
import { computeCommercialRelevance, type CommercialRelevance } from './market/commercialRelevance';
import { recommendTimingWindow, type TimingRecommendation } from './timing/timingModel';
import { buildRecommendation, type ExplainableRecommendation } from './strategy/strategyEngine';
import { decide, type DecisionAction, type DecisionExplanation } from './decisions/decisionEngine';
import type { PlatformMetricRecord } from '../social/platformLearning';

export interface BrainDryRunReport {
  goal: string;
  whatIKnow: string[];
  whatIInfer: string[];
  whatIDontKnow: string[];
  whatIRecommend: string[];
  why: string[];
  whatIWouldTest: string[];
  whatRequiresOwnerApproval: string[];
  perception: { available: number; notAvailable: number };
  audienceSegments: number;
  commercial: CommercialRelevance | null;
  timing: TimingRecommendation | null;
  decisions: Array<{ id: string; summary: string; explanation: DecisionExplanation }>;
  /** إثبات أن السيناريو لم ينفّذ أي إجراء خارجي. */
  externalActionTaken: false;
  limitations: string[];
  note: string;
}

/**
 * يبني تقرير dry-run كاملاً من بيانات حقيقية (أو عيّنة proof-based) ثم يتوقف.
 * لا ينفّذ نشراً ولا رداً ولا جدولة — فقط تحليل وتوصية.
 */
export function buildBrainDryRun(input: {
  platforms: PlatformId[];
  now: number;
  goal: string;
  /** سجلات أداء حقيقية (تُقرأ للتحليل فقط). */
  records: PlatformMetricRecord[];
  /** تعليقات حقيقية للتحليل. */
  comments?: Array<{ platform: PlatformId; externalId: string; text: string }>;
  /** ملاحظات توقيت حقيقية. */
  timingObservations?: Array<{ platform: string; at: string; performance: number }>;
  /** حقائق تجارية مسجّلة (نصوص فقط). */
  verifiedFacts?: string[];
  /** هل المصدر يُقرأ فقط (read-only)؟ يجب أن يكون true. */
  readOnly?: boolean;
}): BrainDryRunReport {
  const platform = input.platforms[0] || 'youtube';
  const records = input.records.filter((r) => r.platform === platform);
  const comments = (input.comments || []).filter((c) => c.platform === platform);

  // 1) الإدراك.
  const views = records.reduce((s, r) => s + (Number(r.values?.views) || 0), 0);
  const likes = records.reduce((s, r) => s + (Number(r.values?.likes) || 0), 0);
  const conversationSignals: ConversationSignalInput[] = comments.map((c) => ({
    platform: c.platform, externalId: c.externalId, text: c.text, collectedAt: new Date(input.now).toISOString(),
  }));
  const perception = buildPerceptionBundle({
    platform,
    collectedAt: new Date(input.now).toISOString(),
    values: { views, likes, comments: comments.length },
    scope: 'channel_recent',
    sampleSize: records.length,
    comments: conversationSignals,
  });

  // 2) فهم الجمهور.
  const audience: AudienceModel = buildAudienceModel({
    platform,
    records: input.records,
    comments: comments.map((c) => ({ text: c.text })),
  });

  // 3) المحادثة.
  const classified: ClassifiedConversation[] = comments.map((c) => classifyConversation({ platform: c.platform, externalId: c.externalId, text: c.text }));
  const needs = aggregateRepeatedNeeds({ platform, conversations: classified });
  const hypotheses = needs.map((n) => proposeContentFromNeed({ need: n, verifiedFacts: input.verifiedFacts }));

  // 4) الأهمية التجارية.
  const commercial = computeCommercialRelevance({
    platform,
    views,
    engagedViews: likes + comments.length,
    comments: classified.map((c) => ({ isBusinessInquiry: c.category === 'purchase_intent', intent: 'business_inquiry' as const, topic: c.topic })),
  });

  // 5) التوقيت.
  const timing = input.timingObservations && input.timingObservations.length
    ? recommendTimingWindow({ observations: input.timingObservations, platform })
    : null;

  // 6) التوصيات.
  const recommendations: ExplainableRecommendation[] = [];
  if (hypotheses.length) {
    const h = hypotheses[0];
    recommendations.push(buildRecommendation({
      id: 'dry-run-content',
      recommendation: h.suggestedContent,
      reason: h.hypothesis,
      evidence: h.evidence,
      source: [`${platform} API — تصنيف تعليقات`, 'حاجة متكررة ملاحَظة'],
      sampleSize: h.need.count,
      expectedOutcome: h.expectedSignal,
      risk: 'low',
      nextTest: 'اختبر هذا المحتوى كمتغيّر واحد وقس الإشارات المؤهّلة.',
      limitations: h.limitations,
    }));
  }

  // 7) القرارات: النشر يحتاج موافقة، والتحليل آلي.
  const decisions: Array<{ id: string; summary: string; explanation: DecisionExplanation }> = [
    { id: 'analyze', summary: 'تحليل الإشارات والجمهور', explanation: decide({ kind: 'analyze', platform } as DecisionAction) },
    { id: 'publish', summary: 'نشر محتوى مقترح', explanation: decide({ kind: 'publish', platform, capability: 'publish', authorized: true, connectedVerified: false, safetyPassed: true, dataSufficient: recommendations.length > 0, risk: 'medium', reversible: false } as DecisionAction) },
  ];

  // 8) بناء التقرير الصادق.
  const whatIKnow = perception.signals.filter((s: Signal) => s.availability === 'AVAILABLE').map((s) => `${s.metric}: ${s.value} (${s.source}).`);
  const whatIDontKnow = perception.signals.filter((s) => s.availability === 'NOT_AVAILABLE').map((s) => `${s.metric}: ${s.limitations}`);

  return {
    goal: input.goal,
    whatIKnow: whatIKnow.length ? whatIKnow : ['لا إشارات متاحة من البيانات المُدخَلة.'],
    whatIInfer: [
      ...audience.segments.flatMap((s) => s.evidence.map((e) => e.statement)),
      ...(timing?.status === 'supported' ? [timing.reason] : []),
    ],
    whatIDontKnow: whatIDontKnow.length ? whatIDontKnow : ['لا فجوات معلنة في هذه العيّنة.'],
    whatIRecommend: recommendations.map((r) => r.recommendation),
    why: recommendations.map((r) => `${r.reason} — الدليل: ${r.evidence.join(' ')}`),
    whatIWouldTest: recommendations.map((r) => r.nextTest).filter(Boolean) as string[],
    whatRequiresOwnerApproval: decisions.filter((d) => d.explanation.decision !== 'automatic').map((d) => `${d.summary}: ${d.explanation.reason}`),
    perception: { available: perception.availableCount, notAvailable: perception.notAvailableCount },
    audienceSegments: audience.segments.length,
    commercial,
    timing,
    decisions,
    externalActionTaken: false,
    limitations: [
      'هذا سيناريو dry-run: لا نشر ولا رد ولا جدولة — يتوقف قبل أي إجراء خارجي.',
      ...(input.readOnly === false ? ['تحذير: المصدر ليس read-only.'] : ['القراءة read-only من بيانات حقيقية فقط.']),
      'المراحل/الحقول غير المتاحة معلنة صراحةً ولا تُخترع.',
    ],
    note: 'تقرير dry-run صادق: ما نعرفه/نستنتجه/نجهله/نوصي به/نختبره/يحتاج موافقة — بلا تنفيذ خارجي.',
  };
}
