import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, PlugZap, AlertTriangle, CheckCircle2, XCircle, Loader2, ExternalLink, KeyRound, Webhook } from 'lucide-react';
import { apiService } from '../../services/api';
import { useApp } from '../../context/AppContext';

/**
 * مركز ربط المنصات — يميّز بدقة بين: منفّذ في الكود، مُعدّ، متصل، موثق، يعمل.
 * لا يعرض أي سرّ. الأزرار مرتبطة بالحالة الحقيقية: «بدء الربط» يظهر فقط حين
 * يكون المسار جاهزاً، و«إكمال الإعداد الخارجي» حين يلزم إجراء من المزود.
 */
const STATE_LABELS: Record<string, { ar: string; cls: string }> = {
  CODE_READY: { ar: 'منفّذ في الكود — لم يُضبط', cls: 'bg-slate-700/40 text-slate-300' },
  EXTERNAL_SETUP_REQUIRED: { ar: 'يلزم إعداد من المزود', cls: 'bg-amber-500/15 text-amber-300' },
  CONFIGURED: { ar: 'مُعدّ — لم يُربط بعد', cls: 'bg-sky-500/15 text-sky-300' },
  CONNECTED: { ar: 'متصل — غير موثق', cls: 'bg-indigo-500/15 text-indigo-300' },
  VERIFIED: { ar: 'موثق', cls: 'bg-emerald-500/15 text-emerald-300' },
  OPERATIONAL: { ar: 'يعمل فعلياً', cls: 'bg-emerald-500/20 text-emerald-300' },
  NOT_SUPPORTED: { ar: 'غير مدعوم رسمياً', cls: 'bg-slate-800 text-slate-500' },
  FAILED: { ar: 'فشل — يلزم إعادة ربط', cls: 'bg-rose-500/15 text-rose-300' },
  DISCONNECTED: { ar: 'غير متصل', cls: 'bg-slate-700/40 text-slate-400' },
};

const OP_LABELS: Record<string, string> = {
  connect: 'اتصال', verify: 'تحقق', receive: 'استقبال', classify: 'تصنيف',
  reply: 'رد', publish: 'نشر', schedule: 'جدولة', metrics: 'مؤشرات',
};

function OpBadge({ op, opKey }: { op: any; opKey: string; key?: React.Key }) {
  const cls = !op.supported || op.code === 'CAPABILITY_NOT_SUPPORTED'
    ? 'bg-slate-800 text-slate-500 border-slate-700'
    : op.allowed
      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-600/30'
      : 'bg-amber-500/10 text-amber-300 border-amber-600/30';
  const title = !op.supported ? 'غير مدعوم رسمياً' : op.allowed ? 'متاح الآن' : (op.reason || 'محجوب');
  return (
    <span key={opKey} title={title} className={`px-1.5 py-0.5 rounded-md border text-[9px] font-semibold ${cls}`}>
      {OP_LABELS[op.operation] || op.operation}
    </span>
  );
}

/** حالة اشتراك صفحة Facebook في webhook — حقيقية من Meta بلا أي سرّ. */
const FacebookWebhookStatus: React.FC = () => {
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState<string>('');
  useEffect(() => {
    let alive = true;
    apiService.getFacebookWebhookInfo().then((d) => { if (alive) setInfo(d); }).catch((e) => { if (alive) setErr(e?.message || 'تعذر جلب حالة webhook'); });
    return () => { alive = false; };
  }, []);
  if (err) return <p className="text-[10px] text-amber-300 mt-2">حالة webhook: {err}</p>;
  if (!info) return <p className="text-[10px] text-slate-500 mt-2">جارٍ جلب حالة webhook الحقيقية من Meta…</p>;
  return (
    <div className="mt-3 pt-3 border-t border-slate-800/70 text-[10px] space-y-1">
      <p className="text-slate-500 flex items-center gap-1"><Webhook className="w-3 h-3" /> حالة استقبال webhook (حقيقية من Meta):</p>
      <div className="flex flex-wrap gap-1.5">
        <span className={`px-2 py-0.5 rounded-md border font-bold ${info.appSubscribed ? 'bg-emerald-500/10 text-emerald-300 border-emerald-600/30' : 'bg-amber-500/10 text-amber-300 border-amber-600/30'}`}>
          {info.appSubscribed ? 'الصفحة مشتركة فعلياً' : 'لا اشتراك مثبت'}
        </span>
        <span className={`px-2 py-0.5 rounded-md border font-bold ${info.verifyTokenConfigured ? 'bg-emerald-500/10 text-emerald-300 border-emerald-600/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
          {info.verifyTokenConfigured ? 'رمز التحقق مضبوط' : 'رمز التحقق ناقص'}
        </span>
        <span className={`px-2 py-0.5 rounded-md border font-bold ${info.signatureSecretConfigured ? 'bg-emerald-500/10 text-emerald-300 border-emerald-600/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
          {info.signatureSecretConfigured ? 'سرّ التوقيع مضبوط' : 'سرّ التوقيع ناقص'}
        </span>
      </div>
      <p className="text-slate-500">رابط الـwebhook: <code className="text-slate-300">{info.webhookUrl}</code> • الصفحة: <code className="text-slate-300">{info.pageName || info.pageId}</code></p>
    </div>
  );
};

export const PlatformConnectionCenter: React.FC = () => {
  const { currentUser, showToast } = useApp();
  const [loading, setLoading] = useState(false);
  const [control, setControl] = useState<any>(null);
  const [external, setExternal] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Facebook: الحساب قد يدير أكثر من صفحة، فيُعرض اختيار الصفحة لإتمام الربط.
  const [fbPages, setFbPages] = useState<any[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cp, ext] = await Promise.all([
        apiService.getPlatformControlPlane(),
        apiService.getPlatformExternalSetup().catch(() => null),
      ]);
      setControl(cp);
      setExternal(ext);
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل مركز ربط المنصات');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  if (currentUser?.role !== 'owner') {
    return <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-slate-300">مركز ربط المنصات مخصص لمالك النظام فقط.</div>;
  }

  const loadFacebookPages = async () => {
    setBusy('facebook-pages');
    try { const res = await apiService.getFacebookPages(); setFbPages(res.pages || []); }
    catch (e: any) { showToast(e?.message || 'تعذر جلب صفحات Facebook'); }
    finally { setBusy(null); }
  };
  const chooseFacebookPage = async (pageId: string) => {
    setBusy(`facebook-page-${pageId}`);
    try { const res = await apiService.selectFacebookPage(pageId); showToast(res.webhookSubscribed ? 'تم ربط الصفحة والاشتراك في webhook.' : 'تم ربط الصفحة، لكن اشتراك webhook لم يُثبت.'); setFbPages(null); void load(); }
    catch (e: any) { showToast(e?.message || 'تعذر ربط الصفحة'); }
    finally { setBusy(null); }
  };

  const startOAuth = async (platform: string) => {
    setBusy(platform);
    try {
      const res = await apiService.startPlatformOAuth(platform);
      if (res?.authorizationUrl) { window.location.href = res.authorizationUrl; return; }
      showToast('تم بدء الربط.');
    } catch (e: any) { showToast(e?.message || 'تعذر بدء الربط'); }
    finally { setBusy(null); }
  };

  const platforms: any[] = control?.platforms || [];

  return (
    <div className="space-y-6">
      <div className="p-6 rounded-2xl bg-gradient-to-l from-slate-900 to-emerald-950/50 border border-emerald-500/20 flex flex-col md:flex-row justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2"><PlugZap className="w-5 h-5 text-emerald-400" /> مركز ربط المنصات</h2>
          <p className="text-xs text-slate-400 mt-1">
            حالة كل منصة بدقة: منفّذ في الكود ≠ مُعدّ ≠ متصل ≠ موثق ≠ يعمل فعلياً. لا يُعلن «يعمل» إلا باتصال موثق وموصل منفّذ.
          </p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-white flex items-center gap-2 self-start">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> تحديث
        </button>
      </div>

      {control?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[['يعمل فعلياً', control.summary.operational, 'text-emerald-400'], ['متصل', control.summary.connected, 'text-indigo-400'], ['مُعدّ', control.summary.configured, 'text-sky-400'], ['يلزم إعداد خارجي', control.summary.externalSetupRequired, 'text-amber-400'], ['منفّذ بالكود', control.summary.codeReady, 'text-slate-300']].map(([label, value, cls]) => (
            <div key={String(label)} className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
              <p className="text-[11px] text-slate-400">{label}</p>
              <p className={`text-lg font-black mt-1 ${cls}`}>{String(value)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {platforms.map((p) => {
          const meta = STATE_LABELS[p.state] || { ar: p.state, cls: 'bg-slate-800 text-slate-300' };
          const extRow = external?.platforms?.find((x: any) => x.platform === p.platform);
          const canOAuth = p.operations?.find((o: any) => o.operation === 'connect')?.allowed === true && p.state !== 'EXTERNAL_SETUP_REQUIRED';
          const needsExternal = p.state === 'EXTERNAL_SETUP_REQUIRED';
          // Facebook بعد OAuth قد ينتظر اختيار الصفحة (حساب يدير أكثر من صفحة).
          // هذه الحالة تُعرض بإجراءها الصحيح، ولا تُحجب خلف زر «بدء الربط».
          const fbPageSelection = p.platform === 'facebook' && p.pageSelectionPending === true;
          return (
            <div key={p.platform} className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-black text-white">{p.displayName}</h3>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${meta.cls}`}>{meta.ar}</span>
                    {p.providerVerified && <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400"><CheckCircle2 className="w-3 h-3" /> موثق</span>}
                  </div>
                  {p.blockingReason && (
                    <p className="text-[11px] text-amber-300/90 mt-2 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {p.blockingReason}
                    </p>
                  )}
                  <p className="text-[11px] text-slate-400 mt-1.5">الإجراء التالي: <span className="text-slate-200">{p.nextAction}</span></p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {p.connected ? (
                    <button onClick={async () => { try { await apiService.disconnectPlatform(p.platform); showToast('تم فصل المنصة.'); void load(); } catch (e: any) { showToast(e?.message || 'تعذر الفصل'); } }}
                      className="px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-600/30 text-[11px] font-bold text-rose-300">فصل</button>
                  ) : fbPageSelection ? (
                    // تفويض OAuth اكتمل وينتظر اختيار الصفحة: الإجراء الصحيح هو اختيار
                    // الصفحة، لا إعادة OAuth. نُبقي إعادة الربط متاحة كإجراء ثانوي.
                    <>
                      <button onClick={() => void loadFacebookPages()} disabled={busy === 'facebook-pages'}
                        className="px-3 py-1.5 rounded-lg bg-sky-500 text-slate-950 text-[11px] font-black inline-flex items-center gap-1 disabled:opacity-50">
                        {busy === 'facebook-pages' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />} اختيار الصفحة
                      </button>
                      <button onClick={() => void startOAuth(p.platform)} disabled={busy === p.platform}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-[11px] font-bold text-slate-300 inline-flex items-center gap-1 disabled:opacity-50">
                        {busy === p.platform ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />} إعادة الربط
                      </button>
                    </>
                  ) : needsExternal ? (
                    <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-600/30 text-[11px] font-bold text-amber-300">
                      <ExternalLink className="w-3.5 h-3.5" /> إكمال الإعداد الخارجي
                    </span>
                  ) : canOAuth ? (
                    <button onClick={() => void startOAuth(p.platform)} disabled={busy === p.platform}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 text-[11px] font-black inline-flex items-center gap-1 disabled:opacity-50">
                      {busy === p.platform ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />} بدء الربط
                    </button>
                  ) : p.platform === 'facebook' ? (
                    // Facebook: الحساب موثوق لكنه يدير أكثر من صفحة؛ إتمام الربط باختيار الصفحة.
                    <button onClick={() => void loadFacebookPages()} disabled={busy === 'facebook-pages'}
                      className="px-3 py-1.5 rounded-lg bg-sky-500 text-slate-950 text-[11px] font-black inline-flex items-center gap-1 disabled:opacity-50">
                      {busy === 'facebook-pages' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />} اختيار الصفحة
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-[11px] font-bold text-slate-400">
                      <KeyRound className="w-3.5 h-3.5" /> يلزم إعداد
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-1 mt-3">
                {(p.operations || []).map((o: any) => <OpBadge key={o.operation} opKey={o.operation} op={o} />)}
              </div>

              {p.platform === 'facebook' && fbPages && (
                <div className="mt-3 pt-3 border-t border-slate-800/70">
                  <p className="text-[10px] text-slate-500 mb-1.5">اختر الصفحة التي تريد ربطها (معرّفات وأسماء فقط بلا أي رمز):</p>
                  <div className="flex flex-wrap gap-2">
                    {fbPages.length === 0 && <span className="text-[11px] text-slate-400">لا صفحات لهذا الحساب.</span>}
                    {fbPages.map((pg: any) => (
                      <button key={pg.pageId} onClick={() => void chooseFacebookPage(pg.pageId)} disabled={busy === `facebook-page-${pg.pageId}`}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-[11px] font-bold text-white inline-flex items-center gap-1 disabled:opacity-50">
                        {busy === `facebook-page-${pg.pageId}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Webhook className="w-3.5 h-3.5" />} {pg.pageName || pg.pageId}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {p.platform === 'facebook' && p.connected && <FacebookWebhookStatus />}

              {extRow && (
                <div className="mt-3 pt-3 border-t border-slate-800/70 grid md:grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <p className="text-slate-500 mb-1 flex items-center gap-1"><KeyRound className="w-3 h-3" /> متغيرات الاعتماد المطلوبة (أسماء فقط):</p>
                    <div className="flex flex-wrap gap-1">
                      {(extRow.requiredEnvNames || []).slice(0, 8).map((n: string) => (
                        <code key={n} className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-slate-300">{n}</code>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-slate-500 mb-1 flex items-center gap-1"><Webhook className="w-3 h-3" /> خطوات الإعداد الخارجي:</p>
                    <ul className="list-disc list-inside text-slate-400 space-y-0.5">
                      {(extRow.steps || []).slice(0, 5).map((s: string, i: number) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> لا تُنشئ المنصة أي حساب أو اتصال نيابة عن المالك، ولا تعرض أي سرّ. الإعداد الخارجي يبقى مسؤولية المالك لدى المزود.
      </p>
    </div>
  );
};
