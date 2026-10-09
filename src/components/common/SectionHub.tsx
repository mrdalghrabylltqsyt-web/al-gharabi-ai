import React from 'react';
import { useApp } from '../../context/AppContext';
import { NAV_SECTIONS, visibleSectionGroups, sectionLeafIds } from './Sidebar';
import { ChevronLeft } from 'lucide-react';

/**
 * صفحة قسم موحّدة: تعرض ترويسة القسم + شرائط الصفحات التابعة (الوظائف القديمة
 * نفسها، متصلة بلا حذف) + الصفحة النشطة. تُستدعى عندما يكون activeTab معرّف قسم
 * (home/publish/customers/products/settings). لا تُعيد كتابة أي صفحة — تُفوّض
 * العرض إلى `renderLeaf` القادمة من App (نفس switch) فلا توجد نسختان من المنطق.
 */
export const SectionHub: React.FC<{ sectionId: string; renderLeaf: (id: string) => React.ReactNode }> = ({ sectionId, renderLeaf }) => {
  const { activeTab, setActiveTab, currentUser } = useApp();
  const section = NAV_SECTIONS.find((s) => s.id === sectionId);
  if (!section) return null;
  const isOwner = currentUser?.role === 'owner';
  const groups = visibleSectionGroups(section, isOwner);
  const leaves = sectionLeafIds(section);

  // الصفحة النشطة = activeTab إن كانت ورقة في هذا القسم، وإلا أول ورقة.
  const activeLeafId = leaves.includes(activeTab) ? activeTab : (groups[0]?.items[0]?.id || 'dashboard');
  const activeLeaf = groups.flatMap((g) => g.items).find((i) => i.id === activeLeafId);

  return (
    <div className="space-y-5">
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
        <h2 className="text-lg font-black text-white">{section.label}</h2>
        <p className="text-xs text-slate-400 mt-1">{section.desc}</p>
        <p className="text-[11px] text-emerald-300/90 mt-2">المسار الموحّد: {section.flow}</p>
      </div>

      {/* شرائط الصفحات التابعة */}
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.title} className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold text-slate-500 w-32 shrink-0">{g.title}</span>
            {g.items.map((it) => {
              const Icon = it.icon;
              const on = it.id === activeLeafId;
              return (
                <button
                  key={it.id}
                  onClick={() => setActiveTab(it.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer border ${
                    on
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm shadow-emerald-500/20'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {it.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* الصفحة النشطة */}
      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        <ChevronLeft className="w-3.5 h-3.5 text-emerald-400" />
        <span>الوظيفة الحالية:</span>
        <span className="text-slate-200 font-bold">{activeLeaf?.label || ''}</span>
        <span className="text-slate-500 hidden sm:inline">— {activeLeaf?.desc || ''}</span>
      </div>
      <div>{renderLeaf(activeLeafId)}</div>
    </div>
  );
};
