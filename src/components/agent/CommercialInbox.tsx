/**
 * PR-S2 — «صندوق الزبائن» للعقل التجاري (للمالك فقط).
 *
 * يعرض الزبائن المحتملين الحقيقيين والمسودات بانتظار موافقة المالك، ويسمح بالموافقة/
 * التعديل/الرفض. **لا ادّعاء محلي**: كل الحالات من الخادم؛ والإرسال يقع على الخادم عبر
 * المنفّذ المركزي وحده. الوضع الافتراضي «موافقة» (لا إرسال تلقائي).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { apiService } from '../../services/api';
import { CommercialMonthlyReport } from './CommercialMonthlyReport';
import { useApp } from '../../context/AppContext';
import {
  Inbox, RefreshCw, CheckCircle2, XCircle, Pencil, Send, AlertTriangle,
  Clock, User, Package, MessageSquare, Loader2, ChevronDown, ChevronUp, ShieldAlert,
} from 'lucide-react';

interface InteractionEntry {
  direction: 'customer' | 'business';
  text: string;
  at: string;
  delivered: boolean;
  providerReplyId: string | null;
}

interface CustomerContext {
  authorName: string;
  authorId: string | null;
  customerText: string | null;
  customerTextAt: string | null;
  post: { id: string; firstLine: string | null; thumbnailUrl: string | null } | null;
  product: { id: string | null; name: string } | null;
  permalinkUrl: string | null;
  platform: string;
  platformLabelAr: string;
  recentInteractions: InteractionEntry[];
  draftKind: string | null;
}

interface LeadRow {
  id: string;
  platform: string;
  customerName: string | null;
  interestedProductName: string | null;
  stage: string;
  stageLabelAr: string;
  touches: number;
  lastInteractionAt: string;
  followUpLabelAr: string;
  escalationReason: string | null;
  hasPendingProposal: boolean;
  /** PR-S5: هل السؤال حقيقي؟ وهل العميل مؤرشف (إيموجي/مدح فقط)؟ */
  qualifiedQuestion?: boolean;
  archived?: boolean;
  backfill?: boolean;
  context?: CustomerContext | null;
}

interface DraftRow {
  id: string;
  leadId: string;
  platform: string;
  kind: 'comment' | 'message';
  purpose: string;
  purposeLabelAr: string;
  text: string;
  createdAt: string;
  windowExpiresAt: string | null;
  status: string;
  statusLabelAr: string;
  approvedText: string | null;
  deliveryStatus: 'sent' | 'failed' | null;
  providerReplyId: string | null;
  deliveryError: string | null;
  customerName: string | null;
  interestedProductName: string | null;
  stage: string | null;
  escalationReason: string | null;
  draftKindLabelAr?: string | null;
  context?: CustomerContext | null;
}

/**
 * PR-S4 (البند 3) — سياق الزبون على البطاقة: اسم الكاتب الحقيقي (أو البديل الصريح
 * «اسم غير متاح من Meta (…آخر 4 أرقام)»)، نص الزبون ووقته، المنشور (أول سطر + صورة
 * مصغّرة + منتج)، زر «فتح على فيسبوك/إنستغرام» من رابط Meta الحقيقي فقط، آخر 5
 * تفاعلات، ونوع المسودة. لا كلمة «زبون» ولا رابط مختلق.
 */
function CustomerContextBlock({ context, compact = false }: { context?: CustomerContext | null; compact?: boolean }) {
  if (!context) return null;
  const hasRealLink = typeof context.permalinkUrl === 'string' && context.permalinkUrl.startsWith('http');
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-950/60 p-2 ${compact ? 'mt-2' : 'mb-2'}`}>
      <div className="text-[11px] text-slate-300 flex items-center gap-2 flex-wrap">
        <User className="w-3 h-3 text-emerald-300" />
        <span className="font-bold text-slate-100">{context.authorName}</span>
        {context.customerTextAt ? <span className="text-slate-500">• {new Date(context.customerTextAt).toLocaleString('ar-IQ')}</span> : null}
      </div>

      {context.customerText ? (
        <div className="mt-1.5 text-[11px] text-slate-200 whitespace-pre-wrap bg-slate-900/60 rounded-lg p-2 border border-slate-800">
          <span className="text-slate-500">كتب: </span>{context.customerText}
        </div>
      ) : null}

      {context.post ? (
        <div className="mt-2 flex items-center gap-2">
          {context.post.thumbnailUrl ? (
            <img src={context.post.thumbnailUrl} alt="صورة المنشور" className="w-10 h-10 rounded-lg object-cover border border-slate-700" />
          ) : null}
          <div className="text-[11px] text-slate-400 flex items-center gap-1 flex-wrap">
            <Package className="w-3 h-3" />
            <span>{context.post.firstLine || 'منشور بلا نص ظاهر'}</span>
            {context.product ? <span className="text-emerald-300">• منتج مرتبط: {context.product.name}</span> : null}
          </div>
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {hasRealLink ? (
          <a
            href={context.permalinkUrl as string}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-[10px] font-bold border border-slate-700"
          >
            ↗ فتح على {context.platformLabelAr}
          </a>
        ) : (
          <span className="text-[10px] text-slate-500">لا رابط من Meta لهذا التعليق (لا يُختلق رابط).</span>
        )}
        {context.draftKind ? (
          <span className="px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-bold">{context.draftKind}</span>
        ) : null}
      </div>

      {Array.isArray(context.recentInteractions) && context.recentInteractions.length > 0 ? (
        <div className="mt-2">
          <div className="text-[10px] text-slate-500 mb-1">آخر التفاعلات (منه ومنّا):</div>
          <div className="space-y-1">
            {context.recentInteractions.map((m, i) => (
              <div key={i} className="text-[10px] text-slate-300 flex items-start gap-1">
                <span className={m.direction === 'customer' ? 'text-slate-400' : 'text-emerald-300'}>{m.direction === 'customer' ? 'الزبون' : 'المعرض'}:</span>
                <span className="whitespace-pre-wrap flex-1">{m.text}</span>
                {m.at ? <span className="text-slate-600 shrink-0">{new Date(m.at).toLocaleDateString('ar-IQ')}</span> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const PLATFORM_AR: Record<string, string> = {
  facebook: 'فيسبوك', instagram: 'إنستغرام', tiktok: 'تيك توك', youtube: 'يوتيوب',
  telegram: 'تيليغرام', threads: 'ثريدز', whatsapp: 'واتساب', x: 'X', snapchat: 'سناب شات',
  google_business: 'جوجل بيزنس',
};

/** بطاقة مسودة واحدة (تُستخدم في قسمَي الأسئلة والمتابعات) — بلا ادّعاء محلي. */
interface DraftCardProps {
  key?: React.Key;
  d: DraftRow;
  busyId: string | null;
  editId: string | null;
  editText: string;
  setEditId: (v: string | null) => void;
  setEditText: (v: string) => void;
  decide: (id: string, kind: 'approve' | 'edit_approve' | 'reject', text?: string) => void | Promise<void>;
}

function DraftCard({ d, busyId, editId, editText, setEditId, setEditText, decide }: DraftCardProps) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-950/10 p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="text-[11px] text-slate-300 flex items-center gap-2 flex-wrap">
          <span className="px-1.5 py-0.5 rounded-md bg-slate-800 border border-slate-700">{PLATFORM_AR[d.platform] || d.platform}</span>
          <span className="px-1.5 py-0.5 rounded-md bg-slate-800 border border-slate-700">{d.purposeLabelAr}</span>
          <span className="px-1.5 py-0.5 rounded-md bg-slate-800 border border-slate-700">{d.kind === 'message' ? 'رسالة خاصة' : 'تعليق عام'}</span>
          {d.customerName ? <span className="text-slate-400">• {d.customerName}</span> : null}
          {d.interestedProductName ? <span className="text-slate-400">• {d.interestedProductName}</span> : null}
        </div>
        {d.kind === 'message' && d.windowExpiresAt ? (
          <span className="text-[10px] text-slate-500">نافذة Meta تنتهي: {new Date(d.windowExpiresAt).toLocaleString('ar-IQ')}</span>
        ) : null}
      </div>

      {d.draftKindLabelAr ? (
        <div className="text-[10px] text-amber-300 mb-1">نوع المسودة: {d.draftKindLabelAr}</div>
      ) : null}

      <CustomerContextBlock context={d.context} />

      {editId === d.id ? (
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          rows={3}
          className="w-full text-sm rounded-xl bg-slate-950 border border-slate-700 text-slate-100 p-2 mb-2"
        />
      ) : (
        <p className="text-sm text-slate-200 whitespace-pre-wrap mb-2">{d.text}</p>
      )}

      <div className="flex gap-2 flex-wrap">
        {editId === d.id ? (
          <>
            <button type="button" disabled={busyId === d.id} onClick={() => decide(d.id, 'edit_approve', editText)} className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1">
              {busyId === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} إرسال النص المعدّل
            </button>
            <button type="button" onClick={() => { setEditId(null); setEditText(''); }} className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold">إلغاء التعديل</button>
          </>
        ) : (
          <>
            <button type="button" disabled={busyId === d.id} onClick={() => decide(d.id, 'approve')} className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1">
              {busyId === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} موافقة
            </button>
            <button type="button" disabled={busyId === d.id} onClick={() => { setEditId(d.id); setEditText(d.text); }} className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold disabled:opacity-50 flex items-center gap-1">
              <Pencil className="w-3.5 h-3.5" /> تعديل ثم موافقة
            </button>
            <button type="button" disabled={busyId === d.id} onClick={() => decide(d.id, 'reject')} className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" /> رفض
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function CommercialInbox() {
  const { currentUser } = useApp() as any;
  const isOwner = currentUser?.role === 'owner';
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [modeBusy, setModeBusy] = useState(false);
  // PR-S5: قسم «متابعات» مطوي افتراضياً + تنظيف الكل.
  const [followUpsOpen, setFollowUpsOpen] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupNote, setCleanupNote] = useState<string | null>(null);
  // PR-S5: تشخيص قراءة-فقط لاسم الكاتب (from).
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagResult, setDiagResult] = useState<any>(null);
  // B8: نموذج «تم البيع» (ربط البيع بالمحادثة/الـlead).
  const [saleBusy, setSaleBusy] = useState(false);
  const [saleAmount, setSaleAmount] = useState('');
  const [saleProductName, setSaleProductName] = useState('');
  const [saleNote, setSaleNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await apiService.getCommercialInbox());
    } catch (e: any) {
      setError(e?.message || 'تعذر تحميل صندوق الزبائن');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openLead = async (id: string) => {
    try {
      setError(null);
      const res = await apiService.getCommercialLead(id);
      setSelectedLead(res);
    } catch (e: any) {
      setError(e?.message || 'تعذر تحميل تفاصيل الزبون');
    }
  };

  const decide = async (draftId: string, kind: 'approve' | 'edit_approve' | 'reject', text?: string) => {
    setBusyId(draftId); setNote(null); setError(null);
    try {
      const res = await apiService.decideCommercialDraft(draftId, kind, text);
      setNote(res?.note || (kind === 'reject' ? 'رُفضت المسودة.' : 'تمت الموافقة وأُرسلت.'));
      setEditId(null); setEditText('');
      await load();
      if (selectedLead?.lead?.id) await openLead(selectedLead.lead.id);
    } catch (e: any) {
      // مسودة منتهية/غير قابلة للإرسال تُعرض كسبب صريح بلا ادّعاء نجاح.
      setError(e?.message || 'تعذر تنفيذ القرار');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const changeMode = async (mode: 'approval' | 'auto') => {
    setModeBusy(true); setNote(null); setError(null);
    try {
      const res = await apiService.setCommercialSendMode(mode);
      setNote(res?.note || 'تم تغيير وضع الإرسال.');
      await load();
    } catch (e: any) {
      setError(e?.message || 'تعذر تبديل وضع الإرسال');
    } finally {
      setModeBusy(false);
    }
  };

  const decideProposal = async (leadId: string, proposalId: string, accept: boolean) => {
    setBusyId(`prop-${leadId}`); setNote(null); setError(null);
    try {
      const res = accept
        ? await apiService.confirmCommercialProposal(leadId, proposalId)
        : await apiService.rejectCommercialProposal(leadId, proposalId);
      setNote(res?.note || (accept ? 'تمت الصفقة (WON).' : 'رُفض العرض.'));
      await load();
      await openLead(leadId);
    } catch (e: any) {
      setError(e?.message || (accept ? 'تعذر تأكيد الصفقة' : 'تعذر رفض العرض'));
    } finally {
      setBusyId(null);
    }
  };

  // B8: تسجيل بيع حقيقي مرتبط بالمحادثة/الـlead (زر «تم البيع»).
  const recordSale = async (leadId: string, productName?: string | null, productId?: string | null) => {
    const amount = Number(saleAmount);
    const name = (saleProductName || productName || '').trim();
    setSaleBusy(true); setSaleNote(null); setError(null);
    try {
      const res = await apiService.recordCommercialSale({ leadId, amount, productName: name, productId: productId || undefined });
      setSaleNote(`سُجّل البيع: ${Number(res?.sale?.amount || amount).toLocaleString('ar-IQ')} د.ع — ${res?.sale?.sourcePlatform || ''}`);
      setSaleAmount(''); setSaleProductName('');
      await load();
      await openLead(leadId);
    } catch (e: any) {
      setError(e?.message || 'تعذر تسجيل البيع');
    } finally {
      setSaleBusy(false);
    }
  };

  // PR-S5: تنظيف المسودات المخالفة (للمالك) — بلا حذف؛ يُظهر العدد قبل/بعد.
  const runCleanup = async () => {
    setCleanupBusy(true); setNote(null); setError(null); setCleanupNote(null);
    try {
      const res = await apiService.cleanupCommercialDrafts();
      setCleanupNote(`قبل: ${res?.before?.pendingDrafts ?? '—'} مسودة معلّقة • بعد: ${res?.after?.pendingDrafts ?? '—'} • أُلغيت: ${res?.cancelledDrafts ?? 0} • أُرشف: ${res?.archivedLeads ?? 0}`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'تعذر التنظيف');
    } finally {
      setCleanupBusy(false);
    }
  };

  // PR-S5 (البند 4): تشخيص قراءة-فقط — هل يعيد Graph حقل from (اسم الكاتب)؟ لا يعدّل إعداداً.
  const runAuthorDiagnosis = async () => {
    setDiagBusy(true); setError(null);
    try {
      const res = await apiService.getCommercialAuthorNameDiagnosis();
      setDiagResult(res?.diagnosis || null);
    } catch (e: any) {
      setError(e?.message || 'تعذر تشخيص اسم الكاتب');
    } finally {
      setDiagBusy(false);
    }
  };

  // PR-S5: «رفض الكل في هذا القسم» مع تأكيد — يرفض كل مسودات القسم (بلا إرسال).
  const rejectAllInSection = async (list: DraftRow[], label: string) => {
    if (!list.length) return;
    if (!window.confirm(`تأكيد رفض كل مسودات «${label}» (${list.length})؟ لن يُرسل شيء.`)) return;
    setBusyId('bulk'); setNote(null); setError(null);
    let rejected = 0;
    try {
      for (const d of list) {
        try { await apiService.decideCommercialDraft(d.id, 'reject'); rejected += 1; } catch { /* تُعلن الحصيلة الفعلية */ }
      }
      setNote(`رُفضت ${rejected} من ${list.length} مسودة (بلا إرسال).`);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (!isOwner) {
    return (
      <div className="space-y-4">
        <section className="glass rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-slate-100 mb-1">صندوق الزبائن</h2>
          <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
            صندوق الزبائن متاح للمالك فقط.
          </div>
        </section>
      </div>
    );
  }

  const leads: LeadRow[] = Array.isArray(data?.leads) ? data.leads : [];
  const drafts: DraftRow[] = Array.isArray(data?.drafts) ? data.drafts : [];
  const pendingDrafts = drafts.filter((d) => d.status === 'pending');
  // PR-S5: فصل صريح — «جواب على سؤال» مقابل «متابعة 24/72». القسم الأول بالأحدث أولاً.
  const answerDrafts = pendingDrafts
    .filter((d) => d.purpose !== 'follow_up')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const followUpDrafts = pendingDrafts
    .filter((d) => d.purpose === 'follow_up')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const sendMode = data?.sendMode || 'approval';

  return (
    <div className="space-y-4">
      <section className="glass rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-slate-100 mb-1 flex items-center gap-2">
              <Inbox className="w-5 h-5 text-emerald-300" /> صندوق الزبائن — العقل التجاري
            </h2>
            <p className="text-xs text-slate-400">
              الزبائن المحتملون الحقيقيون، والرسائل التي يريد العقل إرسالها بانتظار موافقتك.
              لا يُرسل أي شيء تلقائياً في وضع الموافقة.
            </p>
          </div>
          <button type="button" onClick={() => void load()} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-2">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> تحديث
          </button>
        </div>

        {/* وضع الإرسال — مستقل عن مفتاح الإيقاف الطارئ */}
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <div className="text-xs text-slate-400 mb-2">وضع إرسال العقل التجاري (مستقل عن مفتاح الإيقاف الطارئ):</div>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              disabled={modeBusy}
              onClick={() => void changeMode('approval')}
              className={`px-3 py-2 rounded-xl text-xs font-bold border ${sendMode === 'approval' ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'} disabled:opacity-50`}
            >
              🔒 موافقة المالك (افتراضي)
            </button>
            <button
              type="button"
              disabled={modeBusy}
              onClick={() => void changeMode('auto')}
              className={`px-3 py-2 rounded-xl text-xs font-bold border ${sendMode === 'auto' ? 'bg-amber-600 text-white border-amber-500' : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'} disabled:opacity-50`}
            >
              ⚡ إرسال تلقائي
            </button>
          </div>
          <div className="text-[11px] text-slate-500 mt-2">
            {sendMode === 'approval'
              ? 'كل رسالة/متابعة تُحفظ مسودةً بانتظار موافقتك — لا نداء مزوّد قبل الموافقة.'
              : 'العقل التجاري يرسل المتابعات تلقائياً (خارج وضع الموافقة).'}
            {data?.killSwitchEnabled === false ? ' • مفتاح الإيقاف الطارئ: معطَّل (لا دورة تشغيل).' : ''}
          </div>
        </div>

        {note ? <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-2 mt-3">{note}</div> : null}
        {error ? <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-2 mt-3">{error}</div> : null}
      </section>

      {/* PR-S5: قسم أول «أسئلة تنتظر جوابك» (جواب على سؤال) بالأحدث أولاً. */}
      <section className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="flex items-center gap-2 text-slate-200 text-sm font-bold">
            <Clock className="w-4 h-4 text-emerald-300" /> أسئلة تنتظر جوابك: <span className="text-emerald-300">{answerDrafts.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={cleanupBusy} onClick={() => void runCleanup()} className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold disabled:opacity-50 flex items-center gap-1">
              {cleanupBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldAlert className="w-3 h-3 text-amber-300" />} تنظيف المسودات المخالفة
            </button>
            {answerDrafts.length > 0 ? (
              <button type="button" disabled={busyId === 'bulk'} onClick={() => void rejectAllInSection(answerDrafts, 'أسئلة تنتظر جوابك')} className="px-2.5 py-1 rounded-lg bg-rose-600/80 hover:bg-rose-500 text-white text-[11px] font-bold disabled:opacity-50 flex items-center gap-1">
                <XCircle className="w-3 h-3" /> رفض الكل في هذا القسم
              </button>
            ) : null}
          </div>
        </div>
        {cleanupNote ? <div className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl p-2 mb-3">{cleanupNote}</div> : null}
        {answerDrafts.length === 0 ? (
          <p className="text-xs text-slate-500">لا أسئلة بانتظار الجواب حالياً.</p>
        ) : (
          <div className="space-y-3">
            {answerDrafts.map((d) => (
              <DraftCard key={d.id} d={d} busyId={busyId} editId={editId} editText={editText} setEditId={setEditId} setEditText={setEditText} decide={decide} />
            ))}
          </div>
        )}
      </section>

      {/* PR-S5: قسم مطوي «متابعات» (24/72) — لا يُفتح افتراضياً. */}
      <section className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button type="button" onClick={() => setFollowUpsOpen((v) => !v)} className="flex items-center gap-2 text-slate-200 text-sm font-bold">
            {followUpsOpen ? <ChevronUp className="w-4 h-4 text-amber-300" /> : <ChevronDown className="w-4 h-4 text-amber-300" />}
            متابعات (24/72): <span className="text-amber-300">{followUpDrafts.length}</span>
          </button>
          {followUpsOpen && followUpDrafts.length > 0 ? (
            <button type="button" disabled={busyId === 'bulk'} onClick={() => void rejectAllInSection(followUpDrafts, 'متابعات')} className="px-2.5 py-1 rounded-lg bg-rose-600/80 hover:bg-rose-500 text-white text-[11px] font-bold disabled:opacity-50 flex items-center gap-1">
              <XCircle className="w-3 h-3" /> رفض الكل في هذا القسم
            </button>
          ) : null}
        </div>
        {followUpsOpen ? (
          followUpDrafts.length === 0 ? (
            <p className="text-xs text-slate-500 mt-3">لا متابعات معلّقة.</p>
          ) : (
            <div className="space-y-3 mt-3">
              {followUpDrafts.map((d) => (
                <DraftCard key={d.id} d={d} busyId={busyId} editId={editId} editText={editText} setEditId={setEditId} setEditText={setEditText} decide={decide} />
              ))}
            </div>
          )
        ) : null}
      </section>

      {/* قائمة الزبائن */}
      <section className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <div className="flex items-center gap-2 text-slate-200 text-sm font-bold">
            <User className="w-4 h-4 text-emerald-300" /> الزبائن المحتملون ({leads.length})
          </div>
          {/* PR-S5 (البند 4): تشخيص قراءة-فقط — هل يعيد Graph حقل from (اسم الكاتب)؟ */}
          <button type="button" disabled={diagBusy} onClick={() => void runAuthorDiagnosis()} className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold disabled:opacity-50 flex items-center gap-1">
            {diagBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldAlert className="w-3 h-3 text-amber-300" />} تشخيص اسم الكاتب (from)
          </button>
        </div>
        {diagResult ? (
          <div className="text-[11px] rounded-xl border border-slate-700 bg-slate-950/50 p-3 mb-3 space-y-1">
            <div className="text-slate-200 font-bold">الحكم: {diagResult.verdict === 'from_field_returned' ? 'Meta تعيد from (الأسماء متاحة)' : diagResult.verdict === 'from_field_missing' ? 'Meta تحجب from — OWNER SESSION REQUIRED' : 'لا بيانات كافية (غير حاسم)'}</div>
            <div className="text-slate-400">{diagResult.hint}</div>
            <div className="text-slate-500">مفحوص: {diagResult.checked} • باسم: {diagResult.withName} • بمعرّف: {diagResult.withAuthorId}</div>
            {Array.isArray(diagResult.metaDashboardSteps) && diagResult.metaDashboardSteps.length > 0 ? (
              <ol className="list-decimal pr-5 text-slate-300 space-y-0.5">
                {diagResult.metaDashboardSteps.map((s: string, i: number) => <li key={i}>{s}</li>)}
              </ol>
            ) : null}
          </div>
        ) : null}
        {leads.length === 0 ? (
          <p className="text-xs text-slate-500">لا زبائن محتملين مسجّلين بعد.</p>
        ) : (
          <div className="space-y-2">
            {leads.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => void openLead(l.id)}
                className="w-full text-right rounded-xl border border-slate-800 bg-slate-950/50 hover:border-emerald-500/40 p-3 transition"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[11px] text-slate-300 flex items-center gap-2 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded-md bg-slate-800 border border-slate-700">{PLATFORM_AR[l.platform] || l.platform}</span>
                    <span className="font-bold text-slate-200">{l.context?.authorName || l.customerName || 'اسم غير متاح من Meta'}</span>
                    {l.interestedProductName ? <span className="text-slate-400 flex items-center gap-1"><Package className="w-3 h-3" /> {l.interestedProductName}</span> : null}
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">{l.stageLabelAr}</span>
                  {l.archived ? <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">مؤرشف (لا سؤال حقيقي)</span> : null}
                  {l.qualifiedQuestion === false && !l.archived ? <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">غير مؤهّل</span> : null}
                </div>
                <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                  <span>آخر تفاعل: {l.lastInteractionAt ? new Date(l.lastInteractionAt).toLocaleString('ar-IQ') : '—'}</span>
                  <span>• {l.followUpLabelAr}</span>
                  {l.hasPendingProposal ? <span className="text-amber-300">• عرض بانتظار التأكيد</span> : null}
                  {l.escalationReason ? <span className="text-rose-300 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {l.escalationReason}</span> : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* تفاصيل الزبون المختار */}
      {selectedLead ? (
        <section className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="text-slate-200 text-sm font-bold flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-emerald-300" /> {selectedLead.context?.authorName || selectedLead.lead?.customerName || 'اسم غير متاح من Meta'}
            </div>
            <button type="button" onClick={() => setSelectedLead(null)} className="text-xs text-slate-400 hover:text-slate-200">إغلاق</button>
          </div>

          {/* PR-S4: سياق الزبون الكامل في بطاقة الزبون */}
          <CustomerContextBlock context={selectedLead.context} />

          {selectedLead.proposal ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-950/10 p-3 mb-3">
              <div className="text-xs font-bold text-amber-300 mb-1">العرض المقترح ({selectedLead.proposal.productName})</div>
              <div className="text-[11px] text-slate-300 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <span>الكاش: {Number(selectedLead.proposal.cashPrice).toLocaleString('ar-IQ')}</span>
                <span>الخصم: {selectedLead.proposal.discountPercent}%</span>
                <span>السعر النهائي: {Number(selectedLead.proposal.finalPrice).toLocaleString('ar-IQ')}</span>
                <span>القسط: {Number(selectedLead.proposal.monthlyInstallment).toLocaleString('ar-IQ')} × {selectedLead.proposal.installmentMonths}</span>
              </div>
              {selectedLead.proposal.status === 'pending' ? (
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    disabled={busyId === `prop-${selectedLead.lead.id}`}
                    onClick={() => void decideProposal(selectedLead.lead.id, selectedLead.proposal.id, true)}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50"
                  >
                    ✅ تمت الصفقة (WON)
                  </button>
                  <button
                    type="button"
                    disabled={busyId === `prop-${selectedLead.lead.id}`}
                    onClick={() => void decideProposal(selectedLead.lead.id, selectedLead.proposal.id, false)}
                    className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold disabled:opacity-50"
                  >
                    رفض العرض
                  </button>
                </div>
              ) : (
                <div className="text-[11px] text-slate-400 mt-2">حالة العرض: {selectedLead.proposal.status === 'confirmed' ? 'مؤكَّد (WON)' : 'مرفوض'}</div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-slate-500 mb-3">لا عرض صفقة معلّق لهذا الزبون.</div>
          )}

          {/* B8: زر «تم البيع» — يربط البيع بالمحادثة والمنصة المصدر والمبلغ. */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/10 p-3 mb-3">
            <div className="text-xs font-bold text-emerald-300 mb-2">تسجيل بيع (تم البيع)</div>
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={saleAmount}
                onChange={(e) => setSaleAmount(e.target.value)}
                placeholder="مبلغ البيع (د.ع)"
                className="w-40 text-xs rounded-xl bg-slate-950 border border-slate-700 text-slate-100 p-2"
              />
              <input
                type="text"
                value={saleProductName}
                onChange={(e) => setSaleProductName(e.target.value)}
                placeholder={selectedLead.proposal?.productName || 'اسم المنتج'}
                className="w-48 text-xs rounded-xl bg-slate-950 border border-slate-700 text-slate-100 p-2"
              />
              <button
                type="button"
                disabled={saleBusy || !saleAmount || Number(saleAmount) <= 0}
                onClick={() => void recordSale(selectedLead.lead.id, selectedLead.proposal?.productName, selectedLead.proposal?.productId)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1"
              >
                {saleBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />} تم البيع
              </button>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">المنصة المصدر: {selectedLead.lead.platform} • يُسجَّل مرتبطاً بهذا الزبون. لا تعديل مخزون ولا عقد تلقائي.</div>
            {saleNote ? <div className="text-[11px] text-emerald-300 mt-1">{saleNote}</div> : null}
          </div>

          <div className="text-xs font-bold text-slate-300 mb-2">سجل المحادثة</div>
          {Array.isArray(selectedLead.conversation) && selectedLead.conversation.length > 0 ? (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {selectedLead.conversation.map((m: any, i: number) => (
                <div key={i} className={`rounded-xl p-2 text-xs ${m.direction === 'customer' ? 'bg-slate-950/60 border border-slate-800' : 'bg-emerald-950/20 border border-emerald-500/20'}`}>
                  <div className="text-[10px] text-slate-500 mb-1">
                    {m.direction === 'customer' ? 'الزبون' : 'المعرض'} • {m.at ? new Date(m.at).toLocaleString('ar-IQ') : ''}
                    {m.direction === 'business' ? (m.delivered ? ' • مُسلَّم' : ' • غير مُسلَّم') : ''}
                  </div>
                  <div className="text-slate-200 whitespace-pre-wrap">{m.text}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">لا سجل محادثة متاح.</p>
          )}

          {Array.isArray(selectedLead.drafts) && selectedLead.drafts.length > 0 ? (
            <div className="mt-3">
              <div className="text-xs font-bold text-slate-300 mb-2">مسودات هذا الزبون</div>
              <div className="space-y-1">
                {selectedLead.drafts.map((d: DraftRow) => (
                  <div key={d.id} className="text-[11px] text-slate-400 flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded-md border ${d.status === 'pending' ? 'border-amber-500/40 text-amber-300' : d.status === 'approved' ? 'border-emerald-500/40 text-emerald-300' : 'border-slate-700 text-slate-400'}`}>{d.statusLabelAr}</span>
                    <span className="truncate">{d.purposeLabelAr}: {d.text.slice(0, 60)}</span>
                    {d.providerReplyId ? <span className="text-emerald-400">#{d.providerReplyId}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
      <CommercialMonthlyReport />
    </div>
  );
}
