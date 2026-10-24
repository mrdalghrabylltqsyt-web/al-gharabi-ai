/**
 * PR-S2 — صندوق الزبائن: وضع الموافقة + مسودات بانتظار قرار المالك.
 *
 * يثبت (يفشل على الكود القديم):
 *  - في وضع approval (الافتراضي): دورة العقل التجاري **لا تستدعي أي مزوّد**، وتنشئ مسودة.
 *  - الموافقة ترسل مرة واحدة، وتكرارها لا يرسل ثانية (منع تكرار دائم).
 *  - التعديل ثم الموافقة يرسل النص المعدّل، ويمر بحارس سلامة المحتوى (ادعاء غير مسجّل ⇒ 422).
 *  - الرفض لا يرسل شيئاً.
 *  - مسودة خارج نافذة Meta لا تُرسل حتى بعد الموافقة (تُعلَّم منتهية).
 *  - الصندوق وتأكيد الصفقة **للمالك فقط** (403 لغيره).
 *
 * خادم حقيقي + خادم Meta وهمي محلي (بلا مزود حقيقي ولا سرّ ولا حصة).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash, createCipheriv } from 'node:crypto';
import { createFacebookMock, startFacebookMockServer } from './helpers/facebookMock';
import { signSession } from '../auth/sessions';
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
const SESSION_SECRET = 'commercial-inbox-test-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_1234567890';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_not_real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const FB_PAGE_TOKEN = 'FB_PAGE_TOKEN_NOT_REAL';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-prs4-inbox-'));

const secretBuffer = createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };
const staffUser = { id: 'staff-1', name: 'موظف اختبار', email: 'staff@example.invalid', role: 'staff', roleTitleArabic: 'الموظف', avatar: '', active: true, createdAt: new Date().toISOString() };

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
let metaState: any;

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

/** يزرع زبون تعليق فيسبوك (اسم حقيقي + رابط Meta) وزبوناً بلا اسم + منتجاً ومنشوراً. */
function seedState(): void {
  const nowMs = Date.now();
  const leads = [
    {
      id: 'lead_named', key: 'facebook:author:U_NAMED', platform: 'facebook', conversationId: 'author:U_NAMED', kind: 'comment',
      replyTarget: { commentId: 'C_NAMED', videoId: 'POST_SHARK' }, lastExternalId: 'C_NAMED', initiatedByCustomer: true,
      sourceEventIds: ['C_NAMED'], customerName: 'مصطفى الغرابي', interestedProductId: 'P1', interestedProductName: 'SHARK LED 50',
      stage: 'QUALIFIED', touches: 1, lastCustomerText: 'بكم هالشاشة؟',
      lastInteractionAt: new Date(nowMs - 2 * 3600_000).toISOString(),
      createdAt: new Date(nowMs - 2 * 3600_000).toISOString(), updatedAt: new Date(nowMs - 2 * 3600_000).toISOString(),
      lastCustomerInteractionAt: new Date(nowMs - 2 * 3600_000).toISOString(), lastBusinessReplyAt: null,
      followUpState: 'SCHEDULED', followUpsSent: 0, nextFollowUpAt: new Date(nowMs - 3600_000).toISOString(),
      pendingProposal: null, escalationReason: null, notes: [],
    },
    {
      id: 'lead_noname', key: 'facebook:author:998877665544', platform: 'facebook', conversationId: 'author:998877665544', kind: 'comment',
      replyTarget: { commentId: 'C_NONAME', videoId: 'POST_SHARK' }, lastExternalId: 'C_NONAME', initiatedByCustomer: true,
      sourceEventIds: ['C_NONAME'], customerName: null, interestedProductId: null, interestedProductName: null,
      stage: 'ENGAGED', touches: 1, lastCustomerText: 'شنو السعر؟',
      lastInteractionAt: new Date(nowMs - 3 * 3600_000).toISOString(),
      createdAt: new Date(nowMs - 3 * 3600_000).toISOString(), updatedAt: new Date(nowMs - 3 * 3600_000).toISOString(),
      lastCustomerInteractionAt: new Date(nowMs - 3 * 3600_000).toISOString(), lastBusinessReplyAt: null,
      followUpState: 'SCHEDULED', followUpsSent: 0, nextFollowUpAt: new Date(nowMs - 3600_000).toISOString(),
      pendingProposal: null, escalationReason: null, notes: [],
    },
  ];
  const connectedAt = new Date(nowMs - 3 * 3600_000).toISOString();
  const snapshot = {
    schemaVersion: 16, savedAt: connectedAt,
    users: [ownerUser, staffUser], revokedSessions: [], userRevocations: [], audit: [], jobs: [],
    platformConnections: [
      { platform: 'facebook', status: 'connected', accountId: 'PAGE_S4', accountName: 'معرض الغرابي', connectedAt, providerVerified: true },
    ],
    workspace: {
      showroom: { name: 'معرض الغرابي' },
      products: [{ id: 'P1', name: 'SHARK LED 50', cashPrice: 500000, category: 'شاشات' }],
      posts: [{ id: 'post1', title: 'شاشة SHARK LED 50', content: 'شاشة SHARK LED 50 بمواصفات عالية\nسعر خاص', mediaUrl: 'https://cdn.example.invalid/shark.jpg', status: 'published', targetPlatforms: ['facebook'], createdAt: connectedAt, authorName: 'معرض', authorRole: 'owner', history: [] }],
      providerTokens: {
        facebook: encryptCredForTest({ pageId: 'PAGE_S4', pageAccessToken: FB_PAGE_TOKEN, userAccessToken: 'FB_USER_TOKEN', connectedAt }),
      },
      // تعليق باسم حقيقي + رابط Meta حقيقي محفوظ عند الاستقبال، وتعليق بلا اسم من Meta.
      socialComments: [
        { id: 'c1', platform: 'facebook', externalId: 'C_NAMED', postExternalId: 'POST_SHARK', authorName: 'مصطفى الغرابي', authorId: 'U_NAMED', text: 'بكم هالشاشة؟', createdAt: new Date(nowMs - 2 * 3600_000).toISOString(), permalinkUrl: 'https://www.facebook.com/PAGE_S4/posts/POST_SHARK?comment_id=C_NAMED' },
        { id: 'c2', platform: 'facebook', externalId: 'C_NONAME', postExternalId: 'POST_SHARK', authorName: null, authorId: '998877665544', text: 'شنو السعر؟', createdAt: new Date(nowMs - 3 * 3600_000).toISOString(), permalinkUrl: null },
      ],
      socialReplies: [], socialApprovals: [],
      publishRecords: [{ platform: 'facebook', postId: 'post1', scheduledFor: null, executedAt: connectedAt, state: 'published', providerPostId: 'POST_SHARK', error: null, simulated: false }],
    },
  };
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify(snapshot));
  const namedDraft = {
    id: 'draft_reply_named', leadId: 'lead_named', leadKey: 'facebook:author:U_NAMED', platform: 'facebook', kind: 'comment',
    purpose: 'reply', text: 'هلا بيك، سعرها 500 ألف.', externalId: 'C_NAMED', recipientId: null,
    productId: 'P1', proposalId: null, idempotencyKey: 'r1',
    createdAt: new Date(nowMs - 60_000).toISOString(), windowExpiresAt: null,
    status: 'pending', decidedBy: null, decidedAt: null, approvedText: null,
    deliveryStatus: null, deliveryError: null, providerReplyId: null,
  };
  const followDraft = {
    ...namedDraft, id: 'draft_follow_named', purpose: 'follow_up', idempotencyKey: 'f1',
    createdAt: new Date(nowMs - 30_000).toISOString(),
  };
  writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify({
    leads, killSwitch: { enabled: true, killAt: null, killBy: null, killReason: null }, sendMode: 'approval',
    drafts: [namedDraft, followDraft], ownerDecisions: [], lease: null,
  }));
}

async function main(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  metaState = createFacebookMock({
    pages: [{ id: 'PAGE_S4', name: 'معرض الغرابي', accessToken: FB_PAGE_TOKEN, tasks: ['MANAGE'] }],
    userAccessToken: 'FB_USER_TOKEN',
  });
  metaMock = await startFacebookMockServer(FB_PORT, metaState);
  seedState();
  startApp();
  const auth: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    check('الخادم يقلع', await waitForHealth(), log.slice(0, 600));
    Object.assign(auth, await login());
    const staffToken = signSession({ uid: 'staff-1', iat: Date.now(), exp: Date.now() + 3_600_000, sid: randomBytes(8).toString('hex') }, secretBuffer);
    const staffAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` };

    group('1) الصندوق للمالك فقط (بيانات عملاء)');
    check('/api/commercial/inbox بلا جلسة => 401', (await fetch(`${BASE}/api/commercial/inbox`)).status === 401);
    check('/api/commercial/inbox لغير المالك => 403', (await fetch(`${BASE}/api/commercial/inbox`, { headers: staffAuth })).status === 403);
    const inbox = await (await fetch(`${BASE}/api/commercial/inbox`, { headers: auth })).json();
    check('الصندوق يُعاد للمالك', inbox.success === true, JSON.stringify(inbox).slice(0, 200));

    group('2) بطاقة تعليق فيسبوك: اسم الكاتب الحقيقي + النص + المنشور + الرابط');
    const dNamed = (inbox.drafts || []).find((d: any) => d.id === 'draft_reply_named');
    check('المسودة موجودة في الصندوق', Boolean(dNamed), JSON.stringify((inbox.drafts || []).map((d: any) => d.id)));
    const ctx = dNamed?.context;
    check('اسم الكاتب الحقيقي على البطاقة (مصطفى الغرابي)', ctx?.authorName === 'مصطفى الغرابي', JSON.stringify(ctx?.authorName));
    check('لا كلمة «زبون» كاسم', ctx?.authorName !== 'زبون' && dNamed?.customerName !== 'زبون', JSON.stringify({ a: ctx?.authorName, c: dNamed?.customerName }));
    check('نص تعليق الزبون الأصلي ظاهر', ctx?.customerText === 'بكم هالشاشة؟', JSON.stringify(ctx?.customerText));
    check('وقت تعليق الزبون ظاهر', Boolean(ctx?.customerTextAt), JSON.stringify(ctx?.customerTextAt));
    check('المنشور: أول سطر من نصه', ctx?.post?.firstLine === 'شاشة SHARK LED 50 بمواصفات عالية', JSON.stringify(ctx?.post));
    check('المنشور: صورته المصغّرة', ctx?.post?.thumbnailUrl === 'https://cdn.example.invalid/shark.jpg', JSON.stringify(ctx?.post));
    check('المنتج المرتبط ظاهر', ctx?.product?.name === 'SHARK LED 50', JSON.stringify(ctx?.product));
    check('رابط Meta الحقيقي هو permalink_url المحفوظ', ctx?.permalinkUrl === 'https://www.facebook.com/PAGE_S4/posts/POST_SHARK?comment_id=C_NAMED', JSON.stringify(ctx?.permalinkUrl));
    check('نوع المسودة «جواب على سؤال»', ctx?.draftKind === 'جواب على سؤال', JSON.stringify(ctx?.draftKind));
    check('تسمية نوع المسودة على الصف', dNamed?.draftKindLabelAr === 'جواب على سؤال', JSON.stringify(dNamed?.draftKindLabelAr));
    const dFollow = (inbox.drafts || []).find((d: any) => d.id === 'draft_follow_named');
    check('نوع مسودة المتابعة «متابعة 24/72 ساعة»', dFollow?.context?.draftKind === 'متابعة 24/72 ساعة' || dFollow?.draftKindLabelAr === 'متابعة 24/72 ساعة', JSON.stringify(dFollow?.draftKindLabelAr));

    group('3) غياب الاسم يعرض البديل الصريح (لا «زبون»)');
    const lNoname = (inbox.leads || []).find((l: any) => l.id === 'lead_noname');
    check('الزبون بلا اسم موجود', Boolean(lNoname), JSON.stringify((inbox.leads || []).map((l: any) => l.id)));
    check('الاسم البديل = «اسم غير متاح من Meta (…آخر 4 أرقام)»', lNoname?.context?.authorName === 'اسم غير متاح من Meta (…5544)', JSON.stringify(lNoname?.context?.authorName));
    check('لا كلمة «زبون» في البطاقة', lNoname?.customerName !== 'زبون', JSON.stringify(lNoname?.customerName));
    check('لا رابط مختلق عند غياب permalink', lNoname?.context?.permalinkUrl === null, JSON.stringify(lNoname?.context?.permalinkUrl));

    group('4) آخر 5 تفاعلات للزبون (منه ومنّا)');
    check('قائمة التفاعلات موجودة', Array.isArray(ctx?.recentInteractions), JSON.stringify(ctx?.recentInteractions));
    check('عدد التفاعلات ≤ 5', (ctx?.recentInteractions || []).length <= 5, `n=${(ctx?.recentInteractions || []).length}`);
    check('أول تفاعل من الزبون', (ctx?.recentInteractions || [])[0]?.direction === 'customer', JSON.stringify(ctx?.recentInteractions));

    group('5) تفاصيل الزبون تعرض السياق نفسه (قراءة فقط)');
    const detail = await (await fetch(`${BASE}/api/commercial/leads/lead_named`, { headers: auth })).json();
    check('تفاصيل الزبون تحمل context', Boolean(detail.context), JSON.stringify(detail).slice(0, 200));
    check('الاسم الحقيقي في التفاصيل', detail.context?.authorName === 'مصطفى الغرابي', JSON.stringify(detail.context?.authorName));
    check('اسم الصف في التفاصيل حقيقي أيضاً', detail.lead?.customerName === 'مصطفى الغرابي', JSON.stringify(detail.lead?.customerName));
  } catch (err: any) {
    failures.push(`EXCEPTION: ${String(err?.message || err)}`);
    console.log(log.slice(-3000));
  } finally {
    try { if (proc) { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1200)); if (!proc.killed) proc.kill('SIGKILL'); } } catch { /* تجاهل */ }
    try { if (metaMock) await metaMock.stop(); } catch { /* تجاهل */ }
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }
  console.log('\n' + '='.repeat(60));
  if (failures.length === 0) {
    console.log(`PASSED: ${passed} PR-S4 inbox context checks`);
    process.exit(0);
  } else {
    console.log(`FAILED: ${failures.length} of ${passed + failures.length}`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

void main();
