/**
 * اختبار تكاملي لوقت تشغيل العقل 24/7 (Batch 5) على خادم حقيقي + خادم YouTube وهمي.
 *
 * يُثبت بالدليل عبر HTTP + إعادة تشغيل فعلية على نفس مجلد الحالة:
 *  - وقت التشغيل مفعّل، الجدولة نشطة، والحالة تُعلن في /api/health و/api/readiness.
 *  - المسارات محمية (401 بلا جلسة)؛ تشغيل الدورة للمالك فقط.
 *  - رد YouTube حقيقي (عبر مراقب حقيقي + خادم Google وهمي) → حدث تعلّم حقيقي →
 *    دورة العقل → حفظ ذاكرة دائمة → memoryHealth.total > 0.
 *  - الدورة التالية لا تُكرّر (منع تكرار الذاكرة عبر معرّفات الأحداث).
 *  - الذاكرة تصمد بعد restart فعلي (نفس STATE_DIR) بلا تكرار.
 *  - لا أسرار، ولا استهلاك Gemini، ولا إجراء خارجي من وقت التشغيل.
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
const PORT = 7480 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const YT_PORT = 7540 + Math.floor(Math.random() * 40);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const GO_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
const GO_CLIENT_SECRET = 'test-google-client-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-brain-runtime-'));

function startApp(ytBase: string): ChildProcess {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET: 'brain-runtime-test-secret-not-real',
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    YOUTUBE_API_BASE: ytBase,
    YOUTUBE_UPLOAD_BASE: ytBase,
    YOUTUBE_TOKEN_BASE: `${ytBase}/token`,
    GOOGLE_OAUTH_CLIENT_ID: GO_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: GO_CLIENT_SECRET,
    // إيقاع قصير للاختبار فقط — لا يمسّ الإنتاج.
    BRAIN_RUNTIME_INTERVAL_MS: '60000',
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
async function health(): Promise<any> { return (await fetch(`${BASE}/api/health`)).json(); }
async function readiness(): Promise<any> { return (await fetch(`${BASE}/api/readiness`)).json(); }
async function runCycle(auth: Record<string, string>): Promise<any> {
  return (await fetch(`${BASE}/api/agent/brain/runtime/run`, { method: 'POST', headers: auth })).json();
}
/** يربط YouTube فعلياً عبر خادم Google وهمي (start → callback → إثبات قناة). */
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

    // 1) الحماية.
    group('auth protection');
    check('GET runtime بلا جلسة => 401', (await fetch(`${BASE}/api/agent/brain/runtime`)).status === 401);
    check('POST runtime/run بلا جلسة => 401', (await fetch(`${BASE}/api/agent/brain/runtime/run`, { method: 'POST' })).status === 401);

    // 2) الظهور في الصحة/الجاهزية.
    group('runtime visible in health/readiness');
    const h0 = await health();
    check('health.brainRuntime موجود', Boolean(h0.brainRuntime));
    check('runtime.enabled=true', h0.brainRuntime?.enabled === true);
    check('runtime.scheduled=true', h0.brainRuntime?.scheduled === true);
    check('runtime.executesExternalActions=false', h0.brainRuntime?.executesExternalActions === false);
    check('runtime.geminiUsedOnCycles=false', h0.brainRuntime?.geminiUsedOnCycles === false);
    const r0 = await readiness();
    check('readiness.brain.runtime موجود', Boolean(r0.brain?.runtime));
    check('readiness.brain.runtime.enabled=true', r0.brain?.runtime?.enabled === true);

    // 3) لا بيانات => NO_NEW_DATA (بلا اختراع).
    group('manual cycle with no data => NO_NEW_DATA');
    const run0 = await runCycle(auth);
    check('run0 success', run0.success === true);
    check('run0 NO_NEW_DATA', run0.result?.status === 'NO_NEW_DATA', JSON.stringify(run0.result));
    check('memoryHealth.total=0 قبل البيانات', (r0.brain?.memoryHealth?.total ?? -1) === 0);

    // 4) ربط YouTube + تفويض + رد حقيقي عبر المراقب => حدث تعلّم حقيقي.
    group('real YouTube reply via watcher -> real learning event');
    await connectYouTube(auth);
    const plats = await (await fetch(`${BASE}/api/platforms/capabilities`, { headers: auth })).json();
    const ytConn = (plats.platforms || []).find((p: any) => p.id === 'youtube')?.connection || {};
    check('YouTube متصل وموثق', ytConn.status === 'connected' && ytConn.providerVerified === true);
    await fetch(`${BASE}/api/platforms/youtube/delegation`, { method: 'POST', headers: auth, body: JSON.stringify({ actions: ['reply'] }) });
    mock.state.comments = [{ id: 'cmt_rt_praise', threadId: 'thr_rt', videoId: 'vid_alpha', author: 'حسين', text: 'عاشت إيدكم، خدمة ممتازة', publishedAt: '2026-10-02T09:00:00Z', likeCount: 0 }];
    await fetch(`${BASE}/api/agent/youtube/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, autoReply: true, paused: false, humanReviewMode: false }) });
    mock.state.lastInsertPath = null;
    const poll = await (await fetch(`${BASE}/api/agent/youtube/watcher/poll`, { method: 'POST', headers: auth })).json();
    check('المراقب: comments.insert استُدعي فعلاً', (mock.state.lastInsertPath || '').includes('/youtube/v3/comments'));
    check('المراقب: رد مُسلَّم بمعرّف من المزوّد', Boolean(poll.watcher?.lastReply?.externalReplyId), JSON.stringify(poll.watcher?.lastReply));

    // 5) دورة العقل تحفظ الذاكرة من الرد الحقيقي.
    group('brain cycle persists memory from real reply');
    const run1 = await runCycle(auth);
    check('run1 SUCCESS', run1.result?.status === 'SUCCESS', JSON.stringify(run1.result));
    check('run1 حفظ سجلات ذاكرة', (run1.result?.newMemoryRecords ?? 0) > 0, JSON.stringify(run1.result));
    const rAfter = await readiness();
    const memTotal = rAfter.brain?.memoryHealth?.total ?? 0;
    check('memoryHealth.total > 0 بعد الدورة', memTotal > 0, String(memTotal));
    check('runtime.lastMemoryTotal صادق', rAfter.brain?.runtime?.lastMemoryTotal === memTotal, `${rAfter.brain?.runtime?.lastMemoryTotal} vs ${memTotal}`);
    check('runtime.persistenceSuccessCount >= 1', (rAfter.brain?.runtime?.persistenceSuccessCount ?? 0) >= 1);

    // 6) الدورة التالية لا تُكرّر (منع تكرار الذاكرة).
    group('no duplicate memory on next cycle');
    const run2 = await runCycle(auth);
    check('run2 NO_NEW_DATA', run2.result?.status === 'NO_NEW_DATA', JSON.stringify(run2.result));
    check('run2 لا سجلات جديدة', (run2.result?.newMemoryRecords ?? -1) === 0);
    check('run2 الإجمالي ثابت', run2.result?.memoryTotal === memTotal, `${run2.result?.memoryTotal} vs ${memTotal}`);

    // 7) الثبات بعد restart (نفس STATE_DIR): الذاكرة + حالة وقت التشغيل تبقى.
    group('durability across real restart');
    const beforeRestart = await health();
    const cycleCountBefore = beforeRestart.brainRuntime?.cycleCount ?? 0;
    await stop(proc);
    proc = startApp(mock.base);
    if (!(await waitForHealth())) throw new Error('الخادم لم يعد للعمل بعد restart.');
    const afterRestart = await health();
    const rRestart = await readiness();
    check('cycleCount محفوظ بعد restart', (afterRestart.brainRuntime?.cycleCount ?? 0) >= cycleCountBefore, `${afterRestart.brainRuntime?.cycleCount} >= ${cycleCountBefore}`);
    check('lock محفوظ كـnull (لا جمود)', afterRestart.brainRuntime?.lockHeld === false);
    check('memoryHealth.total محفوظ بعد restart', (rRestart.brain?.memoryHealth?.total ?? 0) === memTotal, `${rRestart.brain?.memoryHealth?.total} vs ${memTotal}`);
    // دورة بعد restart لا تُكرّر الذاكرة (الأحداث ذات المعرّفات نفسها).
    const auth2 = await login();
    const run3 = await runCycle(auth2);
    check('run3 بعد restart NO_NEW_DATA (لا تكرار)', run3.result?.status === 'NO_NEW_DATA', JSON.stringify(run3.result));
    check('run3 الإجمالي ثابت', run3.result?.memoryTotal === memTotal, `${run3.result?.memoryTotal} vs ${memTotal}`);

    // 8) لا أسرار في كتلة وقت التشغيل.
    group('no secrets');
    const blob = JSON.stringify(afterRestart.brainRuntime);
    check('لا token/secret في الحالة', !/token|secret|api[_-]?key/i.test(blob), blob.slice(0, 200));
    check('لا سرّ Google في الصحة', !JSON.stringify(afterRestart).includes(GO_CLIENT_SECRET));

  } catch (err: any) {
    exitCode = 1;
    console.error('TEST ERROR:', err?.message || err);
  } finally {
    await stop(proc);
    try { await mock.stop(); } catch { /* تجاهل */ }
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.error('FAILURES:\n' + failures.join('\n')); exitCode = 1; }
  process.exit(exitCode);
})();

