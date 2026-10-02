/**
 * Digital Sales — اكتشاف نية الشراء (منطق خالص حتمي).
 *
 * الغرض: تمييز الإشارات الشرائية الحقيقية عن مجرّد التفاعل (إعجاب/مشاهدة/سؤال
 * عام). لا يُصنَّف كل تفاعل كعميل محتمل. القرار يحمل دليلاً وثقة ومرجع منتج
 * (إن كان موثّقاً) وسياقاً ومصدراً ووقتاً.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا AI.
 */

import type { PlatformId } from '../../social/adapter';
import type { ConversationCategory } from '../audience/conversationIntelligence';

export type PurchaseIntentState = 'NO_PURCHASE_SIGNAL' | 'PURCHASE_SIGNAL' | 'NEEDS_MORE_EVIDENCE';

export const PURCHASE_INTENT_LABELS_AR: Record<PurchaseIntentState, string> = Object.freeze({
  NO_PURCHASE_SIGNAL: 'لا إشارة شراء',
  PURCHASE_SIGNAL: 'إشارة شراء',
  NEEDS_MORE_EVIDENCE: 'تحتاج دليلاً إضافياً',
});

/** نوع إشارة الشراء — مصدر واحد للتسميات. */
export type PurchaseSignalKind =
  | 'wants_one'
  | 'asks_installment'
  | 'asks_availability'
  | 'asks_how_to_buy'
  | 'asks_location'
  | 'wants_same_item'
  | 'asks_specs'
  | 'asks_price'
  | 'buying_timing'
  | 'repeated_product_question';

export const PURCHASE_SIGNAL_LABELS_AR: Record<PurchaseSignalKind, string> = Object.freeze({
  wants_one: 'يريد وحدة',
  asks_installment: 'يسأل عن التقسيط',
  asks_availability: 'يسأل عن التوفر',
  asks_how_to_buy: 'يسأل كيف يشتري',
  asks_location: 'يسأل عن الموقع',
  wants_same_item: 'يريد نفس المنتج',
  asks_specs: 'يسأل عن المواصفات',
  asks_price: 'يسأل عن السعر',
  buying_timing: 'يشير إلى وقت الشراء',
  repeated_product_question: 'سؤال متكرر عن المنتج',
});

/** إشارات قوية = فعل شرائي صريح. إشارات سياقية = تؤهّل للمزيد من الدليل. */
const STRONG_SIGNAL_KINDS: readonly PurchaseSignalKind[] = Object.freeze([
  'wants_one', 'asks_how_to_buy', 'wants_same_item', 'buying_timing',
]);

// توحيد الألف/الهمزات/التاء لتفادي تفويت الصيغ.
function normalizeAr(text: string): string {
  return String(text || '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ؤئ]/g, 'ء')
    .replace(/\s+/g, ' ')
    .trim();
}

const PATTERNS: Array<{ kind: PurchaseSignalKind; re: RegExp }> = [
  { kind: 'wants_one', re: /(اريد وحده|اريد واحده|اريدها|اريد هذا|اريد نفس|اريد اشتري|اريد اشتري|بدي وحده|محتاج وحده|اريد اطلب|حجزلي|احجزلي)/ },
  { kind: 'wants_same_item', re: /(نفس هذا|نفس هاي|نفسه|مثل هذا|نفس الموديل|هذا نفسه)/ },
  { kind: 'asks_how_to_buy', re: /(شلون اشتري|كيف اشتري|شلون اشتريها|كيف اطلب|شلون اطلب|طريقه الشراء|شلون اتمم|كيف اتمم)/ },
  { kind: 'asks_installment', re: /(قسط|اقساط|تقسيط|القسط|شكد القسط|كم القسط|مقدم|الدفعه الاولي)/ },
  { kind: 'asks_availability', re: /(متوفر|موجود|متوفره|عندكم موجود|اكو منه|اكو منه|مخلص|نافد|باقي منه)/ },
  { kind: 'asks_location', re: /(وين موقع|اين موقع|وين محلكم|وين المعرض|عنوان المعرض|وين صاير)/ },
  { kind: 'asks_specs', re: /(مواصفات|المواصفات|شنو مميزات|شنو مواصفات|القياسات|الحجم|السعه|كم واط|نوعه شنو)/ },
  { kind: 'asks_price', re: /(شكد السعر|كم السعر|شكد سعر|كم سعر|شكد يكلف|كم يكلف|السعر شكد|بكم|شكد بي)/ },
  { kind: 'buying_timing', re: /(باجر|هذا الاسبوع|هالشهر|راح اشتري|ناوي اشتري|نخطط نشتري|قريبا اشتري|بعد اسبوع|الشهر الجاي)/ },
];

export interface PurchaseIntentInput {
  platform: PlatformId | 'cross_platform';
  externalId: string;
  text: string;
  /** تصنيف المحادثة القائم (يُعاد استخدامه، لا يُكرَّر). */
  classification?: ConversationCategory | null;
  /** هل يوجد مرجع منتج موثّق لهذه المحادثة؟ */
  productRef?: { productId: string; verified: boolean } | null;
  /** عدد الأسئلة السابقة عن نفس المنتج (من سياق المحادثة). */
  priorProductQuestions?: number;
  /** لحظة التقييم (تُحقن، لا ساعة حقيقية). */
  nowMs: number;
}

export interface PurchaseIntentEvidence {
  kind: PurchaseSignalKind;
  labelAr: string;
  strength: 'strong' | 'contextual';
  snippet: string;
}

export interface PurchaseIntentResult {
  state: PurchaseIntentState;
  /** الإشارات المكتشفة بدليلها. */
  signals: PurchaseIntentEvidence[];
  /** أقوى إشارة (أو null). */
  strongest: PurchaseSignalKind | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  /** هل الإشارة مقترنة بمرجع منتج موثّق؟ */
  productVerified: boolean;
  productId: string | null;
  evidence: string[];
  source: string;
  reason: string;
  at: string;
  limitations: string[];
}

/**
 * يكتشف إشارات الشراء الحقيقية. لا يُعلن `PURCHASE_SIGNAL` بلا إشارة قوية أو
 * تراكم سياقي كافٍ. الإشارة الشرائية **ليست بيعاً** — تُصعَّد لاحقاً عبر طبقة
 * الحقيقة.
 */
export function detectPurchaseIntent(input: PurchaseIntentInput): PurchaseIntentResult {
  const text = normalizeAr(input.text);
  const found: PurchaseIntentEvidence[] = [];
  for (const { kind, re } of PATTERNS) {
    const m = text.match(re);
    if (m) {
      found.push({
        kind,
        labelAr: PURCHASE_SIGNAL_LABELS_AR[kind],
        strength: STRONG_SIGNAL_KINDS.includes(kind) ? 'strong' : 'contextual',
        snippet: String(input.text || '').slice(0, 120),
      });
    }
  }

  const priorQuestions = Math.max(0, Number(input.priorProductQuestions || 0));
  const productVerified = Boolean(input.productRef?.verified);
  const productId = input.productRef?.productId ?? null;

  // سؤال متكرر عن نفس المنتج = إشارة (تُضاف عند وجود سياق).
  if (priorQuestions >= 2 && !found.some((f) => f.kind === 'repeated_product_question')) {
    found.push({
      kind: 'repeated_product_question',
      labelAr: PURCHASE_SIGNAL_LABELS_AR.repeated_product_question,
      strength: 'contextual',
      snippet: `${priorQuestions} أسئلة سابقة عن المنتج`,
    });
  }

  const hasStrong = found.some((f) => f.strength === 'strong');
  const strongCount = found.filter((f) => f.strength === 'strong').length;
  const contextualCount = found.filter((f) => f.strength === 'contextual').length;

  let state: PurchaseIntentState;
  let confidence: PurchaseIntentResult['confidence'];
  let reason: string;

  if (hasStrong) {
    state = 'PURCHASE_SIGNAL';
    confidence = productVerified ? 'high' : 'medium';
    reason = 'إشارة شرائية قوية صريحة في النص.';
  } else if (contextualCount >= 2) {
    state = 'PURCHASE_SIGNAL';
    confidence = productVerified ? 'medium' : 'low';
    reason = 'إشارات شرائية سياقية متراكمة (سعر + توفر/تقسيط/مواصفات).';
  } else if (contextualCount === 1) {
    state = 'NEEDS_MORE_EVIDENCE';
    confidence = 'low';
    reason = 'إشارة سياقية واحدة — تحتاج دليلاً إضافياً قبل اعتبارها إشارة شراء.';
  } else {
    state = 'NO_PURCHASE_SIGNAL';
    confidence = 'none';
    reason = 'لا إشارة شرائية في النص (تفاعل/سؤال عام فقط).';
  }

  return {
    state,
    signals: found,
    strongest: hasStrong
      ? (found.find((f) => f.strength === 'strong')!.kind)
      : (found[0]?.kind ?? null),
    confidence,
    productVerified,
    productId,
    evidence: found.map((f) => `${f.kind}: ${f.snippet}`),
    source: `interaction:${input.platform}:${input.externalId}`,
    reason,
    at: new Date(input.nowMs).toISOString(),
    limitations: [
      'إشارة الشراء ليست بيعاً — تُؤكَّد فقط بسجل بيع موثّق.',
      productVerified ? 'مرجع المنتج موثّق.' : 'مرجع المنتج غير موثّق — لا يُنسب لمنتج محدّد.',
      strongCount >= 1 || contextualCount >= 2 ? 'الأدلة كافية للتصنيف.' : 'الأدلة غير كافية للتصنيف كإشارة شراء.',
    ],
  };
}
