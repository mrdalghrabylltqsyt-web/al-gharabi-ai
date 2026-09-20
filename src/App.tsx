/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/common/Header';
import { Sidebar } from './components/common/Sidebar';
import { DashboardView } from './components/dashboard/DashboardView';
import { SocialHubView } from './components/social/SocialHubView';
import { SocialManagerView } from './components/social/SocialManagerView';
import { ContentEngineView } from './components/content/ContentEngineView';
import { ApprovalWorkflowView } from './components/approval/ApprovalWorkflowView';
import { CustomerCenterView } from './components/customers/CustomerCenterView';
import { ShowroomDatabaseView } from './components/database/ShowroomDatabaseView';
import { CentralAgentView } from './components/agent/CentralAgentView';
import { BrainCommandView } from './components/agent/BrainCommandView';
import { MarketingAgentView } from './components/agent/MarketingAgentView';
import { ContentCalendarView } from './components/calendar/ContentCalendarView';
import { AnalyticsView } from './components/analytics/AnalyticsView';
import { UserManagementView } from './components/users/UserManagementView';
import { LoginView } from './components/auth/LoginView';
import { SystemControlView } from './components/system/SystemControlView';
import { GlobalSearchView } from './components/search/GlobalSearchView';
import { OperationsView } from './components/operations/OperationsView';
import { FinanceView } from './components/finance/FinanceView';
import { InventoryView } from './components/inventory/InventoryView';
import { ReportsView } from './components/reports/ReportsView';
import { SalesCenterView } from './components/sales/SalesCenterView';
import { ExecutiveCommandView } from './components/executive/ExecutiveCommandView';
import { BusinessSuiteView } from './components/business/BusinessSuiteView';
import { OperationsControlView } from './components/control/OperationsControlView';
import { CheckCircle2, ShieldCheck } from 'lucide-react';

const AppContent: React.FC = () => {
  const { activeTab, toastMessage, isAuthenticated, isLoadingAuth, authUnavailable, retryAuth } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const renderActiveView = () => {
    switch (activeTab) {
      case 'dashboard': return <DashboardView />;
      case 'executive': return <ExecutiveCommandView />;
      case 'social': return <SocialHubView />;
      case 'social_manager': return <SocialManagerView />;
      case 'content': return <ContentEngineView />;
      case 'approval': return <ApprovalWorkflowView />;
      case 'customers': return <CustomerCenterView />;
      case 'database': return <ShowroomDatabaseView />;
      case 'agent': return <CentralAgentView />;
      case 'brain_manager': return <BrainCommandView />;
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
      default: return <DashboardView />;
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
            {renderActiveView()}
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
