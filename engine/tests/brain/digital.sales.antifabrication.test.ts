/**
 * اختبار مكافحة الاختلاق في العقل المركزي للمبيعات الرقمية.
 *
 * يثبت صراحةً أنه **لا** يُختلق: سعر، قسط، مقدم، توفر، بيع، إيراد، معدّل تحويل،
 * نتيجة حملة، عميل محتمل، ولا سبب خسارة. كل رقم إمّا من سجل حقيقي أو يُعلن غير
 * متاح، ولا يُعلن بيع/سببية بلا دليل، ولا تُخزَّن بيانات شخصية خامة.
 *
 * تشغيل: npx tsx engine/tests/brain/digital.sales.antifabrication.test.ts
 */

import assert from 'node:assert';

import { buildDigitalSalesState } from '../../brain/digital/runtime';
import { answerProductQuestion } from '../../brain/digital/offer';
import { buildDigitalSalesFunnel } from '../../brain/digital/salesFunnel';
import { computeAttribution } from '../../brain/digital/attribution';
import { qualifyLead, classifyLostReason } from '../../brain/digital/lead';
import { planFollowUp, DEFAULT_FOLLOW_UP_POLICY } from '../../brain/digital/followup';
import { recordSalesEvent, stripSensitiveEventFields } from '../../brain/digital/events';
import { normalizeDigitalSalesStore, updateConsentByHash, getConsentByHash } from '../../brain/digital/store';
import { buildCatalogFromWorkspace } from '../../brain/sales/commercialRuntime';

let passed = 0;
const check = (name: string, cond: boolean) => {
  assert.ok(cond, `FAIL: ${name}`);
  passed += 1;
};

const NOW = Date.parse('2026-10-02T10:00:00.000Z');

// 1) بلا بيانات ⇒ لا إشارات، لا عملاء، لا مبيعات، لا قُمع مُختلق
{
  const st = buildDigitalSalesState({ now: NOW } as any);
  check('1-لا إشارات شراء بلا تفاعل', st.summary.purchaseSignals === 0);
  check('1-لا عملاء بلا إشارة', st.leads.length === 0);
  check('1-لا مبيعات بلا سجل', st.summary.verifiedSales === 0);
  check('1-لا خسائر بلا سجل', st.lostOpportunities.length === 0);
  check('1-لا أحداث بيع موثّق', !st.events.some((e) => e.type === 'verified_sale'));
  check('1-القُمع أصفار حقيقية بلا معدّل مُختلق', st.funnel.stages.every((s) => s.available && s.value === 0) && st.funnel.conversions.every((c) => !c.available));
}

// 2) لا سعر/قسط/توفر مُخترع
{
  const [noPrice] = buildCatalogFromWorkspace([{ id: 'p1', name: 'منتج بلا سعر', category: 'appliances', cashPrice: 0 }], [], NOW);
  const cash = answerProductQuestion({ text: 'شكد سعر المنتج؟', products: [noPrice], nowMs: NOW });
  check('2-بلا سعر موثّق ⇒ لا سعر مُخترع', cash.state === 'DATA_NOT_AVAILABLE' && !/\d{3,}/.test(cash.answerText));
  const inst = answerProductQuestion({ text: 'شكد القسط؟', products: [noPrice], explicitProductId: 'p1', nowMs: NOW });
  check('2-بلا سعر ⇒ لا قسط مُخترع', inst.state === 'DATA_NOT_AVAILABLE');
  const av = answerProductQuestion({ text: 'متوفر؟', products: [noPrice], explicitProductId: 'p1', nowMs: NOW });
  check('2-بلا توفر موثّق ⇒ لا توفر مُخترع', av.state === 'DATA_NOT_AVAILABLE');
}

// 3) القُمع: لا معدّل بمقام صفر، ولا صفر مُختلق عند غياب البيانات
{
  const zero = buildDigitalSalesFunnel({ interactions: 0, purchaseSignals: 0, qualifiedLeads: 0, requests: 0, verifiedSales: 0 });
  check('3-لا معدّل تحويل بمقام صفر', zero.conversions.every((c) => !c.available && c.ratePct === null));
  const missing = buildDigitalSalesFunnel({ interactions: null, purchaseSignals: 5, qualifiedLeads: null, requests: null, verifiedSales: null });
  check('3-طرف ناقص ⇒ لا معدّل', missing.conversions.every((c) => !c.available));
  check('3-مرحلة ناقصة لا تُعامَل صفراً', missing.stages.find((s) => s.stage === 'INTERACTIONS')!.available === false);
}

// 4) لا إسناد سببية عند الشك
{
  const uncertain = computeAttribution({ campaignId: 'c1', interactionId: null, conversationId: null, leadId: null, requestId: null, saleId: 's1', platform: null });
  check('4-لا سببية عند الشك', !uncertain.canClaimCausation && uncertain.state === 'UNCERTAIN');
  const noSale = computeAttribution({ campaignId: 'c1', interactionId: 'i1', conversationId: 'cv1', leadId: 'L1', requestId: null, saleId: null, platform: 'facebook' as any });
  check('4-بلا بيع ⇒ لا إسناد', !noSale.canClaimCausation);
}

// 5) لا تأهيل بلا إشارة شراء
{
  const q = qualifyLead({ purchaseSignal: false, productIdentified: true, priceRequested: true, availabilityRequested: true, installmentRequested: true, buyingTimeframe: true, requestToPurchase: true, reliableIdentity: true, conversationProgressed: true });
  check('5-لا تأهيل بلا إشارة شراء', q.outcome === 'NOT_ENOUGH_EVIDENCE');
}

// 6) لا سبب خسارة مُختلق
{
  const unknown = classifyLostReason({ evidenceCodes: [], hadFollowUp: true, customerResponded: true });
  check('6-بلا دليل ⇒ سبب غير معروف', unknown.reason === 'unknown');
}

// 7) لا متابعة بلا موافقة (سبام)
{
  const f = planFollowUp({ askedAboutProductNoPurchase: true, productId: 'p1', purchaseSignal: true, policy: { ...DEFAULT_FOLLOW_UP_POLICY, consent: false }, priorFollowUps: 0, lastFollowUpAt: null, followUpsLast30Days: 0, nowMs: NOW });
  check('7-لا متابعة بلا موافقة', f.state === 'NOT_ELIGIBLE');
}

// 8) لا حدث بيع بلا معرّف
{
  const e = recordSalesEvent({ eventId: 'e1', type: 'verified_sale', reason: 'x', nowMs: NOW });
  check('8-لا حدث بيع بلا معرّف بيع', !e.ok);
}

// 9) لا بيانات شخصية خامة في الأحداث
{
  const { event } = stripSensitiveEventFields({ phone: '077', name: 'علي', national_id: '123', productId: 'p1' });
  check('9-تنقية البيانات الشخصية', !('phone' in event) && !('name' in event) && !('national_id' in event));
}

// 10) لا تُحفظ قيمة خامة في المخزن (بصمة فقط)
{
  const raw = { consents: [{ hash: '07712345678', consent: true }, { hash: 'k_valid', consent: true }], followUps: [{ hash: 'phone:0771', productId: 'p1', at: new Date(NOW).toISOString() }] };
  const store = normalizeDigitalSalesStore(raw);
  check('10-يتجاهل أي مفتاح خام غير بصمة', store.consents.length === 1 && store.consents[0].hash === 'k_valid');
  check('10-يتجاهل سجل متابعة غير بصمة', store.followUps.length === 0);
  const updated = updateConsentByHash({ consents: [], followUps: [] }, 'k_x', { consent: true, nowMs: NOW });
  check('10-التحديث يخزّن بصمة فقط', getConsentByHash(updated, 'k_x')!.hash === 'k_x');
}

// 11) التجميع لا يخترع إشارات ولا مبيعات
{
  const st = buildDigitalSalesState({
    now: NOW,
    products: [{ id: 'p1', name: 'غسالة', category: 'appliances', cashPrice: 400000, inStock: true, stockQuantity: 2, durationMonths: 12, downPaymentPercent: 10 }],
    sales: [],
    leads: [],
    socialComments: [{ platform: 'facebook', externalId: 'c1', text: 'صباح الخير', productId: 'p1', createdAt: new Date(NOW).toISOString() }],
    campaigns: [],
    performanceRecords: [],
  } as any);
  check('11-تفاعل بلا إشارة لا يُنشئ عميلاً', st.leads.length === 0);
  check('11-بلا مبيعات ⇒ صفر حقيقي', st.summary.verifiedSales === 0);
  check('11-لا بيع مُختلق في الأحداث', !st.events.some((e) => e.type === 'verified_sale'));
}

console.log(`PASSED: ${passed} Digital Sales antifabrication checks`);
