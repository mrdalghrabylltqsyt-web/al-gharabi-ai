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
  WATCHER_DEFAULT_CADENCE_MINUTES,
} from './youtubeWatcher';
import { sanitizePublicErrorMessage } from './healthPrivacy';

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
}

export function defaultMetaPlatformIngestStats(): MetaPlatformIngestStats {
  return { postsScanned: 0, commentsVisible: 0, commentsTotalReported: 0, lastIngestAt: null, callsPerCycle: 0 };
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
  const platformStats = {
    facebook: normalizeMetaPlatformIngestStats(s.platformStats.facebook),
    instagram: normalizeMetaPlatformIngestStats(s.platformStats.instagram),
  };
  const warnings = META_WATCHER_PLATFORMS.map((platform) => {
    const w = metaIngestWarning(platformStats[platform], nowMs);
    return w.stale ? { platform, hoursSince: w.hoursSince, reason: w.reason } : null;
  }).filter(Boolean);
  return {
    status: s.controls.paused ? 'disabled' : (s.lastError ? 'degraded' : 'healthy'),
    watcherActive: s.controls.enabled && !s.controls.paused,
    cadenceMinutes: s.controls.cadenceMinutes,
    pollCount: s.pollCount,
    lastPollAt: s.lastPollAt,
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
