import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiService } from '../../services/api';
import AgentTeamCenter from './AgentTeamCenter';
import CentralBrainCognitionPanel from './CentralBrainCognitionPanel';

/**
 * العقل المركزي العام (Batch 26): طبقة ذكاء محتوى وتعلّم وتوصيات تغطي كل
 * المنصات العشر. عرض فقط + تخطيط حتمي — لا نشر ولا استهلاك AI ولا أي سرّ.
 * القيم كلها من الخادم؛ غير المتاح يُعلن صراحةً ولا يُخترع.
 */

const ALL_PLATFORMS = ['tiktok', 'youtube', 'facebook', 'instagram', 'whatsapp', 'telegram', 'google_business', 'x', 'snapchat', 'threads'];

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'تيك توك',
  youtube: 'يوتيوب',
  facebook: 'فيسبوك',
  instagram: 'إنستغرام',
  whatsapp: 'واتساب',
  telegram: 'تليغرام',
  google_business: 'Google Business',
  x: 'X (تويتر)',
  snapchat: 'سناب شات',
  threads: 'ثريدز',
};

const Card: React.FC<{ title: string; children: React.ReactNode; hint?: string }> = ({ title, children, hint }) => (
  <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
    <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-3 mb-4">{title}</h3>
    {children}
    {hint ? <p className="text-[11px] text-slate-500 mt-3">{hint}</p> : null}
  </div>
);

export const CentralBrainView: React.FC = () => {
  const { showToast } = useApp();
  const [loading, setLoading] = useState(false);
  const [diag, setDiag] = useState<any>(null);
  const [learning, setLearning] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<any>(null);
  const [audience, setAudience] = useState<any>(null);

  const [planForm, setPlanForm] = useState({ productName: '', productId: '', objective: '', extraInstructions: '' });
  const [plan, setPlan] = useState<any>(null);

  const [commentForm, setCommentForm] = useState<{ platform: string; text: string }>({ platform: 'tiktok', text: '' });
  const [commentResult, setCommentResult] = useState<any>(null);

  // طبقة العقل المُطوَّرة (Central Brain upgrade): قراءة/تحليل فقط.
  const [brainState, setBrainState] = useState<any>(null);
  const [brainCaps, setBrainCaps] = useState<any>(null);
  const [brainDryRun, setBrainDryRun] = useState<any>(null);
  // وقت تشغيل العقل 24/7 (Batch 5): للمالك فقط (يظهر فقط عند نجاح القراءة).
  const [runtime, setRuntime] = useState<any>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [d, l, r, a, bs, bc] = await Promise.all([
        apiService.getBrainDiagnostics(),
        apiService.getBrainLearning(),
        apiService.getBrainRecommendations(),
        apiService.getBrainAudience(),
        apiService.getBrainState(),
        apiService.getBrainCapabilities(),
      ]);
      setDiag(d); setLearning(l.learning); setRecommendations(r.recommendations); setAudience(a.audience);
      setBrainState(bs.state); setBrainCaps(bc.rows);
      // وقت التشغيل للمالك فقط؛ فشله لا يُسقط بقية اللوحة.
      try { const rt = await apiService.getBrainRuntime(); setRuntime(rt.runtime); } catch { setRuntime(null); }
    } catch (e: any) {
      showToast(e?.message || 'تعذر تحميل بيانات العقل المركزي.');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const runRuntimeNow = async () => {
    setLoading(true);
    try {
      const res = await apiService.runBrainRuntimeCycle();
      setRuntime(res.runtime);
      const label = res.runtime?.lastStatusLabelAr || res.result?.status || '';
      showToast(`دورة العقل: ${label}${res.result?.newMemoryRecords ? ` — سجلات جديدة: ${res.result.newMemoryRecords}` : ''}`);
    } catch (e: any) {
      showToast(e?.message || 'تعذر تشغيل دورة العقل.');
    } finally {
      setLoading(false);
    }
  };

  const loadDryRun = async () => {
    setLoading(true);
    try {
      const res = await apiService.getBrainDryRun();
      setBrainDryRun(res.report);
    } catch (e: any) {
      showToast(e?.message || 'تعذر جلب سيناريو dry-run.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [loadAll]);

  const buildPlan = async () => {
    if (!planForm.productName.trim() && !planForm.productId.trim()) {
      showToast('أدخل اسم المنتج أو معرّفه لبناء خطة حقيقية بلا اختراع.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiService.buildBrainContentPlan({
        productName: planForm.productName.trim() || undefined,
        productId: planForm.productId.trim() || undefined,
        objective: planForm.objective.trim() || undefined,
        extraInstructions: planForm.extraInstructions.trim() || undefined,
      });
      setPlan(res.plan);
    } catch (e: any) {
      showToast(e?.message || 'تعذر بناء الخطة.');
    } finally {
      setLoading(false);
    }
  };

  const analyzeComment = async () => {
    if (!commentForm.text.trim()) { showToast('أدخل نص التعليق للتحليل.'); return; }
    setLoading(true);
    try {
      const res = await apiService.analyzeBrainComment({ platform: commentForm.platform, text: commentForm.text.trim() });
      setCommentResult(res);
    } catch (e: any) {
      showToast(e?.message || 'تعذر تحليل التعليق.');
    } finally {
      setLoading(false);
    }
  };

  const platforms: any[] = diag?.platforms || [];
  const byPlatform: any[] = learning?.byPlatform || [];

  return (
    <div className="space-y-5">
      <header className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-black text-white">العقل المركزي — ذكاء المحتوى والتعلّم متعدد المنصات</h1>
          <p className="text-xs text-slate-400 mt-1.5">
            طبقة واحدة محايدة المنصة تخدم كل المنصات العشر والموصلات الحالية والمستقبلية. قراءة وتخطيط حتمي — لا نشر، ولا استهلاك AI، ولا اختراع بيانات.
          </p>
        </div>
        <button onClick={loadAll} disabled={loading}
          className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold hover:bg-slate-700 disabled:opacity-50">
          {loading ? '... جارٍ التحديث' : 'تحديث'}
        </button>
      </header>

      <Card title="حالة العقل" hint="القراءات حتمية بالكامل؛ لا تستهلك حصة Gemini.">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <Stat label="منصات مغطّاة" value={diag?.platforms?.length ?? '—'} />
          <Stat label="منصات متصلة" value={diag?.connectedPlatformIds?.length ?? '—'} />
          <Stat label="سجلات أداء للتعلّم" value={learning?.totalSamples ?? 0} />
          <Stat label="نداءات Gemini (قراءة)" value={diag?.ai?.providerCalls ?? 0} />
        </div>
        {diag?.limitations?.length ? (
          <ul className="mt-4 text-[11px] text-amber-300/90 list-disc pr-4 space-y-1">
            {diag.limitations.map((l: string, i: number) => <li key={i}>{l}</li>)}
          </ul>
        ) : null}
      </Card>

      {runtime ? (
        <Card title="وقت تشغيل العقل 24/7" hint="مُشغِّل داخلي على الخادم: تحليل/تعلّم/حفظ ذاكرة — بلا متصفح، وبلا أي إجراء خارجي، وبلا استهلاك Gemini.">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Stat label="الحالة" value={runtime.statusLabelAr ?? runtime.status ?? '—'} />
            <Stat label="الإيقاع (دقائق)" value={runtime.intervalMinutes ?? '—'} />
            <Stat label="دورات" value={runtime.cycleCount ?? 0} />
            <Stat label="نجاح" value={runtime.successCount ?? 0} />
            <Stat label="لا بيانات" value={runtime.noDataCount ?? 0} />
            <Stat label="متخطّاة (قفل)" value={runtime.skippedLockedCount ?? 0} />
            <Stat label="سجلات ذاكرة تراكمية" value={runtime.totalNewMemoryRecords ?? 0} />
            <Stat label="آخر تشغيل" value={runtime.lastCycleCompletedAt ? new Date(runtime.lastCycleCompletedAt).toLocaleString('ar-IQ') : '—'} />
          </div>
          <div className="mt-3 text-[11px] text-slate-400 space-y-1">
            <div>القفل: {runtime.lockHeld ? 'مُحتجَز الآن' : 'حر'} {runtime.lockStale ? '(متقادم — يُستردّ)' : ''}</div>
            <div>آخر خطأ: {runtime.lastError ? <span className="text-amber-300">{runtime.lastError}</span> : 'لا يوجد'}</div>
            <div>إجراءات خارجية: {runtime.executesExternalActions ? 'نعم' : 'لا'} · استهلاك Gemini في الدورات: {runtime.geminiUsedOnCycles ? 'نعم' : 'لا'}</div>
          </div>
          <button onClick={runRuntimeNow} disabled={loading}
            className="mt-4 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold">
            تشغيل دورة الآن (تشخيص)
          </button>
        </Card>
      ) : null}

      <Card title="مصفوفة قدرات المنصات" hint="Capability ≠ Connection ≠ Verification — «متصل» تُقرأ من الخادم منفصلة.">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-slate-300">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800">
                <th className="text-right py-2 px-2">المنصة</th>
                <th className="py-2 px-2">نشر</th>
                <th className="py-2 px-2">قراءة تعليقات</th>
                <th className="py-2 px-2">رد تعليق</th>
                <th className="py-2 px-2">موصل حقيقي</th>
                <th className="py-2 px-2">مؤشرات متاحة</th>
              </tr>
            </thead>
            <tbody>
              {platforms.map((p) => (
                <tr key={p.platform} className="border-b border-slate-800/50">
                  <td className="text-right py-2 px-2 font-bold text-white">{PLATFORM_LABELS[p.platform] || p.platform}</td>
                  <td className="text-center py-2 px-2">{p.publishes ? '✓' : '—'}</td>
                  <td className="text-center py-2 px-2">{p.readsComments ? '✓' : 'غير متاح'}</td>
                  <td className="text-center py-2 px-2">{p.repliesToComments ? '✓' : 'غير متاح'}</td>
                  <td className="text-center py-2 px-2">{p.realConnector ? '✓' : 'أساس فقط'}</td>
                  <td className="text-center py-2 px-2 text-slate-400">{Array.isArray(p.availableMetrics) ? p.availableMetrics.join('، ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="التعلّم لكل منصة" hint="المؤشرات غير المتاحة تُعلن صراحةً ولا تُخترع قيمتها.">
          {byPlatform.length ? (
            <ul className="space-y-2 text-xs">
              {byPlatform.map((s) => (
                <li key={s.platform} className="flex items-center justify-between border-b border-slate-800/50 pb-2">
                  <span className="text-slate-300">{PLATFORM_LABELS[s.platform] || s.platform}</span>
                  <span className={s.sufficientSample ? 'text-emerald-300' : 'text-amber-300'}>
                    عيّنة {s.sampleSize} — {s.sufficientSample ? 'كافية' : 'غير كافية'}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-slate-500">لا سجلات أداء حقيقية بعد؛ لا يُستنتج شيء بلا بيانات.</p>}
        </Card>

        <Card title="توصيات العقل" hint="كل توصية قابلة للتفسير: سبب + مصدر + عيّنة + حدود.">
          {recommendations?.recommendations?.length ? (
            <ul className="space-y-3 text-xs">
              {recommendations.recommendations.map((r: any, i: number) => (
                <li key={i} className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="font-bold text-white">{r.title || r.kind}</div>
                  <div className="text-slate-400 mt-1">{r.reason}</div>
                  <div className="text-[10px] text-slate-500 mt-1">الثقة: {r.confidence} • العيّنة: {r.sampleSize ?? 0}</div>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-slate-500">{recommendations?.note || 'لا توصيات بلا بيانات أداء فعلية كافية.'}</p>}
        </Card>
      </div>

      <Card title="تحليل الجمهور" hint="لا تُستنتج سمات شخصية حساسة (عمر/جنس/موقع) بلا مصدر رسمي.">
        {audience ? (
          <div className="text-xs text-slate-300 space-y-2">
            <div className="text-amber-300/90">{audience.note}</div>
            {Array.isArray(audience.platforms) ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {audience.platforms.map((a: any) => (
                  <div key={a.platform} className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="font-bold text-white">{PLATFORM_LABELS[a.platform] || a.platform}</div>
                    <div className="text-[10px] text-slate-500">نقاط تفاعل: {a.engagementPoints ?? '—'}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : <p className="text-xs text-slate-500">لا بيانات جمهور.</p>}
      </Card>

      <Card title="خطة محتوى عامة (كل المنصات)" hint="حتمية بلا AI: تكييف لكل منصة من بيانات المنتج/المعرض الحقيقية فقط.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <input className="bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm"
            placeholder="اسم المنتج" value={planForm.productName}
            onChange={(e) => setPlanForm({ ...planForm, productName: e.target.value })} />
          <input className="bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm"
            placeholder="معرّف المنتج (اختياري)" value={planForm.productId}
            onChange={(e) => setPlanForm({ ...planForm, productId: e.target.value })} />
          <input className="bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm"
            placeholder="هدف الحملة (اختياري)" value={planForm.objective}
            onChange={(e) => setPlanForm({ ...planForm, objective: e.target.value })} />
          <input className="bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm"
            placeholder="تعليمات إضافية (اختياري)" value={planForm.extraInstructions}
            onChange={(e) => setPlanForm({ ...planForm, extraInstructions: e.target.value })} />
        </div>
        <button onClick={buildPlan} disabled={loading}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white text-xs font-bold">
          بناء الخطة
        </button>

        {plan ? (
          <div className="mt-4 space-y-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
              <div className="font-bold text-white">{plan.title}</div>
              <div className="text-slate-400 mt-1 whitespace-pre-wrap">{plan.description}</div>
              <div className="text-[10px] text-slate-500 mt-2">
                الثقة: {plan.confidence} • {plan.schedulingReason} • يتطلب مراجعة بشرية: {plan.requiresHumanReview ? 'نعم' : 'لا'}
              </div>
              {plan.limitations?.length ? (
                <ul className="mt-2 text-[10px] text-amber-300/90 list-disc pr-4">
                  {plan.limitations.map((l: string, i: number) => <li key={i}>{l}</li>)}
                </ul>
              ) : null}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(plan.platformAdaptations || []).map((a: any) => (
                <div key={a.platform} className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white">{PLATFORM_LABELS[a.platform] || a.platform}</span>
                    <span className={a.withinLimit ? 'text-emerald-300' : 'text-rose-300'}>{a.withinLimit ? 'داخل الحد' : 'يتجاوز الحد'}</span>
                  </div>
                  <div className="text-slate-400 mt-1 whitespace-pre-wrap">{a.caption}</div>
                  {a.hashtags?.length ? <div className="text-[10px] text-blue-300 mt-1">{a.hashtags.join(' ')}</div> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      <Card title="تحليل تعليق (سياسة موحّدة)" hint="حتمي بلا AI. المنصة التي لا توفّر تعليقات تُعلن unsupported بلا ادعاء رد.">
        <div className="flex flex-wrap gap-3 mb-3">
          <select className="bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm"
            value={commentForm.platform} onChange={(e) => setCommentForm({ ...commentForm, platform: e.target.value })}>
            {ALL_PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p] || p}</option>)}
          </select>
          <input className="flex-1 min-w-[200px] bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm"
            placeholder="نص التعليق" value={commentForm.text}
            onChange={(e) => setCommentForm({ ...commentForm, text: e.target.value })} />
          <button onClick={analyzeComment} disabled={loading}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white text-xs font-bold">
            تحليل
          </button>
        </div>
        {commentResult ? (
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
            <div className="text-slate-300">التصنيف: <span className="text-white font-bold">{commentResult.classification}</span> • الأولوية: <span className="text-white font-bold">{commentResult.priority}</span></div>
            <div className="text-slate-400">القرار: {commentResult.decision} • يقرأ النظام تعليقات المنصة: {commentResult.platformReadsComments ? 'نعم' : 'لا (غير متاح)'}</div>
            <div className="text-slate-400">{commentResult.reason}</div>
            {commentResult.proposedReply ? (
              <div className="text-emerald-300 mt-1">رد مقترح: {commentResult.proposedReply}</div>
            ) : <div className="text-amber-300 mt-1">لا رد مقترح (يتطلب مراجعة بشرية أو المنصة لا تدعم الرد).</div>}
          </div>
        ) : null}
      </Card>

      <Card title="مصفوفة قدرات المنصات العشر (خمس حالات صريحة)" hint="مشتقة من سجل المنصات؛ القدرة غير المنفّذة = NOT_AVAILABLE صراحةً. لا قدرة مُختلقة.">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-slate-500 text-right">
                <th className="p-2">المنصة</th>
                <th className="p-2">الاتصال</th>
                <th className="p-2">القراءة</th>
                <th className="p-2">التعليقات</th>
                <th className="p-2">الرد</th>
                <th className="p-2">النشر</th>
                <th className="p-2">التحليلات</th>
                <th className="p-2">الجمهور</th>
                <th className="p-2">الموقع</th>
              </tr>
            </thead>
            <tbody>
              {(brainCaps || []).map((row: any) => {
                const cell = (v: string) => {
                  const map: Record<string, string> = { AVAILABLE: 'text-emerald-300', PARTIAL: 'text-amber-300', REQUIRES_REVIEW: 'text-amber-300', OWNER_ONLY: 'text-blue-300', NOT_AVAILABLE: 'text-slate-600' };
                  const label: Record<string, string> = { AVAILABLE: 'متاحة', PARTIAL: 'جزئية', REQUIRES_REVIEW: 'مراجعة', OWNER_ONLY: 'مالك', NOT_AVAILABLE: 'غير متاحة' };
                  return <span className={map[v] || 'text-slate-400'}>{label[v] || v}</span>;
                };
                return (
                  <tr key={row.platform} className="border-t border-slate-800 text-slate-300">
                    <td className="p-2 font-bold text-white">{PLATFORM_LABELS[row.platform] || row.platform}{row.realConnector ? <span className="text-[9px] text-emerald-400 mr-1"> • موصل حقيقي</span> : null}</td>
                    <td className="p-2">{cell(row.states.connection)}</td>
                    <td className="p-2">{cell(row.states.read)}</td>
                    <td className="p-2">{cell(row.states.comments)}</td>
                    <td className="p-2">{cell(row.states.reply)}</td>
                    <td className="p-2">{cell(row.states.publish)}</td>
                    <td className="p-2">{cell(row.states.analytics)}</td>
                    <td className="p-2">{cell(row.states.audience)}</td>
                    <td className="p-2">{cell(row.states.geography)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="صحة العقل وصناديق الصدق" hint="أعداد حالات المعرفة وطزاجة الإشارات والقرارات المعلّقة — بلا أي سرّ.">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <Stat label="حالة العقل" value={brainState?.signalFreshness?.fresh > 0 || (brainState?.knowledge?.verifiedCount || 0) > 0 ? 'نشط' : 'محدود'} />
          <Stat label="حقائق موثّقة" value={brainState?.knowledge?.verifiedCount ?? 0} />
          <Stat label="استنتاجات" value={brainState?.knowledge?.derivedCount ?? 0} />
          <Stat label="فرضيات" value={brainState?.knowledge?.hypothesisCount ?? 0} />
          <Stat label="مجهول" value={brainState?.knowledge?.unknownCount ?? 0} />
          <Stat label="غير متاح" value={brainState?.knowledge?.unavailableCount ?? 0} />
          <Stat label="يحتاج المالك" value={brainState?.knowledge?.humanInputRequiredCount ?? 0} />
          <Stat label="قرارات معلّقة" value={brainState?.pendingDecisions?.length ?? 0} />
          <Stat label="إشارات طازجة" value={brainState?.signalFreshness?.fresh ?? 0} />
          <Stat label="إشارات قديمة" value={brainState?.signalFreshness?.stale ?? 0} />
          <Stat label="مقاطع جمهور" value={brainState?.audience?.segments?.length ?? 0} />
          <Stat label="دليل تجاري" value={brainState?.market?.hasCommercialEvidence ? 'موجود' : 'لا يوجد'} />
        </div>
        {brainState?.audience?.demographicsAvailable === false ? (
          <p className="text-[11px] text-amber-300/90 mt-3">
            السمات السكانية (عمر/جنس/مدينة/دخل) غير متاحة عبر الواجهات الرسمية الحالية — معلنة صراحةً ولا تُستنتج.
          </p>
        ) : null}
      </Card>

      <Card title="سيناريو تجريبي (Dry-run) — يتوقف قبل أي إجراء خارجي" hint="يثبت أن العقل يدرك ويحلّل ويوصي ثم يتوقف: لا نشر ولا رد ولا جدولة.">
        <button onClick={loadDryRun} disabled={loading}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white text-xs font-bold mb-3">
          تشغيل السيناريو التجريبي
        </button>
        {brainDryRun ? (
          <div className="space-y-3 text-xs">
            <div className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-800 text-emerald-200">
              تم التنفيذ التحليلي فقط — لا إجراء خارجي: {brainDryRun.externalActionTaken === false ? 'مؤكد' : 'تحذير'}
            </div>
            {[
              ['ما أعرفه', brainDryRun.whatIKnow],
              ['ما أستنتجه', brainDryRun.whatIInfer],
              ['ما أجهله', brainDryRun.whatIDontKnow],
              ['ما أوصي به', brainDryRun.whatIRecommend],
              ['لماذا', brainDryRun.why],
              ['ما سأختبره', brainDryRun.whatIWouldTest],
              ['ما يحتاج موافقة المالك', brainDryRun.whatRequiresOwnerApproval],
            ].map(([label, list]: any) => (
              <div key={label} className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="font-bold text-white mb-1">{label}</div>
                {list?.length ? (
                  <ul className="text-slate-300 list-disc pr-4 space-y-0.5">{list.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
                ) : <div className="text-slate-500">لا عناصر.</div>}
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <p className="text-[11px] text-slate-500 px-1">
        هذا السطح عرض/تخطيط فقط. أي نشر أو رد خارجي يمر عبر بوابات المنصة الفعلية (Capability → Connection → Verification → Safety) ولا يُعلن التسليم إلا بإثبات المزود.
      </p>

      <Card title="فريق الوكلاء (Agent Team)" hint="فريق تفكير داخلي ينسّقه العقل المركزي: بحث → تحليل → استراتيجية → نقد → قرار. قرار مقترح فقط — لا تنفيذ خارجي.">
        <AgentTeamCenter />
      </Card>

      <Card title="إدراك العقل المركزي (Cognition)" hint="إدراك → فهم → تذكّر → استدلال → مشورة → تخطيط → نقد → قرار → إجراء → ملاحظة → تعلّم. قراءة فقط، بلا تنفيذ خارجي.">
        <CentralBrainCognitionPanel />
      </Card>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
    <div className="text-[10px] text-slate-500">{label}</div>
    <div className="text-lg font-black text-white mt-0.5">{value}</div>
  </div>
);

export default CentralBrainView;
