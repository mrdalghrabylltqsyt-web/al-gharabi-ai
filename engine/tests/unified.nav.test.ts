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

console.log('\n=== هيكل ثلاثي المستويات ===');
check('مصدر التنقل واحد: navConfig.tsx', fs.existsSync(path.join(root, 'src/components/common/navConfig.tsx')));
check('واجهة الفرع (NavBranch) موجودة', nav.includes('interface NavBranch') && nav.includes('branches: NavBranch[]'));
check('الشريط الجانبي يستورد navConfig', sidebar.includes("from './navConfig'"));
check('لوحة القسم تستورد navConfig', hub.includes("from './navConfig'"));
check('عناوين قابلة للفتح (aria-expanded)', sidebar.includes('aria-expanded={open}') && sidebar.includes('aria-expanded={bOpen}'));
check('سهم حالة الفتح/الإغلاق (ChevronDown)', sidebar.includes('ChevronDown'));

console.log('\n=== الأقسام الرئيسية المطلوبة (13+) ===');
const REQUIRED_SECTIONS = [
  'section_home',       // مركز القيادة والمالك
  'section_publish',    // النشر الموحد ومنصات التواصل
  'section_brains',     // العقول المتخصصة
  'section_central',    // العقل المركزي والمنسق التنفيذي
  'section_security',   // المصادقة والأمان والصلاحيات
  'section_customers',  // مركز الزبائن والتفاعلات
  'section_products',   // مستودع المنتجات والمعرفة
  'section_automation', // محرك الأتمتة والجدولة
  'section_memory',     // الذاكرة والتعلم والتحليل
  'section_storage',    // التخزين وقاعدة البيانات
  'section_monitoring', // المراقبة وصحة النظام
  'section_recovery',   // النسخ الاحتياطي والتعافي
  'section_external',   // الخدمات الخارجية والإعدادات
  'section_settings',   // الإعدادات والتشغيل
];
check('كل الأقسام المطلوبة معرّفة', REQUIRED_SECTIONS.every((s) => nav.includes(`id: '${s}'`)));
check('App يعرض كل الأقسام (case لكل قسم)', REQUIRED_SECTIONS.every((s) => app.includes(`case '${s}':`)));
check('الأقسام الخمسة الأصلية محفوظة', ['section_home','section_publish','section_customers','section_products','section_settings'].every((s) => nav.includes(`id: '${s}'`)));

console.log('\n=== دمج لا حذف: كل وظيفة سابقة ما زالت متصلة ===');
const LEAVES = [
  'command_center', 'dashboard', 'central_brain', 'brain_manager', 'central_agent', 'search', 'operations',
  'content', 'approval', 'calendar', 'social', 'social_manager', 'analytics', 'agent', 'marketing_agent',
  'youtube_operations', 'customers', 'database', 'platform_connections', 'users', 'system', 'cloud_backup',
];
check('كل معرّفات الوظائف في خريطة التنقل', LEAVES.every((id) => nav.includes(`id: '${id}'`)));
check('كل معرّفات الوظائف لها حالة عرض حقيقية في App', LEAVES.every((id) => app.includes(`case '${id}':`)));

console.log('\n=== المنصات العشر كفروع مستقلة ===');
const PLATFORM_LABELS = ['Facebook', 'Instagram', 'TikTok', 'YouTube', 'Telegram', 'Threads', 'WhatsApp Business', 'X', 'Snapchat', 'Google Business Profile'];
check('كل المنصات العشر معروضة كبنود/فروع', PLATFORM_LABELS.every((p) => nav.includes(`label: '${p}'`)));

console.log('\n=== البحث في الأقسام والوظائف ===');
check('دالة البحث موجودة', nav.includes('export function searchNav'));
check('الشريط يوفّر حقل بحث', sidebar.includes('searchNav') && sidebar.includes('placeholder="بحث في الأقسام والوظائف'));

console.log('\n=== مسار التنقّل (Breadcrumb) ===');
check('لوحة القسم تعرض مسار تنقّل', hub.includes('aria-label="مسار التنقّل"') && hub.includes('الرئيسية'));

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

console.log('\n=== سلوك الضغط على القسم/الفرع (انحدار: محتوى القسم الخطأ) ===');
// عطل حقيقي مُثبت: كان `toggleSection` ينقّل فقط عند فتح قسم مُغلق
// (`if (!expandedSections.includes(id)) setActiveTab(id)`)، فضغط قسم مفتوح (أو فُتح
// تلقائياً للورقة النشطة) يطوي فروعه بلا تنقّل، فيبقى المحتوى على القسم السابق —
// فيبدو كأن الضغط فتح محتوى قسم آخر، وكأن الفروع لا تستجيب.
const toggleSectionBody = sidebar.slice(
  sidebar.indexOf('const toggleSection'),
  sidebar.indexOf('const toggleBranch'),
);
check('toggleSection ينقّل دائماً إلى القسم (بلا شرط فتح)', /setActiveTab\(id\)/.test(toggleSectionBody));
check('toggleSection لا يربط التنقّل بحالة الفتح', !/if\s*\(!expandedSections\.includes\(id\)\)/.test(toggleSectionBody));

const toggleBranchBody = sidebar.slice(
  sidebar.indexOf('const toggleBranch'),
  sidebar.indexOf('const badgeFor'),
);
check('toggleBranch ينقّل إلى أول ورقة عند فتح فرع مغلق', /if\s*\(!wasOpen\s*&&\s*firstLeafId\)\s*setActiveTab\(firstLeafId\)/.test(toggleBranchBody));
check('الفرع يُمرّر أول ورقة وحالة الفتح الحالية', sidebar.includes('toggleBranch(branch.id, branch.items[0]?.id, bOpen)'));

console.log(`\n${fail === 0 ? 'PASSED' : 'FAILED'}: ${pass} تنقل هرمي، ${fail} فشل`);
if (fail > 0) process.exit(1);
