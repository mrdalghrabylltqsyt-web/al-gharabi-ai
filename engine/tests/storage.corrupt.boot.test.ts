/**
 * F-17 — اختبار انحدار: ملف حالة محلي معطوب => فشل إقلاع صريح (fail-closed).
 *
 * العيب القديم: backend الملف كان يُعيد `null` بصمت عند أي خطأ قراءة (تلف/صلاحية)
 * فيُبنى النظام فوق حالة **فارغة** ويُكتب فوق الملف المعطوب — فقدان بيانات كامل.
 * الإصلاح: تلف ملف حالة موجود يُسقط `healthy` ويُعلَن `state_corrupt:<key>`،
 * والخادم يرفض الإقلاع بدل إعادة البناء (نفس صرامة مسار Postgres).
 *
 * يُثبت هنا على خادم حقيقي: (أ) ملف معطوب => العملية تخرج بخطأ صريح ولا تستمع،
 * (ب) ملف سليم => الإقلاع ناجح (لا إنذار كاذب)، (ج) غياب الملف => إقلاع نظيف.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServerTestEnv } from './helpers/serverTestEnv';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const OWNER_EMAIL = 'owner-f17-corrupt@example.invalid';
const SECRET = 'f17-corrupt-secret-not-real';
const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');

interface AppHandle { proc: ChildProcess; log: () => string }

function startApp(port: number, dir: string): AppHandle {
  let log = '';
  const env = buildServerTestEnv({
    stateDir: dir, prefix: 'gharabi-f17-',
    overrides: { PORT: String(port), NODE_ENV: 'production', OWNER_EMAIL, SESSION_SECRET: SECRET, APP_URL: `http://127.0.0.1:${port}` },
  });
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

/** ينتظر خروج العملية أو استقرار الخادم (من يحدث أولاً). */
async function awaitExitOrListen(app: AppHandle, base: string, timeoutMs = 40_000): Promise<'exited' | 'listening' | 'timeout'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (app.proc.exitCode !== null || app.proc.signalCode !== null) return 'exited';
    try { const r = await fetch(`${base}/api/health`); if (r.status > 0) return 'listening'; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return 'timeout';
}

async function run(): Promise<void> {
  // (أ) ملف حالة معطوب => فشل قاتل صريح.
  {
    const PORT = 5300 + Math.floor(Math.random() * 100);
    const dir = mkdtempSync(join(tmpdir(), 'gharabi-f17-bad-'));
    // نكتب ملف الحالة المعطوب **قبل** الإقلاع (لا سباق مع قراءة الخادم).
    writeFileSync(join(dir, '.gharabi-state.json'), '{ "workspace": { "posts": [ ', 'utf8');
    const app = startApp(PORT, dir);
    try {
      const outcome = await awaitExitOrListen(app, `http://127.0.0.1:${PORT}`);
      check('★ F-17: ملف حالة معطوب => الخادم لا يستمع (لا إقلاع)', outcome === 'exited', `outcome=${outcome}`);
      check('★ F-17: رسالة الفشل تذكر تلف ملف الحالة', /state_corrupt|ملف الحالة المحلي معطوب/.test(app.log()), app.log().slice(-400));
    } finally {
      try { app.proc.kill('SIGKILL'); } catch { /* تجاهل */ }
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // (ب) ملف حالة سليم => إقلاع ناجح (لا إنذار كاذب).
  {
    const PORT = 5400 + Math.floor(Math.random() * 100);
    const dir = mkdtempSync(join(tmpdir(), 'gharabi-f17-ok-'));
    const app = startApp(PORT, dir);
    try {
      writeFileSync(join(dir, '.gharabi-state.json'), JSON.stringify({ schemaVersion: 16, workspace: {} }), 'utf8');
      const outcome = await awaitExitOrListen(app, `http://127.0.0.1:${PORT}`);
      check('★ F-17: ملف سليم => الإقلاع ناجح (لا حجب كاذب)', outcome === 'listening', `outcome=${outcome} log=${app.log().slice(-300)}`);
    } finally {
      try { app.proc.kill('SIGTERM'); } catch { /* تجاهل */ }
      await new Promise((r) => setTimeout(r, 800));
      try { app.proc.kill('SIGKILL'); } catch { /* تجاهل */ }
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // (ج) غياب الملف تماماً => تشغيل أول نظيف (لا فشل).
  {
    const PORT = 5500 + Math.floor(Math.random() * 100);
    const dir = mkdtempSync(join(tmpdir(), 'gharabi-f17-first-'));
    const app = startApp(PORT, dir);
    try {
      const outcome = await awaitExitOrListen(app, `http://127.0.0.1:${PORT}`);
      check('★ F-17: تشغيل أول بلا ملف => إقلاع نظيف', outcome === 'listening', `outcome=${outcome} log=${app.log().slice(-300)}`);
    } finally {
      try { app.proc.kill('SIGTERM'); } catch { /* تجاهل */ }
      await new Promise((r) => setTimeout(r, 800));
      try { app.proc.kill('SIGKILL'); } catch { /* تجاهل */ }
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log(`\n[ storage-corrupt-boot ] passed=${passed} failed=${failures.length}`);
  if (failures.length) { for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
}

run().catch((err) => { console.error('harness crashed:', err); process.exit(1); });
