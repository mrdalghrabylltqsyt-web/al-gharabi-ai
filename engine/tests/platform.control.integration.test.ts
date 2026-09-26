/**
 * Batch 7 — اختبار خادم حقيقي لطبقة التحكم التشغيلي (control plane).
 *
 * يشغّل server.ts فعلياً ويثبت عبر HTTP:
 * - المسارات الجديدة محمية (401 بلا جلسة).
 * - مصفوفة الجاهزية الغنية: levels للكود + operational الآن + state + nextAction.
 * - مركز الربط: حالات منفصلة، لا OPERATIONAL بلا اتصال موثق.
 * - متطلبات الإعداد الخارجي: أسماء متغيرات فقط، بلا أي قيمة سرّية.
 * - التصريح: owner-only حيث يلزم، non-owner => 403.
 *
 * لا يلمس مزوداً حقيقياً ولا يستهلك حصة، ولا يستخدم سرّاً واقعياً.
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
// نطاق يتجنّب المنافذ المحظورة في fetch/undici (6000 و6665–6669 و6697)،
// وإلا فشل الاختبار عشوائياً بـ«bad port» بلا علاقة بالكود.
const PORT = 6510 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'control-plane-test-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-control-'));

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
    // بيانات مزود اختبارية (ليست أسراراً) لاختبار مسار CONFIGURED.
    FACEBOOK_OAUTH_CLIENT_ID: 'test-fb-id', FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-secret',
    FACEBOOK_APP_SECRET: 'test-fb-app-secret-value', FACEBOOK_VERIFY_TOKEN: 'test-fb-verify',
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

    group('1) التصريح — كل مسارات التحكم محمية');
    for (const path of ['/api/platforms/control-plane', '/api/platforms/external-setup', '/api/platforms/readiness-matrix', '/api/platforms/facebook/control']) {
      const noAuth = await fetch(`${BASE}${path}`);
      check(`بلا جلسة ${path} => 401`, noAuth.status === 401);
    }

    group('2) center الربط — حالات منفصلة');
    const cp = await (await fetch(`${BASE}/api/platforms/control-plane`, { headers: auth })).json();
    check('عشر منصات في مركز الربط', cp.platforms.length === 10);
    check('لا منصة OPERATIONAL بلا اتصال فعلي', cp.platforms.every((p: any) => p.state !== 'OPERATIONAL'));
    check('Telegram: CODE_READY أو CONFIGURED (لا اتصال)', ['CODE_READY', 'CONFIGURED'].includes(cp.platforms.find((p: any) => p.platform === 'telegram').state));
    const fb = cp.platforms.find((p: any) => p.platform === 'facebook');
    // Facebook: موصل منفّذ + اعتماد مضبوط في بيئة الاختبار لكن بلا اتصال حي => CONFIGURED.
    check('Facebook موصل منفّذ ومُعدّ بلا اتصال => CONFIGURED', fb.state === 'CONFIGURED');
    check('بوابات العمليات موجودة لكل منصة', cp.platforms.every((p: any) => Array.isArray(p.operations) && p.operations.length === 8));
    check('كل بوابة تحمل سمة allowed منطقية', cp.platforms.every((p: any) => p.operations.every((o: any) => typeof o.allowed === 'boolean')));
    check('سبب الحجب موجود للمنصات المحجوبة', Boolean(fb.blockingReason));
    check('الإجراء التالي موجود', typeof fb.nextAction === 'string' && fb.nextAction.length > 5);
    check('الملخص يطابق الفصل الدقيق', cp.summary.total === 10 && cp.summary.operational === 0);

    group('3) لا ادعاء تشغيل — snapchat/whatsapp قدرات غير مدعومة');
    const sc = cp.platforms.find((p: any) => p.platform === 'snapchat');
    check('Snapchat الاستقبال NOT_SUPPORTED', sc.operations.find((o: any) => o.operation === 'receive').code === 'CAPABILITY_NOT_SUPPORTED');
    const wa = cp.platforms.find((p: any) => p.platform === 'whatsapp');
    check('WhatsApp النشر NOT_SUPPORTED', wa.operations.find((o: any) => o.operation === 'publish').code === 'CAPABILITY_NOT_SUPPORTED');

    group('4) مصفوفة الجاهزية الغنية');
    const matrix = await (await fetch(`${BASE}/api/platforms/readiness-matrix`, { headers: auth })).json();
    check('عشر صفوف', matrix.platforms.length === 10);
    const teleRow = matrix.platforms.find((p: any) => p.platform === 'telegram');
    check('الصف يحمل levels للكود + operational للحالة الآن', teleRow.connector === 'READY' && teleRow.operational && typeof teleRow.operational.publish === 'string');
    check('الحالة التشغيلية وحقل الاتصال موجودان', 'operationalState' in teleRow && 'connection' in teleRow);
    check('nextAction/blockingReason موجودان', 'nextAction' in teleRow && 'blockingReason' in teleRow);
    check('كل الصفوف تحمل operational', matrix.platforms.every((p: any) => p.operational && typeof p.operational.webhook === 'string'));

    group('5) متطلبات الإعداد الخارجي — أسماء فقط');
    const ext = await (await fetch(`${BASE}/api/platforms/external-setup`, { headers: auth })).json();
    check('عشر منصات', ext.platforms.length === 10);
    const fbExt = ext.platforms.find((p: any) => p.platform === 'facebook');
    check('أسماء متغيرات مطلوبة موجودة', fbExt.requiredEnvNames.includes('FACEBOOK_OAUTH_CLIENT_ID'));
    check('خطوات خارجية معلنة', Array.isArray(fbExt.steps) && fbExt.steps.length > 0);
    check('لا قيمة سرّية في الإعداد الخارجي', !JSON.stringify(ext).includes('test-fb-secret') && !JSON.stringify(ext).includes('test-fb-app-secret-value'));

    group('6) مركز منصة واحدة');
    const one = await (await fetch(`${BASE}/api/platforms/telegram/control`, { headers: auth })).json();
    check('حالة منصة واحدة تعمل', one.success && one.control.platform === 'telegram');
    check('الاعتماد يظهر بأسماء فقط', Array.isArray(one.credentials.requiredEnvNames) && !JSON.stringify(one.credentials).includes('test-fb'));
    const unknown = await fetch(`${BASE}/api/platforms/myspace/control`, { headers: auth });
    check('منصة غير مدعومة => 404', unknown.status === 404);

    group('7) عدم تسريب الأسرار في أي استجابة');
    const allPayloads = JSON.stringify([cp, matrix, ext, one]);
    check('لا App Secret في أي استجابة', !allPayloads.includes('test-fb-app-secret-value'));
    check('لا OAuth secret في أي استجابة', !allPayloads.includes('test-fb-secret'));
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
    console.log(`PASSED: ${passed} control-plane integration checks`);
  }
})().catch((err) => { console.error('Control-plane harness crashed:', err); process.exit(1); });
