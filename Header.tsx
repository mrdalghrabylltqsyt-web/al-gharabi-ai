import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiService } from '../../services/api';
import {
  Sparkles,
  Bell,
  Search,
  ChevronDown,
  UserCheck,
  PlusCircle,
  Menu,
  ShieldCheck,
  Building2,
  RefreshCw,
  LogOut,
  Shield,
  Mail,
} from 'lucide-react';

interface HeaderProps {
  onOpenMobileMenu: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenMobileMenu }) => {
  const {
    currentUser,
    logout,
    notificationBadge,
    setActiveTab,
    syncAllPlatforms,
    showToast,
  } = useApp();

  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [aiReady, setAiReady] = useState<boolean | null>(null);

  React.useEffect(() => { apiService.checkHealth().then((h) => setAiReady(Boolean(h.aiEnabled))).catch(() => setAiReady(false)); }, []);

  const totalNotifications =
    notificationBadge.pendingReviews + notificationBadge.unreadMessages;

  const handleSync = () => {
    setIsSyncing(true);
    syncAllPlatforms();
    setTimeout(() => setIsSyncing(false), 800);
  };

  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 lg:px-8 py-3 transition-colors">
      <div className="flex items-center justify-between gap-4">
        {/* Right side (in RTL, this is the start): Mobile Toggle + Title + AI Indicator */}
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenMobileMenu}
            className="lg:hidden p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
            aria-label="فتح القائمة"
          >
            <Menu className="w-6 h-6" />
          </button>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white font-bold text-lg">
              غ
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-extrabold text-lg tracking-tight text-white flex items-center gap-1.5">
                  الغرابي <span className="text-emerald-400">AI</span>
                </h1>
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  {aiReady === null ? 'فحص Gemini...' : aiReady ? 'Gemini مفعّل' : 'Gemini محمي/غير مفعّل'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                مركز الذكاء الموحد لمعرض الغرابي للتقسيط
              </p>
            </div>
          </div>
        </div>

        {/* Center: Search & Quick Stat */}
        <div className="hidden md:flex items-center flex-1 max-w-md mx-4">
          <div className="relative w-full">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="ابحث عن منتج، قسط، منشور، أو عميل..."
              className="w-full bg-slate-950/60 border border-slate-800 rounded-xl py-2 pr-9 pl-4 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/60 transition"
            />
          </div>
        </div>

        {/* Left side (in RTL, this is the end): Quick Actions, Notifications, Role Switcher */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Quick Create Button */}
          <button
            onClick={() => setActiveTab('content')}
            className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-emerald-900/30 transition active:scale-95 cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-emerald-200" />
            <span className="hidden sm:inline">إنشاء محتوى ذكي</span>
            <span className="sm:hidden">إنشاء</span>
          </button>

          {/* Sync Button */}
          <button
            onClick={handleSync}
            title="مزامنة الحسابات والمنصات"
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 text-slate-300 hover:text-emerald-400 transition"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-emerald-400' : ''}`} />
          </button>

          {/* Notifications Popover */}
          <div className="relative">
            <button
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              className="relative p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 text-slate-300 transition"
            >
              <Bell className="w-4 h-4" />
              {totalNotifications > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center animate-bounce">
                  {totalNotifications}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-72 sm:w-80 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl shadow-black/80 p-3 z-50 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs text-slate-400 font-medium">
                  <span>تنبيهات النظام اللحظية</span>
                  <span className="text-emerald-400 font-semibold">{totalNotifications} جديد</span>
                </div>
                <div className="space-y-2 py-2 max-h-64 overflow-y-auto">
                  {notificationBadge.pendingReviews > 0 && (
                    <div
                      onClick={() => {
                        setActiveTab('approval');
                        setNotificationsOpen(false);
                      }}
                      className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-200 text-xs cursor-pointer hover:bg-amber-900/40 transition flex items-start gap-2"
                    >
                      <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-amber-300">
                          {notificationBadge.pendingReviews} منشورات تحتاج مراجعة وموافقة
                        </p>
                        <p className="text-[11px] text-amber-200/80">انقر للاعتماد أو التعديل قبل النشر</p>
                      </div>
                    </div>
                  )}

                  {notificationBadge.unreadMessages > 0 && (
                    <div
                      onClick={() => {
                        setActiveTab('customers');
                        setNotificationsOpen(false);
                      }}
                      className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-xs cursor-pointer hover:bg-emerald-900/40 transition flex items-start gap-2"
                    >
                      <Building2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-emerald-300">
                          {notificationBadge.unreadMessages} استفسارات عملاء جديدة
                        </p>
                        <p className="text-[11px] text-emerald-200/80">
                          استفسارات واردة عبر قنوات التواصل المربوطة
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="p-2.5 rounded-xl bg-slate-800/50 text-xs text-slate-300 flex items-start gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0"></span>
                    <div>
                      <p className="font-medium text-slate-200">الوكيل الذكي جاهز</p>
                      <p className="text-[11px] text-slate-400">
                        جاهز لتوليد المحتوى الذكي والرد على استفسارات التقسيط
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Authenticated User Profile & Logout */}
          <div className="relative">
            <button
              onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 transition cursor-pointer"
            >
              {currentUser?.avatar ? (
                <img
                  src={currentUser.avatar}
                  alt={currentUser.name}
                  className="w-7 h-7 rounded-lg object-cover border border-emerald-500/40"
                />
              ) : (
                <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center border border-emerald-500/40">
                  {currentUser?.name?.charAt(0) || 'م'}
                </div>
              )}
              <div className="text-right hidden xl:block">
                <p className="text-xs font-bold text-white leading-tight">{currentUser?.name}</p>
                <p className="text-[10px] text-emerald-400 leading-tight flex items-center gap-1 justify-end">
                  {currentUser?.role === 'owner' && <Shield className="w-2.5 h-2.5 text-amber-400" />}
                  {currentUser?.roleTitleArabic}
                </p>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {roleDropdownOpen && (
              <div className="absolute left-0 mt-2 w-64 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-3 z-50 animate-in fade-in space-y-3">
                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-800">
                  {currentUser?.avatar ? (
                    <img
                      src={currentUser.avatar}
                      alt={currentUser.name}
                      className="w-9 h-9 rounded-xl object-cover border border-slate-700"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 font-bold text-sm flex items-center justify-center border border-emerald-500/40">
                      {currentUser?.name?.charAt(0) || 'م'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-bold text-xs text-white truncate">{currentUser?.name}</p>
                      {currentUser?.role === 'owner' ? (
                        <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded border border-amber-500/30 font-bold">
                          Owner
                        </span>
                      ) : (
                        <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 rounded border border-emerald-500/30 font-bold">
                          موثق
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 truncate dir-ltr text-right mt-0.5">{currentUser?.email}</p>
                  </div>
                </div>

                <div className="text-[11px] text-slate-300 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 space-y-1">
                  <div className="flex justify-between items-center text-slate-400">
                    <span>الرتبة المعتمدة:</span>
                    <strong className="text-emerald-400">{currentUser?.roleTitleArabic}</strong>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>حالة الحساب:</span>
                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-emerald-400" />
                      نشط ومصادق
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    setRoleDropdownOpen(false);
                    await logout();
                  }}
                  className="w-full py-2 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5 text-rose-400" />
                  <span>تسجيل الخروج الآمن</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
