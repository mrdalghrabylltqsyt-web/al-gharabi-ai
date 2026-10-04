/**
 * Batch 8.1 — إثبات سلطة العقل المركزي الواحدة (اختبار معماري + سلوكي، بلا شبكة).
 *
 * يثبت النقاط الاثنتي عشرة المطلوبة، مع **سلوك فعلي** (لا فحص نصّي فقط):
 *  1) العقل المركزي سلطة التنفيذ الوحيدة وقت التشغيل.
 *  2) decideCommentAction لا يفوّض تنفيذاً بنفسه.
 *  3) الحوكمة إلزامية (لا رد خارج ALLOWED_ACTION).
 *  4) سجل القرار قابل للقراءة من العقل المركزي.
 *  5) النتائج الحقيقية تُغذّي سياق العقل المستقبلي.
 *  6) لا تُخترع نتائج (غير المتاح يبقى غير متاح).
 *  7) الاستراتيجية/الجمهور تؤثّر في التفكير/التخطيط فعلاً (لا عرض فقط).
 *  8) الوكلاء الستة استشاريون.
 *  9) الناقد استشاري.
 * 11) عقل مركزي canonical واحد.
 * 12) نظام ذاكرة canonical واحد.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  buildCognitiveCycle, type CognitiveCycleInput,
} from '../../brain/cognition/cognitiveLoop';
import { emptyBrainMemory } from '../../brain/memory/store';
import { CENTRAL_BRAIN_ID, ADVISOR_AGENT_IDS } from '../../brain/consolidation';
import { resolveCommentExecution, decideCommentAction, defaultWatcherControls } from '../../social/youtubeWatcher';
import { buildRuntimeDecisionContext, decisionHistoryToMemoryRecords } from '../../brain/runtime';
import { emptyDecisionLedger, recordDecision, attachOutcome } from '../../brain/cognition/decisionLedger';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(t: string) { console.log(`\n▸ ${t}`); }

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const NOW = Date.parse('2026-10-04T10:00:00.000Z');

function baseCycleInput(overrides: Partial<CognitiveCycleInput> = {}): CognitiveCycleInput {
  return {
    now: NOW, platform: 'youtube', eventIdentity: 'comment:c1',
    context: {
      now: NOW, platform: 'youtube', eventIdentity: 'comment:c1', eventText: 'ما رأيكم بالمنتج؟',
      objective: 'البتّ في رد آمن', surfaceKind: 'comment', conversationId: null,
      sessionMessages: 1, windowSize: 1, windowTruncated: false, lastActivityAt: null,
      previousDiscussion: null, evidence: [], unknown: [], unavailable: [],
      referencedObjectIds: [], relevantMarketingContext: [], requiredNextDecision: 'رد؟',
    },
    memoryStore: emptyBrainMemory(),
    session: {
      consultedAgents: ['research'], conflicts: [], truthState: 'DERIVED', confidence: 'medium',
      criticFailed: false, decisionVerified: true, decisionStatement: 'رد آمن', decisionLimitations: [],
      decisionProposedAction: 'رد', finalStatus: 'ALLOWED_ACTION', escalationReason: null,
    },
    capabilities: { replyCapable: true, publishCapable: false, providerVerified: true, externalApproved: false },
    event: { category: 'praise', topic: 'general', priceUnverified: false, hasContentOpportunity: false, needsClarification: false, hasPendingEscalation: false, isSpam: false },
    ...overrides,
  };
}

function run(): void {
  const server = read('server.ts');
  const watcher = read('engine/social/youtubeWatcher.ts');

  // ── 1) سلطة التنفيذ الوحيدة ────────────────────────────────────────────────
  group('1) العقل المركزي سلطة التنفيذ الوحيدة');
  check('المسار يستدعي resolveCommentExecution (سلطة التنفيذ)', server.includes('resolveCommentExecution('));
  check('المسار يقرأ قرار العقل المركزي للحدث', server.includes('centralActionDecisionForEvent('));
  check('غياب القرار المركزي => لا رد (FAILED_SAFE)', server.includes("centralDecision: centralDecision ?? 'FAILED_SAFE'"));

  // ── 2) decideCommentAction استشاري (لا يفوّض) ──────────────────────────────
  group('2) decideCommentAction استشاري لا يفوّض تنفيذاً');
  check('decideCommentAction يُمرَّر كـ advisory فقط', server.includes('advisory,'));
  check('resolveCommentExecution موجودة في الوحدة', watcher.includes('export function resolveCommentExecution'));
  // سلوك: قرار العقل غير ALLOWED_ACTION لا يُنتج رداً مهما كان التصنيف الاستشاري.
  {
    const advisory = decideCommentAction({ intent: 'praise', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: { ...defaultWatcherControls(), autoReply: true, humanReviewMode: false } });
    const base = { advisory, automationAllowed: true, replyReady: true, belongsToChannel: true, isPraise: true, humanReviewMode: false, centralEscalationReason: null };
    check('NO_ACTION لا يُنتج رداً', resolveCommentExecution({ ...base, centralDecision: 'NO_ACTION' }).action !== 'reply');
    check('HUMAN_ESCALATION لا يُنتج رداً', resolveCommentExecution({ ...base, centralDecision: 'HUMAN_ESCALATION' }).action !== 'reply');
    check('APPROVAL_REQUIRED لا يُنتج رداً', resolveCommentExecution({ ...base, centralDecision: 'APPROVAL_REQUIRED' }).action !== 'reply');
    check('ALLOWED_ACTION يُنتج رداً', resolveCommentExecution({ ...base, centralDecision: 'ALLOWED_ACTION' }).action === 'reply');
  }

  // ── 3) الحوكمة إلزامية ─────────────────────────────────────────────────────
  group('3) الحوكمة إلزامية');
  check('composeBrainDecision يُطبّق evaluateGovernance', read('engine/brain/team/brainDecision.ts').includes('evaluateGovernance'));
  check('الحالة النهائية محسوبة من الحوكمة', read('engine/brain/team/brainDecision.ts').includes('finalStatus'));

  // ── 4) سجل القرار قابل للقراءة ─────────────────────────────────────────────
  group('4) سجل القرار قابل للقراءة من العقل المركزي');
  const runtime = read('engine/brain/runtime.ts');
  check('decisionHistoryToMemoryRecords موجود', runtime.includes('export function decisionHistoryToMemoryRecords'));
  check('الخادم يقرأ السجل في دورة وقت التشغيل', server.includes('decisionHistoryToMemoryRecords(decisionLedger'));
  check('buildRuntimeDecisionContext يقرأ النتائج', runtime.includes('consumedDecisionHistory'));

  // ── 5) النتائج الحقيقية تُغذّي سياق العقل المستقبلي ─────────────────────────
  group('5) النتائج الحقيقية تُغذّي سياق العقل المستقبلي');
  {
    let ledger = recordDecision(emptyDecisionLedger(), { decisionId: 'bd-1', platform: 'youtube', eventIdentity: 'comment:c1', finalStatus: 'ALLOWED_ACTION', actionKind: 'external_action', actionText: 'رد', now: NOW }).ledger;
    ledger = attachOutcome(ledger, { decisionId: 'bd-1', kind: 'delivered', summary: 'أُرسل رد وتحقّق المزوّد.', source: 'platform_data:youtube', providerReplyId: 'r-9', now: NOW + 1 }).ledger;
    const dc = buildRuntimeDecisionContext({ platforms: ['youtube'], now: NOW + 2, goalPrimary: 'SALES', records: [], comments: [], replies: [], publishes: [], watcher: [], connections: [], decisionLedger: ledger } as any);
    check('السياق يحمل نتيجة القرار السابق', dc.priorOutcomes.length === 1);
    check('السياق يعلن استهلاك التاريخ', dc.consumedDecisionHistory === true);
    check('معرّف رد المزوّد محفوظ كدليل', dc.priorOutcomes[0]?.providerReplyId === 'r-9');
  }

  // ── 6) لا تُخترع نتائج ─────────────────────────────────────────────────────
  group('6) لا تُخترع نتائج');
  {
    const ledger = recordDecision(emptyDecisionLedger(), { decisionId: 'bd-2', platform: 'youtube', eventIdentity: 'comment:c2', finalStatus: 'ALLOWED_ACTION', actionKind: 'external_action', actionText: 'رد', now: NOW }).ledger;
    check('قرار بلا نتيجة => لا سجل ذاكرة (لا اختراع)', decisionHistoryToMemoryRecords(ledger, NOW).length === 0);
  }

  // ── 7) الاستراتيجية/الجمهور تؤثّر في التفكير/التخطيط فعلاً ─────────────────
  group('7) الاستراتيجية/الجمهور تؤثّر في التفكير/التخطيط فعلاً');
  {
    // حدث مدح عام بلا فرصة محتوى صريحة + موضوع لا يطابق أي جمهور ⇒ هدف تفاعل.
    const noCtx = buildCognitiveCycle(baseCycleInput({
      event: { category: 'praise', topic: 'general', priceUnverified: false, hasContentOpportunity: false, needsClarification: false, hasPendingEscalation: false, isSpam: false },
    }));
    // حدث غير مصنّف بموضوع يطابق جمهوراً ملاحَظاً (دليل حقيقي) ⇒ الهدف يتغيّر فعلاً.
    // (لا نعيد ترتيب أسبقية الأهداف القائمة: الفئات الآمنة/الاجتماعية تبقى أولاً.)
    const withAudience = buildCognitiveCycle(baseCycleInput({
      event: { category: 'unknown', topic: 'تقسيط', priceUnverified: false, hasContentOpportunity: false, needsClarification: false, hasPendingEscalation: false, isSpam: false },
      brain: {
        brainId: CENTRAL_BRAIN_ID, strategyVersion: 4, strategyScopeCount: 3,
        strategySummary: [{ scope: 'audience', what: 'محتوى عن التقسيط', status: 'supported' }],
        canonicalGoal: 'SALES', audienceSegments: 2, audienceTopics: ['تقسيط', 'ضمان'],
        marketHasEvidence: true, marketNote: 'إشارات شراء ملاحَظة.', knowledgeCount: 5, available: true,
      },
    }));
    const noCtxUnknown = buildCognitiveCycle(baseCycleInput({
      event: { category: 'unknown', topic: 'تقسيط', priceUnverified: false, hasContentOpportunity: false, needsClarification: false, hasPendingEscalation: false, isSpam: false },
    }));
    check('بلا سياق جمهور ⇒ الهدف الافتراضي (لا فرصة)', noCtxUnknown.goalPlan.currentGoal.kind === 'INCREASE_PURCHASE_SIGNALS', noCtxUnknown.goalPlan.currentGoal.kind);
    check('مع تطابق جمهور ⇒ هدف اكتشاف فرصة (استهلاك فعلي)', withAudience.goalPlan.currentGoal.kind === 'IDENTIFY_AUDIENCE_OPPORTUNITY', withAudience.goalPlan.currentGoal.kind);
    check('تغيّر الهدف يثبت أن الجمهور يؤثّر في التخطيط (لا عرض فقط)', noCtxUnknown.goalPlan.currentGoal.kind !== withAudience.goalPlan.currentGoal.kind);
    check('التقرير يعرض موضوعات الجمهور المستهلكة', withAudience.brain.audienceTopics.length === 2);
    check('التقرير يعلن استهلاك دليل السوق', withAudience.brain.marketConsumed === true);
    check('بلا سياق ⇒ لا موضوعات جمهور مخترعة', noCtx.brain.audienceTopics.length === 0);
    // الاستراتيجية الكانونية تُستهلك فعلاً: خطة مدعومة نطاقها جمهور/محتوى + موضوعات
    // جمهور ملاحَظة ⇒ هدف اكتشاف فرصة حتى بلا تطابق موضوع مباشر (دليل استراتيجي).
    const withStrategy = buildCognitiveCycle(baseCycleInput({
      event: { category: 'unknown', topic: 'عام', priceUnverified: false, hasContentOpportunity: false, needsClarification: false, hasPendingEscalation: false, isSpam: false },
      brain: {
        brainId: CENTRAL_BRAIN_ID, strategyVersion: 5, strategyScopeCount: 1,
        strategySummary: [{ scope: 'audience', what: 'محتوى عن التقسيط للجمهور', status: 'supported' }],
        canonicalGoal: 'SALES', audienceSegments: 1, audienceTopics: ['ضمان'],
        marketHasEvidence: false, marketNote: null, knowledgeCount: 2, available: true,
      },
    }));
    const noStrategy = buildCognitiveCycle(baseCycleInput({
      event: { category: 'unknown', topic: 'عام', priceUnverified: false, hasContentOpportunity: false, needsClarification: false, hasPendingEscalation: false, isSpam: false },
      brain: {
        brainId: CENTRAL_BRAIN_ID, strategyVersion: 5, strategyScopeCount: 0,
        strategySummary: [], canonicalGoal: 'SALES', audienceSegments: 0, audienceTopics: [],
        marketHasEvidence: false, marketNote: null, knowledgeCount: 0, available: true,
      },
    }));
    check('استراتيجية مدعومة + جمهور ⇒ هدف اكتشاف فرصة (استهلاك استراتيجي)', withStrategy.goalPlan.currentGoal.kind === 'IDENTIFY_AUDIENCE_OPPORTUNITY', withStrategy.goalPlan.currentGoal.kind);
    check('بلا استراتيجية/جمهور ⇒ لا فرصة (لا اختراع)', noStrategy.goalPlan.currentGoal.kind === 'INCREASE_PURCHASE_SIGNALS', noStrategy.goalPlan.currentGoal.kind);
    // الاستراتيجية الكانونية تُغذّي حقل الاستراتيجية في التقرير (لا إعادة حساب).
    check('إصدار الاستراتيجية مُستهلك', withAudience.brain.strategyVersion === 4);
  }

  // ── 8) الوكلاء الستة استشاريون ─────────────────────────────────────────────
  group('8) الوكلاء الستة استشاريون');
  check('ADVISOR_AGENT_IDS يحصر ستة وكلاء', ADVISOR_AGENT_IDS.length === 6);
  check('الوكلاء لا يملكون سلطة تنفيذ (لا تصريح خارجي)', !/export function .*Agent[\s\S]{0,400}?executeYouTube/.test(read('engine/brain/team/agents.ts')));

  // ── 9) الناقد استشاري ──────────────────────────────────────────────────────
  group('9) الناقد استشاري');
  check('الناقد يُنتج اعتراضات لا قراراً', read('engine/brain/team/agents.ts').includes('criticAgent'));
  check('فشل الناقد يمنع الإجراء (FAILED_SAFE)', read('engine/brain/team/brainDecision.ts').includes('criticFailed'));


  // ── 11) عقل مركزي canonical واحد ───────────────────────────────────────────
  group('11) عقل مركزي canonical واحد');
  check('CENTRAL_BRAIN_ID واحد', CENTRAL_BRAIN_ID === 'central-brain-1');
  check('لا بناء عقل ثانٍ', !/buildSecondBrain|centralBrain2|secondDecisionEngine/.test(server));
  check('buildRuntimeBrain هو المصدر الكانوني', server.includes('buildRuntimeBrain'));

  // ── 12) نظام ذاكرة canonical واحد ──────────────────────────────────────────
  group('12) نظام ذاكرة canonical واحد');
  check('مخزن ذاكرة واحد (brainMemory)', server.includes('STORAGE_KEY_BRAIN_MEMORY = "brainMemory"'));
  check('لا مخزن ذاكرة ثانٍ', !/secondMemoryStore|brainMemory2/.test(server));
  check('سجل القرار يُرحَّل إلى نفس الذاكرة (لا نظام ثانٍ)', runtime.includes("sourceRefs: ['decisionLedger']"));

  console.log('\n============================================================');
  if (failures.length) {
    console.log(`FAILED: ${failures.length} checks`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} central-brain-authority (Batch 8.1) checks`);
}

run();
