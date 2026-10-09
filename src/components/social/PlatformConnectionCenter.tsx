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

/**
 * لوحة إعداد OAuth الدقيق لمنصة (للمالك): تُظهر رابط الإرجاع الفعلي والنطاق
 * المطلوب تسجيله لدى Meta — بلا أي سرّ. هذا ما كان ناقصاً فعلاً: رسالة Meta
 * «النطاق غير مُضمَّن» بلا القيمة الصحيحة تُبقي المالك يدور بلا نهاية.
 */
const OAuthSetupPanel: React.FC<{ platform: string }> = ({ platform }) => {
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState<string>('');
  useEffect(() => {
    let alive = true;
    apiService.getPlatformOAuthSetup(platform).then((d) => { if (alive) setInfo(d); }).catch((e) => { if (alive) setErr(e?.message || 'تعذر جلب إعداد OAuth'); });
    return () => { alive = false; };
  }, [platform]);
  if (err) return <p className="text-[10px] text-amber-300 mt-2">إعداد OAuth: {err}</p>;
  if (!info) return <p className="text-[10px] text-slate-500 mt-2">جارٍ جلب إعداد OAuth الحقيقي…</p>;
  const notPublic = info.publicUrlIsPublic === false;
  return (
    <div className={`mt-3 pt-3 border-t border-slate-800/70 text-[10px] space-y-1.5`}>
      <p className="text-slate-500 flex items-center gap-1"><KeyRound className="w-3 h-3" /> إعداد OAuth المطلوب لدى المزود (قيَم حقيقية بلا أسرار):</p>
      {notPublic && (
        <p className="text-amber-300">
          العنوان العام غير إنتاجي ({info.publicUrlSource}: {info.publicUrlProblems?.[0] || 'غير صالح'}). اضبط APP_URL على نطاقك العام (https) — وإلا سيرفض Meta رابط الإرجاع برسالة «لا يمكن تحميل عنوان URL».
        </p>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-slate-400">Valid OAuth Redirect URIs (الصق هذا بالضبط):</span>
        <code dir="ltr" className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-emerald-300 break-all text-left select-all">{info.redirectUri}</code>
        {info.appDomainsValue && (
          <>
            <span className="text-slate-400 mt-1">App Domains:</span>
            <code dir="ltr" className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-sky-300 break-all text-left select-all">{info.appDomainsValue}</code>
          </>
        )}
        {info.webhookUrl && (
          <>
            <span className="text-slate-400 mt-1">Webhook Callback URL:</span>
            <code dir="ltr" className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-slate-300 break-all text-left select-all">{info.webhookUrl}</code>
          </>
        )}
      </div>
      <p className="text-slate-500">مصدر العنوان العام: <span className="text-slate-300">{info.publicUrlSource}</span> • النطاق: <span className="text-slate-300" dir="ltr">{info.domain}</span></p>
      {info.mobileDialogProbe && (
        <div className="mt-1.5 pt-1.5 border-t border-slate-800/70 space-y-1">
          <p className="text-slate-500 flex items-center gap-1"><KeyRound className="w-3 h-3" /> فحص مسار الجوال الفعلي (بلا بدء الربط):</p>
          {info.dialogPhase && (
            <p className="text-slate-400">
              موضع الفحص: {info.dialogPhase === 'rejected_before_login' ? 'رُفض قبل تسجيل الدخول'
                : info.dialogPhase === 'awaiting_owner_login' ? 'توقّف عند شاشة الدخول — الفحص بلا كوكيز لا يرى ما بعدها. إن ظهر «حدث خطأ ما» بعد الدخول فتحقّق من تفعيل الصلاحيات في Use Case، أو اضبط Configuration ID (config_id) إن كان تطبيقك Business'
                : info.dialogPhase === 'probe_unavailable' ? 'تعذّر الفحص (شبكة)'
                : 'لا رفض مُرصود'}
            </p>
          )}
          {info.mobileDialogProbe.probed === false ? (
            <p className="text-amber-300">تعذّر الفحص: {info.mobileDialogProbe.error}</p>
          ) : (
            <>
              <span className={`px-2 py-0.5 rounded-md border font-bold inline-block ${info.mobileDialogProbe.outcome === 'acceptable' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-600/30' : 'bg-rose-500/10 text-rose-300 border-rose-600/30'}`}>
                {info.mobileDialogProbe.outcome === 'acceptable' ? 'المسار مقبول (يصل إلى شاشة الدخول)' : 'المسار مرفوض — هذا سبب «حدث خطأ ما» على الجوال'}
              </span>
              <p className="text-slate-500">
                قفزات: <code dir="ltr" className="text-slate-300">{Array.isArray(info.mobileDialogProbe.hops) ? info.mobileDialogProbe.hops.map((h: any) => `${h.host || '—'}${h.path || ''}:${h.status}`).join(' → ') : '—'}</code>
              </p>
              {info.mobileDialogProbe.outcome !== 'acceptable' && (
                <p className="text-rose-300">
                  الرفض عند: <code dir="ltr">{info.mobileDialogProbe.rejectionHost || '—'}{info.mobileDialogProbe.rejectionPath || ''}</code> • الحالة: {info.mobileDialogProbe.httpStatus} • النوع: {info.mobileDialogProbe.kind}{info.mobileDialogProbe.errorCode ? ` (${info.mobileDialogProbe.errorCode})` : ''}
                </p>
              )}
              <p className="text-slate-600">فحص حقيقي بوكيل جوال بلا متابعة موافقة وبلا أي سرّ — يعرض المضيف/المسار فقط.</p>
            </>
          )}
        </div>
      )}
      {Array.isArray(info.loginConfigIdEnvNames) && (
        <div className="mt-1.5 pt-1.5 border-t border-slate-800/70 space-y-1">
          <p className="text-slate-500 flex items-center gap-1"><KeyRound className="w-3 h-3" /> Facebook Login for Business — Configuration:</p>
          <span className={`px-2 py-0.5 rounded-md border font-bold inline-block ${info.loginConfigIdUsed ? 'bg-emerald-500/10 text-emerald-300 border-emerald-600/30' : info.loginConfigIdConfigured ? 'bg-rose-500/10 text-rose-300 border-rose-600/30' : 'bg-amber-500/10 text-amber-300 border-amber-600/30'}`}>
            {info.loginConfigIdUsed ? 'config_id مُفعَّل (يُرسَل بدل scope)' : info.loginConfigIdConfigured ? 'config_id مضبوط لكن غير صالح' : 'config_id غير مضبوط (يُستخدم scope)'}
          </span>
          {!info.loginConfigIdUsed && (
            <p className="text-slate-400">
              الافتراضي يمرّر <code dir="ltr" className="text-slate-300">scope</code> ويكمل الربط — وهو الصحيح لتطبيق Facebook Login كلاسيكي. إن كان تطبيقك من نوع Business فعلاً وظهرت «حدث خطأ ما» بعد تسجيل الدخول، أنشئ Configuration واضبط معرّفها في <code dir="ltr" className="text-slate-200">{info.loginConfigIdEnvNames?.[0]}</code>، أو استعد الحجب الصارم بمفتاح <code dir="ltr" className="text-slate-200">META_ALLOW_SCOPE_WITHOUT_CONFIG=false</code>.
            </p>
          )}
          {Array.isArray(info.loginConfigIdProblems) && info.loginConfigIdProblems.length > 0 && (
            <p className="text-rose-300">{info.loginConfigIdProblems.join(' ')}</p>
          )}
          <p className="text-slate-500">متغيرات البيئة: <code dir="ltr" className="text-slate-300">{info.loginConfigIdEnvNames.join(' أو ')}</code></p>
          {Array.isArray(info.loginForBusinessSetup?.steps) && (
            <details className="text-slate-400">
              <summary className="cursor-pointer text-slate-500">خطوات إنشاء Configuration في Meta (بلا أسرار)</summary>
              <ol className="list-decimal pr-4 mt-1 space-y-0.5">
                {info.loginForBusinessSetup.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}
              </ol>
            </details>
          )}
        </div>
      )}
    </div>
  );
};

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

/**
 * لوحة تشخيص نشر فيديو Facebook (للمالك): زرّان يظهران فقط للمالك (المكوّن كله داخل
 * مركز الربط المحصور بالمالك). الأول يفحص صلاحيات رمز الصفحة فعلياً عبر Meta
 * `debug_token` فيكشف الصلاحية الناقصة التي تمنع نشر الفيديو (#100) — بلا أي رمز أو سرّ.
 * الثاني يسحب سجل النشر الفاشل المحفوظ (رسالة المزود الكاملة + code/subcode/fbtrace).
 * لا يدّعي أي نشر ولا يصلح الصلاحية (ذلك إجراء المالك في لوحة Meta).
 */
const FacebookVideoDiagnosticsPanel: React.FC = () => {
  const [perm, setPerm] = useState<any>(null);
  const [permErr, setPermErr] = useState('');
  const [permBusy, setPermBusy] = useState(false);
  const [diag, setDiag] = useState<any>(null);
  const [diagErr, setDiagErr] = useState('');
  const [diagBusy, setDiagBusy] = useState(false);

  const REQUIRED: Record<string, string> = {
    pages_manage_posts: 'إدارة منشورات الصفحة',
    pages_read_engagement: 'قراءة تفاعل الصفحة (إلزامية لنشر الفيديو)',
    pages_show_list: 'عرض قائمة الصفحات',
  };

  const runPermCheck = async () => {
    setPermBusy(true); setPermErr(''); setPerm(null);
    try { setPerm(await apiService.getFacebookVideoPermissionDiagnosis()); }
    catch (e: any) { setPermErr(e?.code ? `[${e.code}] ${e?.message || ''}` : (e?.message || 'تعذّر فحص الصلاحيات')); }
    finally { setPermBusy(false); }
  };
  const runDiagFetch = async () => {
    setDiagBusy(true); setDiagErr(''); setDiag(null);
    try { setDiag(await apiService.getPublishDiagnostics({ limit: 20 })); }
    catch (e: any) { setDiagErr(e?.message || 'تعذّر جلب سجل التشخيص'); }
    finally { setDiagBusy(false); }
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-800/70 text-[10px] space-y-2">
      <p className="text-slate-500 flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> تشخيص نشر فيديو Facebook (للمالك — لا يُصلح الصلاحية، يكشفها فقط):</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void runPermCheck()} disabled={permBusy}
          className="px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 text-[10px] font-black inline-flex items-center gap-1 disabled:opacity-50">
          {permBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />} فحص صلاحيات نشر الفيديو
        </button>
        <button onClick={() => void runDiagFetch()} disabled={diagBusy}
          className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[10px] font-bold text-white inline-flex items-center gap-1 disabled:opacity-50">
          {diagBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />} سجل تشخيص النشر الفاشل
        </button>
      </div>

      {permErr && <p className="text-amber-300">فحص الصلاحيات: {permErr}</p>}
      {perm && (
        <div className={`p-2 rounded-lg bg-slate-950 border space-y-1 ${perm.videoPublishReady ? 'border-emerald-600/30' : 'border-amber-600/30'}`}>
          <p className={perm.videoPublishReady ? 'text-emerald-300 font-bold' : 'text-amber-300 font-bold'}>
            {perm.videoPublishReady ? '✅ نشر فيديو الصفحة جاهز — الصلاحيات كافية.' : '⚠️ نشر فيديو الصفحة غير جاهز — صلاحية مطلوبة ناقصة.'}
          </p>
          <p className="text-slate-400">الصلاحيات الممنوحة فعلاً: {Array.isArray(perm.grantedScopes) && perm.grantedScopes.length > 0 ? perm.grantedScopes.join('، ') : '—'}</p>
          <p className="text-slate-400">الصلاحيات الناقصة لنشر الفيديو: {Array.isArray(perm.missingVideoPublishScopes) && perm.missingVideoPublishScopes.length > 0
            ? perm.missingVideoPublishScopes.map((s: string) => REQUIRED[s] ? `${s} (${REQUIRED[s]})` : s).join('، ')
            : 'لا شيء'}</p>
          {perm.reason && <p className="text-slate-400">{perm.reason}</p>}
          {perm.note && <p className="text-slate-600">{perm.note}</p>}
        </div>
      )}

      {diagErr && <p className="text-amber-300">سجل التشخيص: {diagErr}</p>}
      {diag && (
        <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
          <p className="text-slate-400 font-bold">سجل النشر الفاشل المحفوظ ({diag.count ?? 0} سجل):</p>
          {(!diag.diagnostics || diag.diagnostics.length === 0)
            ? <p className="text-slate-500">لا سجلات نشر فاشلة محفوظة.</p>
            : diag.diagnostics.map((r: any, i: number) => (
              <div key={r.id || i} className="p-1.5 rounded bg-slate-900/70 border border-slate-800 space-y-0.5">
                <p className="text-slate-300"><span className="font-bold">{r.platform}</span> · {r.state} {r.executedAt ? <span className="text-slate-500" dir="ltr">· {r.executedAt}</span> : null}</p>
                <p className="text-rose-300">{r.error || '—'}</p>
                <p className="text-slate-500" dir="ltr">code={r.providerCode ?? '—'} subcode={r.providerSubcode ?? '—'} fbtrace={r.providerTraceId || '—'}</p>
              </div>
            ))}
          {diag.note && <p className="text-slate-600">{diag.note}</p>}
        </div>
      )}
    </div>
  );
};

/**
 * لوحة تشخيص ربط حافظة الأعمال Facebook (للمالك — قراءة-فقط، لا تنفّذ أي ربط).
 * بعض الحقول JSON متداخلة، لذا توجد مساعدتان بصيرتان: `vals` (سلاسل مقروءة من
 * مصفوفة كائنات) و`lines` (سلاسل نصّية غير فارغة). تُعرض قيم الخادم الفعلية فقط
 * بلا أي تفسير مُخترع. الأسماء الإنجليزية استُبدلت بأسماء عربية هي أسماء مفاتيح
 * الاستجابة نفسها، فلا كسر حقل.
 */
function vals(arr: any, ...keys: string[]): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((it) => {
      if (it == null) return '';
      if (typeof it !== 'object') return String(it);
      for (const k of keys) { const v = it[k]; if (v != null && v !== '') return String(v); }
      return '';
    })
    .filter((s) => s !== '');
}
function lines(arr: any): string[] {
  return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x.trim() !== '') : [];
}

const FacebookBusinessLinkDiagnosisPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    setOpen(true);
    if (d || loading) return;
    setLoading(true); setErr('');
    try { setD(await apiService.getFacebookBusinessLinkDiagnosis()); }
    catch (e: any) { setErr(e?.code ? `[${e.code}] ${e?.message || ''}` : (e?.message || 'تعذّر جلب التشخيص')); }
    finally { setLoading(false); }
  };
  const refresh = async () => {
    setLoading(true); setErr('');
    try { setD(await apiService.getFacebookBusinessLinkDiagnosis()); }
    catch (e: any) { setErr(e?.code ? `[${e.code}] ${e?.message || ''}` : (e?.message || 'تعذّر جلب التشخيص')); }
    finally { setLoading(false); }
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-800/70 text-[10px] space-y-2">
      <p className="text-slate-500 flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> تشخيص ربط حافظة الأعمال (للمالك — قراءة-فقط، لا ينفّذ أي ربط):</p>
      <button onClick={() => void load()} disabled={loading}
        className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[10px] font-bold text-white inline-flex items-center gap-1 disabled:opacity-50">
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />} تشخيص ربط حافظة الأعمال (Facebook)
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2 p-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> تشخيص ربط حافظة الأعمال (Facebook)</h3>
              <div className="flex items-center gap-2">
                <button onClick={() => void refresh()} disabled={loading}
                  className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[10px] font-bold text-white inline-flex items-center gap-1 disabled:opacity-50" title="إعادة جلب التشخيص">
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} تحديث
                </button>
                <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white text-sm">✕</button>
              </div>
            </div>

            <div className="p-3 overflow-y-auto space-y-3 text-[11px]">
              {err && <p className="text-amber-300">تعذّر الجلب: {err}</p>}
              {loading && !d && <p className="text-slate-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> جارٍ جلب التشخيص الحقيقي…</p>}

              {d && (
                <>
                  <p className="text-slate-500">بيانات حقيقية من الخادم (قراءة-فقط) — تُعرض كما هي بلا تفسير مضاف.</p>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <Info label="معرّف التطبيق" value={d.appId || '—'} mono />
                    <Info label="سرّ التطبيق مضبوط" value={d.appSecretConfigured ? 'نعم' : 'لا'} />
                    <Info label="صحة بيانات التطبيق (Graph)" value={d.appCredentials?.verdict === 'valid' ? 'صالحة' : 'غير صالحة/غير معروفة'} />
                    <Info label="معرّف Configuration ID مضبوط" value={d.configuration?.configured ? 'نعم' : 'لا'} />
                    <Info label="تمرير scope بلا Configuration" value={d.scopeWithoutConfigOverride ? 'مسموح' : 'محجوب — عتبة قد تُوقف الربط'} />
                    <Info label="نسخة الصلاحيات المستخدمة" value={d.configuration?.permissionSource === 'facebook_login_for_business_configuration' ? 'من Configuration ID' : 'من scope'} />
                  </div>

                  {d.appCredentials?.message && <p className="text-slate-400">رسالة الخادم: {d.appCredentials.message}</p>}

                  {/* 1) المتطلّب الأساسي: أدوار المطوّر على التطبيق */}
                  <Section title="أدوار المطوّر على التطبيق (administrators/developers/testers/insights users)">
                    {d.appRoles?.ok ? (
                      <>
                        <p className="text-slate-300">معرّفات المستخدمين المُدرَجين أدمن على التطبيق (adminUserIds):
                          {lines(d.appRoles.adminUserIds).length === 0
                            ? <span className="text-slate-500"> — لم يُرجع الخادم أي معرّف أدمن.</span>
                            : <span className="text-emerald-300" dir="ltr"> {lines(d.appRoles.adminUserIds).join('، ')}</span>}
                        </p>
                        {vals(d.appRoles.roles, 'userId', 'user').length > 0 && (
                          <p className="text-slate-400" dir="ltr">
                            {vals(d.appRoles.roles, 'userId', 'user').map((u, i) => `${d.appRoles.roles[i]?.role ?? '?'}:${u}`).join('  •  ')}
                          </p>
                        )}
                        {d.appRoles.note && <p className="text-slate-500">{d.appRoles.note}</p>}
                      </>
                    ) : <p className="text-amber-300">تعذّر قراءة الأدوار: {d.appRoles?.error || 'غير متاح'}</p>}
                  </Section>

                  {/* 2) الحافظات التي يراها الحساب المستخدَم حالياً في الربط */}
                  <Section title="حافظات الأعمال المرتبطة بالحساب المستخدَم حالياً في الربط (/me/businesses)">
                    {d.userBusinesses?.ok ? (
                      lines(d.userBusinesses.businesses?.map ? d.userBusinesses.businesses.map((b: any) => `${b.businessId}${b.name ? ` — ${b.name}` : ''}${Array.isArray(b.permittedRoles) && b.permittedRoles.length ? ` [${b.permittedRoles.join('، ')}]` : ''}`) : []).length === 0
                        ? <p className="text-slate-500">لا حافظات ظاهرة لهذا الرمز (قد يكون الحساب المستخدَم في الربط تحت ملف/حساب مختلف).</p>
                        : <div className="space-y-0.5">{lines(d.userBusinesses.businesses?.map ? d.userBusinesses.businesses.map((b: any) => `${b.businessId}${b.name ? ` — ${b.name}` : ''}${Array.isArray(b.permittedRoles) && b.permittedRoles.length ? ` [${b.permittedRoles.join('، ')}]` : ''}`) : []).map((s, i) => <p key={i} className="text-slate-300" dir="ltr">{s}</p>)}</div>
                    ) : <p className="text-amber-300">تعذّر جلب الحافظات: {d.userBusinesses?.error || 'غير متاح'}</p>}
                  </Section>

                  {/* 3) الإثبات العكسي قراءة-فقط */}
                  <Section title="الإثبات العكسي: هل التطبيق ضمن تطبيقات الحافظة؟ (GET /{business-id}/owned_apps)">
                    {d.businessOwnedApps?.attempted ? (
                      d.businessOwnedApps.ok
                        ? <p className={d.businessOwnedApps.containsOurApp ? 'text-emerald-300' : 'text-slate-300'}>
                            {d.businessOwnedApps.containsOurApp ? 'نعم — التطبيق ظاهر ضمن تطبيقات الحافظة.' : 'لا — التطبيق ليس ضمن تطبيقات الحافظة المرجعة.'}
                            <span className="text-slate-500" dir="ltr"> {lines(d.businessOwnedApps.ownedAppIds).join('، ')}</span>
                          </p>
                        : <p className="text-amber-300">تعذّر الفحص: {d.businessOwnedApps.error || 'غير متاح'}</p>
                    ) : <p className="text-slate-500">لم يُجرَ (يلزم ضبط <code dir="ltr">FACEBOOK_BUSINESS_ID</code> ووجود رمز مستخدم مخزّن).</p>}
                  </Section>

                  {/* 4) الرسائل التوضيحية من الخادم كما هي */}
                  {d.documentedOwnerAction && (
                    <Section title="الإجراء الموثّق (كما يعيده الخادم)">
                      <p className="text-slate-400">أين: {d.documentedOwnerAction.where}</p>
                      {lines(d.documentedOwnerAction.steps).length > 0 && (
                        <ol className="list-decimal pr-4 space-y-0.5 text-slate-300">{lines(d.documentedOwnerAction.steps).map((s, i) => <li key={i}>{s}</li>)}</ol>
                      )}
                      {d.documentedOwnerAction.youDontOwnThisApp && (
                        <div className="mt-1 p-2 rounded-lg bg-slate-950 border border-amber-600/30 space-y-1">
                          <p className="text-amber-300 font-bold">حسم تناقض «لا تملك هذا التطبيق»:</p>
                          <p className="text-slate-300">{d.documentedOwnerAction.youDontOwnThisApp.likelyCause}</p>
                          <p className="text-slate-400">كيف تتحقق: {d.documentedOwnerAction.youDontOwnThisApp.howToConfirm}</p>
                          {lines(d.documentedOwnerAction.youDontOwnThisApp.fixes).length > 0 && (
                            <ol className="list-decimal pr-4 space-y-0.5 text-slate-300">{lines(d.documentedOwnerAction.youDontOwnThisApp.fixes).map((s, i) => <li key={i}>{s}</li>)}</ol>
                          )}
                        </div>
                      )}
                      {d.documentedOwnerAction.twoFactorFix && (
                        <p className="text-slate-400">إصلاح 2FA (<span className="text-slate-300">{d.documentedOwnerAction.twoFactorFix.appliesTo}</span>): {d.documentedOwnerAction.twoFactorFix.fix}</p>
                      )}
                      {d.documentedOwnerAction.source && <p className="text-slate-600">المصدر: <span dir="ltr">{d.documentedOwnerAction.source}</span></p>}
                    </Section>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** بطاقة صغيرة لعرض حقل/قيمة (يُستخدم داخل لوحة تشخيص حافظة الأعمال). */
const Info: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
    <p className="text-slate-500">{label}</p>
    <p className={`text-slate-200 font-bold ${mono ? 'font-mono' : ''}`} dir="ltr">{value}</p>
  </div>
);

/** قسم بعنوان داخل لوحة تشخيص حافظة الأعمال. */
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800 space-y-1">
    <p className="text-slate-300 font-bold">{title}</p>
    {children}
  </div>
);

/** حالة اشتراك حساب Instagram في webhook — حقيقية من Meta بلا أي سرّ. */
const InstagramWebhookStatus: React.FC = () => {
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState<string>('');
  useEffect(() => {
    let alive = true;
    apiService.getInstagramWebhookInfo().then((d) => { if (alive) setInfo(d); }).catch((e) => { if (alive) setErr(e?.message || 'تعذر جلب حالة webhook'); });
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
      <p className="text-slate-500">رابط الـwebhook: <code className="text-slate-300">{info.webhookUrl}</code> • الحساب: <code className="text-slate-300">{info.igUsername ? `@${info.igUsername}` : info.igAccountId}</code></p>
      <p className="text-slate-500">حقول الاشتراك المطلوبة: <code className="text-slate-300" dir="ltr">{(info.subscribedFields || []).join(', ')}</code> — تُفعَّل لكائن instagram من لوحة Meta.</p>
      {info.instagramFieldsDashboardOnly && (
        <p className={info.webhookFullyVerified ? 'text-emerald-300' : 'text-amber-300'}>
          {info.webhookFullyVerified
            ? 'الاستقبال موثّق: الصفحة مشتركة ورمز التحقق وسرّ التوقيع مضبوطان، وحقول instagram مُفعَّلة من اللوحة.'
            : 'يلزم تفعيل حقلي comments/messages لكائن instagram من Meta App Dashboard (Graph API لا يضبط حقول Instagram عبر subscribed_apps)، ووصول حدث حقيقي بتوقيع صحيح قبل اعتباره موثّقاً.'}
        </p>
      )}
    </div>
  );
};

/**
 * لوحة حالة TikTok الحقيقية (للمالك): اتصال + توكنات (منطقية) + قدرات + قيد المراجعة
 * + معلومات الناشر + استعلام حالة النشر. لا تُعرض أي قيمة سرّية إطلاقاً.
 */
const TikTokStatusPanel: React.FC = () => {
  const [status, setStatus] = useState<any>(null);
  const [creator, setCreator] = useState<any>(null);
  const [creatorErr, setCreatorErr] = useState<string>('');
  const [publishId, setPublishId] = useState('');
  const [publishStatus, setPublishStatus] = useState<any>(null);
  const [publishes, setPublishes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>('');
  const loadPublishes = async () => {
    try { setPublishes(await apiService.getTikTokPublishes()); }
    catch (e: any) { setPublishes({ error: e?.message || 'تعذر جلب سجل العمليات' }); }
  };
  useEffect(() => {
    let alive = true;
    apiService.getTikTokStatus().then((d) => { if (alive) setStatus(d); }).catch((e) => { if (alive) setErr(e?.message || 'تعذر جلب حالة TikTok'); });
    apiService.getTikTokPublishes().then((d) => { if (alive) setPublishes(d); }).catch(() => { /* السجل اختياري للعرض */ });
    return () => { alive = false; };
  }, []);
  const loadCreator = async () => {
    setBusy(true); setCreatorErr('');
    try { setCreator(await apiService.getTikTokCreatorInfo()); }
    catch (e: any) { setCreatorErr(e?.message || 'تعذر جلب معلومات الناشر'); }
    finally { setBusy(false); }
  };
  const checkStatus = async () => {
    if (!publishId.trim()) return;
    setBusy(true);
    try { setPublishStatus(await apiService.getTikTokPublishStatus(publishId.trim())); }
    catch (e: any) { setPublishStatus({ error: e?.message || 'تعذر استعلام الحالة' }); }
    finally { setBusy(false); }
  };
  if (err) return <p className="text-[10px] text-amber-300 mt-2">حالة TikTok: {err}</p>;
  if (!status) return <p className="text-[10px] text-slate-500 mt-2">جارٍ جلب حالة TikTok الحقيقية…</p>;
  const cap = (v: string) => v === 'SUPPORTED' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-600/30'
    : v === 'NOT_AVAILABLE_BY_PUBLIC_API' ? 'bg-slate-800 text-slate-500 border-slate-700'
      : 'bg-amber-500/10 text-amber-300 border-amber-600/30';
  // تلوين الحالة الصادقة حسب دلالتها (تشغيلية/موثقة/انتقالية/محجوبة/غير مُعدّة).
  const toneCls: Record<string, string> = {
    operational: 'bg-emerald-500/20 text-emerald-300 border-emerald-600/40',
    verified: 'bg-emerald-500/10 text-emerald-300 border-emerald-600/30',
    transitional: 'bg-sky-500/10 text-sky-300 border-sky-600/30',
    blocked: 'bg-amber-500/10 text-amber-300 border-amber-600/30',
    unconfigured: 'bg-slate-800 text-slate-400 border-slate-700',
  };
  return (
    <div className="mt-3 pt-3 border-t border-slate-800/70 text-[10px] space-y-2">
      <p className="text-slate-500 flex items-center gap-1"><KeyRound className="w-3 h-3" /> حالة موصل TikTok الحقيقية (بلا أي سرّ):</p>
      {/* الحالة الصادقة الموحّدة: مفردة واحدة دقيقة + السبب + الإجراء التالي. */}
      <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-500">الحالة الصادقة:</span>
          <span className={`px-2 py-0.5 rounded-md border font-black ${toneCls[status.stateTone] || toneCls.unconfigured}`}>{status.stateLabelAr || status.state}</span>
          <code className="text-slate-500 text-[9px]" dir="ltr">{status.state}</code>
        </div>
        {status.stateReason && <p className="text-slate-400">{status.stateReason}</p>}
        {status.nextAction && <p className="text-slate-300">الإجراء التالي: {status.nextAction}</p>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className={`px-2 py-0.5 rounded-md border font-bold ${status.providerVerified ? 'bg-emerald-500/10 text-emerald-300 border-emerald-600/30' : status.connected ? 'bg-indigo-500/10 text-indigo-300 border-indigo-600/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
          {status.providerVerified ? 'متصل وموثق (open_id)' : status.connected ? 'متصل — غير موثق' : 'غير متصل'}
        </span>
        <span className={`px-2 py-0.5 rounded-md border font-bold ${status.clientKeyConfigured && status.clientSecretConfigured ? 'bg-emerald-500/10 text-emerald-300 border-emerald-600/30' : 'bg-amber-500/10 text-amber-300 border-amber-600/30'}`}>
          {status.clientKeyConfigured && status.clientSecretConfigured ? 'بيانات التطبيق مضبوطة' : 'بيانات التطبيق ناقصة'}
        </span>
        <span className={`px-2 py-0.5 rounded-md border font-bold ${status.tokenStored ? 'bg-emerald-500/10 text-emerald-300 border-emerald-600/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
          {status.tokenStored ? 'التوكن مخزّن مشفّراً' : 'لا توكن'}
        </span>
        <span className={`px-2 py-0.5 rounded-md border font-bold ${status.refreshTokenStored ? 'bg-emerald-500/10 text-emerald-300 border-emerald-600/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
          {status.refreshTokenStored ? 'refresh token مخزّن' : 'لا refresh token'}
        </span>
        {status.tokenExpired && <span className="px-2 py-0.5 rounded-md border font-bold bg-rose-500/10 text-rose-300 border-rose-600/30">التوكن منتهٍ — يلزم تجديد/إعادة ربط</span>}
        {status.appReviewRequired && <span className="px-2 py-0.5 rounded-md border font-bold bg-amber-500/10 text-amber-300 border-amber-600/30">النشر العام يحتاج مراجعة TikTok (audit)</span>}
      </div>
      <p className="text-slate-500">الحساب: <code className="text-slate-300" dir="ltr">{status.accountName || status.accountId || '—'}</code> • النطاقات: <code className="text-slate-300" dir="ltr">{(status.requestedScopes || []).join(', ')}</code></p>
      <p className="text-slate-500">رابط الـwebhook: <code className="text-slate-300 break-all" dir="ltr">{status.webhookUrl}</code> • الأحداث: <code className="text-slate-300" dir="ltr">{(status.webhookEvents || []).join(', ')}</code></p>
      <div className="flex flex-wrap gap-1">
        {[['نشر مباشر', status.directPostCapability], ['رفع مسودة', status.draftUploadCapability], ['صور', status.photoPublishingCapability], ['تحليلات', status.analyticsCapability], ['webhooks', status.webhookCapability], ['تعليقات', status.commentsCapability], ['رسائل مباشرة', status.directMessagesCapability]].map(([label, v]: any) => (
          <span key={label} className={`px-1.5 py-0.5 rounded-md border text-[9px] font-semibold ${cap(v)}`} title={String(v)}>{label}: {v === 'SUPPORTED' ? 'مدعوم' : v === 'NOT_AVAILABLE_BY_PUBLIC_API' ? 'غير متاح عام' : 'يحتاج مراجعة'}</span>
        ))}
      </div>
      {status.connected && (
        <div className="space-y-1.5">
          <button onClick={() => void loadCreator()} disabled={busy} className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[10px] font-bold text-white inline-flex items-center gap-1 disabled:opacity-50">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />} جلب معلومات الناشر
          </button>
          {creatorErr && <p className="text-amber-300">{creatorErr}</p>}
          {creator?.creator && (
            <p className="text-slate-400">الناشر: <code className="text-slate-300">{creator.creator.nickname || creator.creator.username || '—'}</code> • مستويات الخصوصية المتاحة: <code className="text-slate-300" dir="ltr">{(creator.creator.privacyLevelOptions || []).join(', ') || '—'}</code></p>
          )}
          <div className="flex items-center gap-1.5">
            <input value={publishId} onChange={(e) => setPublishId(e.target.value)} placeholder="publish_id" dir="ltr"
              className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-[10px] text-white w-48" />
            <button onClick={() => void checkStatus()} disabled={busy || !publishId.trim()} className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[10px] font-bold text-white disabled:opacity-50">استعلام حالة النشر</button>
          </div>
          {publishStatus && (
            <p className={publishStatus.error ? 'text-rose-300' : publishStatus.status?.delivered ? 'text-emerald-300' : 'text-slate-400'}>
              {publishStatus.error || `الحالة: ${publishStatus.status?.rawStatus || '—'} — ${publishStatus.status?.detail || ''}${publishStatus.status?.providerPostId ? ` • معرّف المنشور: ${publishStatus.status.providerPostId}` : ''}`}
            </p>
          )}
        </div>
      )}
      <p className="text-slate-600">التعليقات والرسائل المباشرة غير متاحة عبر واجهة TikTok العامة — لا تُعلن المنصة دعمها ولا تُختلق.</p>
      {/* سجل عمليات النشر الحقيقي: يُثبت أن التسليم يُحسم تلقائياً من دليل المزود. */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-slate-500">سجل عمليات النشر (يُحدَّث تلقائياً من TikTok):</span>
          <button onClick={() => void loadPublishes()} className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[9px] font-bold text-slate-300">تحديث</button>
        </div>
        {publishes?.error && <p className="text-amber-300">{publishes.error}</p>}
        {Array.isArray(publishes?.publishes) && publishes.publishes.length === 0 && (
          <p className="text-slate-600">لا عمليات نشر بعد. بعد تهيئة أي نشر يُستعلم عن حالته من TikTok تلقائياً حتى تُحسم.</p>
        )}
        {Array.isArray(publishes?.publishes) && publishes.publishes.slice(0, 5).map((r: any) => (
          <div key={r.id} className="p-1.5 rounded-md bg-slate-950 border border-slate-800 flex flex-wrap items-center gap-2">
            <span className={`px-1.5 py-0.5 rounded-md border text-[9px] font-black ${r.state === 'published' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-600/30' : r.state === 'failed' ? 'bg-rose-500/10 text-rose-300 border-rose-600/30' : 'bg-sky-500/10 text-sky-300 border-sky-600/30'}`}>
              {r.state === 'published' ? 'مُسلَّم (PUBLISH_COMPLETE)' : r.state === 'failed' ? 'فشل' : 'بانتظار تأكيد المزود'}
            </span>
            <span className="text-slate-500">{r.postMode === 'MEDIA_UPLOAD' ? 'رفع مسودة' : 'نشر مباشر'}</span>
            {r.providerPublishId && <code className="text-slate-400 text-[9px]" dir="ltr">publish_id: {r.providerPublishId}</code>}
            {r.providerPostId && <code className="text-emerald-300 text-[9px]" dir="ltr">post_id: {r.providerPostId}</code>}
            {r.deliveryDetail && <span className="text-slate-500">{r.deliveryDetail}</span>}
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * لوحة YouTube التشغيلية (للمالك): تعرض القدرات الحقيقية وحالة الاستقبال والتشغيل.
 * كل زر مرتبط بمسار خادم حقيقي يمر ببوابات (قدرة → اتصال موثق → idempotency →
 * rate limit → تنفيذ → audit). لا تُعرض أي قيمة سرّية إطلاقاً، ولا تُعلن قدرة
 * غير منفّذة. الرفع/الرد/الجدولة عمليات حقيقية لدى YouTube Data API.
 */
const YouTubeStatusPanel: React.FC<{ onReconnect: () => void; busy: boolean }> = ({ onReconnect, busy }) => {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [diag, setDiag] = useState<any>(null);
  const [videos, setVideos] = useState<any>(null);
  const [err, setErr] = useState<string>('');
  const [reauthNeeded, setReauthNeeded] = useState(false);
  const [scopeUpgrade, setScopeUpgrade] = useState(false);

  const runCheck = async () => {
    setChecking(true); setErr(''); setResult(null); setReauthNeeded(false); setScopeUpgrade(false);
    try {
      const data = await apiService.getPlatformHealth('youtube');
      setResult(data);
      // تشخيص القدرات الحقيقية (بلا سرّ) + قائمة الفيديوهات إن كان الاتصال موثقاً.
      const d = await apiService.getYouTubeDiagnostics().catch(() => null);
      if (d) { setDiag(d); if (d.state?.state === 'SCOPE_UPGRADE_REQUIRED') setScopeUpgrade(true); }
      const v = await apiService.getYouTubeVideos(10).catch(() => null);
      if (v) setVideos(v);
    } catch (e: any) {
      setErr(e?.message || 'تعذّر فحص القناة');
      // 409 = رمز مرفوض فعلاً ولا يمكن تجديده؛ عندها فقط نطلب إعادة الربط.
      setReauthNeeded(true);
    } finally {
      setChecking(false);
    }
  };

  const implemented: string[] = diag?.implementedCapabilities || [];
  const capLabel: Record<string, string> = {
    oauth_login: 'تسجيل الدخول', channel_identity: 'هوية القناة', connection_persistence: 'حفظ الاتصال',
    video_list: 'قائمة الفيديوهات', video_upload: 'رفع الفيديو', video_update: 'تحديث الفيديو',
    publishing: 'النشر', scheduling: 'الجدولة', comments_read: 'قراءة التعليقات',
    comment_reply: 'الرد على التعليقات', analytics: 'الإحصاءات',
  };
  const shownCaps = Object.keys(capLabel).filter((k) => implemented.includes(k));

  return (
    <div className="mt-3 pt-3 border-t border-slate-800/70 text-[10px] space-y-2">
      <p className="text-slate-500 flex items-center gap-1"><KeyRound className="w-3 h-3" /> حالة YouTube التشغيلية (اتصال + قناة + محتوى + تعليقات + إحصاءات):</p>
      <button onClick={() => void runCheck()} disabled={checking}
        className="px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 text-[10px] font-black inline-flex items-center gap-1 disabled:opacity-50">
        {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} فحص القناة والحالة
      </button>

      {result && (
        <div className="p-2 rounded-lg bg-slate-950 border border-emerald-600/30 space-y-1">
          <p className="text-emerald-300 font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> حالة الفحص: ناجح</p>
          <p className="text-slate-400">اسم القناة: <code className="text-slate-200">{result.accountName || '—'}</code></p>
          <p className="text-slate-400">معرّف القناة: <code className="text-slate-200" dir="ltr">{result.accountId || '—'}</code></p>
          <p className="text-slate-400">وقت آخر فحص: <code className="text-slate-200" dir="ltr">{result.checkedAt || '—'}</code></p>
          {result.tokenRefreshed && <p className="text-sky-300">أُعيد تجديد رمز الوصول تلقائياً قبل الفحص (الاتصال دائم بلا إعادة ربط).</p>}
          {diag?.state?.state && (
            <p className="text-slate-400">الحالة الصادقة: <span className="text-slate-200 font-bold">{diag.state.labelAr}</span> — {diag.state.reason}</p>
          )}
        </div>
      )}

      {shownCaps.length > 0 && (
        <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
          <p className="text-slate-400 font-bold">القدرات المنفّذة فعلاً (بلا ادعاء):</p>
          <div className="flex flex-wrap gap-1">
            {shownCaps.map((k) => <span key={k} className="px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-600/30 text-[9px] font-semibold">{capLabel[k]}</span>)}
          </div>
          {diag?.forceSslGranted === false && <p className="text-amber-300">إدارة التعليقات تحتاج إعادة ربط لإضافة نطاق youtube.force-ssl.</p>}
        </div>
      )}

      {videos?.videos?.length > 0 && (
        <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
          <p className="text-slate-400 font-bold">أحدث الفيديوهات (حقيقية من Data API):</p>
          {videos.videos.slice(0, 5).map((v: any) => (
            <p key={v.videoId} className="text-slate-400">
              <code className="text-slate-200" dir="ltr">{v.videoId}</code> — {v.title}
              {typeof v.viewCount === 'number' && <span className="text-slate-500"> · {v.viewCount} مشاهدة</span>}
              {typeof v.commentCount === 'number' && <span className="text-slate-500"> · {v.commentCount} تعليق</span>}
            </p>
          ))}
        </div>
      )}

      {scopeUpgrade && (
        <div className="p-2 rounded-lg bg-slate-950 border border-amber-600/30 space-y-1.5">
          <p className="text-amber-300 font-bold flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> إعادة ربط YouTube مطلوبة لتفعيل إدارة التعليقات</p>
          <p className="text-slate-400">الرمز الحالي لا يحمل نطاق youtube.force-ssl؛ لا تحايل على Google — أعد الربط لمنح النطاق.</p>
          <button onClick={() => onReconnect()} disabled={busy}
            className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[10px] font-bold text-white inline-flex items-center gap-1 disabled:opacity-50">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <PlugZap className="w-3 h-3" />} إعادة ربط OAuth
          </button>
        </div>
      )}

      {reauthNeeded && (
        <div className="p-2 rounded-lg bg-slate-950 border border-amber-600/30 space-y-1.5">
          <p className="text-amber-300 font-bold flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> فشل الفحص — إعادة ربط Google مطلوبة</p>
          <p className="text-slate-400">{err}{result?.errorKind ? ` — ${result.errorKind}` : ''}</p>
          <button onClick={() => onReconnect()} disabled={busy}
            className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[10px] font-bold text-white inline-flex items-center gap-1 disabled:opacity-50">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <PlugZap className="w-3 h-3" />} إعادة ربط OAuth
          </button>
        </div>
      )}

      <p className="text-slate-600">الرفع/التحديث/النشر/الجدولة/التعليقات/الرد/الإحصاءات منفّذة فعلاً على YouTube Data API. التركيبة السكانية (عمر/جنس/موقع) غير متاحة عبر Data API — لا تُخترع. عمليات الرفع والرد من الواجهة التشغيلية أو العقل المركزي بموافقة المالك.</p>

      <YouTubeDelegationPanel />
    </div>
  );
};

/**
 * لوحة تفويض تشغيل YouTube (للمالك): تمنح العقل المركزي تنفيذ عمليات YouTube
 * المحدّدة بلا موافقة منفصلة لكل عملية، مع إمكانية الإيقاف الفوري. النطاق YouTube
 * فقط؛ لا تُلغى المصادقة/الملكية/التدقيق/سلامة المحتوى. لا تُعرض أي قيمة سرّية.
 */
const YouTubeDelegationPanel: React.FC = () => {
  const [state, setState] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string[]>(['reply', 'publish', 'schedule', 'update_video']);
  const [err, setErr] = useState('');
  const actions: Array<{ id: string; label: string }> = [
    { id: 'reply', label: 'الرد على التعليقات' },
    { id: 'publish', label: 'رفع/نشر فيديو' },
    { id: 'schedule', label: 'جدولة فيديو' },
    { id: 'update_video', label: 'تحديث بيانات فيديو' },
  ];

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const d = await apiService.getYouTubeDelegation();
      setState(d.delegation || null);
      if (Array.isArray(d.delegation?.actions) && d.delegation.actions.length) setSelected(d.delegation.actions);
    } catch (e: any) { setErr(e?.message || 'تعذّر تحميل التفويض'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = (id: string) => setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const grant = async () => {
    setSaving(true); setErr('');
    try { const d = await apiService.grantYouTubeDelegation({ actions: selected }); setState(d.delegation || null); }
    catch (e: any) { setErr(e?.message || 'تعذّر منح التفويض'); }
    finally { setSaving(false); }
  };
  const revoke = async () => {
    setSaving(true); setErr('');
    try { const d = await apiService.revokeYouTubeDelegation(); setState(d.delegation || null); }
    catch (e: any) { setErr(e?.message || 'تعذّر إيقاف التفويض'); }
    finally { setSaving(false); }
  };

  const active = state?.active === true;
  const tone = active ? 'text-emerald-300 border-emerald-600/30' : 'text-amber-300 border-amber-600/30';

  return (
    <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
      <p className="text-slate-400 font-bold flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> تفويض تشغيل YouTube للعقل المركزي (نطاق YouTube فقط)</p>
      {loading && <p className="text-slate-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> تحميل حالة التفويض…</p>}
      {state && (
        <>
          <p className={`font-bold ${tone.split(' ')[0]}`}>
            {active ? 'التفويض فعّال — العقل ينفّذ العمليات الممنوحة تلقائياً' : `التفويض غير فعّال (${state.state})`}
          </p>
          <p className="text-slate-400">{state.reason}</p>
          {Array.isArray(state.actionsLabelAr) && state.actionsLabelAr.length > 0 && (
            <p className="text-slate-400">العمليات الممنوحة: <span className="text-slate-200">{state.actionsLabelAr.join('، ')}</span></p>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-1">
        {actions.map((a) => (
          <button key={a.id} onClick={() => toggle(a.id)} disabled={saving}
            className={`px-2 py-0.5 rounded-md text-[9px] font-semibold border ${selected.includes(a.id) ? 'bg-emerald-500/15 text-emerald-300 border-emerald-600/40' : 'bg-slate-900 text-slate-400 border-slate-700'}`}>
            {a.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void grant()} disabled={saving || !selected.length}
          className="px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 text-[10px] font-black inline-flex items-center gap-1 disabled:opacity-50">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />} منح/تحديث التفويض
        </button>
        <button onClick={() => void revoke()} disabled={saving || !state?.granted}
          className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[10px] font-bold text-white inline-flex items-center gap-1 disabled:opacity-50">
          إيقاف التفويض
        </button>
      </div>
      {err && <p className="text-rose-300">{err}</p>}
      <p className="text-slate-600">التفويض خاص بـYouTube فقط ولا يمنح أي منصة أخرى. لا يُلغي المصادقة ولا الملكية ولا سجل التدقيق ولا حارس سلامة المحتوى ولا منع التكرار. كل عملية تبقى مسجّلة، ويمكن إيقاف التفويض فوراً.</p>
    </div>
  );
};

export const PlatformConnectionCenter: React.FC = () => {
  const { currentUser, showToast, oauthReturn, clearOauthReturn } = useApp();
  const [loading, setLoading] = useState(false);
  const [control, setControl] = useState<any>(null);
  const [external, setExternal] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Facebook: الحساب قد يدير أكثر من صفحة، فيُعرض اختيار الصفحة لإتمام الربط.
  const [fbPages, setFbPages] = useState<any[] | null>(null);
  // Instagram: الحساب قد يدير أكثر من صفحة لها حساب مهني، فيُعرض اختيار الحساب.
  const [igAccounts, setIgAccounts] = useState<any[] | null>(null);

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

  // نتيجة عودة OAuth بتدفّق المقطع (Instagram): تُعرض مرة واحدة ثم تُمسح، وتُحدَّث
  // الحالة فوراً فلا يظن المالك أن الربط لم يحدث. خطاف على المستوى الأعلى خارج load
  // التزاماً بقواعد React Hooks — كان موضوعاً داخل دالة async فيسبب "Invalid hook call".
  useEffect(() => {
    if (!oauthReturn) return;
    showToast(oauthReturn.ok ? 'تم إكمال ربط Instagram.' : `تعذر إكمال ربط Instagram: ${oauthReturn.message || ''}`);
    clearOauthReturn();
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthReturn]);

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

  const loadInstagramAccounts = async () => {
    setBusy('instagram-accounts');
    try { const res = await apiService.getInstagramAccounts(); setIgAccounts(res.accounts || []); }
    catch (e: any) { showToast(e?.message || 'تعذر جلب حسابات Instagram'); }
    finally { setBusy(null); }
  };
  const chooseInstagramAccount = async (pageId: string) => {
    setBusy(`instagram-account-${pageId}`);
    try { const res = await apiService.selectInstagramAccount(pageId); showToast(res.webhookSubscribed ? 'تم ربط حساب Instagram والاشتراك في webhook.' : 'تم ربط حساب Instagram، لكن اشتراك webhook لم يُثبت.'); setIgAccounts(null); void load(); }
    catch (e: any) { showToast(e?.message || 'تعذر ربط حساب Instagram'); }
    finally { setBusy(null); }
  };

  const startOAuth = async (platform: string) => {
    setBusy(platform);
    try {
      const res = await apiService.startPlatformOAuth(platform);
      if (res?.authorizationUrl) { window.location.href = res.authorizationUrl; return; }
      showToast('تم بدء الربط.');
    } catch (e: any) {
      // إظهار رمز الفحص الصريح بدل نص عام: سبب 409 (مثل META_APP_SECRET_INVALID)
      // يجب أن يظهر للمالك مباشرة، وإلا بدا الزر «لا يفعل شيئاً».
      const code = e?.code ? `[${e.code}] ` : '';
      showToast(code + (e?.message || 'تعذر بدء الربط'));
    }
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
          // Instagram بعد OAuth قد ينتظر اختيار الحساب المهني من بين عدة صفحات.
          const igPageSelection = p.platform === 'instagram' && p.pageSelectionPending === true;
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
                  ) : igPageSelection ? (
                    // Instagram: تفويض Meta اكتمل وينتظر اختيار الحساب المهني.
                    <>
                      <button onClick={() => void loadInstagramAccounts()} disabled={busy === 'instagram-accounts'}
                        className="px-3 py-1.5 rounded-lg bg-sky-500 text-slate-950 text-[11px] font-black inline-flex items-center gap-1 disabled:opacity-50">
                        {busy === 'instagram-accounts' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />} اختيار الحساب
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
                      {busy === p.platform ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />} {p.platform === 'tiktok' ? 'ربط TikTok' : 'بدء الربط'}
                    </button>
                  ) : p.platform === 'facebook' ? (
                    // Facebook: الحساب موثوق لكنه يدير أكثر من صفحة؛ إتمام الربط باختيار الصفحة.
                    <button onClick={() => void loadFacebookPages()} disabled={busy === 'facebook-pages'}
                      className="px-3 py-1.5 rounded-lg bg-sky-500 text-slate-950 text-[11px] font-black inline-flex items-center gap-1 disabled:opacity-50">
                      {busy === 'facebook-pages' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />} اختيار الصفحة
                    </button>
                  ) : p.platform === 'instagram' ? (
                    // Instagram: الحساب موثوق؛ إتمام الربط باختيار الحساب المهني.
                    <button onClick={() => void loadInstagramAccounts()} disabled={busy === 'instagram-accounts'}
                      className="px-3 py-1.5 rounded-lg bg-sky-500 text-slate-950 text-[11px] font-black inline-flex items-center gap-1 disabled:opacity-50">
                      {busy === 'instagram-accounts' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />} اختيار الحساب
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
              {p.platform === 'facebook' && <FacebookVideoDiagnosticsPanel />}
              {p.platform === 'facebook' && <FacebookBusinessLinkDiagnosisPanel />}

              {p.platform === 'instagram' && igAccounts && (
                <div className="mt-3 pt-3 border-t border-slate-800/70">
                  <p className="text-[10px] text-slate-500 mb-1.5">اختر حساب Instagram المهني (معرّفات وأسماء فقط بلا أي رمز):</p>
                  <div className="flex flex-wrap gap-2">
                    {igAccounts.length === 0 && <span className="text-[11px] text-slate-400">لا حسابات Instagram مهنية مرتبطة بصفحات هذا الحساب.</span>}
                    {igAccounts.map((ac: any) => (
                      <button key={ac.pageId} onClick={() => void chooseInstagramAccount(ac.pageId)} disabled={busy === `instagram-account-${ac.pageId}`}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-[11px] font-bold text-white inline-flex items-center gap-1 disabled:opacity-50">
                        {busy === `instagram-account-${ac.pageId}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Webhook className="w-3.5 h-3.5" />} {ac.igUsername ? `@${ac.igUsername}` : ac.igAccountId}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {p.platform === 'instagram' && p.connected && <InstagramWebhookStatus />}
              {p.platform === 'tiktok' && <TikTokStatusPanel />}
              {/* YouTube: فحص قناة قراءة فقط (للمالك) — لا رفع/نشر/تغيير. */}
              {p.platform === 'youtube' && <YouTubeStatusPanel onReconnect={() => void startOAuth('youtube')} busy={busy === 'youtube'} />}
              {['facebook', 'instagram', 'threads'].includes(p.platform) && <OAuthSetupPanel platform={p.platform} />}

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
