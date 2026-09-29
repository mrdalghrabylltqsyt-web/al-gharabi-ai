/**
 * طابور محتوى YouTube — نشر/جدولة/مراجعة بشرية.
 *
 * تعرض الحالة الحقيقية من الخادم فقط: كل عنصر محتوى بحالته الصادقة، سبب قراره،
 * ومستوى حساسيته. أزرار القرار (موافقة/رفض/تعديل/نشر الآن/جدولة/إلغاء) للمالك فقط،
 * وتنفيذ النشر/الجدولة يمرّ بالمنفّذ المركزي على الخادم — لا إرسال وهمي من الواجهة.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { apiService } from '../../services/api';
import { useApp } from '../../context/AppContext';

const tone = (s?: string) => {
  switch (s) {
    case 'operational': return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'transitional': return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'blocked': return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    default: return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
  }
};

const REVIEW_BUTTONS: Array<{ action: string; label: string; danger?: boolean }> = [
  { action: 'approve', label: 'موافقة' },
  { action: 'publish_now', label: 'نشر الآن' },
  { action: 'schedule', label: 'جدولة' },
  { action: 'edit', label: 'تعديل' },
  { action: 'reject', label: 'رفض', danger: true },
  { action: 'cancel', label: 'إلغاء', danger: true },
];

export function YouTubeContentQueuePanel() {
  const { currentUser } = useApp() as any;
  const isOwner = currentUser?.role === 'owner';
  const [items, setItems] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', tags: '', publishAt: '', videoBase64: '', mimeType: 'video/mp4' });

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await apiService.getYouTubeContentQueue();
      setItems(data.items || []);
      setSummary(data.summary || null);
    } catch (e: any) {
      setError(e?.message || 'تعذر تحميل طابور المحتوى');
    }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  const act = async (id: string, action: string, extra: Record<string, any> = {}) => {
    setBusy(true); setNote(null); setError(null);
    try {
      const res = await apiService.reviewYouTubeContentItem(id, { action, ...extra });
      setNote(`نُفِّذ: ${action} — ${res?.item?.stateLabelAr || res?.item?.state || ''}${res?.exec?.externalVideoId ? ` • معرّف YouTube: ${res.exec.externalVideoId}` : ''}`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'تعذر تنفيذ القرار');
    } finally { setBusy(false); }
  };

  const create = async () => {
    setBusy(true); setNote(null); setError(null);
    try {
      const payload: Record<string, any> = {
        title: form.title, description: form.description,
        tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        publishAt: form.publishAt || undefined, mimeType: form.mimeType || undefined,
      };
      if (form.videoBase64.trim()) payload.videoBase64 = form.videoBase64.trim();
      const res = await apiService.createYouTubeContentDraft(payload);
      setNote(`أُضيف عنصر المحتوى بحالة: ${res?.item?.stateLabelAr || res?.item?.state}${res?.decision?.reason ? ` — ${res.decision.reason}` : ''}`);
      setShowCreate(false);
      setForm({ title: '', description: '', tags: '', publishAt: '', videoBase64: '', mimeType: 'video/mp4' });
      await load();
    } catch (e: any) {
      setError(e?.message || 'تعذر إنشاء العنصر');
    } finally { setBusy(false); }
  };

  const suggestTime = async () => {
    setBusy(true); setNote(null); setError(null);
    try {
      const res = await apiService.getYouTubeScheduleSuggestion();
      const s = res?.suggestion || {};
      setNote(s.suggestedAt ? `اقتراح جدولة: ${new Date(s.suggestedAt).toLocaleString('ar-IQ')} — ${s.note}` : `اقتراح الجدولة: ${s.note}`);
    } catch (e: any) {
      setError(e?.message || 'تعذر جلب الاقتراح');
    } finally { setBusy(false); }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-slate-300">طابور المحتوى — نشر/جدولة/مراجعة</h2>
        <div className="flex gap-2">
          <button disabled={!isOwner || busy} onClick={suggestTime} className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 border border-slate-700 text-slate-200 disabled:opacity-50">اقتراح وقت جدولة</button>
          <button disabled={!isOwner || busy} onClick={() => setShowCreate((v) => !v)} className="px-3 py-1.5 rounded-lg text-xs bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">+ محتوى جديد</button>
        </div>
      </div>

      {summary ? (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {[['عند المراجعة', summary.awaitingReview], ['مجدول', summary.scheduled], ['منشور', summary.published], ['مُتحقَّق', summary.verified], ['مرفوض', summary.rejected], ['فشل', summary.failed]].map(([label, val]: any) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
              <div className="text-[11px] text-slate-400">{label}</div>
              <div className="text-lg font-semibold text-slate-100">{val ?? 0}</div>
            </div>
          ))}
        </div>
      ) : null}

      {showCreate ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
          <input className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm" placeholder="العنوان (مطلوب)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm" rows={3} placeholder="الوصف" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <input className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm" placeholder="وسوم مفصولة بفواصل" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          <input className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm" type="datetime-local" value={form.publishAt} onChange={(e) => setForm({ ...form, publishAt: e.target.value })} />
          <textarea className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm font-mono" rows={2} placeholder="بايتات الفيديو base64 (مطلوبة فعلياً للرفع — لا يُولّد النظام فيديو وهمياً)" value={form.videoBase64} onChange={(e) => setForm({ ...form, videoBase64: e.target.value })} />
          <div className="flex gap-2">
            <button disabled={busy || !form.title.trim()} onClick={create} className="px-4 py-1.5 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">إنشاء وتصنيف</button>
            <button disabled={busy} onClick={() => setShowCreate(false)} className="px-4 py-1.5 rounded-lg text-sm bg-slate-800 border border-slate-700 text-slate-200">إلغاء</button>
          </div>
          <p className="text-[11px] text-slate-500">المحتوى التجاري بمعلومة غير موثّقة يذهب للمراجعة البشرية ولا يُنشر آلياً. الرفع بلا بايتات يُرفض (MEDIA_REQUIRED).</p>
        </div>
      ) : null}

      {error ? <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl p-3 text-sm">{error}</div> : null}
      {note ? <div className="bg-slate-800/60 border border-slate-700 text-slate-300 rounded-xl p-3 text-sm">{note}</div> : null}

      {items.length ? (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3" dir="rtl">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm font-semibold text-slate-100">{it.title || '(بلا عنوان)'}</div>
                <span className={`px-2 py-0.5 rounded-full text-[11px] border ${tone(it.stateTone)}`}>{it.stateLabelAr}</span>
              </div>
              {it.stateReason ? <div className="text-xs text-slate-400 mt-1">السبب: {it.stateReason}</div> : null}
              <div className="text-[11px] text-slate-500 mt-1">
                الحساسية: {it.sensitivity} • المصدر: {it.source} • {it.publishAt ? `جدولة: ${new Date(it.publishAt).toLocaleString('ar-IQ')}` : 'نشر فوري'}
                {it.externalVideoId ? ` • معرّف: ${it.externalVideoId}` : ''}
                {it.url ? ` • ${it.url}` : ''}
              </div>
              {isOwner && !['REJECTED', 'CANCELLED', 'PUBLISHED', 'VERIFIED', 'SCHEDULED'].includes(it.state) ? (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {REVIEW_BUTTONS.map((b) => (
                    <button key={b.action} disabled={busy} onClick={() => act(it.id, b.action)}
                      className={`px-2.5 py-1 rounded-lg text-xs border disabled:opacity-50 ${b.danger ? 'bg-rose-600/20 text-rose-200 border-rose-600/40' : 'bg-slate-800 text-slate-200 border-slate-700'}`}>
                      {b.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-slate-500">لا عناصر محتوى بعد.</p>}
    </section>
  );
}

export default YouTubeContentQueuePanel;
