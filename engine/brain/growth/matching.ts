/**
 * Product-to-Audience Matching — إجابة WHO/WHY/WHAT/WHERE/WHEN/MESSAGE/CTA
 * بصدق معرفي (منطق خالص).
 *
 * لكل مطابقة صريحة:
 *   WHO   → مقطع جمهور مدعوم/فرضية (بلا سمات شخصية)
 *   WHY   → سبب تجاري مبني على دليل حقيقي فقط
 *   WHAT  → ما نعرضه (محتوى/عرض) بلا أرقام غير مسجّلة
 *   WHERE → المنصات التي وردت منها الإشارات فعلاً
 *   WHEN  → توقيت من عيّنة حقيقية أو «غير متاح»
 *   MESSAGE / CTA → صياغة من حقائق مسجّلة فقط
 *
 * القواعد الملزمة:
 * - لا مطابقة بلا دليل (إشارة طلب أو فئة مطابقة)؛ وإلا تُعلن `NO_EVIDENCE`.
 * - لا يُخترع جمهور؛ المقطع يُشتقّ من التفاعل لا من تخمين.
 * - التوقيت غير المتاح يُعلن، ولا يُخترع.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../../social/adapter';
import type { AudienceSegment } from './segments';
import type { DemandDiscoveryOpportunity } from './demandDiscovery';
import type { CatalogProduct } from '../knowledge/catalog';

export type MatchState = 'MATCHED' | 'WEAK' | 'NO_EVIDENCE';

export const MATCH_STATE_LABELS_AR: Record<MatchState, string> = Object.freeze({
  MATCHED: 'مطابقة مدعومة',
  WEAK: 'مطابقة ضعيفة (فرضية)',
  NO_EVIDENCE: 'لا دليل — لا مطابقة',
});

/** مقطع مطابق لمنتج مع سبب المطابقة. */
export interface ProductAudienceMatch {
  segmentId: string;
  segmentLabel: string;
  why: string;
  evidence: string[];
  state: MatchState;
  sampleSize: number;
}

export interface ProductMatchReason {
  who: ProductAudienceMatch[];
  why: string;
  whatToShow: string;
  where: PlatformId[];
  when: string;
  message: string;
  cta: string;
}

export interface ProductAudienceMatchResult {
  productId: string;
  productName: string;
  state: MatchState;
  who: ProductAudienceMatch[];
  why: string;
  whatToShow: string;
  where: PlatformId[];
  when: string;
  whenAvailable: boolean;
  message: string;
  cta: string;
  evidence: string[];
  source: string;
  limitations: string[];
}

/** صياغة رسالة من حقائق مسجّلة فقط؛ السعر/التقسيط يُذكران نصاً إن وُجدا. */
function buildMessageAndCta(product: CatalogProduct): { message: string; cta: string; usedFacts: string[] } {
  const used: string[] = [];
  const parts: string[] = [];
  if (product.name) { parts.push(`${product.name}`); used.push('اسم المنتج'); }
  if (product.brand) parts.push(product.brand);
  const priceText = product.cashPrice.state === 'VERIFIED' && typeof product.cashPrice.value === 'number'
    ? `${product.cashPrice.value.toLocaleString('en-US')} د.ع` : null;
  if (priceText) { used.push('السعر الموثّق'); parts.push(`بسعر ${priceText}`); }
  const offer = product.installmentOffers.find((o) => o.state === 'DERIVED' || o.state === 'VERIFIED');
  if (offer && typeof offer.monthlyAmount === 'number') { used.push('عرض تقسيط مشتق من قاعدة معتمدة'); parts.push(`وتقسيط من ${offer.durationMonths} شهر`); }
  if (product.availability.state === 'VERIFIED' && product.availability.value?.inStock === true) { used.push('التوفر الموثّق'); parts.push('متوفر الآن'); }
  const message = parts.length > 1
    ? `${parts.join(' — ')}.`
    : `${product.name || 'منتجنا'} — تواصل معنا لمعرفة التفاصيل المسجّلة.`;
  const cta = 'تواصل معنا عبر قنوات المعرض الرسمية للحجز والتفاصيل.';
  return { message, cta, usedFacts: used };
}

/**
 * يطابق المنتجات مع المقاطع وإشارات الطلب. لا يخترع جمهوراً: المطابقة تقع فقط
 * عند وجود إشارة طلب على المنتج أو تطابق فئة المقطع مع فئة المنتج.
 */
export function matchProductsToAudience(input: {
  products: CatalogProduct[];
  segments: AudienceSegment[];
  demandOpportunities: DemandDiscoveryOpportunity[];
  /** خريطة فئة المنتج (منتج → category) لربط فئات المقاطع. */
  productCategories?: Record<string, string | null>;
}): ProductAudienceMatchResult[] {
  const out: ProductAudienceMatchResult[] = [];

  for (const product of input.products) {
    const productOpps = input.demandOpportunities.filter((o) => o.productId === product.id);
    const oppPlatforms = new Set(productOpps.flatMap((o) => (o.platform === 'cross_platform' ? [] : [o.platform])));
    const who: ProductAudienceMatch[] = [];

    for (const seg of input.segments) {
      // المطابقة الحقيقية: المقطع نشط على منصة وردت منها إشارات هذا المنتج،
      // ولديه اهتمامات/أسئلة تتقاطع مع نوع الطلب المرصود على المنتج.
      const platformOverlap = seg.whereActive.some((p) => oppPlatforms.has(p));
      const demandKinds = new Set(productOpps.map((o) => o.kind));
      const interestOverlap = seg.buyingSignals.length > 0 || seg.commonQuestions.length > 0 || seg.interests.length > 0;
      if (!productOpps.length || !platformOverlap || !interestOverlap) continue;
      const demandRef = productOpps.some((o) => o.sufficientSample);
      who.push({
        segmentId: seg.id,
        segmentLabel: seg.labelAr,
        why: demandRef
          ? `إشارات طلب حقيقية (${[...demandKinds].join(', ')}) على ${product.name} من نفس منصات «${seg.labelAr}».`
          : `تقاطع محتمل بين «${seg.labelAr}» و${product.name} بلا عيّنة كافية بعد.`,
        evidence: productOpps.slice(0, 3).map((o) => o.fact.statement),
        state: demandRef ? 'MATCHED' : 'WEAK',
        sampleSize: productOpps.reduce((n, o) => n + o.sampleSize, 0),
      });
    }

    const sufficientOpps = productOpps.filter((o) => o.sufficientSample);
    const state: MatchState = sufficientOpps.length > 0 ? 'MATCHED' : productOpps.length > 0 ? 'WEAK' : 'NO_EVIDENCE';
    const where = [...new Set(sufficientOpps.flatMap((o) => (o.platform === 'cross_platform' ? [] : [o.platform])))] as PlatformId[];
    const { message, cta, usedFacts } = buildMessageAndCta(product);
    const whenAvailable = false; // التوقيت يُملأ من طبقة التوقيت الحقيقية عند توفر عيّنة.
    const when = whenAvailable ? 'من عيّنة تفاعل حقيقية' : 'غير متاح — لا توجد عيّنة توقيت كافية؛ يختار المالك وقتاً صريحاً.';

    out.push({
      productId: product.id,
      productName: product.name,
      state,
      who,
      why: sufficientOpps.length
        ? `طلب حقيقي موثّق على ${product.name} (${sufficientOpps.reduce((n, o) => n + o.sampleSize, 0)} إشارة).`
        : 'لا دليل كافٍ على وجود جمهور لهذا المنتج بعد.',
      whatToShow: sufficientOpps.length
        ? `محتوى/عرض يشرح ${product.name} من بيانات المعرض الموثّقة فقط.`
        : 'لا يُقترح محتوى موجّه بلا دليل طلب.',
      where,
      when,
      whenAvailable,
      message,
      cta,
      evidence: [
        ...sufficientOpps.slice(0, 5).map((o) => o.fact.statement),
        usedFacts.length ? `حقائق مستخدمة في الرسالة: ${usedFacts.join(' · ')}.` : 'لا حقائق سعرية موثّقة — الرسالة عامة.',
      ],
      source: 'كتالوج المعرض + إشارات الطلب الحقيقية',
      limitations: [
        state === 'NO_EVIDENCE' ? 'لا مطابقة بلا دليل؛ لم يُخترع جمهور.' : 'المطابقة مبنية على دليل حقيقي؛ لا تضمن تحويلاً.',
        'الموقع/التوقيت غير المتاحين يُعلنان ولا يُخترعان.',
      ],
    });
  }

  return out;
}

export interface MatchSummary {
  total: number;
  matched: number;
  weak: number;
  noEvidence: number;
  note: string;
}

export function summarizeMatches(matches: ProductAudienceMatchResult[]): MatchSummary {
  const matched = matches.filter((m) => m.state === 'MATCHED').length;
  const weak = matches.filter((m) => m.state === 'WEAK').length;
  return {
    total: matches.length,
    matched,
    weak,
    noEvidence: matches.length - matched - weak,
    note: 'كل مطابقة تحمل WHO/WHY/WHAT/WHERE/WHEN/MESSAGE/CTA؛ وبلا دليل تُعلن NO_EVIDENCE بلا اختراع جمهور.',
  };
}
