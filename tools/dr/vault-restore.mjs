/**
 * أداة DR لفكّ **خزنة مفاتيح الطوارئ** (current.enc) إلى ملف بيئة محلي.
 *
 * الاستخدام:
 *   node tools/dr/vault-restore.mjs --in current.enc --out .env.vault
 *   node tools/dr/vault-restore.mjs --in current.enc            # يطبع الأسماء فقط
 *
 * الأمان:
 *  - يحتاج مفتاح الخزنة في البيئة (`DR_RECOVERY_VAULT_KEY`) — مفتاح مستقل تماماً.
 *  - افتراضياً **لا يطبع أي قيمة سرّية** — أسماء/حالات فقط. القيم تُكتب في `--out`.
 *  - ملف الإخراج يُنشأ بصلاحيات 0600.
 */

import fs from 'node:fs';
import { decryptKeyVault, inspectVaultKey, VAULT_KEY_ENV } from './key-vault-crypto.mjs';

export function restoreVault(inputPath, env = process.env) {
  if (!fs.existsSync(inputPath)) return { ok: false, code: 'input_missing', message: 'ملف الخزنة غير موجود.' };
  return decryptKeyVault(fs.readFileSync(inputPath), env);
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
    console.log(JSON.stringify({ state: 'failed', reason: 'missing_input', message: 'مرّر --in <current.enc>.', keyEnvName: VAULT_KEY_ENV }, null, 2));
    process.exit(1);
  }
  const key = inspectVaultKey(process.env);
  const res = restoreVault(inputPath, process.env);
  if (!res.ok) {
    // لا نطبع أي قيمة سرّية؛ فقط السبب الآمن.
    console.log(JSON.stringify({ state: 'blocked', reason: res.code, message: res.message, vaultKey: key }, null, 2));
    process.exit(1);
  }
  const names = Object.keys(res.values).sort();
  const report = { state: 'decrypted', count: names.length, names, wroteValues: false };
  if (outIdx !== -1) {
    const outPath = args[outIdx + 1];
    fs.writeFileSync(outPath, toEnvFile(res.values), { mode: 0o600 });
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
