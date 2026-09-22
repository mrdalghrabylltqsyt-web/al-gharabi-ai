import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiService } from '../../services/api';
import {
  MessageSquare,
  Sparkles,
  UserCheck,
  Send,
  CheckCircle,
  AlertCircle,
  Clock,
  Phone,
  UserPlus,
  RefreshCw,
  Search,
  Filter,
  Package,
  ChevronRight,
  ShieldCheck,
  Building,
} from 'lucide-react';
import { SocialPlatformId, CustomerConversation } from '../../types';

export const CustomerCenterView: React.FC = () => {
  const {
    conversations,
    activeConversation,
    setActiveConversationId,
    sendCustomerReply,
    transferToHuman,
    markConversationResolved,
    addNewCustomerMessage,
    showroomInfo,
    users,
    showToast,
    currentUser,
  } = useApp();

  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [replyInputText, setReplyInputText] = useState<string>('');
  const [isClassifying, setIsClassifying] = useState<boolean>(false);
  const [showSimulateModal, setShowSimulateModal] = useState<boolean>(false);
  const [simName, setSimName] = useState<string>('');
  const [simChannel, setSimChannel] = useState<SocialPlatformId>('whatsapp');
  const [simMessage, setSimMessage] = useState<string>('');
  const [selectedStaff, setSelectedStaff] = useState<string>(users[0]?.name || 'مالك النظام');

  // Filter conversations
  const filteredConversations = conversations.filter((c) => {
    const matchChannel = filterChannel === 'all' || c.channel === filterChannel;
    const matchStatus = filterStatus === 'all' || c.status === filterStatus;
    const matchSearch =
      !searchTerm ||
      c.customerName.includes(searchTerm) ||
      c.phone.includes(searchTerm) ||
      c.lastMessage.includes(searchTerm);
    return matchChannel && matchStatus && matchSearch;
  });

  const handleSendReply = (asAi: boolean = false) => {
    if (!activeConversation) return;
    const textToSend = replyInputText || activeConversation.suggestedReply;
    if (!textToSend) return;

    sendCustomerReply(activeConversation.id, textToSend, asAi);
    setReplyInputText('');
  };

  const handleRegenerateAI = async () => {
    if (!activeConversation) return;
    setIsClassifying(true);
    const result = await apiService.classifyMessage({
      customerName: activeConversation.customerName,
      message: activeConversation.lastMessage,
      channel: activeConversation.channel,
      showroomInfo,
    });
    setIsClassifying(false);

    if (result && result.suggestedReply) {
      setReplyInputText(result.suggestedReply);
      // لا ندّعي أن المصدر Gemini: الرد قد يكون حتمياً أو بديلاً آمناً. نعرض
      // المصدر الفعلي كما أعلنه الخادم، ونحذّر عند الحاجة لمراجعة بشرية.
      const sourceLabel =
        result.aiSource === 'provider' ? 'Gemini' : result.aiSource === 'cache' ? 'ذاكرة مؤقتة' : 'محرك حتمي';
      showToast(
        result.requiresHumanReview
          ? `تم تحديث الرد المقترح (${sourceLabel}) — يتطلب مراجعة بشرية قبل الإرسال.`
          : `تم تحديث الرد المقترح (${sourceLabel}).`,
      );
    } else {
      showToast('تعذر اعتماد رد آمن لهذه الرسالة؛ يلزم مراجعة بشرية قبل الرد.');
    }
  };

  const handleSimulateNewMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!simMessage.trim()) return;
    addNewCustomerMessage(simChannel, simName, simMessage);
    setShowSimulateModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-emerald-400" />
              مركز خدمة العملاء والرسائل الموحد
            </h2>
            <span className="text-xs bg-emerald-950 text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-500/30 font-bold">
              ردود آلية وتحويل بشري
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            استقبال محادثات واستفسارات التقسيط من WhatsApp، Instagram، Telegram، TikTok، X، وسناب
            مع تصنيف الذكاء الاصطناعي واقتراح عروض الأسعار الدقيقة.
          </p>
        </div>

        <button
          onClick={() => setShowSimulateModal(true)}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-md shadow-emerald-500/20 transition cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          محاكاة رسالة عميل جديدة
        </button>
      </div>

      {/* Main Inbox Interface: Sidebar (4 cols) + Active Chat (8 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[600px]">
        {/* Right Conversations List (in RTL, this is start - 4 cols) */}
        <div className="lg:col-span-5 xl:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col space-y-3">
          {/* Search & Channel Filter */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="ابحث بالاسم أو الرقم أو الرسالة..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-9 pl-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] custom-scrollbar">
              <button
                onClick={() => setFilterChannel('all')}
                className={`px-2.5 py-1 rounded-lg font-semibold shrink-0 cursor-pointer ${
                  filterChannel === 'all'
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                الكل ({conversations.length})
              </button>
              {['whatsapp', 'instagram', 'snapchat', 'telegram', 'x'].map((ch) => (
                <button
                  key={ch}
                  onClick={() => setFilterChannel(ch)}
                  className={`px-2 py-1 rounded-lg font-semibold shrink-0 uppercase cursor-pointer ${
                    filterChannel === ch
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-950 text-slate-400 hover:text-white'
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>

          {/* Conversations Items List */}
          <div className="flex-1 overflow-y-auto space-y-2 max-h-[520px] custom-scrollbar pr-1">
            {filteredConversations.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-xs">
                لا توجد محادثات تطابق البحث.
              </div>
            ) : (
              filteredConversations.map((c) => {
                const isSelected = activeConversation?.id === c.id;
                return (
                  <div
                    key={c.id}
                    onClick={() => setActiveConversationId(c.id)}
                    className={`p-3 rounded-xl transition cursor-pointer space-y-2 border ${
                      isSelected
                        ? 'bg-emerald-950/40 border-emerald-500/50 shadow-sm'
                        : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {c.avatar ? (
                          <img
                            src={c.avatar}
                            alt={c.customerName}
                            className="w-8 h-8 rounded-lg object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-emerald-950 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-xs shrink-0">
                            {c.customerName ? c.customerName.charAt(0) : '؟'}
                          </div>
                        )}
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-white truncate">{c.customerName}</h4>
                          <p className="text-[10px] text-slate-400 truncate">
                            عبر <span className="uppercase text-emerald-400 font-bold">{c.channel}</span> • {c.lastMessageTime}
                          </p>
                        </div>
                      </div>

                      {c.urgency === 'high' && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 font-bold shrink-0">
                          عاجل
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-300 line-clamp-1">{c.lastMessage}</p>

                    <div className="flex items-center justify-between text-[10px] pt-1 border-t border-slate-800/80">
                      <span className="text-slate-400 truncate max-w-[140px]">{c.category}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded font-bold ${
                          c.status === 'new'
                            ? 'text-rose-400 bg-rose-950/50'
                            : c.status === 'transferred_human'
                            ? 'text-amber-400 bg-amber-950/50'
                            : 'text-emerald-400 bg-emerald-950/50'
                        }`}
                      >
                        {c.status === 'new'
                          ? 'جديد'
                          : c.status === 'transferred_human'
                          ? `مع: ${c.assignedStaff || 'موظف'}`
                          : 'مكتمل'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Left Chat Window (8 cols) */}
        <div className="lg:col-span-7 xl:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4">
          {activeConversation ? (
            <>
              {/* Chat Top Header */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                  {activeConversation.avatar ? (
                    <img
                      src={activeConversation.avatar}
                      alt={activeConversation.customerName}
                      className="w-10 h-10 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-emerald-950 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-sm">
                      {activeConversation.customerName ? activeConversation.customerName.charAt(0) : '؟'}
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-white">{activeConversation.customerName}</h3>
                      {activeConversation.phone && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                          {activeConversation.phone}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                      <span>القناة: <span className="uppercase text-emerald-400 font-bold">{activeConversation.channel}</span></span>
                      {activeConversation.interestedProduct && (
                        <>
                          <span>•</span>
                          <span className="text-slate-300">المنتج المطلوب: {activeConversation.interestedProduct}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status and Action Buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Transfer to Human Staff dropdown */}
                  <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-xl px-2 py-1">
                    <UserCheck className="w-3.5 h-3.5 text-amber-400" />
                    <select
                      value={selectedStaff}
                      onChange={(e) => setSelectedStaff(e.target.value)}
                      className="bg-transparent text-[11px] text-slate-200 focus:outline-none cursor-pointer"
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.name} className="bg-slate-900">
                          تحويل إلى: {u.name} ({u.roleTitleArabic})
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => transferToHuman(activeConversation.id, selectedStaff)}
                      className="text-[10px] bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-2 py-0.5 rounded-lg transition cursor-pointer"
                    >
                      تحويل
                    </button>
                  </div>

                  <button
                    onClick={() => markConversationResolved(activeConversation.id)}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-emerald-400 transition"
                    title="تحديد كمكتمل"
                  >
                    <CheckCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* AI Auto-Classification Insight Bar */}
              <div className="p-3 rounded-xl bg-slate-950/80 border border-emerald-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
                  <span className="text-slate-400">تصنيف الذكاء الاصطناعي:</span>
                  <span className="font-bold text-emerald-300">{activeConversation.category}</span>
                </div>
                {activeConversation.calculatedQuote && (
                  <div className="text-[11px] text-slate-300 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
                    حسبة المعرض التقريبية: {activeConversation.calculatedQuote.monthly.toLocaleString()} د.ع/شهر (دفعة {activeConversation.calculatedQuote.downPayment}%)
                  </div>
                )}
              </div>

              {/* Conversation History Stream */}
              <div className="flex-1 overflow-y-auto space-y-3 p-3 bg-slate-950/40 rounded-xl max-h-[280px] custom-scrollbar">
                {activeConversation.history.map((msg) => {
                  const isCust = msg.sender === 'customer';
                  const isAi = msg.sender === 'ai';

                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isCust ? 'items-start' : 'items-end'}`}
                    >
                      <div className="text-[10px] text-slate-400 mb-0.5 px-1">
                        {isCust
                          ? activeConversation.customerName
                          : isAi
                          ? 'الغرابي AI (آلي)'
                          : msg.senderName || 'موظف المعرض'}
                      </div>
                      <div
                        className={`p-3 rounded-2xl max-w-lg text-xs leading-relaxed ${
                          isCust
                            ? 'bg-slate-800 text-slate-200 rounded-tr-none'
                            : isAi
                            ? 'bg-emerald-950/80 border border-emerald-500/30 text-emerald-200 rounded-tl-none shadow-sm'
                            : 'bg-blue-950/80 border border-blue-500/30 text-blue-200 rounded-tl-none'
                        }`}
                      >
                        {msg.text}
                      </div>
                      <span className="text-[9px] text-slate-500 mt-0.5 px-1">{msg.timestamp}</span>
                    </div>
                  );
                })}
              </div>

              {/* AI Suggested Response Box with One-Click Send */}
              {activeConversation.suggestedReply && (
                <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      الرد الذكي المقترح (مستند لقاعدة بيانات المعرض):
                    </span>

                    <button
                      onClick={handleRegenerateAI}
                      disabled={isClassifying}
                      className="text-[10px] text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${isClassifying ? 'animate-spin' : ''}`} />
                      إعادة توليد
                    </button>
                  </div>

                  <p className="text-xs text-slate-300 whitespace-pre-line bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/80">
                    {activeConversation.suggestedReply}
                  </p>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setReplyInputText(activeConversation.suggestedReply || '')}
                      className="px-3 py-1 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 cursor-pointer"
                    >
                      تعديل في صندوق النص
                    </button>
                    <button
                      onClick={() => handleSendReply(true)}
                      className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-emerald-500/20"
                    >
                      <Send className="w-3 h-3" />
                      إرسال الرد المقترح فوراً
                    </button>
                  </div>
                </div>
              )}

              {/* Custom Reply Textarea */}
              <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                <input
                  type="text"
                  placeholder="اكتب رداً مخصصاً أو عدّل الرد المقترح..."
                  value={replyInputText}
                  onChange={(e) => setReplyInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSendReply(false);
                  }}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={() => handleSendReply(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5 text-emerald-400" />
                  إرسال
                </button>
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 py-16">
              <MessageSquare className="w-12 h-12 text-slate-700 mb-2" />
              <p className="text-sm font-bold">حدد محادثة من القائمة للبدء في الرد.</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Simulate Customer Message */}
      {showSimulateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-emerald-400" />
                محاكاة رسالة عميل جديدة واردة
              </h3>
              <button
                onClick={() => setShowSimulateModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSimulateNewMessage} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">اسم العميل</label>
                <input
                  type="text"
                  placeholder="أدخل اسم العميل..."
                  value={simName}
                  onChange={(e) => setSimName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">القناة الواردة</label>
                <select
                  value={simChannel}
                  onChange={(e) => setSimChannel(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500 uppercase"
                >
                  <option value="whatsapp">WhatsApp (واتساب)</option>
                  <option value="instagram">Instagram (إنستغرام)</option>
                  <option value="snapchat">Snapchat (سناب شات)</option>
                  <option value="telegram">Telegram (تليغرام)</option>
                  <option value="tiktok">TikTok (تيك توك)</option>
                  <option value="x">X / Twitter (إكس)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">نص رسالة العميل</label>
                <textarea
                  rows={3}
                  placeholder="أدخل نص استفسار العميل هنا..."
                  value={simMessage}
                  onChange={(e) => setSimMessage(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-emerald-500 resize-none"
                  required
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowSimulateModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold shadow-md shadow-emerald-500/20 cursor-pointer"
                >
                  إرسال الرسالة للمركز
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
