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
}

const PATTERNS = {
  complaint: /شكوى|شاكي|زعلان|تأخير|تاخير|سيء|سيئ|مشكلة|مشكله|غاضب|احتيال|نصب|وعد|كذب|مو زين|تعبت/,
  praise: /شكرا|شكراً|ممتاز|رائع|جميل|بارك الله|احسن|أحسن|تسلم|الله يوفق|خدمة طيبة|تعامل راقي/,
  business: /كم سعر|بكم|السعر|قسط|اقساط|أقساط|دفعة|مقدم|تقسيط|متوفر|متوفرة|مطلوب|اشتري|ابي|أريد|اريد|حجز|حاسبة|شروط|مستندات|راتب|ماستر/,
  question: /هل |كيف|وين|متى|ليش|شلون|أين|اين|ماذا|شنو|بكم/,
  spam: /https?:\/\/|www\.|ربح|استثمار|عملة|بيتكوين|كازينو|قرض سريع|متابعة مقابل|فولو/,
  contactLeak: /\b07\d{8}\b|\b\d{10,}\b/,
};

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
    };
  }

  const isSpam = PATTERNS.spam.test(raw);
  if (isSpam) signals.push('spam');

  const hasComplaint = PATTERNS.complaint.test(raw);
  const hasPraise = PATTERNS.praise.test(raw);
  const hasBusiness = PATTERNS.business.test(raw);
  const hasQuestion = PATTERNS.question.test(raw);
  const hasContact = PATTERNS.contactLeak.test(raw);
  /** علامة استفهام صريحة ترفع أولوية السؤال على المجاملة. */
  const explicitQuestion = /[?؟]/.test(raw);

  if (hasComplaint) signals.push('complaint');
  if (hasPraise) signals.push('praise');
  if (hasBusiness) signals.push('business');
  if (hasQuestion) signals.push('question');
  if (hasContact) signals.push('contact_info');

  // الترتيب مقصود: الشكوى، ثم المدح الصريح (لأن عبارات المجاملة مثل "شكراً لكم"
  // تتضمن كلمة "كم" ولا يجوز اعتبارها سؤالاً)، ثم الاستفسار التجاري، ثم السؤال.
  let intent: CommentIntent = 'other';
  if (isSpam) intent = 'spam';
  else if (hasComplaint) intent = 'complaint';
  else if (hasPraise && !explicitQuestion) intent = 'praise';
  else if (hasBusiness) intent = 'business_inquiry';
  else if (hasQuestion || explicitQuestion) intent = 'question';
  else if (hasPraise) intent = 'praise';

  let sentiment: CommentSentiment = 'neutral';
  if (hasComplaint) sentiment = 'negative';
  else if (hasPraise) sentiment = 'positive';

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
    isPraise: hasPraise,
    isBusinessInquiry: hasBusiness,
    isSpam,
    requiresHumanReview,
    reviewReason,
    signals,
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

/** صياغة رد حتمي عند تعذر استخدام مزود الذكاء الاصطناعي. */
export function buildDeterministicReply(comment: ClassifiedComment, productHint?: string): string {
  const product = productHint?.trim();
  switch (comment.intent) {
    case 'business_inquiry':
      return product
        ? `أهلاً بك، نشكر تواصلك معنا بخصوص ${product}. يسعد فريق المعرض بتزويدك بالتفاصيل وخطة التقسيط المناسبة.`
        : 'أهلاً بك، نشكر تواصلك معنا. يسعد فريق المعرض بتزويدك بتفاصيل التقسيط وخطة السداد المناسبة لك.';
    case 'question':
      return 'أهلاً بك، شكراً لسؤالك. فريق المعرض جاهز لتزويدك بالإجابة التفصيلية عبر الرسائل الخاصة.';
    case 'praise':
      return 'شكراً لك على كلماتك الطيبة، سعادتنا بخدمتك. نبقى في خدمتك دائماً.';
    case 'complaint':
      return 'نعتذر عن أي إزعاج، وسيتواصل معك فريق خدمة العملاء لمتابعة الموضوع بشكل مباشر.';
    default:
      return 'أهلاً بك، شكراً لتواصلك معنا. فريق المعرض في خدمتك لأي استفسار.';
  }
}
