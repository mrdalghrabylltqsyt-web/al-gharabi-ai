/**
 * اختبار مراقب الردود لـ Telegram (Telegram Reply Watcher).
 *
 * طبقتان:
 *  1) وحدة: منطق القرار/البوابة/التحكم الحتمي (يستهلك نفس محرّك YouTube — سلطة
 *     قرار واحدة) بلا شبكة.
 *  2) تكامل: الخادم الحقيقي + خادم Telegram وهمي محلي عبر TELEGRAM_API_BASE:
 *     ضبط الموصل، استقبال رسالة عبر webhook موثّق، التأجيل عند تعطيل الرد الآلي
 *     (fail-closed)، التحرير عند التمكين، الرد الحقيقي (بمعرّف من Telegram)، منع
 *     التكرار، التصريح (401/403)، خلو /api/health و/api/readiness من بيانات
 *     العملاء، والثبات بعد restart.
 *
 * لا يلمس أي مزود Telegram حقيقي ولا يستهلك حصة، ولا يستخدم أي سرّ واقعي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import {
  TELEGRAM_WATCHER_PLATFORMS,
  defaultTelegramPollingState,
  normalizeTelegramPollingState,
  telegramWatcherGate,
  decideTelegramCommentAction,
  resolveTelegramReplyExecution,
  isDeferredDecision,
  releaseDeferredEntries,
  telegramPollingPublicBlock,
  telegramExecutionDecisionFromCentral,
} from '../social/telegramWatcher';
import { capabilityRow } from '../brain/strategy/capabilityMatrix';
import { createTelegramMock, startTelegramMockServer } from './helpers/telegramMock';
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
const APP_PORT = 7560 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const TG_PORT = 7660 + Math.floor(Math.random() * 100);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'telegram-watcher-test-secret-not-real';
const BOT_TOKEN = '111222333:TEST_BOT_TOKEN_NOT_REAL';
const WEBHOOK_SECRET = 'test_webhook_secret_1234567890';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-telegram-watcher-'));

const secretBuffer = createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const staffUser = { id: 'staff-1', name: 'موظف اختبار', email: 'staff@example.invalid', role: 'staff', roleTitleArabic: 'الموظف', avatar: '', active: true, createdAt: new Date().toISOString() };

function startApp(tgBase: string, stateDirOverride: string = stateDir): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDirOverride,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    TELEGRAM_API_BASE: tgBase,
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
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
function tgUpdate(updateId: number, messageId: number, text: string, chatId: number, fromId = 3, firstName = 'سالم', lastName?: string) {
  const from: any = { id: fromId, first_name: firstName };
  if (lastName) from.last_name = lastName;
  return { update_id: updateId, message: { message_id: messageId, date: 1700000000, text, chat: { id: chatId }, from } };
}
async function postWebhook(body: any) {
  return fetch(`${BASE}/api/platforms/telegram/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET }, body: JSON.stringify(body),
  });
}

async function unitTests(): Promise<void> {
  group('1) وحدة: مصدر واحد للقرار (نفس محرّك YouTube) + أمان افتراضي fail-closed');
  const d = defaultTelegramPollingState();
  check('المنصة المشمولة = telegram', TELEGRAM_WATCHER_PLATFORMS.length === 1 && TELEGRAM_WATCHER_PLATFORMS[0] === 'telegram');
  check('الرد الآلي معطّل افتراضياً (fail-closed)', d.controls.autoReply === false);
  check('المراقبة مفعّلة افتراضياً (قراءة/تحليل)', d.controls.enabled === true && d.controls.paused === false);
  check('الفاصل الافتراضي = 5 دقائق', d.controls.cadenceMinutes === 5);

  group('2) وحدة: بوابة الأتمتة (Kill Switch يمنع الكل)');
  check('قراءة مسموحة افتراضياً', telegramWatcherGate(d.controls, 'read').allowed === true);
  check('رد ممنوع افتراضياً (autoReply معطّل)', telegramWatcherGate(d.controls, 'reply').allowed === false && telegramWatcherGate(d.controls, 'reply').code === 'AUTO_REPLY_DISABLED');
  check('Kill Switch يمنع الإرسال ويُبقي القراءة (PR-A)', telegramWatcherGate({ ...d.controls, paused: true }, 'reply').allowed === false && telegramWatcherGate({ ...d.controls, paused: true }, 'reply').code === 'AUTOMATION_PAUSED' && telegramWatcherGate({ ...d.controls, paused: true }, 'read').allowed === true);
  check('الرد مسموح عند التمكين', telegramWatcherGate({ ...d.controls, autoReply: true }, 'reply').allowed === true);

  group('3) وحدة: القرار الاستشاري الحتمي (تصنيف حقيقي)');
  const self = decideTelegramCommentAction({ intent: 'praise', requiresHumanReview: false, isSpam: false, isSelfAuthored: true, alreadyReplied: false, controls: d.controls });
  check('رسالة حساب المعرض => تجاهل', self.action === 'skip' && self.code === 'SKIP_SELF_AUTHORED');
  const price = decideTelegramCommentAction({ intent: 'business_inquiry', requiresHumanReview: true, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: { ...d.controls, autoReply: true } });
  check('استفسار سعر => تصعيد (لا اختراع سعر)', price.action === 'escalate' && price.code === 'ESCALATE_BUSINESS_INQUIRY');
  const complaint = decideTelegramCommentAction({ intent: 'complaint', requiresHumanReview: true, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: { ...d.controls, autoReply: true } });
  check('شكوى => تصعيد', complaint.action === 'escalate' && complaint.code === 'ESCALATE_SENSITIVE');
  const spam = decideTelegramCommentAction({ intent: 'spam', requiresHumanReview: false, isSpam: true, isSelfAuthored: false, alreadyReplied: false, controls: { ...d.controls, autoReply: true } });
  check('سبام => تجاهل', spam.action === 'skip' && spam.code === 'SKIP_SPAM');
  const praiseOff = decideTelegramCommentAction({ intent: 'praise', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: d.controls });
  check('مدح مع تعطيل الرد => تأجيل غير نهائي (لا فقدان)', praiseOff.action === 'skip' && praiseOff.code === 'DEFER_AUTOREPLY_DISABLED' && isDeferredDecision(praiseOff.code));

  group('4) وحدة: التأجيل والتحرير (لا فقدان رسالة)');
  const proc = [
    { commentId: 'A', stage: 'SKIPPED', action: 'skip', reason: '', code: 'DEFER_AUTOREPLY_DISABLED', at: new Date().toISOString(), deferred: true } as any,
    { commentId: 'B', stage: 'ESCALATED', action: 'escalate', reason: '', code: 'ESCALATE_SENSITIVE', at: new Date().toISOString() } as any,
  ];
  const rel = releaseDeferredEntries(proc);
  check('التحرير يُزيل المؤجَّل فقط', rel.released === 1 && rel.processed.length === 1 && rel.processed[0].commentId === 'B');

  group('5) وحدة: الكتلة العامة خالية من بيانات العملاء');
  const pub = telegramPollingPublicBlock({ ...d, lastError: 'customer wrote a long arabic sentence' } as any);
  const allowedKeys = ['status', 'watcherActive', 'cadenceMinutes', 'pollCount', 'lastPollAt', 'lastError', 'consecutiveErrors', 'note', 'deferred', 'deferredReason', 'lastDeferredAt', 'stale', 'staleReason', 'missedCycles'];
  check('الحقول تقنية فقط', Object.keys(pub).every((k) => allowedKeys.includes(k)));
  check('رسالة الخطأ الحرة تُنقّى (لا نص عميل)', pub.lastError === 'connection error');

  group('6) وحدة: سلطة التنفيذ الوحيدة (لا رد بلا تمكين + جاهزية)');
  const allowedNoEnable = telegramExecutionDecisionFromCentral('APPROVAL_REQUIRED', false);
  check('APPROVAL_REQUIRED بلا تمكين => NO_ACTION', allowedNoEnable === 'NO_ACTION');
  check('APPROVAL_REQUIRED مع تمكين => ALLOWED_ACTION', telegramExecutionDecisionFromCentral('APPROVAL_REQUIRED', true) === 'ALLOWED_ACTION');
  check('HUMAN_ESCALATION => FAILED_SAFE (لا إرسال)', telegramExecutionDecisionFromCentral('HUMAN_ESCALATION', true) === 'FAILED_SAFE');
  const replyNotReady = resolveTelegramReplyExecution({ centralDecision: 'ALLOWED_ACTION', advisory: { action: 'reply', code: 'REPLY_ALLOWED', reason: '', requiresHuman: false } as any, automationAllowed: true, replyReady: false, belongsToChannel: true, isPraise: true, humanReviewMode: false, centralEscalationReason: null, priceFactsVerified: false });
  check('لا رد بلا جاهزية تنفيذ (تصعيد)', replyNotReady.action === 'escalate' && replyNotReady.code === 'ESCALATE_REPLY_NOT_READY');
  const replyOk = resolveTelegramReplyExecution({ centralDecision: 'ALLOWED_ACTION', advisory: { action: 'reply', code: 'REPLY_ALLOWED', reason: '', requiresHuman: false } as any, automationAllowed: true, replyReady: true, belongsToChannel: true, isPraise: true, humanReviewMode: false, centralEscalationReason: null, priceFactsVerified: false });
  check('الرد يُسمح عند اكتمال البوابات', replyOk.action === 'reply' && replyOk.code === 'REPLY_ALLOWED');

  group('7) وحدة: مصفوفة القدرات تُعلن message_reply لـTelegram (لا reply عام)');
  check('Telegram: message_reply AVAILABLE', capabilityRow('telegram').states.message_reply === 'AVAILABLE');
  check('Telegram: reply (تعليقات عامة) NOT_AVAILABLE', capabilityRow('telegram').states.reply === 'NOT_AVAILABLE');
  check('Telegram: comments NOT_AVAILABLE', capabilityRow('telegram').states.comments === 'NOT_AVAILABLE');
}

async function integrationTests(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  const mock = await startTelegramMockServer(TG_PORT, createTelegramMock());
  // PR-A: هذا الاختبار يقيس مسار الإرسال التلقائي، فيضبط وضع الإرسال `auto`
  // صراحةً (الافتراضي الآن `approval` fail-closed يحجب الإرسال الآلي).
  writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify({ leads: [], sendMode: 'auto' }, null, 2), 'utf8');
  let app = startApp(mock.base);
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());
    const staffToken = signSession({ uid: 'staff-1', iat: Date.now(), exp: Date.now() + 3_600_000, sid: randomBytes(8).toString('hex') }, secretBuffer);
    const staffAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` };

    group('8) تكامل: التصريح — مسارات مراقب Telegram محمية (owner فقط)');
    check('/api/agent/telegram/watcher بلا جلسة => 401', (await fetch(`${BASE}/api/agent/telegram/watcher`)).status === 401);
    check('/api/agent/telegram/watcher لغير المالك => 403', (await fetch(`${BASE}/api/agent/telegram/watcher`, { headers: staffAuth })).status === 403);
    check('/poll بلا جلسة => 401', (await fetch(`${BASE}/api/agent/telegram/watcher/poll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 401);
    check('/controls لغير المالك => 403', (await fetch(`${BASE}/api/agent/telegram/watcher/controls`, { method: 'POST', headers: staffAuth, body: '{}' })).status === 403);

    group('9) تكامل: ضبط موصل Telegram (getMe + setWebhook حقيقيان)');
    const configure = await fetch(`${BASE}/api/platforms/telegram/configure`, { method: 'POST', headers: auth, body: JSON.stringify({}) });
    const configureBody = await configure.json();
    check('الضبط ينجح بموثق', configure.status === 200 && configureBody.verified === true, JSON.stringify(configureBody).slice(0, 200));
    check('سُجّل webhook حقيقي لدى المزود', mock.state.webhookUrl === `${BASE}/api/platforms/telegram/webhook`);

    group('10) تكامل: استقبال رسالة حقيقية عبر webhook');
    const inbound = await postWebhook(tgUpdate(201, 20, 'عاشت إيدكم على الخدمة', -100777, 3, 'سالم'));
    const inboundBody = await inbound.json();
    check('تحديث موثّق => 200 ومقبول', inbound.status === 200 && inboundBody.accepted === true);
    check('الاستجابة تؤكد الكتابة الدائمة قبل الإقرار', inboundBody.persisted === true);

    group('11) تكامل: دورة مراقبة مع تعطيل الرد (تأجيل بلا إرسال — fail-closed)');
    const poll1 = await (await fetch(`${BASE}/api/agent/telegram/watcher/poll`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الدورة تعمل وتُعلن الاتصال', poll1.success === true && poll1.result?.connected === true, JSON.stringify(poll1.result));
    check('لا رسالة أُرسلت مع تعطيل الرد الآلي', mock.state.sent.length === 0, `sent=${mock.state.sent.length}`);
    check('الرسالة القابلة للرد أُجّلت (غير نهائي)', (poll1.result?.deferred || 0) >= 1, JSON.stringify(poll1.result));
    const w1 = await (await fetch(`${BASE}/api/agent/telegram/watcher`, { headers: auth })).json();
    check('حالة المالك تعرض سجل المعالجة (kind=message)', w1.watcher?.processedCount >= 1 && (w1.watcher?.recent || []).some((r: any) => r.kind === 'message'));
    check('المراقبة مفعّلة لكن الرد غير فعّال (fail-closed)', w1.watcher?.controls?.autoReply === false && w1.watcher?.controls?.autoReplyEffective === false);

    group('12) تكامل: تمكين الرد => تحرير المؤجَّل');
    const ctrl = await (await fetch(`${BASE}/api/agent/telegram/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ autoReply: true }) })).json();
    check('تمكين الرد ينجح', ctrl.success === true && ctrl.controls?.autoReply === true);
    check('يُعلن عدد المؤجَّل المحرَّر', ctrl.releasedDeferred >= 1, `released=${ctrl.releasedDeferred}`);
    const badCadence = await fetch(`${BASE}/api/agent/telegram/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ cadenceMinutes: 9 }) });
    check('فاصل غير صالح => 400 INVALID_CADENCE', badCadence.status === 400 && (await badCadence.json()).code === 'INVALID_CADENCE');

    group('13) تكامل: الرد الحقيقي (بمعرّف من Telegram) + منع التكرار');
    const poll2 = await (await fetch(`${BASE}/api/agent/telegram/watcher/poll`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('أُرسلت رسالة واحدة فعلية لخادم Telegram', mock.state.sent.length === 1, `sent=${mock.state.sent.length}`);
    check('أُرسلت للدردشة الصحيحة', mock.state.sent[0]?.chatId === '-100777', JSON.stringify(mock.state.sent[0]));
    check('نص الرد عراقي حقيقي (غير فارغ)', typeof mock.state.sent[0]?.text === 'string' && mock.state.sent[0].text.trim().length > 0);
    check('الدورة أعلنت الرد المُسلَّم', (poll2.result?.replied || 0) >= 1, JSON.stringify(poll2.result));
    const w2 = await (await fetch(`${BASE}/api/agent/telegram/watcher`, { headers: auth })).json();
    check('سجل المعالجة يحمل REPLIED بمعرّف رسالة حقيقي', (w2.watcher?.recent || []).some((r: any) => r.stage === 'REPLIED' && typeof r.externalReplyId === 'string' && r.externalReplyId.length > 0), JSON.stringify((w2.watcher?.recent || []).map((r: any) => [r.stage, r.externalReplyId])));
    await fetch(`${BASE}/api/agent/telegram/watcher/poll`, { method: 'POST', headers: auth, body: '{}' });
    check('لا رد مكرر عند إعادة الدورة', mock.state.sent.length === 1, `sent=${mock.state.sent.length}`);

    group('14) تكامل: حساب المعرض لا يُرد عليه (منع الحلقة)');
    await postWebhook(tgUpdate(202, 21, 'عرض جديد اليوم', -100777, 1, 'معرض', 'الغرابي'));
    await fetch(`${BASE}/api/agent/telegram/watcher/poll`, { method: 'POST', headers: auth, body: '{}' });
    const w3 = await (await fetch(`${BASE}/api/agent/telegram/watcher`, { headers: auth })).json();
    check('رسالة حساب المعرض تُجوهل (SKIP_SELF_AUTHORED)', (w3.watcher?.recent || []).some((r: any) => r.code === 'SKIP_SELF_AUTHORED'), JSON.stringify((w3.watcher?.recent || []).map((r: any) => [r.commentId, r.code])));
    check('لا رد على حساب المعرض', mock.state.sent.length === 1, `sent=${mock.state.sent.length}`);

    group('15) تكامل: النقطتان العامتان خاليتان من بيانات العملاء');
    const rawHealth = await (await fetch(`${BASE}/api/health`)).text();
    const rawReadiness = await (await fetch(`${BASE}/api/readiness`)).text();
    check('health لا يحمل نص رسالة عميل', !rawHealth.includes('عاشت إيدكم') && !rawHealth.includes('عرض جديد اليوم'));
    check('readiness لا يحمل نص رسالة عميل', !rawReadiness.includes('عاشت إيدكم'));
    check('لا حقل replyText/attentionRequired/authorName في health', !rawHealth.includes('"replyText"') && !rawHealth.includes('"attentionRequired"') && !rawHealth.includes('"authorName"'));
    const healthJson = JSON.parse(rawHealth);
    const allowedKeys = ['status', 'watcherActive', 'cadenceMinutes', 'pollCount', 'lastPollAt', 'lastError', 'consecutiveErrors', 'note', 'deferred', 'deferredReason', 'lastDeferredAt', 'stale', 'staleReason', 'missedCycles'];
    check('كتلة telegramPolling العامة موجودة', healthJson.telegramPolling && typeof healthJson.telegramPolling === 'object');
    check('telegramPolling العامة حقول تقنية فقط', Object.keys(healthJson.telegramPolling).every((k) => allowedKeys.includes(k)));
    const readinessJson = JSON.parse(rawReadiness);
    check('readiness يحمل كتلة telegramPolling عامة', readinessJson.telegramPolling && Object.keys(readinessJson.telegramPolling).every((k) => allowedKeys.includes(k)));
    check('لا تسريب أي سرّ في الصحة', !rawHealth.includes(BOT_TOKEN) && !rawHealth.includes(WEBHOOK_SECRET));

    group('16) تكامل: الثبات بعد restart');
    await stop(app.proc);
    app = startApp(mock.base);
    check('الخادم يقلع بعد restart', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());
    const w4 = await (await fetch(`${BASE}/api/agent/telegram/watcher`, { headers: auth })).json();
    check('سجل المعالجة صمد بعد restart', w4.watcher?.processedCount >= 2, `processed=${w4.watcher?.processedCount}`);
    check('التحكم (autoReply) صمد بعد restart', w4.watcher?.controls?.autoReply === true);
    check('منع التكرار صمد: لا رد مكرر بعد restart', mock.state.sent.length === 1, `sent=${mock.state.sent.length}`);
  } finally {
    await stop(app.proc);
    await mock.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await unitTests();
  await integrationTests();
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} — passed ${passed}`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} telegram watcher checks`);
}
void main();
