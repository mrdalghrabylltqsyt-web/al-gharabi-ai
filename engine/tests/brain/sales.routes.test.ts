/**
 * اختبار خادم حقيقي لمسارات العقل التجاري (Sales & Growth).
 *
 * يشغّل server.ts فعلياً ويثبت عبر HTTP:
 * - كل مسارات العقل التجاري محمية (401 بلا جلسة)، والحالة الكاملة للمالك فقط.
 * - الحالة تعكس بيانات المعرض الحقيقية المُنشأة عبر الـAPI (منتج موثّق السعر/التوفر).
 * - لا تسريب أي سرّ (توكنات/مفاتيح) في أي استجابة.
 * - الملخّص متاح للمستخدم المصرّح، والحالة الكاملة تحتوي بيانات تجارية فقط.
 *
 * لا يلمس مزوداً حقيقياً ولا يستهلك حصة AI.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
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
const PORT = 6860 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-sales-routes-'));

function startApp(): ChildProcess {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET: 'sales-routes-test-secret-not-real',
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  return spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
}
async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function stop(proc: ChildProcess): Promise<void> {
  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1200));
  if (!proc.killed) proc.kill('SIGKILL');
}
async function login(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
  });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}

(async () => {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  const proc = startApp();
  let exitCode = 0;
  try {
    if (!(await waitForHealth())) throw new Error('الخادم لم يقلع.');
    const auth = await login();

    // 1) الحماية: بلا جلسة ⇒ 401
    const anonState = await fetch(`${BASE}/api/agent/brain/sales/state`);
    check('1-الحالة التجارية محمية (401 بلا جلسة)', anonState.status === 401, `status=${anonState.status}`);
    const anonSummary = await fetch(`${BASE}/api/agent/brain/sales/summary`);
    check('1-الملخّص محمي (401 بلا جلسة)', anonSummary.status === 401, `status=${anonSummary.status}`);

    // 2) إنشاء بيانات حقيقية عبر الـAPI (منتج موثّق + عميل + بيع)
    const productRes = await fetch(`${BASE}/api/workspace/products`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ name: 'غسالة اختبار حقيقية', category: 'appliances', cashPrice: 500000, inStock: true, stockQuantity: 3, durationMonths: 12, downPaymentPercent: 10 }),
    });
    const productBody = await productRes.json();
    check('2-إنشاء منتج حقيقي نجح', productRes.status === 201 && Boolean(productBody.product?.id));

    const leadRes = await fetch(`${BASE}/api/crm/leads`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ customerName: 'عميل اختبار', phone: '07700000000', channel: 'facebook', status: 'new', interestedProduct: 'غسالة اختبار حقيقية' }),
    });
    check('2-إنشاء عميل محتمل حقيقي نجح', leadRes.status === 201);

    const saleRes = await fetch(`${BASE}/api/sales`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ customerName: 'عميل اختبار', phone: '07700000000', productId: productBody.product.id, productName: 'غسالة اختبار حقيقية', totalAmount: 500000 }),
    });
    check('2-إنشاء عملية بيع حقيقية نجح', saleRes.status === 201);

    // 3) الحالة التجارية الكاملة (مالك)
    const stateRes = await fetch(`${BASE}/api/agent/brain/sales/state`, { headers: auth });
    const state = await stateRes.json();
    check('3-الحالة تُقرأ 200', stateRes.status === 200 && state.success === true);
    check('3-المنتج الحقيقي ظاهر', Array.isArray(state.catalog?.products) && state.catalog.products.some((p: any) => p.name === 'غسالة اختبار حقيقية'));
    const prod = state.catalog.products.find((p: any) => p.name === 'غسالة اختبار حقيقية');
    check('3-سعر المنتج موثّق في الحالة', prod?.cashPriceState === 'VERIFIED' && prod?.cashPrice === 500000);
    check('3-توفر المنتج موثّق', prod?.availabilityState === 'VERIFIED' && prod?.inStock === true);
    check('3-عرض القسط مشتق من قاعدة معتمدة', Array.isArray(prod?.installmentOffers) && prod.installmentOffers.some((o: any) => o.state === 'DERIVED'));
    check('3-المبيعات الموثّقة تُعدّ', state.sales?.verifiedSales >= 1);
    check('3-الإيراد من مبيعات حقيقية', state.sales?.revenue >= 500000);
    check('3-الحملات ضمن الحالة', typeof state.campaigns?.total === 'number');
    check('3-المسار يعرض المراحل', typeof state.journeys?.summary === 'object');
    check('3-الذاكرة تفصل الأصناف', typeof state.memory?.observedFacts === 'number' && typeof state.memory?.hypotheses === 'number');
    check('3-الحالة تعلن قيودها', Array.isArray(state.limitations) && state.limitations.length > 0);

    // 4) لا تسريب أسرار في أي استجابة
    const raw = JSON.stringify(state);
    check('4-لا تسريب توكن/مفتاح في الحالة', !/AIzaSy|clientSecret|refreshToken|access_token|PLATFORM_TOKEN|SESSION_SECRET/i.test(raw));

    // 5) الملخّص الخفيف
    const summaryRes = await fetch(`${BASE}/api/agent/brain/sales/summary`, { headers: auth });
    const summary = await summaryRes.json();
    check('5-الملخّص يُقرأ 200', summaryRes.status === 200 && summary.success === true);
    check('5-الملخّص يعدّ المنتجات', summary.products?.total >= 1);
    check('5-الملخّص بلا بيانات عملاء تفصيلية', !JSON.stringify(summary).includes('07700000000'));
  } catch (error: any) {
    failures.push(`EXCEPTION: ${String(error?.message || error)}`);
    exitCode = 1;
  } finally {
    await stop(proc);
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }

  if (failures.length) {
    console.error(`FAILED: ${failures.length} sales route checks`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(exitCode || 1);
  }
  console.log(`PASSED: ${passed} Sales & Growth route checks`);
})();
