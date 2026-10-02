/**
 * Digital Sales — إجابات المنتج الحقيقية + التحقق من العرض (منطق خالص).
 *
 * الغرض: الإجابة عن سؤال العميل من **بيانات تجارية موثوقة فقط**. لا يُخترع سعر
 * ولا قسط ولا مقدم ولا مدة ولا خصم ولا توفر. وعند نقص أي مكوّن إلزامي يُعلن
 * `DATA_NOT_AVAILABLE` أو `HUMAN_REVIEW` بدل اختراع رقم.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا AI.
 */

import type { PlatformId } from '../../social/adapter';
import {
  canAnswerCashPrice, canAnswerInstallment, canAnswerAvailability,
  MISSING_INFO_PHRASES_AR, type CatalogProduct,
} from '../knowledge/catalog';

export type OfferAnswerState = 'ANSWERED' | 'DATA_NOT_AVAILABLE' | 'HUMAN_REVIEW' | 'PRODUCT_NOT_IDENTIFIED';

export const OFFER_ANSWER_STATE_LABELS_AR: Record<OfferAnswerState, string> = Object.freeze({
  ANSWERED: 'تمّت الإجابة من بيانات موثّقة',
  DATA_NOT_AVAILABLE: 'البيانات غير متوفرة — لا إجابة مُخترعة',
  HUMAN_REVIEW: 'يحتاج مراجعة بشرية',
  PRODUCT_NOT_IDENTIFIED: 'لم يُحدَّد المنتج',
});

export type OfferQuestionKind = 'cash_price' | 'installment' | 'availability' | 'specs' | 'general';

export interface ProductIdentification {
  productId: string | null;
  productName: string | null;
  identified: boolean;
  confidence: 'exact' | 'partial' | 'none';
  /** المرشّحون عند التباس الهوية — لا يُختار أحدهم بلا دليل. */
  candidates: Array<{ productId: string; name: string; matchedOn: string }>;
  reason: string;
}

/** توحيد عربي لمطابقة الأسماء. */
function normalizeAr(text: string): string {
  return String(text || '')
    .replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * يحدّد المنتج من نص العميل بالاعتماد على **مرجع صريح** أولاً، ثم مطابقة الاسم/
 * الماركة/الموديل المسجّلين. التباس الهوية لا يُحسم — يُعلن كمرشّحين.
 */
export function identifyProduct(input: {
  text: string;
  products: CatalogProduct[];
  /** مرجع منتج صريح (من ربط المحادثة) — يُقدَّم على أي مطابقة نصية. */
  explicitProductId?: string | null;
}): ProductIdentification {
  const products = Array.isArray(input.products) ? input.products : [];
  if (input.explicitProductId) {
    const p = products.find((x) => x.id === input.explicitProductId);
    if (p) {
      return { productId: p.id, productName: p.name, identified: true, confidence: 'exact', candidates: [], reason: 'مرجع منتج صريح موثوق من المحادثة.' };
    }
  }
  const text = normalizeAr(input.text);
  if (!text) {
    return { productId: null, productName: null, identified: false, confidence: 'none', candidates: [], reason: 'لا نص لتحليل المنتج.' };
  }
  const candidates: Array<{ productId: string; name: string; matchedOn: string }> = [];
  for (const p of products) {
    const nameNorm = normalizeAr(p.name);
    // الكلمات الدلالية من الاسم: مطابقة جزئية معقولة («غسالة سامسونغ» ← «غسالة»).
    const nameTokens = nameNorm.split(' ').filter((t) => t.length >= 3);
    const needles: Array<{ value: string; on: string }> = [
      { value: nameNorm, on: 'name' },
      ...nameTokens.map((t) => ({ value: t, on: 'name_token' })),
      ...(p.brand ? [{ value: normalizeAr(p.brand), on: 'brand' }] : []),
      ...(p.model ? [{ value: normalizeAr(p.model), on: 'model' }] : []),
      ...p.specs.map((s) => ({ value: normalizeAr(s), on: 'spec' })),
    ];
    for (const n of needles) {
      if (n.value.length >= 3 && text.includes(n.value)) {
        candidates.push({ productId: p.id, name: p.name, matchedOn: n.on });
        break;
      }
    }
  }
  if (candidates.length === 1) {
    return { productId: candidates[0].productId, productName: candidates[0].name, identified: true, confidence: 'exact', candidates, reason: `مطابقة ${candidates[0].matchedOn} لاسم المنتج.` };
  }
  if (candidates.length > 1) {
    return { productId: null, productName: null, identified: false, confidence: 'partial', candidates, reason: `التباس الهوية: ${candidates.length} منتجات محتملة — لا يُحسم بلا دليل.` };
  }
  return { productId: null, productName: null, identified: false, confidence: 'none', candidates: [], reason: 'لم تُطابق أي أسماء/ماركات/موديلات مسجّلة.' };
}

/** يصنّف سؤال العميل. */
export function classifyOfferQuestion(text: string): OfferQuestionKind {
  const t = normalizeAr(text);
  if (/(قسط|اقساط|تقسيط|مقدم|الدفعه الاولي|شهريا)/.test(t)) return 'installment';
  if (/(شكد السعر|كم السعر|شكد سعر|كم سعر|بكم|السعر|يكلف|شكد بي)/.test(t)) return 'cash_price';
  if (/(متوفر|موجود|متوفره|اكو منه|نافد|مخلص)/.test(t)) return 'availability';
  if (/(مواصفات|مميزات|قياسات|الحجم|السعه|نوعه شنو)/.test(t)) return 'specs';
  return 'general';
}

export interface OfferAnswer {
  state: OfferAnswerState;
  questionKind: OfferQuestionKind;
  productId: string | null;
  productName: string | null;
  /** النص المُعتمد للرد — من بيانات موثّقة فقط، أو عبارة النقص الصريحة. */
  answerText: string;
  /** المصدر الدقيق للقيمة (سجل/حقل). */
  valueSource: string | null;
  /** المكوّنات الناقصة إن وُجدت. */
  missing: string[];
  /** هل يحتاج تدخّل بشري؟ */
  needsHuman: boolean;
  evidence: string[];
  limitations: string[];
  at: string;
}

/**
 * يبني إجابة موثّقة عن سؤال العميل. لا يُنشئ قسطاً إلا بوجود:
 * منتج + سعر نقدي موثّق + قاعدة تقسيط معتمدة (تظهر كعرض VERIFIED/DERIVED).
 */
export function answerProductQuestion(input: {
  text: string;
  products: CatalogProduct[];
  explicitProductId?: string | null;
  installmentMonths?: number | null;
  platform?: PlatformId | 'cross_platform';
  nowMs: number;
}): OfferAnswer {
  const now = new Date(input.nowMs).toISOString();
  const questionKind = classifyOfferQuestion(input.text);
  const id = identifyProduct({ text: input.text, products: input.products, explicitProductId: input.explicitProductId });

  if (!id.identified || !id.productId) {
    return {
      state: 'PRODUCT_NOT_IDENTIFIED', questionKind, productId: null, productName: null,
      answerText: 'ما عرفت المنتج المقصود بالضبط — ممكن تحدّده حتى أعطيك معلومة موثّقة؟',
      valueSource: null, missing: ['product_identity'], needsHuman: true,
      evidence: [id.reason], limitations: ['لا إجابة عن منتج غير محدّد.'], at: now,
    };
  }

  const product = input.products.find((p) => p.id === id.productId)!;
  const evidence: string[] = [`product=${product.id}`, `question=${questionKind}`];

  if (questionKind === 'cash_price') {
    const cash = canAnswerCashPrice(product);
    if (cash.answerable) {
      return {
        state: 'ANSWERED', questionKind, productId: product.id, productName: product.name,
        answerText: `سعر ${product.name} النقدي: ${cash.phrase}`,
        valueSource: product.cashPrice.source, missing: [], needsHuman: false,
        evidence: [...evidence, `cashPrice.state=${product.cashPrice.state}`],
        limitations: ['السعر من السجل الموثّق فقط، ولا يُعدَّل آلياً.'], at: now,
      };
    }
    return {
      state: 'DATA_NOT_AVAILABLE', questionKind, productId: product.id, productName: product.name,
      answerText: MISSING_INFO_PHRASES_AR.priceNeedsUpdate, valueSource: null, missing: ['cash_price'], needsHuman: true,
      evidence: [...evidence, `cashPrice.state=${product.cashPrice.state}`],
      limitations: ['لا يُخترع سعر غير موثّق.'], at: now,
    };
  }

  if (questionKind === 'installment') {
    const months = Math.floor(Number(input.installmentMonths || 0)) || 12;
    const offer = canAnswerInstallment(product, months);
    const cash = canAnswerCashPrice(product);
    // لا قسط بلا سعر موثّق + قاعدة معتمدة (العرض موجود يعني القاعدة طُبِّقت).
    if (!cash.answerable) {
      return {
        state: 'DATA_NOT_AVAILABLE', questionKind, productId: product.id, productName: product.name,
        answerText: MISSING_INFO_PHRASES_AR.priceNeedsUpdate, valueSource: null, missing: ['cash_price'], needsHuman: true,
        evidence: [...evidence, 'installment requires verified cash price'],
        limitations: ['لا يُشتق قسط بلا سعر نقدي موثّق.'], at: now,
      };
    }
    if (offer.answerable && offer.offer) {
      const down = typeof offer.offer.downPaymentAmount === 'number' ? `${offer.offer.downPaymentAmount.toLocaleString('en-US')} د.ع مقدم` : 'المقدم يحتاج تحقق';
      return {
        state: 'ANSWERED', questionKind, productId: product.id, productName: product.name,
        answerText: `تقسيط ${product.name} على ${months} شهر: ${offer.phrase} (${down})`,
        valueSource: offer.offer.source, missing: [], needsHuman: false,
        evidence: [...evidence, `offer.state=${offer.offer.state}`, `cashPrice.state=${product.cashPrice.state}`],
        limitations: ['العرض مشتقّ من سعر موثّق + قاعدة تقسيط معتمدة، ولا يُعدَّل آلياً.'], at: now,
      };
    }
    return {
      state: 'DATA_NOT_AVAILABLE', questionKind, productId: product.id, productName: product.name,
      answerText: MISSING_INFO_PHRASES_AR.installmentNeedsUpdate, valueSource: null, missing: ['installment_rule'], needsHuman: true,
      evidence: [...evidence, 'no verified/derived offer for requested months'],
      limitations: ['لا يُخترع عرض تقسيط لم تُعتمده قاعدة.'], at: now,
    };
  }

  if (questionKind === 'availability') {
    const av = canAnswerAvailability(product);
    if (av.answerable) {
      return {
        state: 'ANSWERED', questionKind, productId: product.id, productName: product.name,
        answerText: `توفر ${product.name}: ${av.phrase}`,
        valueSource: product.availability.source, missing: [], needsHuman: false,
        evidence: [...evidence, `availability.state=${product.availability.state}`],
        limitations: ['التوفر من السجل الموثّق فقط.'], at: now,
      };
    }
    return {
      state: 'DATA_NOT_AVAILABLE', questionKind, productId: product.id, productName: product.name,
      answerText: MISSING_INFO_PHRASES_AR.availabilityNeedsCheck, valueSource: null, missing: ['availability'], needsHuman: true,
      evidence: [...evidence, `availability.state=${product.availability.state}`],
      limitations: ['لا يُخترع توفر غير موثّق.'], at: now,
    };
  }

  // مواصفات/عام: نعرض ما هو مسجّل فعلاً فقط.
  const specs = product.specs.length ? product.specs.slice(0, 6).join('، ') : '';
  if (specs || product.description) {
    return {
      state: 'ANSWERED', questionKind, productId: product.id, productName: product.name,
      answerText: `${product.name}: ${specs || product.description}`,
      valueSource: 'workspace.products.specs', missing: [], needsHuman: false,
      evidence, limitations: ['المواصفات من السجل المسجّل فقط.'], at: now,
    };
  }
  return {
    state: 'DATA_NOT_AVAILABLE', questionKind, productId: product.id, productName: product.name,
    answerText: MISSING_INFO_PHRASES_AR.unavailable, valueSource: null, missing: ['specs'], needsHuman: true,
    evidence, limitations: ['لا مواصفات مسجّلة — لا يُخترع وصف.'], at: now,
  };
}

/**
 * حرس العرض التجاري: يمنع أي نص رد من تغيير السعر/الخصم/المدة/المقدم/الشروط
 * إلا بقاعدة معتمدة صريحة. يُستخدم قبل أي إرسال.
 */
export const OFFER_MUTATION_FIELDS = Object.freeze(['price', 'discount', 'duration', 'down_payment', 'conditions', 'availability', 'delivery'] as const);

export interface OfferSafetyCheck {
  allowed: boolean;
  violations: string[];
  reason: string;
}

export function checkOfferMutation(input: {
  proposedFields: string[];
  approvedRuleAllows?: string[];
}): OfferSafetyCheck {
  const allowed = new Set(input.approvedRuleAllows || []);
  const violations = input.proposedFields.filter((f) => OFFER_MUTATION_FIELDS.includes(f as any) && !allowed.has(f));
  if (violations.length) {
    return { allowed: false, violations, reason: `لا يجوز تغيير حقول تجارية بلا قاعدة معتمدة: ${violations.join(', ')}` };
  }
  return { allowed: true, violations: [], reason: 'الحقول المطلوبة مسموحة بقاعدة معتمدة أو لا تغيّر حقلاً تجارياً.' };
}
