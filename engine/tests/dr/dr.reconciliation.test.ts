/**
 * اختبارات الفحص الساعي (reconciliation) + مشغّل التغيّر + وثائق RECOVERY الموحّدة.
 *
 * يثبت بسلوك حقيقي (خادم Express + Google Drive وهمي، بلا شبكة):
 *  - المؤقّت الساعي مضبوط على 60 دقيقة ومفعّل.
 *  - أول تشغيل: مزامنة CURRENT عند وجود تغيّر (synced).
 *  - تكرار بلا تغيّر: no-op (لا رفع).
 *  - تغيّر المصدر: يُكتشف ويُزامَن.
 *  - مصدر ناقص: SOURCE_INCOMPLETE بلا أي تغيير في CURRENT.
 *  - قفل التزامن: الدورة المتوازية الثانية تُتخطّى.
 *  - restart/idempotency: الحالة تصمد وتُنتج no-op بلا رفع مكرّر.
 *  - وثائق RECOVERY الموحّدة الثلاث تُكتب بلا أسرار.
 */

import express from 'express';
import type { Server } from 'node:http';
import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { registerDriveRoutes } from '../../dr/routes';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../../tools/dr/drive-store.mjs';
import { SOURCE_MIN_FILES } from '../../../tools/dr/cloud-sync.mjs';

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
  DRIVE_DB_BACKUP_KEY: 'd'.repeat(64),
};

/** مصدر كامل صالح (يتجاوز حد الاكتمال). */
function fullSource(tag = 'v1') {
  const included = [
    { path: 'server.ts', content: `export const x = '${tag}';` },
    { path: 'package.json', content: '{"name":"al-gharabi-ai"}' },
    { path: 'package-lock.json', content: '{"lockfileVersion":3}' },
  ];
  for (let i = 0; i < 14; i += 1) included.push({ path: `engine/f${i}.ts`, content: `export const f${i} = '${tag}';` });
  return { included, excluded: [], complete: true, source: 'walk', fileCount: included.length, minFiles: SOURCE_MIN_FILES, missingRequired: [], reason: null };
}

/** مصدر ناقص (حالة صورة Docker: ملفان). */
function incompleteSource() {
  return { included: [{ path: 'package.json', content: '{}' }], excluded: [], complete: false, source: 'walk', fileCount: 1, minFiles: SOURCE_MIN_FILES, missingRequired: ['server.ts', 'package-lock.json'], reason: 'required_files_missing:server.ts,package-lock.json' };
}

interface Harness { server: Server; base: string; app: any; drControl: any; }

async function makeApp(state: any, getCollector: () => any, drControl: any, gitMeta?: () => any): Promise<Harness> {
  const app = express();
  app.use(express.json());
  const authenticateToken: any = (req: any, res: any, next: any) => {
    if (!req.headers['x-owner']) return res.status(401).json({ success: false, error: 'no session' });
    req.user = { id: 'owner-1', role: 'owner' };
    return next();
  };
  const requireOwner: any = (_req: any, _res: any, next: any) => next();
  registerDriveRoutes(app, {
    authenticateToken,
    requireOwner,
    env: ENV,
    loadControl: () => drControl,
    persistControl: (partial) => { Object.assign(drControl, partial); },
    clientFactory: () => new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' }),
    oauthTransport: makeFakeTransport(state) as any,
    collectSourceFiles: () => getCollector(),
    dumpDatabase: async () => 'CREATE TABLE t(id int);\n',
    gitMeta: gitMeta || (() => ({ commit: 'a'.repeat(40), branch: 'main', repository: 'r/al-gharabi-ai', project: 'al-gharabi-ai' })),
    now: () => '2026-01-01T00:00:00.000Z',
  });
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = (server.address() as any).port;
  return { server, base: `http://127.0.0.1:${port}`, app, drControl };
}

async function main() {
  const state = createFakeDriveState();
  const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
  let collector: any = fullSource('v1');
  const h = await makeApp(state, () => collector, drControl);

  try {
    // --- 1) المؤقّت الساعي مضبوط ومفعّل ---
    const recon = h.app.drReconciliation;
    check('reconciliation interface exposed', Boolean(recon && typeof recon.runCycle === 'function' && typeof recon.status === 'function'));
    check('hourly interval is 1 hour', recon.hourly.intervalMs === 60 * 60 * 1000);
    const st0 = recon.status();
    check('hourly enabled', st0.enabled === true);
    check('hourly interval minutes = 60', st0.intervalMinutes === 60);
    check('hourly not yet run', st0.lastReconciliationResult === null && st0.reconciliationCount === 0);

    // --- 2) change-trigger: أول تشغيل يزامن عند وجود تغيّر ---
    const r1 = await recon.runCycle('manual');
    check('first cycle syncs (change)', r1.outcome === 'synced', `outcome=${r1.outcome} reason=${r1.reason}`);
    check('first cycle uploaded files', Number(r1.uploaded) > 0, `uploaded=${r1.uploaded}`);
    const st1 = recon.status();
    check('status records synced', st1.lastReconciliationResult === 'synced');
    check('status counts one run', st1.reconciliationCount === 1);
    check('status has lastReconciliationAt', typeof st1.lastReconciliationAt === 'string');
    check('mirror treeHash persisted', typeof drControl.driveMirror?.treeHash === 'string' && drControl.driveMirror.treeHash.length === 64);

    // --- 3) no-op بلا تغيّر (لا رفع) ---
    const requestsBefore = state.requests.length;
    const r2 = await recon.runCycle('manual');
    check('repeat cycle is no-op', r2.outcome === 'no_op', `outcome=${r2.outcome}`);
    check('no-op reason is in_sync', r2.reason === 'in_sync');
    check('no-op performed no drive requests', state.requests.length === requestsBefore, `delta=${state.requests.length - requestsBefore}`);

    // --- 4) تغيّر المصدر يُكتشف ويُزامَن ---
    collector = fullSource('v2');
    const r3 = await recon.runCycle('manual');
    check('source change triggers sync', r3.outcome === 'synced', `outcome=${r3.outcome}`);
    check('source change uploaded', Number(r3.uploaded) >= 1, `uploaded=${r3.uploaded}`);

    // --- 5) مصدر ناقص: SOURCE_INCOMPLETE بلا تغيير ---
    const treeBeforeIncomplete = drControl.driveMirror.treeHash;
    collector = incompleteSource();
    const r4 = await recon.runCycle('manual');
    check('incomplete source reported', r4.outcome === 'source_incomplete', `outcome=${r4.outcome}`);
    check('incomplete source has reason', typeof r4.sourceCollection?.reason === 'string');
    check('incomplete source did not change CURRENT', drControl.driveMirror.treeHash === treeBeforeIncomplete);
    check('incomplete source recorded in status', recon.status().lastReconciliationResult === 'source_incomplete');

    // --- 6) قفل التزامن: دورة متوازية ثانية تُتخطّى ---
    collector = fullSource('v3');
    const p1 = recon.runCycle('manual');
    const p2 = recon.runCycle('manual');
    const [c1, c2] = await Promise.all([p1, p2]);
    const skipped = [c1, c2].filter((c) => c.outcome === 'skipped' && c.reason === 'already_running').length;
    const synced = [c1, c2].filter((c) => c.outcome === 'synced').length;
    check('concurrent lock skips one cycle', skipped === 1, `skipped=${skipped} synced=${synced}`);
    check('concurrent lock still syncs once', synced === 1);

    // --- 7) restart/idempotency: نفس الحالة => no-op بلا رفع مكرّر ---
    const persistedMirror = JSON.parse(JSON.stringify(drControl.driveMirror));
    const persistedRecon = JSON.parse(JSON.stringify(drControl.driveReconciliation));
    await new Promise((r) => h.server.close(r));
    collector = fullSource('v3');
    const h2 = await makeApp(state, () => collector, drControl);
    try {
      const st2 = h2.app.drReconciliation.status();
      check('restart restores mirror', drControl.driveMirror.treeHash === persistedMirror.treeHash);
      check('restart restores last result', drControl.driveReconciliation.lastReconciliationResult === persistedRecon.lastReconciliationResult);
      check('restart count preserved', st2.reconciliationCount === persistedRecon.reconciliationCount);
      const requestsBeforeRestart = state.requests.length;
      const r5 = await h2.app.drReconciliation.runCycle('manual');
      check('restart idempotent (no-op)', r5.outcome === 'no_op', `outcome=${r5.outcome}`);
      check('restart did not re-upload', state.requests.length === requestsBeforeRestart);
    } finally {
      await new Promise((r) => h2.server.close(r));
    }

    // --- 8) وثائق RECOVERY الموحّدة ---
    collector = fullSource('v4');
    const h3 = await makeApp(state, () => collector, drControl);
    const store = new DriveStore({ client: new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' }), storedIdentity: drControl.driveFolderIdentity || null });
    try {
      const backup = await fetch(`${h3.base}/api/dr/backup`, { method: 'POST', headers: { 'x-owner': 'owner-1', 'Content-Type': 'application/json' } });
      const backupBody = await backup.json();
      check('backup succeeded', backup.status === 200 && backupBody.state === 'backed_up', `status=${backup.status} state=${backupBody.state} reason=${backupBody.reason} message=${backupBody.message} details=${JSON.stringify(backupBody.errorDetails)}`);

      const startHere = await store.readRecoveryDoc('START-HERE.md');
      const guide = await store.readRecoveryDoc('RECOVERY-GUIDE.md');
      const manifest = await store.readRecoveryJson('RECOVERY-MANIFEST.json');
      check('START-HERE.md written', startHere.ok && String(startHere.data).includes('START HERE'));
      check('RECOVERY-GUIDE.md written', guide.ok && String(guide.data).includes('RECOVERY GUIDE'));
      check('RECOVERY-MANIFEST.json written', manifest.ok && manifest.data?.kind === 'recovery-manifest');
      const guideText = String(guide.data);
      check('guide explains CURRENT location', guideText.includes('CURRENT/'));
      check('guide explains HISTORY location', guideText.includes('HISTORY/rp-XXX'));
      check('guide explains encrypted database', guideText.includes('database.enc'));
      check('guide explains encrypted secrets', guideText.includes('secrets.enc'));
      check('guide explains master key not stored', guideText.includes('لا يُحفظ داخل النسخة'));
      check('guide explains restore order', guideText.includes('ترتيب الاستعادة'));
      check('guide explains automation boundaries', guideText.includes('يحتاج تدخّل المالك'));
      check('manifest has latest recovery point', typeof manifest.data?.latestRecoveryPointId === 'string');
      check('manifest lists recovery points', Array.isArray(manifest.data?.recoveryPoints) && manifest.data.recoveryPoints.length >= 1);
      check('manifest has restore order', Array.isArray(manifest.data?.restoreOrder) && manifest.data.restoreOrder.length >= 8);
      // لا أسرار في الوثائق.
      const allDocs = String(startHere.data) + guideText + JSON.stringify(manifest.data);
      check('recovery docs have no secret values', !allDocs.includes('GOCSPX') && !allDocs.includes(TEST_KEY) && !allDocs.includes('d'.repeat(64)));
      // الأسماء القديمة ما زالت تُكتب (توافق خلفي).
      const legacy = await store.readRecoveryDoc('recovery-information.md');
      check('legacy recovery doc still written', legacy.ok && String(legacy.data).includes('معلومات التعافي'));
    } finally {
      await new Promise((r) => h3.server.close(r));
    }

    // --- 9) health يعرض الحالة الصادقة (بلا أسرار) ---
    const h4 = await makeApp(state, () => collector, drControl);
    try {
      const health = await fetch(`${h4.base}/api/dr/health`);
      const hb = await health.json();
      check('health exposes changeTrigger', hb.dr.changeTrigger?.enabled === true);
      check('health exposes hourlyReconciliation', hb.dr.hourlyReconciliation?.intervalMinutes === 60);
      check('health exposes lastReconciliationAt', 'lastReconciliationAt' in hb.dr);
      check('health exposes lastReconciliationResult', 'lastReconciliationResult' in hb.dr);
      check('health reconciliation no secret', !JSON.stringify(hb).includes('GOCSPX') && !JSON.stringify(hb).includes(TEST_KEY));
    } finally {
      await new Promise((r) => h4.server.close(r));
    }
  } finally {
    try { await new Promise((r) => h.server.close(r)); } catch { /* أُغلق مسبقاً */ }
  }

  console.log(`dr.reconciliation: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.error('  FAIL:', f);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
