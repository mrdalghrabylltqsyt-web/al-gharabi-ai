/**
 * إعادة المحاولة الذكية عند نفاد حصة YouTube — وحدة + تكامل.
 *
 * الجذر: عند `quotaExceeded` كان النشر يُسجَّل **فشلاً نهائياً** رغم أن الحصة تتجدد
 * يومياً. الإصلاح: حالة **PENDING_RETRY** + إعادة إرسال تلقائية فور تجدد الحصة، مع
 * تقليل استهلاك الـAPI وإعطاء الأولوية للنشر.
 *
 * وحدة: تصنيف النفاد، لحظة التجدد (منتصف ليل المحيط الهادئ)، خطة الإعادة، حكم
 * «حان الموعد»، وقرار تخطّي المراقبة لتوفير الحصة.
 * تكامل (خادم حقيقي + خادم Google وهمي): رفع بنفاد حصة => PENDING_RETRY (لا FAILED،
 * بلا معرّف)، ثم إعادة المحاولة اليدوية => PUBLISHED بمعرّف مزيد حقيقي، وحالة تظهر
 * في الواجهة (pendingRetry) وتصريح 401.
 *
 * لا مزود حقيقي ولا حصة ولا سرّ.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createYouTubeMock, startYouTubeMockServer, type YouTubeMockState } from './helpers/youtubeMock';
import {
  isYouTubeQuotaExceeded,
  pacificOffsetMinutes,
  quotaDayKey,
  nextQuotaResetAtMs,
  planQuotaRetry,
  isQuotaRetryDue,
  shouldSkipPollForQuota,
  quotaPendingRetryLabel,
} from '../social/quotaRetry';
import { CONTENT_STATES, CONTENT_STATE_LABELS_AR, canTransitionContent } from '../social/contentPipeline';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

// ─────────────────────────────────────────────────────────────────────────────
// وحدة: منطق إعادة المحاولة الذكية (بلا شبكة)
// ─────────────────────────────────────────────────────────────────────────────

group('1) تصنيف نفاد الحصة (quotaExceeded)');
check('كود quota_exceeded صريح', isYouTubeQuotaExceeded('quota_exceeded'));
check('رسالة Google الخام (quota) تُكتشف', isYouTubeQuotaExceeded('The request cannot be completed because you have exceeded your quota.'));
check('quotaExceeded بحالة أحرف مختلفة', isYouTubeQuotaExceeded('QUOTAEXCEEDED'));
check('فشل عام لا يُصنّف نفاد حصة', !isYouTubeQuotaExceeded('backendError'));
check('رسالة فارغة لا تُصنّف', !isYouTubeQuotaExceeded(''));

group('2) لحظة تجدد الحصة = منتصف ليل المحيط الهادئ (حسابي بلا بيانات IANA)');
// تموز: توقيت صيفي المحيط الهادئ (UTC-7). منتصف ليل PT التالي = 07:00 UTC.
const julyNoonUtc = Date.UTC(2026, 6, 15, 12, 0, 0);
check('توقيت صيفي: فرق -420 دقيقة', pacificOffsetMinutes(julyNoonUtc) === -420);
const resetJuly = nextQuotaResetAtMs(julyNoonUtc);
const resetJulyUtc = new Date(resetJuly);
check('التجدد التالي = 07:00 UTC (+3 دقائق أمان)', resetJulyUtc.getUTCHours() === 7 && resetJulyUtc.getUTCMinutes() === 3);
check('التجدد في المستقبل', resetJuly > julyNoonUtc);
// كانون الثاني: توقيت شتوي المحيط الهادئ (UTC-8). منتصف ليل PT التالي = 08:00 UTC.
const janNoonUtc = Date.UTC(2026, 0, 15, 12, 0, 0);
check('توقيت شتوي: فرق -480 دقيقة', pacificOffsetMinutes(janNoonUtc) === -480);
check('التجدد الشتوي = 08:00 UTC', new Date(nextQuotaResetAtMs(janNoonUtc)).getUTCHours() === 8);
// يوم الحصة بطابع ثابت.
check('طابع يوم الحصة بالصيغة YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(quotaDayKey(julyNoonUtc)));

group('3) خطة الإعادة: «معلّق» لا «فشل»');
const plan = planQuotaRetry(julyNoonUtc);
check('الحالة pending_retry', plan.state === 'pending_retry');
check('الكود QUOTA_PENDING_RETRY', plan.code === 'QUOTA_PENDING_RETRY');
check('وقت الإعادة = التجدد التالي', plan.retryAtMs === nextQuotaResetAtMs(julyNoonUtc));
check('السبب يذكر الإعادة التلقائية', plan.reason.includes('تلقائ') && plan.reason.includes('المحيط الهادئ'));
check('الحارس الداخلي يغيّر النص لا الوقت', planQuotaRetry(julyNoonUtc, { internalGuard: true }).retryAtMs === plan.retryAtMs);

group('4) حكم «حان موعد الإعادة»');
const retryIso = new Date(plan.retryAtMs).toISOString();
check('قبل الموعد: ليس مستحقاً', !isQuotaRetryDue(retryIso, plan.retryAtMs - 60_000));
check('عند الموعد: مستحق', isQuotaRetryDue(retryIso, plan.retryAtMs));
check('بعد الموعد: مستحق', isQuotaRetryDue(retryIso, plan.retryAtMs + 60_000));
check('بلا وقت: ليس مستحقاً', !isQuotaRetryDue(null, Date.now()) && !isQuotaRetryDue('غير صالح', Date.now()));

group('5) تقليل الاستهلاك: تخطّي المراقبة لتوفير الحصة للنشر');
check('الحصة المتبقية أقل من الاحتياطي => تخطّي', shouldSkipPollForQuota(100, 1705));
check('الحصة المتبقية كافية => لا تخطّي', !shouldSkipPollForQuota(5000, 1705));
check('قيم غير صالحة لا تُسبب تخطّياً كاذباً', !shouldSkipPollForQuota(NaN, 10) && !shouldSkipPollForQuota(100, 0));

group('6) حالة PENDING_RETRY في مسار المحتوى');
check('PENDING_RETRY معرّفة', CONTENT_STATES.includes('PENDING_RETRY'));
check('لها مسمّى عربي', Boolean(CONTENT_STATE_LABELS_AR.PENDING_RETRY) && CONTENT_STATE_LABELS_AR.PENDING_RETRY.includes('معلّق'));
check('PENDING_RETRY ليست نهائية (يمكن إعادة المحاولة)', canTransitionContent('PENDING_RETRY', 'PUBLISHED'));
check('FAILED يمكن أن تصير PENDING_RETRY', canTransitionContent('FAILED', 'PENDING_RETRY'));

group('7) رسالة الانتظار للمالك تفصل النجاح عن التعليق');
const label = quotaPendingRetryLabel(['instagram', 'facebook']);
check('تذكر أن يوتيوب معلّق لا فاشل', label.includes('معلّق'));
check('تذكر المنصات التي نجحت', label.includes('instagram') && label.includes('facebook'));

// ─────────────────────────────────────────────────────────────────────────────
// تكامل: خادم حقيقي + خادم Google وهمي
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const APP_PORT = 7940 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const YT_PORT = 7990 + Math.floor(Math.random() * 40);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'youtube-quota-retry-secret-not-real';
const GO_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
const GO_CLIENT_SECRET = 'test-google-client-secret-not-real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-quota-retry-'));
const VIDEO_B64 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(256, 7)]).toString('base64');

let proc: ChildProcess | null = null;
let log = '';
let ytServer: { stop: () => Promise<void> } | null = null;

function startApp(ytBase: string): void {
  log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    YOUTUBE_API_BASE: ytBase, YOUTUBE_UPLOAD_BASE: ytBase, YOUTUBE_TOKEN_BASE: `${ytBase}/token`,
    GOOGLE_OAUTH_CLIENT_ID: GO_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: GO_CLIENT_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    YOUTUBE_OP_RATE_LIMIT: '500',
    YOUTUBE_DAILY_QUOTA: '1000000',
  };
  delete env.GEMINI_API_KEY; delete env.DATABASE_URL;
  proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
}
async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function login(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}
async function connectYouTube(auth: Record<string, string>): Promise<void> {
  const start = await (await fetch(`${BASE}/api/platforms/youtube/oauth/start`, { headers: auth })).json();
  const authUrl = new URL(start.authorizationUrl || 'https://invalid.local');
  const state = authUrl.searchParams.get('state') as string;
  await fetch(`${BASE}/api/platforms/youtube/oauth/callback?state=${encodeURIComponent(state)}&code=test-auth-code`);
}
async function createDraft(auth: Record<string, string>, body: Record<string, unknown>): Promise<any> {
  return (await fetch(`${BASE}/api/platforms/youtube/content/drafts`, { method: 'POST', headers: auth, body: JSON.stringify(body) })).json();
}
async function review(auth: Record<string, string>, id: string, body: Record<string, unknown>): Promise<any> {
  return (await fetch(`${BASE}/api/platforms/youtube/content/queue/${id}/review`, { method: 'POST', headers: auth, body: JSON.stringify(body) })).json();
}
async function getQueueItem(auth: Record<string, string>, id: string): Promise<any> {
  return (await (await fetch(`${BASE}/api/platforms/youtube/content/queue/${id}`, { headers: auth })).json()).item;
}

async function integration(): Promise<void> {
  const mockState = createYouTubeMock();
  const yt = await startYouTubeMockServer(mockState as YouTubeMockState, YT_PORT);
  ytServer = yt;
  startApp(yt.base);
  if (!(await waitForHealth())) { console.log(log.slice(-2000)); throw new Error('الخادم لم يقلع'); }

  const auth = await login();
  await connectYouTube(auth);

  group('8) تكامل: نفاد حصة الرفع => PENDING_RETRY (لا FAILED، بلا معرّف فيديو)');
  mockState.uploadQuotaExceeded = true;
  const draft = await createDraft(auth, { title: 'جولة تجريبية عند نفاد الحصة', description: 'نظرة عامة على المعرض', videoBase64: VIDEO_B64 });
  check('أُنشئت المسودة', Boolean(draft.item?.id), JSON.stringify(draft).slice(0, 200));
  const exec = await review(auth, draft.item.id, { action: 'publish_now' });
  check('الرد ليس فشلاً عاماً (status 200)', exec.success === true && exec.exec?.status === 200, JSON.stringify(exec).slice(0, 250));
  const item = await getQueueItem(auth, draft.item.id);
  check('الحالة PENDING_RETRY (لا FAILED)', item?.state === 'PENDING_RETRY', `state=${item?.state}`);
  check('لا معرّف فيديو مُختلق', !item?.externalVideoId);
  check('الكود QUOTA_PENDING_RETRY', item?.code === 'QUOTA_PENDING_RETRY');
  check('وقت إعادة محاولة معلن (retryAt)', typeof item?.retryAt === 'string' && item.retryAt.length > 0);
  check('سبب الانتظار معلن', typeof item?.retryReason === 'string' && item.retryReason.includes('تلقائ'));
  check('exec يُعلن pendingRetry', exec.exec?.pendingRetry === true, JSON.stringify(exec.exec).slice(0, 200));

  group('9) تكامل: المالك يرى العنصر المعلّق عبر إعادة المحاولة اليدوية');
  const retryRes = await (await fetch(`${BASE}/api/platforms/youtube/content/retry-pending`, { method: 'POST', headers: auth, body: JSON.stringify({}) })).json();
  check('المسار يعيد نتيجة صريحة', retryRes.success === true && Boolean(retryRes.result));
  check('العنصر ما زال معلّقاً (الحصة لم تتجدد بعد)', retryRes.result?.stillPending >= 1, JSON.stringify(retryRes.result));
  check('قائمة المعلّق تعرض العنصر', Array.isArray(retryRes.pending) && retryRes.pending.some((p: any) => p.id === draft.item.id));

  group('10) تكامل: تجدد الحصة => إعادة المحاولة تنجح => PUBLISHED بمعرّف مزوّد');
  mockState.uploadQuotaExceeded = false; // محاكاة تجدد الحصة
  const retryRes2 = await (await fetch(`${BASE}/api/platforms/youtube/content/retry-pending`, { method: 'POST', headers: auth, body: JSON.stringify({}) })).json();
  check('إعادة المحاولة نجحت', retryRes2.result?.succeeded >= 1, JSON.stringify(retryRes2.result));
  const item2 = await getQueueItem(auth, draft.item.id);
  check('الحالة الآن PUBLISHED', item2?.state === 'PUBLISHED', `state=${item2?.state}`);
  check('معرّف فيديو حقيقي من المزود', item2?.externalVideoId === mockState.uploadedVideoId, `ext=${item2?.externalVideoId}`);
  check('انتظار الحصة مُنظَّف بعد النجاح', !item2?.retryAt);

  group('11) تكامل: منع رجوع التسريب — /api/health لا يحمل بيانات عملاء');
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check('health لا يحمل attentionRequired', !JSON.stringify(health).includes('attentionRequired'));
  check('health لا يحمل replyText', !JSON.stringify(health).includes('replyText'));

  group('12) تصريح: إعادة المحاولة اليدوية محمية');
  const noAuth = await fetch(`${BASE}/api/platforms/youtube/content/retry-pending`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  check('بلا جلسة => 401', noAuth.status === 401, String(noAuth.status));
}

async function main(): Promise<void> {
  try {
    await integration();
  } finally {
    try { if (proc) { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1200)); if (!proc.killed) proc.kill('SIGKILL'); } } catch { /* تجاهل */ }
    try { if (ytServer) await ytServer.stop(); } catch { /* تجاهل */ }
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }
  console.log(`\n${'='.repeat(60)}`);
  console.log(`إعادة المحاولة الذكية لنفاد حصة YouTube: نجح ${passed}، فشل ${failures.length}`);
  if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
  console.log('كل الفحوص نجحت.');
}

main().catch((e) => { console.log(log.slice(-2000)); console.error(e); process.exit(1); });
