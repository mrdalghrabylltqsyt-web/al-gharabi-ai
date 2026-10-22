/**
 * Health Privacy Guard — مصدر واحد لحماية النقطتين العامتين /api/health و/api/readiness.
 *
 * هاتان النقطتان **عامتان بلا مصادقة** (كما يجب، لأدوات المراقبة مثل Render)، فلا
 * يجوز أن تحملا أي بيانات عميل: اسم حساب، نص تعليق، نص رد، أو أي حقل يحمل محتوى
 * محادثة. الحقول التقنية غير الحساسة فقط مسموحة (status/commit/watcherActive/
 * pollCount/lastError كرسالة عامة).
 *
 * هذا الملف هو **المصدر الواحد** لقائمة الحقول الممنوعة ولقائمة المفاتيح المسموحة
 * في الكتلة العامة youtubeWatcher، ويستهلكه: (1) الخادم كطبقة دفاع أخيرة تُنقّي أي
 * لقطة قبل الإرسال، (2) اختبار الانحدار، (3) فحص final-audit — فلا تنحرف النسخ.
 *
 * منطق خالص قابل للاختبار: لا شبكة ولا أسرار ولا ساعة.
 */

/**
 * أسماء حقول تحمل بيانات عميل صراحةً — **ممنوعة في أي مكان** بالنقطتين العامتين.
 * قائمة صريحة (لا أنماط واسعة) لتفادي الإنذارات الكاذبة على مفاتيح تقنية مثل
 * commentsCapability/nextAction. أي حقل جديد بهذا المعنى يُضاف هنا عن قصد.
 */
export const PUBLIC_ENDPOINT_FORBIDDEN_CUSTOMER_FIELDS: readonly string[] = Object.freeze([
  'authorName',
  'commentText',
  'commentAuthor',
  'replyText',
  'lastReply',
  'attentionRequired',
  'customerName',
  'customerPhone',
  'customerEmail',
  'contactPhone',
  'contactEmail',
  'objective',
  'lastGoal',
  'lastObjective',
  'lastNextAction',
  'customerMessage',
  'lastCustomerMessage',
  'unresolvedQuestion',
  // أسماء عامة/مختصرة تحمل نفس المعنى (اسم حساب أو نص تعليق/رسالة) — دفاع متين
  // ضد حقل جديد يُضاف باسم مختصر فيتسرّب بلا أن يلتقطه الحقل الصريح. لا تتقاطع مع
  // أي مفتاح تقني مشروع في النقطتين العامتين (مُتحقَّق منه في الاختبار).
  'text',
  'comment',
  'commentBody',
  'commentMessage',
  'author',
  'authorId',
  'authorHandle',
  'username',
  'senderName',
  'messageText',
  'messageBody',
  'postText',
  'postMessage',
]);

/**
 * الحقول التقنية الدنيا المسموح بها فقط في الكتلة العامة youtubeWatcher (allow-list
 * صارم). أي حقل جديد (قد يحمل بيانات عميل أو تفاصيل تشغيلية زائدة) يُفشل الاختبار
 * حتى يُراجَع عن قصد.
 */
export const PUBLIC_WATCHER_ALLOWED_KEYS: readonly string[] = Object.freeze([
  'status',
  'watcherActive',
  'cadenceMinutes',
  'cadenceMs',
  'lastError',
  'consecutiveErrors',
  'note',
  'pollCount',
  'lastPollAt',
  // مؤشّرات تقنية لإغلاق «الفشل الصامت» (أرقام/أوقات/منصّة/رسالة تقنية عامة — بلا
  // أي بيانات عميل). تُضاف عن قصد لتمرّ من allow-list الصارم في النقطتين العامتين.
  'platformStats',
  'staleIngestWarning',
  'warnings',
  // تتبّع التأجيل + تحذير «الدورة الفائتة» (إصلاح 2026-10-20): حقول تقنية صريحة
  // (منطقي/سبب تقني/وقت) — بلا أي بيانات عميل، فلا يبدو النظام «سليماً» وهو مؤجَّل.
  'deferred',
  'deferredReason',
  'lastDeferredAt',
  'stale',
  'staleReason',
  'missedCycles',
  // PR-A: الإرسال محجوب (Kill Switch) بينما القراءة مستمرة — حقل تقني منطقي فقط.
  'sendingPaused',
]);

/** الحقول التشغيلية التفصيلية التي يجب ألا تظهر في النقطتين العامتين (نُقلت للمالك). */
export const PUBLIC_ENDPOINT_FORBIDDEN_OPERATIONAL_FIELDS: readonly string[] = Object.freeze([
  'counters',
  'usedUnits',
  'remainingUnits',
  'byOperation',
  'mediaTotalBytes',
  'mediaStored',
  'byState',
]);

const FORBIDDEN_SET = new Set(PUBLIC_ENDPOINT_FORBIDDEN_CUSTOMER_FIELDS);

/**
 * الحد الأقصى لطول رمز الخطأ المُعلن في النقطتين العامتين. أطول من ذلك ليس رمزاً
 * تقنياً بل نص حر (قد يحمل تفاصيل مزوّد/محادثة) فيُستبدل برسالة عامة.
 */
export const PUBLIC_ERROR_TOKEN_MAX = 40;

/**
 * يُنقّي قيمة خطأ داخلية إلى **رمز تقني عام** صالح للنقطتين العامتين (/api/health
 * و/api/readiness). القاعدة الملزمة: لا يمرّ أي نص قد يحمل محتوى عميل. لذلك نقبل
 * فقط **رمز ASCII واحداً بلا مسافات** (مثل `VIDEO_LIST_FAILED` أو `timeout`)؛ أي
 * قيمة نصية أخرى — رسالة إنجليزية بمسافات، أو نص عربي، أو حمولة طويلة — تُستبدل
 * بـ`connection error`. قيمة غير نصية أو فارغة تعني «لا خطأ» => null.
 */
export function sanitizePublicErrorMessage(err: unknown): string | null {
  if (typeof err !== 'string') return null;
  const token = err.trim();
  if (!token) return null;
  return /^[A-Za-z0-9._-]{1,40}$/.test(token) ? token : 'connection error';
}

/** يجمع كل أسماء المفاتيح في أي شكل متداخل (كائنات/مصفوفات). */
export function collectPublicPayloadKeys(value: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) collectPublicPayloadKeys(v, acc);
    return acc;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.add(k);
      collectPublicPayloadKeys(v, acc);
    }
  }
  return acc;
}

/** يعيد أسماء الحقول الممنوعة الموجودة فعلاً في اللقطة (للتشخيص/الاختبار). */
export function findForbiddenPublicKeys(payload: unknown): string[] {
  const keys = collectPublicPayloadKeys(payload);
  return PUBLIC_ENDPOINT_FORBIDDEN_CUSTOMER_FIELDS.filter((f) => keys.has(f));
}

/** يعيد مفاتيح الكتلة العامة youtubeWatcher الخارجة عن allow-list. */
export function findDisallowedWatcherPublicKeys(block: unknown): string[] {
  if (!block || typeof block !== 'object') return [];
  const allowed = new Set(PUBLIC_WATCHER_ALLOWED_KEYS);
  return Object.keys(block as Record<string, unknown>).filter((k) => !allowed.has(k));
}

/**
 * طبقة دفاع أخيرة: تُنقّي أي لقطة عامة بإزالة كل حقل ممنوع (في أي عمق)، فلا
 * يمكن أن تتسرّب بيانات عميل حتى لو أضاف مطوّر لاحقاً حقلًا حسّاساً إلى كتلة
 * عامة دون قصد. **لا تُغيّر الحقول التقنية المسموحة.**
 */
export function sanitizePublicHealthPayload<T>(payload: T): T {
  const strip = (value: any): any => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (FORBIDDEN_SET.has(k)) continue;
        out[k] = strip(v);
      }
      return out;
    }
    return value;
  };
  return strip(payload);
}
