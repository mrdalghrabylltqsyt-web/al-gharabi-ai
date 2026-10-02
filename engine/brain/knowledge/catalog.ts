/**
 * Commercial Product Catalog — أساس مخزن معرفة المنتجات الحقيقي (منطق خالص).
 *
 * الغرض: أن يمتلك العقل **مصدراً واحداً موثوقاً** لمعرفة المنتجات التجارية
 * (سعر نقدي، عرض تقسيط، توفر، مواصفات) يفرّق صراحةً بين معلومة موثّقة ومعلومة
 * ناقصة تحتاج تحديثاً. هذا هو ما يمنع العقل من اختراع سعر أو قسط أو توفر.
 *
 * القواعد الملزمة:
 * - لا سعر ولا قسط ولا توفر يُشتق إلا من **قيمة مسجّلة من المالك** أو من **قاعدة
 *   تقسيط معتمدة + سعر موثّق** (استنتاج حسابي مُوسَم `DERIVED`، لا اختراع).
 * - الحقل الغائب يحمل حالة صريحة: `NOT_PROVIDED` / `UNKNOWN` / `NEEDS_UPDATE`.
 * - لا `VERIFIED` بلا مصدر مسجّل؛ ولا استنتاج بلا قاعدة معتمدة.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

/** حالة أي حقل تجاري — هي التي تحكم ما يُقال للمستخدم بدل التخمين. */
export type CatalogFactState = 'VERIFIED' | 'DERIVED' | 'NEEDS_UPDATE' | 'UNKNOWN' | 'NOT_PROVIDED';

export const CATALOG_FACT_LABELS_AR: Record<CatalogFactState, string> = Object.freeze({
  VERIFIED: 'معلومة موثّقة من المالك',
  DERIVED: 'استنتاج حسابي من بيانات موثّقة وقاعدة معتمدة',
  NEEDS_UPDATE: 'تحتاج تحديثاً',
  UNKNOWN: 'غير معروفة',
  NOT_PROVIDED: 'لم تُزوَّد بعد',
});

/**
 * العبارات المعتمدة للمعلومة غير المتاحة — مصدر واحد. العقل يستخدمها حرفياً
 * بدل اختلاق رقم أو إسكات السؤال.
 */
export const MISSING_INFO_PHRASES_AR = Object.freeze({
  unavailable: 'المعلومة غير متوفرة',
  availabilityNeedsCheck: 'التوفر يحتاج تحقق',
  priceNeedsUpdate: 'السعر يحتاج تحديث',
  installmentNeedsUpdate: 'عرض التقسيط يحتاج تحديث',
});

/** حقل تجاري واحد: القيمة + حالتها + مصدرها + آخر تحقق فعلي. */
export interface VerifiedField<T> {
  value: T | null;
  state: CatalogFactState;
  /** مصدر المعلومة (اسم سجل/حقل) — إلزامي لأي حالة غير مجهولة. */
  source: string | null;
  lastVerifiedAt: string | null;
}

/** عرض تقسيط واحد لمنتج — كل مبلغ فيه بحالته ومصدره. */
export interface InstallmentOffer {
  durationMonths: number;
  downPaymentAmount: number | null;
  downPaymentPercent: number | null;
  monthlyAmount: number | null;
  totalInstallments: number | null;
  fees: number | null;
  conditions: string[];
  state: CatalogFactState;
  source: string | null;
  lastVerifiedAt: string | null;
}

export type ProductCategory = 'appliances' | 'phones' | 'construction' | 'electronics' | 'other';

export interface CatalogSupplier {
  id: string;
  name: string;
}

export interface CatalogProduct {
  id: string;
  name: string;
  category: ProductCategory;
  brand: string | null;
  model: string | null;
  description: string | null;
  specs: string[];
  attributes: Record<string, string>;
  images: string[];
  /** السعر النقدي — معلومة تجارية لا تُخترع. */
  cashPrice: VerifiedField<number>;
  /** التوفر — لا يُخترع؛ الغياب يعني «يحتاج تحقق». */
  availability: VerifiedField<{ inStock: boolean; stockQuantity: number | null }>;
  installmentOffers: InstallmentOffer[];
  relatedProductIds: string[];
  alternativeProductIds: string[];
  supplier: CatalogSupplier | null;
  ownerApproval: 'approved' | 'pending' | 'rejected';
  source: string;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** يُبني حقل موثّق من قيمة مسجّلة فعلاً؛ الغياب يُعلن حالته لا يُخترع. */
export function verifiedField<T>(input: {
  value: T | null | undefined;
  source: string | null;
  lastVerifiedAt?: string | null;
  missingState?: CatalogFactState;
}): VerifiedField<T> {
  const hasValue = input.value !== null && input.value !== undefined;
  const hasSource = typeof input.source === 'string' && input.source.trim().length > 0;
  return {
    value: hasValue ? (input.value as T) : null,
    state: hasValue && hasSource ? 'VERIFIED' : (input.missingState || 'NOT_PROVIDED'),
    source: hasSource ? input.source : null,
    lastVerifiedAt: input.lastVerifiedAt ?? null,
  };
}

/**
 * قاعدة تقسيط معتمدة: تُستَخدم فقط لاشتقاق عرض من سعر موثّق. لا تُستخدم لإنتاج
 * رقم بلا سعر موثّق، والنتيجة تُوسَم `DERIVED` صراحةً.
 */
export interface ApprovedInstallmentRule {
  durationMonths: number;
  downPaymentPercent: number;
  /** نسبة رسوم إدارية/فائدة مسجّلة (0 إن لا رسوم). */
  feePercent?: number;
  conditions?: string[];
}

/** عرض تقسيط مشتق من سعر موثّق + قاعدة معتمدة. بلا سعر موثّق ⇒ لا اشتقاق. */
export function deriveInstallmentOffer(input: {
  cashPrice: VerifiedField<number>;
  rule: ApprovedInstallmentRule;
  source: string;
  now: number;
}): InstallmentOffer {
  const price = input.cashPrice.value;
  const ruleUsable = input.cashPrice.state === 'VERIFIED' && Number.isFinite(price) && (price as number) > 0;
  if (!ruleUsable) {
    return {
      durationMonths: input.rule.durationMonths,
      downPaymentAmount: null,
      downPaymentPercent: null,
      monthlyAmount: null,
      totalInstallments: null,
      fees: null,
      conditions: input.rule.conditions ? [...input.rule.conditions] : [],
      state: 'NEEDS_UPDATE',
      source: null,
      lastVerifiedAt: null,
    };
  }
  const cash = price as number;
  const percent = Math.max(0, Math.min(99, Number(input.rule.downPaymentPercent) || 0));
  const months = Math.max(1, Math.min(60, Math.floor(Number(input.rule.durationMonths) || 1)));
  const down = Math.round((cash * percent) / 100);
  const financed = Math.max(0, cash - down);
  const feePercent = Math.max(0, Number(input.rule.feePercent) || 0);
  const fees = Math.round((financed * feePercent) / 100);
  const total = financed + fees;
  const monthly = Math.ceil(total / months);
  return {
    durationMonths: months,
    downPaymentAmount: down,
    downPaymentPercent: percent,
    monthlyAmount: monthly,
    totalInstallments: monthly * months,
    fees,
    conditions: input.rule.conditions ? [...input.rule.conditions] : [],
    state: 'DERIVED',
    source: input.source,
    lastVerifiedAt: new Date(input.now).toISOString(),
  };
}

/** يجد عرض تقسيط موثّقاً/مشتقاً بمدة محددة. لا يخترع عرضاً غائباً. */
export function findInstallmentOffer(product: CatalogProduct, durationMonths: number): InstallmentOffer | null {
  const months = Math.floor(Number(durationMonths) || 0);
  if (months <= 0) return null;
  return product.installmentOffers.find((o) => o.durationMonths === months && (o.state === 'VERIFIED' || o.state === 'DERIVED')) || null;
}

/** هل يمكن للعقل الإجابة عن سؤال السعر النقدي بصدق؟ */
export function canAnswerCashPrice(product: CatalogProduct): { answerable: boolean; phrase: string } {
  if (product.cashPrice.state === 'VERIFIED' && typeof product.cashPrice.value === 'number') {
    return { answerable: true, phrase: `${product.cashPrice.value.toLocaleString('en-US')} د.ع` };
  }
  return { answerable: false, phrase: MISSING_INFO_PHRASES_AR.priceNeedsUpdate };
}

/** هل يمكن الإجابة عن سؤال القسط لمدة معيّنة؟ */
export function canAnswerInstallment(product: CatalogProduct, durationMonths: number): { answerable: boolean; phrase: string; offer: InstallmentOffer | null } {
  const offer = findInstallmentOffer(product, durationMonths);
  if (offer && typeof offer.monthlyAmount === 'number') {
    return { answerable: true, phrase: `${offer.monthlyAmount.toLocaleString('en-US')} د.ع شهرياً`, offer };
  }
  return { answerable: false, phrase: MISSING_INFO_PHRASES_AR.installmentNeedsUpdate, offer: null };
}

/** هل التوفر موثّق فعلاً؟ غيابه يعني «التوفر يحتاج تحقق». */
export function canAnswerAvailability(product: CatalogProduct): { answerable: boolean; phrase: string } {
  if (product.availability.state === 'VERIFIED' && product.availability.value) {
    return { answerable: true, phrase: product.availability.value.inStock ? 'متوفر' : 'غير متوفر حالياً' };
  }
  return { answerable: false, phrase: MISSING_INFO_PHRASES_AR.availabilityNeedsCheck };
}

/** ما الذي ينقص هذا المنتج بالضبط — لإظهاره للمالك بدل افتراض الجاهزية. */
export function describeMissingInfo(product: CatalogProduct): string[] {
  const missing: string[] = [];
  if (!canAnswerCashPrice(product).answerable) missing.push(MISSING_INFO_PHRASES_AR.priceNeedsUpdate);
  if (!canAnswerAvailability(product).answerable) missing.push(MISSING_INFO_PHRASES_AR.availabilityNeedsCheck);
  if (!product.installmentOffers.some((o) => o.state === 'VERIFIED' || o.state === 'DERIVED')) missing.push(MISSING_INFO_PHRASES_AR.installmentNeedsUpdate);
  if (!product.description && product.specs.length === 0) missing.push(MISSING_INFO_PHRASES_AR.unavailable);
  return missing;
}

export interface CatalogReadiness {
  total: number;
  approved: number;
  withVerifiedPrice: number;
  withVerifiedAvailability: number;
  withInstallmentOffer: number;
  incomplete: number;
  note: string;
}

/** ملخّص جاهزية المخزن — لا يدّعي اكتمالاً غير مثبت. */
export function catalogReadiness(products: CatalogProduct[]): CatalogReadiness {
  const withVerifiedPrice = products.filter((p) => canAnswerCashPrice(p).answerable).length;
  const withVerifiedAvailability = products.filter((p) => canAnswerAvailability(p).answerable).length;
  const withInstallmentOffer = products.filter((p) => p.installmentOffers.some((o) => o.state === 'VERIFIED' || o.state === 'DERIVED')).length;
  const incomplete = products.filter((p) => describeMissingInfo(p).length > 0).length;
  return {
    total: products.length,
    approved: products.filter((p) => p.ownerApproval === 'approved').length,
    withVerifiedPrice,
    withVerifiedAvailability,
    withInstallmentOffer,
    incomplete,
    note: 'الجاهزية تُقاس بعدد المنتجات التي يمكن الإجابة عن سعرها/توفّرها/تقسيطها من بيانات موثّقة فقط.',
  };
}

/**
 * مصدر المعلومة عند إدخالها من المالك عبر قاعدة بيانات المعرض الحالية.
 * لا يُستخدم كتحقق آلي — التوثيق يعني «سجّله المالك»، والطزاجة تُقاس بـ`updatedAt`.
 */
export const OWNER_RECORDED_SOURCE = 'owner_recorded:workspace.products';

const CATEGORIES: readonly ProductCategory[] = Object.freeze(['appliances', 'phones', 'construction', 'electronics', 'other']);

function asCategory(value: unknown): ProductCategory {
  return CATEGORIES.includes(value as ProductCategory) ? (value as ProductCategory) : 'other';
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x) => typeof x === 'string' && x.trim()).map((x: string) => x.trim()) : [];
}

/**
 * إسقاط سجل منتج مسجّل في قاعدة المعرض إلى `CatalogProduct` بلا اختراع:
 * الحقل الغائب يبقى غائباً بحالته الصريحة، والسعر/التوفر المسجّلان يُوسَمان
 * `VERIFIED` بمصدرهما. **لا يُوصل هذا الإسقاط بأي مسار في هذه الدفعة** — هو
 * مسار الهجرة المعتمد للدفعة التالية.
 */
export function catalogProductFromWorkspace(product: any, now: number): CatalogProduct {
  const updatedAt = asString(product?.updatedAt) || asString(product?.createdAt) || new Date(now).toISOString();
  const cash = Number(product?.cashPrice);
  const hasCash = Number.isFinite(cash) && cash > 0;
  const hasAvailability = typeof product?.inStock === 'boolean';
  const stockQty = Number(product?.stockQuantity);
  return {
    id: String(product?.id || '').trim(),
    name: asString(product?.name) || '',
    category: asCategory(product?.category),
    brand: asString(product?.brand),
    model: asString(product?.model) || asString(product?.modelYear),
    description: asString(product?.description),
    specs: asStringArray(product?.specs),
    attributes: product?.attributes && typeof product.attributes === 'object' ? { ...product.attributes } : {},
    images: [asString(product?.image)].filter(Boolean) as string[],
    cashPrice: verifiedField<number>({ value: hasCash ? cash : null, source: hasCash ? OWNER_RECORDED_SOURCE : null, lastVerifiedAt: updatedAt, missingState: 'NEEDS_UPDATE' }),
    availability: verifiedField<{ inStock: boolean; stockQuantity: number | null }>({
      value: hasAvailability ? { inStock: Boolean(product.inStock), stockQuantity: Number.isFinite(stockQty) ? Math.max(0, Math.floor(stockQty)) : null } : null,
      source: hasAvailability ? OWNER_RECORDED_SOURCE : null,
      lastVerifiedAt: updatedAt,
      missingState: 'UNKNOWN',
    }),
    // عروض التقسيط المسجّلة نصاً لا تُحوَّل إلى أرقام مخترعة؛ تبقى نصية حتى يوثّقها المالك.
    installmentOffers: [],
    relatedProductIds: [],
    alternativeProductIds: [],
    supplier: null,
    ownerApproval: 'pending',
    source: OWNER_RECORDED_SOURCE,
    lastVerifiedAt: updatedAt,
    createdAt: asString(product?.createdAt) || updatedAt,
    updatedAt,
  };
}

/** هل المعطى كافٍ لاعتبار المخزن صالحاً للاستخدام التجاري؟ (فحص صريح لا ادعاء). */
export function catalogIsUsable(products: CatalogProduct[]): { usable: boolean; reason: string } {
  if (!products.length) return { usable: false, reason: 'لا منتجات مسجّلة في المخزن.' };
  const approved = products.filter((p) => p.ownerApproval === 'approved');
  if (!approved.length) return { usable: false, reason: 'لا منتج معتمد من المالك بعد؛ لا تُبنى إجابات تجارية على بيانات غير معتمدة.' };
  const answerable = approved.filter((p) => canAnswerCashPrice(p).answerable || canAnswerAvailability(p).answerable);
  if (!answerable.length) return { usable: false, reason: 'لا منتج معتمد يحمل سعراً أو توفّراً موثّقاً؛ الأسعار تحتاج تحديثاً.' };
  return { usable: true, reason: `${answerable.length} منتج معتمد يحمل معلومة تجارية موثّقة على الأقل.` };
}
