import { judgePace, periodElapsed, type PacePeriod } from './quotaPacing';

/**
 * مراقبة الخطط المجانية والخزن (2026-10-29) — منطق صافٍ.
 *
 * كان المهندس يرى «ضغط الخطة» كمستوى واحد (عادي/مراقبة/حرج). الآن يرى كل حصة على حدة،
 * ويتنبأ بنهاية الشهر بإيقاع الاستهلاك الفعلي: حصة 40% في اليوم 10 من الشهر = 120% في آخره
 * ⇒ إنذار الآن لا حين تنفد. ويقيس حجم القاعدة الحقيقي (pg_database_size) مقابل سقف Neon
 * المجاني، ويسمّي أكبر ما فيها، ويقدّر متى تمتلئ بمعدل النمو المقيس.
 */

export interface PlanQuota {
  provider: string;
  label: string;
  usedPercent: number | null;
  /** مدة الحصة: تُوزَّع عليها (قاعدة المالك 2026-10-29) — أو سعة ثابتة. */
  period: PacePeriod;
}
export interface PlanVerdict extends PlanQuota { projectedPercent: number | null; allowedPercent: number | null; paceState: string; status: 'ok' | 'warn' | 'fail' | 'skip'; detail: string }

export const PLAN_LABELS: Readonly<Record<string, { label: string; period: PacePeriod }>> = Object.freeze({
  neon: { label: 'نقل قاعدة Neon (شهري)', period: 'month_utc' },
  neonCompute: { label: 'حوسبة Neon (شهري)', period: 'month_utc' },
  drive: { label: 'مساحة Google Drive', period: 'capacity' },
  driveApi: { label: 'حصة Drive API (يومي)', period: 'day_pacific' },
  render: { label: 'ساعات Render (شهري)', period: 'month_utc' },
  gemini: { label: 'Gemini (يومي)', period: 'day_utc' },
  youtube: { label: 'حصة YouTube (يومي)', period: 'day_pacific' },
  neonStorage: { label: 'مساحة قاعدة Neon', period: 'capacity' },
});

/** نسبة الشهر المنقضي (0..1] بتوقيت UTC. */
export function monthElapsedFraction(nowMs: number): number {
  return Math.max(1 / 31, periodElapsed(nowMs, 'month_utc'));
}

/** الحكم بالإيقاع: فوق المسموح حتى الآن = تحذير، فوقه كثيراً أو عند السقف = عطل؛ تحت الإيقاع سليم مهما ارتفعت النسبة. */
export function judgePlan(q: PlanQuota, nowMs: number): PlanVerdict {
  const v = judgePace(q.usedPercent, q.period, nowMs);
  if (v.state === 'unknown') return { ...q, projectedPercent: null, allowedPercent: null, paceState: v.state, status: 'skip', detail: `${q.label}: غير مقيس بعد` };
  const status: PlanVerdict['status'] = v.level === 'critical' ? 'fail' : v.level === 'watch' ? 'warn' : 'ok';
  const proj = v.projectedPercent != null && q.period !== 'capacity' ? ` · بهذا الإيقاع ${v.projectedPercent}% آخر المدة` : '';
  return { ...q, usedPercent: v.usedPercent, projectedPercent: v.projectedPercent, allowedPercent: v.allowedPercent, paceState: v.state, status, detail: `${q.label}: ${v.detail}${proj}` };
}

export function judgePlans(quotas: PlanQuota[], nowMs: number): { status: 'ok' | 'warn' | 'fail' | 'skip'; verdicts: PlanVerdict[]; worst: PlanVerdict | null } {
  const verdicts = quotas.map((q) => judgePlan(q, nowMs));
  const rank = { fail: 0, warn: 1, ok: 2, skip: 3 } as const;
  const measured = verdicts.filter((v) => v.status !== 'skip');
  const worst = measured.slice().sort((a, b) => rank[a.status] - rank[b.status] || Number(b.usedPercent) - Number(a.usedPercent))[0] || null;
  return { status: worst ? worst.status : 'skip', verdicts, worst };
}

// ─────────────────────────────────────────────────────────────────────────────
// الخزن
// ─────────────────────────────────────────────────────────────────────────────

export interface StorageSizeReport {
  at: string;
  backend: string;
  /** حجم القاعدة كاملاً بالبايت (pg_database_size) أو مجموع الملفات. */
  databaseBytes: number | null;
  /** أكبر المفاتيح المخزّنة (بلا قيمها). */
  keys: Array<{ key: string; bytes: number }>;
}
export interface StorageVerdict { status: 'ok' | 'warn' | 'fail' | 'skip'; percent: number | null; daysToFull: number | null; detail: string; advice: string | null }

export function judgeStorage(r: StorageSizeReport | null, quotaBytes: number, growthBytesPerDay: number | null): StorageVerdict {
  if (!r || r.databaseBytes == null) return { status: 'skip', percent: null, daysToFull: null, detail: 'لم يُقس حجم القاعدة بعد', advice: null };
  const pct = Math.round((r.databaseBytes / quotaBytes) * 1000) / 10;
  const days = growthBytesPerDay && growthBytesPerDay > 0 ? Math.max(0, Math.round((quotaBytes - r.databaseBytes) / growthBytesPerDay)) : null;
  const mb = (b: number) => `${(b / 1048576).toFixed(b >= 10 * 1048576 ? 0 : 1)} ميغا`;
  const top = r.keys.slice(0, 3).map((k) => `${k.key} ${mb(k.bytes)}`).join('، ');
  const status: StorageVerdict['status'] = pct >= 90 ? 'fail' : pct >= 75 || (days != null && days < 30) ? 'warn' : 'ok';
  return {
    status, percent: pct, daysToFull: days,
    detail: `${mb(r.databaseBytes)} من ${mb(quotaBytes)} (${pct}%)${days != null ? ` — تمتلئ بعد ~${days} يوم بالنمو الحالي` : ''}${top ? ` · الأكبر: ${top}` : ''}`,
    advice: status === 'ok' ? null : 'قرار مالك: أرشفة الأقدم من أكبر مجموعة (B7) أو خطة Neon أعلى — المهندس لا يحذف بيانات.',
  };
}

/** معدل النمو اليومي من قياسين (بايت/يوم) — null إن كانا متقاربين زمنياً جداً. */
export function bytesGrowthPerDay(first: { t: number; v: number } | null, last: { t: number; v: number }): number | null {
  if (!first || last.t - first.t < 6 * 3600000) return null;
  return ((last.v - first.v) / (last.t - first.t)) * 86400000;
}
