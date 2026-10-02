/**
 * اختبارات الجدولة التلقائية للنسخة الكاملة كل 6 ساعات.
 *
 * يثبت بسلوك حقيقي (خادم Express + Google Drive وهمي، بلا شبكة وبلا مزوّد):
 *  1) الإيقاع الافتراضي 6 ساعات، والحدود الآمنة (رفض 0/سالب/عبثي).
 *  2) قرار الاستحقاق: لا تشغيل سابق ⇒ مستحق؛ بعد تشغيل ⇒ ليس مستحقاً قبل الموعد.
 *  3) الدورة تُنتج Recovery Point كاملاً (backed_up) عبر المسار الرسمي.
 *  4) إعادة التشغيل: الحالة تصمد ولا تُنشئ نسخة مكرّرة عند الإقلاع.
 *  5) نسخة قيد التنفيذ: الدورة تُتخطّى بأمان (already_running) بلا بدء عمل ثانٍ.
 *  6) الفشل: تُسجَّل فشلاً صريحاً ولا تُعدّ نقطة استعادة ناجحة.
 *  7) المصدر الناقص: SOURCE_INCOMPLETE بلا نقطة.
 *  8) القفل المشترك مع النسخة اليدوية يمنع التوازي.
 *  9) النسخ القديمة لا تُمسّ (لا حذف تلقائي) — تُقرأ النقاط بعد الدورة.
 * 10) حالة الجدولة تُعلن في health بلا أي سرّ.
 */

import express from 'express';
import type { Server } from 'node:http';
import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { registerDriveRoutes } from '../../dr/routes';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import {
  AUTO_BACKUP_DEFAULT_INTERVAL_MS,
  AUTO_BACKUP_MIN_INTERVAL_MS,
  AUTO_BACKUP_MAX_INTERVAL_MS,
  AUTO_BACKUP_ENV,
  resolveAutoBackupIntervalMs,
  isAutoBackupDue,
  parseLastRunAtMs,
  nextAutoBackupAtMs,
  buildAutoBackupStatus,
} from '../../dr/autoBackup';

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
  DR_RECOVERY_VAULT_KEY: 'e'.repeat(64),
  DR_RECOVERY_MASTER_KEY: 'f'.repeat(64),
};

/** مصدر كامل صالح (يتجاوز حد الاكتمال). */
function fullSource(tag = 'v1') {
  const included = [
    { path: 'server.ts', content: `export const x = '${tag}';` },
    { path: 'package.json', content: '{"name":"al-gharabi-ai"}' },
    { path: 'package-lock.json', content: '{"lockfileVersion":3}' },
  ];
  for (let i = 0; i < 14; i += 1) included.push({ path: `engine/f${i}.ts`, content: `export const f${i} = '${tag}';` });
  return { included, excluded: [], complete: true, source: 'walk', fileCount: included.length, minFiles: 10, missingRequired: [], reason: null };
}

function incompleteSource() {
  return { included: [{ path: 'package.json', content: '{}' }], excluded: [], complete: false, source: 'walk', fileCount: 1, minFiles: 10, missingRequired: ['server.ts'], reason: 'required_files_missing:server.ts' };
}

interface Harness { server: Server; base: string; app: any; drControl: any; }

async function makeApp(state: any, getCollector: () => any, drControl: any, opts: { dumpDatabase?: () => Promise<string>; failTransport?: boolean } = {}): Promise<Harness> {
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
    dumpDatabase: opts.dumpDatabase || (async () => 'CREATE TABLE t(id int);\n'),
    gitMeta: () => ({ commit: 'a'.repeat(40), branch: 'main', repository: 'r/al-gharabi-ai', project: 'al-gharabi-ai' }),
    now: () => new Date().toISOString(),
  });
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = (server.address() as any).port;
  return { server, base: `http://127.0.0.1:${port}`, app, drControl };
}

async function main() {
  // ---------- 1) الإيقاع الافتراضي والحدود الآمنة ----------
  {
    check('default interval is 6 hours', AUTO_BACKUP_DEFAULT_INTERVAL_MS === 6 * 60 * 60 * 1000);
    check('default env resolves to 6h', resolveAutoBackupIntervalMs({}) === AUTO_BACKUP_DEFAULT_INTERVAL_MS);
    check('invalid (non-numeric) => default', resolveAutoBackupIntervalMs({ [AUTO_BACKUP_ENV]: 'abc' }) === AUTO_BACKUP_DEFAULT_INTERVAL_MS);
    check('zero => default', resolveAutoBackupIntervalMs({ [AUTO_BACKUP_ENV]: '0' }) === AUTO_BACKUP_DEFAULT_INTERVAL_MS);
    check('negative => default', resolveAutoBackupIntervalMs({ [AUTO_BACKUP_ENV]: '-5' }) === AUTO_BACKUP_DEFAULT_INTERVAL_MS);
    check('too small clamps to min', resolveAutoBackupIntervalMs({ [AUTO_BACKUP_ENV]: '10' }) === AUTO_BACKUP_MIN_INTERVAL_MS);
    check('too large clamps to max', resolveAutoBackupIntervalMs({ [AUTO_BACKUP_ENV]: String(10 * 24 * 60 * 60 * 1000) }) === AUTO_BACKUP_MAX_INTERVAL_MS);
    check('valid custom honored', resolveAutoBackupIntervalMs({ [AUTO_BACKUP_ENV]: String(3 * 60 * 60 * 1000) }) === 3 * 60 * 60 * 1000);
  }

  // ---------- 2) قرار الاستحقاق ----------
  {
    const now = Date.parse('2026-01-01T12:00:00.000Z');
    const iv = AUTO_BACKUP_DEFAULT_INTERVAL_MS;
    check('due when never run', isAutoBackupDue(null, now, iv) === true);
    check('not due just after run', isAutoBackupDue(now - 60 * 1000, now, iv) === false);
    check('due after interval elapsed', isAutoBackupDue(now - iv - 1000, now, iv) === true);
    check('due exactly at interval', isAutoBackupDue(now - iv, now, iv) === true);
    check('parseLastRunAtMs reads ISO', parseLastRunAtMs({ lastRunAt: '2026-01-01T00:00:00.000Z' }) === Date.parse('2026-01-01T00:00:00.000Z'));
    check('parseLastRunAtMs null when absent', parseLastRunAtMs({}) === null);
    check('nextRunAt computed', nextAutoBackupAtMs(now, iv) === now + iv);
    check('nextRunAt null when never run', nextAutoBackupAtMs(null, iv) === null);
  }

  // ---------- 3) دورة تلقائية تُنتج Recovery Point كاملاً ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    const h = await makeApp(state, () => fullSource('auto1'), drControl);
    try {
      check('auto-backup handle exposed', typeof h.app.drAutoBackup?.runCycle === 'function');
      check('auto-backup interval 6h on handle', h.app.drAutoBackup.intervalMs === AUTO_BACKUP_DEFAULT_INTERVAL_MS);
      const before = h.app.drAutoBackup.status();
      check('status due before first run', before.due === true && before.lastRunAt === null);
      const result = await h.app.drAutoBackup.runCycle('scheduled');
      check('auto cycle ran', result.outcome === 'ran', JSON.stringify(result));
      check('auto cycle produced recovery point', typeof result.recoveryPointId === 'string' && /^rp-\d+/.test(result.recoveryPointId));
      check('auto cycle state backed_up', result.state === 'backed_up');
      const after = h.app.drAutoBackup.status();
      check('status not due after run', after.due === false);
      check('status recorded last run', typeof after.lastRunAt === 'string' && after.lastRunResult === 'backed_up');
      check('status recorded recovery point', after.lastRecoveryPointId === result.recoveryPointId);
      check('run count incremented', after.runCount === 1);
      check('status exposes nextRunAt', typeof after.nextRunAt === 'string');
      check('status interval 360 min', after.intervalMinutes === 360);
    } finally { h.server.close(); }
  }

  // ---------- 3ب) النسخة التلقائية كاملة: DB مشفّرة + أسرار + خزنة المفاتيح ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    const h = await makeApp(state, () => fullSource('full'), drControl);
    try {
      const { status, body } = await h.app.drAutoBackup.runFullBackup('scheduled');
      check('full backup 200', status === 200 && body.state === 'backed_up');
      check('full backup verified', body.verified === true);
      check('full backup uploaded files', body.uploaded > 0);
      check('full backup has secrets count', typeof body.secretsCount === 'number' && body.secretsCount >= 1);
      check('full backup mirror synced', body.mirror && body.mirror.state === 'synced');
      check('full backup key vault synced', body.keyVault && (body.keyVault.state === 'synced' || body.keyVault.state === 'no_change'), JSON.stringify(body.keyVault));
      check('full backup key vault has records', body.keyVault && typeof body.keyVault.recordCount === 'number' && body.keyVault.recordCount >= 1, JSON.stringify(body.keyVault));
      // النقطة المُنشأة تحمل بصمات قاعدة البيانات والأسرار.
      const pts = await fetch(`${h.base}/api/dr/recovery-points`, { headers: { 'x-owner': 'owner-1' } });
      const pr = await pts.json();
      const point = (pr.recoveryPoints || []).find((p: any) => p.id === body.recoveryPointId);
      check('recovery point present', Boolean(point));
      check('point database encrypted', point?.database?.encrypted === true && typeof point?.database?.hash === 'string');
      check('point secrets encrypted', point?.secrets?.encrypted === true && typeof point?.secrets?.hash === 'string');
      check('point verified', point?.status === 'verified' && point?.verification?.ok === true);
      check('point fileCount full', point?.fileCount >= 15, String(point?.fileCount));
    } finally { h.server.close(); }
  }

  // ---------- 4) لا نسخة مكرّرة قبل الموعد ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    const h = await makeApp(state, () => fullSource('dedup'), drControl);
    try {
      const first = await h.app.drAutoBackup.runCycle('scheduled');
      check('first run created point', first.outcome === 'ran');
      const second = await h.app.drAutoBackup.runCycle('scheduled');
      check('second run skipped (not due)', second.outcome === 'skipped' && second.reason === 'not_due', JSON.stringify(second));
      check('no extra recovery point on early rerun', h.app.drAutoBackup.status().runCount === 1);
    } finally { h.server.close(); }
  }

  // ---------- 5) إعادة التشغيل: الحالة تصمد ولا نسخة مكرّرة ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    const h1 = await makeApp(state, () => fullSource('restart'), drControl);
    const r1 = await h1.app.drAutoBackup.runCycle('scheduled');
    check('run before restart created point', r1.outcome === 'ran');
    const persisted = JSON.parse(JSON.stringify(drControl.driveAutoBackup));
    check('auto backup state persisted', typeof persisted?.lastRunAt === 'string' && persisted?.lastRunResult === 'backed_up');
    h1.server.close();
    // إعادة تشغيل: خادم جديد بنفس drControl (كما يفعل محوّل الحالة عند الإقلاع).
    const h2 = await makeApp(state, () => fullSource('restart'), drControl);
    try {
      const boot = await h2.app.drAutoBackup.runCycle('boot');
      check('boot after restart does not duplicate', boot.outcome === 'skipped' && boot.reason === 'not_due', JSON.stringify(boot));
      check('run count unchanged after restart', h2.app.drAutoBackup.status().runCount === 1);
    } finally { h2.server.close(); }
  }

  // ---------- 6) نسخة قيد التنفيذ: تُتخطّى بأمان ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const h = await makeApp(state, () => fullSource('inflight'), drControl, {
      dumpDatabase: async () => { await gate; return 'CREATE TABLE t(id int);\n'; },
    });
    try {
      // نبدأ النسخة الكاملة مباشرة (تحاكي نسخة جارية) ثم نطلب دورة الجدولة.
      const running = h.app.drAutoBackup.runFullBackup('manual');
      await new Promise((r) => setTimeout(r, 20));
      const cycle = await h.app.drAutoBackup.runCycle('scheduled');
      check('cycle skipped while backup running', cycle.outcome === 'skipped' && cycle.reason === 'already_running', JSON.stringify(cycle));
      check('skip recorded', h.app.drAutoBackup.status().skippedCount >= 1 && h.app.drAutoBackup.status().lastSkippedReason === 'already_running');
      release();
      const done = await running;
      check('the in-flight backup completed', done.status === 200 && done.body.state === 'backed_up');
    } finally { h.server.close(); }
  }

  // ---------- 7) منع التشغيل المتوازي (قفل مشترك مع اليدوي) ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const h = await makeApp(state, () => fullSource('parallel'), drControl, {
      dumpDatabase: async () => { await gate; return 'CREATE TABLE t(id int);\n'; },
    });
    try {
      const first = h.app.drAutoBackup.runFullBackup('manual');
      await new Promise((r) => setTimeout(r, 20));
      const second = await h.app.drAutoBackup.runFullBackup('manual');
      check('second parallel backup blocked (409)', second.status === 409 && second.body.code === 'BACKUP_ALREADY_RUNNING');
      // المسار اليدوي عبر HTTP محجوب كذلك أثناء الجريان.
      const httpRes = await fetch(`${h.base}/api/dr/backup`, { method: 'POST', headers: { 'x-owner': 'owner-1' } });
      check('manual HTTP backup blocked while running (409)', httpRes.status === 409);
      release();
      const done = await first;
      check('first backup still completes', done.status === 200 && done.body.state === 'backed_up');
    } finally { h.server.close(); }
  }

  // ---------- 8) الفشل: يُسجَّل فشلاً ولا نقطة استعادة ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    const h = await makeApp(state, () => fullSource('fail'), drControl, {
      dumpDatabase: async () => { throw new Error('pg_dump_failed'); },
    });
    try {
      const result = await h.app.drAutoBackup.runCycle('scheduled');
      check('failed cycle reports failure', result.outcome === 'failed' && result.state === 'failed', JSON.stringify(result));
      check('failed cycle has no recovery point', result.recoveryPointId == null);
      const status = h.app.drAutoBackup.status();
      check('status records failure', status.lastRunResult === 'failed' && typeof status.lastError === 'string');
      check('status keeps no recovery point on failure', status.lastRecoveryPointId == null);
    } finally { h.server.close(); }
  }

  // ---------- 9) المصدر الناقص: SOURCE_INCOMPLETE بلا نقطة ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    const h = await makeApp(state, () => incompleteSource(), drControl);
    try {
      const result = await h.app.drAutoBackup.runCycle('scheduled');
      check('incomplete source => failed outcome', result.outcome === 'failed' && result.state === 'SOURCE_INCOMPLETE', JSON.stringify(result));
      check('incomplete source reason', result.reason === 'SOURCE_INCOMPLETE' && result.status === 409, JSON.stringify(result));
      check('incomplete source => no point', result.recoveryPointId == null);
    } finally { h.server.close(); }
  }

  // ---------- 10) لا حذف تلقائي: النقاط تتراكم ولا تُحذف ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    let tag = 'n1';
    const h = await makeApp(state, () => fullSource(tag), drControl);
    try {
      const a = await h.app.drAutoBackup.runCycle('scheduled');
      check('point A created', a.outcome === 'ran' && /^rp-\d+/.test(a.recoveryPointId));
      // نُغيّر المصدر ونُصفّر lastRunAt لمحاكاة حلول الموعد => نقطة جديدة.
      tag = 'n2';
      drControl.driveAutoBackup = { ...drControl.driveAutoBackup, lastRunAt: '2000-01-01T00:00:00.000Z' };
      const b = await h.app.drAutoBackup.runCycle('scheduled');
      check('point B created after change', b.outcome === 'ran' && /^rp-\d+/.test(b.recoveryPointId));
      check('point B differs from A', b.recoveryPointId !== a.recoveryPointId);
      const pts = await fetch(`${h.base}/api/dr/recovery-points`, { headers: { 'x-owner': 'owner-1' } });
      const body = await pts.json();
      check('both recovery points retained (no auto-delete)', Array.isArray(body.recoveryPoints) && body.recoveryPoints.length >= 2, String(body.recoveryPoints?.length));
      const ids = (body.recoveryPoints || []).map((p: any) => p.id);
      check('point A retained', ids.includes(a.recoveryPointId));
      check('point B retained', ids.includes(b.recoveryPointId));
    } finally { h.server.close(); }
  }

  // ---------- 11) health يعرض حالة الجدولة بلا سرّ ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    const h = await makeApp(state, () => fullSource('health'), drControl);
    try {
      await h.app.drAutoBackup.runCycle('scheduled');
      const res = await fetch(`${h.base}/api/dr/health`);
      const body = await res.json();
      check('health exposes autoBackup block', body.dr.autoBackup && typeof body.dr.autoBackup === 'object');
      check('health autoBackup interval 360', body.dr.autoBackup.intervalMinutes === 360);
      check('health autoBackup not due after run', body.dr.autoBackup.due === false);
      const json = JSON.stringify(body);
      check('health autoBackup has no secret', !json.includes('GOCSPX') && !json.includes(TEST_KEY) && !json.includes('f'.repeat(64)));
    } finally { h.server.close(); }
  }

  // ---------- 12) المؤقّت الداخلي يُطلق دورة عند الاستحقاق ----------
  {
    const state = createFakeDriveState();
    const drControl: any = { driveOAuthStates: [], driveRefreshToken: { alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' }, driveLastError: null };
    const h = await makeApp(state, () => fullSource('timer'), drControl);
    const realSetInterval = global.setInterval;
    try {
      check('scheduled false before start', h.app.drAutoBackup.status().scheduled === false);
      let captured: any = null;
      (global as any).setInterval = (fn: any, ms: number) => { captured = { fn, ms }; return { unref() {} } as any; };
      h.app.drAutoBackup.start();
      check('start creates one internal timer', captured != null);
      check('tick is bounded to 15 min', captured.ms === 15 * 60 * 1000);
      check('scheduled true after start', h.app.drAutoBackup.status().scheduled === true);
      check('tick status exposed', h.app.drAutoBackup.status().tickMinutes === 15);
      // تشغيل النبضة المُلتقطة => الموعد مستحق (لم تُشغّل بعد) => نسخة فعلية.
      captured.fn();
      await new Promise((r) => setTimeout(r, 80));
      check('timer tick fired a backup', h.app.drAutoBackup.status().runCount === 1, JSON.stringify(h.app.drAutoBackup.status()));
      check('timer tick produced a recovery point', typeof h.app.drAutoBackup.status().lastRecoveryPointId === 'string');
      // تشغيل start مرة أخرى لا يُنشئ مؤقّتاً ثانياً.
      let second = false;
      (global as any).setInterval = (fn: any, ms: number) => { second = true; return { unref() {} } as any; };
      h.app.drAutoBackup.start();
      check('start is idempotent (no second timer)', second === false);
      h.app.drAutoBackup.stop();
      check('stop clears scheduler', h.app.drAutoBackup.status().scheduled === false);
    } finally {
      (global as any).setInterval = realSetInterval;
      h.server.close();
    }
  }

  console.log(`\nauto-backup: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
