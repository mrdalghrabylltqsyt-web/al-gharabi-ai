/**
 * Cognitive Loop — الدورة الإدراكية الكاملة للعقل المركزي (Batch 7، منطق خالص).
 *
 *   PERCEIVE → UNDERSTAND → REMEMBER → REASON → CONSULT → PLAN → CRITIQUE →
 *   DECIDE → ACT → OBSERVE → LEARN
 *
 * هذه الوحدة **تجميع حتمي** فوق الطبقات القائمة (لا تعيد بناء أي منها):
 * السياق (`contextEngine`)، الاستدعاء (`memoryRecall`)، الأهداف (`goalManager`)،
 * توجيه المجلس (`agentCouncil`)، الخلاف (`disagreement`)، الإجراء التالي
 * (`nextAction`)، الخطة (`planningEngine`)، والتعلّم (`outcomeLearning`).
 *
 * القواعد الملزمة:
 * - لا تنفيذ خارجي: المرحلة `ACT` تُعلن الإجراء **المسموح من البوابة** فقط؛ لا تُنفّذ.
 * - لا تفكير داخلي مسرود: يُحفظ `ReasoningState` فقط (هدف/أدلة/افتراضات/…).
 * - لا اختراع: المجهول/غير المتاح/بلا دليل يبقى معلناً، والحالة النهائية آمنة.
 * - لا استهلاك AI: كل شيء حتمي.
 *
 * لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import type { PlatformId } from '../../social/adapter';
import type { BrainMemoryStoreState } from '../memory/store';
import { buildCognitiveContext } from './contextEngine';
import { recallMemories } from './memoryRecall';
import { buildGoalPlan, goalPlanViolatesScope, type GoalInput } from './goalManager';
import { proposeNextAction } from './nextAction';
import { buildPlan } from './planningEngine';
import { analyzeDisagreements } from './disagreement';
import { routeCouncilDecision, detectCouncilScenario, type CouncilScenario } from './agentCouncil';
import { buildLearningOutcome } from './outcomeLearning';
import type { TeamConflict } from '../team/types';
import type { TeamTruthState, Confidence } from '../team/truth';
import type { BrainDecisionStatus } from '../team/brainDecision';
import {
  COGNITIVE_PHASE_LABELS_AR, type CognitivePhase, type CognitiveCycleStatus,
  type CognitiveContext, type CognitiveContextInput, type MemoryRecallResult,
  type GoalPlan, type DisagreementAnalysis, type NextActionProposal,
  type LearningOutcome, type OutcomeObservation, type PhaseTrace, type ReasoningState,
} from './types';
import type { PlanStep } from './planTypes';
import { CENTRAL_BRAIN_ID, CENTRAL_BRAIN_LABEL_AR } from '../consolidation';

/**
 * سياق العقل المركزي (Brain 1) المُغذّى للدورة الإدراكية — يجعل الإدراك **قدرة
 * داخلية** لا عقلاً ثانياً: يقرأ الاستراتيجية الحالية والجمهور والسوق والهدف
 * الكانوني والمعرفة. اختياري للتوافق الخلفي؛ عند غيابه يُعلن صريحاً.
 */
export interface CognitiveBrainContext {
  brainId: string;
  /** الإصدار الحالي للاستراتيجية (من حالة الاستراتيجية التي يملكها العقل المركزي). */
  strategyVersion: number | null;
  /** عدد خطط الاستراتيجية الحالية (ملخّص — لا إعادة حساب). */
  strategyScopeCount: number;
  /** مخططات الاستراتيجية الحالية (what/why) للاستدلال — بلا سرّ. */
  strategySummary: Array<{ scope: string; what: string; status: string }>;
  /** هدف العقل الكانوني (نص) — لا يُخترع. */
  canonicalGoal: string | null;
  /** ملخّص الجمهور (عدد المقاطع) من نموذج الجمهور الكانوني. */
  audienceSegments: number;
  /**
   * موضوعات مقاطع الجمهور الحقيقية (من `audienceModel` الكانوني) — تُستهلك فعلاً
   * في التخطيط (توجيه محتوى/هدف)، لا للعرض فقط. بلا اختراع: من تفاعل ملاحَظ فقط.
   */
  audienceTopics: string[];
  /** ملخّص السوق: هل توجد أدلة تجارية؟ */
  marketHasEvidence: boolean;
  /** نصّ إشارة السوق الكانوني إن وُجد (بلا اختراع). */
  marketNote: string | null;
  /** عدد عناصر المعرفة الكانونية. */
  knowledgeCount: number;
  /** هل الاكتشافات معلنة (لا اختراع). */
  available: boolean;
}

export interface CognitiveSessionSummary {
  /** الوكلاء الذين شاركوا فعلاً في الجلسة (من runTeamSession). */
  consultedAgents: string[];
  conflicts: TeamConflict[];
  truthState: TeamTruthState;
  confidence: Confidence;
  criticFailed: boolean;
  decisionVerified: boolean;
  decisionStatement: string;
  decisionLimitations: string[];
  decisionProposedAction: string;
  /** الحالة النهائية المحكومة (من composeBrainDecision في الخادم). */
  finalStatus: BrainDecisionStatus;
  escalationReason: string | null;
}

export interface CognitiveCycleInput {
  now: number;
  platform: PlatformId;
  eventIdentity: string;
  context: CognitiveContextInput;
  memoryStore: BrainMemoryStoreState;
  session: CognitiveSessionSummary;
  capabilities: { replyCapable: boolean; publishCapable: boolean; providerVerified: boolean; externalApproved: boolean };
  /** حقائق الحدث لتحديد الهدف والإجراء. */
  event: {
    category: GoalInput['eventCategory'];
    topic: string | null;
    priceUnverified: boolean;
    hasContentOpportunity: boolean;
    needsClarification: boolean;
    hasPendingEscalation: boolean;
    isSpam: boolean;
  };
  /** نتائج ملاحَظة (اختياري) لمرحلة التعلّم. */
  observations?: OutcomeObservation[];
  /**
   * سياق العقل المركزي (Brain 1) — يجعل هذه الدورة قدرة داخلية تابعة. اختياري
   * للتوافق الخلفي؛ عند غيابه يُعلن `brain.available=false` صراحةً.
   */
  brain?: CognitiveBrainContext | null;
}

export interface CognitiveReport {
  cycleId: string;
  eventIdentity: string;
  platform: PlatformId;
  status: CognitiveCycleStatus;
  phases: PhaseTrace[];
  context: CognitiveContext;
  recall: MemoryRecallResult;
  goalPlan: GoalPlan;
  council: ReturnType<typeof routeCouncilDecision>;
  disagreement: DisagreementAnalysis;
  nextAction: NextActionProposal & { usefulness: string };
  planSteps: PlanStep[];
  selectedPlan: string;
  reasoning: ReasoningState;
  learning: LearningOutcome;
  /** حالة القرار النهائي (مرجع؛ لا يُعاد تصنيفها هنا). */
  decisionStatus: BrainDecisionStatus;
  /** هوية العقل المركزي المالك + إعلان التبعية (الإدراك قدرة داخلية لا عقل ثانٍ). */
  brain: {
    id: string;
    labelAr: string;
    /** هل هذه الدورة تابعة للعقل المركزي؟ دائماً true. */
    subordinateToCentralBrain: true;
    /** هل الإدراك سلطة قرار مستقلة؟ دائماً false. */
    independentDecisionAuthority: false;
    /** هل استُهلك سياق العقل المركزي (استراتيجية/جمهور/سوق/هدف) في هذه الدورة؟ */
    consumedBrainContext: boolean;
    /** ملخّص الاستراتيجية المُستهلكة (بلا سرّ). */
    strategyVersion: number | null;
    strategyScopeCount: number;
    canonicalGoal: string | null;
    /** موضوعات الجمهور الكانونية المُستهلكة فعلاً في التخطيط (بلا اختراع). */
    audienceTopics: string[];
    /** هل دليل السوق الكانوني مُستهلك في هذه الدورة؟ */
    marketConsumed: boolean;
  };
  /** كتلة مراقبة مختصرة (بلا سرّ). */
  observability: {
    cognitiveState: CognitiveCycleStatus;
    currentObjective: string;
    activeTask: string;
    agentsConsulted: string[];
    memoryUsed: number;
    decisionState: BrainDecisionStatus;
    escalationState: 'required' | 'none';
    lastAction: string;
    lastObservedOutcome: string | null;
    learningEvents: number;
    externalActionTaken: false;
  };
  limitations: string[];
  note: string;
}

/** هل فئة الحدث تجعل السياق المجهول حاجزاً؟ (سؤال حقيقة مجهولة). */
function isUnknownFactQuestion(input: CognitiveCycleInput): boolean {
  return input.event.category === 'question'
    && (input.session.truthState === 'UNKNOWN' || input.session.truthState === 'UNAVAILABLE')
    && !input.event.priceUnverified
    && !input.event.hasContentOpportunity;
}

/**
 * يشغّل الدورة الإدراكية كاملة ويُرجع تقريراً قابلاً للتتبع. لا يرمي، ولا ينفّذ.
 * عند غياب أي دليل أساسي تكون الحالة `no_data` والنتيجة آمنة صريحة.
 */
export function buildCognitiveCycle(input: CognitiveCycleInput): CognitiveReport {
  const now = input.now;
  const at = new Date(now).toISOString();
  const phases: PhaseTrace[] = [];
  const trace = (phase: CognitivePhase, outcome: string) => {
    phases.push({ phase, labelAr: COGNITIVE_PHASE_LABELS_AR[phase], outcome, externalAction: false, at });
  };

  // PERCEIVE — وصف الحدث كما وصل.
  const eventText = input.context.eventText || '';
  trace('PERCEIVE', eventText ? `حدث مُدرَك من ${input.platform}: ${eventText.slice(0, 120)}` : 'حدث بلا وصف نصّي.');

  // UNDERSTAND — السياق.
  const context = buildCognitiveContext(input.context);
  trace('UNDERSTAND', `فُهم السياق: منصة=${context.where.platform} · أدلة=${context.availableEvidence.length} · مجهول=${context.unknown.length} · غير متاح=${context.truth.unavailable.length}.`);

  // REMEMBER — استدعاء ذاكرة ذي صلة.
  const recall = recallMemories(input.memoryStore, {
    now,
    platform: input.platform,
    text: `${eventText} ${input.event.topic || ''} ${input.session.decisionStatement}`,
    maxResults: 8,
  });
  context.relevantMemoryIds = recall.candidates.map((c) => c.recordId);
  trace('REMEMBER', `استُدعيت ${recall.used} سجلاً ذا صلة من ${recall.considered} نشط (استدعاء بالصلة لا تحميل الكل).`);

  // REASON — تحليل حتمي مبني على الأدلة والحالة + سياق العقل المركزي (استراتيجية/هدف/جمهور).
  const hasEvidence = input.session.truthState === 'FACT' || input.session.truthState === 'DERIVED';
  const brainCtx = input.brain || null;
  const consumedBrainContext = Boolean(brainCtx && brainCtx.available);
  const audienceTopics = (brainCtx?.audienceTopics || []).filter((t) => t && String(t).trim()).slice(0, 8);
  const marketNote = brainCtx?.marketNote || null;
  // الدليل الحقيقي: تطابق موضوع الحدث مع موضوع جمهور ملاحَظ (من تفاعل حقيقي فقط).
  const eventTopic = String(input.event.topic || '').trim();
  const audienceMatch = eventTopic && audienceTopics.some((t) => t.includes(eventTopic) || eventTopic.includes(t));
  // الاستراتيجية الكانونية تُستهلك في التخطيط: خطة **مدعومة** نطاقها جمهور/محتوى +
  // موضوعات جمهور ملاحَظة ⇒ إشارة فرصة جمهور حقيقية (لا اختراع).
  const strategySupportsAudience = (brainCtx?.strategySummary || [])
    .some((s) => s.status === 'supported' && /audience|content|جمهور|محتوى/i.test(`${s.scope} ${s.what}`));
  trace('REASON', hasEvidence
    ? (consumedBrainContext
      ? `توجد أدلة كافية + سياق العقل المركزي (استراتيجية v${brainCtx!.strategyVersion ?? '—'}، ${brainCtx!.strategyScopeCount} خطة، هدف «${(brainCtx!.canonicalGoal || '').slice(0, 60)}»، ${audienceTopics.length} موضوع جمهور، ${brainCtx!.marketHasEvidence ? 'دليل سوق' : 'لا دليل سوق'}).`
      : 'توجد أدلة كافية للبناء عليها (حقيقة/استنتاج).')
    : 'لا أدلة كافية؛ المجهول يبقى معلناً (لا اختراع).');

  // CONSULT — توجيه المجلس (اختيار الوكلاء حسب السيناريو + دليل الجمهور الكانوني).
  const scenario: CouncilScenario = routeScenario(input, Boolean(audienceMatch));
  const council = routeCouncilDecision(scenario);
  trace('CONSULT', `وُجّه المجلس للسيناريو «${scenario}» بمشاركة ${council.agentCount} وكيلاً (لا الستة دائماً).`);

  // PLAN — الأهداف + الإجراء التالي + الخطة (تستهلك سياق العقل المركزي فعلاً).
  const goalInput: GoalInput = {
    now,
    eventCategory: input.event.category,
    topic: input.event.topic,
    priceUnverified: input.event.priceUnverified,
    // فرصة الجمهور = إشارة حدث **أو** تطابق موضوع الحدث مع جمهور ملاحَظ (دليل حقيقي
    // من نموذج الجمهور الكانوني) — فتُستهلك معرفة الجمهور في التخطيط لا في العرض فقط.
    hasAudienceOpportunity: input.event.hasContentOpportunity || Boolean(audienceMatch) || (strategySupportsAudience && audienceTopics.length > 0),
    needsClarification: input.event.needsClarification,
    hasPendingEscalation: input.event.hasPendingEscalation,
  };
  const goalPlan = buildGoalPlan(goalInput);
  const contentGrounding = audienceTopics.length
    ? `الحاجة الجمهورية الملاحَظة: ${audienceTopics.slice(0, 3).join(' · ')}`
    : 'لا موضوع جمهور ملاحَظ بعد (يُبنى على الدليل الحاضر فقط).';
  trace('PLAN', `الهدف الحالي: «${goalPlan.currentGoal.labelAr}» · الخطوة التالية: ${goalPlan.nextBestStep.slice(0, 100)} · ${contentGrounding.slice(0, 120)}`);

  // CRITIQUE — الخلافات والنقد.
  const disagreement = analyzeDisagreements(input.session.conflicts);
  trace('CRITIQUE', input.session.criticFailed
    ? 'فشل الناقد: القرار غير مُتحقَّق — لا إجراء على ادعاء غير مثبت.'
    : (disagreement.unresolved > 0
      ? `${disagreement.unresolved} خلاف غير محسوم يبقى ظاهراً؛ ${disagreement.forcesHumanOrSafe ? 'منها جوهري يمنع الأتمتة.' : 'لا يمنع المتابعة.'}`
      : 'النقد لم يرصد خلافاً جوهرياً.'));

  // DECIDE — الإجراء التالي المقترح (اقتراح محكوم) + الخطة.
  const nextAction = proposeNextAction({
    goalKind: goalPlan.currentGoal.kind,
    truthState: input.session.truthState,
    brainFinalStatus: input.session.finalStatus,
    forcesHumanOrSafe: disagreement.forcesHumanOrSafe,
    replyCapable: input.capabilities.replyCapable,
    publishCapable: input.capabilities.publishCapable,
    providerVerified: input.capabilities.providerVerified,
    priceUnverified: input.event.priceUnverified,
    eventCategory: input.event.category,
    isSpam: input.event.isSpam,
    hasPendingEscalation: input.event.hasPendingEscalation,
    hasContentOpportunity: input.event.hasContentOpportunity,
  });
  const plan = buildPlan({
    objective: input.context.objective,
    goalKind: goalPlan.currentGoal.kind,
    nextActionKind: nextAction.kind,
    nextActionRationale: nextAction.rationale,
    brainFinalStatus: input.session.finalStatus,
    consultedAgents: input.session.consultedAgents.length,
    unresolvedDisagreements: disagreement.unresolved,
    replyCapable: input.capabilities.replyCapable,
    publishCapable: input.capabilities.publishCapable,
    providerVerified: input.capabilities.providerVerified,
    externalApproved: input.capabilities.externalApproved,
  });
  trace('DECIDE', `الإجراء المقترح: ${nextAction.labelAr} (${nextAction.requiredPermission} · خطر ${nextAction.risk}).`);

  // ACT — الإجراء المسموح من البوابة فقط (لا تنفيذ).
  const externalAllowed = plan.steps.some((s) => s.external && s.allowed);
  const externalBlocked = plan.steps.some((s) => s.external && !s.allowed);
  trace('ACT', externalAllowed
    ? 'الإجراء الخارجي مسموح من البوابة (ينفّذه مسار المشروع القائم — لا العقل).'
    : (externalBlocked ? 'الإجراء الخارجي محجوب (بوابة/اعتماد ناقص) — لا تنفيذ.' : 'لا إجراء خارجي في هذه الدورة.'));

  // OBSERVE — رصد النتيجة (من بيانات حقيقية لاحقاً؛ لا ادعاء الآن).
  const learning = buildLearningOutcome(input.observations || [], now);
  const lastObserved = learning.observations.length ? learning.observations[learning.observations.length - 1].summary : null;
  trace('OBSERVE', lastObserved ? `نتيجة ملاحَظة: ${lastObserved.slice(0, 120)}` : 'لا نتيجة ملاحَظة بعد؛ تُرصد لاحقاً من بيانات حقيقية (لا ادعاء).');

  // LEARN — درس مبني على دليل (لا ترقية بلا مصدر/عيّنة).
  trace('LEARN', learning.durableLessons.length
    ? `${learning.durableLessons.length} درساً استوفى الشرط ويُرقّى لمعرفة دائمة (بلا سببية قاطعة).`
    : 'لا درس استوفى شرط المعرفة الدائمة؛ ملاحظات مبدئية فقط.');

  // الحالة: no_data عند غياب أي دليل، وإلا completed/partial.
  const status: CognitiveCycleStatus = !hasEvidence && input.session.consultedAgents.length === 0
    ? 'no_data'
    : (input.session.criticFailed || !hasEvidence ? 'partial' : 'completed');

  // حالة التفكير المنظّم — بيانات قابلة للتتبع فقط (بلا تفكير داخلي خاص).
  const reasoning: ReasoningState = {
    objective: input.context.objective,
    evidence: [...input.context.evidence].slice(0, 30),
    assumptions: input.session.truthState === 'HYPOTHESIS' ? ['البناء على فرضية معلنة (تحتاج اختباراً).'] : [],
    agentFindings: input.session.consultedAgents.slice(),
    criticFindings: [input.session.criticFailed ? 'فشل الناقد: القرار غير مُتحقَّق.' : 'النقد اشتغل.'],
    decisionRationale: `${nextAction.rationale} — السبب: ${nextAction.reasons.join(' · ')}.`,
    uncertainty: {
      truthState: input.session.truthState,
      confidence: input.session.confidence,
      limitations: input.session.decisionLimitations.slice(0, 8),
    },
    selectedAction: nextAction.labelAr,
    escalationReason: (input.session.escalationReason as any) ?? null,
    storesPrivateChainOfThought: false,
  };

  const limitations: string[] = [
    'الدورة تحليلية حتمية فقط: لا تنفيذ خارجي من العقل، والتنفيذ عبر بوابات المشروع.',
    'لا يُحفظ أي تفكير داخلي خاص؛ فقط بيانات قابلة للتتبع.',
    'الغائب مجهول/غير متاح صراحةً؛ لا اختراع.',
  ];
  const scope = goalPlanViolatesScope(goalPlan);
  if (scope.violates) limitations.push('تحذير: خطة الأهداف تحتوي مصطلحاً مالياً خارج النطاق.');

  const observability: CognitiveReport['observability'] = {
    cognitiveState: status,
    currentObjective: input.context.objective,
    activeTask: input.context.eventText.slice(0, 160),
    agentsConsulted: input.session.consultedAgents.slice(),
    memoryUsed: recall.used,
    decisionState: input.session.finalStatus,
    escalationState: input.session.finalStatus === 'HUMAN_ESCALATION' ? 'required' : 'none',
    lastAction: nextAction.labelAr,
    lastObservedOutcome: lastObserved,
    learningEvents: learning.observations.length,
    externalActionTaken: false,
  };

  return {
    cycleId: `cog-${now.toString(36)}-${String(input.eventIdentity).replace(/[^a-z0-9:_-]/gi, '').slice(0, 24)}`,
    eventIdentity: input.eventIdentity,
    platform: input.platform,
    status,
    phases,
    context,
    recall,
    goalPlan,
    council,
    disagreement,
    nextAction,
    planSteps: plan.steps,
    selectedPlan: plan.selectedPlan,
    reasoning,
    learning,
    decisionStatus: input.session.finalStatus,
    brain: {
      id: CENTRAL_BRAIN_ID,
      labelAr: CENTRAL_BRAIN_LABEL_AR,
      subordinateToCentralBrain: true,
      independentDecisionAuthority: false,
      consumedBrainContext,
      strategyVersion: brainCtx?.strategyVersion ?? null,
      strategyScopeCount: brainCtx?.strategyScopeCount ?? 0,
      canonicalGoal: brainCtx?.canonicalGoal ?? null,
      audienceTopics,
      marketConsumed: Boolean(marketNote) || Boolean(brainCtx?.marketHasEvidence),
    },
    observability,
    limitations,
    note: 'الدورة الإدراكية: فهم → تذكّر → تفكير → استشارة → تخطيط → نقد → قرار → إجراء(مقترح) → رصد → تعلّم — بلا تنفيذ خارجي وبلا تفكير داخلي خاص.',
  };
}

/** يحدّد سيناريو المجلس من حقائق الحدث (رابط صريح بين الحقول) + دليل الجمهور الكانوني. */
function routeScenario(input: CognitiveCycleInput, audienceMatch = false): CouncilScenario {
  const unknownFact = isUnknownFactQuestion(input);
  return detectCouncilScenario({
    eventCategory: input.event.category,
    priceUnverified: input.event.priceUnverified,
    hasAudienceOpportunity: input.event.hasContentOpportunity || audienceMatch,
    isUnknownFactQuestion: unknownFact,
  });
}
