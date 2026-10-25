/**
 * اختبار تكامل: ربط ردود مراقب Meta ببيانات المنتج الموثوقة.
 *
 * يُثبت أن استفسار السعر على منشور Facebook **مرتبط بمنتج مسجّل** يُرد فعلياً
 * من بيانات المعرض الحقيقية (السعر + القسط الشهري المشتقّ)، وأن نفس الاستفسار
 * على منشور **غير مرتبط** يبقى تصعيداً بلا اختراع أي رقم. القسط لا يُذكر إلا
 * عند توفر سعر + قاعدة تقسيط معتمدة (نسبة دفعة أولى + مدة).
 *
 * خادم Graph وهمي محلي عبر FACEBOOK_GRAPH_API_BASE — لا مزود Meta حقيقي ولا حصة،
 * ولا يُرسل أي رد إلى عميل حقيقي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createFacebookMock, startFacebookMockServer } from './helpers/facebookMock';
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
const FB_PORT = await reserveFreePort();
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'meta-watcher-facts-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_facts_123';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_facts';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-meta-facts-'));

// معرّف منشور رابط بالمنتج: يطابق publishRecord.providerPostId أدناه.
const LINKED_POST = 'POST_LINKED_PRICE';
const UNLINKED_POST = 'POST_UNLINKED';
// منشور غير مربوط صراحةً لكن نصّه يسمّي منتجاً من المخزن (أغلب منشورات الإنتاج).
const NAMED_POST = 'POST_NAMED_NOT_LINKED';

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

async function main(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  // منتج مسجّل بسعر وقاعدة تقسيط + سجل نشر يربط منشوراً بالمنتج (مصدر الحقيقة).
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(),
    users: [{ id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() }],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: {
      showroom: { name: 'معرض الغرابي' },
      products: [{ id: 'prod_1', name: 'ثلاجة كولر 18 قدم', cashPrice: 1000000, downPaymentPercent: 20, durationMonths: 12, inStock: true, category: 'appliances' }],
      posts: [],
      socialComments: [], socialReplies: [], socialApprovals: [],
      // سجل نشر حقيقي يربط المنشور بالمنتج (معرّف صريح فقط).
      publishRecords: [{ id: 'pub_1', platform: 'facebook', postId: 'x', providerPostId: LINKED_POST, productId: 'prod_1', state: 'published', simulated: false }],
    },
  }), 'utf8');
  // PR-A: هذا الاختبار يقيس مسار الإرسال التلقائي، فيضبط وضع الإرسال `auto`
  // صراحةً (الافتراضي الآن `approval` fail-closed يحجب الإرسال الآلي).
  writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify({ leads: [], sendMode: 'auto' }, null, 2), 'utf8');

  const mock = await startFacebookMockServer(FB_PORT, createFacebookMock({
    feedPosts: [
      { id: LINKED_POST, comments: [
        { id: 'C_LINKED', message: 'كم سعر الثلاجة؟', from: { id: 'U9', name: 'سالم' }, created_time: '2026-02-01T00:00:00+0000' },
      ] },
      { id: UNLINKED_POST, comments: [
        { id: 'C_UNLINKED', message: 'شنو سعر التلفزيون؟', from: { id: 'U10', name: 'حسين' }, created_time: '2026-02-01T00:01:00+0000' },
      ] },
      { id: NAMED_POST, message: 'ثلاجة كولر 18 قدم صارت أسهل ويا معرض الغرابي 🌟 تقسيط ميسر', comments: [
        { id: 'C_NAMED', message: 'شكد سعرها؟', from: { id: 'U11', name: 'علي' }, created_time: '2026-02-01T00:02:00+0000' },
      ] },
    ],
  }));
  let app = startApp(mock.base);
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());

    group('1) ربط Facebook عبر OAuth (خادم Graph وهمي)');
    const startRes = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const state = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
    const cbRes = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(state)}&code=TESTCODE`);
    check('callback ينجح بالصفحة الواحدة', cbRes.status === 200, `status=${cbRes.status}`);

    group('2) تعطيل الرد أولاً: لا إرسال');
    const pollDisabled = await (await fetch(`${BASE}/api/agent/meta/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, autoReply: false, paused: false }) })).json();
    check('ضبط المراقبة (الرد معطّل) ينجح', pollDisabled.success === true && pollDisabled.controls?.autoReply === false);

    group('3) تمكين الرد');
    const ctrl = await (await fetch(`${BASE}/api/agent/meta/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ autoReply: true }) })).json();
    check('تمكين الرد ينجح', ctrl.success === true && ctrl.controls?.autoReply === true);

    group('4) دورة المراقبة: تعليق مرتبط => رد من بيانات المنتج');
    const poll = await (await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الدورة تعمل', poll.success === true, JSON.stringify(poll));
    const rep = mock.state.commentReplies;
    const linkedReply = rep.find((r) => r.commentId === 'C_LINKED');
    check('أُرسل رد فعلي واحد على التعليق المرتبط', rep.filter((r) => r.commentId === 'C_LINKED').length === 1, `replies=${rep.length}`);
    check('الرد على التعليق المرتبط الصحيح', Boolean(linkedReply), JSON.stringify(rep));
    const text = String(linkedReply?.message || '');
    check('الرد يذكر السعر المسجّل فعلاً', text.includes('1,000,000'), text);
    // القسط = ceil((1,000,000 + 25%) ÷ 12) = ceil(1,250,000 ÷ 12) = 104,167 (لا cash/المدة).
    check('الرد يذكر القسط الشهري المشتقّ (104,167)', text.includes('104,167'), text);
    // البادئة تتنوّع الآن (ROOT-7) — نتحقق من لهجة عراقية طبيعية عامة لا من بادئة ثابتة.
    // PR-B (البند 1): الترحيب محايد جنسياً — لا «هلا بيك»/«مرحبا بيك».
    check('الرد بلغة عراقية طبيعية وترحيب محايد', /تدلل|حياك الله|نورتنا|أهلاً وسهلاً|هلا وغلا/.test(text), text);
    check('لا صيغة تفترض جنس العميل', !/هلا بيك|مرحبا بيك/.test(text), text);

    group('5) تعليق غير مرتبط => لا رد (تصعيد بلا اختراع)');
    const owner = await (await fetch(`${BASE}/api/agent/meta/watcher`, { headers: auth })).json();
    check('الاستفسار غير المرتبط صُعّد', (owner.watcher?.recent || []).some((r: any) => r.commentId === 'C_UNLINKED' && r.stage === 'ESCALATED'), JSON.stringify((owner.watcher?.recent || []).map((r: any) => ({ id: r.commentId, stage: r.stage }))));
    check('لم يُرسل رد للتعليق غير المرتبط', !rep.some((r) => r.commentId === 'C_UNLINKED'));
    check('سجل الرد المرتبط بمعرّف مزوّد حقيقي', Boolean((owner.watcher?.recent || []).find((r: any) => r.commentId === 'C_LINKED' && r.stage === 'REPLIED' && r.externalReplyId)), JSON.stringify((owner.watcher?.recent || []).find((r: any) => r.commentId === 'C_LINKED')));

    group('5ب) منشور غير مربوط لكن نصّه يسمّي المنتج ⇒ رد من المخزن (لا تصعيد)');
    const namedReply = rep.find((r) => r.commentId === 'C_NAMED');
    check('★ «شكد سعرها؟» على منشور يسمّي ثلاجة كولر 18 قدم ⇒ رد فعلي', Boolean(namedReply), JSON.stringify(rep.map((r) => r.commentId)));
    check('★ الرد يحمل سعر المخزن والقسط', String(namedReply?.message || '').includes('1,000,000') && String(namedReply?.message || '').includes('104,167'), String(namedReply?.message || ''));
    check('مجموع الردود = 2 (المرتبط + المسمّى)، والتلفزيون بلا رد', rep.length === 2, `replies=${rep.length}`);

    group('6) إعادة التشغيل: لا رد مكرر ويصمد السجل');
    await stop(app.proc);
    app = startApp(mock.base);
    check('الخادم يقلع بعد restart', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());
    await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' });
    check('لا رد مكرر بعد إعادة التشغيل', mock.state.commentReplies.length === 2, `replies=${mock.state.commentReplies.length}`);
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
  console.log(`PASSED: ${passed} meta watcher product-facts checks`);
}
void main();
