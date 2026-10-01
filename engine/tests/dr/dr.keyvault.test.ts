/**
 * اختبارات خزنة مفاتيح الطوارئ (Emergency Key Vault) — Drive وهمي بالكامل.
 *
 * يثبت:
 *  - التشفير فقط: لا قيمة سرّية كنص مكشوف في الحزمة ولا في البيان ولا في أي رد.
 *  - نموذج مُرقّم بمرجع اعتماد واحد (HEAD)؛ كل تغيير = نسخة جديدة مستقلة.
 *  - «لا تغيير» حقيقي بلا نسخة جديدة (بصمة محتوى).
 *  - أمان الانقطاع: فشل الرفع/التحقق/كتابة HEAD لا يُسقط الخزنة السليمة.
 *  - فشل التنظيف = cleanupPending بلا إسقاط الاعتماد ولا no_change كاذب.
 *  - المفتاح الخاطئ يفشل بأمان، والعبث بالبايت يُكتشف (GCM).
 *  - الجرد schema-based بلا أسرار، ولا يشمل أي اسم خارج المعتمد.
 */

import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../../tools/dr/drive-store.mjs';
import {
  runKeyVaultSync,
  recoverKeyVault,
  resolveCurrentKeyVault,
  keyVaultStatus,
  buildVaultSnapshot,
  vaultContentHash,
  diffVaultRecords,
} from '../../dr/recoveryVault/vault';
import {
  RECOVERY_SECRET_INVENTORY,
  presentInventoryNames,
  criticalInventoryNames,
  inventoryNames,
} from '../../dr/recoveryVault/inventory';
import { encryptKeyVault, decryptKeyVault, inspectVaultKey, decodeVaultKey } from '../../../tools/dr/key-vault-crypto.mjs';
import { isEncryptedKeyVaultPackage } from '../../../tools/dr/cloud-lib.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function makeStore(state: any) {
  const client = new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' });
  return new DriveStore({ client });
}

const VAULT_KEY = 'f'.repeat(64); // 32 بايت hex (قيمة اختبار عابرة)
const ENV: Record<string, string> = {
  DR_RECOVERY_VAULT_KEY: VAULT_KEY,
  DR_RECOVERY_MASTER_KEY: 'a1'.repeat(32),
  DRIVE_DB_BACKUP_KEY: 'b2'.repeat(32),
  DRIVE_TOKEN_ENCRYPTION_KEY: 'c3'.repeat(32),
  SESSION_SECRET: 'sess-' + 'x'.repeat(30),
  PLATFORM_TOKEN_ENCRYPTION_KEY: 'd4'.repeat(32),
  OWNER_EMAIL: 'owner@example.test',
  DATABASE_URL: 'postgres://owner@example/prod',
  GEMINI_API_KEY: 'AIzaSy' + 'g'.repeat(33),
  FACEBOOK_APP_SECRET: 'fb-' + 'y'.repeat(30),
  // سرّ خارج الجرد المعتمد: يجب ألا يظهر في الخزنة إطلاقاً.
  SOME_UNRELATED_VAR: 'should-not-be-in-vault',
};

async function main() {
  // ------------------------------------------------------------------
  // 1) وحدة: الجرد (بلا أسرار)
  // ------------------------------------------------------------------
  {
    check('inventory non-empty', RECOVERY_SECRET_INVENTORY.length >= 30);
    const names = inventoryNames();
    check('inventory names unique', new Set(names).size === names.length);
    check('inventory has no values', RECOVERY_SECRET_INVENTORY.every((e) => typeof (e as any).value === 'undefined'));
    check('critical names subset', criticalInventoryNames().every((n) => names.includes(n)));
    check('vault key in inventory', names.includes('DR_RECOVERY_VAULT_KEY'));
    check('present excludes unrelated', !presentInventoryNames(ENV).includes('SOME_UNRELATED_VAR'));
    check('present includes configured', presentInventoryNames(ENV).includes('DR_RECOVERY_VAULT_KEY') && presentInventoryNames(ENV).includes('GEMINI_API_KEY'));
    // كل اسم في الجرد مُصنّف (نوع/خدمة/غرض).
    check('every entry classified', RECOVERY_SECRET_INVENTORY.every((e) => Boolean(e.kind) && Boolean(e.service) && Boolean(e.purpose)));
  }

  // ------------------------------------------------------------------
  // 2) وحدة: التشفير (لا نص مكشوف) + المفتاح الخاطئ + العبث
  // ------------------------------------------------------------------
  {
    const snapshot = buildVaultSnapshot(ENV, '2026-01-01T00:00:00.000Z');
    check('snapshot has records', snapshot.records.length >= 5);
    check('snapshot record carries no value', snapshot.records.every((r: any) => typeof r.value === 'undefined'));
    check('snapshot record has fingerprint', snapshot.records.every((r: any) => typeof r.fingerprint === 'string' && r.fingerprint.length === 16));
    const enc = encryptKeyVault(snapshot.records, snapshot.values, ENV);
    check('encrypt ok', enc.ok === true && isEncryptedKeyVaultPackage(enc.payload));
    // لا قيمة سرّية ظاهرة في الحزمة.
    check('no plaintext master key in package', !enc.payload.includes(ENV.DR_RECOVERY_MASTER_KEY));
    check('no plaintext gemini key in package', !enc.payload.includes(ENV.GEMINI_API_KEY));
    check('no plaintext session secret in package', !enc.payload.includes(ENV.SESSION_SECRET));
    check('no secret name plaintext in package', !enc.payload.includes('DR_RECOVERY_MASTER_KEY'));
    // فكّ صحيح بالمفتاح الصحيح.
    const dec = decryptKeyVault(enc.payload, ENV);
    check('decrypt ok with correct key', dec.ok === true && dec.values.DR_RECOVERY_MASTER_KEY === ENV.DR_RECOVERY_MASTER_KEY);
    // مفتاح خاطئ => فشل بأمان.
    const wrong = decryptKeyVault(enc.payload, { ...ENV, DR_RECOVERY_VAULT_KEY: 'e'.repeat(64) });
    check('decrypt fails with wrong key', wrong.ok === false && wrong.code === 'decrypt_failed');
    // مفتاح مفقود => فشل صريح.
    const missing = decryptKeyVault(enc.payload, {});
    check('decrypt fails with missing key', missing.ok === false && missing.code === 'vault_key_missing');
    // مفتاح غير صالح (32 محرفاً ASCII) => رفض.
    check('invalid key rejected (32 chars)', decodeVaultKey('a'.repeat(32)) === null);
    check('invalid key rejected (odd base64)', decodeVaultKey('not-a-key!!') === null);
    const inspect = inspectVaultKey({ DR_RECOVERY_VAULT_KEY: 'a'.repeat(32) });
    check('inspect invalid vs missing', inspect.state === 'invalid' && inspect.valid === false);
    check('inspect missing', inspectVaultKey({}).state === 'missing');
    // العبث بالبايت => GCM يكشفه.
    const tampered = enc.payload.replace(/data: (.+)/, (_m: string, b64: string) => {
      const buf = Buffer.from(b64, 'base64');
      buf[0] = buf[0] ^ 0xff;
      return `data: ${buf.toString('base64')}`;
    });
    const tamperDec = decryptKeyVault(tampered, ENV);
    check('tampered package detected', tamperDec.ok === false);
  }

  // ------------------------------------------------------------------
  // 3) تكامل: مزامنة أولى => KV-1 + HEAD + current.enc
  // ------------------------------------------------------------------
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const r1 = await runKeyVaultSync({ store, env: ENV, now: '2026-01-01T00:00:00.000Z' });
    check('first sync synced', r1.state === 'synced' && r1.version === 1);
    check('first sync recordCount', r1.recordCount === presentInventoryNames(ENV).length);
    const head = await store.readKeyVaultHead();
    check('head written v1', head.ok && head.data.version === 1 && head.data.cleanupPending === false);
    // ملفات KV-1 الفعلية + current.enc.
    const versions = await store.listKeyVaultVersions();
    check('KV-1 exists', versions.ok && versions.data.includes(1));
    const current = await store.readKeyVaultCurrent();
    check('current.enc present + encrypted', current.ok && isEncryptedKeyVaultPackage(current.data));
    const status = await keyVaultStatus(store, ENV);
    check('status present + canDecrypt', status.state === 'present' && status.canDecrypt === true && status.version === 1);
    check('status exposes no values', typeof status.records !== 'undefined' && status.records.every((r: any) => typeof r.value === 'undefined'));
  }

  // ------------------------------------------------------------------
  // 4) لا تغيير => لا نسخة جديدة
  // ------------------------------------------------------------------
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    await runKeyVaultSync({ store, env: ENV, now: '2026-01-01T00:00:00.000Z' });
    const r2 = await runKeyVaultSync({ store, env: ENV, now: '2026-01-02T00:00:00.000Z' });
    check('no change => no_change', r2.state === 'no_change' && r2.version === 1);
    const versions = await store.listKeyVaultVersions();
    check('still only KV-1', versions.ok && versions.data.length === 1 && versions.data[0] === 1);
    const head = await store.readKeyVaultHead();
    check('head unchanged on no_change', head.ok && head.data.version === 1);
  }

  // ------------------------------------------------------------------
  // 5) تغيير سرّ => نسخة جديدة KV-2 + diff صادق
  // ------------------------------------------------------------------
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    await runKeyVaultSync({ store, env: ENV, now: '2026-01-01T00:00:00.000Z' });
    const changedEnv = { ...ENV, SESSION_SECRET: 'sess-' + 'z'.repeat(30) };
    const r2 = await runKeyVaultSync({ store, env: changedEnv, now: '2026-01-02T00:00:00.000Z' });
    check('change => synced v2', r2.state === 'synced' && r2.version === 2);
    check('diff reports changed name', Array.isArray(r2.diff?.changed) && r2.diff.changed.includes('SESSION_SECRET'));
    const versions = await store.listKeyVaultVersions();
    check('KV-2 exists + KV-1 cleaned', versions.ok && versions.data.includes(2) && !versions.data.includes(1));
    const resolved = await resolveCurrentKeyVault(store);
    check('current resolves v2 consistent', resolved.ok && resolved.data.version === 2 && resolved.data.consistent === true);
  }

  // ------------------------------------------------------------------
  // 6) فشل رفع النسخة => لا اعتماد، الخزنة السابقة سليمة
  // ------------------------------------------------------------------
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    await runKeyVaultSync({ store, env: ENV, now: '2026-01-01T00:00:00.000Z' });
    store.writeKeyVaultVersion = async () => ({ ok: false, code: 'upload_failed' });
    const r2 = await runKeyVaultSync({ store, env: { ...ENV, SESSION_SECRET: 'sess-' + 'q'.repeat(30) }, now: '2026-01-02T00:00:00.000Z' });
    check('upload failure => failed', r2.state === 'failed' && r2.reason === 'upload_failed');
    const head = await store.readKeyVaultHead();
    check('head unchanged on upload failure', head.ok && head.data.version === 1);
    const resolved = await resolveCurrentKeyVault(store);
    check('vault still v1 after upload failure', resolved.ok && resolved.data.version === 1);
  }

  // ------------------------------------------------------------------
  // 7) فشل التحقق (بصمة غير مطابقة) => لا اعتماد
  // ------------------------------------------------------------------
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    await runKeyVaultSync({ store, env: ENV, now: '2026-01-01T00:00:00.000Z' });
    // نُعيد قراءة حزمة مُبدَّلة (بصمة مختلفة) لإثبات رفض الاعتماد.
    store.readKeyVaultVersion = async () => ({ ok: true, data: 'GHARABI-KEY-VAULT-V1\nencrypted: true\ncipher: aes-256-gcm\ndata: AAAA\n' });
    const r2 = await runKeyVaultSync({ store, env: { ...ENV, SESSION_SECRET: 'sess-' + 'w'.repeat(30) }, now: '2026-01-02T00:00:00.000Z' });
    check('verify mismatch => failed', r2.state === 'failed' && r2.reason === 'verify_hash_mismatch');
    const head = await store.readKeyVaultHead();
    check('head unchanged on verify mismatch', head.ok && head.data.version === 1);
  }

  // ------------------------------------------------------------------
  // 8) فشل كتابة HEAD => النسخة الجديدة غير معتمدة والسابقة سليمة
  // ------------------------------------------------------------------
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    await runKeyVaultSync({ store, env: ENV, now: '2026-01-01T00:00:00.000Z' });
    store.writeKeyVaultHead = async () => ({ ok: false, code: 'head_write_failed' });
    const r2 = await runKeyVaultSync({ store, env: { ...ENV, SESSION_SECRET: 'sess-' + 'r'.repeat(30) }, now: '2026-01-02T00:00:00.000Z' });
    check('head write failure => failed', r2.state === 'failed' && r2.reason === 'head_write_failed');
    const resolved = await resolveCurrentKeyVault(store);
    check('CURRENT vault still v1 after head failure', resolved.ok && resolved.data.version === 1);
    const recovered = await recoverKeyVault(store, ENV);
    check('recover still works after head failure', recovered.ok && recovered.values.DR_RECOVERY_MASTER_KEY === ENV.DR_RECOVERY_MASTER_KEY);
  }

  // ------------------------------------------------------------------
  // 9) فشل التنظيف => cleanupPending، لا no_change كاذب، ويُعاد لاحقاً
  // ------------------------------------------------------------------
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    await runKeyVaultSync({ store, env: ENV, now: '2026-01-01T00:00:00.000Z' });
    store.deleteKeyVaultVersionDir = async () => ({ ok: false, code: 'delete_failed' });
    const changedEnv = { ...ENV, SESSION_SECRET: 'sess-' + 't'.repeat(30) };
    const r2 = await runKeyVaultSync({ store, env: changedEnv, now: '2026-01-02T00:00:00.000Z' });
    check('sync succeeds despite cleanup failure', r2.state === 'synced' && r2.version === 2 && r2.cleanupPending === true);
    const head = await store.readKeyVaultHead();
    check('head v2 with cleanupPending', head.ok && head.data.version === 2 && head.data.cleanupPending === true && head.data.pendingCleanup.length >= 1);
    // دورة تالية بنفس المصدر عبر مخزن جديد (restart): ليست no_change كاذبة.
    const store2 = makeStore(state);
    store2.deleteKeyVaultVersionDir = async () => ({ ok: false, code: 'delete_failed' });
    const r3 = await runKeyVaultSync({ store: store2, env: changedEnv, now: '2026-01-03T00:00:00.000Z' });
    check('next cycle retries cleanup (not false no_change)', r3.state === 'no_change' && r3.cleanupPending === true);
    // الآن ينجح الحذف.
    const store3 = makeStore(state);
    const r4 = await runKeyVaultSync({ store: store3, env: changedEnv, now: '2026-01-04T00:00:00.000Z' });
    check('cleanup retried and clears pending', r4.state === 'no_change' && r4.cleanupPending === false && (r4.removed ?? 0) >= 1);
    const head4 = await store3.readKeyVaultHead();
    check('pending cleared in head', head4.ok && head4.data.cleanupPending === false);
    const versions = await store3.listKeyVaultVersions();
    check('stale KV-1 removed after retry', versions.ok && !versions.data.includes(1) && versions.data.includes(2));
  }

  // ------------------------------------------------------------------
  // 10) استعادة الخزنة (drill) + كشف العبث بالمحتوى
  // ------------------------------------------------------------------
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    await runKeyVaultSync({ store, env: ENV, now: '2026-01-01T00:00:00.000Z' });
    const rec = await recoverKeyVault(store, ENV);
    check('recover ok', rec.ok && rec.recordCount === presentInventoryNames(ENV).length);
    check('recover integrity recordsMatch', rec.integrity.recordsMatch === true && rec.integrity.mismatched.length === 0);
    check('recover returns real values for restore', rec.values.DRIVE_DB_BACKUP_KEY === ENV.DRIVE_DB_BACKUP_KEY);
    // مفتاح خاطئ => فشل.
    const bad = await recoverKeyVault(store, { ...ENV, DR_RECOVERY_VAULT_KEY: '9'.repeat(64) });
    check('recover fails with wrong vault key', bad.ok === false && bad.code === 'decrypt_failed');
  }

  // ------------------------------------------------------------------
  // 11) بلا مفتاح خزنة => blocked (لا خزنة بلا مفتاح)
  // ------------------------------------------------------------------
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const noKey = { ...ENV } as any;
    delete noKey.DR_RECOVERY_VAULT_KEY;
    const r = await runKeyVaultSync({ store, env: noKey, now: '2026-01-01T00:00:00.000Z' });
    check('sync blocked without vault key', r.state === 'blocked' && r.reason === 'vault_key_missing');
    const versions = await store.listKeyVaultVersions();
    check('no version written without key', versions.ok && versions.data.length === 0);
  }

  // ------------------------------------------------------------------
  // 12) ثبات بعد restart: مخزن جديد يقرأ نفس الخزنة ويستعيدها
  // ------------------------------------------------------------------
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    await runKeyVaultSync({ store, env: ENV, now: '2026-01-01T00:00:00.000Z' });
    const store2 = makeStore(state); // محاكاة عملية جديدة بنفس Drive
    const status = await keyVaultStatus(store2, ENV);
    check('status survives restart', status.state === 'present' && status.version === 1 && status.canDecrypt === true);
    const rec = await recoverKeyVault(store2, ENV);
    check('recover survives restart', rec.ok && rec.values.SESSION_SECRET === ENV.SESSION_SECRET);
  }

  // ------------------------------------------------------------------
  // 13) دوال مساعدة (وحدة)
  // ------------------------------------------------------------------
  {
    const recs = buildVaultSnapshot(ENV, '2026-01-01T00:00:00.000Z').records;
    const h1 = vaultContentHash(recs);
    const h2 = vaultContentHash(buildVaultSnapshot(ENV, '2026-01-01T00:00:00.000Z').records);
    check('content hash deterministic', h1 === h2);
    const h3 = vaultContentHash(buildVaultSnapshot({ ...ENV, SESSION_SECRET: 'different' }, '2026-01-01T00:00:00.000Z').records);
    check('content hash changes with value', h3 !== h1);
    const d = diffVaultRecords([{ name: 'A', fingerprint: '1' }, { name: 'B', fingerprint: '2' }], [{ name: 'A', fingerprint: '9' }, { name: 'C', fingerprint: '3' }]);
    check('diff added/changed/removed', d.added.includes('C') && d.changed.includes('A') && d.removed.includes('B'));
  }

  console.log(`\nDR KEY VAULT TESTS: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
