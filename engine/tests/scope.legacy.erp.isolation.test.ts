/**
 * SCOPE ISOLATION (LEGACY ERP) — إثبات عزل أسطح Inventory/CRM/Finance/Customers-360/
 * Purchases/Reports (خارج نطاق المشروع المعلن: سوشيال + AI + تسويق) عبر
 * `GHARABI_ENABLE_LEGACY_ERP_SCOPE`.
 *
 * الافتراضي (المفتاح مُطفأ):
 * - كل مسار من الأسطح الست يرد **404 صريح** بترميز `SCOPE_DISABLED` (لا 200 HTML،
 *   وقبل المصادقة). يُغطّى الـ17 مساراً المكتشف + مسار فرعي مُختلق لضمان تغطية
 *   البادئات لأي مسار جديد مستقبلاً.
 * - المطابقة غير حسّاسة لحالة الأحرف، وتحترم حدّ المسار (لا تلتقط `/api/crmx`).
 * - المسارات داخل النطاق (سوشيال/AI/العقل المركزي) والمشتركة (workspace/products,
 *   workspace/conversations) **غير محجوبة**.
 * - مبيعات المعرض `/api/sales*` **ميزة حيّة** (تبويب sales الظاهر) وليست Legacy ERP:
 *   غير محجوبة في أي من حالتي المفتاح (401 بلا جلسة، 200 بجلسة) — انحدار صريح.
 * - `/api/health` يعلن `legacyErpScope.isolated=true` بلا قيمة سرّية.
 *
 * مع المفتاح مُفعّل: العزل مُعطَّل — المسار النموذجي يعود مسلك المصادقة (401 بلا جلسة)
 * ولا يعيد SCOPE_DISABLED.
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

// الـ17 مساراً المكتشف (أسطح Inventory/CRM/Finance/Customers-360/Purchases/Reports).
const GUARDED_ROUTES = [
  '/api/inventory',
  '/api/inventory/movements',
  '/api/inventory/alerts',
  '/api/inventory/anything/adjust',
  '/api/customers/360',
  '/api/reports/operations',
  '/api/crm/leads',
  '/api/crm/leads/abc',
  '/api/crm/leads/from-conversation/abc',
  '/api/crm/follow-ups',
  '/api/crm/follow-ups/today',
  '/api/purchases',
  '/api/finance/overview',
  '/api/finance/aging',
  // أسطح legacy إضافية بلا مستهلك واجهة ظاهر (كانت تُرجع 401 بلا عزل قبل الإصلاح).
  '/api/catalog/quote',
  '/api/tasks',
  '/api/business/overview',
  '/api/suppliers',
  '/api/expenses',
  '/api/contracts',
  '/api/installments/schedule',
  '/api/executive/overview',
  // مسار فرعي مُختلق: يثبت أن تغطية البادئة تمنع أي مسار جديد بلا عزل.
  '/api/inventory/brand-new-future-route',
];

// مسارات داخل النطاق (سوشيال/AI/العقل المركزي) — يجب ألا تُحجب.
const IN_SCOPE_ROUTES = [
  '/api/social/manager/status',
  '/api/ai/generate-content',
  '/api/brain/diagnostics',
  '/api/agent/brain/runtime',
];

// مسارات مشتركة مطلوبة للسوشيال/AI/التسويق — يجب ألا تُحجب.
const SHARED_WORKSPACE_ROUTES = [
  '/api/workspace/products',
  '/api/workspace/conversations',
  '/api/workspace/showroom',
  '/api/workspace/snapshot',
];

// مبيعات المعرض **ميزة حيّة** (تبويب `sales` الظاهر يستهلكها عبر SalesCenterView) وليست
// Legacy ERP. يجب ألا تُحجب في أي من حالتي المفتاح. (انحدار: كانت أُضيفت للقائمة خطأً.)
const LIVE_SALES_ROUTES = [
  '/api/sales',
  '/api/sales/sale-any-id',
  '/api/sales/sale-any-id/payments',
];

function startApp(port: number, stateDir: string, enableScope: boolean, previewToken: string): ChildProcess {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    NODE_ENV: 'production',
    APP_URL: `http://127.0.0.1:${port}`,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: previewToken,
    SESSION_SECRET: 'scope-legacy-erp-test-secret-not-real',
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  if (enableScope) env.GHARABI_ENABLE_LEGACY_ERP_SCOPE = 'true';
  else delete env.GHARABI_ENABLE_LEGACY_ERP_SCOPE;
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

  // ---------- المرحلة أ: المفتاح مُطفأ (الافتراضي) => العزل فعّال ----------
  const portA = 7710 + Math.floor(Math.random() * 40);
  const baseA = `http://127.0.0.1:${portA}`;
  const stateDirA = mkdtempSync(join(tmpdir(), 'gharabi-legacy-erp-off-'));
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
      check(`off: ${route} => JSON not HTML`, (res.headers.get('content-type') || '').includes('application/json'));
    }

    // 1ب) POST/PATCH/DELETE تُعزل كذلك (لا فقط GET).
    for (const [method, route] of [['POST', '/api/inventory/abc/adjust'], ['POST', '/api/crm/leads'], ['PATCH', '/api/crm/leads/abc'], ['DELETE', '/api/crm/leads/abc'], ['POST', '/api/purchases'], ['POST', '/api/catalog/quote'], ['POST', '/api/tasks'], ['POST', '/api/suppliers'], ['POST', '/api/expenses'], ['POST', '/api/contracts'], ['POST', '/api/installments/generate'], ['DELETE', '/api/suppliers/abc'], ['DELETE', '/api/expenses/abc']] as const) {
      const res = await fetch(`${baseA}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const body: any = await res.json().catch(() => ({}));
      check(`off: ${method} ${route} => 404`, res.status === 404, `status=${res.status}`);
      check(`off: ${method} ${route} => SCOPE_DISABLED`, body?.code === 'SCOPE_DISABLED', `code=${body?.code}`);
    }

    // 2) حالة الأحرف: Express يوجّه بلا حساسية للحالة، فيجب أن يُعزل الحارس كل الصيغ.
    for (const route of ['/API/INVENTORY', '/Api/Crm/Leads', '/API/FINANCE/overview', '/API/PURCHASES']) {
      const res = await fetch(`${baseA}${route}`);
      const body: any = await res.json().catch(() => ({}));
      check(`off: ${route} => 404 (case-insensitive)`, res.status === 404, `status=${res.status}`);
      check(`off: ${route} => SCOPE_DISABLED (case-insensitive)`, body?.code === 'SCOPE_DISABLED', `code=${body?.code}`);
    }

    // 3) حدّ المسار + الاستعلام + الشرطة المائلة: تُعزل الصيغ المكافئة، ولا تُعزل
    //    بادئة مختلفة مثل `/api/crmx`.
    for (const route of ['/api/inventory/', '/api/crm/leads?status=new', '/api/finance/overview/']) {
      const res = await fetch(`${baseA}${route}`);
      const body: any = await res.json().catch(() => ({}));
      check(`off: ${route} => 404 (variant)`, res.status === 404, `status=${res.status}`);
      check(`off: ${route} => SCOPE_DISABLED (variant)`, body?.code === 'SCOPE_DISABLED', `code=${body?.code}`);
    }
    for (const route of ['/api/crmx', '/api/inventoryX/thing']) {
      const res = await fetch(`${baseA}${route}`);
      const body: any = await res.json().catch(() => ({}));
      check(`off: ${route} NOT scope-blocked (boundary)`, !(res.status === 404 && body?.code === 'SCOPE_DISABLED'), `status=${res.status} code=${body?.code}`);
    }

    // 3ب) تحصين دفاعي: الشرطة المائلة المكرّرة تُطبَّع قبل المطابقة فيُعزل الحارس
    //     صيغ `//api/crm/...` و`/api//crm/...` (كانت تتجاوز المطابقة النصية الخام).
    for (const route of ['//api/crm/leads', '/api//crm/leads', '//api/inventory', '/api//finance/overview', '///api/purchases']) {
      const res = await fetch(`${baseA}${route}`);
      const body: any = await res.json().catch(() => ({}));
      check(`off: ${route} => 404 (dup-slash)`, res.status === 404, `status=${res.status}`);
      check(`off: ${route} => SCOPE_DISABLED (dup-slash)`, body?.code === 'SCOPE_DISABLED', `code=${body?.code}`);
    }

    // 4) المسارات المشتركة: غير محجوبة => 200 بجلسة صالحة.
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

    // 4ب) مبيعات المعرض ميزة حيّة (تبويب sales الظاهر) — لا تُحجب حتى والمفتاح مُطفأ.
    //     القاعدة الحاكمة: لا SCOPE_DISABLED إطلاقاً. المسارات ذات المسلك المسجَّل تعود
    //     401 بلا جلسة؛ أما مسار بلا مسلك GET فـ404 عام من Express (لا حجب نطاق).
    for (const route of LIVE_SALES_ROUTES) {
      const res = await fetch(`${baseA}${route}`);
      const body: any = await res.json().catch(() => ({}));
      check(`off: live-sales ${route} NOT scope-blocked`, !(res.status === 404 && body?.code === 'SCOPE_DISABLED'), `status=${res.status} code=${body?.code}`);
    }
    for (const route of ['/api/sales', '/api/sales/sale-any-id/payments']) {
      const res = await fetch(`${baseA}${route}`);
      check(`off: live-sales ${route} => 401 (route live, not blocked)`, res.status === 401, `status=${res.status}`);
    }
    if (authToken) {
      const resSales = await fetch(`${baseA}/api/sales`, { headers: { Authorization: `Bearer ${authToken}` } });
      check('off: live-sales /api/sales reachable with session (200)', resSales.status === 200, `status=${resSales.status}`);
    }

    // 5) المسارات داخل النطاق (سوشيال/ذكاء/عقل مركزي) يجب ألا تُحجب.
    for (const route of IN_SCOPE_ROUTES) {
      const res = await fetch(`${baseA}${route}`);
      const body: any = await res.json().catch(() => ({}));
      check(`off: in-scope ${route} not scope-blocked`, !(res.status === 404 && body?.code === 'SCOPE_DISABLED'), `status=${res.status}`);
    }

    // 6) الصحة والجذر سليمان، والصحة تعلن العزل بلا قيمة سرّية.
    const healthRes = await fetch(`${baseA}/api/health`);
    const health: any = await healthRes.json().catch(() => ({}));
    check('off: /api/health healthy', healthRes.ok, `status=${healthRes.status}`);
    check('off: health.legacyErpScope.isolated=true', health?.legacyErpScope?.isolated === true, JSON.stringify(health?.legacyErpScope));
    check('off: health.legacyErpScope.enabled=false', health?.legacyErpScope?.enabled === false);
    check('off: health exposes env name not value', health?.legacyErpScope?.envName === 'GHARABI_ENABLE_LEGACY_ERP_SCOPE');
    const root = await fetch(`${baseA}/`);
    check('off: / reachable', root.status === 200, `status=${root.status}`);
  } catch (err) {
    failures.push(`phase-off fatal: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await stop(procA);
  }

  // ---------- المرحلة ب: المفتاح مُفعّل => العزل مُعطَّل ----------
  const portB = 7760 + Math.floor(Math.random() * 40);
  const baseB = `http://127.0.0.1:${portB}`;
  const stateDirB = mkdtempSync(join(tmpdir(), 'gharabi-legacy-erp-on-'));
  const previewTokenB = randomBytes(24).toString('hex');
  const procB = startApp(portB, stateDirB, true, previewTokenB);
  try {
    if (!(await waitForHealth(baseB))) throw new Error('الخادم (العزل معطّل) لم يقلع.');
    // ممثل من كل عائلة: يجب ألا يعيد SCOPE_DISABLED (المسار مُسجَّل => 401 بلا جلسة).
    for (const route of ['/api/inventory', '/api/crm/leads', '/api/purchases', '/api/finance/overview', '/api/customers/360', '/api/reports/operations', '/API/INVENTORY', '/api/catalog/quote', '/api/tasks', '/api/business/overview', '/api/suppliers', '/api/expenses', '/api/contracts', '/api/installments/schedule', '/api/executive/overview']) {
      const res = await fetch(`${baseB}${route}`);
      const body: any = await res.json().catch(() => ({}));
      check(`on: ${route} not scope-blocked`, !(res.status === 404 && body?.code === 'SCOPE_DISABLED'), `status=${res.status} code=${body?.code}`);
    }
    // مبيعات المعرض ميزة حيّة: لا تُحجب ولا في حالة تفعيل العزل أيضاً.
    for (const route of LIVE_SALES_ROUTES) {
      const res = await fetch(`${baseB}${route}`);
      const body: any = await res.json().catch(() => ({}));
      check(`on: live-sales ${route} NOT scope-blocked`, !(res.status === 404 && body?.code === 'SCOPE_DISABLED'), `status=${res.status} code=${body?.code}`);
    }
    const healthB: any = await (await fetch(`${baseB}/api/health`)).json().catch(() => ({}));
    check('on: health.legacyErpScope.isolated=false', healthB?.legacyErpScope?.isolated === false, JSON.stringify(healthB?.legacyErpScope));
    check('on: health.legacyErpScope.enabled=true', healthB?.legacyErpScope?.enabled === true);
  } catch (err) {
    failures.push(`phase-on fatal: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await stop(procB);
  }

  console.log(`\n${'='.repeat(60)}`);
  if (failures.length) {
    console.error(`FAILED: ${passed} passed, ${failures.length} failed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} legacy ERP scope-isolation checks`);
})();
