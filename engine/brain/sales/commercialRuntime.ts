/**
 * Commercial Runtime — ربط العقل التجاري ببيانات الغرابي الحقيقية (منطق خالص).
 *
 * يحوّل بيانات مساحة العمل الحقيقية (منتجات، خطط تقسيط، محادثات، عملاء محتملون،
 * مبيعات، دفعات، تعليقات، حملات، سجلات أداء) إلى مدخلات العقل التجاري الموحّدة،
 * ثم يبني تقرير الأساس عبر `buildSalesGrowthFoundation`.
 *
 * قواعد ملزمة:
 * - كل معلومة تجارية تُوسَم بمصدرها وحالتها؛ والغائب يُعلن لا يُخترع.
 * - لا اتصال شبكي ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 * - الربط بالمنتج يقع بمعرّف صريح من السجل فقط، لا بتخمين النص.
 *
 * منطق خالص قابل للاختبار.
 */

import type { PlatformId } from '../../social/adapter';
import { classifyConversation, type ClassifiedConversation } from '../audience/conversationIntelligence';
import {
  catalogProductFromWorkspace, deriveInstallmentOffer, catalogReadiness,
  type CatalogProduct, type CatalogReadiness, type ApprovedInstallmentRule,
} from '../knowledge/catalog';
import {
  toDemandSignal, aggregateDemandSignals, type DemandSignal, type DemandAggregate,
} from '../market/demandSignals';
import { buildOpportunityFromDemand, type MarketOpportunity } from '../market/opportunityEngine';
import {
  newJourneyState, stageFromInteraction, advanceJourney, promoteToLead,
  promoteToRequest, verifySale, type JourneyState,
} from './journey';
import { type SalesInteraction, buildSalesGrowthFoundation, type SalesGrowthFoundationReport } from './salesGrowth';
import { type SalesEvidenceInput } from './salesReasoning';
import { type RoiFunnelInput } from './roi';
import { buildCampaignDraft, type CampaignDefinition } from './campaignIntelligence';
import type { GoalKind } from '../goals/goalEngine';

/** بيانات الغرابي الخام كما هي محفوظة في مساحة العمل (بلا تحويل مسبق). */
export interface CommercialRawData {
  now: number;
  showroom?: any;
  products?: any[];
  installmentPlans?: any[];
  conversations?: any[];
  leads?: any[];
  sales?: any[];
  payments?: any[];
  socialComments?: any[];
  campaigns?: any[];
  performanceRecords?: any[];
}

/** تحويل داخلي: مفتاح عميل موحّد (هاتف مقدَّم على الاسم) — لا يُخترع. */
function customerKeyOf(input: { phone?: unknown; customerName?: unknown; name?: unknown }): string | null {
  const phone = typeof input.phone === 'string' ? input.phone.replace(/\D+/g, '') : '';
  if (phone) return `phone:${phone}`;
  const name = typeof input.customerName === 'string' ? input.customerName.trim() : (typeof input.name === 'string' ? input.name.trim() : '');
  return name ? `name:${name.toLowerCase()}` : null;
}

function clean(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** يحسم منصة صالحة للتصنيف؛ `cross_platform` ليس منصة حقيقية فيُستخدم بديل محايد. */
function asPlatformId(value: unknown): PlatformId {
  return typeof value === 'string' && value && value !== 'cross_platform' ? (value as PlatformId) : ('other' as PlatformId);
}

/**
 * قواعد التقسيط المعتمدة: تُشتقّ من خطط التقسيط المسجّلة في المعرض فقط.
 * لا تُخترع قاعدة؛ وغياب الخطة يعني عدم وجود عرض مشتق.
 */
export function approvedInstallmentRules(plans: any[]): ApprovedInstallmentRule[] {
  return (plans || [])
    .map((p) => {
      const months = Math.floor(Number(p?.maxMonths));
      const down = Number(p?.minDownPaymentPercent);
      if (!Number.isFinite(months) || months <= 0) return null;
      return {
        durationMonths: Math.max(1, Math.min(60, months)),
        downPaymentPercent: Number.isFinite(down) ? Math.max(0, Math.min(99, down)) : 0,
        conditions: Array.isArray(p?.requirements) ? p.requirements.filter((x: any) => typeof x === 'string').slice(0, 10) : [],
      } as ApprovedInstallmentRule;
    })
    .filter((x): x is ApprovedInstallmentRule => Boolean(x));
}

/**
 * يبني كتالوج العقل من منتجات المعرض الحقيقية + قواعد التقسيط المعتمدة.
 * السعر/التوفر الموثّقان يُوسَمان VERIFIED؛ وعروض التقسيط تُشتقّ فقط من سعر
 * موثّق + قاعدة معتمدة (DERIVED)، وإلا تبقى غير متاحة.
 */
export function buildCatalogFromWorkspace(products: any[], plans: any[], now: number): CatalogProduct[] {
  const rules = approvedInstallmentRules(plans);
  const defaultRule: ApprovedInstallmentRule | null = rules.length ? rules[rules.length - 1] : null;
  return (products || []).map((raw) => {
    const product = catalogProductFromWorkspace(raw, now);
    // عرض تقسيط مشتقّ من قاعدة معتمدة إن وُجدت؛ ولا قاعدة ⇒ لا عرض.
    const ruleMonths = Math.floor(Number(raw?.durationMonths));
    const rulePercent = Number(raw?.downPaymentPercent);
    const rule: ApprovedInstallmentRule | null = (Number.isFinite(ruleMonths) && ruleMonths > 0)
      ? { durationMonths: Math.max(1, Math.min(60, ruleMonths)), downPaymentPercent: Number.isFinite(rulePercent) ? Math.max(0, Math.min(99, rulePercent)) : 0 }
      : defaultRule;
    if (rule) {
      const offer = deriveInstallmentOffer({ cashPrice: product.cashPrice, rule, source: 'approved_installment_rule', now });
      // لا نُدرج عرضاً غير قابل للاستخدام (بلا سعر موثّق) حتى لا نوهم بقدرة إجابة.
      if (offer.state === 'DERIVED') product.installmentOffers = [offer];
    }
    return product;
  });
}

/**
 * يبني تفاعلات العقل من تعليقات السوشيال الحقيقية. المنتج يُربط بمعرّف صريح
 * فقط (لا يُستنتج من النص).
 */
export function buildInteractionsFromComments(comments: any[]): SalesInteraction[] {
  return (comments || [])
    .filter((c) => c && typeof c.platform === 'string' && typeof c.text === 'string' && c.text.trim())
    .slice(0, 2000)
    .map((c) => {
      const platform = String(c.platform) as PlatformId;
      const externalId = clean(c.externalId, 200) || clean(c.id, 200);
      const classification: ClassifiedConversation = classifyConversation({ platform, externalId, text: String(c.text) });
      return {
        platform,
        externalId,
        text: String(c.text),
        at: typeof c.createdAt === 'string' ? c.createdAt : null,
        productId: clean(c.productId, 100) || null,
        classification,
      };
    });
}

/**
 * يبني حالات مسار العميل من بنى حقيقية: محادثات (تفاعل/استفسار/إشارة شراء)،
 * عملاء محتملون (LEAD/REQUEST)، ومبيعات (VERIFIED_SALE بمعرّف بيع حقيقي).
 * لا يُرقّى أحد إلى مشترٍ بلا سجل بيع.
 */
export function buildJourneysFromWorkspace(input: {
  now: number;
  conversations?: any[];
  leads?: any[];
  sales?: any[];
  socialComments?: any[];
}): JourneyState[] {
  const byKey = new Map<string, JourneyState>();
  const ensure = (key: string, platform: PlatformId | 'cross_platform', productId: string | null) => {
    if (!byKey.has(key)) byKey.set(key, newJourneyState({ subjectKey: key, platform, productId, now: input.now }));
    return byKey.get(key)!;
  };

  // 1) المحادثات: تصنيف آخر رسالة عميل → استفسار/تفاعل/إشارة شراء.
  for (const conv of input.conversations || []) {
    const key = customerKeyOf({ phone: conv?.phone, customerName: conv?.customerName });
    if (!key) continue;
    const channel = typeof conv?.channel === 'string' ? (conv.channel as PlatformId) : 'cross_platform';
    const productId = clean(conv?.interestedProduct, 100) || null;
    let state = ensure(key, channel, productId);
    const history = Array.isArray(conv?.history) ? conv.history : [];
    const customerMessages = history.filter((m: any) => m && m.sender === 'customer' && typeof m.text === 'string');
    for (const msg of customerMessages.slice(-10)) {
      const cls = classifyConversation({ platform: asPlatformId(channel), externalId: String(msg?.id || 'msg'), text: String(msg.text) });
      state = advanceJourney(state, stageFromInteraction({ platform: asPlatformId(channel), category: cls.category, isBusinessInquiry: cls.category === 'purchase_intent' }), input.now);
    }
    byKey.set(key, state);
  }

  // 2) التعليقات الاجتماعية: مسار لكل مؤلّف حقيقي (بالاسم فقط إن وُجد).
  for (const c of input.socialComments || []) {
    const author = clean(c?.authorName, 120);
    if (!author || typeof c?.text !== 'string') continue;
    const platform = typeof c?.platform === 'string' ? (c.platform as PlatformId) : 'cross_platform';
    const key = customerKeyOf({ customerName: author });
    if (!key) continue;
    let state = ensure(key, platform, null);
    const cls = classifyConversation({ platform: asPlatformId(platform), externalId: clean(c?.externalId, 200) || clean(c?.id, 200), text: String(c.text) });
    state = advanceJourney(state, stageFromInteraction({ platform: asPlatformId(platform), category: cls.category, isBusinessInquiry: cls.category === 'purchase_intent' }), input.now);
    byKey.set(key, state);
  }

  // 3) العملاء المحتملون: LEAD، وREQUEST عند وجود عرض سعر.
  for (const lead of input.leads || []) {
    const key = customerKeyOf({ phone: lead?.phone, customerName: lead?.customerName });
    if (!key) continue;
    const channel = typeof lead?.channel === 'string' ? (lead.channel as PlatformId) : 'cross_platform';
    let state = ensure(key, channel, null);
    state = promoteToLead(state, { source: 'crm:workspace.leads', reason: `عميل محتمل مسجّل (${clean(lead?.status, 40) || 'new'}).` }, input.now);
    if (String(lead?.status) === 'proposal') {
      state = promoteToRequest(state, { source: 'crm:workspace.leads', reason: 'العميل في مرحلة عرض السعر.' }, input.now);
    }
    byKey.set(key, state);
  }

  // 4) المبيعات: VERIFIED_SALE فقط بمعرّف عملية بيع حقيقي.
  for (const sale of input.sales || []) {
    if (String(sale?.status) === 'cancelled') continue;
    const key = customerKeyOf({ phone: sale?.phone, customerName: sale?.customerName });
    if (!key) continue;
    let state = ensure(key, 'cross_platform', clean(sale?.productId, 100) || null);
    state = promoteToLead(state, { source: 'sales:workspace.sales', reason: 'سجل بيع حقيقي.' }, input.now);
    state = promoteToRequest(state, { source: 'sales:workspace.sales', reason: 'طلب مسجّل.' }, input.now);
    state = verifySale(state, { source: 'sales:workspace.sales', reason: `عملية بيع ${clean(sale?.productName, 160) || ''}`.trim(), saleId: clean(sale?.id, 100) || null }, input.now);
    byKey.set(key, state);
  }

  return [...byKey.values()];
}

/** يحوّل مبيعات حقيقية إلى إيراد موثّق (بلا اختلاق). */
function verifiedRevenue(sales: any[]): number {
  return (sales || [])
    .filter((s) => s && String(s.status) !== 'cancelled')
    .reduce((n, s) => n + Math.max(0, Number(s.totalAmount) || 0), 0);
}

/** يبني مدخل ROI من سجلات حقيقية فقط؛ الغائب يبقى null (غير متاح). */
export function buildRoiInput(input: {
  performanceRecords?: any[];
  demandSignals: number;
  leads?: any[];
  sales?: any[];
}): RoiFunnelInput {
  const records = input.performanceRecords || [];
  const hasReach = records.some((r) => Number.isFinite(Number(r?.values?.reach)));
  const reach = hasReach ? records.reduce((n, r) => n + (Number(r?.values?.reach) || 0), 0) : null;
  const hasEngagement = records.length > 0;
  const engagement = hasEngagement
    ? records.reduce((n, r) => n + (Number(r?.values?.likes) || 0) + (Number(r?.values?.comments) || 0) + (Number(r?.values?.shares) || 0), 0)
    : null;
  const leads = input.leads || [];
  const sales = input.sales || [];
  const activeSales = sales.filter((s) => s && String(s.status) !== 'cancelled');
  return {
    reach,
    engagement,
    inquiries: input.demandSignals,
    leads: leads.length,
    requests: leads.filter((l) => String(l?.status) === 'proposal').length,
    verifiedSales: activeSales.length,
    revenue: verifiedRevenue(activeSales),
    // تكلفة الحملة غير مسجّلة في النظام ⇒ لا يُحسب عائد بلا تكلفة.
    campaignCost: null,
    source: 'سجلات مساحة العمل الحقيقية',
  };
}

/** يحوّل حملات المعرض المحفوظة إلى تعريف حملة العقل (بلا اختراع فرضية/نتيجة). */
export function buildCampaignsFromWorkspace(campaigns: any[], now: number): CampaignDefinition[] {
  return (campaigns || []).map((c) => {
    const products = Array.isArray(c?.products) ? c.products : [];
    const first = products[0] || null;
    const goalRaw = String(c?.goal || '').toUpperCase();
    const goal: GoalKind = (['SALES', 'LEADS', 'TRUST', 'ENGAGEMENT', 'PRODUCT_AWARENESS'] as GoalKind[]).includes(goalRaw as GoalKind)
      ? (goalRaw as GoalKind) : 'SALES';
    const draft = buildCampaignDraft({
      id: clean(c?.id, 100),
      // الحملات القديمة لا تحمل «لماذا» صريحاً؛ نستخدم المهمة المسجّلة أو نتركها فارغة لتُكشف الفجوة.
      objective: clean(c?.task, 200) || clean(c?.name, 200),
      goal,
      productId: clean(first?.id, 100) || null,
      productName: clean(first?.name, 160) || null,
      targetAudience: '',
      demandSignalRef: null,
      hypothesis: '',
      message: '',
      cta: '',
      platforms: (Array.isArray(c?.platforms) ? c.platforms.filter((p: any) => typeof p === 'string') : []) as PlatformId[],
      createdBy: clean(c?.createdBy, 100) || 'system',
      expectedOutcome: { metric: '', labelAr: '', measurable: false },
      now: Number.isFinite(Date.parse(c?.createdAt)) ? Date.parse(c.createdAt) : now,
    });
    return { ...draft, status: ['draft', 'planned', 'running', 'concluded', 'archived'].includes(String(c?.status)) ? c.status : 'draft' };
  });
}

/** يبني أدلة الاستدلال التجاري لكل منتج من بيانات حقيقية (بلا تقدير). */
export function buildSalesEvidence(input: {
  catalog: CatalogProduct[];
  demandSignals: DemandSignal[];
  sales?: any[];
  leads?: any[];
  campaigns?: any[];
  records?: any[];
  conversations?: any[];
}): SalesEvidenceInput[] {
  const sales = (input.sales || []).filter((s) => s && String(s.status) !== 'cancelled');
  const leads = input.leads || [];
  const records = input.records || [];
  return input.catalog.map((p) => {
    const productSignals = input.demandSignals.filter((s) => s.productId === p.id);
    const qualified = productSignals.filter((s) => s.kind === 'purchase_intent' || s.kind === 'price_inquiry' || s.kind === 'installment_inquiry');
    const objections = productSignals.filter((s) => s.kind === 'objection' || s.kind === 'complaint').length;
    const productSales = sales.filter((s) => String(s?.productId || '') === p.id);
    const productLeads = leads.filter((l) => clean(l?.interestedProduct, 160) === p.name);
    const productRecords = records.filter((r) => clean(r?.productCategory, 80) === p.category);
    const hasReach = productRecords.some((r) => Number.isFinite(Number(r?.values?.reach)));
    return {
      productId: p.id,
      productName: p.name,
      priceVerified: p.cashPrice.state === 'VERIFIED',
      availabilityVerified: p.availability.state === 'VERIFIED',
      inStock: p.availability.value ? p.availability.value.inStock : null,
      installmentVerified: p.installmentOffers.some((o) => o.state === 'VERIFIED' || o.state === 'DERIVED'),
      contentCount: productRecords.length,
      demandSignals: productSignals.length,
      qualifiedInquiries: qualified.length,
      objections,
      hasCta: productRecords.some((r) => typeof r?.ctaType === 'string' && r.ctaType.trim().length > 0),
      reach: hasReach ? productRecords.reduce((n, r) => n + (Number(r?.values?.reach) || 0), 0) : null,
      leads: productLeads.length,
      verifiedSales: productSales.length,
      competitorMentions: 0,
    };
  });
}

export interface CommercialRuntime {
  generatedAt: string;
  catalog: CatalogProduct[];
  catalogReadiness: CatalogReadiness;
  interactions: SalesInteraction[];
  demandSignals: DemandSignal[];
  demandAggregates: DemandAggregate[];
  opportunities: MarketOpportunity[];
  journeys: JourneyState[];
  salesEvidence: SalesEvidenceInput[];
  campaigns: CampaignDefinition[];
  foundation: SalesGrowthFoundationReport;
}

/**
 * يبني الحالة التجارية الكاملة من بيانات الغرابي الحقيقية. لا ينفّذ ولا يخترع؛
 * كل مخرج قابل للتفسير ويحمل مصدره.
 */
export function buildCommercialRuntime(raw: CommercialRawData): CommercialRuntime {
  const now = raw.now;
  const catalog = buildCatalogFromWorkspace(raw.products || [], raw.installmentPlans || [], now);
  const interactions = buildInteractionsFromComments(raw.socialComments || []);

  const demandSignals: DemandSignal[] = interactions.map((it) => toDemandSignal({
    platform: it.platform,
    externalId: it.externalId,
    text: it.text,
    at: it.at ?? null,
    productId: it.productId ?? null,
  }));
  const demandAggregates = aggregateDemandSignals({ signals: demandSignals });

  const opportunities = demandAggregates.map((agg) => {
    const product = agg.productId ? catalog.find((p) => p.id === agg.productId) : undefined;
    return buildOpportunityFromDemand({
      aggregate: agg,
      platform: agg.productId ? undefined : 'cross_platform',
      availabilityVerified: product ? product.availability.state === 'VERIFIED' : false,
      availabilityInStock: product?.availability.value?.inStock ?? null,
    });
  });

  const journeys = buildJourneysFromWorkspace({
    now,
    conversations: raw.conversations,
    leads: raw.leads,
    sales: raw.sales,
    socialComments: raw.socialComments,
  });

  const campaigns = buildCampaignsFromWorkspace(raw.campaigns || [], now);
  const roi = buildRoiInput({
    performanceRecords: raw.performanceRecords,
    demandSignals: demandSignals.length,
    leads: raw.leads,
    sales: raw.sales,
  });
  const salesEvidence = buildSalesEvidence({
    catalog, demandSignals, sales: raw.sales, leads: raw.leads, campaigns: raw.campaigns, records: raw.performanceRecords, conversations: raw.conversations,
  });

  const foundation = buildSalesGrowthFoundation({
    now,
    platforms: [...new Set(interactions.map((i) => i.platform))] as PlatformId[],
    catalog,
    interactions,
    journeys,
    salesEvidence,
    roi,
    campaigns,
  });

  return {
    generatedAt: new Date(now).toISOString(),
    catalog,
    catalogReadiness: catalogReadiness(catalog),
    interactions,
    demandSignals,
    demandAggregates,
    opportunities,
    journeys,
    salesEvidence,
    campaigns,
    foundation,
  };
}
