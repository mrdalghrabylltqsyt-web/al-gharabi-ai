/**
 * التعريف الموحّد لمفتاح تشفير توكنات المنصات (PLATFORM_TOKEN_ENCRYPTION_KEY).
 *
 * سبب الوجود: كان الفحص مبعثراً بين مسارين لا يتفقان:
 * - tokenKeyBytes() في server.ts كان يفك Base64 بلا تشدد (يقبل نصوصاً لا تمثّل
 *   32 بايت بالضبط، مثل 32 محرفاً ASCII تُفك إلى 24 بايت)، ثم يُسقطها بصمت لأن
 *   الطول ليس 32، فيظهر «غير مضبوط أو غير صالح» عند التشفير.
 * - credentials.ts وreadiness كانا يفحصان وجود اسم المتغير فقط، فيُعلنان
 *   «مضبوط» لنفس القيمة غير الصالحة => تضارب صريح بين اللوحة والعمل الفعلي.
 *
 * هنا مصدر واحد: صيغتان مقبولتان تنتجان 32 بايت بالضبط، وفصل صريح بين
 * missing وinvalid، بلا كشف أي قيمة ولا تسجيلها. لا fallback غير آمن ولا مفتاح
 * مكتوب في الكود.
 */

export const TOKEN_KEY_ENV_NAME = 'PLATFORM_TOKEN_ENCRYPTION_KEY';

/** الطول الملزم لمفتاح AES-256-GCM. */
export const TOKEN_KEY_BYTES = 32;

export type TokenKeyState = 'valid' | 'missing' | 'invalid';
export type TokenKeyFormat = 'hex' | 'base64' | null;

export interface TokenKeyInspection {
  state: TokenKeyState;
  format: TokenKeyFormat;
  /** عدد البايتات الناتجة عند الصلاح (بلا كشف القيمة). */
  bytes: number | null;
  /** شرح عربي صريح يفرّق missing عن invalid ويذكر الصيغة المطلوبة، بلا أي سرّ. */
  reason: string;
}

/** صيغة hex: 64 محرفاً ست عشرياً => 32 بايت. */
const HEX_64 = /^[0-9a-fA-F]{64}$/;
/** Base64 قياسي: أبجدية [+/] مع حشو '=' اختياري (0-2). */
const BASE64_STD = /^[A-Za-z0-9+/]+={0,2}$/;
/** Base64url: أبجدية [-_] مع حشو '=' اختياري. */
const BASE64_URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** التوجيه الآمن للمالك عند القيمة غير الصالحة — يذكر الصيغ المقبولة بلا قيمة. */
export const TOKEN_KEY_FORMAT_HINT =
  'الصيغ المقبولة: 64 محرفاً hex، أو Base64/Base64url يمثّل 32 بايت بالضبط (مثل ناتج randomBytes(32).toString("base64")).';

/**
 * يفكّ قيمة المفتاح إلى 32 بايت، أو null إن كانت غائبة أو غير صالحة.
 * يقبل الصيغة القانونية فقط: لا تمثيلات ملتبسة ولا محارف خارجة عن الأبجدية
 * (فلا تُقبل علامات تنصيص أو محارف غريبة تُتجاهلها مكتبة Base64 المتسامحة).
 */
export function decodeTokenKey(rawValue: string | undefined | null): Buffer | null {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) return null;
  if (HEX_64.test(value)) return Buffer.from(value, 'hex');

  const isStd = BASE64_STD.test(value);
  const isUrl = BASE64_URL.test(value);
  if (!isStd && !isUrl) return null;

  const decoded = Buffer.from(value, isStd ? 'base64' : 'base64url');
  if (decoded.length !== TOKEN_KEY_BYTES) return null;

  // الصيغة القانونية فقط: إعادة الترميز يجب أن تطابق المُدخل (بلا حشو).
  const canonical = (isStd ? decoded.toString('base64') : decoded.toString('base64url')).replace(/=+$/, '');
  if (canonical !== value.replace(/=+$/, '')) return null;
  return decoded;
}

/** يفحص القيمة ويميّز valid من missing من invalid بلا كشف أي قيمة. */
export function inspectTokenKey(rawValue: string | undefined | null): TokenKeyInspection {
  const trimmed = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!trimmed) {
    return {
      state: 'missing',
      format: null,
      bytes: null,
      reason: `${TOKEN_KEY_ENV_NAME} غير مضبوط في بيئة الخادم. ${TOKEN_KEY_FORMAT_HINT}`,
    };
  }
  if (HEX_64.test(trimmed)) {
    return { state: 'valid', format: 'hex', bytes: TOKEN_KEY_BYTES, reason: 'المفتاح صالح (hex، 32 بايت).' };
  }
  const decoded = decodeTokenKey(trimmed);
  if (decoded) {
    return { state: 'valid', format: 'base64', bytes: decoded.length, reason: 'المفتاح صالح (Base64، 32 بايت).' };
  }
  return {
    state: 'invalid',
    format: null,
    bytes: null,
    reason: `${TOKEN_KEY_ENV_NAME} مضبوط لكن قيمته غير صالحة: لا تمثّل 32 بايت. ${TOKEN_KEY_FORMAT_HINT}`,
  };
}

/** يفحص بيئة كاملة (افتراضياً بيئة الخادم) — بلا إرجاع القيمة. */
export function inspectTokenKeyFromEnv(env: Record<string, string | undefined> = process.env): TokenKeyInspection {
  return inspectTokenKey(env[TOKEN_KEY_ENV_NAME]);
}

/** هل المفتاح صالح الآن؟ المصدر الوحيد لكل قرار اتصال/تشفير. */
export function isTokenKeyValid(env: Record<string, string | undefined> = process.env): boolean {
  return inspectTokenKeyFromEnv(env).state === 'valid';
}
