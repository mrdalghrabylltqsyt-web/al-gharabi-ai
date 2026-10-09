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

/**
 * نص الإفصاح **قبل** الضغط على زر النشر الموحّد: يُعلن أن المنصات المحددة
 * (يوتيوب) لن تُنشر في هذه النقرة، بل تذهب إلى طابور المراجعة/الجدولة المخصص.
 *
 * سبب الوجود (إصلاح فجوة «نشر واحد بنقرة واحدة يوزّع على كل المنصات»): كان
 * استثناء YouTube من المنفّذ الموحّد — وهي حماية مشروعة لأن رفع فيديو YouTube
 * الفعلي يحتاج بايتات الملف (videos.insert resumable) وزمناً أطول من نقرة نصية
 * فورية — لا يظهر للمالك إلا كنص نتيجة **بعد** النشر («لا فشل هنا») فيبقى السلوك
 * مبهماً. الآن يُعلن صراحةً عند الزر نفسه أي منصة ستُوجَّه لطابورها.
 *
 * يبقى YouTube مُداراً بالكامل: الحوكمة (اعتماد، فتّح خصوصية فعلي من المزوّد،
 * لا نشر بلا معرّف فيديو حقيقي) محفوظة كما هي — لا تخفيف لأي حماية.
 */
export function youtubeDedicatedDisclosure(targetPlatforms: string[] | undefined): string | null {
  const hasYouTube = Array.isArray(targetPlatforms) && targetPlatforms.includes('youtube');
  if (!hasYouTube) return null;
  return 'يوتيوب مستثنى من النشر الفوري بنقرة واحدة: رفع الفيديو الرسمي يحتاج بايتات الملف ومهلة أطول، فيُرسَل الفيديو إلى طابور مراجعة/جدولة YouTube المخصص (بالحوكمة الكاملة). بقية المنصات تُنشر الآن.';
}


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
