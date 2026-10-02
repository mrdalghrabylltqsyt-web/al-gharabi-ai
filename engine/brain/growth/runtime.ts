/**
 * Growth Runtime — تجميع عقل التسويق والطلب من بيانات الغرابي الحقيقية
 * (منطق خالص).
 *
 * يبني، من بيانات مساحة العمل الحقيقية فقط:
 *   المقاطع الجمهورية · فرص الطلب · مطابقة المنتج↔الجمهور · الحملات · التجارب ·
 *   القُمع البيعي وعنق الزجاجة · توجيه المحتوى العام (platform-agnostic).
 *
 * **العقل المركزي واحد**: لا عقل تسويقي منفصل لكل منصة. كل مخرج يحمل دليله
 * ومصدره وعيّنته وثقته وحدوده، والمجهول يُعلن ولا يُخترع.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import type { PlatformId } from '../../social/adapter';
import { classifyConversation, type ClassifiedConversation } from '../audience/conversationIntelligence';
import {
  buildCatalogFromWorkspace, approvedInstallmentRules, buildRoiInput,
  buildJourneysFromWorkspace,
  type CommercialRawData,
} from '../sales/commercialRuntime';
import type { CatalogProduct } from '../knowledge/catalog';
import { type JourneyState } from '../sales/journey';
import {
  deriveAudienceSegments, summarizeAudienceSegments,
  type AudienceSegment, type AudienceInteraction, type AudienceSegmentsSummary,
} from './segments';
import {
  detectDemandOpportunities, summarizeDemandDiscovery,
  type DemandDiscoveryOpportunity, type DemandDiscoverySummary,
} from './demandDiscovery';
import { matchProductsToAudience, summarizeMatches, type ProductAudienceMatchResult, type MatchSummary } from './matching';
import { buildCampaignFromOpportunity, summarizeGrowthCampaigns, type MarketingCampaign, type CampaignsSummary } from './campaigns';
import {
  proposeExperimentForOpportunity, summarizeExperiments,
  type MarketingExperiment, type ExperimentsSummary,
} from './experiments';
import { buildSalesFunnel, summarizeSalesFunnel, type SalesFunnel, type SalesFunnelSummary } from './funnel';
import { PLATFORM_CONTENT_PROFILES } from '../../social/contentIntelligence';

function clean(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function asPlatformId(value: unknown): PlatformId {
  return typeof value === 'string' && value && value !== 'cross_platform' ? (value as PlatformId) : ('other' as PlatformId);
}

/** يبني تفاعلات العقل من تعليقات السوشيال الحقيقية + فئة المنتج المسجّلة. */
export function buildAudienceInteractions(input: {
  socialComments?: any[];
  catalog: CatalogProduct[];
}): AudienceInteraction[] {
  const categoryByProduct = new Map(input.catalog.map((p) => [p.id, p.category]));
  return (input.socialComments || [])
    .filter((c) => c && typeof c.platform === 'string' && typeof c.text === 'string' && c.text.trim())
    .slice(0, 2000)
    .map((c) => {
      const platform = String(c.platform) as PlatformId;
      const externalId = clean(c.externalId, 200) || clean(c.id, 200);
      const productId = clean(c.productId, 100) || null;
      const classification: ClassifiedConversation = classifyConversation({ platform, externalId, text: String(c.text) });
      return {
        platform,
        externalId,
        text: String(c.text),
        at: typeof c.createdAt === 'string' ? c.createdAt : null,
        productId,
        productCategory: productId ? (categoryByProduct.get(productId) ?? null) : null,
        classification,
      };
    });
}

/** توجيه المحتوى العام: العقل المركزي يقرّر WHAT/WHY/WHO/WHEN، والمنصة تنسّق فقط. */
export interface PlatformContentBrief {
  platform: PlatformId;
  format: string;
  titleLimit: number;
  bodyLimit: number;
  mediaRequired: boolean;
  notes: string;
}

/** يبني توجيهاً عاماً واحداً لكل منصة من الفرص/الحملات (بلا نسخ عقل لكل منصة). */
export function buildPlatformBriefs(campaigns: MarketingCampaign[]): PlatformContentBrief[] {
  const platforms = [...new Set(campaigns.flatMap((c) => c.platforms))];
  return platforms.map((p) => {
    const profile = PLATFORM_CONTENT_PROFILES[p];
    return {
      platform: p,
      format: profile.format,
      titleLimit: profile.titleLimit,
      bodyLimit: profile.bodyLimit,
      mediaRequired: profile.mediaRequired,
      notes: profile.notes,
    };
  });
}

export interface GrowthRawData extends CommercialRawData {}

export interface GrowthRuntime {
  generatedAt: string;
  catalog: CatalogProduct[];
  interactions: AudienceInteraction[];
  segments: AudienceSegment[];
  segmentSummary: AudienceSegmentsSummary;
  demandOpportunities: DemandDiscoveryOpportunity[];
  demandSummary: DemandDiscoverySummary;
  matches: ProductAudienceMatchResult[];
  matchSummary: MatchSummary;
  campaigns: MarketingCampaign[];
  campaignSummary: CampaignsSummary;
  experiments: MarketingExperiment[];
  experimentSummary: ExperimentsSummary;
  funnel: SalesFunnel;
  funnelSummary: SalesFunnelSummary;
  journeys: JourneyState[];
  platformBriefs: PlatformContentBrief[];
  /** إجراءات موصى بها للمالك (توجيه لا تنفيذ). */
  nextActions: string[];
  limitations: string[];
  note: string;
}

/**
 * يبني حالة عقل التسويق والطلب كاملة من بيانات حقيقية. لا ينفّذ ولا يخترع.
 */
export function buildGrowthRuntime(raw: GrowthRawData): GrowthRuntime {
  const now = raw.now;
  const catalog = buildCatalogFromWorkspace(raw.products || [], raw.installmentPlans || [], now);
  const interactions = buildAudienceInteractions({ socialComments: raw.socialComments, catalog });
  const hasInstallmentPlans = approvedInstallmentRules(raw.installmentPlans || []).length > 0;

  const segments = deriveAudienceSegments({ interactions, hasInstallmentPlans });
  const demandOpportunities = detectDemandOpportunities({
    interactions,
    catalogProductIds: catalog.map((p) => p.id),
  });
  const productCategories: Record<string, string | null> = {};
  for (const p of catalog) productCategories[p.id] = p.category;
  const matches = matchProductsToAudience({ products: catalog, segments, demandOpportunities, productCategories });

  // الحملات من الفرص ذات العيّنة الكافية فقط (لا حملة على ضجيج).
  const campaigns: MarketingCampaign[] = demandOpportunities
    .filter((o) => o.sufficientSample)
    .map((opp) => {
      const match = matches.find((m) => m.productId === opp.productId) || null;
      const segment = segments.find((s) => s.state === 'SUPPORTED') || segments[0] || null;
      return buildCampaignFromOpportunity({ opportunity: opp, segment, match, now });
    });

  // تجربة مقترحة لكل حملة (بلا تنفيذ) — متغيّر واحد.
  const experiments: MarketingExperiment[] = campaigns.map((c, i) =>
    proposeExperimentForOpportunity({
      id: `growth-exp:${i + 1}:${c.productId || 'general'}`,
      opportunityKind: demandOpportunities.find((o) => o.id === c.demandSignalRef)?.kind || 'repeated_question',
      opportunityRef: c.demandSignalRef,
      productName: c.productName,
      now,
    }).experiment,
  );

  const journeys = buildJourneysFromWorkspace({
    now,
    conversations: raw.conversations,
    leads: raw.leads,
    sales: raw.sales,
    socialComments: raw.socialComments,
  });

  // القُمع البيعي من سجلات حقيقية فقط؛ الغائب null (غير متاح) لا صفر.
  const roiInput = buildRoiInput({
    performanceRecords: raw.performanceRecords,
    demandSignals: interactions.filter((i) => i.classification.category === 'purchase_intent').length,
    leads: raw.leads,
    sales: raw.sales,
  });
  const engagement = roiInput.engagement;
  const funnel = buildSalesFunnel({
    reach: roiInput.reach,
    interest: engagement,
    inquiries: roiInput.inquiries,
    leads: roiInput.leads,
    verifiedSales: roiInput.verifiedSales,
  });

  const platformBriefs = buildPlatformBriefs(campaigns);

  const nextActions: string[] = [];
  if (funnel.bottleneck) nextActions.push(funnel.bottleneck.recommendedAction);
  for (const o of demandOpportunities.filter((x) => x.requiresOwnerAction).slice(0, 5)) nextActions.push(o.recommendedAction);
  if (!demandOpportunities.length) nextActions.push('لا إشارات طلب كافية بعد — اجمع تفاعلاً حقيقياً قبل أي حملة.');
  if (!campaigns.length) nextActions.push('لا حملات مؤهّلة (تحتاج فرصة طلب بعيّنة كافية) — لا تُخترع حملة.');

  return {
    generatedAt: new Date(now).toISOString(),
    catalog,
    interactions,
    segments,
    segmentSummary: summarizeAudienceSegments(segments),
    demandOpportunities,
    demandSummary: summarizeDemandDiscovery(demandOpportunities),
    matches,
    matchSummary: summarizeMatches(matches),
    campaigns,
    campaignSummary: summarizeGrowthCampaigns(campaigns),
    experiments,
    experimentSummary: summarizeExperiments(experiments),
    funnel,
    funnelSummary: summarizeSalesFunnel(funnel),
    journeys,
    platformBriefs,
    nextActions: [...new Set(nextActions)],
    limitations: [
      'عقل تسويق واحد لكل المنصات: لا عقل منفصل لكل منصة؛ المنصة تنسّق التنسيق فقط.',
      'لا اختراع جمهور ولا وصول ولا بيع ولا نتيجة حملة؛ غير المتاح يُعلن صراحةً.',
      'لا تنفيذ خارجي في هذه الطبقة: كل المخرجات تحليل وتوصية قابلة للتفسير.',
    ],
    note: 'عقل التسويق والطلب: مقاطع جمهور + فرص طلب + مطابقة منتج↔جمهور + حملات + تجارب + قُمع بيعي — كلها بأدلة حقيقية وبلا اختراع.',
  };
}
