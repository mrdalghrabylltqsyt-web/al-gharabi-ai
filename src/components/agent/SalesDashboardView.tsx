import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiService } from '../../services/api';

/**
 * العقل المركزي للمبيعات الرقمية — لوحة المالك.
 *
 * تعرض القُمع الرقمي، الإشارات الشرائية، العملاء المؤهّلون، الطلبات، المبيعات
 * الموثّقة، الخسائر وأسبابها، التسليم البشري، المتابعات، الإسناد، والاستدلال
 * البيعي — كلها من بيانات حقيقية. لا أزرار تنفيذ، ولا أرقام مُخترعة: غير المتاح
 * يُعلن صراحةً (NOT_AVAILABLE).
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

const toneFor = (state: string): string => {
  const tones: Record<string, string> = {
    PURCHASE_SIGNAL: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    ANSWERED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    QUALIFIED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    QUALIFIED_LEAD: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    REQUEST: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    VERIFIED_SALE: 'bg-emerald-600/20 text-emerald-200 border-emerald-500/40',
    DIRECT: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    SUPPORTED: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    NEEDS_MORE_EVIDENCE: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    NEEDS_HUMAN_REVIEW: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    DATA_NOT_AVAILABLE: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    HUMAN_REVIEW: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    UNCERTAIN: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    NOT_ATTRIBUTABLE: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
    LOST: 'bg-red-500/15 text-red-300 border-red-500/30',
    UNRESOLVED: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
    NO_PURCHASE_SIGNAL: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  };
  return tones[state] || 'bg-slate-500/15 text-slate-300 border-slate-500/30';
};

const Pill: React.FC<{ state: string; label: string }> = ({ state, label }) => (
  <span className={`px-2 py-0.5 rounded-lg border text-[11px] ${toneFor(state)}`}>{label}</span>
);

const FunnelBar: React.FC<{ stages: any[] }> = ({ stages }) => {
  const available = stages.filter((s) => s.available && typeof s.value === 'number');
  const max = available.length ? Math.max(...available.map((s) => s.value as number)) : 0;
  return (
    <div className="space-y-2">
      {stages.map((s) => (
        <div key={s.stage}>
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-slate-300">{s.labelAr}</span>
            <span className={s.available ? 'text-white font-bold' : 'text-slate-500'}>{s.available ? s.value : 'غير متاح'}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            {s.available && max > 0 ? (
              <div className="h-full bg-emerald-500/60" style={{ width: `${Math.max(2, ((s.value as number) / max) * 100)}%` }} />
            ) : (
              <div className="h-full w-2 bg-slate-600" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export const SalesDashboardView: React.FC = () => {
  const { showToast } = useApp();
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<any>(null);
  const [dashboard, setDashboard] = useState<any>(null);
  const [events, setEvents] = useState<any>(null);
  const [autonomy, setAutonomy] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, d, ev, au] = await Promise.all([
        apiService.getDigitalSalesState(),
        apiService.getDigitalSalesDashboard(),
        apiService.getDigitalSalesEvents(),
        apiService.getDigitalSalesAutonomy(),
      ]);
      setState(s);
      setDashboard(d);
      setEvents(ev);
      setAutonomy(au);
    } catch (e: any) {
      setError(String(e?.message || 'تعذر جلب حالة المبيعات الرقمية'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const summary = state?.summary || {};
  const funnel = state?.funnel || { stages: [], conversions: [], bottleneck: null };
  const leads: any[] = state?.leads || [];
  const lost: any[] = state?.lostOpportunities || [];
  const followUps: any[] = state?.followUps || [];
  const handoffs: any[] = state?.handoffs || [];
  const attributions: any[] = state?.attributions || [];
  const intents: any[] = state?.intents || [];
  const reasoning: any[] = state?.reasoning || [];
  const nextActions: string[] = state?.nextActions || [];
  const limitations: string[] = state?.limitations || [];
  const bottleneck = funnel?.bottleneck;
  const productsGeneratingSales: any[] = dashboard?.productsGeneratingSales || [];

  const intentsWithHandoff = intents.filter((i) => i.handoff?.required);
  const priceRequests = intents.filter((i) => i.answer?.questionKind === 'cash_price');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">العقل المركزي للمبيعات الرقمية</h2>
          <p className="text-[12px] text-slate-400">قناة بيع ثانية إلى جانب المعرض — كل رقم من سجل حقيقي، وغير المتاح يُعلن صراحةً.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm text-white disabled:opacity-50">
          {loading ? '...جارٍ التحديث' : 'تحديث'}
        </button>
      </div>

      {error ? <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{error}</div> : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="استفسارات" value={summary.interactions ?? 0} />
        <Metric label="إشارات شراء" value={summary.purchaseSignals ?? 0} tone="text-emerald-300" />
        <Metric label="عملاء مؤهّلون" value={summary.qualifiedLeads ?? 0} tone="text-emerald-300" />
        <Metric label="مبيعات موثّقة" value={summary.verifiedSales ?? 0} tone="text-emerald-200" />
        <Metric label="طلبات" value={summary.requests ?? 0} />
        <Metric label="خسائر" value={summary.lost ?? 0} tone="text-red-300" />
        <Metric label="غير محسوم" value={summary.unresolved ?? 0} />
        <Metric label="تسليم بشري" value={summary.humanHandoffs ?? 0} tone="text-amber-300" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="القُمع البيعي الرقمي" hint="مرحلة بلا بيانات تُعلن «غير متاح» لا صفراً؛ ولا معدّل بمقام صفر.">
          <FunnelBar stages={funnel.stages || []} />
          {bottleneck ? (
            <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <div className="text-[11px] text-amber-300 font-bold">عنق الزجاجة</div>
              <div className="text-[11px] text-slate-200 mt-1">{bottleneck.reason}</div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 mt-3">لا عنق زجاجة مُثبت — يحتاج مرحلتين متاحتين على الأقل.</p>
          )}
        </Card>

        <Card title="منتجات تولّد مبيعات" hint="العدد من سجل المبيعات الموثّق فقط.">
          {productsGeneratingSales.length ? (
            <ul className="space-y-2">
              {productsGeneratingSales.map((p, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="text-slate-200">{p.productName || p.productId}</span>
                  <span className="text-emerald-300 font-bold">{p.verifiedSales}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-[11px] text-slate-500">لا مبيعات موثّقة مسجّلة بعد.</p>}
        </Card>
      </div>

      {/* استفسارات + إجابات موثّقة + تسليم بشري */}
      <Card title="الاستفسارات والإجابات الموثّقة" hint="لا سعر/قسط بلا بيانات موثّقة؛ الناقص يتحوّل لتسليم بشري.">
        {intents.length ? (
          <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
            {intents.slice(0, 30).map((it, i) => (
              <div key={i} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-[11px] text-slate-400">{it.platform}</span>
                  <Pill state={it.intent?.state} label={it.intent?.stateLabel || it.intent?.state} />
                  {it.answer ? <Pill state={it.answer.state} label={it.answer.stateLabel} /> : null}
                  {it.handoff?.required ? <Pill state="NEEDS_HUMAN_REVIEW" label={`تسليم: ${it.handoff.reasonLabel}`} /> : null}
                </div>
                {it.answer?.answerText ? <div className="text-[12px] text-slate-200">{it.answer.answerText}</div> : null}
                {it.handoff?.recommendedAction ? <div className="text-[11px] text-amber-300 mt-1">الإجراء البشري: {it.handoff.recommendedAction}</div> : null}
                <div className="text-[10px] text-slate-500 mt-1">دليل الإشارة: {it.intent?.reason}</div>
              </div>
            ))}
          </div>
        ) : <p className="text-[11px] text-slate-500">لا استفسارات مسجّلة بعد.</p>}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="خطّ العملاء المحتملين">
          {leads.length ? (
            <ul className="space-y-2 max-h-[320px] overflow-auto pr-1">
              {leads.slice(0, 30).map((l, i) => (
                <li key={i} className="flex items-center justify-between text-[12px] gap-2">
                  <span className="text-slate-300 truncate">{l.leadId}</span>
                  <Pill state={l.stage} label={l.stageLabel} />
                </li>
              ))}
            </ul>
          ) : <p className="text-[11px] text-slate-500">لا عملاء محتملون بعد.</p>}
        </Card>

        <Card title="التسليم البشري" hint="لا تُخترع إجابة لتفادي التسليم.">
          {handoffs.length ? (
            <ul className="space-y-2 max-h-[320px] overflow-auto pr-1">
              {handoffs.slice(0, 20).map((h, i) => (
                <li key={i} className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 text-[12px]">
                  <div className="text-amber-300 font-bold">{h.reasonLabelAr}</div>
                  <div className="text-slate-400 text-[11px]">{h.recommendedAction}</div>
                </li>
              ))}
            </ul>
          ) : <p className="text-[11px] text-slate-500">لا حالات تسليم بشري.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="المتابعات المحضّرة" hint="لا متابعة بلا موافقة، ومع احترام الإلغاء وحدود التكرار ومنع السبام.">
          {followUps.length ? (
            <ul className="space-y-2 max-h-[320px] overflow-auto pr-1">
              {followUps.slice(0, 20).map((f, i) => (
                <li key={i} className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 text-[12px]">
                  <div className="flex items-center gap-2">
                    <Pill state={f.state === 'FOLLOW_UP_OPPORTUNITY' ? 'QUALIFIED' : 'NO_PURCHASE_SIGNAL'} label={f.state === 'FOLLOW_UP_OPPORTUNITY' ? 'فرصة متابعة' : 'غير مؤهّل'} />
                  </div>
                  <div className="text-slate-300 mt-1">{f.why}</div>
                  {f.blockers?.length ? <div className="text-[10px] text-amber-300 mt-1">الموانع: {f.blockers.join(' | ')}</div> : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-[11px] text-slate-500">لا فرص متابعة.</p>}
        </Card>

        <Card title="الإسناد (الحملة → البيع)" hint="لا سببية عند الشك — UNCERTAIN تُعلن صراحةً.">
          {attributions.length ? (
            <ul className="space-y-2 max-h-[320px] overflow-auto pr-1">
              {attributions.slice(0, 20).map((a, i) => (
                <li key={i} className="flex items-center justify-between text-[12px] gap-2">
                  <span className="text-slate-300 truncate">{a.saleId}</span>
                  <Pill state={a.state} label={a.stateLabel} />
                </li>
              ))}
            </ul>
          ) : <p className="text-[11px] text-slate-500">لا مبيعات موثّقة لإسنادها.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="الخسائر وأسبابها" hint="السبب من دليل حقيقي فقط؛ وإلا يبقى «سبب غير معروف».">
          {lost.length ? (
            <ul className="space-y-2 max-h-[280px] overflow-auto pr-1">
              {lost.slice(0, 20).map((l, i) => (
                <li key={i} className="flex items-center justify-between text-[12px] gap-2">
                  <span className="text-slate-300 truncate">{l.leadId}</span>
                  <span className="text-red-300">{l.reasonLabelAr || l.reason}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-[11px] text-slate-500">لا خسائر مسجّلة.</p>}
        </Card>

        <Card title="الاستدلال البيعي: لماذا لا نبيع؟" hint="فصل صريح: حقيقة/تفسير/فرضية/توصية — بلا تقديم فرضية كحقيقة.">
          {reasoning.length ? (
            <ul className="space-y-2 max-h-[280px] overflow-auto pr-1">
              {reasoning.slice(0, 15).map((r, i) => (
                <li key={i} className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 text-[12px]">
                  <div className="text-slate-200">{r.productName}</div>
                  <div className="text-[11px] text-slate-400">{r.verdictAvailable ? `أسباب مدعومة: ${(r.supportedBlockers || []).join(', ') || '—'}` : 'الأدلة غير كافية لحكم.'}</div>
                  {r.ownerActions?.length ? <div className="text-[10px] text-amber-300 mt-1">يحتاج المالك: {r.ownerActions.join(' | ')}</div> : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-[11px] text-slate-500">لا تقارير استدلال.</p>}
        </Card>
      </div>

      {/* طبقة الأحداث + الاستقلالية */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="أحداث جاهزة للتعلّم (الدفعة 4)" hint="بلا بيانات شخصية، وبلا تعلّم من ادّعاء بيع غير موثّق.">
          {events?.events?.length ? (
            <div className="text-[11px] text-slate-300">
              <div className="mb-2 text-slate-400">إجمالي الأحداث: {events.count}</div>
              <ul className="space-y-1 max-h-[220px] overflow-auto pr-1">
                {events.events.slice(-15).reverse().map((e: any, i: number) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="truncate">{e.typeLabel}</span>
                    <span className="text-slate-500">{e.learningEligible ? 'قابل للتعلّم' : 'غير مؤهّل'}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : <p className="text-[11px] text-slate-500">لا أحداث بعد.</p>}
        </Card>

        <Card title="مستويات الاستقلالية والاعتماد" hint="الافتراضي آمن (مراقبة). لا فعل تجاري خارجي بلا اعتماد مطابق.">
          <div className="text-[12px] text-slate-300 space-y-1">
            <div>المستوى الافتراضي: <span className="text-emerald-300 font-bold">{autonomy?.defaultLevel || 'OBSERVE'}</span></div>
            <div className="text-[11px] text-slate-400">الأفعال التي لا تُنفَّذ صامتةً: {(autonomy?.neverSilentActions || []).join(', ')}</div>
          </div>
        </Card>
      </div>

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

      <p className="text-[11px] text-slate-500">{state?.note || 'عقل المبيعات الرقمية — قراءة وتحضير فقط بلا أسرار.'}</p>
    </div>
  );
};

export default SalesDashboardView;
