/**
 * Persistent Long-Term Memory Store — ذاكرة العقل الدائمة (منطق خالص قابل للاختبار).
 *
 * هذه الطبقة تحوّل عناصر الذاكرة (`MemoryEntry`) إلى سجلات دائمة غنية، وتدير
 * الإدراج بلا تكرار، والتحقق، والوسم بالتقادم، والملخّص. التخزين الفعلي يتم عبر
 * محوّل الحالة القائم في الخادم (مفتاح `brainMemory`) — لا قاعدة بيانات ثانية.
 *
 * قواعد ملزمة:
 * - كل سجل يحمل أصله (`origin`) ومصدره (`sourceRefs`) وعيّنته (`sampleSize`).
 * - قول AI لا يُرقّى إلى حقيقة تجارية أبداً.
 * - تفضيل المالك ليس حقيقة تجارية.
 * - لا أسرار في الذاكرة إطلاقاً.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import {
  type MemoryEntry,
  type MemoryKind,
  type MemoryOrigin,
  type MemoryStatus,
  type KnowledgeItemLike,
} from './longTerm';

/** السجل الدائم الكامل — الحقول الدنيا المطلوبة في المواصفة. */
export interface BrainMemoryRecord {
  id: string;
  kind: MemoryKind;
  /** المنصة المرتبطة (أو null للذاكرة العامة). */
  platform: string | null;
  origin: MemoryOrigin;
  createdAt: string;
  lastValidatedAt: string | null;
  confidence: 'low' | 'medium' | 'high';
  status: MemoryStatus;
  sampleSize: number;
  /** مراجع المصدر (أسماء واجهات/سجلات) — بلا أي سرّ. */
  sourceRefs: string[];
  /** الخلاصة/الحقيقة المخزّنة (نص واحد قصير). */
  summary: string;
  relatedGoal: string | null;
  relatedExperiment: string | null;
  /** وسم التقادم: يبقى السجل مرئياً لكن لا يدخل القرار الآلي. */
  stale: boolean;
  staleReason: string | null;
}

export interface BrainMemoryStoreState {
  records: BrainMemoryRecord[];
}

export function emptyBrainMemory(): BrainMemoryStoreState {
  return { records: [] };
}

/** يحوّل عنصر ذاكرة إلى سجل دائم كامل مع إبقاء الأصل والثقة بلا ترقية. */
export function toMemoryRecord(entry: MemoryEntry): BrainMemoryRecord {
  const refs = entry.sourceRefs && entry.sourceRefs.length ? [...entry.sourceRefs] : (entry.source ? [entry.source] : []);
  return {
    id: entry.id,
    kind: entry.kind,
    platform: entry.platform ?? (entry.refs?.platform ?? null),
    origin: entry.origin,
    createdAt: entry.createdAt,
    lastValidatedAt: entry.lastValidatedAt ?? null,
    confidence: entry.confidence,
    status: entry.status,
    sampleSize: entry.sampleSize,
    sourceRefs: refs,
    summary: entry.summary || entry.statement,
    relatedGoal: entry.relatedGoal ?? null,
    relatedExperiment: entry.relatedExperiment ?? null,
    stale: false,
    staleReason: null,
  };
}

export interface UpsertResult {
  store: BrainMemoryStoreState;
  added: boolean;
  superseded: boolean;
  duplicate: boolean;
}

/**
 * يُدرج سجلاً بلا تكرار: إن وُجد نفس المعرّف يُستبدل القديم بحالة `superseded`
 * (يحفظ التاريخ)، وإن تطابق المضمون (نفس kind+platform+summary) يُعتبر تكراراً
 * ولا يُضاف. هذا يمنع تضخّم الذاكرة من إعادة معالجة نفس الحدث.
 */
export function upsertMemoryRecord(store: BrainMemoryStoreState, record: BrainMemoryRecord): UpsertResult {
  const sameId = store.records.find((r) => r.id === record.id);
  if (sameId) {
    // نفس المعرّف ونفس المضمون => لا إضافة (إعادة معالجة نفس الحدث ليست حدثاً جديداً).
    const identical = sameId.summary === record.summary && sameId.kind === record.kind && sameId.status === 'active';
    if (identical) return { store, added: false, superseded: false, duplicate: true };
    // نفس المعرّف بمضمون مختلف => استبدال مع حفظ القديم كـsuperseded (يحفظ التاريخ).
    const superseded = store.records.map((r) => (r.id === record.id ? { ...r, status: 'superseded' as MemoryStatus } : r));
    return { store: { records: [...superseded, record] }, added: true, superseded: true, duplicate: false };
  }
  const sameContent = store.records.find(
    (r) => r.status === 'active' && r.kind === record.kind && (r.platform || '') === (record.platform || '') && r.summary === record.summary,
  );
  if (sameContent) {
    return { store, added: false, superseded: false, duplicate: true };
  }
  return { store: { records: [...store.records, record] }, added: true, superseded: false, duplicate: false };
}

/** يُحدّث ختم آخر تحقق لسجل (بلا تغيير مضمونه). */
export function validateMemoryRecord(store: BrainMemoryStoreState, id: string, now: number): BrainMemoryStoreState {
  return {
    records: store.records.map((r) => (r.id === id ? { ...r, lastValidatedAt: new Date(now).toISOString(), stale: false, staleReason: null } : r)),
  };
}

/** يسم سجلاً بالتقادم مع سبب صريح — يبقى مرئياً لكن لا يُعتمد كقاعدة. */
export function markStaleMemory(store: BrainMemoryStoreState, id: string, reason: string): BrainMemoryStoreState {
  return { records: store.records.map((r) => (r.id === id ? { ...r, stale: true, staleReason: reason } : r)) };
}

/** الذاكرة النشطة وغير المتقادمة فقط — هي التي تدخل القرار. */
export function activeBrainMemory(store: BrainMemoryStoreState, kind?: MemoryKind): BrainMemoryRecord[] {
  return store.records.filter((r) => r.status === 'active' && !r.stale && (!kind || r.kind === kind));
}

export interface BrainMemorySummary {
  total: number;
  active: number;
  stale: number;
  superseded: number;
  byKind: Record<string, number>;
  byOrigin: Record<string, number>;
  aiStatements: number;
  ownerPreferences: number;
  note: string;
}

export function summarizeBrainMemory(store: BrainMemoryStoreState): BrainMemorySummary {
  const records = store.records;
  const active = records.filter((r) => r.status === 'active' && !r.stale);
  const byKind: Record<string, number> = {};
  const byOrigin: Record<string, number> = {};
  for (const r of records) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    byOrigin[r.origin] = (byOrigin[r.origin] || 0) + 1;
  }
  return {
    total: records.length,
    active: active.length,
    stale: records.filter((r) => r.stale).length,
    superseded: records.filter((r) => r.status === 'superseded').length,
    byKind,
    byOrigin,
    aiStatements: records.filter((r) => r.origin === 'ai_statement').length,
    ownerPreferences: records.filter((r) => r.origin === 'owner_input').length,
    note: 'الذاكرة النشطة غير المتقادمة فقط تدخل القرار؛ وأقوال AI وتفضيلات المالك ليست حقائق تجارية.',
  };
}

/**
 * يحوّل الذاكرة النشطة إلى عناصر معرفة صادقة: الأصل يحدّد الحالة. قول AI →
 * فرضية؛ مالك → يحتاج تأكيداً؛ بيانات منصة/استنتاج بعيّنة كافية → حقيقة/استنتاج.
 */
export function memoryToKnowledge(store: BrainMemoryStoreState): KnowledgeItemLike[] {
  return activeBrainMemory(store).map((r) => {
    const hasSource = r.sourceRefs.length > 0;
    const derived = r.origin === 'derived';
    const hypothesis = r.origin === 'ai_statement';
    const requiresHumanInput = r.origin === 'owner_input';
    return {
      id: `mem:${r.id}`,
      statement: r.summary,
      source: hasSource ? r.sourceRefs[0] : null,
      sampleSize: r.sampleSize,
      derived,
      hypothesis,
      requiresHumanInput,
      confidence: r.confidence,
      limitations: r.staleReason || undefined,
    };
  });
}
