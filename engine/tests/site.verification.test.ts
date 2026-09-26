/**
 * اختبارات التحقق من ملكية الرابط (TikTok URL prefix) والصفحات القانونية العامة.
 *
 * طبقتان:
 *  1) وحدة: بناء ملف التحقق (الاسم/المحتوى/النوع)، رفض الرمز غير الصالح، مطابقة
 *     المسار الجذري فقط، ومحتوى صفحات الشروط/الخصوصية (بلا بريد مختلق).
 *  2) تكامل: الخادم الحقيقي (production) يخدم:
 *     - `/tiktok<token>.txt` بحالة 200 ونوع text/plain وبالمحتوى الرسمي بالضبط،
 *       بلا تحويل وبلا HTML وبلا مصادقة (كما يطلب TikTok علناً).
 *     - الاسم البديل `tiktok-developers-site-verification.txt` بنفس المحتوى.
 *     - `/terms` و`/privacy` بحالة 200 ومحتوى قانوني عربي فعلي بلا مصادقة.
 *     - حالة `siteVerification` في /api/health و/api/readiness.
 *
 * لا يلمس أي مزوّد حقيقي ولا يستهلك أي حصة، ولا يستخدم أي سرّ واقعي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  buildTikTokVerificationFile,
  parseTikTokVerificationToken,
  verificationFileForPath,
  siteVerificationFiles,
  verificationFileUrl,
  SITE_VERIFICATION_PATH_PATTERN,
  TIKTOK_VERIFICATION_FILENAME,
  TIKTOK_VERIFICATION_CONTENT,
  TIKTOK_VERIFICATION_TOKEN,
  TIKTOK_SITE_VERIFICATION_PREFIX,
} from '../social/siteVerification';
import { buildTermsPage, buildPrivacyPage, legalPageForPath } from '../social/legalPages';

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
const APP_PORT = 7600 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'site-verification-test-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-verify-'));

function startApp(extraEnv: Record<string, string> = {}): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    ...extraEnv,
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

// -------------------------------------------------------------
// 1) وحدة: بناء ملف التحقق
// -------------------------------------------------------------
function unitTests(): void {
  group('بناء ملف التحقق (وحدة)');
  const file = buildTikTokVerificationFile('djxlJcC4WFlCh4OZY8IVHgezp491vPoZ');
  check('اسم الملف بصيغة tiktok<token>.txt', file.filename === 'tiktokdjxlJcC4WFlCh4OZY8IVHgezp491vPoZ.txt', file.filename);
  check('المحتوى سلسلة التوقيع الرسمية', file.content === 'tiktok-developers-site-verification=djxlJcC4WFlCh4OZY8IVHgezp491vPoZ', file.content);
  check('نوع المحتوى نص صريح', file.contentType.startsWith('text/plain'), file.contentType);
  check('الثابت الرسمي هو الرمز المطلوب', TIKTOK_VERIFICATION_TOKEN === 'djxlJcC4WFlCh4OZY8IVHgezp491vPoZ');
  check('اسم الملف الثابت مطابق للمبني', TIKTOK_VERIFICATION_FILENAME === file.filename);
  check('محتوى الثابت مطابق للمبني', TIKTOK_VERIFICATION_CONTENT === file.content);
  check('البادئة الرسمية صحيحة', TIKTOK_SITE_VERIFICATION_PREFIX === 'tiktok-developers-site-verification=');
  check('لا محرف سطر جديد في المحتوى', !file.content.includes('\n') && !file.content.includes('\r'));

  // رفض صريح للرموز غير الصالحة بدل إنتاج ملف لا يطابق ما يتوقّعه TikTok.
  let rejected = false;
  try { buildTikTokVerificationFile('has space'); } catch { rejected = true; }
  check('رمز فيه مسافة يُرفض', rejected);
  let rejected2 = false;
  try { buildTikTokVerificationFile('short'); } catch { rejected2 = true; }
  check('رمز قصير يُرفض', rejected2);
  let rejected3 = false;
  try { buildTikTokVerificationFile(''); } catch { rejected3 = true; }
  check('رمز فارغ يُرفض', rejected3);

  check('استخراج الرمز من الاسم', parseTikTokVerificationToken(file.filename) === 'djxlJcC4WFlCh4OZY8IVHgezp491vPoZ');
  check('رفض اسم غير مطابق', parseTikTokVerificationToken('other.txt') === null);

  const files = siteVerificationFiles();
  check('ملفان: الرسمي والبديل', files.length === 2 && files[0].filename === file.filename);
  check('الاسم البديل الشائع موجود', files.some((f) => f.filename === 'tiktok-developers-site-verification.txt'));
  check('البديل بنفس المحتوى', files[1].content === file.content);

  check('مطابقة المسار الجذري', verificationFileForPath('/' + file.filename)?.filename === file.filename);
  check('رفض مسار فرعي', verificationFileForPath('/sub/' + file.filename) === null);
  check('رفض مسار غير مطابق', verificationFileForPath('/other.txt') === null);
  check('صيغة المسار تطابق اسم الملف', SITE_VERIFICATION_PATH_PATTERN.test('/' + file.filename));
  check('صيغة المسار لا تطابق مساراً فرعياً', !SITE_VERIFICATION_PATH_PATTERN.test('/x/' + file.filename));
  check('بناء الرابط العام', verificationFileUrl('https://example.com/', file.filename) === `https://example.com/${file.filename}`);
  check('الرابط null بلا عنوان', verificationFileUrl(null, file.filename) === null);
}

// -------------------------------------------------------------
// 2) وحدة: الصفحات القانونية
// -------------------------------------------------------------
function legalUnitTests(): void {
  group('الصفحات القانونية (وحدة)');
  const terms = buildTermsPage({ contactEmail: 'owner@example.invalid', updatedAt: '2026-09-26T00:00:00.000Z' });
  const privacy = buildPrivacyPage({ contactEmail: 'owner@example.invalid', updatedAt: '2026-09-26T00:00:00.000Z' });
  check('صفحة الشروط عنوانها صحيح', terms.title === 'شروط الخدمة');
  check('صفحة الخصوصية عنوانها صحيح', privacy.title === 'سياسة الخصوصية');
  check('RTL عربي', terms.html.includes('dir="rtl"') && terms.html.includes('lang="ar"'));
  check('الشروط تحمل نصاً قانونياً فعلياً', terms.html.includes('نطاق الخدمة') && terms.html.includes('الاستخدام المقبول'));
  check('الخصوصية تصف البيانات المجمَّعة فعلاً', privacy.html.includes('رموز المنصّات') && privacy.html.includes('AES-256-GCM'));
  check('البريد الحقيقي يظهر حين يُضبط', terms.html.includes('owner@example.invalid'));
  check('لا اختراع بريد حين يغيب', !buildTermsPage({}).html.includes('@') || buildTermsPage({}).html.includes('المنشورة'));
  check('تاريخ التحديث يظهر', terms.html.includes('2026-09-26'));
  check('لا كود سرّي في الصفحة', !/eyJ|sk-|re_[A-Za-z0-9]{12,}/.test(terms.html + privacy.html));
  check('مرادف /terms-of-service يطابق', legalPageForPath('/terms-of-service')?.id === 'terms');
  check('مرادف /privacy-policy يطابق', legalPageForPath('/privacy-policy')?.id === 'privacy');
  check('مسار غير قانوني يُرفض', legalPageForPath('/dashboard') === null);
}

// -------------------------------------------------------------
// 3) تكامل: الخادم الحقيقي
// -------------------------------------------------------------
async function integrationTests(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  const app = startApp();
  try {
    group('تكامل: الخادم الحقيقي');
    const up = await waitForHealth();
    check('الخادم يقلع', up, app.log().slice(0, 500));
    if (!up) return;

    // ملف التحقق الرسمي: بلا مصادقة، بلا تحويل، نص صريح بالمحتوى بالضبط.
    const vres = await fetch(`${BASE}/${TIKTOK_VERIFICATION_FILENAME}`, { redirect: 'manual' });
    const vbody = await vres.text();
    check('ملف التحقق 200', vres.status === 200, String(vres.status));
    check('بلا تحويل (ليس 3xx)', vres.status < 300 || vres.status >= 400);
    check('نوع المحتوى text/plain', (vres.headers.get('content-type') || '').startsWith('text/plain'), vres.headers.get('content-type') || '');
    check('المحتوى مطابق حرفياً', vbody === TIKTOK_VERIFICATION_CONTENT, JSON.stringify(vbody.slice(0, 120)));
    check('المحتوى ليس HTML', !vbody.toLowerCase().includes('<!doctype') && !vbody.includes('<html'));
    check('لا محارف زائدة (سطر جديد)', vbody.trim() === vbody && !vbody.includes('\n'));
    check('nosniff معلن', vres.headers.get('x-content-type-options') === 'nosniff');

    // الاسم البديل بنفس المحتوى.
    const ares = await fetch(`${BASE}/tiktok-developers-site-verification.txt`, { redirect: 'manual' });
    const abody = await ares.text();
    check('الاسم البديل 200', ares.status === 200, String(ares.status));
    check('الاسم البديل بنفس المحتوى', abody === TIKTOK_VERIFICATION_CONTENT);

    // الصفحات القانونية: 200 + محتوى عربي فعلي بلا مصادقة.
    const tres = await fetch(`${BASE}/terms`, { redirect: 'manual' });
    const tbody = await tres.text();
    check('صفحة الشروط 200', tres.status === 200, String(tres.status));
    check('صفحة الشروط HTML', (tres.headers.get('content-type') || '').includes('text/html'), tres.headers.get('content-type') || '');
    check('صفحة الشروط تحمل نصاً قانونياً', tbody.includes('شروط الخدمة') && tbody.includes('نطاق الخدمة'));

    const pres = await fetch(`${BASE}/privacy`, { redirect: 'manual' });
    const pbody = await pres.text();
    check('صفحة الخصوصية 200', pres.status === 200, String(pres.status));
    check('صفحة الخصوصية تحمل نصاً فعلياً', pbody.includes('سياسة الخصوصية') && pbody.includes('البيانات التي نجمعها'));
    check('الصفحات القانونية بلا مصادقة (بلا توكن)', tres.status === 200 && pres.status === 200);

    // حالة التحقق معلنة في الصحة والجاهزية بلا سرّ.
    const health = await (await fetch(`${BASE}/api/health`)).json() as any;
    const sv = health?.siteVerification;
    check('الصحة تعرض siteVerification', !!sv && sv.filename === TIKTOK_VERIFICATION_FILENAME, JSON.stringify(sv));
    check('الصحة تعرض رابط الملف العام', typeof sv?.url === 'string' && sv.url.endsWith(TIKTOK_VERIFICATION_FILENAME), sv?.url);
    check('redirects=false معلنة', sv?.redirects === false);
    check('الصفحات القانونية معلنة', Array.isArray(sv?.legalPages) && sv.legalPages.includes('/terms') && sv.legalPages.includes('/privacy'));

    const readiness = await (await fetch(`${BASE}/api/readiness`)).json() as any;
    check('الجاهزية تعرض siteVerification', readiness?.siteVerification?.filename === TIKTOK_VERIFICATION_FILENAME);

    // مسار غير معروف ما زال يسقط إلى واجهة React (لم نكسر SPA).
    const unknown = await fetch(`${BASE}/some/unknown/path`, { redirect: 'manual' });
    check('مسار غير معروف لا يُخدَم كملف تحقق', (await unknown.text()) !== TIKTOK_VERIFICATION_CONTENT);
  } finally {
    await stop(app.proc);
    rmSync(stateDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  unitTests();
  legalUnitTests();
  await integrationTests();

  console.log(`\nنتيجة: ${passed} ناجح، ${failures.length} فاشل.`);
  if (failures.length) {
    console.error('\nفشل:');
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }
  console.log('كل فحوص التحقق من الرابط والصفحات القانونية ناجحة.');
}

main().catch((error) => { console.error(error); process.exit(1); });
