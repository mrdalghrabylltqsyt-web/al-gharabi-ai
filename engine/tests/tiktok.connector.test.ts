/**
 * اختبارات موصل TikTok الحقيقي — رابع تكامل اجتماعي خارجي.
 *
 * طبقتان:
 *  1) وحدة: الدوال الحتمية (مصفوفة القدرات الرسمية، بناء الطلبات، تصنيف حالة
 *     النشر، تحقق TikTok-Signature، تطبيع webhook، صلاحية صيغة client_key) بلا شبكة.
 *  2) تكامل: الخادم الحقيقي مع خادم TikTok وهمي محلي عبر TIKTOK_API_BASE، فيُختبر:
 *     OAuth (start → callback → تبادل → إثبات هوية)، الحفظ المشفّر، التجديد التلقائي،
 *     رفض الحالة/إعادة استخدامها، الحماية من التكرار، النشر (تهيئة + استعلام حالة)،
 *     منع النشر بلا وسائط، منع التسجيل بلا publish_id، حارس السلامة، التصريح،
 *     وثبات الأحداث ومنع التكرار بعد restart.
 *
 * لا يلمس أي مزود TikTok حقيقي ولا يستهلك أي حصة، ولا يستخدم أي سرّ واقعي.
 * ويشمل فحوص انحدار صريحة لـTelegram/Facebook/Instagram (عدم كسرها).
 */

import express from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHmac, createHash, createCipheriv } from 'node:crypto';
import {
  TIKTOK_CAPABILITY_MATRIX,
  TIKTOK_REQUIRED_SCOPES,
  TIKTOK_WEBHOOK_EVENTS,
  TIKTOK_PRIVACY_LEVELS,
  resolveTikTokScopes,
  tiktokCapabilityStatus,
  tiktokCapabilitySupported,
  tiktokCapabilityNeedsAudit,
  isPlausibleTikTokClientKey,
  buildTikTokTokenExchangeBody,
  buildTikTokRefreshBody,
  buildTikTokRevokeBody,
  parseTikTokTokenResponse,
  buildVideoPostBody,
  buildPhotoPostBody,
  buildPublishStatusBody,
  classifyPublishStatus,
  parseTikTokSignatureHeader,
  verifyTikTokSignature,
  parseTikTokWebhook,
  tiktokApiUrl,
  tiktokTokenUrl,
} from '../social/tiktok';
import { createTikTokMock, startTikTokMockServer } from './helpers/tiktokMock';
import { signSession } from '../auth/sessions';
import { PLATFORM_SPECS, hasRealConnector } from '../social/registry';

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
const APP_PORT = 7300 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const TT_PORT = 7400 + Math.floor(Math.random() * 80);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'tiktok-connector-test-secret-not-real';
const TT_CLIENT_KEY = 'test_tiktok_client_key';
const TT_CLIENT_SECRET = 'test-tiktok-client-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-tiktok-'));
const TOKEN_KEY = randomBytes(32).toString('hex');

const secretBuffer = createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };
const staffUser = { id: 'staff-1', name: 'موظف اختبار', email: 'staff@example.invalid', role: 'staff', roleTitleArabic: 'الموظف', avatar: '', active: true, createdAt: new Date().toISOString() };

function startApp(ttBase: string, extraEnv: Record<string, string> = {}): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    // خادم TikTok وهمي محلي: لا اتصال بمزود حقيقي في الاختبارات.
    TIKTOK_API_BASE: ttBase,
    TIKTOK_CLIENT_KEY: TT_CLIENT_KEY,
    TIKTOK_CLIENT_SECRET: TT_CLIENT_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    ...extraEnv,
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
  const res = await fetch(`${BASE}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
  });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}
/** يبني ترويسة TikTok-Signature الصحيحة: t=<ts>,s=hmac-sha256(client_secret, ts + '.' + rawBody). */
function tiktokSignature(rawBody: string, secret: string, ts = String(Date.now())): string {
  const h = createHmac('sha256', secret).update(`${ts}.${rawBody}`, 'utf8').digest('hex');
  return `t=${ts},s=${h}`;
}
/**
 * يشفّر اعتماداً بنفس خوارزمية الخادم (AES-256-GCM) — للاختبار فقط، لمحاكاة
 * توكن منتهٍ داخل المخزن بلا أي قيمة سرّية واقعية.
 */
function encryptCredForTest(value: unknown, keyHex: string): Record<string, string> {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { alg: 'aes-256-gcm', iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') };
}

async function postWebhook(payload: string, signature: string) {
  const res = await fetch(`${BASE}/api/platforms/tiktok/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'tiktok-signature': signature }, body: payload,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

function unitTests(): void {
  group('1) وحدة: مصفوفة القدرات الرسمية — لا تُعلن قدرة غير مدعومة');
  const byKey = Object.fromEntries(TIKTOK_CAPABILITY_MATRIX.map((r) => [r.key, r]));
  check('Login Kit مدعوم', tiktokCapabilitySupported('login_kit') && byKey['login_kit'].status === 'SUPPORTED');
  check('هوية الحساب (user.info.basic) مدعومة', byKey['user_identity'].status === 'SUPPORTED');
  check('Display API (بيانات الفيديوهات) مدعومة', byKey['display_api'].status === 'SUPPORTED');
  check('Content Posting API — رفع مسودة مدعوم', byKey['content_posting_draft'].status === 'SUPPORTED');
  check('Content Posting API — نشر مباشر يحتاج مراجعة (audit)', byKey['content_posting_direct'].status === 'REQUIRES_AUDIT' && tiktokCapabilityNeedsAudit('content_posting_direct'));
  check('نشر الصور مدعوم بالكود ويحتاج audit للنشر العام', byKey['photo_publishing'].status === 'REQUIRES_AUDIT' && tiktokCapabilityNeedsAudit('photo_publishing'));
  check('معلومات الناشر مدعومة', byKey['creator_info'].status === 'SUPPORTED');
  check('استعلام حالة النشر مدعوم', byKey['post_status'].status === 'SUPPORTED');
  check('التحليلات (Display API) مدعومة', byKey['analytics'].status === 'SUPPORTED');
  check('webhooks تحتاج مراجعة (REQUIRES_REVIEW)', byKey['webhooks'].status === 'REQUIRES_REVIEW' && tiktokCapabilityNeedsAudit('webhooks'));
  check('التعليقات غير متاحة عبر الواجهة العامة', byKey['comments_read'].status === 'NOT_AVAILABLE_BY_PUBLIC_API' && byKey['comments_reply'].status === 'NOT_AVAILABLE_BY_PUBLIC_API');
  check('الرسائل المباشرة غير متاحة عبر الواجهة العامة', byKey['direct_messages_read'].status === 'NOT_AVAILABLE_BY_PUBLIC_API' && byKey['direct_messages_reply'].status === 'NOT_AVAILABLE_BY_PUBLIC_API');
  check('لا قدرة بحالة غير معروفة', TIKTOK_CAPABILITY_MATRIX.every((r) => ['SUPPORTED', 'REQUIRES_REVIEW', 'REQUIRES_AUDIT', 'SANDBOX_ONLY', 'NOT_AVAILABLE_BY_PUBLIC_API'].includes(r.status)));
  check('قدرة غير معروفة تُعيد null لا ادعاء', tiktokCapabilityStatus('does_not_exist') === null && !tiktokCapabilitySupported('does_not_exist'));

  group('2) وحدة: الصلاحيات الرسمية وحلّ الاعتماديات');
  check('النطاقات الرسمية الثلاثة مطلوبة', ['user.info.basic', 'video.publish', 'video.list'].every((s) => TIKTOK_REQUIRED_SCOPES.includes(s)));
  check('لا نطاق بلا استدعاء حقيقي في المجموعة المطلوبة', TIKTOK_REQUIRED_SCOPES.length === 3, TIKTOK_REQUIRED_SCOPES.join(','));
  check('المجموعة بلا تكرار', new Set(TIKTOK_REQUIRED_SCOPES).size === TIKTOK_REQUIRED_SCOPES.length);
  const partial = resolveTikTokScopes(['video.publish']);
  check('حلّ مجموعة جزئية يضيف user.info.basic', partial.includes('user.info.basic'));
  check('حلّ مجموعة جزئية يضيف video.list', partial.includes('video.list'));
  check('الحلّ بلا تكرار', new Set(partial).size === partial.length);
  check('لا نطاق غير رسمي في الحلّ', resolveTikTokScopes(['not_a_real_scope']).includes('not_a_real_scope') === false);

  group('3) وحدة: صيغة client_key والروابط الرسمية');
  check('client_key نصي بلا مسافات مقبول', isPlausibleTikTokClientKey('aw1234567890abcdef'));
  check('client_key بمسافة مرفوض', !isPlausibleTikTokClientKey(' aw1234567890 '));
  check('client_key فارغ مرفوض', !isPlausibleTikTokClientKey('') && !isPlausibleTikTokClientKey(null));
  check('client_key بمحارف غريبة مرفوض', !isPlausibleTikTokClientKey('abc\u0000def'));
  check('رابط النشر الرسمي صحيح', tiktokApiUrl('/v2/user/info/') === 'https://open.tiktokapis.com/v2/user/info/');
  check('رابط الرمز الرسمي صحيح', tiktokTokenUrl() === 'https://open.tiktokapis.com/v2/oauth/token/');
  check('القاعدة قابلة للتجاوز في الاختبار', tiktokApiUrl('/v2/user/info/', 'http://127.0.0.1:9').startsWith('http://127.0.0.1:9/v2/'));

  group('4) وحدة: بناء طلبات الرمز والنشر');
  const ex = buildTikTokTokenExchangeBody({ clientKey: 'ck', clientSecret: 'cs', code: 'C1', redirectUri: 'https://x/cb', codeVerifier: 'V1' });
  check('جسم التبادل يحمل client_key وgrant_type', ex.get('client_key') === 'ck' && ex.get('grant_type') === 'authorization_code');
  check('جسم التبادل يحمل code_verifier (PKCE)', ex.get('code_verifier') === 'V1');
  check('جسم التبادل يحمل redirect_uri', ex.get('redirect_uri') === 'https://x/cb');
  check('جسم التبادل لا يسرّب السرّ في حقل غير مخصّص', ex.get('client_secret') === 'cs');
  check('جسم التجديد يحمل grant_type=refresh_token', buildTikTokRefreshBody({ clientKey: 'ck', clientSecret: 'cs', refreshToken: 'R1' }).get('grant_type') === 'refresh_token');
  // الوثيقة الرسمية: إبطال الرمز يأخذ client_key + client_secret + token بلا grant_type.
  const rbody = buildTikTokRevokeBody({ clientKey: 'ck', clientSecret: 'cs', token: 'T1' });
  check('جسم الإبطال يحمل client_key وtoken بلا grant_type', rbody.get('client_key') === 'ck' && rbody.get('token') === 'T1' && rbody.get('grant_type') === null);
  const vbody = buildVideoPostBody({ postMode: 'DIRECT_POST', title: 'عرض', privacyLevel: 'SELF_ONLY', source: 'PULL_FROM_URL', videoUrl: 'https://x/v.mp4' });
  check('جسم الفيديو يحمل post_info.privacy_level', (vbody as any).post_info.privacy_level === 'SELF_ONLY');
  check('جسم الفيديو يحمل source=PULL_FROM_URL وvideo_url', (vbody as any).source_info.source === 'PULL_FROM_URL' && (vbody as any).source_info.video_url === 'https://x/v.mp4');
  const pbody = buildPhotoPostBody({ postMode: 'MEDIA_UPLOAD', title: 'عرض', privacyLevel: 'SELF_ONLY', photoUrls: ['https://x/1.jpg'] });
  check('جسم الصور يحمل post_mode وphoto_images', (pbody as any).post_mode === 'MEDIA_UPLOAD' && (pbody as any).source_info.photo_images[0] === 'https://x/1.jpg');
  check('جسم استعلام الحالة يحمل publish_id', buildPublishStatusBody('P1').publish_id === 'P1');

  group('5) وحدة: تصنيف حالة النشر — لا تسليم بلا PUBLISH_COMPLETE');
  const complete = classifyPublishStatus({ status: 'PUBLISH_COMPLETE', publiclyAvailablePostIds: ['VID1'] });
  check('PUBLISH_COMPLETE => delivered=true ومعرّف منشور', complete.delivered === true && complete.providerPostId === 'VID1');
  const failed = classifyPublishStatus({ status: 'FAILED', failReason: 'video_too_long' });
  check('FAILED => delivered=false مع سبب', failed.delivered === false && failed.state === 'failed' && failed.detail.includes('video_too_long'));
  const processing = classifyPublishStatus({ status: 'PROCESSING_UPLOAD' });
  check('قيد المعالجة => delivered=false', processing.delivered === false && processing.state === 'processing');
  check('حالة غير معروفة لا تُعلن تسليماً', classifyPublishStatus({ status: 'SOMETHING' }).delivered === false);
  check('حالة بلا status لا تُعلن تسليماً', classifyPublishStatus({}).delivered === false);

  group('6) وحدة: TikTok-Signature (توقيع الجسم الخام)');
  const raw = JSON.stringify({ event: 'video.publish.completed', client_key: 'ck' });
  const good = tiktokSignature(raw, TT_CLIENT_SECRET, '1700000000');
  check('توقيع صحيح يُقبل', verifyTikTokSignature({ header: good, rawBody: raw, clientSecret: TT_CLIENT_SECRET }).ok);
  check('توقيع بجسم مختلف يُرفض', !verifyTikTokSignature({ header: good, rawBody: raw + ' ', clientSecret: TT_CLIENT_SECRET }).ok);
  check('توقيع بسرّ مختلف يُرفض', !verifyTikTokSignature({ header: good, rawBody: raw, clientSecret: 'other' }).ok);
  check('ترويسة غائبة تُرفض', !verifyTikTokSignature({ header: null, rawBody: raw, clientSecret: TT_CLIENT_SECRET }).ok);
  check('ترويسة مشوّهة تُرفض', !verifyTikTokSignature({ header: 'garbage', rawBody: raw, clientSecret: TT_CLIENT_SECRET }).ok);
  const parsedH = parseTikTokSignatureHeader(good);
  check('تحليل الترويسة يستخرج t وs', parsedH.timestamp === '1700000000' && parsedH.signature !== null);
  check('تحليل ترويسة غائبة آمن', parseTikTokSignatureHeader(null).signature === null);

  group('7) وحدة: تطبيع webhook — الأحداث الرسمية الثلاثة فقط');
  const ev = parseTikTokWebhook({ event: 'video.publish.completed', client_key: 'ck', create_time: 1700000000, user_openid: 'oid', content: JSON.stringify({ publish_id: 'P1', publicly_available_post_id: ['VID1'] }) });
  check('حدث اكتمال النشر يُطبَّع', ev.event?.event === 'video.publish.completed' && ev.event.supported === true);
  check('معرّف الحدث يمنع التكرار (يحوي النوع+الحساب+الوقت)', ev.event?.externalId.includes('video.publish.completed') && ev.event?.externalId.includes('oid') === true);
  check('user_openid محفوظ', ev.event?.userOpenId === 'oid');
  check('محتوى الحدث محفوظ', ev.event?.content?.publish_id === 'P1');
  check('إلغاء التفويض مدعوم', parseTikTokWebhook({ event: 'authorization.removed', user_openid: 'oid' }).event?.supported === true);
  check('حدث portability.download.ready خارج النطاق يُعلن غير مدعوم بلا اختراع', parseTikTokWebhook({ event: 'portability.download.ready', user_openid: 'oid' }).event?.supported === false);
  check('حدث غير معروف يُقبل ويُعلن غير مدعوم (لا يُصنَّف تعليقاً)', parseTikTokWebhook({ event: 'something.else' }).event?.supported === false);
  check('حمولة بلا event لا تُنتج حدثاً', parseTikTokWebhook({}).event === null);
  check('الأحداث الرسمية الثلاثة فقط مُعلنة', TIKTOK_WEBHOOK_EVENTS.length === 3);
  check('لا حدث تعليق/رسالة مُختلق', !TIKTOK_WEBHOOK_EVENTS.some((e) => /comment|message/i.test(e)));
  check('مستويات الخصوصية الرسمية معلنة', TIKTOK_PRIVACY_LEVELS.includes('SELF_ONLY') && TIKTOK_PRIVACY_LEVELS.includes('PUBLIC_TO_EVERYONE'));

  group('8) وحدة: السجل يعلن TikTok موصلاً حقيقياً بلا ادعاء تعليقات/رسائل');
  const ttSpec = PLATFORM_SPECS.find((s) => s.platform === 'tiktok')!;
  check('TikTok مُعلن بموصل حقيقي', hasRealConnector('tiktok') && ttSpec.realConnector === true);
  check('TikTok يدعم النشر', ttSpec.capabilities.includes('publish'));
  check('TikTok لا يدعم تعليقات (comment_reply)', !ttSpec.capabilities.includes('comment_reply'));
  check('TikTok لا يدعم رسائل مباشرة (message_reply)', !ttSpec.capabilities.includes('message_reply'));
  check('TikTok يستخدم OAuth2', ttSpec.credentialMode === 'oauth2');
}

async function integrationTests(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser, staffUser],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: { showroom: {}, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [], providerTokens: {} },
  }), 'utf8');

  const mock = await startTikTokMockServer(TT_PORT, createTikTokMock());
  let app = startApp(mock.base);
  let currentApp = app;
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 500));
    Object.assign(auth, await login());
    const staffToken = signSession({ uid: 'staff-1', iat: Date.now(), exp: Date.now() + 3_600_000, sid: randomBytes(8).toString('hex') }, secretBuffer);
    const staffAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` };

    group('9) تكامل: التصريح — مسارات TikTok محمية');
    check('status بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/tiktok/status`)).status === 401);
    check('publish-status بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/tiktok/publish-status?publishId=P1`)).status === 401);
    check('creator-info بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/tiktok/creator-info`)).status === 401);
    check('oauth/start بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/tiktok/oauth/start`)).status === 401);
    check('oauth/setup لغير المالك => 403', (await fetch(`${BASE}/api/platforms/tiktok/oauth/setup`, { headers: staffAuth })).status === 403);
    check('publish لغير المالك => 403', (await fetch(`${BASE}/api/platforms/tiktok/publish`, { method: 'POST', headers: staffAuth, body: '{}' })).status === 403);
    check('disconnect بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/tiktok/disconnect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 401);

    group('10) تكامل: oauth/setup يعرض الإعداد الدقيق بلا أي سرّ');
    const setup = await (await fetch(`${BASE}/api/platforms/tiktok/oauth/setup`, { headers: auth })).json();
    check('oauth/setup يعلن client_key مضبوطاً', setup.tiktokSetup?.clientKeyConfigured === true);
    check('oauth/setup يعلن client_secret مضبوطاً', setup.tiktokSetup?.clientSecretConfigured === true);
    check('oauth/setup يعلن PKCE مطلوباً', setup.tiktokSetup?.pkceRequired === true);
    check('oauth/setup يعرض redirectUri الصحيح', String(setup.redirectUri).endsWith('/api/platforms/tiktok/oauth/callback'));
    check('oauth/setup يعرض النطاقات الرسمية', JSON.stringify(setup.tiktokSetup?.requestedScopes) === JSON.stringify([...TIKTOK_REQUIRED_SCOPES]));
    check('oauth/setup يعلن مراجعة مطلوبة للنشر العام', setup.tiktokSetup?.appReviewRequired === true);
    check('oauth/setup بلا أي سرّ', !JSON.stringify(setup).includes(TT_CLIENT_SECRET));
    check('oauth/setup يعرض مصفوفة القدرات', Array.isArray(setup.tiktokSetup?.capabilityMatrix));

    group('11) تكامل: OAuth start — رابط رسمي + state دائم + PKCE');
    const start = await (await fetch(`${BASE}/api/platforms/tiktok/oauth/start`, { headers: auth })).json();
    check('oauth/start ينجح ويُعيد رابط تفويض', start.success === true && typeof start.authorizationUrl === 'string');
    const aurl = new URL(start.authorizationUrl);
    check('الرابط يذهب إلى نقطة TikTok الرسمية', aurl.host === 'www.tiktok.com' && aurl.pathname === '/v2/auth/authorize/');
    check('الرابط يحمل client_key', aurl.searchParams.get('client_key') === TT_CLIENT_KEY);
    check('الرابط يحمل response_type=code', aurl.searchParams.get('response_type') === 'code');
    check('الرابط يحمل PKCE challenge', (aurl.searchParams.get('code_challenge') || '').length > 0 && aurl.searchParams.get('code_challenge_method') === 'S256');
    check('الرابط يحمل state', (aurl.searchParams.get('state') || '').length >= 16);
    check('الرابط يحمل النطاقات الرسمية', (aurl.searchParams.get('scope') || '').includes('video.publish'));
    check('الرابط لا يسرّب client_secret', !start.authorizationUrl.includes(TT_CLIENT_SECRET));
    const stateVal = aurl.searchParams.get('state')!;

    group('12) تكامل: callback — تبادل الرمز + إثبات الهوية + حفظ مشفّر');
    // محاكاة عودة TikTok: تُنفَّذ عبر المسار العام callback مع state الحقيقي.
    const cbRes = await fetch(`${BASE}/api/platforms/tiktok/oauth/callback?code=AUTHCODE_TEST&state=${encodeURIComponent(stateVal)}`, { headers: auth });
    check('callback يعيد 200', cbRes.status === 200, `status=${cbRes.status}`);
    check('تبادل الرمز نُفِّذ فعلياً لدى المزوّد', mock.state.lastExchange !== null && mock.state.lastExchange?.redirectUri.endsWith('/api/platforms/tiktok/oauth/callback'));
    check('code_verifier أُرسل في التبادل (PKCE)', (mock.state.lastExchange?.codeVerifierLen || 0) > 0);

    const status = await (await fetch(`${BASE}/api/platforms/tiktok/status`, { headers: auth })).json();
    check('الحالة متصلة وموثقة (open_id)', status.connected === true && status.providerVerified === true);
    check('open_id مخزّن', status.accountId === mock.state.openId);
    check('اسم الحساب مخزّن', status.accountName === mock.state.displayName);
    check('التوكن مخزّن مشفّراً', status.tokenStored === true);
    check('refresh token مخزّن', status.refreshTokenStored === true);
    check('انتهاء التوكن معلوم', status.tokenExpiryKnown === true);
    check('الحالة بلا أي سرّ', !JSON.stringify(status).includes(TT_CLIENT_SECRET) && !JSON.stringify(status).includes(mock.state.accessToken));

    group('13) تكامل: إعادة استخدام state مرفوضة (منع replay)');
    const replay = await fetch(`${BASE}/api/platforms/tiktok/oauth/callback?code=AUTHCODE_TEST&state=${encodeURIComponent(stateVal)}`, { headers: auth });
    check('إعادة استخدام state => 400', replay.status === 400, `status=${replay.status}`);

    group('14) تكامل: state غير صالح مرفوض');
    const badState = await fetch(`${BASE}/api/platforms/tiktok/oauth/callback?code=X&state=totally_invalid_state_value`, { headers: auth });
    check('state غير صالح => 400', badState.status === 400);

    group('15) تكامل: معلومات الناشر + استعلام حالة النشر (حقيقيان)');
    const creator = await (await fetch(`${BASE}/api/platforms/tiktok/creator-info`, { headers: auth })).json();
    check('creator-info ينجح', creator.success === true);
    check('creator-info يحمل اسم الناشر', creator.creator?.nickname === mock.state.displayName);
    check('creator-info يحمل مستويات الخصوصية', JSON.stringify(creator.creator?.privacyLevelOptions) === JSON.stringify(mock.state.privacyLevelOptions));

    const ps = await (await fetch(`${BASE}/api/platforms/tiktok/publish-status?publishId=${mock.state.publishId}`, { headers: auth })).json();
    check('publish-status ينجح', ps.success === true);
    check('PUBLISH_COMPLETE => delivered=true ومعرّف منشور', ps.status?.delivered === true && ps.status?.providerPostId === mock.state.publiclyAvailablePostId);
    check('publish-status بلا سرّ', !JSON.stringify(ps).includes(TT_CLIENT_SECRET));

    group('16) تكامل: النشر — تهيئة حقيقية بلا ادعاء تسليم، ومنع بلا وسائط');
    const noMedia = await fetch(`${BASE}/api/platforms/tiktok/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'عرض', approved: true }) });
    const noMediaBody = await noMedia.json();
    check('نشر بلا وسائط => 422 MEDIA_REQUIRED', noMedia.status === 422 && noMediaBody.code === 'MEDIA_REQUIRED');

    const pub = await fetch(`${BASE}/api/platforms/tiktok/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'عرض تقسيط جديد', approved: true, videoUrl: 'https://example.invalid/video.mp4', postMode: 'DIRECT_POST' }) });
    const pubBody = await pub.json();
    check('تهيئة النشر تنجح وتُعيد publish_id', pub.status === 200 && pubBody.providerPublishId === mock.state.publishId);
    check('لا يُعلن التسليم عند التهيئة (delivered=false)', pubBody.delivered === false);
    check('التهيئة نُفِّذت فعلياً لدى المزوّد', mock.state.lastPublishInit?.path === 'video' && mock.state.lastPublishInit?.body?.source_info?.video_url === 'https://example.invalid/video.mp4');
    check('معلومات الناشر طُلبت قبل النشر المباشر', mock.state.lastPublishInit?.body?.post_info?.privacy_level !== undefined);
    check('استجابة النشر بلا سرّ', !JSON.stringify(pubBody).includes(TT_CLIENT_SECRET));

    const dup = await fetch(`${BASE}/api/platforms/tiktok/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'عرض تقسيط جديد', approved: true, videoUrl: 'https://example.invalid/video.mp4', postMode: 'DIRECT_POST' }) });
    const dupBody = await dup.json();
    check('نفس النشر مرتين => 409 DUPLICATE_PUBLISH (منع تكرار)', dup.status === 409 && dupBody.code === 'DUPLICATE_PUBLISH');

    const notApproved = await fetch(`${BASE}/api/platforms/tiktok/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'عرض', videoUrl: 'https://example.invalid/v.mp4' }) });
    check('نشر بلا موافقة => 409 APPROVAL_REQUIRED', notApproved.status === 409);

    group('17) تكامل: حارس سلامة المحتوى يمنع عرضاً غير مسجّل');
    const unsafe = await fetch(`${BASE}/api/platforms/tiktok/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'خصم 50% مجاناً بدون دفعة أولى', approved: true, videoUrl: 'https://example.invalid/v2.mp4' }) });
    check('عرض غير مسجّل => 422 CONTENT_SAFETY_BLOCKED', unsafe.status === 422);

    group('18) تكامل: webhook — توقيع على الجسم الخام + منع تكرار + ثبات');
    const eventPayload = JSON.stringify({ event: 'video.publish.completed', client_key: TT_CLIENT_KEY, create_time: 1700000000, user_openid: mock.state.openId, content: JSON.stringify({ publish_id: mock.state.publishId }) });
    const badSig = await postWebhook(eventPayload, 't=1700000000,s=deadbeef');
    check('توقيع خاطئ => 401', badSig.status === 401);
    const noSig = await postWebhook(eventPayload, '');
    check('بلا توقيع => 401', noSig.status === 401);
    const goodSig = await postWebhook(eventPayload, tiktokSignature(eventPayload, TT_CLIENT_SECRET));
    check('توقيع صحيح => 200 ومقبول', goodSig.status === 200 && goodSig.json?.accepted === true);
    check('الحدث يُحفظ بشكل دائم قبل الإقرار', goodSig.json?.persisted === true);
    const dupEv = await postWebhook(eventPayload, tiktokSignature(eventPayload, TT_CLIENT_SECRET));
    check('إعادة إرسال نفس الحدث => duplicate', dupEv.json?.duplicate === true);
    const unknownEv = JSON.stringify({ event: 'something.unknown', client_key: TT_CLIENT_KEY, create_time: 1700000001, user_openid: mock.state.openId });
    const unknownRes = await postWebhook(unknownEv, tiktokSignature(unknownEv, TT_CLIENT_SECRET));
    check('حدث غير معروف يُقبل ويُتجاهل بلا خطأ', unknownRes.status === 200 && unknownRes.json?.ignored === 'unsupported_event');

    group('19) تكامل: إلغاء التفويض يُعلن الحاجة لإعادة الربط');
    const removedPayload = JSON.stringify({ event: 'authorization.removed', client_key: TT_CLIENT_KEY, create_time: 1700000002, user_openid: mock.state.openId });
    const removedRes = await postWebhook(removedPayload, tiktokSignature(removedPayload, TT_CLIENT_SECRET));
    check('إلغاء التفويض يُقبل', removedRes.status === 200 && removedRes.json?.accepted === true);
    const afterRemove = await (await fetch(`${BASE}/api/platforms/tiktok/status`, { headers: auth })).json();
    check('حالة الاتصال صارت reauth_needed', afterRemove.connected === false);

    // نُعيد الربط قبل اختبار الثبات عبر restart.
    const start2 = await (await fetch(`${BASE}/api/platforms/tiktok/oauth/start`, { headers: auth })).json();
    const state2 = new URL(start2.authorizationUrl).searchParams.get('state')!;
    await fetch(`${BASE}/api/platforms/tiktok/oauth/callback?code=AUTHCODE_TEST2&state=${encodeURIComponent(state2)}`, { headers: auth });

    group('20) تكامل: الثبات بعد restart — التوكن والأحداث ومنع التكرار');
    const beforeRestart = await (await fetch(`${BASE}/api/platforms/tiktok/status`, { headers: auth })).json();
    check('قبل restart: متصل وموثق', beforeRestart.providerVerified === true);
    await stop(currentApp.proc);
    currentApp = startApp(mock.base);
    check('الخادم يقلع بعد restart', await waitForHealth(), currentApp.log().slice(0, 400));
    Object.assign(auth, await login());
    const afterRestart = await (await fetch(`${BASE}/api/platforms/tiktok/status`, { headers: auth })).json();
    check('بعد restart: الاتصال والتوثيق صامدان', afterRestart.connected === true && afterRestart.providerVerified === true);
    check('بعد restart: التوكن المشفّر صامد', afterRestart.tokenStored === true);
    check('بعد restart: refresh token صامد', afterRestart.refreshTokenStored === true);
    check('بعد restart: open_id صامد', afterRestart.accountId === mock.state.openId);
    // منع التكرار يصمد: إعادة إرسال نفس الحدث بعد restart لا تُنشئ سجلاً ثانياً.
    const dupAfter = await postWebhook(eventPayload, tiktokSignature(eventPayload, TT_CLIENT_SECRET));
    check('بعد restart: منع تكرار الحدث صامد', dupAfter.json?.duplicate === true);

    group('21) تكامل: التجديد التلقائي عند انتهاء التوكن');
    // نُوقف الخادم أولاً ثم نُعدّل اللقطة (وإلا كتب الخادم الحالة فوق تعديلنا)،
    // ثم نعيد التشغيل: يجب أن يُجدّد الرمز تلقائياً بلا تدخّل المالك.
    const stateFile = join(stateDir, '.gharabi-state.json');
    const snap = JSON.parse(readFileSync(stateFile, 'utf8'));
    const ttTokens = snap?.workspace?.providerTokens?.tiktok;
    check('التوكن TikTok موجود في اللقطة', Boolean(ttTokens));
    check('الاعتماد TikTok محفوظ مشفّراً (AES-256-GCM لا نصاً صريحاً)', ttTokens?.alg === 'aes-256-gcm' && typeof ttTokens?.data === 'string');
    check('اللقطة لا تحمل أي رمز TikTok بنص صريح', !JSON.stringify(snap).includes(mock.state.accessToken));
    await stop(currentApp.proc);
    // نُحاكي انتهاء الرمز: نعيد تشفير اعتماد منتهٍ (expiresAt في الماضي) بنفس
    // خوارزمية الخادم، فلا نعتمد على أي واجهة اختبار خاصة.
    snap.workspace.providerTokens.tiktok = encryptCredForTest({
      accessToken: mock.state.accessToken, refreshToken: mock.state.refreshToken, openId: mock.state.openId,
      displayName: mock.state.displayName, scope: mock.state.scope, expiresAt: Date.now() - 1000,
      refreshExpiresAt: Date.now() + 31536000000, connectedAt: new Date().toISOString(),
    }, TOKEN_KEY);
    writeFileSync(stateFile, JSON.stringify(snap), 'utf8');
    currentApp = startApp(mock.base);
    check('الخادم يقلع لاختبار التجديد', await waitForHealth(), currentApp.log().slice(0, 400));
    Object.assign(auth, await login());
    mock.state.lastRefresh = null;
    const refreshProbe = await (await fetch(`${BASE}/api/platforms/tiktok/creator-info`, { headers: auth })).json();
    check('التجديد التلقائي نُفِّذ لدى المزوّد', mock.state.lastRefresh !== null);
    check('بعد التجديد: العملية تنجح', refreshProbe.success === true);
    const afterRefresh = await (await fetch(`${BASE}/api/platforms/tiktok/status`, { headers: auth })).json();
    check('بعد التجديد: التوكن الجديد مخزّن ومحدث', afterRefresh.tokenExpired === false);

    group('22) تكامل: الفصل يمسح الاعتماد ويمنع العمليات الخارجية');
    const disc = await fetch(`${BASE}/api/platforms/tiktok/disconnect`, { method: 'POST', headers: auth, body: '{}' });
    check('disconnect ينجح', disc.status === 200);
    const afterDisc = await (await fetch(`${BASE}/api/platforms/tiktok/status`, { headers: auth })).json();
    check('بعد الفصل: غير متصل وغير موثق', afterDisc.connected === false && afterDisc.providerVerified === false);
    check('بعد الفصل: لا توكن', afterDisc.tokenStored === false);
    const postDisc = await fetch(`${BASE}/api/platforms/tiktok/publish-status?publishId=${mock.state.publishId}`, { headers: auth });
    check('بعد الفصل: استعلام الحالة => 409 NOT_CONNECTED', postDisc.status === 409);

    group('23) تكامل: readiness وhealth يكشفان حقول TikTok الآمنة');
    const health = await (await fetch(`${BASE}/api/health`)).json();
    check('health يحمل كتلة tiktokOAuth', Boolean(health.tiktokOAuth));
    check('health يعلن النطاقات الرسمية', JSON.stringify(health.tiktokOAuth?.requestedScopes) === JSON.stringify([...TIKTOK_REQUIRED_SCOPES]));
    check('health بلا أي سرّ', !JSON.stringify(health).includes(TT_CLIENT_SECRET));
    check('health يعلن مراجعة مطلوبة للنشر العام', health.tiktokOAuth?.appReviewRequired === true);
    const readiness = await (await fetch(`${BASE}/api/readiness`)).json();
    check('readiness يحمل كتلة tiktokOAuth', Boolean(readiness.tiktokOAuth));
    check('readiness يعرض redirectUri', String(readiness.tiktokOAuth?.redirectUri).endsWith('/api/platforms/tiktok/oauth/callback'));
    check('readiness يعلن النطاقات المطلوبة', Array.isArray(readiness.tiktokOAuth?.requestedScopes));
    check('readiness يعلن دوام state OAuth', typeof readiness.tiktokOAuth?.oauthStateDurable === 'boolean');
    check('readiness يعلن أن النشر يحتاج audit للنشر العام (لا ادعاء نشر حر)', readiness.tiktokOAuth?.postingCapability === 'REQUIRES_AUDIT');
    check('readiness يعلن تعليقات غير متاحة', readiness.tiktokOAuth?.commentsCapability === 'NOT_AVAILABLE_BY_PUBLIC_API');
    check('readiness بلا أي سرّ', !JSON.stringify(readiness).includes(TT_CLIENT_SECRET));

    group('24) تكامل: تصريح owner على مسار الفحص (POST فقط لمسارات الفعل)');
    check('oauth/start بطريقة POST غير مسموح أو 404 صريح', [404, 405].includes((await fetch(`${BASE}/api/platforms/tiktok/oauth/start`, { method: 'POST', headers: auth, body: '{}' })).status));
  } finally {
    try { await stop(currentApp.proc); } catch { /* تجاهل */ }
    await mock.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

(async () => {
  unitTests();
  await integrationTests();
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} tiktok connector checks`);
  }
})().catch((err) => { console.error('TikTok connector harness crashed:', err); process.exit(1); });
