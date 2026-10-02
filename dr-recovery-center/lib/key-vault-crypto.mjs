/**
 * تشفير خزنة مفاتيح الطوارئ (Emergency Key Vault) — منطق صافٍ، بلا شبكة وبلا أسرار مكتوبة.
 *
 * الفصل الصريح عن المفاتيح الأخرى:
 *  - DR_RECOVERY_MASTER_KEY     : يفكّ secrets.enc (المفتاح الرئيسي).
 *  - DRIVE_DB_BACKUP_KEY        : يفكّ database.enc.
 *  - DRIVE_TOKEN_ENCRYPTION_KEY : يفكّ رمز تجديد Drive.
 *  - DR_RECOVERY_VAULT_KEY      : **مفتاح فتح الخزنة (هذا)** — مستقل تماماً، لا يُستخدم لغيره،
 *                                 ولا يُحفظ داخل Drive ولا source bundle ولا manifests.
 *
 * القاعدة: الخزنة تُشفَّر ككتلة واحدة (سجلات + قيم) AES-256-GCM بمفتاح مشتقّ scrypt.
 * لا تظهر أي قيمة ولا أي اسم سرّ كنص مكشوف داخل حزمة الخزنة.
 */

import crypto from 'node:crypto';
import {
  KEY_VAULT_MAGIC,
  isEncryptedKeyVaultPackage,
  hashContent,
  VAULT_KEY_ENV,
} from './cloud-lib.mjs';

export { VAULT_KEY_ENV };
export const VAULT_KEY_BYTES = 32;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

/** يفكّ مفتاح الخزنة: 64 hex أو Base64 يمثّل 32 بايت بالضبط (بلا تسامح صامت). */
export function decodeVaultKey(raw) {
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

/** بصمة المفتاح (أول 12 محرفاً من sha256) — تكشف التطابق بلا كشف المفتاح. */
export function vaultKeyFingerprint(keyBuf) {
  return crypto.createHash('sha256').update(keyBuf).digest('hex').slice(0, 12);
}

/** يحسم مفتاح الخزنة من البيئة (بلا كشف أي قيمة). */
export function resolveVaultKey(env = process.env) {
  const raw = env[VAULT_KEY_ENV];
  const key = decodeVaultKey(raw);
  if (key) return { ok: true, key, source: VAULT_KEY_ENV };
  const present = raw != null && String(raw).length > 0;
  return {
    ok: false,
    reason: present ? 'vault_key_invalid' : 'vault_key_missing',
    message: present
      ? `${VAULT_KEY_ENV} مضبوط لكن غير صالح: يلزم 32 بايت (64 hex أو Base64 يمثّل 32 بايت).`
      : `${VAULT_KEY_ENV} غير مضبوط: يلزم مفتاح 32 بايت لفتح خزنة الطوارئ.`,
    envName: VAULT_KEY_ENV,
  };
}

/** حالة مفتاح الخزنة (بلا أي قيمة سرّية): مضبوط؟ صالح؟ بصمته؟ */
export function inspectVaultKey(env = process.env) {
  const raw = env[VAULT_KEY_ENV];
  const present = raw != null && String(raw).length > 0;
  const key = present ? decodeVaultKey(raw) : null;
  return {
    envName: VAULT_KEY_ENV,
    state: key ? 'valid' : (present ? 'invalid' : 'missing'),
    present,
    valid: Boolean(key),
    length: present ? String(raw).trim().length : 0,
    fingerprint: key ? vaultKeyFingerprint(key) : null,
    acceptedBytes: VAULT_KEY_BYTES,
  };
}

/**
 * يبني سجلات الخزنة من قيم `{ NAME: value }` + خريطة التصنيف (metadata).
 * السجل يحمل metadata غير سرية + بصمة القيمة (sha256 مقتطعة) — **لا القيمة**.
 */
export function buildVaultRecords(values = {}, classify = (_name) => ({}), options = {}) {
  const now = options.now || new Date().toISOString();
  // منع الاحتواء الدائري: مفتاح فتح الخزنة لا يُدرج داخل الخزنة أبداً.
  return Object.keys(values).filter((name) => name !== VAULT_KEY_ENV).sort().map((name) => {
    const meta = classify(name) || {};
    const value = String(values[name]);
    return {
      name,
      kind: meta.kind ?? 'unknown',
      service: meta.service ?? null,
      purpose: meta.purpose ?? null,
      recoveryCritical: meta.recoveryCritical === true,
      source: meta.source ?? 'environment',
      recoverability: meta.recoverability ?? 'value',
      note: meta.note ?? null,
      fingerprint: hashContent(value).slice(0, 16),
      valueLength: value.length,
      firstSeenAt: now,
      updatedAt: now,
      version: 1,
      validity: 'present',
    };
  });
}

/** يشفّر الخزنة (السجلات + القيم) ككتلة واحدة. */
export function encryptKeyVault(records, values, env = process.env) {
  const resolved = resolveVaultKey(env);
  if (!resolved.ok) return { ok: false, code: resolved.reason, message: resolved.message };
  // دفاع مزدوج: لا يُشفَّر مفتاح الخزنة داخل حمولتها حتى لو وصل خطأً.
  const safeValues = {};
  for (const [name, value] of Object.entries(values && typeof values === 'object' ? values : {})) {
    if (name === VAULT_KEY_ENV) continue;
    safeValues[name] = value;
  }
  const payloadObj = { records: Array.isArray(records) ? records : [], values: safeValues };
  const plain = JSON.stringify(payloadObj);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(resolved.key, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = [
    KEY_VAULT_MAGIC,
    'encrypted: true',
    'cipher: aes-256-gcm',
    `kdf: scrypt-N${SCRYPT_N}-r${SCRYPT_R}-p${SCRYPT_P}`,
    `keyFingerprint: ${vaultKeyFingerprint(resolved.key)}`,
    `salt: ${salt.toString('base64')}`,
    `iv: ${iv.toString('base64')}`,
    `tag: ${tag.toString('base64')}`,
    `data: ${ciphertext.toString('base64')}`,
    '',
  ].join('\n');
  if (!isEncryptedKeyVaultPackage(payload)) {
    return { ok: false, code: 'encrypt_failed_verification', message: 'الناتج لم يطابق شكل حزمة الخزنة المشفّرة.' };
  }
  return {
    ok: true,
    payload,
    keyFingerprint: vaultKeyFingerprint(resolved.key),
    source: resolved.source,
    recordCount: payloadObj.records.length,
  };
}

/** يفكّ خزنة. يعيد `{ records, values }` أو فشلاً صريحاً (مفتاح خاطئ/تلف/عبث). */
export function decryptKeyVault(text, env = process.env) {
  const resolved = resolveVaultKey(env);
  if (!resolved.ok) return { ok: false, code: resolved.reason, message: resolved.message };
  const raw = Buffer.isBuffer(text) ? text.toString('utf8') : String(text ?? '');
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== KEY_VAULT_MAGIC) return { ok: false, code: 'not_a_key_vault_package', message: 'الملف ليس حزمة خزنة.' };
  const get = (name) => {
    const line = lines.find((l) => l.startsWith(`${name}:`));
    return line ? line.slice(name.length + 1).trim() : null;
  };
  const salt = get('salt');
  const iv = get('iv');
  const tag = get('tag');
  const data = get('data');
  if (!salt || !iv || !tag || !data) return { ok: false, code: 'malformed_package', message: 'بنية حزمة الخزنة ناقصة.' };
  try {
    const key = crypto.scryptSync(resolved.key, Buffer.from(salt, 'base64'), SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    // GCM: أي عبث ببايت واحد يجعل final() يفشل.
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plain);
    return { ok: true, records: Array.isArray(parsed?.records) ? parsed.records : [], values: parsed?.values && typeof parsed.values === 'object' ? parsed.values : {} };
  } catch {
    return { ok: false, code: 'decrypt_failed', message: 'فشل فكّ تشفير الخزنة (مفتاح خاطئ أو بيانات تالفة/معدّلة).' };
  }
}
