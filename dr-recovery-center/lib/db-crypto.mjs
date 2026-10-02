/**
 * تشفير/فك تشفير نسخة قاعدة البيانات (منطق صافٍ، بلا شبكة وبلا أسرار مكتوبة).
 *
 * القاعدة الملزمة: لا يُرفع إلى Drive إلا **DB encrypted dump**. هذا الملف ينتج
 * الشكل المقبول فقط (`GHARABI-DB-DUMP-V1` + AES-256-GCM)، ويستبعد أي SQL خام.
 *
 * مفتاح التشفير من البيئة: `DRIVE_DB_BACKUP_KEY` (مفضّل) ثم `DRIVE_TOKEN_ENCRYPTION_KEY`.
 * لا يُقرأ `DATABASE_URL` هنا إطلاقاً ولا يُتصل بقاعدة الإنتاج.
 */

import crypto from 'node:crypto';
import { DB_DUMP_MAGIC, classifyDbDump } from './cloud-lib.mjs';
import { decodeTokenEncryptionKey } from './drive-auth.mjs';

export const DB_BACKUP_KEY_ENV = 'DRIVE_DB_BACKUP_KEY';
export const DB_BACKUP_KEY_FALLBACK_ENV = 'DRIVE_TOKEN_ENCRYPTION_KEY';

/** يحسم مفتاح 32 بايت من البيئة (بلا تسامح صامت). */
export function resolveDbKey(env = process.env) {
  const primary = env[DB_BACKUP_KEY_ENV];
  const fallback = env[DB_BACKUP_KEY_FALLBACK_ENV];
  const fromPrimary = decodeTokenEncryptionKey(primary);
  if (fromPrimary) return { ok: true, key: fromPrimary, source: DB_BACKUP_KEY_ENV };
  const fromFallback = decodeTokenEncryptionKey(fallback);
  if (fromFallback) return { ok: true, key: fromFallback, source: DB_BACKUP_KEY_FALLBACK_ENV };
  return { ok: false, reason: 'db_backup_key_missing', message: `مفتاح تشفير النسخة غير مضبوط (${DB_BACKUP_KEY_ENV}).` };
}

/** يشفّر نص SQL خام إلى شكل DB encrypted dump المقبول. */
export function encryptDbDump(sqlText, env = process.env) {
  const key = resolveDbKey(env);
  if (!key.ok) return { ok: false, code: key.reason, message: key.message };
  const text = Buffer.isBuffer(sqlText) ? sqlText.toString('utf8') : String(sqlText ?? '');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key.key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = [
    DB_DUMP_MAGIC,
    'encrypted: true',
    'cipher: aes-256-gcm',
    `iv: ${iv.toString('base64')}`,
    `tag: ${tag.toString('base64')}`,
    `data: ${ciphertext.toString('base64')}`,
    '',
  ].join('\n');
  const verdict = classifyDbDump(payload);
  if (!verdict.allowed) return { ok: false, code: 'encrypt_failed_verification', message: 'الناتج لم يُطابق شكل النسخة المشفّرة.' };
  return { ok: true, payload, source: key.source };
}

/** يفكّ تشفير DB encrypted dump إلى نص SQL (يُستخدم في الاستعادة فقط). */
export function decryptDbDump(text, env = process.env) {
  const key = resolveDbKey(env);
  if (!key.ok) return { ok: false, code: key.reason, message: key.message };
  const raw = Buffer.isBuffer(text) ? text.toString('utf8') : String(text ?? '');
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== DB_DUMP_MAGIC) return { ok: false, code: 'not_an_encrypted_dump', message: 'الملف ليس نسخة مشفّرة.' };
  const get = (name) => {
    const line = lines.find((l) => l.startsWith(`${name}:`));
    return line ? line.slice(name.length + 1).trim() : null;
  };
  const iv = get('iv');
  const tag = get('tag');
  const data = get('data');
  if (!iv || !tag || !data) return { ok: false, code: 'malformed_dump', message: 'بنية النسخة المشفّرة ناقصة.' };
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
    return { ok: true, sql: plain.toString('utf8') };
  } catch {
    return { ok: false, code: 'decrypt_failed', message: 'فشل فك التشفير (مفتاح خاطئ أو بيانات تالفة).' };
  }
}
