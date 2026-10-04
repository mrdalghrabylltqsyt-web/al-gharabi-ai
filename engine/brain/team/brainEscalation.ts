/**
 * Brain Escalation Hook — جسر قرار العقل المركزي إلى نظام التصعيد البشري القائم.
 *
 * **لا نظام تصعيد ثانٍ**: يستخدم `createEscalationRecord` من `social/escalation.ts`
 * ويُسجَّل في **نفس** مصفوفة `workspace.socialEscalations` عبر `record` المحقون من
 * الخادم. لا يدّعي إشعاراً لم يقع (المُبلِّغ يُحقن من الخادم عبر `pushNotification`).
 *
 * منطق خالص قابل للاختبار: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر `now`.
 */

import {
  createEscalationRecord,
  isEscalationOpen,
  type EscalationNotifier,
  type EscalationReason,
  type EscalationRecord,
} from '../../social/escalation';
import type { BrainDecision } from './brainDecision';

/** التصعيد يُسجَّل فقط للحالات التي تحتاج بشراً فعلاً. */
export function decisionNeedsEscalation(decision: BrainDecision): boolean {
  return decision.finalStatus === 'HUMAN_ESCALATION' && decision.escalation.required === true;
}

export interface BrainEscalationHook {
  /** السجلات الحالية (قراءة) لمنع التكرار. */
  list: () => EscalationRecord[];
  /** يضيف السجل إلى المخزن القائم ويؤكّد. */
  record: (record: EscalationRecord) => void;
  /** معرّف جديد (نفس مولّد الخادم). */
  newId: () => string;
}

export interface BrainEscalationOutcome {
  created: boolean;
  reason: EscalationReason | null;
  notificationDelivered: boolean;
  notificationError: string | null;
  /** سبب عدم الإنشاء عند التخطّي (بلا سرّ). */
  skipped: string | null;
}

/**
 * يسجّل تصعيداً بشرياً لقرار العقل إن استحقه، مع منع التكرار لنفس الحدث الخارجي.
 * لا يخترع إشعاراً؛ غياب/فشل المُبلِّغ يُعلَن صراحةً.
 */
export function escalateBrainDecision(
  decision: BrainDecision,
  input: { externalId: string | null; commentText: string; nowIso: string; notifier: EscalationNotifier | null },
  hook: BrainEscalationHook,
): BrainEscalationOutcome {
  if (!decisionNeedsEscalation(decision)) {
    return { created: false, reason: null, notificationDelivered: false, notificationError: null, skipped: 'not_required' };
  }
  const reason: EscalationReason = decision.escalation.reason || 'manual';
  const existing = hook.list();
  if (input.externalId && existing.some((r) => r.externalId === input.externalId && isEscalationOpen(r))) {
    return { created: false, reason, notificationDelivered: false, notificationError: null, skipped: 'duplicate_open_escalation' };
  }
  const record = createEscalationRecord({
    id: hook.newId(),
    platform: decision.platform,
    conversationId: null,
    subjectId: null,
    externalId: input.externalId,
    commentText: input.commentText.slice(0, 500),
    reason,
    nowIso: input.nowIso,
    notifier: input.notifier,
  });
  hook.record(record);
  return {
    created: true,
    reason,
    notificationDelivered: record.notificationDelivered,
    notificationError: record.notificationError,
    skipped: null,
  };
}
