import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiService } from '../../services/api';

/**
 * عقل التسويق والطلب (Growth & Demand) — لوحة المالك.
 *
 * تعرض الطلب الحالي والمتزايد، أقوى الفرص، المنتجات المولّدة للاهتمام، الحملات
 * وأسبابها، التجارب، القُمع البيعي وعنق الزجاجة، والإجراءات الموصى بها — كلها من
 * بيانات حقيقية. لا أزرار تنفيذ، ولا أرقام مُخترعة: غير المتاح يُعلن صراحةً.
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

const StatePill: React.FC<{ state: string; label: string }> = ({ state, label }) => {
  const tones: Record<string, string> = {
    SUPPORTED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    HYPOTHESIS: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    MATCHED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    WEAK: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    NO_EVIDENCE: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
    RISING: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    STABLE: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    FALLING: 'bg-red-500/15 text-red-300 border-red-500/30',
    UNKNOWN: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  };
  return <span className={`px-2 py-0.5 rounded-lg border text-[11px] ${tones[state] || tones.UNKNOWN}`}>{label}</span>;
};

export const GrowthBrainView: React.FC = () => {
  const { showToast } = useApp();
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<any>(null);
  const [dashboard, setDashboard] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, d] = await Promise.all([apiService.getGrowthState(), apiService.getGrowthDashboard()]);
      setState(s);
      setDashboard(d);
    } catch (e: any) {
      setError(String(e?.message || 'تعذر جلب حالة عقل التسويق'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const labels = state?.labels || {};
  const audience = state?.audience?.summary || {};
  const segments: any[] = state?.audience?.segments || [];
  const demandSummary = state?.demand?.summary || {};
  const demandOpps: any[] = state?.demand?.opportunities || [];
  const campaigns: any[] = state?.campaigns?.items || [];
  const experiments: any[] = state?.experiments?.items || [];
  const funnel = state?.funnel || {};
  const funnelStages: any[] = funnel.stages || [];
  const bottleneck = funnel.bottleneck;
  const matches: any[] = state?.matching?.matches || [];
  const productsGeneratingInterest: any[] = dashboard?.productsGeneratingInterest || [];
  const risingDemand: any[] = dashboard?.risingDemand || [];
  const nextActions: string[] = state?.nextActions || [];
  const limitations: string[] = state?.limitations || [];

  const segmentStateLabel = (s: string) => labels?.segmentStates?.[s] || s;
  const trendLabel = (t: string) => labels?.demandTrends?.[t] || t;
  const matchStateLabel = (s: string) => labels?.matchStates?.[s] || s;

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">عقل التسويق والطلب — كيف نخلق طلباً حقيقياً؟</h2>
          <p className="text-xs text-slate-400 mt-1">
            يبدأ من الطلب لا من المنشور: مقاطع جمهور · فرص طلب · مطابقة منتج↔جمهور · حملات بسبب · تجارب · قُمع بيعي.
            قراءة فقط — بلا تنفيذ وبلا أرقام مُخترعة.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? 'جارٍ التحديث…' : 'تحديث'}
        </button>
      </div>

      {error ? (
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{error}</div>
      ) : null}

      {/* مؤشرات علوية */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Metric label="مقاطع الجمهور" value={audience.total ?? 0} />
        <Metric label="مقاطع مدعومة" value={audience.supported ?? 0} tone="text-emerald-300" />
        <Metric label="فرص الطلب" value={demandSummary.total ?? 0} />
        <Metric label="طلب متزايد" value={demandSummary.rising ?? 0} tone={(demandSummary.rising ?? 0) ? 'text-emerald-300' : 'text-white'} />
        <Metric label="حملات" value={campaigns.length} />
        <Metric label="تجارب" value={experiments.length} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* مقاطع الجمهور */}
        <Card title="مقاطع الجمهور (فرضيات سلوكية مدعومة)" hint="المقطع يُشتقّ من تفاعل حقيقي؛ ودون عيّنة كافية يُعلن فرضية. لا سمات سكانية.">
          {segments.length === 0 ? (
            <p className="text-sm text-slate-400">لا مقاطع بعد — تُبنى من تفاعل حقيقي (تعليقات/رسائل).</p>
          ) : (
            <ul className="space-y-2">
              {segments.map((s) => (
                <li key={s.id} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white">{s.labelAr}</span>
                    <StatePill state={s.state} label={segmentStateLabel(s.state)} />
                  </div>
                  <div className="text-[11px] text-slate-400">
                    عيّنة {s.sampleSize} · منصات: {(s.whereActive || []).join(', ') || '—'} · ثقة {s.confidence}
                  </div>
                  {s.interests?.length ? <div className="text-[11px] text-slate-300">اهتمامات: {s.interests.join(' · ')}</div> : null}
                  {s.evidence?.[0] ? <div className="text-[11px] text-slate-500">{s.evidence[0].statement}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* الطلب الحالي والمتزايد */}
        <Card title="الطلب الحالي والمتزايد" hint="«التزايد» لا يُعلن بلا اتجاه زمني مقيس بين نصفين.">
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Metric label="إجمالي الفرص" value={demandSummary.total ?? 0} />
            <Metric label="عيّنة كافية" value={demandSummary.sufficient ?? 0} tone="text-emerald-300" />
            <Metric label="غير مُلبّى" value={demandSummary.unmet ?? 0} tone={demandSummary.unmet ? 'text-amber-300' : 'text-white'} />
          </div>
          {risingDemand.length === 0 ? (
            <p className="text-sm text-slate-400">لا طلب متزايد مُثبت بعد — يحتاج اتجاه زمني مقيس.</p>
          ) : (
            <ul className="space-y-2">
              {risingDemand.map((r) => (
                <li key={r.id} className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white">{r.kindLabel}</span>
                    <StatePill state="RISING" label={trendLabel('RISING')} />
                  </div>
                  <div className="text-[11px] text-slate-400">{r.productId ? `منتج: ${r.productId}` : 'موضوع عام'}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* أقوى الفرص */}
      <Card title="أقوى فرص الطلب" hint="كل فرصة: دليل + مصدر + فترة + عيّنة + ثقة + حدود + إجراء موصى به.">
        {demandOpps.length === 0 ? (
          <p className="text-sm text-slate-400">لا فرص بعد — تُبنى من إشارات طلب بعيّنة كافية.</p>
        ) : (
          <ul className="space-y-3">
            {demandOpps.slice(0, 10).map((o) => (
              <li key={o.id} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-sm text-white">{o.kindLabel}</span>
                  <div className="flex items-center gap-2">
                    <StatePill state={o.trend} label={`اتجاه: ${trendLabel(o.trend)}`} />
                    <span className={`text-[11px] ${o.sufficientSample ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {o.sufficientSample ? `عيّنة كافية (${o.sampleSize})` : `عيّنة غير كافية (${o.sampleSize})`}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-300"><b className="text-slate-400">حقيقة:</b> {o.fact?.statement}</p>
                {o.interpretation ? <p className="text-[11px] text-slate-300"><b className="text-slate-400">تفسير:</b> {o.interpretation.statement}</p> : null}
                <p className="text-[11px] text-slate-300"><b className="text-slate-400">فرضية:</b> {o.hypothesis?.statement}</p>
                <p className="text-[11px] text-slate-300"><b className="text-slate-400">توصية:</b> {o.recommendedAction}</p>
                <div className="text-[10px] text-slate-500">
                  مصدر: {o.source} · ثقة {o.confidence}{o.periodDays !== null && o.periodDays !== undefined ? ` · فترة ${o.periodDays} يوم` : ' · فترة غير معروفة'}
                  {o.requiresOwnerAction ? ' · تتطلب إجراء المالك' : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* المنتجات المولّدة للاهتمام + المطابقة */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card title="منتجات تولّد اهتماماً (مطابقة WHO/WHY/WHAT)" hint="المطابقة بلا دليل تُعلن NO_EVIDENCE ولا يُخترع جمهور.">
          {matches.length === 0 ? (
            <p className="text-sm text-slate-400">لا مطابقات بعد — تحتاج إشارات طلب مرتبطة بمنتجات مسجّلة.</p>
          ) : (
            <ul className="space-y-2">
              {matches.filter((m) => m.state !== 'NO_EVIDENCE').slice(0, 8).map((m) => (
                <li key={m.productId} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white">{m.productName}</span>
                    <StatePill state={m.state} label={matchStateLabel(m.state)} />
                  </div>
                  <div className="text-[11px] text-slate-400">من يحتاجه: {(m.who || []).map((w: any) => w.segmentLabel).join(' · ') || 'غير محدّد'}</div>
                  <div className="text-[11px] text-slate-300">لماذا: {m.why}</div>
                  <div className="text-[11px] text-slate-300">ما نعرضه: {m.whatToShow}</div>
                  <div className="text-[11px] text-slate-400">أين: {(m.where || []).join(', ') || 'غير محدّد'} · متى: {m.when}</div>
                  <div className="text-[11px] text-slate-300">الرسالة: {m.message}</div>
                  <div className="text-[11px] text-slate-300">CTA: {m.cta}</div>
                </li>
              ))}
              {matches.filter((m) => m.state !== 'NO_EVIDENCE').length === 0 ? (
                <p className="text-sm text-slate-400">كل المطابقات بلا دليل كافٍ — لا يُخترع جمهور.</p>
              ) : null}
            </ul>
          )}
        </Card>

        <Card title="منتجات تولّد اهتماماً (ملخّص اللوحة)" hint="من اللوحة المخصّصة للمالك.">
          {productsGeneratingInterest.length === 0 ? (
            <p className="text-sm text-slate-400">لا منتجات مولّدة للاهتمام بعد.</p>
          ) : (
            <ul className="space-y-2">
              {productsGeneratingInterest.map((p) => (
                <li key={p.productId} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white">{p.productName}</span>
                    <StatePill state={p.state} label={matchStateLabel(p.state)} />
                  </div>
                  <div className="text-[11px] text-slate-400">{(p.who || []).join(' · ') || 'جمهور غير محدّد'}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* الحملات */}
      <Card title="الحملات (كل حملة لها سبب)" hint="الهدف والفرضية والهوك والـCTA إلزامية؛ النتيجة الفعلية من سجلات حقيقية فقط.">
        {campaigns.length === 0 ? (
          <p className="text-sm text-slate-400">لا حملات مؤهّلة — تحتاج فرصة طلب بعيّنة كافية. لا تُخترع حملة.</p>
        ) : (
          <ul className="space-y-3">
            {campaigns.slice(0, 8).map((c) => (
              <li key={c.id} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-sm text-white">{c.productName || c.productId || 'حملة عامة'}</span>
                  <span className="text-[11px] text-slate-400">{labels?.campaignLifecycle?.[c.status] || c.status} · أساس السبب: {c.reasonBasis === 'FACT' ? 'حقيقة' : 'فرضية'}</span>
                </div>
                <div className="text-[11px] text-slate-300">السبب: {c.objective}</div>
                <div className="text-[11px] text-slate-300">الهوك: {c.hook}</div>
                <div className="text-[11px] text-slate-300">الرسالة: {c.message}</div>
                <div className="text-[11px] text-slate-300">CTA: {c.cta}</div>
                <div className="text-[11px] text-slate-400">
                  المنصات: {(c.platforms || []).join(', ') || 'غير محدّدة'} · متوقّع: {c.expectedResult?.labelAr || c.expectedResult?.metric}
                  {' · '}فعلي: {c.actualResult?.value !== null && c.actualResult?.value !== undefined ? c.actualResult.value : 'غير متاح'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* التجارب + القُمع */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card title="التجارب التسويقية" hint="متغيّر واحد؛ لا فائز بلا عيّنة كافية، والفرق داخل الضجيج يُعلن غير حاسم.">
          {experiments.length === 0 ? (
            <p className="text-sm text-slate-400">لا تجارب مقترحة بعد — تُشتقّ من الحملات المؤهّلة.</p>
          ) : (
            <ul className="space-y-2">
              {experiments.slice(0, 8).map((e) => (
                <li key={e.id} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white">{e.typeLabel}</span>
                    <span className="text-[11px] text-slate-400">{e.status}{e.verdict ? ` · ${e.verdict}` : ''}</span>
                  </div>
                  <div className="text-[11px] text-slate-300">{e.hypothesis}</div>
                  <div className="text-[11px] text-slate-400">المتغيّر: {e.variable} · المقياس: {e.successMetric}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="القُمع البيعي وعنق الزجاجة" hint="REACH → INTEREST → INQUIRY → LEAD → VERIFIED SALE؛ غير المتاح يُعلن لا يُقدَّر.">
          <div className="space-y-2">
            {funnelStages.map((s) => (
              <div key={s.stage} className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                <span className="text-[12px] text-slate-300">{s.labelAr}</span>
                <span className={`text-sm font-bold ${s.available ? 'text-white' : 'text-slate-500'}`}>
                  {s.available ? s.value : 'غير متاح'}
                </span>
              </div>
            ))}
          </div>
          {bottleneck ? (
            <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <div className="text-[12px] text-amber-300 font-bold">موضع توقّف التحويل: {bottleneck.stageLabel}</div>
              <div className="text-[11px] text-slate-300 mt-1">{bottleneck.reason}</div>
              <div className="text-[11px] text-slate-300 mt-1">الإجراء: {bottleneck.recommendedAction}</div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 mt-3">لا عنق زجاجة مُثبت — يحتاج مرحلتين متاحتين على الأقل.</p>
          )}
        </Card>
      </div>

      {/* الإجراءات الموصى بها + القيود */}
      {nextActions.length > 0 || limitations.length > 0 ? (
        <Card title="الإجراءات الموصى بها / قيود صادقة">
          {nextActions.length > 0 ? (
            <ul className="list-disc pr-5 text-sm text-emerald-300 space-y-1">
              {nextActions.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          ) : null}
          {limitations.length > 0 ? (
            <ul className="list-disc pr-5 text-[11px] text-slate-400 space-y-1 mt-2">
              {limitations.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          ) : null}
        </Card>
      ) : null}

      <p className="text-[11px] text-slate-500">{state?.note || 'عقل التسويق والطلب — قراءة فقط بلا أسرار.'}</p>
    </div>
  );
};

export default GrowthBrainView;
