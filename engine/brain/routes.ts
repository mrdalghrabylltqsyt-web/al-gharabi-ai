/**
 * مسارات العقل المركزي (Central Brain API) — قراءة/تحليل فقط.
 *
 * كل المسارات محمية بـ`authenticateToken`. **لا يوجد أي مسار تنفيذ خارجي هنا**:
 * العقل يعرض حالته وتحليله وتوصياته، والتنفيذ يبقى في مساراته المحكومة القائمة.
 *
 * الحقن عبر `deps` يجعل الوحدة قابلة للاختبار ببيانات proof-based. البيانات
 * الحقيقية تُجمَّع في `engine/brain/runtime.ts` (بلا شبكة وبلا أسرار).
 */

import type express from 'express';
import type { PlatformId } from '../social/adapter';
import { CAPABILITY_KEYS } from './strategy/capabilityMatrix';
import { brainDiagnostics, brainIsPlatformAgnostic } from './state';
import { runDailyBrainCycle, runWeeklyBrainReview } from './cycles';
import { buildRuntimeBrain, type RuntimeBrainInput } from './runtime';
import { buildBrainDryRun } from './dryRun';
import { GOAL_LABELS_AR, type GoalKind } from './goals/goalEngine';
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
  /** يجمع مدخلات العقل الحقيقية من التطبيق (سجلات/تعليقات/ردود/نشر/اتصال/ذاكرة). */
  runtimeInput: () => Omit<RuntimeBrainInput, 'now'>;
  /** يحفظ سجلات الذاكرة الدائمة الجديدة (بلا تكرار). لا يرمي. */
  persistMemory?: (records: import('./memory/store').BrainMemoryRecord[]) => void;
  /**
   * حالة الاستراتيجية التي يملكها العقل المركزي (للقراءة). اختياري: عند غيابه
   * يُعلن صريحاً أن الحالة غير مربوطة (لا اختراع).
   */
  strategyState?: () => unknown;
  /** مزامنة حالة الاستراتيجية من الخطط الكانونية عند قراءة العقل. اختياري. */
  syncStrategyState?: () => void;
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

  /** يبني اللقطة ثم يحفظ أي سجلات ذاكرة جديدة (بلا تكرار). */
  const buildAndPersist = () => {
    const out = buildRuntimeBrain({ ...deps.runtimeInput(), now: now() });
    if (out.newMemoryRecords.length && deps.persistMemory) {
      try { deps.persistMemory(out.newMemoryRecords); } catch { /* الحفظ أفضل جهد */ }
    }
    return out;
  };

  // لقطة العقل الموحّدة (قراءة فقط).
  app.get('/api/agent/brain/state', deps.authenticateToken, (_req, res) => {
    if (deps.syncStrategyState) { try { deps.syncStrategyState(); } catch { /* أفضل جهد */ } }
    const out = buildAndPersist();
    res.json({
      success: true,
      // العقل المركزي هو السلطة الواحدة؛ الطبقات كلها قدرات داخلية تابعة.
      brainId: 'central-brain-1',
      strategyState: deps.strategyState ? deps.strategyState() : null,
      state: out.state,
      labels: brainLabels(),
      audienceNotAvailableFields: AUDIENCE_NOT_AVAILABLE_FIELDS,
      timezone: TIMING_TIMEZONE,
      platformAgnostic: brainIsPlatformAgnostic(),
      note: 'لقطة العقل المركزي للقراءة فقط: تحليل وتخطيط وتوصيات قابلة للتفسير — بلا تنفيذ خارجي وبلا أسرار.',
    });
  });

  // حالة الاستراتيجية التي يملكها العقل المركزي (للقراءة).
  app.get('/api/agent/brain/strategy-state', deps.authenticateToken, (_req, res) => {
    if (deps.syncStrategyState) { try { deps.syncStrategyState(); } catch { /* أفضل جهد */ } }
    res.json({
      success: true,
      owner: 'central-brain-1',
      strategyState: deps.strategyState ? deps.strategyState() : null,
      note: 'حالة استراتيجية واحدة يملكها العقل المركزي (إصدار + تاريخ + سبب تغيير + دليل) — ليست عقلاً استراتيجياً ثانياً. بلا سرّ.',
    });
  });

  // تشخيص العقل (صحة الذاكرة/المعرفة/الطزاجة/القرارات/حصة AI) بلا أسرار.
  app.get('/api/agent/brain/diagnostics', deps.authenticateToken, (_req, res) => {
    const out = buildAndPersist();
    const diag = brainDiagnostics(out.state);
    res.json({
      success: true,
      diagnostics: diag,
      counts: {
        recommendations: out.recommendations.length,
        supportedRecommendations: out.recommendations.filter((r) => r.status === 'supported').length,
        experiments: out.experiments.length,
        strategies: out.strategies.length,
        learningEvents: out.learningEvents.length,
        ownerPreferences: out.ownerPreferences.length,
        risks: out.risks.length,
      },
      note: 'تشخيص بلا أسرار: أعداد الحالات والتوصيات والقرارات المعلّقة.',
    });
  });

  // مصفوفة قدرات المنصات (خمس حالات صريحة).
  app.get('/api/agent/brain/capabilities', deps.authenticateToken, (_req, res) => {
    const out = buildAndPersist();
    res.json({
      success: true,
      keys: CAPABILITY_KEYS,
      rows: out.state.platformStates.map((p) => ({ platform: p.platform, states: p.capabilities, realConnector: p.realConnector })),
      labels: CAPABILITY_STATE_LABELS_AR,
      note: 'حالات القدرات من السجل؛ القدرة غير المعلنة = NOT_AVAILABLE صراحةً.',
    });
  });

  // دورة يومية تحليلية (لا تنفيذ خارجي) — على بيانات حقيقية.
  app.get('/api/agent/brain/cycles/daily', deps.authenticateToken, (_req, res) => {
    const out = buildAndPersist();
    const daily = runDailyBrainCycle({
      now: now(),
      signals: [],
      recommendations: out.recommendations,
      experiments: out.experiments,
      decisions: out.state.pendingDecisions,
      commercialOpportunities: out.state.market?.hasCommercialEvidence ? ['إشارات شراء موثّقة تستحق محتوى موجّهاً.'] : [],
    });
    res.json({ success: true, cycle: daily, note: 'دورة يومية تحليلية: لا نشر ولا رد ولا تعديل.' });
  });

  // مراجعة أسبوعية استراتيجية (لا تنفيذ خارجي) — على بيانات حقيقية.
  app.get('/api/agent/brain/cycles/weekly', deps.authenticateToken, (_req, res) => {
    const out = buildAndPersist();
    const weekly = runWeeklyBrainReview({
      experiments: out.experiments,
      recommendations: out.recommendations,
      topics: (out.state.audience?.segments || []).flatMap((s) => s.interests.map((i) => ({ topic: i, count: s.sampleSize }))),
      buyingSignals: (out.state.market?.stages || []).filter((s) => s.stage === 'BUYING_SIGNAL' && s.available).map((s) => `إشارات شراء: ${s.value}`),
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
    const input = deps.runtimeInput();
    const records = input.records.filter((r) => r.platform === platform);
    const comments = input.comments.filter((c) => c.platform === platform);
    const report = buildBrainDryRun({
      platforms: [platform],
      now: now(),
      goal: GOAL_LABELS_AR[goal] || 'مبيعات',
      records,
      comments: comments.map((c, i) => ({ platform, externalId: c.externalId || `idx-${i}`, text: String(c.text || '') })),
      timingObservations: records.filter((r) => r.publishedAt).map((r) => ({ platform, at: String(r.publishedAt), performance: Number(r.values?.views) || 0 })),
      verifiedFacts: (input.verifiedFacts || []).map((f) => f.statement),
      readOnly: true,
    });
    res.json({ success: true, report, note: 'تقرير dry-run: لا يُنفَّذ أي إجراء خارجي — يتوقف عند التوصية.' });
  });

  // مسار المحتوى الحقيقي الكامل (حاجة → تكييف المنصة) للمالك — قراءة فقط.
  app.get('/api/agent/brain/content-path', deps.requireOwner, (req, res) => {
    const platforms = deps.platforms();
    const platform = (typeof req.query.platform === 'string' && platforms.includes(req.query.platform as PlatformId)
      ? req.query.platform as PlatformId
      : platforms[0]) || 'youtube';
    const input = deps.runtimeInput();
    const commentSample = input.comments.filter((c) => c.platform === platform).length;
    const out = buildRuntimeBrain({ ...input, now: now() });
    res.json({
      success: true,
      platform,
      contentPath: out.contentPath,
      commentSample,
      note: out.contentPath
        ? 'مسار محتوى من حاجة جمهور ملاحَظة وحقائق مسجّلة فقط؛ أي عنصر بلا بيانات يُعلن غير متاح.'
        : 'لا حاجة جمهور متكرّرة بدليل كافٍ على هذه المنصة؛ لا يُخترع مسار محتوى.',
    });
  });
}
