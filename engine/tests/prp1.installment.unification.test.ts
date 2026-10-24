/**
 * PR-P1 — توحيد صيغة القسط + إصلاح PATCH.
 *
 * يثبت على خادم حقيقي (مجلد حالة مؤقت + خادم Graph وهمي، بلا مزود/حصة/سرّ):
 *   1) قسط العقل = نفس المعادلة المخزّنة: ceil((cash + markup%) ÷ months)، لا cash÷months.
 *      اختبار القبول: cash=600,000، markup=25%، 12 شهراً ⇒ 62,500 (لا 50,000).
 *   2) PATCH للنسبة فقط على منتج 12 شهراً ⇒ المدة تبقى 12 والقسط = installmentPrice/12.
 *   3) PATCH يحدّث `installmentFrom` ليطابق القسط المشتقّ الجديد.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createFacebookMock, startFacebookMockServer } from './helpers/facebookMock';

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
const APP_PORT = 7620 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FB_PORT = 7720 + Math.floor(Math.random() * 80);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'prp1-unification-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_prp1';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_prp1';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-prp1-'));
const LINKED_POST = 'POST_PRP1_LINKED';

function startApp(fbBase: string): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    FACEBOOK_GRAPH_API_BASE: fbBase, FACEBOOK_DIALOG_BASE: fbBase,
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895', FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: FB_APP_SECRET, FACEBOOK_VERIFY_TOKEN: FB_VERIFY_TOKEN,
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
async function login(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
  });
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${(await res.json()).token}` };
}

async function main(): Promise<void> {
  // منتج مسجّل بـ cash=600,000، markup=25%، 12 شهراً + سجل نشر يربطه بمنشور.
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(),
    users: [{ id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك', avatar: '', active: true, createdAt: new Date().toISOString() }],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: {
      showroom: { name: 'معرض الغرابي' },
      products: [{
        id: 'prod_p1', name: 'ثلاجة اختبار القسط', cashPrice: 600000, downPaymentPercent: 0,
        durationMonths: 12, installmentMonths: 12, installmentMarkupPercent: 25,
        installmentPrice: 750000, monthlyInstallment: 62500, installmentFrom: 62500,
        inStock: true, category: 'appliances',
      }],
      posts: [], socialComments: [], socialReplies: [], socialApprovals: [],
      publishRecords: [{ id: 'pub_p1', platform: 'facebook', postId: 'x', providerPostId: LINKED_POST, productId: 'prod_p1', state: 'published', simulated: false }],
    },
  }), 'utf8');

  // بوابة الموافقة (PR #68) تجعل الافتراضي `approval` فيُحجب الإرسال الآلي؛ هذا
  // الاختبار يفحص نص الرد المُرسل فعلاً، فيُضبط وضع الإرسال `auto` صراحةً للاختبار فقط
  // (نفس نمط meta.watcher.productfacts). لا يغيّر الافتراضي في الإنتاج.
  writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify({ leads: [], sendMode: 'auto' }, null, 2), 'utf8');
  const mock = await startFacebookMockServer(FB_PORT, createFacebookMock({
    feedPosts: [{ id: LINKED_POST, comments: [
      { id: 'C_P1', message: 'كم القسط؟', from: { id: 'U1', name: 'زبون' }, created_time: '2026-03-01T09:00:00+0000' },
    ] }],
  }));
  const app = startApp(mock.base);
  let auth: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    auth = await login();

    group('1) قسط العقل = نفس معادلة المنتج المخزّنة (لا cash÷months)');
    // ربط Facebook عبر OAuth (خادم Graph وهمي) ثم تمكين الرد.
    const startRes = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const state = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
    await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(state)}&code=TESTCODE`);
    await fetch(`${BASE}/api/agent/meta/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, autoReply: true, paused: false }) });
    const poll = await (await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('دورة المراقبة تعمل', poll.success === true, JSON.stringify(poll).slice(0, 200));
    const rep = mock.state.commentReplies.find((r) => r.commentId === 'C_P1');
    const text = String(rep?.message || '');
    check('أُرسل رد فعلي بمعرّف رد حقيقي', Boolean(rep) && /^REPLY_/.test(String(rep?.id)), JSON.stringify(mock.state.commentReplies.map((r) => [r.commentId, r.id])));
    check('الرد يذكر السعر المسجّل (600,000)', /600,000/.test(text), text);
    check('★ القسط في العقل = 62,500 (لا 50,000)', /62,500/.test(text), text);
    check('القسط ليس cash÷months (50,000)', !/50,000/.test(text), text);

    group('2) PATCH للنسبة فقط على منتج 12 شهراً ⇒ المدة تبقى 12 والقسط صحيح');
    const patched = await (await fetch(`${BASE}/api/workspace/products/prod_p1`, {
      method: 'PATCH', headers: auth, body: JSON.stringify({ installmentMarkupPercent: 40 }),
    })).json();
    const p = patched.product;
    check('PATCH 200', patched.success === true, JSON.stringify(patched).slice(0, 200));
    check('★ المدة تبقى 12 (لا تعود 10)', p?.installmentMonths === 12, String(p?.installmentMonths));
    check('سعر التقسيط = 840,000', p?.installmentPrice === 840000, String(p?.installmentPrice));
    check('★ القسط = installmentPrice/12 = 70,000', p?.monthlyInstallment === 70000, String(p?.monthlyInstallment));

    group('3) PATCH يحدّث installmentFrom ليطابق القسط الجديد');
    check('★ installmentFrom = 70,000 (لا 62,500 القديمة)', p?.installmentFrom === 70000, String(p?.installmentFrom));

    group('4) PATCH بسعر الكاش يبقي المدة ويحدّث الحقول معاً');
    const cashPatch = await (await fetch(`${BASE}/api/workspace/products/prod_p1`, {
      method: 'PATCH', headers: auth, body: JSON.stringify({ cashPrice: 600000 }),
    })).json();
    const cp = cashPatch.product;
    check('المدة تبقى 12 بعد تغيير السعر', cp?.installmentMonths === 12, String(cp?.installmentMonths));
    check('النسبة تبقى 40% بعد تغيير السعر', cp?.installmentMarkupPercent === 40, String(cp?.installmentMarkupPercent));
    check('installmentFrom = monthlyInstallment', cp?.installmentFrom === cp?.monthlyInstallment, `${cp?.installmentFrom}/${cp?.monthlyInstallment}`);

    group('5) PATCH صريح لمدة جديدة يُحترم (لا يتجاهله)');
    const monthsPatch = await (await fetch(`${BASE}/api/workspace/products/prod_p1`, {
      method: 'PATCH', headers: auth, body: JSON.stringify({ installmentMonths: 5 }),
    })).json();
    check('مدة 5 تُحترم', monthsPatch.product?.installmentMonths === 5, String(monthsPatch.product?.installmentMonths));
    check('القسط = ceil(840,000/5) = 168,000', monthsPatch.product?.monthlyInstallment === 168000, String(monthsPatch.product?.monthlyInstallment));
  } finally {
    await stop(app.proc);
    await mock.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} — passed ${passed}`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} PR-P1 installment-unification checks`);
}
void main();
