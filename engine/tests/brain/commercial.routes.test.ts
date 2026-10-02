/**
 * اختبار خادم حقيقي لمسارات العقل التجاري المركزي الموحّد (الدفعة 4).
 *
 * يشغّل server.ts فعلياً ويثبت عبر HTTP:
 * - كل المسارات محمية (401 بلا جلسة)، والحالة/المراكز/القدرات للمالك فقط.
 * - العقل الموحّد يعكس البيانات الحقيقية (منتج موثّق + بيع حقيقي + تفاعل).
 * - الغاية العليا معلنة، والربح غير متاح بلا تكلفة، والمقاييس الوهمية لا تُعتمد هدفاً.
 * - القدرات محسوبة من الأدلة، والإصدار v2.0، والصحة تُعلن.
 * - لا تسريب أسرار، ولا استهلاك Gemini، ولا تنفيذ خارجي.
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
const PORT = 7360 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-commercial-brain-'));

function startApp(): ChildProcess {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET: 'commercial-brain-test-secret-not-real',
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
      '/api/agent/brain/commercial/state',
      '/api/agent/brain/commercial/summary',
      '/api/agent/brain/commercial/command-center',
      '/api/agent/brain/commercial/owner-control',
      '/api/agent/brain/commercial/capabilities',
      '/api/agent/brain/commercial/health',
      '/api/agent/brain/commercial/operating-loop',
    ]) {
      const res = await fetch(`${BASE}${path}`);
      check(`1-${path} محمي (401 بلا جلسة)`, res.status === 401, `status=${res.status}`);
    }

    // 2) بيانات حقيقية: منتج موثّق + بيع حقيقي + تفاعل.
    const productRes = await fetch(`${BASE}/api/workspace/products`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ name: 'غسالة العقل الموحّد', category: 'appliances', cashPrice: 500000, inStock: true, stockQuantity: 3, durationMonths: 12, downPaymentPercent: 10 }),
    });
    const productBody = await productRes.json();
    check('2-إنشاء منتج حقيقي نجح', productRes.status === 201 && Boolean(productBody.product?.id));
    const productId = productBody.product.id;

    const saleRes = await fetch(`${BASE}/api/sales`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ customerName: 'عميل موحّد', phone: '07733333333', productId, productName: 'غسالة العقل الموحّد', totalAmount: 500000 }),
    });
    check('2-إنشاء عملية بيع حقيقية نجح', saleRes.status === 201);

    for (const [p, id, t] of [
      ['facebook', 'cb1', 'أريد وحدة غسالة وشكد القسط؟'],
      ['facebook', 'cb2', 'شكد سعر الغسالة؟'],
      ['instagram', 'cb3', 'الغسالة متوفرة؟'],
    ] as Array<[string, string, string]>) {
      const res = await ingest(auth, p, id, t, productId);
      const body = await res.json();
      check(`2-إدخال تعليق ${id} نجح`, res.status === 200 && body.success === true);
    }

    // 3) الحالة الكاملة (مالك)
    const stateRes = await fetch(`${BASE}/api/agent/brain/commercial/state`, { headers: auth });
    const state = await stateRes.json();
    check('3-الحالة تُقرأ 200', stateRes.status === 200 && state.success === true);
    check('3-الغاية العليا معلنة', typeof state.northStarStatement === 'string' && state.northStarStatement.includes('المبيعات'));
    check('3-الإصدار v2.0', state.version === 'v2.0');
    check('3-الغاية العليا: بيع أول', state.northStar.objectives[0].tier === 'PRIMARY');
    check('3-الربح غير متاح بلا تكلفة (حرس)', state.northStar.profitGuard !== null);
    check('3-ذكاء المنتجات يُبنى', Array.isArray(state.productIntel) && state.productIntel.length >= 1);
    check('3-الفرص المرتّبة موجودة', Array.isArray(state.prioritizedOpportunities));
    check('3-دورة العميل تُبنى', Array.isArray(state.lifecycle) && state.lifecycle.length >= 1);
    check('3-أولويات العملاء تُبنى', Array.isArray(state.leadPriorities));
    check('3-الحملات تقاريرها موجودة', Array.isArray(state.campaignReports));
    check('3-التجارب موجودة', Array.isArray(state.experiments));
    check('3-الإسناد موجود', Array.isArray(state.attributions));
    check('3-التعلّم ملخّصه موجود', Boolean(state.learning));
    check('3-البحث ملخّصه موجود', Boolean(state.research));
    check('3-الاقتراحات الذاتية موجودة', Array.isArray(state.selfImprovementProposals));
    check('3-تطوّر القدرات موجود', Boolean(state.capabilityEvolution));
    check('3-صحة النظام معلنة', Boolean(state.systemHealth) && typeof state.systemHealth.overall === 'string');
    check('3-الإصدارات معلنة', Array.isArray(state.versions) && state.versions.length >= 4);
    check('3-بنية الأحداث معلنة', Boolean(state.eventArchitecture));
    check('3-ملخّص الحقيقة معلن', Boolean(state.truthSummary));
    check('3-الحدود معلنة', Array.isArray(state.limitations) && state.limitations.length > 0);

    // 4) لا مبيعات مُختلقة: البيع الموثّق يعكس السجل الحقيقي (1).
    const verified = state.northStar.objectives.find((o: any) => o.tier === 'PRIMARY');
    check('4-المبيعات الموثّقة تعكس السجل (1)', verified.value === 1);

    // 5) القدرات محسوبة من الأدلة (لا نِسَب عشوائية)
    const capRes = await fetch(`${BASE}/api/agent/brain/commercial/capabilities`, { headers: auth });
    const cap = await capRes.json();
    check('5-القدرات تُقرأ', capRes.status === 200 && Boolean(cap.capabilityEvolution));
    check('5-عدّ المستويات معلن', Boolean(cap.capabilityEvolution.counts));
    check('5-لا نِسَب مئوية عشوائية في القدرات', !JSON.stringify(cap.capabilityEvolution).includes('%'));

    // 6) مركز القيادة + مركز التحكّم
    const cmdRes = await fetch(`${BASE}/api/agent/brain/commercial/command-center`, { headers: auth });
    const cmd = await cmdRes.json();
    check('6-مركز القيادة يُقرأ', cmdRes.status === 200 && Boolean(cmd.commandCenter));
    check('6-مركز القيادة يحمل المبيعات الحقيقية', cmd.commandCenter.verifiedSales === 1);
    check('6-الربح غير متاح (NOT_AVAILABLE لا صفر)', cmd.commandCenter.profit === null);
    const ownerRes = await fetch(`${BASE}/api/agent/brain/commercial/owner-control`, { headers: auth });
    const owner = await ownerRes.json();
    check('6-مركز التحكّم يُقرأ', ownerRes.status === 200 && Boolean(owner.ownerControlCenter));
    check('6-مركز التحكّم يحمل الحقول الاثني عشر', ['whatBrainKnows', 'whatItLearned', 'whatItWatches', 'whatItDiscovered', 'whatItRecommends', 'whatItExpects', 'whatActuallyHappened', 'whatChanged', 'whatFailed', 'needsOwnerApproval', 'willTestNext', 'proposesToImprove'].every((k) => Array.isArray(owner.ownerControlCenter[k])));

    // 7) الملخّص (أي مستخدم مصرّح) — بلا بيانات عملاء تفصيلية
    const sumRes = await fetch(`${BASE}/api/agent/brain/commercial/summary`, { headers: auth });
    const sum = await sumRes.json();
    check('7-الملخّص يُقرأ', sumRes.status === 200 && sum.success === true);
    check('7-الملخّص لا يكشف بيانات عملاء', !JSON.stringify(sum).includes('07733333333'));

    // 8) الصحة عبر /api/health: كتلة العقل التجاري
    const healthRes = await fetch(`${BASE}/api/health`);
    const health = await healthRes.json();
    check('8-كتلة commercialBrain موجودة', Boolean(health.commercialBrain));
    check('8-الإصدار في الصحة v2.0', health.commercialBrain.version === 'v2.0');
    check('8-لا تنفيذ خارجي في الصحة', health.commercialBrain.externalExecution === false);
    check('8-الربح غير متاح في الصحة', health.commercialBrain.verifiedProfitAvailable === false);

    // 9) لا تسريب أسرار في أي استجابة
    const raw = JSON.stringify(state) + JSON.stringify(owner) + JSON.stringify(cmd) + JSON.stringify(health.commercialBrain);
    check('9-لا تسريب توكن/مفتاح', !/AIzaSy|clientSecret|refreshToken|access_token|PLATFORM_TOKEN|SESSION_SECRET|commercial-brain-test-secret/i.test(raw));

    // 10) دورة التشغيل: التقدّم موقوف على موافقة المالك
    const loopRes = await fetch(`${BASE}/api/agent/brain/commercial/operating-loop`, { headers: auth });
    const loop = await loopRes.json();
    check('10-دورة التشغيل تُقرأ', loopRes.status === 200 && Boolean(loop.operatingLoop));
    check('10-التقدّم موقوف على موافقة المالك', loop.operatingLoop.blockedOnOwnerApproval === true);
    check('10-الأسئلة التجارية معلنة', Array.isArray(loop.questions) && loop.questions.length >= 15);
  } catch (error: any) {
    failures.push(`استثناء غير متوقّع: ${String(error?.message || error)}`);
    exitCode = 1;
  } finally {
    await stop(proc);
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }

  if (failures.length) {
    console.error(`\nFAILED: ${failures.length} فحصاً`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} Unified Commercial Brain (routes) checks`);
  process.exit(exitCode);
})();
