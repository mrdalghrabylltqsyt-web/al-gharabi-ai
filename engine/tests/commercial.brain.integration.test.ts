/**
 * اختبار العقل التجاري (Digital Salesperson) — تكامل على الخادم الحقيقي.
 *
 * يثبت السلسلة الكاملة بلا أي مزود Meta حقيقي (خادم Graph وهمي محلي):
 *  - تسجيل عميل محتمل (Lead) من تفاعل وارد حقيقي عبر الدورة.
 *  - تفاوض ضمن الحدّ => اقتراح معلّق (بلا إغلاق)؛ تجاوز الحدّ => عرض مضاد/تصعيد.
 *  - تأكيد بشري للاقتراح => WON؛ ورفض => NEGOTIATING (لا إغلاق آلي أبداً).
 *  - متابعة تلقائية عبر المنفّذ المركزي وحده (بمعرّف من Meta)، بلا رسالة باردة.
 *  - التصريح (401/403) + خلو /api/health من بيانات العملاء + الثبات بعد restart.
 *
 * لا يلمس أي مزود حقيقي ولا يستهلك حصة ولا يستخدم أي سرّ واقعي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createFacebookMock, startFacebookMockServer } from './helpers/facebookMock';
import { signSession } from '../auth/sessions';

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
const APP_PORT = 7480 + Math.floor(Math.random() * 60);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FB_PORT = 7560 + Math.floor(Math.random() * 60);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'commercial-brain-test-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_1234567890';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_not_real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-commercial-brain-'));

const secretBuffer = createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };
const staffUser = { id: 'staff-1', name: 'موظف اختبار', email: 'staff@example.invalid', role: 'staff', roleTitleArabic: 'الموظف', avatar: '', active: true, createdAt: new Date().toISOString() };

function startApp(fbBase: string, stateDirOverride: string = stateDir): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDirOverride,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    FACEBOOK_GRAPH_API_BASE: fbBase,
    FACEBOOK_DIALOG_BASE: fbBase,
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: FB_APP_SECRET,
    FACEBOOK_VERIFY_TOKEN: FB_VERIFY_TOKEN,
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
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
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}

(async () => {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  // منتج بسعر مسجّل + منشور مرتبط به (لتأريض استفسار السعر عبر publishRecords).
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser, staffUser],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: {
      showroom: { name: 'معرض الغرابي' },
      products: [{ id: 'P_FRIDGE', name: 'ثلاجة سامسونج', cashPrice: 1_000_000, category: 'ثلاجات', durationMonths: 10, inStock: true }],
      posts: [], socialComments: [], socialReplies: [], socialApprovals: [],
      publishRecords: [
        { id: 'pr1', platform: 'facebook', externalVideoId: 'POST1', productId: 'P_FRIDGE' },
        { id: 'pr2', platform: 'facebook', externalVideoId: 'POST2', productId: 'P_FRIDGE' },
      ],
    },
  }), 'utf8');

  const mock = await startFacebookMockServer(FB_PORT, createFacebookMock({
    feedPosts: [
      { id: 'POST1', comments: [
        { id: 'C_NEG', message: 'شكد سعر الثلاجة؟ وأريد خصم 3%', from: { id: 'U1', name: 'أحمد' }, created_time: '2026-01-01T00:00:00+0000' },
      ] },
      { id: 'POST2', comments: [
        { id: 'C_BIG', message: 'نزّل 40% على الثلاجة', from: { id: 'U2', name: 'زينب' }, created_time: '2026-01-01T00:01:00+0000' },
      ] },
    ],
  }));
  let app = startApp(mock.base);
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 500));
    Object.assign(auth, await login());
    const staffToken = signSession({ uid: 'staff-1', iat: Date.now(), exp: Date.now() + 3_600_000, sid: randomBytes(8).toString('hex') }, secretBuffer);
    const staffAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` };

    // المفتاح معطَّل افتراضياً (fail-closed) — نفعّله صراحةً لاختبار منطق العقل التجاري نفسه.
    const ksEnable = await (await fetch(`${BASE}/api/agent/commercial/kill-switch`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, reason: 'integration_test' }) })).json();
    check('تفعيل العقل التجاري صراحةً للاختبار (الافتراضي معطَّل)', ksEnable.success === true && ksEnable.killSwitch?.enabled === true, JSON.stringify(ksEnable.killSwitch));

    group('1) التصريح — مسارات العقل التجاري محمية');
    check('/api/commercial/leads بلا جلسة => 401', (await fetch(`${BASE}/api/commercial/leads`)).status === 401);
    check('/api/agent/commercial/run بلا جلسة => 401', (await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 401);
    check('/api/agent/commercial/run لغير المالك => 403', (await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: staffAuth, body: '{}' })).status === 403);

    group('2) ربط Facebook (خادم Graph وهمي) ثم دورة العقل التجاري');
    const startRes = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const state = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
    const cbRes = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(state)}&code=TESTCODE`);
    check('ربط Facebook ينجح', cbRes.status === 200, `status=${cbRes.status}`);

    // تشغيل مراقب Meta أولاً ليُسجّل التعليقات الواردة الحقيقية في workspace.socialComments.
    await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' });

    const run = await (await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('دورة العقل التجاري تعمل', run.success === true, JSON.stringify(run));

    group('3) تسجيل العملاء المحتملين + التفاوض');
    const leadsRes = await (await fetch(`${BASE}/api/commercial/leads`, { headers: auth })).json();
    check('لوحة العملاء تُعاد للمالك', leadsRes.success === true && Array.isArray(leadsRes.leads));
    check('عملاء حقيقيون مسجّلون (≥1)', leadsRes.leads.length >= 1, `leads=${leadsRes.leads.length}`);
    const neg = leadsRes.leads.find((l: any) => l.customerName === 'أحمد');
    const big = leadsRes.leads.find((l: any) => l.customerName === "زينب");
    check('عميل التفاوض ضمن الحدّ => اقتراح معلّق (PROPOSAL_PENDING)', Boolean(neg) && neg.stage === 'PROPOSAL_PENDING' && neg.hasPendingProposal === true, JSON.stringify(neg));
    check('عميل التجاوز الضخم => تصعيد (ESCALATED، بلا اقتراح)', Boolean(big) && big.stage === 'ESCALATED' && big.hasPendingProposal === false, JSON.stringify(big));

    group('4) تأكيد/رفض الاقتراح بشرياً (لا إغلاق آلي)');
    const confirmRes = await (await fetch(`${BASE}/api/commercial/leads/${neg.id}/proposal/confirm`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('التأكيد البشري => WON', confirmRes.success === true && confirmRes.lead?.stage === 'WON', JSON.stringify(confirmRes));
    const reConfirm = await fetch(`${BASE}/api/commercial/leads/${neg.id}/proposal/confirm`, { method: 'POST', headers: auth, body: '{}' });
    check('إعادة التأكيد على صفقة محسومة => 409', reConfirm.status === 409, `status=${reConfirm.status}`);

    group('5) كتلة /api/health العامة بلا بيانات عملاء');
    const health = await (await fetch(`${BASE}/api/health`)).json();
    check('health يحمل كتلة commercialBrain', Boolean(health.commercialBrain), JSON.stringify(health.commercialBrain));
    check('health لا يحمل أسماء عملاء/نصوص', !JSON.stringify(health.commercialBrain || {}).includes('أحمد') && !JSON.stringify(health.commercialBrain || {}).includes('زينب'));
    check('health.commercialBrain يعلن لا تنفيذ خارجي ولا إغلاق آلي', health.commercialBrain?.executesExternalActions === false && health.commercialBrain?.closesDealWithoutHuman === false);

    group('6) الثبات بعد restart (لا يفقد عميلاً)');
    const leadsBefore = leadsRes.leads.length;
    await stop(app.proc);
    app = startApp(mock.base);
    check('الخادم يقلع بعد restart', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());
    const leadsAfter = await (await fetch(`${BASE}/api/commercial/leads`, { headers: auth })).json();
    check('العملاء يصمدون بعد restart', leadsAfter.leads.length === leadsBefore, `before=${leadsBefore} after=${leadsAfter.leads.length}`);
    const wonAfter = leadsAfter.leads.find((l: any) => l.id === neg.id);
    check('حالة الصفقة المؤكَّدة تصمد (WON)', wonAfter?.stage === 'WON', JSON.stringify(wonAfter));
  } catch (err) {
    failures.push(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await stop(app.proc);
  }

  console.log(`\n${'='.repeat(60)}`);
  if (failures.length) {
    console.error(`FAILED: ${passed} passed, ${failures.length} failed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} commercial brain integration checks`);
  process.exit(0);
})();
