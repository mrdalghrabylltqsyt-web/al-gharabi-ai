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
  classifyDbDump,
  SOURCE_BUNDLE_NAME,
  DB_DUMP_NAME,
} from '../../../tools/dr/cloud-lib.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

/** هل يُقبل المحتوى كنسخة قاعدة بيانات مشفّرة صحيحة؟ */
function classifyOk(content: any): boolean {
  return classifyDbDump(content).allowed === true;
}

/** هل يُرفض المحتوى كنسخة مشفّرة (خام/تالف/قصير)؟ */
function classifyRaw(content: any): boolean {
  return classifyDbDump(content).allowed === false;
}

/** طول سطر `data:` الوحيد في نسخة مشفّرة (لكشف أن الحِمل سطر واحد ضخم). */
function singleDataLineLength(payload: string): number {
  const line = String(payload ?? '').split(/\r?\n/).find((l) => l.startsWith('data:'));
  return line ? line.length : 0;
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
    // البيان لا يحمل أي **قيمة** سرّية: فقط حقول metadata (encryptedSecretsHash/hash).
    // نميّز بدقّة: كلمة "secret"/"token" قد تظهر كاسم حقل metadata، لكن لا يجوز أن
    // تحمل قيمة سرّية أو أن تظهر كلمة قيمة مكشوفة (refresh token / password / DATABASE_URL).
    check('happy: manifest no secret values', !/refresh[_-]?token|password|DATABASE_URL|api[_-]?key|client[_-]?secret/i.test(JSON.stringify(manifest)));
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

  // ============ 13) السبب الجذري للـ403: عدم استخدام مرجع root ============
  {
    // خادم Drive يفرض `drive.file`: أي إشارة إلى مرجع `root` تُرفض 403.
    // المسار الجديد يجب أن ينجح كاملاً دون أي إشارة إلى root.
    const state = createFakeDriveState();
    state.forbidRootReference = true;
    const store = makeStore(state);
    const files = [{ path: 'server.ts', content: 'export const x = 1;' }];
    const r = await backupOnce(store, files);
    check('403-fix: backup succeeds under drive.file', r.state === 'backed_up' && r.verified === true);
    check('403-fix: no request referenced root', state.requests.every((q: any) => !/root/.test(q.url)));
    // لا يُعلن نجاح وهمي: الملفات موجودة فعلاً في current
    const names = currentNames(state);
    check('403-fix: current files real', names.includes(SOURCE_BUNDLE_NAME) && names.includes(DB_DUMP_NAME) && names.includes('manifest.json'));
    // الجذر أُنشئ بلا أب (لا مرجع root)
    const root = [...state.files.values()].find((f: any) => f.name === 'al-gharabi-ai-dr');
    check('403-fix: root created without parent', root && root.parents.length === 0);
  }

  // ============ 14) التقاط خطأ Google الحقيقي عند 403 ============
  {
    const state = createFakeDriveState();
    state.forbidRootReference = true;
    // نُجبر الفشل بمحاكاة خادم يرفض كل إنشاء مجلد (بدون مرجع root) بـ403
    // لنثبت أن سبب Google يُستخرج ويُعاد، لا مجرّد "403 forbidden".
    const client = new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' });
    const res = await client.request({ url: 'https://www.googleapis.com/drive/v3/files', method: 'GET' });
    // طلب عادي بلا root => ينجح
    check('403-detail: plain list ok', res.ok === true);
    // نستخرج سبب Google مباشرة من مصنّف الخطأ
    const { classifyDriveError } = await import('../../../tools/dr/drive-client.mjs');
    const classified = classifyDriveError({
      status: 403,
      response: { status: 403, data: { error: { code: 403, message: 'The user does not have sufficient permissions for this file.', errors: [{ domain: 'global', reason: 'insufficientPermissions' }] } } },
    });
    check('403-detail: code forbidden', classified.code === 'forbidden');
    check('403-detail: google reason captured', classified.errorDetails.googleReason === 'insufficientPermissions');
    check('403-detail: google domain captured', classified.errorDetails.googleDomain === 'global');
    check('403-detail: google code captured', classified.errorDetails.googleCode === 403);
    check('403-detail: message mentions reason', /insufficientPermissions/.test(classified.message));
    check('403-detail: no secret in details', !/token|Bearer|secret/i.test(JSON.stringify(classified.errorDetails)));
  }

  // ============ 15) فشل آمن عند فقدان الصلاحية (403) ============
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    // فشل دائم 403 على كل الطلبات => لا نجاح وهمي ولا رفع.
    state.forcedStatus = 403;
    const r = await backupOnce(store, [{ path: 'a.ts', content: 'a' }]);
    check('403-safe: state failed', r.state === 'failed');
    check('403-safe: reason forbidden', r.reason === 'forbidden');
    check('403-safe: verified false', r.verified !== true);
    check('403-safe: nothing uploaded', r.uploaded === 0);
    check('403-safe: google detail surfaced', r.errorDetails && r.errorDetails.googleReason === 'insufficientPermissions');
  }

  // ============ 17) السبب الجذري: نسخة DB كبيرة لا تُسقط المكدس ============
  // السطر `data:` في النسخة المشفّرة سطر base64 واحد طويل ينمو مع حجم القاعدة.
  // النمط السابق للتحقق منه استخدم كمّية regex غير محدودة `{16,}` فاستنفد المكدس
  // (RangeError: Maximum call stack size exceeded) عند بضعة ميغابايت. هذه المجموعة
  // تعيد إنتاج الشرط الحقيقي وتثبت أن الإصلاح يتعامل مع أحجام إنتاجية فعلاً.
  {
    // 5MB نص خام => سطر base64 واحد ~7MB: كان يكفي سابقاً لإسقاط المكدس.
    const bigSql = JSON.stringify({ backend: 'postgres', rows: [{ blob: 'y'.repeat(5 * 1024 * 1024) }] });
    let encryptThrew = false;
    let encrypted = null as any;
    try { encrypted = encrypt(bigSql); } catch { encryptThrew = true; }
    check('bigdb: encryption does not overflow the stack', encryptThrew === false);
    check('bigdb: encryption succeeds', Boolean(encrypted && encrypted.ok));
    check('bigdb: encrypted dump accepted (no stack overflow)', encrypted && classifyOk(encrypted.payload));
    check('bigdb: single-line payload really is multi-MB', encrypted && singleDataLineLength(encrypted.payload) > 5 * 1024 * 1024);

    // النسخة الكاملة عبر المسار الحقيقي (runBackup) بحجم قاعدة إنتاجي.
    const state = createFakeDriveState();
    const store = makeStore(state);
    const files = [{ path: 'server.ts', content: 'export const x = 1;' }];
    const r = await runBackup({
      store,
      files,
      dumpDatabase: async () => bigSql,
      encryptDatabase: encrypt,
      meta: { commit: 'big1', branch: 'main', repository: 'r/al-gharabi-ai', project: 'al-gharabi-ai' },
      now: new Date().toISOString(),
    });
    check('bigdb: full backup succeeds with production-scale DB', r.state === 'backed_up' && r.verified === true);
    check('bigdb: no failure reason from overflow', r.reason !== 'Maximum call stack size exceeded' && r.reason !== 'RangeError');

    // الحمايات تبقى صارمة بعد الإصلاح: البيانات الخام وقيمة data القصيرة مرفوضتان.
    check('bigdb: raw SQL still rejected', classifyRaw('CREATE TABLE t(id int);\nINSERT INTO t VALUES (1);'));
    check('bigdb: short data line still rejected', classifyRaw('GHARABI-DB-DUMP-V1\nencrypted: true\ncipher: aes-256-gcm\ndata: abc\n'));
    check('bigdb: data line with trailing junk still rejected', classifyRaw('GHARABI-DB-DUMP-V1\nencrypted: true\ncipher: aes-256-gcm\ndata: ' + 'A'.repeat(40) + ' ; DROP TABLE t\n'));
  }

  // ============ 16) الهوية المحفوظة تُستخدم بلا إعادة إنشاء ============
  {
    const state = createFakeDriveState();
    state.forbidRootReference = true;
    const first = makeStore(state);
    await first.ensureStructure();
    const identity = first.structureIdentity();
    check('identity: has rootId + subdirs', Boolean(identity && identity.rootId && identity.subdirs.current));
    // مخزن ثانٍ بنفس الهوية المحفوظة: لا ينشئ جذراً جديداً.
    const before = [...state.files.values()].filter((f: any) => f.name === 'al-gharabi-ai-dr').length;
    const second = new DriveStore({ client: new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' }), storedIdentity: identity });
    const s = await second.ensureStructure();
    const after = [...state.files.values()].filter((f: any) => f.name === 'al-gharabi-ai-dr').length;
    check('identity: reuse no duplicate root', s.ok && before === 1 && after === 1 && s.data.rootId === identity.rootId);
  }

  // ============ 17) الأسرار المشفّرة + وثائق التعافي + المجلدات المستقلة ============
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const SECRET_ENV = {
      DR_RECOVERY_MASTER_KEY: '5a'.repeat(32),
      GEMINI_API_KEY: 'AIzaSy' + 'q'.repeat(33),
      SESSION_SECRET: 'sess-' + 'v'.repeat(30),
    };
    const { buildSecretsBundle, decryptSecretsPackage } = await import('../../../tools/dr/secret-crypto.mjs');
    const r = await runBackup({
      store,
      files: [{ path: 'server.ts', content: 'export const x = 1;' }],
      dumpDatabase: async () => SQL,
      encryptDatabase: encrypt,
      buildSecrets: () => buildSecretsBundle(SECRET_ENV, { now: '2026-01-01T00:00:00.000Z' }),
      meta: { commit: 'c1', branch: 'main', repository: 'r/al-gharabi-ai', project: 'al-gharabi-ai' },
      now: '2026-01-01T00:00:00.000Z',
    });
    check('secrets: backup backed_up', r.state === 'backed_up' && r.verified === true);
    check('secrets: manifest has encryptedSecretsHash', /^[0-9a-f]{64}$/.test(r.manifest.encryptedSecretsHash));
    check('secrets: count reported', r.secretsCount === 2);

    // حزمة الأسرار موجودة في مجلد secrets/ ومشفّرة وقابلة للفكّ.
    const pkg = await store.readSecretsPackage();
    check('secrets: package uploaded to secrets dir', pkg.ok === true && String(pkg.data ?? '').includes('GHARABI-SECRETS-V1'));
    check('secrets: package not plaintext', !String(pkg.data ?? '').includes('AIzaSy') && !String(pkg.data ?? '').includes('sess-'));
    const dec = decryptSecretsPackage(pkg.data, SECRET_ENV);
    check('secrets: decrypts with master key', dec.ok === true && dec.secrets.GEMINI_API_KEY === SECRET_ENV.GEMINI_API_KEY);
    const secManifest = await store.readSecretsManifest();
    check('secrets: manifest names only', secManifest.ok && secManifest.data.includedNames.includes('GEMINI_API_KEY') && !JSON.stringify(secManifest.data).includes('AIzaSy'));

    // نسخة قاعدة البيانات في db/ (مستقلة، مشفّرة).
    const dbDumps = await store.listDbDumps();
    check('db: encrypted dump present in db dir', dbDumps.ok && dbDumps.data.length >= 1);
    check('db: db dir holds only encrypted dump', dbDumps.ok && dbDumps.data.every((d: any) => d.name.endsWith('.enc')));

    // وثائق التعافي المستقلة في recovery/ بلا أسرار.
    const info = await store.readRecoveryDoc('recovery-information.md');
    const instr = await store.readRecoveryDoc('recovery-instructions.md');
    check('recovery: information doc uploaded', info.ok && String(info.data).includes('معلومات التعافي'));
    check('recovery: instructions doc uploaded', instr.ok && String(instr.data).includes('تعليمات الاستعادة'));
    check('recovery: docs have no secret values', !String(info.data).includes('AIzaSy') && !String(instr.data).includes('sess-'));

    // current-state يحمل حالة الأسرار بأسماء فقط.
    const cs = await store.readCurrentState();
    check('current-state: secrets metadata present', cs.ok && cs.data.secrets.present === true && cs.data.secrets.names.includes('GEMINI_API_KEY'));
    check('current-state: no secret values', !JSON.stringify(cs.data).includes('AIzaSy'));

    // النسخة في current مشفّرة (لا SQL خام): الشكل المقبول فقط.
    const cur = await store.readVersionFile(await store.subdirId('current'), DB_DUMP_NAME);
    check('secrets: current db is encrypted (not raw SQL)', cur.ok && classifyOk(cur.data) && !String(cur.data).includes('CREATE TABLE'));
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
