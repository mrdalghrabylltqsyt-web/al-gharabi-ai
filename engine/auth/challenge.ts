/**
 * رمز تحقق المالك بلا حالة (نمط TOTP).
 *
 * سبب الوجود: الرمز كان يُحفظ في Map داخل الذاكرة. داخل Netlify Functions قد
 * يُنفَّذ إنشاء الرمز في عملية، والتحقق منه في عملية أخرى، فلا يُوجد الرمز
 * أبداً ويفشل دخول المالك دائماً. هنا يُشتق الرمز رياضياً من مفتاح الخادم
 * ونافذة زمنية، فيتحقق منه أي عملية بنفس النتيجة بلا أي تخزين مشترك.
 *
 * النافذة: 10 دقائق، وتُقبل النافذة السابقة أيضاً لتفادي فقدان الرمز على
 * حدود النافذة. الرمز لا يُسجَّل ولا يُعاد في أي استجابة.
 */
import crypto from "crypto";

/** مدة صلاحية الرمز بالمللي ثانية. */
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

/**
 * يُشتق رمز من 6 أرقام لنافذة زمنية محددة.
 * المُدخل يشمل البريد كي لا يصلح رمز بريد لِبريد آخر.
 */
function codeForWindow(email: string, windowIndex: number, secret: Buffer): string {
  const digest = crypto
    .createHmac("sha256", secret)
    .update(`gharabi-otp:${email.toLowerCase().trim()}:${windowIndex}`)
    .digest();
  // RFC 4226 dynamic truncation ثم 6 أرقام.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binary % 1_000_000).toString().padStart(6, "0");
}

function windowIndexAt(timestamp: number): number {
  return Math.floor(timestamp / CHALLENGE_TTL_MS);
}

/** الرمز الحالي لبريد معيّن. */
export function issueChallengeCode(email: string, secret: Buffer, now = Date.now()): string {
  return codeForWindow(email, windowIndexAt(now), secret);
}

/**
 * يتحقق من الرمز مقابل النافذة الحالية والسابقة.
 * يُعيد true فقط عند تطابق فعلي، والمقارنة بزمن ثابت لمنع هجمات التوقيت.
 */
export function verifyChallengeCode(email: string, code: string, secret: Buffer, now = Date.now()): boolean {
  return matchChallengeWindow(email, code, secret, now) !== null;
}

/**
 * يُعيد رقم النافذة التي طابقها الرمز، أو null عند عدم التطابق.
 *
 * الحاجة: منع إعادة استخدام الرمز يتطلب معرفة النافذة المُستهلكة بالضبط، لا
 * مجرد نجاح/فشل. هكذا يُرفض إعادة استخدام رمز نافذة سابقة بينما يبقى الرمز
 * الجديد لنافذة أحدث مقبولاً.
 */
export function matchChallengeWindow(email: string, code: string, secret: Buffer, now = Date.now()): number | null {
  const supplied = String(code ?? "").trim();
  if (!/^\d{6}$/.test(supplied)) return null;

  const current = windowIndexAt(now);
  const expected = Buffer.from(supplied);
  for (const index of [current, current - 1]) {
    const candidate = Buffer.from(codeForWindow(email, index, secret));
    if (candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)) return index;
  }
  return null;
}