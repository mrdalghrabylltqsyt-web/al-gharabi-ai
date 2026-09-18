import React, { useState } from 'react';
import { GoogleGenAI } from '@google/genai';

// تهيئة محرك Gemini بالمفتاح الموجود في Netlify
const ai = new GoogleGenAI({ 
  apiKey: import.meta.env.VITE_GEMINI_API_KEY 
});

export default function App() {
  const [activeTab, setActiveTab] = useState<'leads' | 'campaigns' | 'analysis'>('campaigns');
  const [loading, setLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState('');

  // بيانات نموذج الحملة
  const [campaignName, setCampaignName] = useState('عرض تقسيط الأجهزة الذكية');
  const [budget, setBudget] = useState('250');
  const [targetAudience, setTargetAudience] = useState('بغداد والمحافظات - موظفين ومتقاعدين');

  // دالة طلب التحليل من Gemini 2.5 Flash
  const handleGenerateStrategy = async () => {
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
    <div style={{ fontFamily: 'sans-serif', direction: 'rtl', padding: '20px', backgroundColor: '#f4f6f9', minHeight: '100vh' }}>
      <header style={{ backgroundColor: '#1e293b', color: '#fff', padding: '15px 20px', borderRadius: '8px', marginBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '20px' }}>لوحة تحكم الذكاء الاصطناعي - معرض الغرابي للأقساط</h1>
        <p style={{ margin: '5px 0 0 0', fontSize: '14px', color: '#94a3b8' }}>المحرك الإستراتيجي الذكي لربط المبيعات وتوجيه الحملات</p>
      </header>

      {/* شريط التنقل */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <button 
          onClick={() => setActiveTab('campaigns')}
          style={{ padding: '10px 20px', borderRadius: '6px', border: 'none', cursor: 'pointer', backgroundColor: activeTab === 'campaigns' ? '#2563eb' : '#cbd5e1', color: activeTab === 'campaigns' ? '#fff' : '#0f172a' }}>
          إدارة الحملات والذكاء الاصطناعي
        </button>
        <button 
          onClick={() => setActiveTab('leads')}
          style={{ padding: '10px 20px', borderRadius: '6px', border: 'none', cursor: 'pointer', backgroundColor: activeTab === 'leads' ? '#2563eb' : '#cbd5e1', color: activeTab === 'leads' ? '#fff' : '#0f172a' }}>
          متابعة الطلبات (CRM)
        </button>
      </div>

      {/* قسم الحملات */}
      {activeTab === 'campaigns' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
            <h3 style={{ marginTop: 0 }}>تخطيط حملة تسويقية جديدة</h3>
            
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>اسم الحملة:</label>
            <input 
              type="text" 
              value={campaignName} 
              onChange={(e) => setCampaignName(e.target.value)}
              style={{ width: '100%', padding: '10px', marginBottom: '15px', borderRadius: '4px', border: '1px solid #ccc' }}
            />

            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>الميزانية ($):</label>
            <input 
              type="number" 
              value={budget} 
              onChange={(e) => setBudget(e.target.value)}
              style={{ width: '100%', padding: '10px', marginBottom: '15px', borderRadius: '4px', border: '1px solid #ccc' }}
            />

            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>الجمهور المستهدف:</label>
            <input 
              type="text" 
              value={targetAudience} 
              onChange={(e) => setTargetAudience(e.target.value)}
              style={{ width: '100%', padding: '10px', marginBottom: '15px', borderRadius: '4px', border: '1px solid #ccc' }}
            />

            <button 
              onClick={handleGenerateStrategy}
              disabled={loading}
              style={{ width: '100%', padding: '12px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}>
              {loading ? 'جاري التحليل بواسطة Gemini...' : 'توليد الخطة بالذكاء الاصطناعي'}
            </button>
          </div>

          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', minHeight: '300px' }}>
            <h3 style={{ marginTop: 0 }}>التحليل والتوجيه الإستراتيجي حياً</h3>
            {loading && <p>جاري معالجة البيانات واستدعاء Gemini 2.5 Flash...</p>}
            {!loading && aiResponse && (
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', backgroundColor: '#f8fafc', padding: '15px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                {aiResponse}
              </div>
            )}
            {!loading && !aiResponse && (
              <p style={{ color: '#64748b' }}>قم بإدخال بيانات الحملة واضغط على الزر لتوليد التوجيهات فوراً.</p>
            )}
          </div>
        </div>
      )}

      {/* قسم متابعة الطلبات */}
      {activeTab === 'leads' && (
        <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px' }}>
          <h3>قائمة طلبات الأقساط الواردة</h3>
          <p style={{ color: '#64748b' }}>هنا يتم تجميع كافة طلبات الواتساب والفيسبوك الموجهة لوحدات الأقساط لمعالجتها تلقائياً.</p>
        </div>
      )}
    </div>
  );
}
