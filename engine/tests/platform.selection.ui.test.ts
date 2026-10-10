/**
 * اختبار حماية مصدرية لحتمية اختيار المنصات في مركز صناعة المحتوى (ContentEngineView)
 * والخادم (adaptationTargets). فحوص ثابتة على الملفات المصدرية — بلا خادم ولا مزود.
 *
 * يثبت (منع رجوع الخلل):
 *  1) لا إضافة تلقائية لمنصة غير مختارة إلى قائمة الاستهداف (لا threads/instagram
 *     تُضاف افتراضاً؛ الافتراضي منصة واحدة فقط).
 *  2) الاستهداف مأخوذ من selectedPlatforms حصراً (لا قائمة ثابتة/افتراضية).
 *  3) نسخ المنصات (adaptedVersions) تُبنى على المنصات المختارة فقط، فلا يظهر تبويب
 *     «نسخة <منصة>» لمنصة لم تُختر.
 *  4) الخادم لا يعيد تكييف المنصات العشر كلها افتراضاً (لا قائمة ثابتة في التكييف).
 *  5) الخادم يعتمد على طلب العميل (req.body.platforms) في التكييف.
 *  6) بطاقات العرض تقرأ post.targetPlatforms (منصات المنشور نفسه) لا قائمة عامة.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const ROOT = process.cwd();
const view = readFileSync(join(ROOT, 'src/components/content/ContentEngineView.tsx'), 'utf8');
const server = readFileSync(join(ROOT, 'server.ts'), 'utf8');
const approval = readFileSync(join(ROOT, 'src/components/approval/ApprovalWorkflowView.tsx'), 'utf8');

group('1) لا إضافة تلقائية لمنصة غير مختارة');
// الافتراضي منصة واحدة فقط (tiktok) — لا مصفوفة متعددة مضمّنة.
check('الحالة الابتدائية = منصة واحدة فقط', /useState<SocialPlatformId\[\]>\(\['tiktok'\]\)/.test(view), 'default selection');
// لا نداء setSelectedPlatforms يضيف threads/instagram تلقائياً.
check('لا إضافة تلقائية لـthreads في الواجهة', !/setSelectedPlatforms\([^)]*threads/.test(view));
check('لا إضافة تلقائية لـinstagram في الواجهة', !/setSelectedPlatforms\([^)]*instagram/.test(view));
// معالج التبديل يضيف/يزيل نفس المنصة فقط (toggle) ويستبدلها بالمختارة.
check('معالج التبديل toggle صرف (لا منصات إضافية)', /prev\.includes\(p\.platform\)[\s\S]{0,120}prev\.filter\(\(x\) => x !== p\.platform\)[\s\S]{0,60}\[\.\.\.prev, p\.platform\]/.test(view));

group('2) الاستهداف مأخوذ من الاختيار حصراً');
check('targetPlatforms = selectedPlatforms', /targetPlatforms:\s*selectedPlatforms\.length\s*\?\s*selectedPlatforms/.test(view), 'targetPlatforms source');
check('لا قائمة منصات ثابتة في createPost', !/targetPlatforms:\s*\[['"](threads|instagram)['"]/.test(view));

group('3) نُسخ المنصات مبنية على المنصات المختارة فقط');
check('تُبنى نسخة لكل منصة مختارة عبر حلقة على targets', /for \(const pf of targets\) chosenVersions\[pf\]/.test(view));
check('targets مشتقة من selectedPlatforms', /const targets = selectedPlatforms\.length \? selectedPlatforms : \[primaryPlatform\]/.test(view));
// لا حقن نسخة منصة أساسية غير مختارة بإضافة مفروضة.
check('لا fallback يضيف primaryPlatform فوق المختارة', !/\{\s*\.\.\.serverVersions,\s*\[primaryPlatform\]/.test(view));

group('4) الخادم لا يعيد تكييف المنصات العشر افتراضاً');
check('لا قائمة الصلاحيات العشر الثابتة في adaptationTargets', !/"tiktok", "instagram", "x", "snapchat", "facebook", "whatsapp", "telegram", "threads", "google_business"/.test(server), 'static ten-platform list removed');
check('adaptationTargets مشتقة من basePlatform + requestedPlatforms', /const adaptationTargets = Array\.from\(new Set<string>\(\[\s*\.\.\.\(basePlatform \? \[basePlatform\] : \[\]\),\s*\.\.\.requestedPlatforms,/.test(server));

group('5) الخادم يعتمد على طلب العميل في التكييف');
check('requestedPlatforms من req.body.platforms', /const requestedPlatforms: string\[\] = Array\.isArray\(req\.body\?\.platforms\)/.test(server));
check('requestedPlatforms مُرشَّحة على المنصات المدعومة', /SUPPORTED_PLATFORMS\.some\(\(sp: any\) => sp\.id === v\)/.test(server));

group('6) بطاقات العرض تقرأ منصات المنشور نفسه');
check('ApprovalWorkflowView يعرض post.targetPlatforms', approval.includes('post.targetPlatforms.map'));
check('نقل التفاصيل يستدعي youtubeDedicatedDisclosure(post.targetPlatforms)', approval.includes('youtubeDedicatedDisclosure(post.targetPlatforms)'));

console.log('\n' + '='.repeat(60));
if (failures.length === 0) { console.log(`PASSED: ${passed} platform-selection UI guard checks`); process.exit(0); }
console.error(`FAILED: ${failures.length} / ${passed + failures.length}`); failures.forEach((f) => console.error(' - ' + f)); process.exit(1);
