/**
 * Batch 6 — اختبار أساس تكامل المنصات المتعدد.
 *
 * يثبت:
 * 1) مصفوفة الجاهزية مشتقة من السجل الحقيقي (لا حالة اتصال مزيفة، لا بيانات وهمية).
 * 2) أساس OAuth: state/CSRF/PKCE/انتهاء الصلاحية/منع إعادة الاستخدام.
 * 3) أساس webhook: التحقق من التوقيع (HMAC/ترويسة)، replay/idempotency، التطبيع.
 * 4) أساس التحليلات: NOT_SUPPORTED بلا صفر وهمي.
 * 5) عقد مسارات الخادم الجديدة (readiness-matrix / webhook / publish / metrics).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { PLATFORM_SPECS, platformSupports } from '../social/registry';
import { PLATFORM_READINESS, readinessFor, readinessSummary } from '../social/readiness';
import {
  createOAuthState,
  createPkcePair,
  requiresPkce,
  isStateExpired,
  validateOAuthCallback,
  buildAuthorizationParams,
  buildTokenExchangeBody,
  parseTokenResponse,
  formatOAuthProviderError,
  isAccessTokenExpired,
  isPlausibleLoginConfigId,
  resolveLoginConfigId,
  inspectLoginConfigId,
  OAUTH_STATE_TTL_MS,
} from '../social/oauth';
import {
  secretHeaderVerifier,
  hmacSignatureVerifier,
  isReplayOrDuplicate,
  isValidWebhookPayload,
  buildNormalizedEvent,
} from '../social/webhook';
import { fetchPostMetrics, fetchAccountMetrics, fetchEngagement, isHonestMetricResult } from '../social/analytics';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();
const serverSource = readFileSync(join(REPO_ROOT, 'server.ts'), 'utf8');

function run(): void {
  // ---------- 1) مصفوفة الجاهزية ----------
  check('المصفوفة تغطي عشر منصات', PLATFORM_READINESS.length === 10, `count=${PLATFORM_READINESS.length}`);
  check('المصفوفة بلا تكرار', new Set(PLATFORM_READINESS.map((r) => r.platform)).size === 10);
  check('كل صف يطابق السجل (اسم ووضع اعتماد)',
    PLATFORM_READINESS.every((r) => {
      const spec = PLATFORM_SPECS.find((s) => s.platform === r.platform)!;
      return spec.displayName === r.displayName && spec.credentialMode === r.credentialMode;
    }));
  // CONNECTOR_READY = موصل منفّذ فعلاً في الكود. Telegram ثم Facebook ثم Instagram
  // ثم TikTok ثم YouTube ثم Threads (Task #24).
  check('الموصلات المنفّذة CONNECTOR_READY = telegram,facebook,instagram,tiktok,youtube,threads', PLATFORM_READINESS.filter((r) => r.implementationStatus === 'CONNECTOR_READY').map((r) => r.platform).sort().join(',') === 'facebook,instagram,telegram,threads,tiktok,youtube');
  check('كل بقية المنصات FOUNDATION_READY', PLATFORM_READINESS.filter((r) => !['telegram', 'facebook', 'instagram', 'tiktok', 'youtube', 'threads'].includes(r.platform)).every((r) => r.implementationStatus === 'FOUNDATION_READY'));
  check('المصفوفة لا تحمل حالة اتصال تشغيلية', PLATFORM_READINESS.every((r) => !('connected' in r) && !('providerVerified' in r) && ['READY', 'EXTERNAL_SETUP_REQUIRED', 'NOT_SUPPORTED'].includes(r.connection)));
  check('حقول الجاهزية كلها قيم معروفة',
    PLATFORM_READINESS.every((r) => [r.connector, r.oauth, r.connection, r.verification, r.webhook, r.read, r.reply, r.publish, r.schedule, r.analytics].every((v) => ['READY', 'EXTERNAL_SETUP_REQUIRED', 'NOT_SUPPORTED'].includes(v))));
  check('كل منصة لها متطلبات خارجية معلنة', PLATFORM_READINESS.every((r) => Array.isArray(r.externalSetup) && r.externalSetup.length > 0));
  check('متطلبات Telegram الخارجية لا تحمل أي قيمة سرّية', PLATFORM_READINESS.find((r) => r.platform === 'telegram')!.externalSetup.every((s) => !/[A-Za-z0-9_-]{30,}/.test(s)));
  // القدرات في المصفوفة تعكس السجل بدقة.
  check('whatsapp: نشر NOT_SUPPORTED ورسائل متاحة',
    readinessFor('whatsapp')!.publish === 'NOT_SUPPORTED' && readinessFor('whatsapp')!.read !== 'NOT_SUPPORTED');
  check('snapchat: رد NOT_SUPPORTED (لا تعليقات)',
    readinessFor('snapchat')!.reply === 'NOT_SUPPORTED' && readinessFor('snapchat')!.read === 'NOT_SUPPORTED');
  check('google_business: رد NOT_SUPPORTED', readinessFor('google_business')!.reply === 'NOT_SUPPORTED');
  check('telegram: نشر ورد READY', readinessFor('telegram')!.publish === 'READY' && readinessFor('telegram')!.reply === 'READY');
  check('snapchat: webhook NOT_SUPPORTED', readinessFor('snapchat')!.webhook === 'NOT_SUPPORTED');
  check('facebook: webhook منفّذ (READY)', readinessFor('facebook')!.webhook === 'READY');
  check('كل منصة تدعم الرد يجب أن تدعم القراءة', PLATFORM_READINESS.every((r) => r.reply !== 'READY' || r.read !== 'NOT_SUPPORTED'));
  check('readinessFor يرفض المجهول', readinessFor('myspace') === null);
  const sum = readinessSummary();
  check('ملخص الجاهزية صحيح', sum.total === 10 && sum.connectorReady === 6 && sum.foundationReady === 4);

  // ---------- 2) أساس OAuth ----------
  const s1 = createOAuthState();
  const s2 = createOAuthState();
  check('state عشوائي قوي وفريد', s1.length === 48 && s1 !== s2 && /^[0-9a-f]+$/.test(s1));
  const pkce = createPkcePair();
  check('PKCE: التحدي = sha256(verifier) base64url',
    pkce.challenge === crypto.createHash('sha256').update(pkce.verifier).digest('base64url'));
  check('PKCE مطلوب لـX فقط (TikTok ويب لا يستخدمه)', requiresPkce('x') && !requiresPkce('tiktok') && !requiresPkce('facebook'));
  const pending = { platform: 'facebook', userId: 'owner', expiresAt: Date.now() + 1000, redirectUri: 'https://app/cb' };
  check('state صالح قبل الانتهاء', !isStateExpired(pending));
  check('state منتهٍ بعد الانتهاء', isStateExpired(pending, Date.now() + 5000));
  check('callback مطابق مقبول', validateOAuthCallback({ pending, platform: 'facebook', redirectUri: 'https://app/cb' }).ok);
  check('callback منصة مختلفة مرفوض', !validateOAuthCallback({ pending, platform: 'x', redirectUri: 'https://app/cb' }).ok);
  check('callback redirect مختلف مرفوض', !validateOAuthCallback({ pending, platform: 'facebook', redirectUri: 'https://evil/cb' }).ok);
  check('callback state مجهول مرفوض', !validateOAuthCallback({ pending: undefined, platform: 'facebook', redirectUri: 'https://app/cb' }).ok);
  check('callback منتهٍ مرفوض', !validateOAuthCallback({ pending, platform: 'facebook', redirectUri: 'https://app/cb', now: Date.now() + 5000 }).ok);
  check('TTL state عشر دقائق', OAUTH_STATE_TTL_MS === 600000);
  // TikTok: تدفّق الويب الرسمي بلا PKCE (العقد الرسمي للويب) — حتى لو مُرّر تحدٍّ يُهمَل.
  const tkParams = buildAuthorizationParams({ platform: 'tiktok', clientId: 'ck', redirectUri: 'r', scopes: ['a', 'b'], state: 'st', pkceChallenge: 'ch' });
  check('TikTok: client_key وscope بفواصل بلا code_challenge', tkParams.client_key === 'ck' && tkParams.scope === 'a,b' && tkParams.code_challenge === undefined);
  const gParams = buildAuthorizationParams({ platform: 'youtube', clientId: 'cid', redirectUri: 'r', scopes: ['s1', 's2'], state: 'st' });
  check('Google: client_id وoffline وconsent', gParams.client_id === 'cid' && gParams.access_type === 'offline' && gParams.prompt === 'consent' && gParams.scope === 's1 s2');
  // Meta: scope بفواصل وبلا access_type/prompt (معاملان خاصان بـGoogle).
  const fParams = buildAuthorizationParams({ platform: 'facebook', clientId: '145634995501895', redirectUri: 'r', scopes: ['pages_show_list', 'pages_messaging'], state: 'st' });
  check('Meta: scope بفواصل', fParams.scope === 'pages_show_list,pages_messaging');
  check('Meta: بلا access_type ولا prompt', fParams.access_type === undefined && fParams.prompt === undefined);
  check('Meta: client_id هو نفس المعرّف', fParams.client_id === '145634995501895');
  // Facebook Login for Business: config_id يحلّ محل scope ولا يُرسَلان معاً.
  const cfgParams = buildAuthorizationParams({ platform: 'facebook', clientId: '145634995501895', redirectUri: 'r', scopes: ['pages_show_list'], state: 'st', loginConfigId: '1003753455711313' });
  check('config_id يُرسَل بدل scope', cfgParams.config_id === '1003753455711313' && cfgParams.scope === undefined);
  check('config_id لا يُخِلّ بـresponse_type/state/redirect_uri', cfgParams.response_type === 'code' && cfgParams.state === 'st' && cfgParams.redirect_uri === 'r');
  const igNoCfg = buildAuthorizationParams({ platform: 'instagram', clientId: '145634995501895', redirectUri: 'r', scopes: ['instagram_basic'], state: 'st' });
  check('بلا config_id يبقى scope لـInstagram', igNoCfg.scope === 'instagram_basic' && igNoCfg.config_id === undefined);
  // config_id مُطبَّق: يحلّ محل scope **و**يُلغي extras/display (الConfiguration تحدّد
  // الصلاحيات وتجربة الدخول). هذا هو المخرج المُثبت لتطبيق Meta من نوع Business.
  const igCfg = buildAuthorizationParams({ platform: 'instagram', clientId: '145634995501895', redirectUri: 'r', scopes: ['instagram_basic'], state: 'st', loginConfigId: '1003753455711313', instagramOnboarding: true });
  check('Instagram: config_id يحلّ محل scope', igCfg.config_id === '1003753455711313' && igCfg.scope === undefined);
  check('Instagram: config_id يُلغي extras/display أيضاً', igCfg.extras === undefined && igCfg.display === undefined && igCfg.response_type === 'code');
  check('Instagram: config_id لا يُخِلّ بـstate/redirect_uri', igCfg.state === 'st' && igCfg.redirect_uri === 'r' && igCfg.client_id === '145634995501895');
  const threadsParams = buildAuthorizationParams({ platform: 'threads', clientId: 'c', redirectUri: 'r', scopes: ['threads_basic'], state: 'st', loginConfigId: '1003753455711313' });
  check('Threads لا يستخدم config_id (ليس مسار Facebook Login)', threadsParams.config_id === undefined && threadsParams.scope === 'threads_basic');
  // صيغة Configuration ID: أرقام فقط؛ أي مسافة/حرف يُرفض.
  check('Configuration ID صالح: أرقام فقط', isPlausibleLoginConfigId('1003753455711313'));
  check('Configuration ID مرفوض: مسافة زائدة', !isPlausibleLoginConfigId('1003753455711313 '));
  check('Configuration ID مرفوض: حروف', !isPlausibleLoginConfigId('abc123456'));
  check('Configuration ID مرفوض: قصير جداً', !isPlausibleLoginConfigId('123'));
  check('Configuration ID مرفوض: غير نص', !isPlausibleLoginConfigId(123456789));
  const igConfigEnv = { INSTAGRAM_LOGIN_CONFIG_ID: '1003753455711313', FACEBOOK_LOGIN_CONFIG_ID: '999999999999999' };
  check('أولوية Instagram على Facebook في الحسم', resolveLoginConfigId('instagram', igConfigEnv) === '1003753455711313');
  check('Facebook يستخدم معرّفه وحده', resolveLoginConfigId('facebook', igConfigEnv) === '999999999999999');
  check('غياب كامل => null', resolveLoginConfigId('instagram', {}) === null);
  check('قيمة غير صالحة => null (لا تُمرَّر للمزود)', resolveLoginConfigId('instagram', { INSTAGRAM_LOGIN_CONFIG_ID: 'bad id' }) === null);
  const cfgInspect = inspectLoginConfigId('instagram', { INSTAGRAM_LOGIN_CONFIG_ID: '1003753455711313 ' });
  check('المسافة الزائدة تُطبَّع ولا تُبطل القيمة (كبقية الأسرار)', cfgInspect.configured === true && cfgInspect.valid === true && cfgInspect.normalized === true);
  const cfgInvalid = inspectLoginConfigId('instagram', { INSTAGRAM_LOGIN_CONFIG_ID: 'not-a-number' });
  check('المضبوط غير الرقمي يُعلن غير صالح بسبب صريح', cfgInvalid.configured === true && cfgInvalid.valid === false && cfgInvalid.problems.length === 1);
  check('الفحص يعلن اسم المتغير بلا قيمة', cfgInvalid.envName === 'INSTAGRAM_LOGIN_CONFIG_ID' && !JSON.stringify(cfgInvalid).includes('not-a-number'));
  check('الفحص عند الغياب: غير مضبوط وغير صالح', inspectLoginConfigId('instagram', {}).configured === false && inspectLoginConfigId('instagram', {}).valid === false);
  const body = buildTokenExchangeBody({ clientId: 'c', clientSecret: 's', code: 'code', redirectUri: 'r', codeVerifier: 'v' });
  check('جسم التبادل يحمل الحقول الرسمية', body.get('grant_type') === 'authorization_code' && body.get('code_verifier') === 'v');
  check('parseTokenResponse: رمز صالح', parseTokenResponse({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }).valid);
  check('parseTokenResponse: بلا access_token مرفوض', !parseTokenResponse({}).valid);
  check('parseTokenResponse: مشوّه مرفوض', !parseTokenResponse(null).valid);
  // خطأ Meta/Threads يستخدم error_message/error_code لا error_description؛ يجب ألا يُخفى.
  const threadsErr = formatOAuthProviderError({ error_message: 'Invalid Request: The user has not accepted the invite to test the app.', error_code: 1349245 });
  check('خطأ Threads يُعرض برسالته الحقيقية ورمزها', threadsErr === 'Invalid Request: The user has not accepted the invite to test the app. (error_code: 1349245)', String(threadsErr));
  check('parseTokenResponse يحمل رسالة Threads الحقيقية لا نصاً عاماً', parseTokenResponse({ error_message: 'The user has not accepted the invite to test the app', error_code: 1349245 }).reason?.includes('has not accepted the invite') === true);
  check('خطأ Google (error_description) يبقى مدعوماً', formatOAuthProviderError({ error: 'invalid_grant', error_description: 'Bad Request' }) === 'Bad Request');
  check('بلا رسالة => null', formatOAuthProviderError({}) === null);
  check('الرمز موجود مع خطأ => لا يُعيد خطأ (نجاح يغلب)', parseTokenResponse({ access_token: 'a', error_message: 'ignored' }).valid === true);
  check('انتهاء access token محسوب بهامش', isAccessTokenExpired({ expiresAt: Date.now() + 10_000 }) && !isAccessTokenExpired({ expiresAt: Date.now() + 10 * 60_000 }));
  check('بلا انتهاء معلن لا نحكم بالانتهاء', !isAccessTokenExpired({ expiresAt: null }));

  // ---------- 3) أساس webhook ----------
  const shVerifier = secretHeaderVerifier('x-telegram-bot-api-secret-token');
  check('ترويسة سرّية صحيحة مقبولة', shVerifier.verify({ headers: { 'x-telegram-bot-api-secret-token': 'sekret' }, rawBody: '', secret: 'sekret' }).ok);
  check('ترويسة سرّية خاطئة مرفوضة', !shVerifier.verify({ headers: { 'x-telegram-bot-api-secret-token': 'wrong' }, rawBody: '', secret: 'sekret' }).ok);
  check('ترويسة غائبة مرفوضة', !shVerifier.verify({ headers: {}, rawBody: '', secret: 'sekret' }).ok);
  check('سرّ غير مضبوط مرفوض', !shVerifier.verify({ headers: { 'x-telegram-bot-api-secret-token': 'sekret' }, rawBody: '', secret: '' }).ok);
  const hmacVerifier = hmacSignatureVerifier('x-hub-signature-256');
  const rawBody = '{"entry":[]}';
  const sig = 'sha256=' + crypto.createHmac('sha256', 'appsecret').update(rawBody, 'utf8').digest('hex');
  check('توقيع HMAC صحيح مقبول', hmacVerifier.verify({ headers: { 'x-hub-signature-256': sig }, rawBody, secret: 'appsecret' }).ok);
  check('توقيع HMAC معدّل مرفوض', !hmacVerifier.verify({ headers: { 'x-hub-signature-256': sig }, rawBody: '{"entry":[1]}', secret: 'appsecret' }).ok);
  check('توقيع HMAC بسرّ مختلف مرفوض', !hmacVerifier.verify({ headers: { 'x-hub-signature-256': sig }, rawBody, secret: 'other' }).ok);
  check('توقيع غائب مرفوض', !hmacVerifier.verify({ headers: {}, rawBody, secret: 'appsecret' }).ok);
  check('منع replay على معرّف حدث', isReplayOrDuplicate({ providerEventId: 5, externalId: 'e5', seenProviderEventIds: [5], seenExternalIds: [] }));
  check('منع تكرار على معرّف خارجي', isReplayOrDuplicate({ providerEventId: 9, externalId: 'e5', seenProviderEventIds: [], seenExternalIds: ['e5'] }));
  check('حدث جديد غير مكرر', !isReplayOrDuplicate({ providerEventId: 9, externalId: 'e9', seenProviderEventIds: [5], seenExternalIds: ['e5'] }));
  check('حمولة صالحة = كائن', isValidWebhookPayload({ a: 1 }) && !isValidWebhookPayload([]) && !isValidWebhookPayload(null));
  const norm = buildNormalizedEvent({ platform: 'facebook', kind: 'comment', externalId: 'c1', text: 'سعر؟', authorName: 'أحمد' });
  check('التطبيع يبني حدثاً موحّداً', norm.platform === 'facebook' && norm.externalId === 'c1' && norm.kind === 'comment' && norm.authorName === 'أحمد');

  // ---------- 4) أساس التحليلات ----------
  const post = fetchPostMetrics('youtube', 'p1', { views: 100, likes: 5 });
  check('المؤشر المتاح يأخذ قيمته الفعلية', post.metrics.find((m) => m.metric === 'views')!.status === 'SUPPORTED' && post.metrics.find((m) => m.metric === 'views')!.value === 100);
  check('المؤشر غير المدعوم NOT_SUPPORTED بلا قيمة', post.metrics.find((m) => m.metric === 'shares')!.status === 'NOT_SUPPORTED' && post.metrics.find((m) => m.metric === 'shares')!.value === undefined);
  check('مؤشر مدعوم بلا قيمة فعلية لا يصبح صفراً', post.metrics.find((m) => m.metric === 'comments')!.status === 'NOT_SUPPORTED');
  check('الصفر الحقيقي يبقى صفراً', fetchPostMetrics('youtube', 'p1', { views: 0 }).metrics.find((m) => m.metric === 'views')!.value === 0);
  check('whatsapp بلا أي مؤشر مدعوم', fetchAccountMetrics('whatsapp', { views: 10 }).metrics.every((m) => m.status === 'NOT_SUPPORTED'));
  check('envelope صادق دائماً', fetchEngagement('facebook', 'p1', { likes: 3 }).metrics.every(isHonestMetricResult));
  check('ملاحظة عدم الإتاحة تُعلن صراحةً', Boolean(fetchAccountMetrics('whatsapp', {}).note));

  // ---------- 5) عقد مسارات الخادم ----------
  check('مسار readiness-matrix موجود', serverSource.includes('/api/platforms/readiness-matrix'));
  check('مسار readiness لكل منصة موجود', serverSource.includes('/api/platforms/:platform/readiness'));
  check('مسار webhook GET (challenge) موجود', serverSource.includes('hub.verify_token'));
  check('مسار webhook POST يتحقق بـHMAC', serverSource.includes('webhookVerifierFor') && serverSource.includes('x-hub-signature-256'));
  check('webhook يحفظ الجسم الخام للتحقق', serverSource.includes('req.rawBody = buf'));
  check('مسار النشر الموحّد يعلن CAPABILITY_NOT_SUPPORTED', serverSource.includes('CAPABILITY_NOT_SUPPORTED'));
  check('مسار النشر يعلن EXTERNAL_SETUP_REQUIRED', serverSource.includes('EXTERNAL_SETUP_REQUIRED'));
  check('مسار النشر يمر عبر حارس السلامة', /async function executePlatformPublish[\s\S]{0,5000}analyzeBusinessClaims/.test(serverSource) && /\/api\/platforms\/:platform\/publish[\s\S]{0,300}executePlatformPublish/.test(serverSource));
  check('مسار المؤشرات موجود ويعلن NOT_SUPPORTED', serverSource.includes('/api/platforms/:platform/metrics'));
  check('OAuth start يستخدم منصة PKCE الموحّدة', serverSource.includes('requiresPkce(platform)') && serverSource.includes('createPkcePair'));
  check('OAuth callback يستخدم validateOAuthCallback', serverSource.includes('validateOAuthCallback({pending,platform,redirectUri})'));
  check('قائمة OAUTH_CONFIG تغطي كل منصات oauth2', ['youtube', 'google_business', 'tiktok', 'facebook', 'instagram', 'x', 'snapchat', 'threads'].every((p) => new RegExp(`${p}:\\s*\\{ provider:`).test(serverSource)));
  check('لا قائمة قدرات موازية في server.ts', !/"capabilities":\s*\[/.test(serverSource));

  group('OAuth callback العام (threads/x/snapchat/google_business) — إثبات هوية إلزامي (إصلاح #Task24)');
  // الثغرة المُصلَحة: كان المسار العام يُعلن providerVerified:true بهوية وهمية
  // ("authorized-user"/"حساب متصل") حتى لو فشل fetchProviderAccount تماماً.
  check('لا هوية وهمية متبقية في الكود', !serverSource.includes('"authorized-user"') && !serverSource.includes("accountId=\"authorized-user\""));
  check('لا نص "حساب متصل" الوهمي المتبقي', !serverSource.includes('accountName="حساب متصل"'));
  // السلوك الصحيح الجديد: رفض صريح (throw) بلا proof.accountId حقيقي، تماماً
  // كمسارَي يوتيوب (channel.data.channelId) وتيك توك (identity.data.openId).
  check('المسار العام يرفض بلا proof.accountId حقيقي', /if\(!proof\s*\|\|\s*!proof\.accountId\)\s*throw new Error/.test(serverSource));
  check('المسار العام يستخدم proof.accountId مباشرة (بلا قيمة افتراضية وهمية)', /const accountId=proof\.accountId,\s*accountName=proof\.accountName\|\|proof\.accountId/.test(serverSource));
  // لا أسرار مكتوبة في الكود الجديد.
  check('لا مفاتيح مكتوبة في server.ts', !/AIzaSy[A-Za-z0-9_-]{10,}/.test(serverSource) && !/clientSecret:\s*"[^"]+"/.test(serverSource));

  group('النشر متعدد المنصات بنقرة واحدة — يستخدم النسخة المكيَّفة والوسيط الحقيقي (Task #25)');
  // الثغرة المُصلَحة: كان /api/workspace/content/:id/publish يرسل post.content
  // الحرفي نفسه لكل منصة (يتجاهل platformVersions المكيَّفة)، ولا يمرّر أي وسيط
  // (videoUrl/imageUrl) إطلاقاً — فتفشل إنستغرام/ثريدز دائماً بـMEDIA_REQUIRED
  // رغم إرفاق المالك فيديو ورابطه العام فعلياً من "مركز صناعة المحتوى".
  const publishRouteMatch = serverSource.match(/app\.post\("\/api\/workspace\/content\/:id\/publish"[\s\S]{0,4500}?\n\}\);/);
  const publishRouteSrc = publishRouteMatch ? publishRouteMatch[0] : '';
  check('مسار النشر متعدد المنصات موجود وقابل للفحص', publishRouteSrc.length > 500);
  check('كل منصة تقرأ نسختها من platformVersions أولاً', publishRouteSrc.includes('post.platformVersions[platform]'));
  check('مع احتياط النص العام إن غابت نسخة المنصة', /post\.platformVersions\[platform\][\s\S]{0,80}\?\s*post\.platformVersions\[platform\]\s*\n\s*:\s*post\.content/.test(publishRouteSrc));
  check('لا إرسال post.content الحرفي وحده بلا فرع لكل منصة (الثغرة القديمة)', !/content:\s*post\.content\s*,\s*approved:\s*true/.test(publishRouteSrc));
  check('وسيط الفيديو الحقيقي يُمرَّر كـvideoUrl حين mediaType فيديو', /mediaFields\.videoUrl\s*=\s*mediaUrl/.test(publishRouteSrc));
  check('وسيط الصورة الحقيقي يُمرَّر كـimageUrl حين mediaType صورة', /mediaFields\.imageUrl\s*=\s*mediaUrl/.test(publishRouteSrc));
  check('حقول الوسيط تُدمَج فعلياً في نداء executePlatformPublish', /executePlatformPublish\(platform,\s*\{\s*\.\.\.req\.body,\s*\.\.\.mediaFields,\s*content:\s*perPlatformContent/.test(publishRouteSrc));
  // بوابة الاعتماد لم تُمسّ: لا يزال owner-only + status==="approved" إلزاميين.
  check('بوابة owner-only ما زالت قائمة', serverSource.includes('app.post("/api/workspace/content/:id/publish", requireOwner'));
  check('شرط status==="approved" ما زال إلزامياً قبل أي توزيع', /post\.status\s*!==\s*"approved"/.test(publishRouteSrc));

  group('استضافة فيديو مركز المحتوى تلقائياً — إغلاق فجوة اللصق اليدوي (Task #25 follow-up)');
  // الفجوة المُصلَحة: كان المالك يلصق رابط الفيديو العام يدوياً في مركز المحتوى؛
  // الآن يُرفع الفيديو تلقائياً إلى Drive العام فور إرفاقه عبر مسار مخصّص يعيد
  // استخدام resolvePublicVideoUrl/publishVideoPublicly الحقيقيتين (Task #21/#23) —
  // لا نشر خارجي هنا، تجهيز وسيط فقط، فيكفي canEditContent لا requireOwner.
  const hostRouteStart = serverSource.indexOf('app.post("/api/workspace/content/video/host"');
  const hostRouteSrc = hostRouteStart >= 0 ? serverSource.slice(hostRouteStart, hostRouteStart + 1700) : '';
  check('مسار الاستضافة التلقائية موجود', hostRouteSrc.length > 100);
  check('محمي بمصادقة + صلاحية تحرير المحتوى (لا owner فقط)', hostRouteSrc.includes('authenticateToken') && hostRouteSrc.includes('canEditContent(user.role)'));
  check('يعيد استخدام resolvePublicVideoUrl الحقيقية (لا رفع مزدوج)', hostRouteSrc.includes('resolvePublicVideoUrl(req.body'));
  check('لا نجاح بلا رابط فعلي', /if \(!resolved\.url\)/.test(hostRouteSrc));
  // Task #25: مهلة إجمالية صريحة حول السلسلة كاملة — لا تعليق بلا نهاية لرفع الفيديو.
  check('المسار يلفّ السلسلة بمهلة صريحة (لا تعليق بلا نهاية)', hostRouteSrc.includes('settleWithTimeout(resolvePublicVideoUrl(req.body') && hostRouteSrc.includes('HOSTING_TIMEOUT'));

  const apiServiceSrc = readFileSync(join(process.cwd(), 'src/services/api.ts'), 'utf8');
  check('apiService.hostContentVideo موجودة', apiServiceSrc.includes('async hostContentVideo('));
  check('تستهدف مسار الاستضافة الصحيح', apiServiceSrc.includes("fetch('/api/workspace/content/video/host'"));

  const contentViewSrc = readFileSync(join(process.cwd(), 'src/components/content/ContentEngineView.tsx'), 'utf8');
  check('الواجهة تستدعي الرفع التلقائي فور اختيار الفيديو (بلا لصق يدوي)', /onPickVideo[\s\S]{0,1400}apiService\.hostContentVideo\(/.test(contentViewSrc));
  check('زر الإرسال يُعطَّل أثناء الرفع التلقائي (لا إرسال بلا رابط جاهز)', /disabled=\{isQueuingYouTube \|\| isHostingVideo\}/.test(contentViewSrc));
  check('فشل الرفع لا يُسقط التدفّق — يبقى الحقل اليدوي بديلاً', contentViewSrc.includes('setVideoHostError('));

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} multi-platform foundation checks`);
  }
}

run();
