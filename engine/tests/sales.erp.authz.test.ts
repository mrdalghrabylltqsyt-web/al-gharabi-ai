/**
 * اختبار تصريح فعلي لمسارات البيع/الأعمال/المالية (Point 2).
 *
 * سبب الوجود: كانت هذه المسارات محمية بـ`authenticateToken` فقط بلا فحص دور، فأي
 * حساب مسجَّل (بما فيه content_creator/customer_support) يصل لبيانات مالية/عملاء.
 * أُضيف فحص `["owner","manager","staff"]` مطابق للنمط الموجود في نفس الملف
 * (مثل /api/inventory/:productId/adjust). هذا الاختبار يشغّل server.ts فعلياً ويوقّع
 * جلسات حقيقية بأدوار مختلفة، ويثبت المصفوفة: مسموح / 403 / 401 — بلا أي mock.
 *
 * ملاحظة: تُشغَّل البيئة مع GHARABI_ENABLE_LEGACY_ERP_SCOPE=true لأن حارس نطاق ERP
 * يعزل بعض هذه المسارات بـ404 افتراضياً (مثبت في scope.legacy.erp.isolation.test.ts)،
 * وهنا نريد اختبار **فحص الدور** نفسه لا حارس النطاق.
 *
 * كل البيانات اختبار محلي؛ لا أسرار حقيقية ولا اتصال منصات ولا بيانات عمل حقيقية.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { signSession } from '../auth/sessions';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const PORT = 6600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const SESSION_SECRET = 'sales-erp-authz-secret-local-only';
const secretBuffer = crypto.createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-sales-authz-'));

const nowIso = () => new Date().toISOString();
function user(id: string, role: string, titleAr: string) {
  return { id, name: `${role} اختبار`, email: `${role}@example.invalid`, role, roleTitleArabic: titleAr, avatar: '', active: true, createdAt: nowIso() };
}
const users = [
  user('owner-1', 'owner', 'مالك النظام (Owner)'),
  user('manager-1', 'manager', 'المدير العام'),
  user('staff-1', 'staff', 'الموظف'),
  user('creator-1', 'content_creator', 'مسؤول المحتوى'),
  user('support-1', 'customer_support', 'مسؤول خدمة العملاء'),
];

function mint(uid: string): string {
  return signSession({ uid, iat: Date.now(), exp: Date.now() + 1000 * 60 * 60, sid: crypto.randomUUID() }, secretBuffer);
}

function seedState(): void {
  const snapshot = {
    schemaVersion: 16,
    savedAt: nowIso(),
    users,
    revokedSessions: [],
    userRevocations: [],
    audit: [],
    jobs: [],
    platformConnections: [],
    workspace: {
      showroom: {},
      // منتج بمخزون منخفض (1 <= reorderLevel 10) + قسط متأخر + بيع اليوم: بيانات مالية
      // حساسة حقيقية تُثبت أن /api/control/alerts و/api/control/daily-brief تحجبها عن
      // غير المصرّح لهم (لو بقيتا بلا فحص دور لظهرت هذه القيم في الاستجابة).
      products: [
        { id: 'prod-1', name: 'منتج اختبار', stockQuantity: 10, reorderLevel: 2, inStock: true, price: 1000 },
        { id: 'prod-low', name: 'منتج منخفض المخزون', stockQuantity: 1, reorderLevel: 10, inStock: true, price: 500 },
      ],
      suppliers: [],
      purchases: [],
      sales: [{ id: 'sale-seed', customerName: 'عميل اليوم', productId: 'prod-1', totalAmount: 4000, status: 'confirmed', createdAt: nowIso() }],
      payments: [{ id: 'pay-seed', saleId: 'sale-seed', amount: 1500, method: 'cash', createdAt: nowIso() }],
      expenses: [{ id: 'exp-seed', amount: 250, category: 'تشغيل', description: 'مصروف اليوم', createdAt: nowIso() }],
      contracts: [],
      installmentSchedules: [{ id: 'inst-overdue', saleId: 'sale-seed', dueAt: new Date(Date.now() - 86400000).toISOString(), amount: 900, paid: 0, status: 'unpaid' }],
      leads: [{ id: 'lead-seed', customerName: 'عميل محتمل', status: 'new' }],
      conversations: [],
      tasks: [],
      posts: [],
      socialComments: [],
      socialReplies: [],
      socialApprovals: [],
    },
  };
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify(snapshot), 'utf8');
}

function startApp(): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE,
    STATE_DIR: stateDir, SESSION_SECRET,
    GHARABI_ENABLE_LEGACY_ERP_SCOPE: 'true',
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  delete env.GHARABI_PREVIEW_TOKEN;
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function call(path: string, method: string, token?: string, body?: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json: any = null;
  try { json = await res.json(); } catch { /* قد لا يُعيد JSON */ }
  return { status: res.status, json };
}

// وصف كل مسار: طريقة + مسار + جسم صالح (يُبنى من معرّفات حقيقية) + حالة النجاح.
type RouteSpec = { name: string; method: string; path: string; ok: number; body?: (ids: Ids) => any };
type Ids = { supplierId: string; saleId: string; contractId: string };

// المسارات التي كانت بلا أي فحص دور وأُضيف لها فحص ["owner","manager","staff"].
const ROUTES: RouteSpec[] = [
  { name: 'GET /api/customers/360', method: 'GET', path: '/api/customers/360', ok: 200 },
  { name: 'GET /api/reports/operations', method: 'GET', path: '/api/reports/operations', ok: 200 },
  { name: 'GET /api/sales/:id/payments', method: 'GET', path: '/api/sales/', ok: 200 },
  { name: 'GET /api/business/overview', method: 'GET', path: '/api/business/overview', ok: 200 },
  { name: 'GET /api/suppliers', method: 'GET', path: '/api/suppliers', ok: 200 },
  { name: 'POST /api/suppliers', method: 'POST', path: '/api/suppliers', ok: 201, body: () => ({ name: 'مورد اختبار' }) },
  { name: 'PATCH /api/suppliers/:id', method: 'PATCH', path: '/api/suppliers/', ok: 200, body: () => ({ notes: 'تحديث مورد' }) },
  { name: 'GET /api/purchases', method: 'GET', path: '/api/purchases', ok: 200 },
  { name: 'POST /api/purchases', method: 'POST', path: '/api/purchases', ok: 201, body: (ids) => ({ supplierId: ids.supplierId, items: [{ productId: 'prod-1', productName: 'منتج اختبار', quantity: 1, unitCost: 500 }] }) },
  { name: 'GET /api/expenses', method: 'GET', path: '/api/expenses', ok: 200 },
  { name: 'POST /api/expenses', method: 'POST', path: '/api/expenses', ok: 201, body: () => ({ amount: 50, category: 'تشغيل', description: 'مصروف اختبار' }) },
  { name: 'GET /api/contracts', method: 'GET', path: '/api/contracts', ok: 200 },
  { name: 'POST /api/contracts', method: 'POST', path: '/api/contracts', ok: 201, body: (ids) => ({ customerName: 'عميل اختبار', phone: '07700000000', saleId: ids.saleId }) },
  { name: 'POST /api/contracts/:id/sign', method: 'POST', path: '/api/contracts/', ok: 200, body: () => ({ signatureReference: 'اختبار' }) },
  { name: 'GET /api/installments/schedule', method: 'GET', path: '/api/installments/schedule', ok: 200 },
  { name: 'POST /api/installments/generate', method: 'POST', path: '/api/installments/generate', ok: 201, body: (ids) => ({ saleId: ids.saleId }) },
  { name: 'GET /api/installments/due', method: 'GET', path: '/api/installments/due', ok: 200 },
  { name: 'GET /api/executive/overview', method: 'GET', path: '/api/executive/overview', ok: 200 },
  { name: 'GET /api/control/customer-directory', method: 'GET', path: '/api/control/customer-directory', ok: 200 },
  { name: 'GET /api/control/cashflow', method: 'GET', path: '/api/control/cashflow', ok: 200 },
  { name: 'GET /api/control/alerts', method: 'GET', path: '/api/control/alerts', ok: 200 },
  { name: 'GET /api/control/daily-brief', method: 'GET', path: '/api/control/daily-brief', ok: 200 },
];

// مسارات تُبنى معرّفاتها في المسار: تُستبدل بالمعرّف الحقيقي بعد الإنشاء.
function withId(spec: RouteSpec, ids: Ids): string {
  if (spec.path.endsWith('/')) {
    if (spec.path === '/api/sales/') return spec.name.includes('payments') ? `/api/sales/${ids.saleId}/payments` : `/api/sales/${ids.saleId}`;
    if (spec.path === '/api/suppliers/') return `/api/suppliers/${ids.supplierId}`;
    if (spec.path === '/api/contracts/') return `/api/contracts/${ids.contractId}/sign`;
  }
  return spec.path;
}

async function run(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  seedState();
  const app = startApp();
  const tokens: Record<string, string> = {
    owner: mint('owner-1'), manager: mint('manager-1'), staff: mint('staff-1'),
    creator: mint('creator-1'), support: mint('support-1'),
  };
  try {
    check('الخادم الفعلي يقلع', await waitForHealth(), app.log().slice(0, 300));

    // ---- 1) بلا جلسة => 401 لكل المسارات (يبقى كما كان) ----
    for (const spec of ROUTES) {
      const r = await call(withId(spec, { supplierId: 'x', saleId: 'x', contractId: 'x' }), spec.method, undefined, spec.body?.({ supplierId: 'x', saleId: 'x', contractId: 'x' }));
      check(`401 بلا جلسة: ${spec.name}`, r.status === 401, `status=${r.status}`);
    }

    // ---- 2) أدوار ممنوعة => 403 لكل المسارات ----
    for (const role of ['creator', 'support'] as const) {
      for (const spec of ROUTES) {
        const r = await call(withId(spec, { supplierId: 'x', saleId: 'x', contractId: 'x' }), spec.method, tokens[role], spec.body?.({ supplierId: 'x', saleId: 'x', contractId: 'x' }));
        check(`403 (${role}): ${spec.name}`, r.status === 403 && r.json?.success === false, `status=${r.status}`);
      }
    }

    // ---- 2ب) /api/control/alerts و/api/control/daily-brief: منع تسريب بيانات مالية ----
    // تُنفَّذ قبل أي إنشاء لاحق حتى تكون القيم مطابقة للبيانات المُغذّاة بالضبط
    // (مخزون منخفض 1، بيع 4000، تحصيل 1500). نثبت أن غير المصرّح لهم لا يرون أي قيمة،
    // وأن المصرّح لهم يرونها فعلاً (الحجب بسبب الدور لا بسبب غياب البيانات).
    for (const path of ['/api/control/alerts', '/api/control/daily-brief']) {
      check(`401 بلا جلسة: ${path}`, (await call(path, 'GET')).status === 401);
      for (const role of ['creator', 'support'] as const) {
        const denied = await call(path, 'GET', tokens[role]);
        check(`403 (${role}): ${path}`, denied.status === 403 && denied.json?.success === false, `status=${denied.status}`);
        const body = JSON.stringify(denied.json);
        check(`لا تسريب بيانات مالية (${role}): ${path}`, !/4000|1500|900|"sales"|"collections"|"overdue"|prod-low/.test(body), body.slice(0, 120));
      }
      check(`200 (owner): ${path}`, (await call(path, 'GET', tokens.owner)).status === 200);
      check(`200 (manager): ${path}`, (await call(path, 'GET', tokens.manager)).status === 200);
      check(`200 (staff): ${path}`, (await call(path, 'GET', tokens.staff)).status === 200);
    }
    const alertsOwner = await call('/api/control/alerts', 'GET', tokens.owner);
    check('alerts (owner): يُعلن المخزون المنخفض الحقيقي', JSON.stringify(alertsOwner.json?.alerts || []).includes('stock-low'));
    check('alerts (owner): يُعلن الأقساط المتأخرة الحقيقية', JSON.stringify(alertsOwner.json?.alerts || []).includes('installments-overdue'));
    const briefOwner = await call('/api/control/daily-brief', 'GET', tokens.owner);
    check('daily-brief (owner): مبيعات اليوم الحقيقية 4000', Number(briefOwner.json?.sales?.value) === 4000, `value=${briefOwner.json?.sales?.value}`);
    check('daily-brief (owner): تحصيلات اليوم الحقيقية 1500', Number(briefOwner.json?.collections) === 1500, `collections=${briefOwner.json?.collections}`);
    check('daily-brief (owner): مخزون منخفض حقيقي (1)', Number(briefOwner.json?.lowStock) === 1, `lowStock=${briefOwner.json?.lowStock}`);

    // ---- 3) الأدوار المسموحة => نجاح فعلي، لكل دور بمعرّفات حقيقية جديدة ----
    for (const role of ['owner', 'manager', 'staff'] as const) {
      const token = tokens[role];
      // إنشاء مورد وعملية بيع وعقد حقيقيين لهذا الدور
      const sup = await call('/api/suppliers', 'POST', token, { name: `مورد ${role}` });
      check(`تهيئة (${role}): إنشاء مورد`, sup.status === 201 && !!sup.json?.supplier?.id, `status=${sup.status}`);
      const supplierId = sup.json?.supplier?.id as string;
      const sale = await call('/api/sales', 'POST', token, { customerName: `عميل ${role}`, productName: 'منتج اختبار', totalAmount: 1000, downPayment: 0 });
      check(`تهيئة (${role}): إنشاء عملية بيع`, sale.status === 201 && !!sale.json?.sale?.id, `status=${sale.status}`);
      const saleId = sale.json?.sale?.id as string;
      const contract = await call('/api/contracts', 'POST', token, { customerName: `عميل ${role}`, phone: '07700000000', saleId });
      check(`تهيئة (${role}): إنشاء عقد`, contract.status === 201 && !!contract.json?.contract?.id, `status=${contract.status}`);
      const contractId = contract.json?.contract?.id as string;

      const ids: Ids = { supplierId, saleId, contractId };
      for (const spec of ROUTES) {
        // تجنّب إعادة إنشاء العقد لنفس البيع (يفشل 409) — العقد أُنشئ في التهيئة.
        if (spec.name === 'POST /api/contracts') {
          check(`تهيئة (${role}): POST /api/contracts أُنشئ مسبقاً`, true);
          continue;
        }
        const r = await call(withId(spec, ids), spec.method, token, spec.body?.(ids));
        check(`مسموح (${role}): ${spec.name} => ${spec.ok}`, r.status === spec.ok && r.json?.success === true, `status=${r.status} body=${JSON.stringify(r.json).slice(0, 120)}`);
      }
    }

    // ---- 4) محتوى الرد الممنوع صريح ولا يعيد بيانات ----
    const forbidden = await call('/api/executive/overview', 'GET', tokens.creator);
    check('403 يحمل رسالة صريحة بلا نجاح', forbidden.status === 403 && forbidden.json?.success === false && typeof forbidden.json?.error === 'string', JSON.stringify(forbidden.json));

    // ---- 5) المسارات الأربعة التي كانت مُحصّنة أصلاً: نُثبت سلوكها الفعلي بدقة ----
    // (ليست في ROUTES لأنها لم تكن ضمن فجوة "بلا أي فحص دور"؛ لا نُغيّرها، نوثّقها.)
    const ownerSale = await call('/api/sales', 'POST', tokens.owner, { customerName: 'عميل المالك', productName: 'منتج اختبار', totalAmount: 5000, downPayment: 0 });
    const ownerSaleId = ownerSale.json?.sale?.id as string;
    check('مُحصّن أصلاً: POST /api/sales يرفض content_creator بـ403', (await call('/api/sales', 'POST', tokens.creator, { customerName: 'x', productName: 'y', totalAmount: 10 })).status === 403);
    check('مُحصّن أصلاً: POST /api/sales يرفض customer_support بـ403', (await call('/api/sales', 'POST', tokens.support, { customerName: 'x', productName: 'y', totalAmount: 10 })).status === 403);
    const creatorList = await call('/api/sales', 'GET', tokens.creator);
    check('مُحصّن أصلاً: GET /api/sales لـcreator = 200 بتصفية صفوف (لا 403)', creatorList.status === 200 && creatorList.json?.success === true, `status=${creatorList.status}`);
    check('مُحصّن أصلاً: GET /api/sales لا يكشف بيعاً ليس ملكاً للمستخدم', !(creatorList.json?.sales || []).some((s: any) => s.id === ownerSaleId));
    check('مُحصّن أصلاً: PATCH /api/sales/:id على بيع ليس ملكاً = 403', (await call(`/api/sales/${ownerSaleId}`, 'PATCH', tokens.creator, { notes: 'محاولة' })).status === 403);
    check('مُحصّن أصلاً: POST /api/sales/:id/payments على بيع ليس ملكاً = 403', (await call(`/api/sales/${ownerSaleId}/payments`, 'POST', tokens.creator, { amount: 10, method: 'cash' })).status === 403);
    check('مُضاف: GET /api/sales/:id/payments يرفض content_creator بـ403', (await call(`/api/sales/${ownerSaleId}/payments`, 'GET', tokens.creator)).status === 403);
  } finally {
    app.proc.kill('SIGKILL');
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }

  console.log(`\n[ sales.erp.authz ] passed=${passed} failed=${failures.length}`);
  if (failures.length) {
    console.error('FAILURES:');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('ALL SALES/ERP AUTHZ CHECKS PASSED');
  process.exit(0);
}

run().catch((e) => { console.error('CRASH', e); process.exit(1); });
