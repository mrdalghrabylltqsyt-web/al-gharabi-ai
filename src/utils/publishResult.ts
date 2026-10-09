/**
 * صياغة نتيجة النشر متعدد المنصات في الواجهة — مصدر واحد قابل للاختبار.
 *
 * الجذر المُثبت: كان السطر يستخدم `r.code || r.error` فيُخفي رسالة المزود الحقيقية
 * (نص خطأ Meta/Threads) كلما وُجد كود. الآن يُعرض الكود والرسالة معاً، ويُميَّز
 * YouTube بأنه يُنشر عبر طابوره المخصص لا أنه «فشل».
 */

/** نص صريح: نشر YouTube يمر بطابوره المخصص لا بالنشر الموحّد. */
export const YOUTUBE_DEDICATED_PUBLISH_NOTE =
  'YouTube يُنشر عبر طابوره المخصص (لا عبر النشر الموحّد) — لا فشل هنا.';

/** هل هذه النتيجة هي توجيه YouTube المقصود إلى مساره المخصص؟ */
export function isYouTubeDedicatedPublish(result: any): boolean {
  return result?.code === 'PLATFORM_USE_DEDICATED_PUBLISH';
}

/** صياغة فشل منصة واحدة: الكود والرسالة الحقيقية معاً (لا إخفاء لأحدهما). */
export function formatPublishFailure(platform: string, result: any): string {
  const code = result?.code || 'ERROR';
  const error = result?.error || 'سبب غير معروف';
  return `${platform} (${code}: ${error})`;
}

/**
 * ملخّص الفشل: يفصل YouTube-المخصص عن الفشل الحقيقي، ويعرض الكود والرسالة لكل
 * منصة فاشلة حقيقية. لا يُخفي أي رسالة مزود.
 */
export function summarizePublishFailures(failed: Array<[string, any]>): string {
  if (!Array.isArray(failed) || !failed.length) return 'لا منصات مستهدفة';
  const realFailures = failed.filter(([, r]) => !isYouTubeDedicatedPublish(r));
  const hasYouTubeDedicated = failed.some(([, r]) => isYouTubeDedicatedPublish(r));
  const parts: string[] = [];
  if (hasYouTubeDedicated) parts.push(YOUTUBE_DEDICATED_PUBLISH_NOTE);
  if (realFailures.length) parts.push(realFailures.map(([pf, r]) => formatPublishFailure(pf, r)).join('، '));
  return parts.join(' ') || 'لا منصات مستهدفة';
}

/**
 * وصف مصير منصة واحدة بعد التوزيع — يفصل الحالات بدل رقم إجمالي أخضر واحد:
 * نُشر وثُبّت بمعرّف مزود / قيد المعالجة / فشل بسببه / توجيه YouTube لطابوره.
 * لا يُعلن «نشر» بلا معرّف مزود حقيقي (providerPostId).
 */
export function formatPlatformResultState(result: any): { label: string; tone: 'ok' | 'pending' | 'fail' } {
  if (isYouTubeDedicatedPublish(result)) return { label: YOUTUBE_DEDICATED_PUBLISH_NOTE, tone: 'pending' };
  const state = result?.state;
  if (state === 'published') {
    return { label: result?.providerPostId ? `نُشر وثُبّت بمعرّف المزود: ${result.providerPostId}` : 'نُشر', tone: 'ok' };
  }
  if (state === 'publishing') return { label: 'قيد المعالجة لدى المزود (لم يُثبت التسليم بعد)', tone: 'pending' };
  return { label: formatPublishFailure('فشل', result), tone: 'fail' };
}
