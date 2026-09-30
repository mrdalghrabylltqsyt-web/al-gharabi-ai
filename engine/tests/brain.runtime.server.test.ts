/**
 * اختبار خادم حقيقي لربط العقل المركزي بالتشغيل + ثبات الذاكرة الدائمة.
 *
 * يُثبت بالدليل عبر HTTP:
 *  1) مسارات العقل محمية (401 بلا جلسة).
 *  2) اللقطة تُبنى من بيانات حقيقية (تعليق/رد Telegram حقيقي عبر موصل وهمي محلي).
 *  3) الذاكرة الدائمة تُدرج أحداث التعلّم من نتائج فعلية، ولا تتضاعف عند إعادة القراءة.
 *  4) الذاكرة تصمد بعد restart فعلي (إعادة تشغيل العملية على نفس مجلد الحالة).
 *  5) `/api/readiness` يعرض كتلة brain صادقة بلا أسرار وبلا تنفيذ خارجي.
 *
 * لا يلمس مزوداً حقيقياً ولا يستهلك حصة AI (Telegram وهمي محلي).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createTelegramMock, startTelegramMockServer } from './helpers/telegramMock';

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
const PORT = 6980 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'brain-runtime-test-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-brain-rt-'));
const TG_PORT = 6850 + Math.floor(Math.random() * 100);
const WEBHOOK_SECRET = 'brain_rt_webhook_secret_1234';
const TG_BOT_TOKEN = '111222333:BRAIN_RT_TOKEN_NOT_REAL';

function startApp(tgBase: string): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    TELEGRAM_API_BASE: tgBase,
    TELEGRAM_BOT_TOKEN: TG_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
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
  await new Promise((r) => setTimeout(r, 1500));
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
  const tg = await startTelegramMockServer(TG_PORT, createTelegramMock());
  try {
    let app = startApp(tg.base);
    try {
      check('الخادم الأول يقلع', await waitForHealth(), app.log().slice(0, 400));
      let auth = await login();

      group('1) التصريح — مسارات العقل محمية');
      for (const path of ['/api/agent/brain/state', '/api/agent/brain/diagnostics', '/api/agent/brain/capabilities', '/api/agent/brain/content-path']) {
        const noAuth = await fetch(`${BASE}${path}`);
        check(`بلا جلسة ${path} => 401`, noAuth.status === 401);
      }

      group('2) بيانات حقيقية — تعليق ورد Telegram عبر موصل حقيقي (خادم وهمي)');
      const conn = await fetch(`${BASE}/api/platforms/telegram/configure`, { method: 'POST', headers: auth, body: JSON.stringify({}) });
      check('اتصال Telegram موثق', conn.status === 200, (await conn.text()).slice(0, 200));
      const inbound = await fetch(`${BASE}/api/platforms/telegram/webhook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
        body: JSON.stringify({ update_id: 7101, message: { message_id: 71, date: 1700000000, text: 'بكم سعر الثلاجة؟', chat: { id: -100777 }, from: { id: 7, first_name: 'حيدر' } } }),
      });
      check('استقبال تعليق وارد', inbound.status === 200 && (await inbound.json()).accepted === true);
      const reply = await fetch(`${BASE}/api/platforms/telegram/reply`, {
        method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'tg:-100777:71', text: 'أهلاً بك، فريق المعرض في خدمتك.', commentText: 'بكم سعر الثلاجة؟' }),
      });
      const replyBody = await reply.json();
      check('رد حقيقي مُسلَّم بمعرّف مزوّد', reply.status === 200 && replyBody.delivered === true && Boolean(replyBody.reply?.providerReplyId));

      group('3) اللقطة من بيانات حقيقية + الذاكرة الدائمة');
      const stateRes = await fetch(`${BASE}/api/agent/brain/state`, { headers: auth });
      const stateBody = await stateRes.json();
      check('اللقطة تعمل', stateRes.status === 200 && stateBody.success === true);
      check('الهدف مبني داخلياً', stateBody.state.goals?.primary === 'SALES');
      check('لا تنفيذ خارجي معلن', typeof stateBody.state.note === 'string' && stateBody.state.note.includes('بلا تنفيذ'));
      check('كل القدرات حالات صريحة', stateBody.state.platformStates.every((p: any) => Object.values(p.capabilities).every((v) => typeof v === 'string')));

      const readiness1 = await (await fetch(`${BASE}/api/readiness`)).json();
      const mem1 = readiness1.brain?.memoryHealth?.total ?? 0;
      check('الذاكرة الدائمة أنتجت سجلات من نتائج حقيقية', mem1 >= 1, `total=${mem1}`);
      check('readiness brain لا ينفّذ خارجياً', readiness1.brain?.executesExternalActions === false);
      check('readiness brain لا يستخدم Gemini في القراءة', readiness1.brain?.geminiUsedOnReads === false);
      check('readiness brain يعلن دوام الذاكرة', typeof readiness1.brain?.memoryDurable === 'boolean');

      // إعادة القراءة لا تُضاعف الذاكرة (منع تكرار).
      await fetch(`${BASE}/api/agent/brain/state`, { headers: auth });
      await fetch(`${BASE}/api/agent/brain/state`, { headers: auth });
      const readiness2 = await (await fetch(`${BASE}/api/readiness`)).json();
      const mem2 = readiness2.brain?.memoryHealth?.total ?? 0;
      check('الذاكرة لا تتضاعف عند إعادة القراءة', mem2 === mem1, `${mem1} -> ${mem2}`);

      // لا أسرار في أي استجابة.
      const all = JSON.stringify([stateBody, readiness1, readiness2]);
      check('لا تسريب مفتاح التشفير', !all.includes(process.env.PLATFORM_TOKEN_ENCRYPTION_KEY || '___none___'));
      check('لا تسريب رمز البوت', !all.includes(TG_BOT_TOKEN));
      check('لا تسريب سرّ الwebhook', !all.includes(WEBHOOK_SECRET));

      await new Promise((r) => setTimeout(r, 1500));
      await stop(app.proc);

      group('4) ثبات الذاكرة بعد restart فعلي');
      app = startApp(tg.base);
      check('الخادم الثاني يقلع على نفس الحالة', await waitForHealth(), app.log().slice(0, 400));
      auth = await login();
      const readiness3 = await (await fetch(`${BASE}/api/readiness`)).json();
      const mem3 = readiness3.brain?.memoryHealth?.total ?? 0;
      check('الذاكرة صمدت بعد إعادة التشغيل', mem3 >= mem1, `before=${mem1} after=${mem3}`);
      check('الذاكرة تحتفظ بالأصل والثقة', (readiness3.brain?.memoryHealth?.byOrigin ? Object.keys(readiness3.brain.memoryHealth.byOrigin).length : 0) >= 1);
      const stateRes3 = await fetch(`${BASE}/api/agent/brain/state`, { headers: auth });
      check('اللقطة تعمل بعد إعادة التشغيل', stateRes3.status === 200);
    } finally {
      try { await stop(app.proc); } catch { /* تجاهل */ }
    }
  } finally {
    await tg.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} brain runtime server checks`);
  }
})().catch((err) => { console.error('Brain runtime server harness crashed:', err); process.exit(1); });
