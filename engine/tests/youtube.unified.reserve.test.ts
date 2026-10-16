/**
 * PR-S1 — حجز واحد فقط لكل عملية نشر يوتيوب (إصلاح الجذر المُثبت).
 *
 * الجذر: `executePlatformPublish` (الغلاف الخارجي) كان يحجز مفتاح
 * `youtube:publish:<postId>`، ثم الفرع الداخلي ليوتيوب كان يستدعي الغلاف المحجوز
 * `executeYouTubePublish` الذي يحجز **نفس المفتاح** مرة ثانية ⇒ يُرفض
 * 409 IDEMPOTENT_OPERATION_IN_PROGRESS ⇒ النشر الموحّد على يوتيوب يفشل دائماً.
 *
 * الإصلاح: الفرع الداخلي يستدعي `executeYouTubePublishInner` مباشرةً (بلا حجز
 * ثانٍ)، ويبقى المسار المباشر `/api/platforms/youtube/publish` يحجز مرة واحدة.
 *
 * هذا الاختبار **تكاملي حقيقي** (خادم فعلي + خادم Google وهمي محلي، بلا مزود حقيقي
 * ولا حصة ولا سرّ): النشر الموحّد ينجح بحجز واحد، وتكراره بعد النجاح يُرفض (done)،
 * والمسار المباشر ما زال محمياً.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
const APP_PORT = 8100 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const YT_PORT = 8160 + Math.floor(Math.random() * 40);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'youtube-unified-reserve-secret-not-real';
const GO_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
const GO_CLIENT_SECRET = 'test-google-client-secret-not-real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-yt-unified-reserve-'));
// فيديو وهمي بصيغة MP4 صالحة (توقيع ftyp) — لا فيديو حقيقي.
const VIDEO_B64 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(512, 7)]).toString('base64');

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
    YOUTUBE_OP_RATE_LIMIT: '500',
    YOUTUBE_DAILY_QUOTA: '1000000',
  };
  delete env.GEMINI_API_KEY; delete env.DATABASE_URL;
  proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
}
async function waitForHealth(timeoutMs = 180_000): Promise<boolean> {
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
async function createPost(auth: Record<string, string>, body: Record<string, unknown>): Promise<any> {
  return (await fetch(`${BASE}/api/workspace/content`, { method: 'POST', headers: auth, body: JSON.stringify(body) })).json();
}
async function approvePost(auth: Record<string, string>, id: string): Promise<any> {
  return (await fetch(`${BASE}/api/workspace/content/${id}/approve`, { method: 'POST', headers: auth, body: JSON.stringify({}) })).json();
}
async function publishUnified(auth: Record<string, string>, id: string, body: Record<string, unknown>): Promise<any> {
  return (await fetch(`${BASE}/api/workspace/content/${id}/publish`, { method: 'POST', headers: auth, body: JSON.stringify(body) })).json();
}
async function publishDirect(auth: Record<string, string>, body: Record<string, unknown>): Promise<any> {
  return (await fetch(`${BASE}/api/platforms/youtube/publish`, { method: 'POST', headers: auth, body: JSON.stringify(body) })).json();
}

async function integration(): Promise<void> {
  const mockState = createYouTubeMock();
  const yt = await startYouTubeMockServer(mockState as YouTubeMockState, YT_PORT);
  ytServer = yt;
  startApp(yt.base);
  if (!(await waitForHealth())) { console.log(log.slice(-2000)); throw new Error('الخادم لم يقلع'); }

  const auth = await login();
  await connectYouTube(auth);

  group('1) النشر الموحّد على يوتيوب ينجح بحجز واحد (لا 409)');
  const created = await createPost(auth, { title: 'منشور يوتيوب موحّد', content: 'نظرة على عروض التقسيط في معرض الغرابي', targetPlatforms: ['youtube'], status: 'review' });
  const postId = created.post?.id as string;
  check('أُنشئ المنشور', Boolean(postId), JSON.stringify(created).slice(0, 200));
  const approved = await approvePost(auth, postId);
  check('اعتُمد المنشور (approved)', approved.post?.status === 'approved', JSON.stringify(approved).slice(0, 200));

  mockState.uploadedVideoId = 'vid_unified_0001';
  const before = mockState.uploadInitCalls;
  const pub1 = await publishUnified(auth, postId, { videoBase64: VIDEO_B64, privacyStatus: 'public' });
  const ytRes1 = pub1.results?.youtube;
  check('لا رفض حجز مزدوج (لا IDEMPOTENT_OPERATION_IN_PROGRESS)', !JSON.stringify(pub1).includes('IDEMPOTENT_OPERATION_IN_PROGRESS'), JSON.stringify(pub1).slice(0, 300));
  check('يوتيوب نُشر بمعرّف مزوّد حقيقي', ytRes1?.state === 'published' && ytRes1?.providerPostId === mockState.uploadedVideoId, JSON.stringify(ytRes1).slice(0, 250));
  check('خرجت تهيئة رفع واحدة فقط (حجز واحد)', mockState.uploadInitCalls === before + 1, `calls=${mockState.uploadInitCalls}`);

  group('2) تكرار النشر نفسه بعد النجاح يُرفض (done) بلا رفع ثانٍ');
  const afterFirst = mockState.uploadInitCalls;
  // المنشور صار `published` بعد النجاح، فإعادة النشر الموحّد تُحجب ببوابة الاعتماد
  // (حماية مستقلة قائمة، لا تُضعَف).
  const pub2 = await publishUnified(auth, postId, { videoBase64: VIDEO_B64, privacyStatus: 'public' });
  check('إعادة النشر الموحّد محجوبة ببوابة الاعتماد (published)', pub2.code === 'APPROVAL_REQUIRED', JSON.stringify(pub2).slice(0, 250));
  // البرهان الأقوى على أن الحجز `done` (لا عالق `reserved`): نفس المفتاح عبر
  // المسار المباشر => IDEMPOTENT_ALREADY_COMPLETED بلا أي رفع جديد.
  const dupSameKey = await publishDirect(auth, { title: 'منشور يوتيوب موحّد', description: 'وصف', videoBase64: VIDEO_B64, postId, approved: true });
  check('نفس مفتاح الحجز مرفوض (IDEMPOTENT_ALREADY_COMPLETED — الحجز done لا عالق)', dupSameKey.code === 'IDEMPOTENT_ALREADY_COMPLETED', JSON.stringify(dupSameKey).slice(0, 250));
  check('لا تهيئة رفع جديدة عند التكرار', mockState.uploadInitCalls === afterFirst, `calls=${mockState.uploadInitCalls}`);

  group('3) الحجز لا يبقى عالقاً: نفس المفتاح يُعاد بعد `failed` (لا `reserved` دائم)');
  // نشر مباشر يفشل (نقص فيديو) => الحجز `failed` (لا عالق) => إعادة المحاولة مسموحة.
  const failKey = 'post_retry_probe_' + Date.now();
  const fail1 = await publishDirect(auth, { title: 'فشل مقصود', description: 'وصف', videoBase64: 'not-a-video', postId: failKey, approved: true });
  check('الرفع بمادة غير صالحة يفشل (لا نجاح وهمي)', fail1.success !== true, JSON.stringify(fail1).slice(0, 200));
  mockState.uploadedVideoId = 'vid_retry_ok_0001';
  const beforeRetry = mockState.uploadInitCalls;
  const retryOk = await publishDirect(auth, { title: 'إعادة بعد فشل', description: 'وصف', videoBase64: VIDEO_B64, postId: failKey, approved: true });
  check('إعادة المحاولة بنفس المفتاح تنجح (الحجز لم يبقَ عالقاً)', retryOk.success === true && retryOk.externalVideoId === mockState.uploadedVideoId, JSON.stringify(retryOk).slice(0, 250));
  check('رفع واحد فقط عند إعادة المحاولة', mockState.uploadInitCalls === beforeRetry + 1, `calls=${mockState.uploadInitCalls}`);

  group('4) المسار المباشر يحجز مرة واحدة لمنشور جديد (لم يُضعَف منع التكرار)');
  mockState.uploadedVideoId = 'vid_direct_0001';
  const beforeDirect = mockState.uploadInitCalls;
  const freshPostId = 'post_direct_fresh_' + Date.now();
  const directOk = await publishDirect(auth, { title: 'نشر مباشر جديد', description: 'وصف', videoBase64: VIDEO_B64, postId: freshPostId, approved: true });
  check('النشر المباشر نجح بمعرّف مزوّد', directOk.success === true && directOk.externalVideoId === mockState.uploadedVideoId, JSON.stringify(directOk).slice(0, 250));
  check('تهيئة رفع واحدة للنشر المباشر', mockState.uploadInitCalls === beforeDirect + 1, `calls=${mockState.uploadInitCalls}`);
  const directDup = await publishDirect(auth, { title: 'نشر مباشر جديد', description: 'وصف', videoBase64: VIDEO_B64, postId: freshPostId, approved: true });
  check('تكرار النشر المباشر مرفوض (done)', directDup.code === 'IDEMPOTENT_ALREADY_COMPLETED', JSON.stringify(directDup).slice(0, 250));
  check('لا رفع ثانٍ من المسار المباشر', mockState.uploadInitCalls === beforeDirect + 1, `calls=${mockState.uploadInitCalls}`);

  group('5) تصريح: النشر الموحّد محصور بالمالك');
  const noAuth = await fetch(`${BASE}/api/workspace/content/${postId}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoBase64: VIDEO_B64 }) });
  check('بلا جلسة => 401', noAuth.status === 401, String(noAuth.status));
}

async function main(): Promise<void> {
  try {
    await integration();
  } finally {
    try { if (proc) { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1200)); if (!proc.killed) proc.kill('SIGKILL'); } } catch { /* تجاهل */ }
    try { if (ytServer) await ytServer.stop(); } catch { /* تجاهل */ }
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }
  console.log('\n' + '='.repeat(60));
  if (failures.length === 0) {
    console.log(`PASSED: ${passed} YouTube unified single-reservation checks`);
    process.exit(0);
  } else {
    console.log(`FAILED: ${failures.length} of ${passed + failures.length}`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

void main();
