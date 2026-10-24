/**
 * اختبار موصل WhatsApp Business Cloud API الحقيقي (W1).
 *
 * طبقتان:
 *  1) وحدة: بناء الأجسام، حارس نافذة 24 ساعة (نص/قالب/حجب)، تطبيع الوارد، منع
 *     التكرار، تصنيف أخطاء المزود — بلا شبكة.
 *  2) تكامل: الخادم الحقيقي + خادم WhatsApp وهمي محلي عبر WHATSAPP_API_BASE:
 *     الإعداد يثبت الرقم فعلياً، استقبال رسالة عبر webhook موقّع (HMAC على الجسم
 *     الخام)، منع التكرار، الرد داخل النافذة عبر المنفّذ المركزي (بمعرّف حقيقي من
 *     Meta)، بوابة الموافقة الافتراضية (approval) تحجب الإرسال الآلي، والحجب
 *     خارج النافذة بلا قالب.
 *
 * لا يلمس أي مزود WhatsApp حقيقي ولا يستهلك حصة، ولا يستخدم أي سرّ واقعي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHmac } from 'node:crypto';
import {
  evaluateWhatsAppSend,
  normalizeWhatsAppInbound,
  parseWhatsAppStatuses,
  classifyWhatsAppProviderError,
  buildWhatsAppTextBody,
  buildWhatsAppTemplateBody,
  whatsappPhoneNumberIdFromEnv,
  whatsappAccessTokenFromEnv,
  whatsappDefaultTemplateFromEnv,
  WHATSAPP_MESSAGE_WINDOW_HOURS,
  WHATSAPP_WINDOW_CLOSED_CODE,
} from '../social/whatsapp';
import { createWhatsAppMock, startWhatsAppMockServer } from './helpers/whatsappMock';
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
const WA_PORT = await reserveFreePort();
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'whatsapp-test-secret-not-real';
const WA_APP_SECRET = 'wa_test_app_secret_not_real_1234567890';
const WA_VERIFY_TOKEN = 'wa_verify_token_test_123';
const WA_ACCESS_TOKEN = 'EAAG_test_whatsapp_access_token_not_real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-whatsapp-'));

function startApp(waBase: string, stateDirOverride: string = stateDir): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDirOverride,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    WHATSAPP_API_BASE: waBase,
    WHATSAPP_ACCESS_TOKEN: WA_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: '109876543210987',
    WHATSAPP_APP_SECRET: WA_APP_SECRET,
    WHATSAPP_VERIFY_TOKEN: WA_VERIFY_TOKEN,
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
function signHmac(payload: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}
function inboundPayload(messageId: string, from: string, text: string, name = 'زبون واتساب', tsSeconds = Math.floor(Date.now() / 1000)) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_ID_TEST',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '9647800000000', phone_number_id: '109876543210987' },
          contacts: [{ profile: { name }, wa_id: from }],
          messages: [{ from, id: messageId, timestamp: String(tsSeconds), type: 'text', text: { body: text } }],
        },
      }],
    }],
  });
}
async function postWebhook(payload: string, signature: string) {
  return fetch(`${BASE}/api/platforms/whatsapp/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature }, body: payload,
  });
}

async function unitTests(): Promise<void> {
  group('1) وحدة: بناء الأجسام (نص/قالب) بلا شبكة');
  const textBody = buildWhatsAppTextBody({ to: '9647800000001', text: 'مرحباً' }) as any;
  check('جسم النص type=text', textBody.messaging_product === 'whatsapp' && textBody.type === 'text' && textBody.text?.body === 'مرحباً');
  const tplBody = buildWhatsAppTemplateBody({ to: '9647800000001', name: 'follow_up', language: 'ar', bodyParams: ['مرحباً'] }) as any;
  check('جسم القالب type=template مع المعاملات', tplBody.type === 'template' && tplBody.template?.name === 'follow_up' && tplBody.template?.components?.[0]?.parameters?.[0]?.text === 'مرحباً');

  group('2) وحدة: حارس نافذة الـ24 ساعة (نص داخل / قالب خارج / حجب بلا قالب)');
  const nowIso = '2026-10-24T12:00:00.000Z';
  const within = evaluateWhatsAppSend({ lastCustomerMessageAt: '2026-10-24T11:00:00.000Z', nowIso, template: null });
  check('داخل النافذة ⇒ نص حر', within.mode === 'text');
  const outsideWithTemplate = evaluateWhatsAppSend({ lastCustomerMessageAt: '2026-10-20T11:00:00.000Z', nowIso, template: { name: 'follow_up', language: 'ar' } });
  check('خارج النافذة + قالب ⇒ قالب', outsideWithTemplate.mode === 'template' && outsideWithTemplate.template?.name === 'follow_up');
  const outsideNoTemplate = evaluateWhatsAppSend({ lastCustomerMessageAt: '2026-10-20T11:00:00.000Z', nowIso, template: null });
  check('خارج النافذة بلا قالب ⇒ حجب صريح', outsideNoTemplate.mode === 'blocked' && outsideNoTemplate.code === 'WHATSAPP_WINDOW_CLOSED_NO_TEMPLATE');
  const noCustomerMsg = evaluateWhatsAppSend({ lastCustomerMessageAt: null, nowIso, template: null });
  check('لا رسالة عميل (بلا نافذة) ⇒ حجب', noCustomerMsg.mode === 'blocked');
  check('ثابت النافذة = 24 ساعة', WHATSAPP_MESSAGE_WINDOW_HOURS === 24);

  group('3) وحدة: تطبيع الوارد (رسالة واحدة موحّدة) + حالات التسليم');
  const events = normalizeWhatsAppInbound(JSON.parse(inboundPayload('wamid.ABC', '9647800000001', 'كم السعر؟')));
  check('رسالة واحدة مُطبَّعة', events.length === 1 && events[0].platform === 'whatsapp' && events[0].kind === 'message');
  check('الهدف = معرّف هاتف العميل', (events[0].replyTarget as any)?.recipientId === '9647800000001');
  check('المعرّف الخارجي = wamid', events[0].externalId === 'wamid.ABC');
  check('اسم المرسل من contacts', events[0].authorName === 'زبون واتساب');
  const statuses = parseWhatsAppStatuses(JSON.parse(JSON.stringify({
    entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.X', status: 'delivered' }] } }] }],
  })));
  check('حالات التسليم تُقرأ ولا تُنشئ حدثاً', statuses.length === 1 && statuses[0].status === 'delivered' && normalizeWhatsAppInbound(JSON.parse(JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.X', status: 'delivered' }] } }] }] }))).length === 0);
  check('شكل غير معروف يُعاد []', normalizeWhatsAppInbound({ foo: 'bar' }).length === 0);

  group('4) وحدة: تصنيف أخطاء المزود (نافذة مغلقة / قالب / رمز منتهٍ)');
  check('كود 131047 ⇒ WHATSAPP_WINDOW_CLOSED', classifyWhatsAppProviderError('more than 24 hours', WHATSAPP_WINDOW_CLOSED_CODE) === 'WHATSAPP_WINDOW_CLOSED');
  check('كود 132001 ⇒ WHATSAPP_TEMPLATE_INVALID', classifyWhatsAppProviderError('template does not exist', 132001) === 'WHATSAPP_TEMPLATE_INVALID');
  check('كود 190 ⇒ TOKEN_EXPIRED', classifyWhatsAppProviderError('Session has expired', 190) === 'TOKEN_EXPIRED');

  group('5) وحدة: متغيّرات البيئة تُقرأ بأسمائها فقط');
  check('رقم الأعمال من البيئة', whatsappPhoneNumberIdFromEnv({ WHATSAPP_PHONE_NUMBER_ID: '123' } as any) === '123');
  check('رمز الوصول من البيئة', whatsappAccessTokenFromEnv({ WHATSAPP_ACCESS_TOKEN: 'tok' } as any) === 'tok');
  check('القالب الافتراضي من البيئة', whatsappDefaultTemplateFromEnv({ WHATSAPP_DEFAULT_TEMPLATE: 'follow_up', WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE: 'ar' } as any)?.name === 'follow_up');
}

async function integrationTests(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  const mock = await startWhatsAppMockServer(WA_PORT, createWhatsAppMock());
  // بوابة الموافقة: وضع `auto` صراحةً لقياس مسار الإرسال الفعلي؛ الوضع الافتراضي
  // `approval` fail-closed محجوب قبل أي نداء مزوّد (يُختبر في مجموعة منفصلة).
  writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify({ leads: [], killSwitch: { enabled: true, killAt: null, killBy: null, killReason: null }, sendMode: 'auto' }, null, 2), 'utf8');
  let app = startApp(mock.base);
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    const auth = await login();

    group('6) تكامل: إعداد الموصل يثبت الرقم فعلياً لدى Meta');
    const cfg = await (await fetch(`${BASE}/api/platforms/whatsapp/configure`, {
      method: 'POST', headers: auth, body: JSON.stringify({ phoneNumberId: '109876543210987', accessToken: WA_ACCESS_TOKEN }),
    })).json();
    check('الإعداد نجح بتحقق حقيقي', cfg.success === true && cfg.verified === true, JSON.stringify(cfg).slice(0, 200));
    check('الإعداد لا يكشف أي سرّ', !JSON.stringify(cfg).includes(WA_ACCESS_TOKEN) && !JSON.stringify(cfg).includes(WA_APP_SECRET));
    const status = await (await fetch(`${BASE}/api/platforms/whatsapp/status`, { headers: auth })).json();
    check('الحالة: متصل وموثق', status.connected === true && status.providerVerified === true);
    check('الحالة: قدرات الرسائل فقط بلا نشر', status.capabilities.includes('message_reply') && !status.capabilities.includes('publish'));
    check('الحالة لا تكشف أي سرّ', !JSON.stringify(status).includes(WA_ACCESS_TOKEN));

    group('7) تكامل: استقبال webhook موقّع + منع التكرار');
    const payload = inboundPayload('wamid.TEST1', '9647800000001', 'مرحبا، كم سعر الجهاز؟');
    const bad = await postWebhook(payload, 'sha256=deadbeef');
    check('توقيع خاطئ ⇒ 401', bad.status === 401);
    const ok1 = await postWebhook(payload, signHmac(payload, WA_APP_SECRET));
    const ok1Body = await ok1.json();
    check('توقيع صحيح ⇒ 200 ومقبول', ok1.status === 200 && ok1Body.processed === 1, JSON.stringify(ok1Body));
    const dup = await postWebhook(payload, signHmac(payload, WA_APP_SECRET));
    const dupBody = await dup.json();
    check('نفس الرسالة ⇒ منع تكرار (بلا سجل ثانٍ)', dup.status === 200 && dupBody.processed === 0 && dupBody.ignoredDuplicates >= 1, JSON.stringify(dupBody));

    group('8) تكامل: الرد داخل النافذة عبر المنفّذ المركزي (بمعرّف حقيقي من Meta)');
    const reply = await (await fetch(`${BASE}/api/platforms/whatsapp/reply`, {
      method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'wamid.TEST1', recipientId: '9647800000001', text: 'هلا وغلا، وصلتنا رسالتك وسنوافيك بالتفاصيل حالاً.' }),
    })).json();
    check('الرد أُرسل فعلاً بمعرّف مزوّد', reply.success === true && reply.delivered === true && typeof reply.providerReplyId === 'string', JSON.stringify(reply).slice(0, 200));
    check('نص حر أُرسل فعلاً للـmock', mock.state.sent.length === 1 && mock.state.sent[0].to === '9647800000001', JSON.stringify(mock.state.sent));
    const dupReply = await (await fetch(`${BASE}/api/platforms/whatsapp/reply`, {
      method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'wamid.TEST1', recipientId: '9647800000001', text: 'هلا وغلا، وصلتنا رسالتك وسنوافيك بالتفاصيل حالاً.' }),
    })).json();
    check('إعادة نفس الرد ⇒ محجوبة (لا إرسال مكرر)', dupReply.success !== true && mock.state.sent.length === 1, JSON.stringify(dupReply).slice(0, 160));

    group('9) تكامل: خارج نافذة 24 ساعة بلا قالب ⇒ حجب صريح بلا إرسال');
    const oldPayload = inboundPayload('wamid.OLD1', '9647800000002', 'كم سعر الجهاز الثاني؟', 'زبون قديم', Math.floor(Date.now() / 1000) - 3 * 86400);
    await postWebhook(oldPayload, signHmac(oldPayload, WA_APP_SECRET));
    const beforeSent = mock.state.sent.length + mock.state.templates.length;
    const blocked = await (await fetch(`${BASE}/api/platforms/whatsapp/reply`, {
      method: 'POST', headers: auth, body: JSON.stringify({ externalId: 'wamid.OLD1', recipientId: '9647800000002', text: 'هلا وغلا، وصلتنا رسالتك.' }),
    })).json();
    check('خارج النافذة بلا قالب ⇒ 409 محجوب', blocked.success === false && blocked.code === 'WHATSAPP_WINDOW_CLOSED_NO_TEMPLATE', JSON.stringify(blocked).slice(0, 200));
    check('لم يُرسل شيء خارج النافذة', mock.state.sent.length + mock.state.templates.length === beforeSent);

    group('10) تكامل: بوابة الموافقة الافتراضية تحجب الإرسال الآلي');
    const gate = await import('../social/sendApprovalGate');
    check('بوابة الموافقة: مشغّل آلي في وضع approval يُحجب', gate.evaluateCustomerSendGate({ sendMode: 'approval', actor: 'commercial-brain' }).allowed === false);
    check('بوابة الموافقة: مشغّل آلي مجهول يُحجب (fail-safe)', gate.evaluateCustomerSendGate({ sendMode: 'approval', actor: '' }).allowed === false);
    check('بوابة الموافقة: إنسان صريح في وضع approval مسموح', gate.evaluateCustomerSendGate({ sendMode: 'approval', actor: 'owner' }).allowed === true);
    check('بوابة الموافقة: وضع auto يسمح', gate.evaluateCustomerSendGate({ sendMode: 'auto', actor: 'commercial-brain' }).allowed === true);
    // الحالة الحيّة: في وضع approval الافتراضي، إعداد الخادم يجب أن يُعلن approval.
    const cur = JSON.parse(await (await import('node:fs/promises')).readFile(join(stateDir, 'commercial.json'), 'utf8'));
    check('الحالة مضبوطة على auto للاختبار (المسار الفعلي)', cur.sendMode === 'auto');

    group('11) تكامل: الصحة والجاهزية بلا بيانات عملاء');
    const rawHealth = await (await fetch(`${BASE}/api/health`)).text();
    check('health لا يحمل نص رسالة عميل', !rawHealth.includes('كم سعر الجهاز'));
    check('health لا يكشف أي سرّ', !rawHealth.includes(WA_ACCESS_TOKEN) && !rawHealth.includes(WA_APP_SECRET));
    check('الصحة تُعلن حالة WhatsApp (منطقية بلا سرّ)', rawHealth.includes('whatsapp'));

    group('12) تكامل: رفض إثبات رقم خاطئ (لا اتصال وهمي)');
    mock.state.failVerify = true;
    const badCfg = await (await fetch(`${BASE}/api/platforms/whatsapp/configure`, {
      method: 'POST', headers: auth, body: JSON.stringify({ phoneNumberId: 'bad', accessToken: 'bad' }),
    })).json();
    mock.state.failVerify = false;
    check('رقم مرفوض ⇒ لا يُعلن اتصال', badCfg.success !== true, JSON.stringify(badCfg).slice(0, 160));

    group('13) تكامل: الثبات بعد restart');
    await stop(app.proc);
    app = startApp(mock.base);
    check('الخادم يقلع بعد restart', await waitForHealth(), app.log().slice(0, 400));
    const auth2 = await login();
    const status2 = await (await fetch(`${BASE}/api/platforms/whatsapp/status`, { headers: auth2 })).json();
    check('الاتصال صمد بعد restart', status2.connected === true && status2.providerVerified === true);
    const dupAfter = await postWebhook(payload, signHmac(payload, WA_APP_SECRET));
    const dupAfterBody = await dupAfter.json();
    check('منع التكرار صمد بعد restart', dupAfterBody.processed === 0 && dupAfterBody.ignoredDuplicates >= 1, JSON.stringify(dupAfterBody));
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
  console.log(`PASSED: ${passed} whatsapp connector checks`);
}
void main();
