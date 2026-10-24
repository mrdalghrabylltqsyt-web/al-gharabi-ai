/**
 * C1 (الجزء 4) — أول وحدة مستخرجة من server.ts بلا أي تغيير سلوك.
 *
 * دوال صافية مشتركة لمساحة العمل: تنظيف النص، معرّفات الكيانات، تنسيق الدينار
 * العراقي، وحسبة عرض القسط في المحتوى التسويقي. نُقلت حرفياً من server.ts؛ أي
 * تعديل سلوك هنا يجب أن يمر باختبار انحدار مستقل.
 */
import crypto from "node:crypto";

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

// Mirrors /api/catalog/quote: down payment then ceil-to-IQD monthly installment.
export function buildMarketingQuote(cashPrice: number, downPaymentPercent: number, months: number) {
  const downPayment = Math.ceil((cashPrice * downPaymentPercent) / 100);
  const financedAmount = Math.max(0, cashPrice - downPayment);
  const monthlyPayment = Math.ceil(financedAmount / months);
  return {
    cashPrice, downPayment, financedAmount, months, monthlyPayment,
    totalInstallments: monthlyPayment * months, currency: "IQD" as const, rounding: "ceil-to-IQD",
  };
}
