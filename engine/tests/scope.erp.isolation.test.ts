/**
 * SCOPE ISOLATION (PLAN A) — إثبات عزل أسطح ERP/CRM/المالية القديمة (خارج نطاق
 * المشروع المعلن: سوشيال + AI + تسويق) عبر `GHARABI_ENABLE_COMMERCIAL_SALES_SCOPE`.
 *
 * الافتراضي (المفتاح مُطفأ):
 * - كل مسار محمي يرد **404 صريح** بترميز `SCOPE_DISABLED` (لا 200 HTML، وقبل المصادقة).
 * - المسارات المشتركة المطلوبة (workspace/products|content|conversations|showroom|snapshot)
 *   **غير محجوبة**: تبقى محمية بالمصادقة فقط (401 بلا جلسة، 200 بجلسة).
 * - `/api/health` و`/` سليمان.
 *
 * مع المفتاح مُفعّل: العزل مُعطَّل — المسار النموذجي يعود مسلك المصادقة (401 بلا جلسة)
 * ولا يعيد SCOPE_DISABLED. لا ندّعي أن منطق العمل يعمل، بل فقط أن الحارس مُعطَّل.
 *
 * يشغّل server.ts فعلياً عبر tsx؛ لا مزود حقيقي ولا حصة AI.
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

// مسارات ERP/CRM/المالية المحمية (بادئات + control المحدّد).
const GUARDED_ROUTES = [
  '/api/inventory',
  '/api/customers/360',
  '/api/reports/operations',
  '/api/crm/leads',
  '/api/sales',
  '/api/business/overview',
  '/api/finance/overview',
  '/api/executive/overview',
  '/api/suppliers',
  '/api/purchases',
  '/api/expenses',
  '/api/contracts',
  '/api/installments/schedule',
  '/api/control/cashflow',
  '/api/control/reconciliation',
  '/api/control/daily-brief',
  '/api/control/customer-directory',
  '/api/control/alerts',
];
// POST catalog/quote يُفحص منفصلاً.
const GUARDED_CATALOG_QUOTE = '/api/catalog/quote';

// مسارات مشتركة مطلوبة للسوشيال/AI/التسويق — يجب ألا تُحجب.
const SHARED_WORKSPACE_ROUTES = [
  '/api/workspace/products',
  '/api/workspace/conversations',
  '/api/workspace/showroom',
  '/api/workspace/snapshot',
];

// مسارات داخل النطاق (سوشيال/AI/العقل المركزي) — يجب ألا تُحجب.
const IN_SCOPE_ROUTES = [
  '/api/social/manager/status',
  '/api/ai/generate-content',
  '/api/brain/diagnostics',
  '/api/agent/brain/runtime',
];

function startApp(port: number, stateDir: string, enableScope: boolean, previewToken: string): ChildProcess {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    NODE_ENV: 'production',
    APP_URL: `http://127.0.0.1:${port}`,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: previewToken,
    SESSION_SECRET: 'scope-erp-isolation-test-secret-not-real',
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

async function login(base: string, token: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
  });
  const body = await res.json();
  return String(body.token || '');
}

(async () => {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  let exitCode = 0;

  // ---------- المرحلة أ: المفتاح مُطفأ (الافتراضي) => العزل فعّال ----------
  const portA = 7610 + Math.floor(Math.random() * 40);
  const baseA = `http://127.0.0.1:${portA}`;
  const stateDirA = mkdtempSync(join(tmpdir(), 'gharabi-erp-off-'));
  const previewTokenA = randomBytes(24).toString('hex');
  const procA = startApp(portA, stateDirA, false, previewTokenA);
  try {
    if (!(await waitForHealth(baseA))) throw new Error('الخادم (العزل مفعّل) لم يقلع.');

    // 1) كل مسار محمي => 404 + SCOPE_DISABLED (بلا مصادقة أصلاً).
    for (const route of GUARDED_ROUTES) {
      const res = await fetch(`${baseA}${route}`);
      const body: any = await res.json().catch(() => ({}));
      check(`off: ${route} => 404`, res.status === 404, `status=${res.status}`);
      check(`off: ${route} => SCOPE_DISABLED`, body?.code === 'SCOPE_DISABLED', `code=${body?.code}`);
      check(`off: ${route} => not HTML`, (res.headers.get('content-type') || '').includes('application/json'));
    }
    {
      const res = await fetch(`${baseA}${GUARDED_CATALOG_QUOTE}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cashPrice: 100000, months: 12 }),
      });
      const body: any = await res.json().catch(() => ({}));
      check('off: catalog/quote => 404', res.status === 404, `status=${res.status}`);
      check('off: catalog/quote => SCOPE_DISABLED', body?.code === 'SCOPE_DISABLED', `code=${body?.code}`);
    }

    // 2) مسارات control غير المالية يجب ألا تُحجب (نتحقق من مسار jobs: ليس 404 SCOPE).
    {
      const res = await fetch(`${baseA}/api/control/jobs`);
      const body: any = await res.json().catch(() => ({}));
      check('off: control/jobs not scope-blocked', !(res.status === 404 && body?.code === 'SCOPE_DISABLED'), `status=${res.status} code=${body?.code}`);
    }

    // 2ب) حالة الأحرف: Express يوجّه بلا حساسية للحالة، فيجب أن يُعزل الـguard كل
    //     صيغ الأحرف — وإلا أمكن تجاوز العزل بتغيير حالة الأحرف فقط.
    for (const route of ['/API/SALES', '/Api/Sales', '/Api/SaLeS', '/API/CRM/leads', '/API/FINANCE/overview', '/API/control/Cashflow']) {
      const res = await fetch(`${baseA}${route}`);
      const body: any = await res.json().catch(() => ({}));
      check(`off: ${route} => 404 (case-insensitive)`, res.status === 404, `status=${res.status}`);
      check(`off: ${route} => SCOPE_DISABLED (case-insensitive)`, body?.code === 'SCOPE_DISABLED', `code=${body?.code}`);
    }

    // 2ج) حدّ المسار + الاستعلام + الشرطة المائلة: تُعزل الصيغ المكافئة، ولا تُعزل
    //     بادئة مختلفة مثل `/api/salesforce`.
    for (const route of ['/api/sales/', '/api/sales?x=1', '/api/control/alerts/']) {
      const res = await fetch(`${baseA}${route}`);
      const body: any = await res.json().catch(() => ({}));
      check(`off: ${route} => 404 (variant)`, res.status === 404, `status=${res.status}`);
      check(`off: ${route} => SCOPE_DISABLED (variant)`, body?.code === 'SCOPE_DISABLED', `code=${body?.code}`);
    }
    for (const route of ['/api/salesforce', '/api/salesforce/thing']) {
      const res = await fetch(`${baseA}${route}`);
      const body: any = await res.json().catch(() => ({}));
      check(`off: ${route} NOT scope-blocked (boundary)`, !(res.status === 404 && body?.code === 'SCOPE_DISABLED'), `status=${res.status} code=${body?.code}`);
    }

    // 3) المسارات المشتركة: غير محجوبة => 200 بجلسة صالحة.
    const authToken = await login(baseA, previewTokenA);
    check('off: preview login succeeded', Boolean(authToken), 'token empty');
    for (const route of SHARED_WORKSPACE_ROUTES) {
      const resNoAuth = await fetch(`${baseA}${route}`);
      const bodyNoAuth: any = await resNoAuth.json().catch(() => ({}));
      check(`off: shared ${route} not scope-blocked`, !(resNoAuth.status === 404 && bodyNoAuth?.code === 'SCOPE_DISABLED'), `status=${resNoAuth.status}`);
      if (authToken) {
        const resAuth = await fetch(`${baseA}${route}`, { headers: { Authorization: `Bearer ${authToken}` } });
        check(`off: shared ${route} reachable with session`, resAuth.status === 200, `status=${resAuth.status}`);
      }
    }

    // 4) المسارات الداخلية للسوشيال/الذكاء/العقل المركزي يجب ألا تُحجب (ليست 404 SCOPE).
    for (const route of IN_SCOPE_ROUTES) {
      const res = await fetch(`${baseA}${route}`);
      const body: any = await res.json().catch(() => ({}));
      check(`off: in-scope ${route} not scope-blocked`, !(res.status === 404 && body?.code === 'SCOPE_DISABLED'), `status=${res.status}`);
    }

    // 5) الصحة والجذر سليمان.
    const health = await fetch(`${baseA}/api/health`);
    check('off: /api/health healthy', health.ok, `status=${health.status}`);
    const root = await fetch(`${baseA}/`);
    check('off: / reachable', root.status === 200, `status=${root.status}`);
  } catch (err) {
    failures.push(`phase-off fatal: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await stop(procA);
  }

  // ---------- المرحلة ب: المفتاح مُفعّل => العزل مُعطَّل ----------
  const portB = 7660 + Math.floor(Math.random() * 40);
  const baseB = `http://127.0.0.1:${portB}`;
  const stateDirB = mkdtempSync(join(tmpdir(), 'gharabi-erp-on-'));
  const previewTokenB = randomBytes(24).toString('hex');
  const procB = startApp(portB, stateDirB, true, previewTokenB);
  try {
    if (!(await waitForHealth(baseB))) throw new Error('الخادم (العزل معطّل) لم يقلع.');
    // ممثل من كل عائلة ERP: يجب ألا يعيد SCOPE_DISABLED (المسار مُسجَّل => 401 بلا جلسة).
    for (const route of ['/api/inventory', '/api/crm/leads', '/api/sales', '/api/finance/overview', '/api/control/cashflow', '/API/SALES', '/Api/Sales']) {
      const res = await fetch(`${baseB}${route}`);
      const body: any = await res.json().catch(() => ({}));
      check(`on: ${route} not SCOPE_DISABLED`, body?.code !== 'SCOPE_DISABLED', `status=${res.status} code=${body?.code}`);
      check(`on: ${route} guard disabled (401 unauth)`, res.status === 401, `status=${res.status}`);
    }
    const health = await fetch(`${baseB}/api/health`);
    check('on: /api/health healthy', health.ok, `status=${health.status}`);
  } catch (err) {
    failures.push(`phase-on fatal: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await stop(procB);
  }

  // ---------- النتيجة ----------
  if (failures.length) {
    console.error(`FAILED: ${failures.length} checks`);
    for (const f of failures) console.error(`  - ${f}`);
    console.log(`PASSED: ${passed} ERP scope-isolation checks`);
    exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} ERP scope-isolation checks`);
  }
  process.exit(exitCode);
})();
