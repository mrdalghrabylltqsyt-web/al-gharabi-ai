/**
 * Long-Term Memory — ذاكرة العقل طويلة المدى (منطق خالص قابل للاختبار).
 *
 * الغرض: أن يتذكّر العقل خبرته لا نتائج اليوم فقط، وأن يتذكّر ما فشل ولماذا حتى
 * لا يعيد نفس التجربة بلا سبب. كل عنصر ذاكرة يحمل أصله ومصدره وحالته وثقته،
 * **ولا يتحوّل إلى حقيقة تجارية لمجرد أن الذكاء الاصطناعي قاله** — بل تبقى
 * `owner_preference` أو `hypothesis` حتى تُثبت ببيانات حقيقية.
 *
 * لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

export type MemoryKind =
  | 'content'
  | 'audience'
  | 'platform'
  | 'timing'
  | 'experiment'
  | 'conversation'
  | 'business'
  | 'decision'
  | 'outcome'
  | 'failure';

export const MEMORY_KIND_LABELS_AR: Record<MemoryKind, string> = Object.freeze({
  content: 'ذاكرة المحتوى',
  audience: 'ذاكرة الجمهور',
  platform: 'ذاكرة المنصة',
  timing: 'ذاكرة التوقيت',
  experiment: 'ذاكرة التجارب',
  conversation: 'ذاكرة المحادثة',
  business: 'ذاكرة الأعمال',
  decision: 'ذاكرة القرارات',
  outcome: 'ذاكرة النتائج',
  failure: 'ذاكرة الإخفاقات',
});

/** أصل المعرفة: بيانات منصة حقيقية، استنتاج، ملاحظة مالك، أو قول AI (لا يصبح حقيقة). */
export type MemoryOrigin = 'platform_data' | 'derived' | 'owner_input' | 'ai_statement';

export type MemoryStatus = 'active' | 'superseded' | 'retracted';

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  statement: string;
  origin: MemoryOrigin;
  source: string;
  createdAt: string;
  lastValidatedAt: string | null;
  confidence: 'low' | 'medium' | 'high';
  status: MemoryStatus;
  /** عيّنة الدليل التي بُنيت عليها الذاكرة. */
  sampleSize: number;
  limitations: string;
  /** معرّفات مرتبطة (منصة/تجربة/قرار) للربط. */
  refs?: Record<string, string | null>;
  /** المنصة المرتبطة (أو null للذاكرة العامة). */
  platform?: string | null;
  /** مراجع المصادر (أسماء واجهات/سجلات) — بلا أي سرّ. */
  sourceRefs?: string[];
  /** خلاصة قصيرة تُستخدم كحقيقة/ملخّص في السجل الدائم. */
  summary?: string;
  relatedGoal?: string | null;
  relatedExperiment?: string | null;
}

/**
 * عقد أدنى لعنصر معرفة قابل للتحويل إلى طبقة الحقيقة (`makeKnowledgeItem`)،
 * يُستخدم لتفادي استيراد دوري بين الذاكرة وطبقة الحقيقة.
 */
export interface KnowledgeItemLike {
  id: string;
  statement: string;
  source: string | null;
  sampleSize: number;
  derived?: boolean;
  hypothesis?: boolean;
  requiresHumanInput?: boolean;
  confidence?: 'low' | 'medium' | 'high';
  limitations?: string;
}

/** قول AI لا يصبح حقيقة تجارية أبداً؛ يُخزَّن كفرضية/ملاحظة قابلة للمراجعة. */
export function isAiStatementTrusted(origin: MemoryOrigin): boolean {
  return origin !== 'ai_statement';
}

/**
 * يبني عنصر ذاكرة مع حارس صدق: قول AI يُسقَط تلقائياً إلى ثقة منخفضة، ولا يُعتبر
 * مصدراً كافياً لحقيقة تجارية.
 */
export function makeMemoryEntry(input: {
  id: string;
  kind: MemoryKind;
  statement: string;
  origin: MemoryOrigin;
  source: string;
  now: number;
  sampleSize: number;
  confidence?: 'low' | 'medium' | 'high';
  limitations?: string;
  refs?: Record<string, string | null>;
  lastValidatedAt?: string | null;
  platform?: string | null;
  sourceRefs?: string[];
  summary?: string;
  relatedGoal?: string | null;
  relatedExperiment?: string | null;
}): MemoryEntry {
  const trusted = isAiStatementTrusted(input.origin);
  const confidence = trusted
    ? (input.confidence || (input.sampleSize >= 3 ? 'medium' : 'low'))
    : 'low';
  const sourceRefs = input.sourceRefs && input.sourceRefs.length
    ? input.sourceRefs
    : (input.source ? [input.source] : []);
  return {
    id: input.id,
    kind: input.kind,
    statement: input.statement,
    origin: input.origin,
    source: input.source,
    createdAt: new Date(input.now).toISOString(),
    lastValidatedAt: input.lastValidatedAt ?? null,
    confidence,
    status: 'active',
    sampleSize: input.sampleSize,
    limitations: input.limitations || (
      trusted
        ? 'ذاكرة من بيانات فعلية؛ تُراجَع دورياً وتُستبدل عند تغيّر الدليل.'
        : 'قول مولَّد بالذكاء الاصطناعي؛ لا يُعتبر حقيقة — يحتاج تأكيداً ببيانات أو مالك.'
    ),
    refs: input.refs,
    platform: input.platform ?? (input.refs?.platform ?? null),
    sourceRefs,
    summary: input.summary || input.statement,
    relatedGoal: input.relatedGoal ?? null,
    relatedExperiment: input.relatedExperiment ?? null,
  };
}

export interface MemoryStore {
  entries: MemoryEntry[];
}

export function emptyMemory(): MemoryStore {
  return { entries: [] };
}

/** يضيف عنصراً؛ عند تكرار نفس `id` يُستبدل القديم بحالة `superseded` (بلا فقد تاريخ). */
export function remember(store: MemoryStore, entry: MemoryEntry): MemoryStore {
  const existing = store.entries.find((e) => e.id === entry.id);
  if (!existing) return { entries: [...store.entries, entry] };
  return {
    entries: [
      ...store.entries.map((e) => (e.id === entry.id ? { ...e, status: 'superseded' as MemoryStatus } : e)),
      entry,
    ],
  };
}

/** الذاكرة النشطة فقط (بلا عناصر مُستبدلة/مسحوبة). */
export function activeMemories(store: MemoryStore, kind?: MemoryKind): MemoryEntry[] {
  return store.entries.filter((e) => e.status === 'active' && (!kind || e.kind === kind));
}

/**
 * بحث في الذاكرة عن درس فشل سابق لنفس الموضوع/المتغير — يمنع إعادة تجربة فاشلة
 * بلا سبب جديد.
 */
export function findPriorFailures(store: MemoryStore, matcher: (e: MemoryEntry) => boolean): MemoryEntry[] {
  return activeMemories(store, 'failure').filter(matcher);
}

/** هل جرّبنا هذا المتغير وفشل سابقاً؟ يعيد الدليل بدل مجرد نعم/لا. */
export function previouslyFailed(store: MemoryStore, variable: string): { failed: boolean; evidence: MemoryEntry[] } {
  const evidence = findPriorFailures(store, (e) => (e.refs?.variable || '') === variable);
  return { failed: evidence.length > 0, evidence };
}

export interface MemorySummary {
  total: number;
  active: number;
  byKind: Record<MemoryKind, number>;
  aiStatements: number;
  note: string;
}

export function summarizeMemory(store: MemoryStore): MemorySummary {
  const active = store.entries.filter((e) => e.status === 'active');
  const byKind = Object.keys(MEMORY_KIND_LABELS_AR).reduce((acc, k) => {
    acc[k as MemoryKind] = active.filter((e) => e.kind === k).length;
    return acc;
  }, {} as Record<MemoryKind, number>);
  return {
    total: store.entries.length,
    active: active.length,
    byKind,
    aiStatements: store.entries.filter((e) => e.origin === 'ai_statement').length,
    note: 'الذاكرة النشطة فقط تدخل القرار؛ وأقوال الذكاء الاصطناعي لا تُعتبر حقائق.',
  };
}
