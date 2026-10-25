/**
 * اختبار تكامل حلقة الحوار/التوضيح لردود Instagram (Instagram API with Facebook Login).
 *
 * يُثبت **دورة كاملة حقيقية** عبر الخادم الفعلي + خادم Meta Graph وهمي محلي
 * (بلا مزود حقيقي وبلا حصة)، بنفس بنية اختبار Facebook:
 *   1) تعليق غامض على وسائط (بلا منتج مرتبط) ⇒ **سؤال توضيح فعلي** بمعرّف رد حقيقي.
 *   2) تعليق استفسار سعر على وسائط **مرتبطة بمنتج مسجّل** ⇒ **جواب نهائي مؤرّض** من
 *      بيانات الكتالوج (السعر + القسط المشتقّان)، بمعرّف رد حقيقي — بلا اختراع.
 *
 * المسار: OAuth حقيقي (اكتشاف الحساب المهني + اشتراك الصفحة) → تمكين الرد → دورة
 * مراقبة تسحب التعليقات عبر `GET /{ig-id}/media?fields=comments` وترد فعلياً.
 *
 * لا يلمس أي مزود Meta حقيقي ولا يستهلك حصة، ولا يستخدم أي سرّ واقعي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createInstagramMock, startInstagramMockServer } from './helpers/instagramMock';
import { reserveFreePort } from './helpers/freePort';

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
const APP_PORT = await reserveFreePort();
const BASE = `http://127.0.0.1:${APP_PORT}`;
const IG_PORT = await reserveFreePort();
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'meta-dialogue-ig-test-secret-not-real';
const IG_APP_SECRET = 'ig_test_app_secret_not_real_dialogue_123';
const IG_VERIFY_TOKEN = 'ig_test_verify_token_dialogue';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-meta-dialogue-ig-'));
const TOKEN_KEY = randomBytes(32).toString('hex');

// وسائط: واحدة مرتبطة بمنتج مسجّل (مصدر الحقيقة للتأريض) وأخرى غامضة بلا منتج.
const GROUND_MEDIA = 'IG_MEDIA_GROUND';
const AMBIG_MEDIA = 'IG_MEDIA_AMBIG';
const PRODUCT = { id: 'prod_a15', name: 'Samsung Galaxy A15', cashPrice: 250000, downPaymentPercent: 10, durationMonths: 10, inStock: true, category: 'mobiles' };

function startApp(igBase: string): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    FACEBOOK_GRAPH_API_BASE: igBase,
    FACEBOOK_DIALOG_BASE: igBase,
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: IG_APP_SECRET,
    FACEBOOK_VERIFY_TOKEN: IG_VERIFY_TOKEN,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    CONTAINER_POLL_INTERVAL_MS: '0',
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

async function main(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  // منتج مسجّل + سجل نشر يربط وسائط Instagram بالمنتج (مصدر الحقيقة للتأريض).
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(),
    users: [{ id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() }],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: {
      showroom: { name: 'معرض الغرابي' },
      products: [PRODUCT], posts: [], socialComments: [], socialReplies: [], socialApprovals: [],
      publishRecords: [{ id: 'pub_ig', platform: 'instagram', postId: 'x', providerPostId: GROUND_MEDIA, productId: PRODUCT.id, state: 'published', simulated: false }],
    },
  }), 'utf8');
  // PR-A: وضع الإرسال `auto` صراحةً (الافتراضي approval يحجب الإرسال الآلي).
  writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify({ leads: [], sendMode: 'auto' }, null, 2), 'utf8');

  const mock = await startInstagramMockServer(IG_PORT, createInstagramMock({
    feedMedia: [
      { id: GROUND_MEDIA, comments: [{ id: 'IGC_GROUND', text: 'كم سعر Samsung Galaxy A15؟', from: { id: 'IG_USER_G', name: 'عميل جاد' }, created_time: '2026-03-01T09:00:00+0000' }] },
      { id: AMBIG_MEDIA, comments: [{ id: 'IGC_AMBIG', text: 'شنو عندكم جديد؟', from: { id: 'IG_USER_A', name: 'عميل غامض' }, created_time: '2026-03-01T09:01:00+0000' }] },
    ],
  }));
  const app = startApp(mock.base);
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());

    group('1) ربط Instagram عبر OAuth (خادم Graph وهمي) — اكتشاف الحساب المهني + اشتراك الصفحة');
    const startRes = await (await fetch(`${BASE}/api/platforms/instagram/oauth/start`, { headers: auth })).json();
    const st = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
    const cb = await fetch(`${BASE}/api/platforms/instagram/oauth/callback?state=${encodeURIComponent(st)}&code=TESTCODE`);
    check('callback ينجح باكتشاف الحساب المهني', cb.status === 200, `status=${cb.status}`);
    check('اشتراك الصفحة استُخدم بحقلي comments/messages', mock.state.lastSubscribe?.fields.includes('comments') === true && mock.state.lastSubscribe?.fields.includes('messages') === true, JSON.stringify(mock.state.lastSubscribe));

    group('2) أمان افتراضي: الرد الآلي معطّل افتراضياً');
    const w0 = await (await fetch(`${BASE}/api/agent/meta/watcher`, { headers: auth })).json();
    check('autoReply معطّل افتراضياً', w0.watcher?.controls?.autoReply === false, JSON.stringify(w0.watcher?.controls));

    group('3) تمكين الرد ثم دورة المراقبة: تعليق غامض ⇒ سؤال توضيح فعلي بمعرّف رد حقيقي');
    await fetch(`${BASE}/api/agent/meta/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ autoReply: true }) });
    const poll1 = await (await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الدورة تعمل', poll1.success === true, JSON.stringify(poll1).slice(0, 300));
    const ambReply = mock.state.commentReplies.find((r) => r.commentId === 'IGC_AMBIG');
    check('أُرسل سؤال توضيح فعلي (بمعرّف رد حقيقي من Meta)', Boolean(ambReply) && /^IG_REPLY_/.test(String(ambReply?.id)), JSON.stringify(mock.state.commentReplies.map((r) => [r.commentId, r.id])));
    check('نص سؤال التوضيح عراقي غير فارغ', typeof ambReply?.message === 'string' && ambReply!.message.trim().length > 0, ambReply?.message);
    check('سؤال التوضيح بلا رقم مُختلق (لا سعر/قسط)', !/[0-9]/.test(String(ambReply?.message || '')), ambReply?.message);
    const w1 = await (await fetch(`${BASE}/api/agent/meta/watcher`, { headers: auth })).json();
    const ambEntry = (w1.watcher?.recent || []).find((r: any) => r.commentId === 'IGC_AMBIG');
    check('سجل المعالجة يوسم التعليق الغامض REPLIED بمعرّف رد', ambEntry?.stage === 'REPLIED' && /^IG_REPLY_/.test(String(ambEntry?.externalReplyId || '')), JSON.stringify(ambEntry));
    check('سبب السجل يعلن أنه سؤال توضيح', /توضيح/.test(String(ambEntry?.reason || '')), ambEntry?.reason);

    group('4) استفسار سعر على وسائط مرتبطة بمنتج ⇒ جواب نهائي مؤرّض بمعرّف رد حقيقي');
    const grReply = mock.state.commentReplies.find((r) => r.commentId === 'IGC_GROUND');
    check('أُرسل جواب نهائي فعلي (بمعرّف رد حقيقي)', Boolean(grReply) && /^IG_REPLY_/.test(String(grReply?.id)), JSON.stringify(mock.state.commentReplies.map((r) => [r.commentId, r.id])));
    check('الجواب يذكر السعر المسجّل (250,000)', /250,000/.test(String(grReply?.message || '')), grReply?.message);
    // القسط = ceil((سعر الكاش + 25%) ÷ المدة) = ceil(312,500 ÷ 10) = 31,250 (لا cash/المدة).
    check('الجواب يذكر القسط المشتقّ (31,250)', /31,250/.test(String(grReply?.message || '')), grReply?.message);
    check('الجواب ليس سؤال توضيح (المنتج محدّد)', !/خبرني أي موديل|وضّحلي/.test(String(grReply?.message || '')), grReply?.message);
    const w2 = await (await fetch(`${BASE}/api/agent/meta/watcher`, { headers: auth })).json();
    const grEntry = (w2.watcher?.recent || []).find((r: any) => r.commentId === 'IGC_GROUND');
    check('سجل المعالجة يوسم تعليق السعر REPLIED بمعرّف رد', grEntry?.stage === 'REPLIED' && /^IG_REPLY_/.test(String(grEntry?.externalReplyId || '')), JSON.stringify(grEntry));

    group('5) منع التكرار: إعادة الدورة لا ترسل ردوداً مكررة');
    const before = mock.state.commentReplies.length;
    await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' });
    check('لا ردود مكررة عند إعادة الدورة', mock.state.commentReplies.length === before, `before=${before} after=${mock.state.commentReplies.length}`);
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
  console.log(`PASSED: ${passed} meta dialogue (Instagram) checks`);
}

void main();
