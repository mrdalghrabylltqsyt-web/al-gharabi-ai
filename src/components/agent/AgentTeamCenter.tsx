import React, { useCallback, useEffect, useState } from 'react';
import { apiService } from '../../services/api';

/**
 * مركز فريق الوكلاء (Agent Team Center) — عرض جلسات الفريق الداخلي.
 *
 * يعرض للعقول: المهام، الوكلاء المشاركون، الحالة، الأدلة، النتائج، الخلافات،
 * نتيجة النقد، القرار، الثقة، حالة الصدق، وحالة حفظ الذاكرة. يفرّق صراحةً بين
 * FACT / DERIVED / HYPOTHESIS / UNKNOWN / UNAVAILABLE.
 *
 * قراءة/تشخيص فقط: زر التشغيل يطلب قراراً مقترحاً — **لا تنفيذ خارجي** ولا نشر ولا رد.
 */

interface TeamOutput {
  agentId: string; status: string; kind: string; truthState: string;
  statement: string; evidence: string[]; source: string; sampleSize: number;
  confidence: string; limitations: string; provenance: string; error?: string;
}
interface TeamConflict {
  id: string; between: string[]; statement: string; leftState: string; rightState: string; resolved: boolean; reason: string;
}
interface TeamSessionFull {
  teamSessionId: string; task: string; trigger: string; source: string; participants: string[];
  evidence: string[]; observations: TeamOutput[]; analyses: TeamOutput[]; recommendations: TeamOutput[];
  objections: TeamOutput[]; conflicts: TeamConflict[];
  decision: { statement: string; truthState: string; confidence: string; verified: boolean; verificationNote: string; limitations: string[]; requiresHumanApproval: boolean; proposedAction: string; evidence: string[] } | null;
  confidence: string; truthState: string; status: string; createdAt: string;
  memoryWritten: boolean; criticRejections: number; criticRan: boolean; criticFailed: boolean;
  persistence: { ok: boolean; error: string | null }; failedAgents: number;
}
interface TeamListRow {
  teamSessionId: string; task: string; trigger: string; source: string; status: string;
  participants: string[]; truthState: string; confidence: string; conflicts: number;
  criticFailed: boolean; verified: boolean; memoryWritten: boolean; createdAt: string;
}

const TRUTH_STYLE: Record<string, { label: string; cls: string }> = {
  FACT: { label: 'حقيقة', cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-700' },
  DERIVED: { label: 'استنتاج', cls: 'bg-sky-900/40 text-sky-300 border-sky-700' },
  HYPOTHESIS: { label: 'فرضية', cls: 'bg-amber-900/40 text-amber-300 border-amber-700' },
  UNKNOWN: { label: 'مجهول', cls: 'bg-slate-800 text-slate-300 border-slate-600' },
  UNAVAILABLE: { label: 'غير متاح', cls: 'bg-rose-900/40 text-rose-300 border-rose-700' },
};
const AGENT_LABEL: Record<string, string> = {
  orchestrator: 'المنسّق', research: 'البحث', analysis: 'التحليل',
  strategy: 'الاستراتيجية', critic: 'النقد', decision: 'القرار',
};

function TruthBadge({ state }: { state: string }) {
  const s = TRUTH_STYLE[state] || TRUTH_STYLE.UNKNOWN;
  return <span className={`text-[10px] px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>;
}

const OutputRow: React.FC<{ o: TeamOutput }> = ({ o }) => (
  <div className="border border-slate-800 rounded-lg p-2 bg-slate-950/40">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className="text-[11px] text-slate-400">{AGENT_LABEL[o.agentId] || o.agentId}</span>
        <TruthBadge state={o.truthState} />
        <span className="text-[10px] text-slate-500">ثقة: {o.confidence}</span>
        <span className="text-[10px] text-slate-500">عيّنة: {o.sampleSize}</span>
        {o.status === 'failed' && <span className="text-[10px] text-rose-400">تعطّل {o.error ? `(${o.error})` : ''}</span>}
      </div>
      <div className="text-xs text-slate-200 leading-relaxed">{o.statement}</div>
      {o.evidence.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {o.evidence.slice(0, 5).map((e, i) => (
            <li key={i} className="text-[10px] text-slate-400 truncate">• {e}</li>
          ))}
        </ul>
      )}
      {o.limitations && <div className="text-[10px] text-slate-500 mt-1">حدود: {o.limitations}</div>}
  </div>
);

export default function AgentTeamCenter() {
  const [list, setList] = useState<TeamListRow[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [selected, setSelected] = useState<TeamSessionFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiService.getTeamSessions();
      setList(data.sessions || []);
      setSummary(data.summary || null);
    } catch (e: any) {
      setError(e?.message || 'تعذر جلب جلسات الفريق');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openSession = useCallback(async (id: string) => {
    setError(null);
    try {
      const data = await apiService.getTeamSession(id);
      setSelected(data.session || null);
    } catch (e: any) {
      setError(e?.message || 'تعذر جلب الجلسة');
    }
  }, []);

  const runNow = useCallback(async () => {
    setRunning(true); setError(null);
    try {
      const data = await apiService.runTeamSession();
      if (data.session) setSelected(data.session);
      await load();
    } catch (e: any) {
      setError(e?.message || 'تعذر تشغيل جلسة الفريق');
    } finally {
      setRunning(false);
    }
  }, [load]);

  const outputs = (s: TeamSessionFull) => [
    ...s.observations, ...s.analyses, ...s.recommendations, ...s.objections,
  ];

  return (
    <div className="space-y-4" dir="rtl">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-100">مركز فريق الوكلاء</h2>
            <p className="text-xs text-slate-400 mt-1">
              فريق تفكير داخلي ينسّقه العقل المركزي: بحث → تحليل → استراتيجية → نقد → قرار.
              قرار مقترح فقط — لا نشر ولا رد ولا جدولة.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void load()} disabled={loading}
              className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-50">
              {loading ? 'تحديث…' : 'تحديث'}
            </button>
            <button onClick={() => void runNow()} disabled={running}
              className="px-3 py-1.5 text-xs rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white disabled:opacity-50">
              {running ? 'تشغيل…' : 'تشغيل جلسة فريق الآن'}
            </button>
          </div>
        </div>
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {[
              ['الجلسات', summary.total], ['مكتملة', summary.completed],
              ['جزئية', summary.partial], ['خلافات', summary.conflicts],
              ['غير مُتحقَّقة', summary.unverified], ['في الذاكرة', summary.memoryWritten],
            ].map(([label, value]) => (
              <div key={String(label)} className="bg-slate-950/50 border border-slate-800 rounded-lg p-2">
                <div className="text-[10px] text-slate-400">{label}</div>
                <div className="text-sm font-bold text-slate-100">{String(value ?? 0)}</div>
              </div>
            ))}
          </div>
        )}
        {error && <div className="mt-2 text-xs text-rose-300 bg-rose-900/20 border border-rose-800 rounded-lg p-2">{error}</div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 lg:col-span-1">
          <h3 className="text-sm font-bold text-slate-200 mb-2">الجلسات ({list.length})</h3>
          {list.length === 0 && <div className="text-xs text-slate-500">لا جلسات بعد. تبدأ الجلسات تلقائياً من أحداث YouTube الحقيقية.</div>}
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {list.map((s) => (
              <button key={s.teamSessionId} onClick={() => void openSession(s.teamSessionId)}
                className={`w-full text-right border rounded-lg p-2 transition-colors ${selected?.teamSessionId === s.teamSessionId ? 'border-indigo-600 bg-indigo-950/30' : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'}`}>
                <div className="flex items-center gap-1 flex-wrap mb-1">
                  <TruthBadge state={s.truthState} />
                  <span className="text-[10px] text-slate-500">{s.trigger}</span>
                  {s.criticFailed && <span className="text-[10px] text-amber-400">نقد فشل</span>}
                  {s.memoryWritten && <span className="text-[10px] text-emerald-400">✓ ذاكرة</span>}
                </div>
                <div className="text-[11px] text-slate-300 line-clamp-2">{s.task}</div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {s.status} · ثقة {s.confidence} · خلافات {s.conflicts}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 lg:col-span-2">
          {!selected && <div className="text-sm text-slate-500">اختر جلسة لعرض تفاصيلها الكاملة (الأدلة/التحليل/الخلافات/القرار).</div>}
          {selected && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-slate-100">{selected.task}</h3>
                <TruthBadge state={selected.truthState} />
                <span className="text-[10px] text-slate-500">ثقة: {selected.confidence}</span>
                <span className="text-[10px] text-slate-500">الحالة: {selected.status}</span>
                {selected.memoryWritten && <span className="text-[10px] text-emerald-400">محفوظة في الذاكرة</span>}
              </div>
              <div className="text-[10px] text-slate-500">
                الوكلاء: {selected.participants.map((p) => AGENT_LABEL[p] || p).join(' · ')}
                {selected.failedAgents > 0 && <span className="text-rose-400"> · وكلاء فشلوا: {selected.failedAgents}</span>}
              </div>

              {selected.decision && (
                <div className={`border rounded-xl p-3 ${selected.decision.verified ? 'border-emerald-800 bg-emerald-950/20' : 'border-amber-800 bg-amber-950/20'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-slate-100">القرار المقترح</span>
                    <TruthBadge state={selected.decision.truthState} />
                    <span className={`text-[10px] ${selected.decision.verified ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {selected.decision.verified ? 'مُتحقَّق من الناقد' : 'غير مُتحقَّق'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-200 leading-relaxed">{selected.decision.statement}</div>
                  <div className="text-[10px] text-slate-400 mt-1">الإجراء المقترح: {selected.decision.proposedAction}</div>
                  {selected.decision.limitations.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {selected.decision.limitations.map((l, i) => <li key={i} className="text-[10px] text-slate-500">حدّ: {l}</li>)}
                    </ul>
                  )}
                </div>
              )}

              {selected.conflicts.length > 0 && (
                <div className="border border-amber-800/60 bg-amber-950/10 rounded-xl p-3">
                  <div className="text-xs font-bold text-amber-300 mb-1">خلافات غير محسومة ({selected.conflicts.length})</div>
                  {selected.conflicts.map((c) => (
                    <div key={c.id} className="text-[11px] text-slate-300 mb-1">
                      • {c.statement} <span className="text-slate-500">({c.resolved ? 'محسوم' : 'مفتوح'})</span>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <div className="text-xs font-bold text-slate-300 mb-2">مخرجات الوكلاء ({outputs(selected).length})</div>
                <div className="space-y-2 max-h-[420px] overflow-y-auto">
                  {outputs(selected).map((o, i) => <OutputRow key={i} o={o} />)}
                </div>
              </div>

              {selected.evidence.length > 0 && (
                <div>
                  <div className="text-xs font-bold text-slate-300 mb-1">الأدلة ({selected.evidence.length})</div>
                  <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                    {selected.evidence.slice(0, 20).map((e, i) => <li key={i} className="text-[10px] text-slate-400 truncate">• {e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
