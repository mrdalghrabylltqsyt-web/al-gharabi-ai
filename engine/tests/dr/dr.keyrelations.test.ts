/**
 * اختبار علاقة مفاتيح الاستعادة الأربعة (Recovery Key Relationships) — منطق صافٍ.
 *
 * يثبت العلاقة الفعلية بين:
 *   DR_RECOVERY_VAULT_KEY     : يفتح خزنة الطوارئ (KEY-VAULT) — مستقل، لا يُحفظ داخلها.
 *   DR_RECOVERY_MASTER_KEY    : يفكّ secrets.enc.
 *   DRIVE_DB_BACKUP_KEY       : يفكّ database.enc.
 *   DRIVE_TOKEN_ENCRYPTION_KEY: يفكّ رمز تجديد Drive المخزّن (ويصلح بديلاً لنسخة القاعدة).
 *
 * القاعدة: كل مفتاح مستقل تماماً (لا اشتقاق بينها)، والثلاثة الأخيرة **تُستعاد من
 * الخزنة** عند الكارثة، أما مفتاح الخزنة فيحتفظ به المالك خارج النظام. لا يُغيّر
 * الاختبار أي قيمة إنتاجية — قيم اختبار عابرة فقط.
 */

import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../../tools/dr/drive-store.mjs';
import { encryptDbDump, decryptDbDump, DB_BACKUP_KEY_ENV, DB_BACKUP_KEY_FALLBACK_ENV } from '../../../tools/dr/db-crypto.mjs';
import { buildSecretsBundle, decryptSecretsPackage, MASTER_KEY_ENV, MASTER_KEY_ENV_NAMES } from '../../../tools/dr/secret-crypto.mjs';
import { decodeVaultKey, VAULT_KEY_ENV } from '../../../tools/dr/key-vault-crypto.mjs';
import { encryptDriveSecret, decryptDriveSecret, DRIVE_TOKEN_ENCRYPTION_KEY_ENV, decodeTokenEncryptionKey } from '../../../tools/dr/drive-auth.mjs';
import { runKeyVaultSync, recoverKeyVault } from '../../dr/recoveryVault/vault';
import { RECOVERY_SECRET_INVENTORY, INVENTORY_BY_NAME, VAULT_SELF_KEY_ENV } from '../../dr/recoveryVault/inventory';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// أربعة مفاتيح اختبار مستقلة (32 بايت hex) — لا تُشبه أي قيمة إنتاج.
const VAULT_KEY = '11'.repeat(32);
const MASTER_KEY = '22'.repeat(32);
const DB_KEY = '33'.repeat(32);
const TOKEN_KEY = '44'.repeat(32);
const ENV: Record<string, string> = {
  DR_RECOVERY_VAULT_KEY: VAULT_KEY,
  DR_RECOVERY_MASTER_KEY: MASTER_KEY,
  DRIVE_DB_BACKUP_KEY: DB_KEY,
  DRIVE_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
  SESSION_SECRET: 'sess-' + 'x'.repeat(40),
  GEMINI_API_KEY: 'AIzaSy' + 'g'.repeat(33),
};

function makeStore(state: any) {
  const client = new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' });
  return new DriveStore({ client });
}

async function main() {
  // --- 1) مصدر واحد: أسماء المتغيّرات متطابقة بين الوحدات ---
  {
    check('vault key env name is single-source', VAULT_SELF_KEY_ENV === VAULT_KEY_ENV && VAULT_KEY_ENV === 'DR_RECOVERY_VAULT_KEY');
    check('master key env name', MASTER_KEY_ENV === 'DR_RECOVERY_MASTER_KEY' && MASTER_KEY_ENV_NAMES.includes(MASTER_KEY_ENV));
    check('db key env name', DB_BACKUP_KEY_ENV === 'DRIVE_DB_BACKUP_KEY' && DB_BACKUP_KEY_FALLBACK_ENV === 'DRIVE_TOKEN_ENCRYPTION_KEY');
    check('token key env name', DRIVE_TOKEN_ENCRYPTION_KEY_ENV === 'DRIVE_TOKEN_ENCRYPTION_KEY');
    // كل الأسماء الأربعة ضمن الجرد المعتمد.
    for (const n of ['DR_RECOVERY_VAULT_KEY', 'DR_RECOVERY_MASTER_KEY', 'DRIVE_DB_BACKUP_KEY', 'DRIVE_TOKEN_ENCRYPTION_KEY']) {
      check(`inventory contains ${n}`, INVENTORY_BY_NAME.has(n));
    }
  }

  // --- 2) الصيغة: كل مفتاح 32 بايت بالضبط ---
  {
    check('vault key decodes to 32 bytes', decodeVaultKey(VAULT_KEY)?.length === 32);
    check('token key decodes to 32 bytes', decodeTokenEncryptionKey(TOKEN_KEY)?.length === 32);
    // مفاتيح قصيرة/خاطئة تُرفض (لا تسامح صامت).
    check('short vault key rejected', decodeVaultKey('a'.repeat(32)) === null);
    check('short token key rejected', decodeTokenEncryptionKey('b'.repeat(32)) === null);
  }

  // --- 3) استقلال كامل: لا مفتاح يفتح عمل مفتاح آخر ---
  {
    const secrets = buildSecretsBundle(ENV, { now: '2026-01-01T00:00:00.000Z' });
    check('secrets bundle built', secrets.ok === true);
    // الأسرار تُفكّ بالمفتاح الرئيسي فقط.
    check('secrets decrypt with master key', decryptSecretsPackage(secrets.payload, { DR_RECOVERY_MASTER_KEY: MASTER_KEY }).ok === true);
    check('secrets NOT decryptable with vault key', decryptSecretsPackage(secrets.payload, { DR_RECOVERY_MASTER_KEY: VAULT_KEY }).ok === false);
    check('secrets NOT decryptable with db key', decryptSecretsPackage(secrets.payload, { DR_RECOVERY_MASTER_KEY: DB_KEY }).ok === false);
    check('secrets NOT decryptable with token key', decryptSecretsPackage(secrets.payload, { DR_RECOVERY_MASTER_KEY: TOKEN_KEY }).ok === false);

    const db = encryptDbDump('{"backend":"postgres","rows":[{"key":"state","value":{"ok":true}}]}', ENV);
    check('db dump encrypted', db.ok === true);
    // القاعدة تُفكّ بمفتاح نسخة القاعدة فقط.
    check('db decrypts with db key', decryptDbDump(db.payload, { DRIVE_DB_BACKUP_KEY: DB_KEY }).ok === true);
    check('db NOT decryptable with vault key', decryptDbDump(db.payload, { DRIVE_DB_BACKUP_KEY: VAULT_KEY }).ok === false);
    check('db NOT decryptable with master key', decryptDbDump(db.payload, { DRIVE_DB_BACKUP_KEY: MASTER_KEY }).ok === false);
    // مفتاح تشفير التوكنات يصلح بديلاً لنسخة القاعدة عند غياب مفتاح نسخة القاعدة (سلوك موثّق).
    const dbFallback = encryptDbDump('{"backend":"postgres","rows":[{"key":"state","value":{"ok":true}}]}', { DRIVE_TOKEN_ENCRYPTION_KEY: TOKEN_KEY });
    check('db encryptable via token key fallback', dbFallback.ok === true && dbFallback.source === 'DRIVE_TOKEN_ENCRYPTION_KEY');
    check('db decryptable with token key fallback', decryptDbDump(dbFallback.payload, { DRIVE_DB_BACKUP_KEY: '', DRIVE_TOKEN_ENCRYPTION_KEY: TOKEN_KEY }).ok === true);

    // رمز تجديد Drive يُفكّ بمفتاح تشفير التوكنات فقط.
    const encToken = encryptDriveSecret('refresh-token-value', { DRIVE_TOKEN_ENCRYPTION_KEY: TOKEN_KEY });
    check('drive token decrypts with token key', decryptDriveSecret(encToken, { DRIVE_TOKEN_ENCRYPTION_KEY: TOKEN_KEY }) === 'refresh-token-value');
    check('drive token NOT decryptable with vault key', decryptDriveSecret(encToken, { DRIVE_TOKEN_ENCRYPTION_KEY: VAULT_KEY }) === null);
    check('drive token NOT decryptable with master key', decryptDriveSecret(encToken, { DRIVE_TOKEN_ENCRYPTION_KEY: MASTER_KEY }) === null);
  }

  // --- 4) الخزنة تُخزّن الثلاثة (master/db/token) ولا تُخزّن مفتاح الخزنة ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const sync = await runKeyVaultSync({ store, env: ENV, now: '2026-01-01T00:00:00.000Z' });
    check('vault synced', sync.state === 'synced');
    const rec = await recoverKeyVault(store, { DR_RECOVERY_VAULT_KEY: VAULT_KEY });
    check('vault opens with vault key only', rec.ok === true);
    check('vault restores master key', rec.values.DR_RECOVERY_MASTER_KEY === MASTER_KEY);
    check('vault restores db key', rec.values.DRIVE_DB_BACKUP_KEY === DB_KEY);
    check('vault restores token key', rec.values.DRIVE_TOKEN_ENCRYPTION_KEY === TOKEN_KEY);
    check('vault does NOT store its own key', !('DR_RECOVERY_VAULT_KEY' in rec.values));
    // الاستعادة الكاملة: مفاتيح من الخزنة تفكّ الأسرار والقاعدة فعلاً.
    const secrets = buildSecretsBundle(ENV, { now: '2026-01-01T00:00:00.000Z' });
    check('vault-recovered master key decrypts secrets', decryptSecretsPackage(secrets.payload, { DR_RECOVERY_MASTER_KEY: rec.values.DR_RECOVERY_MASTER_KEY }).ok === true);
  }

  // --- 5) لا اشتقاق: تغيير مفتاح الخزنة لا يغيّر غيره ---
  {
    const a = buildSecretsBundle(ENV, { now: '2026-01-01T00:00:00.000Z' });
    const env2 = { ...ENV, DR_RECOVERY_VAULT_KEY: '99'.repeat(32) };
    const b = buildSecretsBundle(env2, { now: '2026-01-01T00:00:00.000Z' });
    // سرّان مستقلان عن مفتاح الخزنة: يُفكّان بالمفتاح الرئيسي نفسه في الحالتين.
    check('master key unaffected by vault key change', decryptSecretsPackage(b.payload, { DR_RECOVERY_MASTER_KEY: MASTER_KEY }).ok === true);
    check('both bundles use same master key', a.keyFingerprint === b.keyFingerprint);
  }

  if (failures.length) {
    console.error(`DR KEY RELATIONS TESTS FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`DR KEY RELATIONS TESTS PASSED: ${passed} checks`);
}

main().catch((err) => {
  console.error('DR KEY RELATIONS TESTS CRASHED:', err?.message || err);
  process.exit(1);
});
