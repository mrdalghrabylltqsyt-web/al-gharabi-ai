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
