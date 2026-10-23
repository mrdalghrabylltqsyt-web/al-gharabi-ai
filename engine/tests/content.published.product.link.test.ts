/**
 * إصلاح (PR #71، البند 7) — ربط منشور **منشور فعلاً** بمنتج من صفحة الموافقة.
 *
 * الجذور المُثبتة:
 *  1) `resolveProductForPost` كان يقرأ `publishRecords` و`contentQueue` فقط، لا
 *     `post.productId` — فرابط المنتج اللاحق لا يصل إلى الردود.
 *  2) `PATCH /api/workspace/content/:id` كان يغيّر حالة المنشور المنشور إلى
 *     `edited` عند أي تعديل، فيُعيده إلى مسار الموافقة بخطر نشر مزدوج.
 *
 * يثبت (خادم حقيقي + خادم Graph وهمي محلي، بلا مزود):
 *  - ربط منتج لمنشور منشور ⇒ الحالة تبقى `published` ولا نشر ثانٍ.
 *  - الربط يُحدَّث على المنشور وعلى سجلات النشر المرتبطة.
 *  - تعليق «كم السعر» على المنشور ⇒ الرد يذكر السعر الحقيقي للمنتج (لا تصعيد).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
const APP_PORT = 7420 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FB_PORT = 7480 + Math.floor(Math.random() * 40);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'content-published-product-link-secret';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_link_1234';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_link';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-published-product-link-'));

const PRODUCT_ID = 'prod_pub_1';

function startApp(fbBase: string): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    FACEBOOK_GRAPH_API_BASE: fbBase, FACEBOOK_DIALOG_BASE: fbBase,
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: FB_APP_SECRET,
    FACEBOOK_VERIFY_TOKEN: FB_VERIFY_TOKEN,
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
  const res = await fetch(`${BASE}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}
function readState(): any { return JSON.parse(readFileSync(join(stateDir, '.gharabi-state.json'), 'utf8')); }

async function main(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(),
    users: [{ id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() }],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: {
      showroom: { name: 'معرض الغرابي' },
      products: [{ id: PRODUCT_ID, name: 'ثلاجة سامسونج 18 قدم', cashPrice: 1250000, downPaymentPercent: 20, durationMonths: 10, inStock: true, category: 'appliances' }],
      posts: [], socialComments: [], socialReplies: [], socialApprovals: [], publishRecords: [],
    },
  }), 'utf8');
  // وضع auto هنا فقط لتمرير الرد الفعلي عبر المراقب (المسار الحقيقي الذي يستخدمه
  // `executeMetaCommentReply`). الافتراضي في الإنتاج يبقى approval.
  writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify({ leads: [], sendMode: 'auto' }, null, 2), 'utf8');

  const mock = await startFacebookMockServer(FB_PORT, createFacebookMock({ feedPosts: [] }));
  const app = startApp(mock.base);
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());

    group('1) ربط Facebook ثم نشر منشور (بلا منتج)');
    const startRes = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const st = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
    check('ربط Facebook ينجح', (await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(st)}&code=TESTCODE`)).status === 200);
    const created = await (await fetch(`${BASE}/api/workspace/content`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'ثلاجة سامسونج متوفرة الآن', targetPlatforms: ['facebook'], status: 'draft' }) })).json();
    const postId = String(created.post.id);
    await fetch(`${BASE}/api/workspace/content/${postId}/submit-review`, { method: 'POST', headers: auth, body: '{}' });
    await fetch(`${BASE}/api/workspace/content/${postId}/approve`, { method: 'POST', headers: auth, body: '{}' });
    const pub = await (await fetch(`${BASE}/api/workspace/content/${postId}/publish`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('النشر الموحّد نجح', pub.success === true, JSON.stringify(pub).slice(0, 300));
    const pubPost = readState().workspace.posts.find((p: any) => p.id === postId);
    check('حالة المنشور published', pubPost?.status === 'published', String(pubPost?.status));
    const rec0 = (readState().workspace.publishRecords || []).find((r: any) => String(r.postId) === postId);
    check('سجل النشر بلا منتج ابتداءً', !rec0?.productId, JSON.stringify(rec0?.productId));

    group('2) ربط المنتج على منشور منشور ⇒ الحالة تبقى published');
    const patch = await (await fetch(`${BASE}/api/workspace/content/${postId}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ productId: PRODUCT_ID }) })).json();
    check('الربط نجح', patch.success === true, JSON.stringify(patch).slice(0, 200));
    check('الحالة بقيت published (لم تُصبح edited)', patch.post?.status === 'published', String(patch.post?.status));
    check('معرّف المنتج محفوظ على المنشور', patch.post?.productId === PRODUCT_ID, String(patch.post?.productId));
    const rec1 = (readState().workspace.publishRecords || []).find((r: any) => String(r.postId) === postId);
    check('سجل النشر المرتبط حُدِّث بالمنتج', rec1?.productId === PRODUCT_ID, JSON.stringify(rec1?.productId));

    group('3) محاولة تغيير حالة منشور منشور تُرفض (منع نشر مزدوج)');
    const patchStatus = await fetch(`${BASE}/api/workspace/content/${postId}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'edited' }) });
    check('تغيير حالة منشور منشور => 422 PUBLISHED_IMMUTABLE', patchStatus.status === 422, `status=${patchStatus.status}`);
    check('الحالة بقيت published', readState().workspace.posts.find((p: any) => p.id === postId)?.status === 'published');

    group('4) تعليق «كم السعر» على المنشور ⇒ الرد يذكر السعر الحقيقي');
    const providerPostId = String(rec1?.providerPostId || '');
    check('معرّف منشور المزود حقيقي', Boolean(providerPostId), providerPostId);
    mock.state.feedPosts = [{ id: providerPostId, comments: [
      { id: 'C_PUBLINK', message: 'كم سعر الثلاجة؟', from: { id: 'U30', name: 'حسين' }, created_time: '2026-02-01T00:00:00+0000' },
    ] }];
    await (await fetch(`${BASE}/api/agent/meta/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, autoReply: true, paused: false }) })).json();
    await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' });
    const reply = (mock.state.commentReplies || []).find((r: any) => r.commentId === 'C_PUBLINK');
    check('أُرسل رد فعلي', Boolean(reply), JSON.stringify(mock.state.commentReplies));
    check('الرد يذكر السعر المسجّل (لا تصعيد)', String(reply?.message || '').includes('1,250,000'), String(reply?.message || ''));
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
  console.log(`PASSED: ${passed} published-post product-link checks`);
}
void main();
