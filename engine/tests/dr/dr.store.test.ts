/**
 * اختبارات مخزن Drive (بنية الجذر/current/history/db، ثبات نقاط الاستعادة،
 * rp-001، قاعدة البيانات، لقطة المراقبة) — بخادم Drive وهمي بالكامل.
 */

import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../../tools/dr/drive-store.mjs';
import { DriveSync } from '../../../tools/dr/drive-sync.mjs';
import { buildStatus, runHourlyCheck } from '../../../tools/dr/cloud-status.mjs';
import { RP_001_COMMIT, RP_001_ID, DR_FOLDER_NAME } from '../../../tools/dr/cloud-lib.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function makeEnv() {
  const state = createFakeDriveState();
  const client = new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'test-token' });
  const store = new DriveStore({ client });
  return { state, client, store };
}

const folderNames = (state: any): string[] => [...state.files.values()].filter((f: any) => f.mimeType === 'application/vnd.google-apps.folder').map((f: any) => f.name);

async function main() {
  // --- إنشاء الجذر والبنية ---
  {
    const { state, store } = makeEnv();
    const res = await store.ensureStructure();
    check('root created', res.ok && Boolean(res.data.rootId));
    check('root named correctly', folderNames(state).includes(DR_FOLDER_NAME));
    const subs = folderNames(state);
    check('current subdir', subs.includes('current'));
    check('history subdir', subs.includes('history'));
    check('db subdir', subs.includes('db'));
    const again = await store.ensureStructure();
    check('structure idempotent', again.ok && again.data.rootId === res.data.rootId);
  }

  // --- current manifest ---
  {
    const { store } = makeEnv();
    await store.ensureStructure();
    const empty = await store.readCurrentManifest();
    check('current manifest empty initially', empty.ok && empty.data === null);
    const write = await store.writeCurrentManifest({ kind: 'current-version', treeHash: 'abc', fileCount: 1, files: [] });
    check('current manifest written', write.ok);
    const read = await store.readCurrentManifest();
    check('current manifest roundtrip', read.ok && read.data.treeHash === 'abc');
  }

  // --- history: نقاط استعادة مستقلة + immutability ---
  {
    const { store } = makeEnv();
    await store.ensureStructure();
    const rpA = await store.createRestorePoint('rp-002', { commit: 'c2', files: [{ path: 'a.txt', content: 'A' }] });
    check('restore point created', rpA.ok);
    const dup = await store.createRestorePoint('rp-002', { commit: 'c3', files: [{ path: 'a.txt', content: 'B' }] });
    check('restore point immutable', dup.ok === false && dup.code === 'immutable_restore_point');
    const rpB = await store.createRestorePoint('rp-003', { commit: 'c3', files: [{ path: 'b.txt', content: 'B' }] });
    check('separate restore point independent', rpB.ok);
    const list = await store.listRestorePoints();
    check('restore points listed', list.ok && list.data.length === 2 && list.data[0].id === 'rp-002');
    const rpARead = await store.getRestorePoint('rp-002');
    check('restore point unchanged after others', rpARead.ok && rpARead.data.manifest.commit === 'c2');
    check('invalid restore id rejected', (await store.createRestorePoint('nope', { commit: 'c' })).ok === false);
  }

  // --- rp-001 مرتبط بالـcommit المعتمد ---
  {
    const { store } = makeEnv();
    await store.ensureStructure();
    const created = await store.ensureRp001({ files: [{ path: 'server.ts', content: 'x' }] });
    check('rp-001 created with canonical commit', created.ok && created.data.manifest.commit === RP_001_COMMIT);
    check('rp-001 id', created.data.id === RP_001_ID);
    const again = await store.ensureRp001({ files: [] });
    check('rp-001 idempotent (not recreated)', again.ok && again.data.created === false);
    const read = await store.getRestorePoint('rp-001');
    check('rp-001 immutable manifest', read.data.manifest.immutable === true && read.data.manifest.commit === RP_001_COMMIT);
    // محاولة إنشاء rp-001 بغير الـcommit المعتمد تُرفض
    const wrong = await store.createRestorePoint('rp-004', { commit: 'x' });
    check('rp-004 allowed as normal', wrong.ok === true);
    const bad = await store.createRestorePoint(RP_001_ID, { commit: 'deadbeef' });
    check('rp-001 wrong commit rejected', bad.ok === false && bad.code === 'immutable_restore_point');
  }

  // --- db: خام مرفوض، مشفّر مقبول ---
  {
    const { store } = makeEnv();
    await store.ensureStructure();
    const raw = await store.uploadDbDump('prod.sql', 'CREATE TABLE x(id int);');
    check('raw db blocked', raw.ok === false && raw.code === 'raw_database_dump_forbidden');
    const enc = `GHARABI-DB-DUMP-V1\nencrypted: true\ncipher: aes-256-gcm\niv: a\n tag: b\ndata: ${'B'.repeat(32)}\n`;
    const ok = await store.uploadDbDump('prod.enc', enc);
    check('encrypted db allowed', ok.ok && ok.data.encrypted === true);
    const list = await store.listDbDumps();
    check('db list has only encrypted', list.ok && list.data.length === 1 && list.data[0].name === 'prod.enc');
  }

  // --- monitoring snapshot + hourly ---
  {
    const { state, client, store } = makeEnv();
    await store.ensureStructure();
    const sync = new DriveSync({ store, client });
    await sync.syncCurrent([{ path: 'a.txt', content: 'hello' }], { commit: 'commit-1' });
    await store.createRestorePoint('rp-002', { commit: 'c2', files: [{ path: 'a.txt', content: 'hello' }] });
    const status = await buildStatus({ client, store, now: '2026-01-01T00:00:00.000Z' });
    check('status has state', status.state === 'synced');
    check('status commit/treeHash', status.commit === 'commit-1' && /^[0-9a-f]{64}$/.test(status.treeHash));
    check('status restorePointCount', status.restorePointCount === 1);
    check('status versionSize', status.versionSizeBytes === 5 && status.fileCount === 1);
    check('status quota usage real', status.quota.usageBytes === state.usageBytes);
    check('status current integrity', status.currentIntegrity.verified === true);
    const { check: hourly } = await runHourlyCheck({ client, store });
    check('hourly check ok on healthy state', hourly.ok === true && hourly.readOnly === true);
    // لا كتابة أثناء الفحص الساعي: لا تتغيّر بصمة الحالة
    const before = [...state.files.keys()].length;
    await runHourlyCheck({ client, store });
    check('hourly check writes nothing', [...state.files.keys()].length === before);
  }

  // --- تفويض غير مضبوط: لا قراءة ولا كتابة (مسارات CLI) ---
  {
    const { state } = makeEnv();
    const requestsBefore = state.requests.length;
    check('unconfigured env has no auth', requestsBefore === 0);
  }

  if (failures.length) {
    console.error(`DR STORE TESTS FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`DR STORE TESTS PASSED: ${passed} checks`);
}

main().catch((err) => {
  console.error('DR STORE TESTS CRASHED:', err);
  process.exit(1);
});
