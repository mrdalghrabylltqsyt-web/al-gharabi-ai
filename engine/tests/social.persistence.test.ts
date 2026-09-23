/**
 * اختبار ثبات دورة التعليقات والردود عبر إعادة التشغيل (Create → Persist → Restart → Read).
 *
 * سبب الوجود: سجلات مدير السوشيال (تعليقات/ردود/سجلات نشر/تحليلات) كانت تُكتب
 * في مساحة العمل لكنها لم تكن ضمن قائمة الحالة المحفوظة، فلا تصمد بعد restart —
 * وهذا يكسر حماية replay/duplicate بعد كل إعادة تشغيل.
 *
 * الاختبار يشغّل الخادم الحقيقي من مجلد حالة فارغ، يُنشئ تعليقاً ورداً، ثم يعيد
 * التشغيل على نفس المجلد ويتأكد أن:
 *  1) التعليق وعدد الردود بقيا.
 *  2) إعادة إرسال نفس الحدث (replay) لا تُنشئ سجلاً مكرراً — الحماية صمدت.
 *  3) الرد الحقيقي عبر موصل Telegram، ومنع الرد المكرر على نفس التعليق، يصمدان.
 * يستخدم موصل Telegram الحقيقي مقابل خادم وهمي محلي (TELEGRAM_API_BASE) فلا
 * يلمس أي مزود خارجي حالياً.
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

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const PORT = 5820 + Math.floor(Math.random() * 120);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
// سر ثابت للعمليتين كي تبقى جلسة المالك صالحة بعد إعادة التشغيل.
const SESSION_SECRET = 'social-persistence-test-secret-not-real';

const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-social-persist-'));
const TG_PORT = 6200 + Math.floor(Math.random() * 150);
const WEBHOOK_SECRET = 'persist_test_webhook_secret_1234';
const TG_BOT_TOKEN = '111222333:PERSIST_TEST_TOKEN_NOT_REAL';

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
  // لا مزود خارجي: نريد ثبات الحالة لا اتصال مزود.
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


async function run(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }

  // خادم Telegram وهمي محلي: موصل إرسال حقيقي بلا مزود خارجي.
  const tg = await startTelegramMockServer(TG_PORT, createTelegramMock());
  try {
    let app = startApp(tg.base);
    try {
      check('الخادم الأول يقلع', await waitForHealth(), app.log().slice(0, 300));
      let auth = await login();

      // اتصال موثق حقيقي عبر موصل Telegram (getMe + setWebhook فعليان على الخادم الوهمي).
      const conn = await fetch(`${BASE}/api/platforms/telegram/configure`, {
        method: 'POST', headers: auth, body: JSON.stringify({}),
      });
      check('ضبط اتصال Telegram الموثق', conn.status === 200, (await conn.text()).slice(0, 200));

      // تعليق وارد حقيقي عبر Webhook موثوق بمعلومة السرّ.
      const inbound = await fetch(`${BASE}/api/platforms/telegram/webhook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
        body: JSON.stringify({ update_id: 9001, message: { message_id: 11, date: 1700000000, text: 'بكم سعر الثلاجة؟', chat: { id: -100555 }, from: { id: 3, first_name: 'أحمد' } } }),
      });
      check('استقبال تعليق وارد من Webhook', inbound.status === 200 && (await inbound.json()).accepted === true);

      // رد حقيقي عبر الموصل (موافقة المالك + حارس سلامة + إرسال فعلي للخادم الوهمي).
      const reply1 = await fetch(`${BASE}/api/platforms/telegram/reply`, {
        method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'tg:-100555:11', text: 'أهلاً بك، شكراً لتواصلك معنا، فريق المعرض في خدمتك.', commentText: 'بكم سعر الثلاجة؟' }),
      });
      const reply1Body = await reply1.json();
      check('إرسال الرد الحقيقي ناجح', reply1.status === 200 && reply1Body.delivered === true && reply1Body.simulated === false);
      check('تسجيل الرد محلياً أيضاً', reply1Body.reply?.delivered === true);

      // قرار مراجعة داخلي (لا يعني نشراً إضافياً).
      const approval1 = await fetch(`${BASE}/api/social/manager/approvals`, {
        method: 'POST', headers: auth, body: JSON.stringify({ platform: 'telegram', externalId: 'tg:-100555:11', status: 'approved', commentText: 'بكم سعر الثلاجة؟' }),
      });
      const approval1Body = await approval1.json();
      check('تسجيل قرار اعتماد داخلي', approval1.status === 200 && approval1Body.approval.status === 'approved');

      await new Promise((r) => setTimeout(r, 1500));
      await stop(app.proc);

      // ---- إعادة التشغيل على نفس مجلد الحالة ----
      app = startApp(tg.base);
      check('الخادم الثاني يقلع على نفس الحالة', await waitForHealth(), app.log().slice(0, 300));
      auth = { ...(await login()) };

      const comments = await (await fetch(`${BASE}/api/social/manager/comments?platform=telegram`, { headers: auth })).json();
      check('★ التعليق الوارد يصمد بعد إعادة التشغيل', comments.count === 1, `count=${comments.count}`);

      // اتصال المنصة الموثق يجب أن يصمد (كان يُحفظ ولا يُسترجَع بخلفية الملف).
      const readiness = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
      const tgp = (readiness.platforms || []).find((p: any) => p.platform === 'telegram');
      check('★ اتصال Telegram الموثق يصمد بعد إعادة التشغيل', tgp?.connected === true && tgp?.providerVerified === true, JSON.stringify(tgp));

      const status = await (await fetch(`${BASE}/api/social/manager/status`, { headers: auth })).json();
      check('★ عدد الردود المسجلة يصمد بعد إعادة التشغيل', status.activity.repliesRecorded >= 1, `replies=${status.activity.repliesRecorded}`);

      const approvalsAfter = await (await fetch(`${BASE}/api/social/manager/approvals?platform=telegram`, { headers: auth })).json();
      check('★ قرار المراجعة يصمد بعد إعادة التشغيل', approvalsAfter.count >= 1 && approvalsAfter.approvals[0].status === 'approved', `count=${approvalsAfter.count}`);

      const repliesAfter = await (await fetch(`${BASE}/api/social/manager/replies?platform=telegram`, { headers: auth })).json();
      check('★ الردود المسجّلة تصمد بعد إعادة التشغيل', repliesAfter.count >= 1 && repliesAfter.replies[0].delivered === true);

      // منع تكرار الحدث الوارد بعد restart (update_id محفوظ).
      const replay = await fetch(`${BASE}/api/platforms/telegram/webhook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
        body: JSON.stringify({ update_id: 9001, message: { message_id: 11, text: 'بكم سعر الثلاجة؟', chat: { id: -100555 }, from: { id: 3, first_name: 'أحمد' } } }),
      });
      check('★ حماية replay الوارد تصمد بعد إعادة التشغيل', (await replay.json()).duplicate === true);
      const commentsAfter = await (await fetch(`${BASE}/api/social/manager/comments?platform=telegram`, { headers: auth })).json();
      check('★ لا سجل مكرر بعد replay', commentsAfter.count === 1, `count=${commentsAfter.count}`);

      // منع الرد المكرر على نفس التعليق بعد restart (السجل مصمود).
      const replyAgain = await fetch(`${BASE}/api/platforms/telegram/reply`, {
        method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'tg:-100555:11', text: 'رد آخر مختلف على نفس التعليق.', commentText: 'بكم سعر الثلاجة؟' }),
      });
      check('★ منع الرد المكرر على نفس التعليق يصمد بعد إعادة التشغيل', replyAgain.status === 409, `status=${replyAgain.status}`);

      console.log('\n' + '='.repeat(60));
      if (failures.length) {
        console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
        for (const f of failures) console.error(`  ✗ ${f}`);
        process.exitCode = 1;
      } else {
        console.log(`PASSED: ${passed} social persistence checks`);
      }
    } finally {
      try { await stop(app.proc); } catch { /* تجاهل */ }
    }
  } finally {
    await tg.stop();
  }
  rmSync(stateDir, { recursive: true, force: true });
}

run().catch((err) => { console.error('Social persistence harness crashed:', err); process.exit(1); });
