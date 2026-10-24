/**
 * إصلاح متابعات العقل التجاري (واقعة 2026-10-22) — اختبار سلوكي كامل.
 *
 * الجذر: كانت المتابعة (أ) تُحسَب من **تعليق الزبون** لا من **رد المعرض**، و(ب)
 * تُقترح على **التعليقات العامة** كرد عام تحت تعليق الزبون. النتيجة: زبونة علّقت
 * «العنوان والسعر»، فردّ المعرض عليها اليوم، ثم اقترح العقل بعد ساعات «متابعة»
 * عامة تحتها — رد عام يشبه السبام.
 *
 * هذا الاختبار يثبت القواعد الجديدة (خادم حقيقي + خادم Meta وهمي محلي، بلا مزود):
 *  1) تعليق عام + رد معرض قبل ساعات ⇒ **لا مسودة متابعة**.
 *  2) رسالة خاصة + رد معرض قبل 49 ساعة + الزبون لم يرد + داخل النافذة ⇒ مسودة واحدة.
 *  3) رسالة خاصة + الزبون ردّ بعد رد المعرض ⇒ لا متابعة.
 *  4) خارج نافذة المتابعة (80 ساعة) ⇒ لا متابعة.
 *  5) متابعة واحدة لكل استفسار (لا ثانية).
 *  6) لا رد مولَّد تتكرر فيه كلمة البادئة (في تقسيط: «تدلل، … . تدلل، …»).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash, createCipheriv } from 'node:crypto';
import { createFacebookMock, startFacebookMockServer } from './helpers/facebookMock';
import { classifyComment, generateReply } from '../social/comments';
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
const SESSION_SECRET = 'commercial-followup-rules-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_rules_1234';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_rules';
const TOKEN_KEY = randomBytes(32).toString('hex');
const FB_PAGE_TOKEN = 'FB_PAGE_TOKEN_NOT_REAL_RULES';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-commercial-followup-rules-'));

const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };

function encryptCredForTest(value: unknown): Record<string, string> {
  const key = Buffer.from(TOKEN_KEY, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { alg: 'aes-256-gcm', iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') };
}

let proc: ChildProcess | null = null;
let log = '';
let metaMock: Awaited<ReturnType<typeof startFacebookMockServer>> | null = null;

function startApp(): void {
  log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    FACEBOOK_GRAPH_API_BASE: metaMock!.base,
    FACEBOOK_DIALOG_BASE: metaMock!.base,
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: FB_APP_SECRET,
    FACEBOOK_VERIFY_TOKEN: FB_VERIFY_TOKEN,
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
}
async function waitForHealth(timeoutMs = 180_000): Promise<boolean> {
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

/**
 * يزرع 5 عملاء يغطّون القواعد كاملة + اتصال Facebook موثق + مفتاح مفعّل.
 *  - lead_pub: تعليق عام، رد المعرض قبل 3 ساعات ⇒ **لا** متابعة (تعليق عام).
 *  - lead_ok: رسالة خاصة، رد المعرض قبل 49 ساعة، الزبون ساكت ⇒ متابعة واحدة.
 *  - lead_live: رسالة خاصة، رد المعرض قبل 49 ساعة، الزبون ردّ قبل ساعتين ⇒ لا متابعة.
 *  - lead_old: رسالة خاصة، رد المعرض قبل 80 ساعة ⇒ خارج النافذة ⇒ لا متابعة.
 *  - lead_done: رسالة خاصة، متابعة واحدة أُرسلت بالفعل (followUpsSent=1) ⇒ لا ثانية.
 */
function seedState(): void {
  const now = Date.now();
  const H = 3600_000;
  const iso = (ms: number) => new Date(now - ms).toISOString();
  const mk = (over: any) => ({
    initiatedByCustomer: true, sourceEventIds: [over.lastExternalId], customerName: over.customerName || 'زبون',
    interestedProductId: null, interestedProductName: null, stage: 'ENGAGED', touches: 1,
    lastCustomerText: 'كم القسط؟', pendingProposal: null, escalationReason: null, notes: [],
    followUpState: 'SCHEDULED', followUpsSent: 0, nextFollowUpAt: iso(H), ...over,
  });
  const leads = [
    mk({ id: 'lead_pub', key: 'facebook:thread:POST_PUB', platform: 'facebook', conversationId: 'thread:POST_PUB', kind: 'comment',
      replyTarget: { commentId: 'C_PUB', videoId: 'POST_PUB' }, lastExternalId: 'C_PUB',
      lastInteractionAt: iso(50 * H), createdAt: iso(50 * H), updatedAt: iso(3 * H),
      lastCustomerInteractionAt: iso(50 * H), lastBusinessReplyAt: iso(3 * H) }),
    mk({ id: 'lead_ok', key: 'facebook:conv_ok', platform: 'facebook', conversationId: 'conv_ok', kind: 'message',
      replyTarget: { recipientId: 'PSID_OK' }, lastExternalId: 'msg_ok',
      lastInteractionAt: iso(50 * H), createdAt: iso(50 * H), updatedAt: iso(49 * H),
      lastCustomerInteractionAt: iso(50 * H), lastBusinessReplyAt: iso(49 * H) }),
    mk({ id: 'lead_live', key: 'facebook:conv_live', platform: 'facebook', conversationId: 'conv_live', kind: 'message',
      replyTarget: { recipientId: 'PSID_LIVE' }, lastExternalId: 'msg_live',
      lastInteractionAt: iso(2 * H), createdAt: iso(50 * H), updatedAt: iso(2 * H),
      lastCustomerInteractionAt: iso(2 * H), lastBusinessReplyAt: iso(49 * H) }),
    mk({ id: 'lead_old', key: 'facebook:conv_old', platform: 'facebook', conversationId: 'conv_old', kind: 'message',
      replyTarget: { recipientId: 'PSID_OLD' }, lastExternalId: 'msg_old',
      lastInteractionAt: iso(90 * H), createdAt: iso(90 * H), updatedAt: iso(80 * H),
      lastCustomerInteractionAt: iso(90 * H), lastBusinessReplyAt: iso(80 * H) }),
    mk({ id: 'lead_done', key: 'facebook:conv_done', platform: 'facebook', conversationId: 'conv_done', kind: 'message',
      replyTarget: { recipientId: 'PSID_DONE' }, lastExternalId: 'msg_done', followUpsSent: 1,
      lastInteractionAt: iso(120 * H), createdAt: iso(120 * H), updatedAt: iso(49 * H),
      lastCustomerInteractionAt: iso(120 * H), lastBusinessReplyAt: iso(49 * H) }),
  ];
  const connectedAt = iso(3 * H);
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: connectedAt,
    users: [ownerUser], revokedSessions: [], userRevocations: [], audit: [], jobs: [],
    platformConnections: [
      { platform: 'facebook', status: 'connected', accountId: 'PAGE_FU', accountName: 'معرض الغرابي', connectedAt, providerVerified: true },
    ],
    workspace: {
      showroom: { name: 'معرض الغرابي' }, products: [],
      providerTokens: { facebook: encryptCredForTest({ pageId: 'PAGE_FU', pageAccessToken: FB_PAGE_TOKEN, userAccessToken: 'FB_USER_TOKEN', connectedAt }) },
      socialComments: [], socialReplies: [], socialApprovals: [], publishRecords: [],
    },
  }));
  writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify({
    leads, killSwitch: { enabled: true, killAt: null, killBy: null, killReason: null }, sendMode: 'approval', drafts: [], ownerDecisions: [], lease: null,
  }));
}

function readCommercial(): any { return JSON.parse(readFileSync(join(stateDir, 'commercial.json'), 'utf8')); }

async function main(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }

  group('0) محرّك الرد: بادئة الترحيب لا تتكرر داخل الرد');
  // القالب الحقيقي «في تقسيط» كان ينتج «تدلل، نعم عدنا تقسيط. تدلل، راسلنا…».
  const raw = 'تدلل، نعم عدنا تقسيط. تدلل، راسلنا ونوضحلك الشروط والمستمسكات بالتفصيل 🌸';
  const fixed = generateReply({ ...classifyComment('في تقسيط'), normalized: 'في تقسيط' }, {}, {}).text;
  check('القالب المولَّد لا يكرر كلمة البادئة', !/^(تدلل|هلا وغلا|أهلاً وسهلاً|حياك الله|نورتنا)[،.].*؟?/.test(fixed) || (fixed.match(/تدلل/g) || []).length <= 1, fixed);
  // نتحقق من القاعدة على أي بادئة: لا تتكرر بعد «،»/«.».
  const openers = ['تدلل', 'هلا وغلا', 'أهلاً وسهلاً', 'حياك الله', 'نورتنا'];
  const allOk = openers.every((o) => {
    const text = generateReply({ ...classifyComment('في تقسيط'), normalized: `في تقسيط ${o}` }, {}, {}).text;
    const first = openers.find((x) => text.startsWith(x));
    if (!first) return true;
    const tail = text.slice(first.length);
    return !tail.includes(first);
  });
  check('لا تكرار للبادئة في أي قالب مولَّد', allOk);
  void raw;

  metaMock = await startFacebookMockServer(FB_PORT, createFacebookMock({
    pages: [{ id: 'PAGE_FU', name: 'معرض الغرابي', accessToken: FB_PAGE_TOKEN, tasks: ['MANAGE'] }],
    userAccessToken: 'FB_USER_TOKEN',
  }));
  seedState();
  startApp();
  const auth: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    check('الخادم يقلع', await waitForHealth(), log.slice(0, 600));
    Object.assign(auth, await login());

    group('1) ربط Facebook الموثق');
    const startRes = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const st = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
    const cb = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(st)}&code=TESTCODE`);
    check('الربط ينجح', cb.status === 200, `status=${cb.status}`);

    group('2) دورة العقل التجاري (وضع الموافقة)');
    const callsBefore = (metaMock as any).state.calls;
    const run = await (await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الدورة نجحت', run.success === true, JSON.stringify(run).slice(0, 200));
    check('لا إرسال خارجي (وضع الموافقة)', (run.result?.followUpsSent || 0) === 0, JSON.stringify(run.result));
    const inbox = await (await fetch(`${BASE}/api/commercial/inbox`, { headers: auth })).json();
    const followDrafts = (inbox.drafts || []).filter((d: any) => d.purpose === 'follow_up');
    const byLead = (id: string) => followDrafts.find((d: any) => d.leadId === id);

    group('3) القاعدة 1: لا متابعة على التعليق العام');
    check('لا مسودة متابعة لصاحب التعليق العام', !byLead('lead_pub'), JSON.stringify(followDrafts.map((d: any) => d.leadId)));

    group('4) القاعدة 2: رسالة خاصة + رد معرض قبل 49س + الزبون ساكت ⇒ مسودة واحدة');
    const ok = byLead('lead_ok');
    check('مسودة متابعة واحدة للرسالة المؤهّلة', Boolean(ok) && ok.kind === 'message', JSON.stringify(ok));
    check('المتابعة رسالة خاصة (لا تعليق)', ok?.kind === 'message', JSON.stringify(ok?.kind));

    group('5) القاعدة 3: المحادثة حيّة ⇒ لا متابعة');
    check('لا مسودة لمن ردّ بعد رد المعرض', !byLead('lead_live'), JSON.stringify(followDrafts.map((d: any) => d.leadId)));

    group('6) القاعدة 4: خارج نافذة المتابعة ⇒ لا متابعة');
    check('لا مسودة خارج النافذة (80س)', !byLead('lead_old'), JSON.stringify(followDrafts.map((d: any) => d.leadId)));

    group('7) القاعدة 5: متابعة واحدة لكل استفسار');
    check('لا مسودة ثانية لمن أُرسلت له متابعة', !byLead('lead_done'), JSON.stringify(followDrafts.map((d: any) => d.leadId)));
    check('إجمالي مسودات المتابعة = 1', followDrafts.length === 1, String(followDrafts.length));
    void callsBefore;

    group('8) الثبات: إعادة تشغيل الدورة لا تُنشئ متابعة ثانية');
    await (await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: auth, body: '{}' })).json();
    const inbox2 = await (await fetch(`${BASE}/api/commercial/inbox`, { headers: auth })).json();
    const follow2 = (inbox2.drafts || []).filter((d: any) => d.purpose === 'follow_up');
    check('لا متابعة مكرّرة بعد دورة ثانية', follow2.length === 1, String(follow2.length));
    check('المسودات القائمة لم تُحذف', (readCommercial().drafts || []).length >= 1, JSON.stringify(readCommercial().drafts?.length));
  } finally {
    if (proc) { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1200)); if (!proc.killed) proc.kill('SIGKILL'); }
    if (metaMock) await metaMock.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} — passed ${passed}`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} commercial follow-up rule checks`);
}
void main();
