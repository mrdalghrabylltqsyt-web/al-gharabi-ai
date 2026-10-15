/**
 * N2 — اختبار انحدار: ترتيب الإغلاق عند SIGTERM.
 *
 * العيب القديم: كان الإغلاق يوقف المؤقّتات ثم يُفرّغ الكتابات، لكن **الخادم يبقى
 * يستقبل طلبات HTTP جديدة** حتى آخر لحظة، وأقفال الدوام (durableLease) لا تُحرَّر
 * صراحةً. الإصلاح: `server.close()` أولاً (وقف الاستقبال)، ثم إيقاف المؤقّتات،
 * ثم تحرير الأقفال، ثم تفريغ الكتابات، ثم إغلاق المخزن والخروج 0.
 *
 * يُثبت هنا: بعد SIGTERM تُرفض الاتصالات الجديدة (ECONNREFUSED) بينما الكتابة
 * المعلّقة تصل القرص ويخرج الخادم نظيفاً خلال ≤ 10 ثوانٍ.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServerTestEnv } from './helpers/serverTestEnv';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const OWNER_EMAIL = 'owner-n2-shutdown@example.invalid';
const SECRET = 'n2-shutdown-secret-not-real';
const TOKEN = 'n2-preview-token-0001';

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');

function startApp(port: number, dir: string): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env = buildServerTestEnv({
    stateDir: dir, prefix: 'gharabi-n2-',
    overrides: { PORT: String(port), NODE_ENV: 'production', OWNER_EMAIL, SESSION_SECRET: SECRET, GHARABI_PREVIEW_TOKEN: TOKEN, APP_URL: `http://127.0.0.1:${port}` },
  });
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

async function waitForHealth(base: string, timeoutMs = 40_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${base}/api/health`); if (r.status > 0) return true; } catch { /* لم يقلع */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function run(): Promise<void> {
  const PORT = 5600 + Math.floor(Math.random() * 200);
  const base = `http://127.0.0.1:${PORT}`;
  const dir = mkdtempSync(join(tmpdir(), 'gharabi-n2-'));
  let app: { proc: ChildProcess; log: () => string } | null = null;
  try {
    app = startApp(PORT, dir);
    check('الخادم يقلع', await waitForHealth(base), app.log().slice(0, 300));

    const login = await fetch(`${base}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: TOKEN }) });
    const ownerToken: string = (await login.json()).token || '';

    // كتابة معلّقة: إنشاء مستخدم يُطلق persistState بلا انتظار فيبقى في الطابور.
    const createUser = await fetch(`${base}/api/users`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ name: 'موظف إغلاق', email: 'n2-shutdown@example.invalid', role: 'staff' }),
    });
    check('إنشاء مستخدم ينجح', createUser.status === 200, `status=${createUser.status}`);

    // إرسال SIGTERM ثم محاولة اتصال جديد فوراً: يجب أن يُرفض (server.close أولاً).
    // نلتقط حدث الخروج **قبل** الإشارة (قد يخرج الخادم فوراً فلا نفوت الحدث).
    const exitPromise = new Promise<number | null>((resolve) => {
      if (app!.proc.exitCode !== null || app!.proc.signalCode !== null) return resolve(app!.proc.exitCode);
      app!.proc.once('exit', (code) => resolve(code));
    });
    const startedAt = Date.now();
    app.proc.kill('SIGTERM');
    let refused = false;
    const probeDeadline = Date.now() + 5000;
    while (Date.now() < probeDeadline) {
      try {
        const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(800) });
        void r;
      } catch (e: any) {
        // ECONNREFUSED أو مهلة = الاستقبال توقف (المطلوب).
        refused = true; break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    check('★ بعد SIGTERM: تُرفض الطلبات الجديدة (server.close أولاً)', refused === true);

    const exitCode: number | null = await Promise.race([
      exitPromise,
      new Promise<number | null>((resolve) => {
        const t = setTimeout(() => resolve(app ? app.proc.exitCode : null), 12_000);
        t.unref?.();
      }),
    ]);
    if (exitCode !== 0) console.error('[N2-DEBUG server log]\n' + app.log().slice(-1500));
    const ms = Date.now() - startedAt;
    check('★ الخروج النظيف برمز 0', exitCode === 0, `code=${exitCode}`);
    check('★ الخروج خلال ≤ 10 ثوانٍ', ms <= 10_500, `ms=${ms}`);
    app = null;

    const stateFile = join(dir, '.gharabi-state.json');
    const stateText = existsSync(stateFile) ? readFileSync(stateFile, 'utf8') : '';
    check('★ الكتابة المعلّقة وصلت القرص (تفريغ بعد إيقاف الاستقبال)', stateText.includes('n2-shutdown@example.invalid'));
  } finally {
    if (app) { try { app.proc.kill('SIGKILL'); } catch { /* تجاهل */ } }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }

  // ---- تحقق بنيوي (يفشل على الكود القديم): ترتيب الإغلاق في المصدر الفعلي ----
  const serverSrc = readFileSync(join(REPO_ROOT, 'server.ts'), 'utf8');
  const start = serverSrc.indexOf('const shutdown = (signal: string)');
  const end = serverSrc.indexOf('process.once("SIGTERM"', start);
  const block = start >= 0 && end > start ? serverSrc.slice(start, end) : '';
  check('★ shutdown يستدعي httpServer.close (وقف الاستقبال)', block.includes('httpServer.close('), block.slice(0, 60));
  check('★ shutdown يُحرّر أقفال الدوام صراحةً', block.includes('releaseLease(watcherLease') && block.includes('releaseLease(commercialLease'), '');
  check('★ ترتيب المصدر: server.close قبل تفريغ الطابور', block.indexOf('httpServer.close(') < block.indexOf('drainQueue()'), '');
  check('★ ترتيب المصدر: تحرير الأقفال قبل التفريغ', block.indexOf('releaseLease(watcherLease') < block.indexOf('drainQueue()'), '');

  console.log(`\n[ process-shutdown-n2 ] passed=${passed} failed=${failures.length}`);
  if (failures.length) { for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
}

run().catch((err) => { console.error(err); process.exit(1); });
