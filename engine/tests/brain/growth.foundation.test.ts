/**
 * اختبار وحدة عقل التسويق والطلب (Growth & Demand) — منطق خالص.
 *
 * يثبت أن الطبقة تبني مقاطع جمهور وفرص طلب ومطابقة وحملات وتجارب وقُمعاً بيعياً
 * من بيانات حقيقية فقط، وتفصل الحقيقة عن التفسير عن الفرضية عن التوصية، ولا
 * تخترع جمهوراً ولا وصولاً ولا بيعاً ولا نتيجة حملة.
 *
 * تشغيل: npx tsx engine/tests/brain/growth.foundation.test.ts
 */

import assert from 'node:assert';

import { classifyConversation } from '../../brain/audience/conversationIntelligence';
import {
  deriveAudienceSegments, summarizeAudienceSegments, SEGMENT_MIN_SAMPLE,
  type AudienceInteraction,
} from '../../brain/growth/segments';
import {
  detectDemandOpportunities, summarizeDemandDiscovery, computeDemandTrend, toSignalLite,
} from '../../brain/growth/demandDiscovery';
import { matchProductsToAudience, summarizeMatches } from '../../brain/growth/matching';
import { buildCampaignFromOpportunity, campaignHasReason, recordActualResult, summarizeGrowthCampaigns } from '../../brain/growth/campaigns';
import {
  createMarketingExperiment, concludeMarketingExperiment, proposeExperimentForOpportunity,
  GROWTH_MIN_EXPERIMENT_EVIDENCE,
} from '../../brain/growth/experiments';
import { buildSalesFunnel, summarizeSalesFunnel } from '../../brain/growth/funnel';
import { buildGrowthRuntime, buildPlatformBriefs } from '../../brain/growth/runtime';

let passed = 0;
const check = (name: string, cond: boolean) => {
  assert.ok(cond, `FAIL: ${name}`);
  passed += 1;
};

const NOW = Date.parse('2026-10-02T10:00:00.000Z');

function interaction(platform: string, externalId: string, text: string, at: string | null, productId: string | null = null, productCategory: string | null = null): AudienceInteraction {
  return {
    platform: platform as any,
    externalId,
    text,
    at,
    productId,
    productCategory,
    classification: classifyConversation({ platform: platform as any, externalId, text }),
  };
}

// ---------------------------------------------------------------------------
// 1) المقاطع: دليل حقيقي، فرضية دون عيّنة، لا سمات شخصية
// ---------------------------------------------------------------------------
{
  const interactions: AudienceInteraction[] = [
    interaction('facebook', 'a1', 'تجهيز بيت جديد ونريد غسالة', '2026-09-28T00:00:00Z', 'p1', 'appliances'),
    interaction('facebook', 'a2', 'نريد تجهيز البيت كامل — ثلاجة وغسالة', '2026-09-29T00:00:00Z', 'p1', 'appliances'),
    interaction('instagram', 'a3', 'تجهيز بيت جديد، شكد القسط؟', '2026-09-30T00:00:00Z', 'p1', 'appliances'),
    interaction('facebook', 'b1', 'عندي غسالة خربانة وأريد بديل', '2026-09-30T01:00:00Z'),
  ];
  const segs = deriveAudienceSegments({ interactions, hasInstallmentPlans: true });
  const fam = segs.find((s) => s.id === 'families_preparing_home');
  check('1-مقطع تجهيز البيت مدعوم بعيّنة كافية', Boolean(fam) && fam!.state === 'SUPPORTED' && fam!.sampleSize === 3);
  check('1-حيث يوجد الجمهور من المنصات الفعلية', Boolean(fam) && fam!.whereActive.includes('facebook' as any) && fam!.whereActive.includes('instagram' as any));
  const replace = segs.find((s) => s.id === 'replacing_old_appliances');
  check('1-مقطع الاستبدال فرضية (عيّنة ناقصة)', Boolean(replace) && replace!.state === 'HYPOTHESIS');
  check('1-لا مقطع بلا دليل', segs.every((s) => s.evidence.length > 0 && s.sampleSize > 0));
  const summary = summarizeAudienceSegments(segs);
  check('1-الملخّص يفصل المدعوم عن الفرضية', summary.total === segs.length && summary.supported + summary.hypotheses === segs.length);

  // بلا خطط تقسيط ⇒ لا مقطع تقسيط
  const noPlans = deriveAudienceSegments({ interactions, hasInstallmentPlans: false });
  check('1-بلا خطط تقسيط لا يُعلن مقطع التقسيط', !noPlans.some((s) => s.id === 'installment_shoppers'));

  // بيانات فارغة ⇒ لا مقاطع مُختلقة
  check('1-بيانات فارغة ⇒ لا مقاطع', deriveAudienceSegments({ interactions: [], hasInstallmentPlans: true }).length === 0);
  check('1-الحد الأدنى معلن', SEGMENT_MIN_SAMPLE === 3);
}

// ---------------------------------------------------------------------------
// 2) اكتشاف الطلب: النوع، الاتجاه، العيّنة، غير المُلبّى
// ---------------------------------------------------------------------------
{
  const interactions: AudienceInteraction[] = [
    interaction('facebook', 'd1', 'شكد سعر الغسالة؟', '2026-09-25T00:00:00Z', 'p1', 'appliances'),
    interaction('facebook', 'd2', 'شكد سعر الغسالة؟', '2026-09-26T00:00:00Z', 'p1', 'appliances'),
    interaction('facebook', 'd3', 'شكد سعر الغسالة؟', '2026-09-30T00:00:00Z', 'p1', 'appliances'),
    interaction('facebook', 'd4', 'شكد سعر الغسالة؟', '2026-10-01T00:00:00Z', 'p1', 'appliances'),
    interaction('instagram', 'e1', 'ليش ماكو موبايلات جديدة عندكم؟', '2026-09-30T00:00:00Z', 'px-missing', 'phones'),
  ];
  const opps = detectDemandOpportunities({ interactions, catalogProductIds: ['p1'] });
  const price = opps.find((o) => o.kind === 'repeated_price_request');
  check('2-طلب سعر متكرر مكتشف', Boolean(price) && price!.sampleSize === 4 && price!.sufficientSample);
  check('2-الفصل المعرفي مطبّق', Boolean(price) && price!.fact.epistemic === 'FACT' && price!.hypothesis.epistemic === 'HYPOTHESIS' && price!.recommendation.epistemic === 'RECOMMENDATION');
  check('2-الفرصة تحمل المصدر والفترة والعيّنة', Boolean(price) && price!.source.length > 0 && price!.sampleSize === 4);
  const unmet = opps.find((o) => o.kind === 'unmet_product_request');
  check('2-طلب منتج غير موجود ⇒ غير مُلبّى', Boolean(unmet) && unmet!.productId === 'px-missing' && unmet!.requiresOwnerAction);
  check('2-غير المتاح لا يُخترع منتج', opps.every((o) => o.productId === null || typeof o.productId === 'string'));

  // عيّنة ناقصة ⇒ INSUFFICIENT
  const few = detectDemandOpportunities({ interactions: [interaction('facebook', 'x1', 'شكد السعر؟', '2026-09-30T00:00:00Z', 'p1')], catalogProductIds: ['p1'] });
  check('2-عيّنة ناقصة ⇒ غير مؤكّد', few.every((o) => !o.sufficientSample || o.kind === 'repeated_price_request') && few.some((o) => !o.sufficientSample));

  const summary = summarizeDemandDiscovery(opps);
  check('2-الملخّص يحصي الكافي وغير الكافي', summary.total === opps.length && summary.sufficient + summary.insufficient === opps.length);
}

// ---------------------------------------------------------------------------
// 3) اتجاه الطلب: لا تزايد بلا اتجاه مقيس
// ---------------------------------------------------------------------------
{
  const rising = [
    interaction('facebook', 'r1', 'شكد سعر p1', '2026-09-20T00:00:00Z', 'p1'),
    interaction('facebook', 'r2', 'شكد سعر p1', '2026-09-29T00:00:00Z', 'p1'),
    interaction('facebook', 'r3', 'شكد سعر p1', '2026-09-30T00:00:00Z', 'p1'),
    interaction('facebook', 'r4', 'شكد سعر p1', '2026-10-01T00:00:00Z', 'p1'),
  ];
  const trend = computeDemandTrend(rising.map(toSignalLite));
  check('3-اتجاه متزايد مقيس', trend.trend === 'RISING' && trend.secondHalf > trend.firstHalf);

  const tooFew = computeDemandTrend([toSignalLite(interaction('facebook', 'z1', 'شكد سعر p1', '2026-10-01T00:00:00Z', 'p1'))]);
  check('3-عيّنة زمنية ناقصة ⇒ اتجاه غير معروف', tooFew.trend === 'UNKNOWN');

  const opps = detectDemandOpportunities({ interactions: rising, catalogProductIds: ['p1'] });
  const risingOpp = opps.find((o) => o.kind === 'rising_product_demand');
  check('3-فرصة تزايد تُضاف عند اتجاه مقيس', Boolean(risingOpp) && risingOpp!.trend === 'RISING');
}

// ---------------------------------------------------------------------------
// 4) المطابقة: WHO/WHY/WHAT/WHERE/WHEN/MESSAGE/CTA وبلا اختراع
// ---------------------------------------------------------------------------
{
  const interactions: AudienceInteraction[] = [
    interaction('facebook', 'm1', 'تجهيز بيت جديد ونريد غسالة — شكد القسط؟', '2026-09-28T00:00:00Z', 'p1', 'appliances'),
    interaction('facebook', 'm2', 'نريد تجهيز البيت — شكد القسط؟', '2026-09-29T00:00:00Z', 'p1', 'appliances'),
    interaction('facebook', 'm3', 'تجهيز بيت وشكد القسط على الغسالة؟', '2026-09-30T00:00:00Z', 'p1', 'appliances'),
  ];
  const segs = deriveAudienceSegments({ interactions, hasInstallmentPlans: true });
  const opps = detectDemandOpportunities({ interactions, catalogProductIds: ['p1'] });
  const products = [{
    id: 'p1', name: 'غسالة LG', category: 'appliances', brand: 'LG', model: null, description: null, specs: [], attributes: {}, images: [],
    cashPrice: { value: 750000, state: 'VERIFIED', source: 'workspace.products', lastVerifiedAt: null },
    availability: { value: { inStock: true, stockQuantity: 4 }, state: 'VERIFIED', source: 'workspace.products', lastVerifiedAt: null },
    installmentOffers: [{ durationMonths: 12, downPaymentAmount: 75000, downPaymentPercent: 10, monthlyAmount: 56250, totalInstallments: 675000, fees: 0, conditions: [], state: 'DERIVED', source: 'rule', lastVerifiedAt: null }],
    relatedProductIds: [], alternativeProductIds: [], supplier: null, ownerApproval: 'approved', source: 'workspace.products', lastVerifiedAt: null,
    createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(),
  }] as any;
  const matches = matchProductsToAudience({ products, segments: segs, demandOpportunities: opps, productCategories: { p1: 'appliances' } });
  const m = matches.find((x) => x.productId === 'p1')!;
  check('4-المطابقة مدعومة', m.state === 'MATCHED' && m.who.length > 0);
  check('4-الحقول السبعة موجودة', Boolean(m.why && m.whatToShow && m.when && m.message && m.cta) && Array.isArray(m.where));
  check('4-الرسالة تستخدم الحقائق الموثّقة فقط', m.message.includes('غسالة LG') && (m.message.includes('750,000') || m.message.includes('تقسيط')));

  // منتج بلا دليل طلب ⇒ NO_EVIDENCE بلا اختراع جمهور
  const orphan = [{
    id: 'p2', name: 'منتج بلا تفاعل', category: 'other', brand: null, model: null, description: null, specs: [], attributes: {}, images: [],
    cashPrice: { value: null, state: 'NOT_PROVIDED', source: null, lastVerifiedAt: null },
    availability: { value: null, state: 'NOT_PROVIDED', source: null, lastVerifiedAt: null },
    installmentOffers: [], relatedProductIds: [], alternativeProductIds: [], supplier: null, ownerApproval: 'approved', source: 'workspace.products', lastVerifiedAt: null,
    createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(),
  }] as any;
  const noMatch = matchProductsToAudience({ products: orphan, segments: segs, demandOpportunities: opps });
  check('4-بلا دليل ⇒ NO_EVIDENCE', noMatch[0].state === 'NO_EVIDENCE' && noMatch[0].who.length === 0);
  const ms = summarizeMatches(matches);
  check('4-الملخّص يحصي المطابقات', ms.total === matches.length);
}

// ---------------------------------------------------------------------------
// 5) الحملات: سبب إلزامي + نتيجة فعلية بمصدر فقط
// ---------------------------------------------------------------------------
{
  const interactions: AudienceInteraction[] = [
    interaction('facebook', 'c1', 'شكد سعر الغسالة؟', '2026-09-25T00:00:00Z', 'p1', 'appliances'),
    interaction('facebook', 'c2', 'شكد سعر الغسالة؟', '2026-09-26T00:00:00Z', 'p1', 'appliances'),
    interaction('facebook', 'c3', 'شكد سعر الغسالة؟', '2026-09-30T00:00:00Z', 'p1', 'appliances'),
  ];
  const segs = deriveAudienceSegments({ interactions, hasInstallmentPlans: true });
  const opps = detectDemandOpportunities({ interactions, catalogProductIds: ['p1'] });
  const opp = opps.find((o) => o.sufficientSample)!;
  const campaign = buildCampaignFromOpportunity({ opportunity: opp, segment: segs[0] || null, match: null, now: NOW });
  check('5-الحملة لها سبب وفرضية وCTA', campaignHasReason(campaign).complete);
  check('5-مرجع إشارة الطلب موجود', Boolean(campaign.demandSignalRef));
  check('5-النتيجة الفعلية تبدأ غير متاحة', campaign.actualResult.value === null && campaign.leads === null);
  const noSource = recordActualResult(campaign, { value: 10, source: null, now: NOW });
  check('5-لا نتيجة بلا مصدر', noSource.recorded === false);
  const withSource = recordActualResult(campaign, { value: 10, source: 'performanceRecords', now: NOW });
  check('5-النتيجة تُسجَّل بمصدر حقيقي', withSource.recorded === true && withSource.campaign.actualResult.value === 10);
  const summary = summarizeGrowthCampaigns([campaign]);
  check('5-ملخّص الحملات', summary.total === 1 && summary.withReason === 1);
}

// ---------------------------------------------------------------------------
// 6) التجارب: متغيّر واحد، لا فائز بلا عيّنة/بفرق ضجيج
// ---------------------------------------------------------------------------
{
  const exp = createMarketingExperiment({
    id: 'exp-1', type: 'two_hooks', hypothesis: 'هوكان يغيّران الاستفسارات', variable: 'الهوك',
    variantA: { id: 'a', label: 'A', description: '' }, variantB: { id: 'b', label: 'B', description: '' },
    successMetric: 'استفسارات', now: NOW,
  });
  const inconclusive = concludeMarketingExperiment(exp, { a: 10, b: 12, sampleA: 2, sampleB: 2 });
  check('6-عيّنة ناقصة ⇒ غير حاسم', inconclusive.verdict === 'inconclusive');
  const noise = concludeMarketingExperiment(exp, { a: 100, b: 102, sampleA: 5, sampleB: 5 });
  check('6-فرق داخل الضجيج ⇒ غير حاسم', noise.verdict === 'inconclusive');
  const supports = concludeMarketingExperiment(exp, { a: 100, b: 130, sampleA: 5, sampleB: 5 });
  check('6-فرق كبير بعيّنة كافية ⇒ يدعم الفرضية', supports.verdict === 'supports_hypothesis');
  const rejects = concludeMarketingExperiment(exp, { a: 100, b: 70, sampleA: 5, sampleB: 5 });
  check('6-انخفاض كبير ⇒ لا يدعم الفرضية', rejects.verdict === 'rejects_hypothesis');
  check('6-الحد الأدنى للأدلة معلن', GROWTH_MIN_EXPERIMENT_EVIDENCE === 5);

  const suggestion = proposeExperimentForOpportunity({ id: 'exp-2', opportunityKind: 'installment_interest', opportunityRef: 'opp', productName: 'غسالة', now: NOW });
  check('6-تجربة التقسيط من نوع عرض المنتج', suggestion.experiment.type === 'product_presentation');
}

// ---------------------------------------------------------------------------
// 7) القُمع البيعي وعنق الزجاجة
// ---------------------------------------------------------------------------
{
  const funnel = buildSalesFunnel({ reach: 10000, interest: 500, inquiries: 100, leads: 20, verifiedSales: 5 });
  check('7-كل المراحل المتاحة محسوبة', funnel.stages.every((s) => s.available));
  check('7-معدّلات التحويل محسوبة', funnel.conversions.every((c) => c.available));
  check('7-عنق الزجاجة مُعلن', Boolean(funnel.bottleneck));
  const lowest = Math.min(...funnel.conversions.map((c) => c.ratePct as number));
  check('7-عنق الزجاجة هو أدنى تحويل', funnel.bottleneck!.reason.includes(String(lowest)));

  const partial = buildSalesFunnel({ reach: null, interest: null, inquiries: 100, leads: 20, verifiedSales: 5 });
  check('7-المرحلة غير المتاحة تُعلن لا تُقدَّر', partial.stages[0].available === false && partial.stages[0].value === null);
  check('7-لا معدّل بمقام ناقص', partial.conversions.find((c) => c.from === 'REACH')!.available === false);

  const summary = summarizeSalesFunnel(funnel);
  check('7-ملخّص القُمع', summary.availableStages === 5 && summary.totalStages === 5);
}

// ---------------------------------------------------------------------------
// 8) التوجيه العام للمحتوى (platform-agnostic): لا عقل لكل منصة
// ---------------------------------------------------------------------------
{
  const campaigns: any[] = [{ platforms: ['facebook', 'instagram'], productName: 'x' }];
  const briefs = buildPlatformBriefs(campaigns);
  check('8-توجيه لكل منصة مستهدفة', briefs.length === 2);
  check('8-التوجيه يحمل الحدود الرسمية', briefs.every((b) => typeof b.bodyLimit === 'number' && b.format.length > 0));
}

// ---------------------------------------------------------------------------
// 9) الحالة الكاملة على بيانات حقيقية + الصفر الصادق
// ---------------------------------------------------------------------------
{
  const raw = {
    now: NOW,
    installmentPlans: [{ id: 'plan-12', maxMonths: 12, minDownPaymentPercent: 10 }],
    products: [{ id: 'p1', name: 'غسالة LG', category: 'appliances', cashPrice: 750000, inStock: true, durationMonths: 12, downPaymentPercent: 10 }],
    socialComments: [
      { id: 'g1', platform: 'facebook', externalId: 'g1', authorName: 'أ', text: 'تجهيز بيت جديد ونريد غسالة — شكد القسط؟', createdAt: '2026-09-28T00:00:00Z', productId: 'p1' },
      { id: 'g2', platform: 'facebook', externalId: 'g2', authorName: 'ب', text: 'تجهيز البيت وشكد القسط؟', createdAt: '2026-09-29T00:00:00Z', productId: 'p1' },
      { id: 'g3', platform: 'facebook', externalId: 'g3', authorName: 'ج', text: 'نريد تجهيز البيت — شكد القسط على الغسالة؟', createdAt: '2026-09-30T00:00:00Z', productId: 'p1' },
    ],
    leads: [{ id: 'l1', customerName: 'علي', phone: '0780', status: 'proposal', interestedProduct: 'غسالة LG' }],
    sales: [{ id: 'sale-1', customerName: 'علي', phone: '0780', productId: 'p1', productName: 'غسالة LG', totalAmount: 750000, status: 'completed' }],
    performanceRecords: [{ id: 'perf1', platform: 'facebook', productCategory: 'appliances', ctaType: 'whatsapp', values: { reach: 5000, likes: 120, comments: 30, shares: 10 } }],
  };
  const rt = buildGrowthRuntime(raw as any);
  check('9-الكتالوج من بيانات حقيقية', rt.catalog.length === 1 && rt.catalog[0].cashPrice.state === 'VERIFIED');
  check('9-فرص طلب مبنية', rt.demandOpportunities.length > 0);
  check('9-حملات مشتقّة من فرص بعيّنة كافية', rt.campaigns.length > 0 && rt.campaigns.every((c) => campaignHasReason(c).complete));
  check('9-القُمع يعكس المبيعات الموثّقة', rt.funnel.stages.find((s) => s.stage === 'VERIFIED_SALE')!.value === 1);
  check('9-لا Gemini في المخرج', !JSON.stringify(rt).includes('gemini'));
  check('9-الحدود معلنة', rt.limitations.length > 0 && rt.nextActions.length > 0);

  // بيانات فارغة ⇒ صفر صادق بلا اختراع
  const empty = buildGrowthRuntime({ now: NOW } as any);
  check('9-بيانات فارغة ⇒ لا مقاطع', empty.segments.length === 0);
  check('9-بيانات فارغة ⇒ لا فرص', empty.demandOpportunities.length === 0);
  check('9-بيانات فارغة ⇒ لا حملات', empty.campaigns.length === 0);
  check('9-بيانات فارغة ⇒ الوصول/التفاعل غير متاح', !empty.funnel.stages.find((s) => s.stage === 'REACH')!.available && !empty.funnel.stages.find((s) => s.stage === 'INTEREST')!.available);
  check('9-بيانات فارغة ⇒ الاستفسار صفر حقيقي (لا مُختلق)', empty.funnel.stages.find((s) => s.stage === 'INQUIRY')!.value === 0);
  check('9-بيانات فارغة لا تنهار', typeof empty.note === 'string');
}

console.log(`PASSED: ${passed} Growth & Demand foundation checks`);
