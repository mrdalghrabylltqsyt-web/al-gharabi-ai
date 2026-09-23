/**
 * اختبار قبول للتصريح على الخادم الفعلي (Batch 4).
 *
 * سبب الوجود: اختبار مسارات السوشيال (social.routes.test.ts) يحقن برمجياً
 * authenticateToken و requireOwner، فيغطي منطق المسارات لا بوابة المصادقة
 * الحقيقية. هذا الاختبار يشغّل server.ts فعلياً ويمنح:
 *  - مالكاً (owner) بجلسة موقّعة صحيحة،
 *  - مستخدماً عادياً (staff) بجلسة صحيحة،
 * ثم يثبت أن:
 *  - المسارات المحمية ترفض بلا جلسة (401)،
 *  - المسارات الحصرية بالمالك ترفض المستخدم العادي (403) ولا تسمح بتجاوز،
 *  - المالك يمرّ فعلاً (200)،
 *  - الدور لا يُستخرج من التوكن بل من قاعدة البيانات (تغيير الدور يسري فوراً)،
 *  - الإبطال/الخروج يسري، والسرّ الخاطئ يُرفض،
 *  - تبادل توكن المعاينة يبقى POST فقط ولا يقبل التوكن في سطر الطلب.
 *
 * كل ما هنا بيانات اختبار محلية؛ لا أسرار حقيقية ولا اتصال منصات.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { signSession } from '../auth/sessions';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const PORT = 6200 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const SESSION_SECRET = 'acceptance-authz-secret-local-only';
const secretBuffer = crypto.createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-authz-'));

// مستخدمون اختبار محليون: المالك الافتراضي + موظف عادي.
const ownerUser = { id: 'owner', name: 'مالك النظام (Owner)', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام (Owner)', avatar: '', active: true, createdAt: new Date().toISOString() };
const staffUser = { id: 'staff-1', name: 'موظف اختبار', email: 'staff@example.invalid', role: 'staff', roleTitleArabic: 'الموظف', avatar: '', active: true, createdAt: new Date().toISOString() };

function mint(uid: string, sid: string): string {
  return signSession({ uid, iat: Date.now(), exp: Date.now() + 1000 * 60 * 60, sid }, secretBuffer);
}

function seedState(): void {
  const snapshot = {
    schemaVersion: 16,
    savedAt: new Date().toISOString(),
    users: [ownerUser, staffUser],
    revokedSessions: [],
    userRevocations: [],
    audit: [],
    jobs: [],
    platformConnections: [],
    workspace: { showroom: {}, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [] },
  };
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify(snapshot), 'utf8');
}

function startApp(): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE,
    STATE_DIR: stateDir, SESSION_SECRET,
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  delete env.GHARABI_PREVIEW_TOKEN;
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

async function call(path: string, method: string, token?: string, body?: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json: any = null;
  try { json = await res.json(); } catch { /* بعض المسارات قد لا تُعيد JSON */ }
  return { status: res.status, json };
}

async function run(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  seedState();
  const app = startApp();
  try {
    check('الخادم الفعلي يقلع', await waitForHealth(), app.log().slice(0, 300));

    const ownerToken = mint('owner', crypto.randomUUID());
    const staffToken = mint('staff-1', crypto.randomUUID());
    const forged = signSession({ uid: 'staff-1', iat: Date.now(), exp: Date.now() + 60000, sid: 'x' }, crypto.createHash('sha256').update('gharabi-session:wrong').digest());

    // 1) بلا جلسة => 401 على مسار محمي ومسار owner-only.
    check('بدون جلسة: مسار محمي => 401', (await call('/api/social/manager/status', 'GET')).status === 401);
    check('بدون جلسة: قرار مراجعة => 401', (await call('/api/social/manager/approvals', 'POST', undefined, { platform: 'facebook', externalId: 'x', status: 'approved' })).status === 401);
    check('بدون جلسة: قائمة القرارات => 401', (await call('/api/social/manager/approvals', 'GET')).status === 401);

    // 2) توكن موقّع بسرّ خاطئ => 401 (لا تجاوز).
    check('توكن بسرّ خاطئ => 401', (await call('/api/social/manager/status', 'GET', forged)).status === 401);

    // 3) مستخدم عادي: يمر على المسار المحمي، ويُرفض على owner-only بـ403.
    check('موظف: المسار المحمي للقراءة => 200', (await call('/api/social/manager/status', 'GET', staffToken)).status === 200);
    const staffApprove = await call('/api/social/manager/approvals', 'POST', staffToken, { platform: 'facebook', externalId: 'authz-1', status: 'approved' });
    check('موظف: قرار المراجعة مرفوض 403 (owner-only)', staffApprove.status === 403, `status=${staffApprove.status}`);
    check('موظف: الرفض صريح ولا يعيد نجاحاً', staffApprove.json?.success === false);
    const staffRoleChange = await call('/api/users/staff-1/role', 'PUT', staffToken, { role: 'manager' });
    check('موظف: تغيير الأدوار مرفوض 403', staffRoleChange.status === 403, `status=${staffRoleChange.status}`);
    const staffLogoutOthers = await call('/api/users', 'GET', staffToken);
    check('موظف: قائمة المستخدمين متاحة للمصادق (ليست owner-only)', staffLogoutOthers.status === 200);

    // 4) المالك: يمر فعلاً.
    const ownerApprove = await call('/api/social/manager/approvals', 'POST', ownerToken, { platform: 'facebook', externalId: 'authz-1', status: 'approved' });
    check('مالك: قرار المراجعة => 200', ownerApprove.status === 200 && ownerApprove.json?.approval?.status === 'approved', `status=${ownerApprove.status}`);
    check('مالك: القرار غير مُسلَّم للمنصة', ownerApprove.json?.delivered === false && ownerApprove.json?.simulated === true);

    // 5) الدور يُقرأ من قاعدة البيانات لا من التوكن: تعطيل الموظف يُبطله فوراً.
    const disable = await call('/api/users/staff-1/status', 'PUT', ownerToken, { active: false });
    check('مالك: تعطيل الموظف ينجح', disable.status === 200, `status=${disable.status}`);
    check('موظف مُعطَّل: جلسته تُرفض فوراً (403/401)', [401, 403].includes((await call('/api/social/manager/status', 'GET', staffToken)).status));

    // 6) الإبطال عند الخروج يسري.
    check('مالك: الخروج ينجح', (await call('/api/auth/logout', 'POST', ownerToken)).status === 200);
    check('مالك بعد الخروج: الجلسة تُرفض', (await call('/api/social/manager/status', 'GET', ownerToken)).status === 401);

    // 7) مسار المعاينة غير مُفعَّل (لا GHARABI_PREVIEW_TOKEN) => 404 كأنه غير موجود.
    check('معاينة غير مفعّلة: POST => 404', (await call('/api/auth/preview-login', 'POST', undefined, { token: 'x' })).status === 404);
    check('معاينة غير مفعّلة: GET => 404', (await call('/api/auth/preview-login?token=x', 'GET')).status === 404);

    // 8) التحقق الحي من مزود Gemini محصور بالمالك على الخادم الفعلي،
    //    ولا يمكن تجاوزه باستدعاء API مباشر. (جلسات جديدة لأن الخطوة 5 عطّلت
    //    الموظف فأُبطلت توكناته، والخطوة 6 أخرجت المالك.)
    const freshOwnerToken = mint('owner', crypto.randomUUID());
    // إعادة تفعيل الموظف ليكون حساباً عادياً صالحاً في هذا الفحص.
    check('مالك جديد: إعادة تفعيل الموظف', (await call('/api/users/staff-1/status', 'PUT', freshOwnerToken, { active: true })).status === 200);
    const freshStaffToken = mint('staff-1', crypto.randomUUID());

    check('بلا جلسة: التحقق الحي POST => 401', (await call('/api/ai/verify-provider', 'POST', undefined, {})).status === 401);
    check('بلا جلسة: التحقق الحي GET => 405 (لا يمر للتسجيل)', (await call('/api/ai/verify-provider', 'GET')).status === 405);
    const staffVerify = await call('/api/ai/verify-provider', 'POST', freshStaffToken, {});
    check('موظف: التحقق الحي مرفوض 403 (owner-only)', staffVerify.status === 403, `status=${staffVerify.status}`);
    check('موظف: الرفض لا يحمل أي نجاح', staffVerify.json?.success === false);
    // بدون GEMINI_API_KEY في بيئة الاختبار: لا ادعاء نجاح، ورسالة NOT VERIFIED صريحة، وبلا سر.
    const ownerVerify = await call('/api/ai/verify-provider', 'POST', freshOwnerToken, {});
    check('مالك: التحقق الحي => 200 بلا ادعاء نجاح عند غياب المفتاح', ownerVerify.status === 200 && ownerVerify.json?.verified === false && ownerVerify.json?.success === false, `status=${ownerVerify.status}`);
    check('مالك: رسالة NOT VERIFIED صريحة بلا مفتاح', String(ownerVerify.json?.note || '').includes('NOT VERIFIED'));
    check('التحقق الحي لا يسرّب أي مفتاح', !/AIzaSy[A-Za-z0-9_\-]{5,}/.test(JSON.stringify(ownerVerify.json || {})));

    console.log('\n' + '='.repeat(60));
    if (failures.length) {
      console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
      for (const f of failures) console.error(`  ✗ ${f}`);
      process.exitCode = 1;
    } else {
      console.log(`PASSED: ${passed} real-server authorization checks`);
    }
  } finally {
    try { app.proc.kill('SIGTERM'); } catch { /* تجاهل */ }
    await new Promise((r) => setTimeout(r, 700));
    try { app.proc.kill('SIGKILL'); } catch { /* تجاهل */ }
    rmSync(stateDir, { recursive: true, force: true });
  }
}

run().catch((err) => { console.error('Authz acceptance harness crashed:', err); process.exit(1); });
