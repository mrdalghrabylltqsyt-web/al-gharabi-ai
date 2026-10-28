/**
 * تفسير رفض Google Business Profile (2026-10-28) — منطق صافٍ قابل للاختبار.
 *
 * بعد نجاح الدخول وتبادل الرمز فشل الربط بجملة عامة «تعذّر إثبات هوية حساب google_business»: كانت رسالة
 * Google الحقيقية تُرمى. الأسباب الشائعة لهذه الخطوة بالذات (GET /v1/accounts):
 *   - الـAPI غير مفعّلة في المشروع (403 SERVICE_DISABLED / «has not been used in project»).
 *   - حصة الطلبات صفر لأن طلب الوصول لـBusiness Profile APIs لم يُقبل بعد (429 / RESOURCE_EXHAUSTED).
 *   - لا يوجد ملف نشاط تجاري على حساب Google هذا (الرد بلا accounts).
 */
export function googleBusinessAccountHint(input: { status: number; message?: string | null; reason?: string | null; empty?: boolean }): string {
  const msg = String(input.message || '');
  const reason = String(input.reason || '').toUpperCase();
  if (input.empty) return 'حساب Google هذا لا يملك ملف نشاط تجاري (Business Profile). سجّل الدخول بالحساب الذي يدير ملف المعرض على خرائط Google، أو أنشئ الملف من business.google.com.';
  if (reason === 'SERVICE_DISABLED' || /has not been used in project|is disabled|API_NOT_ACTIVATED|not been enabled/i.test(msg)) {
    return 'واجهة «My Business Account Management API» غير مفعّلة في مشروع Google. من Google Cloud ← APIs & Services ← Library ابحث عنها واضغط «Enable» (وكذلك «My Business Business Information API»)، ثم أعد الربط بعد دقائق.';
  }
  if (input.status === 429 || reason === 'RATE_LIMIT_EXCEEDED' || /RESOURCE_EXHAUSTED|quota|Quota exceeded/i.test(msg)) {
    return 'حصة Business Profile API في مشروعك صفر لأن Google لم توافق بعد على طلب الوصول. قدّم «طلب الوصول إلى Business Profile APIs» من صفحة Google الرسمية (developers.google.com/my-business ← Request access) بمعرّف المشروع، وانتظر موافقتهم (عادة أيام).';
  }
  if (input.status === 401 || input.status === 403) return 'رفضت Google قراءة الحساب بهذا الإذن. تأكد أنك وافقت على صلاحية «إدارة ملفات النشاط التجاري» عند الدخول، ثم أعد الربط.';
  return 'رفضت Google قراءة حساب النشاط التجاري. أعد المحاولة بعد قليل، وإن تكرر أرسل نص الخطأ للدعم.';
}
