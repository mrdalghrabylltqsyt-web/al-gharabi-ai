import React, { useCallback, useEffect, useState } from 'react';
import { ListChecks, RefreshCw, Play, XCircle, RotateCcw, CheckCircle2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { fmtDateTime } from '../../utils/displayTime';

/**
 * طابور مهام النشر (ربط 2026-10-26). كان لوح الجاهزية يقول للمالك «نفّذها من مركز التحكم
 * أو فعّل نشر المعتمد تلقائياً» — ولم تكن أي شاشة تعرض المهام ولا المفتاح. هذه اللوحة
 * تقرأ `/api/control/jobs` وتنفّذ عبر المسارات نفسها (كل بوابات النشر على الخادم).
 */
const STATUS_AR: Record<string, { t: string; c: string }> = {
  queued: { t: 'بانتظار اعتمادك', c: 'text-amber-300 bg-amber-950/40' },
  approved: { t: 'معتمدة — تنتظر موعدها/الربط', c: 'text-sky-300 bg-sky-950/40' },
  ready: { t: 'جاهزة للتنفيذ الآن', c: 'text-emerald-300 bg-emerald-950/40' },
  executed: { t: 'نُفّذت', c: 'text-slate-300 bg-slate-800' },
  failed: { t: 'فشلت/أُلغيت', c: 'text-rose-300 bg-rose-950/40' },
};
const PLATFORM_AR: Record<string, string> = { facebook: 'فيسبوك', instagram: 'إنستغرام', youtube: 'يوتيوب', threads: 'ثريدز', tiktok: 'تيك توك', telegram: 'تيليغرام', whatsapp: 'واتساب', x: 'X', snapchat: 'سناب شات', google_business: 'Google Business' };

export const ScheduledJobsPanel: React.FC = () => {
  const { currentUser, showToast } = useApp();
  const isOwner = currentUser?.role === 'owner';
  const [jobs, setJobs] = useState<any[]>([]);
  const [auto, setAuto] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setJobs(await apiService.listJobs());
      if (isOwner) setAuto(await apiService.getJobAutoExecute());
    } catch (e: any) { showToast(e?.message || 'تعذر تحميل المهام'); }
    finally { setLoading(false); }
  }, [isOwner, showToast]);
  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, fn: () => Promise<any>, ok: string) => {
    setBusy(id);
    try { await fn(); showToast(ok); } catch (e: any) { showToast(e?.message || 'تعذر تنفيذ الإجراء'); }
    finally { setBusy(null); void load(); }
  };
  const toggleAuto = () => act('auto', () => apiService.setJobAutoExecute(!auto?.autoExecuteApproved), auto?.autoExecuteApproved ? 'أُوقف التنفيذ التلقائي' : 'فُعّل النشر التلقائي للمعتمد في موعده');

  const active = jobs.filter((j) => ['queued', 'approved', 'ready'].includes(j.status));
  const recent = jobs.filter((j) => !['queued', 'approved', 'ready'].includes(j.status)).slice(0, 8);
  const rows = [...active, ...recent];

  return (
    <section className="p-5 rounded-2xl glass space-y-4" dir="rtl" aria-label="طابور مهام النشر">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-white flex items-center gap-2"><ListChecks className="w-4 h-4 text-emerald-400" /> طابور مهام النشر</h3>
          <p className="text-[11px] text-slate-400 mt-1">المهام المعتمدة تُنفَّذ عبر بوابات النشر نفسها، ولا شيء يُنشر قبل اعتمادك وربط المنصة فعلاً.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white flex items-center gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> تحديث
        </button>
      </div>

      {isOwner && auto && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
          <div className="text-xs">
            <p className="text-white font-semibold">نشر المعتمد تلقائياً في موعده</p>
            <p className="text-slate-400 mt-0.5">
              {auto.autoExecuteApproved ? 'مفعّل' : 'معطّل (الافتراضي الآمن)'} · نُفّذ تلقائياً {auto.autoExecutedCount ?? 0} · فشل {auto.autoFailedCount ?? 0}
              {auto.lastAutoRunAt ? ` · آخر دورة ${fmtDateTime(auto.lastAutoRunAt)}` : ''}
            </p>
          </div>
          <button type="button" role="switch" aria-checked={Boolean(auto.autoExecuteApproved)} disabled={busy === 'auto'} onClick={() => void toggleAuto()}
            className={`relative w-12 h-7 rounded-full transition ${auto.autoExecuteApproved ? 'bg-emerald-500' : 'bg-slate-700'}`}>
            <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${auto.autoExecuteApproved ? 'right-1' : 'right-6'}`} />
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-center text-xs text-slate-500 py-4">{loading ? 'جارٍ التحميل…' : 'لا مهام نشر في الطابور.'}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((j) => {
            const st = STATUS_AR[j.status] || { t: j.status, c: 'text-slate-300 bg-slate-800' };
            const p = j.payload || {};
            const title = p.title || p.productName || j.type;
            const when = j.scheduledFor || p.scheduledFor;
            return (
              <div key={j.id} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 text-xs">
                  <p className="text-white font-semibold truncate">{title}</p>
                  <p className="text-slate-400 mt-0.5">
                    {p.platform ? `${PLATFORM_AR[p.platform] || p.platform} · ` : ''}
                    {when ? `موعدها ${fmtDateTime(when)} · ` : ''}أُنشئت {fmtDateTime(j.createdAt)}
                    {p.cancelled ? ' · أُلغيت' : ''}
                  </p>
                  {j.lastError && <p className="text-rose-300 mt-0.5 break-words">{String(j.lastError).slice(0, 160)}</p>}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-semibold ${st.c}`}>{st.t}</span>
                  {isOwner && j.status === 'queued' && (
                    <button type="button" disabled={busy === j.id} onClick={() => void act(j.id, () => apiService.approveJob(j.id), 'اعتُمدت المهمة')} className="p-2 rounded-lg bg-emerald-600/20 text-emerald-300" title="اعتماد" aria-label="اعتماد"><CheckCircle2 className="w-4 h-4" /></button>
                  )}
                  {isOwner && j.status === 'ready' && (
                    <button type="button" disabled={busy === j.id} onClick={() => void act(j.id, () => apiService.executeJob(j.id), 'نُفّذت المهمة')} className="p-2 rounded-lg bg-sky-600/20 text-sky-300" title="تنفيذ الآن" aria-label="تنفيذ الآن"><Play className="w-4 h-4" /></button>
                  )}
                  {['queued', 'approved', 'ready'].includes(j.status) && (
                    <button type="button" disabled={busy === j.id} onClick={() => void act(j.id, () => apiService.cancelJob(j.id), 'أُلغيت المهمة')} className="p-2 rounded-lg bg-rose-600/20 text-rose-300" title="إلغاء" aria-label="إلغاء"><XCircle className="w-4 h-4" /></button>
                  )}
                  {j.status === 'failed' && (
                    <button type="button" disabled={busy === j.id} onClick={() => void act(j.id, () => apiService.retryJob(j.id), 'أعيدت المهمة للطابور')} className="p-2 rounded-lg bg-slate-700 text-slate-200" title="إعادة المحاولة" aria-label="إعادة المحاولة"><RotateCcw className="w-4 h-4" /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
