/**
 * مراقب الردود لـ Telegram (Telegram Reply Watcher) — حلقة الرد الآلي المتبقية.
 *
 * الفجوة التي يُغلقها: رسائل Telegram الواردة عبر webhook تُحفظ في
 * `workspace.socialComments` (kind غير معرّف، مع `replyTarget.chatId`)، لكن لم تكن
 * هناك **معالجة تلقائية** لها (رد/تصعيد/تأجيل) كما هو الحال في مراقب YouTube
 * ومراقب Meta. هذا المراقب يُكمل الدورة تلقائياً.
 *
 * مبادئ التصميم (توحيد + أمان — نفس درس مفتاح إيقاف العقل التجاري):
 * - **منطق قرار واحد لكل المنصات**: يستهلك نفس محرّك القرار في `youtubeWatcher.ts`
 *   (`watcherGate` / `decideCommentAction` / `resolveCommentExecution`) — لا سلطة
 *   قرار ثانية. المراقب لا يبتكر منطقاً خاصاً به.
 * - **منطق صافٍ قابل للاختبار**: لا شبكة ولا أسرار ولا ساعة. الجلب والإرسال
 *   يتمّان في `server.ts` عبر المنفّذ المركزي (كل بوابات المشروع سارية).
 * - **آمن افتراضياً (fail-closed)**: الرد الآلي `autoReply=false` افتراضياً على
 *   إقلاع نظيف بلا أي سجل محفوظ — لا استثناء لـTelegram. الاستقبال/القراءة قد
 *   يبقيان فعّالين، لكن **الرد** لا يقع حتى يفعّله المالك صراحةً.
 * - **لا فقدان**: الرسالة القابلة للرد مع تعطيل الأتمتة تُؤجَّل (غير نهائي) وتُعاد
 *   تقييمها عند التمكين (نفس آلية `releaseDeferredEntries`).
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
} from './youtubeWatcher';
import { sanitizePublicErrorMessage } from './healthPrivacy';

/** المنصات التي يغطّيها هذا المراقب (موصل رد رسائل حقيقي). */
export type TelegramWatcherPlatform = 'telegram';
export const TELEGRAM_WATCHER_PLATFORMS: readonly TelegramWatcherPlatform[] = Object.freeze(['telegram']);

/** بنية التحكم مطابقة تماماً لمراقب YouTube/Meta (توحيد السلوك والواجهة). */
export type TelegramWatcherControls = YouTubeWatcherControls;

export function defaultTelegramWatcherControls(): TelegramWatcherControls {
  // autoReply=false افتراضياً (نفس youtubeWatcher/metaWatcher) — fail-closed.
  return normalizeWatcherControls({});
}

/** تطبيع دفاعي لأي قيمة محفوظة/قادمة من الواجهة (نفس قواعد YouTube). */
export function normalizeTelegramWatcherControls(raw: any): TelegramWatcherControls {
  return normalizeWatcherControls(raw);
}

/** حالة المراقب المحفوظة (تصمد بعد restart عبر محوّل الحالة). */
export interface TelegramPollingState {
  controls: TelegramWatcherControls;
  /** سجل المعالجة (منع المعالجة المزدوجة + checkpoint) — نفس بنية YouTube/Meta. */
  processed: WatcherProcessedEntry[];
  lastPollAt: string | null;
  lastError: string | null;
  consecutiveErrors: number;
  pollCount: number;
  lastScanned: number;
  lease: any;
}

export function defaultTelegramPollingState(): TelegramPollingState {
  return {
    controls: defaultTelegramWatcherControls(),
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
export function normalizeTelegramPollingState(raw: any): TelegramPollingState {
  const d = defaultTelegramPollingState();
  if (!raw || typeof raw !== 'object') return d;
  return {
    controls: normalizeTelegramWatcherControls(raw.controls),
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
 * بوابة الأتمتة لـTelegram (نفس دلالات `watcherGate`: Kill Switch يمنع الكل،
 * والرد يحتاج autoReply). لا تُنشئ منطقاً موازياً — تفوّض للمصدر الواحد.
 */
export function telegramWatcherGate(controls: TelegramWatcherControls, action: 'read' | 'reply') {
  return watcherGate(normalizeTelegramWatcherControls(controls), action);
}

/**
 * القرار الاستشاري الحتمي لرسالة Telegram — نفس منطق YouTube/Meta بالضبط
 * (تصنيف حتمي: حساب المعرض/سبام/شكوى/استفسار تجاري/سؤال/مدح). لا قرار خاص.
 */
export function decideTelegramCommentAction(input: {
  intent: string;
  requiresHumanReview: boolean;
  isSpam: boolean;
  isSelfAuthored: boolean;
  alreadyReplied: boolean;
  controls: TelegramWatcherControls;
}): CommentDecision {
  return decideCommentAction({ ...input, controls: normalizeTelegramWatcherControls(input.controls) });
}

/**
 * القرار التنفيذي النهائي لـTelegram (نفس سلطة YouTube/Meta الوحيدة): يستهلك قرار
 * العقل المركزي + التصنيف الاستشاري + بوابة الأتمتة + جاهزية الرد. لا تنفيذ هنا.
 */
export function resolveTelegramReplyExecution(input: {
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
 * قرار التنفيذ الفعلي لحدث Telegram من قرار العقل المركزي + تمكين المالك.
 *  - `ALLOWED_ACTION` => تنفيذ.
 *  - `APPROVAL_REQUIRED` + تمكين المالك الصريح => `ALLOWED_ACTION` (التمكين موافقة).
 *  - `APPROVAL_REQUIRED` بلا تمكين => `NO_ACTION` (تأجيل غير نهائي، لا تصعيد).
 *  - `NO_ACTION` => يبقى.
 *  - أي حالة أخرى => `FAILED_SAFE` (لا إرسال).
 * منطق صافٍ: لا يمنح أي تفويض خارجي — التنفيذ يبقى محكوماً ببوابات
 * `executeTelegramMessageReply` (سلامة محتوى + منع تكرار + self-authored + ...).
 */
export function telegramExecutionDecisionFromCentral(central: CentralActionDecision | null, ownerAutoReplyEnabled: boolean): CentralActionDecision {
  if (central === 'ALLOWED_ACTION') return 'ALLOWED_ACTION';
  if (central === 'NO_ACTION') return 'NO_ACTION';
  if (central === 'APPROVAL_REQUIRED') return ownerAutoReplyEnabled ? 'ALLOWED_ACTION' : 'NO_ACTION';
  return 'FAILED_SAFE';
}

/** ملخص عرض التحكم (بلا أي سرّ) — مطابق لبنية عرض مراقب YouTube/Meta. */
export function telegramPollingControlsView(controls: TelegramWatcherControls) {
  const c = normalizeTelegramWatcherControls(controls);
  return {
    ...c,
    killSwitchActive: c.paused,
    autoReplyEffective: c.enabled && !c.paused && !c.humanReviewMode && c.autoReply,
    note: 'الرد الآلي لـ Telegram آمن افتراضياً (fail-closed): المراقبة قراءة/تحليل فقط حتى يمكّن المالك الرد صراحةً.',
  };
}

/**
 * كتلة الحالة العامة للمراقب: حقول تقنية فقط (بلا اسم/نص عميل). تُستهلك في
 * /api/health و/api/readiness عبر حارس الخصوصية (allow-list) فلا تتسرّب بيانات.
 */
export function telegramPollingPublicBlock(state: TelegramPollingState) {
  const s = normalizeTelegramPollingState(state);
  return {
    status: s.controls.paused ? 'disabled' : (s.lastError ? 'degraded' : 'healthy'),
    watcherActive: s.controls.enabled && !s.controls.paused,
    cadenceMinutes: s.controls.cadenceMinutes,
    pollCount: s.pollCount,
    lastPollAt: s.lastPollAt,
    // تنقية المصدر الواحد: رمز تقني ASCII فقط، وأي نص حر => 'connection error'.
    lastError: sanitizePublicErrorMessage(s.lastError),
    consecutiveErrors: s.consecutiveErrors,
    note: 'حالة عامة فقط؛ تفاصيل الرسائل/الردود متاحة للمالك عبر /api/agent/telegram/watcher.',
  };
}
