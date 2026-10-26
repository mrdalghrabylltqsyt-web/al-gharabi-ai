import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Gauge, Info, RefreshCw, ShieldAlert } from 'lucide-react';
import { apiService } from '../../services/api';

/**
 * لوحة «جاهزية البيع» — يقرأ الموظف حالته الحقيقية ويخبر المالك بما يمنع البيع
 * الآن، مرتباً بالأثر، مع الإجراء المطلوب وزر يفتح الصفحة المعنية. للمالك فقط.
 * البيانات من `/api/control/sales-readiness` (حتمي، بلا Gemini، بلا نصوص زبائن).
 */
type Severity = 'blocker' | 'warning' | 'info' | 'ok';
interface Item { id: string; severity: Severity; area: string; title: string; detail: string; action: string }
interface Report { score: number; verdict: 'selling' | 'partial' | 'blocked'; verdictText: string; counts: Record<Severity, number>; items: Item[]; generatedAt: string }

/** الصفحة التي تُصلح البند (معرّفات التبويبات الموجودة في التنقل). */
export function readinessTargetTab(id: string): string | null {
  if (id === 'customers-waiting') return 'commercial_inbox';
  if (id.startsWith('platform-') || id === 'no-sales-channel') return 'platform_connections';
  if (id === 'owner-alerts' || id === 'owner-telegram') return 'system';
  if (id === 'commercial-brain') return 'commercial_kill_switch';
  if (id === 'ready-jobs') return 'calendar';
  if (id.startsWith('stale-marketing')) return 'content';
  if (id === 'backup') return 'cloud_backup';
  if (id.startsWith('publish-')) return 'content';
  if (id.startsWith('comments-')) return 'platform_connections';
  return null;
}

const STYLE: Record<Severity, { box: string; icon: React.ReactNode; label: string }> = {
  blocker: { box: 'border-rose-500/40 bg-rose-950/30', icon: <ShieldAlert className="w-4 h-4 text-rose-300" />, label: 'عائق' },
  warning: { box: 'border-amber-500/40 bg-amber-950/20', icon: <AlertTriangle className="w-4 h-4 text-amber-300" />, label: 'يحتاج إجراء' },
  info: { box: 'border-slate-700 bg-slate-900/60', icon: <Info className="w-4 h-4 text-sky-300" />, label: 'معلومة' },
  ok: { box: 'border-emerald-500/30 bg-emerald-950/20', icon: <CheckCircle2 className="w-4 h-4 text-emerald-300" />, label: 'يعمل' },
};

export const SalesReadinessPanel: React.FC<{ onNavigate: (tab: string) => void }> = ({ onNavigate }) => {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showOk, setShowOk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await apiService.fetchSellingReadiness()); setError(null); }
    catch (e: any) { setError(e?.message || 'تعذر تحميل جاهزية البيع'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const verdictColor = report?.verdict === 'selling' ? 'text-emerald-300' : report?.verdict === 'partial' ? 'text-amber-300' : 'text-rose-300';
  const barColor = report?.verdict === 'selling' ? 'bg-emerald-500' : report?.verdict === 'partial' ? 'bg-amber-500' : 'bg-rose-500';
  const visible = (report?.items || []).filter((it) => showOk || it.severity !== 'ok');

  return (
    <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3" data-testid="sales-readiness-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-white font-black text-sm"><Gauge className="w-4 h-4 text-emerald-300" /> جاهزية البيع</div>
          {report && <p className={`text-xs font-bold ${verdictColor}`}>{report.verdictText}</p>}
          {error && <p className="text-xs text-amber-300">{error}</p>}
        </div>
        <button onClick={() => void load()} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> فحص
        </button>
      </div>

      {report && (
        <>
          <div>
            <div className="flex justify-between text-[11px] text-slate-400 mb-1">
              <span>القدرات التجارية العاملة</span><span className="font-bold text-white">{report.score}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden"><div className={`h-full ${barColor}`} style={{ width: `${report.score}%` }} /></div>
            <div className="flex gap-3 mt-2 text-[11px] text-slate-400">
              <span>عوائق: <b className="text-rose-300">{report.counts.blocker}</b></span>
              <span>إجراءات: <b className="text-amber-300">{report.counts.warning}</b></span>
              <span>يعمل: <b className="text-emerald-300">{report.counts.ok}</b></span>
            </div>
          </div>

          <ul className="space-y-2">
            {visible.map((it) => {
              const st = STYLE[it.severity];
              const target = readinessTargetTab(it.id);
              return (
                <li key={it.id} className={`p-3 rounded-xl border ${st.box}`}>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5">{st.icon}</span>
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-xs font-bold text-white">{it.title} <span className="text-[10px] font-normal text-slate-400">· {st.label}</span></p>
                      <p className="text-[11px] text-slate-300">{it.detail}</p>
                      {it.action && <p className="text-[11px] text-slate-200"><b>الحل:</b> {it.action}</p>}
                    </div>
                    {target && it.severity !== 'ok' && (
                      <button onClick={() => onNavigate(target)} className="shrink-0 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-emerald-300 font-bold cursor-pointer">فتح ←</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <button onClick={() => setShowOk((v) => !v)} className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer">
            {showOk ? 'إخفاء ما يعمل' : `عرض ما يعمل (${report.counts.ok})`}
          </button>
        </>
      )}
    </div>
  );
};
