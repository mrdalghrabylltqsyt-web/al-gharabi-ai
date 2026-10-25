/**
 * تنبيه المالك الفوري عبر Telegram — قناة ثانية بجانب ملخص البريد (كل 30 دقيقة).
 *
 * الغرض: البريد يصل كملخص كل نصف ساعة، بينما زبون التقسيط يقرر بسرعة. Telegram
 * يوصل كل حدث جديد (استفسار ينتظر الموافقة، تصعيد، انقطاع ربط) إلى هاتف المالك
 * خلال ثوانٍ، عبر بوت المعرض نفسه إلى محادثة المالك الخاصة فقط.
 *
 * منطق صافٍ قابل للاختبار (بلا شبكة/أسرار): التحقق من معرّف المحادثة، بناء نص
 * الرسالة، وحدّ معدّل يمنع الإغراق (20 رسالة/ساعة ثم رسالة تجاوز واحدة). الإرسال
 * نفسه في الخادم عبر موصل Telegram القائم. لا يُرسل شيء للزبون إطلاقاً.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { OWNER_ALERT_KIND_LABELS_AR, type OwnerAlertItem } from './ownerAlerts';

export const OWNER_TELEGRAM_CHAT_ENV = 'OWNER_TELEGRAM_CHAT_ID';
/** أقصى رسائل فورية في الساعة؛ بعدها رسالة تجاوز واحدة ويكمل البريد الملخّص. */
export const OWNER_TELEGRAM_MAX_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

/**
 * معرّف محادثة المالك الخاصة: رقم موجب فقط (محادثة شخصية مع البوت).
 * المجموعات/القنوات (معرّفات سالبة) مرفوضة عمداً كي لا تصل بيانات زبائن لمجموعة.
 */
export function parseOwnerTelegramChatId(env: Record<string, string | undefined>): string | null {
  const raw = String(env[OWNER_TELEGRAM_CHAT_ENV] ?? '').trim();
  return /^[1-9]\d{4,19}$/.test(raw) ? raw : null;
}

/** نص الرسالة الفورية: النوع والمنصة ومقتطف قصير ورابط الصفحة المعنية. */
export function buildOwnerTelegramMessage(item: OwnerAlertItem, appUrl: string | null): string {
  const label = OWNER_ALERT_KIND_LABELS_AR[item.kind] || 'تنبيه';
  const icon = item.kind === 'commercial_draft' ? '🛒' : item.kind === 'social_escalation' ? '⚠️' : '🔌';
  const tab = item.kind === 'platform_reauth' ? 'platform_connections' : 'commercial_inbox';
  const url = appUrl ? `${appUrl.replace(/\/$/, '')}/?tab=${tab}` : null;
  const lines = [`${icon} ${label}${item.platform ? ` — ${item.platform}` : ''}`];
  const body = String(item.snippet || item.title || '').trim().slice(0, 300);
  if (body) lines.push(body);
  if (url) lines.push('', url);
  return lines.join('\n').slice(0, 1000);
}

export interface OwnerTelegramRateState {
  windowStartMs: number;
  sentInWindow: number;
  overflowNotified: boolean;
}

export function defaultOwnerTelegramRateState(): OwnerTelegramRateState {
  return { windowStartMs: 0, sentInWindow: 0, overflowNotified: false };
}

/**
 * قرار حدّ المعدّل لرسالة فورية واحدة:
 * - send: ضمن الحد.
 * - overflow: تجاوز الحد لأول مرة في هذه الساعة ⇒ رسالة تجاوز واحدة.
 * - drop: تجاوز وسبق الإبلاغ ⇒ لا رسالة (البريد الملخّص يحمل الحدث).
 */
export function decideOwnerTelegramSend(
  state: OwnerTelegramRateState,
  nowMs: number,
  maxPerHour = OWNER_TELEGRAM_MAX_PER_HOUR,
): { decision: 'send' | 'overflow' | 'drop'; next: OwnerTelegramRateState } {
  const fresh = nowMs - state.windowStartMs >= HOUR_MS || nowMs < state.windowStartMs;
  const base: OwnerTelegramRateState = fresh ? { windowStartMs: nowMs, sentInWindow: 0, overflowNotified: false } : state;
  if (base.sentInWindow < maxPerHour) {
    return { decision: 'send', next: { ...base, sentInWindow: base.sentInWindow + 1 } };
  }
  if (!base.overflowNotified) return { decision: 'overflow', next: { ...base, overflowNotified: true } };
  return { decision: 'drop', next: base };
}

export const OWNER_TELEGRAM_OVERFLOW_TEXT =
  `🔔 تنبيهات كثيرة خلال الساعة (أكثر من ${OWNER_TELEGRAM_MAX_PER_HOUR}). أوقفت الرسائل الفورية حتى الساعة القادمة؛ ستصلك البقية في ملخص البريد. افتح صندوق الموافقات.`;

/** المفاتيح الجديدة فقط (لم تكن معلّقة قبل التحديث) — أساس الإرسال الفوري بلا تكرار. */
export function newlyQueuedAlerts(before: OwnerAlertItem[], after: OwnerAlertItem[]): OwnerAlertItem[] {
  const prev = new Set(before.map((i) => i.key));
  return after.filter((i) => !prev.has(i.key));
}

// -----------------------------------------------------------------------------
// موافقة بضغطة واحدة من Telegram (قرار المالك على مسودة رد لزبون).
//
// كل زر يحمل: الإجراء + معرّف المسودة + توقيع HMAC قصير بسرّ الخادم، فلا يمكن
// صنع زر صالح من خارج الخادم. يُقبل الضغط فقط من محادثة المالك الخاصة (معرّف
// المرسل = معرّف المحادثة = OWNER_TELEGRAM_CHAT_ID). القرار نفسه يمر بنفس منفّذ
// قرار المالك في التطبيق (نافذة Meta، سلامة المحتوى، منع التكرار، التدقيق).
// -----------------------------------------------------------------------------
export type OwnerTelegramAction = 'approve' | 'reject';
const ACTION_CODE: Record<OwnerTelegramAction, string> = { approve: 'a', reject: 'r' };
const CODE_ACTION: Record<string, OwnerTelegramAction> = { a: 'approve', r: 'reject' };
const SIG_LEN = 12;

/** مفتاح التوقيع: سرّ الجلسة في الخادم (Buffer) أو نص في الاختبار. */
export type OwnerTelegramSigningKey = string | Buffer;

function actionSignature(code: string, draftId: string, secret: OwnerTelegramSigningKey): string {
  return createHmac('sha256', secret).update(`owner-tg:${code}:${draftId}`).digest('hex').slice(0, SIG_LEN);
}

/** بيانات زر موقّعة؛ null إن تعذّر (سرّ مفقود أو تجاوز حد 64 بايت). */
export function signOwnerTelegramAction(action: OwnerTelegramAction, draftId: string, secret: OwnerTelegramSigningKey): string | null {
  const id = String(draftId || '');
  if (!secret || secret.length === 0 || !id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const code = ACTION_CODE[action];
  const data = `${code}:${id}:${actionSignature(code, id, secret)}`;
  return Buffer.byteLength(data, 'utf8') <= 64 ? data : null;
}

/** يتحقق من زر موقّع ويعيد الإجراء والمسودة، أو null لأي عبث. */
export function verifyOwnerTelegramAction(data: string, secret: OwnerTelegramSigningKey): { action: OwnerTelegramAction; draftId: string } | null {
  if (!secret || secret.length === 0) return null;
  const m = /^([ar]):([A-Za-z0-9_-]+):([0-9a-f]+)$/.exec(String(data || ''));
  if (!m) return null;
  const [, code, draftId, sig] = m;
  const expected = actionSignature(code, draftId, secret);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return { action: CODE_ACTION[code], draftId };
}

/** هل الضغطة من المالك نفسه في محادثته الخاصة؟ */
export function isOwnerTelegramCallback(cb: { fromId: string; chatId: string | null }, ownerChatId: string | null): boolean {
  return Boolean(ownerChatId) && cb.fromId === ownerChatId && cb.chatId === ownerChatId;
}

/** معرّف المسودة من مفتاح تنبيه «commercial_draft:<platform>:<draftId>». */
export function draftIdFromAlertKey(key: string): string | null {
  const parts = String(key || '').split(':');
  if (parts[0] !== 'commercial_draft' || parts.length < 3) return null;
  const id = parts.slice(2).join(':');
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

/** نص نتيجة القرار الذي يظهر للمالك بعد الضغط. */
export function ownerTelegramDecisionText(action: OwnerTelegramAction, outcome: { ok: boolean; delivered?: boolean; error?: string | null }): string {
  if (action === 'reject') return outcome.ok ? '❌ رُفض الرد؛ لم يُرسل شيء للزبون.' : `تعذّر الرفض: ${String(outcome.error || 'خطأ غير معروف').slice(0, 160)}`;
  if (outcome.ok && outcome.delivered) return '✅ أُرسل الرد للزبون (بإيصال من المنصة).';
  return `⚠️ لم يُرسل الرد: ${String(outcome.error || 'خطأ غير معروف').slice(0, 160)}`;
}
