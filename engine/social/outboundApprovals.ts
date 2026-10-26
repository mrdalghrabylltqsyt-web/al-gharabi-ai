/**
 * طابور «ردود جاهزة بانتظار نقرتك» — منطق خالص قابل للاختبار (بلا شبكة ولا أسرار).
 *
 * حين يكون وضع الإرسال «موافقة» (الافتراضي) يُجهّز العقل الرد على كل تعليق/رسالة
 * على كل منصة متصلة، ثم يحجبه بوابة الموافقة المركزية **قبل أي نداء مزوّد** ويسجّله
 * هنا. المالك يرسله بنقرة واحدة (أو يعدّله أو يرفضه)، أو يرسل كل جاهز منصة دفعة واحدة.
 *
 * القواعد:
 *  - لا إرسال من هنا: التنفيذ يقع في المنفّذ المركزي للمنصة نفسه (كل حماياته سارية:
 *    منع التكرار، سلامة المحتوى، الاتصال الموثّق، حدّ المعدّل).
 *  - الطلب المحسوم (أُرسل/رُفض) لا يُعاد إنشاؤه للهدف نفسه — فلا يعود الرد المرفوض
 *    ولا يُطلب رد ثانٍ لزبون أُجيب.
 *  - لا يُعلن «أُرسل» بلا معرّف رد حقيقي من المزوّد.
 */

export type OutboundApprovalStatus = 'pending' | 'sent' | 'rejected' | 'failed';

export interface OutboundApprovalRequest {
  id: string;
  platform: string;
  operation: string;
  externalId: string | null;
  recipientId: string | null;
  text: string;
  productId: string | null;
  actor: string;
  at: string;
  status: OutboundApprovalStatus;
  /** وقت الحسم وصاحبه (للتدقيق). */
  decidedAt?: string | null;
  decidedBy?: string | null;
  /** النص الذي أُرسل فعلاً (قد يعدّله المالك). */
  sentText?: string | null;
  providerReplyId?: string | null;
  error?: string | null;
}

export const OUTBOUND_APPROVAL_STATUSES: readonly OutboundApprovalStatus[] = Object.freeze(['pending', 'sent', 'rejected', 'failed']);

export const OUTBOUND_STATUS_LABELS_AR: Readonly<Record<OutboundApprovalStatus, string>> = Object.freeze({
  pending: 'جاهز بانتظار نقرتك',
  sent: 'أُرسل',
  rejected: 'رُفض',
  failed: 'تعذّر الإرسال',
});

/** المنفّذ المركزي المناسب لكل (منصة، عملية). */
export type ApprovalExecutor = 'youtube_comment' | 'meta_comment' | 'meta_message' | 'threads_comment' | 'telegram_message' | 'whatsapp_message';

export function approvalExecutorFor(platform: string, operation: string): ApprovalExecutor | null {
  const p = String(platform || '').toLowerCase();
  const op = String(operation || '').toLowerCase();
  if (p === 'youtube' && op === 'comment_reply') return 'youtube_comment';
  if ((p === 'facebook' || p === 'instagram') && op === 'comment_reply') return 'meta_comment';
  if ((p === 'facebook' || p === 'instagram') && op === 'message_reply') return 'meta_message';
  if (p === 'threads' && op === 'comment_reply') return 'threads_comment';
  if (p === 'telegram' && op === 'message_reply') return 'telegram_message';
  if (p === 'whatsapp' && op === 'message_reply') return 'whatsapp_message';
  return null;
}

export function normalizeOutboundApproval(raw: any): OutboundApprovalRequest | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || typeof raw.platform !== 'string') return null;
  const status: OutboundApprovalStatus = (OUTBOUND_APPROVAL_STATUSES as readonly string[]).includes(raw.status) ? raw.status : 'pending';
  return {
    id: raw.id,
    platform: String(raw.platform),
    operation: String(raw.operation || ''),
    externalId: raw.externalId ? String(raw.externalId) : null,
    recipientId: raw.recipientId ? String(raw.recipientId) : null,
    text: String(raw.text || '').slice(0, 4000),
    productId: raw.productId ? String(raw.productId) : null,
    actor: String(raw.actor || ''),
    at: String(raw.at || new Date(0).toISOString()),
    status,
    decidedAt: raw.decidedAt ? String(raw.decidedAt) : null,
    decidedBy: raw.decidedBy ? String(raw.decidedBy) : null,
    sentText: raw.sentText ? String(raw.sentText).slice(0, 4000) : null,
    providerReplyId: raw.providerReplyId ? String(raw.providerReplyId) : null,
    error: raw.error ? String(raw.error).slice(0, 300) : null,
  };
}

export function normalizeOutboundApprovals(raw: unknown, max: number): OutboundApprovalRequest[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeOutboundApproval).filter((x): x is OutboundApprovalRequest => x !== null).slice(0, max);
}

function sameTarget(r: OutboundApprovalRequest, t: { platform: string; operation: string; externalId: string | null; recipientId: string | null }): boolean {
  return r.platform === t.platform && r.operation === t.operation && r.externalId === t.externalId && r.recipientId === t.recipientId;
}

/** طلب معلّق للهدف نفسه (يُحدَّث نصه بدل إنشاء طلب ثانٍ). */
export function findPendingForTarget(list: readonly OutboundApprovalRequest[], t: { platform: string; operation: string; externalId: string | null; recipientId: string | null }): OutboundApprovalRequest | null {
  return list.find((r) => r.status === 'pending' && sameTarget(r, t)) || null;
}

/**
 * طلب محسوم للهدف نفسه: أُرسل أو رُفض. وجوده يمنع إنشاء طلب جديد — فلا يعود رد
 * رفضه المالك، ولا يُجهَّز رد ثانٍ لزبون حصل على جواب. (الفاشل لا يمنع: يُعاد تجهيزه.)
 */
export function findDecidedForTarget(list: readonly OutboundApprovalRequest[], t: { platform: string; operation: string; externalId: string | null; recipientId: string | null }): OutboundApprovalRequest | null {
  return list.find((r) => (r.status === 'sent' || r.status === 'rejected') && sameTarget(r, t)) || null;
}

/** تطبيق نتيجة قرار المالك على الطلب (نسخة جديدة، بلا تعديل في المكان). */
export function applyApprovalOutcome(
  req: OutboundApprovalRequest,
  outcome: { kind: 'sent'; text: string; providerReplyId: string; by: string; at: string }
    | { kind: 'rejected'; by: string; at: string }
    | { kind: 'failed'; error: string; by: string; at: string },
): OutboundApprovalRequest {
  if (outcome.kind === 'sent') {
    return { ...req, status: 'sent', sentText: outcome.text, providerReplyId: outcome.providerReplyId, error: null, decidedAt: outcome.at, decidedBy: outcome.by };
  }
  if (outcome.kind === 'rejected') {
    return { ...req, status: 'rejected', decidedAt: outcome.at, decidedBy: outcome.by };
  }
  return { ...req, status: 'failed', error: String(outcome.error || '').slice(0, 300), decidedAt: outcome.at, decidedBy: outcome.by };
}

/** ملخّص لكل منصة: كم رداً جاهزاً، وأقدم انتظار، وكم أُرسل اليوم. */
export function summarizeApprovalsByPlatform(list: readonly OutboundApprovalRequest[], nowMs: number): Record<string, { pending: number; oldestPendingAt: string | null; sent24h: number; rejected24h: number; failed24h: number }> {
  const out: Record<string, { pending: number; oldestPendingAt: string | null; sent24h: number; rejected24h: number; failed24h: number }> = {};
  for (const r of list) {
    const row = out[r.platform] || (out[r.platform] = { pending: 0, oldestPendingAt: null, sent24h: 0, rejected24h: 0, failed24h: 0 });
    if (r.status === 'pending') {
      row.pending += 1;
      if (!row.oldestPendingAt || Date.parse(r.at) < Date.parse(row.oldestPendingAt)) row.oldestPendingAt = r.at;
      continue;
    }
    const t = Date.parse(String(r.decidedAt || r.at));
    if (!Number.isFinite(t) || nowMs - t > 86_400_000) continue;
    if (r.status === 'sent') row.sent24h += 1;
    else if (r.status === 'rejected') row.rejected24h += 1;
    else if (r.status === 'failed') row.failed24h += 1;
  }
  return out;
}

/**
 * وضع «التجهيز للموافقة»: في وضع الإرسال «موافقة» يُجهّز المراقب الرد حتى لو كان
 * مفتاح الرد الآلي للمنصة مطفأً — لأن البوابة المركزية تحجب كل إرسال آلي وتحوّله
 * إلى طلب موافقة، فلا يخرج شيء بلا نقرة المالك. خارج وضع الموافقة (تلقائي) يبقى
 * مفتاح المنصة هو الحَكَم: مطفأ ⇒ لا تجهيز ولا إرسال.
 * المراقبة المعطّلة أو الإيقاف الطارئ يوقفان التجهيز دائماً.
 */
export function preparesRepliesForApproval(input: { sendMode: string; enabled: boolean; paused: boolean }): boolean {
  const approval = String(input.sendMode || '').trim().toLowerCase() !== 'auto';
  return approval && input.enabled === true && input.paused !== true;
}
