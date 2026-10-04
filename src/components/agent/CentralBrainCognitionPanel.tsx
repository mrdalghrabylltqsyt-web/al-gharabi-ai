import React, { useCallback, useEffect, useState } from 'react';
import { apiService } from '../../services/api';

/**
 * لوحة الإدراك للعقل المركزي (Batch 7) — قراءة فقط.
 *
 * تعرض دورة العقل كاملة: الإدراك (Perception)، الذاكرة (Working + طويلة المدى)،
 * الأهداف (Goals)، الخطط (Plans)، الوكلاء (Agents)، النقد (Critic)، القرارات
 * (Decisions)، النتائج (Outcomes)، والتعلّم (Learning).
 *
 * كل رقم من الخادم؛ غير المتاح يُعلن صراحةً ولا يُخترع. لا تنفيذ خارجي ولا أسرار.
 */

interface LoopStage { stage: string; labelAr: string; count: number; available: boolean; note: string; }
interface LearningLoop {
  stages: LoopStage[];
  followUp: { baselined: number; observed: number; engagementChanged: number; noChange: number; lastChanged: any };
  memory: { total: number; lessonDerived: number; recent: Array<{ key: string; kind: string; source: string; summary: string }> };
  note: string;
}
interface ReportRow {
  cycleId: string; eventIdentity: string; platform: string; status: string;
  currentObjective: string; currentGoal: string; nextAction: string; decisionStatus: string;
  escalationState: string; memoryUsed: number; agentsConsulted: number; phases: number;
}

const Card: React.FC<{ title: string; children: React.ReactNode; hint?: string }> = ({ title, children, hint }) => (
  <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
    <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-3 mb-4">{title}</h3>
    {children}
    {hint ? <p className="text-[11px] text-slate-500 mt-3">{hint}</p> : null}
  </div>
);

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
    <div className="text-[10px] text-slate-500">{label}</div>
    <div className="text-lg font-black text-white mt-0.5">{value}</div>
  </div>
);

const STAGE_LABELS: Record<string, string> = {
  ACTION: 'الإجراء', RESULT: 'النتيجة', FOLLOW_UP: 'تفاعل المتابعة',
  LESSON: 'الدرس', MEMORY: 'الذاكرة', FUTURE_DECISION: 'القرار المستقبلي',
};

/** قدرات العقل المركزي الداخلية — مكوّنات تحت عقل واحد، لا عقول مستقلة. */
const CAPABILITIES: Array<{ key: string; label: string }> = [
  { key: 'understand', label: 'الفهم' },
  { key: 'memory', label: 'الذاكرة' },
  { key: 'reason', label: 'الاستدلال' },
  { key: 'goals', label: 'الأهداف' },
  { key: 'planning', label: 'التخطيط' },
  { key: 'agents', label: 'الوكلاء (استشاريون)' },
  { key: 'critic', label: 'الناقد (يتحدّى)' },
  { key: 'decision', label: 'القرار (سلطة واحدة)' },
  { key: 'outcomes', label: 'النتائج' },
  { key: 'learning', label: 'التعلّم' },
  { key: 'strategy', label: 'الاستراتيجية' },
];

export const CentralBrainCognitionPanel: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [cognition, setCognition] = useState<any>(null);
  const [loop, setLoop] = useState<LearningLoop | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [strategy, setStrategy] = useState<any>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [cog, lp, rep, strat, led] = await Promise.all([
        apiService.getCognitionState().catch(() => null),
        apiService.getCognitionLearningLoop().catch(() => null),
        apiService.getCognitionReports().catch(() => null),
        apiService.getBrainStrategyState().catch(() => null),
        apiService.getCognitionDecisionLedger().catch(() => null),
      ]);
      setCognition(cog);
      setLoop(lp?.learningLoop || null);
      setReports(rep?.reports || []);
      setStrategy(strat?.strategyState || null);
      setLedger(led || null);
    } catch (e: any) {
      setError(e?.message || 'تعذر تحميل لوحة الإدراك.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const latest = reports[0] || null;
  const wm = cognition?.workingMemory || null;
  const memory = loop?.memory || null;
  const stages = loop?.stages || [];

  return (
    <div className="space-y-5">
      <header className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-black text-white">العقل المركزي ١ — CENTRAL BRAIN 1</h1>
          <p className="text-xs text-slate-400 mt-1.5">
            عقل واحد هو السلطة الوحيدة للقرار. ما يلي <span className="text-slate-200 font-bold">قدرات داخلية</span> تحت العقل نفسه
            (لا عقول مستقلة): فهم → ذاكرة → استدلال → مشورة الوكلاء الستة → نقد → قرار محكوم → إجراء → ملاحظة → تعلّم → عودة للعقل.
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            الوكلاء الستة (Orchestrator/Research/Analysis/Strategy/Critic/Decision) <span className="text-slate-300">مستشارون فقط</span> — لا يملكون قراراً ولا تنفيذاً.
            قراءة فقط — لا تنفيذ خارجي، ولا استهلاك AI، ولا اختراع بيانات.
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold hover:bg-slate-700 disabled:opacity-50">
          {loading ? '... جارٍ التحديث' : 'تحديث'}
        </button>
      </header>

      {error ? <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-200 text-xs">{error}</div> : null}

      {/* 0) قدرات العقل المركزي الداخلية (تحت عقل واحد) */}
      <Card title="قدرات العقل المركزي (مكوّنات تحت عقل واحد)"
        hint="هذه ليست عقولاً مستقلة — بل قدرات داخلية يعملها العقل المركزي الواحد. القرار لسلطة واحدة فقط.">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {CAPABILITIES.map((c) => (
            <div key={c.key} className={`p-3 rounded-xl border text-center ${c.key === 'decision' ? 'bg-emerald-950/30 border-emerald-800' : 'bg-slate-950 border-slate-800'}`}>
              <div className="text-[11px] font-bold text-slate-200">{c.label}</div>
              <div className={`text-[10px] mt-1 ${c.key === 'agents' || c.key === 'critic' ? 'text-amber-400' : c.key === 'decision' ? 'text-emerald-400' : 'text-slate-500'}`}>
                {c.key === 'decision' ? 'سلطة واحدة' : (c.key === 'agents' || c.key === 'critic' ? 'استشاري' : 'قدرة داخلية')}
              </div>
            </div>
          ))}
        </div>
        {cognition?.brainAuthority ? (
          <p className="text-[11px] text-slate-500 mt-3">
            سلطة القرار: {cognition.brainAuthority.decisionAuthorityProducer} • عدد سلطات القرار: {cognition.brainAuthority.decisionAuthorityCount} •
            الإدراك عقل ثانٍ؟ {String(cognition.brainAuthority.cognition?.isSecondBrain)} • تنفيذ خارجي من العقل؟ {String(cognition.brainAuthority.externalExecutionFromBrain)}
          </p>
        ) : null}
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="دورات إدراكية" value={cognition?.reportCount ?? reports.length} />
        <Stat label="عناصر الذاكرة العاملة" value={wm?.total ?? 0} />
        <Stat label="سجلات الذاكرة طويلة المدى" value={memory?.total ?? 0} />
        <Stat label="دروس مستخلَصة" value={memory?.lessonDerived ?? 0} />
      </div>

      {/* 0ب) الاستراتيجية + سجل قرار→نتيجة (يملكهما العقل المركزي) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="الاستراتيجية (حالة يملكها العقل المركزي)" hint="إصدار + تاريخ + سبب تغيير + دليل. ليست عقلاً استراتيجياً ثانياً.">
          {strategy ? (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Stat label="الإصدار الحالي" value={strategy.currentVersion ?? 0} />
              <Stat label="خطط الاستراتيجية" value={strategy.currentScopeCount ?? 0} />
              <Stat label="الثقة" value={strategy.confidence ?? '—'} />
              <Stat label="الإصدارات السابقة" value={strategy.historyCount ?? 0} />
              <div className="col-span-2 text-slate-400">آخر سبب تغيير: <span className="text-slate-200">{strategy.lastReasonLabelAr || '—'}</span></div>
              <div className="col-span-2 text-slate-500">آخر تحديث: {strategy.lastUpdatedAt ? new Date(strategy.lastUpdatedAt).toLocaleString('ar-IQ') : '—'}</div>
            </div>
          ) : <p className="text-xs text-slate-500">لا حالة استراتيجية بعد — تُبنى من الخطط الكانونية للعقل.</p>}
        </Card>

        <Card title="سجل قرار→نتيجة (Decision → Outcome)" hint="قرار واحد ⇒ نتيجة ملاحَظة ⇒ درس ⇒ ذاكرة ⇒ قرار مستقبلي. غير المتاح معلن لا مخترع.">
          {ledger?.summary ? (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Stat label="قرارات مسجّلة" value={ledger.summary.total ?? 0} />
              <Stat label="نتائج متاحة" value={ledger.summary.withOutcome ?? 0} />
              <Stat label="نتائج غير متاحة" value={ledger.summary.unavailable ?? 0} />
              <Stat label="مرتبطة بدروس" value={ledger.summary.withLesson ?? 0} />
            </div>
          ) : <p className="text-xs text-slate-500">لا سجل بعد — يُكتب عند أول قرار مركزي حقيقي.</p>}
          {Array.isArray(ledger?.entries) && ledger.entries.length ? (
            <ul className="mt-3 space-y-2 text-[11px]">
              {ledger.entries.slice(0, 5).map((e: any) => (
                <li key={e.decisionId} className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="text-slate-300">{e.actionText || '—'}</div>
                  <div className="text-slate-500 mt-1">{e.platform} • {e.finalStatus} • النتيجة: {e.outcome?.availability === 'available' ? e.outcome.kind : 'غير متاحة'}</div>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>

      {/* 1) الإدراك + الذاكرة العاملة */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="الإدراك والذاكرة العاملة" hint="الذاكرة العاملة قصيرة المدى؛ تُحفظ العناصر النشطة فقط بلا تفكير داخلي خاص.">
          {wm ? (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Stat label="إجمالي" value={wm.total ?? 0} />
              <Stat label="نشطة" value={wm.active ?? wm.activeCount ?? 0} />
              <Stat label="الأهداف المتابَعة" value={wm.goals ?? 0} />
              <Stat label="المواضيع" value={wm.topics ?? 0} />
              <Stat label="آخر تحديث" value={wm.lastTouchedAt ? new Date(wm.lastTouchedAt).toLocaleString('ar-IQ') : '—'} />
              <Stat label="حد السعة" value={wm.capacity ?? '—'} />
            </div>
          ) : <p className="text-xs text-slate-500">لا حالة ذاكرة عاملة بعد.</p>}
          {cognition?.labels?.loop ? (
            <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">{cognition.labels.loop}</p>
          ) : null}
        </Card>

        <Card title="الأهداف والخطة (آخر دورة)" hint="من تقرير دورة إدراكية حقيقي؛ لا يُخترع هدف.">
          {latest ? (
            <div className="text-xs space-y-2">
              <div className="text-slate-300">الهدف الحالي: <span className="text-white font-bold">{latest.currentGoal || '—'}</span></div>
              <div className="text-slate-300">الإجراء التالي: <span className="text-white font-bold">{latest.nextAction || '—'}</span></div>
              <div className="text-slate-400">الهدف التشغيلي: {latest.currentObjective || '—'}</div>
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300">المنصة: {latest.platform}</span>
                <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300">الحالة: {latest.status}</span>
                <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300">القرار: {latest.decisionStatus}</span>
                <span className={`px-2 py-0.5 rounded-lg ${latest.escalationState === 'required' ? 'bg-amber-900/40 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>تصعيد: {latest.escalationState}</span>
              </div>
            </div>
          ) : <p className="text-xs text-slate-500">لا دورات إدراكية بعد — تُنشأ من أحداث حقيقية (تعليق YouTube مثلاً).</p>}
        </Card>
      </div>

      {/* 2) حلقة التعلّم الكاملة */}
      <Card title="حلقة التعلّم: ACTION → RESULT → FOLLOW-UP → LESSON → MEMORY → FUTURE DECISION"
        hint="كل رقم من سجلات فعلية. لا تُخترع نتيجة، وغير المتاح يظهر صفراً صادقاً — بلا ادعاء بيع.">
        {stages.length ? (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {stages.map((s) => (
              <div key={s.stage} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center">
                <div className="text-[10px] text-slate-500">{STAGE_LABELS[s.stage] || s.stage}</div>
                <div className={`text-xl font-black mt-1 ${s.count > 0 ? 'text-emerald-300' : 'text-slate-600'}`}>{s.count}</div>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-slate-500">حلقة التعلّم غير متاحة.</p>}
        {loop?.followUp ? (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Stat label="بصمات مثبّتة" value={loop.followUp.baselined} />
            <Stat label="نتائج ملاحَظة" value={loop.followUp.observed} />
            <Stat label="تفاعل متغيّر" value={loop.followUp.engagementChanged} />
            <Stat label="بلا تغيّر" value={loop.followUp.noChange} />
          </div>
        ) : null}
        {loop?.note ? <p className="text-[11px] text-slate-500 mt-3">{loop.note}</p> : null}
      </Card>

      {/* 3) الذاكرة طويلة المدى + التعلّم */}
      <Card title="الذاكرة طويلة المدى (دروس حقيقية)" hint="الدروس المخزّنة بادئتها lesson: — أصلها من نتائج ملاحَظة، لا من قول AI.">
        {memory?.recent?.length ? (
          <ul className="space-y-2 text-xs">
            {memory.recent.slice().reverse().map((m) => (
              <li key={m.key} className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-slate-200">{m.summary}</div>
                <div className="text-[10px] text-slate-500 mt-1">المصدر: {m.source || '—'} • النوع: {m.kind}</div>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-slate-500">لا دروس محفوظة بعد — تُكتب عند تغيّر تفاعل حقيقي على رد مُسلَّم.</p>}
      </Card>

      {/* 4) آخر الدورات الإدراكية */}
      <Card title="آخر الدورات الإدراكية" hint="تقارير مختصرة؛ التفاصيل الكاملة عبر مسار التقرير الواحد.">
        {reports.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-slate-500 text-right">
                  <th className="p-2">الحدث</th>
                  <th className="p-2">المنصة</th>
                  <th className="p-2">الحالة</th>
                  <th className="p-2">القرار</th>
                  <th className="p-2">الهدف</th>
                  <th className="p-2">وكلاء</th>
                  <th className="p-2">ذاكرة</th>
                </tr>
              </thead>
              <tbody>
                {reports.slice(0, 12).map((r) => (
                  <tr key={r.cycleId} className="border-t border-slate-800 text-slate-300">
                    <td className="p-2 font-mono text-[10px]">{r.eventIdentity}</td>
                    <td className="p-2">{r.platform}</td>
                    <td className="p-2">{r.status}</td>
                    <td className="p-2">{r.decisionStatus}</td>
                    <td className="p-2">{r.currentGoal || '—'}</td>
                    <td className="p-2">{r.agentsConsulted}</td>
                    <td className="p-2">{r.memoryUsed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-xs text-slate-500">لا دورات بعد.</p>}
      </Card>
    </div>
  );
};

export default CentralBrainCognitionPanel;
