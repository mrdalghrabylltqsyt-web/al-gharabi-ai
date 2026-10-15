/**
 * اختبار انحدار Phase-2 — دفعة LOW/INFO + webhook durability.
 *
 * F-18: /api/webhooks/:platform ينتظر الكتابة الدائمة قبل الإقرار 202.
 * F-24: رأس HSTS يُرسَل في الإنتاج.
 * F-25: /api/users لا يكشف بريد الموظفين لغير المالك/المدير.
 * F-26: لا يُسجَّل بريد الموظفين كنص صريح في console.log (بصمة مجزّأة فقط).
 * F-27: /api/health العام لا يكشف مسار المجلد الداخلي (stateDir).
 * F-28: PATCH /api/crm/leads/:id لا يسمح بتغيير المعرّف.
 *
 * يفشل على الكود القديم (كان يسرّب البريد/المسار، ويسمح بتغيير id، وبلا HSTS،
 * وبلا انتظار الكتابة قبل 202).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
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
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const PORT = 6180 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const SESSION_SECRET = 'phase2-batch-secret-local-only';
const secretBuffer = crypto.createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-batch-'));
const WEBHOOK_SECRET = 'phase2-webhook-secret-local-only';

const nowIso = () => new Date().toISOString();
function user(id: string, role: string) {
  return { id, name: `${role} اختبار`, email: `${role}@example.invalid`, role, roleTitleArabic: role, avatar: '', active: true, createdAt: nowIso() };
}
const users = [user('owner-1', 'owner'), user('manager-1', 'manager'), user('staff-1', 'staff')];
function mint(uid: string): string {
  return signSession({ uid, iat: Date.now(), exp: Date.now() + 3600_000, sid: crypto.randomUUID() }, secretBuffer);
}
function seedState(): void {
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: nowIso(), users, revokedSessions: [], userRevocations: [], audit: [], jobs: [],
    platformConnections: [], workspace: { showroom: {}, products: [], leads: [{ id: 'lead-1', customerName: 'عميل', status: 'new', ownerId: 'staff-1' }], socialComments: [], socialReplies: [], posts: [] },
  }), 'utf8');
}
function startApp(): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir, SESSION_SECRET, WEBHOOK_SECRET,
    GHARABI_ENABLE_LEGACY_ERP_SCOPE: 'true',
  };
  delete env.GEMINI_API_KEY; delete env.DATABASE_URL; delete env.GHARABI_PREVIEW_TOKEN;
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
  let json: any = null; try { json = await res.json(); } catch { /* قد لا يكون JSON */ }
  return { status: res.status, json, headers: res.headers };
}

async function run(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  seedState();
  const app = startApp();
  const owner = mint('owner-1'); const manager = mint('manager-1'); const staff = mint('staff-1');
  try {
    check('الخادم الفعلي يقلع', await waitForHealth(), app.log().slice(0, 300));

    group('F-24) رأس HSTS في الإنتاج');
    const h = await call('/api/health', 'GET');
    check('HSTS مُرسَل', /max-age=\d+/.test(h.headers.get('strict-transport-security') || ''), `hsts=${h.headers.get('strict-transport-security')}`);
    check('HSTS يشمل includeSubDomains', (h.headers.get('strict-transport-security') || '').includes('includeSubDomains'));

    group('F-25) /api/users لا يكشف البريد لغير المالك/المدير');
    const staffUsers = await call('/api/users', 'GET', staff);
    check('staff: لا بريد في الاستجابة', !JSON.stringify(staffUsers.json).includes('@example.invalid'), JSON.stringify(staffUsers.json).slice(0, 120));
    check('staff: الاسم والدور ظاهران', staffUsers.json?.users?.[0]?.name && staffUsers.json?.users?.[0]?.role);
    const ownerUsers = await call('/api/users', 'GET', owner);
    check('owner: البريد ظاهر', JSON.stringify(ownerUsers.json).includes('@example.invalid'));
    const managerUsers = await call('/api/users', 'GET', manager);
    check('manager: البريد ظاهر', JSON.stringify(managerUsers.json).includes('@example.invalid'));

    group('F-27) /api/health العام لا يكشف stateDir');
    const health = await call('/api/health', 'GET');
    check('لا حقل stateDir في الصحة', !JSON.stringify(health.json).includes('stateDir'));
    check('لا مسار /tmp في الصحة', !JSON.stringify(health.json).includes(stateDir));

    group('F-28) PATCH /api/crm/leads/:id لا يغيّر المعرّف');
    const patch = await call('/api/crm/leads/lead-1', 'PATCH', owner, { id: 'HACKED-ID', notes: 'تعديل' });
    check('PATCH ناجح', patch.status === 200, `status=${patch.status}`);
    check('المعرّف بقي lead-1', patch.json?.lead?.id === 'lead-1', `id=${patch.json?.lead?.id}`);

    group('F-18) webhook ينتظر الكتابة قبل الإقرار (بنية + سلوك)');
    const src = readFileSync(join(REPO_ROOT, 'server.ts'), 'utf8');
    check('المسار العام ينتظر الكتابة الصارمة قبل الإقرار', /app\.post\("\/api\/webhooks\/:platform", async[\s\S]{0,3200}await persistStateDurableOrThrow\(\)/.test(src));
    check('الكتابة الصارمة تُعلن الخطأ صراحةً (ترمي)', /async function persistStateDurableOrThrow\(\)[\s\S]{0,900}throw new Error/.test(src));
    // سلوك: توقيع صحيح => 202 مقبول (ولا duplicate).
    const raw = JSON.stringify({ type: 'test', data: { x: 1 } });
    const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    const wh = await fetch(`${BASE}/api/webhooks/facebook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gharabi-signature': `sha256=${sig}`, 'x-event-id': 'evt-f18-1' }, body: raw });
    check('webhook بتوقيع صحيح => 202', wh.status === 202, `status=${wh.status}`);
    const whDup = await fetch(`${BASE}/api/webhooks/facebook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gharabi-signature': `sha256=${sig}`, 'x-event-id': 'evt-f18-1' }, body: raw });
    const dupJson = await whDup.json().catch(() => ({}));
    check('webhook مكرر => duplicate (منع تكرار يعمل)', whDup.status === 200 && dupJson.duplicate === true, `status=${whDup.status}`);

    group('F-18/F-29) فشل الكتابة الدائمة => 503 بلا تسجيل الحدث (إعادة الإرسال تُقبل)');
    const tmpPath = join(stateDir, '.gharabi-state.json.tmp');
    const raw2 = JSON.stringify({ type: 'durability', data: { y: 2 } });
    const sig2 = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw2).digest('hex');
    const postWebhook = (id: string) => fetch(`${BASE}/api/webhooks/facebook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gharabi-signature': `sha256=${sig2}`, 'x-event-id': id },
      body: raw2,
    });
    let failed = false;
    try {
      mkdirSync(tmpPath); // حجب الكتابة الذرّية: writeFileSync إلى مسار هو مجلد يفشل
      const resFail = await postWebhook('evt-f29-1');
      failed = resFail.status === 503;
      check('فشل الكتابة => 503 (retryable)', resFail.status === 503, `status=${resFail.status}`);
      const j = await resFail.json().catch(() => ({}));
      check('الرد يحمل retryable:true', j.retryable === true, JSON.stringify(j).slice(0, 120));
    } finally {
      rmSync(tmpPath, { recursive: true, force: true });
    }
    if (failed) {
      // إعادة الإرسال بعد زوال سبب الفشل تُقبل (الحدث لم يُسجَّل كي لا يُرفض كمكرر).
      const resRetry = await postWebhook('evt-f29-1');
      check('إعادة الإرسال بعد الفشل => 202 (لا duplicate)', resRetry.status === 202, `status=${resRetry.status}`);
      const resRetryDup = await postWebhook('evt-f29-1');
      const rdj = await resRetryDup.json().catch(() => ({}));
      check('إعادة الإرسال مرّة أخرى => duplicate (سُجّل الآن)', resRetryDup.status === 200 && rdj.duplicate === true, `status=${resRetryDup.status}`);
    } else {
      check('محاكاة فشل الكتابة نجحت في إحداث 503', false, 'لم يُرصد 503 — قد لا يُحجب .tmp على هذا النظام');
    }

    group('F-26) لا بريد صريح في سجلات الخادم (بنية)');
    check('لا console.log بالبريد الخام', !/console\.(log|error)\([^)]*\$\{[^}]*\.email\}/.test(src));
    check('يستخدم logSafeEmailId', src.includes('logSafeEmailId(user.email)') && src.includes('logSafeEmailId(newUser.email)'));
    check('البصمة HMAC بمفتاح الجلسة لا SHA-256 مجرّد', /function logSafeEmailId[\s\S]{0,260}createHmac\("sha256", SESSION_SECRET\)/.test(src));

    console.log('\n' + '='.repeat(60));
    if (failures.length) {
      console.log(`FAILED: ${passed} passed, ${failures.length} failed`);
      for (const f of failures) console.log('  - ' + f);
    } else {
      console.log(`PASSED: ${passed} Phase-2 batch (F-18,24,25,26,27,28) checks`);
    }
  } finally {
    try { app.proc.kill('SIGKILL'); } catch { /* ignore */ }
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  process.exit(failures.length ? 1 : 0);
}

run();
