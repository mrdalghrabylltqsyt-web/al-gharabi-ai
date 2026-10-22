/**
 * اختبار تكامل: ربط المنشور بالمنتج عبر مسار الإنشاء والنشر (ROOT-7).
 *
 * الجذر المُثبت: كان معرّف المنتج المختار في «مركز صناعة المحتوى» لا يُحفظ على
 * المنشور إطلاقاً (`/api/workspace/content` لا يقرأ `productId`)، ولا يُمرَّر عند
 * النشر إلى سجل النشر — فتبقى تعليقات المنشور بلا حقائق منتج، ويُصعَّد استفسار
 * السعر بدل أن يُرد من بيانات المعرض المسجّلة.
 *
 * هذا الاختبار يثبّت الإصلاح كاملاً:
 *  1) الإنشاء يحفظ `productId` **فقط** إن طابق منتجاً مسجّلاً (بلا اختراع ربط).
 *  2) النشر الموحّد ينقل `productId` إلى سجل النشر الحقيقي.
 *  3) الردّ على تعليق المنشور يُرد من بيانات المنتج (لا تصعيد) بعد النشر.
 *
 * خادم Graph وهمي محلي عبر FACEBOOK_GRAPH_API_BASE — لا مزود Meta حقيقي ولا حصة،
 * ولا يُرسل أي رد إلى عميل حقيقي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createFacebookMock, startFacebookMockServer } from './helpers/facebookMock';

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
const APP_PORT = 7800 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FB_PORT = 7900 + Math.floor(Math.random() * 100);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'root7-link-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_root7_123';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_root7';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-root7-'));

const PRODUCT_ID = 'prod_link_1';

function startApp(fbBase: string): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    FACEBOOK_GRAPH_API_BASE: fbBase,
    FACEBOOK_DIALOG_BASE: fbBase,
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: FB_APP_SECRET,
    FACEBOOK_VERIFY_TOKEN: FB_VERIFY_TOKEN,
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}
async function waitForHealth(timeoutMs = 180_000): Promise<boolean> {
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
function readState(): any {
  return JSON.parse(readFileSync(join(stateDir, '.gharabi-state.json'), 'utf8'));
}

async function main(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(),
    users: [{ id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() }],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: {
      showroom: { name: 'معرض الغرابي' },
      products: [{ id: PRODUCT_ID, name: 'غسالة أوتوماتيك 10 كيلو', cashPrice: 1000000, downPaymentPercent: 20, durationMonths: 12, inStock: true, category: 'appliances' }],
      posts: [], socialComments: [], socialReplies: [], socialApprovals: [], publishRecords: [],
    },
  }), 'utf8');
  writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify({ leads: [], sendMode: 'auto' }, null, 2), 'utf8');

  const mock = await startFacebookMockServer(FB_PORT, createFacebookMock({
    feedPosts: [{ id: 'POST_AFTER_LINK', comments: [
      { id: 'C_LINK', message: 'كم سعر الغسالة؟', from: { id: 'U20', name: 'علي' }, created_time: '2026-02-01T00:00:00+0000' },
    ] }],
  }));
  let app = startApp(mock.base);
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());

    group('1) الإنشاء يحفظ معرّف المنتج المسجّل فقط');
    const good = await (await fetch(`${BASE}/api/workspace/content`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'عرض غسالة أوتوماتيك', targetPlatforms: ['facebook'], status: 'draft', productId: PRODUCT_ID }) })).json();
    check('إنشاء المنشور ينجح', good.success === true, JSON.stringify(good).slice(0, 200));
    check('معرّف المنتج المسجّل يُحفظ على المنشور', good.post?.productId === PRODUCT_ID, `got ${good.post?.productId}`);

    const bogus = await (await fetch(`${BASE}/api/workspace/content`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'منشور بمنتج وهمي', targetPlatforms: ['facebook'], status: 'draft', productId: 'prod_does_not_exist' }) })).json();
    check('معرّف منتج غير مسجّل لا يُحفظ (لا اختراع ربط)', bogus.post?.productId === undefined, `got ${bogus.post?.productId}`);

    const noProduct = await (await fetch(`${BASE}/api/workspace/content`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'منشور عام بلا منتج', targetPlatforms: ['facebook'], status: 'draft' }) })).json();
    check('منشور بلا منتج لا يحمل معرّفاً', noProduct.post?.productId === undefined, `got ${noProduct.post?.productId}`);

    group('2) الاعتماد والموافقة ثم النشر الموحّد');
    const startRes = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const state = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
    const cbRes = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(state)}&code=TESTCODE`);
    check('ربط Facebook ينجح', cbRes.status === 200, `status=${cbRes.status}`);
    const postId = String(good.post.id);
    await fetch(`${BASE}/api/workspace/content/${postId}/submit-review`, { method: 'POST', headers: auth, body: '{}' });
    const ap = await (await fetch(`${BASE}/api/workspace/content/${postId}/approve`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الموافقة الرسمية تنجح (review ⇒ approved)', ap.success === true, JSON.stringify(ap).slice(0, 200));
    const pub = await (await fetch(`${BASE}/api/workspace/content/${postId}/publish`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('النشر الموحّد يُنفّذ', pub.success === true, JSON.stringify(pub).slice(0, 300));

    group('3) سجل النشر يحمل معرّف المنتج (الربط الفعلي)');
    const rec = (readState().workspace.publishRecords || []).find((r: any) => r.platform === 'facebook' && r.productId);
    check('سجل النشر يحمل معرّف المنتج', rec?.productId === PRODUCT_ID, JSON.stringify(rec)?.slice(0, 300));

    group('4) تعليق على المنشور المنشور يُرد من بيانات المنتج');
    // ربط منشور التعليق بسجل النشر عبر معرّف المزود (نفس ما يفعله resolveProductForPost).
    const providerPostId = String(rec?.providerPostId || '');
    check('معرّف منشور المزود حقيقي', Boolean(providerPostId), providerPostId);
    // نضبط الـfeed الوهمي ليعيد التعليق على منشور المزود الحقيقي.
    mock.state.feedPosts = [{ id: providerPostId, comments: [
      { id: 'C_LINK2', message: 'كم سعر الغسالة؟', from: { id: 'U21', name: 'علي' }, created_time: '2026-02-01T00:02:00+0000' },
    ] }];
    await (await fetch(`${BASE}/api/agent/meta/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, autoReply: true, paused: false }) })).json();
    await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' });
    const reply = (mock.state.commentReplies || []).find((r: any) => r.commentId === 'C_LINK2');
    check('أُرسل رد فعلي على تعليق المنشور المرتبط', Boolean(reply), JSON.stringify(mock.state.commentReplies));
    const rtext = String(reply?.message || '');
    check('الرد يذكر السعر المسجّل فعلاً (لا تصعيد)', rtext.includes('1,000,000'), rtext);
  } finally {
    await stop(app.proc);
    await mock.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} — passed ${passed}`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} product-post link checks`);
}
void main();
