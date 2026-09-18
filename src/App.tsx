import React, { useState } from 'react';
import { MarketingCampaignInput, GeneralManagerDecision, CampaignOutput } from './types/manager';

export default function App() {
  const [campaignName, setCampaignName] = useState('حملة تقسيط عروض العيد');
  const [budget, setBudget] = useState(100);
  const [audience, setAudience] = useState<'فيسبوك' | 'إنستجرام' | 'تيك توك' | 'الكل'>('الكل');

  const [decision, setDecision] = useState<GeneralManagerDecision | null>(null);
  const [finalCampaign, setFinalCampaign] = useState<CampaignOutput | null>(null);

  const handleEvaluate = () => {
    const input: MarketingCampaignInput = {
      campaignName,
      budget,
      targetAudience: audience
    };
    
    const result: any = { 
      success: true, 
      message: "تم تقديم الطلب بنجاح ونقله للمدير العام", 
      campaign: { ...input, channels: [input.targetAudience], status: 'pending' } 
    };
    setDecision(result);
    setFinalCampaign(null);
  };

  const handleOwnerApproval = (approved: boolean) => {
    if (decision?.campaign) {
      const updated: any = { ...decision.campaign, status: approved ? 'approved' : 'rejected' };
      setFinalCampaign(updated);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', direction: 'rtl', backgroundColor: '#f4f6f8', minHeight: '100vh', color: '#222' }}>
      <h1 style={{ color: '#1a365d' }}>نظام المدير العام - معرض الغرابي للأقساط</h1>
      
      <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', marginBottom: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <h2>طلب حملة تسويقية جديدة</h2>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px', color: '#333' }}>اسم الحملة:</label>
          <input 
            type="text" 
            value={campaignName} 
            onChange={(e) => setCampaignName(e.target.value)} 
            style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #ccc', borderRadius: '4px', color: '#000', backgroundColor: '#fff' }} 
          />
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px', color: '#333' }}>الميزانية ($):</label>
          <input 
            type="number" 
            value={budget} 
            onChange={(e) => setBudget(Number(e.target.value))} 
            style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #ccc', borderRadius: '4px', color: '#000', backgroundColor: '#fff' }} 
          />
        </div>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px', color: '#333' }}>الجمهور المستهدف:</label>
          <select 
            value={audience} 
            onChange={(e) => setAudience(e.target.value as any)} 
            style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #ccc', borderRadius: '4px', color: '#000', backgroundColor: '#fff' }}
          >
            <option value="الكل">الكل (جميع المنصات)</option>
            <option value="فيسبوك">فيسبوك</option>
            <option value="إنستجرام">إنستجرام</option>
            <option value="تيك توك">تيك توك</option>
          </select>
        </div>
        <button 
          onClick={handleEvaluate} 
          style={{ padding: '10px 20px', backgroundColor: '#2b6cb0', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          تقديم الطلب للمدير العام
        </button>
      </div>

      {decision && (
        <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', marginBottom: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <h2>قرار المدير العام</h2>
          <p><strong>الحالة:</strong> {decision.success ? 'تم قبول الطلب والتخطيط' : 'تم رفض الطلب'}</p>
          <p><strong>الرسالة:</strong> {decision.message}</p>
          
          {decision.success && decision.campaign && (
            <div>
              <h3>تفاصيل الحملة الموصى بها</h3>
              <p><strong>القنوات:</strong> {decision.campaign.channels.join(', ')}</p>
              <p><strong>حالة الموافقة:</strong> {decision.campaign.status}</p>

              {!finalCampaign && (
                <div style={{ marginTop: '15px' }}>
                  <p style={{ color: '#c53030', fontWeight: 'bold' }}>مطلوب موافقة المالك لتفعيل الحملة:</p>
                  <button 
                    onClick={() => handleOwnerApproval(true)} 
                    style={{ padding: '8px 16px', backgroundColor: '#38a169', color: '#fff', border: 'none', borderRadius: '5px', marginLeft: '10px', cursor: 'pointer' }}
                  >
                    موافقة المالك
                  </button>
                  <button 
                    onClick={() => handleOwnerApproval(false)} 
                    style={{ padding: '8px 16px', backgroundColor: '#e53e3e', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                  >
                    رفض
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {finalCampaign && (
        <div style={{ background: '#e6fffa', border: '1px solid #38b2ac', padding: '20px', borderRadius: '8px' }}>
          <h2>النتيجة النهائية للحملة</h2>
          <p><strong>حالة الحملة النهائية:</strong> {finalCampaign.status === 'approved' ? 'معتمدة وجاهزة للنشر' : 'مرفوضة'}</p>
        </div>
      )}
    </div>
  );
}
