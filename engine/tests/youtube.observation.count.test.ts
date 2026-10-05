/**
 * اختبار تكاملي (خادم حقيقي + خادم Google/YouTube وهمي محلي): عيّنة التعلّم
 * من العدد الحقيقي للرصدات لا من قيمة ثابتة.
 *
 * يثبت أن بوابة «3 رصدات مستقلة» تتفاعل فعلاً مع العدد المرصود:
 *   - رصدة واحدة (رد مُسلَّم واحد) => لا درس دائم (لا ترقية بلا عيّنة كافية).
 *   - رصدتان => لا درس دائم.
 *   - ثلاث رصدات => يُرقّى الدرس ويُحفظ في الذاكرة (درس `lesson:`).
 *
 * قبل الإصلاح كانت العيّنة ثابتة 3 في كل النداءات، فيُرقّى الدرس من أول رصدة —
 * وهذا ما يفشل عليه هذا الاختبار. بلا مزود حقيقي وبلا أي سرّ، ولا يمسّ أي منصة أخرى.
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
const APP_PORT = 7660 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const YT_PORT = 7720 + Math.floor(Math.random() * 40);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'youtube-observation-count-secret-not-real';
const GO_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
const GO_CLIENT_SECRET = 'test-google-client-secret-not-real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-obs-count-'));

let proc: ChildProcess | null = null;
let log = '';

function startApp(ytBase: string): void {
  log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    YOUTUBE_API_BASE: ytBase, YOUTUBE_UPLOAD_BASE: ytBase, YOUTUBE_TOKEN_BASE: `${ytBase}/token`,
    GOOGLE_OAUTH_CLIENT_ID: GO_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: GO_CLIENT_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    // حصة/معدّل كبيران: الاختبار عن عيّنة التعلّم لا عن الحارس.
    YOUTUBE_OP_RATE_LIMIT: '100', YOUTUBE_DAILY_QUOTA: '1000000',
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
async function lessonDerived(auth: Record<string, string>): Promise<number> {
  const res = await (await fetch(`${BASE}/api/agent/brain/cognition/learning-loop`, { headers: auth })).json();
  return Number(res?.learningLoop?.memory?.lessonDerived || 0);
}

async function main(): Promise<void> {
  const mock = await startYouTubeMockServer(createYouTubeMock(), YT_PORT);
  try {
    // تعليقات مدح حقيقية بنصوص مختلفة => نصوص ردود مختلفة (لا يصطدم حارس تكرار النص).
    const C1 = { id: 'cmt_obs_1', threadId: 'thr_o1', videoId: 'vid_alpha', author: 'كرار', text: 'عاشت إيدكم، خدمة ممتازة', publishedAt: '2026-10-02T09:00:00Z', likeCount: 0 };
    const C2 = { id: 'cmt_obs_2', threadId: 'thr_o2', videoId: 'vid_alpha', author: 'حسين', text: 'ما شاء الله عليكم تبارك الله', publishedAt: '2026-10-02T09:05:00Z', likeCount: 0 };
    const C3 = { id: 'cmt_obs_3', threadId: 'thr_o3', videoId: 'vid_alpha', author: 'زينب', text: 'تسلمون على الطرح الجميل', publishedAt: '2026-10-02T09:10:00Z', likeCount: 0 };

    startApp(mock.base);
    if (!(await waitForHealth())) { console.log(log.slice(-2000)); throw new Error('الخادم لم يقلع'); }
    const auth = await login();
    await connectYouTube(auth);
    await fetch(`${BASE}/api/platforms/youtube/delegation`, { method: 'POST', headers: auth, body: JSON.stringify({ actions: ['reply'] }) });
    await fetch(`${BASE}/api/agent/youtube/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, autoReply: true, paused: false, humanReviewMode: false }) });

    group('عيّنة التعلّم = العدد الحقيقي المرصود (لا قيمة ثابتة)');
    // رصدة 1: رد مُسلَّم واحد => لا درس دائم.
    mock.state.comments = [C1];
    const p1 = await (await fetch(`${BASE}/api/agent/youtube/watcher/poll`, { method: 'POST', headers: auth })).json();
    check('رصدة 1: رد مُسلَّم فعلياً بمعرّف مزوّد', Boolean(p1.watcher?.lastReply?.externalReplyId), JSON.stringify(p1.watcher?.lastReply));
    check('رصدة 1: لا درس دائم (العيّنة الحقيقية = 1 < 3)', (await lessonDerived(auth)) === 0, `lessonDerived=${await lessonDerived(auth)}`);

    // رصدة 2: رد مُسلَّم ثانٍ => لا درس دائم بعد.
    mock.state.comments = [C2];
    const p2 = await (await fetch(`${BASE}/api/agent/youtube/watcher/poll`, { method: 'POST', headers: auth })).json();
    check('رصدة 2: رد مُسلَّم فعلياً', Boolean(p2.watcher?.lastReply?.externalReplyId), JSON.stringify(p2.watcher?.lastReply));
    check('رصدة 2: لا درس دائم (العيّنة الحقيقية = 2 < 3)', (await lessonDerived(auth)) === 0, `lessonDerived=${await lessonDerived(auth)}`);

    // رصدة 3: رد مُسلَّم ثالث => تُرقّى العيّنة ويُحفظ الدرس.
    mock.state.comments = [C3];
    const p3 = await (await fetch(`${BASE}/api/agent/youtube/watcher/poll`, { method: 'POST', headers: auth })).json();
    check('رصدة 3: رد مُسلَّم فعلياً', Boolean(p3.watcher?.lastReply?.externalReplyId), JSON.stringify(p3.watcher?.lastReply));
    const derived3 = await lessonDerived(auth);
    check('رصدة 3: يُرقّى الدرس ويُحفظ (العيّنة الحقيقية = 3 >= 3)', derived3 >= 1, `lessonDerived=${derived3}`);

    group('الاتساق: عدّاد الردود الحقيقي يطابق الرصدات');
    // العدّادات التفصيلية على المسار المحمي بالمالك (الصحة العامة لا تعرضها).
    const owner = await (await fetch(`${BASE}/api/agent/youtube/watcher`, { headers: auth })).json();
    check('المالك: عدّاد الردود الحقيقي = 3', Number(owner?.watcher?.counters?.replied || 0) === 3, JSON.stringify(owner?.watcher?.counters));
    check('لا سرّ في أي استجابة', !JSON.stringify(owner).includes(GO_CLIENT_SECRET) && !JSON.stringify(owner).includes(TOKEN_KEY));
  } finally {
    try { if (proc) { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1200)); if (!proc.killed) proc.kill('SIGKILL'); } } catch { /* تجاهل */ }
    await mock.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

(async () => {
  await main();
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} observation-count checks`);
  }
})().catch((err) => { console.error('observation-count harness crashed:', err); process.exit(1); });
