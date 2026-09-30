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

/** يقرأ إعداد التفويض من البيئة (بلا كشف أي قيمة). */
export function inspectDriveAuthEnv(env = process.env) {
  const clientId = env[DRIVE_OAUTH_CLIENT_ID_ENV];
  const clientSecret = env[DRIVE_OAUTH_CLIENT_SECRET_ENV];
  const refreshToken = env[DRIVE_OAUTH_REFRESH_TOKEN_ENV];
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

// ---------------------------------------------------------------------------
// عميل OAuth
// ---------------------------------------------------------------------------

/**
 * ينشئ OAuth2Client. `transporter` قابل للحقن ليُختبر بلا شبكة.
 */
export function createDriveOAuthClient(options = {}) {
  const env = options.env || process.env;
  const clientId = options.clientId ?? env[DRIVE_OAUTH_CLIENT_ID_ENV];
  const clientSecret = options.clientSecret ?? env[DRIVE_OAUTH_CLIENT_SECRET_ENV];
  const redirectUri = options.redirectUri ?? DRIVE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret) {
    return { ok: false, code: 'not_configured', message: 'DRIVE_OAUTH_CLIENT_ID/SECRET غير مضبوطين.' };
  }
  const endpoints = options.endpoints ? { ...options.endpoints } : undefined;
  if (options.tokenUrl) endpoints.oauth2TokenUrl = options.tokenUrl;
  if (options.authUrl) endpoints.oauth2AuthBaseUrl = options.authUrl;
  const client = new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri,
    transporter: options.transporter,
    endpoints,
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

function classifyTokenError(err) {
  const data = err?.response?.data || {};
  const error = data.error || err?.code || '';
  const status = Number(err?.response?.status ?? err?.status ?? 0);
  if (String(error) === 'invalid_grant') return { ok: false, code: 'refresh_failure', status, message: 'رمز التجديد مرفوض (invalid_grant): يلزم تفويض جديد.' };
  if (status === 401 || String(error) === 'invalid_client') return { ok: false, code: 'unauthorized', status, message: 'اعتماد OAuth مرفوض.' };
  if (status >= 500) return { ok: false, code: 'server_error', status, message: 'عطل مؤقت لدى Google.' };
  if (!status) return { ok: false, code: 'network_error', status: 0, message: 'تعذّر الوصول إلى Google.' };
  return { ok: false, code: 'token_error', status, message: 'فشل تبادل/تجديد الرمز.' };
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
    const res = await created.client.refreshAccessToken();
    const tokens = res.tokens || res.credentials || {};
    return {
      ok: true,
      accessToken: tokens.access_token || null,
      refreshToken: tokens.refresh_token || refreshToken,
      scope: tokens.scope || [DRIVE_FILE_SCOPE],
      expiryDate: tokens.expiry_date || null,
    };
  } catch (err) {
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
    if (!plain) throw Object.assign(new Error('no_refresh_token'), { code: 'unauthorized' });
    const refreshed = await refreshDriveAccessToken(plain, options);
    if (!refreshed.ok || !refreshed.accessToken) throw Object.assign(new Error(refreshed.code || 'refresh_failure'), { code: refreshed.code });
    cached = { token: refreshed.accessToken, expiry: refreshed.expiryDate || now + 3_600_000 };
    return cached.token;
  };
}
