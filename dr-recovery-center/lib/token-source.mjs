/**
 * الغرابي AI — مصدر رمز تجديد Drive لمركز الاستعادة المستقل.
 *
 * لماذا هذا الملف: مركز الاستعادة خدمة **مستقلة** عن تطبيق الغرابي، لكنه يحتاج
 * رمز تجديد Drive للاتصال بـ Google. نقل الرمز النصي (`DRIVE_OAUTH_REFRESH_TOKEN`)
 * إلى خدمة ثانية يعني نسخة سرّية إضافية في بيئة أخرى — وهذا سطح تسريب لا داعي له.
 *
 * الحل الآمن: رمز التجديد موجود **مشفّراً** أصلاً داخل جدول الحالة (`gharabi_state`)
 * الذي يشاركه تطبيق الغرابي ومركز الاستعادة (نفس قاعدة Neon). فيقرأ المركز **الصف
 * المشفّر فقط** ويفكّه بمفتاح التشفير نفسه (`DRIVE_TOKEN_ENCRYPTION_KEY`) الذي يحمله
 * أصلاً لفكّ نسخة قاعدة البيانات. لا رمز نصي صريح، ولا سرّ جديد، ولا مطالبة المالك
 * بأي قيمة، ولا تدوير لأي مفتاح قائم.
 *
 * الأمان:
 *   - لا يُعاد أي رمز لأي مستدعٍ إلا للاستخدام الفوري داخل مزوّد الرمز.
 *   - لا يُسجَّل أي رمز ولا قيمة سرّية؛ الأكواد والأسماء فقط.
 *   - يُقرأ جدول الحالة فقط، ولا يُكتب فيه ولا يُعدَّل أي Recovery Point.
 *   - اتصال قاعدة الحالة لقراءة الرمز **فقط**؛ لا علاقة له بقاعدة الإنتاج.
 */

import {
  DRIVE_TOKEN_ENCRYPTION_KEY_ENV,
  decryptDriveSecret,
  trimmedEnvValue,
} from './drive-auth.mjs';
import { DRIVE_OAUTH_REFRESH_TOKEN_ENV } from './cloud-lib.mjs';

/** متغيّر بيئة اتصال قاعدة الحالة (تُفضَّل قراءة الرمز منها بدل نقل نص صريح). */
export const DR_STATE_DATABASE_URL_ENV = 'DR_STATE_DATABASE_URL';
/** بديل مقبول (اسم قديم) لاتصال قاعدة الحالة. */
export const DR_STATE_DATABASE_URL_ALT_ENV = 'DR_RECOVERY_STATE_DATABASE_URL';
/** مفتاح الصف الذي يحمل كتلة التحكّم (وفيه `driveRefreshToken`). */
export const DR_STATE_CONTROL_KEY = 'control';
/** مهلة اتصال/قراءة قاعدة الحالة. */
export const DR_STATE_READ_TIMEOUT_MS = 15_000;

/** اسم جدول الحالة في Postgres (يطابق محوّل حالة الغرابي). */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** يقرأ متغيّر اتصال قاعدة الحالة (بلا كشف القيمة). */
export function stateDatabaseUrl(env = process.env) {
  return trimmedEnvValue(env[DR_STATE_DATABASE_URL_ENV]) || trimmedEnvValue(env[DR_STATE_DATABASE_URL_ALT_ENV]) || null;
}

/** هل يبدو رمز تجديد Google صالحاً شكلياً (بلا كشف القيمة)؟ */
export function looksLikeGoogleRefreshToken(value) {
  return typeof value === 'string' && value.trim().length >= 20;
}

/**
 * يقرأ رمز التجديد **المشفّر** من صف الحالة في Postgres ويفكّه بمفتاح التشفير.
 * لا يُعيد أي قيمة سرّية إلا الرمز المفكوك للاستخدام الفوري، ولا يُسجّل شيئاً.
 *
 * @returns {Promise<{ok:true, refreshToken:string, source:string, encrypted:boolean, stateKey:string}|{ok:false, code:string}>}
 */
export async function loadRefreshTokenFromDatabase(env = process.env, options = {}) {
  const url = options.databaseUrl || stateDatabaseUrl(env);
  if (!url) return { ok: false, code: 'state_db_not_configured' };
  if (!env[DRIVE_TOKEN_ENCRYPTION_KEY_ENV]) return { ok: false, code: 'token_key_missing' };

  const table = options.table || 'gharabi_state';
  if (!SAFE_IDENTIFIER.test(table)) return { ok: false, code: 'invalid_state_table' };
  const stateKey = options.stateKey || DR_STATE_CONTROL_KEY;

  const loadPg = options.loadPg || (() => import('pg'));
  let mod;
  try {
    mod = await loadPg();
  } catch {
    return { ok: false, code: 'pg_not_installed' };
  }
  const PgClient = mod?.default?.Client || mod?.Client;
  if (typeof PgClient !== 'function') return { ok: false, code: 'pg_not_installed' };

  const client = new PgClient({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: options.timeoutMs || DR_STATE_READ_TIMEOUT_MS,
  });
  try {
    await client.connect();
    const result = await client.query(`SELECT value FROM ${table} WHERE key = $1`, [stateKey]);
    const value = result?.rows?.[0]?.value ?? null;
    const encrypted = value && typeof value === 'object' ? value.driveRefreshToken : null;
    if (!encrypted) return { ok: false, code: 'refresh_token_not_found' };
    const plain = decryptDriveSecret(encrypted, env);
    if (!looksLikeGoogleRefreshToken(plain)) return { ok: false, code: 'refresh_token_undecryptable' };
    return { ok: true, refreshToken: plain, source: 'state_database', encrypted: true, stateKey };
  } catch (err) {
    // لا تُسجَّل قيمة الاتصال ولا أي سرّ؛ الكود فقط.
    return { ok: false, code: 'state_db_error', detail: String(err?.code || err?.name || 'error').slice(0, 40) };
  } finally {
    try { await client.end(); } catch { /* تجاهل */ }
  }
}

/**
 * يحسم مصدر رمز التجديد بالترتيب: صريح (اختبار/حقن) → مشفّر مُمرَّر → بيئة نصية
 * (توافق خلفي) → قاعدة الحالة المشفّرة. يعيد دائماً كوداً صريحاً عند الفشل.
 *
 * @returns {Promise<{ok:true, refreshToken:string, source:string}|{ok:false, code:string}>}
 */
export async function resolveRefreshTokenSource(env = process.env, options = {}) {
  if (options.refreshToken) {
    return { ok: true, refreshToken: String(options.refreshToken), source: 'provided' };
  }
  if (options.encryptedRefreshToken) {
    const plain = decryptDriveSecret(options.encryptedRefreshToken, env);
    if (looksLikeGoogleRefreshToken(plain)) return { ok: true, refreshToken: plain, source: 'provided_encrypted' };
    return { ok: false, code: 'refresh_token_undecryptable' };
  }
  const envToken = trimmedEnvValue(env[DRIVE_OAUTH_REFRESH_TOKEN_ENV]);
  if (looksLikeGoogleRefreshToken(envToken)) {
    return { ok: true, refreshToken: envToken, source: 'env_plaintext' };
  }
  if (options.loadFromDatabase === false) return { ok: false, code: 'no_refresh_token' };
  const db = await loadRefreshTokenFromDatabase(env, options);
  if (db.ok) return { ok: true, refreshToken: db.refreshToken, source: db.source };
  return { ok: false, code: db.code };
}

/**
 * فحص تشخيصي قراءة-فقط لمصدر الرمز (بلا أي قيمة سرّية): يُظهر أي مصدر سيُستخدم،
 * وهل قاعدة الحالة مهيّأة، والسبب الصريح عند غياب الرمز.
 */
export async function inspectRefreshTokenSource(env = process.env, options = {}) {
  const url = stateDatabaseUrl(env);
  const resolved = await resolveRefreshTokenSource(env, options);
  return {
    available: resolved.ok === true,
    source: resolved.ok ? resolved.source : null,
    code: resolved.ok ? null : resolved.code,
    stateDatabaseConfigured: Boolean(url),
    tokenKeyPresent: Boolean(env[DRIVE_TOKEN_ENCRYPTION_KEY_ENV]),
    envPlaintextPresent: Boolean(trimmedEnvValue(env[DRIVE_OAUTH_REFRESH_TOKEN_ENV])),
  };
}
