/**
 * اختبار حساب سعر التقسيط للمنتج (Product Catalog / Product Display فقط).
 *
 * يثبت المصدر الواحد للمعادلة على الحساب والمتصفح والخادم:
 *   installmentPrice = cashPrice + 25% (تقريب لأقرب دينار)
 *   monthlyInstallment = installmentPrice / months (تقريب لأعلى دينار — نفس سياسة المشروع)
 *   المدة الافتراضية = 10 أشهر
 *
 * ويشغّل server.ts فعلياً ليثبت أن مسار المنتجات يحفظ القيم المُشتقّة من cashPrice
 * فقط ولا يقبل قيمة شهرية متناقضة، وأن المنتجات القديمة لا تتأثر.
 *
 * لا نظام أقساط/عقود/تحصيل/مالية؛ لا مزود ولا سرّ ولا بيانات وهمية.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { signSession } from '../auth/sessions';
import {
  computeInstallmentPrice,
  productInstallmentFields,
  resolveInstallmentMonths,
  INSTALLMENT_MARKUP_PERCENT_DEFAULT,
  INSTALLMENT_MONTHS_DEFAULT,
  INSTALLMENT_ROUNDING_POLICY,
} from '../../src/utils/installmentPrice';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

// ---------------------------------------------------------------------------
// 1) وحدة: المعادلة الثابتة + التحقق + التقريب
// ---------------------------------------------------------------------------
function unitTests(): void {
  group('1) الحساب الأساسي — الأمثلة الإلزامية');
  // TEST 1
  const t1 = computeInstallmentPrice({ cashPrice: 100000, installmentMonths: 10 });
  check('TEST1 ok', t1.ok === true);
  check('TEST1 installmentPrice=125000', t1.ok && t1.installmentPrice === 125000, t1.ok ? String(t1.installmentPrice) : 'fail');
  check('TEST1 monthly=12500', t1.ok && t1.monthlyInstallment === 12500, t1.ok ? String(t1.monthlyInstallment) : 'fail');
  // TEST 2
  const t2 = computeInstallmentPrice({ cashPrice: 200000, installmentMonths: 10 });
  check('TEST2 installmentPrice=250000', t2.ok && t2.installmentPrice === 250000, t2.ok ? String(t2.installmentPrice) : 'fail');
  check('TEST2 monthly=25000', t2.ok && t2.monthlyInstallment === 25000, t2.ok ? String(t2.monthlyInstallment) : 'fail');
  // TEST 3 — المدة تتغيّر، سعر التقسيط ثابت والقسط الشهري يُعاد حسابه
  const t3 = computeInstallmentPrice({ cashPrice: 100000, installmentMonths: 5 });
  check('TEST3 installmentPrice=125000', t3.ok && t3.installmentPrice === 125000, t3.ok ? String(t3.installmentPrice) : 'fail');
  check('TEST3 monthly=25000', t3.ok && t3.monthlyInstallment === 25000, t3.ok ? String(t3.monthlyInstallment) : 'fail');

  group('2) المدة الافتراضية = 10 عند الغياب');
  const dflt = computeInstallmentPrice({ cashPrice: 100000 });
  check('default months=10', dflt.ok && dflt.installmentMonths === INSTALLMENT_MONTHS_DEFAULT, dflt.ok ? String(dflt.installmentMonths) : 'fail');
  check('default monthly=12500', dflt.ok && dflt.monthlyInstallment === 12500);
  check('resolveInstallmentMonths(undefined)=10', resolveInstallmentMonths(undefined) === 10);
  check('resolveInstallmentMonths(null)=10', resolveInstallmentMonths(null) === 10);
  check('resolveInstallmentMonths("")=10', resolveInstallmentMonths('') === 10);

  group('3) التحقق (Validation)');
  // TEST 4
  const t4 = computeInstallmentPrice({ cashPrice: 0, installmentMonths: 10 });
  check('TEST4 cash=0 => fail', t4.ok === false);
  // TEST 5
  const t5 = computeInstallmentPrice({ cashPrice: -5000, installmentMonths: 10 });
  check('TEST5 cash<0 => fail', t5.ok === false);
  // TEST 6
  const t6 = computeInstallmentPrice({ cashPrice: 100000, installmentMonths: 0 });
  check('TEST6 months=0 => fail', t6.ok === false);
  check('NaN cash => fail', computeInstallmentPrice({ cashPrice: NaN }).ok === false);
  check('NaN months => fail', computeInstallmentPrice({ cashPrice: 100000, installmentMonths: NaN }).ok === false);
  check('months negative => fail', computeInstallmentPrice({ cashPrice: 100000, installmentMonths: -3 }).ok === false);
  check('months fractional => fail', computeInstallmentPrice({ cashPrice: 100000, installmentMonths: 2.5 }).ok === false);
  check('months > 60 => fail', computeInstallmentPrice({ cashPrice: 100000, installmentMonths: 61 }).ok === false);
  check('months=1 accepted', computeInstallmentPrice({ cashPrice: 100000, installmentMonths: 1 }).ok === true);
  check('negative markup => fail', computeInstallmentPrice({ cashPrice: 100000, installmentMonths: 10, installmentMarkupPercent: -5 }).ok === false);

  group('4) التقريب — سياسة دينار عراقي ثابتة (round للسعر، ceil للقسط)');
  check('policy declared', INSTALLMENT_ROUNDING_POLICY === 'round-price-ceil-monthly-to-IQD');
  // سعر تقسيط بكسر: 100010 * 1.25 = 125012.5 ⇒ round = 125013.
  const r1 = computeInstallmentPrice({ cashPrice: 100010, installmentMonths: 10 });
  check('price rounds to nearest', r1.ok && r1.installmentPrice === 125013, r1.ok ? String(r1.installmentPrice) : 'fail');
  // قسط شهري بكسر < 0.5: 125000 / 7 = 17857.14 ⇒ ceil = 17858 (وليس round=17857).
  const r2 = computeInstallmentPrice({ cashPrice: 100000, installmentMonths: 7 });
  check('monthly ceils up', r2.ok && r2.monthlyInstallment === 17858, r2.ok ? String(r2.monthlyInstallment) : 'fail');
  // decimal cash: 99999 * 1.25 = 124998.75 ⇒ round = 124999 ; /10 ⇒ ceil(12499.9)=12500.
  const r3 = computeInstallmentPrice({ cashPrice: 99999, installmentMonths: 10 });
  check('decimal cash round+ceil', r3.ok && r3.installmentPrice === 124999 && r3.monthlyInstallment === 12500, r3.ok ? `${r3.installmentPrice}/${r3.monthlyInstallment}` : 'fail');

  group('5) productInstallmentFields يستمد الأربعة من cashPrice فقط');
  const fields = productInstallmentFields({ cashPrice: 100000, installmentMonths: 10 });
  check('fields cashPrice', fields?.cashPrice === 100000);
  check('fields installmentPrice', fields?.installmentPrice === 125000);
  check('fields months', fields?.installmentMonths === 10);
  check('fields monthly', fields?.monthlyInstallment === 12500);
  check('fields markup default', fields?.installmentMarkupPercent === INSTALLMENT_MARKUP_PERCENT_DEFAULT);
  check('fields invalid => null', productInstallmentFields({ cashPrice: 0 }) === null);

  group('6) TEST 7 & 8 — إعادة الحساب الفورية عند تغيير المدخلات (منطق السلوك)');
  // TEST 7: تغيير سعر الكاش يعيد حساب السعر والقسط.
  const before = computeInstallmentPrice({ cashPrice: 100000, installmentMonths: 10 });
  const afterCash = computeInstallmentPrice({ cashPrice: 150000, installmentMonths: 10 });
  check('TEST7 recompute price', before.ok && afterCash.ok && before.installmentPrice === 125000 && afterCash.installmentPrice === 187500);
  check('TEST7 recompute monthly', afterCash.ok && afterCash.monthlyInstallment === 18750);
  // TEST 8: تغيير المدة يعيد حساب القسط فقط.
  const afterMonths = computeInstallmentPrice({ cashPrice: 100000, installmentMonths: 5 });
  check('TEST8 price unchanged', before.ok && afterMonths.ok && before.installmentPrice === afterMonths.installmentPrice);
  check('TEST8 monthly recomputed', afterMonths.ok && afterMonths.monthlyInstallment === 25000);
}

// ---------------------------------------------------------------------------
// 2) تكامل: server.ts فعلياً عبر مسار المنتجات
// ---------------------------------------------------------------------------
const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const PORT = 6860 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const SESSION_SECRET = 'product-installment-secret-local-only';
const secretBuffer = crypto.createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-product-installment-'));

const nowIso = () => new Date().toISOString();
const owner = { id: 'owner', name: 'مالك اختبار', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك', avatar: '', active: true, createdAt: nowIso() };
// منتج قديم بلا الحقول الجديدة — لإثبات التوافق مع البيانات الحالية.
const legacyProduct = { id: 'prod-legacy', name: 'منتج قديم', category: 'appliances', modelYear: '2024', cashPrice: 50000, installmentFrom: 50000, downPaymentPercent: 0, durationMonths: 1, image: '', inStock: true, stockQuantity: 3, reorderLevel: 1, featured: false, specs: [], installmentOptions: [] };

function mint(uid: string): string {
  return signSession({ uid, iat: Date.now(), exp: Date.now() + 1000 * 60 * 60, sid: crypto.randomUUID() }, secretBuffer);
}

function seedState(): void {
  const snapshot = {
    schemaVersion: 16, savedAt: nowIso(), users: [owner], revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: { showroom: {}, products: [legacyProduct], posts: [], conversations: [], installmentPlans: [], leads: [], tasks: [], sales: [], payments: [], inventoryMovements: [], suppliers: [], purchases: [], expenses: [], contracts: [], installmentSchedules: [], notifications: [], webhookEvents: [], providerEvents: [], providerTokens: {} },
  };
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify(snapshot), 'utf8');
}

function startApp(): { proc: ChildProcess } {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir, SESSION_SECRET,
  };
  delete env.GEMINI_API_KEY; delete env.DATABASE_URL; delete env.GHARABI_PREVIEW_TOKEN;
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return { proc };
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
  try { json = await res.json(); } catch { /* قد لا يعيد JSON */ }
  return { status: res.status, json };
}

async function integrationTests(): Promise<void> {
  seedState();
  const { proc } = startApp();
  const token = mint('owner');
  try {
    if (!(await waitForHealth())) { check('server boot', false, 'لم يقلع الخادم'); return; }
    check('server boot', true);

    group('7) إنشاء منتج — القيم تُشتق من cashPrice');
    const created = await call('/api/workspace/products', 'POST', token, { name: 'ثلاجة اختبار', category: 'appliances', cashPrice: 100000 });
    const p = created.json?.product;
    check('POST product 201', created.status === 201, String(created.status));
    check('persisted installmentPrice=125000', p?.installmentPrice === 125000, String(p?.installmentPrice));
    check('persisted monthlyInstallment=12500', p?.monthlyInstallment === 12500, String(p?.monthlyInstallment));
    check('persisted installmentMonths=10', p?.installmentMonths === 10, String(p?.installmentMonths));
    check('markup recorded=25', p?.installmentMarkupPercent === 25, String(p?.installmentMarkupPercent));
    check('cashPrice preserved', p?.cashPrice === 100000);

    group('8) قيمة شهرية متناقضة في الجسم تُتجاهَل (لا تُحفظ)');
    const conflict = await call('/api/workspace/products', 'POST', token, { name: 'منتج متناقض', category: 'appliances', cashPrice: 200000, monthlyInstallment: 99999, installmentPrice: 1, installmentMonths: 10 });
    const cp = conflict.json?.product;
    check('conflict ignored: installmentPrice=250000', cp?.installmentPrice === 250000, String(cp?.installmentPrice));
    check('conflict ignored: monthly=25000', cp?.monthlyInstallment === 25000, String(cp?.monthlyInstallment));

    group('9) مدة صريحة (5) → القسط يعاد حسابه');
    const months5 = await call('/api/workspace/products', 'POST', token, { name: 'منتج5', category: 'appliances', cashPrice: 100000, installmentMonths: 5 });
    check('months5 price=125000', months5.json?.product?.installmentPrice === 125000);
    check('months5 monthly=25000', months5.json?.product?.monthlyInstallment === 25000, String(months5.json?.product?.monthlyInstallment));

    group('10) التحقق على الخادم');
    const zero = await call('/api/workspace/products', 'POST', token, { name: 'صفر', category: 'appliances', cashPrice: 0 });
    check('cashPrice=0 => 400', zero.status === 400, String(zero.status));
    const neg = await call('/api/workspace/products', 'POST', token, { name: 'سالب', category: 'appliances', cashPrice: -100 });
    check('cashPrice<0 => 400', neg.status === 400, String(neg.status));
    const badMonths = await call('/api/workspace/products', 'POST', token, { name: 'مدة صفر', category: 'appliances', cashPrice: 100000, installmentMonths: 0 });
    check('months=0 => 400', badMonths.status === 400, String(badMonths.status));

    group('11) TEST 7 (تكامل) — تعديل سعر الكاش يعيد الحساب');
    const id = p?.id;
    const patched = await call(`/api/workspace/products/${encodeURIComponent(String(id))}`, 'PATCH', token, { cashPrice: 150000 });
    check('PATCH cash => price 187500', patched.json?.product?.installmentPrice === 187500, String(patched.json?.product?.installmentPrice));
    check('PATCH cash => monthly 18750', patched.json?.product?.monthlyInstallment === 18750, String(patched.json?.product?.monthlyInstallment));

    group('12) TEST 8 (تكامل) — تعديل المدة يعيد القسط فقط');
    const patchedMonths = await call(`/api/workspace/products/${encodeURIComponent(String(id))}`, 'PATCH', token, { installmentMonths: 5 });
    check('PATCH months => price unchanged 187500', patchedMonths.json?.product?.installmentPrice === 187500, String(patchedMonths.json?.product?.installmentPrice));
    check('PATCH months => monthly 37500', patchedMonths.json?.product?.monthlyInstallment === 37500, String(patchedMonths.json?.product?.monthlyInstallment));

    group('13) التوافق — منتج قديم بلا الحقول الجديدة لا يتأثر ولا يكسر القائمة');
    const list = await call('/api/workspace/products', 'GET', token);
    check('list 200', list.status === 200, String(list.status));
    const legacy = (list.json?.products || []).find((x: any) => x.id === 'prod-legacy');
    check('legacy product intact', legacy && legacy.cashPrice === 50000 && legacy.installmentFrom === 50000);
    // ترحيل الحقول المشتقة للمنتج القديم عند لمسه فقط: لا نغيّر بياناته تلقائياً.
    check('legacy duration untouched', legacy?.durationMonths === 1, String(legacy?.durationMonths));

    group('14) لا مصادقة ⇒ 401');
    const anon = await call('/api/workspace/products', 'POST', undefined, { name: 'x', category: 'appliances', cashPrice: 100000 });
    check('POST without token => 401', anon.status === 401, String(anon.status));
  } finally {
    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    try { proc.kill('SIGKILL'); } catch { /* انتهت */ }
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* unsupported */ }
  }
}

async function main(): Promise<void> {
  unitTests();
  await integrationTests();
  console.log(`\n${'='.repeat(56)}`);
  if (failures.length) {
    console.error(`FAILED: ${failures.length} — passed ${passed}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} product installment price checks`);
}

void main();
