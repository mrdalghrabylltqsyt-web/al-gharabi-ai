/**
 * Cognitive Routes — مسارات قراءة/تحليل للعقل الإدراكي (Batch 7، بلا تنفيذ خارجي).
 *
 * كل المسارات محمية بـ`authenticateToken`. **لا مسار كتابة ولا تنفيذ**: العقل يعرض
 * حالته الإدراكية وتقريراته وتشخيصه، والتنفيذ يبقى في مساراته المحكومة القائمة.
 *
 * الحقن عبر `deps` يجعل الوحدة قابلة للاختبار ببيانات proof-based.
 */

import type express from 'express';
import { COGNITIVE_PHASES, COGNITIVE_PHASE_LABELS_AR } from './types';
import { summarizeWorkingMemory } from './workingMemory';
import { recallNeedsFullStore } from './memoryRecall';
import { learningIsNonSelfModifying } from './outcomeLearning';
import type { WorkingMemoryState } from './workingMemory';
import type { CognitiveReport } from './cognitiveLoop';

export interface CognitionRoutesDeps {
  authenticateToken: express.RequestHandler;
  requireOwner: express.RequestHandler;
  /** تقارير الدورات الإدراكية المحفوظة (أحدث أولاً). */
  reports: () => CognitiveReport[];
  /** تقرير واحد بالمعرّف (جلسة/دورة). */
  reportById: (id: string) => CognitiveReport | null;
  /** الذاكرة العاملة الحالية. */
  workingMemory: () => WorkingMemoryState;
  /**
   * حلقة التعلّم الكاملة (ACTION→RESULT→FOLLOW-UP→LESSON→MEMORY→FUTURE) من
   * سجلات حقيقية. اختيارية: عند غيابها تُعلن المراحل غير متاحة (لا اختراع).
   */
  learningLoop?: () => LearningLoopView;
  /** عقد السلطة الواحدة (العقل المركزي = سلطة واحدة؛ الإدراك تابع). اختياري. */
  brainAuthority?: () => unknown;
  /** ملخّص سجل قرار→نتيجة (يملكه العقل المركزي). اختياري. */
  decisionLedgerSummary?: () => unknown;
  /** أحدث سجلات قرار→نتيجة (للعرض). اختياري. */
  decisionLedgerEntries?: (limit: number) => unknown[];
  /** الزمن الحالي (قابل للاختبار). */
  now?: () => number;
}

export interface LearningLoopStage {
  stage: string;
  labelAr: string;
  count: number;
  available: boolean;
  note: string;
}

export interface LearningLoopView {
  stages: LearningLoopStage[];
  followUp: { baselined: number; observed: number; engagementChanged: number; noChange: number; lastChanged: unknown | null };
  memory: { total: number; lessonDerived: number; recent: Array<{ key: string; kind: string; source: string; summary: string }> };
  note: string;
}

const LEARNING_LOOP_LABELS_AR: Record<string, string> = {
  ACTION: 'الإجراء (رد حقيقي)',
  RESULT: 'النتيجة (تسليم بمعرّف مزوّد)',
  FOLLOW_UP: 'تفاعل المتابعة (إعجاب/ردود)',
  LESSON: 'الدرس المستخلَص',
  MEMORY: 'الذاكرة طويلة المدى',
  FUTURE_DECISION: 'القرار المستقبلي',
};

/** وصف الطبقة الإدراكية (ثوابت معلنة) — بلا سرّ. */
export function cognitionLabels() {
  return {
    phases: COGNITIVE_PHASE_LABELS_AR,
    phaseOrder: COGNITIVE_PHASES,
    loop: 'PERCEIVE → UNDERSTAND → REMEMBER → REASON → CONSULT → PLAN → CRITIQUE → DECIDE → ACT → OBSERVE → LEARN',
    memoryRecall: recallNeedsFullStore().reason,
    learning: learningIsNonSelfModifying().reason,
  };
}

export function registerCognitionRoutes(app: express.Express, deps: CognitionRoutesDeps): void {
  const now = deps.now || (() => Date.now());

  // حالة الذاكرة العاملة + وصف الطبقة (للمالك: تفاصيل تشغيلية بلا سرّ).
  app.get('/api/agent/brain/cognition', deps.authenticateToken, deps.requireOwner, (_req, res) => {
    const wm = deps.workingMemory();
    res.json({
      success: true,
      // الإدراك **قدرة داخلية** تابعة للعقل المركزي (سلطة القرار الواحدة).
      subordinateTo: 'central-brain-1',
      independentDecisionAuthority: false,
      brainAuthority: deps.brainAuthority ? deps.brainAuthority() : null,
      workingMemory: summarizeWorkingMemory(wm, now()),
      labels: cognitionLabels(),
      reportCount: deps.reports().length,
      decisionLedger: deps.decisionLedgerSummary ? deps.decisionLedgerSummary() : null,
      note: 'الإدراك قدرة داخلية للعقل المركزي (فهم/ذاكرة/استدلال/تخطيط/تعلّم) — لا عقل ثانٍ ولا سلطة قرار، وبلا تنفيذ خارجي وبلا أسرار.',
    });
  });

  // سجل قرار→نتيجة (يملكه العقل المركزي) — للمالك.
  app.get('/api/agent/brain/cognition/decision-ledger', deps.authenticateToken, deps.requireOwner, (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    res.json({
      success: true,
      summary: deps.decisionLedgerSummary ? deps.decisionLedgerSummary() : null,
      entries: deps.decisionLedgerEntries ? deps.decisionLedgerEntries(limit) : [],
      note: 'سجل قرار→نتيجة واحد يملكه العقل المركزي؛ النتيجة غير المتاحة معلنة لا مخترعة. بلا أي سرّ.',
    });
  });

  // أحدث تقارير الدورات الإدراكية (مختصرة) — للمالك.
  app.get('/api/agent/brain/cognition/reports', deps.authenticateToken, deps.requireOwner, (_req, res) => {
    const reports = deps.reports();
    res.json({
      success: true,
      count: reports.length,
      reports: reports.slice(-25).reverse().map((r) => ({
        cycleId: r.cycleId,
        eventIdentity: r.eventIdentity,
        platform: r.platform,
        status: r.status,
        currentObjective: r.observability.currentObjective,
        currentGoal: r.goalPlan.currentGoal.labelAr,
        nextAction: r.nextAction.labelAr,
        decisionStatus: r.decisionStatus,
        escalationState: r.observability.escalationState,
        memoryUsed: r.observability.memoryUsed,
        agentsConsulted: r.observability.agentsConsulted.length,
        phases: r.phases.length,
      })),
      note: 'تقارير الدورات الإدراكية: تحليل وتخطيط فقط — بلا تنفيذ خارجي.',
    });
  });

  // حلقة التعلّم الكاملة (ACTION→RESULT→FOLLOW-UP→LESSON→MEMORY→FUTURE) — للمالك.
  app.get('/api/agent/brain/cognition/learning-loop', deps.authenticateToken, deps.requireOwner, (_req, res) => {
    if (!deps.learningLoop) {
      res.json({ success: true, learningLoop: null, note: 'حلقة التعلّم غير مربوطة في هذه البيئة — لا اختراع.' });
      return;
    }
    const loop = deps.learningLoop();
    const stages = (loop.stages || []).map((s) => ({ ...s, labelAr: s.labelAr || LEARNING_LOOP_LABELS_AR[s.stage] || s.stage }));
    res.json({
      success: true,
      learningLoop: { ...loop, stages },
      labels: LEARNING_LOOP_LABELS_AR,
      note: 'حلقة التعلّم من سجلات حقيقية: لا تُخترع نتيجة، وغير المتاح يُعلن صراحةً. بلا أي سرّ.',
    });
  });

  // تقرير دورة واحدة كامل (بالـcycleId أو معرّف الجلسة).
  app.get('/api/agent/brain/cognition/reports/:id', deps.authenticateToken, deps.requireOwner, (req, res) => {
    const report = deps.reportById(req.params.id);
    if (!report) {
      res.status(404).json({ success: false, error: 'تقرير دورة إدراكية غير موجود.' });
      return;
    }
    res.json({ success: true, report, note: 'تقرير كامل بلا سرّ؛ يشمل الحالات والحدود بلا تفكير داخلي خاص.' });
  });
}
