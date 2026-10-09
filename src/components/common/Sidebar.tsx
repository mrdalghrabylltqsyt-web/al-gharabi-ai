import React from 'react';
import { useApp } from '../../context/AppContext';
import {
  LayoutDashboard,
  Share2,
  Sparkles,
  ShieldCheck,
  MessageSquare,
  Database,
  Bot,
  BarChart3,
  Calendar,
  Users,
  X,
  Package,
  BadgePercent,
  CheckCircle2,
  ServerCog,
  Search,
  ClipboardList,
  Brain,
  PlugZap,
  CloudUpload,
  Home,
  Send,
  Settings,
  Youtube,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// خريطة التنقل الموحّدة — مصدر واحد للحقيقة (توحيد الواجهة).
//
// الجذر: كانت القائمة ~20 قسماً مستقلاً متداخلاً الوظائف (عقل/وكيل/سوشيال/تحليل/
// جدولة/نسخ…). وُحّدت إلى **خمسة أقسام رئيسية** يطابق كل منها مرحلة من دورة العمل:
//   الرئيسية = حالة النظام وملخص العمل والتنبيهات.
//   النشر = إنشاء المحتوى ← اعتماد ← جدولة ← نشر ← نتائج.
//   الزبائن = التعليقات والرسائل والردود.
//   المنتجات = مستودع المنتجات والأسعار.
//   الإعدادات = ربط المنصات والصلاحيات والنظام (وفيه مجموعة المالك التقنية).
// كل صفحة قائمة سابقة تبقى **متصلة** داخل القسم المناسب (لا حذف وظائف)؛ الوحدات
// المتداخلة (العقول/الوكلاء) دُمجت تحت القسم ذي العلاقة بدل أقسام منفصلة.
// ─────────────────────────────────────────────────────────────────────────────

export interface NavLeaf {
  id: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  ownerOnly?: boolean;
}
export interface NavGroup { title: string; items: NavLeaf[]; }
export interface NavSection {
  id: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  ownerOnly?: boolean;
  /** وصف المسار الموحّد لكل قسم (يُعرض في صفحة القسم). */
  flow: string;
  groups: NavGroup[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'section_home',
    label: 'مركز القيادة والعقل',
    desc: 'حالة النظام وملخص العمل والتنبيهات',
    icon: Home,
    flow: 'نظرة موحّدة: ما يعمل، ما يحتاج إجراءً، ومهام العقل المعلّقة.',
    groups: [
      {
        title: 'مركز القيادة',
        items: [
          { id: 'command_center', label: 'مركز القيادة', desc: 'حالة النظام، ملخص العمل، والتنبيهات', icon: LayoutDashboard },
          { id: 'dashboard', label: 'لوحة التحكم الرئيسية', desc: 'المؤشرات والعمليات الحالية', icon: LayoutDashboard },
        ],
      },
      {
        title: 'العقل المركزي',
        items: [
          { id: 'central_brain', label: 'العقل المركزي متعدد المنصات', desc: 'ذكاء المحتوى والتعلّم والتوصيات لكل المنصات', icon: Brain },
          { id: 'brain_manager', label: 'العقل المفكر', desc: 'تحليل المواقف الميدانية واستنتاج القرار', icon: Brain },
          { id: 'central_agent', label: 'العقل المركزي التنفيذي', desc: 'مهمة ← تخطيط ← أدوات ← تنفيذ ← تحقق ← سجل', icon: Bot },
        ],
      },
      {
        title: 'أدوات وعمليات',
        items: [
          { id: 'search', label: 'البحث الموحد', desc: 'بحث سريع في بيانات النظام', icon: Search },
          { id: 'operations', label: 'مركز العمليات والمتابعة', desc: 'العملاء المحتملون والمهام والمتابعات', icon: ClipboardList },
        ],
      },
    ],
  },
  {
    id: 'section_publish',
    label: 'النشر والمنصات',
    desc: 'إنشاء المحتوى، اختيار المنصات، النشر والجدولة والنتائج',
    icon: Send,
    flow: 'إنشاء ← فحص التوافق ← اعتماد ← نشر/جدولة ← متابعة النتيجة لكل منصة.',
    groups: [
      {
        title: 'دورة المحتوى',
        items: [
          { id: 'content', label: 'إنشاء المحتوى', desc: 'توليد منشورات وتعديل النص لكل منصة', icon: Sparkles },
          { id: 'approval', label: 'الموافقة والاعتماد', desc: 'حوكمة النشر والمراجعة قبل النشر الموحّد', icon: ShieldCheck },
          { id: 'calendar', label: 'الجدولة والتقويم', desc: 'جدولة المنشورات حسب الأيام', icon: Calendar },
        ],
      },
      {
        title: 'المنصات والنتائج',
        items: [
          { id: 'social', label: 'حالة المنصات', desc: 'حالة الحسابات وقدرات النشر لكل منصة', icon: Share2 },
          { id: 'social_manager', label: 'مدير النشر', desc: 'النشر والتعليقات والتحليل لكل منصة', icon: Bot },
          { id: 'analytics', label: 'التحليلات والنتائج', desc: 'المشاهدات والوصول والتفاعل', icon: BarChart3 },
        ],
      },
      {
        title: 'عقل التسويق',
        items: [
          { id: 'agent', label: 'الوكيل الذكي المركزي', desc: 'استراتيجيات التسويق والأداء', icon: Sparkles },
          { id: 'marketing_agent', label: 'وكيل صياغة المحتوى', desc: 'مهمة → محتوى عربي جاهز', icon: Sparkles },
        ],
      },
    ],
  },
  {
    id: 'section_customers',
    label: 'الزبائن والتفاعلات',
    desc: 'التعليقات والرسائل والردود والمتابعة',
    icon: MessageSquare,
    flow: 'قراءة التفاعل ← فهم السؤال والمنتج ← رد عامي عراقي ← متابعة/تصعيد للمالك.',
    groups: [
      {
        title: 'صندوق الوارد',
        items: [
          { id: 'customers', label: 'صندوق الوارد الموحّد', desc: 'التعليقات والرسائل والردود والمتابعة', icon: MessageSquare },
        ],
      },
    ],
  },
  {
    id: 'section_products',
    label: 'المنتجات والمعرفة',
    desc: 'البحث في المستودع وإدارة المنتجات والأسعار',
    icon: Package,
    flow: 'المصدر الوحيد للحقيقة التجارية: السعر/المواصفات/التقسيط المسجّلة فعلاً.',
    groups: [
      {
        title: 'المستودع',
        items: [
          { id: 'database', label: 'مستودع المنتجات والأسعار', desc: 'المنتجات، الأقساط، والسياسات', icon: Database },
        ],
      },
    ],
  },
  {
    id: 'section_settings',
    label: 'الإعدادات والتشغيل',
    desc: 'ربط المنصات والصلاحيات وسياسات التشغيل',
    icon: Settings,
    flow: 'ربط المنصات ← الصلاحيات ← سياسات التشغيل ← (للمالك: التقني والتعافي).',
    groups: [
      {
        title: 'الربط والصلاحيات',
        items: [
          { id: 'platform_connections', label: 'ربط المنصات', desc: 'حالة كل منصة والإجراء التالي لتفعيلها', icon: PlugZap },
          { id: 'users', label: 'المستخدمون والصلاحيات', desc: 'أدوار الفريق وصلاحيات النشر', icon: Users },
        ],
      },
      {
        title: 'النظام',
        items: [
          { id: 'system', label: 'مراقبة النظام', desc: 'سلامة النظام والنسخ وسجل العمليات', icon: ServerCog, ownerOnly: true },
        ],
      },
      {
        title: 'الأتمتة',
        items: [
          { id: 'youtube_operations', ownerOnly: true, label: 'مدير تشغيل YouTube', desc: 'مراقبة القناة والتعليقات والرد الآلي والتحكم', icon: Youtube },
        ],
      },
      {
        title: 'تقني (للمالك)',
        items: [
          { id: 'cloud_backup', ownerOnly: true, label: 'التعافي والنسخ السحابي', desc: 'منظومة تعافٍ كاملة: CURRENT + نقاط استعادة + استعادة معزولة', icon: CloudUpload },
        ],
      },
    ],
  },
];

// SCOPE ISOLATION (LEGACY ERP): أسطح Inventory/CRM/Finance/Customers-360/Purchases/
// خارج نطاق المشروع المعلن (سوشيال + AI + تسويق)، ومعزولة على الخادم افتراضياً
// (404 SCOPE_DISABLED) — بما فيها المبيعات/المالية/دليل العملاء (sales/control).
// نخفي مداخلها كي لا تُعرض واجهات غير قابلة للاستخدام. تُعاد بإطفاء العزل على
// الخادم (GHARABI_ENABLE_LEGACY_ERP_SCOPE=true) وضبط هذا الثابت true.
const LEGACY_ERP_NAV_ENABLED = false;
const LEGACY_ERP_TAB_IDS = new Set(['executive', 'business', 'finance', 'inventory', 'reports', 'sales', 'control']);

/** الأوراق الظاهرة في قسمٍ ما بحسب دور المستخدم (نسخة واحدة للقائمة وصفحة القسم). */
export function visibleSectionGroups(section: NavSection, isOwner: boolean): NavGroup[] {
  return section.groups
    .map((g) => ({ ...g, items: g.items.filter((item) => (!item.ownerOnly || isOwner) && (LEGACY_ERP_NAV_ENABLED || !LEGACY_ERP_TAB_IDS.has(item.id))) }))
    .filter((g) => g.items.length > 0);
}

/** كل معرّفات الأوراق داخل قسم (لتمييز «نشط» عند فتح أي صفحة تابعة). */
export function sectionLeafIds(section: NavSection): string[] {
  return section.groups.flatMap((g) => g.items.map((i) => i.id));
}

interface SidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, onCloseMobile }) => {
  const { activeTab, setActiveTab, notificationBadge, currentUser, showroomInfo } = useApp();
  const isOwner = currentUser?.role === 'owner';

  const badgeFor = (leafId: string): string | null => {
    if (leafId === 'approval' && notificationBadge.pendingReviews > 0) return `${notificationBadge.pendingReviews} معلق`;
    if (leafId === 'customers' && notificationBadge.unreadMessages > 0) return `${notificationBadge.unreadMessages} استفسار`;
    if (leafId === 'calendar' && notificationBadge.scheduledToday > 0) return `${notificationBadge.scheduledToday} مجدول`;
    return null;
  };

  const handleItemClick = (id: string) => {
    setActiveTab(id);
    onCloseMobile();
  };

  const visibleSections = NAV_SECTIONS.filter((s) => !s.ownerOnly || isOwner);

  return (
    <>
      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed lg:sticky top-0 right-0 z-50 h-screen w-72 bg-slate-900 border-l border-slate-800 flex flex-col transition-transform duration-300 ease-in-out ${
          mobileOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Top Branding Section */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white font-extrabold shadow-md shadow-emerald-900/50">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-extrabold text-base text-white tracking-wide">
                معرض الغرابي <span className="text-emerald-400">للتقسيط</span>
              </h2>
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <BadgePercent className="w-3 h-3 text-emerald-400" />
                المركز الموحّد للتسويق والنشر
              </p>
            </div>
          </div>

          <button
            onClick={onCloseMobile}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Items — خمسة أقسام رئيسية فقط */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5 custom-scrollbar">
          <div className="px-3 pb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            أقسام النظام
          </div>

          {visibleSections.map((section) => {
            const Icon = section.icon;
            const leaves = sectionLeafIds(section);
            const isActive = activeTab === section.id || leaves.includes(activeTab);
            const sectionBadge = section.groups.flatMap((g) => g.items).map((i) => badgeFor(i.id)).find(Boolean) || null;

            return (
              <button
                key={section.id}
                onClick={() => handleItemClick(section.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-right transition-all group relative cursor-pointer ${
                  isActive
                    ? 'bg-gradient-to-l from-emerald-950/80 to-emerald-900/40 text-emerald-200 border border-emerald-500/30 shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    isActive
                      ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 group-hover:text-slate-200 group-hover:bg-slate-700'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>

                <div className="flex-1 min-w-0 text-right">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-xs font-bold truncate">{section.label}</p>
                    {sectionBadge && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold border bg-slate-800 text-slate-300 border-slate-700">
                        {sectionBadge}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 truncate">{section.desc}</p>
                </div>

                {isActive && (
                  <div className="absolute left-1 w-1 h-6 bg-emerald-400 rounded-full" />
                )}
              </button>
            );
          })}

          <p className="px-3 pt-3 text-[10px] text-slate-500 leading-relaxed">
            كل الأدوات القديمة ما زالت متاحة داخل الأقسام الخمسة (لا حذف لأي وظيفة).
          </p>
        </div>

        {/* Footer info: Active User Status & Quick Showroom details */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/40">
          <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50 flex items-center gap-3">
            <div className="relative">
              {currentUser?.avatar ? (
                <img
                  src={currentUser.avatar}
                  alt={currentUser.name}
                  className="w-8 h-8 rounded-lg object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 font-black text-xs flex items-center justify-center border border-emerald-500/30">
                  {currentUser?.name?.charAt(0) || 'م'}
                </div>
              )}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-slate-900 rounded-full" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold text-white truncate">{currentUser?.name || 'مستخدم النظام'}</span>
                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
              </div>
              <p className="text-[10px] text-emerald-400 font-medium">
                {currentUser?.roleTitleArabic || 'موثق'}
              </p>
            </div>
          </div>
          <div className="mt-2 text-center text-[10px] text-slate-400">
            {showroomInfo.name} • نظام الإدارة والذكاء الاصطناعي
          </div>
        </div>
      </aside>
    </>
  );
};
