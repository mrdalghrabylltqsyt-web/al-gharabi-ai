/**
 * Commercial Memory — ربط العقل التجاري بالذاكرة المركزية الدائمة (منطق خالص).
 *
 * يحوّل الحقائق التجارية المرصودة (طلب متكرر، منتج مطلوب، اعتراض متكرر، بيع
 * موثّق، نتيجة حملة) إلى سجلات ذاكرة دائمة عبر نفس بنية الذاكرة المركزية، مع
 * **فصل صريح** بين:
 *   - OBSERVED FACT  → origin = 'platform_data' (ملاحَظ من سجل حقيقي)
 *   - INFERENCE      → origin = 'derived'        (استنتاج حسابي من حقيقة)
 *   - HYPOTHESIS     → origin = 'ai_statement'   (فرضية لا تُخزَّن كحقيقة)
 *
 * **لا يُخزَّن تخمين كحقيقة.** الفرص (فرضيات) تُوسَم `ai_statement` فلا تدخل
 * القرار كحقيقة تجارية. البيع يُخزَّن `platform_data` بمعرّف البيع فقط.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import { toMemoryRecord, upsertMemoryRecord, type BrainMemoryRecord, type BrainMemoryStoreState } from '../memory/store';
import { makeMemoryEntry, type MemoryOrigin } from '../memory/longTerm';
import { type CommercialRuntime } from './commercialRuntime';

/** البادئة تفصل ذاكرة العقل التجاري عن بقية الذاكرة وتُبقيها قابلة للتتبع. */
export const COMMERCIAL_MEMORY_PREFIX = 'commercial:';

interface CommercialMemorySeed {
  id: string;
  kind: BrainMemoryRecord['kind'];
  origin: MemoryOrigin;
  summary: string;
  sourceRefs: string[];
  sampleSize: number;
  confidence: 'low' | 'medium' | 'high';
  platform: string | null;
  refs?: Record<string, string | null>;
}

/**
 * يبني سجلات الذاكرة التجارية من الحالة الحقيقية. كل سجل يحمل أصله ومصدره
 * وعيّنته؛ والفرضية تبقى `ai_statement` (لا تُرقّى إلى حقيقة).
 */
export function buildCommercialMemorySeeds(runtime: CommercialRuntime, now: number): BrainMemoryRecord[] {
  const seeds: CommercialMemorySeed[] = [];
  const recordedAt = new Date(now).toISOString();

  // 1) OBSERVED FACT — طلب متكرر على منتج/نوع (عيّنة كافية فقط).
  for (const agg of runtime.demandAggregates) {
    if (agg.strength === 'INSUFFICIENT_DATA') continue;
    const product = agg.productId ? runtime.catalog.find((p) => p.id === agg.productId) : undefined;
    const label = product ? product.name : (agg.productId || 'موضوع عام');
    seeds.push({
      id: `${COMMERCIAL_MEMORY_PREFIX}demand:${agg.kind}:${agg.productId || 'general'}`,
      kind: 'audience',
      origin: 'platform_data',
      summary: `طلب متكرر (${agg.count} إشارة) — ${agg.kind} على ${label}.`,
      sourceRefs: [agg.source],
      sampleSize: agg.sampleSize,
      confidence: agg.confidence,
      platform: null,
      refs: { productId: agg.productId, kind: agg.kind, periodDays: agg.periodDays !== null ? String(agg.periodDays) : null },
    });
  }

  // 2) OBSERVED FACT — بيع موثّق (بمعرّف بيع حقيقي فقط).
  for (const journey of runtime.journeys) {
    if (!journey.saleVerified) continue;
    const saleEvidence = journey.evidence.find((e) => e.stage === 'VERIFIED_SALE' && e.verified);
    seeds.push({
      id: `${COMMERCIAL_MEMORY_PREFIX}sale:${journey.subjectKey}`,
      kind: 'outcome',
      origin: 'platform_data',
      summary: `بيع موثّق للعميل ${journey.subjectKey}${journey.productId ? ` — منتج ${journey.productId}` : ''}.`,
      sourceRefs: [saleEvidence?.source || 'sales:workspace.sales'],
      sampleSize: 1,
      confidence: 'high',
      platform: journey.platform === 'cross_platform' ? null : journey.platform,
      refs: { productId: journey.productId },
    });
  }

  // 3) INFERENCE — منتجات مطلوبة بقدرة إجابة محدودة (استنتاج من حقائق).
  const incomplete = runtime.catalog.filter((p) => runtime.catalogReadiness.incomplete > 0 && p.ownerApproval !== 'rejected');
  const missing = incomplete.filter((p) => p.cashPrice.state !== 'VERIFIED' || p.availability.state !== 'VERIFIED');
  if (missing.length) {
    seeds.push({
      id: `${COMMERCIAL_MEMORY_PREFIX}inference:missing-info`,
      kind: 'business',
      origin: 'derived',
      summary: `${missing.length} منتجاً بلا سعر/توفر موثّق — يمنع الإجابة التجارية الدقيقة.`,
      sourceRefs: ['owner_recorded:workspace.products'],
      sampleSize: missing.length,
      confidence: 'medium',
      platform: null,
      refs: { productIds: missing.slice(0, 20).map((p) => p.id).join(',') },
    });
  }

  // 4) OBSERVED FACT — اعتراض متكرر (من استدلال المبيعات المدعوم).
  for (const report of runtime.foundation.salesReasoning) {
    const objection = report.supportedBlockers.find((b) => b.blocker === 'repeated_objection');
    if (!objection) continue;
    seeds.push({
      id: `${COMMERCIAL_MEMORY_PREFIX}objection:${report.productId}`,
      kind: 'audience',
      origin: 'platform_data',
      summary: `اعتراض متكرر على المنتج ${report.productName}: ${objection.whatWeKnow.join(' ')}`.slice(0, 300),
      sourceRefs: ['socialComments:workspace'],
      sampleSize: objection.evidence.length || 1,
      confidence: 'medium',
      platform: null,
      refs: { productId: report.productId },
    });
  }

  // 5) HYPOTHESIS — الفرص لا تُخزَّن كحقيقة (ai_statement).
  for (const opp of runtime.opportunities) {
    if (!opp.sufficientSample) continue;
    seeds.push({
      id: `${COMMERCIAL_MEMORY_PREFIX}hypothesis:${opp.id}`,
      kind: 'experiment',
      origin: 'ai_statement',
      summary: `فرضية: ${opp.hypothesis.statement}`.slice(0, 300),
      sourceRefs: [opp.source],
      sampleSize: opp.sampleSize,
      confidence: opp.confidence,
      platform: opp.platform === 'cross_platform' ? null : opp.platform,
      refs: { productId: opp.productId, kind: opp.kind },
    });
  }

  return seeds.map((s) => toMemoryRecord(makeMemoryEntry({
    id: s.id,
    kind: s.kind,
    statement: s.summary,
    origin: s.origin,
    source: s.sourceRefs[0] || 'commercial',
    now,
    sampleSize: s.sampleSize,
    confidence: s.confidence,
    refs: s.refs,
    platform: s.platform,
    sourceRefs: s.sourceRefs,
    summary: s.summary,
    lastValidatedAt: recordedAt,
  })));
}

/**
 * يدمج السجلات الجديدة في مخزن الذاكرة الدائم بلا تكرار (نفس منطق الذاكرة
 * المركزية) ويعيد المخزن الجديد + عدد المُضاف. لا يكتب إلى أي مخزن — الكتابة
 * مسؤولية الخادم.
 */
export function mergeCommercialMemory(store: BrainMemoryStoreState, records: BrainMemoryRecord[]): { store: BrainMemoryStoreState; added: number } {
  let next = store;
  let added = 0;
  for (const record of records) {
    const res = upsertMemoryRecord(next, record);
    next = res.store;
    if (res.added) added += 1;
  }
  return { store: next, added };
}

/** ملخّص ذاكرة العقل التجاري (بلا أي سرّ) للعرض. */
export function summarizeCommercialMemory(store: BrainMemoryStoreState): {
  total: number;
  observedFacts: number;
  inferences: number;
  hypotheses: number;
  note: string;
} {
  const records = store.records.filter((r) => r.id.startsWith(COMMERCIAL_MEMORY_PREFIX));
  return {
    total: records.length,
    observedFacts: records.filter((r) => r.origin === 'platform_data').length,
    inferences: records.filter((r) => r.origin === 'derived').length,
    hypotheses: records.filter((r) => r.origin === 'ai_statement').length,
    note: 'الحقائق الملاحَظة والاستنتاجات والفرضيات مفصولة صراحةً؛ الفرضية لا تُخزَّن كحقيقة تجارية.',
  };
}
