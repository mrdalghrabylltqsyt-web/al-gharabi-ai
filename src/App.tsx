import React, { useState } from 'react';
import { GoogleGenAI } from '@google/genai';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

export default function App() {
  const [activeTab, setActiveTab] = useState<'brain_manager' | 'campaigns'>('brain_manager');
  const [loading, setLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState('');

  // إعدادات المدير المفكر والمنصات الشاملة
  const [taskType, setTaskType] = useState<'decision' | 'schedule' | 'behavior_analysis' | 'full_omnichannel'>('full_omnichannel');
  const [contextData, setContextData] = useState('');
  const [platform, setPlatform] = useState<string>('all');

  // تشغيل المحرك الاستنتاجي الشامل
  const handleHumanBrainProcess = async () => {
    if (!contextData) {
      alert('يرجى إدخال الموقف، البيانات، أو الملاحظات الميدانية ليقوم العقل الآلي بتحليلها واستنتاج القرار.');
      return;
    }
    setLoading(true);
    setAiResponse('');
    try {
      const systemPrompt = `
        أنت "المدير التنفيذي الشامل للتسويق والمبيعات" لـ "معرض الغرابي للأقساط" في العراق.
        تتفوق بعقل إنساني يفكر، يطابق، يقاطع البيانات، يستنتج الثغرات، ويصنع القرارات والاستراتيجيات الميدانية الخوارزمية.
        المنصة أو النطاق المحدد للعمل: ${platform === 'all' ? 'جميع منصات التواصل الاجتماعي الموحدة (فيسبوك، إنستغرام، تيك توك، يوتيوب، واتساب، تليغرام)' : platform}.
      `;

      let promptText = '';

      if (taskType === 'full_omnichannel') {
        promptText = `
          ${systemPrompt}
          
          الموقف والبيانات الميدانية الواردة من إدارة المعرض:
          "${contextData}"

          المطلوب منك كـ (عقل إداري مفكر يغطي كافة وسائل التواصل):
          1. **التفكير والاستنتاج الإنساني**: تحليل النوايا، قراءة سلوك الزبون العراقي (موظفين، متقاعدين، ماستر كارد)، وتقاطع البيانات الحالية.
          2. **توزيع المهام والخوارزميات عبر المنصات**:
             - **فيسبوك وإنستغرام**: خطة النشر والردود المباشرة على الخاص والتعليقات.
             - **تيك توك ويوتيوب**: أفكار وسيناريوهات الفيديوهات القصيرة (Reels/Shorts) وساعات الزخم القاتلة.
             - **واتساب وتليغرام**: قوالب تحويل الاستفسارات إلى معاملات رسمية وإغلاق المبيعات.
          3. **توجيهات العمل والمتابعة**: تحديد قرارات تنفيذية واضحة لطاقم العمل والمعرض.
        `;
      } else if (taskType === 'decision') {
        promptText = `
          ${systemPrompt}
          الموقف: "${contextData}"
          المطلوب:
          1. تقاطع البيانات واستنتاج أسباب المشكلة/الفرصة.
          2. اتخاذ قرار تنفيذي صارم ومحدد لزيادة المبيعات.
          3. تحديد واجبات ومهام الموظفين والردود الآلية.
        `;
      } else if (taskType === 'schedule') {
        promptText = `
          ${systemPrompt}
          المعطيات: "${contextData}"
          المطلوب:
          1. تحديد أوقات الزخم الحقيقية لكل منصة (Facebook, TikTok, YouTube, Instagram).
          2. جدولة النشر والتفاعل الآلي بالدقائق لمضاعفة الوصول (Reach).
        `;
      } else if (taskType === 'behavior_analysis') {
        promptText = `
          ${systemPrompt}
          سلوك الزبون/التعليق: "${contextData}"
          المطلوب:
          1. تحليل واستنتاج المخاوف الحقيقية للزبون العراقي.
          2. صياغة رد بشري دافئ ومقنع جداً بالعامية العراقية لإقناعه وإكمال القسط.
        `;
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: promptText,
      });

      setAiResponse(response.text || 'لم يتم استلام استنتاج من العقل الآلي.');
    } catch (error: any) {
      console.error(error);
      setAiResponse(`حدث خطأ أثناء معالجة البيانات: ${error?.message || 'تأكد من المفتاح والموديل'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif', direction: 'rtl', padding: '20px', backgroundColor: '#e2e8f0', minHeight: '100vh', color: '#0f172a' }}>
      <header style={{ backgroundColor: '#0f172a', color: '#ffffff', padding: '20px', borderRadius: '10px', marginBottom: '25px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 'bold' }}>لوحة تحكم الذكاء الاصطناعي - معرض الغرابي للأقساط</h1>
        <p style={{ margin: '8px 0 0 0', fontSize: '14px', color: '#94a3b8' }}>العقل الإداري المفكر لقيادة كافة المنصات وتوجيه المبيعات والخوارزميات</p>
      </header>

      <div style={{ backgroundColor: '#ffffff', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
        <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#1e293b', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>🧠 مركز القيادة والعقل المفكر للمدير الآلي</h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a' }}>🌐 اختر المنصة أو نطاق العمل:</label>
            <select 
              value={platform} 
              onChange={(e) => setPlatform(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '2px solid #cbd5e1', fontSize: '14px', color: '#0f172a', backgroundColor: '#ffffff' }}>
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
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a' }}>⚙️ نمط التفكير والاستنتاج المطلوب:</label>
            <select 
              value={taskType} 
              onChange={(e: any) => setTaskType(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '2px solid #cbd5e1', fontSize: '14px', color: '#0f172a', backgroundColor: '#ffffff' }}>
              <option value="full_omnichannel">🚀 قيادة شاملة واستراتيجية لكل المنصات</option>
              <option value="decision">🎯 اتخاذ قرار تنفيذي وتوجيه مهام</option>
              <option value="schedule">⏰ دراسة أوقات الزخم والخوارزميات</option>
              <option value="behavior_analysis">🕵️ تحليل نية الزبون واستنتاج المخاوف</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: '22px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a' }}>
            📝 أدخل المعطيات، أسباب التردد، أو موقف المبيعات الميداني:
          </label>
          <textarea 
            rows={5}
            placeholder="مثال: نريد إطلاق حملة للأجهزة الكهربائية بالتقسيط للموظفين والمتقاعدين، حلل سلوك الجمهور العراقي وحدد المهام وأوقات الزخم لكل منصة (فيسبوك، تيك توك، يوتيوب، وواتساب)..."
            value={contextData} 
            onChange={(e) => setContextData(e.target.value)}
            style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '2px solid #cbd5e1', fontSize: '14px', color: '#0f172a', backgroundColor: '#ffffff', boxSizing: 'border-box' }}
          />
        </div>

        <button 
          onClick={handleHumanBrainProcess}
          disabled={loading}
          style={{ width: '100%', padding: '14px', backgroundColor: loading ? '#94a3b8' : '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '16px', fontWeight: 'bold' }}>
          {loading ? '🧠 العقل التنفيذي يحلل ويقاطع البيانات...' : '🚀 تشغيل تحليل العقل الآلي الموحد'}
        </button>
      </div>

      {/* عرض مخرجات العقل المفكر */}
      <div style={{ backgroundColor: '#ffffff', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', marginTop: '20px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#1e293b', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>التحليل التنفيذي والتوجيهات الموحدة</h3>
        {loading && <p style={{ color: '#2563eb', fontWeight: 'bold' }}>جاري استدعاء المحرك الموحد لجميع المنصات...</p>}
        {!loading && aiResponse && (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.7', backgroundColor: '#f8fafc', padding: '18px', borderRadius: '8px', border: '1px solid #cbd5e1', color: '#1e293b', fontSize: '14px' }}>
            {aiResponse}
          </div>
        )}
        {!loading && !aiResponse && (
          <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 0' }}>
            <p style={{ fontSize: '16px' }}>👈 قم بإدخال التفاصيل واضغط على الزر الأزرق لتوليد الاستراتيجية الموحدة لجميع وسائل التواصل الاجتماعي.</p>
          </div>
        )}
      </div>
    </div>
  );
}
