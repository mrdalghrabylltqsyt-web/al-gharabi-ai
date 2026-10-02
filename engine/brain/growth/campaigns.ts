/**
 * Campaign Intelligence — حملة لها سبب، مبنية على فرصة طلب حقيقية (منطق خالص).
 *
 * كل حملة تربط صراحةً:
 *   objective · product · audience · demandSignal · hypothesis · message · hook ·
 *   content · cta · platform · timing · expectedResult · actualResult · learning
 *
 * **لا حملة بلا سبب**: الهدف والفرضية والدعوة إلزامية، والحملة مشتقّة من فرصة
 * طلب حقيقية. النتائج الفعلية تُسجَّل من سجلات حقيقية فقط؛ الغائب يُعلن `null`.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../../social/adapter';
import type { DemandDiscoveryOpportunity } from './demandDiscovery';
import type { AudienceSegment } from './segments';
import type { ProductAudienceMatchResult } from './matching';

export type CampaignLifecycle = 'planned' | 'running' | 'concluded' | 'archived';

export const CAMPAIGN_LIFECYCLE_LABELS_AR: Record<CampaignLifecycle, string> = Object.freeze({
  planned: 'مخطّطة',
  running: 'قائمة',
  concluded: 'منتهية',
  archived: 'مؤرشفة',
});

/** نتيجة متوقعة قابلة للقياس؛ `measurable=false` يعني المؤشر غير متاح فعلاً. */
export interface ExpectedResult {
  metric: string;
  labelAr: string;
  measurable: boolean;
  reason?: string;
}

/** نتيجة فعلية من سجل حقيقي فقط. */
export interface ActualResult {
  metric: string;
  value: number | null;
  source: string | null;
  recordedAt: string | null;
}

export interface MarketingCampaign {
  id: string;
  /** لماذا نشغّلها؟ إلزامي. */
  objective: string;
  productId: string | null;
  productName: string | null;
  audienceSegmentId: string | null;
  audienceLabel: string;
  /** مرجع إشارة الطلب التي أطلقت الحملة. */
  demandSignalRef: string;
  hypothesis: string;
  message: string;
  hook: string;
  content: string;
  cta: string;
  platforms: PlatformId[];
  timing: { startAt: string | null; endAt: string | null; note: string };
  expectedResult: ExpectedResult;
  actualResult: ActualResult;
  /** أرقام حقيقية فقط؛ null = غير متاح. */
  leads: number | null;
  verifiedSales: number | null;
  revenue: number | null;
  learning: string | null;
  status: CampaignLifecycle;
  requiresOwnerApproval: boolean;
  /** فصل معرفي: هل سبب الحملة حقيقة/فرضية؟ */
  reasonBasis: 'FACT' | 'HYPOTHESIS';
  evidence: string[];
  source: string;
  limitations: string[];
}

/** هوك مبني على نوع الطلب (بلا أرقام غير مسجّلة). */
function hookFor(opp: DemandDiscoveryOpportunity, productName: string | null): string {
  const ref = productName || 'منتجنا';
  switch (opp.kind) {
    case 'repeated_price_request': return `كم سعر ${ref}؟ — الجواب الواضح هنا.`;
    case 'installment_interest': return `تريد ${ref} بالتقسيط؟ — الشروط خطوة بخطوة.`;
    case 'availability_request': return `${ref} متوفر؟ — تحقّق قبل ما تفوتك.`;
    case 'specification_request': return `${ref}: المواصفات كاملة قبل القرار.`;
    case 'repeated_objection': return `«${ref} غالي؟» — خلّينا نوضّح الصورة.`;
    case 'recurring_complaint': return `سمعنا ملاحظتكم — هذا ما نعالجه.`;
    case 'unmet_product_request': return `طلبتم ${ref}؟ — هذا المتاح عندنا.`;
    case 'rising_product_demand': return `${ref} عليه طلب متزايد — اعرف التفاصيل.`;
    default: return `${ref}: إجابات مباشرة على أسئلتكم.`;
  }
}

/**
 * يبني حملة من فرصة طلب + مقطع جمهور + مطابقة منتج. لا يُنشئ حملة بلا فرصة
 * حقيقية؛ السبب يبقى `HYPOTHESIS` عند نقص العيّنة و`FACT` عند كفايتها.
 */
export function buildCampaignFromOpportunity(input: {
  opportunity: DemandDiscoveryOpportunity;
  segment: AudienceSegment | null;
  match: ProductAudienceMatchResult | null;
  now: number;
}): MarketingCampaign {
  const opp = input.opportunity;
  const productName = input.match?.productName ?? null;
  const measurable = true;
  const expectedResult: ExpectedResult = {
    metric: opp.kind === 'repeated_price_request' || opp.kind === 'installment_interest' ? 'qualified_inquiries' : 'engagement',
    labelAr: opp.kind === 'repeated_price_request' || opp.kind === 'installment_interest'
      ? 'زيادة الاستفسارات المؤهّلة'
      : 'زيادة الإشارات المؤهّلة (أسئلة/تفاعل)',
    measurable,
  };
  return {
    id: `campaign:${opp.id}`,
    objective: `${opp.recommendation.statement}`,
    productId: opp.productId,
    productName,
    audienceSegmentId: input.segment?.id ?? null,
    audienceLabel: input.segment?.labelAr ?? 'جمهور غير محدّد بسمات سكانية (غير متاحة).',
    demandSignalRef: opp.id,
    hypothesis: opp.hypothesis.statement,
    message: input.match?.message || `${productName || 'منتجنا'} — تفاصيل مسجّلة من المعرض.`,
    hook: hookFor(opp, productName),
    content: input.match?.whatToShow || 'محتوى يشرح الطلب من بيانات موثّقة فقط.',
    cta: input.match?.cta || 'تواصل معنا عبر قنوات المعرض الرسمية.',
    platforms: input.match?.where && input.match.where.length ? input.match.where : (opp.platform === 'cross_platform' ? [] : [opp.platform]),
    timing: { startAt: null, endAt: null, note: 'التوقيت يُختار من عيّنة تفاعل حقيقية أو باختيار المالك — لا يُخترع.' },
    expectedResult,
    actualResult: { metric: expectedResult.metric, value: null, source: null, recordedAt: null },
    leads: null,
    verifiedSales: null,
    revenue: null,
    learning: null,
    status: 'planned',
    requiresOwnerApproval: true,
    reasonBasis: opp.sufficientSample ? 'FACT' : 'HYPOTHESIS',
    evidence: [...opp.evidence],
    source: 'فرصة طلب حقيقية + مقطع جمهور + مطابقة منتج',
    limitations: [
      'لا تُعلن نتيجة بلا سجل حقيقي؛ الأرقام الفعلية تُملأ من النظام لا من التقدير.',
      opp.sufficientSample ? 'السبب مبني على حقيقة ملاحَظة.' : 'السبب فرضية (عيّنة ناقصة) ولا يُعرض كحقيقة.',
    ],
  };
}

/** اكتمال الحملة — يكشف نقص السبب/الفرضية/CTA قبل التشغيل. */
export function campaignHasReason(campaign: MarketingCampaign): { complete: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!campaign.objective.trim()) missing.push('الهدف/السبب مفقود.');
  if (!campaign.hypothesis.trim()) missing.push('الفرضية مفقودة.');
  if (!campaign.message.trim()) missing.push('الرسالة مفقودة.');
  if (!campaign.hook.trim()) missing.push('الهوك مفقود.');
  if (!campaign.cta.trim()) missing.push('الدعوة للتواصل (CTA) مفقودة.');
  if (!campaign.demandSignalRef) missing.push('مرجع إشارة الطلب مفقود — لا حملة بلا سبب.');
  return { complete: missing.length === 0, missing };
}

/**
 * يسجّل نتيجة فعلية من سجل حقيقي فقط. بلا مصدر تُرفض صراحةً — لا نتيجة مُختلقة.
 */
export function recordActualResult(campaign: MarketingCampaign, input: {
  value: number | null;
  source: string | null;
  now: number;
}): { campaign: MarketingCampaign; recorded: boolean; reason: string } {
  if (!input.source) {
    return { campaign, recorded: false, reason: 'لا تُسجَّل نتيجة حملة بلا مصدر حقيقي.' };
  }
  return {
    campaign: {
      ...campaign,
      actualResult: { metric: campaign.expectedResult.metric, value: input.value, source: input.source, recordedAt: new Date(input.now).toISOString() },
      status: campaign.status === 'planned' ? 'running' : campaign.status,
    },
    recorded: true,
    reason: 'سُجّلت النتيجة من مصدر حقيقي.',
  };
}

/** يربط أرقاماً حقيقية (عملاء/مبيعات/إيراد) ويستنتج تعلّماً بلا اختراع. */
export function attachResults(campaign: MarketingCampaign, input: {
  leads?: number | null;
  verifiedSales?: number | null;
  revenue?: number | null;
}): MarketingCampaign {
  const leads = input.leads ?? campaign.leads;
  const sales = input.verifiedSales ?? campaign.verifiedSales;
  const learning = (sales !== null && sales > 0)
    ? `الحملة ارتبطت بـ${sales} بيعاً موثّقاً — تُدرس الفرضية على عيّنة أوسع.`
    : (leads !== null && leads > 0)
      ? `الحملة ولّدت ${leads} عميلاً محتملاً بلا بيع موثّق بعد — راجع المتابعة.`
      : campaign.learning;
  return {
    ...campaign,
    leads,
    verifiedSales: sales,
    revenue: input.revenue ?? campaign.revenue,
    learning,
  };
}

export interface CampaignsSummary {
  total: number;
  planned: number;
  running: number;
  concluded: number;
  withReason: number;
  withActualResult: number;
  note: string;
}

export function summarizeGrowthCampaigns(campaigns: MarketingCampaign[]): CampaignsSummary {
  return {
    total: campaigns.length,
    planned: campaigns.filter((c) => c.status === 'planned').length,
    running: campaigns.filter((c) => c.status === 'running').length,
    concluded: campaigns.filter((c) => c.status === 'concluded').length,
    withReason: campaigns.filter((c) => campaignHasReason(c).complete).length,
    withActualResult: campaigns.filter((c) => c.actualResult.value !== null).length,
    note: 'كل حملة لها سبب وفرضية وCTA؛ والنتائج الفعلية من سجلات حقيقية فقط.',
  };
}
