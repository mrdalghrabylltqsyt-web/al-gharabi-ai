/**
 * Research Engine + Multi-AI (Untrusted Input) — البحث الخارجي والذكاء الاصطناعي الخارجي.
 *
 * الغرض: تمثيل البحث الخارجي كـ**دليل له مصدر وطابع زمني**، وحماية الحقيقة التجارية
 * الداخلية من أن يطمسها مصدر خارجي. وأي مزوّد AI خارجي يُعامَل **مدخلاً غير موثوق**
 * (UNTRUSTED_INPUT) لا حقيقة.
 *
 * القواعد الملزمة:
 * - البحث الخارجي لا يُلغي أبداً حقيقة تجارية داخلية موثّقة (السعر الداخلي يبقى مرجعياً).
 * - كل عنصر بحث يحفظ: المصدر/المرجع/الطابع الزمني/الادّعاء/الموضوع/الثقة/الملاءمة/الاستخدام/التحقق.
 * - البحث القديم لا يظهر كحديث (STALE).
 * - لا يُحوَّل البحث فوراً إلى استراتيجية: NEW_INFORMATION → HYPOTHESIS → اختبار داخلي.
 *
 * منطق خالص: لا شبكة ولا أسرار — هذا **عقد** بحث، لا منفّذ شبكة.
 */

import type { FreshnessState } from './truth';

export type ResearchConfidence = 'low' | 'medium' | 'high';
export type ResearchRelevance = 'high' | 'medium' | 'low';
export type ResearchUse = 'not_used' | 'used_as_hypothesis' | 'used_as_context' | 'rejected';
export type ResearchVerification = 'unverified' | 'partially_verified' | 'verified_internal_test' | 'contradicted_internally';

export interface ResearchItem {
  id: string;
  topic: string;
  claim: string;
  /** المصدر الرسمي/المرجع إن وُجد. */
  source: string;
  /** رابط/مرجع موثّق إن وُجد (بلا سرّ). */
  reference: string | null;
  collectedAt: string;
  confidence: ResearchConfidence;
  relevance: ResearchRelevance;
  use: ResearchUse;
  verification: ResearchVerification;
  freshness: FreshnessState;
  limitations: string;
}

/** سياسة طزاجة البحث (بالدقائق) — بحث قديم لا يظهر كحديث. */
export const RESEARCH_FRESHNESS_MINUTES = 90 * 24 * 60;

export function researchFreshness(collectedAt: string | null, nowMs: number): FreshnessState {
  if (!collectedAt) return 'UNKNOWN';
  const at = Date.parse(collectedAt);
  if (!Number.isFinite(at)) return 'UNKNOWN';
  const ageMin = Math.max(0, (nowMs - at) / 60_000);
  if (ageMin <= RESEARCH_FRESHNESS_MINUTES * 0.6) return 'FRESH';
  if (ageMin <= RESEARCH_FRESHNESS_MINUTES) return 'AGING';
  return 'STALE';
}

export interface ResearchItemInput {
  id: string;
  topic: string;
  claim: string;
  source: string;
  reference?: string | null;
  collectedAt: string;
  confidence?: ResearchConfidence;
  relevance?: ResearchRelevance;
  nowMs: number;
}

/** يبني عنصر بحث مع حساب الطزاجة؛ لا يُعلن استخداماً ولا تحقّقاً بلا دليل. */
export function makeResearchItem(input: ResearchItemInput): ResearchItem {
  return {
    id: input.id,
    topic: input.topic,
    claim: input.claim,
    source: input.source,
    reference: input.reference ?? null,
    collectedAt: input.collectedAt,
    confidence: input.confidence ?? 'low',
    relevance: input.relevance ?? 'medium',
    use: 'not_used',
    verification: 'unverified',
    freshness: researchFreshness(input.collectedAt, input.nowMs),
    limitations: 'مصدر خارجي — دليل استشاري لا حقيقة تجارية داخلية.',
  };
}

/**
 * هل يجوز استخدام عنصر بحث في قرار؟ **لا** إن كان قديماً أو بلا مصدر، ولا يحلّ محل
 * الحقيقة الداخلية.
 */
export function canUseResearch(item: ResearchItem): { usable: boolean; reason: string } {
  if (!item.source) return { usable: false, reason: 'بلا مصدر — لا يُستخدم.' };
  if (item.freshness === 'STALE') return { usable: false, reason: 'بحث قديم — لا يظهر كحديث؛ يلزم تحديث.' };
  if (item.verification === 'contradicted_internally') return { usable: false, reason: 'ناقضه دليل داخلي — مرفوض.' };
  return { usable: true, reason: 'دليل خارجي طازج بمصدر معلن — يُستخدم كفرضية/سياق فقط.' };
}

/**
 * حرس الأولوية الداخلي: البحث الخارجي **لا يطمس** حقيقة تجارية داخلية. يُعيد القرار
 * مع سبب صريح.
 */
export function externalCannotOverrideInternal(input: {
  field: string;
  internal: { value: unknown; state: string; source: string | null };
  externalClaim: string;
}): { internalRemainsAuthoritative: boolean; reason: string } {
  const internalAuthoritative = input.internal.source !== null && ['VERIFIED', 'DERIVED', 'OBSERVED'].includes(input.internal.state);
  return {
    internalRemainsAuthoritative: internalAuthoritative,
    reason: internalAuthoritative
      ? `الحقيقة الداخلية الموثّقة لحقل «${input.field}» (${input.internal.source}) تبقى مرجعية؛ الادّعاء الخارجي («${input.externalClaim}») لا يستبدلها.`
      : `لا حقيقة داخلية موثّقة لحقل «${input.field}» — الادّعاء الخارجي يبقى فرضية تُختبر داخلياً، لا حقيقة.`,
  };
}

// ---------------------------------------------------------------------------
// Multi-AI / External AI — مدخل غير موثوق
// ---------------------------------------------------------------------------

export type AiTrust = 'UNTRUSTED_INPUT' | 'INTERNAL_VERIFIED';

export interface ExternalAiResponse {
  provider: string;
  claim: string;
  at: string;
  /** مزوّدو AI الخارجيون مدخلات غير موثوقة دائماً. */
  trust: AiTrust;
  confidence: ResearchConfidence;
  provenance: { provider: string; receivedAt: string };
}

/**
 * أي استجابة من مزوّد AI **خارجي** تُوسَم UNTRUSTED_INPUT — لا حقيقة، بغضّ النظر عن
 * المزوّد. تُستخدم للاستشارة/المقارنة/التوفيق فقط.
 */
export function markExternalAiResponse(input: { provider: string; claim: string; at: string; confidence?: ResearchConfidence }): ExternalAiResponse {
  return {
    provider: input.provider,
    claim: input.claim,
    at: input.at,
    trust: 'UNTRUSTED_INPUT',
    confidence: input.confidence ?? 'low',
    provenance: { provider: input.provider, receivedAt: input.at },
  };
}

/** المقارنة بين مزوّدين: تُعلن الاتفاق/الاختلاف، ولا تُرقّي أيّاً منهما إلى حقيقة. */
export function reconcileAiResponses(responses: ExternalAiResponse[]): {
  agreeing: boolean;
  providers: string[];
  note: string;
  trust: AiTrust;
} {
  const claims = new Set(responses.map((r) => r.claim.trim()));
  const agreeing = claims.size <= 1;
  return {
    agreeing,
    providers: responses.map((r) => r.provider),
    note: agreeing
      ? 'المزوّدون متفقون — يبقى الاتفاق مدخلاً غير موثوق يُختبر داخلياً.'
      : 'المزوّدون مختلفون — لا يُعتمد أي رأي؛ يلزم دليل داخلي لحسم الأمر.',
    trust: 'UNTRUSTED_INPUT',
  };
}

/** مسار البحث → التعلّم: NEW_INFORMATION → HYPOTHESIS → اختبار داخلي (لا استراتيجية مباشرة). */
export type ResearchToLearningStage = 'NEW_INFORMATION' | 'HYPOTHESIS' | 'INTERNAL_TEST' | 'REAL_RESULT' | 'LEARNING';

export interface ResearchToLearning {
  stage: ResearchToLearningStage;
  hypothesis: string | null;
  internalTestRequired: boolean;
  canBecomeStrategy: boolean;
  reason: string;
}

/**
 * يحوّل عنصر بحث إلى **فرضية** لا استراتيجية. الاستراتيجية لا تُبنى إلا بعد اختبار
 * داخلي ونتيجة حقيقية. وغياب المصداقية يمنع الترقية.
 */
export function researchToLearning(item: ResearchItem): ResearchToLearning {
  if (item.freshness === 'STALE' || !item.source) {
    return { stage: 'NEW_INFORMATION', hypothesis: null, internalTestRequired: false, canBecomeStrategy: false, reason: 'بحث قديم/بلا مصدر — لا يُبنى عليه.' };
  }
  if (item.verification === 'contradicted_internally') {
    return { stage: 'NEW_INFORMATION', hypothesis: null, internalTestRequired: false, canBecomeStrategy: false, reason: 'ناقضه دليل داخلي — مرفوض كأساس.' };
  }
  return {
    stage: 'HYPOTHESIS',
    hypothesis: item.claim,
    internalTestRequired: true,
    canBecomeStrategy: false,
    reason: 'معلومة خارجية → فرضية تُختبر داخلياً؛ لا تصبح استراتيجية إلا بنتيجة حقيقية من عملاء الغرابي.',
  };
}

export interface ResearchSummary {
  total: number;
  fresh: number;
  stale: number;
  usable: number;
  byVerification: Record<ResearchVerification, number>;
}

export function summarizeResearch(items: ResearchItem[]): ResearchSummary {
  const byVerification = Object.fromEntries(
    (['unverified', 'partially_verified', 'verified_internal_test', 'contradicted_internally'] as ResearchVerification[]).map((v) => [v, 0]),
  ) as Record<ResearchVerification, number>;
  let fresh = 0; let stale = 0; let usable = 0;
  for (const it of items) {
    byVerification[it.verification] = (byVerification[it.verification] || 0) + 1;
    if (it.freshness === 'STALE') stale += 1; else fresh += 1;
    if (canUseResearch(it).usable) usable += 1;
  }
  return { total: items.length, fresh, stale, usable, byVerification };
}
