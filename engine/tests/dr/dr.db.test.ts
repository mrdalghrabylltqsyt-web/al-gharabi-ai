/**
 * اختبارات نسخة قاعدة البيانات (DR): تشفير/فك تشفير، رفض الخام، وقبول المشفّر.
 *
 * يثبت أن المسموح الوحيد هو DB encrypted dump، وأن فك التشفير يعيد النص الأصلي
 * فقط بالمفتاح الصحيح، وأن DATABASE_URL لا يُستخدم إطلاقاً في هذه الأدوات.
 */

import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { encryptDbDump, decryptDbDump, resolveDbKey } from '../../../tools/dr/db-crypto.mjs';
import { buildEncryptedDump } from '../../../tools/dr/dump-db.mjs';
import { restoreDump } from '../../../tools/dr/restore-db.mjs';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../../tools/dr/drive-store.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const ENV: Record<string, string> = { DRIVE_DB_BACKUP_KEY: 'd'.repeat(64) };
const SQL = 'CREATE TABLE t(id int);\nINSERT INTO t VALUES (1);\n';

async function main() {
  // --- المفتاح ---
  check('key resolved from primary', resolveDbKey(ENV).ok === true && resolveDbKey(ENV).source === 'DRIVE_DB_BACKUP_KEY');
  check('key fallback works', resolveDbKey({ DRIVE_TOKEN_ENCRYPTION_KEY: 'e'.repeat(64) }).ok === true);
  check('key missing detected', resolveDbKey({}).ok === false && resolveDbKey({}).reason === 'db_backup_key_missing');
  check('key invalid detected', resolveDbKey({ DRIVE_DB_BACKUP_KEY: 'short' }).ok === false);
  check('db tools ignore DATABASE_URL', resolveDbKey({ DATABASE_URL: 'postgres://x' }).ok === false);

  // --- تشفير/فك ---
  {
    const enc = encryptDbDump(SQL, ENV);
    check('encrypt ok', enc.ok === true);
    check('encrypt produces encrypted dump', /GHARABI-DB-DUMP-V1/.test(enc.payload) && /encrypted: true/.test(enc.payload) && /cipher: aes-256-gcm/.test(enc.payload));
    check('encrypt hides sql', !enc.payload.includes('CREATE TABLE'));
    const dec = decryptDbDump(enc.payload, ENV);
    check('decrypt roundtrip', dec.ok === true && dec.sql === SQL);
    const wrong = decryptDbDump(enc.payload, { DRIVE_DB_BACKUP_KEY: 'f'.repeat(64) });
    check('decrypt wrong key fails', wrong.ok === false && wrong.code === 'decrypt_failed');
    const notDump = decryptDbDump('plain sql text', ENV);
    check('decrypt rejects non-dump', notDump.ok === false);
  }

  // --- الملفات: dump-db / restore-db ---
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-db-'));
    const inFile = path.join(dir, 'dump.sql');
    fs.writeFileSync(inFile, SQL);
    const enc = buildEncryptedDump(inFile, ENV);
    check('buildEncryptedDump ok', enc.ok === true);
    const encFile = path.join(dir, 'dump.enc');
    fs.writeFileSync(encFile, enc.payload);
    const restored = restoreDump(encFile, ENV);
    check('restoreDump roundtrip', restored.ok === true && restored.sql === SQL);
    check('restoreDump missing file', restoreDump(path.join(dir, 'nope.enc'), ENV).ok === false);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- المخزن: خام مرفوض، مشفّر مقبول ---
  {
    const state = createFakeDriveState();
    const client = new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' });
    const store = new DriveStore({ client });
    await store.ensureStructure();
    const rawRes = await store.uploadDbDump('prod.sql', SQL);
    check('store rejects raw db', rawRes.ok === false && rawRes.code === 'raw_database_dump_forbidden');
    const enc = encryptDbDump(SQL, ENV);
    const okRes = await store.uploadDbDump('prod.enc', enc.payload);
    check('store accepts encrypted db', okRes.ok === true && okRes.data.encrypted === true);
    const list = await store.listDbDumps();
    check('db dir has only encrypted', list.data.length === 1 && list.data[0].name === 'prod.enc');
  }

  if (failures.length) {
    console.error(`DR DB TESTS FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`DR DB TESTS PASSED: ${passed} checks`);
}

main().catch((err) => {
  console.error('DR DB TESTS CRASHED:', err);
  process.exit(1);
});
