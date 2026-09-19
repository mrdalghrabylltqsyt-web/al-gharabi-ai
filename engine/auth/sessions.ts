/**
 * جلسات موقّعة بلا حالة (stateless HMAC).
 *
 * سبب الوجود: الجلسات كانت تُحفظ في Map داخل الذاكرة فقط. داخل Netlify
 * Functions قد يُنفَّذ كل طلب في عملية جديدة، فتُفقد الجلسة فوراً ويُطلب من
 * المالك تسجيل الدخول من جديد في كل مرة. التوكن الموقّع يُتحقق منه رياضياً
 * بلا أي ذاكرة مشتركة، فيبقى صالحاً عبر العمليات وعبر عمليات إعادة النشر.
 *
 * الصلاحيات لا تُؤخذ من التوكن أبداً: التوكن يحمل معرّف المستخدم فقط، والدور
 * يُقرأ من قاعدة البيانات في كل طلب. لذا تغيير الدور أو تعطيل حساب يسري فوراً.
 */
import crypto from "crypto";

export interface SessionPayload {
  /** معرّف المستخدم — الدور لا يُخزَّن هنا إطلاقاً. */
  uid: string;
  /** تاريخ الإصدار بالمللي ثانية، يُقارن بختم الإبطال على مستوى المستخدم. */
  iat: number;
  /** تاريخ الانتهاء بالمللي ثانية. */
  exp: number;
  /** معرّف الجلسة، يُستخدم للإبطال الفردي عند تسجيل الخروج. */
  sid: string;
}

function b64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function signSession(payload: SessionPayload, secret: Buffer): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${signature}`;
}

/**
 * يتحقق من التوقيع والصلاحية. يُعيد الحمولة عند النجاح وnull عند أي خلل.
 * المقارنة تتم بـtimingSafeEqual لمنع هجمات التوقيت.
 */
export function verifySession(token: string, secret: Buffer): SessionPayload | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;

  let expected: string;
  try {
    expected = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  } catch {
    return null;
  }
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(fromB64url(body).toString("utf8")) as SessionPayload;
    if (!payload || typeof payload.uid !== "string" || typeof payload.exp !== "number" || typeof payload.sid !== "string") return null;
    if (typeof payload.iat !== "number") payload.iat = 0;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 يوماً