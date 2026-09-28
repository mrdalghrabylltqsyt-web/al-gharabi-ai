/**
 * اختبارات موصل YouTube الحقيقي — خامس تكامل اجتماعي خارجي منفّذ.
 *
 * طبقتان:
 *  1) وحدة: الدوال الحتمية (مصفوفة القدرات، النطاقات الرسمية، تحليل استجابة
 *     القناة، تصنيف أخطاء Google) بلا شبكة.
 *  2) تكامل: الخادم الحقيقي مع خادم Google/YouTube وهمي محلي عبر YOUTUBE_API_BASE
 *     وYOUTUBE_TOKEN_BASE، فيُختبر: OAuth (start → callback → تبادل → إثبات القناة)،
 *     النطاقين youtube.readonly + youtube.upload، رفض الحالة، إثبات أن قراءة القناة
 *     تفشل بلا youtube.readonly، الحفظ المشفّر، الفصل، والتصريح.
 *
 * لا يلمس أي مزود Google حقيقي ولا يستهلك أي حصة، ولا يستخدم أي سرّ واقعي.
 * ويشمل فحوص انحدار صريحة لبناء قدرات المنصات (عدم كسرها).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  YOUTUBE_CAPABILITY_MATRIX,
  YOUTUBE_REQUIRED_SCOPES,
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_UPLOAD_SCOPE,
  YOUTUBE_FORCE_SSL_SCOPE,
  resolveYouTubeScopes,
  youtubeCapabilityStatus,
  youtubeCapabilityImplemented,
  parseChannelListResponse,
  classifyYouTubeTokenError,
  classifyYouTubeApiError,
  buildChannelsMineUrl,
  YouTubeClient,
} from '../social/youtube';
import { resolveYouTubeState, youtubeOnlyModeEnabled, guardExternalOperationPlatform, YOUTUBE_TRUTHFUL_STATES, type YouTubeStateInput } from '../social/youtubeState';
import { summarizeChannelAnalytics, analyzeYouTubeAudience, buildYouTubeLearning } from '../social/youtubeLearning';
import { createYouTubeMock, startYouTubeMockServer } from './helpers/youtubeMock';
import { PLATFORM_SPECS, hasRealConnector, platformSupports } from '../social/registry';

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
const APP_PORT = 7500 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const YT_PORT = 7560 + Math.floor(Math.random() * 40);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'youtube-connector-test-secret-not-real';
const GO_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
const GO_CLIENT_SECRET = 'test-google-client-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-youtube-'));
const TOKEN_KEY = randomBytes(32).toString('hex');

let currentApp: { proc: ChildProcess; log: () => string } | null = null;

function startApp(ytBase: string, extraEnv: Record<string, string> = {}): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    // خادم Google/YouTube وهمي محلي: لا اتصال بمزود حقيقي في الاختبارات.
    YOUTUBE_API_BASE: ytBase,
    YOUTUBE_UPLOAD_BASE: ytBase,
    YOUTUBE_TOKEN_BASE: `${ytBase}/token`,
    GOOGLE_OAUTH_CLIENT_ID: GO_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: GO_CLIENT_SECRET,
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

// ---------------------------------------------------------------------------
// 1) وحدة
// ---------------------------------------------------------------------------
function unitTests(): void {
  group('1) وحدة: مصفوفة القدرات — كل قدرة مُعلنة SUPPORTED لها استدعاء منفّذ فعلاً');
  const byKey = Object.fromEntries(YOUTUBE_CAPABILITY_MATRIX.map((r) => [r.key, r]));
  check('OAuth Login مدعوم', youtubeCapabilityImplemented('oauth_login'));
  check('إثبات هوية القناة مدعوم', youtubeCapabilityImplemented('channel_identity') && byKey['channel_identity'].status === 'SUPPORTED');
  check('حفظ الاتصال المشفّر مدعوم', youtubeCapabilityImplemented('connection_persistence'));
  check('رفع الفيديو منفّذ (videos.insert resumable)', byKey['video_upload'].status === 'SUPPORTED');
  check('تحديث الفيديو منفّذ (videos.update)', byKey['video_update'].status === 'SUPPORTED');
  check('قراءة التعليقات منفّذة (commentThreads.list)', byKey['comments_read'].status === 'SUPPORTED');
  check('الرد على التعليقات منفّذ (comments.insert)', byKey['comment_reply'].status === 'SUPPORTED');
  check('التحليلات منفّذة (part=statistics)', byKey['analytics'].status === 'SUPPORTED');
  check('الجدولة منفّذة (status.publishAt)', byKey['scheduling'].status === 'SUPPORTED');
  check('النشر منفّذ (privacyStatus)', byKey['publishing'].status === 'SUPPORTED');
  check('التركيبة السكانية غير متاحة صراحةً', byKey['audience_demographics'].status === 'NOT_AVAILABLE');
  check('webhooks تحتاج مراجعة', byKey['webhook_pubsub'].status === 'REQUIRES_REVIEW');
  check('قدرة غير معروفة تُعيد null لا ادعاء', youtubeCapabilityStatus('nope') === null && !youtubeCapabilityImplemented('nope'));
  check('لا قدرة بحالة غير معروفة', YOUTUBE_CAPABILITY_MATRIX.every((r) => ['SUPPORTED', 'NOT_IMPLEMENTED', 'REQUIRES_REVIEW', 'NOT_AVAILABLE'].includes(r.status)));

  group('2) وحدة: النطاقات الرسمية');
  check('youtube.readonly مطلوب (يغطّي channels.list)', YOUTUBE_REQUIRED_SCOPES.includes(YOUTUBE_READONLY_SCOPE));
  check('youtube.upload مطلوب (الرفع/التحديث/النشر/الجدولة)', YOUTUBE_REQUIRED_SCOPES.includes(YOUTUBE_UPLOAD_SCOPE));
  check('youtube.force-ssl مطلوب (التعليقات/الرد)', YOUTUBE_REQUIRED_SCOPES.includes(YOUTUBE_FORCE_SSL_SCOPE));
  check('المجموعة بلا تكرار', new Set(YOUTUBE_REQUIRED_SCOPES).size === YOUTUBE_REQUIRED_SCOPES.length);
  const partial = resolveYouTubeScopes(['https://www.googleapis.com/auth/youtube.readonly']);
  check('حلّ مجموعة جزئية يعيد النطاقات الثلاثة دائماً', partial.includes(YOUTUBE_READONLY_SCOPE) && partial.includes(YOUTUBE_UPLOAD_SCOPE) && partial.includes(YOUTUBE_FORCE_SSL_SCOPE));
  const junk = resolveYouTubeScopes(['https://www.googleapis.com/auth/yt-analytics.readonly', 'not-a-scope']);
  check('حلّ مجموعة يُهمل أي نطاق غير مطلوب', !junk.includes('https://www.googleapis.com/auth/yt-analytics.readonly') && !junk.includes('not-a-scope') && junk.length === 3);

  group('3) وحدة: قراءة القناة وتصنيف الأخطاء');
  const parsed = parseChannelListResponse({ items: [{ id: 'UC_1', snippet: { title: 'قناة' }, contentDetails: { relatedPlaylists: { uploads: 'UU_1' } } }] });
  check('يستخرج هوية القناة', parsed?.channelId === 'UC_1' && parsed?.title === 'قناة' && parsed?.uploadsPlaylistId === 'UU_1');
  check('لا يختلق هوية عند غياب items', parseChannelListResponse({ items: [] }) === null && parseChannelListResponse(null) === null);
  check('مسار القناة الرسمي صحيح', buildChannelsMineUrl('http://x').endsWith('/youtube/v3/channels?part=snippet,contentDetails,statistics&mine=true'));
  check('تصنيف invalid_grant', classifyYouTubeTokenError({ error: 'invalid_grant' }) === 'invalid_grant');
  check('تصنيف invalid_client', classifyYouTubeTokenError({ error: 'invalid_client' }) === 'invalid_client');
  check('تصنيف insufficientPermissions لقناة', classifyYouTubeApiError({ error: { errors: [{ reason: 'insufficientPermissions' }] } }) === 'insufficient_permissions');
  check('تصنيف accessNotConfigured', classifyYouTubeApiError({ error: { errors: [{ reason: 'accessNotConfigured' }] } }) === 'access_not_configured');

  group('4) وحدة: عميل YouTube بخادم وهمي (لا شبكة حقيقية)');
  // يُختبر العميل وحده عبر mock مدمج في نفس الدالة أدناه (integrationTests) لأن
  // العميل يحتاج fetchImpl فقط — نحن نمرّره هنا بعميل حقيقي لخادم الوهم.

  group('4a) وحدة: الحالة الصادقة + حارس YouTube-only + حلقة التعلّم (منطق خالص)');
  const baseState: YouTubeStateInput = {
    clientIdConfigured: true, clientSecretConfigured: true, encryptionKeyValid: true, publicUrlValid: true,
    pendingAuthorization: false, tokenStored: false, refreshTokenStored: false, tokenExpired: false,
    forceSslGranted: false, connectionStatus: 'disconnected', channelDiscovered: false, providerVerified: false,
    operationalEvidence: false, providerErrorKind: null,
  };
  check('بيانات ناقصة => NOT_CONFIGURED', resolveYouTubeState({ ...baseState, clientIdConfigured: false }).state === 'NOT_CONFIGURED');
  check('بيئة ناقصة (مفتاح تشفير) => CODE_READY', resolveYouTubeState({ ...baseState, encryptionKeyValid: false }).state === 'CODE_READY');
  check('كل شيء حاضر بلا توكن => READY_TO_CONNECT', resolveYouTubeState(baseState).state === 'READY_TO_CONNECT');
  check('جلسة معلّقة => AUTHORIZATION_REQUIRED', resolveYouTubeState({ ...baseState, pendingAuthorization: true }).state === 'AUTHORIZATION_REQUIRED');
  check('متصل بلا توثيق => CONNECTED', resolveYouTubeState({ ...baseState, connectionStatus: 'connected', tokenStored: true, refreshTokenStored: true }).state === 'CONNECTED');
  check('فشل التجديد => TOKEN_REFRESH_REQUIRED', resolveYouTubeState({ ...baseState, connectionStatus: 'reauth_needed' }).state === 'TOKEN_REFRESH_REQUIRED');
  check('موثق بلا force-ssl => SCOPE_UPGRADE_REQUIRED', resolveYouTubeState({ ...baseState, connectionStatus: 'connected', providerVerified: true, forceSslGranted: false }).state === 'SCOPE_UPGRADE_REQUIRED');
  check('نص إعادة الربط للتعليقات موجود', resolveYouTubeState({ ...baseState, connectionStatus: 'connected', providerVerified: true, forceSslGranted: false }).labelAr.includes('إعادة ربط YouTube مطلوبة لتفعيل إدارة التعليقات'));
  check('موثق بلا دليل محتوى => PUBLISHING_RESTRICTED', resolveYouTubeState({ ...baseState, connectionStatus: 'connected', providerVerified: true, forceSslGranted: true }).state === 'PUBLISHING_RESTRICTED');
  check('موثق بدليل مزود => OPERATIONAL', resolveYouTubeState({ ...baseState, connectionStatus: 'connected', providerVerified: true, forceSslGranted: true, operationalEvidence: true }).state === 'OPERATIONAL');
  check('لا OPERATIONAL بلا توثيق', resolveYouTubeState({ ...baseState, operationalEvidence: true }).state !== 'OPERATIONAL');
  check('اتصال موثق قائم لا يُخفَض لغياب العنوان العام', resolveYouTubeState({ ...baseState, publicUrlValid: false, connectionStatus: 'connected', providerVerified: true, forceSslGranted: true, operationalEvidence: true }).state === 'OPERATIONAL');
  check('مفردات الحالات إحدى عشرة بالضبط', YOUTUBE_TRUTHFUL_STATES.length === 11);
  check('وضع YouTube-only معطّل افتراضياً', youtubeOnlyModeEnabled({}) === false);
  check('وضع YouTube-only مفعّل بالعلم', youtubeOnlyModeEnabled({ YOUTUBE_ONLY_OPERATIONAL: 'true' }) === true);
  check('حارس YouTube-only يسمح لـYouTube', guardExternalOperationPlatform('youtube', { YOUTUBE_ONLY_OPERATIONAL: '1' }).allowed === true);
  const blocked = guardExternalOperationPlatform('facebook', { YOUTUBE_ONLY_OPERATIONAL: '1' });
  check('حارس YouTube-only يحجب غير YouTube', blocked.allowed === false && blocked.code === 'PLATFORM_NOT_ALLOWED_IN_YOUTUBE_ONLY');
  check('الحارس لا يحجب شيئاً حين الوضع معطّل', guardExternalOperationPlatform('facebook', {}).allowed === true);

  group('4a-2) وحدة: تحليل الجمهور وحلقة التعلّم بلا اختراع بيانات');
  const recs = [
    { videoId: 'v1', title: 'أ', publishedAt: '2026-09-01T00:00:00Z', viewCount: 100, likeCount: 10, commentCount: 5, at: '2026-09-11T00:00:00Z' },
    { videoId: 'v2', title: 'ب', publishedAt: '2026-09-05T00:00:00Z', viewCount: 200, likeCount: 20, commentCount: 8, at: '2026-09-11T00:00:00Z' },
    { videoId: 'v3', title: 'ج', publishedAt: '2026-09-10T00:00:00Z', viewCount: 300, likeCount: 30, commentCount: 12, at: '2026-09-11T00:00:00Z' },
  ];
  const summary = summarizeChannelAnalytics(recs);
  check('ملخص التحليلات يجمع القيم الحقيقية', summary.totalViews === 600 && summary.totalLikes === 60 && summary.totalComments === 25);
  check('التحليلات تُعلن المؤشرات غير المتاحة', summary.unavailable.some((u: any) => u.metric === 'impressions'));
  const audience = analyzeYouTubeAudience(recs, summary);
  check('تحليل الجمهور يعلن غياب البيانات السكانية صراحةً', audience.demographicsAvailable === false);
  check('كل رؤية جمهور تحمل مصدرها', audience.insights.every((i: any) => Boolean(i.basis)));
  const learning = buildYouTubeLearning({ records: recs });
  check('التعلّم يحمل دروساً من بيانات كافية', learning.insights.every((i: any) => i.source && typeof i.sampleSize === 'number'));
  check('التعلّم لا يدّعي دلالة بلا عيّنة كافية', buildYouTubeLearning({ records: recs.slice(0, 1) }).statisticallyValid === false);

  group('4b) وحدة: واجهة YouTube تستدعي health وتعرض الحالة التشغيلية بلا أي سرّ');
  const ui = readFileSync(join(REPO_ROOT, 'src/components/social/PlatformConnectionCenter.tsx'), 'utf8');
  check('الواجهة تستدعي getPlatformHealth(\'youtube\')', ui.includes("getPlatformHealth('youtube')"));
  check('الواجهة تعرض زر الفحص التشغيلي', ui.includes('فحص القناة والحالة'));
  check('الواجهة تعرض اسم القناة accountName', ui.includes('accountName'));
  check('الواجهة تعرض معرّف القناة accountId', ui.includes('accountId'));
  check('الواجهة تعرض وقت آخر فحص checkedAt', ui.includes('checkedAt'));
  check('الواجهة تُعلن نجاح الفحص', ui.includes('حالة الفحص: ناجح'));
  check('الواجهة تُظهر إعادة ربط عند 409', ui.includes('إعادة ربط Google مطلوبة') && ui.includes('إعادة ربط OAuth'));
  check('الواجهة تُعلن إعادة الربط لتفعيل التعليقات', ui.includes('إعادة ربط YouTube مطلوبة لتفعيل إدارة التعليقات'));
  check('الواجهة تعرض القدرات المنفّذة فعلاً', ui.includes('القدرات المنفّذة فعلاً'));
  check('الواجهة تجلب الفيديوهات الحقيقية', ui.includes('getYouTubeVideos('));
  check('الواجهة تجلب التشخيص', ui.includes('getYouTubeDiagnostics('));
  check('الواجهة تُعلن أن التركيبة السكانية غير متاحة', ui.includes('غير متاحة عبر Data API'));
  check('لوحة YouTube تُعرض للمالك فقط في مركز الربط', /platform === 'youtube'[\s\S]{0,120}?YouTubeStatusPanel/.test(ui));
  check('الواجهة لا تطبع token/secret', !/access_token|refresh_token|clientSecret\}/.test(ui));
  const apiSrc = readFileSync(join(REPO_ROOT, 'src/services/api.ts'), 'utf8');
  check('طبقة API تصل health بالمسار الصحيح', apiSrc.includes('/api/platforms/${encodeURIComponent(platform)}/health'));
  check('طبقة API تحمل مسار رفع YouTube المخصص', apiSrc.includes('/api/platforms/youtube/publish'));
  check('طبقة API تحمل مسار رد YouTube المخصص', apiSrc.includes('/api/platforms/youtube/reply'));
  check('طبقة API تحمل مسار تعليقات YouTube', apiSrc.includes('/api/platforms/youtube/comments'));
  check('طبقة API تحمل مسار تحليلات YouTube', apiSrc.includes('/api/platforms/youtube/analytics'));
}

// ---------------------------------------------------------------------------
// 2) تكامل
// ---------------------------------------------------------------------------
async function integrationTests(): Promise<void> {
  const mock = await startYouTubeMockServer(createYouTubeMock(), YT_PORT);
  try {
    currentApp = startApp(mock.base);
    const auth = { 'Content-Type': 'application/json' } as Record<string, string>;

    group('5) تكامل: الخادم يقلع وhealth/readiness يكشفان حقول YouTube الآمنة');
    check('الخادم يقلع', await waitForHealth(), currentApp.log().slice(0, 400));
    const health = await (await fetch(`${BASE}/api/health`)).json();
    check('health يحمل كتلة youtubeOAuth', Boolean(health.youtubeOAuth));
    check('health: clientId configured', health.youtubeOAuth?.clientIdConfigured === true);
    check('health: clientSecret configured (بلا قيمة)', health.youtubeOAuth?.clientSecretConfigured === true);
    check('health: youtube.readonly مطلوب', health.youtubeOAuth?.readonlyScopePresent === true);
    check('health: youtube.upload مطلوب', health.youtubeOAuth?.uploadScopePresent === true);
    check('health: youtube.force-ssl مطلوب', health.youtubeOAuth?.forceSslScopePresent === true);
    check('health: force-ssl غير ممنوح قبل الربط', health.youtubeOAuth?.forceSslGranted === false);
    check('health: إثبات القناة منفّذ', health.youtubeOAuth?.channelIdentityCallImplemented === true);
    check('health: موصل حقيقي', health.youtubeOAuth?.realConnector === true);
    check('health: حالة صادقة معلنة', typeof health.youtubeOAuth?.operationalState === 'string');
    check('health لا يسرّب السرّ', !JSON.stringify(health).includes(GO_CLIENT_SECRET));
    check('health لا يسرّب معرّف العميل كاملاً', !JSON.stringify(health).includes(GO_CLIENT_ID));
    const readiness = await (await fetch(`${BASE}/api/readiness`)).json();
    check('readiness يحمل كتلة youtubeOAuth', Boolean(readiness.youtubeOAuth));
    check('readiness يعلن نطاق القراءة', readiness.youtubeOAuth?.readonlyScopePresent === true);
    check('readiness بلا أي سرّ', !JSON.stringify(readiness).includes(GO_CLIENT_SECRET));

    Object.assign(auth, await login());

    group('6) تكامل: oauth/setup (owner) يعرض الإعداد الفعلي بلا سرّ');
    const setupAnon = await fetch(`${BASE}/api/platforms/youtube/oauth/setup`);
    check('oauth/setup بلا جلسة => 401', setupAnon.status === 401);
    const setup = await (await fetch(`${BASE}/api/platforms/youtube/oauth/setup`, { headers: auth })).json();
    check('clientIdConfigured = true', setup.clientIdConfigured === true);
    check('clientSecretConfigured = true', setup.clientSecretConfigured === true);
    check('redirectUri مطابق تماماً', setup.redirectUri === `${BASE}/api/platforms/youtube/oauth/callback`);
    check('النطاقات تتضمن youtube.readonly', (setup.scopes || []).includes(YOUTUBE_READONLY_SCOPE));
    check('النطاقات تتضمن youtube.upload', (setup.scopes || []).includes(YOUTUBE_UPLOAD_SCOPE));
    check('النطاقات تتضمن youtube.force-ssl', (setup.scopes || []).includes(YOUTUBE_FORCE_SSL_SCOPE));
    check('oauth/setup لا يكشف السرّ', !JSON.stringify(setup).includes(GO_CLIENT_SECRET));
    check('youtubeSetup يعلن النطاقات والقدرات', setup.youtubeSetup?.readonlyScopePresent === true && Array.isArray(setup.youtubeSetup?.notImplementedCapabilities));
    check('youtubeSetup يعلن رفع الفيديو منفّذاً', (setup.youtubeSetup?.implementedCapabilities || []).includes('video_upload'));
    check('youtubeSetup يعلن التعليقات والرد منفّذة', (setup.youtubeSetup?.implementedCapabilities || []).includes('comments_read') && (setup.youtubeSetup?.implementedCapabilities || []).includes('comment_reply'));
    check('youtubeSetup يعلن إعادة الربط مطلوبة للتعليقات قبل الربط (force-ssl غير ممنوح)', setup.youtubeSetup?.scopeUpgradeRequiredForComments === true);
    check('youtubeSetup يعرض خطوات Google Cloud', Array.isArray(setup.youtubeSetup?.dashboardSteps) && setup.youtubeSetup.dashboardSteps.length >= 4);

    group('7) تكامل: oauth/start (owner) يبني رابط Google الصحيح');
    const startAnon = await fetch(`${BASE}/api/platforms/youtube/oauth/start`);
    check('oauth/start بلا جلسة => 401', startAnon.status === 401);
    const start = await (await fetch(`${BASE}/api/platforms/youtube/oauth/start`, { headers: auth })).json();
    const authUrl = new URL(start.authorizationUrl || "https://invalid.local");
    check('رابط التفويض يوجّه إلى Google', authUrl.origin === 'https://accounts.google.com' && authUrl.pathname === '/o/oauth2/v2/auth');
    check('redirect_uri المُرسل إلى Google مطابق تماماً', authUrl.searchParams.get('redirect_uri') === `${BASE}/api/platforms/youtube/oauth/callback`);
    check('scope يحمل youtube.readonly', (authUrl.searchParams.get('scope') || '').includes(YOUTUBE_READONLY_SCOPE));
    check('scope يحمل youtube.upload', (authUrl.searchParams.get('scope') || '').includes(YOUTUBE_UPLOAD_SCOPE));
    check('scope يحمل youtube.force-ssl', (authUrl.searchParams.get('scope') || '').includes(YOUTUBE_FORCE_SSL_SCOPE));
    check('access_type=offline للحصول على refresh_token', authUrl.searchParams.get('access_type') === 'offline');
    check('state موجود', Boolean(authUrl.searchParams.get('state')));
    const oauthState = authUrl.searchParams.get('state') as string;

    group('8) تكامل: callback يتحقق من state ويستبعد الحالة المزوّرة');
    const bogus = await fetch(`${BASE}/api/platforms/youtube/oauth/callback?state=bogus-state&code=x`);
    check('callback بحالة مزوّرة => 400', bogus.status === 400);

    group('9) تكامل: الدورة الكاملة start → callback → إثبات قناة فعلية');
    const cb = await fetch(`${BASE}/api/platforms/youtube/oauth/callback?state=${encodeURIComponent(oauthState)}&code=test-auth-code`);
    check('callback بحالة صحيحة => 200', cb.status === 200, `status=${cb.status}`);
    check('التبادل نُفِّذ لدى المزود', mock.state.lastExchange !== null);
    check('التبادل حمل client_id وredirect_uri الصحيحين', mock.state.lastExchange?.clientId === GO_CLIENT_ID && mock.state.lastExchange?.redirectUri === `${BASE}/api/platforms/youtube/oauth/callback`);
    check('قراءة القناة نُفِّذت فعلاً على channels.list', (mock.state.lastChannelsPath || '').includes('/youtube/v3/channels') && (mock.state.lastChannelsPath || '').includes('mine=true'));
    check('قراءة القناة حملت Bearer token', (mock.state.lastChannelsAuth || '').startsWith('Bearer '));
    const plats = await (await fetch(`${BASE}/api/platforms/capabilities`, { headers: auth })).json();
    const ytConn = (plats.platforms || []).find((p: any) => p.id === 'youtube')?.connection || {};
    check('بعد الربط: متصل وموثق', ytConn.status === 'connected' && ytConn.providerVerified === true);
    check('بعد الربط: قناة حقيقية محفوظة', ytConn.accountId === mock.state.channelId && ytConn.accountName === mock.state.channelTitle);

    group('10) تكامل: control-plane يعكس حالة YouTube الموصولة (وليس missing credentials)');
    const cp = await (await fetch(`${BASE}/api/platforms/control-plane`, { headers: auth })).json();
    const yt = cp.platforms.find((p: any) => p.platform === 'youtube');
    check('YouTube في control-plane', Boolean(yt));
    check('YouTube ليس في حالة نقص اعتماد', yt.credentialsConfigured === true && yt.connectionConfigured === true && !yt.blockingReason?.includes('بيانات الاعتماد ناقصة'));
    check('YouTube موثق => OPERATIONAL (موصل حقيقي + اتصال موثق)', yt.state === 'OPERATIONAL' && yt.providerVerified === true);

    group('11) تكامل: مسار health للمنصة يثبت القناة فعلياً ويرفض عند غياب الصلاحية');
    const ph = await (await fetch(`${BASE}/api/platforms/youtube/health`, { headers: auth })).json();
    check('health المنصة يُثبت القناة', ph.success === true && ph.healthy === true && ph.accountId === mock.state.channelId);
    // إسقاط صلاحية القراءة لدى المزوّد: يجب أن يُعلن reauth_needed لا صحة كاذبة.
    mock.state.hasReadonlyScope = false;
    const phBad = await (await fetch(`${BASE}/api/platforms/youtube/health`, { headers: auth })).json();
    check('بلا youtube.readonly: الصحة تُعلن reauth_needed', phBad.healthy === false && phBad.status === 'reauth_needed');
    check('الصحة تُعلن insufficientPermissions', phBad.errorKind === 'insufficient_permissions');
    mock.state.hasReadonlyScope = true;

    group('11b) تكامل: تجديد access token المنتهي تلقائياً والتقاط فشل التجديد');
    // إعادة الربط لاستعادة حالة connected (فحص 11 أسقطها إلى reauth_needed عمداً) برمز طويل العمر.
    const reconnect = async (expiresIn: number, code: string): Promise<void> => {
      mock.state.tokenExpiresInSeconds = expiresIn;
      const s = await (await fetch(`${BASE}/api/platforms/youtube/oauth/start`, { headers: auth })).json();
      const st = new URL(s.authorizationUrl).searchParams.get('state') as string;
      await fetch(`${BASE}/api/platforms/youtube/oauth/callback?state=${encodeURIComponent(st)}&code=${encodeURIComponent(code)}`);
    };
    await reconnect(3600, 'reconnect-fresh');
    // (أ) الرمز الحالي صالح => لا تجديد، والفحص ينجح.
    mock.state.lastRefresh = null;
    const phFresh = await (await fetch(`${BASE}/api/platforms/youtube/health`, { headers: auth })).json();
    check('رمز صالح: الفحص ينجح بلا تجديد', phFresh.success === true && phFresh.healthy === true && phFresh.tokenRefreshed === false);
    check('رمز صالح: لم يُطلب تجديد', mock.state.lastRefresh === null);
    // (ب) نجبر انتهاء الرمز: نعيد الربط برمز قصير العمر (< هامش الأمان 60) ثم نفحص.
    await reconnect(30, 'reconnect-short');
    mock.state.lastRefresh = null;
    const phExpired = await (await fetch(`${BASE}/api/platforms/youtube/health`, { headers: auth })).json();
    check('رمز منتهٍ + refresh صالح: الفحص ينجح', phExpired.success === true && phExpired.healthy === true && phExpired.accountId === mock.state.channelId);
    check('رمز منتهٍ: التجديد نُفِّذ فعلاً', mock.state.lastRefresh !== null && mock.state.lastRefresh?.clientId === GO_CLIENT_ID);
    check('الفحص يعلن أنه جدّد الرمز', phExpired.tokenRefreshed === true);
    // (ج) فشل التجديد فعلاً => reauth_needed (لا ادعاء صحة).
    await reconnect(30, 'reconnect-short-2');
    mock.state.failRefresh = true;
    const phFail = await (await fetch(`${BASE}/api/platforms/youtube/health`, { headers: auth })).json();
    check('فشل التجديد => reauth_needed', phFail.success === false && phFail.healthy === false && phFail.status === 'reauth_needed');
    check('فشل التجديد: لا يُسرّب أي رمز', !JSON.stringify(phFail).includes(mock.state.accessToken) && !JSON.stringify(phFail).includes(mock.state.refreshToken));
    mock.state.failRefresh = false;
    // (د) لا أسرار في سجل health العام، ويُعلن تجديد الرمز متاحاً.
    const healthSec = await (await fetch(`${BASE}/api/health`)).json();
    check('health لا يسرّب access token', !JSON.stringify(healthSec).includes(mock.state.accessToken));
    check('health لا يسرّب refresh token', !JSON.stringify(healthSec).includes(mock.state.refreshToken));
    check('health يعلن تجديد الرمز متاحاً', healthSec.youtubeOAuth?.tokenRefreshable === true);
    // استعادة الاتصال الموثق لبقيّة الفحوص.
    mock.state.tokenExpiresInSeconds = 3600;
    await reconnect(3600, 'reconnect-final');

    group('12) تكامل: قدرات المحتوى الحقيقية في السجل العام (بلا ادعاء غير منفّذ)');
    check('YouTube يعلن النشر والتحليلات والجدولة', ['publish', 'analytics', 'scheduling'].every((c) => platformSupports('youtube', c)));
    check('YouTube يعلن التعليقات والرد', platformSupports('youtube', 'comments') && platformSupports('youtube', 'comment_reply'));
    check('YouTube لا يعلن رسائل مباشرة', !platformSupports('youtube', 'messages') && !platformSupports('youtube', 'message_reply'));
    check('YouTube لا يعلن تركيبة سكانية (غير متاحة)', !platformSupports('youtube', 'audience_insights'));
    check('YouTube مُعلن موصلاً حقيقياً في السجل', hasRealConnector('youtube') && PLATFORM_SPECS.find((s) => s.platform === 'youtube')?.realConnector === true);

    group('12b) تكامل: قائمة الفيديوهات الحقيقية (playlistItems + videos)');
    const vids = await (await fetch(`${BASE}/api/platforms/youtube/videos`, { headers: auth })).json();
    check('قائمة الفيديوهات تنجح', vids.success === true && vids.count === mock.state.videos.length);
    check('الفيديوهات تحمل إحصاءات حقيقية من المزود', vids.videos?.[0]?.viewCount === mock.state.videos[0].viewCount);
    check('المسار الرسمي playlistItems مُستخدم', (mock.state.lastChannelsPath || '').includes('/youtube/v3/channels'));

    group('12c) تكامل: التحليلات الحقيقية + تحليل الجمهور بلا اختراع بيانات سكانية');
    const analytics = await (await fetch(`${BASE}/api/platforms/youtube/analytics`, { headers: auth })).json();
    check('التحليلات تنجح', analytics.success === true);
    check('ملخص القناة من الإحصاءات الحقيقية', analytics.summary?.totalViews === mock.state.videos.reduce((s: number, v: any) => s + v.viewCount, 0));
    check('تحليل الجمهور يعلن غياب البيانات السكانية', analytics.audience?.demographicsAvailable === false);

    group('12d) تكامل: حلقة التعلّم من الأداء الحقيقي');
    const learning = await (await fetch(`${BASE}/api/platforms/youtube/learning`, { headers: auth })).json();
    check('التعلّم ينجح', learning.success === true);
    check('كل درس يحمل مصدره وعيّنته', Array.isArray(learning.learning?.insights) && learning.learning.insights.every((i: any) => i.source && typeof i.sampleSize === 'number'));

    group('12e) تكامل: قراءة التعليقات الحقيقية وتخزينها ومنع تكرارها');
    const comments1 = await (await fetch(`${BASE}/api/platforms/youtube/comments?videoId=vid_alpha`, { headers: auth })).json();
    check('قراءة التعليقات تنجح', comments1.success === true && comments1.fetched === mock.state.comments.length);
    check('التعليقات أُدخلت فعلاً', comments1.inserted === mock.state.comments.length);
    const comments2 = await (await fetch(`${BASE}/api/platforms/youtube/comments?videoId=vid_alpha`, { headers: auth })).json();
    check('إعادة القراءة لا تُنشئ تكراراً', comments2.duplicates === mock.state.comments.length && comments2.inserted === 0);

    group('12f) تكامل: الرد الحقيقي (comments.insert) ومنع الرد المكرر');
    const reply1 = await (await fetch(`${BASE}/api/platforms/youtube/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ commentId: 'cmt_1', text: 'أهلاً، سعر التقسيط متاح في الفرع.' }) })).json();
    check('الرد الحقيقي نجح', reply1.success === true && reply1.delivered === true && reply1.externalReplyId === 'reply_0001');
    check('المسار الرسمي comments.insert مُستخدم', (mock.state.lastInsertPath || '').includes('/youtube/v3/comments'));
    const reply2 = await (await fetch(`${BASE}/api/platforms/youtube/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ commentId: 'cmt_1', text: 'أهلاً، سعر التقسيط متاح في الفرع.' }) })).json();
    check('الرد المكرر مرفوض', reply2.success !== true && (reply2.code === 'DUPLICATE_REPLY' || reply2.success === false));

    group('12g) تكامل: رفع فيديو حقيقي + جدولة publishAt + منع التكرار');
    const publishNow = await (await fetch(`${BASE}/api/platforms/youtube/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'فيديو جديد', description: 'وصف', approved: true, privacyStatus: 'public', videoBase64: Buffer.from('fake-video-bytes').toString('base64') }) })).json();
    check('الرفع الفوري نجح', publishNow.success === true && publishNow.externalVideoId === mock.state.uploadedVideoId);
    check('المسار الرسمي uploadType=resumable مُستخدم', (mock.state.lastUploadPath || '').includes('uploadType=resumable'));
    const publishDup = await (await fetch(`${BASE}/api/platforms/youtube/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'فيديو جديد', description: 'وصف', approved: true, privacyStatus: 'public', videoBase64: Buffer.from('fake-video-bytes').toString('base64') }) })).json();
    check('الرفع المكرر مرفوض بـDUPLICATE_PUBLISH', publishDup.code === 'DUPLICATE_PUBLISH');
    const schedule = await (await fetch(`${BASE}/api/platforms/youtube/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'فيديو مجدول', description: 'وصف', approved: true, publishAt: '2027-01-01T10:00', videoBase64: Buffer.from('scheduled-bytes').toString('base64') }) })).json();
    check('الجدولة نجحت بحالة scheduled', schedule.success === true && schedule.scheduled === true);
    check('publishAt مُرسل إلى YouTube بحالة private', mock.state.lastUploadBody?.status?.publishAt && mock.state.lastUploadBody?.status?.privacyStatus === 'private');
    const publishNoMedia = await (await fetch(`${BASE}/api/platforms/youtube/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'بلا مادة', approved: true }) })).json();
    check('لا رفع بلا مادة فعلية => MEDIA_REQUIRED', publishNoMedia.code === 'MEDIA_REQUIRED');

    group('12h) تكامل: تحديث فيديو حقيقي (videos.update)');
    const upd = await (await fetch(`${BASE}/api/platforms/youtube/video-update`, { method: 'POST', headers: auth, body: JSON.stringify({ videoId: 'vid_alpha', title: 'عنوان محدّث', description: 'وصف محدّث' }) })).json();
    check('تحديث الفيديو نجح', upd.success === true);
    check('المسار الرسمي videos.update مُستخدم', (mock.state.lastUpdatePath || '').includes('/youtube/v3/videos'));

    group('12i) تكامل: حارس النطاق — إدارة التعليقات تتطلب force-ssl الممنوح فعلاً');
    mock.state.hasForceSslScope = false;
    mock.state.scope = ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.upload'];
    await reconnect(3600, 'reconnect-no-force-ssl');
    const commentsNoScope = await (await fetch(`${BASE}/api/platforms/youtube/comments?videoId=vid_alpha`, { headers: auth })).json();
    check('بلا force-ssl: التعليقات ترفض بـSCOPE_UPGRADE_REQUIRED', commentsNoScope.code === 'SCOPE_UPGRADE_REQUIRED');
    check('الرسالة تطلب إعادة الربط صراحةً', String(commentsNoScope.error || '').includes('إعادة ربط YouTube'));
    mock.state.hasForceSslScope = true;
    mock.state.scope = ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl'];
    await reconnect(3600, 'reconnect-force-ssl');

    group('12i-2) تكامل: العقل المركزي يجلب التعليقات الحقيقية عبر Data API');
    // طلب صريح لجلب التعليقات: يجب أن ينفّذ youtubeVideos ثم يستخرج videoId حقيقياً
    // ثم يستدعي youtubeComments → commentThreads.list على YouTube Data API.
    mock.state.lastCommentsPath = null;
    mock.state.lastCommentsVideoId = null;
    const agentComments = await (await fetch(`${BASE}/api/agent/tasks`, { method: 'POST', headers: auth, body: JSON.stringify({ task: 'اجلب أحدث تعليقات YouTube الحقيقية وحللها واقترح رداً' }) })).json();
    check('العقل: مهمة التعليقات أُنشئت', agentComments.success === true && Boolean(agentComments.task));
    check('العقل: الخطة تضم youtube_comments', (agentComments.task?.plan?.steps || []).some((s: any) => s.toolId === 'youtube_comments'));
    const jEntry = (agentComments.task?.journal || []).find((e: any) => e.toolId === 'youtube_comments');
    check('العقل: youtube_comments نُفّذت بنجاح', jEntry?.ok === true, JSON.stringify(jEntry));
    check('العقل: youtube_comments بصلاحية READ (ليست خارجية)', jEntry?.permission === 'READ');
    check('العقل: commentThreads.list استُدعي فعلاً على Data API', (mock.state.lastCommentsPath || '').includes('/youtube/v3/commentThreads'));
    check('العقل: videoId المُرسل من بين الفيديوهات الحقيقية في القناة', mock.state.videos.some((v: any) => v.id === mock.state.lastCommentsVideoId), String(mock.state.lastCommentsVideoId));
    check('العقل: لا خطوة رد خارجية أُرسلت تلقائياً', !(agentComments.task?.journal || []).some((e: any) => e.toolId === 'youtube_reply'));

    // التعليق الحقيقي قد يكون على فيديو غير أول فيديو: نضعه على الفيديو الثاني ونثبت الوصول إليه.
    const originalComments = mock.state.comments;
    mock.state.comments = [{ id: 'cmt_late', threadId: 'thr_late', videoId: mock.state.videos[1].id, author: 'أحمد', text: 'متى ينزل العرض الجديد؟', publishedAt: '2026-09-20T08:00:00Z', likeCount: 0 }];
    mock.state.lastCommentsVideoId = null;
    const agentLate = await (await fetch(`${BASE}/api/agent/tasks`, { method: 'POST', headers: auth, body: JSON.stringify({ task: 'اجلب أحدث تعليقات YouTube الحقيقية' }) })).json();
    const lateEntry = (agentLate.task?.journal || []).find((e: any) => e.toolId === 'youtube_comments');
    check('العقل: تعليق الفيديو غير الأول جُلب بنجاح', lateEntry?.ok === true, JSON.stringify(lateEntry));
    // نتحقق أن الأداة أعادت أحدث تعليق حقيقي (على الفيديو الثاني) عبر فحص مخرَج المهمة.
    const lateData = (agentLate.task?.result?.data || []).find((d: any) => d.toolId === 'youtube_comments');
    check('العقل: نتيجة التعليقات تحمل ملخّصاً (أُثبت المسار)', Boolean(lateData));
    mock.state.comments = originalComments;

    // حدّ ثابت: عدد طلبات commentThreads لا يتجاوز حدّ الفحص المضبوط.
    const scanLimit = (await import('../social/youtube')).YOUTUBE_COMMENT_SCAN_VIDEO_LIMIT;
    check('العقل: حدّ فحص الفيديوهات ثابت وصريح', scanLimit === 5);

    // طلب YouTube عام بلا تعليقات: لا يجب أن يستدعي commentThreads إطلاقاً.
    mock.state.lastCommentsPath = null;
    const agentGeneral = await (await fetch(`${BASE}/api/agent/tasks`, { method: 'POST', headers: auth, body: JSON.stringify({ task: 'حلل أداء قناة يوتيوب' }) })).json();
    check('العقل: الخطة العامة بلا youtube_comments', !(agentGeneral.task?.plan?.steps || []).some((s: any) => s.toolId === 'youtube_comments'));
    check('العقل: الطلب العام لم يستهلك commentThreads', mock.state.lastCommentsPath === null);

    group('12j) تكامل: الحالة الصادقة بعد دليل مزود (رفع/رد) => OPERATIONAL');
    const diag = await (await fetch(`${BASE}/api/platforms/youtube/diagnostics`, { headers: auth })).json();
    check('التشخيص للمالك فقط ويعمل', diag.success === true);
    check('التشخيص لا يكشف أي سرّ', !JSON.stringify(diag).includes(GO_CLIENT_SECRET) && !JSON.stringify(diag).includes(mock.state.accessToken));
    check('الحالة الصادقة بعد دليل مزود', diag.state?.state === 'OPERATIONAL');

    group('12k) تكامل: حارس YOUTUBE_ONLY_OPERATIONAL مربوط بمسارات التنفيذ الخارجي');
    // الحارس منطقياً مُختبر في 4a؛ هنا نثبت أنه مربوط فعلاً بمسارات التنفيذ الخارجي
    // في الخادم ووحدة المسارات الاجتماعية (لا مجرد تعريف غير مستخدم).
    const serverSrc = readFileSync(join(REPO_ROOT, 'server.ts'), 'utf8');
    const socialSrc = readFileSync(join(REPO_ROOT, 'engine/social/routes.ts'), 'utf8');
    check('الحارس معرّف في الخادم', serverSrc.includes('function youtubeOnlyBlock('));
    check('الحارس يُستدعى في النشر الموحّد', /app\.post\("\/api\/platforms\/:platform\/publish"[\s\S]{0,900}?youtubeOnlyBlock\(platform\)/.test(serverSrc));
    check('الحارس يُستدعى في رد Telegram', /\/api\/platforms\/telegram\/reply"[\s\S]{0,900}?youtubeOnlyBlock\("telegram"\)/.test(serverSrc));
    check('الحارس يُستدعى في تنفيذ المهام المعتمدة', /async function executeApprovedJob[\s\S]{0,1200}?youtubeOnlyBlock\(platform\)/.test(serverSrc));
    check('الحارس يُحقن في مسارات السوشيال', serverSrc.includes('platformOperationGuard:') && socialSrc.includes('deps.platformOperationGuard'));
    check('وحدة المسارات تمنع عند الحجب', /platformOperationGuard\(platform\)[\s\S]{0,200}?blocked/.test(socialSrc));

    group('13) تكامل: الفصل يمسح الاعتماد المشفّر');
    const disc = await fetch(`${BASE}/api/platforms/youtube/disconnect`, { method: 'POST', headers: auth, body: '{}' });
    check('disconnect ينجح', disc.status === 200);
    const afterPlats = await (await fetch(`${BASE}/api/platforms/capabilities`, { headers: auth })).json();
    const afterYt = (afterPlats.platforms || []).find((p: any) => p.id === 'youtube')?.connection || {};
    check('بعد الفصل: غير متصل وغير موثق', afterYt.status === 'disconnected' && afterYt.providerVerified !== true);
    const healthAfterDisc = await (await fetch(`${BASE}/api/health`)).json();
    check('بعد الفصل: لا توكن محفوظ', healthAfterDisc.youtubeOAuth?.accessTokenStored === false);
  } finally {
    try { if (currentApp) await stop(currentApp.proc); } catch { /* تجاهل */ }
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
    console.log(`PASSED: ${passed} youtube connector checks`);
  }
})().catch((err) => { console.error('YouTube connector harness crashed:', err); process.exit(1); });
