/**
 * مفتاح الإيقاف الطارئ للعقل التجاري (Kill Switch) — للمالك فقط.
 *
 * مفتاح **رئيسي واحد** فقط (لا تحكم لكل منصة): تمكين/إيقاف شامل للعقل التجاري.
 * الافتراضي **معطَّل (fail-closed)** — لا فعل خارجي على إقلاع نظيف حتى يفعّله المالك
 * صراحةً من هذه الواجهة. الحالة من الخادم فقط — لا ادّعاء محلي.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { apiService } from '../../services/api';
import { useApp } from '../../context/AppContext';

export function CommercialBrainKillSwitch() {
  const { currentUser } = useApp() as any;
  const isOwner = currentUser?.role === 'owner';
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setState(await apiService.getCommercialKillSwitch());
    } catch (e: any) {
      setError(e?.message || 'تعذر تحميل حالة مفتاح العقل التجاري');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (enabled: boolean) => {
    setBusy(true); setNote(null);
    try {
      const res = await apiService.setCommercialKillSwitch(enabled, enabled ? 'owner_enabled_from_ui' : 'owner_emergency_stop');
      setState(res);
      setNote(res?.note || (enabled ? 'تم التفعيل.' : 'تم الإيقاف فوراً.'));
    } catch (e: any) {
      setError(e?.message || 'تعذر تبديل المفتاح');
    } finally { setBusy(false); }
  };

  const enabled = state?.killSwitch?.enabled === true;

  return (
    <div className="space-y-4">
      <section className="glass rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-slate-100 mb-1">مفتاح الإيقاف الطارئ — العقل التجاري</h2>
        <p className="text-xs text-slate-400 mb-4">
          مفتاح رئيسي واحد فقط. الافتراضي <strong>معطَّل (fail-closed)</strong>: لا ينفّذ العقل التجاري
          أي فعل خارجي (متابعة/اقتراح/رد) حتى تفعّله صراحةً. عند الإيقاف يتوقف كل عمل فوراً
          (جدولة + دورة جارية) ويبقى موقوفاً حتى إعادة التفعيل.
        </p>

        {!isOwner ? (
          <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
            هذا المفتاح متاح للمالك فقط.
          </div>
        ) : (
          <>
            <div className={`rounded-xl p-4 border mb-4 ${enabled ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-xs text-slate-400 mb-1">الحالة الحالية</div>
                  <div className={`text-lg font-semibold ${enabled ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {enabled ? 'مفعَّل — العقل التجاري يعمل' : 'موقوف — لا تشغيل تلقائي'}
                  </div>
                  {state?.killSwitch?.killAt ? (
                    <div className="text-[11px] text-slate-500 mt-1">
                      آخر إيقاف: {state.killSwitch.killAt}{state.killSwitch.killReason ? ` — السبب: ${state.killSwitch.killReason}` : ''}
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  {enabled ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => toggle(false)}
                      className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-semibold"
                    >
                      {busy ? '...' : '⏹ إيقاف طارئ فوري'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => toggle(true)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold"
                    >
                      {busy ? '...' : '▶ تفعيل العقل التجاري'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void load()}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-sm"
                  >
                    تحديث
                  </button>
                </div>
              </div>
            </div>

            {note ? <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-2 mb-2">{note}</div> : null}
            {error ? <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-2 mb-2">{error}</div> : null}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-3">
                <div className="text-xs text-slate-400 mb-1">الجدولة</div>
                <div className="text-sm text-slate-200">{state?.scheduler?.active ? 'نشطة' : 'متوقفة'}</div>
              </div>
              <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-3">
                <div className="text-xs text-slate-400 mb-1">آخر دورة</div>
                <div className="text-sm text-slate-200">
                  {state?.deferral?.deferred
                    ? `مؤجَّلة منذ ${state.deferral.lastDeferredAt || 'غير معروف'} — ${state.deferral.deferredReason || 'ضغط استهلاك'}`
                    : (state?.lastRun ? `${state.lastRun.at} — أُرسل ${state.lastRun.followUpsSent}` : 'لا يوجد')}
                </div>
              </div>
              <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-3">
                <div className="text-xs text-slate-400 mb-1">تنفيذ خارجي</div>
                <div className="text-sm text-slate-200">عبر المنفّذ المركزي وحده</div>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
