import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiService } from '../../services/api';

/**
 * لوحة "العقل المفكر" — نفس تصميم وحقول لوحة التحكم السابقة، لكن التنفيذ يمر
 * عبر خادم الغرابي (مفتاح المزود يبقى على الخادم) بدل استدعاء Gemini من المتصفح.
 */
export const BrainCommandView: React.FC = () => {
  const { showToast } = useApp();
  const [loading, setLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState('');
  const [generatedBy, setGeneratedBy] = useState('');

  const [taskType, setTaskType] = useState<'decision' | 'schedule' | 'behavior_analysis' | 'full_omnichannel'>('full_omnichannel');
  const [contextData, setContextData] = useState('');
  const [platform, setPlatform] = useState<string>('all');

  const handleHumanBrainProcess = async () => {
    if (!contextData.trim()) {
      showToast('يرجى إدخال الموقف، البيانات، أو الملاحظات الميدانية ليقوم العقل الآلي بتحليلها واستنتاج القرار.');
      return;
    }
    setLoading(true);
    setAiResponse('');
    setGeneratedBy('');
    try {
      const scope = platform === 'all'
        ? 'جميع منصات التواصل الاجتماعي الموحدة (فيسبوك، إنستغرام، تيك توك، يوتيوب، واتساب، تليغرام)'
        : platform;

      const modeInstruction: Record<string, string> = {
        full_omnichannel:
          'قدّم تحليلاً شاملاً: تفكير واستنتاج، توزيع مهام على كل منصة، ثم توجيهات تنفيذية واضحة لطاقم العمل.',
        decision: 'اتخذ قراراً تنفيذياً محدداً لزيادة المبيعات، مع تحديد واجبات الموظفين والردود الآلية.',
        schedule: 'حدّد أوقات الزخم المقترحة لكل منصة، ووضّح أن الأوقات تقديرية حتى تتوفر بيانات أداء فعلية.',
        behavior_analysis: 'حلّل نية العميل ومخاوفه الحقيقية، ثم اكتب رداً دافئاً ومقنعاً بالعامية العراقية.',
      };

      const message = `النطاق: ${scope}
نمط المطلوب: ${modeInstruction[taskType]}
المعطيات الميدانية: "${contextData.trim()}"`;

      const res = await apiService.agentChat({ message, context: { platform, taskType } });
      if (res.success && res.reply) {
        setAiResponse(res.reply);
        setGeneratedBy((res as any).generatedBy || '');
      } else {
        setAiResponse('لم يتم استلام استنتاج من العقل الآلي.');
      }
    } catch (error: any) {
      setAiResponse(`تعذر إكمال التحليل حالياً: ${error?.message || 'حاول مرة أخرى بعد قليل.'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
        <h1 className="text-lg font-black text-white">لوحة تحكم الذكاء الاصطناعي - معرض الغرابي للأقساط</h1>
        <p className="text-xs text-slate-400 mt-1.5">
          العقل الإداري المفكر لقيادة كافة المنصات وتوجيه المبيعات والخوارزميات
        </p>
      </header>

      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
        <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-3 mb-5">
          🧠 مركز القيادة والعقل المفكر للمدير الآلي
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
          <div>
            <label className="block mb-2 text-xs font-bold text-white">🌐 اختر المنصة أو نطاق العمل:</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full px-3 py-3 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500">
              <option value="all">🌍 كافة المنصات الموحدة (Omnichannel Brain)</option>
              <option value="facebook">فيسبوك (Facebook)</option>
              <option value="instagram">إنستغرام (Instagram)</option>
              <option value="tiktok">تيك توك (TikTok)</option>
              <option value="youtube">يوتيوب (YouTube / Shorts)</option>
              <option value="whatsapp">واتساب الأعمال (WhatsApp Business)</option>
              <option value="telegram">تليغرام (Telegram)</option>
            </select>
          </div>

          <div>
            <label className="block mb-2 text-xs font-bold text-white">⚙️ نمط التفكير والاستنتاج المطلوب:</label>
            <select
              value={taskType}
              onChange={(e: any) => setTaskType(e.target.value)}
              className="w-full px-3 py-3 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500">
              <option value="full_omnichannel">🚀 قيادة شاملة واستراتيجية لكل المنصات</option>
              <option value="decision">🎯 اتخاذ قرار تنفيذي وتوجيه مهام</option>
              <option value="schedule">⏰ دراسة أوقات الزخم والخوارزميات</option>
              <option value="behavior_analysis">🕵️ تحليل نية الزبون واستنتاج المخاوف</option>
            </select>
          </div>
        </div>

        <div className="mb-5">
          <label className="block mb-2 text-xs font-bold text-white">
            📝 أدخل المعطيات، أسباب التردد، أو موقف المبيعات الميداني:
          </label>
          <textarea
            rows={5}
            placeholder="مثال: نريد إطلاق حملة للأجهزة الكهربائية بالتقسيط للموظفين والمتقاعدين، حلل سلوك الجمهور العراقي وحدد المهام وأوقات الزخم لكل منصة (فيسبوك، تيك توك، يوتيوب، واتساب)..."
            value={contextData}
            onChange={(e) => setContextData(e.target.value)}
            className="w-full px-3 py-3 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500 box-border"
          />
        </div>

        <button
          onClick={handleHumanBrainProcess}
          disabled={loading}
          className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white text-sm font-bold transition cursor-pointer disabled:cursor-not-allowed">
          {loading ? '🧠 العقل التنفيذي يحلل ويقاطع البيانات...' : '🚀 تشغيل تحليل العقل الآلي الموحد'}
        </button>
      </div>

      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-5">
          <h3 className="text-sm font-bold text-white">التحليل التنفيذي والتوجيهات الموحدة</h3>
          {generatedBy && <span className="text-[10px] text-emerald-400 font-bold">{generatedBy}</span>}
        </div>
        {loading && <p className="text-xs text-blue-400 font-bold">جاري استدعاء المحرك الموحد لجميع المنصات...</p>}
        {!loading && aiResponse && (
          <div className="whitespace-pre-wrap leading-relaxed bg-slate-950 p-4 rounded-xl border border-slate-800 text-slate-200 text-xs">
            {aiResponse}
          </div>
        )}
        {!loading && !aiResponse && (
          <div className="text-center text-slate-500 py-10">
            <p className="text-sm">👈 قم بإدخال التفاصيل واضغط على الزر الأزرق لتوليد الاستراتيجية الموحدة لجميع وسائل التواصل الاجتماعي.</p>
          </div>
        )}
      </div>
    </div>
  );
};
