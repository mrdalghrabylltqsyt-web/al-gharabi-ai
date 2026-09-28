import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiService } from '../../services/api';
import {
  Bot, Play, RefreshCw, CheckCircle2, AlertTriangle, Clock, XCircle,
  Wrench, ShieldCheck, Loader2, ListChecks, Cpu, History, ChevronDown, ChevronUp,
} from 'lucide-react';

/**
 * العقل المركزي (Central AI Agent) — واجهة المالك.
 *
 * كل ما يُعرض مبني على نتيجة backend حقيقية: حالة المهمة، خطتها، سجل تنفيذها،
 * أدواتها ونتائجها. لا يوجد أي ادّعاء نجاح محلي: الزر يعطّل أثناء الطلب،
 * والفشل يُعرض بسبب من الخادم.
 */

type AgentTask = {
  id: string;
  task: string;
  mode: string;
  status: 'queued' | 'planning' | 'executing' | 'waiting' | 'completed' | 'failed' | 'blocked';
  failureCode: string;
  verified: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  plan: { kind: string; summary: string; requiresAi: boolean; requiresApproval: boolean; reason: string; steps: Array<{ toolId: string; label: string }> } | null;
  journal: Array<{ step: number; toolId: string; label: string; permission: string; ok: boolean; code?: string; error?: string; summary: string; durationMs: number; attempts: number }>;
  result: { summary: string; data: AgentResultItem[] } | null;
  contextSummary: string[];
};

/** عنصر نتيجة مهمة: ملخّص كل خطوة + مخرجها الحقيقي المنقّى (قد يحمل تحليل تعليقات). */
type AgentResultItem = {
  step: number;
  toolId: string;
  ok: boolean;
  summary: string;
  output?: any;
};

type AgentTool = {
  id: string; name: string; description: string; permission: string; parametersLabel: string; requiresApproval: boolean;
};

const STATUS_META: Record<string, { label: string; tone: string; icon: React.ReactNode }> = {
  queued: { label: 'في الطابور', tone: 'bg-slate-700/40 text-slate-200 border-slate-600/40', icon: <Clock className="w-3.5 h-3.5" /> },
  planning: { label: 'تخطيط', tone: 'bg-sky-900/40 text-sky-200 border-sky-500/40', icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  executing: { label: 'تنفيذ', tone: 'bg-amber-900/40 text-amber-200 border-amber-500/40', icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  waiting: { label: 'بانتظار موافقة', tone: 'bg-purple-900/40 text-purple-200 border-purple-500/40', icon: <Clock className="w-3.5 h-3.5" /> },
  completed: { label: 'اكتملت', tone: 'bg-emerald-900/40 text-emerald-200 border-emerald-500/40', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  failed: { label: 'فشلت', tone: 'bg-rose-900/40 text-rose-200 border-rose-500/40', icon: <XCircle className="w-3.5 h-3.5" /> },
  blocked: { label: 'محجوبة', tone: 'bg-orange-900/40 text-orange-200 border-orange-500/40', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
};

const PERMISSION_LABEL: Record<string, string> = {
  READ: 'قراءة', WRITE: 'كتابة', EXECUTE: 'تنفيذ', EXTERNAL_ACTION: 'خارجية', SENSITIVE: 'حساسة',
};

const SUGGESTIONS = [
  'المنصة انستغرام لا تعمل، ما السبب؟',
  'ما حالة المنصات وما ينقص للربط؟',
  'حلل أداء الحملات واقترح تحسيناً',
  'اقترح خطة محتوى للأسبوع القادم',
];

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] || STATUS_META.queued;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold ${meta.tone}`}>
      {meta.icon}{meta.label}
    </span>
  );
}

/**
 * يقرأ مخرجات task.result.data الحقيقية ويعرض تحليل التعليقات إن وُجد:
 * نص أحدث تعليق + نوعه + مشاعره + الرد المقترح باللهجة العراقية + وسم «لم يُرسل».
 * كل القيم من الخادم؛ لا حساب محلي ولا ادّعاء إرسال.
 */
function CommentAnalysisPanel({ data }: { data: AgentResultItem[] }) {
  const commentsItem = data.find((d) => d.toolId === 'youtube_comments' && d.ok && d.output);
  const aiItem = data.find((d) => d.toolId === 'ai_draft' && d.ok && d.output);
  if (!commentsItem && !(aiItem && aiItem.output?.kind === 'comment_analysis')) return null;

  const latest = commentsItem?.output?.latestComment || null;
  const comments: any[] = Array.isArray(commentsItem?.output?.comments) ? commentsItem.output.comments : [];
  const analyzed: any[] = Array.isArray(aiItem?.output?.analyzed) ? aiItem.output.analyzed : [];
  const latestAnalysis = aiItem?.output?.latestAnalysis || analyzed[0] || null;
  const willAutoSend = aiItem?.output?.willAutoSend === true;

  // اسم الفيديو إن توفّر: يُشتق من مخرج youtube_videos الحقيقي بمطابقة videoId.
  const videos: any[] = (data.find((d) => d.toolId === 'youtube_videos' && d.ok && d.output)?.output?.videos) || [];
  const videoId = latest?.videoId ?? latestAnalysis?.videoId ?? null;
  const videoTitle = videoId ? (videos.find((v) => v && v.videoId === videoId)?.title ?? null) : null;

  const typeAr = latestAnalysis?.typeAr ?? latestAnalysis?.type ?? null;
  const sentimentAr = latestAnalysis?.sentimentAr ?? latestAnalysis?.sentiment ?? null;
  const reply = latestAnalysis?.iraqiSuggestedReply ?? null;

  return (
    <div className="mt-3 p-3 rounded-xl bg-slate-950/60 border border-emerald-900/40 space-y-2">
      <p className="text-[11px] font-bold text-emerald-300">تحليل أحدث تعليق (بيانات حقيقية من المصدر)</p>

      <div className="text-[11px] text-slate-300 space-y-1">
        <p><span className="text-slate-500">نص التعليق: </span>{latest?.text ?? latestAnalysis?.text ?? '—'}</p>
        {videoTitle && <p><span className="text-slate-500">الفيديو: </span>{videoTitle}</p>}
        {latest?.authorName && <p><span className="text-slate-500">الكاتب: </span>{latest.authorName}</p>}
        {latest?.publishedAt && <p><span className="text-slate-500">التاريخ: </span>{latest.publishedAt}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          {typeAr && <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-900/40 text-sky-200 border border-sky-500/40">النوع: {typeAr}</span>}
          {sentimentAr && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-200 border border-amber-500/40">المشاعر: {sentimentAr}</span>}
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${willAutoSend ? 'bg-rose-900/40 text-rose-200 border-rose-500/40' : 'bg-emerald-900/40 text-emerald-200 border-emerald-500/40'}`}>
            {willAutoSend ? 'يُرسل تلقائياً' : 'لم يُرسل'}
          </span>
        </div>
      </div>

      {reply && (
        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
          <p className="text-[10px] font-bold text-slate-400 mb-1">الرد المقترح باللهجة العراقية (لم يُرسل)</p>
          <p className="text-[11px] text-slate-200 leading-relaxed">{reply}</p>
        </div>
      )}

      {comments.length > 1 && (
        <p className="text-[10px] text-slate-500">تعليقات تم تحليلها: {analyzed.length || comments.length}</p>
      )}
    </div>
  );
}

function TaskCard({ task, onReplay, replaying }: { task: AgentTask; onReplay: (id: string) => void; replaying: boolean; key?: React.Key }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-start justify-between gap-3 p-4 text-right hover:bg-slate-800/40 transition">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white truncate">{task.task}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <StatusBadge status={task.status} />
            {task.verified && <span className="text-[11px] text-emerald-300 inline-flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> موثّقة</span>}
            <span className="text-[11px] text-slate-400">خطوات: {task.journal.length}</span>
            {task.plan?.requiresAi && <span className="text-[11px] text-sky-300 inline-flex items-center gap-1"><Cpu className="w-3.5 h-3.5" /> تستخدم AI</span>}
            {task.plan?.requiresApproval && <span className="text-[11px] text-purple-300">تتطلب موافقة</span>}
          </div>
        </div>
        <div className="shrink-0 text-slate-400 mt-1">{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-800">
          {task.plan && (
            <div className="mt-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <p className="text-[11px] font-bold text-slate-300 mb-1">الخطة ({task.plan.kind})</p>
              <p className="text-[11px] text-slate-400 leading-relaxed">{task.plan.summary}</p>
              <p className="text-[11px] text-slate-500 mt-1">السبب: {task.plan.reason}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {task.plan.steps.map((s, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">{i + 1}. {s.label}</span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-slate-300 inline-flex items-center gap-1"><ListChecks className="w-3.5 h-3.5" /> سجل التنفيذ</p>
            {task.journal.map((e, i) => (
              <div key={i} className={`p-2.5 rounded-xl border text-[11px] ${e.ok ? 'bg-emerald-950/20 border-emerald-900/40' : 'bg-rose-950/20 border-rose-900/40'}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-bold text-slate-100 inline-flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5 text-slate-400" /> {e.label}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{PERMISSION_LABEL[e.permission] || e.permission}</span>
                  </span>
                  <span className={e.ok ? 'text-emerald-300' : 'text-rose-300'}>{e.ok ? 'نجحت' : (e.code || 'فشل')} • {e.durationMs}ms{e.attempts > 1 ? ` • ${e.attempts} محاولة` : ''}</span>
                </div>
                <p className="text-slate-400 mt-1">{e.summary}</p>
                {e.error && <p className="text-rose-300/80 mt-0.5">{e.error}</p>}
              </div>
            ))}
          </div>

          {task.result && (
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <p className="text-[11px] font-bold text-emerald-300">النتيجة</p>
              <p className="text-[11px] text-slate-300 mt-1">{task.result.summary}</p>
              <CommentAnalysisPanel data={Array.isArray(task.result.data) ? task.result.data : []} />
            </div>
          )}

          {task.error && (
            <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-900/40">
              <p className="text-[11px] font-bold text-rose-300">الخطأ</p>
              <p className="text-[11px] text-rose-200/80 mt-1">{task.error}</p>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
            <span className="text-[10px] text-slate-500">#{task.id} • {new Date(task.createdAt).toLocaleString('ar-IQ')}</span>
            <button type="button" onClick={() => onReplay(task.id)} disabled={replaying}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold disabled:opacity-50">
              {replaying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} إعادة التشغيل
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const CentralAgentConsole: React.FC = () => {
  const { showToast } = useApp();
  const [taskText, setTaskText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [current, setCurrent] = useState<AgentTask | null>(null);
  const [delegation, setDelegation] = useState<any>(null);

  const loadAll = useCallback(async () => {
    try {
      const [h, t, ts] = await Promise.all([apiService.agentHealth(), apiService.agentTools(), apiService.agentTasks()]);
      setHealth(h); setTools(t.tools || []); setTasks(ts.tasks || []);
      // حالة تفويض تشغيل YouTube (نطاق YouTube فقط) — للعرض لا للتنفيذ.
      apiService.getYouTubeDelegation().then((d) => setDelegation(d.delegation || null)).catch(() => setDelegation(null));
    } catch (e: any) {
      showToast(e?.message || 'تعذر تحميل بيانات العقل المركزي');
    }
  }, [showToast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const submit = async (text?: string) => {
    const query = (text ?? taskText).trim();
    if (!query || submitting) return;
    setSubmitting(true);
    try {
      const res = await apiService.agentCreateTask(query, { idempotencyKey: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
      const created: AgentTask = res.task;
      setCurrent(created);
      setTaskText('');
      setTasks((prev) => [created, ...prev.filter((t) => t.id !== created.id)]);
      showToast(created.status === 'completed' ? 'اكتملت المهمة بنجاح' : created.status === 'waiting' ? 'المهمة تنتظر موافقة بشرية' : `حالة المهمة: ${STATUS_META[created.status]?.label || created.status}`);
    } catch (e: any) {
      showToast(e?.message || 'تعذر تنفيذ المهمة');
    } finally {
      setSubmitting(false);
    }
  };

  const replay = async (id: string) => {
    setReplayingId(id);
    try {
      const res = await apiService.agentReplay(id);
      setCurrent(res.task);
      setTasks((prev) => [res.task, ...prev]);
      showToast('أُعيد تشغيل المهمة');
    } catch (e: any) {
      showToast(e?.message || 'تعذر إعادة التشغيل');
    } finally {
      setReplayingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="p-5 rounded-2xl bg-gradient-to-l from-slate-900 via-slate-900 to-purple-950/40 border border-purple-500/20">
        <div className="flex items-center gap-2 mb-1">
          <Bot className="w-5 h-5 text-purple-400" />
          <h2 className="text-lg font-black text-white">العقل المركزي — Central AI Agent</h2>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          يفهم المهمة، يخطط، يختار الأدوات الحقيقية، ينفّذ، يتحقق، ويسجّل. لا يدّعي تنفيذاً خارجياً بلا إثبات، ولا يستهلك الذكاء الاصطناعي في العمليات الحتمية.
        </p>
        {health && (
          <div className="flex flex-wrap gap-2 mt-3">
            <span className={`text-[11px] px-2.5 py-1 rounded-full border font-bold ${health.primaryProviderConfigured ? 'bg-emerald-900/40 text-emerald-200 border-emerald-500/40' : 'bg-amber-900/40 text-amber-200 border-amber-500/40'}`}>
              مزوّد AI: {health.primaryProviderConfigured ? 'مضبوط' : 'غير مضبوط (بديل حتمي)'}
            </span>
            <span className="text-[11px] px-2.5 py-1 rounded-full border bg-slate-800/60 text-slate-200 border-slate-700 font-bold">أدوات: {health.tools}</span>
            <span className={`text-[11px] px-2.5 py-1 rounded-full border font-bold ${health.councilEnabled ? 'bg-sky-900/40 text-sky-200 border-sky-500/40' : 'bg-slate-800/60 text-slate-300 border-slate-700'}`}>
              AI Council: {health.councilEnabled ? 'مفعّل' : 'جاهز للتوسعة'}
            </span>
            <span className="text-[11px] px-2.5 py-1 rounded-full border bg-slate-800/60 text-slate-300 border-slate-700 font-bold">الإصدار {health.version}</span>
            <span className={`text-[11px] px-2.5 py-1 rounded-full border font-bold ${delegation?.active ? 'bg-emerald-900/40 text-emerald-200 border-emerald-500/40' : 'bg-slate-800/60 text-slate-300 border-slate-700'}`}>
              تفويض YouTube: {delegation?.active ? `فعّال (${(delegation.actionsLabelAr || []).join('، ')})` : 'غير فعّال — يلزم منحه من مركز الربط'}
            </span>
          </div>
        )}
      </div>

      {/* Task input */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <label className="text-xs font-bold text-slate-200">مهمة جديدة للعقل</label>
        <textarea
          value={taskText}
          onChange={(e) => setTaskText(e.target.value)}
          rows={3}
          placeholder="اكتب مهمة تشغيلية حقيقية… مثال: «ما حالة المنصات وما ينقص لربط انستغرام؟»"
          className="w-full rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm p-3 focus:outline-none focus:border-purple-500/50 resize-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => submit(s)} disabled={submitting}
              className="text-[11px] px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => loadAll()} className="text-xs text-slate-400 hover:text-slate-200 inline-flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> تحديث الحالة
          </button>
          <button type="button" onClick={() => submit()} disabled={submitting || !taskText.trim()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-black disabled:opacity-50">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} إرسال للعقل
          </button>
        </div>
      </div>

      {/* Latest task */}
      {current && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-200">أحدث مهمة</p>
          <TaskCard task={current} onReplay={replay} replaying={replayingId === current.id} />
        </div>
      )}

      {/* Journal / history */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-slate-200 inline-flex items-center gap-1.5"><History className="w-4 h-4" /> سجل المهام السابقة</p>
        {tasks.length === 0 && <p className="text-xs text-slate-500 p-4 rounded-2xl bg-slate-900 border border-slate-800">لا توجد مهام بعد. اكتب مهمة أعلاه ليبدأ العقل.</p>}
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} onReplay={replay} replaying={replayingId === t.id} />
        ))}
      </div>

      {/* Tools reference */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
        <p className="text-xs font-bold text-slate-200 inline-flex items-center gap-1.5 mb-3"><Wrench className="w-4 h-4" /> أدوات العقل ({tools.length})</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {tools.map((t) => (
            <div key={t.id} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-bold text-slate-100">{t.name}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">{PERMISSION_LABEL[t.permission] || t.permission}</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{t.description}</p>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[10px] text-slate-500">المعاملات: {t.parametersLabel}</span>
                {t.requiresApproval && <span className="text-[10px] text-purple-300">تتطلب موافقة</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
