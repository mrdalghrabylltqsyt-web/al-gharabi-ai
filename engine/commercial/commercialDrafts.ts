/**
 * PR-S2 — صندوق الزبائن: وضع إرسال العقل التجاري + مسودات بانتظار موافقة المالك.
 *
 * الفجوة المُعالجة: كان العقل التجاري يرسل متابعاته للزبائن **تلقائياً** بلا أي
 * موافقة، ولا صفحة تعرض الزبائن أو الرسائل المعلّقة. هذا الملف هو **المنطق الصافي
 * الوحيد** (بلا شبكة وبلا سرّ وبلا ساعة) الذي يحكم:
 *  - وضع الإرسال: `approval` (الافتراضي) = لا يُرسل شيء بلا موافقة المالك،
 *    و`auto` = إرسال تلقائي كما كان. الوضع **مستقل تماماً** عن مفتاح الإيقاف الطارئ.
 *  - دورة حياة المسودة: pending → approved | rejected | expired، مع منع الإرسال
 *    خارج نافذة مراسلة Meta (24 ساعة) للمسودات المرسلة كرسائل خاصة.
 *  - سجل قرار المالك (النص الأصلي + المعدّل) — يُحفظ للتعلم لاحقاً، بلا تبنّي تعلّم الآن.
 *
 * القاعدة الملزمة: لا يُرسل أي مسودة إلا بعد موافقة صريحة في وضع approval، وعبر
 * المنفّذ المركزي نفسه (سلامة المحتوى + منع التكرار الدائم) — لا مسار جانبي.
 */

import { COMMERCIAL_META_MESSAGE_WINDOW_HOURS, type CommercialLead } from './commercialBrain';

// ─────────────────────────────────────────────────────────────────────────────
// وضع الإرسال (approval | auto) — مستقل عن مفتاح الإيقاف الطارئ.
// ─────────────────────────────────────────────────────────────────────────────

export type CommercialSendMode = 'approval' | 'auto';

export const COMMERCIAL_SEND_MODES: readonly CommercialSendMode[] = Object.freeze(['approval', 'auto']);

/**
 * الافتراضي **approval** (لا إرسال بلا موافقة). أي قيمة غير معروفة أو غائبة
 * تسقط إلى approval — لا سقوط صامت إلى إرسال تلقائي.
 */
export const COMMERCIAL_SEND_MODE_DEFAULT: CommercialSendMode = 'approval';

export const COMMERCIAL_SEND_MODE_LABELS_AR: Readonly<Record<CommercialSendMode, string>> = Object.freeze({
  approval: 'موافقة المالك (لا إرسال بلا موافقة)',
  auto: 'إرسال تلقائي',
});

/** يطبّع قيمة مخزّنة/مُرسلة إلى وضع إرسال صالح (fail-safe إلى approval). */
export function normalizeCommercialSendMode(raw: unknown): CommercialSendMode {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'auto' ? 'auto' : COMMERCIAL_SEND_MODE_DEFAULT;
}

/** هل يتطلّب هذا الوضع حفظ الرسالة كمسودة بانتظار موافقة المالك؟ */
export function requiresApproval(mode: CommercialSendMode): boolean {
  return normalizeCommercialSendMode(mode) === 'approval';
}

// ─────────────────────────────────────────────────────────────────────────────
// دورة حياة المسودة.
// ─────────────────────────────────────────────────────────────────────────────

/** غرض المسودة: متابعة، أو عرض صفقة، أو رد. */
export type CommercialDraftPurpose = 'follow_up' | 'proposal' | 'reply';

export const COMMERCIAL_DRAFT_PURPOSE_LABELS_AR: Readonly<Record<CommercialDraftPurpose, string>> = Object.freeze({
  follow_up: 'متابعة',
  proposal: 'عرض صفقة',
  reply: 'رد',
});

export type CommercialDraftStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export const COMMERCIAL_DRAFT_STATUS_LABELS_AR: Readonly<Record<CommercialDraftStatus, string>> = Object.freeze({
  pending: 'بانتظار الموافقة',
  approved: 'تمت الموافقة',
  rejected: 'مرفوضة',
  expired: 'منتهية (خارج نافذة Meta)',
});

export interface CommercialDraft {
  id: string;
  leadId: string;
  leadKey: string;
  platform: string;
  /** قناة الإرسال: رسالة خاصة (تخضع لنافذة Meta) أو تعليق عام (لا يخضع لها). */
  kind: 'comment' | 'message';
  purpose: CommercialDraftPurpose;
  /** النص الأصلي المقترح من العقل (لا يُعدَّل في مكانه — يبقى للتعلم). */
  text: string;
  /** هدف الرد الحقيقي على نفس الخيط. */
  externalId: string;
  recipientId: string | null;
  productId: string | null;
  /** معرّف اقتراح الصفقة إن كان الغرض proposal. */
  proposalId: string | null;
  /** مفتاح منع التكرار المميّز (يميّز المتابعة عن الرد الأصلي). */
  idempotencyKey: string | null;
  createdAt: string;
  /**
   * انتهاء نافذة مراسلة Meta (ISO) للمسودات المرسلة كرسائل خاصة، وإلا null.
   * المسودة التي تجاوزتها قبل الموافقة تُعلَّم expired ولا تُرسل.
   */
  windowExpiresAt: string | null;
  status: CommercialDraftStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  /** النص الفعلي المعتمد (المعدّل إن وُجد، وإلا الأصلي) — null قبل القرار. */
  approvedText: string | null;
  deliveryStatus: 'sent' | 'failed' | null;
  deliveryError: string | null;
  providerReplyId: string | null;
}

/** يحسب لحظة انتهاء نافذة مراسلة Meta من آخر تفاعل للعميل (ISO) أو null. */
export function metaWindowExpiresAt(lastCustomerInteractionAt: string | null | undefined): string | null {
  if (!lastCustomerInteractionAt) return null;
  const t = Date.parse(String(lastCustomerInteractionAt));
  if (!Number.isFinite(t)) return null;
  return new Date(t + COMMERCIAL_META_MESSAGE_WINDOW_HOURS * 3600_000).toISOString();
}

/** هل انتهت صلاحية المسودة (تجاوزت نافذة Meta) في اللحظة المعطاة؟ */
export function isDraftExpired(draft: CommercialDraft, nowIso: string): boolean {
  if (draft.status !== 'pending') return false;
  if (draft.kind !== 'message') return false; // التعليقات العامة لا تخضع لنافذة 24 ساعة.
  if (!draft.windowExpiresAt) return false;
  const exp = Date.parse(draft.windowExpiresAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(exp) || !Number.isFinite(now)) return false;
  return now >= exp;
}

/**
 * نتيجة تقييم قابلية إرسال المسودة (حتمي). `sendable=false` مع `reason` صريح:
 *  - ليست approved بعد (لا إرسال بلا موافقة).
 *  - approved لكن خارج نافذة Meta ⇒ يجب تعليمها expired.
 *  - أُرسلت مسبقاً (deliveryStatus='sent') ⇒ لا إرسال ثانٍ.
 */
export interface DraftSendability {
  sendable: boolean;
  reason: string;
  shouldExpire: boolean;
}

export function evaluateDraftSendability(draft: CommercialDraft, nowIso: string): DraftSendability {
  if (draft.status === 'expired') return { sendable: false, reason: 'المسودة منتهية (خارج نافذة Meta).', shouldExpire: false };
  if (draft.status === 'rejected') return { sendable: false, reason: 'المسودة مرفوضة من المالك.', shouldExpire: false };
  if (draft.status !== 'approved') return { sendable: false, reason: 'المسودة لم تُعتمد بعد (لا إرسال بلا موافقة).', shouldExpire: false };
  if (draft.deliveryStatus === 'sent') return { sendable: false, reason: 'المسودة أُرسلت مسبقاً (لا إرسال مكرر).', shouldExpire: false };
  if (draft.kind === 'message' && draft.windowExpiresAt) {
    const exp = Date.parse(draft.windowExpiresAt);
    const now = Date.parse(nowIso);
    if (Number.isFinite(exp) && Number.isFinite(now) && now >= exp) {
      return { sendable: false, reason: 'انتهت نافذة مراسلة Meta (24 ساعة) قبل الموافقة.', shouldExpire: true };
    }
  }
  return { sendable: true, reason: 'جاهزة للإرسال بعد موافقة المالك.', shouldExpire: false };
}

/** أنواع قرار المالك على المسودة. */
export type CommercialDecisionKind = 'approve' | 'edit_approve' | 'reject';

export const COMMERCIAL_DECISION_LABELS_AR: Readonly<Record<CommercialDecisionKind, string>> = Object.freeze({
  approve: 'موافقة',
  edit_approve: 'تعديل ثم موافقة',
  reject: 'رفض',
});

/** يحوّل قرار المالك إلى الحالة الناتجة للمسودة (حتمي). */
export function decisionToStatus(kind: CommercialDecisionKind): CommercialDraftStatus {
  return kind === 'reject' ? 'rejected' : 'approved';
}

/** النص النهائي المعتمد من قرار المالك: المعدّل إن وُجد وإلا الأصلي. */
export function approvedTextFor(draft: CommercialDraft, kind: CommercialDecisionKind, editedText: string | null | undefined): string | null {
  if (kind === 'reject') return null;
  const edited = typeof editedText === 'string' ? editedText.trim() : '';
  return edited || draft.text;
}

/**
 * يطبّق قرار المالك على مسودة **نسخةً جديدة** (بلا تعديل في المكان) — لا يُغيّر
 * مسودة محسومة سابقاً (منع نقض القرار)، ويرفض تعديل مسودة منتهية/مرفوضة.
 */
export function applyOwnerDecision(
  draft: CommercialDraft,
  input: { kind: CommercialDecisionKind; editedText?: string | null; by: string; at: string },
): { ok: boolean; draft: CommercialDraft; reason: string } {
  if (draft.status !== 'pending') {
    return { ok: false, draft, reason: `المسودة محسومة مسبقاً (${COMMERCIAL_DRAFT_STATUS_LABELS_AR[draft.status]}).` };
  }
  const status = decisionToStatus(input.kind);
  const approvedText = approvedTextFor(draft, input.kind, input.editedText);
  if (input.kind !== 'reject' && !approvedText) {
    return { ok: false, draft, reason: 'نص المسودة المعتمد فارغ.' };
  }
  return {
    ok: true,
    draft: {
      ...draft,
      status,
      decidedBy: String(input.by || ''),
      decidedAt: input.at,
      approvedText,
    },
    reason: input.kind === 'reject' ? 'رُفضت المسودة (لا إرسال).' : 'اعتمد المالك المسودة.',
  };
}

/** يُعلّم مسودة pending منتهيةً (خارج نافذة Meta) — لا تُرسل حتى لو وُوفق عليها لاحقاً. */
export function markDraftExpired(draft: CommercialDraft, at: string): CommercialDraft {
  if (draft.status !== 'pending') return draft;
  return { ...draft, status: 'expired', decidedAt: at };
}

/** يُسجّل نتيجة الإرسال الفعلية على المسودة (بلا ادّعاء تسليم بلا معرّف مزوّد). */
export function markDraftDelivery(
  draft: CommercialDraft,
  input: { sent: boolean; providerReplyId?: string | null; error?: string | null },
): CommercialDraft {
  return {
    ...draft,
    deliveryStatus: input.sent ? 'sent' : 'failed',
    providerReplyId: input.sent ? (input.providerReplyId || null) : null,
    deliveryError: input.sent ? null : (input.error || 'فشل الإرسال.'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// سجل قرار المالك (للتعلم لاحقاً) — النص الأصلي والمعدّل.
// ─────────────────────────────────────────────────────────────────────────────

export interface CommercialOwnerDecision {
  id: string;
  draftId: string;
  leadId: string;
  leadKey: string;
  purpose: CommercialDraftPurpose;
  kind: CommercialDecisionKind;
  /** النص الأصلي المقترح من العقل (يبقى كما هو). */
  originalText: string;
  /** النص بعد تعديل المالك (null إن لم يُعدّل). */
  editedText: string | null;
  decidedBy: string;
  decidedAt: string;
  delivered: boolean;
  providerReplyId: string | null;
}

/** يبني سجل قرار من مسودة محسومة (حتمي، بلا اختراع). */
export function buildOwnerDecisionRecord(
  draft: CommercialDraft,
  input: { id: string; kind: CommercialDecisionKind; editedText?: string | null; by: string; at: string; delivered: boolean; providerReplyId?: string | null },
): CommercialOwnerDecision {
  const edited = typeof input.editedText === 'string' ? input.editedText.trim() : '';
  return {
    id: input.id,
    draftId: draft.id,
    leadId: draft.leadId,
    leadKey: draft.leadKey,
    purpose: draft.purpose,
    kind: input.kind,
    originalText: draft.text,
    editedText: edited || null,
    decidedBy: String(input.by || ''),
    decidedAt: input.at,
    delivered: input.delivered === true,
    providerReplyId: input.delivered ? (input.providerReplyId || null) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// صفوف العرض + التطبيع الدفاعي عند الاسترجاع.
// ─────────────────────────────────────────────────────────────────────────────

export interface CommercialDraftRow {
  id: string;
  leadId: string;
  platform: string;
  kind: 'comment' | 'message';
  purpose: CommercialDraftPurpose;
  purposeLabelAr: string;
  text: string;
  createdAt: string;
  windowExpiresAt: string | null;
  status: CommercialDraftStatus;
  statusLabelAr: string;
  approvedText: string | null;
  deliveryStatus: 'sent' | 'failed' | null;
  providerReplyId: string | null;
  deliveryError: string | null;
}

export function toCommercialDraftRow(draft: CommercialDraft): CommercialDraftRow {
  return {
    id: draft.id,
    leadId: draft.leadId,
    platform: draft.platform,
    kind: draft.kind,
    purpose: draft.purpose,
    purposeLabelAr: COMMERCIAL_DRAFT_PURPOSE_LABELS_AR[draft.purpose],
    text: draft.text,
    createdAt: draft.createdAt,
    windowExpiresAt: draft.windowExpiresAt,
    status: draft.status,
    statusLabelAr: COMMERCIAL_DRAFT_STATUS_LABELS_AR[draft.status],
    approvedText: draft.approvedText,
    deliveryStatus: draft.deliveryStatus,
    providerReplyId: draft.providerReplyId,
    deliveryError: draft.deliveryError,
  };
}

/** عدد المسودات المعلّقة (بانتظار موافقة المالك) — بلا عدّ المنتهية/المحسومة. */
export function pendingDraftCount(drafts: readonly CommercialDraft[]): number {
  return drafts.filter((d) => d.status === 'pending').length;
}

/** المسودات المعلّقة فقط (لعرض الصندوق). */
export function selectPendingDrafts(drafts: readonly CommercialDraft[]): CommercialDraft[] {
  return drafts.filter((d) => d.status === 'pending');
}

const DRAFT_STATUSES = new Set<CommercialDraftStatus>(['pending', 'approved', 'rejected', 'expired']);
const DRAFT_PURPOSES = new Set<CommercialDraftPurpose>(['follow_up', 'proposal', 'reply']);

/** يطبّع مسودة محفوظة (توافق خلفي مع أي شكل قديم)؛ يرفض غير الصالح بلا اختلاق. */
export function normalizeCommercialDraft(raw: any): CommercialDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const text = String(raw.text || '');
  if (!id || !text) return null;
  const status: CommercialDraftStatus = DRAFT_STATUSES.has(raw.status) ? raw.status : 'pending';
  const purpose: CommercialDraftPurpose = DRAFT_PURPOSES.has(raw.purpose) ? raw.purpose : 'reply';
  const at = String(raw.createdAt || new Date().toISOString());
  return {
    id,
    leadId: String(raw.leadId || ''),
    leadKey: String(raw.leadKey || ''),
    platform: String(raw.platform || '').toLowerCase(),
    kind: raw.kind === 'message' ? 'message' : 'comment',
    purpose,
    text,
    externalId: String(raw.externalId || ''),
    recipientId: raw.recipientId ? String(raw.recipientId) : null,
    productId: raw.productId ? String(raw.productId) : null,
    proposalId: raw.proposalId ? String(raw.proposalId) : null,
    idempotencyKey: raw.idempotencyKey ? String(raw.idempotencyKey) : null,
    createdAt: at,
    windowExpiresAt: raw.windowExpiresAt ? String(raw.windowExpiresAt) : null,
    status,
    decidedBy: raw.decidedBy ? String(raw.decidedBy) : null,
    decidedAt: raw.decidedAt ? String(raw.decidedAt) : null,
    approvedText: raw.approvedText ? String(raw.approvedText) : null,
    deliveryStatus: raw.deliveryStatus === 'sent' || raw.deliveryStatus === 'failed' ? raw.deliveryStatus : null,
    deliveryError: raw.deliveryError ? String(raw.deliveryError) : null,
    providerReplyId: raw.providerReplyId ? String(raw.providerReplyId) : null,
  };
}

export function normalizeCommercialDrafts(raw: any): CommercialDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeCommercialDraft).filter((x): x is CommercialDraft => x !== null);
}

/** يطبّع سجل قرارات المالك المحفوظ. */
export function normalizeOwnerDecisions(raw: any): CommercialOwnerDecision[] {
  if (!Array.isArray(raw)) return [];
  const out: CommercialOwnerDecision[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const id = String(r.id || '').trim();
    if (!id) continue;
    const kind: CommercialDecisionKind = r.kind === 'reject' ? 'reject' : (r.kind === 'edit_approve' ? 'edit_approve' : 'approve');
    out.push({
      id,
      draftId: String(r.draftId || ''),
      leadId: String(r.leadId || ''),
      leadKey: String(r.leadKey || ''),
      purpose: DRAFT_PURPOSES.has(r.purpose) ? r.purpose : 'reply',
      kind,
      originalText: String(r.originalText || ''),
      editedText: r.editedText ? String(r.editedText) : null,
      decidedBy: String(r.decidedBy || ''),
      decidedAt: String(r.decidedAt || ''),
      delivered: r.delivered === true,
      providerReplyId: r.providerReplyId ? String(r.providerReplyId) : null,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// سجل المحادثة الحقيقي للعميل (من السجلات الفعلية فقط — بلا اختلاق).
// ─────────────────────────────────────────────────────────────────────────────

export interface CommercialConversationEntry {
  direction: 'customer' | 'business';
  text: string;
  at: string;
  externalId: string;
  delivered: boolean;
  providerReplyId: string | null;
}

/**
 * يبني سجل محادثة العميل من سجلات الاستقبال/الردود **الحقيقية** فقط:
 *  - الوارد: سجلات `socialComments` التي معرّفها ضمن `sourceEventIds` للعميل.
 *  - الصادر: سجلات `socialReplies` على نفس الخيط (externalId = آخر حدث/أحد الأحداث).
 * لا يُختلق أي سطر؛ غياب سجل ⇒ سجل فارغ بصراحة.
 */
export function buildLeadConversation(
  lead: CommercialLead,
  inbound: readonly any[],
  outbound: readonly any[],
): CommercialConversationEntry[] {
  const sourceIds = new Set((lead.sourceEventIds || []).map((x) => String(x)));
  const lastExternal = String(lead.lastExternalId || '');
  const out: CommercialConversationEntry[] = [];
  for (const row of inbound) {
    if (!row || String(row.platform || '').toLowerCase() !== lead.platform) continue;
    const id = String(row.externalId || '');
    if (!id || !sourceIds.has(id)) continue;
    out.push({
      direction: 'customer',
      text: String(row.text || ''),
      at: String(row.createdAt || lead.createdAt),
      externalId: id,
      delivered: true,
      providerReplyId: null,
    });
  }
  for (const row of outbound) {
    if (!row || String(row.platform || '').toLowerCase() !== lead.platform) continue;
    const id = String(row.externalId || '');
    if (!id) continue;
    // رد أصلي على أحد أحداث العميل، أو متابعة على آخر حدث للعميل.
    if (!sourceIds.has(id) && id !== lastExternal) continue;
    out.push({
      direction: 'business',
      text: String(row.text || ''),
      at: String(row.repliedAt || row.createdAt || lead.updatedAt),
      externalId: id,
      delivered: row.delivered === true,
      providerReplyId: row.providerReplyId ? String(row.providerReplyId) : null,
    });
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
