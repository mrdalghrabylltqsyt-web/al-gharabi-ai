/**
 * اختبار انحدار — إصلاح جذر خطأ حقل `is_published` في تشخيص ظهور منشور Facebook.
 *
 * الجذر المُثبت: كان `getPostGrounding` يطلب `is_published` دائماً، فترد Meta
 * `(#100) Tried accessing nonexisting field (is_published)` على أنواع عقد لا تدعمه
 * (مثل Video)، فيفشل التشخيص بالكامل بخطأ PROVIDER_ERROR بلا دليل.
 *
 * الإصلاح: قراءة ذكية (قائمة كاملة → احتياطي أساسي عند رفض الحقل → عزل الحقل غير
 * المدعوم حقلاً حقلاً)، فينجح الفحص ويُعلن الحقل غير المدعوم صراحةً بدل إسقاطه.
 *
 * اختباران: وحدة (منطق صافٍ) + تكامل حقيقي (خادم الغرابي + خادم Graph وهمي يحاكي
 * #100 على حقل). لا يلمس أي مزود Meta حقيقي ولا يستهلك أي حصة ولا أي سرّ واقعي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  FacebookClient,
  interpretPostGrounding,
  buildPostVisibilityDiagnosis,
  FACEBOOK_POST_GROUNDING_FIELDS,
  FACEBOOK_POST_GROUNDING_FALLBACK_FIELDS,
} from '../social/facebook';
import { createFacebookMock, startFacebookMockServer } from './helpers/facebookMock';

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
const APP_PORT = 6900 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FB_PORT = 6980 + Math.floor(Math.random() * 60);
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'fb-postgrounding-test-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-fbpg-'));

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
    FACEBOOK_APP_SECRET: 'fb_test_app_secret_not_real_1234567890',
    FACEBOOK_VERIFY_TOKEN: 'fb_test_verify_token_not_real',
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
async function connectFacebook(auth: Record<string, string>): Promise<void> {
  const start = await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth });
  const sb = await start.json();
  const state = new URL(sb.authorizationUrl).searchParams.get('state');
  await fetch(`${BASE}/api/platforms/facebook/oauth/callback?code=TESTCODE&state=${encodeURIComponent(state!)}`);
}

async function unitTests(): Promise<void> {
  group('وحدة: ثوابت الحقول + تفسير + بناء الحكم');
  check('قائمة الحقول الكاملة تضمّ is_published', (FACEBOOK_POST_GROUNDING_FIELDS as readonly string[]).includes('is_published'));
  check('قائمة الاحتياطي لا تضمّ is_published (تعمل على كل الأنواع)', !(FACEBOOK_POST_GROUNDING_FALLBACK_FIELDS as readonly string[]).includes('is_published'));
  check('قائمة الاحتياطي تضمّ id وcreated_time وpermalink_url',
    (FACEBOOK_POST_GROUNDING_FALLBACK_FIELDS as readonly string[]).includes('id')
    && (FACEBOOK_POST_GROUNDING_FALLBACK_FIELDS as readonly string[]).includes('created_time')
    && (FACEBOOK_POST_GROUNDING_FALLBACK_FIELDS as readonly string[]).includes('permalink_url'));

  const g = interpretPostGrounding('video', { id: 'V1', is_published: true, created_time: 'x', permalink_url: 'https://fb/V1' }, null);
  check('is_published=true ⇒ isPublished=true', g.isPublished === true && g.confirmedPublicStory === true);
  check('permalink يُقرأ', g.permalink === 'https://fb/V1');

  const diagDraft = buildPostVisibilityDiagnosis(interpretPostGrounding('post', { id: 'P1', is_published: false }, null));
  check('مسودة ⇒ verdict=draft_or_scheduled', diagDraft.verdict === 'draft_or_scheduled');
  const diagStory = buildPostVisibilityDiagnosis(interpretPostGrounding('post', { id: 'P2', is_published: true }, true));
  check('منشور على الحائط ⇒ published_and_returns_as_story', diagStory.verdict === 'published_and_returns_as_story');
  check('لا ادّعاء ظهور عام (proofOfPublicVisibility=false دائماً)', diagStory.evidenceSummary.proofOfPublicVisibility === false);
  const diagMissing = buildPostVisibilityDiagnosis(interpretPostGrounding('post', {}, null));
  check('غير موجود ⇒ post_not_found', diagMissing.verdict === 'post_not_found');
}

async function clientUnitTests(): Promise<void> {
  group('وحدة: FacebookClient.getPostGrounding — السقوط للاحتياطي + عزل الحقل غير المدعوم');
  const reads: string[] = [];
  const fakeFetch = async (url: string) => {
    const u = new URL(url);
    const fields = u.searchParams.get('fields') || '';
    reads.push(fields);
    const requested = fields.split(',').map((s) => s.trim());
    if (requested.includes('is_published')) {
      return { ok: false, status: 400, json: async () => ({ error: { message: 'Tried accessing nonexisting field (is_published) on node type "Video"', code: 100 } }) };
    }
    return { ok: true, status: 200, json: async () => ({ id: 'V9', created_time: '2026-01-01T00:00:00+0000', permalink_url: 'https://fb/V9' }) };
  };
  const client = new FacebookClient(fakeFetch as any);
  const res = await client.getPostGrounding('PAGE_1', 'TOKEN', 'V9');
  check('الفحص ينجح رغم رفض is_published (لا إسقاط)', res.ok === true && res.data?.exists === true);
  check('isPublished يبقى null (لا اختراع قيمة بديلة)', res.data?.isPublished === null);
  check('permalink يُقرأ في الاحتياطي', res.data?.permalink === 'https://fb/V9');
  check('is_published مُعلن كحقل غير مدعوم صراحةً', (res.data?.unsupportedFields || []).includes('is_published'));
  check('fieldRead يعلن السقوط للاحتياطي', res.data?.fieldRead?.usedFallback === true);
  check('fieldRead يعلن رمز خطأ Meta الأول (100)', res.data?.fieldRead?.providerCode === 100);
  check('fieldRead يحمل رسالة Meta الحقيقية', /nonexisting field \(is_published\)/.test(String(res.data?.fieldRead?.providerMessage || '')));
  check('أول قراءة طلبت القائمة الكاملة', reads[0] === FACEBOOK_POST_GROUNDING_FIELDS.join(','));
  check('القراءة الثانية (الاحتياطي) لم تطلب is_published', reads[1] === FACEBOOK_POST_GROUNDING_FALLBACK_FIELDS.join(','));
}

async function integrationTests(): Promise<void> {
  group('تكامل: خادم Graph وهمي يرفض is_published (#100) — التشخيص ينجح ويُعلن الحقل');
  const mock = await startFacebookMockServer(FB_PORT, createFacebookMock({ unsupportedNodeFields: ['is_published'] }));
  const app = startApp(mock.base);
  try {
    if (!(await waitForHealth())) throw new Error('لم يقلع الخادم: ' + app.log().slice(-800));
    const auth = await login();
    await connectFacebook(auth);
    const res = await fetch(`${BASE}/api/platforms/facebook/post-visibility-diagnosis?postId=1996560830806773`, { headers: auth });
    check('التشخيص يرد 200 (لا 502 كما قبل الإصلاح)', res.status === 200, `status=${res.status}`);
    const body = await res.json();
    check('نجح grounding رغم رفض الحقل', body.success === true && body.grounding?.exists === true, JSON.stringify(body).slice(0, 250));
    check('is_published مُعلن غير مدعوم صراحةً', (body.fieldDiagnostics?.unsupportedFields || []).includes('is_published'));
    check('isPublishedSupported=false معلنة', body.fieldDiagnostics?.isPublishedSupported === false);
    check('الاحتياطي استُخدم', body.fieldDiagnostics?.usedFallback === true);
    check('رمز خطأ Meta الأول معلن (100)', body.fieldDiagnostics?.firstReadProviderCode === 100);
    check('الرسالة الحقيقية معلنة بلا قطع', /nonexisting field \(is_published\)/.test(String(body.fieldDiagnostics?.firstReadProviderMessage || '')));
    check('isPublished يبقى null (لا اختراع)', body.grounding?.isPublished === null);
    check('الحكم الصادق (لا ادّعاء ظهور عام)', body.evidenceSummary?.proofOfPublicVisibility === false);
    check('لا سرّ في الاستجابة (لا access_token)', !JSON.stringify(body).includes('access_token'));
    const anon = await fetch(`${BASE}/api/platforms/facebook/post-visibility-diagnosis`);
    check('التشخيص بلا جلسة مرفوض (401)', anon.status === 401, String(anon.status));
  } finally {
    await stop(app.proc);
    await mock.stop();
  }
}

async function main(): Promise<void> {
  await unitTests();
  await clientUnitTests();
  await integrationTests();
  console.log(`\n${'─'.repeat(60)}`);
  if (failures.length) { console.log(`FAILED: ${failures.length} / ${passed + failures.length}`); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  console.log(`PASSED: ${passed} fb post-grounding regression checks`);
  process.exit(0);
}
main().catch((e) => { console.error('CRASH', e); process.exit(1); });
