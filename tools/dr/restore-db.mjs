/**
 * أداة DR لفك تشفير **DB encrypted dump** إلى ملف SQL محلي (لا اتصال بقاعدة).
 *
 * الاستخدام:
 *   node tools/dr/restore-db.mjs --in dump.enc --out restored.sql
 *
 * لا يُقرأ DATABASE_URL ولا يُتصل بأي قاعدة؛ تُنتج أداة SQL فقط ليعيد المالك
 * تشغيلها يدوياً على قاعدة الاستعادة. ترفض أي ملف غير مشفّر.
 */

import fs from 'node:fs';
import path from 'node:path';
import { decryptDbDump } from './db-crypto.mjs';

export function restoreDump(inputPath, env = process.env) {
  if (!fs.existsSync(inputPath)) return { ok: false, code: 'input_missing', message: 'ملف النسخة غير موجود.' };
  return decryptDbDump(fs.readFileSync(inputPath), env);
}

async function main() {
  const args = process.argv.slice(2);
  const inIdx = args.indexOf('--in');
  const outIdx = args.indexOf('--out');
  const inputPath = inIdx !== -1 ? args[inIdx + 1] : null;
  if (!inputPath) {
    console.log(JSON.stringify({ state: 'failed', reason: 'missing_input', message: 'مرّر --in <file.enc>.' }, null, 2));
    process.exit(1);
  }
  const res = restoreDump(inputPath, process.env);
  if (!res.ok) {
    console.log(JSON.stringify({ state: 'blocked', reason: res.code, message: res.message }, null, 2));
    process.exit(1);
  }
  const outPath = outIdx !== -1 ? args[outIdx + 1] : `${inputPath}.sql`;
  fs.writeFileSync(outPath, res.sql);
  console.log(JSON.stringify({ state: 'restored', out: path.basename(outPath), note: 'شغّل هذا الملف يدوياً على قاعدة الاستعادة.' }, null, 2));
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(JSON.stringify({ state: 'failed', reason: 'unexpected', message: String(err?.message || err) }));
    process.exit(1);
  });
}
