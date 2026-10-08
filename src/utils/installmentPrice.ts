/**
 * سياسة حساب سعر التقسيط للمنتج — مصدر واحد للحقيقة.
 *
 * الغرض: عرض بيانات المنتج وسعره فقط. هذا ليس نظام أقساط/عقود/تحصيل/مالية.
 *
 * القاعدة الثابتة (لا قيمة مخفية ولا نسبة قديمة):
 *   installmentPrice    = cashPrice + 25%        (installmentMarkupPercent = 25)
 *   monthlyInstallment  = installmentPrice / months
 *   المدة الافتراضية    = 10 أشهر
 *
 * المصدر الأساسي للحساب هو `cashPrice` وحده؛ سعر التقسيط والقسط الشهري مُشتقّان
 * دائماً منه، فلا يُحفظ سعر تقسيط غير متوافق مع المعادلة.
 *
 * التقريب (سياسة دينار عراقي ثابتة، لا عشوائية):
 *   · سعر التقسيط يُقرَّب لأقرب دينار (Math.round) لأنه قد يحوي كسراً من 25%.
 *   · القسط الشهري يُقرَّب لأعلى دينار (Math.ceil) — نفس سياسة `ceil-to-IQD`
 *     المستخدمة في `/api/catalog/quote` داخل المشروع، فلا يقلّ المحصَّل عن المستحق.
 *
 * الحسابات رقمية صرف، لذا يعمل الملف على الخادم والمتصفح معاً (كـscheduleTime.ts).
 */

/** النسبة المئوية الافتراضية لزيادة سعر التقسيط فوق سعر الكاش. */
export const INSTALLMENT_MARKUP_PERCENT_DEFAULT = 25;
/** المدة الافتراضية بالشهور. */
export const INSTALLMENT_MONTHS_DEFAULT = 10;
/** أدنى/أقصى مدة مقبولة (نفس حدود المشروع في مسار المنتجات). */
export const INSTALLMENT_MONTHS_MIN = 1;
export const INSTALLMENT_MONTHS_MAX = 60;
/** سياسة التقريب المُعلنة صراحةً — ثابتة وقابلة للاختبار. */
export const INSTALLMENT_ROUNDING_POLICY = 'round-price-ceil-monthly-to-IQD' as const;
/** الحقل الذي يُشتقّ منه كل شيء (لا قيمة قديمة أو مخفية). */
export const INSTALLMENT_SOURCE_FIELD = 'cashPrice' as const;

export type InstallmentRoundingPolicy = typeof INSTALLMENT_ROUNDING_POLICY;

export interface InstallmentInput {
  /** سعر الكاش بالدينار العراقي — المصدر الوحيد للحساب. */
  cashPrice: number;
  /** نسبة الزيادة %؛ الافتراضي 25. */
  installmentMarkupPercent?: number;
  /** مدة التقسيط بالشهور؛ الافتراضي 10 عند الغياب. */
  installmentMonths?: number;
}

export interface InstallmentComputationSuccess {
  ok: true;
  cashPrice: number;
  installmentMarkupPercent: number;
  installmentPrice: number;
  installmentMonths: number;
  monthlyInstallment: number;
  roundingPolicy: InstallmentRoundingPolicy;
}

export interface InstallmentComputationFailure {
  ok: false;
  /** كود خطأ حتمي بلا نص حر (يُترجم للعربية في الواجهة). */
  error: 'cashPrice_invalid' | 'installmentMonths_invalid' | 'installmentMarkup_invalid';
}

export type InstallmentComputation = InstallmentComputationSuccess | InstallmentComputationFailure;

/**
 * يحلّ المدة: عند الغياب يُستخدم 10؛ عند قيمة صحيحة ضمن الحدود تُقبل؛ وأي قيمة
 * صريحة غير صالحة (0، سالب، كسر، فوق الحد) تُعلَن فشلاً — لا تقريب ولا قصّ صامت.
 */
export function resolveInstallmentMonths(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return INSTALLMENT_MONTHS_DEFAULT;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < INSTALLMENT_MONTHS_MIN || n > INSTALLMENT_MONTHS_MAX) return null;
  return n;
}

/**
 * الحساب الحتمي الكامل: سعر كاش صالح + مدة صالحة ⇒ سعر تقسيط + قسط شهري.
 * لا تُقبل قيم NaN ولا سالبة، ولا مدة < 1.
 */
export function computeInstallmentPrice(input: InstallmentInput): InstallmentComputation {
  const cashPrice = Number(input?.cashPrice);
  if (!Number.isFinite(cashPrice) || cashPrice <= 0) return { ok: false, error: 'cashPrice_invalid' };

  const markupRaw = input?.installmentMarkupPercent;
  const markup = markupRaw === undefined || markupRaw === null ? INSTALLMENT_MARKUP_PERCENT_DEFAULT : Number(markupRaw);
  if (!Number.isFinite(markup) || markup < 0) return { ok: false, error: 'installmentMarkup_invalid' };

  const months = resolveInstallmentMonths(input?.installmentMonths);
  if (months === null) return { ok: false, error: 'installmentMonths_invalid' };

  const installmentPrice = Math.round(cashPrice * (1 + markup / 100));
  const monthlyInstallment = Math.ceil(installmentPrice / months);

  return {
    ok: true,
    cashPrice,
    installmentMarkupPercent: markup,
    installmentPrice,
    installmentMonths: months,
    monthlyInstallment,
    roundingPolicy: INSTALLMENT_ROUNDING_POLICY,
  };
}

/** الحقول الأربعة المحسوبة التي تُحفظ مع المنتج (تُبنى من الحساب فقط). */
export function productInstallmentFields(input: InstallmentInput):
  | { cashPrice: number; installmentPrice: number; installmentMonths: number; monthlyInstallment: number; installmentMarkupPercent: number }
  | null {
  const computed = computeInstallmentPrice(input);
  if (!computed.ok) return null;
  return {
    cashPrice: computed.cashPrice,
    installmentPrice: computed.installmentPrice,
    installmentMonths: computed.installmentMonths,
    monthlyInstallment: computed.monthlyInstallment,
    installmentMarkupPercent: computed.installmentMarkupPercent,
  };
}
