/**
 * Working Memory — الذاكرة العاملة قصيرة المدى للعقل (منطق خالص قابل للاختبار).
 *
 * الغرض: أن يحتفظ العقل بسياق نشط أثناء مهمة/جلسة (آخر رسالة، السؤال غير المحلول،
 * الهدف الحالي، تصعيد معلّق، استشارة الوكلاء، القرار الحالي) مع عمر صريح (TTL)
 * وحد أقصى. **لا ترقية تلقائية إلى الذاكرة طويلة المدى** — هذا ممنوع بالتصميم
 * (انظر `engine/social/memorySeparation.ts`). لا شبكة ولا أسرار ولا ساعة حقيقية
 * إلا عبر حقن `now`.
 */

import type { EscalationReason } from '../../social/escalation';

/** حالة الذاكرة العاملة لمحادثة/مهمة واحدة (بلا بيانات هوية حساسة). */
export interface WorkingMemoryEntry {
  /** مفتاح السياق (منصة::موضوع) — نفس نمط `conversationState`. */
  conversationId: string;
  platform: string | null;
  objective: string | null;
  lastCustomerMessage: string | null;
  previousRelevantMessages: string[];
  /** سؤال/طلب لم يُحلّ بعد. */
  unresolvedQuestion: string | null;
  /** تصعيد معلّق مرتبط بهذا السياق (بلا تفاصيل سرّية). */
  pendingEscalationReason: EscalationReason | null;
  /** آخر قرار للعقل (ملخّص) لهذا السياق. */
  lastDecisionSummary: string | null;
  /** الوكلاء المستشارون في آخر دورة. */
  lastConsultedAgents: string[];
  /** الرابط بالمحادثة القائمة (لا نُكرّر تخزينها هنا). */
  messageCount: number;
  lastActivityAt: string | null;
  updatedAt: string;
}

export interface WorkingMemoryState {
  entries: WorkingMemoryEntry[];
}

export function emptyWorkingMemory(): WorkingMemoryState {
  return { entries: [] };
}

export const WORKING_MEMORY_MAX = 200;
export const WORKING_MEMORY_TTL_MS = 6 * 60 * 60 * 1000; // 6 ساعات (يطابق نافذة المحادثة)
export const WORKING_MEMORY_MIN_TTL_MS = 60 * 1000;
export const WORKING_MEMORY_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** هل انتهى عمر عنصر الذاكرة العاملة؟ (زمن مشوّه ⇒ منتهٍ، لا يُبقي للأبد). */
export function isWorkingMemoryStale(entry: WorkingMemoryEntry, nowMs: number, ttlMs = WORKING_MEMORY_TTL_MS): boolean {
  const anchor = entry.lastActivityAt || entry.updatedAt;
  const t = Date.parse(anchor);
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= Math.max(WORKING_MEMORY_MIN_TTL_MS, Math.min(WORKING_MEMORY_MAX_TTL_MS, ttlMs));
}

/** يشذّب العناصر المنتهية (بلا تعديل الأصل). */
export function pruneWorkingMemory(state: WorkingMemoryState, nowMs: number, ttlMs = WORKING_MEMORY_TTL_MS): WorkingMemoryState {
  return { entries: state.entries.filter((e) => !isWorkingMemoryStale(e, nowMs, ttlMs)) };
}

/**
 * يحدّث عنصر الذاكرة العاملة لسياق: يدمج الجديد (لا يفقد حقولاً سابقة)، ويُحدِّث
 * وقت النشاط. لا يرقّي شيئاً للذاكرة طويلة المدى هنا.
 */
export function touchWorkingMemory(
  state: WorkingMemoryState,
  patch: Partial<WorkingMemoryEntry> & { conversationId: string; nowIso: string },
): WorkingMemoryState {
  const existing = state.entries.find((e) => e.conversationId === patch.conversationId);
  const merged: WorkingMemoryEntry = {
    conversationId: patch.conversationId,
    platform: patch.platform ?? existing?.platform ?? null,
    objective: patch.objective ?? existing?.objective ?? null,
    lastCustomerMessage: patch.lastCustomerMessage ?? existing?.lastCustomerMessage ?? null,
    previousRelevantMessages: (patch.previousRelevantMessages ?? existing?.previousRelevantMessages ?? []).slice(-20),
    unresolvedQuestion: patch.unresolvedQuestion ?? existing?.unresolvedQuestion ?? null,
    pendingEscalationReason: patch.pendingEscalationReason ?? existing?.pendingEscalationReason ?? null,
    lastDecisionSummary: patch.lastDecisionSummary ?? existing?.lastDecisionSummary ?? null,
    lastConsultedAgents: (patch.lastConsultedAgents ?? existing?.lastConsultedAgents ?? []).slice(0, 8),
    messageCount: patch.messageCount ?? existing?.messageCount ?? 0,
    lastActivityAt: patch.lastActivityAt ?? existing?.lastActivityAt ?? patch.nowIso,
    updatedAt: patch.nowIso,
  };
  const others = state.entries.filter((e) => e.conversationId !== patch.conversationId);
  const next = [...others, merged];
  return { entries: next.slice(-WORKING_MEMORY_MAX) };
}

/** يقرأ عنصر الذاكرة العاملة لسياق (أو null). */
export function getWorkingMemory(state: WorkingMemoryState, conversationId: string): WorkingMemoryEntry | null {
  return state.entries.find((e) => e.conversationId === conversationId) ?? null;
}

/** ملخّص الذاكرة العاملة (للصحة/التشخيص، بلا سرّ). */
export function summarizeWorkingMemory(state: WorkingMemoryState, nowMs: number): {
  total: number; active: number; stale: number; withUnresolved: number; withEscalation: number; note: string;
} {
  const stale = state.entries.filter((e) => isWorkingMemoryStale(e, nowMs)).length;
  return {
    total: state.entries.length,
    active: state.entries.length - stale,
    stale,
    withUnresolved: state.entries.filter((e) => e.unresolvedQuestion).length,
    withEscalation: state.entries.filter((e) => e.pendingEscalationReason).length,
    note: 'الذاكرة العاملة سياق قصير المدى بعمر محدود؛ لا تُرقّى تلقائياً إلى الذاكرة طويلة المدى.',
  };
}

/** يوحّد أي شكل محمّل إلى حالة صحيحة (توافق خلفي بلا إسقاط صامت للأنواع). */
export function normalizeWorkingMemory(raw: any): WorkingMemoryState {
  const entries = Array.isArray(raw?.entries) ? raw.entries : [];
  const valid = entries.filter((e: any) => e && typeof e.conversationId === 'string').map((e: any) => ({
    conversationId: String(e.conversationId),
    platform: typeof e.platform === 'string' ? e.platform : null,
    objective: typeof e.objective === 'string' ? e.objective : null,
    lastCustomerMessage: typeof e.lastCustomerMessage === 'string' ? e.lastCustomerMessage : null,
    previousRelevantMessages: Array.isArray(e.previousRelevantMessages) ? e.previousRelevantMessages.filter((m: any) => typeof m === 'string').slice(-20) : [],
    unresolvedQuestion: typeof e.unresolvedQuestion === 'string' ? e.unresolvedQuestion : null,
    pendingEscalationReason: typeof e.pendingEscalationReason === 'string' ? e.pendingEscalationReason : null,
    lastDecisionSummary: typeof e.lastDecisionSummary === 'string' ? e.lastDecisionSummary : null,
    lastConsultedAgents: Array.isArray(e.lastConsultedAgents) ? e.lastConsultedAgents.filter((a: any) => typeof a === 'string').slice(0, 8) : [],
    messageCount: Number.isFinite(e.messageCount) ? Number(e.messageCount) : 0,
    lastActivityAt: typeof e.lastActivityAt === 'string' ? e.lastActivityAt : null,
    updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : new Date(0).toISOString(),
  }));
  return { entries: valid.slice(-WORKING_MEMORY_MAX) };
}
