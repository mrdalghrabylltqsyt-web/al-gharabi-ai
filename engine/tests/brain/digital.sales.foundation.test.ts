/**
 * اختبار وحدة العقل المركزي للمبيعات الرقمية — منطق خالص.
 *
 * يثبت: لا سعر/قسط/توفر مُخترع؛ لا بيع بلا معرّف؛ لا قسط بلا سعر موثّق + قاعدة
 * معتمدة؛ لا إسناد سببية عند الشك؛ القُمع لا يقسم على صفر؛ المتابعة تحترم الموافقة/
 * الإلغاء/منع السبام؛ التسليم البشري لا يخترع رداً؛ الأحداث تُنقّى من البيانات
 * الشخصية؛ الاستقلالية الافتراضية آمنة.
 *
 * تشغيل: npx tsx engine/tests/brain/digital.sales.foundation.test.ts
 */

import assert from 'node:assert';

import {
  identifyProduct, classifyOfferQuestion, answerProductQuestion, checkOfferMutation,
} from '../../brain/digital/offer';
import {
  qualifyLead, createLeadFromSignal, planLeadTransition, classifyLostReason, LEAD_STAGE_LABELS_AR,
} from '../../brain/digital/lead';
import { detectPurchaseIntent } from '../../brain/digital/intent';
import { buildCustomerIdentity, privacyCustomerHash, platformIdentityKey } from '../../brain/digital/identity';
import { shouldHandoff, buildHumanHandoff } from '../../brain/digital/handoff';
import { planFollowUp, isDuplicateFollowUp, applyConsentUpdate, DEFAULT_FOLLOW_UP_POLICY } from '../../brain/digital/followup';
import { computeAttribution } from '../../brain/digital/attribution';
import { recordSalesEvent, stripSensitiveEventFields, summarizeSalesEvents } from '../../brain/digital/events';
import { buildDigitalSalesFunnel } from '../../brain/digital/salesFunnel';
import { evaluateAutonomy, NEVER_SILENT_ACTIONS, defaultGrantedLevel } from '../../brain/digital/autonomy';
import { assertAdapterBoundary, FORBIDDEN_ADAPTER_RESPONSIBILITIES } from '../../brain/digital/adapters';
import {
  normalizeDigitalSalesStore, updateConsentByHash, getConsentByHash, guardDuplicateFollowUp, recordFollowUp,
} from '../../brain/digital/store';
import { buildDigitalSalesState } from '../../brain/digital/runtime';
import { buildCatalogFromWorkspace } from '../../brain/sales/commercialRuntime';

let passed = 0;
const check = (name: string, cond: boolean) => {
  assert.ok(cond, `FAIL: ${name}`);
  passed += 1;
};

const NOW = Date.parse('2026-10-02T10:00:00.000Z');

function catalogWith(products: any[], plans: any[] = []) {
  return buildCatalogFromWorkspace(products, plans, NOW);
}

// ---------------------------------------------------------------------------
// 1) عرض المنتج: لا اختراع سعر/قسط/توفر
// ---------------------------------------------------------------------------
{
  const [washer] = catalogWith([{ id: 'p1', name: 'غسالة سامسونغ', category: 'appliances', cashPrice: 600000, inStock: true, stockQuantity: 4, durationMonths: 12, downPaymentPercent: 10, specs: ['سعة 8 كغم'] }]);
  check('1-الكتالوج مبني مع سعر موثّق', washer.cashPrice.state === 'VERIFIED');

  const cash = answerProductQuestion({ text: 'شكد سعر الغسالة؟', products: [washer], nowMs: NOW });
  check('1-إجابة السعر من بيانات موثّقة', cash.state === 'ANSWERED' && cash.answerText.includes('600,000'));

  const inst = answerProductQuestion({ text: 'شكد القسط؟', products: [washer], explicitProductId: 'p1', installmentMonths: 12, nowMs: NOW });
  check('1-إجابة القسط مشتقّة من سعر موثّق + قاعدة', inst.state === 'ANSWERED' && inst.answerText.includes('شهرياً'));

  const av = answerProductQuestion({ text: 'متوفرة؟', products: [washer], explicitProductId: 'p1', nowMs: NOW });
  check('1-إجابة التوفر موثّقة', av.state === 'ANSWERED' && av.answerText.includes('متوفر'));

  // منتج بلا سعر موثّق ⇒ لا إجابة مُخترعة
  const [noPrice] = catalogWith([{ id: 'p2', name: 'ثلاجة بلا سعر', category: 'appliances', cashPrice: 0, inStock: false }]);
  const missing = answerProductQuestion({ text: 'شكد سعر الثلاجة؟', products: [noPrice], nowMs: NOW });
  check('1-بلا سعر موثّق ⇒ DATA_NOT_AVAILABLE بلا اختراع', missing.state === 'DATA_NOT_AVAILABLE' && missing.needsHuman);

  const missingInst = answerProductQuestion({ text: 'قسط الثلاجة؟', products: [noPrice], nowMs: NOW });
  check('1-بلا سعر موثّق ⇒ لا قسط مُخترع', missingInst.state === 'DATA_NOT_AVAILABLE' && missingInst.missing.includes('cash_price'));

  const unknown = answerProductQuestion({ text: 'شكد سعر شيء غير معروف؟', products: [washer], nowMs: NOW });
  check('1-منتج غير محدّد ⇒ PRODUCT_NOT_IDENTIFIED', unknown.state === 'PRODUCT_NOT_IDENTIFIED');
}

// ---------------------------------------------------------------------------
// 2) تحديد المنتج والتصنيف
// ---------------------------------------------------------------------------
{
  const products = catalogWith([{ id: 'p1', name: 'غسالة سامسونغ', category: 'appliances', cashPrice: 600000, inStock: true, durationMonths: 12, downPaymentPercent: 10 }]);
  const id = identifyProduct({ text: 'عندكم غسالة سامسونغ؟', products });
  check('2-تحديد المنتج بالاسم', id.identified && id.productId === 'p1');
  const explicit = identifyProduct({ text: 'أي شيء', products, explicitProductId: 'p1' });
  check('2-المرجع الصريح يُقدَّم', explicit.identified && explicit.confidence === 'exact');
  const none = identifyProduct({ text: 'شيء لا يشبه شيئاً', products });
  check('2-لا مطابقة ⇒ غير محدّد', !none.identified && none.confidence === 'none');

  check('2-تصنيف سؤال السعر', classifyOfferQuestion('كم السعر؟') === 'cash_price');
  check('2-تصنيف سؤال القسط', classifyOfferQuestion('شكد القسط؟') === 'installment');
  check('2-تصنيف سؤال التوفر', classifyOfferQuestion('متوفر؟') === 'availability');
}

// ---------------------------------------------------------------------------
// 3) حرس تغيير العرض التجاري
// ---------------------------------------------------------------------------
{
  const blocked = checkOfferMutation({ proposedFields: ['price', 'discount'] });
  check('3-لا تغيير سعر/خصم بلا قاعدة معتمدة', !blocked.allowed && blocked.violations.includes('price'));
  const allowed = checkOfferMutation({ proposedFields: ['price'], approvedRuleAllows: ['price'] });
  check('3-التغيير بقاعدة معتمدة مسموح', allowed.allowed);
}

// ---------------------------------------------------------------------------
// 4) نية الشراء
// ---------------------------------------------------------------------------
{
  const intent = detectPurchaseIntent({ platform: 'facebook' as any, externalId: 'x1', text: 'أريد وحدة غسالة وشكد القسط؟', classification: null, productRef: { productId: 'p1', verified: true }, priorProductQuestions: 1, nowMs: NOW });
  check('4-إشارة شراء مؤكّدة', intent.state === 'PURCHASE_SIGNAL');
  check('4-أدلة الإشارة موجودة', intent.evidence.length > 0);
  const noSignal = detectPurchaseIntent({ platform: 'facebook' as any, externalId: 'x2', text: 'صباح الخير', classification: null, productRef: null, priorProductQuestions: 0, nowMs: NOW });
  check('4-بلا إشارة شراء', noSignal.state !== 'PURCHASE_SIGNAL');
}

// ---------------------------------------------------------------------------
// 5) الهوية والخصوصية
// ---------------------------------------------------------------------------
{
  const id = buildCustomerIdentity({ platform: 'facebook' as any, platformCustomerId: 'c-99', phone: null, conversationId: 'conv-1', refs: {} });
  check('5-معرّف منصة موثوق ⇒ confidence strong', id.confidence === 'strong');
  const weak = buildCustomerIdentity({ platform: 'facebook' as any, platformCustomerId: null, phone: null, conversationId: 'conv-2', refs: {} });
  check('5-بلا معرّف موثوق ⇒ weak', weak.confidence === 'weak');
  check('5-مفتاح المعرّف = platform:id', platformIdentityKey('facebook', 'c-99') === 'facebook:c-99');
  const h1 = privacyCustomerHash('phone:07711111111');
  const h2 = privacyCustomerHash('phone:07711111111');
  check('5-بصمة العميل ثابتة', h1 === h2 && h1!.startsWith('k_'));
  check('5-البصمة لا تحمل الرقم الخام', !h1!.includes('07711111111'));
}

// ---------------------------------------------------------------------------
// 6) التأهيل: لا تأهيل بلا إشارة شراء
// ---------------------------------------------------------------------------
{
  const noSignal = qualifyLead({ purchaseSignal: false, productIdentified: true, priceRequested: true, availabilityRequested: true, installmentRequested: true, buyingTimeframe: true, requestToPurchase: true, reliableIdentity: true, conversationProgressed: true });
  check('6-لا تأهيل بلا إشارة شراء', noSignal.outcome === 'NOT_ENOUGH_EVIDENCE');
  const qualified = qualifyLead({ purchaseSignal: true, productIdentified: true, priceRequested: true, availabilityRequested: false, installmentRequested: true, buyingTimeframe: false, requestToPurchase: true, reliableIdentity: true, conversationProgressed: true });
  check('6-أدلة كافية ⇒ مؤهّل', qualified.outcome === 'QUALIFIED' && qualified.score >= 45);
  const weak = qualifyLead({ purchaseSignal: true, productIdentified: false, priceRequested: false, availabilityRequested: false, installmentRequested: false, buyingTimeframe: false, requestToPurchase: false, reliableIdentity: false, conversationProgressed: false });
  check('6-إشارة بلا منتج/طلب ⇒ مراجعة بشرية', weak.outcome === 'NEEDS_HUMAN_REVIEW');
}

// ---------------------------------------------------------------------------
// 7) دورة حياة العميل: لا بيع بلا معرّف، ولا نقض حالة نهائية
// ---------------------------------------------------------------------------
{
  const created = createLeadFromSignal({ leadId: 'L1', platform: 'facebook' as any, customerKey: 'k_1', productId: 'p1', purchaseSignal: true, evidence: ['wants_one'], reason: 'إشارة', nowMs: NOW });
  check('7-إنشاء عميل من إشارة شراء', created.ok);
  const lead = (created as any).lead;
  const illegal = planLeadTransition({ lead, to: 'VERIFIED_SALE', evidence: ['x'], reason: 'x', source: 'test', nowMs: NOW });
  check('7-لا بيع بلا معرّف بيع', !illegal.ok && (illegal as any).code === 'NO_SALE_ID');
  const toQualified = planLeadTransition({ lead, to: 'QUALIFIED_LEAD', evidence: ['q'], reason: 'مؤهّل', source: 'test', nowMs: NOW });
  check('7-انتقال مبرّر مسموح', toQualified.ok);
  const noEvidence = planLeadTransition({ lead, to: 'QUALIFIED_LEAD', evidence: [], reason: 'x', source: 'test', nowMs: NOW });
  check('7-لا انتقال بلا دليل', !noEvidence.ok && (noEvidence as any).code === 'NO_EVIDENCE');
  const noSignal = createLeadFromSignal({ leadId: 'L2', platform: 'facebook' as any, customerKey: 'k_2', productId: null, purchaseSignal: false, evidence: ['x'], reason: 'x', nowMs: NOW });
  check('7-لا عميل بلا إشارة شراء', !noSignal.ok);

  const terminal = { ...lead, stage: 'VERIFIED_SALE' as const, history: lead.history };
  const reopen = planLeadTransition({ lead: terminal, to: 'NEGOTIATION', evidence: ['x'], reason: 'x', source: 'test', nowMs: NOW });
  check('7-الحالة النهائية لا تُنقض', !reopen.ok && (reopen as any).code === 'TERMINAL_STATE');
}

// ---------------------------------------------------------------------------
// 8) أسباب الخسارة من دليل فقط
// ---------------------------------------------------------------------------
{
  const price = classifyLostReason({ evidenceCodes: ['price_objection'], hadFollowUp: true, customerResponded: true });
  check('8-سبب مقاومة سعرية من دليل', price.reason === 'price_resistance');
  const unknown = classifyLostReason({ evidenceCodes: [], hadFollowUp: true, customerResponded: true });
  check('8-بلا دليل ⇒ سبب غير معروف (لا اختراع)', unknown.reason === 'unknown');
}

// ---------------------------------------------------------------------------
// 9) التسليم البشري لا يخترع رداً
// ---------------------------------------------------------------------------
{
  const d = shouldHandoff({ answerState: 'DATA_NOT_AVAILABLE', productIdentityClear: true, mentionsDiscount: false, mentionsNegotiation: false, isComplaint: false, conflictingData: false });
  check('9-بيانات ناقصة ⇒ تسليم بشري', d.handoff && d.reason === 'insufficient_evidence');
  const discount = shouldHandoff({ answerState: 'ANSWERED', productIdentityClear: true, mentionsDiscount: true, mentionsNegotiation: false, isComplaint: false, conflictingData: false });
  check('9-طلب خصم ⇒ تسليم بشري', discount.handoff && discount.reason === 'discount_request');
  const h = buildHumanHandoff({ reason: 'missing_price', evidence: ['cashPrice.state=UNKNOWN'], context: { platform: 'facebook' as any, conversationId: 'c1', leadId: null, productId: 'p1', snippet: 'شكد السعر' }, nowMs: NOW });
  check('9-التسليم لا يخترع رداً', h.fabricatedFallback === false && Boolean(h.recommendedAction));
}

// ---------------------------------------------------------------------------
// 10) المتابعة: موافقة/إلغاء/حدود/منع سبام
// ---------------------------------------------------------------------------
{
  const base = { askedAboutProductNoPurchase: true, productId: 'p1', purchaseSignal: true, priorFollowUps: 0, lastFollowUpAt: null, followUpsLast30Days: 0, nowMs: NOW };
  const noConsent = planFollowUp({ ...base, policy: { ...DEFAULT_FOLLOW_UP_POLICY, consent: false } });
  check('10-بلا موافقة ⇒ لا متابعة', noConsent.state === 'NOT_ELIGIBLE' && noConsent.blockers.some((b) => b.includes('موافقة')));
  const optedOut = planFollowUp({ ...base, policy: { ...DEFAULT_FOLLOW_UP_POLICY, consent: true, optedOut: true } });
  check('10-إلغاء ⇒ لا متابعة', optedOut.state === 'NOT_ELIGIBLE' && optedOut.blockers.some((b) => b.includes('opt-out')));
  const ok = planFollowUp({ ...base, policy: { ...DEFAULT_FOLLOW_UP_POLICY, consent: true } });
  check('10-موافقة + حدود ⇒ فرصة متابعة', ok.state === 'FOLLOW_UP_OPPORTUNITY');
  const tooMany = planFollowUp({ ...base, priorFollowUps: 5, policy: { ...DEFAULT_FOLLOW_UP_POLICY, consent: true } });
  check('10-تجاوز الحد ⇒ لا متابعة', tooMany.state === 'NOT_ELIGIBLE');
  const spam = planFollowUp({ ...base, followUpsLast30Days: 9, policy: { ...DEFAULT_FOLLOW_UP_POLICY, consent: true } });
  check('10-حدّ 30 يوماً ⇒ منع سبام', spam.state === 'NOT_ELIGIBLE');
  const recent = planFollowUp({ ...base, lastFollowUpAt: new Date(NOW - 86400000).toISOString(), policy: { ...DEFAULT_FOLLOW_UP_POLICY, consent: true, minDaysBetween: 3 } });
  check('10-الفاصل الأدنى محترم', recent.state === 'NOT_ELIGIBLE');

  const dup = isDuplicateFollowUp({ customerKey: 'k_1', productId: 'p1', recent: [{ customerKey: 'k_1', productId: 'p1', at: new Date(NOW - 86400000).toISOString() }], nowMs: NOW });
  check('10-منع تكرار نفس المتابعة', dup.duplicate);

  const optOutApplied = applyConsentUpdate({ customerKey: 'k_1', consent: true, optedOut: false, updatedAt: new Date(0).toISOString() }, { optedOut: true, nowMs: NOW });
  check('10-الإلغاء يُلغي الموافقة', optOutApplied.optedOut && !optOutApplied.consent);
}

// ---------------------------------------------------------------------------
// 11) الإسناد: لا سببية عند الشك
// ---------------------------------------------------------------------------
{
  const direct = computeAttribution({ campaignId: 'c1', interactionId: 'i1', conversationId: 'cv1', leadId: 'L1', requestId: null, saleId: 's1', platform: 'facebook' as any });
  check('11-سلسلة كاملة ⇒ إسناد مباشر', direct.state === 'DIRECT' && direct.canClaimCausation);
  const noSale = computeAttribution({ campaignId: 'c1', interactionId: null, conversationId: null, leadId: 'L1', requestId: null, saleId: null, platform: null });
  check('11-بلا بيع ⇒ غير قابل للإسناد', noSale.state === 'NOT_ATTRIBUTABLE' && !noSale.canClaimCausation);
  const uncertain = computeAttribution({ campaignId: 'c1', interactionId: null, conversationId: null, leadId: null, requestId: null, saleId: 's1', platform: null });
  check('11-بيع بلا ربط موثوق ⇒ غير مؤكّد', uncertain.state === 'UNCERTAIN' && !uncertain.canClaimCausation);
}

// ---------------------------------------------------------------------------
// 12) الأحداث: بلا بيع وهمي وبلا بيانات شخصية
// ---------------------------------------------------------------------------
{
  const noSaleEvent = recordSalesEvent({ eventId: 'e1', type: 'verified_sale', reason: 'x', nowMs: NOW });
  check('12-لا حدث بيع موثّق بلا معرّف بيع', !noSaleEvent.ok && (noSaleEvent as any).code === 'NO_SALE_ID');
  const saleEvent = recordSalesEvent({ eventId: 'e2', type: 'verified_sale', saleId: 's1', evidence: ['saleId=s1'], reason: 'بيع موثّق', nowMs: NOW });
  check('12-حدث بيع موثّق يُقبل', saleEvent.ok && (saleEvent as any).event.learningEligible);
  const { event, stripped } = stripSensitiveEventFields({ type: 'interaction', phone: '0771', name: 'علي', productId: 'p1' });
  check('12-تنقية الحقول الشخصية', stripped.includes('phone') && stripped.includes('name') && !('phone' in event));
  const sum = summarizeSalesEvents([(saleEvent as any).event]);
  check('12-ملخّص الأحداث', sum.total === 1 && sum.verifiedSales === 1);
}

// ---------------------------------------------------------------------------
// 13) القُمع: لا قسمة على صفر ولا صفر مُخترع
// ---------------------------------------------------------------------------
{
  const f = buildDigitalSalesFunnel({ interactions: 100, purchaseSignals: 20, qualifiedLeads: 5, requests: 2, verifiedSales: 1 });
  check('13-القُمع يحسب المعدّلات', f.conversions.every((c) => c.available) && f.bottleneck !== null);
  const empty = buildDigitalSalesFunnel({ interactions: null, purchaseSignals: null, qualifiedLeads: null, requests: null, verifiedSales: null });
  check('13-مرحلة بلا بيانات ⇒ غير متاح لا صفر', empty.stages.every((s) => !s.available) && empty.bottleneck === null);
  const zeroBase = buildDigitalSalesFunnel({ interactions: 0, purchaseSignals: 0, qualifiedLeads: 0, requests: 0, verifiedSales: 0 });
  check('13-مقام صفر ⇒ لا معدّل', zeroBase.conversions.every((c) => !c.available));
}

// ---------------------------------------------------------------------------
// 14) الاستقلالية: الافتراضي آمن
// ---------------------------------------------------------------------------
{
  check('14-الافتراضي مراقبة', defaultGrantedLevel() === 'OBSERVE');
  const publish = evaluateAutonomy({ action: 'publish_content' });
  check('14-النشر يحتاج موافقة ولا يقع صامتاً', !publish.allowed && !publish.silentAllowed && publish.requiresOwnerApproval);
  const observe = evaluateAutonomy({ action: 'observe' });
  check('14-المراقبة مسموحة افتراضياً', observe.allowed);
  const price = evaluateAutonomy({ action: 'change_price', grantedLevel: 'EXECUTE' });
  check('14-تغيير السعر لا يقع صامتاً حتى مع التنفيذ', price.allowed && !price.silentAllowed);
  check('14-الأفعال الحساسة مُدرجة', NEVER_SILENT_ACTIONS.includes('publish_content') && NEVER_SILENT_ACTIONS.includes('modify_encryption'));
}

// ---------------------------------------------------------------------------
// 15) حدود الموصلات: لا منطق تجاري في الموصل
// ---------------------------------------------------------------------------
{
  const bad = assertAdapterBoundary(['price_lookup', 'lead_qualification']);
  check('15-منع المنطق التجاري في الموصل', !bad.ok && bad.violations.length === 2);
  const good = assertAdapterBoundary(['incoming_interaction', 'conversation_context']);
  check('15-موصل بلا منطق تجاري مقبول', good.ok);
  check('15-مسؤوليات محظورة معلنة', FORBIDDEN_ADAPTER_RESPONSIBILITIES.includes('commercial_reasoning'));
}

// ---------------------------------------------------------------------------
// 16) مخزن الموافقة/المتابعة: بصمات فقط + منع تكرار
// ---------------------------------------------------------------------------
{
  const raw = { consents: [{ hash: 'k_abc', consent: true, optedOut: false, updatedAt: new Date(NOW).toISOString() }, { hash: 'phone:0771', consent: true }], followUps: [] };
  const store = normalizeDigitalSalesStore(raw);
  check('16-يتجاهل المفتاح الخام غير البصمة', store.consents.length === 1 && store.consents[0].hash === 'k_abc');
  const updated = updateConsentByHash(store, 'k_abc', { optedOut: true, nowMs: NOW });
  check('16-تحديث الإلغاء يُلغي الموافقة', getConsentByHash(updated, 'k_abc')!.optedOut && !getConsentByHash(updated, 'k_abc')!.consent);
  const withFollow = recordFollowUp(updated, { hash: 'k_abc', productId: 'p1', at: new Date(NOW - 86400000).toISOString() });
  const guard = guardDuplicateFollowUp(withFollow, { hash: 'k_abc', productId: 'p1', nowMs: NOW });
  check('16-منع تكرار المتابعة من المخزن', guard.duplicate);
}

// ---------------------------------------------------------------------------
// 17) التجميع الكامل: من بيانات حقيقية، بلا اختراع
// ---------------------------------------------------------------------------
{
  const raw = {
    now: NOW,
    products: [{ id: 'p1', name: 'غسالة سامسونغ', category: 'appliances', cashPrice: 600000, inStock: true, stockQuantity: 4, durationMonths: 12, downPaymentPercent: 10 }],
    installmentPlans: [],
    sales: [{ id: 's1', customerName: 'عميل', phone: '07711111111', productId: 'p1', productName: 'غسالة سامسونغ', totalAmount: 600000, status: 'completed', createdAt: new Date(NOW).toISOString() }],
    leads: [],
    conversations: [],
    socialComments: [
      { platform: 'facebook', externalId: 'c1', text: 'أريد وحدة غسالة وشكد القسط؟', productId: 'p1', createdAt: new Date(NOW).toISOString() },
      { platform: 'facebook', externalId: 'c2', text: 'شكد سعر الغسالة؟', productId: 'p1', createdAt: new Date(NOW).toISOString() },
    ],
    campaigns: [],
    performanceRecords: [],
  };
  const st = buildDigitalSalesState(raw as any);
  check('17-الحالة تُبنى', typeof st.generatedAt === 'string');
  check('17-إشارات شراء من تفاعل حقيقي', st.summary.purchaseSignals >= 1);
  check('17-عميل محتمل أُنشئ من إشارة', st.leads.length >= 1);
  check('17-مبيعات موثّقة تعكس السجل الحقيقي', st.summary.verifiedSales === 1);
  check('17-حدث بيع موثّق موجود', st.events.some((e) => e.type === 'verified_sale' && e.learningEligible));
  check('17-القُمع يعكس الأرقام', st.funnel.stages.find((s) => s.stage === 'VERIFIED_SALES')!.value === 1);
  check('17-الحدود معلنة', st.limitations.length > 0);
  check('17-الإجراءات موجودة', st.nextActions.length > 0);
  check('17-لا Gemini في المخرج', !JSON.stringify(st).includes('gemini'));
  check('17-لا هاتف خام في المتابعات', !JSON.stringify(st.followUps).includes('07711111111'));

  const empty = buildDigitalSalesState({ now: NOW } as any);
  check('17-بيانات فارغة لا تنهار', typeof empty.note === 'string' && empty.summary.verifiedSales === 0);
  check('17-بيانات فارغة ⇒ لا إشارات مُختلقة', empty.summary.purchaseSignals === 0);
}

// ---------------------------------------------------------------------------
// 18) الاستدلال البيعي: لا حكم بلا أدلة
// ---------------------------------------------------------------------------
{
  const st = buildDigitalSalesState({ now: NOW, products: [], sales: [], socialComments: [], campaigns: [], performanceRecords: [] } as any);
  check('18-لا استدلال بلا منتجات', st.reasoning.length === 0);
}

console.log(`PASSED: ${passed} Digital Sales foundation checks`);
