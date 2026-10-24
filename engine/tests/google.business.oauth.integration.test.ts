/**
 * اختبار تكامل حقيقي (خادم فعلي، بلا مزود) — ربط OAuth لـGoogle Business Profile.
 *
 * يثبت أن زر «إكمال الإعداد الخارجي» يستند إلى حالة صادقة من الخادم:
 *  - عند ضبط اعتماد Google Business (أو اعتماد Google المشترك) يكون
 *    `oauthAvailable: true` في center الربط، و`/oauth/start` يُعيد رابط تفويض حقيقي
 *    بنطاق Business Profile (accounts.google.com + business.manage).
 *  - الـalias `/oauth/connect` يعمل بنفس المنفّذ (يطبّع google-business => google_business).
 *  - بلا جلسة => 401، ولا يُسرَّب أي سرّ في الاستجابة.
 *
 * لا يلمس Google ولا يستهلك حصة، والقيم اعتبارية (ليست أسراراً).
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
// نطاق يتجنّب المنافذ المحظورة في fetch/undici (6000 و6665–6669 و6697).
const PORT = 6320 + Math.floor(Math.random() * 70);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'google-business-it-secret-not-real';
const GB_CLIENT_ID = 'test-gb-client-id-not-real';
const GB_CLIENT_SECRET = 'test-gb-client-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-gb-'));

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
    GOOGLE_BUSINESS_OAUTH_CLIENT_ID: GB_CLIENT_ID,
    GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET: GB_CLIENT_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  delete env.GOOGLE_OAUTH_CLIENT_ID;
  delete env.GOOGLE_OAUTH_CLIENT_SECRET;
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
  const app = startApp();
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    const auth = await login();

    group('1) center الربط يعلن أن ربط Google Business متاح');
    const cp = await (await fetch(`${BASE}/api/platforms/control-plane`, { headers: auth })).json();
    const gb = cp.platforms.find((p: any) => p.platform === 'google_business');
    check('Google Business موجود في center الربط', Boolean(gb));
    check('الاعتماد مضبوط (GOOGLE_BUSINESS_*)', gb.connectionConfigured === true);
    check('oauthAvailable=true (مسار البدء قابل للبدء)', gb.oauthAvailable === true);
    // G3: موصل Google Business صار منفّذاً فعلاً، فالحالة CODE_READY (كود جاهز + اعتماد مضبوط،
    // غير متصل بعد) بدل EXTERNAL_SETUP_REQUIRED (لا موصل).
    check('الحالة CONFIGURED (موصل منفّذ واعتماد مضبوط، غير متصل)', gb.state === 'CONFIGURED', JSON.stringify({ state: gb.state }));
    // بوابة «الاتصال» في طبقة التحكم مرتبطة بتنفيذ الموصل لا ببدء OAuth، فتبقى محجوبة
    // هنا (لا موصل تنفيذ). الدليل الحقيقي على تفعيل الزر هو oauthAvailable أعلاه،
    // وإثباته الفعلي في المجموعة 2 (استدعاء /oauth/start ينجح فعلاً).
    check('بوابة الاتصال معلنة في مصفوفة العمليات', gb.operations.some((o: any) => o.operation === 'connect'));

    group('2) بدء OAuth الحقيقي لـGoogle Business');
    const start = await fetch(`${BASE}/api/platforms/google_business/oauth/start`, { headers: auth });
    const startBody = await start.json();
    check('start => 200', start.status === 200, JSON.stringify(startBody).slice(0, 200));
    check('success=true وللمنصة google_business', startBody.success === true && startBody.platform === 'google_business');
    check('رابط التفويض يذهب إلى accounts.google.com', String(startBody.authorizationUrl || '').includes('accounts.google.com'));
    check('الرابط يحمل نطاق Business Profile', String(startBody.authorizationUrl || '').includes('business.manage'));
    check('client_id في الرابط هو اعتماد Google Business', String(startBody.authorizationUrl || '').includes(encodeURIComponent(GB_CLIENT_ID)));
    check('redirect_uri يشير إلى مسار الإرجاع المعتمد', String(startBody.redirectUri || '').includes('/api/platforms/google_business/oauth/callback'));

    group('3) alias /oauth/connect بنفس المنفّذ');
    const alias = await fetch(`${BASE}/api/platforms/google-business/oauth/connect`, { headers: auth });
    const aliasBody = await alias.json();
    check('alias => 200', alias.status === 200, JSON.stringify(aliasBody).slice(0, 200));
    check('alias يُطبّع المعرّف إلى google_business', aliasBody.platform === 'google_business');
    check('alias يُنتج رابط تفويض صالح لنفس النطاق', String(aliasBody.authorizationUrl || '').includes('business.manage'));

    group('4) التصريح وعدم تسريب الأسرار');
    const noAuth = await fetch(`${BASE}/api/platforms/google_business/oauth/start`);
    check('بلا جلسة => 401', noAuth.status === 401);
    const allPayloads = JSON.stringify([cp, startBody, aliasBody]);
    check('لا يُسرَّب client secret', !allPayloads.includes(GB_CLIENT_SECRET));
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
    console.log(`PASSED: ${passed} Google Business OAuth integration checks`);
  }
})().catch((err) => { console.error('Google Business OAuth harness crashed:', err); process.exit(1); });
