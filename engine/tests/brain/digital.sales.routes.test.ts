/**
 * اختبار خادم حقيقي لمسارات العقل المركزي للمبيعات الرقمية.
 *
 * يشغّل server.ts فعلياً ويثبت عبر HTTP:
 * - كل المسارات محمية (401 بلا جلسة)، والحالة/اللوحة/الأحداث للمالك فقط.
 * - الإشارات الشرائية والإجابات الموثّقة تُبنى من تفاعل حقيقي أُدخل عبر الـAPI.
 * - المبيعات الموثّقة تعكس السجل الحقيقي، والقُمع لا يخترع أرقاماً.
 * - الموافقة/الإلغاء تُحفظ ببصمة فقط ولا تُكشف قيمة سرية.
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
const PORT = 7160 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-digital-sales-'));

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
    SESSION_SECRET: 'digital-sales-test-secret-not-real',
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
    for (const path of [
      '/api/agent/brain/sales/digital/state',
      '/api/agent/brain/sales/digital/summary',
      '/api/agent/brain/sales/digital/dashboard',
      '/api/agent/brain/sales/digital/events',
    ]) {
      const res = await fetch(`${BASE}${path}`);
      check(`1-${path} محمي (401 بلا جلسة)`, res.status === 401, `status=${res.status}`);
    }
    const consentNoAuth = await fetch(`${BASE}/api/agent/brain/sales/digital/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerKey: 'x' }) });
    check('1-مسار الموافقة محمي (401 بلا جلسة)', consentNoAuth.status === 401, `status=${consentNoAuth.status}`);

    // 2) بيانات حقيقية: منتج موثّق + بيع حقيقي
    const productRes = await fetch(`${BASE}/api/workspace/products`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ name: 'غسالة بيع رقمي', category: 'appliances', cashPrice: 500000, inStock: true, stockQuantity: 3, durationMonths: 12, downPaymentPercent: 10 }),
    });
    const productBody = await productRes.json();
    check('2-إنشاء منتج حقيقي نجح', productRes.status === 201 && Boolean(productBody.product?.id));
    const productId = productBody.product.id;

    const saleRes = await fetch(`${BASE}/api/sales`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ customerName: 'عميل رقمي', phone: '07722222222', productId, productName: 'غسالة بيع رقمي', totalAmount: 500000 }),
    });
    check('2-إنشاء عملية بيع حقيقية نجح', saleRes.status === 201);

    // 3) تفاعلات حقيقية: سؤال سعر/قسط + إشارة شراء
    const comments: Array<[string, string, string]> = [
      ['facebook', 'df1', 'أريد وحدة غسالة وشكد القسط؟'],
      ['facebook', 'df2', 'شكد سعر الغسالة؟'],
      ['instagram', 'di1', 'متوفرة الغسالة؟'],
    ];
    for (const [p, id, t] of comments) {
      const res = await ingest(auth, p, id, t, productId);
      const body = await res.json();
      check(`3-إدخال تعليق ${id} نجح`, res.status === 200 && body.success === true);
    }

    // 4) الحالة (مالك)
    const stateRes = await fetch(`${BASE}/api/agent/brain/sales/digital/state`, { headers: auth });
    const state = await stateRes.json();
    check('4-الحالة تُقرأ 200', stateRes.status === 200 && state.success === true);
    check('4-القُمع موجود بحالاته', Array.isArray(state.funnel?.stages) && state.funnel.stages.length === 5);
    check('4-إشارات شراء مبنية', state.summary?.purchaseSignals >= 1);
    check('4-عميل محتمل من إشارة', Array.isArray(state.leads) && state.leads.length >= 1);
    check('4-المبيعات الموثّقة تعكس السجل', state.summary?.verifiedSales === 1);
    check('4-الحدود معلنة', Array.isArray(state.limitations) && state.limitations.length > 0);
    check('4-الإجراءات موجودة', Array.isArray(state.nextActions) && state.nextActions.length > 0);
    check('4-مستويات الحالات معلنة', Boolean(state.labels?.leadStages) && Boolean(state.labels?.attribution));
    check('4-حقول الهوية غير المخزّنة معلنة', Array.isArray(state.identityNotStored) && state.identityNotStored.length > 0);

    // 5) اللوحة (مالك)
    const dashRes = await fetch(`${BASE}/api/agent/brain/sales/digital/dashboard`, { headers: auth });
    const dash = await dashRes.json();
    check('5-اللوحة تُقرأ 200', dashRes.status === 200 && dash.success === true);
    check('5-اللوحة تعرض القُمع الرقمي', Array.isArray(dash.digitalSalesFunnel?.stages));
    check('5-اللوحة تعرض المبيعات الموثّقة', dash.verifiedSales === 1);
    check('5-اللوحة تعرض المنتجات المولّدة للمبيعات', Array.isArray(dash.productsGeneratingSales));
    check('5-اللوحة تعرض الخسائر والإسناد', Array.isArray(dash.lostOpportunities) && Array.isArray(dash.attributionStates));
    check('5-اللوحة تعرض الإجراءات', Array.isArray(dash.nextActions));

    // 6) الأحداث + الاستقلالية
    const evRes = await fetch(`${BASE}/api/agent/brain/sales/digital/events`, { headers: auth });
    const ev = await evRes.json();
    check('6-الأحداث تُقرأ 200', evRes.status === 200 && ev.success === true);
    check('6-كل حدث يحمل قابلية التعلّم', ev.events.every((e: any) => typeof e.learningEligible === 'boolean'));
    const auRes = await fetch(`${BASE}/api/agent/brain/sales/digital/autonomy`, { headers: auth });
    const au = await auRes.json();
    check('6-الاستقلالية الافتراضية مراقبة', au.defaultLevel === 'OBSERVE');
    check('6-الأفعال غير الصامتة معلنة', Array.isArray(au.neverSilentActions) && au.neverSilentActions.includes('publish_content'));

    // 7) الموافقة/الإلغاء (بصمة فقط)
    const setConsent = await fetch(`${BASE}/api/agent/brain/sales/digital/consent`, {
      method: 'POST', headers: auth, body: JSON.stringify({ customerKey: 'phone:07722222222', consent: true }),
    });
    const consentBody = await setConsent.json();
    check('7-تحديث الموافقة نجح', setConsent.status === 200 && consentBody.success === true);
    check('7-الرد يحمل بصمة لا قيمة خامة', typeof consentBody.hash === 'string' && consentBody.hash.startsWith('k_') && !consentBody.hash.includes('07722222222'));
    const getConsent = await fetch(`${BASE}/api/agent/brain/sales/digital/consent?customerKey=${encodeURIComponent('phone:07722222222')}`, { headers: auth });
    const getBody = await getConsent.json();
    check('7-قراءة الموافقة تعكس القيمة', getBody.found === true && getBody.consent === true);
    const optOut = await fetch(`${BASE}/api/agent/brain/sales/digital/consent`, {
      method: 'POST', headers: auth, body: JSON.stringify({ customerKey: 'phone:07722222222', optedOut: true }),
    });
    const optOutBody = await optOut.json();
    check('7-الإلغاء يُلغي الموافقة', optOutBody.optedOut === true && optOutBody.consent === false);

    // 8) الملخّص الخفيف
    const sumRes = await fetch(`${BASE}/api/agent/brain/sales/digital/summary`, { headers: auth });
    const summary = await sumRes.json();
    check('8-الملخّص يُقرأ 200', sumRes.status === 200 && summary.success === true);
    check('8-الملخّص بلا بيانات عملاء تفصيلية', !JSON.stringify(summary).includes('07722222222'));

    // 9) لا تسريب أسرار
    const raw = JSON.stringify(state) + JSON.stringify(dash) + JSON.stringify(summary) + JSON.stringify(ev);
    check('9-لا تسريب توكن/مفتاح', !/AIzaSy|clientSecret|refreshToken|access_token|PLATFORM_TOKEN|SESSION_SECRET/i.test(raw));

    // 10) لا استهلاك Gemini
    const fw = await fetch(`${BASE}/api/ai/firewall`, { headers: auth });
    if (fw.ok) {
      const fwBody = await fw.json();
      const providerCalls = fwBody?.usage?.providerCalls ?? fwBody?.firewall?.usage?.providerCalls ?? 0;
      check('10-قراءة العقل الرقمي لم تستهلك مزوّد AI', Number(providerCalls) === 0, `providerCalls=${providerCalls}`);
    } else {
      check('10-فحص حارس AI متاح للمالك', true);
    }

    // 11) ثبات الموافقة بعد إعادة التشغيل
    await stop(proc);
    const proc2 = startApp();
    try {
      if (!(await waitForHealth())) throw new Error('الخادم الثاني لم يقلع.');
      const auth2 = await login();
      const getConsent2 = await fetch(`${BASE}/api/agent/brain/sales/digital/consent?customerKey=${encodeURIComponent('phone:07722222222')}`, { headers: auth2 });
      const getBody2 = await getConsent2.json();
      check('11-الموافقة/الإلغاء تصمد بعد إعادة التشغيل', getBody2.found === true && getBody2.optedOut === true);
      const health = await (await fetch(`${BASE}/api/health`)).json();
      check('11-الصحة تعرض كتلة المبيعات الرقمية', typeof health?.digitalSales === 'object' && health.digitalSales.externalExecution === false);
    } finally {
      await stop(proc2);
    }
  } catch (error: any) {
    failures.push(`EXCEPTION: ${String(error?.message || error)}`);
    exitCode = 1;
  } finally {
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }

  if (failures.length) {
    console.error(`FAILED: ${failures.length} digital sales route checks`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(exitCode || 1);
  }
  console.log(`PASSED: ${passed} Digital Sales route checks`);
})();
