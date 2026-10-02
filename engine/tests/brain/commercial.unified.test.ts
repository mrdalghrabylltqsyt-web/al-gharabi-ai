/**
 * اختبار وحدة للعقل التجاري المركزي الموحّد (الدفعة 4) — منطق خالص.
 *
 * يغطّي: الغاية العليا وحرس المقاييس الوهمية، طبقة الحقيقة (طزاجة/تعارض/جودة بيانات)،
 * البحث وأصل المزوّد، التعلّم (بما فيه من الفشل)، تحليل التغيّر، التوقّع مقابل الواقع،
 * مكافحة خداع الذات، الاستراتيجية والأولويات والأهداف، ذكاء المنتجات والفرص، دورة
 * العميل، أولويات العملاء، تعلّم المتابعة، الحملة→البيع→الربح، الإسناد، التجارب،
 * الحكامة/التحسين الذاتي/السلامة الإنتاجية، الصحة/الإصدارات/القدرات، الذاكرة الموحّدة،
 * ودورة التشغيل. بلا شبكة وبلا أسرار وبلا AI.
 */

import assert from 'node:assert';

import { buildNorthStarReport, compareOutcomesCommercial, isVanityMetric, tierOfMetric, vanityRejectionReason, NORTH_STAR_STATEMENT } from '../../brain/commercial/northStar';
import { makeCommercialFact, classifyFreshness, resolveConflict, assessDataQuality, canUseForCommercialAnswer, summarizeCommercialTruth } from '../../brain/commercial/truth';
import { makeResearchItem, canUseResearch, externalCannotOverrideInternal, markExternalAiResponse, reconcileAiResponses, researchToLearning, summarizeResearch } from '../../brain/commercial/research';
import { runLearningCycle, analyzeFailure, analyzeChange, compareExpectationVsReality, assessImprovement, summarizeLearning } from '../../brain/commercial/learning';
import { buildCommercialRecommendation, prioritizeOpportunities, buildCommercialGoal, explainCommercialDecision, summarizeStrategy } from '../../brain/commercial/strategy';
import { classifyProductCommercial, buildProductOpportunities, summarizeProductIntel } from '../../brain/commercial/productIntel';
import { resolveLifecycle, prioritizeLead, learnFromFollowUps } from '../../brain/commercial/lifecycle';
import { buildCampaignCommercialReport, explainAttribution, judgeExperiment, summarizeCampaignLoop } from '../../brain/commercial/campaignLoop';
import { buildSelfImprovementProposal, declareAction, checkProductionSafety, evaluateChangePipeline, assertNoSilentAuthorityExpansion, defaultAutonomyTier, summarizeGovernance } from '../../brain/commercial/governance';
import { buildSystemHealth, buildCapabilityEvolution, buildBrainVersionHistory, latestBrainVersion, toLearningEnvelope, summarizeEventArchitecture } from '../../brain/commercial/health';
import { makeCommercialMemoryItem, rememberCommercial, emptyCommercialMemory, summarizeCommercialMemory, isTrustedOrigin } from '../../brain/commercial/commercialMemory';
import { advanceOperatingLoop, FINAL_COMMERCIAL_QUESTIONS, OPERATING_LOOP_ORDER } from '../../brain/commercial/operatingLoop';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const DAY = 86_400_000;

let passed = 0;
const check = (name: string, cond: boolean) => {
  assert.ok(cond, `FAIL: ${name}`);
  passed += 1;
};
const section = (_name: string) => { /* عنوان قسم */ };

// ---------------------------------------------------------------------------
// 1) الغاية العليا + حرس المقاييس الوهمية (§2, §39)
// ---------------------------------------------------------------------------
section('1) الغاية العليا وحرس المقاييس الوهمية');
{
  check('1-الترتيب: بيع أول، إيراد ثانٍ، ربح ثالث', tierOfMetric('verified_sales') === 'PRIMARY' && tierOfMetric('verified_revenue') === 'SECONDARY' && tierOfMetric('verified_profit') === 'TERTIARY');
  check('1-المشاهدات مقياس وهمي', isVanityMetric('views') && isVanityMetric('likes') && isVanityMetric('followers') && isVanityMetric('reach'));
  check('1-سبب رفض المقياس الوهمي صريح', vanityRejectionReason('views').includes('مقياس وهمي'));
  check('1-الغاية العليا معلنة', NORTH_STAR_STATEMENT.includes('المبيعات') && NORTH_STAR_STATEMENT.includes('الربح'));

  // فخ المقياس الوهمي: A مشاهدات عالية بلا بيع، B مشاهدات أقل بيع موثّق.
  const verdict = compareOutcomesCommercial({
    a: { label: 'حملة A', metric: 'views', value: 100000, qualifiedLeads: 0, verifiedSales: 0 },
    b: { label: 'حملة B', metric: 'views', value: 5000, qualifiedLeads: 20, verifiedSales: 3 },
    salesObjective: true,
  });
  check('1-الأعلى تجارياً = B (مبيعات)', verdict.commercialLeader === 'b');
  check('1-الأعلى وهمياً = A (مشاهدات)', verdict.vanityLeader === 'a');
  check('1-فخ المقياس الوهمي مُعلن', verdict.vanityTrap === true);

  const report1 = buildNorthStarReport({ verifiedSales: 3, verifiedRevenue: null, verifiedProfit: null, qualifiedDemand: 5, qualifiedLeads: 2, requests: 1 });
  check('1-البيع متاح والإيراد غير متاح', report1.primaryAvailable && !report1.secondaryAvailable);
  check('1-حرس الربح يُعلن عند غياب التكلفة', report1.profitGuard !== null && report1.profitGuard!.includes('UNKNOWN'));

  const noSales = buildNorthStarReport({ verifiedSales: null, verifiedRevenue: null, verifiedProfit: null, qualifiedDemand: null, qualifiedLeads: null, requests: null });
  check('1-لا بيع بلا معرّف ⇒ غير متاح لا صفر', noSales.objectives[0].value === null && !noSales.primaryAvailable);
}

// ---------------------------------------------------------------------------
// 2) طبقة الحقيقة: طزاجة/تعارض/جودة بيانات (§5, §6, §30, §40)
// ---------------------------------------------------------------------------
section('2) طبقة الحقيقة التجارية');
{
  const fresh = makeCommercialFact({ key: 'price', value: 500000, state: 'VERIFIED', source: 'workspace.products', observedAt: new Date(NOW - DAY).toISOString(), nowMs: NOW });
  check('2-حقيقة موثّقة حديثة', fresh.state === 'VERIFIED' && fresh.freshness === 'FRESH');
  check('2-الحقيقة الحديثة قابلة للاستخدام', canUseForCommercialAnswer(fresh).usable === true);

  const stale = makeCommercialFact({ key: 'price', value: 500000, state: 'VERIFIED', source: 'workspace.products', observedAt: new Date(NOW - 90 * DAY).toISOString(), nowMs: NOW });
  check('2-القيمة القديمة تُرقّى إلى STALE', stale.state === 'STALE' && stale.freshness === 'STALE');
  check('2-القيمة القديمة غير قابلة للاستخدام كحالية', canUseForCommercialAnswer(stale).usable === false);

  check('2-سياسة الطزاجة: FRESH/AGING/STALE', classifyFreshness(new Date(NOW - DAY).toISOString(), 'availability', NOW) === 'FRESH' && classifyFreshness(new Date(NOW - 20 * DAY).toISOString(), 'price', NOW) === 'AGING' && classifyFreshness(new Date(NOW - 120 * DAY).toISOString(), 'price', NOW) === 'STALE');

  // تعارض مصدرين موثوقين.
  const conflict = resolveConflict({ key: 'price', sourceA: { value: 500000, source: 'products', at: null }, sourceB: { value: 550000, source: 'installmentPlans', at: null }, nowMs: NOW });
  check('2-التعارض مُكتشف', conflict.conflicting === true && conflict.fact?.state === 'CONFLICTING');
  check('2-التعارض يحمل المصدرين', Boolean(conflict.fact?.conflict?.sourceA) && Boolean(conflict.fact?.conflict?.sourceB));
  const noConflict = resolveConflict({ key: 'price', sourceA: { value: 500000, source: 'a', at: null }, sourceB: { value: 500000, source: 'b', at: null }, nowMs: NOW });
  check('2-التطابق لا يُنتج تعارضاً', noConflict.conflicting === false);

  check('2-جودة بيانات منخفضة العيّنة ⇒ NOT_ENOUGH_EVIDENCE', assessDataQuality({ completeness: 0.9, consistency: 0.9, sourceTrust: 0.9, sampleSize: 1, freshness: 'FRESH' }).level === 'NOT_ENOUGH_EVIDENCE');
  check('2-جودة بيانات عالية', assessDataQuality({ completeness: 0.9, consistency: 0.9, sourceTrust: 0.9, sampleSize: 6, freshness: 'FRESH' }).level === 'HIGH');

  const truth = summarizeCommercialTruth([fresh, stale, conflict.fact!]);
  check('2-ملخّص الحقيقة يعدّ الحالات', truth.total === 3 && truth.stale === 1 && truth.conflicts === 1);
}

// ---------------------------------------------------------------------------
// 3) البحث + المزوّد الخارجي غير الموثوق (§21, §22, §23, §45)
// ---------------------------------------------------------------------------
section('3) البحث وأصل المزوّد');
{
  const item = makeResearchItem({ id: 'r1', topic: 'سوق', claim: 'الطلب على الغسالات يرتفع', source: 'تقرير سوق 2026', reference: 'https://example.com/report', collectedAt: new Date(NOW - 10 * DAY).toISOString(), nowMs: NOW });
  check('3-عنصر البحث يحمل مصدره وطزاجته', item.source === 'تقرير سوق 2026' && item.freshness === 'FRESH');
  check('3-البحث الطازج قابل للاستخدام كفرضية', canUseResearch(item).usable === true);

  const staleR = makeResearchItem({ id: 'r2', topic: 'سوق', claim: 'قديم', source: 'تقرير 2020', collectedAt: new Date(NOW - 400 * DAY).toISOString(), nowMs: NOW });
  check('3-البحث القديم غير قابل للاستخدام', canUseResearch(staleR).usable === false && staleR.freshness === 'STALE');

  const override = externalCannotOverrideInternal({ field: 'price', internal: { value: 500000, state: 'VERIFIED', source: 'workspace.products' }, externalClaim: 'السعر 300000' });
  check('3-الحقيقة الداخلية تبقى مرجعية', override.internalRemainsAuthoritative === true);

  const ai = markExternalAiResponse({ provider: 'external-ai', claim: 'السعر 300000', at: new Date(NOW).toISOString() });
  check('3-استجابة AI خارجي غير موثوقة دائماً', ai.trust === 'UNTRUSTED_INPUT');
  const recon = reconcileAiResponses([ai, markExternalAiResponse({ provider: 'other-ai', claim: 'السعر 400000', at: new Date(NOW).toISOString() })]);
  check('3-اختلاف المزوّدين يُعلن ولا يُعتمد', recon.agreeing === false && recon.trust === 'UNTRUSTED_INPUT');

  const toLearn = researchToLearning(item);
  check('3-البحث → فرضية لا استراتيجية', toLearn.stage === 'HYPOTHESIS' && toLearn.canBecomeStrategy === false && toLearn.internalTestRequired === true);
  check('3-ملخّص البحث يعدّ', summarizeResearch([item, staleR]).total === 2 && summarizeResearch([item, staleR]).stale === 1);
}

// ---------------------------------------------------------------------------
// 4) التعلّم + الفشل + التغيّر + التوقّع + مكافحة خداع الذات (§16,§17,§18,§37,§41)
// ---------------------------------------------------------------------------
section('4) التعلّم والتحليل');
{
  const supported = runLearningCycle({ id: 'l1', hypothesis: 'عرض التقسيط يرفع التحويل', action: 'اختبرنا العرض', result: 'ارتفع التحويل', comparison: 'قبل/بعد', source: 'verified_sale', evidence: ['e1', 'e2'], sampleSize: 6, measuredValue: 8, baselineValue: 5, nowMs: NOW });
  check('4-تعلّم مؤيّد بعيّنة كافية', supported.verdict === 'SUPPORTED' && supported.truthState === 'DERIVED');
  const insufficient = runLearningCycle({ id: 'l2', hypothesis: 'x', action: 'y', result: 'z', comparison: 'w', source: 'conversion', evidence: [], sampleSize: 1, nowMs: NOW });
  check('4-عيّنة صغيرة ⇒ INSUFFICIENT_DATA لا تعلّم مؤكّد', insufficient.verdict === 'INSUFFICIENT_DATA');

  const failure = analyzeFailure({ kind: 'failed_campaign', whatHappened: 'حملة بلا مبيعات', evidence: ['no sales'], sampleSize: 1 });
  check('4-فشل بلا دليل ⇒ why=null', failure.why === null);
  check('4-فشل لا يُعمَّم كقاعدة', failure.isUniversalRule === false);
  check('4-الفشل يحمل أسباباً بديلة واختباراً', failure.alternativeExplanations.length > 0 && failure.nextTest.length > 0);

  const change = analyzeChange({ subject: 'المبيعات', current: 10, previous: 5, sampleSize: 6, evidence: ['e'] });
  check('4-تحليل التغيّر: ارتفع', change.direction === 'INCREASED' && change.deltaPct === 100);
  const unknownChange = analyzeChange({ subject: 'المبيعات', current: 10, previous: null });
  check('4-تغيّر بلا طرفين ⇒ UNKNOWN', unknownChange.direction === 'UNKNOWN' && unknownChange.conclusion === null);

  const exp = compareExpectationVsReality({ subject: 'c1', expected: 5, actual: 3 });
  check('4-توقّع مقابل واقع: مبالغة', exp.verdict === 'OVER_ESTIMATION');
  const expOk = compareExpectationVsReality({ subject: 'c2', expected: 10, actual: 11 });
  check('4-داخل ±20% ⇒ توقّع صحيح', expOk.verdict === 'CORRECT_PREDICTION');
  const expNone = compareExpectationVsReality({ subject: 'c3', expected: null, actual: 3 });
  check('4-بلا طرفين ⇒ غير حاسم', expNone.verdict === 'INCONCLUSIVE');

  const notProven = assessImprovement({ subject: 'x', previousVerified: 3, newVerified: 6, sampleSize: 2, periodDays: 2 });
  check('4-لا ادّعاء تحسّن بلا عيّنة/مدّة', notProven.verdict === 'IMPROVEMENT_NOT_PROVEN' && notProven.canClaimImproved === false);
  const proven = assessImprovement({ subject: 'x', previousVerified: 3, newVerified: 6, sampleSize: 10, periodDays: 14 });
  check('4-تحسّن مُثبت بقيَم موثّقة', proven.verdict === 'IMPROVEMENT_PROVEN' && proven.canClaimImproved === true);
  const reg = assessImprovement({ subject: 'x', previousVerified: 6, newVerified: 3, sampleSize: 10, periodDays: 14 });
  check('4-التراجع يُعلن', reg.verdict === 'REGRESSION');

  check('4-ملخّص التعلّم', summarizeLearning([supported, insufficient]).total === 2);
}

// ---------------------------------------------------------------------------
// 5) الاستراتيجية والأولويات والأهداف وشرح القرار (§19, §20, §36, §38)
// ---------------------------------------------------------------------------
section('5) الاستراتيجية والأولويات');
{
  const ok = buildCommercialRecommendation({ id: 'rec1', action: 'جرّب عرض تقسيط', why: 'أسئلة تقسيط متكرّرة', evidence: ['5 أسئلة'], expectedBenefit: 'رفع التحويل', sampleSize: 5 });
  check('5-توصية بموضوعية بيعية مقبولة', ok.ok === true);
  const noWhy = buildCommercialRecommendation({ id: 'rec2', action: 'x', why: '', evidence: ['e'], expectedBenefit: 'y', sampleSize: 3 });
  check('5-لا توصية بلا سبب', noWhy.ok === false && (noWhy as any).code === 'NO_WHY');
  const vanity = buildCommercialRecommendation({ id: 'rec3', action: 'x', why: 'y', evidence: ['e'], expectedBenefit: 'z', sampleSize: 3, objectiveMetric: 'views' });
  check('5-لا توصية بهدف وهمي', vanity.ok === false && (vanity as any).code === 'VANITY_OBJECTIVE');

  const ranked = prioritizeOpportunities([
    { id: 'a', title: 'أ', expectedImpact: 'high', evidenceStrength: 'strong', confidence: 'high', urgency: 'high', cost: 'low', difficulty: 'low', risk: 'low', sampleSize: 10 },
    { id: 'b', title: 'ب', expectedImpact: 'low', evidenceStrength: 'weak', confidence: 'low', urgency: 'low', cost: 'high', difficulty: 'high', risk: 'high', sampleSize: 2 },
  ]);
  check('5-الفرصة الأعلى أثراً تتصدّر', ranked[0].id === 'a' && ranked[0].rank === 1);
  check('5-لكل فرصة تفسير مرتّب', ranked[0].rationale.length > 0);
  check('5-ملخّص الاستراتيجية', summarizeStrategy(ranked).topId === 'a');

  const goal = buildCommercialGoal({ id: 'g1', kind: 'increase_verified_sales', target: 10, timePeriod: 'شهر', currentVerified: 4, nowMs: NOW });
  check('5-هدف بخط أساس ⇒ تقدّم محسوب', goal.progressPct === 40);
  const goalNoBase = buildCommercialGoal({ id: 'g2', kind: 'increase_verified_sales', target: 10, timePeriod: 'شهر', currentVerified: null, nowMs: NOW });
  check('5-لا خط أساس ⇒ لا تقدّم مُعلن', goalNoBase.progressPct === null && goalNoBase.nextAction.includes('خط الأساس'));

  const exp = explainCommercialDecision({ decision: 'ركز على X', whyThis: 'طلب مرتفع', whyNow: 'عيّنة كافية', evidence: ['e1', 'e2'], sampleSize: 5 });
  check('5-شرح القرار من أدلة مخزّنة', exp.generatedFrom === 'stored_evidence' && exp.basedOn.length === 2 && exp.confidence === 'high');
}

// ---------------------------------------------------------------------------
// 6) ذكاء المنتجات + الفرص (§7, §8, §24)
// ---------------------------------------------------------------------------
section('6) ذكاء المنتجات والفرص');
{
  const insufficient = classifyProductCommercial({ productId: 'p0', productName: 'منتج', priceVerified: true, availabilityVerified: true, installmentAvailable: false, demandSignals: 1, purchaseSignals: 0, qualifiedLeads: 0, requests: 0, verifiedSales: 0, revenue: null, profit: null, campaignCount: 0, priceObjections: 0, installmentQuestions: 0, availabilityRequests: 0, specificationRequests: 0, demandFirstHalf: null, demandSecondHalf: null, lostCount: 0, evidenceSource: 'test', sampleSize: 1 });
  check('6-بيانات غير كافية ⇒ DATA_INSUFFICIENT', insufficient.status === 'DATA_INSUFFICIENT');

  const highInterestLowSales = classifyProductCommercial({ productId: 'p1', productName: 'غسالة', priceVerified: true, availabilityVerified: true, installmentAvailable: true, demandSignals: 8, purchaseSignals: 4, qualifiedLeads: 3, requests: 1, verifiedSales: 0, revenue: null, profit: null, campaignCount: 1, priceObjections: 4, installmentQuestions: 5, availabilityRequests: 0, specificationRequests: 0, demandFirstHalf: 4, demandSecondHalf: 4, lostCount: 1, evidenceSource: 'test', sampleSize: 12 });
  check('6-اهتمام مرتفع/مبيعات منخفضة', highInterestLowSales.status === 'HIGH_INTEREST_LOW_SALES');
  const opps = buildProductOpportunities({ intel: highInterestLowSales, timePeriod: '30 يوماً' });
  check('6-فرصة تحويل ضعيف مولّدة', opps.some((o) => o.kind === 'high_demand_weak_conversion'));
  check('6-فرصة اعتراضات سعرية مولّدة', opps.some((o) => o.kind === 'repeated_price_objections'));
  check('6-فرصة أسئلة تقسيط مولّدة', opps.some((o) => o.kind === 'repeated_installment_questions'));
  const o = opps[0];
  check('6-كل فرصة تحمل عناصرها الإلزامية', Boolean(o.evidence) && Boolean(o.source) && Boolean(o.timePeriod) && typeof o.sampleSize === 'number' && Boolean(o.confidence) && Boolean(o.expectedImpact) && Boolean(o.cost) && Boolean(o.risk) && Boolean(o.recommendedNextTest));

  const rising = classifyProductCommercial({ productId: 'p2', productName: 'ثلاجة', priceVerified: false, availabilityVerified: true, installmentAvailable: false, demandSignals: 6, purchaseSignals: 2, qualifiedLeads: 1, requests: 0, verifiedSales: 1, revenue: null, profit: null, campaignCount: 0, priceObjections: 0, installmentQuestions: 0, availabilityRequests: 0, specificationRequests: 0, demandFirstHalf: 2, demandSecondHalf: 6, lostCount: 0, evidenceSource: 'test', sampleSize: 9 });
  check('6-طلب صاعد مُكتشف', rising.status === 'RISING_DEMAND');
  check('6-منتج بلا سعر موثّق ⇒ فرصة عرض', buildProductOpportunities({ intel: rising, timePeriod: '30 يوماً' }).some((x) => x.kind === 'needs_better_presentation'));

  check('6-ملخّص ذكاء المنتجات', summarizeProductIntel([insufficient, highInterestLowSales, rising], opps).total === 3);
}

// ---------------------------------------------------------------------------
// 7) دورة العميل + أولويات العملاء + تعلّم المتابعة (§9, §10, §11)
// ---------------------------------------------------------------------------
section('7) دورة العميل والأولويات والمتابعة');
{
  const noSale = resolveLifecycle({ leadId: 'l1', stage: 'QUALIFIED_LEAD', verifiedSaleId: null, marketingConsent: true, optedOut: false, verifiedPurchaseCount: 0, purchasedProductIds: [], requestedProductId: null });
  check('7-لا بيع ⇒ ليس CUSTOMER', noSale.stage === 'LEAD');
  const sale = resolveLifecycle({ leadId: 'l2', stage: 'REQUEST', verifiedSaleId: 's1', marketingConsent: false, optedOut: false, verifiedPurchaseCount: 1, purchasedProductIds: ['p1'], requestedProductId: null });
  check('7-بيع موثّق ⇒ VERIFIED_SALE', sale.stage === 'VERIFIED_SALE');
  const noConsent = resolveLifecycle({ leadId: 'l3', stage: 'REQUEST', verifiedSaleId: 's2', marketingConsent: false, optedOut: false, verifiedPurchaseCount: 2, purchasedProductIds: ['p1'], requestedProductId: null });
  check('7-لا فرصة تكرار بلا موافقة', noConsent.repeatOpportunity === false);
  const repeat = resolveLifecycle({ leadId: 'l4', stage: 'REQUEST', verifiedSaleId: 's3', marketingConsent: true, optedOut: false, verifiedPurchaseCount: 2, purchasedProductIds: ['p1'], requestedProductId: null });
  check('7-تكرار شراء بدليل + موافقة', repeat.repeatOpportunity === true && repeat.stage === 'REPEAT_OPPORTUNITY');
  const cross = resolveLifecycle({ leadId: 'l5', stage: 'REQUEST', verifiedSaleId: 's4', marketingConsent: true, optedOut: false, verifiedPurchaseCount: 1, purchasedProductIds: ['p1'], requestedProductId: 'p9' });
  check('7-بيع متقاطع بدليل + موافقة', cross.crossSellOpportunity === true);

  const p = prioritizeLead({ leadId: 'l1', purchaseIntent: true, productCertainty: true, requestCompleteness: 1, buyingTimeframe: 'immediate', availabilityKnown: true, priceInstallmentInterest: true, hasPriorInteraction: true, followUpCount: 1, unresolvedBlocker: false });
  check('7-عميل بنية فورية ⇒ أولوية عالية', p.priority === 'URGENT' || p.priority === 'HIGH');
  check('7-كل نقطة أولوية مفسّرة', p.breakdown.length > 0 && p.reason.includes('الدرجة'));
  const low = prioritizeLead({ leadId: 'l2', purchaseIntent: false, productCertainty: false, requestCompleteness: 0, buyingTimeframe: 'unknown', availabilityKnown: false, priceInstallmentInterest: false, hasPriorInteraction: false, followUpCount: 0, unresolvedBlocker: false });
  check('7-عميل بلا أدلة ⇒ أولوية منخفضة', low.priority === 'LOW');

  const fu = learnFromFollowUps([
    { followUpId: 'f1', leadId: 'l1', outcome: 'LED_TO_SALE', responseAt: new Date(NOW).toISOString(), sentAt: new Date(NOW - 2 * DAY).toISOString(), timeToResponseDays: 2, failureReason: null, consentRespected: true, limitations: [] },
    { followUpId: 'f2', leadId: 'l2', outcome: 'NO_RESPONSE', responseAt: null, sentAt: new Date(NOW - 3 * DAY).toISOString(), timeToResponseDays: null, failureReason: 'لا اهتمام', consentRespected: true, limitations: [] },
  ]);
  check('7-معدّل الاستجابة محسوب', fu.responseRate === 50);
  check('7-معدّل التحويل لبيع محسوب', fu.conversionToSaleRate === 50);
  check('7-متوسّط زمن الاستجابة', fu.averageTimeToResponseDays === 2);
  check('7-لا خرق خصوصية', fu.privacyViolations === 0);
  const emptyFu = learnFromFollowUps([]);
  check('7-بلا بيانات ⇒ معدّل null لا صفر', emptyFu.responseRate === null && emptyFu.conversionToSaleRate === null);
}

// ---------------------------------------------------------------------------
// 8) الحملة → البيع → الربح + الإسناد + التجارب (§12, §13, §14, §15)
// ---------------------------------------------------------------------------
section('8) الحملة والإسناد والتجارب');
{
  const withSales = buildCampaignCommercialReport({ campaignId: 'c1', objective: 'بيع', salesObjective: true, contentRefs: [], interactions: null, purchaseSignals: 10, leads: 5, requests: 3, verifiedSales: 3, verifiedRevenue: 1500000, campaignCost: null, productCost: null, expected: { metric: 'verified_sales', value: 2 } });
  check('8-حملة بمبيعات ⇒ نجاح تجاري', withSales.commerciallySuccessful === true);
  check('8-الربح غير متاح بلا تكلفة', withSales.profit.state === 'NOT_AVAILABLE' && withSales.profit.value === null);
  check('8-مقارنة متوقّع/واقع محسوبة', withSales.expectation.actual === 3);

  const noSales = buildCampaignCommercialReport({ campaignId: 'c2', objective: 'بيع', salesObjective: true, contentRefs: [], interactions: null, purchaseSignals: 0, leads: 0, requests: 0, verifiedSales: 0, verifiedRevenue: null, campaignCost: null, productCost: null, vanityMetric: { metric: 'views', value: 100000 }, expected: { metric: 'verified_sales', value: 5 } });
  check('8-حملة بلا بيع ⇒ لا نجاح', noSales.commerciallySuccessful === false);
  check('8-رفض النجاح بمقياس وهمي', noSales.vanityRejected === true);

  const profit = buildCampaignCommercialReport({ campaignId: 'c3', objective: 'بيع', salesObjective: true, contentRefs: [], interactions: null, purchaseSignals: 1, leads: 1, requests: 1, verifiedSales: 1, verifiedRevenue: 1000000, campaignCost: 100000, productCost: 400000, expected: { metric: 'verified_sales', value: 1 } });
  check('8-الربح متاح بإيراد + تكلفة موثوقين', profit.profit.state === 'AVAILABLE' && profit.profit.value === 500000);

  const attr = explainAttribution({ campaignId: 'c1', interactionId: 'i1', conversationId: 'cv1', leadId: 'l1', requestId: 'r1', saleId: 's1', platform: 'facebook' });
  check('8-الإسناد المباشر يسمح بالسببية', attr.canClaimCausation === true && attr.answer.includes('الدليل'));
  const attrWeak = explainAttribution({ campaignId: null, interactionId: null, conversationId: null, leadId: 'l1', requestId: null, saleId: 's1', platform: null });
  check('8-إسناد ضعيف ⇒ لا سببية', attrWeak.canClaimCausation === false);

  const inconclusive = judgeExperiment({ id: 'x1', hypothesis: 'h', variable: 'hook', variantA: 'a', variantB: 'b', resultA: 5, resultB: 6, sampleA: 2, sampleB: 2 });
  check('8-تجربة بعيّنة صغيرة ⇒ غير حاسمة', inconclusive.verdict === 'INCONCLUSIVE' && inconclusive.winner === null);
  const winner = judgeExperiment({ id: 'x2', hypothesis: 'h', variable: 'cta', variantA: 'a', variantB: 'b', resultA: 20, resultB: 5, sampleA: 20, sampleB: 20 });
  check('8-تجربة بعيّنة وفرق كافٍ ⇒ فائز', winner.winner === 'A' && winner.verdict === 'SUPPORTS_HYPOTHESIS');
  const tinyDelta = judgeExperiment({ id: 'x3', hypothesis: 'h', variable: 'timing', variantA: 'a', variantB: 'b', resultA: 100, resultB: 101, sampleA: 30, sampleB: 30 });
  check('8-فرق صغير ⇒ غير حاسم', tinyDelta.verdict === 'INCONCLUSIVE');

  check('8-ملخّص دورة الحملة', summarizeCampaignLoop([withSales, noSales, profit], [inconclusive, winner]).campaigns === 3);
}

// ---------------------------------------------------------------------------
// 9) الحكامة والتحسين الذاتي والسلامة (§25–§28, §42, §43)
// ---------------------------------------------------------------------------
section('9) الحكامة والتحسين الذاتي');
{
  const sendMsg = declareAction({ actionType: 'send_message', commercialImpact: 'إرسال رد لعميل', evidence: ['e'] });
  check('9-إجراء عالي الخطورة يتطلب موافقة المالك', sendMsg.authorityRequired === 4 && sendMsg.approvalState === 'required' && sendMsg.risk === 'high');
  check('9-إرسال رسالة غير قابل للعكس', sendMsg.reversibility === 'irreversible');
  const readOnly = declareAction({ actionType: 'read_analysis', commercialImpact: 'قراءة', evidence: [] });
  check('9-قراءة/تحليل لا تتطلب موافقة', readOnly.approvalState === 'not_required');

  check('9-السلامة ترفض اختراع سعر', checkProductionSafety('اختراع سعر للمنتج').safe === false);
  check('9-السلامة ترفض كشف اعتماد', checkProductionSafety('كشف اعتماد').safe === false);
  check('9-السلامة ترفض تعديل المصادقة', checkProductionSafety('تعديل المصادقة').safe === false);
  check('9-إجراء سليم يمرّ', checkProductionSafety('تحضير مسودة رد').safe === true);

  check('9-الافتراضي مراقبة (L0)', defaultAutonomyTier() === 0);
  check('9-لا توسيع سلطة صامت', assertNoSilentAuthorityExpansion(0, 5, false).ok === false && assertNoSilentAuthorityExpansion(0, 5, true).ok === true);

  const proposal = buildSelfImprovementProposal({ id: 'sp1', problem: 'فجوة تحويل', evidence: ['e'], proposedImprovement: 'تجربة عرض', expectedCommercialBenefit: 'رفع المبيعات', affectedComponents: ['campaignLoop'], domain: 'experiment' });
  check('9-الاقتراح كامل العناصر ويتطلب موافقة', proposal.status === 'PROPOSED' && proposal.ownerApprovalRequired === true && proposal.rollbackPlan.length > 0 && proposal.securityImpact.length > 0);

  const blocked = evaluateChangePipeline({ changeId: 'ch1', whatChanged: 'x', why: 'y', files: ['a.ts'], expectedBenefit: 'z', testsRun: false, auditPassed: false, securityChecked: false, ownerApproved: false, rollbackPlan: 'revert' });
  check('9-لا نشر بلا اختبار/تدقيق/أمان/موافقة', blocked.deployable === false && blocked.blocker !== null);
  const deployable = evaluateChangePipeline({ changeId: 'ch2', whatChanged: 'x', why: 'y', files: ['a.ts'], expectedBenefit: 'z', testsRun: true, auditPassed: true, securityChecked: true, ownerApproved: true, rollbackPlan: 'revert' });
  check('9-النشر ممكن فقط باكتمال المسار + موافقة', deployable.deployable === true);
  check('9-ملخّص الحكامة', summarizeGovernance([proposal], [sendMsg], [blocked, deployable]).deployableChanges === 1);
}

// ---------------------------------------------------------------------------
// 10) الصحة + الإصدارات + القدرات + الأحداث (§29, §32, §33, §44)
// ---------------------------------------------------------------------------
section('10) الصحة والإصدارات والقدرات');
{
  const health = buildSystemHealth({ dataQuality: 'OK', dataFreshness: 'DEGRADED', memoryIntegrity: 'OK', knowledgeIntegrity: 'OK', toolAvailability: 'OK', connectorState: 'OK', modelAvailability: 'OK', failedJobs: 0, errorCount: 0, securityAlerts: 0, learningPipeline: 'OK' });
  check('10-الصحة العامة DEGRADED عند فحص متدهور', health.overall === 'DEGRADED');
  check('10-الفشل يُعلن مع إجراء مقترح', health.checks.find((c) => c.key === 'data_freshness')?.proposedFix !== null);

  const versions = buildBrainVersionHistory();
  check('10-الإصدارات تتضمّن الدفعات 1–4', versions.length >= 4 && versions[0].version === 'v1.0');
  check('10-الإصدار الأخير v2.0', latestBrainVersion() === 'v2.0');
  check('10-كل إصدار يحمل سبباً/دليلاً/اختباراً/إرجاعاً', versions.every((v) => v.reason && v.evidence.length > 0 && v.tests && v.rollbackOption));

  const evo = buildCapabilityEvolution([
    { key: 'a', labelAr: 'قدرة أ', implemented: true, testCoverage: true, runtimeReady: true, evidence: ['e'], lastUpdate: '2026-10-02', nextImprovement: null },
    { key: 'b', labelAr: 'قدرة ب', implemented: true, testCoverage: false, runtimeReady: false, evidence: ['e'], lastUpdate: null, nextImprovement: 'x' },
  ]);
  check('10-المستوى محسوب من الأدلة لا نِسبة عشوائية', evo.capabilities[0].level === 'RUNTIME_READY' && evo.capabilities[1].level === 'IMPLEMENTED');
  check('10-القدرات غير الجاهزة معلنة', evo.notRuntimeReady.includes('قدرة ب'));
  check('10-نسخة القدرات = آخر إصدار', evo.version === 'v2.0');

  const envelope = toLearningEnvelope({ eventId: 'e1', type: 'verified_sale', at: new Date(NOW).toISOString(), platform: 'facebook', productId: 'p1', leadId: 'l1', campaignId: 'c1', customerKey: null, previousState: null, newState: null, evidence: ['saleId=s1'], attribution: 'DIRECT', reason: 'بيع', confidence: 'high', humanIntervention: false, outcome: 'verified_sale', learningEligible: true });
  check('10-مغلّف الحدث يحمل المصدر والمعرّفات', envelope.source === 'digital_sales_events' && envelope.entityRefs.productId === 'p1');
  check('10-ملخّص بنية الأحداث', summarizeEventArchitecture([{ eventId: 'e1', type: 'verified_sale', at: '', platform: null, productId: null, leadId: null, campaignId: null, customerKey: null, previousState: null, newState: null, evidence: [], attribution: null, reason: '', confidence: 'high', humanIntervention: false, outcome: null, learningEligible: true }]).eligible === 1);
}

// ---------------------------------------------------------------------------
// 11) الذاكرة الموحّدة (§31)
// ---------------------------------------------------------------------------
section('11) الذاكرة الموحّدة');
{
  check('11-قول AI غير موثوق', isTrustedOrigin('ai_statement') === false && isTrustedOrigin('research_external') === false);
  const aiItem = makeCommercialMemoryItem({ id: 'm1', kind: 'FACT', statement: 'السعر 300000', origin: 'ai_statement', source: 'ai', sampleSize: 10, nowMs: NOW });
  check('11-قول AI لا يصبح حقيقة تجارية', aiItem.isCommercialFact === false && aiItem.kind === 'HYPOTHESIS');
  const factItem = makeCommercialMemoryItem({ id: 'm2', kind: 'FACT', statement: 'السعر 500000', origin: 'platform_data', source: 'workspace.products', sampleSize: 5, nowMs: NOW });
  check('11-حقيقة من بيانات منصة + عيّنة', factItem.isCommercialFact === true);
  const researchItem = makeCommercialMemoryItem({ id: 'm3', kind: 'FACT', statement: 'سعر السوق 400000', origin: 'research_external', source: 'report', sampleSize: 10, nowMs: NOW });
  check('11-البحث الخارجي لا يصبح حقيقة تجارية', researchItem.isCommercialFact === false);

  let store = emptyCommercialMemory();
  store = rememberCommercial(store, aiItem);
  store = rememberCommercial(store, factItem);
  store = rememberCommercial(store, factItem);
  check('11-لا تكرار في الذاكرة', store.items.length === 2);
  check('11-ملخّص الذاكرة', summarizeCommercialMemory(store).facts === 1 && summarizeCommercialMemory(store).untrustedOrigins === 1);
}

// ---------------------------------------------------------------------------
// 12) دورة التشغيل والأسئلة (§46, §47)
// ---------------------------------------------------------------------------
section('12) دورة التشغيل');
{
  check('12-الدورة 20 خطوة', OPERATING_LOOP_ORDER.length === 20);
  const state = advanceOperatingLoop({ completed: ['OBSERVE', 'UNDERSTAND', 'VERIFY', 'RESEARCH', 'IDENTIFY_OPPORTUNITY', 'PRIORITIZE', 'HYPOTHESIS', 'PLAN', 'PREPARE'] });
  check('12-الخطوة التالية موافقة المالك', state.currentStep === 'OWNER_APPROVAL');
  check('12-التقدّم موقوف على الموافقة', state.blockedOnOwnerApproval === true);
  const approved = advanceOperatingLoop({ completed: ['OBSERVE', 'UNDERSTAND', 'VERIFY', 'RESEARCH', 'IDENTIFY_OPPORTUNITY', 'PRIORITIZE', 'HYPOTHESIS', 'PLAN', 'PREPARE'], ownerApproved: true });
  check('12-مع الموافقة لا حجب', approved.blockedOnOwnerApproval === false);
  check('12-الأسئلة التجارية النهائية معلنة', FINAL_COMMERCIAL_QUESTIONS.length >= 15 && FINAL_COMMERCIAL_QUESTIONS[0].includes('يبيع'));
}

console.log(`PASSED: ${passed} Unified Commercial Brain (unit) checks`);
