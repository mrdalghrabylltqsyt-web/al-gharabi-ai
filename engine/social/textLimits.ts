/**
 * حدود نص المنصات — **مصدر واحد** لحساب الطول الحقيقي والاختصار الآمن.
 *
 * الجذر المُثبت: Threads API يحدّ نص المنشور بـ500 **حسب UTF-8 bytes**، ووثيقة
 * Meta تنصّ صراحةً: «Emojis are counted as the number of UTF-8 bytes». لذلك عدّ
 * `text.length` (وحدات UTF-16) مضلل: الإيموجي الواحد = 4 بايت، والعائلة = أكثر،
 * فيمرّ النص «كأنه أقصر» ثم يرفضه المزود بـ«Param text must be at most 500
 * characters long». هنا نعدّ البايتات ونقصّ عند حدود مجدية (أسطر ثم كلمات) بلا
 * كسر كلمة، وبلا ملامسة النص الأصلي المحفوظ — الاختصار يُعرض فقط.
 */

/** المنصات التي يعدّ مزوّدها الإيموجي/النص بـUTF-8 bytes (وثيقة Meta: Threads). */
export const UTF8_BYTE_COUNTED_PLATFORMS: readonly string[] = ['threads'];

/** كيف يعدّ المزوّد الطول. */
export type TextCountMethod = 'utf8_bytes' | 'code_points';

/** حدود النص لكل منصة (المصدر الواحد — يُستهلك في التكييف والتحقق معاً). */
export const PLATFORM_TEXT_LIMITS: Record<string, number> = {
  tiktok: 2200, instagram: 2200, facebook: 5000, youtube: 5000, x: 280,
  snapchat: 250, whatsapp: 4096, telegram: 4096, threads: 500, google_business: 1500,
};

/** حدّ المنصة، أو null إن لم تُعرّف (بلا اختراع حد). */
export function platformTextLimit(platform: string): number | null {
  const n = PLATFORM_TEXT_LIMITS[platform];
  return Number.isFinite(n) ? n : null;
}

export function platformCountsUtf8Bytes(platform: string): boolean {
  return UTF8_BYTE_COUNTED_PLATFORMS.includes(platform);
}

export interface TextMeasurement {
  /** وحدات UTF-16 (text.length) — للتوافق فقط، ليست الحكم. */
  chars: number;
  /** عدد نقاط KI الموحّدة (يعدّ الإيموجي المركّب مرة واحدة تقريباً). */
  codePoints: number;
  /** عدد بايتات UTF-8 (Buffer.byteLength) — المقياس الحاسم لمنصات البايت. */
  utf8Bytes: number;
}

export function measureText(text: string): TextMeasurement {
  const t = typeof text === 'string' ? text : '';
  return { chars: t.length, codePoints: [...t].length, utf8Bytes: Buffer.byteLength(t, 'utf8') };
}

/** الطول المُحتسَب حسب طريقة المنصة. */
export function countForPlatform(platform: string, text: string): { used: number; method: TextCountMethod } {
  const m = measureText(text);
  return platformCountsUtf8Bytes(platform)
    ? { used: m.utf8Bytes, method: 'utf8_bytes' }
    : { used: m.codePoints, method: 'code_points' };
}

export interface TextLimitVerdict {
  ok: boolean;
  limit: number | null;
  used: number;
  method: TextCountMethod;
  /** رسالة السبب عند التجاوز (فارغة عند النجاح). */
  reason: string;
  code: 'OK' | 'TEXT_TOO_LONG' | 'TEXT_EMPTY' | 'NO_LIMIT';
}

/** يتحقق من النص مقابل حدّ المنصة بالطريقة الصحيحة. لا يعدّل النص أبداً. */
export function validatePlatformText(platform: string, text: string): TextLimitVerdict {
  const limit = platformTextLimit(platform);
  const { used, method } = countForPlatform(platform, text);
  if (text == null || String(text).trim() === '') {
    return { ok: false, limit, used, method, reason: 'النص فارغ.', code: 'TEXT_EMPTY' };
  }
  if (limit === null) {
    return { ok: true, limit: null, used, method, reason: '', code: 'NO_LIMIT' };
  }
  if (used > limit) {
    const unit = method === 'utf8_bytes' ? 'بايت UTF-8' : 'محرف';
    return { ok: false, limit, used, method, reason: `النص يتجاوز حد المنصة (${used}/${limit} ${unit}).`, code: 'TEXT_TOO_LONG' };
  }
  return { ok: true, limit, used, method, reason: '', code: 'OK' };
}

export function exceedsPlatformTextLimit(platform: string, text: string): boolean {
  return validatePlatformText(platform, text).ok === false;
}

/** يقصّ سطراً واحداً عند حدود كلمة (بلا كسر كلمة) بأمان حسب طريقة العدّ. */
function fitSegment(platform: string, segment: string, limit: number): string {
  if (countForPlatform(platform, segment).used <= limit) return segment;
  // تقصير تدريجي عند حدود المسافات حتى يدخل ضمن الحد.
  const words = segment.split(/\s+/);
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    // نضمن بقاء موضع للعلامة «…» (بايتان لكل حرف؛ «…» = 3 بايتات UTF-8).
    const reserve = platformCountsUtf8Bytes(platform) ? 3 : 1;
    if (countForPlatform(platform, next).used + reserve > limit) break;
    out = next;
  }
  if (!out) {
    // كلمة واحدة أطول من الحد: نقصّ بالنقاط (code points) حتى ندخل متوسط الحجم.
    const cps = [...segment];
    let acc = '';
    const reserve = platformCountsUtf8Bytes(platform) ? 3 : 1;
    for (const ch of cps) {
      if (countForPlatform(platform, acc + ch).used + reserve > limit) break;
      acc += ch;
    }
    out = acc;
  }
  return `${out.trimEnd()}…`;
}

export interface ShortenResult {
  text: string;
  changed: boolean;
  used: number;
  limit: number | null;
  method: TextCountMethod;
  /** عدد الأسطر المُسقطة (معلن بصراحة، بلا حذف صامت للنص الأصلي). */
  omittedSegments: number;
}

/**
 * يفصّل النص ليدخل ضمن الحد بطريقة آمنة:
 *  1) يحتفظ بأكبر عدد من الأسطر المتتالية من البداية (الرسالة الأساسية أولاً).
 *  2) إن تجاوز السطر الأول وحده الحدّ، يقصّه عند حدود كلمة + «…».
 * لا يعيد كتابة أي معلومة ولا يخترع نصاً — قد يحذف أسطراً زائدة فقط (معلَنة).
 */
export function shortenToPlatformLimit(platform: string, text: string, limitOverride?: number): ShortenResult {
  const limit = Number.isFinite(limitOverride as number) ? (limitOverride as number) : platformTextLimit(platform);
  const { method } = countForPlatform(platform, text);
  if (limit === null) {
    return { text, changed: false, used: countForPlatform(platform, text).used, limit: null, method, omittedSegments: 0 };
  }
  if (countForPlatform(platform, text).used <= limit) {
    return { text, changed: false, used: countForPlatform(platform, text).used, limit, method, omittedSegments: 0 };
  }
  const segments = text.split(/\n{2,}|\n/).map((s) => s.trim()).filter(Boolean);
  if (!segments.length) {
    return { text: fitSegment(platform, text, limit), changed: true, used: countForPlatform(platform, fitSegment(platform, text, limit)).used, limit, method, omittedSegments: 0 };
  }
  const kept: string[] = [];
  for (const seg of segments) {
    const candidate = [...kept, seg].join('\n');
    if (countForPlatform(platform, candidate).used <= limit) {
      kept.push(seg);
    } else if (kept.length === 0) {
      // السطر الأول وحده أطول من الحد: نُدخله مقصوصاً عند حدود كلمة.
      kept.push(fitSegment(platform, seg, limit));
      break;
    } else {
      break;
    }
  }
  const out = kept.join('\n');
  const omitted = segments.length - kept.length;
  return { text: out, changed: out !== text, used: countForPlatform(platform, out).used, limit, method, omittedSegments: Math.max(0, omitted) };
}
