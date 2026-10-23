/**
 * PR-S1 — حارس نافذة مراسلة Meta (24 ساعة) للمتابعات التجارية.
 *
 * الفجوة: العقل التجاري يجدول متابعات على 24/72 ساعة، لكن نافذة مراسلة Meta
 * الرسمية تسمح بإرسال رسالة (Messenger/DM) خلال 24 ساعة من آخر رسالة للعميل فقط.
 * متابعة عند 72 ساعة عبر رسائل Meta تقع خارج النافذة ⇒ قد تُرفض/تعرّض الصفحة
 * للتقييد. الحارس المؤقت يمنع أي متابعة عبر رسائل Meta خارج النافذة ويُسجّل السبب.
 *
 * وحدة: دالة النافذة حتمية. تكامل: الخادم يحجب متابعة قديمة (خارج 24h) بلا أي نداء
 * مزود، ويسمح بمتابعة داخل النافذة (بخادم Meta وهمي محلي — بلا مزود ولا سرّ).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createCipheriv } from 'node:crypto';
import { isWithinMetaMessageWindow, COMMERCIAL_META_MESSAGE_WINDOW_HOURS } from '../commercial/commercialBrain';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

// ─────────────────────────────────────────────────────────────────────────────
// وحدة: دالة النافذة (بلا شبكة)
// ─────────────────────────────────────────────────────────────────────────────

group('1) ثابت النافذة ودالة الحساب');
check('النافذة 24 ساعة', COMMERCIAL_META_MESSAGE_WINDOW_HOURS === 24);
const now = '2026-10-16T12:00:00.000Z';
check('قبل ساعة => داخل النافذة', isWithinMetaMessageWindow('2026-10-16T11:00:00.000Z', now) === true);
check('قبل 23 ساعة => داخل النافذة', isWithinMetaMessageWindow('2026-10-15T13:00:00.000Z', now) === true);
check('قبل 25 ساعة => خارج النافذة', isWithinMetaMessageWindow('2026-10-15T11:00:00.000Z', now) === false);
check('قبل 72 ساعة (نافذة المتابعة الثانية) => خارج النافذة', isWithinMetaMessageWindow('2026-10-13T12:00:00.000Z', now) === false);
check('null => خارج النافذة (لا إرسال بلا وقت مؤكّد)', isWithinMetaMessageWindow(null, now) === false);
check('قيمة غير صالحة => خارج النافذة', isWithinMetaMessageWindow('غير صالح', now) === false);
check('الآن تماماً => داخل النافذة', isWithinMetaMessageWindow(now, now) === true);
check('بالضبط 24 ساعة => خارج النافذة (حدّ صارم)', isWithinMetaMessageWindow('2026-10-15T12:00:00.000Z', now) === false);

// ─────────────────────────────────────────────────────────────────────────────
// تكامل: خادم حقيقي + خادم Meta وهمي محلي
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const APP_PORT = 8300 + Math.floor(Math.random() * 40);
const META_PORT = 8360 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const META_BASE = `http://127.0.0.1:${META_PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'commercial-meta-window-secret-not-real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const FB_PAGE_TOKEN = 'FB_PAGE_TOKEN_NOT_REAL';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-meta-window-'));

let proc: ChildProcess | null = null;
let log = '';
let metaServer: { stop: () => Promise<void> } | null = null;
let metaState: { messages: any[]; sentMessages: any[] };

function encryptCredForTest(value: unknown): Record<string, string> {
  const key = Buffer.from(TOKEN_KEY, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { alg: 'aes-256-gcm', iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') };
}

async function startMetaMock(port: number): Promise<{ stop: () => Promise<void> }> {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  metaState = { messages: [], sentMessages: [] };
  // قراءة الرسائل/التعليقات (polling) — لا شيء (نتحكم بالحالة مباشرة).
  app.get('/:version/:pageId/feed', (_req, res) => res.json({ data: [] }));
  app.get('/:version/:pageId/conversations', (_req, res) => res.json({ data: [] }));
  // إرسال رسالة Messenger: نسجّل الاستدعاء ونُعيد معرّفاً حقيقياً شكلياً.
  app.post('/:version/:pageId/messages', (req, res) => {
    const mid = `m_${metaState.sentMessages.length + 1}`;
    metaState.sentMessages.push({ recipientId: req.body?.recipient?.id, text: req.body?.message?.text, mid });
    res.json({ recipient_id: req.body?.recipient?.id, message_id: mid });
  });
  // إثبات هوية الصفحة (health/verify) — لا يُستدعى في هذا المسار.
  app.get('/:version/:pageId', (_req, res) => res.json({ id: 'PAGE_MW', name: 'معرض الغرابي' }));
  return await new Promise((resolve) => {
    const srv = app.listen(port, () => resolve({
      stop: () => new Promise<void>((r) => srv.close(() => r())),
    }));
  });
}

function startApp(): void {
  log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    FACEBOOK_GRAPH_API_BASE: META_BASE,
    FACEBOOK_VERIFY_TOKEN: 'verify-not-real',
    FACEBOOK_APP_SECRET: 'app-secret-not-real',
    FACEBOOK_OAUTH_CLIENT_ID: '123456789012345',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'client-secret-not-real',
  };
  delete env.GEMINI_API_KEY; delete env.DATABASE_URL;
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

async function integration(): Promise<void> {
  metaServer = await startMetaMock(META_PORT);
  startApp();
  if (!(await waitForHealth())) { console.log(log.slice(-2000)); throw new Error('الخادم لم يقلع'); }
  const auth = await login();

  group('2) الخادم يقلع ويكشف كتلة العقل التجاري');
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check('الصحة تعرض كتلة العقل التجاري', Boolean(health.commercialBrain), JSON.stringify(Object.keys(health)).slice(0, 200));
  check('العقل التجاري معطَّل افتراضياً (fail-closed)', health.commercialBrain?.enabled === false, JSON.stringify(health.commercialBrain));

  group('3) تصريح: مسار التشغيل اليدوي للعقل التجاري محصور بالمالك');
  const noAuth = await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  check('بلا جلسة => 401', noAuth.status === 401, String(noAuth.status));

  group('4) تفعيل العقل التجاري + زرع عميلين (داخل النافذة/خارجها)');
  const enable = await (await fetch(`${BASE}/api/agent/commercial/kill-switch`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, reason: 'test' }) })).json();
  check('العقل التجاري فُعّل', enable.success === true, JSON.stringify(enable).slice(0, 200));

  // نُوقف العملية، نزرع سجل العملاء في ملف الحالة، ثم نُعيد التشغيل (محاكاة حقيقية).
  proc!.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  const nowMs = Date.now();
  const H = 3600_000;
  const iso = (h: number) => new Date(nowMs - h * H).toISOString();
  // إصلاح 2026-10-22: المتابعة تُحسَب من **آخر رد للمعرض** وتُقترح في **الرسائل الخاصة
  // فقط** وداخل نافذة المتابعة (72 ساعة).
  //  - lead_in: رسالة خاصة، رد المعرض قبل 49 ساعة، الزبون ساكت ⇒ داخل النافذة ⇒ تُرسل.
  //  - lead_out: رسالة خاصة، رد المعرض قبل 80 ساعة ⇒ خارج النافذة ⇒ تُحجب (windowBlocked).
  //  - lead_cmt: تعليق عام ⇒ لا متابعة إطلاقاً (PUBLIC_COMMENT_NO_FOLLOWUP).
  const leads = [
    {
      id: 'lead_in', key: 'facebook:conv_in', platform: 'facebook', conversationId: 'conv_in', kind: 'message',
      replyTarget: { recipientId: 'PSID_IN' }, lastExternalId: 'msg_in', initiatedByCustomer: true,
      sourceEventIds: ['msg_in'], customerName: 'زبون داخلي', interestedProductId: null, interestedProductName: null,
      stage: 'ENGAGED', touches: 1, lastCustomerText: 'كم القسط؟',
      lastInteractionAt: iso(50), createdAt: iso(50), updatedAt: iso(49),
      lastCustomerInteractionAt: iso(50), lastBusinessReplyAt: iso(49),
      followUpState: 'SCHEDULED', followUpsSent: 0, nextFollowUpAt: iso(1),
      pendingProposal: null, escalationReason: null, notes: [],
    },
    {
      id: 'lead_out', key: 'facebook:conv_out', platform: 'facebook', conversationId: 'conv_out', kind: 'message',
      replyTarget: { recipientId: 'PSID_OUT' }, lastExternalId: 'msg_out', initiatedByCustomer: true,
      sourceEventIds: ['msg_out'], customerName: 'زبون خارجي', interestedProductId: null, interestedProductName: null,
      stage: 'ENGAGED', touches: 1, lastCustomerText: 'كم القسط؟',
      lastInteractionAt: iso(90), createdAt: iso(90), updatedAt: iso(80),
      lastCustomerInteractionAt: iso(90), lastBusinessReplyAt: iso(80),
      followUpState: 'SCHEDULED', followUpsSent: 0, nextFollowUpAt: iso(1),
      pendingProposal: null, escalationReason: null, notes: [],
    },
    {
      id: 'lead_cmt', key: 'facebook:thread_old', platform: 'facebook', conversationId: 'thread_old', kind: 'comment',
      replyTarget: { commentId: 'C_OLD', videoId: 'POST1' }, lastExternalId: 'C_OLD', initiatedByCustomer: true,
      sourceEventIds: ['C_OLD'], customerName: 'زبون تعليق', interestedProductId: null, interestedProductName: null,
      stage: 'ENGAGED', touches: 1, lastCustomerText: 'كم القسط؟',
      lastInteractionAt: iso(50), createdAt: iso(50), updatedAt: iso(49),
      lastCustomerInteractionAt: iso(50), lastBusinessReplyAt: iso(49),
      followUpState: 'SCHEDULED', followUpsSent: 0, nextFollowUpAt: iso(1),
      pendingProposal: null, escalationReason: null, notes: [],
    },
  ];
  const { writeFileSync } = await import('node:fs');
  const connectedAt = new Date(nowMs - 3 * 3600_000).toISOString();
  // حالة كاملة: اتصال Facebook موثق (صفحة + رمز مشفّر) + سجل العملاء + مفتاح مفعّل.
  const stateSnapshot = {
    schemaVersion: 16, savedAt: connectedAt,
    platformConnections: [
      { platform: 'facebook', status: 'connected', accountId: 'PAGE_MW', accountName: 'معرض الغرابي', connectedAt, providerVerified: true },
    ],
    workspace: {
      showroom: { name: 'معرض الغرابي' },
      products: [],
      providerTokens: {
        facebook: encryptCredForTest({ pageId: 'PAGE_MW', pageAccessToken: FB_PAGE_TOKEN, userAccessToken: 'FB_USER_TOKEN', connectedAt }),
      },
    },
  };
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify(stateSnapshot));
  // PR-S2: هذا الاختبار يقيس مسار الإرسال التلقائي (حاجز النافذة)، فيُضبط الوضع auto
  // صراحةً لأن الافتراضي صار approval الذي يحفظ مسودة بلا إرسال.
  writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify({ leads, killSwitch: { enabled: true, killAt: null, killBy: null, killReason: null }, sendMode: 'auto', lease: null }));
  startApp();
  if (!(await waitForHealth())) { console.log(log.slice(-2000)); throw new Error('الخادم لم يعد الإقلاع'); }
  const auth2 = await login();

  group('5) دورة يدوية: الخارجي محجوب (نافذة 24h)، الداخلي يُرسَل');
  const sentBefore = metaState.sentMessages.length;
  const run = await (await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: auth2, body: JSON.stringify({}) })).json();
  const r = run.result || {};
  check('الدورة نجحت', run.success === true, JSON.stringify(run).slice(0, 200));
  check('متابعة واحدة أُرسلت (الداخلي فقط)', r.followUpsSent === 1, JSON.stringify(r));
  check('حاجز النافذة سجّل رسالة واحدة محجوبة فقط (لا التعليق العام)', r.windowBlocked === 1, JSON.stringify(r));
  check('نداء إرسال واحد فعلاً لمزوّد Meta', metaState.sentMessages.length === sentBefore + 1, `sent=${metaState.sentMessages.length}`);
  check('المستلم هو الزبون داخل النافذة فقط (PSID_IN)', metaState.sentMessages[metaState.sentMessages.length - 1]?.recipientId === 'PSID_IN', JSON.stringify(metaState.sentMessages));
  check('لم يُرسَل شيء للزبون خارج النافذة (PSID_OUT)', !metaState.sentMessages.some((m) => m.recipientId === 'PSID_OUT'), JSON.stringify(metaState.sentMessages));

  group('6) آخر دورة معلنة تُظهر العدّاد (شفافية للمالك)');
  const ks = await (await fetch(`${BASE}/api/agent/commercial/kill-switch`, { headers: auth2 })).json();
  check('lastRun يحمل windowBlocked', ks.lastRun?.windowBlocked === 1, JSON.stringify(ks.lastRun));
  check('lastRun يحمل followUpsSent=1', ks.lastRun?.followUpsSent === 1, JSON.stringify(ks.lastRun));
}

async function main(): Promise<void> {
  try {
    await integration();
  } finally {
    try { if (proc) { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1200)); if (!proc.killed) proc.kill('SIGKILL'); } } catch { /* تجاهل */ }
    try { if (metaServer) await metaServer.stop(); } catch { /* تجاهل */ }
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }
  console.log('\n' + '='.repeat(60));
  if (failures.length === 0) {
    console.log(`PASSED: ${passed} commercial Meta 24h window guard checks`);
    process.exit(0);
  } else {
    console.log(`FAILED: ${failures.length} of ${passed + failures.length}`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

void main();
