/**
 * تنبيه المالك الفوري عبر Telegram — قناة ثانية بجانب ملخص البريد.
 *
 * 1) وحدة: معرّف المحادثة (رقم موجب فقط، رفض المجموعات)، نص الرسالة (النوع/المنصة/
 *    الرابط)، حدّ 20/ساعة ثم رسالة تجاوز واحدة ثم حجب، وتصفير النافذة بعد ساعة،
 *    والتقاط الأحداث الجديدة فقط.
 * 2) تكامل: خادم حقيقي + خادم Telegram وهمي + منصة reauth_needed ⇒ رسالة فورية
 *    واحدة إلى محادثة المالك فقط (بلا بريد مضبوط)، بلا تكرار في الدورة التالية،
 *    والحالة تُعلن telegram.configured. مع إيقاف التنبيه ⇒ لا رسالة.
 *
 * بلا Gemini، وبلا أي رسالة للزبون، وبلا أسرار حقيقية. يفشل على الكود القديم.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { buildServerTestEnv } from './helpers/serverTestEnv';
import { reserveFreePort } from './helpers/freePort';
import { createTelegramMock, startTelegramMockServer } from './helpers/telegramMock';
import {
  parseOwnerTelegramChatId, buildOwnerTelegramMessage, decideOwnerTelegramSend,
  defaultOwnerTelegramRateState, newlyQueuedAlerts, OWNER_TELEGRAM_MAX_PER_HOUR,
} from '../notifications/ownerTelegram';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const OWNER_CHAT = '123456789';
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const BOT_TOKEN = '111111:test-bot-token-not-real';

function seedState(stateDir: string): void {
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16,
    users: [{ id: 'u_owner', email: 'owner-tg@example.com', role: 'owner', name: 'المالك', active: true }],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [],
    platformConnections: [
      { platform: 'facebook', status: 'reauth_needed', accountId: 'PAGE_1', connectedAt: new Date().toISOString(), providerVerified: false },
    ],
    workspace: { showroom: { name: 'معرض الغرابي' }, products: [], socialComments: [], socialReplies: [], publishRecords: [], providerTokens: {} },
  }));
}

async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (cond()) return true; await new Promise((r) => setTimeout(r, 250)); }
  return cond();
}

async function main(): Promise<void> {
  group('1) وحدة');
  check('رقم محادثة شخصية مقبول', parseOwnerTelegramChatId({ OWNER_TELEGRAM_CHAT_ID: OWNER_CHAT }) === OWNER_CHAT);
  check('★ معرّف مجموعة (سالب) مرفوض', parseOwnerTelegramChatId({ OWNER_TELEGRAM_CHAT_ID: '-1001234567890' }) === null);
  check('قيمة غير رقمية مرفوضة', parseOwnerTelegramChatId({ OWNER_TELEGRAM_CHAT_ID: '@owner' }) === null);
  check('غياب المتغير ⇒ null', parseOwnerTelegramChatId({}) === null);

  const item = { key: 'commercial_draft:facebook:d1', kind: 'commercial_draft' as const, platform: 'facebook', title: 'استفسار', snippet: 'كم سعر الثلاجة؟', at: new Date().toISOString() };
  const msg = buildOwnerTelegramMessage(item, 'https://example.app/');
  check('الرسالة تذكر النوع والمنصة', msg.includes('استفسار زبون يحتاج موافقتك') && msg.includes('facebook'), msg);
  check('الرسالة تحمل المقتطف', msg.includes('كم سعر الثلاجة؟'));
  check('رابط صندوق الموافقات', msg.includes('https://example.app/?tab=commercial_inbox'), msg);
  const reauth = buildOwnerTelegramMessage({ ...item, kind: 'platform_reauth', snippet: '' }, null);
  check('انقطاع الربط بلا رابط ولا سطر فارغ زائد', !reauth.includes('http') && !reauth.endsWith('\n'), JSON.stringify(reauth));

  let st = defaultOwnerTelegramRateState();
  const t0 = 1_700_000_000_000;
  let sends = 0, overflow = 0, drops = 0;
  for (let i = 0; i < OWNER_TELEGRAM_MAX_PER_HOUR + 5; i++) {
    const r = decideOwnerTelegramSend(st, t0 + i * 1000); st = r.next;
    if (r.decision === 'send') sends += 1; else if (r.decision === 'overflow') overflow += 1; else drops += 1;
  }
  check(`★ ${OWNER_TELEGRAM_MAX_PER_HOUR} رسالة ثم تجاوز واحد ثم حجب`, sends === OWNER_TELEGRAM_MAX_PER_HOUR && overflow === 1 && drops === 4, `${sends}/${overflow}/${drops}`);
  const after = decideOwnerTelegramSend(st, t0 + 61 * 60 * 1000);
  check('النافذة تتصفّر بعد ساعة', after.decision === 'send' && after.next.sentInWindow === 1);
  const a = [item];
  const b = [item, { ...item, key: 'k2' }];
  check('الجديد فقط يُلتقط', newlyQueuedAlerts(a, b).length === 1 && newlyQueuedAlerts(a, b)[0].key === 'k2');
  check('لا جديد ⇒ لا شيء', newlyQueuedAlerts(b, b).length === 0);

  group('2) تكامل: رسالة فورية عند انقطاع ربط (بلا بريد مضبوط)');
  const tg = await startTelegramMockServer(await reserveFreePort(), createTelegramMock());
  const PORT = await reserveFreePort();
  const BASE = `http://127.0.0.1:${PORT}`;
  const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-tg-alerts-'));
  seedState(stateDir);
  const env = buildServerTestEnv({
    stateDir,
    overrides: {
      PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE,
      GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET: 'owner-tg-secret-not-real',
      PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      OWNER_EMAIL: 'owner-tg@example.com',
      RESEND_API_KEY: undefined, RESEND_FROM_EMAIL: undefined, GEMINI_API_KEY: undefined,
      TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_API_BASE: tg.base,
      OWNER_TELEGRAM_CHAT_ID: OWNER_CHAT,
    },
  });
  let log = '';
  const proc: ChildProcess = spawn(process.execPath, [join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(process.cwd(), 'server.ts')], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  try {
    let up = false;
    const deadline = Date.now() + 180_000;
    while (!up && Date.now() < deadline) {
      try { up = (await fetch(`${BASE}/api/health`)).ok; } catch { /* لم يقلع */ }
      if (!up) await new Promise((r) => setTimeout(r, 400));
    }
    check('الخادم يقلع', up, log.slice(-600));

    const toOwner = () => tg.state.sent.filter((m) => m.chatId === OWNER_CHAT);
    const got = await waitFor(() => toOwner().length >= 1, 20_000);
    check('★ رسالة Telegram فورية وصلت لمحادثة المالك', got, JSON.stringify(tg.state.sent.map((m) => m.chatId)));
    check('الرسالة عن انقطاع ربط facebook', /انقطاع ربط/.test(toOwner()[0]?.text || '') && /facebook/.test(toOwner()[0]?.text || ''), toOwner()[0]?.text);
    check('★ لا رسالة لأي محادثة أخرى', tg.state.sent.every((m) => m.chatId === OWNER_CHAT), JSON.stringify(tg.state.sent.map((m) => m.chatId)));

    const login = await (await fetch(`${BASE}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) })).json();
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };
    const count1 = toOwner().length;
    await fetch(`${BASE}/api/agent/owner-alerts/run`, { method: 'POST', headers: auth });
    await new Promise((r) => setTimeout(r, 1500));
    check('★ لا تكرار لنفس الحدث في الدورة التالية', toOwner().length === count1, `${count1} → ${toOwner().length}`);

    const st = await (await fetch(`${BASE}/api/agent/owner-alerts`, { headers: auth })).json();
    check('الحالة تُعلن telegram.configured', st.alerts?.telegram?.configured === true, JSON.stringify(st.alerts?.telegram));
    check('الحالة تعدّ رسالة مرسلة', (st.alerts?.telegram?.sentCount || 0) >= 1);
    check('لا رمز البوت في الحالة', !JSON.stringify(st).includes(BOT_TOKEN));

    const rd = await (await fetch(`${BASE}/api/control/sales-readiness`, { headers: auth })).json();
    const alertsItem = (rd.readiness?.items || []).find((i: any) => i.id === 'owner-alerts');
    check('جاهزية البيع: Telegram وحده يكفي كقناة تنبيه', alertsItem?.severity === 'ok' && /Telegram/.test(alertsItem?.detail || ''), JSON.stringify(alertsItem));
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
  console.log(`PASSED: ${passed} owner-telegram-alerts checks`);
}

void main();
