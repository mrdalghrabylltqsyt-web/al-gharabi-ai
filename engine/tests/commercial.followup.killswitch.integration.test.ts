/**
 * عطل تسليم المتابعة (Follow-Up) — إصلاح + Kill Switch — تكامل على الخادم الحقيقي.
 *
 * يثبت الدليل المباشر على العطل وإصلاحه (بلا استنتاج)، عبر خادم Graph وهمي محلي:
 *  - **قبل الإصلاح** كانت المتابعة تُحجب خطأً لأن بوابة منع التكرار/القفل كانتا
 *    تُفتَّان على `externalId` وحده، فتُصنَّف المتابعة على نفس التعليق «رداً مكرراً».
 *  - **بعد الإصلاح** (فصل `idempotencyKey`) تُسلَّم المتابعة فعلاً بمعرّف من Meta.
 *  - حماية منع التكرار الحقيقية تبقى سليمة (إعادة المفتاح نفسه تُحجب، لا إرسال ثانٍ).
 *  - مفتاح الإيقاف الطارئ (Kill Switch) يوقف كل عمل العقل التجاري فوراً.
 *
 * لا يلمس أي مزود حقيقي ولا يستهلك حصة ولا يستخدم أي سرّ واقعي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createFacebookMock, startFacebookMockServer, type FacebookMockState } from './helpers/facebookMock';
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
const APP_PORT = 7620 + Math.floor(Math.random() * 60);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FB_PORT = 7700 + Math.floor(Math.random() * 60);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'commercial-followup-test-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_1234567890';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_not_real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-commercial-followup-'));

const secretBuffer = createHash('sha256').update(`gharabi-session:${SESSION_SECRET}`).digest();
const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };

function startApp(fbBase: string, stateDirOverride: string = stateDir): { proc: ChildProcess; log: () => string } {
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

/** يبني ملف الحالة المحلي: منتج مسجّل + منشور مرتبط + عميل مستحق للمتابعة (مُسلَّح). */
function writeSeededState(): void {
  const overdue = new Date(Date.now() - 48 * 3600_000).toISOString();
  const inboundComment = {
    id: 'cmt_fu', platform: 'facebook', externalId: 'C_FU', postExternalId: 'POST1', kind: 'comment',
    text: 'شنو سعر الثلاجة؟', authorName: 'حيدر', createdAt: overdue, ingestSource: 'facebook_webhook',
    classification: { intent: 'question', sentiment: 'neutral' },
  };
  const lead = {
    id: 'lead_fu', key: 'facebook::thread:POST1', platform: 'facebook', conversationId: 'thread:POST1',
    kind: 'comment', replyTarget: { commentId: 'C_FU', videoId: 'POST1' }, lastExternalId: 'C_FU',
    initiatedByCustomer: true, sourceEventIds: ['C_FU'], customerName: 'حيدر',
    interestedProductId: 'P_FRIDGE', interestedProductName: 'ثلاجة سامسونج', stage: 'ENGAGED',
    touches: 1, lastCustomerText: 'شنو سعر الثلاجة؟', lastInteractionAt: overdue, createdAt: overdue, updatedAt: overdue,
    lastCustomerInteractionAt: overdue, lastBusinessReplyAt: null, followUpState: 'SCHEDULED',
    followUpsSent: 0, nextFollowUpAt: overdue, pendingProposal: null, escalationReason: null, notes: [],
  };
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: {
      showroom: { name: 'معرض الغرابي' },
      products: [{ id: 'P_FRIDGE', name: 'ثلاجة سامسونج', cashPrice: 1_000_000, category: 'ثلاجات', durationMonths: 10, inStock: true }],
      posts: [], socialComments: [inboundComment], socialReplies: [], socialApprovals: [], publishRecords: [],
    },
  }), 'utf8');
  // مفتاح العقل التجاري: مفعَّل (الافتراضي)، وسجل عميل واحد مستحق للمتابعة.
  writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify({ leads: [lead], killSwitch: { enabled: true, killAt: null, killBy: null, killReason: null } }, null, 2), 'utf8');
}

(async () => {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  writeSeededState();

  // منشور فيه تعليق عميل (C_FU) — يُسحب للتحقق من أن التعليق حقيقي (بلا اختلاق).
  const mockState: FacebookMockState = createFacebookMock({
    feedPosts: [{ id: 'POST1', comments: [{ id: 'C_FU', message: 'شنو سعر الثلاجة؟', from: { id: 'U9', name: 'حيدر' }, created_time: '2026-01-01T00:00:00+0000' }] }],
  });
  const mock = await startFacebookMockServer(FB_PORT, mockState);
  let app = startApp(mock.base);
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 500));
    Object.assign(auth, await login());

    group('1) ربط Facebook (خادم Graph وهمي)');
    const startRes = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const state = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
    const cbRes = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(state)}&code=TESTCODE`);
    check('ربط Facebook ينجح', cbRes.status === 200, `status=${cbRes.status}`);

    group('2) دورة العقل التجاري تُسلّم المتابعة المستحقة فعلاً (إصلاح العطل)');
    const before = mockState.commentReplies.length;
    const run1 = await (await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الدورة تعمل', run1.success === true, JSON.stringify(run1));
    check('الدورة تُعلن إرسال متابعة واحدة (followUpsSent=1)', run1.result?.followUpsSent === 1, JSON.stringify(run1.result));
    const sent = mockState.commentReplies.slice(before);
    check('وصل فعلاً رد متابعة حقيقي إلى Meta (نفس التعليق C_FU)', sent.length === 1 && sent[0].commentId === 'C_FU', JSON.stringify(sent));
    check('معرّف رد المتابعة حقيقي من Meta', sent.length === 1 && /^REPLY_C_FU_/.test(sent[0].id || ''), JSON.stringify(sent));

    group('3) حماية منع التكرار تبقى سليمة (لا إرسال ثانٍ لنفس المفتاح)');
    const repliesAfterFirst = mockState.commentReplies.length;
    const run2 = await (await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الدورة الثانية لا ترسل شيئاً (followUpsSent=0)', run2.result?.followUpsSent === 0, JSON.stringify(run2.result));
    check('لا رد إضافي وصل إلى Meta', mockState.commentReplies.length === repliesAfterFirst, `delta=${mockState.commentReplies.length - repliesAfterFirst}`);

    group('4) الحالة بعد الإصلاح: followUpsSent ارتفع والمتابعة القادمة أُعيدت جدولتها');
    const leads1 = await (await fetch(`${BASE}/api/commercial/leads`, { headers: auth })).json();
    const lead1 = (leads1.leads || []).find((l: any) => l.id === 'lead_fu');
    check('العميل يعرض followUpsSent=1', lead1?.followUpsSent === 1, JSON.stringify(lead1));
    check('لا متابعة جديدة بعد ردّنا (لا إلحاح — nextFollowUpAt=null)', lead1?.nextFollowUpAt === null, JSON.stringify(lead1));

    group('5) مفتاح الإيقاف الطارئ (Kill Switch) — إيقاف فوري شامل');
    const ksGet = await (await fetch(`${BASE}/api/agent/commercial/kill-switch`, { headers: auth })).json();
    check('قراءة المفتاح تعمل', ksGet.success === true && ksGet.killSwitch?.enabled === true, JSON.stringify(ksGet));
    const ksOff = await (await fetch(`${BASE}/api/agent/commercial/kill-switch`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: false, reason: 'emergency_stop_test' }) })).json();
    check('إيقاف المفتاح ينجح', ksOff.success === true && ksOff.killSwitch?.enabled === false, JSON.stringify(ksOff));
    check('الإيقاف يسجّل الوقت والسبب', Boolean(ksOff.killSwitch?.killAt) && ksOff.killSwitch?.killReason === 'emergency_stop_test', JSON.stringify(ksOff.killSwitch));
    const repliesBeforeOff = mockState.commentReplies.length;
    const runOff = await (await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الدورة بعد الإيقاف تُتخطّى صراحةً (skipped=disabled)', runOff.result?.skipped === 'disabled', JSON.stringify(runOff.result));
    check('لا إرسال خارجي بعد الإيقاف', mockState.commentReplies.length === repliesBeforeOff);
    const ksOn = await (await fetch(`${BASE}/api/agent/commercial/kill-switch`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true }) })).json();
    check('إعادة التفعيل تنجح', ksOn.success === true && ksOn.killSwitch?.enabled === true, JSON.stringify(ksOn));

    group('6) التصريح + الحالة العامة');
    check('kill-switch بلا جلسة => 401', (await fetch(`${BASE}/api/agent/commercial/kill-switch`)).status === 401);
    const staffToken = signSession({ uid: 'staff-1', iat: Date.now(), exp: Date.now() + 3_600_000, sid: randomBytes(8).toString('hex') }, secretBuffer);
    check('kill-switch لغير المالك => 403', (await fetch(`${BASE}/api/agent/commercial/kill-switch`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` }, body: JSON.stringify({ enabled: false }) })).status === 403);
    const health = await (await fetch(`${BASE}/api/health`)).json();
    check('health.commercialBrain يعلن حالة المفتاح (منطقي بلا سرّ)', typeof health.commercialBrain?.enabled === 'boolean');
    check('health.commercialBrain لا يحمل اسم/نص عميل', !JSON.stringify(health.commercialBrain || {}).includes('حيدر') && !JSON.stringify(health.commercialBrain || {}).includes('شنو سعر'));

    group('7) الثبات بعد restart (المفتاح + عدّاد المتابعة)');
    await stop(app.proc);
    app = startApp(mock.base);
    check('الخادم يقلع بعد restart', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());
    const ksAfter = await (await fetch(`${BASE}/api/agent/commercial/kill-switch`, { headers: auth })).json();
    check('حالة المفتاح تصمد بعد restart (مفعَّل)', ksAfter.killSwitch?.enabled === true, JSON.stringify(ksAfter.killSwitch));
    const leadsAfter = await (await fetch(`${BASE}/api/commercial/leads`, { headers: auth })).json();
    const leadAfter = (leadsAfter.leads || []).find((l: any) => l.id === 'lead_fu');
    check('عدّاد المتابعة يصمد بعد restart (followUpsSent=1)', leadAfter?.followUpsSent === 1, JSON.stringify(leadAfter));
  } catch (err) {
    failures.push(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await stop(app.proc);
    try { await mock.stop(); } catch { /* تجاهل */ }
  }

  console.log(`\n${'='.repeat(60)}`);
  if (failures.length) {
    console.error(`FAILED: ${passed} passed, ${failures.length} failed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} commercial follow-up kill-switch checks`);
  process.exit(0);
})();
