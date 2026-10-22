/**
 * منطق صافٍ لشارة حالة Gemini في الترويسة — قابل للاختبار بلا متصفح.
 *
 * الجذر المُثبت: الإنتاج كان يعرض «Gemini محمي/غير مفعّل» (ويُقرأ أحياناً «مقفل»)
 * بينما `/api/health` يعلن `aiEnabled: true`. سببان محتملان:
 *  1) الواجهة كانت تُسقط جسم `/api/health` عند أي رمز حالة غير 2xx (يُصلَح في
 *     `apiService.checkHealth`) فتبقى الحالة `null` ⇒ «غير معروف».
 *  2) التسمية نفسها كانت تربط «محمي» بـ«غير مفعّل» في نص واحد، فيلتبس على المالك
 *     أن الحماية (جدار الحماية فعّال دائماً) تعني أن المزود معطّل — وهي ليست كذلك.
 *
 * القاعدة الآن: الشارة تعكس **حقيقة المزود** (`aiEnabled` = وجود مفتاح Gemini)،
 * والحماية تُعلن منفصلة في العنوان (title) لا في النص الأساسي.
 */

export type GeminiBadgeTone = 'unknown' | 'enabled' | 'deterministic' | 'offline';

export interface GeminiBadgeState {
  /** النص الأساسي المعروض في الشارة. */
  label: string;
  /** لون/دلالة الحالة (لاختيار الصنف البصري). */
  tone: GeminiBadgeTone;
  /** نص توضيحي طويل (title/aria-label) يذكر الحماية الحقيقية بلا لبس. */
  title: string;
}

/**
 * يحوّل جسم `/api/health` إلى حالة شارة صادقة.
 * - غياب الجسم أو `status === 'offline'` ⇒ «غير معروف» (تعذّر الجلب، لا ادّعاء).
 * - `aiEnabled === true` ⇒ «مفعّل» (المزود جاهز)، والحماية تُذكر في العنوان.
 * - `aiEnabled === false` لكن جدار الحماية فعّال ⇒ «محرّك حتمي» (يعمل بلا مفتاح،
 *   وهذا سلوك صحيح موثّق لا عطل).
 * - غير ذلك ⇒ «غير مفعّل».
 */
export function describeGeminiBadge(health: any): GeminiBadgeState {
  const offline = !health || typeof health !== 'object' || health.status === 'offline';
  if (offline) {
    return {
      label: 'Gemini: غير معروف',
      tone: 'unknown',
      title: 'تعذّر جلب حالة النظام من الخادم؛ لا يمكن تأكيد حالة Gemini الآن.',
    };
  }
  const enabled = health.aiEnabled === true;
  const protection = health?.geminiUsage?.firewall?.protectionEnabled === true;
  if (enabled) {
    return {
      label: 'Gemini مفعّل',
      tone: 'enabled',
      title: protection
        ? 'مفتاح Gemini موجود والمزود متاح. جدار حماية الاستهلاك فعّال (حدّ يومي محلي) — لا يمنع العمل العادي.'
        : 'مفتاح Gemini موجود والمزود متاح.',
    };
  }
  if (protection) {
    return {
      label: 'Gemini: محرّك حتمي',
      tone: 'deterministic',
      title: 'لا يوجد مفتاح Gemini، فيعمل النظام بالمحرّك الحتمي (بلا مزود) — وهذا سلوك صحيح لا عطل.',
    };
  }
  return {
    label: 'Gemini غير مفعّل',
    tone: 'offline',
    title: 'Gemini غير مفعّل ولا جدار حماية فعّال.',
  };
}
