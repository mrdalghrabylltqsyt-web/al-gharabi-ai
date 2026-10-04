/**
 * فصل الذاكرة (Memory Separation): سياق الجلسة ≠ الذاكرة طويلة المدى.
 *
 * الغرض: منع ترقية بيانات المحادثة القصيرة العمر تلقائياً إلى ذاكرة دائمة.
 * لا يُرقّى شيء إلى الذاكرة طويلة المدى إلا بشرط صريح: حدث تجاري حقيقي (بيع
 * موثّق/عميل مؤهّل) أو قاعدة معلومة موثّقة — لا مجرّد رسالة في نافذة محادثة.
 *
 * منطق صافٍ قابل للاختبار: لا شبكة ولا أسرار. لا يكتب شيئاً — يُصنّف فقط.
 */

import type { ConversationMessage } from './conversationState';

export type MemoryTier = 'session_context' | 'long_term_memory';

export const MEMORY_TIER_LABELS_AR: Readonly<Record<MemoryTier, string>> = Object.freeze({
  session_context: 'سياق جلسة (قصير المدى)',
  long_term_memory: 'ذاكرة طويلة المدى',
});

/** أنواع الأحداث التي تستحق الترقية إلى ذاكرة طويلة المدى (صريحة فقط). */
export type LongTermMemoryKind =
  | 'verified_sale'
  | 'qualified_lead'
  | 'verified_product_fact'
  | 'verified_installment_rule';

export const LONG_TERM_MEMORY_KINDS: readonly LongTermMemoryKind[] = Object.freeze([
  'verified_sale', 'qualified_lead', 'verified_product_fact', 'verified_installment_rule',
]);

export interface MemoryCandidate {
  tier: MemoryTier;
  kind: LongTermMemoryKind | 'conversation_message';
  /** سبب القرار (عربي) — يفسّر لماذا بقي في الجلسة أو رُقّي. */
  reasonAr: string;
  /** هل يحمل دليلاً موثّقاً (معرّف بيع/دليل تأهيل)؟ */
  hasEvidence: boolean;
}

/**
 * رسالة محادثة عادية: **تبقى في سياق الجلسة دائماً** — لا تُرقّى تلقائياً.
 * هذا هو القرار الافتراضي الصارم.
 */
export function classifyConversationMessage(_message: ConversationMessage): MemoryCandidate {
  return {
    tier: 'session_context',
    kind: 'conversation_message',
    reasonAr: 'رسالة محادثة: تبقى في سياق الجلسة قصير المدى ولا تُرقّى تلقائياً.',
    hasEvidence: false,
  };
}

/**
 * حدث يستحق الترقية إلى الذاكرة طويلة المدى **فقط** بدليل موثّق صريح.
 * بلا دليل ⇒ يبقى في سياق الجلسة (لا ترقية).
 */
export function classifyLongTermCandidate(input: {
  kind: LongTermMemoryKind;
  hasEvidence: boolean;
}): MemoryCandidate {
  if (!input.hasEvidence) {
    return {
      tier: 'session_context',
      kind: input.kind,
      reasonAr: 'لا دليل موثّق (معرّف بيع/دليل تأهيل/مصدر معلومة) ⇒ لا ترقية إلى ذاكرة طويلة المدى.',
      hasEvidence: false,
    };
  }
  return {
    tier: 'long_term_memory',
    kind: input.kind,
    reasonAr: 'حدث تجاري موثّق بدليل صريح ⇒ يُرقّى إلى الذاكرة طويلة المدى.',
    hasEvidence: true,
  };
}

/**
 * بوابة صريحة للترقية: لا ترقية بلا دليل موثّق ونوع مسموح. أي محاولة ترقية
 * لسياق جلسة عادي تُرفض.
 */
export function canPromoteToLongTerm(candidate: MemoryCandidate): { allowed: boolean; reasonAr: string } {
  if (candidate.tier !== 'long_term_memory') {
    return { allowed: false, reasonAr: 'سياق الجلسة لا يُرقّى تلقائياً إلى ذاكرة طويلة المدى.' };
  }
  if (!candidate.hasEvidence) {
    return { allowed: false, reasonAr: 'لا ترقية بلا دليل موثّق.' };
  }
  if (!LONG_TERM_MEMORY_KINDS.includes(candidate.kind as LongTermMemoryKind)) {
    return { allowed: false, reasonAr: 'نوع الحدث غير مسموح بالترقية.' };
  }
  return { allowed: true, reasonAr: 'ترقية مسموحة بدليل موثّق.' };
}
