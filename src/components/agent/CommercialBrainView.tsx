import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiService } from '../../services/api';

/**
 * العقل التجاري (Sales & Growth) — لوحة أساسية للمالك.
 *
 * تعرض ما يعرفه العقل فعلاً عن الواقع التجاري للغرابي: المنتجات (بحالة توثيق
 * السعر/التوفر)، إشارات الطلب، الفرص، مسار العملاء، والمبيعات الموثّقة — كلها
 * من بيانات حقيقية. لا أزرار تنفيذ، ولا قيم مُخترعة: غير المتاح يُعلن صراحةً.
 */

const STATE_LABELS: Record<string, string> = {
  VERIFIED: 'موثّق',
  DERIVED: 'مشتق من قاعدة',
  NEEDS_UPDATE: 'يحتاج تحديث',
  UNKNOWN: 'غير معروف',
  NOT_PROVIDED: 'غير متوفر',
};

const STATE_TONES: Record<string, string> = {
  VERIFIED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  DERIVED: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  NEEDS_UPDATE: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  UNKNOWN: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  NOT_PROVIDED: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

const Card: React.FC<{ title: string; children: React.ReactNode; hint?: string }> = ({ title, children, hint }) => (
  <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
    <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-3 mb-4">{title}</h3>
    {children}
    {hint ? <p className="text-[11px] text-slate-500 mt-3">{hint}</p> : null}
  </div>
);

const StateBadge: React.FC<{ state: string }> = ({ state }) => (
  <span className={`px-2 py-0.5 rounded-lg border text-[11px] ${STATE_TONES[state] || STATE_TONES.UNKNOWN}`}>
    {STATE_LABELS[state] || state}
  </span>
);

const Metric: React.FC<{ label: string; value: React.ReactNode; tone?: string }> = ({ label, value, tone }) => (
  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
    <div className="text-[11px] text-slate-400">{label}</div>
    <div className={`text-lg font-bold ${tone || 'text-white'}`}>{value}</div>
  </div>
);

export const CommercialBrainView: React.FC = () => {
  const { showToast } = useApp();
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await apiService.getCommercialState());
    } catch (e: any) {
      setError(String(e?.message || 'تعذر جلب الحالة التجارية'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const products: any[] = state?.catalog?.products || [];
  const readiness = state?.catalog?.readiness || {};
  const topSignals: any[] = state?.demand?.topSignals || [];
  const opportunities: any[] = state?.opportunities || [];
  const journeys = state?.journeys?.summary || {};
  const confirmedSales: any[] = state?.journeys?.confirmedSales || [];
  const sales = state?.sales || {};
  const campaigns = state?.campaigns || {};
  const memory = state?.memory || {};
  const gaps: string[] = state?.readinessGaps || [];

  const incompleteProducts = products.filter((p) => p.cashPriceState !== 'VERIFIED' || p.availabilityState !== 'VERIFIED');

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">العقل التجاري — الواقع الحقيقي للغرابي</h2>
          <p className="text-xs text-slate-400 mt-1">
            يقرأ المنتجات والطلب والعملاء والمبيعات الفعلية. قراءة فقط — لا تنفيذ ولا أسعار مُخترعة.
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
        <Metric label="المنتجات" value={readiness.total ?? products.length} />
        <Metric label="سعر موثّق" value={readiness.withVerifiedPrice ?? 0} tone="text-emerald-300" />
        <Metric label="تحتاج توثيق" value={incompleteProducts.length} tone={incompleteProducts.length ? 'text-amber-300' : 'text-white'} />
        <Metric label="إشارات الطلب" value={state?.demand?.summary?.total ?? 0} />
        <Metric label="مبيعات موثّقة" value={sales.verifiedSales ?? 0} tone="text-emerald-300" />
        <Metric label="عملاء محتملون" value={sales.leads ?? 0} />
      </div>

      {/* المنتجات */}
      <Card title="المنتجات (معرفة موثّقة)" hint="السعر/التوفر يُوسَمان بحالة التوثيق؛ الغائب يُعلن لا يُخترع.">
        {products.length === 0 ? (
          <p className="text-sm text-slate-400">لا توجد منتجات مسجّلة بعد — أضف منتجات حقيقية من قسم المنتجات/المخزون.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-xs border-b border-slate-800">
                  <th className="text-right p-2">المنتج</th>
                  <th className="text-right p-2">السعر النقدي</th>
                  <th className="text-right p-2">التوفر</th>
                  <th className="text-right p-2">أقساط</th>
                  <th className="text-right p-2">ناقص</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-b border-slate-800/60">
                    <td className="p-2 text-white">{p.name}</td>
                    <td className="p-2">
                      <span className="text-white">{p.cashPrice != null ? Number(p.cashPrice).toLocaleString('ar-IQ') : '—'}</span>{' '}
                      <StateBadge state={p.cashPriceState} />
                    </td>
                    <td className="p-2">
                      <span className="text-white">{p.inStock === true ? 'متوفر' : p.inStock === false ? 'غير متوفر' : 'يحتاج تحقق'}</span>{' '}
                      <StateBadge state={p.availabilityState} />
                    </td>
                    <td className="p-2 text-slate-300">
                      {Array.isArray(p.installmentOffers) && p.installmentOffers.length
                        ? p.installmentOffers.map((o: any, i: number) => (
                            <span key={i} className="inline-block ml-1 text-[11px]">
                              {o.durationMonths} شهر × {o.monthlyAmount != null ? Number(o.monthlyAmount).toLocaleString('ar-IQ') : '—'}
                            </span>
                          ))
                        : <span className="text-amber-300 text-[11px]">لا عرض مشتق</span>}
                    </td>
                    <td className="p-2 text-[11px] text-amber-300">
                      {Array.isArray(p.missing) && p.missing.length ? p.missing.join(' · ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        {/* إشارات الطلب */}
        <Card title="أعلى إشارات الطلب" hint="كل إشارة من تعليق/رسالة حقيقية؛ بلا عيّنة كافية تُعلن القوة INSUFFICIENT_DATA.">
          {topSignals.length === 0 ? (
            <p className="text-sm text-slate-400">لا إشارات طلب بعد — تُبنى من التعليقات والرسائل الواردة الفعلية.</p>
          ) : (
            <ul className="space-y-2">
              {topSignals.map((s, i) => (
                <li key={i} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm text-white">{s.label || s.kind}</div>
                    <div className="text-[11px] text-slate-400">{s.productId ? `منتج: ${s.productId}` : 'موضوع عام'}</div>
                  </div>
                  <div className="text-left">
                    <div className="text-white font-bold">{s.count}</div>
                    <div className="text-[11px] text-slate-400">{s.strengthLabel || s.strength}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* الفرص */}
        <Card title="الفرص السوقية" hint="كل فرصة تفصل الحقيقة عن التفسير عن الفرضية عن التوصية.">
          {opportunities.length === 0 ? (
            <p className="text-sm text-slate-400">لا فرص بعد — تُبنى من إشارات طلب بعيّنة كافية.</p>
          ) : (
            <ul className="space-y-3">
              {opportunities.slice(0, 8).map((o, i) => (
                <li key={i} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white">{o.kindLabel || o.kind}</span>
                    <span className={`text-[11px] ${o.sufficientSample ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {o.sufficientSample ? 'عيّنة كافية' : 'عيّنة غير كافية'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300"><b className="text-slate-400">حقيقة:</b> {o.fact?.statement}</p>
                  {o.interpretation ? <p className="text-[11px] text-slate-300"><b className="text-slate-400">تفسير:</b> {o.interpretation.statement}</p> : null}
                  <p className="text-[11px] text-slate-300"><b className="text-slate-400">توصية:</b> {o.recommendation?.statement}</p>
                  {o.requiresOwnerAction ? <span className="inline-block text-[10px] text-amber-300">تتطلب إجراء المالك</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* مسار العملاء */}
        <Card title="مسار العملاء" hint="الاستفسار ليس بيعاً؛ VERIFIED_SALE يتطلب سجل بيع حقيقي.">
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(journeys.stageCounts || journeys.byStage || {}).map(([stage, count]) => (
              <div key={stage} className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                <div className="text-[11px] text-slate-400">{stage}</div>
                <div className="text-white font-bold">{String(count)}</div>
              </div>
            ))}
            {Object.keys(journeys.stageCounts || journeys.byStage || {}).length === 0 ? (
              <p className="text-sm text-slate-400 col-span-2">لا مسارات بعد.</p>
            ) : null}
          </div>
          {confirmedSales.length > 0 ? (
            <div className="mt-3">
              <div className="text-[11px] text-emerald-300 mb-1">مبيعات موثّقة:</div>
              <ul className="space-y-1">
                {confirmedSales.slice(0, 5).map((s, i) => (
                  <li key={i} className="text-[11px] text-slate-300">{s.subjectKey} {s.productId ? `— ${s.productId}` : ''}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        {/* الحملات */}
        <Card title="حالة الحملات" hint="الحملة تربط الهدف بالنتيجة المتوقعة؛ الغائب يُكشف.">
          <div className="grid grid-cols-2 gap-2">
            <Metric label="إجمالي" value={campaigns.total ?? 0} />
            <Metric label="ناقصة" value={campaigns.incomplete ?? 0} tone={campaigns.incomplete ? 'text-amber-300' : 'text-white'} />
            <Metric label="بنتيجة فعلية" value={campaigns.withActualOutcome ?? 0} />
            <Metric label="بمبيعات موثّقة" value={campaigns.withVerifiedSales ?? 0} tone="text-emerald-300" />
          </div>
        </Card>

        {/* الذاكرة التجارية */}
        <Card title="ذاكرة العقل التجاري" hint="حقيقة ملاحَظة ≠ استنتاج ≠ فرضية.">
          <div className="grid grid-cols-2 gap-2">
            <Metric label="إجمالي السجلات" value={memory.total ?? 0} />
            <Metric label="حقائق ملاحَظة" value={memory.observedFacts ?? 0} tone="text-emerald-300" />
            <Metric label="استنتاجات" value={memory.inferences ?? 0} tone="text-sky-300" />
            <Metric label="فرضيات" value={memory.hypotheses ?? 0} tone="text-indigo-300" />
          </div>
          {memory.note ? <p className="text-[11px] text-slate-500 mt-2">{memory.note}</p> : null}
        </Card>
      </div>

      {/* معلومات ناقصة + قيود */}
      {gaps.length > 0 || (state?.limitations?.length ?? 0) > 0 ? (
        <Card title="ما ينقص العقل / قيود صادقة">
          {gaps.length > 0 ? (
            <ul className="list-disc pr-5 text-sm text-amber-300 space-y-1">
              {gaps.map((g: string, i: number) => <li key={i}>{g}</li>)}
            </ul>
          ) : null}
          {(state?.limitations || []).length > 0 ? (
            <ul className="list-disc pr-5 text-[11px] text-slate-400 space-y-1 mt-2">
              {(state?.limitations || []).map((l: string, i: number) => <li key={i}>{l}</li>)}
            </ul>
          ) : null}
        </Card>
      ) : null}

      <p className="text-[11px] text-slate-500">{state?.note || 'الحالة التجارية الحقيقية — قراءة فقط بلا أسرار.'}</p>
    </div>
  );
};

export default CommercialBrainView;
