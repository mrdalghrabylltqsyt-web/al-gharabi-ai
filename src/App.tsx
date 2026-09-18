import React, { useState } from 'react';
import { GoogleGenAI } from '@google/genai';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

export default function App() {
  const [activeTab, setActiveTab] = useState<'brain_manager' | 'campaigns'>('brain_manager');
  const [loading, setLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState('');

  // متغيرات عقل المدير الذكي
  const [taskType, setTaskType] = useState<'decision' | 'schedule' | 'behavior_analysis'>('decision');
  const [contextData, setContextData] = useState('');
  const [platform, setPlatform] = useState<'facebook' | 'tiktok' | 'instagram'>('facebook');

  // تشغيل المحرك التحليلي الاستنتاجي
  const handleHumanBrainProcess = async () => {
    if (!contextData) {
      alert('يرجى إدخال البيانات أو الملاحظة الميدانية ليتولى العقل الآلي تحليلها واستنتاج القرار.');
      return;
    }
    setLoading(true);
    setAiResponse('');
    try {
      let systemPrompt = `
        أنت لست مجرد بوت ردود، أنت "مدير تسويق ومبيعات تنفيذي بعقل بشري مفكر" لـ "معرض الغرابي للأقساط" في العراق.
        تتمتع بقدرة عالية على الاستنتاج، المقاطعة التحليلية للبيانات، واتخاذ القرارات التجارية الذكية.
      `;

      let promptText = '';

      if (taskType === 'decision') {
        promptText = `
          ${systemPrompt}
          
          الموقف والبيانات الحالية من المعرض:
          "${contextData}"

          المطلوب منك كـ (عقل مفكر ومحلل):
          1. **التقاط واستنتاج المشكلة/الفرصة**: تحليل الموقف برؤية بشرية عميقة.
          2. **مطابقة وتقاطع البيانات**: ربط حالة السوق العراقي بسلوك الزبون (موظفين، متقاعدين، ماستر كارد).
          3. **تحديد واجبات ومهام فورية**: توزيع المهام للموظفين أو لفرق النشر والردود.
          4. **الخوارزمية المقترحة**: التكتيك الذكي للتعامل مع هذا الموقف لزيادة مبيعات الأقساط.
        `;
      } else if (taskType === 'schedule') {
        promptText = `
          ${systemPrompt}
          
          هدف الحملة/المحتوى والملاحظات الزمنية:
          "${contextData}"

          المطلوب منك كـ (مدير خوارزميات وأوقات زخم):
          1. **تحديد ساعات الزخم الحقيقية**: تحديد أفضل أوقات النشر والتفاعل على منصة ${platform} للجمهور العراقي.
          2. **جدولة المحتوى والتفاعل**: وضع جدول زمني بالدقائق والساعات للتحكم بالنشر والرد الآلي.
          3. **خوارزمية رفع التفاعل**: الخطوات التكتيكية لرفع الريتش (Reels/Posts) واستفزاز خوارزمية المنصة بالردود.
        `;
      } else if (taskType === 'behavior_analysis') {
        promptText = `
          ${systemPrompt}
          
          سلوك وتصرف الزبون أو التعليق المعقد:
          "${contextData}"

          المطلوب منك كـ (عقل إنساني يستنتج النوايا):
          1. **استنتاج نية الزبون**: هل هو جاد؟ متردد؟ متخوف من الفائدة؟ أم خائف من الشروط؟
          2. **الرد العاطفي والمنطقي المفصل**: صياغة رد بشري دافئ ومقنع جداً باللهجة العراقية المباشرة يتجاوز مخاوفه.
          3. **تحديد الخطوة التالية (Next Action)**: تحديد الإجراء التالي لإغلاق الصفقة وتوجيهه للمعرض.
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
        <p style={{ margin: '8px 0 0 0', fontSize: '14px', color: '#94a3b8' }}>العقل الإداري المفكر لربط المبيعات وتوجيه الخوارزميات</p>
      </header>

      {/* شريط التنقل */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
        <button 
          onClick={() => { setActiveTab('brain_manager'); setAiResponse(''); }}
          style={{ padding: '12px 24px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px', backgroundColor: activeTab === 'brain_manager' ? '#2563eb' : '#94a3b8', color: '#ffffff' }}>
          🧠 العقل المفكر (تحليل، قرارات، وأوقات زخم)
        </button>
      </div>

      {/* قسم العقل المفكر */}
      {activeTab === 'brain_manager' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div style={{ backgroundColor: '#ffffff', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#1e293b', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>محاكاة العقل الإداري والاستنتاج</h3>
            
            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a' }}>🌐 اختر المنصة الهدف:</label>
              <select 
                value={platform} 
                onChange={(e: any) => setPlatform(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '2px solid #cbd5e1', fontSize: '14px', color: '#0f172a', backgroundColor: '#ffffff' }}>
                <option value="facebook">فيسبوك (Facebook)</option>
                <option value="tiktok">تيك توك (TikTok)</option>
                <option value="instagram">إنستغرام (Instagram)</option>
              </select>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a' }}>⚙️ نمط التفكير المطلوب:</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  type="button" 
                  onClick={() => setTaskType('decision')}
                  style={{ flex: 1, padding: '10px', borderRadius: '6px', border: '2px solid #2563eb', backgroundColor: taskType === 'decision' ? '#2563eb' : '#ffffff', color: taskType === 'decision' ? '#ffffff' : '#2563eb', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}>
                  🎯 اتخاذ قرار وتوجيه مهام
                </button>
                <button 
                  type="button" 
                  onClick={() => setTaskType('schedule')}
                  style={{ flex: 1, padding: '10px', borderRadius: '6px', border: '2px solid #2563eb', backgroundColor: taskType === 'schedule' ? '#2563eb' : '#ffffff', color: taskType === 'schedule' ? '#ffffff' : '#2563eb', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}>
                  ⏰ أوقات الزخم والخوارزميات
                </button>
                <button 
                  type="button" 
                  onClick={() => setTaskType('behavior_analysis')}
                  style={{ flex: 1, padding: '10px', borderRadius: '6px', border: '2px solid #2563eb', backgroundColor: taskType === 'behavior_analysis' ? '#2563eb' : '#ffffff', color: taskType === 'behavior_analysis' ? '#ffffff' : '#2563eb', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}>
                  🕵️ تحليل سلوك نية الزبون
                </button>
              </div>
            </div>

            <div style={{ marginBottom: '22px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a' }}>
                📝 أدخل المعطيات، المواقف، أو سلوك الزبون للتحليل:
              </label>
              <textarea 
                rows={5}
                placeholder="مثال: الزبائن بالتعليقات يتساءلون عن أسعار الشاشات لكن عند معرفة الاستقطاع المالي يختفون، أو: نريد تحديد أفضل ساعات النشر ليوم الخميس لرواتب المتقاعدين..."
                value={contextData} 
                onChange={(e) => setContextData(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '2px solid #cbd5e1', fontSize: '14px', color: '#0f172a', backgroundColor: '#ffffff', boxSizing: 'border-box' }}
              />
            </div>

            <button 
              onClick={handleHumanBrainProcess}
              disabled={loading}
              style={{ width: '100%', padding: '14px', backgroundColor: loading ? '#94a3b8' : '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '16px', fontWeight: 'bold' }}>
              {loading ? '🧠 العقل الآلي يفكر، يطابق، ويستنتج...' : '🚀 تشغيل تحليل العقل الآلي'}
            </button>
          </div>

          <div style={{ backgroundColor: '#ffffff', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', minHeight: '350px' }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#1e293b', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>التحليل والتوجيهات التنفيذية</h3>
            {loading && <p style={{ color: '#2563eb', fontWeight: 'bold' }}>جاري ربط المعطيات ومقاطعة البيانات...</p>}
            {!loading && aiResponse && (
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.7', backgroundColor: '#f8fafc', padding: '18px', borderRadius: '8px', border: '1px solid #cbd5e1', color: '#1e293b', fontSize: '14px' }}>
                {aiResponse}
              </div>
            )}
            {!loading && !aiResponse && (
              <div style={{ textAlign: 'center', color: '#64748b', marginTop: '60px' }}>
                <p style={{ fontSize: '16px' }}>👈 أدخل موقفاً عملياً أو استفساراً، ثم اضغط تشغيل لمشاهدة كيف يحلل المدير المفكر المعطيات ويستنتج القرارات.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
