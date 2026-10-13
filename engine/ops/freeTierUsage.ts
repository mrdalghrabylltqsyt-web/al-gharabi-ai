/**
 * مؤشرات استهلاك الحصص المجانية — منطق خالص قابل للاختبار (بلا شبكة/أسرار/AI).
 *
 * الغرض: عرض تقدّم الاستهلاك مقابل حدود مخطّطات مجانية **موثّقة** بصراحة، بلا
 * ادّعاء دقة قراءة حيّة لم تُثبت. مؤشر **عرض فقط** في /api/health:
 *  - لا يحجب أي عملية ولا يغيّر أي إيقاع (لا منطق gate هنا إطلاقاً).
 *  - لا سرّ: لا مفاتيح ولا توكنات ولا روابط ولا معرّفات حساب.
 *
 * الفصل الصريح: `basis` يوضّح مصدر كل رقم — `measured` (قياس داخلي فعلي، مثل
 * بايتات الكتابة إلى قاعدة البيانات) مقابل `estimated` (تقدير بحدود المخطّط
 * المجاني الموثّقة، مثل مساحة Drive إن تعذّرت القراءة الحيّة) — فلا يُخلط قياس
 * بتقدير.
 */

/** حدود المخطّط المجاني الموثّقة (بايت). تظهر للـUI كي لا تُخفى الفرضية. */
export const FREE_TIER_QUOTAS = {
  /** Neon Free: حد تخزين موثّق ~0.5 GiB للحساب. */
  neonStorageBytes: 512 * 1024 * 1024,
  /** Neon Free: حصّة نقل البيانات الشهرية الموثّقة ~5 GiB (تقدير متحفظ). */
  neonMonthlyTransferBytes: 5 * 1024 * 1024 * 1024,
  /** Google Drive: مساحة الحساب المجانية الموثّقة 15 GiB. */
  driveStorageBytes: 15 * 1024 * 1024 * 1024,
} as const;

/** ذاكرة قراءة/كتابة تحفظ تراكم الاستهلاك بعد restart (تقدير صادق). */
export interface FreeTierUsageState {
  /** مفتاح الشهر (YYYY-MM) لتقدير النقل الشهري. */
  month: string | null;
  /** بايتات النقل المتراكمة في الشهر الحالي (تقديرية). */
  transferBytesMonth: number;
  /** بايتات النقل المتراكمة منذ بدء تشغيل واحد (لمؤشّر المستأجر). */
  transferBytesSinceBoot: number;
  updatedAt: string | null;
}

export interface UsageIndicator {
  provider: 'neon' | 'drive';
  /** measured = قياس داخلي فعلي؛ estimated = تقدير بحدود المخطّط. */
  basis: 'measured' | 'estimated';
  usedBytes: number | null;
  limitBytes: number;
  usedPercent: number | null;
  alertThresholdPercent: number;
  warning: boolean;
  /** وصف مقروء + ملاحظة صريحة بحدود الدقة. بلا أي سرّ. */
  note: string;
}

export const USAGE_ALERT_THRESHOLD_DEFAULT = 80;
export const USAGE_ALERT_THRESHOLD_MAX_SAFE = 95;

/** يقصّ عتبة التحذير إلى نطاق آمن [1..95] (لا تعطيل بقيمة بيئة كبيرة). */
export function resolveUsageAlertThreshold(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > USAGE_ALERT_THRESHOLD_MAX_SAFE) return USAGE_ALERT_THRESHOLD_DEFAULT;
  return Math.floor(n);
}

export function monthKey(nowIso: string): string {
  return String(nowIso).slice(0, 7);
}

/**
 * يحسب تقدّم الشهر الحالي: إن تغيّر مفتاح الشهر يُصفَّر التراكم الشهري (وهذا
 * ليس منطق حجب، بل مجرد عدّاد عرض). لا يعدّل أي شيء آخر.
 */
export function rollMonthlyUsage(state: FreeTierUsageState, nowIso: string): FreeTierUsageState {
  const mk = monthKey(nowIso);
  if (state.month !== mk) {
    return { month: mk, transferBytesMonth: 0, transferBytesSinceBoot: state.transferBytesSinceBoot, updatedAt: nowIso };
  }
  return state;
}

/**
 * يتراكم بايتات الكتابة الفعلية إلى قاعدة الحالة (نقل Neon تقديري).
 * idempotent على مستوى الاستدعاء: يضيف الفرق بين الإجمالي الحالي والمحفوظ.
 */
export function accrueTransfer(state: FreeTierUsageState, totalBytesSinceStart: number, nowIso: string): FreeTierUsageState {
  const rolled = rollMonthlyUsage(state, nowIso);
  const prevBoot = Number.isFinite(state.transferBytesSinceBoot) ? state.transferBytesSinceBoot : 0;
  const delta = Math.max(0, Math.floor(totalBytesSinceStart) - prevBoot);
  return {
    month: rolled.month,
    transferBytesMonth: rolled.transferBytesMonth + delta,
    transferBytesSinceBoot: Math.max(0, Math.floor(totalBytesSinceStart)),
    updatedAt: nowIso,
  };
}

function pct(used: number | null, limit: number): number | null {
  if (used == null || !Number.isFinite(used) || limit <= 0) return null;
  return Math.min(100, Math.round((used / limit) * 100));
}

/**
 * مؤشّر مساحة Drive: `measured` عند وجود قراءة حيّة (من نسخة/مزامنة فعلية)،
 * وإلا `estimated` بلا ادّعاء قراءة عند غياب القراءة (usedBytes=null).
 */
export function buildDriveQuotaIndicator(input: {
  usageBytes: number | null;
  limitBytes: number | null;
  liveRead: boolean;
  alertThresholdPercent: number;
}): UsageIndicator {
  const limit = input.limitBytes && input.limitBytes > 0 ? input.limitBytes : FREE_TIER_QUOTAS.driveStorageBytes;
  const used = input.usageBytes != null && Number.isFinite(input.usageBytes) ? input.usageBytes : null;
  const percent = pct(used, limit);
  const basis: 'measured' | 'estimated' = input.liveRead && used != null ? 'measured' : 'estimated';
  const warning = percent != null && percent >= input.alertThresholdPercent;
  return {
    provider: 'drive',
    basis,
    usedBytes: used,
    limitBytes: limit,
    usedPercent: percent,
    alertThresholdPercent: input.alertThresholdPercent,
    warning,
    note:
      used == null
        ? 'لا قراءة مساحة Drive متاحة بعد (تُقاس عند أول نسخة/مزامنة فعلية). الحد المعروض من المخطّط المجاني الموثّق 15 GiB — مؤشر عرض فقط بلا حجب.'
        : basis === 'measured'
          ? 'قياس فعلي لمساحة Drive من عملية نسخة/مزامنة حقيقية (استدعاء about.get القائم، بلا قراءة إضافية). مؤشر عرض فقط بلا حجب. مساحة الحساب قد تشمل ملفات خارج النسخ.'
          : 'تقدير بحدود مخطّط Drive المجاني (15 GiB) — مؤشر عرض فقط بلا حجب.',
  };
}

/**
 * مؤشّر نقل Neon: قياس داخلي فعلي لبايتات الكتابة إلى قاعدة الحالة مقابل حصّة
 * النقل الشهرية الموثّقة (~5 GiB، تقدير متحفظ). يوضّح أن القاعدة الحقيقية هي
 * حدّ الشبكة لدى Neon لا الحركة الثنائية الداخلية.
 */
export function buildNeonTransferIndicator(input: {
  transferBytesMonth: number;
  alertThresholdPercent: number;
  backend: 'file' | 'postgres';
}): UsageIndicator {
  const used = Math.max(0, Math.floor(Number(input.transferBytesMonth) || 0));
  const limit = FREE_TIER_QUOTAS.neonMonthlyTransferBytes;
  const percent = pct(used, limit);
  const warning = percent != null && percent >= input.alertThresholdPercent;
  const base =
    'قياس داخلي فعلي لبايتات الكتابة الفعلية إلى قاعدة الحالة منذ أول التشغيل (داخل العملية) مقابل حصّة نقل Neon المجانية الموثّقة ~5 GiB/شهر. تقدير متحفظ: لا يشمل حركة القراءة/الاعتماديات، والحدّ الحقيقي لدى Neon هو نقل الشبكة لا الحركة الثنائية الداخلية — مؤشر عرض فقط بلا حجب.';
  return {
    provider: 'neon',
    basis: 'measured',
    usedBytes: used,
    limitBytes: limit,
    usedPercent: percent,
    alertThresholdPercent: input.alertThresholdPercent,
    warning,
    note: input.backend === 'postgres' ? base : `الخلفية الحالية «ملف» لا Postgres — لا نقل Neon فعلي. ${base}`,
  };
}
