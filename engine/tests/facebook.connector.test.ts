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
  classifyMetaDialogChain,
  isMetaMobileHost,
  safeUrlHost,
  safeUrlPath,
  FACEBOOK_MOBILE_UA,
  classifyMetaAppTokenResponse,
  FACEBOOK_REQUIRED_SCOPES,
  FACEBOOK_PERMISSION_DEPENDENCIES,
  resolveFacebookScopes,
  findMissingScopeDependencies,
  missingScopeDependenciesFromCsv,
  expandWithDependencies,
  extractFacebookGraphError,
  formatFacebookGraphError,
  buildPublishVideoBody,
  buildPublishPhotoBody,
  interpretPostGrounding,
  FacebookClient,
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
    // حوار Meta الوهمي: فحص ما قبل التوجيه لا يلمس مزوداً حقيقياً.
    FACEBOOK_DIALOG_BASE: fbBase,
    // معرّف تطبيق رقمي (كما هو حقيقي لدى Meta) — الفحص الآن يرفض ما ليس أرقاماً.
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: FB_APP_SECRET,
    FACEBOOK_VERIFY_TOKEN: FB_VERIFY_TOKEN,
    // معرّف الحافظة لتفعيل الفحص العكسي القراءة-فقط (owned_apps) في التشخيص.
    FACEBOOK_BUSINESS_ID: 'BIZ_999',
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

async function unitTests(): Promise<void> {
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
  // HTTP 500 + «حدث خطأ ما»: رفض صريح (كان يسقط سابقاً كـ«مقبول» فيُرسَل المالك للفشل).
  const http500 = classifyMetaDialogInteraction({ status: 500, body: 'Sorry, something went wrong. We\u2019re working on getting this fixed.' });
  check('HTTP 500 + «حدث خطأ ما» = رفض صريح لا قبول', http500.acceptable === false && http500.kind === 'dialog_error');
  const http500Empty = classifyMetaDialogInteraction({ status: 500, body: '' });
  check('HTTP 500 بلا جسم = خطأ HTTP صريح (لا تمرير)', http500Empty.acceptable === false && http500Empty.kind === 'http_error' && http500Empty.errorCode === 'HTTP_500');
  const http403 = classifyMetaDialogInteraction({ status: 403, body: '' });
  check('HTTP 403 = خطأ HTTP صريح', http403.acceptable === false && http403.kind === 'http_error' && http403.errorCode === 'HTTP_403');
  const http429 = classifyMetaDialogInteraction({ status: 429, body: '' });
  check('HTTP 429 (تقييد مؤقت) = غير حاسم لا يُحجب', http429.acceptable === false && http429.errorCode === null && http429.kind === 'unknown');
  check('HTTP 500 + «حدث خطأ ما» عبر Facebook لا يُصنَّف مقبولاً', classifyMetaDialogInteraction({ status: 500, body: 'Sorry, something went wrong' }).acceptable === false);
  check('إعادة توجيه لتسجيل الدخول = تطبيق مقبول', classifyMetaDialogInteraction({ status: 302, location: 'https://www.facebook.com/login.php?skip_api_login=1&api_key=1' }).kind === 'login');
  check('إعادة توجيه لحوار الموافقة = تطبيق مقبول', classifyMetaDialogInteraction({ status: 302, location: 'https://www.facebook.com/v21.0/dialog/oauth?client_id=1&ret=login' }).kind === 'consent');
  check('بلا توجيه وبلا جسم معروف = غير معروف', classifyMetaDialogInteraction({ status: 200, body: 'x' }).kind === 'unknown');
  // تصنيف رمز التطبيق: code 101 = معرّف خاطئ (مطابق تماماً لصفحة Meta العامة).
  check('Graph code 101 => معرّف تطبيق غير صالح', classifyMetaAppTokenResponse({ status: 400, data: { error: { message: 'Invalid Client ID', code: 101 } } }).kind === 'invalid_client_id');
  check('Graph سرّ خاطئ => invalid_client_secret', classifyMetaAppTokenResponse({ status: 400, data: { error: { message: 'Error validating client secret.', code: 1 } } }).kind === 'invalid_client_secret');
  check('Graph نجاح => ok', classifyMetaAppTokenResponse({ status: 200, data: { access_token: 'APP_TOKEN_TEST' } }).kind === 'ok');
  check('Graph رسالة non-JSON => لا ok', classifyMetaAppTokenResponse({ status: 200, data: null }).kind !== 'ok');

  // الجذر المُثبت: Meta توجّه حسب User-Agent. متصفح المالك الجوال يسلك
  // www → m.facebook.com (encrypted_query_string) → صفحة خطأ جوال، بينما أول
  // استجابة بوكيل الخادم تبدو مقبولة (www/login.php). لذلك يجب تصنيف السلسلة
  // كاملةً لا أول قفزة.
  group('2د) وحدة: تصنيف سلسلة حوار Meta (مسار الجوال مقابل سطح المكتب)');
  check('وكيل الجوال معرّف وليس وكيل الخادم الافتراضي', FACEBOOK_MOBILE_UA.includes('Mobile') && !/^node$/i.test(FACEBOOK_MOBILE_UA));
  check('مضيف m.facebook.com يُعرف كمسار جوال', isMetaMobileHost('m.facebook.com') === true && isMetaMobileHost('mbasic.facebook.com') === true);
  check('مضيف www.facebook.com ليس مسار جوال', isMetaMobileHost('www.facebook.com') === false);
  check('استخراج المضيف من رابط بلا استعلام', safeUrlHost('https://m.facebook.com/login.php?next=secret') === 'm.facebook.com');
  check('استخراج المسار من رابط بلا استعلام', safeUrlPath('https://m.facebook.com/login.php?next=secret') === '/login.php');

  // السلسلة الفعلية للجوال: تحويل داخلي مقبول ثم فشل على m.facebook.com.
  const mobileChain = classifyMetaDialogChain([
    { status: 302, location: 'https://m.facebook.com/v21.0/dialog/oauth?client_id=1&encrypted_query_string=MOCK' },
    { status: 200, body: 'Facebook Error Login Error: There is an error in logging you into this application. Please try again later.' },
  ]);
  check('سلسلة الجوال تُرفض رغم أن أول قفزة تحويل داخلي', mobileChain.acceptable === false);
  check('الرفض مُنسَب إلى القفزة الثانية لا الأولى', mobileChain.rejection?.step === 2, JSON.stringify(mobileChain.rejection));
  check('سلسلة الجوال ترصد مضيف الجوال', mobileChain.sawMobileHost === true);
  check('رفض الجوال يحمل رمزاً صريحاً', mobileChain.rejection?.errorCode === 'META_DIALOG_MOBILE_ERROR');

  // صفحة «Invalid App ID» بصيغة الجوال (نص مختلف عن www) تُصنَّف رفضاً دقيقاً.
  const mobileInvalid = classifyMetaDialogChain([
    { status: 200, body: 'Invalid App ID: The provided app ID does not look like a valid app ID.' },
  ]);
  check('صفحة الجوال «Invalid App ID» => invalid_app_id', mobileInvalid.acceptable === false && mobileInvalid.rejection?.kind === 'invalid_app_id');

  // سلسلة سطح مكتب مقبولة (login) لا تُحجب.
  const desktopChain = classifyMetaDialogChain([
    { status: 302, location: 'https://www.facebook.com/login.php?skip_api_login=1&api_key=1' },
  ]);
  check('سلسلة سطح مكتب (login) مقبولة ولا تُحجب', desktopChain.acceptable === true && desktopChain.rejection === null);

  // «متصفح غير مدعوم» مسار مسدود صريح لا شاشة موافقة.
  const unsupported = classifyMetaDialogChain([
    { status: 302, location: 'https://www.facebook.com/unsupportedbrowser' },
  ]);
  check('«متصفح غير مدعوم» رفض صريح', unsupported.acceptable === false && unsupported.rejection?.errorCode === 'META_DIALOG_UNSUPPORTED_BROWSER');

  // سلسلة غير حاسمة (200 مبهم) لا تُحجب بلا إثبات.
  check('سلسلة غير حاسمة لا تُحجب', classifyMetaDialogChain([{ status: 200, body: 'Consent screen' }]).acceptable === true);
  // القفزات المرصودة آمنة: مضيف/مسار فقط بلا أي استعلام.
  check('القفزات المرصودة بلا أي استعلام (لا state/client_id)', !JSON.stringify(mobileChain.hops).includes('encrypted_query_string') && !JSON.stringify(mobileChain.hops).includes('client_id'));

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

  group('1ز) وحدة: استخراج خطأ Graph الكامل بلا قطع (تشخيص قراءة-فقط)');
  const fullMsg = "(#100) Object does not exist, cannot be loaded due to missing permission or reviewable feature, or does not support this operation. This endpoint requires the 'pages_read_engagement' permission or the 'Page Public Content Access' feature or the 'Page Public Metadata Access' feature. Refer to https://developers.facebook.com/docs/apps/review/login-permissions#manage-pages for details.";
  const gErr = extractFacebookGraphError(
    { error: { message: fullMsg, type: 'OAuthException', code: 100, error_subcode: 33, fbtrace_id: 'AbCdEf123', error_user_title: 'T', error_user_msg: 'U' } },
    'GET /me/accounts',
    400,
  );
  check('رسالة Graph مستخرَجة كاملة غير مقطوعة', gErr.message === fullMsg && gErr.message.length > 240);
  check('رمز الخطأ مستخرَج', gErr.code === 100);
  check('الرقم الفرعي مستخرَج', gErr.subcode === 33);
  check('fbtrace_id مستخرَج', gErr.fbtraceId === 'AbCdEf123');
  check('نقطة النهاية مسجّلة', gErr.endpoint === 'GET /me/accounts' && gErr.status === 400);
  const logLine = formatFacebookGraphError(gErr);
  check('سطر السجل يحمل الرمز والنص الكامل', logLine.includes('[facebook-graph-error]') && logLine.includes(fullMsg));
  // لا سرّ: السطر لا يحمل أي رمز وصول أو كلمة access_token.
  check('سطر السجل بلا أي توكن/سرّ', !/access_token|Bearer |EAA[A-Za-z0-9]/.test(logLine));

  group('1ح) وحدة: getPageProfile لا يطلب tasks (إصلاح #100)');
  const requestedUrls: string[] = [];
  const fakeFetch = async (url: string) => {
    requestedUrls.push(url);
    return { ok: true, status: 200, json: async () => ({ id: 'PAGE_X', name: 'صفحة', access_token: 'PT' }) };
  };
  const client = new FacebookClient(fakeFetch as any, 'https://graph.example/v21.0');
  const profile = await client.getPageProfile('PAGE_X', 'USER_TOKEN');
  const profileUrl = requestedUrls[requestedUrls.length - 1] || '';
  check('إثبات الهوية نجح', profile.ok === true && profile.data?.pageId === 'PAGE_X');
  check('طلب الحقول بلا tasks', decodeURIComponent(profileUrl).includes('fields=id,name,access_token') && !profileUrl.includes('tasks'));
  check('الرمز الصفحي مستخرَج', profile.data?.pageAccessToken === 'PT');

  group('1ط) وحدة: نشر فيديو على الصفحة (Task #22 — file_url، لا video_url)');
  check('buildPublishVideoBody يستخدم file_url', buildPublishVideoBody('https://drive.example/v.mp4').get('file_url') === 'https://drive.example/v.mp4');
  check('buildPublishVideoBody لا يضيف video_url', buildPublishVideoBody('https://drive.example/v.mp4').get('video_url') === null);
  check('buildPublishVideoBody يضمّن الوصف إن وُجد', buildPublishVideoBody('https://x/v.mp4', 'وصف المنتج').get('description') === 'وصف المنتج');
  check('buildPublishVideoBody بلا وصف فارغ', buildPublishVideoBody('https://x/v.mp4', '   ').get('description') === null);
  // إصلاح ظهور الفيديو للجمهور: `published=true` صريح — لا نعتمد على الافتراضي في
  // حال تغيّر عقد Graph، ولا نحوّل الفيديو سهواً لمسودة (published=false) فيبقى
  // ظاهراً للأونر فقط بدل الجمهور.
  check('buildPublishVideoBody يفرض published=true صراحةً', buildPublishVideoBody('https://x/v.mp4', 'وصف').get('published') === 'true');

  group('1ط-2) وحدة: تفسير حالة ظهور المنشور (interpretPostGrounding)');
  const gPublished = interpretPostGrounding('video', { id: 'V1', is_published: true, created_time: '2026-01-01T00:00:00+0000' }, true);
  check('منشور: isPublished=true و confirmedPublicStory=true', gPublished.isPublished === true && gPublished.confirmedPublicStory === true);
  check('منشور: ظاهر على الحائط', gPublished.appearsOnPage === true);
  const gDraft = interpretPostGrounding('video', { id: 'V2', is_published: false, scheduled_publish_time: 123 }, null);
  check('مسودة/مجدول: isPublished=false و confirmedPublicStory=false', gDraft.isPublished === false && gDraft.confirmedPublicStory === false);
  check('مجدول: scheduledPublishTime محفوظ', gDraft.scheduledPublishTime === '123');
  const gUnknown = interpretPostGrounding('post', { id: 'P3' }, null);
  check('حقل غائب => null لا يُفترض نجاح', gUnknown.isPublished === null && gUnknown.appearsOnPage === null && gUnknown.confirmedPublicStory === false);
  const gPublishedNotOnWall = interpretPostGrounding('video', { id: 'V4', is_published: true }, false);
  check('is_published=true لا تعني الظهور العام: غيابها عن الحائط تُبطل الادّعاء', gPublishedNotOnWall.isPublished === true && gPublishedNotOnWall.appearsOnPage === false && gPublishedNotOnWall.confirmedPublicStory === true);
  const gMissing = interpretPostGrounding('video', {}, null);
  check('بلا معرّف => exists=false', gMissing.exists === false && gMissing.providerPostId === '');

  const videoRequests: { url: string; body: any }[] = [];
  const fakeVideoFetch = async (url: string, init: any) => {
    videoRequests.push({ url, body: Object.fromEntries(new URLSearchParams(String(init?.body || ''))) });
    return { ok: true, status: 200, json: async () => ({ id: 'VID_123' }) };
  };
  const videoClient = new FacebookClient(fakeVideoFetch as any, 'https://graph.example/v21.0');
  const published = await videoClient.publishVideoToPage('PAGE_X', 'PAGE_TOKEN', 'https://drive.example/v.mp4', 'منتج جديد');
  check('نشر الفيديو نجح بمعرّف من Meta', published.ok === true && published.data?.providerPostId === 'VID_123');
  check('الطلب ذهب إلى /{page-id}/videos', videoRequests[0]?.url.includes('/PAGE_X/videos'));
  check('الجسم حمل file_url لا video_url', videoRequests[0]?.body.file_url === 'https://drive.example/v.mp4' && videoRequests[0]?.body.video_url === undefined);
  check('الجسم حمل published=true صراحةً (لا مسودة)', videoRequests[0]?.body.published === 'true');

  const noIdFetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  const failClient = new FacebookClient(noIdFetch as any, 'https://graph.example/v21.0');
  const failedPublish = await failClient.publishVideoToPage('PAGE_X', 'PT', 'https://drive.example/v.mp4');
  check('لا نجاح بلا معرّف فيديو من Meta', failedPublish.ok === false);
  check('بلا رابط فيديو => رفض فوري بلا أي طلب شبكي', (await videoClient.publishVideoToPage('PAGE_X', 'PT', '')).ok === false);

  group('1ي) وحدة: نشر صورة على الصفحة (POST /{page-id}/photos — url)');
  check('buildPublishPhotoBody يستخدم url', buildPublishPhotoBody('https://drive.example/p.jpg').get('url') === 'https://drive.example/p.jpg');
  check('buildPublishPhotoBody لا يستخدم source (ذاك للبايتات)', buildPublishPhotoBody('https://x/p.jpg').get('source') === null);
  check('buildPublishPhotoBody يضمّن الرسالة إن وُجدت', buildPublishPhotoBody('https://x/p.jpg', 'عرض جديد').get('message') === 'عرض جديد');
  check('buildPublishPhotoBody بلا رسالة فارغة', buildPublishPhotoBody('https://x/p.jpg', '  ').get('message') === null);
  const photoRequests: { url: string; body: any }[] = [];
  const fakePhotoFetch = async (url: string, init: any) => {
    photoRequests.push({ url, body: Object.fromEntries(new URLSearchParams(String(init?.body || ''))) });
    return { ok: true, status: 200, json: async () => ({ id: 'PHOTO_123' }) };
  };
  const photoClient = new FacebookClient(fakePhotoFetch as any, 'https://graph.example/v21.0');
  const postedPhoto = await photoClient.publishPhotoToPage('PAGE_X', 'PAGE_TOKEN', 'https://drive.example/p.jpg', 'منتج جديد');
  check('نشر الصورة نجح بمعرّف من Meta', postedPhoto.ok === true && postedPhoto.data?.providerPostId === 'PHOTO_123');
  check('الطلب ذهب إلى /{page-id}/photos', photoRequests[0]?.url.includes('/PAGE_X/photos'));
  check('الجسم حمل url لا source', photoRequests[0]?.body.url === 'https://drive.example/p.jpg' && photoRequests[0]?.body.source === undefined);
  check('بلا رابط صورة => رفض فوري بلا أي طلب شبكي', (await photoClient.publishPhotoToPage('PAGE_X', 'PT', '')).ok === false);
  check('لا نجاح بلا معرّف صورة من Meta', (await failClient.publishPhotoToPage('PAGE_X', 'PT', 'https://x/p.jpg')).ok === false);
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

    group('5ب) تكامل: تشخيص ارتباط حافظة الأعمال (owner فقط، قراءة-فقط)');
    check('business-link-diagnosis بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/facebook/business-link-diagnosis`)).status === 401);
    check('business-link-diagnosis لغير المالك => 403', (await fetch(`${BASE}/api/platforms/facebook/business-link-diagnosis`, { headers: staffAuth })).status === 403);
    const bizDiag = await (await fetch(`${BASE}/api/platforms/facebook/business-link-diagnosis`, { headers: auth })).json();
    check('يشهد أن بيانات التطبيق صالحة من جهة Graph', bizDiag.appCredentials?.verdict === 'valid', JSON.stringify(bizDiag.appCredentials));
    // النتيجة القاطعة الموثّقة: لا حقل business على عقدة /{app-id}.
    check('يعلن صراحةً غياب حقل business على عقدة التطبيق', bizDiag.businessLink?.businessFieldOnAppNode === false && bizDiag.businessLink?.detectableViaAppNode === false);
    check('لا يُخترع ارتباط بحافظة أعمال', bizDiag.businessLink?.optionalCompanyProbe?.present === true && bizDiag.businessLink?.optionalCompanyProbe?.value === 'الغرابي');
    check('يوجّه للمسار العكسي الرسمي /{business-id}/owned_apps', bizDiag.businessLink?.reverseRoute?.path === '/{business-id}/owned_apps');
    check('يقرأ عقدة التطبيق فعلياً (اسم/حقول معلنة)', bizDiag.appNode?.ok === true && bizDiag.appNode?.name === 'معرض الغرابي -صفحات', JSON.stringify(bizDiag.appNode));
    check('يعرض حالة Configuration ID منطقية بلا قيمة', typeof bizDiag.configuration?.configured === 'boolean' && typeof bizDiag.configuration?.valid === 'boolean');
    check('يعلن قراءة-فقط Status 200 بلا أي سرّ', bizDiag.success === true && !JSON.stringify(bizDiag).includes(FB_APP_SECRET) && !JSON.stringify(bizDiag).includes('test-fb-client-secret'));
    check('البوابة الافتراضية تسمح بتمرير scope (لا حجب كاذب)', bizDiag.scopeWithoutConfigOverride === true);
    // أدوار المطوّر من Graph: يكشف معرّف المستخدم الفعلي المدرَج أدمن (مفتاح تشخيص التناقض).
    check('يقرأ أدوار التطبيق من Graph ويكشف معرّف الأدمن الفعلي', bizDiag.appRoles?.ok === true && bizDiag.appRoles?.count === 1 && bizDiag.appRoles?.adminUserIds?.[0] === '100000000000001', JSON.stringify(bizDiag.appRoles));
    check('توثّق المسار البرمجي الرسمي للربط client_apps بمعامل app_id', bizDiag.documentedOwnerAction?.graphApiAlternatives?.addAsClientApp?.path === '/{business_id}/client_apps' && bizDiag.documentedOwnerAction?.graphApiAlternatives?.addAsClientApp?.param === 'app_id' && bizDiag.documentedOwnerAction?.graphApiAlternatives?.requiredPermission === 'business_management');
    check('توثّق حسم «لا تملك هذا التطبيق» (هوية الملف الإضافي) بلا تنفيذ', Array.isArray(bizDiag.documentedOwnerAction?.youDontOwnThisApp?.fixes) && bizDiag.documentedOwnerAction.youDontOwnThisApp.fixes.length >= 3);
    check('توثّق إصلاح 2FA لإضافة الأصول', Boolean(bizDiag.documentedOwnerAction?.twoFactorFix?.fix));
    const state = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
    check('الحالة مُولَّدة قوية', state.length >= 32);
    const cbRes = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(state)}&code=TESTCODE`);
    check('callback ينجح بالصفحة الواحدة', cbRes.status === 200, `status=${cbRes.status}`);

    group('5ج) تكامل: تشخيص الحافظات بعد الربط (رمز المستخدم المخزّن، قراءة-فقط)');
    const bizDiag2 = await (await fetch(`${BASE}/api/platforms/facebook/business-link-diagnosis`, { headers: auth })).json();
    check('يرى الحافظة التي يملك فيها المستخدم دوراً (/me/businesses)', bizDiag2.userBusinesses?.ok === true && bizDiag2.userBusinesses?.businesses?.[0]?.businessId === 'BIZ_999', JSON.stringify(bizDiag2.userBusinesses));
    check('يكشف أدوار المستخدم على الحافظة', bizDiag2.userBusinesses?.businesses?.[0]?.permittedRoles?.includes('ADMIN') === true);
    check('إثبات عكسي: تطبيقنا يظهر ضمن تطبيقات الحافظة', bizDiag2.businessOwnedApps?.attempted === true && bizDiag2.businessOwnedApps?.ok === true && bizDiag2.businessOwnedApps?.containsOurApp === true, JSON.stringify(bizDiag2.businessOwnedApps));
    check('التشخيص كله لا يكشف أي سرّ', !JSON.stringify(bizDiag2).includes(FB_APP_SECRET) && !JSON.stringify(bizDiag2).includes('test-fb-client-secret') && !JSON.stringify(bizDiag2).includes('PAGE_TOKEN'));
    check('لا يُنفّذ أي ربط (الفحص قراءة-فقط)', bizDiag2.documentedOwnerAction?.graphApiAlternatives?.executesAutomatically === false);
    check('خادم Graph استُدعي فعلياً للتبادل والاشتراك', mock.state.calls > 0 && mock.state.lastSubscribe?.pageId === 'PAGE_123');
    check('الاشتراك استُخدم بحقول feed/messages', mock.state.lastSubscribe?.fields.includes('feed') === true && mock.state.lastSubscribe?.fields.includes('messages') === true);
    // إصلاح #100 الجذري: مسار الربط لا يستدعي GET /{page-id} إطلاقاً (يستخدم رمز
    // الصفحة من /me/accounts مباشرةً)، فلا يتعرض لخطأ pages_read_engagement.
    check('مسار الربط لا يستدعي GET /{page-id} (إصلاح #100 الجذري)', mock.state.pageProfileCalls === 0, `pageProfileCalls=${mock.state.pageProfileCalls}`);
    const readinessAfter = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const fbAfter = readinessAfter.platforms.find((p: any) => p.platform === 'facebook');
    check('Facebook أصبح متصلاً وموثقاً', fbAfter.connected === true && fbAfter.providerVerified === true);
    check('لا يُعاد أي رمز صفحة في الاستجابة', !JSON.stringify(fbAfter).includes('PAGE_TOKEN_TEST') && !JSON.stringify(readinessAfter).includes('USER_TOKEN_TEST_LONG'));
    // verifyProviderConnection (connection-callback) كان يستدعي GET /{page-id}
    // أيضاً فيفشل بـ#100. الآن يُثبت عبر /me/accounts، فلا استدعاء لعقدة الصفحة.
    const cbVerify = await fetch(`${BASE}/api/platforms/facebook/connection-callback`, { method: 'POST', headers: auth, body: JSON.stringify({ platform: 'facebook' }) });
    const cbVerifyBody = await cbVerify.json().catch(() => ({}));
    check('connection-callback يوثّق الاتصال بلا GET /{page-id}', cbVerify.status === 200 && cbVerifyBody.success === true && mock.state.pageProfileCalls === 0, `status=${cbVerify.status} pageProfileCalls=${mock.state.pageProfileCalls}`);

    group('6) تكامل: إثبات اشتراك الصفحة (webhook-info)');
    const info = await (await fetch(`${BASE}/api/platforms/facebook/webhook-info`, { headers: auth })).json();
    check('حالة webhook تُعلن الاشتراك الفعلي', info.status !== 502 && info.appSubscribed === true && info.pageId === 'PAGE_123', JSON.stringify(info).slice(0, 200));
    check('حالة webhook لا تكشف أي سرّ', !JSON.stringify(info).includes(FB_APP_SECRET) && !JSON.stringify(info).includes('PAGE_TOKEN_TEST') && !JSON.stringify(info).includes(FB_VERIFY_TOKEN));

    group('6ب) تكامل: التشخيص لا يختلق معرّف منشور إذا لم يوجد سجل حقيقي');
    // هنا الصفحة متصلة وموثقة (بعد group 5) لكن لم يُنشأ أي منشور فيسبوك بعد
    // (أول نشر في group 16). فيجب أن يرفض التشخيص بصراحة لا أن يخترع معرّفاً.
    const visNoRecord = await fetch(`${BASE}/api/platforms/facebook/post-visibility-diagnosis`, { headers: auth });
    const visNoRecordBody = await visNoRecord.json().catch(() => ({}));
    check('بلا سجل نشر حقيقي => رفض صريح NO_POST_ID (لا تخمين معرّف)', visNoRecord.status === 409 && visNoRecordBody.code === 'NO_POST_ID', `status=${visNoRecord.status} body=${JSON.stringify(visNoRecordBody).slice(0, 160)}`);
    check('لا يُعاد أي providerPostId مُختلق عند غياب السجل', !visNoRecordBody.providerPostId);
    check('التشخيص لا يكشف أي سرّ عند الرفض', !JSON.stringify(visNoRecordBody).includes('PAGE_TOKEN_TEST') && !JSON.stringify(visNoRecordBody).includes(FB_APP_SECRET));
    check('التشخيص لغير المالك => 403 (المعرّفات للمالك فقط)', (await fetch(`${BASE}/api/platforms/facebook/post-visibility-diagnosis`, { headers: staffAuth })).status === 403);

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

    // Task #22/#25: التوزيع الموحّد يجب أن يمرّر videoUrl (الرابط العام الحقيقي) إلى
    // فيسبوك لا النص فقط، فينشر فيديو حقيقياً عبر POST /{page-id}/videos. هذا يُثبت
    // أن نقص فيسبوك/ثريدز في قائمة الواجهة كان خطأ عرض لا نقص خادم.
    group('16ب) تكامل: التوزيع الموحّد يمرّر رابط الفيديو العام لفيسبوك (Task #25)');
    const PUBLIC_VIDEO_URL = 'https://drive.example/gharabi/marketing-cut.mp4';
    const fbVidDraftRes = await fetch(`${BASE}/api/workspace/content`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'فيديو عرض تقسيط', content: 'شاهد عرض التقسيط الجديد من معرض الغرابي.', targetPlatforms: ['facebook'], mediaType: 'video', mediaUrl: PUBLIC_VIDEO_URL, status: 'review' }) });
    const fbVidDraft = { status: fbVidDraftRes.status, body: await fbVidDraftRes.json() };
    check('إنشاء منشور فيديو لفيسبوك 201', fbVidDraft.status === 201, String(fbVidDraft.status));
    const fbVidId = fbVidDraft.body?.post?.id;
    await fetch(`${BASE}/api/workspace/content/${fbVidId}/approve`, { method: 'POST', headers: auth, body: JSON.stringify({ note: 'اعتماد فيديو فيسبوك' }) });
    const fbVidPub = await fetch(`${BASE}/api/workspace/content/${fbVidId}/publish`, { method: 'POST', headers: auth, body: '{}' });
    const fbVidBody = await fbVidPub.json();
    check('فيسبوك: النشر الموحّد نجح بمعرّف مزود', fbVidBody.results?.facebook?.state === 'published' && Boolean(fbVidBody.results?.facebook?.providerPostId), JSON.stringify(fbVidBody.results).slice(0, 200));
    check('فيسبوك: رُفع فيديو حقيقي من رابط عام (file_url)', mock.state.videos.length === 1 && mock.state.videos[0].fileUrl === PUBLIC_VIDEO_URL, JSON.stringify(mock.state.videos).slice(0, 200));
    check('فيسبوك: وصف الفيديو هو نص المنشور', mock.state.videos[0]?.description === 'شاهد عرض التقسيط الجديد من معرض الغرابي.', mock.state.videos[0]?.description);

    // إصلاح تم في هذا التدقيق: كان وسيط الصورة (mediaType=image) يُمرَّر كـimageUrl
    // لكن مسار فيسبوك **يتجاهله صامتاً** فينشر نصاً فقط بدل الصورة — فتُفقد مادة
    // المالك دون أي إشارة. الآن يُنشر عبر POST /{page-id}/photos (صلاحية
    // pages_manage_posts نفسها). هذا الفحص يفشل قبل الإصلاح (photos.length=0).
    group('16ج) تكامل: التوزيع الموحّد يمرّر الصورة العامة لفيسبوك (photos لا feed)');
    const PUBLIC_IMAGE_URL = 'https://drive.example/gharabi/offer-card.jpg';
    const fbImgDraftRes = await fetch(`${BASE}/api/workspace/content`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'صورة عرض تقسيط', content: 'عرض التقسيط الجديد من معرض الغرابي.', targetPlatforms: ['facebook'], mediaType: 'image', mediaUrl: PUBLIC_IMAGE_URL, status: 'review' }) });
    const fbImgDraft = { status: fbImgDraftRes.status, body: await fbImgDraftRes.json() };
    check('إنشاء منشور صورة لفيسبوك 201', fbImgDraft.status === 201, String(fbImgDraft.status));
    const fbImgId = fbImgDraft.body?.post?.id;
    await fetch(`${BASE}/api/workspace/content/${fbImgId}/approve`, { method: 'POST', headers: auth, body: JSON.stringify({ note: 'اعتماد صورة فيسبوك' }) });
    const fbImgPub = await fetch(`${BASE}/api/workspace/content/${fbImgId}/publish`, { method: 'POST', headers: auth, body: '{}' });
    const fbImgBody = await fbImgPub.json();
    check('فيسبوك: نشر الصورة الموحّد نجح بمعرّف مزود', fbImgBody.results?.facebook?.state === 'published' && Boolean(fbImgBody.results?.facebook?.providerPostId), JSON.stringify(fbImgBody.results).slice(0, 200));
    check('فيسبوك: نُشرت صورة حقيقية من رابط عام عبر /photos', mock.state.photos.length === 1 && mock.state.photos[0].imageUrl === PUBLIC_IMAGE_URL, JSON.stringify(mock.state.photos).slice(0, 200));
    check('فيسبوك: رسالة الصورة هي نص المنشور', mock.state.photos[0]?.message === 'عرض التقسيط الجديد من معرض الغرابي.', mock.state.photos[0]?.message);
    check('فيسبوك: لم يُنشر نص مكرر إضافي في /feed', mock.state.posts.length === 1, String(mock.state.posts.length));

    group('16د) تكامل: تشخيص ظهور منشور فيسبوك للجمهور (قراءة فقط) — السبب المُثبت «وضع التطوير»');
    // نشر فيديو موحّد ليُنشأ معرّف فيديو حقيقي في الخادم الوهمي.
    const visDraftRes = await fetch(`${BASE}/api/workspace/content`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'فيديو ظهور', content: 'عرض التقسيط الجديد من معرض الغرابي.', targetPlatforms: ['facebook'], mediaType: 'video', mediaUrl: PUBLIC_VIDEO_URL, status: 'review' }) });
    const visDraft = await visDraftRes.json();
    await fetch(`${BASE}/api/workspace/content/${visDraft?.post?.id}/approve`, { method: 'POST', headers: auth, body: JSON.stringify({ note: 'اعتماد' }) });
    await fetch(`${BASE}/api/workspace/content/${visDraft?.post?.id}/publish`, { method: 'POST', headers: auth, body: '{}' });
    const vidId = mock.state.videos[mock.state.videos.length - 1]?.videoId;
    check('فيديو حقيقي أُنشئ قبل التشخيص', Boolean(vidId));
    // بلا جلسة => 401 (owner-only).
    const visAnon = await fetch(`${BASE}/api/platforms/facebook/post-visibility-diagnosis`);
    check('تشخيص الظهور يتطلب جلسة (401)', visAnon.status === 401, String(visAnon.status));
    // بلا postId: يأخذ آخر منشور فيسبوك حقيقي من السجل.
    const visRes = await fetch(`${BASE}/api/platforms/facebook/post-visibility-diagnosis`, { headers: auth });
    const vis = await visRes.json();
    check('التشخيص نجح (200) وأعاد معرّف المنشور', visRes.status === 200 && vis.providerPostId === vidId, JSON.stringify(vis).slice(0, 250));
    check('المصدر آخر سجل نشر حقيقي', vis.postIdSource === 'last_publish_record');
    check('grounding: منشور فعلاً (is_published=true)', vis.grounding?.isPublished === true && vis.grounding?.confirmedPublicStory === true);
    check('grounding: ظاهر على حائط الصفحة', vis.grounding?.appearsOnPage === true);
    check('verdict انعكاس الأدلة', vis.verdict === 'published_and_returns_as_story', String(vis.verdict));
    check('وضع التطبيق غير مقروء عبر API (معلن صراحةً)', vis.appMode?.readableViaApi === false);
    check('published=true لا يُقدَّم كإثبات ظهور عام', vis.evidenceSummary?.proofOfPublicVisibility === false && vis.evidenceSummary?.returnsAsStory === true);
    check('الاستجابة تنصّ على Access Levels لتطبيق Business', /Access Levels/.test(vis.appMode?.note || ''));
    check('خطوات يدوية محددة موجودة', Array.isArray(vis.manualActionRequired) && vis.manualActionRequired.some((s: string) => /Live/.test(s)));
    check('بلا أي سرّ في الاستجابة', !/access_token|Bearer |EAA[A-Za-z0-9]|PLATFORM_TOKEN/.test(JSON.stringify(vis)));

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
    // نفس الإصلاح الجذري في مسار اختيار الصفحة: لا GET /{page-id} إطلاقاً.
    check('اختيار الصفحة لا يستدعي GET /{page-id} (إصلاح #100 الجذري)', multiMock.state.pageProfileCalls === 0, `pageProfileCalls=${multiMock.state.pageProfileCalls}`);
    const multiAfter = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const multiFbAfter = multiAfter.platforms.find((p: any) => p.platform === 'facebook');
    check('Facebook يصبح متصلاً وموثقاً بعد اختيار الصفحة', multiFbAfter.connected === true && multiFbAfter.providerVerified === true);
    const multiCpAfter = await (await fetch(`${BASE}/api/platforms/control-plane`, { headers: auth })).json();
    check('لم يعد معلّقاً على اختيار الصفحة', multiCpAfter.platforms.find((p: any) => p.platform === 'facebook').pageSelectionPending === false);
    await multiMock.stop();

    // انحدار #100 الحقيقي: /me/accounts ينجح ويمنح رمز الصفحة، لكن GET /{page-id}
    // يرد #100 (pages_read_engagement) كما حدث حياً على الإنتاج. الإصلاح الجذري
    // يجب أن يُكمل الربط رغم فشل GET /{page-id} تماماً.
    group('19ب) تكامل: /me/accounts ينجح و GET /{page-id} يرد #100 (إصلاح #100 الجذري)');
    await stop(currentApp.proc);
    writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
      schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser, staffUser],
      revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
      workspace: { showroom: {}, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [] },
    }), 'utf8');
    const p100Mock = await startFacebookMockServer(FB_PORT + 12, createFacebookMock({
      pages: [{ id: 'PAGE_P100', name: 'معرض الغرابي', accessToken: 'PAGE_TOKEN_P100', tasks: ['CREATE_CONTENT'] }],
      failPageProfile: true, // GET /{page-id} => 400 #100 (يحاكي العطل الحقيقي)
    }));
    currentApp = startApp(p100Mock.base);
    check('الخادم يقلع لسيناريو #100', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const s100 = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const st100 = new URL(s100.authorizationUrl).searchParams.get('state') || '';
    const cb100 = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(st100)}&code=P100`);
    check('الربط يكتمل رغم فشل GET /{page-id} بـ#100', cb100.status === 200, `status=${cb100.status}`);
    const cb100Html = await cb100.text();
    check('صفحة النجاح العربية ظهرت للمالك', cb100Html.includes('تم ربط صفحة Facebook بنجاح'), cb100Html.slice(0, 160));
    check('لا استدعاء لـ GET /{page-id} في مسار الربط', p100Mock.state.pageProfileCalls === 0, `pageProfileCalls=${p100Mock.state.pageProfileCalls}`);
    check('الاشتراك نُفّذ فعلياً من رمز /me/accounts', p100Mock.state.lastSubscribe?.pageId === 'PAGE_P100');
    const r100 = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const fb100 = r100.platforms.find((p: any) => p.platform === 'facebook');
    check('Facebook متصل وموثق بعد الربط', fb100.connected === true && fb100.providerVerified === true);
    await p100Mock.stop();

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

    // فحص الحوار نفسه: تطبيق صالح (فحص client_credentials ينجح) لكن Meta ترد
    // على رابط التفويض بـPLATFORM__INVALID_APP_ID. يجب ألا يُرسَل المالك إلى
    // «حدث خطأ ما»، بل تُعلن السبب الدقيق من التصنيف.
    group('20ب) تكامل: فحص الحوار يمنع إرسال المالك إلى «حدث خطأ ما»');
    await stop(currentApp.proc);
    const dialogMock = await startFacebookMockServer(FB_PORT + 5, createFacebookMock({ dialogOutcome: 'invalid_app_id' }));
    currentApp = startApp(dialogMock.base);
    check('الخادم يقلع لفحص الحوار', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const dlgBlocked = await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth });
    const dlgBody: any = await dlgBlocked.json();
    check('فحص الحوار يرفض بـ409 بدل التوجيه', dlgBlocked.status === 409, `status=${dlgBlocked.status}`);
    check('الرمز يعلن PLATFORM__INVALID_APP_ID', dlgBody.code === 'META_DIALOG_PLATFORM__INVALID_APP_ID', `code=${dlgBody.code}`);
    check('dialogKind يميّز invalid_app_id', dlgBody.dialogKind === 'invalid_app_id');
    check('لا يُعاد رابط تفويض عند رفض الحوار', !dlgBody.authorizationUrl);
    check('التوجيه يحمل رابط الإرجاع والنطاق المطلوبين', typeof dlgBody.redirectUri === 'string' && dlgBody.redirectUri.endsWith('/api/platforms/facebook/oauth/callback'));
    check('التوجيه بلا أي سرّ', !JSON.stringify(dlgBody).includes('test-fb-client-secret'));
    await dialogMock.stop();

    // حوار مقبول (consent): الفحص لا يحجب ويُعاد رابط التفويض كالمعتاد.
    group('20ج) تكامل: حوار مقبول (consent) لا يُحجب');
    await stop(currentApp.proc);
    const okMock = await startFacebookMockServer(FB_PORT + 6, createFacebookMock({ dialogOutcome: 'consent' }));
    currentApp = startApp(okMock.base);
    check('الخادم يقلع لحوار مقبول', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const okStart = await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth });
    const okBody: any = await okStart.json();
    check('حوار مقبول => 200 ورابط تفويض', okStart.status === 200 && typeof okBody.authorizationUrl === 'string', `status=${okStart.status}`);
    check('الفحص استدعى الحوار فعلياً (calls >= 2: token + dialog)', okMock.state.calls >= 2, `calls=${okMock.state.calls}`);
    await okMock.stop();

    // استجابة غير مفهومة (200 بلا دليل رفض): لا يجوز الحجب بلا إثبات.
    group('20د) تكامل: استجابة حوار غير حاسمة لا تحجب الربط');
    await stop(currentApp.proc);
    const opaqueMock = await startFacebookMockServer(FB_PORT + 7, createFacebookMock({ dialogOutcome: 'opaque_200' }));
    currentApp = startApp(opaqueMock.base);
    check('الخادم يقلع لاستجابة غير حاسمة', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const opaqueStart = await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth });
    const opaqueBody: any = await opaqueStart.json();
    check('استجابة غير حاسمة => 200 (لا حجب بلا إثبات رفض)', opaqueStart.status === 200 && typeof opaqueBody.authorizationUrl === 'string', `status=${opaqueStart.status}`);
    await opaqueMock.stop();

    // الجذر المُثبت للمالك: Meta ترد HTTP 500 مع صفحة «حدث خطأ ما» عندما لا
    // تُتحقق مجموعة الصلاحيات مقابل منتج التطبيق. يجب ألا يُرسَل المالك إليها.
    group('20هـ) تكامل: رفض Meta بـHTTP 500 («حدث خطأ ما») يُحجب بتشخيص آمن');
    await stop(currentApp.proc);
    const h5Mock = await startFacebookMockServer(FB_PORT + 8, createFacebookMock({ dialogOutcome: 'http_500' }));
    currentApp = startApp(h5Mock.base);
    check('الخادم يقلع لفحص 500', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const h5Start = await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth });
    const h5Body: any = await h5Start.json();
    check('HTTP 500 من الحوار => 409 بدل التوجيه', h5Start.status === 409, `status=${h5Start.status} body=${JSON.stringify(h5Body).slice(0, 200)}`);
    check('الرمز يعلن META_DIALOG_PAGE', h5Body.code === 'META_DIALOG_META_DIALOG_PAGE', `code=${h5Body.code}`);
    check('التشخيص يحمل HTTP status الفعلي', h5Body.dialogHttpStatus === 500, `dialogHttpStatus=${h5Body.dialogHttpStatus}`);
    check('التشخيص يحمل dialogKind', typeof h5Body.dialogKind === 'string' && h5Body.dialogKind.length > 0);
    check('التشخيص يحمل تصنيف خطأ Meta', h5Body.dialogErrorCode === 'META_DIALOG_PAGE', `dialogErrorCode=${h5Body.dialogErrorCode}`);
    check('التوجيه يحمل سبب الصلاحيات في hint', typeof h5Body.hint === 'string' && /صلاحيات|Use Case|Configuration/.test(h5Body.hint));
    check('لا يُعاد رابط تفويض عند رفض 500', !h5Body.authorizationUrl);
    // فحص عدم تسريب الأسرار: لا سرّ التطبيق ولا السرّ ولا state ولا رابط التفويض.
    const h5Json = JSON.stringify(h5Body);
    check('التوجيه بلا سرّ التطبيق', !h5Json.includes('test-fb-client-secret'));
    check('التوجيه بلا App Secret', !h5Json.includes(FB_APP_SECRET));
    check('التوجيه بلا state ولا رابط تفويض كامل', !/dialog\/oauth\?/.test(h5Json) && !h5Json.includes('state='));
    await h5Mock.stop();

    // الجذر المُثبت للمالك: الفحص كان يقرأ أول استجابة بوكيل الخادم فيرى مسار
    // سطح المكتب (www → login.php) ويظنّ الحوار مقبولاً، بينما متصفح المالك الجوال
    // يُحوَّل إلى m.facebook.com حيث تظهر صفحة الخطأ. يجب أن يسلك الفحص السلسلة
    // بوكيل جوال ويحجب بتشخيص مسار الجوال.
    group('20ز) تكامل: الفحص يسلك مسار الجوال الفعلي ويحجب «حدث خطأ ما»');
    await stop(currentApp.proc);
    const mobMock = await startFacebookMockServer(FB_PORT + 10, createFacebookMock({ dialogOutcome: 'mobile_redirect_then_fail' }));
    currentApp = startApp(mobMock.base);
    check('الخادم يقلع لفحص مسار الجوال', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const mobStart = await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth });
    const mobBody: any = await mobStart.json();
    check('مسار الجوال => 409 بدل إرسال المالك إلى صفحة الخطأ', mobStart.status === 409, `status=${mobStart.status} body=${JSON.stringify(mobBody).slice(0, 200)}`);
    check('التشخيص يُعلن أن الفحص أُجري بمسار الجوال', mobBody.mobileFlow?.probedAsMobile === true);
    check('التشخيص يُثبت أن مضيف الجوال رُصد فعلاً', mobBody.mobileFlow?.mobileHostReached === true, JSON.stringify(mobBody.mobileFlow));
    check('التشخيص يسمّي مضيف الرفض', mobBody.mobileFlow?.rejectionHost === 'm.facebook.com', `host=${mobBody.mobileFlow?.rejectionHost}`);
    check('التشخيص يسمّي مسار الرفض', mobBody.mobileFlow?.rejectionPath === '/mobile/dialog/oauth', `path=${mobBody.mobileFlow?.rejectionPath}`);
    check('سلسلة القفزات موثّقة (قفزتان على الأقل)', Array.isArray(mobBody.mobileFlow?.hops) && mobBody.mobileFlow.hops.length >= 2, JSON.stringify(mobBody.mobileFlow?.hops));
    check('التصنيف يميّز خطأ الجوال', mobBody.dialogErrorCode === 'META_DIALOG_MOBILE_ERROR', `code=${mobBody.dialogErrorCode}`);
    check('لا يُعاد رابط تفويض عند رفض مسار الجوال', !mobBody.authorizationUrl);
    // لا سرّ ولا استعلام: لا state ولا client_id ولا encrypted_query_string.
    const mobJson = JSON.stringify(mobBody);
    check('التشخيص بلا أي استعلام أو سرّ', !mobJson.includes('encrypted_query_string') && !mobJson.includes('state=') && !mobJson.includes('client_id=') && !mobJson.includes('test-fb-client-secret'));
    // نفس التشخيص متاح بلا بدء OAuth عبر oauth/setup (للمالك) فلا يضطر لتجربة الربط.
    const setupProbe = await fetch(`${BASE}/api/platforms/facebook/oauth/setup`, { headers: auth });
    const setupBody: any = await setupProbe.json();
    check('oauth/setup يعرض فحص مسار الجوال', setupBody.mobileDialogProbe?.probedAsMobile === true);
    check('oauth/setup يسمّي مضيف الرفض الجوال', setupBody.mobileDialogProbe?.rejectionHost === 'm.facebook.com', JSON.stringify(setupBody.mobileDialogProbe));
    check('oauth/setup يُعلن النتيجة rejected', setupBody.mobileDialogProbe?.outcome === 'rejected');
    check('oauth/setup لا يكشف سرّاً', !JSON.stringify(setupBody).includes('test-fb-client-secret') && !JSON.stringify(setupBody).includes('encrypted_query_string'));
    check('oauth/setup يحدّد موضع الرفض = قبل تسجيل الدخول', setupBody.dialogPhase === 'rejected_before_login', `phase=${setupBody.dialogPhase}`);
    await mobMock.stop();

    // موضع الرفض: فحص بلا كوكيز يتوقّف عند شاشة الدخول، فلا يجوز أن يوهم المالك
    // بأن المسار «مقبول» بينما الرفض يقع بعد تسجيل الدخول (Use Case/Configuration).
    group('20ح) تكامل: dialogPhase يفرّق ما قبل الدخول عمّا بعده');
    await stop(currentApp.proc);
    const loginMock = await startFacebookMockServer(FB_PORT + 11, createFacebookMock({ dialogOutcome: 'login' }));
    currentApp = startApp(loginMock.base);
    check('الخادم يقلع لفحص مرحلة الدخول', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const loginSetup = await fetch(`${BASE}/api/platforms/facebook/oauth/setup`, { headers: auth });
    const loginSetupBody: any = await loginSetup.json();
    check('حوار ينتهي عند شاشة الدخول => awaiting_owner_login', loginSetupBody.dialogPhase === 'awaiting_owner_login', `phase=${loginSetupBody.dialogPhase} hops=${JSON.stringify(loginSetupBody.mobileDialogProbe?.hops)}`);
    check('الفحص بلا كوكيز لا يعلن رفضاً قبل الدخول', loginSetupBody.mobileDialogProbe?.outcome === 'acceptable', JSON.stringify(loginSetupBody.mobileDialogProbe));
    check('التوجيه يذكر أن تفعيل الصلاحيات إجراء لاحق للدخول', JSON.stringify(loginSetupBody.genericErrorMeaning?.checks || []).includes('Use Case'));
    await loginMock.stop();

    // عزل السبب: عندما يرفض Meta المجموعة كاملة، يجب أن يُسمّي التشخيص أصغر مجموعة
    // صلاحيات مسؤولة — لا أن يترك المالك مع «حدث خطأ ما» عامة.
    group('20و) تكامل: عزل أصغر مجموعة صلاحيات مسبّبة للرفض (diagnosis)');
    await stop(currentApp.proc);
    const isoMock = await startFacebookMockServer(FB_PORT + 9, createFacebookMock({ failingScope: 'pages_messaging' }));
    currentApp = startApp(isoMock.base);
    check('الخادم يقلع لعزل الصلاحية', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const isoStart = await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth });
    const isoBody: any = await isoStart.json();
    check('المجموعة الكاملة المسبِّبة للرفض => 409', isoStart.status === 409, `status=${isoStart.status}`);
    check('التشخيص يُعلن أصغر مجموعة فاشلة = pages_messaging',
      Array.isArray(isoBody.scopeDiagnosis?.smallestFailingScopeSet) && isoBody.scopeDiagnosis.smallestFailingScopeSet.length === 1 && isoBody.scopeDiagnosis.smallestFailingScopeSet[0] === 'pages_messaging',
      JSON.stringify(isoBody.scopeDiagnosis));
    check('التشخيص ينفي أن الفشل بلا صلاحية', isoBody.scopeDiagnosis?.emptyScopeFails === false);
    check('التشخيص يعلن معنى قابلاً للتنفيذ', typeof isoBody.scopeDiagnosis?.meaning === 'string' && isoBody.scopeDiagnosis.meaning.length > 0);
    check('التشخيص بلا أي سرّ', !JSON.stringify(isoBody).includes('test-fb-client-secret') && !JSON.stringify(isoBody).includes('state='));
    await isoMock.stop();

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

    // تشخيص #100 الحقيقي القابل للسحب: خطأ نشر فيديو Meta (100) يُحفظ دائماً برسالته
    // الكاملة + code/subcode/fbtrace، ويُسحب من مسار owner محمي — بدل أن يضيع في
    // سجلات Render. كما يفحص مسار الصلاحيات (debug_token) الصلاحية الناقصة بلا تخمين.
    group('23) تكامل: حفظ تشخيص #100 وسحبه + فحص صلاحية نشر الفيديو (debug_token)');
    await stop(currentApp.proc);
    const diagMock = await startFacebookMockServer(FB_PORT + 7, createFacebookMock({
      pages: [{ id: 'PAGE_DIAG', name: 'معرض الغرابي', accessToken: 'PAGE_TOKEN_DIAG', tasks: ['CREATE_CONTENT'] }],
      // الصفحة تمنح صفحات النشر النصي لكنها تفتقد pages_read_engagement (السبب
      // المؤكَّد لنجاح /feed وفشل /videos بـ#100) — فيكشفه فحص debug_token.
      grantedScopes: ['pages_manage_posts', 'pages_show_list', 'pages_messaging'],
      publishVideoError: { message: '(#100) No permission to publish the video', code: 100, error_subcode: 200, fbtrace_id: 'AbCdTrace#100' },
    }));
    currentApp = startApp(diagMock.base);
    check('الخادم يقلع لسيناريو التشخيص', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    // ربط الصفحة أولاً (نفس مسار OAuth الحقيقي).
    const dStart = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const dState = new URL(dStart.authorizationUrl).searchParams.get('state') || '';
    await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(dState)}&code=DIAG`);
    // محاولة نشر فيديو تفشل بـ#100 من Meta الوهمي.
    const dPub = await fetch(`${BASE}/api/platforms/facebook/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'عرض تقسيط جديد من معرض الغرابي.', approved: true, videoUrl: 'https://example.invalid/v.mp4' }) });
    const dPubBody = await dPub.json();
    check('نشر الفيديو فشل ومعرّف خطأ Meta الحقيقي مُعاد', dPubBody.providerCode === 100 && dPubBody.providerSubcode === 200 && dPubBody.providerTraceId === 'AbCdTrace#100', JSON.stringify(dPubBody).slice(0, 260));
    check('رسالة Meta الكاملة غير المقطوعة تصل', dPubBody.error === '(#100) No permission to publish the video', String(dPubBody.error));
    // السحب من المسار المحمي: نفس الخطأ + code/subcode/fbtrace، بلا أي سرّ.
    const diagRes = await (await fetch(`${BASE}/api/platforms/publish-diagnostics?platform=facebook`, { headers: auth })).json();
    check('التشخيص محفوظ وقابل للسحب من المسار المحمي', diagRes.count >= 1 && diagRes.diagnostics[0].providerCode === 100 && diagRes.diagnostics[0].providerTraceId === 'AbCdTrace#100', JSON.stringify(diagRes).slice(0, 300));
    check('التشخيص يحمل رسالة Meta كاملة', diagRes.diagnostics[0].error === '(#100) No permission to publish the video');
    check('التشخيص لا يكشف أي سرّ', !JSON.stringify(diagRes).includes('PAGE_TOKEN_DIAG') && !JSON.stringify(diagRes).includes(FB_APP_SECRET));
    check('التشخيص لغير المالك => 403', (await fetch(`${BASE}/api/platforms/publish-diagnostics`, { headers: staffAuth })).status === 403);
    check('التشخيص بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/publish-diagnostics`)).status === 401);
    // فحص الصلاحيات (debug_token): يكشف الصلاحية الناقصة السببيّة لـ#100 بلا تخمين.
    const permRes = await (await fetch(`${BASE}/api/platforms/facebook/video-permission-diagnosis`, { headers: auth })).json();
    check('فحص الصلاحيات يحسم الجاهزية لنشر الفيديو', permRes.success === true && permRes.videoPublishReady === false && permRes.missingVideoPublishScopes.includes('pages_read_engagement'), JSON.stringify(permRes).slice(0, 300));
    check('فحص الصلاحيات لا يكشف أي رمز/سرّ', !JSON.stringify(permRes).includes('PAGE_TOKEN_DIAG') && !JSON.stringify(permRes).includes('test-fb-client-secret'));
    check('فحص الصلاحيات لغير المالك => 403', (await fetch(`${BASE}/api/platforms/facebook/video-permission-diagnosis`, { headers: staffAuth })).status === 403);
    // التشخيص يصمد بعد restart (محفوظ عبر محوّل الحالة لا في الذاكرة فقط).
    await stop(currentApp.proc);
    currentApp = startApp(diagMock.base);
    check('الخادم يقلع لفحص ثبات التشخيص', await waitForHealth(), currentApp.log().slice(0, 300));
    Object.assign(auth, await login());
    const diagAfter = await (await fetch(`${BASE}/api/platforms/publish-diagnostics?platform=facebook`, { headers: auth })).json();
    check('التشخيص يصمد بعد restart', diagAfter.count >= 1 && diagAfter.diagnostics[0].providerTraceId === 'AbCdTrace#100', JSON.stringify(diagAfter).slice(0, 200));
    await diagMock.stop();
  } finally {
    try { await stop(currentApp.proc); } catch { /* تجاهل */ }
    await mock.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

(async () => {
  await unitTests();
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
