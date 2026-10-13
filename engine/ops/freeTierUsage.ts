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
  /** Neon Free: compute موثّق 100 CU-ساعة/شهر (الأساس الفعلي للحد المجاني الحديث — لا نقل). */
  neonMonthlyComputeCuHours: 100,
  /** Google Drive: مساحة الحساب المجانية الموثّقة 15 GiB. */
  driveStorageBytes: 15 * 1024 * 1024 * 1024,
  /** Google Drive API: حد ما قبل الفوترة اليومي الموثّق (400M وحدة حصّة). */
  driveApiDailyQuotaUnits: 400_000_000,
  /** Render Free: 750 ساعة تشغيل شهرياً **مشتركة** بين كل خدمات Workspace. */
  renderWorkspaceMonthlyHours: 750,
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
  provider: 'neon' | 'drive' | 'render' | 'driveApi';
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

/** مفتاح اليوم (YYYY-MM-DD) لحصص يومية مثل Drive API. */
export function dayKey(nowIso: string): string {
  return String(nowIso).slice(0, 10);
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

// ---------------------------------------------------------------------------
// عدّاد ساعات تشغيل Render — تقدير صادق (لا نملك API حقيقي من Render).
// ---------------------------------------------------------------------------

/** حالة تراكم ساعات التشغيل (تصمد بعد restart عبر محوّل الحالة). */
export interface RenderUptimeState {
  /** مفتاح الشهر (YYYY-MM). */
  month: string | null;
  /** ساعات التشغيل المتراكمة في الشهر الحالي. */
  hoursThisMonth: number;
  /** آخر لحظة محسوبة (ISO) لحساب الفرق — أساس عدّاد المنحدر. */
  lastAccruedAt: string | null;
  /** أول لحظة بدأ فيها العدّ (ISO) للتوثيق. */
  firstSeenAt: string | null;
  updatedAt: string | null;
}

export const RENDER_UPTIME_MAX_STEP_HOURS = 1;
export const RENDER_UPTIME_MAX_STEP_MS = 1 * 60 * 60 * 1000;

/**
 * هامش موثّق بالاحتساب الأسوأ لخدمة مركز الاستعادة (بلا نبضة ⇒ تنام غالباً).
 * تقدير متحفظ: 2 ساعة/يوم (60 ساعة/شهر) تغطّي فتحات المالك + الاستيقاظات الباردة.
 * الحصّة 750 ساعة **مشتركة**، فنضيف هذا الهامش على ساعات خدمتنا المقيسة.
 */
export const RENDER_RECOVERY_CENTER_ALLOWANCE_HOURS = 60;

/**
 * يتراكم ساعات تشغيل العملية. الأساس تقديري صريح (لا API حقيقي من Render): نضيف
 * الزمن المنقضي بين القراءات. الملاحظة الحاكمة: خطة Render المجانية تشترك في 750
 * ساعة شهرياً بين كل الخدمات، وخدمة (recovery-center) بلا نبضة تنام غالباً —
 * فساعاتنا المقيسة تقدير **أدنى**؛ القرار الحارس يعتمد المقيس + هامش موثّق
 * (`RENDER_RECOVERY_CENTER_ALLOWANCE_HOURS`) بدل افتراض استمرار الخدمتين.
 *
 * لا يُحتسب فرق أثناء التوقّف عن العمل (أعلى من خطوة واحدة ساعة) كي لا يتضخّم
 * العدّاد إذا بقي بين قراءتين ثم نام (لا نعرف إن كان يعمل فعلاً في تلك الفجوة).
 */
export function accrueRenderUptime(state: RenderUptimeState, nowIso: string): RenderUptimeState {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return state;
  const mk = monthKey(nowIso);
  const monthRolled = state.month !== mk;
  const base: RenderUptimeState = monthRolled
    ? { month: mk, hoursThisMonth: 0, lastAccruedAt: nowIso, firstSeenAt: state.firstSeenAt ?? nowIso, updatedAt: nowIso }
    : {
        month: state.month,
        hoursThisMonth: Number.isFinite(state.hoursThisMonth) ? state.hoursThisMonth : 0,
        lastAccruedAt: state.lastAccruedAt ?? nowIso,
        firstSeenAt: state.firstSeenAt ?? nowIso,
        updatedAt: nowIso,
      };
  if (!base.lastAccruedAt) return { ...base, lastAccruedAt: nowIso };
  const lastMs = Date.parse(base.lastAccruedAt);
  if (!Number.isFinite(lastMs)) return { ...base, lastAccruedAt: nowIso };
  const deltaMs = nowMs - lastMs;
  if (deltaMs <= 0) return { ...base, lastAccruedAt: nowIso };
  const stepMs = Math.min(deltaMs, RENDER_UPTIME_MAX_STEP_MS);
  const hours = stepMs / 3_600_000;
  return {
    ...base,
    hoursThisMonth: base.hoursThisMonth + hours,
    lastAccruedAt: nowIso,
    firstSeenAt: base.firstSeenAt ?? nowIso,
    updatedAt: nowIso,
  };
}

/**
 * مؤشّر ساعات تشغيل Render. صدق مزدوج:
 *  - `usedBytes` يحمل **تقدير الأدنى المقيس** (ساعات خدمتنا فقط).
 *  - الحقل `worstCaseHours` والملاحظة يعرضان المقيس + هامش موثّق لخدمة مركز
 *    الاستعادة (تنام غالباً) لأن الحصّة 750 مشتركة — فالقرار الحارس يعتمد الأسوأ.
 */
export function buildRenderUptimeIndicator(input: {
  measuredHoursThisMonth: number;
  worstCaseWorkspaceHours: number;
  limitHours: number;
  alertThresholdPercent: number;
}): UsageIndicator {
  const measured = Math.max(0, Number(input.measuredHoursThisMonth) || 0);
  const worst = Math.max(measured, Number(input.worstCaseWorkspaceHours) || measured);
  const limit = input.limitHours > 0 ? input.limitHours : FREE_TIER_QUOTAS.renderWorkspaceMonthlyHours;
  const percent = pct(worst, limit);
  const warning = percent != null && percent >= input.alertThresholdPercent;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    provider: 'render',
    basis: 'estimated',
    usedBytes: Math.round(measured),
    limitBytes: limit,
    usedPercent: percent,
    alertThresholdPercent: input.alertThresholdPercent,
    warning,
    note:
      `تقدير (لا API حقيقي من Render): ${round1(measured)} ساعة تشغيل مقيسة لخدمتنا هذا الشهر. ` +
      `الحد 750 ساعة **مشتركة** بين خدمات Workspace كلها — والمحتسَب الحارس = المقيس + هامش موثّق ${RENDER_RECOVERY_CENTER_ALLOWANCE_HOURS} ساعة لمركز الاستعادة = ${round1(worst)} ساعة (${percent ?? 0}%). ` +
      `خدمة مركز الاستعادة بلا نبضة تنام غالباً، فالساعات الحقيقية أقل من الأسوأ — العدّاد لا يتضخّم (يُحتسب الفرق بين القراءات فقط، لا الفجوات).`,
  };
}

/**
 * مؤشّر حصة طلبات Google Drive API. سخيّة جداً في حالتنا (نسخة كل 6 ساعات +
 * فحص ساعي)، لكنه موثّق صراحةً: الافتراضي ما قبل الفوترة 400M وحدة/يوم للمشروع
 * (list=100، get=5، download=200 وحدة). أساسه `measured` **لنداءاتنا وحدها**
 * (عدّاد داخلي) مقابل الحدّ الموثّق، ويُعلن بوضوح أنه لا يمثّل كل استهلاك المشروع.
 */
export function buildDriveApiIndicator(input: {
  callsToday: number;
  unitsToday: number;
  limitUnits: number;
  alertThresholdPercent: number;
}): UsageIndicator {
  const units = Math.max(0, Math.floor(Number(input.unitsToday) || 0));
  const limit = input.limitUnits > 0 ? input.limitUnits : FREE_TIER_QUOTAS.driveApiDailyQuotaUnits;
  const percent = pct(units, limit);
  const warning = percent != null && percent >= input.alertThresholdPercent;
  return {
    provider: 'driveApi',
    basis: 'measured',
    usedBytes: units,
    limitBytes: limit,
    usedPercent: percent,
    alertThresholdPercent: input.alertThresholdPercent,
    warning,
    note:
      `قياس داخلي لنداءاتنا وحدها: ${Math.max(0, Math.floor(Number(input.callsToday) || 0))} نداء = ${units} وحدة اليوم، مقابل الحدّ الموثّق ` +
      `${limit} وحدة/يوم للمشروع (list=100، get=5، download=200). هامشنا ضخم جداً (الافتراضي سخيّ)؛ الرقم لا يمثّل كل استهلاك المشروع، وقد تتغيّر السياسة عند بدء فوترة تجاوز الحصّة في 2026.`,
  };
}
