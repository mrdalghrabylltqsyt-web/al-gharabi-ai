/**
 * اختبارات المزامنة الآمنة — بخادم Drive وهمي بالكامل.
 *
 * يثبت الترتيب الملزم: manifest → secret scan → treeHash → quota gate →
 * upload/replace → verify → remove obsolete → commit mirror، وأن الفشل الجزئي
 * لا يحوّل current السليم إلى حالة تالفة، وأن الأخطاء (401/403/429/5xx/شبكة)
 * تُصنَّف صراحةً بلا إتلاف، وأن الشبكة تفشل بلا رمي.
 */

import { createFakeDriveState, makeFakeTransport, seedFile } from './helpers/fakeDrive';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../../tools/dr/drive-store.mjs';
import { DriveSync } from '../../../tools/dr/drive-sync.mjs';
import { encodeFileName, computeTreeHash, DESIGN_QUOTA_BYTES } from '../../../tools/dr/cloud-lib.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function makeEnv() {
  const state = createFakeDriveState();
  const client = new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok', retryBaseMs: 1 });
  const store = new DriveStore({ client });
  const mirror: { value: any } = { value: null };
  const sync = new DriveSync({ store, client, persistMirror: (m: any) => { mirror.value = m; } });
  return { state, client, store, sync, mirror };
}

const currentFolderId = (state: any): string =>
  [...state.files.values()].find((f: any) => f.mimeType === 'application/vnd.google-apps.folder' && f.name === 'current')!.id;
const currentFileNames = (state: any): string[] => {
  const cid = currentFolderId(state);
  return [...state.files.values()].filter((f: any) => f.parents.includes(cid) && f.name !== '_manifest.json').map((f: any) => f.name).sort();
};

async function main() {
  // --- أول مزامنة ---
  {
    const { state, store, sync } = makeEnv();
    await store.ensureStructure();
    const r = await sync.syncCurrent([{ path: 'a.txt', content: 'hello' }, { path: 'src/b.mjs', content: 'x' }], { commit: 'c1' });
    check('first sync state synced', r.state === 'synced' && r.uploaded === 2);
    check('first sync verified', r.verified === true);
    check('first sync treeHash', /^[0-9a-f]{64}$/.test(r.treeHash));
    check('first sync writes manifest', (await store.readCurrentManifest()).data?.treeHash === r.treeHash);
    check('files uploaded to current', currentFileNames(state).length === 2);
  }

  // --- no_change: لا إعادة رفع ---
  {
    const { state, store, sync } = makeEnv();
    await store.ensureStructure();
    const files = [{ path: 'a.txt', content: 'hello' }, { path: 'b.txt', content: 'world' }];
    await sync.syncCurrent(files, { commit: 'c1' });
    const reqBefore = state.requests.length;
    const r = await sync.syncCurrent(files, { commit: 'c1' });
    check('no_change detected', r.state === 'no_change' && r.uploaded === 0);
    check('no_change avoids re-upload', state.requests.length === reqBefore);
  }

  // --- إضافة ---
  {
    const { state, store, sync } = makeEnv();
    await store.ensureStructure();
    await sync.syncCurrent([{ path: 'a.txt', content: 'a' }], { commit: 'c1' });
    const r = await sync.syncCurrent([{ path: 'a.txt', content: 'a' }, { path: 'c.txt', content: 'c' }], { commit: 'c2' });
    check('add detected', r.state === 'synced' && r.diff.added === 1 && r.uploaded === 1);
    check('add visible', currentFileNames(state).includes(encodeFileName('c.txt')));
  }

  // --- تعديل ---
  {
    const { state, store, sync } = makeEnv();
    await store.ensureStructure();
    await sync.syncCurrent([{ path: 'a.txt', content: 'old' }], { commit: 'c1' });
    const r = await sync.syncCurrent([{ path: 'a.txt', content: 'new-content' }], { commit: 'c2' });
    check('modify detected', r.diff.modified === 1);
    const cid = currentFolderId(state);
    const file = [...state.files.values()].find((f: any) => f.parents.includes(cid) && f.name === encodeFileName('a.txt'))!;
    check('modify replaces content', file.content.toString('utf8') === 'new-content');
  }

  // --- حذف ---
  {
    const { state, store, sync } = makeEnv();
    await store.ensureStructure();
    await sync.syncCurrent([{ path: 'a.txt', content: 'a' }, { path: 'b.txt', content: 'b' }], { commit: 'c1' });
    const r = await sync.syncCurrent([{ path: 'a.txt', content: 'a' }], { commit: 'c2' });
    check('delete detected', r.diff.removed === 1 && r.removed === 1);
    check('delete removes from current', !currentFileNames(state).includes(encodeFileName('b.txt')));
  }

  // --- نقل ---
  {
    const { state, store, sync } = makeEnv();
    await store.ensureStructure();
    await sync.syncCurrent([{ path: 'src/old.mjs', content: 'shared' }, { path: 'keep.txt', content: 'k' }], { commit: 'c1' });
    const r = await sync.syncCurrent([{ path: 'src/new.mjs', content: 'shared' }, { path: 'keep.txt', content: 'k' }], { commit: 'c2' });
    check('rename detected', r.diff.renamed === 1);
    const names = currentFileNames(state);
    check('rename old path gone', !names.includes(encodeFileName('src/old.mjs')));
    check('rename new path present', names.includes(encodeFileName('src/new.mjs')));
  }

  // --- secret block: STOP بلا رفع أي جزء ---
  {
    const { state, store, sync } = makeEnv();
    await store.ensureStructure();
    await sync.syncCurrent([{ path: 'a.txt', content: 'a' }], { commit: 'c1' });
    const manifestBefore = (await store.readCurrentManifest()).data;
    const reqBefore = state.requests.length;
    const r = await sync.syncCurrent([
      { path: 'a.txt', content: 'a' },
      { path: 'leak.txt', content: 'GEMINI_API_KEY=AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345678' },
    ], { commit: 'c2' });
    check('secret blocked state', r.state === 'secret_blocked' && r.stopped === true);
    check('secret blocked uploads nothing', r.uploaded === 0 && state.requests.length === reqBefore);
    check('secret blocked keeps manifest', (await store.readCurrentManifest()).data.treeHash === manifestBefore.treeHash);
    check('secret block reports path', r.secretScan.paths.includes('leak.txt'));
  }

  // --- quota block ---
  {
    const { state, store, sync } = makeEnv();
    await store.ensureStructure();
    state.usageBytes = DESIGN_QUOTA_BYTES - 1024;
    const r = await sync.syncCurrent([{ path: 'big.txt', content: 'y'.repeat(5000) }], { commit: 'c1' });
    check('quota blocked', r.state === 'blocked' && r.reason === 'quota_exceeded');
    check('quota no upload', r.uploaded === 0 && currentFileNames(state).length === 0);
  }

  // --- partial upload: current يبقى سليماً ---
  {
    const { state, store, sync } = makeEnv();
    await store.ensureStructure();
    await sync.syncCurrent([{ path: 'keep.txt', content: 'safe' }], { commit: 'c1' });
    const manifestBefore = (await store.readCurrentManifest()).data;
    state.failCreateNames.add(encodeFileName('boom.txt'));
    const r = await sync.syncCurrent([
      { path: 'keep.txt', content: 'safe' },
      { path: 'new.txt', content: 'n' },
      { path: 'boom.txt', content: 'b' },
    ], { commit: 'c2' });
    check('partial upload fails', r.state === 'failed' && r.reason === 'partial_upload');
    check('partial upload removes nothing', r.removed === 0);
    check('partial upload keeps prior manifest', (await store.readCurrentManifest()).data.treeHash === manifestBefore.treeHash);
    check('partial upload keeps safe file', currentFileNames(state).includes(encodeFileName('keep.txt')));
  }

  // --- 401/403/429/5xx ---
  {
    for (const [status, expected] of [[401, 'failed'], [403, 'failed'], [429, 'failed'], [503, 'failed']] as const) {
      const { state, store, sync } = makeEnv();
      await store.ensureStructure();
      await sync.syncCurrent([{ path: 'a.txt', content: 'a' }], { commit: 'c1' });
      state.forcedStatus = status;
      const r = await sync.syncCurrent([{ path: 'a.txt', content: 'a2' }], { commit: 'c2' });
      state.forcedStatus = 0;
      const manifest = (await store.readCurrentManifest()).data;
      check(`error ${status} handled`, r.state === expected);
      check(`error ${status} keeps manifest`, manifest?.commit === 'c1');
    }
  }

  // --- network failure (retries then classified, no throw) ---
  {
    const { state, store, sync } = makeEnv();
    await store.ensureStructure();
    state.alwaysNetworkError = true;
    const r = await sync.syncCurrent([{ path: 'a.txt', content: 'a' }], { commit: 'c1' });
    check('network failure classified', r.state === 'failed' && ['network_error', 'unauthorized'].includes(r.reason));
    state.alwaysNetworkError = false;
  }

  // --- duplicate prevention: نفس البصمة لا تُرفع مرتين ---
  {
    const { state, store, sync } = makeEnv();
    await store.ensureStructure();
    await sync.syncCurrent([{ path: 'a.txt', content: 'same' }], { commit: 'c1' });
    const names1 = currentFileNames(state).length;
    await sync.syncCurrent([{ path: 'a.txt', content: 'same' }], { commit: 'c1' });
    check('duplicate prevention', currentFileNames(state).length === names1);
  }

  // --- current safety: بصمة الشجرة في البيان تطابق الملفات الفعلية ---
  {
    const { state, store, sync } = makeEnv();
    await store.ensureStructure();
    const files = [{ path: 'a.txt', content: 'a' }, { path: 'b/c.txt', content: 'c' }];
    const r = await sync.syncCurrent(files, { commit: 'c1' });
    const manifest = (await store.readCurrentManifest()).data;
    const recomputed = computeTreeHash(manifest.files.map((f: any) => ({ path: f.path, sha256: f.sha256 })));
    check('current integrity matches', recomputed === r.treeHash && manifest.treeHash === r.treeHash);
  }

  // --- mirror persistence ---
  {
    const { store, sync, mirror } = makeEnv();
    await store.ensureStructure();
    await sync.syncCurrent([{ path: 'a.txt', content: 'a' }], { commit: 'c1' });
    check('mirror persisted', mirror.value && mirror.value.treeHash && mirror.value.version === 1);
  }

  if (failures.length) {
    console.error(`DR SYNC TESTS FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`DR SYNC TESTS PASSED: ${passed} checks`);
}

main().catch((err) => {
  console.error('DR SYNC TESTS CRASHED:', err);
  process.exit(1);
});
