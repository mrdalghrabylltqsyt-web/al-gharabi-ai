/**
 * Memory Recall Engine — استدعاء الذاكرة ذا الصلة قبل القرار (منطق خالص).
 *
 * الغرض: ألّا يُحمَّل كل الذاكرة على كل حدث، بل تُستدعى السجلات **ذات الصلة** فقط
 * من **نفس** مخزن Brain Memory القائم (بلا نسخة ثانية). الصلة محسوبة حتمياً من:
 *   - تطابق المنصة (رفع قوي) والموضوع/الكلمات المفتاحية،
 *   - نوع الذاكرة المطلوب للحدث،
 *   - طزاجة السجل (غير المتقادم يُقدَّم)،
 *   - قوة الدليل (عيّنة أكبر = أولى عند التعادل).
 *
 * لا اختراع: السجلات المتقادمة (stale) لا تُقدَّم للقرار (يُعلن ذلك)، والإخفاقات
 * السابقة تُستدعى صراحةً حتى لا تُعاد التجربة بلا سبب.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import type { BrainMemoryStoreState, BrainMemoryRecord } from '../memory/store';
import type { MemoryKind } from '../memory/longTerm';
import type { MemoryRecallResult, MemoryRecallCandidate } from './types';

export interface RecallQuery {
  now: number;
  platform: string | null;
  /** نص الموضوع/الحدث للاستدعاء بالكلمات المفتاحية. */
  text: string;
  /** أنواع الذاكرة الأكثر صلة بالحدث. */
  kinds?: MemoryKind[];
  /** أنواع الذاكرة للأهداف التجارية المباشرة (شراء/تواصل) — تُمنح وزناً. */
  maxResults?: number;
  maxCandidates?: number;
}

/** يطبّع نصاً عربياً لمطابقة الكلمات المفتاحية (توحيد الألف/التاء/الياء). */
function normalizeForMatch(input: string): string {
  return String(input ?? '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const STOPWORDS = new Set(['من', 'في', 'على', 'عن', 'الى', 'إلى', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'ما', 'هل', 'لا', 'و', 'او', 'أو', 'يوجد', 'موجود']);

/** يستخرج كلمات مفتاحية معتبرة (أطوال ≥ 3، بلا كلمات وقف). */
export function keywords(text: string): string[] {
  const norm = normalizeForMatch(text);
  return [...new Set(norm.split(/[^a-z0-9\u0600-\u06FF]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w)))].slice(0, 24);
}

const DEFAULT_RECALL_KINDS: MemoryKind[] = ['business', 'audience', 'platform', 'timing', 'conversation', 'outcome', 'failure', 'decision', 'content', 'experiment'];

/**
 * يقوّي السجل حسب الصلة ويرجع الأسباب (شفافية الاستدعاء). متقادم ⇒ صلة صفرية
 * (لا يُقدَّم للقرار) مع سبب صريح.
 */
export function scoreMemoryRecord(record: BrainMemoryRecord, query: RecallQuery, kws: string[]): MemoryRecallCandidate | null {
  if (record.status !== 'active') return null;
  const reasons: string[] = [];
  let relevance = 0;

  // 1) المنصة: تطابق => رفع قوي؛ سجل عام (null) => بلا رفع؛ اختلاف => لا يُستدعى إلا بالكلمات.
  const recordPlatform = record.platform ?? null;
  if (query.platform && recordPlatform === query.platform) { relevance += 3; reasons.push('نفس المنصة'); }
  else if (recordPlatform && query.platform && recordPlatform !== query.platform) { relevance -= 1; reasons.push('منصة مختلفة'); }

  // 2) نوع الذاكرة.
  const wantedKinds = query.kinds && query.kinds.length ? query.kinds : DEFAULT_RECALL_KINDS;
  if (wantedKinds.includes(record.kind)) { relevance += 1; reasons.push('نوع ذاكرة ذو صلة'); }

  // 3) الكلمات المفتاحية في الملخّص.
  const hay = normalizeForMatch(record.summary);
  let matches = 0;
  for (const kw of kws) if (hay.includes(kw)) matches += 1;
  if (matches > 0) { relevance += Math.min(4, matches); reasons.push(`كلمات مفتاحية مشتركة (${matches})`); }

  // 4) الطزاجة: المتقادم لا يُقدَّم للقرار.
  if (record.stale) { reasons.push('متقادم — لا يُقدَّم للقرار'); relevance = 0; return { recordId: record.id, kind: record.kind, origin: record.origin, summary: record.summary, platform: record.platform, relevance, reasons, sampleSize: record.sampleSize, stale: true }; }

  // 5) قوة الدليل.
  if (record.sampleSize >= 3) { relevance += 0.5; reasons.push('عيّنة كافية'); }
  if (record.origin === 'platform_data' || record.origin === 'derived') relevance += 0.5;
  if (record.kind === 'failure') { relevance += 0.5; reasons.push('درس إخفاق سابق'); }

  if (relevance <= 0) return null;
  return { recordId: record.id, kind: record.kind, origin: record.origin, summary: record.summary, platform: record.platform, relevance, reasons, sampleSize: record.sampleSize, stale: false };
}

/**
 * يستدعي السجلات ذات الصلة فقط (بحدّ أعلى)، مرتّبة بالصلة. يعلن عدد المتقادم
 * المستبعد وعدد المرشّحين قبل القطع (بلا تحميل كل الذاكرة في القرار).
 */
export function recallMemories(store: BrainMemoryStoreState, query: RecallQuery): MemoryRecallResult {
  const maxResults = Math.max(1, query.maxResults ?? 8);
  const kws = keywords(query.text);
  const records = store.records || [];
  const scored: MemoryRecallCandidate[] = [];
  let skippedStale = 0;
  for (const r of records) {
    const c = scoreMemoryRecord(r, query, kws);
    if (!c) continue;
    if (c.stale) { skippedStale += 1; continue; }
    scored.push(c);
  }
  scored.sort((a, b) => (b.relevance - a.relevance) || (b.sampleSize - a.sampleSize));
  const candidates = scored.slice(0, maxResults);
  return {
    candidates,
    considered: records.filter((r) => r.status === 'active').length,
    used: candidates.length,
    note: `استُدعيت ${candidates.length} من ${records.filter((r) => r.status === 'active').length} سجلاً نشطاً حسب الصلة؛ ${skippedStale} متقادم مستبعد من القرار.`,
  };
}

/** نفس بذرة الاختبار: هل يحتاج قرار غياب كلمات مفتاحية إلى تحميل كل الذاكرة؟ لا. */
export function recallNeedsFullStore(): { needsFullStore: boolean; reason: string } {
  return { needsFullStore: false, reason: 'الاستدعاء يعمل بالمطابقة الاستدلالية؛ لا يُحمَّل كل المخزن على كل قرار.' };
}
