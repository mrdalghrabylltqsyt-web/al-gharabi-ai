/**
 * اختبارات سدّ فجوات النسخ الاحتياطي (DR):
 *  A) تنبيه المالك عند فشل النسخة (عبر القناة القائمة، بلا إغراق).
 *  B) موازنة محتوى قاعدة البيانات الحية مقابل آخر نقطة استعادة: يكشف بيانات
 *     جديدة (منتجات/أسعار/مبيعات) **بلا تغيير كود** — وهي فجوة لم تكن مكتشفة.
 *
 * كل شيء فوق Google Drive وهمي محلي (بلا شبكة وبلا مزوّد حقيقي).
 */

import express from 'express';
import type { Server } from 'node:http';
import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { registerDriveRoutes } from '../../dr/routes';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { computeLiveDatabaseFingerprint, evaluateDatabaseBalance } from '../../dr/dbBalance';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const TEST_KEY = 'c'.repeat(64);
const ENV: Record<string, string> = {
  DRIVE_OAUTH_CLIENT_ID: '1234567890-test.apps.googleusercontent.com',
  DRIVE_OAUTH_CLIENT_SECRET: 'GOCSPX-not-a-real-secret-value',
  DRIVE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
  DRIVE_DB_BACKUP_KEY: 'd'.repeat(64),
  DR_RECOVERY_VAULT_KEY: 'e'.repeat(64),
  DR_RECOVERY_MASTER_KEY: 'f'.repeat(64),
};

function fullSource(tag = 'v1') {
  const included = [
    { path: 'server.ts', content: `export const x = '${tag}';` },
    { path: 'package.json', content: '{"name":"al-gharabi-ai"}' },
    { path: 'package-lock.json', content: '{"lockfileVersion":3}' },
  ];
  for (let i = 0; i < 14; i += 1) included.push({ path: `engine/f${i}.ts`, content: `export const f${i} = '${tag}';` });
  return { included, excluded: [], complete: true, source: 'walk', fileCount: included.length, minFiles: 10, missingRequired: [], reason: null };
}

/** dump قاعدة بيانات شبيه ببنية الملف الحقيقية (keys.state.workspace...). */
function makeDump(productCount: number, saleCount: number, exportedAt = '2026-01-01T00:00:00.000Z'): string {
  const products = Array.from({ length: productCount }, (_, i) => ({ id: `p${i}`, name: `منتج ${i}`, price: 100000 + i }));
  const sales = Array.from({ length: saleCount }, (_, i) => ({ id: `s${i}`, productId: `p0` }));
  return JSON.stringify({ backend: 'file', exportedAt, keys: { state: { schemaVersion: 1, savedAt: exportedAt, workspace: { products, sales } }, usage: {}, control: {} } }, null, 2);
}

interface Harness { server: Server; base: string; app: any; drControl: any; alerts: any[]; setDump: (d: () => Promise<string>) => void; }

async function makeApp(state: any, getCollector: () => any, drControl: any, opts: { dumpDatabase?: () => Promise<string> } = {}): Promise<Harness> {
  const app = express();
  app.use(express.json());
  const alerts: any[] = [];
  let dump = opts.dumpDatabase || (async () => 'CREATE TABLE t(id int);\n');
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
    dumpDatabase: () => dump(),
    fingerprintDatabase: (t: string) => computeLiveDatabaseFingerprint(t).fingerprint,
    gitMeta: () => ({ commit: 'a'.repeat(40), branch: 'main', repository: 'r/al-gharabi-ai', project: 'al-gharabi-ai' }),
    now: () => new Date().toISOString(),
    notifyOwner: (input) => { alerts.push(input); return { delivered: true, channel: 'in_app_notification', error: null }; },
  });
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = (server.address() as any).port;
  return { server, base: `http://127.0.0.1:${port}`, app, drControl, alerts, setDump: (d) => { dump = d; } };
}

async function main() {
  // ---------- 1) وحدة الموازنة: بصمة مستقرة تتجاهل الزمن ----------
  {
    const a = computeLiveDatabaseFingerprint(makeDump(3, 1, '2026-01-01T00:00:00.000Z'));
    const b = computeLiveDatabaseFingerprint(makeDump(3, 1, '2026-06-09T12:00:00.000Z'));
    check('بصمة ثابتة رغم اختلاف exportedAt', a.fingerprint !== null && a.fingerprint === b.fingerprint, `${a.fingerprint} vs ${b.fingerprint}`);
    check('عدّ المنتجات مستخرج', a.productCount === 3, String(a.productCount));
    check('عدّ المبيعات مستخرج', a.saleCount === 1, String(a.saleCount));
    const c = computeLiveDatabaseFingerprint(makeDump(4, 1));
    check('إضافة منتج تُغيّر البصمة', c.fingerprint !== a.fingerprint);
    const d = computeLiveDatabaseFingerprint(makeDump(3, 2));
    check('إضافة بيع تُغيّر البصمة', d.fingerprint !== a.fingerprint);
  }

  // ---------- 1ب) حكم الموازنة ----------
  {
    const live = computeLiveDatabaseFingerprint(makeDump(2, 0));
    check('لا نقطة مرجعية => no_point', evaluateDatabaseBalance(live, null).status === 'no_point');
    const empty = computeLiveDatabaseFingerprint('');
    check('تعذّر الحساب => unavailable', evaluateDatabaseBalance(empty, 'deadbeef').status === 'unavailable');
    check('تطابق => in_balance', evaluateDatabaseBalance(live, live.fingerprint).status === 'in_balance');
    const stale = evaluateDatabaseBalance(live, 'other-hash');
    check('اختلاف => stale', stale.status === 'stale' && stale.changed === true);
    check('رسالة stale تذكر المنتجات والمبيعات بلا محتوى', /المنتجات: 2/.test(stale.message) && /المبيعات: 0/.test(stale.message));
  }

  // ---------- 2) فشل النسخة يُنبّه المالك ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    const h = await makeApp(state, () => fullSource('fail1'), drControl, { dumpDatabase: async () => { throw new Error('db_down'); } });
    try {
      const { status, body } = await h.app.drAutoBackup.runFullBackup('manual');
      check('النسخة تفشل عند تعذّر القاعدة', status === 500 && body.state === 'failed', `${status} ${body.state}`);
      const backupAlerts = h.alerts.filter((a) => a.kind === 'backup_failed');
      check('تنبيه فشل النسخة وصل للمالك', backupAlerts.length === 1, String(h.alerts.length));
      check('التنبيه بلا محتوى عميل (عنوان عام)', /النسخة الاحتياطية/.test(backupAlerts[0]?.title || ''));
      // تشغيل ثانٍ فوراً: لا تكرار (منع الإغراق).
      await h.app.drAutoBackup.runFullBackup('manual');
      check('لا تكرار للتنبيه داخل النافذة', h.alerts.filter((a) => a.kind === 'backup_failed').length === 1);
    } finally { h.server.close(); }
  }

  // ---------- 3) نسخة ناجحة تسجّل بصمة قاعدة البيانات ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    const h = await makeApp(state, () => fullSource('ok1'), drControl, { dumpDatabase: async () => makeDump(3, 1) });
    try {
      const { status, body } = await h.app.drAutoBackup.runFullBackup('manual');
      check('نسخة ناجحة (backed_up)', status === 200 && body.state === 'backed_up');
      check('الاستجابة تحمل databaseHash', typeof body.databaseHash === 'string' && body.databaseHash.length >= 32, String(body.databaseHash));
      check('الحالة تحفظ lastSuccessDatabaseHash', typeof drControl.driveBackup?.lastSuccessDatabaseHash === 'string');
      check('لا تنبيه عند النجاح', h.alerts.length === 0);
    } finally { h.server.close(); }
  }

  // ---------- 4) الفجوة الحقيقية: بيانات جديدة بلا تغيير كود => stale ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    let dumpText = makeDump(3, 1);
    const h = await makeApp(state, () => fullSource('same'), drControl, { dumpDatabase: async () => dumpText });
    try {
      // نسخة أولى (كود + بيانات 3 منتجات/بيع).
      await h.app.drAutoBackup.runFullBackup('manual');
      // المالك يضيف منتجات ومبيعات — الكود لم يتغيّر إطلاقاً.
      dumpText = makeDump(9, 4);
      const recon = await h.app.drReconciliation.runCycle('manual');
      check('الفحص يبقى no_op لأن الكود لم يتغيّر', recon.outcome === 'no_op', JSON.stringify(recon));
      check('لكن الموازنة تكشف بيانات جديدة', recon.databaseBalance?.status === 'stale', JSON.stringify(recon.databaseBalance));
      check('الموازنة تذكر العدد الجديد (9 منتجات)', recon.databaseBalance?.productCount === 9, String(recon.databaseBalance?.productCount));
      const staleAlerts = h.alerts.filter((a) => a.kind === 'database_stale');
      check('تنبيه «النسخة أقدم من البيانات» وصل', staleAlerts.length === 1, String(h.alerts.length));
      check('التنبيه بلا محتوى عميل', /النسخة الاحتياطية أقدم/.test(staleAlerts[0]?.title || ''));
      // دورة أخرى بلا تغيير إضافي: تبقى stale لكن دون تكرار التنبيه.
      await h.app.drReconciliation.runCycle('manual');
      check('لا تكرار لتنبيه الموازنة', h.alerts.filter((a) => a.kind === 'database_stale').length === 1);
    } finally { h.server.close(); }
  }

  // ---------- 4ب) نسخة جديدة تُعيد التوازن ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    let dumpText = makeDump(2, 1);
    const h = await makeApp(state, () => fullSource('bal'), drControl, { dumpDatabase: async () => dumpText });
    try {
      await h.app.drAutoBackup.runFullBackup('manual');
      dumpText = makeDump(5, 2);
      let recon = await h.app.drReconciliation.runCycle('manual');
      check('بعد تغيّر البيانات: stale', recon.databaseBalance?.status === 'stale');
      // نسخة جديدة تُلتقط البيانات الحالية => توازن.
      await h.app.drAutoBackup.runFullBackup('manual');
      recon = await h.app.drReconciliation.runCycle('manual');
      check('بعد النسخة الجديدة: in_balance', recon.databaseBalance?.status === 'in_balance', JSON.stringify(recon.databaseBalance));
    } finally { h.server.close(); }
  }

  // ---------- 5) الصحة تعرض الموازنة والتنبيهات بلا سرّ ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    let dumpText = makeDump(1, 0);
    const h = await makeApp(state, () => fullSource('health'), drControl, { dumpDatabase: async () => dumpText });
    try {
      await h.app.drAutoBackup.runFullBackup('manual');
      dumpText = makeDump(7, 3);
      await h.app.drReconciliation.runCycle('manual');
      const health = await (await fetch(`${h.base}/api/dr/health`)).json();
      check('الصحة تعرض databaseBalance', health.dr?.databaseBalance?.status === 'stale', JSON.stringify(health.dr?.databaseBalance));
      check('الصحة تعرض productCount', health.dr?.databaseBalance?.productCount === 7);
      check('الصحة تعرض ownerAlerts', Array.isArray(health.dr?.ownerAlerts) && health.dr.ownerAlerts.some((a: any) => a.kind === 'database_stale'));
      const text = JSON.stringify(health);
      check('الصحة بلا أي سرّ', !/GOCSPX|client_secret=|refresh_token"|-----BEGIN|Bearer [A-Za-z0-9]/i.test(text));
    } finally { h.server.close(); }
  }

  // ---------- 6) مسار الموازنة اليدوي (owner فقط) ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    const h = await makeApp(state, () => fullSource('manual'), drControl, { dumpDatabase: async () => makeDump(4, 2) });
    try {
      const anon = await fetch(`${h.base}/api/dr/database-balance/check`, { method: 'POST' });
      check('بلا جلسة = 401', anon.status === 401, String(anon.status));
      const ok = await fetch(`${h.base}/api/dr/database-balance/check`, { method: 'POST', headers: { 'x-owner': 'owner-1' } });
      const body = await ok.json();
      check('owner يقرأ الموازنة (200)', ok.status === 200 && body.success === true);
      check('لا نقطة مرجعية => no_point', body.status === 'no_point', JSON.stringify(body.status));
      check('المسار بلا أي سرّ', !/GOCSPX|secret|Bearer/i.test(JSON.stringify(body)));
    } finally { h.server.close(); }
  }

  console.log(`\n${failures.length === 0 ? 'PASSED' : 'FAILED'}: ${passed} dr backup-gaps checks${failures.length ? ` (${failures.length} failed)` : ''}`);
  if (failures.length) { for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
