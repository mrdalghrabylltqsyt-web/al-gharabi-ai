/**
 * اختبار تكاملي — مسار استضافة الفيديو العام `POST /api/workspace/content/video/host`
 * (Task: تعليق رفع الفيديو إلى Drive بلا نهاية).
 *
 * يثبت (fail-old / pass-new) على خادم حقيقي فعلي:
 *  - Drive متعثّر تماماً (لا يستجيب أبداً) => الخادم يرد بخطأ واضح خلال مهلة
 *    محدودة (لا تعليق بلا نهاية) بدل أن يبقى الطلب معلّقاً للأبد.
 *  - الحالة الطبيعية: فيديو 2 ميغابايت ينتهي خلال ثوانٍ برابط عام حقيقي.
 *  - /api/health يعرض تشخيصاً تقنياً بلا أسرار ولا استعلامات (عناوين فقط).
 *  - المسار محمي بالمصادقة (401 بلا جلسة).
 * كل ذلك بخادمي وهمي محلي (Drive + رمز OAuth) بلا أي مزود حقيقي ولا سرّ.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createFakeDriveState, fakeDriveTransport } from './helpers/fakeDrive';
import { encryptDriveSecret } from '../../../tools/dr/drive-auth.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const APP_PORT = 7320 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const DRIVE_PORT = 7420 + Math.floor(Math.random() * 40);
const DRIVE_BASE = `http://127.0.0.1:${DRIVE_PORT}`;
const TOKEN_PORT = 7520 + Math.floor(Math.random() * 40);
const TOKEN_BASE = `http://127.0.0.1:${TOKEN_PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'drive-timeout-test-secret-not-real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const GO_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
const GO_CLIENT_SECRET = 'test-google-client-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-drive-host-'));

let proc: ChildProcess | null = null;
let log = '';
let driveServer: Server | null = null;
let tokenServer: Server | null = null;
let hangMode = false;
const driveState = createFakeDriveState();

/** فيديو صالح (توقيع ftyp) بحجم حقيقي؛ `salt` يغيّر البايتات فيتجاوز كاش الرفع. */
function makeVideo(bytes: number, salt = 0): string {
  return Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(Math.max(0, bytes - 13), 7 & (salt || 7)), Buffer.from([salt & 0xff])]).toString('base64');
}

/** خادم Drive وهمي: يفوّض إلى fakeDriveTransport، ويدعم وضع «تعثّر دائم». */
function startDriveMock(): Promise<void> {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      const url = `http://127.0.0.1:${DRIVE_PORT}${req.url}`;
      if (req.url === '/__hang') { hangMode = true; res.writeHead(200).end('ok'); return; }
      if (req.url === '/__reset') { hangMode = false; res.writeHead(200).end('ok'); return; }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks);
      if (hangMode) {
        // لا نُغلق ولا نرد أبداً — محاكاة تعثّر شبكة/TLS كامل. الاتصال يُترك معلّقاً.
        req.socket.setTimeout(0);
        return;
      }
      try {
        const out = await fakeDriveTransport(driveState, { method: req.method, url, headers: req.headers, body: body.length ? body : undefined });
        res.writeHead(out.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out.data));
      } catch (e: any) {
        res.writeHead(500).end(JSON.stringify({ error: String(e?.message || e) }));
      }
    });
    driveServer = srv;
    srv.listen(DRIVE_PORT, '127.0.0.1', () => resolve());
  });
}

/** خادم رمز OAuth وهمي: يعيد رمز وصول صالحاً فوراً (بلا Google). */
function startTokenMock(): Promise<void> {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      for await (const _c of req) { /* نستهلك الجسم */ }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'ya29.fake-drive-access-token', expires_in: 3600, token_type: 'Bearer' }));
    });
    tokenServer = srv;
    srv.listen(TOKEN_PORT, '127.0.0.1', () => resolve());
  });
}

function startApp(): void {
  log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    DRIVE_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    DRIVE_OAUTH_CLIENT_ID: GO_CLIENT_ID, DRIVE_OAUTH_CLIENT_SECRET: GO_CLIENT_SECRET,
    DRIVE_API_BASE: DRIVE_BASE,
    DRIVE_OAUTH_TOKEN_URL: `${TOKEN_BASE}/token`,
    // مهلة إجمالية قصيرة للاختبار: نريد إثبات الرد الواضح السريع لا الانتظار الطويل.
    DRIVE_HOST_TIMEOUT_MS: '1500',
    DRIVE_HOST_CALL_TIMEOUT_MS: '1000',
    DRIVE_REQUEST_TIMEOUT_MS: '900',
  };
  delete env.GEMINI_API_KEY; delete env.DATABASE_URL;
  proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
}
async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function login(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}
async function host(auth: Record<string, string> | null, b64: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) Object.assign(headers, auth);
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/workspace/content/video/host`, { method: 'POST', headers, body: JSON.stringify({ videoBase64: b64, mimeType: 'video/mp4', filename: 'clip.mp4' }) });
  return { res, elapsed: Date.now() - t0, body: await res.json().catch(() => ({})) };
}

async function main(): Promise<void> {
  await startDriveMock();
  await startTokenMock();
  // بذور رمز التجديد المشفّر في مفتاح control قبل الإقلاع (نفس مسار الإنتاج).
  const encrypted = encryptDriveSecret('1//fake-drive-refresh-token-not-real', { DRIVE_TOKEN_ENCRYPTION_KEY: TOKEN_KEY } as any);
  writeFileSync(join(stateDir, '.gharabi-control.json'), JSON.stringify({ driveRefreshToken: encrypted }, null, 2));
  startApp();
  if (!(await waitForHealth())) { console.log(log.slice(-2000)); throw new Error('الخادم لم يقلع'); }

  const auth = await login();

  group('1) المسار محمي بالمصادقة');
  {
    const unauth = await host(null, makeVideo(2 * 1024 * 1024));
    check('بلا جلسة => 401', unauth.res.status === 401, String(unauth.res.status));
  }

  group('2) الحالة الطبيعية — 2 ميغابايت تنتهي خلال ثوانٍ برابط عام حقيقي');
  {
    await fetch(`${DRIVE_BASE}/__reset`);
    const r = await host(auth, makeVideo(2 * 1024 * 1024, 1));
    check('حالة طبيعية => 200', r.res.status === 200, JSON.stringify({ s: r.res.status, b: r.body }));
    check('حالة طبيعية => رابط عام حقيقي موجود', typeof r.body.url === 'string' && r.body.url.includes('drive.google.com'), String(r.body.url || ''));
    check('حالة طبيعية => تنتهي خلال ثوانٍ (أقل من 10s)', r.elapsed < 10_000, `${r.elapsed}ms`);
    check('حالة طبيعية => لم يُرفض بحد الوسيط 413', r.res.status !== 413);
  }

  group('3) Drive متعثّر تماماً => رد خطأ واضح خلال مهلة محدودة (لا تعليق بلا نهاية)');
  {
    await fetch(`${DRIVE_BASE}/__hang`);
    const r = await host(auth, makeVideo(2 * 1024 * 1024, 2));
    check('متعثّر => انتهى خلال مهلة معقولة (< 6s)', r.elapsed < 6_000, `${r.elapsed}ms`);
    check('متعثّر => ليس 413', r.res.status !== 413, String(r.res.status));
    check('متعثّر => لا رد نجاح وهمي', r.res.status !== 200, String(r.res.status));
    check('متعثّر => خطأ واضح (HOSTING_TIMEOUT أو VIDEO_HOSTING_FAILED)', r.body.code === 'HOSTING_TIMEOUT' || r.body.code === 'VIDEO_HOSTING_FAILED', JSON.stringify(r.body));
    check('متعثّر => لا رسالة "حجم الطلب أكبر من الحد"', !JSON.stringify(r.body).includes('حجم الطلب أكبر من الحد'));
    check('متعثّر => الرمز يتوجّه للمالك لبديل يدوي', /يدوياً|lap|لصق/.test(String(r.body.error || '')));
    await fetch(`${DRIVE_BASE}/__reset`);
  }

  group('4) تشخيص /api/health تقني بلا أسرار ولا استعلامات');
  {
    const h = await (await fetch(`${BASE}/api/health`)).json();
    const diag = h.driveHostDiagnostics;
    check('كتلة التشخيص موجودة', Boolean(diag));
    check('مهلة صريحة معروضة كرقم', typeof diag?.timeoutMs === 'number' && diag.timeoutMs > 0, String(diag?.timeoutMs));
    check('سجلات النداءات مصفوفة', Array.isArray(diag?.recentCalls));
    const urlsOk = (diag?.recentCalls || []).every((c: any) => typeof c.url === 'string' && !c.url.includes('?'));
    check('لا استعلام (ولا معرّفات ملفات) في عناوين التشخيص', urlsOk);
    const raw = JSON.stringify(diag || {});
    check('لا سرّ ولا رمز وصول في التشخيص', !/ya29|refresh_token|Bearer|1\/\/fake/.test(raw));
    check('آخر مهلة انتهاء مسجّلة بعد التعثّر', Boolean(diag?.lastTimeout));
  }

  group('5) انحدار — سلامة الحماية العامة للحد كما هي');
  {
    const nonExempt = await fetch(`${BASE}/api/social/manager/comments/ingest`, { method: 'POST', headers: auth, body: JSON.stringify({ text: 'x'.repeat(300 * 1024) }) });
    check('مسار غير مُستثنى: 300KB => 413 كما كان', nonExempt.status === 413, String(nonExempt.status));
  }
}

main()
  .catch((e) => { failures.push(`استثناء: ${e?.message || e}`); console.log(log.slice(-3000)); })
  .finally(async () => {
    if (proc) { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1200)); if (!proc.killed) proc.kill('SIGKILL'); }
    try { driveServer?.close(); } catch { /* تجاهل */ }
    try { tokenServer?.close(); } catch { /* تجاهل */ }
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
    console.log('\n============================================================');
    if (failures.length) { console.log(`FAILED: ${failures.length}`); for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
    else { console.log(`PASSED: ${passed} drive host integration checks`); process.exit(0); }
  });
