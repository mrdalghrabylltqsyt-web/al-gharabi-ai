/**
 * Team Orchestrator — منسّق فريق الوكلاء (منطق خالص قابل للاختبار).
 *
 * العقل المركزي يبقى المنسّق الأعلى: يستقبل مهمة (من حدث YouTube حقيقي أو طلب
 * المالك)، يحدّد الوكلاء المطلوبين، يمنع العمل المكرر، يجمع المخرجات، ويربطها
 * بذاكرة العقل القائمة. **لا تنفيذ خارجي** ولا استدعاء AI بلا داعٍ (المنطق حتمي).
 *
 * الصمود: فشل وكيل لا يُسقط الجلسة؛ تُسجَّل حالته ويستمر المنسّق بباقي المخرجات.
 * وفشل الناقد يجعل القرار **غير مُتحقَّق** صراحةً — لا ادّعاء تحقق كاذب.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import type { PlatformId } from '../../social/adapter';
import { toMemoryRecord, type BrainMemoryRecord } from '../memory/store';
import { makeMemoryEntry } from '../memory/longTerm';
import {
  TEAM_AGENT_LABELS_AR, TEAM_SESSION_MAX, type TeamAgentId, type TeamAgentOutput,
  type TeamConflict, type TeamSession, type TeamSessionState,
} from './types';
import {
  analysisAgent, criticAgent, decisionAgent, researchAgent, strategyAgent,
  platformsInTask, type TeamContext,
} from './agents';
import { type Confidence, type TeamTruthState } from './truth';

/**
 * يحدّد الوكلاء المطلوبين للمهمة (حتمي). المنسّق والقرار دائمان؛ البحث والتحليل
 * والاستراتيجية والنقد يُحدَّدون حسب طبيعة المهمة (يمنع العمل المكرر غير اللازم).
 */
export function decideRequiredAgents(task: string, opts: { criticEnabled?: boolean } = {}): TeamAgentId[] {
  const t = task.toLowerCase();
  const participants: TeamAgentId[] = ['orchestrator', 'research', 'analysis'];
  // مهام تحليلية صرفة قد تتخطّى الاستراتيجية.
  const analysisOnly = /(حلّل|حلل|تحليل|فسّر|اشرح الوضع|راجع)/.test(t) && !/(نشر|رد|حملة|توصية|خطة|استراتيج)/.test(t);
  if (!analysisOnly) participants.push('strategy');
  if (opts.criticEnabled !== false) participants.push('critic');
  participants.push('decision');
  return participants;
}

/** مفتاح منع التكرار المشتق من هوية الحدث الحقيقي + المهمة (بلا اختراع). */
export function teamDedupeKey(input: { task: string; platform: string; eventIdentity: string }): string {
  const norm = (s: string) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
  return `team:${norm(input.platform)}:${norm(input.eventIdentity)}:${norm(input.task)}`;
}

/** هل توجد جلسة مكتملة بنفس مفتاح منع التكرار؟ (لا جلسة مكررة لنفس الحدث). */
export function findSessionByDedupeKey(state: TeamSessionState, dedupeKey: string): TeamSession | null {
  return state.sessions.find((s) => s.dedupeKey === dedupeKey) || null;
}

export interface TeamRunOptions {
  trigger: TeamSession['trigger'];
  platform: PlatformId;
  /** هوية الحدث الحقيقي (معرّف تعليق/فيديو) لمنع التكرار. */
  eventIdentity: string;
  /** يمنع استدعاء النقد (يُستخدم لاختبار فشل الناقد). */
  criticEnabled?: boolean;
  /** حقن فشل وكيل لأغراض الاختبار (لا يُستخدم في الإنتاج). */
  failAgent?: (agentId: TeamAgentId) => boolean;
  /** جلسة سابقة بنفس المفتاح: تُعاد بلا عمل مكرر (idempotency). */
  existing?: TeamSession | null;
  now: number;
}

/** يبني مخرجاً موسوماً بالفشل عند تعطّل وكيل (بلا اختراع مخرجات). */
function failedOutput(agentId: TeamAgentId, at: string, error: string): TeamAgentOutput {
  return {
    agentId,
    status: 'failed',
    kind: agentId === 'strategy' ? 'recommendation' : agentId === 'critic' ? 'objection' : 'analysis',
    truthState: 'UNKNOWN',
    statement: `تعطّل ${TEAM_AGENT_LABELS_AR[agentId]}؛ لم يُنتج مخرجات — لا يُخترع بديل.`,
    evidence: [],
    source: 'orchestrator',
    sampleSize: 0,
    confidence: 'low',
    limitations: 'فشل الوكيل مسجَّل؛ المخرجات المفقودة لا تُقدَّر.',
    provenance: 'deterministic',
    at,
    error,
  };
}

/**
 * يشغّل جلسة فريق كاملة على السياق الحقيقي. لا يرمي: يلتقط فشل كل وكيل على حدة،
 * ويعيد جلسة بحالة صادقة. لا ينفّذ أي إجراء خارجي.
 */
export function runTeamSession(ctx: TeamContext, options: TeamRunOptions): TeamSession {
  const at = new Date(options.now).toISOString();
  const dedupeKey = teamDedupeKey({ task: ctx.task, platform: options.platform, eventIdentity: options.eventIdentity });

  // منع التكرار: نفس الحدث/المهمة => لا عمل مكرر (تُعاد الجلسة السابقة كما هي).
  if (options.existing && options.existing.dedupeKey === dedupeKey) {
    return options.existing;
  }

  const participants = decideRequiredAgents(ctx.task, { criticEnabled: options.criticEnabled });
  const fail = options.failAgent || (() => false);
  const observations: TeamAgentOutput[] = [];
  const analyses: TeamAgentOutput[] = [];
  const recommendations: TeamAgentOutput[] = [];
  let objections: TeamAgentOutput[] = [];
  let conflicts: TeamConflict[] = [];
  let failedAgents = 0;

  const safe = <T>(agentId: TeamAgentId, fn: () => T, fallback: () => T): T => {
    if (fail(agentId)) { failedAgents += 1; return fallback(); }
    try { return fn(); } catch { failedAgents += 1; return fallback(); }
  };

  // 1) البحث.
  const research = safe(
    'research',
    () => researchAgent(ctx).outputs,
    () => [failedOutput('research', at, 'agent_failed')],
  );
  observations.push(...research);

  // 2) التحليل (يعتمد على أدلة البحث).
  const analysis = safe(
    'analysis',
    () => analysisAgent(ctx, research.filter((o) => o.status === 'ran')),
    () => [failedOutput('analysis', at, 'agent_failed')],
  );
  analyses.push(...analysis);

  // 3) الاستراتيجية (تُدرج فقط إن طُلبت).
  if (participants.includes('strategy')) {
    const strategy = safe(
      'strategy',
      () => strategyAgent(ctx, analysis.filter((o) => o.status === 'ran')),
      () => [failedOutput('strategy', at, 'agent_failed')],
    );
    recommendations.push(...strategy);
  }

  // 4) النقد/التحقق.
  const allForCritic = [...observations, ...analyses, ...recommendations];
  let criticRan = false;
  let criticFailed = false;
  let rejected = 0;
  if (participants.includes('critic')) {
    const criticResult = safe(
      'critic',
      () => {
        const out = criticAgent(ctx, allForCritic);
        return out;
      },
      () => ({ objections: [failedOutput('critic', at, 'critic_failed')], conflicts: [], rejected: 0, criticFailed: true }),
    );
    objections = criticResult.objections;
    conflicts = criticResult.conflicts;
    rejected = criticResult.rejected;
    criticRan = true;
    criticFailed = criticResult.criticFailed === true || (criticResult.objections[0]?.status === 'failed');
    if (criticFailed) failedAgents += 0; // failedAgents عُدّ في safe.
  } else {
    criticFailed = true;
    objections = [failedOutput('critic', at, 'critic_disabled')];
  }

  // 5) القرار.
  const decision = decisionAgent(ctx, allForCritic, conflicts, { ran: criticRan, failed: criticFailed, rejected });

  const evidence = allForCritic.filter((o) => o.truthState === 'FACT').flatMap((o) => o.evidence).slice(0, 30);
  const hasDecision = Boolean(decision);
  const status: TeamSession['status'] = failedAgents > 0
    ? (hasDecision ? 'partial' : 'failed')
    : 'completed';

  const session: TeamSession = {
    teamSessionId: `team-${options.now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    task: ctx.task,
    trigger: options.trigger,
    source: options.platform,
    participants,
    evidence,
    observations,
    analyses,
    recommendations,
    objections,
    conflicts,
    decision,
    confidence: decision?.confidence ?? 'low',
    truthState: decision?.truthState ?? 'UNKNOWN',
    status,
    createdAt: at,
    updatedAt: at,
    memoryWritten: false,
    memoryRecordIds: [],
    criticRejections: rejected,
    criticRan,
    criticFailed,
    persistence: { ok: false, error: null },
    dedupeKey,
    failedAgents,
  };
  return session;
}

/** يحفظ الجلسة في مخزن الجلسات بلا تكرار (نفس المفتاح => لا إضافة). */
export function upsertTeamSession(state: TeamSessionState, session: TeamSession): { state: TeamSessionState; added: boolean } {
  const existing = state.sessions.find((s) => s.dedupeKey === session.dedupeKey || s.teamSessionId === session.teamSessionId);
  if (existing) {
    // نفس الجلسة => لا تكرار. نفس المفتاح بمحتوى مختلف => استبدال السجل نفسه.
    const sessions = state.sessions.map((s) => (s.dedupeKey === session.dedupeKey || s.teamSessionId === session.teamSessionId ? session : s));
    return { state: { sessions: sessions.slice(-TEAM_SESSION_MAX) }, added: false };
  }
  return { state: { sessions: [...state.sessions, session].slice(-TEAM_SESSION_MAX) }, added: true };
}

/**
 * يحوّل قرار الجلسة إلى سجلات ذاكرة **عبر نظام Brain Memory القائم** فقط، وعند
 * استيفاء قواعد الصدق: لا ذاكرة لقرار بلا دليل، ولا ذاكرة لقرار غير مكتمل.
 * قول AI لا يصبح حقيقة (origin='derived'، والحالة تُحفظ في الملخّص).
 */
export function teamSessionToMemoryRecords(session: TeamSession): BrainMemoryRecord[] {
  if (!session.decision) return [];
  if (session.status === 'failed') return [];
  if (session.truthState === 'UNKNOWN' || session.truthState === 'UNAVAILABLE') return [];
  const decision = session.decision;
  const entry = makeMemoryEntry({
    id: `teamdecision:${session.dedupeKey}`,
    kind: 'decision',
    statement: decision.statement,
    origin: 'derived',
    source: `فريق الوكلاء (${session.trigger}) — ${session.source}`,
    now: Date.parse(session.updatedAt),
    sampleSize: decision.evidence.length,
    confidence: decision.confidence,
    limitations: decision.limitations.join(' '),
    platform: session.source,
    sourceRefs: [`teamSession:${session.teamSessionId}`, 'critic', 'decision'],
    summary: `${decision.statement} [الحالة: ${session.truthState} · ثقة: ${decision.confidence}${decision.verified ? '' : ' · غير مُتحقَّق'}]`.slice(0, 400),
    refs: { teamSessionId: session.teamSessionId },
  });
  return [toMemoryRecord(entry)];
}

/** ملخّص جلسة مختصر للعرض/التشخيص (بلا سرّ). */
export function summarizeTeamSession(session: TeamSession): {
  teamSessionId: string; task: string; status: TeamSession['status']; participants: TeamAgentId[];
  truthState: TeamTruthState; confidence: Confidence; conflicts: number; criticFailed: boolean;
  verified: boolean; memoryWritten: boolean;
} {
  return {
    teamSessionId: session.teamSessionId,
    task: session.task,
    status: session.status,
    participants: session.participants,
    truthState: session.truthState,
    confidence: session.confidence,
    conflicts: session.conflicts.length,
    criticFailed: session.criticFailed,
    verified: Boolean(session.decision?.verified),
    memoryWritten: session.memoryWritten,
  };
}

/** ملخّص حالة فريق الوكلاء (للصحة/الجاهزية) — بلا سرّ. */
export function summarizeTeamState(state: TeamSessionState): {
  total: number; completed: number; partial: number; failed: number;
  conflicts: number; unverified: number; memoryWritten: number;
} {
  const sessions = state.sessions;
  return {
    total: sessions.length,
    completed: sessions.filter((s) => s.status === 'completed').length,
    partial: sessions.filter((s) => s.status === 'partial').length,
    failed: sessions.filter((s) => s.status === 'failed').length,
    conflicts: sessions.reduce((n, s) => n + s.conflicts.length, 0),
    unverified: sessions.filter((s) => s.decision && !s.decision.verified).length,
    memoryWritten: sessions.filter((s) => s.memoryWritten).length,
  };
}
