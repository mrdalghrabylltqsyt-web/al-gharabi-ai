/**
 * مراقب الردود لـ Facebook/Instagram (Meta Reply Watcher).
 *
 * الفجوة التي يُغلقها: تعليقات ورسائل Facebook/Instagram الواردة عبر webhook
 * تُحفظ في `workspace.socialComments`، لكن لم تكن هناك **معالجة تلقائية** لها
 * (رد/تصعيد/تأجيل) كما هو الحال في مراقب YouTube. فتُترك ملقاة بلا قرار حتى
 * يتدخّل المالك يدوياً عبر مسار الرد. هذا المراقب يُكمل الدورة تلقائياً.
 *
 * مبادئ التصميم (توحيد + أمان):
 * - **منطق قرار واحد لكل المنصات**: يستهلك نفس محرّك القرار في `youtubeWatcher.ts`
 *   (`watcherGate` / `decideCommentAction` / `resolveCommentExecution`) — لا سلطة
 *   قرار ثانية. المراقب لا يبتكر منطقاً تجارياً خاصاً به.
 * - **منطق صافٍ قابل للاختبار**: لا شبكة ولا أسرار ولا ساعة. الجلب والإرسال
 *   يتمّان في `server.ts` عبر المنفّذ المركزي (كل بوابات المشروع سارية).
 * - **آمن افتراضياً**: الرد الآلي معطّل حتى يمكّنه المالك صراحةً؛ القراءة/التحليل فقط.
 * - **لا فقدان**: التعليق القابل للرد مع تعطيل الأتمتة يُؤجَّل (غير نهائي) ويُعاد
 *   تقييمه عند التمكين (نفس آلية `releaseDeferredEntries`).
 */

import {
  type YouTubeWatcherControls,
  type WatcherProcessedEntry,
  type CommentDecision,
  type CentralActionDecision,
  normalizeWatcherControls,
  watcherGate,
  decideCommentAction,
  resolveCommentExecution,
  isDeferredDecision,
  releaseDeferredEntries,
  cadenceMinutesToMs,
  WATCHER_DEFAULT_CADENCE_MINUTES,
} from './youtubeWatcher';
import { sanitizePublicErrorMessage } from './healthPrivacy';
import { type DeferralState, normalizeDeferralState, cycleStaleWarning } from '../ops/cycleDeferral';

/** المنصات التي يغطّيها هذا المراقب (لها موصل تعليقات حقيقي + قراءة رسمية). */
export type MetaPlatform = 'facebook' | 'instagram';
export const META_WATCHER_PLATFORMS: readonly MetaPlatform[] = Object.freeze(['facebook', 'instagram']);

/**
 * إحصاءات استقبال لكل منصة — تُغلق «الفشل الصامت»: قراءة `ok` بلا تعليقات
 * بينما الصفحة/الحساب فيه منشورات حديثة كانت تبدو «سليمة» بلا أي مؤشّر.
 *  - `postsScanned`: عدد المنشورات المفحوصة فعلاً في آخر دورة (feed+videos+reels).
 *  - `commentsVisible`: عدد التعليقات المرئية في آخر دورة.
 *  - `lastIngestAt`: آخر وقت استُقبل فيه تعليق/رسالة فعلية (null = لا استقبال).
 */
export interface MetaPlatformIngestStats {
  postsScanned: number;
  commentsVisible: number;
  /**
   * PR-S4: مجموع `comments.summary(total_count)` المُعلَن من Meta لكل منشور مفحوص
   * في آخر سحب — يُقارَن بـ`commentsVisible` فيكشف أي فرق تغطية (ردود متداخلة/
   * تعليقات مخفية/حد صفحات). رقم تقني فقط بلا أي بيانات عميل (توافق خلفي: 0).
   */
  commentsTotalReported: number;
  lastIngestAt: string | null;
  /**
   * عدد نداءات Graph التي استهلكها آخر سحب لهذه المنصة (قراءة التعليقات مضمَّنة
   * داخل الحواف) — يُعلن في حالة المراقب كـ`callsPerCycle` لقياس حجم النداءات
   * والتحقق من الهدف (≤ 4 لفيسبوك). لا يُخفى ولا يُقدَّر.
   */
  callsPerCycle: number;
  /**
   * إصلاح 2026-10-25 — خطأ القراءة **لكل منصة**. كان الخطأ عاماً للمراقب، فنجاح
   * Instagram بعد فشل Facebook في نفس الدورة يمسحه: قراءة تعليقات Facebook فشلت
   * ~6 أيام (خطأ #12، 18→24 أكتوبر) والحالة «healthy». الآن لكل منصة خطؤها وسلسلتها.
   */
  lastError: string | null;
  /** كود تقني قصير لآخر فشل (بلا نص مزوّد) — آمن للعرض العام. */
  lastErrorCode: string | null;
  consecutiveErrors: number;
  /** بداية سلسلة الفشل الحالية (null = القراءة سليمة). */
  failingSince: string | null;
  lastOkAt: string | null;
}

export function defaultMetaPlatformIngestStats(): MetaPlatformIngestStats {
  return { postsScanned: 0, commentsVisible: 0, commentsTotalReported: 0, lastIngestAt: null, callsPerCycle: 0, lastError: null, lastErrorCode: null, consecutiveErrors: 0, failingSince: null, lastOkAt: null };
}

export function normalizeMetaPlatformIngestStats(raw: any): MetaPlatformIngestStats {
  const d = defaultMetaPlatformIngestStats();
  if (!raw || typeof raw !== 'object') return d;
  return {
    postsScanned: Number.isFinite(Number(raw.postsScanned)) ? Math.max(0, Math.trunc(Number(raw.postsScanned))) : 0,
    commentsVisible: Number.isFinite(Number(raw.commentsVisible)) ? Math.max(0, Math.trunc(Number(raw.commentsVisible))) : 0,
    commentsTotalReported: Number.isFinite(Number(raw.commentsTotalReported)) ? Math.max(0, Math.trunc(Number(raw.commentsTotalReported))) : 0,
    lastIngestAt: typeof raw.lastIngestAt === 'string' ? raw.lastIngestAt : null,
    callsPerCycle: Number.isFinite(Number(raw.callsPerCycle)) ? Math.max(0, Math.trunc(Number(raw.callsPerCycle))) : 0,
    lastError: typeof raw.lastError === 'string' ? raw.lastError.slice(0, 300) : null,
    lastErrorCode: typeof raw.lastErrorCode === 'string' ? raw.lastErrorCode.slice(0, 60) : null,
    consecutiveErrors: Number.isFinite(Number(raw.consecutiveErrors)) ? Math.max(0, Math.trunc(Number(raw.consecutiveErrors))) : 0,
    failingSince: typeof raw.failingSince === 'string' ? raw.failingSince : null,
    lastOkAt: typeof raw.lastOkAt === 'string' ? raw.lastOkAt : null,
  };
}

/** بعد هذا العدد من دورات القراءة الفاشلة المتتالية تُعدّ المنصة «لا تستقبل». */
export const META_READ_FAIL_WARN_CYCLES = 3;

/** كود تقني قصير من نتيجة فشل القراءة (ASCII فقط، بلا نص مزوّد). */
export function metaReadErrorCode(fetched: { code?: string | null; providerCode?: number | null }): string {
  const code = String(fetched?.code || 'FETCH_FAILED').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'FETCH_FAILED';
  return fetched?.providerCode != null ? `${code}.${fetched.providerCode}` : code;
}

/**
 * يحدّث إحصاءات منصة واحدة بعد محاولة قراءة: النجاح يصفّر سلسلة الفشل، والفشل
 * يزيدها ويحفظ بدايتها. يعيد أيضاً حدث السجل المطلوب (أول فشل/كل ساعة/تعافٍ) كي
 * لا يُغرق السجل كل 5 دقائق ولا يصمت عن عطل مستمر.
 */
export function applyMetaReadOutcome(
  prevRaw: MetaPlatformIngestStats | undefined,
  outcome: { ok: true; postsScanned: number; commentsVisible: number; commentsTotalReported: number; callsPerCycle: number }
    | { ok: false; error: string; code: string },
  nowIso: string,
  logEveryCycles = 12,
): { stats: MetaPlatformIngestStats; log: 'failed' | 'still_failing' | 'recovered' | null; recoveredAfter: number } {
  const prev = normalizeMetaPlatformIngestStats(prevRaw);
  if (outcome.ok) {
    const recoveredAfter = prev.consecutiveErrors;
    return {
      stats: {
        ...prev,
        postsScanned: outcome.postsScanned, commentsVisible: outcome.commentsVisible,
        commentsTotalReported: outcome.commentsTotalReported, callsPerCycle: outcome.callsPerCycle,
        lastError: null, lastErrorCode: null, consecutiveErrors: 0, failingSince: null, lastOkAt: nowIso,
      },
      log: recoveredAfter > 0 ? 'recovered' : null,
      recoveredAfter,
    };
  }
  const n = prev.consecutiveErrors + 1;
  return {
    stats: { ...prev, lastError: String(outcome.error || 'fetch failed').slice(0, 300), lastErrorCode: outcome.code, consecutiveErrors: n, failingSince: prev.failingSince || nowIso },
    log: n === 1 ? 'failed' : n % Math.max(1, logEveryCycles) === 0 ? 'still_failing' : null,
    recoveredAfter: 0,
  };
}

/**
 * الحقلان العامّان للمراقب (توافق خلفي) يُشتقّان من المنصات لا من آخر منصة قُرئت:
 * أي منصة فاشلة ⇒ خطأ ظاهر بكودها، وأطول سلسلة فشل.
 */
export function aggregateMetaReadErrors(stats: Record<string, MetaPlatformIngestStats>): { lastError: string | null; consecutiveErrors: number } {
  const failing = Object.entries(stats || {}).map(([p, raw]) => [p, normalizeMetaPlatformIngestStats(raw)] as const).filter(([, s]) => s.consecutiveErrors > 0);
  if (!failing.length) return { lastError: null, consecutiveErrors: 0 };
  return {
    // رمز تقني بلا مسافات (يمرّ من منقّي الخطأ العام إن قصر، وإلا «connection error»).
    lastError: failing.map(([p, s]) => `${p}.${s.lastErrorCode || 'FETCH_FAILED'}`).join('-').slice(0, 120),
    consecutiveErrors: Math.max(...failing.map(([, s]) => s.consecutiveErrors)),
  };
}

/** عتبة التحذير: 48 ساعة بلا أي استقبال فعلي مع وجود منشورات حديثة. */
export const META_STALE_INGEST_HOURS = 48;
export const META_STALE_INGEST_MS = META_STALE_INGEST_HOURS * 3600_000;

/**
 * قرار التحذير لكل منصة: إن مرّت 48 ساعة (أو لا استقبال إطلاقاً) **مع** وجود
 * منشورات فُحصت فعلاً، فالقراءة لا تجد تعليقات رغم وجود محتوى ⇒ تحذير صريح
 * بدل الفشل الصامت. المنصة بلا منشورات مفحوصة لا تُنبّه (لا محتوى بعد).
 */
export function metaIngestWarning(stats: MetaPlatformIngestStats, nowMs: number): { stale: boolean; hoursSince: number | null; reason: string } {
  const s = normalizeMetaPlatformIngestStats(stats);
  // القراءة نفسها تفشل ⇒ لا استقبال مهما كانت المنشورات (كان يُخفى بنجاح منصة أخرى).
  if (s.consecutiveErrors >= META_READ_FAIL_WARN_CYCLES) {
    const since = s.failingSince ? Date.parse(s.failingSince) : NaN;
    const h = Number.isFinite(since) ? Math.floor((nowMs - since) / 3600_000) : null;
    return { stale: true, hoursSince: h, reason: `قراءة التعليقات تفشل منذ ${h === null ? s.consecutiveErrors + ' دورة' : h + ' ساعة'} (الكود ${s.lastErrorCode || 'FETCH_FAILED'}) — لا يصل أي تعليق جديد.` };
  }
  if (s.postsScanned <= 0) return { stale: false, hoursSince: null, reason: 'لا منشورات مفحوصة بعد.' };
  if (!s.lastIngestAt) {
    return { stale: true, hoursSince: null, reason: `لا استقبال فعلي إطلاقاً مع وجود ${s.postsScanned} منشوراً مفحوصاً — قد تكون الصلاحية/وضع التطبيق تحجب التعليقات.` };
  }
  const t = Date.parse(s.lastIngestAt);
  if (!Number.isFinite(t)) return { stale: false, hoursSince: null, reason: 'وقت آخر استقبال غير صالح.' };
  const hours = Math.floor((nowMs - t) / 3600_000);
  if (nowMs - t >= META_STALE_INGEST_MS) {
    return { stale: true, hoursSince: hours, reason: `مرّت ${hours} ساعة بلا أي تعليق/رسالة مرئية مع وجود منشورات — تحقّق من صلاحيات القراءة ووضع التطبيق.` };
  }
  return { stale: false, hoursSince: hours, reason: 'الاستقبال حديث.' };
}


/** بنية التحكم مطابقة تماماً لمراقب YouTube (توحيد السلوك والواجهة). */
export type MetaWatcherControls = YouTubeWatcherControls;

export function defaultMetaWatcherControls(): MetaWatcherControls {
  return normalizeWatcherControls({});
}

/** تطبيع دفاعي لأي قيمة محفوظة/قادمة من الواجهة (نفس قواعد YouTube). */
export function normalizeMetaWatcherControls(raw: any): MetaWatcherControls {
  return normalizeWatcherControls(raw);
}

/** حالة المراقب المحفوظة (تصمد بعد restart عبر محوّل الحالة). */
export interface MetaPollingState {
  controls: MetaWatcherControls;
  /** سجل المعالجة (منع المعالجة المزدوجة + checkpoint) — نفس بنية YouTube. */
  processed: WatcherProcessedEntry[];
  lastPollAt: string | null;
  lastError: string | null;
  consecutiveErrors: number;
  pollCount: number;
  lastScanned: number;
  /** إحصاءات الاستقبال لكل منصة (منشورات مفحوصة/تعليقات مرئية/آخر استقبال). */
  platformStats: Record<MetaPlatform, MetaPlatformIngestStats>;
  lease: any;
  /** إصلاح 2026-10-20: تتبّع تأجيل الدورة (deferred/reason/lastDeferredAt) — بلا سرّ. */
  deferral?: DeferralState;
}

export function defaultMetaPollingState(): MetaPollingState {
  return {
    controls: defaultMetaWatcherControls(),
    processed: [],
    lastPollAt: null,
    lastError: null,
    consecutiveErrors: 0,
    pollCount: 0,
    lastScanned: 0,
    platformStats: { facebook: defaultMetaPlatformIngestStats(), instagram: defaultMetaPlatformIngestStats() },
    lease: null,
    deferral: { deferred: false, deferredReason: null, lastDeferredAt: null },
  };
}

/** تطبيع دفاعي عند الاسترجاع من التخزين (توافق خلفي مع أي شكل قديم). */
export function normalizeMetaPollingState(raw: any): MetaPollingState {
  const d = defaultMetaPollingState();
  if (!raw || typeof raw !== 'object') return d;
  const rawStats = raw.platformStats && typeof raw.platformStats === 'object' ? raw.platformStats : {};
  return {
    controls: normalizeMetaWatcherControls(raw.controls),
    processed: Array.isArray(raw.processed) ? raw.processed.filter((p: any) => p && typeof p === 'object') : [],
    lastPollAt: typeof raw.lastPollAt === 'string' ? raw.lastPollAt : null,
    lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
    consecutiveErrors: Number.isFinite(Number(raw.consecutiveErrors)) ? Math.max(0, Math.trunc(Number(raw.consecutiveErrors))) : 0,
    pollCount: Number.isFinite(Number(raw.pollCount)) ? Math.max(0, Math.trunc(Number(raw.pollCount))) : 0,
    lastScanned: Number.isFinite(Number(raw.lastScanned)) ? Math.max(0, Math.trunc(Number(raw.lastScanned))) : 0,
    platformStats: {
      facebook: normalizeMetaPlatformIngestStats(rawStats.facebook),
      instagram: normalizeMetaPlatformIngestStats(rawStats.instagram),
    },
    lease: raw.lease && typeof raw.lease === 'object' ? raw.lease : null,
    deferral: normalizeDeferralState(raw.deferral),
  };
}

/**
 * بوابة الأتمتة للمنصة (نفس دلالات `watcherGate`: Kill Switch يمنع الكل، والرد
 * يحتاج autoReply). لا تُنشئ منطقاً موازياً — تفوّض للمصدر الواحد.
 */
export function metaWatcherGate(controls: MetaWatcherControls, action: 'read' | 'reply') {
  return watcherGate(normalizeMetaWatcherControls(controls), action);
}

/**
 * القرار الاستشاري الحتمي لتعليق/رسالة Meta — نفس منطق YouTube بالضبط (تصنيف
 * حتمي: حساب المعرض/سبام/شكوى/استفسار تجاري/سؤال/مدح). لا قرار تجاري خاص.
 */
export function decideMetaCommentAction(input: {
  intent: string;
  requiresHumanReview: boolean;
  isSpam: boolean;
  isSelfAuthored: boolean;
  alreadyReplied: boolean;
  /** PR-B: هل سبق أن ردّت الصفحة نفسها داخل خيط التعليق؟ ⇒ لا مسودة/رد (SKIP_PAGE_ALREADY_REPLIED). */
  pageAlreadyReplied?: boolean;
  controls: MetaWatcherControls;
}): CommentDecision {
  return decideCommentAction({ ...input, controls: normalizeMetaWatcherControls(input.controls) });
}

/**
 * القرار التنفيذي النهائي لـ Meta (نفس سلطة YouTube الوحيدة): يستهلك قرار العقل
 * المركزي + التصنيف الاستشاري + بوابة الأتمتة + جاهزية الرد. لا تنفيذ هنا.
 */
export function resolveMetaReplyExecution(input: {
  centralDecision: Parameters<typeof resolveCommentExecution>[0]['centralDecision'];
  advisory: CommentDecision;
  automationAllowed: boolean;
  replyReady: boolean;
  belongsToChannel: boolean;
  isPraise: boolean;
  humanReviewMode: boolean;
  centralEscalationReason: string | null;
  priceFactsVerified?: boolean;
}): CommentDecision {
  return resolveCommentExecution(input);
}

export { isDeferredDecision, releaseDeferredEntries };

/**
 * قرار التنفيذ الفعلي لحدث Meta من قرار العقل المركزي الحقيقي + تمكين المالك.
 * يُحلّ عند التنفيذ (لا في القرار المُخزَّن) فلا يثبّت تفويضاً قديماً:
 *  - `ALLOWED_ACTION` => تنفيذ (مثال: مهمة موافَق عليها).
 *  - `APPROVAL_REQUIRED` + تمكين المالك الصريح للرد الآلي => `ALLOWED_ACTION`
 *    (التمكين هو الموافقة — نفس مبدأ تفويض YouTube، لكن لكل منصة تمكينها).
 *  - `APPROVAL_REQUIRED` بلا تمكين => `NO_ACTION` (تأجيل غير نهائي، لا تصعيد:
 *    حالة إعداد تُحرَّر عند التمكين، لا فشل).
 *  - `NO_ACTION` => يبقى (الأتمتة معطّلة؛ قرار العقل نفسه بلا إجراء).
 *  - أي حالة أخرى (بلا قرار / تصعيد / فشل) => `FAILED_SAFE` (لا إرسال).
 * منطق صافٍ: لا يمنح أي تفويض خارجي — التنفيذ يبقى محكوماً ببوابات
 * `executeMetaCommentReply`/`executeMetaMessageReply` (سلامة محتوى + منع تكرار + ...).
 */
export function metaExecutionDecisionFromCentral(central: CentralActionDecision | null, ownerAutoReplyEnabled: boolean): CentralActionDecision {
  if (central === 'ALLOWED_ACTION') return 'ALLOWED_ACTION';
  if (central === 'NO_ACTION') return 'NO_ACTION';
  if (central === 'APPROVAL_REQUIRED') return ownerAutoReplyEnabled ? 'ALLOWED_ACTION' : 'NO_ACTION';
  return 'FAILED_SAFE';
}

/** ملخص عرض التحكم (بلا أي سرّ) — مطابق لبنية عرض مراقب YouTube. */
export function metaPollingControlsView(controls: MetaWatcherControls) {
  const c = normalizeMetaWatcherControls(controls);
  return {
    ...c,
    killSwitchActive: c.paused,
    autoReplyEffective: c.enabled && !c.paused && !c.humanReviewMode && c.autoReply,
    note: 'الرد الآلي لـ Facebook/Instagram آمن افتراضياً: المراقبة قراءة/تحليل فقط حتى يمكّن المالك الرد صراحةً.',
  };
}

/**
 * كتلة الحالة العامة للمراقب: حقول تقنية فقط (بلا اسم/نص عميل). تُستهلك في
 * /api/health و/api/readiness عبر حارس الخصوصية (allow-list) فلا تتسرّب بيانات.
 */
export function metaPollingPublicBlock(state: MetaPollingState) {
  const s = normalizeMetaPollingState(state);
  const nowMs = Date.now();
  // نص خطأ المزوّد الخام (lastError) لا يظهر في الكتلة العامة — الكود التقني فقط.
  const publicStats = (raw: MetaPlatformIngestStats) => { const { lastError: _omit, ...rest } = normalizeMetaPlatformIngestStats(raw); return rest; };
  const platformStats = {
    facebook: publicStats(s.platformStats.facebook),
    instagram: publicStats(s.platformStats.instagram),
  };
  const warnings = META_WATCHER_PLATFORMS.map((platform) => {
    const w = metaIngestWarning(s.platformStats[platform], nowMs);
    return w.stale ? { platform, hoursSince: w.hoursSince, reason: w.reason } : null;
  }).filter(Boolean);
  const deferral = normalizeDeferralState(s.deferral);
  // إصلاح 2026-10-20: كشف «دورة فائتة» (أكثر من دورتين متتاليتين بلا دورة فعلية).
  const stale = cycleStaleWarning(s.lastPollAt, cadenceMinutesToMs(s.controls.cadenceMinutes), nowMs);
  // لا تُعرض healthy وهي مؤجَّلة أو فائتة (كان التأجيل يبدو سليماً).
  const status = s.controls.paused
    ? 'disabled'
    : s.lastError
      ? 'degraded'
      : (deferral.deferred || stale.stale)
        ? 'deferred'
        : 'healthy';
  return {
    status,
    watcherActive: s.controls.enabled && !s.controls.paused,
    cadenceMinutes: s.controls.cadenceMinutes,
    pollCount: s.pollCount,
    lastPollAt: s.lastPollAt,
    // تتبّع التأجيل الصريح (بلا سرّ): هل الدورة مؤجَّلة؟ لماذا؟ ومتى آخر مرة؟
    deferred: deferral.deferred,
    deferredReason: deferral.deferredReason,
    lastDeferredAt: deferral.lastDeferredAt,
    // تحذير «دورة فائتة»: يقع إن مرّ أكثر من دورتين متتاليتين بلا دورة فعلية.
    stale: stale.stale,
    staleReason: stale.reason,
    missedCycles: stale.missedCycles,
    // تنقية المصدر الواحد: رمز تقني ASCII فقط، وأي نص حر (رسالة مزوّد/محادثة)
    // => 'connection error'، فلا يظهر نص خطأ المزوّد الخام في نقطة عامة.
    lastError: sanitizePublicErrorMessage(s.lastError),
    consecutiveErrors: s.consecutiveErrors,
    // مؤشّرات تقنية فقط (أرقام وأوقات) — لا نص عميل ولا اسم. تُغلق الفشل الصامت.
    platformStats,
    staleIngestWarning: warnings.length > 0,
    warnings,
    note: 'حالة عامة فقط؛ تفاصيل التعليقات/الردود متاحة للمالك عبر /api/agent/meta/watcher.',
  };
}
