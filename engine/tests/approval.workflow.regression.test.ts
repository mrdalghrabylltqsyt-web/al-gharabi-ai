/**
 * اختبار ارتداد — زر «موافقة واعتماد» في نظام الموافقة والاعتماد.
 *
 * الجذر المُثبت (لا تخمين): كان `updatePostStatus` في AppContext يطبّق تحديثاً
 * متفائلاً فورياً ويُعلن رسالة نجاح «تم تحديث حالة المنشور إلى: تمت الموافقة»
 * **قبل** رد الخادم. وعند رفض الخادم (409 لأن حالة المنشور الحقيقية ليست review/edited)
 * كان hydrateWorkspace يُرجع المنشور بصمت، فيبدو الزر «لا يستجيب» والمنشور يبقى معلّقاً
 * — انتهاك مباشر لقاعدة «لا نجاح وهمي».
 *
 * هذا الاختبار يثبت أمرين:
 *  (أ) عقد الخادم الفعلي (خادم حقيقي عبر HTTP): الموافقة على منشور بحالة review تنجح
 *      وتبقى approved فعلاً في مساحة العمل؛ والموافقة على منشور بحالة لا تسمح (draft)
 *      تُرفض 409 برسالة عربية واضحة ولا تُغيّر الحالة.
 *  (ب) صدق الواجهة (فحص ثابت على المصدر): لا يوجد showToast نجاح غير مشروط قبل التأكيد،
 *      ورسالة النجاح داخل فرع .then، وفرع الخطأ يعرض سبب الرفض الحقيقي ثم hydrate.
 *
 * لا يلمس مزوّداً خارجياً ولا سرّاً؛ يقلع خادماً حقيقياً بمجلد حالة مؤقت وتوكن معاينة.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
const PORT = 6450 + Math.floor(Math.random() * 120);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'approval-regression-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-approval-'));

let proc: ChildProcess | null = null;
let log = '';
function startApp(): void {
  log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE,
    STATE_DIR: stateDir, GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
}
async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لا يزال يقلع */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function loginOwner(): Promise<Record<string, string>> {
  const login = await fetch(`${BASE}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
  });
  const body = await login.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}
async function stop(): Promise<void> {
  if (!proc) return;
  try { proc.kill('SIGTERM'); } catch { /* تجاهل */ }
  await new Promise((r) => setTimeout(r, 900));
  try { proc.kill('SIGKILL'); } catch { /* تجاهل */ }
}
async function createPost(headers: Record<string, string>, status: string): Promise<string> {
  const res = await fetch(`${BASE}/api/workspace/content`, {
    method: 'POST', headers,
    body: JSON.stringify({ title: `diag-${status}`, content: 'محتوى اختبار حقيقي للمعرض', targetPlatforms: ['facebook'], status }),
  });
  const body = await res.json();
  return body?.post?.id || '';
}
async function statusOf(headers: Record<string, string>, id: string): Promise<string> {
  const res = await fetch(`${BASE}/api/workspace/content`, { headers });
  const body = await res.json();
  return (body.posts || []).find((p: any) => p.id === id)?.status || '';
}

async function run(): Promise<void> {
  startApp();
  const up = await waitForHealth();
  check('الخادم يقلع ويستجيب للصحة', up, up ? '' : log.slice(-400));
  if (!up) return;
  const headers = await loginOwner();

  // ── (أ) عقد الخادم الفعلي ────────────────────────────────────────────────
  group('عقد الخادم الفعلي: approve على review ينجح ويبقى approved');
  const reviewId = await createPost(headers, 'review');
  check('إنشاء منشور بحالة review عبر مسار الإنشاء', Boolean(reviewId) && (await statusOf(headers, reviewId)) === 'review');
  const okRes = await fetch(`${BASE}/api/workspace/content/${reviewId}/approve`, { method: 'POST', headers, body: JSON.stringify({ note: 'موافقة اختبار' }) });
  const okBody = await okRes.json();
  check('approve على review => HTTP 200', okRes.status === 200, `status=${okRes.status}`);
  check('المنشور المعتمد حالته approved في الرد', okBody?.post?.status === 'approved');
  check('المنشور المعتمد يبقى approved في مساحة العمل (لا رجوع)', (await statusOf(headers, reviewId)) === 'approved');

  group('عقد الخادم الفعلي: approve على حالة لا تسمح يُرفض بوضوح');
  const draftId = await createPost(headers, 'draft');
  check('إنشاء منشور بحالة draft (بلا submit-review)', Boolean(draftId) && (await statusOf(headers, draftId)) === 'draft');
  const badRes = await fetch(`${BASE}/api/workspace/content/${draftId}/approve`, { method: 'POST', headers, body: JSON.stringify({}) });
  const badBody = await badRes.json();
  check('approve على draft => HTTP 409', badRes.status === 409, `status=${badRes.status}`);
  check('رسالة الرفض عربية واضحة (سبب حقيقي لا رسالة عامة)', typeof badBody?.error === 'string' && badBody.error.includes('لا تسمح بالموافقة'), `error=${badBody?.error}`);
  check('الحالة الحقيقية على الخادم تبقى draft (لا تغيير صامت)', (await statusOf(headers, draftId)) === 'draft');

  // ── (ب) صدق الواجهة (فحص ثابت على المصدر) ────────────────────────────────
  group('صدق الواجهة: لا نجاح وهمي قبل تأكيد الخادم');
  const ctx = readFileSync(join(REPO_ROOT, 'src/context/AppContext.tsx'), 'utf8');
  const start = ctx.indexOf('const updatePostStatus =');
  const end = ctx.indexOf('const updatePostContent =', start);
  const fn = start >= 0 && end > start ? ctx.slice(start, end) : '';
  check('دالة updatePostStatus موجودة', fn.length > 0);
  // لا يوجد showToast للنجاح قبل الكتلة الفعلية (المتفائل) — نجاح approved/scheduled داخل .then.
  check('رسالة نجاح «تم تحديث حالة المنشور» داخل .then (بعد التأكيد)', /\.then\(\(saved: any\) => \{[\s\S]*?تم تحديث حالة المنشور/.test(fn));
  // لا يوجد تحديث متفائل فوري للحالة على مستوى الدالة (setPosts قبل الطلب).
  const setPostsBeforeRequest = fn.indexOf('setPosts') < fn.indexOf('const request =');
  check('لا setPosts متفائل قبل إرسال الطلب', !setPostsBeforeRequest);
  // كل رسالة نجاح يجب أن تكون داخل معالج .then: العدد يجب أن يكون ≥2 (اعتماد + تعديل)
  // ولا يتجاوز عدد معالجات .then. الكود القديم كان يعلن نجاحاً واحداً غير مشروط (يفشل هنا).
  const thenCount = (fn.match(/\.then\(/g) || []).length;
  const successCount = (fn.match(/تم تحديث حالة المنشور إلى/g) || []).length;
  check('كل رسائل النجاح محروسة بـ.then (لا نجاح غير مشروط)', successCount >= 2 && successCount <= thenCount, `success=${successCount} then=${thenCount}`);
  // فرع الخطأ يعرض سبب الرفض الحقيقي من الخادم ثم يُرجع الحالة الحقيقية.
  check('فرع الخطأ يعرض رسالة الخادم الفعلية', /err\?\.message/.test(fn));
  check('فرع الخطأ يستدعي hydrateWorkspace لإرجاع الحالة الحقيقية', fn.includes('await hydrateWorkspace()'));
  // لا showToast نجاح غير مشروط في نهاية الدالة (السلوك المُثبت سابقاً).
  check('لا رسالة نجاح غير مشروطة في نهاية الدالة', !/\);\s*showToast\(`تم تحديث حالة المنشور إلى: \$\{statusNames\[newStatus\]\}`\);\s*\};\s*$/m.test(fn));
}

async function main(): Promise<void> {
  try { await run(); }
  catch (err) { failures.push(`انفجار غير متوقّع: ${String((err as Error)?.message || err)}`); }
  finally { await stop(); }
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} approval workflow regression checks`);
  }
}

void main();
