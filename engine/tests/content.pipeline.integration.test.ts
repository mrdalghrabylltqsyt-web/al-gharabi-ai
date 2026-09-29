/**
 * اختبار تكاملي: طابور محتوى YouTube (نشر/جدولة/مراجعة بشرية) عبر خادم حقيقي
 * وخادم Google وهمي محلي (لا مزود حقيقي ولا حصة). يثبت الآلية الفعلية:
 * إنشاء مسودة → تصنيف حتمي → قرار المالك → رفع حقيقي (videos.insert resumable)
 * → معرّف فيديو حقيقي → جدولة (publishAt) → منع تكرار → Kill Switch → تصريح →
 * ثبات بعد إعادة التشغيل. بلا أي سرّ ولا منصة أخرى ولا Gemini.
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
const APP_PORT = 7840 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const YT_PORT = 7900 + Math.floor(Math.random() * 40);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'youtube-content-test-secret-not-real';
const GO_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
const GO_CLIENT_SECRET = 'test-google-client-secret-not-real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-content-'));

let proc: ChildProcess | null = null;
let log = '';
let ytServer: { stop: () => Promise<void> } | null = null;
const VIDEO_B64 = Buffer.from('FAKE-MP4-BYTES-'.repeat(64)).toString('base64');

function startApp(ytBase: string): void {
  log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    YOUTUBE_API_BASE: ytBase, YOUTUBE_UPLOAD_BASE: ytBase, YOUTUBE_TOKEN_BASE: `${ytBase}/token`,
    GOOGLE_OAUTH_CLIENT_ID: GO_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: GO_CLIENT_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    YOUTUBE_OP_RATE_LIMIT: '500',
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
async function setControls(auth: Record<string, string>, body: Record<string, unknown>): Promise<void> {
  await fetch(`${BASE}/api/agent/youtube/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
}
async function createDraft(auth: Record<string, string>, body: Record<string, unknown>): Promise<any> {
  return (await fetch(`${BASE}/api/platforms/youtube/content/drafts`, { method: 'POST', headers: auth, body: JSON.stringify(body) })).json();
}
async function review(auth: Record<string, string>, id: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE}/api/platforms/youtube/content/queue/${id}/review`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
}

async function main(): Promise<void> {
  const mockState = createYouTubeMock();
  const yt = await startYouTubeMockServer(mockState as YouTubeMockState, YT_PORT);
  ytServer = yt;
  startApp(yt.base);
  if (!(await waitForHealth())) { console.log(log.slice(-2000)); throw new Error('الخادم لم يقلع'); }

  const auth = await login();
  await connectYouTube(auth);

  group('1) المحتوى التجاري بمعلومة غير مؤكدة => مراجعة بشرية (لا نشر آلي)');
  await setControls(auth, { enabled: true, autoPublish: true, autoSchedule: true, paused: false });
  const commercial = await createDraft(auth, { title: 'عرض خاص', description: 'سعر التقسيط 500,000 د.ع دفعة أولى', videoBase64: VIDEO_B64 });
  check('المحتوى التجاري => REVIEW_REQUIRED', commercial.item?.state === 'REVIEW_REQUIRED', JSON.stringify(commercial.item?.state));
  check('السبب صريح (ادعاء تجاري)', /تجاري|غير مؤكّد/.test(commercial.item?.stateReason || ''));
  check('لم يُرفع شيء آلياً (لا مزود)', mockState.lastUploadPath === null);

  group('2) محتوى بلا مادة => لا يُعتمد ولا يُرفع (MEDIA_REQUIRED)');
  const noMedia = await createDraft(auth, { title: 'مقطع بلا مادة' });
  check('بلا مادة => العنصر ليس APPROVED', noMedia.item?.state !== 'APPROVED', String(noMedia.item?.state));
  check('بلا مادة => لا رفع', mockState.lastUploadPath === null);

  group('3) محتوى آمن وواضح + نشر آلي ممنوح => نشر حقيقي عبر YouTube');
  mockState.uploadedVideoId = 'vid_content_0001';
  const safe = await createDraft(auth, { title: 'جولة في معرض الغرابي', description: 'نظرة عامة على المعرض', videoBase64: VIDEO_B64 });
  check('المحتوى الآمن نُشر آلياً', safe.autoExecuted?.status === 200, JSON.stringify(safe.autoExecuted));
  check('videos.insert resumable استُدعي فعلاً', (mockState.lastUploadPath || '').includes('/upload/youtube/v3/videos'));
  check('معرّف فيديو حقيقي من المزود', safe.autoExecuted?.externalVideoId === 'vid_content_0001');
  const afterPublish = (await (await fetch(`${BASE}/api/platforms/youtube/content/queue/${safe.item.id}`, { headers: auth })).json()).item;
  check('حالة العنصر PUBLISHED', afterPublish?.state === 'PUBLISHED', afterPublish?.state);
  check('الرابط مبني على معرّف حقيقي', String(afterPublish?.url || '').includes('vid_content_0001'));

  group('4) منع تكرار المحتوى (idempotency على مستوى الطابور والرفع)');
  const dupDraft = await createDraft(auth, { title: 'جولة في معرض الغرابي', description: 'نظرة عامة على المعرض', videoBase64: VIDEO_B64 });
  check('محتوى مطابق => DUPLICATE_CONTENT', dupDraft.code === 'DUPLICATE_CONTENT');

  group('5) جدولة حقيقية (publishAt) => حالة SCHEDULED بلا ادعاء نشر');
  mockState.uploadedVideoId = 'vid_content_sched';
  mockState.lastUploadBody = null;
  const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16);
  const sched = await createDraft(auth, { title: 'مقطع مجدول', description: 'وصف', videoBase64: VIDEO_B64, publishAt: future });
  check('الجدولة نُفّذت آلياً (200)', sched.autoExecuted?.status === 200, JSON.stringify(sched.autoExecuted));
  check('privacyStatus=private مع publishAt', mockState.lastUploadBody?.status?.privacyStatus === 'private', JSON.stringify(mockState.lastUploadBody?.status));
  check('publishAt حقيقي مُرسل', Boolean(mockState.lastUploadBody?.status?.publishAt));
  const schedItem = (await (await fetch(`${BASE}/api/platforms/youtube/content/queue/${sched.item.id}`, { headers: auth })).json()).item;
  check('حالة العنصر SCHEDULED', schedItem?.state === 'SCHEDULED', schedItem?.state);

  group('6) جدولة في الماضي تُرفض');
  const past = new Date(Date.now() - 3600000).toISOString().slice(0, 16);
  const pastRes = await fetch(`${BASE}/api/platforms/youtube/content/drafts`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'ماضٍ', videoBase64: VIDEO_B64, publishAt: past }) });
  check('جدولة ماضية => 422', pastRes.status === 422, String(pastRes.status));

  group('7) قرار المالك: رفض => نهائي بلا نشر');
  const rejectable = await createDraft(auth, { title: 'محتوى للرفض', description: 'سعر 100 دينار', videoBase64: VIDEO_B64 });
  const rejRes = await review(auth, rejectable.item.id, { action: 'reject', note: 'غير مناسب' });
  const rejBody = await rejRes.json();
  check('الرفض نجح', rejRes.status === 200 && rejBody.item?.state === 'REJECTED');
  mockState.lastUploadPath = null;
  const rejAgain = await review(auth, rejectable.item.id, { action: 'publish_now' });
  check('المرفوض لا يُنشر (TERMINAL_STATE)', rejAgain.status === 409, String(rejAgain.status));
  check('لا رفع بعد الرفض', mockState.lastUploadPath === null);

  group('8) قرار المالك: نشر الآن على عنصر عند المراجعة');
  mockState.uploadedVideoId = 'vid_content_now';
  const reviewItem = await createDraft(auth, { title: 'محتوى بانتظار', description: 'عرض خاص بسعر 250,000 د.ع', videoBase64: VIDEO_B64 });
  check('عند المراجعة', reviewItem.item?.state === 'REVIEW_REQUIRED');
  // المحتوى يحمل سعراً غير مسجّل: حتى قرار المالك لا يجيز نشر سعر مُختلق (قاعدة 23).
  const nowRes = await review(auth, reviewItem.item.id, { action: 'publish_now' });
  const nowBody = await nowRes.json();
  check('نشر سعر غير مسجّل مرفوض (حارس سلامة المحتوى)', nowRes.status === 422 && String(nowBody.exec?.code) === 'CONTENT_SAFETY_BLOCKED', JSON.stringify(nowBody.exec));
  // عنصر نظيف: نعطّل النشر الآلي لحظة إنشائه ليبقى عند المراجعة، ثم ننشره بقرار المالك.
  await setControls(auth, { autoPublish: false, autoSchedule: false });
  const forcedReview = await createDraft(auth, { title: 'محتوى نظيف للآفاق ٢', description: 'نظرة عامة على المعرض', videoBase64: VIDEO_B64 });
  check('مع تعطيل النشر الآلي => عند المراجعة', forcedReview.item?.state === 'REVIEW_REQUIRED', String(forcedReview.item?.state));
  await setControls(auth, { autoPublish: true, autoSchedule: true });
  mockState.lastUploadPath = null;
  const nowRes2 = await review(auth, forcedReview.item.id, { action: 'publish_now' });
  const nowBody2 = await nowRes2.json();
  check('نشر الآن بقرار المالك نجح بمعرّف حقيقي', nowRes2.status === 200 && nowBody2.item?.state === 'PUBLISHED' && nowBody2.item?.externalVideoId === 'vid_content_now', JSON.stringify(nowBody2.exec));
  check('videos.insert استُدعي فعلاً عند نشر المالك', (mockState.lastUploadPath || '').includes('/upload/youtube/v3/videos'));

  group('9) Kill Switch يمنع النشر والجدولة');
  await setControls(auth, { paused: true });
  mockState.lastUploadPath = null;
  const ks = await createDraft(auth, { title: 'محتوى أثناء الإيقاف', description: 'نظرة', videoBase64: VIDEO_B64 });
  check('Kill Switch => العنصر ليس APPROVED/منشوراً', ks.item?.state === 'REVIEW_REQUIRED' || ks.item?.state === 'DRAFT', String(ks.item?.state));
  check('لا رفع أثناء Kill Switch', mockState.lastUploadPath === null);
  const ksReview = await review(auth, ks.item.id, { action: 'publish_now' });
  check('نشر بعد Kill Switch => 409', ksReview.status === 409, String(ksReview.status));
  await setControls(auth, { paused: false });

  group('10) التصريح: كل المسارات الحساسة محميّة');
  for (const [method, path] of [
    ['POST', '/api/platforms/youtube/content/drafts'],
    ['POST', `/api/platforms/youtube/content/queue/${ks.item.id}/review`],
    ['GET', '/api/platforms/youtube/content/queue'],
    ['GET', '/api/platforms/youtube/content/details?metric=contentPublished'],
  ] as const) {
    const r = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    check(`بلا جلسة: ${method} ${path} => 401`, r.status === 401, String(r.status));
  }

  group('11) الدقة الصادقة: التقرير يحمل بطاقات المحتوى القابلة للنقر');
  const brief = await (await fetch(`${BASE}/api/agent/youtube/watcher/brief`, { headers: auth })).json();
  const contentMetrics = brief.brief?.contentMetrics || [];
  check('بطاقات المحتوى الست موجودة', contentMetrics.length === 6, JSON.stringify(contentMetrics.map((m: any) => m.key)));
  const publishedCard = contentMetrics.find((m: any) => m.key === 'contentPublished');
  const publishedDet = await (await fetch(`${BASE}/api/platforms/youtube/content/details?metric=contentPublished`, { headers: auth })).json();
  check('بطاقة منشور تطابق تفاصيلها', publishedCard.count === publishedDet.total, `${publishedCard?.count} vs ${publishedDet.total}`);

  group('12) لا تسريب أي سرّ ولا Gemini مستخدم');
  const blob = JSON.stringify(brief) + JSON.stringify(publishedDet) + JSON.stringify(nowBody);
  check('لا access token', !blob.includes(mockState.accessToken));
  check('لا refresh token', !blob.includes(mockState.refreshToken));
  check('لا client secret', !blob.includes(GO_CLIENT_SECRET));
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check('Gemini لم يُستهلك في عملية حتمية', (health.geminiUsage?.firewall?.providerCallsToday ?? 0) === 0);
  check('ملخص المحتوى في الصحة', health.youtubeContent?.summary?.total >= 1);

  group('13) الثبات: إعادة التشغيل تُبقي الموافقات/الجدولة/الرفض');
  proc?.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  startApp(yt.base);
  if (!(await waitForHealth())) throw new Error('الخادم لم يعد يقلع');
  const auth2 = await login();
  const queue2 = await (await fetch(`${BASE}/api/platforms/youtube/content/queue`, { headers: auth2 })).json();
  const ids = (queue2.items || []).map((i: any) => i.id);
  check('المرفوض محفوظ بعد restart', (queue2.items || []).some((i: any) => i.state === 'REJECTED'));
  check('المجدول محفوظ بعد restart', (queue2.items || []).some((i: any) => i.state === 'SCHEDULED'));
  check('المنشور محفوظ بعد restart', (queue2.items || []).some((i: any) => i.state === 'PUBLISHED' && i.externalVideoId));
  const health2 = await (await fetch(`${BASE}/api/health`)).json();
  check('مخزن المادة صمد بعد restart', health2.youtubeContent?.mediaStored > 0);

  group('14) الواجهة: طابور المحتوى موصول بالمسارات الصحيحة');
  const apiSrc = readFileSync(join(REPO_ROOT, 'src/services/api.ts'), 'utf8');
  const panelSrc = readFileSync(join(REPO_ROOT, 'src/components/agent/YouTubeContentQueuePanel.tsx'), 'utf8');
  const opsSrc = readFileSync(join(REPO_ROOT, 'src/components/agent/YouTubeOperationsView.tsx'), 'utf8');
  check('API فيه مسارات المحتوى', apiSrc.includes('/api/platforms/youtube/content/queue') && apiSrc.includes('/review') && apiSrc.includes('/drafts'));
  check('لوحة الطابور تستدعيها', panelSrc.includes('getYouTubeContentQueue') && panelSrc.includes('reviewYouTubeContentItem'));
  check('اللوحة مدمجة في مدير التشغيل', opsSrc.includes('YouTubeContentQueuePanel'));
}

main()
  .catch((e) => { failures.push(`استثناء: ${e?.message || e}`); console.log(log.slice(-3000)); })
  .finally(async () => {
    if (proc) { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1200)); if (!proc.killed) proc.kill('SIGKILL'); }
    try { await ytServer?.stop(); } catch { /* تجاهل */ }
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
    console.log('\n============================================================');
    if (failures.length) { console.log(`FAILED: ${failures.length}`); for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
    else { console.log(`PASSED: ${passed} content pipeline integration checks`); process.exit(0); }
  });
