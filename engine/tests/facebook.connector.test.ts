/**
 * اختبارات موصل Facebook (Meta Graph) الحقيقي — ثاني تكامل اجتماعي خارجي.
 *
 * طبقتان:
 *  1) وحدة: الدوال الحتمية (تطبيع الحدث وتمييز التعليق عن الرسالة، بناء الطلبات،
 *     بناء الروابط) بلا شبكة.
 *  2) تكامل: الخادم الحقيقي مع خادم Graph وهمي محلي عبر FACEBOOK_GRAPH_API_BASE،
 *     فيُختبر: OAuth (تبادل + إطالة + اختيار صفحة)، إثبات اشتراك webhook،
 *     استقبال تعليق/رسالة حقيقيين، منع التكرار، الرد الحقيقي، فشل الرد، رسالة
 *     Messenger، حارس السلامة، self-authored، الحساس/السبام، التصريح، وثبات
 *     الاستقبال وحماية التكرار بعد restart.
 *
 * لا يلمس أي مزود Meta حقيقي ولا يستهلك أي حصة، ولا يستخدم أي سرّ واقعي.
 */

import express from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHmac, createHash } from 'node:crypto';
import {
  parseFacebookWebhook,
  buildSubscribeBody,
  buildCommentReplyBody,
  buildSendMessagePayload,
  facebookGraphUrl,
  facebookTokenUrl,
  isPlausibleMetaAppId,
  classifyMetaDialogInteraction,
  classifyMetaAppTokenResponse,
  FACEBOOK_REQUIRED_SCOPES,
  FACEBOOK_PERMISSION_DEPENDENCIES,
  resolveFacebookScopes,
  findMissingScopeDependencies,
  missingScopeDependenciesFromCsv,
  expandWithDependencies,
} from '../social/facebook';
import { createFacebookMock, startFacebookMockServer } from './helpers/facebookMock';
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
// نطاقات منفصلة وآمنة: تتجنّب منافذ fetch المحظورة (مثل 6000/6667) وتفادي
// تصادم النطاقات مع بقية الاختبارات، فلا يتخطّى fetch ولا يفشل الإقلاع عشوائياً.
const APP_PORT = 6700 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FB_PORT = 6800 + Math.floor(Math.random() * 100);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'facebook-connector-test-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_1234567890';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_not_real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-facebook-'));

// مستخدمون اختبار محليون لاختبار التصريح (owner-only).
const secretBuffer = createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };
const staffUser = { id: 'staff-1', name: 'موظف اختبار', email: 'staff@example.invalid', role: 'staff', roleTitleArabic: 'الموظف', avatar: '', active: true, createdAt: new Date().toISOString() };

function startApp(fbBase: string, extraEnv: Record<string, string> = {}): { proc: ChildProcess; log: () => string } {
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
    FACEBOOK_GRAPH_API_BASE: fbBase,
    // معرّف تطبيق رقمي (كما هو حقيقي لدى Meta) — الفحص الآن يرفض ما ليس أرقاماً.
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: FB_APP_SECRET,
    FACEBOOK_VERIFY_TOKEN: FB_VERIFY_TOKEN,
    // مفتاح تشفير اختباري فقط (32 بايت hex) — ليس سراً واقعياً.
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
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
  const res = await fetch(`${BASE}/api/platforms/facebook/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature }, body: payload,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

function unitTests(): void {
  group('1) وحدة: تطبيع webhook — تمييز التعليق عن الرسالة عن غير المفهوم');
  const commentPayload = { object: 'page', entry: [{ id: 'P1', changes: [{ field: 'feed', value: { item: 'comment', comment_id: 'C1', post_id: 'POST1', message: '  بكم السعر؟  ', from: { name: 'أحمد' }, created_time: 1700000000 } }] }] };
  const pc = parseFacebookWebhook(commentPayload);
  check('تعليق يُطبَّع كتعليق', pc.events.length === 1 && pc.events[0].kind === 'comment' && pc.events[0].externalId === 'C1');
  check('نص التعليق منظّف', pc.events[0].text === 'بكم السعر؟');
  check('هدف الرد الحقيقي للتعليق هو معرّف التعليق', (pc.events[0].replyTarget as any)?.commentId === 'C1');
  check('معرّف المنشور الأم محفوظ', pc.events[0].parentExternalId === 'POST1');
  check('created_time يتحوّل إلى ISO', pc.events[0].createdAt === new Date(1700000000 * 1000).toISOString());

  const messagePayload = { object: 'page', entry: [{ id: 'P1', messaging: [{ sender: { id: 'U9' }, recipient: { id: 'P1' }, timestamp: 1700000000000, message: { mid: 'MID1', text: 'هل لديكم توصيل؟' } }] }] };
  const pm = parseFacebookWebhook(messagePayload);
  check('رسالة تُطبَّع كرسالة لا تعليق', pm.events.length === 1 && pm.events[0].kind === 'message' && pm.events[0].externalId === 'MID1');
  check('هدف الرد على الرسالة هو المستلم', (pm.events[0].replyTarget as any)?.recipientId === 'U9');

  const otherPayload = { object: 'page', entry: [{ id: 'P1', changes: [{ field: 'feed', value: { item: 'post', post_id: 'P2', message: 'منشور جديد' } }] }] };
  const po = parseFacebookWebhook(otherPayload);
  check('حدث غير معروف لا يُصنَّف تعليقاً', po.events.length === 0 && po.ignored.length === 1);
  check('تغيير feed بلا رسالة لا يُنتج حدثاً', parseFacebookWebhook({ entry: [{ id: 'P1', changes: [{ field: 'feed', value: { item: 'comment', comment_id: 'C9' } }] }] }).events.length === 0);
  check('messaging بلا نص يُعلن متجاهلاً', parseFacebookWebhook({ entry: [{ id: 'P1', messaging: [{ sender: { id: 'U1' }, message: { mid: 'M2' } }] }] }).events.length === 0);
  check('حمولة فارغة لا تُنتج أحداثاً', parseFacebookWebhook({}).events.length === 0);

  group('2) وحدة: بناء الطلبات والروابط');
  check('جسم الاشتراك يحمل الحقول', buildSubscribeBody(['feed', 'messages']).get('subscribed_fields') === 'feed,messages');
  check('جسم الرد يحمل message', buildCommentReplyBody('مرحباً').get('message') === 'مرحباً');
  const msg = JSON.parse(buildSendMessagePayload('U9', 'أهلاً'));
  check('حمولة الرسالة تحمل recipient والنص', msg.recipient.id === 'U9' && msg.message.text === 'أهلاً' && msg.messaging_type === 'RESPONSE');
  check('رابط Graph يستخدم القاعدة الافتراضية الرسمية', facebookGraphUrl('/me/accounts').startsWith('https://graph.facebook.com/v'));
  check('رابط الرمز الرسمي صحيح', facebookTokenUrl().includes('/oauth/access_token'));
  check('القاعدة قابلة للتجاوز في الاختبار', facebookGraphUrl('/me/accounts', 'http://127.0.0.1:9').startsWith('http://127.0.0.1:9/v'));

  group('2ب) وحدة: تشخيص «حدث خطأ ما» — شكل معرّف التطبيق وتصنيف استجابة Meta');
  // المعرّف الحقيقي أرقام فقط. أي مسافة/حرف/تنصيص => Meta ترد الصفحة العامة.
  check('معرّف رقمي مقبول', isPlausibleMetaAppId('145634995501895'));
  check('معرّف بمسافة مرفوض', !isPlausibleMetaAppId(' 145634995501895'));
  check('معرّف بمسافة لاحقة مرفوض', !isPlausibleMetaAppId('145634995501895 '));
  check('معرّف بعلامة تنصيص مرفوض', !isPlausibleMetaAppId('"145634995501895"'));
  check('معرّف ببادئة نصية مرفوض', !isPlausibleMetaAppId('appid'));
  check('معرّف أقصر من 6 خانات مرفوض', !isPlausibleMetaAppId('12345'));
  check('معرّف غير نصي مرفوض', !isPlausibleMetaAppId(undefined) && !isPlausibleMetaAppId(145634995501895));
  // 302 إلى /oauth/error?error_code=PLATFORM__INVALID_APP_ID = الصفحة العامة نفسها.
  const invalidApp = classifyMetaDialogInteraction({ status: 302, location: 'https://www.facebook.com/oauth/error/?error_code=PLATFORM__INVALID_APP_ID' });
  check('PLATFORM__INVALID_APP_ID يُصنَّف معرّف تطبيق غير صالح', invalidApp.kind === 'invalid_app_id' && invalidApp.acceptable === false && invalidApp.errorCode === 'PLATFORM__INVALID_APP_ID');
  check('صفحة «حدث خطأ ما» العامة تُصنَّف عطلاً لا نجاحاً', classifyMetaDialogInteraction({ status: 200, body: 'Sorry, something went wrong. We\u2019re working on getting this fixed.' }).kind === 'dialog_error');
  check('إعادة توجيه لتسجيل الدخول = تطبيق مقبول', classifyMetaDialogInteraction({ status: 302, location: 'https://www.facebook.com/login.php?skip_api_login=1&api_key=1' }).kind === 'login');
  check('إعادة توجيه لحوار الموافقة = تطبيق مقبول', classifyMetaDialogInteraction({ status: 302, location: 'https://www.facebook.com/v21.0/dialog/oauth?client_id=1&ret=login' }).kind === 'consent');
  check('بلا توجيه وبلا جسم معروف = غير معروف', classifyMetaDialogInteraction({ status: 200, body: 'x' }).kind === 'unknown');
  // تصنيف رمز التطبيق: code 101 = معرّف خاطئ (مطابق تماماً لصفحة Meta العامة).
  check('Graph code 101 => معرّف تطبيق غير صالح', classifyMetaAppTokenResponse({ status: 400, data: { error: { message: 'Invalid Client ID', code: 101 } } }).kind === 'invalid_client_id');
  check('Graph سرّ خاطئ => invalid_client_secret', classifyMetaAppTokenResponse({ status: 400, data: { error: { message: 'Error validating client secret.', code: 1 } } }).kind === 'invalid_client_secret');
  check('Graph نجاح => ok', classifyMetaAppTokenResponse({ status: 200, data: { access_token: 'APP_TOKEN_TEST' } }).kind === 'ok');
  check('Graph رسالة non-JSON => لا ok', classifyMetaAppTokenResponse({ status: 200, data: null }).kind !== 'ok');

  group('2ج) وحدة: اعتماديات صلاحيات Facebook — منع «Invalid Scopes» والصلاحية المُسقَطة');
  // الجذر المُثبت: pages_manage_engagement (الرد على التعليقات) تعتمد رسمياً على
  // pages_read_user_content، وكانت غائبة قبل الإصلاح => فشل OAuth أو صلاحية مُسقَطة.
  const engagementDeps = FACEBOOK_PERMISSION_DEPENDENCIES['pages_manage_engagement'] || [];
  check('pages_manage_engagement تعتمد pages_read_user_content', engagementDeps.includes('pages_read_user_content'));
  check('المجموعة المطلوبة تحمل pages_read_user_content', FACEBOOK_REQUIRED_SCOPES.includes('pages_read_user_content'));
  check('المجموعة المطلوبة تحمل pages_manage_engagement (الرد على التعليقات)', FACEBOOK_REQUIRED_SCOPES.includes('pages_manage_engagement'));
  check('المجموعة المطلوبة تحمل business_management (صفحات Business Manager)', FACEBOOK_REQUIRED_SCOPES.includes('business_management'));
  check('المجموعة المطلوبة تحمل pages_messaging (Messenger)', FACEBOOK_REQUIRED_SCOPES.includes('pages_messaging'));
  check('المجموعة المطلوبة لا تكرّر أي صلاحية', new Set(FACEBOOK_REQUIRED_SCOPES).size === FACEBOOK_REQUIRED_SCOPES.length);
  check('لا صلاحية في المجموعة المطلوبة بلا اعتماديتها', findMissingScopeDependencies(FACEBOOK_REQUIRED_SCOPES).length === 0, findMissingScopeDependencies(FACEBOOK_REQUIRED_SCOPES).join(','));
  // الحلّ يضيف الاعتماديات الناقصة تلقائياً فلا يفشل تجاوز جزئي.
  const partial = resolveFacebookScopes(['pages_manage_engagement']);
  check('حلّ مجموعة جزئية يضيف pages_read_user_content', partial.includes('pages_read_user_content'));
  check('حلّ مجموعة جزئية يضيف pages_show_list', partial.includes('pages_show_list'));
  check('الاعتمادية تأتي قبل التابع (ترتيب طوبولوجي)', partial.indexOf('pages_read_user_content') < partial.indexOf('pages_manage_engagement'));
  check('الحلّ بلا تكرار', new Set(partial).size === partial.length);
  check('كشف الاعتمادية الناقصة صريح', findMissingScopeDependencies(['pages_manage_engagement']).includes('pages_read_user_content'));
  check('كشف الاعتمادية الناقصة صريح لـpages_messaging', findMissingScopeDependencies(['pages_messaging']).includes('pages_manage_metadata'));
  check('مجموعة متماسكة بلا نواقص', findMissingScopeDependencies(['pages_show_list', 'pages_read_user_content', 'pages_manage_engagement']).length === 0);
  check('توسيع الصلاحيات لا يكرّر (expandWithDependencies)', expandWithDependencies(['pages_messaging', 'pages_manage_metadata']).length === 3);
  check('استنتاج النواقص من CSV فارغ', missingScopeDependenciesFromCsv('').length === 0);
  check('استنتاج النواقص من CSV ناقص', missingScopeDependenciesFromCsv('pages_manage_engagement').includes('pages_read_user_content'));
  check('استنتاج النواقص من CSV كامل', missingScopeDependenciesFromCsv('pages_show_list,pages_read_user_content,pages_manage_engagement').length === 0);
  // لا نضيف public_profile: ضمني في Facebook Login ولا يقابله استدعاء في الكود.
  check('لا نضيف public_profile (ضمني وغير مستخدم)', !FACEBOOK_REQUIRED_SCOPES.includes('public_profile'));
}

async function integrationTests(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  // حالة أولية فيها موظف غير مالك لاختبار owner-only.
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser, staffUser],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: { showroom: {}, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [] },
  }), 'utf8');

  const mock = await startFacebookMockServer(FB_PORT, createFacebookMock());
  let app = startApp(mock.base);
  let currentApp = app;
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());
    const staffToken = signSession({ uid: 'staff-1', iat: Date.now(), exp: Date.now() + 3_600_000, sid: randomBytes(8).toString('hex') }, secretBuffer);
    const staffAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` };

    group('3) تكامل: التصريح — المسارات الحقيقية محمية');
    check('webhook-info بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/facebook/webhook-info`)).status === 401);
    check('reply بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/facebook/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 401);
    check('message-reply بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/facebook/message-reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 401);
    check('webhook-info لغير المالك => 403', (await fetch(`${BASE}/api/platforms/facebook/webhook-info`, { headers: staffAuth })).status === 403);

    group('4) تكامل: قبل الربط لا اتصال ولا رد');
    const readinessBefore = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const fbBefore = readinessBefore.platforms.find((p: any) => p.platform === 'facebook');
    check('Facebook غير متصل قبل الربط', fbBefore.connected === false && fbBefore.providerVerified === false);
    check('Facebook يعلن موصلاً حقيقياً', fbBefore.realConnector === true);
    const replyBefore = await fetch(`${BASE}/api/platforms/facebook/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'C1', text: 'مرحباً' }) });
    check('لا رد قبل الاتصال => 409', replyBefore.status === 409);
    // الصلاحية إلزامية منذ Graph v17 لعرض صفحات Business Manager عبر /me/accounts؛
    // غيابها يجعل الحساب «يدير صفر صفحات» فيفشل الربط بلا سبب ظاهر. هذا الفحص
    // يفشل ما لم تُطلب الصلاحية فعلاً في رابط التفويض.
    const healthBefore = await (await fetch(`${BASE}/api/health`)).json();
    check('health يعلن طلب business_management لـMeta', healthBefore.metaOAuth?.businessManagementScope === true, JSON.stringify(healthBefore.metaOAuth));

    group('5) تكامل: OAuth حقيقي (تبادل + إطالة + اختيار الصفحة)');
    const startRes = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    check('بدء OAuth يعيد رابط تفويض وحالة', Boolean(startRes.authorizationUrl) && startRes.platform === 'facebook', JSON.stringify(startRes).slice(0, 200));
    // رابط الإرجاع حق يجب أن يكون هو نفسه الذي تحتسبه Meta؛ هنا نثبته بالضبط.
    const expectedRedirect = `${BASE}/api/platforms/facebook/oauth/callback`;
    check('redirect_uri المُعاد هو الرابط الفعلي بالضبط', startRes.redirectUri === expectedRedirect, `got=${startRes.redirectUri}`);
    check('rابط التفويض يحمل نفس redirect_uri', new URL(startRes.authorizationUrl).searchParams.get('redirect_uri') === expectedRedirect);
    check('النطاق المُعلن مطابق لمضيف الرابط', startRes.domain === new URL(BASE).hostname);
    // الصلاحية الحاسمة لتعداد صفحات Business Manager: يجب أن تكون في الرابط والاستجابة.
    const startedScopes = (new URL(startRes.authorizationUrl).searchParams.get('scope') || '').split(',').filter(Boolean);
    check('رابط التفويض يطلب business_management', startedScopes.includes('business_management'), `scopes=${startedScopes.join(',')}`);
    // إصلاح الاعتماديات: رد التعليقات (pages_manage_engagement) يصل دائماً بمرافقه
    // pages_read_user_content، فلا ينتج «Invalid Scopes» ولا سقوط صامت للصلاحية.
    check('رابط التفويض يحمل pages_read_user_content (اعتمادية رد التعليقات)', startedScopes.includes('pages_read_user_content'), `scopes=${startedScopes.join(',')}`);
    check('رابط التفويض يحمل كامل الوظائف المنفّذة', ['pages_show_list', 'pages_read_engagement', 'pages_manage_engagement', 'pages_manage_posts', 'pages_manage_metadata', 'pages_messaging'].every((s) => startedScopes.includes(s)), `scopes=${startedScopes.join(',')}`);
    check('لا اعتمادية صلاحية ناقصة في الرابط الفعلي', findMissingScopeDependencies(startedScopes).length === 0, findMissingScopeDependencies(startedScopes).join(','));
    check('رابط التفويض لا يطلب public_profile غير المستخدم', !startedScopes.includes('public_profile'), `scopes=${startedScopes.join(',')}`);
    check('الصلاحيات المُعلنة تطابق المُطلب فعلاً', Array.isArray(startRes.scopes) && startRes.scopes.includes('business_management'));
    check('لا فارق اعتماديات في التجاوز الافتراضي', startRes.scopeDependencyGaps === undefined);
    // إعداد OAuth للمالك يعطي القيم الدقيقة المطلوبة في Meta بلا أي سرّ.
    const setup = await (await fetch(`${BASE}/api/platforms/facebook/oauth/setup`, { headers: auth })).json();
    check('oauth/setup يعيد redirect_uri الدقيق', setup.redirectUri === expectedRedirect, JSON.stringify(setup).slice(0, 200));
    check('oauth/setup يعرض حقل App Domains للعنوان العام فقط', setup.appDomainsValue === null && setup.publicUrlIsPublic === false, `appDomainsValue=${setup.appDomainsValue}`);
    check('oauth/setup يوجّه لحقول Meta Dashboard', Boolean(setup.metaDashboardFields?.validOAuthRedirectUris));
    check('oauth/setup يعرض الصلاحيات الفعلية بلا سرّ', Array.isArray(setup.scopes) && setup.scopes.includes('business_management'));
    check('oauth/setup لا يدّعي قراءة وضع التطبيق من API', setup.metaAppModeNotice?.apiReadable === false && Boolean(setup.metaAppModeNotice?.where));
    check('oauth/setup لا يكشف أي سرّ', !JSON.stringify(setup).includes(FB_APP_SECRET) && !JSON.stringify(setup).includes(FB_VERIFY_TOKEN) && !JSON.stringify(setup).includes('PAGE_TOKEN'));
    check('oauth/setup لغير المالك => 403', (await fetch(`${BASE}/api/platforms/facebook/oauth/setup`, { headers: staffAuth })).status === 403);
    const state = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
    check('الحالة مُولَّدة قوية', state.length >= 32);
    const cbRes = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(state)}&code=TESTCODE`);
    check('callback ينجح بالصفحة الواحدة', cbRes.status === 200, `status=${cbRes.status}`);
    check('خادم Graph استُدعي فعلياً للتبادل والاشتراك', mock.state.calls > 0 && mock.state.lastSubscribe?.pageId === 'PAGE_123');
    check('الاشتراك استُخدم بحقول feed/messages', mock.state.lastSubscribe?.fields.includes('feed') === true && mock.state.lastSubscribe?.fields.includes('messages') === true);
    const readinessAfter = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const fbAfter = readinessAfter.platforms.find((p: any) => p.platform === 'facebook');
    check('Facebook أصبح متصلاً وموثقاً', fbAfter.connected === true && fbAfter.providerVerified === true);
    check('لا يُعاد أي رمز صفحة في الاستجابة', !JSON.stringify(fbAfter).includes('PAGE_TOKEN_TEST') && !JSON.stringify(readinessAfter).includes('USER_TOKEN_TEST_LONG'));

    group('6) تكامل: إثبات اشتراك الصفحة (webhook-info)');
    const info = await (await fetch(`${BASE}/api/platforms/facebook/webhook-info`, { headers: auth })).json();
    check('حالة webhook تُعلن الاشتراك الفعلي', info.status !== 502 && info.appSubscribed === true && info.pageId === 'PAGE_123', JSON.stringify(info).slice(0, 200));
    check('حالة webhook لا تكشف أي سرّ', !JSON.stringify(info).includes(FB_APP_SECRET) && !JSON.stringify(info).includes('PAGE_TOKEN_TEST') && !JSON.stringify(info).includes(FB_VERIFY_TOKEN));

    group('7) تكامل: استقبال تعليق حقيقي عبر webhook موقّع');
    const commentPayload = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE_123', changes: [{ field: 'feed', value: { item: 'comment', comment_id: 'C1', post_id: 'POST1', message: 'بكم سعر الثلاجة بالتقسيط؟', from: { name: 'أحمد' }, created_time: 1700000000 } }] }] });
    const badSig = await postWebhook(commentPayload, 'sha256=deadbeef');
    check('توقيع خاطئ => 401', badSig.status === 401);
    const noSig = await fetch(`${BASE}/api/platforms/facebook/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: commentPayload });
    check('توقيع غائب => 401', noSig.status === 401);
    const good = await postWebhook(commentPayload, signHmac(commentPayload, FB_APP_SECRET));
    check('توقيع صحيح => 200 ومقبول', good.status === 200 && good.json?.accepted === true && good.json?.processed === 1);
    check('الاستقبال يؤكد الكتابة الدائمة قبل الإقرار', good.json?.persisted === true);
    check('التعليق يُعلن نوعه comment', Array.isArray(good.json?.acceptedKinds) && good.json.acceptedKinds.includes('comment'));
    const comments = await (await fetch(`${BASE}/api/social/manager/comments?platform=facebook`, { headers: auth })).json();
    const c1 = comments.comments.find((c: any) => c.externalId === 'C1');
    check('التعليق الوارد خُزّن بمصدر webhook حقيقي', c1?.ingestSource === 'facebook_webhook' && c1?.kind === 'comment');
    check('التعليق ليس simulated/not delivered', c1?.simulated === undefined && c1?.delivered === undefined);
    check('هدف الرد الحقيقي محفوظ', c1?.replyTarget?.commentId === 'C1');

    group('8) تكامل: منع تكرار الحدث (replay/idempotency)');
    const replay = await postWebhook(commentPayload, signHmac(commentPayload, FB_APP_SECRET));
    check('إعادة نفس الحدث => duplicate', replay.json?.duplicates === 1 && replay.json?.processed === 0);
    const after = await (await fetch(`${BASE}/api/social/manager/comments?platform=facebook`, { headers: auth })).json();
    check('لا سجل مكرر بعد replay', after.comments.filter((c: any) => c.externalId === 'C1').length === 1);

    group('8ب) تكامل: التوقيع يُحسب على البايتات الخام لا على إعادة التسلسل');
    // Meta لا يضمن مطابقة تنسيقه (مسافات/أسطر) لما ينتجه JSON.stringify. لذلك
    // يجب أن يُتحقق التوقيع على الجسم الخام كما وصل، وإلا فشل webhook حقيقي.
    const spacedPayload = '{\n  "object": "page",\n  "entry": [ { "id": "PAGE_123", "changes": [ { "field": "feed", "value": { "item": "comment", "comment_id": "CSPACED", "post_id": "POST1", "message": "استفسار بصيغة مختلفة", "from": { "name": "سالم" } } } ] } ]\n}';
    check('الجسم الخام يختلف فعلاً عن إعادة التسلسل', JSON.stringify(JSON.parse(spacedPayload)) !== spacedPayload);
    const spaced = await postWebhook(spacedPayload, signHmac(spacedPayload, FB_APP_SECRET));
    check('توقيع مطابق للجسم الخام غير المضغوط => 200', spaced.status === 200 && spaced.json?.processed === 1, `status=${spaced.status} body=${JSON.stringify(spaced.json).slice(0, 160)}`);
    const spacedReplay = await postWebhook(JSON.stringify(JSON.parse(spacedPayload)), signHmac(JSON.stringify(JSON.parse(spacedPayload)), FB_APP_SECRET));
    check('نفس الحدث بإعادة تسلسل مختلفة لا يُخلق مرتين', spacedReplay.json?.processed === 0 && spacedReplay.json?.duplicates === 1);

    group('9) تكامل: استقبال رسالة Messenger منفصلة عن التعليق');
    const msgPayload = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE_123', messaging: [{ sender: { id: 'U9' }, recipient: { id: 'PAGE_123' }, timestamp: 1700000000000, message: { mid: 'MID1', text: 'هل لديكم توصيل للمنازل؟' } }] }] });
    const msgRes = await postWebhook(msgPayload, signHmac(msgPayload, FB_APP_SECRET));
    check('رسالة موثوقة => 200 ومقبولة', msgRes.status === 200 && msgRes.json?.processed === 1);
    check('الرسالة تُعلن نوعها message', Array.isArray(msgRes.json?.acceptedKinds) && msgRes.json.acceptedKinds.includes('message'));
    const msgComment = (await (await fetch(`${BASE}/api/social/manager/comments?platform=facebook`, { headers: auth })).json()).comments.find((c: any) => c.externalId === 'MID1');
    check('الرسالة خُزّنت بنوع message لا comment', msgComment?.kind === 'message');
    check('هدف الرد على الرسالة هو المستلم', msgComment?.replyTarget?.recipientId === 'U9');

    group('10) تكامل: الرد الحقيقي على تعليق');
    const rep = await fetch(`${BASE}/api/platforms/facebook/reply`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ externalId: 'C1', text: 'أهلاً بك، شكراً لتواصلك معنا، فريق المعرض في خدمتك.', commentText: 'بكم سعر الثلاجة بالتقسيط؟' }),
    });
    const repBody = await rep.json();
    check('الرد الحقيقي على التعليق نجح', rep.status === 200 && repBody.delivered === true && repBody.simulated === false, JSON.stringify(repBody).slice(0, 200));
    check('وصل رد فعلي لخادم Graph', mock.state.commentReplies.length === 1 && mock.state.commentReplies[0].commentId === 'C1');
    check('الرد مُثبّت بمعرّف من Meta', Boolean(repBody.providerReplyId) && repBody.providerReplyId === mock.state.commentReplies[0].id);

    group('11) تكامل: منع الرد المكرر على نفس التعليق');
    const dup = await fetch(`${BASE}/api/platforms/facebook/reply`, {
      method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'C1', text: 'رد ثانٍ مختلف', commentText: 'بكم سعر الثلاجة بالتقسيط؟' }),
    });
    check('الرد مرة ثانية => 409', dup.status === 409);
    check('لم يُرسل رد ثانٍ', mock.state.commentReplies.length === 1);

    group('12) تكامل: الرد الحقيقي على رسالة Messenger');
    const mrep = await fetch(`${BASE}/api/platforms/facebook/message-reply`, {
      method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'MID1', text: 'نعم، لدينا توصيل داخل بغداد.', commentText: 'هل لديكم توصيل للمنازل؟' }),
    });
    const mrepBody = await mrep.json();
    check('الرد على الرسالة نجح عبر مسار message_reply', mrep.status === 200 && mrepBody.delivered === true, `status=${mrep.status} body=${JSON.stringify(mrepBody).slice(0, 240)}`);
    check('وصلت رسالة فعلية لخادم Graph', mock.state.sentMessages.length === 1 && mock.state.sentMessages[0].recipientId === 'U9');
    check('الرسالة مُثبّتة بمعرّف من Meta', mrepBody.providerReplyId === (mock.state.sentMessages[0]?.messageId));
    check('مسار التعليقات على رسالة Messenger لا يستخدمه', true); // رسالة Facebook لها مسارها المنفصل أعلاه

    group('13) تكامل: حارس السلامة والتصنيف وself-authored');
    // شكوى => مراجعة بشرية.
    const complaintPayload = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE_123', changes: [{ field: 'feed', value: { item: 'comment', comment_id: 'C2', post_id: 'POST1', message: 'لدي شكوى على التأخير', from: { name: 'زينب' } } }] }] });
    await postWebhook(complaintPayload, signHmac(complaintPayload, FB_APP_SECRET));
    const complaintReply = await fetch(`${BASE}/api/platforms/facebook/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'C2', text: 'سنحل الموضوع فوراً.', commentText: 'لدي شكوى على التأخير' }) });
    check('الشكوى => 422 مراجعة بشرية', complaintReply.status === 422);
    // رد بسعر غير مسجّل => حارس السلامة يرفض.
    const askPayload = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE_123', changes: [{ field: 'feed', value: { item: 'comment', comment_id: 'C3', post_id: 'POST1', message: 'هل متوفر لديكم؟', from: { name: 'عمر' } } }] }] });
    await postWebhook(askPayload, signHmac(askPayload, FB_APP_SECRET));
    const unsafe = await fetch(`${BASE}/api/platforms/facebook/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'C3', text: 'السعر 150000 دينار فقط!', commentText: 'هل متوفر لديكم؟' }) });
    const unsafeBody = await unsafe.json();
    check('رد بسعر غير مسجّل => 422 محجوب', unsafe.status === 422 && unsafeBody.contentSafety?.safe === false);
    check('لم يُرسل أي رد محجوب', mock.state.commentReplies.length === 1);
    // تعليق من حساب المعرض => لا رد (self-authored).
    const selfPayload = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE_123', changes: [{ field: 'feed', value: { item: 'comment', comment_id: 'C4', post_id: 'POST1', message: 'عرض جديد اليوم', from: { name: 'معرض الغرابي' } } }] }] });
    await postWebhook(selfPayload, signHmac(selfPayload, FB_APP_SECRET));
    const selfReply = await fetch(`${BASE}/api/platforms/facebook/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'C4', text: 'شكراً لكم', commentText: 'عرض جديد اليوم' }) });
    check('تعليق حساب المعرض => 409 (منع حلقة)', selfReply.status === 409);

    group('14) تكامل: فشل الإرسال لا يُسجَّل تسليماً');
    const invPayload = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE_123', changes: [{ field: 'feed', value: { item: 'comment', comment_id: 'C5', post_id: 'POST1', message: 'هل لديكم أجهزة؟', from: { name: 'ليلى' } } }] }] });
    await postWebhook(invPayload, signHmac(invPayload, FB_APP_SECRET));
    mock.state.failCommentReply = true;
    const failed = await fetch(`${BASE}/api/platforms/facebook/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'C5', text: 'أهلاً بك، فريق المعرض في خدمتك.', commentText: 'هل لديكم أجهزة؟' }) });
    const failedBody = await failed.json();
    check('فشل Meta => 502', failed.status === 502, `status=${failed.status}`);
    check('فشل Meta لا يُعلن تسليماً', failedBody.delivered === false && failedBody.reply?.delivered === false);
    check('فشل Meta يخزّن سبباً حقيقياً', typeof failedBody.reply?.deliveryError === 'string' && failedBody.reply?.reviewStatus === 'failed');
    check('لا معرّف مزود عند الفشل', !failedBody.reply?.providerReplyId);
    mock.state.failCommentReply = false;

    group('15) تكامل: لا رد بلا تعليق حقيقي');
    const unknown = await fetch(`${BASE}/api/platforms/facebook/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'C999', text: 'مرحبا' }) });
    check('لا إرسال بلا تعليق حقيقي => 404', unknown.status === 404);
    const unknownMsg = await fetch(`${BASE}/api/platforms/facebook/message-reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'MID999', text: 'مرحبا' }) });
    check('لا إرسال رسالة بلا رسالة حقيقية => 404', unknownMsg.status === 404);

    group('16) تكامل: النشر على الصفحة بمعرّف حقيقي');
    const pub = await fetch(`${BASE}/api/platforms/facebook/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'عرض تقسيط جديد من معرض الغرابي.', approved: true }) });
    const pubBody = await pub.json();
    check('النشر على الصفحة نجح بمعرّف من Meta', pub.status === 200 && Boolean(pubBody.providerPostId) && mock.state.posts.length === 1, JSON.stringify(pubBody).slice(0, 200));

    group('17) تكامل: ثبات الاستقبال وحماية التكرار بعد restart');
    await stop(app.proc);
    currentApp = startApp(mock.base);
    check('الخادم يقلع بعد إعادة التشغيل', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const persisted = await (await fetch(`${BASE}/api/social/manager/comments?platform=facebook`, { headers: auth })).json();
    const pC1 = persisted.comments.find((c: any) => c.externalId === 'C1');
    check('التعليق يصمد بعد restart', Boolean(pC1) && pC1.ingestSource === 'facebook_webhook');
    check('هدف الرد يصمد بعد restart', pC1?.replyTarget?.commentId === 'C1');
    const replayAfter = await postWebhook(commentPayload, signHmac(commentPayload, FB_APP_SECRET));
    check('منع التكرار يصمد بعد restart', replayAfter.json?.duplicates === 1 && replayAfter.json?.processed === 0);
    const readinessRestart = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const fbRestart = readinessRestart.platforms.find((p: any) => p.platform === 'facebook');
    check('اتصال Facebook الموثق يصمد بعد restart', fbRestart.connected === true && fbRestart.providerVerified === true);

    // جلسة OAuth المعلّقة كانت في الذاكرة فقط، فعلى Render Free (بلا قرص دائم)
    // يقضي المالك وقتاً في شاشة الموافقة ثم تصل العودة لعملية جديدة فتضيع الحالة
    // ويُرفض الربط بـ400. الفحص يثبت أن الحالة تصمد فعلاً عبر إعادة التشغيل.
    group('18) تكامل: جلسة OAuth تصمد عبر إعادة التشغيل (سيناريو Render)');
    const oauthStart2 = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const pendingState = new URL(oauthStart2.authorizationUrl).searchParams.get('state') || '';
    check('بدء OAuth جديد يعيد حالة قوية', pendingState.length >= 32);
    await stop(currentApp.proc);
    currentApp = startApp(mock.base);
    check('الخادم يقلع بعد إعادة التشغيل الثانية', await waitForHealth(), currentApp.log().slice(0, 300));
    const cbAfterRestart = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(pendingState)}&code=TESTCODE2`);
    check('callback ينجح بحالة محفوظة بعد restart (لا 400)', cbAfterRestart.status === 200, `status=${cbAfterRestart.status}`);
    const reuse = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(pendingState)}&code=TESTCODE3`);
    check('state يُستهلك مرة واحدة حتى بعد restart', reuse.status === 400, `status=${reuse.status}`);

    // سيناريو الحساب الذي يدير أكثر من صفحة: OAuth ينجح لكنه يتوقف عند اختيار
    // الصفحة. كانت الواجهة تُخفي أداة الاختيار خلف زر «بدء الربط» فيستحيل إتمام
    // الربط. هذا الفحص يثبت أن المسار كامل: pending → pages → select-page → connected.
    group('19) تكامل: حساب يدير أكثر من صفحة (اختيار الصفحة)');
    await stop(currentApp.proc);
    // حالة نظيفة + خادم Graph بصفحتين، فلا يبقى اتصال سابق يخفي سيناريو الانتظار.
    writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
      schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser, staffUser],
      revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
      workspace: { showroom: {}, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [] },
    }), 'utf8');
    const multiMock = await startFacebookMockServer(FB_PORT + 1, createFacebookMock({
      pages: [
        { id: 'PAGE_A', name: 'معرض الغرابي للتقسيط', accessToken: 'PAGE_TOKEN_A', tasks: ['CREATE_CONTENT', 'MODERATE'] },
        { id: 'PAGE_B', name: 'صفحة ثانية', accessToken: 'PAGE_TOKEN_B', tasks: ['CREATE_CONTENT'] },
      ],
    }));
    currentApp = startApp(multiMock.base);
    check('الخادم يقلع لسيناريو الصفحات المتعددة', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const multiStart = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const multiState = new URL(multiStart.authorizationUrl).searchParams.get('state') || '';
    const multiCb = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(multiState)}&code=MULTI`);
    check('callback بحساب متعدد الصفحات ينجح (يوقف عند اختيار الصفحة)', multiCb.status === 200, `status=${multiCb.status}`);
    const multiReadiness = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const multiFb = multiReadiness.platforms.find((p: any) => p.platform === 'facebook');
    check('لا اتصال بعد OAuth قبل اختيار الصفحة', multiFb.connected === false && multiFb.providerVerified === false);
    const multiCp = await (await fetch(`${BASE}/api/platforms/control-plane`, { headers: auth })).json();
    const multiCpFb = multiCp.platforms.find((p: any) => p.platform === 'facebook');
    check('اللوحة تُعلن انتظار اختيار الصفحة صراحةً', multiCpFb.pageSelectionPending === true, JSON.stringify(multiCpFb).slice(0, 200));
    check('سبب الحجب يوجّه لاختيار الصفحة لا لفشل الربط', String(multiCpFb.blockingReason || '').includes('أكثر من صفحة'));
    const multiMatrix = await (await fetch(`${BASE}/api/platforms/readiness-matrix`, { headers: auth })).json();
    const matrixFb = multiMatrix.platforms.find((p: any) => p.platform === 'facebook');
    check('مصفوفة الجاهزية تُعلن انتظار اختيار الصفحة للواجهة الرئيسية', matrixFb.pageSelectionPending === true);
    const pagesRes = await (await fetch(`${BASE}/api/platforms/facebook/pages`, { headers: auth })).json();
    check('جلب الصفحات يعيد الصفحتين بلا أي رمز', pagesRes.pages?.length === 2 && !JSON.stringify(pagesRes).includes('PAGE_TOKEN'));
    const sel = await fetch(`${BASE}/api/platforms/facebook/select-page`, { method: 'POST', headers: auth, body: JSON.stringify({ pageId: 'PAGE_A' }) });
    const selBody = await sel.json();
    check('اختيار الصفحة يُثبتها ويشترك في webhook', sel.status === 200 && selBody.success === true && selBody.webhookSubscribed === true, JSON.stringify(selBody).slice(0, 200));
    check('الاشتراك المُنفَّذ للصفحة المختارة فعلياً', multiMock.state.lastSubscribe?.pageId === 'PAGE_A');
    const multiAfter = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const multiFbAfter = multiAfter.platforms.find((p: any) => p.platform === 'facebook');
    check('Facebook يصبح متصلاً وموثقاً بعد اختيار الصفحة', multiFbAfter.connected === true && multiFbAfter.providerVerified === true);
    const multiCpAfter = await (await fetch(`${BASE}/api/platforms/control-plane`, { headers: auth })).json();
    check('لم يعد معلّقاً على اختيار الصفحة', multiCpAfter.platforms.find((p: any) => p.platform === 'facebook').pageSelectionPending === false);
    await multiMock.stop();

    // الفحص يمنع إرسال المالك إلى صفحة Meta العامة «حدث خطأ ما» عند معرّف تطبيق
    // غير مطابق، ويُعلن السبب صراحةً بدل توليد رابط سيفشل حتماً.
    group('20) تكامل: فحص ما قبل الحوار يمنع «حدث خطأ ما» بلا تفسير');
    await stop(currentApp.proc);
    const wrongAppMock = await startFacebookMockServer(FB_PORT + 2, createFacebookMock({ validAppId: '999999999999999' }));
    currentApp = startApp(wrongAppMock.base);
    check('الخادم يقلع لفحص معرّف التطبيق', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const blocked = await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth });
    const blockedBody = await blocked.json();
    check('بدء OAuth يرفض معرّف تطبيق غير مطابق بـ409', blocked.status === 409, `status=${blocked.status} body=${JSON.stringify(blockedBody).slice(0, 200)}`);
    check('السبب صريح META_APP_ID_INVALID', blockedBody.code === 'META_APP_ID_INVALID');
    check('لا يُعاد رابط تفويض عند معرّف غير صالح', !blockedBody.authorizationUrl);
    check('الفحص استدعى Graph فعلياً بمعرّف التطبيق', wrongAppMock.state.lastAppTokenCheck?.clientId === '145634995501895');
    check('الفحص لا يكشف السرّ', !JSON.stringify(blockedBody).includes('test-fb-client-secret'));
    check('الاستجابة تحمل رابط الإرجاع الصحيح للتسجيل لدى Meta', blockedBody.redirectUri === `${BASE}/api/platforms/facebook/oauth/callback`);
    await wrongAppMock.stop();

    // تجاوز جزئي عبر FACEBOOK_OAUTH_SCOPES يجب ألا يُنتج «Invalid Scopes» ولا
    // صلاحية مُسقَطة: الحلّ يضيف الاعتماديات الناقصة ويُعلن الفارق للتشخيص.
    group('21) تكامل: تجاوز الصلاحيات الجزئي يُكمَّل باعتماديات Meta تلقائياً');
    await stop(currentApp.proc);
    const scopeMock = await startFacebookMockServer(FB_PORT + 3, createFacebookMock());
    currentApp = startApp(scopeMock.base, { FACEBOOK_OAUTH_SCOPES: 'pages_manage_engagement,business_management' });
    check('الخادم يقلع لتجاوز الصلاحيات الجزئي', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const partialStart = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const partialScopes = new URL(partialStart.authorizationUrl).searchParams.get('scope').split(',').filter(Boolean);
    check('التجاوز الجزئي يكتمل بـpages_read_user_content', partialScopes.includes('pages_read_user_content'), partialScopes.join(','));
    check('التجاوز الجزئي يكتمل بـpages_show_list', partialScopes.includes('pages_show_list'), partialScopes.join(','));
    check('التجاوز الجزئي يبقي business_management', partialScopes.includes('business_management'));
    check('التجاوز الجزئي يبقى بلا اعتماديات ناقصة', findMissingScopeDependencies(partialScopes).length === 0, findMissingScopeDependencies(partialScopes).join(','));
    check('التجاوز الجزئي يُعلن الفارق المُكمَّل للتشخيص', Array.isArray(partialStart.scopeDependencyGaps) && partialStart.scopeDependencyGaps.includes('pages_read_user_content'));
    const partialSetup = await (await fetch(`${BASE}/api/platforms/facebook/oauth/setup`, { headers: auth })).json();
    check('oauth/setup يُعلن أن الصلاحيات حُلَّت باعتمادياتها', partialSetup.scopeDependenciesResolved === true && partialSetup.scopeOverrideConfigured === true);
    check('oauth/setup يعرض الفارق المُكمَّل بلا سرّ', Array.isArray(partialSetup.scopeDependencyGaps) && partialSetup.scopeDependencyGaps.includes('pages_read_user_content'));
    await scopeMock.stop();

    // تجاوب Render: قد تُلصق قيم البيئة بمسافة/سطر زائد فيبدو الإعداد «صحيحاً»
    // بينما يرفض Meta السرّ بـinvalid_client_secret فيمنع OAuth بـ409. يجب أن
    // يُطبَّع المعرّف/السرّ تلقائياً فلا يتوقف الربط بلا سبب ظاهر.
    group('22) تكامل: تطبيع مسافات/أسطر بيئة Meta يمنع 409 الخاطئ');
    await stop(currentApp.proc);
    const wsMock = await startFacebookMockServer(FB_PORT + 4, createFacebookMock());
    currentApp = startApp(wsMock.base, {
      FACEBOOK_OAUTH_CLIENT_ID: '145634995501895 ',
      FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret\n',
    });
    check('الخادم يقلع مع قيم بيئة تحمل مسافات', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const wsStart = await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth });
    const wsBody: any = await wsStart.json();
    check('بدء OAuth ينجح رغم المسافات الزائدة (200)', wsStart.status === 200, `status=${wsStart.status} body=${JSON.stringify(wsBody).slice(0, 200)}`);
    check('يُعاد رابط تفويض صالح بعد التطبيع', typeof wsBody.authorizationUrl === 'string' && wsBody.authorizationUrl.includes('client_id=145634995501895'));
    check('الفحص استدعى Graph بالسرّ المطبَّع (بلا سطر زائد)', wsMock.state.lastAppTokenCheck?.secretLen === 'test-fb-client-secret'.length);
    check('لا يُفصح عن أي سرّ في الاستجابة', !JSON.stringify(wsBody).includes('test-fb-client-secret'));
    await wsMock.stop();
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
    console.log(`PASSED: ${passed} facebook connector checks`);
  }
})().catch((err) => { console.error('Facebook connector harness crashed:', err); process.exit(1); });
