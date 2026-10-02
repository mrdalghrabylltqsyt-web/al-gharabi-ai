/**
 * Digital Sales — العقل المركزي للمبيعات الرقمية (تجميع، منطق خالص).
 *
 * الغرض: طبقة قرار تجاري **واحدة** platform-agnostic تجمع: معرفة المنتجات،
 * ذكاء الطلب، تأهيل العملاء، التحقق من العرض، المتابعة، التسليم البشري، الإسناد،
 * والاستدلال البيعي — كلها من بيانات حقيقية فقط.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا AI.
 */

import type { PlatformId } from '../../social/adapter';
import type { CatalogProduct } from '../knowledge/catalog';
import { buildCatalogFromWorkspace, buildInteractionsFromComments, buildSalesEvidence, type CommercialRawData } from '../sales/commercialRuntime';
import { reasonAboutSales, type SalesReasoningReport } from '../sales/salesReasoning';
import { aggregateDemandSignals, toDemandSignal } from '../market/demandSignals';
import { buildCustomerIdentity, privacyCustomerHash, type CustomerIdentity } from './identity';
import { detectPurchaseIntent, type PurchaseIntentResult } from './intent';
import { answerProductQuestion, type OfferAnswer } from './offer';
import { buildHumanHandoff, shouldHandoff, type HumanHandoff, type HandoffReason } from './handoff';
import {
  qualifyLead, createLeadFromSignal, classifyLostReason,
  LEAD_STAGE_LABELS_AR, type LeadStage, type LeadRecord, type QualificationEvidenceInput,
} from './lead';
import { planFollowUp, DEFAULT_FOLLOW_UP_POLICY, type FollowUpOpportunity, type FollowUpPolicy, type ConsentState } from './followup';
import { computeAttribution, type AttributionResult } from './attribution';
import { recordSalesEvent, type SalesEvent } from './events';
import { buildDigitalSalesFunnel, type DigitalFunnelReport } from './salesFunnel';

export interface DigitalRawData extends CommercialRawData {
  /** حالة الموافقة/الإلغاء لكل عميل (بأقل قدر من البيانات). */
  consents?: ConsentState[];
  /** سجل المتابعات السابقة (لمنع التكرار/السبام). */
  followUpLog?: Array<{ customerKey: string; productId: string | null; at: string }>;
  /** منصة واحدة محتملة لتصنيف التفاعلات بلا منصة. */
  defaultPlatform?: PlatformId;
  /** سياسة المتابعة (افتراضية آمنة). */
  followUpPolicy?: Partial<FollowUpPolicy>;
}

/** حالة عمل العميل الرقمي الكامل. */
export interface DigitalSalesState {
  generatedAt: string;
  catalog: CatalogProduct[];
  /** تفاعلات حقيقية مُقيَّمة لنية الشراء. */
  intents: Array<{
    platform: PlatformId | 'cross_platform';
    externalId: string;
    productId: string | null;
    intent: PurchaseIntentResult;
    answer: OfferAnswer | null;
    handoff: HumanHandoff | null;
    identity: CustomerIdentity;
    campaignId: string | null;
  }>;
  leads: LeadRecord[];
  lostOpportunities: Array<{ leadId: string; reason: string; reasonLabelAr: string; confidence: string; evidence: string[] }>;
  followUps: Array<{ leadId: string; customerKey: string | null; opportunity: FollowUpOpportunity }>;
  handoffs: HumanHandoff[];
  attributions: Array<{ saleId: string; leadId: string | null; result: AttributionResult }>;
  funnel: DigitalFunnelReport;
  reasoning: SalesReasoningReport[];
  /** تجميعات إشارات الطلب الحقيقية (عيّنة/فترة/قوة). */
  demandAggregates: ReturnType<typeof aggregateDemandSignals>;
  events: SalesEvent[];
  summary: {
    interactions: number;
    purchaseSignals: number;
    qualifiedLeads: number;
    requests: number;
    verifiedSales: number;
    lost: number;
    unresolved: number;
    humanHandoffs: number;
    followUpOpportunities: number;
  };
  limitations: string[];
  nextActions: string[];
  note: string;
}

const clean = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** يحوّل منصة قد تكون cross_platform إلى منصة صالحة للتصنيف. */
function asPlatform(value: unknown, fallback: PlatformId): PlatformId {
  return typeof value === 'string' && value && value !== 'cross_platform' ? (value as PlatformId) : fallback;
}

/** يربط حالة عميل المعرض (leads.status) بمرحلة العقل الرقمي — بلا ترقية لبيع. */
function mapLeadStatus(status: string, hasVerifiedSale: boolean): LeadStage {
  switch (status) {
    case 'new': return 'NEW_SIGNAL';
    case 'contacted': return 'FOLLOW_UP';
    case 'qualified': return 'QUALIFIED_LEAD';
    case 'proposal': return 'REQUEST';
    case 'won': return hasVerifiedSale ? 'VERIFIED_SALE' : 'REQUEST';
    case 'lost': return 'LOST';
    default: return 'NEW_SIGNAL';
  }
}

/** مفتاح عميل موثوق من هاتف مطبَّع (مصدر واحد للربط). */
function trustedCustomerKey(input: { phone?: unknown }): string | null {
  const digits = typeof input.phone === 'string' ? input.phone.replace(/\D+/g, '') : '';
  return digits.length >= 10 ? `phone:${digits}` : null;
}

/**
 * يبني حالة المبيعات الرقمية الكاملة من بيانات الغرابي الحقيقية. لا ينفّذ ولا
 * يخترع؛ كل مخرج قابل للتفسير ويحمل مصدره.
 */
export function buildDigitalSalesState(raw: DigitalRawData): DigitalSalesState {
  const now = raw.now;
  const defaultPlatform = raw.defaultPlatform || ('other' as PlatformId);
  const policy: FollowUpPolicy = { ...DEFAULT_FOLLOW_UP_POLICY, ...(raw.followUpPolicy || {}) };
  const consentMap = new Map<string, ConsentState>();
  for (const c of raw.consents || []) if (c && c.customerKey) consentMap.set(c.customerKey, c);
  const catalog = buildCatalogFromWorkspace(raw.products || [], raw.installmentPlans || [], now);
  const productById = new Map(catalog.map((p) => [p.id, p]));
  const productByName = new Map(catalog.map((p) => [p.name, p]));

  const sales = (raw.sales || []).filter((s) => s && String(s.status) !== 'cancelled');
  const leadsRaw = raw.leads || [];

  // مفتاح بيع موثوق لكل عميل — لربط العميل بالبيع الحقيقي.
  const saleKeys = new Set<string>();
  const saleByKey = new Map<string, any>();
  for (const s of sales) {
    const k = trustedCustomerKey({ phone: s?.phone });
    if (k) { saleKeys.add(k); saleByKey.set(k, s); }
  }

  const events: SalesEvent[] = [];
  let eventSeq = 0;
  const mkEvent = (e: Omit<Parameters<typeof recordSalesEvent>[0], 'eventId' | 'nowMs'>) => {
    const r = recordSalesEvent({ ...e, eventId: `ev-${++eventSeq}`, nowMs: now });
    if (r.ok) events.push(r.event);
  };

  // -------------------------------------------------------------------------
  // 1) تقييم كل تفاعل حقيقي: نية الشراء + إجابة موثّقة + تسليم بشري
  // -------------------------------------------------------------------------
  const comments = raw.socialComments || [];
  const intents: DigitalSalesState['intents'] = [];
  const handoffs: HumanHandoff[] = [];
  // عدّ الأسئلة السابقة لكل (منصة+مفتاح عميل) لتقدير التكرار.
  const questionCount = new Map<string, number>();

  for (const c of comments) {
    const platform = asPlatform(c?.platform, defaultPlatform);
    const externalId = clean(c?.externalId || c?.id, 100) || `c-${intents.length}`;
    const text = String(c?.text || '');
    if (!text) continue;
    const productId = clean(c?.productId, 100) || null;
    const productRef = productId && productById.has(productId) ? { productId, verified: true } : (productId ? { productId, verified: false } : null);
    const convKey = `${platform}:${clean(c?.authorName || c?.conversationId || externalId, 100)}`;
    const prior = questionCount.get(convKey) || 0;
    questionCount.set(convKey, prior + 1);

    const intent = detectPurchaseIntent({
      platform, externalId, text,
      classification: c?.classification || null,
      productRef,
      priorProductQuestions: prior,
      nowMs: now,
    });

    // إجابة موثّقة فقط إن كان السؤال عن سعر/قسط/توفر/مواصفات.
    const answer = answerProductQuestion({
      text, products: catalog, explicitProductId: productId, platform, nowMs: now,
    });

    const identity = buildCustomerIdentity({
      platform, platformCustomerId: null, phone: null,
      conversationId: clean(c?.conversationId, 100) || null,
      refs: { productId, campaignId: clean(c?.campaignId, 100) || null },
    });

    const mentionsDiscount = /(خصم|تخفيض|نزّل|نزل السعر|تخفيضات)/.test(text);
    const mentionsNegotiation = /(فاوض|تفاوض|نص ونص|بالنص|شكد اخير|اخر سعر|سعر اخير)/.test(text);
    const isComplaint = c?.classification?.category === 'complaint' || /(شكوى|زعلان|تأخير|تاخير|مشكله|مشكلة)/.test(text);
    const decision = shouldHandoff({
      answerState: answer.state,
      productIdentityClear: answer.state !== 'PRODUCT_NOT_IDENTIFIED',
      mentionsDiscount, mentionsNegotiation, isComplaint,
      conflictingData: false,
    });
    let handoff: HumanHandoff | null = null;
    if (decision.handoff && decision.reason) {
      handoff = buildHumanHandoff({
        reason: decision.reason as HandoffReason,
        evidence: [intent.reason, answer.state, `productId=${productId || 'none'}`],
        context: { platform, conversationId: identity.conversationId, leadId: null, productId, snippet: text },
        nowMs: now,
      });
      handoffs.push(handoff);
      mkEvent({
        type: 'human_handoff', platform, productId, reason: handoff.reasonLabelAr || 'handoff',
        evidence: handoff.evidence, confidence: 'high', humanIntervention: true,
      });
    }

    intents.push({
      platform, externalId, productId, intent, answer, handoff, identity,
      campaignId: clean(c?.campaignId, 100) || null,
    });

    mkEvent({
      type: 'interaction', platform, productId, reason: 'تفاعل وارد',
      evidence: [`externalId=${externalId}`], confidence: 'high',
    });
    if (intent.state === 'PURCHASE_SIGNAL') {
      mkEvent({
        type: 'purchase_signal', platform, productId, reason: intent.reason,
        evidence: intent.evidence, confidence: intent.confidence === 'none' ? 'low' : intent.confidence,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2) خطّ العملاء: من سجلات المعرض الحقيقية + إشارات المحادثة (بلا تكرار)
  // -------------------------------------------------------------------------
  const leads: LeadRecord[] = [];
  const seenLeadKeys = new Set<string>();

  for (const l of leadsRaw) {
    const key = trustedCustomerKey({ phone: l?.phone }) || `lead:${clean(l?.id, 100)}`;
    if (seenLeadKeys.has(key)) continue;
    seenLeadKeys.add(key);
    const product = productByName.get(clean(l?.interestedProduct, 160)) || null;
    const stage = mapLeadStatus(String(l?.status || 'new'), saleKeys.has(key));
    const at = clean(l?.createdAt, 80) || new Date(now).toISOString();
    leads.push({
      leadId: clean(l?.id, 100) || `lead-${leads.length}`,
      stage,
      platform: asPlatform(l?.channel, defaultPlatform) as PlatformId | 'cross_platform',
      customerKey: trustedCustomerKey({ phone: l?.phone }),
      productId: product ? product.id : null,
      campaignId: clean(l?.campaignId, 100) || null,
      conversationId: clean(l?.conversationId, 100) || null,
      qualification: stage === 'NEW_SIGNAL' ? 'NOT_ENOUGH_EVIDENCE' : (stage === 'QUALIFIED_LEAD' || stage === 'FOLLOW_UP' ? 'QUALIFIED' : 'QUALIFIED'),
      evidence: [],
      history: [{ from: stage, to: stage, at, evidence: ['workspace.leads.status'], reason: `حالة مسجّلة: ${l?.status}`, source: 'workspace.leads', confidence: 'high', humanIntervention: false }],
      createdAt: at,
      updatedAt: at,
    });
  }

  // إشارات شراء من المحادثات → عملاء محتملون (فقط عند إشارة مؤكّدة، بلا تكرار).
  for (const it of intents) {
    if (it.intent.state !== 'PURCHASE_SIGNAL') continue;
    const key = it.identity.customerKey;
    if (seenLeadKeys.has(key)) continue;
    seenLeadKeys.add(key);
    const created = createLeadFromSignal({
      leadId: `lead-signal-${leads.length + 1}`,
      platform: it.platform,
      customerKey: key,
      productId: it.intent.productId,
      campaignId: it.campaignId,
      conversationId: it.identity.conversationId,
      purchaseSignal: true,
      evidence: it.intent.evidence,
      reason: it.intent.reason,
      nowMs: now,
    });
    if (created.ok) {
      // التأهيل فوراً من الأدلة الحقيقية المتاحة.
      const qualInput: QualificationEvidenceInput = {
        purchaseSignal: true,
        productIdentified: Boolean(it.intent.productId),
        priceRequested: it.intent.signals.some((s) => s.kind === 'asks_price'),
        availabilityRequested: it.intent.signals.some((s) => s.kind === 'asks_availability'),
        installmentRequested: it.intent.signals.some((s) => s.kind === 'asks_installment'),
        buyingTimeframe: it.intent.signals.some((s) => s.kind === 'buying_timing'),
        requestToPurchase: it.intent.signals.some((s) => s.kind === 'wants_one' || s.kind === 'asks_how_to_buy' || s.kind === 'wants_same_item'),
        reliableIdentity: it.identity.confidence === 'strong',
        conversationProgressed: false,
      };
      const q = qualifyLead(qualInput);
      const lead = created.lead;
      lead.qualification = q.outcome;
      lead.evidence = q.evidence;
      if (q.outcome === 'QUALIFIED') {
        lead.stage = 'QUALIFIED_LEAD';
        lead.history.push({ from: 'NEW_SIGNAL', to: 'QUALIFIED_LEAD', at: new Date(now).toISOString(), evidence: q.evidence.map((e) => e.code), reason: q.reason, source: 'qualification', confidence: 'high', humanIntervention: false });
        mkEvent({ type: 'qualification', platform: it.platform, productId: it.intent.productId, leadId: lead.leadId, previousState: 'NEW_SIGNAL', newState: 'QUALIFIED_LEAD', reason: q.reason, evidence: q.evidence.map((e) => e.code), confidence: 'high' });
      } else if (q.outcome === 'NEEDS_HUMAN_REVIEW') {
        mkEvent({ type: 'qualification', platform: it.platform, productId: it.intent.productId, leadId: lead.leadId, reason: q.reason, evidence: q.evidence.map((e) => e.code), confidence: 'medium', humanIntervention: true });
      }
      leads.push(lead);
      mkEvent({ type: 'lead_created', platform: it.platform, productId: it.intent.productId, leadId: lead.leadId, campaignId: it.campaignId, reason: it.intent.reason, evidence: it.intent.evidence, confidence: 'medium' });
    }
  }

  // -------------------------------------------------------------------------
  // 3) مبيعات موثّقة → أحداث + إسناد
  // -------------------------------------------------------------------------
  const attributions: DigitalSalesState['attributions'] = [];
  for (const s of sales) {
    const key = trustedCustomerKey({ phone: s?.phone });
    const linkedLead = key ? leads.find((l) => l.customerKey === key) || null : null;
    const result = computeAttribution({
      campaignId: linkedLead?.campaignId || clean(s?.campaignId, 100) || null,
      interactionId: null,
      conversationId: linkedLead?.conversationId || null,
      leadId: linkedLead?.leadId || null,
      requestId: null,
      saleId: clean(s?.id, 100) || null,
      platform: linkedLead?.platform || null,
    });
    attributions.push({ saleId: clean(s?.id, 100), leadId: linkedLead?.leadId || null, result });
    mkEvent({
      type: 'verified_sale', platform: linkedLead?.platform || null,
      productId: clean(s?.productId, 100) || null, leadId: linkedLead?.leadId || null,
      campaignId: linkedLead?.campaignId || null, customerKey: key,
      reason: 'بيع موثّق من سجل المبيعات', evidence: [`saleId=${clean(s?.id, 100)}`],
      attribution: result.state, confidence: 'high', saleId: clean(s?.id, 100), outcome: 'verified_sale',
    });
  }

  // -------------------------------------------------------------------------
  // 4) خسائر/غير محسوم + متابعات
  // -------------------------------------------------------------------------
  const lostOpportunities: DigitalSalesState['lostOpportunities'] = [];
  const followUps: DigitalSalesState['followUps'] = [];
  const followUpLog = raw.followUpLog || [];

  for (const lead of leads) {
    if (lead.stage === 'LOST' || lead.stage === 'UNRESOLVED') {
      const classified = classifyLostReason({
        evidenceCodes: (lead.evidence || []).map((e) => e.code),
        hadFollowUp: followUpLog.some((f) => f.customerKey === lead.customerKey),
        customerResponded: false,
      });
      lostOpportunities.push({
        leadId: lead.leadId, reason: classified.reason,
        reasonLabelAr: classified.reason === 'unknown' ? 'سبب غير معروف' : classified.reason,
        confidence: classified.confidence, evidence: classified.evidence,
      });
      mkEvent({ type: lead.stage === 'LOST' ? 'lost' : 'unresolved', platform: lead.platform, productId: lead.productId, leadId: lead.leadId, reason: classified.reason, evidence: classified.evidence, confidence: classified.confidence as any });
      continue;
    }
    // فرصة متابعة: عميل سأل عن منتج ولم يُتمّم، مع احترام السياسة.
    const askedNoPurchase = lead.stage === 'QUALIFIED_LEAD' || lead.stage === 'FOLLOW_UP' || lead.stage === 'NEW_SIGNAL';
    // المفاتيح المحفوظة بصمات آمنة الخصوصية (لا هاتف خام في الحالة).
    const leadHash = privacyCustomerHash(lead.customerKey);
    const consent = leadHash ? consentMap.get(leadHash) : undefined;
    const lastFollowUp = followUpLog.filter((f) => f.customerKey === leadHash).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] || null;
    const opp = planFollowUp({
      askedAboutProductNoPurchase: askedNoPurchase && Boolean(lead.productId),
      productId: lead.productId,
      purchaseSignal: lead.stage !== 'NEW_SIGNAL',
      policy: { ...policy, consent: Boolean(consent?.consent), optedOut: Boolean(consent?.optedOut) },
      priorFollowUps: followUpLog.filter((f) => f.customerKey === leadHash).length,
      lastFollowUpAt: lastFollowUp?.at || null,
      followUpsLast30Days: followUpLog.filter((f) => f.customerKey === leadHash && now - Date.parse(f.at) < 30 * 24 * 60 * 60 * 1000).length,
      nowMs: now,
    });
    followUps.push({ leadId: lead.leadId, customerKey: leadHash, opportunity: opp });
    if (opp.state === 'FOLLOW_UP_OPPORTUNITY') {
      mkEvent({ type: 'follow_up_prepared', platform: lead.platform, productId: lead.productId, leadId: lead.leadId, reason: opp.why, evidence: opp.evidence, confidence: opp.confidence });
    }
  }

  // -------------------------------------------------------------------------
  // 5) القُمع الرقمي + الاستدلال البيعي
  // -------------------------------------------------------------------------
  const interactionsCount = comments.length + (raw.conversations || []).length;
  const purchaseSignalsCount = intents.filter((i) => i.intent.state === 'PURCHASE_SIGNAL').length;
  const qualifiedLeadsCount = leads.filter((l) => l.qualification === 'QUALIFIED').length;
  const requestsCount = leads.filter((l) => l.stage === 'REQUEST' || l.stage === 'NEGOTIATION').length;

  const funnel = buildDigitalSalesFunnel({
    interactions: interactionsCount,
    purchaseSignals: purchaseSignalsCount,
    qualifiedLeads: qualifiedLeadsCount,
    requests: requestsCount,
    verifiedSales: sales.length,
  });

  const demandSignals = (raw.socialComments || []).map((c: any, idx: number) => toDemandSignal({
    text: String(c?.text || ''),
    platform: asPlatform(c?.platform, defaultPlatform),
    productId: clean(c?.productId, 100) || null,
    externalId: clean(c?.externalId || c?.id, 100) || `c-${idx}`,
    at: clean(c?.createdAt, 80) || null,
  }));
  const demandAggregates = aggregateDemandSignals({ signals: demandSignals });
  const evidence = buildSalesEvidence({ catalog, demandSignals, sales, leads: leadsRaw, campaigns: raw.campaigns || [], records: raw.performanceRecords || [], conversations: raw.conversations || [] });
  const reasoning = evidence.map((e) => reasonAboutSales(e));

  // -------------------------------------------------------------------------
  // 6) الملخّص والإجراءات
  // -------------------------------------------------------------------------
  const summary = {
    interactions: interactionsCount,
    purchaseSignals: purchaseSignalsCount,
    qualifiedLeads: qualifiedLeadsCount,
    requests: requestsCount,
    verifiedSales: sales.length,
    lost: leads.filter((l) => l.stage === 'LOST').length,
    unresolved: leads.filter((l) => l.stage === 'UNRESOLVED').length,
    humanHandoffs: handoffs.length,
    followUpOpportunities: followUps.filter((f) => f.opportunity.state === 'FOLLOW_UP_OPPORTUNITY').length,
  };

  const nextActions: string[] = [];
  if (handoffs.length) nextActions.push(`معالجة ${handoffs.length} حالة تحتاج تدخّلاً بشرياً.`);
  if (summary.followUpOpportunities) nextActions.push(`متابعة ${summary.followUpOpportunities} عميلاً مهتمّاً (بموافقة).`);
  if (funnel.bottleneck) nextActions.push(`معالجة عنق الزجاجة: ${funnel.bottleneck.reason}`);
  const missingPrices = catalog.filter((p) => p.cashPrice.state !== 'VERIFIED').length;
  if (missingPrices) nextActions.push(`تحديث سعر ${missingPrices} منتجاً غير موثّق السعر.`);
  if (!nextActions.length) nextActions.push('لا إجراءات عاجلة — البيانات الحالية لا تُظهر فرصاً أو فجوات.');

  return {
    generatedAt: new Date(now).toISOString(),
    catalog,
    intents,
    leads,
    lostOpportunities,
    followUps,
    handoffs,
    attributions,
    funnel,
    reasoning,
    demandAggregates,
    events,
    summary,
    limitations: [
      'كل الأرقام من سجلات حقيقية فقط؛ غير المتاح يُعلن ولا يُخترع.',
      'إشارة الشراء ليست بيعاً؛ البيع الموثّق يحتاج معرّف بيع حقيقي.',
      'الإسناد لا يُعلن سببية عند الشك (UNCERTAIN).',
      'لا رسائل/نشر خارجي في هذه الطبقة — قراءة وتحضير فقط.',
    ],
    nextActions,
    note: 'عقل المبيعات الرقمية: يفهم الاستفسار، يتحقّق من المعلومة الحقيقية، يؤهّل، يحضّر متابعة آمنة، ويحوّل الغامض للبشر — بلا اختراع.',
  };
}

export const LEAD_STAGE_LABELS = LEAD_STAGE_LABELS_AR;
