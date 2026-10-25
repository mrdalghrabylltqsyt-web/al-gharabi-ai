import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, RefreshCw, CheckCircle2, Clock, ExternalLink, ShieldCheck, MessageCircle } from 'lucide-react';
import { apiService } from '../../services/api';
import { useApp } from '../../context/AppContext';
import type { SocialCommentRecord, SocialReplyRecord } from '../../types';

/**
 * الوارد الحقيقي من المنصات المتصلة — فحص الشاشات (2026-10-25 #2).
 *
 * كانت شاشة «مركز خدمة العملاء» تقرأ محادثات CRM اليدوية فقط (فارغة) وتعرض «لا توجد
 * محادثات»، بينما الخادم يحمل كل تعليقات/رسائل الزبائن المستلمة فعلاً من فيسبوك
 * وإنستغرام ويوتيوب وثريدز، ومسودات ردود بانتظار موافقة المالك. هذه اللوحة تعرضها
 * من مصدرها (قراءة فقط) مع حالة الرد الحقيقية لكل تفاعل — بلا أي بيانات مُحاكاة.
 */

const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', threads: 'Threads', tiktok: 'TikTok',
  telegram: 'Telegram', whatsapp: 'WhatsApp', x: 'X', snapchat: 'Snapchat', google_business: 'Google Business',
};

const INTENT_LABELS: Record<string, string> = {
  business_inquiry: 'استفسار تجاري', question: 'سؤال', complaint: 'شكوى', praise: 'مدح', spam: 'سبام', other: 'أخرى',
};

const TOPIC_LABELS: Record<string, string> = {
  price: 'سعر', installment: 'تقسيط', installment_terms: 'شروط التقسيط', availability: 'توفّر', location: 'الموقع', delivery: 'توصيل',
};

type Filter = 'all' | 'inquiries' | 'unanswered';

export const PlatformInboundPanel: React.FC = () => {
  const { currentUser, setActiveTab, showToast } = useApp();
  const isOwner = currentUser?.role === 'owner';
  const [comments, setComments] = useState<SocialCommentRecord[]>([]);
  const [replies, setReplies] = useState<Record<string, SocialReplyRecord>>({});
  const [pendingDrafts, setPendingDrafts] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [platform, setPlatform] = useState<string>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, r] = await Promise.all([apiService.getSocialComments(undefined, 1000), apiService.getSocialReplies()]);
      setComments([...(c.comments || [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
      setReplies(Object.fromEntries((r.replies || []).map((x) => [`${x.platform}:${x.externalId}`, x])));
      if (isOwner) {
        try {
          const inbox: any = await apiService.getCommercialInbox();
          setPendingDrafts(typeof inbox?.pendingDrafts === 'number' ? inbox.pendingDrafts : null);
        } catch { setPendingDrafts(null); }
      }
    } catch (e: any) {
      showToast(e?.message || 'تعذر تحميل الوارد من المنصات');
    } finally {
      setLoading(false);
    }
  }, [isOwner, showToast]);

  useEffect(() => { void load(); }, [load]);

  const isInquiry = (c: SocialCommentRecord): boolean => {
    const k: any = c.classification || {};
    return k.isBusinessInquiry === true || k.intent === 'business_inquiry' || ['price', 'installment', 'installment_terms', 'availability'].includes(String(k.topic || ''));
  };
  const replyOf = (c: SocialCommentRecord) => replies[`${c.platform}:${c.externalId}`];
  const answered = (c: SocialCommentRecord) => Boolean(replyOf(c)?.delivered);

  const platformsPresent = useMemo(() => Array.from(new Set(comments.map((c) => c.platform))), [comments]);
  const rows = useMemo(() => comments.filter((c) => {
    if (platform !== 'all' && c.platform !== platform) return false;
    if (filter === 'inquiries' && !isInquiry(c)) return false;
    if (filter === 'unanswered' && answered(c)) return false;
    if (q.trim() && !(`${c.text} ${c.authorName || ''}`).includes(q.trim())) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [comments, platform, filter, q, replies]);

  const stats = useMemo(() => ({
    total: comments.length,
    inquiries: comments.filter(isInquiry).length,
    answered: comments.filter(answered).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [comments, replies]);

  return (
    <section className="p-5 rounded-2xl glass space-y-4" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="font-black text-white flex items-center gap-2"><Inbox className="w-4 h-4 text-emerald-400" /> الوارد الحقيقي من المنصات المتصلة</h3>
          <p className="text-[11px] text-slate-400 mt-1">تعليقات ورسائل الزبائن كما استُلمت فعلاً، مع تصنيف النية وحالة الرد. الإرسال يمر بموافقة المالك.</p>
        </div>
        <div className="flex items-center gap-2">
          {isOwner && (
            <button onClick={() => setActiveTab('commercial_inbox')} className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs font-bold flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" /> ردود بانتظار موافقتك{pendingDrafts !== null ? ` (${pendingDrafts})` : ''}
            </button>
          )}
          <button onClick={() => void load()} disabled={loading} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-white flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> تحديث
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800"><p className="text-[10px] text-slate-400">كل الوارد</p><p className="text-lg font-black text-white">{stats.total.toLocaleString('ar-IQ')}</p></div>
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800"><p className="text-[10px] text-slate-400">استفسارات تجارية</p><p className="text-lg font-black text-emerald-300">{stats.inquiries.toLocaleString('ar-IQ')}</p></div>
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800"><p className="text-[10px] text-slate-400">رُدّ عليها فعلياً</p><p className="text-lg font-black text-cyan-300">{stats.answered.toLocaleString('ar-IQ')}</p></div>
      </div>

      <div className="flex flex-col gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث في نص الزبون أو اسمه..." className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
          {(['all', ...platformsPresent]).map((p) => (
            <button key={p} onClick={() => setPlatform(p)} className={`px-2.5 py-1 rounded-lg font-semibold shrink-0 ${platform === p ? 'bg-emerald-500 text-slate-950' : 'bg-slate-950 text-slate-400 hover:text-white'}`}>
              {p === 'all' ? `كل المنصات (${comments.length})` : `${PLATFORM_LABELS[p] || p} (${comments.filter((c) => c.platform === p).length})`}
            </button>
          ))}
          <span className="w-px h-4 bg-slate-700 mx-1 shrink-0" />
          {([['all', 'الكل'], ['inquiries', 'استفسارات فقط'], ['unanswered', 'بلا رد']] as Array<[Filter, string]>).map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} className={`px-2.5 py-1 rounded-lg font-semibold shrink-0 ${filter === id ? 'bg-slate-200 text-slate-950' : 'bg-slate-950 text-slate-400 hover:text-white'}`}>{label}</button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-center py-8 text-xs text-slate-500">{loading ? 'جارٍ التحميل...' : 'لا يوجد وارد يطابق التصفية.'}</p>
      ) : (
        <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
          {rows.slice(0, 150).map((c) => {
            const k: any = c.classification || {};
            const rep = replyOf(c);
            return (
              <div key={c.id} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="flex items-center gap-1.5 text-slate-300 font-bold">
                    <MessageCircle className="w-3 h-3 text-emerald-400" />
                    {PLATFORM_LABELS[c.platform] || c.platform} • {c.kind === 'message' ? 'رسالة' : 'تعليق'} • {c.authorName || 'اسم غير متاح من المنصة'}
                  </span>
                  <span className="text-slate-500">{Number.isFinite(Date.parse(c.createdAt)) ? new Date(c.createdAt).toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' }) : ''}</span>
                </div>
                <p className="text-xs text-white leading-5 whitespace-pre-line">{c.text}</p>
                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                  {k.intent && <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{INTENT_LABELS[k.intent] || k.intent}</span>}
                  {k.topic && TOPIC_LABELS[k.topic] && <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300">{TOPIC_LABELS[k.topic]}</span>}
                  {rep?.delivered
                    ? <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> رُدّ عليه</span>
                    : <span className="px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 flex items-center gap-1"><Clock className="w-3 h-3" /> بلا رد مُسلَّم</span>}
                </div>
                {rep?.delivered && rep.text && <p className="text-[11px] text-cyan-200/90 bg-cyan-950/20 rounded-lg p-2">ردّنا: {rep.text}</p>}
              </div>
            );
          })}
          {rows.length > 150 && <p className="text-[10px] text-slate-500 text-center">يُعرض أحدث 150 من {rows.length}.</p>}
        </div>
      )}
      {isOwner && (
        <button onClick={() => setActiveTab('social_manager')} className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1">
          الرد اليدوي على تعليق محدد من مدير النشر <ExternalLink className="w-3 h-3" />
        </button>
      )}
    </section>
  );
};
