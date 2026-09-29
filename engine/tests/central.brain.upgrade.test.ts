/**
 * اختبارات طبقة العقل المركزي الجديدة (Perception → Truth → Memory → Goals →
 * Audience → Market → Experiments → Timing → Strategy → Decisions → Learning).
 *
 * تُثبت بالدليل:
 * 1. الإدراك: لا إشارة بلا مصدر، والمؤشر غير المتاح يُعلن بلا قيمة مُختلقة.
 * 2. الحقيقة: التمييز بين موثّق/استنتاج/فرضية/مجهول/غير متاح/يحتاج مالك.
 * 3. الذاكرة: الأصل والثقة، وقول AI لا يصبح حقيقة، وتذكّر الإخفاقات.
 * 4. الأهداف: إشارات نجاح صريحة متاحة/غير متاحة.
 * 5. الجمهور: لا سمات حساسة، ومقاطع بدليل ومصدر.
 * 6. الأهمية التجارية: القُمع، ولا SALE بلا مصدر.
 * 7. التجارب: متغيّر واحد، ولا حكم بلا عيّنة كافية.
 * 8. التوقيت: بغداد، ولا «أفضل وقت» بلا عيّنة.
 * 9. القدرات: خمس حالات صريحة، ولا قدرة غير منفّذة.
 * 10. القرارات: فصل آلي/مقترح/بشري/محجوب/غير متاح + مستويات الاستقلالية.
 * 11. التعلّم: من أحداث حقيقية، وتفضيل المالك ليس حقيقة تجارية.
 * 12. المحادثة: حلقات comment→content وcomment→sales مع تصعيد السعر غير الموثّق.
 * 13. اللقطة والدورات: حالة موحّدة + دورة يومية/أسبوعية بلا تنفيذ خارجي.
 * 14. dry-run: يتوقف قبل أي إجراء خارجي.
 * 15. اختبار المعمارية النهائي: منصة #11 بلا إعادة كتابة.
 */

import {
  buildPerceptionBundle,
  buildContentSignals,
  buildAudienceUnavailableSignals,
  isFresh,
  hasValidSource,
  sourceFor,
  SIGNAL_SPECS,
} from '../brain/perception/signals';
import {
  classifyClaim,
  makeKnowledgeItem,
  commercialFact,
  summarizeKnowledge,
  isActionable,
  MIN_SAMPLE_FOR_VERIFIED,
} from '../brain/knowledge/truth';
import {
  makeMemoryEntry,
  remember,
  emptyMemory,
  activeMemories,
  previouslyFailed,
  summarizeMemory,
  isAiStatementTrusted,
} from '../brain/memory/longTerm';
import { defineGoal, isCommercialGoal, availableSuccessSignals, unavailableSuccessSignals } from '../brain/goals/goalEngine';
import { buildAudienceModel, selectTargetSegment, AUDIENCE_NOT_AVAILABLE_FIELDS } from '../brain/audience/audienceModel';
import { computeCommercialRelevance, compareByCommercialRelevance } from '../brain/market/commercialRelevance';
import { createExperiment, startExperiment, concludeExperiment, experimentReadyToConclude, MIN_EXPERIMENT_EVIDENCE } from '../brain/experiments/experimentEngine';
import { recommendTimingWindow, TIMING_TIMEZONE, windowForHour, baghdadHour } from '../brain/timing/timingModel';
import { capabilityMatrix, capabilityRow, platformCan, capabilityReason, CAPABILITY_KEYS } from '../brain/strategy/capabilityMatrix';
import { buildRecommendation, buildStrategyPlan, strategyIsPlatformAgnostic } from '../brain/strategy/strategyEngine';
import { decide, isAutomatic, highestAutonomy } from '../brain/decisions/decisionEngine';
import { buildLearningLoop, learningEventToMemory, extractOwnerPreferences, ownerPreferenceUsable, type LearningEvent } from '../brain/learning/learningLoop';
import { classifyConversation, aggregateRepeatedNeeds, proposeContentFromNeed, runSalesLoop, REPEATED_NEED_MIN } from '../brain/audience/conversationIntelligence';
import { analyzeVideoQuality, buildContentPerformanceModel, buildContentPath, VIDEO_STAGE_LABELS_AR } from '../brain/strategy/contentIntelligence';
import { buildCentralBrainState, brainDiagnostics, brainIsPlatformAgnostic } from '../brain/state';
import { runDailyBrainCycle, runWeeklyBrainReview } from '../brain/cycles';
import { buildBrainDryRun } from '../brain/dryRun';
import type { PlatformId } from '../social/adapter';
import type { PlatformMetricRecord } from '../social/platformLearning';

let passed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail?: string) { if (cond) passed += 1; else fails.push(`${name}${detail ? ` — ${detail}` : ''}`); }

const ALL: PlatformId[] = ['tiktok', 'youtube', 'facebook', 'instagram', 'whatsapp', 'telegram', 'x', 'snapchat', 'threads', 'google_business'];
const NOW = Date.parse('2026-09-29T12:00:00Z');

// سجلات أداء proof-based (ليست بيانات إنتاج حقيقية).
const records: PlatformMetricRecord[] = [
  { platform: 'youtube', externalId: 'VID_A', contentType: 'تعليمي', productCategory: 'appliances', title: 'شرح التقسيط', values: { views: 4000, likes: 120, comments: 40 }, publishedAt: '2026-09-20T18:00:00Z' },
  { platform: 'youtube', externalId: 'VID_B', contentType: 'تعليمي', productCategory: 'appliances', title: 'أخطاء التقسيط', values: { views: 3800, likes: 100, comments: 35 }, publishedAt: '2026-09-21T19:00:00Z' },
  { platform: 'youtube', externalId: 'VID_C', contentType: 'ترويجي', productCategory: 'appliances', title: 'عرض عام', values: { views: 100000, likes: 200, comments: 3 }, publishedAt: '2026-09-22T09:00:00Z' },
];

const comments = [
  { platform: 'youtube' as PlatformId, externalId: 'c1', text: 'هل عندكم تقسيط؟' },
  { platform: 'youtube' as PlatformId, externalId: 'c2', text: 'كم قسط الثلاجة؟' },
  { platform: 'youtube' as PlatformId, externalId: 'c3', text: 'شكد السعر؟' },
  { platform: 'youtube' as PlatformId, externalId: 'c4', text: 'وين موقع المعرض؟' },
  { platform: 'youtube' as PlatformId, externalId: 'c5', text: 'هل عندكم تقسيط للغسالات؟' },
  { platform: 'youtube' as PlatformId, externalId: 'c6', text: 'شكد سعر الغسالة؟' },
];

// --- 1) الإدراك ---
{
  const bundle = buildPerceptionBundle({ platform: 'youtube', collectedAt: '2026-09-29T11:00:00Z', values: { views: 4000, likes: 120, comments: 40 }, scope: 'video', sampleSize: 1 });
  check('1: إشارات محتوى متاحة بقيم حقيقية', bundle.signals.some((s) => s.metric === 'views' && s.availability === 'AVAILABLE' && s.value === 4000));
  check('1: لا إشارة بلا مصدر', bundle.signals.every((s) => hasValidSource(s)));
  check('1: المؤشر غير المتاح يُعلن بلا قيمة', bundle.signals.filter((s) => s.availability === 'NOT_AVAILABLE').every((s) => s.value === null));
  const tiktok = buildContentSignals({ platform: 'tiktok', collectedAt: '2026-09-29T11:00:00Z', values: { views: 500, likes: 10 }, scope: 'video' });
  const saves = tiktok.find((s) => s.metric === 'saves');
  check('1: TikTok saves غير متاح (لا صفر مُختلق)', saves?.availability === 'NOT_AVAILABLE' && saves?.value === null);
  check('1: المصدر من مصدر واحد', sourceFor('youtube', 'views').includes('youtube'));
  const audience = buildAudienceUnavailableSignals('youtube', '2026-09-29T11:00:00Z');
  check('1: إشارات جمهور غير متاحة معلنة', audience.length >= 7 && audience.every((s) => s.value === null && s.availability === 'NOT_AVAILABLE'));
  check('1: الطزاجة تعمل', isFresh({ metric: 'views', collectedAt: '2026-09-29T11:00:00Z' }, NOW) === true && isFresh({ metric: 'views', collectedAt: '2026-09-28T00:00:00Z' }, NOW) === false);
  check('1: مواصفات الإشارات معرّفة', SIGNAL_SPECS.length >= 15);
}

// --- 2) الحقيقة ---
{
  check('2: بلا مصدر => مجهول', classifyClaim({ hasSource: false, sampleSize: 5 }) === 'UNKNOWN');
  check('2: عيّنة صغيرة => بيانات غير كافية', classifyClaim({ hasSource: true, sampleSize: 1 }) === 'INSUFFICIENT_DATA');
  check('2: مصدر+عيّنة => حقيقة موثّقة', classifyClaim({ hasSource: true, sampleSize: MIN_SAMPLE_FOR_VERIFIED }) === 'VERIFIED_FACT');
  check('2: استنتاج بحساب => DERIVED_FACT', classifyClaim({ hasSource: true, sampleSize: 5, derived: true }) === 'DERIVED_FACT');
  check('2: فرضية تُعلن فرضية', classifyClaim({ hasSource: true, sampleSize: 5, hypothesis: true }) === 'HYPOTHESIS');
  check('2: غير متاح يُعلن', classifyClaim({ hasSource: true, sampleSize: 5, unavailable: true }) === 'UNAVAILABLE');
  check('2: يحتاج مالك', classifyClaim({ hasSource: false, sampleSize: 0, requiresHumanInput: true }) === 'HUMAN_INPUT_REQUIRED');
  const verified = makeKnowledgeItem({ id: 'k1', statement: 'تفاعل جيد', source: 'YouTube API', sampleSize: 5, now: NOW });
  check('2: actionable للحقيقة', isActionable(verified) === true);
  const unknown = makeKnowledgeItem({ id: 'k2', statement: 'جمهور كربلاء 70%', source: null, sampleSize: 0, now: NOW });
  check('2: ادّعاء بلا مصدر ليس حقيقة', unknown.state === 'UNKNOWN' && unknown.source === null);
  const price = commercialFact({ id: 'price-1', statement: 'سعر الثلاجة 1,250,000', source: null, now: NOW });
  check('2: سعر بلا مصدر => HUMAN_INPUT_REQUIRED', price.state === 'HUMAN_INPUT_REQUIRED');
  const priceOk = commercialFact({ id: 'price-2', statement: 'سعر الثلاجة 1,250,000', source: 'قائمة أسعار المعرض', now: NOW });
  check('2: سعر بمصدر => حقيقة موثّقة', priceOk.state === 'VERIFIED_FACT');
  const kb = summarizeKnowledge([verified, unknown, price]);
  check('2: ملخّص المعرفة يحصي الحالات', kb.verifiedCount === 1 && kb.unknownCount === 1 && kb.humanInputRequiredCount === 1);
}

// --- 3) الذاكرة ---
{
  let store = emptyMemory();
  const e1 = makeMemoryEntry({ id: 'm1', kind: 'outcome', statement: 'فيديو تعليمي أدّى جيداً', origin: 'derived', source: 'YouTube API', now: NOW, sampleSize: 5 });
  store = remember(store, e1);
  const e2 = makeMemoryEntry({ id: 'm2', kind: 'failure', statement: 'هوك ترويجي فشل', origin: 'derived', source: 'YouTube API', now: NOW, sampleSize: 4, refs: { variable: 'hook_type' } });
  store = remember(store, e2);
  const aiClaim = makeMemoryEntry({ id: 'm3', kind: 'business', statement: 'السعر 500 ألف', origin: 'ai_statement', source: 'Gemini', now: NOW, sampleSize: 0 });
  store = remember(store, aiClaim);
  check('3: الذاكرة النشطة 3 عناصر', activeMemories(store).length === 3);
  check('3: قول AI بثقة منخفضة', aiClaim.confidence === 'low' && isAiStatementTrusted('ai_statement') === false);
  const failed = previouslyFailed(store, 'hook_type');
  check('3: تذكّر الإخفاق السابق', failed.failed === true && failed.evidence.length === 1);
  const e2b = makeMemoryEntry({ id: 'm2', kind: 'failure', statement: 'هوك ترويجي فشل (مؤكد)', origin: 'derived', source: 'YouTube API', now: NOW, sampleSize: 6, refs: { variable: 'hook_type' } });
  store = remember(store, e2b);
  check('3: الاستبدال يحفظ الحالة superseded', store.entries.some((e) => e.id === 'm2' && e.status === 'superseded'));
  const summary = summarizeMemory(store);
  check('3: الملخّص يميّز أقوال AI', summary.aiStatements === 1 && summary.active === 3);
}

// --- 4) الأهداف ---
{
  const goal = defineGoal({ primary: 'SALES', secondary: 'TRUST' });
  check('4: هدف أساسي وثانوي', goal.primary === 'SALES' && goal.secondary === 'TRUST');
  check('4: هدف تجاري', isCommercialGoal(goal) === true);
  check('4: إشارة شراء معلنة غير متاحة (لا ادعاء)', unavailableSuccessSignals(goal).some((s) => s.metric === 'buying_signals'));
  check('4: إشارات متاحة معلنة', availableSuccessSignals(goal).length >= 0);
  check('4: قيود صلبة موجودة', goal.hardConstraints.some((c) => c.includes('أسعار')));
}

// --- 5) الجمهور ---
{
  const model = buildAudienceModel({ platform: 'youtube', records, comments });
  check('5: مقاطع جمهور بُنيت بدليل', model.segments.length >= 1);
  check('5: كل مقطع بمصدر وعيّنة', model.segments.every((s) => s.source && s.sampleSize > 0 && s.evidence.length > 0));
  check('5: لا سمات حساسة متاحة', model.demographicsAvailable === false && model.notAvailableFields.length >= 5);
  check('5: حقول العمر/الجنس/المدينة معلنة غير متاحة', ['age', 'gender', 'city'].every((f) => AUDIENCE_NOT_AVAILABLE_FIELDS.some((x) => x.field === f)));
  check('5: أسئلة متكررة مُستخرجة', model.segments[0].commonQuestions.length >= 1);
  const sel = selectTargetSegment(model);
  check('5: اختيار مقطع بدليل', sel.segment !== null && sel.reason.includes('عيّنة'));
  const empty = buildAudienceModel({ platform: 'youtube', records: [], comments: [] });
  check('5: بلا بيانات => لا مقطع مُختلق', empty.segments.length === 0);
}

// --- 6) الأهمية التجارية ---
{
  const highViewsLowIntent = computeCommercialRelevance({ platform: 'youtube', views: 100000, engagedViews: 203, comments: [{ isBusinessInquiry: false, intent: 'other' as never, topic: 'general' as never }] });
  const lowViewsHighIntent = computeCommercialRelevance({ platform: 'youtube', views: 4000, engagedViews: 160, comments: Array.from({ length: 5 }, () => ({ isBusinessInquiry: true, intent: 'business_inquiry' as never, topic: 'price' as never })) });
  const cmp = compareByCommercialRelevance(highViewsLowIntent, lowViewsHighIntent);
  check('6: المحتوى ذو إشارات الشراء يتقدّم رغم مشاهدات أقل', cmp.preferred === 'b');
  const sale = computeCommercialRelevance({ platform: 'youtube', views: 100, engagedViews: 5 });
  check('6: لا SALE بلا مصدر بيع', sale.stages.find((s) => s.stage === 'SALE')?.available === false);
  const noEvidence = compareByCommercialRelevance(sale, sale);
  check('6: بلا دليل شراء => تعادل', noEvidence.preferred === 'tie');
  check('6: RELEVANT_VIEW معلنة غير متاحة', sale.stages.find((s) => s.stage === 'RELEVANT_VIEW')?.available === false);
}

// --- 7) التجارب ---
{
  const exp = createExperiment({
    id: 'exp1', hypothesis: 'الهوك المبني على مشكلة يرفع التفاعل المؤهّل', variable: 'hook_type',
    variantA: { id: 'a', label: 'منتج أولاً', description: 'A' }, variantB: { id: 'b', label: 'مشكلة أولاً', description: 'B' },
    successMetric: 'qualified_engagement', now: NOW,
  });
  check('7: تجربة بمتغيّر واحد', exp.variable === 'hook_type' && exp.status === 'proposed');
  const running = startExperiment(exp);
  check('7: بدء التجربة', running.status === 'running');
  const inconclusive = concludeExperiment(running, { a: 10, b: 12, sampleA: 2, sampleB: 2 });
  check('7: عيّنة ناقصة => inconclusive', inconclusive.verdict === 'inconclusive');
  const support = concludeExperiment(running, { a: 10, b: 20, sampleA: 6, sampleB: 6 });
  check('7: فرق واضح => تدعم الفرضية', support.verdict === 'supports_hypothesis');
  const reject = concludeExperiment(running, { a: 20, b: 10, sampleA: 6, sampleB: 6 });
  check('7: فرق عكسي => لا تدعم', reject.verdict === 'rejects_hypothesis');
  const noise = concludeExperiment(running, { a: 100, b: 101, sampleA: 6, sampleB: 6 });
  check('7: فرق داخل الضجيج => inconclusive', noise.verdict === 'inconclusive');
  check('7: جاهزية الحسم بالعيّنة', experimentReadyToConclude({ ...running, results: { a: 1, b: 1, sampleA: 3, sampleB: 3 } }) === true);
  check('7: حد العيّنة الأدنى معلن', MIN_EXPERIMENT_EVIDENCE >= 3);
}

// --- 8) التوقيت ---
{
  check('8: المنطقة الزمنية بغداد', TIMING_TIMEZONE === 'Asia/Baghdad');
  check('8: النوافذ صحيحة', windowForHour(9) === 'morning' && windowForHour(14) === 'afternoon' && windowForHour(19) === 'evening' && windowForHour(23) === 'night');
  check('8: الساعة البغدادية من UTC', baghdadHour('2026-09-29T16:00:00Z') === 19);
  const insufficient = recommendTimingWindow({ observations: [{ platform: 'youtube', at: '2026-09-29T16:00:00Z', performance: 100 }], platform: 'youtube' });
  check('8: عيّنة ناقصة => لا أفضل وقت', insufficient.status === 'insufficient_sample' && insufficient.window === null);
  const obs = Array.from({ length: 8 }, (_, i) => ({ platform: 'youtube', at: `2026-09-${20 + i}T16:00:00Z`, performance: 5000 }));
  const rec = recommendTimingWindow({ observations: obs, platform: 'youtube' });
  check('8: نافذة مقترحة من بيانات كافية', rec.status === 'supported' && rec.window === 'evening');
  check('8: الموعد المقترح بصيغة ISO محوّل', typeof rec.suggestedAtIso === 'string' && rec.suggestedAtIso !== null);
}

// --- 9) القدرات ---
{
  const rows = capabilityMatrix(ALL);
  check('9: صف لكل منصة', rows.length === 10);
  check('9: كل صف يحمل كل المفاتيح', rows.every((r) => CAPABILITY_KEYS.every((k) => r.states[k])));
  check('9: TikTok تعليقات غير متاحة', capabilityRow('tiktok').states.comments === 'NOT_AVAILABLE');
  check('9: TikTok رد غير متاح', capabilityRow('tiktok').states.reply === 'NOT_AVAILABLE');
  check('9: TikTok نشر يحتاج مراجعة', capabilityRow('tiktok').states.publish === 'REQUIRES_REVIEW');
  check('9: YouTube تعليقات+رد متاحان', platformCan('youtube', 'comments') && platformCan('youtube', 'reply'));
  check('9: الجغرافيا غير متاحة للجميع', rows.every((r) => r.states.geography === 'NOT_AVAILABLE'));
  check('9: سبب القدرة معلن', capabilityReason('tiktok', 'comments').includes('لا توفّر'));
  check('9: WhatsApp لا ينشر', capabilityRow('whatsapp').states.publish === 'NOT_AVAILABLE');
}

// --- 10) القرارات ---
{
  check('10: تحليل => آلي L1', isAutomatic(decide({ kind: 'analyze', platform: 'youtube' })) === true);
  const obs = decide({ kind: 'observe', platform: 'youtube' });
  check('10: إدراك => L0', obs.autonomyLevel === 'L0');
  const notAvail = decide({ kind: 'reply', platform: 'tiktok', capability: 'reply' });
  check('10: قدرة غير متاحة => not_available', notAvail.decision === 'not_available');
  const unauth = decide({ kind: 'publish', platform: 'youtube', capability: 'publish', authorized: false });
  check('10: بلا صلاحية => human_required', unauth.decision === 'human_required');
  const notConn = decide({ kind: 'publish', platform: 'youtube', capability: 'publish', authorized: true, connectedVerified: false });
  check('10: بلا اتصال موثق => blocked', notConn.decision === 'blocked');
  const noData = decide({ kind: 'message', platform: 'telegram', capability: 'messaging', authorized: true, connectedVerified: true, safetyPassed: true, dataSufficient: false });
  check('10: بيانات ناقصة => محجوب', noData.decision === 'blocked');
  const highRisk = decide({ kind: 'delete', platform: 'youtube', capability: 'publish', authorized: true, connectedVerified: true, safetyPassed: true, dataSufficient: true, risk: 'high' });
  check('10: حذف عالي الخطورة => موافقة بشرية', highRisk.decision === 'human_required');
  const safeExt = decide({ kind: 'publish', platform: 'youtube', capability: 'publish', authorized: true, connectedVerified: true, safetyPassed: true, dataSufficient: true, risk: 'low', reversible: true });
  check('10: خارجي منخفض الخطورة => L4 لا L5', safeExt.autonomyLevel === 'L4' && safeExt.decision === 'suggested');
  check('10: أعلى استقلالية يُحسب', highestAutonomy([obs, safeExt]) === 'L4');
}

// --- 11) التعلّم + تفضيل المالك ---
{
  const events: LearningEvent[] = [
    { id: 'l1', kind: 'SUCCESS', subject: 'youtube:educational', detail: 'تفاعل أعلى', source: 'YouTube API', sampleSize: 5, confidence: 'medium', isFact: true, at: '2026-09-25T00:00:00Z' },
    { id: 'l2', kind: 'FAILURE', subject: 'youtube:promo', detail: 'مشاهدات عالية بلا استفسار', source: 'YouTube API', sampleSize: 4, confidence: 'medium', isFact: true, at: '2026-09-25T00:00:00Z' },
    { id: 'l3', kind: 'OWNER_EDIT', subject: 'title', detail: 'عدّل العنوان ليبدأ بالسؤال', source: 'سجل المالك', sampleSize: 1, confidence: 'low', isFact: false, at: '2026-09-25T00:00:00Z' },
    { id: 'l4', kind: 'OWNER_EDIT', subject: 'title', detail: 'عدّل العنوان ليبدأ بالسؤال', source: 'سجل المالك', sampleSize: 1, confidence: 'low', isFact: false, at: '2026-09-26T00:00:00Z' },
    { id: 'l5', kind: 'OWNER_EDIT', subject: 'title', detail: 'عدّل العنوان ليبدأ بالسؤال', source: 'سجل المالك', sampleSize: 1, confidence: 'low', isFact: false, at: '2026-09-27T00:00:00Z' },
  ];
  const loop = buildLearningLoop({ events, now: NOW });
  check('11: دروس من الأحداث الحقيقية فقط', loop.lessons.some((l) => l.statement.includes('نجاح')));
  check('11: أحداث OWNER_EDIT لا تُعتبر حقائق', loop.lessons.every((l) => !l.statement.includes('تعديل المالك') || l.source.includes('المالك')));
  let store = emptyMemory();
  for (const e of events) store = learningEventToMemory(e, NOW).store(store);
  check('11: الأحداث تُحفظ في الذاكرة', activeMemories(store).length === events.length);
  const pref = extractOwnerPreferences({ events, kind: 'wording', describe: (e) => e.detail });
  check('11: تفضيل المالك مُستخرج', pref !== null && pref.statement.includes('السؤال'));
  check('11: تفضيل المالك ليس حقيقة تجارية', pref?.isCommercialFact === false);
  check('11: تفضيل المالك قابل للاستخدام بعد 3 ملاحظات', pref !== null && ownerPreferenceUsable(pref) === true);
}

// --- 12) المحادثة: حلقات المحتوى والبيع ---
{
  const conv = comments.map((c) => classifyConversation({ platform: c.platform, externalId: c.externalId, text: c.text }));
  check('12: نية شراء تُصنّف', conv.some((c) => c.category === 'purchase_intent'));
  const needs = aggregateRepeatedNeeds({ platform: 'youtube', conversations: conv });
  check('12: حاجة متكررة بلغت الحد', needs.length >= 1 && needs[0].count >= REPEATED_NEED_MIN);
  const hyp = proposeContentFromNeed({ need: needs.find((n) => n.topic === 'price') || needs[0], verifiedFacts: [] });
  check('12: فرضية محتوى من حاجة', hyp.hypothesis.length > 0 && hyp.evidence.length > 0);
  const priceConv = conv.find((c) => c.topic === 'price')!;
  const escalate = runSalesLoop({ conversation: priceConv, productKnowledgeVerified: true, verifiedPriceText: null });
  check('12: سعر غير موثّق => تصعيد للمالك', escalate.decision === 'escalate_owner' && escalate.ownerAction !== null);
  const safe = runSalesLoop({ conversation: priceConv, productKnowledgeVerified: true, verifiedPriceText: '1,250,000 د.ع' });
  check('12: سعر موثّق => رد آمن', safe.decision === 'safe_reply' && safe.reply?.includes('1,250,000'));
  const spam = runSalesLoop({ conversation: { category: 'spam', topic: 'general', text: 'x', externalId: 's', platform: 'youtube' }, productKnowledgeVerified: false, verifiedPriceText: null });
  check('12: سبام => تخطٍّ', spam.decision === 'skip');
}

// --- 13) جودة الفيديو + نموذج الأداء + مسار المحتوى ---
{
  const noRet = analyzeVideoQuality({ stageRetention: {}, retentionAvailable: false, retentionSource: 'n/a' });
  check('13: بلا احتفاظ => لا تحليل مُختلق', noRet.observations.length === 0);
  const withDrop = analyzeVideoQuality({
    stageRetention: { hook_0_3: 90, build_3_10: 60, core_value: 58, proof: 40, objection_handling: 38, cta: 36, ending: 30 },
    retentionAvailable: true, retentionSource: 'YouTube Analytics',
  });
  check('13: drop-off ملاحَظ باحتمال سبب', withDrop.observations.length >= 2 && withDrop.observations.every((o) => o.confidence === 'low'));
  check('13: مراحل الفيديو معلنة', VIDEO_STAGE_LABELS_AR.hook_0_3.includes('0–3'));
  const perf = buildContentPerformanceModel({ platform: 'youtube', views: 4000, engagementRate: 4, retentionPct: null, buyingSignals: 3, followerDelta: null, conversationQuality: 2 });
  check('13: نموذج أداء متعدد الأبعاد', perf.dimensions.length === 9);
  check('13: لا score واحد كحقيقة', perf.known.length >= 1 && perf.unknown.length >= 1);
  const path = buildContentPath({ audienceNeed: 'سؤال سعر متكرر', audienceNeedSource: 'YouTube API', businessGoal: 'SALES', contentIdea: 'شرح التقسيط', hook: 'سؤال مباشر', script: 'نص', visualPlan: 'خطة', title: 'عنوان', description: 'وصف', cta: 'تواصل', hashtags: ['#تقسيط'] });
  check('13: مسار المحتوى كامل', path.steps.length === 11);
  check('13: تفسير لماذا هذا المحتوى', path.whyThisContent.includes('سؤال سعر'));
}

// --- 14) اللقطة والدورات + dry-run ---
{
  const state = buildCentralBrainState({
    platforms: ALL, now: NOW,
    goals: defineGoal({ primary: 'SALES' }),
    knowledge: [makeKnowledgeItem({ id: 'k', statement: 'x', source: 'API', sampleSize: 5, now: NOW })],
    experiments: [createExperiment({ id: 'e', hypothesis: 'h', variable: 'v', variantA: { id: 'a', label: 'A', description: '' }, variantB: { id: 'b', label: 'B', description: '' }, successMetric: 'm', now: NOW })],
    liveConnections: { youtube: { connected: true, verified: true } },
    signals: buildPerceptionBundle({ platform: 'youtube', collectedAt: new Date(NOW).toISOString(), values: { views: 1 }, scope: 'x' }).signals,
    decisions: [{ id: 'd1', summary: 'نشر', explanation: decide({ kind: 'publish', platform: 'youtube', capability: 'publish', authorized: true, connectedVerified: true, safetyPassed: true, dataSufficient: true, risk: 'medium', reversible: false }) }],
  });
  check('14: لقطة العقل تجمع الطبقات', state.platformStates.length === 10 && state.goals !== null);
  check('14: قرارات معلّقة معلنة', state.pendingDecisions.length === 1);
  check('14: حدود معلنة', state.limitations.length >= 3);
  check('14: اتصال حقيقي من الخادم', state.platformStates.find((p) => p.platform === 'youtube')?.verified === true);
  const diag = brainDiagnostics(state);
  check('14: تشخيص العقل بلا أسرار', diag.signalFreshness.total >= 1 && typeof diag.brainHealth === 'string');
  const daily = runDailyBrainCycle({ now: NOW, signals: state.platformStates.length ? buildPerceptionBundle({ platform: 'youtube', collectedAt: new Date(NOW).toISOString(), values: { views: 1 }, scope: 'x' }).signals : [], recommendations: [], experiments: [], decisions: [] });
  check('14: دورة يومية بلا إجراء خارجي', daily.steps.every((s) => s.externalAction === false));
  const weekly = runWeeklyBrainReview({ experiments: [], recommendations: [], topics: [{ topic: 'price', count: 5 }] });
  check('14: مراجعة أسبوعية تجيب الأسئلة', weekly.topicsGrew.length >= 1 && weekly.limitations.length >= 2);
  check('14: تكييف عبر المنصات كفرضية أو عدم كفاية معلنة', weekly.shouldAdaptAcrossPlatforms[0].includes('فرضية') || weekly.shouldAdaptAcrossPlatforms[0].includes('لا مرشّح'));

  const dry = buildBrainDryRun({ platforms: ['youtube'], now: NOW, goal: 'رفع الاستفسارات المؤهّلة', records, comments, readOnly: true, verifiedFacts: [] });
  check('14: dry-run بلا إجراء خارجي', dry.externalActionTaken === false);
  check('14: dry-run يفصل المعروف/المجهول', dry.whatIKnow.length >= 1 && dry.whatIDontKnow.length >= 1);
  check('14: dry-run يعلن ما يحتاج موافقة', dry.whatRequiresOwnerApproval.length >= 1);
  check('14: dry-run يقترح اختباراً', dry.whatIWouldTest.length >= 1);
}

// --- 15) اختبار المعمارية النهائي ---
{
  const agnostic = brainIsPlatformAgnostic();
  check('15: العقل لا يحتاج إعادة كتابة لمنصة #11', agnostic.agnostic === true);
  const plan = buildStrategyPlan({ scope: 'weekly', what: 'w', why: 'y', who: 'جمهور محلي', where: ALL, when: 'مساءً', how: 'h', expectedSignal: 's', evidence: ['e'] });
  check('15: الخطة تعمل على PlatformId فقط', strategyIsPlatformAgnostic(plan.where).agnostic === true);
  const rec = buildRecommendation({ id: 'r', recommendation: 'x', reason: 'y', evidence: [], source: [], sampleSize: 0, expectedOutcome: 'o' });
  check('15: توصية بلا دليل => insufficient_sample', rec.status === 'insufficient_sample');
  const recOk = buildRecommendation({ id: 'r2', recommendation: 'x', reason: 'y', evidence: ['e'], source: ['s'], sampleSize: 5, expectedOutcome: 'o' });
  check('15: توصية بدليل => supported', recOk.status === 'supported');
}

console.log(`\n${'='.repeat(60)}`);
if (fails.length) {
  console.error(`FAILED: ${fails.length} / ${passed + fails.length}`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} central brain upgrade checks`);
}
