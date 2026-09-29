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
const VIDEO_B64 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(256, 7)]).toString('base64');

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
  check('بلا مادة => hasMedia=false صريح', noMedia.item?.hasMedia === false && noMedia.item?.mediaState === 'MEDIA_REQUIRED');
  check('بلا مادة => العمليات المتاحة بلا موافقة/نشر/جدولة', Array.isArray(noMedia.item?.allowedActions) && !noMedia.item.allowedActions.includes('approve') && !noMedia.item.allowedActions.includes('publish_now') && !noMedia.item.allowedActions.includes('schedule'));
  check('بلا مادة => الرفض/التعديل/الإلغاء متاحة', ['reject', 'edit', 'cancel'].every((a) => noMedia.item?.allowedActions?.includes(a)));
  const noMediaApprove = await review(auth, noMedia.item.id, { action: 'approve' });
  check('موافقة بلا مادة => 409 MEDIA_REQUIRED', noMediaApprove.status === 409 && (await noMediaApprove.json()).code === 'MEDIA_REQUIRED', String(noMediaApprove.status));
  const noMediaPublish = await review(auth, noMedia.item.id, { action: 'publish_now' });
  check('نشر بلا مادة => 409', noMediaPublish.status === 409, String(noMediaPublish.status));
  const noMediaSchedule = await review(auth, noMedia.item.id, { action: 'schedule' });
  check('جدولة بلا مادة => 409', noMediaSchedule.status === 409, String(noMediaSchedule.status));
  check('لا رفع بعد محاولات النشر بلا مادة', mockState.lastUploadPath === null);

  group('2ب) ضوابط المادة: رفض الفيديو الوهمي/غير الصالح/الكبير');
  const emptyB64 = await createDraft(auth, { title: 'فارغ', videoBase64: '' });
  check('base64 فارغ => لا مادة (DRAFT)', emptyB64.item?.hasMedia === false, String(emptyB64.item?.state));
  const invalidB64 = await fetch(`${BASE}/api/platforms/youtube/content/drafts`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'مزيف', videoBase64: '!!!not-base64!!!' }) });
  check('base64 غير صالح => 422 MEDIA_INVALID', invalidB64.status === 422 && (await invalidB64.json()).code === 'MEDIA_INVALID', String(invalidB64.status));
  const textAsVideo = await fetch(`${BASE}/api/platforms/youtube/content/drafts`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'نص كفيديو', videoBase64: Buffer.from('hello this is plain text not a video').toString('base64') }) });
  check('نص عادي كفيديو => 422 MEDIA_INVALID', textAsVideo.status === 422 && (await textAsVideo.json()).code === 'MEDIA_INVALID', String(textAsVideo.status));
  const wrongMime = await fetch(`${BASE}/api/platforms/youtube/content/drafts`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'نوع خاطئ', mimeType: 'application/json', videoBase64: VIDEO_B64 }) });
  check('نوع غير مطابق => 422 MEDIA_INVALID', wrongMime.status === 422 && (await wrongMime.json()).code === 'MEDIA_INVALID', String(wrongMime.status));
  const wrongExt = await fetch(`${BASE}/api/platforms/youtube/content/drafts`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'امتداد خاطئ', filename: 'clip.webm', mimeType: 'video/mp4', videoBase64: VIDEO_B64 }) });
  check('امتداد لا يطابق النوع => 422 MEDIA_INVALID', wrongExt.status === 422, String(wrongExt.status));
  const bigBytes = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(13 * 1024 * 1024, 7)]);
  const oversized = await fetch(`${BASE}/api/platforms/youtube/content/drafts`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'كبير', videoBase64: bigBytes.toString('base64') }) });
  check('فيديو أكبر من الحد => 422 MEDIA_TOO_LARGE', oversized.status === 422 && (await oversized.json()).code === 'MEDIA_TOO_LARGE', String(oversized.status));

  group('2ج) إرفاق مادة عبر التعديل => يصبح قابلاً للاعتماد');
  const incomplete = await createDraft(auth, { title: 'محتوى ناقص للاستكمال' });
  check('عنصر ناقص عند DRAFT', incomplete.item?.hasMedia === false);
  const attachRes = await review(auth, incomplete.item.id, { action: 'edit', videoBase64: VIDEO_B64, mimeType: 'video/mp4', filename: 'clip.mp4' });
  const attachBody = await attachRes.json();
  check('التعديل بإرفاق مادة نجح', attachRes.status === 200 && attachBody.item?.hasMedia === true, JSON.stringify(attachBody.item?.hasMedia));
  check('بعد الإرفاق تُتاح الموافقة/النشر', attachBody.item?.allowedActions?.includes('approve') && attachBody.item?.allowedActions?.includes('publish_now'));

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

  group('15) قرار المالك المباشر مستقل عن autoPublish/autoSchedule/humanReviewMode + خصوصية صادقة + تحقق');
  // نُعطّل الأتمتة ونفعّل المراجعة البشرية: يجب أن يبقى القرار اليدوي ممكناً.
  await setControls(auth, { autoPublish: false, autoSchedule: false, humanReviewMode: true, enabled: true, paused: false });
  const manualReady = await createDraft(auth, { title: 'نظرة عامة على أقسام المعرض ٣', description: 'وصف تعريف الجولة', videoBase64: VIDEO_B64 });
  check('بلا أتمتة + مراجعة بشرية => عند المراجعة', manualReady.item?.state === 'REVIEW_REQUIRED', String(manualReady.item?.state));
  check('لا رفع آلي', manualReady.autoExecuted === null);
  check('يمكن نشر الآن يدوياً رغم تعطيل autoPublish', manualReady.item?.canPublishNow === true, JSON.stringify(manualReady.item?.publishBlockedReason));
  check('الخصوصية المتوقعة للنشر الآن = public', manualReady.item?.publishPrivacyStatus === 'public');
  check('الخصوصية المتوقعة للجدولة = private', manualReady.item?.schedulePrivacyStatus === 'private');
  mockState.uploadedVideoId = 'vid_manual_public';
  mockState.verifyPrivacyOverride = null;
  mockState.lastUploadBody = null;
  const manualPublish = await review(auth, manualReady.item.id, { action: 'publish_now' });
  const manualPublishBody = await manualPublish.json();
  check('نشر الآن يدوي نجح بمعرّف حقيقي', manualPublish.status === 200 && manualPublishBody.exec?.externalVideoId === 'vid_manual_public', JSON.stringify(manualPublishBody.exec));
  check('الرفع الحقيقي استُدعي', (mockState.lastUploadPath || '').includes('/upload/youtube/v3/videos'));
  check('privacyStatus=public فعلاً في الرفع (قرار مالك)', mockState.lastUploadBody?.status?.privacyStatus === 'public', JSON.stringify(mockState.lastUploadBody?.status));
  check('تحقق الخصوصية أُثبت من YouTube', manualPublishBody.exec?.verified === true && manualPublishBody.exec?.privacyVerification?.actual === 'public', JSON.stringify(manualPublishBody.exec?.privacyVerification));
  const pubItem = (await (await fetch(`${BASE}/api/platforms/youtube/content/queue/${manualReady.item.id}`, { headers: auth })).json()).item;
  check('العنصر PUBLISHED ومُتحقَّق', pubItem?.state === 'PUBLISHED' && pubItem?.verified === true && pubItem?.verifiedPrivacyStatus === 'public', JSON.stringify({ s: pubItem?.state, v: pubItem?.verified, p: pubItem?.verifiedPrivacyStatus }));

  group('15ب) عدم تطابق فعلي من المزود => لا ادعاء تحقق');
  const mismatch = await createDraft(auth, { title: 'نظرة عامة على أقسام المعرض ٤', description: 'وصف', videoBase64: VIDEO_B64 });
  mockState.uploadedVideoId = 'vid_manual_mismatch';
  mockState.verifyPrivacyOverride = 'private'; // YouTube يعيد حالة مختلفة عن المطلوب
  mockState.lastUploadBody = null;
  const mismatchRes = await review(auth, mismatch.item.id, { action: 'publish_now' });
  const mismatchBody = await mismatchRes.json();
  check('الرفع نجح (معرّف حقيقي)', mismatchRes.status === 200 && mismatchBody.exec?.externalVideoId === 'vid_manual_mismatch');
  check('لم يُعلن التحقق عند عدم التطابق', mismatchBody.exec?.verified === false, JSON.stringify(mismatchBody.exec?.privacyVerification));
  const mismatchItem = (await (await fetch(`${BASE}/api/platforms/youtube/content/queue/${mismatch.item.id}`, { headers: auth })).json()).item;
  check('العنصر غير مُتحقَّق رغم النشر', mismatchItem?.state === 'PUBLISHED' && mismatchItem?.verified === false);
  mockState.verifyPrivacyOverride = null;

  group('15ج) جدولة يدوية => private + publishAt حتى الموعد');
  const future2 = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 16);
  const manualSched = await createDraft(auth, { title: 'مقطع يدوي مجدول', description: 'وصف', videoBase64: VIDEO_B64, publishAt: future2 });
  mockState.uploadedVideoId = 'vid_manual_sched';
  mockState.lastUploadBody = null;
  check('يمكن جدولة يدوياً رغم تعطيل autoSchedule', manualSched.item?.canSchedule === true, JSON.stringify(manualSched.item?.scheduleBlockedReason));
  const manualSchedRes = await review(auth, manualSched.item.id, { action: 'schedule' });
  const manualSchedBody = await manualSchedRes.json();
  check('جدولة يدوية نجحت بمعرّف حقيقي', manualSchedRes.status === 200 && manualSchedBody.exec?.externalVideoId === 'vid_manual_sched', JSON.stringify(manualSchedBody.exec));
  check('جدولة => privacyStatus=private', mockState.lastUploadBody?.status?.privacyStatus === 'private', JSON.stringify(mockState.lastUploadBody?.status));
  check('جدولة => publishAt حقيقي', Boolean(mockState.lastUploadBody?.status?.publishAt));

  group('15د) تنظيف بيانات الاختبار (بلا حذف إنتاج أو فيديو حقيقي)');
  // 1) عنصر بوسم اختبار لكنه نُشر فعلياً (معرّف حقيقي) => يجب ألا يُحذف أبداً.
  await setControls(auth, { autoPublish: true, autoSchedule: true, humanReviewMode: false });
  mockState.uploadedVideoId = 'vid_test_sample_published';
  mockState.lastUploadBody = null;
  const publishedTest = await createDraft(auth, { title: 'sample clip demo', description: 'مقطع تعريفي', videoBase64: VIDEO_B64 });
  check('عنصر بوسم اختبار نُشر بمعرّف حقيقي', (publishedTest.item?.externalVideoId === 'vid_test_sample_published') || (publishedTest.autoExecuted?.externalVideoId === 'vid_test_sample_published'), JSON.stringify(publishedTest.autoExecuted));
  // 2) عنصر اختباري غير منشور => قابل للحذف.
  await setControls(auth, { autoPublish: false, autoSchedule: false, humanReviewMode: true });
  const testItem = await createDraft(auth, { title: 'اختبار تجريبي للتنظيف', description: 'بيانات اختبار', videoBase64: VIDEO_B64 });
  check('عنصر اختباري بلا نشر', testItem.item?.state === 'REVIEW_REQUIRED' && !testItem.item?.externalVideoId);
  const previewRes = await (await fetch(`${BASE}/api/platforms/youtube/content/cleanup-test-data`, { method: 'POST', headers: auth, body: JSON.stringify({ dryRun: true }) })).json();
  check('المعاينة تُظهر عنصراً اختبارياً قابلاً للحذف', previewRes.dryRun === true && previewRes.deletableCount >= 1, JSON.stringify({ t: previewRes.testCount, d: previewRes.deletableCount }));
  check('عنصر اختباري منشور فعلياً (فيديو حقيقي) لا يُحذف', previewRes.keptRealVideoCount >= 1, JSON.stringify({ kept: previewRes.keptRealVideoCount }));
  const cleanupRes = await (await fetch(`${BASE}/api/platforms/youtube/content/cleanup-test-data`, { method: 'POST', headers: auth, body: JSON.stringify({ dryRun: false }) })).json();
  check('التنظيف الفعلي حذف العنصر الاختباري', cleanupRes.success === true && cleanupRes.removed >= 1, JSON.stringify(cleanupRes));
  const afterCleanup = await (await fetch(`${BASE}/api/platforms/youtube/content/queue`, { headers: auth })).json();
  check('لم يُحذف أي منشور بمعرّف حقيقي', (afterCleanup.items || []).some((i: any) => i.externalVideoId === 'vid_test_sample_published'));
  check('العنصر الاختباري غير المنشور أُزيل', !(afterCleanup.items || []).some((i: any) => i.title === 'اختبار تجريبي للتنظيف'));
  check('تنظيف البيانات محصور بالمالك (401 بلا جلسة)', (await fetch(`${BASE}/api/platforms/youtube/content/cleanup-test-data`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 401);
  await setControls(auth, { autoPublish: true, autoSchedule: true, humanReviewMode: true });

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
  check('لا يُعلن تحقق بلا معرّف مزود بعد restart', (queue2.items || []).every((i: any) => !(i.verified === true && !i.externalVideoId)), JSON.stringify((queue2.items || []).filter((i: any) => i.verified && !i.externalVideoId)));
  check('الملخص لا يعدّ تحققاً بلا دليل', (health2?.youtubeContent?.summary?.verified ?? 0) === (queue2.items || []).filter((i: any) => i.verified === true && i.externalVideoId && ['PUBLISHED', 'SCHEDULED', 'VERIFIED'].includes(i.state)).length, JSON.stringify({ summaryVerified: health2?.youtubeContent?.summary?.verified, items: (queue2.items || []).map((i: any) => ({ t: i.title, s: i.state, v: i.verified, ext: i.externalVideoId, vv: i.verifiedVideoId })) }));
  check('مخزن المادة صمد بعد restart', health2.youtubeContent?.mediaStored > 0);

  group('14) الواجهة: طابور المحتوى موصول بالمسارات الصحيحة');
  const apiSrc = readFileSync(join(REPO_ROOT, 'src/services/api.ts'), 'utf8');
  const panelSrc = readFileSync(join(REPO_ROOT, 'src/components/agent/YouTubeContentQueuePanel.tsx'), 'utf8');
  const opsSrc = readFileSync(join(REPO_ROOT, 'src/components/agent/YouTubeOperationsView.tsx'), 'utf8');
  check('API فيه مسارات المحتوى', apiSrc.includes('/api/platforms/youtube/content/queue') && apiSrc.includes('/review') && apiSrc.includes('/drafts'));
  check('لوحة الطابور تستدعيها', panelSrc.includes('getYouTubeContentQueue') && panelSrc.includes('reviewYouTubeContentItem'));
  check('اللوحة مدمجة في مدير التشغيل', opsSrc.includes('YouTubeContentQueuePanel'));
  // لا كتابة base64 يدوياً: المدخل الآن اختيار ملف حقيقي من الجهاز.
  check('لا حقل base64 يدوي في الواجهة', !panelSrc.includes('بايتات الفيديو base64') && !panelSrc.includes('placeholder="بايتات'));
  check('الواجهة توفّر اختيار ملف فيديو حقيقي', panelSrc.includes('type="file"') && panelSrc.includes('accept="video/*"') && panelSrc.includes('اختيار فيديو'));
  check('الواجهة تتحقق من الحجم والنوع قبل الإرسال', panelSrc.includes('CONTENT_UPLOAD_MAX_BYTES') && panelSrc.includes('ALLOWED_VIDEO_TYPES'));
  check('الواجهة ترسل base64 داخلياً مع اسم الملف والنوع', panelSrc.includes('videoBase64: video.base64') && panelSrc.includes('filename: video.name'));
  check('الواجهة تحترم allowedActions من الخادم', panelSrc.includes('allowedActions'));
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
