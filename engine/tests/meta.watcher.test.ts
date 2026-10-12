/**
 * اختبار مراقب الردود لـ Facebook/Instagram (Meta Reply Watcher).
 *
 * طبقتان:
 *  1) وحدة: منطق القرار/البوابة/التحكم الحتمي (يستهلك نفس محرّك YouTube — سلطة
 *     قرار واحدة) بلا شبكة.
 *  2) تكامل: الخادم الحقيقي + خادم Graph وهمي محلي عبر FACEBOOK_GRAPH_API_BASE:
 *     ربط Facebook، قراءة تعليقات حقيقية (سحب احتياطي)، التأجيل عند تعطيل الرد،
 *     الرد الحقيقي بعد التمكين (بمعرّف من Meta)، منع التكرار، التصريح (401/403)،
 *     خلو /api/health و/api/readiness من بيانات العملاء، والثبات بعد restart.
 *
 * لا يلمس أي مزود Meta حقيقي ولا يستهلك حصة، ولا يستخدم أي سرّ واقعي.
 */

import express from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import {
  META_WATCHER_PLATFORMS,
  defaultMetaPollingState,
  normalizeMetaPollingState,
  metaWatcherGate,
  decideMetaCommentAction,
  resolveMetaReplyExecution,
  isDeferredDecision,
  releaseDeferredEntries,
  metaPollingPublicBlock,
  metaExecutionDecisionFromCentral,
} from '../social/metaWatcher';
import { reserveOperationRate } from '../social/operationRateLimiter';
import { createFacebookMock, startFacebookMockServer } from './helpers/facebookMock';
import { parseFacebookWebhook } from '../social/facebook';
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
const APP_PORT = 7300 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FB_PORT = 7400 + Math.floor(Math.random() * 100);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'meta-watcher-test-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_1234567890';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_not_real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-meta-watcher-'));

const secretBuffer = createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };
const staffUser = { id: 'staff-1', name: 'موظف اختبار', email: 'staff@example.invalid', role: 'staff', roleTitleArabic: 'الموظف', avatar: '', active: true, createdAt: new Date().toISOString() };

function startApp(fbBase: string, extraEnv: Record<string, string> = {}, stateDirOverride: string = stateDir): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDirOverride,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    FACEBOOK_GRAPH_API_BASE: fbBase,
    FACEBOOK_DIALOG_BASE: fbBase,
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: FB_APP_SECRET,
    FACEBOOK_VERIFY_TOKEN: FB_VERIFY_TOKEN,
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    ...extraEnv,
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
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
/** يبني توقيع Meta HMAC على الجسم الخام (نفس صيغة sha256=...). */
function fbSignature(raw: string): string {
  return 'sha256=' + createHmac('sha256', FB_APP_SECRET).update(raw, 'utf8').digest('hex');
}

async function login(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
  });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}

async function unitTests(): Promise<void> {
  group('1) وحدة: مصدر واحد للقرار (نفس محرّك YouTube) + أمان افتراضي');
  const d = defaultMetaPollingState();
  check('المنصات المشمولة = facebook + instagram', META_WATCHER_PLATFORMS.length === 2 && META_WATCHER_PLATFORMS.includes('facebook') && META_WATCHER_PLATFORMS.includes('instagram'));
  check('الرد الآلي معطّل افتراضياً (آمن)', d.controls.autoReply === false);
  check('المراقبة مفعّلة افتراضياً (قراءة/تحليل)', d.controls.enabled === true && d.controls.paused === false);
  check('الفاصل الافتراضي = 1 دقيقة', d.controls.cadenceMinutes === 1);

  group('2) وحدة: بوابة الأتمتة (Kill Switch يمنع الكل)');
  check('قراءة مسموحة افتراضياً', metaWatcherGate(d.controls, 'read').allowed === true);
  check('رد ممنوع افتراضياً (autoReply معطّل)', metaWatcherGate(d.controls, 'reply').allowed === false && metaWatcherGate(d.controls, 'reply').code === 'AUTO_REPLY_DISABLED');
  check('Kill Switch يمنع القراءة أيضاً', metaWatcherGate({ ...d.controls, paused: true }, 'read').allowed === false && metaWatcherGate({ ...d.controls, paused: true }, 'read').code === 'AUTOMATION_PAUSED');
  check('الرد مسموح عند التمكين', metaWatcherGate({ ...d.controls, autoReply: true }, 'reply').allowed === true);

  group('3) وحدة: القرار الاستشاري الحتمي (تصنيف حقيقي)');
  const self = decideMetaCommentAction({ intent: 'praise', requiresHumanReview: false, isSpam: false, isSelfAuthored: true, alreadyReplied: false, controls: d.controls });
  check('تعليق حساب المعرض => تجاهل', self.action === 'skip' && self.code === 'SKIP_SELF_AUTHORED');
  const price = decideMetaCommentAction({ intent: 'business_inquiry', requiresHumanReview: true, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: { ...d.controls, autoReply: true } });
  check('استفسار سعر => تصعيد (لا اختراع سعر)', price.action === 'escalate' && price.code === 'ESCALATE_BUSINESS_INQUIRY');
  const complaint = decideMetaCommentAction({ intent: 'complaint', requiresHumanReview: true, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: { ...d.controls, autoReply: true } });
  check('شكوى => تصعيد', complaint.action === 'escalate' && complaint.code === 'ESCALATE_SENSITIVE');
  const spam = decideMetaCommentAction({ intent: 'spam', requiresHumanReview: false, isSpam: true, isSelfAuthored: false, alreadyReplied: false, controls: { ...d.controls, autoReply: true } });
  check('سبام => تجاهل', spam.action === 'skip' && spam.code === 'SKIP_SPAM');
  const praiseOff = decideMetaCommentAction({ intent: 'praise', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: d.controls });
  check('مدح مع تعطيل الرد => تأجيل غير نهائي', praiseOff.action === 'skip' && praiseOff.code === 'DEFER_AUTOREPLY_DISABLED' && isDeferredDecision(praiseOff.code));
  const praiseOn = decideMetaCommentAction({ intent: 'praise', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: { ...d.controls, autoReply: true } });
  check('مدح مع تمكين الرد => رد', praiseOn.action === 'reply' && praiseOn.code === 'REPLY_ALLOWED');

  group('4) وحدة: التأجيل والتحرير (لا فقدان تعليق)');
  const rel = releaseDeferredEntries([
    { commentId: 'a', stage: 'SKIPPED', action: 'skip', reason: 'الرد الآلي غير ممكّن', code: 'DEFER_AUTOREPLY_DISABLED', videoId: null, authorName: null, text: 'x', at: 't', deferred: true },
    { commentId: 'b', stage: 'ESCALATED', action: 'escalate', reason: 'سعر', code: 'ESCALATE_BUSINESS_INQUIRY', videoId: null, authorName: null, text: 'y', at: 't' },
  ]);
  check('المؤجَّل يُحرَّر والتصعيد النهائي يبقى', rel.released === 1 && rel.processed.length === 1 && rel.processed[0].commentId === 'b');

  group('5) وحدة: الكتلة العامة خالية من بيانات العملاء');
  const pub = metaPollingPublicBlock({ ...d, processed: [{ commentId: 'c1', stage: 'REPLIED', action: 'reply', reason: 'r', videoId: null, authorName: 'أحمد', text: 'شكد السعر', replyText: 'هلا', at: 't' }] });
  const pubKeys = Object.keys(pub);
  check('لا حقل authorName في الكتلة العامة', !pubKeys.includes('authorName'));
  check('لا حقل text/comment/replyText', !pubKeys.includes('text') && !pubKeys.includes('comment') && !pubKeys.includes('replyText') && !pubKeys.includes('recent'));
  check('الكتلة العامة تحمل حقولاً تقنية فقط', ['status', 'watcherActive', 'cadenceMinutes', 'pollCount', 'lastError'].every((k) => pubKeys.includes(k)));
  check('التطبيع الدفاعي لا يختلق قيماً', normalizeMetaPollingState(null).controls.autoReply === false && normalizeMetaPollingState({ pollCount: 'x' }).pollCount === 0);
  // تنقية رسالة الخطأ العامة (I3): لا نص مزوّد/محادثة خام في نقطة عامة.
  const errFree = metaPollingPublicBlock({ ...d, lastError: null });
  check('lastError الفارغ يبقى null', errFree.lastError === null);
  const errToken = metaPollingPublicBlock({ ...d, lastError: 'FETCH_FAILED' });
  check('رمز تقني ASCII يُقبل كما هو', errToken.lastError === 'FETCH_FAILED');
  const errRaw = metaPollingPublicBlock({ ...d, lastError: 'فشل قراءة تعليقات Facebook: انتهت صلاحية الرمز' });
  check('نص خطأ مزوّد حر (عربي/مسافات) => connection error', errRaw.lastError === 'connection error');
  const errRawEn = metaPollingPublicBlock({ ...d, lastError: 'OAuthException: token expired for page' });
  check('نص خطأ مزوّد إنجليزي حر => connection error', errRawEn.lastError === 'connection error');
  // I2: صدى رسائل الصفحة (is_echo) لا يُعتبر رسالة واردة.
  const echoPayload = { object: 'page', entry: [{ id: 'PAGE_123', time: 1, messaging: [{ sender: { id: 'PAGE_123' }, recipient: { id: 'U9' }, timestamp: 1, message: { mid: 'MID_ECHO', text: 'رد أرسلناه نحن', is_echo: true } }] }] };
  const echoParsed = parseFacebookWebhook(echoPayload);
  check('is_echo لا يُنتج أي حدث وارد', echoParsed.events.length === 0, JSON.stringify(echoParsed.events));
  const realPayload = { object: 'page', entry: [{ id: 'PAGE_123', time: 1, messaging: [{ sender: { id: 'U9' }, recipient: { id: 'PAGE_123' }, timestamp: 1, message: { mid: 'MID_REAL', text: 'استفسار عميل' } }] }] };
  const realParsed = parseFacebookWebhook(realPayload);
  check('الرسالة غير الصدى تُنتج حدثاً واحداً (kind=message)', realParsed.events.length === 1 && realParsed.events[0].kind === 'message');

  group('6) وحدة: سلطة التنفيذ الوحيدة (لا رد بلا تمكين + جاهزية)');
  const execBlocked = resolveMetaReplyExecution({ centralDecision: 'ALLOWED_ACTION', advisory: praiseOn, automationAllowed: false, replyReady: true, belongsToChannel: true, isPraise: true, humanReviewMode: false, centralEscalationReason: null });
  check('لا تنفيذ إن لم تسمح بوابة الأتمتة', execBlocked.action !== 'reply');
  const execOk = resolveMetaReplyExecution({ centralDecision: 'ALLOWED_ACTION', advisory: praiseOn, automationAllowed: true, replyReady: true, belongsToChannel: true, isPraise: true, humanReviewMode: false, centralEscalationReason: null });
  check('تنفيذ الرد عند اكتمال البوابات', execOk.action === 'reply');

  // 6ب) حلّ قرار التنفيذ من قرار العقل المركزي الحقيقي (Gap 1): لا hardcode.
  check('ALLOWED_ACTION => تنفيذ', metaExecutionDecisionFromCentral('ALLOWED_ACTION', false) === 'ALLOWED_ACTION');
  check('APPROVAL_REQUIRED + تمكين المالك => تنفيذ (التمكين هو الموافقة)', metaExecutionDecisionFromCentral('APPROVAL_REQUIRED', true) === 'ALLOWED_ACTION');
  check('APPROVAL_REQUIRED بلا تمكين => NO_ACTION (تأجيل لا تصعيد)', metaExecutionDecisionFromCentral('APPROVAL_REQUIRED', false) === 'NO_ACTION');
  check('NO_ACTION يبقى NO_ACTION', metaExecutionDecisionFromCentral('NO_ACTION', true) === 'NO_ACTION');
  check('HUMAN_ESCALATION => FAILED_SAFE (لا رد)', metaExecutionDecisionFromCentral('HUMAN_ESCALATION', true) === 'FAILED_SAFE');
  check('بلا قرار مركزي => FAILED_SAFE (لا رد)', metaExecutionDecisionFromCentral(null, true) === 'FAILED_SAFE');

  // 6ج) حارس المعدّل (Gap 2): الحجز ذرّي => لا تجاوز للحد عند تزامن العمليات،
  //     ونطاق كل (منصة:نوع) مستقل (تعليق ≠ رسالة)، والنافذة تُصفّر بعد انقضائها.
  group('6ج) وحدة: حارس المعدّل — حجز ذرّي (لا تجاوز عند التزامن)');
  const win = new Map<string, number[]>();
  const t0 = 1_700_000_000_000;
  let allowed = 0, denied = 0;
  for (let i = 0; i < 5; i += 1) { if (reserveOperationRate(win, 'facebook:comment', t0, 3, 60_000).allowed) allowed += 1; else denied += 1; }
  check('5 محاولات متزامنة بحدّ 3 => 3 مسموحة فقط', allowed === 3 && denied === 2, `allowed=${allowed} denied=${denied}`);
  check('لا تجاوز: العدد المحجوز = الحد بالضبط', (win.get('facebook:comment') || []).length === 3);
  check('المحاولة السادسة مرفوضة (retryAfterMs>0)', !reserveOperationRate(win, 'facebook:comment', t0, 3, 60_000).allowed);
  // نطاق مستقل: عدّاد الرسائل لا يتأثّر بعدّاد التعليقات.
  check('نوع الرسالة مستقل عن التعليق (لا استنزاف متقاطع)', reserveOperationRate(win, 'facebook:message', t0, 3, 60_000).allowed === true);
  // انقضاء النافذة => تُصفّر ويُسمح من جديد.
  check('بعد انقضاء النافذة يُسمح من جديد', reserveOperationRate(win, 'facebook:comment', t0 + 60_001, 3, 60_000).allowed === true);
  check('المصدر الواحد: النواة تُصدَّر من وحدة مستقلة', typeof reserveOperationRate === 'function');
}

async function integrationTests(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser, staffUser],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: { showroom: { name: 'معرض الغرابي' }, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [] },
  }), 'utf8');

  const mock = await startFacebookMockServer(FB_PORT, createFacebookMock({
    feedPosts: [
      { id: 'POST1', comments: [
        { id: 'C_USER', message: 'عاشت إيدكم على الخدمة', from: { id: 'U1', name: 'أحمد' }, created_time: '2026-01-01T00:00:00+0000' },
        { id: 'C_PRICE', message: 'شكد سعر الثلاجة؟', from: { id: 'U2', name: 'زينب' }, created_time: '2026-01-01T00:01:00+0000' },
        { id: 'C_SELF', message: 'عرض جديد اليوم', from: { id: 'PAGE_123', name: 'معرض الغرابي' }, created_time: '2026-01-01T00:02:00+0000' },
      ] },
    ],
  }));
  let app = startApp(mock.base);
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());
    const staffToken = signSession({ uid: 'staff-1', iat: Date.now(), exp: Date.now() + 3_600_000, sid: randomBytes(8).toString('hex') }, secretBuffer);
    const staffAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` };

    group('7) تكامل: التصريح — مسارات مراقب Meta محمية');
    check('/api/agent/meta/watcher بلا جلسة => 401', (await fetch(`${BASE}/api/agent/meta/watcher`)).status === 401);
    check('/api/agent/meta/watcher لغير المالك => 403', (await fetch(`${BASE}/api/agent/meta/watcher`, { headers: staffAuth })).status === 403);
    check('/poll بلا جلسة => 401', (await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 401);
    check('/controls لغير المالك => 403', (await fetch(`${BASE}/api/agent/meta/watcher/controls`, { method: 'POST', headers: staffAuth, body: '{}' })).status === 403);

    group('8) تكامل: ربط Facebook عبر OAuth (خادم Graph وهمي)');
    const startRes = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const state = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
    const cbRes = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(state)}&code=TESTCODE`);
    check('callback ينجح بالصفحة الواحدة', cbRes.status === 200, `status=${cbRes.status}`);

    group('9) تكامل: دورة مراقبة مع تعطيل الرد (تأجيل بلا إرسال)');
    const poll1 = await (await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الدورة تعمل', poll1.success === true && poll1.result?.newDetected >= 2, JSON.stringify(poll1.result));
    check('لا رد أُرسل مع تعطيل الرد الآلي', mock.state.commentReplies.length === 0, `replies=${mock.state.commentReplies.length}`);
    check('التعليق القابل للرد أُجّل (غير نهائي)', (poll1.result?.deferred || 0) >= 1, JSON.stringify(poll1.result));
    const w1 = await (await fetch(`${BASE}/api/agent/meta/watcher`, { headers: auth })).json();
    check('حالة المالك تعرض سجل المعالجة', w1.watcher?.processedCount >= 2);
    check('التعليق من حساب المعرض تُجوهل', (w1.watcher?.recent || []).some((r: any) => r.commentId === 'C_SELF' && r.code === 'SKIP_SELF_AUTHORED'));
    check('استفسار السعر صُعّد بلا اختراع', (w1.watcher?.recent || []).some((r: any) => r.commentId === 'C_PRICE' && r.stage === 'ESCALATED'));

    group('10) تكامل: تمكين الرد => تحرير المؤجَّل');
    const ctrl = await (await fetch(`${BASE}/api/agent/meta/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ autoReply: true }) })).json();
    check('تمكين الرد ينجح', ctrl.success === true && ctrl.controls?.autoReply === true);
    check('يُعلن عدد المؤجَّل المحرَّر', ctrl.releasedDeferred >= 1, `released=${ctrl.releasedDeferred}`);
    const badCadence = await fetch(`${BASE}/api/agent/meta/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ cadenceMinutes: 9 }) });
    check('فاصل غير صالح => 400 INVALID_CADENCE', badCadence.status === 400 && (await badCadence.json()).code === 'INVALID_CADENCE');

    group('11) تكامل: الرد الحقيقي (بمعرّف من Meta) + منع التكرار');
    const poll2 = await (await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('أُرسل رد واحد فعلي لخادم Graph', mock.state.commentReplies.length === 1, `replies=${mock.state.commentReplies.length}`);
    check('الرد على التعليق الصحيح (C_USER)', mock.state.commentReplies[0]?.commentId === 'C_USER', JSON.stringify(mock.state.commentReplies[0]));
    check('نص الرد عراقي حقيقي (غير فارغ)', typeof mock.state.commentReplies[0]?.message === 'string' && mock.state.commentReplies[0].message.trim().length > 0);
    check('الدورة أعلنت الرد المُسلَّم', (poll2.result?.replied || 0) >= 1, JSON.stringify(poll2.result));
    // إعادة الدورة: لا تكرار (التعليق مُعالَج سابقاً).
    await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' });
    check('لا رد مكرر عند إعادة الدورة', mock.state.commentReplies.length === 1, `replies=${mock.state.commentReplies.length}`);

    group('11ب) تكامل: مسار الرسائل الخاصة (webhook → رد حقيقي + حارس المحتوى)');
    const sentBefore = mock.state.sentMessages.length;
    const postMsg = async (body: any) => {
      const raw = JSON.stringify(body);
      return fetch(`${BASE}/api/platforms/facebook/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': fbSignature(raw) },
        body: raw,
      });
    };
    const msgEntry = (mid: string, text: string, senderId: string) => ({ object: 'page', entry: [{ id: 'PAGE_123', time: Date.now(), messaging: [{ sender: { id: senderId }, recipient: { id: 'PAGE_123' }, timestamp: Date.now(), message: { mid, text } }] }] });
    const m1 = await postMsg(msgEntry('MID_PRAISE', 'شكراً لكم على الخدمة', 'UMSG1'));
    const m1j = await m1.json();
    check('استقبال رسالة webhook موقّعة => مقبولة كرسالة (kind=message)', m1.status === 200 && (m1j.acceptedKinds || []).includes('message'), JSON.stringify(m1j));
    const m2 = await postMsg(msgEntry('MID_CLAIM', 'هلا بيك، ضمان 10 سنوات مجاناً', 'UMSG2'));
    check('استقبال رسالة ثانية موقّعة => مقبولة', m2.status === 200);
    // رسالة بلا توقيع => مرفوضة (لا استقبال غير موثوق).
    const unsigned = await fetch(`${BASE}/api/platforms/facebook/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msgEntry('MID_NOSIG', 'مرحبا', 'UMSG3')) });
    check('رسالة بلا توقيع HMAC => 401 (مرفوضة)', unsigned.status === 401, `status=${unsigned.status}`);
    // صدى رسالتنا الصادرة (is_echo) عبر webhook => يُتجاهل ولا يُخزَّن كرسالة واردة (I2).
    const echoRaw = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE_123', time: Date.now(), messaging: [{ sender: { id: 'PAGE_123' }, recipient: { id: 'UMSG1' }, timestamp: Date.now(), message: { mid: 'MID_ECHO', text: 'رد أرسلناه نحن', is_echo: true } }] }] });
    const echoRes = await fetch(`${BASE}/api/platforms/facebook/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': fbSignature(echoRaw) }, body: echoRaw });
    const echoJ = await echoRes.json();
    check('صدى رسالتنا (is_echo) لا يُقبل كرسالة واردة', echoRes.status === 200 && !(echoJ.acceptedKinds || []).includes('message'), JSON.stringify(echoJ));
    const pollMsg = await (await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الدورة ردّت الرسالتين الحقيقيتين عبر sendMessage', mock.state.sentMessages.length === sentBefore + 2, `sent=${mock.state.sentMessages.length}`);
    const recipients = mock.state.sentMessages.slice(sentBefore).map((s) => s.recipientId).sort();
    check('الرسائل أُرسلت للمستلمين الصحيحين (UMSG1/UMSG2)', JSON.stringify(recipients) === JSON.stringify(['UMSG1', 'UMSG2']), JSON.stringify(recipients));
    check('نصوص ردود الرسائل عراقية حقيقية غير فارغة', mock.state.sentMessages.slice(sentBefore).every((s) => typeof s.text === 'string' && s.text.trim().length > 0));
    check('لا يخرج ادعاء غير مسجّل (ضمان) في أي رد رسالة', !mock.state.sentMessages.slice(sentBefore).some((s) => s.text.includes('ضمان')), JSON.stringify(mock.state.sentMessages.slice(sentBefore).map((s) => s.text)));
    const wMsg = await (await fetch(`${BASE}/api/agent/meta/watcher`, { headers: auth })).json();
    check('سجل المعالجة يحمل وحدة الرسالة (kind=message, REPLIED)', (wMsg.watcher?.recent || []).some((r: any) => r.commentId === 'MID_PRAISE' && r.kind === 'message' && r.stage === 'REPLIED'), JSON.stringify((wMsg.watcher?.recent || []).map((r: any) => [r.commentId, r.stage, r.kind])));
    check('ردّ الرسالة يحمل معرّف رسالة حقيقي من Meta (mid.*)', (wMsg.watcher?.recent || []).some((r: any) => r.commentId === 'MID_PRAISE' && typeof r.externalReplyId === 'string' && r.externalReplyId.startsWith('mid.')), JSON.stringify((wMsg.watcher?.recent || []).find((r: any) => r.commentId === 'MID_PRAISE')));
    // حارس سلامة المحتوى: رد المالك بنص يحمل ادعاءً غير مسجّل => 422 قبل أي إرسال.
    const ownerClaim = await fetch(`${BASE}/api/platforms/facebook/message-reply`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ externalId: 'MID_CLAIM', recipientId: 'UMSG2', text: 'ضمان 10 سنوات مجاناً', commentText: 'هلا بيك' }),
    });
    check('رد رسالة بادعاء غير مسجّل => 422 (حارس المحتوى)', ownerClaim.status === 422, `status=${ownerClaim.status}`);

    group('12) تكامل: النقطتان العامتان خاليتان من بيانات العملاء');
    const rawHealth = await (await fetch(`${BASE}/api/health`)).text();
    const rawReadiness = await (await fetch(`${BASE}/api/readiness`)).text();
    check('health لا يحمل نص تعليق عميل', !rawHealth.includes('عاشت إيدكم') && !rawHealth.includes('شكد سعر'));
    check('readiness لا يحمل نص تعليق عميل', !rawReadiness.includes('عاشت إيدكم') && !rawReadiness.includes('شكد سعر'));
    check('health لا يحمل اسم حساب عميل', !rawHealth.includes('أحمد') && !rawHealth.includes('زينب'));
    check('لا حقل replyText/attentionRequired/text في health', !rawHealth.includes('"replyText"') && !rawHealth.includes('"attentionRequired"') && !rawHealth.includes('"authorName"'));
    const healthJson = JSON.parse(rawHealth);
    check('كتلة metaPolling العامة موجودة', healthJson.metaPolling && typeof healthJson.metaPolling === 'object');
    check('metaPolling العامة حقول تقنية فقط', Object.keys(healthJson.metaPolling).every((k) => ['status', 'watcherActive', 'cadenceMinutes', 'pollCount', 'lastPollAt', 'lastError', 'consecutiveErrors', 'note'].includes(k)));
    const readinessJson = JSON.parse(rawReadiness);
    check('readiness يحمل كتلة metaPolling عامة', readinessJson.metaPolling && Object.keys(readinessJson.metaPolling).every((k) => ['status', 'watcherActive', 'cadenceMinutes', 'pollCount', 'lastPollAt', 'lastError', 'consecutiveErrors', 'note'].includes(k)));
    check('لا تسريب أي سرّ في الصحة', !rawHealth.includes(FB_APP_SECRET) && !rawHealth.includes('PAGE_TOKEN_TEST') && !rawHealth.includes('USER_TOKEN_TEST_LONG'));

    group('13) تكامل: الثبات بعد restart');
    await stop(app.proc);
    app = startApp(mock.base);
    check('الخادم يقلع بعد restart', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());
    const w2 = await (await fetch(`${BASE}/api/agent/meta/watcher`, { headers: auth })).json();
    check('سجل المعالجة صمد بعد restart', w2.watcher?.processedCount >= 2, `processed=${w2.watcher?.processedCount}`);
    check('التحكم (autoReply) صمد بعد restart', w2.watcher?.controls?.autoReply === true);
    check('منع التكرار صمد: لا رد مكرر بعد restart', mock.state.commentReplies.length === 1, `replies=${mock.state.commentReplies.length}`);
  } finally {
    await stop(app.proc);
    await mock.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

/**
 * اختبار مركّز مستقل: يثبت أن حارس المعدّل يمنع الإرسال الزائد فعلاً على مستوى
 * المنفّذ — بحدّ = عملية خارجية واحدة، يُرسل رد واحد فقط ويُحجب الباقي بـ429 بلا
 * إرسال. خادم وحالة معزولان (لا يمسّان اختبار الانحدار أعلاه).
 */
async function rateLimitIntegrationTest(): Promise<void> {
  const rlStateDir = mkdtempSync(join(tmpdir(), 'gharabi-meta-ratelimit-'));
  const rlMock = await startFacebookMockServer(FB_PORT, createFacebookMock({
    feedPosts: [{ id: 'RLPOST', comments: [
      { id: 'RL_C1', message: 'عاشت إيدكم على الخدمة', from: { id: 'R1', name: 'عميل١' }, created_time: '2026-01-01T00:00:00+0000' },
      { id: 'RL_C2', message: 'خدمة ممتازة شكراً لكم', from: { id: 'R2', name: 'عميل٢' }, created_time: '2026-01-01T00:01:00+0000' },
    ] }],
  }));
  const app = startApp(rlMock.base, { YOUTUBE_OP_RATE_LIMIT: '1' }, rlStateDir);
  try {
    check('خادم اختبار المعدّل يقلع', await waitForHealth(), app.log().slice(0, 300));
    const auth = { 'Content-Type': 'application/json', ...(await login()) };
    const startRes = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const st = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
    await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(st)}&code=TESTCODE`);
    await fetch(`${BASE}/api/agent/meta/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ autoReply: true }) });
    group('14) تكامل: حدّ المعدّل يمنع الإرسال الزائد (لا over-send)');
    await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' });
    check('أُرسل رد واحد فقط بالرغم من تعليقين (الحد=1)', rlMock.state.commentReplies.length === 1, `replies=${rlMock.state.commentReplies.length}`);
    const w = await (await fetch(`${BASE}/api/agent/meta/watcher`, { headers: auth })).json();
    const failedByRate = (w.watcher?.recent || []).find((r: any) => r.stage === 'FAILED' && /حد معدّل/.test(String(r.reason || '')));
    const repliedCount = (w.watcher?.recent || []).filter((r: any) => r.stage === 'REPLIED').length;
    check('التعليق الزائد حُجب بحدّ المعدّل (FAILED بسبب الحد، بلا إرسال)', Boolean(failedByRate), JSON.stringify((w.watcher?.recent || []).map((r: any) => [r.commentId, r.stage, r.reason])));
    check('رد واحد فقط سُجِّل كمُسلَّم (الباقي محجوب)', repliedCount === 1 && rlMock.state.commentReplies.length === 1, `replied=${repliedCount} sent=${rlMock.state.commentReplies.length}`);
  } finally {
    await stop(app.proc);
    await rlMock.stop();
    rmSync(rlStateDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await unitTests();
  await integrationTests();
  await rateLimitIntegrationTest();
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} — passed ${passed}`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} meta watcher checks`);
}
void main();
