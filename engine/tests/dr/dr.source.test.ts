/**
 * اختبارات مصدر DR الموثوق + حماية "المصدر الناقص".
 *
 * يثبت: جمع الشجرة من Git يعطي المشروع الكامل، وفحص الاكتمال يرفض شجرة ناقصة
 * (حالة الإنتاج السابقة: مجلد Docker يحوي ملفين فقط)، وأن /api/dr/backup
 * و/api/dr/sync يردّان SOURCE_INCOMPLETE بلا أي رفع أو ترقية.
 */

import express from 'express';
import type { Server } from 'node:http';
import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { registerDriveRoutes } from '../../dr/routes';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import {
  collectTrustedSourceTree,
  collectGitTrackedFiles,
  assessSourceCompleteness,
  SOURCE_MIN_FILES,
  SOURCE_REQUIRED_FILES,
} from '../../../tools/dr/cloud-sync.mjs';

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

async function main() {
  // --- 1) جمع الشجرة الموثوقة محلياً ---
  {
    const trusted = collectTrustedSourceTree(process.cwd());
    check('trusted source uses git when available', trusted.source === 'git' && trusted.gitAvailable === true);
    check('trusted source is complete locally', trusted.complete === true);
    check('trusted source has many files', trusted.fileCount >= SOURCE_MIN_FILES, `fileCount=${trusted.fileCount}`);
    check('trusted source includes server.ts', trusted.included.some((f: any) => f.path === 'server.ts'));
    check('trusted source includes engine files', trusted.included.some((f: any) => f.path.startsWith('engine/')));
    check('trusted source includes src files', trusted.included.some((f: any) => f.path.startsWith('src/')));
    check('trusted source excludes node_modules', !trusted.included.some((f: any) => f.path.startsWith('node_modules/')));
    check('trusted source excludes dist', !trusted.included.some((f: any) => f.path.startsWith('dist/')));
    check('trusted source excludes .env', !trusted.included.some((f: any) => f.path === '.env'));
    const git = collectGitTrackedFiles(process.cwd());
    check('git ls-files works', git.ok === true && git.files.length >= SOURCE_MIN_FILES);
  }

  // --- 2) فحص الاكتمال: يرفض الشجرة الناقصة (حالة الإنتاج السابقة) ---
  {
    const twoFiles = [{ path: 'package.json' }, { path: 'package-lock.json' }];
    const a = assessSourceCompleteness(twoFiles);
    check('2-file set is incomplete', a.complete === false);
    check('2-file set reports missing server.ts', a.missingRequired.includes('server.ts'));
    check('2-file set reason is explicit', /required_files_missing/.test(a.reason || ''));

    const empty = assessSourceCompleteness([]);
    check('empty set is incomplete', empty.complete === false);

    const tooFew = assessSourceCompleteness(SOURCE_REQUIRED_FILES.map((p) => ({ path: p })));
    check('required-only but too few is incomplete', tooFew.complete === false && /too_few_files/.test(tooFew.reason || ''));

    const complete = assessSourceCompleteness(
      [...SOURCE_REQUIRED_FILES, ...Array.from({ length: SOURCE_MIN_FILES }, (_, i) => `src/f${i}.ts`)].map((p) => ({ path: p })),
    );
    check('sufficient set is complete', complete.complete === true && complete.reason === null);
  }

  // --- 3) حماية المسار: SOURCE_INCOMPLETE بلا رفع/ترقية ---
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

  registerDriveRoutes(app, {
    authenticateToken,
    requireOwner,
    env: ENV,
    loadControl: () => drControl,
    persistControl: (partial) => { Object.assign(drControl, partial); },
    clientFactory: () => new DriveClient({ transport: makeFakeTransport(fakeState), tokenProvider: () => 'tok' }),
    oauthTransport: makeFakeTransport(fakeState) as any,
    // مصدر ناقص متعمَّد: يجب أن يُرفض بلا أي رفع.
    collectSourceFiles: () => ({ included: [{ path: 'package.json', content: '{}' }], excluded: [], complete: false, source: 'walk', fileCount: 1, minFiles: SOURCE_MIN_FILES, missingRequired: ['server.ts', 'package-lock.json'], reason: 'required_files_missing:server.ts,package-lock.json' }),
    dumpDatabase: async () => 'CREATE TABLE t(id int);\n',
    gitMeta: () => ({ commit: 'b'.repeat(40), branch: 'main', repository: 'r/al-gharabi-ai', project: 'al-gharabi-ai' }),
    now: () => '2026-01-01T00:00:00.000Z',
  });

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const ownerHeaders = { 'x-owner': 'owner-1', 'Content-Type': 'application/json' };

  try {
    const backup = await fetch(`${base}/api/dr/backup`, { method: 'POST', headers: ownerHeaders });
    const backupBody = await backup.json();
    check('backup rejects incomplete source (409)', backup.status === 409 && backupBody.code === 'SOURCE_INCOMPLETE');
    check('backup reports why (missingRequired)', Array.isArray(backupBody.sourceCollection?.missingRequired) && backupBody.sourceCollection.missingRequired.includes('server.ts'));
    check('backup uploaded nothing', backupBody.uploaded === undefined || backupBody.uploaded === 0);

    const sync = await fetch(`${base}/api/dr/sync`, { method: 'POST', headers: ownerHeaders });
    const syncBody = await sync.json();
    check('sync rejects incomplete source (409)', sync.status === 409 && syncBody.code === 'SOURCE_INCOMPLETE');
    check('sync reports reason', typeof syncBody.sourceCollection?.reason === 'string');

    const health = await fetch(`${base}/api/dr/health`);
    const healthBody = await health.json();
    check('health exposes sourceCollection.complete=false', healthBody.dr.sourceCollection?.complete === false);
    check('health sourceCollection no secret', !JSON.stringify(healthBody).includes('GOCSPX') && !JSON.stringify(healthBody).includes(TEST_KEY));
  } finally {
    await new Promise((r) => server.close(r));
  }

  console.log(`dr.source: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.error('  FAIL:', f);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
