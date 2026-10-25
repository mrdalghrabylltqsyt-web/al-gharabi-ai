import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Database,
  Package,
  BadgePercent,
  FileCheck,
  HelpCircle,
  Plus,
  Trash2,
  ShieldCheck,
  CheckCircle2,
  Building,
  Phone,
  Clock,
  Search,
} from 'lucide-react';
import { ShowroomProduct } from '../../types';
import { realProductPhrases, modelLabel } from '../../utils/productPhrases';
import {
  computeInstallmentPrice,
  INSTALLMENT_MONTHS_DEFAULT,
  INSTALLMENT_MARKUP_PERCENT_DEFAULT,
} from '../../utils/installmentPrice';

export const ShowroomDatabaseView: React.FC = () => {
  const {
    products,
    showroomInfo,
    installmentPlans,
    addProduct,
    deleteProduct,
    showToast,
    currentUser,
    updateShowroomInfo,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'products' | 'plans' | 'policies' | 'faqs'>('products');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showAddProductModal, setShowAddProductModal] = useState<boolean>(false);
  const [newDocument, setNewDocument] = useState<string>('');
  // تأكيد الحذف: لا يُحذف أي منتج إلا بعد ضغط «نعم» صراحةً (المنتج المعلّق للحذف).
  const [productPendingDelete, setProductPendingDelete] = useState<ShowroomProduct | null>(null);
  const [isDeletingProduct, setIsDeletingProduct] = useState<boolean>(false);

  // New Product State
  const [newProductName, setNewProductName] = useState<string>('');
  const [newProductModel, setNewProductModel] = useState<string>(new Date().getFullYear().toString());
  const [newProductCategory, setNewProductCategory] = useState<'appliances' | 'phones' | 'construction' | 'electronics' | 'other'>('appliances');
  const [newProductCash, setNewProductCash] = useState<number>(0);
  const [newProductMonths, setNewProductMonths] = useState<number>(INSTALLMENT_MONTHS_DEFAULT);
  const [newProductMarkupPercent, setNewProductMarkupPercent] = useState<number>(INSTALLMENT_MARKUP_PERCENT_DEFAULT);
  const [newProductImage, setNewProductImage] = useState<string>('');

  // سعر التقسيط والقسط الشهري يُحسبان فوراً من ثلاثة حقول يدوية (سعر الكاش، نسبة
  // الزيادة %، المدة) — لا قيمة مخفية. المصدر الواحد: src/utils/installmentPrice.
  const installmentPreview = computeInstallmentPrice({
    cashPrice: Number(newProductCash),
    installmentMonths: newProductMonths,
    installmentMarkupPercent: newProductMarkupPercent,
  });

  const categoryLabel = (category: ShowroomProduct['category']) => ({
    appliances: 'أجهزة منزلية',
    phones: 'هواتف ذكية',
    construction: 'مواد بناء',
    electronics: 'إلكترونيات',
    other: 'أخرى',
  }[category]);

  // نظام التقسيط الفعلي كما هو مسجّل على المنتجات (مدة + نسبة الزيادة) — لا خطة مختلقة.
  const derivedPlans = (() => {
    const map = new Map<string, { key: string; months: number; markup: number; count: number }>();
    for (const p of products) {
      const months = Number(p.installmentMonths);
      const inst = Number(p.installmentPrice);
      const cash = Number(p.cashPrice);
      if (!Number.isFinite(months) || months <= 0 || !Number.isFinite(inst) || !(cash > 0)) continue;
      const markup = Math.round(((inst / cash) - 1) * 1000) / 10;
      const key = `${months}:${markup}`;
      const cur = map.get(key) || { key, months, markup, count: 0 };
      cur.count += 1;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  })();

  const filteredProducts = products.filter(
    (p) =>
      p.name.includes(searchTerm) ||
      p.category.includes(searchTerm) ||
      (categoryLabel(p.category) || '').includes(searchTerm) ||
      realProductPhrases(p.specs).some((s) => s.includes(searchTerm))
  );

  // المستمسكات المطلوبة للتقسيط: مصدرها بيانات المعرض المسجّلة (لا قائمة ثابتة في
  // الواجهة)، فيراها العقل وتُذكر للعميل بعد سعر/قسط مسجّل فقط.
  const requiredDocuments = Array.isArray(showroomInfo.requiredDocuments) ? showroomInfo.requiredDocuments : [];

  const handleAddDocument = () => {
    const value = newDocument.trim();
    if (!value) return;
    if (requiredDocuments.includes(value)) {
      showToast('هذا المستمسك مضاف مسبقاً.');
      return;
    }
    updateShowroomInfo({ requiredDocuments: [...requiredDocuments, value] });
    setNewDocument('');
  };

  // بنك الأسئلة الشائعة: يضيفه المالك/المدير فعلاً (يُحفظ على الخادم ويقرؤه العقل) — لا أسئلة مختلقة.
  const [newFaqQ, setNewFaqQ] = useState('');
  const [newFaqA, setNewFaqA] = useState('');
  const canEditFaq = currentUser?.role === 'owner' || currentUser?.role === 'manager';
  const handleAddFaq = () => {
    const q = newFaqQ.trim();
    const a = newFaqA.trim();
    if (!q || !a) { showToast('اكتب السؤال وجوابه المعتمد.'); return; }
    updateShowroomInfo({ faqs: [...(showroomInfo.faqs || []), { id: `faq-${Date.now()}`, q, a, category: 'عام' }] });
    setNewFaqQ('');
    setNewFaqA('');
  };
  const [newPolicy, setNewPolicy] = useState('');
  const handleAddPolicy = () => {
    const v = newPolicy.trim();
    if (!v) return;
    if ((showroomInfo.policies || []).includes(v)) { showToast('هذا الشرط مضاف مسبقاً.'); return; }
    updateShowroomInfo({ policies: [...(showroomInfo.policies || []), v] });
    setNewPolicy('');
  };
  const handleRemovePolicy = (v: string) => updateShowroomInfo({ policies: (showroomInfo.policies || []).filter((x) => x !== v) });
  const handleRemoveFaq = (id: string) => {
    updateShowroomInfo({ faqs: (showroomInfo.faqs || []).filter((f) => f.id !== id) });
  };

  const handleRemoveDocument = (doc: string) => {
    updateShowroomInfo({ requiredDocuments: requiredDocuments.filter((d) => d !== doc) });
  };

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductName.trim()) return;

    const cashPrice = Number(newProductCash);
    const months = Number(newProductMonths);
    if (!Number.isFinite(cashPrice) || cashPrice <= 0) {
      showToast('أدخل سعر كاش صحيحاً أكبر من صفر.');
      return;
    }
    const markupPercent = Number(newProductMarkupPercent);
    if (!Number.isFinite(markupPercent) || markupPercent < 0) {
      showToast('أدخل نسبة زيادة صحيحة (رقم ≥ 0).');
      return;
    }
    if (!Number.isInteger(months) || months < 1 || months > 60) {
      showToast('أدخل مدة تقسيط صحيحة بين 1 و60 شهراً.');
      return;
    }
    // المدخلات اليدوية الثلاثة هي سعر الكاش + نسبة الزيادة + المدة؛ سعر التقسيط والقسط
    // الشهري يُشتقّان منها (ويلحقهما الخادم أيضاً بمصدر واحد)، فلا تُحفظ قيمة متناقضة.
    const derived = computeInstallmentPrice({ cashPrice, installmentMonths: months, installmentMarkupPercent: markupPercent });
    if (!derived.ok) {
      showToast('تعذّر حساب التقسيط: تحقّق من سعر الكاش والنسبة والمدة.');
      return;
    }

    addProduct({
      name: newProductName,
      modelYear: newProductModel,
      category: newProductCategory,
      cashPrice,
      installmentFrom: derived.monthlyInstallment,
      downPaymentPercent: 0,
      durationMonths: months,
      image: newProductImage,
      // لا عبارات عامة مختلقة: المواصفات/خيارات السداد يسجّلها المالك فعلاً أو تبقى فارغة.
      installmentOptions: [],
      specs: [],
      inStock: true,
      installmentPrice: derived.installmentPrice,
      installmentMonths: derived.installmentMonths,
      monthlyInstallment: derived.monthlyInstallment,
      installmentMarkupPercent: derived.installmentMarkupPercent,
      requiredDocuments: requiredDocuments,
    });

    setShowAddProductModal(false);
    setNewProductName('');
    setNewProductCash(0);
    setNewProductMonths(INSTALLMENT_MONTHS_DEFAULT);
    setNewProductMarkupPercent(INSTALLMENT_MARKUP_PERCENT_DEFAULT);
    setNewProductImage('');
    showToast('تمت إضافة المنتج لقاعدة بيانات المعرض بنجاح!');
  };

  // حذف مؤكَّد: «نعم» فقط ينفّذ الحذف الحالي (بلا تغيير في منطق الخادم).
  const confirmDeleteProduct = () => {
    if (!productPendingDelete || isDeletingProduct) return;
    setIsDeletingProduct(true);
    deleteProduct(productPendingDelete.id);
    setProductPendingDelete(null);
    setIsDeletingProduct(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Notice */}
      <div className="p-6 rounded-2xl glass flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-400" />
              قاعدة بيانات معرض الغرابي المرجعية (RAG Grounding)
            </h2>
            <span className="text-xs bg-emerald-950 text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-500/30 font-bold">
              مصدر الحقيقة لمنع الهلوسة
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            يستخدمها الذكاء الاصطناعي كمصدر حصري وحاسم لاستخراج أسعار المنتجات، حسابات الأقساط،
            الشروط البنكية، والسياسات المعتمدة بدقة 100%.
          </p>
        </div>

        {(currentUser.role === 'owner' || currentUser.role === 'manager') && (
          <button
            onClick={() => setShowAddProductModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-md shadow-emerald-500/20 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            إضافة منتج جديد للمخزون
          </button>
        )}
      </div>

      {/* Showroom Official Details Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
            <Building className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-slate-400 block">موقع المعرض الرسمي</span>
            <span className="text-xs font-bold text-white">{showroomInfo.address || 'لم يُحدد العنوان بعد'}</span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center shrink-0">
            <Phone className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-slate-400 block">الرقم الموحد والواتساب</span>
            <span className="text-xs font-bold text-white font-mono">{showroomInfo.phoneUnified || 'لم يُحدد الهاتف بعد'}</span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-slate-400 block">أوقات العمل واستقبال العملاء</span>
            <span className="text-xs font-bold text-white">{showroomInfo.workingHours || 'لم تُحدد ساعات العمل بعد'}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3 text-xs font-bold">
        {[
          { id: 'products', label: 'منتجات المعرض', count: products.length, icon: Package },
          { id: 'plans', label: 'أنظمة وخطط التقسيط', count: installmentPlans.length, icon: BadgePercent },
          { id: 'policies', label: 'سياسات وشروط التمويل', count: (showroomInfo.policies || []).length + requiredDocuments.length, icon: FileCheck },
          { id: 'faqs', label: 'الأسئلة الشائعة (FAQ)', count: showroomInfo.faqs.length, icon: HelpCircle },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-slate-800 text-emerald-300 font-extrabold border border-slate-700 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-slate-900 text-slate-300">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab 1: Products Inventory */}
      {activeTab === 'products' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative max-w-sm w-full">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="ابحث عن منتج أو فئة أو مواصفات..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full glass rounded-xl pr-9 pl-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <span className="text-xs text-slate-400">
              {filteredProducts.length} منتج • المتوفر {filteredProducts.filter((p) => p.inStock !== false).length}
            </span>
          </div>

          {filteredProducts.length === 0 ? (
            <div className="p-12 text-center text-slate-400 bg-slate-900/50 rounded-2xl border border-slate-800">
              <Package className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="font-bold text-white text-sm">لا توجد منتجات مسجلة حالياً في قاعدة البيانات</p>
              <p className="text-xs text-slate-500 mt-1">
                يمكنك إضافة منتجات جديدة بالضغط على "إضافة منتج جديد للمخزون" أعلاه.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredProducts.map((prod) => (
                <div
                  key={prod.id}
                  className="rounded-2xl glass overflow-hidden hover:border-slate-700 transition flex flex-col justify-between group"
                >
                  <div>
                    <div className="relative h-44 overflow-hidden bg-slate-950 flex items-center justify-center">
                      {prod.image ? (
                        <img
                          src={prod.image}
                          alt={prod.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                        />
                      ) : (
                        <div className="text-center text-slate-600">
                          <Package className="w-12 h-12 mx-auto mb-1 opacity-50" />
                          <span className="text-[10px]">لا توجد صورة مرفقة</span>
                        </div>
                      )}
                      <div className="absolute top-3 right-3 flex items-center gap-1.5">
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-950/80 backdrop-blur-md text-emerald-300 border border-emerald-500/30">
                          {modelLabel(prod.modelYear, new Date().getFullYear()) || 'بلا موديل مسجّل'}
                        </span>
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-950/80 backdrop-blur-md text-white border border-slate-800">
                          {categoryLabel(prod.category) || prod.category}
                        </span>
                      </div>

                      <div className="absolute bottom-3 left-3 bg-slate-950/90 backdrop-blur-md px-3 py-1 rounded-xl border border-emerald-500/40 text-left">
                        <span className="text-[10px] text-slate-400 block">القسط الشهري يبدأ من</span>
                        <span className="text-sm font-black text-emerald-400">
                          {(prod.monthlyInstallment ?? prod.installmentFrom ?? 0).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="p-4 space-y-3">
                      <div>
                        <h3 className="font-extrabold text-sm text-white">{prod.name}</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          سعر الكاش: {prod.cashPrice.toLocaleString()} د.ع
                        </p>
                        {Number.isFinite(prod.installmentPrice) && (
                          <p className="text-xs text-emerald-300/90 mt-0.5">
                            سعر التقسيط: {Number(prod.installmentPrice).toLocaleString()} د.ع
                            {Number.isFinite(prod.installmentMonths) ? ` • ${Number(prod.installmentMonths)} شهراً` : ''}
                          </p>
                        )}
                      </div>

                      {/* Specifications badges */}
                      <div className="flex flex-wrap gap-1.5">
                        {realProductPhrases(prod.specs).map((spec, i) => (
                          <span
                            key={i}
                            className="text-[10px] px-2 py-0.5 rounded-md bg-slate-950 text-slate-300 border border-slate-800"
                          >
                            {spec}
                          </span>
                        ))}
                      </div>

                      {/* Installment options */}
                      <div className="space-y-1 text-[11px] text-emerald-300/90 pt-2 border-t border-slate-800">
                        {/* حقائق التقسيط المسجّلة فعلاً لهذا المنتج (بدل عبارات عامة ثابتة). */}
                        {[
                          Number.isFinite(prod.installmentMonths) && Number.isFinite(prod.monthlyInstallment)
                            ? `${Number(prod.installmentMonths)} أقساط شهرية × ${Number(prod.monthlyInstallment).toLocaleString()} د.ع`
                            : null,
                          Number.isFinite(prod.downPaymentPercent) && Number(prod.downPaymentPercent) > 0
                            ? `مقدّمة ${Number(prod.downPaymentPercent)}%`
                            : null,
                          prod.inStock === false ? 'غير متوفر حالياً' : 'متوفر',
                          ...realProductPhrases(prod.installmentOptions),
                        ].filter(Boolean).map((opt, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>{opt}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {(currentUser.role === 'owner' || currentUser.role === 'manager') && (
                    <div className="p-3 bg-slate-950/60 border-t border-slate-800 flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">ID: {prod.id}</span>
                      <button
                        onClick={() => setProductPendingDelete(prod)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition cursor-pointer"
                        title="حذف المنتج"
                        aria-label={`حذف المنتج ${prod.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Installment Plans & Programs */}
      {activeTab === 'plans' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {installmentPlans.length === 0 ? (
            <div className="col-span-1 md:col-span-3 p-12 text-center text-slate-400 bg-slate-900/50 rounded-2xl border border-slate-800">
              <BadgePercent className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="font-bold text-white text-sm">لا توجد برامج تقسيط مسمّاة — نظام التقسيط الفعلي مسجّل على المنتجات نفسها:</p>
              <div className="mt-4 grid gap-2 max-w-xl mx-auto text-right">
                {derivedPlans.length === 0 ? (
                  <p className="text-xs text-slate-500">لا يوجد منتج بسعر تقسيط مسجّل بعد.</p>
                ) : derivedPlans.map((pl) => (
                  <div key={pl.key} className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-200 flex items-center justify-between gap-3">
                    <span className="font-bold text-emerald-300">{pl.months} شهراً • زيادة {pl.markup}% على الكاش</span>
                    <span className="text-slate-400">{pl.count} منتج</span>
                  </div>
                ))}
                <p className="text-[10px] text-slate-500">مُشتق حرفياً من أسعار الكاش والتقسيط المسجّلة لكل منتج — وهو ما يستخدمه العقل في الرد على الزبائن.</p>
              </div>
            </div>
          ) : (
            installmentPlans.map((prog) => (
              <div
                key={prog.id}
                className="p-6 rounded-2xl glass space-y-4 relative overflow-hidden"
              >
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500/20 to-teal-500/10 text-emerald-400 flex items-center justify-center">
                  <BadgePercent className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-extrabold text-base text-white">{prog.title}</h3>
                    {prog.shariaApproved && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                        شرعي معتمد
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 mt-2 leading-relaxed">{prog.description}</p>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-xs text-emerald-300 font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>المستفيدون: {prog.targetAudience}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab 3: Policies & Requirements */}
      {activeTab === 'policies' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-2xl glass space-y-4">
            <h3 className="font-bold text-base text-white flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-emerald-400" />
              المستندات والأوراق المطلوبة للتقسيط
            </h3>
            <p className="text-xs text-slate-400">
              مسجّلة في بيانات المعرض ويطلبها الذكاء الاصطناعي مباشرة من العميل في المحادثات:
            </p>
            <div className="space-y-2">
              {requiredDocuments.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs bg-slate-950/40 rounded-xl border border-slate-800/80">
                  لا توجد مستمسكات مسجّلة حالياً. أضفها ليستخدمها الذكاء الاصطناعي في الردود.
                </div>
              ) : (
                requiredDocuments.map((doc, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-200 flex items-center gap-2.5"
                  >
                    <span className="w-5 h-5 rounded-full bg-emerald-950 text-emerald-400 text-[11px] font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <span className="flex-1">{doc}</span>
                    {(currentUser?.role === 'owner' || currentUser?.role === 'manager') && (
                      <button
                        type="button"
                        onClick={() => handleRemoveDocument(doc)}
                        className="text-rose-400 hover:text-rose-300 shrink-0"
                        aria-label={`حذف مستمسك ${doc}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
            {(currentUser?.role === 'owner' || currentUser?.role === 'manager') && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={newDocument}
                  onChange={(e) => setNewDocument(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddDocument(); } }}
                  placeholder="أضف مستمسكاً مطلوباً..."
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={handleAddDocument}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  إضافة
                </button>
              </div>
            )}
          </div>

          <div className="p-6 rounded-2xl glass space-y-4">
            <h3 className="font-bold text-base text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              شروط وأحكام المعرض العامة
            </h3>
            <p className="text-xs text-slate-400">
              قواعد الإقراض والتسليم المعتمدة لدى إدارة المعرض:
            </p>
            <div className="space-y-2">
              {showroomInfo.policies.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs bg-slate-950/40 rounded-xl border border-slate-800/80">
                  لا توجد سياسات أو شروط إضافية مسجلة حالياً.
                </div>
              ) : (
                showroomInfo.policies.map((pol, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-200 flex items-start gap-2.5"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span className="flex-1">{pol}</span>
                    {canEditFaq && (
                      <button type="button" onClick={() => handleRemovePolicy(pol)} className="text-rose-400 hover:text-rose-300 shrink-0" aria-label={`حذف شرط ${pol}`}><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                ))
              )}
            </div>
            {canEditFaq && (
              <div className="flex items-center gap-2 pt-1">
                <input type="text" value={newPolicy} onChange={(e) => setNewPolicy(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddPolicy(); } }} placeholder="أضف شرطاً معتمداً (مثال: التسليم خلال 24 ساعة)..." className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500" />
                <button type="button" onClick={handleAddPolicy} className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> إضافة</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: FAQ Bank */}
      {activeTab === 'faqs' && (
        <div className="space-y-3">
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400">
            💡 هذه الأسئلة والإجابات يستند عليها الذكاء الاصطناعي لتقديم ردود رسمية فورية وموثقة للعملاء.
          </div>

          {canEditFaq && (
            <div className="p-4 rounded-2xl glass space-y-2">
              <p className="text-xs font-bold text-white">إضافة سؤال وجوابه المعتمد</p>
              <input value={newFaqQ} onChange={(e) => setNewFaqQ(e.target.value)} placeholder="السؤال (مثال: هل التقسيط بدون كفيل؟)" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500" />
              <textarea value={newFaqA} onChange={(e) => setNewFaqA(e.target.value)} placeholder="الجواب المعتمد كما تريده أن يصل للزبون" rows={2} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500" />
              <button type="button" onClick={handleAddFaq} className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> حفظ السؤال</button>
            </div>
          )}

          {showroomInfo.faqs.length === 0 ? (
            <div className="p-12 text-center text-slate-400 bg-slate-900/50 rounded-2xl border border-slate-800">
              <HelpCircle className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="font-bold text-white text-sm">لا توجد أسئلة شائعة مسجلة حالياً</p>
              <p className="text-xs text-slate-500 mt-1">سيتمكن الذكاء الاصطناعي من الإجابة بدقة فور إضافة بنك الأسئلة والأجوبة المعتمدة.</p>
            </div>
          ) : (
            showroomInfo.faqs.map((faq) => (
              <div
                key={faq.id}
                className="p-5 rounded-2xl glass space-y-2"
              >
                <h4 className="font-bold text-sm text-white flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  {faq.q}
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed pr-6">{faq.a}</p>
                {canEditFaq && (
                  <button type="button" onClick={() => handleRemoveFaq(faq.id)} className="text-[10px] text-rose-400 hover:text-rose-300 pr-6 flex items-center gap-1"><Trash2 className="w-3 h-3" /> حذف</button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Modal: Add New Product */}
      {showAddProductModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md glass rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <Package className="w-5 h-5 text-emerald-400" />
                إضافة منتج جديد للمعرض
              </h3>
              <button
                onClick={() => setShowAddProductModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">اسم المنتج والموديل</label>
                <input
                  type="text"
                  placeholder="مثال: اسم المنتج والموديل"
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">الموديل / السنة</label>
                  <input
                    type="text"
                    value={newProductModel}
                    onChange={(e) => setNewProductModel(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">الفئة</label>
                  <select
                    value={newProductCategory}
                    onChange={(e) => setNewProductCategory(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="appliances">أجهزة منزلية</option>
                    <option value="appliances">أجهزة منزلية</option>
                    <option value="phones">هواتف ذكية</option><option value="construction">مواد بناء</option><option value="electronics">إلكترونيات</option>
                    <option value="other">أخرى</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">سعر الكاش (د.ع)</label>
                  <input
                    type="number"
                    min="0"
                    value={newProductCash || ''}
                    onChange={(e) => setNewProductCash(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">نسبة الزيادة (%)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={newProductMarkupPercent}
                    onChange={(e) => setNewProductMarkupPercent(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">مدة التقسيط (بالأشهر)</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={newProductMonths}
                  onChange={(e) => setNewProductMonths(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">سعر التقسيط (د.ع)</label>
                  <input
                    type="text"
                    readOnly
                    value={installmentPreview.ok ? installmentPreview.installmentPrice.toLocaleString('en-US') : ''}
                    className="w-full glass rounded-xl px-3 py-2 text-emerald-300 font-bold cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">القسط الشهري (د.ع)</label>
                  <input
                    type="text"
                    readOnly
                    value={installmentPreview.ok ? installmentPreview.monthlyInstallment.toLocaleString('en-US') : ''}
                    className="w-full glass rounded-xl px-3 py-2 text-emerald-300 font-bold cursor-not-allowed"
                  />
                </div>
              </div>

              <p className="text-[10px] text-slate-500 leading-relaxed">
                نسبة الزيادة تُدخل يدوياً (افتراضياً 25%)، وسعر التقسيط = سعر الكاش + النسبة،
                والقسط الشهري = سعر التقسيط ÷ المدة. يُحسبان تلقائياً عند تغيير سعر الكاش أو النسبة أو المدة.
              </p>

              <div>
                <label className="block text-slate-300 font-bold mb-1">رابط صورة المنتج</label>
                <input
                  type="text"
                  value={newProductImage}
                  onChange={(e) => setNewProductImage(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddProductModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold shadow-md shadow-emerald-500/20 cursor-pointer"
                >
                  حفظ المنتج
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* تأكيد حذف المنتج: نافذة صريحة تعرض الاسم والسعر — «لا» تُغلق بلا تغيير،
          و«نعم» فقط ينفّذ الحذف. أثناء التنفيذ يُعطَّل الزر لمنع الضغط المكرر. */}
      {productPendingDelete && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-product-title"
        >
          <div className="w-full max-w-sm glass rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
              <span className="w-10 h-10 rounded-xl bg-rose-950/60 border border-rose-500/30 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-rose-400" />
              </span>
              <h3 id="delete-product-title" className="font-bold text-base text-white">
                هل أنت متأكد من حذف هذا المنتج؟
              </h3>
            </div>

            <div className="rounded-2xl bg-slate-950/60 border border-slate-800 p-3 space-y-1">
              <p className="text-sm font-bold text-white break-words">{productPendingDelete.name}</p>
              <p className="text-xs text-slate-400">
                سعر الكاش: {Number(productPendingDelete.cashPrice || 0).toLocaleString('en-US')} د.ع
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => setProductPendingDelete(null)}
                disabled={isDeletingProduct}
                className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                لا
              </button>
              <button
                type="button"
                onClick={confirmDeleteProduct}
                disabled={isDeletingProduct}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold shadow-md shadow-rose-600/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeletingProduct ? 'جارٍ الحذف…' : 'نعم'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
