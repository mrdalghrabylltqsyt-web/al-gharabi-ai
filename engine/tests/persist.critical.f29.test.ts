/**
 * F-29 — اختبار انحدار: `persistCritical` يجب أن **تضمن الدوام فعلاً** (ترمي
 * عند فشل الكتابة)، فلا يُعلن نجاح جلسة/إبطال/استهلاك OTP قبل وصول الحالة للمخزن.
 *
 * العيب القديم: `persistCritical` كانت تُعيد `persistQueue` الذي **لا يرفض أبداً**
 * (لأن `persistState`/`saveControlState` تلتقطان الخطأ وتُكملان)، فيبدو الرد ناجحاً
 * بينما لم تُكتب الحالة فعلاً.
 *
 * يُثبت السلوك الجديد عبر خادم حقيقي على مجلد حالة **للقراءة فقط** (chmod 555) —
 * وهو ما يجعل كتابة الملف المحلي تفشل فعلياً:
 *   1) تسجيل الخروج => **503** (لا 200 كاذب) عند تعذّر تثبيت الإبطال.
 *   2) تسجيل دخول المعاينة => **503** عند تعذّر تثبيت إنشاء الجلسة.
 *   3) إثبات أن الكتابة فشلت فعلاً (لا ملف كتابة جديد).
 *   4) بعد إصلاح الصلاحية: المسار نفسه ينجح => لا تعطّل دائم.
 *
 * ملاحظة: نستخدم مسار المعاينة (بلا OTP) لتجنّب ارتباط نافذة OTP عبر الزمن، مع
 * بقاء الهدف نفسه (تثبيت `persistCritical` قبل إعلان النجاح)، ونتحقق أيضاً من
 * مسار الخروج الذي يعتمد الإبطال الدائم.
 *
 * لا يستخدم أي مفتاح حقيقي: SESSION_SECRET وGHARABI_PREVIEW_TOKEN قيم اختبار وهمية.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync, chmodSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issueChallengeCode } from '../auth/challenge';
import { buildServerTestEnv } from './helpers/serverTestEnv';
import { reserveFreePort } from './helpers/freePort';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const OWNER_EMAIL = 'owner-persist-critical-test@example.com';
const TEST_SECRET = 'test-persist-critical-secret-not-real';
const PREVIEW_TOKEN = 'test-preview-token-persist-critical-0001';

const secretBuffer = crypto.createHash('sha256').update(`gharabi-session:${TEST_SECRET}`).digest();

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');

function startApp(port: number, cwd: string, extra: Record<string, string | undefined> = {}): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = buildServerTestEnv({
    stateDir: cwd,
    prefix: 'gharabi-persist-critical-',
    overrides: {
      PORT: String(port), NODE_ENV: 'production', OWNER_EMAIL,
      SESSION_SECRET: TEST_SECRET, APP_URL: `http://127.0.0.1:${port}`,
      GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
      ...extra,
    },
  });
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

/** الخادم "أقلع" بمجرد أن يستجيب بأي رمز HTTP (قد يكون 503 على مخزن معطوب = سلوك صحيح). */
async function waitForServer(base: string, timeoutMs = 40_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${base}/api/health`); if (r.status > 0) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function stop(proc: ChildProcess): Promise<void> {
  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 700));
}

async function previewLogin(base: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: PREVIEW_TOKEN }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function run(): Promise<void> {
  const PORT = await reserveFreePort();
  const BASE = `http://127.0.0.1:${PORT}`;
  const dir = mkdtempSync(join(tmpdir(), 'gharabi-persist-critical-'));

  let app: { proc: ChildProcess; log: () => string } | null = null;
  try {
    // ---- 1) إقلاع عادي على مجلد قابل للكتابة: جلسة مالك + جلسة معاينة ----
    app = startApp(PORT, dir);
    check('الخادم يقلع', await waitForServer(BASE), app.log().slice(0, 400));

    const code = issueChallengeCode(OWNER_EMAIL, secretBuffer);
    const verified = await fetch(`${BASE}/api/auth/verify-challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: OWNER_EMAIL, code }),
    });
    const verifiedBody = await verified.json();
    check('تحقق المالك ينجح والجلسة تُصدر (المخزن سليم)', verified.status === 200 && Boolean(verifiedBody.token), `status=${verified.status}`);
    const token: string = verifiedBody.token || '';

    const me = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    check('الجلسة تعمل قبل كسر المخزن', me.status === 200, `status=${me.status}`);

    const previewOk = await previewLogin(BASE);
    check('تسجيل دخول المعاينة ينجح (المخزن سليم)', previewOk.status === 200 && Boolean(previewOk.body.token), `status=${previewOk.status}`);

    await stop(app.proc);
    app = null;

    // ---- 2) جعل مجلد الحالة غير قابل للكتابة (محاكاة فشل المخزن الحقيقي) ----
    chmodSync(dir, 0o555);
    const filesBefore = new Set(readdirSync(dir));
    let writeFails = false;
    try { writeFileSync(join(dir, 'canary.tmp'), 'x'); } catch { writeFails = true; }
    check('★ مجلد الحالة للقراءة فقط (الشرط المسبق للاختبار)', writeFails === true);

    app = startApp(PORT, dir);
    check('الخادم يستجيب حتى مع مجلد غير قابل للكتابة', await waitForServer(BASE), app.log().slice(0, 400));

    // ---- 3) تسجيل الخروج يجب أن يفشل بـ503 (لا نجاح كاذب) ----
    const logout = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const logoutBody = await logout.json().catch(() => ({}));
    check('★ تسجيل الخروج => 503 عند تعذّر تثبيت الإبطال (لا 200 كاذب)', logout.status === 503, `status=${logout.status} body=${JSON.stringify(logoutBody).slice(0, 120)}`);
    check('رسالة الفشل صريحة', typeof logoutBody.error === 'string' && logoutBody.error.length > 0);

    // ---- 4) تسجيل دخول المعاينة يجب أن يفشل بـ503 (لا توكن بلا دوام) ----
    const previewFail = await previewLogin(BASE);
    check('★ تسجيل الدخول => 503 عند تعذّر تثبيت الحالة (لا توكن بلا دوام)', previewFail.status === 503, `status=${previewFail.status} body=${JSON.stringify(previewFail.body).slice(0, 120)}`);
    check('لا يُعاد أي توكن عند فشل التثبيت', !previewFail.body.token);

    // ---- 5) لا ملف حالة جديد كُتب فعلاً (إثبات أن الفشل حقيقي) ----
    const filesAfter = new Set(readdirSync(dir));
    const newFiles = [...filesAfter].filter((f) => !filesBefore.has(f));
    check('لم يُكتب ملف حالة جديد (الفشل حقيقي)', newFiles.length === 0, `new=${JSON.stringify(newFiles)}`);

    // ---- 6) إصلاح الصلاحية: المسار نفسه ينجح مرة أخرى (لا تعطّل دائم) ----
    await stop(app.proc);
    app = null;
    chmodSync(dir, 0o700);
    app = startApp(PORT, dir);
    check('الخادم يعود بعد إصلاح الصلاحية', await waitForServer(BASE), app.log().slice(0, 400));
    const previewRecover = await previewLogin(BASE);
    check('★ بعد إصلاح المخزن: تسجيل الدخول ينجح (لا تعطّل دائم)', previewRecover.status === 200 && Boolean(previewRecover.body.token), `status=${previewRecover.status}`);
    await stop(app.proc);
    app = null;

    // ---- 7) وضع عابر مُعلَن (RENDER=true بلا DATABASE_URL): الكتابة best-effort ----
    // سلوك موثّق: الجلسات موقّعة بلا حالة تعمل بلا كتابة، فلا يُسقط الخادم الخدمة.
    chmodSync(dir, 0o555);
    app = startApp(PORT, dir, { RENDER: 'true' });
    check('الخادم يقلع في وضع عابر مُعلَن مع مجلد للقراءة فقط', await waitForServer(BASE), app.log().slice(0, 400));
    const previewEphemeral = await previewLogin(BASE);
    check('★ وضع عابر مُعلَن: تسجيل الدخول ينجح (لا إسقاط لوضع مدعوم)', previewEphemeral.status === 200 && Boolean(previewEphemeral.body.token), `status=${previewEphemeral.status} body=${JSON.stringify(previewEphemeral.body).slice(0, 120)}`);
  } finally {
    if (app?.proc) await stop(app.proc).catch(() => {});
    try { chmodSync(dir, 0o700); } catch { /* تجاهل */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }

  console.log(`\n[ persist-critical ] passed=${passed} failed=${failures.length}`);
  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
