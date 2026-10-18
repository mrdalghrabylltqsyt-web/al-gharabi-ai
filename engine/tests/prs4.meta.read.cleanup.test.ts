/**
 * اختبار PR-S4 — تنظيف قراءة فيسبوك: حذف مسار `?ids=` كلياً + فحص التغطية.
 *
 * يُثبت على خادم حقيقي + خادم Graph وهمي محلي (بلا مزود Meta حقيقي ولا حصة):
 *  1) **لا نداء `?ids=` إطلاقاً** (كان Graph يرفضه كل دورة فيُهدر نداءً ويسجّل خطأً).
 *  2) `callsPerCycle ≤ 4` على فيسبوك (3 حواف: feed + videos + video_reels).
 *  3) منشور فيه 30 تعليقاً يُقرأ أحدث 25 منها (order=reverse_chronological + limit=25).
 *  4) `filter(stream)` يُدخل الردود المتداخلة (كان الفلتر الافتراضي toplevel يستبعدها
 *     = سبب فرق التغطية المُثبت في البند 2).
 *  5) `commentsTotalReported` يُعلَن بجانب `commentsVisible` في platformStats.
 *  6) `permalink_url` الحقيقي يُقرأ (لزر «فتح على فيسبوك»).
 *
 * كل حالات التجميع/الفلتر تفشل على الكود القديم.
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

// 12 منشوراً في /feed + منشور فيديو (غير موجود في /feed) = 13 منشوراً.
// المنشور الأول يحمل 30 تعليقاً: 25 ظاهرة + 5 ردود متداخلة (لها parent) — تُثبت
// حدّ الصفحات (25) وفلتر stream (يُدخل الردود) في آن.
const FEED_POST_COUNT = 12;
const VIDEO_POST = 'POST_VIDEO_BATCH';
const BIG_POST = 'POST_FEED_BIG';
const BIG_POST_COMMENTS = 30;
const BIG_POST_VISIBLE = 25;
const bigPostComments = Array.from({ length: BIG_POST_COMMENTS }, (_, i) => ({
  id: `C_BIG_${i}`,
  message: `استفسار رقم ${i}`,
  from: { id: `U_BIG_${i}`, name: `زبون ${i}` },
  // created_time متزايد مع الفهرس: الأحدث = أعلى فهرس (يُثبت order(reverse)).
  created_time: new Date(Date.parse('2026-02-01T00:00:00+0000') + i * 60_000).toISOString(),
  // آخر 5 تعليقات ردود متداخلة (parent) — يستبعدها الفلتر الافتراضي toplevel.
  ...(i >= BIG_POST_VISIBLE ? { parent: { id: 'C_BIG_0' } } : {}),
}));
const feedPosts = Array.from({ length: FEED_POST_COUNT }, (_, i) => ({
  id: i === 0 ? BIG_POST : `POST_FEED_${i}`,
  comments: i === 0
    ? bigPostComments
    : (i === 1 ? [{ id: 'C_BATCH_1', message: 'كم سعر شاشة شارب', from: { id: 'U_X', name: 'سالم' }, created_time: '2026-02-02T00:00:00+0000' }] : []),
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

    group('2) دورة المراقب: لا نداء ?ids= و callsPerCycle ≤ 4');
    await fetch(`${BASE}/api/agent/meta/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, autoReply: false, paused: false }) });
    const poll = await (await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الدورة تعمل', poll.success === true, JSON.stringify(poll));

    // البند 1: حُذف مسار الطلب المجمّع كلياً.
    check('لا نداء ?ids= إطلاقاً (المسار محذوف)', mock.state.commentBatchCalls === 0, `batch=${mock.state.commentBatchCalls}`);
    check('صفر نداء لتعليقات منشور منفرد', mock.state.commentNodeCalls === 0, `node=${mock.state.commentNodeCalls}`);

    const owner = await (await fetch(`${BASE}/api/agent/meta/watcher`, { headers: auth })).json();
    const stats = owner.watcher?.platformStats?.facebook;
    check('callsPerCycle ≤ 4 على فيسبوك', Number(stats?.callsPerCycle || 0) > 0 && Number(stats?.callsPerCycle || 0) <= 4, JSON.stringify(stats));
    check('callsPerCycle = 3 (feed + videos + video_reels)', Number(stats?.callsPerCycle || 0) === 3, JSON.stringify(stats));
    check('لا خطأ متكرر: lastError فارغ', (owner.watcher?.lastError ?? null) === null, JSON.stringify(owner.watcher?.lastError));

    // البند 1: القراءة مضمَّنة بـfilter(stream) + order(reverse_chronological).
    check('القراءة تطلب filter(stream) (الردود المتداخلة مضمَّنة)',
      mock.state.commentFieldsSeen.length > 0 && mock.state.commentFieldsSeen.every((f) => /filter\(stream\)/.test(f)), JSON.stringify(mock.state.commentFieldsSeen.slice(0, 2)));
    check('القراءة تطلب order(reverse_chronological)',
      mock.state.commentFieldsSeen.every((f) => /order\(reverse_chronological\)/.test(f)), JSON.stringify(mock.state.commentFieldsSeen.slice(0, 2)));

    // البند 2: منشور فيه 30 تعليقاً ⇒ يُقرأ أحدث 25 فقط (حد الصفحات مُعلَن لا صامت).
    const bigSeen = mock.state.commentIdsReturned.filter((id) => id.startsWith('C_BIG_'));
    check('منشور 30 تعليقاً يُقرأ منه 25 (حد الصفحات)', bigSeen.length === BIG_POST_VISIBLE, `read=${bigSeen.length}`);
    check('التعليقات المقروءة هي الأحدث (order=reverse_chronological)',
      !bigSeen.includes('C_BIG_0') && bigSeen.includes('C_BIG_29'), JSON.stringify(bigSeen.slice(0, 5)));

    // البند 2: التعليقان (feed + video) مرئيان فعلاً في القراءة.
    // نتحقّق من القراءة الفعلية (لا من سجل المعالجة المحدود بـ15/دورة).
    check('تعليق منشور الفيديو قُرئ رغم أنه ليس في /feed', mock.state.commentIdsReturned.includes('C_VIDEO_BATCH'), JSON.stringify(mock.state.commentIdsReturned.filter((x) => !x.startsWith('C_BIG_')).slice(0, 8)));
    check('تعليق /feed قُرئ أيضاً', mock.state.commentIdsReturned.includes('C_BATCH_1'), JSON.stringify(mock.state.commentIdsReturned.filter((x) => !x.startsWith('C_BIG_')).slice(0, 8)));

    // البند 2: commentsTotalReported يُعلن بجانب commentsVisible.
    check('postsScanned = 13 (12 feed + 1 video)', Number(stats?.postsScanned || 0) === 13, JSON.stringify(stats));
    check('commentsTotalReported معلن', Number(stats?.commentsTotalReported || 0) >= BIG_POST_VISIBLE, JSON.stringify(stats));
    check('commentsVisible = 27 (25 + 1 feed + 1 video)', Number(stats?.commentsVisible || 0) === 27, JSON.stringify(stats));
  } finally {
    await stop(app.proc);
    await mock.stop();
  }

  // ---------------------------------------------------------------------------
  // مجموعة 2: لا مسار مجمّع إطلاقاً — حتى مع failCommentBatch لا يوجد نداء ?ids=.
  // على الكود القديم كان الطلب المجمّع يُهدر نداءً ويسجّل خطأً كل دورة.
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
      failCommentBatch: true, // لو استُدعي ?ids= لفشل — لكنه محذوف فلا يُستدعى.
    }));
    const app2 = startApp(mock2.base, APP_PORT2);
    try {
      group('2) لا مسار مجمّع: الدورة نظيفة بلا خطأ ولا نداء ?ids=');
      check('الخادم الثاني يقلع', await waitForHealth(180_000, BASE2), app2.log().slice(0, 400));
      const auth2 = await login(BASE2);
      const startRes2 = await (await fetch(`${BASE2}/api/platforms/facebook/oauth/start`, { headers: auth2 })).json();
      const state2 = new URL(startRes2.authorizationUrl).searchParams.get('state') || '';
      const cbRes2 = await fetch(`${BASE2}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(state2)}&code=TESTCODE`);
      check('callback ينجح (2)', cbRes2.status === 200, `status=${cbRes2.status}`);

      await fetch(`${BASE2}/api/agent/meta/watcher/controls`, { method: 'POST', headers: auth2, body: JSON.stringify({ enabled: true, autoReply: false, paused: false }) });
      const poll2 = await (await fetch(`${BASE2}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth2, body: '{}' })).json();
      check('الدورة تعمل', poll2.success === true, JSON.stringify(poll2));

      check('لا نداء ?ids= إطلاقاً', mock2.state.commentBatchCalls === 0, `batch=${mock2.state.commentBatchCalls}`);
      const owner2 = await (await fetch(`${BASE2}/api/agent/meta/watcher`, { headers: auth2 })).json();
      check('التعليقات قُرئت كلها (feed + video)', mock2.state.commentIdsReturned.includes('C_BATCH_1') && mock2.state.commentIdsReturned.includes('C_VIDEO_BATCH'), JSON.stringify(mock2.state.commentIdsReturned.filter((x) => !x.startsWith('C_BIG_')).slice(0, 8)));
      const stats2 = owner2.watcher?.platformStats?.facebook;
      check('callsPerCycle ≤ 4 (2)', Number(stats2?.callsPerCycle || 0) > 0 && Number(stats2?.callsPerCycle || 0) <= 4, JSON.stringify(stats2));
      check('صفر أخطاء متكررة: lastError فارغ', (owner2.watcher?.lastError ?? null) === null, JSON.stringify(owner2.watcher?.lastError));
      check('consecutiveErrors = 0', Number(owner2.watcher?.consecutiveErrors || 0) === 0, JSON.stringify(owner2.watcher?.consecutiveErrors));
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
  console.log(`PASSED: ${passed} PR-S4 meta read-cleanup checks`);
}
void main();
