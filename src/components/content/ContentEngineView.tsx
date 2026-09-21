import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiService } from '../../services/api';
import {
  Sparkles,
  Video,
  FileText,
  Youtube,
  Hash,
  Flame,
  Send,
  Save,
  CheckCircle,
  Copy,
  Layers,
  Package,
  Settings2,
  RefreshCw,
  Eye,
  Sliders,
  ChevronDown,
} from 'lucide-react';
import { SocialPlatformId, ContentFormatType } from '../../types';

export const ContentEngineView: React.FC = () => {
  const { products, platforms, createPost, showToast, setActiveTab, currentUser, showroomInfo } = useApp();

  const [selectedPlatform, setSelectedPlatform] = useState<SocialPlatformId>('tiktok');
  const [contentType, setContentType] = useState<ContentFormatType>('post');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [customTopic, setCustomTopic] = useState<string>('');
  const [tone, setTone] = useState<string>('تسويقية واحترافية موجهة لعملاء التقسيط الميسر');
  const [customInstructions, setCustomInstructions] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generatedResult, setGeneratedResult] = useState<string>('');
  const [adaptedVersions, setAdaptedVersions] = useState<Record<string, string>>({});
  const [activePreviewPlatform, setActivePreviewPlatform] = useState<SocialPlatformId>('tiktok');
  const [postTitle, setPostTitle] = useState<string>('');

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  // Content type descriptors
  const contentTypesList: Array<{ id: ContentFormatType; label: string; icon: any; desc: string }> = [
    { id: 'post', label: 'منشور تسويقي', icon: FileText, desc: 'منشور جذاب مع تفاصيل الأقساط والشروط' },
    { id: 'short_video', label: 'فيديو قصير / ريلز', icon: Video, desc: 'أفكار وهوك سريع لـ TikTok وReels' },
    { id: 'script', label: 'سكربت تصوير كامل', icon: Sliders, desc: 'مشاهد، توقيت بالثواني، وحركة المصور' },
    { id: 'youtube', label: 'عناوين ووصف YouTube', icon: Youtube, desc: 'عناوين SEO، طوابع زمنية، وكلمات مفتاحية' },
    { id: 'ad', label: 'إعلان ممول (Ad Copy)', icon: Flame, desc: 'نص إعلاني مباشر موجه للتحويل والمبيعات' },
    { id: 'campaign', label: 'خطة حملة تسويقية', icon: Layers, desc: 'استراتيجية متكاملة لعدة أيام ومنصات' },
    { id: 'hashtags', label: 'باقة هاشتاغات تريند', icon: Hash, desc: 'هاشتاغات مستهدفة لقطاع التقسيط والمنتجات' },
  ];

  const handleGenerate = async () => {
    setIsGenerating(true);
    const productInfo = selectedProduct
      ? `${selectedProduct.name} - سعر الكاش: ${selectedProduct.cashPrice.toLocaleString()} - القسط يبدأ من: ${selectedProduct.installmentFrom.toLocaleString()} شهرياً - أنظمة التقسيط: ${selectedProduct.installmentOptions.join('، ')}`
      : '';

    const payload = {
      platform: selectedPlatform,
      contentType,
      topic: customTopic || (selectedProduct ? `عرض تقسيط ${selectedProduct.name}` : 'عروض التقسيط الميسر'),
      tone,
      productName: selectedProduct?.name,
      productId: selectedProduct?.id,
      installmentDetails: productInfo,
      customInstructions,
    };

    const res = await apiService.generateContent(payload).catch((err: any) => {
      // رفض سلامة البيانات التجارية يجب أن يظهر للمستخدم صراحةً بلا محتوى بديل.
      showToast(err?.message || 'تعذر توليد المحتوى');
      return null;
    });
    setIsGenerating(false);

    if (res && res.success && res.content) {
      setGeneratedResult(res.content);
      const title = customTopic || (selectedProduct ? `عرض تقسيط ${selectedProduct.name}` : 'حملة التقسيط المعتمدة');
      setPostTitle(title);

      // نسخ المنصات تأتي من الخادم مبنية حتمياً من نفس النص المُتحقَّق منه، فلا
      // تنشئ الواجهة أي عرض أو رقم من عندها.
      const serverVersions = (res as any).adaptedVersions && typeof (res as any).adaptedVersions === 'object'
        ? (res as any).adaptedVersions
        : null;
      setAdaptedVersions(serverVersions ? { ...serverVersions, [selectedPlatform]: res.content } : { [selectedPlatform]: res.content });

      showToast('تم توليد المحتوى الذكي وإعادة صياغته للمنصات بنجاح!');
    }
  };

  const handleSendToApproval = (status: 'draft' | 'review') => {
    if (!generatedResult) {
      showToast('الرجاء توليد المحتوى أولاً قبل الحفظ');
      return;
    }

    const title = postTitle || (selectedProduct ? `عرض ${selectedProduct.name}` : 'منشور جديد');
    createPost({
      title,
      content: generatedResult,
      platformVersions: adaptedVersions,
      targetPlatforms: [selectedPlatform],
      status,
      mediaUrl: selectedProduct?.image,
      mediaType: contentType === 'short_video' || contentType === 'script' ? 'video' : 'image',
      authorName: currentUser.name,
      authorRole: currentUser.role,
      tags: ['تقسيط_منتجات', 'معرض_الغرابي', selectedPlatform],
    });

    setActiveTab('approval');
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            مركز صناعة المحتوى الذكي وإعادة الصياغة
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            صياغة ذكية متطابقة مع طبيعة كل منصة (تيك توك، سناب، إنستغرام، يوتيوب، إكس، واتساب)
            مستندة لأسعار وسياسات معرض الغرابي الحقيقية.
          </p>
        </div>
        <span className="text-xs bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 px-3 py-1.5 rounded-xl font-semibold flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          مدعوم بـ Gemini 3.8 Flash
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Form: Parameters and AI Prompt Controls (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Platform Selector */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <label className="block text-xs font-bold text-slate-300">
              1. اختر المنصة المستهدفة الأساسية:
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {platforms.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedPlatform(p.platform);
                    setActivePreviewPlatform(p.platform);
                  }}
                  className={`p-2.5 rounded-xl text-center text-xs font-bold transition flex flex-col items-center gap-1 cursor-pointer ${
                    selectedPlatform === p.platform
                      ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30 font-black'
                      : 'bg-slate-950/70 text-slate-300 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  <span className="text-[11px] truncate w-full">{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Content Type Selector */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <label className="block text-xs font-bold text-slate-300">
              2. نوع المحتوى المطلوب:
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {contentTypesList.map((ct) => {
                const Icon = ct.icon;
                const isSelected = contentType === ct.id;
                return (
                  <button
                    key={ct.id}
                    onClick={() => setContentType(ct.id)}
                    className={`p-3 rounded-xl text-right transition flex items-start gap-2.5 cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-950/80 border border-emerald-500/50 text-emerald-200'
                        : 'bg-slate-950/70 border border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${isSelected ? 'text-emerald-400' : 'text-slate-400'}`} />
                    <div className="min-w-0">
                      <p className="text-xs font-bold leading-tight truncate">{ct.label}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{ct.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Product Linking from Showroom Database */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Package className="w-4 h-4 text-emerald-400" />
                3. ربط منتج من قاعدة بيانات المعرض (حساب الأقساط الدقيق):
              </label>
              <span className="text-[10px] text-slate-400">قاعدة بيانات المنتجات</span>
            </div>

            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="">-- بدون تحديد منتج معين (محتوى عام للمعرض) --</option>
              {products.map((prod) => (
                <option key={prod.id} value={prod.id}>
                  {prod.name} - يبدأ القسط من {prod.installmentFrom.toLocaleString()} د.ع/شهر (كاش: {prod.cashPrice.toLocaleString()} د.ع)
                </option>
              ))}
            </select>

            {selectedProduct && (
              <div className="p-3 rounded-xl bg-slate-950/80 border border-emerald-500/20 text-xs flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {selectedProduct.image ? (
                    <img
                      src={selectedProduct.image}
                      alt={selectedProduct.name}
                      className="w-12 h-9 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="w-12 h-9 rounded-lg bg-slate-800 flex items-center justify-center">
                      <Package className="w-5 h-5 text-slate-500" />
                    </div>
                  )}
                  <div>
                    <span className="font-bold text-white block">{selectedProduct.name}</span>
                    <span className="text-[11px] text-emerald-400">
                      قسط يبدأ من: {selectedProduct.installmentFrom.toLocaleString()} د.ع شهرياً
                    </span>
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                  متوفر بالمعرض
                </span>
              </div>
            )}
          </div>

          {/* Tone & Custom Instructions */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  النبرة والأسلوب (Tone)
                </label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="تسويقية واحترافية موجهة لعملاء التقسيط الميسر">
                    تسويقية واحترافية للتقسيط الميسر
                  </option>
                  <option value="رسمية وتوثيقية للسياسات والشروط">رسمية وتوثيقية</option>
                  <option value="بسيطة ومباشرة توضح الشروط والأوراق المطلوبة">
                    بسيطة ومباشرة تشرح الأوراق والشروط
                  </option>
                  <option value="تفاعلية وسؤال للجمهور لزيادة التعليقات">
                    تفاعلية لطرح أسئلة وزيادة التفاعل
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  عنوان أو فكرة مخصصة (اختياري)
                </label>
                <input
                  type="text"
                  placeholder="مثال: عروض التقسيط الميسر..."
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                تعليمات إضافية للذكاء الاصطناعي
              </label>
              <textarea
                rows={2}
                placeholder="مثال: ركز على برامج التقسيط الميسر وسرعة إنجاز المعاملات..."
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-emerald-500 resize-none"
              />
            </div>

            {/* Action Trigger Button */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-sm shadow-xl shadow-emerald-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer active:scale-[0.99]"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>جارٍ الصياغة والتوليد عبر Gemini 3.8 Flash...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>توليد المحتوى وتطويعه للمنصات فورياً</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Output & Multi-Platform Adaptation Studio (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 flex flex-col h-full">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">معاينة المحتوى والنسخ المتكيفة</h3>
              </div>

              {generatedResult && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generatedResult);
                    showToast('تم نسخ النص إلى الحافظة');
                  }}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-1 text-[11px]"
                >
                  <Copy className="w-3.5 h-3.5" />
                  نسخ
                </button>
              )}
            </div>

            {/* Platform Version Switcher Tabs */}
            {Object.keys(adaptedVersions).length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
                {Object.keys(adaptedVersions).map((platKey) => (
                  <button
                    key={platKey}
                    onClick={() => setActivePreviewPlatform(platKey)}
                    className={`px-2.5 py-1 rounded-lg font-bold shrink-0 transition cursor-pointer ${
                      activePreviewPlatform === platKey
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-slate-950 text-slate-400 hover:text-white'
                    }`}
                  >
                    نسخة {platKey}
                  </button>
                ))}
              </div>
            )}

            {/* Content Output Box */}
            <div className="flex-1 min-h-[300px] bg-slate-950/80 rounded-xl p-4 border border-slate-800/80 overflow-y-auto custom-scrollbar">
              {generatedResult ? (
                <div className="space-y-3">
                  <div className="text-xs text-slate-200 whitespace-pre-line leading-relaxed font-sans">
                    {adaptedVersions[activePreviewPlatform] || generatedResult}
                  </div>

                  {selectedProduct?.image && (
                    <div className="mt-4 rounded-xl overflow-hidden border border-slate-800">
                      <img
                        src={selectedProduct.image}
                        alt="صورة العرض المرفقة"
                        className="w-full h-40 object-cover"
                      />
                      <div className="p-2 bg-slate-900/90 text-[10px] text-slate-400 flex items-center justify-between">
                        <span>مرفق بالمنشور: صورة {selectedProduct.name}</span>
                        <span className="text-emerald-400">معتمدة من المعرض</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 p-6 space-y-2">
                  <Sparkles className="w-8 h-8 text-slate-600" />
                  <p className="text-xs font-medium">
                    اضغط على "توليد المحتوى" لبدء الصياغة الذكية المخصصة.
                  </p>
                  <p className="text-[11px] text-slate-600">
                    سيتم تلقائياً تكييف المحتوى ليتناسب مع قيود وأسلوب المنصة المحددة.
                  </p>
                </div>
              )}
            </div>

            {/* Governance & Approval Action Buttons (Draft vs Review) */}
            {generatedResult && (
              <div className="pt-2 border-t border-slate-800 space-y-2">
                <div className="p-2 rounded-lg bg-amber-950/30 border border-amber-500/20 text-[11px] text-amber-300 flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>نظام الحوكمة: لا يُنشر المحتوى مباشرة، بل يُرسل لمسار المراجعة والاعتماد.</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleSendToApproval('draft')}
                    className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    حفظ كـ مسودة
                  </button>

                  <button
                    onClick={() => handleSendToApproval('review')}
                    className="py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-emerald-500/20"
                  >
                    <Send className="w-3.5 h-3.5" />
                    إرسال للمراجعة والاعتماد
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
