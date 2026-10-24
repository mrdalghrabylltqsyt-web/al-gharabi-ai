/**
 * B7 — حدود حالة المحادثات (مصدر واحد).
 *
 * `socialConversations` (نوافذ المحادثة قصيرة المدى) و`socialConversationStates`
 * (دورة حياة المحادثة) تُخزَّن **داخل كائن الحالة الكامل** المُنقل إلى Postgres/
 * الملف. بلا حدّ صريح تنمو الحالة بلا سقف فتصبح كل كتابة حالة أثقل (نقل Neon +
 * زمن الإقلاع). هذا الملف يجعل الحدّ **مصدراً واحداً** يُطبَّق في كل موضع كتابة،
 * بدل رقم مكرّر في كل مكان.
 *
 * **حدّ صريح:** 500 عنصر لكل مصفوفة (الأحدث أولاً — الأقدم يُسقَط).
 * منطق صافٍ: بلا شبكة، بلا أسرار، بلا ساعة.
 */

/** أقصى عدد محادثات/حالات دورة حياة محفوظة في كائن الحالة. */
export const CONVERSATION_STATE_MAX = 500;

/**
 * يطبّق الحدّ على مصفوفة "الأحدث أولاً" (unshift = الأحدث في المقدمة). يُسقط
 * الأقدم (نهاية المصفوفة) فلا تنمو الحالة بلا سقف. لا يُعدّل المدخل الأصلي.
 */
export function capNewestFirst<T>(list: readonly T[], max: number = CONVERSATION_STATE_MAX): T[] {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : CONVERSATION_STATE_MAX;
  return list.length > limit ? list.slice(0, limit) : list.slice();
}

/** كتلة عرض عامة (بلا سرّ) لصحة الحدّ — تُغذّي /api/readiness عند الحاجة. */
export function conversationLimitsPublicBlock(conversations: number, states: number) {
  return {
    max: CONVERSATION_STATE_MAX,
    conversations: Math.max(0, conversations),
    conversationStates: Math.max(0, states),
    conversationsCapped: conversations >= CONVERSATION_STATE_MAX,
    conversationStatesCapped: states >= CONVERSATION_STATE_MAX,
    note: 'حدّ صريح 500 لكل مصفوفة داخل كائن الحالة؛ الأقدم يُسقَط. خطة النقل إلى جدول مستقل بانتظار موافقة المالك (بلا تنفيذ).',
  };
}
