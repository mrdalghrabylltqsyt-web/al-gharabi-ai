/**
 * ربط Telegram المالك بنقرة (2026-10-27) — منطق صافٍ قابل للاختبار.
 *
 * كان التنبيه الفوري يحتاج أن يضع المالك `OWNER_TELEGRAM_CHAT_ID` يدوياً في إعدادات Render
 * (بعد أن يعرف رقم محادثته من بوت آخر). لذلك بقي غير مكتمل والحالات الحرجة لا تصل لهاتفه.
 *
 * الآن: المالك (بجلسة مالك) يضغط «اربط Telegram» ⇒ رمز لمرة واحدة صالح 10 دقائق ⇒ يفتح رابط
 * البوت (أو يرسل `/link الرمز`) من محادثته الخاصة ⇒ يُحفظ رقم محادثته. لا سرّ يُخزَّن:
 *   - الرمز لا يُحفظ نصاً؛ تُحفظ بصمته (HMAC بسرّ الخادم) فقط، ويُمسح عند أول نجاح.
 *   - يُقبل من محادثة خاصة فقط (رقم موجب) — المجموعات والقنوات مرفوضة كما في قاعدة البيئة.
 *   - 5 محاولات خاطئة تُلغي الرمز (لا تخمين)، وانتهاء المهلة يُلغيه.
 *   - متغيّر البيئة إن ضُبط يبقى الحَكَم (أولوية)، والربط بالرمز بديل لا يتجاوزه.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const OWNER_TG_PAIRING_TTL_MS = 10 * 60 * 1000;
export const OWNER_TG_PAIRING_MAX_ATTEMPTS = 5;
/** أبجدية بلا أحرف ملتبسة (0/O، 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const OWNER_TG_PAIRING_CODE_LEN = 8;

export interface OwnerTelegramPairingState {
  chatId: string | null;
  pairedAt: string | null;
  pending: { codeHash: string; expiresAt: number; attempts: number } | null;
}

export type PairingOutcome = 'paired' | 'no_pending' | 'expired' | 'bad_code' | 'locked' | 'not_private';

export function defaultOwnerTelegramPairing(): OwnerTelegramPairingState {
  return { chatId: null, pairedAt: null, pending: null };
}

const validChat = (v: unknown): string | null => { const s = String(v ?? '').trim(); return /^[1-9]\d{4,19}$/.test(s) ? s : null; };

export function normalizeOwnerTelegramPairing(raw: unknown): OwnerTelegramPairingState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const p = r.pending && typeof r.pending === 'object' ? r.pending : null;
  const pending = p && /^[0-9a-f]{64}$/.test(String(p.codeHash || '')) && Number.isFinite(Number(p.expiresAt))
    ? { codeHash: String(p.codeHash), expiresAt: Number(p.expiresAt), attempts: Math.max(0, Math.min(99, Number(p.attempts) || 0)) }
    : null;
  const chatId = validChat(r.chatId);
  return { chatId, pairedAt: chatId && typeof r.pairedAt === 'string' ? r.pairedAt : null, pending };
}

/** رمز جديد من بايتات عشوائية (crypto.randomBytes في الخادم). */
export function newPairingCode(randomBytes: (n: number) => Uint8Array): string {
  const b = randomBytes(OWNER_TG_PAIRING_CODE_LEN);
  let out = '';
  for (let i = 0; i < OWNER_TG_PAIRING_CODE_LEN; i++) out += ALPHABET[b[i] % ALPHABET.length];
  return out;
}

export function hashPairingCode(code: string, secret: string | Buffer): string {
  return createHmac('sha256', secret).update(`owner-tg-pair:${String(code).toUpperCase()}`).digest('hex');
}

/** يبدأ ربطاً جديداً (يُلغي أي رمز سابق). الربط القائم يبقى حتى ينجح الجديد. */
export function startOwnerTelegramPairing(state: OwnerTelegramPairingState, code: string, secret: string | Buffer, nowMs: number): OwnerTelegramPairingState {
  return { ...state, pending: { codeHash: hashPairingCode(code, secret), expiresAt: nowMs + OWNER_TG_PAIRING_TTL_MS, attempts: 0 } };
}

/**
 * يستخرج رمز الربط من رسالة للبوت: `/start CODE` (رابط البوت العميق) أو `/link CODE`.
 * أي نص آخر ليس محاولة ربط (يبقى رسالة عادية).
 */
export function extractPairingCode(text: unknown): string | null {
  const m = /^\/(?:start|link)(?:@\w+)?\s+([A-Za-z0-9]{6,16})\s*$/.exec(String(text ?? '').trim());
  return m ? m[1].toUpperCase() : null;
}

export function completeOwnerTelegramPairing(
  state: OwnerTelegramPairingState,
  input: { code: string; chatId: string },
  secret: string | Buffer,
  nowMs: number,
): { state: OwnerTelegramPairingState; outcome: PairingOutcome } {
  const p = state.pending;
  if (!p) return { state, outcome: 'no_pending' };
  if (nowMs > p.expiresAt) return { state: { ...state, pending: null }, outcome: 'expired' };
  const chatId = validChat(input.chatId);
  if (!chatId) return { state, outcome: 'not_private' };
  const got = Buffer.from(hashPairingCode(input.code, secret));
  const exp = Buffer.from(p.codeHash);
  if (got.length !== exp.length || !timingSafeEqual(got, exp)) {
    const attempts = p.attempts + 1;
    if (attempts >= OWNER_TG_PAIRING_MAX_ATTEMPTS) return { state: { ...state, pending: null }, outcome: 'locked' };
    return { state: { ...state, pending: { ...p, attempts } }, outcome: 'bad_code' };
  }
  return { state: { chatId, pairedAt: new Date(nowMs).toISOString(), pending: null }, outcome: 'paired' };
}

export function unpairOwnerTelegram(_state: OwnerTelegramPairingState): OwnerTelegramPairingState {
  return defaultOwnerTelegramPairing();
}

/** المحادثة الفعّالة: البيئة أولاً (قرار إعداد صريح)، ثم الربط بالرمز. */
export function effectiveOwnerChat(envChatId: string | null, state: OwnerTelegramPairingState): { chatId: string | null; source: 'env' | 'paired' | null } {
  if (envChatId) return { chatId: envChatId, source: 'env' };
  if (state.chatId) return { chatId: state.chatId, source: 'paired' };
  return { chatId: null, source: null };
}

export function pairingOutcomeText(o: PairingOutcome): string {
  switch (o) {
    case 'paired': return '✅ تم ربط هذه المحادثة بتنبيهات معرض الغرابي. ستصلك هنا الحالات الحرجة واستفسارات الزبائن فوراً، مع زر موافقة بضغطة.';
    case 'expired': return '⌛ انتهت صلاحية رمز الربط. أنشئ رمزاً جديداً من الشاشة الحية.';
    case 'locked': return '⛔ محاولات خاطئة كثيرة؛ أُلغي الرمز. أنشئ رمزاً جديداً من الشاشة الحية.';
    case 'bad_code': return '❌ الرمز غير صحيح.';
    case 'not_private': return 'الربط من محادثة خاصة مع البوت فقط.';
    default: return 'لا يوجد طلب ربط مفتوح.';
  }
}
