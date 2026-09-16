import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiService } from '../../services/api';
import { MarketingCampaignPanel } from './MarketingCampaignPanel';
import {
  MarketingBriefResult,
  MarketingGoal,
  SocialPlatformId,
} from '../../types';
import {
  Bot,
  Sparkles,
  Copy,
  Save,
  AlertTriangle,
  CheckCircle2,
  Package,
  Calculator,
  RefreshCw,
  FileText,
  Layers,
} from 'lucide-react';

const GOALS: Array<{ id: MarketingGoal; label: string; hint: string }> = [
  { id: 'offer', label: 'عرض سعر وتقسيط', hint: 'إبراز سعر الكاش والقسط الشهري' },
  { id: 'product_intro', label: 'تعريف بمنتج', hint: 'تعريف مختصر بالمواصفات' },
  { id: 'installment_terms', label: 'شروط التقسيط', hint: 'المستندات والخطوات' },
  { id: 'trust_builder', label: 'بناء الثقة', hint: 'وضوح الإجراءات والمتابعة' },
  { id: 'follow_up', label: 'متابعة وتذكير', hint: 'تذكير بعرض قائم' },
];

const QUICK_TASKS = [
  'اكتب عرضاً تسويقياً يبرز القسط الشهري والدفعة الأولى لهذا المنتج.',
  'اكتب تعريفاً موجزاً بالمنتج مع دعوة واضحة للتواصل.',
  'وضّح خطوات وشروط التقسيط بشكل مبسط دون وعود غير مؤكدة.',
  'اكتب رسالة متابعة مهذبة لعملاء سبق أن استفسروا عن هذا المنتج.',
];

const formatIqd = (value: number) => `${Math.round(value).toLocaleString('en-US')} د.ع`;

export const MarketingAgentView: React.FC = () => {
  const { products, platforms, showroomInfo, createPost, showToast, setActiveTab, currentUser, refreshWorkspace } = useApp();

  const [mode, setMode] = useState<'single' | 'campaign'>('single');

  const [task, setTask] = useState<string>('');
  const [goal, setGoal] = useState<MarketingGoal>('offer');
  const [productId, setProductId] = useState<string>('');
  const [manualProductName, setManualProductName] = useState<string>('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<SocialPlatformId[]>(['facebook']);
  const [tone, setTone] = useState<string>('احترافية ومباشرة موجهة لعملاء التقسيط');
  const [downPaymentPercent, setDownPaymentPercent] = useState<string>('');
  const [durationMonths, setDurationMonths] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saveDrafts, setSaveDrafts] = useState<boolean>(false);

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [result, setResult] = useState<MarketingBriefResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [activePlatform, setActivePlatform] = useState<string>('');

  const selectedProduct = products.find((p) => p.id === productId);
  const effectiveProductName = selectedProduct?.name || manualProductName.trim();

  const togglePlatform = (id: SocialPlatformId) => {
    setSelectedPlatforms((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const validationErrors: string[] = [];
  if (task.trim().length < 3) validationErrors.push('اكتب مهمة واضحة (3 أحرف على الأقل).');
  if (!effectiveProductName) validationErrors.push('اختر منتجاً من قاعدة البيانات أو اكتب اسم المنتج.');
  if (!selectedPlatforms.length) validationErrors.push('اختر منصة واحدة على الأقل.');
  const monthsNumber = durationMonths.trim() ? Number(durationMonths) : undefined;
  if (monthsNumber !== undefined && (!Number.isInteger(monthsNumber) || monthsNumber < 1 || monthsNumber > 60)) validationErrors.push('مدة الأقساط يجب أن تكون بين 1 و60 شهراً.');
  const downNumber = downPaymentPercent.trim() ? Number(downPaymentPercent) : undefined;
  if (downNumber !== undefined && (!Number.isFinite(downNumber) || downNumber < 0 || downNumber > 99)) validationErrors.push('نسبة الدفعة الأولى يجب أن تكون بين 0 و99.');

  const handleRun = async () => {
    if (validationErrors.length) {
      setErrorMessage(validationErrors[0]);
      return;
    }
    setIsRunning(true);
    setErrorMessage('');
    try {
      const res = await apiService.createMarketingBrief({
        task: task.trim(),
        goal,
        productId: productId || undefined,
        productName: productId ? undefined : manualProductName.trim(),
        platforms: selectedPlatforms,
        tone,
        downPaymentPercent: downNumber,
        durationMonths: monthsNumber,
        notes: notes.trim() || undefined,
        saveDrafts,
      });
      setResult(res);
      setActivePlatform(res.content[0]?.platform || '');
      showToast(
        res.savedPostIds.length
          ? `تم إنشاء المحتوى وحفظ ${res.savedPostIds.length} مسودة في مركز المحتوى.`
          : 'تم إنشاء المحتوى التسويقي بالمحرك المحلي دون استهلاك Gemini.'
      );
    } catch (err: any) {
      setErrorMessage(err?.message || 'تعذر تنفيذ مهمة المحتوى.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleSaveOneAsDraft = (platform: string) => {
    if (!result) return;
    const piece = result.content.find((c) => c.platform === platform);
    if (!piece) return;
    createPost({
      title: piece.headline || `عرض ${result.product.name}`,
      content: [piece.headline, piece.body, piece.callToAction, piece.hashtags.join(' ')].filter(Boolean).join('\n\n'),
      platformVersions: { [platform]: piece.headline ? `${piece.headline}\n\n${piece.body}` : piece.body },
      targetPlatforms: [platform],
      mediaUrl: selectedProduct?.image,
      mediaType: undefined,
      status: 'draft',
      authorName: currentUser.name,
      authorRole: currentUser.role,
      tags: ['تقسيط_منتجات', 'معرض_الغرابي', platform],
    });
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('تم نسخ المحتوى إلى الحافظة.');
    } catch {
      showToast('تعذر النسخ التلقائي. يمكنك تحديد النص ونسخه يدوياً.');
    }
  };

  const activePiece = result?.content.find((c) => c.platform === activePlatform) || result?.content[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-gradient-to-l from-slate-900 via-slate-900 to-emerald-950/40 border border-emerald-500/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 text-xs font-bold mb-2">
            <Bot className="w-4 h-4 text-emerald-400" />
            وكيل الغرابي الذكي — مهام المحتوى
          </div>
          <h2 className="text-xl font-black text-white">أعطِ الوكيل مهمة واحصل على محتوى تسويقي عربي جاهز</h2>
          <p className="text-xs text-slate-300 mt-0.5">
            المحرك حتمي بالكامل: يعمل من بيانات المعرض الحقيقية، ولا يحتاج أي حساب اجتماعي متصل، ولا يستهلك Gemini.
          </p>
        </div>
        <span className="text-xs bg-slate-950/80 border border-slate-700 text-slate-300 px-3 py-1.5 rounded-xl font-semibold flex items-center gap-1.5">
          <Calculator className="w-3.5 h-3.5 text-emerald-400" />
          الأسعار بالدينار العراقي (د.ع)
        </span>
      </div>

      {/* Mode switch: single task vs small campaign */}
      <div className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-slate-900 border border-slate-800 w-fit">
        <button
          onClick={() => setMode('single')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
            mode === 'single' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:text-white'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          مهمة واحدة
        </button>
        <button
          onClick={() => setMode('campaign')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
            mode === 'campaign' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:text-white'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          حملة على عدة منتجات
        </button>
      </div>

      {mode === 'campaign' && <MarketingCampaignPanel />}

      {mode === 'single' && (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Brief form */}
        <div className="lg:col-span-5 space-y-5">
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            {/* 1. Task */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-2">1. المهمة المطلوبة من الوكيل:</label>
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                rows={3}
                placeholder="مثال: اكتب عرضاً تسويقياً يبرز القسط الشهري والدفعة الأولى ويشجع على التواصل."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 resize-none"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {QUICK_TASKS.map((q) => (
                  <button
                    key={q}
                    onClick={() => setTask(q)}
                    className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[10px] text-slate-400 hover:text-white hover:border-emerald-500/40 transition cursor-pointer"
                  >
                    {q.slice(0, 34)}…
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Goal */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-2">2. الهدف التسويقي:</label>
              <div className="grid grid-cols-2 gap-2">
                {GOALS.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setGoal(g.id)}
                    className={`p-2.5 rounded-xl text-right transition cursor-pointer border ${
                      goal === g.id
                        ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-200'
                        : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <p className="text-xs font-bold">{g.label}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{g.hint}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Product */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-2">3. المنتج:</label>
              {products.length > 0 ? (
                <select
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="">— بدون منتج من القاعدة (اكتب الاسم يدوياً) —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatIqd(p.cashPrice)}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-500/30 rounded-xl px-3 py-2">
                  لا توجد منتجات في قاعدة بيانات المعرض بعد. اكتب اسم المنتج يدوياً أو أضف منتجات من قاعدة بيانات المعرض.
                </p>
              )}

              {!productId && (
                <input
                  type="text"
                  value={manualProductName}
                  onChange={(e) => setManualProductName(e.target.value)}
                  placeholder="اسم المنتج يدوياً (مثال: ثلاجة 18 قدم)"
                  className="w-full mt-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              )}

              {selectedProduct && (
                <div className="mt-2 p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <p className="text-[11px] text-slate-300 flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 text-emerald-400" />
                    {selectedProduct.name}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    سعر الكاش: {formatIqd(selectedProduct.cashPrice)} • القسط من: {formatIqd(selectedProduct.installmentFrom)}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    المخزون: {selectedProduct.inStock === false ? 'غير متوفر' : 'متوفر'} • {selectedProduct.specs.length} مواصفة مسجلة
                  </p>
                </div>
              )}
            </div>

            {/* 4. Platforms */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-2">
                4. المنصات المستهدفة ({selectedPlatforms.length} مختارة):
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
              <p className="text-[10px] text-slate-500 mt-2">
                اختيار المنصة هنا لإعداد المحتوى فقط. لا يُعدّ الحساب متصلاً ولا يتم أي نشر خارجي.
              </p>
            </div>

            {/* 5. Installment parameters */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">الدفعة الأولى (%)</label>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={downPaymentPercent}
                  onChange={(e) => setDownPaymentPercent(e.target.value)}
                  placeholder={selectedProduct ? String(selectedProduct.downPaymentPercent) : '0'}
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
                  placeholder={selectedProduct ? String(selectedProduct.durationMonths) : '12'}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">نبرة المحتوى</label>
              <input
                type="text"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">ملاحظات إضافية (اختياري)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 resize-none"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={saveDrafts}
                onChange={(e) => setSaveDrafts(e.target.checked)}
                className="w-4 h-4 accent-emerald-500"
              />
              <span className="text-xs text-slate-300">حفظ الناتج كمسودات في مركز المحتوى تلقائياً</span>
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
              onClick={handleRun}
              disabled={isRunning || validationErrors.length > 0}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 transition cursor-pointer shadow-md shadow-emerald-600/30"
            >
              {isRunning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {isRunning ? 'الوكيل ينفذ المهمة...' : 'نفّذ المهمة'}
            </button>
          </div>
        </div>

        {/* Result */}
        <div className="lg:col-span-7 space-y-5">
          {!result ? (
            <div className="p-10 rounded-2xl bg-slate-900 border border-slate-800 text-center">
              <Bot className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-sm font-bold text-slate-300">لا توجد نتيجة بعد</p>
              <p className="text-xs text-slate-500 mt-1">اكتب مهمتك واختر المنتج والمنصات، ثم نفّذ المهمة لعرض المحتوى هنا.</p>
            </div>
          ) : (
            <>
              {/* Summary */}
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <p className="text-xs font-bold text-white">تم تنفيذ المهمة بالمحرك المحلي الحتمي</p>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {new Date(result.createdAt).toLocaleString('en-GB')}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-xl bg-slate-950 border border-slate-800 p-2.5">
                    <p className="text-[10px] text-slate-500">المنتج</p>
                    <p className="text-[11px] font-bold text-white mt-1 truncate">{result.product.name}</p>
                    <p className="text-[9px] text-slate-500">
                      {result.product.source === 'showroom-database' ? 'من قاعدة البيانات' : 'إدخال يدوي'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-950 border border-slate-800 p-2.5">
                    <p className="text-[10px] text-slate-500">المنصات</p>
                    <p className="text-[11px] font-bold text-white mt-1">{result.content.length}</p>
                  </div>
                  <div className="rounded-xl bg-slate-950 border border-slate-800 p-2.5">
                    <p className="text-[10px] text-slate-500">القسط الشهري</p>
                    <p className="text-[11px] font-bold text-emerald-300 mt-1">
                      {result.quote ? formatIqd(result.quote.monthlyPayment) : 'غير محسوب'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-950 border border-slate-800 p-2.5">
                    <p className="text-[10px] text-slate-500">مسودات محفوظة</p>
                    <p className="text-[11px] font-bold text-white mt-1">{result.savedPostIds.length}</p>
                  </div>
                </div>

                {result.quote && (
                  <div className="mt-3 p-3 rounded-xl bg-slate-950 border border-slate-800">
                    <p className="text-[11px] font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                      <Calculator className="w-3.5 h-3.5 text-emerald-400" />
                      حسبة القسط (د.ع)
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                      <div><span className="text-slate-500">سعر الكاش: </span><span className="text-slate-200 font-bold">{formatIqd(result.quote.cashPrice)}</span></div>
                      <div><span className="text-slate-500">الدفعة الأولى: </span><span className="text-slate-200 font-bold">{formatIqd(result.quote.downPayment)}</span></div>
                      <div><span className="text-slate-500">الممول: </span><span className="text-slate-200 font-bold">{formatIqd(result.quote.financedAmount)}</span></div>
                      <div><span className="text-slate-500">الإجمالي: </span><span className="text-slate-200 font-bold">{formatIqd(result.quote.totalInstallments)}</span></div>
                    </div>
                  </div>
                )}

                {result.warnings.length > 0 && (
                  <div className="mt-3 p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 space-y-1">
                    {result.warnings.map((w) => (
                      <p key={w} className="text-[10px] text-amber-300 flex items-start gap-1.5">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                        {w}
                      </p>
                    ))}
                  </div>
                )}

                <p className="text-[10px] text-slate-400 mt-3">{result.nextStep}</p>
              </div>

              {/* Platform tabs */}
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="flex items-center gap-2 overflow-x-auto pb-3 custom-scrollbar">
                  {result.content.map((c) => (
                    <button
                      key={c.platform}
                      onClick={() => setActivePlatform(c.platform)}
                      className={`px-3 py-1.5 rounded-xl text-[11px] font-bold shrink-0 transition cursor-pointer border ${
                        activePlatform === c.platform
                          ? 'bg-emerald-500 text-slate-950 border-emerald-500'
                          : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      {c.platformName}
                      <span className={`ml-1.5 text-[9px] ${c.withinLimit ? 'text-emerald-500' : 'text-rose-400'}`}>
                        {c.charCount}/{c.limit}
                      </span>
                    </button>
                  ))}
                </div>

                {activePiece && (
                  <div className="space-y-3">
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                      {activePiece.headline && (
                        <p className="text-sm font-black text-emerald-300 mb-3">{activePiece.headline}</p>
                      )}
                      <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-line">{activePiece.body}</p>
                      {activePiece.callToAction && (
                        <p className="text-xs text-white font-bold mt-3 pt-3 border-t border-slate-800">{activePiece.callToAction}</p>
                      )}
                      {activePiece.hashtags.length > 0 && (
                        <p className="text-[11px] text-cyan-300 mt-2">{activePiece.hashtags.join(' ')}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => copyToClipboard([activePiece.headline, activePiece.body, activePiece.callToAction, activePiece.hashtags.join(' ')].filter(Boolean).join('\n\n'))}
                        className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-emerald-500/40 text-xs text-slate-300 hover:text-white flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        نسخ
                      </button>
                      <button
                        onClick={() => handleSaveOneAsDraft(activePiece.platform)}
                        className="px-3 py-2 rounded-xl bg-emerald-950/70 border border-emerald-500/30 text-xs text-emerald-300 hover:text-emerald-200 flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        حفظ كمسودة
                      </button>
                      <button
                        onClick={() => setActiveTab('approval')}
                        className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-emerald-500/40 text-xs text-slate-300 hover:text-white flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        مركز الموافقات
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      )}
    </div>
  );
};
