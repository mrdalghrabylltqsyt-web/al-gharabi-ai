/**
 * Demand Discovery Engine — اكتشاف الطلب الحقيقي من التفاعل (منطق خالص).
 *
 * يحوّل التعليقات/الرسائل الحقيقية إلى **فرص طلب** قابلة للتفسير: طلب متزايد،
 * أسئلة متكررة، طلبات سعر، اهتمام بالتقسيط، طلبات توفر، طلبات مواصفات، اعتراضات
 * متكررة، شكاوى متكررة، وطلبات منتج غير مُلبّاة.
 *
 * كل فرصة تحمل: الدليل، المصدر، الفترة، حجم العيّنة، الثقة، الحدود، والإجراء
 * الموصى به — والفصل المعرفي (حقيقة/تفسير/فرضية/توصية).
 *
 * القواعد الملزمة:
 * - لا فرصة بلا عيّنة كافية (`DEMAND_MIN_SAMPLE`)؛ دونها تُعلن `INSUFFICIENT_DATA`.
 * - «الطلب المتزايد» لا يُعلن بلا اتجاه زمني مقيس (نصفان متقارنان).
 * - طلب منتج غير موجود في الكتالوج يُعلن «غير مُلبّى» بلا اختراع منتج.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import type { PlatformId } from '../../social/adapter';
import { DEMAND_SIGNAL_LABELS_AR, type DemandSignalKind } from '../market/demandSignals';
import type { EpistemicKind } from '../market/opportunityEngine';
import type { AudienceInteraction } from './segments';

export type DemandDetectionKind =
  | 'rising_product_demand'
  | 'repeated_question'
  | 'repeated_price_request'
  | 'installment_interest'
  | 'availability_request'
  | 'specification_request'
  | 'repeated_objection'
  | 'recurring_complaint'
  | 'unmet_product_request';

export const DEMAND_DETECTION_LABELS_AR: Record<DemandDetectionKind, string> = Object.freeze({
  rising_product_demand: 'طلب متزايد على منتج',
  repeated_question: 'سؤال متكرر',
  repeated_price_request: 'طلبات سعر متكررة',
  installment_interest: 'اهتمام بالتقسيط',
  availability_request: 'طلبات توفر',
  specification_request: 'طلبات مواصفات',
  repeated_objection: 'اعتراضات متكررة',
  recurring_complaint: 'شكاوى متكررة',
  unmet_product_request: 'طلب منتج غير مُلبّى',
});

export type DemandTrend = 'RISING' | 'STABLE' | 'FALLING' | 'UNKNOWN';

export const DEMAND_TREND_LABELS_AR: Record<DemandTrend, string> = Object.freeze({
  RISING: 'متزايد',
  STABLE: 'مستقر',
  FALLING: 'متراجع',
  UNKNOWN: 'غير معروف (عيّنة زمنية ناقصة)',
});

export interface DemandDiscoveryOpportunity {
  id: string;
  kind: DemandDetectionKind;
  kindLabel: string;
  platform: PlatformId | 'cross_platform';
  productId: string | null;
  /** فصل معرفي صريح. */
  fact: { epistemic: EpistemicKind; statement: string };
  interpretation: { epistemic: EpistemicKind; statement: string } | null;
  hypothesis: { epistemic: EpistemicKind; statement: string };
  recommendation: { epistemic: EpistemicKind; statement: string };
  /** الإجراء الموصى به (توجيه لا تنفيذ). */
  recommendedAction: string;
  evidence: string[];
  source: string;
  periodDays: number | null;
  sampleSize: number;
  confidence: 'low' | 'medium' | 'high';
  sufficientSample: boolean;
  trend: DemandTrend;
  limitations: string;
  requiresOwnerAction: boolean;
}

/** خريطة إشارة الطلب → نوع الاكتشاف. */
const SIGNAL_TO_DETECTION: Record<DemandSignalKind, DemandDetectionKind> = {
  price_inquiry: 'repeated_price_request',
  installment_inquiry: 'installment_interest',
  availability_inquiry: 'availability_request',
  specification_inquiry: 'specification_request',
  product_request: 'unmet_product_request',
  objection: 'repeated_objection',
  complaint: 'recurring_complaint',
  purchase_intent: 'repeated_question',
  general_inquiry: 'repeated_question',
};

/** نوع الطلب المتزايد يُشتقّ فقط من هذه الإشارات ذات الدلالة التجارية. */
const RISING_ELIGIBLE: ReadonlySet<DemandSignalKind> = new Set([
  'price_inquiry', 'installment_inquiry', 'purchase_intent', 'product_request', 'availability_inquiry',
]);

export interface DemandSignalLite {
  kind: DemandSignalKind;
  platform: PlatformId;
  externalId: string;
  productId: string | null;
  at: string | null;
  source: string;
}

/** يبني إشارة طلب من تفاعل حقيقي (بلا اختراع نوع). */
export function toSignalLite(it: AudienceInteraction): DemandSignalLite {
  const { classification } = it;
  let kind: DemandSignalKind = 'general_inquiry';
  if (classification.category === 'purchase_intent') {
    kind = classification.topic === 'price' ? 'price_inquiry' : 'purchase_intent';
  } else if (classification.category === 'objection') kind = 'objection';
  else if (classification.category === 'complaint') kind = 'complaint';
  else if (classification.category === 'feature_request') kind = 'product_request';
  else if (classification.category === 'question') {
    if (classification.topic === 'price') kind = 'price_inquiry';
    else if (classification.topic === 'availability') kind = 'availability_inquiry';
    else if (classification.topic === 'location' || classification.topic === 'hours') kind = 'general_inquiry';
    else kind = 'general_inquiry';
  } else kind = 'general_inquiry';
  // التقسيط لا موضوع مستقل في المصنّف؛ يُشتقّ من النص.
  if ((kind === 'price_inquiry' || kind === 'general_inquiry') && /(تقسيط|قسط|اقساط|أقساط|بالشهر|مقدم|دفعه اولى|دفعة اولى)/.test(classification.text || '')) {
    kind = 'installment_inquiry';
  }
  return {
    kind,
    platform: it.platform,
    externalId: it.externalId,
    productId: it.productId ?? null,
    at: it.at ?? null,
    source: `${it.platform} — تفاعل حقيقي مصنّف`,
  };
}

/** يحسب الاتجاه من تقسيم الإشارات المؤقّتة إلى نصفين زمنيين متقاربين. */
export function computeDemandTrend(signals: DemandSignalLite[]): { trend: DemandTrend; firstHalf: number; secondHalf: number; note: string } {
  const timed = signals.filter((s) => s.at && Number.isFinite(Date.parse(s.at as string)));
  if (timed.length < 4) {
    return { trend: 'UNKNOWN', firstHalf: 0, secondHalf: 0, note: `عيّنة زمنية (${timed.length}) غير كافية لقياس الاتجاه — لا يُعلن تزايد.` };
  }
  const sorted = timed.slice().sort((a, b) => Date.parse(a.at as string) - Date.parse(b.at as string));
  const min = Date.parse(sorted[0].at as string);
  const max = Date.parse(sorted[sorted.length - 1].at as string);
  // بلا مدى زمني (كل الطوابع متطابقة) لا يمكن قياس اتجاه — لا يُعلن تزايد.
  if (max - min <= 0) {
    return { trend: 'UNKNOWN', firstHalf: 0, secondHalf: 0, note: 'الطوابع الزمنية متطابقة — لا مدى لقياس الاتجاه.' };
  }
  const mid = min + (max - min) / 2;
  const firstHalf = sorted.filter((s) => Date.parse(s.at as string) < mid).length;
  const secondHalf = sorted.length - firstHalf;
  if (secondHalf > firstHalf) return { trend: 'RISING', firstHalf, secondHalf, note: `النصف الثاني (${secondHalf}) أكثر من الأول (${firstHalf}).` };
  if (secondHalf < firstHalf) return { trend: 'FALLING', firstHalf, secondHalf, note: `النصف الثاني (${secondHalf}) أقل من الأول (${firstHalf}).` };
  return { trend: 'STABLE', firstHalf, secondHalf, note: 'توزيع متساوٍ بين النصفين.' };
}

function periodDaysOf(signals: DemandSignalLite[]): number | null {
  const times = signals.map((s) => (s.at ? Date.parse(s.at) : NaN)).filter((n) => Number.isFinite(n));
  if (times.length < 2) return null;
  return Math.max(0, Math.round((Math.max(...times) - Math.min(...times)) / 86_400_000));
}

function confidenceFrom(count: number, min: number): 'low' | 'medium' | 'high' {
  if (count >= min * 3) return 'high';
  if (count >= min * 2) return 'medium';
  return 'low';
}

/**
 * يكتشف فرص الطلب من تفاعلات حقيقية. لا يُعلن فرصة بلا دليل، ولا «تزايداً» بلا
 * اتجاه مقيس، ويعلن طلب المنتج غير الموجود في الكتالوج «غير مُلبّى».
 */
export function detectDemandOpportunities(input: {
  interactions: AudienceInteraction[];
  /** معرّفات المنتجات المسجّلة في الكتالوج. */
  catalogProductIds: string[];
  min?: number;
}): DemandDiscoveryOpportunity[] {
  const min = input.min ?? 3;
  const catalog = new Set(input.catalogProductIds || []);
  const signals = (input.interactions || []).map(toSignalLite).filter((s) => s.kind !== 'general_inquiry');

  const groups = new Map<string, DemandSignalLite[]>();
  for (const s of signals) {
    const key = `${s.kind}::${s.productId || ''}`;
    const list = groups.get(key) || [];
    list.push(s);
    groups.set(key, list);
  }

  const out: DemandDiscoveryOpportunity[] = [];
  for (const list of groups.values()) {
    const kind = SIGNAL_TO_DETECTION[list[0].kind];
    const productId = list[0].productId;
    const sampleSize = list.length;
    const sufficient = sampleSize >= min;
    const periodDays = periodDaysOf(list);
    const trendInfo = RISING_ELIGIBLE.has(list[0].kind) ? computeDemandTrend(list) : { trend: 'UNKNOWN' as DemandTrend, note: 'الاتجاه لا يُقاس لهذا النوع.' };
    const label = DEMAND_SIGNAL_LABELS_AR[list[0].kind];
    const productRef = productId ? `المنتج ${productId}` : 'موضوع عام';
    const unmet = kind === 'unmet_product_request' && (!productId || !catalog.has(productId));
    const effectiveKind: DemandDetectionKind = unmet ? 'unmet_product_request' : kind;
    const platforms = [...new Set(list.map((s) => s.platform))];
    const period = periodDays !== null ? `${periodDays} يوماً` : 'فترة غير معروفة';

    out.push({
      id: `demand-disc:${effectiveKind}:${productId || 'general'}`,
      kind: effectiveKind,
      kindLabel: DEMAND_DETECTION_LABELS_AR[effectiveKind],
      platform: platforms.length === 1 ? platforms[0] : 'cross_platform',
      productId,
      fact: { epistemic: 'FACT', statement: `${sampleSize} إشارة ${label} على ${productRef} خلال ${period}.` },
      interpretation: sufficient
        ? { epistemic: 'INTERPRETATION', statement: `هناك طلب حقيقي مستمر على ${productRef} يستحق محتوى/عرضاً موجّهاً.` }
        : null,
      hypothesis: { epistemic: 'HYPOTHESIS', statement: `محتوى يجيب على ${label}${productId ? ` لـ${productRef}` : ''} سيرفع الإشارات المؤهّلة.` },
      recommendation: {
        epistemic: 'RECOMMENDATION',
        statement: unmet
          ? 'وثّق المنتج المطلوب أو قدّم بديلاً مسجّلاً — لا تُعِد وعوداً بمنتج غير موجود.'
          : effectiveKind === 'repeated_price_request' || effectiveKind === 'installment_interest'
            ? 'وثّق السعر/عرض التقسيط الرسمي ثم انشر شرحاً واضحاً بلا أرقام غير مسجّلة.'
            : 'أنشئ محتوى يجيب على هذا الطلب من بيانات المعرض الموثّقة فقط مع دعوة للتواصل.',
      },
      recommendedAction: unmet
        ? 'وثّق المنتج المطلوب أو اقترح بديلاً مسجّلاً للمالك لاعتماده.'
        : 'أنشئ محتوى/عرضاً موجّهاً لهذا الطلب من بيانات موثّقة، وقس الإشارات بعده.',
      evidence: [
        `${sampleSize} إشارة ${label}${productId ? ` للمنتج ${productId}` : ''}.`,
        trendInfo.note,
        periodDays !== null ? `الفترة المرصودة: ${period}.` : 'الفترة غير معروفة (طوابع زمنية ناقصة).',
      ],
      source: list[0].source,
      periodDays,
      sampleSize,
      confidence: confidenceFrom(sampleSize, min),
      sufficientSample: sufficient,
      trend: trendInfo.trend,
      limitations: sufficient
        ? 'الطلب يُقاس بإشارات حقيقية؛ لا يضمن تحويلاً إلى بيع.'
        : `العيّنة (${sampleSize}) أقل من الحد (${min}) — لا يُعلن طلب مؤكّد.`,
      requiresOwnerAction: unmet || effectiveKind === 'repeated_price_request' || effectiveKind === 'installment_interest',
    });
  }

  // طلب متزايد صريح: يُضاف عند وجود اتجاه RISING مع عيّنة كافية على منتج محدّد.
  for (const list of groups.values()) {
    if (!RISING_ELIGIBLE.has(list[0].kind)) continue;
    const productId = list[0].productId;
    if (!productId || list.length < min) continue;
    const trendInfo = computeDemandTrend(list);
    if (trendInfo.trend !== 'RISING') continue;
    const label = DEMAND_SIGNAL_LABELS_AR[list[0].kind];
    out.push({
      id: `demand-disc:rising_product_demand:${productId}`,
      kind: 'rising_product_demand',
      kindLabel: DEMAND_DETECTION_LABELS_AR.rising_product_demand,
      platform: [...new Set(list.map((s) => s.platform))].length === 1 ? list[0].platform : 'cross_platform',
      productId,
      fact: { epistemic: 'FACT', statement: `طلب ${label} على المنتج ${productId} تزايد: ${trendInfo.note}` },
      interpretation: { epistemic: 'INTERPRETATION', statement: `اهتمام متصاعد بالمنتج ${productId} يستحق تعزيزاً الآن.` },
      hypothesis: { epistemic: 'HYPOTHESIS', statement: `محتوى/عرض موجّه للمنتج ${productId} سيستثمر هذا التزايد.` },
      recommendation: { epistemic: 'RECOMMENDATION', statement: `عزّز محتوى المنتج ${productId} وراقب استمرار الاتجاه.` },
      recommendedAction: `أنشئ محتوى موجّهاً للمنتج ${productId} الآن واستمر بقياس الإشارات.`,
      evidence: [`${list.length} إشارة ${label} على المنتج ${productId}.`, trendInfo.note],
      source: list[0].source,
      periodDays: periodDaysOf(list),
      sampleSize: list.length,
      confidence: confidenceFrom(list.length, min),
      sufficientSample: true,
      trend: 'RISING',
      limitations: 'الاتجاه مقيس على نافذتين متقاربتين؛ قد يعكس تقلّباً موسمياً لا نمواً دائماً.',
      requiresOwnerAction: false,
    });
  }

  return out.sort((a, b) => b.sampleSize - a.sampleSize);
}

export interface DemandDiscoverySummary {
  total: number;
  sufficient: number;
  insufficient: number;
  rising: number;
  unmet: number;
  note: string;
}

export function summarizeDemandDiscovery(opps: DemandDiscoveryOpportunity[]): DemandDiscoverySummary {
  const sufficient = opps.filter((o) => o.sufficientSample).length;
  return {
    total: opps.length,
    sufficient,
    insufficient: opps.length - sufficient,
    rising: opps.filter((o) => o.trend === 'RISING').length,
    unmet: opps.filter((o) => o.kind === 'unmet_product_request').length,
    note: 'كل فرصة طلب بدليلها وفترتها وعيّنتها؛ والتزايد لا يُعلن بلا اتجاه زمني مقيس.',
  };
}
