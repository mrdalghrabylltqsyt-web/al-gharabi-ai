/**
 * سياسة التحقق من الجلسة (منطق خالص وقابل للاختبار بلا متصفح).
 *
 * سبب الوجود: الواجهة كانت تُظهر شاشة الدخول عند أي فشل في طلب التحقق، بما
 * فيه أعطال 5xx أو انقطاع الشبكة. النتيجة: طرد المالك إلى OTP رغم أن جلسته
 * الموقّعة ما زالت صالحة في localStorage. القاعدة هنا تفصل بين ثلاث حالات:
 *
 *  - authenticated: الخادم أكّد الجلسة وأعاد مستخدماً صالحاً.
 *  - rejected:      الخادم رفض الجلسة صراحةً (401/403) أو لا يوجد توكن إطلاقاً.
 *                   هذه وحدها تُظهر شاشة الدخول وتُبطل التوكن.
 *  - unavailable:   تعذّر الوصول للخادم (شبكة/مهلة/5xx). الجلسة لم تُرفض، لذا
 *                   لا يُمسح التوكن ولا تُعرض شاشة الدخول؛ تُعاد المحاولة فقط.
 *
 * هذا يجعل «الخروج» مقصوراً على رفض صريح، لا على عطل عابر.
 */

export type SessionOutcome = 'authenticated' | 'rejected' | 'unavailable';

export interface SessionCheckInput {
  /** هل يوجد توكن محفوظ في المتصفح إطلاقاً؟ */
  hasToken: boolean;
  /** رمز حالة HTTP، أو null عند فشل الشبكة قبل أي استجابة. */
  status: number | null;
  /** هل أعاد الخادم مستخدماً صالحاً في جسم الاستجابة؟ */
  hasValidUser: boolean;
}

/** يُصنّف نتيجة طلب /api/auth/me إلى: مصادق / مرفوض / غير متاح. */
export function classifySessionCheck(input: SessionCheckInput): SessionOutcome {
  if (input.hasValidUser) return 'authenticated';
  // لا توكن = لا جلسة فعلاً => شاشة الدخول مشروعة.
  if (!input.hasToken) return 'rejected';
  // الرفض الصريح فقط (منتهية/مُبطلة/حساب معطّل) يُبطل الجلسة.
  if (input.status === 401 || input.status === 403) return 'rejected';
  // كل ما عداه — شبكة، مهلة، 5xx، أو استجابة مشوّهة — عطل عابر لا يُسجّل خروجاً.
  return 'unavailable';
}

export type PreviewExchangeOutcome = 'ok' | 'invalid' | 'unavailable';

export interface PreviewExchangeInput {
  /** رمز حالة HTTP، أو null عند فشل الشبكة. */
  status: number | null;
  /** هل مُنحت جلسة فعلية (success + توكن)؟ */
  hasSessionToken: boolean;
}

/**
 * يُصنّف نتيجة تبادل توكن المعاينة. التمييز مهم: توكن خاطئ (401/403/404)
 * يعني fallback لشاشة الدخول، أما عطل الخادم فلا يعني أن التوكن باطل.
 */
export function classifyPreviewExchange(input: PreviewExchangeInput): PreviewExchangeOutcome {
  if (input.hasSessionToken) return 'ok';
  if (input.status === 401 || input.status === 403 || input.status === 404) return 'invalid';
  return 'unavailable';
}