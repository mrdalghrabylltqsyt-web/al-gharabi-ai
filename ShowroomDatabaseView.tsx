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

export const ShowroomDatabaseView: React.FC = () => {
  const {
    products,
    showroomInfo,
    installmentPlans,
    addProduct,
    deleteProduct,
    showToast,
    currentUser,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'products' | 'plans' | 'policies' | 'faqs'>('products');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showAddProductModal, setShowAddProductModal] = useState<boolean>(false);

  // New Product State
  const [newProductName, setNewProductName] = useState<string>('');
  const [newProductModel, setNewProductModel] = useState<string>(new Date().getFullYear().toString());
  const [newProductCategory, setNewProductCategory] = useState<'appliances' | 'phones' | 'construction' | 'electronics' | 'other'>('appliances');
  const [newProductCash, setNewProductCash] = useState<number>(0);
  const [newProductInstallment, setNewProductInstallment] = useState<number>(0);
  const [newProductImage, setNewProductImage] = useState<string>('');

  const categoryLabel = (category: ShowroomProduct['category']) => ({
    appliances: 'أجهزة منزلية',
    phones: 'هواتف ذكية',
    construction: 'مواد بناء',
    electronics: 'إلكترونيات',
    other: 'أخرى',
  }[category]);

  const filteredProducts = products.filter(
    (p) =>
      p.name.includes(searchTerm) ||
      p.category.includes(searchTerm) ||
      p.specs.some((s) => s.includes(searchTerm))
  );

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductName.trim()) return;

    addProduct({
      name: newProductName,
      modelYear: newProductModel,
      category: newProductCategory,
      cashPrice: Number(newProductCash),
      installmentFrom: Number(newProductInstallment),
      downPaymentPercent: 0,
      durationMonths: 60,
      image: newProductImage,
      installmentOptions: ['خيارات تقسيط حسب الأهلية', 'مدد سداد مرنة', 'خطط تمويل حسب المنتج'],
      specs: ['مواصفات المنتج حسب الفئة', 'ضمان حسب سياسة المورد', 'خدمة ما بعد البيع حسب المنتج'],
      inStock: true,
    });

    setShowAddProductModal(false);
    setNewProductName('');
    showToast('تمت إضافة المنتج لقاعدة بيانات المعرض بنجاح!');
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Notice */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
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
          { id: 'policies', label: 'سياسات وشروط التمويل', icon: FileCheck },
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
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pr-9 pl-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <span className="text-xs text-slate-400">
              إجمالي {filteredProducts.length} منتجات جاهزة للتسليم
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
                  className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden hover:border-slate-700 transition flex flex-col justify-between group"
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
                          موديل {prod.modelYear || new Date().getFullYear()}
                        </span>
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-950/80 backdrop-blur-md text-white border border-slate-800 uppercase">
                          {prod.category}
                        </span>
                      </div>

                      <div className="absolute bottom-3 left-3 bg-slate-950/90 backdrop-blur-md px-3 py-1 rounded-xl border border-emerald-500/40 text-left">
                        <span className="text-[10px] text-slate-400 block">القسط الشهري يبدأ من</span>
                        <span className="text-sm font-black text-emerald-400">
                          {prod.installmentFrom.toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="p-4 space-y-3">
                      <div>
                        <h3 className="font-extrabold text-sm text-white">{prod.name}</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          سعر الكاش: {prod.cashPrice.toLocaleString()} (شامل الضريبة)
                        </p>
                      </div>

                      {/* Specifications badges */}
                      <div className="flex flex-wrap gap-1.5">
                        {prod.specs.map((spec, i) => (
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
                        {prod.installmentOptions.map((opt, i) => (
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
                        onClick={() => deleteProduct(prod.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition cursor-pointer"
                        title="حذف المنتج"
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
              <p className="font-bold text-white text-sm">لا توجد برامج أو خطط تقسيط مضافة حالياً</p>
              <p className="text-xs text-slate-500 mt-1">يمكن إضافة برامج وشروط التقسيط المعتمدة للمعرض لاحقاً.</p>
            </div>
          ) : (
            installmentPlans.map((prog) => (
              <div
                key={prog.id}
                className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 relative overflow-hidden"
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
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <h3 className="font-bold text-base text-white flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-emerald-400" />
              المستندات والأوراق المطلوبة للتقسيط
            </h3>
            <p className="text-xs text-slate-400">
              يطلبها الذكاء الاصطناعي مباشرة من العميل في المحادثات:
            </p>
            <div className="space-y-2">
              {[
                'إثبات هوية رسمي ساري المفعول',
                'تعريف حديث بالدخل / الراتب مصدق ومعتمد',
                'كشف حساب بنكي يوضح الحركة المالية لآخر 3 أشهر',
                'المستندات الإضافية المطلوبة حسب نوع المنتج',
              ].map((doc, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-200 flex items-center gap-2.5"
                >
                  <span className="w-5 h-5 rounded-full bg-emerald-950 text-emerald-400 text-[11px] font-bold flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <span>{doc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
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
                    <span>{pol}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: FAQ Bank */}
      {activeTab === 'faqs' && (
        <div className="space-y-3">
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400">
            💡 هذه الأسئلة والإجابات يستند عليها الذكاء الاصطناعي لتقديم ردود رسمية فورية وموثقة للعملاء.
          </div>

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
                className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2"
              >
                <h4 className="font-bold text-sm text-white flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  {faq.q}
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed pr-6">{faq.a}</p>
              </div>
            ))
          )}
        </div>
      )}

      {/* Modal: Add New Product */}
      {showAddProductModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in">
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
                    value={newProductCash}
                    onChange={(e) => setNewProductCash(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">القسط الشهري من (د.ع)</label>
                  <input
                    type="number"
                    value={newProductInstallment}
                    onChange={(e) => setNewProductInstallment(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

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
    </div>
  );
};
