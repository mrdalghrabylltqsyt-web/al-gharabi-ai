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
 * لا يستخدم أي مزود خارجي ولا يدّعي أي إرسال: الرد يبقى غير مُسلَّم.
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

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const PORT = 5820 + Math.floor(Math.random() * 120);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
// سر ثابت للعمليتين كي تبقى جلسة المالك صالحة بعد إعادة التشغيل.
const SESSION_SECRET = 'social-persistence-test-secret-not-real';

const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-social-persist-'));

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

  let app = startApp();
  try {
    check('الخادم الأول يقلع', await waitForHealth(), app.log().slice(0, 300));
    let auth = await login();

    // اتصال موثق مسجّل محلياً (نفس آلية owner connection-callback) للسماح بتسجيل رد.
    // لا إرسال فعلي: الرد يبقى delivered=false.
    const conn = await fetch(`${BASE}/api/platforms/facebook/connection-callback`, {
      method: 'POST', headers: auth, body: JSON.stringify({ providerVerified: true, accountId: 'test-fb-1', accountName: 'اختبار' }),
    });
    check('تسجيل اتصال موثق للاختبار', conn.status === 200);

    const ingest1 = await fetch(`${BASE}/api/social/manager/comments/ingest`, {
      method: 'POST', headers: auth, body: JSON.stringify({ platform: 'facebook', externalId: 'persist-evt-1', text: 'بكم سعر الثلاجة؟', authorName: 'أحمد' }),
    });
    const ingest1Body = await ingest1.json();
    check('إنشاء تعليق وارد ناجح', ingest1.status === 200 && ingest1Body.duplicate === false);

    const reply1 = await fetch(`${BASE}/api/social/manager/comments/reply`, {
      method: 'POST', headers: auth, body: JSON.stringify({ platform: 'facebook', externalId: 'persist-evt-1', text: 'أهلاً بك، شكراً لتواصلك معنا، فريق المعرض في خدمتك.', commentText: 'بكم سعر الثلاجة؟' }),
    });
    const reply1Body = await reply1.json();
    check('تسجيل رد ناجح', reply1.status === 200);
    check('الرد غير مُسلَّم (لا موصل إنتاجي)', reply1Body.delivered === false && reply1Body.simulated === true);

    // قرار مراجعة داخلي (اعتماد لا يعني نشراً خارجياً).
    const approval1 = await fetch(`${BASE}/api/social/manager/approvals`, {
      method: 'POST', headers: auth, body: JSON.stringify({ platform: 'facebook', externalId: 'persist-evt-1', status: 'approved', commentText: 'بكم سعر الثلاجة؟' }),
    });
    const approval1Body = await approval1.json();
    check('تسجيل قرار اعتماد داخلي ناجح', approval1.status === 200 && approval1Body.approval.status === 'approved');
    check('قرار الاعتماد غير مُسلَّم للمنصة', approval1Body.delivered === false && approval1Body.simulated === true);

    // انتظر تفريغ طابور الكتابة إلى المخزن.
    await new Promise((r) => setTimeout(r, 1500));
    await stop(app.proc);

    // ---- إعادة التشغيل على نفس مجلد الحالة ----
    app = startApp();
    check('الخادم الثاني يقلع على نفس الحالة', await waitForHealth(), app.log().slice(0, 300));
    auth = { ...(await login()) };

    const comments = await (await fetch(`${BASE}/api/social/manager/comments?platform=facebook`, { headers: auth })).json();
    check('★ التعليق يصمد بعد إعادة التشغيل', comments.count === 1, `count=${comments.count}`);

    // اتصال المنصة الموثق يجب أن يصمد أيضاً: كان يُحفظ في اللقطة لكن لا يُسترجَع
    // عند الإقلاع بخلفية الملف، فتظهر منصة متصلة كـ disconnected بعد كل restart.
    const readiness = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const fb = (readiness.platforms || []).find((p: any) => p.platform === 'facebook');
    check('★ اتصال المنصة الموثق يصمد بعد إعادة التشغيل', fb?.connected === true && fb?.providerVerified === true, JSON.stringify(fb));

    const status = await (await fetch(`${BASE}/api/social/manager/status`, { headers: auth })).json();
    check('★ عدد الردود المسجلة يصمد بعد إعادة التشغيل', status.activity.repliesRecorded >= 1, `replies=${status.activity.repliesRecorded}`);

    // قرار المراجعة الداخلي يجب أن يصمد أيضاً، مع بقائه غير مُسلَّم.
    const approvalsAfter = await (await fetch(`${BASE}/api/social/manager/approvals?platform=facebook`, { headers: auth })).json();
    check('★ قرار المراجعة يصمد بعد إعادة التشغيل', approvalsAfter.count >= 1 && approvalsAfter.approvals[0].status === 'approved', `count=${approvalsAfter.count}`);
    check('★ القرار المصمود يبقى غير مُسلَّم للمنصة', approvalsAfter.approvals[0].delivered === false && approvalsAfter.approvals[0].simulated === true);

    const repliesAfter = await (await fetch(`${BASE}/api/social/manager/replies?platform=facebook`, { headers: auth })).json();
    check('★ الردود المسجّلة تصمد بعد إعادة التشغيل', repliesAfter.count >= 1 && repliesAfter.replies[0].delivered === false);

    const replay = await fetch(`${BASE}/api/social/manager/comments/ingest`, {
      method: 'POST', headers: auth, body: JSON.stringify({ platform: 'facebook', externalId: 'persist-evt-1', text: 'بكم سعر الثلاجة؟', authorName: 'أحمد' }),
    });
    const replayBody = await replay.json();
    check('★ حماية replay تصمد بعد إعادة التشغيل', replayBody.duplicate === true);
    const commentsAfter = await (await fetch(`${BASE}/api/social/manager/comments?platform=facebook`, { headers: auth })).json();
    check('★ لا سجل مكرر بعد replay', commentsAfter.count === 1, `count=${commentsAfter.count}`);

    const replyAgain = await fetch(`${BASE}/api/social/manager/comments/reply`, {
      method: 'POST', headers: auth, body: JSON.stringify({ platform: 'facebook', externalId: 'persist-evt-1', text: 'رد آخر مختلف', commentText: 'بكم سعر الثلاجة؟' }),
    });
    check('★ حماية الرد المكرر على نفس التعليق تصمد بعد إعادة التشغيل', replyAgain.status === 409, `status=${replyAgain.status}`);

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
    rmSync(stateDir, { recursive: true, force: true });
  }
}

run().catch((err) => { console.error('Social persistence harness crashed:', err); process.exit(1); });
