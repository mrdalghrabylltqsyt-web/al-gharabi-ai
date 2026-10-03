/**
 * الغرابي AI — **مصادقة المالك لمركز الاستعادة المستقل**.
 *
 * وحدة منطق صافٍ قابلة للاختبار (بلا شبكة وبلا سرّ مكتوب). تحمي مسارات مركز
 * الاستعادة التي تكشف **بيانات وصفية** عن نقاط الاستعادة (الالتزامات، عدد الملفات،
 * عدد الأسرار) أو تُنفّذ استعادة، فلا يراها أي زائر مجهول.
 *
 * لماذا مفتاح مستقل: المركز خدمة منفصلة بحزمة نشر خاصة، ولا يشترك في جلسات تطبيق
 * الغرابي الرئيسي ولا في جدول مستخدميه. لذلك يُقبل مفتاح مالك مستقل من بيئة **هذه
 * الخدمة فقط**:
 *   RECOVERY_CENTER_OWNER_TOKEN        (المصدر الأساسي)
 *   RECOVERY_CENTER_OWNER_TOKEN_HASH   (بديل: SHA-256 hex للمفتاح نفسه)
 *
 * الضمانات:
 *  - لا مفتاح في الكود ولا في أي استجابة أو سجل.
 *  - مقارنة بزمن ثابت (timingSafeEqual) لمنع هجمات القياس الزمني.
 *  - **بلا مفتاح مضبوط**: المسارات الحسّاسة مقيّدة افتراضياً (fail-closed)، ما لم
 *    يُفعِّل المالك `RECOVERY_CENTER_ALLOW_UNAUTHENTICATED=true` صراحةً (الوضع المحلي).
 *  - `/api/health` و`/` (الواجهة) و`/api/owner-auth` تبقى عامة: لا تكشف أي سرّ ولا
 *    بيانات وصفية لنقاط الاستعادة.
 */

import crypto from 'node:crypto';

export const OWNER_TOKEN_ENV = 'RECOVERY_CENTER_OWNER_TOKEN';
export const OWNER_TOKEN_HASH_ENV = 'RECOVERY_CENTER_OWNER_TOKEN_HASH';
export const ALLOW_UNAUTHENTICATED_ENV = 'RECOVERY_CENTER_ALLOW_UNAUTHENTICATED';

/**
 * المسارات التي تكشف بيانات وصفية لنقاط الاستعادة أو تنفّذ استعادة.
 * أي مسار آخر (صحة/واجهة/تفويض المالك) يبقى عاماً أو محكوماً بمنطقه الخاص.
 */
export const RECOVERY_CENTER_PROTECTED_PATHS = ['/api/points', '/api/verify', '/api/restore'];

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/** هل المفتاح/البصمة صالح شكلياً (نمنع القيم الفارغة أو التافهة القصيرة)؟ */
function usableToken(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  return v.length >= 8;
}

function usableHash(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(v);
}

/** حالة إعداد مصادقة المالك (أسماء وحالات فقط — بلا أي قيمة سرّية). */
export function inspectRecoveryOwnerAuth(env = process.env) {
  const tokenSet = usableToken(env[OWNER_TOKEN_ENV]);
  const hashSet = usableHash(env[OWNER_TOKEN_HASH_ENV]);
  const allowUnauthenticated = String(env[ALLOW_UNAUTHENTICATED_ENV] || '').toLowerCase() === 'true';
  return {
    configured: tokenSet || hashSet,
    source: tokenSet ? 'env_token' : hashSet ? 'env_token_hash' : 'none',
    allowUnauthenticated,
    protectedPaths: [...RECOVERY_CENTER_PROTECTED_PATHS],
  };
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** يستخرج المفتاح المقدَّم من ترويسة `Authorization: Bearer <token>` فقط (لا سطر طلب). */
export function extractBearerToken(headerValue) {
  const raw = typeof headerValue === 'string' ? headerValue.trim() : '';
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : '';
}

/**
 * هل الطلب مصرّح له بالوصول للمسارات الحسّاسة؟
 * يعيد `{ allowed, reason }` — والسبب صريح بلا كشف أي قيمة.
 */
export function checkRecoveryOwnerAuth(req, env = process.env) {
  const info = inspectRecoveryOwnerAuth(env);
  if (info.allowUnauthenticated) return { allowed: true, reason: 'unauthenticated_allowed_by_owner' };
  if (!info.configured) return { allowed: false, reason: 'owner_token_not_configured' };

  const header = req?.headers?.authorization ?? req?.headers?.Authorization ?? '';
  const supplied = extractBearerToken(header);
  if (!supplied) return { allowed: false, reason: 'missing_bearer_token' };

  if (info.source === 'env_token') {
    return timingSafeEqualStr(env[OWNER_TOKEN_ENV].trim(), supplied)
      ? { allowed: true, reason: 'bearer_ok' }
      : { allowed: false, reason: 'invalid_bearer_token' };
  }
  // بديل البصمة: نقارن هاش المقدَّم بالهاش المضبوط.
  return timingSafeEqualStr(env[OWNER_TOKEN_HASH_ENV].trim().toLowerCase(), sha256Hex(supplied))
    ? { allowed: true, reason: 'bearer_ok' }
    : { allowed: false, reason: 'invalid_bearer_token' };
}

/** يُعلن ما إذا كان مسار معيّن محمياً (مصدر واحد للحقيقة في الخادم والاختبار). */
export function isProtectedRecoveryPath(pathname) {
  return RECOVERY_CENTER_PROTECTED_PATHS.includes(String(pathname));
}

/** كتلة حالة عامة (بلا سرّ) تُعرض في /api/health لتوضيح أن الحماية فعّالة. */
export function recoveryOwnerAuthStatus(env = process.env) {
  const info = inspectRecoveryOwnerAuth(env);
  return {
    required: !info.allowUnauthenticated,
    configured: info.configured,
    source: info.source,
    protectedPaths: info.protectedPaths,
  };
}
