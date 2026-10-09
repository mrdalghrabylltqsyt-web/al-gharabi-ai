import React from 'react';
import { useApp } from '../../context/AppContext';
import {
  NAV_SECTIONS, visibleSectionBranches, sectionLeafIds,
} from './navConfig';
import { ChevronLeft, Home as HomeIcon } from 'lucide-react';

/**
 * لوحة قسم هرمية موحّدة: تعرض ترويسة القسم + مسار التنقّل (Breadcrumb) + شرائح
 * الأوراق (الوظائف القديمة نفسها، متصلة بلا حذف) + الصفحة النشطة. تُستدعى عندما
 * يكون activeTab معرّف قسم (section_*). لا تُعيد كتابة أي صفحة — تُفوّض العرض إلى
 * `renderLeaf` القادمة من App (نفس switch) فلا توجد نسختان من المنطق.
 */
export const SectionHub: React.FC<{ sectionId: string; renderLeaf: (id: string) => React.ReactNode }> = ({ sectionId, renderLeaf }) => {
  const { activeTab, setActiveTab, currentUser } = useApp();
  const section = NAV_SECTIONS.find((s) => s.id === sectionId);
  if (!section) return null;
  const isOwner = currentUser?.role === 'owner';
  const branches = visibleSectionBranches(section, isOwner);
  const leaves = sectionLeafIds(section);

  // الصفحة النشطة = activeTab إن كانت ورقة في هذا القسم، وإلا أول ورقة.
  const activeLeafId = leaves.includes(activeTab) ? activeTab : (branches[0]?.items[0]?.id || 'command_center');
  const activeLeaf = branches.flatMap((b) => b.items).find((i) => i.id === activeLeafId);
  const activeBranch = branches.find((b) => b.items.some((i) => i.id === activeLeafId));

  const SectionIcon = section.icon;

  return (
    <div className="space-y-5">
      {/* مسار التنقّل: الرئيسية ← القسم ← الفرع ← الوظيفة */}
      <nav className="flex items-center flex-wrap gap-1.5 text-[11px] text-slate-400" aria-label="مسار التنقّل">
        <button
          onClick={() => setActiveTab('section_home')}
          className="flex items-center gap-1 hover:text-emerald-300 transition cursor-pointer"
        >
          <HomeIcon className="w-3 h-3" />
          الرئيسية
        </button>
        <ChevronLeft className="w-3 h-3 text-slate-600" />
        <span className="text-slate-200 font-bold flex items-center gap-1">
          <SectionIcon className="w-3 h-3 text-emerald-400" />
          {section.label}
        </span>
        {activeBranch && (
          <>
            <ChevronLeft className="w-3 h-3 text-slate-600" />
            <span className="text-slate-300">{activeBranch.title}</span>
          </>
        )}
        {activeLeaf && (
          <>
            <ChevronLeft className="w-3 h-3 text-slate-600" />
            <span className="text-emerald-300 font-semibold">{activeLeaf.label}</span>
          </>
        )}
      </nav>

      {/* ترويسة القسم */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <SectionIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white">{section.label}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{section.desc}</p>
          </div>
        </div>
        <p className="text-[11px] text-emerald-300/90 mt-2">المسار الموحّد: {section.flow}</p>
      </div>

      {/* شرائط الأوراق لكل فرع */}
      <div className="space-y-3">
        {branches.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold text-slate-500 w-40 shrink-0">{b.title}</span>
            {b.items.map((it) => {
              const Icon = it.icon;
              const on = it.id === activeLeafId;
              return (
                <button
                  key={`${b.id}:${it.id}:${it.label}`}
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

      {/* الوظيفة الحالية */}
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
