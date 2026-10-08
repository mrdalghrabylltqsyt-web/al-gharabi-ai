/**
 * Six-Agent Audit Log — سجل تدقيق كامل لأفعال العقول الستة (منطق خالص).
 *
 * كل فعل نفّذته إحدى العقول الستة يُسجَّل بوضوح: أي عقل، أي قاعدة/نمط طابق، متى،
 * وعلى أي منصة، وما النتيجة. بلا أي سرّ. يُحفظ عبر محوّل الحالة القائم (لا مخزن
 * ثانٍ) فيصمد بعد إعادة التشغيل.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن now.
 */

import type { TeamAgentId } from './types';
import type { SixAgentAction, SixAgentPolicyDecisionCode } from './executionPolicy';

export const SIX_AGENT_AUDIT_MAX = 1000;

export interface SixAgentAuditEntry {
  id: string;
  agentId: TeamAgentId;
  action: SixAgentAction;
  /** القاعدة الحتمية أو معرّف النمط الذي طابق (بلا سرّ). */
  matchedRule: string | null;
  matchedPatternId: string | null;
  decisionCode: SixAgentPolicyDecisionCode;
  /** نتيجة التنفيذ الفعلي (نفُّذ/فشل/تصعيد). */
  outcome: 'executed' | 'failed' | 'escalated' | 'rejected';
  platform: string | null;
  /** معرّف دليل حقيقي عند التنفيذ (معرّف رد/منشور) — بلا اختراع. */
  evidenceRef: string | null;
  note: string;
  at: string;
}

export interface SixAgentAuditState {
  entries: SixAgentAuditEntry[];
  lastUpdatedAt: string | null;
}

export function emptySixAgentAudit(): SixAgentAuditState {
  return { entries: [], lastUpdatedAt: null };
}

export interface RecordSixAgentAuditInput {
  id: string;
  agentId: TeamAgentId;
  action: SixAgentAction;
  matchedRule: string | null;
  matchedPatternId: string | null;
  decisionCode: SixAgentPolicyDecisionCode;
  outcome: SixAgentAuditEntry['outcome'];
  platform: string | null;
  evidenceRef: string | null;
  note?: string;
  now: number;
}

/** يضيف سجل تدقيق واحداً مع إبقاء أحدث السجلات فقط (حد أعلى ثابت). */
export function recordSixAgentAudit(state: SixAgentAuditState, input: RecordSixAgentAuditInput): SixAgentAuditState {
  const entry: SixAgentAuditEntry = {
    id: input.id,
    agentId: input.agentId,
    action: input.action,
    matchedRule: input.matchedRule,
    matchedPatternId: input.matchedPatternId,
    decisionCode: input.decisionCode,
    outcome: input.outcome,
    platform: input.platform,
    evidenceRef: input.evidenceRef,
    note: String(input.note || '').slice(0, 200),
    at: new Date(input.now).toISOString(),
  };
  const entries = [entry, ...state.entries];
  if (entries.length > SIX_AGENT_AUDIT_MAX) entries.length = SIX_AGENT_AUDIT_MAX;
  return { entries, lastUpdatedAt: entry.at };
}

/** توافق خلفي عند استرجاع الحالة. */
export function normalizeSixAgentAudit(raw: any): SixAgentAuditState {
  const entries = Array.isArray(raw?.entries) ? raw.entries.filter((e: any) => e && typeof e.id === 'string') : [];
  return { entries: entries.slice(0, SIX_AGENT_AUDIT_MAX), lastUpdatedAt: typeof raw?.lastUpdatedAt === 'string' ? raw.lastUpdatedAt : null };
}

export function summarizeSixAgentAudit(state: SixAgentAuditState): {
  total: number;
  executed: number;
  escalated: number;
  failed: number;
  rejected: number;
  lastAt: string | null;
} {
  const count = (o: SixAgentAuditEntry['outcome']) => state.entries.filter((e) => e.outcome === o).length;
  return {
    total: state.entries.length,
    executed: count('executed'),
    escalated: count('escalated'),
    failed: count('failed'),
    rejected: count('rejected'),
    lastAt: state.lastUpdatedAt,
  };
}
