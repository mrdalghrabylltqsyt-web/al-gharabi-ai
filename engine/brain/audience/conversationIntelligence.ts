/**
 * Conversation Intelligence — التعليقات كبحث سوق، لا كشيء نرد عليه فقط.
 *
 * يحوّل العقل التعليقات إلى: سؤال / شكوى / اعتراض / نية شراء / طلب ميزة / طلب
 * محتوى / مدح / سبام. ثم يكتشف المتكرر: موضوع، سؤال منتج، اعتراض، سؤال موقع،
 * سؤال سعر — ويقترح محتوى جديداً.
 *
 * حلقات صريحة:
 *   Comment → Classify → Extract Need → Aggregate → Detect Opportunity →
 *   Content Hypothesis (→ owner approval) → Content → Publish → Measure.
 *   Comment → Buying Intent → Verified Product Knowledge → Verified Price/Offer →
 *   Safe Reply → Lead → Owner/Business.
 *
 * **إذا السعر غير موثّق: لا يُخترع — يُصعَّد للمالك صراحةً.**
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../../social/adapter';
import { classifyComment, type ClassifiedComment, type CommentTopic } from '../../social/comments';

export type ConversationCategory =
  | 'question'
  | 'complaint'
  | 'objection'
  | 'purchase_intent'
  | 'feature_request'
  | 'content_request'
  | 'praise'
  | 'spam';

export const CONVERSATION_CATEGORY_LABELS_AR: Record<ConversationCategory, string> = Object.freeze({
  question: 'سؤال',
  complaint: 'شكوى',
  objection: 'اعتراض',
  purchase_intent: 'نية شراء',
  feature_request: 'طلب ميزة',
  content_request: 'طلب محتوى',
  praise: 'مدح',
  spam: 'سبام',
});

export interface ClassifiedConversation {
  category: ConversationCategory;
  topic: CommentTopic;
  text: string;
  externalId: string;
  platform: PlatformId;
  /** إشارة واضحة دعمت التصنيف (للتفسير). */
  signal?: string;
}

// ---------------------------------------------------------------------------
// أنماط حتمية عراقية/عربية للفئات التي لا يوفّرها مصنّف التعليقات العام.
// تُطبَّق على النص المطبَّع لتوحيد الألف/التاء/الهمزات. لا AI هنا.
// ---------------------------------------------------------------------------

/** اعتراض: رفض/تحفّظ على السعر أو الجودة أو الثقة بلا شكوى صريحة. */
const OBJECTION_PATTERNS = /غالي|غاليه|مبالغ|مبالغه|مو زين|مب زين|مادري|ما ادري|مو متأكد|ما اثق|مو واثق|بس مشكل|لكن مشكل|زحمه|بعيد|صعب|مو سهل|يحتاج وقت|ما يستاهل|مو مستاهل|خاف|اخاف|يخوف|مو مضمون|بدون ضمان|بدون كفاله/;
/** طلب ميزة: يريد خدمة/إمكانية غير موجودة في العرض الحالي. */
const FEATURE_REQUEST_PATTERNS = /سوو|سولنا|اعملوا|عملوا|اضيفوا|ضيفوا|زيدوا|خلوا|سوولي|ابغى خدمه|نريد خدمه|ياريت تسوون|ليش ماكو|ليش ما عندكم|ماكو خدمه|ماكو خاصيه|ماكو ميزه|اضافه خدمه|افتحوا|افتحولنا|طوروا|حدثوا/;
/** طلب محتوى: يطلب فيديو/شرح/مقارنة عن موضوع معيّن. */
const CONTENT_REQUEST_PATTERNS = /سوي فيديو|سووا فيديو|نريد فيديو|اريد فيديو|شرح|اشرح|وضح|وضحوا|مقارنه|قارنوا|نزلوا|انزلوا|سوو شرح|سوي شرح|حطوا فيديو|فيديو عن|موضوع عن|تكلموا عن|احكي عن|عرض تفصيلي/;

/**
 * يصنّف تعليقاً حقيقياً إلى فئة محادثة واحدة (حتمي محلي، بلا حصة AI).
 * ترتيب الأولوية: سبام ← شكوى ← نية شراء ← اعتراض ← طلب ميزة ← طلب محتوى ←
 * سؤال ← مدح. عند غياب أي دليل واضح يُستخدم «سؤال» (أأمن تصنيف عام) لا فئة مُختلقة.
 */
export function classifyConversation(input: {
  platform: PlatformId;
  externalId: string;
  text: string;
}): ClassifiedConversation {
  const cls: ClassifiedComment = classifyComment(input.text || '');
  const normalized = cls.normalized || '';
  let category: ConversationCategory;
  let signal = 'general';
  if (cls.isSpam) { category = 'spam'; signal = 'spam'; }
  else if (cls.isComplaint) { category = 'complaint'; signal = 'complaint'; }
  else if (OBJECTION_PATTERNS.test(normalized)) { category = 'objection'; signal = 'objection'; }
  else if (CONTENT_REQUEST_PATTERNS.test(normalized)) { category = 'content_request'; signal = 'content_request'; }
  else if (FEATURE_REQUEST_PATTERNS.test(normalized)) { category = 'feature_request'; signal = 'feature_request'; }
  else if (cls.isBusinessInquiry) { category = 'purchase_intent'; signal = 'business_inquiry'; }
  else if (cls.isQuestion) { category = 'question'; signal = 'question'; }
  else if (cls.isPraise) { category = 'praise'; signal = 'praise'; }
  else { category = 'question'; signal = 'general_fallback'; }
  return { category, topic: cls.topic, text: input.text, externalId: input.externalId, platform: input.platform, signal };
}

export interface RepeatedNeed {
  topic: CommentTopic;
  category: ConversationCategory;
  count: number;
  sampleSize: number;
  /** أمثلة معرّفات (بلا نص شخصي) للتفسير. */
  exampleIds: string[];
  confidence: 'low' | 'medium' | 'high';
  source: string;
}

export const REPEATED_NEED_MIN = 3;

/**
 * يجمّع الحاجات المتكررة من تعليقات حقيقية فقط. لا يعتبر حاجة «متكررة» بلا
 * عيّنة كافية، ويعيد فقط ما بلغ الحد.
 */
export function aggregateRepeatedNeeds(input: {
  platform: PlatformId;
  conversations: ClassifiedConversation[];
  min?: number;
}): RepeatedNeed[] {
  const min = input.min ?? REPEATED_NEED_MIN;
  const n = input.conversations.length;
  const groups = new Map<string, { topic: CommentTopic; category: ConversationCategory; ids: string[] }>();
  for (const c of input.conversations) {
    if (c.category === 'spam' || c.category === 'praise') continue;
    if (!c.topic || c.topic === 'general') continue;
    const key = `${c.topic}:${c.category}`;
    const cur = groups.get(key) || { topic: c.topic, category: c.category, ids: [] };
    cur.ids.push(c.externalId);
    groups.set(key, cur);
  }
  return [...groups.values()]
    .filter((g) => g.ids.length >= min)
    .map((g) => ({
      topic: g.topic,
      category: g.category,
      count: g.ids.length,
      sampleSize: n,
      exampleIds: g.ids.slice(0, 5),
      confidence: g.ids.length >= min * 2 ? 'medium' : 'low',
      source: `${input.platform} API — تصنيف تعليقات حتمي`,
    }));
}

// ---------------------------------------------------------------------------
// Comment → Content Loop
// ---------------------------------------------------------------------------

export interface ContentHypothesis {
  /** الحاجة التي أطلقت الفرضية. */
  need: RepeatedNeed;
  hypothesis: string;
  suggestedContent: string;
  expectedSignal: string;
  requiresOwnerApproval: boolean;
  evidence: string[];
  limitations: string;
}

/**
 * يحوّل حاجة متكررة إلى فرضية محتوى. لا يخترع تفاصيل (سعر/تقسيط رقمي)؛ يقترح
 * محتوى يشرح بلا أرقام غير مسجّلة، ويطلب موافقة المالك عند الحساسية.
 */
export function proposeContentFromNeed(input: {
  need: RepeatedNeed;
  /** حقائق مسجّلة متاحة (نصوص فقط، بلا اختراع). */
  verifiedFacts?: string[];
}): ContentHypothesis {
  const topicAr: Record<CommentTopic, string> = {
    location: 'الموقع',
    price: 'السعر/التقسيط',
    availability: 'التوفر',
    hours: 'أوقات الدوام',
    general: 'استفسار عام',
  };
  const label = topicAr[input.need.topic];
  const hasVerifiedPrice = input.need.topic !== 'price' || (input.verifiedFacts || []).some((f) => /سعر|تقسيط|قسط/.test(f));
  const requiresOwnerApproval = input.need.topic === 'price' && !hasVerifiedPrice;
  return {
    need: input.need,
    hypothesis: `محتوى يوضّح «${label}» سيرفع الإشارات المؤهّلة من الجمهور المحلي.`,
    suggestedContent: requiresOwnerApproval
      ? `فيديو يشرح إجراءات التقسيط/الاستفسار عن السعر **بلا أرقام** حتى تُسجَّل الأسعار الرسمية، مع دعوة للتواصل.`
      : `فيديو يجيب على «${label}» من بيانات المعرض المسجّلة فقط، مع دعوة للتواصل.`,
    expectedSignal: input.need.category === 'purchase_intent' ? 'استفسارات شراء' : 'تعليقات أسئلة/تفاعل',
    requiresOwnerApproval,
    evidence: [`${input.need.count} تعليقاً حقيقياً عن «${label}» خلال الفترة المرصودة.`],
    limitations: requiresOwnerApproval
      ? 'السعر غير موثّق؛ يُمنع ذكر أي رقم — يُصعَّد للمالك لتسجيل السعر الرسمي.'
      : 'المحتوى مبني على حاجة ملاحَظة؛ لا يضمن نتيجة.',
  };
}

// ---------------------------------------------------------------------------
// Comment → Sales Loop
// ---------------------------------------------------------------------------

export type SalesLoopDecision = 'safe_reply' | 'escalate_owner' | 'skip';

export interface SalesLoopResult {
  decision: SalesLoopDecision;
  /** نص رد آمن (بلا أرقام مُختلقة) أو null. */
  reply: string | null;
  reason: string;
  leadSignal: boolean;
  /** ما يجب على المالك فعله. */
  ownerAction: string | null;
}

/**
 * حلقة التعليق → البيع: عند نية شراء، لا يُولَّد رد يحمل سعراً/خصماً غير موثّق.
 * إن كان السعر موثّقاً يمكن ذكر النص المسجّل؛ وإلا يُصعَّد للمالك صراحةً.
 */
export function runSalesLoop(input: {
  conversation: ClassifiedConversation;
  /** هل معرفة المنتج موثّقة؟ */
  productKnowledgeVerified: boolean;
  /** السعر الموثّق (نص مسجّل) أو null. */
  verifiedPriceText: string | null;
  /** نص رد آمن جاهز من طبقة الردود (اختياري). */
  safeReply?: string | null;
}): SalesLoopResult {
  const c = input.conversation;
  if (c.category === 'spam') {
    return { decision: 'skip', reply: null, reason: 'سبام؛ لا يُرد عليه آلياً.', leadSignal: false, ownerAction: null };
  }
  if (c.category !== 'purchase_intent') {
    return { decision: 'skip', reply: input.safeReply ?? null, reason: 'لا نية شراء؛ لا يُشغَّل مسار البيع.', leadSignal: false, ownerAction: null };
  }
  if (!input.productKnowledgeVerified) {
    return {
      decision: 'escalate_owner',
      reply: null,
      reason: 'نية شراء لكن معرفة المنتج غير موثّقة؛ لا يُصاغ رد تجاري بلا حقائق.',
      leadSignal: true,
      ownerAction: 'وثّق مواصفات/تفاصيل المنتج قبل الرد التجاري.',
    };
  }
  // نية شراء + منتج موثّق: السعر شرط للذكر.
  if (c.topic === 'price' && !input.verifiedPriceText) {
    return {
      decision: 'escalate_owner',
      reply: null,
      reason: 'سؤال سعر بلا سعر موثّق — يُمنع اختراع رقم؛ يُصعَّد للمالك.',
      leadSignal: true,
      ownerAction: 'سجّل السعر/سياسة التقسيط الرسمية، ثم يُصاغ رد آمن يحمل النص المسجّل.',
    };
  }
  const reply = input.safeReply
    || (input.verifiedPriceText
      ? `سعر هذا المنتج المسجّل لدينا: ${input.verifiedPriceText}. تواصل معنا لإتمام الحجز.`
      : 'تواصل معنا عبر قنوات المعرض الرسمية وسنجيبك بالتفاصيل المسجّلة.');
  return {
    decision: 'safe_reply',
    reply,
    reason: 'نية شراء مع حقائق موثّقة (والسعر موثّق عند الحاجة)؛ رد آمن بلا اختراع.',
    leadSignal: true,
    ownerAction: null,
  };
}
