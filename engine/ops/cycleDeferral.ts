/**
 * تتبّع تأجيل الدورات + كشف الدورات الفائتة (منطق صافٍ، بلا شبكة/أسرار/ساعة حقيقية).
 *
 * الفجوة التي يُغلقها: كان حارس ضغط الاستهلاك يُؤجّل دورات الاستقبال **بصمت**،
 * فيبدو /api/health «healthy» رغم توقّف الاستقبال ~32 ساعة. الآن كل تأجيل يُسجَّل
 * صراحةً في حالة المراقب (`deferred` + سبب + آخر وقت)، وأي دورة تأخّرت أكثر من
 * دورتين متتاليتين تُعلَن كتحذير صريح بدل الصمت.
 *
 * هذا الملف لا يعرف أي مراقب: يستقبل/يعيد حقولاً مجرّدة، فيُستهلك من YouTube/Meta/
 * Telegram/Brain runtime بنفس المنطق — مصدر واحد بلا انحراف.
 */

/** الحقول الثلاثة الملزمة في حالة كل مراقب (تصمد بعد restart). */
export interface DeferralState {
  /** هل الدورة الأخيرة أُجِّلت (بسبب ضغط الاستهلاك أو أي مانع آخر)؟ */
  deferred: boolean;
  /** سبب التأجيل الصريح (بلا سرّ) أو null. */
  deferredReason: string | null;
  /** آخر وقت أُجِّلت فيه دورة (ISO) أو null. */
  lastDeferredAt: string | null;
}

export function emptyDeferralState(): DeferralState {
  return { deferred: false, deferredReason: null, lastDeferredAt: null };
}

/** تطبيع دفاعي لأي شكل محفوظ (توافق خلفي: غياب الحقول = لا تأجيل). */
export function normalizeDeferralState(raw: any): DeferralState {
  const d = emptyDeferralState();
  if (!raw || typeof raw !== 'object') return d;
  return {
    deferred: raw.deferred === true,
    deferredReason: typeof raw.deferredReason === 'string' && raw.deferredReason.trim() ? raw.deferredReason.slice(0, 200) : null,
    lastDeferredAt: typeof raw.lastDeferredAt === 'string' ? raw.lastDeferredAt : null,
  };
}

/** يسجّل تأجيل دورة (سبب + وقت). لا يُسقط أي شيء — يضيف فقط. */
export function markCycleDeferred(state: DeferralState, reason: string, atIso: string): DeferralState {
  return { deferred: true, deferredReason: String(reason || 'deferred').slice(0, 200), lastDeferredAt: atIso };
}

/** يمسح علم التأجيل بعد دورة ناجحة فعلية (يبقي آخر وقت تأجيل للتوثيق). */
export function clearCycleDeferral(state: DeferralState): DeferralState {
  return { deferred: false, deferredReason: null, lastDeferredAt: state.lastDeferredAt };
}

/** عدد الدورات الفائتة منذ آخر دورة فعلية (0 = لا فوات). */
export function cycleMissedCount(lastRunAtIso: string | null | undefined, cadenceMs: number, nowMs: number): number {
  if (!lastRunAtIso) return 0;
  const t = Date.parse(String(lastRunAtIso));
  if (!Number.isFinite(t) || !Number.isFinite(nowMs) || !(cadenceMs > 0)) return 0;
  const elapsed = nowMs - t;
  if (elapsed <= cadenceMs) return 0;
  return Math.floor(elapsed / cadenceMs);
}

/**
 * تحذير «دورة فائتة»: يقع إن مرّ على آخر دورة فعلية **أكثر من دورتين متتاليتين**
 * (الافتراضي `missedThreshold = 2`). يعيد سبباً صريحاً وعدد الدورات الفائتة —
 * فيظهر التأجيل/التوقّف في الصحة بدل أن يبدو النظام «healthy» وهو متوقّف.
 */
export function cycleStaleWarning(
  lastRunAtIso: string | null | undefined,
  cadenceMs: number,
  nowMs: number,
  missedThreshold = 2,
): { stale: boolean; missedCycles: number; hoursSince: number | null; reason: string | null } {
  if (!lastRunAtIso) return { stale: false, missedCycles: 0, hoursSince: null, reason: null };
  const t = Date.parse(String(lastRunAtIso));
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return { stale: false, missedCycles: 0, hoursSince: null, reason: null };
  const missed = cycleMissedCount(lastRunAtIso, cadenceMs, nowMs);
  const hoursSince = Math.max(0, Math.round(((nowMs - t) / 3_600_000) * 10) / 10);
  if (missed > missedThreshold) {
    return { stale: true, missedCycles: missed, hoursSince, reason: `لم تُنفَّذ أي دورة منذ ${hoursSince} ساعة (فائتة ~${missed} دورات).` };
  }
  return { stale: false, missedCycles: missed, hoursSince, reason: null };
}
