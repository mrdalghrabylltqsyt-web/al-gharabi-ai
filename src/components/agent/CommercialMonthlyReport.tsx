import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { apiService } from '../../services/api';

/**
 * تقرير الشهر التجاري (ربط 2026-10-26): مسار `/api/commercial/monthly-report` كان موجوداً
 * في الخادم بلا أي شاشة تعرضه. يعرض لكل منصة: الاستفسارات، والمبيعات المؤكدة، وقيمتها —
 * من السجلات الحقيقية فقط (لا تقدير).
 */
const PLATFORM_AR: Record<string, string> = { facebook: 'فيسبوك', instagram: 'إنستغرام', youtube: 'يوتيوب', threads: 'ثريدز', tiktok: 'تيك توك', telegram: 'تيليغرام', whatsapp: 'واتساب', x: 'X', snapchat: 'سناب شات', google_business: 'Google Business', unknown: 'غير محدد' };

function monthOptions(n = 6): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i += 1) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export function CommercialMonthlyReport() {
  const months = monthOptions();
  const [month, setMonth] = useState(months[0]);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setReport(await apiService.getCommercialMonthlyReport(month)); }
    catch (e: any) { setError(e?.message || 'تعذر تحميل التقرير'); }
    finally { setLoading(false); }
  }, [month]);
  useEffect(() => { void load(); }, [load]);

  const rows: any[] = Array.isArray(report?.rows) ? report.rows : [];
  const t = report?.totals || { inquiries: 0, sales: 0, salesValue: 0 };
  const fmt = (n: number) => Number(n || 0).toLocaleString('ar-IQ');

  return (
    <section className="glass rounded-2xl p-5 space-y-3" dir="rtl" aria-label="تقرير الشهر التجاري">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-slate-100 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-emerald-300" /> تقرير الشهر — من أي منصة جاء الزبائن والمبيعات</h3>
        <div className="flex items-center gap-2">
          <select value={month} onChange={(e) => setMonth(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white" aria-label="الشهر">
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button type="button" onClick={() => void load()} disabled={loading} className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white flex items-center gap-1">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> تحديث
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800"><p className="text-[10px] text-slate-400">استفسارات</p><p className="text-lg font-bold text-white">{fmt(t.inquiries)}</p></div>
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800"><p className="text-[10px] text-slate-400">مبيعات مؤكدة</p><p className="text-lg font-bold text-emerald-300">{fmt(t.sales)}</p></div>
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800"><p className="text-[10px] text-slate-400">قيمة المبيعات (د.ع)</p><p className="text-lg font-bold text-cyan-300">{fmt(t.salesValue)}</p></div>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-3">{loading ? 'جارٍ التحميل…' : 'لا استفسارات ولا مبيعات مسجّلة لهذا الشهر.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-slate-400"><th className="text-right p-2">المنصة</th><th className="p-2">استفسارات</th><th className="p-2">مبيعات</th><th className="p-2">القيمة</th><th className="p-2">التحويل</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.platform} className="border-t border-slate-800 text-slate-200">
                  <td className="p-2">{PLATFORM_AR[r.platform] || r.platform}</td>
                  <td className="p-2 text-center">{fmt(r.inquiries)}</td>
                  <td className="p-2 text-center">{fmt(r.sales)}</td>
                  <td className="p-2 text-center">{fmt(r.salesValue)}</td>
                  <td className="p-2 text-center">{r.inquiries ? `${Math.round((r.sales / r.inquiries) * 100)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-slate-500">من السجلات الحقيقية فقط — البيع يُحسب عند تأكيده من صندوق الزبائن.</p>
    </section>
  );
}
