/**
 * صياغة نتيجة النشر متعدد المنصات في الواجهة — مصدر واحد قابل للاختبار.
 *
 * الجذر المُثبت: كان السطر يستخدم `r.code || r.error` فيُخفي رسالة المزود الحقيقية
 * (نص خطأ Meta/Threads) كلما وُجد كود. الآن يُعرض الكود والرسالة معاً.
 *
 * **تحديث (توحيد النشر بنقرة واحدة):** YouTube صار يُنشر **داخل** النشر الموحّد
 * بنفس النقرة (لم يعد مستثنى إلى طابور منفصل). شرطه الوحيد: أن يحمل المنشور فيديو
 * فعلياً (mediaRef/رابط فيديو عام). بلا فيديو يرد `MEDIA_REQUIRED` صراحةً.
 */

/** نص صريح: YouTube صار ضمن النشر الموحّد لكنه يحتاج فيديو فعلياً. */
export const YOUTUBE_UNIFIED_PUBLISH_NOTE =
  'YouTube يُنشر في نفس النقرة، لكنه يتطلّب ملف فيديو مرفقاً بالمنشور.';

/**
 * إفصاح **قبل** ضغط زر النشر: يُذكّر بأن YouTube المحدد ضمن النشر الفوري معاً،
 * لكنه يحتاج فيديو فعلياً — فبلا فيديو سيُعلن MEDIA_REQUIRED بدل النشر.
 * لا يحجب أي منصة؛ توعية فقط حتى لا يُفاجأ المالك بفشل YouTube بلا سبب.
 */
export function youtubeDedicatedDisclosure(targetPlatforms: string[] | undefined): string | null {
  const hasYouTube = Array.isArray(targetPlatforms) && targetPlatforms.includes('youtube');
  if (!hasYouTube) return null;
  return 'يوتيوب يُنشر الآن ضمن نفس النقرة (لا طابور منفصل)؛ شرطه الوحيد: إرفاق ملف فيديو بالمنشور (mediaRef أو رابط فيديو عام). بلا فيديو يُعلن «يتطلّب وسائط» بوضوح.';
}

/** هل هذه النتيجة إشارة قديمة إلى توجيه YouTube لطابوره المخصص؟ (توافق خلفي فقط). */
export function isYouTubeDedicatedPublish(result: any): boolean {
  return result?.code === 'PLATFORM_USE_DEDICATED_PUBLISH';
}

/** هل هذه النتيجة حاجة YouTube لفيديو (ليست فشلاً حقيقياً)؟ */
export function isYouTubeMediaNeed(platform: string, result: any): boolean {
  return platform === 'youtube' && result?.code === 'MEDIA_REQUIRED';
}

/** هل هذه النتيجة «معلّقة على نفاد حصة YouTube» (ليست فشلاً)؟ */
export function isYouTubeQuotaPending(result: any): boolean {
  return result?.state === 'pending_retry' || result?.code === 'QUOTA_PENDING_RETRY' || result?.code === 'quota_exceeded';
}

/**
 * رسالة واضحة للمالك عند نفاد حصة YouTube: النشر الموحّد أُرسل، ويوتيوب «معلّق»
 * وسينشر تلقائياً فور تجدد حصة Google اليومية، مع نجاح باقي المنصات.
 */
export function quotaPendingMessage(result: any, succeededPlatforms: string[] = []): string {
  const ok = Array.isArray(succeededPlatforms) ? succeededPlatforms.filter(Boolean) : [];
  const okPart = ok.length ? ` نجح النشر على: ${ok.join('، ')}.` : '';
  const retry = result?.retryAt ? ` (إعادة المحاولة التلقائية: ${formatRetryTime(result.retryAt)})` : '';
  return `تم إرسال النشر الموحّد؛ يوتيوب «معلّق» وسيُنشر تلقائياً فور تجدد حصة Google اليومية${retry}.${okPart}`;
}

/** صياغة وقت إعادة المحاولة بصيغة محلية مقروءة (بلا كشف منطقة حساسة). */
function formatRetryTime(iso: string): string {
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return String(iso);
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** صياغة فشل منصة واحدة: الكود والرسالة الحقيقية معاً (لا إخفاء لأحدهما). */
export function formatPublishFailure(platform: string, result: any): string {
  const code = result?.code || 'ERROR';
  const error = result?.error || 'سبب غير معروف';
  return `${platform} (${code}: ${error})`;
}

/**
 * ملخّص الفشل: يفصل حاجة YouTube للفيديو عن الفشل الحقيقي، ويعرض الكود والرسالة
 * لكل منصة فاشلة حقيقية. لا يُخفي أي رسالة مزود (MEDIA_REQUIRED لمنصة غير يوتيوب
 * يبقى فشلاً حقيقياً ظاهراً بسببه).
 */
export function summarizePublishFailures(failed: Array<[string, any]>): string {
  if (!Array.isArray(failed) || !failed.length) return 'لا منصات مستهدفة';
  const realFailures = failed.filter(([pf, r]) => !isYouTubeMediaNeed(pf, r) && !isYouTubeDedicatedPublish(r) && !isYouTubeQuotaPending(r));
  const hasYouTubeMedia = failed.some(([pf, r]) => isYouTubeMediaNeed(pf, r) || (pf === 'youtube' && isYouTubeDedicatedPublish(r)));
  const quotaPending = failed.find(([, r]) => isYouTubeQuotaPending(r));
  const parts: string[] = [];
  if (quotaPending) parts.push(quotaPendingMessage(quotaPending[1]));
  if (hasYouTubeMedia) parts.push(`${YOUTUBE_UNIFIED_PUBLISH_NOTE} أرفق فيديو ثم أعد النشر.`);
  if (realFailures.length) parts.push(realFailures.map(([pf, r]) => formatPublishFailure(pf, r)).join('، '));
  return parts.join(' ') || 'لا منصات مستهدفة';
}

/**
 * وصف مصير منصة واحدة بعد التوزيع — يفصل الحالات بدل رقم إجمالي أخضر واحد:
 * نُشر وثُبّت بمعرّف مزود / قيد المعالجة / معلّق على الحصة (إعادة تلقائية) /
 * فشل بسببه / YouTube يحتاج فيديو. لا يُعلن «نشر» بلا معرّف مزود حقيقي.
 */
export function formatPlatformResultState(platform: string, result: any): { label: string; tone: 'ok' | 'pending' | 'fail' } {
  const state = result?.state;
  if (state === 'published') {
    return { label: result?.providerPostId ? `نُشر وثُبّت بمعرّف المزود: ${result.providerPostId}` : 'نُشر', tone: 'ok' };
  }
  if (state === 'pending_retry' || isYouTubeQuotaPending(result)) {
    return { label: quotaPendingMessage(result), tone: 'pending' };
  }
  if (state === 'publishing') return { label: 'قيد المعالجة لدى المزود (لم يُثبت التسليم بعد)', tone: 'pending' };
  if (isYouTubeMediaNeed(platform, result) || isYouTubeDedicatedPublish(result)) return { label: YOUTUBE_UNIFIED_PUBLISH_NOTE, tone: 'pending' };
  return { label: formatPublishFailure('فشل', result), tone: 'fail' };
}
