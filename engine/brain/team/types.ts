/**
 * Team Session — أنواع فريق الوكلاء الداخلي (منطق خالص، بلا شبكة/أسرار).
 *
 * العقل المركزي يبقى المنسّق الأعلى. جلسة الفريق وحدة تفكير تعاونية تمر بمراحل:
 * بحث → تحليل → استراتيجية → نقد/تحقق → قرار، مع حفظ الدليل والخلافات وحالة الصدق
 * ودرجة الثقة. **لا تنفيذ خارجي**: الجلسة تنتج قراراً مقترحاً فقط، والبوابات
 * القائمة تبقى المرجع للتنفيذ.
 *
 * الفريق لا يملك ذاكرة ثانية: مخرجاته تصبح ذاكرة عبر **نفس** نظام Brain Memory
 * القائم (`memory/store`) وعند استيفاء قواعد الصدق.
 */

import type { TeamTruthState, Confidence } from './truth';

export type TeamAgentId = 'orchestrator' | 'research' | 'analysis' | 'strategy' | 'critic' | 'decision';

export const TEAM_AGENT_IDS: readonly TeamAgentId[] = Object.freeze([
  'orchestrator', 'research', 'analysis', 'strategy', 'critic', 'decision',
]);

export const TEAM_AGENT_LABELS_AR: Record<TeamAgentId, string> = Object.freeze({
  orchestrator: 'المنسّق (العقل المركزي)',
  research: 'وكيل البحث',
  analysis: 'وكيل التحليل',
  strategy: 'وكيل الاستراتيجية',
  critic: 'وكيل النقد والتحقق',
  decision: 'وكيل القرار',
});

/** دور كل وكيل: يمنع تجاوز الصلاحيات (الوكلاء يرصدون/يحلّلون/يوصون فقط). */
export type TeamAgentRole = 'orchestrate' | 'observe' | 'analyze' | 'recommend' | 'verify' | 'decide';

export const TEAM_AGENT_ROLE: Record<TeamAgentId, TeamAgentRole> = Object.freeze({
  orchestrator: 'orchestrate',
  research: 'observe',
  analysis: 'analyze',
  strategy: 'recommend',
  critic: 'verify',
  decision: 'decide',
});

export type TeamAgentStatus = 'ran' | 'failed' | 'skipped';

export type TeamOutputKind = 'observation' | 'analysis' | 'recommendation' | 'objection' | 'decision';

export type TeamSessionStatus = 'completed' | 'partial' | 'failed';

/** من أنتج النص فعلاً: منطق حتمي، أو مزود AI (يُوسَم دائماً بصراحة). */
export type TeamProvenance = 'deterministic' | 'ai_provider' | 'ai_fallback';

/** مخرج وكيل واحد — يحمل حالته الصادقة ودليله وثقته وحدوده. */
export interface TeamAgentOutput {
  agentId: TeamAgentId;
  status: TeamAgentStatus;
  kind: TeamOutputKind;
  truthState: TeamTruthState;
  statement: string;
  evidence: string[];
  /** مصدر الدليل (اسم واجهة/سجل) — بلا أي سرّ. */
  source: string;
  sampleSize: number;
  confidence: Confidence;
  limitations: string;
  provenance: TeamProvenance;
  at: string;
  /** سبب الفشل المختصر عند `status='failed'` (بلا سرّ). */
  error?: string;
}

/** خلاف ظاهر بين وكيلين (يبقى مرئياً وقابلاً للتتبع؛ لا يُختار فائز بلا دليل). */
export interface TeamConflict {
  id: string;
  between: [TeamAgentId, TeamAgentId];
  statement: string;
  leftState: TeamTruthState;
  rightState: TeamTruthState;
  /** هل حُسم؟ لا يُحسم إلا بدليل مستقل كافٍ. */
  resolved: boolean;
  reason: string;
}

export interface TeamDecision {
  statement: string;
  truthState: TeamTruthState;
  confidence: Confidence;
  /** هل خضع القرار لتحقق ناقد فعلي؟ إن فشل الناقد يبقى غير مُتحقَّق. */
  verified: boolean;
  verificationNote: string;
  limitations: string[];
  /** هل يتجاوز القرار صلاحية الجلسة؟ يجب أن يكون false دائماً (الوكلاء لا ينفّذون). */
  requiresHumanApproval: boolean;
  /** الإجراء المقترح داخل حدود القدرات المسموحة (بلا تنفيذ). */
  proposedAction: string;
  evidence: string[];
}

export interface TeamSession {
  teamSessionId: string;
  task: string;
  trigger: 'youtube_event' | 'owner_request' | 'scheduled' | 'manual';
  source: string;
  participants: TeamAgentId[];
  evidence: string[];
  observations: TeamAgentOutput[];
  analyses: TeamAgentOutput[];
  recommendations: TeamAgentOutput[];
  objections: TeamAgentOutput[];
  conflicts: TeamConflict[];
  decision: TeamDecision | null;
  confidence: Confidence;
  truthState: TeamTruthState;
  status: TeamSessionStatus;
  createdAt: string;
  updatedAt: string;
  /** هل كُتبت الجلسة في Brain Memory القائمة (بلا تكرار)؟ */
  memoryWritten: boolean;
  memoryRecordIds: string[];
  /** هل رُفضت مخرجات غير مدعومة؟ */
  criticRejections: number;
  criticRan: boolean;
  criticFailed: boolean;
  /** حالة الحفظ الدائم لهذه الجلسة (لا ادّعاء نجاح). */
  persistence: { ok: boolean; error: string | null };
  /** مفتاح منع التكرار المشتق من هوية الحدث الحقيقي. */
  dedupeKey: string;
  /** عدد الوكلاء الذين فشلوا (للشفافية). */
  failedAgents: number;
}

export interface TeamSessionState {
  sessions: TeamSession[];
}

export function emptyTeamSessionState(): TeamSessionState {
  return { sessions: [] };
}

export const TEAM_SESSION_MAX = 2000;
