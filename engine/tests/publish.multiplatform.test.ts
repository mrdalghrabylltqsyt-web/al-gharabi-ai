/**
 * اختبار تكاملي: النشر متعدد المنصات بنقرة واحدة + أفعال العقول الستة عبر خادم حقيقي.
 *
 * يثبت:
 *  - لا نشر إلا لمنشور approved عبر المسار الرسمي (owner).
 *  - التوزيع متوازٍ مع حالة مستقلة لكل منصة (نجاح/فشل/سبب).
 *  - لا يُعلن "published" بلا معرّف نشر حقيقي من مزود المنصة.
 *  - مسارات العقول الستة محمية (owner) والـwhitelist مفروض، والتصنيف الحتمي بلا Gemini.
 * بلا أي مزود حقيقي ولا حصة ولا سرّ.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
const APP_PORT = 7780 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'multiplatform-test-secret-not-real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-multi-'));

let proc: ChildProcess | null = null;
let log = '';

function startApp(): void {
  log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
  };
  delete env.GEMINI_API_KEY; delete env.DATABASE_URL;
  proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
}
async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function login(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}
async function createPost(auth: Record<string, string>, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE}/api/workspace/content`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

(async () => {
  startApp();
  const up = await waitForHealth();
  if (!up) { console.error('server did not start:\n' + log.slice(-3000)); process.exit(1); }
  const auth = await login();

  group('1) مسار النشر متعدد المنصات محمي ومقيّد');
  // بلا جلسة ⇒ 401.
  const noAuth = await fetch(`${BASE}/api/workspace/content/x/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('بلا جلسة ⇒ 401', noAuth.status === 401, String(noAuth.status));

  // منشور غير موجود ⇒ 404.
  const missing = await fetch(`${BASE}/api/workspace/content/nope/publish`, { method: 'POST', headers: auth, body: '{}' });
  check('منشور غير موجود ⇒ 404', missing.status === 404, String(missing.status));

  group('2) لا نشر إلا لمنشور approved');
  const draft = await createPost(auth, { title: 'مسودة اختبار', content: 'نص تجريبي بلا عرض تجاري', targetPlatforms: ['youtube', 'telegram'], status: 'review' });
  check('إنشاء منشور للمراجعة 201', draft.status === 201, String(draft.status));
  const postId = draft.body?.post?.id;
  check('معرّف المنشور موجود', typeof postId === 'string' && postId.length > 0);
  const notApproved = await fetch(`${BASE}/api/workspace/content/${postId}/publish`, { method: 'POST', headers: auth, body: '{}' });
  const naBody = await notApproved.json();
  check('منشور غير معتمد ⇒ 409 APPROVAL_REQUIRED', notApproved.status === 409 && naBody.code === 'APPROVAL_REQUIRED', `${notApproved.status}/${naBody.code}`);

  group('3) الاعتماد عبر المسار الرسمي ثم التوزيع');
  const approve = await fetch(`${BASE}/api/workspace/content/${postId}/approve`, { method: 'POST', headers: auth, body: JSON.stringify({ note: 'اعتماد اختباري' }) });
  const apBody = await approve.json();
  check('الاعتماد الرسمي نجح', approve.status === 200 && apBody.success === true, String(approve.status));
  check('الحالة صارت approved', apBody.post?.status === 'approved', String(apBody.post?.status));

  const pub = await fetch(`${BASE}/api/workspace/content/${postId}/publish`, { method: 'POST', headers: auth, body: '{}' });
  const pubBody = await pub.json();
  check('النشر متعدد المنصات نجح كطلب', pub.status === 200 && pubBody.success === true, String(pub.status));
  check('نتيجة مستقلة لكل منصة', pubBody.results && Object.keys(pubBody.results).length === 2 && 'youtube' in pubBody.results && 'telegram' in pubBody.results, JSON.stringify(Object.keys(pubBody.results || {})));
  // لا منصة متصلة ⇒ لا تسليم، والحالة approved تبقى (لا published كاذب).
  check('لا تسليم بلا اتصال موثق', pubBody.anyDelivered === false, String(pubBody.anyDelivered));
  check('لم يُعلن published كاذباً', pubBody.post?.status === 'approved', String(pubBody.post?.status));
  check('كل منصة فشلت بسبب صريح', Object.values(pubBody.results).every((r: any) => r.state === 'failed' && r.error), JSON.stringify(pubBody.results));
  check('لا معرّف مزود مختلق', Object.values(pubBody.results).every((r: any) => r.providerPostId === null), JSON.stringify(pubBody.results));

  group('4) أفعال العقول الستة: تصريح + whitelist');
  const auditNoAuth = await fetch(`${BASE}/api/agent/team/six-agent/audit`);
  check('سجل التدقيق بلا جلسة ⇒ 401', auditNoAuth.status === 401, String(auditNoAuth.status));
  const audit = await fetch(`${BASE}/api/agent/team/six-agent/audit`, { headers: auth });
  const auditBody = await audit.json();
  check('سجل التدقيق للمالك ⇒ 200', audit.status === 200 && auditBody.success === true, String(audit.status));
  check('القائمة المسموحة معلنة (4)', Array.isArray(auditBody.allowedActions) && auditBody.allowedActions.length === 4);
  check('لا تنفيذ خارجي مفتوح', auditBody.executesExternalActions === false);
  check('لا Gemini', auditBody.geminiUsed === false);

  const badAction = await fetch(`${BASE}/api/agent/team/six-agent/execute`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'publish' }) });
  check('فعل خارج القائمة ⇒ 422', badAction.status === 422, String(badAction.status));

  const praiseExec = await fetch(`${BASE}/api/agent/team/six-agent/execute`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'classify_tag_comment', platform: 'youtube', commentId: 'c-x', commentText: 'ما شاء الله مرتب', tag: 'positive' }) });
  const praiseBody = await praiseExec.json();
  check('تصنيف مدح ⇒ تنفيذ حتمي', praiseBody.success === true && praiseBody.outcome === 'executed' && praiseBody.geminiUsed === false, JSON.stringify(praiseBody));

  const questionExec = await fetch(`${BASE}/api/agent/team/six-agent/execute`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'classify_tag_comment', platform: 'youtube', commentId: 'c-y', commentText: 'شنو نوع الموبايل؟' }) });
  const questionBody = await questionExec.json();
  check('سؤال ⇒ تصعيد للعقل المركزي', questionBody.requiresCentralBrain === true && questionBody.outcome === 'escalated', JSON.stringify(questionBody));

  group('5) سجل التدقيق يتراكم بعد الأفعال');
  const audit2 = await (await fetch(`${BASE}/api/agent/team/six-agent/audit`, { headers: auth })).json();
  check('السجل يسجّل الأفعال', audit2.summary?.total >= 2, JSON.stringify(audit2.summary));

  group('6) الحالة في الصحة/الجاهزية بلا سرّ');
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check('health يعرض sixAgentExecution', Boolean(health.sixAgentExecution), JSON.stringify(health.sixAgentExecution || {}).slice(0, 120));
  check('health لا يكشف أي سرّ في الكتلة', !JSON.stringify(health.sixAgentExecution || {}).match(/token|secret|key/i));
  const readiness = await (await fetch(`${BASE}/api/readiness`)).json();
  check('readiness يعرض sixAgentExecution', Boolean(readiness.brain?.sixAgentExecution), JSON.stringify(readiness.brain?.sixAgentExecution || {}).slice(0, 120));

  // إغلاق
  try { proc?.kill('SIGTERM'); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 1500));
  try { proc?.kill('SIGKILL'); } catch { /* ignore */ }
  try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* ignore */ }

  console.log('\n' + '='.repeat(60));
  if (failures.length === 0) { console.log(`PASSED: ${passed} multi-platform publish + six-agent checks`); process.exit(0); }
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`); failures.forEach((f) => console.error(' - ' + f)); process.exit(1);
})();
