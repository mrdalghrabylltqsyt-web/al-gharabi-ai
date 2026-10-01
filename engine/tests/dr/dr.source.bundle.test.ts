/**
 * اختبارات حزمة المصدر الموثوقة زمن البناء (Build-time trusted source bundle).
 *
 * يثبت:
 *  1) البناء من Git ينتج حزمة كاملة حتمية (نفس الشجرة ⇒ نفس treeHash ونفس الأرشيف).
 *  2) الـcollector في بيئة **بلا .git** (شبيهة بصورة Docker) يقرأ الحزمة ويعطي
 *     complete=true و server.ts موجود و fileCount الحقيقي — بلا تعطيل الحرس.
 *  3) الحرس SOURCE_INCOMPLETE يبقى يرفض إن حُذف ملف مطلوب من الحزمة.
 *  4) الحزمة مرتبطة بالـcommit (تطابق/عدم تطابق صريح) وبلا أي سرّ.
 *  5) فشل جمع المصدر لا يمسّ CURRENT المعتمدة (crash-safe).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { registerDriveRoutes } from '../../dr/routes';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import {
  collectTrustedSourceTree,
  bindBundleCommit,
  SOURCE_MIN_FILES,
} from '../../../tools/dr/cloud-sync.mjs';
import {
  buildTrustedSourceBundle,
  writeSourceBundle,
  readTrustedSourceBundle,
  buildDeterministicTarGz,
  extractTarGz,
  resolveBuildCommit,
  walkProjectSource,
  SOURCE_BUNDLE_ARCHIVE_NAME,
  SOURCE_BUNDLE_MANIFEST_NAME,
} from '../../../tools/dr/source-bundle.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const TEST_KEY = 'c'.repeat(64);
const ENV: Record<string, string> = {
  DRIVE_OAUTH_CLIENT_ID: '1234567890-drive' + '.apps.googleusercontent.com',
  DRIVE_OAUTH_CLIENT_SECRET: 'GOCSPX-' + 'drive-fake-test-secret-value',
  DRIVE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
};

function tmpDir(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dr-bundle-${tag}-`));
}

async function main() {
  const repoRoot = process.cwd();

  // --- 1) البناء من Git: حزمة كاملة حتمية ---
  const built = buildTrustedSourceBundle(repoRoot, {});
  check('build from git succeeds', built.ok === true, built.message || '');
  check('bundle commit is a real sha', /^[0-9a-f]{40}$/.test(built.commit || ''), built.commit || '');
  check('bundle is complete (>= min files)', built.fileCount >= SOURCE_MIN_FILES, `fileCount=${built.fileCount}`);
  check('bundle includes server.ts', built.files.some((f: any) => f.path === 'server.ts'));
  check('bundle includes package-lock.json', built.files.some((f: any) => f.path === 'package-lock.json'));
  check('bundle excludes node_modules/dist/.git/.env', !built.files.some((f: any) => /^(node_modules|dist|\.git)\//.test(f.path) || f.path === '.env'));
  check('bundle is not empty', built.sizeBytes > 1000, `size=${built.sizeBytes}`);

  const built2 = buildTrustedSourceBundle(repoRoot, {});
  check('deterministic treeHash', built.treeHash === built2.treeHash, `${built.treeHash} vs ${built2.treeHash}`);
  check('deterministic archive bytes', built.archive.equals(built2.archive));

  const extracted = extractTarGz(built.archive);
  check('archive extracts', extracted.ok === true && extracted.files.length === built.fileCount);
  check('extracted includes server.ts', extracted.files.some((f: any) => f.path === 'server.ts'));

  // --- 2) كتابة الحزمة + قراءتها ---
  const bundleDir = tmpDir('write');
  const written = writeSourceBundle(bundleDir, built);
  check('bundle written', written.ok === true && fs.existsSync(path.join(bundleDir, SOURCE_BUNDLE_ARCHIVE_NAME)) && fs.existsSync(path.join(bundleDir, SOURCE_BUNDLE_MANIFEST_NAME)));

  const reread = readTrustedSourceBundle({ env: { DR_SOURCE_BUNDLE_DIR: bundleDir }, rootDir: bundleDir });
  check('bundle reread ok', reread.ok === true);
  check('bundle reread treeHash matches content', reread.treeMatches === true);
  check('bundle reread commit preserved', reread.commit === built.commit);

  // --- 3) الـcollector في بيئة بلا .git (شبيهة Docker) يقرأ الحزمة ---
  const dockerSim = tmpDir('docker');
  fs.mkdirSync(path.join(dockerSim, 'dist', 'dr-source'), { recursive: true });
  fs.writeFileSync(path.join(dockerSim, 'package.json'), '{}');
  fs.writeFileSync(path.join(dockerSim, 'package-lock.json'), '{}');
  for (const name of fs.readdirSync(bundleDir)) {
    fs.copyFileSync(path.join(bundleDir, name), path.join(dockerSim, 'dist', 'dr-source', name));
  }
  const collected: any = collectTrustedSourceTree(dockerSim, { env: { RENDER_GIT_COMMIT: built.commit } });
  check('docker-like collector uses bundle', collected.source === 'bundle', `source=${collected.source}`);
  check('docker-like collector is complete', collected.complete === true, collected.reason || '');
  check('docker-like fileCount is the real count', collected.fileCount === built.fileCount, `fileCount=${collected.fileCount}`);
  check('docker-like includes server.ts', collected.included.some((f: any) => f.path === 'server.ts'));
  check('docker-like missingRequired empty', Array.isArray(collected.missingRequired) && collected.missingRequired.length === 0);
  check('docker-like bundle bound to declared commit', collected.bundle?.boundToCommit === true, collected.bundle?.commitBinding);
  check('docker-like no secret in collection summary', !JSON.stringify(collected.bundle).includes(TEST_KEY));

  // --- 4) الحرس يبقى يرفض عند حذف ملف مطلوب من الحزمة ---
  const brokenDir = tmpDir('broken');
  const brokenEntries = extracted.files.filter((f: any) => f.path !== 'server.ts');
  const brokenArchive = buildDeterministicTarGz(brokenEntries);
  fs.mkdirSync(brokenDir, { recursive: true });
  fs.writeFileSync(path.join(brokenDir, SOURCE_BUNDLE_ARCHIVE_NAME), brokenArchive.buffer);
  const brokenManifest = { ...JSON.parse(fs.readFileSync(path.join(bundleDir, SOURCE_BUNDLE_MANIFEST_NAME), 'utf8')), fileCount: brokenEntries.length };
  fs.writeFileSync(path.join(brokenDir, SOURCE_BUNDLE_MANIFEST_NAME), JSON.stringify(brokenManifest));
  const brokenCollected: any = collectTrustedSourceTree(brokenDir, { env: { DR_SOURCE_BUNDLE_DIR: brokenDir } });
  check('guard rejects bundle missing server.ts', brokenCollected.complete === false);
  check('guard reports missing server.ts', Array.isArray(brokenCollected.missingRequired) && brokenCollected.missingRequired.includes('server.ts'));
  check('guard reason is explicit', /required_files_missing/.test(brokenCollected.reason || ''));

  // --- 5) ربط الـcommit: عدم تطابق صريح بلا ادّعاء ---
  const mismatch = bindBundleCommit({ commit: built.commit }, { RENDER_GIT_COMMIT: '0'.repeat(40) });
  check('commit mismatch is explicit', mismatch.bound === false && /commit_mismatch/.test(mismatch.reason));
  const match = bindBundleCommit({ commit: built.commit }, { RENDER_GIT_COMMIT: built.commit });
  check('commit match is bound', match.bound === true);
  const noDeclared = bindBundleCommit({ commit: built.commit }, {});
  check('no declared commit => bound null', noDeclared.bound === null);

  // --- 7) RENDER_GIT_COMMIT: المصدر الوحيد للـcommit في بيئة Render (بلا .git) ---
  const RENDER_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  // (أ) عند وجود RENDER_GIT_COMMIT تُسجَّل نفس القيمة تماماً.
  const withEnv = buildTrustedSourceBundle(repoRoot, { env: { RENDER_GIT_COMMIT: RENDER_SHA }, generatedAt: null });
  check('RENDER_GIT_COMMIT is recorded verbatim', withEnv.commit === RENDER_SHA, `commit=${withEnv.commit}`);
  check('commitSource reports RENDER_GIT_COMMIT', withEnv.commitSource === 'RENDER_GIT_COMMIT', withEnv.commitSource);
  // (ب) بلا RENDER_GIT_COMMIT وبلا Git: لا يُخترع commit (null).
  const noGitDir = tmpDir('nogit');
  const noGitNoEnv: any = resolveBuildCommit(noGitDir, {}, {});
  check('no env + no git => commit null', noGitNoEnv.ok === false && noGitNoEnv.commit === null && noGitNoEnv.source === 'none');
  // (ج) RENDER_GIT_COMMIT بصيغة غير صالحة: يُرفض ولا يُخترع.
  const badEnv: any = resolveBuildCommit(repoRoot, { RENDER_GIT_COMMIT: 'not-a-sha' }, {});
  check('invalid RENDER_GIT_COMMIT rejected (no invention)', badEnv.ok === false && badEnv.commit === null, badEnv.error || '');
  // (د) الأسبقية: options.commit يتقدّم على البيئة.
  const explicit = resolveBuildCommit(repoRoot, { RENDER_GIT_COMMIT: RENDER_SHA }, { commit: 'f'.repeat(40) });
  check('explicit options.commit has priority', explicit.ok === true && explicit.commit === 'f'.repeat(40) && explicit.source === 'provided');

  // --- 8) بيئة شبيهة بـRender (بلا .git، RENDER_GIT_COMMIT موجود) ⇒ حزمة كاملة ومربوطة ---
  // نُقلّد Render بالضبط: شجرة المصدر موجودة لكن بلا `.git`، ويُمرَّر RENDER_GIT_COMMIT.
  const renderSimDir = tmpDir('render-sim');
  for (const f of walkProjectSource(repoRoot)) {
    const abs = path.join(renderSimDir, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content);
  }
  const renderBuilt = buildTrustedSourceBundle(renderSimDir, { env: { RENDER_GIT_COMMIT: RENDER_SHA }, generatedAt: null });
  check('render-like build succeeds without .git', renderBuilt.ok === true, renderBuilt.message || '');
  check('render-like sourceMode is walk (no .git)', renderBuilt.sourceMode === 'walk', renderBuilt.sourceMode);
  check('render-like commit = RENDER_GIT_COMMIT', renderBuilt.commit === RENDER_SHA, `commit=${renderBuilt.commit}`);
  check('render-like bundle complete', renderBuilt.fileCount >= SOURCE_MIN_FILES && renderBuilt.files.some((f: any) => f.path === 'server.ts'), `fileCount=${renderBuilt.fileCount}`);
  const renderBundleDir = tmpDir('render-bundle');
  writeSourceBundle(renderBundleDir, renderBuilt);
  const renderCollected: any = collectTrustedSourceTree(renderSimDir, { env: { DR_SOURCE_BUNDLE_DIR: renderBundleDir, RENDER_GIT_COMMIT: RENDER_SHA } });
  check('render-like collector uses bundle', renderCollected.source === 'bundle', renderCollected.source);
  check('render-like collector complete', renderCollected.complete === true, renderCollected.reason || '');
  check('render-like bundle.commit = RENDER_GIT_COMMIT', renderCollected.bundle?.commit === RENDER_SHA, renderCollected.bundle?.commit);
  check('render-like boundToCommit true', renderCollected.bundle?.boundToCommit === true, renderCollected.bundle?.commitBinding);
  check('render-like commitBinding commit_matches', renderCollected.bundle?.commitBinding === 'commit_matches', renderCollected.bundle?.commitBinding);
  check('render-like treeMatchesManifest true', renderCollected.bundle?.treeMatchesManifest === true);
  // (هـ) بيئة شبيهة بـRender بلا RENDER_GIT_COMMIT ⇒ حزمة كاملة لكن **غير** مربوطة (null).
  const renderNoEnv: any = buildTrustedSourceBundle(renderSimDir, { env: {}, generatedAt: null });
  check('render-like without env => commit null (not bound)', renderNoEnv.commit === null && renderNoEnv.ok === true);
  const renderNoEnvDir = tmpDir('render-noenv');
  writeSourceBundle(renderNoEnvDir, renderNoEnv);
  const renderNoEnvCollected: any = collectTrustedSourceTree(renderSimDir, { env: { DR_SOURCE_BUNDLE_DIR: renderNoEnvDir } });
  check('render-like without env => not bound (null)', renderNoEnvCollected.bundle?.boundToCommit === null, renderNoEnvCollected.bundle?.commitBinding);
  check('render-like without env => commitBinding no_declared_commit', renderNoEnvCollected.bundle?.commitBinding === 'no_declared_commit', renderNoEnvCollected.bundle?.commitBinding);
  check('render-like without env => complete still true (guard intact)', renderNoEnvCollected.complete === true, renderNoEnvCollected.reason || '');

  // --- 6) فشل جمع المصدر لا يمسّ CURRENT المعتمدة (crash-safe) ---
  {
    const fakeState = createFakeDriveState();
    const app = express();
    app.use(express.json());
    const authenticateToken: any = (req: any, res: any, next: any) => {
      if (!req.headers['x-owner']) return res.status(401).json({ success: false, error: 'no session' });
      req.user = { id: 'owner-1', role: 'owner' };
      return next();
    };
    const requireOwner: any = (_req: any, _res: any, next: any) => next();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };

    let collectMode: 'complete' | 'incomplete' = 'complete';
    const fullSource = collected.included.map((f: any) => ({ path: f.path, content: f.content }));
    registerDriveRoutes(app, {
      authenticateToken,
      requireOwner,
      env: ENV,
      loadControl: () => drControl,
      persistControl: (partial) => { Object.assign(drControl, partial); },
      clientFactory: () => new DriveClient({ transport: makeFakeTransport(fakeState), tokenProvider: () => 'tok' }),
      oauthTransport: makeFakeTransport(fakeState) as any,
      collectSourceFiles: () => (collectMode === 'complete'
        ? { included: fullSource, excluded: [], complete: true, source: 'bundle', fileCount: fullSource.length, minFiles: SOURCE_MIN_FILES, missingRequired: [], reason: null }
        : { included: [{ path: 'package.json', content: '{}' }], excluded: [], complete: false, source: 'walk', fileCount: 1, minFiles: SOURCE_MIN_FILES, missingRequired: ['server.ts'], reason: 'required_files_missing:server.ts' }),
      dumpDatabase: async () => 'CREATE TABLE t(id int);\n',
      gitMeta: () => ({ commit: 'b'.repeat(40), branch: 'main', repository: 'r/al-gharabi-ai', project: 'al-gharabi-ai' }),
      now: () => '2026-01-01T00:00:00.000Z',
    });

    const server: Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const port = (server.address() as any).port;
    const base = `http://127.0.0.1:${port}`;
    const headers = { 'x-owner': 'owner-1', 'Content-Type': 'application/json' };
    try {
      const sync1 = await fetch(`${base}/api/dr/sync`, { method: 'POST', headers });
      const sync1Body = await sync1.json();
      check('initial sync with complete source succeeds', sync1.status === 200 && sync1Body.state === 'synced', `state=${sync1Body.state}`);
      const health1 = await (await fetch(`${base}/api/dr/health`)).json();
      const v1 = health1.dr.currentVersion;
      const h1 = health1.dr.currentTreeHash;
      check('CURRENT v1 established', Number.isFinite(v1) && v1 >= 1 && typeof h1 === 'string' && h1.length === 64);

      collectMode = 'incomplete';
      const sync2 = await fetch(`${base}/api/dr/sync`, { method: 'POST', headers });
      const sync2Body = await sync2.json();
      check('sync with incomplete source rejected (409)', sync2.status === 409 && sync2Body.code === 'SOURCE_INCOMPLETE');
      const backup2 = await fetch(`${base}/api/dr/backup`, { method: 'POST', headers });
      const backup2Body = await backup2.json();
      check('backup with incomplete source rejected (409)', backup2.status === 409 && backup2Body.code === 'SOURCE_INCOMPLETE');

      const health2 = await (await fetch(`${base}/api/dr/health`)).json();
      check('CURRENT version unchanged after failed collection', health2.dr.currentVersion === v1, `${health2.dr.currentVersion} vs ${v1}`);
      check('CURRENT treeHash unchanged after failed collection', health2.dr.currentTreeHash === h1);
      // health يُخزّن ملخّص جمع المصدر 5 دقائق (بلا قراءة المستودع عند كل نداء)،
      // فيُتحقق من وجود كتلة المصدر بلا سرّ، لا من طزاجتها اللحظية.
      check('health exposes sourceCollection block (no secret)', typeof health2.dr.sourceCollection === 'object' && health2.dr.sourceCollection !== null && !JSON.stringify(health2.dr).includes(TEST_KEY));
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  console.log(`dr.source.bundle: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.error('  FAIL:', f);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
