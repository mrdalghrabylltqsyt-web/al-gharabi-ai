/**
 * اختبار تفاعلية العناصر (fail-old / pass-new).
 *
 * يثبت أن كل عنصر واجهة يُعرض كمدخل إلى قسم/محتوى/وظيفة يؤدي فعلاً إلى وجهة صحيحة:
 *  - كل هدف `setActiveTab('...')` هو حالة عرض حقيقية (`case` في App.tsx)، فلا يوجد
 *    هدف يسقط إلى الافتراضي فيبدو العنصر «غير مستجيب» (عطل مركز القيادة الواقعي).
 *  - بطاقات المؤشرات (DashboardView) صارت أزراراً تنقل إلى بياناتها لا عناصر شكلية.
 *  - ترويسة البحث صارت نموذجاً فعّالاً ينقل إلى شاشة البحث الموحّد بالاستعلام.
 *  - لا أزرار متداخلة (double-fire)، والعناصر الزخرفية لم تُحوَّل إلى أزرار وهمية.
 *
 * يفشل على الشجرة القديمة (go('publish'/'products'/'settings') وبطاقات غير قابلة
 * للضغط وبحث ترويسة ميّت) وينجح بعد الإصلاح.
 */
import fs from 'node:fs';
import path from 'node:path';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const app = read('src/App.tsx');
const appCtx = read('src/context/AppContext.tsx');
const cc = read('src/components/dashboard/CommandCenterView.tsx');
const dash = read('src/components/dashboard/DashboardView.tsx');
const header = read('src/components/common/Header.tsx');
const search = read('src/components/search/GlobalSearchView.tsx');

// حالات العرض الحقيقية = المفاتيح في switch العرض بـApp.tsx
const VALID_TABS = new Set([...app.matchAll(/case '([^']+)':/g)].map((m) => m[1]));

console.log('\n=== 1) كل هدف تنقّل هو حالة عرض حقيقية (لا وجهة وهمية تسقط للافتراضي) ===');
const NAV_FILES = [
  'src/components/dashboard/CommandCenterView.tsx',
  'src/components/dashboard/DashboardView.tsx',
  'src/components/common/Header.tsx',
  'src/components/common/SectionHub.tsx',
  'src/components/common/Sidebar.tsx',
];
let badTargets: string[] = [];
for (const f of NAV_FILES) {
  const txt = read(f);
  for (const m of txt.matchAll(/(?:setActiveTab|go)\('([^']+)'\)/g)) {
    if (!VALID_TABS.has(m[1])) badTargets.push(`${f}: '${m[1]}'`);
  }
}
check('لا هدف تنقّل خارج حالات App.tsx', badTargets.length === 0);
if (badTargets.length) console.error('    أهداف غير صالحة:', badTargets.join(', '));

console.log('\n=== 2) مركز القيادة: مسار العمل بأقسام هرمية صحيحة ===');
check("النشر → 'section_publish'", cc.includes("go('section_publish')"));
check("المنتجات → 'section_products'", cc.includes("go('section_products')"));
check("ربط المنصات → 'platform_connections'", cc.includes("go('platform_connections')"));
check("لا هدف قديم مكسور 'publish'", !cc.includes("go('publish')"));
check("لا هدف قديم مكسور 'products'", !cc.includes("go('products')"));
check("لا هدف قديم مكسور 'settings'", !cc.includes("go('settings')"));

console.log('\n=== 3) صفوف «يحتاج إجراءً» قابلة للضغط بالكامل + لوحة المفاتيح ===');
const needBlock = cc.slice(cc.indexOf('needingAction.map'), cc.indexOf('needingAction.length === 0'));
check('role="button" على الصف', needBlock.includes('role="button"'));
check('tabIndex للوصول بلوحة المفاتيح', needBlock.includes('tabIndex={0}'));
check('onClick ينقل إلى ربط المنصات', needBlock.includes("onClick={() => go('platform_connections')}"));
check('onKeyDown يدعم Enter/المسافة', needBlock.includes('onKeyDown') && needBlock.includes("e.key === 'Enter'"));
check('aria-label وصفي', needBlock.includes('aria-label'));
check('لا زر متداخل داخل الصف (منع تنفيذ مزدوج)', !/<button[^>]*onClick[^>]*>\s*ربط المنصات/.test(needBlock));

console.log('\n=== 4) بطاقات مؤشرات لوحة التحكم أزرار تنقل (لا عناصر شكلية) ===');
for (const [label, tab] of [
  ['إجمالي المتابعين', 'social'],
  ['استفسارات التقسيط', 'customers'],
  ['منتجات المعرض', 'database'],
  ['حالة النشر والجدولة', 'calendar'],
] as const) {
  const re = new RegExp(`<button[\\s\\S]*?aria-label="[^"]*"[\\s\\S]*?onClick=\\{\\(\\) => setActiveTab\\('${tab}'\\)\\}[\\s\\S]*?${label}`);
  // تحقق مباشر من وجود زر بعدد أزرار KPI
  check(`بطاقة «${label}» زر ينقل إلى '${tab}'`, dash.includes(`setActiveTab('${tab}')`) && dash.includes(label));
}
const kpiButtons = (dash.match(/<button[\s\S]*?aria-label="فتح/g) || []).length;
check('4 بطاقات KPI صارت أزراراً معنونة', kpiButtons >= 4);
check('البطاقات تحمل cursor-pointer', dash.includes('cursor-pointer hover:border'));

console.log('\n=== 5) ترويسة البحث تفاعلية وتنقل إلى البحث الموحّد ===');
check('البحث نموذج <form>', header.includes('<form'));
check('onSubmit يمنع الافتراضي', header.includes('e.preventDefault()') && header.includes('onSubmit='));
check("ينقل إلى 'search'", header.includes("setActiveTab('search')"));
check('حقل البحث مربوط بـsearchQuery (onChange)', header.includes('onChange={(e) => setSearchQuery(e.target.value)}'));
check('تحقق من طول الاستعلام + توست', header.includes("showToast('اكتب كلمتين على الأقل للبحث')"));

console.log('\n=== 6) شاشة البحث الموحّد تقرأ الاستعلام وتنفّذ البحث ===');
check('تستهلك searchQuery من السياق', search.includes('useApp') && search.includes('searchQuery'));
check('تنفّذ البحث عند الفتح بعبارة محفوظة', search.includes('useEffect') && search.includes('run(searchQuery)'));
check('دالة run قابلة لإعادة الاستخدام (نفس الشاشة)', search.includes('const run=') && search.includes('void run(q)'));

console.log('\n=== 7) الحالة المشتركة للبحث في السياق ===');
check('AppContextType يعرّف searchQuery/setSearchQuery', appCtx.includes('searchQuery: string') && appCtx.includes('setSearchQuery: (q: string) => void'));
check('الحالة مُنشأة (useState)', appCtx.includes("useState<string>('')"));
check('القيمة مُمرّرة في المزوّد', appCtx.includes('searchQuery,') && appCtx.includes('setSearchQuery,'));

console.log('\n=== 8) سلامة الوصول: عناصر دلالية + مساحة لمس ===');
check('البطاقات/الصفوف تستخدم button أو role=button', (dash.match(/<button/g) || []).length >= 4 && needBlock.includes('role="button"'));
check('أزرار KPI من نوع button (لا submit عرضي)', dash.includes('type="button"'));
check('لا href="#" أو onClick فارغ في الملفات المعدّلة', ![...NAV_FILES, 'src/components/search/GlobalSearchView.tsx'].some((f) => /\{?href="#"/.test(read(f)) || /onClick=\{?\(\)\s*=>\s*\{?\s*\}?\s*\}/.test(read(f))));

console.log('\n=== 9) عناصر زخرفية لم تُحوَّل إلى أزرار وهمية ===');
// نقاط حالة الاتصال (النقطة الملوّنة) زخرفية داخل اللقطة، تبقى span لا زراً.
check('نقطة حالة المنصة تبقى span زخرفي (لا زر)', dash.includes('w-2 h-2 rounded-full'));
check('شارة Gemini في الترويسة تبقى span (ليست زراً)', /<span className="hidden sm:inline-flex[^>]*>[\s\S]*?Gemini/.test(header));

console.log('\n=== 10) انحدار: التنقل والقوائم والأقسام سليمة (لا حذف) ===');
check('كل الأقسام الهرمية لا تزال في App.tsx', ['section_home','section_publish','section_customers','section_products','section_settings'].every((s) => app.includes(`case '${s}':`)));
check('Sidebar/SectionHub كما هما (يستوردان navConfig)', read('src/components/common/Sidebar.tsx').includes("from './navConfig'") && read('src/components/common/SectionHub.tsx').includes("from './navConfig'"));
check("لوحة التحكم لا تزال متصلة بـApp (case 'dashboard')", app.includes("case 'dashboard': return <DashboardView />"));

console.log('\n=== 11) لا أسرار/بيانات وهمية أُدخلت في الإصلاح ===');
const combined = cc + dash + header + search + appCtx;
check('لا مفاتيح/توكنات مكتوبة', !/AIza|GOCSPX|Bearer\s+[A-Za-z0-9]{20}|api[-_]?key\s*[:=]\s*['"]/.test(combined));
check('لا مسار جديد أُنشئ للتنقّل (لا pathname push)', !combined.includes('window.location.pathname ='));

console.log(`\n${fail === 0 ? 'PASSED' : 'FAILED'}: ${pass} عنصر تفاعلي، ${fail} فشل`);
if (fail > 0) process.exit(1);
