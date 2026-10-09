/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, lazy, Suspense } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/common/Header';
import { Sidebar } from './components/common/Sidebar';
import { SectionHub } from './components/common/SectionHub';
import { CommandCenterView } from './components/dashboard/CommandCenterView';
import { DashboardView } from './components/dashboard/DashboardView';
import { SocialHubView } from './components/social/SocialHubView';
import { SocialManagerView } from './components/social/SocialManagerView';
import { PlatformConnectionCenter } from './components/social/PlatformConnectionCenter';
import { ContentEngineView } from './components/content/ContentEngineView';
import { ApprovalWorkflowView } from './components/approval/ApprovalWorkflowView';
import { CustomerCenterView } from './components/customers/CustomerCenterView';
import { ShowroomDatabaseView } from './components/database/ShowroomDatabaseView';
import { ContentCalendarView } from './components/calendar/ContentCalendarView';
import { AnalyticsView } from './components/analytics/AnalyticsView';
import { UserManagementView } from './components/users/UserManagementView';
import { LoginView } from './components/auth/LoginView';
import { SystemControlView } from './components/system/SystemControlView';
import { GlobalSearchView } from './components/search/GlobalSearchView';
import { SalesCenterView } from './components/sales/SalesCenterView';
import { OperationsControlView } from './components/control/OperationsControlView';
import { CheckCircle2, ShieldCheck } from 'lucide-react';

// تحسين الأداء (Phase 7): لوحات العقل/الوكيل الثقيلة تُحمَّل عند الطلب فقط (code
// splitting)، فلا يدفع مستخدم شاشة الدخول/اللوحة ثمن تحميلها في الحزمة الأولية.
// تُبقى الحالات في switch كما هي، فيستمر كل فحص عقد (App.tsx يحتوي 'case ...') بالنجاح.
const CentralAgentView = lazy(() => import('./components/agent/CentralAgentView').then((m) => ({ default: m.CentralAgentView })));
const CentralAgentConsole = lazy(() => import('./components/agent/CentralAgentConsole').then((m) => ({ default: m.CentralAgentConsole })));
const YouTubeOperationsView = lazy(() => import('./components/agent/YouTubeOperationsView').then((m) => ({ default: m.YouTubeOperationsView })));
const BrainCommandView = lazy(() => import('./components/agent/BrainCommandView').then((m) => ({ default: m.BrainCommandView })));
const CentralBrainView = lazy(() => import('./components/agent/CentralBrainView').then((m) => ({ default: m.CentralBrainView })));
const MarketingAgentView = lazy(() => import('./components/agent/MarketingAgentView').then((m) => ({ default: m.MarketingAgentView })));
const CloudBackupView = lazy(() => import('./components/system/CloudBackupView').then((m) => ({ default: m.CloudBackupView })));

// LEGACY ERP: أسطح خارج نطاق المشروع المعلن، مخفية من التنقل (LEGACY_ERP_NAV_ENABLED=false).
// تُحمَّل عند الطلب فقط (code splitting) فلا تثقل الحزمة الأولية، مع بقاء الحالات في
// switch فعّالة. ملاحظة: ExecutiveCommandView نفسه ينتقل إلى finance/inventory/reports/
// operations ديناميكياً، لذا لا يجوز إزالتها — الإزالة تكسر مسارات تنقّل قائمة.
const ExecutiveCommandView = lazy(() => import('./components/executive/ExecutiveCommandView').then((m) => ({ default: m.ExecutiveCommandView })));
const BusinessSuiteView = lazy(() => import('./components/business/BusinessSuiteView').then((m) => ({ default: m.BusinessSuiteView })));
const FinanceView = lazy(() => import('./components/finance/FinanceView').then((m) => ({ default: m.FinanceView })));
const InventoryView = lazy(() => import('./components/inventory/InventoryView').then((m) => ({ default: m.InventoryView })));
const ReportsView = lazy(() => import('./components/reports/ReportsView').then((m) => ({ default: m.ReportsView })));
const OperationsView = lazy(() => import('./components/operations/OperationsView').then((m) => ({ default: m.OperationsView })));

// رسائل عودة تفويض Google Drive (بلا أي سرّ): تُقرأ من معامل dr في الرابط.
const DR_RETURN_MESSAGES: Record<string, string> = {
  authorized: 'تم ربط Google Drive بنجاح.',
  error: 'تعذّر إكمال ربط Google Drive.',
  OAUTH_DENIED: 'رُفض التفويض من Google.',
  MISSING_CODE_OR_STATE: 'عودة التفويض بلا code/state صالحين.',
  UNKNOWN_STATE: 'جلسة التفويض غير معروفة أو منتهية. أعد المحاولة.',
  STATE_REUSED: 'استُخدم رابط التفويض مسبقاً. أعد المحاولة.',
  STATE_EXPIRED: 'انتهت صلاحية رابط التفويض. أعد المحاولة.',
  NO_REFRESH_TOKEN: 'لم تُعد Google رمز تجديد (offline). أعد التفويض.',
  TOKEN_KEY_MISSING: 'مفتاح تشفير رمز التجديد غير مضبوط على الخادم.',
};

const AppContent: React.FC = () => {
  const { activeTab, setActiveTab, toastMessage, showToast, isAuthenticated, isLoadingAuth, authUnavailable, retryAuth } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);

  // عودة تفويض Google Drive: الخادم يحوّل المتصفح إلى /?dr=authorized أو
  // /?dr=error&reason=<code>. نقرأ النتيجة، نفتح تبويب النسخ السحابي، ثم ننظّف
  // المعلمات من الرابط. لا نعرض أي سرّ (reason رمز آمن فقط).
  React.useEffect(() => {
    if (!isAuthenticated) return;
    const params = new URLSearchParams(window.location.search);
    const dr = params.get('dr');
    if (!dr) return;
    if (dr === 'authorized') {
      setActiveTab('cloud_backup');
      showToast(DR_RETURN_MESSAGES.authorized);
    } else {
      const reason = params.get('reason') || 'error';
      setActiveTab('cloud_backup');
      showToast(DR_RETURN_MESSAGES[reason] || DR_RETURN_MESSAGES.error);
    }
    params.delete('dr');
    params.delete('reason');
    const q = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);
  }, [isAuthenticated, setActiveTab, showToast]);

  // Authentication Gate: Block dashboard and admin data for unauthenticated users
  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-center font-['Cairo',sans-serif]">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4 animate-pulse">
          <ShieldCheck className="w-7 h-7 text-emerald-400" />
        </div>
        <p className="text-sm font-bold text-white mb-1">التحقق من جلسة الأمان المشفرة...</p>
        <p className="text-xs text-slate-400">معرض الغرابي للتقسيط • نظام الحوكمة والمصادقة</p>
      </div>
    );
  }

  // تعذّر الوصول لخادم التحقق مع وجود جلسة محفوظة: ليست شاشة دخول. الجلسة لم
  // تُرفض، لذا نعرض إعادة محاولة بدل مطالبة المالك بـOTP بسبب عطل عابر.
  if (authUnavailable && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-center font-['Cairo',sans-serif]">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4">
          <ShieldCheck className="w-7 h-7 text-amber-400" />
        </div>
        <p className="text-sm font-bold text-white mb-1">تعذّر الاتصال بخادم التحقق</p>
        <p className="text-xs text-slate-400 mb-4 max-w-sm leading-relaxed">
          جلستك ما زالت محفوظة ولم تُلغَ. قد يكون الخادم في بدء بارد أو هناك انقطاع شبكة مؤقت.
        </p>
        <button
          type="button"
          onClick={retryAuth}
          className="px-5 py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-black transition hover:bg-emerald-400"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginView />;
  }

  // خريطة الأوراق (نفس switch القديم) — تُستخدم للمسارات المباشرة وداخل صفحات الأقسام.
  // لا نسختان من المنطق: صفحات الأقسام (SectionHub) تستدعي هذه الدالة نفسها.
  const renderLeafView = (tab: string): React.ReactNode => {
    switch (tab) {
      case 'command_center': return <CommandCenterView />;
      case 'dashboard': return <DashboardView />;
      case 'executive': return <ExecutiveCommandView />;
      case 'social': return <SocialHubView />;
      case 'social_manager': return <SocialManagerView />;
      case 'platform_connections': return <PlatformConnectionCenter />;
      case 'content': return <ContentEngineView />;
      case 'approval': return <ApprovalWorkflowView />;
      case 'customers': return <CustomerCenterView />;
      case 'database': return <ShowroomDatabaseView />;
      case 'agent': return <CentralAgentView />;
      case 'central_agent': return <CentralAgentConsole />;
      case 'youtube_operations': return <YouTubeOperationsView />;
      case 'brain_manager': return <BrainCommandView />;
      case 'central_brain': return <CentralBrainView />;
      case 'marketing_agent': return <MarketingAgentView />;
      case 'calendar': return <ContentCalendarView />;
      case 'analytics': return <AnalyticsView />;
      case 'users': return <UserManagementView />;
      case 'system': return <SystemControlView />;
      case 'search': return <GlobalSearchView />;
      case 'operations': return <OperationsView />;
      case 'finance': return <FinanceView />;
      case 'sales': return <SalesCenterView />;
      case 'inventory': return <InventoryView />;
      case 'reports': return <ReportsView />;
      case 'business': return <BusinessSuiteView />;
      case 'control': return <OperationsControlView />;
      case 'cloud_backup': return <CloudBackupView />;
      default: return <CommandCenterView />;
    }
  };

  const renderActiveView = () => {
    // الأقسام الخمسة الرئيسية: صفحة قسم موحّدة تُفوّض العرض للأوراق (بلا تكرار منطق).
    switch (activeTab) {
      case 'section_home': return <SectionHub sectionId="section_home" renderLeaf={renderLeafView} />;
      case 'section_publish': return <SectionHub sectionId="section_publish" renderLeaf={renderLeafView} />;
      case 'section_customers': return <SectionHub sectionId="section_customers" renderLeaf={renderLeafView} />;
      case 'section_products': return <SectionHub sectionId="section_products" renderLeaf={renderLeafView} />;
      case 'section_settings': return <SectionHub sectionId="section_settings" renderLeaf={renderLeafView} />;
      default: return renderLeafView(activeTab);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 text-slate-950 px-5 py-2.5 rounded-2xl shadow-2xl shadow-emerald-500/40 text-xs sm:text-sm font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-4">
          <CheckCircle2 className="w-4 h-4 text-slate-950 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="flex flex-1 min-h-screen">
        {/* Right Sidebar (RTL) */}
        <Sidebar
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0">
          <Header onOpenMobileMenu={() => setMobileOpen(true)} />

          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-24 text-slate-400 text-sm font-bold">
                  جارٍ تحميل الوحدة...
                </div>
              }
            >
              {renderActiveView()}
            </Suspense>
          </main>

          {/* Footer */}
          <footer className="border-t border-slate-900 px-6 py-4 text-center text-xs text-slate-400 bg-slate-950/80">
            معرض الغرابي للتقسيط • منصة "الغرابي AI" الموحدة لإدارة جميع وسائل التواصل الاجتماعي وخدمة العملاء
          </footer>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
