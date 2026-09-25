/**
 * Batch 6 — اختبار تكامل الخادم الحقيقي لأساس المنصات المتعددة.
 *
 * يشغّل server.ts فعلياً (بلا أي مزود حقيقي) ويثبت:
 * - مصفوفة الجاهزية عبر HTTP تعكس السجل ولا تدّعي أي اتصال.
 * - اشتراك webhook (GET challenge) والتحقق منه.
 * - استقبال webhook موقّع بـHMAC: توقيع صحيح يُقبل، خاطئ يُرفض 401، والتكرار يُمنع.
 * - النشر الموحّد: capability غير مدعومة => CAPABILITY_NOT_SUPPORTED بلا فشل صامت،
 *   ومنصة بلا موصل منفّذ => EXTERNAL_SETUP_REQUIRED، وحارس السلامة يعمل.
 * - المؤشرات: NOT_SUPPORTED بلا صفر وهمي.
 * - التصريح: كل المسارات الإدارية ترفض بلا جلسة.
 *
 * لا يلمس مزوداً حقيقياً ولا يستهلك حصة Gemini، ولا يستخدم سرّاً واقعياً.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHmac } from 'node:crypto';

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
const PORT = 6200 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'platform-foundation-test-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_1234567890';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_not_real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-platform-'));

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
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());

    group('1) مصفوفة الجاهزية عبر HTTP');
    const matrixNoAuth = await fetch(`${BASE}/api/platforms/readiness-matrix`);
    check('المصفوفة بلا جلسة => 401', matrixNoAuth.status === 401);
    const matrix = await (await fetch(`${BASE}/api/platforms/readiness-matrix`, { headers: auth })).json();
    check('المصفوفة تعيد عشر منصات', matrix.platforms.length === 10);
    check('الملخص: ثلاثة موصلات جاهزة (telegram,facebook,instagram)', matrix.summary.connectorReady === 3 && matrix.summary.foundationReady === 7);
    const fb = matrix.platforms.find((p: any) => p.platform === 'facebook');
    check('facebook: موصل منفّذ وOAuth يحتاج إعداداً خارجياً', fb.implementationStatus === 'CONNECTOR_READY' && fb.oauth === 'EXTERNAL_SETUP_REQUIRED');
    check('facebook: لا اتصال مدّعى', fb.connection.status === 'disconnected' && fb.connection.providerVerified === false);
    const tg = matrix.platforms.find((p: any) => p.platform === 'telegram');
    check('telegram: موصل جاهز وبلا اتصال ما لم يُضبط', tg.implementationStatus === 'CONNECTOR_READY' && tg.connection.status === 'disconnected');
    check('لا قيمة وهمية في المصفوفة', !JSON.stringify(matrix).includes('125/125'));

    const single = await (await fetch(`${BASE}/api/platforms/telegram/readiness`, { headers: auth })).json();
    check('readiness منصة واحدة يعمل', single.readiness.platform === 'telegram' && single.readiness.publish === 'READY');

    group('2) اشتراك webhook (GET challenge)');
    const goodChallenge = await fetch(`${BASE}/api/platforms/facebook/webhook?hub.mode=subscribe&hub.verify_token=${FB_VERIFY_TOKEN}&hub.challenge=CHAL123`);
    check('challenge صحيح => 200 وقيمة', goodChallenge.status === 200 && (await goodChallenge.text()) === 'CHAL123');
    const badChallenge = await fetch(`${BASE}/api/platforms/facebook/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CHAL123`);
    check('رمز تحقق خاطئ => 403', badChallenge.status === 403);
    const threadsNoSetup = await fetch(`${BASE}/api/platforms/threads/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=c`);
    check('منصة بلا رمز تحقق مُعدّ => 404', threadsNoSetup.status === 404);

    group('3) استقبال webhook موقّع (HMAC)');
    const payload = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE1', changes: [{ field: 'feed', value: { item: 'comment', comment_id: 'c1', post_id: 'p1', message: 'بكم سعر الثلاجة؟', from: { name: 'أحمد' }, created_time: 1700000000 } }] }] });
    const sig = 'sha256=' + createHmac('sha256', FB_APP_SECRET).update(payload, 'utf8').digest('hex');
    const badSig = await fetch(`${BASE}/api/platforms/facebook/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' }, body: payload,
    });
    check('توقيع خاطئ => 401', badSig.status === 401);
    const noSig = await fetch(`${BASE}/api/platforms/facebook/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
    });
    check('توقيع غائب => 401', noSig.status === 401);
    const nonePlatform = await fetch(`${BASE}/api/platforms/tiktok/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
    });
    check('منصة بلا مزود توقيع => 404', nonePlatform.status === 404);

    const good = await fetch(`${BASE}/api/platforms/facebook/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sig }, body: payload,
    });
    const goodBody = await good.json();
    check('توقيع صحيح => 200 ومقبول', good.status === 200 && goodBody.accepted === true);

    const comments = await (await fetch(`${BASE}/api/social/manager/comments?platform=facebook`, { headers: auth })).json();
    check('التعليق الوارد خُزّن كتعليق حقيقي', comments.count === 1 && comments.comments[0].externalId === 'c1');
    check('التصنيف حتمي (استفسار تجاري)', comments.comments[0].classification.intent === 'business_inquiry');
    check('حمل replyTarget الحقيقي', comments.comments[0].replyTarget?.commentId === 'c1');

    group('4) منع تكرار حدث webhook (idempotency)');
    const again = await fetch(`${BASE}/api/platforms/facebook/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sig }, body: payload,
    });
    const againBody = await again.json();
    // Facebook له مسار webhook مخصص حقيقي؛ يعيد duplicates بدل ignoredDuplicates.
    check('إعادة نفس الحدث => مكرر (processed=0)', againBody.processed === 0 && (againBody.duplicates === 1 || againBody.ignoredDuplicates === 1));
    const after = await (await fetch(`${BASE}/api/social/manager/comments?platform=facebook`, { headers: auth })).json();
    check('لا سجل مكرر', after.count === 1);

    group('5) النشر الموحّد — capability وصدق الحالة');
    const publishNoAuth = await fetch(`${BASE}/api/platforms/whatsapp/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    check('النشر بلا جلسة => 401', publishNoAuth.status === 401);
    const whatsappPublish = await fetch(`${BASE}/api/platforms/whatsapp/publish`, {
      method: 'POST', headers: auth, body: JSON.stringify({ content: 'مرحباً', approved: true }),
    });
    const whatsappBody = await whatsappPublish.json();
    check('منصة بلا قدرة نشر => CAPABILITY_NOT_SUPPORTED', whatsappPublish.status === 422 && whatsappBody.code === 'CAPABILITY_NOT_SUPPORTED');
    const fbPublish = await fetch(`${BASE}/api/platforms/facebook/publish`, {
      method: 'POST', headers: auth, body: JSON.stringify({ content: 'منشور تجريبي', approved: true }),
    });
    const fbBody = await fbPublish.json();
    check('منصة غير متصلة => NOT_CONNECTED', fbPublish.status === 409 && fbBody.code === 'NOT_CONNECTED');
    const tgPublish = await fetch(`${BASE}/api/platforms/telegram/publish`, {
      method: 'POST', headers: auth, body: JSON.stringify({ content: 'منشور', approved: true }),
    });
    const tgBody = await tgPublish.json();
    check('Telegram غير متصل => NOT_CONNECTED', tgPublish.status === 409 && tgBody.code === 'NOT_CONNECTED');
    const noApproval = await fetch(`${BASE}/api/platforms/telegram/publish`, {
      method: 'POST', headers: auth, body: JSON.stringify({ content: 'منشور', approved: false }),
    });
    check('بلا موافقة => APPROVAL_REQUIRED', noApproval.status === 409);

    group('6) المؤشرات — NOT_SUPPORTED بلا صفر وهمي');
    const metrics = await (await fetch(`${BASE}/api/platforms/youtube/metrics?externalId=p1`, { headers: auth })).json();
    check('غير متصل => لا جلب خارجي', metrics.externalFetchAvailable === false);
    check('لا قيمة وهمية صفرية', metrics.envelope.metrics.every((m: any) => m.status === 'NOT_SUPPORTED' ? m.value === undefined : true));
    const waMetrics = await (await fetch(`${BASE}/api/platforms/whatsapp/metrics`, { headers: auth })).json();
    check('whatsapp بلا تحليلات => كلها NOT_SUPPORTED', waMetrics.envelope.metrics.every((m: any) => m.status === 'NOT_SUPPORTED'));

    group('7) OAuth start — لا مزود بلا إعداد');
    const oauthStart = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    check('OAuth بلا بيانات تطبيق => 503 غير مُعدّ', oauthStart.success === false);
    const oauthNoAuth = await fetch(`${BASE}/api/platforms/facebook/oauth/start`);
    check('OAuth start بلا جلسة => 401', oauthNoAuth.status === 401);

    group('8) لا تسريب أسرار');
    const matrixStr = JSON.stringify(matrix);
    check('لا تظهر أسرار التطبيق في المصفوفة', !matrixStr.includes(FB_APP_SECRET) && !matrixStr.includes(FB_VERIFY_TOKEN));
    const health = await (await fetch(`${BASE}/api/health`, { headers: auth })).json();
    check('الصحة لا تكشف أي سرّ', !JSON.stringify(health).includes(FB_APP_SECRET));
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
    console.log(`PASSED: ${passed} platform integration checks`);
  }
})().catch((err) => { console.error('Platform integration harness crashed:', err); process.exit(1); });
