/**
 * اختبار ثبات الحالة عبر Postgres الخارجي (Neon/Render) بين عمليات منفصلة.
 *
 * يشغّل خادم Express الحقيقي مرتين بمجلدَي حالة محليين فارغين تماماً، لكن بنفس
 * DATABASE_URL. هذا يثبت أن الحالة (منها الإبطال ومساحة العمل) تأتي من قاعدة
 * البيانات لا من القرص، وهو جوهر إصلاح «Render Free بلا قرص دائم».
 *
 * لا يعمل إلا عند ضبط GHARABI_TEST_DATABASE_URL (قاعدة اختبار فقط، لا إنتاج).
 * بدونها يُعلن التخطي صراحةً ولا يفشل البناء — فحوص CI الحتمية تبقى بلا شبكة.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issueChallengeCode } from '../auth/challenge';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const DB_URL = (process.env.GHARABI_TEST_DATABASE_URL || '').trim();
const OWNER_EMAIL = 'owner-db-test@example.invalid';
const TEST_SECRET = 'test-db-secret-not-real';
// توكن معاينة اختبار لاشتقاق جلسة مالك ثانية بلا استهلاك OTP (رمز OTP يُستهلك
// مرة واحدة لكل عملية).
const PREVIEW_TOKEN = crypto.randomBytes(24).toString('hex');

const secretBuffer = crypto.createHash('sha256').update(`gharabi-session:${TEST_SECRET}`).digest();
const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');

function startApp(port: number, cwd: string): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    NODE_ENV: 'production',
    OWNER_EMAIL,
    SESSION_SECRET: TEST_SECRET,
    APP_URL: `http://127.0.0.1:${port}`,
    DATABASE_URL: DB_URL,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
  };
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

async function waitForHealth(base: string, timeoutMs = 45_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function stop(proc: ChildProcess): Promise<void> {
  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 900));
  if (!proc.killed) proc.kill('SIGKILL');
}

async function run(): Promise<void> {
  if (!DB_URL) {
    console.log('SKIPPED: database persistence checks — GHARABI_TEST_DATABASE_URL not set (no real Postgres available).');
    return;
  }

  const PORT = 5700 + Math.floor(Math.random() * 200);
  const BASE = `http://127.0.0.1:${PORT}`;
  // مجلدان محليان فارغان: أي بيانات تظهر يجب أن تأتي من Postgres، لا من القرص.
  const emptyDirA = mkdtempSync(join(tmpdir(), 'gharabi-db-a-'));
  const emptyDirB = mkdtempSync(join(tmpdir(), 'gharabi-db-b-'));

  let app: { proc: ChildProcess; log: () => string } | null = null;

  try {
    app = startApp(PORT, emptyDirA);
    check('الخادم يقلع مع DATABASE_URL', await waitForHealth(BASE), app.log().slice(0, 500));

    const health = await (await fetch(`${BASE}/api/health`)).json();
    check('الصحة تعلن خلفية Postgres', health.persistence?.backend === 'postgres', JSON.stringify(health.persistence));
    check('الصحة تعلن الثبات والدوام', health.persistence?.durable === true && health.persistence?.mode === 'durable', JSON.stringify(health.persistence));
    check('الصحة لا تسرّب نص الاتصال', !JSON.stringify(health).includes(DB_URL.split('@').pop() as string));
    check('إبطال الجلسات معلن كدائم', health.persistence?.revocationsDurable === true);

    // كتابة حالة حقيقية: تسجيل دخول المالك ثم خروجه (يُنشئ إبطالاً محفوظاً).
    const code = issueChallengeCode(OWNER_EMAIL, secretBuffer);
    const verified = await fetch(`${BASE}/api/auth/verify-challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: OWNER_EMAIL, code }),
    });
    const token: string = (await verified.json()).token || '';
    check('جلسة المالك تُصدَر', verified.status === 200 && token.split('.').length === 2, `status=${verified.status}`);
    check('الجلسة تعمل في العملية الأولى', (await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status === 200);

    // جلسة ثانية تبقى صالحة بعد إعادة التشغيل (لا نُبطلها).
    const preview = await fetch(`${BASE}/api/auth/preview-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: PREVIEW_TOKEN }),
    });
    const durableToken: string = (await preview.json()).token || '';
    check('جلسة المالك الثانية (معاينة) تُصدَر', preview.status === 200 && durableToken.split('.').length === 2, `status=${preview.status}`);

    const logout = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    check('تسجيل الخروج ينجح', logout.status === 200);

    // انتظر تفريغ طابور الكتابة غير المتزامن إلى قاعدة البيانات.
    await new Promise((r) => setTimeout(r, 1500));

    // إعادة التشغيل بمجلد محلي فارغ تماماً: الحالة تُقرأ من Postgres.
    await stop(app.proc);
    app = null;
    app = startApp(PORT, emptyDirB);
    check('الخادم الثاني (مجلد فارغ) يقلع', await waitForHealth(BASE), app.log().slice(0, 500));
    check('لا ملف حالة محلي في المجلد الثاني', !(await import('node:fs')).existsSync(join(emptyDirB, '.gharabi-state.json')));
    // قد ينشئ الخادم ملفاً عند أول كتابة، لذا نتحقق من الإبطال لا من الملف.

    const revokedCheck = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    check('★ الإبطال يسري بعد إعادة التشغيل من قاعدة البيانات', revokedCheck.status === 401, `status=${revokedCheck.status}`);

    const durableCheck = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${durableToken}` } });
    check('★ جلسة المالك تبقى صالحة بعد cold start', durableCheck.status === 200, `status=${durableCheck.status}`);

    // ---- ثبات دورة التعليقات/الردود عبر Postgres (Create → Persist → Restart → Read) ----
    const socialAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${durableToken}` };
    const conn = await fetch(`${BASE}/api/platforms/facebook/connection-callback`, {
      method: 'POST', headers: socialAuth, body: JSON.stringify({ providerVerified: true, accountId: 'db-test-fb', accountName: 'اختبار' }),
    });
    check('تسجيل اتصال موثق للاختبار', conn.status === 200);
    const ingest = await fetch(`${BASE}/api/social/manager/comments/ingest`, {
      method: 'POST', headers: socialAuth, body: JSON.stringify({ platform: 'facebook', externalId: 'db-persist-evt-1', text: 'بكم سعر الثلاجة؟', authorName: 'أحمد' }),
    });
    check('إنشاء تعليق وارد ناجح', ingest.status === 200 && (await ingest.json()).duplicate === false);
    const reply = await fetch(`${BASE}/api/social/manager/comments/reply`, {
      method: 'POST', headers: socialAuth, body: JSON.stringify({ platform: 'facebook', externalId: 'db-persist-evt-1', text: 'أهلاً بك، شكراً لتواصلك معنا، فريق المعرض في خدمتك.', commentText: 'بكم سعر الثلاجة؟' }),
    });
    check('تسجيل رد ناجح', reply.status === 200);
    await new Promise((r) => setTimeout(r, 1500));

    await stop(app.proc);
    app = null;
    app = startApp(PORT, emptyDirB);
    check('الخادم الثاني (مجلد فارغ) يقلع', await waitForHealth(BASE), app.log().slice(0, 500));

    const commentsAfter = await (await fetch(`${BASE}/api/social/manager/comments?platform=facebook`, { headers: socialAuth })).json();
    check('★ التعليق يصمد بعد إعادة التشغيل من قاعدة البيانات', commentsAfter.count === 1, `count=${commentsAfter.count}`);
    const statusAfter = await (await fetch(`${BASE}/api/social/manager/status`, { headers: socialAuth })).json();
    check('★ الرد المسجل يصمد بعد إعادة التشغيل من قاعدة البيانات', statusAfter.activity.repliesRecorded >= 1, `replies=${statusAfter.activity.repliesRecorded}`);
    const replayAfter = await fetch(`${BASE}/api/social/manager/comments/ingest`, {
      method: 'POST', headers: socialAuth, body: JSON.stringify({ platform: 'facebook', externalId: 'db-persist-evt-1', text: 'بكم سعر الثلاجة؟', authorName: 'أحمد' }),
    });
    check('★ حماية replay تصمد بعد إعادة التشغيل من قاعدة البيانات', (await replayAfter.json()).duplicate === true);

    const health2 = await (await fetch(`${BASE}/api/health`)).json();
    check('الصحة بعد إعادة التشغيل ما زالت تعلن Postgres', health2.persistence?.backend === 'postgres' && health2.persistence?.durable === true);
  } finally {
    try { if (app) await stop(app.proc); } catch { /* تجاهل */ }
    rmSync(emptyDirA, { recursive: true, force: true });
    rmSync(emptyDirB, { recursive: true, force: true });
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} database persistence checks`);
  }
}

run().catch((err) => {
  console.error('Database persistence harness crashed:', err);
  process.exit(1);
});