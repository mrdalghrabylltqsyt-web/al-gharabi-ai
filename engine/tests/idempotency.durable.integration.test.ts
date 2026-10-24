/**
 * F-07 — اختبار تكامل لمنع التكرار الدائم (خادم حقيقي + خادم Graph وهمي).
 *
 * يثبت أن حجز العملية الخارجية يصمد **خارج** الذاكرة (مخزن الحالة/Postgres):
 *  - طلبان متزامنان لنفس الرد => نداء مزود واحد فقط.
 *  - إعادة تشغيل فعلية (عملية جديدة + قفل داخلي فارغ) ثم نفس الطلب => لا نداء ثانٍ.
 *  - حجز عالق منتهي المدة => يُسمح بإعادة الحجز (لا جمود دائم).
 *  - فشل مؤكد (failed) => يُسمح بإعادة المحاولة.
 *  - الفشل الحقيقي يوسم الحجز `failed` في المخزن.
 * بلا مزود حقيقي ولا حصة ولا سرّ (خادم Graph وهمي محلي فقط).
 */

import express from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { createFacebookMock, startFacebookMockServer, type FacebookMockState } from './helpers/facebookMock';
import { classifyExternalOperationOutcome, decideReservation } from '../social/idempotencyStore';
import { reserveFreePort } from './helpers/freePort';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const APP_PORT = await reserveFreePort();
const FB_PORT = await reserveFreePort();
const BASE = `http://127.0.0.1:${APP_PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'idempotency-durable-test-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_1234567890';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_not_real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-idempotency-'));
const IDEMP_FILE = join(stateDir, '.gharabi-idempotency.json');

const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };

function startApp(fbBase: string): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    FACEBOOK_GRAPH_API_BASE: fbBase,
    FACEBOOK_DIALOG_BASE: fbBase,
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: FB_APP_SECRET,
    FACEBOOK_VERIFY_TOKEN: FB_VERIFY_TOKEN,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL; // خلفية الملف/المخزن (لا Postgres) — الوضع العابر/الدائم.
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
async function ingest(auth: Record<string, string>, externalId: string, text: string): Promise<void> {
  await fetch(`${BASE}/api/social/manager/comments/ingest`, {
    method: 'POST', headers: auth, body: JSON.stringify({ platform: 'facebook', externalId, text, authorName: 'أحمد' }),
  });
}
async function reply(auth: Record<string, string>, externalId: string, text: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}/api/platforms/facebook/reply`, {
    method: 'POST', headers: auth, body: JSON.stringify({ externalId, text, commentText: 'عاشت إيدكم على الخدمة' }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
/** يقرأ سجل الحجز من ملف منع التكرار (خلفية الملف). */
function readIdemRecord(key: string): any {
  try {
    const raw = JSON.parse(readFileSync(IDEMP_FILE, 'utf8'));
    return raw?.records?.[key] || null;
  } catch { return null; }
}
/** يزرع سجلاً يدوياً (لمحاكاة حجز عالق/فاشل سابق). */
function seedIdemRecord(key: string, record: Record<string, unknown>): void {
  let records: Record<string, any> = {};
  try { records = JSON.parse(readFileSync(IDEMP_FILE, 'utf8'))?.records || {}; } catch { records = {}; }
  records[key] = { key, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...record };
  writeFileSync(IDEMP_FILE, JSON.stringify({ records }, null, 2), 'utf8');
}

async function main(): Promise<void> {
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: { showroom: { name: 'معرض الغرابي' }, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [] },
  }), 'utf8');

  const mock: { server: Server; state: FacebookMockState; base: string; stop: () => Promise<void> } =
    await startFacebookMockServer(FB_PORT, createFacebookMock());
  let app = startApp(mock.base);
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());

    group('1) تكامل: ربط Facebook (خادم Graph وهمي) + إعلان منع التكرار الدائم');
    const startRes = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
    const state = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
    const cbRes = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(state)}&code=TESTCODE`);
    check('callback ينجح بالصفحة الواحدة', cbRes.status === 200, `status=${cbRes.status}`);
    const readiness = await (await fetch(`${BASE}/api/readiness`)).json();
    check('readiness يعلن كتلة منع التكرار الدائم', readiness?.persistence?.idempotency?.table === 'gharabi_idempotency', JSON.stringify(readiness?.persistence?.idempotency));
    check('readiness يعلن الخلفية (file في غياب Postgres)', readiness?.persistence?.idempotency?.backend === 'file', JSON.stringify(readiness?.persistence?.idempotency));

    group('2) تكامل: طلبان متزامنان لنفس الرد => نداء مزود واحد فقط');
    await ingest(auth, 'C_CONC', 'عاشت إيدكم على الخدمة');
    const before = mock.state.commentReplies.length;
    const [r1, r2] = await Promise.all([
      reply(auth, 'C_CONC', 'هلا بيك، نورتنا، فريق المعرض في خدمتك.'),
      reply(auth, 'C_CONC', 'هلا بيك، نورتنا، فريق المعرض في خدمتك.'),
    ]);
    const statuses = [r1.status, r2.status].sort();
    check('طلب واحد نجح والآخر رُفض', statuses[0] === 200 && statuses[1] === 409, `statuses=${statuses.join(',')}`);
    check('نداء مزود واحد فقط (لا رد مكرر)', mock.state.commentReplies.length === before + 1, `replies=${mock.state.commentReplies.length - before}`);
    const blocked = [r1, r2].find((r) => r.status === 409);
    check('سبب الرفض صريح (قيد التنفيذ/مكتمل)', ['REPLY_IN_PROGRESS', 'IDEMPOTENT_OPERATION_IN_PROGRESS', 'IDEMPOTENT_ALREADY_COMPLETED'].includes(blocked?.body?.code), JSON.stringify(blocked?.body).slice(0, 200));

    group('3) تكامل: إعادة تشغيل فعلية ثم نفس الطلب => لا نداء ثانٍ (لا يصمد القفل الداخلي)');
    const doneKey = 'facebook:comment_reply:C_CONC';
    check('الحجز المُكتمل موسوم done في المخزن', readIdemRecord(doneKey)?.status === 'done', JSON.stringify(readIdemRecord(doneKey)));
    const repliesBeforeRestart = mock.state.commentReplies.length;
    await stop(app.proc);
    app = startApp(mock.base);
    check('الخادم يقلع بعد إعادة التشغيل', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());
    const afterRestart = await reply(auth, 'C_CONC', 'هلا بيك، نورتنا، فريق المعرض في خدمتك.');
    check('بعد إعادة التشغيل: رُفض 409 (لا نداء مزود)', afterRestart.status === 409, `status=${afterRestart.status} body=${JSON.stringify(afterRestart.body).slice(0, 200)}`);
    check('الرفض من الحجز الدائم لا من الذاكرة', afterRestart.body?.code === 'IDEMPOTENT_ALREADY_COMPLETED', JSON.stringify(afterRestart.body).slice(0, 200));
    check('لا نداء مزود ثانٍ بعد إعادة التشغيل', mock.state.commentReplies.length === repliesBeforeRestart, `replies=${mock.state.commentReplies.length}`);

    group('4) تكامل: حجز عالق منتهي المدة => يُسمح بإعادة الحجز');
    await ingest(auth, 'C_STALE', 'عاشت إيدكم على الخدمة');
    seedIdemRecord('facebook:comment_reply:C_STALE', {
      status: 'reserved',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const staleBefore = mock.state.commentReplies.length;
    const staleRes = await reply(auth, 'C_STALE', 'هلا بيك، نورتنا، فريق المعرض في خدمتك.');
    check('الحجز العالق المنتهي يُعاد حجزه => الرد ينجح', staleRes.status === 200, `status=${staleRes.status} body=${JSON.stringify(staleRes.body).slice(0, 200)}`);
    check('وصل نداء مزود فعلي بعد استرداد الحجز العالق', mock.state.commentReplies.length === staleBefore + 1);
    check('الحجز أصبح done بعد النجاح', readIdemRecord('facebook:comment_reply:C_STALE')?.status === 'done');

    group('4ب) تكامل: حجز حيّ (قيد التنفيذ في نسخة أخرى) => رفض بلا نداء مزود');
    // هذا ما لا يستطيعه القفل الداخلي: حجز قائم في المخزن المشترك (نسخة أخرى/دورة)
    // بلا أي قفل في هذه العملية ولا سجل رد سابق. الكود القديم يُرسل؛ الجديد يرفض.
    await ingest(auth, 'C_LIVE', 'عاشت إيدكم على الخدمة');
    seedIdemRecord('facebook:comment_reply:C_LIVE', {
      status: 'reserved',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    const liveBefore = mock.state.commentReplies.length;
    const liveRes = await reply(auth, 'C_LIVE', 'شكراً لكم على تواصلكم معنا، نحن في الخدمة.');
    check('الحجز الحيّ في المخزن يرفض الرد (409)', liveRes.status === 409, `status=${liveRes.status}`);
    check('الرفض من الحجز الدائم (IDEMPOTENT_OPERATION_IN_PROGRESS)', liveRes.body?.code === 'IDEMPOTENT_OPERATION_IN_PROGRESS', JSON.stringify(liveRes.body).slice(0, 200));
    check('لا نداء مزود عند رفض الحجز الحيّ', mock.state.commentReplies.length === liveBefore, `replies=${mock.state.commentReplies.length}`);

    group('5) تكامل: الفشل المؤكد يوسم failed ثم يُسمح بإعادة المحاولة');
    await ingest(auth, 'C_FAIL', 'عاشت إيدكم على الخدمة');
    mock.state.failCommentReply = true;
    // نص رد مميّز لكل تعليق (بوابة «تكرار نفس النص» تمنع نفس النص على تعليقات كثيرة).
    const failRes = await reply(auth, 'C_FAIL', 'شكراً جزيلاً لثقتكم بنا، نحن بخدمتكم دائماً.');
    check('فشل المزود => 502 بلا تسليم', failRes.status === 502 && failRes.body?.delivered === false, `status=${failRes.status}`);
    check('الحجز الفاشل موسوم failed (يسمح بإعادة المحاولة)', readIdemRecord('facebook:comment_reply:C_FAIL')?.status === 'failed', JSON.stringify(readIdemRecord('facebook:comment_reply:C_FAIL')));
    mock.state.failCommentReply = false;
    // إعادة المحاولة: نُزرع سجل failed نظيف لتعليق بلا سجل رد سابق (لتفادي بوابة
    // منع التكرار في السجل) ونثبت أن الحجز الفاشل لا يمنع التنفيذ.
    await ingest(auth, 'C_RETRY', 'عاشت إيدكم على الخدمة');
    seedIdemRecord('facebook:comment_reply:C_RETRY', { status: 'failed', expiresAt: new Date(Date.now() - 1000).toISOString() });
    const retryBefore = mock.state.commentReplies.length;
    const retryRes = await reply(auth, 'C_RETRY', 'أهلاً وسهلاً بكم، يسعدنا خدمتكم في أي وقت.');
    check('الحجز الفاشل يسمح بإعادة المحاولة => الرد ينجح', retryRes.status === 200, `status=${retryRes.status} body=${JSON.stringify(retryRes.body).slice(0, 200)}`);
    check('وصل نداء مزود فعلي عند إعادة المحاولة', mock.state.commentReplies.length === retryBefore + 1);

    group('6) تكامل: انقطاع بعد الإرسال (بلا رد مزود) => الحجز يبقى reserved => طلب ثانٍ يُرفض 409');
    await ingest(auth, 'C_HANG', 'عاشت إيدكم على الخدمة');
    mock.state.hangCommentReply = true;
    const hangBefore = mock.state.commentReplies.length;
    // الطلب الأول: نداء مزود يخرج فعلاً ثم ينقطع بلا استجابة (لا نعرف هل نُفِّذ).
    const hangRes = await reply(auth, 'C_HANG', 'شكراً لكم على تواصلكم، نحن في خدمتكم دائماً وبكل سرور.');
    check('الانقطاع بعد الإرسال => 502 بلا تسليم مؤكد', hangRes.status === 502, `status=${hangRes.status} body=${JSON.stringify(hangRes.body).slice(0, 200)}`);
    check('خرج نداء مزود فعلاً قبل الانقطاع', mock.state.commentReplies.length === hangBefore + 1, `replies=${mock.state.commentReplies.length}`);
    // المفتاح الأساسي: لا فشل مؤكد (failed) بل حجز محفوظ (reserved) — يمنع تكراراً فورياً.
    check('الحجز بعد الانقطاع يبقى reserved (لا failed)', readIdemRecord('facebook:comment_reply:C_HANG')?.status === 'reserved', JSON.stringify(readIdemRecord('facebook:comment_reply:C_HANG')));
    mock.state.hangCommentReply = false;
    // طلب فوري ثانٍ على نفس التعليق: يجب أن يُرفض 409 بلا نداء مزود ثانٍ.
    const hangSecond = await reply(auth, 'C_HANG', 'أهلاً وسهلاً بكم، يسعدنا خدمتكم في أي وقت.');
    check('الطلب الفوري الثاني بعد الانقطاع يُرفض 409', hangSecond.status === 409, `status=${hangSecond.status}`);
    check('الرفض من الحجز المحفوظ (IDEMPOTENT_OPERATION_IN_PROGRESS)', hangSecond.body?.code === 'IDEMPOTENT_OPERATION_IN_PROGRESS', JSON.stringify(hangSecond.body).slice(0, 200));
    check('لا نداء مزود ثانٍ بعد الانقطاع', mock.state.commentReplies.length === hangBefore + 1, `replies=${mock.state.commentReplies.length}`);

    group('7) وحدة: تصنيف نتيجة العملية الخارجية (pending_quota + الانقطاع ≠ فشل مؤكد)');
    check('نجاح => done', classifyExternalOperationOutcome({ ok: true }) === 'done');
    check('انتظار حصة => pending_quota (لا done)', classifyExternalOperationOutcome({ ok: false, pending: true }) === 'pending_quota');
    check('انتظار الحصة يتقدّم على ok=200 (لا يُعدّ done)', classifyExternalOperationOutcome({ ok: true, pending: true }) === 'pending_quota');
    check('انقطاع بعد الإرسال => null (يبقى reserved)', classifyExternalOperationOutcome({ ok: false, failureKind: 'network_after_send' }) === null);
    check('رفض مزود => failed', classifyExternalOperationOutcome({ ok: false, failureKind: 'provider_rejected' }) === 'failed');
    check('فشل قبل النداء => failed', classifyExternalOperationOutcome({ ok: false, failureKind: 'pre_provider' }) === 'failed');
    check('pending_quota قابل لإعادة الحجز (لا يمنع)', decideReservation({ key: 'k', status: 'pending_quota', createdAt: '', updatedAt: '', expiresAt: '' }, Date.now()).reserve === true);
    check('done لا يُعاد حجزه أبداً', decideReservation({ key: 'k', status: 'done', createdAt: '', updatedAt: '', expiresAt: '' }, Date.now()).reserve === false);

    console.log(`\nPASSED: ${passed} idempotency-durable checks`);
    if (failures.length) {
      console.error('FAILURES:');
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
    }
  } finally {
    try { await stop(app.proc); } catch { /* تجاهل */ }
    try { await mock.stop(); } catch { /* تجاهل */ }
    rmSync(stateDir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
