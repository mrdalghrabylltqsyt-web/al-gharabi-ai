/**
 * SCOPE CLEANUP — إثبات عزل أسطح العقل التجاري/Sales/ERP (خارج نطاق المشروع المعلن)
 * مع بقاء السوشيال + AI + التسويق (Growth/Marketing) عاملة.
 *
 * الافتراضي: الأسطح المُعزولة ترد **404 صريح** (لا 200 HTML)، والـhealth يعلن
 * `commercialBrain.enabled=false`. مع `GHARABI_ENABLE_COMMERCIAL_SALES_SCOPE=true`
 * تُعاد الأسطح (تظهر 401 بلا جلسة = مُسجّلة). لا يُزال أي كود أو بيانات.
 *
 * يشغّل server.ts فعلياً؛ لا مزود حقيقي ولا حصة AI.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');

function startApp(port: number, stateDir: string, enableScope: boolean): ChildProcess {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    NODE_ENV: 'production',
    APP_URL: `http://127.0.0.1:${port}`,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: randomBytes(24).toString('hex'),
    SESSION_SECRET: 'scope-cleanup-test-secret-not-real',
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  if (enableScope) env.GHARABI_ENABLE_COMMERCIAL_SALES_SCOPE = 'true';
  else delete env.GHARABI_ENABLE_COMMERCIAL_SALES_SCOPE;
  return spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
}
async function waitForHealth(base: string, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function stop(proc: ChildProcess): Promise<void> {
  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1200));
  if (!proc.killed) proc.kill('SIGKILL');
}
async function login(base: string, token: string): Promise<Record<string, string>> {
  const res = await fetch(`${base}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
  });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}

const OUT_OF_SCOPE = [
  '/api/agent/brain/sales/state',
  '/api/agent/brain/sales/summary',
  '/api/agent/brain/growth/state',
  '/api/agent/brain/growth/dashboard',
  '/api/agent/brain/commercial/state',
  '/api/agent/brain/commercial/command-center',
];
const IN_SCOPE = [
  '/api/agent/brain/state',
  '/api/agent/brain/capabilities',
];

(async () => {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  let exitCode = 0;

  // ---------- المرحلة أ: الافتراضي (الأسطح مُعزولة) ----------
  const portA = 7460 + Math.floor(Math.random() * 40);
  const baseA = `http://127.0.0.1:${portA}`;
  const stateDirA = mkdtempSync(join(tmpdir(), 'gharabi-scope-off-'));
  const procA = startApp(portA, stateDirA, false);
  try {
    if (!(await waitForHealth(baseA))) throw new Error('الخادم (الافتراضي) لم يقلع.');
    const health = await (await fetch(`${baseA}/api/health`)).json();
    check('أ-الافتراضي: health.commercialBrain مُعطَّل', health.commercialBrain?.enabled === false && health.commercialBrain?.scopeDisabled === true, JSON.stringify(health.commercialBrain));

    // بلا جلسة: الأسطح المُعزولة ترد 404 صريح لا 401 (الميدلوير قبل المصادقة).
    for (const path of OUT_OF_SCOPE) {
      const r = await fetch(`${baseA}${path}`);
      const body = await r.json().catch(() => ({}));
      check(`أ-بلا جلسة ${path} ⇒ 404 صريح`, r.status === 404 && body.code === 'SCOPE_DISABLED', `status=${r.status} code=${body.code}`);
    }

    // مع جلسة مالك: تبقى 404 (لا تسريب بيانات تجارية حتى للمالك افتراضياً).
    // الميدلوير يسبق المصادقة، فحتى توكن غير صالح يبقى 404.
    const r404Auth = await fetch(`${baseA}/api/agent/brain/sales/state`, { headers: { Authorization: 'Bearer invalid' } });
    check('أ-بتوكن غير صالح يبقى 404 (العزل قبل المصادقة)', r404Auth.status === 404);

    // في النطاق: العقل المركزي يعمل (401 بلا جلسة = مُسجَّل ومحمي).
    for (const path of IN_SCOPE) {
      const r = await fetch(`${baseA}${path}`);
      check(`أ-في النطاق ${path} مُسجَّل (401 بلا جلسة)`, r.status === 401, `status=${r.status}`);
    }
  } finally {
    await stop(procA);
  }

  // ---------- المرحلة ب: المفتاح مُفعَّل (الأسطح تُعاد) ----------
  const portB = 7510 + Math.floor(Math.random() * 40);
  const baseB = `http://127.0.0.1:${portB}`;
  const stateDirB = mkdtempSync(join(tmpdir(), 'gharabi-scope-on-'));
  const previewTokenB = randomBytes(24).toString('hex');
  const procB = (() => {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PORT: String(portB), NODE_ENV: 'production', APP_URL: baseB, STATE_DIR: stateDirB,
      GHARABI_PREVIEW_TOKEN: previewTokenB,
      GHARABI_ENABLE_COMMERCIAL_SALES_SCOPE: 'true',
      SESSION_SECRET: 'scope-cleanup-test-secret-not-real-2',
      PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    };
    delete env.GEMINI_API_KEY; delete env.DATABASE_URL;
    return spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  })();
  try {
    if (!(await waitForHealth(baseB))) throw new Error('الخادم (المفعَّل) لم يقلع.');
    const health = await (await fetch(`${baseB}/api/health`)).json();
    check('ب-المفعَّل: health.commercialBrain مُفعَّل', health.commercialBrain?.enabled === true, JSON.stringify(health.commercialBrain));

    // الأسطح المُعزولة صارت مُسجَّلة ⇒ 401 بلا جلسة (وليس 404).
    for (const path of OUT_OF_SCOPE) {
      const r = await fetch(`${baseB}${path}`);
      check(`ب-${path} مُسجَّل (401 بلا جلسة)`, r.status === 401, `status=${r.status}`);
    }
    // مع جلسة مالك: تعمل 200.
    const auth = await login(baseB, previewTokenB);
    const stateRes = await fetch(`${baseB}/api/agent/brain/sales/state`, { headers: auth });
    check('ب-بجلسة المالك الحالة التجارية تُقرأ 200', stateRes.status === 200, `status=${stateRes.status}`);

    // في النطاق: السوشيال يعمل.
    const socialRes = await fetch(`${baseB}/api/social/manager/escalations`, { headers: auth });
    check('ب-السوشيال (في النطاق) يعمل', socialRes.status === 200, `status=${socialRes.status}`);
  } finally {
    await stop(procB);
  }

  console.log(`\n${'='.repeat(60)}`);
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} scope-cleanup checks`);
  }
  process.exit(exitCode);
})().catch((err) => {
  console.error('Scope cleanup harness crashed:', err);
  process.exit(1);
});
