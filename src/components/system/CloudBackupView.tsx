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

export const CloudBackupView: React.FC = () => {
  const { currentUser, showToast } = useApp();
  const [health, setHealth] = useState<any>(null);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, s] = await Promise.all([
        apiService.getDrHealth().catch(() => null),
        apiService.getDrStatus().catch(() => null),
      ]);
      setHealth(h?.dr || null);
      setSnapshot(s?.snapshot || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // الحماية الحقيقية على الخادم (requireOwner)؛ هنا إخفاء الصفحة عن غير المالك.
  if (currentUser?.role !== 'owner') {
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

  const quota = snapshot?.quota || health?.quota || {};
  const designBytes = quota.designBytes ?? 0;
  const usageBytes = quota.usageBytes ?? null;
  const usagePct = designBytes > 0 && Number.isFinite(usageBytes) ? Math.min(100, Math.round((Number(usageBytes) / designBytes) * 100)) : 0;

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
          <p className="text-xs text-slate-400 mt-1">حالة ربط Google Drive، النسخة الحالية، نقاط الاستعادة، ونسخة قاعدة البيانات المشفّرة. عرض وربط فقط — لا رفع ولا استعادة في هذه المرحلة.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} disabled={loading} className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-white flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> تحديث الحالة
          </button>
          {!authorized && configured && (
            <button onClick={() => void connectDrive()} disabled={connecting} className="px-4 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-black flex items-center gap-2 disabled:opacity-60">
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />} ربط Google Drive
            </button>
          )}
        </div>
      </div>

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

      <p className="text-[10px] text-slate-500 text-center">لا تُعرض هنا أي أسرار: لا state ولا authorization code ولا refresh token. رمز التجديد يبقى مشفّراً على الخادم فقط.</p>
    </div>
  );
};
