import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiService } from '../../services/api';
import {
  MarketingGoal,
  SocialPlatformId,
  MarketingCampaignCreationResult,
  MarketingCampaignDetail,
  MarketingCampaignSummary,
  MarketingCampaignStatus,
  MarketingPlatformResource,
} from '../../types';
import {
  Layers,
  ListChecks,
  AlertTriangle,
  Package,
  RefreshCw,
  ShieldAlert,
  Link2Off,
  CheckCircle2,
  FileText,
} from 'lucide-react';

const GOALS: Array<{ id: MarketingGoal; label: string }> = [
  { id: 'offer', label: 'عرض سعر وتقسيط' },
  { id: 'product_intro', label: 'تعريف بمنتج' },
  { id: 'installment_terms', label: 'شروط التقسيط' },
  { id: 'trust_builder', label: 'بناء الثقة' },
  { id: 'follow_up', label: 'متابعة وتذكير' },
];

const CAMPAIGN_STATUS_LABELS: Record<MarketingCampaignStatus, string> = {
  draft: 'مسودة',
  active: 'نشطة',
  completed: 'مكتملة',
  archived: 'مؤرشفة',
};

const MAX_PRODUCTS = 10;
const MAX_DRAFTS = 80;

const formatIqd = (value: number) => `${Math.round(value).toLocaleString('en-US')} د.ع`;

export const MarketingCampaignPanel: React.FC = () => {
  const { products, platforms, showToast, setActiveTab, refreshWorkspace } = useApp();

  const [name, setName] = useState<string>('');
  const [task, setTask] = useState<string>('');
  const [goal, setGoal] = useState<MarketingGoal>('offer');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<SocialPlatformId[]>(['facebook']);
  const [downPaymentPercent, setDownPaymentPercent] = useState<string>('');
  const [durationMonths, setDurationMonths] = useState<string>('');
  const [createDrafts, setCreateDrafts] = useState<boolean>(true);

  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [creation, setCreation] = useState<MarketingCampaignCreationResult | null>(null);
  const [campaigns, setCampaigns] = useState<MarketingCampaignSummary[]>([]);
  const [detail, setDetail] = useState<MarketingCampaignDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isLoadingList, setIsLoadingList] = useState<boolean>(false);

  const loadCampaigns = async () => {
    setIsLoadingList(true);
    try {
      setCampaigns(await apiService.listMarketingCampaigns(20));
    } catch (err: any) {
      setErrorMessage(err?.message || 'تعذر جلب الحملات.');
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, []);

  const toggleProduct = (id: string) => {
    setSelectedProducts((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_PRODUCTS) {
        showToast(`الحد الأقصى ${MAX_PRODUCTS} منتجات في الحملة الواحدة.`);
        return prev;
      }
      return [...prev, id];
    });
  };

  const togglePlatform = (id: SocialPlatformId) => {
    setSelectedPlatforms((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const monthsNumber = durationMonths.trim() ? Number(durationMonths) : undefined;
  const downNumber = downPaymentPercent.trim() ? Number(downPaymentPercent) : undefined;

  const validationErrors: string[] = [];
  if (name.trim().length < 3) validationErrors.push('اكتب اسم الحملة (3 أحرف على الأقل).');
  if (task.trim().length < 3) validationErrors.push('اكتب مهمة الحملة (3 أحرف على الأقل).');
  if (!selectedProducts.length) validationErrors.push('اختر منتجاً واحداً على الأقل من قاعدة بيانات المعرض.');
  if (!selectedPlatforms.length) validationErrors.push('اختر منصة واحدة على الأقل.');
  if (monthsNumber !== undefined && (!Number.isInteger(monthsNumber) || monthsNumber < 1 || monthsNumber > 60)) validationErrors.push('مدة الأقساط يجب أن تكون بين 1 و60 شهراً.');
  if (downNumber !== undefined && (!Number.isFinite(downNumber) || downNumber < 0 || downNumber > 99)) validationErrors.push('نسبة الدفعة الأولى يجب أن تكون بين 0 و99.');
  const projectedDrafts = selectedProducts.length * selectedPlatforms.length;
  if (projectedDrafts > MAX_DRAFTS) validationErrors.push(`عدد المسودات كبير جداً (${projectedDrafts}). الحد الأقصى ${MAX_DRAFTS}.`);

  const handleCreate = async () => {
    if (validationErrors.length) {
      setErrorMessage(validationErrors[0]);
      return;
    }
    setIsCreating(true);
    setErrorMessage('');
    setDetail(null);
    try {
      const res = await apiService.createMarketingCampaign({
        name: name.trim(),
        task: task.trim(),
        goal,
        productIds: selectedProducts,
        platforms: selectedPlatforms,
        downPaymentPercent: downNumber,
        durationMonths: monthsNumber,
        createDrafts,
      });
      setCreation(res);
      if (createDrafts && res.draftsCount) await refreshWorkspace();
      await loadCampaigns();
      showToast(
        createDrafts
          ? `تم إنشاء الحملة و${res.draftsCount} مسودة مرتبطة بمسار المراجعة والاعتماد.`
          : 'تم إنشاء الحملة بالمحرك الحتمي دون إنشاء مسودات.'
      );
    } catch (err: any) {
      setErrorMessage(err?.message || 'تعذر إنشاء الحملة.');
    } finally {
      setIsCreating(false);
    }
  };

  const openDetail = async (id: string) => {
    try {
      setDetail(await apiService.getMarketingCampaign(id));
    } catch (err: any) {
      setErrorMessage(err?.message || 'تعذر جلب تفاصيل الحملة.');
    }
  };

  const changeStatus = async (id: string, status: MarketingCampaignStatus) => {
    try {
      await apiService.updateMarketingCampaignStatus(id, status);
      await loadCampaigns();
      if (detail?.id === id) await openDetail(id);
      showToast('تم تحديث حالة الحملة (لا يوجد أي نشر خارجي).');
    } catch (err: any) {
      setErrorMessage(err?.message || 'تعذر تحديث حالة الحملة.');
    }
  };

  const resources: MarketingPlatformResource[] = detail?.platformResources || creation?.platformResources || [];
  const summary = detail || creation;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Campaign builder */}
      <div className="lg:col-span-5 space-y-5">
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-black text-white">حملة تسويقية صغيرة</h3>
          </div>
          <p className="text-[11px] text-slate-400">
            حملة واحدة على عدة منتجات حقيقية، بمحتوى حتمي لكل منصة ومسودات تدخل مسار المراجعة والاعتماد.
          </p>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">اسم الحملة</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: عروض الأجهزة المنزلية — أيلول"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">هدف الحملة</label>
            <select
              value={goal}
              onChange={(e) => setGoal(e.target.value as MarketingGoal)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
            >
              {GOALS.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">المهمة المطبقة على كل منتج</label>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={3}
              placeholder="مثال: اكتب عرضاً تسويقياً يبرز القسط الشهري والدفعة الأولى ويشجع على التواصل."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-2">
              المنتجات ({selectedProducts.length}/{MAX_PRODUCTS}):
            </label>
            {products.length === 0 ? (
              <p className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-500/30 rounded-xl px-3 py-2">
                لا توجد منتجات في قاعدة بيانات المعرض بعد. أضف منتجات من قاعدة بيانات المعرض أولاً.
              </p>
            ) : (
              <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                {products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => toggleProduct(p.id)}
                    className={`w-full text-right p-2.5 rounded-xl border transition cursor-pointer ${
                      selectedProducts.includes(p.id)
                        ? 'bg-emerald-950/70 border-emerald-500/50'
                        : 'bg-slate-950/70 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    <p className="text-[11px] font-bold text-white">{p.name}</p>
                    <p className="text-[10px] text-slate-400">
                      {formatIqd(p.cashPrice)} • دفعة أولى {p.downPaymentPercent}% • {p.durationMonths} شهر
                      {p.inStock === false ? ' • غير متوفر' : ''}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-2">
              المنصات ({selectedPlatforms.length} مختارة):
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {platforms.map((p) => (
                <button
                  key={p.id}
                  onClick={() => togglePlatform(p.platform)}
                  className={`p-2 rounded-xl text-[11px] font-bold transition cursor-pointer border ${
                    selectedPlatforms.includes(p.platform)
                      ? 'bg-emerald-500 text-slate-950 border-emerald-500'
                      : 'bg-slate-950/70 text-slate-300 border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">الدفعة الأولى (%)</label>
              <input
                type="number"
                min={0}
                max={99}
                value={downPaymentPercent}
                onChange={(e) => setDownPaymentPercent(e.target.value)}
                placeholder="حسب كل منتج"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">مدة الأقساط (شهر)</label>
              <input
                type="number"
                min={1}
                max={60}
                value={durationMonths}
                onChange={(e) => setDurationMonths(e.target.value)}
                placeholder="حسب كل منتج"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">
            إن تركت الحقول فارغة، يُستخدم لكل منتج دفعةُ أوليته ومدته المسجلتان فعلياً في قاعدة البيانات.
          </p>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={createDrafts}
              onChange={(e) => setCreateDrafts(e.target.checked)}
              className="w-4 h-4 accent-emerald-500"
            />
            <span className="text-xs text-slate-300">إنشاء مسودات مرتبطة بمسار المراجعة والاعتماد</span>
          </label>

          {validationErrors.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 space-y-1">
              {validationErrors.map((e) => (
                <p key={e} className="text-[11px] text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {e}
                </p>
              ))}
            </div>
          )}

          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30">
              <p className="text-[11px] text-rose-300">{errorMessage}</p>
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={isCreating || products.length === 0}
            className="w-full py-3 rounded-xl bg-emerald-500 text-slate-950 font-black text-sm hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition cursor-pointer"
          >
            {isCreating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
            {isCreating ? 'جارٍ إنشاء الحملة...' : `إنشاء الحملة (${projectedDrafts} مسودة)`}
          </button>
          <p className="text-[10px] text-slate-500 text-center">
            المحرك حتمي: لا يستدعي Gemini، ولا ينشر خارجياً، ولا يعتبر أي منصة متصلة.
          </p>
        </div>
      </div>

      {/* Results */}
      <div className="lg:col-span-7 space-y-5">
        {summary && (
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-white flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  {summary.name}
                </h3>
                <p className="text-[11px] text-slate-400 mt-1">
                  {summary.goalLabel} • {summary.productsCount} منتجات • {summary.draftsCount} مسودة •{' '}
                  <span className="text-emerald-300">{CAMPAIGN_STATUS_LABELS[summary.status]}</span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {(['draft', 'active', 'completed', 'archived'] as MarketingCampaignStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => changeStatus(summary.id, s)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                    summary.status === s
                      ? 'bg-emerald-500 text-slate-950 border-emerald-500'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-emerald-500/40'
                  }`}
                >
                  {CAMPAIGN_STATUS_LABELS[s]}
                </button>
              ))}
            </div>

            {/* Products in the campaign */}
            <div>
              <p className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-emerald-400" />
                المنتجات الداخلة في الحملة
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(detail?.products || []).length > 0
                  ? detail!.products.map((p) => (
                      <div key={p.id} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                        <p className="text-[11px] font-bold text-white">{p.name}</p>
                        <p className="text-[10px] text-slate-400">
                          {p.cashPrice ? formatIqd(p.cashPrice) : 'لا سعر مسجل'} • {p.inStock === false ? 'غير متوفر' : 'متوفر'}
                        </p>
                      </div>
                    ))
                  : (creation?.productNames || []).map((n) => (
                      <div key={n} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                        <p className="text-[11px] font-bold text-white">{n}</p>
                      </div>
                    ))}
              </div>
            </div>

            {/* Platform resources */}
            {resources.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                  <Link2Off className="w-3.5 h-3.5 text-amber-400" />
                  الموارد المتاحة لكل منصة
                </p>
                <div className="space-y-1.5">
                  {resources.map((r) => (
                    <div key={r.platform} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-bold text-white">{r.name}</p>
                        <p className="text-[10px] text-slate-400">
                          حد النص: {r.textLimit.toLocaleString('en-US')} حرف • القدرات: {r.capabilities.join('، ') || 'غير محددة'}
                        </p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${
                        r.connected
                          ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-900 border-slate-700 text-slate-400'
                      }`}>
                        {r.connected ? 'متصل وموثّق' : 'غير متصل'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tasks */}
            {detail?.tasks && detail.tasks.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                  <ListChecks className="w-3.5 h-3.5 text-emerald-400" />
                  مهام الحملة وحالتها في مسار الاعتماد
                </p>
                <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                  {detail.tasks.map((t) => (
                    <div key={t.id} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-white truncate">{t.title}</p>
                        <p className="text-[10px] text-slate-400">{t.productName} • {t.platform}</p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg border bg-slate-900 border-slate-700 text-slate-300 shrink-0">
                        {t.statusLabel}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setActiveTab('approval')}
                  className="mt-3 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-emerald-500/40 text-xs text-slate-300 hover:text-white flex items-center gap-1.5 transition cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  فتح مركز الموافقات
                </button>
              </div>
            )}

            {/* Warnings */}
            {summary.warnings && summary.warnings.length > 0 && (
              <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 space-y-1">
                <p className="text-[11px] font-bold text-amber-300 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  ملاحظات على بيانات الحملة
                </p>
                {summary.warnings.map((w) => (
                  <p key={w} className="text-[10px] text-amber-200/90">{w}</p>
                ))}
              </div>
            )}

            <p className="text-[10px] text-slate-500">
              الحملة سجل محلي فقط. لا يوجد أي نشر خارجي في هذه المرحلة، وأي منصة تظهر «غير متصلة» تحتاج بيانات مزود فعلية.
            </p>
          </div>
        )}

        {/* Campaign list */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-white">سجل الحملات ({campaigns.length})</h3>
            <button
              onClick={loadCampaigns}
              className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingList ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {campaigns.length === 0 ? (
            <p className="text-[11px] text-slate-500">لا توجد حملات بعد. أنشئ أول حملة من النموذج المجاور.</p>
          ) : (
            <div className="space-y-1.5">
              {campaigns.map((c) => (
                <button
                  key={c.id}
                  onClick={() => openDetail(c.id)}
                  className={`w-full text-right p-3 rounded-xl border transition cursor-pointer ${
                    detail?.id === c.id
                      ? 'bg-emerald-950/50 border-emerald-500/40'
                      : 'bg-slate-950 border-slate-800 hover:border-emerald-500/30'
                  }`}
                >
                  <p className="text-[11px] font-bold text-white">{c.name}</p>
                  <p className="text-[10px] text-slate-400">
                    {c.goalLabel} • {c.productsCount} منتجات • {c.draftsCount} مسودة • {CAMPAIGN_STATUS_LABELS[c.status]}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};