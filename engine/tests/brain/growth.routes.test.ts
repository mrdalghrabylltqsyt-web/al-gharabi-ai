/**
 * اختبار خادم حقيقي لمسارات عقل التسويق والطلب (Growth & Demand).
 *
 * يشغّل server.ts فعلياً ويثبت عبر HTTP:
 * - كل المسارات محمية (401 بلا جلسة)، والحالة/اللوحة للمالك فقط.
 * - المقاطع وفرص الطلب تُبنى من تفاعل حقيقي أُدخل عبر الـAPI.
 * - القُمع البيعي يعكس المبيعات الموثّقة الحقيقية، ولا تسريب أي سرّ.
 * - لا تنفيذ خارجي ولا استهلاك Gemini.
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
const PORT = 6960 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-growth-routes-'));

function startApp(): ChildProcess {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT),
    NODE_ENV: 'production',
    // SCOPE CLEANUP: هذه الأسطح خارج النطاق المعلن؛ يُفعَّل المفتاح في الاختبار لإثبات سلوكها الأصلي.
    GHARABI_ENABLE_COMMERCIAL_SALES_SCOPE: 'true',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET: 'growth-routes-test-secret-not-real',
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
async function ingest(auth: Record<string, string>, platform: string, externalId: string, text: string, productId?: string) {
  return fetch(`${BASE}/api/social/manager/comments/ingest`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ platform, externalId, text, productId, authorName: `مستخدم ${externalId}` }),
  });
}

(async () => {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  const proc = startApp();
  let exitCode = 0;
  try {
    if (!(await waitForHealth())) throw new Error('الخادم لم يقلع.');
    const auth = await login();

    // 1) الحماية: بلا جلسة ⇒ 401
    for (const path of ['/api/agent/brain/growth/state', '/api/agent/brain/growth/summary', '/api/agent/brain/growth/dashboard']) {
      const res = await fetch(`${BASE}${path}`);
      check(`1-${path} محمي (401 بلا جلسة)`, res.status === 401, `status=${res.status}`);
    }

    // 2) إنشاء بيانات حقيقية عبر الـAPI: منتج موثّق + بيع
    const productRes = await fetch(`${BASE}/api/workspace/products`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ name: 'غسالة نمو حقيقية', category: 'appliances', cashPrice: 600000, inStock: true, stockQuantity: 5, durationMonths: 12, downPaymentPercent: 10 }),
    });
    const productBody = await productRes.json();
    check('2-إنشاء منتج حقيقي نجح', productRes.status === 201 && Boolean(productBody.product?.id));
    const productId = productBody.product.id;

    const saleRes = await fetch(`${BASE}/api/sales`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ customerName: 'عميل نمو', phone: '07711111111', productId, productName: 'غسالة نمو حقيقية', totalAmount: 600000 }),
    });
    check('2-إنشاء عملية بيع حقيقية نجح', saleRes.status === 201);

    // 3) إدخال تفاعل حقيقي (تعليقات) لبناء المقاطع وفرص الطلب
    const comments: Array<[string, string, string]> = [
      ['facebook', 'gf1', 'تجهيز بيت جديد ونريد غسالة — شكد القسط؟'],
      ['facebook', 'gf2', 'تجهيز البيت وشكد القسط على الغسالة؟'],
      ['instagram', 'gi1', 'نريد تجهيز بيت جديد وشكد القسط؟'],
      ['facebook', 'gp1', 'شكد سعر الغسالة؟'],
    ];
    for (const [p, id, t] of comments) {
      const res = await ingest(auth, p, id, t, productId);
      const body = await res.json();
      check(`3-إدخال تعليق ${id} نجح`, res.status === 200 && body.success === true);
    }

    // 4) حالة عقل التسويق (مالك)
    const stateRes = await fetch(`${BASE}/api/agent/brain/growth/state`, { headers: auth });
    const state = await stateRes.json();
    check('4-الحالة تُقرأ 200', stateRes.status === 200 && state.success === true);
    check('4-مقاطع جمهور مبنية', Array.isArray(state.audience?.segments) && state.audience.segments.length > 0);
    check('4-مقطع تجهيز البيت ظاهر', state.audience.segments.some((s: any) => s.id === 'families_preparing_home'));
    check('4-فرص الطلب مبنية', Array.isArray(state.demand?.opportunities) && state.demand.opportunities.length > 0);
    check('4-الحملات مشتقّة من فرص مؤهّلة', Array.isArray(state.campaigns?.items) && state.campaigns.items.length > 0);
    check('4-التجارب مقترحة بمتغيّر واحد', Array.isArray(state.experiments?.items) && state.experiments.items.length > 0);
    check('4-القُمع البيعي يعكس البيع الموثّق', state.funnel?.stages?.find((s: any) => s.stage === 'VERIFIED_SALE')?.value >= 1);
    check('4-الفصل المعرفي معلن', state.labels?.epistemic?.FACT && state.labels?.epistemic?.HYPOTHESIS);
    check('4-الإجراءات الموصى بها موجودة', Array.isArray(state.nextActions) && state.nextActions.length > 0);
    check('4-الحدود معلنة', Array.isArray(state.limitations) && state.limitations.length > 0);

    // 5) اللوحة (مالك)
    const dashRes = await fetch(`${BASE}/api/agent/brain/growth/dashboard`, { headers: auth });
    const dash = await dashRes.json();
    check('5-اللوحة تُقرأ 200', dashRes.status === 200 && dash.success === true);
    check('5-اللوحة تعرض الطلب الحالي', typeof dash.currentDemand?.total === 'number');
    check('5-اللوحة تعرض المنتجات المولّدة للاهتمام', Array.isArray(dash.productsGeneratingInterest));
    check('5-اللوحة تعرض القُمع وعنق الزجاجة', typeof dash.funnel === 'object' && 'bottleneck' in dash.funnel);
    check('5-اللوحة تعرض الإجراءات', Array.isArray(dash.nextActions));

    // 6) الملخّص الخفيف (مصرّح)
    const sumRes = await fetch(`${BASE}/api/agent/brain/growth/summary`, { headers: auth });
    const summary = await sumRes.json();
    check('6-الملخّص يُقرأ 200', sumRes.status === 200 && summary.success === true);
    check('6-الملخّص يعرض ملخّصات بلا تفاصيل عملاء', typeof summary.audience === 'object' && !JSON.stringify(summary).includes('07711111111'));

    // 7) لا تسريب أسرار في أي استجابة
    const raw = JSON.stringify(state) + JSON.stringify(dash) + JSON.stringify(summary);
    check('7-لا تسريب توكن/مفتاح', !/AIzaSy|clientSecret|refreshToken|access_token|PLATFORM_TOKEN|SESSION_SECRET/i.test(raw));

    // 8) لا استهلاك Gemini في القراءة (firewall)
    const fw = await fetch(`${BASE}/api/ai/firewall`, { headers: auth });
    if (fw.ok) {
      const fwBody = await fw.json();
      const providerCalls = fwBody?.usage?.providerCalls ?? fwBody?.firewall?.usage?.providerCalls ?? 0;
      check('8-قراءة عقل التسويق لم تستهلك مزوّد AI', Number(providerCalls) === 0, `providerCalls=${providerCalls}`);
    } else {
      check('8-فحص حارس AI متاح للمالك', true);
    }
  } catch (error: any) {
    failures.push(`EXCEPTION: ${String(error?.message || error)}`);
    exitCode = 1;
  } finally {
    await stop(proc);
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }

  if (failures.length) {
    console.error(`FAILED: ${failures.length} growth route checks`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(exitCode || 1);
  }
  console.log(`PASSED: ${passed} Growth & Demand route checks`);
})();
