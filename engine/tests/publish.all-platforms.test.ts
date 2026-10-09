/**
 * اختبار تدقيق موحّد: النشر على المنصات العشر معاً + كل منصة منفردة.
 *
 * يثبت (بلا أي مزود حقيقي ولا حصة ولا سرّ — خوادم وهمية محلية فقط):
 *  - اختيار المنصات العشر معاً عبر مسار التوزيع المتوازي، بنتيجة مستقلة لكل منصة.
 *  - فشل منصة لا يوقف الأخريات (عزل كامل عبر Promise.allSettled).
 *  - كل منصة تتلقى النوع المدعوم لها فقط (المسار الصحيح لكل API).
 *  - المنصات بلا موصل منفّذ تُعلن EXTERNAL_SETUP_REQUIRED (لا NOT_CONNECTED الكاذب).
 *  - لا يُسجَّل أي نشر ناجح (published) بلا معرّف نشر حقيقي من مزود المنصة.
 *  - لا تسريب أي سرّ في أي استجابة.
 *
 * الموصلات الحقيقية الأربعة المغطّاة حيّاً: Facebook (نص/فيديو/صورة)، Instagram
 * (حاوية+جاهزية+نشر)، Telegram (sendMessage)، Threads (حاوية+نشر). TikTok مغطّى
 * هنا في حالته الصادقة بلا وسائط (MEDIA_REQUIRED) وعلى مستوى الوحدة الكامل في
 * tiktok.connector.test.ts (يتطلب رقماً/حصة حقيقة غير متاحة في التكامل الموحّد).
 */

import express from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createCipheriv } from 'node:crypto';
import type { Server } from 'node:http';
import { createTelegramMock, startTelegramMockServer } from './helpers/telegramMock';

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
const APP_PORT = 8900 + Math.floor(Math.random() * 30);
const META_PORT = 8940;
const TH_PORT = 8945;
const TT_PORT = 8950;
const TG_PORT = 8955;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'all-platforms-test-secret-not-real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const BOT_TOKEN = '555666777:TEST_BOT_TOKEN_NOT_REAL';
const TH_TOKEN = 'THREADS_MULTI_TOKEN';
const TH_USER = 'TH_USER_MULTI';
const IG_ACCOUNT = '17841400000000001';

const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-all-platforms-'));
const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };

/** يشفّر اعتماداً بنفس خوارزمية الخادم (AES-256-GCM) — للاختبار فقط. */
function encryptCredForTest(value: unknown): Record<string, string> {
  const key = Buffer.from(TOKEN_KEY, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { alg: 'aes-256-gcm', iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') };
}

interface MetaMock {
  server: Server;
  state: { feed: any[]; videos: any[]; photos: any[]; containers: any[]; published: any[]; failFacebook: boolean; failInstagram: boolean };
  stop: () => Promise<void>;
}

/** خادم Meta وهمي موحّد (Facebook + Instagram على نفس القاعدة كما في الإنتاج). */
function startMetaMock(port: number): Promise<MetaMock> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const state: MetaMock['state'] = { feed: [], videos: [], photos: [], containers: [], published: [], failFacebook: false, failInstagram: false };

  // نشر Facebook: /feed (نص)، /videos (فيديو file_url)، /photos (صورة url).
  app.post('/:version/:pageId/feed', (req, res) => {
    if (state.failFacebook) return res.status(400).json({ error: { message: 'Cannot publish', code: 200 } });
    const postId = `FB_FEED_${state.feed.length + 1}`;
    state.feed.push({ pageId: req.params.pageId, message: String(req.body?.message || ''), postId });
    return res.json({ id: postId });
  });
  app.post('/:version/:pageId/videos', (req, res) => {
    if (state.failFacebook) return res.status(400).json({ error: { message: 'Cannot publish video', code: 200 } });
    const videoId = `FB_VID_${state.videos.length + 1}`;
    state.videos.push({ pageId: req.params.pageId, fileUrl: String(req.body?.file_url || ''), description: String(req.body?.description || ''), videoId });
    return res.json({ id: videoId });
  });
  app.post('/:version/:pageId/photos', (req, res) => {
    if (state.failFacebook) return res.status(400).json({ error: { message: 'Cannot publish photo', code: 200 } });
    const postId = `FB_PHOTO_${state.photos.length + 1}`;
    state.photos.push({ pageId: req.params.pageId, imageUrl: String(req.body?.url || ''), message: String(req.body?.message || ''), postId });
    return res.json({ id: postId });
  });

  // نشر Instagram: /{ig-id}/media ثم /{ig-id}/media_publish.
  app.post('/:version/:igId/media', (req, res) => {
    if (state.failInstagram) return res.status(400).json({ error: { message: 'Cannot create container', code: 9007 } });
    const containerId = `IG_CONTAINER_${state.containers.length + 1}`;
    state.containers.push({ igId: req.params.igId, body: { ...req.body } as Record<string, string>, containerId });
    return res.json({ id: containerId });
  });
  app.post('/:version/:igId/media_publish', (req, res) => {
    if (state.failInstagram) return res.status(400).json({ error: { message: 'Cannot publish', code: 200 } });
    const creationId = String(req.body?.creation_id || '');
    const postId = `IG_POST_${state.published.length + 1}`;
    state.published.push({ igId: req.params.igId, creationId, postId });
    return res.json({ id: postId });
  });

  // حالة حاوية Instagram (تُقرأ قبل النشر): جاهزة دائماً.
  app.get('/:version/:id', (req, res) => {
    if (String(req.query.fields || '').includes('status_code')) return res.json({ id: req.params.id, status_code: 'FINISHED' });
    return res.status(400).json({ error: { message: 'Unknown object', code: 803 } });
  });

  const server = app.listen(port, '127.0.0.1');
  return new Promise((resolve) => server.on('listening', () => resolve({ server, state, stop: () => new Promise<void>((r) => server.close(() => r())) })));
}

/** Threads وهمي: حاوية FINISHED + نشر بمعرّف حقيقي. */
function startThreadsMock(port: number): Promise<{ server: Server; state: { containers: any[]; published: any[] } }> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const state = { containers: [] as any[], published: [] as any[] };
  app.post('/:version/:userId/threads', (req, res) => {
    const containerId = `TH_CONTAINER_${state.containers.length + 1}`;
    state.containers.push({ userId: req.params.userId, body: { ...req.body }, containerId });
    return res.json({ id: containerId });
  });
  app.get('/:version/:containerId', (req, res) => res.json({ id: req.params.containerId, status: 'FINISHED' }));
  app.post('/:version/:userId/threads_publish', (_req, res) => {
    const postId = `TH_POST_${state.published.length + 1}`;
    state.published.push({ postId });
    return res.json({ id: postId });
  });
  const server = app.listen(port, '127.0.0.1');
  return new Promise((resolve) => server.on('listening', () => resolve({ server, state })));
}

function startApp(): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    CONTAINER_POLL_INTERVAL_MS: '0',
    FACEBOOK_GRAPH_API_BASE: `http://127.0.0.1:${META_PORT}`,
    FACEBOOK_DIALOG_BASE: `http://127.0.0.1:${META_PORT}`,
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: 'all-platforms-fb-app-secret',
    FACEBOOK_VERIFY_TOKEN: 'all-platforms-fb-verify',
    THREADS_GRAPH_API_BASE: `http://127.0.0.1:${TH_PORT}`,
    TIKTOK_API_BASE: `http://127.0.0.1:${TT_PORT}`,
    TELEGRAM_API_BASE: `http://127.0.0.1:${TG_PORT}`,
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_DEFAULT_CHAT_ID: '-100200300',
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

let currentApp: { proc: ChildProcess; log: () => string } | null = null;
async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function stopApp(): Promise<void> {
  if (!currentApp) return;
  currentApp.proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1200));
  if (!currentApp.proc.killed) currentApp.proc.kill('SIGKILL');
}
async function login(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}

const ALL_PLATFORMS = ['youtube', 'facebook', 'instagram', 'tiktok', 'whatsapp', 'telegram', 'x', 'snapchat', 'threads', 'google_business'];

/** حالة أولية: Facebook/Instagram/Threads/Telegram موصولة موثقة. */
function seedConnectedState(): void {
  const connectedAt = new Date().toISOString();
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: connectedAt, users: [ownerUser],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [],
    platformConnections: [
      { platform: 'facebook', status: 'connected', accountId: 'PAGE_MULTI', accountName: 'معرض الغرابي', connectedAt, providerVerified: true },
      { platform: 'instagram', status: 'connected', accountId: IG_ACCOUNT, accountName: 'algharabi.gallery', connectedAt, providerVerified: true },
      { platform: 'threads', status: 'connected', accountId: TH_USER, accountName: '@gharabi', connectedAt, providerVerified: true },
      { platform: 'telegram', status: 'connected', accountId: '987654321', accountName: '@gharabi_test_bot', connectedAt, providerVerified: true },
      { platform: 'tiktok', status: 'connected', accountId: 'TT_OPEN_ID', accountName: '@gharabi', connectedAt, providerVerified: true },
      { platform: 'youtube', status: 'connected', accountId: 'UC_TEST_CHANNEL', accountName: 'معرض الغرابي', connectedAt, providerVerified: true },
    ],
    workspace: {
      showroom: {}, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [],
      providerTokens: {
        facebook: encryptCredForTest({ pageId: 'PAGE_MULTI', pageAccessToken: 'FB_PAGE_TOKEN', userAccessToken: 'FB_USER_TOKEN', connectedAt }),
        instagram: encryptCredForTest({ pageId: 'PAGE_IG', pageAccessToken: 'IG_PAGE_TOKEN', igAccountId: IG_ACCOUNT, username: 'algharabi.gallery', userAccessToken: 'IG_USER_TOKEN', connectedAt }),
        threads: encryptCredForTest({ access_token: TH_TOKEN, threadsUserId: TH_USER, username: 'gharabi', expiresAt: Date.now() + 30 * 24 * 3600 * 1000, connectedAt }),
        tiktok: encryptCredForTest({ accessToken: 'TT_ACCESS_TOKEN', refreshToken: 'TT_REFRESH_TOKEN', openId: 'TT_OPEN_ID', expiresAt: Date.now() + 24 * 3600 * 1000, connectedAt }),
      },
      publishRecords: [],
    },
  }), 'utf8');
}

async function createAndApprove(auth: Record<string, string>, body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${BASE}/api/workspace/content`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  const created = await res.json();
  const id = created?.post?.id;
  await fetch(`${BASE}/api/workspace/content/${id}/approve`, { method: 'POST', headers: auth, body: JSON.stringify({ note: 'اعتماد تدقيق موحّد' }) });
  return id;
}
async function publish(auth: Record<string, string>, id: string): Promise<any> {
  const res = await fetch(`${BASE}/api/workspace/content/${id}/publish`, { method: 'POST', headers: auth, body: '{}' });
  return { status: res.status, body: await res.json() };
}

(async () => {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  seedConnectedState();
  const meta = await startMetaMock(META_PORT);
  const threads = await startThreadsMock(TH_PORT);
  const tgMock = createTelegramMock();
  const tgServer = await startTelegramMockServer(TG_PORT, tgMock);

  currentApp = startApp();
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('خادم التطبيق يقلع', await waitForHealth(), currentApp.log().slice(0, 500));
    Object.assign(auth, await login());

    group('1) الحالة قبل النشر: الموصلات الحقيقية موثقة، والبقية معلنة بصدق');
    const readiness = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const byId = (id: string) => readiness.platforms.find((p: any) => p.platform === id);
    check('Facebook موصول موثق', byId('facebook').connected === true && byId('facebook').providerVerified === true);
    check('Instagram موصول موثق', byId('instagram').connected === true && byId('instagram').providerVerified === true);
    check('Threads موصول موثق', byId('threads').connected === true && byId('threads').providerVerified === true);
    check('Telegram موصول موثق', byId('telegram').connected === true && byId('telegram').providerVerified === true);
    check('الموصلات الست معلنة حقيقية', ['facebook', 'instagram', 'threads', 'telegram', 'tiktok', 'youtube'].every((id) => byId(id).realConnector === true), JSON.stringify(['facebook', 'instagram', 'threads', 'telegram', 'tiktok', 'youtube'].map((id) => [id, byId(id).realConnector])));
    check('المنصات الأربع بلا موصل منفّذ', ['whatsapp', 'x', 'snapchat', 'google_business'].every((id) => byId(id).realConnector === false));

    group('2) النشر على المنصات العشر معاً — نتيجة مستقلة لكل منصة');
    const mediaUrl = `${BASE}/media/offer-banner.jpg`;
    const multiId = await createAndApprove(auth, { title: 'حملة تدقيق موحّد', content: 'عرض الغرابي للتقسيط — شاهد أحدث الأجهزة.', targetPlatforms: ALL_PLATFORMS, mediaType: 'image', mediaUrl, status: 'review' });
    const multi = await publish(auth, multiId);
    check('طلب النشر الموحّد نجح', multi.status === 200 && multi.body.success === true, String(multi.status));
    check('نتيجة مستقلة لكل منصة من العشر', Object.keys(multi.body.results || {}).length === 10 && ALL_PLATFORMS.every((p) => p in multi.body.results), JSON.stringify(Object.keys(multi.body.results || {})));

    const r = multi.body.results;
    group('3) المنصات ذات الموصل الحقيقي تُنشر فعلاً بمعرّف مزود');
    check('فيسبوك published بمعرّف Meta', r.facebook?.state === 'published' && Boolean(r.facebook?.providerPostId), JSON.stringify(r.facebook));
    check('إنستغرام published بمعرّف Meta', r.instagram?.state === 'published' && Boolean(r.instagram?.providerPostId), JSON.stringify(r.instagram));
    check('Telegram published بمعرّف bot', r.telegram?.state === 'published' && Boolean(r.telegram?.providerPostId), JSON.stringify(r.telegram));
    check('Threads published بمعرّف Meta', r.threads?.state === 'published' && Boolean(r.threads?.providerPostId), JSON.stringify(r.threads));

    group('4) المنصات بلا موصل حقيقي/بلا وسائط تفشل بأسباب صادقة ومتميزة');
    check('يوتيوب يوجّه للمسار المخصص (PLATFORM_USE_DEDICATED_PUBLISH)', r.youtube?.code === 'PLATFORM_USE_DEDICATED_PUBLISH', JSON.stringify(r.youtube));
    check('تيك توك بلا وسائط => MEDIA_REQUIRED (لا نشر نصي مختلق)', r.tiktok?.code === 'MEDIA_REQUIRED', JSON.stringify(r.tiktok));
    check('واتساب => CAPABILITY_NOT_SUPPORTED (لا قدرة نشر)', r.whatsapp?.code === 'CAPABILITY_NOT_SUPPORTED', JSON.stringify(r.whatsapp));
    check('X => EXTERNAL_SETUP_REQUIRED (موصل غير منفّذ)', r.x?.code === 'EXTERNAL_SETUP_REQUIRED', JSON.stringify(r.x));
    check('سنابشات => EXTERNAL_SETUP_REQUIRED', r.snapchat?.code === 'EXTERNAL_SETUP_REQUIRED', JSON.stringify(r.snapchat));
    check('Google Business => EXTERNAL_SETUP_REQUIRED', r.google_business?.code === 'EXTERNAL_SETUP_REQUIRED', JSON.stringify(r.google_business));
    check('لا منصة فاشلة تحمل معرّف مزود مختلق', ['youtube', 'tiktok', 'whatsapp', 'x', 'snapchat', 'google_business'].every((p) => r[p]?.providerPostId === null), JSON.stringify(r));

    group('5) كل منصة تتلقى النوع المدعوم لها فقط (المسار الصحيح لكل API)');
    check('فيسبوك: الصورة عبر POST /{page-id}/photos (لا feed)', meta.state.photos.length >= 1 && meta.state.photos[0].imageUrl === mediaUrl, JSON.stringify(meta.state.photos).slice(0, 160));
    check('فيسبوك: لم يُنشر نص إضافي في /feed', meta.state.feed.length === 0, `feed=${meta.state.feed.length}`);
    check('إنستغرام: أُنشئت حاوية ثم نُشرت (خطوتان رسميتان)', meta.state.containers.length >= 1 && meta.state.published.length >= 1, JSON.stringify({ c: meta.state.containers.length, p: meta.state.published.length }));
    check('Threads: حاوية ثم نشر (بمعرّف مزود)', threads.state.published.length >= 1, String(threads.state.published.length));
    check('Telegram: sendMessage فعلية', tgMock.sent.length >= 1, String(tgMock.sent.length));

    group('6) لا يُعلن published كاذباً حين لا تُسلّم أي منصة');
    const noneId = await createAndApprove(auth, { title: 'منصات غير منفّذة', content: 'نص تدقيق بلا قدرة نشر فعلية.', targetPlatforms: ['x', 'snapchat', 'google_business'], status: 'review' });
    const none = await publish(auth, noneId);
    check('لا تسليم لأي منصة غير منفّذة', none.body.anyDelivered === false, String(none.body.anyDelivered));
    check('المنشور لم يُعلن published', none.body.post?.status !== 'published', String(none.body.post?.status));

    group('7) عزل الفشل: فشل منصة لا يوقف الأخريات');
    meta.state.failFacebook = true;
    const isoId = await createAndApprove(auth, { title: 'عزل الفشل', content: 'نص تدقيق لعزل الفشل بين المنصات.', targetPlatforms: ['facebook', 'instagram', 'telegram', 'threads'], mediaType: 'image', mediaUrl, status: 'review' });
    const iso = await publish(auth, isoId);
    meta.state.failFacebook = false;
    const ir = iso.body.results;
    check('فيسبوك فشل بصراحة (لا معرّف)', ir.facebook?.state === 'failed' && ir.facebook?.providerPostId === null, JSON.stringify(ir.facebook));
    check('إنستغرام نجح رغم فشل فيسبوك', ir.instagram?.state === 'published', JSON.stringify(ir.instagram));
    check('Threads نجح رغم فشل فيسبوك', ir.threads?.state === 'published', JSON.stringify(ir.threads));
    check('Telegram نجح رغم فشل فيسبوك', ir.telegram?.state === 'published', JSON.stringify(ir.telegram));

    group('8) كل منصة منفردة عبر /api/platforms/:platform/publish');
    const fbOne = await (await fetch(`${BASE}/api/platforms/facebook/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'نشر فيسبوك منفرد.', approved: true }) })).json();
    check('فيسبوك منفرد published بمعرّف', fbOne?.success === true && Boolean(fbOne.providerPostId), JSON.stringify(fbOne).slice(0, 160));
    const tgOne = await (await fetch(`${BASE}/api/platforms/telegram/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'نشر تيليجرام منفرد.', approved: true, chatId: '-100200300' }) })).json();
    check('Telegram منفرد published بمعرّف', tgOne?.success === true && Boolean(tgOne.providerPostId), JSON.stringify(tgOne).slice(0, 160));
    const thOne = await (await fetch(`${BASE}/api/platforms/threads/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'نشر Threads منفرد.', approved: true }) })).json();
    check('Threads منفرد published بمعرّف', thOne?.success === true && Boolean(thOne.providerPostId), JSON.stringify(thOne).slice(0, 160));
    const igOne = await (await fetch(`${BASE}/api/platforms/instagram/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'نشر إنستغرام منفرد.', approved: true, imageUrl: mediaUrl }) })).json();
    check('إنستغرام منفرد published بمعرّف', igOne?.success === true && Boolean(igOne.providerPostId), JSON.stringify(igOne).slice(0, 160));
    const ttNoMedia = await fetch(`${BASE}/api/platforms/tiktok/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'نص فقط', approved: true }) });
    const ttBody = await ttNoMedia.json();
    check('تيك توك منفرد بلا وسائط => 422 MEDIA_REQUIRED', ttNoMedia.status === 422 && ttBody.code === 'MEDIA_REQUIRED', `${ttNoMedia.status}/${ttBody.code}`);
    const noAuth = await fetch(`${BASE}/api/platforms/facebook/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    check('نشر منصة بلا جلسة => 401', noAuth.status === 401, String(noAuth.status));

    group('9) لا تسريب أي سرّ في أي استجابة');
    const blob = JSON.stringify([multi.body, none.body, iso.body, fbOne, tgOne, thOne, igOne]);
    check('لا رمز بوت Telegram', !blob.includes(BOT_TOKEN));
    check('لا رمز صفحة Facebook/Instagram', !blob.includes('FB_PAGE_TOKEN') && !blob.includes('IG_PAGE_TOKEN'));
    check('لا رمز Threads', !blob.includes(TH_TOKEN));

    console.log(`\n${'='.repeat(60)}`);
    if (failures.length) {
      console.error(`FAILED: ${failures.length} — passed ${passed}`);
      failures.forEach((f) => console.error(`  ✗ ${f}`));
      process.exitCode = 1;
    } else {
      console.log(`PASSED: ${passed} all-platforms checks`);
    }
  } catch (err) {
    console.error('اختبار المنصات العشر فشل:', err);
    console.error(currentApp?.log()?.slice(-2000));
    process.exitCode = 1;
  } finally {
    await stopApp();
    await meta.stop();
    threads.server.close();
    await tgServer.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }
})();
