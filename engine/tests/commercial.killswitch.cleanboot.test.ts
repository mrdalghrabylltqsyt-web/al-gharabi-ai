/**
 * إقلاع نظيف بلا سجل مفتاح محفوظ ⇒ **صفر أفعال خارجية** (fail-closed) — تكامل حقيقي.
 *
 * يثبت الافتراض الآمن الصريح للعقل التجاري: على إقلاع نظيف (لا سجل `killSwitch` في
 * قاعدة الحالة — وهو الحال الفعلي بعد ترقية من نسخة لا تحفظ المفتاح)، لا ينفّذ العقل
 * التجاري أي فعل خارجي إطلاقاً حتى يفعّله المالك صراحةً:
 *  1) الحالة العامة تُعلن `enabled=false`، والجدولة غير نشطة.
 *  2) تشغيل الدورة يدوياً ⇒ تخطٍّ صريح `skipped=disabled` وبلا أي إرسال إلى Meta.
 *  3) تفعيل المالك ⇒ الحالة تصبح مفعَّلة، والجدولة نشطة.
 *  4) بعد التفعيل ⇒ المتابعة المستحقة تُسلَّم فعلاً بمعرّف حقيقي من Meta (إثبات أن
 *     الافتراضي هو وحده ما يمنع، لا عطل آخر).
 *  5) الحالة المفعَّلة تصمد بعد restart.
 *
 * لا يلمس أي مزود حقيقي ولا يستهلك حصة ولا يستخدم أي سرّ واقعي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createFacebookMock, startFacebookMockServer, type FacebookMockState } from './helpers/facebookMock';

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
const APP_PORT = 7720 + Math.floor(Math.random() * 60);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FB_PORT = 7800 + Math.floor(Math.random() * 60);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'commercial-cleanboot-test-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_1234567890';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_not_real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-commercial-cleanboot-'));

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

/**
 * يبني ملف الحالة **بلا سجل `killSwitch` إطلاقاً** (يحاكي ترقية من نسخة لا تحفظه)،
 * مع عميل مستحق للمتابعة — لإثبات أن غياب السجل = معطَّل (fail-closed).
 */
function writeCleanBootState(): void {
  const overdue = new Date(Date.now() - 48 * 3600_000).toISOString();
  const inboundComment = {
    id: 'cmt_cb', platform: 'facebook', externalId: 'C_CB', postExternalId: 'POST_CB', kind: 'comment',
    text: 'شنو سعر الثلاجة؟', authorName: 'حيدر', createdAt: overdue, ingestSource: 'facebook_webhook',
    classification: { intent: 'question', sentiment: 'neutral' },
  };
  const lead = {
    id: 'lead_cb', key: 'facebook::thread:POST_CB', platform: 'facebook', conversationId: 'thread:POST_CB',
    kind: 'comment', replyTarget: { commentId: 'C_CB', videoId: 'POST_CB' }, lastExternalId: 'C_CB',
    initiatedByCustomer: true, sourceEventIds: ['C_CB'], customerName: 'حيدر',
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
  // **مهم:** لا حقل killSwitch إطلاقاً — يحاكي إقلاعاً نظيفاً/ترقية بلا سجل مفتاح محفوظ.
  writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify({ leads: [lead] }, null, 2), 'utf8');
}

(async () => {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  writeCleanBootState();

  const mockState: FacebookMockState = createFacebookMock({
    feedPosts: [{ id: 'POST_CB', comments: [{ id: 'C_CB', message: 'شنو سعر الثلاجة؟', from: { id: 'U9', name: 'حيدر' }, created_time: '2026-01-01T00:00:00+0000' }] }],
  });
  const mock = await startFacebookMockServer(FB_PORT, mockState);
  let app = startApp(mock.base);
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 500));
    Object.assign(auth, await login());

    group('1) إقلاع نظيف بلا سجل مفتاح ⇒ معطَّل (fail-closed)');
    const health = await (await fetch(`${BASE}/api/health`)).json();
    check('health.commercialBrain.enabled === false', health.commercialBrain?.enabled === false, JSON.stringify(health.commercialBrain));
    check('health.commercialBrain.automated === false', health.commercialBrain?.automated === false);
    const ksGet = await (await fetch(`${BASE}/api/agent/commercial/kill-switch`, { headers: auth })).json();
    check('المفتاح يُقرأ معطَّلاً افتراضياً', ksGet.success === true && ksGet.killSwitch?.enabled === false, JSON.stringify(ksGet.killSwitch));
    check('الجدولة غير نشطة على إقلاع نظيف', ksGet.scheduler?.active === false, JSON.stringify(ksGet.scheduler));

    group('2) صفر أفعال خارجية قبل التفعيل (الدليل الحاسم)');
    const before = mockState.commentReplies.length;
    const runDisabled = await (await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الدورة تُعلن تخطّياً صريحاً (skipped=disabled)', runDisabled.result?.skipped === 'disabled', JSON.stringify(runDisabled.result));
    check('لا إرسال خارجي إلى Meta إطلاقاً', mockState.commentReplies.length === before, `delta=${mockState.commentReplies.length - before}`);
    check('لا شبكة إلى مزوّد أثناء التعطيل (calls لم تتغيّر)', mockState.calls === 0, `calls=${mockState.calls}`);

    group('3) ربط Facebook (خادم Graph وهمي) ثم التفعيل الصريح من المالك');
    const startRes = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const state = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
    const cbRes = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(state)}&code=TESTCODE`);
    check('ربط Facebook ينجح', cbRes.status === 200, `status=${cbRes.status}`);
    const ksOn = await (await fetch(`${BASE}/api/agent/commercial/kill-switch`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: true, reason: 'owner_enabled_test' }) })).json();
    check('التفعيل الصريح ينجح', ksOn.success === true && ksOn.killSwitch?.enabled === true, JSON.stringify(ksOn.killSwitch));

    group('4) بعد التفعيل ⇒ المتابعة المستحقة تُسلَّم فعلاً بمعرّف Meta حقيقي');
    const beforeOn = mockState.commentReplies.length;
    const runEnabled = await (await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: auth, body: '{}' })).json();
    check('الدورة تعمل بعد التفعيل', runEnabled.success === true, JSON.stringify(runEnabled));
    check('أُرسلت متابعة واحدة (followUpsSent=1)', runEnabled.result?.followUpsSent === 1, JSON.stringify(runEnabled.result));
    const sent = mockState.commentReplies.slice(beforeOn);
    check('وصل رد متابعة حقيقي إلى Meta (C_CB)', sent.length === 1 && sent[0].commentId === 'C_CB', JSON.stringify(sent));
    check('معرّف رد المتابعة حقيقي من Meta', sent.length === 1 && /^REPLY_C_CB_/.test(sent[0].id || ''), JSON.stringify(sent));

    group('5) الحالة المفعَّلة تصمد بعد restart');
    await stop(app.proc);
    app = startApp(mock.base);
    check('الخادم يقلع بعد restart', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());
    const ksAfter = await (await fetch(`${BASE}/api/agent/commercial/kill-switch`, { headers: auth })).json();
    check('المفتاح يبقى مفعَّلاً بعد restart', ksAfter.killSwitch?.enabled === true, JSON.stringify(ksAfter.killSwitch));
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
  console.log(`PASSED: ${passed} commercial kill-switch clean-boot (fail-closed) checks`);
  process.exit(0);
})();
