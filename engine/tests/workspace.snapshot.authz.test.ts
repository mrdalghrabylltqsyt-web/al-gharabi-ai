/**
 * Least-Privilege لـ/api/workspace/snapshot — إغلاق Point 3.
 *
 * المشكلة الأصلية: أي مستخدم authenticated (أي دور) كان يرى في `snapshot.platforms[].connection`
 * اسم الحساب (`accountName`) ومعرّفه (`accountId`) ووقت آخر مزامنة (`lastSyncAt`) — أي
 * بيانات تنظيمية عن حسابات المنصات المرتبطة بلا حاجة فعلية.
 *
 * الإصلاح: المالك يرى الهوية الكاملة (accountName/accountId/lastSyncAt/provider)؛ أي دور
 * آخر يرى الحالة التقنية فقط (platform/status/connectedAt/providerVerified) بلا هوية.
 *
 * هذا الاختبار يشغّل server.ts فعلياً ويوقّع جلسات حقيقية بأدوار مختلفة، ويثبت:
 *  - 401 بلا جلسة / جلسة مشوّهة / توكن غير صالح.
 *  - 403 لحساب معطّل.
 *  - owner: يرى accountName/accountId/lastSyncAt (لا كسر وظيفة المالك).
 *  - manager/staff/content_creator/customer_support: لا يرون أي من الحقول الحسّاسة،
 *    ولا تظهر قيمها الخام في نص الاستجابة إطلاقاً.
 *  - owner يرى الاسم نفسه الذي يراه في المسار المالكي /api/platforms/readiness.
 *
 * كل البيانات اختبار محلي؛ لا أسرار حقيقية ولا اتصال منصات ولا بيانات عمل حقيقية.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
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
const PORT = 6800 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const SESSION_SECRET = 'workspace-snapshot-authz-secret-local-only';
const secretBuffer = crypto.createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-ws-snapshot-'));

const nowIso = () => new Date().toISOString();
function user(id: string, role: string, titleAr: string, active = true) {
  return { id, name: `${role} اختبار`, email: `${role}@example.invalid`, role, roleTitleArabic: titleAr, avatar: '', active, createdAt: nowIso() };
}
const users = [
  user('owner-1', 'owner', 'مالك النظام (Owner)'),
  user('manager-1', 'manager', 'المدير العام'),
  user('staff-1', 'staff', 'الموظف'),
  user('creator-1', 'content_creator', 'مسؤول المحتوى'),
  user('support-1', 'customer_support', 'مسؤول خدمة العملاء'),
  user('disabled-1', 'staff', 'موظف معطّل', false),
];

// قيم حساسة فريدة: يجب أن تظهر للمالك فقط، ولا تظهر لأي دور آخر ولا في نص الاستجابة لغيره.
const SECRET_ACCOUNT_NAME = '@gharabi_secret_handle_ZZ9';
const SECRET_ACCOUNT_ID = 'acc_secret_9911';

function mint(uid: string): string {
  return signSession({ uid, iat: Date.now(), exp: Date.now() + 1000 * 60 * 60, sid: crypto.randomUUID() }, secretBuffer);
}

function seedState(): void {
  const snapshot = {
    schemaVersion: 16,
    savedAt: nowIso(),
    users,
    revokedSessions: [],
    userRevocations: [],
    audit: [],
    jobs: [],
    platformConnections: [
      { platform: 'telegram', status: 'connected', accountName: SECRET_ACCOUNT_NAME, accountId: SECRET_ACCOUNT_ID, connectedAt: nowIso(), lastSyncAt: nowIso(), providerVerified: true },
      { platform: 'youtube', status: 'connected', accountName: SECRET_ACCOUNT_NAME, accountId: SECRET_ACCOUNT_ID, connectedAt: nowIso(), lastSyncAt: nowIso(), providerVerified: true },
    ],
    workspace: { showroom: {}, products: [], posts: [], conversations: [], installmentPlans: [], sales: [], payments: [], socialComments: [], socialReplies: [], socialApprovals: [] },
  };
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify(snapshot), 'utf8');
}

function startApp(): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE,
    STATE_DIR: stateDir, SESSION_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
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

async function getSnapshot(token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api/workspace/snapshot`, { headers });
  let json: any = null; let raw = '';
  try { raw = await res.text(); json = JSON.parse(raw); } catch { /* قد لا يُعيد JSON */ }
  return { status: res.status, json, raw };
}

function connectionsOf(json: any): any[] {
  const platforms = json?.snapshot?.platforms;
  if (!Array.isArray(platforms)) return [];
  return platforms.map((p: any) => p.connection).filter(Boolean);
}

async function run(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  seedState();
  const app = startApp();
  const tokens: Record<string, string> = {
    owner: mint('owner-1'), manager: mint('manager-1'), staff: mint('staff-1'),
    creator: mint('creator-1'), support: mint('support-1'), disabled: mint('disabled-1'),
  };
  try {
    check('الخادم الفعلي يقلع', await waitForHealth(), app.log().slice(0, 300));

    // ---- 1) بلا جلسة / جلسة مشوّهة / توكن غير صالح => 401 ----
    check('401 بلا جلسة', (await getSnapshot()).status === 401);
    check('401 جلسة مشوّهة', (await getSnapshot('not-a-jwt')).status === 401);
    check('401 توكن موقّع بسرّ مختلف', (await getSnapshot(signSession({ uid: 'owner-1', iat: Date.now(), exp: Date.now() + 60000, sid: crypto.randomUUID() }, crypto.createHash('sha256').update('other-secret').digest()))).status === 401);

    // ---- 2) حساب معطّل => 403 ----
    check('403 حساب معطّل', (await getSnapshot(tokens.disabled)).status === 403);

    // ---- 3) المالك: يرى الهوية الكاملة (لا كسر وظيفة المالك) ----
    const owner = await getSnapshot(tokens.owner);
    check('200 (owner)', owner.status === 200, `status=${owner.status}`);
    const ownerConns = connectionsOf(owner.json);
    check('owner: توجد اتصالات', ownerConns.length >= 1, `n=${ownerConns.length}`);
    const ownerTg = ownerConns.find((c) => c.platform === 'telegram');
    check('owner: accountName ظاهر', ownerTg?.accountName === SECRET_ACCOUNT_NAME, String(ownerTg?.accountName));
    check('owner: accountId ظاهر', ownerTg?.accountId === SECRET_ACCOUNT_ID, String(ownerTg?.accountId));
    check('owner: lastSyncAt ظاهر', typeof ownerTg?.lastSyncAt === 'string' && ownerTg.lastSyncAt.length > 0);
    check('owner: provider مرفق', ownerTg?.provider !== undefined);

    // المالك يرى الاسم نفسه في المسار المالكي المرافق (اتساق، لا انحراف مصدر).
    const readinessRes = await fetch(`${BASE}/api/platforms/readiness`, { headers: { Authorization: `Bearer ${tokens.owner}` } });
    const readiness: any = await readinessRes.json().catch(() => ({}));
    const readinessTg = (readiness?.platforms || []).find((p: any) => p.platform === 'telegram')?.connection;
    check('owner: accountName موحّد بين snapshot وreadiness', readinessTg?.accountName === ownerTg?.accountName, `${readinessTg?.accountName} vs ${ownerTg?.accountName}`);

    // ---- 4) كل دور آخر: لا هوية حساب ولا معرّف ولا مزامنة، ولا ظهور للقيم الخام ----
    for (const role of ['manager', 'staff', 'creator', 'support'] as const) {
      const r = await getSnapshot(tokens[role]);
      check(`200 (${role}) — الوصول مسموح للبيانات غير الحسّاسة`, r.status === 200, `status=${r.status}`);
      const conns = connectionsOf(r.json);
      const leakKeys = conns.filter((c) => 'accountName' in c || 'accountId' in c || 'lastSyncAt' in c);
      check(`لا accountName/accountId/lastSyncAt (${role})`, leakKeys.length === 0, JSON.stringify(leakKeys[0] || {}));
      check(`لا قيمة اسم الحساب الخام (${role})`, !r.raw.includes(SECRET_ACCOUNT_NAME), 'leaked accountName');
      check(`لا قيمة معرّف الحساب الخام (${role})`, !r.raw.includes(SECRET_ACCOUNT_ID), 'leaked accountId');
      // الحالة التقنية تبقى متاحة (لا كسر لواجهة الاتصال).
      const tg = conns.find((c) => c.platform === 'telegram');
      check(`الحالة التقنية تبقى (${role})`, tg?.status === 'connected' && tg?.providerVerified === true, JSON.stringify(tg || {}));
    }

    // ---- 5) القيم غير الحسّاسة (المنتجات/الأقساط) تبقى متاحة لأي مستخدم مصرّح ----
    const staff = await getSnapshot(tokens.staff);
    check('staff: snapshot يحتوي products/installmentPlans', Array.isArray(staff.json?.snapshot?.products) && Array.isArray(staff.json?.snapshot?.installmentPlans));
  } catch (err) {
    failures.push(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    app.proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1200));
    if (!app.proc.killed) app.proc.kill('SIGKILL');
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تنظيف */ }
  }

  console.log(`\n${'='.repeat(60)}`);
  if (failures.length) {
    console.error(`FAILED: ${passed} passed, ${failures.length} failed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} workspace/snapshot least-privilege checks`);
}

run();
