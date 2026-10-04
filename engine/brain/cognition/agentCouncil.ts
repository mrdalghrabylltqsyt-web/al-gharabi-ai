/**
 * Agent Council Intelligence — العقل المركزي يقرّر **أي** وكلاء يحتاج (منطق خالص).
 *
 * لا يُستدعى الوكلاء الستة على كل حدث. الاختيار حتمي حسب طبيعة الحدث، **ويُعيد
 * استخدام** `runTeamSession` القائم حرفياً (لا فريق ثانٍ، ولا منطق وكلاء مكرر):
 *   - شكوى/سعر غير موثّق  → البحث + التحليل + النقد + القرار
 *   - نية شراء            → التحليل + الاستراتيجية + النقد + القرار
 *   - فرصة محتوى          → البحث + التحليل + الاستراتيجية + النقد + القرار
 *   - سؤال حقيقة مجهول    → البحث + النقد
 *   - مشكلة تنسيق         → المنسّق + المختصّون المعنيّون
 *
 * منطق خالص: لا شبكة ولا أسرار. لا ينتج أي إجراء خارجي.
 */

import type { PlatformId } from '../../social/adapter';
import { runTeamSession, type TeamRunOptions } from '../team/orchestrator';
import type { TeamContext } from '../team/agents';
import { TEAM_AGENT_LABELS_AR, type TeamAgentId, type TeamSession } from '../team/types';

export type CouncilScenario =
  | 'complaint'
  | 'price_unverified'
  | 'buying_signal'
  | 'content_opportunity'
  | 'unknown_factual_question'
  | 'coordination_problem'
  | 'praise_or_engagement'
  | 'spam'
  | 'general';

export const COUNCIL_SCENARIO_LABELS_AR: Readonly<Record<CouncilScenario, string>> = Object.freeze({
  complaint: 'شكوى',
  price_unverified: 'سعر/قسط غير موثّق',
  buying_signal: 'إشارة شراء',
  content_opportunity: 'فرصة محتوى',
  unknown_factual_question: 'سؤال حقيقة مجهولة',
  coordination_problem: 'مشكلة تنسيق',
  praise_or_engagement: 'مدح/تفاعل',
  spam: 'سبام',
  general: 'عام',
});

/** خريطة السيناريو → الوكلاء المطلوبين (المنسّق والقرار جزء من الدورة دائماً). */
const SCENARIO_AGENTS: Record<CouncilScenario, TeamAgentId[]> = Object.freeze({
  complaint: ['orchestrator', 'research', 'analysis', 'critic', 'decision'],
  price_unverified: ['orchestrator', 'research', 'analysis', 'critic', 'decision'],
  buying_signal: ['orchestrator', 'analysis', 'strategy', 'critic', 'decision'],
  content_opportunity: ['orchestrator', 'research', 'analysis', 'strategy', 'critic', 'decision'],
  unknown_factual_question: ['orchestrator', 'research', 'critic'],
  coordination_problem: ['orchestrator', 'research', 'analysis', 'strategy', 'decision'],
  praise_or_engagement: ['orchestrator', 'analysis', 'critic', 'decision'],
  spam: ['orchestrator', 'critic'],
  general: ['orchestrator', 'research', 'analysis', 'critic', 'decision'],
});

/** يحدّد سيناريو المجلس من حقائق الحدث (بلا اختراع). */
export function detectCouncilScenario(input: {
  eventCategory: 'question' | 'complaint' | 'objection' | 'purchase_intent' | 'feature_request' | 'content_request' | 'praise' | 'spam' | 'unknown';
  priceUnverified?: boolean;
  hasAudienceOpportunity?: boolean;
  isCoordinationIssue?: boolean;
  isUnknownFactQuestion?: boolean;
}): CouncilScenario {
  if (input.isCoordinationIssue) return 'coordination_problem';
  if (input.eventCategory === 'spam') return 'spam';
  if (input.eventCategory === 'complaint') return 'complaint';
  if (input.priceUnverified) return 'price_unverified';
  if (input.eventCategory === 'purchase_intent') return 'buying_signal';
  if (input.eventCategory === 'content_request' || input.eventCategory === 'feature_request' || input.hasAudienceOpportunity) return 'content_opportunity';
  if (input.isUnknownFactQuestion) return 'unknown_factual_question';
  if (input.eventCategory === 'praise' || input.eventCategory === 'objection') return 'praise_or_engagement';
  return 'general';
}

/** الوكلاء المطلوبون لسيناريو (مصدر واحد). */
export function requiredAgentsForScenario(scenario: CouncilScenario): TeamAgentId[] {
  return [...(SCENARIO_AGENTS[scenario] || SCENARIO_AGENTS.general)];
}

/**
 * قرار التوجيه: هل نحتاج تشغيل فريق كامل لكل حدث؟ لا — يُحدَّد الحد الأدنى.
 * `fullCouncil` = هل يشمَل الوكلاء الستة؟ (نادر: فرصة محتوى كاملة).
 */
export function routeCouncilDecision(scenario: CouncilScenario): {
  scenario: CouncilScenario;
  agents: TeamAgentId[];
  agentCount: number;
  fullCouncil: boolean;
  reason: string;
} {
  const agents = requiredAgentsForScenario(scenario);
  return {
    scenario,
    agents,
    agentCount: agents.length,
    fullCouncil: agents.length >= 6,
    reason: `المجلس يوجّه للسيناريو «${COUNCIL_SCENARIO_LABELS_AR[scenario]}» بمشاركة ${agents.map((a) => TEAM_AGENT_LABELS_AR[a]).join(' · ')} فقط.`,
  };
}

/**
 * يشغّل جلسة المجلس عبر **نفس** `runTeamSession` القائم، مع تقييد الوكلاء حسب
 * السيناريو. لا يستدعي فريقاً ثانياً ولا شبكة ولا AI. لا ينفّذ إجراءً خارجياً.
 *
 * ملاحظة: `runTeamSession` يحدّد المشاركين بنفسه من نص المهمة؛ نمرّر مهمة موجّهة
 * للسيناريو، ونُبقي خيار تعطيل النقد (`criticEnabled`) لتغطية سيناريوهات السبام/
 * السؤال المجهول. القرار النهائي يبقى للعقل المركزي (composition في الخادم).
 */
export function consultCouncil(
  ctx: TeamContext,
  options: {
    trigger: TeamRunOptions['trigger'];
    platform: PlatformId;
    eventIdentity: string;
    scenario: CouncilScenario;
    criticEnabled?: boolean;
    existing?: TeamSession | null;
    now: number;
  },
): { session: TeamSession; routing: ReturnType<typeof routeCouncilDecision> } {
  const routing = routeCouncilDecision(options.scenario);
  const session = runTeamSession(ctx, {
    trigger: options.trigger,
    platform: options.platform,
    eventIdentity: options.eventIdentity,
    criticEnabled: routing.agents.includes('critic') && options.criticEnabled !== false,
    existing: options.existing ?? null,
    now: options.now,
  });
  return { session, routing };
}
