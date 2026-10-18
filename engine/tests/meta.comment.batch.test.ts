/**
 * اختبار حجم نداءات Graph لسحب تعليقات Facebook/Instagram (إصلاح النداء لكل منشور).
 *
 * يُثبت على خادم حقيقي + خادم Graph وهمي محلي (بلا مزود Meta حقيقي ولا حصة):
 *  1) 45 منشوراً على فيسبوك ⇒ **نداء تعليقات واحد** مجمّع (`GET /?ids=`) لا 45.
 *  2) ≤ 5 نداءات Graph للدورة على فيسبوك (3 لجمع المعرّفات + 1-2 للتعليقات).
 *  3) صفر نداء لتعليقات منشور منفرد (`GET /{post-id}?fields=comments`).
 *  4) تعليق على منشور فيديو/ريلز (لا يظهر في /feed) يُقرأ رغم التجميع.
 *  5) `callsPerCycle` معلن لكل منصة في حالة المراقب.
 *
 * حالات التجميع تفشل على الكود القديم (نداء لكل منشور).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createFacebookMock, startFacebookMockServer } from './helpers/facebookMock';

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
const APP_PORT = 7600 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FB_PORT = 7700 + Math.floor(Math.random() * 100);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'batch-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_batch_123';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_batch';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-batch-'));

// 44 منشوراً في /feed + منشور فيديو/ريلز واحد (غير موجود في /feed) = 45 منشوراً.
const FEED_POST_COUNT = 44;
const VIDEO_POST = 'POST_VIDEO_BATCH';
const feedPosts = Array.from({ length: FEED_POST_COUNT }, (_, i) => ({
  id: `POST_FEED_${i}`,
  comments: i === 0
    ? [{ id: 'C_BATCH_1', message: 'كم سعر شاشة شارب', from: { id: 'U_X', name: 'سالم' }, created_time: '2026-02-02T00:00:00+0000' }]
    : [],
}));

function startApp(fbBase: string, appPort = APP_PORT): { proc: ChildProcess; log: () => string; base: string } {
  let log = '';
  const base = `http://127.0.0.1:${appPort}`;
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(appPort),
    NODE_ENV: 'production',
    APP_URL: base,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    FACEBOOK_GRAPH_API_BASE: fbBase,
    FACEBOOK_DIALOG_BASE: fbBase,
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: FB_APP_SECRET,
    FACEBOOK_VERIFY_TOKEN: FB_VERIFY_TOKEN,
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log, base };
}
async function waitForHealth(timeoutMs = 180_000, base = BASE): Promise<boolean> {
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
async function login(base = BASE): Promise<Record<string, string>> {
  const res = await fetch(`${base}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
  });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}

async function main(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(),
    users: [{ id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() }],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: {
      showroom: { name: 'معرض الغرابي' },
      products: [{ id: 'prod_1', name: 'شاشة شارب 50 بوصة', cashPrice: 500000, downPaymentPercent: 20, durationMonths: 12, inStock: true, category: 'tv' }],
      posts: [], socialComments: [], socialReplies: [], socialApprovals: [], publishRecords: [],
    },
  }), 'utf8');

  const mock = await startFacebookMockServer(FB_PORT, createFacebookMock({
    feedPosts,
    // منشور فيديو/ريلز بتعليق — لا يظهر في /feed إطلاقاً (كما في Graph الحقيقي).
    pageVideos: [
      { id: VIDEO_POST, comments: [
        { id: 'C_VIDEO_BATCH', message: 'شكد سعر هالفيديو؟', from: { id: 'U_D', name: 'مريم' }, created_time: '2026-02-02T00:05:00+0000' },
      ] },
    ],
    pageReels: [],
  }));
  const app = startApp(mock.base);
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());

    group('1) ربط Facebook عبر OAuth (خادم Graph وهمي)');
    const startRes = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const state = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
    const cbRes = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(state)}&code=TESTCODE`);
    check('callback ينجح', cbRes.status === 200, `status=${cbRes.status}`);

    group('2) دورة المراقب: 45 منشوراً ⇒ نداء تعليقات واحد');
    await fetch(`${BASE}/api/agent/meta/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, autoReply: false, paused: false }) });
    const poll = await (await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الدورة تعمل', poll.success === true, JSON.stringify(poll));

    // 45 معرّفاً ⇒ طلب مجمّع واحد فقط (50 كحدّ).
    check('45 منشوراً = نداء تعليقات واحد (GET /?ids=)', mock.state.commentBatchCalls === 1, `batch=${mock.state.commentBatchCalls}`);
    check('صفر نداء لتعليقات منشور منفرد', mock.state.commentNodeCalls === 0, `node=${mock.state.commentNodeCalls}`);

    const owner = await (await fetch(`${BASE}/api/agent/meta/watcher`, { headers: auth })).json();
    const seenIds = (owner.watcher?.recent || []).map((r: any) => r.commentId);
    check('تعليق على منشور فيديو/ريلز قُرئ رغم التجميع', seenIds.includes('C_VIDEO_BATCH'), JSON.stringify(seenIds));
    check('تعليق /feed قُرئ أيضاً', seenIds.includes('C_BATCH_1'), JSON.stringify(seenIds));

    const stats = owner.watcher?.platformStats?.facebook;
    check('postsScanned = 45', Number(stats?.postsScanned || 0) === 45, JSON.stringify(stats));
    check('commentsVisible = 2', Number(stats?.commentsVisible || 0) === 2, JSON.stringify(stats));
    check('callsPerCycle معلن (≤ 5)', Number(stats?.callsPerCycle || 0) > 0 && Number(stats?.callsPerCycle || 0) <= 5, JSON.stringify(stats));
    check('callsPerCycle = 4 (3 معرّفات + 1 مجمّع)', Number(stats?.callsPerCycle || 0) === 4, JSON.stringify(stats));
  } finally {
    await stop(app.proc);
    await mock.stop();
  }

  // ---------------------------------------------------------------------------
  // مجموعة 2: السقوط الآمن عند رفض Graph للطلب المجمّع `?ids=` كاملاً.
  // الجذر المُثبت على الإنتاج: Graph رفض الطلب المجمّع فسقط السحب كله (degraded).
  // الإصلاح: السقوط إلى قراءة التعليقات مضمَّنة داخل الحواف (feed/videos/reels)
  // فلا تُفقد أي تعليقات. هذا السيناريو يفشل على الكود بلا سقوط آمن.
  // ---------------------------------------------------------------------------
  {
    const FB_PORT2 = FB_PORT + 1;
    const APP_PORT2 = APP_PORT + 1;
    const BASE2 = `http://127.0.0.1:${APP_PORT2}`;
    const mock2 = await startFacebookMockServer(FB_PORT2, createFacebookMock({
      feedPosts,
      pageVideos: [{ id: VIDEO_POST, comments: [
        { id: 'C_VIDEO_BATCH', message: 'شكد سعر هالفيديو؟', from: { id: 'U_D', name: 'مريم' }, created_time: '2026-02-02T00:05:00+0000' },
      ] }],
      pageReels: [],
      failCommentBatch: true, // Graph يرفض الطلب المجمّع كاملاً
    }));
    const app2 = startApp(mock2.base, APP_PORT2);
    try {
      group('2) السقوط الآمن عند رفض الطلب المجمّع (45 منشوراً)');
      check('الخادم الثاني يقلع', await waitForHealth(180_000, BASE2), app2.log().slice(0, 400));
      const auth2 = await login(BASE2);
      const startRes2 = await (await fetch(`${BASE2}/api/platforms/facebook/oauth/start`, { headers: auth2 })).json();
      const state2 = new URL(startRes2.authorizationUrl).searchParams.get('state') || '';
      const cbRes2 = await fetch(`${BASE2}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(state2)}&code=TESTCODE`);
      check('callback ينجح (2)', cbRes2.status === 200, `status=${cbRes2.status}`);

      await fetch(`${BASE2}/api/agent/meta/watcher/controls`, { method: 'POST', headers: auth2, body: JSON.stringify({ enabled: true, autoReply: false, paused: false }) });
      const poll2 = await (await fetch(`${BASE2}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth2, body: '{}' })).json();
      check('الدورة تعمل رغم رفض المجمّع', poll2.success === true, JSON.stringify(poll2));

      const owner2 = await (await fetch(`${BASE2}/api/agent/meta/watcher`, { headers: auth2 })).json();
      const seenIds2 = (owner2.watcher?.recent || []).map((r: any) => r.commentId);
      check('التعليقات لم تُفقد بعد رفض المجمّع (فشل صامت مُغلَق)', seenIds2.includes('C_BATCH_1') && seenIds2.includes('C_VIDEO_BATCH'), JSON.stringify(seenIds2));
      const stats2 = owner2.watcher?.platformStats?.facebook;
      check('postsScanned = 45 (سقوط آمن)', Number(stats2?.postsScanned || 0) === 45, JSON.stringify(stats2));
      check('callsPerCycle ≤ 7 (3 معرّفات + 1 مجمّع فاشل + 3 حواف)', Number(stats2?.callsPerCycle || 0) > 0 && Number(stats2?.callsPerCycle || 0) <= 7, JSON.stringify(stats2));
      check('لا انهيار: lastError ليس خطأ السحب (السقوط نجح)', (owner2.watcher?.lastError ?? null) === null, JSON.stringify(owner2.watcher?.lastError));
    } finally {
      await stop(app2.proc);
      await mock2.stop();
    }
  }
  rmSync(stateDir, { recursive: true, force: true });

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} — passed ${passed}`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} meta comment-batch checks`);
}
void main();
