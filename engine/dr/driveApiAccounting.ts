/**
 * محاسبة وحدات Google Drive API — منطق خالص صغير (بلا شبكة/أسرار/AI).
 *
 * الغرض: عدّ نداءات Drive API الحقيقية من كودنا وتحويلها إلى وحدات حصّة موثّقة
 * (list=100، get=5، download=200، edit=50) لعرض تقدّمنا مقابل الحدّ اليومي
 * الموثّق في /api/health. عدّاد داخلي **لنداءاتنا وحدها** (لا يمثّل كل استهلاك
 * المشروع) — يُعلَن بصراحة. مؤشّر عرض فقط، بلا أي حجب.
 */

/** تكلفة الوحدة لكل نوع نداء (وثيقة Google Drive الرسمية). */
export const DRIVE_API_UNIT_COSTS = {
  read: 5,     // files.get
  list: 100,   // files.list
  download: 200, // files.download / get with alt=media
  edit: 50,    // files.update/create/upload
  other: 5,    // files.generateIds … إلخ
} as const;

export type DriveApiCallKind = keyof typeof DRIVE_API_UNIT_COSTS;

export interface DriveApiAccounting {
  /** مفتاح اليوم (YYYY-MM-DD). */
  day: string | null;
  callsToday: number;
  unitsToday: number;
  unitsSinceStart: number;
  lastCallAt: string | null;
}

const accounting: DriveApiAccounting = {
  day: null,
  callsToday: 0,
  unitsToday: 0,
  unitsSinceStart: 0,
  lastCallAt: null,
};

export function driveApiQuotaUnitsFor(kind: DriveApiCallKind): number {
  return DRIVE_API_UNIT_COSTS[kind] ?? DRIVE_API_UNIT_COSTS.other;
}

/** يصفّر العدّاد اليومي عند تغيّر اليوم (لا يعدّل anything آخر). */
export function rollDriveApiDay(nowIso: string): void {
  const dk = String(nowIso).slice(0, 10);
  if (accounting.day !== dk) {
    accounting.day = dk;
    accounting.callsToday = 0;
    accounting.unitsToday = 0;
  }
}

/** يسجّل نداء Drive API فعلياً (يُستدعى من نقاط النقل الحقيقية فقط). */
export function recordDriveApiCall(kind: DriveApiCallKind, nowIso: string): void {
  rollDriveApiDay(nowIso);
  const units = driveApiQuotaUnitsFor(kind);
  accounting.callsToday += 1;
  accounting.unitsToday += units;
  accounting.unitsSinceStart += units;
  accounting.lastCallAt = nowIso;
}

/** لقطة للعرض (بلا سرّ). */
export function driveApiAccountingSnapshot(): DriveApiAccounting {
  return { ...accounting };
}
