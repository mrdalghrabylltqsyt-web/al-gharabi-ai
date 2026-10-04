/**
 * اختبار تكاملي للطبقة الإدراكية (Batch 7) عبر HTTP على خادم حقيقي.
 *
 * يُثبت بالدليل:
 *  - مسارات الإدراك محمية بـ401 بلا جلسة، وللمالك فقط.
 *  - كتلة `cognition` في /api/health و/api/readiness صادقة (بلا سرّ).
 *  - حدث YouTube حقيقي (خادم Google وهمي) → المراقب → جلسة فريق → **دورة إدراكية**
 *    كاملة (11 مرحلة) تُحفظ وتظهر في التقارير.
 *  - الدورة تحمل: هدفاً حالياً، إجراءً تالياً، حالة تفكير منظّمة (بلا تفكير داخلي خاص)،
 *    وذاكرة مستدعاة.
 *  - منع التكرار: نفس الحدث لا يُنشئ دورة ثانية.
 *  - لا تنفيذ خارجي ولا أسرار ولا استهلاك Gemini.
 *
 * لا يلمس مزوداً حقيقياً ولا يُنشئ بيانات إنتاج (STATE_DIR مؤقت + خادم وهمي محلي).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
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
const PORT = 6990 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const YT_PORT = 7040 + Math.floor(Math.random() * 40);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const GO_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
const GO_CLIENT_SECRET = 'test-google-client-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-cognition-'));

function startApp(ytBase: string): ChildProcess {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET: 'cognition-test-secret-not-real',
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
  const proc = startApp(mock.base);
  try {
    check('الخادم يقلع', await waitForHealth());
    const auth = await login();

    group('1) التصريح — مسارات الإدراك محمية');
    for (const path of ['/api/agent/brain/cognition', '/api/agent/brain/cognition/reports']) {
      const noAuth = await fetch(`${BASE}${path}`);
      check(`بلا جلسة ${path} => 401`, noAuth.status === 401);
    }
    check('تقرير غير موجود => 404', (await fetch(`${BASE}/api/agent/brain/cognition/reports/nope`, { headers: auth })).status === 404);
    const post = await fetch(`${BASE}/api/agent/brain/cognition`, { method: 'POST', headers: auth });
    check('POST على مسار الإدراك => 404/405 (لا كتابة)', post.status === 404 || post.status === 405, `status=${post.status}`);

    group('2) كتلة cognition في health/readiness — صادقة بلا سرّ');
    const health = await (await fetch(`${BASE}/api/health`)).json();
    check('health.cognition موجود', Boolean(health.cognition));
    check('لا تنفيذ خارجي معلن', health.cognition?.executesExternalActions === false);
    check('لا تفكير داخلي خاص معلن', health.cognition?.storesPrivateChainOfThought === false);
    check('الدورة الإدراكية معلنة', typeof health.cognition?.cognitiveLoop === 'string' && health.cognition.cognitiveLoop.includes('PERCEIVE'));
    check('حلقة النتيجة معلنة كمغلقة', health.cognition?.outcomeFeedbackWired === true);
    check('جسر التعلّم معلن', typeof health.cognition?.learningBridge === 'string' && health.cognition.learningBridge.includes('LESSON') && health.cognition.learningBridge.includes('MEMORY'));
    check('حلقة التعلّم معلنة في health (FOLLOW-UP)', health.cognition?.learningBridge?.includes('FOLLOW-UP'));
    check('health.cognition.learningLoop يعرض أرقاماً صادقة', health.cognition?.learningLoop && typeof health.cognition.learningLoop.actions === 'number' && typeof health.cognition.learningLoop.memory === 'number');
    check('الذاكرة العاملة معلنة', Boolean(health.cognition?.workingMemory) && typeof health.cognition.workingMemory.total === 'number');
    check('health.cognition بلا سرّ', !/access_token|refresh_token|client_secret|api[_-]?key/i.test(JSON.stringify(health.cognition)));
    const readiness = await (await fetch(`${BASE}/api/readiness`)).json();
    check('readiness.brain.cognition موجود', Boolean(readiness.brain?.cognition));
    check('readiness لا تنفيذ خارجي', readiness.brain?.cognition?.executesExternalActions === false);

    group('3) مسار الإدراك (owner)');
    const cog = await (await fetch(`${BASE}/api/agent/brain/cognition`, { headers: auth })).json();
    check('cognition success', cog.success === true);
    check('workingMemory معلنة', typeof cog.workingMemory?.total === 'number');
    check('labels phases موجودة', cog.labels?.phases?.PERCEIVE);
    check('labels loop موجود', typeof cog.labels?.loop === 'string');
    check('لا سرّ في cognition', !/access_token|refresh_token|client_secret|api[_-]?key/i.test(JSON.stringify(cog)));
    // حلقة التعلّم (Batch 7): مسار للمالك، أرقام صادقة، بلا سرّ.
    const loopAnon = await fetch(`${BASE}/api/agent/brain/cognition/learning-loop`);
    check('learning-loop بلا جلسة => 401', loopAnon.status === 401);
    const loop = await (await fetch(`${BASE}/api/agent/brain/cognition/learning-loop`, { headers: auth })).json();
    check('learning-loop success', loop.success === true && Array.isArray(loop.learningLoop?.stages));
    check('learning-loop يشمل 6 مراحل', (loop.learningLoop?.stages || []).length === 6, JSON.stringify(loop.learningLoop?.stages?.map((s: any) => s.stage)));
    check('learning-loop بلا سرّ', !/access_token|refresh_token|client_secret|api[_-]?key/i.test(JSON.stringify(loop)));

    group('4) حدث YouTube حقيقي => دورة إدراكية كاملة');
    await connectYouTube(auth);
    mock.state.comments = [
      { id: 'cmt_cog_1', threadId: 'thr_c1', videoId: 'vid_alpha', author: 'مصطفى', text: 'كم سعر الغسالة بالتقسيط؟', publishedAt: '2026-10-04T09:00:00Z', likeCount: 0 },
      { id: 'cmt_cog_2', threadId: 'thr_c2', videoId: 'vid_alpha', author: 'هدى', text: 'عاشت إيدكم، خدمة ممتازة', publishedAt: '2026-10-04T09:05:00Z', likeCount: 0 },
    ];
    await fetch(`${BASE}/api/agent/youtube/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, autoReply: false, paused: false, humanReviewMode: false }) });
    const poll = await (await fetch(`${BASE}/api/agent/youtube/watcher/poll`, { method: 'POST', headers: auth })).json();
    check('المراقب قرأ تعليقات حقيقية', (poll.result?.newDetected ?? poll.watcher?.detected ?? 0) >= 1, JSON.stringify(poll.result || poll.watcher));

    const reports = await (await fetch(`${BASE}/api/agent/brain/cognition/reports`, { headers: auth })).json();
    check('تولّدت دورات إدراكية من الحدث', reports.count >= 1, `count=${reports.count}`);
    const first = (reports.reports || [])[0];
    check('الدورة تشمل 11 مرحلة', first?.phases === 11, `phases=${first?.phases}`);
    check('الدورة تحمل هدفاً حالياً', typeof first?.currentGoal === 'string' && first.currentGoal.length > 0);
    check('الدورة تحمل إجراءً تالياً', typeof first?.nextAction === 'string' && first.nextAction.length > 0);
    check('الدورة تحمل حالة القرار', typeof first?.decisionStatus === 'string' && first.decisionStatus.length > 0);

    const full = await (await fetch(`${BASE}/api/agent/brain/cognition/reports/${first.cycleId}`, { headers: auth })).json();
    check('التقرير الكامل متاح', full.success === true && Boolean(full.report?.reasoning));
    check('حالة التفكير لا تخزّن تفكيراً داخلياً', full.report?.reasoning?.storesPrivateChainOfThought === false);
    check('حالة التفكير تحمل هدفاً وأدلة', typeof full.report?.reasoning?.objective === 'string' && Array.isArray(full.report?.reasoning?.evidence));
    check('الدورة تحمل سياقاً (WHAT/WHO/WHERE)', Boolean(full.report?.context?.what) && Boolean(full.report?.context?.where?.platform));
    check('الدورة توجّه المجلس', full.report?.council?.agentCount >= 2);
    check('الدورة تبني خطة محكومة', Array.isArray(full.report?.planSteps) && full.report.planSteps.length > 0);
    check('لا خطوة خارجية مسموحة بلا سبب', (full.report?.planSteps || []).filter((s: any) => s.external).every((s: any) => Boolean(s.reason)));
    check('التقرير بلا سرّ', !/access_token|refresh_token|client_secret|api[_-]?key/i.test(JSON.stringify(full)));

    group('5) منع التكرار — نفس الحدث لا يُنشئ دورة ثانية');
    const countBefore = reports.count;
    await fetch(`${BASE}/api/agent/youtube/watcher/poll`, { method: 'POST', headers: auth });
    const reports2 = await (await fetch(`${BASE}/api/agent/brain/cognition/reports`, { headers: auth })).json();
    check('إعادة الفحص لا تُنشئ دورات مكررة', reports2.count === countBefore, `${reports2.count} vs ${countBefore}`);

    group('6) الصحة تعكس آخر دورة');
    const health2 = await (await fetch(`${BASE}/api/health`)).json();
    check('health.cognition.reports يعكس العدد', (health2.cognition?.reports ?? -1) >= countBefore);
    // الخصوصية: /api/health عامة بلا مصادقة، فلا تُعلن حقولاً نصّية حرة قد تحمل نص
    // تعليق/هدفاً مشتقاً منه. التفاصيل النصّية للمالك فقط عبر المسار المحمي.
    check('health العامة لا تُعلن الهدف النصّي (خصوصية)', !('lastGoal' in (health2.cognition || {})) && !('lastObjective' in (health2.cognition || {})) && !('lastNextAction' in (health2.cognition || {})));
    const reportsOwner = await (await fetch(`${BASE}/api/agent/brain/cognition/reports`, { headers: auth })).json();
    check('التفاصيل النصّية متاحة للمالك عبر المسار المحمي', typeof reportsOwner.reports?.[0]?.currentGoal === 'string');
  } finally {
    await stop(proc);
    await mock.stop();
  }

  if (failures.length) {
    console.error(`FAILED: ${failures.length}\n` + failures.join('\n'));
    process.exit(1);
  }
  console.log(`PASSED: ${passed} cognition integration (Batch 7) checks`);
})();
