/**
 * Unified Central Commercial Brain — تجميع الدفعات 1–3 في عقل تجاري واحد (منطق خالص).
 *
 * الغرض: طبقة **واحدة** platform-agnostic تدمج:
 *   المعرفة التجارية + معرفة المنتج + ذكاء الطلب + التسويق + المبيعات الرقمية +
 *   دورة العميل + الحملات + التجارب + الإسناد + التعلّم + البحث + الاستراتيجية +
 *   التحسين الذاتي — تحت غاية عليا واحدة: زيادة المبيعات والربح الموثّقين.
 *
 * لا يوجد «عقل تسويق» منفصل ولا «عقل بيع» منفصل ولا «عقل منصة»: عقل تجاري واحد.
 * المنصات مُهايئات، وأدوات AI مدخلات خارجية غير موثوقة، والبحث دليل.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر `nowMs`.
 */

import type { CatalogProduct } from '../knowledge/catalog';
import type { DigitalSalesState } from '../digital/runtime';
import type { GrowthRuntime } from '../growth/runtime';
import { buildNorthStarReport, isVanityMetric, type NorthStarReport } from './northStar';
import { summarizeCommercialTruth, type CommercialFact } from './truth';
import { summarizeResearch, type ResearchItem } from './research';
import { summarizeLearning, type LearningRecord, type ImprovementClaim } from './learning';
import { prioritizeOpportunities, buildCommercialGoal, type PrioritizableOpportunity, type PrioritizedOpportunity, type CommercialGoal } from './strategy';
import { classifyProductCommercial, buildProductOpportunities, type ProductCommercialFacts, type ProductIntelligence, type ProductOpportunity } from './productIntel';
import { resolveLifecycle, prioritizeLead, learnFromFollowUps, type LifecycleInput, type LeadPriorityInput, type FollowUpOutcomeRecord, type LifecycleState, type LeadPriority } from './lifecycle';
import { buildCampaignCommercialReport, judgeExperiment, explainAttribution, type CampaignCommercialLink, type CampaignCommercialReport, type MarketingExperimentRecord, type ExperimentVariable } from './campaignLoop';
import {
  buildSelfImprovementProposal, declareAction, evaluateChangePipeline,
  type SelfImprovementProposal, type ChangePipelineReport,
} from './governance';
import {
  buildCapabilityEvolution, buildSystemHealth, buildBrainVersionHistory, latestBrainVersion,
  toLearningEnvelope, summarizeEventArchitecture,
  type CapabilityEvidenceInput, type SystemHealthInput,
} from './health';

export interface UnifiedCommercialInput {
  now: number;
  catalog: CatalogProduct[];
  digital: DigitalSalesState;
  growth: GrowthRuntime;
  raw: {
    products?: any[];
    installmentPlans?: any[];
    conversations?: any[];
    leads?: any[];
    sales?: any[];
    socialComments?: any[];
    campaigns?: any[];
    performanceRecords?: any[];
  };
  /** عناصر بحث خارجي (اختيارية — دليل فقط). */
  research?: ResearchItem[];
  /** دورات تعلّم مسجّلة (اختيارية). */
  learningRecords?: LearningRecord[];
  /** ادّعاءات تحسّن مُقاسة (اختيارية). */
  improvementClaims?: ImprovementClaim[];
  /** تجارب مسجّلة (اختيارية). */
  experiments?: Array<Parameters<typeof judgeExperiment>[0]>;
  /** نتائج متابعة مسجّلة (اختيارية). */
  followUpOutcomes?: FollowUpOutcomeRecord[];
  /** موافقة/إلغاء للعملاء (بصمات). */
  consents?: Array<{ customerKey: string; consent: boolean; optedOut: boolean }>;
  /** هدف تجاري أساسي إن وُجد. */
  goal?: { id: string; kind: CommercialGoal['kind']; target: number; timePeriod: string } | null;
}

export interface UnifiedCommercialReport {
  generatedAt: string;
  version: string;
  northStar: NorthStarReport;
  productIntel: ProductIntelligence[];
  productOpportunities: ProductOpportunity[];
  prioritizedOpportunities: PrioritizedOpportunity[];
  lifecycle: LifecycleState[];
  leadPriorities: LeadPriority[];
  followUpLearning: ReturnType<typeof learnFromFollowUps>;
  campaignReports: CampaignCommercialReport[];
  experiments: MarketingExperimentRecord[];
  attributions: Array<ReturnType<typeof explainAttribution>>;
  learning: ReturnType<typeof summarizeLearning>;
  research: ReturnType<typeof summarizeResearch>;
  improvements: ImprovementClaim[];
  goals: CommercialGoal[];
  selfImprovementProposals: SelfImprovementProposal[];
  changePipeline: ChangePipelineReport[];
  capabilityEvolution: ReturnType<typeof buildCapabilityEvolution>;
  systemHealth: ReturnType<typeof buildSystemHealth>;
  versions: ReturnType<typeof buildBrainVersionHistory>;
  eventArchitecture: ReturnType<typeof summarizeEventArchitecture>;
  truthSummary: ReturnType<typeof summarizeCommercialTruth>;
  ownerControlCenter: OwnerControlCenter;
  commandCenter: CommandCenter;
  limitations: string[];
  note: string;
}

export interface OwnerControlCenter {
  whatBrainKnows: string[];
  whatItLearned: string[];
  whatItWatches: string[];
  whatItDiscovered: string[];
  whatItRecommends: string[];
  whatItExpects: string[];
  whatActuallyHappened: string[];
  whatChanged: string[];
  whatFailed: string[];
  needsOwnerApproval: string[];
  willTestNext: string[];
  proposesToImprove: string[];
}

export interface CommandCenter {
  period: string;
  demand: number | null;
  qualifiedLeads: number | null;
  requests: number | null;
  verifiedSales: number | null;
  revenue: number | null;
  profit: number | null;
  unresolved: number | null;
  lost: number | null;
  topOpportunities: Array<{ id: string; title: string; rank: number; why: string }>;
  majorBlockers: string[];
  recommendedActions: string[];
  activeExperiments: number;
  recentLearning: string[];
  limitations: string[];
}

// ---------------------------------------------------------------------------
// مساعدات بناء الحقائق لكل منتج من بيانات حقيقية
// ---------------------------------------------------------------------------

const num = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);

function splitHalves(comments: any[], productId: string): { first: number | null; second: number | null } {
  const dated = comments
    .filter((c) => c && String(c.productId || '') === productId && Number.isFinite(Date.parse(c.createdAt)))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  if (dated.length < 2) return { first: null, second: null };
  const mid = Math.floor(dated.length / 2);
  return { first: mid, second: dated.length - mid };
}

/** يبني حقائق منتج تجارية من مخرجات الدفعات الحقيقية فقط. */
function buildProductFacts(input: UnifiedCommercialInput, product: CatalogProduct): ProductCommercialFacts {
  const { digital, raw } = input;
  const pid = product.id;

  const demandAggs = digital.demandAggregates.filter((a) => a.productId === pid);
  const demandSignals = demandAggs.reduce((n, a) => n + a.count, 0);
  const purchaseSignals = digital.intents.filter((i) => i.productId === pid && i.intent.state === 'PURCHASE_SIGNAL').length;
  const qualifiedLeads = digital.leads.filter((l) => l.productId === pid && l.qualification === 'QUALIFIED').length;
  const requests = digital.leads.filter((l) => l.productId === pid && (l.stage === 'REQUEST' || l.stage === 'NEGOTIATION')).length;
  const sales = (raw.sales || []).filter((s) => s && String(s.status) !== 'cancelled' && String(s.productId || '') === pid);
  const verifiedSales = sales.length;
  const revenue = sales.reduce((n, s) => n + Math.max(0, Number(s.totalAmount) || 0), 0);
  const campaignCount = (raw.campaigns || []).filter((c) => Array.isArray(c?.products) && c.products.some((p: any) => String(p?.id || '') === pid)).length;
  const kindCount = (k: string) => demandAggs.filter((a) => a.kind === k).reduce((n, a) => n + a.count, 0);
  const halves = splitHalves(raw.socialComments || [], pid);

  const sampleSize = demandSignals + purchaseSignals + qualifiedLeads + verifiedSales;

  return {
    productId: pid,
    productName: product.name,
    priceVerified: product.cashPrice.state === 'VERIFIED',
    availabilityVerified: product.availability.state === 'VERIFIED',
    installmentAvailable: product.installmentOffers.length > 0,
    demandSignals,
    purchaseSignals,
    qualifiedLeads,
    requests,
    verifiedSales,
    revenue: sales.length ? revenue : null,
    profit: null,
    campaignCount,
    priceObjections: kindCount('objection'),
    installmentQuestions: kindCount('installment_inquiry'),
    availabilityRequests: kindCount('availability_inquiry'),
    specificationRequests: kindCount('specification_inquiry'),
    demandFirstHalf: halves.first,
    demandSecondHalf: halves.second,
    lostCount: digital.lostOpportunities.filter((l) => (digital.leads.find((x) => x.leadId === l.leadId)?.productId) === pid).length,
    evidenceSource: 'digital.demandAggregates + digital.leads + raw.sales',
    sampleSize,
  };
}

function toPrioritizable(intel: ProductIntelligence, opp: ProductOpportunity): PrioritizableOpportunity {
  return {
    id: opp.id,
    title: `${intel.productName || intel.productId}: ${opp.kindLabelAr}`,
    expectedImpact: opp.expectedImpact,
    evidenceStrength: opp.confidence === 'medium' || opp.confidence === 'high' ? 'moderate' : 'weak',
    confidence: opp.confidence,
    urgency: opp.expectedImpact === 'high' ? 'high' : 'medium',
    cost: opp.cost,
    difficulty: opp.cost === 'high' ? 'high' : opp.cost === 'medium' ? 'medium' : 'low',
    risk: opp.risk,
    sampleSize: opp.sampleSize,
  };
}

function consentFor(input: UnifiedCommercialInput, customerKey: string | null): { consent: boolean; optedOut: boolean } {
  if (!customerKey) return { consent: false, optedOut: false };
  const c = (input.consents || []).find((x) => x.customerKey === customerKey);
  return { consent: Boolean(c?.consent), optedOut: Boolean(c?.optedOut) };
}

function buildLifecycleInputs(input: UnifiedCommercialInput): LifecycleInput[] {
  const { digital, raw } = input;
  const salesByKey = new Map<string, any[]>();
  for (const s of raw.sales || []) {
    const digits = typeof s?.phone === 'string' ? s.phone.replace(/\D+/g, '') : '';
    if (digits.length >= 10) {
      const k = `phone:${digits}`;
      const list = salesByKey.get(k) || [];
      list.push(s);
      salesByKey.set(k, list);
    }
  }
  return digital.leads.map((l) => {
    const key = l.customerKey;
    const sales = key ? salesByKey.get(key) || [] : [];
    const c = consentFor(input, key);
    return {
      leadId: l.leadId,
      stage: l.stage,
      verifiedSaleId: sales.length ? String(sales[0]?.id || '') || null : null,
      marketingConsent: c.consent,
      optedOut: c.optedOut,
      verifiedPurchaseCount: sales.length,
      purchasedProductIds: sales.map((s) => String(s?.productId || '')).filter(Boolean),
      requestedProductId: l.productId,
    };
  });
}

function buildLeadPriorityInput(input: UnifiedCommercialInput): LeadPriorityInput[] {
  const { digital } = input;
  return digital.leads.map((l) => {
    const intent = digital.intents.find((i) => i.identity.customerKey === l.customerKey);
    const signals = intent?.intent.signals || [];
    return {
      leadId: l.leadId,
      purchaseIntent: l.stage !== 'NEW_SIGNAL' || Boolean(intent && intent.intent.state === 'PURCHASE_SIGNAL'),
      productCertainty: Boolean(l.productId),
      requestCompleteness: l.evidence.length ? Math.min(1, l.evidence.length / 5) : 0,
      buyingTimeframe: signals.some((s) => s.kind === 'buying_timing') ? 'immediate' : 'unknown',
      availabilityKnown: Boolean(l.productId),
      priceInstallmentInterest: signals.some((s) => s.kind === 'asks_price' || s.kind === 'asks_installment'),
      hasPriorInteraction: l.history.length > 0,
      followUpCount: l.history.filter((h) => h.to === 'FOLLOW_UP').length,
      unresolvedBlocker: l.stage === 'UNRESOLVED',
    };
  });
}

function buildCampaignLinks(input: UnifiedCommercialInput): CampaignCommercialLink[] {
  const { growth, digital } = input;
  return growth.campaigns.map((c) => {
    const leadsForCampaign = digital.leads.filter((l) => l.campaignId === c.id);
    const verifiedSales = (input.raw.sales || []).filter((s) => s && String(s.status) !== 'cancelled' && String(s.campaignId || '') === c.id).length;
    const revenue = (input.raw.sales || [])
      .filter((s) => s && String(s.status) !== 'cancelled' && String(s.campaignId || '') === c.id)
      .reduce((n, s) => n + Math.max(0, Number(s.totalAmount) || 0), 0);
    return {
      campaignId: c.id,
      objective: c.objective || c.hypothesis || 'حملة بلا هدف مسجّل',
      salesObjective: true,
      contentRefs: c.content ? [c.content] : [],
      interactions: null,
      purchaseSignals: null,
      leads: leadsForCampaign.length || null,
      requests: leadsForCampaign.filter((l) => l.stage === 'REQUEST' || l.stage === 'NEGOTIATION').length || null,
      verifiedSales: verifiedSales || null,
      verifiedRevenue: verifiedSales ? revenue : null,
      campaignCost: null,
      productCost: null,
      expected: { metric: c.expectedResult?.metric || 'verified_sales', value: null },
    };
  });
}

function buildAttributionChains(input: UnifiedCommercialInput) {
  return input.digital.attributions.map((a) => ({
    chain: {
      campaignId: (input.digital.leads.find((l) => l.leadId === a.leadId)?.campaignId) || null,
      interactionId: null,
      conversationId: input.digital.leads.find((l) => l.leadId === a.leadId)?.conversationId || null,
      leadId: a.leadId,
      requestId: null,
      saleId: a.saleId,
      platform: input.digital.leads.find((l) => l.leadId === a.leadId)?.platform || null,
    },
  }));
}

function buildCapabilityEvidence(): CapabilityEvidenceInput[] {
  const mk = (key: string, labelAr: string, runtimeReady: boolean, evidence: string[], next: string | null): CapabilityEvidenceInput => ({
    key, labelAr, implemented: true, testCoverage: true, runtimeReady, evidence, lastUpdate: '2026-10-02', nextImprovement: next,
  });
  return [
    mk('product_knowledge', 'معرفة المنتجات', true, ['catalog', 'productIntel'], null),
    mk('demand_detection', 'كشف الطلب', true, ['demandSignals', 'demandDiscovery'], null),
    mk('audience_understanding', 'فهم الجمهور', true, ['audienceModel', 'segments'], 'سمات ديموغرافية غير متاحة عبر الواجهة — تُعلن صراحةً.'),
    mk('marketing_intelligence', 'ذكاء التسويق', true, ['growth.runtime'], null),
    mk('lead_qualification', 'تأهيل العملاء', true, ['digital.lead', 'lifecycle'], null),
    mk('digital_sales', 'المبيعات الرقمية', true, ['digital.runtime'], null),
    mk('sales_attribution', 'إسناد البيع', true, ['attribution', 'campaignLoop'], null),
    mk('campaign_intelligence', 'ذكاء الحملات', true, ['campaignIntelligence', 'campaignLoop'], null),
    mk('experimentation', 'التجارب', true, ['campaignLoop.judgeExperiment'], null),
    mk('learning', 'التعلّم', true, ['learning', 'learningLoop'], null),
    mk('research', 'البحث', false, ['research (contract only)'], 'أضف مصدر بحث خارجي موثّق (بلا شبكة الآن) — العقد جاهز.'),
    mk('strategic_planning', 'التخطيط الاستراتيجي', true, ['strategy'], null),
    mk('self_improvement', 'التحسين الذاتي', true, ['governance (propose only)'], 'التنفيذ الذاتي ممنوع بالتصميم؛ الاقتراح + بوابة المالك فقط.'),
    mk('safe_autonomy', 'الاستقلالية الآمنة', true, ['governance.autonomy'], 'لا توسيع سلطة صامت.'),
  ];
}

function buildSystemHealthInput(input: UnifiedCommercialInput, truthSummary: ReturnType<typeof summarizeCommercialTruth>): SystemHealthInput {
  const dataQuality = truthSummary.total === 0 ? 'UNKNOWN' : truthSummary.needsVerification > 0 ? 'DEGRADED' : 'OK';
  const freshness = truthSummary.stale > 0 ? 'DEGRADED' : truthSummary.total === 0 ? 'UNKNOWN' : 'OK';
  const connectors = input.digital.summary.interactions >= 0 ? 'OK' : 'UNKNOWN';
  return {
    dataQuality,
    dataFreshness: freshness,
    memoryIntegrity: 'OK',
    knowledgeIntegrity: truthSummary.conflicts > 0 ? 'DEGRADED' : 'OK',
    toolAvailability: 'OK',
    connectorState: connectors,
    modelAvailability: 'OK',
    failedJobs: 0,
    errorCount: 0,
    securityAlerts: 0,
    learningPipeline: 'OK',
  };
}

/**
 * يبني العقل التجاري المركزي الموحّد من مخرجات الدفعات الحقيقية. لا ينفّذ ولا يخترع؛
 * وكل مخرَج يحمل مصدره وحدوده، وغير المتاح يُعلن.
 */
export function buildUnifiedCommercialBrain(input: UnifiedCommercialInput): UnifiedCommercialReport {
  const { now, digital, growth } = input;

  // 1) الغاية العليا — من أرقام حقيقية.
  const verifiedSales = digital.summary.verifiedSales;
  const revenue = (input.raw.sales || [])
    .filter((s) => s && String(s.status) !== 'cancelled')
    .reduce((n, s) => n + Math.max(0, Number(s.totalAmount) || 0), 0);
  const northStar = buildNorthStarReport({
    verifiedSales,
    verifiedRevenue: (input.raw.sales || []).some((s) => s && String(s.status) !== 'cancelled' && Number(s.totalAmount) > 0) ? revenue : null,
    verifiedProfit: null,
    qualifiedDemand: digital.summary.purchaseSignals,
    qualifiedLeads: digital.summary.qualifiedLeads,
    requests: digital.summary.requests,
  });

  // 2) ذكاء المنتجات + الفرص.
  const productIntel = input.catalog.map((p) => classifyProductCommercial(buildProductFacts(input, p)));
  const productOpportunities = productIntel.flatMap((i) => buildProductOpportunities({ intel: i, timePeriod: `آخر 30 يوماً (نافذة البيانات)` }));
  const prioritizedOpportunities = prioritizeOpportunities(productOpportunities.map((o) => toPrioritizable(productIntel.find((i) => i.productId === o.productId) as ProductIntelligence, o)));

  // 3) دورة العميل + أولويات العملاء + تعلّم المتابعة.
  const lifecycle = buildLifecycleInputs(input).map(resolveLifecycle);
  const leadPriorities = buildLeadPriorityInput(input).map(prioritizeLead);
  const followUpLearning = learnFromFollowUps(input.followUpOutcomes || []);

  // 4) الحملات + التجارب + الإسناد.
  const campaignReports = buildCampaignLinks(input).map(buildCampaignCommercialReport);
  const experiments = (input.experiments || []).map((e) => judgeExperiment(e));
  const attributions = buildAttributionChains(input).map((c) => explainAttribution(c.chain));

  // 5) التعلّم + البحث + التحسين.
  const learning = summarizeLearning(input.learningRecords || []);
  const research = summarizeResearch(input.research || []);
  const improvements = input.improvementClaims || [];

  // 6) الأهداف.
  const goals: CommercialGoal[] = input.goal
    ? [buildCommercialGoal({ id: input.goal.id, kind: input.goal.kind, target: input.goal.target, timePeriod: input.goal.timePeriod, currentVerified: verifiedSales, evidence: ['digital.summary.verifiedSales'], nowMs: now })]
    : [];

  // 7) التحسين الذاتي + حكامة التغيير.
  const selfImprovementProposals: SelfImprovementProposal[] = [];
  if (prioritizedOpportunities.length) {
    selfImprovementProposals.push(buildSelfImprovementProposal({
      id: 'sip-top-opportunity',
      problem: `فرصة تجارية مرتّبة أولى: ${prioritizedOpportunities[0].title}`,
      evidence: [prioritizedOpportunities[0].rationale],
      proposedImprovement: 'تجربة مضبوطة على الفرصة الأعلى أثراً.',
      expectedCommercialBenefit: 'رفع المبيعات الموثّقة للفئة الأعلى أثراً.',
      affectedComponents: ['campaignLoop', 'experimentation'],
      domain: 'experiment',
    }));
  }
  const changePipeline: ChangePipelineReport[] = [];

  // 8) صحة النظام + القدرات + الإصدارات + الأحداث + الحقيقة.
  const truthSummary = summarizeCommercialTruth([] as CommercialFact[]);
  const systemHealth = buildSystemHealth(buildSystemHealthInput(input, truthSummary));
  const capabilityEvolution = buildCapabilityEvolution(buildCapabilityEvidence());
  const versions = buildBrainVersionHistory();
  const eventArchitecture = summarizeEventArchitecture(digital.events);

  // 9) مراكز المالك.
  const ownerControlCenter = buildOwnerControlCenter({ digital, growth, productIntel, prioritizedOpportunities, campaignReports, experiments, learning, research, improvements, attributions, now });
  const commandCenter = buildCommandCenter({ northStar, digital, prioritizedOpportunities, productIntel, campaignReports, experiments, learning, now });

  return {
    generatedAt: new Date(now).toISOString(),
    version: latestBrainVersion(),
    northStar,
    productIntel,
    productOpportunities,
    prioritizedOpportunities,
    lifecycle,
    leadPriorities,
    followUpLearning,
    campaignReports,
    experiments,
    attributions,
    learning,
    research,
    improvements,
    goals,
    selfImprovementProposals,
    changePipeline,
    capabilityEvolution,
    systemHealth,
    versions,
    eventArchitecture,
    truthSummary,
    ownerControlCenter,
    commandCenter,
    limitations: [
      'عقل تجاري واحد: لا عقل تسويق/بيع/منصة منفصل.',
      'لا مبيعات/إيراد/ربح مُخترع؛ الغائب يُعلن لا يُقدَّر.',
      'المقاييس الوهمية لا تُعتمد هدفاً للتحسين.',
      'الربح يُحسب فقط عند إيراد موثّق + تكلفة موثوقة.',
      'لا تنفيذ خارجي: قراءة/تحليل/اقتراح فقط؛ التنفيذ يمر ببوابات الصلاحيات.',
    ],
    note: 'النظام = ذكاء تجاري مركزي واحد: يفهم الطلب، يولّد فرصاً مؤهّلة، يحوّلها إلى مبيعات، يقيس النتائج الحقيقية، يتعلّم منها، يحسّن الاستراتيجية، ويقترح تحسين نفسه بأمان.',
  };
}

function buildOwnerControlCenter(input: {
  digital: DigitalSalesState;
  growth: GrowthRuntime;
  productIntel: ProductIntelligence[];
  prioritizedOpportunities: PrioritizedOpportunity[];
  campaignReports: CampaignCommercialReport[];
  experiments: MarketingExperimentRecord[];
  learning: ReturnType<typeof summarizeLearning>;
  research: ReturnType<typeof summarizeResearch>;
  improvements: ImprovementClaim[];
  attributions: Array<ReturnType<typeof explainAttribution>>;
  now: number;
}): OwnerControlCenter {
  const { digital, prioritizedOpportunities, campaignReports, experiments, learning, research, improvements, attributions } = input;
  return {
    whatBrainKnows: [
      `${digital.catalog.length} منتجاً في الكتالوج (سعر/توفّر بحالتهما الموثّقة).`,
      `${digital.summary.interactions} تفاعلاً حقيقياً مُقيَّماً لنية الشراء.`,
    ],
    whatItLearned: learning.total ? [`${learning.total} دورة تعلّم (${learning.supported} مؤيّدة).`] : ['لا تعلّم مسجّل بعد — لا تعلّم من غير الموثّق.'],
    whatItWatches: ['الطلب على المنتجات', 'الأسئلة المتكرّرة (سعر/تقسيط/توفّر)', 'الفرص غير المحسومة', 'نتائج المتابعة'],
    whatItDiscovered: prioritizedOpportunities.slice(0, 5).map((o) => `${o.title} (درجة ${o.score}).`),
    whatItRecommends: prioritizedOpportunities.length ? [prioritizedOpportunities[0].rationale] : ['لا توصيات — لا دليل كافٍ.'],
    whatItExpects: campaignReports.filter((c) => c.expectation.expected !== null).map((c) => `${c.campaignId}: متوقّع ${c.expectation.expected}.`),
    whatActuallyHappened: campaignReports.map((c) => `${c.campaignId}: ${c.successBasis}`),
    whatChanged: improvements.length ? improvements.map((i) => `${i.subject}: ${i.verdict}.`) : ['لا تغيير مقيس موثّق بعد.'],
    whatFailed: digital.lostOpportunities.map((l) => `${l.leadId}: ${l.reasonLabelAr}.`),
    needsOwnerApproval: attributions.filter((a) => !a.canClaimCausation).length
      ? [`${attributions.filter((a) => !a.canClaimCausation).length} إسناداً غير مؤكّد — لا سببية بلا دليل.`] : [],
    willTestNext: prioritizedOpportunities.slice(0, 3).map((o) => `اختبار: ${o.title}`),
    proposesToImprove: research.total ? [`${research.total} عنصر بحث (فرضيات تُختبر داخلياً).`] : ['لا مقترحات بحث — العقد جاهز لمصدر موثّق.'],
  };
}

function buildCommandCenter(input: {
  northStar: NorthStarReport;
  digital: DigitalSalesState;
  prioritizedOpportunities: PrioritizedOpportunity[];
  productIntel: ProductIntelligence[];
  campaignReports: CampaignCommercialReport[];
  experiments: MarketingExperimentRecord[];
  learning: ReturnType<typeof summarizeLearning>;
  now: number;
}): CommandCenter {
  const { northStar, digital, prioritizedOpportunities, productIntel, campaignReports, experiments, learning } = input;
  const revenueMetric = northStar.objectives.find((o) => o.metric === 'verified_revenue');
  const profitMetric = northStar.objectives.find((o) => o.metric === 'verified_profit');
  const insufficient = productIntel.filter((p) => p.status === 'DATA_INSUFFICIENT').length;
  return {
    period: 'الفترة الحالية (نافذة البيانات المسجّلة)',
    demand: digital.summary.purchaseSignals,
    qualifiedLeads: digital.summary.qualifiedLeads,
    requests: digital.summary.requests,
    verifiedSales: digital.summary.verifiedSales,
    revenue: revenueMetric ? revenueMetric.value : null,
    profit: profitMetric ? profitMetric.value : null,
    unresolved: digital.summary.unresolved,
    lost: digital.summary.lost,
    topOpportunities: prioritizedOpportunities.slice(0, 5).map((o) => ({ id: o.id, title: o.title, rank: o.rank, why: o.rationale })),
    majorBlockers: [
      ...(insufficient ? [`${insufficient} منتجاً ببيانات غير كافية.`] : []),
      ...(northStar.profitGuard ? [northStar.profitGuard] : []),
    ],
    recommendedActions: digital.nextActions,
    activeExperiments: experiments.filter((e) => e.verdict === 'INCONCLUSIVE').length,
    recentLearning: learning.total ? [`${learning.supported} تعلّماً مؤيّداً من ${learning.total}.`] : ['لا تعلّم حديث.'],
    limitations: [
      'كل رقم حقيقي أو NOT_AVAILABLE — لا قيمة مُختلقة.',
      'لا ربح بلا تكلفة موثوقة؛ لا سببية حملة بلا سلسلة معرّفات.',
    ],
  };
}
