/**
 * اختبارات موصل YouTube الحقيقي — خامس تكامل اجتماعي خارجي.
 *
 * طبقتان:
 *  1) وحدة: الدوال الحتمية (مصفوفة القدرات، النطاقات، صيغة معرّف عميل Google،
 *     تصنيف أخطاء Google والحصة، بناء الروابط/الأجسام، تحليل الاستجابات، تحليل
 *     إشعارات PubSubHubbub) + الحالة الصادقة، بلا أي شبكة.
 *  2) تكامل: الخادم الحقيقي مع خادم Google/YouTube وهمي محلي عبر
 *     YOUTUBE_API_BASE/YOUTUBE_GOOGLE_BASE، فيُختبر: OAuth (start → callback →
 *     تبادل → إثبات القناة)، الحفظ المشفّر، التجديد التلقائي، رفض state وإعادة
 *     استخدامه، الحماية من التكرار، قراءة القناة/الفيديوهات/التعليقات، الرد
 *     الحقيقي (بمعرّف من المزود)، حارس السلامة، منع التكرار، التصريح، تصنيف خطأ
 *     الحصة (quotaExceeded)، وثبات الأحداث وإعادة التشغيل.
 *
 * لا يلمس أي مزود Google حقيقي ولا يستهلك أي حصة، ولا يستخدم أي سرّ واقعي.
 */

import express from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHmac, createHash } from 'node:crypto';
import {
  YOUTUBE_CAPABILITY_MATRIX,
  YOUTUBE_REQUIRED_SCOPES,
  YOUTUBE_KNOWN_SCOPES,
  YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS,
  YOUTUBE_QUOTA_COST,
  YOUTUBE_PUBSUB_SIGNATURE_HEADER,
  youtubeCapabilityStatus,
  youtubeCapabilitySupported,
  youtubeCapabilityNeedsAudit,
  youtubeCapabilityImplemented,
  resolveYouTubeScopes,
  youtubeExtraScopes,
  isPlausibleYouTubeClientId,
  fingerprintValue,
  maskSecretValue,
  quotaUnitsFor,
  classifyYouTubeError,
  describeYouTubeErrorKind,
  parseGoogleErrorReason,
  parseYouTubeTokenResponse,
  parseYouTubeChannel,
  parseYouTubeVideo,
  parseYouTubePlaylist,
  parseYouTubeComment,
  parseYouTubeCommentThreads,
  buildYouTubeAuthorizationUrl,
  buildYouTubeTokenExchangeBody,
  buildYouTubeRefreshBody,
  buildCommentReplyBody,
  parseYouTubePushNotification,
  youtubePushExternalId,
  youtubeApiUrl,
  youtubeTokenUrl,
  youtubeRevokeUrl,
} from '../social/youtube';
import { createYouTubeMock, startYouTubeMockServer } from './helpers/youtubeMock';
import {
  resolveYouTubeState,
  YOUTUBE_TRUTHFUL_STATES,
  YOUTUBE_STATE_LABELS_AR,
  YOUTUBE_STATE_TONES,
  youtubeStateIsVerified,
  youtubeStateIsOperational,
  type YouTubeStateInput,
} from '../social/youtubeState';
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
const APP_PORT = 7500 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const YT_PORT = 7600 + Math.floor(Math.random() * 80);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'youtube-connector-test-secret-not-real';
const GOOGLE_CLIENT_ID = '1234567890-test.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = 'test-google-client-secret-not-real';
const PUBSUB_SECRET = 'test-pubsub-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-youtube-'));
const TOKEN_KEY = randomBytes(32).toString('hex');

const secretBuffer = createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };
const staffUser = { id: 'staff-1', name: 'موظف اختبار', email: 'staff@example.invalid', role: 'staff', roleTitleArabic: 'الموظف', avatar: '', active: true, createdAt: new Date().toISOString() };

function startApp(mockBase: string, extraEnv: Record<string, string> = {}): { proc: ChildProcess; log: () => string } {
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
    YOUTUBE_API_BASE: `${mockBase}/youtube/v3`,
    YOUTUBE_GOOGLE_BASE: mockBase,
    GOOGLE_OAUTH_CLIENT_ID: GOOGLE_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: GOOGLE_CLIENT_SECRET,
    YOUTUBE_PUBSUB_SECRET: PUBSUB_SECRET,
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
/** يبني توقيع PubSubHubbub الصحيح: sha1=hmac-sha1(secret, rawBody). */
function pubsubSignature(rawBody: string, secret: string): string {
  return 'sha1=' + createHmac('sha1', secret).update(rawBody, 'utf8').digest('hex');
}

function unitTests(): void {
  group('1) وحدة: مصفوفة القدرات الرسمية — لا تُعلن قدرة غير مدعومة');
  const byKey = Object.fromEntries(YOUTUBE_CAPABILITY_MATRIX.map((r) => [r.key, r]));
  check('OAuth (Google) مدعوم', youtubeCapabilitySupported('oauth_connection'));
  check('هوية القناة مدعومة', youtubeCapabilitySupported('channel_identity'));
  check('قراءة قوائم التشغيل مدعومة', youtubeCapabilitySupported('playlists_read'));
  check('قراءة الفيديوهات مدعومة', youtubeCapabilitySupported('videos_list'));
  check('التعليقات مدعومة (بخلاف TikTok)', youtubeCapabilitySupported('comments_read'));
  check('الرد على التعليق مدعوم', youtubeCapabilitySupported('comment_reply'));
  check('التحليلات مدعومة', youtubeCapabilitySupported('analytics_read'));
  check('رفع الفيديو غير منفّذ صراحةً (لا ادعاء تنفيذ)', byKey['video_upload']?.status === 'NOT_IMPLEMENTED' && !youtubeCapabilityImplemented('video_upload'));
  check('رفع الفيديو لا يُصنَّف «ينتظر مراجعة» لعدم وجود تنفيذ', !youtubeCapabilityNeedsAudit('video_upload'));
  check('إشعارات PubSubHubbub تحتاج مراجعة/تسجيل خارجي', youtubeCapabilityNeedsAudit('push_notifications'));
  check('لا قدرة بحالة غير معروفة', YOUTUBE_CAPABILITY_MATRIX.every((r) => ['SUPPORTED', 'REQUIRES_REVIEW', 'REQUIRES_AUDIT', 'NOT_AVAILABLE_BY_PUBLIC_API', 'NOT_IMPLEMENTED'].includes(r.status)));
  check('قدرة غير معروفة تُعيد null لا ادعاء', youtubeCapabilityStatus('does_not_exist') === null);

  group('2) وحدة: النطاقات الرسمية — لا نطاق بلا استدعاء');
  check('النطاقان الأساسيان مطلوبان', ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.force-ssl'].every((s) => YOUTUBE_REQUIRED_SCOPES.includes(s)));
  check('المجموعة بلا تكرار', new Set(YOUTUBE_REQUIRED_SCOPES).size === YOUTUBE_REQUIRED_SCOPES.length);
  check('رفع الفيديو يحتاج youtube.upload ولا يُطلب افتراضياً (لا استدعاء في المسار الأساسي)', !YOUTUBE_REQUIRED_SCOPES.includes('https://www.googleapis.com/auth/youtube.upload'));
  check('حلّ تجاوز جزئي يُبقي النطاقين المطلوبين', YOUTUBE_REQUIRED_SCOPES.every((s) => resolveYouTubeScopes(['https://www.googleapis.com/auth/youtube.upload']).includes(s)));
  check('حلّ تجاوز يضيف النطاق الرسمي المطلوب صراحةً', resolveYouTubeScopes(['https://www.googleapis.com/auth/youtube.upload']).includes('https://www.googleapis.com/auth/youtube.upload'));
  check('تجاوز بنطاق غير معروف يُهمَل', !resolveYouTubeScopes(['not_a_real_scope']).includes('not_a_real_scope'));
  check('الفارق يُعلن عبر youtubeExtraScopes', JSON.stringify(youtubeExtraScopes(['https://www.googleapis.com/auth/youtube.upload'])) === JSON.stringify(['https://www.googleapis.com/auth/youtube.upload']));
  check('youtube.upload ضمن النطاقات المعلومة', YOUTUBE_KNOWN_SCOPES.includes('https://www.googleapis.com/auth/youtube.upload'));

  group('3) وحدة: صيغة معرّف عميل Google والروابط الرسمية');
  check('معرّف عميل ويب صالح مقبول', isPlausibleYouTubeClientId(GOOGLE_CLIENT_ID));
  check('معرّف بمسافة زائدة مرفوض', !isPlausibleYouTubeClientId(` ${GOOGLE_CLIENT_ID} `));
  check('معرّف بلا لاحقة Google مرفوض', !isPlausibleYouTubeClientId('1234567890.apps.other.com'));
  check('معرّف فارغ مرفوض', !isPlausibleYouTubeClientId('') && !isPlausibleYouTubeClientId(null));
  check('رابط Data API الرسمي صحيح', youtubeApiUrl('/channels') === 'https://www.googleapis.com/youtube/v3/channels');
  check('رابط الرمز الرسمي صحيح', youtubeTokenUrl() === 'https://oauth2.googleapis.com/token');
  check('رابط الإبطال الرسمي صحيح', youtubeRevokeUrl('t') === 'https://oauth2.googleapis.com/revoke?token=t');
  check('القاعدة قابلة للتجاوز في الاختبار', youtubeApiUrl('/channels', 'http://127.0.0.1:9').startsWith('http://127.0.0.1:9/channels'));
  check('maskSecretValue يُظهر أول4/آخر4', maskSecretValue('abcdefgh12345678') === 'abcd…5678');
  check('بصمة SHA-256 مقتطعة ثابتة', /^[0-9a-f]{12}$/.test(fingerprintValue('x')) && fingerprintValue('x') === fingerprintValue('x'));

  group('4) وحدة: الحصة وتصنيف أخطاء Google');
  check('الحدّ اليومي 10000 وحدة (موثّق)', YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS === 10000);
  check('search = 100 وحدة', quotaUnitsFor('search_list') === 100);
  check('videos.list = 1 وحدة', quotaUnitsFor('videos_list') === 1);
  check('comments.insert = 50 وحدة', quotaUnitsFor('comments_insert') === 50);
  check('videos.insert = 1600 وحدة', quotaUnitsFor('videos_insert') === 1600);
  check('عملية غير معلومة = 0 (لا تخمين)', quotaUnitsFor('unknown_op') === 0);
  check('quotaExceeded فئة مستقلة عن العطل', classifyYouTubeError({ status: 403, body: { error: { errors: [{ reason: 'quotaExceeded', message: 'quota' }] } } }).kind === 'quota_exceeded');
  check('dailyLimitExceeded يُصنَّف حصة', classifyYouTubeError({ status: 403, body: { error: { errors: [{ reason: 'dailyLimitExceeded' }] } } }).kind === 'quota_exceeded');
  check('rateLimitExceeded فئة مستقلة وقابلة للإعادة', classifyYouTubeError({ status: 403, body: { error: { errors: [{ reason: 'rateLimitExceeded' }] } } }).kind === 'rate_limit');
  check('429 يُصنَّف rate_limit', classifyYouTubeError({ status: 429 }).kind === 'rate_limit');
  check('invalid_grant يوجب إعادة الربط', classifyYouTubeError({ status: 400, body: { error: 'invalid_grant' } }).requiresReauth === true);
  check('401 يوجب إعادة الربط', classifyYouTubeError({ status: 401 }).requiresReauth === true);
  check('403 insufficientPermissions = صلاحية', classifyYouTubeError({ status: 403, body: { error: { errors: [{ reason: 'insufficientPermissions' }] } } }).kind === 'permission_denied');
  check('404 = not_found', classifyYouTubeError({ status: 404 }).kind === 'not_found');
  check('500 = provider_error قابل للإعادة', classifyYouTubeError({ status: 500 }).retryable === true);
  check('خطأ الشبكة يُصنَّف provider_error', classifyYouTubeError({ networkError: true }).kind === 'provider_error');
  check('استخراج سبب Google الرسمي', parseGoogleErrorReason({ error: { errors: [{ reason: 'quotaExceeded' }] } }) === 'quotaExceeded');
  check('وصف الحصة يذكر quota', /quota/.test(describeYouTubeErrorKind('quota_exceeded')));

  group('5) وحدة: بناء الروابط والأجسام وتحمّل الاستجابات');
  const authUrl = new URL(buildYouTubeAuthorizationUrl({ clientId: GOOGLE_CLIENT_ID, redirectUri: 'https://app.invalid/api/platforms/youtube/oauth/callback', scopes: [...YOUTUBE_REQUIRED_SCOPES], state: 'st1234567890abcdef' }));
  check('رابط التفويض على نقطة Google الرسمية', authUrl.host === 'accounts.google.com' && authUrl.pathname === '/o/oauth2/v2/auth');
  check('response_type=code', authUrl.searchParams.get('response_type') === 'code');
  check('access_type=offline (طلب refresh token)', authUrl.searchParams.get('access_type') === 'offline');
  check('prompt=consent', authUrl.searchParams.get('prompt') === 'consent');
  check('النطاقات مفصولة بمسافة', (authUrl.searchParams.get('scope') || '').split(' ').length === YOUTUBE_REQUIRED_SCOPES.length);
  const ex = buildYouTubeTokenExchangeBody({ clientId: 'c', clientSecret: 's', code: 'code1', redirectUri: 'r' });
  check('جسم التبادل يحمل grant_type=authorization_code', ex.get('grant_type') === 'authorization_code' && ex.get('code') === 'code1');
  const rf = buildYouTubeRefreshBody({ clientId: 'c', clientSecret: 's', refreshToken: 'rt' });
  check('جسم التجديد يحمل grant_type=refresh_token', rf.get('grant_type') === 'refresh_token' && rf.get('refresh_token') === 'rt');
  const reply = buildCommentReplyBody({ parentId: 'Ugz1', text: 'شكراً' });
  check('جسم الرد يستخدم textOriginal وparentId', (reply as any).snippet.parentId === 'Ugz1' && (reply as any).snippet.textOriginal === 'شكراً');
  const tok = parseYouTubeTokenResponse({ access_token: 'a', refresh_token: 'r', scope: 's1 s2', expires_in: 3600 });
  check('تحليل الرمز يقرأ access/refresh/scope/expires', tok.accessToken === 'a' && tok.refreshToken === 'r' && tok.scope.length === 2 && tok.expiresIn === 3600);
  check('تحليل الرمز بلا access => null', parseYouTubeTokenResponse({}).accessToken === null);
  const ch = parseYouTubeChannel({ id: 'UC1', snippet: { title: 'قناة' }, statistics: { viewCount: '10', subscriberCount: '2', videoCount: '3', hiddenSubscriberCount: false } });
  check('تحليل القناة يقرأ id والإحصاءات', ch?.channelId === 'UC1' && ch?.statistics.viewCount === 10 && ch?.statistics.videoCount === 3);
  check('تحليل قناة بلا id => null', parseYouTubeChannel({ snippet: {} }) === null);
  const vid = parseYouTubeVideo({ id: { videoId: 'v1' }, snippet: { title: 't' }, statistics: { viewCount: '5' } });
  check('تحليل الفيديو يقرأ videoId من الكائن', vid?.videoId === 'v1' && vid?.statistics.viewCount === 5);
  check('تحليل قائمة تشغيل', parseYouTubePlaylist({ id: 'PL1', contentDetails: { itemCount: 4 } })?.itemCount === 4);
  const cm = parseYouTubeComment({ id: 'Ugz1', snippet: { videoId: 'v1', authorDisplayName: 'أحمد', textOriginal: 'بكم؟' } });
  check('تحليل التعليق يقرأ commentId والنص', cm?.commentId === 'Ugz1' && cm?.text === 'بكم؟');
  check('تعليق بلا نص => null (لا اختراع)', parseYouTubeComment({ id: 'x', snippet: {} }) === null);
  const threads = parseYouTubeCommentThreads({ items: [{ snippet: { topLevelComment: { id: 'c1', snippet: { textOriginal: 'س1' } } }, replies: { comments: [{ id: 'c2', snippet: { textOriginal: 'ر1' } }] } }] });
  check('تحليل commentThreads يفلطح التعليق الأعلى وردوده', threads.length === 2 && threads[0].commentId === 'c1' && threads[1].commentId === 'c2');
  const notif = parseYouTubePushNotification({ feed: { entry: { 'yt:videoId': 'v1', 'yt:channelId': 'UC1', title: 'جديد', updated: '2025-01-01T00:00:00Z' } } });
  check('تحليل إشعار PubSubHubbub يقرأ videoId/channelId', notif?.videoId === 'v1' && notif?.channelId === 'UC1');
  check('إشعار بلا videoId => null', parseYouTubePushNotification({ feed: { entry: {} } }) === null);
  check('معرّف الحدث الخارجي حتمي', youtubePushExternalId('v1', 'u1') === 'yt:v1:u1');
  check('ترويسة توقيع PubSubHubbub معلنة', YOUTUBE_PUBSUB_SIGNATURE_HEADER === 'x-hub-signature');

  group('6) وحدة: الحالة الصادقة — مفردة واحدة بترتيب أسبقية صريح');
  const baseState: YouTubeStateInput = {
    clientIdConfigured: true, clientSecretConfigured: true, clientIdFormatOk: true,
    encryptionKeyValid: true, publicUrlValid: true, pendingAuthorization: false,
    tokenStored: false, refreshTokenStored: false, tokenExpired: false,
    connectionStatus: 'disconnected', accountDiscovered: false, providerVerified: false,
    operationalEvidence: false, quotaExceeded: false,
  };
  check('المفردات الإحدى عشرة معلنة بالضبط', YOUTUBE_TRUTHFUL_STATES.length === 11, YOUTUBE_TRUTHFUL_STATES.join(','));
  check('لكل حالة تسمية عربية', YOUTUBE_TRUTHFUL_STATES.every((s) => Boolean(YOUTUBE_STATE_LABELS_AR[s])));
  check('لكل حالة دلالة لون', YOUTUBE_TRUTHFUL_STATES.every((s) => Boolean(YOUTUBE_STATE_TONES[s])));
  check('بلا client_id => NOT_CONFIGURED', resolveYouTubeState({ ...baseState, clientIdConfigured: false }).state === 'NOT_CONFIGURED');
  check('NOT_CONFIGURED يذكر المتغير الناقص', /GOOGLE_OAUTH_CLIENT_ID/.test(resolveYouTubeState({ ...baseState, clientIdConfigured: false }).reason));
  check('صيغة client_id غريبة => EXTERNAL_BLOCKER', resolveYouTubeState({ ...baseState, clientIdFormatOk: false }).state === 'EXTERNAL_BLOCKER');
  check('مفتاح تشفير غير صالح => CODE_READY', resolveYouTubeState({ ...baseState, encryptionKeyValid: false }).state === 'CODE_READY');
  check('APP_URL غير عام => CODE_READY', resolveYouTubeState({ ...baseState, publicUrlValid: false }).state === 'CODE_READY');
  check('كل الشروط حاضرة => READY_TO_CONNECT', resolveYouTubeState(baseState).state === 'READY_TO_CONNECT');
  check('READY_TO_CONNECT يوجّه لزر الربط', /ربط YouTube/.test(resolveYouTubeState(baseState).nextAction));
  check('توكن منتهٍ بلا refresh => TOKEN_REFRESH_REQUIRED', resolveYouTubeState({ ...baseState, tokenStored: true, tokenExpired: true, refreshTokenStored: false, accountDiscovered: true }).state === 'TOKEN_REFRESH_REQUIRED');
  check('reauth_needed => TOKEN_REFRESH_REQUIRED', resolveYouTubeState({ ...baseState, connectionStatus: 'reauth_needed', tokenStored: true }).state === 'TOKEN_REFRESH_REQUIRED');
  check('حصة مستهلكة => QUOTA_EXCEEDED', resolveYouTubeState({ ...baseState, quotaExceeded: true, connectionStatus: 'connected', providerVerified: true, accountDiscovered: true, tokenStored: true }).state === 'QUOTA_EXCEEDED');
  check('مراجعة مطلوبة => REVIEW_REQUIRED', resolveYouTubeState({ ...baseState, providerErrorKind: 'review_required' }).state === 'REVIEW_REQUIRED');
  check('متصل غير موثق => CONNECTED', resolveYouTubeState({ ...baseState, connectionStatus: 'connected', tokenStored: true, accountDiscovered: true }).state === 'CONNECTED');
  check('موثق => VERIFIED', resolveYouTubeState({ ...baseState, connectionStatus: 'connected', providerVerified: true, tokenStored: true, accountDiscovered: true }).state === 'VERIFIED');
  check('موثق + دليل مزود => OPERATIONAL', resolveYouTubeState({ ...baseState, connectionStatus: 'connected', providerVerified: true, tokenStored: true, accountDiscovered: true, operationalEvidence: true }).state === 'OPERATIONAL');
  check('لا VERIFIED بلا توثيق', resolveYouTubeState({ ...baseState, connectionStatus: 'connected' }).state !== 'VERIFIED');
  check('لا OPERATIONAL بلا دليل', resolveYouTubeState({ ...baseState, connectionStatus: 'connected', providerVerified: true }).state !== 'OPERATIONAL');
  check('توكن محفوظ بلا اتصال => AUTHORIZATION_REQUIRED', resolveYouTubeState({ ...baseState, tokenStored: true }).state === 'AUTHORIZATION_REQUIRED');
  check('دوال الحالة صحيحة', youtubeStateIsVerified('OPERATIONAL') && youtubeStateIsVerified('VERIFIED') && !youtubeStateIsVerified('CONNECTED') && youtubeStateIsOperational('OPERATIONAL') && !youtubeStateIsOperational('VERIFIED'));

  group('7) وحدة: سجل الموصلات — YouTube موصل حقيقي معلن');
  const yt = PLATFORM_SPECS.find((p) => p.platform === 'youtube');
  check('YouTube مسجّل كموصل حقيقي', Boolean(yt) && hasRealConnector('youtube'));
  check('YouTube يعلن comment_reply صراحةً', Boolean(yt?.capabilities.includes('comment_reply')));
  check('YouTube لا يعلن publish (الرفع غير منفّذ)', Boolean(yt) && !yt!.capabilities.includes('publish'));
  check('YouTube يعلن القناة/التعليقات/الرد/الجدولة', Boolean(yt) && ['comments', 'comment_reply', 'scheduling', 'analytics'].every((c) => yt!.capabilities.includes(c as any)));
  check('YouTube لا يعلن messages (غير منفّذ)', Boolean(yt) && !yt!.capabilities.includes('messages'));
}

async function integrationTests(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser, staffUser],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: { showroom: {}, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [], providerTokens: {} },
  }), 'utf8');

  const mock = await startYouTubeMockServer(YT_PORT, createYouTubeMock());
  let app = startApp(mock.base);
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 500));
    Object.assign(auth, await login());
    const staffToken = signSession({ uid: 'staff-1', iat: Date.now(), exp: Date.now() + 3_600_000, sid: randomBytes(8).toString('hex') }, secretBuffer);
    const staffAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` };

    group('8) تكامل: التصريح — مسارات YouTube محمية');
    check('status بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/youtube/status`)).status === 401);
    check('channel بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/youtube/channel`)).status === 401);
    check('comments بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/youtube/comments?videoId=v1`)).status === 401);
    check('oauth-info لغير المالك => 403', (await fetch(`${BASE}/api/platforms/youtube/oauth-info`, { headers: staffAuth })).status === 403);
    check('reply لغير المالك => 403', (await fetch(`${BASE}/api/platforms/youtube/reply`, { method: 'POST', headers: staffAuth, body: '{}' })).status === 403);
    check('ingest-comment لغير المالك => 403', (await fetch(`${BASE}/api/platforms/youtube/ingest-comment`, { method: 'POST', headers: staffAuth, body: '{}' })).status === 403);
    check('oauth/start لغير المالك => 403', (await fetch(`${BASE}/api/platforms/youtube/oauth/start`, { headers: staffAuth })).status === 403);
    check('disconnect بلا جلسة => 401', (await fetch(`${BASE}/api/platforms/youtube/disconnect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 401);

    group('9) تكامل: oauth-info يعرض الإعداد الدقيق بلا أي سرّ');
    const info = await (await fetch(`${BASE}/api/platforms/youtube/oauth-info`, { headers: auth })).json();
    check('oauth-info يعلن client_id مضبوطاً وصالحاً شكلياً', info.clientIdConfigured === true && info.clientIdFormatOk === true);
    check('oauth-info يعلن client_secret مضبوطاً', info.clientSecretConfigured === true);
    check('oauth-info يعرض redirectUri الصحيح', String(info.redirectUri).endsWith('/api/platforms/youtube/oauth/callback'));
    check('oauth-info يعرض النطاقات الرسمية', JSON.stringify(info.requestedScopes) === JSON.stringify([...YOUTUBE_REQUIRED_SCOPES]));
    check('oauth-info يعلن نقطة Google للرمز', String(info.tokenEndpoint).includes('oauth2.googleapis.com'));
    check('oauth-info يعلن رابط webhook', String(info.webhookUrl).endsWith('/api/platforms/youtube/webhook'));
    check('oauth-info يعرض مصفوفة القدرات', Array.isArray(info.capabilityMatrix));
    check('oauth-info يعلن الحصة اليومية', info.dailyQuotaUnits === YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS);
    check('oauth-info بلا أي سرّ', !JSON.stringify(info).includes(GOOGLE_CLIENT_SECRET) && !JSON.stringify(info).includes(GOOGLE_CLIENT_ID));

    group('10) تكامل: تشخيص client_id — بلا كشف القيمة كاملة');
    const diag = await (await fetch(`${BASE}/api/platforms/youtube/client-diagnosis`, { headers: auth })).json();
    check('التشخيص يعلن اسمي المتغيرين', JSON.stringify(diag.envVarNames) === JSON.stringify(['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_CLIENT_ID']));
    check('التشخيص يعلن الطول الصحيح', diag.configuredValueLength === GOOGLE_CLIENT_ID.length);
    check('التشخيص يعلن الصيغة صالحة', diag.formatOk === true && diag.verdict === 'format_ok');
    check('التشخيص بلا مسافات زائدة', diag.hadSurroundingWhitespace === false);
    check('التشخيص لا يكشف client_id كاملاً', !JSON.stringify(diag).includes(GOOGLE_CLIENT_ID));
    check('التشخيص لا يكشف client_secret', !JSON.stringify(diag).includes(GOOGLE_CLIENT_SECRET));

    group('11) تكامل: OAuth start — رابط Google رسمي + state دائم');
    const start = await (await fetch(`${BASE}/api/platforms/youtube/oauth/start`, { headers: auth })).json();
    check('oauth/start ينجح ويُعيد رابط تفويض', start.success === true && typeof start.authorizationUrl === 'string');
    const aurl = new URL(start.authorizationUrl);
    check('الرابط على accounts.google.com الرسمي', aurl.host === 'accounts.google.com');
    check('الرابط يحمل client_id', aurl.searchParams.get('client_id') === GOOGLE_CLIENT_ID);
    check('الرابط يحمل access_type=offline', aurl.searchParams.get('access_type') === 'offline');
    check('الرابط يحمل prompt=consent', aurl.searchParams.get('prompt') === 'consent');
    check('الرابط يحمل النطاقات الرسمية', (aurl.searchParams.get('scope') || '').includes('youtube.force-ssl'));
    check('الرابط يحمل state', (aurl.searchParams.get('state') || '').length >= 16);
    check('الرابط لا يسرّب client_secret', !start.authorizationUrl.includes(GOOGLE_CLIENT_SECRET));
    const stateVal = aurl.searchParams.get('state')!;

    group('12) تكامل: callback — تبادل الرمز + إثبات القناة + حفظ مشفّر');
    const cbRes = await fetch(`${BASE}/api/platforms/youtube/oauth/callback?code=AUTHCODE_TEST&state=${encodeURIComponent(stateVal)}`, { headers: auth });
    check('callback يعيد 200', cbRes.status === 200, `status=${cbRes.status}`);
    check('تبادل الرمز نُفِّذ فعلياً لدى المزوّد', mock.state.lastExchange !== null && mock.state.lastExchange?.redirectUri.endsWith('/api/platforms/youtube/oauth/callback'));
    check('التبادل أرسل client_id الصحيح', mock.state.lastExchange?.clientId === GOOGLE_CLIENT_ID);

    const status = await (await fetch(`${BASE}/api/platforms/youtube/status`, { headers: auth })).json();
    check('الحالة متصلة وموثقة (channelId)', status.connected === true && status.providerVerified === true);
    check('channelId مخزّن', status.channelId === mock.state.channelId);
    check('اسم القناة مخزّن', status.channelTitle === mock.state.channelTitle);
    check('التوكن مخزّن مشفّراً', status.tokenStored === true);
    check('refresh token مخزّن', status.refreshTokenStored === true);
    check('الحالة الصادقة = VERIFIED بعد ربط موثق', status.state === 'VERIFIED', JSON.stringify(status).slice(0, 200));
    check('الحالة تحمل التسمية ودلالة اللون', typeof status.stateLabelAr === 'string' && ['operational', 'verified', 'transitional', 'blocked', 'unconfigured'].includes(status.stateTone));
    check('الحالة بلا أي سرّ', !JSON.stringify(status).includes(GOOGLE_CLIENT_SECRET) && !JSON.stringify(status).includes(mock.state.accessToken));
    check('مفردات الحالات معلنة في الرد', Array.isArray(status.truthfulStates) && status.truthfulStates.length === 11);
    check('oauthStateDurable = true (state مستمر)', status.oauthStateDurable === true);

    group('13) تكامل: إعادة استخدام state مرفوضة (منع replay)');
    const replay = await fetch(`${BASE}/api/platforms/youtube/oauth/callback?code=AUTHCODE_TEST&state=${encodeURIComponent(stateVal)}`, { headers: auth });
    check('إعادة استخدام state => 400', replay.status === 400, `status=${replay.status}`);
    const badState = await fetch(`${BASE}/api/platforms/youtube/oauth/callback?code=X&state=totally_invalid_state_value`, { headers: auth });
    check('state غير صالح => 400', badState.status === 400);

    group('14) تكامل: قراءة القناة والفيديوهات والتعليقات (حقيقية بلا اختراع)');
    const channel = await (await fetch(`${BASE}/api/platforms/youtube/channel`, { headers: auth })).json();
    check('channel ينجح', channel.success === true);
    check('channel يحمل الإحصاءات الحقيقية', channel.channel?.statistics?.viewCount === 99999 && channel.channel?.statistics?.videoCount === 42);
    check('channel يعلن وحدات الحصة (1)', channel.quotaUnits === 1);
    const videos = await (await fetch(`${BASE}/api/platforms/youtube/videos?maxResults=10`, { headers: auth })).json();
    check('videos ينجح ويعيد فيديوهات حقيقية', videos.success === true && Array.isArray(videos.videos) && videos.videos.length === 2);
    check('videos تحمل الإحصاءات', videos.videos[0]?.statistics?.viewCount === 1234);
    check('videos تعلن تكلفة search (100 وحدة)', videos.quotaUnits === 100);
    const single = await (await fetch(`${BASE}/api/platforms/youtube/video?videoId=vid_aaa111`, { headers: auth })).json();
    check('video ينجح بمعرّف حقيقي', single.success === true && single.video?.videoId === 'vid_aaa111');
    const comments = await (await fetch(`${BASE}/api/platforms/youtube/comments?videoId=vid_aaa111`, { headers: auth })).json();
    check('comments ينجح ويعيد تعليقات حقيقية', comments.success === true && comments.comments.length === 2);
    check('comments لا تختلق تعليقات (أسماء حقيقية من المزود)', comments.comments.some((c: any) => c.authorName === 'أحمد'));

    group('15) تكامل: تسجيل التعليقات + الرد الحقيقي (بمعرّف من المزود)');
    const ingest = await (await fetch(`${BASE}/api/platforms/youtube/ingest-comment`, { method: 'POST', headers: auth, body: JSON.stringify({ videoId: 'vid_aaa111' }) })).json();
    check('ingest-comment ينجح ويسجّل تعليقات', ingest.success === true && ingest.ingested === 2);
    check('ingest يعلن ingestSource الحقيقي', (await (await fetch(`${BASE}/api/social/manager/comments?platform=youtube`, { headers: auth })).json()).comments?.some((c: any) => c.ingestSource === 'youtube_commentThreads'));
    // رد حقيقي عبر مسار YouTube المخصص.
    const reply = await (await fetch(`${BASE}/api/platforms/youtube/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'Ugz_comment_top_1', text: 'شكراً لتواصلك مع معرض الغرابي.', commentText: 'بكم سعر الغسالة بالتقسيط؟', productName: 'غسالة' }) })).json();
    check('reply ينجح ويسجّل تسليماً', reply.success === true && reply.delivered === true);
    check('reply يحمل معرّف تعليق من المزود', reply.providerReplyId === mock.state.replyCommentId);
    check('comments.insert نُفِّذ فعلياً', mock.state.lastReply?.parentId === 'Ugz_comment_top_1');
    check('reply ليس محاكاة', reply.simulated === false);
    // D2: بعد رد مُسلَّم فعلاً (دليل مزود حقيقي) يبلغ YouTube السقف الصادق OPERATIONAL.
    const statusOperational = await (await fetch(`${BASE}/api/platforms/youtube/status`, { headers: auth })).json();
    check('رد مُسلَّم => الحالة الصادقة OPERATIONAL (سقف قابل للوصول)', statusOperational.state === 'OPERATIONAL', JSON.stringify(statusOperational).slice(0, 200));
    // منع الرد المكرر على نفس التعليق.
    const dup = await (await fetch(`${BASE}/api/platforms/youtube/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'Ugz_comment_top_1', text: 'نص مختلف تماماً للرد.', commentText: 'بكم سعر الغسالة بالتقسيط؟' }) })).json();
    check('الرد المكرر على نفس التعليق مرفوض (409)', dup.success === false);
    // حارس السلامة: عرض تجاري غير مسجّل يُرفض قبل أي إرسال.
    const unsafe = await fetch(`${BASE}/api/platforms/youtube/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'Ugz_comment_reply_1', text: 'خصم 50% على كل المنتجات اليوم!', commentText: 'شكراً على الشرح' }) });
    check('نص عرض غير مسجّل => 422 قبل الإرسال', unsafe.status === 422);
    // لا رد بلا تعليق حقيقي مسجّل.
    const missing = await fetch(`${BASE}/api/platforms/youtube/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'does_not_exist', text: 'رد' }) });
    check('لا رد بلا تعليق وارد => 404', missing.status === 404);

    group('16) تكامل: تصنيف خطأ الحصة (quotaExceeded) صريح لا كعطل عام');
    mock.state.quotaExceeded = true;
    const quotaResp = await fetch(`${BASE}/api/platforms/youtube/channel`, { headers: auth });
    const quotaBody = await quotaResp.json();
    check('خطأ الحصة => 502 بوسم quota_exceeded', quotaResp.status === 502 && quotaBody.code === 'quota_exceeded', JSON.stringify(quotaBody).slice(0, 200));
    const statusQuota = await (await fetch(`${BASE}/api/platforms/youtube/status`, { headers: auth })).json();
    check('الحالة الصادقة = QUOTA_EXCEEDED بعد خطأ حصة حقيقي', statusQuota.state === 'QUOTA_EXCEEDED', JSON.stringify(statusQuota).slice(0, 200));
    check('quotaExceeded معلن في الحالة', statusQuota.quotaExceeded === true);
    mock.state.quotaExceeded = false;

    group('17) تكامل: إشعار PubSubHubbub — توقيع صالح/فاسد + منع التكرار');
    const atom = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom"><entry><yt:videoId>vid_push_1</yt:videoId><yt:channelId>${mock.state.channelId}</yt:channelId><title>فيديو جديد</title><updated>2025-03-01T00:00:00.000Z</updated></entry></feed>`;
    const badSig = await fetch(`${BASE}/api/platforms/youtube/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/atom+xml', [YOUTUBE_PUBSUB_SIGNATURE_HEADER]: 'sha1=deadbeef' }, body: atom });
    check('توقيع فاسد => 401', badSig.status === 401);
    const goodSig = await fetch(`${BASE}/api/platforms/youtube/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/atom+xml', [YOUTUBE_PUBSUB_SIGNATURE_HEADER]: pubsubSignature(atom, PUBSUB_SECRET) }, body: atom });
    check('توقيع صالح => 200 ومقبول', goodSig.status === 200 && (await goodSig.json()).accepted === true);
    const dupSig = await fetch(`${BASE}/api/platforms/youtube/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/atom+xml', [YOUTUBE_PUBSUB_SIGNATURE_HEADER]: pubsubSignature(atom, PUBSUB_SECRET) }, body: atom });
    check('إشعار مكرر => duplicate بلا حدث ثانٍ', (await dupSig.json()).duplicate === true);

    group('18) تكامل: الفصل الحقيقي — لا رد/نشر بلا اتصال موثق');
    const before = app.log();
    check('سجل الخادم بلا أي سرّ Google', !before.includes(GOOGLE_CLIENT_SECRET));

    group('19) تكامل: التجديد التلقائي + reauth عند رفض الرمز');
    mock.state.failChannelsAuth = true;
    const authFail = await fetch(`${BASE}/api/platforms/youtube/channel`, { headers: auth });
    check('رمز مرفوض (401) => 409 reauth_needed', authFail.status === 409, `status=${authFail.status}`);
    const statusReauth = await (await fetch(`${BASE}/api/platforms/youtube/status`, { headers: auth })).json();
    check('الحالة الصادقة = TOKEN_REFRESH_REQUIRED بعد رفض الرمز', statusReauth.state === 'TOKEN_REFRESH_REQUIRED');
    mock.state.failChannelsAuth = false;

    group('19b) تكامل هجومي: أخطاء OAuth الحقيقية لا تُنشئ اتصالاً وهمياً');
    async function oauthStartThenCallback(querySuffix: string): Promise<{ status: number; body: any }> {
      const s = await (await fetch(`${BASE}/api/platforms/youtube/oauth/start`, { headers: auth })).json();
      const stv = new URL(s.authorizationUrl).searchParams.get('state')!;
      const r = await fetch(`${BASE}/api/platforms/youtube/oauth/callback?state=${encodeURIComponent(stv)}${querySuffix}`, { headers: auth });
      let body: any = null; try { body = await r.json(); } catch { /* HTML */ }
      return { status: r.status, body };
    }
    // نعيد الاتصال أولاً (المجموعة 19 وضعته reauth_needed) لنختبر أخطاء API على اتصال قائم.
    {
      const s = await (await fetch(`${BASE}/api/platforms/youtube/oauth/start`, { headers: auth })).json();
      const stv = new URL(s.authorizationUrl).searchParams.get('state')!;
      await fetch(`${BASE}/api/platforms/youtube/oauth/callback?code=RE_CONNECT&state=${encodeURIComponent(stv)}`, { headers: auth });
    }
    const beforeConn = await (await fetch(`${BASE}/api/platforms/youtube/status`, { headers: auth })).json();
    check('أُعيد الاتصال قبل الاختبارات الهجومية', beforeConn.providerVerified === true);
    // code منتهٍ => invalid_grant (فشل المزود => 4xx/5xx بلا اتصال وهمي)
    mock.state.failTokenExchange = true; mock.state.tokenExchangeError = 'invalid_grant';
    const expired = await oauthStartThenCallback('&code=EXPIRED_CODE');
    check('code منتهٍ (invalid_grant) => فشل بلا اتصال', expired.status >= 400, `status=${expired.status}`);
    // secret خاطئ => invalid_client
    mock.state.tokenExchangeError = 'invalid_client';
    const badSecret = await oauthStartThenCallback('&code=CODE');
    check('secret خاطئ (invalid_client) => فشل', badSecret.status >= 400);
    // redirect_uri_mismatch
    mock.state.tokenExchangeError = 'redirect_uri_mismatch';
    const mismatch = await oauthStartThenCallback('&code=CODE');
    check('redirect_uri_mismatch => فشل', mismatch.status >= 400);
    mock.state.failTokenExchange = false;
    // access_denied من المزود (رفض المالك على شاشة الموافقة)
    const denied = await oauthStartThenCallback('&error=access_denied&error_description=user%20denied');
    check('access_denied => فشل بلا اتصال', denied.status >= 400);
    const afterConn = await (await fetch(`${BASE}/api/platforms/youtube/status`, { headers: auth })).json();
    check('لا اتصال وهمي بعد كل محاولات OAuth الفاشلة', afterConn.connected === beforeConn.connected && afterConn.providerVerified === beforeConn.providerVerified);
    check('الرمز المخزّن لم يُستبدل بمحاولة فاشلة', afterConn.channelId === beforeConn.channelId);

    group('19c) تكامل هجومي: أخطاء Data API تُصنَّف ولا تُخترع بيانات');
    // rate limit لحظي (429/rateLimitExceeded) — قابل للإعادة
    mock.state.apiError = { status: 403, reason: 'rateLimitExceeded', message: 'rate' };
    const rate = await fetch(`${BASE}/api/platforms/youtube/channel`, { headers: auth });
    const rateBody = await rate.json();
    check('rate limit => 502 بوسم rate_limit', rate.status === 502 && rateBody.code === 'rate_limit', JSON.stringify(rateBody).slice(0, 160));
    // 403 صلاحية
    mock.state.apiError = { status: 403, reason: 'insufficientPermissions', message: 'forbidden' };
    const forb = await (await fetch(`${BASE}/api/platforms/youtube/channel`, { headers: auth })).json();
    check('403 صلاحية => code=permission_denied', forb.code === 'permission_denied', JSON.stringify(forb).slice(0, 160));
    // 404
    mock.state.apiError = { status: 404, message: 'not found' };
    const nf = await (await fetch(`${BASE}/api/platforms/youtube/video?videoId=missing`, { headers: auth })).json();
    check('404 => code=not_found', nf.code === 'not_found', JSON.stringify(nf).slice(0, 160));
    // 500
    mock.state.apiError = { status: 500, message: 'server error' };
    const srv = await (await fetch(`${BASE}/api/platforms/youtube/channel`, { headers: auth })).json();
    check('500 => code=provider_error (قابل للإعادة)', srv.code === 'provider_error');
    mock.state.apiError = null;

    group('19d) تكامل هجومي: بيانات حقيقية ناقصة لا تُختلق');
    mock.state.videosEmpty = true;
    const noVideos = await (await fetch(`${BASE}/api/platforms/youtube/videos?maxResults=10`, { headers: auth })).json();
    check('قناة بلا فيديوهات => مصفوفة فارغة لا أرقام مخترعة', noVideos.success === true && Array.isArray(noVideos.videos) && noVideos.videos.length === 0);
    mock.state.videosEmpty = false;
    mock.state.commentsEmpty = true;
    const noComments = await (await fetch(`${BASE}/api/platforms/youtube/comments?videoId=vid_aaa111`, { headers: auth })).json();
    check('فيديو بلا تعليقات => مصفوفة فارغة لا تعليقات مخترعة', noComments.success === true && Array.isArray(noComments.comments) && noComments.comments.length === 0);
    mock.state.commentsEmpty = false;
    // فيديو محذوف: video.list بلا عناصر => لا ادعاء
    const gone = await (await fetch(`${BASE}/api/platforms/youtube/video?videoId=deleted_video_id`, { headers: auth })).json();
    check('فيديو محذوف (بلا عنصر) => لا بيانات مخترعة', gone.success === false || gone.video === null || gone.video?.videoId !== 'deleted_video_id');

    group('20) تكامل: الفصل الحقيقي — disconnect يُبطل ويُعلن انقطاعاً');
    const disc = await (await fetch(`${BASE}/api/platforms/youtube/disconnect`, { method: 'POST', headers: auth, body: JSON.stringify({}) })).json();
    check('disconnect ينجح', disc.success === true);
    check('الإبطال أُرسل إلى Google', mock.state.lastRevoke !== null);
    const statusAfter = await (await fetch(`${BASE}/api/platforms/youtube/status`, { headers: auth })).json();
    check('بعد الفصل: غير متصل ولا توكن', statusAfter.connected === false && statusAfter.tokenStored === false);
    check('بعد الفصل الحالة الصادقة = READY_TO_CONNECT', statusAfter.state === 'READY_TO_CONNECT', JSON.stringify(statusAfter).slice(0, 200));

    group('21) تكامل: readiness وhealth يعرضان حالة YouTube بلا سرّ');
    const readiness = await (await fetch(`${BASE}/api/readiness`, { headers: auth })).json();
    check('readiness يعرض youtubeOAuth', Boolean(readiness.youtubeOAuth));
    check('readiness يعرض redirectUri لـYouTube', String(readiness.youtubeOAuth?.redirectUri || '').endsWith('/api/platforms/youtube/oauth/callback'));
    check('readiness لا يسرّب سرّ Google', !JSON.stringify(readiness).includes(GOOGLE_CLIENT_SECRET));
    const health = await (await fetch(`${BASE}/api/health`)).json();
    check('health يعرض youtubeOAuth', Boolean(health.youtubeOAuth));
    check('health يعلن clientSecretConfigured (منطقي فقط)', health.youtubeOAuth?.clientSecretConfigured === true);
    check('health لا يسرّب سرّ Google', !JSON.stringify(health).includes(GOOGLE_CLIENT_SECRET));

    // انحدار: بقية الموصلات الحقيقية لم تُكسر.
    const specs = PLATFORM_SPECS.map((p) => String(p.platform));
    check('الموصلات الحقيقية الأربعة الأخرى باقية', ['telegram', 'facebook', 'instagram', 'tiktok'].every((p) => specs.includes(p) && hasRealConnector(p as any)));
  } finally {
    await stop(app.proc);
    await mock.stop();
  }

  group('22) تكامل: ثبات الحالة عبر إعادة التشغيل (STATE_DIR نفسه)');
  // إعادة الربط ثم إعادة تشغيل العملية بنفس مجلد الحالة: يجب أن تصمد القناة والتوكن.
  {
    const mock2 = await startYouTubeMockServer(YT_PORT + 1, createYouTubeMock());
    let proc2 = startApp(mock2.base);
    try {
      check('الخادم الثاني يقلع', await waitForHealth(), proc2.log().slice(0, 300));
      const auth2 = await login();
      const start2 = await (await fetch(`${BASE}/api/platforms/youtube/oauth/start`, { headers: auth2 })).json();
      const st2 = new URL(start2.authorizationUrl).searchParams.get('state')!;
      await fetch(`${BASE}/api/platforms/youtube/oauth/callback?code=CODE2&state=${encodeURIComponent(st2)}`, { headers: auth2 });
      const before = await (await fetch(`${BASE}/api/platforms/youtube/status`, { headers: auth2 })).json();
      check('مربوط وموثق قبل إعادة التشغيل', before.providerVerified === true && before.channelId === mock2.state.channelId);
      await stop(proc2.proc);
      // إعادة التشغيل بنفس STATE_DIR.
      const app3 = startApp(mock2.base);
      proc2 = app3;
      check('الخادم يقلع بعد إعادة التشغيل', await waitForHealth(), app3.log().slice(0, 300));
      const auth3 = await login();
      const after = await (await fetch(`${BASE}/api/platforms/youtube/status`, { headers: auth3 })).json();
      check('التوكن صمد بعد إعادة التشغيل', after.tokenStored === true);
      check('القناة صمدت بعد إعادة التشغيل', after.channelId === mock2.state.channelId);
      // الرد المُسلَّم سابقاً (المجموعة 15) صمد في نفس مجلد الحالة، فهو دليل مزود
      // حقيقي يجعل السقف الصادق OPERATIONAL (وليس VERIFIED) — وهذا يثبت أن الحالة
      // العليا قابلة للوصول فعلاً ولا تبقى حالة ميتة.
      check('الاتصال الموثق صمد بعد إعادة التشغيل', after.providerVerified === true);
      check('السقف الصادق بعد إعادة التشغيل = OPERATIONAL (دليل رد مسلّم صمد)', after.state === 'OPERATIONAL', JSON.stringify(after).slice(0, 200));
    } finally {
      await stop(proc2.proc);
      await mock2.stop();
    }
  }
}

async function main(): Promise<void> {
  unitTests();
  await integrationTests();
  console.log(`\n${'='.repeat(60)}`);
  if (failures.length) {
    console.log(`فشل ${failures.length} فحصاً من ${passed + failures.length}:`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`نجح كل الفحوص: ${passed} فحصاً.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
