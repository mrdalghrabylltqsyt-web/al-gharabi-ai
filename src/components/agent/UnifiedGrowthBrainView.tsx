import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiService } from '../../services/api';

/**
 * العقل التجاري المركزي الموحّد (الدفعة 4) — لوحة المالك.
 *
 * تعرض الغاية العليا (زيادة المبيعات والربح الموثّقين)، الطلب الحالي والصاعد، أقوى
 * الفرص، المنتجات المولّدة للاهتمام، الحملات، التجارب، الاستفسارات، العملاء، المبيعات
 * الموثّقة، عنق زجاجة التحويل، والإجراءات المقترحة — كلها من بيانات حقيقية. لا أرقام
 * مُخترعة: غير المتاح يُعلن (NOT_AVAILABLE)، والربح لا يُحسب بلا تكلفة موثوقة.
 */

const Card: React.FC<{ title: string; children: React.ReactNode; hint?: string }> = ({ title, children, hint }) => (
  <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
    <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-3 mb-4">{title}</h3>
    {children}
    {hint ? <p className="text-[11px] text-slate-500 mt-3">{hint}</p> : null}
  </div>
);

const Metric: React.FC<{ label: string; value: React.ReactNode; tone?: string }> = ({ label, value, tone }) => (
  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
    <div className="text-[11px] text-slate-400">{label}</div>
    <div className={`text-lg font-bold ${tone || 'text-white'}`}>{value}</div>
  </div>
);

const num = (v: number | null | undefined): React.ReactNode => (v === null || v === undefined ? <span className="text-amber-300 text-sm">غير متاح</span> : v.toLocaleString('en-US'));

const tierTone = (tier: string): string => ({
  PRIMARY: 'text-emerald-300', SECONDARY: 'text-sky-300', TERTIARY: 'text-violet-300',
}[tier] || 'text-slate-300');

const healthTone = (level: string): string => ({
  OK: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  DEGRADED: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  FAILED: 'bg-red-500/15 text-red-300 border-red-500/30',
  UNKNOWN: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}[level] || 'bg-slate-500/15 text-slate-300 border-slate-500/30');

export const UnifiedGrowthBrainView: React.FC = () => {
  const { currentUser } = useApp();
  const isOwner = currentUser?.role === 'owner';
  const [state, setState] = useState<any>(null);
  const [command, setCommand] = useState<any>(null);
  const [owner, setOwner] = useState<any>(null);
  const [caps, setCaps] = useState<any>(null);
  const [loop, setLoop] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [s, c, o, cap, lp] = await Promise.all([
        apiService.getUnifiedCommercialState(),
        apiService.getUnifiedCommercialCommandCenter(),
        apiService.getUnifiedCommercialOwnerControl(),
        apiService.getUnifiedCommercialCapabilities(),
        apiService.getUnifiedCommercialOperatingLoop(),
      ]);
      setState(s); setCommand(c.commandCenter); setOwner(o.ownerControlCenter);
      setCaps(cap.capabilityEvolution); setLoop(lp);
    } catch (e: any) {
      setError(String(e?.message || 'تعذر تحميل العقل التجاري المركزي'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-8 text-slate-400 text-sm">جارٍ تحميل العقل التجاري المركزي…</div>;
  if (error) return (
    <div className="p-8 space-y-3">
      <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{error}</div>
      <button onClick={load} className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-sm">إعادة المحاولة</button>
    </div>
  );
  if (!state) return null;

  const ns = state.northStar;
  const primary = ns.objectives.find((o: any) => o.tier === 'PRIMARY');
  const secondary = ns.objectives.find((o: any) => o.tier === 'SECONDARY');
  const tertiary = ns.objectives.find((o: any) => o.tier === 'TERTIARY');

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">العقل التجاري المركزي الموحّد</h1>
          <p className="text-xs text-slate-400 mt-1">{ns.statement}</p>
        </div>
        <div className="text-left">
          <div className="text-[11px] text-slate-500">إصدار الذكاء</div>
          <div className="text-sm font-bold text-emerald-300">{state.version}</div>
        </div>
      </div>

      {/* الغاية العليا */}
      <Card title="الغاية العليا — المبيعات والربح الموثّقان" hint={ns.profitGuard || 'الربح يُحسب فقط عند إيراد موثّق + تكلفة موثوقة. UNKNOWN ≠ صفر.'}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Metric label={`${primary.label} (أولوية أولى)`} value={num(primary.value)} tone={tierTone('PRIMARY')} />
          <Metric label={`${secondary.label} (ثانية)`} value={num(secondary.value)} tone={tierTone('SECONDARY')} />
          <Metric label={`${tertiary.label} (ثالثة)`} value={num(tertiary.value)} tone={tierTone('TERTIARY')} />
        </div>
      </Card>

      {/* مركز القيادة */}
      {command ? (
        <Card title="مركز القيادة التجاري" hint={`الفترة: ${command.period}`}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="طلب مؤهّل" value={num(command.demand)} />
            <Metric label="عملاء مؤهّلون" value={num(command.qualifiedLeads)} />
            <Metric label="طلبات" value={num(command.requests)} />
            <Metric label="مبيعات موثّقة" value={num(command.verifiedSales)} tone="text-emerald-300" />
            <Metric label="إيراد موثّق" value={num(command.revenue)} />
            <Metric label="ربح موثّق" value={num(command.profit)} tone="text-violet-300" />
            <Metric label="غير محسوم" value={num(command.unresolved)} />
            <Metric label="خسائر" value={num(command.lost)} tone="text-red-300" />
          </div>
          {command.topOpportunities?.length ? (
            <div className="mt-4 space-y-2">
              <div className="text-xs font-bold text-slate-300">أقوى الفرص</div>
              {command.topOpportunities.map((o: any) => (
                <div key={o.id} className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 text-xs">
                  <span className="text-emerald-300 font-bold">#{o.rank}</span> {o.title}
                  <div className="text-[11px] text-slate-500 mt-1">{o.why}</div>
                </div>
              ))}
            </div>
          ) : null}
          {command.majorBlockers?.length ? (
            <div className="mt-4">
              <div className="text-xs font-bold text-slate-300 mb-1">أبرز الموانع</div>
              <ul className="text-[11px] text-amber-300 space-y-1">{command.majorBlockers.map((b: string, i: number) => <li key={i}>• {b}</li>)}</ul>
            </div>
          ) : null}
          {command.recommendedActions?.length ? (
            <div className="mt-4">
              <div className="text-xs font-bold text-slate-300 mb-1">الإجراءات المقترحة</div>
              <ul className="text-[11px] text-slate-300 space-y-1">{command.recommendedActions.slice(0, 6).map((b: string, i: number) => <li key={i}>• {b}</li>)}</ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* مركز تحكّم المالك */}
      {isOwner && owner ? (
        <Card title="مركز تحكّم المالك — ماذا يعرف العقل ويفعل" hint="كل بند من سجلات حقيقية؛ غير المتاح يُعلن.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {([
              ['whatBrainKnows', 'ما يعرفه'], ['whatItLearned', 'ما تعلّمه'],
              ['whatItWatches', 'ما يراقبه'], ['whatItDiscovered', 'ما اكتشفه'],
              ['whatItRecommends', 'ما يوصي به'], ['whatItExpects', 'ما يتوقّعه'],
              ['whatActuallyHappened', 'ما حدث فعلاً'], ['whatChanged', 'ما تغيّر'],
              ['whatFailed', 'ما فشل'], ['needsOwnerApproval', 'يحتاج موافقتك'],
              ['willTestNext', 'سيختبره تالياً'], ['proposesToImprove', 'يقترح تحسينه'],
            ] as Array<[string, string]>).map(([key, label]) => (
              <div key={key} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="text-xs font-bold text-slate-200 mb-2">{label}</div>
                {owner[key]?.length ? (
                  <ul className="text-[11px] text-slate-400 space-y-1">{owner[key].map((x: string, i: number) => <li key={i}>• {x}</li>)}</ul>
                ) : <div className="text-[11px] text-slate-600">لا شيء بعد</div>}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* تطوّر القدرات */}
      {isOwner && caps ? (
        <Card title="تطوّر القدرات" hint={caps.note}>
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.entries(caps.counts).map(([level, count]) => (
              <span key={level} className="px-2 py-1 rounded-lg bg-slate-950/60 border border-slate-800 text-[11px] text-slate-300">{level}: <b className="text-white">{String(count)}</b></span>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {caps.capabilities.map((c: any) => (
              <div key={c.key} className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 text-xs flex items-center justify-between gap-2">
                <span className="text-slate-200">{c.labelAr}</span>
                <span className="px-2 py-0.5 rounded-lg border text-[10px] bg-slate-500/15 text-slate-300 border-slate-500/30">{c.levelLabelAr}</span>
              </div>
            ))}
          </div>
          {caps.notRuntimeReady?.length ? <p className="text-[11px] text-amber-300 mt-3">غير جاهزة وقت التشغيل: {caps.notRuntimeReady.join('، ')}</p> : null}
        </Card>
      ) : null}

      {/* صحة النظام */}
      {state.systemHealth ? (
        <Card title="صحة النظام">
          <span className={`px-3 py-1 rounded-lg border text-xs ${healthTone(state.systemHealth.overall)}`}>{state.systemHealth.report}</span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
            {state.systemHealth.checks?.map((c: any) => (
              <div key={c.key} className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 text-[11px]">
                <span className={`px-1.5 py-0.5 rounded border ${healthTone(c.level)}`}>{c.level}</span> <span className="text-slate-300">{c.labelAr}</span>
                <div className="text-slate-500 mt-1">{c.detail}</div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* دورة التشغيل + الأسئلة */}
      {loop?.operatingLoop ? (
        <Card title="دورة التشغيل التجارية" hint={loop.operatingLoop.reason}>
          <div className="flex flex-wrap gap-1 mb-4">
            {loop.operatingLoop.completed?.map((s: string) => (
              <span key={s} className="px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px]">✓ {s}</span>
            ))}
            <span className="px-2 py-0.5 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[10px]">◉ {loop.operatingLoop.currentStep}</span>
          </div>
          {loop.operatingLoop.blockedOnOwnerApproval ? <p className="text-[11px] text-amber-300">التقدّم موقوف على موافقتك — لا تنفيذ خارجي بلا اعتماد.</p> : null}
          <div className="mt-4">
            <div className="text-xs font-bold text-slate-300 mb-2">الأسئلة التجارية التي يطرحها العقل</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {loop.questions?.map((q: string, i: number) => <div key={i} className="text-[11px] text-slate-400">• {q}</div>)}
            </div>
          </div>
        </Card>
      ) : null}

      {/* الحدود */}
      <Card title="الحدود والصدق" hint={state.note}>
        <ul className="text-[11px] text-slate-400 space-y-1">
          {state.limitations?.map((l: string, i: number) => <li key={i}>• {l}</li>)}
        </ul>
      </Card>

      <button onClick={load} className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-sm">تحديث</button>
    </div>
  );
};

export default UnifiedGrowthBrainView;
