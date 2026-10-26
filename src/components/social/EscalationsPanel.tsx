import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Eye, CheckCircle2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { fmtDateTime } from '../../utils/displayTime';

/**
 * التصعيدات البشرية (ربط 2026-10-26). العقل يوقف الرد الآلي على الشكاوى والحالات الحساسة
 * ويسجّل «تصعيداً» — لكن لم تكن أي شاشة تعرضها أو تحلّها، فكانت تبقى معلّقة للأبد وتمنع
 * إغلاق المحادثة. هنا: الاطلاع والحل عبر مسار الخادم الرسمي.
 */
const PLATFORM_AR: Record<string, string> = { facebook: 'فيسبوك', instagram: 'إنستغرام', youtube: 'يوتيوب', threads: 'ثريدز', tiktok: 'تيك توك', telegram: 'تيليغرام', whatsapp: 'واتساب' };

export const EscalationsPanel: React.FC = () => {
  const { currentUser, showToast } = useApp();
  const isOwner = currentUser?.role === 'owner';
  const [rows, setRows] = useState<any[]>([]);
  const [pending, setPending] = useState(0);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await apiService.getEscalations(); setRows(r.escalations); setPending(r.pending); }
    catch { /* اللوحة تختفي إن تعذّر الجلب */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!rows.length) return null;
  const open = rows.filter((e) => e.state !== 'RESOLVED');
  const list = showDone ? rows.slice(0, 30) : open;

  const go = async (id: string, ev: 'acknowledge' | 'resolve') => {
    setBusy(id);
    try { await apiService.transitionEscalation(id, ev); showToast(ev === 'resolve' ? 'حُلّ التصعيد' : 'تم الاطلاع'); }
    catch (e: any) { showToast(e?.message || 'تعذر التحديث'); }
    finally { setBusy(null); void load(); }
  };

  return (
    <section className="p-5 rounded-2xl glass space-y-3 border border-rose-500/20" dir="rtl" aria-label="التصعيدات البشرية">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-white flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-rose-400" /> حالات تحتاج تدخّلك ({pending} معلّقة)</h3>
        <button type="button" onClick={() => setShowDone((v) => !v)} className="text-[11px] text-slate-400 hover:text-white">{showDone ? 'المفتوحة فقط' : 'عرض المحلولة أيضاً'}</button>
      </div>
      <p className="text-[11px] text-slate-400">أوقف العقل الرد الآلي على هذه الحالات (شكوى، طلب بشري، معلومة غير مؤكدة…). رُدّ بنفسك من المنصة أو من الرد اليدوي، ثم علّمها محلولة.</p>
      {list.length === 0 && <p className="text-xs text-emerald-300">لا حالات مفتوحة.</p>}
      {list.map((e) => (
        <div key={e.id} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-rose-300 font-semibold">{e.reasonLabelAr || e.reason}</span>
            <span className="text-slate-400">{PLATFORM_AR[e.platform] || e.platform || '—'} · {fmtDateTime(e.createdAt)} · {e.stateLabelAr || e.state}</span>
          </div>
          {e.commentText && <p className="text-xs text-white leading-5">«{String(e.commentText).slice(0, 300)}»</p>}
          {isOwner && e.state !== 'RESOLVED' && (
            <div className="flex gap-2">
              {e.state === 'PENDING' && <button type="button" disabled={busy === e.id} onClick={() => void go(e.id, 'acknowledge')} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-[11px] flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> اطّلعت</button>}
              <button type="button" disabled={busy === e.id} onClick={() => void go(e.id, 'resolve')} className="px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 text-[11px] flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> حُلّت</button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
};
