/**
 * أداة DR لفكّ **حزمة الأسرار المشفّرة** (secrets.enc) إلى ملف بيئة محلي.
 *
 * الاستخدام:
 *   node tools/dr/secrets-restore.mjs --in secrets.enc --out .env.restored
 *   node tools/dr/secrets-restore.mjs --in secrets.enc            # يطبع الأسماء فقط
 *
 * الأمان:
 *  - يحتاج المفتاح الرئيسي في البيئة (`DR_RECOVERY_MASTER_KEY` ثم `DRIVE_DB_BACKUP_KEY`).
 *  - افتراضياً **لا يطبع أي قيمة سرّية** — أسماء فقط. القيم تُكتب في ملف `--out`.
 *  - ملف الإخراج يُنشأ بصلاحيات 0600.
 */

import fs from 'node:fs';
import { decryptSecretsPackage, inspectMasterKey, MASTER_KEY_ENV_NAMES } from './secret-crypto.mjs';

export function restoreSecrets(inputPath, env = process.env) {
  if (!fs.existsSync(inputPath)) return { ok: false, code: 'input_missing', message: 'ملف الحزمة غير موجود.' };
  return decryptSecretsPackage(fs.readFileSync(inputPath), env);
}

function toEnvFile(secrets) {
  return Object.keys(secrets).sort().map((k) => {
    const v = String(secrets[k]);
    const needsQuote = /[\s#"']/.test(v) || v.includes('\n');
    return `${k}=${needsQuote ? JSON.stringify(v) : v}`;
  }).join('\n') + '\n';
}

async function main() {
  const args = process.argv.slice(2);
  const inIdx = args.indexOf('--in');
  const outIdx = args.indexOf('--out');
  const inputPath = inIdx !== -1 ? args[inIdx + 1] : null;
  if (!inputPath) {
    console.log(JSON.stringify({ state: 'failed', reason: 'missing_input', message: 'مرّر --in <secrets.enc>.', keyEnvNames: MASTER_KEY_ENV_NAMES }, null, 2));
    process.exit(1);
  }
  const key = inspectMasterKey(process.env);
  const res = restoreSecrets(inputPath, process.env);
  if (!res.ok) {
    // لا نطبع أي قيمة سرّية؛ فقط السبب الآمن.
    console.log(JSON.stringify({ state: 'blocked', reason: res.code, message: res.message, masterKey: key }, null, 2));
    process.exit(1);
  }
  const names = Object.keys(res.secrets).sort();
  const report = { state: 'decrypted', count: names.length, names, wroteValues: false };
  if (outIdx !== -1) {
    const outPath = args[outIdx + 1];
    fs.writeFileSync(outPath, toEnvFile(res.secrets), { mode: 0o600 });
    report.wroteValues = true;
    report.out = outPath.split(/[\\/]/).pop();
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
