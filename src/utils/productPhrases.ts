/**
 * عبارات منتج حقيقية فقط — فحص الشاشات (2026-10-25 #2).
 *
 * نموذج «إضافة منتج» كان يملأ كل منتج بعبارات عامة ثابتة («مواصفات المنتج حسب الفئة»،
 * «ضمان حسب سياسة المورد»، «خيارات تقسيط حسب الأهلية»…) لا تخصّ أي منتج. تظهر على كل
 * بطاقات المخزن كأنها مواصفات، وتدخل نصوص المحتوى وعبارات الرد المسموحة للعقل كادعاءات
 * غامضة (ضمان؟ أهلية؟) لم يسجّلها المالك. هذه الوحدة الصافية تُسقطها عند القراءة
 * (بلا حذف من البيانات المخزّنة).
 */
export const GENERIC_PRODUCT_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'مواصفات المنتج حسب الفئة',
  'ضمان حسب سياسة المورد',
  'خدمة ما بعد البيع حسب المنتج',
  'خيارات تقسيط حسب الأهلية',
  'مدد سداد مرنة',
  'خطط تمويل حسب المنتج',
]);

/** يُبقي العبارات النصية الحقيقية فقط (بلا العبارات العامة الثابتة وبلا الفارغ). */
export function realProductPhrases(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x && !GENERIC_PRODUCT_PLACEHOLDERS.has(x));
}

/**
 * «موديل»: سنة صنع حقيقية (1990..السنة القادمة) تُعرض «موديل 2026»؛ غير ذلك رقم طراز
 * (مثل 24000 / 6640) يُعرض «طراز 24000» لا سنة. غيابه ⇒ null (لا سنة حالية مختلقة).
 */
export function modelLabel(modelYear: unknown, nowYear: number): string | null {
  const raw = String(modelYear ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1990 && n <= nowYear + 1) return `موديل ${n}`;
  return `طراز ${raw}`;
}
