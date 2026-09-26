/**
 * التحقق من ملكية النطاق/بادئة الرابط (URL prefix) لدى TikTok — مصدر واحد.
 *
 * سبب الوجود: TikTok يتحقق من ملكية بادئة الرابط عبر ملف تحقق عام يُخدَم من
 * جذر البادئة، ووثيقته الرسمية (Manage URL properties) تنصّ على أن:
 *   - اسم الملف = قيمة `file_name` التي يعيدها TikTok (بصيغة `tiktok<token>.txt`)،
 *   - محتوى الملف = قيمة `signature` (سلسلة التوقيع نفسها).
 * والوثيقة تُشدّد على أن الملف يجب أن يكون عاماً (publicly accessible) وبلا
 * تحويل: «Redirections are not followed. URLs that return HTTP 3xx are invalid».
 *
 * قبل هذا الملف كان طلب `/tiktok<token>.txt` يسقط إلى واجهة React فيُعاد
 * `index.html` بحالة 200 — فيقرأ TikTok HTML بدل سلسلة التوقيع ويفشل التحقق
 * بلا سبب ظاهر. هنا يُبنى الاسم والمحتوى من الرمز في مكان واحد، ويُخدَم الملف
 * نصاً صريحاً (text/plain) بلا تحويل، فلا انحراف بين ما يُخدَم وما يتوقّعه TikTok.
 *
 * الرمز ليس سرّاً: TikTok يطلبه علناً من الإنترنت، ولهذا يمكن ذكره هنا وفي
 * أي استجابة حالة. لا يوجد أي اعتماد أو مفتاح في هذا الملف.
 */

/** بادئة سلسلة التوقيع الرسمية كما يعيدها TikTok في `signature`. */
export const TIKTOK_SITE_VERIFICATION_PREFIX = 'tiktok-developers-site-verification=';

/** الرمز الذي ولّده TikTok لهذا التطبيق (public by design، ليس سرّاً). */
export const TIKTOK_VERIFICATION_TOKEN = 'djxlJcC4WFlCh4OZY8IVHgezp491vPoZ';

/** اسم الملف الرسمي الذي طلبه TikTok = `tiktok<token>.txt`. */
export const TIKTOK_VERIFICATION_FILENAME = `tiktok${TIKTOK_VERIFICATION_TOKEN}.txt`;

/** محتوى الملف الرسمي = سلسلة التوقيع كاملة. */
export const TIKTOK_VERIFICATION_CONTENT = `${TIKTOK_SITE_VERIFICATION_PREFIX}${TIKTOK_VERIFICATION_TOKEN}`;

/** نوع المحتوى الذي يخدمه الخادم: نص صريح، بلا HTML وبلا أي تفاوض. */
export const VERIFICATION_CONTENT_TYPE = 'text/plain; charset=utf-8';

export interface SiteVerificationFile {
  /** اسم الملف كما يُطلب من الجذر (بلا شرطة بادئة). */
  filename: string;
  /** سلسلة التوقيع كما يجب أن يقرأها TikTok حرفياً. */
  content: string;
  contentType: string;
}

/** صيغة الرمز: محارف أبجدية رقمية فقط، بطول معقول (لا مسافات ولا شرطات). */
const TOKEN_PATTERN = /^[A-Za-z0-9]{8,128}$/;

/**
 * يبني ملف التحقق من رمز TikTok. يرفض صراحةً أي رمز لا يطابق الصيغة بدل إنتاج
 * ملف لا يطابق ما يتوقّعه TikTok (رمز فيه مسافة/سطر يُفشل التحقق صامتاً).
 */
export function buildTikTokVerificationFile(token: string): SiteVerificationFile {
  const clean = String(token || '').trim();
  if (!TOKEN_PATTERN.test(clean)) {
    throw new Error('رمز تحقق TikTok غير صالح: يلزم محارف أبجدية رقمية فقط.');
  }
  return {
    filename: `tiktok${clean}.txt`,
    content: `${TIKTOK_SITE_VERIFICATION_PREFIX}${clean}`,
    contentType: VERIFICATION_CONTENT_TYPE,
  };
}

/** يستخرج الرمز من اسم ملف بصيغة `tiktok<token>.txt`، أو null إن لم يطابق. */
export function parseTikTokVerificationToken(filename: string): string | null {
  const match = /^tiktok([A-Za-z0-9]{8,128})\.txt$/.exec(String(filename || '').trim());
  return match ? match[1] : null;
}

/**
 * كل ملفات التحقق التي يخدمها الخادم. الملف الرسمي أولاً، ثم اسم بديل شائع
 * يستخدمه كثير من المطوّرين (`tiktok-developers-site-verification.txt`) بالمحتوى
 * نفسه، فلا يفشل التحقق إن غيّر المالك الرمز لاحقاً بنفس الطريقة.
 */
export function siteVerificationFiles(): SiteVerificationFile[] {
  const official = buildTikTokVerificationFile(TIKTOK_VERIFICATION_TOKEN);
  return [
    official,
    { filename: 'tiktok-developers-site-verification.txt', content: official.content, contentType: VERIFICATION_CONTENT_TYPE },
  ];
}

/**
 * يطابق مسار طلب (pathname بلا استعلام) بملف تحقق معروف، أو null.
 * المطابقة حرفية على الجذر فقط، فلا يُخدَم الملف من مسار فرعي.
 */
export function verificationFileForPath(pathname: string): SiteVerificationFile | null {
  const raw = String(pathname || '').trim();
  if (!raw.startsWith('/') || raw.slice(1).includes('/')) return null;
  const name = raw.slice(1);
  return siteVerificationFiles().find((file) => file.filename === name) || null;
}

/**
 * صيغة المسار التي يستقبلها Express: `/tiktok<...>.txt` في الجذر فقط.
 * ضيّقة عن قصد حتى لا تلتقط مسارات أخرى، ولأن الجذر هو ما يطلبه TikTok.
 */
export const SITE_VERIFICATION_PATH_PATTERN = /^\/tiktok[-A-Za-z0-9]*\.txt$/;

/** الرابط العام الكامل لملف التحقق (أو null إن تعذّر تحديد العنوان العام). */
export function verificationFileUrl(baseUrl: string | null | undefined, filename = TIKTOK_VERIFICATION_FILENAME): string | null {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/${filename}`;
}
