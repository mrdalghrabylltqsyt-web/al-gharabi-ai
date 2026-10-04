/**
 * YouTube Operations — واجهة مدير تشغيل YouTube 24/7 داخل العقل المركزي.
 *
 * تعرض **الحالة الحقيقية من الخادم فقط**: نشاط المراقبة، آخر فحص/تعليق/رد،
 * التعليقات التي تحتاج تدخل المالك، سجل الأتمتة، الزخم، والتقرير اليومي.
 * لا تختلق أي رقم، ولا تعرض أي سرّ. أزرار التحكم (Kill Switch) للمالك فقط.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { apiService } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { YouTubeBriefReview } from './YouTubeBriefReview';
import { YouTubeContentQueuePanel } from './YouTubeContentQueuePanel';

const tone = (s?: string) => {
  switch (s) {
    case 'operational': case 'verified': return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'transitional': return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'blocked': return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    default: return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
  }
};

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-lg font-semibold text-slate-100 break-words">{value}</div>
      {sub ? <div className="text-[11px] text-slate-500 mt-1">{sub}</div> : null}
    </div>
  );
}

export function YouTubeOperationsView() {
  const { currentUser } = useApp() as any;
  const isOwner = currentUser?.role === 'owner';
  const [state, setState] = useState<any>(null);
  const [brief, setBrief] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [activeMetric, setActiveMetric] = useState<{ key: string; labelAr: string; count: number } | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [w, b, a] = await Promise.all([
        apiService.getYouTubeWatcher(),
        apiService.getYouTubeDailyBrief().catch(() => null),
        apiService.getYouTubeWatcherAudit(50).catch(() => []),
      ]);
      setState(w);
      setBrief(b);
      setAudit(a);
    } catch (e: any) {
      setError(e?.message || 'تعذر تحميل حالة المراقبة');
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const setControls = async (patch: Record<string, boolean | number>) => {
    setBusy(true); setNote(null);
    try {
      const res = await apiService.setYouTubeWatcherControls(patch);
      setNote(res?.note || 'حُدِّثت الإعدادات — تسري على الدورة التالية.');
      await load();
      return res;
    } catch (e: any) {
      setError(e?.message || 'تعذر التحديث');
    } finally { setBusy(false); }
  };

  /** تغيير فاصل الأتمتة (دقائق): يُرسل القيمة للمالك فقط، ويعرض القيمة الرسمية بعد الحفظ. */
  const changeCadence = async (minutes: number) => {
    setBusy(true); setNote(null); setError(null);
    try {
      const res = await apiService.setYouTubeWatcherControls({ cadenceMinutes: minutes });
      setNote(res?.note || `حُدِّث فاصل الأتمتة إلى ${minutes} دقيقة.`);
    } catch (e: any) {
      setError(e?.message || 'تعذر تغيير فاصل الأتمتة — أُبقيت القيمة السابقة.');
    } finally {
      await load();
      setBusy(false);
    }
  };

  const poll = async () => {
    setBusy(true); setNote('جارٍ تنفيذ دورة مراقبة حقيقية...');
    try {
      const res = await apiService.pollYouTubeWatcher();
      const r = res?.result || {};
      setNote(`الدورة اكتملت — جديد: ${r.newDetected ?? 0}، رد: ${r.replied ?? 0}، تصعيد: ${r.escalated ?? 0}، تجاهل: ${r.skipped ?? 0}، مؤجَّل: ${r.deferred ?? 0}، تحقق: ${r.verified ?? 0}.`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'تعذر تشغيل الدورة');
    } finally { setBusy(false); }
  };

  const c = state?.controls || {};
  const v = state?.velocity;

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">مدير تشغيل YouTube — 24/7</h1>
          <p className="text-sm text-slate-400">مراقبة مستمرة لتعليقات القناة من الخادم مباشرة، مستقلة عن المتصفح.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-xs border ${state?.watcherActive ? tone('operational') : tone('blocked')}`}>
            {state?.watcherActive ? '🟢 Watcher يعمل' : '🔴 Watcher متوقف'}
          </span>
          {isOwner ? (
            <button disabled={busy} onClick={poll} className="px-3 py-1.5 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white">
              تشغيل دورة الآن
            </button>
          ) : null}
        </div>
      </header>

      {error ? <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl p-3 text-sm">{error}</div> : null}
      {note ? <div className="bg-slate-800/60 border border-slate-700 text-slate-300 rounded-xl p-3 text-sm">{note}</div> : null}

      {/* Live Operations */}
      <section>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">التشغيل المباشر</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="الحالة" value={state?.watcherActive ? '🟢 يعمل (Running)' : c.paused ? '⏸ موقوف (Paused)' : '🔴 متوقف'} />
          <Stat label="آخر فحص" value={state?.lastPollAt ? new Date(state.lastPollAt).toLocaleString('ar-IQ') : '—'} />
          <Stat label="الفحص القادم" value={state?.nextPollAt ? new Date(state.nextPollAt).toLocaleTimeString('ar-IQ') : 'عند الجدولة'} sub={`الإيقاع: ${Math.round((state?.cadenceMs || 0) / 60000)} دقيقة`} />
          <Stat label="آخر نشاط حقيقي" value={state?.lastNewCommentAt ? new Date(state.lastNewCommentAt).toLocaleString('ar-IQ') : 'لا جديد'} sub={state?.lastCommentId ? `ID: ${state.lastCommentId}` : undefined} />
          <Stat label="التعليقات المكتشفة" value={state?.counters?.detected ?? 0} />
          <Stat label="الردود" value={state?.counters?.replied ?? 0} sub={`مُتحقَّق: ${state?.counters?.verified ?? 0}`} />
          <Stat label="التصعيدات" value={state?.counters?.escalated ?? 0} sub="تحتاج تدخلك" />
          <Stat label="التجاهلات" value={state?.counters?.skipped ?? 0} sub="سبام/حسابنا/مكرر" />
          <Stat label="مؤجَّلة" value={state?.counters?.deferred ?? 0} sub="تعذّرت بسبب إعداد الرد" />
          <Stat label="ردود فاشلة" value={state?.counters?.failed ?? 0} />
          <Stat label="الأخطاء المتتالية" value={state?.consecutiveErrors ?? 0} sub={state?.lastError || undefined} />
          <Stat label="عدد الدورات" value={state?.pollCount ?? 0} />
          <Stat label="آخر رد مُسلَّم" value={state?.lastReply?.externalReplyId ? 'مُسلَّم' : 'لا يوجد'} sub={state?.lastReply?.externalReplyId ? `رد: ${state.lastReply.externalReplyId}` : undefined} />
        </div>
      </section>

      {/* Owner Controls + Kill Switch */}
      <section>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">عناصر التحكم {isOwner ? '' : '(للمالك فقط)'}</h2>
        <div className="flex flex-wrap gap-2">
          {([
            ['enabled', 'تفعيل المراقبة'],
            ['autoReply', 'الرد الآلي'],
            ['autoPublish', 'النشر الآلي'],
            ['autoSchedule', 'الجدولة الآلية'],
            ['humanReviewMode', 'وضع المراجعة البشرية'],
          ] as const).map(([k, label]) => (
            <button key={k} disabled={!isOwner || busy} onClick={() => setControls({ [k]: !c[k] })}
              className={`px-3 py-1.5 rounded-lg text-sm border disabled:opacity-50 ${c[k] ? 'bg-emerald-600/20 text-emerald-200 border-emerald-600/40' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>
              {label}: {c[k] ? 'مفعّل' : 'معطّل'}
            </button>
          ))}
          <button disabled={!isOwner || busy} onClick={() => setControls({ paused: !c.paused })}
            className={`px-4 py-1.5 rounded-lg text-sm border font-semibold disabled:opacity-50 ${c.paused ? 'bg-rose-600 text-white border-rose-500' : 'bg-rose-600/20 text-rose-200 border-rose-600/40'}`}>
            {c.paused ? '⏸ الأتمتة موقوفة — استئناف' : '⏹ إيقاف كل الأتمتة (Kill Switch)'}
          </button>
        </div>
        {c.killSwitchActive ? (
          <p className="text-xs text-rose-300 mt-2">Kill Switch فعّال: توقّفت الردود/النشر/الجدولة الآلية، وبقيت القراءة والتحليل.</p>
        ) : null}
      </section>

      {/* Automation interval (وقت الأتمتة) */}
      <section>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">وقت الأتمتة</h2>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center gap-3">
          <label htmlFor="yt-cadence" className="text-sm text-slate-300">فاصل المراقبة:</label>
          <select
            id="yt-cadence"
            disabled={!isOwner || busy}
            value={String(c.cadenceMinutes ?? 1)}
            onChange={(e) => changeCadence(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {[1, 2, 3, 4, 5].map((m) => (
              <option key={m} value={m}>{m === 1 ? '1 دقيقة' : m === 2 ? '2 دقيقة' : `${m} دقائق`}</option>
            ))}
          </select>
          <span className="text-xs text-slate-400">
            القيمة الحالية: <span className="text-slate-200 font-semibold">{c.cadenceMinutes ?? 1} دقيقة</span>
          </span>
          {!isOwner ? <span className="text-xs text-amber-300">للمالك فقط</span> : null}
        </div>
        <p className="text-xs text-slate-500 mt-2">يتحكم هذا الوقت بفاصل فحص تعليقات YouTube.</p>
      </section>

      {/* Attention Required — من المسار المحمي (بلا بيانات عميل في النقاط العامة) */}
      <section>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">تحتاج تدخلاً ({state?.attentionRequired?.length ?? 0})</h2>
        {state?.attentionRequired?.length ? (
          <div className="space-y-2">
            {state.attentionRequired.map((a: any) => (
              <div key={a.commentId} className="bg-slate-900 border border-rose-500/20 rounded-xl p-3">
                <div className="text-sm text-slate-200">{a.text}</div>
                <div className="text-xs text-slate-400 mt-1">السبب: {a.reason} • {a.commentId}</div>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-slate-500">لا شيء يحتاج تدخلك حالياً.</p>}
      </section>

      {/* Analytics / Velocity */}
      <section>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">الزخم (Velocity)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="آخر ساعة" value={v?.lastHour?.count ?? 0} />
          <Stat label="آخر 6 ساعات" value={v?.last6h?.count ?? 0} />
          <Stat label="آخر 24 ساعة" value={v?.last24h?.count ?? 0} />
          <Stat label="آخر 7 أيام" value={v?.last7d?.count ?? 0} sub={`حجم العيّنة: ${v?.sampleSize ?? 0}`} />
        </div>
        <p className="text-xs text-slate-500 mt-2">
          الاتجاه: {v?.trend === 'rising' ? 'صاعد' : v?.trend === 'falling' ? 'هابط' : v?.trend === 'steady' ? 'ثابت' : 'عيّنة غير كافية'} — {v?.note || ''}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          وقت الذروة: {state?.peakHours?.sufficient ? `${state.peakHours.peakHour}:00 (بغداد)` : 'عيّنة غير كافية'} — {state?.peakHours?.note || ''}
        </p>
      </section>

      {/* Daily Brief */}
      {brief ? (
        <section>
          <h2 className="text-sm font-semibold text-slate-300 mb-2">تقرير اليوم ({brief.date}) — اضغط أي رقم لعرض التعليقات الحقيقية</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(brief.metrics || []).map((m: any) => (
              <button key={m.key} onClick={() => setActiveMetric({ key: m.key, labelAr: m.labelAr, count: m.count })}
                className="text-right bg-slate-900 border border-slate-800 hover:border-cyan-500/50 hover:bg-slate-800/60 rounded-2xl p-4 transition-colors">
                <div className="text-xs text-slate-400 mb-1">{m.labelAr}</div>
                <div className="text-lg font-semibold text-slate-100">{m.count}</div>
                <div className="text-[11px] text-cyan-400 mt-1">عرض التفاصيل ←</div>
              </button>
            ))}
          </div>
          <ul className="mt-3 space-y-1 text-sm text-slate-300 list-disc pr-5">
            {(brief.recommendations || []).map((r: string, i: number) => <li key={i}>{r}</li>)}
          </ul>
          <p className="text-xs text-slate-500 mt-2">{(brief.sampleNotes || []).join(' ')} {brief.note}</p>
        </section>
      ) : null}

      {/* Automation Log */}
      <section>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">سجل الأتمتة</h2>
        {audit.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-slate-300">
              <thead className="text-slate-500">
                <tr><th className="text-right p-2">الوقت</th><th className="text-right p-2">العملية</th><th className="text-right p-2">التعليق</th><th className="text-right p-2">القرار</th><th className="text-right p-2">السبب</th></tr>
              </thead>
              <tbody>
                {audit.map((e: any) => (
                  <tr key={e.id} className="border-t border-slate-800">
                    <td className="p-2 whitespace-nowrap">{new Date(e.at).toLocaleTimeString('ar-IQ')}</td>
                    <td className="p-2">{e.action}</td>
                    <td className="p-2 font-mono">{e.commentId || '—'}</td>
                    <td className="p-2">{e.decision || '—'}</td>
                    <td className="p-2">{e.reason || e.error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-slate-500">لا عمليات أتمتة بعد.</p>}
      </section>

      <p className="text-xs text-slate-500 border-t border-slate-800 pt-3">
        كل الأرقام من بيانات YouTube الحقيقية وسجلات النظام — لا بيانات مُختلقة. الرد لا يُعتبر ناجحاً إلا بمعرّف رد حقيقي من YouTube.
      </p>

      {/* طابور المحتوى: نشر/جدولة/مراجعة بشرية */}
      <YouTubeContentQueuePanel />

      {activeMetric ? (
        <YouTubeBriefReview metric={activeMetric} onClose={() => setActiveMetric(null)} onChanged={load} />
      ) : null}
    </div>
  );
}

export default YouTubeOperationsView;
