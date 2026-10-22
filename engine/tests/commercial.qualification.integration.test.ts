/**
 * PR-S5 — «زبون حقيقي فقط + متابعة نظيفة» (تكامل: خادم حقيقي + خادم Meta وهمي محلي).
 *
 * يثبت على المسار الفعلي (يفشل على الكود القديم):
 *  - تعليق إيموجي فقط (😍) **لا ينشئ lead ولا مسودة**.
 *  - «كم سعر» يُنشئ lead + مسودة جواب.
 *  - تعليق عمره 20 يوماً **لا يولّد متابعة**.
 *  - تنظيف المسودات يحوّل المخالفة إلى `cancelled` (بسبب مكتوب + سجل audit) ولا يلمس
 *    مسودة الجواب الصحيحة، ويؤرشف الـleads المخالفة — بلا حذف.
 *  - النقطتان العامتان لا تسرّبان بيانات عملاء.
 *
 * بلا مزوّد حقيقي ولا سرّ ولا حصة (خادم Graph وهمي).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
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
const APP_PORT = 7720 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FB_PORT = 7790 + Math.floor(Math.random() * 40);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'prs5-qualification-test-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_1234567890';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_not_real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const FB_PAGE_TOKEN = 'FB_PAGE_TOKEN_NOT_REAL';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-prs5-'));

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

const H = 3600_000, D = 24 * H;

/** يزرع: تعليق إيموجي (حديث) + سؤال حقيقي (حديث) + سؤال قديم 20 يوماً، مع مسودات معلّقة. */
function seedState(): void {
  const nowMs = Date.now();
  const at = (msAgo: number) => new Date(nowMs - msAgo).toISOString();
  const leads = [
    {
      id: 'lead_emoji', key: 'facebook:author:E', platform: 'facebook', conversationId: 'author:E', kind: 'comment',
      replyTarget: { commentId: 'cE' }, lastExternalId: 'cE', initiatedByCustomer: true,
      sourceEventIds: ['cE'], customerName: 'معلّق إيموجي', interestedProductId: null, interestedProductName: null,
      stage: 'ENGAGED', touches: 1, lastCustomerText: '😍',
      lastInteractionAt: at(2 * H), createdAt: at(2 * H), updatedAt: at(2 * H),
      lastCustomerInteractionAt: at(2 * H), lastBusinessReplyAt: null,
      followUpState: 'SCHEDULED', followUpsSent: 0, nextFollowUpAt: at(1 * H),
      pendingProposal: null, escalationReason: null, notes: [],
    },
    {
      id: 'lead_good', key: 'facebook:author:G', platform: 'facebook', conversationId: 'author:G', kind: 'comment',
      replyTarget: { commentId: 'cG' }, lastExternalId: 'cG', initiatedByCustomer: true,
      sourceEventIds: ['cG'], customerName: 'زبون سؤال', interestedProductId: null, interestedProductName: null,
      stage: 'ENGAGED', touches: 1, lastCustomerText: 'كم سعر هذا الموبايل؟',
      lastInteractionAt: at(2 * H), createdAt: at(2 * H), updatedAt: at(2 * H),
      lastCustomerInteractionAt: at(2 * H), lastBusinessReplyAt: null,
      followUpState: 'SCHEDULED', followUpsSent: 0, nextFollowUpAt: at(1 * H),
      pendingProposal: null, escalationReason: null, notes: [],
    },
    {
      id: 'lead_old', key: 'facebook:author:O', platform: 'facebook', conversationId: 'author:O', kind: 'comment',
      replyTarget: { commentId: 'cO' }, lastExternalId: 'cO', initiatedByCustomer: true,
      sourceEventIds: ['cO'], customerName: 'زبون قديم', interestedProductId: null, interestedProductName: null,
      stage: 'ENGAGED', touches: 1, lastCustomerText: 'كم سعر هذا الموبايل؟',
      lastInteractionAt: at(20 * D), createdAt: at(20 * D), updatedAt: at(20 * D),
      lastCustomerInteractionAt: at(20 * D), lastBusinessReplyAt: null,
      followUpState: 'SCHEDULED', followUpsSent: 0, nextFollowUpAt: at(1 * H),
      pendingProposal: null, escalationReason: null, notes: [],
    },
  ];
  const connectedAt = at(3 * H);
  const snapshot = {
    schemaVersion: 16, savedAt: connectedAt,
    users: [ownerUser, staffUser], revokedSessions: [], userRevocations: [], audit: [], jobs: [],
    platformConnections: [
      { platform: 'facebook', status: 'connected', accountId: 'PAGE_S5', accountName: 'معرض الغرابي', connectedAt, providerVerified: true },
    ],
    workspace: {
      showroom: { name: 'معرض الغرابي' },
      products: [],
      providerTokens: {
        facebook: encryptCredForTest({ pageId: 'PAGE_S5', pageAccessToken: FB_PAGE_TOKEN, userAccessToken: 'FB_USER_TOKEN', connectedAt }),
      },
      socialComments: [
        { id: 'cE', platform: 'facebook', externalId: 'cE', kind: 'comment', text: '😍', authorName: null, authorId: null, createdAt: at(2 * H), replyTarget: { commentId: 'cE' } },
        { id: 'cG', platform: 'facebook', externalId: 'cG', kind: 'comment', text: 'كم سعر هذا الموبايل؟', authorName: null, authorId: null, createdAt: at(2 * H), replyTarget: { commentId: 'cG' } },
        { id: 'cO', platform: 'facebook', externalId: 'cO', kind: 'comment', text: 'كم سعر هذا الموبايل؟', authorName: null, authorId: null, createdAt: at(20 * D), replyTarget: { commentId: 'cO' } },
      ],
      socialReplies: [], socialApprovals: [], publishRecords: [],
    },
  };
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify(snapshot));
  // مسودات معلّقة: متابعة على الإيموجي (مخالفة)، متابعة على القديم (مخالفة)، جواب صحيح.
  const drafts = [
    { id: 'dE', leadId: 'lead_emoji', leadKey: 'facebook:author:E', platform: 'facebook', kind: 'comment', purpose: 'follow_up', text: 'حبيت أتأكد إذا بعدك مهتم بالاستفسار', externalId: 'cE', recipientId: null, productId: null, proposalId: null, idempotencyKey: 'fu1', createdAt: at(2 * H), windowExpiresAt: null, status: 'pending', decidedBy: null, decidedAt: null, approvedText: null, deliveryStatus: null, deliveryError: null, providerReplyId: null },
    { id: 'dO', leadId: 'lead_old', leadKey: 'facebook:author:O', platform: 'facebook', kind: 'comment', purpose: 'follow_up', text: 'حبيت أتأكد إذا بعدك مهتم بالاستفسار', externalId: 'cO', recipientId: null, productId: null, proposalId: null, idempotencyKey: 'fu2', createdAt: at(20 * D), windowExpiresAt: null, status: 'pending', decidedBy: null, decidedAt: null, approvedText: null, deliveryStatus: null, deliveryError: null, providerReplyId: null },
    { id: 'dG', leadId: 'lead_good', leadKey: 'facebook:author:G', platform: 'facebook', kind: 'comment', purpose: 'reply', text: 'هلا بيك، السعر ٥٠٠,٠٠٠ د.ع والقسط ٦٢,٥٠٠.', externalId: 'cG', recipientId: null, productId: null, proposalId: null, idempotencyKey: 'reply:cG', createdAt: at(2 * H), windowExpiresAt: null, status: 'pending', decidedBy: null, decidedAt: null, approvedText: null, deliveryStatus: null, deliveryError: null, providerReplyId: null },
  ];
  writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify({
    leads, killSwitch: { enabled: false, killAt: null, killBy: null, killReason: null }, sendMode: 'approval', drafts, ownerDecisions: [], lease: null,
  }));
}

async function main(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  metaState = createFacebookMock({
    pages: [{ id: 'PAGE_S5', name: 'معرض الغرابي', accessToken: FB_PAGE_TOKEN, tasks: ['MANAGE'] }],
    userAccessToken: 'FB_USER_TOKEN',
    feedPosts: [{ id: 'POST_S5', message: 'منشور اختبار PR-S5', comments: [
      { id: 'cPoll1', message: '👏', from: { id: 'A_POLL', name: null }, created_time: String(Math.floor((Date.now() - 3600_000) / 1000)) },
      // PR-B (البند 4): تعليق سؤال حقيقي عليه رد من الصفحة نفسها داخل الخيط (المطابقة
      // بالمعرّف) ⇒ يجب ألا تُنشأ له مسودة (SKIP_PAGE_ALREADY_REPLIED).
      { id: 'cPageReplied', message: 'كم سعر الموبايل؟', from: { id: 'A_CUST', name: null }, created_time: String(Math.floor((Date.now() - 1800_000) / 1000)),
        nestedReplies: [{ id: 'r_page_1', message: 'أهلاً وسهلاً، راسلنا على الخاص ونعطيك السعر.', from: { id: 'PAGE_S5', name: 'معرض الغرابي' } }] },
    ] }],
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

    group('1) التصريح: التنظيف والتشخيص للمالك فقط');
    check('/api/commercial/cleanup بلا جلسة => 401', (await fetch(`${BASE}/api/commercial/cleanup`, { method: 'POST' })).status === 401);
    check('/api/commercial/cleanup لغير المالك => 403', (await fetch(`${BASE}/api/commercial/cleanup`, { method: 'POST', headers: staffAuth, body: '{}' })).status === 403);
    check('/api/commercial/author-name-diagnosis لغير المالك => 403', (await fetch(`${BASE}/api/commercial/author-name-diagnosis`, { headers: staffAuth })).status === 403);

    group('2) الحالة قبل التنظيف: 3 مسودات معلّقة');
    const inbox0 = await (await fetch(`${BASE}/api/commercial/inbox`, { headers: auth })).json();
    check('الصندوق يُعاد للمالك', inbox0.success === true, JSON.stringify(inbox0).slice(0, 200));
    check('قبل: 3 مسودات معلّقة', inbox0.pendingDrafts === 3, JSON.stringify({ pending: inbox0.pendingDrafts }));
    check('ملخّص التأهيل: 2 مؤهّلان من 3', inbox0.qualification?.qualifiedLeads === 2 && inbox0.qualification?.totalLeads === 3, JSON.stringify(inbox0.qualification));
    const emojiLeadRow = inbox0.leads.find((l: any) => l.id === 'lead_emoji');
    check('lead الإيموجي غير مؤهّل في العرض', emojiLeadRow?.qualifiedQuestion === false, JSON.stringify(emojiLeadRow));

    group('3) التنظيف يحوّل المخالف إلى cancelled ولا يلمس مسودة الجواب الصحيحة');
    const cleanup = await (await fetch(`${BASE}/api/commercial/cleanup`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('التنظيف نجح', cleanup.success === true, JSON.stringify(cleanup).slice(0, 300));
    check('قبل = 3 معلّقة', cleanup.before?.pendingDrafts === 3, JSON.stringify(cleanup.before));
    check('بعد = 1 معلّقة', cleanup.after?.pendingDrafts === 1, JSON.stringify(cleanup.after));
    check('أُلغيت 2 مسودة', cleanup.cancelledDrafts === 2, JSON.stringify({ cancelled: cleanup.cancelledDrafts }));
    check('أُرشف lead الإيموجي (1)', cleanup.archivedLeads === 1, JSON.stringify({ archived: cleanup.archivedLeads }));
    const cancelCodes = new Set((cleanup.cancellations || []).map((c: any) => c.code));
    check('سبب إلغاء مسودة الإيموجي = NOT_A_REAL_QUESTION', cancelCodes.has('NOT_A_REAL_QUESTION'), JSON.stringify([...cancelCodes]));
    check('سبب إلغاء القديم = STALE_BEYOND_7_DAYS', cancelCodes.has('STALE_BEYOND_7_DAYS'), JSON.stringify([...cancelCodes]));
    check('كل إلغاء يحمل سبباً مكتوباً', (cleanup.cancellations || []).every((c: any) => String(c.reason || '').trim().length > 0));

    const inbox1 = await (await fetch(`${BASE}/api/commercial/inbox`, { headers: auth })).json();
    const dE = inbox1.drafts.find((d: any) => d.id === 'dE');
    const dO = inbox1.drafts.find((d: any) => d.id === 'dO');
    const dG = inbox1.drafts.find((d: any) => d.id === 'dG');
    check('dE صارت cancelled بسبب مكتوب', dE?.status === 'cancelled' && String(dE?.cancelledReason || '').length > 0, JSON.stringify(dE));
    check('dO صارت cancelled', dO?.status === 'cancelled', JSON.stringify(dO));
    check('dG (جواب صحيح) **لم تُلمس** (pending)', dG?.status === 'pending', JSON.stringify(dG));
    check('لم تُحذف أي مسودة (3 مسودات باقية)', inbox1.drafts.length === 3, String(inbox1.drafts.length));
    check('lead الإيموجي مؤرشف في العرض', inbox1.leads.find((l: any) => l.id === 'lead_emoji')?.archived === true);
    check('لم يُحذف أي lead (3 باقية)', inbox1.leads.length === 3, String(inbox1.leads.length));

    group('4) بعد التنظيف: دورة العقل لا تولّد أي متابعة مخالفة (ولا مزوّد)');
    const sentBefore = metaState.sentMessages.length;
    const run = await (await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الدورة نجحت', run.success === true, JSON.stringify(run).slice(0, 200));
    check('لا متابعة أُرسلت (المخالف أُرشف والقديم stale)', (run.result?.followUpsSent || 0) === 0, JSON.stringify(run.result));
    check('لا رسالة وصلت مزوّد Meta', metaState.sentMessages.length === sentBefore, `sent=${metaState.sentMessages.length}`);

    group('4ب) نص المنشور الحقيقي (message) يُحفظ فلا يظهر «منشور بلا نص ظاهر»');
    // دورة مراقب Meta هي التي تسحب التعليقات من Graph (القراءة المضمَّنة داخل الحواف).
    await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' });
    const state1 = JSON.parse(readFileSync(join(stateDir, '.gharabi-state.json'), 'utf8'));
    const polledComments = (state1.workspace?.socialComments || []).filter((c: any) => c.ingestSource === 'facebook_polling');
    check('نص المنشور محفوظ على التعليقات المسحوبة', polledComments.some((c: any) => c.postText === 'منشور اختبار PR-S5'), JSON.stringify(polledComments.map((c: any) => ({ t: c.text, postText: c.postText })).slice(0, 5)));

    group('5) تشخيص اسم الكاتب (from) — قراءة فقط بلا سرّ');
    const diag = await (await fetch(`${BASE}/api/commercial/author-name-diagnosis`, { headers: auth })).json();
    check('التشخيص يُعاد', diag.success === true && Boolean(diag.diagnosis), JSON.stringify(diag).slice(0, 300));
    check('verdict صريح', ['from_field_returned', 'from_field_missing', 'no_data'].includes(diag.diagnosis?.verdict), JSON.stringify(diag.diagnosis));
    check('لا تسريب سرّ في التشخيص', !JSON.stringify(diag).includes(FB_PAGE_TOKEN) && !JSON.stringify(diag).includes('FB_USER_TOKEN'));
    if (diag.diagnosis?.verdict === 'from_field_missing') {
      check('عند الحجب: OWNER SESSION REQUIRED + خطوات لوحة Meta', diag.diagnosis.ownerSessionRequired === true && (diag.diagnosis.metaDashboardSteps || []).length >= 4);
    }

    group('6) النقطتان العامتان لا تسرّبان بيانات عملاء');
    for (const ep of ['/api/health', '/api/readiness']) {
      const body = await (await fetch(`${BASE}${ep}`)).json();
      const s = JSON.stringify(body);
      check(`${ep} لا يحمل نص تعليق/اسم عميل`, !s.includes('كم سعر هذا الموبايل') && !s.includes('معلّق إيموجي') && !s.includes('حبيت أتأكد'));
    }

    group('7) الثبات بعد restart (الإلغاء والأرشفة يصمدان)');
    proc!.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1500));
    startApp();
    check('الخادم يقلع بعد إعادة التشغيل', await waitForHealth(), log.slice(0, 400));
    Object.assign(auth, await login());
    const inbox2 = await (await fetch(`${BASE}/api/commercial/inbox`, { headers: auth })).json();
    check('الإلغاء يصمد بعد restart', inbox2.drafts.find((d: any) => d.id === 'dE')?.status === 'cancelled');
    check('الأرشفة تصمد بعد restart', inbox2.leads.find((l: any) => l.id === 'lead_emoji')?.archived === true);
    check('مسودة الجواب الصحيحة تبقى معلّقة بعد restart', inbox2.drafts.find((d: any) => d.id === 'dG')?.status === 'pending');

    group('7ب) PR-B (البند 4): تعليق عليه رد من الصفحة داخل الخيط ⇒ لا مسودة + SKIP_PAGE_ALREADY_REPLIED');
    // بعد دورة المراقب (poll) أعلاه سُجل التعليق `cPageReplied` ووُسم `threadPageReplied`
    // من الرد الفرعي الحقيقي (from.id = PAGE_S5). الدورة التالية لا تُنشئ له مسودة.
    // العقل التجاري معطَّل افتراضياً (fail-closed) — نُفعّله صراحةً للمالك لتعمل الدورة.
    const enableRes = await fetch(`${BASE}/api/agent/commercial/kill-switch`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true }) });
    check('تفعيل العقل التجاري من المالك نجح', enableRes.ok, String(enableRes.status));
    const runPage = await (await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('دورة العقل نجحت', runPage.success === true, JSON.stringify(runPage).slice(0, 200));
    const inboxAfterPage = await (await fetch(`${BASE}/api/commercial/inbox`, { headers: auth })).json();
    const pageDrafts = (inboxAfterPage.drafts || []).filter((d: any) => d.externalId === 'cPageReplied');
    check('لا مسودة للتعليق الذي ردّت عليه الصفحة', pageDrafts.length === 0, JSON.stringify(pageDrafts));
    const stateAfterPage = JSON.parse(readFileSync(join(stateDir, '.gharabi-state.json'), 'utf8'));
    const pageComment = (stateAfterPage.workspace?.socialComments || []).find((c: any) => c.externalId === 'cPageReplied');
    check('التعليق وُسم threadPageReplied=true من الرد الفرعي الحقيقي', pageComment?.threadPageReplied === true, JSON.stringify(pageComment));
    check('سجل audit يحمل commercial_draft_skipped بـSKIP_PAGE_ALREADY_REPLIED',
      (stateAfterPage.audit || []).some((a: any) => a.action === 'commercial_draft_skipped' && String(a.detail || '').includes('SKIP_PAGE_ALREADY_REPLIED')),
      JSON.stringify((stateAfterPage.audit || []).filter((a: any) => a.action === 'commercial_draft_skipped').slice(0, 3)));

    group('8) سجل audit يحمل قرارات التنظيف');
    const auditLog = JSON.parse(readFileSync(join(stateDir, '.gharabi-state.json'), 'utf8')).audit || [];
    check('audit يحمل commercial_draft_cancelled', auditLog.some((a: any) => a.action === 'commercial_draft_cancelled'), JSON.stringify(auditLog.map((a: any) => a.action)));
    check('audit يحمل commercial_lead_archived', auditLog.some((a: any) => a.action === 'commercial_lead_archived'), JSON.stringify(auditLog.map((a: any) => a.action)));

    console.log(`\nPR-S5 integration: ${passed} passed, ${failures.length} failed`);
    if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); console.log(log.slice(-3000)); process.exit(1); }
  } catch (err: any) {
    failures.push(`EXCEPTION: ${String(err?.message || err)}`);
    console.log(log.slice(-3000));
    process.exit(1);
  } finally {
    try { if (proc) { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1200)); if (!proc.killed) proc.kill('SIGKILL'); } } catch { /* تجاهل */ }
    try { if (metaMock) await metaMock.stop(); } catch { /* تجاهل */ }
  }
}

void main();
