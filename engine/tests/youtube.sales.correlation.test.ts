/**
 * اختبار ربط YouTube بالمبيعات الموثّقة (Point 3) — قراءة فقط.
 *
 * قسمان:
 *  1) وحدة على الدالة الصافية buildYouTubeSalesCorrelation: مطابقة صحيحة، سلبي صحيح،
 *     ورفض أي مطابقة جزئية/ضبابية (لا نسبة ولا سببية).
 *  2) تكامل على الخادم الفعلي: المسار owner-only (401/403/200) ويعيد أرقاماً حقيقية.
 *
 * كل البيانات اختبار محلي؛ لا أسرار ولا اتصال منصات ولا بيانات عمل حقيقية.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { signSession } from '../auth/sessions';
import { buildYouTubeSalesCorrelation } from '../social/youtubeSalesCorrelation';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();

// ---------- 1) وحدة (منطق صافٍ) ----------
function unitTests(): void {
  const productNamesById = new Map<string, string>([['prod-1', 'منتج اختبار'], ['prod-2', 'منتج آخر']]);
  const comments = [
    { platform: 'youtube', externalId: 'yt-1', productId: 'prod-1', createdAt: hoursAgo(1) }, // مطابقة
    { platform: 'youtube', externalId: 'yt-2', productId: 'prod-2', createdAt: hoursAgo(1) }, // بيع خارج النافذة
    { platform: 'youtube', externalId: 'yt-3', productId: null, createdAt: hoursAgo(1) }, // بلا معرّف منتج
    { platform: 'facebook', externalId: 'fb-1', productId: 'prod-1', createdAt: hoursAgo(1) }, // ليست YouTube
  ];
  const sales = [
    { id: 'sale-1', productId: 'prod-1', customerName: 'عميل 1', createdAt: hoursAgo(1), status: 'confirmed' }, // مطابقة
    { id: 'sale-2', productId: 'prod-1x', customerName: 'عميل 2', createdAt: hoursAgo(1), status: 'confirmed' }, // معرّف مشابه — لا يُطابَق
    { id: 'sale-3', productId: 'prod-2', customerName: 'عميل 3', createdAt: daysAgo(100), status: 'confirmed' }, // قديم
  ];
  const r = buildYouTubeSalesCorrelation({ comments, sales, productNamesById, now: NOW, windowDays: 30 });

  check('وحدة: عدد تعليقات YouTube ذات معرّف منتج صريح = 2', r.youtubeCommentsWithExplicitProduct === 2, `got ${r.youtubeCommentsWithExplicitProduct}`);
  check('وحدة: مطابقة صحيحة واحدة فقط', r.matchedSalesCount === 1, `got ${r.matchedSalesCount}`);
  check('وحدة: المطابقة هي prod-1/sale-1', r.matches[0]?.productId === 'prod-1' && r.matches[0]?.sale?.id === 'sale-1', JSON.stringify(r.matches[0]));
  check('وحدة: اسم المنتج من الخريطة', r.matches[0]?.productName === 'منتج اختبار');
  check('وحدة: لا مطابقة للمعرّف الضبابي prod-1x', !r.matches.some((m) => m.sale.id === 'sale-2'));
  check('وحدة: لا مطابقة لبيع خارج النافذة', !r.matches.some((m) => m.sale.id === 'sale-3'));
  check('وحدة: ربط البيع استنتاج حسابي (لا سببية)', r.states.saleLink === 'DERIVED_FACT');
  check('وحدة: حجم التعليقات (2 < 3) => استنتاج لا حقيقة موثّقة', r.states.commentVolume === 'DERIVED_FACT', `got ${r.states.commentVolume}`);
  check('وحدة: تسميات عربية موجودة', typeof r.statesLabelsAr.saleLink === 'string' && r.statesLabelsAr.saleLink.length > 0);
  check('وحدة: طريقة الربط معلنة', r.linkMethod === 'explicit_product_id_and_time_window');
  check('وحدة: حدود معلنة (لا سببية/ROI)', r.limitations.some((l) => l.includes('لا سببية')));

  // حالة "لا بيانات": لا تعليقات YouTube بمعرّف منتج => غير متاح (لا اختلاق رقم).
  const empty = buildYouTubeSalesCorrelation({ comments: [], sales: [], productNamesById, now: NOW });
  check('وحدة: بلا بيانات => saleLink=UNAVAILABLE', empty.states.saleLink === 'UNAVAILABLE', empty.states.saleLink);
  check('وحدة: بلا بيانات => commentVolume=UNKNOWN', empty.states.commentVolume === 'UNKNOWN', empty.states.commentVolume);
  check('وحدة: بلا بيانات => صفر مطابقات (لا اختلاق)', empty.matchedSalesCount === 0 && empty.matches.length === 0);

  // تعليق بمعرّف منتج لكن بلا بيع => عيّنة غير كافية (ليس صفراً مخترعاً ولا سببية).
  const noSale = buildYouTubeSalesCorrelation({
    comments: [{ platform: 'youtube', externalId: 'yt-x', productId: 'prod-9', createdAt: hoursAgo(1) }],
    sales: [], productNamesById, now: NOW,
  });
  check('وحدة: تعليق بلا بيع مطابق => INSUFFICIENT_DATA', noSale.states.saleLink === 'INSUFFICIENT_DATA', noSale.states.saleLink);
}

// ---------- 2) تكامل (خادم فعلي) ----------
const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const PORT = 6900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const SESSION_SECRET = 'yt-sales-corr-secret-local-only';
const secretBuffer = crypto.createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-yt-sales-'));

function user(id: string, role: string) {
  return { id, name: `${role} اختبار`, email: `${role}@example.invalid`, role, roleTitleArabic: role, avatar: '', active: true, createdAt: new Date().toISOString() };
}
function mint(uid: string): string {
  return signSession({ uid, iat: Date.now(), exp: Date.now() + 3_600_000, sid: crypto.randomUUID() }, secretBuffer);
}
function seedState(): void {
  const snapshot = {
    schemaVersion: 16, savedAt: new Date().toISOString(),
    users: [user('owner-1', 'owner'), user('staff-1', 'staff'), user('creator-1', 'content_creator')],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: {
      showroom: {}, products: [{ id: 'prod-1', name: 'منتج اختبار', stockQuantity: 5, inStock: true }],
      socialComments: [
        { id: 'c1', platform: 'youtube', externalId: 'yt-1', productId: 'prod-1', text: 'سؤال عن المنتج', createdAt: new Date().toISOString(), classification: {} },
        { id: 'c2', platform: 'youtube', externalId: 'yt-2', productId: 'prod-2', text: 'بلا بيع مطابق', createdAt: new Date().toISOString(), classification: {} },
      ],
      sales: [{ id: 'sale-1', productId: 'prod-1', customerName: 'عميل اختبار', totalAmount: 1000, status: 'confirmed', createdAt: new Date().toISOString() }],
      payments: [], suppliers: [], purchases: [], expenses: [], contracts: [], installmentSchedules: [], leads: [], conversations: [], tasks: [], posts: [], socialReplies: [], socialApprovals: [],
    },
  };
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify(snapshot), 'utf8');
}
function startApp(): ChildProcess {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir, SESSION_SECRET };
  delete env.GEMINI_API_KEY; delete env.DATABASE_URL; delete env.GHARABI_PREVIEW_TOKEN;
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
async function get(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  let json: any = null; try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

async function integrationTests(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  seedState();
  const proc = startApp();
  try {
    check('تكامل: الخادم الفعلي يقلع', await waitForHealth());
    const owner = mint('owner-1'), staff = mint('staff-1'), creator = mint('creator-1');
    check('تكامل: بلا جلسة => 401', (await get('/api/agent/youtube/sales-correlation')).status === 401);
    check('تكامل: staff => 403', (await get('/api/agent/youtube/sales-correlation', staff)).status === 403);
    check('تكامل: content_creator => 403', (await get('/api/agent/youtube/sales-correlation', creator)).status === 403);
    const r = await get('/api/agent/youtube/sales-correlation', owner);
    check('تكامل: owner => 200', r.status === 200 && r.json?.success === true, `status=${r.status}`);
    const c = r.json?.correlation;
    check('تكامل: الأرقام حقيقية من البيانات المُغذّاة', c?.youtubeCommentsWithExplicitProduct === 2 && c?.matchedSalesCount === 1, JSON.stringify({ a: c?.youtubeCommentsWithExplicitProduct, b: c?.matchedSalesCount }));
    check('تكامل: المطابقة الفعلية صحيحة', c?.matches?.[0]?.productId === 'prod-1' && c?.matches?.[0]?.sale?.id === 'sale-1');
    check('تكامل: لا كشف أسرار', !/access_token|refresh_token|client_secret|api[_-]?key/i.test(JSON.stringify(r.json)));
  } finally {
    proc.kill('SIGKILL');
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function run(): Promise<void> {
  unitTests();
  await integrationTests();
  console.log(`\n[ youtube.sales.correlation ] passed=${passed} failed=${failures.length}`);
  if (failures.length) { console.error('FAILURES:'); for (const f of failures) console.error('  - ' + f); process.exit(1); }
  console.log('ALL YOUTUBE SALES-CORRELATION CHECKS PASSED');
  process.exit(0);
}
run().catch((e) => { console.error('CRASH', e); process.exit(1); });
