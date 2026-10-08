/**
 * اختبار ربط واجهة تشخيص نشر فيديو Facebook (owner-only) — فحوص ثابتة على الملفات.
 *
 * سبب الوجود: مسارا `GET /api/platforms/facebook/video-permission-diagnosis` و
 * `GET /api/platforms/publish-diagnostics` كانا مبنيّين في الخادم فقط بلا أي واجهة،
 * فلا يستطيع المالك استدعاءهما من الهاتف إلا بأدوات تقنية. هذا الاختبار يثبت أن:
 *  1) الزرّان موجودان فعلاً في PlatformConnectionCenter بعنوانيهما العربيَّين.
 *  2) الزرّان يستدعيان دالتي apiService المربوطتين بالمسارين المحميين (لا مسار وهمي).
 *  3) المكوّن معروض فقط لبطاقة facebook، وداخل مركز الربط المحصور بالمالك (owner-only).
 *  4) الواجهة تعرض الصلاحيات الممنوحة/الناقصة وحالة الجهوزية وسجل الأخطاء (منصة/رسالة/رمز).
 *  5) الواجهة لا تدّعي إصلاح الصلاحية ولا أي نشر (المسار تشخيصي فقط).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const ROOT = process.cwd();
const center = readFileSync(join(ROOT, 'src/components/social/PlatformConnectionCenter.tsx'), 'utf8');
const api = readFileSync(join(ROOT, 'src/services/api.ts'), 'utf8');
const server = readFileSync(join(ROOT, 'server.ts'), 'utf8');

// 1) الزرّان بعنوانيهما العربيَّين.
check('زر «فحص صلاحيات نشر الفيديو» موجود', center.includes('فحص صلاحيات نشر الفيديو'));
check('زر «سجل تشخيص النشر الفاشل» موجود', center.includes('سجل تشخيص النشر الفاشل'));

// 2) الزرّان مربوطان بدالتي apiService (لا استدعاء fetch مباشر في المكوّن).
check('الزر يستدعي getFacebookVideoPermissionDiagnosis', center.includes('apiService.getFacebookVideoPermissionDiagnosis()'));
check('الزر يستدعي getPublishDiagnostics', center.includes('apiService.getPublishDiagnostics('));
check('لا fetch مباشر لمسار التشخيص داخل المكوّن', !center.includes("fetch('/api/platforms/facebook/video-permission-diagnosis'") && !center.includes("fetch('/api/platforms/publish-diagnostics'"));

// 3) المكوّن معروض فقط لبطاقة facebook، وداخل حصر المالك.
check('المكوّن يُعرض لبطاقة facebook', center.includes("p.platform === 'facebook' && <FacebookVideoDiagnosticsPanel />"));
check('مركز الربط محصور بالمالك (لا يظهر لغير المالك)', center.includes("currentUser?.role !== 'owner'"));
// زرّان فعليّان (onClick) لا نصّان ساكنان.
check('زرّ الفحص له onClick فعلي', /onClick=\{\(\) => void runPermCheck\(\)\}/.test(center));
check('زرّ السجل له onClick فعلي', /onClick=\{\(\) => void runDiagFetch\(\)\}/.test(center));

// 4) عرض النتيجة: الصلاحيات الممنوحة/الناقصة + الجهوزية + سجل الأخطاء.
check('يعرض الصلاحيات الممنوحة', center.includes('الصلاحيات الممنوحة فعلاً'));
check('يعرض الصلاحيات الناقصة لنشر الفيديو', center.includes('الصلاحيات الناقصة لنشر الفيديو'));
check('يعرض حالة جهوزية النشر (videoPublishReady)', center.includes('perm.videoPublishReady'));
check('يفسّر pages_read_engagement كإلزامية لنشر الفيديو', center.includes('pages_read_engagement') && center.includes('إلزامية لنشر الفيديو'));
check('سجل الأخطاء يعرض المنصة', center.includes('{r.platform}'));
check('سجل الأخطاء يعرض الرسالة الكاملة', center.includes('{r.error'));
check('سجل الأخطاء يعرض الرمز/subcode/fbtrace', center.includes('providerCode') && center.includes('providerSubcode') && center.includes('providerTraceId'));

// 5) صدق: لا ادعاء إصلاح الصلاحية ولا نشر.
check('اللوحة تُعلن أنها لا تُصلح الصلاحية', center.includes('لا يُصلح الصلاحية، يكشفها فقط'));
check('اللوحة لا تدّعي نشراً', !/تم النشر|نُشر بنجاح/.test(center));

// 6) عقود apiService: الدالتان مربوطتان بالمسارين المحميين الصحيحين.
check('apiService: مسار فحص صلاحيات الفيديو', api.includes("'/api/platforms/facebook/video-permission-diagnosis'"));
check('apiService: مسار سجل تشخيص النشر', api.includes('`/api/platforms/publish-diagnostics${suffix}`'));
check('apiService: الدالتان تصرّحان النوع (throw عند الفشل)', api.includes('async getFacebookVideoPermissionDiagnosis()') && api.includes('async getPublishDiagnostics('));
check('apiService: يمرّر Authorization عبر getAuthHeaders', api.includes('getAuthHeaders()'));

// 7) الخادم: المساران محميان بـrequireOwner (owner-only فعلاً على الخادم لا بالواجهة فقط).
const diagRoute = server.indexOf('"/api/platforms/publish-diagnostics", requireOwner');
const permRoute = server.indexOf('"/api/platforms/facebook/video-permission-diagnosis", requireOwner');
check('مسار سجل التشخيص محمي بـrequireOwner على الخادم', diagRoute >= 0);
check('مسار فحص صلاحيات الفيديو محمي بـrequireOwner على الخادم', permRoute >= 0);
// نطاق مسار فحص الصلاحيات وحده: جسم الاستجابة لا يحمل رمزاً ولا سرّاً كحقل.
const permBlock = permRoute >= 0 ? server.slice(permRoute, server.indexOf('app.get(', permRoute + 1)) : '';
// يُعاد بها اسم الحقل (key: value) لا مجرد قراءة `stored?.pageAccessToken` (بلا نقطتين).
const echoesSecret = /pageAccessToken\s*:|access_token\s*:|clientSecret\s*:|"access_token"|client_secret\s*:/.test(permBlock);
check('استجابة فحص الصلاحيات لا تُعيد رمز الوصول ولا السرّ',
  permBlock.includes('grantedScopes: d.scopes') && permBlock.includes('missingVideoPublishScopes') && !echoesSecret);

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} facebook video diagnostics UI checks`);
}
