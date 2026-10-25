/**
 * اختبار انحدار — صدق حالة نشر TikTok (رفع مسودة مقابل نشر مباشر) + تشخيص خام.
 *
 * الجذر المُثبت المحتمل: يُسجَّل «تم النشر» بمعرّف حقيقي لكن لا يظهر على TikTok.
 * السبب الأرجح (موثّق مسبقاً): المسار الفعلي MEDIA_UPLOAD (صندوق مسودات TikTok)
 * لا ينشر شيئاً علناً إطلاقاً — يحتاج إكمالاً يدوياً من تطبيق TikTok.
 *
 * الإصلاح: (1) رسالة صادقة موحّدة تُعلن ذلك بوضوح، (2) مسار تشخيص خام (owner فقط)
 * يحسم أي الاحتمالات الثلاثة (أ/ب/ج) بالأدلة الحية بلا تخمين.
 *
 * اختباران: وحدة (نصوص/منطق) + تكامل حقيقي (خادم الغرابي + خادم TikTok وهمي محلي).
 * لا يلمس أي مزود TikTok حقيقي ولا يستهلك أي حصة ولا أي سرّ واقعي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { TIKTOK_DRAFT_PENDING_OWNER_NOTE, TIKTOK_DIRECT_POST_PENDING_NOTE } from '../social/tiktok';
import { createTikTokMock, startTikTokMockServer } from './helpers/tiktokMock';
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
const TT_PORT = await reserveFreePort();
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'tiktok-visibility-test-secret-not-real';
const TT_CLIENT_KEY = 'test_tiktok_client_key';
const TT_CLIENT_SECRET = 'test-tiktok-client-secret-not-real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-ttvis-'));

function startApp(ttBase: string): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    TIKTOK_API_BASE: ttBase,
    TIKTOK_CLIENT_KEY: TT_CLIENT_KEY,
    TIKTOK_CLIENT_SECRET: TT_CLIENT_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
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
async function connectTikTok(auth: Record<string, string>): Promise<void> {
  const start = await (await fetch(`${BASE}/api/platforms/tiktok/oauth/start`, { headers: auth })).json();
  const state = new URL(start.authorizationUrl).searchParams.get('state');
  await fetch(`${BASE}/api/platforms/tiktok/oauth/callback?code=AUTHCODE_TEST&state=${encodeURIComponent(state!)}`, { headers: auth });
}

function unitTests(): void {
  group('وحدة: النصوص الصادقة + منع الالتباس');
  check('نص رفع المسودة يعلن «صندوق مسودات TikTok»', /صندوق مسودات TikTok/.test(TIKTOK_DRAFT_PENDING_OWNER_NOTE));
  check('نص رفع المسودة يعلن أنه لا يظهر علناً إطلاقاً', /لا يظهر علناً/.test(TIKTOK_DRAFT_PENDING_OWNER_NOTE));
  check('نص رفع المسودة يذكر MEDIA_UPLOAD صراحةً', /MEDIA_UPLOAD/.test(TIKTOK_DRAFT_PENDING_OWNER_NOTE));
  check('نص رفع المسودة يوجّه لإكمال النشر من التطبيق', /تطبيق TikTok/.test(TIKTOK_DRAFT_PENDING_OWNER_NOTE) && /يُكمل|تُكمل|إكمال/.test(TIKTOK_DRAFT_PENDING_OWNER_NOTE));
  check('نص النشر المباشر يعلن أنه تهيئة لا تسليم', /تهيئة/.test(TIKTOK_DIRECT_POST_PENDING_NOTE) && /PUBLISH_COMPLETE/.test(TIKTOK_DIRECT_POST_PENDING_NOTE));
  check('نص رفع المسودة لا يدّعي اكتمال النشر العام', !/تم النشر|اكتمل النشر/.test(TIKTOK_DRAFT_PENDING_OWNER_NOTE));
}

async function integrationTests(): Promise<void> {
  group('تكامل: رفع مسودة TikTok => رسالة صادقة + تشخيص خام يحسم الحالة (أ)');
  const mock = await startTikTokMockServer(TT_PORT, createTikTokMock());
  const app = startApp(mock.base);
  try {
    if (!(await waitForHealth())) throw new Error('لم يقلع الخادم: ' + app.log().slice(-800));
    const auth = await login();
    await connectTikTok(auth);

    // (1) رفع مسودة (MEDIA_UPLOAD) — المسار الذي لا ينشر علناً.
    const draft = await fetch(`${BASE}/api/platforms/tiktok/publish`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ content: 'مسودة عرض الغرابي', approved: true, videoUrl: 'https://example.invalid/draft.mp4', postMode: 'MEDIA_UPLOAD' }),
    });
    const draftBody = await draft.json();
    check('رفع المسودة ينجح', draft.status === 200 && Boolean(draftBody.providerPublishId), JSON.stringify(draftBody).slice(0, 200));
    check('الوضع المُعلن MEDIA_UPLOAD', draftBody.postMode === 'MEDIA_UPLOAD');
    check('الرسالة تعلن صندوق مسودات TikTok (لا نشر عام)', /صندوق مسودات TikTok/.test(String(draftBody.note || '')), String(draftBody.note));
    check('الرسالة توجّه لإكمال النشر يدوياً من التطبيق', /تطبيق TikTok/.test(String(draftBody.note || '')));
    check('لا ادّعاء تسليم (delivered=false)', draftBody.delivered === false);

    // (2) تشخيص خام: يحسم الحالة (أ) = MEDIA_UPLOAD.
    const anon = await fetch(`${BASE}/api/platforms/tiktok/publish-diagnosis`);
    check('التشخيص بلا جلسة => 401 (owner فقط)', anon.status === 401, String(anon.status));
    const diag = await (await fetch(`${BASE}/api/platforms/tiktok/publish-diagnosis`, { headers: auth })).json();
    check('التشخيص ينجح', diag.success === true);
    check('التشخيص يحدّد الوضع الفعلي MEDIA_UPLOAD من السجل', diag.record?.postMode === 'MEDIA_UPLOAD');
    check('التشخيص يحسم الحالة (أ)', diag.case === 'A', JSON.stringify({ c: diag.case, v: diag.verdict }).slice(0, 220));
    check('حكم (أ) يعلن صندوق المسودات ولا نشر عام', /صندوق مسودات TikTok/.test(String(diag.verdict || '')) && /لا نشر عام|لا يظهر/.test(String(diag.verdict || '')));
    check('التشخيص يجلب الحالة الخام من TikTok', diag.rawStatus?.rawStatus === 'PUBLISH_COMPLETE', JSON.stringify(diag.rawStatus));
    check('التشخيص يجلب معلومات الناشر (الحساب المستهدَف)', diag.creator?.nickname === mock.state.displayName);
    check('التشخيص يعلن قيود API (تعليقات/رسائل غير متاحة)', diag.apiLimits?.commentReply === 'NOT_AVAILABLE_BY_PUBLIC_API' && diag.apiLimits?.messageReply === 'NOT_AVAILABLE_BY_PUBLIC_API');
    check('التشخيص بلا أي سرّ', !JSON.stringify(diag).includes(TT_CLIENT_SECRET) && !JSON.stringify(diag).includes(mock.state.accessToken));

    // (3) نشر مباشر لكن المزود ما زال يعالج => الحالة (ب) عطل إعلان تسليم مبكر.
    mock.state.publishStatus = 'PROCESSING_UPLOAD';
    mock.state.publishId = 'publish_direct_processing';
    const direct = await fetch(`${BASE}/api/platforms/tiktok/publish`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ content: 'عرض مباشر قيد المعالجة', approved: true, videoUrl: 'https://example.invalid/direct.mp4', postMode: 'DIRECT_POST' }),
    });
    const directBody = await direct.json();
    check('النشر المباشر ينجح بالتهيئة', direct.status === 200 && directBody.postMode === 'DIRECT_POST');
    check('النشر المباشر لا يعلن تسليماً عند التهيئة', directBody.delivered === false);
    check('نص النشر المباشر يعلن أنه تهيئة لا تسليم', /PUBLISH_COMPLETE/.test(String(directBody.note || '')));
    const diagB = await (await fetch(`${BASE}/api/platforms/tiktok/publish-diagnosis?publishId=publish_direct_processing`, { headers: auth })).json();
    check('التشخيص يحسم الحالة (ب) للنشر المباشر غير المكتمل', diagB.case === 'B', JSON.stringify({ c: diagB.case, v: diagB.verdict }).slice(0, 220));
    check('حكم (ب) يذكر الحالة الفعلية PROCESSING_UPLOAD', /PROCESSING_UPLOAD/.test(String(diagB.verdict || '')));
    check('السجل يبقى غير مُسلَّم (لا published بلا PUBLISH_COMPLETE)', diagB.record?.state !== 'published' && diagB.record?.delivered === false);
  } finally {
    await stop(app.proc);
    await mock.stop();
  }
}

async function main(): Promise<void> {
  unitTests();
  await integrationTests();
  console.log(`\n${'─'.repeat(60)}`);
  if (failures.length) { console.log(`FAILED: ${failures.length} / ${passed + failures.length}`); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  console.log(`PASSED: ${passed} tiktok visibility regression checks`);
  process.exit(0);
}
main().catch((e) => { console.error('CRASH', e); process.exit(1); });
