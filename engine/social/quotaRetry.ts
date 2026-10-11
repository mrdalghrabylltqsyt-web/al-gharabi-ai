/**
 * إعادة المحاولة الذكية عند نفاد حصة YouTube Data API — منطق صافٍ حتمي قابل للاختبار
 * (بلا شبكة/أسرار/ساعة حقيقية). يُحقن `nowMs` في كل دالة.
 *
 * الجذر: عند استنفاد الحصة اليومية لـGoogle يرد YouTube `quotaExceeded`، وكان النشر
 * يُسجَّل **فشلاً نهائياً** رغم أن الحصة تتجدد تلقائياً كل يوم. الآن يُوضع المنشور في
 * حالة **«معلق/إعادة محاولة»** ويُعاد إرساله تلقائياً فور تجدد الحصة (منتصف ليل
 * المحيط الهادئ)، بلا أي تدخل بشري.
 *
 * **الصدق:** هذا المنطق يخطّط ويصنّف فقط؛ التنفيذ الفعلي يبقى في الخادم عبر
 * `executeYouTubePublish` (كل بواباته سارية). لا يُعلن «نشر» بلا معرّف مزود حقيقي.
 */

/**
 * هل يحمل كود/رسالة خطأ YouTube دلالة «نفاد الحصة»؟ (quotaExceeded).
 * يقبل الكود الصريح `quota_exceeded`، أو أي نص يحمل `quota` (رسالة Google الخام).
 */
export function isYouTubeQuotaExceeded(codeOrMessage: string | null | undefined): boolean {
  const s = String(codeOrMessage || '').toLowerCase();
  if (!s) return false;
  return s.includes('quota_exceeded') || s.includes('quotaexceeded') || s.includes('quota');
}

/** المنطقة الزمنية الرسمية لليوم الذي تتجدد فيه حصة Google: المحيط الهادئ. */
export const YOUTUBE_QUOTA_TIMEZONE = 'America/Los_Angeles';

/**
 * فارق التوقيت (بالدقائق) لمنطقة المحيط الهادئ عن UTC عند لحظة معينة: PDT (-420) أو
 * PST (-480). يُحسب حسابياً بلا مكتبة ولا بيانات IANA، فيعمل على الخادم والمتصفح.
 * الخوارزمية: قاعدة التوقيت الصيفي الأمريكي = الأحد الثاني من آذار (بدءاً 02:00 محلي
 * = 10:00 UTC) حتى الأحد الأول من تشرين الثاني (بدءاً 02:00 محلي = 09:00 UTC).
 */
export function pacificOffsetMinutes(nowMs: number): number {
  const d = new Date(nowMs);
  const year = d.getUTCFullYear();
  const nthSundayUtc = (monthIndex: number, nth: number, utcHour: number): number => {
    // أول يوم في الشهر، ثم أول أحد، ثم نضيف (nth-1) أسابيع. كل ذلك بتوقيت UTC.
    const first = Date.UTC(year, monthIndex, 1, utcHour, 0, 0);
    const firstWeekday = new Date(first).getUTCDay(); // 0=الأحد
    const firstSunday = first + ((7 - firstWeekday) % 7) * 86400000;
    return firstSunday + (nth - 1) * 7 * 86400000;
  };
  const dstStart = nthSundayUtc(2, 2, 10); // ثاني أحد من آذار، 10:00 UTC
  const dstEnd = nthSundayUtc(10, 1, 9);   // أول أحد من تشرين الثاني، 09:00 UTC
  const isDst = nowMs >= dstStart && nowMs < dstEnd;
  return isDst ? -420 : -480;
}

/**
 * يبني طابع يوم الحصة (YYYY-MM-DD) بحسب توقيت المحيط الهادئ — أساس «يوم الحصة» نفسه
 * المستخدم في التدوير، فلا يتناقض حساب «التجدد التالي» مع تدوير العدّاد.
 */
export function quotaDayKey(nowMs: number): string {
  const offset = pacificOffsetMinutes(nowMs);
  const local = new Date(nowMs + offset * 60000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
}

/**
 * لحظة تجدد الحصة التالية = منتصف ليل المحيط الهادئ التالي (UTC epoch ms).
 * تُستخدم لجدولة إعادة المحاولة التلقائية.
 */
export function nextQuotaResetAtMs(nowMs: number): number {
  const offset = pacificOffsetMinutes(nowMs);
  const localMs = nowMs + offset * 60000;      // الجدار المحلي المُزاح
  const local = new Date(localMs);
  // منتصف ليل اليوم التالي بالتوقيت المحلي، ثم نعيده إلى UTC.
  const nextMidnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 0, 0, 0);
  // نضيف هامش أمان 3 دقائق ليتجنّب حدود اليوم.
  return nextMidnightLocal - offset * 60000 + 3 * 60000;
}

/** مهلة إعادة محاولة قصيرة (احتياطية إن أراد المالك تسريعها يدوياً). */
export const QUOTA_RETRY_SHORT_MS = 15 * 60 * 1000;

export interface QuotaRetryPlan {
  /** حالة المنشور: معلّق (retry) لا فشل نهائي. */
  state: 'pending_retry';
  /** كود صريح يعرض في الواجهة والتقرير. */
  code: 'QUOTA_PENDING_RETRY';
  /** لحظة إعادة المحاولة (UTC epoch ms) = منتصف ليل المحيط الهادئ التالي. */
  retryAtMs: number;
  /** طابع يوم الحصة الحالي (America/Los_Angeles). */
  quotaDay: string;
  /** سبب عربي واضح للمالك. */
  reason: string;
  /** هل السبب نفاد حصة Google الفعلي (false) أم الحارس التقديري الداخلي (true)؟ */
  internalGuard: boolean;
}

/**
 * يخطّط إعادة المحاولة عند نفاد الحصة: دائماً بعد تجدد الحصة اليومية (منتصف ليل
 * المحيط الهادئ)، وهو نفس وقت تجدد حصة Google الفعلية. `internalGuard` يغيّر نص
 * السبب فقط (حارس تقديري داخلي مقابل حصة Google الفعلية) لا وقت الإعادة.
 */
export function planQuotaRetry(nowMs: number, opts: { internalGuard?: boolean } = {}): QuotaRetryPlan {
  const internalGuard = opts.internalGuard === true;
  const reason = internalGuard
    ? 'حارس الحصة التقديري الداخلي بلغ الحد الآمن؛ سيُعاد إرسال النشر تلقائياً فور تجدد الحصة اليومية (منتصف ليل المحيط الهادئ) بلا تدخل.'
    : 'نفدت حصة YouTube Data API اليومية؛ سينشر تلقائياً فور تجدد الحصة (منتصف ليل المحيط الهادئ) بلا تدخل.';
  return { state: 'pending_retry', code: 'QUOTA_PENDING_RETRY', retryAtMs: nextQuotaResetAtMs(nowMs), quotaDay: quotaDayKey(nowMs), reason, internalGuard };
}

/** هل حان موعد إعادة المحاولة المجدولة؟ */
export function isQuotaRetryDue(retryAtIso: string | null | undefined, nowMs: number): boolean {
  if (!retryAtIso) return false;
  const t = Date.parse(String(retryAtIso));
  if (!Number.isFinite(t)) return false;
  return nowMs >= t;
}

/** هل يجب تخطّي دورة مراقبة YouTube الآن بسبب انخفاض الحصة المتبقية؟ (توفير الحصة للنشر). */
export function shouldSkipPollForQuota(remainingUnits: number, unitsPerPoll: number): boolean {
  if (!Number.isFinite(remainingUnits) || !Number.isFinite(unitsPerPoll) || unitsPerPoll <= 0) return false;
  return remainingUnits < unitsPerPoll;
}

/**
 * تسمية عربية لحالة الانتظار على الحصة (تُعرض في الواجهة والتقرير) — تفصل بوضوح
 * أن النشر أُرسل لكن يوتيوب «معلق» لا «فشل»، مع نجاح باقي المنصات.
 */
export function quotaPendingRetryLabel(platformsSucceeded: string[]): string {
  const ok = Array.isArray(platformsSucceeded) ? platformsSucceeded.filter(Boolean) : [];
  const okPart = ok.length ? ` نجح النشر على: ${ok.join('، ')}.` : '';
  return `تم إرسال النشر الموحّد؛ يوتيوب «معلّق» وسيُنشر تلقائياً فور تجدد حصة Google اليومية.${okPart}`;
}
