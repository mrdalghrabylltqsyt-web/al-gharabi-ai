/**
 * سياسة الجدولة الزمنية لمشروع الغرابي AI — مصدر واحد للتوقيت.
 *
 * المستخدم في العراق يختار التوقيت المحلي Asia/Baghdad. المعنى المحلي هو الثابت:
 * · قيمة `datetime-local` تُرسل كما هي إلى الخادم بلا تحويل، فلا تُغيَّر الساعة المختارة.
 * · التخزين يحتفظ بالجدار الزمني المحلي نصاً (`YYYY-MM-DDTHH:mm`)، لذا تُعاد القراءة
 *   والعرض بنفس الساعة دائماً.
 * · عند الحاجة لمقارنة لحظية (هل الموعد في الماضي؟) نحوّل الجدار المحلي إلى لحظة UTC
 *   تحويلاً صحيحاً قابلاً للعكس باستخدام إزاحة Asia/Baghdad، لا بمقارنة نصية.
 *
 * التوقيت هنا رقمي صرف، لذا يعمل على الخادم والمتصفح معاً. الخادم (Node) يملك بيانات
 * منطقة IANA، والمتصفح أيضاً؛ لا نستخدم Date.parse على نص بدون منطقة لأنه يفسّره
 * بتوقيت المضيف (UTC على Render/Netlify) فينتج فرق 3 ساعات.
 */

/** المنطقة الزمنية المعتمدة لجدولة المنشورات. */
export const APP_TIMEZONE = 'Asia/Baghdad';

export interface WallClock {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  minute: number; // 0..59
  second: number; // 0..59
}

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** يقرأ جداراً زمنياً محلياً من `YYYY-MM-DDTHH:mm` أو `YYYY-MM-DD HH:mm[:ss]`. */
export function parseWallClock(value: unknown): WallClock | null {
  if (typeof value !== 'string') return null;
  const m = WALL_RE.exec(value.trim());
  if (!m) return null;
  const clock: WallClock = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] ? Number(m[6]) : 0,
  };
  // نرفض التواريخ غير الحقيقية (مثل 2026-02-31) بدل تدويرها صامتاً.
  const probe = new Date(Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second));
  if (
    probe.getUTCFullYear() !== clock.year ||
    probe.getUTCMonth() !== clock.month - 1 ||
    probe.getUTCDate() !== clock.day ||
    probe.getUTCHours() !== clock.hour ||
    probe.getUTCMinutes() !== clock.minute
  ) {
    return null;
  }
  return clock;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** يحوّل جداراً زمنياً إلى نص الجدولة المخزَّن `YYYY-MM-DDTHH:mm`. */
export function formatWallClock(clock: WallClock): string {
  return `${pad(clock.year, 4)}-${pad(clock.month)}-${pad(clock.day)}T${pad(clock.hour)}:${pad(clock.minute)}`;
}

function timeZoneOffsetMs(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - utcMs;
}

/**
 * يحوّل جداراً محلياً في المنطقة المعطاة إلى لحظة UTC حقيقية (epoch ms).
 * نضبط الإزاحة على مرحلتين لتفادي حدود تغيير التوقيت الصيفي.
 */
export function zonedWallClockToEpoch(clock: WallClock, timeZone = APP_TIMEZONE): number {
  const asUtcGuess = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  let epoch = asUtcGuess - timeZoneOffsetMs(timeZone, asUtcGuess);
  epoch = asUtcGuess - timeZoneOffsetMs(timeZone, epoch);
  return epoch;
}

/** يحوّل جداراً محلياً نصياً إلى لحظة UTC، أو `NaN` إن كان النص غير صالح. */
export function wallClockToEpoch(value: unknown, timeZone = APP_TIMEZONE): number {
  const clock = parseWallClock(value);
  return clock ? zonedWallClockToEpoch(clock, timeZone) : NaN;
}

/** هل تمثل القيمة جداراً زمنياً محلياً صالحاً (وليس لحظة ISO تحمل منطقة)؟ */
export function isValidScheduleInput(value: unknown): boolean {
  return parseWallClock(value) !== null;
}

/** يوحّد موعد الجدولة إلى الصيغة المخزَّنة المعيارية `YYYY-MM-DDTHH:mm` أو null. */
export function normalizeScheduleInput(value: unknown): string | null {
  const clock = parseWallClock(value);
  return clock ? formatWallClock(clock) : null;
}

/**
 * هل الموعد المحلي المستقبلي بالنسبة للحظة الآن؟ نحوّل الجدار المحلي إلى لحظة UTC
 * حقيقية ثم نقارن، فلا ينتج فرق ساعات من تفسير النص بتوقيت المضيف.
 */
export function isScheduleInFuture(value: unknown, nowMs = Date.now(), timeZone = APP_TIMEZONE): boolean {
  const epoch = wallClockToEpoch(value, timeZone);
  return Number.isFinite(epoch) && epoch > nowMs;
}

/** يحوّل لحظة UTC إلى الجدار الزمني الذي يراه المستخدم في المنطقة المعطاة. */
export function epochToZonedWallClock(epochMs: number, timeZone = APP_TIMEZONE): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(epochMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** يحوّل لحظة/نص ISO إلى جدار محلي بصيغة الجدولة (يحتفظ بالتوقيت المعروض). */
export function toScheduleDisplay(value: unknown, timeZone = APP_TIMEZONE): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const clock = parseWallClock(value);
  if (clock) return formatWallClock(clock);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) return null;
  return formatWallClock(epochToZonedWallClock(epoch, timeZone));
}

/** يعيد القيمة كما اختارها المستخدم للعرض في واجهة `datetime-local`. */
export function wallClockInputValue(value: unknown, timeZone = APP_TIMEZONE): string {
  return toScheduleDisplay(value, timeZone) ?? '';
}

/** يحوّل جداراً محلياً إلى ISO يحمل إزاحة المنطقة (قابل للعكس، لا يغيّر الساعة). */
export function wallClockToIsoWithOffset(value: unknown, timeZone = APP_TIMEZONE): string | null {
  const clock = parseWallClock(value);
  if (!clock) return null;
  const epoch = zonedWallClockToEpoch(clock, timeZone);
  const offsetMinutes = Math.round(timeZoneOffsetMs(timeZone, epoch) / 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return `${formatWallClock(clock)}:${pad(clock.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** قيمة افتراضية للجدولة: بعد ساعتين من الآن بتوقيت العراق، على رأس الساعة. */
export function defaultScheduleInput(nowMs = Date.now(), timeZone = APP_TIMEZONE): string {
  const target = epochToZonedWallClock(nowMs + 2 * 3600_000, timeZone);
  return formatWallClock({ ...target, minute: 0, second: 0 });
}
