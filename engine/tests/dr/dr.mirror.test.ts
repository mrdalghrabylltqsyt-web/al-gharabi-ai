/**
 * اختبارات مرآة CURRENT الفعلية (ملفات فردية ببنية المجلدات) — Drive وهمي بالكامل.
 *
 * يثبت: ملف جديد يُرفع بمكانه، تعديل يُحدّث، حذف يُزيل من CURRENT، لا تغيير لا
 * يرفع، الفشل الجزئي لا يرقّي المرآة، وفحص الأسرار يوقف قبل أي رفع.
 */

import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../../tools/dr/drive-store.mjs';
import { runCurrentMirror, buildMirrorSnapshot } from '../../../tools/dr/current-mirror.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const ENV = { DRIVE_DB_BACKUP_KEY: 'd'.repeat(64) };

function makeStore(state: any) {
  const client = new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' });
  return new DriveStore({ client });
}

/** يحلّ المسار النسبي لملف داخل المرآة من حالة Drive الوهمي. */
function resolveMirrorPath(state: any, file: any): string | null {
  const parts = [file.name];
  let parentId = (file.parents || [])[0];
  let guard = 0;
  while (parentId && guard < 50) {
    const p = state.files.get(parentId);
    if (!p) return null;
    parts.unshift(p.name);
    parentId = (p.parents || [])[0];
    guard += 1;
  }
  return parts.join('/');
}

/** كل مسارات ملفات المرآة نسبةً إلى `current/files`. */
function mirrorPaths(state: any): string[] {
  const out: string[] = [];
  const marker = '/current/files/';
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

async function main() {
  // --- أول مزامنة: ملفات فردية بمكانها ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const r = await runCurrentMirror({ store, files: FILES, commit: 'c1', now: '2026-01-01T00:00:00.000Z' });
    check('first sync state synced', r.state === 'synced' && r.verified === true);
    check('first sync uploaded all', r.uploaded === FILES.length);
    const paths = mirrorPaths(state);
    check('mirror has nested src file', paths.includes('src/App.tsx'));
    check('mirror has deep nested file', paths.includes('src/components/View.tsx'));
    check('mirror has engine/brain file', paths.includes('engine/brain/runtime.ts'));
    check('mirror has root file', paths.includes('server.ts') && paths.includes('package.json'));
    check('mirror file count', paths.length === FILES.length);
    const manifest = (await store.readMirrorManifest()).data;
    check('mirror manifest written', Boolean(manifest) && manifest.kind === 'current-mirror' && manifest.fileCount === FILES.length);
    check('mirror manifest treeHash matches', manifest.treeHash === r.treeHash);
    const prior = { version: manifest.version, treeHash: manifest.treeHash, files: manifest.files };
    // --- ثاني مزامنة بلا تغيير ---
    const again = await runCurrentMirror({ store, files: FILES, commit: 'c1', previousMirror: prior });
    check('no-change second sync', again.state === 'no_change' && again.uploaded === 0);
  }

  // --- تعديل ملف ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const r1 = await runCurrentMirror({ store, files: FILES, commit: 'c1' });
    const prior = { version: 1, treeHash: r1.treeHash, files: r1.mirrorManifest.files };
    const modified = FILES.map((f) => f.path === 'src/App.tsx' ? { ...f, content: 'export const App = () => 42;' } : f);
    const r2 = await runCurrentMirror({ store, files: modified, commit: 'c2', previousMirror: prior });
    check('modified sync synced', r2.state === 'synced' && r2.uploaded === 1);
    const file = [...state.files.values()].find((f: any) => f.name === 'App.tsx' && (resolveMirrorPath(state, f) || '').endsWith('current/files/src/App.tsx'));
    check('modified file content updated', file && file.content.toString('utf8').includes('42'));
  }

  // --- حذف ملف: يختفي من CURRENT ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const r1 = await runCurrentMirror({ store, files: FILES, commit: 'c1' });
    const prior = { version: 1, treeHash: r1.treeHash, files: r1.mirrorManifest.files };
    const reduced = FILES.filter((f) => f.path !== 'src/components/View.tsx');
    const r2 = await runCurrentMirror({ store, files: reduced, commit: 'c2', previousMirror: prior });
    check('delete sync removed one', r2.state === 'synced' && r2.removed === 1);
    check('deleted file gone from mirror', !mirrorPaths(state).includes('src/components/View.tsx'));
    check('other files remain', mirrorPaths(state).includes('src/App.tsx') && mirrorPaths(state).includes('server.ts'));
  }

  // --- فشل جزئي: لا ترقية للمرآة ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const r1 = await runCurrentMirror({ store, files: FILES, commit: 'c1' });
    const prior = { version: 1, treeHash: r1.treeHash, files: r1.mirrorManifest.files };
    // نجعل رفع ملف جديد يفشل
    state.failCreateNames.add('New.tsx');
    const withNew = [...FILES, { path: 'src/New.tsx', content: 'export const New = 1;' }];
    const r2 = await runCurrentMirror({ store, files: withNew, commit: 'c2', previousMirror: prior });
    check('partial failure reports failed', r2.state === 'failed' && r2.reason === 'partial_upload');
    const manifest = (await store.readMirrorManifest()).data;
    check('mirror not promoted on partial failure', manifest.treeHash === r1.treeHash);
  }

  // --- فحص الأسرار يوقف قبل الرفع ---
  {
    const state = createFakeDriveState();
    const store = makeStore(state);
    const secretFiles = [...FILES, { path: 'src/leak.ts', content: 'const k = "AIzaSy' + 'Z'.repeat(33) + '";' }];
    const r = await runCurrentMirror({ store, files: secretFiles, commit: 'c1' });
    check('secret scan blocks mirror', r.state === 'secret_blocked' && r.uploaded === 0);
    check('no mirror file uploaded on secret', mirrorPaths(state).length === 0);
  }

  // --- بصمة الشجرة مستقلة عن الترتيب ---
  {
    const a = buildMirrorSnapshot(FILES).treeHash;
    const b = buildMirrorSnapshot([...FILES].reverse()).treeHash;
    check('tree hash order-independent', a === b);
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
