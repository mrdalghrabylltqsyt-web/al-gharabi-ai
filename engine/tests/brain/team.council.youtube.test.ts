/**
 * اختبار تكاملي لتدفّق YouTube الحقيقي عبر فريق الوكلاء (Batch 6).
 *
 * يُثبت بالدليل عبر HTTP + إعادة تشغيل فعلية على نفس مجلد الحالة:
 *  - حدث YouTube حقيقي (تعليق عبر خادم Google وهمي) → المراقب → **جلسة فريق** حقيقية.
 *  - الجلسة تضمّ مراحل التفكير المتخصّصة (بحث/تحليل/استراتيجية/نقد/قرار) مع أدلة.
 *  - الناقد يشتغل والقرار يحمل حالة صدق وثقة وحدوداً.
 *  - منع التكرار: نفس الحدث لا يُنشئ جلسة ثانية.
 *  - الثبات بعد restart: الجلسة والذاكرة تبقى متاحة.
 *  - لا إجراء خارجي إضافي بسبب الفريق (الرد الوحيد هو رد المراقب المصرّح)، ولا أسرار،
 *    ولا استهلاك Gemini.
 *
 * لا يلمس مزوداً حقيقياً ولا يُنشئ بيانات إنتاج (STATE_DIR مؤقت + خادم وهمي محلي).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createYouTubeMock, startYouTubeMockServer } from '../helpers/youtubeMock';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(t: string) { console.log(`\n▸ ${t}`); }

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const PORT = 7580 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const YT_PORT = 7620 + Math.floor(Math.random() * 40);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const GO_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
const GO_CLIENT_SECRET = 'test-google-client-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-team-yt-'));

function startApp(ytBase: string): ChildProcess {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET: 'team-yt-test-secret-not-real',
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    YOUTUBE_API_BASE: ytBase,
    YOUTUBE_UPLOAD_BASE: ytBase,
    YOUTUBE_TOKEN_BASE: `${ytBase}/token`,
    GOOGLE_OAUTH_CLIENT_ID: GO_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: GO_CLIENT_SECRET,
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  return spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  await new Promise((r) => setTimeout(r, 1500));
  if (!proc.killed) proc.kill('SIGKILL');
}
async function login(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
  });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}
async function connectYouTube(auth: Record<string, string>): Promise<void> {
  const start = await (await fetch(`${BASE}/api/platforms/youtube/oauth/start`, { headers: auth })).json();
  const st = new URL(start.authorizationUrl).searchParams.get('state') as string;
  await fetch(`${BASE}/api/platforms/youtube/oauth/callback?state=${encodeURIComponent(st)}&code=test-auth-code`);
}

(async () => {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  const mock = await startYouTubeMockServer(createYouTubeMock(), YT_PORT);
  let proc = startApp(mock.base);
  let exitCode = 0;
  try {
    if (!(await waitForHealth())) throw new Error('الخادم لم يقلع.');
    const auth = await login();

    group('real YouTube event -> team session');
    await connectYouTube(auth);
    await fetch(`${BASE}/api/platforms/youtube/delegation`, { method: 'POST', headers: auth, body: JSON.stringify({ actions: ['reply'] }) });
    mock.state.comments = [
      { id: 'cmt_team_1', threadId: 'thr_t1', videoId: 'vid_alpha', author: 'مصطفى', text: 'كم سعر الغسالة بالتقسيط؟', publishedAt: '2026-10-02T09:00:00Z', likeCount: 0 },
      { id: 'cmt_team_2', threadId: 'thr_t2', videoId: 'vid_alpha', author: 'هدى', text: 'عاشت إيدكم، خدمة ممتازة', publishedAt: '2026-10-02T09:05:00Z', likeCount: 0 },
    ];
    await fetch(`${BASE}/api/agent/youtube/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, autoReply: true, paused: false, humanReviewMode: false }) });
    mock.state.lastInsertPath = null;
    const poll = await (await fetch(`${BASE}/api/agent/youtube/watcher/poll`, { method: 'POST', headers: auth })).json();
    check('المراقب قرأ تعليقات حقيقية', (poll.watcher?.detected ?? 0) >= 1 || (poll.result?.newDetected ?? 0) >= 1, JSON.stringify(poll.watcher || poll.result));

    // جلسة فريق واحدة على الأقل من حدث YouTube حقيقي.
    const teamList = await (await fetch(`${BASE}/api/agent/team`, { headers: auth })).json();
    check('جلسات الفريق أُنشئت من الحدث', teamList.count >= 1, `count=${teamList.count}`);
    const ytSessions = (teamList.sessions || []).filter((s: any) => s.trigger === 'youtube_event' && s.source === 'youtube');
    check('الجلسة مشغّلة بحدث YouTube', ytSessions.length >= 1);

    const sessionId = ytSessions[0].teamSessionId;
    const one = await (await fetch(`${BASE}/api/agent/team/${sessionId}`, { headers: auth })).json();
    check('الجلسة تضمّ الوكلاء المتخصّصين', ['research', 'analysis', 'strategy', 'critic', 'decision'].every((a) => one.session.participants.includes(a)), JSON.stringify(one.session.participants));
    check('البحث جمع أدلة حقيقية', one.session.observations.some((o: any) => o.agentId === 'research' && o.truthState === 'FACT' && o.evidence.length > 0));
    check('التحليل اشتقّ من الأدلة', one.session.analyses.length > 0);
    check('الناقد اشتغل', one.session.criticRan === true);
    check('القرار مُتحقَّق عند نجاح الناقد', one.session.decision?.verified === true);
    check('القرار يحمل حالة صدق', typeof one.session.truthState === 'string' && one.session.truthState.length > 0);
    check('القرار يحمل ثقة', ['low', 'medium', 'high'].includes(one.session.confidence));
    check('القرار يحمل حدوداً', Array.isArray(one.session.decision?.limitations) && one.session.decision.limitations.length > 0);
    check('الجلسة مكتوبة في الذاكرة', one.session.memoryWritten === true);

    group('deduplication');
    const countBefore = teamList.count;
    await fetch(`${BASE}/api/agent/youtube/watcher/poll`, { method: 'POST', headers: auth });
    const teamList2 = await (await fetch(`${BASE}/api/agent/team`, { headers: auth })).json();
    check('إعادة الفحص لا تُنشئ جلسات مكررة', teamList2.count === countBefore, `${teamList2.count} vs ${countBefore}`);

    group('no extra external action caused by the team');
    // الفريق لا ينفّذ: القرار مقترح ولا يُنشئ رداً/نشراً إضافياً بذاته.
    check('القرار لا يدّعي تنفيذاً', !/تم النشر|تم الإرسال|نُشر|أُرسل/.test(one.session.decision?.statement || ''));
    check('الحدود تذكر عدم التنفيذ', (one.session.decision?.limitations || []).some((l: string) => l.includes('لا يُنفَّذ') || l.includes('خارجي')));

    group('no secrets / no Gemini');
    const h = await (await fetch(`${BASE}/api/health`)).json();
    check('agentTeam معلن في الصحة', h.agentTeam?.enabled === true);
    check('agentTeam لا ينفّذ خارجياً', h.agentTeam?.executesExternalActions === false);
    check('agentTeam لا يستهلك AI', h.agentTeam?.geminiUsedOnSessions === false);
    const serialized = JSON.stringify(one);
    check('لا تسريب أسرار في الجلسة', !/access_token|refresh_token|client_secret|GEMINI_API_KEY|PRIVATE KEY/i.test(serialized));
    const aiCalls = h.geminiUsage?.providerCallsToday ?? h.geminiUsage?.providerCalls ?? 0;
    check('لا استهلاك Gemini', aiCalls === 0, `calls=${aiCalls}`);

    group('restart persistence (real restart, same STATE_DIR)');
    await stop(proc);
    proc = startApp(mock.base);
    if (!(await waitForHealth())) throw new Error('الخادم لم يعد للعمل بعد إعادة التشغيل.');
    const auth2 = await login();
    const afterRestart = await (await fetch(`${BASE}/api/agent/team`, { headers: auth2 })).json();
    check('الجلسات تصمد بعد restart', afterRestart.count >= 1);
    const oneAfter = await (await fetch(`${BASE}/api/agent/team/${sessionId}`, { headers: auth2 })).json();
    check('تفاصيل الجلسة تصمد', oneAfter.session?.decision?.statement === one.session.decision.statement);
    check('ذاكرة الجلسة تصمد', oneAfter.session?.memoryWritten === true);
    const rAfter = await (await fetch(`${BASE}/api/readiness`, { headers: auth2 })).json();
    check('ذاكرة العقل تصمد (memoryHealth.total)', (rAfter.brain?.memoryHealth?.total ?? 0) >= 1);
    check('ذاكرة القرار (decision) تصمد', ((rAfter.brain?.memoryHealth?.byKind?.decision) ?? 0) >= 1);

  } catch (err: any) {
    console.error(`\nخطأ غير متوقّع: ${err?.message || err}`);
    exitCode = 1;
  } finally {
    await stop(proc);
    await mock.stop().catch(() => { /* تنظيف */ });
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تنظيف */ }
  }

  console.log(`\n=== فريق الوكلاء — تدفّق YouTube الحقيقي ===`);
  console.log(`passed: ${passed}, failed: ${failures.length}`);
  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  if (exitCode !== 0) process.exit(exitCode);
  console.log('كل الفحوص نجحت.');
})();
