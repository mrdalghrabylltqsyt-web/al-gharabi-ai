/**
 * بيانات المعرض المؤكدة (المرحلة 5) — قيم مسجّلة يدوياً من المالك، تُستخدم كما هي.
 *
 * الغرض: تغذية العقل بعنوان المعرض وهاتفه وساعات الدوام وشروط التقسيط المؤكدة،
 * فتُجاب أسئلة العملاء عنها حرفياً بدل التصعيد أو الاختراع.
 *
 * قواعد ملزمة:
 * - **غير مُدمِّرة**: تُملأ الحقول **الفارغة فقط**، فلا تُطمس أي قيمة أدخلها المالك
 *   سابقاً (على الإنتاج مثلاً). لا حذف ولا كتابة فوق قيمة قائمة.
 * - **لا اختراع**: كل قيمة هنا نصّ مؤكد أدخله المالك صراحةً، وليست مُستنتجة.
 * - **الضمان غير مُضاف** في هذا الإصدار (قرار المالك الصريح).
 * - منطق صافٍ: لا شبكة ولا أسرار.
 */

import { INSTALLMENT_MONTHS_DEFAULT } from '../../src/utils/installmentPrice';

/** العنوان المؤكد (كما هو حرفياً — لا تغيير). */
export const SHOWROOM_SEED_ADDRESS = 'الطريق كربلاء الطويريج، مقابل العمود 202.';
/** الهاتف المؤكد (كما هو حرفياً). */
export const SHOWROOM_SEED_PHONE = '07728705767';
/** ساعات الدوام المؤكدة (كما هي حرفياً). */
export const SHOWROOM_SEED_HOURS = 'يومياً من 8 صباحاً حتى 8 مساءً.';
/** نص شروط التقسيط المؤكد (كما هو حرفياً — المدة الأساسية 10 أشهر). */
export const SHOWROOM_SEED_INSTALLMENT_TERMS = 'المدة الأساسية 10 أشهر.';
/** المدة الافتراضية المؤكدة بالأشهر (الأجهزة ذات 12 شهراً غير محددة بعد ⇒ 10). */
export const SHOWROOM_SEED_DEFAULT_MONTHS = INSTALLMENT_MONTHS_DEFAULT;

/** يحوّل عدد الأشهر إلى نص عربي مختصر (مثال: 10 ⇒ «10 أشهر»). */
export function installmentMonthsText(months: number | null | undefined): string | null {
  const m = Number(months);
  if (!Number.isInteger(m) || m <= 0) return null;
  if (m === 1) return 'شهر واحد';
  if (m === 2) return 'شهران';
  return `${m} أشهر`;
}

/** نص فارغ أو غير معرّف؟ */
function isBlank(value: unknown): boolean {
  return !(typeof value === 'string' && value.trim().length > 0);
}

/**
 * يملأ حقول بيانات المعرض **الفارغة فقط** بالقيم المؤكدة، ولا يلمس أي قيمة قائمة.
 * يُعيد قائمة الحقول التي ملأها (للتشخيص/التدقيق)، فلا كتابة صامتة.
 */
export function applyShowroomSeedDefaults(showroom: any): string[] {
  const filled: string[] = [];
  if (!showroom || typeof showroom !== 'object') return filled;
  if (isBlank(showroom.address)) { showroom.address = SHOWROOM_SEED_ADDRESS; filled.push('address'); }
  if (isBlank(showroom.phoneUnified)) { showroom.phoneUnified = SHOWROOM_SEED_PHONE; filled.push('phoneUnified'); }
  if (isBlank(showroom.workingHours)) { showroom.workingHours = SHOWROOM_SEED_HOURS; filled.push('workingHours'); }
  if (!Array.isArray(showroom.policies)) showroom.policies = [];
  // شروط التقسيط: تُضاف كنص مسجّل فقط إن لم يكن مسجّلاً مسبقاً.
  const hasTerms = showroom.policies.some((p: any) => typeof p === 'string' && p.includes('مدة'));
  if (!hasTerms) { showroom.policies.push(SHOWROOM_SEED_INSTALLMENT_TERMS); filled.push('policies'); }
  // المدة الافتراضية: تُسجَّل صراحةً (لا تُخترع الأجهزة ذات 12 شهراً).
  if (!Number.isInteger(showroom.defaultInstallmentMonths) || showroom.defaultInstallmentMonths <= 0) {
    showroom.defaultInstallmentMonths = SHOWROOM_SEED_DEFAULT_MONTHS;
    filled.push('defaultInstallmentMonths');
  }
  return filled;
}
