/**
 * سياسة حالة المحتوى حسب الدور — مصدر واحد.
 *
 * سبب الوجود: مسار تعديل المحتوى (`PATCH /api/workspace/content/:id`) كان يسمح
 * لأي دور محرّر بكتابة `status:"approved"` أو `"scheduled"` مباشرةً، بينما مسارا
 * الاعتماد والجدولة الرسميان محصوران بالمالك (`requireOwner`). وبما أن بوابة النشر
 * تقرأ حالة المنشور مباشرةً (`approved === true`)، فقد كان موظف عادي قادراً على
 * **انتحال قرار الاعتماد** فيمرّ النشر بلا موافقة المالك — وهو تجاوز لبوابة
 * اعتماد النشر الحرجة.
 *
 * القاعدة الملزمة:
 *  - تعديل/إنشاء المحتوى: owner/manager/staff/content_creator فقط.
 *  - الحالات القابلة للتعيين عبر PATCH/إنشاء: draft/review/edited فقط.
 *  - `approved`/`scheduled`: تُعيَّن حصرياً عبر مساريها الرسميين المحصورين بالمالك
 *    (لأنهما يفرضان انتقال حالة صحيحاً ويسجّلان أثراً في السجل).
 *  - `published`: لا تُعيَّن أبداً عبر هذين المسارين؛ تتطلب إيصال تنفيذ من مزود المنصة.
 *
 * المنطق خالص وحتمي: لا شبكة ولا مزود ولا استهلاك حصة.
 */

export type ContentStatusRole = 'owner' | 'manager' | 'staff' | 'content_creator' | 'customer_support';

/** الأدوار المسموح لها بإنشاء/تعديل المحتوى (مطابقة لمسار الإرسال للمراجعة). */
export const CONTENT_EDITOR_ROLES: readonly ContentStatusRole[] = Object.freeze(['owner', 'manager', 'staff', 'content_creator']);

/** الحالات التي يجوز تعيينها مباشرةً عبر PATCH أو عند الإنشاء. */
export const CONTENT_DIRECT_SETTABLE_STATUSES: readonly string[] = Object.freeze(['draft', 'review', 'edited']);

/** حالات تتطلب مسارها الرسمي المحصور بالمالك (اعتماد/جدولة). */
export const CONTENT_OWNER_ONLY_STATUSES: readonly string[] = Object.freeze(['approved', 'scheduled']);

/** الحالة الوحيدة التي تتطلب إيصال تنفيذ موثّق من مزود المنصة. */
export const CONTENT_PROVIDER_PROOF_STATUS = 'published';

export interface ContentStatusDecision {
  allowed: boolean;
  /** كود صريح عند الرفض (بلا كشف أي سر). */
  code?: 'ROLE_NOT_PERMITTED' | 'OWNER_APPROVAL_ENDPOINT_REQUIRED' | 'PUBLISHED_REQUIRES_PROVIDER_PROOF' | 'UNKNOWN_STATUS';
  reason?: string;
}

/** هل يملك هذا الدور صلاحية إنشاء/تعديل المحتوى؟ */
export function canEditContent(role: string): boolean {
  return (CONTENT_EDITOR_ROLES as readonly string[]).includes(role);
}

/**
 * هل يجوز تعيين هذه الحالة عبر PATCH أو عند الإنشاء لهذا الدور؟
 * تُرفض `approved`/`scheduled` (مسار المالك الرسمي) و`published` (إثبات مزود).
 */
export function canSetContentStatusByRole(role: string, status: string): ContentStatusDecision {
  if (!canEditContent(role)) {
    return { allowed: false, code: 'ROLE_NOT_PERMITTED', reason: 'لا تملك صلاحية تعديل المحتوى.' };
  }
  if (status === CONTENT_PROVIDER_PROOF_STATUS) {
    return { allowed: false, code: 'PUBLISHED_REQUIRES_PROVIDER_PROOF', reason: 'لا يمكن تسجيل المنشور كمُنشَر دون إيصال تنفيذ خارجي موثّق من مزود المنصة.' };
  }
  if ((CONTENT_OWNER_ONLY_STATUSES as readonly string[]).includes(status)) {
    return { allowed: false, code: 'OWNER_APPROVAL_ENDPOINT_REQUIRED', reason: 'اعتماد/جدولة المحتوى مقتصران على المالك عبر مسارهما الرسمي.' };
  }
  if ((CONTENT_DIRECT_SETTABLE_STATUSES as readonly string[]).includes(status)) {
    return { allowed: true };
  }
  return { allowed: false, code: 'UNKNOWN_STATUS', reason: 'حالة محتوى غير معروفة.' };
}
