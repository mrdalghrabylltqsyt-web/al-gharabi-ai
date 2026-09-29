/**
 * مسارات العقل المركزي (Central Brain API) — قراءة/تحليل فقط.
 *
 * كل المسارات محمية بـ`authenticateToken`. **لا يوجد أي مسار تنفيذ خارجي هنا**:
 * العقل يعرض حالته وتحليله وتوصياته، والتنفيذ يبقى في مساراته المحكومة القائمة.
 *
 * لا تُعاد أي أسرار: المخرجات كلها أعداد/نصوص تحليلية، والأسرار محجوبة من
 * المصدر (لا تُمرَّر أصلاً إلى العقل).
 *
 * الحقن عبر `deps` يجعل الوحدة قابلة للاختبار ببيانات proof-based.
 */

import type express from 'express';
import type { PlatformId } from '../social/adapter';
import type { PlatformMetricRecord } from '../social/platformLearning';
import { capabilityMatrix, CAPABILITY_KEYS } from './strategy/capabilityMatrix';
import { buildCentralBrainState, brainDiagnostics, brainIsPlatformAgnostic, type BuildCentralBrainStateInput } from './state';
import { runDailyBrainCycle, runWeeklyBrainReview } from './cycles';
import { buildBrainDryRun } from './dryRun';
import { defineGoal, GOAL_LABELS_AR, type GoalKind } from './goals/goalEngine';
import { AUDIENCE_NOT_AVAILABLE_FIELDS } from './audience/audienceModel';
import { AUTONOMY_LABELS_AR, DECISION_KIND_LABELS_AR } from './decisions/decisionEngine';
import { TRUTH_STATE_LABELS_AR } from './knowledge/truth';
import { MEMORY_KIND_LABELS_AR } from './memory/longTerm';
import { CAPABILITY_STATE_LABELS_AR } from './strategy/capabilityMatrix';
import { TIMING_TIMEZONE } from './timing/timingModel';

export interface BrainRoutesDeps {
  authenticateToken: express.RequestHandler;
  requireOwner: express.RequestHandler;
  /** المنصات المعروفة في النظام. */
  platforms: () => PlatformId[];
  /** سجلات أداء حقيقية للعقل (تُقرأ فقط). */
  performanceRecords: () => PlatformMetricRecord[];
  /** تعليقات حقيقية لكل منصة (تُقرأ فقط). */
  commentsByPlatform: () => any;
  /** اتصال تشغيلي حقيقي لكل منصة (من الخادم؛ لا يُدَّعى). */
  liveConnections: () => BuildCentralBrainStateInput['liveConnections'];
  /** عدّادات حماية Gemini الحالية (بلا أسرار). */
  aiCounters: () => BuildCentralBrainStateInput['aiCounters'];
  /** الحقائق التجارية المسجّلة (نصوص فقط، بلا اختراع). */
  verifiedFacts?: () => string[];
  now?: () => number;
}

/** وصف الحالات بالعربية للعرض (بلا أي قيمة سرّية). */
export function brainLabels() {
  return {
    truthStates: TRUTH_STATE_LABELS_AR,
    memoryKinds: MEMORY_KIND_LABELS_AR,
    capabilityStates: CAPABILITY_STATE_LABELS_AR,
    autonomyLevels: AUTONOMY_LABELS_AR,
    decisionKinds: DECISION_KIND_LABELS_AR,
    goals: GOAL_LABELS_AR,
  };
}

export function registerBrainRoutes(app: express.Express, deps: BrainRoutesDeps): void {
  const now = deps.now || (() => Date.now());

  const buildState = () => buildCentralBrainState({
    platforms: deps.platforms(),
    now: now(),
    goals: defineGoal({ primary: 'SALES', secondary: 'TRUST' }),
    records: deps.performanceRecords(),
    commentsByPlatform: deps.commentsByPlatform(),
    liveConnections: deps.liveConnections(),
    aiCounters: deps.aiCounters(),
  });

  // لقطة العقل الموحّدة (قراءة فقط).
  app.get('/api/agent/brain/state', deps.authenticateToken, (_req, res) => {
    const state = buildState();
    res.json({
      success: true,
      state,
      labels: brainLabels(),
      audienceNotAvailableFields: AUDIENCE_NOT_AVAILABLE_FIELDS,
      timezone: TIMING_TIMEZONE,
      platformAgnostic: brainIsPlatformAgnostic(),
      note: 'لقطة العقل المركزي للقراءة فقط: تحليل وتخطيط وتوصيات قابلة للتفسير — بلا تنفيذ خارجي وبلا أسرار.',
    });
  });

  // تشخيص العقل (صحة الذاكرة/المعرفة/الطزاجة/القرارات/حصة AI) بلا أسرار.
  app.get('/api/agent/brain/diagnostics', deps.authenticateToken, (_req, res) => {
    const state = buildState();
    res.json({ success: true, diagnostics: brainDiagnostics(state), note: 'تشخيص بلا أسرار.' });
  });

  // مصفوفة قدرات المنصات (خمس حالات صريحة).
  app.get('/api/agent/brain/capabilities', deps.authenticateToken, (_req, res) => {
    res.json({
      success: true,
      keys: CAPABILITY_KEYS,
      rows: capabilityMatrix(deps.platforms()),
      labels: CAPABILITY_STATE_LABELS_AR,
      note: 'حالات القدرات من السجل؛ القدرة غير المعلنة = NOT_AVAILABLE صراحةً.',
    });
  });

  // دورة يومية تحليلية (لا تنفيذ خارجي).
  app.get('/api/agent/brain/cycles/daily', deps.authenticateToken, (_req, res) => {
    const state = buildState();
    const daily = runDailyBrainCycle({
      now: now(),
      signals: [],
      recommendations: state.recommendations,
      experiments: [],
      decisions: state.pendingDecisions,
      commercialOpportunities: state.market?.hasCommercialEvidence ? ['إشارات شراء موثّقة تستحق محتوى موجّهاً.'] : [],
    });
    res.json({ success: true, cycle: daily, note: 'دورة يومية تحليلية: لا نشر ولا رد ولا تعديل.' });
  });

  // مراجعة أسبوعية استراتيجية (لا تنفيذ خارجي).
  app.get('/api/agent/brain/cycles/weekly', deps.authenticateToken, (_req, res) => {
    const state = buildState();
    const weekly = runWeeklyBrainReview({
      experiments: [],
      recommendations: state.recommendations,
      topics: (state.audience?.segments || []).flatMap((s) => s.interests.map((i) => ({ topic: i, count: s.sampleSize }))),
      buyingSignals: (state.market?.stages || []).filter((s) => s.stage === 'BUYING_SIGNAL' && s.available).map((s) => `إشارات شراء: ${s.value}`),
      platforms: deps.platforms(),
    });
    res.json({ success: true, review: weekly, note: 'مراجعة أسبوعية صادقة: المجهول معلن.' });
  });

  // سيناريو dry-run: يتوقف قبل أي إجراء خارجي (للمالك فقط لأنه قد يقرأ بيانات فعلية).
  app.get('/api/agent/brain/dry-run', deps.requireOwner, (req, res) => {
    const platforms = deps.platforms();
    const platform = (typeof req.query.platform === 'string' && platforms.includes(req.query.platform as PlatformId)
      ? req.query.platform as PlatformId
      : platforms[0]) || 'youtube';
    const goal = (typeof req.query.goal === 'string' ? req.query.goal : 'SALES') as GoalKind;
    const report = buildBrainDryRun({
      platforms: [platform],
      now: now(),
      goal: GOAL_LABELS_AR[goal] || 'مبيعات',
      records: deps.performanceRecords().filter((r: any) => r.platform === platform),
      comments: (deps.commentsByPlatform()?.[platform] || []).map((c: any, i: number) => ({ platform, externalId: c.externalId || `idx-${i}`, text: String(c.text || '') })),
      verifiedFacts: deps.verifiedFacts ? deps.verifiedFacts() : [],
      readOnly: true,
    });
    res.json({ success: true, report, note: 'تقرير dry-run: لا يُنفَّذ أي إجراء خارجي — يتوقف عند التوصية.' });
  });
}
