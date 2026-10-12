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
    lease: null,
  };
}

/** تطبيع دفاعي عند الاسترجاع من التخزين (توافق خلفي مع أي شكل قديم). */
export function normalizeMetaPollingState(raw: any): MetaPollingState {
  const d = defaultMetaPollingState();
  if (!raw || typeof raw !== 'object') return d;
  return {
    controls: normalizeMetaWatcherControls(raw.controls),
    processed: Array.isArray(raw.processed) ? raw.processed.filter((p: any) => p && typeof p === 'object') : [],
    lastPollAt: typeof raw.lastPollAt === 'string' ? raw.lastPollAt : null,
    lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
    consecutiveErrors: Number.isFinite(Number(raw.consecutiveErrors)) ? Math.max(0, Math.trunc(Number(raw.consecutiveErrors))) : 0,
    pollCount: Number.isFinite(Number(raw.pollCount)) ? Math.max(0, Math.trunc(Number(raw.pollCount))) : 0,
    lastScanned: Number.isFinite(Number(raw.lastScanned)) ? Math.max(0, Math.trunc(Number(raw.lastScanned))) : 0,
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
    note: 'حالة عامة فقط؛ تفاصيل التعليقات/الردود متاحة للمالك عبر /api/agent/meta/watcher.',
  };
}
