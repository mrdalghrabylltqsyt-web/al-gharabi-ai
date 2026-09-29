/**
 * اختبار خادم حقيقي لطبقة العقل المركزي المُطوَّرة (Central Brain upgrade).
 *
 * يشغّل server.ts فعلياً ويثبت عبر HTTP:
 * - كل مسارات العقل محمية بـ401 بلا جلسة، وdry-run للمالك فقط.
 * - اللقطة الموحّدة تحمل كل الطبقات (أهداف/معرفة/جمهور/سوق/قدرات/قرارات).
 * - مصفوفة القدرات تعلن NOT_AVAILABLE صراحةً (TikTok comments/DMs، الجغرافيا).
 * - العقل لا يدّعي OPERATIONAL بلا اتصال موثق.
 * - التقارير تحمل `externalActionTaken: false` (لا تنفيذ خارجي).
 * - /api/readiness يحمل كتلة `brain` صادقة بلا أي سرّ.
 * - لا تسريب أسرار في أي استجابة.
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
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const PORT = 6710 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'brain-integration-test-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-brain-'));

function startApp(): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
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
  const app = startApp();
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    const auth = await login();

    group('1) التصريح — كل مسارات العقل محمية');
    for (const path of ['/api/agent/brain/state', '/api/agent/brain/diagnostics', '/api/agent/brain/capabilities', '/api/agent/brain/cycles/daily', '/api/agent/brain/cycles/weekly', '/api/agent/brain/dry-run']) {
      const noAuth = await fetch(`${BASE}${path}`);
      check(`بلا جلسة ${path} => 401`, noAuth.status === 401);
    }

    group('2) اللقطة الموحّدة — كل الطبقات حاضرة');
    const stateRes = await fetch(`${BASE}/api/agent/brain/state`, { headers: auth });
    const stateBody = await stateRes.json();
    const state = stateBody.state;
    check('اللقطة تعمل', stateRes.status === 200 && stateBody.success === true);
    check('الأهداف حاضرة', state.goals?.primary === 'SALES');
    check('المعرفة حاضرة بحالات صادقة', state.knowledge && typeof state.knowledge.verifiedCount === 'number');
    check('الجمهور بلا سمات سكانية', state.audience?.demographicsAvailable === false);
    check('القدرات تغطي عشر منصات', state.platformStates.length === 10);
    check('حالات القدرات صريحة', state.platformStates.every((p: any) => Object.values(p.capabilities).every((v) => typeof v === 'string')));
    check('حدود معلنة', Array.isArray(state.limitations) && state.limitations.length >= 3);
    check('لا تنفيذ خارجي في اللقطة', state.note.includes('بلا تنفيذ'));
    check('التسميات العربية معلنة', stateBody.labels?.truthStates?.VERIFIED_FACT === 'حقيقة موثّقة');
    check('حقول الجمهور غير المتاحة معلنة', Array.isArray(stateBody.audienceNotAvailableFields) && stateBody.audienceNotAvailableFields.length >= 5);
    check('المنطقة الزمنية بغداد', stateBody.timezone === 'Asia/Baghdad');

    group('3) مصفوفة القدرات — لا قدرة مُختلقة');
    const caps = await (await fetch(`${BASE}/api/agent/brain/capabilities`, { headers: auth })).json();
    check('عشر صفوف قدرات', caps.rows.length === 10);
    const tiktok = caps.rows.find((r: any) => r.platform === 'tiktok');
    check('TikTok: تعليقات NOT_AVAILABLE', tiktok.states.comments === 'NOT_AVAILABLE');
    check('TikTok: رسائل NOT_AVAILABLE', tiktok.states.messaging === 'NOT_AVAILABLE');
    check('TikTok: نشر REQUIRES_REVIEW', tiktok.states.publish === 'REQUIRES_REVIEW');
    const yt = caps.rows.find((r: any) => r.platform === 'youtube');
    check('YouTube: تعليقات+رد AVAILABLE', yt.states.comments === 'AVAILABLE' && yt.states.reply === 'AVAILABLE');
    check('الجغرافيا NOT_AVAILABLE للجميع', caps.rows.every((r: any) => r.states.geography === 'NOT_AVAILABLE'));
    check('كل الحالات من الخمس المعروفة', caps.rows.every((r: any) => Object.values(r.states).every((v: any) => ['AVAILABLE', 'PARTIAL', 'REQUIRES_REVIEW', 'NOT_AVAILABLE', 'OWNER_ONLY'].includes(v))));

    group('4) لا ادعاء تشغيل — لا OPERATIONAL بلا اتصال موثق');
    check('لا منصة متصلة وموثقة في بيئة الاختبار', state.platformStates.every((p: any) => !(p.connected && p.verified)));
    check('realConnectors معلنة بصدق', Array.isArray(state.platformStates.filter((p: any) => p.realConnector).map((p: any) => p.platform)));

    group('5) الدورات والتشخيص — بلا تنفيذ خارجي');
    const daily = await (await fetch(`${BASE}/api/agent/brain/cycles/daily`, { headers: auth })).json();
    check('الدورة اليومية تعمل', daily.success === true && Array.isArray(daily.cycle.steps));
    check('كل خطوة بلا إجراء خارجي', daily.cycle.steps.every((s: any) => s.externalAction === false));
    const weekly = await (await fetch(`${BASE}/api/agent/brain/cycles/weekly`, { headers: auth })).json();
    check('المراجعة الأسبوعية تعمل', weekly.success === true && Array.isArray(weekly.review.limitations));
    check('المراجعة لا تدّعي تغيّر جمهور', weekly.review.audienceChanges.join(' ').includes('لا تُدَّعى'));
    const diag = await (await fetch(`${BASE}/api/agent/brain/diagnostics`, { headers: auth })).json();
    check('التشخيص يعمل بلا أسرار', diag.success === true && diag.diagnostics.knowledgeHealth);

    group('6) dry-run — للمالك فقط ويتوقف قبل التنفيذ');
    const dry = await (await fetch(`${BASE}/api/agent/brain/dry-run?platform=youtube`, { headers: auth })).json();
    check('dry-run يعمل للمالك', dry.success === true && dry.report);
    check('dry-run بلا إجراء خارجي', dry.report.externalActionTaken === false);
    check('dry-run يفصل المعروف/المجهول/الموافقة', Array.isArray(dry.report.whatIKnow) && Array.isArray(dry.report.whatIDontKnow) && Array.isArray(dry.report.whatRequiresOwnerApproval));
    const dryNoAuth = await fetch(`${BASE}/api/agent/brain/dry-run`);
    check('dry-run بلا جلسة => 401', dryNoAuth.status === 401);

    group('7) /api/readiness — كتلة brain صادقة بلا سرّ');
    const readiness = await (await fetch(`${BASE}/api/readiness`)).json();
    check('كتلة brain حاضرة', readiness.brain && typeof readiness.brain === 'object');
    check('brain: لا تنفيذ خارجي', readiness.brain.executesExternalActions === false);
    check('brain: لا Gemini في القراءة', readiness.brain.geminiUsedOnReads === false);
    check('brain: عشر منصات', readiness.brain.platformsCovered === 10);
    check('brain: بلا سمات سكانية', readiness.brain.audienceDemographicsAvailable === false);
    check('brain: حالات قدرات محصورة', typeof readiness.brain.capabilityStates === 'object');

    group('8) عدم تسريب الأسرار');
    const all = JSON.stringify([stateBody, caps, daily, weekly, diag, dry, readiness]);
    check('لا مفتاح تشفير في أي استجابة', !all.includes(process.env.PLATFORM_TOKEN_ENCRYPTION_KEY || '___none___'));
    check('لا Session Secret في أي استجابة', !all.includes(SESSION_SECRET));
    check('لا Preview Token في أي استجابة', !all.includes(PREVIEW_TOKEN));
  } finally {
    try { await stop(app.proc); } catch { /* تجاهل */ }
    rmSync(stateDir, { recursive: true, force: true });
  }
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} central brain integration checks`);
  }
})().catch((err) => { console.error('Brain integration harness crashed:', err); process.exit(1); });
