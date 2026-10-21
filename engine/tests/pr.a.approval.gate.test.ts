/**
 * PR-A — بوابة الموافقة المركزية وأمان الإرسال.
 *
 * يثبت الجذور المُصلَحة:
 *  1) وحدة: بوابة `evaluateCustomerSendGate` (وضع approval يحجب الإرسال الآلي،
 *     وفعل المالك الصريح يمرّ).
 *  2) تكامل (YouTube + Facebook + Instagram + Telegram على خادم حقيقي بخوادم
 *     مزوّد وهمية محلية): مع `autoReply=true` و`commercialSendMode=approval`،
 *     **لا** نداء مزوّد إطلاقاً (comments.insert / Graph / sendMessage)، ويُسجَّل
 *     `needs_approval` بالنص المقترح.
 *  3) الإقلاع: autoReply/paused يبقيان كما حُفظا، والافتراضي false.
 *  4) الاستئناف بعد الإيقاف: autoReply يبقى false.
 *  5) Kill Switch (paused): دورة القراءة تعمل والرد ممنوع.
 *
 * لا يلمس أي مزود حقيقي ولا يستهلك حصة، ولا يستخدم أي سرّ واقعي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { evaluateCustomerSendGate, isAutomaticSendActor } from '../social/sendApprovalGate';
import { createFacebookMock, startFacebookMockServer } from './helpers/facebookMock';
import { createYouTubeMock, startYouTubeMockServer } from './helpers/youtubeMock';
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
const APP_PORT = 7820 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FB_PORT = 7900 + Math.floor(Math.random() * 40);
const YT_PORT = 7960 + Math.floor(Math.random() * 40);
const TG_PORT = 8060 + Math.floor(Math.random() * 40);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'pr-a-approval-gate-test-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_1234567890';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_not_real';
const GO_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
const GO_CLIENT_SECRET = 'test-google-client-secret-not-real';
const BOT_TOKEN = '111222333:TEST_BOT_TOKEN_NOT_REAL';
const TG_WEBHOOK_SECRET = 'test_webhook_secret_1234567890';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-pr-a-'));

const secretBuffer = createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };

function startApp(bases: { fb: string; yt: string; tg: string }, extraEnv: Record<string, string> = {}, stateDirOverride: string = stateDir): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDirOverride,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    FACEBOOK_GRAPH_API_BASE: bases.fb,
    FACEBOOK_DIALOG_BASE: bases.fb,
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: FB_APP_SECRET,
    FACEBOOK_VERIFY_TOKEN: FB_VERIFY_TOKEN,
    YOUTUBE_API_BASE: bases.yt,
    YOUTUBE_UPLOAD_BASE: bases.yt,
    YOUTUBE_TOKEN_BASE: `${bases.yt}/token`,
    GOOGLE_OAUTH_CLIENT_ID: GO_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: GO_CLIENT_SECRET,
    YOUTUBE_DAILY_QUOTA: '1000000',
    TELEGRAM_API_BASE: bases.tg,
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: TG_WEBHOOK_SECRET,
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

// ---------------------------------------------------------------------------
// 1) وحدة
// ---------------------------------------------------------------------------
function unitTests(): void {
  group('1) وحدة: بوابة الموافقة (fail-closed)');
  check('وضع approval + فاعل آلي (watcher) => حجب NEEDS_APPROVAL', (() => {
    const d = evaluateCustomerSendGate({ sendMode: 'approval', actor: 'watcher', platform: 'youtube' });
    return d.allowed === false && d.code === 'NEEDS_APPROVAL' && d.needsApproval === true;
  })());
  check('وضع approval + فاعل آلي (commercial-brain) => حجب', evaluateCustomerSendGate({ sendMode: 'approval', actor: 'commercial-brain' }).allowed === false);
  check('وضع approval + فاعل آلي (six-agent) => حجب', evaluateCustomerSendGate({ sendMode: 'approval', actor: 'six-agent' }).allowed === false);
  check('وضع approval + غياب الفاعل => حجب (آمن)', evaluateCustomerSendGate({ sendMode: 'approval', actor: '' }).allowed === false);
  check('وضع approval + فاعل المالك الصريح => يمرّ (فعل الموافقة)', evaluateCustomerSendGate({ sendMode: 'approval', actor: 'owner' }).allowed === true);
  check('وضع approval + موافقة المالك على مسودة => يمرّ', evaluateCustomerSendGate({ sendMode: 'approval', actor: 'commercial-owner-approval' }).allowed === true);
  check('وضع auto => يمرّ (خارج نطاق الحجب)', evaluateCustomerSendGate({ sendMode: 'auto', actor: 'watcher' }).allowed === true);
  check('قيمة وضع مجهولة تُعالج كـapproval (fail-safe)', evaluateCustomerSendGate({ sendMode: 'nonsense', actor: 'watcher' }).allowed === false);
  check('isAutomaticSendActor يميّز الآلي عن الإنسان', isAutomaticSendActor('watcher') === true && isAutomaticSendActor('owner') === false && isAutomaticSendActor(undefined) === true);
}

// ---------------------------------------------------------------------------
// 2) تكامل
// ---------------------------------------------------------------------------
async function integrationTests(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  const fbMock = await startFacebookMockServer(FB_PORT, createFacebookMock({
    feedPosts: [{ id: 'POST1', comments: [
      { id: 'C_PRAISE', message: 'عاشت إيدكم على الخدمة', from: { id: 'U1', name: 'أحمد' }, created_time: '2026-01-01T00:00:00+0000' },
    ] }],
  }));
  const ytMock = await startYouTubeMockServer(createYouTubeMock(), YT_PORT);
  const tgMock = await startTelegramMockServer(TG_PORT, createTelegramMock());
  ytMock.state.comments = [{ id: 'cmt_pra', threadId: 'thr', videoId: 'vid_alpha', author: 'حسين', text: 'عاشت إيدكم، خدمة ممتازة', publishedAt: '2026-01-01T09:00:00Z', likeCount: 0 }];
  ytMock.state.hasForceSslScope = true;

  let app = startApp({ fb: fbMock.base, yt: ytMock.base, tg: tgMock.base });
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());

    group('2) تكامل: الربط الحقيقي (YouTube + Facebook + Telegram)');
    // YouTube: oauth + تفويض الرد.
    const ytStart = await (await fetch(`${BASE}/api/platforms/youtube/oauth/start`, { headers: auth })).json();
    const ytState = new URL(ytStart.authorizationUrl).searchParams.get('state') as string;
    await fetch(`${BASE}/api/platforms/youtube/oauth/callback?state=${encodeURIComponent(ytState)}&code=test-auth-code`);
    await fetch(`${BASE}/api/platforms/youtube/delegation`, { method: 'POST', headers: auth, body: JSON.stringify({ actions: ['reply'] }) });
    // Facebook: oauth.
    const fbStart = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const fbState = new URL(fbStart.authorizationUrl).searchParams.get('state') || '';
    const fbCb = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(fbState)}&code=TESTCODE`);
    check('ربط Facebook ينجح', fbCb.status === 200, `status=${fbCb.status}`);
    // Telegram: configure.
    const tgConf = await fetch(`${BASE}/api/platforms/telegram/configure`, { method: 'POST', headers: auth, body: JSON.stringify({}) });
    check('ضبط Telegram ينجح', tgConf.status === 200 && (await tgConf.json()).verified === true);

    group('3) تكامل: autoReply=true + approval => لا نداء مزوّد + needs_approval (كل منصة)');
    // نُفعّل الرد الآلي على كل المراقبين (محاكاة أعلى خطر: كل شيء «مفعّل»).
    await fetch(`${BASE}/api/agent/youtube/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, autoReply: true, paused: false, humanReviewMode: false }) });
    await fetch(`${BASE}/api/agent/meta/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, autoReply: true, paused: false, humanReviewMode: false }) });
    await fetch(`${BASE}/api/agent/telegram/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, autoReply: true, paused: false, humanReviewMode: false }) });
    // رسالة Telegram واردة عبر webhook موثّق.
    const tgWebhook = await fetch(`${BASE}/api/platforms/telegram/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': TG_WEBHOOK_SECRET },
      body: JSON.stringify({ update_id: 5001, message: { message_id: 51, date: 1700000000, text: 'شكراً لكم على الخدمة', chat: { id: -100999 }, from: { id: 3, first_name: 'سالم' } } }),
    });
    check('استقبال رسالة Telegram موثّقة', tgWebhook.status === 200);
    // مسح عدّادات المزوّد قبل الدورة.
    ytMock.state.lastInsertPath = null; ytMock.state.lastCommentBody = null;
    fbMock.state.commentReplies.length = 0; fbMock.state.sentMessages.length = 0;
    tgMock.state.sent.length = 0;
    // تشغيل الدورات (يدوياً).
    await fetch(`${BASE}/api/agent/youtube/watcher/poll`, { method: 'POST', headers: auth, body: '{}' });
    await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' });
    await fetch(`${BASE}/api/agent/telegram/watcher/poll`, { method: 'POST', headers: auth, body: '{}' });
    // لا نداء مزوّد إطلاقاً (البوابة حجبت قبل الإرسال).
    check('YouTube: لا comments.insert مع approval', ytMock.state.lastInsertPath === null, String(ytMock.state.lastInsertPath));
    check('Facebook: لا رد تعليق Graph مع approval', fbMock.state.commentReplies.length === 0, `replies=${fbMock.state.commentReplies.length}`);
    check('Facebook: لا رسالة Messenger مع approval', fbMock.state.sentMessages.length === 0, `messages=${fbMock.state.sentMessages.length}`);
    check('Telegram: لا sendMessage مع approval', tgMock.state.sent.length === 0, `sent=${tgMock.state.sent.length}`);
    // سُجّل needs_approval بالنص المقترح.
    const inbox = await (await fetch(`${BASE}/api/commercial/inbox`, { headers: auth })).json();
    check('صندوق الزبائن يعرض طلبات الموافقة (needs_approval)', Array.isArray(inbox.outboundApprovals) && inbox.outboundApprovals.length >= 1, JSON.stringify(inbox.outboundPendingCount));
    check('طلب الموافقة يحمل النص المقترح (لا فارغ)', (inbox.outboundApprovals || []).every((r: any) => typeof r.text === 'string' && r.text.length > 0), JSON.stringify((inbox.outboundApprovals || []).map((r: any) => r.platform)));
    const platformsSeen = new Set((inbox.outboundApprovals || []).map((r: any) => r.platform));
    check('المنصات المسجَّلة تشمل youtube وfacebook وtelegram', platformsSeen.has('youtube') && platformsSeen.has('facebook') && platformsSeen.has('telegram'), JSON.stringify([...platformsSeen]));

    group('4) تكامل: فعل المالك الصريح يمرّ (الإرسال اليدوي)');
    // الرد اليدوي من المالك يمرّ (فعل الموافقة) — يثبت أن البوابة لا تُقفل الإرسال الشرعي.
    const manualReply = await (await fetch(`${BASE}/api/platforms/youtube/reply`, { method: 'POST', headers: auth, body: JSON.stringify({ commentId: 'cmt_pra', text: 'أهلاً بيك، نورتنا' }) })).json();
    check('الرد اليدوي من المالك يمرّ فعلياً (comments.insert)', manualReply.success === true && Boolean(manualReply.externalReplyId), JSON.stringify(manualReply).slice(0, 200));

    group('5) تكامل: Kill Switch يوقف الإرسال ويُبقي القراءة (paused)');
    await fetch(`${BASE}/api/agent/youtube/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, autoReply: true, paused: true }) });
    const healthPaused = await (await fetch(`${BASE}/api/health`)).json();
    check('health يُعلن الإرسال محجوباً (sendingPaused)', healthPaused.youtubeWatcher?.sendingPaused === true, JSON.stringify(healthPaused.youtubeWatcher?.sendingPaused));
    check('health يُعلن المراقبة نشطة (قراءة مستمرة)', healthPaused.youtubeWatcher?.watcherActive === true);
    // دورة القراءة تعمل: نضيف تعليقاً جديداً ونتأكد أنه قُرئ/صُنِّف، لكن لا رد.
    ytMock.state.comments = [{ id: 'cmt_paused', threadId: 'thr', videoId: 'vid_alpha', author: 'سعد', text: 'خدمة رائعة جداً', publishedAt: '2026-01-01T10:00:00Z', likeCount: 0 }];
    ytMock.state.lastInsertPath = null;
    const pollPaused = await (await fetch(`${BASE}/api/agent/youtube/watcher/poll`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('Kill Switch: الدورة تعمل (قراءة)', pollPaused.success === true, JSON.stringify(pollPaused.result).slice(0, 200));
    check('Kill Switch: لا رد خارجي', ytMock.state.lastInsertPath === null, String(ytMock.state.lastInsertPath));

    group('6) تكامل: الاستئناف بعد الإيقاف يُبقي autoReply=false');
    const resume = await (await fetch(`${BASE}/api/agent/youtube/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ paused: false }) })).json();
    check('الاستئناف يرفع الإيقاف', resume.success === true && resume.controls?.paused === false);
    check('الاستئناف يُبقي autoReply=false (لا عودة تلقائية للرد)', resume.controls?.autoReply === false, JSON.stringify(resume.controls));

    group('7) تكامل: الإقلاع الجديد يحفظ autoReply/paused والافتراضي false');
    // نُثبّت autoReply=true ثم نُعيد الإقلاع ونتأكد أنه بقي true (الحالة تصمد).
    await fetch(`${BASE}/api/agent/youtube/watcher/controls`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, autoReply: true, paused: false }) });
    await stop(app.proc);
    app = startApp({ fb: fbMock.base, yt: ytMock.base, tg: tgMock.base });
    check('إعادة الإقلاع نجحت', await waitForHealth(), app.log().slice(0, 300));
    Object.assign(auth, await login());
    const afterBoot = await (await fetch(`${BASE}/api/agent/youtube/watcher`, { headers: auth })).json();
    check('autoReply المحفوظ يبقى true بعد الإقلاع (لا يُصفَّر)', afterBoot.watcher?.controls?.autoReply === true, JSON.stringify(afterBoot.watcher?.controls));

    group('8) تكامل: إقلاع نظيف بمجلد حالة فارغ => الافتراضي autoReply=false');
    // مجلد حالة جديد تماماً (لا watcherState محفوظة) => الافتراضي الآمن.
    const cleanDir = mkdtempSync(join(tmpdir(), 'gharabi-pr-a-clean-'));
    await stop(app.proc);
    app = startApp({ fb: fbMock.base, yt: ytMock.base, tg: tgMock.base }, {}, cleanDir);
    check('الإقلاع النظيف نجح', await waitForHealth(), app.log().slice(0, 300));
    Object.assign(auth, await login());
    const cleanBoot = await (await fetch(`${BASE}/api/agent/youtube/watcher`, { headers: auth })).json();
    check('الافتراضي autoReply=false على إقلاع نظيف', cleanBoot.watcher?.controls?.autoReply === false, JSON.stringify(cleanBoot.watcher?.controls));
    check('الافتراضي paused=false على إقلاع نظيف', cleanBoot.watcher?.controls?.paused === false, JSON.stringify(cleanBoot.watcher?.controls));
  } finally {
    await stop(app.proc);
    await fbMock.stop(); await ytMock.stop(); await tgMock.stop();
  }
}

(async () => {
  unitTests();
  await integrationTests();
  console.log(`\n${'='.repeat(60)}`);
  if (failures.length === 0) console.log(`PASSED: ${passed} PR-A approval-gate checks`);
  else { console.log(`FAILED: ${failures.length} of ${passed + failures.length}`); for (const f of failures) console.log('  ✗ ' + f); process.exit(1); }
})().catch((e) => { console.error('خطأ غير متوقع:', e); process.exit(1); });
