/**
 * اختبار أساس العقل التجاري (Sales & Growth Foundation) — منطق خالص.
 *
 * يثبت أن طبقة التحضير: تمثّل السعر النقدي/التقسيط بأمان، تفرّق بين المرحلة
 * والبيع الموثّق، تُحوّل التفاعل إلى إشارات طلب، تبني الفرص بفصل معرفي صريح،
 * لا تخترع ROI، وتحمل حملة بفرضية ونتيجة متوقعة — **بلا أي اختراع تجاري**.
 *
 * تشغيل: npx tsx engine/tests/brain/sales.foundation.test.ts
 */

import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

import {
  verifiedField, deriveInstallmentOffer, findInstallmentOffer, canAnswerCashPrice,
  canAnswerInstallment, canAnswerAvailability, describeMissingInfo, catalogReadiness,
  catalogProductFromWorkspace, catalogIsUsable, MISSING_INFO_PHRASES_AR, type CatalogProduct,
} from '../../brain/knowledge/catalog';
import {
  toDemandSignal, aggregateDemandSignals, summarizeDemand, DEMAND_MIN_SAMPLE,
} from '../../brain/market/demandSignals';
import {
  buildOpportunityFromDemand, summarizeOpportunities, validateEpistemicSeparation, EPISTEMIC_LABELS_AR,
} from '../../brain/market/opportunityEngine';
import {
  newJourneyState, stageFromInteraction, advanceJourney, promoteToLead, promoteToRequest,
  verifySale, isConfirmedBuyer, summarizeJourneys,
} from '../../brain/sales/journey';
import { reasonAboutSales } from '../../brain/sales/salesReasoning';
import { buildRoiReport } from '../../brain/sales/roi';
import { buildCampaignDraft, campaignCompleteness, recordCampaignOutcome, attachCampaignResults } from '../../brain/sales/campaignIntelligence';
import { buildSalesGrowthFoundation } from '../../brain/sales/salesGrowth';
import { classifyConversation } from '../../brain/audience/conversationIntelligence';

let passed = 0;
const check = (name: string, cond: boolean) => {
  assert.ok(cond, `FAIL: ${name}`);
  passed += 1;
};

const NOW = Date.parse('2026-10-02T10:00:00.000Z');

// ---------------------------------------------------------------------------
// 1) مخزن المنتجات: لا سعر ولا قسط ولا توفر يُخترع
// ---------------------------------------------------------------------------
{
  const missing = verifiedField<number>({ value: null, source: null, missingState: 'NEEDS_UPDATE' });
  check('1-حقل غائب لا يُخترع', missing.value === null && missing.state === 'NEEDS_UPDATE');

  const price = verifiedField<number>({ value: 500000, source: 'owner_recorded', lastVerifiedAt: '2026-09-01T00:00:00.000Z' });
  check('1-سعر مسجّل = موثّق', price.state === 'VERIFIED' && price.value === 500000);

  // لا اشتقاق تقسيط بلا سعر موثّق.
  const noPriceOffer = deriveInstallmentOffer({ cashPrice: missing, rule: { durationMonths: 12, downPaymentPercent: 10 }, source: 'rule', now: NOW });
  check('1-لا قسط بلا سعر موثّق', noPriceOffer.state === 'NEEDS_UPDATE' && noPriceOffer.monthlyAmount === null);

  // الاشتقاق من سعر موثّق + قاعدة معتمدة = DERIVED صراحةً.
  const offer = deriveInstallmentOffer({ cashPrice: price, rule: { durationMonths: 12, downPaymentPercent: 10 }, source: 'approved_rule', now: NOW });
  check('1-اشتقاق القسط = DERIVED', offer.state === 'DERIVED' && typeof offer.monthlyAmount === 'number');
  check('1-الدفعة الأولى صحيحة', offer.downPaymentAmount === 50000 && offer.downPaymentPercent === 10);
  check('1-إجمالي الأقساط = القسط×الأشهر', offer.totalInstallments === (offer.monthlyAmount as number) * 12);

  // لا سعر ⇒ العبارة المعتمدة بدل رقم.
  check('1-عبارة السعر تحتاج تحديث', canAnswerCashPrice({ cashPrice: missing } as CatalogProduct).phrase === MISSING_INFO_PHRASES_AR.priceNeedsUpdate);

  const product: CatalogProduct = {
    id: 'p1', name: 'غسالة', category: 'appliances', brand: null, model: null, description: null,
    specs: [], attributes: {}, images: [],
    cashPrice: price,
    availability: verifiedField({ value: null, source: null, missingState: 'UNKNOWN' }),
    installmentOffers: [offer], relatedProductIds: [], alternativeProductIds: [], supplier: null,
    ownerApproval: 'approved', source: 'owner_recorded', lastVerifiedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  };
  check('1-إجابة القسط لمدة موجودة', canAnswerInstallment(product, 12).answerable === true);
  check('1-لا إجابة قسط لمدة غير موثّقة', canAnswerInstallment(product, 24).answerable === false);
  check('1-التوفر يحتاج تحقق', canAnswerAvailability(product).phrase === MISSING_INFO_PHRASES_AR.availabilityNeedsCheck);
  check('1-وصف النقص يذكر التوفر', describeMissingInfo(product).some((m) => m.includes('التوفر')));

  // إسقاط منتج مسجّل: سعر+توفر يُوسَمان VERIFIED، والتقسيط يبقى غير موثّق.
  const projected = catalogProductFromWorkspace({ id: 'w1', name: 'هاتف', cashPrice: 300000, inStock: true, stockQuantity: 5, updatedAt: '2026-09-15T00:00:00.000Z' }, NOW);
  check('1-إسقاط: السعر موثّق', projected.cashPrice.state === 'VERIFIED' && projected.cashPrice.value === 300000);
  check('1-إسقاط: التوفر موثّق', projected.availability.state === 'VERIFIED' && projected.availability.value?.inStock === true);
  check('1-إسقاط: التقسيط غير موثّق', projected.installmentOffers.length === 0 && canAnswerInstallment(projected, 12).answerable === false);

  const unusable = catalogIsUsable([]);
  check('1-مخزن فارغ غير صالح', unusable.usable === false);
  // المنتج المُسقط يبدأ `pending` (لا اعتماد تلقائي) ⇒ لا يُستخدم تجارياً بعد.
  check('1-الإسقاط لا يُعتمد تلقائياً', projected.ownerApproval === 'pending' && catalogIsUsable([projected]).usable === false);
  const approved = { ...projected, ownerApproval: 'approved' as const };
  check('1-منتج معتمد بسعر موثّق صالح', catalogIsUsable([approved]).usable === true);
}

// ---------------------------------------------------------------------------
// 2) مسار العميل: لا خلط بين الاستفسار والبيع
// ---------------------------------------------------------------------------
{
  const state = newJourneyState({ subjectKey: 'c1', platform: 'facebook', now: NOW });
  check('2-يبدأ مشاهدة بلا بيع', state.stage === 'VIEW' && isConfirmedBuyer(state) === false);

  const inquiry = stageFromInteraction({ platform: 'facebook', category: 'question', isBusinessInquiry: false });
  check('2-سؤال ⇒ استفسار', inquiry.stage === 'INQUIRY');

  const intent = stageFromInteraction({ platform: 'facebook', category: 'purchase_intent', isBusinessInquiry: true });
  check('2-استفسار أعمال ⇒ إشارة شراء', intent.stage === 'PURCHASE_SIGNAL');

  let s = advanceJourney(state, inquiry, NOW);
  s = advanceJourney(s, intent, NOW);
  check('2-الترقية للأعلى فقط', s.stage === 'PURCHASE_SIGNAL');
  check('2-«شكد القسط» ليست بيعاً', isConfirmedBuyer(s) === false);

  // محاولة إعلان بيع بلا مصدر تُرفض.
  const noSource = verifySale(s, { source: 'نص تعليق', reason: 'أريد وحدة', saleId: null }, NOW);
  check('2-لا بيع بلا معرّف', noSource.saleVerified === false && isConfirmedBuyer(noSource) === false);

  // بيع بمصدر موثوق فقط.
  const sale = verifySale(promoteToRequest(promoteToLead(s, { source: 'crm', reason: 'عميل مسجّل' }, NOW), { source: 'crm', reason: 'طلب مسجّل' }, NOW), { source: 'sales_ledger', reason: 'عملية بيع', saleId: 'sale-1' }, NOW);
  check('2-بيع موثّق بمصدر', sale.saleVerified === true && isConfirmedBuyer(sale) === true);
  check('2-ملخّص المسار يفصل البيع', summarizeJourneys([s, sale]).confirmedSales === 1);
}

// ---------------------------------------------------------------------------
// 3) إشارات الطلب
// ---------------------------------------------------------------------------
{
  const priceSignal = toDemandSignal({ platform: 'youtube', externalId: 'e1', text: 'شكد سعر الغسالة؟' });
  check('3-سؤال سعر ⇒ استفسار سعر', priceSignal.kind === 'price_inquiry');

  const inst = toDemandSignal({ platform: 'youtube', externalId: 'e2', text: 'شكد القسط عالغسالة؟' });
  check('3-سؤال قسط ⇒ استفسار تقسيط', inst.kind === 'installment_inquiry');

  const request = toDemandSignal({ platform: 'facebook', externalId: 'e3', text: 'نريد خدمة التوصيل للمنازل' });
  check('3-طلب ميزة ⇒ طلب منتج', request.kind === 'product_request');

  const objection = toDemandSignal({ platform: 'facebook', externalId: 'e4', text: 'غالي شوية' });
  check('3-اعتراض ⇒ اعتراض', objection.kind === 'objection');

  // أقل من الحد ⇒ بيانات غير كافية.
  const few = aggregateDemandSignals({ signals: [priceSignal, priceSignal] });
  check('3-عيّنة ناقصة لا تُعلن طلباً', few.every((a) => a.strength === 'INSUFFICIENT_DATA'));

  // بلوغ الحد ⇒ طلب معلن.
  const many = aggregateDemandSignals({ signals: Array.from({ length: DEMAND_MIN_SAMPLE + 1 }, (_, i) => toDemandSignal({ platform: 'youtube', externalId: `p${i}`, text: 'شكد السعر؟', at: `2026-09-${String(10 + i).padStart(2, '0')}T00:00:00.000Z` })) });
  check('3-بلوغ الحد يُعلن طلباً', many[0].count === DEMAND_MIN_SAMPLE + 1 && many[0].strength !== 'INSUFFICIENT_DATA');
  check('3-الفترة محسوبة من الطوابع', many[0].periodDays !== null);
  const summary = summarizeDemand(many);
  check('3-ملخّص يفصل الكافي من غيره', summary.total === DEMAND_MIN_SAMPLE + 1 && summary.insufficient === 0);
}

// ---------------------------------------------------------------------------
// 4) الفرص: فصل معرفي صريح
// ---------------------------------------------------------------------------
{
  const signals = Array.from({ length: 4 }, (_, i) => toDemandSignal({ platform: 'youtube', externalId: `x${i}`, text: 'شكد سعر الغسالة؟', at: `2026-09-1${i}T00:00:00.000Z` }));
  const [agg] = aggregateDemandSignals({ signals });
  const opp = buildOpportunityFromDemand({ aggregate: agg, platform: 'youtube' });
  check('4-حقيقة موسومة FACT', opp.fact.epistemic === 'FACT');
  check('4-فرضية موسومة HYPOTHESIS', opp.hypothesis.epistemic === 'HYPOTHESIS');
  check('4-توصية موسومة RECOMMENDATION', opp.recommendation.epistemic === 'RECOMMENDATION');
  check('4-فصل معرفي صالح', validateEpistemicSeparation(opp).valid === true);
  check('4-العيّنة الكافية تُعلن', opp.sufficientSample === true);
  check('4-السعر يحتاج تدخّل المالك', opp.requiresOwnerAction === true);
  check('4-نتيجة متوقعة قابلة للقياس', typeof opp.expectedMeasurableOutcome === 'string' && opp.expectedMeasurableOutcome.length > 0);

  // فرصة بعيّنة ناقصة: لا تفسير.
  const [aggFew] = aggregateDemandSignals({ signals: signals.slice(0, 2) });
  const oppFew = buildOpportunityFromDemand({ aggregate: aggFew, platform: 'youtube' });
  check('4-عيّنة ناقصة بلا تفسير', oppFew.interpretation === null && validateEpistemicSeparation(oppFew).valid === true);

  const sum = summarizeOpportunities([opp, oppFew]);
  check('4-ملخّص يفصل الكافي', sum.sufficient === 1 && sum.insufficient === 1);
  check('4-تسميات الفصل المعرفي موجودة', EPISTEMIC_LABELS_AR.FACT.length > 0);
}

// ---------------------------------------------------------------------------
// 5) الاستدلال التجاري: لا حكم بلا دليل
// ---------------------------------------------------------------------------
{
  const report = reasonAboutSales({
    productId: 'p1', productName: 'غسالة',
    priceVerified: false, availabilityVerified: false, inStock: null, installmentVerified: false,
    contentCount: 0, demandSignals: 0, qualifiedInquiries: 0, objections: 0, hasCta: false,
    reach: null, leads: 0, verifiedSales: 0, competitorMentions: 0,
  });
  check('5-المعلومة الناقصة سبب مدعوم', report.supportedBlockers.some((b) => b.blocker === 'missing_information'));
  check('5-المجهول معلن', report.unknownBlockers.length > 0 && report.whatWeDontKnow.length > 0);
  check('5-إجراءات المالك معلنة', report.ownerActions.length > 0);

  // منتج موثّق تماماً بلا أي إشارة طلب: لا سبب مدعوم ⇒ لا حكم.
  const noEvidence = reasonAboutSales({
    productId: 'p3', productName: 'ثلاجة',
    priceVerified: true, availabilityVerified: true, inStock: true, installmentVerified: true,
    contentCount: 4, demandSignals: 0, qualifiedInquiries: 0, objections: 0, hasCta: true,
    reach: null, leads: 0, verifiedSales: 0, competitorMentions: 0,
  });
  check('5-لا حكم بلا أدلة', noEvidence.verdictAvailable === false);

  const strong = reasonAboutSales({
    productId: 'p2', productName: 'هاتف',
    priceVerified: true, availabilityVerified: true, inStock: true, installmentVerified: true,
    contentCount: 5, demandSignals: 20, qualifiedInquiries: 8, objections: 5, hasCta: true,
    reach: 50000, leads: 3, verifiedSales: 1, competitorMentions: 4,
  });
  check('5-معلومة موثّقة ليست سبباً', !strong.supportedBlockers.some((b) => b.blocker === 'missing_information'));
  check('5-اعتراض متكرر مدعوم', strong.supportedBlockers.some((b) => b.blocker === 'repeated_objection'));
  check('5-حكم متاح عند وجود أدلة', strong.verdictAvailable === true);
}

// ---------------------------------------------------------------------------
// 6) ROI: لا اختراع مالي
// ---------------------------------------------------------------------------
{
  const report = buildRoiReport({
    reach: 10000, engagement: 500, inquiries: 50, leads: 10, requests: 4,
    verifiedSales: 2, revenue: 1000000, campaignCost: 100000,
  });
  check('6-تكلفة العميل متاحة', report.costPerLead.state === 'AVAILABLE' && report.costPerLead.value === 10000);
  check('6-تكلفة البيع متاحة', report.costPerSale.value === 50000);
  check('6-العائد على التكلفة', report.roas.value === 10);
  check('6-نسبة التحويل محسوبة', report.conversionRates.some((m) => m.key === 'inquiry_rate' && m.state === 'AVAILABLE'));

  const sparse = buildRoiReport({ reach: null, engagement: null, inquiries: null, leads: null, requests: null, verifiedSales: null, revenue: null, campaignCost: null });
  check('6-الغياب غير متاح لا صفر', sparse.metrics.every((m) => m.value === null && m.state === 'NOT_AVAILABLE'));
  check('6-لا تكلفة بلا بيانات', sparse.costPerLead.state === 'NOT_AVAILABLE' && sparse.costPerSale.state === 'NOT_AVAILABLE');
  check('6-لا عائد بلا تكلفة', sparse.roas.state === 'NOT_AVAILABLE');
  check('6-فجوات البيانات معلنة', sparse.dataGaps.length >= 5);
}

// ---------------------------------------------------------------------------
// 7) الحملات: لماذا نشغّلها + نتيجة متوقعة
// ---------------------------------------------------------------------------
{
  const draft = buildCampaignDraft({
    id: 'c1', objective: 'رفع استفسارات التقسيط للغسالات', goal: 'SALES', productId: 'p1', productName: 'غسالة',
    hypothesis: 'شرح التقسيط يرفع الاستفسارات', message: 'تقسيط مريح', cta: 'اتصل بنا',
    platforms: ['youtube'], expectedOutcome: { metric: 'inquiries', labelAr: 'استفسارات', measurable: true },
    createdBy: 'owner', now: NOW,
  });
  check('7-حملة مكتملة التعريف', campaignCompleteness(draft).complete === true);
  check('7-لا نتيجة مُختلقة مبدئياً', draft.actualOutcome.value === null && draft.verifiedSales === null);

  const incomplete = buildCampaignDraft({
    id: 'c2', objective: '', goal: 'SALES', hypothesis: '', message: '', cta: '', platforms: [],
    expectedOutcome: { metric: '', labelAr: '', measurable: false }, createdBy: 'owner', now: NOW,
  });
  check('7-حملة ناقصة تُكشف', campaignCompleteness(incomplete).complete === false && campaignCompleteness(incomplete).missing.length >= 4);

  // لا نتيجة بلا مصدر.
  const rejected = recordCampaignOutcome(draft, { metric: 'inquiries', value: 50, source: null, now: NOW });
  check('7-لا نتيجة بلا مصدر', rejected.recorded === false);
  const recorded = recordCampaignOutcome(draft, { metric: 'inquiries', value: 50, source: 'socialComments', now: NOW });
  check('7-نتيجة بمصدر تُسجّل', recorded.recorded === true && recorded.campaign.actualOutcome.value === 50);

  const attached = attachCampaignResults(draft, { leads: 5, verifiedSales: 2, revenue: 800000, cost: 50000, now: NOW });
  check('7-نتائج حقيقية تُربط', attached.verifiedSales === 2 && attached.status === 'planned');
}

// ---------------------------------------------------------------------------
// 8) الطبقة الجامعة: تقرير الأساس + فجوات الجاهزية
// ---------------------------------------------------------------------------
{
  const classified = classifyConversation({ platform: 'youtube', externalId: 'i1', text: 'شكد القسط؟' });
  const interactions = Array.from({ length: 5 }, (_, i) => ({
    platform: 'youtube' as const, externalId: `i${i}`, text: 'شكد القسط؟', at: `2026-09-1${i}T00:00:00.000Z`, productId: 'p1',
    classification: classifyConversation({ platform: 'youtube', externalId: `i${i}`, text: 'شكد القسط؟' }),
  }));
  const report = buildSalesGrowthFoundation({
    now: NOW, platforms: ['youtube'], catalog: [], interactions,
    journeys: [], salesEvidence: [], campaigns: [],
    roi: { reach: null, engagement: null, inquiries: null, leads: null, requests: null, verifiedSales: null, revenue: null, campaignCost: null },
  });
  check('8-التقرير يُبنى', report.generatedAt.length > 0);
  check('8-إشارات الطلب محسوبة', report.demand.total > 0);
  check('8-الفرص تفصل معرفياً', report.epistemicAudit.checked === report.epistemicAudit.valid);
  check('8-فجوات الجاهزية معلنة', report.readinessGaps.length >= 2);
  check('8-مخزن فارغ معلن', report.catalog.total === 0);
  check('8-لا تفسير بلا مصدر (كل فرصة لها مصدر)', report.opportunities.every((o) => o.source.length > 0));
  void classified;
}

console.log(`\nPASSED: ${passed} Sales & Growth foundation checks`);
