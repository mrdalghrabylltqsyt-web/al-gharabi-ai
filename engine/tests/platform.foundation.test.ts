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
  // CONNECTOR_READY = موصل منفّذ فعلاً في الكود. Telegram أولاً ثم Facebook ثم Instagram.
  check('الموصلات المنفّذة CONNECTOR_READY = telegram,facebook,instagram', PLATFORM_READINESS.filter((r) => r.implementationStatus === 'CONNECTOR_READY').map((r) => r.platform).sort().join(',') === 'facebook,instagram,telegram');
  check('كل بقية المنصات FOUNDATION_READY', PLATFORM_READINESS.filter((r) => !['telegram', 'facebook', 'instagram'].includes(r.platform)).every((r) => r.implementationStatus === 'FOUNDATION_READY'));
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
  check('ملخص الجاهزية صحيح', sum.total === 10 && sum.connectorReady === 3 && sum.foundationReady === 7);

  // ---------- 2) أساس OAuth ----------
  const s1 = createOAuthState();
  const s2 = createOAuthState();
  check('state عشوائي قوي وفريد', s1.length === 48 && s1 !== s2 && /^[0-9a-f]+$/.test(s1));
  const pkce = createPkcePair();
  check('PKCE: التحدي = sha256(verifier) base64url',
    pkce.challenge === crypto.createHash('sha256').update(pkce.verifier).digest('base64url'));
  check('PKCE مطلوب لـTikTok وX فقط', requiresPkce('tiktok') && requiresPkce('x') && !requiresPkce('facebook'));
  const pending = { platform: 'facebook', userId: 'owner', expiresAt: Date.now() + 1000, redirectUri: 'https://app/cb' };
  check('state صالح قبل الانتهاء', !isStateExpired(pending));
  check('state منتهٍ بعد الانتهاء', isStateExpired(pending, Date.now() + 5000));
  check('callback مطابق مقبول', validateOAuthCallback({ pending, platform: 'facebook', redirectUri: 'https://app/cb' }).ok);
  check('callback منصة مختلفة مرفوض', !validateOAuthCallback({ pending, platform: 'x', redirectUri: 'https://app/cb' }).ok);
  check('callback redirect مختلف مرفوض', !validateOAuthCallback({ pending, platform: 'facebook', redirectUri: 'https://evil/cb' }).ok);
  check('callback state مجهول مرفوض', !validateOAuthCallback({ pending: undefined, platform: 'facebook', redirectUri: 'https://app/cb' }).ok);
  check('callback منتهٍ مرفوض', !validateOAuthCallback({ pending, platform: 'facebook', redirectUri: 'https://app/cb', now: Date.now() + 5000 }).ok);
  check('TTL state عشر دقائق', OAUTH_STATE_TTL_MS === 600000);
  const tkParams = buildAuthorizationParams({ platform: 'tiktok', clientId: 'ck', redirectUri: 'r', scopes: ['a', 'b'], state: 'st', pkceChallenge: 'ch' });
  check('TikTok: client_key وcode_challenge', tkParams.client_key === 'ck' && tkParams.code_challenge === 'ch' && tkParams.scope === 'a,b');
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
  check('مسار النشر يمر عبر حارس السلامة', /platform\/publish[\s\S]{0,2000}analyzeBusinessClaims/.test(serverSource));
  check('مسار المؤشرات موجود ويعلن NOT_SUPPORTED', serverSource.includes('/api/platforms/:platform/metrics'));
  check('OAuth start يستخدم منصة PKCE الموحّدة', serverSource.includes('requiresPkce(platform)') && serverSource.includes('createPkcePair'));
  check('OAuth callback يستخدم validateOAuthCallback', serverSource.includes('validateOAuthCallback({pending,platform,redirectUri})'));
  check('قائمة OAUTH_CONFIG تغطي كل منصات oauth2', ['youtube', 'google_business', 'tiktok', 'facebook', 'instagram', 'x', 'snapchat', 'threads'].every((p) => new RegExp(`${p}:\\s*\\{ provider:`).test(serverSource)));
  check('لا قائمة قدرات موازية في server.ts', !/"capabilities":\s*\[/.test(serverSource));
  // لا أسرار مكتوبة في الكود الجديد.
  check('لا مفاتيح مكتوبة في server.ts', !/AIzaSy[A-Za-z0-9_-]{10,}/.test(serverSource) && !/clientSecret:\s*"[^"]+"/.test(serverSource));

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
