/**
 * اختبار دخول المعاينة (GHARABI_PREVIEW_TOKEN).
 *
 * هذا مسار مصادقة حسّاس، لذا نثبت هنا أنه:
 *  1) معطّل تماماً (404) عند غياب المتغير — لا وجود لبوابة خلفية دائمة.
 *  2) يرفض أي توكن خاطئ أو ناقص بـ401 بلا كشف شيء.
 *  3) يمنح جلسة مالك صالحة فقط عند مطابقة التوكن تماماً.
 *  4) لا يطبع التوكن ولا يضعه في السجل ولا في جسم أي استجابة خطأ.
 *
 * الخادم يعمل من مجلد مؤقت حتى لا تُكتب حالة في المستودع.
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
const TOKEN = randomBytes(24).toString('hex');

function startApp(port: number, cwd: string, previewToken: string | null): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    NODE_ENV: 'production',
    APP_URL: `http://127.0.0.1:${port}`,
  };
  if (previewToken === null) delete env.GHARABI_PREVIEW_TOKEN;
  else env.GHARABI_PREVIEW_TOKEN = previewToken;
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

async function waitForHealth(base: string, timeoutMs = 40_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return true; } catch { /* لم يقلع */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function run(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }

  // ---- الحالة 1: المتغير غائب => المسار غير موجود إطلاقاً ----
  const cwdOff = mkdtempSync(join(tmpdir(), 'gharabi-preview-off-'));
  const offPort = 5210 + Math.floor(Math.random() * 200);
  const offBase = `http://127.0.0.1:${offPort}`;
  const off = startApp(offPort, cwdOff, null);
  try {
    check('الخادم يقلع بدون توكن المعاينة', await waitForHealth(offBase), off.log().slice(0, 300));
    const r = await fetch(`${offBase}/api/auth/preview-login?token=${TOKEN}`);
    check('بلا إعداد: مسار المعاينة يعيد 404 (معطّل تماماً)', r.status === 404, `got ${r.status}`);
    const body = await r.text();
    check('بلا إعداد: لا يكشف وجود الميزة', !/preview|token/i.test(body), body.slice(0, 120));
    check('بلا إعداد: لا يمنح أي جلسة', !/"success"\s*:\s*true/.test(body));
  } finally {
    off.proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 600));
    try { rmSync(cwdOff, { recursive: true, force: true }); } catch {}
  }

  // ---- الحالة 2: المتغير مضبوط => حراسة صارمة ----
  const cwdOn = mkdtempSync(join(tmpdir(), 'gharabi-preview-on-'));
  const onPort = offPort + 1;
  const onBase = `http://127.0.0.1:${onPort}`;
  let on: { proc: ChildProcess; log: () => string } | null = null;
  try {
    on = startApp(onPort, cwdOn, TOKEN);
    check('الخادم يقلع مع توكن المعاينة', await waitForHealth(onBase), on.log().slice(0, 300));

    const noTok = await fetch(`${onBase}/api/auth/preview-login`);
    check('بلا توكن: 401', noTok.status === 401, `got ${noTok.status}`);
    const wrong = await fetch(`${onBase}/api/auth/preview-login?token=deadbeefdeadbeef`);
    check('توكن خاطئ: 401', wrong.status === 401, `got ${wrong.status}`);
    const near = await fetch(`${onBase}/api/auth/preview-login?token=${TOKEN.slice(0, -1)}`);
    check('توكن ناقص بحرف واحد: 401', near.status === 401, `got ${near.status}`);
    const wrongBodies = await Promise.all([noTok.text(), wrong.text(), near.text()]);
    check('الاستجابات الخاطئة لا تحتوي التوكن الصحيح', wrongBodies.every((b) => !b.includes(TOKEN)));

    const ok = await fetch(`${onBase}/api/auth/preview-login?token=${TOKEN}`);
    const okBody = await ok.json();
    check('توكن صحيح: 200 وجلسة ناجحة', ok.status === 200 && okBody.success === true, `got ${ok.status}`);
    check('الدور هو المالك', okBody.user?.role === 'owner', JSON.stringify(okBody.user?.role));
    check('يُعاد توكن جلسة فعلي وليس توكن المعاينة', typeof okBody.token === 'string' && okBody.token.length >= 32 && okBody.token !== TOKEN);

    const me = await fetch(`${onBase}/api/auth/me`, { headers: { Authorization: `Bearer ${okBody.token}` } });
    check('الجلسة الممنوحة تعمل على مسار محمي', me.status === 200, `got ${me.status}`);
    const meWithout = await fetch(`${onBase}/api/auth/me`);
    check('بلا جلسة يبقى 401', meWithout.status === 401);

    check('السجل لا يحتوي توكن المعاينة ولا توكن الجلسة', !on.log().includes(TOKEN) && !on.log().includes(okBody.token));

    console.log('\n' + '='.repeat(60));
    if (failures.length) {
      console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
      for (const f of failures) console.error(`  ✗ ${f}`);
      process.exitCode = 1;
    } else {
      console.log(`PASSED: ${passed} preview login checks`);
    }
  } finally {
    try { on?.proc.kill('SIGTERM'); } catch {}
    await new Promise((r) => setTimeout(r, 500));
    try { rmSync(cwdOn, { recursive: true, force: true }); } catch {}
  }
}

run().catch((err) => { console.error('Preview login harness crashed:', err); process.exit(1); });