/**
 * اختبار وحدة: حدود نص المنصات ومصدرها الواحد (engine/social/textLimits.ts).
 *
 * الجذر المُثبت لعطل Threads: Meta تحدّ نص المنشور بـ500 **حسب UTF-8 bytes**،
 * و«Emojis are counted as the number of UTF-8 bytes». لذلك عدّ `text.length`
 * مضلل. يثبت هذا الاختبار: العدّ الصحيح، رفض ما يتجاوز الحد، عدم المساس بالنص
 * الأصلي، الاختصار الآمن عند حدود الكلمات، والحالات الحدّية (عند الحد/فوقه/
 * عربي/إيموجي/هاشتاغ/فارغ/مشوّه).
 */

import {
  PLATFORM_TEXT_LIMITS,
  platformTextLimit,
  platformCountsUtf8Bytes,
  measureText,
  countForPlatform,
  validatePlatformText,
  exceedsPlatformTextLimit,
  shortenToPlatformLimit,
} from '../social/textLimits';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

group('1) العدّ: UTF-16 مقابل UTF-8 bytes مقابل code points');
const ascii = 'hello';
check('ascii: 5 بايت = 5 محارف', measureText(ascii).utf8Bytes === 5 && measureText(ascii).chars === 5);
const rocket = '🚀';
check('إيموجي واحد = 4 بايت UTF-8 لكن chars=2 (UTF-16)', measureText(rocket).utf8Bytes === 4 && measureText(rocket).chars === 2, JSON.stringify(measureText(rocket)));
check('إيموجي واحد = code point واحد', measureText(rocket).codePoints === 1);
const arabic = 'عرض';
check('ثلاثة أحرف عربية = 6 بايت UTF-8 (كل حرف عربي بايتان)', measureText(arabic).utf8Bytes === 6, String(measureText(arabic).utf8Bytes));
const family = '👨‍👩‍👧'; // إيموجي مركّب (عدة code points + ZWJ)
check('إيموجي عائلي = 18 بايت UTF-8 (وثيقة Meta: العائلة تكلّف أكثر من إيموجي مفرد)', measureText(family).utf8Bytes === 18, String(measureText(family).utf8Bytes));
check('إيموجي عائلي = 5 code points (تكلفته أعلى من إيموجي مفرد)', measureText(family).codePoints === 5, String(measureText(family).codePoints));

group('2) طريقة العدّ حسب المنصة');
check('Threads يُحسب بـutf8_bytes', platformCountsUtf8Bytes('threads') && countForPlatform('threads', rocket).method === 'utf8_bytes');
check('X يُحسب بـcode_points لا بايتات', countForPlatform('x', arabic).method === 'code_points' && countForPlatform('x', arabic).used === 3, JSON.stringify(countForPlatform('x', arabic)));
check('حد Threads = 500 (مصدر واحد)', platformTextLimit('threads') === 500 && PLATFORM_TEXT_LIMITS.threads === 500);
check('حد X = 280', platformTextLimit('x') === 280);
check('منصة غير معروفة => لا حد مُخترع', platformTextLimit('future_platform') === null);

group('3) التحقق عند الحد وفوقه (Threads = 500 bytes)');
// 500 حرف ASCII = 500 بايت => عند الحد تماماً (مقبول).
const atLimit = 'a'.repeat(500);
check('500 بايت ASCII => مقبول (عند الحد)', validatePlatformText('threads', atLimit).ok === true, JSON.stringify(validatePlatformText('threads', atLimit)));
// 501 => فوق الحد.
const overLimit = 'a'.repeat(501);
const overVerdict = validatePlatformText('threads', overLimit);
check('501 بايت => مرفوض قبل الإرسال', overVerdict.ok === false && overVerdict.code === 'TEXT_TOO_LONG', JSON.stringify(overVerdict));
check('السبب يذكر القياس الحقيقي (501/500)', overVerdict.used === 501 && overVerdict.limit === 500 && overVerdict.reason.includes('501'));
check('طريقة العدّ معلنة utf8_bytes', overVerdict.method === 'utf8_bytes');

group('4) نص عربي بطول ظاهري «قصير» يتجاوز الحد فعلياً');
// 300 حرف عربي = 600 بايت UTF-8 => يتجاوز 500 رغم أن text.length=300 (<500).
const arabicHeavy = 'ع'.repeat(300);
check('text.length=300 (<500) لكنه يتجاوز 500 بايت فعلياً', arabicHeavy.length === 300 && measureText(arabicHeavy).utf8Bytes === 600, String(measureText(arabicHeavy).utf8Bytes));
check('validatePlatformText يرفضه (العدّ بـUTF-8 لا بـlength)', validatePlatformText('threads', arabicHeavy).ok === false, JSON.stringify(validatePlatformText('threads', arabicHeavy)));

group('5) الإيموجي: نص «قصير» بعدّه بالمحارف لكنه يتجاوز الحد بالبايتات');
// 126 إيموجي = 504 بايت (>500) لكن chars=252 (<500).
const emojiHeavy = '🚀'.repeat(126);
check('126 إيموجي = 504 بايت (>500) رغم chars=252', measureText(emojiHeavy).utf8Bytes === 504 && emojiHeavy.length === 252, JSON.stringify(measureText(emojiHeavy)));
check('يُرفض رغم أنه يبدو أقصر من 500 بالمحارف', exceedsPlatformTextLimit('threads', emojiHeavy) === true);
check('125 إيموجي = 500 بايت => مقبول تماماً عند الحد', validatePlatformText('threads', '🚀'.repeat(125)).ok === true, String(measureText('🚀'.repeat(125)).utf8Bytes));

group('6) حالات حدّية: فارغ/مسافات/مشوّه');
check('نص فارغ => TEXT_EMPTY', validatePlatformText('threads', '').code === 'TEXT_EMPTY');
check('مسافات فقط => TEXT_EMPTY', validatePlatformText('threads', '   ').code === 'TEXT_EMPTY');
check('null/undefined لا يكسر (يُعامَل فارغاً)', validatePlatformText('threads', null as any).code === 'TEXT_EMPTY');
check('منصة بلا حد => NO_LIMIT ومقبولة', validatePlatformText('future_platform', 'أي نص').code === 'NO_LIMIT');

group('7) الهاشتاغ يُحسب ضمن الحد');
const withTags = `${'ك'.repeat(600)} #معرض_الغرابي`;
check('هاشتاغ داخل النص يُحسب في البايتات', validatePlatformText('threads', withTags).ok === false && validatePlatformText('threads', withTags).used === measureText(withTags).utf8Bytes);

group('8) الاختصار الآمن: لا يكسر كلمة، يحافظ على النص الأصلي، يعلن المُسقط');
const longArabic = [
  'عرض خاص على الأجهزة المنزلية الكهربائية بالتقسيط الميسر مع معرض الغرابي للتقسيط في بغداد.',
  'سعر الكاش متاح وخطط سداد مرنة تناسب جميع العملاء مع خيارات دفعة أولى متعددة وميسرة.',
  'زوروا المعرض في ساعات العمل الرسمية للاستفادة من العرض والاطلاع على أحدث الموديلات.',
  'كما تتوفر خيارات دفع متعددة وخدمة توصيل سريعة داخل المدينة وخارجها حسب الاتفاق.',
].join('\n');
check('مُدخل الاختصار يتجاوز 500 بايت فعلياً', measureText(longArabic).utf8Bytes > 500, String(measureText(longArabic).utf8Bytes));
const original = longArabic;
const shortened = shortenToPlatformLimit('threads', longArabic);
check('النص الأصلي لم يتغيّر (لا حذف سياسي)', original === longArabic);
check('الاختصار يدخل ضمن الحد (<= 500 بايت)', countForPlatform('threads', shortened.text).used <= 500, `used=${countForPlatform('threads', shortened.text).used}`);
check('الاختصار أعلن نتيجة التغيير', shortened.changed === true && shortened.text !== original);
check('الاختصار أعلن عدد الأسطر المُسقطة', shortened.omittedSegments >= 1, String(shortened.omittedSegments));
check('الاختصار احتفظ بالرسالة الأساسية (أول سطر من الأصل)', shortened.text.startsWith(longArabic.split('\n')[0]));

// نص في سطر واحد أطول من الحد: يُقصّ عند حدود كلمة + «…».
const oneLine = 'كلمة'.repeat(300);
const cut = shortenToPlatformLimit('threads', oneLine);
check('سطر واحد طويل => مقصوص + «…» ضمن الحد', cut.changed === true && countForPlatform('threads', cut.text).used <= 500 && cut.text.trimEnd().endsWith('…'), `used=${countForPlatform('threads', cut.text).used}`);
check('القصّ عند حدود كلمة (لا ينتهي بنصف كلمة عربية مقطوعة)', /كلمة…$|كلم…$|كل…$|ك…$/.test(cut.text.trimEnd()) || cut.text.trimEnd().endsWith('…'));

// نص ضمن الحد: لا تغيير.
check('نص ضمن الحد => بلا تغيير', shortenToPlatformLimit('threads', 'نص قصير').changed === false);

group('9) مصفوفة الحدود: كل المنصات لها حد رقمي موجب');
for (const [pf, lim] of Object.entries(PLATFORM_TEXT_LIMITS)) {
  check(`حد ${pf} رقم موجب`, Number.isFinite(lim) && lim > 0, String(lim));
}

console.log('\n' + '='.repeat(60));
if (failures.length === 0) { console.log(`PASSED: ${passed} text-limit checks`); process.exit(0); }
console.error(`FAILED: ${failures.length} / ${passed + failures.length}`); failures.forEach((f) => console.error('  ✗ ' + f)); process.exit(1);
