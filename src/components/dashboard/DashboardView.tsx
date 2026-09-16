import React from 'react';
import { useApp } from '../../context/AppContext';
import {
  Sparkles,
  TrendingUp,
  Users,
  MessageSquare,
  ShieldCheck,
  CheckCircle,
  Clock,
  Package,
  BadgePercent,
  Calendar,
  AlertTriangle,
  ArrowUpRight,
  Share2,
  ChevronLeft,
} from 'lucide-react';

export const DashboardView: React.FC = () => {
  const {
    platforms,
    posts,
    conversations,
    products,
    setActiveTab,
    updatePostStatus,
    currentUser,
    notificationBadge,
  } = useApp();

  const totalFollowers = platforms.reduce((acc, p) => acc + p.followers, 0);
  const pendingPosts = posts.filter((p) => p.status === 'review');
  const publishedPosts = posts.filter((p) => p.status === 'published');
  const scheduledPosts = posts.filter((p) => p.status === 'scheduled');
  const highUrgencyMessages = conversations.filter(
    (c) => c.urgency === 'high' && c.status !== 'resolved'
  );

  return (
    <div className="space-y-6">
      {/* Top Welcome Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-l from-slate-900 via-slate-900 to-emerald-950 border border-emerald-500/20 p-6 sm:p-8 shadow-xl">
        <div className="absolute top-0 left-0 -translate-x-12 -translate-y-12 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/90 border border-emerald-500/40 text-emerald-300 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              المركز الذكي الموحد لإدارة المعرض والتسويق
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              أهلاً بك، {currentUser.name} ({currentUser.roleTitleArabic})
            </h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              تحكم كامل في جميع قنوات معرض الغرابي للتقسيط الـ 10، مع مساعد ذكاء اصطناعي
              يقترح أفضل نصوص العروض، ويحلل استفسارات العملاء، ويضمن مراجعة واعتماد أي محتوى قبل نشره.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              onClick={() => setActiveTab('content')}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-5 py-3 rounded-2xl shadow-lg shadow-emerald-500/20 transition active:scale-95 cursor-pointer text-sm"
            >
              <Sparkles className="w-4 h-4" />
              صناعة محتوى ذكي جديد
            </button>
            <button
              onClick={() => setActiveTab('customers')}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold px-4 py-3 rounded-2xl border border-slate-700 transition active:scale-95 cursor-pointer text-sm"
            >
              <MessageSquare className="w-4 h-4 text-emerald-400" />
              رسائل العملاء ({notificationBadge.unreadMessages})
            </button>
          </div>
        </div>
      </div>

      {/* Actionable Alerts Banner (if pending approvals or high urgency messages) */}
      {(pendingPosts.length > 0 || highUrgencyMessages.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pendingPosts.length > 0 && (
            <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/30 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-amber-200">
                    {pendingPosts.length} منشورات بانتظار الاعتماد والموافقة
                  </h4>
                  <p className="text-xs text-amber-300/70">
                    لا يتم النشر على السوشيال ميديا إلا بعد موافقة الإدارة الصريحة.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveTab('approval')}
                className="px-3.5 py-1.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 transition shrink-0 cursor-pointer"
              >
                مراجعة الآن
              </button>
            </div>
          )}

          {highUrgencyMessages.length > 0 && (
            <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-500/30 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-rose-200">
                    {highUrgencyMessages.length} استفسارات عملاء عالية الأهمية
                  </h4>
                  <p className="text-xs text-rose-300/70">
                    عملاء مستعدون للتعاقد أو يطلبون حسبة قسط فورية.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveTab('customers')}
                className="px-3.5 py-1.5 rounded-xl bg-rose-500 text-white text-xs font-bold hover:bg-rose-400 transition shrink-0 cursor-pointer"
              >
                الرد الفوري
              </button>
            </div>
          )}
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {/* Total Followers */}
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">إجمالي المتابعين</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-white">
              {totalFollowers.toLocaleString()}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">عبر المنصات الاجتماعية الرسمية</p>
        </div>

        {/* Customer Inquiries */}
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">استفسارات التقسيط</span>
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
              <MessageSquare className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-white">
              {conversations.length}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">إجمالي المحادثات المسجلة بالنظام</p>
        </div>

        {/* Available Products in Showroom */}
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">منتجات المعرض</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-white">
              {products.length}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">منتجات المعرض المسجلة في النظام</p>
        </div>

        {/* Governance & Published */}
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">حالة النشر والجدولة</span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-white">
              {scheduledPosts.length + publishedPosts.length}
            </span>
            <span className="text-xs text-amber-400 font-medium">
              ({scheduledPosts.length} مجدول)
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {pendingPosts.length} قيد المراجعة والاعتماد
          </p>
        </div>
      </div>

      {/* Social Platforms Snapshot (10 Platforms) */}
      <div className="p-5 sm:p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Share2 className="w-4 h-4 text-emerald-400" />
              منظومة المنصات الاجتماعية لمعرض الغرابي (10 منصات مدعومة)
            </h3>
            <p className="text-xs text-slate-400">
              المنصات مدعومة وجاهزة للربط؛ لا تُعدّ متصلة إلا بعد نجاح الربط الفعلي.
            </p>
          </div>
          <button
            onClick={() => setActiveTab('social')}
            className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 cursor-pointer"
          >
            إدارة المنصات والحسابات
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {platforms.map((p) => (
            <div
              key={p.id}
              onClick={() => setActiveTab('social')}
              className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 transition cursor-pointer group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white group-hover:text-emerald-400 transition">
                  {p.name}
                </span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    p.status === 'connected' ? 'bg-emerald-400' : 'bg-rose-500'
                  }`}
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1 font-mono">{p.handle || 'غير مربوط'}</p>
              <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                <span className="text-slate-400">المتابعون</span>
                <span className="font-bold text-slate-200">
                  {(p.followers || 0).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Two Columns: Content Pipeline & Recent Customer Inquiries */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Right Column (RTL start): Posts Pipeline */}
        <div className="p-5 sm:p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              خط إنتاج المحتوى والموافقات
            </h3>
            <button
              onClick={() => setActiveTab('approval')}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 cursor-pointer"
            >
              شاشة الاعتماد الكاملة
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            {posts.length === 0 ? (
              <div className="p-8 text-center text-slate-500 bg-slate-950/40 rounded-xl border border-slate-800">
                <Clock className="w-8 h-8 mx-auto mb-2 opacity-50 text-slate-600" />
                <p className="text-xs font-semibold text-slate-400">لا توجد منشورات حالياً في خط الإنتاج</p>
                <p className="text-[11px] text-slate-500 mt-0.5">يمكنك إنشاء وجدولة منشورات جديدة من قسم "مركز المحتوى"</p>
              </div>
            ) : (
              posts.slice(0, 4).map((post) => {
                const statusMap: Record<string, { label: string; color: string; icon: any }> = {
                  draft: { label: 'مسودة', color: 'bg-slate-800 text-slate-300 border-slate-700', icon: Clock },
                  review: { label: 'بانتظار المراجعة', color: 'bg-amber-950/80 text-amber-300 border-amber-500/40', icon: AlertTriangle },
                  edited: { label: 'تم التعديل', color: 'bg-blue-950/80 text-blue-300 border-blue-500/40', icon: Clock },
                  approved: { label: 'معتمد', color: 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40', icon: CheckCircle },
                  scheduled: { label: 'مجدول للنشر', color: 'bg-cyan-950/80 text-cyan-300 border-cyan-500/40', icon: Calendar },
                  published: { label: 'تم النشر', color: 'bg-teal-950/80 text-teal-300 border-teal-500/40', icon: CheckCircle },
                };
                const statusInfo = statusMap[post.status] || statusMap.draft;
                const StatusIcon = statusInfo.icon;

                return (
                  <div
                    key={post.id}
                    className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border ${statusInfo.color}`}
                        >
                          <StatusIcon className="w-3 h-3" />
                          {statusInfo.label}
                        </span>
                        <h4 className="text-xs sm:text-sm font-bold text-white truncate">
                          {post.title}
                        </h4>
                      </div>
                      <p className="text-xs text-slate-400 line-clamp-1">{post.content}</p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        <span>الكاتب: {post.authorName}</span>
                        <span>•</span>
                        <span>المنصات: {post.targetPlatforms.length} منصة</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {post.status === 'review' && (currentUser.role === 'owner' || currentUser.role === 'manager') && (
                        <button
                          onClick={() => updatePostStatus(post.id, 'approved', 'موافقة فورية من لوحة التحكم')}
                          className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold hover:bg-emerald-500/30 transition cursor-pointer"
                        >
                          اعتماد
                        </button>
                      )}
                      <button
                        onClick={() => setActiveTab('approval')}
                        className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
                      >
                        <ArrowUpRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Left Column: Recent Customer Inquiries with AI Suggestions */}
        <div className="p-5 sm:p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-cyan-400" />
              أحدث استفسارات التقسيط والمبيعات
            </h3>
            <button
              onClick={() => setActiveTab('customers')}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 cursor-pointer"
            >
              شاشة المحادثات
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            {conversations.length === 0 ? (
              <div className="p-8 text-center text-slate-500 bg-slate-950/40 rounded-xl border border-slate-800">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50 text-slate-600" />
                <p className="text-xs font-semibold text-slate-400">لا توجد رسائل أو استفسارات واردة حالياً</p>
                <p className="text-[11px] text-slate-500 mt-0.5">ستظهر هنا الرسائل الجديدة فور ورودها من المنصات المتصلة</p>
              </div>
            ) : (
              conversations.slice(0, 4).map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => setActiveTab('customers')}
                  className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition cursor-pointer space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      {conv.avatar ? (
                        <img
                          src={conv.avatar}
                          alt={conv.customerName}
                          className="w-8 h-8 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-emerald-950 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-xs">
                          {conv.customerName ? conv.customerName.charAt(0) : '؟'}
                        </div>
                      )}
                      <div>
                        <h4 className="text-xs font-bold text-white">{conv.customerName}</h4>
                        <p className="text-[10px] text-slate-400">
                          عبر {conv.channel.toUpperCase()} • {conv.lastMessageTime}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                        conv.urgency === 'high'
                          ? 'bg-rose-950 text-rose-300 border border-rose-800'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {conv.category}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 line-clamp-1 bg-slate-900/90 p-2 rounded-lg border border-slate-800">
                    💬 "{conv.lastMessage}"
                  </p>

                  {conv.suggestedReply && (
                    <div className="text-[11px] text-emerald-300 bg-emerald-950/30 border border-emerald-500/20 p-2 rounded-lg line-clamp-1 flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span>رد ذكي مقترح: {conv.suggestedReply}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
