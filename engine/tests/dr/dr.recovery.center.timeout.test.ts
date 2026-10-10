/**
 * اختبار **مهلة جلب نقاط الاستعادة** لمركز استعادة الغرابي AI.
 *
 * الجذر المُصلح: `GET /api/points` كان يقف عند تعثّر/بطء Google Drive بلا أي مهلة،
 * فيبقى الطلب معلّقاً بلا نهاية، وتبقى الواجهة على «...» ولا يظهر أي خطأ (فلا يُختار
 * أي Recovery Point ⇒ يبقى زر «التحقق من النسخة» معطّلاً).
 *
 * يثبت هذا الاختبار (خادم المركز محلي + Drive وهمي بالكامل، بلا شبكة وبلا مزوّد):
 *  A) نجاح الجلب: 200 {ok:true, points:[...]} — يعمل كما كان.
 *  B) خطأ من Google Drive (403): 200 {ok:false, reason:...} بلا تعليق وبلا سرّ.
 *  C) انتهاء المهلة: 504 {ok:false, code:'TIMEOUT', retryable:true} خلال ثوانٍ، لا تعليق.
 *  D) المهلة لا تُفسد المصادقة: بعد 504 يبقى /api/owner-auth بالمفتاح الصحيح = 200.
 *  E) المصادقة الإلزامية باقية: /api/points بلا مفتاح = 401 (لا وصول دون مفتاح).
 *  F) (واجهة) نجاح: عدد النقاط يظهر وتُرسم البطاقات.
 *  G) (واجهة) مهلة: حالة التحميل «...» تُنهى دائماً وتظهر رسالة المهلة وإعادة المحاولة.
 *  H) (واجهة) خطأ Drive: حالة التحميل تُنهى وتظهر رسالة خطأ Google Drive.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../../tools/dr/drive-store.mjs';
import { runBackup } from '../../../tools/dr/backup.mjs';
import { encryptDbDump } from '../../../tools/dr/db-crypto.mjs';
import { buildSecretsBundle } from '../../../tools/dr/secret-crypto.mjs';
import { runKeyVaultSync } from '../../dr/recoveryVault/vault';
import { createRecoveryCenterServer, RECOVERY_POINTS_TIMEOUT_MS, resolvePointsTimeoutMs } from '../../../tools/dr/recovery-center.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const OWNER_TOKEN = 'owner-' + 'a'.repeat(40);
const SYNTH_SECRETS: Record<string, string> = {
  DR_RECOVERY_MASTER_KEY: 'a1'.repeat(32),
  DR_RECOVERY_VAULT_KEY: 'f9'.repeat(32),
  DRIVE_DB_BACKUP_KEY: 'b2'.repeat(32),
  DRIVE_TOKEN_ENCRYPTION_KEY: 'c3'.repeat(32),
};
const SQL = JSON.stringify({ backend: 'postgres', rows: [{ key: 'state', value: {} }] });

function noSecret(obj: any): boolean {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return Object.values(SYNTH_SECRETS).every((v) => !text.includes(v)) && !text.includes(OWNER_TOKEN);
}
function fullSource(tag: string) {
  const inc = [
    { path: 'server.ts', content: `export const x='${tag}';` },
    { path: 'package.json', content: '{"name":"al-gharabi-ai"}' },
    { path: 'package-lock.json', content: '{"lockfileVersion":3}' },
  ];
  for (let i = 0; i < 14; i += 1) inc.push({ path: `engine/f${i}.ts`, content: `export const f${i}='${tag}';` });
  return inc;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

async function main() {
  const baseEnv: any = {
    ...SYNTH_SECRETS,
    DRIVE_OAUTH_CLIENT_ID: '1234567890-timeout.apps.googleusercontent.com',
    DRIVE_OAUTH_CLIENT_SECRET: 'fake-client-secret-not-real',
    DRIVE_OAUTH_REFRESH_TOKEN: 'fake-refresh-token-not-real',
    RECOVERY_CENTER_OWNER_TOKEN: OWNER_TOKEN,
  };

  // ---------- A) وحدة المهلة (بلا خادم) ----------
  {
    check('default timeout is 25s', RECOVERY_POINTS_TIMEOUT_MS === 25000);
    check('env override valid', resolvePointsTimeoutMs({ RECOVERY_CENTER_POINTS_TIMEOUT_MS: '400' }) === 400);
    check('env override invalid => default', resolvePointsTimeoutMs({ RECOVERY_CENTER_POINTS_TIMEOUT_MS: 'abc' }) === 25000);
    check('env override negative => default', resolvePointsTimeoutMs({ RECOVERY_CENTER_POINTS_TIMEOUT_MS: '-5' }) === 25000);
  }

  // ---------- تهيئة: نقطة استعادة حقيقية على Drive وهمي ----------
  const state = createFakeDriveState();
  const fastClient = new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' });
  const store = new DriveStore({ client: fastClient });
  const backup = await runBackup({
    store, files: fullSource('timeout'),
    dumpDatabase: async () => SQL,
    encryptDatabase: (s: string) => encryptDbDump(s, baseEnv),
    buildSecrets: () => buildSecretsBundle(baseEnv, {}),
    meta: { commit: 'e'.repeat(40), branch: 'main', repository: 'r/x', project: 'al-gharabi-ai' },
    now: new Date().toISOString(),
  });
  await runKeyVaultSync({ store, env: baseEnv, now: new Date().toISOString() });
  check('seed backup ok', backup.state === 'backed_up', JSON.stringify(backup).slice(0, 120));

  const start = async (env: any, clientFactory: any) => {
    const server = createRecoveryCenterServer({ env, clientFactory });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    return { server, base: `http://127.0.0.1:${(server.address() as any).port}` };
  };
  const close = (server: any) => new Promise<void>((resolve) => server.close(() => resolve()));
  const ownerHeaders = { authorization: 'Bearer ' + OWNER_TOKEN };

  // ---------- B) نجاح الجلب ----------
  {
    const { server, base } = await start({ ...baseEnv }, () => fastClient);
    try {
      const t0 = Date.now();
      const res = await fetch(`${base}/api/points`, { headers: ownerHeaders });
      const body = await res.json();
      check('success: 200', res.status === 200, String(res.status));
      check('success: ok + point present', body.ok === true && (body.points || []).some((p: any) => p.id === backup.recoveryPointId));
      check('success: fast (no hang)', Date.now() - t0 < 5000);
      check('success: no secret', noSecret(body));
    } finally { await close(server); }
  }

  // ---------- C) خطأ من Google Drive (403) ----------
  {
    const errState = createFakeDriveState();
    errState.forcedStatus = 403;
    const errClient = new DriveClient({ transport: makeFakeTransport(errState), tokenProvider: () => 'tok' });
    const { server, base } = await start({ ...baseEnv }, () => errClient);
    try {
      const res = await fetch(`${base}/api/points`, { headers: ownerHeaders });
      const body = await res.json();
      check('drive error: 200 explicit (not 500/hang)', res.status === 200, String(res.status));
      check('drive error: ok=false + reason + empty points', body.ok === false && typeof body.reason === 'string' && (body.points || []).length === 0);
      check('drive error: no secret', noSecret(body));
    } finally { await close(server); }
  }

  // ---------- D) انتهاء المهلة ----------
  {
    const hangClient = new DriveClient({ transport: (() => new Promise(() => {})) as any, tokenProvider: () => 'tok' });
    const { server, base } = await start({ ...baseEnv, RECOVERY_CENTER_POINTS_TIMEOUT_MS: '400' }, () => hangClient);
    try {
      const t0 = Date.now();
      const res = await fetch(`${base}/api/points`, { headers: ownerHeaders });
      const elapsed = Date.now() - t0;
      const body = await res.json();
      check('timeout: 504', res.status === 504, String(res.status));
      check('timeout: explicit code + retryable', body.ok === false && body.code === 'TIMEOUT' && body.reason === 'timeout' && body.retryable === true);
      check('timeout: returns quickly (~400ms, not hung)', elapsed < 4000, `${elapsed}ms`);
      check('timeout: no secret', noSecret(body));
      // D2) المهلة لا تُفسد المصادقة: بعد 504 يبقى التحقق بالمفتاح الصحيح ناجحاً.
      const authOk = await fetch(`${base}/api/owner-auth`, { headers: ownerHeaders });
      check('timeout: auth still valid after 504 (not corrupted)', authOk.status === 200 && (await authOk.json()).ok === true);
      // D3) والمهلة لا تُلغي عمليات أخرى: طلب فوري آخر يعمل.
      const health = await fetch(`${base}/api/health`);
      check('timeout: service still healthy', health.status === 200);
    } finally { await close(server); }
  }

  // ---------- E) المصادقة الإلزامية باقية ----------
  {
    const { server, base } = await start({ ...baseEnv }, () => fastClient);
    try {
      const anon = await fetch(`${base}/api/points`);
      check('auth: 401 without token', anon.status === 401);
      const anonBody = await anon.json();
      check('auth: explicit reason', anonBody.code === 'UNAUTHORIZED' && anonBody.reason === 'missing_bearer_token');
      check('auth: no point leak', anonBody.points === undefined);
    } finally { await close(server); }
  }

  // ---------- F–H) الواجهة (متصفح فعلي إن توفّر Chromium) ----------
  const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : null)
    || (fs.existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : null);
  if (!chromiumPath) {
    console.log('  (skipped browser UI checks: no chromium found)');
  } else {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    const runUi = async (env: any, clientFactory: any, fn: (page: any, base: string) => Promise<void>) => {
      const { server, base } = await start(env, clientFactory);
      const page = await browser.newPage();
      try {
        // نُهيّئ localStorage بالمفتاح الصحيح قبل تحميل الصفحة.
        await page.addInitScript((tok: string) => { try { localStorage.setItem('gharabi_recovery_owner', tok); } catch { /* */ } }, OWNER_TOKEN);
        await page.goto(base);
        await page.waitForSelector('#load');
        await fn(page, base);
      } finally { await page.close(); await close(server); }
    };

    // F) نجاح: العدد يظهر والبطاقات تُرسم.
    await runUi({ ...baseEnv }, () => fastClient, async (page) => {
      await page.click('#load');
      await page.waitForFunction(() => /\d+\s*نقطة/.test(document.getElementById('ready')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
      const snap = await page.evaluate(() => ({ ready: document.getElementById('ready')?.textContent?.trim(), points: document.querySelectorAll('.pt').length }));
      check('ui success: ready shows count', /نقطة/.test(snap.ready || ''), snap.ready);
      check('ui success: point cards rendered', snap.points >= 1, String(snap.points));
    });

    // G) مهلة: «...» تُنهى دائماً + رسالة مهلة + إمكانية إعادة المحاولة.
    {
      const hangClient = new DriveClient({ transport: (() => new Promise(() => {})) as any, tokenProvider: () => 'tok' });
      await runUi({ ...baseEnv, RECOVERY_CENTER_POINTS_TIMEOUT_MS: '400' }, () => hangClient, async (page) => {
        await page.click('#load');
        // ننتظر انتهاء حالة التحميل (ألا تبقى «...»).
        await page.waitForFunction(() => document.getElementById('ready')?.textContent !== '...', null, { timeout: 30000 }).catch(() => {});
        const snap = await page.evaluate(() => ({ ready: document.getElementById('ready')?.textContent?.trim(), drive: document.getElementById('drivestate')?.textContent?.trim() }));
        check('ui timeout: loading state ended (not "...")', snap.ready !== '...', JSON.stringify(snap.ready));
        check('ui timeout: timeout message shown', /مهلة/.test(snap.drive || ''), snap.drive);
      });
    }

    // H) خطأ Drive: «...» تُنهى + رسالة خطأ واضحة.
    {
      const errState = createFakeDriveState();
      errState.forcedStatus = 403;
      const errClient = new DriveClient({ transport: makeFakeTransport(errState), tokenProvider: () => 'tok' });
      await runUi({ ...baseEnv }, () => errClient, async (page) => {
        await page.click('#load');
        await page.waitForFunction(() => document.getElementById('ready')?.textContent !== '...', null, { timeout: 8000 }).catch(() => {});
        const snap = await page.evaluate(() => ({ ready: document.getElementById('ready')?.textContent?.trim(), drive: document.getElementById('drivestate')?.textContent?.trim() }));
        check('ui drive error: loading state ended (not "...")', snap.ready !== '...', JSON.stringify(snap.ready));
        check('ui drive error: explicit google-drive error message', /Google Drive/.test(snap.drive || ''), snap.drive);
      });
    }

    await browser.close();
  }

  // ---------- lib المتزامنة بلا انحراف + تتضمّن الإصلاح ----------
  {
    const toolCenter = fs.readFileSync(path.join(repoRoot, 'tools/dr/recovery-center.mjs'), 'utf8');
    const libCenter = fs.readFileSync(path.join(repoRoot, 'dr-recovery-center/lib/recovery-center.mjs'), 'utf8');
    check('lib synced (no drift)', toolCenter === libCenter);
    check('lib has drive-timeouts (importable bundle)', fs.existsSync(path.join(repoRoot, 'dr-recovery-center/lib/drive-timeouts.mjs')));
    check('server applies points timeout', toolCenter.includes('settleWithTimeoutLocal') && /\/api\/points[\s\S]{0,600}settleWithTimeoutLocal/.test(toolCenter));
    check('frontend has AbortController + finally', toolCenter.includes('AbortController') && /finally\{[\s\S]{0,200}ready/.test(toolCenter));
  }

  console.log(`\nrecovery-center points-timeout: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
}

main().catch((err) => { console.error(err); process.exit(1); });
