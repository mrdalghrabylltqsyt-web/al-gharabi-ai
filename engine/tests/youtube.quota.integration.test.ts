/**
 * اختبارات تكامل: حارس حصة YouTube + تنبيهات المراقب على خادم حقيقي.
 *
 * يستخدم خادم Google/YouTube وهمي محلي (لا مزود حقيقي ولا حصة). يثبت:
 *  - C1: احتساب وحدات كل عملية تلقائياً عبر المغلّف المركزي، ظهور الحالة في
 *    /api/health و/api/readiness، تنبيه المالك عند بلوغ العتبة (مرة واحدة)، منع
 *    التنفيذ عند استنفاد الحصة، وثبات العدّاد بعد restart.
 *  - C2: تنبيه المالك عند تكرار فشل المراقب (مرة واحدة)، وتنبيه reauth عند رفض
 *    التوكن، ومنع التكرار حتى استعادة الاتصال.
 *  - Regression: الرد/النشر/القراءة يعملون كما هو مع وجود الحارس.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createYouTubeMock, startYouTubeMockServer } from './helpers/youtubeMock';

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
const APP_PORT = 7660 + Math.floor(Math.random() * 30);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const YT_PORT = 7700 + Math.floor(Math.random() * 30);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'youtube-quota-test-secret-not-real';
const GO_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
const GO_CLIENT_SECRET = 'test-google-client-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-youtube-quota-'));
const TOKEN_KEY = randomBytes(32).toString('hex');
const VIDEO_B64 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(256, 7)]).toString('base64');

let currentApp: { proc: ChildProcess; log: () => string } | null = null;

function startApp(ytBase: string, extraEnv: Record<string, string> = {}): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    YOUTUBE_API_BASE: ytBase, YOUTUBE_UPLOAD_BASE: ytBase, YOUTUBE_TOKEN_BASE: `${ytBase}/token`,
    GOOGLE_OAUTH_CLIENT_ID: GO_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: GO_CLIENT_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    // عتبة اختبارية: حصة صغيرة تكفي لرفع واحد (1600) وتبلغ العتبة، ثم تُستنفد.
    YOUTUBE_DAILY_QUOTA: '2000', YOUTUBE_QUOTA_ALERT_THRESHOLD_PERCENT: '50',
    YOUTUBE_QUOTA_PROTECTION: 'true',
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
  const res = await fetch(`${BASE}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}
async function notifications(auth: Record<string, string>): Promise<any[]> {
  const r = await fetch(`${BASE}/api/notifications`, { headers: auth });
  const d = await r.json();
  return d.notifications || [];
}
/** يقرأ التفاصيل الكاملة لحارس الحصة من المسار المحمي بالمالك (M2). */
async function quotaDetails(auth: Record<string, string>): Promise<any> {
  const r = await fetch(`${BASE}/api/agent/youtube/quota`, { headers: auth });
  const d = await r.json();
  return d.quota || {};
}
/** يربط القناة فعلياً عبر OAuth (start → callback). */
async function connect(auth: Record<string, string>): Promise<void> {
  const s = await (await fetch(`${BASE}/api/platforms/youtube/oauth/start`, { headers: auth })).json();
  const st = new URL(s.authorizationUrl).searchParams.get('state') as string;
  await fetch(`${BASE}/api/platforms/youtube/oauth/callback?state=${encodeURIComponent(st)}&code=test-code`);
}

async function run(): Promise<void> {
  const mock = await startYouTubeMockServer(createYouTubeMock(), YT_PORT);
  try {
    currentApp = startApp(mock.base);
    const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
    group('0) الخادم يقلع مع حارس الحصة');
    check('الخادم يقلع', await waitForHealth(), currentApp.log().slice(0, 400));
    Object.assign(auth, await login());

    group('1) C1: /api/health و/api/readiness يعلنان ملخص youtubeQuota العام (بلا سرّ وبلا تفاصيل)');
    const h0 = await (await fetch(`${BASE}/api/health`)).json();
    check('health يحمل youtubeQuota', Boolean(h0.youtubeQuota));
    check('العتبة المعلنة = 50%', h0.youtubeQuota?.alertThresholdPercent === 50);
    // M2: النقطة العامة تُعلن الحالة المجملة فقط — لا limit/usedUnits/byOperation.
    check('الصحة لا تكشف limit التفصيلي (M2)', !('limit' in h0.youtubeQuota));
    check('الصحة لا تكشف usedUnits (M2)', !('usedUnits' in h0.youtubeQuota));
    check('الصحة لا تكشف byOperation (M2)', !('byOperation' in h0.youtubeQuota));
    check('health بلا أي سرّ', !JSON.stringify(h0).includes(GO_CLIENT_SECRET));
    const q0 = await quotaDetails(auth);
    check('المالك يقرأ التفاصيل الكاملة (limit=2000 اختبارية)', q0.limit === 2000);
    check('بداية: 0 وحدات مستهلكة (للمالك)', q0.usedUnits === 0);
    const r0 = await (await fetch(`${BASE}/api/readiness`)).json();
    check('readiness يحمل ملخص youtubeQuota', Boolean(r0.youtubeQuota) && !('usedUnits' in r0.youtubeQuota));
    check('readiness بلا أي سرّ', !JSON.stringify(r0).includes(GO_CLIENT_SECRET));

    group('2) C1: الربط يستهلك وحدات قراءة القناة (channel_read = 1)');
    await connect(auth);
    const h1 = await quotaDetails(auth);
    check('بعد الربط: استُهلكت وحدات (channel_read)', h1.usedUnits >= 1);
    check('channel_read محتسب في التفصيل', h1.byOperation?.channel_read >= 1);

    group('3) C1: الرد يستهلك 50 وحدة (reply)');
    const beforeReply = (await quotaDetails(auth)).usedUnits;
    const reply = await fetch(`${BASE}/api/platforms/youtube/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ commentId: 'cmt_quota_1', text: 'أهلاً بيك، نورتنا', commentText: 'مرحبا' }) });
    const replyBody = await reply.json();
    check('الرد نُفِّذ فعلاً (regression: لم يكسر الحارس الرد)', replyBody.delivered === true || replyBody.success === true, JSON.stringify(replyBody).slice(0, 200));
    const h2 = await quotaDetails(auth);
    check('الرد زاد الحصة بـ50 وحدة', h2.usedUnits - beforeReply === 50, `delta=${h2.usedUnits - beforeReply}`);

    group('4) C1: النشر (upload = 1600) يبلغ العتبة ويُنبّه المالك مرة واحدة');
    const notifsBefore = (await notifications(auth)).filter((n) => n.type === 'youtube_quota_warning').length;
    const pub = await fetch(`${BASE}/api/platforms/youtube/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'جولة في معرض الغرابي للتقسيط', description: 'نظرة عامة على المعرض', approved: true, videoBase64: VIDEO_B64, mimeType: 'video/mp4', filename: 'clip.mp4' }) });
    const pubBody = await pub.json();
    check('النشر نُفِّذ فعلاً (regression)', pubBody.success === true || pubBody.delivered === true || pubBody.status === 'published', JSON.stringify(pubBody).slice(0, 200));
    const h3 = await quotaDetails(auth);
    check('النشر زاد الحصة بـ1600 وحدة', h3.byOperation.upload >= 1600, `upload=${h3.byOperation.upload}`);
    check('العتبة بلغت (thresholdReached)', h3.thresholdReached === true);
    const quotaNotifs = (await notifications(auth)).filter((n) => n.type === 'youtube_quota_warning');
    check('أُرسل تنبيه حصة واحد للمالك', quotaNotifs.length === notifsBefore + 1, `count=${quotaNotifs.length}`);
    check('نص تنبيه الحصة يذكر النسبة والوحدات', quotaNotifs.some((n) => String(n.body || '').includes('%')));
    check('تنبيه الحصة لا يحمل أي سرّ', !JSON.stringify(quotaNotifs).includes(GO_CLIENT_SECRET));

    group('5) C1: طلب آخر عند تجاوز العتبة لا يُكرّر التنبيه (idempotent)');
    const beforeDup = (await notifications(auth)).filter((n) => n.type === 'youtube_quota_warning').length;
    await fetch(`${BASE}/api/platforms/youtube/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ commentId: 'cmt_quota_2', text: 'تدلل', commentText: 'شكراً' }) });
    const afterDup = (await notifications(auth)).filter((n) => n.type === 'youtube_quota_warning').length;
    check('لا تكرار للتنبيه', afterDup === beforeDup, `${beforeDup} → ${afterDup}`);

    group('6) C1: عند استنفاد الحصة يُرفض الطلب بلا شبكة (safe failure)');
    // نستهلك الحصة بقراءات (1 وحدة) حتى تُستنفد تماماً بلا حجب مبكر.
    for (let i = 0; i < 380; i++) {
      const st = (await quotaDetails(auth)).usedUnits;
      if (st >= 2000) break;
      await fetch(`${BASE}/api/platforms/youtube/health`, { headers: auth });
    }
    const hFull = await quotaDetails(auth);
    check('الحالة تُعلن الاستنفاد', hFull.exhausted === true, `used=${hFull.usedUnits}`);
    const callsBefore = mock.state.calls;
    const blocked = await fetch(`${BASE}/api/platforms/youtube/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ commentId: 'cmt_quota_3', text: 'هلا', commentText: 'مرحبا' }) });
    const blockedBody = await blocked.json();
    check('الطلب رُفض برمز quota_exceeded (لا رد مُسلَّم)', blockedBody.code === 'quota_exceeded' && blockedBody.delivered !== true, JSON.stringify(blockedBody).slice(0, 160));
    check('لم يُرسَل أي طلب شبكة للمزود (حارس استباقي)', mock.state.calls === callsBefore, `calls ${callsBefore} → ${mock.state.calls}`);

    group('7) C1: ثبات العدّاد بعد restart (نفس مجلد الحالة)');
    await stop(currentApp.proc);
    currentApp = startApp(mock.base);
    check('الخادم أعاد الإقلاع', await waitForHealth());
    const hRestart = await quotaDetails(auth);
    check('العدّاد صمد بعد restart', hRestart.usedUnits >= 1600, `used=${hRestart.usedUnits}`);
    check('علم التنبيه صمد (لا تكرار بعد restart)', (await notifications(auth)).filter((n) => n.type === 'youtube_quota_warning').length === beforeDup);
  } finally {
    if (currentApp) await stop(currentApp.proc);
    await mock.stop();
  }
}

// ---------------------------------------------------------------------------
// C2 — تنبيهات المراقب (جلسة خادم منفصلة لحالة نظيفة)
// ---------------------------------------------------------------------------
async function runC2(): Promise<void> {
  const c2Dir = mkdtempSync(join(tmpdir(), 'gharabi-youtube-alerts-'));
  const mock = await startYouTubeMockServer(createYouTubeMock(), YT_PORT + 1);
  const appPort = APP_PORT + 1;
  const base = `http://127.0.0.1:${appPort}`;
  const prevStateDir = stateDir;
  let proc: ChildProcess | null = null;
  try {
    let log = '';
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PORT: String(appPort), NODE_ENV: 'production', APP_URL: base, STATE_DIR: c2Dir,
      GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
      YOUTUBE_API_BASE: mock.base, YOUTUBE_UPLOAD_BASE: mock.base, YOUTUBE_TOKEN_BASE: `${mock.base}/token`,
      GOOGLE_OAUTH_CLIENT_ID: GO_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: GO_CLIENT_SECRET,
      PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
      YOUTUBE_WATCHER_ERROR_ALERT_THRESHOLD: '3',
    };
    delete env.GEMINI_API_KEY;
    delete env.DATABASE_URL;
    proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout?.on('data', (d) => (log += String(d)));
    proc.stderr?.on('data', (d) => (log += String(d)));
    const waitHealth = async (): Promise<boolean> => {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        try { if ((await fetch(`${base}/api/health`)).ok) return true; } catch { /* لم يقلع */ }
        await new Promise((r) => setTimeout(r, 400));
      }
      return false;
    };
    check('C2: الخادم يقلع', await waitHealth(), log.slice(0, 300));
    const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
    const login2 = await fetch(`${base}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) });
    Object.assign(auth, { 'Content-Type': 'application/json', Authorization: `Bearer ${(await login2.json()).token}` });
    const notifs = async (): Promise<any[]> => (await (await fetch(`${base}/api/notifications`, { headers: auth })).json()).notifications || [];
    const connect2 = async (): Promise<void> => {
      const s = await (await fetch(`${base}/api/platforms/youtube/oauth/start`, { headers: auth })).json();
      const st = new URL(s.authorizationUrl).searchParams.get('state') as string;
      await fetch(`${base}/api/platforms/youtube/oauth/callback?state=${encodeURIComponent(st)}&code=c2-code`);
    };
    await connect2();

    group('C2-1) تكرار فشل المراقب => تنبيه واحد عند العتبة (لا قبلها، لا تكرار بعدها)');
    mock.state.failVideos = true; // يجعل دورة المراقبة تفشل (playlistItems 403)
    const poll = async (): Promise<any> => (await (await fetch(`${base}/api/agent/youtube/watcher/poll`, { method: 'POST', headers: auth })).json()).result;
    const r1 = await poll();
    check('دورة 1 فشلت', r1.ok === false);
    check('لا تنبيه بعد فشل واحد', (await notifs()).filter((n) => n.type === 'youtube_watcher_failure').length === 0);
    await poll();
    check('لا تنبيه بعد فشلين', (await notifs()).filter((n) => n.type === 'youtube_watcher_failure').length === 0);
    const r3 = await poll();
    check('دورة 3 فشلت', r3.ok === false);
    const failNotifs = (await notifs()).filter((n) => n.type === 'youtube_watcher_failure');
    check('تنبيه واحد عند العتبة (3)', failNotifs.length === 1, `count=${failNotifs.length}`);
    check('نص التنبيه يذكر عدد الدورات', failNotifs.some((n) => String(n.body || '').includes('3')));
    await poll();
    check('لا تكرار للتنبيه بعد فشل رابع', (await notifs()).filter((n) => n.type === 'youtube_watcher_failure').length === 1);

    group('C2-2) أول دورة ناجحة تُصفّر العلم => يمكن التنبيه مجدداً لاحقاً');
    mock.state.failVideos = false;
    const ok = await poll();
    check('دورة ناجحة', ok.ok === true);
    mock.state.failVideos = true;
    await poll(); await poll(); await poll();
    check('تنبيه جديد لسلسلة فشل جديدة', (await notifs()).filter((n) => n.type === 'youtube_watcher_failure').length === 2);
    mock.state.failVideos = false;
    await poll();

    group('C2-3) reauth_needed => تنبيه المالك مرة واحدة حتى استعادة الاتصال');
    // إسقاط صلاحية القراءة => فحص صحة YouTube يُعلن reauth_needed ويُنبّه.
    mock.state.hasReadonlyScope = false;
    const healthFail = await fetch(`${base}/api/platforms/youtube/health`, { headers: auth });
    const healthFailBody = await healthFail.json();
    check('فحص الصحة يُعلن reauth_needed', healthFailBody.status === 'reauth_needed' && healthFailBody.errorKind === 'insufficient_permissions', JSON.stringify(healthFailBody).slice(0, 200));
    const reauthNotifs = (await notifs()).filter((n) => n.type === 'youtube_reauth_needed');
    check('أُرسل تنبيه reauth واحد', reauthNotifs.length === 1, `count=${reauthNotifs.length}`);
    check('نص reauth واضح', reauthNotifs.some((n) => String(n.title || '').includes('إعادة ربط')));
    check('تنبيه reauth لا يحمل سرّاً', !JSON.stringify(reauthNotifs).includes(GO_CLIENT_SECRET));
    // تكرار الفحص لا يُكرّر التنبيه.
    await fetch(`${base}/api/platforms/youtube/health`, { headers: auth });
    check('لا تكرار لتنبيه reauth', (await notifs()).filter((n) => n.type === 'youtube_reauth_needed').length === 1);

    group('C2-4) استعادة الاتصال تُصفّر العلم => تنبيه جديد لو انقطع مجدداً');
    mock.state.hasReadonlyScope = true;
    await connect2(); // إعادة ربط => connected
    const healthOk = await (await fetch(`${base}/api/platforms/youtube/health`, { headers: auth })).json();
    check('الاتصال عاد (healthy)', healthOk.healthy === true);
    mock.state.hasReadonlyScope = false;
    await fetch(`${base}/api/platforms/youtube/health`, { headers: auth });
    check('تنبيه reauth جديد بعد انقطاع ثانٍ', (await notifs()).filter((n) => n.type === 'youtube_reauth_needed').length === 2);
    void prevStateDir;
  } finally {
    if (proc) { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1200)); if (!proc.killed) proc.kill('SIGKILL'); }
    await mock.stop();
    try { rmSync(c2Dir, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }
}

run()
  .then(runC2)
  .then(() => {
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
    console.log('\n============================================================');
    if (failures.length === 0) { console.log(`PASSED: ${passed} youtube quota/alerts integration checks`); process.exit(0); }
    console.log(`FAILED: ${failures.length} of ${passed + failures.length}`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  })
  .catch((err) => { console.error('quota/alerts harness crashed:', err); process.exit(1); });
