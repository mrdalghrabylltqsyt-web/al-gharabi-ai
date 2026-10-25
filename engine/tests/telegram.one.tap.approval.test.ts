/**
 * موافقة/رفض بضغطة واحدة من Telegram على مسودة رد لزبون.
 *
 * 1) وحدة: توقيع الزر والتحقق منه (عبث بالتوقيع/الإجراء/المعرّف ⇒ رفض، سرّ مختلف
 *    ⇒ رفض)، حد 64 بايت، قبول الضغط من محادثة المالك الخاصة فقط، استخراج المسودة
 *    من مفتاح التنبيه، وتحليل callback_query.
 * 2) تكامل (خادم حقيقي + Telegram وهمي + مسودة معلّقة مزروعة):
 *    - ضغطة من غير المالك ⇒ لا قرار والمسودة تبقى معلّقة.
 *    - توقيع معبوث ⇒ لا قرار.
 *    - «رفض» من المالك بتوقيع صالح ⇒ المسودة مرفوضة، إقرار الضغطة، إزالة الأزرار،
 *      رسالة نتيجة للمالك، ولا شيء يُرسل للزبون.
 *    - رسالة نصية من محادثة المالك ⇒ لا تُسجَّل كاستفسار زبون.
 *    - بلا ترويسة السرّ ⇒ 401 (التحقق القائم يسبق كل شيء).
 *
 * بلا Gemini وبلا أسرار حقيقية. يفشل على الكود القديم.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { buildServerTestEnv } from './helpers/serverTestEnv';
import { reserveFreePort } from './helpers/freePort';
import { createTelegramMock, startTelegramMockServer } from './helpers/telegramMock';
import {
  signOwnerTelegramAction, verifyOwnerTelegramAction, isOwnerTelegramCallback, draftIdFromAlertKey,
} from '../notifications/ownerTelegram';
import { parseTelegramCallbackQuery, buildSendMessageBody, TELEGRAM_SECRET_HEADER } from '../social/telegram';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const OWNER_CHAT = '555000111';
const STRANGER = '777000222';
const SESSION_SECRET = 'one-tap-approval-secret-not-real';
const WEBHOOK_SECRET = 'tg-webhook-secret-not-real-123';
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const DRAFT_ID = 'draft-1700000000000-abcd1234';
// نفس اشتقاق الخادم لمفتاح الجلسة (SESSION_SECRET ⇒ sha256) — التوقيع يُصنع كما يصنعه الخادم.
const SERVER_KEY = createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();

async function main(): Promise<void> {
  group('1) وحدة');
  const k = 'unit-secret';
  const approve = signOwnerTelegramAction('approve', DRAFT_ID, k)!;
  check('توقيع صالح يُتحقق منه', JSON.stringify(verifyOwnerTelegramAction(approve, k)) === JSON.stringify({ action: 'approve', draftId: DRAFT_ID }), approve);
  check('≤ 64 بايت', Buffer.byteLength(approve) <= 64, String(Buffer.byteLength(approve)));
  check('★ سرّ مختلف ⇒ رفض', verifyOwnerTelegramAction(approve, 'other-secret') === null);
  check('★ تبديل الإجراء (a→r) مع نفس التوقيع ⇒ رفض', verifyOwnerTelegramAction(approve.replace(/^a:/, 'r:'), k) === null);
  check('★ تبديل المسودة ⇒ رفض', verifyOwnerTelegramAction(approve.replace(DRAFT_ID, 'draft-1700000000000-ffff0000'), k) === null);
  check('توقيع مقطوع ⇒ رفض', verifyOwnerTelegramAction(approve.slice(0, -2), k) === null);
  check('بيانات عشوائية ⇒ رفض', verifyOwnerTelegramAction('a:x:zz', k) === null);
  check('معرّف بمحارف غير مسموحة ⇒ لا زر', signOwnerTelegramAction('approve', 'draft/../x', k) === null);
  check('معرّف طويل يتجاوز 64 بايت ⇒ لا زر', signOwnerTelegramAction('approve', 'd'.repeat(60), k) === null);
  check('سرّ فارغ ⇒ لا زر', signOwnerTelegramAction('approve', DRAFT_ID, '') === null);
  check('Buffer كمفتاح مدعوم', verifyOwnerTelegramAction(signOwnerTelegramAction('reject', DRAFT_ID, SERVER_KEY)!, SERVER_KEY)?.action === 'reject');
  check('★ المالك في محادثته الخاصة فقط', isOwnerTelegramCallback({ fromId: OWNER_CHAT, chatId: OWNER_CHAT }, OWNER_CHAT));
  check('★ غير المالك ⇒ رفض', !isOwnerTelegramCallback({ fromId: STRANGER, chatId: OWNER_CHAT }, OWNER_CHAT));
  check('★ المالك داخل مجموعة ⇒ رفض', !isOwnerTelegramCallback({ fromId: OWNER_CHAT, chatId: '-1001' }, OWNER_CHAT));
  check('بلا معرّف مالك مضبوط ⇒ رفض', !isOwnerTelegramCallback({ fromId: OWNER_CHAT, chatId: OWNER_CHAT }, null));
  check('المسودة من مفتاح التنبيه', draftIdFromAlertKey(`commercial_draft:facebook:${DRAFT_ID}`) === DRAFT_ID);
  check('مفتاح ليس مسودة ⇒ null', draftIdFromAlertKey('platform_reauth:facebook:x') === null);
  const cb = parseTelegramCallbackQuery({ update_id: 9, callback_query: { id: 'cq1', from: { id: 555000111 }, data: approve, message: { message_id: 42, chat: { id: 555000111 } } } });
  check('تحليل callback_query', cb?.callbackId === 'cq1' && cb.fromId === OWNER_CHAT && cb.chatId === OWNER_CHAT && cb.messageId === '42' && cb.data === approve, JSON.stringify(cb));
  check('رسالة عادية ليست callback', parseTelegramCallbackQuery({ update_id: 1, message: { text: 'x' } }) === null);
  const body: any = buildSendMessageBody({ chatId: OWNER_CHAT, text: 't', inlineKeyboard: [[{ text: 'ok', callbackData: approve }, { text: 'big', callbackData: 'x'.repeat(65) }]] });
  check('الأزرار تُبنى، والزر الذي يتجاوز 64 بايت يُسقط', body.reply_markup?.inline_keyboard?.[0]?.length === 1 && body.reply_markup.inline_keyboard[0][0].callback_data === approve, JSON.stringify(body.reply_markup));
  check('بلا أزرار ⇒ لا reply_markup', buildSendMessageBody({ chatId: OWNER_CHAT, text: 't' }).reply_markup === undefined);

  group('2) تكامل');
  const tg = await startTelegramMockServer(await reserveFreePort(), createTelegramMock());
  const PORT = await reserveFreePort();
  const BASE = `http://127.0.0.1:${PORT}`;
  const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-onetap-'));
  const now = Date.now();
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16,
    users: [{ id: 'u_owner', email: 'owner-onetap@example.com', role: 'owner', name: 'المالك', active: true }],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: { showroom: { name: 'معرض الغرابي' }, products: [], socialComments: [], socialReplies: [], publishRecords: [], providerTokens: {} },
  }));
  writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify({
    leads: [], killSwitch: { enabled: true, killAt: null, killBy: null, killReason: null }, sendMode: 'approval', ownerDecisions: [], lease: null,
    drafts: [{
      id: DRAFT_ID, leadId: 'lead_1', leadKey: 'facebook:c1', platform: 'facebook', kind: 'comment', purpose: 'reply',
      text: 'أهلاً، القسط الشهري 62,500 د.ع.', externalId: 'COMMENT_1', recipientId: null, productId: null, proposalId: null,
      idempotencyKey: 'onetap1', createdAt: new Date(now - 10 * 60_000).toISOString(), windowExpiresAt: null,
      status: 'pending', decidedBy: null, decidedAt: null, approvedText: null, deliveryStatus: null, deliveryError: null, providerReplyId: null,
    }],
  }));
  const env = buildServerTestEnv({
    stateDir,
    overrides: {
      PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE,
      GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
      PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      OWNER_EMAIL: 'owner-onetap@example.com', RESEND_API_KEY: undefined, GEMINI_API_KEY: undefined,
      TELEGRAM_BOT_TOKEN: '222222:onetap-bot-not-real', TELEGRAM_API_BASE: tg.base,
      TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET, OWNER_TELEGRAM_CHAT_ID: OWNER_CHAT,
    },
  });
  let log = '';
  const proc: ChildProcess = spawn(process.execPath, [join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(process.cwd(), 'server.ts')], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  const hook = (update: any, withSecret = true) => fetch(`${BASE}/api/platforms/telegram/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(withSecret ? { [TELEGRAM_SECRET_HEADER]: WEBHOOK_SECRET } : {}) },
    body: JSON.stringify(update),
  });
  const press = (updateId: number, fromId: string, data: string) => hook({
    update_id: updateId,
    callback_query: { id: `cq${updateId}`, from: { id: Number(fromId) }, data, message: { message_id: 77, chat: { id: Number(OWNER_CHAT) } } },
  });
  try {
    let up = false;
    const deadline = Date.now() + 180_000;
    while (!up && Date.now() < deadline) {
      try { up = (await fetch(`${BASE}/api/health`)).ok; } catch { /* لم يقلع */ }
      if (!up) await new Promise((r) => setTimeout(r, 400));
    }
    check('الخادم يقلع', up, log.slice(-600));
    const login = await (await fetch(`${BASE}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) })).json();
    const auth = { Authorization: `Bearer ${login.token}` };
    const draftStatus = async () => {
      const inbox = await (await fetch(`${BASE}/api/commercial/inbox`, { headers: auth })).json();
      return (inbox.drafts || []).find((d: any) => d.id === DRAFT_ID)?.status;
    };
    check('المسودة معلّقة في البداية', (await draftStatus()) === 'pending');

    const noSecret = await hook({ update_id: 1, callback_query: { id: 'x', from: { id: Number(OWNER_CHAT) }, data: 'r:x:y' } }, false);
    check('بلا ترويسة السرّ ⇒ 401', noSecret.status === 401, String(noSecret.status));

    const reject = signOwnerTelegramAction('reject', DRAFT_ID, SERVER_KEY)!;
    const r1 = await (await press(101, STRANGER, reject)).json();
    check('★ ضغطة من غير المالك ⇒ not_owner', r1.callback === 'not_owner', JSON.stringify(r1));
    check('المسودة ما زالت معلّقة', (await draftStatus()) === 'pending');

    const tampered = reject.slice(0, -1) + (reject.endsWith('0') ? '1' : '0');
    const r2 = await (await press(102, OWNER_CHAT, tampered)).json();
    check('★ توقيع معبوث ⇒ bad_signature', r2.callback === 'bad_signature', JSON.stringify(r2));
    check('المسودة ما زالت معلّقة بعد العبث', (await draftStatus()) === 'pending');

    const sentBefore = tg.state.sent.length;
    const r3 = await (await press(103, OWNER_CHAT, reject)).json();
    check('★ رفض المالك بتوقيع صالح ⇒ ok', r3.callback === 'ok', JSON.stringify(r3));
    check('★ المسودة صارت مرفوضة', (await draftStatus()) === 'rejected');
    check('الضغطة أُقرّت بنص الرفض', tg.state.callbackAnswers.some((a) => a.callbackId === 'cq103' && /رُفض/.test(a.text)), JSON.stringify(tg.state.callbackAnswers));
    check('الأزرار أُزيلت من رسالة التنبيه', tg.state.keyboardCleared.some((c) => c.chatId === OWNER_CHAT && c.messageId === '77'));
    const newMsgs = tg.state.sent.slice(sentBefore);
    check('رسالة نتيجة للمالك وحده', newMsgs.length >= 1 && newMsgs.every((m) => m.chatId === OWNER_CHAT), JSON.stringify(newMsgs.map((m) => m.chatId)));

    const r4 = await (await press(104, OWNER_CHAT, reject)).json();
    check('ضغطة ثانية على مسودة محسومة ⇒ لا قرار جديد', r4.callback !== 'ok', JSON.stringify(r4));

    const ownerText = await (await hook({ update_id: 105, message: { message_id: 5, date: Math.floor(Date.now() / 1000), chat: { id: Number(OWNER_CHAT), type: 'private' }, from: { id: Number(OWNER_CHAT), first_name: 'المالك' }, text: 'مرحبا' } })).json();
    check('★ رسالة المالك للبوت لا تُسجَّل كزبون', ownerText.ignored === 'owner_chat', JSON.stringify(ownerText));
  } finally {
    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1200));
    if (!proc.killed) proc.kill('SIGKILL');
    await tg.stop();
    rmSync(stateDir, { recursive: true, force: true });
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} — passed ${passed}`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} telegram-one-tap-approval checks`);
}

void main();
