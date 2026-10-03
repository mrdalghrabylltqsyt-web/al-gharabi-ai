/**
 * PROC-01 — قفل دوام (durable lease) عام للمجدولات الداخلية.
 *
 * المشكلة: حرّاس المجدولات (`watcherRunning`, `autoBackupInFlight`, …) كانت في
 * الذاكرة فقط. عند تعدد العمليات (cold start / نسختان / إعادة نشر) يمكن أن تنطلق
 * دورتان متزامنتان على نفس الحالة. الحل: قفل يُحفظ في الحالة الدائمة (ملف/Postgres)
 * عبر محوّل الحالة، فيراه أي عملية أخرى.
 *
 * منطق صافٍ قابل للاختبار (بلا شبكة/أسرار/ساعة حقيقية): الآن يُمرَّر صراحةً.
 * - لا استيلاء على قفل حيّ (يُرفض).
 * - القفل المتقادم (انتهت مهلته) يُستردّ تلقائياً فلا جمود دائم بعد تعطّل عملية.
 * - لا يُفرج القفل إلا مالكه.
 */

export interface DurableLease {
  owner: string;
  acquiredAtMs: number;
  expiresAtMs: number;
}

export const LEASE_MIN_TTL_MS = 30 * 1000;
export const LEASE_MAX_TTL_MS = 60 * 60 * 1000;

/** هل القفل متقادم (انتهت مهلته أو غير صالح)؟ */
export function isLeaseStale(lease: DurableLease | null | undefined, nowMs: number): boolean {
  if (!lease) return false;
  if (!Number.isFinite(lease.expiresAtMs)) return true;
  return lease.expiresAtMs <= nowMs;
}

/**
 * محاولة أخذ القفل. القفل المتقادم يُستردّ (recovered=true) فلا جمود دائم.
 * قفل حيّ لمالك آخر يُرفض بلا استيلاء.
 */
export function acquireLease(
  current: DurableLease | null | undefined,
  input: { owner: string; nowMs: number; ttlMs: number },
): { acquired: boolean; lease: DurableLease | null; recovered: boolean } {
  const ttl = Math.min(LEASE_MAX_TTL_MS, Math.max(LEASE_MIN_TTL_MS, Math.floor(input.ttlMs)));
  const fresh: DurableLease = { owner: input.owner, acquiredAtMs: input.nowMs, expiresAtMs: input.nowMs + ttl };
  if (!current) return { acquired: true, lease: fresh, recovered: false };
  if (isLeaseStale(current, input.nowMs)) return { acquired: true, lease: fresh, recovered: true };
  return { acquired: false, lease: current, recovered: false };
}

/** يُفرج القفل فقط إن كان مالكه نفس صاحب الدورة (لا يُفرج قفل غيره). */
export function releaseLease(
  current: DurableLease | null | undefined,
  owner: string,
): { lease: DurableLease | null; released: boolean } {
  if (!current) return { lease: null, released: false };
  if (current.owner !== owner) return { lease: current, released: false };
  return { lease: null, released: true };
}

/** تطبيع قفل مسترجَع من الحالة الدائمة (يتجاهل أي شكل غير صالح). */
export function normalizeLease(raw: unknown): DurableLease | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.owner !== 'string' || !r.owner) return null;
  if (!Number.isFinite(Number(r.acquiredAtMs)) || !Number.isFinite(Number(r.expiresAtMs))) return null;
  return { owner: r.owner, acquiredAtMs: Number(r.acquiredAtMs), expiresAtMs: Number(r.expiresAtMs) };
}
