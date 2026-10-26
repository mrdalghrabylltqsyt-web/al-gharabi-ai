/**
 * «المنصات الخمس — ردود جاهزة بانتظار نقرتك» (للمالك).
 *
 * 1) جاهزية كل منصة مربوطة من الحالة الحقيقية: الربط، قراءة التعليقات، الرد، النشر
 *    الموحّد، القياس والتعلّم — مع السبب الدقيق لأي نقص ومن يصلحه.
 * 2) الردود التي جهّزها العقل على كل منصة وحُجزت بوابة الموافقة: إرسال بنقرة، تعديل
 *    ثم إرسال، رفض، أو «أرسل كل الجاهز» لمنصة. الإرسال يقع على الخادم عبر المنفّذ
 *    المركزي للمنصة (كل حماياته سارية). لا حالة محلية مختلقة.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { apiService } from '../../services/api';
import { CheckCircle2, XCircle, Pencil, Send, Loader2, RefreshCw, ExternalLink } from 'lucide-react';

const STATE_STYLE: Record<string, { c: string; t: string }> = {
  ready: { c: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10', t: 'جاهز' },
  partial: { c: 'text-amber-300 border-amber-500/40 bg-amber-500/10', t: 'جاهز جزئياً' },
  blocked: { c: 'text-rose-300 border-rose-500/40 bg-rose-500/10', t: 'متوقف' },
  unavailable: { c: 'text-slate-400 border-slate-600/50 bg-slate-800/40', t: 'غير متاح من المنصة' },
};
const LINE_ICON: Record<string, string> = { ready: '✓', partial: '⚠', blocked: '✗', unavailable: '–' };

export const ReadyRepliesPanel: React.FC = () => {
  const [ready, setReady] = useState<any>(null);
  const [appr, setAppr] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, a] = await Promise.all([apiService.getFivePlatformReadiness(), apiService.getOutboundApprovals('', 'pending')]);
      setReady(r); setAppr(a); setError(null);
    } catch (e: any) { setError(e?.message || 'تعذّر التحميل'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const decide = async (id: string, kind: 'approve' | 'edit_approve' | 'reject', text?: string) => {
    setBusy(id); setNote(null); setError(null);
    try {
      const out = await apiService.decideOutboundApproval(id, kind, text);
      setNote(kind === 'reject' ? 'رُفض الرد؛ لم يُرسل شيء.' : `أُرسل الرد وثُبّت بمعرّف من المنصة (${out.providerReplyId}).`);
      setEditId(null);
      await load();
    } catch (e: any) { setError(e?.message || 'تعذّر التنفيذ'); await load(); }
    finally { setBusy(null); }
  };
  const bulk = async (platform: string, kind: 'approve' | 'reject') => {
    setBusy(`bulk:${platform}`); setNote(null); setError(null);
    try {
      const out = await apiService.bulkOutboundApprovals({ platform: platform || undefined, kind });
      setNote(kind === 'reject' ? `رُفض ${out.rejected} رداً.` : `أُرسل ${out.sent} رداً${out.failed ? `، وتعذّر ${out.failed}` : ''}${out.remaining ? ` — بقي ${out.remaining} (اضغط مرة أخرى)` : ''}.`);
      await load();
    } catch (e: any) { setError(e?.message || 'تعذّر تنفيذ الدفعة'); }
    finally { setBusy(null); }
  };

  const rows: any[] = ready?.rows || [];
  const list: any[] = (appr?.approvals || []).filter((x: any) => !filter || x.platform === filter);

  return (
    <section className="glass rounded-2xl p-5" aria-label="المنصات الخمس — ردود جاهزة بانتظار نقرتك">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">المنصات الخمس — جاهزية حقيقية وردود بانتظار نقرتك</h2>
          <p className="text-xs text-slate-400">
            وضع الإرسال: <span className="text-emerald-300 font-bold">{ready?.sendModeLabelAr || '…'}</span>.
            {' '}العقل يقرأ التعليقات ويجهّز الرد على كل منصة، ولا يخرج شيء قبل نقرتك.
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-2">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> تحديث
        </button>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {rows.map((r) => {
          const st = STATE_STYLE[r.state] || STATE_STYLE.partial;
          return (
            <div key={r.platform} className={`rounded-xl border p-3 ${st.c}`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="font-bold text-slate-100">{r.name}</span>
                <span className="text-[11px] font-bold">{st.t}</span>
              </div>
              <ul className="space-y-1.5">
                {r.lines.map((l: any) => (
                  <li key={l.key} className="text-[11px] leading-5 text-slate-300" title={l.fix || undefined}>
                    <span className={(STATE_STYLE[l.state] || STATE_STYLE.partial).c.split(' ')[0]}>{LINE_ICON[l.state]} {l.label}:</span> {l.detail}
                    {l.fix ? <div className="text-[10px] text-amber-200/90">↳ {l.fix}</div> : null}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                <span>الرد: <b>{r.replyModeLabelAr}</b></span>
                {r.pendingReplies > 0 && (
                  <button type="button" disabled={busy !== null} onClick={() => void bulk(r.platform, 'approve')} className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50 flex items-center gap-1">
                    {busy === `bulk:${r.platform}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} أرسل {r.pendingReplies} جاهز
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!rows.length && <div className="text-xs text-slate-400">{loading ? 'جارٍ التحميل…' : 'لا بيانات.'}</div>}
      </div>

      {note ? <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-2 mt-3">{note}</div> : null}
      {error ? <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-2 mt-3">{error}</div> : null}

      <div className="mt-4 flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-bold text-slate-200">ردود جاهزة بانتظار نقرتك: <span className="text-emerald-300">{appr?.pendingTotal ?? 0}</span></div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-200" aria-label="تصفية المنصة">
            <option value="">كل المنصات</option>
            {rows.map((r) => <option key={r.platform} value={r.platform}>{r.name}</option>)}
          </select>
          {(appr?.pendingTotal ?? 0) > 0 && (
            <>
              <button type="button" disabled={busy !== null} onClick={() => void bulk(filter, 'approve')} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50">أرسل كل الجاهز{filter ? '' : ' (كل المنصات)'}</button>
              <button type="button" disabled={busy !== null} onClick={() => void bulk(filter, 'reject')} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold disabled:opacity-50">ارفض الكل</button>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {list.map((x) => (
          <div key={x.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <div className="text-[11px] text-slate-400 flex items-center gap-2 flex-wrap">
              <span className="text-slate-200 font-bold">{x.platformLabelAr}</span> · {x.kindLabelAr}
              {x.customer?.name ? <> · <span className="text-slate-300">{x.customer.name}</span></> : null}
              {x.productName ? <> · منتج: {x.productName}</> : null}
              {x.status === 'failed' && <span className="text-rose-300">· تعذّر سابقاً: {x.error}</span>}
              {x.customer?.permalinkUrl ? <a href={x.customer.permalinkUrl} target="_blank" rel="noreferrer" className="text-sky-300 inline-flex items-center gap-1">فتح <ExternalLink className="w-3 h-3" /></a> : null}
            </div>
            {x.customer?.text ? <div className="mt-1 text-xs text-slate-300">الزبون: «{x.customer.text}»</div> : null}
            {editId === x.id
              ? <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} className="mt-2 w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-100" aria-label="نص الرد" />
              : <div className="mt-1.5 text-xs text-emerald-100 bg-slate-900/60 rounded-lg p-2 border border-slate-800 whitespace-pre-wrap">{x.text}</div>}
            <div className="mt-2 flex gap-2 flex-wrap">
              {editId === x.id ? (
                <>
                  <button type="button" disabled={busy !== null || !editText.trim()} onClick={() => void decide(x.id, 'edit_approve', editText)} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1"><Send className="w-3 h-3" /> أرسل المعدّل</button>
                  <button type="button" onClick={() => setEditId(null)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-bold">إلغاء</button>
                </>
              ) : (
                <>
                  <button type="button" disabled={busy !== null || !x.sendable} onClick={() => void decide(x.id, 'approve')} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1">
                    {busy === x.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} أرسل
                  </button>
                  <button type="button" disabled={busy !== null} onClick={() => { setEditId(x.id); setEditText(x.text); }} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1"><Pencil className="w-3 h-3" /> عدّل</button>
                  <button type="button" disabled={busy !== null} onClick={() => void decide(x.id, 'reject')} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-rose-200 text-xs font-bold flex items-center gap-1"><XCircle className="w-3 h-3" /> ارفض</button>
                </>
              )}
            </div>
          </div>
        ))}
        {!list.length && <div className="text-xs text-slate-500">لا ردود جاهزة الآن — كل تعليق جديد يُجهَّز رده تلقائياً ويظهر هنا.</div>}
      </div>
    </section>
  );
};
