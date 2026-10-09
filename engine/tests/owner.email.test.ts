/**
 * اختبار حقيقي لإرسال رمز تحقق المالك بالبريد عبر Resend.
 *
 * لا يرسل أي بريد حقيقي: يشغّل خادم Express الفعلي (server.ts) مع توجيه SDK
 * Resend إلى خادم وهمي محلي عبر RESEND_BASE_URL (متغير يدعمه SDK رسمياً)،
 * ويختبر مسار OTP كاملاً: النجاح، فشل الإرسال، غياب المفتاح، وحالة الإعداد.
 *
 * الخادم يعمل من مجلد مؤقت حتى لا تُكتب ملفات حالة في المستودع.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const OWNER_EMAIL = 'owner-otp-test@example.com';
const FROM_EMAIL = 'no-reply@gharabi.test';
const FAKE_KEY = 're_test_key_not_real';

interface StubState {
  mode: 'success' | 'error' | 'network';
  calls: Array<{ authorization?: string; body: any; url: string }>;
}

/** خادم وهمي يقلّد Resend API، ويُعيد رموز فشل حقيقية عند الطلب. */
function startStub(state: StubState): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let body: any = null;
        try { body = JSON.parse(raw); } catch { /* جسم غير JSON */ }
        state.calls.push({ authorization: req.headers.authorization, body, url: req.url || '' });
        res.setHeader('Content-Type', 'application/json');
        if (state.mode === 'network') {
          res.statusCode = 500;
          res.end(JSON.stringify({ name: 'application_error', message: 'stub network failure' }));
          return;
        }
        if (state.mode === 'error') {
          res.statusCode = 403;
          res.end(JSON.stringify({ name: 'invalid_from_address', message: 'from not verified' }));
          return;
        }
        res.statusCode = 200;
        res.end(JSON.stringify({ id: 'stub-email-id-123' }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function stubBaseUrl(server: http.Server): string {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return `http://127.0.0.1:${port}`;
}

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');

function startApp(port: number, cwd: string, extraEnv: Record<string, string>): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    NODE_ENV: 'production',
    OWNER_EMAIL,
    RESEND_FROM_EMAIL: FROM_EMAIL,
    ...extraEnv,
    APP_URL: `http://127.0.0.1:${port}`,
  };
  // مفتاح اختبار وهمي — ليس مفتاحاً حقيقياً ولا سراً.
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

async function waitForHealth(base: string, timeoutMs = 40_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return true;
    } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function run(): Promise<void> {
  if (!existsSync(tsxCli)) {
    console.error('tsx CLI غير موجود — شغّل npm install أولاً.');
    process.exit(1);
  }

  const stubState: StubState = { mode: 'success', calls: [] };
  const stub = await startStub(stubState);
  const baseOverride = stubBaseUrl(stub);

  const cwd = mkdtempSync(join(tmpdir(), 'gharabi-email-test-'));
  const PORT = 4811 + Math.floor(Math.random() * 400);
  const BASE = `http://127.0.0.1:${PORT}`;

  let app: { proc: ChildProcess; log: () => string } | null = null;

  try {
    // ---- المرحلة 1: المفتاح + From مضبوطان، والإرسال ينجح عبر الخادم الوهمي ----
    stubState.mode = 'success';
    app = startApp(PORT, cwd, { RESEND_API_KEY: FAKE_KEY, RESEND_BASE_URL: baseOverride });
    const up = await waitForHealth(BASE);
    check('الخادم يقلع ويستجيب للفحص الصحي', up, app.log().slice(0, 400));
    if (!up) throw new Error('الخادم لم يبدأ');

    const health = await (await fetch(`${BASE}/api/health`)).json();
    check('/api/health ما زال 200 ويعيد ok', health.status === 'ok');
    check('الفحص الصحي لا يسرّب المفتاح', !app.log().includes(FAKE_KEY) && !JSON.stringify(health).includes(FAKE_KEY));
    // كتلة تشخيص إعداد البريد (منطقية فقط): تُعلن المضبوط بلا كشف أي قيمة سرّية.
    check('/api/health يُعلن حالة إعداد البريد (منطقي)', health.ownerEmail?.providerConfigured === true && health.ownerEmail?.fromConfigured === true && health.ownerEmail?.ownerConfigured === true, JSON.stringify(health.ownerEmail));
    check('/api/health لا يسرب مفتاح البريد ولا بريد المُرسِل', !JSON.stringify(health.ownerEmail || {}).includes(FAKE_KEY) && !JSON.stringify(health.ownerEmail || {}).includes(FROM_EMAIL));

    // نجاح الإرسال: 200، ورسالة النجاح العربية، ونسخة واحدة إلى Resend فقط.
    const sent = await fetch(`${BASE}/api/auth/request-owner-challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: OWNER_EMAIL }),
    });
    const sentBody = await sent.json();
    check('طلب OTP ينجح عند نجاح Resend (200)', sent.status === 200, `status=${sent.status}`);
    check('رسالة القبول تطابق نص الواجهة المطلوب', sentBody.success === true && sentBody.message === 'قَبِل مزوّد البريد طلب الإرسال — تحقّق من صندوق الوارد (والمهملات) للبريد المعتمد.', JSON.stringify(sentBody));
    check('الاستجابة تُعلن إصدار الرمز وقبول المزود (بلا ادّعاء تسليم)', sentBody.codeIssued === true && sentBody.providerAccepted === true, JSON.stringify(sentBody));
    check('الاستجابة لا تُرجع الرمز إطلاقاً', !/\b\d{6}\b/.test(JSON.stringify(sentBody)));
    check('لم يُرسل سوى طلب واحد إلى Resend (بلا retry)', stubState.calls.length === 1, `calls=${stubState.calls.length}`);
    const call = stubState.calls[0];
    check('الطلب ذهب إلى /emails على المزود', (call?.url || '').includes('/emails'), call?.url);
    check('التوجيه استخدم Authorization من المفتاح دون طبعه', call?.authorization === `Bearer ${FAKE_KEY}`);
    check('الرسالة أُرسلت إلى OWNER_EMAIL المعرّف في البيئة', call?.body?.to === OWNER_EMAIL, JSON.stringify(call?.body?.to));
    check('الرسالة أُرسلت من RESEND_FROM_EMAIL المعرّف في البيئة', call?.body?.from === FROM_EMAIL, String(call?.body?.from));
    check('الرسالة تحتوي رمزاً مكوّناً من 6 أرقام', /\b\d{6}\b/.test(String(call?.body?.html || '')));
    check('الرسالة HTML عربية (dir=rtl)', String(call?.body?.html || '').includes('dir="rtl"') && String(call?.body?.html || '').includes('lang="ar"'));
    check('السجل لا يحتوي المفتاح ولا الرمز', !app.log().includes(FAKE_KEY) && !/\b\d{6}\b/.test(app.log().replace(/[^\d]/g, ' ')));

    const emailStatus = await (await fetch(`${BASE}/api/system/email-status`)).text();
    check('حالة البريد محمية بالمالك (401 بلا جلسة)', (await fetch(`${BASE}/api/system/email-status`)).status === 401);

    // ---- المرحلة 1ب: بريد غير مطابق لـOWNER_EMAIL — نجاح كاذب سابقاً (العطل المُثبت) ----
    // العطل: رسالة «تم إصدار رمز التحقق بنجاح» كانت تُعرض لبريد لا يطابق OWNER_EMAIL،
    // فلا يُنشأ رمز ولا يُستدعى Resend، فيبدو العطل كأن البريد لم يصل. الآن: لا إصدار
    // رمز ظاهر، ولا استدعاء للمزود، والرد محايد يمنع كشف وجود حساب المالك.
    stubState.calls.length = 0;
    const mismatch = await fetch(`${BASE}/api/auth/request-owner-challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'someone-else@example.com' }),
    });
    const mismatchBody = await mismatch.json();
    check('بريد غير مطابق: لا ادّعاء إصدار رمز', mismatch.status === 200 && mismatchBody.success === true && mismatchBody.codeIssued === false, JSON.stringify(mismatchBody));
    check('بريد غير مطابق: لا استدعاء لمزوّد البريد إطلاقاً', stubState.calls.length === 0, `calls=${stubState.calls.length}`);
    check('بريد غير مطابق: رسالة محايدة لا تكشف وجود حساب المالك', !/مسجل/.test(mismatchBody.message) && /البريد المعتمد/.test(mismatchBody.message), mismatchBody.message);
    // حماية منع الكشف: رد البريد المطابق وغير المطابق متطابقان شكلاً (success:true)،
    // والفرق الوحيد codeIssued — لا كشف مباشر لوجود حساب المالك.
    check('منع كشف الحساب: كلاهما success:true بلا رسالة خطأ', mismatchBody.success === true && sentBody.success === true);

    // ---- المرحلة 2: فشل Resend (403) يجب ألا يدّعي النجاح ----
    stubState.mode = 'error';
    stubState.calls.length = 0;
    const failed = await fetch(`${BASE}/api/auth/request-owner-challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: OWNER_EMAIL }),
    });
    const failedBody = await failed.json();
    check('فشل Resend لا يعيد نجاحاً', failedBody.success !== true && failed.status >= 400, `status=${failed.status} body=${JSON.stringify(failedBody)}`);
    check('رسالة الفشل تطابق نص الواجهة المطلوب', failedBody.error === 'تعذر إرسال رمز التحقق، حاول مرة أخرى', JSON.stringify(failedBody));
    check('لا يُرجع الرمز عند الفشل', !/\b\d{6}\b/.test(JSON.stringify(failedBody)));
    // كود السبب غير السرّي: يكشف سبب فشل الإرسال بلا أي قيمة (بريد/مفتاح/رمز).
    check('فشل المزود يُعلن كود السبب الفعلي', failedBody.reason === 'invalid_from_address', JSON.stringify(failedBody.reason));
    check('سبب الفشل لا يحمل بريداً ولا مفتاحاً ولا رمزاً',
      !String(failedBody.reason || '').includes('@') &&
      !String(failedBody.reason || '').includes(FAKE_KEY) &&
      !/\b\d{6}\b/.test(String(failedBody.reason || '')),
      JSON.stringify(failedBody.reason));

    // ---- المرحلة 3: غياب RESEND_API_KEY يجب أن يفشل بوضوح ----
    app.proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 700));
    const cwd2 = mkdtempSync(join(tmpdir(), 'gharabi-email-nokey-'));
    const PORT2 = PORT + 1;
    const BASE2 = `http://127.0.0.1:${PORT2}`;
    const app2 = startApp(PORT2, cwd2, { RESEND_API_KEY: '', RESEND_BASE_URL: baseOverride });
    try {
      const up2 = await waitForHealth(BASE2);
      check('الخادم يقلع دون مفتاح بريد', up2);
      if (up2) {
        const noKey = await fetch(`${BASE2}/api/auth/request-owner-challenge`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: OWNER_EMAIL }),
        });
        const noKeyBody = await noKey.json();
        check('غياب المفتاح يفشل بوضوح لا يدّعي النجاح', noKey.status >= 400 && noKeyBody.success !== true, `status=${noKey.status}`);
        check('غياب المفتاح يعيد رسالة الفشل العربية', noKeyBody.error === 'تعذر إرسال رمز التحقق، حاول مرة أخرى');
        // السبب يسمّي نقص الإعداد بدقة (اسم المتغيّر المنطقي) بلا قيمة سرّية.
        check('غياب المفتاح يُعلن سبباً صريحاً غير سرّي', noKeyBody.reason === 'email_provider_not_configured', JSON.stringify(noKeyBody.reason));
      }
    } finally {
      app2.proc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
      try { rmSync(cwd2, { recursive: true, force: true }); } catch {}
    }

    console.log('\n' + '='.repeat(60));
    if (failures.length) {
      console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
      for (const f of failures) console.error(`  ✗ ${f}`);
      process.exitCode = 1;
    } else {
      console.log(`PASSED: ${passed} owner email OTP checks`);
    }
  } finally {
    try { app?.proc.kill('SIGTERM'); } catch {}
    await new Promise((r) => setTimeout(r, 500));
    try { stub.close(); } catch {}
    try { rmSync(cwd, { recursive: true, force: true }); } catch {}
  }
}

run().catch((err) => {
  console.error('Email harness crashed:', err);
  process.exit(1);
});
