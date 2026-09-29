/**
 * اختبار تكاملي: مركز مراجعة تقرير YouTube اليومي (خادم حقيقي + خادم Google وهمي محلي).
 *
 * يثبت الدورة الكاملة: قراءة تعليقات حقيقية → التقرير اليومي → فتح تفاصيل رقم
 * (نفس السجلات التي كوّنته) → فلاتر → قرار المالك → إرسال فعلي عبر المنفّذ المركزي
 * (comments.insert) → معرّف رد حقيقي وحالة sent. بلا مزود حقيقي وبلا أي سرّ.
 *
 * لا يلمس أي منصة أخرى ولا Gemini ولا OAuth/scopes/أسرار.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createYouTubeMock, startYouTubeMockServer, type YouTubeMockState } from './helpers/youtubeMock';

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
const APP_PORT = 7740 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const YT_PORT = 7800 + Math.floor(Math.random() * 40);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'youtube-review-test-secret-not-real';
const GO_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
const GO_CLIENT_SECRET = 'test-google-client-secret-not-real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-review-'));

let proc: ChildProcess | null = null;
let log = '';
let ytServer: { stop: () => Promise<void> } | null = null;

function startApp(ytBase: string): void {
  log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    YOUTUBE_API_BASE: ytBase, YOUTUBE_UPLOAD_BASE: ytBase, YOUTUBE_TOKEN_BASE: `${ytBase}/token`,
    GOOGLE_OAUTH_CLIENT_ID: GO_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: GO_CLIENT_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    YOUTUBE_OP_RATE_LIMIT: '200',
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
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}
async function connectYouTube(auth: Record<string, string>): Promise<void> {
  const start = await (await fetch(`${BASE}/api/platforms/youtube/oauth/start`, { headers: auth })).json();
  const authUrl = new URL(start.authorizationUrl || 'https://invalid.local');
  const state = authUrl.searchParams.get('state') as string;
  await fetch(`${BASE}/api/platforms/youtube/oauth/callback?state=${encodeURIComponent(state)}&code=test-auth-code`);
}
async function grantReplyDelegation(auth: Record<string, string>): Promise<void> {
  await fetch(`${BASE}/api/platforms/youtube/delegation`, { method: 'POST', headers: auth, body: JSON.stringify({ actions: ['reply'] }) });
}
async function setControls(auth: Record<string, string>, body: Record<string, unknown>): Promise<void> {
  await fetch(`${BASE}/api/agent/youtube/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
}

async function main(): Promise<void> {
  const mockState = createYouTubeMock(); const mock = { get state() { return mockState; } };
  // تعليقات حقيقية متنوعة تغطي كل بطاقات التقرير.
  mock.state.comments = [
    { id: 'cmt_praise', threadId: 'thr_p', videoId: 'vid_alpha', author: 'حسين', text: 'عاشت إيدكم، خدمة ممتازة', publishedAt: '2026-09-28T09:00:00Z', likeCount: 0 },
    { id: 'cmt_question', threadId: 'thr_q', videoId: 'vid_alpha', author: 'علي', text: 'كم سعر التقسيط؟', publishedAt: '2026-09-28T09:05:00Z', likeCount: 1 },
    { id: 'cmt_spam', threadId: 'thr_s', videoId: 'vid_beta', author: 'spam', text: 'ربح سريع https://spam.example', publishedAt: '2026-09-28T09:10:00Z', likeCount: 0 },
  ];
  const yt = await startYouTubeMockServer(mock.state as YouTubeMockState, YT_PORT);
  startApp(yt.base);
  if (!(await waitForHealth())) { console.log(log.slice(-2000)); throw new Error('الخادم لم يقلع'); }

  const auth = await login();
  await connectYouTube(auth);
  await grantReplyDelegation(auth);
  // الرد الآلي معطّل: تُعالَج التعليقات وتُصنَّف بلا إرسال (نُظهر بطاقات التقرير).
  await setControls(auth, { enabled: true, autoReply: false, paused: false, humanReviewMode: false });
  // دورة مراقبة حقيقية: تقرأ التعليقات الحقيقية وتصنّفها (بلا إرسال لأن الرد معطّل).
  const firstPoll = await (await fetch(`${BASE}/api/agent/youtube/watcher/poll`, { method: 'POST', headers: auth })).json();
  check('الدورة الأولى قُرأت التعليقات الحقيقية', (firstPoll.watcher?.processedCount || 0) >= 3, JSON.stringify(firstPoll.watcher?.processedCount));

  group('1) التقرير اليومي: بطاقات قابلة للنقر مع مفاتيحها');
  const brief = await (await fetch(`${BASE}/api/agent/youtube/watcher/brief`, { headers: auth })).json();
  check('التقرير يعمل', brief.success === true);
  const metrics = brief.brief?.metrics || [];
  check('بطاقة لكل رقم + مسمّى عربي', metrics.length >= 8 && metrics.every((m: any) => m.key && m.labelAr));
  check('تعليقات جديدة = 3 (كل التعليقات الحقيقية)', metrics.find((m: any) => m.key === 'newComments')?.count === 3, JSON.stringify(metrics));

  group('2) تفاصيل كل بطاقة = نفس السجلات التي كوّنتها');
  for (const m of metrics) {
    const d = await (await fetch(`${BASE}/api/agent/youtube/watcher/details?metric=${m.key}`, { headers: auth })).json();
    check(`تفاصيل ${m.key}: العدد يطابق البطاقة`, d.success === true && d.total === m.count, `total=${d.total} card=${m.count}`);
  }

  group('3) فتح التفاصيل لا يغيّر أي حالة');
  const before = await (await fetch(`${BASE}/api/agent/youtube/watcher`, { headers: auth })).json();
  const beforeCounters = JSON.stringify(before.watcher?.counters || {});
  await fetch(`${BASE}/api/agent/youtube/watcher/details?metric=newComments`, { headers: auth });
  await fetch(`${BASE}/api/agent/youtube/watcher/details?metric=escalated`, { headers: auth });
  const after = await (await fetch(`${BASE}/api/agent/youtube/watcher`, { headers: auth })).json();
  check('العدّادات لم تتغيّر بعد فتح التفاصيل', JSON.stringify(after.watcher?.counters || {}) === beforeCounters);

  group('4) السجل التفصيلي يحمل بيانات حقيقية');
  const det = await (await fetch(`${BASE}/api/agent/youtube/watcher/details?metric=newComments`, { headers: auth })).json();
  const rec = (det.records || []).find((r: any) => r.commentId === 'cmt_praise');
  check('نص التعليق الحقيقي', rec?.text === 'عاشت إيدكم، خدمة ممتازة');
  check('اسم صاحب التعليق الحقيقي', rec?.authorName === 'حسين');
  check('الحالة ومسمّاها العربي', Boolean(rec?.stage) && Boolean(rec?.stageLabelAr));
  check('التصنيف الحتمي ظاهر', rec?.classification?.sentiment === 'positive');
  check('سبب القرار ظاهر', typeof rec?.reason === 'string' && rec.reason.length > 0);
  check('الرد المقترح موجود', typeof rec?.suggestedReply === 'string');
  check('معرّف الفيديو الحقيقي', rec?.videoId === 'vid_alpha');

  group('5) الفلاتر لا تُنشئ بيانات');
  const onlyPos = await (await fetch(`${BASE}/api/agent/youtube/watcher/details?metric=newComments&sentiment=positive`, { headers: auth })).json();
  check('فلتر المشاعر: كل النتائج موجبة', onlyPos.records.every((r: any) => r.classification.sentiment === 'positive'));
  const onlyDelivered = await (await fetch(`${BASE}/api/agent/youtube/watcher/details?metric=newComments&delivered=true`, { headers: auth })).json();
  check('فلتر التسليم: كل النتائج مُسلَّمة', onlyDelivered.records.every((r: any) => r.delivered === true));
  const noneQ = await (await fetch(`${BASE}/api/agent/youtube/watcher/details?metric=newComments&q=لايوجد`, { headers: auth })).json();
  check('بحث بلا نتيجة = حالة فارغة صحيحة', noneQ.records.length === 0 && noneQ.total === 3);

  group('6) بطاقة صفر تُرجع قائمة فارغة صحيحة');
  const zero = await (await fetch(`${BASE}/api/agent/youtube/watcher/details?metric=verifiedReplies`, { headers: auth })).json();
  check('ردود متحققة = 0 وقائمتها فارغة', zero.total === 0 && zero.records.length === 0, JSON.stringify(zero.total));

  group('7) بطاقة غير معروفة تُرفض بوضوح');
  const bad = await fetch(`${BASE}/api/agent/youtube/watcher/details?metric=does_not_exist`, { headers: auth });
  check('بطاقة غير معروفة => 400', bad.status === 400);
  const badAnon = await fetch(`${BASE}/api/agent/youtube/watcher/details?metric=newComments`);
  check('التفاصيل محمية بالتصريح (401)', badAnon.status === 401);

  group('8) قرار المالك: إرسال رد حقيقي عبر المنفّذ المركزي');
  mock.state.lastInsertPath = null; mock.state.lastCommentBody = null;
  const send = await (await fetch(`${BASE}/api/agent/youtube/watcher/review`, {
    method: 'POST', headers: auth, body: JSON.stringify({ commentId: 'cmt_praise', action: 'allow_reply' }),
  })).json();
  check('الرد أُرسل بنجاح', send.success === true && send.sent === true, JSON.stringify(send));
  check('comments.insert استُدعي فعلاً على Data API', (mock.state.lastInsertPath || '').includes('/youtube/v3/comments'));
  check('الرد على نفس التعليق الحقيقي (parentId)', String(mock.state.lastCommentBody?.snippet?.parentId || '') === 'cmt_praise', JSON.stringify(mock.state.lastCommentBody));
  check('معرّف رد حقيقي من المزوّد', Boolean(send.externalReplyId), JSON.stringify(send.externalReplyId));
  check('الحالة sent', send.state === 'sent', String(send.state));
  check('السجل يحمل sentAt', Boolean(send.record?.at));
  check('نص الرد عراقي طبيعي', /هلا بيك|تسلم|شكرا|شكراً|نورتنا|حياك|عاشت|تدلل/.test(String(mock.state.lastCommentBody?.snippet?.textOriginal || '')), String(mock.state.lastCommentBody?.snippet?.textOriginal));

  group('9) منع تكرار الرد عبر المنفّذ المركزي (حماية replay/retry)');
  mock.state.lastInsertPath = null;
  const dup = await fetch(`${BASE}/api/agent/youtube/watcher/review`, { method: 'POST', headers: auth, body: JSON.stringify({ commentId: 'cmt_praise', action: 'allow_reply' }) });
  check('الرد المكرر مرفوض (409)', dup.status === 409, String(dup.status));
  check('لم يُستدعَ comments.insert ثانيةً', mock.state.lastInsertPath === null);

  group('10) قرار المالك: تجاهل / تصعيد (بلا إرسال خارجي)');
  mock.state.lastInsertPath = null;
  const ignore = await (await fetch(`${BASE}/api/agent/youtube/watcher/review`, { method: 'POST', headers: auth, body: JSON.stringify({ commentId: 'cmt_spam', action: 'ignore' }) })).json();
  check('قرار التجاهل نجح وبلا إرسال', ignore.success === true && ignore.sent === false && mock.state.lastInsertPath === null);
  check('الحالة صارت SKIPPED', ignore.record?.stage === 'SKIPPED');
  const esc = await (await fetch(`${BASE}/api/agent/youtube/watcher/review`, { method: 'POST', headers: auth, body: JSON.stringify({ commentId: 'cmt_question', action: 'escalate' }) })).json();
  check('قرار التصعيد نجح', esc.success === true && esc.record?.stage === 'ESCALATED');
  check('لا إرسال عند التصعيد', mock.state.lastInsertPath === null);

  group('11) إجراء غير معروف يُرفض بلا تغيير حالة');
  const badAction = await fetch(`${BASE}/api/agent/youtube/watcher/review`, { method: 'POST', headers: auth, body: JSON.stringify({ commentId: 'cmt_question', action: 'hack' }) });
  check('إجراء غير معروف => 400', badAction.status === 400);
  const missing = await fetch(`${BASE}/api/agent/youtube/watcher/review`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'ignore' }) });
  check('بلا معرّف تعليق => 400', missing.status === 400);
  const notFound = await fetch(`${BASE}/api/agent/youtube/watcher/review`, { method: 'POST', headers: auth, body: JSON.stringify({ commentId: 'nope', action: 'ignore' }) });
  check('تعليق غير موجود => 404', notFound.status === 404);

  group('12) قرار المالك يُحترم في دورة المراقبة التالية');
  // التعليق cmt_spam سُجّل مُتجاهلاً بقرار المالك: الدورة لا تُعيد إدخاله.
  const poll = await (await fetch(`${BASE}/api/agent/youtube/watcher/poll`, { method: 'POST', headers: auth })).json();
  check('الدورة اكتملت', poll.success === true);
  const spamEntry = (poll.watcher?.attentionRequired || []).find((a: any) => a.commentId === 'cmt_spam');
  check('المُتجاهَل بقرار المالك ليس في التصعيد', !spamEntry);

  group('13) التقرير يطابق التفاصيل بعد القرارات (لا discrepancy)');
  const brief2 = await (await fetch(`${BASE}/api/agent/youtube/watcher/brief`, { headers: auth })).json();
  const m2 = brief2.brief?.metrics || [];
  const repliesCard = m2.find((m: any) => m.key === 'replies');
  const repliesDet = await (await fetch(`${BASE}/api/agent/youtube/watcher/details?metric=replies`, { headers: auth })).json();
  check('بطاقة الردود تطابق تفاصيلها بعد الإرسال', repliesCard.count === repliesDet.total, `${repliesCard.count} vs ${repliesDet.total}`);

  group('14) لا تسريب أي سرّ في أي استجابة');
  const detAll = await (await fetch(`${BASE}/api/agent/youtube/watcher/details?metric=newComments`, { headers: auth })).json();
  const blob = JSON.stringify(detAll) + JSON.stringify(brief2) + JSON.stringify(send);
  check('لا access token', !blob.includes(mock.state.accessToken));
  check('لا refresh token', !blob.includes(mock.state.refreshToken));
  check('لا client secret', !blob.includes(GO_CLIENT_SECRET));

  group('15) الواجهة تصل إلى المسارات الصحيحة (بلا مسار جانبي)');
  const apiSrc = readFileSync(join(REPO_ROOT, 'src/services/api.ts'), 'utf8');
  const viewSrc = readFileSync(join(REPO_ROOT, 'src/components/agent/YouTubeBriefReview.tsx'), 'utf8');
  const opsSrc = readFileSync(join(REPO_ROOT, 'src/components/agent/YouTubeOperationsView.tsx'), 'utf8');
  check('الواجهة تستدعي details الصحيح', apiSrc.includes('/api/agent/youtube/watcher/details'));
  check('الواجهة تستدعي review الصحيح', apiSrc.includes('/api/agent/youtube/watcher/review'));
  check('مركز المراجعة يعرض الرد المقترح', viewSrc.includes('suggestedReply'));
  check('البطاقات قابلة للنقر', opsSrc.includes('setActiveMetric') && opsSrc.includes('brief.metrics'));
}

main()
  .catch((e) => { failures.push(`استثناء: ${e?.message || e}`); console.log(log.slice(-3000)); })
  .finally(async () => {
    if (proc) { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1200)); if (!proc.killed) proc.kill('SIGKILL'); }
    try { await ytServer?.stop(); } catch { /* تجاهل */ }
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
    console.log('\n============================================================');
    if (failures.length) { console.log(`FAILED: ${failures.length}`); for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
    else { console.log(`PASSED: ${passed} watcher review integration checks`); process.exit(0); }
  });
