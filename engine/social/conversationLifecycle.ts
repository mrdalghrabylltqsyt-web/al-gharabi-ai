/**
 * دورة حياة المحادثة (Conversation Lifecycle) — آلة حالات حتمية.
 *
 * الغرض: منع الانتقالات غير الصالحة، ومنع إغلاق محادثة (RESOLVED) ما دام فيها
 * تصعيد بشري معلّق. حالة المحادثة **قصيرة المدى** ولا تُرقّى تلقائياً إلى ذاكرة
 * طويلة المدى (انظر `memorySeparation.ts`).
 *
 * منطق صافٍ قابل للاختبار: لا شبكة ولا أسرار ولا ساعة حقيقية.
 */

export type ConversationLifecycleState = 'OPEN' | 'AWAITING_BUSINESS' | 'ESCALATED' | 'RESOLVED';

export type ConversationEvent =
  | 'customer_message'   // وصلت رسالة/تعليق من العميل
  | 'business_reply'     // رددنا على العميل
  | 'escalation_recorded'// سُجّل تصعيد بشري
  | 'escalation_resolved'// حُلّ التصعيد البشري
  | 'resolve_requested'  // طُلب إغلاق المحادثة
  | 'reopen';            // إعادة فتح محادثة مغلقة

export const CONVERSATION_LIFECYCLE_STATES: readonly ConversationLifecycleState[] = Object.freeze([
  'OPEN', 'AWAITING_BUSINESS', 'ESCALATED', 'RESOLVED',
]);

export const CONVERSATION_LIFECYCLE_LABELS_AR: Readonly<Record<ConversationLifecycleState, string>> = Object.freeze({
  OPEN: 'مفتوحة',
  AWAITING_BUSINESS: 'بانتظار رد المعرض',
  ESCALATED: 'مُصعّدة لمراجعة بشرية',
  RESOLVED: 'مُغلقة',
});

/** الحالات النهائية: لا تُنقض إلا بإعادة فتح صريحة. */
export function isTerminalLifecycle(state: ConversationLifecycleState): boolean {
  return state === 'RESOLVED';
}

/**
 * الانتقالات المسموحة صراحةً. أي زوج غير مذكور هنا = انتقال غير صالح يُرفض.
 * RESOLVED لا تُبلَغ إلا من OPEN/AWAITING_BUSINESS/ESCALATED، وتبقى قابلة لإعادة
 * الفتح. ESCALATED لا تُبلَغ إلا من حالة نشطة.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<ConversationLifecycleState, readonly ConversationLifecycleState[]>> = {
  OPEN: ['AWAITING_BUSINESS', 'ESCALATED', 'RESOLVED'],
  AWAITING_BUSINESS: ['OPEN', 'ESCALATED', 'RESOLVED'],
  ESCALATED: ['OPEN', 'RESOLVED'],
  RESOLVED: ['OPEN'],
};

export function canTransition(from: ConversationLifecycleState, to: ConversationLifecycleState): boolean {
  if (from === to) return false; // لا انتقال بلا تغيير
  return ALLOWED_TRANSITIONS[from]?.includes(to) === true;
}

export interface TransitionResult {
  ok: boolean;
  from: ConversationLifecycleState;
  to: ConversationLifecycleState;
  reasonAr: string;
}

export interface TransitionInput {
  current: ConversationLifecycleState;
  event: ConversationEvent;
  /** هل يوجد تصعيد بشري معلّق في هذه المحادثة؟ يمنع RESOLVED. */
  pendingEscalation: boolean;
}

/**
 * يحسب الحالة التالية من الحدث. **قاعدة صلبة**: لا RESOLVED ما دام تصعيد بشري
 * معلّقاً. الحدث `escalation_resolved` يُزيل التصعيد قبل السماح بالإغلاق.
 */
export function nextConversationState(input: TransitionInput): TransitionResult {
  const { current, event } = input;
  // يُعالَج الحدث أولاً ليعطي الحالة المستهدفة.
  let target: ConversationLifecycleState | null = null;
  switch (event) {
    case 'customer_message':
      // رسالة عميل جديدة تُعيد المحادثة النشطة؛ لا تُغيّر مُصعّدة (تبقى مُصعّدة).
      target = current === 'ESCALATED' ? 'ESCALATED' : current === 'RESOLVED' ? 'OPEN' : 'AWAITING_BUSINESS';
      break;
    case 'business_reply':
      target = current === 'ESCALATED' ? 'ESCALATED' : 'OPEN';
      break;
    case 'escalation_recorded':
      target = 'ESCALATED';
      break;
    case 'escalation_resolved':
      target = current === 'ESCALATED' ? 'OPEN' : current;
      break;
    case 'resolve_requested':
      target = 'RESOLVED';
      break;
    case 'reopen':
      target = 'OPEN';
      break;
    default:
      target = null;
  }
  if (target === null) {
    return { ok: false, from: current, to: current, reasonAr: 'حدث غير معروف.' };
  }
  // الحدث الذي لا يُغيّر الحالة (customer_message على مُصعّدة) يُقبل كـno-op صريح.
  if (target === current) {
    return { ok: true, from: current, to: current, reasonAr: 'لا تغيير في الحالة (سلوك صحيح للحالة الراهنة).' };
  }
  // قاعدة الحماية: لا إغلاق مع تصعيد معلّق.
  if (target === 'RESOLVED' && input.pendingEscalation) {
    return {
      ok: false, from: current, to: current,
      reasonAr: 'لا يمكن إغلاق المحادثة (RESOLVED) ما دام هناك تصعيد بشري معلّق.',
    };
  }
  if (!canTransition(current, target)) {
    return { ok: false, from: current, to: current, reasonAr: `انتقال غير صالح: ${current} → ${target}.` };
  }
  return { ok: true, from: current, to: target, reasonAr: 'انتقال صالح.' };
}
