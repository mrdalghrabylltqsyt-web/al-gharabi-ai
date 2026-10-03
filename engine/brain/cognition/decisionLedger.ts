/**
 * Decision → Outcome Ledger — سجل قرار→نتيجة واحد يملكه العقل المركزي (منطق خالص).
 *
 * كل قرار مركزي حقيقي يُسجَّل مرّة، ثم يُربَط بنتيجته الملاحَظة إن توفّرت. النتيجة
 * **غير المتاحة تُعلَن صريحة** (`unavailable`) لا تُخترع، والدرس والذاكرة يُربطان
 * بالمعرّفات الحقيقية القائمة (لا نظام ذاكرة ثانٍ).
 *
 * السلسلة: Decision → action → observed result → outcome → lesson → memory →
 *          future Central Brain decision.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import { CENTRAL_BRAIN_ID } from '../consolidation';

export const DECISION_LEDGER_MAX = 500;

export type OutcomeAvailability = 'available' | 'unavailable';
export type LedgerOutcomeKind = 'engagement_changed' | 'no_change' | 'delivered' | 'failed' | 'unknown';

export const LEDGER_OUTCOME_LABELS_AR: Record<LedgerOutcomeKind, string> = Object.freeze({
  engagement_changed: 'تغيّر تفاعل',
  no_change: 'لا تغيّر',
  delivered: 'تسليم مُثبَت',
  failed: 'فشل تسليم',
  unknown: 'غير معروف',
});

export interface LedgerOutcome {
  availability: OutcomeAvailability;
  kind: LedgerOutcomeKind;
  summary: string;
  /** دليل حقيقي (عدد/إعجاب/رد) عند التوفّر — بلا اختراع رقم. */
  metrics: Record<string, number> | null;
  observedAt: string | null;
  source: string | null;
  /** سبب عدم التوفّر عند `unavailable`. */
  unavailableReason: string | null;
}

export interface DecisionLedgerEntry {
  decisionId: string;
  owner: typeof CENTRAL_BRAIN_ID;
  platform: string;
  eventIdentity: string;
  /** الحالة النهائية المحكومة (من سلطة القرار الواحدة). */
  finalStatus: string;
  actionKind: string;
  actionText: string;
  createdAt: string;
  outcome: LedgerOutcome;
  /** معرّفات ربط حقيقية (بلا اختراع): ذاكرة/درس/تصعيد/معرّف منصة. */
  links: {
    memoryRecordIds: string[];
    lessonRecordIds: string[];
    escalationExternalId: string | null;
    providerReplyId: string | null;
  };
}

export interface DecisionLedger {
  owner: typeof CENTRAL_BRAIN_ID;
  entries: DecisionLedgerEntry[];
  lastUpdatedAt: string | null;
}

export function emptyDecisionLedger(): DecisionLedger {
  return { owner: CENTRAL_BRAIN_ID, entries: [], lastUpdatedAt: null };
}

/** نتيجة غير متاحة صريحة (لا تُخترع). */
export function unavailableOutcome(reason: string): LedgerOutcome {
  return {
    availability: 'unavailable',
    kind: 'unknown',
    summary: 'النتيجة غير متاحة — لم تُرصد بعد (لا ادعاء).',
    metrics: null,
    observedAt: null,
    source: null,
    unavailableReason: String(reason || 'not_observed').slice(0, 120),
  };
}

export interface RecordDecisionInput {
  decisionId: string;
  platform: string;
  eventIdentity: string;
  finalStatus: string;
  actionKind: string;
  actionText: string;
  now: number;
  links?: Partial<DecisionLedgerEntry['links']>;
}

/**
 * يسجّل قراراً واحداً (بلا تكرار: نفس decisionId يُستبدل). النتيجة تبدأ
 * `unavailable` صراحةً حتى تُلاحظ.
 */
export function recordDecision(ledger: DecisionLedger, input: RecordDecisionInput): { ledger: DecisionLedger; entry: DecisionLedgerEntry; added: boolean } {
  const base = ledger || emptyDecisionLedger();
  const existing = base.entries.find((e) => e.decisionId === input.decisionId) || null;
  const entry: DecisionLedgerEntry = {
    decisionId: input.decisionId,
    owner: CENTRAL_BRAIN_ID,
    platform: String(input.platform),
    eventIdentity: String(input.eventIdentity),
    finalStatus: String(input.finalStatus),
    actionKind: String(input.actionKind),
    actionText: String(input.actionText).slice(0, 300),
    createdAt: existing?.createdAt || new Date(input.now).toISOString(),
    outcome: existing?.outcome || unavailableOutcome('awaiting_observation'),
    links: {
      memoryRecordIds: input.links?.memoryRecordIds ?? existing?.links.memoryRecordIds ?? [],
      lessonRecordIds: input.links?.lessonRecordIds ?? existing?.links.lessonRecordIds ?? [],
      escalationExternalId: input.links?.escalationExternalId ?? existing?.links.escalationExternalId ?? null,
      providerReplyId: input.links?.providerReplyId ?? existing?.links.providerReplyId ?? null,
    },
  };
  const others = base.entries.filter((e) => e.decisionId !== input.decisionId);
  return {
    ledger: { owner: CENTRAL_BRAIN_ID, entries: [...others, entry].slice(-DECISION_LEDGER_MAX), lastUpdatedAt: new Date(input.now).toISOString() },
    entry,
    added: !existing,
  };
}

export interface AttachOutcomeInput {
  decisionId: string;
  kind: LedgerOutcomeKind;
  summary: string;
  metrics?: Record<string, number> | null;
  source?: string | null;
  now: number;
  memoryRecordIds?: string[];
  lessonRecordIds?: string[];
  providerReplyId?: string | null;
}

/**
 * يُرفق نتيجة ملاحَظة حقيقية بقرار موجود. إذا لم يوجد القرار لا يُخترع سجل
 * (يرجع `attached:false`). الربط بالذاكرة/الدرس بمعرّفات حقيقية فقط.
 */
export function attachOutcome(ledger: DecisionLedger, input: AttachOutcomeInput): { ledger: DecisionLedger; attached: boolean; entry: DecisionLedgerEntry | null } {
  const base = ledger || emptyDecisionLedger();
  const entry = base.entries.find((e) => e.decisionId === input.decisionId) || null;
  if (!entry) return { ledger: base, attached: false, entry: null };
  const updated: DecisionLedgerEntry = {
    ...entry,
    outcome: {
      availability: 'available',
      kind: input.kind,
      summary: String(input.summary).slice(0, 300),
      metrics: input.metrics ?? null,
      observedAt: new Date(input.now).toISOString(),
      source: input.source ? String(input.source).slice(0, 120) : null,
      unavailableReason: null,
    },
    links: {
      memoryRecordIds: [...new Set([...(entry.links.memoryRecordIds || []), ...(input.memoryRecordIds || [])])],
      lessonRecordIds: [...new Set([...(entry.links.lessonRecordIds || []), ...(input.lessonRecordIds || [])])],
      escalationExternalId: entry.links.escalationExternalId,
      providerReplyId: input.providerReplyId ?? entry.links.providerReplyId,
    },
  };
  const entries = base.entries.map((e) => (e.decisionId === input.decisionId ? updated : e));
  return { ledger: { owner: CENTRAL_BRAIN_ID, entries, lastUpdatedAt: new Date(input.now).toISOString() }, attached: true, entry: updated };
}

/** يسترجع السجل (توافق خلفي عند غياب/فساد المخزون). */
export function normalizeDecisionLedger(raw: any): DecisionLedger {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) return emptyDecisionLedger();
  const entries = raw.entries.filter((e: any) => e && typeof e.decisionId === 'string').slice(-DECISION_LEDGER_MAX);
  return { owner: CENTRAL_BRAIN_ID, entries, lastUpdatedAt: typeof raw.lastUpdatedAt === 'string' ? raw.lastUpdatedAt : null };
}

/**
 * ملخّص السجل: عدد القرارات، ومنها نتائج متاحة/غير متاحة، وحلقة التعلّم الفعلية.
 * **لا تُخترع نتيجة**: الغائب يُعدّ `unavailable`.
 */
export function summarizeDecisionLedger(ledger: DecisionLedger) {
  const b = ledger || emptyDecisionLedger();
  const total = b.entries.length;
  const withOutcome = b.entries.filter((e) => e.outcome.availability === 'available').length;
  const withLesson = b.entries.filter((e) => (e.links.lessonRecordIds || []).length > 0).length;
  const withMemory = b.entries.filter((e) => (e.links.memoryRecordIds || []).length > 0).length;
  return {
    owner: b.owner,
    total,
    withOutcome,
    unavailable: total - withOutcome,
    withLesson,
    withMemory,
    lastUpdatedAt: b.lastUpdatedAt,
    note: 'سجل قرار→نتيجة واحد يملكه العقل المركزي؛ النتيجة غير المتاحة معلنة لا مخترعة.',
  };
}
