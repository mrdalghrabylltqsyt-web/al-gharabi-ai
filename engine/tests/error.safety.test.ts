/**
 * اختبار سلامة الأخطاء على مستوى العملية.
 *
 * 1) وحدة: تصنيف الأخطاء إلى ردود HTTP صريحة، وإخفاء الرسائل في الإنتاج، وتنقية
 *    الأسرار من أي نص خطأ.
 * 2) تكامل (خادم حقيقي): جسم JSON مشوّه => 400 JSON صريح (لا HTML، لا سقوط)،
 *    جسم أكبر من الحد => 413، والخادم يبقى حيّاً بعدها، وبلا تسريب أي سرّ.
 * 3) بنية: وجود معالجات uncaughtException/unhandledRejection ووسيط أخطاء رباعي.
 *
 * لا يلمس أي مزود ولا سرّ حقيقي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { classifyHttpError, shouldExposeErrorMessage, safeErrorMessage, redactSecretsFromText } from '../runtime/errorSafety';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const APP_PORT = 7770 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-err-safety-'));
let proc: ChildProcess | null = null;

function startApp(): void {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET: 'err-safety-secret-not-real',
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  delete env.GEMINI_API_KEY; delete env.DATABASE_URL;
  proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
}
async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function unitTests(): void {
  group('1) وحدة: تصنيف الأخطاء');
  const parseErr = classifyHttpError({ type: 'entity.parse.failed' });
  check('JSON مشوّه => 400 INVALID_JSON', parseErr.status === 400 && parseErr.code === 'INVALID_JSON' && parseErr.kind === 'bad_request');
  const large = classifyHttpError({ type: 'entity.too.large' });
  check('حجم كبير => 413 PAYLOAD_TOO_LARGE', large.status === 413 && large.code === 'PAYLOAD_TOO_LARGE');
  const status413 = classifyHttpError({ status: 413 });
  check('حالة 413 صريحة => 413', status413.status === 413);
  const client = classifyHttpError({ statusCode: 422 });
  check('خطأ عميل 4xx => 422 BAD_REQUEST', client.status === 422 && client.code === 'BAD_REQUEST');
  const generic = classifyHttpError(new Error('boom'));
  check('خطأ عام => 500 INTERNAL_ERROR', generic.status === 500 && generic.code === 'INTERNAL_ERROR');
  check('خطأ عام لا يحمل رسالة داخلية', generic.message === 'خطأ داخلي في الخادم.');

  group('2) وحدة: إخفاء الرسائل وتنقية الأسرار');
  check('الإنتاج لا يُظهر رسالة الخطأ', shouldExposeErrorMessage({ NODE_ENV: 'production' }) === false);
  check('التطوير يُظهر رسالة الخطأ', shouldExposeErrorMessage({ NODE_ENV: 'development' }) === true);
  check('الإنتاج => رسالة عامة', safeErrorMessage(new Error('secret internal detail'), false) === 'خطأ داخلي في الخادم.');
  const devMsg = safeErrorMessage(new Error('Authorization: Bearer ya29.SECRETTOKENVALUE'), true);
  check('التطوير يُنقّي Bearer token', !devMsg.includes('SECRETTOKENVALUE') && devMsg.includes('[redacted]'));
  const redacted = redactSecretsFromText('client_secret=abcdef123456 and token deadbeefdeadbeefdeadbeefdeadbeef');
  check('تنقية client_secret', !redacted.includes('abcdef123456'));
  check('تنقية hex طويل (32+)', !redacted.includes('deadbeefdeadbeefdeadbeefdeadbeef'));
  check('النص العادي يبقى كما هو', redactSecretsFromText('connection timeout') === 'connection timeout');
}

async function integrationTests(): Promise<void> {
  startApp();
  try {
    group('3) تكامل: جسم مشوّه لا يُسقط الخادم');
    check('الخادم يقلع', await waitForHealth());
    const bad = await fetch(`${BASE}/api/auth/preview-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{ "token": not-json',
    });
    check('JSON مشوّه => 400', bad.status === 400, `status=${bad.status}`);
    const badBody = await bad.json().catch(() => null);
    check('الرد JSON صريح لا HTML', Boolean(badBody) && badBody.code === 'INVALID_JSON');
    check('الرد لا يحمل تفاصيل داخلية', !JSON.stringify(badBody).includes('SyntaxError'));

    group('4) تكامل: جسم أكبر من الحد => 413 صريح');
    const huge = 'x'.repeat(400 * 1024);
    const tooLarge = await fetch(`${BASE}/api/auth/preview-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: huge }),
    });
    check('حجم > 256kb => 413', tooLarge.status === 413, `status=${tooLarge.status}`);
    const largeBody = await tooLarge.json().catch(() => null);
    check('الرد 413 JSON صريح', Boolean(largeBody) && largeBody.code === 'PAYLOAD_TOO_LARGE');

    group('5) تكامل: الخادم يبقى حيّاً ولا يسرّب سرّاً');
    const health = await fetch(`${BASE}/api/health`);
    check('health ما زال 200 بعد الأخطاء', health.status === 200);
    const healthJson = await health.json();
    check('health سليم', healthJson.status === 'ok' || typeof healthJson.status === 'string');
    const combined = JSON.stringify(badBody) + JSON.stringify(largeBody);
    check('لا تسريب أي سرّ في ردود الأخطاء', !/bearer|client_secret|access_token|api[_-]?key/i.test(combined));
  } finally {
    try { if (proc) { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1200)); if (!proc.killed) proc.kill('SIGKILL'); } } catch { /* تجاهل */ }
    rmSync(stateDir, { recursive: true, force: true });
  }
}

function structureTests(): void {
  group('6) بنية: المعالجات موجودة');
  const src = readFileSync(join(REPO_ROOT, 'server.ts'), 'utf8');
  check('معالج uncaughtException', src.includes('process.on("uncaughtException"'));
  check('معالج unhandledRejection', src.includes('process.on("unhandledRejection"'));
  check('وسيط أخطاء رباعي (err, req, res, next)', /app\.use\(\(err: unknown, req: any, res: any, next: any\)/.test(src));
  check('المعالج يُنقّي الرسائل', src.includes('safeErrorMessage(err, shouldExposeErrorMessage(process.env))'));
  check('لا يُعاد stack في الرد', !/res\.[a-z]+\([^)]*err\.stack/.test(src));
}

(async () => {
  unitTests();
  structureTests();
  await integrationTests();
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} error-safety checks`);
  }
})().catch((err) => { console.error('error-safety harness crashed:', err); process.exit(1); });
