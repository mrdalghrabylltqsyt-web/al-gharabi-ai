import React, { useCallback, useEffect, useState } from 'react';
import { CloudUpload, HardDrive, RefreshCw, ShieldCheck, TriangleAlert, CheckCircle2, Loader2, Database, Clock, History, Gauge } from 'lucide-react';
import { apiService } from '../../services/api';
import { useApp } from '../../context/AppContext';

// واجهة النسخ السحابي والاستعادة (Google Drive): قراءة فقط + زر ربط واحد.
// لا رفع ولا حذف ولا استعادة ولا مزامنة دورية — المرحلة الحالية للعرض والربط فقط.
// لا تُخزَّن ولا تُعرض أي أسرار (state / authorization code / refresh token).

const DR_STATE_LABELS: Record<string, string> = {
  not_authorized: 'غير مربوط',
  never_synced: 'مربوط — بلا نسخة بعد',
  synced: 'مربوط ومنسوخ',
  failed: 'فشل الفحص',
  unknown: 'غير معروف',
};

const fmtBytes = (n: number | null | undefined): string => {
  if (!Number.isFinite(n as number) || n == null) return 'غير متاح';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

const fmtTime = (iso: string | null | undefined): string => {
  if (!iso) return 'لا يوجد';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString('ar-IQ') : String(iso);
};

export type DrStatusErrorKind = 'session' | 'forbidden' | 'unavailable';

export interface DrStatusErrorInfo {
  kind: DrStatusErrorKind;
  message: string;
}

// تصنيف فشل جلب حالة DR إلى رسالة عربية صريحة (منطق صافٍ قابل للاختبار).
// 401 => جلسة منتهية، 403 => مقتصر على المالك، غير ذلك => تعذّر الجلب/الشبكة.
export function classifyDrStatusError(err: any): DrStatusErrorInfo {
  const status = Number(err?.status);
  if (status === 401) {
    return { kind: 'session', message: 'انتهت جلسة المالك. يرجى إعادة تسجيل الدخول ثم تحديث الحالة.' };
  }
  if (status === 403) {
    return { kind: 'forbidden', message: 'هذا القسم مقتصر على مالك النظام (Owner) فقط.' };
  }
  return { kind: 'unavailable', message: 'تعذّر جلب حالة النسخ السحابي من الخادم. تحقّق من الاتصال وأعد المحاولة.' };
}

export interface DrStatusUpdate {
  ok: boolean;
  /** عند النجاح فقط: اللقطة الجديدة. عند الفشل undefined فلا تُمسح اللقطة السابقة. */
  snapshot?: any;
  statusError: DrStatusErrorInfo | null;
  /** وقت آخر تحديث ناجح (ISO) عند النجاح فقط. */
  updatedAt?: string;
}

// يحوّل نتيجة getDrStatus إلى تحديث حالة الواجهة. منطق صافٍ قابل للاختبار:
// النجاح يعرض البيانات، والفشل يُبقي البيانات السابقة ويعطي رسالة صريحة.
export function resolveDrStatusUpdate(
  statusRes: PromiseSettledResult<any>,
  nowIso: string,
): DrStatusUpdate {
  if (statusRes.status === 'fulfilled') {
    return { ok: true, snapshot: statusRes.value?.snapshot ?? null, statusError: null, updatedAt: nowIso };
  }
  return { ok: false, statusError: classifyDrStatusError(statusRes.reason) };
}

export type DrBackupOutcome = 'created' | 'no_change' | 'blocked' | 'failed';

export interface DrBackupResultInfo {
  ok: boolean;
  outcome: DrBackupOutcome;
  title: string;
  detail: string;
}

// ترجمة نتيجة إنشاء النسخة إلى رسالة عربية صادقة. لا نُعلن نجاحاً إلا بحالة
// `backed_up` مؤكدة؛ و`no_change` و`blocked` و`failed` تظهر بسببها الصريح.
export function resolveDrBackupResult(data: any): DrBackupResultInfo {
  const state = data?.state;
  if (state === 'backed_up' && data?.verified === true) {
    return { ok: true, outcome: 'created', title: 'تم إنشاء النسخة الاحتياطية والتحقق منها', detail: `نقطة الاستعادة: ${data?.recoveryPointId || '—'} • الالتزام: ${(data?.commit || '—').slice(0, 12)}` };
  }
  if (state === 'no_change') {
    return { ok: true, outcome: 'no_change', title: 'لا تغيير منذ آخر نسخة', detail: 'نفس الالتزام وبصمة المحتوى: لم تُنشأ نسخة تاريخية مكررة.' };
  }
  if (state === 'blocked') {
    return { ok: false, outcome: 'blocked', title: 'النسخة قيد التنفيذ', detail: 'نسخة احتياطية تعمل بالفعل. انتظر قليلاً ثم حدّث الحالة.' };
  }
  const reason = data?.reason ? ` (${data.reason})` : '';
  return { ok: false, outcome: 'failed', title: 'فشل إنشاء النسخة الاحتياطية', detail: `${data?.message || 'لم تكتمل النسخة.'}${reason}` };
}

export const CloudBackupView: React.FC = () => {
  const { currentUser, showToast } = useApp();
  const isOwner = currentUser?.role === 'owner';
  const [health, setHealth] = useState<any>(null);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState<DrBackupResultInfo | null>(null);
  const [statusError, setStatusError] = useState<DrStatusErrorInfo | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  // منظومة التعافي الكامل
  const [recoveryPoints, setRecoveryPoints] = useState<any[]>([]);
  const [currentState, setCurrentState] = useState<any>(null);
  const [mirror, setMirror] = useState<any>(null);
  const [secretsStatus, setSecretsStatus] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [drilling, setDrilling] = useState(false);
  const [drillReport, setDrillReport] = useState<any>(null);
  const [selectedPoint, setSelectedPoint] = useState<string>('');
  const [restorePlan, setRestorePlan] = useState<any>(null);

  const load = useCallback(async () => {
    if (!isOwner) return;
    setLoading(true);
    try {
      // الصحة عامة؛ الحالة محمية بالمالك. نعالج كل فشل صراحةً بدل ابتلاعه.
      const [healthRes, statusRes, pointsRes, secretsRes] = await Promise.allSettled([
        apiService.getDrHealth(),
        apiService.getDrStatus(),
        apiService.getDrRecoveryPoints(),
        apiService.getDrSecretsStatus(),
      ]);

      if (healthRes.status === 'fulfilled') setHealth(healthRes.value?.dr || null);
      if (pointsRes.status === 'fulfilled') {
        setRecoveryPoints(Array.isArray(pointsRes.value?.recoveryPoints) ? pointsRes.value.recoveryPoints : []);
        setCurrentState(pointsRes.value?.currentState ?? null);
        setMirror(pointsRes.value?.mirror ?? null);
      }
      if (secretsRes.status === 'fulfilled') setSecretsStatus(secretsRes.value ?? null);

      const update = resolveDrStatusUpdate(statusRes, new Date().toISOString());
      if (update.ok) {
        setSnapshot(update.snapshot);
        setStatusError(null);
        setLastUpdatedAt(update.updatedAt || null);
      } else {
        // لا نمسح البيانات السابقة: نُبقي آخر لقطة معروفة ونعرض تنبيهاً صريحاً.
        setStatusError(update.statusError);
        showToast(update.statusError?.message || 'تعذّر جلب حالة النسخ السحابي.');
      }
    } finally {
      setLoading(false);
    }
  }, [isOwner, showToast]);

  useEffect(() => { void load(); }, [load]);

  // الحماية الحقيقية على الخادم (requireOwner)؛ هنا إخفاء الصفحة عن غير المالك.
  if (!isOwner) {
    return <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-slate-300">هذا القسم مخصص لمالك النظام فقط.</div>;
  }

  const authorized = health?.authorized === true;
  const configured = health?.configured === true;
  const stateKey = snapshot?.state || (authorized ? 'never_synced' : 'not_authorized');

  const connectDrive = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      const r = await apiService.getDrAuthUrl();
      if (!r?.url) throw new Error('لم يُعد الخادم رابط تفويض صالحاً.');
      // الانتقال إلى شاشة موافقة Google. لا نخزّن ولا نعرض state أو أي رمز.
      window.location.assign(r.url);
    } catch (e: any) {
      showToast(e?.message || 'تعذر بدء ربط Google Drive');
      setConnecting(false);
    }
  };

  // إنشاء نسخة احتياطية فعلية: يعرض نتيجة الخادم الفعلية فقط، ثم يُحدّث الحالة
  // ليظهر عدد نقاط الاستعادة والنسخة الحالية الحقيقية.
  const createBackup = async () => {
    if (backingUp) return;
    setBackingUp(true);
    setBackupResult(null);
    try {
      const data = await apiService.createDrBackup();
      const info = resolveDrBackupResult(data);
      setBackupResult(info);
      showToast(info.title);
      await load();
    } catch (e: any) {
      const info = resolveDrBackupResult({ state: e?.state, reason: e?.reason, message: e?.message });
      setBackupResult(info);
      showToast(info.title);
    } finally {
      setBackingUp(false);
    }
  };

  const quota = snapshot?.quota || health?.quota || {};
  const designBytes = quota.designBytes ?? 0;
  const usageBytes = quota.usageBytes ?? null;
  const usagePct = designBytes > 0 && Number.isFinite(usageBytes) ? Math.min(100, Math.round((Number(usageBytes) / designBytes) * 100)) : 0;

  // مزامنة CURRENT الفعلية (ملفات فردية ببنية المجلدات).
  const syncCurrent = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const data = await apiService.syncDrCurrent();
      const title = data?.state === 'no_change' ? 'CURRENT محدّثة مسبقاً (لا تغيير)' : 'تمت مزامنة CURRENT';
      showToast(`${title} • ${data?.fileCount ?? 0} ملف`);
      await load();
    } catch (e: any) {
      showToast(e?.message || 'تعذّرت مزامنة CURRENT');
    } finally {
      setSyncing(false);
    }
  };

  // اختبار الاستعادة المعزول — لا يلمس الإنتاج.
  const runDrill = async (point?: string) => {
    if (drilling) return;
    setDrilling(true);
    setDrillReport(null);
    try {
      const data = await apiService.drillDrRestore(point || selectedPoint || undefined);
      setDrillReport(data?.report ?? null);
      showToast(data?.report?.ok ? 'نجح اختبار الاستعادة المعزول' : 'فشل اختبار الاستعادة — راجع التفاصيل');
    } catch (e: any) {
      setDrillReport({ ok: false, state: 'error', problems: [e?.code || 'request_failed'], message: e?.message });
      showToast(e?.message || 'تعذّر تنفيذ اختبار الاستعادة');
    } finally {
      setDrilling(false);
    }
  };

  const loadPlan = async (point: string) => {
    setSelectedPoint(point);
    setRestorePlan(null);
    try {
      const data = await apiService.getDrRestorePlan(point);
      setRestorePlan(data?.plan ?? null);
    } catch (e: any) {
      showToast(e?.message || 'تعذّر بناء خطة الاستعادة');
    }
  };

  // استعادة الإنتاج: تتطلّب تأكيداً صريحاً، وتُعلن حدود الأتمتة بصدق.
  const requestProductionRestore = async (point: string) => {
    const confirmed = window.confirm(`استعادة الإنتاج من ${point}؟\n\nتنبيه: الاستعادة الإنتاجية تتطلّب خطوات خارجية (إعادة نشر Render + متغيّرات البيئة) ولا تُكتب فوق الإنتاج تلقائياً.`);
    if (!confirmed) return;
    try {
      const data = await apiService.requestProductionRestore(point);
      showToast(data?.message || 'راجع خطوات الاستعادة الموثّقة');
      setRestorePlan({ ...(restorePlan || {}), productionSteps: data?.steps || [] });
    } catch (e: any) {
      // 501 = حدود أتمتة معلنة بصدق، لا فشل.
      if (e?.status === 501 && Array.isArray(e?.steps)) {
        setRestorePlan({ ...(restorePlan || {}), productionSteps: e.steps, productionExternal: true });
        showToast(e?.message || 'الاستعادة الإنتاجية تتطلّب خطوات خارجية موثّقة');
      } else {
        showToast(e?.message || 'تعذّر بدء الاستعادة الإنتاجية');
      }
    }
  };

  const cards: Array<[string, string, any]> = [
    ['حالة Google Drive', DR_STATE_LABELS[stateKey] || stateKey, HardDrive],
    ['آخر مزامنة', fmtTime(snapshot?.lastSyncAt), Clock],
    ['النسخة الحالية', snapshot?.treeHash ? String(snapshot.treeHash).slice(0, 12) : 'لا توجد', History],
    ['نقاط الاستعادة', String(snapshot?.restorePointCount ?? 0), ShieldCheck],
  ];

  return (
    <div className="space-y-6">
      <div className="p-6 rounded-2xl bg-gradient-to-l from-slate-900 to-sky-950/50 border border-sky-500/20 flex flex-col md:flex-row justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2"><CloudUpload className="w-5 h-5 text-sky-400" /> النسخ السحابي والاستعادة</h2>
          <p className="text-xs text-slate-400 mt-1">حالة ربط Google Drive، النسخة الحالية، نقاط الاستعادة، ونسخة قاعدة البيانات المشفّرة. يمكنك إنشاء نسخة احتياطية فعلية بعد الربط.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {authorized && (
            <button onClick={() => void createBackup()} disabled={backingUp} className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-xs font-black flex items-center gap-2 disabled:opacity-60">
              {backingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />} {backingUp ? 'جارٍ إنشاء النسخة…' : 'إنشاء Recovery Point'}
            </button>
          )}
          {authorized && (
            <button onClick={() => void syncCurrent()} disabled={syncing} className="px-4 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-black flex items-center gap-2 disabled:opacity-60">
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {syncing ? 'جارٍ المزامنة…' : 'مزامنة الآن'}
            </button>
          )}
          {authorized && (
            <button onClick={() => void runDrill()} disabled={drilling} className="px-4 py-2 rounded-xl bg-violet-500 text-slate-950 text-xs font-black flex items-center gap-2 disabled:opacity-60">
              {drilling ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} {drilling ? 'جارٍ الاختبار…' : 'اختبار الاستعادة'}
            </button>
          )}
          <button onClick={() => void load()} disabled={loading} className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-white flex items-center gap-2 disabled:opacity-60">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'جارٍ التحديث…' : 'تحديث الحالة'}
          </button>
          {!authorized && configured && (
            <button onClick={() => void connectDrive()} disabled={connecting} className="px-4 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-black flex items-center gap-2 disabled:opacity-60">
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />} ربط Google Drive
            </button>
          )}
        </div>
      </div>

      {backupResult && (
        <section className={`p-4 rounded-2xl border flex items-start gap-2 ${backupResult.ok ? 'bg-emerald-500/10 border-emerald-500/30' : (backupResult.outcome === 'blocked' ? 'bg-sky-500/10 border-sky-500/30' : 'bg-rose-500/10 border-rose-500/30')}`}>
          {backupResult.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> : <TriangleAlert className={`w-4 h-4 mt-0.5 shrink-0 ${backupResult.outcome === 'blocked' ? 'text-sky-400' : 'text-rose-400'}`} />}
          <div>
            <p className={`text-xs font-bold ${backupResult.ok ? 'text-emerald-200' : (backupResult.outcome === 'blocked' ? 'text-sky-200' : 'text-rose-200')}`}>{backupResult.title}</p>
            <p className="text-[10px] text-slate-400 mt-1">{backupResult.detail}</p>
          </div>
        </section>
      )}

      {statusError && (
        <section className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2">
            <TriangleAlert className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-bold text-amber-200">{statusError.message}</p>
              <p className="text-[10px] text-amber-200/70 mt-1">
                {snapshot
                  ? `آخر حالة معروفة معروضة أدناه${lastUpdatedAt ? ` (آخر تحديث ناجح: ${fmtTime(lastUpdatedAt)})` : ''}.`
                  : 'لم تُجلب أي حالة من الخادم بعد.'}
              </p>
            </div>
          </div>
          <button onClick={() => void load()} disabled={loading} className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-[11px] font-bold text-amber-100 disabled:opacity-60 shrink-0">إعادة المحاولة</button>
        </section>
      )}

      {/* حالة الإعداد / الربط */}
      <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            {authorized ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <TriangleAlert className="w-4 h-4 text-amber-400" />}
            <span className="text-sm font-bold text-white">{authorized ? 'Google Drive مربوط' : 'Google Drive غير مربوط'}</span>
          </div>
          <span className={`px-3 py-1 rounded-full text-[10px] font-black ${authorized ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
            {DR_STATE_LABELS[stateKey] || stateKey}
          </span>
        </div>
        <div className="grid md:grid-cols-2 gap-2 mt-4 text-xs">
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">إعدادات OAuth</span><span className={configured ? 'text-emerald-400' : 'text-amber-400'}>{configured ? 'مكتملة' : 'ناقصة'}</span></div>
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">رمز التجديد محفوظ</span><span className={health?.refreshTokenStored ? 'text-emerald-400' : 'text-slate-300'}>{health?.refreshTokenStored ? 'نعم (مشفّر)' : 'لا'}</span></div>
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">النطاق</span><span className="text-slate-300 font-mono text-[10px] truncate max-w-[55%]" title={health?.scope}>{health?.scope || '—'}</span></div>
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">عنوان العودة</span><span className="text-slate-300 font-mono text-[10px] truncate max-w-[55%]" title={health?.redirectUri}>{health?.redirectUri || '—'}</span></div>
        </div>
        {!configured && (
          <p className="text-[11px] text-amber-300/90 mt-3 leading-relaxed">يلزم ضبط اعتماد OAuth على الخادم (DRIVE_OAUTH_CLIENT_ID / DRIVE_OAUTH_CLIENT_SECRET) قبل الربط. لا يُعرض أي سر هنا.</p>
        )}
      </section>

      {/* بطاقات الحالة */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(([label, value, Icon]) => (
          <div key={label} className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
            <Icon className="w-5 h-5 text-sky-400 mb-3" />
            <p className="text-xs text-slate-400">{label}</p>
            <p className="text-sm font-black text-white mt-1 font-mono truncate">{value}</p>
          </div>
        ))}
      </div>

      {/* نقاط الاستعادة الكاملة (recovery points) */}
      <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
        <h3 className="font-bold text-white flex items-center gap-2 mb-4"><History className="w-4 h-4 text-sky-400" /> نقاط الاستعادة الكاملة</h3>
        {recoveryPoints.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 text-right">
                  <th className="py-2 px-2 font-bold">المعرّف</th>
                  <th className="py-2 px-2 font-bold">الالتزام</th>
                  <th className="py-2 px-2 font-bold">التاريخ</th>
                  <th className="py-2 px-2 font-bold">ملفات</th>
                  <th className="py-2 px-2 font-bold">DB مشفّرة</th>
                  <th className="py-2 px-2 font-bold">أسرار مشفّرة</th>
                  <th className="py-2 px-2 font-bold">التحقق</th>
                  <th className="py-2 px-2 font-bold">استعادة</th>
                </tr>
              </thead>
              <tbody>
                {recoveryPoints.map((h: any) => (
                  <tr key={h.id} className={`border-t border-slate-800 text-slate-300 ${selectedPoint === h.id ? 'bg-violet-500/10' : ''}`}>
                    <td className="py-2 px-2 font-mono">{h.id}</td>
                    <td className="py-2 px-2 font-mono text-[10px]">{h.commit ? String(h.commit).slice(0, 10) : '—'}</td>
                    <td className="py-2 px-2">{fmtTime(h.createdAt)}</td>
                    <td className="py-2 px-2">{h.fileCount ?? '—'}</td>
                    <td className="py-2 px-2">{h.database?.hash ? <span className="text-emerald-400">نعم</span> : <span className="text-amber-400">لا</span>}</td>
                    <td className="py-2 px-2">{h.secrets?.hash ? <span className="text-emerald-400">نعم ({h.secrets.count ?? '—'})</span> : <span className="text-amber-400">لا</span>}</td>
                    <td className="py-2 px-2">{h.status === 'verified' ? <span className="text-emerald-400">مكتملة</span> : <span className="text-amber-400">ناقصة</span>}</td>
                    <td className="py-2 px-2">
                      <div className="flex gap-1">
                        <button onClick={() => void loadPlan(h.id)} className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-[10px] font-bold text-white">خطة</button>
                        <button onClick={() => void runDrill(h.id)} disabled={drilling} className="px-2 py-1 rounded bg-violet-500/20 border border-violet-500/40 text-[10px] font-bold text-violet-100 disabled:opacity-60">اختبار</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : Array.isArray(snapshot?.history) && snapshot.history.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 text-right">
                  <th className="py-2 px-2 font-bold">المعرّف</th>
                  <th className="py-2 px-2 font-bold">الالتزام</th>
                  <th className="py-2 px-2 font-bold">التاريخ</th>
                  <th className="py-2 px-2 font-bold">عدد الملفات</th>
                  <th className="py-2 px-2 font-bold">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.history.map((h: any) => (
                  <tr key={h.id} className="border-t border-slate-800 text-slate-300">
                    <td className="py-2 px-2 font-mono">{h.id}</td>
                    <td className="py-2 px-2 font-mono text-[10px]">{h.commit ? String(h.commit).slice(0, 10) : '—'}</td>
                    <td className="py-2 px-2">{fmtTime(h.createdAt)}</td>
                    <td className="py-2 px-2">{h.fileCount ?? '—'}</td>
                    <td className="py-2 px-2">{h.hasManifest ? <span className="text-emerald-400">مكتملة</span> : <span className="text-amber-400">ناقصة</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-slate-500">لا توجد نقاط استعادة بعد. اضغط «إنشاء Recovery Point» لإنشاء أول نقطة حقيقية كاملة (مصدر + قاعدة بيانات مشفّرة + أسرار مشفّرة).</p>
        )}
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* قاعدة البيانات + الالتزام */}
        <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
          <h3 className="font-bold text-white flex items-center gap-2 mb-4"><Database className="w-4 h-4 text-cyan-400" /> قاعدة البيانات والالتزام</h3>
          <div className="space-y-2 text-xs">
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">نسخة DB مشفّرة</span><span className={snapshot?.dbEncrypted ? 'text-emerald-400' : 'text-amber-400'}>{snapshot?.dbEncrypted ? 'نعم' : 'لا'}</span></div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">آخر نسخة DB</span><span className="text-slate-300">{fmtTime(snapshot?.lastDbBackupAt)}</span></div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">الالتزام الحالي</span><span className="text-slate-300 font-mono text-[10px] truncate max-w-[55%]" title={snapshot?.commit}>{snapshot?.commit || '—'}</span></div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">عدد الملفات</span><span className="text-slate-300">{snapshot?.fileCount ?? '—'}</span></div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">حجم النسخة</span><span className="text-slate-300">{fmtBytes(snapshot?.versionSizeBytes)}</span></div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">سلامة النسخة الحالية</span><span className={snapshot?.currentIntegrity?.verified ? 'text-emerald-400' : 'text-amber-400'}>{snapshot?.currentIntegrity?.verified ? 'سليمة' : (snapshot?.currentIntegrity?.detail || 'غير مؤكدة')}</span></div>
          </div>
        </section>

        {/* المساحة */}
        <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
          <h3 className="font-bold text-white flex items-center gap-2 mb-4"><Gauge className="w-4 h-4 text-emerald-400" /> المساحة</h3>
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex justify-between text-xs mb-2">
              <span className="text-slate-400">المستخدم</span>
              <span className="text-white font-bold">{fmtBytes(usageBytes)}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div className={`h-full ${usagePct > 90 ? 'bg-rose-500' : 'bg-sky-500'}`} style={{ width: `${usagePct}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 mt-2">
              <span>الحد التصميمي: {fmtBytes(designBytes)}</span>
              <span>{usagePct}%</span>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 mt-3 leading-relaxed">الحد التصميمي 15 GiB مع هامش أمان 512 MiB. لا شراء ولا تجاوز تلقائي.</p>
        </section>
      </div>

      {/* آخر خطأ */}
      <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
        <h3 className="font-bold text-white flex items-center gap-2 mb-3"><TriangleAlert className="w-4 h-4 text-amber-400" /> آخر خطأ</h3>
        {snapshot?.lastError
          ? <p className="text-xs text-rose-300 font-mono break-all">{String(snapshot.lastError)}</p>
          : <p className="text-xs text-slate-500">لا يوجد خطأ مسجّل.</p>}
      </section>

      {/* CURRENT — مرآة الملفات الفعلية + حزمة الأسرار */}
      <div className="grid lg:grid-cols-2 gap-6">
        <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
          <h3 className="font-bold text-white flex items-center gap-2 mb-4"><HardDrive className="w-4 h-4 text-sky-400" /> CURRENT — مرآة الملفات الفعلية</h3>
          <div className="space-y-2 text-xs">
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">حالة المزامنة</span><span className={mirror?.treeHash ? 'text-emerald-400' : 'text-slate-300'}>{mirror?.treeHash ? 'مُزامَنة' : 'لا مرآة بعد'}</span></div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">عدد الملفات</span><span className="text-slate-300">{currentState?.fileCount ?? (Array.isArray(mirror?.files) ? mirror.files.length : '—')}</span></div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">حجم المرآة</span><span className="text-slate-300">{fmtBytes(currentState?.sizeBytes)}</span></div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">بصمة الشجرة (treeHash)</span><span className="text-slate-300 font-mono text-[10px]">{mirror?.treeHash ? String(mirror.treeHash).slice(0, 16) : '—'}</span></div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">آخر مزامنة</span><span className="text-slate-300">{fmtTime(mirror?.updatedAt || currentState?.updatedAt)}</span></div>
          </div>
        </section>

        <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
          <h3 className="font-bold text-white flex items-center gap-2 mb-4"><ShieldCheck className="w-4 h-4 text-emerald-400" /> الأسرار المشفّرة</h3>
          <div className="space-y-2 text-xs">
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">مفتاح الاستعادة الرئيسي</span><span className={secretsStatus?.masterKey?.state === 'valid' ? 'text-emerald-400' : 'text-amber-400'}>{secretsStatus?.masterKey?.state === 'valid' ? 'صالح' : (secretsStatus?.masterKey?.state === 'invalid' ? 'مضبوط لكن غير صالح' : 'غير مضبوط')}</span></div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">حزمة secrets.enc</span><span className={secretsStatus?.package?.present ? 'text-emerald-400' : 'text-amber-400'}>{secretsStatus?.package?.present ? 'موجودة (مشفّرة)' : 'لا توجد'}</span></div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">عدد الأسرار المحفوظة</span><span className="text-slate-300">{secretsStatus?.package?.count ?? '—'}</span></div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">قابلة للفكّ بالمفتاح الحالي</span><span className={secretsStatus?.canDecrypt ? 'text-emerald-400' : 'text-amber-400'}>{secretsStatus?.canDecrypt ? 'نعم' : 'لا'}</span></div>
          </div>
          <p className="text-[10px] text-slate-500 mt-3 leading-relaxed">لا تُعرض أي قيمة سرّية: أسماء وحالات وبصمات فقط. الحزمة تُشفَّر AES-256-GCM قبل الرفع.</p>
        </section>
      </div>

      {/* خطة الاستعادة + اختبار الاستعادة */}
      {restorePlan && (
        <section className="p-5 rounded-2xl bg-slate-900 border border-violet-500/30">
          <h3 className="font-bold text-white flex items-center gap-2 mb-4"><ShieldCheck className="w-4 h-4 text-violet-400" /> خطة الاستعادة — {restorePlan.recoveryPointId}</h3>
          <div className="grid md:grid-cols-3 gap-2 text-xs mb-3">
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">التحقق</span><span className={restorePlan.verification?.ok ? 'text-emerald-400' : 'text-rose-400'}>{restorePlan.verification?.ok ? 'سليم' : 'فشل'}</span></div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">قاعدة البيانات</span><span className={restorePlan.database?.present ? 'text-emerald-400' : 'text-amber-400'}>{restorePlan.database?.present ? 'مشفّرة ومتاحة' : 'غير متاحة'}</span></div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex justify-between"><span className="text-slate-400">الأسرار</span><span className={restorePlan.secrets?.present ? 'text-emerald-400' : 'text-amber-400'}>{restorePlan.secrets?.present ? 'مشفّرة ومتاحة' : 'غير متاحة'}</span></div>
          </div>
          {Array.isArray(restorePlan.verification?.problems) && restorePlan.verification.problems.length > 0 && (
            <p className="text-[10px] text-rose-300 mb-2">مشكلات: {restorePlan.verification.problems.join('، ')}</p>
          )}
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => void runDrill(restorePlan.recoveryPointId)} disabled={drilling} className="px-3 py-1.5 rounded-lg bg-violet-500 text-slate-950 text-[11px] font-black disabled:opacity-60">اختبار معزول</button>
            <button onClick={() => void requestProductionRestore(restorePlan.recoveryPointId)} className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-[11px] font-bold text-amber-100">استعادة الإنتاج (تأكيد مطلوب)</button>
          </div>
          {Array.isArray(restorePlan.productionSteps) && restorePlan.productionSteps.length > 0 && (
            <ol className="mt-3 space-y-1 text-[11px] text-slate-300 list-decimal list-inside">
              {restorePlan.productionSteps.map((s: string, i: number) => <li key={i}>{s}</li>)}
            </ol>
          )}
        </section>
      )}

      {/* تقرير اختبار الاستعادة */}
      {drillReport && (
        <section className={`p-5 rounded-2xl border ${drillReport.ok ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'}`}>
          <h3 className="font-bold text-white flex items-center gap-2 mb-3">
            {drillReport.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <TriangleAlert className="w-4 h-4 text-rose-400" />}
            تقرير اختبار الاستعادة المعزول — {drillReport.ok ? 'نجح' : 'فشل'}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            {Object.entries(drillReport.checks || {}).map(([k, v]) => (
              <div key={k} className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 flex justify-between gap-2">
                <span className="text-slate-400 truncate" title={k}>{k}</span>
                <span className={v ? 'text-emerald-400' : 'text-rose-400'}>{v ? 'PASS' : 'FAIL'}</span>
              </div>
            ))}
          </div>
          {Array.isArray(drillReport.problems) && drillReport.problems.length > 0 && (
            <p className="text-[10px] text-rose-300 mt-2">مشكلات: {drillReport.problems.join('، ')}</p>
          )}
          <p className="text-[10px] text-slate-400 mt-2">استُخدمت قاعدة معزولة: {drillReport.isolatedDatabaseUsed ? 'نعم' : 'لا (اختبار مصدر/أسرار/DB دون كتابة قاعدة)'} • لم تُكتب أي بيانات إلى الإنتاج: {drillReport.wroteToProduction ? 'لا' : 'مؤكّد'}.</p>
        </section>
      )}

      <p className="text-[10px] text-slate-500 text-center">لا تُعرض هنا أي أسرار: لا state ولا authorization code ولا refresh token. رمز التجديد يبقى مشفّراً على الخادم فقط.</p>
    </div>
  );
};
