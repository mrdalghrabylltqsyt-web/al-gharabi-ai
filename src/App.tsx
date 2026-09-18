import React, { useState } from 'react';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ 
  apiKey: import.meta.env.VITE_GEMINI_API_KEY 
});

export default function App() {
  const [activeTab, setActiveTab] = useState<'leads' | 'campaigns'>('campaigns');
  const [loading, setLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState('');

  const [campaignName, setCampaignName] = useState('');
  const [budgetType, setBudgetType] = useState<'free' | 'paid'>('free');
  const [budget, setBudget] = useState('0');
  const [targetAudience, setTargetAudience] = useState('');

  const handleGenerateStrategy = async () => {
    if (!campaignName) {
      alert('يرجى إدخال اسم الحملة أو فكرة المنشور');
      return;
    }
    setLoading(true);
    setAiResponse('');
    try {
      const isFree = budgetType === 'free' || !budget || budget === '0';
      const prompt = `
        أنت المساعد الذكي المباشر لـ "معرض الغرابي للأقساط" في العراق.
        قام المدير بطلب استراتيجية للحملة التالية:
        - اسم الحملة/الفكرة: ${campaignName}
        - نوع التسويق والميزانية: ${isFree ? 'تسويق مجاني بالكامل (Organic / بدون إعلانات ممولة)' : `إعلان ممول بميزانية: ${budget}$`}
        - الجمهور المستهدف: ${targetAudience || 'جمهور عام في العراق (موظفين ومتقاعدين)'}

        يرجى تقديم خطة عمل تناسب السوق العراقي وضوابط التقسيط لدى معرض الغرابي:
        ${isFree ? `
        1. استراتيجية محتوى مجاني (فيديوهات Reels/TikTok ورسائل تفاعلية).
        2. أفضل أوقات النشر المجاني للحصول على أعلى نسبة مشاهدات وتفاعل.
        3. نص منشور جاهز للنسخ وصياغة جذابة للجمهور.
        4. قوالب ردود سريعة ومقنعة للرسائل (واتساب وماسنجر).
        ` : `
        1. جدول الزخم وأفضل ساعات النشر للاعلانات الممولة.
        2. كيفية توزيع الميزانية على منصات فيسبوك وإنستغرام وتيك توك.
        3. قوالب ردود سريعة ومقنعة للرد على استفسارات الزبائن.
        `}
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      setAiResponse(response.text || 'لم يتم استلام رد من الذكاء الاصطناعي.');
    } catch (error) {
      console.error(error);
      setAiResponse('حدث خطأ أثناء الاتصال بمحرك الذكاء الاصطناعي. يرجى التأكد من ضبط المفتاح.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif', direction: 'rtl', padding: '20px', backgroundColor: '#e2e8f0', minHeight: '100vh', color: '#0f172a' }}>
      <header style={{ backgroundColor: '#0f172a', color: '#ffffff', padding: '20px', borderRadius: '10px', marginBottom: '25px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 'bold' }}>لوحة تحكم الذكاء الاصطناعي - معرض الغرابي للأقساط</h1>
        <p style={{ margin: '8px 0 0 0', fontSize: '14px', color: '#94a3b8' }}>المحرك الإستراتيجي الذكي لربط المبيعات وتوجيه الحملات</p>
      </header>

      {/* شريط التنقل */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
        <button 
          onClick={() => setActiveTab('campaigns')}
          style={{ padding: '12px 24px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px', backgroundColor: activeTab === 'campaigns' ? '#2563eb' : '#94a3b8', color: '#ffffff' }}>
          📢 إدارة الحملات والمحتوى
        </button>
        <button 
          onClick={() => setActiveTab('leads')}
          style={{ padding: '12px 24px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px', backgroundColor: activeTab === 'leads' ? '#2563eb' : '#94a3b8', color: '#ffffff' }}>
          👥 متابعة الطلبات (CRM)
        </button>
      </div>

      {/* قسم الحملات */}
      {activeTab === 'campaigns' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          
          {/* نموذج إدخال البيانات */}
          <div style={{ backgroundColor: '#ffffff', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#1e293b', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>تخطيط حملة / محتوى جديد</h3>
            
            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a', fontSize: '15px' }}>
                📌 اسم الحملة / فكرة المنشور:
              </label>
              <input 
                type="text" 
                placeholder="مثال: فيديو تقسيط الشاشات والمكيفات بدون مقدم"
                value={campaignName} 
                onChange={(e) => setCampaignName(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '2px solid #cbd5e1', fontSize: '14px', color: '#0f172a', backgroundColor: '#ffffff', boxSizing: 'border-box' }}
              />
            </div>

            {/* خيار الميزانية */}
            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a', fontSize: '15px' }}>
                💰 نوع التمويل والميزانية:
              </label>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <button 
                  type="button"
                  onClick={() => { setBudgetType('free'); setBudget('0'); }}
                  style={{ flex: 1, padding: '10px', borderRadius: '6px', border: '2px solid #16a34a', backgroundColor: budgetType === 'free' ? '#16a34a' : '#ffffff', color: budgetType === 'free' ? '#ffffff' : '#16a34a', fontWeight: 'bold', cursor: 'pointer' }}>
                  🎁 مجاني (بدون تمويل)
                </button>
                <button 
                  type="button"
                  onClick={() => setBudgetType('paid')}
                  style={{ flex: 1, padding: '10px', borderRadius: '6px', border: '2px solid #2563eb', backgroundColor: budgetType === 'paid' ? '#2563eb' : '#ffffff', color: budgetType === 'paid' ? '#ffffff' : '#2563eb', fontWeight: 'bold', cursor: 'pointer' }}>
                  💳 إعلان ممول ($)
                </button>
              </div>

              {budgetType === 'paid' && (
                <input 
                  type="number" 
                  placeholder="أدخل الميزانية بالدولار (مثال: 50)"
                  value={budget} 
                  onChange={(e) => setBudget(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '2px solid #cbd5e1', fontSize: '14px', color: '#0f172a', backgroundColor: '#ffffff', boxSizing: 'border-box' }}
                />
              )}
            </div>

            <div style={{ marginBottom: '22px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a', fontSize: '15px' }}>
                🎯 الجمهور المستهدف:
              </label>
              <input 
                type="text" 
                placeholder="مثال: موظفين ومتقاعدين في بغداد والمحافظات"
                value={targetAudience} 
                onChange={(e) => setTargetAudience(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '2px solid #cbd5e1', fontSize: '14px', color: '#0f172a', backgroundColor: '#ffffff', boxSizing: 'border-box' }}
              />
            </div>

            <button 
              onClick={handleGenerateStrategy}
              disabled={loading}
              style={{ width: '100%', padding: '14px', backgroundColor: loading ? '#94a3b8' : '#16a34a', color: '#ffffff', border: 'none', borderRadius: '8px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '16px', fontWeight: 'bold', transition: 'background-color 0.2s' }}>
              {loading ? '⏳ جاري التوليد بواسطة Gemini...' : '🚀 توليد الخطة والمحتوى'}
            </button>
          </div>

          {/* عرض التحليل */}
          <div style={{ backgroundColor: '#ffffff', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', minHeight: '350px' }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#1e293b', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>الاستراتيجية والمحتوى الجاهز</h3>
            {loading && <p style={{ color: '#2563eb', fontWeight: 'bold' }}>جاري المعالجة واستدعاء Gemini 2.5 Flash...</p>}
            {!loading && aiResponse && (
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.7', backgroundColor: '#f8fafc', padding: '18px', borderRadius: '8px', border: '1px solid #cbd5e1', color: '#1e293b', fontSize: '14px' }}>
                {aiResponse}
              </div>
            )}
            {!loading && !aiResponse && (
              <div style={{ textAlign: 'center', color: '#64748b', marginTop: '60px' }}>
                <p style={{ fontSize: '16px' }}>👈 قم بإدخال الفكرة، اختر نوع التمويل (مجاني أو ممول)، ثم اضغط على الزر الأخضر.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* قسم متابعة الطلبات */}
      {activeTab === 'leads' && (
        <div style={{ backgroundColor: '#ffffff', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
          <h3 style={{ marginTop: 0, color: '#1e293b' }}>قائمة طلبات الأقساط الواردة (CRM)</h3>
          <p style={{ color: '#64748b' }}>هنا يتم تجميع كافة طلبات الواتساب والفيسبوك الموجهة لوحدات الأقساط لمعالجتها تلقائياً.</p>
        </div>
      )}
    </div>
  );
}
