import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, RefreshCw, Clock3, AlertTriangle, ShieldCheck } from 'lucide-react';
import { apiService } from '../../services/api';
import { useApp } from '../../context/AppContext';

/**
 * المهام والمتابعات الحقيقية — فحص الشاشات (2026-10-25 #2).
 *
 * شاشة «المهام والمتابعات» كانت تستدعي مسارات CRM القديمة المعزولة (404 SCOPE_DISABLED)
 * فتظهر رسالة «هذا السطح خارج نطاق المشروع» وكل العدّادات صفر. الزبائن الحقيقيون
 * ومتابعاتهم يعيشون في العقل التجاري (من تعليقات/رسائل المنصات) — هذه اللوحة تعرضهم
 * من مصدرهم (قراءة فقط، للمالك) بلا لمس CRM.
 */

const STAGES: Array<[string, string]> = [
  ['NEW', 'جديد'], ['ENGAGED', 'متفاعل'], ['QUALIFIED', 'مؤهّل'], ['NEGOTIATING', 'تفاوض'],
  ['PROPOSAL_PENDING', 'عرض بانتظارك'], ['ESCALATED', 'مُصعَّد'], ['WON', 'تمّ البيع'], ['LOST', 'لم يتم'],
];
const ESCALATION_LABELS: Record<string, string> = { price_unverified: 'سؤال سعر لمنتج غير محدد — يحتاج ردّك', complaint: 'شكوى — تحتاج تدخّلك', negotiation_limit: 'تفاوض خارج الحدود', human_requested: 'طلب التحدث مع موظف' };
const PLATFORM_LABELS: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', threads: 'Threads', tiktok: 'TikTok', telegram: 'Telegram', whatsapp: 'WhatsApp' };

export const CommercialFollowUpsPanel: React.FC = () => {
  const { currentUser, setActiveTab, showToast } = useApp();
  const isOwner = currentUser?.role === 'owner';
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<string>('open');

  const load = useCallback(async () => {
    if (!isOwner) return;
    setLoading(true);
    try { setData(await apiService.getCommercialInbox()); }
    catch (e: any) { showToast(e?.message || 'تعذر تحميل الزبائن والمتابعات'); }
    finally { setLoading(false); }
  }, [isOwner, showToast]);
  useEffect(() => { void load(); }, [load]);

  const leads: any[] = useMemo(() => ((data?.leads || []) as any[]).filter((l) => !l.archived), [data]);
  const byStage = useMemo(() => Object.fromEntries(STAGES.map(([k]) => [k, leads.filter((l) => l.stage === k).length])), [leads]);
  const now = Date.now();
  const due = leads.filter((l) => l.nextFollowUpAt && Date.parse(l.nextFollowUpAt) <= now && !['WON', 'LOST'].includes(l.stage));
  const shown = leads
    .filter((l) => stage === 'all' ? true : stage === 'open' ? !['WON', 'LOST'].includes(l.stage) : stage === 'due' ? due.includes(l) : l.stage === stage)
    .sort((a, b) => Date.parse(b.lastInteractionAt || 0) - Date.parse(a.lastInteractionAt || 0));

  if (!isOwner) {
    return <section className="p-5 rounded-2xl glass text-xs text-slate-400" dir="rtl">الزبائن ومتابعاتهم متاحة للمالك فقط (بيانات زبائن حقيقية).</section>;
  }

  return (
    <section className="p-5 rounded-2xl glass space-y-4" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="font-black text-white flex items-center gap-2"><Users className="w-4 h-4 text-emerald-400" /> الزبائن المحتملون ومتابعاتهم (من المنصات)</h3>
          <p className="text-[11px] text-slate-400 mt-1">كل زبون علّق أو راسل باستفسار حقيقي، مرحلته، المنتج الذي سأل عنه، وموعد متابعته التالي.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setActiveTab('commercial_inbox')} className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs font-bold flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" /> بانتظار موافقتك ({data?.pendingDrafts ?? 0})
          </button>
          <button onClick={() => void load()} disabled={loading} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-white flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> تحديث
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {STAGES.map(([k, v]) => (
          <button key={k} onClick={() => setStage(k)} className={`p-3 rounded-xl text-right border ${stage === k ? 'border-emerald-500/60 bg-emerald-950/30' : 'border-slate-800 bg-slate-950/60'}`}>
            <p className="text-[10px] text-slate-400">{v}</p><p className="text-xl font-black text-white">{(byStage[k] || 0).toLocaleString('ar-IQ')}</p>
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 text-[11px] overflow-x-auto">
        {([['open', `المفتوحة (${leads.filter((l) => !['WON', 'LOST'].includes(l.stage)).length})`], ['due', `متابعة مستحقة الآن (${due.length})`], ['all', `الكل (${leads.length})`]] as Array<[string, string]>).map(([id, label]) => (
          <button key={id} onClick={() => setStage(id)} className={`px-2.5 py-1 rounded-lg font-semibold shrink-0 ${stage === id ? 'bg-emerald-500 text-slate-950' : 'bg-slate-950 text-slate-400'}`}>{label}</button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-center py-8 text-xs text-slate-500">{loading ? 'جارٍ التحميل...' : 'لا يوجد زبائن في هذا التصنيف.'}</p>
      ) : (
        <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
          {shown.slice(0, 150).map((l) => {
            const isDue = due.includes(l);
            return (
              <div key={l.id} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-white">{l.customerName || 'اسم غير متاح من المنصة'}</p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-200">{l.stageLabelAr || l.stage}</span>
                </div>
                <p className="text-[10px] text-slate-400">
                  {PLATFORM_LABELS[l.platform] || l.platform}
                  {l.interestedProductName ? ` • المنتج: ${l.interestedProductName}` : ' • المنتج غير محدد بعد'}
                  {` • تفاعلات: ${l.touches ?? 0}`}
                </p>
                {l.lastCustomerText && <p className="text-xs text-slate-200 leading-5">«{l.lastCustomerText}»</p>}
                <div className="flex flex-wrap gap-2 text-[10px]">
                  {l.nextFollowUpAt && (
                    <span className={`flex items-center gap-1 ${isDue ? 'text-amber-300' : 'text-cyan-300'}`}>
                      <Clock3 className="w-3 h-3" /> {isDue ? 'متابعة مستحقة' : 'المتابعة التالية'}: {new Date(l.nextFollowUpAt).toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  )}
                  {l.escalationReason && <span className="flex items-center gap-1 text-rose-300"><AlertTriangle className="w-3 h-3" /> {ESCALATION_LABELS[l.escalationReason] || l.escalationReason}</span>}
                  {l.hasPendingProposal && <span className="text-amber-300">عرض بانتظار تأكيدك</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
