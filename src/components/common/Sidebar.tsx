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
  WalletCards,
  PackageCheck,
  FileBarChart2,
  Building2,
  Activity,
  Brain,
  PlugZap,
  CloudUpload,
} from 'lucide-react';

interface SidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, onCloseMobile }) => {
  const { activeTab, setActiveTab, notificationBadge, currentUser, showroomInfo } = useApp();

  // SCOPE ISOLATION (LEGACY ERP): أسطح Inventory/CRM/Finance/Customers-360/Purchases/
  // Reports خارج نطاق المشروع المعلن (سوشيال + AI + تسويق)، ومعزولة على الخادم
  // افتراضياً (404 SCOPE_DISABLED). نخفي مداخلها كي لا تُعرض واجهات غير قابلة
  // للاستخدام. تُعاد بإطفاء العزل على الخادم (GHARABI_ENABLE_LEGACY_ERP_SCOPE=true)
  // وضبط هذا الثابت true. (تبويبا sales/control غير معزولين فبقيَا ظاهرين.)
  const LEGACY_ERP_NAV_ENABLED = false;
  const LEGACY_ERP_TAB_IDS = new Set(['executive', 'business', 'finance', 'inventory', 'reports', 'operations']);

  const navigationItems = [
    {
      id: 'executive',
      label: 'مركز القيادة التنفيذي',
      icon: LayoutDashboard,
      badge: 'جديد',
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      desc: 'صورة موحدة للمبيعات والتحصيل والعملاء',
    },
    { id: 'search', label: 'البحث الموحد', icon: Search, badge: null, desc: 'بحث سريع في بيانات النظام', },
    {
      id: 'dashboard',
      label: 'لوحة التحكم الرئيسية',
      icon: LayoutDashboard,
      badge: null,
      desc: 'المؤشرات والعمليات الحالية',
    },
    {
      id: 'social',
      label: 'إدارة وسائل التواصل',
      icon: Share2,
      badge: '10 منصات',
      badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
      desc: 'حالة الحسابات والاتصال الموحد',
    },
    {
      id: 'content',
      label: 'مركز المحتوى الذكي',
      icon: Sparkles,
      badge: 'Gemini AI',
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      desc: 'توليد منشورات، سكربتات، إعلانات',
    },
    {
      id: 'approval',
      label: 'نظام الموافقة والاعتماد',
      icon: ShieldCheck,
      badge: notificationBadge.pendingReviews > 0 ? `${notificationBadge.pendingReviews} معلق` : null,
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      desc: 'حوكمة النشر مسودة ومراجعة',
    },
    { id: 'sales', label: 'مركز المبيعات والعقود', icon: WalletCards, badge: null, desc: 'المبيعات والأقساط والتحصيل', },
    { id: 'business', label: 'مركز الأعمال المتكامل', icon: Building2, badge: 'ERP', badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30', desc: 'الموردون والمشتريات والمصروفات والعقود', },
    { id: 'control', label: 'غرفة العمليات الموحدة', icon: Activity, badge: 'v9', badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30', desc: 'التنبيهات والتدفق النقدي ودليل العملاء', },
    {
      id: 'finance',
      label: 'المبيعات والتقسيط',
      icon: WalletCards,
      badge: null,
      desc: 'المبيعات والدفعات والأرصدة',
    },
    {
      id: 'inventory',
      label: 'مركز المخزون',
      icon: PackageCheck,
      badge: null,
      desc: 'الكميات والحركات والتنبيهات',
    },
    {
      id: 'reports',
      label: 'التقارير التشغيلية',
      icon: FileBarChart2,
      badge: null,
      desc: 'تقارير حقيقية من بيانات النظام',
    },
    {
      id: 'operations',
      label: 'مركز العمليات والمتابعة',
      icon: ClipboardList,
      badge: null,
      desc: 'العملاء المحتملون والمهام والمتابعات',
    },
    {
      id: 'customers',
      label: 'مركز العملاء الموحد',
      icon: MessageSquare,
      badge: notificationBadge.unreadMessages > 0 ? `${notificationBadge.unreadMessages} استفسار` : null,
      badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
      desc: 'الردود الذكية وتحويل الحالات',
    },
    {
      id: 'database',
      label: 'قاعدة بيانات المعرض',
      icon: Database,
      badge: null,
      desc: 'المنتجات، الأقساط، والسياسات',
    },
    {
      id: 'marketing_agent',
      label: 'وكيل الغرابي الذكي',
      icon: Sparkles,
      badge: 'مهمة جديدة',
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      desc: 'أعطِ الوكيل مهمة واحصل على محتوى عربي جاهز',
    },
    {
      id: 'central_agent',
      label: 'العقل المركزي',
      icon: Bot,
      badge: currentUser?.role === 'owner' ? 'Owner' : null,
      badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
      desc: 'مهمة → تخطيط → أدوات → تنفيذ → تحقق → سجل',
    },
    {
      id: 'youtube_operations',
      label: 'مدير تشغيل YouTube',
      icon: Bot,
      badge: currentUser?.role === 'owner' ? '24/7' : null,
      badgeColor: 'bg-red-500/20 text-red-300 border-red-500/30',
      desc: 'مراقبة القناة والتعليقات والرد الآلي والتحكم',
    },
    {
      id: 'agent',
      label: 'الوكيل الذكي المركزي',
      icon: Sparkles,
      badge: 'مستشار',
      badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
      desc: 'استراتيجيات التسويق والأداء',
    },
    {
      id: 'social_manager',
      label: 'مدير السوشيال ميديا',
      icon: Bot,
      badge: 'إدارة',
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      desc: 'إدارة المنصات والتعليقات والنشر والتحليل',
    },
    {
      id: 'platform_connections',
      label: 'مركز ربط المنصات',
      icon: PlugZap,
      badge: currentUser?.role === 'owner' ? 'Owner' : null,
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      desc: 'حالة كل منصة والإجراء التالي لتفعيلها',
    },
    {
      id: 'brain_manager',
      label: 'العقل الإداري المفكر',
      icon: Brain,
      badge: 'تحليل',
      badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      desc: 'تحليل المواقف الميدانية واستنتاج القرار',
    },
    {
      id: 'central_brain',
      label: 'العقل المركزي متعدد المنصات',
      icon: Brain,
      badge: 'ذكاء',
      badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
      desc: 'ذكاء محتوى وتعلّم وتوصيات لكل المنصات العشر',
    },
    {
      id: 'calendar',
      label: 'تقويم المحتوى',
      icon: Calendar,
      badge: notificationBadge.scheduledToday > 0 ? `${notificationBadge.scheduledToday} مجدول` : null,
      badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
      desc: 'جدولة المنشورات حسب الأيام',
    },
    {
      id: 'analytics',
      label: 'التحليلات والمقارنة',
      icon: BarChart3,
      badge: null,
      desc: 'المشاهدات والوصول والتفاعل',
    },
    {
      id: 'system',
      label: 'مركز التشغيل والحماية',
      icon: ServerCog,
      badge: currentUser?.role === 'owner' ? 'Owner' : null,
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      desc: 'سلامة النظام والنسخ وسجل العمليات',
    },
    {
      // النسخ السحابي خاص بالمالك: لا يظهر للموظف إطلاقاً (وتبقى حماية الخادم requireOwner).
      id: 'cloud_backup',
      label: 'التعافي والنسخ السحابي',
      icon: CloudUpload,
      ownerOnly: true,
      badge: currentUser?.role === 'owner' ? 'Owner' : null,
      badgeColor: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
      desc: 'منظومة تعافٍ كاملة: CURRENT + نقاط استعادة + استعادة معزولة',
    },
    {
      id: 'users',
      label: 'المستخدمين والصلاحيات',
      icon: Users,
      badge: null,
      desc: 'أدوار الفريق وصلاحيات النشر',
    },
  ];

  const handleItemClick = (id: string) => {
    setActiveTab(id);
    onCloseMobile();
  };

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
                المركز المالي والإعلامي الذكي
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

        {/* Navigation Items */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5 custom-scrollbar">
          <div className="px-3 pb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            أقسام النظام
          </div>

          {navigationItems.filter((item: any) => (!item.ownerOnly || currentUser?.role === 'owner') && (LEGACY_ERP_NAV_ENABLED || !LEGACY_ERP_TAB_IDS.has(item.id))).map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => handleItemClick(item.id)}
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
                    <p className="text-xs font-bold truncate">{item.label}</p>
                    {item.badge && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold border ${
                          item.badgeColor || 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 truncate">{item.desc}</p>
                </div>

                {isActive && (
                  <div className="absolute left-1 w-1 h-6 bg-emerald-400 rounded-full" />
                )}
              </button>
            );
          })}
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
