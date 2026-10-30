/**
 * شاشة من نسخة سابقة بعد النشر (2026-10-29).
 *
 * أسماء ملفات الشاشات تحمل بصمة محتواها، فكل نشر يغيّرها. المتصفح المفتوح على النسخة القديمة يطلب
 * ملفاً لم يعد موجوداً فتنهار الشاشة («تعذّر عرض هذه الشاشة») ويُسجَّل عطل حرج زائف. العلاج الصحيح:
 * إعادة تحميل الصفحة مرة واحدة لتأخذ النسخة الجديدة — بحارس زمني كي لا تدخل حلقة إعادة تحميل إن كان
 * الملف مفقوداً فعلاً في النسخة الجديدة (حينها يُبلَّغ المهندس كالعادة).
 */
const STALE_CHUNK_RE = /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk [\w-]+ failed|Unable to preload CSS|module script.*MIME type/i;
const RELOAD_KEY = 'gharabi_stale_chunk_reload_at';
const RELOAD_GUARD_MS = 60_000;

export function isStaleChunkError(err: unknown): boolean {
  const e: any = err;
  return STALE_CHUNK_RE.test(`${e?.name || ''} ${e?.message || e || ''}`);
}

/** إعادة التحميل بدأت في هذه الصفحة: أي فشل لاحق قبل مغادرتها جزء من الحالة نفسها لا عطل جديد. */
let reloadStarted = false;

/** يعيد تحميل الصفحة مرة واحدة لكل دقيقة. يُرجع true إن بدأ إعادة التحميل (أو كانت بدأت في هذه الصفحة). */
export function reloadForNewVersion(): boolean {
  if (reloadStarted) return true;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // بلا تخزين جلسة لا يمكن ضمان عدم التكرار: لا إعادة تحميل تلقائية (الزر اليدوي باقٍ).
    return false;
  }
  reloadStarted = true;
  location.reload();
  return true;
}

/**
 * معالج `vite:preloadError` (fp=bfeef086772f، 2026-10-30).
 * لا يستدعي preventDefault أبداً: Vite عند منع الحدث يبتلع فشل الاستيراد ويُرجع undefined بدل الوحدة،
 * فيستلم React.lazy قيمة فارغة وتنهار الشاشة بـ«e._result is undefined» قبل أن تكتمل إعادة التحميل —
 * عطل حرج زائف يخفي السبب الحقيقي. نترك الفشل يصل لحاجز الانهيار (يعرض «نُشرت نسخة جديدة»
 * ولا يُبلّغ لأن إعادة التحميل بدأت)، وإن منع حارس الدقيقة إعادة التحميل يُبلَّغ كملف مفقود فعلاً.
 */
export function handleVitePreloadError(_e: Event): void {
  reloadForNewVersion();
}
