/**
 * اختبار انحدار جذري: تكرار فشل نشر Threads الصامت لحساب مربوط قبل تخزين `expiresAt`.
 *
 * الجذر المُثبت: `isAccessTokenExpired({ expiresAt: null })` يُعيد false (لا انتهاء
 * معلن)، فيمرّر `ensureThreadsAccessToken` الرمز كما هو بلا تجديد، ثم يرفضه Meta
 * بـ190 «Session has expired» — فيتكرّر نفس الفشل إلى ما لا نهاية بلا أي محاولة
 * تجديد. هذا الاختبار يثبت أن النظام الآن:
 *  (أ) عند فشل العملية بـTOKEN_EXPIRED رغم ذلك => يُجرّب تجديداً قسرياً واحداً؛
 *  (ب) إن نجح التجديد => يُعاد المحاولة وينجح النشر بمعرّف منشور حقيقي من المزود؛
 *  (ج) إن فشل التجديد => يُعلن reauth_needed صراحةً (لا بقاء على connected بصمت،
 *      ولا تكرار صامت) مع تمرير كود Meta الحقيقي (190).
 *
 * خادم Threads وهمي محلي عبر THREADS_GRAPH_API_BASE — بلا مزود حقيقي ولا سرّ.
 */

import express from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash, createCipheriv } from 'node:crypto';
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
const APP_PORT = 6900 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const TH_PORT = 6980 + Math.floor(Math.random() * 15);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'threads-recovery-test-secret-not-real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const OLD_TOKEN = 'THREADS_OLD_TOKEN_NO_EXPIRY';
const NEW_TOKEN = 'THREADS_NEW_TOKEN';
const THREADS_USER_ID = 'TH_USER_1';

const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-threads-recovery-'));
const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };

/** يشفّر اعتماداً بنفس خوارزمية الخادم (AES-256-GCM) — للاختبار فقط. */
function encryptCredForTest(value: unknown): Record<string, string> {
  const key = Buffer.from(TOKEN_KEY, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { alg: 'aes-256-gcm', iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') };
}

/** يكتب حالة أولية: حساب Threads «متصل موثق» برمز قديم بلا expiresAt (الحالة الجذرية). */
function seedState(): void {
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [],
    platformConnections: [{ platform: 'threads', status: 'connected', accountId: THREADS_USER_ID, accountName: '@gharabi', connectedAt: new Date().toISOString(), providerVerified: true }],
    workspace: {
      showroom: {}, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [],
      providerTokens: { threads: encryptCredForTest({ access_token: OLD_TOKEN, threadsUserId: THREADS_USER_ID, username: 'gharabi', expiresAt: null, connectedAt: new Date().toISOString() }) },
    },
  }), 'utf8');
}

/** خادم Threads وهمي: الرمز القديم يُرفض بـ190، والتجديد ينجح أو يفشل حسب الحالة. */
function createThreadsMock(options: { refreshSucceeds: boolean }) {
  const state = { refreshCalls: 0, containerCalls: 0, publishCalls: 0 };
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.get('/:version/refresh_access_token', (_req, res) => {
    state.refreshCalls += 1;
    if (!options.refreshSucceeds) return res.status(400).json({ error: { message: 'Error validating access token: The session is invalid because the user logged out.', code: 190 } });
    return res.json({ access_token: NEW_TOKEN, expires_in: 5_184_000 });
  });
  app.post('/:version/:userId/threads', (req, res) => {
    state.containerCalls += 1;
    if (req.query.access_token === OLD_TOKEN) return res.status(400).json({ error: { message: 'Error validating access token: Session has expired on Wednesday, 07-Oct-26 11:00:00 PDT.', code: 190, error_subcode: 463 } });
    return res.json({ id: 'CONTAINER_1' });
  });
  // قراءة حالة الحاوية (تُستدعى الآن قبل النشر): FINISHED افتراضاً.
  app.get('/:version/:containerId', (_req, res) => res.json({ id: 'CONTAINER_1', status: 'FINISHED' }));
  app.post('/:version/:userId/threads_publish', (req, res) => {
    state.publishCalls += 1;
    if (req.query.access_token === OLD_TOKEN) return res.status(400).json({ error: { message: 'Error validating access token: Session has expired on Wednesday, 07-Oct-26 11:00:00 PDT.', code: 190, error_subcode: 463 } });
    return res.json({ id: 'POST_1' });
  });
  return { app, state };
}

function startMock(port: number, options: { refreshSucceeds: boolean }): Promise<{ server: Server; state: { refreshCalls: number; containerCalls: number; publishCalls: number } }> {
  const { app, state } = createThreadsMock(options);
  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve({ server, state }));
  });
}

function startApp(): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    THREADS_GRAPH_API_BASE: `http://127.0.0.1:${TH_PORT}`,
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
async function publish(auth: Record<string, string>) {
  const res = await fetch(`${BASE}/api/platforms/threads/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'منشور تجريبي من معرض الغرابي.', approved: true }) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function threadsConnected(auth: Record<string, string>): Promise<boolean> {
  const res = await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth });
  const body = await res.json();
  const row = (body.platforms || []).find((p: any) => p.platform === 'threads');
  return Boolean(row?.connected);
}

(async () => {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }

  // ── السيناريو أ: التجديد يفشل => reauth_needed صريح، لا تكرار صامت ──────────
  group('أ) رمز قديم بلا expiresAt + فشل التجديد => TOKEN_EXPIRED وreauth_needed (لا بقاء على connected)');
  {
    seedState();
    const mock = await startMock(TH_PORT, { refreshSucceeds: false });
    const app = startApp();
    try {
      check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
      const auth = await login();
      check('الحساب مُحمَّل كمتصل قبل النشر (إثبات الحالة الجذرية)', (await threadsConnected(auth)) === true);
      const result = await publish(auth);
      check('النشر يفشل صراحةً (لا نجاح وهمي)', result.status === 502 && result.body?.success === false, `status=${result.status}`);
      check('كود الخطأ الحقيقي من Meta (190) مُمرَّر', result.body?.providerCode === 190, String(result.body?.providerCode));
      check('الكود المصنَّف TOKEN_EXPIRED', result.body?.code === 'TOKEN_EXPIRED', String(result.body?.code));
      check('لا معرّف منشور مزوّد (لا ادعاء نشر)', !result.body?.providerPostId);
      check('جُرّب تجديد قسري فعلاً (refreshCalls >= 1)', mock.state.refreshCalls >= 1, `refreshCalls=${mock.state.refreshCalls}`);
      check('فشل التجديد => الاتصال صار reauth_needed (لا connected صامت)', (await threadsConnected(auth)) === false);
    } finally {
      await stop(app.proc);
      await new Promise((r) => mock.server.close(r));
    }
  }

  // ── السيناريو ب: التجديد ينجح => إعادة محاولة واحدة تنجح بمعرّف حقيقي ─────────
  group('ب) رمز قديم بلا expiresAt + نجاح التجديد => إعادة محاولة تلقائية تنشر بمعرّف من المزود');
  {
    seedState();
    const mock = await startMock(TH_PORT, { refreshSucceeds: true });
    const app = startApp();
    try {
      check('الخادم يقلع لسيناريو التجديد الناجح', await waitForHealth(), app.log().slice(0, 300));
      const auth = await login();
      check('الحساب مُحمَّل كمتصل قبل النشر', (await threadsConnected(auth)) === true);
      const result = await publish(auth);
      check('النشر ينجح بعد التجديد التلقائي (200)', result.status === 200 && result.body?.success === true, `status=${result.status} body=${JSON.stringify(result.body).slice(0, 200)}`);
      check('معرّف منشور حقيقي من Threads مُمرَّر', result.body?.providerPostId === 'POST_1', String(result.body?.providerPostId));
      check('جُرّب التجديد القسري (refreshCalls >= 1)', mock.state.refreshCalls >= 1, `refreshCalls=${mock.state.refreshCalls}`);
      check('الاتصال بقي connected (لا reauth_needed بلا داعٍ)', (await threadsConnected(auth)) === true);
      check('لم يُنشأ منشور إضافي (حاوية واحدة فقط)', mock.state.publishCalls === 1, `publishCalls=${mock.state.publishCalls}`);
    } finally {
      await stop(app.proc);
      await new Promise((r) => mock.server.close(r));
    }
  }

  rmSync(stateDir, { recursive: true, force: true });
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} Threads publish-recovery checks`);
  }
})();
