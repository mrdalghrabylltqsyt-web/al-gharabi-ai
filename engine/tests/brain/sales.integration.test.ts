/**
 * اختبار تكامل العقل التجاري مع بيانات الغرابي الحقيقية (منطق خالص).
 *
 * يثبت أن الطبقة تقرأ المنتجات/خطط التقسيط/المحادثات/العملاء/المبيعات/التعليقات
 * الحقيقية وتبني منها كتالوجاً وإشارات طلب وفرصاً ومسار عملاء — **بلا أي اختراع**،
 * وأن البيع لا يُعلن إلا بمعرّف بيع حقيقي، وأن الذاكرة تفصل الحقيقة عن الفرضية.
 *
 * تشغيل: npx tsx engine/tests/brain/sales.integration.test.ts
 */

import assert from 'node:assert';

import {
  buildCommercialRuntime, buildCatalogFromWorkspace, approvedInstallmentRules,
  buildInteractionsFromComments, buildJourneysFromWorkspace, buildRoiInput,
  buildSalesEvidence, buildCampaignsFromWorkspace, type CommercialRawData,
} from '../../brain/sales/commercialRuntime';
import { buildCommercialMemorySeeds, mergeCommercialMemory, summarizeCommercialMemory, COMMERCIAL_MEMORY_PREFIX } from '../../brain/sales/commercialMemory';
import { emptyBrainMemory } from '../../brain/memory/store';
import { describeMissingInfo } from '../../brain/knowledge/catalog';

let passed = 0;
const check = (name: string, cond: boolean) => {
  assert.ok(cond, `FAIL: ${name}`);
  passed += 1;
};

const NOW = Date.parse('2026-10-02T10:00:00.000Z');

// بيانات حقيقية الشكل كما تُحفظ فعلاً في مساحة العمل (لا قيم وهمية في الوحدات).
const RAW: CommercialRawData = {
  now: NOW,
  showroom: { name: 'معرض الغرابي' },
  installmentPlans: [
    { id: 'plan-12', name: '12 شهر', maxMonths: 12, minDownPaymentPercent: 10, requirements: ['بطاقة سكن'] },
  ],
  products: [
    { id: 'p1', name: 'غسالة LG', category: 'appliances', brand: 'LG', cashPrice: 750000, inStock: true, stockQuantity: 4, durationMonths: 12, downPaymentPercent: 10 },
    { id: 'p2', name: 'ثلاجة سامسونج', category: 'appliances', brand: 'Samsung', cashPrice: 0, inStock: true },
    { id: 'p3', name: 'موبايل', category: 'phones', brand: 'X', cashPrice: null },
  ],
  conversations: [
    { id: 'c1', customerName: 'أحمد', phone: '0770', channel: 'facebook', status: 'open', history: [{ id: 'm1', sender: 'customer', text: 'شكد القسط على الغسالة؟' }] },
  ],
  leads: [
    { id: 'l1', customerName: 'علي', phone: '0780', channel: 'instagram', status: 'proposal', interestedProduct: 'غسالة LG' },
    { id: 'l2', customerName: 'حسن', phone: '0790', channel: 'tiktok', status: 'new', interestedProduct: 'ثلاجة سامسونج' },
  ],
  sales: [
    { id: 'sale-1', customerName: 'علي', phone: '0780', productId: 'p1', productName: 'غسالة LG', totalAmount: 750000, status: 'completed' },
  ],
  socialComments: [
    { id: 'sc1', platform: 'facebook', externalId: 'fb1', authorName: 'أحمد', text: 'شكد القسط على الغسالة؟', createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 'sc2', platform: 'facebook', externalId: 'fb2', authorName: 'سعد', text: 'شكد القسط على الغسالة؟', createdAt: '2026-10-01T02:00:00.000Z' },
    { id: 'sc3', platform: 'instagram', externalId: 'ig1', authorName: 'مريم', text: 'شكد سعر الغسالة نقد؟', createdAt: '2026-10-01T04:00:00.000Z' },
    { id: 'sc4', platform: 'youtube', externalId: 'yt1', authorName: 'حسين', text: 'شنو مواصفات الغسالة؟', createdAt: '2026-10-01T05:00:00.000Z' },
  ],
  campaigns: [
    { id: 'camp-1', name: 'حملة الغسالات', goal: 'SALES', task: 'زيادة استفسارات الغسالة', platforms: ['facebook', 'instagram'], status: 'draft', products: [{ id: 'p1', name: 'غسالة LG' }], createdAt: '2026-10-01T00:00:00.000Z' },
  ],
  performanceRecords: [
    { id: 'perf1', platform: 'facebook', productCategory: 'appliances', ctaType: 'whatsapp', values: { reach: 5000, likes: 120, comments: 30, shares: 10 } },
  ],
};

// ---------------------------------------------------------------------------
// 1) الكتالوج من بيانات حقيقية + سلامة السعر والتقسيط
// ---------------------------------------------------------------------------
{
  const rules = approvedInstallmentRules(RAW.installmentPlans!);
  check('1-قاعدة تقسيط مشتقة من خطة حقيقية', rules.length === 1 && rules[0].durationMonths === 12 && rules[0].downPaymentPercent === 10);

  const catalog = buildCatalogFromWorkspace(RAW.products!, RAW.installmentPlans!, NOW);
  check('1-كل منتج حقيقي دخل الكتالوج', catalog.length === 3);
  const p1 = catalog.find((p) => p.id === 'p1')!;
  check('1-سعر الغسالة موثّق', p1.cashPrice.state === 'VERIFIED' && p1.cashPrice.value === 750000);
  check('1-توفر الغسالة موثّق', p1.availability.state === 'VERIFIED' && p1.availability.value?.inStock === true);
  check('1-قسط مشتق من قاعدة معتمدة', p1.installmentOffers.length === 1 && p1.installmentOffers[0].state === 'DERIVED');
  check('1-القسط لا يُخترع (مبلغ حقيقي محسوب)', typeof p1.installmentOffers[0].monthlyAmount === 'number' && p1.installmentOffers[0].monthlyAmount! > 0);

  const p2 = catalog.find((p) => p.id === 'p2')!;
  check('1-سعر صفري لا يُعتبر موثّقاً', p2.cashPrice.state !== 'VERIFIED');
  const p3 = catalog.find((p) => p.id === 'p3')!;
  check('1-منتج بلا سعر لا يحصل على قسط', p3.installmentOffers.length === 0);
  check('1-النقص مُعلن صراحةً', describeMissingInfo(p3).length > 0);
}

// ---------------------------------------------------------------------------
// 2) إشارات الطلب من تعليقات حقيقية (بلا استنتاج من نص)
// ---------------------------------------------------------------------------
{
  const interactions = buildInteractionsFromComments(RAW.socialComments!);
  check('2-كل تعليق حقيقي صار تفاعلاً', interactions.length === 4);
  check('2-المنتج لا يُستنتج من النص', interactions.every((i) => i.productId === null));

  const runtime = buildCommercialRuntime(RAW);
  check('2-إشارات الطلب تُبنى من التفاعل', runtime.demandSignals.length === 4);
  check('2-سؤال القسط صُنّف قسطاً', runtime.demandSignals.some((s) => s.kind === 'installment_inquiry'));
  check('2-سؤال السعر صُنّف سعراً', runtime.demandSignals.some((s) => s.kind === 'price_inquiry'));
  check('2-كل إشارة تحمل دليلاً', runtime.demandSignals.every((s) => s.source.length > 0 && s.externalId.length > 0));
}

// ---------------------------------------------------------------------------
// 3) مسار العميل: الاستفسار ليس بيعاً
// ---------------------------------------------------------------------------
{
  const journeys = buildJourneysFromWorkspace({ now: NOW, conversations: RAW.conversations, leads: RAW.leads, sales: RAW.sales, socialComments: RAW.socialComments });
  check('3-مسار لكل عميل حقيقي', journeys.length >= 4);

  const byKey = (k: string) => journeys.find((j) => j.subjectKey === k);
  const ahmed = byKey('name:أحمد') || journeys.find((j) => j.subjectKey.includes('أحمد'));
  check('3-عميل استفسر = إشارة شراء لا بيع', Boolean(ahmed) && !ahmed!.saleVerified);
  check('3-لا مشترٍ بلا سجل بيع', !ahmed!.saleVerified);

  const ali = journeys.find((j) => j.subjectKey === 'phone:0780');
  check('3-عميل له سجل بيع = بيع موثّق', Boolean(ali) && ali!.saleVerified === true);
  check('3-البيع يحمل معرّف بيع حقيقي', Boolean(ali) && ali!.evidence.some((e) => e.stage === 'VERIFIED_SALE' && e.verified));
}

// ---------------------------------------------------------------------------
// 4) الفرص: فصل معرفي + لا فرصة بلا عيّنة كافية
// ---------------------------------------------------------------------------
{
  const runtime = buildCommercialRuntime(RAW);
  check('4-كل فرصة تحترم الفصل المعرفي', runtime.opportunities.every((o) => o.fact.epistemic === 'FACT' && (!o.interpretation || o.interpretation.epistemic === 'INTERPRETATION') && o.recommendation.epistemic === 'RECOMMENDATION' && o.hypothesis.epistemic === 'HYPOTHESIS'));
  // الطلب بلا ربط منتج صريح ⇒ عيّنة غير كافية ⇒ لا تفسير مؤكّد (يُعلن النقص).
  check('4-لا تفسير بلا عيّنة كافية', runtime.opportunities.every((o) => o.sufficientSample || o.interpretation === null));
}

// ---------------------------------------------------------------------------
// 5) ROI من سجلات حقيقية فقط + الإيراد الموثّق
// ---------------------------------------------------------------------------
{
  const roi = buildRoiInput({ performanceRecords: RAW.performanceRecords, demandSignals: 4, leads: RAW.leads, sales: RAW.sales });
  check('5-الوصول من سجلات أداء حقيقية', roi.reach === 5000);
  check('5-التكلفة غير مسجّلة ⇒ غير متاحة', roi.campaignCost === null);
  check('5-البيع الموثّق = 1', roi.verifiedSales === 1);
  check('5-الإيراد = مجموع المبيعات الحقيقية', roi.revenue === 750000);
}

// ---------------------------------------------------------------------------
// 6) أدلة الاستدلال لكل منتج (لا تقدير)
// ---------------------------------------------------------------------------
{
  const runtime = buildCommercialRuntime(RAW);
  const ev = buildSalesEvidence({ catalog: runtime.catalog, demandSignals: runtime.demandSignals, sales: RAW.sales, leads: RAW.leads, campaigns: RAW.campaigns, records: RAW.performanceRecords });
  const p1 = ev.find((e) => e.productId === 'p1')!;
  check('6-سعر المنتج موثّق في الدليل', p1.priceVerified === true);
  check('6-توفر المنتج موثّق في الدليل', p1.availabilityVerified === true);
  check('6-بيع المنتج الحقيقي = 1', p1.verifiedSales === 1);
  const p3 = ev.find((e) => e.productId === 'p3')!;
  check('6-الوصول غير المتاح = null لا صفر', p3.reach === null);
}

// ---------------------------------------------------------------------------
// 7) الحملات: بنية تربط الهدف بالنتيجة (بلا اختراع)
// ---------------------------------------------------------------------------
{
  const campaigns = buildCampaignsFromWorkspace(RAW.campaigns!, NOW);
  check('7-الحملة الحقيقية صارت تعريف حملة', campaigns.length === 1 && campaigns[0].id === 'camp-1');
  check('7-الهدف محفوظ من السجل', campaigns[0].goal === 'SALES');
  check('7-لا نتيجة متوقعة مُختلقة', campaigns[0].expectedOutcome.measurable === false);
  check('7-لا مبيعات موثّقة بلا ربط', campaigns[0].verifiedSales === null);
}

// ---------------------------------------------------------------------------
// 8) الذاكرة التجارية: حقيقة ≠ استنتاج ≠ فرضية
// ---------------------------------------------------------------------------
{
  const runtime = buildCommercialRuntime(RAW);
  const seeds = buildCommercialMemorySeeds(runtime, NOW);
  check('8-سجلات الذاكرة التجارية مبنية', seeds.length > 0);
  check('8-كل سجل يحمل بادئة تجارية', seeds.every((s) => s.id.startsWith(COMMERCIAL_MEMORY_PREFIX)));
  check('8-البيع الموثّق يُخزَّن كحقيقة ملاحَظة', seeds.some((s) => s.id.startsWith(`${COMMERCIAL_MEMORY_PREFIX}sale:`) && s.origin === 'platform_data'));
  check('8-الفرضية لا تُخزَّن كحقيقة', seeds.filter((s) => s.id.startsWith(`${COMMERCIAL_MEMORY_PREFIX}hypothesis:`)).every((s) => s.origin === 'ai_statement'));

  const merged = mergeCommercialMemory(emptyBrainMemory(), seeds);
  check('8-الدمج بلا تكرار', merged.added === seeds.length);
  const again = mergeCommercialMemory(merged.store, seeds);
  check('8-الدمج الثاني لا يضيف مكرراً', again.added === 0);
  const summary = summarizeCommercialMemory(merged.store);
  check('8-الملخّص يفصل الأصناف', summary.total === seeds.length && summary.observedFacts >= 1);
}

// ---------------------------------------------------------------------------
// 9) الحالة الكاملة لا تنهار على بيانات فارغة (صفر صادق)
// ---------------------------------------------------------------------------
{
  const runtime = buildCommercialRuntime({ now: NOW });
  check('9-بيانات فارغة ⇒ كتالوج فارغ', runtime.catalog.length === 0);
  check('9-بيانات فارغة ⇒ صفر إشارات', runtime.demandSignals.length === 0);
  check('9-بيانات فارغة ⇒ لا فرص', runtime.opportunities.length === 0);
  check('9-الحالة لا تنهار', typeof runtime.foundation === 'object');
  check('9-التقرير يعلن فجوات الجاهزية', Array.isArray(runtime.foundation.readinessGaps));
}

// ---------------------------------------------------------------------------
// 10) لا اتصال شبكي ولا Gemini في طبقة الربط
// ---------------------------------------------------------------------------
{
  const runtime = buildCommercialRuntime(RAW);
  check('10-لا مزوّد AI في المخرج', !JSON.stringify(runtime).includes('gemini'));
  check('10-المصادر معلنة في المخرج', runtime.foundation.limitations.length > 0);
}

console.log(`PASSED: ${passed} Sales & Growth integration checks`);
