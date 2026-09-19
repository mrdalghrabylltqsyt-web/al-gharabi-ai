/**
 * اختبار ثبات جلسة المالك عبر العمليات (وهو جوهر شكوى "الوصول المؤقت").
 *
 * يشغّل خادم Express الحقيقي (server.ts) ثم يوقفه ويعيد تشغيله في مجلد آخر
 * (عملية جديدة تماماً)، ويتأكد أن التوكن الصادر قبل إعادة التشغيل ما زال
 * صالحاً. هذا ما كان يفشل سابقاً لأن الجلسات كانت في Map داخل الذاكرة فقط.
 *
 * لا يستخدم أي مفتاح حقيقي: SESSION_SECRET قيمة اختبار وهمية.
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

const OWNER_EMAIL = 'owner-session-test@example.com';
const TEST_SECRET = 'test-session-secret-not-real';
const OTHER_SECRET = 'a-completely-different-test-secret';

// نفس اشتقاق الخادم تماماً حتى نتمكن من حساب رمز التحقق في الاختبار.
const secretBuffer = crypto.createHash('sha256').update(`gharabi-session:${TEST_SECRET}`).digest();
const otherSecretBuffer = crypto.createHash('sha256').update(`gharabi-session:${OTHER_SECRET}`).digest();

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');

function startApp(port: number, cwd: string, secret: string): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    NODE_ENV: 'production',
    OWNER_EMAIL,
    SESSION_SECRET: secret,
    APP_URL: `http://127.0.0.1:${port}`,
  };
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

async function waitForHealth(base: string, timeoutMs = 40_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return true;
    } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function stop(proc: ChildProcess): Promise<void> {
  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 700));
}

async function run(): Promise<void> {
  const PORT = 5300 + Math.floor(Math.random() * 400);
  const BASE = `http://127.0.0.1:${PORT}`;
  const dirA = mkdtempSync(join(tmpdir(), 'gharabi-session-a-'));
  const dirB = mkdtempSync(join(tmpdir(), 'gharabi-session-b-'));

  let appA: { proc: ChildProcess; log: () => string } | null = null;
  let appB: { proc: ChildProcess; log: () => string } | null = null;
  let appC: { proc: ChildProcess; log: () => string } | null = null;

  try {
    // ---- العملية الأولى: إصدار توكن عبر تحقق المالك ----
    appA = startApp(PORT, dirA, TEST_SECRET);
    check('الخادم الأول يقلع', await waitForHealth(BASE), appA.log().slice(0, 400));

    const health = await (await fetch(`${BASE}/api/health`)).json();
    check('الصحة تعلن ثبات الجلسات عند ضبط SESSION_SECRET', health.persistence?.sessionsDurable === true, JSON.stringify(health.persistence));
    check('مصدر المفتاح مُعلن بصراحة', health.persistence?.sessionSecretSource === 'SESSION_SECRET');
    check('وضع الرمز بلا حالة مُعلن', health.persistence?.challengeMode === 'stateless-hmac');
    check('الصحة لا تسرّب المفتاح', !JSON.stringify(health).includes(TEST_SECRET));

    const code = issueChallengeCode(OWNER_EMAIL, secretBuffer);
    const verified = await fetch(`${BASE}/api/auth/verify-challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: OWNER_EMAIL, code }),
    });
    const verifiedBody = await verified.json();
    check('تحقق المالك ينجح بالرمز المشتق (بلا حالة)', verified.status === 200 && Boolean(verifiedBody.token), `status=${verified.status}`);
    const token: string = verifiedBody.token || '';
    check('التوكن موقّع وليس عشوائياً فقط (يحتوي جزأين)', token.split('.').length === 2, token.slice(0, 24));

    const meBefore = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    check('الجلسة تعمل في العملية المُصدِرة', meBefore.status === 200, `status=${meBefore.status}`);
    const meBody = await meBefore.json();
    check('دور المالك صحيح من قاعدة البيانات', meBody.user?.role === 'owner');

    // ---- إعادة تشغيل في عملية أخرى تماماً: قلب المشكلة السابقة ----
    await stop(appA.proc);
    appA = null;

    appB = startApp(PORT, dirB, TEST_SECRET);
    check('الخادم الثاني (عملية جديدة) يقلع', await waitForHealth(BASE), appB.log().slice(0, 400));

    const meAfterRestart = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    check('★ الجلسة تبقى صالحة بعد إعادة التشغيل في عملية أخرى', meAfterRestart.status === 200, `status=${meAfterRestart.status}`);

    // ---- مفتاح مختلف يجب أن يرفض التوكن ----
    await stop(appB.proc);
    appB = null;

    appC = startApp(PORT, dirB, OTHER_SECRET);
    check('الخادم الثالث يقلع', await waitForHealth(BASE), appC.log().slice(0, 400));

    const meWrongSecret = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    check('توكن من مفتاح آخر يُرفض 401', meWrongSecret.status === 401, `status=${meWrongSecret.status}`);

    const tampered = token.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
    const meTampered = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${tampered}` } });
    check('توكن مُعدَّل يُرفض 401', meTampered.status === 401, `status=${meTampered.status}`);

    // ---- إبطال عبر تسجيل الخروج: يعمل في العملية نفسها بعد إعادة التشغيل ----
    await stop(appC.proc);
    appC = null;

    appA = startApp(PORT, dirB, TEST_SECRET);
    await waitForHealth(BASE);

    const code2 = issueChallengeCode(OWNER_EMAIL, secretBuffer);
    const reLogin = await fetch(`${BASE}/api/auth/verify-challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: OWNER_EMAIL, code: code2 }),
    });
    const reToken: string = (await reLogin.json()).token || '';

    const logout = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${reToken}` } });
    check('تسجيل الخروج ينجح', logout.status === 200);

    const meAfterLogout = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${reToken}` } });
    check('التوكن المُبطَل يُرفض بعد تسجيل الخروج', meAfterLogout.status === 401, `status=${meAfterLogout.status}`);

    // ---- إبطال يبقى سارياً بعد إعادة التشغيل (يُحفظ على القرص) ----
    await stop(appA.proc);
    appA = null;
    appB = startApp(PORT, dirB, TEST_SECRET);
    await waitForHealth(BASE);
    const meAfterRevokeRestart = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${reToken}` } });
    check('الإبطال يستمر بعد إعادة التشغيل', meAfterRevokeRestart.status === 401, `status=${meAfterRevokeRestart.status}`);

    // ---- عقد مسارات API: JSON 404 لا HTML ----
    const unknown = await fetch(`${BASE}/api/definitely-not-a-route`);
    const unknownType = unknown.headers.get('content-type') || '';
    const unknownBody = await unknown.text();
    check('مسار API مجهول يعيد 404', unknown.status === 404, `status=${unknown.status}`);
    check('مسار API مجهول يعيد JSON لا HTML', unknownType.includes('application/json') && !unknownBody.trim().startsWith('<'), `type=${unknownType}`);
    check('رد 404 لا يسرب مفتاحاً', !unknownBody.includes(TEST_SECRET));

    const wrongMethod = await fetch(`${BASE}/api/ai/verify-provider`);
    const wrongMethodBody = await wrongMethod.text();
    check('GET على مسار AI محمي لا يُرجع HTML 200', !wrongMethodBody.trim().startsWith('<'), wrongMethodBody.slice(0, 80));
    check('طريقة غير مصرح بها بلا جلسة تُرفض', wrongMethod.status === 404 || wrongMethod.status === 401 || wrongMethod.status === 405, `status=${wrongMethod.status}`);
  } finally {
    for (const app of [appA, appB, appC]) { try { if (app) await stop(app.proc); } catch { /* أُوقف سابقاً */ } }
    try { rmSync(dirA, { recursive: true, force: true }); } catch { /* تنظيف */ }
    try { rmSync(dirB, { recursive: true, force: true }); } catch { /* تنظيف */ }
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} session durability checks`);
  }
}

run().catch((err) => {
  console.error('Session durability harness crashed:', err);
  process.exit(1);
});