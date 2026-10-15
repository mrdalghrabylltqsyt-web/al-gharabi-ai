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
 *    ويقتصر هذا العلم على **اتصال محلي (loopback)** **وخارج بيئة الاستضافة** (F-23):
 *    أي طلب من عنوان خارجي — أو أي خدمة مُستضافة (`RENDER`/`RECOVERY_CENTER_HOSTED`) —
 *    يبقى مقيّداً حتى لو ضُبط العلم خطأً على خدمة مُستضافة.
 *  - `/api/health` و`/` (الواجهة) و`/api/owner-auth` تبقى عامة: لا تكشف أي سرّ ولا
 *    بيانات وصفية لنقاط الاستعادة.
 *  - **تحديد معدّل التخمين**: محاولات فاشلة متكررة من نفس عنوان IP على المسارات
 *    الحسّاسة (أو `/api/owner-auth`) تُحظر مؤقتاً (fail-closed) بعد حدّ معقول، لمنع
 *    تخمين المفتاح بلا قيد عبر الشبكة. النجاح يصفّر العدّاد. عدّاد في الذاكرة فقط
 *    (مقصود: خدمة بعملية واحدة)، بحدّ أقصى لعدد المفاتيح المتتبَّعة لمنع نموّ غير محدود.
 */

import crypto from 'node:crypto';

export const OWNER_TOKEN_ENV = 'RECOVERY_CENTER_OWNER_TOKEN';
export const OWNER_TOKEN_HASH_ENV = 'RECOVERY_CENTER_OWNER_TOKEN_HASH';
export const ALLOW_UNAUTHENTICATED_ENV = 'RECOVERY_CENTER_ALLOW_UNAUTHENTICATED';

/**
 * F-23 (مراجعة): علامات بيئة الاستضافة. عند وجود أي منها يُتجاهل علم تعطيل المصادقة
 * **كلياً** — حتى للعناوين المحلية — لأن الخدمة المُستضافة تصلها اتصالات من وكلاء
 * البروكسي/التحويل وقد تبدو محلية. يُمنع تعطيل المصادقة على أي بيئة مُستضافة.
 */
export const HOSTED_ENV_VARS = ['RENDER', 'RECOVERY_CENTER_HOSTED'];

/** هل نحن في بيئة استضافة (Render أو مركز مستضاف)؟ وجود الاسم بقيمة غير فارغة يكفي. */
export function isHostedEnvironment(env = process.env) {
  return HOSTED_ENV_VARS.some((name) => String(env?.[name] ?? '').trim() !== '');
}

/** نافذة ومعدّل تحديد محاولات التخمين الفاشلة لكل عنوان IP. */
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX_FAILURES = 10;
const AUTH_RATE_LIMIT_MAX_TRACKED_KEYS = 5000;
const failedAuthAttempts = new Map();

/** يستخرج عنوان IP الفعلي للاتصال (بلا افتراض بروكسي) — أفضل مجهود، لا يرمي أبداً. */
export function clientIpOf(req) {
  const addr = req?.socket?.remoteAddress || req?.connection?.remoteAddress;
  return typeof addr === 'string' && addr ? addr : 'unknown';
}

/**
 * F-23: هل عنوان الاتصال محلي (loopback)؟ يُستخدم لربط علم تعطيل المصادقة
 * بالوصول المحلي فقط، فلا يفتح الوصول الخارجي حتى لو ضُبط العلم خطأً.
 * يقبل IPv4 loopback (127.0.0.0/8) وIPv6 loopback (::1) والصيغة المُغلَّفة (::ffff:127.x).
 */
export function isLocalAddress(addr) {
  const a = typeof addr === 'string' ? addr.trim().toLowerCase() : '';
  if (!a) return false;
  if (a === '::1' || a === 'localhost') return true;
  if (a.startsWith('::ffff:')) return isLocalAddress(a.slice('::ffff:'.length));
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (m) return Number(m[1]) === 127;
  return false;
}

function isAuthRateLimited(key) {
  const now = Date.now();
  const entry = failedAuthAttempts.get(key);
  if (!entry || now - entry.windowStart >= AUTH_RATE_LIMIT_WINDOW_MS) return false;
  return entry.count >= AUTH_RATE_LIMIT_MAX_FAILURES;
}

function recordFailedAuthAttempt(key) {
  const now = Date.now();
  const entry = failedAuthAttempts.get(key);
  if (!entry || now - entry.windowStart >= AUTH_RATE_LIMIT_WINDOW_MS) {
    failedAuthAttempts.set(key, { count: 1, windowStart: now });
    if (failedAuthAttempts.size > AUTH_RATE_LIMIT_MAX_TRACKED_KEYS) {
      const oldestKey = failedAuthAttempts.keys().next().value;
      if (oldestKey !== undefined) failedAuthAttempts.delete(oldestKey);
    }
    return;
  }
  entry.count += 1;
}

function clearFailedAuthAttempts(key) {
  failedAuthAttempts.delete(key);
}

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
  const hosted = isHostedEnvironment(env);
  const flagRaw = String(env[ALLOW_UNAUTHENTICATED_ENV] || '').toLowerCase() === 'true';
  // F-23 (مراجعة): على بيئة مُستضافة يُتجاهل العلم كلياً — حتى للعناوين المحلية.
  const allowUnauthenticated = flagRaw && !hosted;
  return {
    configured: tokenSet || hashSet,
    source: tokenSet ? 'env_token' : hashSet ? 'env_token_hash' : 'none',
    allowUnauthenticated,
    allowUnauthenticatedRequested: flagRaw,
    hosted,
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
  // F-23: علم تعطيل المصادقة يُطبَّق **فقط** على اتصال محلي (loopback) و**فقط** خارج
  // بيئة الاستضافة. أي طلب من عنوان خارجي، أو أي خدمة مُستضافة (RENDER/HOSTED)، يبقى
  // مقيّداً بـfail-closed حتى لو ضُبط العلم خطأً.
  if (info.allowUnauthenticated && isLocalAddress(clientIpOf(req))) {
    return { allowed: true, reason: 'unauthenticated_allowed_by_owner' };
  }
  if (!info.configured) return { allowed: false, reason: 'owner_token_not_configured' };

  const ipKey = clientIpOf(req);
  if (isAuthRateLimited(ipKey)) return { allowed: false, reason: 'rate_limited' };

  const header = req?.headers?.authorization ?? req?.headers?.Authorization ?? '';
  const supplied = extractBearerToken(header);
  if (!supplied) {
    recordFailedAuthAttempt(ipKey);
    return { allowed: false, reason: 'missing_bearer_token' };
  }

  if (info.source === 'env_token') {
    if (timingSafeEqualStr(env[OWNER_TOKEN_ENV].trim(), supplied)) {
      clearFailedAuthAttempts(ipKey);
      return { allowed: true, reason: 'bearer_ok' };
    }
    recordFailedAuthAttempt(ipKey);
    return { allowed: false, reason: 'invalid_bearer_token' };
  }
  // بديل البصمة: نقارن هاش المقدَّم بالهاش المضبوط.
  if (timingSafeEqualStr(env[OWNER_TOKEN_HASH_ENV].trim().toLowerCase(), sha256Hex(supplied))) {
    clearFailedAuthAttempts(ipKey);
    return { allowed: true, reason: 'bearer_ok' };
  }
  recordFailedAuthAttempt(ipKey);
  return { allowed: false, reason: 'invalid_bearer_token' };
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
    hosted: info.hosted,
    protectedPaths: info.protectedPaths,
  };
}

/**
 * F-23 (مراجعة): تحذير إقلاع واضح — يُطبع عند الإقلاع فقط. يوضّح أن علم تعطيل
 * المصادقة **مُتجاهَل** في بيئة الاستضافة حتى لو ضُبط. لا يكشف أي سرّ (أسماء فقط).
 */
export function recoveryAuthStartupWarning(env = process.env) {
  const info = inspectRecoveryOwnerAuth(env);
  if (info.hosted && info.allowUnauthenticatedRequested) {
    return '⚠️  RECOVERY_CENTER_ALLOW_UNAUTHENTICATED مضبوط=true لكنه **مُتجاهَل** في بيئة '
      + 'الاستضافة (RENDER/RECOVERY_CENTER_HOSTED): المصادقة تبقى مطلوبة (fail-closed). '
      + 'هذا العلم للوضع المحلي فقط.';
  }
  if (info.hosted && !info.configured) {
    return '⚠️  مركز الاستعادة في بيئة استضافة بلا RECOVERY_CENTER_OWNER_TOKEN مضبوط: '
      + 'المسارات الحسّاسة مقيّدة بـfail-closed (401) حتى يُضبط المفتاح.';
  }
  return null;
}
