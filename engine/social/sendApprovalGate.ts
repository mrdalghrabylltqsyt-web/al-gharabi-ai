/**
 * بوابة موافقة الإرسال المركزية (Customer Send Approval Gate) — مصدر واحد،
 * منطق صافٍ قابل للاختبار (بلا شبكة وبلا أسرار).
 *
 * الغرض: **لا رسالة/رد لزبون يخرج تلقائياً** ما دام وضع الإرسال `approval`
 * (الافتراضي، fail-safe). البوابة تفصل صراحةً بين:
 *  - إرسال **آلي** (مراقب YouTube/Meta/Telegram، العقل التجاري، العقول الستة،
 *    المشغّلات الداخلية) ⇒ يُحجب في وضع الموافقة ويُسجَّل `needs_approval` مع النص
 *    المقترح، ولا يقع أي نداء مزوّد.
 *  - إرسال **صرُّح به إنسان** (المالك من مسار يدوي، أو موافقته على مسودة) ⇒ مسموح؛
 *    فعل المالك هو الموافقة نفسها.
 *
 * القاعدة الملزمة: البوابة تُفرض **قبل أي نداء مزوّد** في كل منفّذ مركزي، فلا
 * يكفي إخفاء زر في الواجهة. `autoReply`/`youtubeDelegation`/قرار العقل **لا
 * تتجاوزها**.
 */

import type { CommercialSendMode } from '../commercial/commercialDrafts';

export type SendApprovalCode = 'ALLOWED' | 'NEEDS_APPROVAL';

export interface SendApprovalDecision {
  allowed: boolean;
  code: SendApprovalCode;
  reason: string;
  /** هل الحجب بسبب وضع الموافقة (يُسجَّل كطلب موافقة لا كفشل)؟ */
  needsApproval: boolean;
}

/**
 * الفاعلون **الآليون** المعروفون (لا إنسان خلفهم لحظة الإرسال). أي فاعل غيرهم
 * يُعدّ فعل إنسان صريح (موافقة). القائمة صريحة لا استنتاج.
 */
export const AUTOMATIC_SEND_ACTORS: readonly string[] = Object.freeze([
  'watcher',
  'commercial-brain',
  'six-agent',
  'system',
  'auto',
  'cron',
  'scheduler',
  // الوكيل المركزي (مهام /api/agent/tasks): النص من توليد الوكيل لا من المالك،
  // حتى لو بدأ المالك المهمة أو منح تفويض YouTube. يُحجب في وضع الموافقة.
  'agent',
]);

/** فاعلون صرّح بهم إنسان (فعلهم موافقة): لا يُحجبون في وضع الموافقة. */
export const EXPLICIT_SEND_ACTORS: readonly string[] = Object.freeze([
  'owner',
  'commercial-owner-approval',
]);

/** هل الفاعل آلي (لا إنسان خلفه)؟ مطابقة غير حسّاسة لحالة الأحرف. */
export function isAutomaticSendActor(actor: unknown): boolean {
  const a = String(actor ?? '').trim().toLowerCase();
  if (!a) return true; // غياب الفاعل ⇒ آلي (الأمان أولاً، لا ندّعي فعل إنسان).
  return AUTOMATIC_SEND_ACTORS.includes(a);
}

/** هل الفاعل إنسان صرّح بالإرسال صراحةً (المالك/موافقته)؟ */
export function isExplicitSendActor(actor: unknown): boolean {
  const a = String(actor ?? '').trim().toLowerCase();
  return EXPLICIT_SEND_ACTORS.includes(a);
}

/**
 * قرار بوابة الموافقة قبل أي نداء مزوّد يرسل لزبون.
 * - وضع `approval` + فاعل آلي ⇒ حجب (`NEEDS_APPROVAL`) بلا أي إرسال.
 * - وضع `approval` + فاعل صريح ⇒ سماح (فعل المالك هو الموافقة).
 * - وضع `auto` ⇒ سماح (سلوك سابق موثّق؛ خارج نطاق هذه المهمة).
 */
export function evaluateCustomerSendGate(input: {
  sendMode: CommercialSendMode | string;
  actor: unknown;
  platform?: string;
  operation?: string;
}): SendApprovalDecision {
  // fail-safe: الوضع `auto` وحده يسمح؛ أي قيمة أخرى (بما فيها المجهولة/الفارغة)
  // تُعالج كـ`approval` فلا يخرج إرسال آلي بلا موافقة.
  const mode = String(input.sendMode ?? '').trim().toLowerCase();
  if (mode === 'auto') {
    return { allowed: true, code: 'ALLOWED', reason: 'وضع الإرسال التلقائي مفعّل — لا حجب من بوابة الموافقة.', needsApproval: false };
  }
  if (!isAutomaticSendActor(input.actor)) {
    return { allowed: true, code: 'ALLOWED', reason: 'إرسال صرّح به إنسان (المالك) — فعل الموافقة نفسه.', needsApproval: false };
  }
  return {
    allowed: false,
    code: 'NEEDS_APPROVAL',
    needsApproval: true,
    reason: `وضع الإرسال «موافقة» (الافتراضي): الإرسال الآلي محجوب قبل أي نداء مزوّد. لم يُرسل شيء، وسُجّل طلب موافقة مع النص المقترح${input.platform ? ` (${input.platform})` : ''}.`,
  };
}
