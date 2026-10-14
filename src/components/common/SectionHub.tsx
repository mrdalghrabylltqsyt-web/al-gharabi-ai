import React from 'react';
import { useApp } from '../../context/AppContext';
import {
  NAV_SECTIONS, visibleSectionBranches, sectionLeafIds,
} from './navConfig';

/**
 * لوحة قسم هرمية موحّدة: تعرض **ترويسة فخمة للقسم فقط** (أيقونة كبيرة + عنوان ضخم
 * + وصف + المسار الموحّد)، ثم الصفحة النشطة. أُزيل شريط تبديل الأوراق (كان يكرّر
 * القائمة الجانبية) ومسار التنقّل المكرر — التنقّل مسار واحد عبر الشريط الجانبي.
 * تُفوّض العرض إلى `renderLeaf` القادمة من App (نفس switch) فلا توجد نسختان من المنطق.
 * لا حذف لأي وظيفة/معرّف: كل الأوراق تبقى قابلة للوصول عبر الشريط الجانبي.
 */
export const SectionHub: React.FC<{ sectionId: string; renderLeaf: (id: string) => React.ReactNode }> = ({ sectionId, renderLeaf }) => {
  const { activeTab, currentUser } = useApp();
  const section = NAV_SECTIONS.find((s) => s.id === sectionId);
  if (!section) return null;
  const isOwner = currentUser?.role === 'owner';
  const branches = visibleSectionBranches(section, isOwner);
  const leaves = sectionLeafIds(section);

  // الصفحة النشطة = activeTab إن كانت ورقة في هذا القسم، وإلا أول ورقة.
  const activeLeafId = leaves.includes(activeTab) ? activeTab : (branches[0]?.items[0]?.id || 'command_center');

  const SectionIcon = section.icon;

  return (
    <div className="space-y-5">
      {/* ترويسة القسم الفخمة: أيقونة كبيرة + عنوان ضخم + وصف + المسار الموحّد.
          بلا breadcrumb مكرر وبلا شرائط أوراق (القائمة الجانبية هي مسار التنقّل الواحد). */}
      <div className="p-5 rounded-2xl glass accent-top">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-accent/12 border border-accent/30 flex items-center justify-center text-accent shrink-0">
            <SectionIcon className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-black text-white tracking-wide">{section.label}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{section.desc}</p>
          </div>
        </div>
        <p className="text-[11px] text-accent/90 mt-3">المسار الموحّد: {section.flow}</p>
      </div>

      {/* الوظيفة الحالية */}
      <div>{renderLeaf(activeLeafId)}</div>
    </div>
  );
};
