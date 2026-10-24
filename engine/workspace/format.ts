/**
 * C1 (الجزء 4) — أول وحدة مستخرجة من server.ts بلا أي تغيير سلوك.
 *
 * دوال صافية مشتركة لمساحة العمل: تنظيف النص، معرّفات الكيانات، تنسيق الدينار
 * العراقي، وحسبة عرض القسط في المحتوى التسويقي. نُقلت حرفياً من server.ts؛ أي
 * تعديل سلوك هنا يجب أن يمر باختبار انحدار مستقل.
 */
import crypto from "node:crypto";
import { INSTALLMENT_MARKUP_PERCENT_DEFAULT } from "../../src/utils/installmentPrice";

/** يقصّ ويقطع النص لحدٍّ أقصى؛ أي قيمة غير نصية تصبح "". */
export function cleanText(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** معرّف كيان مساحة عمل: بادئة + الوقت + 8 محارف hex عشوائية. */
export function workspaceId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

/** تنسيق مبلغ بالدينار العراقي (تقريب لأقرب دينار، فواصل آلاف إنجليزية). */
export function formatIqd(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} د.ع`;
}

/**
 * حسبة القسط في المحتوى التسويقي — **نفس معادلة الكتالوج** (src/utils/installmentPrice.ts):
 *   سعر التقسيط = round(سعر الكاش × (1 + نسبة الزيادة٪))   (النسبة من المنتج، الافتراضي 25٪)
 *   الدفعة الأولى = ceil(سعر التقسيط × نسبة الدفعة٪)       (0٪ ⇒ لا دفعة)
 *   القسط الشهري = ceil((سعر التقسيط − الدفعة) ÷ الأشهر)   (تقريب لأعلى دينار)
 * بدفعة 0٪ يطابق القسط الشهري `monthlyInstallment` المعروض في الكتالوج حرفياً.
 *
 * إصلاح: كانت الحسبة تبدأ من سعر الكاش بلا نسبة الزيادة، فتعلن المنشورات للجمهور
 * قسطاً أقل مما يطبّقه المعرض (نفس عطل الرد الذي أصلحه PR #64).
 */
export function buildMarketingQuote(cashPrice: number, downPaymentPercent: number, months: number, installmentMarkupPercent?: number | null) {
  const markupRaw = Number(installmentMarkupPercent);
  const markup = installmentMarkupPercent === undefined || installmentMarkupPercent === null || !Number.isFinite(markupRaw) || markupRaw < 0
    ? INSTALLMENT_MARKUP_PERCENT_DEFAULT
    : markupRaw;
  const installmentPrice = Math.round(cashPrice * (1 + markup / 100));
  const downPayment = Math.ceil((installmentPrice * downPaymentPercent) / 100);
  const financedAmount = Math.max(0, installmentPrice - downPayment);
  const monthlyPayment = Math.ceil(financedAmount / months);
  return {
    cashPrice, installmentMarkupPercent: markup, installmentPrice,
    downPayment, financedAmount, months, monthlyPayment,
    totalInstallments: monthlyPayment * months, currency: "IQD" as const, rounding: "ceil-to-IQD",
  };
}
