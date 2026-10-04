/**
 * حالة المحادثة والسياق قصير المدى (Conversation State + Short-Term Context).
 *
 * الغرض: تمثيل محادثة واحدة بمعرّف صريح، مع نافذة قصيرة المدى محدودة العدد والعمر،
 * بحيث لا تتسرب رسائل محادثة إلى أخرى، ولا ينمو السياق بلا حد.
 *
 * منطق صافٍ قابل للاختبار: لا شبكة، لا أسرار، ولا ساعة حقيقية (الزمن يُمرَّر دائماً).
 * لا يحمل هذا الملف أي بيانات هوية عميل — فقط نص الرسالة ودورها ووقتها.
 */

export type ConversationRole = 'customer' | 'business';

export interface ConversationMessage {
  role: ConversationRole;
  text: string;
  /** وقت الرسالة (ISO) يُمرَّر من الخارج — لا ساعة داخلية. */
  at: string;
  /** معرّف التعليق/الرسالة لدى المنصة عند توفره (لمنع التكرار). */
  externalId?: string;
}

export interface ConversationState {
  /** مفتاح المحادثة الوحيد: منصة + موضوع (منشور/خيط). لا يُشتق من هوية العميل. */
  conversationId: string;
  platform: string | null;
  subjectId: string | null;
  authorName: string | null;
  messages: ConversationMessage[];
  messageCount: number;
  createdAt: string;
  lastActivityAt: string | null;
}

/** الحدود الآمنة للنافذة قصيرة المدى. */
export const CONVERSATION_MAX_MESSAGES = 40;
export const CONVERSATION_DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 ساعات
export const CONVERSATION_MIN_TTL_MS = 60 * 1000;
export const CONVERSATION_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** معرّف محادثة مستقر: منصة + موضوع. يمنع خلط محادثتين مختلفتين. */
export function conversationKey(platform: string | null | undefined, subjectId: string | null | undefined): string {
  const p = String(platform || 'unknown').trim().toLowerCase() || 'unknown';
  const s = String(subjectId || 'thread').trim() || 'thread';
  return `${p}::${s}`;
}

export function createConversationState(input: {
  conversationId: string;
  platform?: string | null;
  subjectId?: string | null;
  authorName?: string | null;
  nowIso: string;
}): ConversationState {
  return {
    conversationId: input.conversationId,
    platform: input.platform ?? null,
    subjectId: input.subjectId ?? null,
    authorName: input.authorName ?? null,
    messages: [],
    messageCount: 0,
    createdAt: input.nowIso,
    lastActivityAt: null,
  };
}

/** يضيف رسالة ويقصّ النافذة للحد الأقصى (الأحدث تبقى). لا يعدّل الحالة الأصلية. */
export function appendMessage(
  state: ConversationState,
  message: ConversationMessage,
  options: { maxMessages?: number } = {},
): ConversationState {
  const max = Math.max(1, options.maxMessages ?? CONVERSATION_MAX_MESSAGES);
  const messages = [...state.messages, { ...message }].slice(-max);
  return {
    ...state,
    messages,
    messageCount: state.messageCount + 1,
    lastActivityAt: message.at || state.lastActivityAt,
  };
}

/** النافذة قصيرة المدى: آخر N رسالة فقط، مع إعلان صريح هل قُصّت. */
export function shortTermWindow(
  state: ConversationState,
  options: { size?: number } = {},
): { messages: ConversationMessage[]; truncated: boolean; conversationId: string } {
  const size = Math.max(1, options.size ?? 10);
  const truncated = state.messages.length > size;
  return { messages: state.messages.slice(-size), truncated, conversationId: state.conversationId };
}

/** هل تجاوزت المحادثة عمر النافذة القصيرة؟ */
export function isConversationStale(state: ConversationState, nowMs: number, ttlMs = CONVERSATION_DEFAULT_TTL_MS): boolean {
  const anchor = state.lastActivityAt || state.createdAt;
  const t = Date.parse(anchor);
  if (!Number.isFinite(t)) return true; // زمن مشوّه ⇒ نعتبرها منتهية (لا نُبقيها للأبد)
  return nowMs - t >= Math.max(CONVERSATION_MIN_TTL_MS, ttlMs);
}

/** يشذّب المحادثات المنتهية من القائمة (بلا تعديل الأصل). */
export function pruneStaleConversations(states: ConversationState[], nowMs: number, ttlMs = CONVERSATION_DEFAULT_TTL_MS): ConversationState[] {
  return states.filter((s) => !isConversationStale(s, nowMs, ttlMs));
}

/** ملخّص آمن للعرض/التشخيص (بلا أي بيانات هوية). */
export function conversationSummary(state: ConversationState): {
  conversationId: string;
  platform: string | null;
  subjectId: string | null;
  messageCount: number;
  windowSize: number;
  lastActivityAt: string | null;
} {
  return {
    conversationId: state.conversationId,
    platform: state.platform,
    subjectId: state.subjectId,
    messageCount: state.messageCount,
    windowSize: state.messages.length,
    lastActivityAt: state.lastActivityAt,
  };
}

/**
 * نصوص ردودنا السابقة في **هذه المحادثة فقط** — تُغذّي منع التكرار الميكانيكي في
 * محرّك الردود دون أن تقرأ محادثة أخرى. هذا هو جسر «السياق قصير المدى → الرد».
 */
export function priorBusinessReplies(state: ConversationState, limit = 50): string[] {
  return state.messages
    .filter((m) => m.role === 'business' && typeof m.text === 'string' && m.text.trim())
    .map((m) => m.text)
    .slice(-Math.max(1, limit));
}
