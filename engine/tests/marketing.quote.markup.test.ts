/**
 * اختبار انحدار — قسط المحتوى التسويقي يطابق معادلة الكتالوج (نسبة الزيادة 25٪).
 *
 * العطل: `buildMarketingQuote` كانت تبدأ من سعر الكاش بلا نسبة الزيادة، فتعلن
 * منشورات وكيل التسويق للجمهور قسطاً أقل مما يطبّقه المعرض (مثال: كاش 600,000
 * على 12 شهراً ⇒ المنشور يقول 50,000 والكتالوج 62,500). نفس عطل الرد الذي أصلحه
 * PR #64، لكن في المحتوى المنشور.
 *
 * 1) وحدة: الحسبة الصافية بدفعة 0٪ = monthlyInstallment في الكتالوج حرفياً،
 *    وبدفعة 20٪ تُحسب الدفعة من سعر التقسيط، والنسبة تُقرأ من المنتج.
 * 2) تكامل: خادم حقيقي + منتج مسجّل بـ installmentMonths=12 فقط (بلا durationMonths)
 *    ⇒ المحتوى يذكر 62,500 وسعر التقسيط 750,000، لا 50,000 ولا قسطاً على شهر واحد.
 *
 * بلا مزود خارجي وبلا Gemini وبلا أسرار. يفشل على الكود القديم.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { buildMarketingQuote } from '../workspace/format';
import { computeInstallmentPrice } from '../../src/utils/installmentPrice';
import { reserveFreePort } from './helpers/freePort';

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
const APP_PORT = await reserveFreePort();
const BASE = `http://127.0.0.1:${APP_PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-mq-'));

function startApp(): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET: 'marketing-quote-secret-not-real',
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  delete env.GEMINI_API_KEY; delete env.DATABASE_URL;
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

async function waitForHealth(timeoutMs = 180_000): Promise<boolean> {
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

async function main(): Promise<void> {
  group('1) وحدة: حسبة المحتوى = معادلة الكتالوج');
  const catalog = computeInstallmentPrice({ cashPrice: 600000, installmentMonths: 12 });
  const q0 = buildMarketingQuote(600000, 0, 12);
  check('الكتالوج: سعر التقسيط 750,000 والقسط 62,500', catalog.ok && catalog.installmentPrice === 750000 && catalog.monthlyInstallment === 62500, JSON.stringify(catalog));
  check('★ دفعة 0٪ ⇒ القسط = قسط الكتالوج (62,500 لا 50,000)', q0.monthlyPayment === 62500, JSON.stringify(q0));
  check('سعر التقسيط في الحسبة = 750,000', q0.installmentPrice === 750000, String(q0.installmentPrice));
  check('إجمالي الأقساط = 750,000', q0.totalInstallments === 750000, String(q0.totalInstallments));
  const q20 = buildMarketingQuote(600000, 20, 12);
  check('دفعة 20٪ تُحسب من سعر التقسيط (150,000)', q20.downPayment === 150000, String(q20.downPayment));
  check('القسط بعد الدفعة = ceil(600,000 ÷ 12) = 50,000', q20.monthlyPayment === 50000, String(q20.monthlyPayment));
  const q40 = buildMarketingQuote(600000, 0, 12, 40);
  check('نسبة المنتج (40٪) تُحترم: 840,000 ÷ 12 = 70,000', q40.installmentPrice === 840000 && q40.monthlyPayment === 70000, JSON.stringify(q40));
  const qBad = buildMarketingQuote(600000, 0, 12, -5);
  check('نسبة غير صالحة ⇒ الافتراضي 25٪', qBad.installmentMarkupPercent === 25 && qBad.monthlyPayment === 62500, JSON.stringify(qBad));

  group('2) تكامل: منشور وكيل التسويق يذكر قسط الكتالوج');
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(),
    users: [{ id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك', avatar: '', active: true, createdAt: new Date().toISOString() }],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: {
      showroom: { name: 'معرض الغرابي' },
      // المدة محفوظة في installmentMonths وحدها (بلا durationMonths) — كانت تُقرأ صفراً ⇒ شهر واحد.
      products: [{
        id: 'prod_mq', name: 'ثلاجة اختبار التسويق', cashPrice: 600000, downPaymentPercent: 0,
        installmentMonths: 12, installmentMarkupPercent: 25,
        installmentPrice: 750000, monthlyInstallment: 62500, installmentFrom: 62500,
        inStock: true, category: 'appliances',
      }],
      posts: [],
    },
  }), 'utf8');

  const app = startApp();
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(-600));
    const login = await (await fetch(`${BASE}/api/auth/preview-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
    })).json();
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };

    const res = await fetch(`${BASE}/api/ai/content-brief`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ task: 'اكتب عرضاً تسويقياً يبرز القسط الشهري', productId: 'prod_mq', platforms: ['facebook', 'telegram'] }),
    });
    const body = await res.json();
    const result = body?.result || {};
    const quote = result.quote || {};
    const text = JSON.stringify(result.content || []);
    check('content-brief ينجح (201)', res.status === 201 && body.success === true, `${res.status} ${JSON.stringify(body).slice(0, 300)}`);
    check('★ quote.monthlyPayment = 62,500', quote.monthlyPayment === 62500, JSON.stringify(quote));
    check('quote.months = 12 (من installmentMonths، لا شهر واحد)', quote.months === 12, String(quote.months));
    check('quote.installmentPrice = 750,000', quote.installmentPrice === 750000, String(quote.installmentPrice));
    check('★ نص المنشور يذكر 62,500', text.includes('62,500'), text.slice(0, 400));
    check('نص المنشور يذكر سعر التقسيط 750,000', text.includes('750,000'), text.slice(0, 400));
    // حدّ رقمي صريح: «750,000» تحوي «50,000» كنص فرعي، فلا يكفي includes.
    check('★ نص المنشور لا يذكر القسط الخاطئ 50,000', !/(^|[^\d,])50,000/.test(text), text.slice(0, 400));
    check('لا تحذير «شهر واحد» (المدة مقروءة)', !(result.warnings || []).some((w: string) => w.includes('شهر واحد')), JSON.stringify(result.warnings));
  } finally {
    await stop(app.proc);
    rmSync(stateDir, { recursive: true, force: true });
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} — passed ${passed}`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} marketing-quote-markup checks`);
}

void main();
