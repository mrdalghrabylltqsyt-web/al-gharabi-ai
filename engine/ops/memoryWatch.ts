/**
 * إنذار ذاكرة الخادم للمالك (2026-10-27) — منطق صافٍ قابل للاختبار.
 *
 * خطة Render المجانية تقتل العملية فوراً عند 512 ميغا. قِيس على الخادم الحي صعود الذاكرة من
 * 101 إلى 207 ميغا خلال 19 ساعة. المهندس يرى ذلك على الشاشة فقط؛ هنا يصل إلى المالك عبر طابور
 * التنبيه نفسه (Telegram فوراً + ملخص البريد) قبل أن يسقط الخادم:
 *   - تحذير عند ≥70% من الحد، وخطر عند ≥85%،
 *   - أو تنبؤ: ميل ثابت يبلغ الحد خلال 12 ساعة (تسرّب) ولو كانت الذاكرة الآن دون 70%.
 * مفتاح التنبيه = المستوى + اليوم: تنبيه واحد لكل مستوى في اليوم (لا إغراق)، ويرتفع إلى «خطر»
 * فوراً إن ساء الوضع.
 */

export const MEMORY_WARN_RATIO = 0.7;
export const MEMORY_CRITICAL_RATIO = 0.85;
/** ميل أدنى يُعدّ اتجاهاً حقيقياً لا ضجيجاً (ميغا/ساعة). */
export const MEMORY_LEAK_MIN_SLOPE = 5;
/** أفق التنبؤ: إن بلغ الميلُ الحدَّ خلال هذه الساعات يُنذَر المالك. */
export const MEMORY_LEAK_HORIZON_HOURS = 12;

/** أقل مدى عيّنات للتنبؤ (ساعتان) — دون ذلك قفزة جمع القمامة/النسخة تُقرأ اتجاهاً. */
export const MEMORY_FORECAST_MIN_SPAN_MS = 2 * 3600000;
/** لا تنبؤ في أول 3 ساعات بعد الإقلاع: الذاكرة تصعد طبيعياً حتى تستقر الذاكرة المؤقتة. */
export const MEMORY_FORECAST_MIN_UPTIME_SEC = 3 * 3600;

/**
 * ميل «أرضية» الذاكرة (ميغا/ساعة) — 2026-10-27. على الخادم الحي تتأرجح الذاكرة 100–215 ميغا حول
 * ~120 (قفزات النسخة الاحتياطية/جمع القمامة)، فقرأ الانحدار الخطي على العيّنات الخام قفزةً واحدة
 * «+29 ميغا/ساعة» وأنذر كذباً. التسرّب الحقيقي يرفع **الأرضية** لا القمم: نقسم المدى إلى 4 نوافذ
 * زمنية، نأخذ أدنى قيمة في كل نافذة، ونحسب الميل عليها. يحتاج ساعتين على الأقل.
 */
export function baselineSlopePerHour(samples: ReadonlyArray<{ t: number; v: number }>): number | null {
  const s = (samples || []).filter((x) => Number.isFinite(x?.t) && Number.isFinite(x?.v)).slice().sort((a, b) => a.t - b.t);
  if (s.length < 8) return null;
  const t0 = s[0].t, span = s[s.length - 1].t - t0;
  if (span < MEMORY_FORECAST_MIN_SPAN_MS) return null;
  const buckets: Array<{ t: number; v: number }> = [];
  for (let b = 0; b < 4; b++) {
    const lo = t0 + (span * b) / 4, hi = t0 + (span * (b + 1)) / 4;
    const inB = s.filter((x) => x.t >= lo && (b === 3 ? x.t <= hi : x.t < hi));
    if (!inB.length) return null;
    const min = inB.reduce((m, x) => (x.v < m.v ? x : m), inB[0]);
    buckets.push({ t: (lo + hi) / 2, v: min.v });
  }
  const mt = buckets.reduce((a, x) => a + x.t, 0) / 4, mv = buckets.reduce((a, x) => a + x.v, 0) / 4;
  let num = 0, den = 0;
  for (const x of buckets) { num += (x.t - mt) * (x.v - mv); den += (x.t - mt) ** 2; }
  return den ? (num / den) * 3600000 : null;
}

export interface MemoryPressureInput {
  rssMb: number;
  limitMb: number;
  /** ميل الذاكرة (ميغا/ساعة) من عيّنات الدورية؛ null حتى تكفي العيّنات. */
  slopeMbPerHour: number | null;
  nowMs: number;
  /** زمن تشغيل العملية (ث) — التنبؤ ممنوع في فترة الإحماء. غيابه = لا تنبؤ. */
  uptimeSec?: number | null;
}

export interface MemoryPressureAlert {
  level: 'warn' | 'critical' | 'forecast';
  /** معرّف فريد لليوم والمستوى (لمفتاح منع التكرار). */
  id: string;
  title: string;
  snippet: string;
  hoursToLimit: number | null;
}

export function memoryPressureAlert(i: MemoryPressureInput): MemoryPressureAlert | null {
  const limit = Number(i.limitMb);
  const rss = Number(i.rssMb);
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(rss) || rss < 0) return null;
  const ratio = rss / limit;
  const slope = typeof i.slopeMbPerHour === 'number' && Number.isFinite(i.slopeMbPerHour) ? i.slopeMbPerHour : null;
  const hoursToLimit = slope != null && slope > 0 ? Math.max(0, (limit - rss) / slope) : null;
  const day = new Date(i.nowMs).toISOString().slice(0, 10);
  const pct = Math.round(ratio * 100);
  const trend = slope != null && slope > 0 ? ` · تصعد +${slope.toFixed(1)} ميغا/ساعة${hoursToLimit != null ? ` (الحد بعد ~${Math.round(hoursToLimit)} س)` : ''}` : '';
  const base = `${Math.round(rss)} من ${Math.round(limit)} ميغا (${pct}%)${trend}.`;
  if (ratio >= MEMORY_CRITICAL_RATIO) {
    return { level: 'critical', id: `critical:${day}`, title: 'ذاكرة الخادم على وشك الحد', snippet: `خطر: ${base} عند الحد يُعاد تشغيل الخادم وتتوقف الدورات دقائق.`, hoursToLimit };
  }
  if (ratio >= MEMORY_WARN_RATIO) {
    return { level: 'warn', id: `warn:${day}`, title: 'ذاكرة الخادم مرتفعة', snippet: `تحذير: ${base} راقب الاتجاه من «المهندس المشرف».`, hoursToLimit };
  }
  const warmedUp = typeof i.uptimeSec === 'number' && i.uptimeSec >= MEMORY_FORECAST_MIN_UPTIME_SEC;
  if (warmedUp && slope != null && slope >= MEMORY_LEAK_MIN_SLOPE && hoursToLimit != null && hoursToLimit <= MEMORY_LEAK_HORIZON_HOURS) {
    return { level: 'forecast', id: `forecast:${day}`, title: 'ذاكرة الخادم تصعد بثبات (تسرّب محتمل)', snippet: `تنبؤ: ${base} إن استمر فراجع آخر تغيير نُشر.`, hoursToLimit };
  }
  return null;
}
