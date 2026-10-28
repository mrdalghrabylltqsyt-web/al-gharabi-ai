/**
 * حارس الرموز — تجديد استباقي لكل رموز المنصات قبل انتهائها (2026-10-28).
 *
 * السبب الجذري الذي كشفه المالك («رمز تيك توك ينتهي بعد 13 ساعة — أعد الربط»):
 *   - التجديد كان «كسولاً»: لا يُجدَّد الرمز إلا حين تحتاجه عملية وقد انتهى فعلاً؛ فإن لم تمرّ
 *     عملية، أو فشل التجديد لحظتها، انقطعت المنصة.
 *   - Threads أسوأ: رمزه الطويل (60 يوماً) لا يُجدَّد إلا *قبل* انتهائه، والكود كان يحاول بعده
 *     فيفشل دائماً ⇒ إعادة ربط يدوية كل شهرين.
 *   - فشل عابر واحد (شبكة/ضغط) في تجديد TikTok كان يقطع الربط (`reauth_needed`) فوراً.
 *   - التوقعات كانت تعامل كل رمز غير يوتيوب كأنه «يحتاج المالك»، فتطلب منه إعادة ربط رمز
 *     يُجدَّد آلياً بطبيعته (TikTok 24 ساعة بتصميم TikTok مع refresh token لسنة).
 *
 * هنا منطق صافٍ مختبر: لكل منصة نوع تجديدها، ومتى يُجدَّد رمزها، ومتى (فقط) يحتاج المالك.
 * لا شبكة ولا أسرار.
 */

export type RenewalKind =
  /** رمز قصير + refresh token (TikTok/YouTube/Google Business): يُجدَّد آلياً بلا حد. */
  | 'refresh_token'
  /** رمز طويل يُمدَّد بنفسه قبل انتهائه فقط (Threads 60 يوماً). */
  | 'extend_before_expiry'
  /** رمز صفحة دائم مشتق من رمز مستخدم طويل (Facebook/Instagram): لا ينتهي بالزمن. */
  | 'permanent_page_token'
  /** رمز ثابت لا ينتهي (بوت Telegram، رمز نظام WhatsApp). */
  | 'static'
  /** لا موصل/لا رمز. */
  | 'none';

export interface TokenState {
  id: string;
  label: string;
  /** حالة الربط المحفوظة (connected / reauth_needed / …). */
  status: string | null;
  renewal: RenewalKind;
  hasToken: boolean;
  hasRefreshToken: boolean;
  /** بيانات تطبيق المزوّد (client id/secret) موجودة — بدونها لا تجديد. */
  appConfigured: boolean;
  accessExpiresAt: number | null;
  /** انتهاء refresh token نفسه (TikTok سنة). */
  refreshExpiresAt: number | null;
  /** آخر إصدار للرمز (Threads لا يقبل تمديد رمز عمره أقل من 24 ساعة). */
  issuedAt: number | null;
  /** إخفاقات تجديد متتالية وآخر رمز خطأ. */
  failures: number;
  lastErrorCode: string | null;
  lastAttemptAt: number | null;
}

const MIN = 60000;
const H = 60 * MIN;
const D = 24 * H;

export const TOKEN_KEEPER_POLICY = Object.freeze({
  intervalMs: 15 * MIN,
  firstRunAfterBootMs: 3 * MIN,
  /** هامش التجديد قبل الانتهاء لكل منصة — دائماً أكبر من دورة الحارس بمرتين على الأقل. */
  leadMs: Object.freeze({
    tiktok: 4 * H, // رمز 24 ساعة: يُجدَّد عند بقاء 4 ساعات (يبقى صالحاً حتى لو فاتت دورات)
    youtube: 35 * MIN, // رمز Google ساعة واحدة
    google_business: 35 * MIN,
    threads: 20 * D, // رمز 60 يوماً: يُمدَّد عند بقاء 20 يوماً — قبل الانتهاء بوقت طويل
  } as Record<string, number>),
  defaultLeadMs: 2 * H,
  /** Threads: لا يُمدَّد رمز عمره أقل من هذا (شرط Meta). */
  threadsMinAgeMs: 24 * H + 5 * MIN,
  /** بعد فشل عابر: انتظار متزايد قبل المحاولة التالية (لا إغراق للمزوّد). */
  backoffBaseMs: 5 * MIN,
  backoffMaxMs: 2 * H,
  /** فشل عابر يُعامل انقطاعاً فقط بعد هذا العدد المتتالي *وبعد* انتهاء الرمز فعلاً. */
  transientLimit: 6,
  /** refresh token نفسه ينتهي: إنذار المالك قبل هذا (TikTok سنة — إعادة ربط سنوية). */
  refreshTokenWarnMs: 21 * D,
  refreshTokenCriticalMs: 5 * D,
});

/** أخطاء تجديد دائمة: الرمز أُبطل أو التطبيق رُفض — لا فائدة من التكرار، يلزم المالك. */
const PERMANENT_CODES = new Set([
  'invalid_grant', 'invalid_client', 'unauthorized_client', 'invalid_request',
  'access_token_invalid', 'refresh_token_invalid', 'credentials_missing',
  'TOKEN_EXPIRED', 'TOKEN_INVALID', 'OAUTH_EXCEPTION', 'PERMISSION_DENIED',
]);

export function isPermanentRefreshError(code: string | null | undefined): boolean {
  if (!code) return false; // بلا رمز = رد غير مفهوم/5xx/شبكة ⇒ عابر
  return PERMANENT_CODES.has(String(code));
}

export function leadFor(id: string): number {
  return TOKEN_KEEPER_POLICY.leadMs[id] ?? TOKEN_KEEPER_POLICY.defaultLeadMs;
}

/** هل يُجدَّد هذا الرمز آلياً (فلا يُطلب من المالك شيء ما دام الحارس يعمل)؟ */
export function autoRenewable(s: Pick<TokenState, 'renewal' | 'hasRefreshToken' | 'appConfigured' | 'accessExpiresAt'>, nowMs: number): boolean {
  if (s.renewal === 'static' || s.renewal === 'permanent_page_token') return true;
  if (s.renewal === 'refresh_token') return s.hasRefreshToken && s.appConfigured;
  // Threads: قابل للتمديد ما دام لم ينتهِ بعد.
  if (s.renewal === 'extend_before_expiry') return s.accessExpiresAt == null || s.accessExpiresAt > nowMs;
  return false;
}

export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(TOKEN_KEEPER_POLICY.backoffMaxMs, TOKEN_KEEPER_POLICY.backoffBaseMs * 2 ** (failures - 1));
}

export type RenewalDecision =
  | { id: string; action: 'refresh'; reason: string }
  | { id: string; action: 'wait'; reason: string }
  | { id: string; action: 'ok'; reason: string }
  | { id: string; action: 'owner'; reason: string }
  | { id: string; action: 'skip'; reason: string };

/** قرار الحارس لمنصة واحدة الآن. */
export function decideRenewal(s: TokenState, nowMs: number): RenewalDecision {
  const id = s.id;
  if (!s.hasToken || s.renewal === 'none') return { id, action: 'skip', reason: 'غير مربوطة' };
  if (s.renewal === 'static') return { id, action: 'ok', reason: 'رمز ثابت لا ينتهي' };
  if (s.renewal === 'permanent_page_token') return { id, action: 'ok', reason: 'رمز صفحة دائم (لا ينتهي بالزمن)' };
  if (s.renewal === 'refresh_token' && !s.hasRefreshToken) return { id, action: 'owner', reason: 'لا refresh token محفوظ — يلزم ربط واحد جديد' };
  if (s.renewal === 'refresh_token' && !s.appConfigured) return { id, action: 'owner', reason: 'بيانات تطبيق المزوّد (client id/secret) غير مضبوطة على الخادم' };
  if (s.lastErrorCode && isPermanentRefreshError(s.lastErrorCode) && s.failures > 0) return { id, action: 'owner', reason: `المزوّد رفض التجديد نهائياً (${s.lastErrorCode})` };
  if (s.renewal === 'extend_before_expiry' && s.accessExpiresAt != null && s.accessExpiresAt <= nowMs) return { id, action: 'owner', reason: 'انتهى الرمز قبل تمديده — Threads لا يمدّد رمزاً منتهياً' };
  if (s.renewal === 'refresh_token' && s.refreshExpiresAt != null && s.refreshExpiresAt <= nowMs) return { id, action: 'owner', reason: 'انتهى refresh token نفسه — يلزم ربط واحد جديد' };

  const exp = s.accessExpiresAt;
  // رمز بلا تاريخ انتهاء معلن (ربط قديم): نجدّده مرة لنعرف تاريخه (refresh_token فقط؛ Threads قد يرفض).
  const remaining = exp == null ? (s.renewal === 'refresh_token' ? 0 : Infinity) : exp - nowMs;
  if (remaining > leadFor(id)) return { id, action: 'ok', reason: 'صالح وبعيد عن الانتهاء' };
  if (s.renewal === 'extend_before_expiry' && s.issuedAt != null && nowMs - s.issuedAt < TOKEN_KEEPER_POLICY.threadsMinAgeMs) {
    return { id, action: 'wait', reason: 'عمر الرمز أقل من 24 ساعة (شرط المزوّد للتمديد)' };
  }
  if (s.failures > 0 && s.lastAttemptAt != null && nowMs - s.lastAttemptAt < backoffMs(s.failures)) {
    // الرمز أوشك أن ينتهي: لا ننتظر الـbackoff الطويل إن بقي أقل من 10 دقائق.
    if (remaining > 10 * MIN) return { id, action: 'wait', reason: `انتظار بعد ${s.failures} إخفاق عابر` };
  }
  return { id, action: 'refresh', reason: exp == null ? 'تاريخ الانتهاء غير معروف — تجديد لتثبيته' : remaining <= 0 ? 'منتهٍ — تجديد فوري' : `يتبقى ${fmtDur(remaining)} — تجديد استباقي` };
}

/** بعد فشل تجديد: هل يُعلن الانقطاع (reauth_needed) الآن؟ العابر لا يقطع الربط ما دام الرمز صالحاً. */
export function shouldMarkReauth(code: string | null | undefined, consecutiveFailures: number, accessExpiresAt: number | null, nowMs: number): boolean {
  if (isPermanentRefreshError(code)) return true;
  const expired = accessExpiresAt != null && accessExpiresAt <= nowMs;
  return expired && consecutiveFailures >= TOKEN_KEEPER_POLICY.transientLimit;
}

export interface OwnerTokenNeed {
  id: string;
  severity: 'critical' | 'warning';
  etaHours: number;
  title: string;
  detail: string;
  action: string;
}

/**
 * ما يحتاج المالك فعلاً — لا غير:
 *   - refresh token نفسه يقترب من انتهائه (TikTok: ربط واحد في السنة)،
 *   - رفض دائم من المزوّد / لا refresh token / رمز Threads انتهى،
 *   - رمز لا يُجدَّد آلياً بطبيعته يقترب من انتهائه.
 * رمز يُجدَّد آلياً وقريب من انتهائه **ليس** حاجة للمالك: هذا عمل الحارس.
 */
export function ownerTokenNeeds(states: TokenState[], nowMs: number): OwnerTokenNeed[] {
  const out: OwnerTokenNeed[] = [];
  for (const s of states) {
    if (!s.hasToken || s.renewal === 'none' || s.renewal === 'static' || s.renewal === 'permanent_page_token') continue;
    const d = decideRenewal(s, nowMs);
    if (d.action === 'owner') {
      out.push({ id: `token:${s.id}`, severity: 'critical', etaHours: 0, title: `ربط ${s.label} يحتاجك: ${d.reason}`, detail: 'حاول المهندس التجديد آلياً ولم يقبله المزوّد؛ لا يُحل بالانتظار.', action: `أعد ربط ${s.label} من «مركز ربط المنصات» مرة واحدة، وبعدها يتولى المهندس التجديد.` });
      continue;
    }
    if (s.renewal === 'refresh_token' && s.refreshExpiresAt != null) {
      const left = s.refreshExpiresAt - nowMs;
      if (left <= TOKEN_KEEPER_POLICY.refreshTokenWarnMs) {
        out.push({ id: `token-refresh:${s.id}`, severity: left <= TOKEN_KEEPER_POLICY.refreshTokenCriticalMs ? 'critical' : 'warning', etaHours: Math.max(0, left / H), title: `إذن ${s.label} السنوي ينتهي بعد ${fmtDur(left)}`, detail: `رمز الوصول يُجدَّد آلياً، لكن إذن التجديد نفسه (refresh token) له عمر يحدده ${s.label} ولا يُمدَّد إلا بربط جديد.`, action: `أعد ربط ${s.label} مرة واحدة قبل الموعد؛ يبدأ بعدها عام جديد من التجديد الآلي.` });
      }
    }
  }
  return out;
}

export interface KeeperRun { id: string; label: string; at: string; outcome: 'renewed' | 'failed' | 'waiting' | 'owner'; detail: string; newExpiresAt: string | null }

export function keeperSummary(states: TokenState[], nowMs: number): { managed: number; healthy: number; owner: number; nextRenewal: { id: string; at: string } | null } {
  let managed = 0; let healthy = 0; let owner = 0; let next: { id: string; ms: number } | null = null;
  for (const s of states) {
    if (!s.hasToken || s.renewal === 'none') continue;
    managed++;
    const d = decideRenewal(s, nowMs);
    if (d.action === 'owner') owner++; else healthy++;
    if (d.action !== 'owner' && s.accessExpiresAt != null && (s.renewal === 'refresh_token' || s.renewal === 'extend_before_expiry')) {
      const due = s.accessExpiresAt - leadFor(s.id);
      if (!next || due < next.ms) next = { id: s.id, ms: due };
    }
  }
  return { managed, healthy, owner, nextRenewal: next ? { id: next.id, at: new Date(Math.max(nowMs, next.ms)).toISOString() } : null };
}

export function fmtDur(ms: number): string {
  const h = ms / H;
  if (h < 1) return `${Math.max(1, Math.round(ms / MIN))} دقيقة`;
  if (h < 48) return `${Math.round(h)} ساعة`;
  return `${Math.round(h / 24)} يوماً`;
}
