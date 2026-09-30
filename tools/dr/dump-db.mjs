/**
 * أداة DR لتحويل نسخة SQL إلى **DB encrypted dump** (لا اتصال بقاعدة الإنتاج).
 *
 * الاستخدام:
 *   node tools/dr/dump-db.mjs --in dump.sql --out dump.enc        # تشفير ملف
 *   node tools/dr/dump-db.mjs --in dump.sql --out dump.enc --upload # تشفير + رفع المشفّر فقط
 *
 * لا يُقرأ DATABASE_URL ولا يُتصل بأي قاعدة. الملف الخام لا يُرفع أبداً؛ يُرفع
 * الشكل المشفّر فقط، ويُرفض أي SQL خام عند محاولة الرفع.
 */

import fs from 'node:fs';
import path from 'node:path';
import { encryptDbDump } from './db-crypto.mjs';
import { DriveClient, createGaxiosTransport } from './drive-client.mjs';
import { DriveStore } from './drive-store.mjs';
import { createRefreshTokenProvider, inspectDriveAuthEnv } from './drive-auth.mjs';

/** يقرأ ملفاً خاماً ويشفّره (بلا اتصال بأي قاعدة بيانات). */
export function buildEncryptedDump(inputPath, env = process.env) {
  if (!fs.existsSync(inputPath)) return { ok: false, code: 'input_missing', message: 'ملف الإدخال غير موجود.' };
  const raw = fs.readFileSync(inputPath);
  return encryptDbDump(raw, env);
}

async function main() {
  const args = process.argv.slice(2);
  const inIdx = args.indexOf('--in');
  const outIdx = args.indexOf('--out');
  const inputPath = inIdx !== -1 ? args[inIdx + 1] : null;
  if (!inputPath) {
    console.log(JSON.stringify({ state: 'failed', reason: 'missing_input', message: 'مرّر --in <file.sql>.' }, null, 2));
    process.exit(1);
  }
  const enc = buildEncryptedDump(inputPath, process.env);
  if (!enc.ok) {
    console.log(JSON.stringify({ state: 'blocked', reason: enc.code, message: enc.message }, null, 2));
    process.exit(1);
  }
  const outPath = outIdx !== -1 ? args[outIdx + 1] : `${inputPath}.enc`;
  fs.writeFileSync(outPath, enc.payload);
  const report = { state: 'encrypted', out: path.basename(outPath), keySource: enc.source, uploaded: false };

  if (args.includes('--upload')) {
    const auth = inspectDriveAuthEnv(process.env);
    if (!auth.configured || !auth.refreshTokenConfigured) {
      console.log(JSON.stringify({ ...report, state: 'not_authorized', message: 'التفويض غير مضبوط: لم يُرفع شيء.' }, null, 2));
      process.exit(0);
    }
    const client = new DriveClient({ transport: createGaxiosTransport(), tokenProvider: createRefreshTokenProvider({ env: process.env }) });
    const store = new DriveStore({ client });
    await store.ensureStructure();
    const res = await store.uploadDbDump(path.basename(outPath), enc.payload);
    report.uploaded = res.ok;
    report.state = res.ok ? 'encrypted_uploaded' : 'blocked';
    if (!res.ok) report.reason = res.code;
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(JSON.stringify({ state: 'failed', reason: 'unexpected', message: String(err?.message || err) }));
    process.exit(1);
  });
}
