/**
 * اختبارات موصل Telegram الحقيقي (Batch 5) — أول تكامل اجتماعي خارجي فعلي.
 *
 * طبقتان:
 *  1) وحدة: الدوال الحتمية (التحقق من السرّ، تحليل التحديث، منع التكرار، بناء الطلب).
 *  2) تكامل: الخادم الحقيقي مع خادم Telegram وهمي محلي عبر TELEGRAM_API_BASE،
 *     فيُختبر: الضبط (getMe+setWebhook)، Webhook (تحقق/تكرار/تخزين)، التصنيف،
 *     الإرسال الحقيقي، منع الرد المكرر، سلامة المحتوى، والتصريح.
 *
 * لا يلمس أي مزود حقيقي ولا يستهلك أي حصة، ولا يستخدم أي سرّ واقعي.
 */

import express from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  parseTelegramUpdate,
  verifyTelegramSecret,
  constantTimeEqual,
  isDuplicateUpdate,
  telegramExternalId,
  buildSendMessageBody,
  telegramApiUrl,
  sanitizeWebhookInfo,
  checkWebhookRegistration,
} from '../social/telegram';
import { createTelegramMock, startTelegramMockServer } from './helpers/telegramMock';

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
const APP_PORT = 5860 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const TG_PORT = 6100 + Math.floor(Math.random() * 200);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'telegram-connector-test-secret-not-real';
const BOT_TOKEN = '111222333:TEST_BOT_TOKEN_NOT_REAL';
const WEBHOOK_SECRET = 'test_webhook_secret_1234567890';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-telegram-'));

function startApp(tgBase: string): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    // خادم Telegram وهمي محلي: لا اتصال بمزود حقيقي في الاختبارات.
    TELEGRAM_API_BASE: tgBase,
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    // مفتاح تشفير اختباري فقط (32 بايت hex) — ليس سراً واقعياً.
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
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
async function login(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
  });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}

function unitTests(): void {
  group('1) وحدة: التحقق من السرّ بزمن ثابت');
  check('سرّ غائب => رفض', !verifyTelegramSecret({ header: undefined, expectedSecret: 'abc' }).ok);
  check('سرّ غير مضبوط => رفض (لا قبول بلا تحقق)', !verifyTelegramSecret({ header: 'abc', expectedSecret: '' }).ok);
  check('سرّ مطابق => قبول', verifyTelegramSecret({ header: 'abc', expectedSecret: 'abc' }).ok);
  check('سرّ مختلف => رفض', !verifyTelegramSecret({ header: 'abd', expectedSecret: 'abc' }).ok);
  check('طول مختلف => رفض', !verifyTelegramSecret({ header: 'ab', expectedSecret: 'abc' }).ok);
  check('constantTimeEqual يرفض الفارغ', !constantTimeEqual('', ''));
  check('constantTimeEqual يقبل المتساوي', constantTimeEqual('xyz', 'xyz'));

  group('2) وحدة: تحليل التحديث الوارد');
  const upd = { update_id: 5, message: { message_id: 42, date: 1700000000, text: '  بكم سعر الثلاجة؟  ', chat: { id: -100123 }, from: { id: 7, first_name: 'أحمد', last_name: 'علي' } } };
  const parsed = parseTelegramUpdate(upd as any);
  check('يحلل رسالة نصية', parsed !== null && parsed.chatId === '-100123' && parsed.messageId === '42');
  check('ينظّف النص', parsed?.text === 'بكم سعر الثلاجة؟');
  check('يجمع اسم الكاتب', parsed?.authorName === 'أحمد علي');
  check('يرفض تحديثاً بلا نص', parseTelegramUpdate({ update_id: 1, message: { message_id: 2, chat: { id: 3 } } } as any) === null);
  check('يرفض تحديثاً بلا update_id', parseTelegramUpdate({ message: { message_id: 2, text: 'x', chat: { id: 3 } } } as any) === null);
  check('يرفض modified/channel posts كرسالة نصية', parseTelegramUpdate({ update_id: 1, edited_message: {} } as any) === null);

  group('3) وحدة: منع التكرار والمعرّف الخارجي');
  const ext = telegramExternalId('-100123', '42');
  check('المعرّف الخارجي مركّب من الدردشة والرسالة', ext === 'tg:-100123:42');
  check('نفس update_id => مكرر', isDuplicateUpdate({ updateId: 5, externalId: ext, seenUpdateIds: [5], seenExternalIds: [] }));
  check('نفس externalId => مكرر', isDuplicateUpdate({ updateId: 9, externalId: ext, seenUpdateIds: [], seenExternalIds: [ext] }));
  check('جديد => غير مكرر', !isDuplicateUpdate({ updateId: 6, externalId: telegramExternalId('-1', '9'), seenUpdateIds: [5], seenExternalIds: [ext] }));

  group('4) وحدة: بناء طلب الإرسال والرابط');
  const body = buildSendMessageBody({ chatId: '-100123', text: 'مرحباً', replyToMessageId: '42' });
  check('الطلب يحمل chat_id والنص', body.chat_id === '-100123' && body.text === 'مرحباً');
  check('reply_to_message_id رقمي عند صلاحيته', body.reply_to_message_id === 42);
  check('معاينة الروابط معطلة (بلا مظهر سبام)', (body.link_preview_options as any)?.is_disabled === true);
  check('الرابط يستخدم القاعدة الافتراضية', telegramApiUrl('getMe', 'tok').startsWith('https://api.telegram.org/bot'));
  check('الرابط يقبل قاعدة مخصّصة للاختبار', telegramApiUrl('getMe', 'tok', 'http://127.0.0.1:9999') === 'http://127.0.0.1:9999/bottok/getMe');

  group('4b) وحدة: تنقية getWebhookInfo وتقييم التسجيل');
  const info = sanitizeWebhookInfo({ ok: true, result: { url: 'https://x/api/platforms/telegram/webhook', pending_update_count: 3, last_error_date: 1700000000, last_error_message: 'boom', max_connections: 40, allowed_updates: ['message'], secret_token: 'SHOULD_NOT_SURVIVE' } });
  check('ينقّي الرابط والعدّاد', info.url === 'https://x/api/platforms/telegram/webhook' && info.pendingUpdateCount === 3);
  check('يحوّل خطأ الدفع إلى ISO', info.lastErrorDate === new Date(1700000000 * 1000).toISOString() && info.lastErrorMessage === 'boom');
  check('لا يحمل أي سرّ في الناتج', !JSON.stringify(info).includes('SHOULD_NOT_SURVIVE') && !JSON.stringify(info).includes('secret'));
  check('يقيّم registered عند التطابق', checkWebhookRegistration({ info, expectedUrl: 'https://x/api/platforms/telegram/webhook', secretConfigured: true }).status === 'registered');
  check('يقيّم url_mismatch عند اختلاف الرابط', checkWebhookRegistration({ info, expectedUrl: 'https://y/api/platforms/telegram/webhook', secretConfigured: true }).status === 'url_mismatch');
  check('يقيّم secret_missing بلا سرّ', checkWebhookRegistration({ info, expectedUrl: 'https://x/api/platforms/telegram/webhook', secretConfigured: false }).status === 'secret_missing');
  const noUrl = sanitizeWebhookInfo({ ok: true, result: { url: '' } });
  check('يقيّم not_registered بلا رابط', checkWebhookRegistration({ info: noUrl, expectedUrl: 'https://x', secretConfigured: true }).status === 'not_registered');
  const badInfo = sanitizeWebhookInfo({ ok: false, description: 'x' });
  check('يقيّم unavailable عند فشل الاستعلام', checkWebhookRegistration({ info: badInfo, expectedUrl: 'https://x', secretConfigured: true }).status === 'unavailable');
}

async function integrationTests(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  const mock = await startTelegramMockServer(TG_PORT, createTelegramMock());
  const app = startApp(mock.base);
  let currentApp = app;
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());

    group('5) تكامل: ضبط الموصل (getMe + setWebhook حقيقيان)');
    const configureNoAuth = await fetch(`${BASE}/api/platforms/telegram/configure`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    check('الضبط بلا جلسة => 401', configureNoAuth.status === 401);
    const configure = await fetch(`${BASE}/api/platforms/telegram/configure`, { method: 'POST', headers: auth, body: JSON.stringify({}) });
    const configureBody = await configure.json();
    check('الضبط يستخدم رمز البيئة وينجح', configure.status === 200 && configureBody.verified === true, JSON.stringify(configureBody).slice(0, 200));
    check('سُجّل webhook حقيقي لدى المزود', mock.state.webhookUrl === `${BASE}/api/platforms/telegram/webhook`);
    check('الـwebhook يحمل السرّ الصحيح', mock.state.webhookSecret === WEBHOOK_SECRET);
    check('لا يُعاد الرمز ولا السرّ في الاستجابة', !JSON.stringify(configureBody).includes(BOT_TOKEN) && !JSON.stringify(configureBody).includes(WEBHOOK_SECRET));
    check('الضبط يُثبت التسجيل عبر getWebhookInfo', configureBody.webhook?.status === 'registered' && configureBody.webhook?.verified === true);
    check('سُجّل رابط الاستقبال لمنع الانحراف', configureBody.webhook?.url === `${BASE}/api/platforms/telegram/webhook`);

    // إعادة الضبط بلا سرّ في الجسم يجب ألا تدوّر السرّ المحفوظ (يمنع انفصال السرّ).
    const reconfigure = await fetch(`${BASE}/api/platforms/telegram/configure`, { method: 'POST', headers: auth, body: JSON.stringify({}) });
    const reconfigureBody = await reconfigure.json();
    check('إعادة الضبط لا تدوّر السرّ المحفوظ', mock.state.webhookSecret === WEBHOOK_SECRET && reconfigureBody.verified === true);

    group('5b) تكامل: حالة webhook الحقيقية (getWebhookInfo)');
    const infoNoAuth = await fetch(`${BASE}/api/platforms/telegram/webhook-info`);
    check('حالة webhook بلا جلسة => 401', infoNoAuth.status === 401);
    const infoRes = await fetch(`${BASE}/api/platforms/telegram/webhook-info`, { headers: auth });
    const infoBody = await infoRes.json();
    check('حالة webhook متاحة للمالك وتُعلن registered', infoRes.status === 200 && infoBody.status === 'registered' && infoBody.matchesExpectedUrl === true, JSON.stringify(infoBody).slice(0, 200));
    check('حالة webhook لا تكشف أي سرّ', !JSON.stringify(infoBody).includes(BOT_TOKEN) && !JSON.stringify(infoBody).includes(WEBHOOK_SECRET));
    check('حالة webhook تُعلن مصدر السرّ محفوظاً', infoBody.webhookSecretConfigured === true && infoBody.secretSource === 'stored');

    const health = await (await fetch(`${BASE}/api/platforms/telegram/health`, { headers: auth })).json();
    check('فحص الصحة يؤكد الاتصال عبر getMe', health.healthy === true && health.accountId === String(mock.state.botId));

    group('6) تكامل: Webhook — تحقق ومصدر موثوق');
    const badSecret = await fetch(`${BASE}/api/platforms/telegram/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': 'wrong' },
      body: JSON.stringify({ update_id: 100, message: { message_id: 1, text: 'مرحبا', chat: { id: 55 }, from: { id: 1, first_name: 'x' } } }),
    });
    check('تحديث بسرّ خاطئ => 401', badSecret.status === 401);
    const noSecret = await fetch(`${BASE}/api/platforms/telegram/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ update_id: 100, message: { message_id: 1, text: 'مرحبا', chat: { id: 55 } } }),
    });
    check('تحديث بلا سرّ => 401', noSecret.status === 401);
    check('لا يُخزَّن أي شيء من payload مزيف', (await (await fetch(`${BASE}/api/social/manager/comments?platform=telegram`, { headers: auth })).json()).count === 0);

    group('7) تكامل: Webhook — استقبال حقيقي ثم تصنيف وتخزين');
    const inbound = await fetch(`${BASE}/api/platforms/telegram/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      body: JSON.stringify({ update_id: 101, message: { message_id: 7, date: 1700000000, text: 'بكم سعر الغسالة بالتقسيط؟', chat: { id: -100777 }, from: { id: 3, first_name: 'سالم' } } }),
    });
    const inboundBody = await inbound.json();
    check('تحديث موثوق => 200 ومقبول', inbound.status === 200 && inboundBody.accepted === true);
    check('الاستجابة تؤكد الكتابة الدائمة قبل الإقرار', inboundBody.persisted === true);
    check('السجل يحمل دليل الاستقبال بلا سرّ', /\[telegram-webhook\].*outcome=accepted.*update_id=101/.test(app.log()), app.log().slice(-300));
    const comments = await (await fetch(`${BASE}/api/social/manager/comments?platform=telegram`, { headers: auth })).json();
    check('الرسالة خُزّنت كتعليق حقيقي', comments.count === 1 && comments.comments[0].externalId === 'tg:-100777:7');
    check('التصنيف حتمي ولا يحتاج مراجعة (استفسار تجاري)', comments.comments[0].classification.intent === 'business_inquiry' && comments.comments[0].requiresHumanReview === false);

    group('8) تكامل: منع تكرار الحدث (replay/idempotency)');
    const replay = await fetch(`${BASE}/api/platforms/telegram/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      body: JSON.stringify({ update_id: 101, message: { message_id: 7, text: 'بكم سعر الغسالة بالتقسيط؟', chat: { id: -100777 }, from: { id: 3, first_name: 'سالم' } } }),
    });
    const replayBody = await replay.json();
    check('إعادة نفس التحديث => duplicate', replayBody.duplicate === true);
    const commentsAfter = await (await fetch(`${BASE}/api/social/manager/comments?platform=telegram`, { headers: auth })).json();
    check('لا سجل مكرر بعد replay', commentsAfter.count === 1);

    group('9) تكامل: الإرسال الحقيقي (Reply pipeline)');
    const replyNoAuth = await fetch(`${BASE}/api/platforms/telegram/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    check('الإرسال بلا جلسة => 401', replyNoAuth.status === 401);
    const reply = await fetch(`${BASE}/api/platforms/telegram/reply`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ externalId: 'tg:-100777:7', text: 'أهلاً بك، شكراً لتواصلك معنا، فريق المعرض في خدمتك.', commentText: 'بكم سعر الغسالة بالتقسيط؟' }),
    });
    const replyBody = await reply.json();
    check('الإرسال الحقيقي نجح', reply.status === 200 && replyBody.delivered === true && replyBody.simulated === false, JSON.stringify(replyBody).slice(0, 200));
    check('وصلت رسالة فعلية للخادم الوهمي', mock.state.sent.length === 1 && mock.state.sent[0].chatId === '-100777');
    check('الرد مُثبّت بمعرّف رسالة من المزود', Boolean(replyBody.providerReplyId));
    check('الرد موجّه كردّ على الرسالة الأصلية', mock.state.sent[0]?.replyToMessageId === '7');

    group('10) تكامل: منع الرد المكرر على نفس التعليق');
    const dupReply = await fetch(`${BASE}/api/platforms/telegram/reply`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ externalId: 'tg:-100777:7', text: 'رد ثانٍ مختلف', commentText: 'بكم سعر الغسالة بالتقسيط؟' }),
    });
    check('الرد مرة ثانية على نفس التعليق => 409', dupReply.status === 409);
    check('لم تُرسل رسالة ثانية', mock.state.sent.length === 1);

    group('11) تكامل: سلامة المحتوى ومنع الحساس والسبام');
    // تعليق جديد حساس (شكوى) => لا رد آلي.
    await fetch(`${BASE}/api/platforms/telegram/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      body: JSON.stringify({ update_id: 102, message: { message_id: 8, text: 'لدي شكوى على التأخير', chat: { id: -100777 }, from: { id: 4, first_name: 'زينب' } } }),
    });
    const sensitiveReply = await fetch(`${BASE}/api/platforms/telegram/reply`, {
      method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'tg:-100777:8', text: 'سنحل الموضوع فوراً.', commentText: 'لدي شكوى على التأخير' }),
    });
    check('الشكوى => 422 مراجعة بشرية مطلوبة', sensitiveReply.status === 422);
    // رد يحمل سعراً غير مسجّل => حارس سلامة المحتوى يرفض.
    await fetch(`${BASE}/api/platforms/telegram/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      body: JSON.stringify({ update_id: 103, message: { message_id: 9, text: 'هل متوفر لديكم؟', chat: { id: -100777 }, from: { id: 5, first_name: 'عمر' } } }),
    });
    const unsafeReply = await fetch(`${BASE}/api/platforms/telegram/reply`, {
      method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'tg:-100777:9', text: 'السعر 150000 دينار فقط!', commentText: 'هل متوفر لديكم؟' }),
    });
    const unsafeBody = await unsafeReply.json();
    check('رد بسعر غير مسجّل => 422 محجوب', unsafeReply.status === 422 && unsafeBody.contentSafety?.safe === false);
    check('لم يُرسل أي رد محجوب', mock.state.sent.length === 1);

    group('12) تكامل: رفض الإرسال بلا تعليق/هدف حقيقي');
    const unknown = await fetch(`${BASE}/api/platforms/telegram/reply`, {
      method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'tg:999:999', text: 'مرحبا' }),
    });
    check('لا إرسال بلا تعليق حقيقي => 404', unknown.status === 404);

    group('12b) تكامل: رد الرسائل (message_reply) منفصل عن تعليقات comment_reply');
    // Telegram رسالة لا تعليق عام: مسار التعليقات العام يوجّه صراحةً بدل منع مضلل.
    const commentRouteOnTelegram = await fetch(`${BASE}/api/social/manager/comments/reply`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ platform: 'telegram', externalId: 'tg:-100777:7', text: 'مرحبا', commentText: 'بكم السعر؟' }),
    });
    const commentRouteBody = await commentRouteOnTelegram.json();
    check('مسار تعليقات Telegram يعيد 409 مع توجيه message_reply (لا 501 مضلل)', commentRouteOnTelegram.status === 409 && commentRouteBody.code === 'MESSAGE_PLATFORM_NOT_COMMENT', JSON.stringify(commentRouteBody).slice(0, 200));
    check('التوجيه يذكر مسار الرسائل الحقيقي', String(commentRouteBody.replyRoute).includes('/api/platforms/telegram/reply'));

    group('12c) تكامل: فشل sendMessage لا يُسجَّل تسليماً');
    await fetch(`${BASE}/api/platforms/telegram/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      body: JSON.stringify({ update_id: 104, message: { message_id: 10, text: 'هل لديكم توصيل؟', chat: { id: -100777 }, from: { id: 6, first_name: 'ليلى' } } }),
    });
    // نُجبر فشل الإرسال عند المزود الوهمي: يجب ألا يُسجَّل delivered=true.
    mock.state.failSend = true;
    const failedReply = await fetch(`${BASE}/api/platforms/telegram/reply`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ externalId: 'tg:-100777:10', text: 'أهلاً بك، فريق المعرض في خدمتك.', commentText: 'هل لديكم توصيل؟' }),
    });
    const failedReplyBody = await failedReply.json();
    check('فشل المزود => 502', failedReply.status === 502, `status=${failedReply.status}`);
    check('فشل المزود لا يُعلن تسليماً', failedReplyBody.delivered === false && failedReplyBody.reply?.delivered === false);
    check('فشل المزود يخزّن سبباً حقيقياً', typeof failedReplyBody.reply?.deliveryError === 'string' && failedReplyBody.reply.reviewStatus === 'failed');
    check('لا معرّف مزود عند الفشل', !failedReplyBody.reply?.providerReplyId);
    mock.state.failSend = false;

    group('12d) تكامل: منع الرد على رسالة من حساب المعرض (self-authored)');
    await fetch(`${BASE}/api/platforms/telegram/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      body: JSON.stringify({ update_id: 105, message: { message_id: 11, text: 'عرض جديد اليوم', chat: { id: -100777 }, from: { id: 1, first_name: 'معرض', last_name: 'الغرابي' } } }),
    });
    const selfReply = await fetch(`${BASE}/api/platforms/telegram/reply`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ externalId: 'tg:-100777:11', text: 'شكراً لكم', commentText: 'عرض جديد اليوم' }),
    });
    check('الرد على رسالة حساب المعرض => 409 (منع حلقة)', selfReply.status === 409);

    group('13) تكامل: القطع يبطل طرف المزود');
    const disconnect = await fetch(`${BASE}/api/platforms/telegram/disconnect`, { method: 'POST', headers: auth });
    const disconnectBody = await disconnect.json();
    check('القطع ينجح ويحوّل إلى disconnected', disconnect.status === 200 && disconnectBody.connection.status === 'disconnected');
    check('حُذف webhook لدى المزود عند القطع', mock.state.webhookDeleted === true);
    // بعد حذف webhook لدى Telegram يجب أن تُعلن الحالة not_registered صراحةً.
    const infoAfterDisconnect = await (await fetch(`${BASE}/api/platforms/telegram/webhook-info`, { headers: auth })).json();
    check('حالة webhook بعد القطع => not_registered', infoAfterDisconnect.status === 'not_registered');
    const replyAfterDisconnect = await fetch(`${BASE}/api/platforms/telegram/reply`, {
      method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'tg:-100777:7', text: 'مرحبا' }),
    });
    check('لا إرسال بعد القطع => 409', replyAfterDisconnect.status === 409);

    group('14) تكامل: ثبات الاستقبال وحماية التكرار بعد restart');
    // نُعيد التشغيل بنفس مجلد الحالة: يجب أن يبقى التعليق ومعرّف التحديث وهدف الرد.
    await stop(app.proc);
    currentApp = startApp(mock.base);
    check('الخادم يقلع بعد إعادة التشغيل', await waitForHealth());
    Object.assign(auth, await login());
    const persistedComments = await (await fetch(`${BASE}/api/social/manager/comments?platform=telegram`, { headers: auth })).json();
    const persistedComment = persistedComments.comments.find((c: any) => c.externalId === 'tg:-100777:7');
    check('التعليق الوارد يبقى بعد restart', Boolean(persistedComment));
    check('هدف الرد الحقيقي (chatId/messageId) يبقى بعد restart', persistedComment?.replyTarget?.chatId === '-100777' && persistedComment?.replyTarget?.messageId === '7');
    check('المصدر يبقى telegram_webhook', persistedComment?.ingestSource === 'telegram_webhook');
    const replayAfterRestart = await fetch(`${BASE}/api/platforms/telegram/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      body: JSON.stringify({ update_id: 101, message: { message_id: 7, text: 'بكم سعر الغسالة بالتقسيط؟', chat: { id: -100777 }, from: { id: 3, first_name: 'سالم' } } }),
    });
    const replayAfterRestartBody = await replayAfterRestart.json();
    check('منع التكرار يصمد بعد restart (update_id محفوظ)', replayAfterRestartBody.duplicate === true);
    const afterRestartCount = await (await fetch(`${BASE}/api/social/manager/comments?platform=telegram`, { headers: auth })).json();
    check('لا تعليق مكرر بعد restart', afterRestartCount.comments.filter((c: any) => c.externalId === 'tg:-100777:7').length === 1);
    check('السجل يحمل قرار التكرار الآمن', /\[telegram-webhook\].*outcome=duplicate.*update_id=101/.test(currentApp.log()), currentApp.log().slice(-300));
  } finally {
    try { await stop(currentApp.proc); } catch { /* تجاهل */ }
    await mock.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

(async () => {
  unitTests();
  await integrationTests();
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} telegram connector checks`);
  }
})().catch((err) => { console.error('Telegram connector harness crashed:', err); process.exit(1); });
