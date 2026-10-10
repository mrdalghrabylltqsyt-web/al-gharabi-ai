/**
 * اختبار تكاملي: توليد المحتوى في /api/ai/content-brief يحترم الحدّ الصحيح للمنصة.
 *
 * يثبت إصلاحين:
 *  1) Threads: المسودة المولّدة تُقاس بـUTF-8 bytes (لا UTF-16 length)، فلا تتجاوز
 *     500 بايت — بما يشمل العربية والإيموجي والوسوم — بلا كسر إيموجي مركّب، وبإعلان
 *     charCount/withinLimit الصادقين.
 *  2) Facebook: الحدّ المستخدم هو 2000 (استُعيد كما قبل التوحيد)، لا 5000.
 *
 * يقرأ المسودة الحقيقية المحفوظة (saveDrafts) عبر /api/workspace/snapshot ليتحقّق من
 * النص الفعلي (الرد يحذف text). خادم حقيقي محلي عبر preview-login — بلا مزود ولا نشر.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
const APP_PORT = 7801 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'content-brief-limits-secret-not-real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-brief-limits-'));

let proc: ChildProcess | null = null;
let log = '';

const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };

function seedState(): void {
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: { showroom: {}, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [], providerTokens: {} },
  }), 'utf8');
}

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
  const data = await res.json();
  const token = data?.token || data?.sessionToken;
  if (!token) throw new Error('preview-login failed: ' + JSON.stringify(data));
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}
async function contentBrief(auth: Record<string, string>, body: any) {
  const res = await fetch(`${BASE}/api/ai/content-brief`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function savedThreadsDraft(auth: Record<string, string>): Promise<string | null> {
  const res = await fetch(`${BASE}/api/workspace/snapshot`, { headers: auth });
  const data = await res.json().catch(() => null);
  const posts: any[] = data?.snapshot?.posts || [];
  const threads = posts.find((p) => Array.isArray(p.targetPlatforms) && p.targetPlatforms.includes('threads'));
  if (!threads) return null;
  return threads.platformVersions?.threads || threads.content || null;
}
function bytes(s: string): number { return Buffer.byteLength(s, 'utf8'); }
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const n = s.charCodeAt(i + 1); if (!(n >= 0xdc00 && n <= 0xdfff)) return true; i++; }
    else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}
function stop(p: ChildProcess | null): Promise<void> {
  return new Promise((resolve) => { if (!p) return resolve(); p.once('exit', () => resolve()); p.kill('SIGTERM'); setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* ignore */ } resolve(); }, 5000); });
}

(async function main() {
  seedState();
  startApp();
  try {
    check('الخادم يقلع', await waitForHealth(), log.slice(0, 400));
    const auth = await login();

    group('1) threads عادي: الحد 500 والقياس بالبايتات');
    const normal = await contentBrief(auth, { task: 'عرض تقسيط على الأجهزة المنزلية', platforms: ['threads'], productName: 'ثلاجة كهربائية', tone: 'احترافية وميسرة', saveDrafts: true });
    check('HTTP 201', normal.status === 201, `status=${normal.status} body=${JSON.stringify(normal.body).slice(0, 200)}`);
    const nThreads = (normal.body?.result?.content || []).find((c: any) => c.platform === 'threads');
    check('مسودة threads موجودة', Boolean(nThreads), JSON.stringify(normal.body?.result?.content || []).slice(0, 200));
    check('حد threads المعلن = 500', nThreads?.limit === 500, String(nThreads?.limit));
    check('withinLimit=true ومطابق للبايتات', nThreads?.withinLimit === true && (nThreads?.charCount ?? 10_000) <= 500, `charCount=${nThreads?.charCount}`);
    const nText = await savedThreadsDraft(auth);
    check('النص المحفوظ فعلاً <= 500 بايت', typeof nText === 'string' && bytes(nText) <= 500, nText ? String(bytes(nText)) : 'null');
    check('task المستخدم لم يُعدَّل في الرد', normal.body?.result?.task === 'عرض تقسيط على الأجهزة المنزلية');

    group('2) threads بنص عربي طويل (>500 بايت بالمحارف الكاملة) => لا يتجاوز بعد التوليد');
    const longArabicName = ('جهاز منزلي اقتصادي ').repeat(20);
    const longTone = ('خطة تقسيط ميسرة ومتابعة كاملة للعميل ').repeat(8);
    const longBrief = await contentBrief(auth, { task: 'عرض موسّع على تشكيلة الأجهزة', platforms: ['threads'], productName: longArabicName, tone: longTone, saveDrafts: true });
    check('HTTP 201 للطلب الطويل', longBrief.status === 201, `status=${longBrief.status}`);
    const lThreads = (longBrief.body?.result?.content || []).find((c: any) => c.platform === 'threads');
    check('withinLimit=true رغم الطول', lThreads?.withinLimit === true, JSON.stringify(lThreads));
    check('charCount (بالبايتات) <= 500', (lThreads?.charCount ?? 10_000) <= 500, String(lThreads?.charCount));
    const lText = await savedThreadsDraft(auth);
    check('النص المحفوظ <= 500 بايت (UTF-8)', typeof lText === 'string' && bytes(lText) <= 500, lText ? `bytes=${bytes(lText)} chars=${lText.length}` : 'null');
    check('القصّ لم يكسر إيموجي/يتيماً', typeof lText === 'string' && !hasLoneSurrogate(lText));

    group('3) threads مع إيموجي: القياس بالبايتات ولا كسر للرموز');
    const emojiBrief = await contentBrief(auth, { task: 'عرض مميز 🚀🔥 على الأجهزة', platforms: ['threads'], productName: '🔥 عرض إيموجي 🚀', tone: 'حماسية 😍 جداً '.repeat(20), saveDrafts: true });
    check('HTTP 201 للإيموجي', emojiBrief.status === 201, `status=${emojiBrief.status}`);
    const eText = await savedThreadsDraft(auth);
    check('النص المحفوظ <= 500 بايت', typeof eText === 'string' && bytes(eText) <= 500, eText ? String(bytes(eText)) : 'null');
    check('لا يوجد يتيم UTF-16 (لم يُكسر إيموجي)', typeof eText === 'string' && !hasLoneSurrogate(eText));
    check('الهاشتاغات ضمن النص المحسوب (إن وُجدت)', typeof eText === 'string' && (!eText.includes('#') || bytes(eText) <= 500));

    group('4) انحدار: facebook = 2000 لا 5000');
    const fbBrief = await contentBrief(auth, { task: 'عرض تقسيط', platforms: ['facebook'], productName: 'غسالة أوتوماتيكية', saveDrafts: false });
    check('HTTP 201 لفيسبوك', fbBrief.status === 201, `status=${fbBrief.status}`);
    const fb = (fbBrief.body?.result?.content || []).find((c: any) => c.platform === 'facebook');
    check('حد facebook المعلن = 2000', fb?.limit === 2000, String(fb?.limit));
    check('حد facebook ليس 5000', fb?.limit !== 5000);

    group('5) بقية المنصات غير متأثرة (threads=500, instagram=2200)');
    const multi = await contentBrief(auth, { task: 'عرض تقسيط متعدد', platforms: ['threads', 'instagram'], productName: 'مكيف سبليت', saveDrafts: false });
    const content = multi.body?.result?.content || [];
    const th = content.find((c: any) => c.platform === 'threads');
    const ig = content.find((c: any) => c.platform === 'instagram');
    check('limit threads=500', th?.limit === 500, String(th?.limit));
    check('limit instagram=2200', ig?.limit === 2200, String(ig?.limit));
    check('كل مسودة معلنة withinLimit صادقة (المحسوب <= الحد)', content.every((c: any) => c.withinLimit === (c.charCount <= c.limit)), JSON.stringify(content.map((c: any) => [c.platform, c.charCount, c.limit])));
  } finally {
    await stop(proc);
  }

  rmSync(stateDir, { recursive: true, force: true });
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} content-brief text-limit checks`);
  }
})();
