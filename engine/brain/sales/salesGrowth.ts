/**
 * Sales & Growth Foundation — نقطة الامتداد الآمنة للعقل التجاري (منطق خالص).
 *
 * **هذه ليست العقل التجاري الكامل.** هي طبقة تجميع تحضيرية تُظهر، من بيانات
 * حقيقية فقط، ما هو جاهز الآن وما ينقص قبل بناء المحرّك الكامل في الدفعة التالية:
 *   catalog readiness · demand signals · market opportunities · journey summary
 *   sales reasoning · marketing ROI · campaign completeness · epistemic audit.
 *
 * القواعد الملزمة:
 * - لا تُبنى على متغيّرات البيئة ولا شبكة ولا أسرار: المدخلات تُحقن بالكامل.
 * - لا تُوصل بأي مسار في هذه الدفعة (لا server ولا واجهة) — امتداد معزول.
 * - كل مخرج يحمل مصدره وعيّنته وحدوده، والمجهول يُعلن ولا يُخترع.
 *
 * منطق خالص قابل للاختبار.
 */

import type { PlatformId } from '../../social/adapter';
import type { ClassifiedConversation } from '../audience/conversationIntelligence';
import { type CatalogProduct, catalogReadiness, describeMissingInfo, type CatalogReadiness } from '../knowledge/catalog';
import { toDemandSignal, aggregateDemandSignals, summarizeDemand, type DemandSignal, type DemandSummary } from '../market/demandSignals';
import { buildOpportunityFromDemand, summarizeOpportunities, validateEpistemicSeparation, type MarketOpportunity, type OpportunitySummary } from '../market/opportunityEngine';
import { type JourneyState, summarizeJourneys, type JourneySummary } from './journey';
import { reasonAboutSales, type SalesEvidenceInput, type SalesReasoningReport } from './salesReasoning';
import { buildRoiReport, type RoiFunnelInput, type RoiReport } from './roi';
import { summarizeCampaigns, type CampaignDefinition, type CampaignSummary } from './campaignIntelligence';

/** تفاعل حقيقي وارد (تعليق/رسالة) — الشكل الوحيد الذي تقبله الطبقة. */
export interface SalesInteraction {
  platform: PlatformId;
  externalId: string;
  text: string;
  at?: string | null;
  productId?: string | null;
  classification: ClassifiedConversation;
}

/** مدخلات الطبقة كاملة — تُجمَّع في الخادم لاحقاً (خارج هذه الدفعة). */
export interface SalesGrowthInput {
  now: number;
  platforms: PlatformId[];
  catalog: CatalogProduct[];
  interactions: SalesInteraction[];
  journeys: JourneyState[];
  salesEvidence: SalesEvidenceInput[];
  roi: RoiFunnelInput;
  campaigns: CampaignDefinition[];
  /** ربط إشارة الطلب بالمنتج يقع بمعرّف صريح فقط، لا بتخمين النص. */
  demandProductLinks?: Record<string, string | null>;
}

export interface SalesGrowthFoundationReport {
  generatedAt: string;
  catalog: CatalogReadiness;
  demand: DemandSummary;
  opportunities: MarketOpportunity[];
  opportunitySummary: OpportunitySummary;
  journeys: JourneySummary;
  salesReasoning: SalesReasoningReport[];
  roi: RoiReport;
  campaigns: CampaignSummary;
  /** نتائج فحص الفصل المعرفي — يجب أن تكون كلها صحيحة. */
  epistemicAudit: { checked: number; valid: number; problems: string[] };
  /** ما ينقص فعلاً قبل بناء العقل الكامل. */
  readinessGaps: string[];
  limitations: string[];
  note: string;
}

/**
 * يبني تقرير الأساس التجاري من بيانات حقيقية فقط. لا يحكم على ما لا دليل عليه،
 * ويعلن الفجوات صراحةً.
 */
export function buildSalesGrowthFoundation(input: SalesGrowthInput): SalesGrowthFoundationReport {
  const now = input.now;

  // 1) إشارات الطلب من التفاعل الحقيقي (بلا اختراع نوع).
  const signals: DemandSignal[] = input.interactions.map((it) => {
    const signal = toDemandSignal({
      platform: it.platform,
      externalId: it.externalId,
      text: it.text,
      at: it.at ?? null,
      productId: input.demandProductLinks?.[it.externalId] ?? it.productId ?? null,
    });
    return signal;
  });
  const demandAggregates = aggregateDemandSignals({ signals });
  const demand = summarizeDemand(demandAggregates);

  // 2) الفرص من إشارات الطلب (فصل معرفي مفروض).
  const opportunities = demandAggregates.map((agg) => {
    const product = agg.productId ? input.catalog.find((p) => p.id === agg.productId) : undefined;
    const availabilityVerified = product ? product.availability.state === 'VERIFIED' : false;
    const inStock = product?.availability.value?.inStock ?? null;
    return buildOpportunityFromDemand({ aggregate: agg, platform: agg.productId ? undefined : 'cross_platform', availabilityVerified, availabilityInStock: inStock });
  });
  const opportunitySummary = summarizeOpportunities(opportunities);

  // 3) فحص الفصل المعرفي لكل فرصة.
  const epistemicProblems: string[] = [];
  let validOpportunities = 0;
  for (const o of opportunities) {
    const check = validateEpistemicSeparation(o);
    if (check.valid) validOpportunities += 1;
    else epistemicProblems.push(...check.problems.map((p) => `${o.id}: ${p}`));
  }

  // 4) الاستدلال التجاري لكل منتج له أدلة.
  const salesReasoning = input.salesEvidence.map((e) => reasonAboutSales(e));

  // 5) ROI + الحملات.
  const roi = buildRoiReport(input.roi);
  const campaigns = summarizeCampaigns(input.campaigns);
  const journeys = summarizeJourneys(input.journeys);

  // 6) فجوات الجاهزية الحقيقية.
  const catalog = catalogReadiness(input.catalog);
  const readinessGaps: string[] = [];
  if (catalog.total === 0) readinessGaps.push('لا منتجات في المخزن التجاري — لا يمكن بناء أي إجابة سعرية/تقسيطية.');
  if (catalog.incomplete > 0) readinessGaps.push(`${catalog.incomplete} منتج ناقص المعلومة (سعر/توفر/تقسيط) — يحتاج تحديثاً من المالك.`);
  if (demand.insufficient > 0) readinessGaps.push(`${demand.insufficient} تجميعة طلب بعيّنة غير كافية — تحتاج مزيداً من التفاعل الحقيقي.`);
  if (!input.journeys.length) readinessGaps.push('لا حالات مسار عميل مسجّلة بعد.');
  if (!input.campaigns.length) readinessGaps.push('لا حملات معرّفة بفرضية ونتيجة متوقعة بعد.');
  if (roi.costPerLead.state === 'NOT_AVAILABLE') readinessGaps.push('لا تكلفة حملة/عملاء مسجّلون — لا يُحسب عائد.');

  const allMissing: string[] = input.catalog.flatMap((p) => describeMissingInfo(p));

  return {
    generatedAt: new Date(now).toISOString(),
    catalog,
    demand,
    opportunities,
    opportunitySummary,
    journeys,
    salesReasoning,
    roi,
    campaigns,
    epistemicAudit: { checked: opportunities.length, valid: validOpportunities, problems: epistemicProblems },
    readinessGaps,
    limitations: [
      'طبقة تحضير فقط: لا تنفيذ ولا نشر ولا رد؛ تبني البنية وتعلن الجاهزية.',
      'كل مخرج مبني على بيانات حقيقية مُحقونة؛ لا سعر ولا توفر ولا بيع يُخترع.',
      allMissing.length ? `معلومات ناقصة معلنة: ${[...new Set(allMissing)].join(' · ')}` : 'لا معلومات تجارية ناقصة في العيّنة الحالية.',
    ],
    note: 'أساس العقل التجاري: جاهزية المخزن + إشارات الطلب + الفرص + المسار + الاستدلال + ROI + الحملات — بلا تنفيذ وبلا اختراع.',
  };
}
