/**
 * حارس ضغط الاستهلاك (Usage Pressure Guard) — منطق خالص قابل للاختبار (بلا
 * شبكة/أسرار/AI). يحوّل مؤشرات الحصص المجانية (عرض فقط) إلى **قرار حارس فعلي**
 * يبطّئ الدورات غير الحرجة أو يوقفها مؤقتاً عند الاقتراب من حدّ المزوّد، بدل
 * الانتظار حتى الاصطدام بالحدّ. لا يستهلك Gemini ولا يمسّ أي سرّ.
 *
 * الفصل الصريح:
 *  - `normal`   : لا ضغط — كل الدورات تعمل بإيقاعها الطبيعي.
 *  - `watch`    : بلغ أعلى مؤشر عتبة التحذير — تُضاعف فواصل الدورات (توفير بلا توقّف).
 *  - `critical` : بلغ عتبة حرجة — تُؤجَّل **الأعمال الثقيلة** فقط (نسخة احتياطية/
 *                 تحليل كبير)، بينما **تستمر دورات الاستقبال الخفيفة** (قراءة
 *                 التعليقات/الرسائل/الزبائن) بلا توقّف.
 *
 * إصلاح جذري (2026-10-20): كان critical يُؤجّل كل الدورات «غير الحرجة» — ومنها
 * دورات الاستقبال الخفيفة — فتُوقفت دورات Meta/YouTube/Telegram بصمت ~32 ساعة
 * بينما رقم Neon الداخلي كان مبالغاً (كان يقيس الكتابة لا الصادر). الآن الاستقبال
 * الخفيف لا يُؤجَّل أبداً؛ التأجيل محصور بالعمل الثقيل، وأي تأجيل يُسجَّل صراحةً.
 *
 * قيد ملزم: الدورات **الحرجة** (النسخ الاحتياطي الكامل DR) لا تُعطَّل تماماً؛
 * تُؤجَّل نبضة واحدة فقط حتى لا تنقطع الاستمرارية، خلافاً للدورات الثقيلة الأخرى.
 * والقرار لا يمسّ أي عملية يطلبها المالك يدوياً.
 */

import { judgePace, type PacePeriod, type PaceVerdict } from './quotaPacing';

export type UsagePressureLevel = 'normal' | 'watch' | 'critical';

export interface UsagePressureSignal {
  /** أعلى نسبة استهلاك معروفة لهذا المزوّد، أو null إن لم تُقس. */
  usedPercent: number | null;
  /** معرف المزوّد للتوثيق (بلا سرّ). */
  provider?: string;
  /**
   * مدة الحصة (2026-10-29، قاعدة المالك: توزيع الحصة على مدتها). حين تُمرَّر مع `nowMs` يُحكم
   * على الإشارة بالإيقاع (المسموح حتى الآن) لا بعتبة ثابتة. غيابها = السلوك السابق (80/95).
   */
  period?: PacePeriod;
}

export interface UsagePressureDecision {
  level: UsagePressureLevel;
  /** المزوّد الذي بلغ أعلى نسبة (بلا سرّ)، أو null. */
  provider: string | null;
  /** أعلى نسبة مُرصودة (0..100 أو null). */
  usedPercent: number | null;
  /** هل تُضاعف فواصل الدورات الثقيلة؟ */
  slowDown: boolean;
  /**
   * هل تُؤجَّل **الأعمال الثقيلة غير الحرجة** (النسخ الاحتياطي، التحليل الكبير/
   * دورة العقل) هذه النبضة؟ (اسمه محفوظ للتوافق، ومعناه: عمل ثقيل لا استقبال).
   */
  deferNonCritical: boolean;
  /**
   * إصلاح جذري (2026-10-20): هل تُؤجَّل **دورات الاستقبال الخفيفة** (قراءة
   * التعليقات/الرسائل/الزبائن)؟ **دائماً false** — كانت تُؤجَّل عند critical
   * فتتوقف دورات Meta/YouTube/Telegram بصمت ~32 ساعة بينما Neon الحقيقي سليم.
   * الاستقبال الخفيف يبقى يعمل حتى عند critical؛ التأجيل يقع على الثقيل فقط.
   */
  deferIngest: boolean;
  /** المتطلّب: تأجيل نبضة النسخ الاحتياطي الحرجة (لا تعطيلها كلياً). */
  deferCriticalTick: boolean;
  note: string;
  /** حكم الإيقاع لكل إشارة ذات مدة (للعرض والمهندس). */
  pace?: Array<{ provider: string | null } & PaceVerdict>;
}

/** عتبة التحذير الافتراضية (تُضاعف الإيقاع) — 80%. */
export const USAGE_PRESSURE_WATCH_RATIO = 80;
/** العتبة الحرجة الافتراضية (تأجيل الدورات غير الحرجة) — 95%. */
export const USAGE_PRESSURE_CRITICAL_RATIO = 95;

function clampRatio(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return USAGE_PRESSURE_WATCH_RATIO;
  return Math.min(99, Math.floor(n));
}

/**
 * يحسم مستوى الضغط من إشارات المؤشرات: يأخذ أعلى نسبة معروفة. غياب كل النسب
 * (لا قياس) ⇒ `normal` بلا تخمين. لا يُعلن ضغطاً من قيمة غير متاحة.
 */
export function resolveUsagePressure(
  signals: readonly UsagePressureSignal[],
  opts: { watchRatio?: number; criticalRatio?: number; nowMs?: number } = {},
): UsagePressureDecision {
  // توزيع الحصة على مدتها: إن حملت الإشارات مدتها ومُرّر الوقت، يُحكم بالإيقاع.
  if (opts.nowMs != null && signals.some((s) => s?.period)) return resolvePacedPressure(signals, opts.nowMs, opts);
  const watch = clampRatio(opts.watchRatio ?? USAGE_PRESSURE_WATCH_RATIO);
  const critical = Math.max(watch, clampRatio(opts.criticalRatio ?? USAGE_PRESSURE_CRITICAL_RATIO));
  let top: UsagePressureSignal | null = null;
  for (const s of signals) {
    if (s?.usedPercent == null || !Number.isFinite(Number(s.usedPercent))) continue;
    if (!top || Number(s.usedPercent) > Number(top.usedPercent)) top = s;
  }
  if (!top) {
    return {
      level: 'normal', provider: null, usedPercent: null,
      slowDown: false, deferNonCritical: false, deferIngest: false, deferCriticalTick: false,
      note: 'لا مؤشر استهلاك مُقاس بعد — لا ضغط.',
    };
  }
  const used = Math.min(100, Math.max(0, Math.round(Number(top.usedPercent))));
  const provider = top.provider ?? null;
  if (used >= critical) {
    return {
      level: 'critical', provider, usedPercent: used,
      slowDown: true, deferNonCritical: true, deferIngest: false, deferCriticalTick: true,
      note: `بلغ أعلى مؤشر استهلاك ${used}% (${provider ?? 'غير معروف'}) ≥ العتبة الحرجة ${critical}% — تُؤجَّل **الأعمال الثقيلة** (نسخة احتياطية/تحليل كبير) وتُضاعف فواصلها، بينما **تستمر دورات الاستقبال الخفيفة** (قراءة التعليقات/الرسائل/الزبائن) بلا توقّف، وتُؤجَّل نبضة النسخ الاحتياطي (لا تُعطَّل).`,
    };
  }
  if (used >= watch) {
    return {
      level: 'watch', provider, usedPercent: used,
      slowDown: true, deferNonCritical: false, deferIngest: false, deferCriticalTick: false,
      note: `بلغ أعلى مؤشر استهلاك ${used}% (${provider ?? 'غير معروف'}) ≥ عتبة التحذير ${watch}% — تُضاعف فواصل الدورات الثقيلة والخفيفة معاً (لا تأجيل).`,
    };
  }
  return {
    level: 'normal', provider, usedPercent: used,
    slowDown: false, deferNonCritical: false, deferIngest: false, deferCriticalTick: false,
    note: `أعلى مؤشر استهلاك ${used}% — بلا ضغط؛ الإيقاع الطبيعي.`,
  };
}

/** مضاعف الفاصل الفعلي حسب مستوى الضغط (1 عادي، 2 تحذير، بلا تغيير عند حرج لأنها مؤجّلة). */
export function usagePressureIntervalMultiplier(level: UsagePressureLevel): number {
  return level === 'watch' ? 2 : 1;
}

/**
 * مضاعف فاصل **دورات الاستقبال الخفيفة** — لا يتضاعف أبداً عند critical (كي لا
 * تتوقف القراءة الفعلية)، ويتضاعف عند watch فقط (توفير بلا توقّف).
 */
export function usagePressureIngestIntervalMultiplier(level: UsagePressureLevel): number {
  return level === 'watch' ? 2 : 1;
}

const LEVEL_RANK: Record<UsagePressureLevel, number> = { normal: 0, watch: 1, critical: 2 };

/**
 * الحارس بالإيقاع: لكل حصة ذات مدة يُقارن المستهلك بالمسموح حتى الآن (ما مضى من المدة + هامش)،
 * والسعوية بعتبتي 80/95، والإشارة بلا مدة بالعتبات الثابتة. الأشد يحكم.
 */
function resolvePacedPressure(
  signals: readonly UsagePressureSignal[], nowMs: number,
  opts: { watchRatio?: number; criticalRatio?: number },
): UsagePressureDecision {
  const pace: Array<{ provider: string | null } & PaceVerdict> = [];
  let worst: { level: UsagePressureLevel; provider: string | null; used: number; why: string } | null = null;
  for (const s of signals) {
    if (s?.usedPercent == null || !Number.isFinite(Number(s.usedPercent))) continue;
    let level: UsagePressureLevel; let why: string;
    if (s.period) {
      const v = judgePace(Number(s.usedPercent), s.period, nowMs);
      pace.push({ provider: s.provider ?? null, ...v });
      level = v.level; why = v.detail;
    } else {
      const legacy = resolveUsagePressure([{ usedPercent: s.usedPercent, provider: s.provider }], { watchRatio: opts.watchRatio, criticalRatio: opts.criticalRatio });
      level = legacy.level; why = `${Math.round(Number(s.usedPercent))}%`;
    }
    const used = Math.round(Number(s.usedPercent));
    if (!worst || LEVEL_RANK[level] > LEVEL_RANK[worst.level] || (LEVEL_RANK[level] === LEVEL_RANK[worst.level] && used > worst.used)) worst = { level, provider: s.provider ?? null, used, why };
  }
  if (!worst) {
    return { level: 'normal', provider: null, usedPercent: null, slowDown: false, deferNonCritical: false, deferIngest: false, deferCriticalTick: false, note: 'لا مؤشر استهلاك مُقاس بعد — لا ضغط.', pace };
  }
  const base = { provider: worst.provider, usedPercent: worst.used, deferIngest: false, pace };
  if (worst.level === 'critical') {
    return { ...base, level: 'critical', slowDown: true, deferNonCritical: true, deferCriticalTick: true,
      note: `${worst.provider ?? 'حصة'}: ${worst.why} — تُؤجَّل **الأعمال الثقيلة** حتى يلحقها الوقت، والاستقبال الخفيف مستمر بلا توقّف.` };
  }
  if (worst.level === 'watch') {
    return { ...base, level: 'watch', slowDown: true, deferNonCritical: false, deferCriticalTick: false,
      note: `${worst.provider ?? 'حصة'}: ${worst.why} — تُضاعف فواصل الدورات حتى يعود الاستهلاك إلى خطه (لا تأجيل).` };
  }
  return { ...base, level: 'normal', slowDown: false, deferNonCritical: false, deferCriticalTick: false,
    note: `كل الحصص على إيقاعها أو تحته (الأعلى ${worst.provider ?? ''} ${worst.used}%) — الإيقاع الطبيعي كاملاً.` };
}
