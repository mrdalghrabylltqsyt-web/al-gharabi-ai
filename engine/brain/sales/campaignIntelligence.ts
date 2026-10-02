/**
 * Campaign Intelligence — أساس حملة تُجيب «لماذا نشغّلها؟» لا «أنشئ 3 منشورات».
 *
 * الغرض: بنية حملة تربط الهدف ← المنتج ← الجمهور ← إشارة الطلب ← الفرضية ←
 * الرسالة ← المحتوى ← CTA ← المنصة ← التوقيت ← التجربة ← النتيجة المتوقعة ←
 * النتيجة الفعلية ← العملاء ← المبيعات الموثّقة ← التعلّم.
 *
 * **طبقة تحضير فقط**: تبني النموذج وتتحقّق من اكتماله؛ لا تنفّذ ولا تنشر ولا
 * تخترع نتائج.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../../social/adapter';
import type { GoalKind } from '../goals/goalEngine';

export type CampaignStatus = 'draft' | 'planned' | 'running' | 'concluded' | 'archived';

/** النتيجة المتوقعة: قابلة للقياس ومصدرها معلن. */
export interface ExpectedOutcome {
  metric: string;
  labelAr: string;
  /** هل المؤشر متاح فعلاً عبر الواجهة؟ إن لا يُعلن ذلك. */
  measurable: boolean;
  reason?: string;
}

/** النتيجة الفعلية: من سجلات حقيقية فقط، وغيابها يُعلن. */
export interface ActualOutcome {
  metric: string;
  value: number | null;
  source: string | null;
  recordedAt: string | null;
}

export interface CampaignDefinition {
  id: string;
  /** «لماذا نشغّل هذه الحملة؟» — إلزامي، بلا حملة بلا سبب. */
  objective: string;
  goal: GoalKind;
  productId: string | null;
  productName: string | null;
  targetAudience: string;
  /** إشارة الطلب التي أطلقت الحملة (مرجع إشارة حقيقية). */
  demandSignalRef: string | null;
  hypothesis: string;
  message: string;
  contentRefs: string[];
  cta: string;
  platforms: PlatformId[];
  timing: { startAt: string | null; endAt: string | null; note: string };
  /** معرّف التجربة المرتبطة (متغيّر واحد) إن وُجدت. */
  experimentId: string | null;
  expectedOutcome: ExpectedOutcome;
  actualOutcome: ActualOutcome;
  /** أرقام حقيقية فقط؛ null يعني «غير متاح». */
  leads: number | null;
  verifiedSales: number | null;
  revenue: number | null;
  cost: number | null;
  learning: string | null;
  status: CampaignStatus;
  requiresOwnerApproval: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  limitations: string[];
}

export interface CampaignDraftInput {
  id: string;
  objective: string;
  goal: GoalKind;
  productId?: string | null;
  productName?: string | null;
  targetAudience?: string;
  demandSignalRef?: string | null;
  hypothesis: string;
  message: string;
  cta: string;
  platforms: PlatformId[];
  startAt?: string | null;
  endAt?: string | null;
  timingNote?: string;
  experimentId?: string | null;
  expectedOutcome: ExpectedOutcome;
  createdBy: string;
  now: number;
}

/** يبني مسودة حملة بلا اختراع نتائج: كل رقم فعلي يبدأ `null` (غير متاح). */
export function buildCampaignDraft(input: CampaignDraftInput): CampaignDefinition {
  return {
    id: input.id,
    objective: input.objective,
    goal: input.goal,
    productId: input.productId ?? null,
    productName: input.productName ?? null,
    targetAudience: input.targetAudience || 'جمهور محلي غير محدّد بسمات سكانية (غير متاحة).',
    demandSignalRef: input.demandSignalRef ?? null,
    hypothesis: input.hypothesis,
    message: input.message,
    contentRefs: [],
    cta: input.cta,
    platforms: [...input.platforms],
    timing: { startAt: input.startAt ?? null, endAt: input.endAt ?? null, note: input.timingNote || 'التوقيت مبني على أوقات تفاعل حقيقية عند توفرها.' },
    experimentId: input.experimentId ?? null,
    expectedOutcome: input.expectedOutcome,
    actualOutcome: { metric: input.expectedOutcome.metric, value: null, source: null, recordedAt: null },
    leads: null,
    verifiedSales: null,
    revenue: null,
    cost: null,
    learning: null,
    status: 'draft',
    requiresOwnerApproval: true,
    createdBy: input.createdBy,
    createdAt: new Date(input.now).toISOString(),
    updatedAt: new Date(input.now).toISOString(),
    limitations: ['لا تُعلن نتيجة بلا سجل حقيقي؛ النتائج الفعلية تُملأ من النظام لا من التقدير.'],
  };
}

/** اكتمال تعريف الحملة — يكشف النقص قبل التشغيل بدل حملة غامضة. */
export function campaignCompleteness(campaign: CampaignDefinition): { complete: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!campaign.objective.trim()) missing.push('الهدف/السبب (لماذا نشغّلها؟) مفقود.');
  if (!campaign.hypothesis.trim()) missing.push('الفرضية مفقودة.');
  if (!campaign.message.trim()) missing.push('الرسالة مفقودة.');
  if (!campaign.cta.trim()) missing.push('الدعوة للتواصل (CTA) مفقودة.');
  if (!campaign.platforms.length) missing.push('لا منصة محدّدة.');
  if (!campaign.productId && !campaign.productName) missing.push('لا منتج محدّد.');
  if (!campaign.expectedOutcome.metric) missing.push('لا نتيجة متوقعة قابلة للقياس.');
  return { complete: missing.length === 0, missing };
}

/**
 * يسجّل نتيجة فعلية من سجل حقيقي فقط. محاولة تسجيل بلا مصدر تُرفض صراحةً —
 * فلا تُخترع نتيجة حملة.
 */
export function recordCampaignOutcome(campaign: CampaignDefinition, input: {
  metric: string;
  value: number | null;
  source: string | null;
  now: number;
}): { campaign: CampaignDefinition; recorded: boolean; reason: string } {
  if (!input.source) {
    return { campaign, recorded: false, reason: 'لا تُسجَّل نتيجة حملة بلا مصدر حقيقي.' };
  }
  return {
    campaign: {
      ...campaign,
      actualOutcome: { metric: input.metric, value: input.value, source: input.source, recordedAt: new Date(input.now).toISOString() },
      updatedAt: new Date(input.now).toISOString(),
    },
    recorded: true,
    reason: 'سُجّلت النتيجة من مصدر حقيقي.',
  };
}

/** يربط أرقاماً حقيقية (عملاء/مبيعات/إيراد/تكلفة) بلا اختراع. */
export function attachCampaignResults(campaign: CampaignDefinition, input: {
  leads?: number | null;
  verifiedSales?: number | null;
  revenue?: number | null;
  cost?: number | null;
  learning?: string | null;
  now: number;
}): CampaignDefinition {
  return {
    ...campaign,
    leads: input.leads ?? campaign.leads,
    verifiedSales: input.verifiedSales ?? campaign.verifiedSales,
    revenue: input.revenue ?? campaign.revenue,
    cost: input.cost ?? campaign.cost,
    learning: input.learning ?? campaign.learning,
    status: campaign.status === 'draft' ? 'planned' : campaign.status,
    updatedAt: new Date(input.now).toISOString(),
  };
}

export interface CampaignSummary {
  total: number;
  byStatus: Record<string, number>;
  withVerifiedSales: number;
  withActualOutcome: number;
  incomplete: number;
  note: string;
}

export function summarizeCampaigns(campaigns: CampaignDefinition[]): CampaignSummary {
  const byStatus: Record<string, number> = {};
  for (const c of campaigns) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  return {
    total: campaigns.length,
    byStatus,
    withVerifiedSales: campaigns.filter((c) => (c.verifiedSales ?? 0) > 0).length,
    withActualOutcome: campaigns.filter((c) => c.actualOutcome.value !== null).length,
    incomplete: campaigns.filter((c) => !campaignCompleteness(c).complete).length,
    note: 'كل حملة تُقاس بأرقام حقيقية فقط؛ النتائج غير المتاحة تُعلن ولا تُخترع.',
  };
}
