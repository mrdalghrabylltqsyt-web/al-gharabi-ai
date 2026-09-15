import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiService } from '../../services/api';
import {
  Bot,
  Sparkles,
  Send,
  TrendingUp,
  Clock,
  Compass,
  Lightbulb,
  Share2,
  CheckCircle,
  HelpCircle,
  ChevronLeft,
} from 'lucide-react';

export const CentralAgentView: React.FC = () => {
  const { platforms, posts, showroomInfo, setActiveTab, showToast } = useApp();

  const [messages, setMessages] = useState([
    {
      id: 'm1',
      role: 'assistant',
      text: `مرحباً بك! أنا "وكيل الغرابي AI الاستراتيجي المركزي".
أقوم بتنسيق العمل عبر المنصات المدعومة، وتحليل البيانات المتاحة فعلياً، واقتراح حملات تسويقية قابلة للمراجعة والاعتماد.

كيف يمكنني مساعدتك في خطتك التسويقية أو التشغيلية اليوم؟`,
      timestamp: '10:00 ص',
    },
  ]);

  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [aiStatus, setAiStatus] = useState<{usedToday:number; dailyGuard:number; remainingByGuard:number} | null>(null);
  const [weekPlan, setWeekPlan] = useState<Array<{day:string; objective:string}>>([]);
  const [isPlanning, setIsPlanning] = useState(false);
  const [workspaceSummary, setWorkspaceSummary] = useState<any>(null);

  React.useEffect(() => {
    apiService.getAiStatus().then((r:any) => setAiStatus(r.gemini)).catch(() => setAiStatus(null));
    apiService.getWorkspaceSummary().then((r:any) => setWorkspaceSummary(r)).catch(() => setWorkspaceSummary(null));
  }, []);

  const buildWeekPlan = async () => {
    setIsPlanning(true);
    try {
      const data = await apiService.buildWeekPlan(platforms.filter(p => p.status === 'connected').map(p => p.platform), 'منتجات المعرض وخدمات التقسيط');
      setWeekPlan(data.plan || []);
      showToast('تم بناء خطة أسبوعية أولية دون استهلاك Gemini');
    } catch (e:any) {
      showToast(e?.message || 'تعذر بناء الخطة');
    } finally { setIsPlanning(false); }
  };

  // Suggested strategic prompts
  const suggestedPrompts = [
    'حلل أداء حساباتنا وقارن التفاعل بين المنصات المربوطة',
    'ما هي أفضل أوقات النشر لجمهور منصات التواصل؟',
    'اقترح خطة حملة ترويجية لبرامج التقسيط بدون دفعة أولى',
    'كيف نزيد عدد المحادثات والتحويلات المباشرة إلى الواتساب؟',
  ];

  const handleSendMessage = async (textToSend?: string) => {
    const query = textToSend || inputPrompt;
    if (!query.trim() || isLoading) return;

    const userMsg = {
      id: `usr-${Date.now()}`,
      role: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputPrompt('');
    setIsLoading(true);

    const res = await apiService.agentChat({
      message: query,
      chatHistory: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        text: m.text,
      })),
      context: {
        platforms: platforms.map((p) => ({
          name: p.name,
          followers: p.followers,
          engagement: p.engagementRate,
        })),
        showroom: showroomInfo,
      },
    });

    setIsLoading(false);

    if (res.success && res.reply) {
      const aiMsg = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        text: res.reply,
        timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, aiMsg]);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-gradient-to-l from-slate-900 via-slate-900 to-purple-950/40 border border-purple-500/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-950/80 border border-purple-500/30 text-purple-300 text-xs font-bold mb-2">
            <Bot className="w-4 h-4 text-purple-400" />
            الوكيل المركزي متعدد المنصات
          </div>
          <h2 className="text-xl font-black text-white">الوكيل الذكي المركزي لمعرض الغرابي</h2>
          <p className="text-xs text-slate-300 mt-0.5">
            تنسيق متكامل بين جميع المنصات، تحليل دقيق لنتائج الحملات، واقتراح أفضل استراتيجيات التمويل والبيع.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="text-xs text-emerald-400 font-bold">نشط — يعتمد على البيانات المتاحة فعلياً</span>
        </div>
      </div>

      {/* Central workspace status */}
      {workspaceSummary && (
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-bold text-white">حالة مركز التشغيل</p>
              <p className="text-[11px] text-slate-400 mt-1">مصدر البيانات: الخادم المركزي — لا توجد أرقام تجريبية.</p>
            </div>
            <span className="text-[10px] font-bold text-emerald-400">متصل بالنواة</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ['المنتجات', workspaceSummary.products],
              ['المخزون', workspaceSummary.inStockProducts],
              ['المحادثات المفتوحة', workspaceSummary.openConversations],
              ['المهام المعلقة', workspaceSummary.pendingJobs],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl bg-slate-950 border border-slate-800 p-3">
                <p className="text-[10px] text-slate-500">{label}</p>
                <p className="text-lg font-black text-white mt-1">{Number(value || 0).toLocaleString('ar-IQ')}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Control Center: AI budget + deterministic planning */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-white">حماية استهلاك Gemini</p>
              <p className="text-[11px] text-slate-400 mt-1">هذا عداد حماية محلي، وليس حصة Google.</p>
            </div>
            <div className="text-left">
              <p className="text-lg font-black text-emerald-400">{aiStatus ? `${aiStatus.usedToday}/${aiStatus.dailyGuard}` : '—'}</p>
              <p className="text-[10px] text-slate-500">المتبقي بالحماية</p>
            </div>
          </div>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-white">مخطط أسبوعي بدون AI</p>
            <p className="text-[11px] text-slate-400 mt-1">يبني هيكل الحملة دون استهلاك أي طلب Gemini.</p>
          </div>
          <button onClick={buildWeekPlan} disabled={isPlanning} className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold">
            {isPlanning ? 'جاري البناء...' : 'بناء الخطة'}
          </button>
        </div>
      </div>

      {weekPlan.length > 0 && (
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white">الخطة الأسبوعية الأولية</h3>
            <span className="text-[10px] text-emerald-400 font-bold">بدون استهلاك Gemini</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {weekPlan.map((item) => (
              <div key={item.day} className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <p className="text-xs font-bold text-emerald-300">{item.day}</p>
                <p className="text-[11px] text-slate-300 mt-1">{item.objective}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Strategic Insights Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-white">
            <Clock className="w-4 h-4 text-emerald-400" />
            أفضل أوقات النشر والتفاعل
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            لا توجد بيانات كافية بعد لتحديد ذروة موثوقة. سيحسبها النظام بعد توفر بيانات فعلية.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-white">
            <TrendingUp className="w-4 h-4 text-cyan-400" />
            أعلى المنصات تفاعلاً واستفساراً
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            سيحدد الوكيل المنصات الأعلى تفاعلاً بعد وصول بيانات حقيقية من الحسابات المربوطة.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-white">
            <Lightbulb className="w-4 h-4 text-amber-400" />
            توصية المحتوى للأسبوع الحالي
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            فيديوهات قصيرة تستعرض يمكن اختبار فكرة <span className="text-amber-300 font-bold">"حسبة القسط في 15 ثانية"</span>، ولا تُعرض نسبة نجاح إلا بعد قياس فعلي.
          </p>
        </div>
      </div>

      {/* Interactive Chat Box */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden flex flex-col h-[550px]">
        {/* Chat Messages Log */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 custom-scrollbar bg-slate-950/40">
          {messages.map((msg) => {
            const isAi = msg.role === 'assistant';
            return (
              <div
                key={msg.id}
                className={`flex gap-3 max-w-2xl ${isAi ? 'ml-auto text-right' : 'mr-auto flex-row-reverse text-right'}`}
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                    isAi
                      ? 'bg-purple-950 text-purple-400 border border-purple-500/40'
                      : 'bg-emerald-950 text-emerald-400 border border-emerald-500/40'
                  }`}
                >
                  {isAi ? <Bot className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                </div>

                <div className="space-y-1">
                  <div
                    className={`p-4 rounded-2xl text-xs sm:text-sm leading-relaxed whitespace-pre-line ${
                      isAi
                        ? 'bg-slate-900 border border-slate-800 text-slate-200 shadow-md'
                        : 'bg-emerald-600 text-white font-medium'
                    }`}
                  >
                    {msg.text}
                  </div>
                  <span className="text-[10px] text-slate-500 block px-1">{msg.timestamp}</span>
                </div>
              </div>
            );
          })}

          {isLoading && (
            <div className="flex gap-3 max-w-md ml-auto">
              <div className="w-8 h-8 rounded-xl bg-purple-950 text-purple-400 border border-purple-500/40 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 animate-bounce" />
              </div>
              <div className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 text-xs text-purple-300 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping" />
                <span>الوكيل الذكي يحلل بيانات المعرض وصياغة التوصية...</span>
              </div>
            </div>
          )}
        </div>

        {/* Suggested Quick Question Chips */}
        <div className="p-3 bg-slate-900/90 border-t border-slate-800/80 flex items-center gap-2 overflow-x-auto custom-scrollbar">
          <span className="text-[11px] text-slate-400 shrink-0 flex items-center gap-1 font-bold">
            <Compass className="w-3 h-3 text-purple-400" />
            استفسارات مقترحة:
          </span>
          {suggestedPrompts.map((p, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(p)}
              className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 hover:text-white transition shrink-0 cursor-pointer text-right"
            >
              {p}
            </button>
          ))}
        </div>

        {/* Chat Input */}
        <div className="p-3 sm:p-4 bg-slate-900 border-t border-slate-800 flex items-center gap-2">
          <input
            type="text"
            placeholder="اطلب استشارة تسويقية أو خطة مبيعات من الوكيل المركزي..."
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSendMessage();
            }}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs sm:text-sm text-white focus:outline-none focus:border-purple-500"
          />
          <button
            onClick={() => handleSendMessage()}
            disabled={isLoading || !inputPrompt.trim()}
            className="px-5 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-purple-600/30"
          >
            <Send className="w-4 h-4" />
            إرسال
          </button>
        </div>
      </div>
    </div>
  );
};
