/**
 * اختبار موصل Google Business Profile الحقيقي (G3) — نشر localPosts.
 *
 * طبقتان:
 *  1) وحدة: التحقق من المنشور، بناء الجسم، تحليل اسم المورد، تصنيف الأخطاء — بلا شبكة.
 *  2) تكامل: الخادم الحقيقي + خادم Google Business وهمي محلي: قراءة الحساب/الموقع،
 *     نشر localPost بمعرّف حقيقي من Google، حجب النشر بلا اتصال موثق، وحجب محتوى
 *     غير صالح. لا يلمس Google الحقيقي ولا يستهلك حصة.
 *
 * ملاحظة: الربط الحي لـGoogle Business يحتاج اعتماد OAuth صحيحاً من المالك (خارج
 * نطاق هذا الاختبار). هنا نزرع اعتماداً مشفّراً صالحاً ونوجّه قواعد API للخادم الوهمي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  validateGoogleBusinessPost,
  buildGoogleBusinessPostBody,
  parseLocationResourceName,
  classifyGoogleBusinessError,
  GOOGLE_BUSINESS_SUMMARY_MAX,
} from '../social/googleBusiness';
import { createGoogleBusinessMock, startGoogleBusinessMockServer } from './helpers/googleBusinessMock';

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
const APP_PORT = 7640 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const GB_PORT = 7740 + Math.floor(Math.random() * 100);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'google-business-test-secret-not-real';
const GB_ACCESS_TOKEN = 'ya29.test_google_business_access_token';
const GB_REFRESH_TOKEN = '1//test_google_business_refresh_token';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-gb-'));

function startApp(gbBase: string, stateDirOverride: string = stateDir, tokenKey: string = randomBytes(32).toString('hex')): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDirOverride,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    GOOGLE_BUSINESS_ACCOUNT_BASE: gbBase,
    GOOGLE_BUSINESS_INFO_BASE: gbBase,
    GOOGLE_BUSINESS_POSTS_BASE: gbBase,
    PLATFORM_TOKEN_ENCRYPTION_KEY: tokenKey,
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

async function unitTests(): Promise<void> {
  group('1) وحدة: التحقق من منشور localPost');
  const ok = validateGoogleBusinessPost({ summary: 'عرض جديد في معرض الغرابي للتقسيط.', topicType: 'STANDARD' });
  check('منشور صالح', ok.ok === true);
  const empty = validateGoogleBusinessPost({ summary: '   ' });
  check('ملخّص فارغ ⇒ مرفوض', empty.ok === false && empty.code === 'SUMMARY_REQUIRED');
  const tooLong = validateGoogleBusinessPost({ summary: 'x'.repeat(GOOGLE_BUSINESS_SUMMARY_MAX + 1) });
  check('ملخّص أطول من الحد ⇒ مرفوض', tooLong.ok === false && tooLong.code === 'SUMMARY_TOO_LONG');
  const badTopic = validateGoogleBusinessPost({ summary: 'نص صالح', topicType: 'NOPE' });
  check('نوع موضوع غير صالح ⇒ مرفوض', badTopic.ok === false && badTopic.code === 'INVALID_TOPIC_TYPE');
  const badLink = validateGoogleBusinessPost({ summary: 'نص صالح', linkUrl: 'not a url' });
  check('رابط غير صالح ⇒ مرفوض', badLink.ok === false && badLink.code === 'INVALID_LINK');

  group('2) وحدة: بناء جسم المنشور (summary + callToAction اختياري)');
  const bodyNoLink = buildGoogleBusinessPostBody({ summary: 'عرض الغرابي' }) as any;
  check('بلا رابط: summary فقط بلا callToAction', bodyNoLink.summary === 'عرض الغرابي' && bodyNoLink.callToAction === undefined);
  const bodyLink = buildGoogleBusinessPostBody({ summary: 'عرض الغرابي', linkUrl: 'https://example.com/offer' }) as any;
  check('مع رابط: callToAction.url صحيح', bodyLink.callToAction?.url === 'https://example.com/offer');
  check('بلا أي قيمة سرّية في الجسم', !JSON.stringify(bodyLink).includes('token'));

  group('3) وحدة: تحليل اسم مورد الموقع');
  const parsed = parseLocationResourceName('accounts/1122334455/locations/9988776655');
  check('تحليل accounts/locations صحيح', parsed?.accountId === '1122334455' && parsed?.locationId === '9988776655');
  check('اسم غير صالح ⇒ null', parseLocationResourceName('nonsense') === null);

  group('4) وحدة: تصنيف أخطاء Google');
  check('PERMISSION_DENIED ⇒ PERMISSION_DENIED', classifyGoogleBusinessError('The caller does not have permission', 403, 'PERMISSION_DENIED') === 'PERMISSION_DENIED');
  check('401/UNAUTHENTICATED ⇒ TOKEN_EXPIRED', classifyGoogleBusinessError('Invalid Credentials', 401, 'UNAUTHENTICATED') === 'TOKEN_EXPIRED');
  check('404 ⇒ LOCATION_NOT_FOUND', classifyGoogleBusinessError('Requested entity was not found.', 404, 'NOT_FOUND') === 'LOCATION_NOT_FOUND');
}

async function integrationTests(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  const mock = await startGoogleBusinessMockServer(GB_PORT, createGoogleBusinessMock());
  // نزرع اعتماد Google Business مشفّراً صالحاً + اتصالاً موثقاً، فلا نعتمد على OAuth حي.
  // نفس شكل `encryptSecret` في الخادم: {alg, iv, tag, data} بترميز base64url.
  const storeKey = randomBytes(32).toString('hex');
  const encKey = Buffer.from(storeKey, 'hex');
  const { createCipheriv } = await import('node:crypto');
  function encrypt(obj: any): any {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encKey, iv);
    const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
    return { alg: 'aes-256-gcm', iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: enc.toString('base64url') };
  }
  const providerTokens = { google_business: encrypt({
    access_token: GB_ACCESS_TOKEN,
    refresh_token: GB_REFRESH_TOKEN,
    expiresAt: Date.now() + 3600_000,
    accountResource: mock.state.accountResource,
    accountName: mock.state.accountName,
    connectedAt: new Date().toISOString(),
  }) };
  // الحالة تُحفظ في ملف الحالة داخل STATE_DIR بصيغة اللقطة (platformConnections مصفوفة).
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(), users: [], revokedSessions: [], userRevocations: [], audit: [], jobs: [],
    platformConnections: [{ platform: 'google_business', status: 'connected', accountId: mock.state.accountResource, accountName: mock.state.accountName, connectedAt: new Date().toISOString(), providerVerified: true }],
    workspace: { showroom: { name: 'معرض الغرابي' }, providerTokens, products: [], posts: [], socialComments: [], socialReplies: [], publishRecords: [] },
  }), 'utf8');
  const app = startApp(mock.base, stateDir, storeKey);
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    const auth = await login();

    group('5) تكامل: النشر ينشئ localPost حقيقياً بمعرّف من Google');
    const pub = await (await fetch(`${BASE}/api/platforms/google_business/publish`, {
      method: 'POST', headers: auth, body: JSON.stringify({ content: 'أهلاً بكم في معرض الغرابي للتقسيط، تجدون أحدث الأجهزة بالتقسيط المريح.', approved: true, linkUrl: 'https://example.com/offer' }),
    })).json();
    check('النشر نجح بمعرّف منشور حقيقي', pub.success === true && typeof pub.providerPostId === 'string' && pub.providerPostId.includes('localPosts'), JSON.stringify(pub).slice(0, 400));
    check('المنشور وصل فعلاً للـmock', mock.state.posts.length === 1 && mock.state.posts[0].summary.includes('معرض الغرابي'), JSON.stringify(mock.state.posts));
    check('الرابط أُرسل فعلاً', mock.state.posts[0]?.linkUrl === 'https://example.com/offer', JSON.stringify(mock.state.posts));
    check('لا يكشف أي سرّ', !JSON.stringify(pub).includes(GB_ACCESS_TOKEN) && !JSON.stringify(pub).includes(GB_REFRESH_TOKEN));

    group('6) تكامل: بلا موافقة ⇒ 409 (لا نشر)');
    const noApproval = await (await fetch(`${BASE}/api/platforms/google_business/publish`, {
      method: 'POST', headers: auth, body: JSON.stringify({ content: 'نص', approved: false }),
    })).json();
    check('بلا موافقة ⇒ APPROVAL_REQUIRED', noApproval.code === 'APPROVAL_REQUIRED' && mock.state.posts.length === 1);

    group('7) تكامل: محتوى غير صالح (فارغ) ⇒ 400 بلا نداء مزوّد');
    const noContent = await (await fetch(`${BASE}/api/platforms/google_business/publish`, {
      method: 'POST', headers: auth, body: JSON.stringify({ content: '   ', approved: true }),
    })).json();
    check('محتوى فارغ ⇒ CONTENT_REQUIRED', noContent.code === 'CONTENT_REQUIRED' && mock.state.posts.length === 1);

    group('8) تكامل: فشل المزود يُعلن صراحةً بلا معرّف مختلق');
    mock.state.failPublish = true;
    const failed = await (await fetch(`${BASE}/api/platforms/google_business/publish`, {
      method: 'POST', headers: auth, body: JSON.stringify({ content: 'منشور سيفشل', approved: true }),
    })).json();
    mock.state.failPublish = false;
    check('فشل المزود ⇒ success=false بلا معرّف', failed.success === false && (failed.record?.providerPostId === null || failed.providerPostId === undefined), JSON.stringify(failed).slice(0, 200));

    group('9) تكامل: التصريح (401 بلا جلسة)');
    const noAuth = await fetch(`${BASE}/api/platforms/google_business/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'x', approved: true }) });
    check('بلا جلسة ⇒ 401', noAuth.status === 401);

    group('10) تكامل: الجاهزية تُعلن النشر لـGoogle Business');
    const readiness = await (await fetch(`${BASE}/api/platforms/production-readiness`, { headers: auth })).json();
    const gb = readiness.platforms?.find((p: any) => p.platform === 'google_business');
    check('readiness: Google Business موصل حقيقي', gb?.realConnector === true, JSON.stringify(gb).slice(0, 160));
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
  console.log(`PASSED: ${passed} google business connector checks`);
}
void main();
