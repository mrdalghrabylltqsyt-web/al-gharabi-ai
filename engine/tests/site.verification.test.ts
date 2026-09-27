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
  isVerificationFileRequest,
  captureVerificationRequest,
  effectiveVerificationFilename,
  effectiveTikTokVerificationToken,
  DEFAULT_TIKTOK_VERIFICATION_TOKEN,
  TIKTOK_VERIFICATION_TOKEN_ENV_NAME,
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
// 1ب) وحدة: لا يُخدَم توقيع رمز لاسم رمز آخر (جوهر فشل TikTok)
// -------------------------------------------------------------
function mismatchUnitTests(): void {
  group('عدم خدمة توقيع رمز لاسم رمز آخر (وحدة)');
  // الملف الرسمي المطابق يُخدَم، والاسم البديل يُخدَم.
  check('الاسم المطابق يُطابق', verificationFileForPath('/' + TIKTOK_VERIFICATION_FILENAME)?.filename === TIKTOK_VERIFICATION_FILENAME);
  check('الاسم البديل يُطابق', verificationFileForPath('/tiktok-developers-site-verification.txt')?.filename === 'tiktok-developers-site-verification.txt');
  // أي رمز آخر لا يُخدَم إطلاقاً (لا 200 بتوقيع خاطئ).
  const other = '/tiktokZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ.txt';
  check('رمز مختلف لا يُخدَم', verificationFileForPath(other) === null, other);
  check('رمز مختلف يُكتشف كطلب تحقق', isVerificationFileRequest(other));
  check('مسار فرعي لملف تحقق يُكتشف', isVerificationFileRequest('/sub/tiktokabc12345.txt'));
  check('شرطة مائلة زائدة تُكتشف', isVerificationFileRequest('/' + TIKTOK_VERIFICATION_FILENAME + '/'));
  check('مسار عادي لا يُكتشف كطلب تحقق', !isVerificationFileRequest('/dashboard'));
  check('ملف نصي آخر لا يُكتشف', !isVerificationFileRequest('/robots.txt'));

  // تجاوز الرمز من البيئة: يُخدَم الرمز الصحيح واسمه، ويبقى المدموج هو الافتراضي.
  const overridden = 'AbCdEf0123456789AbCdEf0123456789';
  const previous = process.env[TIKTOK_VERIFICATION_TOKEN_ENV_NAME];
  process.env[TIKTOK_VERIFICATION_TOKEN_ENV_NAME] = overridden;
  try {
    check('الرمز الفعّال يأتي من البيئة', effectiveTikTokVerificationToken() === overridden);
    check('اسم الملف الفعّال يتبع البيئة', effectiveVerificationFilename() === `tiktok${overridden}.txt`);
    check('الملف الفعّال يُطابق', verificationFileForPath(`/tiktok${overridden}.txt`) !== null);
  } finally {
    if (previous === undefined) delete process.env[TIKTOK_VERIFICATION_TOKEN_ENV_NAME];
    else process.env[TIKTOK_VERIFICATION_TOKEN_ENV_NAME] = previous;
  }
  check('القيمة المدموجة الافتراضية ثابتة', DEFAULT_TIKTOK_VERIFICATION_TOKEN === 'djxlJcC4WFlCh4OZY8IVHgezp491vPoZ');
  check('بلا تجاوز يعود للرمز المدموج', effectiveTikTokVerificationToken() === DEFAULT_TIKTOK_VERIFICATION_TOKEN);
}

// -------------------------------------------------------------
// 1ج) وحدة: التقاط طلب التحقق وتصنيف الانحراف
// -------------------------------------------------------------
function captureUnitTests(): void {
  group('التقاط طلب التحقق (وحدة)');
  const at = '2026-09-27T00:00:00.000Z';
  const match = captureVerificationRequest({ pathname: `/${TIKTOK_VERIFICATION_FILENAME}`, userAgent: 'TikTokBot/1.0', method: 'GET', at });
  check('التقاط الطلب المطابق: الاسم', match.filename === TIKTOK_VERIFICATION_FILENAME, match.filename);
  check('التقاط الطلب المطابق: الرمز', match.token === TIKTOK_VERIFICATION_TOKEN, match.token);
  check('التقاط الطلب المطابق: وكيل المستخدم', match.userAgent === 'TikTokBot/1.0', match.userAgent);
  check('التقاط الطلب المطابق: الوقت', match.at === at, match.at);
  check('التقاط الطلب المطابق: مخدوم', match.served === true && match.matchedExpected === true);
  check('التقاط الطلب المطابق: في الجذر', match.rootLevel === true);
  check('التقاط الطلب المطابق: بلا سبب انحراف', match.mismatchReason === '');

  const other = captureVerificationRequest({ pathname: '/tiktokZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ.txt', userAgent: 'TikTokBot/1.0', method: 'GET', at });
  check('التقاط رمز مختلف: غير مخدوم', other.served === false);
  check('التقاط رمز مختلف: سبب = رمز مختلف', other.mismatchReason === 'token_differs_from_served', other.mismatchReason);
  check('التقاط رمز مختلف: الرمز المطلوب مسجّل', other.token === 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ', other.token);
  check('التقاط رمز مختلف: اسم الملف المتوقع معلن', other.expectedFilename === TIKTOK_VERIFICATION_FILENAME, other.expectedFilename);

  const sub = captureVerificationRequest({ pathname: `/sub/${TIKTOK_VERIFICATION_FILENAME}`, userAgent: '', method: 'GET', at });
  check('مسار فرعي: سبب = ليس الجذر', sub.mismatchReason === 'not_at_root_path', sub.mismatchReason);
  check('مسار فرعي: مخدوم=false', sub.served === false);

  const withQuery = captureVerificationRequest({ pathname: `/${TIKTOK_VERIFICATION_FILENAME}`, originalUrl: `/${TIKTOK_VERIFICATION_FILENAME}?x=1`, userAgent: '', method: 'GET', at });
  check('استعلام: مخدوم (req.path بلا استعلام)', withQuery.served === true);
  check('استعلام: hasQuery معلن', withQuery.hasQuery === true);
  check('استعلام: في الجذر', withQuery.rootLevel === true);

  const badName = captureVerificationRequest({ pathname: '/tiktok.txt', userAgent: '', method: 'GET', at });
  check('اسم لا يطابق الصيغة: سبب صريح', badName.mismatchReason === 'filename_not_in_tiktok_token_format', badName.mismatchReason);
  check('طريقة HEAD مسجّلة', captureVerificationRequest({ pathname: `/${TIKTOK_VERIFICATION_FILENAME}`, method: 'head', at }).method === 'HEAD');

  // حقول الطب الشرعي: المضيف ووسيط الشبكة (يكشفان اعتراض الوسيط/الدومين الخطأ).
  const withHost = captureVerificationRequest({ pathname: `/${TIKTOK_VERIFICATION_FILENAME}`, at, host: 'al-gharabi-ai.onrender.com', forwardedProto: 'https', forwardedFor: '1.2.3.4' });
  check('المضيف مسجّل', withHost.host === 'al-gharabi-ai.onrender.com', String(withHost.host));
  check('مرور الوسيط معلن', withHost.viaProxy === true);
  const fwdHost = captureVerificationRequest({ pathname: '/tiktok.txt', at, host: 'origin.internal', forwardedHost: 'public.example.com, edge' });
  check('X-Forwarded-Host مقدَّم على Host', fwdHost.host === 'public.example.com', String(fwdHost.host));
  const noProxy = captureVerificationRequest({ pathname: `/${TIKTOK_VERIFICATION_FILENAME}`, at, host: 'localhost' });
  check('بلا وسيط: viaProxy=false', noProxy.viaProxy === false);
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
    check('طول المحتوى بالبايت دقيق', vres.headers.get('content-length') === String(Buffer.byteLength(TIKTOK_VERIFICATION_CONTENT, 'utf8')), vres.headers.get('content-length') || '');

    // جوهر فشل TikTok: اسم برمز آخر يجب ألا يستلم توقيع الرمز المدموج بحالة 200.
    const mism = await fetch(`${BASE}/tiktokZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ.txt`, { redirect: 'manual' });
    const mismBody = await mism.text();
    check('اسم برمز مختلف لا يُخدَم 200', mism.status === 404, String(mism.status));
    check('اسم برمز مختلف لا يعيد التوقيع المدموج', mismBody !== TIKTOK_VERIFICATION_CONTENT);
    check('اسم برمز مختلف لا يعيد HTML', !mismBody.toLowerCase().includes('<!doctype'));

    // مسار فرعي لملف تحقق لا يسقط إلى واجهة React.
    const sub = await fetch(`${BASE}/sub/${TIKTOK_VERIFICATION_FILENAME}`, { redirect: 'manual' });
    const subBody = await sub.text();
    check('مسار فرعي لملف تحقق لا يعيد HTML', sub.status === 404 && !subBody.toLowerCase().includes('<!doctype'), String(sub.status));

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
    // أُعيد فحص الملف الرسمي ليصبح آخر طلب واصلاً هو المطابق، فيقرأ فحص الصحة
    // السجل في حالته المتوقّعة بلا افتراض ترتيب الطلبات السابقة.
    await fetch(`${BASE}/${TIKTOK_VERIFICATION_FILENAME}`, { redirect: 'manual' });
    const health = await (await fetch(`${BASE}/api/health`)).json() as any;
    const sv = health?.siteVerification;
    check('الصحة تعرض siteVerification', !!sv && sv.filename === TIKTOK_VERIFICATION_FILENAME, JSON.stringify(sv));
    check('الصحة تعرض رابط الملف العام', typeof sv?.url === 'string' && sv.url.endsWith(TIKTOK_VERIFICATION_FILENAME), sv?.url);
    check('redirects=false معلنة', sv?.redirects === false);
    check('الصحة تعرض مصدر الرمز', sv?.tokenSource === 'default' || String(sv?.tokenSource).startsWith('env:'), String(sv?.tokenSource));
    check('الصحة تعرض رمز التحقق العام', sv?.token === TIKTOK_VERIFICATION_TOKEN, String(sv?.token));
    check('الصفحات القانونية معلنة', Array.isArray(sv?.legalPages) && sv.legalPages.includes('/terms') && sv.legalPages.includes('/privacy'));

    // السجل يلتقط طلب التحقق المطابق أخيراً (الاسم/الرمز/وكيل المستخدم/الوقت).
    const lr = sv?.lastRequest;
    check('الصحة تعرض lastRequest', !!lr, JSON.stringify(lr));
    check('lastRequest يحمل اسم الملف', lr?.filename === TIKTOK_VERIFICATION_FILENAME, lr?.filename);
    check('lastRequest يحمل الرمز', lr?.token === TIKTOK_VERIFICATION_TOKEN, lr?.token);
    check('lastRequest يحمل وقتاً', typeof lr?.at === 'string' && !Number.isNaN(Date.parse(lr.at)), lr?.at);
    check('lastRequest يحمل userAgent (قد يكون فارغاً)', typeof lr?.userAgent === 'string');
    check('lastRequest مخدوم=true للاسم الصحيح', lr?.served === true);
    check('عدّاد الطلبات موجب', typeof sv?.requestCount === 'number' && sv.requestCount >= 1, String(sv?.requestCount));

    // طلب رمز مختلف يُحدّث السجل ويكشف سبب الانحراف بدقة.
    const otherName = 'tiktokZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ.txt';
    await fetch(`${BASE}/${otherName}`, { headers: { 'user-agent': 'TikTok-Verify/Probe' }, redirect: 'manual' });
    const health2 = await (await fetch(`${BASE}/api/health`)).json() as any;
    const sv2 = health2?.siteVerification;
    check('آخر طلب يعكس الطلب الأخير (الرمز الآخر)', sv2?.lastRequest?.filename === otherName, sv2?.lastRequest?.filename);
    check('آخر طلب يحمل وكيل المستخدم', sv2?.lastRequest?.userAgent === 'TikTok-Verify/Probe', sv2?.lastRequest?.userAgent);
    check('سبب الانحراف معلن = رمز مختلف', sv2?.lastRequest?.mismatchReason === 'token_differs_from_served', sv2?.lastRequest?.mismatchReason);
    check('آخر طلب مطابق محفوظ منفصلاً', sv2?.lastServedRequest?.filename === TIKTOK_VERIFICATION_FILENAME, sv2?.lastServedRequest?.filename);
    check('آخر طلب منحرف محفوظ منفصلاً', sv2?.lastMismatchedRequest?.filename === otherName, sv2?.lastMismatchedRequest?.filename);
    check('recentRequests سجل تراكمي', Array.isArray(sv2?.recentRequests) && sv2.recentRequests.length >= 2, String(sv2?.recentRequests?.length));
    check('الاسم المتوقع معلن في الطلب', sv2?.lastRequest?.expectedFilename === TIKTOK_VERIFICATION_FILENAME);

    // خطأ الانحراف يُظهر اسم الملف الصحيح في الجسم (تشخيص للمالك).
    const mismatchBody = await (await fetch(`${BASE}/${otherName}`)).text();
    check('جسم 404 يذكر الاسم الصحيح', mismatchBody.includes(TIKTOK_VERIFICATION_FILENAME), mismatchBody.slice(0, 200));

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
  mismatchUnitTests();
  captureUnitTests();
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
