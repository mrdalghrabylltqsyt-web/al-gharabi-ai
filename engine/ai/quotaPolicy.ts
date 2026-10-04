/**
 * سياسة حدّ حماية حصة Gemini المحلي — مصدر واحد قابل للضبط بالبيئة.
 *
 * الفصل الصريح: هذا **حدّ حماية محلي للمشروع** (يحمي من الحلقات/إعادة المحاولة
 * والاستهلاك غير المتوقّع)، وليس حصة Google المعلنة. حصة المزود الفعلية تعتمد على
 * الحساب والموديل، وتُقرأ من Google AI Studio — لا تُخترع هنا.
 *
 * سبب الوجود: الحد السابق (4/يوم) كان متحفظاً أكثر من اللازم بعد ثبوت أن الحدود
 * المجانية المنشورة تاريخياً لنماذج Flash كانت بمئات الطلبات يومياً. نرفع السقف
 * **متحفظاً** مع إبقاء هامش أمان كبير، لا إلى الرقم الأقصى للحصة.
 *
 * القاعدة: الحارس يبقى فعّالاً دائماً — نرفع السقف، لا نلغي الحارس. أي قيمة من
 * البيئة تتجاوز الحدّ الآمن الأعلى **تُقصّ** (clamp) ولا تُقبل، فلا يمكن تعطيل
 * الحماية بقيمة بيئة كبيرة.
 */

export const GEMINI_DAILY_LIMIT_ENV = 'GEMINI_DAILY_LIMIT';

/**
 * الافتراضي المحافظ الجديد: 40 طلباً/يوم (بدل 4).
 *
 * المبرَّر (هامش أمان كبير مقابل الحصة المنشورة تاريخياً لنماذج Flash ~1500 RPD):
 *  - تذبذب الحصة: Google عدّلت حدود الطبقة المجانية أكثر من مرة (شهادات تخفيض
 *    في 2025/2026)، فالاعتماد على 1500 خطر.
 *  - مشاركة المفتاح: نفس المشروع/المفتاح قد يخدم خدمات أخرى، فتتقلّص الحصة المتاحة.
 *  - نمو مستقبلي: يتّسع العقل والمراقب (24/7) فيزيد الطلب تدريجياً.
 *  - 40 ≈ 2.7% من 1500 فقط ⇒ هامش ~97%. وحتى لو انخفضت الحصة المنشورة إلى 250 RPD
 *    يبقى 40 ≈ 16% منها (هامش ~84%). الرقم نفسه (40) كان أيضاً القيمة التاريخية
 *    المنشورة لـ2.5 Flash في فترات سابقة، فهو معروف ومتحفظ.
 */
export const GEMINI_LIMIT_DEFAULT = 40;

/**
 * الحدّ الآمن الأعلى الذي يفرضه الحارس مهما كانت قيمة البيئة: 120 طلباً/يوم.
 * حتى عند 120 يبقى هامش ≥92% مقابل 1500 RPD، وحوافز التخزين المؤقت/الانضمام أثناء
 * التنفيذ تقلّل النداءات الحقيقية أصلاً. أي قيمة أعلى تُقصّ إلى 120 (لا تجاوز).
 */
export const GEMINI_LIMIT_MAX_SAFE = 120;

/** الحدّ الأدنى المعقول (لا حدّ صفري/سالب). */
export const GEMINI_LIMIT_MIN = 1;

export interface GeminiLimitInspection {
  /** القيمة الفعلية المطبَّقة بعد التحقق/القصّ. */
  limit: number;
  /** القيمة الخام كما وردت في البيئة (بلا كشف أي سرّ — رقم فقط). */
  configuredRaw: string | null;
  /** default | configured | clamped | invalid */
  state: 'default' | 'configured' | 'clamped' | 'invalid';
  defaultLimit: number;
  maxSafe: number;
  envName: string;
}

/**
 * يحسم الحد اليومي من البيئة:
 *  - غائب/غير رقمي/≤0 ⇒ الافتراضي (40).
 *  - رقم صالح ⇒ مقصوص بين [1, 120].
 */
export function resolveGeminiDailyLimit(env: Record<string, string | undefined> = {}): number {
  const raw = env[GEMINI_DAILY_LIMIT_ENV];
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return GEMINI_LIMIT_DEFAULT;
  return Math.min(GEMINI_LIMIT_MAX_SAFE, Math.max(GEMINI_LIMIT_MIN, Math.floor(n)));
}

/** حالة القرار (للتشخيص/الواجهة) بلا أي سرّ. */
export function inspectGeminiLimit(env: Record<string, string | undefined> = {}): GeminiLimitInspection {
  const raw = env[GEMINI_DAILY_LIMIT_ENV];
  const present = raw != null && String(raw).trim() !== '';
  const n = Number(raw);
  const limit = resolveGeminiDailyLimit(env);
  let state: GeminiLimitInspection['state'];
  if (!present) state = 'default';
  else if (!Number.isFinite(n) || n <= 0) state = 'invalid';
  else if (n > GEMINI_LIMIT_MAX_SAFE) state = 'clamped';
  else state = 'configured';
  return {
    limit,
    configuredRaw: present ? String(raw) : null,
    state,
    defaultLimit: GEMINI_LIMIT_DEFAULT,
    maxSafe: GEMINI_LIMIT_MAX_SAFE,
    envName: GEMINI_DAILY_LIMIT_ENV,
  };
}
