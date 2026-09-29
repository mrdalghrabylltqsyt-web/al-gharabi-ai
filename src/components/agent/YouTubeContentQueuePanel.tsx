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

const MAX_VIDEO_MB = 12;
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/x-msvideo'];
const CONTENT_UPLOAD_MAX_BYTES = MAX_VIDEO_MB * 1024 * 1024;

const fmtBytes = (n: number) => {
  if (!n) return '0';
  if (n >= 1048576) return `${(n / 1048576).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
};
// يقرأ الملف فعلياً ويحوّله base64 داخلياً (النقل الداخلي) — المستخدم لا يرى base64 إطلاقاً.
const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
  reader.onload = () => {
    const s = String(reader.result || '');
    resolve(s.includes(',') ? s.slice(s.indexOf(',') + 1) : s);
  };
  reader.readAsDataURL(file);
});

export function YouTubeContentQueuePanel() {
  const { currentUser } = useApp() as any;
  const isOwner = currentUser?.role === 'owner';
  const [items, setItems] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', tags: '', publishAt: '', privacyStatus: 'public' });
  const [video, setVideo] = useState<{ name: string; size: number; type: string; base64: string } | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

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
      if (!video) { setMediaError('اختر ملف فيديو حقيقي أولاً — لا يمكن إنشاء محتوى بلا مادة.'); return; }
      const payload: Record<string, any> = {
        title: form.title, description: form.description,
        tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        publishAt: form.publishAt || undefined,
        privacyStatus: form.privacyStatus,
        mimeType: video.type || 'video/mp4', filename: video.name, videoBase64: video.base64,
      };
      const res = await apiService.createYouTubeContentDraft(payload);
      setNote(`أُضيف عنصر المحتوى بحالة: ${res?.item?.stateLabelAr || res?.item?.state}${res?.decision?.reason ? ` — ${res.decision.reason}` : ''}`);
      setShowCreate(false);
      setForm({ title: '', description: '', tags: '', publishAt: '', privacyStatus: 'public' });
      setVideo(null); setMediaError(null);
      await load();
    } catch (e: any) {
      setError(e?.message || 'تعذر إنشاء العنصر');
    } finally { setBusy(false); }
  };

  const onPickVideo = async (file: File | null | undefined) => {
    setMediaError(null); setError(null);
    if (!file) { setVideo(null); return; }
    if (!ALLOWED_VIDEO_TYPES.includes(file.type) && file.type !== '') {
      setVideo(null); setMediaError(`نوع الفيديو غير مدعوم (${file.type}). المسموح: MP4/WebM/MOV/MKV/AVI.`); return;
    }
    if (file.size > CONTENT_UPLOAD_MAX_BYTES) {
      setVideo(null); setMediaError(`حجم الفيديو أكبر من الحد (${MAX_VIDEO_MB}MB). اختر ملفاً أصغر.`); return;
    }
    if (file.size < 12) { setVideo(null); setMediaError('الملف أصغر من أن يكون فيديو صالحاً.'); return; }
    try {
      const base64 = await fileToBase64(file);
      if (!base64) { setVideo(null); setMediaError('تعذر قراءة محتوى الملف.'); return; }
      setVideo({ name: file.name, size: file.size, type: file.type || 'video/mp4', base64 });
    } catch (e: any) {
      setVideo(null); setMediaError(e?.message || 'تعذر قراءة الملف.');
    }
  };

  const clearVideo = () => { setVideo(null); setMediaError(null); };

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

  // تنظيف بيانات الاختبار: عرض أولاً (dry-run)، ثم تأكيد المستخدم يحذف التجريبي
  // غير المرتبط بفيديو حقيقي فقط. لا يُحذف أي عنصر إنتاج أو منشور فعلي.
  const cleanupTestData = async () => {
    setBusy(true); setNote(null); setError(null);
    try {
      const preview = await apiService.cleanupYouTubeContentTestData(true);
      if (!preview.deletableCount) {
        setNote(`لا بيانات اختبار قابلة للحذف (إجمالي الاختبار: ${preview.testCount} • محفوظ لفيديو حقيقي: ${preview.keptRealVideoCount}).`);
        return;
      }
      const ok = window.confirm(`عناصر اختبار قابلة للحذف: ${preview.deletableCount}. (محفوظ لفيديو حقيقي: ${preview.keptRealVideoCount}). تنفيذ الحذف؟`);
      if (!ok) { setNote('أُلغي التنظيف.'); return; }
      const done = await apiService.cleanupYouTubeContentTestData(false);
      setNote(`حُذف ${done.removed} عنصر اختباري؛ بقي ${done.keptRealVideoCount} عنصراً له فيديو حقيقي.`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'تعذر تنظيف بيانات الاختبار');
    } finally { setBusy(false); }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-slate-300">طابور المحتوى — نشر/جدولة/مراجعة</h2>
        <div className="flex gap-2">
          <button disabled={!isOwner || busy} onClick={suggestTime} className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 border border-slate-700 text-slate-200 disabled:opacity-50">اقتراح وقت جدولة</button>
          <button disabled={!isOwner || busy} onClick={cleanupTestData} className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 border border-slate-700 text-amber-200 disabled:opacity-50">تنظيف بيانات الاختبار</button>
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
          <div>
            <label className="block text-xs text-slate-400 mb-1">وقت النشر (اتركه فارغاً للنشر الفوري)</label>
            <input className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm" type="datetime-local" value={form.publishAt} onChange={(e) => setForm({ ...form, publishAt: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">الخصوصية الافتراضية (يمكن تغييرها عند القرار)</label>
            <select className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm" value={form.privacyStatus} onChange={(e) => setForm({ ...form, privacyStatus: e.target.value })}>
              <option value="public">عام (public) — الافتراضي للنشر الآن</option>
              <option value="unlisted">غير مدرج (unlisted)</option>
              <option value="private">خاص (private) — الافتراضي للجدولة حتى الموعد</option>
            </select>
            <p className="text-[11px] text-slate-500 mt-1">«نشر الآن» يجعل الفيديو <span className="text-slate-300">عاماً (public)</span> افتراضاً، و«جدولة» تبقيه <span className="text-slate-300">خاصاً (private)</span> حتى موعد النشر — إلا إذا اخترت غير ذلك صراحةً.</p>
          </div>
          {/* اختيار فيديو حقيقي من الجهاز (يعمل على الجوال والكمبيوتر) — بلا كتابة base64 يدوياً. */}
          <div className="space-y-2">
            <label className="block text-xs text-slate-400">الفيديو (مطلوب فعلياً للرفع — لا يُولّد النظام فيديو وهمياً)</label>
            <input id="youtube-content-video-input" type="file" accept="video/*" className="hidden"
              onChange={(e) => onPickVideo(e.target.files?.[0])} />
            {!video ? (
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="youtube-content-video-input"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-slate-800 border border-slate-700 text-slate-100 cursor-pointer hover:bg-slate-700">
                  📹 اختيار فيديو
                </label>
                <span className="text-[11px] text-slate-500">MP4/MOV/WebM/MKV/AVI — حتى {MAX_VIDEO_MB}MB</span>
              </div>
            ) : (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 text-xs text-slate-300 space-y-1">
                <div>الفيديو: <span className="font-semibold text-slate-100">{video.name}</span></div>
                <div>الحجم: {fmtBytes(video.size)} • النوع: {video.type}</div>
                <div className="text-emerald-300">✓ جاهز للرفع</div>
                <div className="flex gap-2 mt-1">
                  <label htmlFor="youtube-content-video-input" className="px-3 py-1 rounded-lg text-xs bg-slate-700 text-slate-100 cursor-pointer">استبدال</label>
                  <button onClick={clearVideo} className="px-3 py-1 rounded-lg text-xs bg-rose-600/20 text-rose-200 border border-rose-600/40">إلغاء الاختيار</button>
                </div>
              </div>
            )}
            {mediaError ? <div className="text-[11px] text-rose-300">{mediaError}</div> : null}
          </div>
          <div className="flex gap-2">
            <button disabled={busy || !form.title.trim() || !video} onClick={create} className="px-4 py-1.5 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">إنشاء وتصنيف</button>
            <button disabled={busy} onClick={() => { setShowCreate(false); clearVideo(); }} className="px-4 py-1.5 rounded-lg text-sm bg-slate-800 border border-slate-700 text-slate-200">إلغاء</button>
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
                {it.mediaState ? ` • المادة: ${it.mediaStateLabelAr}${it.mediaBytes ? ` (${fmtBytes(it.mediaBytes)})` : ''}` : ''}
                {it.externalVideoId ? ` • معرّف: ${it.externalVideoId}` : ''}
                {it.url ? ` • ${it.url}` : ''}
              </div>
              {/* حالة التحقق الحقيقية من YouTube: لا ندّعي تحققاً لم يُثبته المزود. */}
              <div className="text-[11px] mt-1">
                <span className="text-slate-500">الخصوصية المتوقعة: </span>
                <span className="text-slate-300">نشر الآن = {it.publishPrivacyStatus || 'public'}</span>
                <span className="text-slate-500"> • جدولة = {it.schedulePrivacyStatus || 'private'}</span>
                {it.verifiedPrivacyStatus ? <span className="text-emerald-300"> • أثبت YouTube: {it.verifiedPrivacyStatus}{it.verified ? ' ✓ مُتحقَّق' : ' (غير مطابق)'}</span> : null}
                {!it.verified && it.externalVideoId ? <span className="text-amber-300"> • لم تُؤكَّد الحالة من YouTube بعد</span> : null}
              </div>
              {!it.hasMedia && !['REJECTED', 'CANCELLED'].includes(it.state) ? (
                <div className="text-[11px] text-amber-300 mt-1">لا توجد مادة فيديو فعلية؛ لا يُسمح بالاعتماد/النشر/الجدولة حتى إضافة فيديو.</div>
              ) : null}
              {/* Badge الحالة أعلاه عرض فقط. «إلغاء» زر فعلي ضمن القرارات أدناه. */}
              {isOwner && Array.isArray(it.allowedActions) && it.allowedActions.length ? (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {it.allowedActions.map((a: string) => {
                    const b = REVIEW_BUTTONS.find((x) => x.action === a);
                    if (!b) return null;
                    // لا نُظهر «نشر الآن»/«جدولة» كزرين قابلين للنقر إن كانت جاهزية
                    // القرار المباشر تمنعهما (بلا مادة/نهائي/Kill Switch).
                    const blocked = (a === 'publish_now' && it.canPublishNow === false) || (a === 'schedule' && it.canSchedule === false);
                    return (
                      <button key={b.action} disabled={busy || blocked} onClick={() => act(it.id, b.action)}
                        title={blocked ? ((a === 'publish_now' ? it.publishBlockedReason : it.scheduleBlockedReason) || '') : ''}
                        className={`px-2.5 py-1 rounded-lg text-xs border disabled:opacity-40 disabled:cursor-not-allowed ${b.danger ? 'bg-rose-600/20 text-rose-200 border-rose-600/40' : 'bg-slate-800 text-slate-200 border-slate-700'}`}>
                        {b.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {isOwner && it.canPublishNow === false && it.publishBlockedReason ? (
                <div className="text-[10px] text-slate-500 mt-1">نشر الآن محجوب: {it.publishBlockedReason}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-slate-500">لا عناصر محتوى بعد.</p>}
    </section>
  );
}

export default YouTubeContentQueuePanel;
