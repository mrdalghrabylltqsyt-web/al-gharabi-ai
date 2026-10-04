/**
 * Brain Decision — قرار العقل المركزي المحكوم (منطق خالص قابل للاختبار).
 *
 * هذا هو الفرق الجوهري في Batch 6: **العقل المركزي ≠ الوكلاء الستة**.
 * الوكلاء ينتجون مخرجات استشارية فقط (`TeamSession`)، والعقل المركزي هو الذي:
 *   يجمع الأدلة → يعرض الخلافات → يطبّق النقد → يمرّر القرار على الحوكمة →
 *   يحدّد الحالة النهائية (إجراء مسموح / موافقة مطلوبة / تصعيد بشري / لا إجراء /
 *   توقف آمن).
 *
 * القواعد الملزمة:
 * - لا إجراء خارجي يُنفَّذ من العقل: القرار يوجّه فقط، والتنفيذ عبر بوابات المشروع.
 * - لا إجراء على ادّعاء غير مثبت (ناقد فشل / مزود غير موثق) ⇒ توقف آمن أو تصعيد.
 * - الإجراء الحسّاس (سعر/شكوى/شخصي) ⇒ تصعيد بشري دائماً.
 * - لا اختراع معلومة: المجهول يبقى مجهولاً ويُعلن.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import type { ToolPermission, AgentOperator } from '../../agent/permissions';
import { evaluateGovernance, type GovernanceDecisionCode } from '../../agent/governanceGuard';
import { ESCALATION_REASON_LABELS_AR, type EscalationReason } from '../../social/escalation';
import type { TeamAgentId, TeamSession } from './types';
import type { Confidence, TeamTruthState } from './truth';

/** الحالة النهائية لقرار العقل المركزي — تحصر كل المخرجات الممكنة. */
export type BrainDecisionStatus =
  | 'ALLOWED_ACTION'     // إجراء داخلي/رد مسموح (يمرّ عبر بوابة المشروع القائمة)
  | 'APPROVAL_REQUIRED'  // إجراء خارجي يحتاج موافقة/تفويض المالك
  | 'HUMAN_ESCALATION'   // يحتاج بشراً (حساس/شكوى/سعر غير موثّق/فشل نقد لا يُحلّ بأمان)
  | 'NO_ACTION'          // لا إجراء مطلوب — آمن ترك الأمور
  | 'FAILED_SAFE';       // تعذّر تكوين قرار آمن — توقف صريح بلا اختراع

export const BRAIN_DECISION_STATUSES: readonly BrainDecisionStatus[] = Object.freeze([
  'ALLOWED_ACTION', 'APPROVAL_REQUIRED', 'HUMAN_ESCALATION', 'NO_ACTION', 'FAILED_SAFE',
]);

export const BRAIN_DECISION_STATUS_LABELS_AR: Readonly<Record<BrainDecisionStatus, string>> = Object.freeze({
  ALLOWED_ACTION: 'إجراء مسموح (عبر بوابة المشروع)',
  APPROVAL_REQUIRED: 'يتطلب موافقة المالك',
  HUMAN_ESCALATION: 'تصعيد لمراجعة بشرية',
  NO_ACTION: 'لا إجراء (آمن)',
  FAILED_SAFE: 'توقف آمن — لا قرار مخترع',
});

export type BrainActionKind = 'internal_response' | 'external_action' | 'escalation' | 'none';

export interface BrainDecisionAction {
  kind: BrainActionKind;
  description: string;
  targetPlatform: string;
}

/** خلاف بين وكيلين كما ظهر في الجلسة (يبقى مرئياً؛ لا يُختار فائز بلا دليل). */
export interface BrainDecisionDisagreement {
  between: [TeamAgentId, TeamAgentId];
  statement: string;
  resolved: boolean;
  reason: string;
}

/** رؤية وكيل واحد في سجل القرار (مصدر التتبع). */
export interface BrainDecisionFinding {
  agentId: TeamAgentId;
  kind: string;
  truthState: TeamTruthState;
  statement: string;
  source: string;
  sampleSize: number;
  confidence: Confidence;
}

/**
 * قرار العقل المركزي النهائي — يمتد نموذج الجلسة القائم بدل استبداله.
 * سلسلة التتبع: EVENT → CONTEXT → AGENTS → OUTPUTS → CRITIC → DECISION → GOVERNANCE → OUTCOME.
 */
export interface BrainDecision {
  decisionId: string;
  /** هوية الحدث الحقيقي (يمنع التكرار ويصل القرار بالحدث). */
  eventIdentity: string;
  teamSessionId: string;
  task: string;
  platform: string;
  objective: string;
  context: { conversationId: string | null; sessionMessages: number; memoryActive: number };
  evidence: string[];
  consultedAgents: TeamAgentId[];
  agentFindings: BrainDecisionFinding[];
  disagreements: BrainDecisionDisagreement[];
  criticFindings: string[];
  uncertainty: { truthState: TeamTruthState; confidence: Confidence; limitations: string[] };
  proposedAction: BrainDecisionAction;
  requiredPermission: ToolPermission;
  escalation: { required: boolean; reason: EscalationReason | null; reasonLabelAr: string | null };
  governance: { allowed: boolean; code: GovernanceDecisionCode; reasonAr: string; requiresApproval: boolean; requiresHuman: boolean };
  finalStatus: BrainDecisionStatus;
  finalStatusLabelAr: string;
  timestamp: string;
  /** مرجع سلسلة التتبع (الجلسة + القرار). */
  auditRef: string;
  notes: string[];
}

export interface ComposeBrainDecisionInput {
  session: TeamSession;
  platform: string;
  eventIdentity: string;
  objective: string;
  context: { conversationId: string | null; sessionMessages: number; memoryActive: number };
  /** قدرات المنصة الفعلية (لا توصية/إجراء بما لا يمكن تنفيذه). */
  capabilities: { replyCapable: boolean; publishCapable: boolean };
  /** هل المنصة متصلة باتصال موثّق فعلاً (دليل مزود)؟ */
  providerVerified: boolean;
  /** هل يوجد تفويض/موافقة مالك صريحة لهذا الإجراء الخارجي؟ */
  externalApproved: boolean;
  /** سبب تصعيد محتمل محسوب مسبقاً من التصنيف الحتمي (بلا اختراع). */
  escalationReason: EscalationReason | null;
  now: number;
}

/** يجمع كل مخرجات الجلسة في قائمة تتبّع واحدة (بلا فقدان أي وكيل). */
function collectFindings(session: TeamSession): BrainDecisionFinding[] {
  const all = [
    ...session.observations,
    ...session.analyses,
    ...session.recommendations,
    ...session.objections,
  ];
  return all.map((o) => ({
    agentId: o.agentId,
    kind: o.kind,
    truthState: o.truthState,
    statement: o.statement,
    source: o.source,
    sampleSize: o.sampleSize,
    confidence: o.confidence,
  }));
}

/** يحدّد الإجراء المقترح ونوعه والصلاحية المطلوبة (حتمي، بلا اختراع قدرة). */
function resolveProposedAction(input: ComposeBrainDecisionInput): { action: BrainDecisionAction; permission: ToolPermission } {
  const { session, platform, capabilities } = input;
  const task = String(session.task || '');
  const wantsReply = /(رد|reply|تعليق)/i.test(task);
  const wantsPublish = /(نشر|publish|جدول|schedule)/i.test(task);
  const description = session.decision?.proposedAction || 'لا إجراء مقترح.';
  const hasActionable = session.decision?.truthState === 'DERIVED' || session.decision?.truthState === 'FACT';

  if (hasActionable && wantsReply && capabilities.replyCapable) {
    return { action: { kind: 'external_action', description, targetPlatform: platform }, permission: 'EXTERNAL_ACTION' };
  }
  if (hasActionable && wantsPublish && capabilities.publishCapable) {
    return { action: { kind: 'external_action', description, targetPlatform: platform }, permission: 'EXTERNAL_ACTION' };
  }
  if (hasActionable) {
    return { action: { kind: 'internal_response', description, targetPlatform: platform }, permission: 'READ' };
  }
  return { action: { kind: 'none', description, targetPlatform: platform }, permission: 'READ' };
}

/** هل السبب يستوجب بشراً دائماً؟ (سعر غير موثّق/شكوى/حسّاس). */
function reasonRequiresHuman(reason: EscalationReason | null): boolean {
  return reason === 'price_unverified' || reason === 'complaint' || reason === 'sensitive';
}

/**
 * يكوّن قرار العقل المركزي المحكوم. لا يرمي ولا يخترع: أي نقص يقود لحالة آمنة صريحة.
 */
export function composeBrainDecision(input: ComposeBrainDecisionInput): BrainDecision {
  const { session, now } = input;
  const at = new Date(now).toISOString();
  const findings = collectFindings(session);
  const consultedAgents = session.participants;

  const evidence = Array.from(new Set([
    ...session.evidence,
    ...(session.decision?.evidence || []),
  ])).slice(0, 40);

  const disagreements: BrainDecisionDisagreement[] = session.conflicts.map((c) => ({
    between: c.between,
    statement: c.statement,
    resolved: c.resolved,
    reason: c.reason,
  }));

  const criticFindings = session.objections
    .filter((o) => o.agentId === 'critic')
    .map((o) => o.statement)
    .slice(0, 20);

  const { action, permission } = resolveProposedAction(input);

  // الحوكمة: الإجراء الخارجي يُقيَّم كسلطة المالك (موافقة/تفويض)، والداخلي كمشغّل نظام.
  // لا يُنفَّذ إجراء خارجي من العقل أصلاً — القرار يوجّه، والبوابة تنفّذ.
  const operator: AgentOperator = action.kind === 'external_action' ? 'owner' : 'system';
  const claimVerified = session.decision?.verified === true
    && (action.kind !== 'external_action' || input.providerVerified === true);
  const sensitive = reasonRequiresHuman(input.escalationReason);

  const governance = evaluateGovernance({
    operator,
    permission,
    externalAction: action.kind === 'external_action',
    approved: action.kind === 'external_action' ? input.externalApproved : false,
    claimVerified,
    sensitive,
  });

  // الحالة النهائية بترتيب أسبقية صريح (الفشل الآمن والتصعيد يتقدّمان على التنفيذ).
  let finalStatus: BrainDecisionStatus;
  if (!session.decision || session.status === 'failed') {
    finalStatus = 'FAILED_SAFE';
  } else if (sensitive || governance.code === 'SENSITIVE_HUMAN_REQUIRED') {
    finalStatus = 'HUMAN_ESCALATION';
  } else if (governance.code === 'UNVERIFIED_CLAIM') {
    // ادعاء غير مثبت (فشل نقد أو مزود غير موثق) ⇒ لا إجراء على ادعاء؛ توقف آمن.
    finalStatus = 'FAILED_SAFE';
  } else if (governance.code === 'PERMISSION_DENIED') {
    finalStatus = 'FAILED_SAFE';
  } else if (governance.code === 'APPROVAL_REQUIRED') {
    finalStatus = 'APPROVAL_REQUIRED';
  } else if (governance.allowed) {
    finalStatus = action.kind === 'none' ? 'NO_ACTION' : 'ALLOWED_ACTION';
  } else {
    finalStatus = 'FAILED_SAFE';
  }

  const escalationRequired = finalStatus === 'HUMAN_ESCALATION';
  const notes: string[] = [
    'العقل المركزي هو سلطة القرار؛ الوكلاء قدّموا مخرجات استشارية فقط.',
    'لا يُنفَّذ أي إجراء خارجي من العقل — التنفيذ عبر بوابات المشروع (Capability → Connection → Verification → Approval).',
  ];
  if (session.criticFailed) notes.push('فشل الناقد: القرار غير مُتحقَّق — لا إجراء مبني على ادعاء غير مثبت.');
  if (disagreements.some((d) => !d.resolved)) notes.push('خلافات غير محسومة تبقى ظاهرة؛ لا يُختار فائز بلا دليل.');
  if (finalStatus === 'APPROVAL_REQUIRED') notes.push('إجراء خارجي: يلزم تفويض/موافقة صريحة من المالك قبل أي تنفيذ.');
  if (finalStatus === 'HUMAN_ESCALATION') notes.push('يُحوَّل لمراجعة بشرية؛ لا رد آلي على الحالات الحسّاسة.');

  const decisionId = `bd-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    decisionId,
    eventIdentity: input.eventIdentity,
    teamSessionId: session.teamSessionId,
    task: session.task,
    platform: input.platform,
    objective: input.objective,
    context: input.context,
    evidence,
    consultedAgents,
    agentFindings: findings,
    disagreements,
    criticFindings,
    uncertainty: {
      truthState: session.truthState,
      confidence: session.confidence,
      limitations: session.decision?.limitations || [],
    },
    proposedAction: action,
    requiredPermission: permission,
    escalation: {
      required: escalationRequired,
      reason: escalationRequired ? (input.escalationReason || 'manual') : null,
      reasonLabelAr: escalationRequired ? ESCALATION_REASON_LABELS_AR[input.escalationReason || 'manual'] : null,
    },
    governance: {
      allowed: governance.allowed,
      code: governance.code,
      reasonAr: governance.reasonAr,
      requiresApproval: governance.requiresApproval,
      requiresHuman: governance.requiresHuman,
    },
    finalStatus,
    finalStatusLabelAr: BRAIN_DECISION_STATUS_LABELS_AR[finalStatus],
    timestamp: at,
    auditRef: `${session.teamSessionId}#${decisionId}`,
    notes,
  };
}

/** ملخّص مختصر للصحة/الجاهزية (بلا سرّ). */
export function summarizeBrainDecision(decision: BrainDecision | null): {
  finalStatus: BrainDecisionStatus | null;
  governanceCode: GovernanceDecisionCode | null;
  escalationRequired: boolean;
  consultedAgents: number;
  disagreements: number;
  criticFindings: number;
} {
  if (!decision) {
    return { finalStatus: null, governanceCode: null, escalationRequired: false, consultedAgents: 0, disagreements: 0, criticFindings: 0 };
  }
  return {
    finalStatus: decision.finalStatus,
    governanceCode: decision.governance.code,
    escalationRequired: decision.escalation.required,
    consultedAgents: decision.consultedAgents.length,
    disagreements: decision.disagreements.length,
    criticFindings: decision.criticFindings.length,
  };
}
