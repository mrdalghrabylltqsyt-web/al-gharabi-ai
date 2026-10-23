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
const APP_PORT = 7600 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FB_PORT = 7660 + Math.floor(Math.random() * 40);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'commercial-inbox-test-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_1234567890';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_not_real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const FB_PAGE_TOKEN = 'FB_PAGE_TOKEN_NOT_REAL';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-commercial-inbox-'));

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

/**
 * يزرع عميلين لاختبار **الرد الفوري في وضع الموافقة** (لا المتابعة — تلك مُغطّاة في
 * `commercial.followup.rules.test.ts`):
 *  - lead_in: رسالة خاصة حديثة (2 ساعة) بلا رد للمعرض ⇒ مسودة **رد فوري** معلّقة.
 *  - lead_out: رسالة خاصة قديمة (72 ساعة) بلا رد للمعرض ⇒ مسودة الرد الفوري منتهية
 *    (خارج نافذة Meta للرد الحرّ)، ولا متابعة (خارج نافذة المتابعة).
 * + اتصال Facebook موثق + مفتاح مفعّل.
 */
function seedState(): void {
  const nowMs = Date.now();
  const leads = [
    {
      id: 'lead_in', key: 'facebook:conv_in', platform: 'facebook', conversationId: 'conv_in', kind: 'message',
      replyTarget: { recipientId: 'PSID_IN' }, lastExternalId: 'msg_in', initiatedByCustomer: true,
      sourceEventIds: ['msg_in'], customerName: 'زبون داخلي', interestedProductId: null, interestedProductName: null,
      stage: 'ENGAGED', touches: 1, lastCustomerText: 'كم القسط؟',
      lastInteractionAt: new Date(nowMs - 2 * 3600_000).toISOString(),
      createdAt: new Date(nowMs - 2 * 3600_000).toISOString(), updatedAt: new Date(nowMs - 2 * 3600_000).toISOString(),
      lastCustomerInteractionAt: new Date(nowMs - 2 * 3600_000).toISOString(), lastBusinessReplyAt: null,
      followUpState: 'SCHEDULED', followUpsSent: 0, nextFollowUpAt: new Date(nowMs - 3600_000).toISOString(),
      pendingProposal: null, escalationReason: null, notes: [],
    },
    {
      id: 'lead_out', key: 'facebook:conv_out', platform: 'facebook', conversationId: 'conv_out', kind: 'message',
      replyTarget: { recipientId: 'PSID_OUT' }, lastExternalId: 'msg_out', initiatedByCustomer: true,
      sourceEventIds: ['msg_out'], customerName: 'زبون خارجي', interestedProductId: null, interestedProductName: null,
      stage: 'ENGAGED', touches: 1, lastCustomerText: 'كم القسط؟',
      lastInteractionAt: new Date(nowMs - 72 * 3600_000).toISOString(),
      createdAt: new Date(nowMs - 72 * 3600_000).toISOString(), updatedAt: new Date(nowMs - 72 * 3600_000).toISOString(),
      lastCustomerInteractionAt: new Date(nowMs - 72 * 3600_000).toISOString(), lastBusinessReplyAt: null,
      followUpState: 'SCHEDULED', followUpsSent: 0, nextFollowUpAt: new Date(nowMs - 3600_000).toISOString(),
      pendingProposal: null, escalationReason: null, notes: [],
    },
  ];
  const connectedAt = new Date(nowMs - 3 * 3600_000).toISOString();
  const snapshot = {
    schemaVersion: 16, savedAt: connectedAt,
    users: [ownerUser, staffUser], revokedSessions: [], userRevocations: [], audit: [], jobs: [],
    platformConnections: [
      { platform: 'facebook', status: 'connected', accountId: 'PAGE_S2', accountName: 'معرض الغرابي', connectedAt, providerVerified: true },
    ],
    workspace: {
      showroom: { name: 'معرض الغرابي' },
      products: [],
      providerTokens: {
        facebook: encryptCredForTest({ pageId: 'PAGE_S2', pageAccessToken: FB_PAGE_TOKEN, userAccessToken: 'FB_USER_TOKEN', connectedAt }),
      },
      socialComments: [
        { id: 'c1', platform: 'facebook', externalId: 'msg_in', kind: 'message', text: 'كم القسط؟', authorName: 'زبون داخلي', createdAt: new Date(nowMs - 2 * 3600_000).toISOString(), replyTarget: { recipientId: 'PSID_IN' } },
        { id: 'c2', platform: 'facebook', externalId: 'msg_out', kind: 'message', text: 'كم القسط؟', authorName: 'زبون خارجي', createdAt: new Date(nowMs - 72 * 3600_000).toISOString(), replyTarget: { recipientId: 'PSID_OUT' } },
      ],
      socialReplies: [], socialApprovals: [], publishRecords: [],
    },
  };
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify(snapshot));
  // مسودة مرسلة كرسالة خاصة **خرجت من نافذة Meta** (أُنشئت سابقاً) — لإثبات أنها
  // لا تُرسل حتى بعد الموافقة (تُعلَّم منتهية). لا تُنشئها الدورة (حارس PR-S1 يمنع
  // إنشاء متابعة رسالة خارج النافذة أصلاً)، فهي مسودة قديمة محفوظة.
  const expiredDraft = {
    id: 'draft_expired', leadId: 'lead_out', leadKey: 'facebook:conv_out', platform: 'facebook', kind: 'message',
    purpose: 'follow_up', text: 'تذكير ودّي بخصوص استفسارك.', externalId: 'msg_out', recipientId: 'PSID_OUT',
    productId: null, proposalId: null, idempotencyKey: 'fu1',
    createdAt: new Date(nowMs - 30 * 3600_000).toISOString(),
    windowExpiresAt: new Date(nowMs - 6 * 3600_000).toISOString(),
    status: 'pending', decidedBy: null, decidedAt: null, approvedText: null,
    deliveryStatus: null, deliveryError: null, providerReplyId: null,
  };
  // وضع الإرسال approval (الافتراضي) + مفتاح مفعّل + العملاء.
  writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify({
    leads, killSwitch: { enabled: true, killAt: null, killBy: null, killReason: null }, sendMode: 'approval', drafts: [expiredDraft], ownerDecisions: [], lease: null,
  }));
}

async function main(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  metaState = createFacebookMock({
    pages: [{ id: 'PAGE_S2', name: 'معرض الغرابي', accessToken: FB_PAGE_TOKEN, tasks: ['MANAGE'] }],
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

    group('1) التصريح: صندوق الزبائن للمالك فقط (403 لغيره)');
    check('/api/commercial/inbox بلا جلسة => 401', (await fetch(`${BASE}/api/commercial/inbox`)).status === 401);
    check('/api/commercial/inbox لغير المالك => 403', (await fetch(`${BASE}/api/commercial/inbox`, { headers: staffAuth })).status === 403);
    const inbox0 = await (await fetch(`${BASE}/api/commercial/inbox`, { headers: auth })).json();
    check('الصندوق يُعاد للمالك', inbox0.success === true && Array.isArray(inbox0.leads), JSON.stringify(inbox0).slice(0, 200));
    check('وضع الإرسال الافتراضي = approval', inbox0.sendMode === 'approval' && inbox0.requiresApproval === true, JSON.stringify({ mode: inbox0.sendMode }));

    group('2) وضع approval: الدورة لا تستدعي أي مزوّد وتنشئ مسودة');
    const callsBefore = metaState.calls;
    const sentBefore = metaState.sentMessages.length;
    const run = await (await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الدورة نجحت', run.success === true, JSON.stringify(run).slice(0, 200));
    check('أُنشئت مسودة (drafted≥1)', (run.result?.drafted || 0) >= 1, JSON.stringify(run.result));
    check('لا إرسال خارجي إطلاقاً (followUpsSent=0)', (run.result?.followUpsSent || 0) === 0, JSON.stringify(run.result));
    check('لا رسالة وصلت مزوّد Meta', metaState.sentMessages.length === sentBefore, `delta=${metaState.sentMessages.length - sentBefore}`);
    check('لا نداء شبكي لمزوّد أثناء وضع الموافقة', metaState.calls === callsBefore, `calls=${metaState.calls} before=${callsBefore}`);
    const inbox1 = await (await fetch(`${BASE}/api/commercial/inbox`, { headers: auth })).json();
    const draftIn = inbox1.drafts.find((d: any) => d.leadId === 'lead_in' && d.status === 'pending');
    check('المسودة داخل النافذة معلّقة', Boolean(draftIn), JSON.stringify(inbox1.drafts));
    check('عدّاد المعلّق = 1 (الداخلي فقط؛ الخارجي منتهٍ)', inbox1.pendingDrafts === 1, JSON.stringify({ pending: inbox1.pendingDrafts }));
    const draftOut = inbox1.drafts.find((d: any) => d.leadId === 'lead_out');
    check('مسودة الخارجي منتهية (expired) لأنها خارج نافذة Meta', Boolean(draftOut) && draftOut.status === 'expired', JSON.stringify(draftOut?.status));

    group('3) الموافقة ترسل مرة واحدة، وتكرارها لا يرسل ثانية');
    const sentBefore2 = metaState.sentMessages.length;
    const approve = await (await fetch(`${BASE}/api/commercial/drafts/${draftIn.id}/decision`, { method: 'POST', headers: auth, body: JSON.stringify({ kind: 'approve' }) })).json();
    check('الموافقة نجحت وأرسلت', approve.success === true && approve.delivered === true, JSON.stringify(approve).slice(0, 200));
    check('معرّف رد حقيقي من Meta', Boolean(approve.providerReplyId), JSON.stringify(approve.providerReplyId));
    check('نداء إرسال واحد فقط', metaState.sentMessages.length === sentBefore2 + 1, `sent=${metaState.sentMessages.length}`);
    check('المستلم هو PSID_IN', metaState.sentMessages[metaState.sentMessages.length - 1]?.recipientId === 'PSID_IN', JSON.stringify(metaState.sentMessages));
    // إعادة القرار على مسودة محسومة ⇒ رفض صريح (لا إرسال ثانٍ).
    const reDecide = await fetch(`${BASE}/api/commercial/drafts/${draftIn.id}/decision`, { method: 'POST', headers: auth, body: JSON.stringify({ kind: 'approve' }) });
    check('إعادة القرار على مسودة محسومة => 409', reDecide.status === 409, `status=${reDecide.status}`);
    check('لا إرسال ثانٍ بعد إعادة القرار', metaState.sentMessages.length === sentBefore2 + 1, `sent=${metaState.sentMessages.length}`);

    group('4) مسودة خارج نافذة Meta لا تُرسل حتى بعد الموافقة');
    const sentBefore3 = metaState.sentMessages.length;
    const approveOut = await fetch(`${BASE}/api/commercial/drafts/draft_expired/decision`, { method: 'POST', headers: auth, body: JSON.stringify({ kind: 'approve' }) });
    const approveOutBody = await approveOut.json();
    check('الموافقة على مسودة منتهية => 409', approveOut.status === 409, `status=${approveOut.status}`);
    check('كود صريح DRAFT_EXPIRED', approveOutBody.code === 'DRAFT_EXPIRED', JSON.stringify(approveOutBody).slice(0, 200));
    check('لم يُرسل شيء للزبون خارج النافذة', !metaState.sentMessages.some((m: any) => m.recipientId === 'PSID_OUT'), JSON.stringify(metaState.sentMessages));
    check('لا إرسال جديد إطلاقاً', metaState.sentMessages.length === sentBefore3, `sent=${metaState.sentMessages.length}`);

    group('5) التعديل ثم الموافقة يرسل النص المعدّل ويمر بحارس سلامة المحتوى');
    // ننشئ مسودة داخل النافذة يدوياً عبر ملف الحالة ثم إعادة التشغيل (محاكاة حقيقية).
    proc!.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1500));
    const nowMs = Date.now();
    const editDraft = {
      id: 'draft_edit', leadId: 'lead_in', leadKey: 'facebook:conv_in', platform: 'facebook', kind: 'message',
      purpose: 'follow_up', text: 'هلا بيك، نكدر نوضّحلك التفاصيل.', externalId: 'msg_in', recipientId: 'PSID_IN',
      productId: null, proposalId: null, idempotencyKey: 'fu2',
      createdAt: new Date(nowMs - 60_000).toISOString(),
      windowExpiresAt: new Date(nowMs + 3600_000).toISOString(),
      status: 'pending', decidedBy: null, decidedAt: null, approvedText: null,
      deliveryStatus: null, deliveryError: null, providerReplyId: null,
    };
    const unsafeDraft = {
      ...editDraft, id: 'draft_unsafe', idempotencyKey: 'fu3',
      text: 'عرض خاص: خصم 10%', // ادعاء خصم غير مسجّل ⇒ يرفضه حارس سلامة المحتوى.
    };
    const current = JSON.parse(readFileSync(join(stateDir, 'commercial.json'), 'utf8'));
    current.drafts = [editDraft, unsafeDraft];
    current.ownerDecisions = current.ownerDecisions || [];
    writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify(current));
    startApp();
    check('الخادم يقلع بعد إعادة التشغيل', await waitForHealth(), log.slice(0, 400));
    Object.assign(auth, await login());

    const sentBefore4 = metaState.sentMessages.length;
    const edited = 'نص معدّل من المالك للرد على الزبون.';
    const editApprove = await (await fetch(`${BASE}/api/commercial/drafts/draft_edit/decision`, { method: 'POST', headers: auth, body: JSON.stringify({ kind: 'edit_approve', text: edited }) })).json();
    check('التعديل ثم الموافقة نجح', editApprove.success === true && editApprove.delivered === true, JSON.stringify(editApprove).slice(0, 200));
    check('النص المُرسَل هو المعدّل', metaState.sentMessages[metaState.sentMessages.length - 1]?.text === edited, JSON.stringify(metaState.sentMessages[metaState.sentMessages.length - 1]));
    check('سجل قرار المالك يحمل النص الأصلي والمعدّل', editApprove.decision?.originalText === editDraft.text && editApprove.decision?.editedText === edited, JSON.stringify(editApprove.decision));

    const unsafeApprove = await fetch(`${BASE}/api/commercial/drafts/draft_unsafe/decision`, { method: 'POST', headers: auth, body: JSON.stringify({ kind: 'approve' }) });
    const unsafeBody = await unsafeApprove.json();
    check('حارس سلامة المحتوى يرفض ادعاءً غير مسجّل (422)', unsafeApprove.status === 422, `status=${unsafeApprove.status} ${JSON.stringify(unsafeBody).slice(0, 200)}`);
    check('لم يُرسل النص غير الآمن', metaState.sentMessages.length === sentBefore4 + 1, `sent=${metaState.sentMessages.length}`);

    group('6) الرفض لا يرسل شيئاً');
    // نُوقف الخادم أولاً (كي لا تكتب عملية الإغلاق حالتها فوق تعديلنا) ثم نزرع مسودة.
    proc!.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1500));
    const sentBefore5 = metaState.sentMessages.length;
    const rejectDraft = { ...editDraft, id: 'draft_reject', idempotencyKey: 'fu4', status: 'pending' };
    const cur2 = JSON.parse(readFileSync(join(stateDir, 'commercial.json'), 'utf8'));
    cur2.drafts = [...(cur2.drafts || []), rejectDraft];
    writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify(cur2));
    startApp();
    check('الخادم يقلع', await waitForHealth(), log.slice(0, 400));
    Object.assign(auth, await login());
    const rejected = await (await fetch(`${BASE}/api/commercial/drafts/draft_reject/decision`, { method: 'POST', headers: auth, body: JSON.stringify({ kind: 'reject' }) })).json();
    check('الرفض نجح', rejected.success === true, JSON.stringify(rejected).slice(0, 200));
    check('لم يُرسل شيء عند الرفض', metaState.sentMessages.length === sentBefore5, `sent=${metaState.sentMessages.length}`);

    group('7) تأكيد الصفقة للمالك فقط (403 لغيره)');
    // نُوقف الخادم أولاً ثم نزرع اقتراحاً معلّقاً على عميل.
    proc!.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1500));
    const cur3 = JSON.parse(readFileSync(join(stateDir, 'commercial.json'), 'utf8'));
    const propLead = cur3.leads.find((l: any) => l.id === 'lead_in');
    propLead.pendingProposal = {
      id: 'prop_s2', productId: 'P1', productName: 'ثلاجة', cashPrice: 1000000, discountPercent: 3, discountAmount: 30000,
      finalPrice: 970000, installmentMonths: 10, monthlyInstallment: 97000, createdAt: new Date().toISOString(),
      status: 'pending', confirmedBy: null, confirmedAt: null,
    };
    propLead.stage = 'PROPOSAL_PENDING';
    writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify(cur3));
    startApp();
    check('الخادم يقلع', await waitForHealth(), log.slice(0, 400));
    Object.assign(auth, await login());
    const staffConfirm = await fetch(`${BASE}/api/commercial/leads/lead_in/proposal/confirm`, { method: 'POST', headers: staffAuth, body: JSON.stringify({ proposalId: 'prop_s2' }) });
    check('تأكيد الصفقة بالموظف => 403', staffConfirm.status === 403, `status=${staffConfirm.status}`);
    const staffReject = await fetch(`${BASE}/api/commercial/leads/lead_in/proposal/reject`, { method: 'POST', headers: staffAuth, body: JSON.stringify({ proposalId: 'prop_s2' }) });
    check('رفض العرض بالموظف => 403', staffReject.status === 403, `status=${staffReject.status}`);
    const ownerConfirm = await (await fetch(`${BASE}/api/commercial/leads/lead_in/proposal/confirm`, { method: 'POST', headers: auth, body: JSON.stringify({ proposalId: 'prop_s2' }) })).json();
    check('تأكيد الصفقة بالمالك => WON', ownerConfirm.success === true && ownerConfirm.lead?.stage === 'WON', JSON.stringify(ownerConfirm).slice(0, 200));

    group('8) الصندوق لا يسرّب بيانات العملاء إلى النقطتين العامتين');
    const health = await (await fetch(`${BASE}/api/health`)).json();
    const healthStr = JSON.stringify(health);
    check('health يحمل commercialBrain', Boolean(health.commercialBrain));
    check('health يعرض وضع الإرسال والعدّاد (بلا نص عميل)', health.commercialBrain?.sendMode === 'approval' && typeof health.commercialBrain?.pendingDrafts === 'number');
    check('health لا يحمل أسماء/نصوص عملاء', !healthStr.includes('زبون داخلي') && !healthStr.includes('زبون خارجي') && !healthStr.includes('كم القسط'));

    group('9) الثبات بعد restart (المسودات والقرارات ووضع الإرسال تصمد)');
    proc!.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1500));
    startApp();
    check('الخادم يقلع', await waitForHealth(), log.slice(0, 400));
    Object.assign(auth, await login());
    const inboxFinal = await (await fetch(`${BASE}/api/commercial/inbox`, { headers: auth })).json();
    check('وضع الإرسال يصمد (approval)', inboxFinal.sendMode === 'approval');
    check('المسودات المصروفة تصمد (approved/rejected/expired)', Array.isArray(inboxFinal.drafts) && inboxFinal.drafts.some((d: any) => d.status === 'approved') && inboxFinal.drafts.some((d: any) => d.status === 'rejected'), JSON.stringify(inboxFinal.drafts.map((d: any) => d.status)));
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
    console.log(`PASSED: ${passed} commercial inbox (PR-S2) checks`);
    process.exit(0);
  } else {
    console.log(`FAILED: ${failures.length} of ${passed + failures.length}`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

void main();
