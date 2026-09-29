/**
 * Timing Intelligence — نموذج توقيت يتعلّم من بيانات حقيقية (منطق خالص).
 *
 * لا قاعدة ثابتة مثل «انشر الساعة 8». بل يتعلّم من: المنصة، المقطع، نوع المحتوى،
 * اليوم، النافذة الزمنية، الأداء التاريخي، حجم العيّنة، والثقة.
 *
 * المنطقة الزمنية المعتمدة للمشروع هي `Asia/Baghdad`، ومصدرها الوحيد هو
 * `src/utils/scheduleTime.ts` (APP_TIMEZONE + المحوّلات). لا حساب زمني مكرّر هنا.
 *
 * القاعدة: عند نقص العيّنة لا يُدّعى «أفضل وقت» بل يُعلن `INSUFFICIENT_DATA`.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import { APP_TIMEZONE, wallClockToEpoch } from '../../../src/utils/scheduleTime';

export const TIMING_TIMEZONE = APP_TIMEZONE;

export type TimingWindow = 'morning' | 'afternoon' | 'evening' | 'night';

export const TIMING_WINDOW_LABELS_AR: Record<TimingWindow, string> = Object.freeze({
  morning: 'صباحاً (06:00–11:59)',
  afternoon: 'بعد الظهر (12:00–16:59)',
  evening: 'مساءً (17:00–21:59)',
  night: 'ليلاً (22:00–05:59)',
});

export function windowForHour(hour: number): TimingWindow {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

/** ساعة محلية بغدادية من لحظة UTC. */
export function baghdadHour(iso: string): number | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  // بغداد UTC+3 ثابت (لا توقيت صيفي).
  return new Date(ms + 180 * 60_000).getUTCHours();
}

export interface TimingObservation {
  platform: string;
  /** معرّف المقطع/الجمهور إن توفر. */
  segmentId?: string | null;
  contentType?: string | null;
  /** وقت النشر/التفاعل الفعلي (ISO). */
  at: string;
  /** مؤشر الأداء المقاس فعلاً (مثل views أو تفاعل). */
  performance: number;
}

export interface TimingRecommendation {
  status: 'supported' | 'insufficient_sample';
  window: TimingWindow | null;
  /** ساعة مقترحة محلية (بغداد) أو null. */
  suggestedHour: number | null;
  /** موعد مقترح بصيغة ISO محوّل من الجدار المحلي عبر المصدر الواحد. */
  suggestedAtIso: string | null;
  timezone: string;
  reason: string;
  evidence: string;
  sampleSize: number;
  confidence: 'low' | 'medium' | 'high';
  limitations: string;
}

export const TIMING_MIN_SAMPLE = 5;

/**
 * يبني توصية توقيت من ملاحظات أداء حقيقية فقط، بتحليل النوافذ المحلية البغدادية.
 * عند نقص العيّنة يُعلن ذلك بلا اختراع «أفضل وقت».
 */
export function recommendTimingWindow(input: {
  observations: TimingObservation[];
  platform?: string;
  segmentId?: string | null;
  contentType?: string | null;
  minSample?: number;
}): TimingRecommendation {
  const minSample = input.minSample ?? TIMING_MIN_SAMPLE;
  let obs = input.observations.filter((o) => Number.isFinite(o.performance));
  if (input.platform) obs = obs.filter((o) => o.platform === input.platform);
  if (input.segmentId) obs = obs.filter((o) => (o.segmentId || null) === input.segmentId);
  if (input.contentType) obs = obs.filter((o) => (o.contentType || null) === input.contentType);

  const base = {
    timezone: TIMING_TIMEZONE,
    limitations: 'التوقيت يتأثر بعوامل خارجية غير مقيسة (وصول/موضوع/موسم)؛ توصية لا ضمان.',
  };

  if (obs.length < minSample) {
    return {
      ...base,
      status: 'insufficient_sample',
      window: null,
      suggestedHour: null,
      suggestedAtIso: null,
      reason: `العيّنة (${obs.length}) أقل من الحد الكافي (${minSample})؛ لا يُدّعى «أفضل وقت».`,
      evidence: `ملاحظات أداء صالحة: ${obs.length}.`,
      sampleSize: obs.length,
      confidence: 'low',
    };
  }

  const byWindow = new Map<TimingWindow, { sum: number; count: number }>();
  for (const o of obs) {
    const h = baghdadHour(o.at);
    if (h === null) continue;
    const w = windowForHour(h);
    const cur = byWindow.get(w) || { sum: 0, count: 0 };
    cur.sum += o.performance;
    cur.count += 1;
    byWindow.set(w, cur);
  }
  const ranked = [...byWindow.entries()]
    .filter(([, s]) => s.count > 0)
    .sort((a, b) => (b[1].sum / b[1].count) - (a[1].sum / a[1].count));
  if (!ranked.length) {
    return {
      ...base,
      status: 'insufficient_sample',
      window: null, suggestedHour: null, suggestedAtIso: null,
      reason: 'تعذّر استخراج نوافذ صالحة من الأوقات المُمرَّرة.',
      evidence: 'لا نوافذ صالحة.', sampleSize: obs.length, confidence: 'low',
    };
  }
  const [bestWindow, stats] = ranked[0];
  const avg = Math.round(stats.sum / stats.count);
  // الساعة المقترحة: منتصف النافذة الفائزة.
  const hourMap: Record<TimingWindow, number> = { morning: 9, afternoon: 14, evening: 19, night: 22 };
  const suggestedHour = hourMap[bestWindow];
  const now = new Date();
  // جدار محلي بغدادي لليوم نفسه، عبر المصدر الواحد (لا حساب زمني مكرّر).
  const localDate = new Date(now.getTime() + 180 * 60_000);
  const dateStr = `${localDate.getUTCFullYear()}-${String(localDate.getUTCMonth() + 1).padStart(2, '0')}-${String(localDate.getUTCDate()).padStart(2, '0')}`;
  const epoch = wallClockToEpoch(`${dateStr}T${String(suggestedHour).padStart(2, '0')}:00`, TIMING_TIMEZONE);
  const suggestedAtIso = Number.isFinite(epoch) ? new Date(epoch).toISOString() : null;

  return {
    ...base,
    status: 'supported',
    window: bestWindow,
    suggestedHour,
    suggestedAtIso,
    reason: `النافذة «${TIMING_WINDOW_LABELS_AR[bestWindow]}» سجّلت أعلى متوسط أداء (≈ ${avg}).`,
    evidence: `متوسط الأداء لكل نافذة من ${obs.length} ملاحظة فعلية.`,
    sampleSize: obs.length,
    confidence: stats.count >= minSample * 2 ? 'medium' : 'low',
  };
}

/**
 * يقارن توصيتين للتوقيت لهدف التفسير. عند تساوي الدليل أو غيابه يُعلن التعادل.
 */
export function describeTimingRecommendation(rec: TimingRecommendation): string {
  if (rec.status !== 'supported' || !rec.window) {
    return `لا توصية توقيت: ${rec.reason} (${rec.timezone}).`;
  }
  return `نافذة مقترحة: ${TIMING_WINDOW_LABELS_AR[rec.window]} ≈ ${rec.suggestedHour}:00 (${rec.timezone}). الثقة: ${rec.confidence}.`;
}
