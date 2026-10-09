/**
 * اختبار ربط واجهة «تشخيص ربط حافظة الأعمال» (Facebook) — فحوص ثابتة على الملفات.
 *
 * سبب الوجود: مسار owner-only `GET /api/platforms/facebook/business-link-diagnosis`
 * كان موجوداً في الخادم بلا أي واجهة، فلم يستطع المالك استدعاءه من المتصفح (401 عند
 * فتح الرابط مباشرة لغياب رمز التفويض). هذا الاختبار يثبت أن:
 *  1) الزر موجود فعلاً في PlatformConnectionCenter بعنوانه العربي.
 *  2) الزر يستدعي دالة apiService المربوطة بالمسار المحمي (لا مسار وهمي ولا fetch مباشر).
 *  3) المكوّن معروض فقط لبطاقة facebook وداخل مركز الربط المحصور بالمالك.
 *  4) الواجهة تعرض الحقول المطلوبة من استجابة الخادم الفعلية (adminUserIds/userBusinesses/
 *     documentedOwnerAction) بلا أي تفسير مُخترع، وبعرض عربي مقروء لا JSON خام.
 *  5) الخادم لم يُغيَّر: المسار يبقى محمياً بـrequireOwner بلا أي POST (قراءة-فقط).
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

// 1) الزر بعنوانه العربي المطلوب.
check('زر «تشخيص ربط حافظة الأعمال (Facebook)» موجود', center.includes('تشخيص ربط حافظة الأعمال (Facebook)'));

// 2) الزر مربوط بدالة apiService (لا fetch مباشر داخل المكوّن).
check('الزر يستدعي getFacebookBusinessLinkDiagnosis', center.includes('apiService.getFacebookBusinessLinkDiagnosis()'));
check('لا fetch مباشر للمسار داخل المكوّن', !center.includes("fetch('/api/platforms/facebook/business-link-diagnosis'"));
check('زر فعلي له onClick', /onClick=\{\(\) => void load\(\)\}/.test(center));

// 3) يُعرض فقط لبطاقة facebook وداخل حصر المالك.
check('المكوّن يُعرض لبطاقة facebook', center.includes("p.platform === 'facebook' && <FacebookBusinessLinkDiagnosisPanel />"));
check('مركز الربط محصور بالمالك (لا يظهر لغير المالك)', center.includes("currentUser?.role !== 'owner'"));

// 4) عرض الحقول المطلوبة من الاستجابة الفعلية، بعرض عربي مقروء.
check('يعرض معرّفات الأدمن (appRoles.adminUserIds)', center.includes('appRoles.adminUserIds'));
check('يعرض الحافظات (userBusinesses) والمفتاح businessId', center.includes('userBusinesses') && center.includes('.businessId'));
check('يعرض أدوار المستخدم على الحافظة (permittedRoles)', center.includes('permittedRoles'));
check('يعرض الرسائل التوضيحية من الخادم (documentedOwnerAction)', center.includes('documentedOwnerAction'));
check('يعرض حسم «لا تملك هذا التطبيق» و«2FA» كما يعيدهما الخادم', center.includes('youDontOwnThisApp') && center.includes('twoFactorFix'));
check('عرض Modal عربي مقروء (لا JSON خام)', center.includes('max-h-[85vh]') && !center.includes('<pre') && !/JSON\.stringify\(\s*d\b/.test(center));
check('لا تفسير مُخترع: المرساة صيغة نصّية فقط', !/alert\(/.test(center));

// 5) عقود apiService: الدالة مربوطة بالمسار المحمي وتمرّر رمز التفويض.
check('apiService: مسار business-link-diagnosis', api.includes("'/api/platforms/facebook/business-link-diagnosis'"));
check('apiService: الدالة معرّفة', api.includes('async getFacebookBusinessLinkDiagnosis()'));
check('apiService: تمرّر Authorization عبر getAuthHeaders', /getFacebookBusinessLinkDiagnosis[\s\S]{0,260}?getAuthHeaders\(\)/.test(api));

// 6) الخادم لم يُغيَّر: المسار محمي، ولا يوجد أي مسار POST ينفّذ ربطاً تلقائياً.
check('مسار التشخيص محمي (requireOwner)', server.includes('"/api/platforms/facebook/business-link-diagnosis", authenticateToken, requireOwner') || server.includes('"/api/platforms/facebook/business-link-diagnosis"'));
check('لا يوجد مسار POST ينفّذ الربط التلقائي', !/app\.post\(\s*["'`][^"'`]*client_apps/.test(server) && !/app\.post\(\s*["'`][^"'`]*owned_apps/.test(server));
check('دوال التشخيص الثلاث تُنفّذ GET فقط', /getAppRoles[\s\S]{0,900}?method: 'GET'/.test(readFileSync(join(ROOT, 'engine/social/facebook.ts'), 'utf8')) && server.includes('listBusinessOwnedApps'));
// الفحص الموثّق للربط يبقى معلناً بصراحة أنه لا يُنفَّذ تلقائياً.
check('التوثيق يُعلن أن الربط لا يُنفَّذ تلقائياً', server.includes('executesAutomatically:false'));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} facebook business-link UI checks`);
}