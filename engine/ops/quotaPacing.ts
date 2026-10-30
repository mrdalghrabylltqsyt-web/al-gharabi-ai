/**
 * توزيع الحصص المجانية على الوقت (2026-10-29، قاعدة المالك) — منطق صافٍ.
 *
 * القاعدة: كل حصة تُقسَّم على مدتها كاملة. في أي لحظة، المسموح استهلاكه حتى الآن =
 * (نسبة ما مضى من المدة + هامش يتناقص حتى الصفر عند نهايتها) × الحصة. فلا تنفد الحصة مبكراً (ثلاث ساعات من يوم Gemini
 * لا تأكل الحصة كلها فيبقى بقية اليوم بلا شيء)، ولا يُبطَّأ العمل وهو تحت إيقاعه (85% في آخر يوم
 * من الشهر استهلاك سليم لا ضغط) — فتُستعمل الحصة **حتى أقصاها** على امتداد مدتها.
 *
 *   تحت الإيقاع أو عليه      ⇒ عادي (الإيقاع الطبيعي كاملاً)
 *   سبق الإيقاع               ⇒ مراقبة: تُضاعف فواصل الدورات فيتراجع الاستهلاك إلى خطه
 *   سبقه بأكثر من 10 نقاط     ⇒ حرج: تُؤجَّل الأعمال الثقيلة غير الحرجة حتى يلحقها الوقت
 *   بلغ 98% من الحصة          ⇒ حرج مهما كان الوقت (لا تجاوز للحد أبداً)
 * الحصص «السعوية» (مساحة Drive، مساحة القاعدة) لا مدة لها: عتبات ثابتة 80/95.
 *
 * المدد: يوم UTC (حارس Gemini المحلي يتجدد بتوقيت UTC)، يوم المحيط الهادئ (حصص Google: YouTube
 * وDrive API تتجدد منتصف ليل المحيط الهادئ)، وشهر UTC (Neon وRender).
 */

export type PacePeriod = 'day_utc' | 'day_pacific' | 'month_utc' | 'capacity';
export type PaceState = 'under' | 'on_pace' | 'ahead' | 'far_ahead' | 'exhausted' | 'capacity_ok' | 'capacity_watch' | 'capacity_full' | 'unknown';

export const PACE_POLICY = Object.freeze({
  /** هامش البدء: يُسمح باستهلاك هذا القدر فوق خط الإيقاع (اليوم ≈ ساعتان، الشهر ≈ يوم ونصف). */
  burst: { day: 0.08, month: 0.05 } as const,
  /** «سبق كثيراً» = فوق المسموح بأكثر من هذه النقاط ⇒ تأجيل الثقيل. */
  farAheadPoints: 10,
  /** سقف صلب: لا يُقترب من الحد أكثر من هذا مهما كان الوقت. */
  hardStopPercent: 98,
  capacityWatch: 80,
  capacityFull: 95,
});

/** فرق توقيت المحيط الهادئ (دقائق تُضاف إلى UTC: ‎-480 شتاءً، ‎-420 صيفاً). */
export function pacificOffsetMin(nowMs: number): number {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const nthSunday = (month: number, nth: number, utcHour: number) => {
    const first = Date.UTC(y, month, 1, utcHour);
    return first + ((7 - new Date(first).getUTCDay()) % 7) * 86400000 + (nth - 1) * 7 * 86400000;
  };
  const dstStart = nthSunday(2, 2, 10); // ثاني أحد من آذار 02:00 PST
  const dstEnd = nthSunday(10, 1, 9); // أول أحد من تشرين الثاني 02:00 PDT
  return nowMs >= dstStart && nowMs < dstEnd ? -420 : -480;
}

/** بداية المدة الحالية ونهايتها (ms). */
export function periodBounds(nowMs: number, period: Exclude<PacePeriod, 'capacity'>): { start: number; end: number } {
  if (period === 'month_utc') {
    const d = new Date(nowMs);
    return { start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), end: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) };
  }
  const off = period === 'day_pacific' ? pacificOffsetMin(nowMs) * 60000 : 0;
  const local = nowMs + off;
  const start = Math.floor(local / 86400000) * 86400000 - off;
  return { start, end: start + 86400000 };
}

/** ما مضى من المدة (0..1]. */
export function periodElapsed(nowMs: number, period: Exclude<PacePeriod, 'capacity'>): number {
  const { start, end } = periodBounds(nowMs, period);
  return Math.min(1, Math.max(0, (nowMs - start) / (end - start)));
}

/** النسبة المسموح بلوغها الآن (0..100). */
export function paceAllowedPercent(nowMs: number, period: Exclude<PacePeriod, 'capacity'>): number {
  const burst = period === 'month_utc' ? PACE_POLICY.burst.month : PACE_POLICY.burst.day;
  // الهامش يتناقص حتى يصير صفراً عند نهاية المدة: سماحة في البداية، ولا تنفد الحصة قبل آخر المدة.
  const e = periodElapsed(nowMs, period);
  return Math.min(100, Math.round((e + burst * (1 - e)) * 1000) / 10);
}

export interface PaceVerdict {
  period: PacePeriod;
  usedPercent: number | null;
  /** المسموح حتى الآن (null للسعوية). */
  allowedPercent: number | null;
  /** كم نقطة فوق المسموح (سالب = تحت الإيقاع، أي متّسع). */
  aheadBy: number | null;
  /** بهذا الإيقاع: نسبة الاستهلاك عند نهاية المدة. */
  projectedPercent: number | null;
  state: PaceState;
  level: 'normal' | 'watch' | 'critical';
  /** متى تتجدد الحصة (ms) — للسعوية null. */
  resetsAt: number | null;
  detail: string;
}

export function judgePace(usedPercent: number | null | undefined, period: PacePeriod, nowMs: number): PaceVerdict {
  if (usedPercent == null || !Number.isFinite(Number(usedPercent))) {
    return { period, usedPercent: null, allowedPercent: null, aheadBy: null, projectedPercent: null, state: 'unknown', level: 'normal', resetsAt: null, detail: 'غير مقيس' };
  }
  const used = Math.max(0, Math.round(Number(usedPercent) * 10) / 10);
  if (period === 'capacity') {
    const state: PaceState = used >= PACE_POLICY.capacityFull ? 'capacity_full' : used >= PACE_POLICY.capacityWatch ? 'capacity_watch' : 'capacity_ok';
    return { period, usedPercent: used, allowedPercent: null, aheadBy: null, projectedPercent: null, state, level: state === 'capacity_full' ? 'critical' : state === 'capacity_watch' ? 'watch' : 'normal', resetsAt: null, detail: `${used}% من السعة` };
  }
  const allowed = paceAllowedPercent(nowMs, period);
  const elapsed = periodElapsed(nowMs, period);
  const ahead = Math.round((used - allowed) * 10) / 10;
  const projected = elapsed >= 0.1 ? Math.round(used / elapsed) : null;
  const { end } = periodBounds(nowMs, period);
  let state: PaceState;
  if (used >= PACE_POLICY.hardStopPercent) state = 'exhausted';
  else if (ahead > PACE_POLICY.farAheadPoints) state = 'far_ahead';
  else if (ahead > 0) state = 'ahead';
  else if (ahead > -10) state = 'on_pace';
  else state = 'under';
  const level = state === 'exhausted' || state === 'far_ahead' ? 'critical' : state === 'ahead' ? 'watch' : 'normal';
  const word = state === 'exhausted' ? 'بلغ السقف — متوقف حتى التجدد' : state === 'far_ahead' ? 'سبق إيقاعه كثيراً — الثقيل مؤجّل حتى يلحقه الوقت' : state === 'ahead' ? 'سبق إيقاعه — الدورات أبطأ حتى يعود لخطه' : state === 'on_pace' ? 'على إيقاعه' : 'تحت إيقاعه (متّسع)';
  return {
    period, usedPercent: used, allowedPercent: allowed, aheadBy: ahead, projectedPercent: projected, state, level, resetsAt: end,
    detail: `${used}% من المسموح الآن ${allowed}% — ${word}`,
  };
}

/**
 * هل يُسمح لعمل **خلفي** باستهلاك `units` الآن دون أن يسبق الإيقاع؟ (العمل الذي يطلبه المالك بنفسه لا يمر
 * من هنا — يأخذ حتى السقف الكامل.) `budget` = ما يُخصَّص للعمل الخلفي من الحصة.
 */
export function pacedAllows(usedUnits: number, budget: number, units: number, period: Exclude<PacePeriod, 'capacity'>, nowMs: number): boolean {
  if (!(budget > 0)) return false;
  const allowedUnits = (paceAllowedPercent(nowMs, period) / 100) * budget;
  return usedUnits + Math.max(0, units) <= allowedUnits;
}

/** وقت يلحق فيه الإيقاع استهلاكاً حالياً (ms من الآن) — لعرض «يُستأنف بعد». */
export function catchUpInMs(usedPercent: number, period: Exclude<PacePeriod, 'capacity'>, nowMs: number): number {
  const burst = period === 'month_utc' ? PACE_POLICY.burst.month : PACE_POLICY.burst.day;
  const { start, end } = periodBounds(nowMs, period);
  // allowed(e) = e + burst·(1−e) ⇒ e = (u − burst) / (1 − burst)
  const needFrac = Math.max(0, (usedPercent / 100 - burst) / (1 - burst));
  const at = start + needFrac * (end - start);
  return Math.max(0, Math.min(end, at) - nowMs);
}
