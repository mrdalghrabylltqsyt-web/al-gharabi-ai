import React from 'react';
import { useApp } from '../../context/AppContext';
import {
  Package, BadgePercent, CheckCircle2, X, ChevronDown, Search as SearchIcon,
} from 'lucide-react';
import {
  NAV_SECTIONS,
  visibleSectionBranches,
  sectionLeafIds,
  searchNav,
} from './navConfig';
import type { NavLeaf, NavBranch, NavSection } from './navConfig';

// نُعيد التصدير حفاظاً على أي مستورد قديم (لا كسر للتبعيات).
export type { NavLeaf, NavBranch, NavSection } from './navConfig';
export {
  NAV_SECTIONS,
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

/** يفتح الفرع الأول من القسم إن كانت الورقة النشطة داخله (يظهر مكان المستخدم). */
function activeSectionFirstBranch(section: NavSection, activeTab: string): string {
  const branch = section.branches.find((b) => b.items.some((i) => i.id === activeTab));
  return branch ? branch.id : '';
}

interface SidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const EXPANDED_KEY = 'gharabi-nav-expanded-v1';

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
  const [expandedBranches, setExpandedBranches] = React.useState<string[]>([]);

  // استرجاع حالة الفتح من التخزين المحلي (يحافظ على تنقّل المالك قدر الإمكان).
  React.useEffect(() => {
    const s = readExpanded();
    setExpandedSections(s.sections);
    setExpandedBranches(s.branches);
  }, []);

  // القسم الحاوي للورقة النشطة يُفتح تلقائياً (يظهر مكان المستخدم).
  React.useEffect(() => {
    const section = NAV_SECTIONS.find((s) => s.id === activeTab || sectionLeafIds(s).includes(activeTab));
    if (section) {
      setExpandedSections((prev) => (prev.includes(section.id) ? prev : [...prev, section.id]));
    }
  }, [activeTab]);

  const persist = (sections: string[], branches: string[]) => {
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify({ sections, branches })); } catch { /* تجاهل */ }
  };

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      persist(next, expandedBranches);
      return next;
    });
    // فتح القسم يعرض صفحته الموحّدة أيضاً (يحافظ على سلوك التنقل السابق).
    if (!expandedSections.includes(id)) setActiveTab(id);
  };

  const toggleBranch = (id: string) => {
    setExpandedBranches((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      persist(expandedSections, next);
      return next;
    });
  };

  const badgeFor = (leafId: string): string | null => {
    if (leafId === 'approval' && notificationBadge.pendingReviews > 0) return `${notificationBadge.pendingReviews} معلق`;
    if (leafId === 'customers' && notificationBadge.unreadMessages > 0) return `${notificationBadge.unreadMessages} استفسار`;
    if (leafId === 'calendar' && notificationBadge.scheduledToday > 0) return `${notificationBadge.scheduledToday} مجدول`;
    return null;
  };

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
        className={`fixed lg:sticky top-0 right-0 z-50 h-screen w-80 lg:w-72 bg-slate-900 border-l border-slate-800 flex flex-col transition-transform duration-300 ease-in-out ${
          mobileOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Top Branding Section */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
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
                لوحة القيادة الهرمية الموحّدة
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

        {/* Search */}
        <div className="px-3 pt-3">
          <div className="relative">
            <SearchIcon className="w-3.5 h-3.5 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث في الأقسام والوظائف…"
              className="w-full bg-slate-950/60 border border-slate-800 rounded-xl pr-9 pl-3 py-2 text-[12px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-600/60"
              style={{ fontSize: 16 }}
            />
          </div>
        </div>

        {/* Navigation Tree — عناوين رئيسية ← فروع ← وظائف */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1 custom-scrollbar">
          <div className="px-2 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            {searching ? 'نتائج البحث' : 'أقسام النظام'}
          </div>

          {sectionsToRender.length === 0 && (
            <p className="px-3 py-4 text-[11px] text-slate-500">لا نتائج مطابقة.</p>
          )}

          {sectionsToRender.map((section) => {
            const Icon = section.icon;
            const branches = visibleSectionBranches(section, isOwner);
            const leaves = sectionLeafIds(section);
            const sectionActive = activeTab === section.id || leaves.includes(activeTab);
            const open = isSectionExpanded(section.id);
            const sectionBadge = branches.flatMap((b) => b.items).map((i) => badgeFor(i.id)).find(Boolean) || null;

            return (
              <div key={section.id} className="rounded-xl">
                {/* المستوى 1: العنوان الرئيسي (قابل للفتح/الإغلاق) */}
                <button
                  onClick={() => toggleSection(section.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-right transition-all group cursor-pointer ${
                    sectionActive
                      ? 'bg-gradient-to-l from-emerald-950/80 to-emerald-900/40 text-emerald-200 border border-emerald-500/30 shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white border border-transparent'
                  }`}
                  aria-expanded={open}
                >
                  <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`} />
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                      sectionActive
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
                </button>

                {/* المستوى 2: الفروع (قابلة للفتح/الإغلاق) والمستوى 3: الوظائف */}
                {open && (
                  <div className="mt-1 mr-4 pr-3 border-r border-slate-800 space-y-0.5">
                    {branches.map((branch) => {
                      const BIcon = branch.icon;
                      const bOpen = searching || expandedBranches.includes(branch.id) || branch.id === activeSectionFirstBranch(section, activeTab);
                      return (
                        <div key={branch.id}>
                          <button
                            onClick={() => toggleBranch(branch.id)}
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-right text-slate-400 hover:text-white hover:bg-slate-800/50 transition cursor-pointer"
                            aria-expanded={bOpen}
                          >
                            <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${bOpen ? '' : '-rotate-90'}`} />
                            <BIcon className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                            <span className="text-[11px] font-bold truncate">{branch.title}</span>
                          </button>

                          {bOpen && (
                            <div className="mt-0.5 mr-3 space-y-0.5">
                              {branch.items.map((leaf) => {
                                const LIcon = leaf.icon;
                                const on = activeTab === leaf.id;
                                const badge = badgeFor(leaf.id);
                                return (
                                  <button
                                    key={`${branch.id}:${leaf.id}:${leaf.label}`}
                                    onClick={() => handleLeafClick(leaf.id)}
                                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-right transition cursor-pointer ${
                                      on
                                        ? 'bg-emerald-500 text-slate-950 font-bold'
                                        : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                                    }`}
                                    title={leaf.desc}
                                  >
                                    <LIcon className={`w-3.5 h-3.5 shrink-0 ${on ? 'text-slate-950' : 'text-slate-500'}`} />
                                    <span className="text-[11px] truncate flex-1">{leaf.label}</span>
                                    {badge && (
                                      <span className={`text-[9px] px-1 py-0.5 rounded font-semibold ${on ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>
                                        {badge}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          <p className="px-3 pt-3 text-[10px] text-slate-500 leading-relaxed">
            كل الوظائف القديمة ما زالت متاحة داخل الأقسام (لا حذف لأي وظيفة).
          </p>
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
          <div className="mt-2 text-center text-[10px] text-slate-400">
            {showroomInfo.name} • نظام الإدارة والذكاء الاصطناعي
          </div>
        </div>
      </aside>
    </>
  );
};
