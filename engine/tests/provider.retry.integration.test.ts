/**
 * PR-E — اختبار تكامل لـF-02 (reauth_needed) وF-14 (إعادة المحاولة الآمنة).
 *
 * خادمان حقيقيان (خادم التطبيق + خادم Graph وهمي محلي) بلا أي مزود حقيقي ولا سرّ:
 *
 *  F-02:
 *   - `/api/platforms/facebook/health` و`/api/platforms/instagram/health` يردّان
 *     حالة حقيقية (200 healthy) لا 501.
 *   - OAuthException (كود 190) من نداء **رد** فعلي ⇒ الحالة `reauth_needed`،
 *     ويُعلن ذلك في `/api/readiness` و`/api/platforms/production-readiness`،
 *     وتُرفض الردود اللاحقة (409) بلا أي نداء مزود ثانٍ.
 *   - OAuthException (190) من نداء **health** الفعلي ⇒ `reauth_needed` لا ادعاء صحة.
 *
 *  F-14:
 *   - 503 على قراءة GET (فحص health) ⇒ إعادة ثم نجاح.
 *   - 429 مع Retry-After ⇒ تُحترم المدة المطلوبة (لا أقل).
 *   - انقطاع بعد الإرسال على POST نشر ⇒ لا إعادة تلقائية أبداً، والحجز الدائم
 *     يبقى `reserved` (لا يُعلن فشلاً مؤكداً فيُسمح بتكرار خاطئ).
 *
 * يفشل على الكود القديم (health كان 501، ولا retry، ولا قلب الحالة إلى reauth).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { createFacebookMock, startFacebookMockServer, type FacebookMockState } from './helpers/facebookMock';
import { createInstagramMock, startInstagramMockServer, type InstagramMockState } from './helpers/instagramMock';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const FB_APP_PORT = 8600 + Math.floor(Math.random() * 40);
const IG_APP_PORT = 8660 + Math.floor(Math.random() * 40);
const FB_MOCK_PORT = 8700 + Math.floor(Math.random() * 40);
const IG_MOCK_PORT = 8760 + Math.floor(Math.random() * 40);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'provider-retry-integration-secret-not-real';
const APP_SECRET = 'fb_test_app_secret_not_real_1234567890';
const VERIFY_TOKEN = 'fb_test_verify_token_not_real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };

function startApp(port: number, stateDir: string, graphBase: string): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    NODE_ENV: 'production',
    APP_URL: `http://127.0.0.1:${port}`,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    FACEBOOK_GRAPH_API_BASE: graphBase,
    FACEBOOK_DIALOG_BASE: graphBase,
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: APP_SECRET,
    FACEBOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    CONTAINER_POLL_INTERVAL_MS: '0',
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

async function waitForHealth(base: string, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function stop(proc: ChildProcess): Promise<void> {
  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1200));
  if (!proc.killed) proc.kill('SIGKILL');
}
async function login(base: string): Promise<Record<string, string>> {
  const res = await fetch(`${base}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
  });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}
async function connectPlatform(base: string, auth: Record<string, string>, platform: 'facebook' | 'instagram'): Promise<number> {
  const start = await (await fetch(`${base}/api/platforms/${platform}/oauth/start`, { headers: auth })).json();
  const state = new URL(start.authorizationUrl).searchParams.get('state') || '';
  const cb = await fetch(`${base}/api/platforms/${platform}/oauth/callback?state=${encodeURIComponent(state)}&code=TESTCODE`);
  return cb.status;
}
async function ingest(base: string, auth: Record<string, string>, platform: string, externalId: string, text: string): Promise<void> {
  await fetch(`${base}/api/social/manager/comments/ingest`, {
    method: 'POST', headers: auth, body: JSON.stringify({ platform, externalId, text, authorName: 'أحمد' }),
  });
}
async function reply(base: string, auth: Record<string, string>, platform: string, externalId: string, text: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/api/platforms/${platform}/reply`, {
    method: 'POST', headers: auth, body: JSON.stringify({ externalId, text, commentText: 'بكم سعر الثلاجة بالتقسيط؟' }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
/** حالة الاتصال من النقطة العامة /api/readiness (بلا مصادقة). */
async function publicConnectionStatus(base: string, platform: string): Promise<string | null> {
  const readiness = await (await fetch(`${base}/api/readiness`)).json();
  const row = (readiness.platformConnections || []).find((r: any) => r.platform === platform);
  return row ? String(row.status) : null;
}
/** الحجز الدائم من ملف منع التكرار (خلفية الملف في الاختبار). */
function readIdemRecord(stateDir: string, key: string): any {
  try {
    const raw = JSON.parse(readFileSync(join(stateDir, '.gharabi-idempotency.json'), 'utf8'));
    return raw?.records?.[key] || null;
  } catch { return null; }
}
function seedState(stateDir: string): void {
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: { showroom: { name: 'معرض الغرابي' }, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [] },
  }), 'utf8');
}

async function facebookSuite(): Promise<void> {
  const base = `http://127.0.0.1:${FB_APP_PORT}`;
  const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-pr-e-fb-'));
  seedState(stateDir);
  const mock: { server: Server; state: FacebookMockState; base: string; stop: () => Promise<void> } =
    await startFacebookMockServer(FB_MOCK_PORT, createFacebookMock());
  let app = startApp(FB_APP_PORT, stateDir, mock.base);
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('Facebook: الخادم يقلع', await waitForHealth(base), app.log().slice(0, 400));
    Object.assign(auth, await login(base));
    check('Facebook: الربط عبر OAuth ينجح', (await connectPlatform(base, auth, 'facebook')) === 200);

    group('F-02/F-14 (Facebook) 1) فحص health حقيقي — لا 501');
    const h1 = await fetch(`${base}/api/platforms/facebook/health`, { headers: auth });
    const h1Body = await h1.json();
    check('health لا يرد 501 (فحص منفّذ)', h1.status !== 501, `status=${h1.status}`);
    check('health يرد 200 بحالة حقيقية سليمة', h1.status === 200 && h1Body.healthy === true && h1Body.provider === 'facebook', JSON.stringify(h1Body).slice(0, 200));
    check('فحص الصفحة استُدعي فعلياً على Graph', mock.state.pageProfileCalls >= 1, `calls=${mock.state.pageProfileCalls}`);
    check('لا يُعاد أي رمز صفحة في استجابة الفحص', !JSON.stringify(h1Body).includes('PAGE_TOKEN_TEST'));

    group('F-14 (Facebook) 2) 503 على GET => إعادة ثم نجاح');
    mock.state.pageNodeTransientFailures = 2;
    const callsBefore = mock.state.pageProfileCalls;
    const h2 = await fetch(`${base}/api/platforms/facebook/health`, { headers: auth });
    const h2Body = await h2.json();
    check('نجح بعد إعادتين على 503', h2.status === 200 && h2Body.healthy === true, JSON.stringify(h2Body).slice(0, 200));
    check('ثلاث محاولات فعلاً (الحد الأقصى)', mock.state.pageProfileCalls - callsBefore === 3, `attempts=${mock.state.pageProfileCalls - callsBefore}`);

    group('F-14 (Facebook) 3) 429 مع Retry-After => احترام المدة');
    mock.state.pageNodeRetryAfterOnce = '1';
    const t0 = Date.now();
    const h3 = await fetch(`${base}/api/platforms/facebook/health`, { headers: auth });
    const elapsed = Date.now() - t0;
    const h3Body = await h3.json();
    check('نجح بعد احترام 429', h3.status === 200 && h3Body.healthy === true, JSON.stringify(h3Body).slice(0, 200));
    check('احتُرمت مدة Retry-After (≥1000ms فعلياً)', elapsed >= 1000, `elapsed=${elapsed}ms`);

    group('F-02 (Facebook) 4) كود 190 من نداء رد => reauth_needed ولا محاولات لاحقة');
    await ingest(base, auth, 'facebook', 'C_190', 'بكم سعر الثلاجة بالتقسيط؟');
    mock.state.replyError = { message: 'Error validating access token: Session has expired', code: 190 };
    const r1 = await reply(base, auth, 'facebook', 'C_190', 'أهلاً بك، فريق المعرض في خدمتك.');
    check('الرد فشل صراحةً (لا تسليم وهمي)', r1.status === 502 && r1.body?.delivered === false, `status=${r1.status}`);
    check('نداء رد واحد فقط (لا إعادة على كتابة)', mock.state.commentReplyAttempts === 1, `attempts=${mock.state.commentReplyAttempts}`);
    check('الحالة العامة أُعلنت reauth_needed', (await publicConnectionStatus(base, 'facebook')) === 'reauth_needed');
    const readyAuth = await (await fetch(`${base}/api/platforms/production-readiness`, { headers: auth })).json();
    const fbReady = (readyAuth.platforms || []).find((p: any) => p.platform === 'facebook');
    check('production-readiness لم يعد يُعلن الاتصال قائماً', fbReady?.connected === false && fbReady?.productionReady === false, JSON.stringify(fbReady).slice(0, 200));
    // لوحة التحكم (control-plane) تُعلن الحالة التشغيلية FAILED مع إجراء إعادة الربط.
    const cp = await (await fetch(`${base}/api/platforms/control-plane`, { headers: auth })).json();
    const fbCp = (cp.platforms || []).find((p: any) => p.platform === 'facebook');
    check('لوحة التحكم تُعلن FAILED بعد سحب التفويض', fbCp?.state === 'FAILED', JSON.stringify(fbCp).slice(0, 220));
    check('لوحة التحكم توجّه إلى إعادة الربط', /إعادة الربط/.test(String(fbCp?.nextAction || '') + String(fbCp?.blockingReason || '')), String(fbCp?.nextAction || '').slice(0, 160));
    // الرد اللاحق محجوب بلا أي نداء مزود ثانٍ.
    await ingest(base, auth, 'facebook', 'C_AFTER', 'هل لديكم أجهزة؟');
    const r2 = await reply(base, auth, 'facebook', 'C_AFTER', 'نعم لدينا أجهزة متوفرة في المعرض.');
    check('الرد اللاحق محجوب 409', r2.status === 409, `status=${r2.status} body=${JSON.stringify(r2.body).slice(0, 160)}`);
    check('لا نداء رد ثانٍ بعد reauth_needed', mock.state.commentReplyAttempts === 1, `attempts=${mock.state.commentReplyAttempts}`);

    group('F-14 (Facebook) 5) انقطاع بعد الإرسال على POST نشر => لا إعادة، والحجز يبقى reserved');
    mock.state.replyError = null;
    check('إعادة الربط تنجح', (await connectPlatform(base, auth, 'facebook')) === 200);
    check('الاتصال عاد موثقاً', (await publicConnectionStatus(base, 'facebook')) === 'connected');
    mock.state.hangPublish = true;
    const postsBefore = mock.state.posts.length;
    const pub = await fetch(`${base}/api/platforms/facebook/publish`, {
      method: 'POST', headers: auth, body: JSON.stringify({ content: 'عرض تقسيط جديد من معرض الغرابي.', approved: true, postId: 'POST_PR_E_1' }),
    });
    const pubBody = await pub.json();
    check('النشر فشل بلا تسليم مؤكد (502)', pub.status === 502 && pubBody.success === false, `status=${pub.status}`);
    check('منشور واحد فقط أُرسل فعلاً (لا إعادة تلقائية على الكتابة)', mock.state.posts.length === postsBefore + 1, `posts=${mock.state.posts.length - postsBefore}`);
    check('الحجز الدائم بقي reserved (انقطاع ≠ فشل مؤكد)', readIdemRecord(stateDir, 'facebook:publish:POST_PR_E_1')?.status === 'reserved', JSON.stringify(readIdemRecord(stateDir, 'facebook:publish:POST_PR_E_1')));

    group('F-02 (Facebook) 6) كود 190 من نداء health => reauth_needed');
    mock.state.hangPublish = false;
    mock.state.pageNodeOAuthError = true;
    const h4 = await fetch(`${base}/api/platforms/facebook/health`, { headers: auth });
    const h4Body = await h4.json();
    check('health يرد 409 بسبب انتهاء الرمز', h4.status === 409, `status=${h4.status}`);
    check('health يُعلن reauth_needed صراحةً', h4Body.status === 'reauth_needed' && h4Body.healthy === false, JSON.stringify(h4Body).slice(0, 200));
    check('الحالة العامة تُعلن reauth_needed بعد فحص health', (await publicConnectionStatus(base, 'facebook')) === 'reauth_needed');
  } finally {
    try { await stop(app.proc); } catch { /* تجاهل */ }
    try { await mock.stop(); } catch { /* تجاهل */ }
    rmSync(stateDir, { recursive: true, force: true });
  }
}

async function instagramSuite(): Promise<void> {
  const base = `http://127.0.0.1:${IG_APP_PORT}`;
  const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-pr-e-ig-'));
  seedState(stateDir);
  const mock: { server: Server; state: InstagramMockState; base: string; stop: () => Promise<void> } =
    await startInstagramMockServer(IG_MOCK_PORT, createInstagramMock());
  const app = startApp(IG_APP_PORT, stateDir, mock.base);
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('Instagram: الخادم يقلع', await waitForHealth(base), app.log().slice(0, 400));
    Object.assign(auth, await login(base));
    check('Instagram: الربط عبر OAuth ينجح', (await connectPlatform(base, auth, 'instagram')) === 200);

    group('F-02/F-14 (Instagram) 1) فحص health حقيقي — لا 501');
    const h1 = await fetch(`${base}/api/platforms/instagram/health`, { headers: auth });
    const h1Body = await h1.json();
    check('health لا يرد 501 (فحص منفّذ)', h1.status !== 501, `status=${h1.status}`);
    check('health يرد 200 بحالة حقيقية سليمة', h1.status === 200 && h1Body.healthy === true && h1Body.provider === 'instagram', JSON.stringify(h1Body).slice(0, 200));
    check('لا يُعاد أي رمز في استجابة الفحص', !JSON.stringify(h1Body).includes('PAGE_TOKEN_TEST') && !JSON.stringify(h1Body).includes('IG_USER_TOKEN_TEST_LONG'));

    group('F-14 (Instagram) 2) 503 على GET => إعادة ثم نجاح');
    mock.state.profileTransientFailures = 2;
    const callsBefore = mock.state.calls;
    const h2 = await fetch(`${base}/api/platforms/instagram/health`, { headers: auth });
    const h2Body = await h2.json();
    check('نجح بعد إعادتين على 503', h2.status === 200 && h2Body.healthy === true, JSON.stringify(h2Body).slice(0, 200));
    check('ثلاث محاولات فعلاً (الحد الأقصى)', mock.state.calls - callsBefore === 3, `attempts=${mock.state.calls - callsBefore}`);

    group('F-02 (Instagram) 3) كود 190 من نداء رد => reauth_needed ولا محاولات لاحقة');
    await ingest(base, auth, 'instagram', 'IGC_190', 'بكم سعر الثلاجة بالتقسيط؟');
    mock.state.replyError = { message: 'Error validating access token: Session has expired', code: 190 };
    const r1 = await reply(base, auth, 'instagram', 'IGC_190', 'أهلاً بك، فريق المعرض في خدمتك.');
    check('الرد فشل صراحةً (لا تسليم وهمي)', r1.status === 502 && r1.body?.delivered === false, `status=${r1.status}`);
    check('نداء رد واحد فقط (لا إعادة على كتابة)', mock.state.commentReplyAttempts === 1, `attempts=${mock.state.commentReplyAttempts}`);
    check('الحالة العامة أُعلنت reauth_needed', (await publicConnectionStatus(base, 'instagram')) === 'reauth_needed');
    await ingest(base, auth, 'instagram', 'IGC_AFTER', 'هل لديكم أجهزة؟');
    const r2 = await reply(base, auth, 'instagram', 'IGC_AFTER', 'نعم لدينا أجهزة متوفرة في المعرض.');
    check('الرد اللاحق محجوب 409', r2.status === 409, `status=${r2.status}`);
    check('لا نداء رد ثانٍ بعد reauth_needed', mock.state.commentReplyAttempts === 1, `attempts=${mock.state.commentReplyAttempts}`);

    group('F-02 (Instagram) 4) كود 190 من نداء health => reauth_needed');
    mock.state.replyError = null;
    check('إعادة الربط تنجح', (await connectPlatform(base, auth, 'instagram')) === 200);
    mock.state.profileOAuthError = true;
    const h3 = await fetch(`${base}/api/platforms/instagram/health`, { headers: auth });
    const h3Body = await h3.json();
    check('health يرد 409 بسبب انتهاء الرمز', h3.status === 409, `status=${h3.status}`);
    check('health يُعلن reauth_needed صراحةً', h3Body.status === 'reauth_needed' && h3Body.healthy === false, JSON.stringify(h3Body).slice(0, 200));
    check('الحالة العامة تُعلن reauth_needed', (await publicConnectionStatus(base, 'instagram')) === 'reauth_needed');
  } finally {
    try { await stop(app.proc); } catch { /* تجاهل */ }
    try { await mock.stop(); } catch { /* تجاهل */ }
    rmSync(stateDir, { recursive: true, force: true });
  }
}

(async () => {
  await facebookSuite();
  await instagramSuite();
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} provider-retry/reauth integration checks`);
  }
})().catch((err) => { console.error('provider-retry integration harness crashed:', err); process.exit(1); });
