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

/** يعيد تحميل الصفحة مرة واحدة لكل دقيقة. يُرجع true إن بدأ إعادة التحميل. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // بلا تخزين جلسة لا يمكن ضمان عدم التكرار: لا إعادة تحميل تلقائية (الزر اليدوي باقٍ).
    return false;
  }
  location.reload();
  return true;
}
