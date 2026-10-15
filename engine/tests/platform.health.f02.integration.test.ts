/**
 * F-02 — اختبار تكامل: فحص صحة Facebook/Instagram حقيقي + تخفيض الاتصال عند رفض الرمز.
 *
 * يثبت (ويفشل على الكود القديم الذي كان يرد 501 ويهمل انتهاء الرمز):
 *  - GET /api/platforms/facebook/health و .../instagram/health يفحصان فعلياً عبر
 *    Graph (لا 501)، ويعلنان healthy=true باتصال موثق.
 *  - رمز مرفوض (OAuthException 190) => 409 reauth_needed + تخفيض حالة الاتصال
 *    فوراً (لا تبقى «متوافقة» إلى الأبد).
 *  - الرد/النشر بعد انتهاء الرمز يُعلن reauth_needed (لا ادّعاء نجاح).
 *  - /api/readiness (العام) يعكس الانخفاض عبر brain.connectedVerified.
 *
 * بلا مزود حقيقي ولا حصة ولا سرّ: خوادم Graph وهمية محلية فقط.
 */

import express from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createFacebookMock, startFacebookMockServer, type FacebookMockState } from './helpers/facebookMock';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const APP_PORT = 7000 + Math.floor(Math.random() * 60);
const FB_PORT = 7100 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'fb-health-f02-test-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_1234567890';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_not_real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-fb-health-'));

const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };

let currentApp: { proc: ChildProcess; log: () => string } | null = null;
function startApp(fbBase: string): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    FACEBOOK_GRAPH_API_BASE: fbBase,
    FACEBOOK_DIALOG_BASE: fbBase,
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: FB_APP_SECRET,
    FACEBOOK_VERIFY_TOKEN: FB_VERIFY_TOKEN,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}
async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function stop(proc: ChildProcess): Promise<void> {
  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1200));
  if (!proc.killed) proc.kill('SIGKILL');
}
async function login(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}
async function connectFacebook(auth: Record<string, string>): Promise<void> {
  const start = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
  const state = new URL(start.authorizationUrl).searchParams.get('state') || '';
  await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(state)}&code=TESTCODE`);
}
async function readinessConn(auth: Record<string, string>, platform: string): Promise<any> {
  const r = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
  return r.platforms.find((p: any) => p.platform === platform);
}

async function main(): Promise<void> {
  const mock = await startFacebookMockServer(FB_PORT, createFacebookMock());
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({ schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser], workspace: { showroom: { name: 'معرض الغرابي', phone: '07700000000', address: 'بغداد' } } }, null, 2));
  try {
    currentApp = startApp(mock.base);
    if (!(await waitForHealth())) { console.error('لم يقلع الخادم', currentApp.log().slice(0, 500)); process.exit(1); }
    const auth = await login();

    group('1) قبل الربط: health يرفض بلا اتصال موثق (409 لا 501)');
    const preHealth = await fetch(`${BASE}/api/platforms/facebook/health`, { headers: auth });
    check('health قبل الربط => 409 (لا 501)', preHealth.status === 409, `status=${preHealth.status}`);

    group('2) بعد الربط: health يجري فحصاً حقيقياً عبر Graph');
    await connectFacebook(auth);
    const after = await readinessConn(auth, 'facebook');
    check('Facebook متصل وموثق', after.connected === true && after.providerVerified === true);
    const health = await fetch(`${BASE}/api/platforms/facebook/health`, { headers: auth });
    const hb = await health.json().catch(() => ({}));
    check('health facebook => 200 (لم يعد 501)', health.status === 200, `status=${health.status} body=${JSON.stringify(hb).slice(0, 160)}`);
    check('health يُعلن healthy=true وحساباً حقيقياً', hb.healthy === true && hb.provider === 'facebook' && hb.accountId === 'PAGE_123', JSON.stringify(hb));
    check('health استدعى Graph فعلاً (GET /{page-id})', mock.state.pageProfileCalls >= 1, `pageProfileCalls=${mock.state.pageProfileCalls}`);
    check('health لا يكشف أي سرّ', !JSON.stringify(hb).includes('PAGE_TOKEN_TEST') && !JSON.stringify(hb).includes(FB_APP_SECRET));

    group('3) رمز مرفوض (190) => reauth_needed + تخفيض الاتصال فوراً');
    mock.state.revokedToken = true;
    const revoked = await fetch(`${BASE}/api/platforms/facebook/health`, { headers: auth });
    const rb = await revoked.json().catch(() => ({}));
    check('health عند رمز مرفوض => 409', revoked.status === 409, `status=${revoked.status}`);
    check('health يُعلن reauth_needed صراحةً', rb.status === 'reauth_needed' && rb.errorKind === 'TOKEN_EXPIRED', JSON.stringify(rb));
    const afterRevoke = await readinessConn(auth, 'facebook');
    check('الاتصال انخفض فعلاً (لا يبقى متصلاً موثقاً)', afterRevoke.connected === false || afterRevoke.providerVerified === false, JSON.stringify(afterRevoke));
    // readiness العام يعكس الانخفاض عبر brain.connectedVerified
    const readinessPublic = await (await fetch(`${BASE}/api/readiness`)).json();
    check('readiness العام لا يعدّ facebook ضمن connectedVerified بعد الرفض', Array.isArray(readinessPublic.brain?.connectedVerified) && !readinessPublic.brain.connectedVerified.includes('facebook'), JSON.stringify(readinessPublic.brain?.connectedVerified));

    group('4) رد/نشر بعد انتهاء الرمز => لا ادّعاء نجاح');
    // إعادة الربط لإعادة الاتصال (الرمز الجديد صالح)، ثم رفضه لاختبار مسار الرد.
    mock.state.revokedToken = false;
    await connectFacebook(auth);
    const rec = await readinessConn(auth, 'facebook');
    check('إعادة الربط تُعيد الاتصال الموثق', rec.connected === true && rec.providerVerified === true);
    // نُدخل تعليقاً وارداً ثم نرفض الرمز ثم نرد.
    await fetch(`${BASE}/api/social/manager/comments/ingest`, { method: 'POST', headers: auth, body: JSON.stringify({ platform: 'facebook', externalId: 'C_REVOKE', text: 'عاشت إيدكم على الخدمة', authorName: 'أحمد' }) });
    mock.state.revokedToken = true;
    const reply = await fetch(`${BASE}/api/platforms/facebook/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'C_REVOKE', text: 'شكراً لك', commentText: 'عاشت إيدكم على الخدمة' }) });
    const replyBody = await reply.json().catch(() => ({}));
    check('الرد بعد انتهاء الرمز لا ينجح (لا تسليم)', reply.status !== 200 && replyBody.success !== true, `status=${reply.status}`);
    const afterReplyRevoke = await readinessConn(auth, 'facebook');
    check('فشل الرد بالرمز المنتهي يُنزل الاتصال (reauth)', afterReplyRevoke.connected === false || afterReplyRevoke.providerVerified === false, JSON.stringify(afterReplyRevoke));

    group('5) الثبات بعد إعادة التشغيل (reauth_needed يصمد)');
    mock.state.revokedToken = false;
    await stop(currentApp.proc);
    currentApp = startApp(mock.base);
    check('الخادم يقلع بعد restart', await waitForHealth());
    const auth2 = await login();
    const afterRestart = await readinessConn(auth2, 'facebook');
    check('حالة reauth_needed صمدت بعد restart', afterRestart.connected === false || afterRestart.providerVerified === false, JSON.stringify(afterRestart));
  } finally {
    try { if (currentApp) await stop(currentApp.proc); } catch { /* تجاهل */ }
    await mock.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) { console.error(`FAILED: ${failures.length} / ${passed + failures.length}`); for (const f of failures) console.error('  ✗ ' + f); process.exitCode = 1; }
  else console.log(`PASSED: ${passed} platform-health (F-02) checks`);
}

main().catch((e) => { console.error('F-02 harness crashed', e); process.exitCode = 1; });
