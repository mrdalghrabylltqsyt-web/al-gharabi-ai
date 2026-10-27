/**
 * مصدر الجلسة بالعربية (2026-10-27): كانت جلسات فيسبوك/إنستغرام/ثريدز/تيليغرام تُوسم «youtube_event»
 * لأن المراقبين استعملوا نوع الحدث نفسه. الجديدة تُوسم platform_event؛ القديمة تُعرف من نص مهمتها.
 */
const SOURCE_PLATFORMS: Array<[RegExp, string]> = [[/facebook|فيسبوك/i, 'فيسبوك'], [/instagram|إنستغرام/i, 'إنستغرام'], [/threads|ثريدز/i, 'ثريدز'], [/telegram|تيليغرام/i, 'تيليغرام'], [/youtube|يوتيوب/i, 'يوتيوب']];
export function sessionSourceLabel(s: { trigger?: string; task?: string }): string {
  const t = String(s.trigger || '');
  if (t === 'owner_request') return 'طلب المالك';
  if (t === 'scheduled') return 'دورة مجدولة';
  if (t === 'manual') return 'تشغيل يدوي';
  const hit = SOURCE_PLATFORMS.find(([re]) => re.test(String(s.task || '')));
  if (hit) return `حدث ${hit[1]}`;
  return t === 'youtube_event' ? 'حدث يوتيوب' : t === 'platform_event' ? 'حدث منصة' : t;
}
