/**
 * تفويض Google Drive — منفصل تماماً عن تسجيل الدخول إلى التطبيق.
 *
 * النطاق الوحيد المسموح: `drive.file` (وصول للتطبيقات/الملفات التي أنشأها
 * التطبيق فقط). أي محاولة لاستخدام `auth/drive` الكامل أو نطاق قراءة عام تُرفض
 * صراحةً قبل توليد الرابط أو تنفيذ الطلب.
 *
 * التفويض يستخدم: offline + drive.file + state + حماية CSRF + state أحادي
 * الاستخدام + TTL. رمز التجديد يُخزَّن مشفّراً فقط (AES-256-GCM) ولا يظهر في
 * Git ولا logs ولا manifest ولا أي ملف نصي.
 *
 * يعتمد على google-auth-library (OAuth2Client) وgaxios، وكلاهما قابل للحقن
 * بناقل وهمي في الاختبارات فلا يُلمس Google الحقيقي.
 */

import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import {
  DRIVE_FILE_SCOPE,
  DRIVE_FORBIDDEN_SCOPES,
  DRIVE_OAUTH_CLIENT_ID_ENV,
  DRIVE_OAUTH_CLIENT_SECRET_ENV,
  DRIVE_OAUTH_REFRESH_TOKEN_ENV,
  DRIVE_OAUTH_REDIRECT_URI,
} from './cloud-lib.mjs';
import { settleWithTimeout, DRIVE_TOKEN_TIMEOUT_MS, envTimeoutMs } from './drive-timeouts.mjs';

export const DRIVE_TOKEN_ENCRYPTION_KEY_ENV = 'DRIVE_TOKEN_ENCRYPTION_KEY';
export const DRIVE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const DRIVE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

// ---------------------------------------------------------------------------
// فرض النطاق
// ---------------------------------------------------------------------------

/**
 * يتحقق أن مجموعة النطاقات تحوي `drive.file` فقط ولا تحوي أي نطاق ممنوع.
 * يُستدعى عند التوليد وعند العودة من Google (على النطاق الممنوح فعلاً).
 */
export function enforceDriveFileScope(scopes) {
  const list = (Array.isArray(scopes) ? scopes : String(scopes ?? '').split(/[\s,]+/)).filter(Boolean);
  const forbidden = list.filter((s) => DRIVE_FORBIDDEN_SCOPES.includes(s));
  if (forbidden.length) {
    return { ok: false, code: 'forbidden_scope', forbidden, message: 'ممنوع استخدام صلاحية Drive الكاملة أو نطاق قراءة عام.' };
  }
  const hasFile = list.includes(DRIVE_FILE_SCOPE);
  if (!hasFile) {
    return { ok: false, code: 'missing_drive_file_scope', scopes: list, message: 'يلزم نطاق drive.file حصراً.' };
  }
  return { ok: true, scopes: list };
}

// ---------------------------------------------------------------------------
// تشفير رمز التجديد (AES-256-GCM) — لا يُخزَّن إلا مشفّراً
// ---------------------------------------------------------------------------

/** يفكّ مفتاح التشفير: 64 محرف hex أو Base64 يمثّل 32 بايت بالضبط. */
export function decodeTokenEncryptionKey(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  let buf = null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    buf = Buffer.from(value, 'hex');
  } else {
    try {
      buf = Buffer.from(value, 'base64');
    } catch {
      buf = null;
    }
  }
  if (!buf || buf.length !== 32) return null;
  return buf;
}

export function inspectTokenEncryptionKey(env = process.env) {
  const raw = env[DRIVE_TOKEN_ENCRYPTION_KEY_ENV];
  if (!raw) return { state: 'missing', envName: DRIVE_TOKEN_ENCRYPTION_KEY_ENV, acceptedBytes: 32, reason: 'المفتاح غير مضبوط.' };
  const key = decodeTokenEncryptionKey(raw);
  if (!key) return { state: 'invalid', envName: DRIVE_TOKEN_ENCRYPTION_KEY_ENV, acceptedBytes: 32, reason: 'المفتاح مضبوط لكن غير صالح (يلزم 32 بايت hex أو Base64).' };
  return { state: 'valid', envName: DRIVE_TOKEN_ENCRYPTION_KEY_ENV, acceptedBytes: 32, reason: null };
}

/** يشفّر رمز تجديد → كائن مشفّر. لا يُسجَّل ولا يُعاد كنص صريح. */
export function encryptDriveSecret(value, env = process.env) {
  const key = decodeTokenEncryptionKey(env[DRIVE_TOKEN_ENCRYPTION_KEY_ENV]);
  if (!key) throw new Error(inspectTokenEncryptionKey(env).reason);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: encrypted.toString('base64url'),
  };
}

/** يفكّ كائناً مشفّراً إلى رمز. يعيد null عند الفشل بلا رمي. */
export function decryptDriveSecret(record, env = process.env) {
  try {
    const key = decodeTokenEncryptionKey(env[DRIVE_TOKEN_ENCRYPTION_KEY_ENV]);
    if (!key || !record || record.alg !== 'aes-256-gcm') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(record.data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * يقصّ المسافات/الأسطر/علامات التنصيص من قيمة بيئة.
 * Render قد يُدخل مسافة أو سطراً زائداً، والمكتبة ترسل القيمة حرفياً فتنتج
 * `client_id=...com+` أو إسقاط `client_secret` — وكلاهما يرد `invalid_client`.
 */
export function trimmedEnvValue(value) {
  if (typeof value !== 'string') return value;
  return value.trim().replace(/^["']|["']$/g, '').trim();
}

/** يقرأ إعداد التفويض من البيئة (بلا كشف أي قيمة، بعد قصّ المسافات). */
export function inspectDriveAuthEnv(env = process.env) {
  const clientId = trimmedEnvValue(env[DRIVE_OAUTH_CLIENT_ID_ENV]);
  const clientSecret = trimmedEnvValue(env[DRIVE_OAUTH_CLIENT_SECRET_ENV]);
  const refreshToken = trimmedEnvValue(env[DRIVE_OAUTH_REFRESH_TOKEN_ENV]);
  return {
    clientIdConfigured: Boolean(clientId),
    clientSecretConfigured: Boolean(clientSecret),
    refreshTokenConfigured: Boolean(refreshToken),
    redirectUri: DRIVE_OAUTH_REDIRECT_URI,
    scope: DRIVE_FILE_SCOPE,
    tokenEncryptionKey: inspectTokenEncryptionKey(env).state,
    /** التفويض الكامل جاهز فقط عند وجود الثلاثة (بلا إظهار قيمها). */
    configured: Boolean(clientId && clientSecret),
  };
}

/** هل القيمة تبدو معرّف عميل Google OAuth فعلاً؟ */
export function looksLikeGoogleClientId(value) {
  return typeof value === 'string' && /\.apps\.googleusercontent\.com$/.test(value);
}

/**
 * يحسم اعتماد عميل OAuth المستخدم فعلاً. الأولوية لـDRIVE_*، وإن كان معرّفها
 * مفقوداً أو ليس معرّف Google صالحاً (وُجد خطأ شائع: قيمة مشروع آخر بطول 64)،
 * يُستخدم اعتماد Google القائم (نفس تطبيق Cloud: GOOGLE_OAUTH_*). هذا يمنع
 * `invalid_client` من قيمة بيئة ملوّثة بلا مطالبة المالك بأي سرّ.
 * يعيد أيضاً مصدر كل قيمة (drive/google) وبصمة المعرّف — بلا أي قيمة سرّية.
 */
export function resolveDriveClientCredentials(env = process.env) {
  const driveId = trimmedEnvValue(env[DRIVE_OAUTH_CLIENT_ID_ENV]);
  const driveSecret = trimmedEnvValue(env[DRIVE_OAUTH_CLIENT_SECRET_ENV]);
  const googleId = trimmedEnvValue(env.GOOGLE_OAUTH_CLIENT_ID);
  const googleSecret = trimmedEnvValue(env.GOOGLE_OAUTH_CLIENT_SECRET);
  const driveIdValid = looksLikeGoogleClientId(driveId);
  if (driveId && driveIdValid) {
    return { clientId: driveId, clientSecret: driveSecret, clientIdSource: 'drive', clientSecretSource: 'drive' };
  }
  if (googleId && looksLikeGoogleClientId(googleId)) {
    // معرّف DRIVE إمّا مفقود أو غير صالح => نتبنّى اعتماد Google القائم.
    return {
      clientId: googleId,
      clientSecret: googleSecret || driveSecret || null,
      clientIdSource: 'google_fallback',
      clientSecretSource: googleSecret ? 'google_fallback' : (driveSecret ? 'drive' : 'missing'),
      driveClientIdIgnored: Boolean(driveId),
    };
  }
  // لا يوجد معرّف Google صالح في أي منهما => نُبقي قيمة DRIVE كما هي (قد تكون معرّفاً رقمياً).
  return { clientId: driveId || null, clientSecret: driveSecret || null, clientIdSource: driveId ? 'drive' : 'missing', clientSecretSource: driveSecret ? 'drive' : 'missing' };
}

/**
 * فحص آمن لاعتماد OAuth Client (بلا كشف أي قيمة سرّية):
 * الوجود، الطول، هل كانت هناك مسافة زائدة، صيغة المعرّف، وبصمة SHA-256 مقتطعة،
 * ومصدر المعرّف المستخدم فعلاً (drive/google_fallback) ومقارنة البصمات.
 */
export function inspectDriveOAuthClient(env = process.env) {
  const rawId = env[DRIVE_OAUTH_CLIENT_ID_ENV];
  const rawSecret = env[DRIVE_OAUTH_CLIENT_SECRET_ENV];
  const id = trimmedEnvValue(rawId);
  const secret = trimmedEnvValue(rawSecret);
  const resolved = resolveDriveClientCredentials(env);
  const idLooksLikeGoogle = looksLikeGoogleClientId(id);
  const idIsNumeric = typeof id === 'string' && /^\d{6,25}$/.test(id);
  const clientIdFormat = !id ? 'missing' : idLooksLikeGoogle ? 'google_client_id' : idIsNumeric ? 'numeric_app_id' : 'unknown_format';
  const fp = (v) => (v ? crypto.createHash('sha256').update(v).digest('hex').slice(0, 12) : null);
  return {
    clientIdPresent: Boolean(id),
    clientSecretPresent: Boolean(secret),
    clientIdHadWhitespace: typeof rawId === 'string' && rawId !== id,
    clientSecretHadWhitespace: typeof rawSecret === 'string' && rawSecret !== secret,
    clientIdLength: id ? id.length : 0,
    clientSecretLength: secret ? secret.length : 0,
    clientIdFormat,
    clientIdFingerprint: fp(id),
    /** المعرّف المستخدم فعلاً + مصدره (قد يكون Google عند تجاهل قيمة DRIVE غير الصالحة). */
    effectiveClientIdSource: resolved.clientIdSource,
    effectiveClientIdFingerprint: fp(resolved.clientId),
    driveClientIdIgnored: Boolean(resolved.driveClientIdIgnored),
    googleFallbackAvailable: looksLikeGoogleClientId(trimmedEnvValue(env.GOOGLE_OAUTH_CLIENT_ID)),
    effectiveClientIdLooksLikeGoogle: looksLikeGoogleClientId(resolved.clientId),
  };
}

// ---------------------------------------------------------------------------
// عميل OAuth
// ---------------------------------------------------------------------------

/**
 * ينشئ OAuth2Client. `transporter` قابل للحقن ليُختبر بلا شبكة.
 */
export function createDriveOAuthClient(options = {}) {
  const env = options.env || process.env;
  // القيم الصريحة (اختبار/حقن) تُقدَّم كما هي؛ وإلا يُحسم الاعتماد الفعّال من البيئة
  // (مع تجاوز قيمة DRIVE غير الصالحة إلى اعتماد Google القائم بلا مطالبة بأي سرّ).
  const explicitId = options.clientId != null ? trimmedEnvValue(options.clientId) : null;
  const explicitSecret = options.clientSecret != null ? trimmedEnvValue(options.clientSecret) : null;
  const resolved = (explicitId || explicitSecret)
    ? { clientId: explicitId ?? trimmedEnvValue(env[DRIVE_OAUTH_CLIENT_ID_ENV]), clientSecret: explicitSecret ?? trimmedEnvValue(env[DRIVE_OAUTH_CLIENT_SECRET_ENV]) }
    : resolveDriveClientCredentials(env);
  const clientId = resolved.clientId;
  const clientSecret = resolved.clientSecret;
  const redirectUri = options.redirectUri ?? DRIVE_OAUTH_REDIRECT_URI;
  if (!clientId && !clientSecret) {
    return { ok: false, code: 'client_missing', message: 'DRIVE_OAUTH_CLIENT_ID و DRIVE_OAUTH_CLIENT_SECRET غير مضبوطين.' };
  }
  if (!clientId) {
    return { ok: false, code: 'client_missing', message: 'DRIVE_OAUTH_CLIENT_ID غير مضبوط.' };
  }
  if (!clientSecret) {
    return { ok: false, code: 'client_secret_missing', message: 'DRIVE_OAUTH_CLIENT_SECRET غير مضبوط.' };
  }
  const endpoints = options.endpoints ? { ...options.endpoints } : {};
  // تجاوز عنوان نقطة الرمز/التفويض من البيئة (اختبار/تشخيص) يسمح بتوجيه تجديد
  // الرمز إلى خادم وهمي محلي بلا لمس Google الحقيقي، وبقاء الافتراضي عند غيابه.
  const tokenUrl = options.tokenUrl || (env.DRIVE_OAUTH_TOKEN_URL || null);
  const authUrl = options.authUrl || (env.DRIVE_OAUTH_AUTH_URL || null);
  if (tokenUrl) endpoints.oauth2TokenUrl = tokenUrl;
  if (authUrl) endpoints.oauth2AuthBaseUrl = authUrl;
  const client = new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri,
    transporter: options.transporter,
    endpoints: Object.keys(endpoints).length ? endpoints : undefined,
  });
  return { ok: true, client };
}

// ---------------------------------------------------------------------------
// رابط التفويض (offline + drive.file + state)
// ---------------------------------------------------------------------------

/** يولّد رابط التفويض بنطاق drive.file حصراً، بلا أي نطاق ممنوع. */
export function buildDriveAuthorizationUrl(options = {}) {
  const env = options.env || process.env;
  const scopeCheck = enforceDriveFileScope(options.scopes ?? [DRIVE_FILE_SCOPE]);
  if (!scopeCheck.ok) return scopeCheck;
  const created = createDriveOAuthClient({ ...options, env });
  if (!created.ok) return created;
  const url = created.client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [DRIVE_FILE_SCOPE],
    state: options.state,
    redirect_uri: options.redirectUri ?? DRIVE_OAUTH_REDIRECT_URI,
    include_granted_scopes: false,
  });
  return { ok: true, url, scope: DRIVE_FILE_SCOPE, redirectUri: options.redirectUri ?? DRIVE_OAUTH_REDIRECT_URI };
}

// ---------------------------------------------------------------------------
// تبادل الرمز وتجديده
// ---------------------------------------------------------------------------

/**
 * تصنيف خطأ التجديد/التبادل إلى كود دقيق (بلا خلط).
 * ملاحظة: لا يُعاد كود `unauthorized` هنا إطلاقاً — كان يخفي السبب الحقيقي.
 */
function classifyTokenError(err) {
  const data = err?.response?.data || {};
  const error = data.error || err?.code || '';
  const status = Number(err?.response?.status ?? err?.status ?? 0);
  const providerCode = String(error || '').slice(0, 60) || null;
  if (String(error) === 'invalid_grant') return { ok: false, code: 'invalid_grant', status, providerCode, message: 'رمز التجديد مرفوض (invalid_grant): يلزم تفويض جديد.' };
  if (String(error) === 'invalid_client') return { ok: false, code: 'invalid_client', status, providerCode, message: 'بيانات اعتماد Google Drive غير متطابقة مع التفويض الحالي.' };
  if (String(error) === 'invalid_request') return { ok: false, code: 'invalid_request', status, providerCode, message: 'طلب تجديد غير سليم لدى Google (invalid_request).' };
  if (status === 401) return { ok: false, code: 'token_refresh_unauthorized', status, providerCode, message: `رفض Google طلب التجديد (401${providerCode ? ` — ${providerCode}` : ''}).` };
  if (status >= 500) return { ok: false, code: 'server_error', status, message: 'عطل مؤقت لدى Google.' };
  if (!status) return { ok: false, code: 'network_error', status: 0, message: 'تعذّر الوصول إلى Google.' };
  return { ok: false, code: 'token_refresh_other_error', status, message: 'فشل تبادل/تجديد الرمز.' };
}

/**
 * فحص تشخيصي للقراءة فقط لرمز التجديد — لا يكتب شيئاً إلى Google Drive،
 * ولا يغيّر الرمز، ولا يُعيد أي قيمة سرّية. يوضّح سبب الفشل بدقة.
 *
 * @param {{ encrypted?: any, env?: Record<string,string|undefined>, refreshToken?: string, transporter?: any }} options
 */
export async function diagnoseDriveRefreshToken(options = {}) {
  const env = options.env || process.env;
  const encrypted = options.encrypted ?? null;
  const stored = Boolean(encrypted);
  const clientInfo = inspectDriveOAuthClient(env);
  if (!stored) {
    return { stored: false, decryptable: false, providerRefresh: 'not_tested', reason: 'no_refresh_token', message: 'لا رمز تجديد مخزّن.' };
  }
  let plain = options.refreshToken ?? null;
  let decryptable = false;
  if (!plain) {
    plain = decryptDriveSecret(encrypted, env);
    decryptable = typeof plain === 'string' && plain.length > 0;
    if (!decryptable) {
      return { stored: true, decryptable: false, providerRefresh: 'not_tested', reason: 'refresh_token_undecryptable', message: 'رمز التجديد المخزّن لا يُفكّ بالمفتاح الحالي.' };
    }
  } else {
    decryptable = true;
  }
  if (!clientInfo.clientIdPresent) {
    return { stored: true, decryptable, providerRefresh: 'failed', reason: 'client_missing', message: 'DRIVE_OAUTH_CLIENT_ID غير مضبوط.' };
  }
  if (!clientInfo.clientSecretPresent) {
    return { stored: true, decryptable, providerRefresh: 'failed', reason: 'client_secret_missing', message: 'DRIVE_OAUTH_CLIENT_SECRET غير مضبوط.' };
  }
  // طلب تجديد واحد فعلي (بلا أي عملية Drive، بلا كتابة، بلا تغيير الرمز).
  const refreshed = await refreshDriveAccessToken(plain, { env, transporter: options.transporter });
  if (refreshed.ok && refreshed.accessToken) {
    return { stored: true, decryptable, providerRefresh: 'ok', reason: 'token_refresh_ok', message: 'جلب Google رمز وصول بنجاح.' };
  }
  return {
    stored: true,
    decryptable,
    providerRefresh: 'failed',
    reason: refreshed.code || 'token_refresh_other_error',
    // كود المزوّد ورمز HTTP (بلا أي قيمة سرّية) لتحديد السبب الدقيق بلا تخمين.
    providerCode: refreshed.providerCode ?? null,
    httpStatus: refreshed.status ?? null,
    message: refreshed.message || 'فشل تجديد الرمز.',
  };
}

/** يبادل authorization code برموز (offline => refresh_token). لا يخزّن شيئاً. */
export async function exchangeDriveAuthCode(code, options = {}) {
  const created = createDriveOAuthClient(options);
  if (!created.ok) return created;
  if (!code) return { ok: false, code: 'missing_code', message: 'رمز التفويض مفقود.' };
  try {
    const { tokens } = await created.client.getToken({
      code,
      redirect_uri: options.redirectUri ?? DRIVE_OAUTH_REDIRECT_URI,
    });
    const scopeCheck = enforceDriveFileScope(tokens.scope || [DRIVE_FILE_SCOPE]);
    if (!scopeCheck.ok) return scopeCheck;
    return {
      ok: true,
      accessToken: tokens.access_token || null,
      refreshToken: tokens.refresh_token || null,
      scope: scopeCheck.scopes,
      expiryDate: tokens.expiry_date || null,
    };
  } catch (err) {
    return classifyTokenError(err);
  }
}

/** يجدّد رمز الوصول من refresh token. يعيد تصنيفاً صريحاً عند الفشل. */
export async function refreshDriveAccessToken(refreshToken, options = {}) {
  const created = createDriveOAuthClient(options);
  if (!created.ok) return created;
  if (!refreshToken) return { ok: false, code: 'missing_refresh_token', message: 'رمز التجديد مفقود.' };
  try {
    // المكتبة تتطلّب ضبط الرمز في credentials قبل التجديد.
    created.client.credentials = { refresh_token: refreshToken };
    // مهلة صريحة لاستدعاء oauth2.googleapis.com: إن تعثّر تجديد الرمز لا يبقى
    // الطلب معلّقاً بلا نهاية (كان هذا أحد مسارات تعليق رفع الفيديو).
    const tokenTimeoutMs = envTimeoutMs(options.env || process.env, 'DRIVE_TOKEN_TIMEOUT_MS', DRIVE_TOKEN_TIMEOUT_MS);
    const res = await settleWithTimeout(created.client.refreshAccessToken(), tokenTimeoutMs);
    const tokens = res.tokens || res.credentials || {};
    return {
      ok: true,
      accessToken: tokens.access_token || null,
      refreshToken: tokens.refresh_token || refreshToken,
      scope: tokens.scope || [DRIVE_FILE_SCOPE],
      expiryDate: tokens.expiry_date || null,
    };
  } catch (err) {
    // انتهاء مهلة التجديد يُعلن كخطأ شبكة عابر صريح (لا كعطل سرّ/اعتماد).
    if (err && (err.code === 'timeout' || err.name === 'AbortError')) {
      return { ok: false, code: 'network_error', status: 0, message: 'انتهت مهلة تجديد رمز Drive.' };
    }
    return classifyTokenError(err);
  }
}

/**
 * مزوّد الرمز: يجلب رمز وصول من رمز تجديد مشفّر (أو من البيئة).
 * يُحقن في DriveClient كـtokenProvider. لا يُعيد الرمز إلا للاستخدام الفوري.
 */
export function createRefreshTokenProvider(options = {}) {
  const env = options.env || process.env;
  let cached = { token: null, expiry: 0 };
  return async function tokenProvider() {
    const now = Date.now();
    if (cached.token && cached.expiry - now > 60_000) return cached.token;
    const plain = options.refreshToken
      ?? (options.encryptedRefreshToken ? decryptDriveSecret(options.encryptedRefreshToken, env) : null)
      ?? env[DRIVE_OAUTH_REFRESH_TOKEN_ENV]
      ?? null;
    if (!plain) throw Object.assign(new Error('no_refresh_token'), { code: 'no_refresh_token' });
    const refreshed = await refreshDriveAccessToken(plain, options);
    if (!refreshed.ok || !refreshed.accessToken) throw Object.assign(new Error(refreshed.code || 'token_refresh_other_error'), { code: refreshed.code, providerCode: refreshed.providerCode ?? null, httpStatus: refreshed.status ?? null });
    cached = { token: refreshed.accessToken, expiry: refreshed.expiryDate || now + 3_600_000 };
    return cached.token;
  };
}
