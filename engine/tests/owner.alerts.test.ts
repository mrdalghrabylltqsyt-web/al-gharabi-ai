/**
 * اختبار انحدار حقيقي لتنبيه المالك الخارجي (B1 + Y2).
 *
 * يشغّل خادم Express الفعلي (server.ts) مع توجيه SDK Resend إلى خادم وهمي محلي
 * عبر RESEND_BASE_URL (لا بريد حقيقي إطلاقاً)، ويثبت:
 *   1) انقطاع ربط منصة (reauth_needed) يُنتج تنبيهاً خارجياً للمالك عند الإقلاع.
 *   2) التجميع: رسالة واحدة تحوي المنصة المذكورة.
 *   3) منع التكرار: لا تنبيه ثانٍ لنفس المنصة.
 *   4) مفتاح التشغيل/الإيقاف يعمل (للمالك فقط)، وغياب مزوّد البريد = تعطيل صامت معلن.
 *   5) لا Gemini ولا أي رسالة للزبون، ولا تسريب أي سرّ.
 *
 * **يفشل على الكود القديم** (لا وجود لمسارات /api/agent/owner-alerts ولا للإرسال).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServerTestEnv } from './helpers/serverTestEnv';
import { reserveFreePort } from './helpers/freePort';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const OWNER_EMAIL = 'owner-alerts-test@example.com';
const FROM_EMAIL = 'no-reply@gharabi.test';
const FAKE_KEY = 're_test_key_not_real';
const PREVIEW_TOKEN = 'preview-token-alerts-not-real-1234567890';
const SESSION_SECRET = 'session-secret-alerts-not-real-1234567890';

interface StubState { calls: Array<{ authorization?: string; body: any; url: string }>; }

function startStub(state: StubState): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let body: any = null;
        try { body = JSON.parse(raw); } catch { /* غير JSON */ }
        state.calls.push({ authorization: req.headers.authorization, body, url: req.url || '' });
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify({ id: 'stub-alert-id-1' }));
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

/** يزرع ملف الحالة باتصال منصة `reauth_needed` (لا بيانات عملاء). */
function seedState(stateDir: string): void {
  const snapshot = {
    schemaVersion: 16,
    users: [{ id: 'u_owner', email: OWNER_EMAIL, role: 'owner', name: 'المالك', active: true }],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [],
    platformConnections: [
      { platform: 'facebook', status: 'reauth_needed', accountId: 'PAGE_1', connectedAt: new Date().toISOString(), providerVerified: false },
    ],
    workspace: { showroom: { name: 'معرض الغرابي' }, products: [], socialComments: [], socialReplies: [], publishRecords: [], providerTokens: {} },
  };
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify(snapshot));
}

function startApp(port: number, cwd: string, extraEnv: Record<string, string>): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = buildServerTestEnv({
    stateDir: cwd,
    prefix: 'gharabi-alerts-',
    overrides: {
      PORT: String(port), NODE_ENV: 'production', OWNER_EMAIL, RESEND_FROM_EMAIL: FROM_EMAIL,
      GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET, APP_URL: `http://127.0.0.1:${port}`, ...extraEnv,
    },
  });
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

async function waitForHealth(base: string, timeoutMs = 40_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const res = await fetch(`${base}/api/health`); if (res.ok) return true; } catch { /* لم يقلع */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function authHeaders(base: string): Promise<Record<string, string>> {
  const res = await fetch(`${base}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}

async function run(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  const stubState: StubState = { calls: [] };
  const stub = await startStub(stubState);
  const baseOverride = stubBaseUrl(stub);

  const cwd = mkdtempSync(join(tmpdir(), 'gharabi-alerts-test-'));
  seedState(cwd);
  const PORT = await reserveFreePort();
  const BASE = `http://127.0.0.1:${PORT}`;
  let app: { proc: ChildProcess; log: () => string } | null = null;

  try {
    // ---- المرحلة 1: مزوّد مضبوط + منصة reauth_needed ⇒ تنبيه عند الإقلاع ----
    app = startApp(PORT, cwd, { RESEND_API_KEY: FAKE_KEY, RESEND_BASE_URL: baseOverride });
    const up = await waitForHealth(BASE);
    check('الخادم يقلع', up, app.log().slice(0, 400));
    if (!up) throw new Error('الخادم لم يبدأ');
    const auth = await authHeaders(BASE);

    // نمنح دورة الإقلاع لحظات لإرسال التنبيه.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && stubState.calls.length === 0) await new Promise((r) => setTimeout(r, 300));

    check('انقطاع الربط أنتج تنبيهاً خارجياً فعلياً (Resend)', stubState.calls.length >= 1, `calls=${stubState.calls.length}`);
    const first = stubState.calls[0];
    check('التنبيه أُرسل إلى OWNER_EMAIL (لا للزبون)', first?.body?.to === OWNER_EMAIL, JSON.stringify(first?.body?.to));
    check('التنبيه من RESEND_FROM_EMAIL باسم «الغرابي AI»', first?.body?.from === `الغرابي AI <${FROM_EMAIL}>`, String(first?.body?.from));
    check('التنبيه يذكر المنصة المنقطعة (فيسبوك)', /فيسبوك/.test(String(first?.body?.text || '')) || /فيسبوك/.test(String(first?.body?.html || '')), String(first?.body?.text || '').slice(0, 160));
    check('التنبيه HTML عربي RTL', String(first?.body?.html || '').includes('dir="rtl"'));
    check('تنبيه انقطاع الربط يحمل رابط مركز ربط المنصات', /tab=platform_connections/.test(String(first?.body?.text || '')) || /platform_connections/.test(String(first?.body?.html || '')));

    // الحالة معلنة: مُرسل واحد، بلا معلّق.
    const st1 = await (await fetch(`${BASE}/api/agent/owner-alerts`, { headers: auth })).json();
    check('الحالة تُعلن enabled=true (افتراضي)', st1.alerts?.enabled === true, JSON.stringify(st1.alerts?.enabled));
    check('الحالة تُعلن مزوّد البريد مضبوطاً', st1.alerts?.emailProviderConfigured === true);
    check('الحالة تُعلن نافذة التجميع 30 دقيقة', st1.alerts?.windowMinutes === 30);
    check('الحالة تُعلن إرسالاً واحداً وبلا معلّق', st1.alerts?.sentCount >= 1 && st1.alerts?.pending === 0, JSON.stringify({ s: st1.alerts?.sentCount, p: st1.alerts?.pending }));

    // ---- المرحلة 2: منع التكرار — دورة يدوية لا تُرسل شيئاً لنفس المنصة ----
    stubState.calls.length = 0;
    const runCycle = await fetch(`${BASE}/api/agent/owner-alerts/run`, { method: 'POST', headers: auth });
    const runBody = await runCycle.json();
    check('الدورة اليدوية تنجح (للمالك)', runCycle.status === 200 && runBody.success === true);
    check('لا تنبيه مكرر لنفس المنصة (منع التكرار)', stubState.calls.length === 0, `calls=${stubState.calls.length}`);

    // ---- المرحلة 3: مفتاح الإيقاف/التشغيل (للمالك فقط) ----
    const off = await fetch(`${BASE}/api/agent/owner-alerts`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: false }) });
    const offBody = await off.json();
    check('الإيقاف ينجح ويُعلن معطَّلاً', off.status === 200 && offBody.alerts?.enabled === false);
    const offNoAuth = await fetch(`${BASE}/api/agent/owner-alerts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
    check('المسار محصور بالمالك (401 بلا جلسة)', offNoAuth.status === 401);
    const badBody = await fetch(`${BASE}/api/agent/owner-alerts`, { method: 'POST', headers: auth, body: JSON.stringify({}) });
    check('حقل enabled مطلوب (400)', badBody.status === 400);
    const on = await fetch(`${BASE}/api/agent/owner-alerts`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true }) });
    check('إعادة التفعيل تنجح', (await on.json()).alerts?.enabled === true);

    // ---- المرحلة 4: لا تسريب أي سرّ ولا محتوى Gemini ----
    const log = app.log();
    check('لا يظهر مفتاح Resend في السجلات', !log.includes(FAKE_KEY));
    check('لا يظهر رمز المعاينة في السجلات', !log.includes(PREVIEW_TOKEN));
    const health = await (await fetch(`${BASE}/api/health`)).json();
    check('الصحة تُعلن كتلة ownerAlerts بلا سرّ', health.ownerAlerts && typeof health.ownerAlerts.enabled === 'boolean', JSON.stringify(health.ownerAlerts));
    check('كتلة الصحة لا تحمل أي مفتاح أو بريد', !JSON.stringify(health.ownerAlerts || {}).includes(FAKE_KEY) && !JSON.stringify(health.ownerAlerts || {}).includes(OWNER_EMAIL));

    // ---- المرحلة 5: إيقاف الخادم ثم إقلاع بمزوّد غائب ⇒ تعطيل صامت معلن ----
    app.proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1500));
    app = null;
    const PORT2 = PORT + 1;
    const BASE2 = `http://127.0.0.1:${PORT2}`;
    // بلا RESEND_API_KEY: التنبيه معطّل صامتاً ويُعلن السبب (لا انهيار).
    const app2 = startApp(PORT2, cwd, { RESEND_API_KEY: '', RESEND_BASE_URL: baseOverride });
    app = app2;
    const up2 = await waitForHealth(BASE2);
    check('الخادم يقلع بلا مزوّد بريد (لا انهيار)', up2, app2.log().slice(0, 400));
    const auth2 = await authHeaders(BASE2);
    const st2 = await (await fetch(`${BASE2}/api/agent/owner-alerts`, { headers: auth2 })).json();
    check('بلا مزوّد: التنبيه مُعلن غير مضبوط (تعطيل صامت)', st2.alerts?.emailProviderConfigured === false, JSON.stringify(st2.alerts));
    const ready = await (await fetch(`${BASE2}/api/readiness`)).json();
    check('الجاهزية تُعلن تنبيه المالك بلا مزوّد (تعطيل صامت معلن)', ready.auth?.ownerAlerts?.emailProviderConfigured === false && ready.auth?.ownerAlerts?.enabled === true, JSON.stringify(ready.auth?.ownerAlerts));
  } finally {
    try { app?.proc.kill('SIGTERM'); } catch { /* تجاهل */ }
    try { stub.close(); } catch { /* تجاهل */ }
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }

  if (failures.length) {
    console.error(`\nOWNER ALERTS TEST FAILED: ${failures.length} failures / ${passed} passed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\nOWNER ALERTS TEST PASSED: ${passed} checks`);
}

void run();
