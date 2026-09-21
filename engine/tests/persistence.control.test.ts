/**
 * اختبار انضباط الدوام والتحكّم (regression) لأربعة شروط ملزمة:
 *  - إبطال جلسات المعاينة عند تغيير GHARABI_PREVIEW_TOKEN (بلا تدوير SESSION_SECRET).
 *  - فشل الإقلاع بوضوح عند تعذّر تحميل الحالة من Postgres (لا رجوع لملف ولا خدمة).
 *  - تفريغ طابور الكتابة عند SIGTERM خلال مهلة ≤ 10 ثوانٍ وبخروج نظيف.
 *  - منع إعادة استخدام رمز OTP داخل نافذته، ويبقى المنع بعد إعادة التشغيل.
 *
 * يشغّل خادم Express الحقيقي في عمليات منفصلة. لا يستخدم أي سر إنتاج.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issueChallengeCode } from '../auth/challenge';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');

interface AppHandle { proc: ChildProcess; log: () => string }

function startApp(port: number, cwd: string, extra: Record<string, string | undefined>): AppHandle {
  let log = '';
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.DATABASE_URL;
  delete env.GHARABI_PREVIEW_TOKEN;
  delete env.PLATFORM_TOKEN_ENCRYPTION_KEY;
  Object.assign(env, {
    PORT: String(port),
    NODE_ENV: 'production',
    APP_URL: `http://127.0.0.1:${port}`,
    STATE_DIR: cwd,
  });
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

async function waitForHealth(base: string, timeoutMs = 40_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** ينتظر انتهاء العملية ويُعيد رمز الخروج والمدة بالمللي ثانية. */
function waitForExit(proc: ChildProcess, timeoutMs = 15_000): Promise<{ code: number | null; ms: number }> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* تجاهل */ }
      resolve({ code: null, ms: Date.now() - startedAt });
    }, timeoutMs);
    proc.once('exit', (code) => { clearTimeout(timer); resolve({ code, ms: Date.now() - startedAt }); });
  });
}

async function shutdown(handle: AppHandle): Promise<{ code: number | null; ms: number }> {
  handle.proc.kill('SIGTERM');
  return waitForExit(handle.proc, 12_000);
}

const OWNER_EMAIL = 'owner-control-test@example.invalid';
const SECRET = crypto.randomBytes(32).toString('hex');
const secretBuffer = crypto.createHash('sha256').update(`gharabi-session:${SECRET}`).digest();

async function run(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'gharabi-control-'));
  const port = 5800 + Math.floor(Math.random() * 120);
  const base = `http://127.0.0.1:${port}`;
  const logs: string[] = [];
  const TOKEN_A = crypto.randomBytes(24).toString('hex');
  const TOKEN_B = crypto.randomBytes(24).toString('hex');
  const TOKEN_C = crypto.randomBytes(24).toString('hex');
  let app: AppHandle | null = null;

  // ============ 1) تغيير توكن المعاينة يُبطل الجلسة الصادرة (عبر عمليات) ============
  try {
    app = startApp(port, dir, { OWNER_EMAIL, SESSION_SECRET: SECRET, GHARABI_PREVIEW_TOKEN: TOKEN_A });
    check('الخادم الأول يقلع', await waitForHealth(base), app.log().slice(0, 400));
    logs.push(app.log());

    const loginA = await fetch(`${base}/api/auth/preview-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: TOKEN_A }),
    });
    const loginABody = await loginA.json();
    const tokenA: string = loginABody.token || '';
    check('دخول المعاينة بتوكن A يمنح جلسة', loginA.status === 200 && tokenA.split('.').length === 2, `status=${loginA.status}`);
    check('جلسة المعاينة تعمل قبل التغيير', (await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${tokenA}` } })).status === 200);

    const firstExit = await shutdown(app);
    check('الخادم الأول يتوقف نظيفاً', firstExit.code === 0, `code=${firstExit.code}`);
    app = null;

    // نفس مجلد الحالة، لكن بتوكن معاينة مختلف — الختم يجب أن يرفع فيُبطل جلسة A.
    app = startApp(port, dir, { OWNER_EMAIL, SESSION_SECRET: SECRET, GHARABI_PREVIEW_TOKEN: TOKEN_B });
    check('الخادم الثاني يقلع بتوكن B', await waitForHealth(base), app.log().slice(0, 400));
    logs.push(app.log());

    const meWithOldToken = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${tokenA}` } });
    check('★ تغيير توكن المعاينة يُبطل الجلسة الصادرة قبله', meWithOldToken.status === 401, `status=${meWithOldToken.status}`);

    const loginBOld = await fetch(`${base}/api/auth/preview-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: TOKEN_A }),
    });
    check('التوكن القديم نفسه لم يعد يقبل الدخول', loginBOld.status === 401, `status=${loginBOld.status}`);

    const loginB = await fetch(`${base}/api/auth/preview-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: TOKEN_B }),
    });
    const tokenB: string = (await loginB.json()).token || '';
    check('التوكن الجديد يمنح جلسة صالحة', loginB.status === 200 && tokenB.split('.').length === 2, `status=${loginB.status}`);
    check('الجلسة الجديدة تعمل', (await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${tokenB}` } })).status === 200);

    // إبطال المالك دون تدوير SESSION_SECRET: تغيير التوكن مرة أخرى.
    const TOKEN_C = crypto.randomBytes(24).toString('hex');
    await shutdown(app);
    app = null;
    app = startApp(port, dir, { OWNER_EMAIL, SESSION_SECRET: SECRET, GHARABI_PREVIEW_TOKEN: TOKEN_C });
    await waitForHealth(base);
    const meAfterSecondRotation = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${tokenB}` } });
    check('★ إبطال متكرر عبر تغيير التوكن يعمل بلا تدوير SESSION_SECRET', meAfterSecondRotation.status === 401, `status=${meAfterSecondRotation.status}`);

    check('السجلات لا تُسرّب أي توكن معاينة أو جلسة', !logs.join('').includes(TOKEN_A) && !logs.join('').includes(TOKEN_B) && !logs.join('').includes(TOKEN_C) && !logs.join('').includes(tokenA) && !logs.join('').includes(tokenB));
    const controlFile = join(dir, '.gharabi-control.json');
    check('حالة التحكّم محفوظة عبر المحوّل (ملف)', existsSync(controlFile));
    check('حالة التحكّم لا تحمل توكن المعاينة كنص صريح', existsSync(controlFile) && !readFileSync(controlFile, 'utf8').includes(TOKEN_C));
  } finally {
    if (app) await shutdown(app);
    app = null;
  }

  // ============ 2) SIGTERM يُفرّغ الكتابة المعلّقة خلال ≤ 10 ثوانٍ ============
  try {
    app = startApp(port, dir, { OWNER_EMAIL, SESSION_SECRET: SECRET, GHARABI_PREVIEW_TOKEN: TOKEN_C });
    check('الخادم يقلع لاختبار تفريغ الطابور', await waitForHealth(base), app.log().slice(0, 400));

    const login = await fetch(`${base}/api/auth/preview-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: TOKEN_C }),
    });
    const ownerToken: string = (await login.json()).token || '';

    // إنشاء مستخدم: مسار يُطلق persistState() بلا انتظار، فيبقى في الطابور.
    const createUser = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ name: 'موظف اختبار التفريغ', email: 'flush-check@example.invalid', role: 'staff' }),
    });
    check('إنشاء مستخدم ينجح', createUser.status === 200, `status=${createUser.status}`);

    // إيقاف فوري بلا مهلة: على الخادم أن يُفرّغ الطابور ثم يخرج نظيفاً.
    const exit = await shutdown(app);
    check('★ الخادم يخرج نظيفاً عند SIGTERM', exit.code === 0, `code=${exit.code}`);
    check('★ الخروج خلال ≤ 10 ثوانٍ', exit.ms <= 10_000, `ms=${exit.ms}`);
    app = null;

    const stateFile = join(dir, '.gharabi-state.json');
    const stateText = existsSync(stateFile) ? readFileSync(stateFile, 'utf8') : '';
    check('★ الكتابة المعلّقة وصلت القرص بعد SIGTERM', stateText.includes('flush-check@example.invalid'));
  } finally {
    if (app) await shutdown(app);
    app = null;
  }

  // ============ 3) OTP لا يُستخدم مرتين، ويبقى المنع بعد إعادة التشغيل ============
  try {
    app = startApp(port, dir, { OWNER_EMAIL, SESSION_SECRET: SECRET });
    check('الخادم يقلع لاختبار OTP', await waitForHealth(base), app.log().slice(0, 400));

    const code = issueChallengeCode(OWNER_EMAIL, secretBuffer);
    const first = await fetch(`${base}/api/auth/verify-challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: OWNER_EMAIL, code }),
    });
    check('أول استخدام لرمز OTP ينجح', first.status === 200 && Boolean((await first.json()).token), `status=${first.status}`);

    const second = await fetch(`${base}/api/auth/verify-challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: OWNER_EMAIL, code }),
    });
    check('★ نفس الرمز يُرفض في الاستخدام الثاني', second.status === 401, `status=${second.status}`);

    const exit = await shutdown(app);
    check('الخادم يتوقف نظيفاً قبل إعادة التشغيل', exit.code === 0, `code=${exit.code}`);
    app = null;

    // عملية جديدة تماماً: المنع يجب أن يبقى لأن النافذة المُستهلكة محفوظة عبر المحوّل.
    app = startApp(port, dir, { OWNER_EMAIL, SESSION_SECRET: SECRET });
    check('الخادم الثاني يقلع', await waitForHealth(base), app.log().slice(0, 400));

    const afterRestart = await fetch(`${base}/api/auth/verify-challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: OWNER_EMAIL, code }),
    });
    check('★ نفس الرمز يبقى مرفوضاً بعد إعادة التشغيل', afterRestart.status === 401, `status=${afterRestart.status}`);

    const controlText = existsSync(join(dir, '.gharabi-control.json')) ? readFileSync(join(dir, '.gharabi-control.json'), 'utf8') : '';
    check('الرمز نفسه غير مخزَّن إطلاقاً (نافذة فقط)', controlText.length > 0 && !controlText.includes(code));
  } finally {
    if (app) await shutdown(app);
    app = null;
  }

  // ============ 4) DATABASE_URL غير متاح => فشل إقلاع صريح بلا خدمة ولا رجوع ============
  try {
    // منفذ مغلق على المضيف المحلي: الرفض فوري (ECONNREFUSED) بعد محاولات محدودة.
    const badDbDir = mkdtempSync(join(tmpdir(), 'gharabi-baddb-'));
    const badPort = port + 3;
    const badBase = `http://127.0.0.1:${badPort}`;
    const badApp = startApp(badPort, badDbDir, {
      OWNER_EMAIL,
      SESSION_SECRET: SECRET,
      DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/gharabi?sslmode=disable',
    });
    const badExit = await waitForExit(badApp.proc, 60_000);
    check('★ تعذّر Postgres يُفشل الإقلاع برمز غير صفري', badExit.code !== 0 && badExit.code !== null, `code=${badExit.code}`);
    let servedHealth = false;
    try { servedHealth = (await fetch(`${badBase}/api/health`)).ok; } catch { servedHealth = false; }
    check('★ الخادم لم يخدم أي طلب بصحة زائفة', servedHealth === false);
    let badFileCreated = false;
    try { badFileCreated = existsSync(join(badDbDir, '.gharabi-state.json')); } catch { badFileCreated = false; }
    check('★ لا رجوع لملف حالة محلي بديل', badFileCreated === false);
    check('رسالة الفشل صريحة ولا تسرّب نص الاتصال', /Postgres/.test(badApp.log()) && !badApp.log().includes('postgresql://'));
    badApp.proc.kill('SIGKILL');
    rmSync(badDbDir, { recursive: true, force: true });
  } catch (error: any) {
    check('اختبار فشل الإقلاع لم ينهار', false, String(error?.message || error).slice(0, 200));
  }

  rmSync(dir, { recursive: true, force: true });

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} persistence/control checks`);
  }
}

run().catch((err) => { console.error('Persistence/control harness crashed:', err); process.exit(1); });
