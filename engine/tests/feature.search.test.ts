/**
 * البحث الشامل في الأقسام والوظائف — يُختبر بما يكتبه المالك فعلاً.
 * كان البحث يعرف أسماء ~25 تبويباً فقط بمطابقة حرفية: «غرفة المهندس» و«النسخ الاحتياطي»
 * و«الاعطال» (بلا همزة) لا تجد شيئاً.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { searchFeatures, normalizeArabic, buildFeatureIndex, FEATURE_ALIASES } from '../../src/components/common/featureSearch';
import { GENERATED_SEARCH_INDEX } from '../../src/data/searchIndex.generated';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0; const failures: string[] = [];
const check = (name: string, ok: boolean, info = '') => { if (ok) passed++; else failures.push(name + (info ? ` — ${info}` : '')); };
const top = (q: string, owner = true) => searchFeatures(q, owner, 10);
const first = (q: string, owner = true) => top(q, owner)[0];

// 1) التطبيع العربي
check('تطبيع الهمزات والتاء والياء والتشكيل', normalizeArabic('الأعطالُ الحقيقيّة إلى') === normalizeArabic('الاعطال الحقيقيه الي'));
check('أرقام عربية ⇒ لاتينية', normalizeArabic('٢٤ ساعة') === '24 ساعه');

// 2) ما يكتبه المالك
const eng = first('غرفة المهندس');
check('★ «غرفة المهندس» ⇒ غرفة المهندس المشرف داخل الغرفة الحية', eng?.tab === 'live_room' && /المهندس/.test(eng.title), JSON.stringify(eng));
check('★ بلا «ال»: «مهندس» يجد المهندس', top('مهندس').some((h) => h.tab === 'live_room'));
check('★ «سبايدر» و«عنكبوت» يجدان المهندس', first('سبايدر')?.tab === 'live_room' && first('عنكبوت')?.tab === 'live_room');
check('★ «الاعطال» بلا همزة يجد الأعطال الحقيقية', /الأعطال الحقيقية/.test(first('الاعطال')?.title || ''), first('الاعطال')?.title);
check('★ «نسخ احتياطي» ⇒ شاشة التعافي', first('نسخ احتياطي')?.tab === 'cloud_backup', JSON.stringify(first('نسخ احتياطي')));
check('★ لوحة داخلية: «نبض الدورات» ⇒ الغرفة الحية مع هدف التمرير', first('نبض الدورات')?.tab === 'live_room' && Boolean(first('نبض الدورات')?.anchor));
check('★ تبويب داخلي في العقل المركزي: «الذاكرة»', top('الذاكرة').some((h) => h.tab === 'central_brain' && h.anchorKind === 'tab'));
check('★ «ربط يوتيوب» ⇒ مركز ربط المنصات', top('ربط يوتيوب').some((h) => h.tab === 'platform_connections'));
check('★ «تقسيط» ⇒ المنتجات والأقساط', top('تقسيط').some((h) => h.tab === 'database'));
check('★ «ذاكرة الخادم» ⇒ مقاييس الخادم', first('ذاكرة الخادم')?.tab === 'live_room');
check('إنجليزي: «backup» و«engineer»', first('backup')?.tab === 'cloud_backup' && first('engineer')?.tab === 'live_room');
check('كلمتان كلتاهما لازمتان (لا نتائج عشوائية)', top('مهندس تقسيط').length === 0);
check('لا شيء للفارغ', top('   ').length === 0);

// 3) الصلاحيات: شاشات المالك لا تظهر لغيره، والمخفية لا تظهر لأحد
check('★ غير المالك لا يرى الغرفة الحية ولا التعافي', !top('مهندس', false).some((h) => h.tab === 'live_room') && !top('نسخ احتياطي', false).some((h) => h.tab === 'cloud_backup'));
const tabsAll = new Set(buildFeatureIndex(true).map((e) => e.tab));
check('★ أسطح ERP المعزولة لا تظهر في البحث', !['finance', 'inventory', 'business', 'executive', 'reports'].some((t) => tabsAll.has(t)));

// 4) الفهرس المولَّد من الكود
check('★ الفهرس يغطي عشرات الشاشات واللوحات', GENERATED_SEARCH_INDEX.length >= 200 && new Set(GENERATED_SEARCH_INDEX.map((e) => e.tab)).size >= 25, String(GENERATED_SEARCH_INDEX.length));
let fresh = true;
try { execFileSync(process.execPath, [join(ROOT, 'scripts/build-search-index.mjs'), '--check'], { stdio: 'pipe' }); } catch { fresh = false; }
check('★ الفهرس محدّث مع الكود (لا لوحة جديدة بلا بحث)', fresh, 'شغّل node scripts/build-search-index.mjs');
const app = read('src/App.tsx');
const validTabs = new Set([...app.matchAll(/case '([^']+)':/g)].map((m) => m[1]));
check('★ كل مرادف يشير لشاشة حقيقية', FEATURE_ALIASES.every((a) => validTabs.has(a.tab)), FEATURE_ALIASES.filter((a) => !validTabs.has(a.tab)).map((a) => a.tab).join(','));
const titles = new Set(GENERATED_SEARCH_INDEX.map((e) => `${e.tab}|${e.title}`));
check('★ كل هدف تمرير في المرادفات موجود فعلاً في شاشته', FEATURE_ALIASES.every((a) => !a.anchor || titles.has(`${a.tab}|${a.anchor}`)), FEATURE_ALIASES.filter((a) => a.anchor && !titles.has(`${a.tab}|${a.anchor}`)).map((a) => a.anchor).join(' / '));

// 5) التوصيل
const sidebar = read('src/components/common/Sidebar.tsx');
check('★ الشريط يعرض نتائج البحث الشامل وينقل للوحة', sidebar.includes('searchFeatures(query, isOwner') && sidebar.includes('focusFeature(h.anchor, h.anchorKind)'));
check('★ رابط البحث في البيانات (منتجات/أقساط/عملاء) باقٍ', sidebar.includes("setActiveTab('search')") && sidebar.includes('setSearchQuery('));
check('Enter يفتح أول نتيجة', sidebar.includes("e.key === 'Enter' && featureHits[0]"));
const pkg = JSON.parse(read('package.json'));
check('★ الفهرس يُعاد توليده قبل البناء', /build-search-index\.mjs/.test(pkg.scripts.build));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} feature-search checks`);
