/**
 * Unified Commercial Memory — ذاكرة تجارية موحّدة (منطق خالص).
 *
 * الغرض: فصل أنواع المعرفة التجارية صراحةً، مع الحفاظ على **أصل المعرفة** لكل عنصر،
 * ومنع تحوّل فرضية AI إلى حقيقة تجارية دائمة بلا دليل.
 *
 * الأنواع: FACT · OBSERVATION · DERIVED_KNOWLEDGE · HYPOTHESIS · LEARNING ·
 *          RECOMMENDATION · DECISION · RESULT
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر `nowMs`.
 */

export type CommercialMemoryKind =
  | 'FACT' | 'OBSERVATION' | 'DERIVED_KNOWLEDGE' | 'HYPOTHESIS'
  | 'LEARNING' | 'RECOMMENDATION' | 'DECISION' | 'RESULT';

export const COMMERCIAL_MEMORY_LABELS_AR: Record<CommercialMemoryKind, string> = Object.freeze({
  FACT: 'حقيقة موثّقة',
  OBSERVATION: 'ملاحظة من بيانات',
  DERIVED_KNOWLEDGE: 'معرفة مستنتجة',
  HYPOTHESIS: 'فرضية',
  LEARNING: 'تعلّم',
  RECOMMENDATION: 'توصية',
  DECISION: 'قرار',
  RESULT: 'نتيجة',
});

/** أصل المعرفة — قول AI لا يصبح حقيقة تجارية أبداً. */
export type CommercialMemoryOrigin = 'platform_data' | 'derived' | 'owner_input' | 'ai_statement' | 'research_external';

export interface CommercialMemoryItem {
  id: string;
  kind: CommercialMemoryKind;
  statement: string;
  origin: CommercialMemoryOrigin;
  source: string;
  provenance: string[];
  sampleSize: number;
  confidence: 'low' | 'medium' | 'high';
  at: string;
  /** هل هذا العنصر حقيقة تجارية معتمدة (لا فرضية)؟ */
  isCommercialFact: boolean;
  refs?: Record<string, string | null>;
  limitations: string;
}

/** الأنواع التي **يمكن** أن تكون حقيقة تجارية (بشرط أصل موثوق + عيّنة). */
const FACTUAL_KINDS: readonly CommercialMemoryKind[] = Object.freeze(['FACT', 'OBSERVATION', 'DERIVED_KNOWLEDGE', 'RESULT']);

export function isTrustedOrigin(origin: CommercialMemoryOrigin): boolean {
  return origin !== 'ai_statement' && origin !== 'research_external';
}

/**
 * يبني عنصر ذاكرة تجارية مع حارس صدق: قول AI/بحث خارجي لا يصبح حقيقة تجارية؛ يُخزَّن
 * كفرضية/ملاحظة قابلة للمراجعة.
 */
export function makeCommercialMemoryItem(input: {
  id: string;
  kind: CommercialMemoryKind;
  statement: string;
  origin: CommercialMemoryOrigin;
  source: string;
  sampleSize: number;
  nowMs: number;
  provenance?: string[];
  confidence?: 'low' | 'medium' | 'high';
  refs?: Record<string, string | null>;
}): CommercialMemoryItem {
  const trusted = isTrustedOrigin(input.origin);
  const canBeFact = FACTUAL_KINDS.includes(input.kind) && trusted && input.sampleSize >= 3;
  const kind: CommercialMemoryKind = (FACTUAL_KINDS.includes(input.kind) && !canBeFact) ? 'HYPOTHESIS' : input.kind;
  const confidence = canBeFact ? (input.confidence || (input.sampleSize >= 5 ? 'high' : 'medium')) : 'low';
  return {
    id: input.id,
    kind,
    statement: input.statement,
    origin: input.origin,
    source: input.source,
    provenance: input.provenance?.length ? [...input.provenance] : [input.source],
    sampleSize: input.sampleSize,
    confidence,
    at: new Date(input.nowMs).toISOString(),
    isCommercialFact: canBeFact,
    refs: input.refs,
    limitations: canBeFact
      ? 'حقيقة تجارية من مصدر موثوق بعيّنة كافية؛ تُراجَع عند تغيّر الدليل.'
      : (trusted
        ? 'عيّنة غير كافية — تبقى فرضية حتى تتوفّر أدلة.'
        : 'مصدر غير موثوق (AI/بحث خارجي) — لا يصبح حقيقة تجارية بلا تحقّق داخلي.'),
  };
}

export interface CommercialMemoryStore {
  items: CommercialMemoryItem[];
}

export function emptyCommercialMemory(): CommercialMemoryStore { return { items: [] }; }

/** يضيف عنصراً بلا تكرار (حسب المعرّف). */
export function rememberCommercial(store: CommercialMemoryStore, item: CommercialMemoryItem): CommercialMemoryStore {
  if (store.items.some((i) => i.id === item.id)) return store;
  return { items: [...store.items, item] };
}

export interface CommercialMemorySummary {
  total: number;
  facts: number;
  hypotheses: number;
  byKind: Record<CommercialMemoryKind, number>;
  untrustedOrigins: number;
  limitations: string[];
}

export function summarizeCommercialMemory(store: CommercialMemoryStore): CommercialMemorySummary {
  const byKind = Object.fromEntries(
    (Object.keys(COMMERCIAL_MEMORY_LABELS_AR) as CommercialMemoryKind[]).map((k) => [k, 0]),
  ) as Record<CommercialMemoryKind, number>;
  for (const i of store.items) byKind[i.kind] = (byKind[i.kind] || 0) + 1;
  return {
    total: store.items.length,
    facts: store.items.filter((i) => i.isCommercialFact).length,
    hypotheses: byKind.HYPOTHESIS,
    byKind,
    untrustedOrigins: store.items.filter((i) => !isTrustedOrigin(i.origin)).length,
    limitations: ['لا حقيقة تجارية من قول AI أو بحث خارجي بلا تحقّق داخلي.'],
  };
}

/** يحوّل مصفوفة سجلات الذاكرة المحفوظة إلى مخزن (توافق خلفي مع أي شكل قديم). */
export function normalizeCommercialMemory(raw: any): CommercialMemoryStore {
  const items = Array.isArray(raw?.items) ? raw.items.filter((i: any) => i && typeof i.id === 'string' && typeof i.kind === 'string') : [];
  return { items: items.slice(-2000) };
}
