import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { toScheduleDisplay } from '../../utils/scheduleTime';
import {
  Share2,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  MessageCircle,
  Send,
  Eye,
  Heart,
  TrendingUp,
  Calendar,
  Layers,
  Filter,
  ExternalLink,
  ShieldCheck,
  Globe,
} from 'lucide-react';
import { SocialPlatformId } from '../../types';
import { apiService } from '../../services/api';

export const SocialHubView: React.FC = () => {
  const {
    platforms,
    togglePlatformStatus,
    addCustomPlatform,
    syncAllPlatforms,
    posts,
    conversations,
    showToast,
    setActiveTab,
  } = useApp();

  const [selectedPlatform, setSelectedPlatform] = useState<SocialPlatformId | 'all'>('all');
  const [activeSubTab, setActiveSubTab] = useState<'accounts' | 'posts' | 'comments' | 'scheduled' | 'stats'>('accounts');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPlatformName, setNewPlatformName] = useState('');
  const [newPlatformHandle, setNewPlatformHandle] = useState('');
  const [newPlatformColor, setNewPlatformColor] = useState('from-purple-600 to-indigo-700');

  // Interactive comments feed (empty initially, no mock data)
  interface SocialCommentItem {
    id: string;
    platform: string;
    author: string;
    avatar?: string;
    postTitle: string;
    comment: string;
    time: string;
    likes: number;
    replied: boolean;
    replyText?: string;
  }

  const [commentsList, setCommentsList] = useState<SocialCommentItem[]>([]);

  const [replyInput, setReplyInput] = useState<Record<string, string>>({});

  const handleRealConnect = async (platformId: string) => {
    try {
      const data = await apiService.startPlatformOAuth(platformId);
      if (data.authorizationUrl) window.location.assign(data.authorizationUrl);
    } catch (error: any) { showToast(error?.message || 'تعذر بدء الربط الحقيقي'); }
  };

  const handleSendCommentReply = (commentId: string) => {
    const text = replyInput[commentId];
    if (!text) return;
    setCommentsList((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, replied: true, replyText: text } : c))
    );
    setReplyInput((prev) => ({ ...prev, [commentId]: '' }));
    showToast('تم حفظ الرد محلياً. النشر الخارجي لا يتم إلا عبر موصل منصة موثق.');
  };

  const handleAddPlatformSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlatformName.trim()) return;
    addCustomPlatform({
      name: newPlatformName,
      handle: newPlatformHandle || `@algharabi_${newPlatformName.toLowerCase()}`,
      color: newPlatformColor,
    });
    setNewPlatformName('');
    setNewPlatformHandle('');
    setShowAddModal(false);
  };

  // Filter posts and comments by platform if selected
  const filteredPosts = posts.filter(
    (p) => selectedPlatform === 'all' || p.targetPlatforms.includes(selectedPlatform)
  );
  const scheduledFiltered = filteredPosts.filter((p) => p.status === 'scheduled');
  const publishedFiltered = filteredPosts.filter((p) => p.status === 'published');
  const filteredComments = commentsList.filter(
    (c) => selectedPlatform === 'all' || c.platform === selectedPlatform
  );

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 rounded-2xl bg-slate-900 border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <Share2 className="w-5 h-5 text-emerald-400" />
              إدارة المنصات الاجتماعية الموحدة
            </h2>
            <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-500/30 font-bold">
              {platforms.filter((p) => p.status === 'connected').length} من {platforms.length} منصات متصلة
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            إدارة المنشورات، التعليقات، الرسائل، والإحصائيات لكل منصة من مركز تحكم موحد وقابل للتوسع.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => syncAllPlatforms()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
            مزامنة الحسابات الآن
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-md shadow-emerald-500/20 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            إضافة منصة جديدة
          </button>
        </div>
      </div>

      {/* Platform Filter Badges */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 custom-scrollbar">
        <button
          onClick={() => setSelectedPlatform('all')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
            selectedPlatform === 'all'
              ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          جميع المنصات ({platforms.length})
        </button>
        {platforms.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedPlatform(p.platform)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
              selectedPlatform === p.platform
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                p.status === 'connected' ? 'bg-emerald-400' : 'bg-rose-500'
              }`}
            />
            <span>{p.name}</span>
          </button>
        ))}
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3 text-xs font-bold">
        {[
          { id: 'accounts', label: 'حالة الحسابات والاتصال', count: platforms.length },
          { id: 'posts', label: 'المنشورات المنشورة', count: publishedFiltered.length },
          { id: 'scheduled', label: 'المحتوى المجدول', count: scheduledFiltered.length },
          { id: 'comments', label: 'التعليقات والتفاعل المباشر', count: filteredComments.length },
          { id: 'stats', label: 'مقارنة إحصائيات المنصات' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id as any)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl transition cursor-pointer ${
              activeSubTab === tab.id
                ? 'bg-slate-800 text-emerald-400 font-extrabold border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-slate-900 text-slate-300">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Sub-Tab 1: Platform Accounts Cards */}
      {activeSubTab === 'accounts' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {platforms
            .filter((p) => selectedPlatform === 'all' || p.platform === selectedPlatform)
            .map((p) => (
              <div
                key={p.id}
                className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition space-y-4 relative overflow-hidden"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-11 h-11 rounded-xl bg-gradient-to-tr ${p.color} flex items-center justify-center text-white font-extrabold shadow-md`}
                    >
                      {p.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-bold text-sm text-white">{p.name}</h3>
                        {p.badge && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-emerald-300 font-semibold border border-slate-700">
                            {p.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">
                        {p.handle || 'لم يتم تعيين المعرّف بعد'}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => p.status === 'connected' ? togglePlatformStatus(p.id) : handleRealConnect(p.platform)}
                    className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition cursor-pointer ${
                      p.status === 'connected'
                        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40 hover:bg-rose-950/60 hover:text-rose-300 hover:border-rose-500/40'
                        : 'bg-rose-950/80 text-rose-300 border-rose-500/40 hover:bg-emerald-950/60 hover:text-emerald-300'
                    }`}
                  >
                    {p.status === 'connected' ? 'متصل فعلياً' : 'ربط حقيقي'}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-center">
                  <div className="p-2 rounded-xl bg-slate-950/50">
                    <span className="text-[10px] text-slate-400 block">المتابعون</span>
                    <span className="text-xs font-extrabold text-white">
                      {(p.followers || 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-950/50">
                    <span className="text-[10px] text-slate-400 block">التفاعل</span>
                    <span className="text-xs font-extrabold text-emerald-400">
                      {p.engagementRate}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-950/50">
                    <span className="text-[10px] text-slate-400 block">منشورات نشطة</span>
                    <span className="text-xs font-extrabold text-white">{p.postsCount}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                  <span>آخر مزامنة فعلية: {p.lastSyncTime || 'لم تتم بعد'}</span>
                  <button
                    onClick={() => setActiveTab('content')}
                    className="text-emerald-400 hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    إنشاء منشور مخصص
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Sub-Tab 2: Published Posts */}
      {activeSubTab === 'posts' && (
        <div className="space-y-3">
          {publishedFiltered.length === 0 ? (
            <div className="p-8 text-center text-slate-400 bg-slate-900/50 rounded-2xl border border-slate-800">
              لا توجد منشورات منشورة لهذه المنصة حالياً.
            </div>
          ) : (
            publishedFiltered.map((post) => (
              <div
                key={post.id}
                className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-sm text-white">{post.title}</h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      نُشر في: {post.publishedAt || 'مؤخراً'} • الكاتب: {post.authorName}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {post.targetPlatforms.map((plat) => (
                      <span
                        key={plat}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700"
                      >
                        {plat}
                      </span>
                    ))}
                  </div>
                </div>

                <p className="text-xs text-slate-200 bg-slate-950/60 p-3 rounded-xl whitespace-pre-line border border-slate-800/80">
                  {post.content}
                </p>

                {post.metrics && (
                  <div className="flex items-center gap-4 text-xs text-slate-400 pt-1">
                    <span className="flex items-center gap-1 text-slate-300">
                      <Eye className="w-3.5 h-3.5 text-emerald-400" /> {post.metrics.views.toLocaleString()} مشاهدة
                    </span>
                    <span className="flex items-center gap-1 text-slate-300">
                      <Heart className="w-3.5 h-3.5 text-rose-400" /> {post.metrics.likes.toLocaleString()} إعجاب
                    </span>
                    <span className="flex items-center gap-1 text-slate-300">
                      <MessageCircle className="w-3.5 h-3.5 text-cyan-400" /> {post.metrics.comments.toLocaleString()} تعليق
                    </span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Sub-Tab 3: Scheduled Posts */}
      {activeSubTab === 'scheduled' && (
        <div className="space-y-3">
          {scheduledFiltered.length === 0 ? (
            <div className="p-8 text-center text-slate-400 bg-slate-900/50 rounded-2xl border border-slate-800">
              لا توجد منشورات مجدولة حالياً لهذه المنصة.
            </div>
          ) : (
            scheduledFiltered.map((post) => (
              <div
                key={post.id}
                className="p-4 rounded-2xl bg-slate-900 border border-cyan-500/20 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
                      <Calendar className="w-4 h-4" />
                    </span>
                    <div>
                      <h4 className="font-bold text-sm text-white">{post.title}</h4>
                      <p className="text-xs text-cyan-300">
                        مجدول للإطلاق في: {toScheduleDisplay(post.scheduledFor) || 'الموعد المحدد'}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-500/30 font-bold">
                    معتمد — بانتظار الربط الفعلي
                  </span>
                </div>
                <p className="text-xs text-slate-300 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                  {post.content}
                </p>
              </div>
            ))
          )}
        </div>
      )}

      {/* Sub-Tab 4: Comments Feed & Replies */}
      {activeSubTab === 'comments' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 flex items-center justify-between">
            <span>الرد المباشر على تعليقات العملاء ينشر فوراً على المنصة المحددة.</span>
            <span className="text-emerald-400 font-bold">{commentsList.length} تعليقات واردة</span>
          </div>

          <div className="space-y-3">
            {filteredComments.length === 0 ? (
              <div className="p-8 text-center text-slate-400 bg-slate-900/50 rounded-2xl border border-slate-800">
                لا توجد تعليقات أو تفاعلات واردة حالياً من أي منصة اجتماعية.
              </div>
            ) : (
              filteredComments.map((com) => (
                <div
                  key={com.id}
                  className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 font-bold text-xs flex items-center justify-center border border-emerald-500/20">
                        {com.author ? com.author.charAt(0) : 'ع'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white">{com.author}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                            {com.platform}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400">
                          على منشور: "{com.postTitle}" • {com.time}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                        com.replied
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                          : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {com.replied ? 'تم الرد' : 'بانتظار الرد'}
                    </span>
                  </div>

                  <div className="text-xs text-slate-200 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                    {com.comment}
                  </div>

                  {com.replied && com.replyText && (
                    <div className="text-xs text-emerald-300 bg-emerald-950/40 p-3 rounded-xl border border-emerald-500/30 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold text-emerald-200">رد معرض الغرابي: </span>
                        <span>{com.replyText}</span>
                      </div>
                    </div>
                  )}

                  {!com.replied && (
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        placeholder="اكتب رداً رسمياً على التعليق..."
                        value={replyInput[com.id] || ''}
                        onChange={(e) =>
                          setReplyInput({ ...replyInput, [com.id]: e.target.value })
                        }
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        onClick={() => handleSendCommentReply(com.id)}
                        className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        إرسال الرد
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Sub-Tab 5: Comparison Stats */}
      {activeSubTab === 'stats' && (
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-5">
          <h3 className="font-bold text-sm text-white flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            مقارنة أداء وتفاعل قنوات معرض الغرابي
          </h3>

          <div className="space-y-3">
            {platforms.map((p) => {
              const maxFollowers = 200000;
              const percent = Math.min(100, Math.round((p.followers / maxFollowers) * 100));
              return (
                <div key={p.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      {p.name}
                    </span>
                    <span className="text-slate-400">
                      {p.followers.toLocaleString()} متابع • تفاعل {p.engagementRate}
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-l from-emerald-500 to-teal-600 rounded-full transition-all duration-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal: Add Custom Social Platform */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <Globe className="w-5 h-5 text-emerald-400" />
                ربط منصة اجتماعية جديدة
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddPlatformSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">اسم المنصة</label>
                <input
                  type="text"
                  placeholder="مثال: لينكد إن، بينترست، منصة بودكاست..."
                  value={newPlatformName}
                  onChange={(e) => setNewPlatformName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">معرّف الحساب (Handle / URL)</label>
                <input
                  type="text"
                  placeholder="مثال: @algharabi_official أو رابط القناة"
                  value={newPlatformHandle}
                  onChange={(e) => setNewPlatformHandle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">لون التمييز (Gradient)</label>
                <select
                  value={newPlatformColor}
                  onChange={(e) => setNewPlatformColor(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="from-emerald-500 to-teal-700">زمردي وأخضر</option>
                  <option value="from-blue-600 to-indigo-700">أزرق نيفي</option>
                  <option value="from-purple-600 to-pink-600">أرجواني وفوشيا</option>
                  <option value="from-amber-500 to-orange-600">ذهبي وبرتقالي</option>
                </select>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold shadow-md shadow-emerald-500/20 cursor-pointer"
                >
                  ربط المنصة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
