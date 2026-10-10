/**
 * Phase 1 — Security hardening regression tests.
 *
 * يثبت سلوكاً أمنياً حقيقياً على نسخة الإنتاج المبنية (dist/server.cjs):
 * - SEC-02: /api/webhooks/:platform يتحقق من HMAC على الجسم الخام الحقيقي
 *   (req.rawBody) لا على إعادة تسلسل JSON، ويقبل التوقيع الصحيح ويرفض الخاطئ،
 *   ولا يمكن تجاوز التحقق بإعادة تسلسل مطابق.
 * - SEC-03: CSP مضبوطة في الإنتاج مع عدم كسر الواجهة/الـAPI.
 * - SEC-04: maps المصادقة مقيّدة (rate limit فعّال، لا نمو غير محدود).
 * - OBS-01: /api/health و/api/readiness لا يكشفان أي قيمة سرّية.
 *
 * يُشغَّل على النسخة المبنية، لذا شغّل `npm run build` قبله.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import crypto from 'node:crypto';
import { buildServerTestEnv } from './helpers/serverTestEnv';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const PORT = 4744;
const BASE = `http://127.0.0.1:${PORT}`;
const WEBHOOK_SECRET = 'phase1-webhook-secret-' + 'z'.repeat(24);

async function waitForServer(timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function hmacHex(secret: string, raw: string): string {
  return crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
}

async function run(): Promise<void> {
  if (!existsSync('dist/server.cjs')) {
    console.error('dist/server.cjs غير موجود — شغّل npm run build أولاً.');
    process.exit(1);
  }
  const server: ChildProcess = spawn('node', ['dist/server.cjs'], {
    env: buildServerTestEnv({ prefix: 'gharabi-security-hardening-', overrides: { PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE, WEBHOOK_SECRET } }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout?.on('data', (d) => { log += String(d); });
  server.stderr?.on('data', (d) => { log += String(d); });

  try {
    const up = await waitForServer();
    check('server started', up, log.slice(-300));
    if (!up) return;

    // ---------------- SEC-02: webhook raw-body HMAC ----------------
    // الجسم مُرسل بمسافات/أسطر تجعل JSON.stringify يختلف عن البايتات المرسلة.
    const rawBody = '{\n  "type": "test_event",\n  "data": { "n": 1, "ok": true }\n}';
    const goodSig = hmacHex(WEBHOOK_SECRET, rawBody);
    const badSig = hmacHex('wrong-secret', rawBody);
    // معرّفات فريدة لكل تشغيل (الحالة الدائمة تعيش بين التشغيلات، فلا يُعدّ الحدث مكرراً).
    const run = crypto.randomBytes(6).toString('hex');

    const accept = await fetch(`${BASE}/api/webhooks/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gharabi-signature': goodSig, 'x-event-id': `p1-accept-${run}` },
      body: rawBody,
    });
    check('SEC-02 valid raw-body signature accepted (202)', accept.status === 202, `status=${accept.status}`);

    const rejectBad = await fetch(`${BASE}/api/webhooks/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gharabi-signature': badSig, 'x-event-id': `p1-bad-${run}` },
      body: rawBody,
    });
    check('SEC-02 invalid signature rejected (401)', rejectBad.status === 401, `status=${rejectBad.status}`);

    // إعادة التسلسل المطابق (compact JSON) موقّعة صحيحاً لكنها تختلف عن البايتات
    // المرسلة: يجب أن تُرفض لأن التحقق على الجسم الخام لا على إعادة التسلسل.
    const compact = JSON.stringify(JSON.parse(rawBody));
    const reserializedSig = hmacHex(WEBHOOK_SECRET, compact);
    const rejectReserialized = await fetch(`${BASE}/api/webhooks/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gharabi-signature': reserializedSig, 'x-event-id': `p1-reser-${run}` },
      body: rawBody,
    });
    check('SEC-02 raw-body mismatch cannot bypass verification (401)', rejectReserialized.status === 401, `status=${rejectReserialized.status}`);

    const missingSig = await fetch(`${BASE}/api/webhooks/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-event-id': `p1-nosig-${run}` },
      body: rawBody,
    });
    check('SEC-02 missing signature rejected (401)', missingSig.status === 401, `status=${missingSig.status}`);

    // ---------------- SEC-03: CSP header ----------------
    const healthRes = await fetch(`${BASE}/api/health`);
    const csp = healthRes.headers.get('content-security-policy') || '';
    check('SEC-03 CSP present in production', csp.length > 0);
    check('SEC-03 CSP restricts default-src to self', /default-src 'self'/.test(csp), csp.slice(0, 80));
    check('SEC-03 CSP forbids framing', /frame-ancestors 'none'/.test(csp));
    check('SEC-03 CSP allows Google Sign-In script origin', /script-src[^;]*accounts\.google\.com/.test(csp));
    check('SEC-03 other security headers intact', healthRes.headers.get('x-content-type-options') === 'nosniff' && healthRes.headers.get('x-frame-options') === 'DENY');
    const spaRes = await fetch(`${BASE}/`);
    check('SEC-03 SPA root still served (200)', spaRes.status === 200);

    // ---------------- SEC-04: bounded auth maps ----------------
    // /api/auth/google يقبل التحديد: 12 محاولة ثم 429 (نفس IP).
    let saw429 = false;
    for (let i = 0; i < 16; i += 1) {
      const r = await fetch(`${BASE}/api/auth/google`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'x' }),
      });
      if (r.status === 429) { saw429 = true; break; }
    }
    check('SEC-04 auth attempt rate limit enforced (429)', saw429);

    // ---------------- SEC-04b: OTP verify rate limit ----------------
    // /api/auth/verify-challenge كان بلا حدّ محاولات (رمز 6 أرقام): يُثبت الآن
    // أنه يحدّ التخمين (10 محاولات لكل IP+بريد ثم 429)، وبريد فريد لكل تشغيل.
    const otpEmail = `otp-guard-${run}@example.invalid`;
    let sawOtp429 = false;
    for (let i = 0; i < 14; i += 1) {
      const r = await fetch(`${BASE}/api/auth/verify-challenge`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: otpEmail, code: '000000' }),
      });
      if (r.status === 429) { sawOtp429 = true; break; }
    }
    check('SEC-04b OTP verify rate limit enforced (429)', sawOtp429);

    // ---------------- OBS-01: no secret leakage ----------------
    const healthText = await (await fetch(`${BASE}/api/health`)).text();
    const readinessText = await (await fetch(`${BASE}/api/readiness`)).text();
    for (const [label, text] of [['health', healthText], ['readiness', readinessText]] as const) {
      check(`OBS-01 ${label} does not leak WEBHOOK_SECRET`, !text.includes(WEBHOOK_SECRET));
      check(`OBS-01 ${label} has no obvious secret keys`, !/"(client_secret|clientSecret|api_key|apiKey|refresh_token|refreshToken|access_token|accessToken|private_key)"\s*:\s*"[^"]/.test(text));
    }
  } finally {
    server.kill('SIGKILL');
  }
}

run()
  .then(() => {
    console.log(`PASSED: ${passed} Phase-1 security hardening checks`);
    if (failures.length) {
      console.error('FAILURES:');
      for (const f of failures) console.error(`  - ${f}`);
      process.exit(1);
    }
  })
  .catch((e) => { console.error('Phase-1 test crashed:', e); process.exit(1); });
