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
 *
 * المرحلة 4: أُضيفت موضوعات مستقلة صراحةً — `warranty` (الضمان)، `delivery`
 * (التوصيل)، `installment_terms` (شروط التقسيط/المستمسكات)، و`installment`
 * (مدة التقسيط) — فلا تُصنَّف خطأً كـprice أو availability (تسلسل الأسبقية يمنع
 * ذلك في `detectTopic`).
 */
export type CommentTopic =
  | 'location'
  | 'price'
  | 'availability'
  | 'hours'
  | 'warranty'
  | 'delivery'
  | 'installment_terms'
  | 'installment'
  | 'general';

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
  // الاستفسار التجاري يجب أن يلتقط الصيغ العراقية الشائعة كاملةً: «سعر» وحدها،
  // «بكام»، «شو سعر/شنو سعره»، «متاح/اكو/موجود». بدونها يسقط التصنيف إلى
  // neutral_generic (الجذر المُثبت) فيرد رداً عاماً على سؤال سعر/توفر حقيقي.
  // **لا تُدرج كلمات الموقع المجرّدة (عنوان/مكان/موقع/وين) هنا**: أسئلة الموقع ليست
  // «استفسار شراء»، وإدراجها يجعل `classifyConversation` يصنّف «وين موقع المعرض؟»
  // purchase_intent خطأً. تُغطّى أسئلة الموقع عبر `topic === 'location'` وحدها.
  business: /كم سعر|بكم|بكام|السعر|سعرها|سعره|سعر|شكد|شو سعر|شنو سعره|قسط|اقساط|أقساط|تقسيط|دفعة|مقدم|متوفر|متوفرة|متاح|اكو|موجود|مطلوب|اشتري|ابي|أريد|اريد|حجز|حاسبة|شروط|مستندات|راتب|ماستر/,
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
  // ملاحظة: أُزيل «توصيل» من الموقع — صار موضوعاً مستقلاً (delivery).
  // أُضيفت الصيغ المجرّدة («العنوان»، «المكان»، «مكان») و«وين موجودين/وين انتو»: العميل
  // يكتبها كثيراً بلا ضمير، وكانت تسقط إلى price/availability فيُسأل عن الماركة والمقاس
  // بدل أن يُعطى العنوان المسجّل (الجذر المُثبت لسوء جودة الرد).
  location: /موقع|موقعكم|مواقعكم|وين\s*(موقع|انتو|انتوا|توجد|موجود|موجودين|توجدون|فرع|صاير|تسكنون)|اين\s*(انتم|موقع|فرع|توجد|صاير|موجودين)|مكانكم|عنوانكم|فروعكم|فرعكم|عنوان|العنوان|المكان|مكان|الموقع|الفرع|فرع/,
  price: /سعر|اسعار|أسعار|السعر|بكم|بكام|كم\s*(يكلف|سعر|ثمن)|شكد|قسط|اقساط|أقساط|مقدم|دفعة|دفعه|حسبه|حسبة|ثمن|سعرها|سعره/,
  availability: /متوفر|متوفره|متوفرة|متاح|موجود|يوجد|اكو|عدكم|عندكم|مطلوب|جاهز|محجوز|خلص|نافد|تتوفر/,
  hours: /دوام|تفتحون|تفتح|تغلقون|وقت|اوقات|ساعات|مفتوح|مغلق|الدوام|ساعه/,
  // الضمان موضوع مستقل تماماً: لا يُصنَّف سعراً ولا توفّراً (تحويل للمالك دائماً).
  warranty: /ضمان|مضمون|كفاله|كفالة|guarantee|warranty/,
  // التوصيل موضوع مستقل: لا يُصنَّف موقعاً.
  delivery: /توصيل|توصلون|تنقلون|توصلوا|نقل|تودعون|تودعوا|delivery|توديع/,
  // شروط التقسيط/المستمسكات: موضوع مستقل عن السعر ومدة التقسيط.
  installment_terms: /شروط|شرط|مستمسكات|مستندات|ورق|اوراق|متطلبات|وثائق|راتب|كفيل|ضامن|ماستر|هويه|هوية|شروطكم|متطلباتكم/,
  // مدة التقسيط: موضوع مستقل عن السعر (سؤال عن عدد الأشهر لا عن المبلغ).
  installment: /مده\s*التقسيط|مدة\s*التقسيط|كم\s*شهر|شكد\s*شهر|عدد\s*(الاشهر|الشهور)|كم\s*(شهر|شهور)|مده\s*الاقساط|مدة\s*الأقساط/,
};

/**
 * أسبقية كشف الموضوع: الضمان والتوصيل وشروط/مدة التقسيط **قبل** السعر/التوفر/
 * الموقع، فلا يُصنَّف سؤال «شكد ضمان الثلاجة؟» سعراً ولا «توصلون؟» موقعاً.
 */
const TOPIC_PRIORITY: ReadonlyArray<Exclude<CommentTopic, 'general'>> = Object.freeze([
  'warranty', 'delivery', 'installment_terms', 'installment', 'location', 'hours', 'price', 'availability',
]);

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
  for (const topic of TOPIC_PRIORITY) {
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

/**
 * سؤال خارج نطاق المعرض (رياضة/سياسة/أخبار/ترفيه/طقس/دين عام...) — يُعتذر عنه
 * بلطف ويُعاد التوجيه، ولا يُخترع جواب. مطابقة على النص المطبَّع.
 */
const OFF_TOPIC_RE = /كوره|كره\s*قدم|مباراه|مباريات|الدوري|ريال\s*مدريد|برشلونه|ميسي|رونالدو|رياضه|سياسه|انتخابات|برلمان|وزير|حكومه|حرب|اخبار|فيلم|مسلسل|اغنيه|ممثل|طقس|الجو\s*اليوم|زلزال/;
/** هل النص خارج نطاق المعرض (يُعتذر عنه ويُعاد التوجيه)؟ مطابقة على النص المطبَّع. */
export function isOffTopic(text: string): boolean {
  const n = normalizeForMatch(String(text ?? ''));
  return n.length > 0 && OFF_TOPIC_RE.test(n);
}

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
  // موضوع تجاري محدّد (توصيل/موقع/سعر/توفر/دوام/تقسيط) بلا كلمة استفهام صريحة
  // («عندكم توصيل؟» — بعد التطبيع «عندكم توصيل») ⇒ استفسار حقيقي لا «محايد».
  // بدون ذلك يسقط إلى neutral_generic فيرد رداً عاماً («شكراً، نورتنا») على سؤال
  // جوهري (الجذر المُثبت لسوء جودة الرد).
  else if (topic !== 'general') intent = 'business_inquiry';

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
  /**
   * مفتاح منع التكرار (اختياري). يُستخدم لتمييز «متابعة مشروعة» على نفس التعليق
   * عن «إعادة إرسال» لنفس العملية. غيابه = السلوك السابق حرفياً (المفتاح = externalId).
   */
  idempotencyKey?: string;
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
 * بوابة الرد: تمنع الرد المكرر على نفس العملية، ومنع نفس النص مرات كثيرة،
 * وبذلك تمنع تكرار المعالجة بسبب webhook replay أو retry.
 *
 * الفصل المُصلَح: منع التكرار يُفتّح على `idempotencyKey` (ومفتاحه الافتراضي هو
 * `externalId` حين لا يُمرَّر). هكذا تبقى إعادة إرسال نفس الرد على نفس التعليق
 * محجوبة كما كانت، بينما متابعة العقل التجاري المشروعة (مفتاح مميّز `fu1`/`fu2`)
 * لا تُصنَّف «رداً مكرراً» فتُسلَّم فعلاً.
 */
export function evaluateReplyGuard(input: {
  externalId: string;
  replyText: string;
  history: ReplyRecord[];
  /** مفتاح منع التكرار؛ الافتراضي `externalId` (يحافظ على السلوك السابق حرفياً). */
  idempotencyKey?: string;
  /** أقصى عدد مرات مسموح بها لنفس نص الرد. */
  maxIdenticalReplies?: number;
}): ReplyGuardDecision {
  const fingerprint = fingerprintReply(input.replyText);
  const maxIdentical = input.maxIdenticalReplies ?? 2;
  const idemKey = (typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim()) ? input.idempotencyKey.trim() : input.externalId;

  if (!input.externalId) {
    return { allowed: false, reason: 'معرّف التعليق لدى المنصة مطلوب لمنع الرد المكرر.', fingerprint };
  }
  if (!fingerprint) {
    return { allowed: false, reason: 'نص الرد فارغ.', fingerprint };
  }

  // منع الرد مرتين على نفس العملية (يشمل إعادة إرسال نفس الحدث). السجل القديم بلا
  // مفتاح صريح يُعامل بمفتاحه الافتراضي (externalId) فيبقى منع التكرار سليماً.
  if (input.history.some((r) => (r.idempotencyKey || r.externalId) === idemKey)) {
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
  /**
   * القسط الشهري المشتقّ — يُذكر فقط عند توفر سعر مسجّل + قاعدة تقسيط معتمدة
   * (نسبة دفعة أولى + مدة بالأشهر من بيانات المنتج). القيمة محسوبة رياضياً من
   * بيانات حقيقية (لا مُختلقة)، وتغذّي `analyzeBusinessClaims` عبر derivedAmounts.
   */
  monthlyInstallmentText?: string;
  /** موقع/عنوان مسجّل فعلاً. */
  locationText?: string;
  /** دوام مسجّل فعلاً. */
  hoursText?: string;
  /** رقم الهاتف/الواتساب المسجّل فعلاً في بيانات المعرض (غيبته ⇒ لا يُذكر رقم). */
  phoneText?: string;
  /** رقم واتساب مسجّل فعلاً (يُذكر فقط إن سُجّل، وإلا لا يُخترع رقم). */
  whatsappText?: string;
  /** هل المنتج متوفر فعلاً؟ null = غير معروف. */
  inStock?: boolean | null;
  hasRecordedPromotion?: boolean;
  /**
   * المستمسكات/الوثائق المطلوبة للتقسيط كما سجّلها المعرض فعلاً (أسماء فقط).
   * إن كانت كثيرة تُلخَّص في `requiredDocumentsText`. لا تُخترع أي وثيقة غير مسجّلة.
   */
  requiredDocuments?: string[];
  /** لخّص جاهز للمستمسكات (يُستخدم عند تجاوز عددٍ صغير)، من بيانات مسجّلة فقط. */
  requiredDocumentsText?: string;
  /**
   * المرحلة 4: نص جواب **مسجّل حرفياً** من قاعدة معرفة المعرض (سياسة/سؤال شائع)
   * لموضوع السياسات (التوصيل/شروط التقسيط/مدة التقسيط/...). يُستخدم كما هو بلا أي
   * إعادة صياغة، فلا يتغيّر أي رقم مسجّل. غيابه ⇒ لا يُخترع جواب (سؤال/تصعيد).
   */
  knowledgeAnswer?: string;
  /** وسم موضوع الجواب المسجّل (للتشخيص: delivery/installment_terms/installment/...). */
  knowledgeTopic?: string;
  /**
   * المرحلة 4: مدة التقسيط المسجّلة نصاً (مثال «10 أشهر»). تُذكر فقط إن سُجّلت؛
   * غيابها ⇒ لا يُخترع عدد أشهر (سؤال توضيحي).
   */
  installmentMonthsText?: string;
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

/** يزيل علامات النهاية (. ! ؟ …) من نص مسجّل قبل إدراجه في جملة (منع «..» مكرّر). */
function trimEndPunct(input: string): string {
  return String(input || '').replace(/[\s.،,؛;!?؟…]+$/u, '').trim();
}

/** تطبيع مصغّر لكشف الموضوع داخل محرّك الردود (يُطابق على `comment.normalized`). */
function normForTopic(text: string): string {
  return String(text || '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
}

/**
 * كشف السؤال **المركّب**: نص واحد يذكر أكثر من موضوع («العنوان والسعر»، «السعر
 * والمكان»، «السعر والعنوان»). الجذر المُثبت: المحرّك كان يختار موضوعاً واحداً
 * بالأسبقية فيجيب عن العنوان ويُهمل السعر تماماً. هنا نكشف تعدّد الموضوعات
 * فنُجيب عنها في ردّ واحد بلا اختراع أي رقم.
 */
export function detectCompoundInquiry(text: string): { hasLocation: boolean; hasPrice: boolean } {
  const n = normForTopic(text);
  return {
    hasLocation: /موقع|مكان|عنوان|وين|اين|فرع|صاير/.test(n),
    hasPrice: /سعر|اسعار|بكم|بكام|شكد|قسط|اقساط|ثمن|مقدم|دفعه|حسبه/.test(n),
  };
}

/** هل النص سؤال مركّب (موقع + سعر) يُجاب عنه في ردّ واحد؟ */
export function isCompoundInquiry(text: string): boolean {
  const c = detectCompoundInquiry(text);
  return c.hasLocation && c.hasPrice;
}

/**
 * هل النص سؤال عن **توفّر التقسيط** نفسه («في تقسيط»، «عدكم تقسيط»، «اكو تقسيط»)؟
 * الجذر المُثبت: كان يُصنَّف عاماً فيُجاب بنص السياسة بلا جواب صريح. القاعدة الآن:
 * يبدأ الرد بـ«نعم» ثم المدة المسجّلة ثم دعوة للتفاصيل.
 */
export function asksInstallmentAvailability(text: string): boolean {
  const n = normForTopic(text);
  if (!n) return false;
  return /(في|عندكم|عدكم|اكو|يوجد|توجد|هل)\s*تقسيط|تقسيط\s*(اكو|يوجد|موجود|عندكم|عدكم)|^تقسيط$/.test(n);
}

/** أرقام التواصل المسجّلة بلا تكرار (فارغة إن لم تُسجَّل — لا يُخترع رقم). */
function contactNumbers(f: ReplyFactSet): string[] {
  return [...new Set([f.phoneText, f.whatsappText].map((x) => String(x || '').trim()).filter(Boolean))];
}

/**
 * يبني مقطع بيانات الزيارة من المسجّل فقط وبالترتيب المطلوب: العنوان، ثم أوقات
 * الدوام، ثم الهاتف/الواتساب. أي حقل غير مسجّل **لا يُذكر إطلاقاً** (لا اختراع).
 * يُعيد المقطع وكلمات الحقائق المستخدمة فعلاً.
 */
function visitDetailsClause(f: ReplyFactSet): { text: string; used: string[] } {
  const parts: string[] = [];
  const used: string[] = [];
  if (f.locationText) { parts.push(`موقعنا: ${trimEndPunct(f.locationText)}`); used.push('location'); }
  if (f.hoursText) { parts.push(`والدوام ${trimEndPunct(f.hoursText)}`); used.push('hours'); }
  const phones = contactNumbers(f);
  if (phones.length) { parts.push(`وللتواصل: ${phones.join(' أو ')}`); used.push('contact'); }
  return { text: parts.join('، '), used };
}

/** مقطع السعر: الرقم المسجّل (+القسط إن عُرف)، وإلا دعوة صريحة للتواصل (لا رقم مُختلق). */
function priceClause(f: ReplyFactSet): { text: string; used: string[] } {
  const used: string[] = [];
  if (f.priceText) {
    used.push('price');
    const label = f.productName ? `سعر ${f.productName}` : 'السعر';
    if (f.monthlyInstallmentText) { used.push('installment'); return { text: `${label}: ${f.priceText}، والقسط الشهري ${f.monthlyInstallmentText}`, used }; }
    return { text: `${label}: ${f.priceText}`, used };
  }
  return { text: 'أما السعر فيختلف حسب الموديل — راسلنا على الخاص أو الواتساب ونعطيك السعر والقسط الأدق', used };
}

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

/**
 * يختار بادئة ترحيبية عراقية متنوّعة لردود «الحقائق الموثّقة» (سعر/موقع/دوام/توفر).
 * هذه الردود تُبنى نصياً (لا عبر `pickVariant`)، فكانت كلها تبدأ ببادئة واحدة حرفياً —
 * فيبدو الرد ميكانيكياً متطابقاً لكل زبون. الاختيار هنا يوزّع البادئة على نفس المدخل
 * (ثبات/idempotency) ويستثني ما استُخدم سابقاً في نفس المحادثة (لا تكرار ميكانيكي).
 *
 * **كل البادئات محايدة جنسياً**: لا تفترض أن العميل رجل («هلا بيك»/«مرحبا بيك») —
 * فالتعليق قد يكون من امرأة، والصيغة المحايدة ترحّب بالجميع بلا خطأ لغوي.
 */
function trustedOpener(seed: string, previous: string[]): string {
  const openers = ['هلا وغلا', 'تدلل', 'أهلاً وسهلاً', 'حياك الله', 'نورتنا'];
  // `previous` يحمل نصوص الردود الكاملة، فنستثني البادئة إن كانت قد افتُتح بها ردّ سابق.
  const usedOpeners = openers.filter((o) => previous.some((p) => String(p || '').startsWith(o)));
  return pickVariant(openers, seed, usedOpeners);
}

/** يبني بادئة اسم المنتج بأمان لغوي عند توفره. */
function withProduct(name: string | undefined, sentence: (p: string) => string): string {
  const p = (name || '').trim();
  return p ? sentence(p) : sentence('');
}

/**
 * لخّص المستمسكات المطلوبة للتقسيط من بيانات المعرض المسجّلة فقط. يعيد جملة عربية
 * جاهزة تُلحَق برد السعر/القسط، أو '' عند عدم تسجيل أي مستمسك — فلا تُخترع وثيقة
 * غير مسجّلة. عند تجاوز ثلاثة بنود تُلخَّص في «بيانات أساسية + مستمسكات إضافية».
 */
function standardizedDocsClause(f: ReplyFactSet): string {
  const list = (Array.isArray(f.requiredDocuments) ? f.requiredDocuments : [])
    .map((d) => String(d || '').trim())
    .filter(Boolean);
  const summary = String(f.requiredDocumentsText || '').trim();
  if (!list.length && !summary) return '';
  const shown = list.length ? list : [summary];
  if (shown.length > 3) {
    return ` المستمسكات المطلوبة: بيانات أساسية و${shown.length} مستمسكات إضافية.`;
  }
  if (shown.length === 1) return ` المستمسكات المطلوبة: ${shown[0]}.`;
  return ` المستمسكات المطلوبة: ${shown.join('، ')}.`;
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
          'هلا وغلا، نورتنا 🌸',
          'أهلاً وسهلاً، حياك الله.',
          'هلا والله، بخدمتك.',
          'أهلاً وسهلاً، نورت الصفحة 🌹',
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

  // 3ب) سؤال خارج نطاق المعرض (رياضة/سياسة/أخبار/ترفيه...): اعتذار مهذّب وإعادة
  //     توجيه للاستفسار عن الأجهزة والتقسيط — لا ادّعاء معرفة ولا جواب مختلق.
  if ((comment.intent === 'question' || comment.isQuestion) && OFF_TOPIC_RE.test(comment.normalized)) {
    return done(pickVariant([
      'هلا وغلا 🌸 إحنا معرض أجهزة وتقسيط، وما عندنا تفاصيل عن هالموضوع. تدلل باي استفسار عن الأجهزة والأقساط 🌹',
      'تحت أمرك 🌸 بس احنا مختصين بالأجهزة والتقسيط؛ خبرني أي جهاز يهمك ونخدمك.',
    ], seed, previous), 'off_topic_polite', 'سؤال خارج نطاق المعرض ⇒ اعتذار مهذّب وإعادة توجيه بلا ادّعاء معرفة.');
  }

  // 4) استفسار تجاري/سؤال: يعتمد موضوعه وحقائقه الموثوقة، ويمتنع عن الاختراع.
  if (comment.intent === 'business_inquiry' || comment.intent === 'question' || comment.isBusinessInquiry || comment.isQuestion) {
    // 4أ) سؤال مركّب (موقع + سعر) ⇒ ردّ واحد يجيب الموضوعين. العنوان والدوام
    //     والهاتف من المسجّل، والسعر من المسجّل أو دعوة صريحة للتواصل (لا اختراع).
    if (isCompoundInquiry(comment.normalized)) {
      const visit = visitDetailsClause(f);
      const price = priceClause(f);
      for (const u of [...visit.used, ...price.used]) usedFacts.push(u);
      return done(`${trustedOpener(seed, previous)}، ${visit.text}، و${price.text} 🌸`,
        'compound_location_price', 'سؤال مركّب (عنوان + سعر) ⇒ ردّ واحد يجيب الموضوعين من بيانات المعرض المسجّلة بلا اختراع رقم.');
    }
    // 4ب) سؤال «في تقسيط؟» ⇒ يبدأ بـ«نعم» ثم المدة المسجّلة ثم دعوة للتفاصيل.
    if (asksInstallmentAvailability(comment.normalized)) {
      const months = String(f.installmentMonthsText || '').trim();
      if (months) usedFacts.push('installment_months');
      const base = `${trustedOpener(seed, previous)}، نعم عدنا تقسيط`;
      const mid = months ? `، والمدة الأساسية ${months}` : '';
      return done(`${base}${mid}. تدلل، راسلنا ونوضحلك الشروط والمستمسكات بالتفصيل 🌸`,
        'installment_availability_yes', 'سؤال توفّر التقسيط ⇒ يبدأ بـ«نعم» ثم المدة المسجّلة (إن سُجّلت) ثم دعوة للتفاصيل.');
    }
    switch (comment.topic) {
      case 'price':
        if (f.priceText) {
          usedFacts.push('price');
          // القسط الشهري يُذكر فقط إن كان مشتقاً من سعر مسجّل + قاعدة تقسيط معتمدة
          // (يمرّره الخادم في monthlyInstallmentText). غيابه ⇒ ذكر السعر وحده.
          if (f.monthlyInstallmentText) {
            usedFacts.push('installment');
            const docs = standardizedDocsClause(f);
            if (docs) usedFacts.push('documents');
            return done(withProduct(f.productName, (p) => p
              ? `${trustedOpener(seed, previous)}، سعر ${p}: ${f.priceText}، والقسط الشهري يبدأ من ${f.monthlyInstallmentText}.${docs} تريد نأكدلك التفاصيل؟`
              : `${trustedOpener(seed, previous)}، السعر: ${f.priceText}، والقسط الشهري يبدأ من ${f.monthlyInstallmentText}.${docs} تريد نأكدلك التفاصيل؟`),
              'price_trusted', 'سعر وخطط تقسيط مسجّلة فعلاً ⇒ يُذكر السعر والقسط المشتقّ من بيانات حقيقية.');
          }
          return done(withProduct(f.productName, (p) => p
            ? `${trustedOpener(seed, previous)}، سعر ${p}: ${f.priceText}. تريد نحسبلك القسط؟`
            : `${trustedOpener(seed, previous)}، السعر: ${f.priceText}. تريد نحسبلك القسط؟`),
            'price_trusted', 'سعر مسجّل فعلاً ⇒ يُذكر السعر الحقيقي مع عرض حساب القسط.');
        }
        return {
          text: pickVariant([
            'هلا وغلا، تدلل. خلي نوصلك السعر الأدق عبر الرسائل الخاصة، ونحسبلك القسط حسب رغبتك.',
            'هلا وغلا، سعرنا يختلف حسب الموديل. راسلنا ونعطيك السعر الأدق مباشرة.',
            'هلا وغلا، من عيوني. أرسل لنا رسالة ونوافيك بالسعر والقسط المناسب.',
          ], seed, previous),
          strategy: 'price_needs_info', usedFacts: [],
          needsInfo: true, escalate: false,
          reason: 'سؤال سعر بلا سعر مسجّل ⇒ لا يُخترع السعر؛ إحالة للرسائل للمعلومة الدقيقة.',
        };
      case 'location':
        if (f.locationText) {
          // طلب المالك: ذكر العنوان، ثم أوقات الدوام، ثم رقم الهاتف/الواتساب — كلها
          // من بيانات المعرض المسجّلة. الحقل الغائب لا يُذكر، ولا يُخترع.
          const visit = visitDetailsClause(f);
          for (const u of visit.used) usedFacts.push(u);
          return done(`${trustedOpener(seed, previous)}، ${visit.text} 🌸`,
            'location_trusted', 'موقع مسجّل فعلاً ⇒ يُذكر العنوان والدوام والهاتف من بيانات المعرض الحقيقية.');
        }
        return {
          text: pickVariant([
            'تدلل، خلي نوصلك الموقع الدقيق عبر الرسائل الخاصة حتى ما نغلط.',
            'هلا وغلا، راسلنا ونبعتلك الموقع على الخاص مباشرة.',
          ], seed, previous),
          strategy: 'location_needs_info', usedFacts: [],
          needsInfo: true, escalate: false,
          reason: 'سؤال موقع بلا موقع مسجّل ⇒ لا يُخترع الموقع؛ إحالة للرسائل.',
        };
      case 'hours':
        if (f.hoursText) {
          usedFacts.push('hours');
          return done(`${trustedOpener(seed, previous)}، دوامنا: ${trimEndPunct(f.hoursText)}. حياك الله 🌸`,
            'hours_trusted', 'دوام مسجّل فعلاً ⇒ يُذكر الدوام الحقيقي.');
        }
        return {
          text: pickVariant([
            'خلي نأكدلك أوقات الدوام عبر الرسائل الخاصة، حتى نعطيك المعلومات الدقيقة.',
            'هلا وغلا، راسلنا ونوضحلك أوقات الدوام بالضبط.',
          ], seed, previous),
          strategy: 'hours_needs_info', usedFacts: [],
          needsInfo: true, escalate: false,
          reason: 'سؤال دوام بلا دوام مسجّل ⇒ لا يُخترع؛ إحالة للرسائل.',
        };
      case 'availability':
        if (f.inStock === true) {
          usedFacts.push('stock');
          return done(withProduct(f.productName, (p) => p
            ? `${trustedOpener(seed, previous)}، ${p} متوفر حالياً 🌸 تريد نحجزلك؟`
            : `${trustedOpener(seed, previous)}، إي متوفر حالياً 🌸 تريد نحجزلك؟`),
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
      // المرحلة 4: الضمان لا يُجاب من القاعدة في هذا الإصدار — تحويل للمالك دائماً
      // بلا ذكر أي مدة ضمان إطلاقاً (لا رقم ولا مدة، حتى لو طلبها العميل صراحةً).
      // ملاحظة: نص المسودة يتجنّب لفظ «ضمان» عمداً، لأن حارس سلامة المحتوى يمنع أي
      // ذكر لضمان غير مسجّل — فنبقى صادقين ونمنع ادعاءً غير موثّق، والتصعيد يحمل
      // الموضوع للمالك عبر `replyIntelligence`.
      case 'warranty':
        return {
          text: 'هلا وغلا، خلّينا نتأكدلك من هالتفصيل ونجاوبك عليه من المعرض 🌸',
          strategy: 'warranty_escalate', usedFacts: [],
          needsInfo: true, escalate: true,
          reason: 'سؤال الضمان يُحوَّل للمالك دائماً في هذا الإصدار؛ لا تُذكر أي مدة ضمان غير مسجّلة.',
        };
      // التوصيل/شروط التقسيط/مدة التقسيط: تُجاب من النص المسجّل حرفياً (knowledgeAnswer)
      // أو من مدة التقسيط المسجّلة؛ وإلا لا يُخترع جواب (إحالة/سؤال).
      case 'delivery':
      case 'installment_terms':
      case 'installment': {
        const recorded = String(f.knowledgeAnswer || '').trim();
        if (recorded) {
          usedFacts.push('knowledge');
          return done(recorded, 'knowledge_recorded', 'جواب مسجّل حرفياً من قاعدة معرفة المعرض ⇒ يُستخدم بلا إعادة صياغة.');
        }
        if (comment.topic === 'installment' && f.installmentMonthsText) {
          usedFacts.push('installment_months');
          return done(`مدة التقسيط: ${f.installmentMonthsText}. حياك الله 🌸`,
            'installment_months_recorded', 'مدة تقسيط مسجّلة فعلاً ⇒ تُذكر القيمة الحقيقية.');
        }
        return {
          text: pickVariant([
            'هلا وغلا، خلّينا نتأكدلك من هاي التفاصيل ونجاوبك عليها بالضبط 🌸',
            'تدلل، راسلنا ونوضحلك هاي التفاصيل من المعرض مباشرة.',
          ], seed, previous),
          strategy: `${comment.topic}_needs_info`, usedFacts: [],
          needsInfo: true, escalate: false,
          reason: 'سؤال سياسة/تقسيط بلا نص مسجّل ⇒ لا يُخترع جواب؛ إحالة للرسائل.',
        };
      }
      default:
        return done(pickVariant([
          'هلا وغلا، خبرنا شنو الموديل اللي يعجبك ونحسبلك القسط على راحتك.',
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
