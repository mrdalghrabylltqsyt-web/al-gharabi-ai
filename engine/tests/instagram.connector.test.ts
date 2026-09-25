/**
 * اختبارات موصل Instagram الحقيقي — ثالث تكامل اجتماعي خارجي.
 *
 * طبقتان:
 *  1) وحدة: الدوال الحتمية (تطبيع webhook وتمييز التعليق عن الرسالة، بناء
 *     الطلبات/الحاويات، اعتماديات الصلاحيات) بلا شبكة.
 *  2) تكامل: الخادم الحقيقي مع خادم Meta Graph وهمي محلي عبر
 *     FACEBOOK_GRAPH_API_BASE، فيُختبر: OAuth (تبادل + إطالة + اكتشاف حساب IG)،
 *     إثبات اشتراك webhook، استقبال تعليق/رسالة، منع التكرار، الرد الحقيقي،
 *     الرسالة المباشرة، النشر (حاوية+نشر)، حارس السلامة، التصريح، وثبات
 *     الاستقبال وحماية التكرار بعد restart.
 *
 * لا يلمس أي مزود Meta حقيقي ولا يستهلك أي حصة، ولا يستخدم أي سرّ واقعي.
 */

import express from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHmac, createHash } from 'node:crypto';
import {
  parseInstagramWebhook,
  buildInstagramReplyBody,
  buildInstagramMessagePayload,
  buildMediaContainerBody,
  buildPublishContainerBody,
  instagramGraphUrl,
  INSTAGRAM_REQUIRED_SCOPES,
  INSTAGRAM_PERMISSION_DEPENDENCIES,
  resolveInstagramScopes,
  findMissingInstagramScopeDependencies,
  INSTAGRAM_REQUIRES_PROFESSIONAL_ACCOUNT,
} from '../social/instagram';
import { createInstagramMock, startInstagramMockServer } from './helpers/instagramMock';
import { signSession } from '../auth/sessions';

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
// نطاقات منفصلة عن Facebook/بقية الاختبارات، وتتجنّب منافذ fetch المحظورة.
const APP_PORT = 7100 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const IG_PORT = 7200 + Math.floor(Math.random() * 80);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'instagram-connector-test-secret-not-real';
const IG_APP_SECRET = 'ig_test_app_secret_not_real_1234567890';
const IG_VERIFY_TOKEN = 'ig_test_verify_token_not_real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-instagram-'));
// مفتاح تشفير ثابت طوال الجولة: إعادة تشغيل الخادم في الاختبار يجب ألا تُفقد
// التوكنات المشفّرة، وإلا صار اختبار «الثبات بعد restart» يقيس عطلاً مصطنعاً.
const TOKEN_KEY = randomBytes(32).toString('hex');

const secretBuffer = createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };
const staffUser = { id: 'staff-1', name: 'موظف اختبار', email: 'staff@example.invalid', role: 'staff', roleTitleArabic: 'الموظف', avatar: '', active: true, createdAt: new Date().toISOString() };

function startApp(igBase: string, extraEnv: Record<string, string> = {}): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    // خادم Graph وهمي محلي: لا اتصال بمزود حقيقي في الاختبارات.
    FACEBOOK_GRAPH_API_BASE: igBase,
    // حوار Meta الوهمي: فحص ما قبل التوجيه لا يلمس مزوداً حقيقياً.
    FACEBOOK_DIALOG_BASE: igBase,
    // بيانات تطبيق Meta مشتركة (Instagram يرث بيانات Facebook بديلاً).
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: IG_APP_SECRET,
    FACEBOOK_VERIFY_TOKEN: IG_VERIFY_TOKEN,
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
function signHmac(payload: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}
async function postWebhook(payload: string, signature: string) {
  const res = await fetch(`${BASE}/api/platforms/instagram/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature }, body: payload,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

function unitTests(): void {
  group('1) وحدة: تطبيع webhook — تمييز التعليق عن الرسالة عن غير المفهوم');
  const commentPayload = { object: 'instagram', entry: [{ id: 'IG1', time: 1700000000, changes: [{ field: 'comments', value: { id: 'IGC1', text: '  بكم السعر؟  ', from: { id: 'U1', username: 'ahmed' }, media: { id: 'MEDIA1' } } }] }] };
  const pc = parseInstagramWebhook(commentPayload);
  check('تعليق يُطبَّع كتعليق', pc.events.length === 1 && pc.events[0].kind === 'comment' && pc.events[0].externalId === 'IGC1');
  check('نص التعليق منظّف', pc.events[0].text === 'بكم السعر؟');
  check('هدف الرد الحقيقي للتعليق هو معرّف التعليق', (pc.events[0].replyTarget as any)?.commentId === 'IGC1');
  check('معرّف المنشور الأم محفوظ', pc.events[0].parentExternalId === 'MEDIA1');
  check('اسم المُعلّق محفوظ', pc.events[0].authorName === 'ahmed');
  check('معرّف حساب IG المهني محفوظ', pc.events[0].igAccountId === 'IG1');
  check('time يتحوّل إلى ISO', pc.events[0].createdAt === new Date(1700000000 * 1000).toISOString());

  const messagePayload = { object: 'instagram', entry: [{ id: 'IG1', messaging: [{ sender: { id: 'U9' }, recipient: { id: 'IG1' }, timestamp: 1700000000000, message: { mid: 'IGMID1', text: 'هل لديكم توصيل؟' } }] }] };
  const pm = parseInstagramWebhook(messagePayload);
  check('رسالة تُطبَّع كرسالة لا تعليق', pm.events.length === 1 && pm.events[0].kind === 'message' && pm.events[0].externalId === 'IGMID1');
  check('هدف الرد على الرسالة هو المُرسل (scoped id)', (pm.events[0].replyTarget as any)?.recipientId === 'U9');

  const storyPayload = { object: 'instagram', entry: [{ id: 'IG1', messaging: [{ sender: { id: 'U4' }, recipient: { id: 'IG1' }, timestamp: 1700000000000, message: { mid: 'S1', text: 'رد ستوري' } }] }] };
  check('رد الستوري يُطبَّع كرسالة', parseInstagramWebhook(storyPayload).events[0]?.kind === 'message');

  const otherPayload = { object: 'instagram', entry: [{ id: 'IG1', changes: [{ field: 'mentions', value: { id: 'M1' } }] }] };
  const po = parseInstagramWebhook(otherPayload);
  check('حدث غير مدعوم لا يُصنَّف تعليقاً', po.events.length === 0 && po.ignored.length >= 1);
  check('live_comments يُقبل كتعليق', parseInstagramWebhook({ object: 'instagram', entry: [{ id: 'IG1', changes: [{ field: 'live_comments', value: { id: 'LC1', text: 'تفاعل مباشر' } }] }] }).events[0]?.kind === 'comment');
  check('تعليق بلا نص لا يُنتج حدثاً', parseInstagramWebhook({ entry: [{ id: 'IG1', changes: [{ field: 'comments', value: { id: 'X' } }] }] }).events.length === 0);
  check('messaging بلا نص يُعلن متجاهلاً', parseInstagramWebhook({ entry: [{ id: 'IG1', messaging: [{ sender: { id: 'U1' }, message: { mid: 'M2' } }] }] }).events.length === 0);
  check('حمولة فارغة لا تُنتج أحداثاً', parseInstagramWebhook({}).events.length === 0);

  group('2) وحدة: بناء الطلبات والحاويات والروابط');
  check('جسم الرد يحمل message', buildInstagramReplyBody('مرحباً').get('message') === 'مرحباً');
  const msg = JSON.parse(buildInstagramMessagePayload('U9', 'أهلاً'));
  check('حمولة الرسالة تحمل recipient والنص', msg.recipient.id === 'U9' && msg.message.text === 'أهلاً');
  const imgContainer = buildMediaContainerBody({ imageUrl: 'https://x/y.jpg', caption: 'عرض' });
  check('حاوية الصورة تحمل image_url وcaption', imgContainer.ok && imgContainer.body.get('image_url') === 'https://x/y.jpg' && imgContainer.body.get('caption') === 'عرض' && imgContainer.mediaKind === 'image');
  const reelContainer = buildMediaContainerBody({ videoUrl: 'https://x/y.mp4', caption: 'ريل', reel: true });
  check('حاوية الريل تحمل media_type=REELS', reelContainer.ok && reelContainer.body.get('media_type') === 'REELS' && reelContainer.mediaKind === 'reel');
  const videoContainer = buildMediaContainerBody({ videoUrl: 'https://x/y.mp4' });
  check('حاوية الفيديو تحمل video_url بلا media_type', videoContainer.ok && videoContainer.body.get('video_url') === 'https://x/y.mp4' && videoContainer.body.get('media_type') === null && videoContainer.mediaKind === 'video');
  const textOnly = buildMediaContainerBody({ caption: 'نص فقط' });
  check('نص فقط مرفوض صراحةً (Instagram لا ينشر نصاً)', !textOnly.ok && textOnly.mediaKind === null);
  check('جسم النشر يحمل creation_id', buildPublishContainerBody('C1').get('creation_id') === 'C1');
  check('رابط Graph يستخدم القاعدة الافتراضية الرسمية', instagramGraphUrl('/me/accounts').startsWith('https://graph.facebook.com/v'));
  check('القاعدة قابلة للتجاوز في الاختبار', instagramGraphUrl('/me/accounts', 'http://127.0.0.1:9').startsWith('http://127.0.0.1:9/v'));

  group('3) وحدة: صلاحيات Instagram API with Facebook Login وأسماؤها الرسمية');
  check('الأسماء الحديثة الصحيحة مستخدمة (instagram_*)', INSTAGRAM_REQUIRED_SCOPES.includes('instagram_basic') && INSTAGRAM_REQUIRED_SCOPES.includes('instagram_manage_comments') && INSTAGRAM_REQUIRED_SCOPES.includes('instagram_manage_messages') && INSTAGRAM_REQUIRED_SCOPES.includes('instagram_content_publish'));
  check('لا تُستخدم أسماء Instagram Login (instagram_business_*) في مسار Facebook Login', !INSTAGRAM_REQUIRED_SCOPES.some((s) => s.startsWith('instagram_business_')));
  check('صلاحيات الصفحة اللازمة موجودة', ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata'].every((s) => INSTAGRAM_REQUIRED_SCOPES.includes(s)));
  check('المجموعة المطلوبة لا تكرّر أي صلاحية', new Set(INSTAGRAM_REQUIRED_SCOPES).size === INSTAGRAM_REQUIRED_SCOPES.length);
  check('لا صلاحية في المجموعة المطلوبة بلا اعتماديتها', findMissingInstagramScopeDependencies(INSTAGRAM_REQUIRED_SCOPES).length === 0, findMissingInstagramScopeDependencies(INSTAGRAM_REQUIRED_SCOPES).join(','));
  // الاعتماديات الرسمية من «Permissions Reference»: كل صلاحية instagram_* تعتمد
  // على instagram_basic وpages_read_engagement وpages_show_list — ولا تعتمد على
  // pages_manage_metadata (التي هي شرط مستقل لحقل webhook comments).
  check('رد التعليقات يعتمد رسمياً على pages_read_engagement وpages_show_list',
    (INSTAGRAM_PERMISSION_DEPENDENCIES['instagram_manage_comments'] || []).includes('pages_read_engagement') &&
    (INSTAGRAM_PERMISSION_DEPENDENCIES['instagram_manage_comments'] || []).includes('pages_show_list'));
  check('رد التعليقات لا يعلن pages_manage_metadata اعتمادية (الوثيقة الرسمية)',
    !(INSTAGRAM_PERMISSION_DEPENDENCIES['instagram_manage_comments'] || []).includes('pages_manage_metadata'));
  check('pages_manage_metadata تبقى مطلوبة لاشتراك webhook (comments)',
    INSTAGRAM_REQUIRED_SCOPES.includes('pages_manage_metadata'));
  check('business_management مطلوبة لصفحات Business Manager',
    INSTAGRAM_REQUIRED_SCOPES.includes('business_management'));
  check('لا صلاحية مطلوبة بلا استدعاء حقيقي (العدد = 9)',
    INSTAGRAM_REQUIRED_SCOPES.length === 9, INSTAGRAM_REQUIRED_SCOPES.join(','));
  const partial = resolveInstagramScopes(['instagram_manage_comments']);
  check('حلّ مجموعة جزئية يضيف instagram_basic', partial.includes('instagram_basic'));
  check('حلّ مجموعة جزئية يضيف pages_show_list', partial.includes('pages_show_list'));
  check('الاعتمادية تأتي قبل التابع', partial.indexOf('instagram_basic') < partial.indexOf('instagram_manage_comments'));
  check('الحلّ بلا تكرار', new Set(partial).size === partial.length);
  check('يُعلن صراحةً أن المسار يحتاج حساباً مهنياً لا شخصياً', INSTAGRAM_REQUIRES_PROFESSIONAL_ACCOUNT === true);
}

async function integrationTests(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser, staffUser],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: { showroom: {}, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [] },
  }), 'utf8');

  const mock = await startInstagramMockServer(IG_PORT, createInstagramMock());
  let app = startApp(mock.base);
  let currentApp = app;
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());
    const staffToken = signSession({ uid: 'staff-1', iat: Date.now(), exp: Date.now() + 3_600_000, sid: randomBytes(8).toString('hex') }, secretBuffer);
    const staffAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` };

    group('4) تكامل: التصريح — المسارات الحقيقية محمية');
    check('accounts بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/instagram/accounts`)).status === 401);
    check('reply بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/instagram/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 401);
    check('message-reply بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/instagram/message-reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 401);
    check('webhook-info بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/instagram/webhook-info`)).status === 401);
    check('webhook-info لغير المالك => 403', (await fetch(`${BASE}/api/platforms/instagram/webhook-info`, { headers: staffAuth })).status === 403);
    check('publish لغير المالك => 403', (await fetch(`${BASE}/api/platforms/instagram/publish`, { method: 'POST', headers: staffAuth, body: '{}' })).status === 403);

    group('5) تكامل: قبل الربط لا اتصال ولا رد');
    const readinessBefore = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const igBefore = readinessBefore.platforms.find((p: any) => p.platform === 'instagram');
    check('Instagram غير متصل قبل الربط', igBefore.connected === false && igBefore.providerVerified === false);
    check('Instagram يعلن موصلاً حقيقياً', igBefore.realConnector === true);
    check('Instagram يعلن آلية OAuth (لا app-registration)', igBefore.credentialMode === 'oauth2', igBefore.credentialMode);
    const replyBefore = await fetch(`${BASE}/api/platforms/instagram/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'IGC1', text: 'مرحباً' }) });
    check('لا رد قبل الاتصال => 409', replyBefore.status === 409);

    group('5ب) تكامل: حالات OAuth السلبية (state غير صالح / رفض / فشل التبادل)');
    // state غير معروف لا يقود أبداً إلى اتصال.
    const badState = await fetch(`${BASE}/api/platforms/instagram/oauth/callback?state=${encodeURIComponent('unknown-state')}&code=X`);
    check('state غير صالح => 400 بلا اتصال', badState.status === 400);
    // رفض المالك للتفويض (error من المزود) يُعلن بلا اتصال.
    const startDeny = await (await fetch(`${BASE}/api/platforms/instagram/oauth/start`, { headers: auth })).json();
    const denyState = new URL(startDeny.authorizationUrl).searchParams.get('state') || '';
    const denied = await fetch(`${BASE}/api/platforms/instagram/oauth/callback?state=${encodeURIComponent(denyState)}&error=access_denied&error_description=User+denied`);
    check('رفض التفويض => 400 بلا اتصال', denied.status === 400);
    // فشل تبادل الرمز من المزود => 502 بلا اتصال.
    const startFail = await (await fetch(`${BASE}/api/platforms/instagram/oauth/start`, { headers: auth })).json();
    const failState = new URL(startFail.authorizationUrl).searchParams.get('state') || '';
    mock.state.failTokenExchange = true;
    const exchFail = await fetch(`${BASE}/api/platforms/instagram/oauth/callback?state=${encodeURIComponent(failState)}&code=BAD`);
    mock.state.failTokenExchange = false;
    check('فشل تبادل الرمز => 502 بلا اتصال', exchFail.status === 502);
    const readinessDenied = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const igDenied = readinessDenied.platforms.find((p: any) => p.platform === 'instagram');
    check('بعد الحالات السلبية يبقى Instagram غير متصل', igDenied.connected === false && igDenied.providerVerified === false);

    group('6) تكامل: OAuth حقيقي (تبادل + إطالة + اكتشاف حساب Instagram)');
    const startRes = await (await fetch(`${BASE}/api/platforms/instagram/oauth/start`, { headers: auth })).json();
    check('بدء OAuth يعيد رابط تفويض وحالة', Boolean(startRes.authorizationUrl) && startRes.platform === 'instagram', JSON.stringify(startRes).slice(0, 200));
    const expectedRedirect = `${BASE}/api/platforms/instagram/oauth/callback`;
    check('redirect_uri المُعاد هو الرابط الفعلي بالضبط', startRes.redirectUri === expectedRedirect, `got=${startRes.redirectUri}`);
    const startedScopes = (new URL(startRes.authorizationUrl).searchParams.get('scope') || '').split(',').filter(Boolean);
    check('رابط التفويض يطلب صلاحيات Instagram الحديثة الصحيحة', startedScopes.includes('instagram_basic') && startedScopes.includes('instagram_manage_comments') && startedScopes.includes('instagram_manage_messages') && startedScopes.includes('instagram_content_publish'), startedScopes.join(','));
    check('رابط التفويض يطلب صلاحيات الصفحة اللازمة', ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata'].every((s) => startedScopes.includes(s)), startedScopes.join(','));
    check('لا اعتمادية صلاحية ناقصة في الرابط الفعلي', findMissingInstagramScopeDependencies(startedScopes).length === 0, findMissingInstagramScopeDependencies(startedScopes).join(','));
    check('لا يستخدم أسماء Instagram Login غير المطابقة للمسار', !startedScopes.some((s) => s.startsWith('instagram_business_')));
    const state = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
    check('الحالة مُولَّدة قوية', state.length >= 32);
    const cbRes = await fetch(`${BASE}/api/platforms/instagram/oauth/callback?state=${encodeURIComponent(state)}&code=TESTCODE`);
    check('callback ينجح باكتشاف الحساب المهني', cbRes.status === 200, `status=${cbRes.status}`);
    check('خادم Graph استُدعي فعلياً للتعداد والاشتراك', mock.state.calls > 0 && mock.state.lastSubscribe?.pageId === 'PAGE_IG_1');
    check('الاشتراك استُخدم بحقلي comments/messages', mock.state.lastSubscribe?.fields.includes('comments') === true && mock.state.lastSubscribe?.fields.includes('messages') === true);
    const readinessAfter = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const igAfter = readinessAfter.platforms.find((p: any) => p.platform === 'instagram');
    check('Instagram أصبح متصلاً وموثقاً', igAfter.connected === true && igAfter.providerVerified === true);
    check('لا يُعاد أي رمز صفحة في الاستجابة', !JSON.stringify(igAfter).includes('PAGE_TOKEN_TEST') && !JSON.stringify(readinessAfter).includes('IG_USER_TOKEN_TEST_LONG'));

    group('6أ) تكامل: مسار Facebook Login for Business (config_id بدل scope)');
    // Configuration ID صالح: يُمرَّر كـconfig_id ويُحذف scope تماماً من رابط التفويض
    // (إرسالهما معاً يتعارض). يبقى state وredirect_uri وresponse_type صحيحة.
    // كل خادم يستخدم نفس المنفذ، فيُوقف السابق قبل تشغيل التالي.
    const CONFIG_ID = '1003753455711313';
    await stop(app.proc);
    let cfgApp = startApp(mock.base, { INSTAGRAM_LOGIN_CONFIG_ID: CONFIG_ID });
    currentApp = cfgApp;
    check('الخادم يقلع بإعداد config_id', await waitForHealth(), cfgApp.log().slice(0, 400));
    const cfgAuth = { 'Content-Type': 'application/json' } as Record<string, string>;
    Object.assign(cfgAuth, await login());
    const cfgStart = await (await fetch(`${BASE}/api/platforms/instagram/oauth/start`, { headers: cfgAuth })).json();
    const cfgParams = new URL(cfgStart.authorizationUrl).searchParams;
    check('config_id يُرسَل إلى Meta في رابط التفويض', cfgParams.get('config_id') === CONFIG_ID, `config_id=${cfgParams.get('config_id')}`);
    check('لا يُرسَل scope مع config_id (تعارض)', cfgParams.get('scope') === null, `scope=${cfgParams.get('scope')}`);
    check('response_type=code وredirect_uri وstate صحيحة', cfgParams.get('response_type') === 'code' && cfgParams.get('redirect_uri') === expectedRedirect && (cfgParams.get('state') || '').length >= 32);
    check('الاستجابة تُعلن أن الصلاحيات من الConfiguration لا من scope', cfgStart.loginConfigIdUsed === true && cfgStart.permissionSource === 'facebook_login_for_business_configuration');
    check('الاستجابة تذكر أسماء متغيرات config_id بلا قيمة', Array.isArray(cfgStart.loginConfigEnvNames) && cfgStart.loginConfigEnvNames.includes('INSTAGRAM_LOGIN_CONFIG_ID'));
    // config_id يظهر مرة واحدة فقط: داخل authorizationUrl (لأن Meta تستقبله من
    // الرابط نفسه). لا يُصدَّر كحقل مستقل ولا يتكرر في أي حقل تشخيصي آخر.
    const cfgOccurrences = (JSON.stringify(cfgStart).match(new RegExp(CONFIG_ID, 'g')) || []).length;
    check('config_id لا يُصدَّر كحقل مستقل ولا يتكرر في التشخيص', cfgOccurrences === 1, `occurrences=${cfgOccurrences}`);
    // الأولوية: INSTAGRAM_LOGIN_CONFIG_ID يسبق FACEBOOK_LOGIN_CONFIG_ID.
    await stop(cfgApp.proc);
    const prioApp = startApp(mock.base, { INSTAGRAM_LOGIN_CONFIG_ID: CONFIG_ID, FACEBOOK_LOGIN_CONFIG_ID: '999999999999999' });
    currentApp = prioApp;
    check('الخادم يقلع لفحص الأولوية', await waitForHealth(), prioApp.log().slice(0, 400));
    const prioAuth = { 'Content-Type': 'application/json' } as Record<string, string>;
    Object.assign(prioAuth, await login());
    const prioStart = await (await fetch(`${BASE}/api/platforms/instagram/oauth/start`, { headers: prioAuth })).json();
    check('أولوية Instagram Configuration ID على Facebook', new URL(prioStart.authorizationUrl).searchParams.get('config_id') === CONFIG_ID);
    // config_id غير صالح (مسافة/حروف) => 409 تشخيصي بلا إرسال المالك إلى Meta.
    await stop(prioApp.proc);
    const badCfgApp = startApp(mock.base, { INSTAGRAM_LOGIN_CONFIG_ID: 'not-a-number ' });
    currentApp = badCfgApp;
    check('الخادم يقلع بconfig_id غير صالح', await waitForHealth(), badCfgApp.log().slice(0, 400));
    const badCfgAuth = { 'Content-Type': 'application/json' } as Record<string, string>;
    Object.assign(badCfgAuth, await login());
    const badCfg = await fetch(`${BASE}/api/platforms/instagram/oauth/start`, { headers: badCfgAuth });
    const badCfgBody = await badCfg.json();
    check('config_id غير صالح => 409 بلا إرسال المالك إلى Meta', badCfg.status === 409 && badCfgBody.code === 'LOGIN_CONFIG_ID_INVALID', JSON.stringify(badCfgBody).slice(0, 200));
    check('رسالة 409 توجّه للوحة Meta بلا قيمة سرّية', typeof badCfgBody.hint === 'string' && badCfgBody.hint.includes('Configurations') && !JSON.stringify(badCfgBody).includes('not-a-number'));
    check('الاستجابة تُعلن فحص config_id منطقياً', badCfgBody.loginConfigIdConfigured === true && badCfgBody.loginConfigIdValid === false);
    // نُعيد الخادم الأصلي (بلا config_id) لبقية الاختبارات، ونُحدّث المرجعين
    // حتى يستخدم الإغلاق في النهاية العملية الصحيحة.
    await stop(badCfgApp.proc);
    app = startApp(mock.base);
    currentApp = app;
    check('الخادم يعود للعمل بعد مسار config_id', await waitForHealth(), app.log().slice(0, 400));
    await login();

    group('6ب) تكامل: اعتماد Instagram مشفّر في المخزن ولا يظهر كنص خام');
    const stateFileAtRest = readFileSync(join(stateDir, '.gharabi-state.json'), 'utf8');
    check('ملف الحالة لا يحمل رمز الصفحة كنص خام', !stateFileAtRest.includes('PAGE_TOKEN_TEST'));
    check('ملف الحالة لا يحمل رمز المستخدم كنص خام', !stateFileAtRest.includes('IG_USER_TOKEN_TEST_LONG'));
    // المخزن يحمل كائناً مشفّراً (AES-256-GCM: alg/iv/tag/data) لا JSON صريحاً.
    const persistedState = JSON.parse(stateFileAtRest);
    const igStored = persistedState?.workspace?.providerTokens?.instagram || {};
    check('اعتماد Instagram محفوظ ككائن مشفّر', igStored?.alg === 'aes-256-gcm' && Boolean(igStored?.iv) && Boolean(igStored?.tag) && Boolean(igStored?.data));
    check('القيمة المشفّرة لا تحمل أي حقل اعتماد واضح', !JSON.stringify(igStored).includes('pageAccessToken') && !JSON.stringify(igStored).includes('PAGE_TOKEN_TEST'));
    const cpAfter = await (await fetch(`${BASE}/api/platforms/control-plane`, { headers: auth })).json();
    const igCp = cpAfter.platforms.find((p: any) => p.platform === 'instagram');
    check('الحالة التشغيلية Instagram = OPERATIONAL', igCp.state === 'OPERATIONAL', JSON.stringify(igCp).slice(0, 200));
    check('بوابة الرد على Instagram متاحة الآن', igCp.operations.find((o: any) => o.operation === 'reply')?.allowed === true);
    check('بوابة النشر على Instagram متاحة الآن', igCp.operations.find((o: any) => o.operation === 'publish')?.allowed === true);

    group('7) تكامل: إثبات اشتراك الحساب (webhook-info)');
    const info = await (await fetch(`${BASE}/api/platforms/instagram/webhook-info`, { headers: auth })).json();
    check('حالة webhook تُعلن الاشتراك الفعلي', info.appSubscribed === true && info.pageId === 'PAGE_IG_1', JSON.stringify(info).slice(0, 200));
    check('حالة webhook تعرض حساب IG المهني', info.igAccountId === '17841400000000001' && info.igUsername === 'algharabi.gallery');
    check('حالة webhook لا تكشف أي سرّ', !JSON.stringify(info).includes(IG_APP_SECRET) && !JSON.stringify(info).includes('PAGE_TOKEN_TEST') && !JSON.stringify(info).includes(IG_VERIFY_TOKEN));

    group('8) تكامل: استقبال تعليق حقيقي عبر webhook موقّع');
    const commentPayload = JSON.stringify({ object: 'instagram', entry: [{ id: '17841400000000001', time: 1700000000, changes: [{ field: 'comments', value: { id: 'IGC1', text: 'بكم سعر الثلاجة بالتقسيط؟', from: { id: 'U1', username: 'ahmed' }, media: { id: 'MEDIA1' } } }] }] });
    const badSig = await postWebhook(commentPayload, 'sha256=deadbeef');
    check('توقيع خاطئ => 401', badSig.status === 401);
    const noSig = await fetch(`${BASE}/api/platforms/instagram/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: commentPayload });
    check('توقيع غائب => 401', noSig.status === 401);
    const good = await postWebhook(commentPayload, signHmac(commentPayload, IG_APP_SECRET));
    check('توقيع صحيح => 200 ومقبول', good.status === 200 && good.json?.accepted === true && good.json?.processed === 1);
    check('الاستقبال يؤكد الكتابة الدائمة قبل الإقرار', good.json?.persisted === true);
    check('التعليق يُعلن نوعه comment', Array.isArray(good.json?.acceptedKinds) && good.json.acceptedKinds.includes('comment'));
    const comments = await (await fetch(`${BASE}/api/social/manager/comments?platform=instagram`, { headers: auth })).json();
    const c1 = comments.comments.find((c: any) => c.externalId === 'IGC1');
    check('التعليق الوارد خُزّن بمصدر webhook حقيقي', c1?.ingestSource === 'instagram_webhook' && c1?.kind === 'comment');
    check('هدف الرد الحقيقي محفوظ', c1?.replyTarget?.commentId === 'IGC1');

    group('9) تكامل: منع تكرار الحدث (replay/idempotency)');
    const replay = await postWebhook(commentPayload, signHmac(commentPayload, IG_APP_SECRET));
    check('إعادة نفس الحدث => duplicate', replay.json?.duplicates === 1 && replay.json?.processed === 0);
    const after = await (await fetch(`${BASE}/api/social/manager/comments?platform=instagram`, { headers: auth })).json();
    check('لا سجل مكرر بعد replay', after.comments.filter((c: any) => c.externalId === 'IGC1').length === 1);

    group('9ب) تكامل: التوقيع على البايتات الخام لا على إعادة التسلسل');
    const spacedPayload = '{\n  "object": "instagram",\n  "entry": [ { "id": "17841400000000001", "changes": [ { "field": "comments", "value": { "id": "IGSPACED", "text": "استفسار بصيغة مختلفة", "from": { "id": "U5", "username": "salem" } } } ] } ]\n}';
    const spaced = await postWebhook(spacedPayload, signHmac(spacedPayload, IG_APP_SECRET));
    check('توقيع مطابق للجسم الخام غير المضغوط => 200', spaced.status === 200 && spaced.json?.processed === 1, `status=${spaced.status}`);

    group('10) تكامل: استقبال رسالة Instagram منفصلة عن التعليق');
    const msgPayload = JSON.stringify({ object: 'instagram', entry: [{ id: '17841400000000001', messaging: [{ sender: { id: 'U9' }, recipient: { id: '17841400000000001' }, timestamp: 1700000000000, message: { mid: 'IGMID1', text: 'هل لديكم توصيل للمنازل؟' } }] }] });
    const msgRes = await postWebhook(msgPayload, signHmac(msgPayload, IG_APP_SECRET));
    check('رسالة موثوقة => 200 ومقبولة', msgRes.status === 200 && msgRes.json?.processed === 1);
    check('الرسالة تُعلن نوعها message', Array.isArray(msgRes.json?.acceptedKinds) && msgRes.json.acceptedKinds.includes('message'));
    const msgComment = (await (await fetch(`${BASE}/api/social/manager/comments?platform=instagram`, { headers: auth })).json()).comments.find((c: any) => c.externalId === 'IGMID1');
    check('الرسالة خُزّنت بنوع message لا comment', msgComment?.kind === 'message');
    check('هدف الرد على الرسالة هو المُرسل', msgComment?.replyTarget?.recipientId === 'U9');

    group('11) تكامل: الرد الحقيقي على تعليق + منع التكرار');
    const rep = await fetch(`${BASE}/api/platforms/instagram/reply`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ externalId: 'IGC1', text: 'أهلاً بك، شكراً لتواصلك معنا، فريق المعرض في خدمتك.', commentText: 'بكم سعر الثلاجة بالتقسيط؟' }),
    });
    const repBody = await rep.json();
    check('الرد الحقيقي على التعليق نجح', rep.status === 200 && repBody.delivered === true && repBody.simulated === false, JSON.stringify(repBody).slice(0, 200));
    check('وصل رد فعلي لخادم Graph', mock.state.commentReplies.length === 1 && mock.state.commentReplies[0].commentId === 'IGC1');
    check('الرد مُثبّت بمعرّف من Meta', Boolean(repBody.providerReplyId) && repBody.providerReplyId === mock.state.commentReplies[0].id);
    const dup = await fetch(`${BASE}/api/platforms/instagram/reply`, {
      method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'IGC1', text: 'رد ثانٍ مختلف', commentText: 'بكم سعر الثلاجة بالتقسيط؟' }),
    });
    check('الرد مرة ثانية => 409', dup.status === 409);
    check('لم يُرسل رد ثانٍ', mock.state.commentReplies.length === 1);

    group('12) تكامل: الرد الحقيقي على رسالة Instagram المباشرة');
    const mrep = await fetch(`${BASE}/api/platforms/instagram/message-reply`, {
      method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'IGMID1', text: 'نعم، لدينا توصيل داخل بغداد.', commentText: 'هل لديكم توصيل للمنازل؟' }),
    });
    const mrepBody = await mrep.json();
    check('الرد على الرسالة نجح عبر مسار message_reply', mrep.status === 200 && mrepBody.delivered === true, `status=${mrep.status} body=${JSON.stringify(mrepBody).slice(0, 240)}`);
    check('وصلت رسالة فعلية لخادم Graph', mock.state.sentMessages.length === 1 && mock.state.sentMessages[0].recipientId === 'U9');

    group('13) تكامل: حارس السلامة والتصنيف وself-authored');
    const complaintPayload = JSON.stringify({ object: 'instagram', entry: [{ id: '17841400000000001', changes: [{ field: 'comments', value: { id: 'IGC2', text: 'لدي شكوى على التأخير', from: { id: 'U2', username: 'zainab' } } }] }] });
    await postWebhook(complaintPayload, signHmac(complaintPayload, IG_APP_SECRET));
    const complaintReply = await fetch(`${BASE}/api/platforms/instagram/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'IGC2', text: 'سنحل الموضوع فوراً.', commentText: 'لدي شكوى على التأخير' }) });
    check('الشكوى => 422 مراجعة بشرية', complaintReply.status === 422);
    const askPayload = JSON.stringify({ object: 'instagram', entry: [{ id: '17841400000000001', changes: [{ field: 'comments', value: { id: 'IGC3', text: 'هل متوفر لديكم؟', from: { id: 'U3', username: 'omar' } } }] }] });
    await postWebhook(askPayload, signHmac(askPayload, IG_APP_SECRET));
    const unsafe = await fetch(`${BASE}/api/platforms/instagram/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'IGC3', text: 'السعر 150000 دينار فقط!', commentText: 'هل متوفر لديكم؟' }) });
    const unsafeBody = await unsafe.json();
    check('رد بسعر غير مسجّل => 422 محجوب', unsafe.status === 422 && unsafeBody.contentSafety?.safe === false);
    check('لم يُرسل أي رد محجوب', mock.state.commentReplies.length === 1);
    const selfPayload = JSON.stringify({ object: 'instagram', entry: [{ id: '17841400000000001', changes: [{ field: 'comments', value: { id: 'IGC4', text: 'عرض جديد اليوم', from: { id: 'U0', username: 'معرض الغرابي' } } }] }] });
    await postWebhook(selfPayload, signHmac(selfPayload, IG_APP_SECRET));
    const selfReply = await fetch(`${BASE}/api/platforms/instagram/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'IGC4', text: 'شكراً لكم', commentText: 'عرض جديد اليوم' }) });
    check('تعليق حساب المعرض => 409 (منع حلقة)', selfReply.status === 409);

    group('14) تكامل: فشل الإرسال لا يُسجَّل تسليماً');
    const invPayload = JSON.stringify({ object: 'instagram', entry: [{ id: '17841400000000001', changes: [{ field: 'comments', value: { id: 'IGC5', text: 'هل لديكم أجهزة؟', from: { id: 'U7', username: 'layla' } } }] }] });
    await postWebhook(invPayload, signHmac(invPayload, IG_APP_SECRET));
    mock.state.failCommentReply = true;
    const failed = await fetch(`${BASE}/api/platforms/instagram/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'IGC5', text: 'أهلاً بك، فريق المعرض في خدمتك.', commentText: 'هل لديكم أجهزة؟' }) });
    const failedBody = await failed.json();
    check('فشل Meta => 502', failed.status === 502, `status=${failed.status}`);
    check('فشل Meta لا يُعلن تسليماً', failedBody.delivered === false && failedBody.reply?.delivered === false);
    check('فشل Meta يخزّن سبباً حقيقياً', typeof failedBody.reply?.deliveryError === 'string' && failedBody.reply?.reviewStatus === 'failed');
    mock.state.failCommentReply = false;

    group('15) تكامل: لا رد بلا تعليق حقيقي');
    const unknown = await fetch(`${BASE}/api/platforms/instagram/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'IGC999', text: 'مرحبا' }) });
    check('لا إرسال بلا تعليق حقيقي => 404', unknown.status === 404);
    const unknownMsg = await fetch(`${BASE}/api/platforms/instagram/message-reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'IGMID999', text: 'مرحبا' }) });
    check('لا إرسال رسالة بلا رسالة حقيقية => 404', unknownMsg.status === 404);

    group('16) تكامل: نشر Instagram الحقيقي (حاوية + نشر)');
    const pubNoMedia = await fetch(`${BASE}/api/platforms/instagram/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'عرض تقسيط جديد', approved: true }) });
    const pubNoMediaBody = await pubNoMedia.json();
    check('النشر بلا وسائط مرفوض صراحةً (Instagram لا ينشر نصاً)', pubNoMedia.status === 422 && pubNoMediaBody.code === 'MEDIA_REQUIRED', JSON.stringify(pubNoMediaBody).slice(0, 200));
    const pub = await fetch(`${BASE}/api/platforms/instagram/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'عرض تقسيط جديد من معرض الغرابي.', imageUrl: 'https://example.invalid/p.jpg', approved: true }) });
    const pubBody = await pub.json();
    check('النشر بالصورة نجح بمعرّف من Meta', pub.status === 200 && Boolean(pubBody.providerPostId) && mock.state.published.length === 1, JSON.stringify(pubBody).slice(0, 240));
    check('الحاوية أُنشئت ثم نُشرت بمعرّفيها', mock.state.containers.length === 1 && mock.state.published[0].creationId === mock.state.containers[0].containerId);
    const pubFail = await (async () => { mock.state.failPublishStep = true; const r = await fetch(`${BASE}/api/platforms/instagram/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'x', videoUrl: 'https://example.invalid/v.mp4', approved: true }) }); mock.state.failPublishStep = false; return r; })();
    check('فشل خطوة النشر => 502 بلا معرّف مزود', pubFail.status === 502);

    group('17) تكامل: ثبات الاستقبال وحماية التكرار بعد restart');
    await stop(app.proc);
    currentApp = startApp(mock.base);
    check('الخادم يقلع بعد إعادة التشغيل', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const persisted = await (await fetch(`${BASE}/api/social/manager/comments?platform=instagram`, { headers: auth })).json();
    const pC1 = persisted.comments.find((c: any) => c.externalId === 'IGC1');
    check('التعليق يصمد بعد restart', Boolean(pC1) && pC1.ingestSource === 'instagram_webhook');
    check('هدف الرد يصمد بعد restart', pC1?.replyTarget?.commentId === 'IGC1');
    const replayAfter = await postWebhook(commentPayload, signHmac(commentPayload, IG_APP_SECRET));
    check('منع التكرار يصمد بعد restart', replayAfter.json?.duplicates === 1 && replayAfter.json?.processed === 0);
    const readinessRestart = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const igRestart = readinessRestart.platforms.find((p: any) => p.platform === 'instagram');
    check('اتصال Instagram الموثق يصمد بعد restart', igRestart.connected === true && igRestart.providerVerified === true);

    // سيناريو تعدد الصفحات مع حساب Instagram: OAuth ينجح لكنه يتوقف عند اختيار
    // الحساب. المسار كامل: pending → accounts → select-account → connected.
    group('18) تكامل: حساب يدير أكثر من صفحة لها حساب Instagram (اختيار الحساب)');
    await stop(currentApp.proc);
    writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
      schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser, staffUser],
      revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
      workspace: { showroom: {}, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [] },
    }), 'utf8');
    const multiMock = await startInstagramMockServer(IG_PORT + 1, createInstagramMock({
      accounts: [
        { pageId: 'PAGE_A', pageName: 'معرض الغرابي للتقسيط', pageAccessToken: 'PAGE_TOKEN_A', igAccountId: '17841400000000001', igUsername: 'algharabi.gallery' },
        { pageId: 'PAGE_B', pageName: 'صفحة ثانية', pageAccessToken: 'PAGE_TOKEN_B', igAccountId: '17841400000000002', igUsername: 'second.account' },
      ],
    }));
    currentApp = startApp(multiMock.base);
    check('الخادم يقلع لسيناريو الحسابات المتعددة', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const multiStart = await (await fetch(`${BASE}/api/platforms/instagram/oauth/start`, { headers: auth })).json();
    const multiState = new URL(multiStart.authorizationUrl).searchParams.get('state') || '';
    const multiCb = await fetch(`${BASE}/api/platforms/instagram/oauth/callback?state=${encodeURIComponent(multiState)}&code=MULTI`);
    check('callback بحساب متعدد الحسابات ينجح (يوقف عند الاختيار)', multiCb.status === 200, `status=${multiCb.status}`);
    const multiCp = await (await fetch(`${BASE}/api/platforms/control-plane`, { headers: auth })).json();
    const multiCpIg = multiCp.platforms.find((p: any) => p.platform === 'instagram');
    check('اللوحة تُعلن انتظار اختيار الحساب صراحةً', multiCpIg.pageSelectionPending === true, JSON.stringify(multiCpIg).slice(0, 200));
    const accountsRes = await (await fetch(`${BASE}/api/platforms/instagram/accounts`, { headers: auth })).json();
    check('جلب الحسابات يعيد الحسابين بلا أي رمز', accountsRes.accounts?.length === 2 && !JSON.stringify(accountsRes).includes('PAGE_TOKEN'));
    const sel = await fetch(`${BASE}/api/platforms/instagram/select-account`, { method: 'POST', headers: auth, body: JSON.stringify({ pageId: 'PAGE_A' }) });
    const selBody = await sel.json();
    check('اختيار الحساب يُثبته ويشترك في webhook', sel.status === 200 && selBody.success === true && selBody.webhookSubscribed === true, JSON.stringify(selBody).slice(0, 200));
    const multiAfter = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const multiIgAfter = multiAfter.platforms.find((p: any) => p.platform === 'instagram');
    check('Instagram يصبح متصلاً وموثقاً بعد اختيار الحساب', multiIgAfter.connected === true && multiIgAfter.providerVerified === true);
    await multiMock.stop();

    // سيناريو حساب بلا حساب Instagram مهني مرتبط: يجب ألا يُعلن اتصالاً، وأن
    // يُعلن السبب صراحةً (حساب شخصي أو صفحة بلا حساب مهني).
    group('19) تكامل: صفحة بلا حساب Instagram مهني لا تُربط (لا حساب شخصي)');
    await stop(currentApp.proc);
    writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
      schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser, staffUser],
      revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
      workspace: { showroom: {}, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [] },
    }), 'utf8');
    const noIgMock = await startInstagramMockServer(IG_PORT + 2, createInstagramMock({
      accounts: [{ pageId: 'PAGE_NO_IG', pageName: 'صفحة بلا إنستغرام', pageAccessToken: 'PAGE_TOKEN_X', igAccountId: null, igUsername: null }],
    }));
    currentApp = startApp(noIgMock.base);
    check('الخادم يقلع لسيناريو صفحة بلا حساب مهني', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const noIgStart = await (await fetch(`${BASE}/api/platforms/instagram/oauth/start`, { headers: auth })).json();
    const noIgState = new URL(noIgStart.authorizationUrl).searchParams.get('state') || '';
    const noIgCb = await fetch(`${BASE}/api/platforms/instagram/oauth/callback?state=${encodeURIComponent(noIgState)}&code=NOIG`);
    check('callback يرفض صفحة بلا حساب مهني => 502', noIgCb.status === 502, `status=${noIgCb.status}`);
    const noIgReadiness = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const noIgRow = noIgReadiness.platforms.find((p: any) => p.platform === 'instagram');
    check('لا يُعلن Instagram متصلاً بلا حساب مهني', noIgRow.connected === false && noIgRow.providerVerified === false);
    await noIgMock.stop();

    // فحص الحوار: Meta ترد على رابط التفويض بـPLATFORM__INVALID_APP_ID — يجب
    // ألا يُرسَل المالك إلى «حدث خطأ ما» بل تُعلن السبب الدقيق.
    group('20) تكامل: فحص الحوار يمنع إرسال المالك إلى «حدث خطأ ما»');
    await stop(currentApp.proc);
    const dlgMock = await startInstagramMockServer(IG_PORT + 3, createInstagramMock({ dialogOutcome: 'invalid_app_id' }));
    currentApp = startApp(dlgMock.base);
    check('الخادم يقلع لفحص الحوار', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const dlgBlocked = await fetch(`${BASE}/api/platforms/instagram/oauth/start`, { headers: auth });
    const dlgBody: any = await dlgBlocked.json();
    check('فحص الحوار يرفض بـ409 بدل التوجيه', dlgBlocked.status === 409, `status=${dlgBlocked.status}`);
    check('الرمز يعلن PLATFORM__INVALID_APP_ID', dlgBody.code === 'META_DIALOG_PLATFORM__INVALID_APP_ID', `code=${dlgBody.code}`);
    check('لا يُعاد رابط تفويض عند رفض الحوار', !dlgBody.authorizationUrl);
    check('التوجيه يحمل رابط الإرجاع المطلوب', dlgBody.redirectUri === `${BASE}/api/platforms/instagram/oauth/callback`);
    check('التوجيه بلا أي سرّ', !JSON.stringify(dlgBody).includes('test-fb-client-secret'));
    await dlgMock.stop();

    // حوار مقبول: لا حجب.
    group('21) تكامل: حوار مقبول لا يُحجب (Instagram)');
    await stop(currentApp.proc);
    const okMock = await startInstagramMockServer(IG_PORT + 4, createInstagramMock({ dialogOutcome: 'consent' }));
    currentApp = startApp(okMock.base);
    check('الخادم يقلع لحوار مقبول', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const okStart = await fetch(`${BASE}/api/platforms/instagram/oauth/start`, { headers: auth });
    const okBody: any = await okStart.json();
    check('حوار مقبول => 200 ورابط تفويض', okStart.status === 200 && typeof okBody.authorizationUrl === 'string', `status=${okStart.status}`);
    check('الفحص استدعى الحوار فعلياً', okMock.state.calls >= 2, `calls=${okMock.state.calls}`);
    await okMock.stop();
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
    console.log(`PASSED: ${passed} instagram connector checks`);
  }
})().catch((err) => { console.error('Instagram connector harness crashed:', err); process.exit(1); });
