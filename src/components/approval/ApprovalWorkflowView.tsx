import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  ShieldCheck,
  CheckCircle,
  Clock,
  Edit3,
  Calendar,
  Send,
  Trash2,
  AlertTriangle,
  History,
  Eye,
  Check,
  X,
  FileCheck,
  Share2,
} from 'lucide-react';
import { Post, PostStatus } from '../../types';
import { defaultScheduleInput, toScheduleDisplay, wallClockInputValue, wallClockToEpoch } from '../../utils/scheduleTime';

export const ApprovalWorkflowView: React.FC = () => {
  const {
    posts,
    updatePostStatus,
    updatePostContent,
    deletePost,
    currentUser,
    showToast,
  } = useApp();

  const [activeStageFilter, setActiveStageFilter] = useState<PostStatus | 'all'>('all');
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [editContent, setEditContent] = useState<string>('');
  const [schedulingPost, setSchedulingPost] = useState<Post | null>(null);
  // القيمة جدار محلي Asia/Baghdad كما اختاره المستخدم — لا تُحوَّل إلى UTC أبداً.
  const [scheduleDateTime, setScheduleDateTime] = useState<string>(() => defaultScheduleInput());
  const [historyModalPost, setHistoryModalPost] = useState<Post | null>(null);

  const stages: Array<{ id: PostStatus; label: string; count: number; color: string }> = [
    { id: 'draft', label: '1. مسودة (Draft)', count: posts.filter((p) => p.status === 'draft').length, color: 'text-slate-400' },
    { id: 'review', label: '2. قيد المراجعة (Review)', count: posts.filter((p) => p.status === 'review').length, color: 'text-amber-400' },
    { id: 'edited', label: '3. تم التعديل (Edited)', count: posts.filter((p) => p.status === 'edited').length, color: 'text-blue-400' },
    { id: 'approved', label: '4. تمت الموافقة (Approved)', count: posts.filter((p) => p.status === 'approved').length, color: 'text-emerald-400' },
    { id: 'scheduled', label: '5. مجدول للنشر (Scheduled)', count: posts.filter((p) => p.status === 'scheduled').length, color: 'text-cyan-400' },
    { id: 'published', label: '6. تم النشر (Published)', count: posts.filter((p) => p.status === 'published').length, color: 'text-teal-400' },
  ];

  const filteredPosts = posts.filter(
    (p) => activeStageFilter === 'all' || p.status === activeStageFilter
  );

  const openEditModal = (post: Post) => {
    setEditingPost(post);
    setEditTitle(post.title);
    setEditContent(post.content);
  };

  const handleSaveEdit = () => {
    if (!editingPost) return;
    updatePostContent(editingPost.id, {
      title: editTitle,
      content: editContent,
      status: 'edited',
    });
    updatePostStatus(editingPost.id, 'edited', `تعديل النص بواسطة ${currentUser?.name || 'مستخدم النظام'}`);
    setEditingPost(null);
  };

  const handleConfirmSchedule = () => {
    if (!schedulingPost) return;
    // القيمة جدار محلي خالص: نرفض موعداً في الماضي بتحويل صحيح للّحظة، لا بمقارنة نصية.
    const epoch = wallClockToEpoch(scheduleDateTime);
    if (!Number.isFinite(epoch)) {
      showToast('موعد الجدولة غير صالح.');
      return;
    }
    if (epoch <= Date.now()) {
      showToast('لا يمكن جدولة موعد في الماضي.');
      return;
    }
    // نرسل الجدار المحلي كما هو فلا تتغيّر الساعة التي اختارها المستخدم في العراق.
    const scheduledFor = scheduleDateTime.replace(' ', 'T');
    updatePostStatus(
      schedulingPost.id,
      'scheduled',
      `جدولة النشر في ${scheduledFor} بواسطة ${currentUser?.name || 'مستخدم النظام'}`,
      scheduledFor
    );
    setSchedulingPost(null);
  };

  const handlePublishNow = (post: Post) => {
    updatePostStatus(
      post.id,
      'published',
      `تم إطلاق ونشر المحتوى فورياً على المنصات بواسطة ${currentUser?.name || 'مستخدم النظام'}`
    );
    showToast(`تم إطلاق ونشر "${post.title}" على منصات التواصل!`);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Notice */}
      <div className="p-6 rounded-2xl bg-gradient-to-l from-slate-900 via-slate-900 to-amber-950/40 border border-amber-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold">
            <ShieldCheck className="w-3.5 h-3.5" />
            حوكمة النشر الرسمية لمعرض الغرابي للتقسيط
          </div>
          <h2 className="text-xl font-black text-white">نظام الموافقة والاعتماد المتدرج</h2>
          <p className="text-xs text-slate-300">
            حماية كاملة لحسابات المعرض: لا يتم النشر تلقائياً أبداً إلا بعد مرور المحتوى بالمراحل الست:
            مسودة ← مراجعة ← تعديل ← موافقة ← جدولة ← نشر.
          </p>
        </div>

        <div className="text-xs text-slate-300 bg-slate-950/80 px-4 py-2.5 rounded-xl border border-slate-800">
          دورك الحالي: <span className="text-emerald-400 font-bold">{currentUser?.roleTitleArabic || 'موثق'}</span>
        </div>
      </div>

      {/* Stage Selector Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 custom-scrollbar">
        <button
          onClick={() => setActiveStageFilter('all')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
            activeStageFilter === 'all'
              ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          كافة المنشورات ({posts.length})
        </button>

        {stages.map((stg) => (
          <button
            key={stg.id}
            onClick={() => setActiveStageFilter(stg.id)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
              activeStageFilter === stg.id
                ? 'bg-slate-800 text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <span>{stg.label}</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-md font-extrabold ${
                stg.count > 0 ? 'bg-slate-800 text-emerald-400' : 'bg-slate-950 text-slate-500'
              }`}
            >
              {stg.count}
            </span>
          </button>
        ))}
      </div>

      {/* Posts List in Current Pipeline Stage */}
      <div className="space-y-4">
        {filteredPosts.length === 0 ? (
          <div className="p-12 text-center text-slate-400 bg-slate-900/50 rounded-2xl border border-slate-800">
            <FileCheck className="w-10 h-10 mx-auto text-slate-600 mb-2" />
            <p className="font-bold text-sm">لا توجد منشورات في هذه المرحلة حالياً.</p>
            <p className="text-xs text-slate-500 mt-1">
              يمكنك توليد محتوى جديد من "مركز المحتوى" وإرساله للمراجعة.
            </p>
          </div>
        ) : (
          filteredPosts.map((post) => {
            const isManager = currentUser.role === 'manager' || currentUser.role === 'owner';
            const isContent = currentUser.role === 'content_creator' || isManager;

            return (
              <div
                key={post.id}
                className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 hover:border-slate-700 transition"
              >
                {/* Post Top Meta */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-base text-white">{post.title}</h3>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                        #{post.id}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      تم الإنشاء: {post.createdAt} • الكاتب: {post.authorName} ({post.authorRole})
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      {post.targetPlatforms.map((plat) => (
                        <span
                          key={plat}
                          className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-950/80 text-emerald-300 border border-emerald-500/30 uppercase"
                        >
                          {plat}
                        </span>
                      ))}
                    </div>

                    <button
                      onClick={() => setHistoryModalPost(post)}
                      className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
                      title="سجل التعديلات والاعتمادات"
                    >
                      <History className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Content Body Preview */}
                <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs text-slate-200 whitespace-pre-line leading-relaxed font-sans">
                  {post.content}
                </div>

                {/* Scheduled / Published Notice */}
                {post.scheduledFor && (
                  <div className="p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-xs text-cyan-300 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>مجدول للإطلاق في موعد: {toScheduleDisplay(post.scheduledFor) ?? post.scheduledFor}</span>
                  </div>
                )}

                {post.publishedAt && (
                  <div className="p-2.5 rounded-xl bg-teal-950/40 border border-teal-500/30 text-xs text-teal-300 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-teal-400 shrink-0" />
                    <span>تنفيذ خارجي موثّق على المنصات في: {post.publishedAt}</span>
                  </div>
                )}

                {/* Action Pipeline Buttons */}
                <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-800 flex-wrap">
                  {/* Left: Progression Buttons according to status */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Stage: Draft -> Submit for Review */}
                    {post.status === 'draft' && (
                      <button
                        onClick={() =>
                          updatePostStatus(
                            post.id,
                            'review',
                            `إرسال للمراجعة بواسطة ${currentUser.name}`
                          )
                        }
                        className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md shadow-amber-500/20"
                      >
                        <Send className="w-3.5 h-3.5" />
                        إرسال للمراجعة
                      </button>
                    )}

                    {/* Stage: Review/Edited -> Approve (Manager only) */}
                    {(post.status === 'review' || post.status === 'edited') && (
                      <>
                        <button
                          onClick={() =>
                            updatePostStatus(
                              post.id,
                              'approved',
                              `موافقة الإدارة بواسطة ${currentUser?.name || 'مستخدم النظام'}`
                            )
                          }
                          className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md shadow-emerald-500/20"
                        >
                          <Check className="w-3.5 h-3.5" />
                          موافقة واعتماد
                        </button>
                        <button
                          onClick={() =>
                            updatePostStatus(
                              post.id,
                              'draft',
                              `إرجاع للمسودة من قبل ${currentUser?.name || 'مستخدم النظام'} للتعديل`
                            )
                          }
                          className="px-3 py-1.5 rounded-xl bg-slate-800 text-amber-300 hover:bg-slate-700 text-xs font-bold cursor-pointer"
                        >
                          إرجاع للتعديل
                        </button>
                      </>
                    )}

                    {/* Stage: Approved -> Schedule or Publish */}
                    {post.status === 'approved' && (
                      <>
                        <button
                          onClick={() => {
                            // نعرض الموعد المحفوظ بنفس الساعة التي اختارها المستخدم، أو الافتراضي.
                            setScheduleDateTime(wallClockInputValue(post.scheduledFor) || defaultScheduleInput());
                            setSchedulingPost(post);
                          }}
                          className="px-3.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Calendar className="w-3.5 h-3.5" />
                          جدولة النشر
                        </button>
                        <button
                          onClick={() => handlePublishNow(post)}
                          className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md shadow-emerald-500/20"
                        >
                          <Send className="w-3.5 h-3.5" />
                          نشر الآن فوراً
                        </button>
                      </>
                    )}

                    {/* Stage: Scheduled -> Publish early */}
                    {post.status === 'scheduled' && (
                      <button
                        onClick={() => handlePublishNow(post)}
                        className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        تقديم النشر الآن
                      </button>
                    )}
                  </div>

                  {/* Right: Edit & Delete controls */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditModal(post)}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      تعديل المحتوى
                    </button>

                    <button
                      onClick={() => deletePost(post.id)}
                      className="p-1.5 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition cursor-pointer"
                      title="حذف المنشور"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal: Edit Post Content */}
      {editingPost && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-emerald-400" />
                تعديل المحتوى قبل الاعتماد
              </h3>
              <button
                onClick={() => setEditingPost(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">عنوان المنشور</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">نص المنشور الكامل</label>
                <textarea
                  rows={8}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-emerald-500 font-sans"
                />
              </div>
            </div>

            <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
              <button
                onClick={() => setEditingPost(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold shadow-md shadow-emerald-500/20 cursor-pointer"
              >
                حفظ التعديل كـ [تم التعديل]
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Schedule Post Date & Time */}
      {schedulingPost && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <Calendar className="w-5 h-5 text-cyan-400" />
                جدولة توقيت النشر الآلي
              </h3>
              <button
                onClick={() => setSchedulingPost(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-300">
                حدد التاريخ والساعة المناسبة لإطلاق المنشور تلقائياً:
              </p>
              <input
                type="datetime-local"
                value={scheduleDateTime}
                onChange={(e) => setScheduleDateTime(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-emerald-500"
              />
              <p className="text-[11px] text-emerald-400">
                💡 أوقات الذروة المقترحة للمنصات: 7:00 م - 10:00 م يومياً.
              </p>
            </div>

            <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
              <button
                onClick={() => setSchedulingPost(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                onClick={handleConfirmSchedule}
                className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold shadow-md shadow-cyan-500/20 cursor-pointer"
              >
                تأكيد الجدولة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Audit Trail / Post History */}
      {historyModalPost && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <History className="w-5 h-5 text-emerald-400" />
                سجل حركات واعتمادات المنشور
              </h3>
              <button
                onClick={() => setHistoryModalPost(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 max-h-80 overflow-y-auto">
              {historyModalPost.history.map((act, index) => (
                <div
                  key={act.id}
                  className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs space-y-1 relative"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white">{act.byUser}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{act.timestamp}</span>
                  </div>
                  <p className="text-[11px] text-emerald-400 font-medium">
                    الإجراء: {act.action} ({act.userRole})
                  </p>
                  {act.note && <p className="text-slate-300">{act.note}</p>}
                </div>
              ))}
            </div>

            <div className="pt-2 text-left">
              <button
                onClick={() => setHistoryModalPost(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold text-xs cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
