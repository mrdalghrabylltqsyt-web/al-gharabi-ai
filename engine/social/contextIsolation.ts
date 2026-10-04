/**
 * عزل السياق (Context Isolation).
 *
 * الغرض: ضمان أن سياق محادثة واحدة **لا يتسرّب** إلى محادثة أخرى، وأن الرد لا يقرأ
 * ردوداً/تعليقات من خيط مختلف أو منصة مختلفة. هذا حرس صريح مستقل عن المحرّك، لأن
 * تسرّب السياق عطل صامت: الرد يبدو سليماً لكنه مبنيّ على محادثة أخرى.
 *
 * منطق صافٍ قابل للاختبار: لا شبكة ولا أسرار.
 */

import type { ConversationState } from './conversationState';
import { conversationKey, priorBusinessReplies } from './conversationState';

export interface ContextScope {
  conversationId: string | null;
  platform: string | null;
  subjectId: string | null;
}

export interface IsolationResult {
  /** هل السياق معزول بأمان (نفس المحادثة/المنصة/الخيط)؟ */
  isolated: boolean;
  /** سبب الرفض/التفريغ الصريح عند عدم العزل. */
  reason: 'match' | 'new_conversation' | 'conversation_mismatch' | 'platform_mismatch' | 'subject_mismatch' | 'no_conversation' | 'no_scope';
  /** نصوص ردودنا السابقة — **فارغة** إن لم يتحقق العزل. */
  priorReplies: string[];
}

/**
 * يقارن نطاقاً مطلوباً بمحادثة فعلية. أي اختلاف في المعرّف أو المنصة أو الخيط يعني
 * عدم عزل ⇒ نُفرغ السياق ولا نُعيد أي رد سابق. غياب محادثة سابقة مع نطاق صالح يعني
 * «محادثة جديدة» — لا سياق سابق يمكن أن يتسرّب، فهي معزولة بطبيعتها (فارغة).
 */
export function isolateContext(conversation: ConversationState | null, scope: ContextScope): IsolationResult {
  if (!scope.conversationId) return { isolated: false, reason: 'no_scope', priorReplies: [] };
  if (!conversation) return { isolated: true, reason: 'new_conversation', priorReplies: [] };
  if (conversation.conversationId !== scope.conversationId) {
    return { isolated: false, reason: 'conversation_mismatch', priorReplies: [] };
  }
  // المنصة الصريحة (إن مُرّرت) يجب أن تطابق محادثةً لها منصة معلومة.
  if (scope.platform && conversation.platform && scope.platform !== conversation.platform) {
    return { isolated: false, reason: 'platform_mismatch', priorReplies: [] };
  }
  // الخيط (المنشور) الصريح يجب أن يطابق خيط المحادثة.
  if (scope.subjectId && conversation.subjectId && scope.subjectId !== conversation.subjectId) {
    return { isolated: false, reason: 'subject_mismatch', priorReplies: [] };
  }
  return { isolated: true, reason: 'match', priorReplies: priorBusinessReplies(conversation) };
}

/**
 * يبحث عن محادثة مطابقة داخل قائمة، بمعرّف محادثة محسوب (منصة + خيط). لا يخلط
 * محادثتين مختلفتين ولو تشابهت أسماء الكتّاب.
 */
export function findConversation(
  conversations: ConversationState[],
  platform: string | null | undefined,
  subjectId: string | null | undefined,
): ConversationState | null {
  const key = conversationKey(platform, subjectId);
  return conversations.find((c) => c.conversationId === key) ?? null;
}

/**
 * هل نطاقان يشيران لنفس المحادثة؟ (بديل صريح لمقارنة النصوص المتفرّقة).
 */
export function sameScope(a: ContextScope, b: ContextScope): boolean {
  return (
    (a.conversationId ?? '') === (b.conversationId ?? '') &&
    (a.platform ?? '') === (b.platform ?? '') &&
    (a.subjectId ?? '') === (b.subjectId ?? '')
  );
}
