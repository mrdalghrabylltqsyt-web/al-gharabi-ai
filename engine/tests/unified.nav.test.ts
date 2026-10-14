/**
 * اختبار التنقل الهرمي الموحّد (fail-old / pass-new).
 *
 * يثبت أن الواجهة صارت **هرمية بثلاثة مستويات** (قسم رئيسي ← فرع ← وظيفة) مع
 * **عدم فقدان أي وظيفة سابقة** (دمج لا حذف)، وأن مصدر التنقل واحد
 * (`navConfig.tsx`) يستخدمه الشريط الجانبي ولوحة القسم، وأن الرئيسية (مركز القيادة)
 * تقرأ من الخادم الحقيقي بلا اختلاق.
 *
 * يفشل على الشجرة القديمة (لا `branches`، ولا searchNav، ولا الأقسام الهرمية
 * الجديدة) وينجح بعدها.
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

const nav = read('src/components/common/navConfig.tsx');
const sidebar = read('src/components/common/Sidebar.tsx');
const app = read('src/App.tsx');
const appCtx = read('src/context/AppContext.tsx');
const hub = read('src/components/common/SectionHub.tsx');
const cc = read('src/components/dashboard/CommandCenterView.tsx');
const header = read('src/components/common/Header.tsx');

console.log('\n=== هيكل ثلاثي المستويات ===');
check('مصدر التنقل واحد: navConfig.tsx', fs.existsSync(path.join(root, 'src/components/common/navConfig.tsx')));
check('واجهة الفرع (NavBranch) موجودة', nav.includes('interface NavBranch') && nav.includes('branches: NavBranch[]'));
check('الشريط الجانبي يستورد navConfig', sidebar.includes("from './navConfig'"));
check('لوحة القسم تستورد navConfig', hub.includes("from './navConfig'"));
check('القسم قابل للفتح (aria-expanded={open})', sidebar.includes('aria-expanded={open}'));
check('سهم واحد اختياري عند القسم النشط (ChevronDown)', sidebar.includes('ChevronDown'));

console.log('\n=== الأقسام الرئيسية: 5 في الشريط + 14 حالة عرض محفوظة (دمج لا حذف) ===');
// القائمة الجانبية تُعرض الآن 5 أقسام فقط (تجميع أذكى). لكن كل معرّفات الأقسام
// السابقة (14) تبقى صالحة كحالات عرض في App.tsx (تُوجَّه للقسم الحاوي) فلا تُكسر
// أي وجهة تنقّل قائمة — دمج لا حذف.
const NAV_SECTION_IDS_ACTIVE = [
  'section_home',       // مركز القيادة والعقل (يشمل brains/central/security/memory)
  'section_publish',    // النشر والمنصات
  'section_customers',  // الزبائن والتفاعلات
  'section_products',   // المنتجات والمعرفة
  'section_settings',   // الإعدادات والتشغيل (يشمل automation/recovery/external/monitoring/storage)
];
const LEGACY_SECTION_IDS = [
  'section_brains', 'section_central', 'section_security',
  'section_automation', 'section_memory', 'section_storage',
  'section_monitoring', 'section_recovery', 'section_external',
];
check('الأقسام الخمسة الفعلية معرّفة في خريطة التنقل', NAV_SECTION_IDS_ACTIVE.every((s) => nav.includes(`id: '${s}'`)));
check('عدد الأقسام الفعلية = 5 بالضبط', (nav.match(/^\s{4}id: 'section_/gm) || []).length === 5);
check('الأقسام القديمة (14) كلها محفوظة كحالات عرض في App (دمج لا حذف)',
  [...NAV_SECTION_IDS_ACTIVE, ...LEGACY_SECTION_IDS].every((s) => app.includes(`case '${s}':`)));
check('لا حذف لأي معرّف قسم قديم من App.tsx', LEGACY_SECTION_IDS.every((s) => app.includes(`case '${s}':`)));

console.log('\n=== دمج لا حذف: كل وظيفة سابقة ما زالت متصلة ===');
const LEAVES = [
  'command_center', 'dashboard', 'central_brain', 'brain_manager', 'central_agent', 'search', 'operations',
  'content', 'approval', 'calendar', 'social', 'social_manager', 'analytics', 'agent', 'marketing_agent',
  'youtube_operations', 'customers', 'database', 'platform_connections', 'users', 'system', 'cloud_backup',
];
check('كل معرّفات الوظائف في خريطة التنقل', LEAVES.every((id) => nav.includes(`id: '${id}'`)));
check('كل معرّفات الوظائف لها حالة عرض حقيقية في App', LEAVES.every((id) => app.includes(`case '${id}':`)));

console.log('\n=== المنصات العشر: مصدر واحد + التبديل داخلي (لا تكرار في الشريط) ===');
const PLATFORM_LABELS = ['Facebook', 'Instagram', 'TikTok', 'YouTube', 'Telegram', 'Threads', 'WhatsApp Business', 'X', 'Snapchat', 'Google Business Profile'];
// حسم التكرار: المنصات العشر لم تعد أوراقاً منفصلة بنفس id='social' (كانت 10 بنود
// تفتح نفس الصفحة) — صارت مصدراً واحداً `NAV_PLATFORM_LABELS` والتبديل داخلي في
// صفحة المنصات (SocialHubView تعرض أزرار المنصات لكل منصة حقيقية).
const socialHub = read('src/components/social/SocialHubView.tsx');
check('أسماء المنصات العشر في مصدر واحد', PLATFORM_LABELS.every((p) => nav.includes(`'${p}'`)));
check('مصدر المنصات الموحّد مُصدَّر (NAV_PLATFORM_LABELS)', nav.includes('export const NAV_PLATFORM_LABELS'));
check('صفحة المنصات تبدّل المنصة داخلياً (أزرار لكل منصة)', socialHub.includes('selectedPlatform') && socialHub.includes('PLATFORM_LABELS'));
check('لا تكرار وهمي: id=social يظهر مرة واحدة كورقة', (nav.match(/id: 'social'/g) || []).length === 1);

console.log('\n=== البحث في الأقسام والوظائف ===');
check('دالة البحث موجودة', nav.includes('export function searchNav'));
check('الشريط يوفّر حقل بحث', sidebar.includes('searchNav') && sidebar.includes('placeholder="بحث في الأقسام والوظائف'));

console.log('\n=== مسار التنقّل الموحّد (بلا breadcrumb مكرر) ===');
check('لوحة القسم بلا breadcrumb مكرر (أُزيل)', !hub.includes('aria-label="مسار التنقّل"') && !hub.includes('الرئيسية'));
check('لوحة القسم تعرض ترويسة فخمة للقسم', hub.includes('text-xl font-black') && hub.includes('accent-top'));

console.log('\n=== مصدر الحقيقة + حفظ حالة الفتح ===');
check('SectionHub يعتمد نفس خريطة التنقل', hub.includes('NAV_SECTIONS') && hub.includes('visibleSectionBranches'));
check('الشريط يحفظ حالة الفتح', sidebar.includes('gharabi-nav-expanded-v1') && sidebar.includes('localStorage'));

console.log('\n=== الرئيسية = مركز قيادة حقيقي (بلا اختلاق) ===');
check('CommandCenterView موجود', fs.existsSync(path.join(root, 'src/components/dashboard/CommandCenterView.tsx')));
check('مركز القيادة مربوط في App', app.includes("case 'command_center': return <CommandCenterView />"));
check('يقرأ صحة النظام الحقيقية', cc.includes('apiService.checkHealth'));
check('يقرأ حالة المنصات الحقيقية', cc.includes('apiService.getPlatformControlPlane'));
check('يفشل بصراحة لا باختراع', cc.includes('تعذّر قراءة') && cc.includes('errors'));
check('الشاشة الافتراضية = الرئيسية', appCtx.includes("useState<string>('section_home')"));

console.log('\n=== المنصات العشر المعتمدة (لا حذف) ===');
const reg = read('engine/social/registry.ts');
const PLATFORMS = ['facebook', 'instagram', 'tiktok', 'youtube', 'whatsapp', 'telegram', 'x', 'snapchat', 'threads', 'google_business'];
check('كل المنصات العشر في السجل', PLATFORMS.every((p) => reg.includes(`'${p}'`) || reg.includes(`"${p}"`)));

console.log('\n=== دليل «لا حذف»: كل ملفات الواجهات السابقة ما زالت موجودة ===');
const VIEW_FILES = [
  'src/App.tsx',
  'src/components/common/Sidebar.tsx',
  'src/components/common/SectionHub.tsx',
  'src/components/dashboard/DashboardView.tsx',
  'src/components/social/SocialHubView.tsx',
  'src/components/social/SocialManagerView.tsx',
  'src/components/social/PlatformConnectionCenter.tsx',
  'src/components/content/ContentEngineView.tsx',
  'src/components/approval/ApprovalWorkflowView.tsx',
  'src/components/customers/CustomerCenterView.tsx',
  'src/components/database/ShowroomDatabaseView.tsx',
  'src/components/calendar/ContentCalendarView.tsx',
  'src/components/analytics/AnalyticsView.tsx',
  'src/components/users/UserManagementView.tsx',
  'src/components/system/SystemControlView.tsx',
  'src/components/system/CloudBackupView.tsx',
  'src/components/search/GlobalSearchView.tsx',
  'src/components/operations/OperationsView.tsx',
  'src/components/sales/SalesCenterView.tsx',
  'src/components/control/OperationsControlView.tsx',
  'src/components/executive/ExecutiveCommandView.tsx',
  'src/components/business/BusinessSuiteView.tsx',
  'src/components/finance/FinanceView.tsx',
  'src/components/inventory/InventoryView.tsx',
  'src/components/reports/ReportsView.tsx',
  'src/components/agent/CentralAgentView.tsx',
  'src/components/agent/CentralAgentConsole.tsx',
  'src/components/agent/YouTubeOperationsView.tsx',
  'src/components/agent/BrainCommandView.tsx',
  'src/components/agent/CentralBrainView.tsx',
  'src/components/agent/MarketingAgentView.tsx',
];
const missing = VIEW_FILES.filter((f) => !fs.existsSync(path.join(root, f)));
check('لا حذف لأي ملف واجهة سابق', missing.length === 0);
if (missing.length) console.error('    ملفات مفقودة:', missing.join(', '));

console.log('\n=== سلوك الضغط على القسم (انحدار: محتوى القسم الخطأ) ===');
// عطل حقيقي مُثبت: كان `toggleSection` ينقّل فقط عند فتح قسم مُغلق
// (`if (!expandedSections.includes(id)) setActiveTab(id)`)، فضغط قسم مفتوح (أو فُتح
// تلقائياً للورقة النشطة) يطوي فروعه بلا تنقّل، فيبقى المحتوى على القسم السابق —
// فيبدو كأن الضغط فتح محتوى قسم آخر، وكأن الفروع لا تستجيب.
const toggleSectionBody = sidebar.slice(
  sidebar.indexOf('const toggleSection'),
  sidebar.indexOf('const badgeFor'),
);
check('toggleSection ينقّل دائماً إلى القسم (بلا شرط فتح)', /setActiveTab\(id\)/.test(toggleSectionBody));
check('toggleSection لا يربط التنقّل بحالة الفتح', !/if\s*\(!expandedSections\.includes\(id\)\)/.test(toggleSectionBody));

// لا طيّ متداخل للفروع بعد الآن: الوظائف تُضغط مباشرة (بلا ضغطة ثانية لفتح الفرع).
check('لا طيّ متداخل للفروع (أُزيل toggleBranch)', !sidebar.includes('const toggleBranch'));
check('الوظائف قابلة للضغط مباشرة (handleLeafClick)', sidebar.includes('handleLeafClick(leaf.id)'));

console.log('\n=== البنود العشرة (إعادة تصميم القائمة الاحترافية) ===');
// 1) تقليص الأقسام إلى 5.
check('1) تقليص إلى 5 أقسام رئيسية', (nav.match(/^\s{4}id: 'section_/gm) || []).length === 5);
// 2) حسم تكرار الـid: كل معرّف ورقة يظهر مرة واحدة فقط في القسم.
check('2) حسم التكرار: id=social مرة واحدة', (nav.match(/id: 'social'/g) || []).length === 1);
check('2) حسم التكرار: id=central_brain مرة واحدة', (nav.match(/id: 'central_brain'/g) || []).length === 1);
check('2) حسم التكرار: id=central_agent مرة واحدة', (nav.match(/id: 'central_agent'/g) || []).length === 1);
check('2) حسم التكرار: id=brain_manager مرة واحدة', (nav.match(/id: 'brain_manager'/g) || []).length === 1);
check('2) دالة إزالة التكرار موجودة (dedupeLeaves)', nav.includes('export function dedupeLeaves'));
// 3) إزالة نص المطوّر من الواجهة (منقول إلى تعليق كود).
check('3) نص المطوّر أُزيل من الواجهة (Sidebar)', !sidebar.includes('كل الوظائف القديمة ما زالت متاحة'));
check('3) النص محفوظ في تعليق كود (navConfig)', nav.includes('ملاحظة تطوير') && nav.includes('لا تُعرض للمستخدم'));
// 4) تدرّج بصري حقيقي بين المستويات الثلاثة (ضخم → متوسط → خفيف).
check('4) تدرّج بصري: عنوان القسم text-base font-black', sidebar.includes('text-base font-black tracking-wide'));
check('4) تدرّج بصري: الفرع بخط خفيف (فاصل صغير)', sidebar.includes('text-[10px] font-bold uppercase tracking-wider'));
check('4) تدرّج بصري: الورقة text-[11px] font-normal', sidebar.includes('text-[11px] truncate flex-1') && sidebar.includes('font-normal'));
check('4) تدرّج الأيقونات: قسم w-5 / ورقة w-3.5', sidebar.includes('w-5 h-5 transition-colors') && (sidebar.match(/w-3\.5 h-3\.5 shrink-0/g) || []).length >= 1);
check('4) تدرّج الصناديق: قسم w-11 / ورقة w-5', sidebar.includes('w-11 h-11 rounded-xl') && sidebar.includes('w-5 h-5 rounded-md'));
check('4) صناديق الأيقونات محايدة (لا ألوان متعدّدة)', nav.includes('bg-slate-800/70 ring-1 ring-inset ring-slate-700'));
check('4) انتقال سلس موحّد', sidebar.includes('transition-all duration-200') && sidebar.includes('group-hover:scale-[1.04]'));
// 5) فاصل بصري بين الأقسام.
check('5) فاصل بصري بين الأقسام', sidebar.includes('h-px bg-slate-800/70'));
// 6) شارات مفرّقة بالدلالة.
check('6) تمييز الشارات العاجلة/المعلوماتية', nav.includes('NAV_BADGE_URGENT_IDS') && nav.includes('navBadgeTone'));
check('6) شارة عاجلة بلون مختلف (amber)', sidebar.includes('bg-amber-500/20 text-amber-300'));
check('6) شارة عادية بلون محايد (slate)', sidebar.includes('bg-slate-800 text-slate-300 border-slate-700'));
// 7) ملخّص سريع أعلى الشجرة.
check('7) ملخّص سريع أعلى القائمة', sidebar.includes('يحتاج انتباهك') && sidebar.includes('attentionCount'));
// 8) حالة focus-visible.
check('8) حالة focus-visible لكل عنصر', sidebar.includes('focus-visible:ring-2') && sidebar.includes('FOCUS_RING'));
// 9) مؤشر صحة في الترويسة.
check('9) مؤشر صحة في الترويسة', header.includes('systemHealth') && header.includes('apiService.checkHealth'));
check('9) المؤشر من بيانات /api/health الحقيقية', header.includes("h?.status === 'ok'"));
// 10) منطق التفاعل القائم محفوظ.
check('10) مفتاح localStorage محفوظ', sidebar.includes('gharabi-nav-expanded-v1'));
check('10) فتح القسم عند الضغط دائماً محفوظ', /setActiveTab\(id\)/.test(sidebar.slice(sidebar.indexOf('const toggleSection'), sidebar.indexOf('const badgeFor'))));
check('10) البحث محفوظ', sidebar.includes('searchNav') && sidebar.includes('placeholder="بحث في الأقسام والوظائف'));

console.log('\n=== الهوية البصرية الموحّدة (لون تمييز واحد) ===');
// هوية واحدة لكل الأقسام الخمسة — بلا ألوان متعدّدة (لا «أزرق مُبهَم»).
check('هوية واحدة: كائن NAV_ACCENT موجود', nav.includes('export const NAV_ACCENT: NavAccent'));
check('هوية واحدة: كل الأقسام الخمسة تستخدم NAV_ACCENT', (nav.match(/accent: NAV_ACCENT,/g) || []).length === 5);
check('هوية واحدة: أسماء قديمة تُشير للهوية نفسها (توافق خلفي)', nav.includes('sky: NAV_ACCENT') && nav.includes('steel: NAV_ACCENT'));
check('لا ألوان متعدّدة في التمييز (لا sky/violet/emerald في الصناديق)', !nav.includes('from-sky-500/20') && !nav.includes('from-violet-500/20'));
check('توهج عند القسم النشط فقط (boxActive + shadow-accent)', nav.includes('shadow-accent/30') && nav.includes('bg-accent text-slate-950'));
check('حلقة خفيفة حول صندوق الأيقونة (ring-inset)', nav.includes('ring-1 ring-inset ring-accent/40'));
check('صندوق القسم عند التفعيل يستخدم accent (لا لون ثابت)', sidebar.includes('section.accent.boxActive') && sidebar.includes('section.accent.rowActive'));
check('أيقونة القسم عند التفعيل بلون فاتح على accent', sidebar.includes("sectionActive ? 'text-slate-950' : section.accent.icon"));
check('لا كسر الدلالة: الورقة النشطة بلون التمييز', sidebar.includes('bg-accent/15 text-accent'));
check('لا كسر الدلالة: العاجل يبقى كهرمانياً', sidebar.includes('bg-amber-500/20 text-amber-300'));
check('ملاءمة الأيقونة: brain_manager صار BrainCircuit (لا Users)', nav.includes("id: 'brain_manager'") && nav.includes('icon: BrainCircuit'));
check('ملاءمة الأيقونة: قسم الزبائن صار MessageSquareText', nav.includes("icon: MessageSquareText"));
check('ملاءمة الأيقونة: قسم المنتجات صار Store', nav.includes('icon: Store'));
check('ملاءمة الأيقونة: قسم الإعدادات صار Cog', nav.includes('icon: Cog'));
check('حركة دخول خفيفة (animate-nav-in) على اللوحة الفرعية', (sidebar.match(/animate-nav-in/g) || []).length >= 1);
check('الحركة CSS خالص بلا مكتبة (keyframes nav-in + reduced-motion)', read('src/index.css').includes('@keyframes nav-in') && read('src/index.css').includes('prefers-reduced-motion'));
check('صفر أسهم متكدّسة: لا سهم على الفروع (الفرع فاصل لا طيّ)', !sidebar.includes('-rotate-90') || (sidebar.match(/-rotate-90/g) || []).length === 1);
check('مسار تنقّل واحد: لوحة القسم بلا شرائط أوراق مكررة', !hub.includes('setActiveTab(it.id)'));

console.log(`\n${fail === 0 ? 'PASSED' : 'FAILED'}: ${pass} تنقل هرمي، ${fail} فشل`);
if (fail > 0) process.exit(1);
