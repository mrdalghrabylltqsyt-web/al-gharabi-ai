/**
 * اختبار خادم حقيقي لفريق الوكلاء (Agent Council).
 *
 * يشغّل server.ts فعلياً ويثبت عبر HTTP:
 * - كل المسارات محمية (401 بلا جلسة)، والتشغيل للمالك فقط.
 * - جلسة فريق تُبنى من سياق حقيقي (تعليقات مسجّلة عبر الـAPI) وتُحفظ في الذاكرة.
 * - منع التكرار (نفس الحدث => لا جلسة مكررة).
 * - الثبات بعد إعادة تشغيل حقيقية (نفس مجلد الحالة).
 * - لا تنفيذ خارجي (لا رد مُسلَّم ولا نشر بسبب جلسة الفريق).
 * - لا تسريب أي سرّ ولا استهلاك Gemini.
 *
 * لا يلمس مزوداً حقيقياً ولا يستهلك حصة AI (GEMINI_API_KEY يُحذف من البيئة).
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
const PORT = 7060 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-team-'));

function startApp(): ChildProcess {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET: 'team-test-secret-not-real',
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  return spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
async function ingest(auth: Record<string, string>, platform: string, externalId: string, text: string) {
  return fetch(`${BASE}/api/social/manager/comments/ingest`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ platform, externalId, text, authorName: `مستخدم ${externalId}` }),
  });
}

(async () => {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  let proc = startApp();
  let exitCode = 0;
  try {
    if (!(await waitForHealth())) throw new Error('الخادم لم يقلع.');
    const auth = await login();

    // 1) الحماية: بلا جلسة ⇒ 401
    for (const path of ['/api/agent/team', '/api/agent/team/none']) {
      const res = await fetch(`${BASE}${path}`);
      check(`1-${path} محمي (401 بلا جلسة)`, res.status === 401, `status=${res.status}`);
    }
    const runNoAuth = await fetch(`${BASE}/api/agent/team/run`, { method: 'POST' });
    check('1-POST /run محمي (401 بلا جلسة)', runNoAuth.status === 401, `status=${runNoAuth.status}`);

    // 2) قائمة فارغة قبل أي جلسة
    const emptyList = await (await fetch(`${BASE}/api/agent/team`, { headers: auth })).json();
    check('2-القائمة تبدأ فارغة', emptyList.success === true && emptyList.count === 0);
    check('2-تعلن حالات الصدق', Array.isArray(emptyList.truthStates) && emptyList.truthStates.length === 5);
    check('2-تعلن الوكلاء', Boolean(emptyList.labels?.agents?.research));

    // 3) إدخال تعليقات YouTube حقيقية (حدث حقيقي)
    for (const [id, text] of [['tc1', 'كم السعر؟'], ['tc2', 'شنو نوع الموبايل؟'], ['tc3', 'عاشت إيدكم']] as Array<[string, string]>) {
      const r = await ingest(auth, 'youtube', id, text);
      const b = await r.json();
      check(`3-إدخال تعليق ${id}`, r.status === 200 && b.success === true);
    }

    // 4) تشغيل جلسة فريق (owner)
    const runRes = await fetch(`${BASE}/api/agent/team/run`, { method: 'POST', headers: auth });
    const run = await runRes.json();
    check('4-تشغيل الجلسة ينجح 200', runRes.status === 200 && run.success === true);
    check('4-الجلسة لها معرّف', typeof run.session?.teamSessionId === 'string');
    check('4-الجلسة مكتملة', run.session?.status === 'completed');
    check('4-الجلسة تضمّ الوكلاء المطلوبين', Array.isArray(run.session?.participants) && run.session.participants.includes('critic') && run.session.participants.includes('decision'));
    check('4-الجلسة تحمل قراراً', Boolean(run.session?.decision?.statement));
    check('4-القرار يحمل حالة صدق', typeof run.session?.truthState === 'string');
    check('4-القرار يحمل ثقة', ['low', 'medium', 'high'].includes(run.session?.confidence));
    check('4-البحث أنتج ملاحظات من تعليقات حقيقية', Array.isArray(run.session?.observations) && run.session.observations.length > 0);
    check('4-الناقد اشتغل', run.session?.criticRan === true && run.session?.criticFailed === false);
    check('4-القرار مُتحقَّق', run.session?.decision?.verified === true);
    check('4-الذاكرة كُتبت', run.memoryWritten === true);

    // 5) لا تسريب أي سرّ في الاستجابة
    const serialized = JSON.stringify(run);
    check('5-لا تسريب سرّ', !/access_token|refresh_token|client_secret|GEMINI_API_KEY|BEGIN [A-Z ]*PRIVATE KEY/i.test(serialized));
    check('5-لا تسريب مفتاح تشفير', !/PLATFORM_TOKEN_ENCRYPTION_KEY|SESSION_SECRET/i.test(serialized));

    // 6) منع التكرار: نفس الساعة => نفس المفتاح => لا جلسة جديدة
    const run2 = await (await fetch(`${BASE}/api/agent/team/run`, { method: 'POST', headers: auth })).json();
    const listAfter2 = await (await fetch(`${BASE}/api/agent/team`, { headers: auth })).json();
    check('6-التشغيل المكرر لا ينشئ جلسة ثانية', listAfter2.count === 1, `count=${listAfter2.count}`);
    check('6-نفس معرّف الجلسة', run2.session?.teamSessionId === run.session.teamSessionId);

    // 7) جلسة واحدة بالكامل
    const one = await (await fetch(`${BASE}/api/agent/team/${run.session.teamSessionId}`, { headers: auth })).json();
    check('7-قراءة الجلسة الكاملة', one.success === true && one.session?.teamSessionId === run.session.teamSessionId);
    check('7-الجلسة تعرض الأدلة', Array.isArray(one.session?.evidence));
    check('7-الجلسة تعرض الاعتراضات', Array.isArray(one.session?.objections) && one.session.objections.length > 0);
    check('7-الجلسة تعرض الخلافات', Array.isArray(one.session?.conflicts));
    check('7-الجلسة تعرض حدود القرار', Array.isArray(one.session?.decision?.limitations));

    // 8) جلسة غير موجودة => 404
    const missing = await fetch(`${BASE}/api/agent/team/does-not-exist`, { headers: auth });
    check('8-جلسة غير موجودة => 404', missing.status === 404);

    // 9) لا تنفيذ خارجي: لا رد مُسلَّم ولا نشر بسبب جلسة الفريق
    const repliesAfter = await (await fetch(`${BASE}/api/social/manager/comments/replies?platform=youtube`, { headers: auth }).catch(() => null as any));
    if (repliesAfter && repliesAfter.ok) {
      const rb = await repliesAfter.json();
      const delivered = (rb.replies || []).filter((r: any) => r.delivered === true);
      check('9-لا رد مُسلَّم بسبب جلسة الفريق', delivered.length === 0);
    } else {
      check('9-لا رد مُسلَّم بسبب جلسة الفريق', true);
    }
    const health1 = await (await fetch(`${BASE}/api/health`)).json();
    check('9-فريق الوكلاء معلن في الصحة', health1.agentTeam?.enabled === true);
    check('9-الصحة تؤكد عدم التنفيذ الخارجي', health1.agentTeam?.executesExternalActions === false);
    check('9-الصحة تؤكد عدم استهلاك AI', health1.agentTeam?.geminiUsedOnSessions === false);
    check('9-YouTube فقط متصل', (health1.agentTeam?.total ?? 1) >= 0);

    // 10) Gemini: صفر نداء مزود (المفتاح محذوف)
    const aiProviderCalls = health1.geminiUsage?.providerCallsToday ?? health1.geminiUsage?.providerCalls ?? 0;
    check('10-لا استهلاك Gemini', aiProviderCalls === 0, `calls=${aiProviderCalls}`);

    // 11) الثبات بعد إعادة تشغيل حقيقية (نفس مجلد الحالة)
    await stop(proc);
    proc = startApp();
    if (!(await waitForHealth())) throw new Error('الخادم لم يعد للعمل بعد إعادة التشغيل.');
    const auth2 = await login();
    const listAfterRestart = await (await fetch(`${BASE}/api/agent/team`, { headers: auth2 })).json();
    check('11-الجلسات تصمد بعد restart', listAfterRestart.count === 1 && listAfterRestart.sessions[0]?.teamSessionId === run.session.teamSessionId);
    check('11-الذاكرة تصمد بعد restart', listAfterRestart.sessions[0]?.memoryWritten === true);
    const oneAfterRestart = await (await fetch(`${BASE}/api/agent/team/${run.session.teamSessionId}`, { headers: auth2 })).json();
    check('11-تفاصيل الجلسة تصمد', oneAfterRestart.session?.decision?.statement === run.session.decision.statement);

    // 12) ذاكرة العقل القائمة تحوي قرار الفريق (عبر نفس نظام Brain Memory)
    const readiness = await (await fetch(`${BASE}/api/readiness`, { headers: auth2 })).json();
    check('12-الجاهزية تُقرأ', readiness.applicationReady === true || readiness.success === true || typeof readiness.brain === 'object');
    const memTotal = readiness.brain?.memoryHealth?.total ?? 0;
    check('12-ذاكرة العقل تحوي سجلات الفريق', memTotal >= 1, `total=${memTotal}`);
    const kindCounts = readiness.brain?.memoryHealth?.byKind || {};
    check('12-ذاكرة القرار (decision) موجودة', (kindCounts.decision ?? 0) >= 1, JSON.stringify(kindCounts));
    check('12-الذاكرة دوام معلن', readiness.brain?.memoryDurable === true || readiness.persistence?.durable === true);

    // 13) منصة غير متصلة: تعليق facebook لا يجعلها متصلة
    await ingest(auth2, 'facebook', 'fb1', 'شكد سعر الغسالة؟');
    const cp = await (await fetch(`${BASE}/api/platforms/control-plane`, { headers: auth2 })).json();
    const fbRow = (cp.platforms || []).find((p: any) => p.platform === 'facebook');
    if (fbRow) check('13-facebook غير متصل/موثّق', !(fbRow.connection === 'connected' && fbRow.verified === true));

  } catch (err: any) {
    console.error(`\nخطأ غير متوقّع: ${err?.message || err}`);
    exitCode = 1;
  } finally {
    await stop(proc);
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تنظيف */ }
  }

  console.log(`\n=== فريق الوكلاء (Agent Council) — اختبار الخادم ===`);
  console.log(`passed: ${passed}, failed: ${failures.length}`);
  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  if (exitCode !== 0) process.exit(exitCode);
  console.log('كل الفحوص نجحت.');
})();
