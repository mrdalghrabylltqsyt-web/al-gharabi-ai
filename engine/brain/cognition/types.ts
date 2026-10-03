/**
 * Cognition Types — نماذج الإدراك/الفهم/التخطيط للعقل المركزي (Batch 7، منطق خالص).
 *
 * الغرض: نقل العقل من «صاحب قرار» (Batch 6) إلى **عقل يفهم ويتذكّر ويخطّط ويتعلّم**،
 * مع بقاء الفصل الصارم:
 *   - لا اختراع: الغائب يبقى UNKNOWN/UNAVAILABLE صراحةً.
 *   - لا تفكير داخلي مسرود (no hidden chain-of-thought): يُحفظ فقط بيانات تفكير
 *     قابلة للتتبع (هدف/أدلة/افتراضات/نتائج وكلاء/نقد/مبرّر/عدم يقين/إجراء).
 *   - لا تنفيذ خارجي: المنطق تحليلي فقط، والتنفيذ عبر بوابات المشروع القائمة.
 *
 * لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import type { PlatformId } from '../../social/adapter';
import type { TeamTruthState, Confidence } from '../team/truth';
import type { EscalationReason } from '../../social/escalation';
import type { MemoryKind, MemoryOrigin } from '../memory/longTerm';

/** الدورة الإدراكية الكاملة (نفس ترتيب الوثيقة). */
export type CognitivePhase =
  | 'PERCEIVE'
  | 'UNDERSTAND'
  | 'REMEMBER'
  | 'REASON'
  | 'CONSULT'
  | 'PLAN'
  | 'CRITIQUE'
  | 'DECIDE'
  | 'ACT'
  | 'OBSERVE'
  | 'LEARN';

export const COGNITIVE_PHASES: readonly CognitivePhase[] = Object.freeze([
  'PERCEIVE', 'UNDERSTAND', 'REMEMBER', 'REASON', 'CONSULT', 'PLAN',
  'CRITIQUE', 'DECIDE', 'ACT', 'OBSERVE', 'LEARN',
]);

export const COGNITIVE_PHASE_LABELS_AR: Readonly<Record<CognitivePhase, string>> = Object.freeze({
  PERCEIVE: 'إدراك الحدث',
  UNDERSTAND: 'فهم السياق',
  REMEMBER: 'استدعاء الذاكرة',
  REASON: 'التفكير والتحليل',
  CONSULT: 'استشارة الوكلاء',
  PLAN: 'بناء الخطة',
  CRITIQUE: 'النقد والتحقق',
  DECIDE: 'اتخاذ القرار',
  ACT: 'الإجراء المسموح',
  OBSERVE: 'رصد النتيجة',
  LEARN: 'التعلّم',
});

/** حالة الدورة الإدراكية (رسمية، بلا مجهول). */
export type CognitiveCycleStatus = 'completed' | 'partial' | 'failed' | 'no_data';

/** ما يُحفظ من مرحلة واحدة في سلسلة التفكير (قابل للتتبع، بلا تفكير داخلي خاص). */
export interface PhaseTrace {
  phase: CognitivePhase;
  labelAr: string;
  /** خلاصة صريحة للنتيجة (بلا سرّ وبلا استدلال مسرود). */
  outcome: string;
  /** هل أنتجت هذه المرحلة إجراءً خارجياً؟ يجب أن تكون false دائماً. */
  externalAction: false;
  at: string;
}

/**
 * حالة تفكير منظّمة (Multi-Step Reasoning State): بيانات قابلة للتتبع فقط.
 * **لا تخزين لأي سلسلة تفكير خاصة** — فقط الحقول المعلنة أدناه.
 */
export interface ReasoningState {
  objective: string;
  evidence: string[];
  /** افتراضات معلنة صراحةً (فرضيات؛ ليست حقائق). */
  assumptions: string[];
  agentFindings: string[];
  criticFindings: string[];
  decisionRationale: string;
  /** عدم اليقين: الحالة + الثقة + الحدود. */
  uncertainty: { truthState: TeamTruthState; confidence: Confidence; limitations: string[] };
  selectedAction: string;
  escalationReason: EscalationReason | null;
  /** صريح: لا تفكير داخلي خاص محفوظ. */
  storesPrivateChainOfThought: false;
}

/** كيان مشارك في الحدث (بلا بيانات هوية حساسة). */
export interface ContextEntity {
  kind: 'platform' | 'conversation' | 'object' | 'agent' | 'memory';
  id: string;
  labelAr: string;
}

/** سياق واحد يلخّص ما فهمه العقل عن حدث (WHAT/WHO/WHERE/WHEN/…). */
export interface CognitiveContext {
  contextId: string;
  eventIdentity: string;
  what: string;
  who: ContextEntity[];
  where: { platform: PlatformId; surfaceKind: string };
  when: string;
  previousDiscussion: string | null;
  conversationState: {
    conversationId: string | null;
    sessionMessages: number;
    windowSize: number;
    truncated: boolean;
    lastActivityAt: string | null;
  };
  objective: string;
  availableEvidence: string[];
  unknown: string[];
  relevantMemoryIds: string[];
  relevantMarketingContext: string[];
  requiredNextDecision: string;
  /** فصل الحقيقة الصريح (لا خلط). */
  truth: { fact: string[]; derived: string[]; hypothesis: string[]; unknown: string[]; unavailable: string[] };
  limitations: string[];
}

/** مرشّح ذاكرة مستدعى عبر المطابقة الاستدلالية (يشير لسجل قائم، لا نسخة ثانية). */
export interface MemoryRecallCandidate {
  recordId: string;
  kind: MemoryKind;
  origin: MemoryOrigin;
  summary: string;
  platform: string | null;
  /** نقاط الصلة (سبب الاستدعاء) — يفسّر لماذا استُدعي. */
  relevance: number;
  reasons: string[];
  sampleSize: number;
  stale: boolean;
}

export interface MemoryRecallResult {
  candidates: MemoryRecallCandidate[];
  /** العدد الكامل قبل القطع (بلا تحميل كل الذاكرة للقرار). */
  considered: number;
  used: number;
  note: string;
}

/** هدف مركزي + أهداف فرعية + الخطوة التالية. */
export interface GoalNode {
  id: string;
  kind: string;
  labelAr: string;
  rationale: string;
  status: 'active' | 'blocked' | 'done';
}

export interface GoalPlan {
  primaryObjective: string;
  currentGoal: GoalNode;
  subGoals: GoalNode[];
  nextBestStep: string;
  limitations: string[];
}

/** نوع الإجراء التالي المقترح (Action Proposal — لا تنفيذ). */
export type NextActionKind =
  | 'respond'
  | 'follow_up'
  | 'create_content'
  | 'analyze'
  | 'wait'
  | 'ask_clarification'
  | 'escalate'
  | 'do_nothing';

export const NEXT_ACTION_LABELS_AR: Readonly<Record<NextActionKind, string>> = Object.freeze({
  respond: 'الرد',
  follow_up: 'المتابعة',
  create_content: 'إنشاء محتوى',
  analyze: 'تحليل',
  wait: 'الانتظار',
  ask_clarification: 'طلب توضيح',
  escalate: 'التصعيد',
  do_nothing: 'لا إجراء',
});

export interface NextActionProposal {
  kind: NextActionKind;
  labelAr: string;
  rationale: string;
  /** الصلاحية المطلوبة (تُمرَّر للحوكمة القائمة — لا تُتجاوَز). */
  requiredPermission: 'READ' | 'WRITE' | 'EXECUTE' | 'EXTERNAL_ACTION' | 'SENSITIVE';
  risk: 'low' | 'medium' | 'high';
  governed: true;
  reasons: string[];
}

/** خلاف منظّم بين وكيلين (لا فرض إجماع). */
export interface Disagreement {
  id: string;
  between: [string, string];
  statement: string;
  leftState: TeamTruthState;
  rightState: TeamTruthState;
  resolved: boolean;
  /** هل يمسّ السلامة/الصحة جوهرياً؟ عندها إمّا تصعيد بشري أو توقف آمن. */
  materialToSafety: boolean;
  reason: string;
}

export interface DisagreementAnalysis {
  disagreements: Disagreement[];
  unresolved: number;
  /** هل يوجد خلاف جوهري يفرض عدم الأتمتة؟ */
  forcesHumanOrSafe: boolean;
  recommendation: 'proceed' | 'human_escalation' | 'failed_safe';
  note: string;
}

/** نتيجة/ملاحظة قابلة للتعلم (Feedback). */
export interface OutcomeObservation {
  id: string;
  platform: PlatformId;
  /** نوع النتيجة الملاحَظة (تفاعل/استجابة/استفسار/…) — بلا بيع مُختلق. */
  kind: 'engagement_changed' | 'response_received' | 'inquiry' | 'purchase_signal' | 'no_change';
  summary: string;
  source: string;
  sampleSize: number;
  at: string;
}

/** درس تعلّم مبني على دليل (لا يُرقّى بلا مصدر/عيّنة). */
export interface Lesson {
  id: string;
  statement: string;
  source: string;
  sampleSize: number;
  confidence: Confidence;
  durable: boolean;
  limitations: string;
}

export interface LearningOutcome {
  observations: OutcomeObservation[];
  lessons: Lesson[];
  /** الدروس المعتبرة معرفة دائمة (مصدر + عيّنة كافية). */
  durableLessons: Lesson[];
  note: string;
}

/** مدخلات بناء السياق الإدراكي — كل حقل من بيانات حقيقية مُمرَّرة. */
export interface CognitiveContextInput {
  now: number;
  platform: PlatformId;
  eventIdentity: string;
  /** وصف ما حدث (نص الحدث/التعليق/المهمة). */
  eventText: string;
  objective: string;
  surfaceKind: string;
  conversationId: string | null;
  sessionMessages: number;
  windowSize: number;
  windowTruncated: boolean;
  lastActivityAt: string | null;
  previousDiscussion: string | null;
  /** أدلة حقيقية موجودة (نصوص/مراجع) — لا تُخترع. */
  evidence: string[];
  /** ما هو مجهول صراحةً (لم يُتَوصل إليه). */
  unknown: string[];
  /** ما هو غير متاح عبر الواجهة الرسمية. */
  unavailable: string[];
  referencedObjectIds: string[];
  relevantMarketingContext: string[];
  requiredNextDecision: string;
}
