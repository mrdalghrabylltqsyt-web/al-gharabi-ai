/**
 * اختبار مكافحة الاختلاق للعقل التجاري المركزي (الدفعة 4) — منطق خالص.
 *
 * يثبت صراحةً أن النظام **لا يختلق** أي معلومة تجارية: لا سعر/قسط/توفّر، لا مبيعات/
 * إيراد/ربح، لا جمهور/وصول، لا نتيجة حملة/تجربة، ولا قدرة/إصدار بلا دليل. وأن الغائب
 * يُعلن لا يُقدَّر، وأن المقاييس الوهمية لا تُعتمد هدفاً للتحسين.
 */

import assert from 'node:assert';

import { buildNorthStarReport, isVanityMetric, compareOutcomesCommercial } from '../../brain/commercial/northStar';
import { makeCommercialFact, canUseForCommercialAnswer } from '../../brain/commercial/truth';
import { buildCommercialRecommendation, prioritizeOpportunities } from '../../brain/commercial/strategy';
import { classifyProductCommercial, buildProductOpportunities } from '../../brain/commercial/productIntel';
import { buildCampaignCommercialReport, judgeExperiment } from '../../brain/commercial/campaignLoop';
import { resolveLifecycle, learnFromFollowUps } from '../../brain/commercial/lifecycle';
import { assessImprovement, compareExpectationVsReality, runLearningCycle } from '../../brain/commercial/learning';
import { declareAction, checkProductionSafety, buildSelfImprovementProposal, evaluateChangePipeline } from '../../brain/commercial/governance';
import { makeCommercialMemoryItem } from '../../brain/commercial/commercialMemory';
import { makeResearchItem, canUseResearch } from '../../brain/commercial/research';
import { advanceOperatingLoop } from '../../brain/commercial/operatingLoop';

let passed = 0;
const check = (name: string, cond: boolean) => { assert.ok(cond, `FAIL: ${name}`); passed += 1; };
const NOW = Date.parse('2026-10-02T12:00:00Z');

// 1) لا بيع/إيراد/ربح مُخترع
{
  const r = buildNorthStarReport({ verifiedSales: null, verifiedRevenue: null, verifiedProfit: null, qualifiedDemand: null, qualifiedLeads: null, requests: null });
  check('A1-لا بيع موثّق ⇒ القيمة null لا صفر', r.objectives.every((o) => o.value === null));
  check('A1-حرس الربح يمنع حساب ربح بلا تكلفة', r.profitGuard !== null);
  const r2 = buildNorthStarReport({ verifiedSales: 0, verifiedRevenue: null, verifiedProfit: null, qualifiedDemand: 0, qualifiedLeads: 0, requests: 0 });
  check('A1-صفر حقيقي يبقى صفراً (ليس اختلاقاً)', r2.objectives[0].value === 0);
}

// 2) المقاييس الوهمية لا تُعتمد هدفاً
{
  const vanity = buildCommercialRecommendation({ id: 'r', action: 'a', why: 'b', evidence: ['e'], expectedBenefit: 'c', sampleSize: 5, objectiveMetric: 'reach' });
  check('A2-توصية بهدف وصول مرفوضة', vanity.ok === false && (vanity as any).code === 'VANITY_OBJECTIVE');
  const c = compareOutcomesCommercial({ a: { label: 'A', metric: 'views', value: 1e6, qualifiedLeads: 0, verifiedSales: 0 }, b: { label: 'B', metric: 'views', value: 10, qualifiedLeads: 5, verifiedSales: 2 }, salesObjective: true });
  check('A2-الأعلى مشاهدات ليس الفائز التجاري', c.commercialLeader === 'b' && c.vanityTrap === true);
  check('A2-المشاهدات/الإعجابات/المتابعون وهمية', isVanityMetric('views') && isVanityMetric('likes') && isVanityMetric('followers'));
}

// 3) لا معلومة منتج مُخترعة
{
  const noData = classifyProductCommercial({ productId: 'p', productName: 'منتج', priceVerified: false, availabilityVerified: false, installmentAvailable: false, demandSignals: 0, purchaseSignals: 0, qualifiedLeads: 0, requests: 0, verifiedSales: 0, revenue: null, profit: null, campaignCount: 0, priceObjections: 0, installmentQuestions: 0, availabilityRequests: 0, specificationRequests: 0, demandFirstHalf: null, demandSecondHalf: null, lostCount: 0, evidenceSource: 'none', sampleSize: 0 });
  check('A3-بلا بيانات ⇒ DATA_INSUFFICIENT', noData.status === 'DATA_INSUFFICIENT');
  check('A3-لا فرصة بلا دليل', buildProductOpportunities({ intel: noData, timePeriod: 'x' }).length === 0);
}

// 4) لا نتيجة حملة/تجربة مُصنّعة
{
  const c = buildCampaignCommercialReport({ campaignId: 'c', objective: 'بيع', salesObjective: true, contentRefs: [], interactions: null, purchaseSignals: null, leads: null, requests: null, verifiedSales: null, verifiedRevenue: null, campaignCost: null, productCost: null, expected: { metric: 'verified_sales', value: 5 } });
  check('A4-حملة بلا بيانات ⇒ لا نجاح ولا ربح', c.commerciallySuccessful === null && c.profit.value === null);
  const e = judgeExperiment({ id: 'e', hypothesis: 'h', variable: 'hook', variantA: 'a', variantB: 'b', resultA: 10, resultB: 20, sampleA: 1, sampleB: 1 });
  check('A4-تجربة بعيّنة صغيرة ⇒ لا فائز', e.winner === null && e.verdict === 'INCONCLUSIVE');
}

// 5) لا بيع من استفسار
{
  const l = resolveLifecycle({ leadId: 'l', stage: 'QUALIFIED_LEAD', verifiedSaleId: null, marketingConsent: true, optedOut: false, verifiedPurchaseCount: 0, purchasedProductIds: [], requestedProductId: null });
  check('A5-استفسار لا يصبح مشترياً', l.stage !== 'VERIFIED_SALE');
  const fu = learnFromFollowUps([]);
  check('A5-بلا متابعات ⇒ معدّلات null لا صفر', fu.responseRate === null && fu.conversionToSaleRate === null);
}

// 6) لا تعلّم/تحسّن بلا دليل
{
  const lc = runLearningCycle({ id: 'l', hypothesis: 'h', action: 'a', result: 'r', comparison: 'c', source: 'conversion', evidence: [], sampleSize: 1, nowMs: NOW });
  check('A6-تعلّم بعيّنة صغيرة ⇒ INSUFFICIENT_DATA', lc.verdict === 'INSUFFICIENT_DATA');
  const imp = assessImprovement({ subject: 's', previousVerified: 1, newVerified: 9, sampleSize: 1, periodDays: 1 });
  check('A6-لا ادّعاء تحسّن بلا عيّنة/مدّة', imp.canClaimImproved === false);
  const exp = compareExpectationVsReality({ subject: 's', expected: null, actual: 5 });
  check('A6-لا مقارنة توقّع بلا متوقّع', exp.verdict === 'INCONCLUSIVE');
}

// 7) لا حقيقة تجارية من AI/بحث خارجي
{
  const ai = makeCommercialMemoryItem({ id: 'm', kind: 'FACT', statement: 'السعر 100', origin: 'ai_statement', source: 'ai', sampleSize: 50, nowMs: NOW });
  check('A7-قول AI لا يصبح حقيقة تجارية', ai.isCommercialFact === false);
  const research = makeCommercialMemoryItem({ id: 'm2', kind: 'FACT', statement: 'السعر 200', origin: 'research_external', source: 'report', sampleSize: 50, nowMs: NOW });
  check('A7-بحث خارجي لا يصبح حقيقة تجارية', research.isCommercialFact === false);
  const stale = makeResearchItem({ id: 'r', topic: 't', claim: 'c', source: 's', collectedAt: new Date(NOW - 400 * 86400000).toISOString(), nowMs: NOW });
  check('A7-بحث قديم غير قابل للاستخدام', canUseResearch(stale).usable === false);
}

// 8) لا تنفيذ ذاتي بلا اعتماد + لا مساس بالممنوعات
{
  const send = declareAction({ actionType: 'send_message', commercialImpact: 'إرسال', evidence: ['e'] });
  check('A8-إرسال رسالة يتطلب موافقة المالك', send.approvalState === 'required');
  check('A8-السلامة ترفض اختراع بيع', checkProductionSafety('اختراع بيع').safe === false);
  const prop = buildSelfImprovementProposal({ id: 'p', problem: 'x', evidence: ['e'], proposedImprovement: 'y', expectedCommercialBenefit: 'z', affectedComponents: ['a'], domain: 'software' });
  check('A8-اقتراح برمجي يتطلب موافقة المالك', prop.ownerApprovalRequired === true);
  const blocked = evaluateChangePipeline({ changeId: 'c', whatChanged: 'x', why: 'y', files: ['a'], expectedBenefit: 'z', testsRun: false, auditPassed: false, securityChecked: false, ownerApproved: false, rollbackPlan: 'revert' });
  check('A8-لا نشر بلا اختبار/موافقة', blocked.deployable === false);
}

// 9) لا تقدّم بلا موافقة
{
  const s = advanceOperatingLoop({ completed: ['OBSERVE', 'UNDERSTAND', 'VERIFY', 'RESEARCH', 'IDENTIFY_OPPORTUNITY', 'PRIORITIZE', 'HYPOTHESIS', 'PLAN', 'PREPARE'] });
  check('A9-التنفيذ موقوف على موافقة المالك', s.blockedOnOwnerApproval === true);
}

// 10) الأولوية لا تختلق دليلاً
{
  const weak = prioritizeOpportunities([{ id: 'a', title: 'أ', expectedImpact: 'high', evidenceStrength: 'weak', confidence: 'low', urgency: 'high', cost: 'low', difficulty: 'low', risk: 'low', sampleSize: 0 }]);
  check('A10-فرصة بلا عيّنة تحمل سبباً صريحاً', weak[0].rationale.length > 0);
}

console.log(`PASSED: ${passed} Unified Commercial Brain anti-fabrication checks`);
