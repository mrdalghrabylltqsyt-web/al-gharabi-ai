/**
 * تحليل التعليقات وصياغة الردود.
 *
 * كل التصنيف هنا حتمي (بدون استهلاك أي حصة ذكاء اصطناعي). الذكاء الاصطناعي
 * يُستخدم فقط لصياغة الردود في حالات غير حساسة وعندما يكون المزود متاحاً.
 *
 * الحمايات المطبقة:
 * - منع الرد المكرر على نفس التعليق (سجل بالمعرّف لدى المنصة).
 * - منع تكرار نفس الرد على تعليقات مختلفة (كشف التكرار النصي).
 * - منع حلقات الرد على تعليقات حسابنا نفسه.
 * - منع سبام الروابط والطلبات المتكررة.
 * - التعليقات الحساسة تُحوَّل لمراجعة بشرية ولا يُرسل لها رد آلي.
 */

export type CommentIntent =
  | 'question'
  | 'complaint'
  | 'praise'
  | 'business_inquiry'
  | 'spam'
  | 'other';

export type CommentSentiment = 'positive' | 'negative' | 'neutral';

/**
 * موضوع التعليق الدقيق، مستخرج من نصه لا من تخمين. يسمح بردّ مختلف لسؤال
 * الموقع عن سؤال السعر، وبذلك لا تكون الردود قالباً واحداً لكل «سؤال».
 */
export type CommentTopic = 'location' | 'price' | 'availability' | 'hours' | 'general';

/**
 * نية ثانوية دقيقة داخل المدح/التحية: شكر صريح، دعاء، تحية، إعجاب، أو إيموجي
 * فقط. المدح العام ليس شيئاً واحداً — «شكراً» تختلف عن «اللهم صل على محمد».
 */
export type CommentSubIntent = 'thanks' | 'blessing' | 'greeting' | 'appreciation' | 'emoji' | 'none';

export interface ClassifiedComment {
  intent: CommentIntent;
  sentiment: CommentSentiment;
  /** أعلام صريحة تُعرض للواجهة دون إعادة تفسير النية. */
  isQuestion: boolean;
  isComplaint: boolean;
  isPraise: boolean;
  isBusinessInquiry: boolean;
  isSpam: boolean;
  /** هل تحتاج مراجعة بشرية قبل أي رد آلي؟ */
  requiresHumanReview: boolean;
  /** سبب التحويل لمراجعة بشرية إن وُجد. */
  reviewReason?: string;
  /** إشارات استُخرجت من نص التعليق. */
  signals: string[];
  /** موضوع السؤال/الاستفسار الدقيق (موقع/سعر/توفر/دوام). */
  topic: CommentTopic;
  /** النية الثانوية الدقيقة (شكر/دعاء/تحية/إعجاب/إيموجي). */
  subIntent: CommentSubIntent;
  /** تعليق يتكوّن من إيموجي/رموز فقط بلا نص فعلي. */
  isEmojiOnly: boolean;
  /** النص بعد التطبيع (توحيد الألف/التاء/الهمزات) — محور التحليل. */
  normalized: string;
}

const PATTERNS = {
  complaint: /شكوى|شاكي|زعلان|تأخير|تاخير|سيء|سيئ|مشكلة|مشكله|غاضب|احتيال|نصب|وعد|كذب|مو زين|تعبت/,
  // تشمل العبارات العراقية والعفوية الشائعة (مدح/شكر/ترحيب) لا الفصحى وحدها،
  // كي لا يُصنَّف تعليق إيجابي واضح («مرتب»، «ما شاء الله»، «تسلمون») كأنه مجهول.
  praise: /شكرا|شكراً|شكر|ممتاز|رائع|جميل|حلو|مرتب|منظم|بارك الله|ما شاء الله|ماشاء الله|الله يوفق|الله يبارك|الله يسلم|الله يخليك|الله يعطيك|تسلم|تسلمون|تسلموا|يعطيك|عاشت ايدك|عاشت ايديكم|عاشت|خدمة طيبة|تعامل راقي|احسن|أحسن|هلا|أهلا|اهلا|يا هلا|مرحبا|حياك|نورت|تحياتي|تدلل|بالتوفيق|موفقين|تمام|زين/,
  business: /كم سعر|بكم|السعر|سعرها|سعره|شكد|قسط|اقساط|أقساط|دفعة|مقدم|تقسيط|متوفر|متوفرة|مطلوب|اشتري|ابي|أريد|اريد|حجز|حاسبة|شروط|مستندات|راتب|ماستر/,
  question: /هل |كيف|وين|متى|ليش|شلون|أين|اين|ماذا|شنو|بكم/,
  spam: /https?:\/\/|www\.|ربح|استثمار|عملة|بيتكوين|كازينو|قرض سريع|متابعة مقابل|فولو/,
  contactLeak: /\b07\d{8}\b|\b\d{10,}\b/,
};

/** تفاعل إيجابي صريح بالإيموجي (قلوب/إعجاب/تصفيق...) — تفاعل اجتماعي حميد. */
const POSITIVE_EMOJI_RE = /[❤♥💙💚💛🧡💜🤍🖤💕💞💓💗❣😍🥰😘😊🙂👏👍🙏🌹✨🎉]/u;
/** تعليق يتكوّن من إيموجي/رموز فقط (بلا نص): يُعامل كتفاعل إيجابي بسيط. */
const EMOJI_ONLY_RE = /^[\s\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]+$/u;

// أنماط دقيقة تُستخدم لتحديد الموضوع والنية الثانوية. تُطابق على النص **المطبَّع**
// (توحيد الألف/التاء/الهمزات) لتفادي تفويت «وين موقعكم» مقابل «أين موقعكم».
const TOPIC_PATTERNS: Record<Exclude<CommentTopic, 'general'>, RegExp> = {
  location: /موقع|وين\s*(موقع|انتو|توجد|فرع|صاير)|وين\s*انتوا|اين\s*(انتم|موقع|فرع|توجد|صاير)|مكانكم|عنوانكم|فروعكم|فرعكم|توصيل/,
  price: /سعر|بكم|كم\s*(يكلف|سعر|ثمن)|شكد|قسط|اقساط|مقدم|دفعة|دفعه|حسبه|حسبة|ثمن/,
  availability: /متوفر|متوفره|متاح|موجود|يوجد|اكو|عدكم|عندكم|مطلوب|جاهز|محجوز|خلص|نافد/,
  hours: /دوام|تفتحون|تفتح|تغلقون|وقت|اوقات|ساعات|مفتوح|مغلق|الدوام|ساعه/,
};

const SUB_INTENT_PATTERNS: Record<Exclude<CommentSubIntent, 'none' | 'emoji'>, RegExp> = {
  blessing: /اللهم صل|صلى الله|صل الله|عليه السلام|عليه افضل الصلاه|الله اكبر|الحمد لله|لا حول ولا قوه|جزاك الله|بارك الله فيك|الله يوفق|الله يخليك|الله يرحم/,
  thanks: /شكرا|شكر|مشكور|تسلم|تسلمون|الله يسلم|ممنون|الف شكر|عاشت ايد|عاشت ايديكم|عشت/,
  greeting: /هلا|اهلا|مرحبا|يا هلا|السلام عليكم|صباح الخير|مساء الخير|نورت|نورتو|تحياتي|هلو/,
  appreciation: /ممتاز|رائع|جميل|حلو|ابداع|مرتب|شغل نظيف|ما قصرتوا|خدمة طيبة|تعامل راقي|احسن|افضل|يعطيكم العافيه|ما شاء الله|ماشاء الله|تبارك الله|عاشت ايديكم|عاش من شافكم/,
};

/** يقصّ الإيموجي والرموز والمسافات ويُبقي الحروف والأرقام فقط. */
function stripSymbols(input: string): string {
  return input
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\uFE0F\u200D]/gu, '')
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, '')
    .trim();
}

/** تطبيع عربي مصغّر: توحيد الألف/التاء المربوطة/الياء والهمزات لإحكام المطابقة. */
function normalizeForMatch(input: string): string {
  return String(input ?? '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/[ةه]$/, 'ه')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectTopic(normalized: string): CommentTopic {
  if (!normalized) return 'general';
  for (const topic of ['location', 'price', 'availability', 'hours'] as const) {
    if (TOPIC_PATTERNS[topic].test(normalized)) return topic;
  }
  return 'general';
}

function detectSubIntent(normalized: string, isEmojiOnly: boolean): CommentSubIntent {
  if (isEmojiOnly) return 'emoji';
  for (const sub of ['blessing', 'thanks', 'greeting', 'appreciation'] as const) {
    if (SUB_INTENT_PATTERNS[sub].test(normalized)) return sub;
  }
  return 'none';
}

/** كلمات تستوجب مراجعة بشرية دائماً: لا يجوز الرد الآلي عليها. */
const HUMAN_REVIEW_PATTERNS = /شكوى|شاكي|غاضب|احتيال|نصب|محامي|قانوني|قضية|استرجاع|فسخ|تعويض|تسريب|بياناتي|خصوصية/;

export function classifyComment(text: string): ClassifiedComment {
  const raw = (text || '').trim();
  const signals: string[] = [];

  if (!raw) {
    return {
      intent: 'other', sentiment: 'neutral',
      isQuestion: false, isComplaint: false, isPraise: false, isBusinessInquiry: false, isSpam: false,
      requiresHumanReview: true, reviewReason: 'نص التعليق فارغ.', signals,
      topic: 'general', subIntent: 'none', isEmojiOnly: false, normalized: '',
    };
  }

  const normalized = normalizeForMatch(raw);
  const isEmojiOnly = stripSymbols(raw).length === 0;

  const isSpam = PATTERNS.spam.test(raw);
  if (isSpam) signals.push('spam');

  const hasComplaint = PATTERNS.complaint.test(raw);
  const hasPraise = PATTERNS.praise.test(raw);
  const hasBusiness = PATTERNS.business.test(raw);
  const hasQuestion = PATTERNS.question.test(raw);
  const hasContact = PATTERNS.contactLeak.test(raw);
  /** علامة استفهام صريحة ترفع أولوية السؤال على المجاملة. */
  const explicitQuestion = /[?؟]/.test(raw);
  /** تعليق إيموجي فقط أو يحمل إيموجي إيجابياً صريحاً = تفاعل اجتماعي إيجابي. */
  const emojiOnly = EMOJI_ONLY_RE.test(raw);
  const positiveEmoji = POSITIVE_EMOJI_RE.test(raw);
  /** لا يوجد نص عربي حقيقي (رسالة إيموجي/رموز فقط). */
  const noArabicText = !/[\u0600-\u06FF]/.test(raw);

  if (hasComplaint) signals.push('complaint');
  if (hasPraise) signals.push('praise');
  if (hasBusiness) signals.push('business');
  if (hasQuestion) signals.push('question');
  if (hasContact) signals.push('contact_info');
  if (positiveEmoji) signals.push('positive_emoji');
  if (isEmojiOnly) signals.push('emoji_only');

  const topic = detectTopic(normalized);
  const subIntent = detectSubIntent(normalized, isEmojiOnly);

  // الترتيب مقصود: الشكوى، ثم المدح الصريح (لأن عبارات المجاملة مثل "شكراً لكم"
  // تتضمن كلمة "كم" ولا يجوز اعتبارها سؤالاً)، ثم الاستفسار التجاري، ثم السؤال،
  // ثم الإيموجي فقط (بلا نص عربي) = تفاعل إيجابي بسيط، لا سؤال ولا مجهول.
  let intent: CommentIntent = 'other';
  if (isSpam) intent = 'spam';
  else if (hasComplaint) intent = 'complaint';
  else if (hasPraise && !explicitQuestion) intent = 'praise';
  else if (hasBusiness) intent = 'business_inquiry';
  else if (hasQuestion || explicitQuestion) intent = 'question';
  else if (hasPraise) intent = 'praise';
  else if (emojiOnly || (positiveEmoji && noArabicText)) intent = 'praise';

  const isPraise = intent === 'praise';
  let sentiment: CommentSentiment = 'neutral';
  if (hasComplaint) sentiment = 'negative';
  else if (isPraise) sentiment = 'positive';

  const requiresHumanReview = HUMAN_REVIEW_PATTERNS.test(raw) || isSpam;
  const reviewReason = isSpam
    ? 'تعليق مصنف كسبام؛ لا يُرد عليه آلياً.'
    : requiresHumanReview
      ? 'تعليق حساس يستوجب مراجعة بشرية قبل أي رد.'
      : undefined;

  return {
    intent,
    sentiment,
    isQuestion: hasQuestion || explicitQuestion,
    isComplaint: hasComplaint,
    isPraise,
    isBusinessInquiry: hasBusiness,
    isSpam,
    requiresHumanReview,
    reviewReason,
    signals,
    topic,
    subIntent,
    isEmojiOnly,
    normalized,
  };
}

/**
 * هل يجوز إرسال رد آلي لهذا التعليق؟
 * لا رد على السبام، ولا رد على الحالات الحساسة.
 */
export function canAutoReply(comment: ClassifiedComment): boolean {
  if (comment.requiresHumanReview) return false;
  if (comment.intent === 'spam') return false;
  return true;
}

/** كشف حلقات الرد: لا نرد على تعليق صادر من حسابنا أو من النظام. */
export function isSelfAuthored(authorName: string | undefined, ownNames: string[]): boolean {
  const name = (authorName || '').trim().toLowerCase();
  if (!name) return false;
  return ownNames.some((own) => own.trim().toLowerCase() === name);
}

export interface ReplyRecord {
  /** معرّف التعليق لدى المنصة. */
  externalId: string;
  /** بصمة نص الرد لمنع تكرار نفس الرد. */
  replyFingerprint: string;
  repliedAt: string;
}

export interface ReplyGuardDecision {
  allowed: boolean;
  reason?: string;
  fingerprint: string;
}

/** بصمة نصية مستقرة لمنع تكرار نفس الرد حرفياً. */
export function fingerprintReply(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 400);
}

/**
 * بوابة الرد: تمنع الرد المكرر على نفس التعليق، ومنع نفس النص مرات كثيرة،
 * وبذلك تمنع تكرار المعالجة بسبب webhook replay أو retry.
 */
export function evaluateReplyGuard(input: {
  externalId: string;
  replyText: string;
  history: ReplyRecord[];
  /** أقصى عدد مرات مسموح بها لنفس نص الرد. */
  maxIdenticalReplies?: number;
}): ReplyGuardDecision {
  const fingerprint = fingerprintReply(input.replyText);
  const maxIdentical = input.maxIdenticalReplies ?? 2;

  if (!input.externalId) {
    return { allowed: false, reason: 'معرّف التعليق لدى المنصة مطلوب لمنع الرد المكرر.', fingerprint };
  }
  if (!fingerprint) {
    return { allowed: false, reason: 'نص الرد فارغ.', fingerprint };
  }

  // منع الرد مرتين على نفس التعليق (يشمل إعادة إرسال نفس الحدث).
  if (input.history.some((r) => r.externalId === input.externalId)) {
    return { allowed: false, reason: 'تم الرد على هذا التعليق مسبقاً.', fingerprint };
  }

  // منع تكرار نفس النص على تعليقات كثيرة (سلوك سبام آلي).
  const identical = input.history.filter((r) => r.replyFingerprint === fingerprint).length;
  if (identical >= maxIdentical) {
    return { allowed: false, reason: 'تكرار نفس نص الرد على تعليقات متعددة؛ يتطلب مراجعة بشرية.', fingerprint };
  }

  return { allowed: true, fingerprint };
}

/**
 * حقائق المعرض المتاحة للرد (قيم موثوقة مسجّلة فعلاً فقط).
 * أي حقل غائب يعني «غير متاح» ⇒ الرد لا يدّعيه أبداً بل يلجأ لسؤال/إحالة.
 */
export interface ReplyFactSet {
  productName?: string;
  /** سعر منسَّق من بيانات مسجّلة فقط (يجب أن يطابق مبالغ BusinessFacts). */
  priceText?: string;
  /** موقع/عنوان مسجّل فعلاً. */
  locationText?: string;
  /** دوام مسجّل فعلاً. */
  hoursText?: string;
  /** هل المنتج متوفر فعلاً؟ null = غير معروف. */
  inStock?: boolean | null;
  hasRecordedPromotion?: boolean;
}

/** سياق المحادثة/الفيديو: يجعل الرد متعلقاً لا قالباً معزولاً. */
export interface ReplyContext {
  authorName?: string;
  /** عنوان الفيديو/المنشور الذي جاء منه التعليق عند توفره. */
  videoTitle?: string;
  /** نصوص ردودنا السابقة (لمنع التكرار الميكانيكي). */
  previousReplies?: string[];
  platform?: string;
}

export interface GeneratedReply {
  text: string;
  /** استراتيجية الرد المختارة (للتشخيص/العرض، بلا أسرار). */
  strategy: string;
  /** الحقائق الموثوقة التي استُخدمت فعلاً في الرد. */
  usedFacts: string[];
  /** هل احتاج الرد معلومة حقيقية غير مسجّلة فامتنع عنها؟ */
  needsInfo: boolean;
  /** هل القرار رفع القضية لمراجعة بشرية؟ */
  escalate: boolean;
  /** تعليل عربي صريح لاختيار الاستراتيجية. */
  reason: string;
}

/** بصمة رقمية مستقرة (djb2) لاختيار صيغة ثابتة لنفس المدخل. */
function stableHash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/**
 * يختار صيغة من قائمة: نفس المدخل يعطي نفس النص (ثبات/idempotency)، لكن المدخلات
 * المختلفة توزَّع على صيغ مختلفة، وتُستثنى الصيغ المستخدمة سابقاً في نفس المحادثة
 * لمنع التكرار الميكانيكي.
 */
function pickVariant(variants: string[], seed: string, previous: string[]): string {
  if (variants.length === 0) return '';
  const fresh = variants.filter((v) => !previous.includes(v));
  const pool = fresh.length ? fresh : variants;
  return pool[stableHash(seed) % pool.length];
}

/** يبني بادئة اسم المنتج بأمان لغوي عند توفره. */
function withProduct(name: string | undefined, sentence: (p: string) => string): string {
  const p = (name || '').trim();
  return p ? sentence(p) : sentence('');
}

/**
 * محرّك صياغة الردود «Reply Intelligence»: يقرأ نص التعليق ومعناه ونيته الدقيقة
 * وموضوعه وسياقه وحقائق المعرض، ثم يولّد رداً عراقياً طبيعياً مناسباً.
 *
 * - حتمي بالكامل: لا شبكة ولا مزود ولا استهلاك حصة. Gemini يبقى طبقة اختيارية
 *   أعلى هذا المحرّك عند الحاجة، لا بديلاً عنه.
 * - يمتنع عن اختراع أي معلومة غير مسجّلة (سعر/موقع/دوام/توفر) ويلجأ للتوضيح/الإحالة.
 * - الردود القصيرة تبقى قصيرة، والردود لا تتحوّل إلى إعلان تسويقي.
 */
export function generateReply(
  comment: ClassifiedComment,
  facts: ReplyFactSet = {},
  context: ReplyContext = {},
): GeneratedReply {
  const previous = Array.isArray(context.previousReplies) ? context.previousReplies.filter(Boolean) : [];
  const seed = `${comment.normalized}|${comment.topic}|${comment.subIntent}|${(context.videoTitle || '').trim()}`;
  const f = facts || {};
  const usedFacts: string[] = [];
  const done = (text: string, strategy: string, reason: string, extra: Partial<GeneratedReply> = {}): GeneratedReply => ({
    text, strategy, usedFacts, needsInfo: false, escalate: false, reason, ...extra,
  });

  // 0) سبام/حساس: لا رد آلي إطلاقاً (السياسة الحالية).
  if (comment.intent === 'spam' || comment.requiresHumanReview) {
    return {
      text: '', strategy: 'no_reply_sensitive', usedFacts: [],
      needsInfo: false, escalate: true,
      reason: comment.reviewReason || 'تعليق يستوجب مراجعة بشرية؛ لا يُولَّد له رد آلي.',
    };
  }

  // 1) إيموجي فقط ⇒ رد قصير جداً.
  if (comment.isEmojiOnly || comment.subIntent === 'emoji') {
    return done(pickVariant(['تسلم 🌹', 'شكراً لك ❤️', 'نورتنا 🌸', 'حياك الله 🙏'], seed, previous),
      'emoji_ack', 'تعليق بإيموجي فقط ⇒ رد مختصر جداً.');
  }

  // 2) مدح/تحية: يتفرّع حسب النية الثانوية لا قالباً واحداً.
  if (comment.intent === 'praise' || ['thanks', 'blessing', 'greeting', 'appreciation'].includes(comment.subIntent)) {
    switch (comment.subIntent) {
      case 'blessing':
        return done(pickVariant([
          'اللهم صل على محمد وآل محمد، وبارك الله بيك.',
          'جزاك الله خير، شكراً لدعائك الطيب.',
          'اللهم آمين، ولك بمثل 🌸',
          'بارك الله بيك، نورتنا بدعائك.',
        ], seed, previous), 'blessing_respect', 'دعاء/ذكر ⇒ رد محترم مناسب للسياق.');
      case 'greeting':
        return done(pickVariant([
          'هلا بيك، نورتنا 🌸',
          'أهلاً وسهلاً، حياك الله.',
          'هلا والله، بخدمتك.',
          'مرحبا بيك، نورت الصفحة 🌹',
        ], seed, previous), 'greeting_short', 'تحية ⇒ رد ترحيبي قصير.');
      case 'appreciation':
        return done(pickVariant([
          'تسلم، هذا من ذوقك 🌸',
          'ما شاء الله عليك، شكراً كلامك الحلو.',
          'شكراً لك، نورتنا.',
          'تسلمون، هذا يشجعنا نفوت أحسن 🌹',
          'شكراً، كلامك يسعدنا.',
        ], seed, previous), 'appreciation_warm', 'مدح وإعجاب ⇒ رد تقدير مختلف.');
      case 'thanks':
      default:
        return done(pickVariant([
          'العفو، هذا واجبنا 🌸',
          'تسلم، نورتنا.',
          'حياك الله، شكراً لك.',
          'العفو، بخدمتك دائماً.',
          'تسلمون، عاشت إيدكم 🌹',
        ], seed, previous), 'thanks_short', 'شكر ⇒ رد قصير وطبيعي.');
    }
  }

  // 3) شكوى ⇒ مراجعة بشرية/تواصل مباشر (لا رد تسويقي، لا تجاهل).
  if (comment.intent === 'complaint') {
    return {
      text: pickVariant([
        'نعتذر منك عن أي إزعاج، ونحب نعرف التفاصيل أكثر حتى نحلها وياك.',
        'آسفين على هالشي، راسلنا ونحلها وياك أول بأول.',
      ], seed, previous),
      strategy: 'complaint_escalate', usedFacts: [],
      needsInfo: true, escalate: true,
      reason: 'شكوى ⇒ تحويل لتواصل بشري مباشر بدل رد آلي تسويقي.',
    };
  }

  // 4) استفسار تجاري/سؤال: يعتمد موضوعه وحقائقه الموثوقة، ويمتنع عن الاختراع.
  if (comment.intent === 'business_inquiry' || comment.intent === 'question' || comment.isBusinessInquiry || comment.isQuestion) {
    switch (comment.topic) {
      case 'price':
        if (f.priceText) {
          usedFacts.push('price');
          return done(withProduct(f.productName, (p) => p
            ? `هلا بيك، سعر ${p}: ${f.priceText}. تريد نحسبلك القسط؟`
            : `هلا بيك، السعر: ${f.priceText}. تريد نحسبلك القسط؟`),
            'price_trusted', 'سعر مسجّل فعلاً ⇒ يُذكر السعر الحقيقي مع عرض حساب القسط.');
        }
        return {
          text: pickVariant([
            'هلا بيك، تدلل. خلي نوصلك السعر الأدق عبر الرسائل الخاصة، ونحسبلك القسط حسب رغبتك.',
            'هلا بيك، سعرنا يختلف حسب الموديل. راسلنا ونعطيك السعر الأدق مباشرة.',
            'هلا بيك، من عيوني. أرسل لنا رسالة ونوافيك بالسعر والقسط المناسب إلك.',
          ], seed, previous),
          strategy: 'price_needs_info', usedFacts: [],
          needsInfo: true, escalate: false,
          reason: 'سؤال سعر بلا سعر مسجّل ⇒ لا يُخترع السعر؛ إحالة للرسائل للمعلومة الدقيقة.',
        };
      case 'location':
        if (f.locationText) {
          usedFacts.push('location');
          return done(withProduct(f.productName, (p) => p
            ? `تدلل، ${p} تجده عندنا في ${f.locationText}. حياك الله 🌹`
            : `موقعنا: ${f.locationText}. تفضل زورنا 🌸`),
            'location_trusted', 'موقع مسجّل فعلاً ⇒ يُذكر الموقع الحقيقي.');
        }
        return {
          text: pickVariant([
            'تدلل، خلي نوصلك الموقع الدقيق عبر الرسائل الخاصة حتى ما نغلط.',
            'هلا بيك، راسلنا ونبعتلك الموقع على الخاص مباشرة.',
          ], seed, previous),
          strategy: 'location_needs_info', usedFacts: [],
          needsInfo: true, escalate: false,
          reason: 'سؤال موقع بلا موقع مسجّل ⇒ لا يُخترع الموقع؛ إحالة للرسائل.',
        };
      case 'hours':
        if (f.hoursText) {
          usedFacts.push('hours');
          return done(`دوامنا: ${f.hoursText}. حياك الله 🌸`,
            'hours_trusted', 'دوام مسجّل فعلاً ⇒ يُذكر الدوام الحقيقي.');
        }
        return {
          text: pickVariant([
            'خلي نأكدلك أوقات الدوام عبر الرسائل الخاصة، حتى نعطيك المعلومات الدقيقة.',
            'هلا بيك، راسلنا ونوضحلك أوقات الدوام بالضبط.',
          ], seed, previous),
          strategy: 'hours_needs_info', usedFacts: [],
          needsInfo: true, escalate: false,
          reason: 'سؤال دوام بلا دوام مسجّل ⇒ لا يُخترع؛ إحالة للرسائل.',
        };
      case 'availability':
        if (f.inStock === true) {
          usedFacts.push('stock');
          return done(withProduct(f.productName, (p) => p
            ? `${p} متوفر حالياً 🌸 تريد نحجزلك؟`
            : 'إي متوفر حالياً 🌸 تريد نحجزلك؟'),
            'availability_trusted', 'توفر مسجّل فعلاً ⇒ يُؤكَّد التوفر.');
        }
        if (f.inStock === false) {
          usedFacts.push('stock');
          return done('هذا الموديل خلص حالياً. راسلنا ونشوفلك البديل المتوفر.',
            'availability_out', 'المخزون ينفي التوفر ⇒ يُعلن ذلك بصراحة بلا اختراع.');
        }
        return {
          text: pickVariant([
            'خلي نتأكدلك من التوفر عبر الرسائل الخاصة، حتى نعطيك الجواب الأدق.',
            'تدلل، راسلنا ونأكدلك التوفر بالضبط قبل ما تتعب نفسك.',
          ], seed, previous),
          strategy: 'availability_needs_info', usedFacts: [],
          needsInfo: true, escalate: false,
          reason: 'سؤال توفر بلا بيانات مخزون ⇒ لا يُدّعى التوفر؛ إحالة للرسائل.',
        };
      default:
        return done(pickVariant([
          'هلا بيك، خبرنا شنو الموديل اللي يعجبك ونحسبلك القسط على راحتك.',
          'تدلل، نرتبلك كل شي بالتقسيط. راسلنا ونكمل ويّاك.',
          'تحت أمرك، خبرنا شنو تحتاج بالضبط ونوضحلك 🌸',
        ], seed, previous), 'inquiry_general', 'استفسار عام ⇒ رد عراقي يرحّب ويفتح التفاصيل.');
    }
  }

  // 5) ما تبقّى (غامض/محايد): رد قصير طبيعي بلا ادعاء ولا إعلان.
  return done(pickVariant([
    'شكراً لتواصلك، بخدمتك 🌸',
    'حياك الله، بخدمتك لأي استفسار 🌹',
    'شكراً، نورتنا.',
  ], seed, previous), 'neutral_generic', 'تعليق محايد/غامض ⇒ رد قصير عام بلا ادعاء.');
}

/**
 * صياغة رد حتمي عند تعذر استخدام مزود الذكاء الاصطناعي.
 * تفويض رقيق إلى محرّك Reply Intelligence ليبقى له مصدر واحد.
 */
export function buildDeterministicReply(
  comment: ClassifiedComment,
  productHint?: string,
  facts?: ReplyFactSet,
  context?: ReplyContext,
): string {
  const merged: ReplyFactSet = { ...(facts || {}) };
  if (productHint && String(productHint).trim() && !merged.productName) merged.productName = String(productHint).trim();
  return generateReply(comment, merged, context || {}).text;
}
