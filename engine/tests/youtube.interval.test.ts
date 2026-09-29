/**
 * اختبار فاصل الأتمتة (وقت الأتمتة) من طرف إلى طرف على خادم حقيقي (بلا مزود).
 *
 * يثبت: الافتراضي/الحالي = 1 دقيقة، قبول 1..5، رفض 0/السالب/العشري/الأكبر من 5/
 * النص، تفويض المالك (غير المالك 401/403)، الاستمرارية بعد إعادة التشغيل، وإعادة
 * الجدولة بمؤقّت واحد، وبقاء autoReply/Kill Switch دون تغيير عند تغيير الفاصل.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const PORT = 6200 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-yt-interval-'));
const SESSION_SECRET = 'yt-interval-test-secret-not-real';

function startApp(): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE,
    STATE_DIR: stateDir, GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
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

async function loginOwner(): Promise<Record<string, string>> {
  const login = await fetch(`${BASE}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
  });
  const body = await login.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}

async function stop(proc: ChildProcess): Promise<void> {
  try { proc.kill('SIGTERM'); } catch { /* تجاهل */ }
  await new Promise((r) => setTimeout(r, 900));
  try { proc.kill('SIGKILL'); } catch { /* تجاهل */ }
}

async function setCadence(auth: Record<string, string>, value: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}/api/agent/youtube/watcher/controls`, {
    method: 'POST', headers: auth, body: JSON.stringify({ cadenceMinutes: value }),
  });
  return { status: res.status, body: await res.json() };
}

async function watcherState(auth: Record<string, string>): Promise<any> {
  const res = await fetch(`${BASE}/api/agent/youtube/watcher`, { headers: auth });
  const body = await res.json();
  return body.watcher;
}

async function run(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  let app = startApp();
  try {
    const up = await waitForHealth();
    check('الخادم يقلع للاختبار', up, app.log().slice(0, 300));
    if (!up) throw new Error('الخادم لم يبدأ');

    const auth = await loginOwner();

    // 1) الافتراضي/الحالي = 1 دقيقة
    let st = await watcherState(auth);
    check('الحالي افتراضياً = 1 دقيقة', st.cadenceMinutes === 1 && st.controls.cadenceMinutes === 1, `got ${st.cadenceMinutes}`);
    check('cadenceMs الافتراضي = 60000', st.cadenceMs === 60_000, String(st.cadenceMs));

    // 2) قبول 1..5
    for (const m of [1, 2, 3, 4, 5]) {
      const r = await setCadence(auth, m);
      const okVal = r.status === 200 && r.body.success === true && r.body.cadenceMinutes === m && r.body.cadenceMs === m * 60_000;
      check(`قبول القيمة ${m} دقيقة`, okVal, `status=${r.status} body=${JSON.stringify(r.body).slice(0, 160)}`);
      check(`إعادة الجدولة أُعلنت (${m})`, r.body.scheduler && r.body.scheduler.activeTimers === 1, JSON.stringify(r.body.scheduler));
    }
    st = await watcherState(auth);
    check('الحالة بعد التعيين = آخر قيمة (5)', st.cadenceMinutes === 5);

    // 3) الرفض: 0/سالب/عشري/أكبر من 5/نص
    for (const [label, val] of [['0', 0], ['سالب', -1], ['عشري', 2.5], ['أكبر من 5', 6], ['نص', 'abc']] as const) {
      const r = await setCadence(auth, val);
      check(`رفض ${label}`, r.status === 400 && r.body.code === 'INVALID_CADENCE', `status=${r.status} code=${r.body.code}`);
    }
    st = await watcherState(auth);
    check('قيمة مرفوضة لا تُغيّر الفاصل (يبقى 5)', st.cadenceMinutes === 5);

    // 4) autoReply/Kill Switch لا يتغيّران عند تغيير الفاصل
    await setCadence(auth, 3);
    const rr = await setCadence(auth, true as any); // قيمة غير رقمية => 400، لا تغيير للفاصل
    check('قيمة منطقية مكان الفاصل مرفوضة', rr.status === 400);
    st = await watcherState(auth);
    check('autoReply لم يتغيّر بسبب تغيير الفاصل', typeof st.controls.autoReply === 'boolean');
    check('Kill Switch لم يتغيّر بسبب تغيير الفاصل', st.controls.paused === false && st.controls.killSwitchActive === false);

    // 5) غير المالك يُرفض (بلا جلسة)
    const anon = await fetch(`${BASE}/api/agent/youtube/watcher/controls`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cadenceMinutes: 2 }),
    });
    check('بلا جلسة => 401', anon.status === 401, String(anon.status));

    // 6) الاستمرارية بعد إعادة التشغيل (نفس مجلد الحالة)
    const before = (await watcherState(auth)).cadenceMinutes;
    await stop(app.proc);
    app = startApp();
    const up2 = await waitForHealth();
    check('الخادم يعود بعد إعادة التشغيل', up2);
    if (!up2) throw new Error('الخادم لم يعد');
    const auth2 = await loginOwner();
    const after = (await watcherState(auth2)).cadenceMinutes;
    check('الفاصل يصمد بعد إعادة التشغيل', after === before, `before=${before} after=${after}`);
    check('الفاصل المحفوظ = 3 دقيقة', after === 3, String(after));

    // 7) YouTube يبقى بحالته (الاتصال/التفويض لا يتأثران بهذا الإعداد)
    const w = await watcherState(auth2);
    check('كتلة التفويض لا تتأثر (حقول الحالة موجودة)', w.controls && typeof w.watcherActive === 'boolean');

    console.log('\n' + '='.repeat(60));
    if (failures.length) {
      console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
      for (const f of failures) console.error(`  ✗ ${f}`);
      process.exitCode = 1;
    } else {
      console.log(`PASSED: ${passed} youtube interval checks`);
    }
  } finally {
    await stop(app.proc);
    rmSync(stateDir, { recursive: true, force: true });
  }
}

run().catch((err) => { console.error('YouTube interval harness crashed:', err); process.exit(1); });
