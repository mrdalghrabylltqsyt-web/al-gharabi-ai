import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  BarChart3,
  TrendingUp,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Users,
  Package,
  BadgePercent,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

export const AnalyticsView: React.FC = () => {
  const { platforms } = useApp();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => { setLoading(true); try { const d = await (await import('../../services/api')).apiService.getAnalyticsOverview(); setData(d); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const posts = data?.posts; const conversations = data?.conversations; const metrics = data?.metrics || {};
  const connectedPlatformsCount = data?.channels?.filter((x:any) => x.connected).length || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-400" />
            تحليلات الأداء ومقارنة المنصات
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            رصد معدلات الوصول الحقيقية، نمو المتابعين، وتتبع تحويل الاستفسارات إلى عقود تقسيط فعلية.
          </p>
        </div>

        <div className="text-xs text-slate-300 bg-slate-950 px-4 py-2 rounded-xl border border-slate-800">
          الحالة: <span className="text-emerald-400 font-bold">بيانات مساحة العمل</span>
        </div><button onClick={() => void load()} disabled={loading} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-white flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> تحديث</button>
      </div>

      <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-500/20 text-xs text-amber-200">لا يتم عرض متابعين أو مشاهدات خارجية كأرقام حية ما لم توجد منصة موصولة فعلياً. الأرقام أدناه مبنية فقط على البيانات المحفوظة داخل النظام.</div>

      {/* Main KPI Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
          <span className="text-xs text-slate-400 block font-semibold">إجمالي المتابعين الموثقين</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-white">
              {(data?.channels || []).reduce((a:any,x:any) => a + 0, 0).toLocaleString()}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">لا توجد بيانات متابعين خارجية محفوظة بعد • {connectedPlatformsCount} منصة متصلة</p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
          <span className="text-xs text-slate-400 block font-semibold">المنشورات والمحتوى</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-emerald-400">
              {posts?.total || 0}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">إجمالي المنشورات المجدولة والمنشورة</p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
          <span className="text-xs text-slate-400 block font-semibold">استفسارات التقسيط الواردة</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-white">
              {conversations?.total || 0}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">محادثة واستفسار عبر القنوات المربوطة</p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
          <span className="text-xs text-slate-400 block font-semibold">عقود التقسيط المكتملة</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-emerald-400">
              {conversations?.resolved || 0}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">محادثات أغلقت في مساحة العمل</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">{[['المشاهدات',metrics.views],['الإعجابات',metrics.likes],['التعليقات',metrics.comments],['المشاركات',metrics.shares],['الوصول',metrics.reach]].map(([label,value])=><div key={label} className="p-4 rounded-2xl bg-slate-900 border border-slate-800"><p className="text-[11px] text-slate-500">{label}</p><p className="text-lg font-black text-white mt-1">{Number(value||0).toLocaleString()}</p></div>)}</div>

      {/* Platform Comparison Table */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <h3 className="font-bold text-sm text-white flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          أداء المنصات الاجتماعية وقنوات التواصل المربوطة
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="pb-3 font-semibold">المنصة</th>
                <th className="pb-3 font-semibold">المعرّف / الحساب</th>
                <th className="pb-3 font-semibold">حالة الاتصال</th>
                <th className="pb-3 font-semibold">المتابعون</th>
                <th className="pb-3 font-semibold">معدل التفاعل</th>
                <th className="pb-3 font-semibold">عدد المنشورات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {(data?.channels || platforms.map((p:any)=>({platform:p.id,name:p.name,connected:p.status==='connected',posts:p.postsCount||0,conversations:p.unreadMessages||0}))).map((p:any) => (
                <tr key={p.platform || p.id} className="hover:bg-slate-950/40 transition">
                  <td className="py-3.5 font-bold text-white flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        p.connected ? 'bg-emerald-400' : 'bg-slate-600'
                      }`}
                    />
                    {p.name}
                  </td>
                  <td className="py-3.5 text-slate-400 font-mono text-[11px]">
                    {p.connected ? 'اتصال فعلي مسجل' : 'لم يُربط بعد'}
                  </td>
                  <td className="py-3.5">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${
                        p.connected
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {p.connected ? 'متصل' : 'غير متصل'}
                    </span>
                  </td>
                  <td className="py-3.5 text-slate-300 font-mono">
                    —
                  </td>
                  <td className="py-3.5 text-emerald-400 font-mono font-bold">
                    —
                  </td>
                  <td className="py-3.5 text-slate-300 font-mono">{p.posts || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
