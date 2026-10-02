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
import { makeFakeTokenTransport } from './helpers/fakeTokenTransport';
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
  DR_RECOVERY_MASTER_KEY: KEY,
  DR_RECOVERY_VAULT_KEY: KEY,
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
    oauthTransport: makeFakeTokenTransport(),
    collectSourceFiles: () => ({ included: FILES, excluded: [], complete: true, source: 'test', fileCount: FILES.length }),
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
      // health يعلن المرآة متزامنة (بصمة شجرة فعلية) وبلا خطأ — لا فشل صامت.
      const health = await (await fetch(`${base}/api/dr/health`)).json();
      check('health currentMirror synced', health.dr.currentMirror.synced === true && /^[0-9a-f]{64}$/.test(health.dr.currentMirror.treeHash));
      check('health currentMirror no error', health.dr.currentMirror.error === null && health.dr.recoverySystem.currentMirror === true);
      // نموذج النسخة المُرقّمة: currentVersion + مرجع الاعتماد + سلامة + لا تنظيف معلّق.
      check('health currentVersion from HEAD', health.dr.currentVersion === 1 && health.dr.currentTreeHash === health.dr.currentMirror.treeHash);
      check('health currentFileCount', health.dr.currentFileCount === FILES.length);
      check('health cleanupPending false', health.dr.cleanupPending === false && Array.isArray(health.dr.pendingCleanup) && health.dr.pendingCleanup.length === 0);
      check('health integrity from HEAD.json', health.dr.integrity.source === 'HEAD.json' && health.dr.integrity.headVersion === 1 && health.dr.integrity.verified === true);
      check('health versioned fields no secret', !JSON.stringify({ v: health.dr.currentVersion, i: health.dr.integrity, c: health.dr.pendingCleanup }).includes('AIzaSy'));
      // تشخيص رمز التجديد: مخزّن، مفكوك، والتجديد نجح (عبر ناقل وهمي) — بلا سرّ.
      check('health refreshToken diagnostic ok', health.dr.refreshToken.stored === true && health.dr.refreshToken.decryptable === true && health.dr.refreshToken.providerRefresh === 'ok' && health.dr.refreshToken.reason === 'token_refresh_ok');
      check('health refreshToken no secret', !JSON.stringify(health.dr.refreshToken).includes('1//') && !JSON.stringify(health.dr.refreshToken).includes('ya29.'));
      check('health refreshToken exposes providerCode/httpStatus keys', 'providerCode' in health.dr.refreshToken && 'httpStatus' in health.dr.refreshToken);
      check('health exposes single nextAction', typeof health.dr.nextAction === 'string' && typeof health.dr.nextActionMessage === 'string' && !health.dr.nextActionMessage.includes('GOCSPX'));
      check('health exposes refresh truth flags', health.dr.refreshTokenTested === true && health.dr.refreshTokenUsable === true && health.dr.reauthorizationNeeded === false);
      // اعتماد OAuth Client: يظهر وجود/صيغة/بصمة آمنة بلا أي قيمة سرّية.
      check('health oauthClient safe', health.dr.oauthClient.clientIdPresent === true && health.dr.oauthClient.clientSecretPresent === true && /^[0-9a-f]{12}$/.test(health.dr.oauthClient.clientIdFingerprint));
      check('health oauthClient no secret', !JSON.stringify(health.dr.oauthClient).includes('apps.googleusercontent.com') && !JSON.stringify(health.dr.oauthClient).includes('GOCSPX'));
    }

    // --- فشل المرآة يُعلن صراحةً (لا فشل صامت) ---
    {
      const failState = createFakeDriveState();
      // نمنع إنشاء بيان النسخة الجديدة => تفشل المزامنة قبل الاعتماد، ويظهر سببها في health.
      failState.failCreateNames.add('manifest.json');
      const appF = express();
      appF.use(express.json());
      const ctrlF: any = { driveOAuthStates: [], driveRefreshToken: null, driveLastError: null, driveMirror: null };
      registerDriveRoutes(appF, {
        authenticateToken, requireOwner, env: ENV,
        loadControl: () => ctrlF, persistControl: (p) => { Object.assign(ctrlF, p); },
        clientFactory: () => new DriveClient({ transport: makeFakeTransport(failState), tokenProvider: () => 'tok' }),
        oauthTransport: makeFakeTokenTransport(),
        collectSourceFiles: () => ({ included: FILES, excluded: [], complete: true, source: 'test', fileCount: FILES.length }),
        dumpDatabase: async () => SQL,
        buildSecrets: () => buildSecretsBundle(ENV, { now: '2026-01-01T00:00:00.000Z' }),
        gitMeta: () => ({ commit: 'a'.repeat(40), branch: 'main', repository: 'r/al-gharabi-ai', project: 'al-gharabi-ai' }),
        now: () => '2026-01-01T00:00:00.000Z',
      });
      const sF: Server = await new Promise((resolve) => { const s = appF.listen(0, '127.0.0.1', () => resolve(s)); });
      const portF = (sF.address() as any).port;
      const { encryptDriveSecret } = await import('../../../tools/dr/drive-auth.mjs');
      ctrlF.driveRefreshToken = encryptDriveSecret('1//fake-refresh-token', ENV);
      try {
        const sync = await fetch(`http://127.0.0.1:${portF}/api/dr/sync`, { method: 'POST', headers: ownerHeaders });
        check('sync fails when mirror blocked', sync.status === 500);
        const health = await (await fetch(`http://127.0.0.1:${portF}/api/dr/health`)).json();
        check('health currentMirror synced false on failure', health.dr.currentMirror.synced === false);
        check('health exposes mirror error (no silent failure)', typeof health.dr.currentMirror.error === 'string' && health.dr.currentMirror.error.length > 0);
        check('health mirror error has no secret', !health.dr.currentMirror.error.includes('AIzaSy') && !health.dr.currentMirror.error.includes('sess-'));
      } finally {
        await new Promise((r) => sF.close(r));
      }
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

    // --- خزنة مفاتيح الطوارئ: حالة/مزامنة/فحص/نسخة/اختبار (owner) ---
    {
      const noAuth = await fetch(`${base}/api/dr/key-vault/status`);
      check('key-vault status requires auth', noAuth.status === 401);
      const staff = await fetch(`${base}/api/dr/key-vault/sync`, { method: 'POST', headers: { 'x-owner': 'u', 'x-role': 'staff', 'Content-Type': 'application/json' } });
      check('key-vault sync owner only', staff.status === 403);

      const status0 = await (await fetch(`${base}/api/dr/key-vault/status`, { headers: ownerHeaders })).json();
      check('key-vault status exposes inventory', Array.isArray(status0.inventory) && status0.inventory.length >= 30);
      check('key-vault status inventory no values', status0.inventory.every((e: any) => typeof e.value === 'undefined'));
      check('key-vault status vaultKey valid', status0.keyVault.vaultKey.state === 'valid');

      const sync = await fetch(`${base}/api/dr/key-vault/sync`, { method: 'POST', headers: ownerHeaders });
      const syncBody = await sync.json();
      // قد تكون الخزنة زُومنت تلقائياً مع النسخة الاحتياطية أعلاه => no_change صادق.
      check('key-vault sync 200 (synced|no_change)', sync.status === 200 && syncBody.success === true && (syncBody.state === 'synced' || syncBody.state === 'no_change') && syncBody.version === 1);
      check('key-vault sync recordCount', syncBody.recordCount >= 5);
      check('key-vault sync no secret', !JSON.stringify(syncBody).includes('AIzaSy') && !JSON.stringify(syncBody).includes('sess-') && !JSON.stringify(syncBody).includes(KEY));

      // الحزمة مشفّرة فعلاً على Drive، ولا نص سرّي مكشوف.
      const vaultPkg = [...fakeState.files.values()].find((f: any) => f.name === 'current.enc');
      check('key-vault package on drive', Boolean(vaultPkg));
      const pkgText = vaultPkg ? Buffer.from(vaultPkg.content).toString('utf8') : '';
      check('key-vault package encrypted + no plaintext', pkgText.startsWith('GHARABI-KEY-VAULT-V1') && !pkgText.includes('AIzaSy') && !pkgText.includes('sess-') && !pkgText.includes('DR_RECOVERY_MASTER_KEY'));

      const verify = await fetch(`${base}/api/dr/key-vault/verify`, { method: 'POST', headers: ownerHeaders });
      const verifyBody = await verify.json();
      check('key-vault verify ok', verify.status === 200 && verifyBody.verified === true && verifyBody.integrity.recordsMatch === true);
      check('key-vault verify no secret', !JSON.stringify(verifyBody).includes('AIzaSy') && !JSON.stringify(verifyBody).includes(KEY));

      const drill = await fetch(`${base}/api/dr/key-vault/drill`, { method: 'POST', headers: ownerHeaders });
      const drillBody = await drill.json();
      check('key-vault drill ok', drill.status === 200 && drillBody.success === true && drillBody.state === 'recovered' && drillBody.wroteToProduction === false);
      check('key-vault drill returns names only', Array.isArray(drillBody.names) && drillBody.names.includes('DR_RECOVERY_MASTER_KEY') && !JSON.stringify(drillBody.names).includes(KEY));

      // health يعلن خزنة المفاتيح بلا أسرار.
      const health = await (await fetch(`${base}/api/dr/health`)).json();
      check('health keyVault block', health.dr.keyVault.enabled === true && health.dr.keyVault.vaultKey.state === 'valid' && health.dr.keyVault.inventoryCount >= 30);
      check('health keyVault no secret', !JSON.stringify(health.dr.keyVault).includes(KEY) && !JSON.stringify(health.dr.keyVault).includes('AIzaSy'));
      check('health recoverySystem keyVaultEncryptionRequired', health.dr.recoverySystem.keyVaultEncryptionRequired === true);

      // النسخة الاحتياطية تُزامن الخزنة تلقائياً وتُعلن النتيجة بلا سرّ.
      const backup = await fetch(`${base}/api/dr/backup`, { method: 'POST', headers: ownerHeaders });
      const backupBody = await backup.json();
      check('backup syncs key vault', backupBody.keyVault && (backupBody.keyVault.state === 'synced' || backupBody.keyVault.state === 'no_change'));
      check('backup keyVault no secret', !JSON.stringify(backupBody.keyVault || {}).includes(KEY));
    }

    // --- الاستعادة المستقلة (Standalone Recovery) + الاحتفاظ ---
    {
      // نقاط الاستعادة المستقلة (owner): قائمة + جاهزية + بلا سرّ.
      const noAuth = await fetch(`${base}/api/dr/standalone/points`);
      check('standalone points requires auth', noAuth.status === 401);
      const staff = await fetch(`${base}/api/dr/standalone/points`, { headers: { 'x-owner': 'u', 'x-role': 'staff' } });
      check('standalone points owner only', staff.status === 403);
      const pointsRes = await fetch(`${base}/api/dr/standalone/points`, { headers: ownerHeaders });
      const pointsBody = await pointsRes.json();
      check('standalone points 200', pointsRes.status === 200 && pointsBody.success === true);
      check('standalone points list', Array.isArray(pointsBody.points) && pointsBody.points.length >= 1);
      check('standalone points readiness exposed', pointsBody.readiness.drive.configured === true && pointsBody.readiness.vaultKey.present === true);
      check('standalone points no secret', !JSON.stringify(pointsBody).includes('AIzaSy') && !JSON.stringify(pointsBody).includes(KEY));
      const latest = pointsBody.points.find((p: any) => p.restorable === true);
      check('standalone has restorable point', Boolean(latest && latest.manifest && latest.folderId));

      // الاستعادة تتطلّب تأكيداً صريحاً.
      const noConfirm = await fetch(`${base}/api/dr/standalone/restore`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ point: latest.id }) });
      check('standalone restore requires confirm', noConfirm.status === 428);

      // رفض قاعدة الإنتاج.
      const prodDb = await fetch(`${base}/api/dr/standalone/restore`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ point: latest.id, confirm: true, targetDatabaseUrl: ENV.DATABASE_URL, applyDatabase: true }) });
      check('standalone restore refuses production db', prodDb.status === 409);

      // استعادة فعلية كاملة (بلا قاعدة هدف) => تقرير صادق بلا سرّ.
      const restore = await fetch(`${base}/api/dr/standalone/restore`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ point: latest.id, confirm: true, vaultKey: ENV.DR_RECOVERY_VAULT_KEY }) });
      const restoreBody = await restore.json();
      check('standalone restore 200 ok', restore.status === 200 && restoreBody.success === true, JSON.stringify(restoreBody.report?.problems || restoreBody));
      check('standalone restore reached complete', restoreBody.report.stage === 'complete');
      check('standalone restore decrypted vault+secrets+db', restoreBody.report.checks.vaultDecrypt === true && restoreBody.report.checks.secretsDecrypt === true && restoreBody.report.checks.databaseDecrypt === true);
      check('standalone restore extracted source', restoreBody.report.extractedFileCount >= FILES.length);
      check('standalone restore no secret', !JSON.stringify(restoreBody).includes('AIzaSy') && !JSON.stringify(restoreBody).includes(KEY));
      check('standalone restore no production write', restoreBody.report.wroteToProduction === false);

      // مفتاح خزنة خاطئ => فشل صريح في مرحلة الفتح بلا استخراج.
      const badKey = await fetch(`${base}/api/dr/standalone/restore`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ point: latest.id, confirm: true, vaultKey: '00'.repeat(32) }) });
      const badKeyBody = await badKey.json();
      check('standalone wrong vault key blocked', badKey.status === 200 && badKeyBody.success === false && badKeyBody.report.failureStage === 'open_vault');

      // الاحتفاظ: الحالة (owner) + تقليم يدوي بلا حذف النقاط المحميّة.
      const retStatus = await fetch(`${base}/api/dr/retention/status`, { headers: ownerHeaders });
      const retBody = await retStatus.json();
      check('retention status 200', retStatus.status === 200 && retBody.success === true);
      check('retention keep default 3', retBody.retention.keep === 3 && retBody.retention.enabled === true);
      check('retention protects rp-002..004', retBody.retention.protectedIds.includes('rp-002') && retBody.retention.protectedIds.includes('rp-003') && retBody.retention.protectedIds.includes('rp-004'));
      const prune = await fetch(`${base}/api/dr/retention/prune`, { method: 'POST', headers: ownerHeaders });
      const pruneBody = await prune.json();
      check('retention prune 200', prune.status === 200 && pruneBody.success === true);
      check('retention prune deleted nothing protected', pruneBody.retention.deleted.length === 0, JSON.stringify(pruneBody.retention));
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
        oauthTransport: makeFakeTokenTransport(),
        collectSourceFiles: () => ({ included: FILES, excluded: [], complete: true, source: 'test', fileCount: FILES.length }),
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
