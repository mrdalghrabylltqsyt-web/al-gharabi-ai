/**
 * الجزء 2 — اختبار تكامل حقيقي (B5/B4/B8/B7) على خادم Express الفعلي.
 *
 * يشغّل `server.ts` مع خادم Facebook Graph وهمي محلي (لا مزود حقيقي ولا حصة):
 *   - B5: مهمة معتمدة على منصة غير Telegram تُنفَّذ عبر **نفس المنفّذ الموحّد**
 *         (بدل 501 القديم) وتُثبّت بمعرّف منشور حقيقي من Meta.
 *   - B4: مفتاح التنفيذ التلقائي معطَّل افتراضياً؛ عند تفعيله تُنفَّذ مهمة معتمدة
 *         جاهزة تلقائياً (بلا تدخّل)، وعند تعطيله لا تنفيذ.
 *   - B8: تسجيل بيع مرتبط بالمحادثة + تقرير شهري حتمي (استفسارات/مبيعات لكل منصة).
 *   - B7: كتلة حدود المحادثات معلنة في الصحة/الجاهزية.
 *   - التصريح: 401 بلا جلسة، 403 لغير المالك. ولا تسريب أي سرّ.
 *
 * **يفشل على الكود القديم** (كان executeApprovedJob يرد 501 لغير Telegram، ولا وجود
 * لمسارات التنفيذ التلقائي/المبيعات/التقرير).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFacebookMockServer, createFacebookMock, type FacebookMockState } from './helpers/facebookMock';

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
const APP_PORT = 6400 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FB_PORT = 6500 + Math.floor(Math.random() * 90);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'part2-integration-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_part2';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_not_real_p2';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-part2-'));

const secretBuffer = createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };
const staffUser = { id: 'staff-1', name: 'موظف اختبار', email: 'staff@example.invalid', role: 'staff', roleTitleArabic: 'الموظف', avatar: '', active: true, createdAt: new Date().toISOString() };

function startApp(fbBase: string, extraEnv: Record<string, string> = {}): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    FACEBOOK_GRAPH_API_BASE: fbBase, FACEBOOK_DIALOG_BASE: fbBase,
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895', FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: FB_APP_SECRET, FACEBOOK_VERIFY_TOKEN: FB_VERIFY_TOKEN,
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    ...extraEnv,
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
  const res = await fetch(`${BASE}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}
function signSession(payload: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${b64}.${createHmac('sha256', secretBuffer).update(b64).digest('base64url')}`;
}

async function connectFacebook(auth: Record<string, string>): Promise<void> {
  const start = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
  const state = new URL(start.authorizationUrl).searchParams.get('state') || '';
  await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(state)}&code=TESTCODE`);
}

async function createReadyJob(auth: Record<string, string>, platform: string, content: string): Promise<string> {
  const created = await (await fetch(`${BASE}/api/control/jobs`, { method: 'POST', headers: auth, body: JSON.stringify({ type: 'content_campaign', payload: { platform, content } }) })).json();
  const id = created.job.id as string;
  await fetch(`${BASE}/api/control/jobs/${id}/approve`, { method: 'POST', headers: auth, body: '{}' });
  await fetch(`${BASE}/api/control/jobs/preflight`, { method: 'POST', headers: auth, body: '{}' });
  return id;
}

async function run(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser, staffUser],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: { showroom: {}, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [] },
  }), 'utf8');

  const mock = await startFacebookMockServer(FB_PORT, createFacebookMock() as FacebookMockState);
  let app = startApp(mock.base);
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  const staffAuth: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());
    const staffToken = signSession({ uid: 'staff-1', iat: Date.now(), exp: Date.now() + 3_600_000, sid: randomBytes(8).toString('hex') });
    staffAuth.Authorization = `Bearer ${staffToken}`;

    group('1) التصريح');
    check('jobs/auto-execute بلا جلسة => 401', (await fetch(`${BASE}/api/agent/jobs/auto-execute`)).status === 401);
    check('commercial/sales بلا جلسة => 401', (await fetch(`${BASE}/api/commercial/sales`)).status === 401);
    check('jobs/auto-execute لغير المالك => 403', (await fetch(`${BASE}/api/agent/jobs/auto-execute`, { headers: staffAuth })).status === 403);
    check('commercial/monthly-report لغير المالك => 403', (await fetch(`${BASE}/api/commercial/monthly-report`, { headers: staffAuth })).status === 403);

    group('2) B4: التنفيذ التلقائي معطَّل افتراضياً');
    const autoDefault = await (await fetch(`${BASE}/api/agent/jobs/auto-execute`, { headers: auth })).json();
    check('B4: الافتراضي معطَّل (fail-closed)', autoDefault.autoExecuteApproved === false, JSON.stringify(autoDefault));
    const runDisabled = await (await fetch(`${BASE}/api/agent/jobs/auto-execute/run`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('B4: تشغيل الدورة والمفتاح معطَّل => لا تنفيذ', runDisabled.skipped === 'disabled' && runDisabled.executed === 0, JSON.stringify(runDisabled));

    group('3) ربط Facebook حقيقي (خادم Graph وهمي)');
    await connectFacebook(auth);
    const ready = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const fb = ready.platforms.find((p: any) => p.platform === 'facebook');
    check('Facebook متصل وموثق', fb?.connected === true && fb?.providerVerified === true);

    group('4) B5: تنفيذ مهمة معتمدة عبر المنفّذ الموحّد (بدل 501)');
    const jobId = await createReadyJob(auth, 'facebook', 'مرحباً بكم في معرض الغرابي، نتمنى لكم يوماً طيباً.');
    const jobBefore = (await (await fetch(`${BASE}/api/control/jobs`, { headers: auth })).json()).jobs.find((j: any) => j.id === jobId);
    check('B5: المهمة صارت ready بعد الفحص', jobBefore?.status === 'ready', JSON.stringify(jobBefore?.status));
    const exec = await fetch(`${BASE}/api/control/jobs/${jobId}/execute`, { method: 'POST', headers: auth, body: '{}' });
    const execBody = await exec.json();
    check('B5: التنفيذ ينجح (200 لا 501)', exec.status === 200 && execBody.success === true, `status=${exec.status} body=${JSON.stringify(execBody).slice(0, 200)}`);
    check('B5: تُثبَّت بمعرّف منشور حقيقي من Meta', typeof execBody.receipt?.postId === 'string' && execBody.receipt.postId.startsWith('PAGE_123_'), JSON.stringify(execBody.receipt));
    check('B5: نُشر فعلاً على الصفحة (خادم Graph سجّل المنشور)', mock.state.posts.some((p) => p.pageId === 'PAGE_123'), JSON.stringify(mock.state.posts));
    const jobAfter = (await (await fetch(`${BASE}/api/control/jobs`, { headers: auth })).json()).jobs.find((j: any) => j.id === jobId);
    check('B5: حالة المهمة صارت executed', jobAfter?.status === 'executed', JSON.stringify(jobAfter?.status));
    const execAgain = await fetch(`${BASE}/api/control/jobs/${jobId}/execute`, { method: 'POST', headers: auth, body: '{}' });
    check('B5: لا تنفيذ مزدوج (منع التكرار)', execAgain.status !== 200, `status=${execAgain.status}`);

    group('5) B4: التفعيل ثم تنفيذ تلقائي حقيقي');
    const onRes = await fetch(`${BASE}/api/agent/jobs/auto-execute`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true }) });
    const onBody = await onRes.json();
    check('B4: التفعيل ينجح', onRes.status === 200 && onBody.autoExecuteApproved === true, JSON.stringify(onBody));
    const jobId2 = await createReadyJob(auth, 'facebook', 'مرحباً بكم في معرض الغرابي.');
    const autoRun = await (await fetch(`${BASE}/api/agent/jobs/auto-execute/run`, { method: 'POST', headers: auth, body: '{}' })).json();
    const job2 = (await (await fetch(`${BASE}/api/control/jobs`, { headers: auth })).json()).jobs.find((j: any) => j.id === jobId2);
    check('B4: المهمة المعتمدة الجاهزة نُفّذت تلقائياً', job2?.status === 'executed', `status=${job2?.status} run=${JSON.stringify(autoRun)}`);
    check('B4: الدورة أعلنت التنفيذ', autoRun.executed >= 1, JSON.stringify(autoRun));
    // تعطيل ثم التحقق أن مهمة جديدة جاهزة لا تُنفَّذ.
    await fetch(`${BASE}/api/agent/jobs/auto-execute`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: false }) });
    const jobId3 = await createReadyJob(auth, 'facebook', 'أهلاً وسهلاً بكم في معرض الغرابي.');
    await fetch(`${BASE}/api/agent/jobs/auto-execute/run`, { method: 'POST', headers: auth, body: '{}' });
    const job3 = (await (await fetch(`${BASE}/api/control/jobs`, { headers: auth })).json()).jobs.find((j: any) => j.id === jobId3);
    check('B4: بعد التعطيل لا تنفيذ (المهمة تبقى ready)', job3?.status === 'ready', JSON.stringify(job3?.status));

    group('6) B8: ربط البيع بالمحادثة + التقرير الشهري');
    const saleRes = await fetch(`${BASE}/api/commercial/sales`, { method: 'POST', headers: auth, body: JSON.stringify({ platform: 'facebook', productName: 'ثلاجة سامسونغ', amount: 750000 }) });
    const saleBody = await saleRes.json();
    check('B8: تسجيل البيع ينجح (201)', saleRes.status === 201 && saleBody.success === true, JSON.stringify(saleBody).slice(0, 200));
    check('B8: السجل يحمل المنصة المصدر والمبلغ', saleBody.sale?.sourcePlatform === 'facebook' && saleBody.sale?.amount === 750000, JSON.stringify(saleBody.sale));
    const saleBad = await fetch(`${BASE}/api/commercial/sales`, { method: 'POST', headers: auth, body: JSON.stringify({ productName: 'بلا مبلغ', amount: 0 }) });
    check('B8: بيع بلا مبلغ موجب يُرفض (400)', saleBad.status === 400, `status=${saleBad.status}`);
    const report = await (await fetch(`${BASE}/api/commercial/monthly-report`, { headers: auth })).json();
    check('B8: التقرير يحوي صف فيسبوك بمبيعة واحدة', report.rows?.find((r: any) => r.platform === 'facebook')?.sales === 1, JSON.stringify(report.rows));
    check('B8: مجاميع التقرير صحيحة', report.totals?.sales === 1 && report.totals?.salesValue === 750000, JSON.stringify(report.totals));

    group('7) B7: كتلة حدود المحادثات معلنة');
    const health = await (await fetch(`${BASE}/api/health`)).json();
    check('B7: الصحة تُعلن conversationLimits.max=500', health.conversationLimits?.max === 500, JSON.stringify(health.conversationLimits));
    check('B7: الصحة تُعلن jobAutomation معطَّلاً افتراضياً', health.jobAutomation?.defaultOff === true);
    const readiness = await (await fetch(`${BASE}/api/readiness`)).json();
    check('B7: الجاهزية تُعلن حدود المحادثات', readiness.auth?.conversationLimits?.max === 500);
    check('B7: الجاهزية تُعلن jobAutomation', readiness.auth?.jobAutomation?.defaultOff === true);

    group('8) لا تسريب أي سرّ');
    const log = app.log();
    check('لا يظهر رمز المعاينة في السجلات', !log.includes(PREVIEW_TOKEN));
    check('لا تظهر استجابة الصحة أي سرّ', !JSON.stringify(health).includes(FB_APP_SECRET) && !JSON.stringify(health).includes('PAGE_TOKEN_TEST'));
  } finally {
    try { await stop(app.proc); } catch { /* تجاهل */ }
    try { await mock.stop(); } catch { /* تجاهل */ }
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }

  if (failures.length) {
    console.error(`\nPART2 INTEGRATION TEST FAILED: ${failures.length} failures / ${passed} passed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\nPART2 INTEGRATION TEST PASSED: ${passed} checks`);
}

void run();
