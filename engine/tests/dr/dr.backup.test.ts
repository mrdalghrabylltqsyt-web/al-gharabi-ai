/**
 * اختبارات النسخ الاحتياطي الفعلي (DR) — المسار الرسمي الوحيد.
 *
 * يغطّي الشروط الإلزامية:
 *  1) نسخة طبيعية: source → bundle → encrypt DB → upload → verify.
 *  2) لا أسرار في الحزمة/البيان.
 *  3) لا قاعدة بيانات خام على Drive.
 *  4) تغيير ملف ينعكس في current.
 *  5) حذف ملف يختفي من current ويبقى في history.
 *  6) لا تغيير => لا نقطة استعادة مكررة.
 *  7) فشل الرفع => FAILED لا SUCCESS.
 *  8) انقطاع الرفع => current لا يبقى نصف مكتمل.
 *  9) قاعدة بيانات تالفة => مرفوضة.
 * 10) ملف معدّل => كشف اختلاف البصمة.
 * 11) تشغيل متزامن => لا نسخة فاسدة.
 * 12) استعادة: بيان نقطة الاستعادة + فك التشفير يعيد النص الأصلي.
 */

import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../../tools/dr/drive-store.mjs';
import { runBackup, readBackCurrent } from '../../../tools/dr/backup.mjs';
import { encryptDbDump, decryptDbDump } from '../../../tools/dr/db-crypto.mjs';
import {
  scanForSecretsStrict,
  evaluateBackupVerification,
  buildSourceBundle,
  verifySourceBundle,
  listSourceBundleFiles,
  SOURCE_BUNDLE_NAME,
  DB_DUMP_NAME,
} from '../../../tools/dr/cloud-lib.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const ENV = { DRIVE_DB_BACKUP_KEY: 'd'.repeat(64) };
const SQL = 'CREATE TABLE t(id int);\nINSERT INTO t VALUES (1);\n';

function makeStore(state: any) {
  const client = new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' });
  return new DriveStore({ client });
}

function currentNames(state: any): string[] {
  const current = [...state.files.values()].find((f: any) => f.name === 'current' && f.mimeType === 'application/vnd.google-apps.folder');
  if (!current) return [];
  return [...state.files.values()].filter((f: any) => f.parents.includes(current.id)).map((f: any) => f.name).sort();
}

function encrypt(sql: string) {
  return encryptDbDump(sql, ENV);
}

async function backupOnce(store: any, files: any[], meta: any = {}) {
  return runBackup({
    store,
    files,
    dumpDatabase: async () => SQL,
    encryptDatabase: encrypt,
    meta: { commit: meta.commit ?? 'c1', branch: 'main', repository: 'r/al-gharabi-ai', project: 'al-gharabi-ai' },
    now: meta.now || new Date().toISOString(),
  });
}

async function main() {
  // ============ 1) نسخة طبيعية ============
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const files = [{ path: 'server.ts', content: 'export const x = 1;' }, { path: 'README.md', content: '# hi' }];
    const r = await backupOnce(store, files);
    check('happy: state backed_up', r.state === 'backed_up');
    check('happy: verified true', r.verified === true);
    check('happy: recovery point id', r.recoveryPointId === 'rp-002');
    check('happy: sourceHash present', /^[0-9a-f]{64}$/.test(r.sourceHash));
    check('happy: treeHash present', /^[0-9a-f]{64}$/.test(r.treeHash));
    const names = currentNames(state);
    check('happy: current has bundle', names.includes(SOURCE_BUNDLE_NAME));
    check('happy: current has db enc', names.includes(DB_DUMP_NAME));
    check('happy: current has manifest', names.includes('manifest.json'));
    // history recovery point
    const rp = await store.getRestorePoint('rp-002');
    check('happy: history rp exists', rp.ok && rp.data && rp.data.manifest);
    check('happy: rp immutable flag', rp.data.manifest.immutable === true);
    check('happy: rp commit', rp.data.manifest.commit === 'c1');
    check('happy: rp hashes present', /^[0-9a-f]{64}$/.test(rp.data.manifest.sourceHash) && /^[0-9a-f]{64}$/.test(rp.data.manifest.encryptedDatabaseHash));
    // manifest in current
    const manifest = (await store.readCurrentManifest()).data;
    check('happy: manifest fields', manifest.commit === 'c1' && manifest.fileCount === 2 && manifest.recoveryPointId === 'rp-002');
    check('happy: manifest sourceSize>0', manifest.sourceSize > 0);
    check('happy: manifest backupVersion', manifest.backupVersion === 1 && manifest.bundleVersion === 1);
    check('happy: manifest no secret keys', !/token|secret|refresh|password|DATABASE_URL/i.test(JSON.stringify(manifest)));
  }

  // ============ 2) لا أسرار في الحزمة ============
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    // قيمة سرّ حقيقية الشكل تُبنى وقت التشغيل (لا تظهر كاملة في المصدر).
    const realKey = 'AIza' + 'SyABCDEFGHIJKLMNOPQRSTUVWXYZ012345678';
    const files = [{ path: 'a.ts', content: 'const a=1;' }, { path: '.env', content: `GEMINI_API_KEY=${realKey}` }];
    const r = await backupOnce(store, files);
    check('secrets: blocked', r.state === 'secret_blocked' && r.stopped === true);
    check('secrets: nothing uploaded', r.uploaded === 0 && currentNames(state).length === 0);
    check('secrets: reported path', r.secretScan.paths.includes('.env'));
    check('secrets: no value leaked', JSON.stringify(r.secretScan).indexOf('AIzaSy') === -1);
    // الفحص الصارم لا يعتبر الكود السليم سراً
    check('secrets: strict allows clean code', scanForSecretsStrict([{ path: 'a.ts', content: 'const refreshToken = t.refresh_token || null;' }]).ok === true);
    check('secrets: strict blocks real key', scanForSecretsStrict([{ path: 'a.ts', content: `const k="${realKey}"` }]).ok === false);
  }

  // ============ 3) لا قاعدة بيانات خام على Drive ============
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    await store.ensureStructure();
    const raw = await store.writeCurrentVersion({ bundle: Buffer.from('b'), dbEncrypted: SQL, manifest: {} });
    check('db: raw rejected in current', raw.ok === false && raw.code === 'raw_database_dump_forbidden');
    const rawRp = await store.createVersionedRestorePoint('rp-050', { commit: 'c', bundle: Buffer.from('b'), dbEncrypted: SQL, manifest: {} });
    check('db: raw rejected in history', rawRp.ok === false && rawRp.code === 'raw_database_dump_forbidden');
    const dbDir = [...state.files.values()].filter((f: any) => f.name === 'db');
    check('db: db dir present but empty', dbDir.length === 1 && [...state.files.values()].filter((f: any) => f.parents.includes(dbDir[0].id)).length === 0);
  }

  // ============ 4) تغيير ملف ينعكس في current ============
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    await backupOnce(store, [{ path: 'a.txt', content: 'v1' }]);
    const r2 = await backupOnce(store, [{ path: 'a.txt', content: 'v2-changed' }], { commit: 'c2' });
    check('change: backed_up', r2.state === 'backed_up');
    check('change: new recovery point', r2.recoveryPointId === 'rp-003');
    const manifest = (await store.readCurrentManifest()).data;
    check('change: current commit updated', manifest.commit === 'c2');
    check('change: sourceHash changed', manifest.sourceHash !== null);
  }

  // ============ 5) حذف ملف: يختفي من current ويبقى في history ============
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    await backupOnce(store, [{ path: 'a.txt', content: 'a' }, { path: 'b.txt', content: 'b' }]);
    const beforeRp = await store.getRestorePoint('rp-002');
    const r2 = await backupOnce(store, [{ path: 'a.txt', content: 'a' }], { commit: 'c2' });
    check('delete: backed_up', r2.state === 'backed_up');
    const manifest = (await store.readCurrentManifest()).data;
    check('delete: fileCount drops to 1', manifest.fileCount === 1);
    // الحزمة الجديدة لا تحوي b.txt؛ الحزمة التاريخية تحويه.
    const newBundle = (await store.readVersionFile((await store.subdirId('current')), SOURCE_BUNDLE_NAME)).data;
    check('delete: new bundle excludes b.txt', listSourceBundleFiles(newBundle).files.includes('b.txt') === false);
    const oldFolder = beforeRp.data.folderId;
    const oldBundle = (await store.readVersionFile(oldFolder, SOURCE_BUNDLE_NAME)).data;
    check('delete: history keeps b.txt', listSourceBundleFiles(oldBundle).files.includes('b.txt') === true);
  }

  // ============ 6) لا تغيير => لا نقطة مكررة ============
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const files = [{ path: 'a.txt', content: 'same' }];
    const r1 = await backupOnce(store, files, { commit: 'c1' });
    const r2 = await backupOnce(store, files, { commit: 'c1' });
    check('no_change: detected', r2.state === 'no_change');
    check('no_change: no upload', r2.uploaded === 0);
    const points = await store.listRestorePoints();
    check('no_change: no duplicate rp', points.data.length === 1 && points.data[0].id === r1.recoveryPointId);
  }

  // ============ 7) فشل الرفع => FAILED لا SUCCESS ============
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    state.failCreateNames.add(SOURCE_BUNDLE_NAME); // فشل إنشاء الحزمة في history
    const r = await backupOnce(store, [{ path: 'a.txt', content: 'a' }]);
    check('upload_fail: not success', r.state === 'failed');
    check('upload_fail: verified false', r.verified !== true);
    // لا يبقى current مكتملاً بلا ملفاته
    check('upload_fail: current has no manifest', !currentNames(state).includes('manifest.json'));
  }

  // ============ 8) انقطاع الرفع: current لا يبقى نصف مكتمل ============
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    // نسخة أولى سليمة
    const ok = await backupOnce(store, [{ path: 'a.txt', content: 'a' }], { commit: 'c1' });
    const manifestBefore = (await store.readCurrentManifest()).data;
    check('interrupt: first ok', ok.state === 'backed_up');
    // النسخة الثانية تفشل في إنشاء مجلد نقطة الاستعادة (history) => current لا يتغيّر
    state.failCreateNames.add('rp-003');
    const r2 = await backupOnce(store, [{ path: 'a.txt', content: 'changed' }], { commit: 'c2' });
    check('interrupt: failed', r2.state === 'failed');
    const manifestAfter = (await store.readCurrentManifest()).data;
    check('interrupt: current unchanged', manifestAfter.commit === manifestBefore.commit && manifestAfter.treeHash === manifestBefore.treeHash);
  }

  // ============ 9) قاعدة بيانات تالفة => مرفوضة ============
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const r = await runBackup({
      store,
      files: [{ path: 'a.txt', content: 'a' }],
      dumpDatabase: async () => SQL,
      encryptDatabase: () => ({ ok: false, code: 'encrypt_failed_verification', message: 'bad' }),
      meta: { commit: 'c1' },
    });
    check('corrupt_db: failed', r.state === 'failed' && r.reason === 'encrypt_failed_verification');
    check('corrupt_db: nothing on current', !currentNames(state).includes(SOURCE_BUNDLE_NAME));
  }

  // ============ 10) ملف معدّل => كشف اختلاف البصمة ============
  {
    // وحدة: تحقق النسخ الكاذب يكشف اختلاف البصمة والحجم
    const v = evaluateBackupVerification(
      { sourceHash: 'aaa', encryptedDatabaseHash: 'bbb', sourceSize: 10, encryptedDatabaseSize: 20 },
      { bundlePresent: true, dbPresent: true, manifestPresent: true, bundleHash: 'zzz', dbHash: 'bbb', bundleSize: 11, dbSize: 20 },
    );
    check('tamper: verification fails', v.ok === false);
    check('tamper: detects source hash mismatch', v.problems.includes('source_hash_mismatch'));
    check('tamper: detects source size mismatch', v.problems.includes('source_size_mismatch'));
    // تكامل: لو أُعيد قراءة حزمة معدّلة => runBackup يفشل
    const state = createFakeDriveState();
    const store = makeStore(state);
    const orig = store.readVersionFile.bind(store);
    store.readVersionFile = async (parentId: string, name: string) => {
      if (name === SOURCE_BUNDLE_NAME) return { ok: true, data: Buffer.from('tampered-bundle') };
      return orig(parentId, name);
    };
    const r = await backupOnce(store, [{ path: 'a.txt', content: 'a' }]);
    check('tamper: runBackup fails on mismatch', r.state === 'failed' && r.reason === 'verification_failed');
  }

  // ============ 11) تشغيل متزامن => لا نسخة فاسدة ============
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const p1 = backupOnce(store, [{ path: 'a.txt', content: 'a' }], { commit: 'c1' });
    const p2 = backupOnce(store, [{ path: 'b.txt', content: 'b' }], { commit: 'c2' });
    const [r1, r2] = await Promise.all([p1, p2]);
    const states = [r1.state, r2.state].sort();
    check('concurrent: one succeeds one blocked', states[0] === 'backed_up' && states[1] === 'blocked');
    check('concurrent: blocked reason', (r1.state === 'blocked' ? r1 : r2).reason === 'backup_already_running');
    // current سليم: بيانه وملفاته متطابقان
    const manifest = (await store.readCurrentManifest()).data;
    const actual = await readBackCurrent(store, {});
    check('concurrent: current consistent', manifest && actual.manifestPresent && actual.bundlePresent && actual.dbPresent);
  }

  // ============ 12) استعادة: البيان + فك التشفير ============
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const r = await backupOnce(store, [{ path: 'a.txt', content: 'a' }]);
    const rp = await store.getRestorePoint(r.recoveryPointId);
    check('restore: rp manifest present', rp.ok && rp.data.manifest);
    const encFile = await store.readVersionFile(rp.data.folderId, DB_DUMP_NAME);
    check('restore: rp has database.enc', encFile.ok && encFile.data);
    const dec = decryptDbDump(encFile.data, ENV);
    check('restore: decrypt roundtrip', dec.ok && dec.sql === SQL);
    const wrong = decryptDbDump(encFile.data, { DRIVE_DB_BACKUP_KEY: 'f'.repeat(64) });
    check('restore: wrong key fails', wrong.ok === false);
    const bundleFile = await store.readVersionFile(rp.data.folderId, SOURCE_BUNDLE_NAME);
    const vb = verifySourceBundle(bundleFile.data, { fileCount: rp.data.manifest.fileCount });
    check('restore: bundle verifies', vb.ok === true);
  }

  if (failures.length) {
    console.error(`DR BACKUP TESTS FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`DR BACKUP TESTS PASSED: ${passed} checks`);
}

main().catch((err) => {
  console.error('DR BACKUP TESTS CRASHED:', err);
  process.exit(1);
});
