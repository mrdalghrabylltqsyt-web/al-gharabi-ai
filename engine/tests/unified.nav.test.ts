/**
 * اختبار توحيد الواجهة (fail-old / pass-new).
 *
 * يثبت أن التنقل أُعيد تنظيمه إلى **خمسة أقسام رئيسية** مع **عدم فقدان أي وظيفة
 * سابقة** (دمج لا حذف)، وأن مصدر التنقل واحد (Sidebar) يستخدمه كلٌّ من القائمة
 * وصفحة القسم، وأن الرئيسية (مركز القيادة) تقرأ من الخادم الحقيقي بلا اختلاق.
 *
 * قبل هذا الإصلاح كانت القائمة ~20 قسماً مستقلاً؛ هذا الملف يفشل على الشجرة
 * القديمة (لا `section_` أقسام، ولا SectionHub، ولا CommandCenterView) وينجح بعدها.
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

const sidebar = read('src/components/common/Sidebar.tsx');
const app = read('src/App.tsx');
const appCtx = read('src/context/AppContext.tsx');
const hub = read('src/components/common/SectionHub.tsx');
const cc = read('src/components/dashboard/CommandCenterView.tsx');

console.log('\n=== توحيد الواجهة: خمسة أقسام ===');
const sections = ['section_home', 'section_publish', 'section_customers', 'section_products', 'section_settings'];
check('خمسة أقسام رئيسية بالضبط', (sidebar.match(/id: 'section_[a-z]+'/g) || []).length === 5);
check('كل الأقسام الخمسة معرّفة', sections.every((s) => sidebar.includes(`id: '${s}'`)));
check('عنوان «مركز القيادة والعقل» موجود', sidebar.includes("label: 'مركز القيادة والعقل'"));
check('عنوان «النشر والمنصات» موجود', sidebar.includes("label: 'النشر والمنصات'"));
check('عنوان «الزبائن والتفاعلات» موجود', sidebar.includes("label: 'الزبائن والتفاعلات'"));
check('عنوان «المنتجات والمعرفة» موجود', sidebar.includes("label: 'المنتجات والمعرفة'"));
check('عنوان «الإعدادات والتشغيل» موجود', sidebar.includes("label: 'الإعدادات والتشغيل'"));

console.log('\n=== دمج لا حذف: كل وظيفة سابقة ما زالت متصلة ===');
const LEAVES = [
  'command_center', 'dashboard', 'central_brain', 'brain_manager', 'central_agent', 'search', 'operations',
  'content', 'approval', 'calendar', 'social', 'social_manager', 'analytics', 'agent', 'marketing_agent',
  'youtube_operations', 'customers', 'database', 'platform_connections', 'users', 'system', 'cloud_backup',
];
check('كل معرّفات الوظائف في القائمة', LEAVES.every((id) => sidebar.includes(`id: '${id}'`)));
check('كل معرّفات الوظائف لها حالة عرض في App', LEAVES.every((id) => app.includes(`case '${id}':`)));
check('لا تكرار لمعرّف ورقة في القائمة', LEAVES.every((id) => (sidebar.match(new RegExp(`id: '${id}'`, 'g')) || []).length === 1));

console.log('\n=== عرض الأقسام + مصدر واحد ===');
check('App يعرض الأقسام الخمسة', sections.every((s) => app.includes(`case '${s}':`)));
check('App يستخدم SectionHub', app.includes('SectionHub'));
check('SectionHub يعتمد نفس خريطة Sidebar', hub.includes("from './Sidebar'") && hub.includes('NAV_SECTIONS'));
check('Sidebar يعرّض helper الدور', sidebar.includes('visibleSectionGroups'));

console.log('\n=== الرئيسية = مركز قيادة حقيقي (بلا اختلاق) ===');
check('CommandCenterView موجود', fs.existsSync(path.join(root, 'src/components/dashboard/CommandCenterView.tsx')));
check('مركز القيادة مربوط في App', app.includes("case 'command_center': return <CommandCenterView />"));
check('يقرأ صحة النظام الحقيقية', cc.includes('apiService.checkHealth'));
check('يقرأ حالة المنصات الحقيقية', cc.includes('apiService.getPlatformControlPlane'));
check('يقرأ حالة العقل المركزي', cc.includes('apiService.getBrainState'));
check('يفشل بصراحة لا باختراع', cc.includes('تعذّر قراءة') && cc.includes('errors'));
check('الشاشة الافتراضية = الرئيسية', appCtx.includes("useState<string>('section_home')"));

console.log('\n=== المنصات العشر المعتمدة (لا حذف) ===');
const reg = read('engine/social/registry.ts');
const PLATFORMS = ['facebook', 'instagram', 'tiktok', 'youtube', 'whatsapp', 'telegram', 'x', 'snapchat', 'threads', 'google_business'];
check('كل المنصات العشر في السجل', PLATFORMS.every((p) => reg.includes(`'${p}'`) || reg.includes(`"${p}"`)));

console.log('\n=== دليل «لا حذف»: كل ملفات الواجهات السابقة ما زالت موجودة ===');
// هذه الملفات حُذف أحدها = انتهاك «دمج لا حذف». إعادة التنظيم تنقل الواجهة فقط.
const VIEW_FILES = [
  'src/App.tsx',
  'src/components/common/Sidebar.tsx',
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

console.log(`\n${fail === 0 ? 'PASSED' : 'FAILED'}: ${pass} توحيد واجهة، ${fail} فشل`);
if (fail > 0) process.exit(1);
