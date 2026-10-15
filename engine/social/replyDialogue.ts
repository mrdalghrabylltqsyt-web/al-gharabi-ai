/**
 * حلقة الحوار/التوضيح (Conversational Clarification Loop) — منطق صافٍ قابل للاختبار.
 *
 * الغرض: عندما لا يستطيع المصنّف الحتمي تحديد ما يريده العميل بثقة (نية غامضة/
 * استفسار عام بلا موضوع، أو سؤال سعر بلا منتج/سعر مسجّل)، لا يخمّن النظام ولا
 * يُصعّد فوراً، بل **يولّد سؤال توضيح قصيراً وودّياً باللهجة العراقية** ويُرسله
 * لذلك الشخص. وعند ردّ العميل في نفس الخيط، تُعاد معالجة الرسالة التالية مع سياق
 * الرسائل السابقة (رسالته + سؤال التوضيح + جوابه)، فيبقى العقل «يتناقش» حتى يفهم.
 *
 * المبادئ الملزمة:
 * - لا شبكة، ولا أسرار، ولا ساعة حقيقية (الزمن يُمرَّر). لا بيانات هوية عميل.
 * - لا اختراع أي معلومة (سعر/قسط/توفر): عند نقص الحقائق يُسأل العميل أو يُصعّد.
 * - لا يخالف حارس سلامة المحتوى: النص المولّد هنا حتمي وودّي وبلا أي ادّعاء.
 * - المسار الذكي (Gemini) يبقى خارج هذا الملف؛ هنا فقط النص الحتمي البديل الآمن.
 */

import { generateReply, type ClassifiedComment, type GeneratedReply, type ReplyFactSet, type ReplyContext } from './comments';
import { normalizeArabic } from './contentSafety';
import { wrapUntrustedText, UNTRUSTED_TEXT_POLICY_AR } from '../ai/untrusted';

/** الحد الأقصى لجولات التوضيح في نفس الخيط قبل التصعيد للمالك (منع حلقة لا نهائية). */
export const MAX_CLARIFICATION_ROUNDS = 2;

/** الأدوار في نافذة المحادثة قصيرة المدى (نفس شكل conversationState). */
export interface DialogueTurn {
  role: 'customer' | 'business';
  text: string;
}

/** سياق الحوار لنفس العميل/الخيط — يُبنى من conversationState في الخادم. */
export interface DialogueContext {
  /** نافذة قصيرة المدى: الأحدث آخراً (رسالته، سؤالنا، جوابه...). */
  turns?: DialogueTurn[];
  /** عدد أسئلة التوضيح التي أرسلناها سابقاً في هذا الخيط. */
  clarificationRounds?: number;
  /** ردودنا السابقة (لمنع التكرار الميكانيكي في محرّك الردود). */
  previousReplies?: string[];
  /** عنوان المنشور/الموضوع عند توفره (سياق حقيقي فقط). */
  subjectTitle?: string;
  /** هل مرّت الرسالة الحالية عبر مزود الذكاء (Gemini)؟ يُملأ في الخادم. */
  usedAi?: boolean;
}

/** نتيجة توليد الرد الحواري: رد المحرّك الحتمي + هل هو سؤال توضيح. */
export interface DialogueReply extends GeneratedReply {
  /** هل هذا النص سؤال توضيح (لا جواب نهائي)؟ */
  clarifying: boolean;
  /** رقم جولة التوضيح التي أُنتج فيها (0 = أول سؤال). */
  dialogueRound: number;
  /** هل يستحق التصعيد للمالك بدل السؤال (تجاوز حد الجولات)؟ */
  escalateToOwner: boolean;
}

function stableHash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/** يختار صيغة ثابتة لنفس المدخل (idempotency) مع تفادي تكرار الصيغ السابقة. */
function pick(variants: string[], seed: string, previous: string[]): string {
  const fresh = variants.filter((v) => !previous.includes(v));
  const pool = fresh.length ? fresh : variants;
  return pool[stableHash(seed) % pool.length];
}

/** عدد أسئلة التوضيح السابقة المُستنتجة من السياق (صريح ثم من الأدوار). */
function priorClarificationCount(ctx: DialogueContext): number {
  if (typeof ctx.clarificationRounds === 'number' && Number.isFinite(ctx.clarificationRounds)) {
    return Math.max(0, Math.floor(ctx.clarificationRounds));
  }
  const turns = Array.isArray(ctx.turns) ? ctx.turns : [];
  return turns.filter((t) => t.role === 'business' && /نقدر نساعدك|خبرني|وضّحلي|أي موديل|تقصد/.test(t.text)).length;
}

/**
 * هل نحتاج سؤال توضيح بدل الجواب/التصعيد الفوري؟
 * - نعم: استفسار تجاري/سؤال بموضوع عام (لا نعرف عن أي منتج/أي تفاصيل يتحدث).
 * - نعم: سؤال سعر بلا سعر مسجّل (لا نخترع السعر — نسأل أي موديل يقصد).
 * - لا: مدح/شكر/تحية/إيموجي (رد مباشر)، شكوى/سبام/حساس (تصعيد)، أو تجاوزنا حد الجولات.
 */
export function shouldRequestClarification(
  comment: ClassifiedComment,
  facts: ReplyFactSet = {},
  ctx: DialogueContext = {},
): boolean {
  if (comment.intent === 'spam' || comment.requiresHumanReview) return false;
  if (comment.intent === 'complaint') return false;
  if (comment.intent === 'praise' || comment.subIntent !== 'none') return false;
  const isInquiry = comment.intent === 'business_inquiry' || comment.intent === 'question' || comment.isBusinessInquiry || comment.isQuestion;
  if (!isInquiry) return false;
  if (priorClarificationCount(ctx) >= MAX_CLARIFICATION_ROUNDS) return false;
  if (comment.topic === 'price' && !facts.priceText) return true;
  if (comment.topic === 'location' && !facts.locationText) return true;
  if (comment.topic === 'availability' && (facts.inStock === null || facts.inStock === undefined)) return true;
  if (comment.topic === 'hours' && !facts.hoursText) return true;
  if (comment.topic === 'general') return true;
  return false;
}

/** قائمة أسئلة توضيح قصيرة ودافئة لكل موضوع (تُختار حتمياً وتتفادى التكرار). */
const CLARIFY_BANK: Readonly<Record<string, readonly string[]>> = Object.freeze({
  general: [
    'هلا بيك 🌸 نقدر نساعدك، بس خبرني أي موديل أو منتج يهمك بالضبط؟',
    'تدلل 🌹 وضّحلي شنو تحتاج بالضبط (أي منتج أو موديل) وأنا أدلك على كل شي.',
    'حياك الله، خبرني أي موديل تقصد وتريد سعر كاش لو تقسيط؟',
  ],
  price: [
    'هلا بيك، تدلل. خبرني أي موديل تقصد وأنا أحسبلك السعر والقسط الأدق 🌸',
    'من عيوني 🌹 بس وضّحلي اسم الموديل، وتريد نقدّم لك سعر كاش لو تقسيط؟',
  ],
  location: [
    'تدلل 🌸 خبرني أي فرع أو أي مدينة تقصد، وأدلك على أقرب موقع إلك.',
    'هلا بيك، وضّحلي منطقتك أو الفرع اللي تريد وأوصلك الموقع الأدق.',
  ],
  availability: [
    'تدلل 🌸 خبرني أي موديل بالضبط تريد نتأكدلك من توفره.',
    'هلا بيك، وضّحلي المنتج والموديل وأنا أشوفلك التوفر الحقيقي.',
  ],
  hours: [
    'هلا بيك 🌸 خبرني أي فرع تقصد حتى أعطيك أوقات دوامه الأدق.',
    'تدلل، وضّحلي الفرع وأنا أقولك أوقات الدوام بالضبط.',
  ],
});

/** جولة متابعة (بعد سؤال أول بلا جواب واضح): أكثر تحديداً وأقرب للتفاصيل. */
const CLARIFY_FOLLOWUP: readonly string[] = Object.freeze([
  'تدلل 🌹 حتى نساعدك بسرعة: أي موديل بالضبط، وتريد سعر كاش لو تقسيط؟',
  'هلا بيك، خبرني الموديل + إذا تريد كاش أو تقسيط، وأنا أرتبلك كل التفاصيل.',
]);

/** موضوع التوضيح الفعّال: يتبع أداة السؤال (tool) لمطابقة الحقول. */
function clarificationTopic(comment: ClassifiedComment): 'general' | 'price' | 'location' | 'availability' | 'hours' {
  switch (comment.topic) {
    case 'price': return 'price';
    case 'location': return 'location';
    case 'availability': return 'availability';
    case 'hours': return 'hours';
    default: return 'general';
  }
}

/**
 * يولّد سؤال التوضيح الحتمي (بلا AI). عند تجاوز حد الجولات يعيد `escalateToOwner`.
 * النص قصير، ودّي، عراقي، وبلا أي معلومة مُختلقة.
 */
export function buildClarificationReply(
  comment: ClassifiedComment,
  facts: ReplyFactSet = {},
  ctx: DialogueContext = {},
): DialogueReply {
  const previous = Array.isArray(ctx.previousReplies) ? ctx.previousReplies.filter(Boolean) : [];
  const round = priorClarificationCount(ctx);
  const seed = `${comment.normalized}|clarify|${clarificationTopic(comment)}|${round}`;

  if (round >= MAX_CLARIFICATION_ROUNDS) {
    return {
      text: 'هلا بيك 🌸 خلي نوصلك للتفاصيل الأدق عبر الرسائل الخاصة حتى ما نتأخر عليك.',
      strategy: 'clarify_max_rounds_escalate', usedFacts: [], needsInfo: true, escalate: true,
      clarifying: true, dialogueRound: round, escalateToOwner: true,
      reason: 'تجاوز حد جولات التوضيح بلا فهم كافٍ ⇒ إحالة للمالك بدل حلقة لا نهائية.',
    };
  }

  const bank = round === 0 ? (CLARIFY_BANK[clarificationTopic(comment)] || CLARIFY_BANK.general) : CLARIFY_FOLLOWUP;
  const text = pick([...bank], seed, previous);
  return {
    text, strategy: 'clarify_question', usedFacts: [], needsInfo: true, escalate: false,
    clarifying: true, dialogueRound: round, escalateToOwner: false,
    reason: `نية/موضوع غير محدّد (جولة ${round + 1}) ⇒ سؤال توضيح ودّي بلا اختراع معلومة.`,
  };
}

/**
 * البرومبت للمسار الذكي (Gemini) عند الحاجة لسؤال توضيحي «حرّ» أكثر طبيعية.
 * يُمرَّر عبر `aiEngine` (جدار الحماية) في الخادم؛ هنا نصّ البرومبت فقط (بلا شبكة).
 */
export function buildClarificationPrompt(comment: ClassifiedComment, facts: ReplyFactSet = {}, ctx: DialogueContext = {}): string {
  const turns = Array.isArray(ctx.turns) ? ctx.turns.slice(-6) : [];
  // كل نص خارجي (تعليق العميل، ردودنا السابقة، عنوان المنشور) يُغلَّف كبيانات لا تعليمات.
  const history = turns.map((t) => `${t.role === 'customer' ? 'العميل' : 'المعرض'}: ${wrapUntrustedText(t.text)}`).join('\n');
  const product = facts.productName ? `منتج مطابق محتمل: ${wrapUntrustedText(facts.productName)}.` : 'لا منتج مطابق مؤكّد.';
  return [
    'أنت مسؤول خدمة عملاء عراقي ودود في معرض الغرابي للتقسيط.',
    'المطلوب: سؤال توضيح قصير (سطر واحد) باللهجة العراقية الطبيعية لفهم ما يريده العميل بالضبط.',
    'لا تخترع أي سعر أو قسط أو توفّر أو معلومة غير مسجّلة. لا تعرض أرقاماً.',
    product,
    UNTRUSTED_TEXT_POLICY_AR,
    history ? `سياق الحوار:\n${history}` : 'لا سياق سابق.',
    ctx.subjectTitle ? `عنوان المنشور: ${wrapUntrustedText(ctx.subjectTitle)}` : '',
    `رسالة العميل الأخيرة: ${wrapUntrustedText(comment.normalized || '')}`,
    'اكتب السؤال فقط بلا مقدمات.',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// تأريض الكتالوج: مطابقة المنتج من نص العميل ومنشور مرتبط — بلا تخمين النية.
// ---------------------------------------------------------------------------

/** يطبّع اسم المنتج/النص للمقارنة (نفس تطبيع الحارس: همزات/تاء/مسافات). */
function norm(s: string): string {
  return normalizeArabic(String(s || '')).toLowerCase();
}

/**
 * يطابق منتجاً مسجّلاً من نص العميل عبر **ذكر اسمه حرفياً** (بعد التطبيع).
 * لا استنتاج: يجب أن يحتوي النص على اسم المنتج (≥3 محارف)، ويُفضّل الأطول مطابقة.
 * يُعيد null عند عدم التطابق (فلا اختراع).
 */
export function matchCatalogProduct(text: string, products: any[]): any | null {
  const hay = norm(text);
  if (!hay) return null;
  let best: any | null = null;
  let bestLen = 0;
  for (const p of Array.isArray(products) ? products : []) {
    const name = norm(p?.name);
    if (name.length >= 3 && hay.includes(name) && name.length > bestLen) {
      best = p; bestLen = name.length;
    }
  }
  return best;
}

/**
 * يحسم المنتج المرجعي لحقائق الرد: منشور مرتبط بسعر مسجّل ← وإلا مطابقة اسم
 * صريحة في نص العميل ← وإلا null (فتُصعّد/تُسأل بلا اختراع).
 */
export function resolveGroundingProduct(input: { commentText: string; postProduct?: any | null; products?: any[] }): any | null {
  const post = input.postProduct || null;
  if (post && Number.isFinite(Number(post.cashPrice)) && Number(post.cashPrice) > 0) return post;
  return matchCatalogProduct(input.commentText, input.products || []);
}

/**
 * المُنسّق الحواري: يقرّر بين سؤال التوضيح، أو الرد الحتمي المباشر من الحقائق.
 * لا AI هنا — الخادم يستدعي المسار الذكي فوق هذا عند الحاجة ويسقط لهذا عند فشل المزود.
 */
export function generateConversationalReply(
  comment: ClassifiedComment,
  facts: ReplyFactSet = {},
  ctx: DialogueContext = {},
): DialogueReply {
  if (shouldRequestClarification(comment, facts, ctx)) {
    return buildClarificationReply(comment, facts, ctx);
  }
  // استنفدنا جولات التوضيح وما زال الاستفسار غير قابل للحل (موضوع عام/نقص حقائق)
  // ⇒ تصعيد للمالك بدل حلقة لا نهائية أو جواب عام قد لا يفيد.
  const rounds = priorClarificationCount(ctx);
  const unresolvedInquiry = comment.intent !== 'complaint' && comment.intent !== 'spam' && !comment.requiresHumanReview
    && (comment.intent === 'business_inquiry' || comment.intent === 'question' || comment.isBusinessInquiry || comment.isQuestion)
    && (comment.topic === 'general'
      || (comment.topic === 'price' && !facts.priceText)
      || (comment.topic === 'location' && !facts.locationText)
      || (comment.topic === 'availability' && (facts.inStock === null || facts.inStock === undefined))
      || (comment.topic === 'hours' && !facts.hoursText));
  if (unresolvedInquiry && rounds >= MAX_CLARIFICATION_ROUNDS) {
    return {
      text: 'هلا بيك 🌸 خلي نوصلك للتفاصيل الأدق عبر الرسائل الخاصة حتى ما نتأخر عليك.',
      strategy: 'clarify_exhausted_escalate', usedFacts: [], needsInfo: true, escalate: true,
      clarifying: false, dialogueRound: rounds, escalateToOwner: true,
      reason: 'استُنفدت جولات التوضيح بلا فهم كافٍ ⇒ تصعيد للمالك (لا حلقة، لا اختراع).',
    };
  }
  const replyCtx: ReplyContext = {
    authorName: undefined,
    videoTitle: ctx.subjectTitle,
    previousReplies: ctx.previousReplies,
    platform: undefined,
  };
  const base = generateReply(comment, facts, replyCtx);
  return { ...base, clarifying: false, dialogueRound: rounds, escalateToOwner: base.escalate };
}
