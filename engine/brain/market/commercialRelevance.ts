/**
 * Local Market Intelligence — الأهمية التجارية (Commercial Relevance).
 *
 * الفكرة الجوهرية: 100,000 مشاهدة بلا أي إشارة شراء ليست نفس قيمة 4,000 مشاهدة
 * أنتجت استفسارات شراء حقيقية. لذلك يفرّق العقل صراحةً بين مراحل القُمع:
 *
 *   VIEW → ENGAGED_VIEW → RELEVANT_VIEW → BUYING_SIGNAL → LEAD → SALE
 *
 * ولا يُرقّى شيء إلى `SALE` إلا بمصدر بيع موثوق. لا تقدير ولا اختراع.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { ClassifiedComment } from '../../social/comments';

export type FunnelStage =
  | 'VIEW'
  | 'ENGAGED_VIEW'
  | 'RELEVANT_VIEW'
  | 'BUYING_SIGNAL'
  | 'LEAD'
  | 'SALE';

export const FUNNEL_STAGE_LABELS_AR: Record<FunnelStage, string> = Object.freeze({
  VIEW: 'مشاهدة',
  ENGAGED_VIEW: 'مشاهدة متفاعلة',
  RELEVANT_VIEW: 'مشاهدة ذات صلة',
  BUYING_SIGNAL: 'إشارة شراء',
  LEAD: 'عميل محتمل',
  SALE: 'بيع',
});

/** ترتيب القُمع من الأعلى للأدنى (لتفسير التدرّج). */
export const FUNNEL_ORDER: readonly FunnelStage[] = Object.freeze(['VIEW', 'ENGAGED_VIEW', 'RELEVANT_VIEW', 'BUYING_SIGNAL', 'LEAD', 'SALE']);

export interface FunnelCounts {
  VIEW: number | null;
  ENGAGED_VIEW: number | null;
  RELEVANT_VIEW: number | null;
  BUYING_SIGNAL: number | null;
  LEAD: number | null;
  SALE: number | null;
}

/** مصدر كل مرحلة. لا قيمة بلا مصدر — والغياب يُعلن. */
export interface FunnelStageEvidence {
  stage: FunnelStage;
  value: number | null;
  source: string | null;
  available: boolean;
  reason?: string;
}

export interface CommercialRelevance {
  stages: FunnelStageEvidence[];
  /** هل أي مرحلة بعد التفاعل موثّقة فعلاً؟ */
  hasCommercialEvidence: boolean;
  note: string;
  limitations: string[];
}

/**
 * يحسب الأهمية التجارية من بيانات حقيقية فقط. المشاهدات/التفاعل من المنصة؛
 * إشارات الشراء من تصنيف التعليقات؛ البيع لا يُحتسب إلا إن مرّرت مصدر بيع موثوق.
 */
export function computeCommercialRelevance(input: {
  platform: string;
  views: number | null;
  engagedViews: number | null;
  /** تعليقات حقيقية مصنّفة (لاشتقاق إشارات الشراء). */
  comments?: Array<Pick<ClassifiedComment, 'isBusinessInquiry' | 'intent' | 'topic'>>;
  /** عملاء محتملون موثّقون من نظام أعمال — لا يُقدَّر. */
  leads?: number | null;
  /** مبيعات موثّقة من مصدر بيع — لا تُخترع. */
  sales?: number | null;
}): CommercialRelevance {
  const platform = input.platform;
  const limitations: string[] = [];

  const buyingSignals = input.comments
    ? input.comments.filter((c) => c.isBusinessInquiry).length
    : null;
  if (input.comments && input.comments.length === 0) limitations.push('لا تعليقات مقروءة؛ لا تُشتق إشارات شراء.');

  const stages: FunnelStageEvidence[] = [
    {
      stage: 'VIEW',
      value: typeof input.views === 'number' ? input.views : null,
      source: typeof input.views === 'number' ? `${platform} API — views` : null,
      available: typeof input.views === 'number',
      reason: typeof input.views === 'number' ? undefined : 'المؤشر غير متاح عبر الواجهة الرسمية.',
    },
    {
      stage: 'ENGAGED_VIEW',
      value: typeof input.engagedViews === 'number' ? input.engagedViews : null,
      source: typeof input.engagedViews === 'number' ? `${platform} API — تفاعل فعلي` : null,
      available: typeof input.engagedViews === 'number',
      reason: typeof input.engagedViews === 'number' ? undefined : 'يتطلب مؤشر تفاعل (إعجابات/تعليقات/مشاركات) متاحاً.',
    },
    {
      stage: 'RELEVANT_VIEW',
      value: null,
      source: null,
      available: false,
      reason: '«المشاهدة ذات الصلة» تحتاج بيانات جمهور جغرافية/اهتمامية غير متاحة عبر الواجهات الحالية — لا تُقدَّر.',
    },
    {
      stage: 'BUYING_SIGNAL',
      value: buyingSignals,
      source: buyingSignals === null ? null : `${platform} API — تصنيف تعليقات حتمي (استفسارات أعمال)`,
      available: buyingSignals !== null,
      reason: buyingSignals === null ? 'لا تعليقات مقروءة عبر الواجهة الرسمية لاشتقاق إشارات شراء.' : undefined,
    },
    {
      stage: 'LEAD',
      value: typeof input.leads === 'number' ? input.leads : null,
      source: typeof input.leads === 'number' ? 'نظام أعمال موثّق' : null,
      available: typeof input.leads === 'number',
      reason: typeof input.leads === 'number' ? undefined : 'لا مصدر عملاء موثّق متصل؛ لا يُقدَّر عدد العملاء.',
    },
    {
      stage: 'SALE',
      value: typeof input.sales === 'number' ? input.sales : null,
      source: typeof input.sales === 'number' ? 'نظام بيع موثّق' : null,
      available: typeof input.sales === 'number',
      reason: typeof input.sales === 'number' ? undefined : 'لا يُثبت «بيع» إلا بمصدر بيع موثوق؛ لا يُخترع.',
    },
  ];

  const hasCommercialEvidence = stages.some((s) => (s.stage === 'BUYING_SIGNAL' || s.stage === 'LEAD' || s.stage === 'SALE') && s.available && (s.value || 0) > 0);
  limitations.push('المراحل غير المتاحة معلنة صراحةً؛ لا تُستنتج ولا تُقدَّر.');
  limitations.push('«مشاهدة ذات صلة» و«عميل» و«بيع» تحتاج مصادر لم تُوصل بعد؛ العقل لا يدّعيها.');

  return {
    stages,
    hasCommercialEvidence,
    note: 'الأهمية التجارية تُقاس بمراحل القُمع، لا بالمشاهدات وحدها. كل مرحلة بمصدرها أو تُعلن غير متاحة.',
    limitations,
  };
}

/**
 * يفضّل محتوى على آخر بالأهمية التجارية لا بالمشاهدات: عند غياب دليل شراء لأي
 * منهما، يُعلن التعادل بدل حسم كاذب.
 */
export function compareByCommercialRelevance(a: CommercialRelevance, b: CommercialRelevance): {
  preferred: 'a' | 'b' | 'tie';
  reason: string;
} {
  const salesOf = (r: CommercialRelevance) => r.stages.find((s) => s.stage === 'SALE')?.value ?? null;
  const leadsOf = (r: CommercialRelevance) => r.stages.find((s) => s.stage === 'LEAD')?.value ?? null;
  const buyingOf = (r: CommercialRelevance) => r.stages.find((s) => s.stage === 'BUYING_SIGNAL')?.value ?? null;
  const aScore = (salesOf(a) ?? 0) * 1000 + (leadsOf(a) ?? 0) * 100 + (buyingOf(a) ?? 0);
  const bScore = (salesOf(b) ?? 0) * 1000 + (leadsOf(b) ?? 0) * 100 + (buyingOf(b) ?? 0);
  if (aScore === 0 && bScore === 0) {
    return { preferred: 'tie', reason: 'لا دليل شراء موثّق لأي من المحتويين؛ لا يُحسم تفضيل بالأهمية التجارية.' };
  }
  if (aScore === bScore) return { preferred: 'tie', reason: 'تساوٍ في دليل الأهمية التجارية.' };
  return aScore > bScore
    ? { preferred: 'a', reason: 'دليل شراء أقوى (بيع/عميل/إشارة شراء) على الأساس الحقيقي.' }
    : { preferred: 'b', reason: 'دليل شراء أقوى (بيع/عميل/إشارة شراء) على الأساس الحقيقي.' };
}
