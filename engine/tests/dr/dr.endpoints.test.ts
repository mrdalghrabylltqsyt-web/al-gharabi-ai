/**
 * اختبارات مسارات التعافي الكامل على خادم Express حقيقي + Drive وهمي بالكامل.
 *
 * يثبت: مزامنة CURRENT، نقاط الاستعادة الكاملة، حالة الأسرار، خطة الاستعادة،
 * اختبار الاستعادة المعزول، وأن استعادة الإنتاج مقفلة بتأكيد المالك، وحصر owner.
 * لا سرّ حقيقي ولا قاعدة إنتاج.
 */

import express from 'express';
import type { Server } from 'node:http';
import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { registerDriveRoutes } from '../../dr/routes';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { encryptDbDump } from '../../../tools/dr/db-crypto.mjs';
import { buildSecretsBundle } from '../../../tools/dr/secret-crypto.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const KEY = 'e5'.repeat(32);
const ENV: Record<string, string> = {
  DRIVE_OAUTH_CLIENT_ID: '1234567890-drive' + '.apps.googleusercontent.com',
  DRIVE_OAUTH_CLIENT_SECRET: 'GOCSPX-' + 'drive-fake-test-secret-value',
  DRIVE_DB_BACKUP_KEY: KEY,
  DRIVE_TOKEN_ENCRYPTION_KEY: KEY,
  GEMINI_API_KEY: 'AIzaSy' + 'g'.repeat(33),
  SESSION_SECRET: 'sess-' + 'h'.repeat(30),
  DATABASE_URL: 'postgres://production@example/prod',
};
const SQL = JSON.stringify({ backend: 'postgres', rows: [{ key: 'workspace', value: { products: 2 } }] });
const FILES = [
  { path: 'server.ts', content: 'export const server = 1;' },
  { path: 'package.json', content: '{"name":"al-gharabi-ai"}' },
  { path: 'src/App.tsx', content: 'export const App = 1;' },
];

async function main() {
  const fakeState = createFakeDriveState();
  const app = express();
  app.use(express.json());
  const authenticateToken: any = (req: any, res: any, next: any) => {
    const h = String(req.headers['x-owner'] || '');
    if (!h) return res.status(401).json({ success: false, error: 'no session' });
    req.user = { id: h, role: String(req.headers['x-role'] || 'owner') };
    return next();
  };
  const requireOwner: any = (req: any, res: any, next: any) => {
    if (!req.user || req.user.role !== 'owner') return res.status(403).json({ success: false, error: 'owner only' });
    return next();
  };
  const drControl: any = { driveOAuthStates: [], driveRefreshToken: null, driveLastError: null, driveMirror: null };

  registerDriveRoutes(app, {
    authenticateToken,
    requireOwner,
    env: ENV,
    loadControl: () => drControl,
    persistControl: (partial) => { Object.assign(drControl, partial); },
    clientFactory: () => new DriveClient({ transport: makeFakeTransport(fakeState), tokenProvider: () => 'tok' }),
    collectSourceFiles: () => ({ included: FILES, excluded: [] }),
    dumpDatabase: async () => SQL,
    buildSecrets: () => buildSecretsBundle(ENV, { now: '2026-01-01T00:00:00.000Z' }),
    gitMeta: () => ({ commit: 'a'.repeat(40), branch: 'main', repository: 'r/al-gharabi-ai', project: 'al-gharabi-ai' }),
    now: () => '2026-01-01T00:00:00.000Z',
  });

  const server: Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const ownerHeaders = { 'x-owner': 'owner-1', 'Content-Type': 'application/json' };

  try {
    // نفعّل التفويض بضبط رمز تجديد مشفّر مباشرةً (بلا لمس Google):
    // الاختبار يستخدم مفتاح تشفير وهمياً ومزود رمز وهمياً.
    {
      const { encryptDriveSecret } = await import('../../../tools/dr/drive-auth.mjs');
      drControl.driveRefreshToken = encryptDriveSecret('1//fake-refresh-token-not-real-abcdefghijklmnop', ENV as any);
    }

    // --- sync (owner) ---
    {
      const noAuth = await fetch(`${base}/api/dr/sync`, { method: 'POST' });
      check('sync requires auth', noAuth.status === 401);
      const forbidden = await fetch(`${base}/api/dr/sync`, { method: 'POST', headers: { 'x-owner': 'u', 'x-role': 'staff', 'Content-Type': 'application/json' } });
      check('sync owner only', forbidden.status === 403);
      const res = await fetch(`${base}/api/dr/sync`, { method: 'POST', headers: ownerHeaders });
      const body = await res.json();
      check('sync 200 synced', res.status === 200 && body.success === true && body.state === 'synced');
      check('sync uploaded files', body.uploaded === FILES.length);
      check('sync no secret', !JSON.stringify(body).includes('AIzaSy') && !JSON.stringify(body).includes('sess-'));
      // الملفات الفردية موجودة في المرآة
      const mirrorNames = [...fakeState.files.values()].filter((f: any) => f.mimeType !== 'application/vnd.google-apps.folder').map((f: any) => f.name);
      check('mirror has App.tsx file', mirrorNames.includes('App.tsx'));
      check('mirror has server.ts file', mirrorNames.includes('server.ts'));
    }

    // --- backup (owner) => نقطة استعادة كاملة بالأسرار ---
    {
      const res = await fetch(`${base}/api/dr/backup`, { method: 'POST', headers: ownerHeaders });
      const body = await res.json();
      check('backup ok', res.status === 200 && body.state === 'backed_up' && body.verified === true);
      check('backup secrets count', typeof body.secretsCount === 'number' && body.secretsCount >= 2);
      check('backup mirror present', body.mirror && (body.mirror.state === 'synced' || body.mirror.state === 'no_change'));
      check('backup no secret', !JSON.stringify(body).includes('AIzaSy') && !JSON.stringify(body).includes('sess-'));
    }

    // --- recovery-points (owner) ---
    {
      const noAuth = await fetch(`${base}/api/dr/recovery-points`);
      check('recovery-points requires auth', noAuth.status === 401);
      const res = await fetch(`${base}/api/dr/recovery-points`, { headers: ownerHeaders });
      const body = await res.json();
      check('recovery-points 200', res.status === 200 && body.success === true);
      check('recovery-points list', Array.isArray(body.recoveryPoints) && body.recoveryPoints.length >= 1);
      const rp = body.recoveryPoints.find((p: any) => p.id === 'rp-002');
      check('rp-002 verified', rp && rp.verification.ok === true && rp.status === 'verified');
      check('rp-002 has secrets metadata', rp && rp.secrets.encrypted === true && /^[0-9a-f]{64}$/.test(rp.secrets.hash));
      check('recovery-points no secret', !JSON.stringify(body).includes('AIzaSy'));
    }

    // --- secrets/status (owner) ---
    {
      const res = await fetch(`${base}/api/dr/secrets/status`, { headers: ownerHeaders });
      const body = await res.json();
      check('secrets status 200', res.status === 200 && body.success === true);
      check('secrets master key valid', body.masterKey.state === 'valid');
      check('secrets package present + decryptable', body.package.present === true && body.canDecrypt === true);
      check('secrets names only (no values)', Array.isArray(body.package.names) && body.package.names.includes('GEMINI_API_KEY') && !JSON.stringify(body).includes('AIzaSy'));
    }

    // --- restore plan ---
    {
      const res = await fetch(`${base}/api/dr/restore/plan?point=rp-002`, { headers: ownerHeaders });
      const body = await res.json();
      check('restore plan 200', res.status === 200 && body.success === true && body.plan.recoveryPointId === 'rp-002');
      check('restore plan verified', body.plan.verification.ok === true);
      check('restore plan requires confirmation', body.plan.requiresOwnerConfirmation === true);
    }

    // --- restore drill (owner) ---
    {
      const res = await fetch(`${base}/api/dr/restore/drill`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ point: 'rp-002' }) });
      const body = await res.json();
      check('drill 200 ok', res.status === 200 && body.success === true && body.report.ok === true);
      check('drill source + secrets + db', body.report.checks.sourceExtract === true && body.report.checks.secretsDecrypt === true && body.report.checks.databaseDecrypt === true);
      check('drill no isolated db used', body.report.isolatedDatabaseUsed === false && body.report.databaseRestore.attempted === false);
      check('drill no secret leak', !JSON.stringify(body).includes('AIzaSy') && !JSON.stringify(body).includes('sess-'));
      check('drill never wrote production', body.report.wroteToProduction === false);
    }

    // --- production restore مقفلة ---
    {
      const noConfirm = await fetch(`${base}/api/dr/restore/production`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ point: 'rp-002' }) });
      check('production restore requires confirmation', noConfirm.status === 428);
      const confirmed = await fetch(`${base}/api/dr/restore/production`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ point: 'rp-002', confirm: true }) });
      const body = await confirmed.json();
      check('production restore is external/manual', confirmed.status === 501 && body.code === 'PRODUCTION_RESTORE_EXTERNAL');
      check('production restore lists steps', Array.isArray(body.steps) && body.steps.length > 0);
    }

    // --- رفض استخدام قاعدة الإنتاج في drill ---
    {
      // نُحقن قاعدة معزولة تساوي الإنتاج => يجب الرفض.
      const app2 = express();
      app2.use(express.json());
      registerDriveRoutes(app2, {
        authenticateToken, requireOwner, env: { ...ENV, DR_RECOVERY_TEST_DATABASE_URL: ENV.DATABASE_URL },
        loadControl: () => drControl, persistControl: () => {},
        clientFactory: () => new DriveClient({ transport: makeFakeTransport(fakeState), tokenProvider: () => 'tok' }),
        collectSourceFiles: () => ({ included: FILES, excluded: [] }),
        dumpDatabase: async () => SQL,
        buildSecrets: () => buildSecretsBundle(ENV, {}),
        isolatedDatabaseUrl: ENV.DATABASE_URL,
        gitMeta: () => ({ commit: 'a'.repeat(40), branch: 'main', repository: 'r', project: 'p' }),
      });
      const s2: Server = await new Promise((resolve) => { const s = app2.listen(0, '127.0.0.1', () => resolve(s)); });
      const base2 = `http://127.0.0.1:${(s2.address() as any).port}`;
      const res = await fetch(`${base2}/api/dr/restore/drill`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ point: 'rp-002' }) });
      check('refuses production database for drill', res.status === 409);
      s2.close();
    }
  } finally {
    server.close();
  }

  if (failures.length) {
    console.error(`DR ENDPOINTS TESTS FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`DR ENDPOINTS TESTS PASSED: ${passed} checks`);
}

main().catch((err) => {
  console.error('DR ENDPOINTS TESTS CRASHED:', err);
  process.exit(1);
});
