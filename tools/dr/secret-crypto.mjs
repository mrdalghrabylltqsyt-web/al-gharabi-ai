/**
 * حزمة الأسرار المشفّرة (secrets.enc) — تشفير/فكّ تشفير بمنطق صافٍ، بلا شبكة.
 *
 * القاعدة الملزمة:
 *  - لا يُرفع أي سرّ كنص مكشوف: كل الأسرار تُشفَّر AES-256-GCM قبل الرفع.
 *  - المفتاح الرئيسي (Recovery Master Key) **لا يوجد داخل النسخة أبداً**.
 *  - الحزمة منفصلة تماماً عن source mirror وعن database.enc.
 *  - لا تُطبع أي قيمة سرّية في السجل أو الأخطاء.
 *
 * المفتاح: `DR_RECOVERY_MASTER_KEY` (المفضّل) ثم `DRIVE_DB_BACKUP_KEY` (نفس مفتاح
 * نسخة قاعدة البيانات، لتفادي متغيّر جديد إلزامي على الإنتاج). الصيغ المقبولة:
 * 64 محرف hex أو Base64 يمثّل 32 بايت بالضبط.
 *
 * اكتشاف أسماء المتغيّرات: من مفاتيح بيئة الخادم الفعلية بقائمة مرشّحات صريحة،
 * بلا افتراض أسماء غير موجودة. يُستبعد أي متغيّر تشغيلي/داخلي (Render/Node/DR نفسه).
 */

import crypto from 'node:crypto';
import {
  SECRETS_PACKAGE_MAGIC,
  SECRETS_PACKAGE_VERSION,
  hashContent,
  isEncryptedSecretsPackage,
  buildSecretsPackageManifest,
} from './cloud-lib.mjs';

export const MASTER_KEY_ENV = 'DR_RECOVERY_MASTER_KEY';
export const MASTER_KEY_FALLBACK_ENV = 'DRIVE_DB_BACKUP_KEY';
export const MASTER_KEY_LAST_FALLBACK_ENV = 'DRIVE_TOKEN_ENCRYPTION_KEY';
export const MASTER_KEY_ENV_NAMES = [MASTER_KEY_ENV, MASTER_KEY_FALLBACK_ENV, MASTER_KEY_LAST_FALLBACK_ENV];

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

/** متغيّرات لا تُعدّ أسراراً تشغيلية (مفاتيح داخلية لبيئة Render/Node أو لمنظومة DR). */
const NON_SECRET_ENV = new Set([
  'NODE_ENV', 'NODE_VERSION', 'PORT', 'HOST', 'TZ', 'PATH', 'HOME', 'PWD', 'SHELL',
  'TERM', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'SHLVL', 'TMPDIR', 'PWD',
  'RENDER', 'RENDER_EXTERNAL_URL', 'RENDER_EXTERNAL_HOSTNAME', 'RENDER_GIT_COMMIT',
  'RENDER_GIT_BRANCH', 'RENDER_GIT_REPO_SLUG', 'RENDER_SERVICE_ID', 'RENDER_SERVICE_NAME',
  'IS_PULL_REQUEST', 'RENDER_INSTANCE_ID', 'RENDER_REGION', 'RENDER_DISK_PATH',
  'RENDER_DISK_MOUNT_PATH', 'RENDER', 'NODE_OPTIONS', 'npm_config_registry',
  'STATE_DIR', 'STATE_WRITABLE', 'PUBLIC_URL', 'GIT_COMMIT', 'GIT_BRANCH',
  'AI_TIMEOUT_MS', 'GEMINI_DAILY_LIMIT', 'GEMINI_FREE_TIER_PROTECTION',
  'TIKTOK_VERIFICATION_ECHO', 'META_ALLOW_SCOPE_WITHOUT_CONFIG',
  'INSTAGRAM_OAUTH_ONBOARDING', 'YOUTUBE_COMMENT_SCAN_VIDEO_LIMIT',
  'TIKTOK_VERIFICATION_TOKEN', 'GHARABI_PREVIEW_TOKEN', 'GHARABI_REPOSITORY',
  'DR_RECOVERY_MASTER_KEY', 'DRIVE_DB_BACKUP_KEY', 'DRIVE_TOKEN_ENCRYPTION_KEY',
  'DRIVE_OAUTH_CLIENT_ID', 'DRIVE_OAUTH_CLIENT_SECRET', 'DRIVE_OAUTH_REFRESH_TOKEN',
  'DRIVE_OAUTH_SCOPES', 'DATABASE_URL', 'DR_RECOVERY_TEST_DATABASE_URL',
  'DRIVE_API_BASE', 'DRIVE_FOLDER_NAME',
]);

/** هل الاسم مؤهّل لأن يكون سرّاً تشغيلياً؟ (اسم صريح أو نمط سرّ معروف). */
export function isSecretEnvName(name) {
  const n = String(name ?? '').trim();
  if (!n || NON_SECRET_ENV.has(n)) return false;
  if (!/^[A-Z][A-Z0-9_]*$/.test(n)) return false;
  if (/_?(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIALS?)$/.test(n)) return true;
  if (/^(DATABASE_URL|REDIS_URL|SMTP_URL|.*_DSN)$/.test(n)) return true;
  return false;
}

/**
 * يستكشف أسماء الأسرار الموجودة فعلاً في بيئة الخادم. يعيد الأسماء فقط (بلا قيم).
 * لا يخترع أسماء غير موجودة.
 */
export function discoverSecretEnvNames(env = process.env) {
  const names = [];
  for (const key of Object.keys(env || {})) {
    if (env[key] == null || String(env[key]).length === 0) continue;
    if (isSecretEnvName(key)) names.push(key);
  }
  return names.sort();
}

/** يفكّ المفتاح الرئيسي: 64 hex أو Base64 يمثّل 32 بايت بالضبط (بلا تسامح صامت). */
export function decodeMasterKey(raw) {
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

/** يحسم المفتاح الرئيسي من البيئة (DR_RECOVERY_MASTER_KEY ثم DRIVE_DB_BACKUP_KEY ثم DRIVE_TOKEN_ENCRYPTION_KEY). */
export function resolveMasterKey(env = process.env) {
  const primary = decodeMasterKey(env[MASTER_KEY_ENV]);
  if (primary) return { ok: true, key: primary, source: MASTER_KEY_ENV };
  const fallback = decodeMasterKey(env[MASTER_KEY_FALLBACK_ENV]);
  if (fallback) return { ok: true, key: fallback, source: MASTER_KEY_FALLBACK_ENV };
  const last = decodeMasterKey(env[MASTER_KEY_LAST_FALLBACK_ENV]);
  if (last) return { ok: true, key: last, source: MASTER_KEY_LAST_FALLBACK_ENV };
  return {
    ok: false,
    reason: 'master_key_missing',
    message: `مفتاح الاستعادة الرئيسي غير مضبوط أو غير صالح (يلزم 32 بايت في ${MASTER_KEY_ENV}).`,
    envNames: MASTER_KEY_ENV_NAMES,
  };
}

/** حالة كل متغيّر مفتاح على حدة (بلا أي قيمة سرّية): مضبوط؟ صالح؟ طوله؟ بصمته؟ */
export function inspectMasterKeyNames(env = process.env) {
  return MASTER_KEY_ENV_NAMES.map((name) => {
    const raw = env[name];
    const present = raw != null && String(raw).length > 0;
    const bytes = present ? decodeMasterKey(raw) : null;
    return {
      name,
      present,
      valid: Boolean(bytes),
      length: present ? String(raw).trim().length : 0,
      fingerprint: bytes ? keyFingerprint(bytes) : null,
    };
  });
}

/** حالة المفتاح الرئيسي (بلا أي قيمة سرّية). */
export function inspectMasterKey(env = process.env) {
  const resolved = resolveMasterKey(env);
  const anySet = MASTER_KEY_ENV_NAMES.some((n) => env[n]);
  return {
    state: resolved.ok ? 'valid' : (anySet ? 'invalid' : 'missing'),
    envNames: MASTER_KEY_ENV_NAMES,
    // تشخيص صريح لكل متغيّر (غياب vs عدم صلاحية) بلا كشف أي قيمة.
    perKey: inspectMasterKeyNames(env),
    source: resolved.ok ? resolved.source : null,
    acceptedBytes: 32,
    reason: resolved.ok ? null : resolved.reason,
  };
}

/** بصمة المفتاح (أول 12 محرفاً من sha256 للمفتاح) — تكشف التطابق بلا كشف المفتاح. */
export function keyFingerprint(keyBuf) {
  return crypto.createHash('sha256').update(keyBuf).digest('hex').slice(0, 12);
}

/**
 * يبني حزمة الأسرار المشفّرة من خريطة `{ NAME: value }`.
 * الصيغة: سطر magic + encrypted/cipher/kdf + salt + iv + tag + سطر data واحد.
 * كل القيم داخل ciphertext واحد فلا يظهر أي اسم/قيمة كنص.
 */
export function encryptSecretsPackage(secrets, env = process.env) {
  const resolved = resolveMasterKey(env);
  if (!resolved.ok) return { ok: false, code: resolved.reason, message: resolved.message };
  const plain = JSON.stringify(secrets && typeof secrets === 'object' ? secrets : {});
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(resolved.key, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = [
    SECRETS_PACKAGE_MAGIC,
    'encrypted: true',
    'cipher: aes-256-gcm',
    `kdf: scrypt-N${SCRYPT_N}-r${SCRYPT_R}-p${SCRYPT_P}`,
    `keyFingerprint: ${keyFingerprint(resolved.key)}`,
    `salt: ${salt.toString('base64')}`,
    `iv: ${iv.toString('base64')}`,
    `tag: ${tag.toString('base64')}`,
    `data: ${ciphertext.toString('base64')}`,
    '',
  ].join('\n');
  if (!isEncryptedSecretsPackage(payload)) {
    return { ok: false, code: 'encrypt_failed_verification', message: 'الناتج لم يطابق شكل حزمة الأسرار المشفّرة.' };
  }
  return { ok: true, payload, keyFingerprint: keyFingerprint(resolved.key), source: resolved.source, count: Object.keys(secrets || {}).length };
}

/** يفكّ حزمة الأسرار. يعيد الخريطة الأصلية أو فشلاً صريحاً (مفتاح خاطئ/تلف). */
export function decryptSecretsPackage(text, env = process.env) {
  const resolved = resolveMasterKey(env);
  if (!resolved.ok) return { ok: false, code: resolved.reason, message: resolved.message };
  const raw = Buffer.isBuffer(text) ? text.toString('utf8') : String(text ?? '');
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== SECRETS_PACKAGE_MAGIC) return { ok: false, code: 'not_a_secrets_package', message: 'الملف ليس حزمة أسرار.' };
  const get = (name) => {
    const line = lines.find((l) => l.startsWith(`${name}:`));
    return line ? line.slice(name.length + 1).trim() : null;
  };
  const salt = get('salt');
  const iv = get('iv');
  const tag = get('tag');
  const data = get('data');
  if (!salt || !iv || !tag || !data) return { ok: false, code: 'malformed_package', message: 'بنية حزمة الأسرار ناقصة.' };
  try {
    const key = crypto.scryptSync(resolved.key, Buffer.from(salt, 'base64'), SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    return { ok: true, secrets: JSON.parse(plain) };
  } catch {
    return { ok: false, code: 'decrypt_failed', message: 'فشل فكّ تشفير الأسرار (مفتاح خاطئ أو بيانات تالفة).' };
  }
}

/**
 * يبني حزمة أسرار + بيانها من البيئة الفعلية.
 * البيان يحمل الأسماء والبصمات فقط — **لا قيمة سرّية واحدة**.
 */
export function buildSecretsBundle(env = process.env, options = {}) {
  const now = options.now || new Date().toISOString();
  const names = Array.isArray(options.names) ? options.names : discoverSecretEnvNames(env);
  const secrets = {};
  const skipped = [];
  for (const name of names) {
    const value = env[name];
    if (value == null || String(value).length === 0) { skipped.push(name); continue; }
    secrets[name] = String(value);
  }
  const includedNames = Object.keys(secrets);
  if (!includedNames.length) {
    return { ok: false, code: 'no_secrets_found', message: 'لا توجد أسرار مضبوطة في بيئة الخادم: لا حزمة فارغة.' };
  }
  const encrypted = encryptSecretsPackage(secrets, env);
  if (!encrypted.ok) return encrypted;
  const payload = encrypted.payload;
  const manifest = buildSecretsPackageManifest({
    createdAt: now,
    includedNames,
    skippedNames: skipped,
    includedCount: includedNames.length,
    keyFingerprint: encrypted.keyFingerprint,
    encryptedSecretsHash: hashContent(payload),
    encryptedSecretsSize: Buffer.byteLength(payload),
    masterKeyEnvNames: MASTER_KEY_ENV_NAMES,
  });
  return { ok: true, payload, manifest, count: includedNames.length, names: includedNames, keyFingerprint: encrypted.keyFingerprint, source: encrypted.source };
}

export { SECRETS_PACKAGE_VERSION };
