import React from 'react';
import { useApp } from '../../context/AppContext';
import {
  Package, BadgePercent, CheckCircle2, X, ChevronDown, Search as SearchIcon,
  AlertTriangle, Bell,
} from 'lucide-react';
import {
  NAV_SECTIONS,
  visibleSectionBranches,
  sectionLeafIds,
  searchNav,
  navBadgeTone,
} from './navConfig';
import type { NavLeaf, NavBranch, NavSection } from './navConfig';

// نُعيد التصدير حفاظاً على أي مستورد قديم (لا كسر للتبعيات).
export type { NavLeaf, NavBranch, NavSection } from './navConfig';
export {
  NAV_SECTIONS,
  NAV_ACCENTS,
  LEGACY_ERP_NAV_ENABLED,
  LEGACY_ERP_TAB_IDS,
  visibleBranchItems,
  visibleSectionBranches,
  sectionLeafIds,
  allNavBranches,
  searchNav,
} from './navConfig';

/** توافق خلفي: الاسم القديم يعيد الفروع بصيغة {title, items}. */
export function visibleSectionGroups(section: NavSection, isOwner: boolean) {
  return visibleSectionBranches(section, isOwner).map((b) => ({ title: b.title, items: b.items }));
}

interface SidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const EXPANDED_KEY = 'gharabi-nav-expanded-v1';

// حالة focus-visible موحّدة لكل عنصر قابل للضغط (تنقّل بلوحة المفاتيح).
const FOCUS_RING =
  'focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-900';

const readExpanded = (): { sections: string[]; branches: string[] } => {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { sections: Array.isArray(p.sections) ? p.sections : [], branches: Array.isArray(p.branches) ? p.branches : [] };
    }
  } catch { /* تجاهل */ }
  return { sections: [], branches: [] };
};

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, onCloseMobile }) => {
  const { activeTab, setActiveTab, notificationBadge, currentUser, showroomInfo } = useApp();
  const isOwner = currentUser?.role === 'owner';

  const [query, setQuery] = React.useState('');
  const [expandedSections, setExpandedSections] = React.useState<string[]>([]);

  // استرجاع حالة الفتح من التخزين المحلي (يحافظ على تنقّل المالك قدر الإمكان).
  // ملاحظة: لا يوجد طيّ متداخل للفروع بعد الآن؛ تُبقى حالة الفروع القديمة في التخزين
  // (توافق خلفي) لكن لا تُقرأ للعرض.
  React.useEffect(() => {
    const s = readExpanded();
    setExpandedSections(s.sections);
  }, []);

  // القسم الحاوي للورقة النشطة يُفتح تلقائياً (يظهر مكان المستخدم).
  React.useEffect(() => {
    const section = NAV_SECTIONS.find((s) => s.id === activeTab || sectionLeafIds(s).includes(activeTab));
    if (section) {
      setExpandedSections((prev) => (prev.includes(section.id) ? prev : [...prev, section.id]));
    }
  }, [activeTab]);

  const persist = (sections: string[]) => {
    // نحفظ الفروع القديمة فارغة (لا طيّ متداخل بعد الآن) مع الحفاظ على المفتاح/الشكل
    // نفسه للتوافق الخلفي مع أي جلسة سابقة.
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify({ sections, branches: [] })); } catch { /* تجاهل */ }
  };

  // الضغط على ترويسة القسم **ينقّل دائماً** إلى صفحة القسم (هذا هو المقصود الأساسي
  // من الضغط)، ثم يبدّل حالة الفتح/الإغلاق للفروع. لا يوجد طيّ متداخل للفروع: الضغط
  // على القسم يُظهر لوحة فرعية منظّمة (فروع كفواصل + وظائف كبطاقات قابلة للضغط مباشرة).
  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      persist(next);
      return next;
    });
    setActiveTab(id);
  };

  const badgeFor = (leafId: string): string | null => {
    if (leafId === 'approval' && notificationBadge.pendingReviews > 0) return `${notificationBadge.pendingReviews} معلق`;
    if (leafId === 'customers' && notificationBadge.unreadMessages > 0) return `${notificationBadge.unreadMessages} استفسار`;
    if (leafId === 'calendar' && notificationBadge.scheduledToday > 0) return `${notificationBadge.scheduledToday} مجدول`;
    return null;
  };

  // شارات «تحتاج انتباهاً» (عاجلة) = مراجعات معلّقة + استفسارات غير مقروءة.
  const attentionCount = notificationBadge.pendingReviews + notificationBadge.unreadMessages;

  const handleLeafClick = (id: string) => {
    setActiveTab(id);
    onCloseMobile();
  };

  const searching = query.trim().length > 0;
  const sectionsToRender = searching
    ? searchNav(query, isOwner)
    : NAV_SECTIONS.filter((s) => !s.ownerOnly || isOwner);

  const isSectionExpanded = (id: string) => searching || expandedSections.includes(id);

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
        className={`fixed lg:sticky top-0 right-0 z-50 h-screen w-80 lg:w-72 glass-strong border-y-0 border-r-0 flex flex-col transition-transform duration-300 ease-in-out ${
          mobileOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Top Branding Section */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center text-slate-950 font-extrabold shadow-md shadow-accent/25">
              <Package className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <h2 className="font-black text-base text-white tracking-wide">
                معرض الغرابي <span className="text-accent">للتقسيط</span>
              </h2>
              <p className="text-[11px] text-slate-500 flex items-center gap-1">
                <BadgePercent className="w-3 h-3 text-accent" />
                لوحة القيادة الهرمية الموحّدة
              </p>
            </div>
          </div>

          <button
            onClick={onCloseMobile}
            className={`lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 ${FOCUS_RING}`}
            aria-label="إغلاق القائمة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pt-3">
          <div className="relative">
            <SearchIcon className="w-3.5 h-3.5 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث في الأقسام والوظائف…"
              className={`w-full bg-slate-950/60 border border-slate-800 rounded-xl pr-9 pl-3 py-2 text-[12px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-600/60 ${FOCUS_RING}`}
              style={{ fontSize: 16 }}
            />
          </div>
        </div>

        {/* Navigation Tree — عناوين رئيسية ← فروع ← وظائف */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1 custom-scrollbar">
          <div className="px-2 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            {searching ? 'نتائج البحث' : 'أقسام النظام'}
          </div>

          {/* ملخّص سريع أعلى الشجرة: جملة واحدة تلخّص كل ما يحتاج انتباه المالك. */}
          {!searching && attentionCount > 0 && (
            <button
              onClick={() => setActiveTab('approval')}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-right transition cursor-pointer border border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 ${FOCUS_RING}`}
              aria-label={`لديك ${attentionCount} أمراً يحتاج انتباهك`}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
              <span className="text-[11px] font-bold flex-1">
                لديك {attentionCount} أمراً يحتاج انتباهك
              </span>
            </button>
          )}

          {sectionsToRender.length === 0 && (
            <p className="px-3 py-4 text-[11px] text-slate-500">لا نتائج مطابقة.</p>
          )}

          {sectionsToRender.map((section, idx) => {
            const Icon = section.icon;
            const branches = visibleSectionBranches(section, isOwner);
            const leaves = sectionLeafIds(section);
            const sectionActive = activeTab === section.id || leaves.includes(activeTab);
            const open = isSectionExpanded(section.id);
            // شارة القسم = أول تنبيه موجود، مع نبرته (عاجل/معلوماتي).
            const sectionBadgeItem = branches.flatMap((b) => b.items).find((i) => badgeFor(i.id));
            const sectionBadge = sectionBadgeItem ? badgeFor(sectionBadgeItem.id) : null;
            const sectionTone = sectionBadgeItem ? navBadgeTone(sectionBadgeItem.id) : 'info';

            return (
              <div key={section.id}>
                {/* فاصل بصري بين الأقسام الرئيسية المتتالية (لا كتلة متصلة واحدة). */}
                {idx > 0 && <div className="my-1.5 h-px bg-slate-800/70" />}

                <div className="rounded-2xl">
                  {/* المستوى 1: العنوان الرئيسي — الأكبر والأثقل (تسلسل طباعي ثلاثي واضح). */}
                  <button
                    onClick={() => toggleSection(section.id)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-right transition-all duration-200 group cursor-pointer ${FOCUS_RING} ${
                      sectionActive
                        ? `${section.accent.rowActive} accent-top`
                        : 'text-slate-200 hover:bg-slate-800/60 hover:text-white border border-transparent'
                    }`}
                    aria-expanded={open}
                  >
                    <div
                      className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200 group-hover:scale-[1.04] ${
                        sectionActive
                          ? section.accent.boxActive
                          : `${section.accent.box} group-hover:shadow-md`
                      }`}
                    >
                      <Icon className={`w-5 h-5 transition-colors ${sectionActive ? 'text-slate-950' : section.accent.icon}`} />
                    </div>
                    <div className="flex-1 min-w-0 text-right">
                      <div className="flex items-center justify-between gap-1">
                        {/* عنوان القسم: ضخم وسميك بحرف متباعد قليلاً (أعلى التسلسل الطباعي). */}
                        <p className="text-base font-black tracking-wide truncate">{section.label}</p>
                        {sectionBadge && (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold border ${
                              sectionTone === 'urgent'
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : 'bg-slate-800 text-slate-300 border-slate-700'
                            }`}
                          >
                            {sectionBadge}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-500 truncate">{section.desc}</p>
                    </div>
                    {/* سهم واحد فقط — بجانب القسم النشط وحده (بلا أسهم متكدّسة على الفروع). */}
                    {sectionActive && (
                      <ChevronDown className={`w-4 h-4 shrink-0 text-accent transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
                    )}
                  </button>

                  {/* لوحة فرعية منظّمة: الفروع كفواصل صغيرة بخط خفيف (بلا سهم)،
                      والوظائف تحتها كبطاقات صغيرة قابلة للضغط مباشرة (بلا ضغطة ثانية). */}
                  {open && (
                    <div className="mt-1.5 mr-4 pr-3 border-r border-slate-800 space-y-2.5 animate-nav-in">
                      {branches.map((branch) => {
                        const BIcon = branch.icon;
                        return (
                          <div key={branch.id}>
                            {/* فاصل الفرع: عنوان صغير بخط خفيف — لا سهم ولا طيّ. */}
                            <div className="flex items-center gap-1.5 px-1 pb-1 text-slate-500">
                              <BIcon className="w-3 h-3 shrink-0" />
                              <span className="text-[10px] font-bold uppercase tracking-wider truncate">{branch.title}</span>
                              <span className="flex-1 h-px bg-slate-800" />
                            </div>
                            <div className="space-y-0.5">
                              {branch.items.map((leaf) => {
                                const LIcon = leaf.icon;
                                const on = activeTab === leaf.id;
                                const badge = badgeFor(leaf.id);
                                const tone = navBadgeTone(leaf.id);
                                return (
                                  <button
                                    key={`${branch.id}:${leaf.id}:${leaf.label}`}
                                    onClick={() => handleLeafClick(leaf.id)}
                                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-right transition-all duration-200 cursor-pointer ${FOCUS_RING} ${
                                      on
                                        ? 'bg-accent/15 text-accent font-semibold border border-accent/30'
                                        : 'text-slate-300 font-normal hover:bg-slate-800/70 hover:text-white border border-transparent'
                                    }`}
                                    title={leaf.desc}
                                  >
                                    <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${on ? 'bg-accent/20' : 'bg-slate-800/70'}`}>
                                      <LIcon className={`w-3.5 h-3.5 shrink-0 ${on ? 'text-accent' : 'text-slate-400'}`} />
                                    </span>
                                    <span className="text-[11px] truncate flex-1">{leaf.label}</span>
                                    {badge && (
                                      <span
                                        className={`text-[9px] px-1 py-0.5 rounded font-bold border ${
                                          on
                                            ? 'bg-accent/20 text-accent border-accent/30'
                                            : tone === 'urgent'
                                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                              : 'bg-slate-800 text-slate-300 border-slate-700'
                                        }`}
                                      >
                                        {badge}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/40">
          <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50 flex items-center gap-3">
            <div className="relative">
              {currentUser?.avatar ? (
                <img src={currentUser.avatar} alt={currentUser.name} className="w-8 h-8 rounded-lg object-cover" />
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
          <div className="mt-2 text-center text-[10px] text-slate-400 flex items-center justify-center gap-1">
            <Bell className="w-3 h-3 text-slate-500" />
            {showroomInfo.name} • نظام الإدارة والذكاء الاصطناعي
          </div>
        </div>
      </aside>
    </>
  );
};
