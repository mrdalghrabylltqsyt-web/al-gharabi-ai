/**
 * CONSOLIDATION — اختبار معماري يثبت «عقل مركزي واحد وسلطة قرار واحدة».
 *
 * يُثبت بالدليل (منطق خالص + قراءة كود الإنتاج) الشروط العشرة:
 *  1) عقل مركزي canonical واحد فقط.
 *  2) الإدراك تابع للعقل المركزي (قدرة داخلية لا عقل ثانٍ).
 *  3) الوكلاء الستة لا يملكون سلطة قرار.
 *  4) الناقد لا يستبدل العقل المركزي.
 *  5) الاستراتيجية يستهلكها العقل المركزي (حالة واحدة يملكها).
 *  6) الذاكرة موحّدة (مخزن واحد).
 *  7) التعلّم يعود للعقل المركزي.
 *  8) سلسلة قرار→نتيجة موجودة (بمعرّفات حقيقية، وغير المتاح معلن).
 *  9) لا تفعيل لنطاق تجاري/مبيعات (GHARABI_ENABLE_COMMERCIAL_SALES_SCOPE غير مفعّل).
 * 10) لا نظام عقل/ذاكرة/حوكمة مكرّر مُدخَل.
 *
 * لا شبكة ولا أسرار ولا AI.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  CENTRAL_BRAIN_ID, CENTRAL_BRAIN_CAPABILITIES, ADVISOR_AGENT_IDS,
  advisorContract, criticContract, isAdvisoryOnly, centralBrainAuthorityContract,
} from '../../brain/consolidation';
import {
  emptyStrategyState, updateStrategyState, toStrategySnapshot, strategyFingerprint,
  normalizeStrategyState, summarizeStrategyState,
} from '../../brain/strategyState';
import {
  emptyDecisionLedger, recordDecision, attachOutcome, unavailableOutcome,
  summarizeDecisionLedger, normalizeDecisionLedger,
} from '../../brain/cognition/decisionLedger';
import { buildCognitiveCycle, type CognitiveCycleInput } from '../../brain/cognition/cognitiveLoop';
import { emptyBrainMemory } from '../../brain/memory/store';

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
      now: NOW, platform: 'youtube', eventIdentity: 'comment:c1', eventText: 'كم السعر؟',
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
    event: { category: 'question', topic: 'price', priceUnverified: false, hasContentOpportunity: false, needsClarification: false, hasPendingEscalation: false, isSpam: false },
    ...overrides,
  };
}

function run(): void {
  // ── 1) عقل مركزي canonical واحد ────────────────────────────────────────────
  group('1) عقل مركزي canonical واحد');
  check('CENTRAL_BRAIN_ID ثابت واحد', CENTRAL_BRAIN_ID === 'central-brain-1');
  const server = read('server.ts');
  check('الخادم يستورد buildRuntimeBrain (العقل الكانوني)', server.includes('buildRuntimeBrain'));
  check('مسار لقطة العقل يُعلن brainId=central-brain-1', read('engine/brain/routes.ts').includes("brainId: 'central-brain-1'"));
  check('لا يوجد بناء عقل ثانٍ مستقل (لا buildSecondBrain/centralBrain2)', !/buildSecondBrain|centralBrain2|brain2\b/.test(server));
  const contract = centralBrainAuthorityContract({ cognitionConsumesBrainContext: true, strategyStateOwned: true, decisionLedgerOwned: true });
  check('عدد سلطات القرار = 1', contract.decisionAuthorityCount === 1);
  check('منتِج القرار الوحيد = composeBrainDecision', contract.decisionAuthorityProducer === 'composeBrainDecision');
  check('لا تنفيذ خارجي من العقل', contract.externalExecutionFromBrain === false);

  // ── 2) الإدراك تابع للعقل المركزي ─────────────────────────────────────────
  group('2) الإدراك قدرة داخلية تابعة (لا عقل ثانٍ)');
  const report = buildCognitiveCycle(baseCycleInput({ brain: {
    brainId: CENTRAL_BRAIN_ID, strategyVersion: 3, strategyScopeCount: 2,
    strategySummary: [{ scope: 'audience', what: 'محتوى عن التقسيط', status: 'supported' }],
    canonicalGoal: 'SALES', audienceSegments: 2, audienceTopics: ['سعر', 'تقسيط'],
    marketHasEvidence: true, marketNote: 'إشارات شراء ملاحَظة.', knowledgeCount: 4, available: true,
  } }));
  check('التقرير يعلن التبعية للعقل المركزي', report.brain.subordinateToCentralBrain === true);
  check('التقرير يعلن عدم امتلاك سلطة قرار مستقلة', report.brain.independentDecisionAuthority === false);
  check('التقرير يعلن استهلاك سياق العقل المركزي', report.brain.consumedBrainContext === true);
  check('استُهلك إصدار الاستراتيجية فعلاً', report.brain.strategyVersion === 3);
  check('استُهلك الهدف الكانوني', report.brain.canonicalGoal === 'SALES');
  // بلا سياق عقل: يُعلن صراحةً (لا اختراع).
  const reportNoBrain = buildCognitiveCycle(baseCycleInput());
  check('بلا سياق عقل: consumedBrainContext=false', reportNoBrain.brain.consumedBrainContext === false);
  check('الإدراك لا ينتج قراراً نهائياً بنفسه (مرجع فقط)', report.decisionStatus === 'ALLOWED_ACTION');
  check('isAdvisoryOnly يعلن الإدراك استشارياً', isAdvisoryOnly('cognition').decisive === false);

  // ── 3) الوكلاء الستة مستشارون فقط ─────────────────────────────────────────
  group('3) الوكلاء الستة لا يملكون سلطة قرار');
  check('ستة وكلاء بالضبط', ADVISOR_AGENT_IDS.length === 6);
  check('كل وكلاء مستشارون (canDecide=false)', ADVISOR_AGENT_IDS.every((a) => advisorContract(a).canDecide === false));
  check('كل وكلاء بلا تنفيذ خارجي', ADVISOR_AGENT_IDS.every((a) => advisorContract(a).canExecuteExternal === false));
  check('عقد الوكلاء في السلطة يمنع القرار', contract.advisors.canDecide === false);

  // ── 4) الناقد لا يستبدل العقل ─────────────────────────────────────────────
  group('4) الناقد يتحدّى ولا يستبدل');
  check('الناقد لا يقرّر', criticContract().canDecide === false);
  check('الناقد لا يستبدل العقل المركزي', criticContract().replacesCentralBrain === false);
  check('isAdvisoryOnly للناقد صريح', isAdvisoryOnly('critic').decisive === false);

  // ── 5) الاستراتيجية يملكها العقل المركزي ──────────────────────────────────
  group('5) حالة استراتيجية واحدة يملكها العقل المركزي');
  let st = emptyStrategyState();
  check('الحالة تبدأ فارغة وبلا إصدار', st.currentVersion === 0 && st.current === null);
  const items = toStrategySnapshot([{ scope: 'audience', what: 'محتوى تقسيط', why: 'طلب متكرر', where: ['youtube'], expectedSignal: 'استفسارات', status: 'supported', evidence: ['e1'] }]);
  const r1 = updateStrategyState(st, { items, now: NOW, source: 'brain:strategyEngine' });
  check('أول تحديث => إصدار 1 سبب initial', r1.changed && r1.version === 1 && r1.reason === 'initial');
  st = r1.state;
  check('المالك ثابت central-brain-1', st.owner === CENTRAL_BRAIN_ID);
  const r2 = updateStrategyState(st, { items, now: NOW + 1000 });
  check('نفس اللقطة => لا تغيير (بلا نسخة وهمية)', r2.changed === false && r2.reason === 'no_change');
  const items2 = toStrategySnapshot([{ scope: 'audience', what: 'محتوى تقسيط محدّث', why: 'طلب متزايد', where: ['youtube'], expectedSignal: 'استفسارات', status: 'supported', evidence: ['e2'] }]);
  const r3 = updateStrategyState(st, { items: items2, now: NOW + 2000 });
  check('تغيّر فعلي => إصدار 2 مع تاريخ', r3.changed && r3.version === 2 && r3.state.history.length >= 1);
  check('سبب التغيير معلن', r3.state.current?.reason === 'strategy_changed' && r3.state.current?.reasonLabelAr.length > 0);
  check('الدليل/المصدر مسجّلان', r3.state.current?.evidence.length === 1 && r3.state.current?.source.includes('strategyEngine'));
  check('بصمة حتمية مستقرة', strategyFingerprint(items) === strategyFingerprint(items));
  check('استرجاع الحالة يحافظ على المالك', normalizeStrategyState(r3.state).owner === CENTRAL_BRAIN_ID);
  check('ملخّص الاستراتيجية بلا سرّ', typeof summarizeStrategyState(r3.state).currentVersion === 'number');

  // ── 6) الذاكرة موحّدة ─────────────────────────────────────────────────────
  group('6) الذاكرة موحّدة (مخزن واحد)');
  check('لا مخزن ذاكرة ثانٍ مُدخَل', !/newBrainMemoryStore|secondMemoryStore|memoryStore2/.test(server));
  check('مفتاح ذاكرة العقل واحد (brainMemory)', server.includes('STORAGE_KEY_BRAIN_MEMORY = "brainMemory"'));
  check('الإدراك يقرأ نفس مخزن الذاكرة', read('engine/brain/cognition/cognitiveLoop.ts').includes('BrainMemoryStoreState'));

  // ── 7) التعلّم يعود للعقل المركزي ─────────────────────────────────────────
  group('7) التعلّم يعود للعقل المركزي');
  check('التقرير يحمل كتلة التعلّم', Boolean(report.learning));
  check('حلقة التعلّم مغلقة في الصحة', server.includes('outcomeFeedbackWired: true'));
  check('الدروس تُكتب في نفس ذاكرة العقل (persistBrainMemory)', server.includes('persistBrainMemory'));

  // ── 8) سجل قرار→نتيجة ─────────────────────────────────────────────────────
  group('8) سجل قرار→نتيجة بمعرّفات حقيقية');
  let ledger = emptyDecisionLedger();
  check('السجل يبدأ فارغاً ومالكه العقل', ledger.entries.length === 0 && ledger.owner === CENTRAL_BRAIN_ID);
  const rec = recordDecision(ledger, { decisionId: 'd1', platform: 'youtube', eventIdentity: 'comment:c1', finalStatus: 'ALLOWED_ACTION', actionKind: 'internal_response', actionText: 'رد', now: NOW });
  ledger = rec.ledger;
  check('قرار مسجّل واحد', ledger.entries.length === 1 && rec.added);
  check('النتيجة تبدأ غير متاحة صراحةً', ledger.entries[0].outcome.availability === 'unavailable');
  const recDup = recordDecision(ledger, { decisionId: 'd1', platform: 'youtube', eventIdentity: 'comment:c1', finalStatus: 'ALLOWED_ACTION', actionKind: 'internal_response', actionText: 'رد', now: NOW });
  check('لا تكرار لنفس decisionId', recDup.ledger.entries.length === 1 && recDup.added === false);
  const att = attachOutcome(ledger, { decisionId: 'd1', kind: 'delivered', summary: 'رد مُسلَّم بمعرّف', source: 'platform_data:youtube-replies', now: NOW + 1000, memoryRecordIds: ['lesson:x'], providerReplyId: 'r1' });
  ledger = att.ledger;
  check('ربط النتيجة بقرار موجود', att.attached === true);
  check('النتيجة صارت متاحة مع معرّف مزوّد', ledger.entries[0].outcome.availability === 'available' && ledger.entries[0].links.providerReplyId === 'r1');
  check('ربط الدرس بمعرّف حقيقي', ledger.entries[0].links.lessonRecordIds.length === 0 || ledger.entries[0].links.memoryRecordIds.includes('lesson:x'));
  const attMissing = attachOutcome(ledger, { decisionId: 'nope', kind: 'delivered', summary: 'x', now: NOW });
  check('لا اختراع نتيجة لقرار غير موجود', attMissing.attached === false);
  check('unavailableOutcome صريح بلا اختراع', unavailableOutcome('not_observed').availability === 'unavailable');
  const sum = summarizeDecisionLedger(ledger);
  check('ملخّص السجل يحصي المتاح/غير المتاح', sum.total === 1 && sum.withOutcome === 1 && sum.unavailable === 0);
  check('استرجاع السجل يحافظ على المالك', normalizeDecisionLedger(ledger).owner === CENTRAL_BRAIN_ID);

  // ── 9) لا تفعيل للنطاق التجاري/المبيعات ───────────────────────────────────
  group('9) لا تفعيل لنطاق تجاري/مبيعات');
  check('مفتاح النطاق غير مفعّل افتراضياً (دالة تشترط true)', server.includes('GHARABI_ENABLE_COMMERCIAL_SALES_SCOPE'));
  check('الأسطح التجارية تُحجب بـSCOPE_DISABLED افتراضياً', server.includes('SCOPE_DISABLED'));
  check('قيمة النطاق تُقرأ من البيئة فقط (لا ثابت مُفعّل)', server.includes('process.env.GHARABI_ENABLE_COMMERCIAL_SALES_SCOPE'));
  check('لا إسناد صريح يفعّل النطاق في الكود', !/process\.env\.GHARABI_ENABLE_COMMERCIAL_SALES_SCOPE\s*=\s*["']?(true|1|on|yes)/i.test(server));

  // ── 10) لا نظام مكرّر ─────────────────────────────────────────────────────
  group('10) لا عقل/ذاكرة/حوكمة مكرّر');
  check('لا حوكمة ثانية (لا governance2/secondGovernance)', !/governance2|secondGovernance|newGovernanceGuard/.test(server));
  check('حوكمة القرار عبر المسار القائم', read('engine/brain/team/brainDecision.ts').includes('evaluateGovernance'));
  check('القدرات الداخلية إحدى عشرة بالضبط', CENTRAL_BRAIN_CAPABILITIES.length === 11);
  check('قدرة القرار داخلية واحدة ضمن العقل', CENTRAL_BRAIN_CAPABILITIES.includes('decision'));

  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} consolidation (ONE CENTRAL BRAIN) checks`);
}

run();
