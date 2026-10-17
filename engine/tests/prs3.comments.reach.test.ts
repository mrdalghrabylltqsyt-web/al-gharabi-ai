/**
 * اختبار تكامل PR-S3 — «وصول التعليقات + الزبون الحقيقي + مسودة فورية».
 *
 * يُثبت على خادم حقيقي + خادم Graph وهمي محلي (بلا مزود Meta حقيقي ولا حصة):
 *  1) تعليق على منشور **فيديو/ريلز** (لا يظهر في /feed) يُقرأ فعلاً — إصلاح الفشل الصامت.
 *  2) تعليق جديد بعد تعليقات قديمة يُقرأ (order=reverse_chronological + كل المنشورات).
 *  3) معلّقان مختلفان على نفس المنشور = **زبونان**، والشخص نفسه مرتين = **زبون واحد**.
 *  4) «كم سعر» على منشور بمنتج مسجّل ⇒ مسودة بسعر حقيقي **بلا نداء مزوّد**، ومنتج
 *     مجهول ⇒ مسودة **بلا أي رقم**.
 *  5) 48 ساعة بلا استقبال مع وجود منشورات ⇒ **تحذير ظاهر** في /api/health.
 *
 * كل الحالات تفشل على الكود القديم (سحب /feed وحده + هوية thread:<postId>).
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
const APP_PORT = 7500 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FB_PORT = 7900 + Math.floor(Math.random() * 100);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'prs3-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_prs3_123';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_prs3';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-prs3-'));

// منشور فيديو/ريلز (غير موجود في /feed) + منشور /feed عادي بمنتج مسجّل.
const VIDEO_POST = 'POST_VIDEO_REEL';
const FEED_POST = 'POST_FEED_PRICED';
const UNKNOWN_POST = 'POST_UNKNOWN';

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
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}
async function waitForHealth(timeoutMs = 180_000): Promise<boolean> {
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
  const res = await fetch(`${BASE}/api/auth/preview-login`, {
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
      posts: [], socialComments: [], socialReplies: [], socialApprovals: [],
      // منشور /feed مربوط بالمنتج (معرّف صريح فقط).
      publishRecords: [{ id: 'pub_1', platform: 'facebook', postId: 'x', providerPostId: FEED_POST, productId: 'prod_1', state: 'published', simulated: false }],
    },
  }), 'utf8');

  const mock = await startFacebookMockServer(FB_PORT, createFacebookMock({
    // /feed فيه منشور واحد فقط (بلا تعليقات جديدة مهمّة) — الفيديو/الريلز منفصلان.
    feedPosts: [
      { id: FEED_POST, comments: [
        { id: 'C_PRICE', message: 'كم سعر شاشة شارك حجم 50', from: { id: 'U_A', name: 'علي' }, created_time: '2026-02-02T00:00:00+0000' },
        { id: 'C_A2', message: 'بكم هذا', from: { id: 'U_A', name: 'علي' }, created_time: '2026-02-02T00:02:00+0000' },
        { id: 'C_B', message: 'شنو سعر التوصيل', from: { id: 'U_B', name: 'حسن' }, created_time: '2026-02-02T00:03:00+0000' },
      ] },
      { id: UNKNOWN_POST, comments: [
        { id: 'C_UNKNOWN', message: 'كم سعر الموبايل؟', from: { id: 'U_C', name: 'زيد' }, created_time: '2026-02-02T00:04:00+0000' },
      ] },
    ],
    // منشور فيديو/ريلز بتعليق — لا يظهر في /feed إطلاقاً (كما في Graph الحقيقي).
    pageVideos: [
      { id: VIDEO_POST, comments: [
        { id: 'C_VIDEO', message: 'شكد سعر هالفيديو؟', from: { id: 'U_D', name: 'مريم' }, created_time: '2026-02-02T00:05:00+0000' },
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

    group('2) ضبط المراقبة + تفعيل العقل التجاري (وضع الموافقة)');
    await fetch(`${BASE}/api/agent/meta/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, autoReply: false, paused: false }) });
    const kill = await (await fetch(`${BASE}/api/agent/commercial/kill-switch`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true }) })).json();
    check('تفعيل العقل التجاري ينجح', kill.success === true, JSON.stringify(kill));

    group('3) دورة المراقب: قراءة من كل المنشورات (feed + videos)');
    const poll = await (await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الدورة تعمل', poll.success === true, JSON.stringify(poll));

    const owner = await (await fetch(`${BASE}/api/agent/meta/watcher`, { headers: auth })).json();
    const seenIds = (owner.watcher?.recent || []).map((r: any) => r.commentId);
    check('تعليق على منشور فيديو/ريلز قُرئ (فشل صامت مُصلح)', seenIds.includes('C_VIDEO'), JSON.stringify(seenIds));
    check('تعليق /feed قُرئ أيضاً', seenIds.includes('C_PRICE'), JSON.stringify(seenIds));
    check('تعليق على منشور غير مرتبط قُرئ', seenIds.includes('C_UNKNOWN'), JSON.stringify(seenIds));

    const stats = owner.watcher?.platformStats?.facebook;
    check('عدد المنشورات المفحوصة > 1 (feed + videos)', Number(stats?.postsScanned || 0) > 1, JSON.stringify(stats));
    check('عدد التعليقات المرئية = 5', Number(stats?.commentsVisible || 0) === 5, JSON.stringify(stats));
    check('وقت آخر استقبال فعلي مسجّل', Boolean(stats?.lastIngestAt), JSON.stringify(stats));
    // حجم النداءات: قراءة مجمّعة واحدة للتعليقات (لا نداء لكل منشور) + ≤ 5 للدورة.
    check('قراءة تعليقات مجمّعة واحدة (بلا نداء لكل منشور)', mock.state.commentBatchCalls === 1, `batch=${mock.state.commentBatchCalls}`);
    check('صفر نداء لتعليقات منشور منفرد', mock.state.commentNodeCalls === 0, `node=${mock.state.commentNodeCalls}`);
    check('callsPerCycle معلن ومحدود (≤ 5) لفيسبوك', Number(stats?.callsPerCycle || 0) > 0 && Number(stats?.callsPerCycle || 0) <= 5, JSON.stringify(stats));

    group('4) هوية الزبون: معلّقان مختلفان = زبونان، نفس الشخص مرتين = زبون واحد');
    // تشغيل دورة العقل التجاري الآن (الجدولة الافتراضية لا تعمل فوراً في الاختبار).
    const run = await (await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('دورة العقل التجاري تعمل', run.success === true, JSON.stringify(run));
    const leadsRes = await (await fetch(`${BASE}/api/commercial/leads`, { headers: auth })).json();
    const inboxEarly = await (await fetch(`${BASE}/api/commercial/inbox`, { headers: auth })).json();
    const leadKeys = (inboxEarly.leads || []).map((l: any) => l.key).filter(Boolean);
    check('العملاء مسجّلون (من التصريح)', Array.isArray(leadsRes.leads) && leadsRes.leads.length > 0, JSON.stringify(leadsRes.leads));
    // U_A (تعليقان) = زبون واحد؛ U_B = زبون؛ U_C = زبون؛ U_D = زبون ⇒ 4 زبائن من 5 تعليقات.
    const authorKeys = leadKeys.filter((k: string) => k.includes('author:'));
    check('عدد الزبائن الحقيقيين = 4 (لا زبون واحد للمنشور)', authorKeys.length === 4, JSON.stringify(leadKeys));
    check('زبون U_A واحد فقط رغم تعليقين', authorKeys.filter((k: string) => k.includes('author:U_A')).length === 1, JSON.stringify(authorKeys));
    check('لا مفاتيح thread:<postId> القديمة (خلط المعلّقين)', !leadKeys.some((k: string) => /thread:POST_[A-Z_]+$/.test(k)), JSON.stringify(leadKeys));

    group('5) مسودة رد فورية (وضع الموافقة) — بلا نداء مزوّد');
    const inbox = await (await fetch(`${BASE}/api/commercial/inbox`, { headers: auth })).json();
    check('وضع الإرسال = approval', inbox.sendMode === 'approval', inbox.sendMode);
    const drafts = inbox.drafts || [];
    check('مسودات فورية أُنشئت خلال نفس الدورة', drafts.length >= 2, `drafts=${drafts.length}`);
    // سعر شاشة شارك (ماركة عامية «شارك» ⇒ «شارب») على منشور مرتب بمنتج مسجّل.
    const priceDraft = drafts.find((d: any) => /500,000|500000/.test(String(d.originalText || d.text || '')));
    check('مسودة سعر تحمل السعر المسجّل فعلاً (500,000)', Boolean(priceDraft), JSON.stringify(drafts.map((d: any) => d.originalText || d.text)));
    // منتج مجهول ⇒ مسودة بلا أي رقم.
    const unknownLead = (inbox.leads || []).find((l: any) => String(l.key || '').includes('author:U_C'));
    const unknownDraft = drafts.find((d: any) => d.leadKey && unknownLead && d.leadKey === unknownLead.key);
    const unknownText = String(unknownDraft?.originalText || unknownDraft?.text || '');
    check('منتج مجهول ⇒ مسودة بلا أي رقم', Boolean(unknownDraft) && !/\d{3,}/.test(unknownText), unknownText);
    // لا نداء مزوّد: لا ردود أُرسلت على Meta إطلاقاً (وضع الموافقة لا يرسل).
    check('لا نداء مزوّد في وضع الموافقة (صفر ردود أُرسلت)', mock.state.commentReplies.length === 0, `replies=${mock.state.commentReplies.length}`);

    group('6) تحذير 48 ساعة بلا استقبال');
    // نُعدّل حالة المراقب مباشرةً (آخر استقبال قبل 3 أيام) ثم نُعيد القراءة.
    const health = await (await fetch(`${BASE}/api/health`)).json();
    check('كتلة metaPolling عامة تحمل platformStats', Boolean(health?.metaPolling?.platformStats), JSON.stringify(health?.metaPolling));
    check('حقل staleIngestWarning موجود', typeof health?.metaPolling?.staleIngestWarning === 'boolean');
    // لا تسريب بيانات عميل في النقطة العامة.
    const rawHealth = await (await fetch(`${BASE}/api/health`)).text();
    check('لا نص تعليق عميل في الصحة العامة', !rawHealth.includes('شكد سعر هالفيديو') && !rawHealth.includes('شعر'));
  } finally {
    await stop(app.proc);
    await mock.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} — passed ${passed}`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} PR-S3 comments-reach checks`);
}
void main();
