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

/**
 * الرمز الافتراضي الذي ولّده TikTok لهذا التطبيق (public by design، ليس سرّاً).
 * يمكن تجاوزه من البيئة عبر `TIKTOK_VERIFICATION_TOKEN` إن ولّد TikTok رمزاً
 * جديداً عند إعادة إضافة الخاصية، فيُخدَم الرمز الصحيح بلا تعديل كود.
 */
export const DEFAULT_TIKTOK_VERIFICATION_TOKEN = 'djxlJcC4WFlCh4OZY8IVHgezp491vPoZ';

/** اسم متغير البيئة الذي يتجاوز الرمز المدموج. */
export const TIKTOK_VERIFICATION_TOKEN_ENV_NAME = 'TIKTOK_VERIFICATION_TOKEN';

/** الرمز الفعّال المحسوب من البيئة عند كل استخدام (لا يُلتقط وقت الإقلاع). */
export function effectiveTikTokVerificationToken(): string {
  const override = String(process.env[TIKTOK_VERIFICATION_TOKEN_ENV_NAME] || '').trim();
  return TOKEN_PATTERN.test(override) ? override : DEFAULT_TIKTOK_VERIFICATION_TOKEN;
}

/** الرمز المدموج مرجعياً (الاختبارات/الأدوات التي تحتاجه في السياق الافتراضي). */
export const TIKTOK_VERIFICATION_TOKEN = DEFAULT_TIKTOK_VERIFICATION_TOKEN;

/** اسم الملف الرسمي الافتراضي = `tiktok<token>.txt`. */
export const TIKTOK_VERIFICATION_FILENAME = `tiktok${TIKTOK_VERIFICATION_TOKEN}.txt`;

/** محتوى الملف الرسمي الافتراضي = سلسلة التوقيع كاملة. */
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
 * كل ملفات التحقق التي يخدمها الخادم، محسوبة من الرمز الفعّال للبيئة:
 *   - الملف الرسمي `tiktok<token>.txt` (ما يطلبه TikTok عادةً)،
 *   - الاسم البديل الشائع `tiktok-developers-site-verification.txt` بالمحتوى نفسه،
 *     فلا يفشل التحقق إن جُرّب هذا الاسم.
 */
export function siteVerificationFiles(): SiteVerificationFile[] {
  const official = buildTikTokVerificationFile(effectiveTikTokVerificationToken());
  return [
    official,
    { filename: 'tiktok-developers-site-verification.txt', content: official.content, contentType: VERIFICATION_CONTENT_TYPE },
  ];
}

/** اسم الملف الرسمي الفعّال الآن (حسب البيئة) = `tiktok<token>.txt`. */
export function effectiveVerificationFilename(): string {
  return siteVerificationFiles()[0].filename;
}

/**
 * يطابق مسار طلب (pathname بلا استعلام) بملف تحقق معروف، أو null.
 * المطابقة حرفية على الجذر فقط، فلا يُخدَم الملف من مسار فرعي.
 */
export function verificationFileForPath(pathname: string): SiteVerificationFile | null {
  const name = rootLevelFileName(pathname);
  if (!name) return null;
  return siteVerificationFiles().find((file) => file.filename === name) || null;
}

/**
 * هل هذا المسار (في الجذر أو مسار فرعي) يشبه ملف تحقق TikTok؟ يُستخدم لتمييز
 * «طلب TikTok وصل لكن الرمز/المسار مختلف» عن مسار لا علاقة له — فلا يُخدَم توقيع
 * خطأ صامت ولا واجهة React بدل التوقيع.
 */
export function isVerificationFileRequest(pathname: string): boolean {
  const raw = String(pathname || '').trim().replace(/\/+$/, '');
  if (!raw.startsWith('/')) return false;
  const base = raw.slice(raw.lastIndexOf('/') + 1);
  return SITE_VERIFICATION_PATH_PATTERN.test(`/${base}`);
}

/** اسم ملف في الجذر فقط (بلا مسار فرعي)، أو null. */
function rootLevelFileName(pathname: string): string | null {
  const raw = String(pathname || '').trim();
  if (!raw.startsWith('/') || raw.slice(1).includes('/')) return null;
  const name = raw.slice(1);
  return SITE_VERIFICATION_PATH_PATTERN.test(raw) ? name : null;
}

/** يخدم الملف الرسمي الفعّال بغضّ النظر عن الرمز في الطلب (الاسم متغيّر). */
export function effectiveVerificationFile(): SiteVerificationFile {
  return siteVerificationFiles()[0];
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

/**
 * لقطة طلب ملف تحقق وصل فعلاً. كل الحقول عامة بطبيعتها (اسم الملف ورمزه يطلبه
 * TikTok علناً من الإنترنت)، وخالية تماماً من أي سرّ أو ترويسة اعتماد. تُستخدم
 * لتشخيص «لماذا يرفض TikTok التوقيع» بمقارنة ما يطلبه فعلاً بما نخدمه.
 */
export interface VerificationRequestSnapshot {
  /** اسم الملف كما طُلب (آخر مقطع مسار بلا شرطة بادئة). */
  filename: string;
  /** الرمز المستخرج من اسم الملف (فارغ إن لم يطابق الصيغة). */
  token: string;
  /** وكيل المستخدم كما أرسله الطالب (مقطوع عند 300 محرف للسلامة). */
  userAgent: string;
  /** لحظة الوصول (ISO). */
  at: string;
  /** نوع الطلب: GET/HEAD كما وصل (بلا سرّ). */
  method: string;
  /** المسار الكامل كما وصل (بلا استعلام إن وُجد) للتوثيق. */
  path: string;
  /** هل كان في جذر الموقع (لا مسار فرعي)؟ */
  rootLevel: boolean;
  /** هل حمل الطلب سلسلة استعلام؟ (Express يخدمه، لكن Nashville/TikTok يطلبه نظيفاً). */
  hasQuery: boolean;
  /** هل طابق اسمُ الطلب اسمَ الملف الفعّال حرفياً؟ */
  matchedExpected: boolean;
  /** هل يستطيع الخادم خدمة هذا الطلب فعلاً (200)؟ */
  served: boolean;
  /** اسم الملف الفعّال الذي يخدمه الخادم الآن (المرجع للمقارنة). */
  expectedFilename: string;
  /** سبب صريح لعدم التطابق (فارغ عند الخدمة الناجحة)، للتشخيص المباشر. */
  mismatchReason: string;
}

/** يزيل أي استعلام وشرطة مائلة زائدة ويستخرج آخر مقطع مسار. */
function requestBaseName(pathname: string): string {
  const noQuery = String(pathname || '').split('?')[0].split('#')[0];
  const trimmed = noQuery.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return (idx >= 0 ? trimmed.slice(idx + 1) : trimmed).trim();
}

/**
 * يلتقط طلب ملف تحقق وصل ويصنّفه مقابل الملف الفعّال — منطق خالص قابل للاختبار:
 * لا شبكة ولا سرّ، وكل الحقول عامة. الغرض كشف الانحراف بدقة (اسم مختلف؟ مسار
 * فرعي؟ استعلام؟) بدل الاكتفاء بـ«فشل التحقق» بلا دليل.
 */
export function captureVerificationRequest(input: {
  pathname: string;
  originalUrl?: string;
  userAgent?: string;
  method?: string;
  at: string;
}): VerificationRequestSnapshot {
  const pathname = String(input.pathname || '');
  const originalUrl = String(input.originalUrl ?? pathname);
  const expected = effectiveVerificationFile();
  const filename = requestBaseName(pathname);
  const token = parseTikTokVerificationToken(filename) || '';
  const noQuery = originalUrl.split('#')[0];
  const hasQuery = noQuery.includes('?');
  // req.path بلا استعلام، فملف الجذر يُخدَم حتى مع استعلام — لكن المسار الفرعي لا.
  const rootLevel = pathname === `/${filename}`;
  const matchedExpected = filename === expected.filename;
  const served = !!verificationFileForPath(pathname);

  let mismatchReason = '';
  if (!served) {
    if (!token) mismatchReason = 'filename_not_in_tiktok_token_format';
    else if (!rootLevel) mismatchReason = 'not_at_root_path';
    else mismatchReason = 'token_differs_from_served';
  }

  return {
    filename,
    token,
    userAgent: String(input.userAgent || '').slice(0, 300),
    at: input.at,
    method: String(input.method || 'GET').toUpperCase().slice(0, 10),
    path: noQuery.slice(0, 300),
    rootLevel,
    hasQuery,
    matchedExpected,
    served,
    expectedFilename: expected.filename,
    mismatchReason,
  };
}
