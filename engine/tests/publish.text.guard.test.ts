/**
 * اختبار تكاملي: حارس طول النص قبل الإرسال + التوزيع متعدد المنصات.
 *
 * يثبت (عطل Threads الحقيقي «Param text must be at most 500 characters long»):
 *  1) نص يتجاوز 500 **بايت** يُرفض 422 قبل أي نداء مزود (لا حاوية تُنشأ إطلاقاً).
 *  2) نص عربي «قصير» بالمحارف (300 محرف = 600 بايت) يُرفض — العدّ بـUTF-8 لا length.
 *  3) نص إيموجي «قصير» بالمحارف لكنه يتجاوز 500 بايت يُرفض.
 *  4) نص عند الحد تماماً (500 بايت) ونص صالح يصلان المزود فعلاً (نجاح بمعرّف).
 *  5) الرفض يحمل اختصاراً مقترحاً بلا أي نشر وبلا تعديل النص الأصلي.
 *  6) التوزيع متعدد المنصات: منصة متصلة تنجح وأخرى غير متصلة تفشل — حالتان مستقلتان.
 *
 * خادم Threads وهمي محلي عبر THREADS_GRAPH_API_BASE — بلا مزود حقيقي ولا سرّ.
 */

import express from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createCipheriv } from 'node:crypto';
import type { Server } from 'node:http';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const APP_PORT = 7615 + Math.floor(Math.random() * 40);
const TH_PORT = APP_PORT + 200;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'text-guard-test-secret-not-real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const THREADS_USER_ID = 'TH_GUARD_1';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-textguard-'));

let proc: ChildProcess | null = null;
let log = '';

const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };

function encryptCredForTest(value: unknown): Record<string, string> {
  const key = Buffer.from(TOKEN_KEY, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { alg: 'aes-256-gcm', iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') };
}

function seedState(): void {
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [],
    platformConnections: [{ platform: 'threads', status: 'connected', accountId: THREADS_USER_ID, accountName: '@gharabi', connectedAt: new Date().toISOString(), providerVerified: true }],
    workspace: {
      showroom: {}, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [],
      providerTokens: { threads: encryptCredForTest({ access_token: 'THREADS_VALID_TOKEN', threadsUserId: THREADS_USER_ID, username: 'gharabi', expiresAt: null, connectedAt: new Date().toISOString() }) },
    },
  }), 'utf8');
}

/** خادم Threads وهمي: يحسب عدد استدعاءات الحاوية/النشر، ويفشل النص >500 بايت كما يفعل Meta. */
function createThreadsMock() {
  const state = { containerCalls: 0, publishCalls: 0, lastText: '' };
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.get('/:version/refresh_access_token', (_req, res) => res.json({ access_token: 'THREADS_VALID_TOKEN', expires_in: 5_184_000 }));
  app.post('/:version/:userId/threads', (req, res) => {
    state.containerCalls += 1;
    const text = String(req.body?.text || '');
    state.lastText = text;
    // Meta الحقيقية: الإيموجي/النص يُحتسب UTF-8 bytes.
    if (Buffer.byteLength(text, 'utf8') > 500) {
      return res.status(400).json({ error: { message: 'Param text must be at most 500 characters long.', code: 100 } });
    }
    return res.json({ id: 'CONTAINER_GUARD_1' });
  });
  app.get('/:version/:containerId', (_req, res) => res.json({ id: 'CONTAINER_GUARD_1', status: 'FINISHED' }));
  app.post('/:version/:userId/threads_publish', (_req, res) => { state.publishCalls += 1; return res.json({ id: 'POST_GUARD_1' }); });
  return { app, state };
}
function startMock(port: number): Promise<{ server: Server; state: ReturnType<typeof createThreadsMock>['state'] }> {
  const { app, state } = createThreadsMock();
  return new Promise((resolve) => { const server = app.listen(port, () => resolve({ server, state })); });
}

function startApp(): void {
  log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    THREADS_GRAPH_API_BASE: `http://127.0.0.1:${TH_PORT}`,
  };
  delete env.GEMINI_API_KEY; delete env.DATABASE_URL;
  proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
}
async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function login(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) });
  const data = await res.json();
  const token = data?.token || data?.sessionToken;
  if (!token) throw new Error('preview-login failed: ' + JSON.stringify(data));
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}
async function publishThreads(auth: Record<string, string>, content: string) {
  const res = await fetch(`${BASE}/api/platforms/threads/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content, approved: true }) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
function stop(p: ChildProcess | null): Promise<void> {
  return new Promise((resolve) => { if (!p) return resolve(); p.once('exit', () => resolve()); p.kill('SIGTERM'); setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* ignore */ } resolve(); }, 5000); });
}

(async function main() {
  seedState();
  const mock = await startMock(TH_PORT);
  startApp();
  try {
    check('الخادم يقلع', await waitForHealth(), log.slice(0, 400));
    const auth = await login();

    group('1) نص يتجاوز 500 بايت => 422 قبل أي نداء مزود (لا حاوية)');
    const overAscii = 'a'.repeat(501);
    const before1 = mock.state.containerCalls;
    const r1 = await publishThreads(auth, overAscii);
    check('HTTP 422 (رفض قبل الإرسال)', r1.status === 422, `status=${r1.status} body=${JSON.stringify(r1.body).slice(0, 160)}`);
    check('الكود TEXT_TOO_LONG', r1.body?.code === 'TEXT_TOO_LONG', JSON.stringify(r1.body?.code));
    check('القياس الحقيقي معلن (501/500)', r1.body?.used === 501 && r1.body?.limit === 500, `${r1.body?.used}/${r1.body?.limit}`);
    check('طريقة العدّ utf8_bytes معلنة', r1.body?.countMethod === 'utf8_bytes');
    check('لم يُنشأ أي حاوية (صفر نداء مزود)', mock.state.containerCalls === before1, `calls=${mock.state.containerCalls}`);
    check('لا معرّف منشور (لا ادعاء نشر)', !r1.body?.providerPostId);
    check('اختصار مقترح مُرفق بلا إرسال', typeof r1.body?.shortenedContent === 'string' && r1.body.shortenedContent.length > 0);

    group('2) نص عربي «قصير» بالمحارف (300 محرف = 600 بايت) => مرفوض');
    const arabicHeavy = 'ع'.repeat(300);
    check('طول المحارف < 500 لكن البايتات > 500', arabicHeavy.length === 300 && Buffer.byteLength(arabicHeavy, 'utf8') === 600);
    const before2 = mock.state.containerCalls;
    const r2 = await publishThreads(auth, arabicHeavy);
    check('HTTP 422 رغم chars=300', r2.status === 422 && r2.body?.code === 'TEXT_TOO_LONG', `status=${r2.status}`);
    check('العدّ أعلن 600 بايت', r2.body?.used === 600, String(r2.body?.used));
    check('صفر نداء مزود للنص العربي الطويل', mock.state.containerCalls === before2);

    group('3) نص إيموجي «قصير» بالمحارف لكنه يتجاوز 500 بايت => مرفوض');
    const emojiHeavy = '🚀'.repeat(126); // 504 bytes, chars=252
    check('chars=252 (<500) لكن bytes=504', emojiHeavy.length === 252 && Buffer.byteLength(emojiHeavy, 'utf8') === 504);
    const before3 = mock.state.containerCalls;
    const r3 = await publishThreads(auth, emojiHeavy);
    check('HTTP 422 للإيموجي + TEXT_TOO_LONG', r3.status === 422 && r3.body?.code === 'TEXT_TOO_LONG', `status=${r3.status}`);
    check('صفر نداء مزود للإيموجي', mock.state.containerCalls === before3);

    group('4) نص عند الحد تماماً (500 بايت) => يصل المزود وينجح');
    const atLimit = 'a'.repeat(500);
    const r4 = await publishThreads(auth, atLimit);
    check('HTTP 200 ونشر ناجح', r4.status === 200 && r4.body?.success === true, `status=${r4.status} body=${JSON.stringify(r4.body).slice(0, 160)}`);
    check('معرّف منشور حقيقي من مزود Threads', r4.body?.providerPostId === 'POST_GUARD_1', String(r4.body?.providerPostId));
    check('وصل 500 بايت فعلاً للمزود (لا بايت زائد)', Buffer.byteLength(mock.state.lastText, 'utf8') === 500, String(Buffer.byteLength(mock.state.lastText, 'utf8')));

    group('5) نص صالح قصير => يصل المزود');
    const r5 = await publishThreads(auth, 'عرض التقسيط الميسر من معرض الغرابي.');
    check('HTTP 200 ونشر ناجح', r5.status === 200 && r5.body?.success === true, `status=${r5.status}`);
    check('معرّف نشر حقيقي', r5.body?.providerPostId === 'POST_GUARD_1');

    group('6) التوزيع متعدد المنصات: حالة مستقلة لكل منصة');
    // منشور بمنصتين: threads (متصلة) + telegram (غير متصلة) — الاعتماد عبر المسار الرسمي.
    const createRes = await fetch(`${BASE}/api/workspace/content`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'منشور اختبار الحارس', content: 'عرض التقسيط الميسر بلا تجاوز للحد.', status: 'review', targetPlatforms: ['threads', 'telegram'], platformVersions: { threads: 'عرض التقسيط الميسر بلا تجاوز للحد.' } }),
    });
    const createBody = await createRes.json();
    const postId = createBody?.post?.id;
    check('أُنشئ منشور بمنصتين للمراجعة', Boolean(postId), JSON.stringify(createBody).slice(0, 160));
    const approveRes = await fetch(`${BASE}/api/workspace/content/${postId}/approve`, { method: 'POST', headers: auth, body: JSON.stringify({ note: 'اعتماد اختباري' }) });
    const approveBody = await approveRes.json();
    check('الاعتماد الرسمي نجح والحالة approved', approveRes.status === 200 && approveBody?.post?.status === 'approved', `status=${approveRes.status}`);
    const pubRes = await fetch(`${BASE}/api/workspace/content/${postId}/publish`, { method: 'POST', headers: auth, body: '{}' });
    const pubBody = await pubRes.json();
    check('التوزيع متعدد المنصات أعاد نتائج', pubRes.status === 200 && Boolean(pubBody?.results), `status=${pubRes.status}`);
    check('threads نجح بمعرّف مزود', pubBody?.results?.threads?.state === 'published' && pubBody?.results?.threads?.providerPostId === 'POST_GUARD_1', JSON.stringify(pubBody?.results?.threads));
    check('telegram منفصل الحالة (غير published بلا ادعاء)', pubBody?.results?.telegram?.state === 'failed', JSON.stringify(pubBody?.results?.telegram));
    check('لم تُخلط حالات المنصات (نجاح تيليجرام لم يُزوَّر)', pubBody?.results?.telegram?.state !== 'published');
    check('anyDelivered=true لأن threads نجح فعلاً', pubBody?.anyDelivered === true);
    check('لا تسريب رمز/سرّ في الاستجابة', !/THREADS_VALID_TOKEN|access_token|Bearer /.test(JSON.stringify(pubBody)));
  } finally {
    await stop(proc);
    await new Promise((r) => mock.server.close(r));
  }

  rmSync(stateDir, { recursive: true, force: true });
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} publish text-guard + multi-platform checks`);
  }
})();
