/**
 * اختبارات مرآة CURRENT المُرقّمة (نسخ مستقلة + مرجع اعتماد واحد HEAD.json).
 * Drive وهمي بالكامل، مع حقن أعطال لكل مرحلة لإثبات أن CURRENT لا تختلّ أبداً.
 *
 * يثبت: نسخة جديدة لكل تغيير، التحقق قبل الاعتماد، الاعتماد نقطة واحدة،
 * الفشل قبل الاعتماد يبقي CURRENT السابقة، فشل التنظيف = cleanup_pending بلا
 * إسقاط الاعتماد ولا no_op كاذب، حذف ملف يختفي من CURRENT، وفحص الأسرار.
 */

import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../../tools/dr/drive-store.mjs';
import { runCurrentMirror, buildMirrorSnapshot, resolveCurrentMirror, cleanupOldVersions } from '../../../tools/dr/current-mirror.mjs';

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

/** يحلّ المسار النسبي لملف داخل المرآة من حالة Drive الوهمي. */
function resolveMirrorPath(state: any, file: any): string | null {
  const parts = [file.name];
  let parentId = (file.parents || [])[0];
  let guard = 0;
  while (parentId && guard < 80) {
    const p = state.files.get(parentId);
    if (!p) return null;
    parts.unshift(p.name);
    parentId = (p.parents || [])[0];
    guard += 1;
  }
  return parts.join('/');
}

/** كل مسارات ملفات نسخة CURRENT نسبةً إلى مجلد files. */
function versionMirrorPaths(state: any, version: number): string[] {
  const out: string[] = [];
  const marker = `/versions/v${version}/files/`;
  for (const f of state.files.values()) {
    if (f.mimeType === 'application/vnd.google-apps.folder') continue;
    const p = resolveMirrorPath(state, f);
    const idx = p ? p.indexOf(marker) : -1;
    if (idx !== -1) out.push(p.slice(idx + marker.length));
  }
  return out.sort();
}

const FILES = [
  { path: 'server.ts', content: 'export const server = 1;' },
  { path: 'package.json', content: '{"name":"al-gharabi-ai"}' },
  { path: 'src/App.tsx', content: 'export const App = () => null;' },
  { path: 'src/components/View.tsx', content: 'export const View = 1;' },
  { path: 'engine/brain/runtime.ts', content: 'export const runtime = true;' },
];

async function readHead(store: any) {
  const r = await store.readMirrorHead();
  return r.ok ? r.data : null;
}
async function listVersions(store: any): Promise<number[]> {
  const r = await store.listVersions();
  return r.ok ? r.data : [];
}
const snapshotOf = (files: any[]) => buildMirrorSnapshot(files);

async function main() {
  // --- أول مزامنة: نسخة v1 كاملة + اعتماد HEAD ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const r = await runCurrentMirror({ store, files: FILES, commit: 'c1', now: '2026-01-01T00:00:00.000Z' });
    check('first sync synced + verified', r.state === 'synced' && r.verified === true);
    check('first sync headVersion=1', r.headVersion === 1 && r.currentVersion === 1);
    const head = await readHead(store);
    check('head written v1', Boolean(head) && head.version === 1 && head.treeHash === r.treeHash && head.cleanupPending === false);
    const paths = versionMirrorPaths(state, 1);
    check('version v1 has all files', paths.length === FILES.length);
    check('version v1 nested src file', paths.includes('src/App.tsx') && paths.includes('engine/brain/runtime.ts'));
    const resolved = await resolveCurrentMirror(store);
    check('resolveCurrentMirror from HEAD', resolved.ok === true && resolved.data.version === 1 && resolved.data.consistent === true);
    const vlist = await listVersions(store);
    check('only v1 exists', vlist.length === 1 && vlist[0] === 1);
    const again = await runCurrentMirror({ store, files: FILES, commit: 'c1', previousMirror: { version: 1, treeHash: r.treeHash, files: r.mirrorManifest.files }, currentFiles: r.mirrorManifest.files });
    check('no-change second sync', again.state === 'no_change' && again.uploaded === 0);
    const vlist2 = await listVersions(store);
    check('no-change created no new version', vlist2.length === 1);
  }

  // --- تعديل ملف => نسخة v2 جديدة، والقديمة تُنظّف بعد الاعتماد ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const r1 = await runCurrentMirror({ store, files: FILES, commit: 'c1' });
    const prior = { version: 1, treeHash: r1.treeHash, files: r1.mirrorManifest.files };
    const modified = FILES.map((f) => f.path === 'src/App.tsx' ? { ...f, content: 'export const App = () => 42;' } : f);
    const r2 = await runCurrentMirror({ store, files: modified, commit: 'c2', previousMirror: prior, currentFiles: prior.files });
    check('modified sync synced', r2.state === 'synced' && r2.headVersion === 2);
    const head = await readHead(store);
    check('head now v2', Boolean(head) && head.version === 2 && head.treeHash === r2.treeHash);
    const v2paths = versionMirrorPaths(state, 2);
    check('v2 has all files', v2paths.length === FILES.length);
    const appFile = [...state.files.values()].find((f: any) => f.name === 'App.tsx' && (resolveMirrorPath(state, f) || '').includes('/versions/v2/files/'));
    check('v2 modified content updated', Boolean(appFile) && appFile.content.toString('utf8').includes('42'));
    const vlist = await listVersions(store);
    check('old version v1 cleaned after commit', !vlist.includes(1) && vlist.includes(2));
  }

  // --- حذف ملف => يختفي من CURRENT المعتمدة (نسخة جديدة) ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const r1 = await runCurrentMirror({ store, files: FILES, commit: 'c1' });
    const prior = { version: 1, treeHash: r1.treeHash, files: r1.mirrorManifest.files };
    const reduced = FILES.filter((f) => f.path !== 'src/components/View.tsx');
    const r2 = await runCurrentMirror({ store, files: reduced, commit: 'c2', previousMirror: prior, currentFiles: prior.files });
    check('delete sync synced v2', r2.state === 'synced' && r2.headVersion === 2);
    const paths = versionMirrorPaths(state, 2);
    check('deleted file gone from CURRENT', !paths.includes('src/components/View.tsx'));
    check('other files remain', paths.includes('src/App.tsx') && paths.includes('server.ts'));
  }

  // --- فشل رفع ملف (قبل الاعتماد) => CURRENT السابقة تبقى سليمة ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const r1 = await runCurrentMirror({ store, files: FILES, commit: 'c1' });
    const prior = { version: 1, treeHash: r1.treeHash, files: r1.mirrorManifest.files };
    state.failCreateNames.add('New.tsx');
    const withNew = [...FILES, { path: 'src/New.tsx', content: 'export const New = 1;' }];
    const r2 = await runCurrentMirror({ store, files: withNew, commit: 'c2', previousMirror: prior, currentFiles: prior.files });
    check('upload failure reported failed', r2.state === 'failed' && r2.reason === 'partial_upload');
    const head = await readHead(store);
    check('head unchanged on upload failure', Boolean(head) && head.version === 1 && head.treeHash === r1.treeHash);
    const resolved = await resolveCurrentMirror(store);
    check('CURRENT still v1 and consistent', resolved.ok && resolved.data.version === 1 && resolved.data.consistent === true);
  }

  // --- فشل التحقق (إعادة قراءة) => لا اعتماد ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const r1 = await runCurrentMirror({ store, files: FILES, commit: 'c1' });
    const prior = { version: 1, treeHash: r1.treeHash, files: r1.mirrorManifest.files };
    // نُخزّن محتوى مختلفاً لملف في النسخة الجديدة => إعادة القراءة تكشف عدم تطابق البصمة.
    const origUpsert = store.upsertVersionFile.bind(store);
    store.upsertVersionFile = async (v: number, p: string, content: any, mime: string) => {
      if (v === 2 && p === 'server.ts') return origUpsert(v, p, Buffer.from('corrupted', 'utf8'), mime);
      return origUpsert(v, p, content, mime);
    };
    const modified = FILES.map((f) => f.path === 'server.ts' ? { ...f, content: 'v2-server' } : f);
    const r2 = await runCurrentMirror({ store, files: modified, commit: 'c2', previousMirror: prior, currentFiles: prior.files });
    check('verify failure reported failed', r2.state === 'failed' && r2.reason === 'verify_failed', `state=${r2.state} reason=${r2.reason}`);
    const head = await readHead(store);
    check('head unchanged on verify failure', Boolean(head) && head.version === 1);
  }

  // --- فشل كتابة بيان النسخة => لا اعتماد ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const r1 = await runCurrentMirror({ store, files: FILES, commit: 'c1' });
    const prior = { version: 1, treeHash: r1.treeHash, files: r1.mirrorManifest.files };
    store.writeVersionManifest = async () => ({ ok: false, code: 'manifest_write_failed' });
    const modified = FILES.map((f) => f.path === 'server.ts' ? { ...f, content: 'v2-server' } : f);
    const r2 = await runCurrentMirror({ store, files: modified, commit: 'c2', previousMirror: prior, currentFiles: prior.files });
    check('manifest write failure => failed', r2.state === 'failed' && r2.reason === 'manifest_write_failed');
    const head = await readHead(store);
    check('head unchanged on manifest failure', Boolean(head) && head.version === 1 && head.treeHash === r1.treeHash);
  }

  // --- فشل اعتماد المرجع (HEAD) => CURRENT السابقة تبقى بالكامل ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const r1 = await runCurrentMirror({ store, files: FILES, commit: 'c1' });
    const prior = { version: 1, treeHash: r1.treeHash, files: r1.mirrorManifest.files };
    store.writeMirrorHead = async () => ({ ok: false, code: 'head_write_failed' });
    const modified = FILES.map((f) => f.path === 'server.ts' ? { ...f, content: 'v2-server' } : f);
    const r2 = await runCurrentMirror({ store, files: modified, commit: 'c2', previousMirror: prior, currentFiles: prior.files });
    check('head write failure => failed', r2.state === 'failed' && r2.reason === 'head_write_failed');
    const head = await readHead(store);
    check('head unchanged on commit failure', Boolean(head) && head.version === 1 && head.treeHash === r1.treeHash);
    const resolved = await resolveCurrentMirror(store);
    check('CURRENT still v1 after commit failure', resolved.ok && resolved.data.version === 1);
  }

  // --- فشل حذف نسخة قديمة (بعد الاعتماد) => cleanup_pending، لا no_op كاذب ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const r1 = await runCurrentMirror({ store, files: FILES, commit: 'c1' });
    const prior = { version: 1, treeHash: r1.treeHash, files: r1.mirrorManifest.files };
    store.deleteVersionDir = async () => ({ ok: false, code: 'delete_failed' });
    const modified = FILES.map((f) => f.path === 'server.ts' ? { ...f, content: 'v2-server' } : f);
    const r2 = await runCurrentMirror({ store, files: modified, commit: 'c2', previousMirror: prior, currentFiles: prior.files });
    check('sync succeeds despite cleanup failure', r2.state === 'synced' && r2.headVersion === 2);
    check('cleanupPending true', r2.cleanupPending === true && Array.isArray(r2.pendingCleanup) && r2.pendingCleanup.length >= 1);
    const head = await readHead(store);
    check('head v2 + cleanupPending recorded', Boolean(head) && head.version === 2 && head.cleanupPending === true && head.pendingCleanup.length >= 1);
    const resolved = await resolveCurrentMirror(store);
    check('CURRENT v2 valid despite pending cleanup', resolved.ok && resolved.data.version === 2 && resolved.data.consistent === true && resolved.data.cleanupPending === true);
    // الدورة التالية بنفس المصدر عبر مخزن جديد (restart) وحذف ما زال يفشل:
    // ليست no_op كاذبة، تُعاد المحاولة، وpending يبقى معلناً.
    const priorV2 = { version: 2, treeHash: r2.treeHash, files: r2.mirrorManifest.files, cleanupPending: true };
    const store2 = makeStore(state);
    store2.deleteVersionDir = async () => ({ ok: false, code: 'delete_failed' });
    const r3 = await runCurrentMirror({ store: store2, files: modified, commit: 'c2', previousMirror: priorV2, currentFiles: priorV2.files });
    check('next cycle not a false no_op (retries cleanup)', r3.state === 'no_change' && r3.cleanupPending === true && (r3.removed ?? 0) === 0, `state=${r3.state} pending=${r3.cleanupPending} removed=${r3.removed}`);
    // الآن ينجح الحذف (مخزن سليم): التنظيف يُصفَّر
    const store3 = makeStore(state);
    const r4 = await runCurrentMirror({ store: store3, files: modified, commit: 'c2', previousMirror: priorV2, currentFiles: priorV2.files });
    check('cleanup retried and clears pending', r4.state === 'no_change' && r4.cleanupPending === false && r4.removed >= 1, `pending=${r4.cleanupPending} removed=${r4.removed}`);
    const head4 = await readHead(store3);
    check('pending cleared in head', Boolean(head4) && head4.cleanupPending === false && (head4.pendingCleanup || []).length === 0);
    const vlist = await listVersions(store3);
    check('stale version removed after retry', !vlist.includes(1) && vlist.includes(2));
  }

  // --- انقطاع بعد اكتمال الرفع وقبل الاعتماد => CURRENT السابقة تبقى بعد restart ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const r1 = await runCurrentMirror({ store, files: FILES, commit: 'c1' });
    const prior = { version: 1, treeHash: r1.treeHash, files: r1.mirrorManifest.files };
    store.writeMirrorHead = async () => { throw Object.assign(new Error('network down'), { code: 'ENOTFOUND' }); };
    const modified = FILES.map((f) => f.path === 'server.ts' ? { ...f, content: 'v2-server' } : f);
    let r2: any;
    try { r2 = await runCurrentMirror({ store, files: modified, commit: 'c2', previousMirror: prior, currentFiles: prior.files }); }
    catch (e: any) { r2 = { state: 'THREW', reason: e.code }; }
    check('interrupt before commit surfaces honestly', r2.state === 'THREW' || r2.state === 'failed');
    const store2 = makeStore(state);
    const head = await readHead(store2);
    check('after restart CURRENT still v1 (not committed)', Boolean(head) && head.version === 1 && head.treeHash === r1.treeHash);
    const resolved = await resolveCurrentMirror(store2);
    check('resolve v1 consistent after restart', resolved.ok && resolved.data.version === 1 && resolved.data.consistent === true);
    const r3 = await runCurrentMirror({ store: store2, files: modified, commit: 'c2', previousMirror: prior, currentFiles: prior.files });
    check('retry after restart commits v2', r3.state === 'synced' && r3.headVersion === 2);
  }

  // --- فحص الأسرار يوقف قبل أي رفع ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const secretFiles = [...FILES, { path: 'src/leak.ts', content: 'const k = "AIzaSy' + 'Z'.repeat(33) + '";' }];
    const r = await runCurrentMirror({ store, files: secretFiles, commit: 'c1' });
    check('secret scan blocks mirror', r.state === 'secret_blocked' && r.uploaded === 0);
    check('no head written on secret block', (await readHead(store)) === null);
    const vlist = await listVersions(store);
    check('no version dir created on secret block', vlist.length === 0);
  }

  // --- تنظيف مباشر: cleanupOldVersions يبقي النسخة الحالية فقط ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const s1 = snapshotOf(FILES);
    await runCurrentMirror({ store, files: FILES, commit: 'c1' });
    const filesV2 = FILES.map((f) => f.path === 'server.ts' ? { ...f, content: 'c2' } : f);
    await runCurrentMirror({ store, files: filesV2, commit: 'c2', previousMirror: { version: 1, treeHash: s1.treeHash, files: s1.entries }, currentFiles: s1.entries });
    const res = await cleanupOldVersions(store, 2, 2);
    const after = await listVersions(store);
    check('cleanup keeps only current version', res.pending.length === 0 && after.length === 1 && after[0] === 2, `after=${after.join(',')}`);
  }

  // --- بصمة الشجرة مستقلة عن الترتيب ---
  {
    const a = buildMirrorSnapshot(FILES).treeHash;
    const b = buildMirrorSnapshot([...FILES].reverse()).treeHash;
    check('tree hash order-independent', a === b);
  }

  // --- تزامن متوازٍ: لا نسختان متعارضتان ولا اعتماد خاطئ ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const s1 = snapshotOf(FILES);
    await runCurrentMirror({ store, files: FILES, commit: 'c1' });
    const filesV2 = FILES.map((f) => f.path === 'server.ts' ? { ...f, content: 'parallel-v2' } : f);
    // نُطلق مزامنتين متزامنتين لنفس المصدر: كلتاهما يجب أن تنتج نفس بصمة الشجرة،
    // ولا ينتهي أيٌّ منهما بـsynced على بصمة غير بصمة المحتوى الفعلي.
    const [ra, rb] = await Promise.all([
      runCurrentMirror({ store, files: filesV2, commit: 'c2', previousMirror: { version: 1, treeHash: s1.treeHash, files: s1.entries }, currentFiles: s1.entries }),
      runCurrentMirror({ store, files: filesV2, commit: 'c2', previousMirror: { version: 1, treeHash: s1.treeHash, files: s1.entries }, currentFiles: s1.entries }),
    ]);
    const okStates = [ra, rb].every((r) => r.state === 'synced' || r.state === 'no_change');
    check('parallel syncs never fail with wrong state', okStates, `a=${ra.state} b=${rb.state}`);
    const expectedTree = buildMirrorSnapshot(filesV2).treeHash;
    check('parallel sync treeHash matches content', [ra, rb].every((r) => r.treeHash === expectedTree));
    // CURRENT النهائي يجب أن يشير لبصمة صحيحة ومتّسقة مع بيان النسخة.
    const resolved = await resolveCurrentMirror(store);
    check('post-parallel CURRENT consistent', resolved.ok === true && resolved.data.consistent === true && resolved.data.treeHash === expectedTree);
    // لا نسخة "معلّقة" بلا بيان: كل مجلد نسخة له بيان صالح.
    const vlist = await listVersions(store);
    let allHaveManifest = true;
    for (const v of vlist) { const m = await store.readVersionManifest(v); if (!m.ok || !m.data) allHaveManifest = false; }
    check('every version dir has a manifest', allHaveManifest);
  }

  if (failures.length) {
    console.error(`DR MIRROR TESTS FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`DR MIRROR TESTS PASSED: ${passed} checks`);
}

main().catch((err) => {
  console.error('DR MIRROR TESTS CRASHED:', err);
  process.exit(1);
});
