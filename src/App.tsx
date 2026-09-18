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
  const [budget, setBudget] = useState('');
  const [targetAudience, setTargetAudience] = useState('');

  const handleGenerateStrategy = async () => {
    if (!campaignName || !budget) {
      alert('يرجى إدخال اسم الحملة والميزانية على الأقل');
      return;
    }
    setLoading(true);
    setAiResponse('');
    try {
      const prompt = `
        أنت المساعد الذكي المباشر لـ "معرض الغرابي للأقساط" في العراق.
        قام المدير بطلب استراتيجية للحملة التالية:
        - اسم الحملة: ${campaignName}
        - الميزانية المخصصة: ${budget}$
        - الجمهور المستهدف: ${targetAudience}

        يرجى تقديم خطة عمل تسويقية وتنفيذية متكاملة تناسب السوق العراقي وضوابط التقسيط، وتتضمن:
        1. جدول الزخم وأفضل ساعات النشر على منصات (فيسبوك، إنستغرام، تيك توك).
        2. قوالب ردود سريعة ومقنعة للرد على استفسارات الزبائن عبر واتساب وماسنجر.
        3. توصيات لزيادة نسبة المبيعات وتسهيل معاملات المعاملات التقسيط.
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
          📢 إدارة الحملات والذكاء الاصطناعي
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
            <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#1e293b', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>تخطيط حملة تسويقية جديدة</h3>
            
            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a', fontSize: '15px' }}>
                📌 اسم الحملة:
              </label>
              <input 
                type="text" 
                placeholder="مثال: حملة تقسيط الشاشات والتكييف بدون مقدم"
                value={campaignName} 
                onChange={(e) => setCampaignName(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '2px solid #cbd5e1', fontSize: '14px', color: '#0f172a', backgroundColor: '#ffffff', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a', fontSize: '15px' }}>
                💰 الميزانية المخصصة ($):
              </label>
              <input 
                type="number" 
                placeholder="مثال: 150"
                value={budget} 
                onChange={(e) => setBudget(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '2px solid #cbd5e1', fontSize: '14px', color: '#0f172a', backgroundColor: '#ffffff', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: '22px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#0f172a', fontSize: '15px' }}>
                🎯 الجمهور المستهدف:
              </label>
              <input 
                type="text" 
                placeholder="مثال: موظفي الدولة والمتقاعدين في بغداد والمحافظات"
                value={targetAudience} 
                onChange={(e) => setTargetAudience(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '2px solid #cbd5e1', fontSize: '14px', color: '#0f172a', backgroundColor: '#ffffff', boxSizing: 'border-box' }}
              />
            </div>

            <button 
              onClick={handleGenerateStrategy}
              disabled={loading}
              style={{ width: '100%', padding: '14px', backgroundColor: loading ? '#94a3b8' : '#16a34a', color: '#ffffff', border: 'none', borderRadius: '8px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '16px', fontWeight: 'bold', transition: 'background-color 0.2s' }}>
              {loading ? '⏳ جاري التحليل بواسطة Gemini...' : '🚀 توليد الخطة بالذكاء الاصطناعي'}
            </button>
          </div>

          {/* عرض التحليل */}
          <div style={{ backgroundColor: '#ffffff', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', minHeight: '350px' }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#1e293b', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>التحليل والتوجيه الإستراتيجي حياً</h3>
            {loading && <p style={{ color: '#2563eb', fontWeight: 'bold' }}>جاري معالجة البيانات واستدعاء Gemini 2.5 Flash...</p>}
            {!loading && aiResponse && (
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.7', backgroundColor: '#f8fafc', padding: '18px', borderRadius: '8px', border: '1px solid #cbd5e1', color: '#1e293b', fontSize: '14px' }}>
                {aiResponse}
              </div>
            )}
            {!loading && !aiResponse && (
              <div style={{ textAlign: 'center', color: '#64748b', marginTop: '60px' }}>
                <p style={{ fontSize: '16px' }}>👈 قم بإدخال بيانات الحملة واضغط على الزر الأخضر لتوليد التوجيهات فوراً.</p>
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
