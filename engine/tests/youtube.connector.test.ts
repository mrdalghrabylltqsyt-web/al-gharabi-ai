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
  resolveYouTubeScopes,
  youtubeCapabilityStatus,
  youtubeCapabilityImplemented,
  parseChannelListResponse,
  classifyYouTubeTokenError,
  classifyYouTubeApiError,
  buildChannelsMineUrl,
  YouTubeClient,
} from '../social/youtube';
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
  group('1) وحدة: مصفوفة القدرات — لا تُعلن قدرة محتوى غير منفّذة');
  const byKey = Object.fromEntries(YOUTUBE_CAPABILITY_MATRIX.map((r) => [r.key, r]));
  check('OAuth Login مدعوم', youtubeCapabilityImplemented('oauth_login'));
  check('إثبات هوية القناة مدعوم', youtubeCapabilityImplemented('channel_identity') && byKey['channel_identity'].status === 'SUPPORTED');
  check('حفظ الاتصال المشفّر مدعوم', youtubeCapabilityImplemented('connection_persistence'));
  check('رفع الفيديو غير منفّذ', byKey['video_upload'].status === 'NOT_IMPLEMENTED');
  check('قراءة التعليقات غير منفّذة', byKey['comments_read'].status === 'NOT_IMPLEMENTED');
  check('الرد على التعليقات غير منفّذ', byKey['comment_reply'].status === 'NOT_IMPLEMENTED');
  check('التحليلات غير منفّذة', byKey['analytics'].status === 'NOT_IMPLEMENTED');
  check('الجدولة غير منفّذة', byKey['scheduling'].status === 'NOT_IMPLEMENTED');
  check('webhooks تحتاج مراجعة', byKey['webhook_pubsub'].status === 'REQUIRES_REVIEW');
  check('قدرة غير معروفة تُعيد null لا ادعاء', youtubeCapabilityStatus('nope') === null && !youtubeCapabilityImplemented('nope'));
  check('لا قدرة بحالة غير معروفة', YOUTUBE_CAPABILITY_MATRIX.every((r) => ['SUPPORTED', 'NOT_IMPLEMENTED', 'REQUIRES_REVIEW'].includes(r.status)));

  group('2) وحدة: النطاقات الرسمية');
  check('youtube.readonly مطلوب (يغطّي channels.list)', YOUTUBE_REQUIRED_SCOPES.includes(YOUTUBE_READONLY_SCOPE));
  check('youtube.upload باقٍ بقرار المالك', YOUTUBE_REQUIRED_SCOPES.includes(YOUTUBE_UPLOAD_SCOPE));
  check('لا force-ssl الآن (التعليقات مؤجّلة)', !YOUTUBE_REQUIRED_SCOPES.some((s) => s.includes('force-ssl')));
  check('المجموعة بلا تكرار', new Set(YOUTUBE_REQUIRED_SCOPES).size === YOUTUBE_REQUIRED_SCOPES.length);
  const partial = resolveYouTubeScopes(['https://www.googleapis.com/auth/youtube.readonly']);
  check('حلّ مجموعة جزئية يعيد النطاقين دائماً', partial.includes(YOUTUBE_READONLY_SCOPE) && partial.includes(YOUTUBE_UPLOAD_SCOPE));
  const junk = resolveYouTubeScopes(['https://www.googleapis.com/auth/youtube.force-ssl', 'not-a-scope']);
  check('حلّ مجموعة يُهمل أي نطاق غير رسمي', !junk.includes('https://www.googleapis.com/auth/youtube.force-ssl') && !junk.includes('not-a-scope') && junk.length === 2);

  group('3) وحدة: قراءة القناة وتصنيف الأخطاء');
  const parsed = parseChannelListResponse({ items: [{ id: 'UC_1', snippet: { title: 'قناة' }, contentDetails: { relatedPlaylists: { uploads: 'UU_1' } } }] });
  check('يستخرج هوية القناة', parsed?.channelId === 'UC_1' && parsed?.title === 'قناة' && parsed?.uploadsPlaylistId === 'UU_1');
  check('لا يختلق هوية عند غياب items', parseChannelListResponse({ items: [] }) === null && parseChannelListResponse(null) === null);
  check('مسار القناة الرسمي صحيح', buildChannelsMineUrl('http://x').endsWith('/youtube/v3/channels?part=snippet,contentDetails&mine=true'));
  check('تصنيف invalid_grant', classifyYouTubeTokenError({ error: 'invalid_grant' }) === 'invalid_grant');
  check('تصنيف invalid_client', classifyYouTubeTokenError({ error: 'invalid_client' }) === 'invalid_client');
  check('تصنيف insufficientPermissions لقناة', classifyYouTubeApiError({ error: { errors: [{ reason: 'insufficientPermissions' }] } }) === 'insufficient_permissions');
  check('تصنيف accessNotConfigured', classifyYouTubeApiError({ error: { errors: [{ reason: 'accessNotConfigured' }] } }) === 'access_not_configured');

  group('4) وحدة: عميل YouTube بخادم وهمي (لا شبكة حقيقية)');
  // يُختبر العميل وحده عبر mock مدمج في نفس الدالة أدناه (integrationTests) لأن
  // العميل يحتاج fetchImpl فقط — نحن نمرّره هنا بعميل حقيقي لخادم الوهم.

  group('4b) وحدة: واجهة YouTube تستدعي health وتعرض القناة بلا أي سرّ');
  const ui = readFileSync(join(REPO_ROOT, 'src/components/social/PlatformConnectionCenter.tsx'), 'utf8');
  check('الواجهة تستدعي getPlatformHealth(\'youtube\')', ui.includes("getPlatformHealth('youtube')"));
  check('الواجهة تعرض زر «فحص القناة — قراءة فقط»', ui.includes('فحص القناة — قراءة فقط'));
  check('الواجهة تعرض اسم القناة accountName', ui.includes('accountName'));
  check('الواجهة تعرض معرّف القناة accountId', ui.includes('accountId'));
  check('الواجهة تعرض وقت آخر فحص checkedAt', ui.includes('checkedAt'));
  check('الواجهة تُعلن نجاح الفحص', ui.includes('حالة الفحص: ناجح'));
  check('الواجهة تُظهر إعادة ربط عند 409', ui.includes('إعادة ربط Google مطلوبة') && ui.includes('إعادة ربط OAuth'));
  check('لوحة YouTube تُعرض للمالك فقط في مركز الربط', /platform === 'youtube'[\s\S]{0,120}?YouTubeStatusPanel/.test(ui));
  check('الواجهة تُعلن أن الرفع/النشر غير منفّذ', /الرفع[\s\S]{0,80}?غير منفّذة/.test(ui));
  check('الواجهة لا تطبع token/secret', !/access_token|refresh_token|clientSecret\}/.test(ui));
  const apiSrc = readFileSync(join(REPO_ROOT, 'src/services/api.ts'), 'utf8');
  check('طبقة API تصل health بالمسار الصحيح', apiSrc.includes('/api/platforms/${encodeURIComponent(platform)}/health'));
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
    check('health: youtube.upload باقٍ', health.youtubeOAuth?.uploadScopePresent === true);
    check('health: لا force-ssl', !JSON.stringify(health.youtubeOAuth?.requestedScopes || []).includes('force-ssl'));
    check('health: إثبات القناة منفّذ', health.youtubeOAuth?.channelIdentityCallImplemented === true);
    check('health: موصل حقيقي', health.youtubeOAuth?.realConnector === true);
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
    check('oauth/setup لا يكشف السرّ', !JSON.stringify(setup).includes(GO_CLIENT_SECRET));
    check('youtubeSetup يعلن النطاقين والقدرات', setup.youtubeSetup?.readonlyScopePresent === true && Array.isArray(setup.youtubeSetup?.notImplementedCapabilities));
    check('youtubeSetup يعلن رفع الفيديو غير منفّذ', (setup.youtubeSetup?.notImplementedCapabilities || []).includes('video_upload'));

    group('7) تكامل: oauth/start (owner) يبني رابط Google الصحيح');
    const startAnon = await fetch(`${BASE}/api/platforms/youtube/oauth/start`);
    check('oauth/start بلا جلسة => 401', startAnon.status === 401);
    const start = await (await fetch(`${BASE}/api/platforms/youtube/oauth/start`, { headers: auth })).json();
    const authUrl = new URL(start.authorizationUrl || "https://invalid.local");
    check('رابط التفويض يوجّه إلى Google', authUrl.origin === 'https://accounts.google.com' && authUrl.pathname === '/o/oauth2/v2/auth');
    check('redirect_uri المُرسل إلى Google مطابق تماماً', authUrl.searchParams.get('redirect_uri') === `${BASE}/api/platforms/youtube/oauth/callback`);
    check('scope يحمل youtube.readonly', (authUrl.searchParams.get('scope') || '').includes(YOUTUBE_READONLY_SCOPE));
    check('scope يحمل youtube.upload', (authUrl.searchParams.get('scope') || '').includes(YOUTUBE_UPLOAD_SCOPE));
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

    group('12) تكامل: لا قدرة محتوى في السجل العام (لا ادعاء غير منفّذ)');
    check('YouTube بلا أي قدرة محتوى', ['publish', 'analytics', 'comments', 'comment_reply', 'scheduling', 'audience_insights'].every((c) => !platformSupports('youtube', c)));
    check('YouTube مُعلن موصلاً حقيقياً في السجل', hasRealConnector('youtube') && PLATFORM_SPECS.find((s) => s.platform === 'youtube')?.realConnector === true);

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
