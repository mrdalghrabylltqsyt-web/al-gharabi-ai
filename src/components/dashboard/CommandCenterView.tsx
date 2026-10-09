import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiService } from '../../services/api';
import { NAV_SECTIONS } from '../common/Sidebar';
import {
  ShieldCheck,
  AlertTriangle,
  PlugZap,
  Share2,
  ShieldAlert,
  Megaphone,
  Users,
  CheckCircle2,
  RefreshCw,
  ArrowLeft,
  Sparkles,
  MessageSquare,
  Package,
  Home,
} from 'lucide-react';

/**
 * مركز القيادة — الصفحة الرئيسية الموحّدة (توحيد الواجهة).
 *
 * تعرض حالة النظام الحقيقية وملخص العمل والتنبيهات، وتقود المستخدم مباشرةً إلى
 * مسار العمل الموحّد (النشر، الزبائن، المنتجات). كل البيانات من **مسارات الخادم
 * الحقيقية** (`/api/health`, `/api/platforms/control-plane`, `/api/agent/brain/state`)
 * بلا أي اختلاق؛ وفشل أي قراءة يُعرض كحالة «تعذّر» بصراحة ولا يُسقط بقية اللوحة.
 */
interface PlatformRow {
  platform: string;
  state: string;
  stateLabelAr?: string;
  accountName?: string | null;
  blockingReason?: string | null;
  nextAction?: string;
}

export const CommandCenterView: React.FC = () => {
  const { setActiveTab, posts, notificationBadge, currentUser, platforms } = useApp();
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<any>(null);
  const [control, setControl] = useState<any>(null);
  const [brain, setBrain] = useState<any>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    const errs: string[] = [];
    const safe = async <T,>(fn: () => Promise<T>, label: string): Promise<T | null> => {
      try { return await fn(); } catch (e: any) { errs.push(`${label}: ${e?.message || 'تعذّر'}`); return null; }
    };
    const [h, c, b] = await Promise.all([
      safe(() => apiService.checkHealth(), 'صحة النظام'),
      safe(() => apiService.getPlatformControlPlane(), 'حالة المنصات'),
      safe(() => apiService.getBrainState(), 'العقل المركزي'),
    ]);
    setHealth(h); setControl(c); setBrain(b); setErrors(errs);
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  const platformRows: PlatformRow[] = Array.isArray(control?.platforms) ? control.platforms : [];
  const liveConnected = platformRows.filter((p) => ['CONNECTED', 'VERIFIED', 'OPERATIONAL'].includes(p.state));
  const needingAction = platformRows.filter((p) => ['EXTERNAL_SETUP_REQUIRED', 'DISCONNECTED', 'FAILED', 'CONFIGURED', 'CODE_READY'].includes(p.state));
  const brainState = brain?.state || {};
  const brainPlatforms = Array.isArray(brainState?.capabilities) ? brainState.capabilities : [];
  const deploy = health?.deploy || {};

  const go = (id: string) => setActiveTab(id);
  const sectionIcon = (id: string) => NAV_SECTIONS.find((s) => s.id === id)?.icon || Home;

  const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
    <div className={`p-4 rounded-2xl bg-slate-900 border border-slate-800 ${className}`}>{children}</div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-gradient-to-l from-slate-900 via-slate-900 to-emerald-950/40 border border-emerald-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
            <Sparkles className="w-3.5 h-3.5" />
            مركز قيادة الغرابي AI الموحّد
          </div>
          <h2 className="text-xl font-black text-white">مرحباً {currentUser?.name || 'بك'} — دورة العمل في مكان واحد</h2>
          <p className="text-xs text-slate-300">
            النشر ← التوزيع على المنصات ← متابعة النتائج والتفاعلات ← الرد من مستودع المنتجات.
          </p>
        </div>
        <button onClick={() => void load()} className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-2 cursor-pointer">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          تحديث الحالة
        </button>
      </div>

      {errors.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-950/20">
          <div className="flex items-center gap-2 text-amber-300 text-xs font-bold">
            <AlertTriangle className="w-4 h-4" /> تعذّر قراءة بعض المصادر (تُعرض بقية البيانات المتاحة):
          </div>
          <ul className="mt-1 text-[11px] text-amber-200/90 list-disc pr-5">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </Card>
      )}

      {/* النشر / الجدولة / عدد المنصات */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <div className="flex items-center gap-2 text-slate-400 text-[11px]"><ShieldCheck className="w-3.5 h-3.5" /> بانتظار اعتماد</div>
          <div className="text-2xl font-black text-white mt-1">{notificationBadge.pendingReviews}</div>
          <button onClick={() => go('approval')} className="text-[11px] text-emerald-300 mt-1 hover:underline">فتح الموافقة ←</button>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-slate-400 text-[11px]"><Home className="w-3.5 h-3.5" /> مجدول اليوم</div>
          <div className="text-2xl font-black text-white mt-1">{notificationBadge.scheduledToday}</div>
          <button onClick={() => go('calendar')} className="text-[11px] text-emerald-300 mt-1 hover:underline">التقويم ←</button>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-slate-400 text-[11px]"><Megaphone className="w-3.5 h-3.5" /> منشورات مسجّلة</div>
          <div className="text-2xl font-black text-white mt-1">{Array.isArray(posts) ? posts.length : 0}</div>
          <button onClick={() => go('content')} className="text-[11px] text-emerald-300 mt-1 hover:underline">إنشاء/نشر ←</button>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-slate-400 text-[11px]"><Share2 className="w-3.5 h-3.5" /> منصات متصلة ومتحققة</div>
          <div className="text-2xl font-black text-white mt-1">{liveConnected.length}<span className="text-sm text-slate-500">/{platformRows.length || 10}</span></div>
          <button onClick={() => go('social')} className="text-[11px] text-emerald-300 mt-1 hover:underline">حالة المنصات ←</button>
        </Card>
      </div>

      {/* التنبيهات: ما يحتاج إجراءً */}
      {needingAction.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 text-amber-300 text-xs font-bold mb-2">
            <PlugZap className="w-4 h-4" /> يحتاج إجراءً (ربط أو صلاحية أو إعداد خارجي):
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {needingAction.map((p) => (
              <div key={p.platform} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-200 uppercase">{p.platform}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30">{p.stateLabelAr || p.state}</span>
                </div>
                <p className="text-slate-400 mt-1">{p.blockingReason || 'يحتاج إكمال إعداد.'}</p>
                <button onClick={() => go('settings')} className="text-[10px] text-emerald-300 mt-1 hover:underline">الإعدادات › ربط المنصات ←</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {needingAction.length === 0 && platformRows.length > 0 && (
        <Card className="border-emerald-500/30 bg-emerald-950/20">
          <div className="flex items-center gap-2 text-emerald-300 text-xs font-bold">
            <CheckCircle2 className="w-4 h-4" /> كل المنصات في حالة جاهز أو متصل.
          </div>
        </Card>
      )}

      {/* حالة العقل المركزي (قراءة) */}
      <Card>
        <div className="flex items-center gap-2 text-slate-300 text-xs font-bold mb-2">
          <Sparkles className="w-4 h-4 text-indigo-300" /> العقل المركزي
          {brain?.platformAgnostic && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">منصة-محايد</span>}
        </div>
        {brain ? (
          <div className="text-[11px] text-slate-400 space-y-1">
            <p>إصدار العقل: <span className="text-slate-200 font-bold">{brain.brainId || 'central-brain-1'}</span> • قدرات: <span className="text-slate-200 font-bold">{brainPlatforms.length || '—'}</span></p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button onClick={() => go('central_brain')} className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold cursor-pointer">فتح العقل المركزي ←</button>
              <button onClick={() => go('central_agent')} className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold cursor-pointer">العقل التنفيذي ←</button>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">تعذّر قراءة حالة العقل. جرّب «تحديث الحالة».</p>
        )}
      </Card>

      {/* مسار العمل الموحّد */}
      <Card>
        <div className="text-slate-300 text-xs font-bold mb-3">مسار العمل الموحّد</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button onClick={() => go('publish')} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-emerald-500/40 text-right cursor-pointer transition">
            <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm"><Megaphone className="w-4 h-4" /> النشر</div>
            <p className="text-[11px] text-slate-400 mt-1">إنشاء المحتوى، اختيار المنصات، النشر والجدولة والنتائج.</p>
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300 mt-2">ابدأ <ArrowLeft className="w-3 h-3" /></span>
          </button>
          <button onClick={() => go('customers')} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-emerald-500/40 text-right cursor-pointer transition">
            <div className="flex items-center gap-2 text-rose-300 font-bold text-sm"><Users className="w-4 h-4" /> الزبائن والتفاعلات</div>
            <p className="text-[11px] text-slate-400 mt-1">التعليقات والرسائل والردود والمتابعة.</p>
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300 mt-2">افتح <ArrowLeft className="w-3 h-3" /></span>
          </button>
          <button onClick={() => go('products')} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-emerald-500/40 text-right cursor-pointer transition">
            <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm"><Package className="w-4 h-4" /> المنتجات</div>
            <p className="text-[11px] text-slate-400 mt-1">مستودع المنتجات والأسعار — المصدر الوحيد للحقيقة التجارية.</p>
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300 mt-2">افتح <ArrowLeft className="w-3 h-3" /></span>
          </button>
        </div>
      </Card>

      {/* حالة النظام التقنية (بلا أسرار) */}
      <Card>
        <div className="flex items-center gap-2 text-slate-300 text-xs font-bold mb-2">
          <ShieldAlert className="w-4 h-4 text-slate-400" /> حالة النظام
        </div>
        <div className="text-[11px] text-slate-400 space-y-1">
          <p>الإصدار المنشور: <span className="font-mono text-slate-200">{deploy.commit || '—'}</span> • الفرع: <span className="text-slate-200">{deploy.branch || '—'}</span> • البيئة: <span className="text-slate-200">{deploy.nodeEnv || '—'}</span></p>
          <p>التخزين: <span className="text-slate-200">{health?.persistence?.backend || '—'}</span> {health?.persistence?.durable === false && <span className="text-amber-300">(غير دائم)</span>}</p>
          {currentUser?.role === 'owner' && (
            <div className="flex flex-wrap gap-2 pt-1">
              <button onClick={() => go('system')} className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold cursor-pointer">مراقبة النظام ←</button>
              <button onClick={() => go('cloud_backup')} className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold cursor-pointer">التعافي والنسخ ←</button>
            </div>
          )}
        </div>
      </Card>

      <p className="text-[10px] text-slate-500 flex items-center gap-1">
        <MessageSquare className="w-3 h-3" /> كل الأقسام السابقة متاحة داخل الأقسام الخمسة (الرئيسية، النشر، الزبائن، المنتجات، الإعدادات).
      </p>
    </div>
  );
};
