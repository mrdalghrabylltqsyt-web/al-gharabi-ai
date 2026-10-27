import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from '../../services/api';

/**
 * «اربط هاتفي بنقرة» (2026-10-27) — زر واحد يُستعمل في «جاهزية البيع» على الرئيسية وفي «مراقبة النظام».
 *
 * نقرة واحدة: يُنشئ الخادم رمزاً لمرة واحدة (10 د) ويُفتح بوت المعرض في تيليغرام مباشرة على رسالة
 * `/start الرمز` — يكفي أن يضغط المالك «Start». الخادم يلتقط الرمز (عبر webhook أو بقراءة رسائل البوت
 * إن لم يكن webhook مسجّلاً)، والزر يتحدّث تلقائياً إلى «مربوط ✓». لا إعدادات Render ولا رقم يدوي.
 */
export const OwnerTelegramPair: React.FC<{ compact?: boolean; onChange?: (telegram: any) => void }> = ({ compact, onChange }) => {
  const [tg, setTg] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [pair, setPair] = useState<{ code: string; expiresAt: string; deepLink: string | null; instruction: string; webhook?: { ready: boolean; detail: string } } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const refresh = useCallback(async () => {
    try { const a = await apiService.getOwnerAlerts(); setTg(a?.telegram || null); onChangeRef.current?.(a?.telegram || null); return a?.telegram || null; }
    catch { return null; }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // أثناء انتظار ضغطة Start: تحديث كل 3 ث حتى التأكيد أو انتهاء الرمز.
  useEffect(() => {
    if (!pair || tg?.configured) return;
    const t = window.setInterval(async () => {
      if (Date.now() > Date.parse(pair.expiresAt)) { setPair(null); setMsg('انتهت صلاحية الرمز — اضغط الزر من جديد.'); return; }
      const now = await refresh();
      if (now?.configured) { setPair(null); setMsg('تم الربط ✓ — الحالات الحرجة واستفسارات الزبائن تصل هاتفك الآن.'); }
    }, 3000);
    return () => window.clearInterval(t);
  }, [pair, tg?.configured, refresh]);

  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    // تُفتح النافذة فوراً ضمن النقرة نفسها (وإلا يحجبها متصفح الهاتف)، ثم توجَّه لرابط البوت.
    let win: Window | null = null;
    try { win = window.open('', '_blank'); } catch { win = null; }
    try {
      const r = await apiService.startOwnerTelegramPairing();
      setPair(r); setTg(r.telegram); onChangeRef.current?.(r.telegram);
      if (r.deepLink) { if (win) win.location.href = r.deepLink; else window.location.href = r.deepLink; }
      else { try { win?.close(); } catch { /* */ } }
    } catch (e: any) {
      try { win?.close(); } catch { /* */ }
      setMsg(e?.message || 'تعذّر إنشاء رمز الربط');
    } finally { setBusy(false); }
  }, [busy]);

  const unpair = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try { const t = await apiService.unpairOwnerTelegram(); setTg(t); onChangeRef.current?.(t); setMsg('أُلغي الربط.'); }
    catch (e: any) { setMsg(e?.message || 'تعذّر إلغاء الربط'); }
    finally { setBusy(false); }
  }, [busy]);

  if (!tg) return null;
  const btn = 'px-3 py-1.5 rounded-lg font-bold text-[11px] disabled:opacity-50 cursor-pointer';
  return (
    <div className={compact ? 'mt-2 space-y-1.5' : 'space-y-1.5'} data-owner-telegram-pair>
      {tg.configured ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-emerald-300 font-bold">مربوط ✓ — التنبيهات الفورية تصل هاتفك</span>
          {tg.chatSource === 'paired' && <button type="button" onClick={() => void unpair()} disabled={busy} className={`${btn} bg-slate-800 border border-slate-700 text-slate-300`}>إلغاء الربط</button>}
        </div>
      ) : !tg.botTokenSet ? (
        <p className="text-[11px] text-amber-300">بوت تيليغرام للمعرض غير مضبوط بعد — اربطه من «ربط المنصات» ثم عد لهذا الزر.</p>
      ) : (
        <button type="button" data-tg-pair onClick={() => void start()} disabled={busy} className={`${btn} bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs px-4 py-2`}>
          {busy ? 'جارٍ فتح تيليغرام…' : pair ? 'افتح تيليغرام من جديد' : 'اربط هاتفي بنقرة واحدة'}
        </button>
      )}
      {pair && !tg.configured && (
        <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/30 text-[11px] text-sky-100 space-y-1">
          {pair.deepLink && <a href={pair.deepLink} target="_blank" rel="noopener noreferrer" className="inline-block px-3 py-1.5 rounded-lg bg-sky-500 text-slate-950 font-bold">افتح البوت واضغط Start</a>}
          <p>في تيليغرام اضغط <b>Start</b> فقط. أو أرسل للبوت: <b dir="ltr" className="font-mono tracking-widest text-white">/link {pair.code}</b> — صالح 10 دقائق. هذه الصفحة تتحدث تلقائياً.</p>
          {pair.webhook && !pair.webhook.ready && <p className="text-slate-300">البوت بلا webhook مسجّل: الخادم يلتقط الرمز مباشرة من رسائل البوت، فالربط يكتمل. (أزرار «موافقة/رفض» داخل تيليغرام تحتاج تسجيل webhook من «ربط المنصات».)</p>}
        </div>
      )}
      {msg && <p className="text-[11px] text-slate-300">{msg}</p>}
    </div>
  );
};
