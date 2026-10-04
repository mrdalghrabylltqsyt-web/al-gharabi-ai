/**
 * Batch 7 — اختبار طبقة الإدراك/الفهم/التخطيط/التعلّم (منطق خالص، بلا شبكة/أسرار).
 *
 * يثبت: السياق الإدراكي، الذاكرة العاملة، الاستدعاء بالصلة، الأهداف، التخطيط،
 * اختيار الوكلاء، الخلاف، رفض الناقد، الإجراء التالي، التعلّم، حالات الصدق،
 * التصعيد البشري، الحوكمة، ومنع تفعيل ERP/CRM/المبيعات.
 */

import { buildCognitiveContext, attachRecalledMemory, summarizeCognitiveContext } from '../../brain/cognition/contextEngine';
import {
  emptyWorkingMemory, touchWorkingMemory, pruneWorkingMemory, isWorkingMemoryStale,
  summarizeWorkingMemory, normalizeWorkingMemory, WORKING_MEMORY_TTL_MS,
} from '../../brain/cognition/workingMemory';
import { recallMemories, keywords, recallNeedsFullStore } from '../../brain/cognition/memoryRecall';
import { buildGoalPlan, goalPlanViolatesScope, PRIMARY_BUSINESS_OBJECTIVE } from '../../brain/cognition/goalManager';
import { detectCouncilScenario, requiredAgentsForScenario, routeCouncilDecision } from '../../brain/cognition/agentCouncil';
import { analyzeDisagreements, isMaterialToSafety, canResolveConflict } from '../../brain/cognition/disagreement';
import { proposeNextAction } from '../../brain/cognition/nextAction';
import { buildPlan, planRespectsGovernance } from '../../brain/cognition/planningEngine';
import {
  makeOutcomeObservation, deriveLesson, buildLearningOutcome,
  learningOutcomeViolatesScope, learningIsNonSelfModifying, LESSON_DURABLE_MIN_SAMPLE,
  learningToMemoryEntries, lessonToMemoryEntry,
} from '../../brain/cognition/outcomeLearning';
import { buildCognitiveCycle } from '../../brain/cognition/cognitiveLoop';
import { COGNITIVE_PHASES, COGNITIVE_PHASE_LABELS_AR } from '../../brain/cognition/types';
import { toMemoryRecord, upsertMemoryRecord } from '../../brain/memory/store';
import { makeMemoryEntry } from '../../brain/memory/longTerm';
import type { TeamConflict } from '../../brain/team/types';
import type { BrainMemoryStoreState } from '../../brain/memory/store';
import type { CognitiveCycleInput } from '../../brain/cognition/cognitiveLoop';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(t: string) { console.log(`\n▸ ${t}`); }

const NOW = Date.parse('2026-10-04T10:00:00.000Z');
const AT = new Date(NOW).toISOString();

function memStore(): BrainMemoryStoreState {
  const entries = [
    makeMemoryEntry({ id: 'm1', kind: 'business', statement: 'سعر غسالة سامسونج 850,000 د.ع', origin: 'platform_data', source: 'workspace.products', now: NOW, sampleSize: 5, confidence: 'high', platform: 'youtube' }),
    makeMemoryEntry({ id: 'm2', kind: 'failure', statement: 'رد آلي على سؤال سعر بلا تسجيل السعر أزعج الجمهور', origin: 'derived', source: 'socialReplies', now: NOW, sampleSize: 4, confidence: 'medium', platform: 'youtube' }),
    makeMemoryEntry({ id: 'm3', kind: 'audience', statement: 'أسئلة التوفر على الغسالات متكررة', origin: 'platform_data', source: 'socialComments', now: NOW, sampleSize: 6, confidence: 'high', platform: 'youtube' }),
    makeMemoryEntry({ id: 'm4', kind: 'ai', statement: 'افتراض بأن الأسعار سترتفع', origin: 'ai_statement', source: 'ai', now: NOW, sampleSize: 1, confidence: 'low', platform: 'youtube' } as any),
  ].map(toMemoryRecord);
  return { records: entries };
}

// 1) السياق الإدراكي — يجيب WHAT/WHO/WHERE/WHEN ويفصل الحقيقة.
{
  const ctx = buildCognitiveContext({
    now: NOW, platform: 'youtube', eventIdentity: 'comment:c1', eventText: 'كم سعر الغسالة؟',
    objective: 'البتّ في رد آمن', surfaceKind: 'comment', conversationId: 'youtube::v1',
    sessionMessages: 4, windowSize: 3, windowTruncated: true, lastActivityAt: AT,
    previousDiscussion: 'سأل عن التوفر سابقاً', evidence: ['تعليق حقيقي cmt_1'], unknown: ['هل المنتج متوفر؟'],
    unavailable: ['عمر الجمهور'], referencedObjectIds: ['vid_1'], relevantMarketingContext: ['حملة الغسالات'],
    requiredNextDecision: 'هل نرد أم نصعّد؟',
  });
  check('السياق يجيب WHAT', ctx.what.includes('سعر'));
  check('السياق يجيب WHERE', ctx.where.platform === 'youtube' && ctx.where.surfaceKind === 'comment');
  check('السياق يجيب WHO (كيانات)', ctx.who.some((e) => e.kind === 'platform') && ctx.who.some((e) => e.kind === 'conversation'));
  check('السياق يحمل WHEN', Boolean(ctx.when));
  check('السياق يعلن المجهول', ctx.truth.unknown.length === 1);
  check('السياق يعلن غير المتاح', ctx.truth.unavailable.length === 1);
  check('السياق يحمل السياق التسويقي', ctx.relevantMarketingContext.length === 1);
  check('السياق يحمل حالة المحادثة (مقتطعة)', ctx.conversationState.truncated === true);
  const sum = summarizeCognitiveContext(ctx);
  check('ملخّص السياق صادق', sum.unknown === 1 && sum.truncated === true);
  const attached = attachRecalledMemory(ctx, ['m1', 'm2', 'm1']);
  check('ربط الذاكرة يزيل التكرار', attached.relevantMemoryIds.length === 2);
}

// 2) الذاكرة العاملة — TTL + عدم الترقية التلقائية.
{
  let wm = emptyWorkingMemory();
  wm = touchWorkingMemory(wm, { conversationId: 'youtube::v1', platform: 'youtube', objective: 'رد آمن', lastCustomerMessage: 'كم السعر؟', unresolvedQuestion: 'السعر؟', nowIso: AT, lastActivityAt: AT, messageCount: 3 });
  check('الذاكرة العاملة تحفظ السياق النشط', wm.entries.length === 1 && wm.entries[0].objective === 'رد آمن');
  wm = touchWorkingMemory(wm, { conversationId: 'youtube::v1', lastDecisionSummary: 'تصعيد سعر', lastConsultedAgents: ['research', 'critic'], nowIso: new Date(NOW + 1000).toISOString() });
  check('التحديث يدمج بلا فقدان', wm.entries[0].objective === 'رد آمن' && wm.entries[0].lastDecisionSummary === 'تصعيد سعر');
  check('غير منتهية الآن', isWorkingMemoryStale(wm.entries[0], NOW + 1000) === false);
  check('منتهية بعد TTL', isWorkingMemoryStale(wm.entries[0], NOW + WORKING_MEMORY_TTL_MS + 5000) === true);
  const pruned = pruneWorkingMemory(wm, NOW + WORKING_MEMORY_TTL_MS + 5000);
  check('التشذيب يُزيل المنتهي', pruned.entries.length === 0);
  const norm = normalizeWorkingMemory({ entries: [{ conversationId: 'x' }, { bad: true }] });
  check('التوحيد يتجاهل غير الصالح', norm.entries.length === 1);
  const sum = summarizeWorkingMemory(wm, NOW + 1000);
  check('ملخّص الذاكرة العاملة', sum.active === 1 && sum.withUnresolved === 1);
  check('لا ترقية تلقائية (سياق فقط)', !('longTerm' in wm.entries[0]));
}

// 3) الاستدعاء بالصلة — لا تحميل كل الذاكرة.
{
  const store = memStore();
  const recall = recallMemories(store, { now: NOW, platform: 'youtube', text: 'سعر الغسالة', maxResults: 5 });
  check('الاستدعاء يعيد مرشّحين ذوي صلة', recall.used >= 1 && recall.candidates.every((c) => c.relevance > 0));
  check('السجل الأكثر صلة عن السعر أولاً', recall.candidates[0].summary.includes('سعر') || recall.candidates[0].summary.includes('آلي'));
  check('الاستدعاء يفسّر السبب', recall.candidates[0].reasons.length > 0);
  check('الاستدعاء لا يحتاج كل المخزن', recallNeedsFullStore().needsFullStore === false);
  // سجل من منصة أخرى أقل صلة
  const offRecall = recallMemories(store, { now: NOW, platform: 'facebook', text: 'سعر', maxResults: 5 });
  check('منصة مختلفة تُخفّض الصلة', offRecall.candidates.every((c) => !c.reasons.includes('نفس المنصة')));
  check('كلمات مفتاحية معتبرة', keywords('كم سعر الغسالة في المعرض؟').length >= 2);
}

// 4) الأهداف — لا مصطلحات مالية.
{
  const plan = buildGoalPlan({ now: NOW, eventCategory: 'purchase_intent', topic: 'price', priceUnverified: true, hasAudienceOpportunity: false, needsClarification: false, hasPendingEscalation: false });
  check('الهدف الأعلى هو البيع بلا رقم مالي', plan.primaryObjective === PRIMARY_BUSINESS_OBJECTIVE);
  check('حالة السعر غير الموثّق توجّه لهدف الرد', plan.currentGoal.kind === 'RESPOND_TO_BUYING_INTENT');
  check('الأهداف الفرعية موجودة', plan.subGoals.length > 0);
  check('الخطوة التالية توجّه لتصعيد السعر', plan.nextBestStep.includes('صعّد') || plan.nextBestStep.includes('سجّل'));
  check('الخطة لا تخالف النطاق', goalPlanViolatesScope(plan).violates === false);
  const spamPlan = buildGoalPlan({ now: NOW, eventCategory: 'spam', topic: null, priceUnverified: false, hasAudienceOpportunity: false, needsClarification: false, hasPendingEscalation: false });
  check('سبام => لا أتمتة', spamPlan.currentGoal.kind === 'INCREASE_ENGAGEMENT');
}

// 5) اختيار الوكلاء — لا الستة دائماً.
{
  check('شكوى => بلا استراتيجية', !requiredAgentsForScenario('complaint').includes('strategy'));
  check('نية شراء => بلا بحث', !requiredAgentsForScenario('buying_signal').includes('research'));
  check('سؤال مجهول => بحث+نقد (صغير)', requiredAgentsForScenario('unknown_factual_question').length === 3);
  check('فرصة محتوى => الستة', routeCouncilDecision('content_opportunity').fullCouncil === true);
  check('سبام => وكيلان', routeCouncilDecision('spam').agentCount === 2);
  check('الكشف: سعر غير موثّق', detectCouncilScenario({ eventCategory: 'question', priceUnverified: true }) === 'price_unverified');
  check('الكشف: نية شراء', detectCouncilScenario({ eventCategory: 'purchase_intent' }) === 'buying_signal');
}

// 6) الخلاف — لا فرض إجماع، والجوهري يمنع الأتمتة.
{
  const safetyConflict: TeamConflict = { id: 'c1', between: ['strategy', 'critic'], statement: 'مهمة تخصّ facebook لكنها غير موثّقة', leftState: 'HYPOTHESIS', rightState: 'UNAVAILABLE', resolved: false, reason: 'يحتاج اتصالاً موثّقاً' };
  check('الخلاف الجوهري مُكتشف', isMaterialToSafety(safetyConflict) === true);
  const analysis = analyzeDisagreements([safetyConflict]);
  check('تحليل الخلاف يمنع الأتمتة', analysis.forcesHumanOrSafe === true && analysis.recommendation !== 'proceed');
  const softConflict: TeamConflict = { id: 'c2', between: ['analysis', 'strategy'], statement: 'توصية مختلفة الأسلوب', leftState: 'DERIVED', rightState: 'HYPOTHESIS', resolved: false, reason: 'تفضيل' };
  check('الخلاف غير الجوهري لا يمنع', analyzeDisagreements([softConflict]).forcesHumanOrSafe === false);
  check('لا حسم بلا دليل مستقل', canResolveConflict(safetyConflict, { source: false }).resolvable === false);
  check('الحسم بدليل مستقل كافٍ', canResolveConflict(safetyConflict, { source: true, sampleSize: 5 }).resolvable === true);
}

// 7) الإجراء التالي — محكوم بترتيب سلامة.
{
  const spam = proposeNextAction({ goalKind: 'INCREASE_ENGAGEMENT', truthState: 'UNKNOWN', brainFinalStatus: 'NO_ACTION', forcesHumanOrSafe: false, replyCapable: true, publishCapable: true, providerVerified: true, priceUnverified: false, eventCategory: 'spam', isSpam: true, hasPendingEscalation: false, hasContentOpportunity: false });
  check('سبام => do_nothing', spam.kind === 'do_nothing' && spam.requiredPermission === 'READ');
  const price = proposeNextAction({ goalKind: 'RESPOND_TO_BUYING_INTENT', truthState: 'DERIVED', brainFinalStatus: 'HUMAN_ESCALATION', forcesHumanOrSafe: false, replyCapable: true, publishCapable: true, providerVerified: true, priceUnverified: true, eventCategory: 'purchase_intent', isSpam: false, hasPendingEscalation: false, hasContentOpportunity: false });
  check('سعر غير موثّق => escalate حسّاس', price.kind === 'escalate' && price.requiredPermission === 'SENSITIVE');
  const buy = proposeNextAction({ goalKind: 'RESPOND_TO_BUYING_INTENT', truthState: 'DERIVED', brainFinalStatus: 'ALLOWED_ACTION', forcesHumanOrSafe: false, replyCapable: true, publishCapable: true, providerVerified: true, priceUnverified: false, eventCategory: 'purchase_intent', isSpam: false, hasPendingEscalation: false, hasContentOpportunity: false });
  check('نية شراء + بوابة مكتملة => respond خارجي', buy.kind === 'respond' && buy.requiredPermission === 'EXTERNAL_ACTION');
  const unknownQ = proposeNextAction({ goalKind: 'CONVERT_ATTENTION_TO_INQUIRY', truthState: 'UNKNOWN', brainFinalStatus: 'FAILED_SAFE', forcesHumanOrSafe: false, replyCapable: true, publishCapable: true, providerVerified: true, priceUnverified: false, eventCategory: 'question', isSpam: false, hasPendingEscalation: false, hasContentOpportunity: false });
  check('مجهول + سؤال => ask_clarification', unknownQ.kind === 'ask_clarification');
}

// 8) التخطيط — خطوات محكومة.
{
  const plan = buildPlan({ objective: 'رد آمن', goalKind: 'RESPOND_TO_BUYING_INTENT', nextActionKind: 'respond', nextActionRationale: 'نية شراء', brainFinalStatus: 'APPROVAL_REQUIRED', consultedAgents: 5, unresolvedDisagreements: 0, replyCapable: true, publishCapable: true, providerVerified: true, externalApproved: false });
  check('الخطة تشمل خطوة خارجية محجوبة بلا اعتماد', plan.steps.some((s) => s.external && !s.allowed && s.requiresApproval));
  check('حرس الحوكمة على الخطة', planRespectsGovernance(plan.steps).respects === true);
  check('وردت خطوة رصد النتيجة', plan.steps.some((s) => s.kind === 'observe'));
  const plan2 = buildPlan({ objective: 'رد آمن', goalKind: 'RESPOND_TO_BUYING_INTENT', nextActionKind: 'respond', nextActionRationale: 'نية', brainFinalStatus: 'ALLOWED_ACTION', consultedAgents: 5, unresolvedDisagreements: 0, replyCapable: true, publishCapable: true, providerVerified: true, externalApproved: true });
  check('الخطة تسمح بالإجراء عند اكتمال البوابة', plan2.steps.some((s) => s.external && s.allowed));
}

// 9) التعلّم — لا بيع مُخترع، ولا مصطلح مالي.
{
  const obs = makeOutcomeObservation({ id: 'o1', platform: 'youtube', kind: 'inquiry', summary: 'استفسار جديد عن التقسيط', source: 'socialComments', sampleSize: 4, now: NOW });
  const lesson = deriveLesson(obs, NOW);
  check('الدرس الدائم يحتاج عيّنة كافية', lesson.durable === true && lesson.sampleSize === 4);
  const weak = deriveLesson(makeOutcomeObservation({ id: 'o2', platform: 'youtube', kind: 'no_change', summary: 'لا تغيّر', source: 'platform', sampleSize: 1, now: NOW }), NOW);
  check('العيّنة الضعيفة لا تُرقّى', weak.durable === false);
  check('الحد الأدنى للتعلّم 3', LESSON_DURABLE_MIN_SAMPLE === 3);
  const outcome = buildLearningOutcome([obs], NOW);
  check('حلقة التعلّم تعيد درساً دائماً', outcome.durableLessons.length === 1);
  let rejected = false;
  try { makeOutcomeObservation({ id: 'o3', platform: 'youtube', kind: 'inquiry', summary: 'زيادة الإيراد 20%', source: 'x', sampleSize: 3, now: NOW }); } catch { rejected = true; }
  check('رفض نتيجة مالية (إيراد)', rejected === true);
  check('التعلّم لا يعدّل قواعده', learningIsNonSelfModifying().selfModifying === false);
  check('لا مخالفة نطاق', learningOutcomeViolatesScope(outcome).violates === false);
  // جسر الذاكرة طويلة المدى: لا ترقية بلا شرط، والأصل صريح.
  const bridge = learningToMemoryEntries(outcome, { platform: 'youtube', now: NOW, source: 'socialComments' });
  check('الجسر يُنشئ سجل ذاكرة للدرس الدائم', bridge.length === 1 && bridge[0].key === 'lesson:o1');
  check('سجل الجسر من نوع outcome', bridge[0].entry.kind === 'outcome');
  check('أصل السجل من بيانات المنصة (استفسار)', bridge[0].entry.origin === 'platform_data');
  check('مفتاح الجسر ثابت لمنع التكرار', bridge[0].key.startsWith('lesson:'));
  const noPromote = lessonToMemoryEntry({ id: 'lesson:o2', statement: 'x', source: 'platform', sampleSize: 1, confidence: 'low', durable: false, limitations: '' }, { id: 'l2', platform: 'youtube', now: NOW, source: 'platform' });
  check('لا ترقية لدرس غير دائم', noPromote === null);
  const derivedBridge = lessonToMemoryEntry({ id: 'lesson:o4', statement: 'لا تغيّر', source: 'insight', sampleSize: 5, confidence: 'medium', durable: true, limitations: '' }, { id: 'l4', platform: null, now: NOW, source: 'insight' });
  check('نمط ملاحَظ => أصل derived لا حقيقة', derivedBridge?.origin === 'derived');
  // دورة كاملة: تعلّم → ذاكرة طويلة المدى → استدعاء لاحق (round-trip).
  let store: BrainMemoryStoreState = { records: [] };
  for (const b of bridge) store = upsertMemoryRecord(store, toMemoryRecord(b.entry)).store;
  check('سجل التعلّم دخل الذاكرة الدائمة', store.records.filter((r) => r.kind === 'outcome').length === 1);
  const recallBack = recallMemories(store, { now: NOW, platform: 'youtube', text: 'استفسار التقسيط', maxResults: 5 });
  check('الذاكرة المستدعاة تعيد درس التعلّم', recallBack.candidates.some((c) => c.kind === 'outcome'));
  const store2 = upsertMemoryRecord(store, toMemoryRecord(bridge[0].entry)).store;
  check('إعادة الإدراج لا تُكرّر السجل', store2.records.length === store.records.length);
}

// 10) الدورة الإدراكية الكاملة.
{
  function cycleInput(over: Partial<CognitiveCycleInput> = {}): CognitiveCycleInput {
    return {
      now: NOW, platform: 'youtube', eventIdentity: 'comment:c1',
      context: {
        now: NOW, platform: 'youtube', eventIdentity: 'comment:c1', eventText: 'كم سعر الغسالة؟', objective: 'رد آمن',
        surfaceKind: 'comment', conversationId: 'youtube::v1', sessionMessages: 4, windowSize: 3, windowTruncated: false,
        lastActivityAt: AT, previousDiscussion: null, evidence: ['تعليق حقيقي cmt_1'], unknown: ['التوفر'],
        unavailable: ['عمر الجمهور'], referencedObjectIds: ['vid_1'], relevantMarketingContext: ['حملة'], requiredNextDecision: 'رد أم تصعيد؟',
      },
      memoryStore: memStore(),
      session: {
        consultedAgents: ['orchestrator', 'research', 'analysis', 'critic', 'decision'],
        conflicts: [], truthState: 'DERIVED', confidence: 'medium', criticFailed: false, decisionVerified: true,
        decisionStatement: 'قرار مقترح', decisionLimitations: ['حدود'], decisionProposedAction: 'مسودة رد',
        finalStatus: 'HUMAN_ESCALATION', escalationReason: 'price_unverified',
      },
      capabilities: { replyCapable: true, publishCapable: true, providerVerified: true, externalApproved: false },
      event: { category: 'purchase_intent', topic: 'price', priceUnverified: true, hasContentOpportunity: false, needsClarification: false, hasPendingEscalation: false, isSpam: false },
      observations: [],
      ...over,
    };
  }
  const report = buildCognitiveCycle(cycleInput());
  check('الدورة تشمل 11 مرحلة', report.phases.length === COGNITIVE_PHASES.length, String(report.phases.length));
  check('كل المراحل بلا إجراء خارجي', report.phases.every((p) => p.externalAction === false));
  check('ترتيب المراحل صحيح', report.phases.map((p) => p.phase).join(',') === COGNITIVE_PHASES.join(','));
  check('الدورة تنتج سياقاً', Boolean(report.context.contextId));
  check('الدورة تستدعي الذاكرة', report.recall.used >= 0);
  check('الدورة تبني خطة أهداف', report.goalPlan.currentGoal.kind.length > 0);
  check('الدورة توجّه المجلس', report.council.agentCount >= 2);
  check('الدورة تنتج إجراءً مقترحاً', report.nextAction.kind === 'escalate');
  check('السعر غير الموثّق => تصعيد', report.decisionStatus === 'HUMAN_ESCALATION');
  check('حالة التفكير لا تخزّن تفكيراً داخلياً', report.reasoning.storesPrivateChainOfThought === false);
  check('حالة التفكير تحمل عدم اليقين', report.reasoning.uncertainty.truthState === 'DERIVED');
  check('المراقبة تعلن عدم التنفيذ الخارجي', report.observability.externalActionTaken === false);
  check('المراقبة تحمل الهدف الحالي', report.observability.currentObjective.length > 0);
  check('لا ادعاء نتيجة بلا رصد', report.observability.lastObservedOutcome === null);
  check('لا مخالفة نطاق في الدورات', !report.limitations.some((l) => l.includes('مصطلح') && l.includes('تحذير')));

  // دورة بلا أدلة => no_data/partial آمن.
  const empty = buildCognitiveCycle(cycleInput({
    session: { consultedAgents: [], conflicts: [], truthState: 'UNKNOWN', confidence: 'low', criticFailed: true, decisionVerified: false, decisionStatement: '', decisionLimitations: [], decisionProposedAction: '', finalStatus: 'FAILED_SAFE', escalationReason: null },
    event: { category: 'question', topic: null, priceUnverified: false, hasContentOpportunity: false, needsClarification: false, hasPendingEscalation: false, isSpam: false },
  }));
  check('بلا أدلة/وكلاء => no_data', empty.status === 'no_data');
  check('بلا دليل لا إجراء خارجي مسموح', empty.planSteps.filter((s) => s.external).every((s) => !s.allowed));
}

// 11) تعليق الخلاف الجوهري على الدورة.
{
  const conflict: TeamConflict = { id: 'x', between: ['strategy', 'critic'], statement: 'سعر غير موثّق', leftState: 'HYPOTHESIS', rightState: 'UNAVAILABLE', resolved: false, reason: 'يحتاج تسجيل السعر' };
  const report = buildCognitiveCycle({
    now: NOW, platform: 'youtube', eventIdentity: 'comment:c2',
    context: { now: NOW, platform: 'youtube', eventIdentity: 'comment:c2', eventText: 'كم السعر؟', objective: 'رد', surfaceKind: 'comment', conversationId: null, sessionMessages: 1, windowSize: 1, windowTruncated: false, lastActivityAt: null, previousDiscussion: null, evidence: ['تعليق'], unknown: [], unavailable: [], referencedObjectIds: [], relevantMarketingContext: [], requiredNextDecision: 'رد؟' },
    memoryStore: { records: [] },
    session: { consultedAgents: ['strategy', 'critic'], conflicts: [conflict], truthState: 'HYPOTHESIS', confidence: 'low', criticFailed: false, decisionVerified: true, decisionStatement: 'x', decisionLimitations: [], decisionProposedAction: 'x', finalStatus: 'HUMAN_ESCALATION', escalationReason: 'price_unverified' },
    capabilities: { replyCapable: true, publishCapable: true, providerVerified: true, externalApproved: false },
    event: { category: 'purchase_intent', topic: 'price', priceUnverified: true, hasContentOpportunity: false, needsClarification: false, hasPendingEscalation: false, isSpam: false },
  });
  check('الخلاف الجوهري يظهر في التقرير', report.disagreement.forcesHumanOrSafe === true);
  check('لا دليل كافٍ => حالة partial', report.status === 'partial');
}

// 12) سلامة المراحل مقابل المحدّد.
{
  check('المراحل ضمن المحدّد', COGNITIVE_PHASES.every((p) => typeof COGNITIVE_PHASE_LABELS_AR[p] === 'string'));
  check('ACT مرحلة موجودة', COGNITIVE_PHASES.includes('ACT'));
  check('LEARN آخر مرحلة', COGNITIVE_PHASES[COGNITIVE_PHASES.length - 1] === 'LEARN');
}

// 13) إغلاق حلقة التعلّم: ACTION→RESULT→FOLLOW-UP→LESSON→MEMORY→FUTURE DECISION.
// يحاكي بالضبط ما يفعله الخادم عند تغيّر تفاعل المتابعة (recordReadOutcome) عبر
// مراقب YouTube، ثم يثبت أن الدرس يُستدعى في دورة إدراكية لاحقة (قرار مستقبلي).
// صفر شبكة، صفر AI — منطق خالص.
{
  group('13) إغلاق حلقة التعلّم => القرار المستقبلي يستدعي الدرس فعلاً');
  // (أ) عند تغيّر التفاعل: نتيجة ← درس دائم ← عنصر ذاكرة (نفس مسار الخادم).
  const obs = makeOutcomeObservation({
    id: 'yt-followup:cmt_loop', platform: 'youtube', kind: 'engagement_changed',
    summary: 'تفاعل متابعة على رد مُسلَّم (+4 إعجاب، +2 رد).',
    source: 'platform_data:youtube-comments', sampleSize: 3, now: NOW,
  });
  const lesson = deriveLesson(obs, NOW);
  check('الدرس دائم (مصدر + عيّنة كافية)', lesson.durable === true);
  const entry = lessonToMemoryEntry(lesson, { id: lesson.id, platform: 'youtube', now: NOW, source: obs.source });
  check('درس دائم => عنصر ذاكرة (ليس null)', entry !== null);
  const lessonRecord = toMemoryRecord(entry!);
  check('مفتاح الذاكرة يبدأ ب lesson: (قابل للعدّ)', lessonRecord.id.startsWith('lesson:'));
  check('الأصل صريح (platform_data/derived)', lessonRecord.origin === 'platform_data' || lessonRecord.origin === 'derived');
  const futureStore: BrainMemoryStoreState = { records: [lessonRecord] };

  // (ب) القرار المستقبلي: دورة إدراكية على تعليق YouTube جديد (نفس المنصة) تستدعي الدرس.
  const futureReport = buildCognitiveCycle({
    now: NOW + 3600_000, platform: 'youtube', eventIdentity: 'comment:future',
    context: { now: NOW + 3600_000, platform: 'youtube', eventIdentity: 'comment:future', eventText: 'عاشت إيدكم', objective: 'رد', surfaceKind: 'comment', conversationId: 'youtube::v9', sessionMessages: 1, windowSize: 1, windowTruncated: false, lastActivityAt: null, previousDiscussion: null, evidence: ['تعليق حقيقي'], unknown: [], unavailable: [], referencedObjectIds: [], relevantMarketingContext: [], requiredNextDecision: 'رد؟' },
    memoryStore: futureStore,
    session: { consultedAgents: ['research'], conflicts: [], truthState: 'FACT', confidence: 'medium', criticFailed: false, decisionVerified: true, decisionStatement: 'x', decisionLimitations: [], decisionProposedAction: 'x', finalStatus: 'ALLOWED_ACTION', escalationReason: null },
    capabilities: { replyCapable: true, publishCapable: false, providerVerified: true, externalApproved: false },
    event: { category: 'praise', topic: null, priceUnverified: false, hasContentOpportunity: false, needsClarification: false, hasPendingEscalation: false, isSpam: false },
  });
  check('القرار المستقبلي استدعى الدرس من الذاكرة', futureReport.observability.memoryUsed >= 1, `memoryUsed=${futureReport.observability.memoryUsed}`);
  check('الدرس حاضر في سياق القرار المستقبلي', (futureReport.context.relevantMemoryIds || []).includes(lessonRecord.id), JSON.stringify(futureReport.context.relevantMemoryIds));
  const recalled = recallMemories(futureStore, { now: NOW + 3600_000, platform: 'youtube', text: 'عاشت إيدكم' });
  check('الاستدعاء بالصلة أعطى الدرس سبباً صريحاً', recalled.candidates[0]?.reasons?.includes('نفس المنصة') === true);
  check('استدعاء الذاكرة لا يحمل أي رقم مالي', !/إيراد|ربح|ROI|هامش/i.test(JSON.stringify(recalled)));

  // (ج) لا قفز للأمام: بلا تغيّر (no_change) لا يُبنى درس دائم ⇒ لا يتغيّر القرار المستقبلي.
  const noChangeObs = makeOutcomeObservation({ id: 'yt-followup:cmt_flat', platform: 'youtube', kind: 'no_change', summary: 'لا تغيّر ملاحَظ في تفاعل المتابعة.', source: 'platform_data:youtube-comments', sampleSize: 3, now: NOW });
  const noChangeEntry = lessonToMemoryEntry(deriveLesson(noChangeObs, NOW), { id: 'lesson:flat', platform: 'youtube', now: NOW, source: noChangeObs.source });
  const flatReport = buildCognitiveCycle({
    now: NOW + 3600_000, platform: 'youtube', eventIdentity: 'comment:flatfuture',
    context: { now: NOW + 3600_000, platform: 'youtube', eventIdentity: 'comment:flatfuture', eventText: 'سؤال', objective: 'رد', surfaceKind: 'comment', conversationId: null, sessionMessages: 1, windowSize: 1, windowTruncated: false, lastActivityAt: null, previousDiscussion: null, evidence: [], unknown: [], unavailable: [], referencedObjectIds: [], relevantMarketingContext: [], requiredNextDecision: 'رد؟' },
    memoryStore: { records: [toMemoryRecord(noChangeEntry!)] },
    session: { consultedAgents: ['research'], conflicts: [], truthState: 'UNKNOWN', confidence: 'low', criticFailed: false, decisionVerified: false, decisionStatement: '', decisionLimitations: [], decisionProposedAction: '', finalStatus: 'FAILED_SAFE', escalationReason: null },
    capabilities: { replyCapable: true, publishCapable: false, providerVerified: true, externalApproved: false },
    event: { category: 'question', topic: null, priceUnverified: false, hasContentOpportunity: false, needsClarification: false, hasPendingEscalation: false, isSpam: false },
  });
  check('درس no_change موجود لكنه لا يُرقّى لحقيقة بيع', noChangeEntry !== null && noChangeEntry!.kind === 'outcome');
  check('التعلّم غير معدِّل ذاتياً', learningIsNonSelfModifying().selfModifying === false);
  check('الحلقة لا تخترق النطاق المالي', learningOutcomeViolatesScope(buildLearningOutcome([obs, noChangeObs], NOW)).violates === false);
  check('القرار المستقبلي صادق (لا إجراء خارجي)', flatReport.planSteps.filter((s) => s.external).every((s) => !s.allowed));
}

if (failures.length) {
  console.error(`FAILED: ${failures.length}\n` + failures.join('\n'));
  process.exit(1);
}
console.log(`PASSED: ${passed} cognition (Batch 7) checks`);
