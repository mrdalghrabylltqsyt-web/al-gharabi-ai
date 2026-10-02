/**
 * Demand Signal Engine — أساس تحويل التفاعل الحقيقي إلى إشارات طلب منظّمة.
 *
 * الغرض: أن يتعلّم العقل **ما يطلبه الناس فعلاً** لا مجرد «كم تفاعلوا». يحوّل
 * تعليقات/رسائل/استفسارات حقيقية (مصنّفة حتمياً في `conversationIntelligence`)
 * إلى إشارات طلب قابلة للقياس: نوع الطلب، حجم العيّنة، الفترة، المصدر، الثقة.
 *
 * **هذه طبقة تحضير فقط**: تبني الإشارة وتجمّعها وتعلن حدودها؛ ولا تتنبّأ ولا
 * تخترع رقماً ولا تُصدر قراراً تجارياً. (المحرّك الكامل في الدفعة التالية.)
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../../social/adapter';
import {
  classifyConversation,
  type ClassifiedConversation,
  type ConversationCategory,
} from '../audience/conversationIntelligence';
import type { CommentTopic } from '../../social/comments';

export type DemandSignalKind =
  | 'price_inquiry'
  | 'installment_inquiry'
  | 'availability_inquiry'
  | 'specification_inquiry'
  | 'product_request'
  | 'objection'
  | 'complaint'
  | 'purchase_intent'
  | 'general_inquiry';

export const DEMAND_SIGNAL_LABELS_AR: Record<DemandSignalKind, string> = Object.freeze({
  price_inquiry: 'استفسار سعر',
  installment_inquiry: 'استفسار تقسيط',
  availability_inquiry: 'استفسار توفر',
  specification_inquiry: 'استفسار مواصفات',
  product_request: 'طلب منتج',
  objection: 'اعتراض',
  complaint: 'شكوى',
  purchase_intent: 'نية شراء',
  general_inquiry: 'استفسار عام',
});

export type DemandStrength = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_DATA';

export const DEMAND_STRENGTH_LABELS_AR: Record<DemandStrength, string> = Object.freeze({
  HIGH: 'طلب مرتفع',
  MEDIUM: 'طلب متوسط',
  LOW: 'طلب منخفض',
  INSUFFICIENT_DATA: 'بيانات غير كافية',
});

/** الحد الأدنى للعيّنة قبل إعلان أي قوة طلب — لا حكم بلا دليل. */
export const DEMAND_MIN_SAMPLE = 3;

/** إشارة طلب واحدة: نص التعليق الحقيقي + تصنيفه + المصدر. */
export interface DemandSignal {
  id: string;
  kind: DemandSignalKind;
  platform: PlatformId;
  externalId: string;
  /** معرّف المنتج إن رُبط صراحةً (لا يُستنتج من النص). */
  productId: string | null;
  text: string;
  at: string | null;
  source: string;
  /** إشارة التصنيف التي دعمت النوع (للتفسير). */
  signal: string;
}

/**
 * يشتقّ نوع الطلب من فئة المحادثة + موضوع السؤال. لا يخترع نوعاً بلا دليل:
 * غياب الدليل ⇒ `general_inquiry`.
 */
export function demandKindFor(conversation: ClassifiedConversation): DemandSignalKind {
  const { category, topic } = conversation;
  if (category === 'purchase_intent') {
    if (topic === 'price') return 'price_inquiry';
    return 'purchase_intent';
  }
  if (category === 'objection') return 'objection';
  if (category === 'complaint') return 'complaint';
  if (category === 'feature_request') return 'product_request';
  if (category === 'question') {
    if (topic === 'price') return 'price_inquiry';
    if (topic === 'availability') return 'availability_inquiry';
    if (topic === 'location' || topic === 'hours') return 'general_inquiry';
    return 'general_inquiry';
  }
  return 'general_inquiry';
}

/** هل النوع استفسار تقسيط صريح؟ يُشتقّ من نص السؤال (التقسيط لا موضوع مستقل في المصنّف). */
const INSTALLMENT_RE = /(تقسيط|قسط|اقساط|أقساط|بالشهر|شهري|مقدم|دفعه اولى|دفعة اولى|بلا فوايد|بدون فوايد)/;

/** يبني إشارة طلب من تعليق حقيقي واحد بلا أي معلومة مُختلقة. */
export function toDemandSignal(input: {
  platform: PlatformId;
  externalId: string;
  text: string;
  at?: string | null;
  productId?: string | null;
  source?: string;
}): DemandSignal {
  const conversation = classifyConversation({ platform: input.platform, externalId: input.externalId, text: input.text || '' });
  let kind = demandKindFor(conversation);
  if (kind === 'price_inquiry' && INSTALLMENT_RE.test(conversation.text || '')) kind = 'installment_inquiry';
  if (kind === 'general_inquiry' && INSTALLMENT_RE.test(conversation.text || '')) kind = 'installment_inquiry';
  return {
    id: `demand:${input.platform}:${input.externalId}`,
    kind,
    platform: input.platform,
    externalId: input.externalId,
    productId: input.productId ?? null,
    text: input.text || '',
    at: input.at ?? null,
    source: input.source || `${input.platform} — تعليق/رسالة حقيقية`,
    signal: conversation.signal || 'general',
  };
}

/** تجميعة إشارات لنوع/منتج واحد على مدى فترة. */
export interface DemandAggregate {
  kind: DemandSignalKind;
  productId: string | null;
  topic: CommentTopic | 'installment' | 'general';
  count: number;
  /** عدد الإشارات الموثّقة بوقت (لحساب الفترة). */
  timedCount: number;
  periodDays: number | null;
  firstAt: string | null;
  lastAt: string | null;
  strength: DemandStrength;
  sampleSize: number;
  confidence: 'low' | 'medium' | 'high';
  source: string;
  evidence: string[];
  limitations: string;
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const x = Date.parse(a);
  const y = Date.parse(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.max(0, Math.round(Math.abs(y - x) / 86_400_000));
}

/**
 * يجمّع إشارات الطلب بحسب (النوع + المنتج). لا يعلن قوة طلب بلا عيّنة كافية،
 * ويحسب الفترة من الإشارات المؤقّتة فقط (وإلا يعلنها غير معروفة).
 */
export function aggregateDemandSignals(input: {
  signals: DemandSignal[];
  min?: number;
  /** نافذة الأيام المُعلنة عند غياب طوابع زمنية كافية. */
  declaredWindowDays?: number | null;
}): DemandAggregate[] {
  const min = input.min ?? DEMAND_MIN_SAMPLE;
  const groups = new Map<string, DemandSignal[]>();
  for (const s of input.signals) {
    if (s.kind === 'general_inquiry') continue;
    const key = `${s.kind}::${s.productId || ''}`;
    const list = groups.get(key) || [];
    list.push(s);
    groups.set(key, list);
  }
  const out: DemandAggregate[] = [];
  for (const list of groups.values()) {
    const timed = list.filter((s) => s.at && Number.isFinite(Date.parse(s.at)));
    const sorted = timed.slice().sort((a, b) => Date.parse(a.at as string) - Date.parse(b.at as string));
    const firstAt = sorted.length ? (sorted[0].at as string) : null;
    const lastAt = sorted.length ? (sorted[sorted.length - 1].at as string) : null;
    const observedPeriod = daysBetween(firstAt, lastAt);
    const periodDays = observedPeriod ?? input.declaredWindowDays ?? null;
    const strength: DemandStrength = list.length < min
      ? 'INSUFFICIENT_DATA'
      : (list.length >= min * 3 ? 'HIGH' : list.length >= min * 2 ? 'MEDIUM' : 'LOW');
    const productId = list[0].productId;
    out.push({
      kind: list[0].kind,
      productId,
      topic: list[0].kind === 'installment_inquiry' ? 'installment' : 'general',
      count: list.length,
      timedCount: timed.length,
      periodDays,
      firstAt,
      lastAt,
      strength,
      sampleSize: list.length,
      confidence: list.length >= min * 3 ? 'high' : list.length >= min * 2 ? 'medium' : 'low',
      source: list[0].source,
      evidence: [
        `${list.length} إشارة ${DEMAND_SIGNAL_LABELS_AR[list[0].kind]}${productId ? ` للمنتج ${productId}` : ''}.`,
        periodDays !== null ? `الفترة المرصودة: ${periodDays} يوماً.` : 'الفترة غير معروفة (طوابع زمنية ناقصة).',
        timed.length < list.length ? `${list.length - timed.length} إشارة بلا وقت مسجّل.` : 'كل الإشارات موقّتة.',
      ],
      limitations: list.length < min
        ? `العيّنة (${list.length}) أقل من الحد (${min}) — لا يُعلن طلب مؤكّد.`
        : 'قوة الطلب مبنية على إشارات حقيقية فقط؛ لا تضمن تحويلاً إلى بيع.',
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

export interface DemandSummary {
  total: number;
  byKind: Record<string, number>;
  aggregates: DemandAggregate[];
  sufficient: number;
  insufficient: number;
  note: string;
}

/** ملخّص الطلب الصادق: يفصل ما له عيّنة كافية عمّا لا. */
export function summarizeDemand(aggregates: DemandAggregate[]): DemandSummary {
  const byKind: Record<string, number> = {};
  for (const a of aggregates) byKind[a.kind] = (byKind[a.kind] || 0) + a.count;
  const sufficient = aggregates.filter((a) => a.strength !== 'INSUFFICIENT_DATA').length;
  return {
    total: aggregates.reduce((n, a) => n + a.count, 0),
    byKind,
    aggregates,
    sufficient,
    insufficient: aggregates.length - sufficient,
    note: 'الطلب يُقاس بإشارات حقيقية مصنّفة؛ وما دون الحد الأدنى يُعلن «بيانات غير كافية» بلا تقدير.',
  };
}

/**
 * **غير مسموح** ربط إشارة طلب بمنتج عبر تخمين النص. الربط يقع فقط بمعرّف
 * صريح يمرّره المستدعي. هذه الدالة تعلن ذلك وتُستخدم في الاختبارات كحرس.
 */
export function linkDemandToProduct(signal: DemandSignal, productId: string | null): DemandSignal {
  return { ...signal, productId: productId ?? null };
}

/** الفئات التي لا تُعتبر طلباً تجارياً — تُستبعد من أي قياس طلب. */
export const NON_DEMAND_CATEGORIES: readonly ConversationCategory[] = Object.freeze(['spam', 'praise']);
