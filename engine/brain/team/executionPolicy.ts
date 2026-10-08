/**
 * Execution Policy — قائمة تنفيذ مسموحة صريحة (whitelist) للعقول الستة.
 *
 * هذا هو الفرق الوحيد والمقصود في الصلاحيات: العقول الستة كانت استشارية فقط،
 * والآن يُسمح لها بأربعة أفعال **حتمية** فقط، بلا أي استدعاء Gemini:
 *   1) classify_tag_comment        — تثبيت/تصنيف «عادي/إيجابي» بقواعد حتمية.
 *   2) update_engagement_counters  — تسجيل/تحديث عدّادات (لا قرار).
 *   3) retry_failed_publish_once   — إعادة محاولة واحدة فقط لمنصة واحدة.
 *   4) reply_from_stored_pattern   — رد فقط بمطابقة نمط محفوظ بثقة عالية.
 *
 * أي شيء خارج هذه القائمة، أو غير مطابق لقاعدة حتمية أو نمط محفوظ بثقة كافية،
 * أو شكوى/سلبي/حساس/غامض ⇒ **تصعيد للعقل المركزي وحده** (وهو الوحيد المخوَّل
 * باستدعاء Gemini ضمن حصته المحمية القائمة GEMINI_DAILY_LIMIT — بلا تغيير).
 *
 * منطق خالص قابل للاختبار: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن now.
 */

import { classifyComment, canAutoReply, type ClassifiedComment } from '../../social/comments';

/** الفعل الوحيد المسموح للعقول الستة — لا صلاحية مفتوحة أبداً. */
export type SixAgentAction =
  | 'classify_tag_comment'
  | 'update_engagement_counters'
  | 'retry_failed_publish_once'
  | 'reply_from_stored_pattern';

export const SIX_AGENT_ALLOWED_ACTIONS: readonly SixAgentAction[] = Object.freeze([
  'classify_tag_comment',
  'update_engagement_counters',
  'retry_failed_publish_once',
  'reply_from_stored_pattern',
]);

export const SIX_AGENT_ACTION_LABELS_AR: Readonly<Record<SixAgentAction, string>> = Object.freeze({
  classify_tag_comment: 'تصنيف/تثبيت تعليق عادي أو إيجابي (قاعدة حتمية)',
  update_engagement_counters: 'تسجيل/تحديث عدّادات المشاهدات والتفاعل',
  retry_failed_publish_once: 'إعادة محاولة نشر فاشل على منصة واحدة مرّة واحدة',
  reply_from_stored_pattern: 'الرد بنمط محفوظ بثقة عالية من قرار سابق للعقل المركزي',
});

/** هل الفعل داخل القائمة المسموحة الصريحة؟ (أي فعل آخر مرفوض حتماً). */
export function isAllowedSixAgentAction(action: string): action is SixAgentAction {
  return (SIX_AGENT_ALLOWED_ACTIONS as readonly string[]).includes(action);
}

export type SixAgentPolicyDecisionCode =
  | 'ALLOW_DETERMINISTIC'   // يُنفَّذ محلياً بقاعدة حتمية، بلا Gemini
  | 'ESCALATE_CENTRAL'      // غامض/حساس/غير مطابق ⇒ العقل المركزي وحده
  | 'REJECT_OUT_OF_WHITELIST'; // فعل غير مسموح إطلاقاً

export interface SixAgentPolicyDecision {
  action: string;
  code: SixAgentPolicyDecisionCode;
  allowed: boolean;
  /** القاعدة الحتمية التي طابقت (بلا Gemini) عند السماح. */
  matchedRule: string | null;
  /** مرجع النمط المحفوظ عند السماح بفعل الرد. */
  matchedPatternId: string | null;
  /** سبب التصعيد/الرفض (بلا سرّ). */
  reasonAr: string;
  requiresCentralBrain: boolean;
  requiresGemini: boolean;
}

/**
 * أدنى ثقة تُقبل لمطابقة نمط محفوظ قبل التنفيذ المحلي. النمط المحفوظ يأتي من قرار
 * سابق للعقل المركزي؛ ولا يُنفَّذ محلياً بثقة أدنى.
 */
export const SIX_AGENT_PATTERN_MIN_CONFIDENCE = 0.85;

/** نمط رد محفوظ (من قرار سابق للعقل المركزي) — بلا أي سرّ. */
export interface StoredReplyPattern {
  patternId: string;
  /** مفردات/أنماط مطابقة (تطابق تام بعد التطبيع). */
  triggers: string[];
  replyText: string;
  /** ثقة النمط [0..1] من القرار السابق. */
  confidence: number;
  /** هل النمط ما زال نشطاً (غير متقادم/ملغى)؟ */
  active: boolean;
  platform: string | null;
}

/** تطبيع عربي مبسّط للمطابقة التامة (بلا اشتقاق دلالي). */
export function normalizeForMatch(input: string): string {
  return String(input || '')
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '') // تشكيل وتطويل
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * يطابق نص تعليق مع نمط محفوظ: تطابق تام بعد التطبيع، والنمط نشط وثقته ≥ الحد.
 * لا مطابقة تقريبية ولا اختراع رد.
 */
export function matchStoredReplyPattern(
  commentText: string,
  patterns: StoredReplyPattern[],
  platform: string | null,
): StoredReplyPattern | null {
  const norm = normalizeForMatch(commentText);
  if (!norm) return null;
  for (const p of patterns) {
    if (!p.active) continue;
    if (p.platform && platform && p.platform !== platform) continue;
    if (p.confidence < SIX_AGENT_PATTERN_MIN_CONFIDENCE) continue;
    if (p.triggers.some((t) => normalizeForMatch(t) === norm)) return p;
  }
  return null;
}

export interface SixAgentActionInput {
  action: string;
  /** نص التعليق (لتصنيف/الرد) — يُمرَّر للتصنيف الحتمي القائم. */
  commentText?: string;
  /** أنماط الردود المحفوظة (من ذاكرة القرارات) لمطابقة الرد. */
  storedPatterns?: StoredReplyPattern[];
  platform?: string | null;
  /** عدد محاولات إعادة النشر السابقة على هذه المنصة (لمنع أكثر من مرّة). */
  priorRetryCount?: number;
  /** هل النشر الفاشل على منصة واحدة (لا أكثر)؟ */
  singlePlatformFailure?: boolean;
}

/**
 * يقرّر مصير فعل طلبته إحدى العقول الستة: تنفيذ حتمي محلي، أو تصعيد للعقل
 * المركزي، أو رفض خارج الـwhitelist. **لا استدعاء Gemini عند التنفيذ المحلي.**
 */
export function evaluateSixAgentAction(input: SixAgentActionInput): SixAgentPolicyDecision {
  const base = {
    action: input.action,
    matchedRule: null as string | null,
    matchedPatternId: null as string | null,
  };
  if (!isAllowedSixAgentAction(input.action)) {
    return {
      ...base,
      code: 'REJECT_OUT_OF_WHITELIST',
      allowed: false,
      reasonAr: 'الفعل خارج القائمة المسموحة الصريحة للعقول الستة.',
      requiresCentralBrain: false,
      requiresGemini: false,
    };
  }

  if (input.action === 'classify_tag_comment') {
    const text = String(input.commentText || '');
    if (!text.trim()) {
      return { ...base, code: 'ESCALATE_CENTRAL', allowed: false, reasonAr: 'نص فارغ: لا تصنيف حتمي ممكن.', requiresCentralBrain: true, requiresGemini: false };
    }
    const c: ClassifiedComment = classifyComment(text);
    // التصنيف الحتمي يسمح بتثبيت «عادي/إيجابي» فقط؛ أي نية سلبية/حساسة/سؤال غامض يُصعَّد.
    if (c.intent === 'praise' || c.sentiment === 'positive' || c.intent === 'other') {
      return { ...base, matchedRule: `classify:${c.intent}/${c.sentiment}`, code: 'ALLOW_DETERMINISTIC', allowed: true, reasonAr: 'تصنيف حتمي عادي/إيجابي (بلا Gemini).', requiresCentralBrain: false, requiresGemini: false };
    }
    return { ...base, code: 'ESCALATE_CENTRAL', allowed: false, reasonAr: 'تصنيف غير عادي/إيجابي (سؤال/سلبي/حساس) ⇒ العقل المركزي.', requiresCentralBrain: true, requiresGemini: false };
  }

  if (input.action === 'update_engagement_counters') {
    return { ...base, matchedRule: 'counters:write', code: 'ALLOW_DETERMINISTIC', allowed: true, reasonAr: 'تسجيل عدّادات (لا قرار) — مسموح حتمياً.', requiresCentralBrain: false, requiresGemini: false };
  }

  if (input.action === 'retry_failed_publish_once') {
    const prior = Number(input.priorRetryCount || 0);
    if (prior >= 1) {
      return { ...base, code: 'ESCALATE_CENTRAL', allowed: false, reasonAr: 'سبقت إعادة محاولة واحدة ⇒ العقل المركزي.', requiresCentralBrain: true, requiresGemini: false };
    }
    if (input.singlePlatformFailure !== true) {
      return { ...base, code: 'ESCALATE_CENTRAL', allowed: false, reasonAr: 'الفشل ليس على منصة واحدة ⇒ العقل المركزي.', requiresCentralBrain: true, requiresGemini: false };
    }
    return { ...base, matchedRule: 'retry:once', code: 'ALLOW_DETERMINISTIC', allowed: true, reasonAr: 'إعادة محاولة واحدة لمنصة واحدة — مسموحة حتمياً.', requiresCentralBrain: false, requiresGemini: false };
  }

  // reply_from_stored_pattern
  const pattern = matchStoredReplyPattern(String(input.commentText || ''), input.storedPatterns || [], input.platform ?? null);
  if (pattern) {
    return { ...base, matchedPatternId: pattern.patternId, matchedRule: 'pattern:stored', code: 'ALLOW_DETERMINISTIC', allowed: true, reasonAr: 'تطابق تام مع نمط رد محفوظ بثقة عالية — تنفيذ محلي.', requiresCentralBrain: false, requiresGemini: false };
  }
  return { ...base, code: 'ESCALATE_CENTRAL', allowed: false, reasonAr: 'لا نمط محفوظ مطابق بثقة كافية ⇒ العقل المركزي.', requiresCentralBrain: true, requiresGemini: false };
}

/** حارس صريح: العقول الستة لا تستدعي Gemini أبداً (يُختبر مصدرياً وسلوكياً). */
export const SIX_AGENT_NEVER_CALLS_GEMINI = true;

/** هل يسمح التصنيف الحتمي بالرد الآلي؟ (يعيد استخدام القاعدة القائمة بلا تغيير). */
export function deterministicCanReply(commentText: string): boolean {
  return canAutoReply(classifyComment(commentText));
}
