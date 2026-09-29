/**
 * مركز مراجعة تقرير YouTube اليومي — من الرقم إلى التعليق الحقيقي.
 *
 * كل بطاقة رقم قابلة للنقر وتفتح **نفس السجلات** التي كوّنت الرقم. لكل تعليق:
 * نصه الحقيقي، صنّفه النظام، سبب القرار، الرد المقترح، ثم قرار المالك الصريح.
 * فتح التفاصيل لا يغيّر أي حالة؛ التغيير يحصل فقط بعد ضغط المالك على إجراء،
 * و«السماح بالرد» يمر بمنفّذ الرد المركزي (كل البوابات) ولا يتجاوزها.
 * لا يُعرض أي سرّ أو token.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { apiService } from '../../services/api';
import { useApp } from '../../context/AppContext';

const stageTone = (stage?: string) => {
  switch (stage) {
    case 'VERIFIED': return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'REPLIED': return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    case 'ESCALATED': return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'FAILED': return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    case 'SKIPPED': return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
    default: return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
  }
};

const SENTIMENT_AR: Record<string, string> = { positive: 'إيجابي', negative: 'سلبي', neutral: 'محايد' };

interface Props {
  metric: { key: string; labelAr: string; count: number } | null;
  onClose: () => void;
  onChanged?: () => void;
}

export function YouTubeBriefReview({ metric, onClose, onChanged }: Props) {
  const { currentUser } = useApp() as any;
  const isOwner = currentUser?.role === 'owner';
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>('');

  const load = useCallback(async () => {
    if (!metric) return;
    setLoading(true); setError(null);
    try {
      const d = await apiService.getYouTubeWatcherDetails(metric.key, filters);
      setData(d);
    } catch (e: any) {
      setError(e?.message || 'تعذر تحميل التفاصيل');
    } finally { setLoading(false); }
  }, [metric, filters]);

  useEffect(() => { void load(); }, [load]);

  const doReview = async (commentId: string, action: string, text?: string) => {
    setBusy(commentId); setNote(null); setError(null);
    try {
      const res = await apiService.reviewYouTubeWatcherComment({ commentId, action, text });
      if (action === 'allow_reply' && res.sent) setNote(`أُرسل الرد فعلياً إلى YouTube — معرّف الرد: ${res.externalReplyId}`);
      else if (action === 'allow_reply') setNote('لم يُرسل الرد.');
      else if (action === 'reprocess') setNote('أُعيد التعليق لمسار المعالجة (سيُقيَّم في الدورة القادمة).');
      else setNote('سُجّل قرارك.');
      setExpanded(null);
      await load();
      onChanged?.();
    } catch (e: any) {
      setError(e?.message || 'تعذر تنفيذ القرار');
    } finally { setBusy(null); }
  };

  if (!metric) return null;
  const records: any[] = data?.records || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto" dir="rtl">
      <div className="w-full max-w-4xl bg-slate-950 border border-slate-800 rounded-2xl p-5 my-6 space-y-4">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-100">تفاصيل التقرير — {metric.labelAr}</h2>
            <p className="text-xs text-slate-400 mt-1">
              العدد المُعلن: <b className="text-slate-200">{metric.count}</b> • السجلات المعروضة: <b className="text-slate-200">{data?.total ?? 0}</b> • النافذة: {data?.windowHours ?? 24} ساعة
            </p>
          </div>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm bg-slate-800 text-slate-200">إغلاق</button>
        </header>

        {error ? <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl p-3 text-sm">{error}</div> : null}
        {note ? <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 rounded-xl p-3 text-sm">{note}</div> : null}

        {/* الفلاتر */}
        <div className="flex flex-wrap gap-2 items-center text-xs">
          <select value={filters.stage || ''} onChange={(e) => setFilters((f) => ({ ...f, stage: e.target.value }))} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-200">
            <option value="">كل الحالات</option>
            {['REPLIED', 'VERIFIED', 'SKIPPED', 'ESCALATED', 'FAILED', 'ANALYZED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filters.sentiment || ''} onChange={(e) => setFilters((f) => ({ ...f, sentiment: e.target.value }))} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-200">
            <option value="">كل المشاعر</option>
            {['positive', 'negative', 'neutral'].map((s) => <option key={s} value={s}>{SENTIMENT_AR[s]}</option>)}
          </select>
          <select value={filters.delivered || ''} onChange={(e) => setFilters((f) => ({ ...f, delivered: e.target.value }))} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-200">
            <option value="">تم الرد؟ (الكل)</option>
            <option value="true">تم الرد</option>
            <option value="false">لم يُرد</option>
          </select>
          <select value={filters.needsReview || ''} onChange={(e) => setFilters((f) => ({ ...f, needsReview: e.target.value }))} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-200">
            <option value="">المراجعة (الكل)</option>
            <option value="true">يحتاج مراجعة</option>
            <option value="false">لا يحتاج</option>
          </select>
          <input value={filters.q || ''} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} placeholder="بحث في النص/الاسم/المعرّف" className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-200 flex-1 min-w-[180px]" />
          <button onClick={() => setFilters({})} className="px-3 py-2 rounded-lg bg-slate-800 text-slate-200">عرض الكل</button>
        </div>

        {loading ? <p className="text-sm text-slate-400">جارٍ التحميل…</p> : null}
        {!loading && records.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-sm text-slate-400">
            لا سجلات مطابقة. {data?.total === 0 ? 'هذه الفئة صفر في الفترة الحالية (لا تعليقات مطابقة).' : 'جرّب تغيير الفلاتر.'}
          </div>
        ) : null}

        <div className="space-y-2">
          {records.map((r: any) => (
            <div key={r.commentId} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm text-slate-100 break-words">{r.text || '(بدون نص)'}</div>
                  <div className="text-[11px] text-slate-400 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    <span>المنصة: YouTube</span>
                    <span>الحساب: {r.authorName || 'مجهول'}</span>
                    <span>التصنيف: {r.classification?.intentLabelAr} • المشاعر: {r.classification?.sentimentLabelAr}</span>
                    <span>الحالة: <b className={`px-2 py-0.5 rounded border ${stageTone(r.stage)}`}>{r.stageLabelAr}</b></span>
                    {r.deferred ? <span className="text-amber-300">مؤجَّل (إعداد)</span> : null}
                    {r.delivered ? <span className="text-emerald-300">مُسلَّم: {r.externalReplyId}</span> : null}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    وقت التعليق: {r.publishedAt ? new Date(r.publishedAt).toLocaleString('ar-IQ') : '—'} • المعالجة: {r.at ? new Date(r.at).toLocaleString('ar-IQ') : '—'}
                    {r.videoUrl ? <> • <a className="text-cyan-300 underline" href={r.videoUrl} target="_blank" rel="noreferrer">الفيديو{r.videoTitle ? `: ${r.videoTitle}` : ''}</a></> : null}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">سبب القرار: {r.reason || '—'}{r.code ? ` (${r.code})` : ''}</div>
                  {r.override ? <div className="text-[11px] text-amber-300 mt-1">قرار سابق: {r.overrideLabelAr} — {r.override.by}</div> : null}
                </div>
                <button onClick={() => { setExpanded(expanded === r.commentId ? null : r.commentId); setEditText(r.suggestedReply || r.replyText || ''); }}
                  className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 text-slate-200 shrink-0">
                  {expanded === r.commentId ? 'طيّ' : 'مراجعة'}
                </button>
              </div>

              {expanded === r.commentId ? (
                <div className="mt-3 border-t border-slate-800 pt-3 space-y-2">
                  {r.replyText ? (
                    <div className="text-xs text-slate-300">الرد المُرسَل فعلاً: <span className="text-slate-100">{r.replyText}</span></div>
                  ) : null}
                  <label className="text-xs text-slate-400 block">الرد المقترح (حتمي) — يمكن تعديله قبل الإرسال:</label>
                  <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={2}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-slate-100" />
                  <div className="flex flex-wrap gap-2">
                    {isOwner ? (
                      <>
                        <button disabled={busy === r.commentId} onClick={() => void doReview(r.commentId, 'allow_reply', editText)}
                          className="px-3 py-1.5 rounded-lg text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white">إرسال الرد (يمر بكل البوابات)</button>
                        <button disabled={busy === r.commentId} onClick={() => void doReview(r.commentId, 'reprocess')}
                          className="px-3 py-1.5 rounded-lg text-xs bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white">إعادة المعالجة</button>
                        <button disabled={busy === r.commentId} onClick={() => void doReview(r.commentId, 'escalate')}
                          className="px-3 py-1.5 rounded-lg text-xs bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white">تصعيد للمراجعة</button>
                        <button disabled={busy === r.commentId} onClick={() => void doReview(r.commentId, 'ignore')}
                          className="px-3 py-1.5 rounded-lg text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white">تجاهل</button>
                        <button disabled={busy === r.commentId} onClick={() => void doReview(r.commentId, 'block_reply')}
                          className="px-3 py-1.5 rounded-lg text-xs bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white">منع الرد</button>
                      </>
                    ) : <span className="text-xs text-slate-500">إجراءات المراجعة للمالك فقط.</span>}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <p className="text-[11px] text-slate-500 border-t border-slate-800 pt-2">{data?.note || ''}</p>
      </div>
    </div>
  );
}

export default YouTubeBriefReview;
