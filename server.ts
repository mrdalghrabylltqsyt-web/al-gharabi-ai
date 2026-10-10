import express from "express";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import dotenv from "dotenv";
import { AiEngine, type AiUsageGuard } from "./engine/ai/engine";
import { createGeminiProvider } from "./engine/ai/provider";
import { resolveModelCandidates, describeModelPolicy, PRODUCTION_MODEL } from "./engine/ai/models";
import { classifyAiError, diagnosticLabel, type AiErrorInfo } from "./engine/ai/errors";
import { CircuitBreaker } from "./engine/ai/retry";
import {
  AiUsageLedger,
  buildUsageDiagnostics,
  normalizePlatformLabel,
  KNOWN_AI_PLATFORMS,
  DEFAULT_MAX_PROMPT_CHARS,
  DEFAULT_MAX_OUTPUT_TOKENS,
} from "./engine/ai/firewall";
import {
  resolveGeminiDailyLimit,
  inspectGeminiLimit,
  GEMINI_LIMIT_DEFAULT,
  GEMINI_LIMIT_MAX_SAFE,
} from "./engine/ai/quotaPolicy";
import { registerSocialManagerRoutes } from "./engine/social/routes";
import { AgentOrchestrator } from "./engine/agent/orchestrator";
import { registerAgentRoutes } from "./engine/agent/routes";
import { registerBrainRoutes } from "./engine/brain/routes";
import { registerTeamRoutes } from "./engine/brain/team/routes";
import { registerCognitionRoutes } from "./engine/brain/cognition/routes";
import { buildCognitiveCycle, type CognitiveReport } from "./engine/brain/cognition/cognitiveLoop";
import {
  makeOutcomeObservation, buildLearningOutcome, learningToMemoryEntries,
} from "./engine/brain/cognition/outcomeLearning";
import {
  emptyWorkingMemory, normalizeWorkingMemory, touchWorkingMemory, summarizeWorkingMemory,
  type WorkingMemoryState,
} from "./engine/brain/cognition/workingMemory";
import {
  runTeamSession,
  upsertTeamSession,
  teamSessionToMemoryRecords,
  summarizeTeamState,
  type TeamRunOptions,
} from "./engine/brain/team/orchestrator";
import { emptyTeamSessionState, type TeamSessionState, type TeamSession } from "./engine/brain/team/types";
import { composeBrainDecision, summarizeBrainDecision, type BrainDecision, type BrainDecisionStatus } from "./engine/brain/team/brainDecision";
import {
  emptyStrategyState, normalizeStrategyState, updateStrategyState, toStrategySnapshot,
  summarizeStrategyState, type StrategyState,
} from "./engine/brain/strategyState";
import {
  emptyDecisionLedger, normalizeDecisionLedger, recordDecision, attachOutcome,
  summarizeDecisionLedger, type DecisionLedger, type LedgerOutcomeKind,
} from "./engine/brain/cognition/decisionLedger";
import {
  centralBrainAuthorityContract, CENTRAL_BRAIN_CAPABILITIES, CENTRAL_BRAIN_CAPABILITY_LABELS_AR,
  ADVISOR_AGENT_IDS, CENTRAL_BRAIN_ID, CENTRAL_BRAIN_LABEL_AR,
} from "./engine/brain/consolidation";
import type { CognitiveBrainContext } from "./engine/brain/cognition/cognitiveLoop";
import { escalateBrainDecision, type BrainEscalationHook } from "./engine/brain/team/brainEscalation";
import { evaluateSixAgentAction, isAllowedSixAgentAction, SIX_AGENT_ALLOWED_ACTIONS, type StoredReplyPattern } from "./engine/brain/team/executionPolicy";
import { executeSixAgentAction, type DeterministicActionDeps } from "./engine/brain/team/deterministicActions";
import { emptySixAgentAudit, recordSixAgentAudit, summarizeSixAgentAudit, normalizeSixAgentAudit, type SixAgentAuditState } from "./engine/brain/team/auditLog";
import { isEscalationOpen, escalationReasonFor, type EscalationReason, type EscalationRecord } from "./engine/social/escalation";
import { classifyConversation } from "./engine/brain/audience/conversationIntelligence";
import { capabilityRow } from "./engine/brain/strategy/capabilityMatrix";
import { registerDriveRoutes } from "./engine/dr/routes";
import { inspectDriveAuthEnv, createRefreshTokenProvider } from "./tools/dr/drive-auth.mjs";
import { DriveClient, createGaxiosTransport } from "./tools/dr/drive-client.mjs";
import { settleWithTimeout, envTimeoutMs, DRIVE_PUBLIC_HOST_TIMEOUT_MS } from "./tools/dr/drive-timeouts.mjs";
import { publishVideoPublicly } from "./engine/social/videoPublicHosting";
import { classifyHttpError, shouldExposeErrorMessage, safeErrorMessage, redactSecretsFromText } from "./engine/runtime/errorSafety";
import { enforceRateWindowCap, RATE_WINDOW_TTL_MS } from "./engine/runtime/rateWindow";
import { computeLiveDatabaseFingerprint } from "./engine/dr/dbBalance";
import { buildSecretsBundle } from "./tools/dr/secret-crypto.mjs";
import { buildRecoveryInformation, buildRecoveryInstructions } from "./tools/dr/cloud-lib.mjs";
import { collectTrustedSourceTree } from "./tools/dr/cloud-sync.mjs";
import { buildCentralBrainState, brainDiagnostics } from "./engine/brain/state";
import { capabilityMatrix } from "./engine/brain/strategy/capabilityMatrix";
import { defineGoal } from "./engine/brain/goals/goalEngine";
import { emptyBrainMemory, upsertMemoryRecord, summarizeBrainMemory, toMemoryRecord, type BrainMemoryStoreState, type BrainMemoryRecord } from "./engine/brain/memory/store";
import { buildRuntimeBrain, decisionHistoryToMemoryRecords, type RuntimeBrainInput, type RuntimeComment, type RuntimeReply, type RuntimePublish, type RuntimeWatcherEntry, type RuntimeConnection, type RuntimeVerifiedFact, type RuntimeDecisionContext, type StrategyStateSummary, buildRuntimeDecisionContext } from "./engine/brain/runtime";
import {
  runBrainRuntimeCycle,
  buildBrainRuntimeStatus,
  normalizeBrainRuntimeState,
  emptyBrainRuntimeState,
  resolveBrainRuntimeEnabled,
  resolveBrainRuntimeIntervalMs,
  resolveBrainLockTtlMs,
  isBrainRuntimeDue,
  BRAIN_RUNTIME_TICK_MS,
  type BrainRuntimeState,
} from "./engine/brain/brainRuntime";
import { toCentralBrainSnapshot } from "./engine/brain/compat";
import type { AgentOperator } from "./engine/agent/permissions";
import type { AgentToolContext } from "./engine/agent/tools";
import { AGENT_TOOLS } from "./engine/agent/tools";
import { describeProviders } from "./engine/agent/providerRouter";
import { PLATFORM_SPECS, platformSupports, hasRealConnector, credentialModeOf, isSupportedPlatform, buildAdapters } from "./engine/social/registry";
import { buildYouTubeSalesCorrelation } from "./engine/social/youtubeSalesCorrelation";
import { sanitizePublicHealthPayload, findForbiddenPublicKeys, findDisallowedWatcherPublicKeys } from "./engine/social/healthPrivacy";
import {
  validatePlatformText,
  shortenToPlatformLimit,
  countForPlatform,
  platformTextLimit,
  PLATFORM_TEXT_LIMITS,
} from "./engine/social/textLimits";
import type { PlatformId } from "./engine/social/adapter";
import { fetchPostMetrics } from "./engine/social/analytics";
import {
  TelegramClient,
  parseTelegramUpdate,
  verifyTelegramSecret,
  telegramExternalId,
  isDuplicateUpdate,
  TELEGRAM_SECRET_HEADER,
  constantTimeEqual,
  checkWebhookRegistration,
  type TelegramFetch,
} from "./engine/social/telegram";
import {
  FacebookClient,
  parseFacebookWebhook,
  facebookGraphUrl,
  isPlausibleMetaAppId,
  classifyMetaDialogInteraction,
  classifyMetaDialogChain,
  FACEBOOK_MOBILE_UA,
  safeUrlHost,
  safeUrlPath,
  isMetaMobileHost,
  FACEBOOK_REQUIRED_SCOPES,
  resolveFacebookScopes,
  missingScopeDependenciesFromCsv,
  FACEBOOK_DIALOG_PATH,
  FACEBOOK_SIGNATURE_HEADER,
  interpretPostGrounding,
  type FacebookFetch,
  type FacebookPageIdentity,
} from "./engine/social/facebook";
import {
  InstagramClient,
  parseInstagramWebhook,
  INSTAGRAM_REQUIRED_SCOPES,
  INSTAGRAM_SIGNATURE_HEADER,
  INSTAGRAM_SUBSCRIBED_FIELDS_DEFAULT,
  INSTAGRAM_PROFESSIONAL_ACCOUNT_TYPES,
  INSTAGRAM_CONTAINER_READY_STATES,
  INSTAGRAM_CONTAINER_FAILED_STATES,
  isInstagramContainerReady,
  isInstagramContainerFailed,
  resolveInstagramScopes,
  missingInstagramScopeDependenciesFromCsv,
  type InstagramFetch,
  type InstagramLinkedPage,
} from "./engine/social/instagram";
import {
  ThreadsClient,
  THREADS_CONTAINER_READY_STATES,
  THREADS_CONTAINER_FAILED_STATES,
  isThreadsContainerReady,
  isThreadsContainerFailed,
  type ThreadsFetch,
} from "./engine/social/threads";
import {
  TikTokClient,
  TIKTOK_CAPABILITY_MATRIX,
  TIKTOK_REQUIRED_SCOPES,
  TIKTOK_SIGNATURE_HEADER,
  TIKTOK_WEBHOOK_EVENTS,
  TIKTOK_PRIVACY_LEVELS,
  resolveTikTokScopes,
  parseTikTokWebhook,
  verifyTikTokSignature,
  buildVideoPostBody,
  buildVideoDraftBody,
  buildPhotoPostBody,
  isPlausibleTikTokClientKey,
  clientKeyFingerprint,
  maskSecretValue,
  classifyTikTokClientKeyError,
  tiktokCapabilityStatus,
  tiktokCapabilityNeedsAudit,
  TIKTOK_OPEN_API_BASE,
  TIKTOK_TOKEN_PATH,
  TIKTOK_REVOKE_PATH,
  TIKTOK_WEB_PKCE_SUPPORTED,
  TIKTOK_WEB_AUTHORIZATION_PARAMS,
  type TikTokFetch,
  type TikTokPostMode,
  type TikTokPrivacyLevel,
  shouldReconcileTikTokRecord,
  applyTikTokPublishStatus,
} from "./engine/social/tiktok";
import {
  resolveTikTokState,
  TIKTOK_TRUTHFUL_STATES,
  TIKTOK_STATE_LABELS_AR,
  TIKTOK_STATE_TONES,
  type TikTokTruthfulState,
} from "./engine/social/tiktokState";
import {
  createOAuthState,
  createPkcePair,
  requiresPkce,
  validateOAuthCallback,
  buildAuthorizationParams,
  buildTokenExchangeBody,
  parseTokenResponse,
  formatOAuthProviderError,
  isAccessTokenExpired,
  inspectLoginConfigId,
  resolveLoginConfigId,
  isPlausibleLoginConfigId,
  LOGIN_CONFIG_ENV_NAMES,
  OAUTH_STATE_TTL_MS,
  INSTAGRAM_ONBOARDING_EXTRAS,
  parseInstagramTokenFragment,
} from "./engine/social/oauth";
import { PLATFORM_READINESS, readinessFor, readinessSummary } from "./engine/social/readiness";
import { buildReadinessDetails, computeAllPlatformStatuses, computePlatformStatus, controlSummary, type LiveConnection } from "./engine/social/operations";
import { inspectPlatformCredentials, CREDENTIAL_SPECS, GLOBAL_CREDENTIALS } from "./engine/social/credentials";
import { decodeTokenKey, inspectTokenKeyFromEnv } from "./engine/social/tokenKey";
import { resolvePublicUrl, isLocalHost } from "./engine/social/publicUrl";
import { canSetContentStatusByRole, canEditContent } from "./engine/social/contentStatusPolicy";
import {
  siteVerificationFiles,
  verificationFileForPath,
  isVerificationFileRequest,
  effectiveVerificationFile,
  SITE_VERIFICATION_PATH_PATTERN,
  TIKTOK_VERIFICATION_TOKEN_ENV_NAME,
  VERIFICATION_CONTENT_TYPE,
  verificationFileUrl,
  captureVerificationRequest,
  type SiteVerificationFile,
  type VerificationRequestSnapshot,
} from "./engine/social/siteVerification";
import { legalPageForPath } from "./engine/social/legalPages";
import {
  secretHeaderVerifier,
  hmacSignatureVerifier,
  isReplayOrDuplicate,
  isValidWebhookPayload,
  buildNormalizedEvent,
  type WebhookVerifier,
  type NormalizedSocialEvent,
} from "./engine/social/webhook";
import {
  buildDeterministicReply,
  canAutoReply,
  classifyComment,
  evaluateReplyGuard,
  fingerprintReply,
  isSelfAuthored,
  type ReplyFactSet,
  type ReplyRecord,
} from "./engine/social/comments";
import { acquireReplyLock, releaseReplyLock, replyLockKey } from "./engine/social/replyInFlightLock";
import {
  buildPublishRecord,
  canTransition,
  collectAvailableMetrics,
  engagementRate,
  metricAvailability,
  publishPreflight,
  type PublishState,
} from "./engine/social/publishing";
import {
  YOUTUBE_REQUIRED_SCOPES,
  YOUTUBE_UPLOAD_SCOPE,
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_FORCE_SSL_SCOPE,
  YOUTUBE_CAPABILITY_MATRIX,
  YOUTUBE_PRIVACY_STATUSES,
  YOUTUBE_COMMENT_SCAN_VIDEO_LIMIT,
  commentScanVideoLimitFromEnv,
  resolveYouTubeScopes,
  YouTubeClient,
  youtubeCapabilityImplemented,
  youtubeApiBase,
  youtubeTokenUrl,
  youtubeUploadBase,
  youtubeWatchUrl,
  buildVideoInsertMetadata,
  validateVideoUploadInput,
  youtubeUploadFingerprint,
  classifyVideoUploadResult,
  checkOperationRateLimit,
  YOUTUBE_DEFAULT_CATEGORY_ID,
  resolveYouTubeReplyState,
  YOUTUBE_REPLY_LIFECYCLE_LABELS_AR,
  type YouTubeReplyLifecycleState,
  type YouTubeFetch,
  type YouTubeHttpResponse,
  type YouTubeVideo,
  type YouTubeComment,
} from "./engine/social/youtube";
import {
  resolveYouTubeState,
  youtubeOnlyModeEnabled,
  guardExternalOperationPlatform,
  YOUTUBE_ONLY_PLATFORM,
  type YouTubeStateInput,
  type YouTubeTruthfulState,
} from "./engine/social/youtubeState";
import {
  defaultYouTubeDelegation,
  normalizeYouTubeDelegation,
  youtubeDelegationStatus,
  summarizeYouTubeDelegation,
  buildYouTubeDelegation,
  revokeYouTubeDelegation,
  evaluateYouTubeDelegation,
  YOUTUBE_DELEGATION_ACTIONS,
  YOUTUBE_DELEGATION_ACTION_LABELS_AR,
  type YouTubeDelegation,
} from "./engine/social/youtubeDelegation";
import {
  defaultWatcherControls,
  normalizeWatcherControls,
  watcherGate,
  watcherControlsView,
  decideCommentAction,
  resolveCommentExecution,
  isSafeForAutoReply,
  computeCommentVelocity,
  computePeakHours,
  buildDailyBrief,
  detectOpportunities,
  isPollDue,
  nextPollAt,
  normalizeCadenceMs,
  advanceCheckpoint,
  hasProcessed,
  isDeferredDecision,
  releaseDeferredEntries,
  validateCadenceMinutes,
  cadenceMinutesToMs,
  WATCHER_DEFAULT_CADENCE_MINUTES,
  WATCHER_MIN_CADENCE_MINUTES,
  WATCHER_MAX_CADENCE_MINUTES,
  YOUTUBE_COMMENT_STAGES,
  YOUTUBE_COMMENT_STAGE_LABELS_AR,
  isExplicitTerminalDecision,
  repairProcessedDecisionCodes,
  selectFollowUpCandidates,
  evaluateFollowUpEngagement,
  followUpBaselineDelayMsFromEnv,
  FOLLOWUP_BASELINE_DELAY_MS,
  type CommentDecisionCode,
  type YouTubeWatcherControls,
  type WatcherProcessedEntry,
  type YouTubeCommentStage,
  type WatcherOpportunity,
} from "./engine/social/youtubeWatcher";
import { createWatcherScheduler, type WatcherScheduler } from "./engine/social/youtubeWatcherScheduler";
import { acquireLease, releaseLease, normalizeLease, type DurableLease } from "./engine/social/durableLease";
import { safeTimerCallback } from "./engine/social/safeTimer";
import {
  YouTubeQuotaLedger,
  resolveYouTubeDailyQuota,
  resolveYouTubeQuotaAlertThreshold,
  inspectYouTubeDailyQuota,
  buildYouTubeQuotaStatus,
  youtubeQuotaAlertReason,
  canAffordYouTubeQuota,
  classifyYouTubeQuotaOperation,
  youtubeUrlCountsAgainstQuota,
  YOUTUBE_QUOTA_COST,
  type YouTubeQuotaOperation,
} from "./engine/social/youtubeQuota";
import {
  resolveWatcherErrorAlertThreshold,
  shouldAlertWatcherFailure,
  shouldAlertReauth,
  watcherFailureAlertText,
  reauthAlertText,
} from "./engine/social/watcherAlerts";
import {
  computeBriefCounts,
  buildMetricViews,
  selectMetricEntries,
  toDetailRecord,
  applyDetailFilters,
  normalizeReviewOverrides,
  latestOverridesByComment,
  overrideForcesReply,
  overrideForcedStage,
  isValidReviewAction,
  WATCHER_BRIEF_METRIC_LABELS_AR,
  WATCHER_REVIEW_ACTION_LABELS_AR,
  WATCHER_BRIEF_WINDOW_MS,
  type WatcherReviewOverride,
  type WatcherReviewAction,
  type WatcherBriefMetric,
} from "./engine/social/watcherReview";
import {
  contentGate,
  classifyContentForReview,
  decisionToState,
  contentFingerprint,
  fingerprintTag,
  matchVideoByFingerprint,
  reconcileUnknownUpload,
  isFutureSchedule,
  canTransitionContent,
  isTerminalContentState,
  summarizeContentQueue,
  computeContentBriefCounts,
  isVerificationSubstantiated,
  evaluateDueScheduledContent,
  reviewActionToState,
  contentManualReadiness,
  classifyContentRecord,
  isValidContentReviewAction,
  filterContentActions,
  contentItemMediaState,
  CONTENT_REVIEW_ACTIONS,
  suggestScheduleTime,
  CONTENT_STATE_LABELS_AR,
  CONTENT_STATE_TONES,
  CONTENT_BRIEF_METRIC_LABELS_AR,
  CONTENT_BRIEF_METRICS,
  CONTENT_REVIEW_ACTION_LABELS_AR,
  CONTENT_STATES,
  type ContentState,
  type ContentDraftInput,
  type ContentBriefMetric,
  type ContentReviewAction,
} from "./engine/social/contentPipeline";
import {
  buildDeterministicYouTubeDescription,
  buildYouTubeDescriptionPrompt,
  verifyUploadedDescription,
  buildDescriptionHashtags,
  type YouTubeDescriptionInput,
} from "./engine/social/youtubeDescription";
import {
  summarizeChannelAnalytics,
  analyzeYouTubeAudience,
  buildYouTubeLearning,
  type YouTubeVideoMetricRecord,
} from "./engine/social/youtubeLearning";
import {
  toMarketingDecisionProjection,
  toOperationalMemoryProjection,
} from "./engine/brain/projections";
import {
  buildContentPlan,
  adaptForPlatform,
  type ContentBrief,
} from "./engine/social/contentIntelligence";
import {
  analyzePlatformLearning,
  type PlatformMetricRecord,
} from "./engine/social/platformLearning";
import {
  buildCommentIntelligence,
  proposeCommentReply,
  platformCapabilities,
} from "./engine/social/centralBrain";
import {
  analyzeBusinessClaims,
  analyzeRequestClaims,
  buildBusinessFacts,
  buildSafeBusinessReply,
  type BusinessFacts,
  type BusinessClaimViolation,
} from "./engine/social/contentSafety";
import { getOwnerEmailConfig, sendOwnerOtpEmail, sanitizeProviderMessage } from "./engine/notifications/owner-email";
import {
  createStorageAdapter,
  isEphemeralHost,
  STORAGE_KEY_STATE,
  STORAGE_KEY_USAGE,
  STORAGE_KEY_CONTROL,
  STORAGE_KEY_YOUTUBE_QUOTA,
  type StorageAdapter,
  type StorageStatus,
} from "./engine/storage/adapter";
import { SESSION_TTL_MS, signSession, verifySession, type SessionPayload } from "./engine/auth/sessions";
import { CHALLENGE_TTL_MS, issueChallengeCode, matchChallengeWindow } from "./engine/auth/challenge";
import { isScheduleInFuture, normalizeScheduleInput, wallClockToEpoch } from "./src/utils/scheduleTime";
import { productInstallmentFields, computeInstallmentPrice, type InstallmentInput } from "./src/utils/installmentPrice";

dotenv.config();

const app = express();

// سلامة العملية: أي استثناء/وعد مرفوض غير مُلتقَط يُسجَّل برسالة مُنقّاة (بلا سرّ
// ولا مكدّس يُعاد)، ولا يُسقط الخادم — يبقى يعمل بينما تُعزل العملية الجارية من
// المسار الذي فشل. لا نُغيّر سلوك الإغلاق عند SIGTERM/SIGINT.
process.on("uncaughtException", (err) => {
  console.error("[الغرابي AI] uncaughtException:", redactSecretsFromText(String((err as Error)?.message || err)).slice(0, 300));
});
process.on("unhandledRejection", (reason) => {
  console.error("[الغرابي AI] unhandledRejection:", redactSecretsFromText(String((reason as any)?.message || reason)).slice(0, 300));
});
// PORT is configurable so the app can run behind any host that injects its own
// port (containers/PaaS). Values outside the valid TCP range fall back to 3000.
const PORT = (() => {
  const raw = Number(process.env.PORT);
  return Number.isInteger(raw) && raw > 0 && raw <= 65535 ? raw : 3000;
})();
const PROJECT_VERSION = "13.0.0";
/** زمن إقلاع العملية (ISO): يُعلن في deploy.startedAt لتمييز النسخة العاملة فعلاً. */
const SERVER_STARTED_AT = new Date().toISOString();
const STATE_SCHEMA_VERSION = 16;

// Body parser يُبقي نسخة نصية من البايتات المرسلة نفسها في req.rawBody.
// هذا ضروري للتحقق من توقيع HMAC (X-Hub-Signature-256) على الجسم الخام تماماً
// كما أرسله Meta، لا على إعادة تسلسل req.body (قد تختلف المسافات/ترتيب المفاتيح).
// كونه الوسيط الأول يعني أنه يقرأ التدفق الوحيد نفسه، فلا يجد أي محلّل لاحق شيئاً.
//
// استثناء مضبوط: مسارات رفع مادة المحتوى (فيديو base64) قد تتجاوز 256kb بكثير،
// فنترك تدفقها لمحلّل JSON خاص بالمسار بحد أعلى معلن — مع بقاء الحد الصغير هنا
// وحماية التحقق من التوقيع (rawBody) كما هي لكل المسارات الأخرى.
//
// الجذر المُثبت (حد النقل/الشبكة): كل مسار يستقبل `videoBase64` فعلاً يجب أن يكون
// مُستثنى هنا، وإلا رفضه الوسيط العام (256kb) بحالة 413 «حجم الطلب أكبر من الحد
// المسموح» قبل أن يصل إلى validateMediaBytes. كان الاستثناء مساراً واحداً فقط،
// فتعطّلت ثلاثة مسارات ترفع فيديو: نشر يوتيوب، مراجعة/تعديل عنصر الطابور (إرفاق
// مادة)، واستضافة رابط الفيديو العام متعددة المنصات. هذا يخصّ حد النقل فقط؛ الحد
// المنطقي للمادة (CONTENT_MEDIA_MAX_ITEM_BYTES = 12MB للعنصر) يبقى كما هو.
const CONTENT_UPLOAD_PATHS: string[] = [
  "/api/platforms/youtube/content/drafts",
  "/api/platforms/youtube/publish",
  "/api/workspace/content/video/host",
];
// مسار مَعلمة (queue item review) يُطابق بنمط لأن معرّف العنصر جزء من المسار.
const CONTENT_UPLOAD_PATH_PATTERNS: RegExp[] = [
  /^\/api\/platforms\/youtube\/content\/queue\/[^/]+\/review$/,
];
const CONTENT_UPLOAD_JSON_LIMIT = "20mb";
app.use((req: any, res, next) => {
  const path = String(req.path || req.url || "").split("?")[0];
  if (CONTENT_UPLOAD_PATHS.includes(path) || CONTENT_UPLOAD_PATH_PATTERNS.some((re) => re.test(path))) return next();
  return express.json({
    limit: "256kb",
    verify: (req: any, _res: unknown, buf: Buffer) => {
      if (typeof req.rawBody !== "string") req.rawBody = buf?.toString("utf8") ?? "";
    },
  })(req, res, next);
});

// Request correlation: every API response receives a short trace id. It is safe
// to expose and contains no credentials; it helps the owner match UI errors to
// audit/support records without logging request bodies or secrets.
app.use((req, res, next) => {
  const incoming = typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"].trim() : "";
  const requestId = (incoming || crypto.randomUUID()).slice(0, 80);
  (req as any).requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
});

const authAttemptWindow = new Map<string, { startedAt: number; count: number }>();

function allowAuthAttempt(key: string, limit = 12): boolean {
  const now = Date.now();
  const item = authAttemptWindow.get(key);
  if (!item || now - item.startedAt >= RATE_WINDOW_TTL_MS) {
    authAttemptWindow.set(key, { startedAt: now, count: 1 });
    enforceRateWindowCap(authAttemptWindow, now);
    return true;
  }
  if (item.count >= limit) return false;
  item.count += 1;
  return true;
}


// Baseline security headers without adding another dependency.
app.disable("x-powered-by");
// SEC-03: سياسة أمان المحتوى (CSP) في الإنتاج فقط (التطوير يستخدم Vite middlewares
// ويحتاج inline/ws). تسمح صراحةً بالمصادر الخارجية الفعلية فقط: خطوط Google،
// وGoogle Sign-In (gsi). لا يوجد dangerouslySetInnerHTML في الواجهة، ولا inline
// <script> في dist، لذا script-src بلا unsafe-inline. style-src يسمح inline لأن
// React يستخدم style={{}} لأشرطة التقدم (خصائص لا سكربتات).
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com https://accounts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://accounts.google.com",
  "frame-src https://accounts.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  next();
});

// SEC-01 (جذر السبب): مجلد dist/dr-source يحوي حزمة المصدر الكاملة، والـ
// `esbuild --sourcemap` يُنتج dist/server.cjs.map الذي يحمل `sourcesContent`
// (الكود المصدري الأصلي كاملاً)، و`express.static(dist)` كان يخدم الاثنين علناً.
// المشكلة الجذرية: أي مقارنة نصية على `req.path` الخام تفشل، لأن `express.static`
// **يفكّ ترميز `%XX`** قبل خدمة الملف، فيتجاوز مسار مثل `/%64r-source/...` الحجب.
// الحل: نطبّع المسار (فكّ ترميز متكرر + توحيد الفواصل + حلّ `.`/`..` + حالة موحّدة)
// ثم نطابق على الصيغة المطبَّعة. المطابقة تصبح **مجموعة شاملة** لكل ما يمكن أن
// يخدمه express.static (الذي يفكّ مرة واحدة فقط)، فتصمد أمام الترميز والأحرف
// الكبيرة والترميز المزدوج ومحاولات الاجتياز. لا يُحذف أي ملف من dist، ويُبقى
// الوصول الداخلي للحزمة كما هو (تُقرأ من نظام الملفات فقط لبناء نسخ DR).
const BLOCKED_SOURCE_BUNDLE_SEGMENT = "/dr-source";
const BLOCKED_DIST_SOURCE_PREFIX = "/dist/dr-source";
const BLOCKED_DIST_FILES = new Set(["/server.cjs", "/server.cjs.map"]);
/**
 * يطبّع مسار الطلب إلى صيغة قانونية للمقارنة الأمنية. يفكّ الترميز بشكل متكرر
 * (محدود) لكشف الترميز المزدوج، ويقبل الترميز الفاسد بلا انهيار (يعود لآخر قيمة
 * سليمة)، ثم يوحّد الفواصل ويحلّ `.`/`..`/`//` ويوحّد حالة الأحرف.
 */
function canonicalRequestPath(rawPath: string): string {
  let p = String(rawPath || "");
  for (let i = 0; i < 5; i += 1) {
    if (!/%[0-9a-fA-F]/.test(p)) break;
    try {
      const next = decodeURIComponent(p);
      if (next === p) break;
      p = next;
    } catch {
      break; // ترميز فاسد: نطابق على آخر قيمة سليمة بدل الانهيار.
    }
  }
  p = p.split("?")[0].split("#")[0].replace(/\\/g, "/");
  p = path.posix.normalize(p);
  if (!p.startsWith("/")) p = `/${p}`;
  return p.toLowerCase();
}
// ملفات إعداد/قوائم حزم على جذر المشروع يخدمها express.static من الجذر العام
// (صورة Docker التي نسخ فيها المجلد الجذر بلا .git). لا قيمة عامة لها؛ تكشف
// الإصدارات والاعتماديات والإعداد. تُحجب بنفس آلية حزمة المصدر.
const BLOCKED_ROOT_FILES = new Set([
  "/package.json",
  "/package-lock.json",
  "/render.yaml",
]);

/** يحجب أي طلب يمكن أن يكشف حزمة المصدر أو حزمة الخادم أو خريطتها أو ملفات الإعداد. */
function isBlockedSourceRequest(rawPath: string): boolean {
  const p = canonicalRequestPath(rawPath);
  if (BLOCKED_ROOT_FILES.has(p)) return true;
  if (BLOCKED_DIST_FILES.has(p)) return true;
  if (p === BLOCKED_SOURCE_BUNDLE_SEGMENT || p.endsWith(BLOCKED_SOURCE_BUNDLE_SEGMENT)) return true;
  if (p.includes(`${BLOCKED_SOURCE_BUNDLE_SEGMENT}/`)) return true;
  if (p === BLOCKED_DIST_SOURCE_PREFIX || p.startsWith(`${BLOCKED_DIST_SOURCE_PREFIX}/`)) return true;
  // حزمة Node المبنية أو خريطتها في أي موضع (تحمل الكود المصدري؛ لا أصول عامة .cjs).
  if (p.endsWith(".cjs") || p.endsWith(".cjs.map")) return true;
  return false;
}
app.use((req, res, next) => {
  if (isBlockedSourceRequest(String(req.path || (req.url || "").split("?")[0] || ""))) {
    return res.status(404).json({
      success: false,
      error: "المسار غير موجود.",
      method: req.method,
      path: req.path,
      requestId: (req as any).requestId,
    });
  }
  next();
});

// -------------------------------------------------------------
// Security & Role-Based Access Control (RBAC) System
// -------------------------------------------------------------

export type ServerUserRole = 'owner' | 'manager' | 'staff' | 'content_creator' | 'customer_support';

export interface ServerUser {
  id: string;
  name: string;
  email: string;
  role: ServerUserRole;
  roleTitleArabic: string;
  avatar: string;
  active: boolean;
  createdAt: string;
}

export interface ActiveSession {
  token: string;
  /** معرّف الجلسة — يُستخدم لإبطالها عند تسجيل الخروج. */
  sid: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: ServerUserRole;
    roleTitleArabic: string;
    avatar: string;
    active: boolean;
  };
  expiresAt: number;
}

// Configurable Owner Email (Single source of truth on the server)
const OWNER_EMAIL = (process.env.OWNER_EMAIL || "").toLowerCase().trim();
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();

// مفتاح توقيع الجلسات. يُشتق من SESSION_SECRET إن وُجد، وإلا من مفتاح تشفير
// توكنات المنصات إن كان مضبوطاً، فيبقى التوقيع ثابتاً عبر العمليات وإعادة
// النشر. بغيابهما يُولَّد مفتاح عابر لهذه العملية فقط، وتُعلن حالة الإعداد
// بصراحة في /api/health حتى لا يُظن أن الجلسات دائمة وهي ليست كذلك.
const SESSION_SECRET_VALUE = (process.env.SESSION_SECRET || "").trim();
const SESSION_SECRET_SOURCE: "SESSION_SECRET" | "PLATFORM_TOKEN_ENCRYPTION_KEY" | "ephemeral" =
  SESSION_SECRET_VALUE ? "SESSION_SECRET" : (process.env.PLATFORM_TOKEN_ENCRYPTION_KEY || "").trim() ? "PLATFORM_TOKEN_ENCRYPTION_KEY" : "ephemeral";
function deriveSessionSecret(): Buffer {
  if (SESSION_SECRET_SOURCE === "SESSION_SECRET") {
    return crypto.createHash("sha256").update(`gharabi-session:${SESSION_SECRET_VALUE}`).digest();
  }
  if (SESSION_SECRET_SOURCE === "PLATFORM_TOKEN_ENCRYPTION_KEY") {
    return crypto.createHash("sha256").update(`gharabi-session:${process.env.PLATFORM_TOKEN_ENCRYPTION_KEY}`).digest();
  }
  return crypto.randomBytes(32);
}
const SESSION_SECRET = deriveSessionSecret();
/** هل الجلسات دائمة فعلاً (لا تُفقد بين العمليات)؟ */
const SESSIONS_DURABLE = SESSION_SECRET_SOURCE !== "ephemeral";

function getRoleTitle(role: ServerUserRole): string {
  switch (role) {
    case 'owner':
      return 'مالك النظام (Owner)';
    case 'manager':
      return 'المدير العام';
    case 'staff':
      return 'الموظف';
    case 'content_creator':
      return 'مسؤول المحتوى';
    case 'customer_support':
      return 'مسؤول خدمة العملاء';
    default:
      return 'مستخدم';
  }
}

// Persistent server-side store. Only real owner/user records are loaded; no demo data.
// المسار قابل للضبط عبر STATE_DIR (مجلدات دائمة/مُثبّتة)، وافتراضياً مجلد العمل.
const STATE_DIR = (process.env.STATE_DIR || process.cwd()).trim() || process.cwd();
const BACKUP_DIR = path.join(STATE_DIR, ".gharabi-backups");

// مخزن واحد لكل الحالة: ملف محلي افتراضياً (تطوير)، وPostgres خارجي تلقائياً
// عند وجود DATABASE_URL. بدونه على Render Free (بلا قرص دائم) لا تنجو البيانات
// من إعادة النشر، ويُعلَن ذلك بصراحة في /api/health بدل ادعاء الدوام.
const storageAdapter: StorageAdapter = createStorageAdapter({
  stateDir: STATE_DIR,
  databaseUrl: process.env.DATABASE_URL,
  ephemeralHost: isEphemeralHost(),
});

// حالة الكتابة تُقرأ من المخزّن الفعلي، لا من فحص مجلد منفصل.
const STATE_WRITABLE = () => storageAdapter.status().writable;
const storageStatus = (): StorageStatus => storageAdapter.status();
const defaultOwner: ServerUser = {
  id: "owner",
  name: "مالك النظام (Owner)",
  email: OWNER_EMAIL,
  role: "owner",
  roleTitleArabic: "مالك النظام (Owner)",
  avatar: "",
  active: true,
  createdAt: new Date().toISOString(),
};

/** يقرأ لقطة الحالة من المخزن مرّة واحدة عند الإقلاع (متزامن للملف فقط). */
function readStateSnapshot(): any {
  return storageAdapter.readSync<any>(STORAGE_KEY_STATE);
}

function loadPersistentState(snapshot?: any): any {
  try {
    const raw = snapshot ?? readStateSnapshot() ?? {};
    if (!raw.schemaVersion) raw.schemaVersion = 1;
    const users = Array.isArray(raw.users) ? raw.users : [defaultOwner];
    if (!users.some((u: ServerUser) => u.id === "owner")) users.unshift(defaultOwner);
    return { users, revokedSessions: Array.isArray(raw.revokedSessions) ? raw.revokedSessions : [], userRevocations: Array.isArray(raw.userRevocations) ? raw.userRevocations : [], audit: Array.isArray(raw.audit) ? raw.audit.slice(0, 200) : [], jobs: Array.isArray(raw.jobs) ? raw.jobs.slice(0, 200) : [], platformConnections: Array.isArray(raw.platformConnections) ? raw.platformConnections : [], workspace: raw.workspace && typeof raw.workspace === "object" ? { showroom: raw.workspace.showroom || {}, products: Array.isArray(raw.workspace.products) ? raw.workspace.products.slice(0, 1000) : [], posts: Array.isArray(raw.workspace.posts) ? raw.workspace.posts.slice(0, 1000) : [], conversations: Array.isArray(raw.workspace.conversations) ? raw.workspace.conversations.slice(0, 1000) : [], installmentPlans: Array.isArray(raw.workspace.installmentPlans) ? raw.workspace.installmentPlans.slice(0, 200) : [], leads: Array.isArray(raw.workspace.leads) ? raw.workspace.leads.slice(0, 2000) : [], tasks: Array.isArray(raw.workspace.tasks) ? raw.workspace.tasks.slice(0, 1000) : [], sales: Array.isArray(raw.workspace.sales) ? raw.workspace.sales.slice(0, 5000) : [], payments: Array.isArray(raw.workspace.payments) ? raw.workspace.payments.slice(0, 10000) : [], inventoryMovements: Array.isArray(raw.workspace.inventoryMovements) ? raw.workspace.inventoryMovements.slice(0, 20000) : [], suppliers: Array.isArray(raw.workspace.suppliers) ? raw.workspace.suppliers.slice(0, 1000) : [], purchases: Array.isArray(raw.workspace.purchases) ? raw.workspace.purchases.slice(0, 5000) : [], expenses: Array.isArray(raw.workspace.expenses) ? raw.workspace.expenses.slice(0, 10000) : [], contracts: Array.isArray(raw.workspace.contracts) ? raw.workspace.contracts.slice(0, 5000) : [], installmentSchedules: Array.isArray(raw.workspace.installmentSchedules) ? raw.workspace.installmentSchedules.slice(0, 20000) : [], notifications: Array.isArray(raw.workspace.notifications) ? raw.workspace.notifications.slice(0, 10000) : [], webhookEvents: Array.isArray(raw.workspace.webhookEvents) ? raw.workspace.webhookEvents.slice(0, 10000) : [], providerEvents: Array.isArray(raw.workspace.providerEvents) ? raw.workspace.providerEvents.slice(0, 10000) : [], marketingBriefs: Array.isArray(raw.workspace.marketingBriefs) ? raw.workspace.marketingBriefs.slice(0, 2000) : [], marketingCampaigns: Array.isArray(raw.workspace.marketingCampaigns) ? raw.workspace.marketingCampaigns.slice(0, 1000) : [], socialComments: Array.isArray(raw.workspace.socialComments) ? raw.workspace.socialComments.slice(0, 10000) : [], socialReplies: Array.isArray(raw.workspace.socialReplies) ? raw.workspace.socialReplies.slice(0, 5000) : [], socialConversations: Array.isArray(raw.workspace.socialConversations) ? raw.workspace.socialConversations.slice(0, 500) : [], socialEscalations: Array.isArray(raw.workspace.socialEscalations) ? raw.workspace.socialEscalations.slice(0, 5000) : [], socialConversationStates: Array.isArray(raw.workspace.socialConversationStates) ? raw.workspace.socialConversationStates.slice(0, 500) : [], socialApprovals: Array.isArray(raw.workspace.socialApprovals) ? raw.workspace.socialApprovals.slice(0, 5000) : [], publishRecords: Array.isArray(raw.workspace.publishRecords) ? raw.workspace.publishRecords.slice(0, 5000) : [], performanceRecords: Array.isArray(raw.workspace.performanceRecords) ? raw.workspace.performanceRecords.slice(0, 20000) : [], marketingDecisions: Array.isArray(raw.workspace.marketingDecisions) ? raw.workspace.marketingDecisions.slice(0, 2000) : [], strategiesTested: Array.isArray(raw.workspace.strategiesTested) ? raw.workspace.strategiesTested.slice(0, 2000) : [], telegramUpdateIds: Array.isArray(raw.workspace.telegramUpdateIds) ? raw.workspace.telegramUpdateIds.slice(0, 20000) : [], facebookEventIds: Array.isArray(raw.workspace.facebookEventIds) ? raw.workspace.facebookEventIds.slice(0, 20000) : [], instagramEventIds: Array.isArray(raw.workspace.instagramEventIds) ? raw.workspace.instagramEventIds.slice(0, 20000) : [], tiktokEventIds: Array.isArray(raw.workspace.tiktokEventIds) ? raw.workspace.tiktokEventIds.slice(0, 20000) : [], youtubeCommentIds: Array.isArray(raw.workspace.youtubeCommentIds) ? raw.workspace.youtubeCommentIds.slice(0, 20000) : [], youtubeOperationKeys: Array.isArray(raw.workspace.youtubeOperationKeys) ? raw.workspace.youtubeOperationKeys.slice(0, 20000) : [], providerTokens: raw.workspace.providerTokens && typeof raw.workspace.providerTokens === "object" ? raw.workspace.providerTokens : {} } : { showroom: {}, products: [], posts: [], conversations: [], installmentPlans: [], leads: [], tasks: [], sales: [], payments: [], inventoryMovements: [], suppliers: [], purchases: [], expenses: [], contracts: [], installmentSchedules: [], notifications: [], webhookEvents: [], providerEvents: [], marketingBriefs: [], marketingCampaigns: [], socialComments: [], socialReplies: [], socialConversations: [], socialEscalations: [], socialConversationStates: [], socialApprovals: [], publishRecords: [], performanceRecords: [], marketingDecisions: [], strategiesTested: [], telegramUpdateIds: [], facebookEventIds: [], instagramEventIds: [], tiktokEventIds: [], youtubeCommentIds: [], youtubeOperationKeys: [], providerTokens: {} } };
  } catch {
    return { users: [defaultOwner], revokedSessions: [], userRevocations: [], audit: [], jobs: [], workspace: { showroom: {}, products: [], posts: [], conversations: [], installmentPlans: [], leads: [], tasks: [], sales: [], payments: [], inventoryMovements: [], suppliers: [], purchases: [], expenses: [], contracts: [], installmentSchedules: [], notifications: [], webhookEvents: [], providerEvents: [], marketingBriefs: [], marketingCampaigns: [], socialComments: [], socialReplies: [], socialConversations: [], socialEscalations: [], socialConversationStates: [], socialApprovals: [], publishRecords: [], performanceRecords: [], marketingDecisions: [], strategiesTested: [], telegramUpdateIds: [], providerTokens: {} } };
  }
}

// الجلسات المُبطَلة (تسجيل خروج / إلغاء تفعيل / حذف مستخدم). تُحفظ على القرص
// لأن الإبطال يجب أن يسري في كل العمليات لا في العملية التي نفّذته فقط.
const revokedSessions = new Map<string, number>(); // sid -> exp

// ختم إبطال على مستوى المستخدم: أي توكن صدر قبل الختم يُرفض. يُغطّي تغيير
// الدور والتعطيل والحذف، ويسري في كل العمليات بعد إعادة التشغيل من القرص.
const userRevocationEpoch = new Map<string, number>(); // userId -> timestamp

/**
 * بصمة توكن المعاينة الحالي (SHA-256، بلا كشف القيمة) وختم زمني لتغيّره.
 *
 * السبب: توكن المعاينة بلا حالة، فإن غيّر المالك GHARABI_PREVIEW_TOKEN ظلّت
 * الجلسات القديمة صالحة 30 يوماً بلا طريقة لإبطالها إلا بتدوير SESSION_SECRET
 * (فيسقط كل المستخدمين). البصمة تُحفظ في المخزن مع ختم وقت التغيير، وأي جلسة
 * أُصدرت عبر المعاينة قبل الختم تُرفض تلقائياً عند تغيير التوكن.
 */
function hashPreviewToken(raw: string): string | null {
  const value = (raw || "").trim();
  if (!value) return null;
  return crypto.createHash("sha256").update(`gharabi-preview:${value}`).digest("hex");
}
const previewControl: { tokenHash: string | null } = { tokenHash: null };

// ختم زمني يُبطل جلسات المعاينة الصادرة قبل تغيير التوكن.
const previewEpoch = { value: 0 };

// آخر نافذة OTP استُهلكت لكل بريد، تُحفظ عبر المحوّل فيمنع إعادة استخدام الرمز
// داخل نافذته حتى بعد restart، بلا تخزين الرمز نفسه.
const consumedChallengeWindows = new Map<string, number>(); // email -> windowIndex

const persisted = loadPersistentState();
// الجلسات المُبطَلة تُحمَّل من المخزن كي يستمر الإبطال عبر العمليات وإعادة النشر.
for (const entry of Array.isArray(persisted.revokedSessions) ? persisted.revokedSessions : []) {
  if (entry?.sid && typeof entry.exp === "number" && entry.exp > Date.now()) {
    revokedSessions.set(entry.sid, entry.exp);
  }
}
// ختم الإبطال على مستوى المستخدم يُحمَّل أيضاً كي لا تعود جلسة مُبطلة للحياة
// بعد إعادة تشغيل العملية.
for (const entry of Array.isArray(persisted.userRevocations) ? persisted.userRevocations : []) {
  if (entry?.userId && typeof entry.at === "number") {
    userRevocationEpoch.set(entry.userId, entry.at);
  }
}
const serverUsers: ServerUser[] = persisted.users;
const workspace = persisted.workspace;
for (const key of ["inventoryMovements","suppliers","purchases","expenses","contracts","installmentSchedules","notifications","webhookEvents","providerEvents"]) if (!Array.isArray((workspace as any)[key])) (workspace as any)[key] = [];
if (!Array.isArray((workspace as any).inventoryMovements)) (workspace as any).inventoryMovements = [];
for (const key of ["suppliers","purchases","expenses","contracts","installmentSchedules","notifications","webhookEvents","providerEvents","marketingBriefs","marketingCampaigns"]) if (!Array.isArray((workspace as any)[key])) (workspace as any)[key] = [];
for (const key of ["telegramUpdateIds","facebookEventIds","instagramEventIds","tiktokEventIds","youtubeCommentIds","youtubeOperationKeys"]) if (!Array.isArray((workspace as any)[key])) (workspace as any)[key] = [];
if (!(workspace as any).providerTokens || typeof (workspace as any).providerTokens !== "object") (workspace as any).providerTokens = {};
// سجلات مدير السوشيال ميديا: تعليقات، ردود، نتائج نشر، وقرارات تسويقية.
// كلها سجلات تشغيلية حقيقية تُبنى من عمليات فعلية فقط.
for (const key of ["socialComments","socialReplies","socialConversations","socialEscalations","socialConversationStates","socialApprovals","publishRecords","marketingDecisions","strategiesTested","performanceRecords"]) if (!Array.isArray((workspace as any)[key])) (workspace as any)[key] = [];

// سقوف صارمة لمصفوفات الحالة في الذاكرة (M6). كانت هذه السجلات تُقلَّم إلى هذه
// الأرقام فقط عند الحفظ/التحميل، فتنمو بلا حدود بين عمليات إعادة التشغيل حتى تبلغ
// أضعافها → خطر نفاد الذاكرة على Render Free (256MB). السقف يُطبَّق الآن بعد كل
// `unshift` مباشرةً، فتبقى بصمة الذاكرة محصورة. الأرقام مبنية على حجم السجل الفعلي
// وسقف الحفظ نفسه (بلا تغيير سلوك المستخدم):
//   - webhookEvents/providerEvents: سجلات أحداث مرمّزة صغيرة؛ 10,000 كسقف الحفظ.
//   - socialComments/socialReplies: السجل الأكبر (نص + تصنيف)؛ 10,000/5,000 كسقف الحفظ.
//   - publishRecords: بايتات وصف/حالة رفع كبيرة؛ 5,000 كسقف الحفظ.
const WORKSPACE_MAX_WEBHOOK_EVENTS = 10000;
const WORKSPACE_MAX_PROVIDER_EVENTS = 10000;
const WORKSPACE_MAX_SOCIAL_COMMENTS = 10000;
const WORKSPACE_MAX_SOCIAL_REPLIES = 5000;
const WORKSPACE_MAX_PUBLISH_RECORDS = 5000;

// Migration guard: a post is never considered externally published merely because
// an old/local record said so. Until a real provider execution receipt exists,
// legacy "published" records are downgraded to approved.
for (const post of workspace.posts) {
  if (post?.status === "published") {
    post.status = "approved";
    delete post.publishedAt;
  }
}

// Active sessions: kept in memory only as a small cache for the current process.
// الحقيقة في التوكن الموقّع نفسه، لذا لا تعتمد الجلسة على هذه الخريطة.
const activeSessions = new Map<string, ActiveSession>();

/**
 * يُبطل كل جلسات مستخدم معيّن.
 *
 * الإبطال لا يمكن أن يعتمد على التوكنات المخزّنة في هذه العملية فقط، لأن
 * العمليات الأخرى تحمل جلسات لا نراها. لذلك نُبطل على مستوى المستخدم نفسه
 * عبر ختم زمني: أي توكن صادر قبل هذا الختم يُرفض، فيسري الإبطال في كل
 * العمليات وإعادة النشر بلا حاجة لمشاركة قائمة التوكنات.
 */
function revokeUserSessions(userId: string) {
  userRevocationEpoch.set(userId, Date.now());
  for (const [token, session] of activeSessions.entries()) {
    if (session.user.id === userId) activeSessions.delete(token);
  }
}

// رموز تحقق استُهلكت في هذه العملية — أفضل جهد لمنع إعادة الاستخدام.
// الأساس أن الرمز مشتق رياضياً (بلا حالة) ويبقى صالحاً في أي عملية.
const consumedChallenges = new Map<string, number>(); // email -> exp

function createSessionForUser(user: ServerUser, previewStamp?: number): ActiveSession {
  const sid = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  // التوكن موقّع ويحمل المعرّف والصلاحية فقط، فيبقى صالحاً في أي عملية.
  // pv يُضاف عند إصدار جلسة معاينة فقط (حتى لو كان صفراً) كي يبقى قابلاً للإبطال.
  const token = signSession({ uid: user.id, iat: Date.now(), exp: expiresAt, sid, ...(previewStamp === undefined ? {} : { pv: previewStamp }) }, SESSION_SECRET);
  const session: ActiveSession = {
    token,
    sid,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roleTitleArabic: user.roleTitleArabic,
      avatar: user.avatar,
      active: user.active,
    },
    expiresAt,
  };
  activeSessions.set(token, session);
  enforceActiveSessionCap();
  return session;
}

// M6: سقف دفاعي لخريطة الجلسات في الذاكرة. الجلسات عمرها 30 يوماً وتُقلّم كل 5
// دقائق، لكنها تبقى قابلة للنمو مع كثرة تسجيلات الدخول. عند بلوغ السقف نُزيل
// المنتهية أولاً ثم الأقدم — فلا ينمو الاستهلاك بلا حدود (لا يسقط مستخدماً نشطاً
// إلا في حالات نظرية بعيدة).
const WORKSPACE_MAX_ACTIVE_SESSIONS = 5000;
function enforceActiveSessionCap(): void {
  if (activeSessions.size <= WORKSPACE_MAX_ACTIVE_SESSIONS) return;
  const now = Date.now();
  for (const [token, session] of activeSessions) if (session.expiresAt < now) activeSessions.delete(token);
  while (activeSessions.size > WORKSPACE_MAX_ACTIVE_SESSIONS) {
    const oldest = activeSessions.keys().next().value;
    if (oldest === undefined) break;
    activeSessions.delete(oldest);
  }
}

/**
 * L4: عدد الجلسات الفعلية غير المنتهية وقت الطلب. `activeSessions.size` يشمل
 * جلسات منتهية لم يُقلّمها المؤقّت الدوري (كل 5 دقائق) فيُظهر عدداً زائداً.
 * الحساب المفلتر هو الأبسط هندسياً والأدق دائماً (بلا مساس بأمان الإبطال).
 */
function activeSessionCount(): number {
  const now = Date.now();
  let n = 0;
  for (const s of activeSessions.values()) if (s.expiresAt >= now) n += 1;
  return n;
}

// Middleware: Authenticate incoming token
function authenticateToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: "غير مصرح. يجب تسجيل الدخول للوصول إلى هذا المورد.",
    });
  }

  const token = authHeader.substring(7).trim();
  const payload = verifySession(token, SESSION_SECRET);

  if (!payload) {
    return res.status(401).json({
      success: false,
      error: "انتهت صلاحية جلسة الدخول. يرجى إعادة تسجيل الدخول.",
    });
  }

  // الإبطال الصريح (خروج/تعطيل/حذف) يسري في كل العمليات لأن القائمة محفوظة.
  const revokedUntil = revokedSessions.get(payload.sid);
  if (revokedUntil && revokedUntil > Date.now()) {
    return res.status(401).json({
      success: false,
      error: "انتهت صلاحية جلسة الدخول. يرجى إعادة تسجيل الدخول.",
    });
  }

  // إبطال على مستوى المستخدم: أي توكن صدر قبل ختم الإبطال يُرفض، فيسري
  // التعطيل/تغيير الدور في كل العمليات لا في العملية التي نفّذت التغيير.
  const epoch = userRevocationEpoch.get(payload.uid);
  if (epoch && payload.iat < epoch) {
    return res.status(401).json({
      success: false,
      error: "انتهت صلاحية جلسة الدخول. يرجى إعادة تسجيل الدخول.",
    });
  }

  // إبطال جلسات المعاينة عند تغيير توكن المعاينة: أي جلسة تحمل ختماً أقدم من
  // الختم الحالي تُرفض، فلا يبقى وصول دائم بتوكن أُلغي.
  if (payload.pv !== undefined && payload.pv < previewEpoch.value) {
    return res.status(401).json({
      success: false,
      error: "انتهت صلاحية جلسة الدخول. يرجى إعادة تسجيل الدخول.",
    });
  }

  // الدور والمصادقة يُقرآن من قاعدة البيانات دائماً، لا من التوكن.
  const dbUser = serverUsers.find((u) => u.id === payload.uid);
  if (!dbUser || !dbUser.active) {
    return res.status(403).json({
      success: false,
      error: "تم إلغاء تفعيل هذا الحساب أو حذفه.",
    });
  }

  const session: ActiveSession = {
    token,
    sid: payload.sid,
    user: {
      id: dbUser.id,
      name: dbUser.name,
      email: dbUser.email,
      role: dbUser.role,
      roleTitleArabic: dbUser.roleTitleArabic,
      avatar: dbUser.avatar,
      active: dbUser.active,
    },
    expiresAt: payload.exp,
  };
  activeSessions.set(token, session);
  enforceActiveSessionCap();
  (req as any).session = session;
  (req as any).user = dbUser;
  next();
}

// Middleware: Strict Owner authorization
function requireOwner(req: express.Request, res: express.Response, next: express.NextFunction) {
  authenticateToken(req, res, () => {
    const user = (req as any).user as ServerUser;
    if (user.role !== "owner") {
      return res.status(403).json({
        success: false,
        error: "صلاحية مرفوضة: هذه العملية مقتصرة حصرياً على مالك النظام (Owner).",
      });
    }
    next();
  });
}

// -------------------------------------------------------------
// Authentication Endpoints
// -------------------------------------------------------------

// 1. Google Sign-In verification endpoint
app.post("/api/auth/google", async (req, res) => {
  try {
    const key = `google:${req.ip}`;
    if (!allowAuthAttempt(key)) return res.status(429).json({ success: false, error: "محاولات المصادقة كثيرة. حاول لاحقاً." });
    const { credential } = req.body;
    if (!credential || typeof credential !== "string") {
      return res.status(400).json({ success: false, error: "رمز المصادقة من Google مطلوب." });
    }

    // Securely verify ID token with Google tokeninfo endpoint
    const googleVerifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!googleVerifyRes.ok) {
      return res.status(401).json({ success: false, error: "فشل التحقق من صحة حساب Google." });
    }

    const tokenPayload: any = await googleVerifyRes.json();
    const email = (tokenPayload.email || "").toLowerCase().trim();
    const emailVerified = tokenPayload.email_verified === "true" || tokenPayload.email_verified === true;

    if (!email || !emailVerified) {
      return res.status(401).json({ success: false, error: "البريد الإلكتروني لحساب Google غير مؤكد." });
    }

    if (GOOGLE_CLIENT_ID && tokenPayload.aud !== GOOGLE_CLIENT_ID) {
      return res.status(401).json({ success: false, error: "حساب Google غير مهيأ لهذا التطبيق." });
    }

    // Check if this user is the registered OWNER
    let user: ServerUser | undefined;
    if (email === OWNER_EMAIL) {
      user = serverUsers.find((u) => u.id === "owner");
      if (user) {
        user.email = email;
        if (tokenPayload.name) user.name = tokenPayload.name;
        if (tokenPayload.picture) user.avatar = tokenPayload.picture;
      }
    } else {
      // Check if user was explicitly authorized by Owner in the server
      user = serverUsers.find((u) => u.email.toLowerCase() === email && u.active);
      if (!user) {
        return res.status(403).json({
          success: false,
          error: "عذراً، هذا الحساب غير مسجل أو مصرح له. يجب إضافة الحساب من قبل مالك النظام (Owner) أولاً.",
        });
      }
      if (tokenPayload.name) user.name = tokenPayload.name;
      if (tokenPayload.picture) user.avatar = tokenPayload.picture;
    }

    if (!user || !user.active) {
      return res.status(403).json({ success: false, error: "هذا الحساب معطل حالياً." });
    }

    const session = createSessionForUser(user);
    console.log(`[Auth] User authenticated: ${user.email} (${user.role})`);

    return res.json({
      success: true,
      token: session.token,
      user: session.user,
    });
  } catch (err: any) {
    console.error("Google auth error:", err);
    return res.status(500).json({ success: false, error: "حدث خطأ غير متوقع أثناء المصادقة." });
  }
});

// 2. Owner Challenge Verification Flow (Secure server-side OTP for owner email)
app.post("/api/auth/request-owner-challenge", async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = (email || "").toLowerCase().trim();
  if (!OWNER_EMAIL) return res.status(503).json({ success: false, message: "لم يتم ضبط بريد مالك النظام على الخادم بعد." });
  const challengeKey = `${req.ip || "unknown"}:${normalizedEmail}`;
  if (!allowChallengeAttempt(challengeKey)) return res.status(429).json({ success: false, message: "تم تجاوز عدد محاولات التحقق المسموح مؤقتاً. حاول لاحقاً." });

  if (normalizedEmail !== OWNER_EMAIL) {
    // منع كشف وجود حساب مالك: رسالة محايدة لا تؤكّد إصدار الرمز ولا تنفيه، ولا
    // تُعلن أن البريد ليس بريد المالك. **سبب عطل حقيقي سابق**: النص كان «تم إصدار
    // رمز التحقق بنجاح» فيظهر نجاح كاذب للمالك الذي أدخل بريداً غير مطابق لـOWNER_EMAIL
    // (لا يُنشأ رمز ولا يُستدعى Resend إطلاقاً)، فبدا العطل كأنه «لم يصل البريد».
    auditLog.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), userId: "system", action: "owner_challenge_address_mismatch", detail: "address-did-not-match-configured-owner" });
    if (auditLog.length > 100) auditLog.pop();
    persistState();
    return res.json({
      success: true,
      message: "سيُرسَل رمز التحقق فقط إلى البريد المعتمد لمالك النظام.",
      codeIssued: false,
    });
  }

  // الرمز يُشتق رياضياً من مفتاح الخادم والنافذة الزمنية، فلا يعتمد على ذاكرة
  // مشتركة ويمكن التحقق منه في أي عملية.
  const code = issueChallengeCode(normalizedEmail, SESSION_SECRET);

  // الإرسال الفعلي عبر Resend. لا يُسجَّل الرمز ولا يُعاد في الاستجابة إطلاقاً.
  const result = await sendOwnerOtpEmail({ to: normalizedEmail, code });
  if (!result.sent) {
    // كود سبب غير سرّي (كود مزوّد البريد أو اسم متغيّر ناقص) + **تفسير Resend المنقّى**
    // (بلا بريد ولا رمز ولا مفتاح) ليعرف المالك السبب الحرفي بدل «فشل صامت». يُحفظ
    // السبب المنقّى في سطر التدقيق أيضاً — فيُقرأ من سجل Render مباشرةً عند الحاجة.
    const reason = /^[a-z0-9_]{1,48}$/.test(String(result.error || "")) ? result.error : "send_failed";
    const reasonDetail = sanitizeProviderMessage(result.errorMessage || "") || null;
    auditLog.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), userId: "system", action: "owner_challenge_email_failed", detail: reasonDetail ? `${reason}: ${reasonDetail}` : reason });
    if (auditLog.length > 100) auditLog.pop();
    persistState();
    console.error(`[الغرابي AI] owner_challenge_email_failed reason=${reason}${reasonDetail ? ` detail=${reasonDetail}` : ""}`);
    return res.status(502).json({
      success: false,
      error: "تعذر إرسال رمز التحقق، حاول مرة أخرى",
      reason,
      reasonDetail,
    });
  }

  auditLog.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), userId: "system", action: "owner_challenge_email_sent", detail: "owner-challenge-delivered" });
  if (auditLog.length > 100) auditLog.pop();
  persistState();

  return res.json({
    success: true,
    // «قبول المزود» فقط — لا يُدَّعى تسليم صندوق البريد (لا دليل عليه من Resend هنا).
    message: "قَبِل مزوّد البريد طلب الإرسال — تحقّق من صندوق الوارد (والمهملات) للبريد المعتمد.",
    codeIssued: true,
    providerAccepted: true,
  });
});

app.post("/api/auth/verify-challenge", async (req, res) => {
  const { email, code } = req.body;
  const normalizedEmail = (email || "").toLowerCase().trim();

  if (!normalizedEmail || !code) {
    return res.status(400).json({ success: false, error: "البريد الإلكتروني ورمز التحقق مطلوبان." });
  }

  // حدّ محاولات على التحقق من الرمز (كان غائباً): الرمز 6 أرقام ونافذته 10 دقائق،
  // فبلا حدّ يمكن تخمينه بلا نهاية. الحدّ لكل (IP + بريد) داخل نافذة موحّدة،
  // ويُستهلَك قبل مقارنة الرمز كي لا يمنح الردّ أي إشارة عن صحّة الرمز.
  if (!allowAuthAttempt(`verify-challenge:${req.ip || "unknown"}:${normalizedEmail}`, 10)) {
    return res.status(429).json({ success: false, error: "تم تجاوز عدد محاولات التحقق المسموح مؤقتاً. حاول لاحقاً." });
  }

  // منع إعادة استخدام الرمز داخل نافذته: يُقارن بآخر نافذة استُهلكت للبريد
  // (محفوظة عبر المحوّل)، فلا يُقبل رمز نافذة سابقة مرة أخرى حتى بعد إعادة
  // التشغيل، بلا تخزين الرمز نفسه.
  const matchedWindow = matchChallengeWindow(normalizedEmail, code, SESSION_SECRET);
  if (matchedWindow === null) {
    return res.status(401).json({ success: false, error: "رمز التحقق المدخل غير صحيح." });
  }
  const lastConsumed = consumedChallengeWindows.get(normalizedEmail);
  if (lastConsumed !== undefined && matchedWindow <= lastConsumed) {
    return res.status(401).json({ success: false, error: "رمز التحقق غير صحيح أو انتهت صلاحيته." });
  }

  // Successful verification: تُسجَّل النافذة المُستهلكة مرة واحدة لكل بريد.
  consumedChallengeWindows.set(normalizedEmail, matchedWindow);
  consumedChallenges.set(normalizedEmail, Date.now() + CHALLENGE_TTL_MS);
  // ننتظر الكتابة قبل إصدار الجلسة: لا يُمنح وصول قبل تثبيت الاستهلاك الموثوق.
  await persistCritical();

  let user = serverUsers.find((u) => u.email.toLowerCase() === normalizedEmail && u.active);
  if (!user && normalizedEmail === OWNER_EMAIL) {
    user = serverUsers.find((u) => u.id === "owner");
    if (user) user.email = normalizedEmail;
  }

  if (!user || !user.active) {
    return res.status(403).json({ success: false, error: "هذا الحساب غير مصرح له أو معطل." });
  }

  const session = createSessionForUser(user);
  await persistCritical();
  return res.json({
    success: true,
    token: session.token,
    user: session.user,
  });
});

// 2b. Preview login (opt-in فقط): يُفتح حصرياً بضبط GHARABI_PREVIEW_TOKEN في بيئة
// الخادم. بدونه يعيد 404 كأن المسار غير موجود. التوكن لا يُسجَّل ولا يُعاد.
//
// صيغة واحدة فقط: POST { token } في جسم الطلب. سبب إلغاء صيغة GET ?token=:
//  1) توكن في سطر الطلب يدخل سجلات الخادم والوسائط وسجل المحفوظات — تسريب.
//  2) سطر الطلب يبقى في history المتصفح وإحالات Referer.
// رابط المالك المحفوظ يستخدم مقطع الرابط (#preview_token) الذي لا يُرسل للخادم
// إطلاقاً؛ تقرؤه الواجهة ثم ترسله في جسم POST ثم تمسحه من الرابط فوراً.
async function handlePreviewLogin(req: express.Request, res: express.Response) {
  res.setHeader("Cache-Control", "no-store");
  const configured = (process.env.GHARABI_PREVIEW_TOKEN || "").trim();
  if (!configured) return res.status(404).json({ success: false, error: "Not found" });

  // التوكن لا يُقبل إلا في جسم الطلب. أي محاولة تمريره في سطر الطلب تُرفض صراحةً
  // حتى لا يدخل السجلات.
  if (typeof req.query?.token === "string" || typeof req.query?.preview_token === "string") {
    return res.status(400).json({ success: false, error: "لا يُقبل التوكن في سطر الطلب. استخدم جسم الطلب (POST)." });
  }

  const rateKey = `preview:${req.ip || "unknown"}`;
  if (!allowAuthAttempt(rateKey, 10)) {
    return res.status(429).json({ success: false, error: "تم تجاوز عدد محاولات الدخول المسموح مؤقتاً. حاول لاحقاً." });
  }

  const supplied = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const a = Buffer.from(configured);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ success: false, error: "غير مصرح." });
  }

  const owner = serverUsers.find((u) => u.id === "owner" && u.active);
  if (!owner) return res.status(403).json({ success: false, error: "حساب المالك غير متاح." });

  const session = createSessionForUser(owner, previewEpoch.value);
  auditLog.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), userId: "system", action: "owner_preview_login", detail: "preview-session-created" });
  if (auditLog.length > 100) auditLog.pop();
  await persistCritical();
  return res.json({ success: true, token: session.token, user: session.user });
}
// يُسجَّل المسار لطريقة POST فقط: لا يوجد مسار GET يمرّر التوكن في سطر الطلب.
app.post("/api/auth/preview-login", handlePreviewLogin);

// 3. Current User verification endpoint
app.get("/api/auth/me", authenticateToken, (req, res) => {
  const session = (req as any).session as ActiveSession;
  res.json({
    success: true,
    user: session.user,
  });
});

// 4. Logout endpoint
app.post("/api/auth/logout", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    const payload = verifySession(token, SESSION_SECRET);
    if (payload) {
      // الإبطال يُحفظ على القرص كي يسري في كل العمليات لا في هذه العملية فقط.
      revokedSessions.set(payload.sid, payload.exp);
      activeSessions.delete(token);
      // ننتظر التثبيت قبل الرد: لا نُعلن نجاح الخروج قبل استقرار الإبطال.
      await persistCritical();
    }
  }
  res.json({ success: true, message: "تم تسجيل الخروج بنجاح." });
});

// -------------------------------------------------------------
// User Management Endpoints (Strictly Protected by requireOwner)
// -------------------------------------------------------------

// List users (Any authenticated user can view the team directory)
app.get("/api/users", authenticateToken, (_req, res) => {
  res.json({
    success: true,
    users: serverUsers.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      roleTitleArabic: u.roleTitleArabic,
      avatar: u.avatar,
      active: u.active,
    })),
  });
});

// Add user (ONLY Owner can add users, CANNOT add another owner)
app.post("/api/users", requireOwner, (req, res) => {
  try {
    const { name, email, role, avatar } = req.body;
    if (!name || !email || !role) {
      return res.status(400).json({ success: false, error: "الاسم، البريد الإلكتروني، والرتبة حقول مطلوبة." });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Security invariant: No one can create another 'owner'
    if (role === "owner") {
      return res.status(403).json({
        success: false,
        error: "لا يمكن تعيين مستخدم آخر كمالك للنظام (Owner). المالك حصري وفريد.",
      });
    }

    const existing = serverUsers.find((u) => u.email.toLowerCase() === normalizedEmail);
    if (existing) {
      return res.status(400).json({ success: false, error: "هذا البريد الإلكتروني مضاف مسبقاً في النظام." });
    }

    const newUser: ServerUser = {
      id: "usr-" + Date.now(),
      name: name.trim(),
      email: normalizedEmail,
      role,
      roleTitleArabic: getRoleTitle(role),
      avatar: avatar || "",
      active: true,
      createdAt: new Date().toISOString(),
    };

    serverUsers.push(newUser);
    persistState();
    console.log(`[RBAC] Owner added new user: ${newUser.email} (${newUser.role})`);

    return res.json({
      success: true,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        roleTitleArabic: newUser.roleTitleArabic,
        avatar: newUser.avatar,
        active: newUser.active,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || "حدث خطأ أثناء إضافة المستخدم." });
  }
});

// Update role (ONLY Owner can modify roles, CANNOT modify Owner's role, CANNOT promote to Owner)
app.put("/api/users/:id/role", requireOwner, (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (id === "owner") {
      return res.status(403).json({
        success: false,
        error: "لا يمكن تعديل صلاحيات أو رتبة مالك النظام (Owner).",
      });
    }

    if (role === "owner") {
      return res.status(403).json({
        success: false,
        error: "لا يمكن ترقية أي مستخدم إلى مالك النظام (Owner).",
      });
    }

    const user = serverUsers.find((u) => u.id === id);
    if (!user) {
      return res.status(404).json({ success: false, error: "المستخدم غير موجود." });
    }

    user.role = role;
    user.roleTitleArabic = getRoleTitle(role);
    // تغيير الدور يُبطل الجلسات القائمة كي لا يستمر توكن قديم بصلاحية سابقة.
    revokeUserSessions(id);
    persistState();

    console.log(`[RBAC] Owner updated role for user ${user.email} to ${role}`);
    return res.json({ success: true, user });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || "حدث خطأ أثناء تعديل الدور." });
  }
});

// Toggle user active status (ONLY Owner, CANNOT deactivate Owner)
app.put("/api/users/:id/status", requireOwner, (req, res) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    if (id === "owner") {
      return res.status(403).json({
        success: false,
        error: "لا يمكن تعطيل حساب مالك النظام (Owner).",
      });
    }

    const user = serverUsers.find((u) => u.id === id);
    if (!user) {
      return res.status(404).json({ success: false, error: "المستخدم غير موجود." });
    }

    user.active = Boolean(active);
    // التعطيل يُبطل الجلسات فوراً في كل العمليات.
    if (!user.active) revokeUserSessions(id);
    persistState();

    console.log(`[RBAC] Owner changed user ${user.email} status to active=${user.active}`);
    return res.json({ success: true, user });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || "حدث خطأ أثناء تعديل الحالة." });
  }
});

// Delete user (ONLY Owner, CANNOT delete Owner)
app.delete("/api/users/:id", requireOwner, (req, res) => {
  try {
    const { id } = req.params;

    if (id === "owner") {
      return res.status(403).json({
        success: false,
        error: "لا يمكن حذف حساب مالك النظام (Owner).",
      });
    }

    const index = serverUsers.findIndex((u) => u.id === id);
    if (index === -1) {
      return res.status(404).json({ success: false, error: "المستخدم غير موجود." });
    }

    // Revoke sessions
    revokeUserSessions(id);

    serverUsers.splice(index, 1);
    persistState();
    console.log(`[RBAC] Owner deleted user with id ${id}`);
    return res.json({ success: true, message: "تم حذف المستخدم بنجاح." });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || "حدث خطأ أثناء حذف المستخدم." });
  }
});

// Persistent multi-platform control state. Accounts remain disconnected until a real OAuth/API callback explicitly marks them connected.
type PlatformConnection = { platform: string; status: "connected" | "reauth_needed" | "disconnected"; accountName?: string; accountId?: string; connectedAt?: string; lastSyncAt?: string; providerVerified?: boolean; provider?: string };
// مصدر الحقيقة الوحيد للمنصات وقدراتها هو سجل الموصلات (engine/social/registry.ts).
// القائمة مشتقة منه فلا يمكن أن تنحرف عن قدرات الموصلات الفعلية، وتظهر في شكل
// { id, name, capabilities } الذي تتوقعه بقية مسارات الخادم.
const SUPPORTED_PLATFORMS = PLATFORM_SPECS.map((spec) => ({
  id: spec.platform as string,
  name: spec.name,
  capabilities: [...spec.capabilities] as string[],
  credentialMode: spec.credentialMode,
  realConnector: spec.realConnector,
}));
const platformConnections = new Map<string, PlatformConnection>();

type OAuthPending = { platform: string; userId: string; expiresAt: number; codeVerifier?: string; redirectUri: string };
const pendingOAuth = new Map<string, OAuthPending>();
// المفتاح يُقرأ عند كل استخدام (لا يُلتقط وقت الإقلاع) حتى يعكس التشخيص البيئة
// الفعلية، ويُفكّ عبر التعريف الموحّد في engine/social/tokenKey.ts.
function tokenKeyInspection() { return inspectTokenKeyFromEnv(); }
function tokenKeyBytes() { return decodeTokenKey(process.env.PLATFORM_TOKEN_ENCRYPTION_KEY); }
function encryptSecret(value: string) {
  const key = tokenKeyBytes();
  if (!key) throw new Error(tokenKeyInspection().reason);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { alg: "aes-256-gcm", iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: encrypted.toString("base64url") };
}
function decryptSecret(record: any): string | null {
  try {
    const key = tokenKeyBytes(); if (!key || !record?.iv || !record?.tag || !record?.data) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(record.data, "base64url")), decipher.final()]).toString("utf8");
  } catch { return null; }
}
function setProviderToken(platform: string, token: any) {
  (workspace as any).providerTokens[platform] = encryptSecret(JSON.stringify(token));
  persistState();
}
function getProviderToken(platform: string): any | null {
  const raw = decryptSecret((workspace as any).providerTokens?.[platform]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function clearProviderToken(platform: string) { delete (workspace as any).providerTokens[platform]; persistState(); }

/**
 * العنوان العام المعتمد للتطبيق. يُحسم من مصدر واحد (publicUrl.ts) الذي يقرأ
 * APP_URL ثم بدائل المنصة (RENDER_EXTERNAL_URL/RENDER_EXTERNAL_HOSTNAME/
 * PUBLIC_URL/VERCEL_URL) ثم ترويسات الوسيط ثم localhost للتطوير. يُقرأ عند كل
 * استخدام (لا يُلتقط وقت الإقلاع) فيعكس البيئة الفعلية، ويُصلح سبب رفض Meta
 * لرابط الإرجاع عندما يكون APP_URL غير مضبوط على الإنتاج.
 */
function publicBaseUrlNow(): string { return resolvePublicUrl(process.env).baseUrl || `http://localhost:${PORT}`; }
/** مسار إرجاع OAuth لكل منصة (يُبنى دائماً من العنوان العام المعتمد). */
function oauthCallbackUrl(platform: string): string { return `${publicBaseUrlNow()}/api/platforms/${platform}/oauth/callback`; }
/**
 * يبني رابط تفويض حقيقي لأغراض الفحص فقط (بلا حفظ state ولا أي أثر). يُستخدم في
 * `oauth/setup` لعرض سلسلة قفزات Meta الفعلية بمسار الجوال بلا بدء OAuth. الحالة
 * رمزية ثابتة، ولا يُسجَّل الرابط ولا يُعاد.
 */
function buildAuthorizationUrlForProbe(platform: string): string {
  const cfg = OAUTH_CONFIG[platform];
  const scopes = platform === "facebook" ? facebookOAuthScopes() : platform === "instagram" ? instagramOAuthScopes() : cfg.scopes;
  const params = buildAuthorizationParams({
    platform,
    clientId: cfg.clientId,
    redirectUri: oauthCallbackUrl(platform),
    scopes,
    state: "probe",
    loginConfigId: META_OAUTH_PLATFORMS.has(platform) ? effectiveLoginConfigIdFor(platform) : null,
    // يجب أن يطابق الفحص الرابط الذي سيُولَّد فعلاً في /oauth/start: كان يفرض
    // تدفّق الإعداد مفعّلاً دائماً، فيُظهر `oauth/setup` و`dialogPhase` مساراً
    // مختلفاً عن المسار الحقيقي عندما يضبط المالك INSTAGRAM_OAUTH_ONBOARDING=false.
    instagramOnboarding: platform === "instagram" && instagramOnboardingEnabled(),
  });
  const u = new URL(authEndpointFor(platform));
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}
/**
 * صلاحيات Facebook Login الافتراضية. `business_management` إلزامي منذ Graph
 * v17 لعرض صفحات Business Manager عبر /me/accounts؛ بدونه يظهر الحساب «يدير
 * صفر صفحات» ويُرفض الربط بلا سبب ظاهر. يمكن تجاوزها من
 * FACEBOOK_OAUTH_SCOPES (قائمة مفصولة بفواصل) إن رفض Meta صلاحية في وضع Live
 * بلا مراجعة — فتبقى القدرة على الربط متاحة بلا تعديل كود.
 */
const FACEBOOK_DEFAULT_SCOPES = [...FACEBOOK_REQUIRED_SCOPES];
/**
 * الصلاحيات النهائية التي يطلبها OAuth. المصدر الواحد هو `FACEBOOK_REQUIRED_SCOPES`
 * في `engine/social/facebook.ts` (مع رسم الاعتماديات الرسمي). التجاوز من
 * `FACEBOOK_OAUTH_SCOPES` يُمرّ عبر `resolveFacebookScopes` الذي يضيف الاعتماديات
 * الناقصة تلقائياً، فلا يمكن لتجاوز ناقص أن ينتج «Invalid Scopes» أو يُسقط صلاحية
 * صامتة. هذا يضمن أن رد التعليقات (pages_manage_engagement) يصل دائماً بمرافقه
 * `pages_read_user_content`.
 */
function facebookScopeOverride(): string[] {
  return (process.env.FACEBOOK_OAUTH_SCOPES || "").split(",").map((s) => s.trim()).filter(Boolean);
}
function facebookOAuthScopes(): string[] {
  const override = facebookScopeOverride();
  return resolveFacebookScopes(override.length ? override : FACEBOOK_DEFAULT_SCOPES);
}
/** الاعتماديات الناقصة في تجاوز البيئة (بلا قيمة سرّية) — يُعرَض للتشخيص. */
function facebookScopeDependencyGaps(): string[] {
  return missingScopeDependenciesFromCsv(process.env.FACEBOOK_OAUTH_SCOPES);
}
/** تجاوز صلاحيات Instagram من البيئة (قائمة مفصولة بفواصل، مطبَّعة). */
function instagramScopeOverride(): string[] {
  return (process.env.INSTAGRAM_OAUTH_SCOPES || "").split(",").map((s) => s.trim()).filter(Boolean);
}
/**
 * صلاحيات Instagram API with Facebook Login. نفس مصدر الحقيقة في
 * `engine/social/instagram.ts` مع رسم الاعتماديات الرسمي. التجاوز من
 * `INSTAGRAM_OAUTH_SCOPES` يُمرّ عبر `resolveInstagramScopes` الذي يضيف
 * الاعتماديات الناقصة تلقائياً، فلا ينتج «Invalid Scopes» ولا صلاحية مُسقَطة.
 */
function instagramOAuthScopes(): string[] {
  const override = instagramScopeOverride();
  return resolveInstagramScopes(override.length ? override : INSTAGRAM_REQUIRED_SCOPES);
}
/** الاعتماديات الناقصة في تجاوز البيئة (بلا قيمة سرّية) — يُعرَض للتشخيص. */
function instagramScopeDependencyGaps(): string[] {
  return missingInstagramScopeDependenciesFromCsv(process.env.INSTAGRAM_OAUTH_SCOPES);
}
/**
 * مفتاح تشغيل تدفّق الإعداد الموحّد (extras=IG_API_ONBOARDING).
 *
 * سبب الوجود: عطل Meta المعروف (GraphQL error 1850019 «error during business
 * onboarding flow») يظهر بعد تسجيل الدخول ويرتبط بهذا المعامل. جعل المفتاح من
 * البيئة يحوّل المخرج إلى تغيير إعداد بلا تعديل كود أو إعادة نشر: عند ضبط
 * `INSTAGRAM_OAUTH_ONBOARDING=false` يمرّ الربط بالتدفّق العادي (response_type=code
 * عبر /me/accounts?fields=instagram_business_account) الذي يعمل. الافتراضي مفعّل
 * (التدفّق الرسمي الموثّق) حتى لا يتغيّر السلوك بلا قرار صريح.
 */
function instagramOnboardingEnabled(): boolean {
  const raw = String(process.env.INSTAGRAM_OAUTH_ONBOARDING ?? "").trim().toLowerCase();
  if (!raw) return true;
  return !(raw === "false" || raw === "0" || raw === "off" || raw === "no");
}
/**
 * قراءة قيمة بيئة مع تطبيع المسافات حولها.
 *
 * السبب: Render (أو لصق القيمة) قد يضيف سطراً/مسافة زائدة، فتبدو القيمة
 * «مضبوطة» بينما يرفضها المزود بلا سبب ظاهر — وهذا بالضبط ما كان ينتج
 * `invalid_client_secret` من Meta فيمنع بدء OAuth بـ409. التطبيع آمن لأنه
 * لا يغيّر قيمة نظيفة إطلاقاً، والقيمة الفارغة تبقى معتبرة غير مضبوطة.
 */
function envSecret(name: string): string | undefined {
  const v = process.env[name];
  if (typeof v !== "string") return undefined;
  return v.trim() || undefined;
}

/**
 * Configuration ID لـFacebook Login for Business: مسار Meta المعتمد الذي يمرّر
 * `config_id` بدل `scope` (الConfiguration تحمل الصلاحيات وحقول الوصول). الأولوية:
 * Instagram: INSTAGRAM_LOGIN_CONFIG_ID ثم FACEBOOK_LOGIN_CONFIG_ID؛ Facebook:
 * FACEBOOK_LOGIN_CONFIG_ID. يُقرأ عند كل استخدام (لا وقت الإقلاع) ليعكس البيئة.
 */
function loginConfigIdFor(platform: string): string | null { return resolveLoginConfigId(platform, process.env); }
/**
 * بوابة الحجب عند رصد Business Login بلا config_id.
 *
 * تصحيح جذر (2026-10-05): كان الافتراضي **الحجب**، وكان يُطلق عند أي علم
 * `is_business_login=1` من فحص Meta الحي. لكن الفحص الحي أثبت أن `is_business_login=1`
 * هو **السلوك الطبيعي لكل تطبيق** يطلب صلاحيات أعمال/صفحات (يظهر أيضاً لتطبيقات
 * مرجعية كلاسيكية مثل 145634995501895)، بينما يظهر `0` فقط عند طلب صلاحيات
 * استهلاكية (`public_profile`/`email`) أو بلا scope. أي أن العلم **لا يعني** أن
 * التطبيق من نوع Business ولا أن Configuration مطلوباً — فالحجب المبني عليه كان
 * **إيجاباً كاذباً** يمنع ربط أي تطبيق كلاسيكي يطلب صلاحيات صفحات.
 *
 * لذلك صار الافتراضي **السماح** (تمرير scope)، مع إمكانية استعادة الحجب الصارم
 * بمفتاح صريح `META_ALLOW_SCOPE_WITHOUT_CONFIG=false` (أو 0/off/no) لمن يثبت لديه
 * فعلاً أن تطبيقه Business ويلزمه config_id. القيم true/1/on/yes (أو أي قيمة أخرى)
 * تُبقي السماح. لا سرّ في هذا المفتاح ولا يغيّر أي صلاحية أو اتصال.
 */
function metaScopeWithoutConfigOverride(): boolean {
  const raw = String(process.env.META_ALLOW_SCOPE_WITHOUT_CONFIG ?? "").trim().toLowerCase();
  return !(raw === "false" || raw === "0" || raw === "off" || raw === "no");
}
/**
 * Configuration ID **المُطبَّق فعلاً** في رابط التفويض (قد يكون null رغم ضبط
 * المتغير). Configuration ID هو مطلب Facebook Login for Business: عند وجوده
 * يحلّ محل scope ويُلغي extras/display معاً (الConfiguration تحدّد الصلاحيات
 * وتجربة الدخول). لذلك يُطبَّق لـInstagram أيضاً متى كان مضبوطاً صالحاً، ويُعلن
 * `loginConfigIdUsed`/`permissionSource` مطابقاً لما يُرسَل فعلاً لا لما هو مضبوط.
 */
function effectiveLoginConfigIdFor(platform: string): string | null {
  return loginConfigIdFor(platform);
}
/** فحص الغياب/الصيغة غير الصالحة للConfiguration (بلا أي قيمة) للعرض التشخيصي. */
function loginConfigInspection(platform: string) {
  return inspectLoginConfigId(platform, process.env);
}
/** أسماء متغيرات Configuration ID المتوقعة لمنصة (للتوثيق، بلا قيم). */
function loginConfigEnvNames(platform: string): string[] {
  return [...(LOGIN_CONFIG_ENV_NAMES[platform] || [])];
}

const OAUTH_CONFIG: Record<string, any> = {
  // youtube.readonly يقابل استدعاءً حقيقياً منفّذاً (channels.list?mine=true) لإثبات
  // هوية القناة، وyoutube.upload بقي مطلوباً بقرار المالك تمهيداً لرفع الفيديو.
  // لا تُعلن قدرة نشر/تعليقات ما لم يُنفَّذ مسارها فعلاً (انظر YOUTUBE_CAPABILITY_MATRIX).
  youtube: { provider: "google", auth: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", clientId: envSecret("GOOGLE_OAUTH_CLIENT_ID") || envSecret("GOOGLE_CLIENT_ID"), clientSecret: envSecret("GOOGLE_OAUTH_CLIENT_SECRET"), scopes: [...YOUTUBE_REQUIRED_SCOPES] },
  google_business: { provider: "google", auth: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", clientId: envSecret("GOOGLE_OAUTH_CLIENT_ID") || envSecret("GOOGLE_CLIENT_ID"), clientSecret: envSecret("GOOGLE_OAUTH_CLIENT_SECRET"), scopes: ["https://www.googleapis.com/auth/business.manage"] },
  tiktok: { provider: "tiktok", auth: `https://www.tiktok.com/v2/auth/authorize/`, token: "https://open.tiktokapis.com/v2/oauth/token/", clientId: envSecret("TIKTOK_CLIENT_KEY"), clientSecret: envSecret("TIKTOK_CLIENT_SECRET"), scopes: [...TIKTOK_REQUIRED_SCOPES] },
  // business_management إلزامي منذ Graph v17 لعرض صفحات Business Manager عبر
  // /me/accounts؛ بدونه يظهر الحساب «يدير صفر صفحات» فاشلاً بلا سبب واضح.
  facebook: { provider: "meta", auth: `https://www.facebook.com${FACEBOOK_DIALOG_PATH}`, token: "https://graph.facebook.com/v21.0/oauth/access_token", clientId: envSecret("FACEBOOK_OAUTH_CLIENT_ID"), clientSecret: envSecret("FACEBOOK_OAUTH_CLIENT_SECRET"), scopes: facebookOAuthScopes() },
  instagram: { provider: "meta", auth: `https://www.facebook.com${FACEBOOK_DIALOG_PATH}`, token: "https://graph.facebook.com/v21.0/oauth/access_token", clientId: envSecret("INSTAGRAM_OAUTH_CLIENT_ID") || envSecret("FACEBOOK_OAUTH_CLIENT_ID"), clientSecret: envSecret("INSTAGRAM_OAUTH_CLIENT_SECRET") || envSecret("FACEBOOK_OAUTH_CLIENT_SECRET"), scopes: [...INSTAGRAM_REQUIRED_SCOPES] },
  x: { provider: "x", auth: "https://twitter.com/i/oauth2/authorize", token: "https://api.twitter.com/2/oauth2/token", clientId: envSecret("X_OAUTH_CLIENT_ID"), clientSecret: envSecret("X_OAUTH_CLIENT_SECRET"), scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"] },
  snapchat: { provider: "snapchat", auth: "https://accounts.snapchat.com/login/oauth2/authorize", token: "https://accounts.snapchat.com/login/oauth2/access_token", clientId: envSecret("SNAPCHAT_OAUTH_CLIENT_ID"), clientSecret: envSecret("SNAPCHAT_OAUTH_CLIENT_SECRET"), scopes: ["snapchat-marketing-api"] },
  threads: { provider: "meta", auth: "https://threads.net/oauth/authorize", token: "https://graph.threads.net/oauth/access_token", clientId: envSecret("THREADS_OAUTH_CLIENT_ID"), clientSecret: envSecret("THREADS_OAUTH_CLIENT_SECRET"), scopes: ["threads_basic", "threads_content_publish", "threads_manage_replies"] },
};
function oauthReady(platform: string) { const c = OAUTH_CONFIG[platform]; return Boolean(c?.clientId && c?.clientSecret && resolvePublicUrl(process.env).valid && tokenKeyBytes()); }
/** هل العنوان العام الحالي عام (https على نطاق غير محلي)؟ يلزم للربط الإنتاجي. */
function publicUrlIsPublic(): boolean { const u = resolvePublicUrl(process.env); return u.valid && u.scheme === 'https' && !!u.host && !isLocalHost(u.host); }

/**
 * دليل النشر: أي commit/فرع يعمل فعلاً الآن. Render يضبط RENDER_GIT_COMMIT في
 * بيئة الخدمة، فتُقارَن هذه القيمة بما هو مطلوب نشره لإثبات التطابق أو كشف انحراف
 * النشر. مقتطف 7 خانات فقط، بلا أي سرّ. تُعرض في /api/health و/api/readiness معاً
 * حتى لا يكون دليل النشر حبيس مسار واحد.
 */
function deploymentInfo() {
  const sha = (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "").trim();
  return {
    provider: process.env.RENDER ? "render" : process.env.NETLIFY ? "netlify" : "unknown",
    commit: sha ? sha.slice(0, 7) : null,
    branch: (process.env.RENDER_GIT_BRANCH || "").trim() || null,
    // زمن إقلاع هذه العملية: يميّز النسخة العاملة فعلاً عن نسخة قديمة أثناء/بعد
    // النشر (Render قد يخدم طلباً من نسخة سابقة لدقائق). commit وحده قد يُرى قديماً
    // بلا أن يكون النشر فاشلاً — فهذا الحقل يمنع الالتباس.
    startedAt: SERVER_STARTED_AT,
    nodeEnv: process.env.NODE_ENV || null,
  };
}

/**
 * سجل طلبات ملف تحقق TikTok الواصلة (في الذاكرة فقط، بلا أي سرّ). TikTok يطلب
 * الملف علناً من الإنترنت، فيجوز إظهار الاسم/الرمز/وكيل المستخدم/الوقت. الغرض:
 * عند فشل التحقق نرى **بالضبط** ما طلبه TikTok فعلاً (اسم الملف ورمزه) ونقارنه
 * بما نخدمه، بدل التخمين. السجل محصور (آخر N طلب) فلا ينمو بلا حدّ.
 */
interface VerificationRequestLog {
  count: number;
  firstAt: string | null;
  lastAt: string | null;
  last: VerificationRequestSnapshot | null;
  lastServed: VerificationRequestSnapshot | null;
  lastEcho: VerificationRequestSnapshot | null;
  lastMismatch: VerificationRequestSnapshot | null;
  recent: VerificationRequestSnapshot[];
}
const verificationRequestLog: VerificationRequestLog = {
  count: 0, firstAt: null, lastAt: null, last: null, lastServed: null, lastEcho: null, lastMismatch: null, recent: [],
};
/** عدّاد ذاكرة فقط منذ إقلاع هذه العملية (يُصفَّر عند كل cold start) — يميّز
 * «لم يصل شيء منذ الإقلاع» عن «وصل سابقاً وضاعت الذاكرة»، فيصير الصفر واضحاً. */
let verificationRequestBootCount = 0;
/** لحظة إقلاع العملية الحالية (ISO) — مرجع تفسير العدّاد والبصمة الزمنية. */
const PROCESS_STARTED_AT = new Date().toISOString();
const VERIFICATION_REQUEST_LOG_MAX = 20;

/** آخر طلب وصل برمز مختلف (للتوافق مع التشخيص السابق) — مشتقّ من السجل. */
let lastVerificationMismatch: { requestedToken: string; requestedFilename: string; at: string } | null = null;

/**
 * يسجّل **كل** طلب لملف تحقق (مطابقاً كان أو منحرفاً). اسم الملف والرمز عامان
 * بطبيعتهما فلا سرّ هنا، ووكيل المستخدم يُقطع عند حدّ آمن. سطر السجل يحمل الاسم
 * المطلوب والمخدوم فقط، فيُقرأ الانحراف مباشرة من سجلات الاستضافة بعد انتهاء
 * العملية (الحالة في الذاكرة تُفقد عند cold start).
 */
function recordVerificationRequest(req: express.Request): VerificationRequestSnapshot {
  const h = (name: string) => (typeof req.headers[name] === 'string' ? String(req.headers[name]) : '');
  const snapshot = captureVerificationRequest({
    pathname: req.path,
    originalUrl: req.originalUrl,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '',
    method: req.method,
    at: new Date().toISOString(),
    host: h('host'),
    forwardedHost: h('x-forwarded-host'),
    forwardedProto: h('x-forwarded-proto'),
    forwardedFor: h('x-forwarded-for'),
  });

  verificationRequestLog.count += 1;
  verificationRequestBootCount += 1;
  if (!verificationRequestLog.firstAt) verificationRequestLog.firstAt = snapshot.at;
  verificationRequestLog.lastAt = snapshot.at;
  verificationRequestLog.last = snapshot;
  if (snapshot.served) {
    verificationRequestLog.lastServed = snapshot;
    if (snapshot.servedViaEcho) verificationRequestLog.lastEcho = snapshot;
  } else {
    verificationRequestLog.lastMismatch = snapshot;
    lastVerificationMismatch = { requestedToken: snapshot.token, requestedFilename: snapshot.filename, at: snapshot.at };
  }
  verificationRequestLog.recent = [snapshot, ...verificationRequestLog.recent].slice(0, VERIFICATION_REQUEST_LOG_MAX);
  // الثبات عبر المخزن (Postgres/ملف) قبل الإقرار: على Render Free قد يُطفأ الخادم
  // بعد الرد فتضيع الذاكرة وحدها، فيظن المالك أن TikTok لم يطلب الملف إطلاقاً وهو
  // قد طلبه فعلًا قبل إعادة التشغيل. لا سرّ هنا (اسم/رمز عامان) فلا خطر بكتابته.
  saveControlState();

  const outcome = snapshot.served ? 'served' : (snapshot.mismatchReason || 'not-served');
  console.log(
    `[الغرابي AI] tiktok-verification-request file=${snapshot.filename} token=${snapshot.token || '-'} ` +
    `served=${snapshot.served ? 1 : 0} outcome=${outcome} host=${snapshot.host || '-'} proxy=${snapshot.viaProxy ? 1 : 0} ua=${snapshot.userAgent || '-'}`,
  );
  return snapshot;
}

/**
 * حالة التحقق من ملكية الرابط (TikTok URL prefix): الملف الرسمي الفعّال (اسم +
 * رابط + نوع) مبنياً من الرمز الفعّال، ومصدر الرمز (بيئة/مدموج) ليُقارَن بما في
 * لوحة TikTok، وسجل طلبات TikTok الواصلة (آخرها + آخر مطابق + آخر منحرف) — كلها
 * بلا أي سرّ (الاسم والرمز عامان بطبيعتهما).
 */
function siteVerificationState() {
  const urlInfo = resolvePublicUrl(process.env);
  const file = siteVerificationFiles()[0];
  return {
    platform: "tiktok",
    filename: file.filename,
    contentType: file.contentType,
    /** الرابط الذي يجب أن يكون عاماً وبلا تحويل (3xx مرفوض لدى TikTok). */
    url: verificationFileUrl(urlInfo.baseUrl, file.filename),
    altFilename: siteVerificationFiles()[1].filename,
    /** الرمز الفعّال (عام) ومصدره: متغير بيئة أم القيمة المدموجة. */
    token: file.filename.replace(/^tiktok/, "").replace(/\.txt$/, ""),
    tokenSource: (process.env[TIKTOK_VERIFICATION_TOKEN_ENV_NAME] || "").trim()
      ? `env:${TIKTOK_VERIFICATION_TOKEN_ENV_NAME}`
      : "default",
    tokenEnvName: TIKTOK_VERIFICATION_TOKEN_ENV_NAME,
    /** آخر طلب تحقق وصل فعلاً: الاسم/الرمز/وكيل المستخدم/الوقت + هل طابق ما نخدمه. */
    lastRequest: verificationRequestLog.last,
    /** آخر طلب تمكّن الخادم من خدمته (200) — دليل أن TikTok وصل وجُرِّب بنجاح. */
    lastServedRequest: verificationRequestLog.lastServed,
    /** آخر طلب لم يُخدَم (رمز مختلف/مسار فرعي/استعلام) — دليل الانحراف. */
    lastMismatchedRequest: verificationRequestLog.lastMismatch,
    requestCount: verificationRequestLog.count,
    firstRequestAt: verificationRequestLog.firstAt,
    lastRequestAt: verificationRequestLog.lastAt,
    /** آخر N طلب وصل (الأحدث أولاً) للفحص التفصيلي. */
    recentRequests: verificationRequestLog.recent,
    /**
     * وضوح الصفر: العدّاد المُثبت (postgres/ملف) يبقى بعد إعادة التشغيل، وهذا
     * عدّاد الذاكرة منذ إقلاع العملية الحالية. إن كان المثبت = 0 والمُقلع = 0 فلم
     * يطلب TikTok الملف إطلاقاً منذ آخر نشر؛ وإن كان المثبت > 0 والمُقلع = 0 فقد
     * طلبه سابقاً وضاعت الذاكرة فقط (cold start) — لا يعني غياب الطلب.
     */
    requestCountDurable: verificationRequestLog.count,
    requestCountSinceBoot: verificationRequestBootCount,
    processStartedAt: PROCESS_STARTED_AT,
    /** هل السجل محفوظ فعلاً في المخزن الدائم (postgres/ملف) لا في الذاكرة فقط؟ */
    logPersisted: storageAdapter.backend !== "file" || storageReady,
    /**
     * حكم صريح على معنى الحالة الآن، لتفسير الحالة بلا لبس:
     * - no_request_observed: لم يصل أي طلب لملف تحقق إطلاقاً.
     * - served_ok: آخر طلب خُدِم بالاسم الفعّال المطابق (200).
     * - served_echo_match: آخر طلب باسم رمز مختلف لكن خُدِم بتوقيعه المطابق (صدّى).
     * - token_differs_from_served: لم يُخدَم (لا ينبغي أن يقع الآن).
     * - not_at_root_path: وصل من مسار فرعي/غير جذري.
     */
    diagnosis: !verificationRequestLog.last
      ? "no_request_observed"
      : verificationRequestLog.last.served
        ? (verificationRequestLog.last.servedViaEcho ? "served_echo_match" : "served_ok")
        : verificationRequestLog.last.mismatchReason || "not_served",
    /** آخر طلب خُدِم بتوقيع مطابق لاسمه (صدّى) — يكشف رمز TikTok الجديد فوراً. */
    lastEchoRequest: verificationRequestLog.lastEcho,
    /** حقل توافق قديم: ملخّص آخر انحراف (طلب/رمز/وقت) أو null. */
    lastMismatch: lastVerificationMismatch,
    /** الملف يُخدَم من مسار ثابت في الخادم، لا من واجهة React. */
    servedBy: "static-route",
    publicUrlValid: urlInfo.valid,
    publicUrlIsPublic: publicUrlIsPublic(),
    redirects: false,
    /** صفحات الشروط/الخصوصية العامة (Terms/Privacy URLs) — بلا مصادقة. */
    legalPages: ["/terms", "/privacy"],
  };
}

// -------------------------------------------------------------
// Telegram — أول موصل اجتماعي حقيقي (bot-token، بلا OAuth ولا تسجيل تطبيق).
// الأسرار تُقرأ من بيئة الخادم فقط أو تُحفظ مشفّرة عبر محوّل الحالة.
// -------------------------------------------------------------
const TELEGRAM_WEBHOOK_SECRET_ENV = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
/** رمز البوت من التوكن المحفوظ المشفّر (ضبطه المالك) ثم بيئة الخادم. */
function telegramBotToken(): string {
  const stored = getProviderToken("telegram");
  if (stored?.botToken) return String(stored.botToken);
  return (process.env.TELEGRAM_BOT_TOKEN || "").trim();
}
/**
 * سرّ webhook الحقيقي الذي يتحقق منه Telegram في ترويسة كل تحديث.
 * المصدر المفضّل هو السرّ المحفوظ مشفّراً (الذي سُجّل فعلاً لدى Telegram)،
 * ثم سرّ البيئة TELEGRAM_WEBHOOK_SECRET كبديل أولي فقط.
 */
function telegramWebhookSecret(): string {
  const stored = getProviderToken("telegram");
  if (stored?.webhookSecret) return String(stored.webhookSecret);
  return TELEGRAM_WEBHOOK_SECRET_ENV;
}
/** يحفظ رمز البوت والسرّ مشفّرين في مخزن الحالة الحالي (بلا مفتاح حالة جديد). */
function saveTelegramCredentials(botToken: string, webhookSecret: string, webhookUrl?: string) {
  const existing = getProviderToken("telegram") || {};
  setProviderToken("telegram", {
    ...existing,
    botToken,
    webhookSecret,
    webhookUrl: webhookUrl || existing.webhookUrl || "",
    webhookRegisteredAt: webhookUrl ? new Date().toISOString() : existing.webhookRegisteredAt || null,
  });
}
/** الترويسة لا تُسجَّل ولا تُعاد أبداً؛ تُستخدم للتحقق فقط. */
const telegramFetchImpl: TelegramFetch = (url, init) => fetch(url, init as any);
function telegramClient(): TelegramClient | null {
  const token = telegramBotToken();
  if (!token) return null;
  // TELEGRAM_API_BASE يُستخدم في الاختبار لتوجيه الطلبات لخادم وهمي محلي فقط.
  return new TelegramClient(token, telegramFetchImpl, process.env.TELEGRAM_API_BASE);
}
/** رابط استقبال تحديثات Telegram لهذا الخادم (يستخدم APP_URL الرسمي). */
function telegramWebhookUrl(): string { return `${publicBaseUrlNow()}/api/platforms/telegram/webhook`; }
/**
 * تسجيل آمن لحدث Telegram الوارد. ممنوع تسجيل أي سرّ (رمز/ترويسة/نص رسالة).
 * يُقيَّد بالمعرّفات والنتيجة لتشخيص المسار من سجلات Render بلا كشف بيانات.
 */
function logTelegramWebhook(event: { updateId: number | null; externalId?: string | null; outcome: "accepted" | "duplicate" | "rejected" | "ignored"; persisted?: boolean }): void {
  const parts = ["[telegram-webhook]", `platform=telegram`, `outcome=${event.outcome}`, `update_id=${event.updateId ?? "-"}`];
  if (event.externalId) parts.push(`external=${event.externalId}`);
  if (typeof event.persisted === "boolean") parts.push(`persisted=${event.persisted}`);
  // معلومات فقط — لا أسرار ولا نصوص رسائل.
  console.log(parts.join(" "));
}
/** هل موصل Telegram الحقيقي مكتمل الإعداد الآن؟ */
function telegramConnectorConfigured(): boolean { return Boolean(telegramBotToken() && telegramWebhookSecret()); }

// -------------------------------------------------------------
// Facebook — ثاني موصل اجتماعي حقيقي (OAuth + Page Access Token).
// الأسرار تُقرأ من بيئة الخادم فقط أو تُحفظ مشفّرة عبر محوّل الحالة. لا يُعلن
// اتصال ولا يُرسل رد بلا إثبات فعلي من Meta Graph.
// -------------------------------------------------------------
const FACEBOOK_APP_SECRET_ENV = (process.env.FACEBOOK_APP_SECRET || "").trim();
const FACEBOOK_VERIFY_TOKEN_ENV = (process.env.FACEBOOK_VERIFY_TOKEN || "").trim();
const FACEBOOK_GRAPH_API_BASE_ENV = process.env.FACEBOOK_GRAPH_API_BASE;
/**
 * الحقول التي نشترك بها في webhook الصفحة. الافتراض هو التعليقات والرسائل
 * (المطلوب تشغيلياً)، ويمكن تعديله عبر FACEBOOK_SUBSCRIBED_FIELDS كما هو موثّق.
 */
const FACEBOOK_SUBSCRIBED_FIELDS = (() => {
  const raw = (process.env.FACEBOOK_SUBSCRIBED_FIELDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  return raw.length ? raw : ["feed", "messages"];
})();
const faceBookFetchImpl: FacebookFetch = (url, init) => fetch(url, init as any);
function facebookClient(): FacebookClient { return new FacebookClient(faceBookFetchImpl, FACEBOOK_GRAPH_API_BASE_ENV); }
function facebookOAuthConfig(): any { return OAUTH_CONFIG["facebook"]; }

// -------------------------------------------------------------
// Instagram — ثالث موصل اجتماعي حقيقي (Instagram API with Facebook Login).
// يُعاد استخدام تطبيق Meta نفسه ومسار OAuth نفسه، ويُضاف اكتشاف حساب
// Instagram للأعمال المرتبط بالصفحة واستقبال/رد/رسالة/نشر عبر Graph.
// الأسرار تُقرأ من بيئة الخادم أو تُحفظ مشفّرة عبر محوّل الحالة؛ لا تُسجَّل ولا تُعاد.
// -------------------------------------------------------------
const instagramFetchImpl: InstagramFetch = (url, init) => fetch(url, init as any);
function instagramClient(): InstagramClient { return new InstagramClient(instagramFetchImpl, FACEBOOK_GRAPH_API_BASE_ENV); }
function instagramOAuthConfig(): any { return OAUTH_CONFIG["instagram"]; }
/** حقول webhook لحساب Instagram المهني (تعليقات + رسائل). تُفعَّل من Meta Dashboard. */
const INSTAGRAM_SUBSCRIBED_FIELDS = (() => {
  const raw = (process.env.INSTAGRAM_SUBSCRIBED_FIELDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  return raw.length ? raw : [...INSTAGRAM_SUBSCRIBED_FIELDS_DEFAULT];
})();
/** سرّ توقيع webhook: نفس تطبيق Meta؛ يقبل INSTAGRAM_APP_SECRET ثم FACEBOOK_APP_SECRET. */
function instagramAppSecret(): string {
  const stored = getProviderToken("instagram");
  if (stored?.appSecret) return String(stored.appSecret);
  return (process.env.INSTAGRAM_APP_SECRET || process.env.FACEBOOK_APP_SECRET || "").trim();
}
/** رمز تحقق الاشتراك: يقبل INSTAGRAM_VERIFY_TOKEN ثم FACEBOOK_VERIFY_TOKEN. */
function instagramVerifyToken(): string {
  return (process.env.INSTAGRAM_VERIFY_TOKEN || process.env.FACEBOOK_VERIFY_TOKEN || "").trim();
}
/** رابط استقبال أحداث Instagram لهذا الخادم. */
function instagramWebhookUrl(): string { return `${publicBaseUrlNow()}/api/platforms/instagram/webhook`; }
/** رمز صفحة الاتصال الحالي (يُشتق من رمز المستخدم طويل الأجل) من الاعتماد المشفّر. */
function instagramPageToken(): string | null {
  const stored = getProviderToken("instagram");
  return stored?.pageAccessToken ? String(stored.pageAccessToken) : null;
}
function instagramPageId(): string | null {
  const stored = getProviderToken("instagram");
  return stored?.pageId ? String(stored.pageId) : null;
}
function instagramAccountId(): string | null {
  const stored = getProviderToken("instagram");
  return stored?.igAccountId ? String(stored.igAccountId) : null;
}
/** هل انتهى OAuth بنجاح لكن الحساب بلا حساب Instagram مهني مرتبط (أو عدة صفحات)؟ */
function instagramPageSelectionPending(): boolean {
  const stored = getProviderToken("instagram");
  if (!stored?.userAccessToken || stored?.pageId) return false;
  return stored?.pendingPageSelection === true;
}

// -------------------------------------------------------------
// Threads — رابع موصل اجتماعي حقيقي (Task #24). تطبيق Meta منفصل
// (separateOAuthClient:true، server.ts:8154) عن تطبيق Facebook الرئيسي، ويمرّ
// بمسار OAuth العام (لا فرع callback مخصّص) بعد إصلاح إلزامية إثبات الهوية.
// النشر فقط حالياً (حاوية + نشر + فحص حالة)؛ لا رد/تحليلات حقيقية بعد.
// -------------------------------------------------------------
const THREADS_GRAPH_API_BASE_ENV = process.env.THREADS_GRAPH_API_BASE;
const threadsFetchImpl: ThreadsFetch = (url, init) => fetch(url, init as any);
function threadsClient(): ThreadsClient { return new ThreadsClient(threadsFetchImpl, THREADS_GRAPH_API_BASE_ENV); }
/** رمز Threads المخزّن (مشفّر داخلياً) — يُقرأ عند كل استخدام. */
function threadsStoredCredentials(): any | null { return getProviderToken("threads"); }
function threadsAccessToken(): string | null {
  const stored = threadsStoredCredentials();
  return stored?.access_token ? String(stored.access_token) : null;
}
/** رمز Threads الطويل ينتهي بعد ~60 يوماً — نجدّده قبل الاستخدام إن انتهى معلنًا. */
function threadsAccessExpired(): boolean {
  const stored = threadsStoredCredentials();
  return isAccessTokenExpired({ expiresAt: stored?.expiresAt ?? null });
}
/** يحفظ اعتماد Threads مشفّراً (لا يُعاد ولا يُسجَّل). */
function saveThreadsCredentials(input: { accessToken: string; expiresAt?: number | null }) {
  const existing = threadsStoredCredentials() || {};
  setProviderToken("threads", { ...existing, access_token: input.accessToken, expiresAt: input.expiresAt ?? null });
}
/** يضبط حالة Threads على reauth_needed صراحةً (لا بقاء على connected بصمت). */
async function markThreadsReauthNeeded(reason: string): Promise<void> {
  const stored = threadsStoredCredentials() || {};
  const current: any = platformConnections.get("threads");
  platformConnections.set("threads", { platform: "threads", status: "reauth_needed", accountId: String(stored?.threadsUserId || current?.accountId || ""), connectedAt: stored?.connectedAt || current?.connectedAt || new Date().toISOString() });
  savePlatformConnections();
  await persistStateDurable();
  audit("system", "threads_reauth_needed", reason || "token_expired");
}
/**
 * تجديد قسري واحد للرمز الطويل عبر `grant_type=th_exchange_token` (وثيقة Threads؛
 * بلا client_secret). يُعيد الرمز الجديد أو null عند الفشل (لا نجاح وهمي).
 */
async function forceRefreshThreadsToken(): Promise<string | null> {
  const token = threadsAccessToken();
  if (!token) return null;
  const res = await threadsClient().refreshLongLivedToken(token);
  if (!res.ok || !res.data?.accessToken) {
    audit("system", "threads_refresh_failed", res.code || "provider_error");
    return null;
  }
  saveThreadsCredentials({ accessToken: res.data.accessToken, expiresAt: res.data.expiresIn ? Date.now() + res.data.expiresIn * 1000 : null });
  await persistStateDurable();
  audit("system", "threads_token_refreshed", "auto");
  return res.data.accessToken;
}
/**
 * يضمن رمز Threads صالحاً للتشغيل: يُجدّد الرمز الطويل عند انتهائه المعلَن.
 * إن لم يكن الانتهاء معلنًا (حساب مربوط قبل تخزين expiresAt) نُمرّره — ويُعالَج
 * الرفض الحقيقي من Meta في `withThreadsToken` بتجديد قسري.
 */
async function ensureThreadsAccessToken(): Promise<{ ok: boolean; token?: string; refreshed?: boolean; error?: string }> {
  const token = threadsAccessToken();
  if (!token) return { ok: false, error: "لا اعتماد Threads محفوظ؛ نفّذ الربط عبر OAuth أولاً." };
  if (!threadsAccessExpired()) return { ok: true, token, refreshed: false };
  const refreshed = await forceRefreshThreadsToken();
  if (!refreshed) {
    await markThreadsReauthNeeded("refresh_failed");
    return { ok: false, error: "فشل تجديد رمز Threads؛ أعد الربط." };
  }
  return { ok: true, token: refreshed, refreshed: true };
}
/**
 * غلاف موحّد ينفّذ عملية Threads برمز صالح مع تجديد تلقائي عند الحاجة.
 *
 * الإصلاح الجذري: حساب مربوط قبل تخزين `expiresAt` يجعل `ensureThreadsAccessToken`
 * يظنّ الرمز صالحاً (expiresAt=null ⇒ غير منتهٍ) فيُمرّره، ثم يرد Meta بـ190
 * «Session has expired» — فيتكرّر نفس الفشل صامتاً بلا أي محاولة تجديد. لذلك عند
 * فشل العملية بـTOKEN_EXPIRED رغم ذلك نُجرّب تجديداً قسرياً واحداً ثم نُعيد
 * المحاولة مرة واحدة؛ وإن فشل التجديد نُعلن `reauth_needed` صراحةً فلا تكرار صامت.
 */
async function withThreadsToken<T>(fn: (token: string) => Promise<{ ok: boolean; data: T | null; error?: string; code?: string | null; providerCode?: number | null; providerSubcode?: number | null; providerTraceId?: string | null }>): Promise<{ ok: boolean; data: T | null; error?: string; code?: string | null; providerCode?: number | null; providerSubcode?: number | null; providerTraceId?: string | null }> {
  const ensured = await ensureThreadsAccessToken();
  if (!ensured.ok || !ensured.token) return { ok: false, data: null, error: ensured.error, code: "TOKEN_EXPIRED" };
  const first = await fn(ensured.token);
  // الرمز بدا صالحاً لكن Meta رفضه كمنتهٍ (حساب قديم بلا expiresAt) ⇒ تجديد قسري واحد.
  if (!first.ok && first.code === "TOKEN_EXPIRED" && !ensured.refreshed) {
    const forced = await forceRefreshThreadsToken();
    if (!forced) {
      await markThreadsReauthNeeded("expired_at_provider");
      return { ok: false, data: null, error: first.error || "انتهى رمز Threads وفشل التجديد؛ أعد الربط.", code: "TOKEN_EXPIRED", providerCode: first.providerCode ?? 190 };
    }
    const retried = await fn(forced);
    // حتى الرمز المُجدَّد رُفض كمنتهٍ ⇒ الحاجة لإعادة ربط حقيقية (لا تكرار صامت).
    if (!retried.ok && retried.code === "TOKEN_EXPIRED") await markThreadsReauthNeeded("expired_after_refresh");
    return retried;
  }
  return first;
}
/** تسجيل آمن لحدث Instagram الوارد. ممنوع تسجيل أي سرّ أو نص رسالة. */
function logInstagramWebhook(event: { kind: string; externalId?: string | null; outcome: "accepted" | "duplicate" | "rejected" | "ignored"; persisted?: boolean }): void {
  const parts = ["[instagram-webhook]", "platform=instagram", `kind=${event.kind}`, `outcome=${event.outcome}`];
  if (event.externalId) parts.push(`external=${event.externalId}`);
  if (typeof event.persisted === "boolean") parts.push(`persisted=${event.persisted}`);
  console.log(parts.join(" "));
}
/** يحفظ اعتماد Instagram مشفّراً (رمز الصفحة + حساب IG + سرّ التوقيع) بلا كشفه. */
function saveInstagramCredentials(input: { pageId: string; pageName?: string | null; igAccountId: string; igUsername?: string | null; pageAccessToken: string; userAccessToken?: string | null; appSecret?: string }) {
  const existing = getProviderToken("instagram") || {};
  setProviderToken("instagram", {
    ...existing,
    pageId: input.pageId,
    pageName: input.pageName || existing.pageName || "",
    igAccountId: input.igAccountId,
    igUsername: input.igUsername || existing.igUsername || "",
    pageAccessToken: input.pageAccessToken,
    userAccessToken: input.userAccessToken || existing.userAccessToken || "",
    appSecret: input.appSecret || existing.appSecret || instagramAppSecret() || "",
    connectedAt: existing.connectedAt || new Date().toISOString(),
  });
}
/**
 * يثبت حساب Instagram مهنياً مرتبطاً بصفحة محدّدة فعلياً، يشترك تطبيقنا في أحداث
 * الصفحة (تعليقات/رسائل)، ثم يحفظ الاعتماد ويعلن الاتصال الموثق. لا يُعلن الاتصال
 * بلا استجابة مزود حقيقية، ولا يُقبل حساب شخصي (يلزم instagram_business_account).
 */
async function instagramFinalizeAccountSelection(pageId: string, userAccessToken: string): Promise<{ ok: boolean; pageName?: string | null; igAccountId?: string; igUsername?: string | null; subscribed?: boolean; subscribedFields?: string[]; error?: string }> {
  const client = instagramClient();
  const proof = await client.getLinkedInstagramAccount(pageId, userAccessToken);
  if (!proof.ok || !proof.data?.igAccountId) {
    return { ok: false, error: proof.error || "تعذّر إثبات حساب Instagram المهني المرتبط بالصفحة." };
  }
  const pageToken = proof.data.pageAccessToken || userAccessToken;
  // إثبات إضافي لهوية حساب Instagram نفسه — لا نعتمد على الصفحة وحدها.
  const identity = await client.getInstagramProfile(proof.data.igAccountId, pageToken);
  const igUsername = identity.data?.igUsername || proof.data.igUsername || null;
  const sub = await client.subscribePage(pageId, pageToken, INSTAGRAM_SUBSCRIBED_FIELDS);
  let subscribedFields: string[] | undefined;
  if (sub.ok) {
    const read = await client.getSubscribedFields(pageId, pageToken);
    subscribedFields = read.data || undefined;
  }
  saveInstagramCredentials({
    pageId: proof.data.pageId,
    pageName: proof.data.pageName,
    igAccountId: proof.data.igAccountId,
    igUsername,
    pageAccessToken: pageToken,
    userAccessToken,
  });
  platformConnections.set("instagram", { platform: "instagram", status: "connected", accountId: proof.data.igAccountId, accountName: igUsername ? `@${igUsername}` : (proof.data.pageName || "Instagram"), connectedAt: new Date().toISOString(), providerVerified: true });
  savePlatformConnections();
  return { ok: true, pageName: proof.data.pageName, igAccountId: proof.data.igAccountId, igUsername, subscribed: sub.ok, subscribedFields, error: sub.ok ? undefined : sub.error };
}
/** هل موصل Instagram مكتمل الإعداد للاتصال؟ (تطبيق Meta + مفتاح تشفير + عنوان عام). */
function instagramConnectorConfigured(): boolean {
  const c = instagramOAuthConfig();
  return Boolean(c?.clientId && c?.clientSecret && publicUrlIsPublic() && tokenKeyBytes());
}
/** منصات Meta التي يشترك مسار حوارها في نفس القواعد (client_id + scope بفواصل). */
const META_OAUTH_PLATFORMS = new Set(["facebook", "instagram"]);

// -------------------------------------------------------------
// TikTok — رابع موصل اجتماعي حقيقي (OAuth 2.0 + PKCE + Content Posting API).
// لا يُعلن اتصال ولا يُسجَّل نشر بلا استجابة TikTok فعلية ومعرّف من المزود.
// التعليقات والرسائل المباشرة غير متاحة عبر الواجهة العامة → لا مسارات لها.
// الأسرار تُقرأ من بيئة الخادم أو تُحفظ مشفّرة عبر محوّل الحالة؛ لا تُسجَّل ولا تُعاد.
// -------------------------------------------------------------
const tiktokFetchImpl: TikTokFetch = (url, init) => fetch(url, init as any);
function tiktokClient(): TikTokClient { return new TikTokClient(tiktokFetchImpl, process.env.TIKTOK_API_BASE); }
function tiktokOAuthConfig(): any { return OAUTH_CONFIG["tiktok"]; }
/**
 * الصلاحيات النهائية التي يطلبها TikTok OAuth. المصدر الواحد هو
 * `TIKTOK_REQUIRED_SCOPES` (المشتقة من القدرات المنفّذة فعلاً). التجاوز من
 * `TIKTOK_OAUTH_SCOPES` يُمرّ عبر `resolveTikTokScopes` فلا يُضاف نطاق بلا
 * استدعاء حقيقي، ولا يُطلب نطاق غير مُنفَّذ.
 */
function tiktokScopeOverride(): string[] {
  return (process.env.TIKTOK_OAUTH_SCOPES || "").split(",").map((s) => s.trim()).filter(Boolean);
}
function tiktokOAuthScopes(): string[] {
  return resolveTikTokScopes(tiktokScopeOverride().length ? tiktokScopeOverride() : TIKTOK_REQUIRED_SCOPES);
}
/** هل موصل TikTok مكتمل الإعداد للاتصال؟ (client_key + client_secret + عنوان عام + مفتاح تشفير). */
function tiktokConnectorConfigured(): boolean {
  const c = tiktokOAuthConfig();
  return Boolean(c?.clientId && c?.clientSecret && publicUrlIsPublic() && tokenKeyBytes());
}
/** اعتماد TikTok المحفوظ مشفّراً (رمز الوصول + refresh + open_id + الانتهاء). */
function tiktokStoredCredentials(): any | null { return getProviderToken("tiktok"); }
function tiktokAccessToken(): string | null {
  const stored = tiktokStoredCredentials();
  return stored?.accessToken ? String(stored.accessToken) : null;
}
function tiktokOpenId(): string | null {
  const stored = tiktokStoredCredentials();
  return stored?.openId ? String(stored.openId) : null;
}
/** هل يوجد refresh token محفوظ (لتجديد الاتصال بلا إعادة ربط)؟ */
function tiktokRefreshToken(): string | null {
  const stored = tiktokStoredCredentials();
  return stored?.refreshToken ? String(stored.refreshToken) : null;
}
/** هل انتهى رمز الوصول TikTok (بهامش أمان)؟ */
function tiktokAccessExpired(): boolean {
  const stored = tiktokStoredCredentials();
  return isAccessTokenExpired({ expiresAt: stored?.expiresAt ?? null });
}
/** رابط استقبال أحداث TikTok لهذا الخادم (يُسجَّل في Developer Portal). */
function tiktokWebhookUrl(): string { return `${publicBaseUrlNow()}/api/platforms/tiktok/webhook`; }
/** سرّ توقيع webhooks TikTok هو client_secret نفسه (نمط TikTok-Signature). */
function tiktokSigningSecret(): string {
  const stored = tiktokStoredCredentials();
  if (stored?.clientSecret) return String(stored.clientSecret);
  return (process.env.TIKTOK_CLIENT_SECRET || "").trim();
}
/** تسجيل آمن لحدث TikTok الوارد. ممنوع تسجيل أي سرّ أو محتوى. */
function logTikTokWebhook(event: { event: string; externalId?: string | null; outcome: "accepted" | "duplicate" | "rejected" | "ignored"; persisted?: boolean }): void {
  const parts = ["[tiktok-webhook]", "platform=tiktok", `event=${event.event}`, `outcome=${event.outcome}`];
  if (event.externalId) parts.push(`external=${event.externalId}`);
  if (typeof event.persisted === "boolean") parts.push(`persisted=${event.persisted}`);
  console.log(parts.join(" "));
}
/** تسجيل آمن لبدء/عودة TikTok OAuth — بلا state ولا code ولا أي سرّ. */
function logTikTokOAuth(outcome: string, detail: Record<string, unknown> = {}): void {
  const parts = ["[tiktok-oauth]", `outcome=${outcome}`];
  for (const [k, v] of Object.entries(detail)) {
    if (v === undefined || v === null) continue;
    if (k === "state" || k === "code" || k === "token" || k === "fragment") continue; // حماية صريحة
    parts.push(`${k}=${String(v).slice(0, 120)}`);
  }
  console.log(parts.join(" "));
}
/**
 * يحفظ اعتماد TikTok مشفّراً (رمز الوصول + refresh + open_id + الهوية + الانتهاء).
 * client_secret يُحفظ أيضاً لأنه سرّ توقيع webhooks، ولا يُعاد في أي استجابة.
 */
function saveTikTokCredentials(input: { accessToken: string; refreshToken?: string | null; openId: string; displayName?: string | null; avatarUrl?: string | null; scope?: string[]; expiresAt?: number | null; refreshExpiresAt?: number | null; clientSecret?: string }) {
  const existing = tiktokStoredCredentials() || {};
  setProviderToken("tiktok", {
    ...existing,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken || existing.refreshToken || "",
    openId: input.openId,
    displayName: input.displayName || existing.displayName || "",
    avatarUrl: input.avatarUrl || existing.avatarUrl || "",
    scope: Array.isArray(input.scope) ? input.scope : (existing.scope || []),
    expiresAt: input.expiresAt ?? existing.expiresAt ?? null,
    refreshExpiresAt: input.refreshExpiresAt ?? existing.refreshExpiresAt ?? null,
    clientSecret: input.clientSecret || existing.clientSecret || tiktokOAuthConfig()?.clientSecret || "",
    connectedAt: existing.connectedAt || new Date().toISOString(),
  });
}
/**
 * يجدّد رمز الوصول عبر refresh_token عند انتهائه (تلقائياً قبل أي عملية).
 * إن لم يوجد refresh token أو فشل التجديد، يُعلن الحاجة لإعادة الربط بدل الفشل الصامت.
 */
async function ensureTikTokAccessToken(): Promise<{ ok: boolean; token?: string; refreshed?: boolean; error?: string }> {
  const stored = tiktokStoredCredentials();
  const token = tiktokAccessToken();
  if (!token) return { ok: false, error: "لا رمز TikTok محفوظ؛ نفّذ الربط عبر OAuth أولاً." };
  if (!tiktokAccessExpired()) return { ok: true, token, refreshed: false };
  const refresh = tiktokRefreshToken();
  const cfg = tiktokOAuthConfig();
  if (!refresh || !cfg?.clientId || !cfg?.clientSecret) {
    platformConnections.set("tiktok", { platform: "tiktok", status: "reauth_needed", accountId: String(stored?.openId || ""), connectedAt: new Date().toISOString() });
    savePlatformConnections();
    return { ok: false, error: "انتهى رمز TikTok ولا يوجد refresh token؛ أعد الربط من مركز ربط المنصات." };
  }
  const res = await tiktokClient().refreshToken({ clientKey: String(cfg.clientId), clientSecret: String(cfg.clientSecret), refreshToken: refresh });
  if (!res.ok || !res.data?.accessToken) {
    // لا فشل صامت: يُعلن أن الاتصال يحتاج إعادة ربط حقيقية بدل ادعاء اتصال قائم.
    platformConnections.set("tiktok", { platform: "tiktok", status: "reauth_needed", accountId: String(stored?.openId || ""), connectedAt: new Date().toISOString() });
    savePlatformConnections();
    await persistStateDurable();
    audit("system", "tiktok_refresh_failed", res.code || "provider_error");
    return { ok: false, error: res.error || "فشل تجديد رمز TikTok؛ أعد الربط." };
  }
  saveTikTokCredentials({
    accessToken: res.data.accessToken,
    refreshToken: res.data.refreshToken || refresh,
    openId: res.data.openId || String(stored?.openId || ""),
    scope: res.data.scope,
    expiresAt: res.data.expiresIn ? Date.now() + res.data.expiresIn * 1000 : null,
    refreshExpiresAt: res.data.refreshExpiresIn ? Date.now() + res.data.refreshExpiresIn * 1000 : null,
  });
  await persistStateDurable();
  audit("system", "tiktok_token_refreshed", "auto");
  return { ok: true, token: res.data.accessToken, refreshed: true };
}
/**
 * ينفّذ استدعاءً محمياً برمز TikTok مع تجديد تلقائي عند الانتهاء. غلاف واحد
 * يمنع تكرار منطق التجديد في كل مسار.
 */
async function withTikTokToken<T>(fn: (token: string) => Promise<{ ok: boolean; data: T | null; error?: string; code?: string | null }>): Promise<{ ok: boolean; data: T | null; error?: string; code?: string | null }> {
  const ensured = await ensureTikTokAccessToken();
  if (!ensured.ok || !ensured.token) return { ok: false, data: null, error: ensured.error };
  const result = await fn(ensured.token);
  return result;
}
/** هل موصل TikTok مكتمل ومتصل وموثق الآن؟ */
function tiktokOperationalNow(): boolean {
  const conn: any = platformConnections.get("tiktok");
  return Boolean(conn?.status === "connected" && conn?.providerVerified === true && hasRealConnector("tiktok"));
}
/** حالة قيد مراجعة TikTok (audit): النشر المباشر العام محصور حتى الاجتياز. */
function tiktokAuditRequired(): boolean {
  return tiktokCapabilityNeedsAudit("content_posting_direct");
}
/**
 * دليل مزود على إتمام سير عمل رسمي لـTikTok: سجل نشر حُدِّث إلى `published`
 * بعد استعلام حالة أعاد PUBLISH_COMPLETE (providerPostId حقيقي). لا يُعلن
 * OPERATIONAL بلا هذا الدليل — لا بالتخمين.
 */
function tiktokOperationalEvidence(): boolean {
  const records = (workspace as any).publishRecords;
  if (!Array.isArray(records)) return false;
  return records.some((r: any) => r.platform === "tiktok" && r.state === "published" && Boolean(r.providerPostId));
}
/**
 * هل توجد جلسة تفويض TikTok معلّقة (بدأ المالك الربط ولم تكتمل العودة)؟
 * تُقرأ من الحالة الذاكرية الصامدة (pendingOAuth) — بلا أي سرّ.
 */
function tiktokPendingAuthorization(): boolean {
  for (const p of pendingOAuth.values()) if (p.platform === "tiktok" && p.expiresAt > Date.now()) return true;
  return false;
}
/**
 * الحالة الصادقة الموحّدة لموصل TikTok — مصدرها الواحد `resolveTikTokState`.
 * تُجمّع الحقائق الحية فقط (بلا أي سرّ) وتُترجم إلى مفردة حالة واحدة دقيقة.
 */
function tiktokTruthfulState(): ReturnType<typeof resolveTikTokState> {
  const c = tiktokOAuthConfig();
  const stored = tiktokStoredCredentials();
  const conn: any = platformConnections.get("tiktok");
  const tk = tokenKeyInspection();
  const verified = Boolean(conn?.status === "connected" && conn?.providerVerified === true && stored?.openId);
  return resolveTikTokState({
    clientKeyConfigured: Boolean(c?.clientId),
    clientSecretConfigured: Boolean(c?.clientSecret),
    clientKeyFormatOk: isPlausibleTikTokClientKey(String(c?.clientId || "")),
    encryptionKeyValid: tk.state === "valid",
    publicUrlValid: resolvePublicUrl(process.env).valid,
    pendingAuthorization: tiktokPendingAuthorization(),
    tokenStored: Boolean(stored?.accessToken),
    refreshTokenStored: Boolean(stored?.refreshToken),
    tokenExpired: Boolean(stored?.accessToken) && tiktokAccessExpired(),
    connectionStatus: conn?.status === "connected" ? "connected" : conn?.status === "reauth_needed" ? "reauth_needed" : "disconnected",
    accountDiscovered: Boolean(stored?.openId),
    providerVerified: verified,
    operationalEvidence: tiktokOperationalEvidence(),
    directPostAuditRequired: tiktokAuditRequired(),
  });
}

/**
 * مصالحة حالة نشر TikTok تلقائياً: أي سجل غير محسوم (`publishing`) له
 * `providerPublishId` يُستعلم عنه من TikTok (`status/fetch`) ويُحدَّث وفق الدليل
 * الفعلي. لا يُعلن `published` ولا يثبت `providerPostId` إلا بحالة PUBLISH_COMPLETE.
 * لا استعلام على سجل منتهٍ، ولا تكرار لاستعلام جارٍ، والحد 5 سجلات لكل دورة.
 * هذا يجعل التسليم يُحسم تلقائياً بلا تدخّل المالك — والعكس صحيح: بلا تأكيد المزود
 * يبقى السجل `publishing` صراحةً.
 */
const tiktokReconcileInFlight = new Set<string>();
// PROC-01/Phase 6: قفل يمنع تداخل دورتي مصالحة متزامنتين (نبضة كل 60s قد تتقاطع مع
// استعلام مزود بطيء). النبضة التالية تُتخطّى بلا عمل بدل تراكم استعلامات.
let tiktokReconcileRunning = false;
async function reconcileTikTokPublishes(): Promise<{ checked: number; delivered: number; failed: number; stillPending: number }> {
  const result = { checked: 0, delivered: 0, failed: 0, stillPending: 0 };
  if (tiktokReconcileRunning) return result;
  tiktokReconcileRunning = true;
  try {
  if (!tiktokOperationalNow()) return result;
  const records = (workspace as any).publishRecords;
  if (!Array.isArray(records)) return result;
  const due = records
    .filter((r: any) => r.platform === "tiktok" && shouldReconcileTikTokRecord(r, tiktokReconcileInFlight.has(String(r.providerPublishId))))
    .slice(0, 5);
  if (!due.length) return result;
  const ensured = await ensureTikTokAccessToken();
  if (!ensured.ok || !ensured.token) return result;
  let changed = false;
  for (const rec of due) {
    const publishId = String(rec.providerPublishId);
    tiktokReconcileInFlight.add(publishId);
    result.checked += 1;
    try {
      const res = await tiktokClient().fetchPublishStatus(ensured.token, publishId);
      if (!res.ok || !res.data) continue;
      const applied = applyTikTokPublishStatus(rec, res.data);
      rec.state = applied.state;
      rec.providerPostId = applied.providerPostId;
      rec.deliveryDetail = applied.detail;
      rec.lastCheckedAt = new Date().toISOString();
      if (applied.delivered) result.delivered += 1;
      else if (applied.state === "failed") result.failed += 1;
      else result.stillPending += 1;
      changed = true;
    } catch {
      /* تعذّر الاستعلام: يبقى السجل غير محسوم بلا ادعاء */
    } finally {
      tiktokReconcileInFlight.delete(publishId);
    }
  }
  if (changed) await persistStateDurable();
  return result;
  } finally {
    tiktokReconcileRunning = false;
  }
}

/**
 * تشخيص مفتاح تطبيق TikTok: أي متغيّر بيئة يُقرأ فعلاً، بأي قيمة (مُخفاة)، وأي
 * `client_key` يظهر في رابط التفويض المولَّد، ونتيجة إثبات المفتاح لدى TikTok.
 * الـclient_key ليس سرّاً (يظهر علناً في الرابط)، والمقارنة تجري ببصمة وطول
 * وقيمة مُخفاة (أول 4 وآخر 4) فيُثبت التطابق أو يكشف الانحراف بلا كشف أي سرّ.
 * يُقرأ من البيئة عند كل نداء (لا وقت الإقلاع) ليعكس القيمة الفعلية المنشورة.
 */
async function tiktokClientKeyDiagnosis(): Promise<any> {
  const cfg = tiktokOAuthConfig();
  const rawEnv = process.env.TIKTOK_CLIENT_KEY;
  // القيمة الفعلية المستخدمة في بناء الرابط هي cfg.clientId (مُطبَّعة عبر envSecret).
  const usedKey = String(cfg?.clientId || "");
  const envFp = clientKeyFingerprint(rawEnv);
  const usedFp = clientKeyFingerprint(usedKey);

  // الرابط الفعلي كما سيُولَّد الآن لـOAuth (نفس buildAuthorizationUrlForProbe).
  let authorizationClientKey = "";
  let authorizationUrlHost = "";
  try {
    const probeUrl = buildAuthorizationUrlForProbe("tiktok");
    const parsed = new URL(probeUrl);
    authorizationClientKey = parsed.searchParams.get("client_key") || "";
    authorizationUrlHost = parsed.host;
  } catch { /* لا يُحجب التشخيص إن تعذّر بناء الرابط */ }
  const urlFp = clientKeyFingerprint(authorizationClientKey);

  // إثبات المفتاح لدى TikTok بطلب عميل واحد فعلي (client_credentials) — بلا رمز
  // مستخدم وبلا جلسة. يُنفَّذ فقط إن وُجد مفتاح وسرّ، وإلا يُعلن السبب صريحاً.
  let providerProof: any = { attempted: false, reason: "credentials_missing" };
  if (usedKey && cfg?.clientSecret) {
    try {
      const res = await tiktokClient().verifyClientKey({ clientKey: usedKey, clientSecret: String(cfg.clientSecret) });
      providerProof = {
        attempted: true,
        reachable: res.ok,
        recognized: res.data?.recognized ?? null,
        kind: res.data?.classified?.kind ?? res.code ?? null,
        hint: res.data?.classified?.hintAr ?? res.error ?? null,
        rawError: res.data?.rawError ?? null,
        rawDescription: res.data?.rawDescription ?? null,
      };
    } catch (e: any) {
      providerProof = { attempted: true, reachable: false, recognized: null, kind: "network", hint: String(e?.message || "تعذّر الاتصال بـTikTok.") };
    }
  }

  const credentialsMatchUrl = Boolean(urlFp.configured) && envFp.sha256Prefix === urlFp.sha256Prefix;
  const expectedOnDevelopersPortal = usedFp.configured
    ? `${usedFp.masked} (length ${usedFp.length}, sha256:${usedFp.sha256Prefix})`
    : null;

  return {
    envVarName: "TIKTOK_CLIENT_KEY",
    // القيمة المُخفاة (أول 4 وآخر 4) للبيئة وللقيمة المستخدَمة في الرابط.
    configuredValueMasked: envFp.masked,
    configuredValueLength: envFp.length,
    configuredValueSha256Prefix: envFp.sha256Prefix,
    configuredFormatOk: envFp.formatOk,
    // هل البيئة تحمل مسافة/سطراً زائداً اكتُشف قبل التطبيع؟
    hadSurroundingWhitespace: typeof rawEnv === "string" && rawEnv.length > 0 && rawEnv.trim() !== rawEnv,
    // نفس القيمة تستخدمها القناة الوحيدة (envSecret) في buildAuthorizationParams.
    usedInAuthorizationUrlMasked: urlFp.masked,
    usedInAuthorizationUrlLength: urlFp.length,
    usedInAuthorizationUrlSha256Prefix: urlFp.sha256Prefix,
    authorizationUrlHost,
    authorizationClientKeyMatchesEnv: credentialsMatchUrl,
    // ما يجب أن يطابقه Client key في لوحة TikTok Developers (نفس البصمة).
    expectedDevelopersPortalClientKey: expectedOnDevelopersPortal,
    providerProof,
    // الحكم: نفس القيمة في البيئة والرابط (القناة واحدة)، ويُثبته مزود TikTok.
    verdict: providerProof.attempted
      ? providerProof.recognized === true
        ? "recognized_by_tiktok"
        : providerProof.reachable === false
          ? "provider_unreachable"
          : "not_recognized_by_tiktok"
      : "credentials_missing",
    note: "الـclient_key عام (يظهر في رابط التفويض) فلا يُسرّب شيئاً؛ ومع ذلك يُعرض مُخفىً (أول 4 وآخر 4) مع بصمة SHA-256 مقتطعة للمقارنة مع لوحة TikTok Developers.",
  };
}

/** تخزين مؤقت قصير لنتيجة فحص بدء OAuth (يمنع إغراق Meta عند كل ضغطة زر). */
const oauthStartPreflightCache = new Map<string, { at: number; result: any }>();
const OAUTH_PREFLIGHT_TTL_MS = 5 * 60 * 1000;
/**
 * آخر نتيجة فحص لبدء OAuth لكل منصة (نجاح أو فشل). تُعرَض في `oauth/setup`
 * ليتأكد المالك من سبب الحجب (`appTokenKind`) داخل الواجهة بلا حاجة لسجلات
 * Render — وبلا أي سرّ ولا استدعاء Graph إضافي.
 */
const lastOAuthPreflight = new Map<string, { at: number; code: string | null; appTokenKind: string | null; error?: string; hint?: string }>();

/**
 * سجل بدء OAuth آمن: بلا أي سرّ ولا توكن — فقط المنصة والنتيجة والفاتورة.
 * الغرض تشخيص مسار «حدث خطأ ما» من سجلات Render بلا كشف بيانات.
 */
function logOAuthStart(platform: string, detail: Record<string, unknown>): void {
  try { console.log(`[oauth] ${platform} ${JSON.stringify(detail)}`); } catch { /* التسجيل غير حرج */ }
}

/** وصف مشكلة معرّف تطبيق Meta بلا كشف السرّ (شكل فقط، لا قيمة). */
function describeMetaAppIdProblem(clientId: unknown): string | null {
  if (typeof clientId !== "string" || !clientId) return "FACEBOOK_OAUTH_CLIENT_ID غير مضبوط.";
  if (!isPlausibleMetaAppId(clientId)) {
    const trimmedChanged = clientId.trim() !== clientId;
    return trimmedChanged
      ? "FACEBOOK_OAUTH_CLIENT_ID يحمل مسافة/سطراً زائداً؛ هذا يجعل Meta ترد «حدث خطأ ما». احذف المسافات."
      : "FACEBOOK_OAUTH_CLIENT_ID ليس أرقاماً فقط (App ID هو رقم 15–16 خانة من Meta App Dashboard).";
  }
  return null;
}

interface OAuthStartPreflight {
  ok: boolean;
  /** رمز صريح لنوع الحجب: INVALID_APP_ID_FORMAT / META_APP_ID_INVALID / META_APP_SECRET_INVALID / META_UNAVAILABLE_FORMAT */
  code?: string;
  error?: string;
  hint?: string;
  /** نتيجة فحص Graph لمعرّف/سرّ التطبيق (منصات Meta فقط). */
  appToken?: { kind: string; message: string; code: number | null } | null;
  /** هل سيُستخدم مسار Facebook Login for Business (config_id) بدل scope؟ */
  loginConfigIdUsed?: boolean;
  /** فحص Configuration ID (غياب/صيغة) — بلا أي قيمة سرّية. */
  loginConfig?: { configured: boolean; valid: boolean; envName: string | null; problems: string[] } | null;
}

/**
 * فحص ما قبل إنشاء رابط الحوار — يمنع إرسال المالك إلى «حدث خطأ ما».
 *
 * الفرق بين هذا الفحص ومشكلة ضغط الموديل: هنا لا نخفي شيئاً. الفحص:
 *  0) لـMeta مع Facebook Login for Business: صيغة Configuration ID إن وُجد
 *     (أي مسافة/حرف => Meta ترفض أو تعرض صفحة عامة). الغياب يبقى مقبولاً (تطوير).
 *  1) شكل معرّف التطبيق رقمياً (أي مسافة أو حرف => Meta ترد «حدث خطأ ما»).
 *  2) لـMeta: طلب client_credentials حقيقي يثبت أن client_id + secret صالحان
 *     (code 101 «Invalid Client ID» هو السبب المطابق تماماً لصفحة Meta العامة).
 * وعند فشل الفحص نُعلن السبب والإجراء بدل توليد رابط سيفشل حتماً.
 */
async function oauthStartPreflight(platform: string): Promise<OAuthStartPreflight> {
  const cfg = OAUTH_CONFIG[platform];
  if (!cfg) return { ok: false, code: "NO_CONFIG", error: "مزود غير مُعدّ." };
  if (META_OAUTH_PLATFORMS.has(platform)) {
    // 0) Configuration ID: صيغة صريحة، بلا قيمة سرّية. المضبوط بشكل غير صالح
    // يُحجب محلياً بدل إرسال المالك إلى رفض Meta الغامض.
    const loginConfig = loginConfigInspection(platform);
    if (loginConfig.configured && !loginConfig.valid) {
      const result: OAuthStartPreflight = {
        ok: false,
        code: "LOGIN_CONFIG_ID_INVALID",
        error: `Configuration ID لـFacebook Login for Business غير صالح: ${loginConfig.problems.join(" ") || "صيغة غير متوقعة."}`,
        hint: `افتح Meta App Dashboard → Facebook Login for Business → Configurations، وانسخ Configuration ID (أرقام فقط بلا مسافات) إلى ${loginConfigEnvNames(platform).join(" أو ")}.`,
        loginConfig,
        loginConfigIdUsed: false,
      };
      lastOAuthPreflight.set(platform, { at: Date.now(), code: result.code ?? null, appTokenKind: null, error: result.error, hint: result.hint });
      return result;
    }
    const shapeProblem = describeMetaAppIdProblem(cfg.clientId || process.env.FACEBOOK_OAUTH_CLIENT_ID || "");
    if (shapeProblem) return { ok: false, code: "INVALID_APP_ID_FORMAT", error: shapeProblem, hint: "افتح Meta App Dashboard → Settings → Basic وانسخ App ID رقماً فقط (15–16 خانة) بلا مسافات.", loginConfig };
    const cached = oauthStartPreflightCache.get(platform);
    if (cached && Date.now() - cached.at < OAUTH_PREFLIGHT_TTL_MS) return { ...cached.result, loginConfig };
    const appToken = await facebookClient().fetchAppAccessToken({ clientId: String(cfg.clientId), clientSecret: String(cfg.clientSecret || "") });
    let result: OAuthStartPreflight;
    if (appToken.kind === "invalid_client_id") {
      result = {
        ok: false,
        code: "META_APP_ID_INVALID",
        error: "معرّف تطبيق Meta (FACEBOOK_OAUTH_CLIENT_ID) غير موجود لدى Meta. هذا هو سبب صفحة «حدث خطأ ما» بالضبط.",
        hint: "انسخ App ID الصحيح من Meta App Dashboard → Settings → Basic، وتأكد أنه معرّف تطبيق Facebook Login نفسه لا تطبيقاً آخر.",
        appToken,
      };
    } else if (appToken.kind === "invalid_client_secret") {
      result = {
        ok: false,
        code: "META_APP_SECRET_INVALID",
        error: "سرّ تطبيق Meta (FACEBOOK_OAUTH_CLIENT_SECRET) لا يطابق معرّف التطبيق.",
        hint: "من Meta App Dashboard → Settings → Basic اضغط Show بجانب App Secret وانسخ القيمة نفسها إلى FACEBOOK_OAUTH_CLIENT_SECRET.",
        appToken,
      };
    } else if (appToken.kind === "secret_required") {
      result = {
        ok: false,
        code: "META_APP_SECRET_MISSING",
        error: "يلزم App Secret لإثبات تطبيق Meta قبل بدء الربط.",
        hint: "اضبط FACEBOOK_OAUTH_CLIENT_SECRET بقيمة App Secret من Meta App Dashboard.",
        appToken,
      };
    } else if (appToken.kind === "ok") {
      result = { ok: true, appToken };
    } else {
      // تعذّر الفحص (شبكة/غير متوقع): لا نحجب بلا سبب؛ نُعلن أن الإثبات لم يتم.
      result = { ok: true, code: "META_PREFLIGHT_UNAVAILABLE", hint: appToken.message, appToken };
    }
    result.loginConfig = loginConfig;
    result.loginConfigIdUsed = Boolean(loginConfig.valid && loginConfigIdFor(platform));
    // نُخزّن النجاح فقط. الفشل لا يُخزَّن حتى يستطيع المالك إصلاح البيئة والمحاولة فوراً.
    if (result.ok && !result.code) oauthStartPreflightCache.set(platform, { at: Date.now(), result });
    lastOAuthPreflight.set(platform, { at: Date.now(), code: result.code ?? null, appTokenKind: result.appToken?.kind ?? null, error: result.error, hint: result.hint });
    return result;
  }
  if (platform === "tiktok") {
    // TikTok: لا توجد نقطة إثبات تطبيق بلا رمز مستخدم (لا client_credentials).
    // نتحقق محلياً من صيغة client_key ووجود السرّ فقط، فلا نرسل المالك إلى شاشة
    // رفض بلا سبب ظاهر. أي مسافة/سطر زائد يُعلن صراحةً.
    const raw = process.env.TIKTOK_CLIENT_KEY;
    if (typeof raw === "string" && raw.trim() && raw.trim() !== raw) {
      const result: OAuthStartPreflight = { ok: false, code: "TIKTOK_CLIENT_KEY_WHITESPACE", error: "TIKTOK_CLIENT_KEY يحمل مسافة/سطراً زائداً؛ TikTok يرفض المفتاح بلا سبب ظاهر. احذف المسافات.", hint: "انسخ Client key من TikTok Developer Portal → App → Basic information بلا مسافات." };
      lastOAuthPreflight.set(platform, { at: Date.now(), code: result.code ?? null, appTokenKind: null, error: result.error, hint: result.hint });
      return result;
    }
    if (!isPlausibleTikTokClientKey(String(cfg.clientId || ""))) {
      const result: OAuthStartPreflight = { ok: false, code: "TIKTOK_CLIENT_KEY_INVALID", error: "TIKTOK_CLIENT_KEY غير صالح شكلياً (يجب أن يكون معرّفاً نصياً بلا مسافات).", hint: "انسخ Client key من TikTok Developer Portal → App → Basic information إلى TIKTOK_CLIENT_KEY." };
      lastOAuthPreflight.set(platform, { at: Date.now(), code: result.code ?? null, appTokenKind: null, error: result.error, hint: result.hint });
      return result;
    }
    if (!cfg.clientSecret) {
      const result: OAuthStartPreflight = { ok: false, code: "TIKTOK_CLIENT_SECRET_MISSING", error: "يلزم TIKTOK_CLIENT_SECRET لإتمام تبادل رمز TikTok.", hint: "اضبط TIKTOK_CLIENT_SECRET بقيمة Client secret من TikTok Developer Portal." };
      lastOAuthPreflight.set(platform, { at: Date.now(), code: result.code ?? null, appTokenKind: null, error: result.error, hint: result.hint });
      return result;
    }
    lastOAuthPreflight.set(platform, { at: Date.now(), code: null, appTokenKind: null, error: undefined, hint: undefined });
    return { ok: true };
  }
  return { ok: true };
}
/**
 * سجل آمن لبدء OAuth TikTok: يُثبت أي `client_key` استُخدم فعلاً في الرابط
 * (مُخفى + بصمة) بلا أي سرّ، فيُقارَن مباشرةً مع لوحة TikTok Developers من سجلات
 * Render عند رسالة «correct the following: client_key».
 */
function logTikTokOAuthStart(url: URL): void {
  const used = url.searchParams.get("client_key") || "";
  const fp = clientKeyFingerprint(used);
  console.log(`[الغرابي AI] tiktok-oauth-start host=${url.host} client_key=${fp.masked} len=${fp.length} sha256=${fp.sha256Prefix} scope=${url.searchParams.get("scope") || ""}`);
}
/** سرّ توقيع webhook: من اعتماد الصفحة المحفوظ ثم البيئة. */
function facebookAppSecret(): string {
  const stored = getProviderToken("facebook");
  if (stored?.appSecret) return String(stored.appSecret);
  return FACEBOOK_APP_SECRET_ENV;
}
/** رمز تحقق الاشتراك: من الاعتماد المحفوظ ثم البيئة. */
function facebookVerifyToken(): string { return FACEBOOK_VERIFY_TOKEN_ENV; }
/**
 * رمز المستخدم المخزّن (المالك الذي أكمل الربط). يُستخدم في التشخيص القراءة-فقط
 * لإثبات هوية المستخدم والحافظات التي يراها — لا يُعاد ولا يُسجَّل أبداً.
 */
function facebookUserToken(): string | null {
  const stored = getProviderToken("facebook");
  return stored?.userAccessToken ? String(stored.userAccessToken) : null;
}
/** قاعدة حوار Meta (قابلة للتجاوز في الاختبار فقط فلا يلمس مزوداً حقيقياً). */
function metaDialogBase(): string {
  return envSecret("FACEBOOK_DIALOG_BASE") || "https://www.facebook.com";
}
/**
 * هل يُتبَع هذا التحويل أثناء فحص الحوار؟ نتبع فقط مضيف Meta الرسمي
 * (`*.facebook.com`) أو نفس مضيف رابط التفويض الأصلي (الخادم الوهمي في
 * الاختبار)، فلا يُتبَع redirect_uri ولا أي مضيف خارجي.
 */
function isFollowableDialogHost(host: string | null | undefined, originHost: string | null): boolean {
  const h = String(host || "").toLowerCase();
  if (!h) return false;
  if (/(^|\.)facebook\.com$/.test(h)) return true;
  return Boolean(originHost) && h === String(originHost).toLowerCase();
}
/**
 * يوجّه مضيف Meta إلى `FACEBOOK_DIALOG_BASE` عند ضبطه (اختبار فقط). في الإنتاج
 * لا يُضبط المتغير، فيُتبَع رابط Meta الحقيقي كما هو (www → m.facebook.com).
 * يُحافَظ على المسار والاستعلام لأن مسار الجوال يحمل `encrypted_query_string`.
 */
function resolveDialogFollowUrl(location: string): string {
  const base = envSecret("FACEBOOK_DIALOG_BASE");
  if (!base) return location;
  const host = String(safeUrlHost(location) || "").toLowerCase();
  if (!/(^|\.)facebook\.com$/.test(host)) return location;
  try {
    const l = new URL(location);
    const b = new URL(base);
    return `${b.origin}${l.pathname}${l.search}`;
  } catch { return location; }
}
/** نقطة تفويض المنصة: لـMeta تُبنى من قاعدة الحوار القابلة للتجاوز في الاختبار. */
function authEndpointFor(platform: string): string {
  const cfg = OAUTH_CONFIG[platform];
  if (platform === "facebook" || platform === "instagram") return `${metaDialogBase()}${FACEBOOK_DIALOG_PATH}`;
  return cfg.auth;
}
/**
 * فحص ما قبل التوجيه: نطلب رابط التفويض فعلاً بلا متابعة تلقائية، ونسلك سلسلة
 * تحويلات Meta يدوياً حتى نحسم الوجهة النهائية التي سيصل إليها متصفح المالك.
 *
 * سبب المسلك اليدوي (جذر «الفحص يمرّ والمتصفح الجوال يفشل»): أُثبت حياً أن
 * `www.facebook.com/vXX/dialog/oauth` يوجّه حسب User-Agent. الفحص السابق كان
 * يقرأ **أول** استجابة فقط بوكيل الخادم الافتراضي (`node`)، فيرى:
 *   `302 www.facebook.com/login.php`  ← مسار سطح المكتب (يبدو مقبولاً)
 * بينما متصفح المالك الجوال يُحوَّل إلى:
 *   `302 m.facebook.com/vXX/dialog/oauth?encrypted_query_string=...`
 *   ثم إلى صفحة الخطأ الجوال (`m.facebook.com/oauth/error` أو 500 «حدث خطأ ما»).
 * لذلك صار الفحص يكرّر القفزات (بحد أقصى آمن) ويسجّل مضيف/مسار كل قفزة بلا
 * استعلام، ويحسم الرفض من أول قفزة تحمل دليلاً صريحاً.
 *
 * لا يُسجَّل الرابط ولا أي استعلام (يحمل client_id/state/config_id) — فقط
 * الحالة والمضيف والمسار والتصنيف. ولا تُنفَّذ شاشة موافقة: الطلبات بلا كوكيز
 * ولا متابعة تلقائية، فهي تُصادف صفحة تسجيل الدخول لا الموافقة.
 */
interface MetaDialogProbeResult {
  ok: boolean;
  kind: string;
  errorCode: string | null;
  httpStatus: number | null;
  /** هل رُصد مسار الجوال (m.facebook.com) في السلسلة؟ */
  mobileHost?: boolean;
  /** رابط الإرجاع الذي ردّت به Meta في قفزة الرفض (بلا استعلام). */
  rejectionHost?: string | null;
  rejectionPath?: string | null;
  /** سلسلة القفزات الآمنة (خطوة/حالة/مضيف/مسار/جوال) للتشخيص. */
  hops?: { step: number; status: number; host: string | null; path: string | null; mobile: boolean }[];
  /**
   * واجهة الدخول التي تحسمها Meta (من is_business_login): true = Business Login
   * (الصلاحيات من Configuration عبر config_id)، false = Facebook Login الكلاسيكي
   * (الصلاحيات من scope)، null = لم تُعلَن في أي قفزة.
   */
  businessLoginSurface?: boolean | null;
  hint?: string;
}
async function probeMetaDialog(input: { authorizationUrl: string }): Promise<MetaDialogProbeResult> {
  // التوجيه حسب فئة الرفض الفعلية لا تخميناً: كل سبب له إجراء مختلف لدى Meta.
  const rejectionHintFor = (kind: string | null): string => {
    switch (kind) {
      case "invalid_app_id": return "Meta ترد «Invalid App ID»: معرّف التطبيق غير مطابق أو يحمل مسافة/سطراً زائداً. طابقه مع Settings → Basic بلا مسافات.";
      case "unsupported_browser": return "Meta ترفض المتصفح داخل التطبيق (webview). افتح رابط الربط من متصفح الجهاز نفسه (Safari/Chrome) لا من داخل تطبيق.";
      case "mobile_error": return "Meta ترفض الحوار على مسار الجوال (m.facebook.com) قبل شاشة الموافقة. تحقّق أن كل صلاحية مطلوبة مفعّلة في Use Case/Configuration، وأن App Domains وValid OAuth Redirect URIs مضبوطان.";
      case "http_error": return "Meta ترد بخطأ HTTP على رابط التفويض. راجع أن كل صلاحية في الحقل scopes مفعّلة في Use Case/Configuration (صلاحية غير مفعّلة أو اسم غير معروف ينتج هذا الرفض).";
      default: return "رفض Meta رابط التفويض قبل شاشة الموافقة. السبب الأكثر شيوعاً أن مجموعة الصلاحيات المطلوبة غير مفعّلة كاملةً في Use Case أو Configuration الخاص بالتطبيق (App Review permissions and features). راجع أيضاً App ID/App Domains/Valid OAuth Redirect URIs.";
    }
  };
  // حدّ أقصى صغير: سلسلة Meta الفعلية 2–3 قفزات؛ الحد يمنع أي حلقة تحويل.
  const MAX_HOPS = 5;
  const hops: { step: number; status: number; host: string | null; path: string | null; mobile: boolean; kind: string | null }[] = [];
  const raw: { status: number; location: string | null; body: string }[] = [];
  // وكيل جوال حقيقي + ترويسات متصفح كافية لسلك مسار الجوال (sec-fetch-mode).
  const browserHeaders: Record<string, string> = {
    "user-agent": FACEBOOK_MOBILE_UA,
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "ar,en-US;q=0.9,en;q=0.8",
    "upgrade-insecure-requests": "1",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
  };
  try {
    const originHost = safeUrlHost(input.authorizationUrl);
    // نميّز الرابط «المنطقي» (ما قالته Meta فعلاً: www/m.facebook.com) عن الرابط
    // الذي نطلبه (قد يُعاد توجيهه إلى الخادم الوهمي في الاختبار). المضيف/المسار
    // المُعلنان يأتيان من الرابط المنطقي، فيظهر m.facebook.com كما يراه المالك.
    let logicalUrl: string | null = input.authorizationUrl;
    let fetchUrl: string | null = input.authorizationUrl;
    for (let step = 1; step <= MAX_HOPS && fetchUrl; step++) {
      const logicalHost = safeUrlHost(logicalUrl);
      const res = await fetch(fetchUrl, { method: "GET", redirect: "manual", headers: browserHeaders });
      const status = res.status;
      const location = res.headers.get("location");
      // نقرأ عيّنة الجسم دائماً: صفحة Meta العامة «حدث خطأ ما» قد تأتي مع 200 وقد
      // تأتي مع 500، وصفحة الجوال تحمل نصاً مختلفاً؛ الحالة لا تُغيّر أنها رفض.
      const bodySample = (await res.text().catch(() => "")).slice(0, 4000);
      raw.push({ status, location, body: bodySample });
      hops.push({ step, status, host: logicalHost, path: safeUrlPath(logicalUrl), mobile: isMetaMobileHost(logicalHost), kind: classifyMetaDialogInteraction({ status, location, body: bodySample }).kind });
      // دليل رفض صريح في هذه القفزة: لا داعي لمتابعة التحويل (يوفّر طلبات Meta).
      if (classifyMetaDialogChain([{ status, location, body: bodySample }]).rejection) break;
      // لا نتّبع إلا تحويلاً إلى مضيف Meta نفسه (www/m/mbasic) أو مضيف رابط
      // التفويض الأصلي — لا redirect_uri ولا أي مضيف خارجي، فلا يُنفَّذ أي
      // تنفيذ خارج نطاق الفحص.
      const loc = (location || "").trim();
      const followable = status >= 300 && status < 400 && loc && isFollowableDialogHost(safeUrlHost(loc), originHost);
      logicalUrl = followable ? loc : null;
      fetchUrl = followable ? resolveDialogFollowUrl(loc) : null;
    }
    const chain = classifyMetaDialogChain(raw);
    const firstRejection = chain.rejection;
    if (firstRejection) {
      // المضيف/المسار من القفزة المنطقية (الرابط الذي قالته Meta فعلاً) لا من
      // ترويسة Location التي قد تكون غائبة عند خطأ في الجسم.
      const rejHop = hops[firstRejection.step - 1] || hops[hops.length - 1];
      return {
        ok: false,
        kind: firstRejection.kind,
        errorCode: firstRejection.errorCode,
        httpStatus: firstRejection.status,
        mobileHost: chain.sawMobileHost,
        rejectionHost: rejHop?.host ?? null,
        rejectionPath: rejHop?.path ?? null,
        businessLoginSurface: chain.businessLoginSurface,
        hops,
        hint: rejectionHintFor(firstRejection.kind),
      };
    }
    // لا رفض صريح في السلسلة: نمرّر (لا نحجب بلا إثبات). نُعلن التصنيف النهائي.
    const last = chain.hops[chain.hops.length - 1];
    return { ok: true, kind: last?.kind || "unknown", errorCode: null, httpStatus: last?.status ?? null, mobileHost: chain.sawMobileHost, businessLoginSurface: chain.businessLoginSurface, hops, hint: rejectionHintFor(last?.kind ?? null) };
  } catch (e: any) {
    // تعذّر الفحص (شبكة): لا نحجب بلا سبب؛ نُعلن أن الإثبات لم يتم.
    return { ok: true, kind: "unavailable", errorCode: null, httpStatus: null, mobileHost: hops.some((h) => h.mobile), businessLoginSurface: null, hops, hint: String(e?.message || "تعذّر فحص رابط التفويض.") };
  }
}

/**
 * يجد أصغر مجموعة صلاحيات ترفضها Meta (HTTP 500 أو رفض صريح) بحذف تدريجي.
 *
 * سبب الوجود: فحص الحوار الكامل يُثبت أن Meta ترفض، لكنه لا يقول أي صلاحية
 * سبّبت الرفض. هذه الدالة تعزل المجموعة الدنيا المسؤولة، فيصبح التشخيص قابلاً
 * للتنفيذ بدل «حدث خطأ ما» العامة. تُستدعى **فقط** عند فشل الفحص الكامل، فلا
 * تستهلك أي طلب Meta في المسار الناجح. لا يُسجَّل الرابط ولا أي سرّ.
 */
async function findMinimalFailingScopeSet(input: { authorizationUrl: string; scopes: readonly string[] }): Promise<{ failingScopes: string[]; emptyScopeFails: boolean; attempts: number }> {
  const base = new URL(input.authorizationUrl);
  // نفس مسار المالك (وكيل جوال + ترويسات متصفح) ونفس منطق السلسلة، فلا يُعزل
  // السبب على مسار سطح مكتب لا يسلكه المالك.
  const headers: Record<string, string> = { "user-agent": FACEBOOK_MOBILE_UA, "accept": "text/html,application/xhtml+xml,*/*;q=0.8", "upgrade-insecure-requests": "1", "sec-fetch-mode": "navigate", "sec-fetch-site": "none" };
  const attempt = async (scopes: string[]): Promise<boolean> => {
    const t = new URL(base.toString());
    if (scopes.length) t.searchParams.set("scope", scopes.join(",")); else t.searchParams.delete("scope");
    const raw: { status: number; location: string | null; body: string }[] = [];
    let current: string | null = t.toString();
    const originHost = safeUrlHost(t.toString());
    for (let step = 1; step <= 4 && current; step++) {
      try {
        const r: any = await fetch(current, { method: "GET", redirect: "manual", headers });
        const loc = r.headers.get("location");
        const body = (await r.text().catch(() => "")).slice(0, 4000);
        raw.push({ status: r.status, location: loc, body });
        if (classifyMetaDialogChain([{ status: r.status, location: loc, body }]).rejection) { current = null; break; }
        const followable = r.status >= 300 && r.status < 400 && loc && isFollowableDialogHost(safeUrlHost(loc), originHost);
        current = followable ? resolveDialogFollowUrl(loc) : null;
      } catch { current = null; }
    }
    return !classifyMetaDialogChain(raw).acceptable;
  };
  let attempts = 0;
  const scopes = [...new Set(input.scopes)].slice(0, 20);
  // هل تفشل Meta حتى بلا أي صلاحية؟ => العطل في التطبيق/المنتج لا في صلاحية بعينها.
  attempts += 1;
  const emptyScopeFails = await attempt([]);
  if (emptyScopeFails) return { failingScopes: [], emptyScopeFails: true, attempts };
  let current = scopes.slice();
  for (const s of scopes) {
    if (current.length <= 1) break;
    const trial = current.filter((x) => x !== s);
    attempts += 1;
    if (await attempt(trial)) current = trial;
  }
  return { failingScopes: current, emptyScopeFails: false, attempts };
}

/** رابط استقبال أحداث Facebook لهذا الخادم. */
function facebookWebhookUrl(): string { return `${publicBaseUrlNow()}/api/platforms/facebook/webhook`; }
/** رمز صفحة الاتصال الحالي (Page Access Token) من الاعتماد المشفّر. */
function facebookPageToken(pageId?: string): string | null {
  const stored = getProviderToken("facebook");
  if (!stored?.pageAccessToken) return null;
  if (pageId && stored.pageId && String(stored.pageId) !== String(pageId)) return null;
  return String(stored.pageAccessToken);
}
/**
 * هل انتهى OAuth بنجاح لكن الحساب يدير أكثر من صفحة، فننتظر اختيار المالك؟
 * وجود رمز المستخدم دون صفحة مُثبتة يعني أن الربط توقف عند اختيار الصفحة، لا أنه
 * فشل. هذا التمييز ضروري: بدونه يظن المالك أن الربط لم يبدأ فيعيد OAuth، ولا تظهر
 * أداة اختيار الصفحة إطلاقاً لأن زر البدء يحجبها.
 */
function facebookPageSelectionPending(): boolean {
  const stored = getProviderToken("facebook");
  if (!stored?.userAccessToken || stored?.pageId) return false;
  return stored?.pendingPageSelection === true;
}
/** يهرب النص قبل إدراجه في صفحة HTML (اسم الصفحة من المزود). */
function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
/**
 * هل هذا طلب GET على مسار إرجاع OAuth لا يحمل أي رمز/خطأ؟
 *
 * سبب الوجود: تدفّق Meta الرسمي لـInstagram (response_type=token) يُلحق الرمز في
 * **مقطع** الاستجابة، والمقطع لا يُرسَل إلى الخادم أبداً. فالطلب الواصل هنا GET
 * بلا state/code وبلا error — وهو **وجهة إعادة التوجيه الحقيقية** للمتصفح، لا
 * خطأ. يُستخدم لخدمة تطبيق React (ليقرأ المقطع ويرسله POST) بدل رد 400 الذي كان
 * يوقف إكمال الربط تماماً. أي طلب يحمل state/code/error يبقى للمعالجة المعتادة.
 */
function platformOauthFragmentReturn(req: any): boolean {
  if (req.method !== "GET") return false;
  const query = req.url && req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "";
  const p = new URLSearchParams(query);
  if (p.get("state") || p.get("code") || p.get("error") || p.get("fragment")) return false;
  return Boolean(OAUTH_CONFIG[String(req.params?.platform || "")]);
}
/** يخدم واجهة React أحادية الصفحة (dist/index.html) بأمان؛ يعيد false إن تعذّر. */
function serveSpaIndex(res: any): boolean {
  try {
    const indexPath = path.join(process.cwd(), "dist", "index.html");
    if (fs.existsSync(indexPath)) {
      res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(fs.readFileSync(indexPath, "utf8"));
      return true;
    }
  } catch { /* تعذّر القراءة: نُكمل المسار العادي */ }
  return false;
}
/** انتهاء مطلق للرمز من expires_in (ثوانٍ) أو null عند غيابه. */
function parsedTokenExpiry(token: any): number | null {
  const n = Number(token?.expires_in);
  return Number.isFinite(n) && n > 0 ? Date.now() + n * 1000 : null;
}
/** هل موصل Facebook مكتمل الإعداد للاتصال؟ (تطبيق + مفتاح تشفير). */
function facebookConnectorConfigured(): boolean {
  const c = facebookOAuthConfig();
  return Boolean(c?.clientId && c?.clientSecret && publicUrlIsPublic() && tokenKeyBytes());
}
/** تسجيل آمن لحدث Facebook الوارد. ممنوع تسجيل أي سرّ أو نص. */
function logFacebookWebhook(event: { kind: string; externalId?: string | null; outcome: "accepted" | "duplicate" | "rejected" | "ignored"; persisted?: boolean }): void {
  const parts = ["[facebook-webhook]", "platform=facebook", `kind=${event.kind}`, `outcome=${event.outcome}`];
  if (event.externalId) parts.push(`external=${event.externalId}`);
  if (typeof event.persisted === "boolean") parts.push(`persisted=${event.persisted}`);
  console.log(parts.join(" "));
}
/** يحفظ اعتماد Facebook مشفّراً (رمز الصفحة + الهوية + سرّ التوقيع) بلا كشفه. */
function saveFacebookCredentials(input: { pageId: string; pageName?: string | null; pageAccessToken: string; userAccessToken?: string | null; appSecret?: string }) {
  const existing = getProviderToken("facebook") || {};
  setProviderToken("facebook", {
    ...existing,
    pageId: input.pageId,
    pageName: input.pageName || existing.pageName || "",
    pageAccessToken: input.pageAccessToken,
    userAccessToken: input.userAccessToken || existing.userAccessToken || "",
    appSecret: input.appSecret || existing.appSecret || FACEBOOK_APP_SECRET_ENV || "",
    connectedAt: existing.connectedAt || new Date().toISOString(),
  });
}

/**
 * يثبت صفحة محدّدة فعلياً: يستخدم هويتها ورمزها القادمين من `/me/accounts`
 * (المسار الذي يمنح رمز كل صفحة أصلاً)، يشترك تطبيقنا في أحداثها (feed/messages)،
 * ثم يحفظ الاعتماد ويعلن الاتصال الموثق. لا يُعلن الاتصال بلا رمز صفحة حقيقي.
 *
 * مهم: لا نستدعي `GET /{page-id}` في المسار الأساسي. طلب عقدة الصفحة مباشرةً
 * يستدعي صلاحية قراءة صفحة (`pages_read_engagement`) وترد Meta `#100` على صفحات
 * لا تمنحها (مُثبت حياً بـfbtraceId)، فيُفشل إكمال الربط بلا سبب حقيقي — ورمز
 * الصفحة متاح أصلاً من `/me/accounts`. يُبقى `getPageProfile` كمسار احتياطي فقط
 * عند غياب الرمز من قائمة الصفحات، ويُستخدم مستقلاً في `verifyProviderConnection`.
 */
async function facebookFinalizePageSelection(pageId: string, userAccessToken: string, pageData?: { pageId?: string | null; pageName?: string | null; pageAccessToken?: string | null } | null): Promise<{ ok: boolean; pageName?: string | null; error?: string; subscribed?: boolean }> {
  const client = facebookClient();
  const resolvedPageId = String(pageData?.pageId || pageId || "").trim();
  let pageName = pageData?.pageName ? String(pageData.pageName) : null;
  let pageToken = pageData?.pageAccessToken ? String(pageData.pageAccessToken) : "";
  if (!resolvedPageId || !pageToken) {
    // احتياطي فقط: لا رمز من /me/accounts => نُثبت الهوية عبر GET /{page-id}.
    const proof = await client.getPageProfile(resolvedPageId, userAccessToken);
    if (!proof.ok || !proof.data?.pageId || !proof.data.pageAccessToken) {
      return { ok: false, error: proof.error || "تعذّر إثبات هوية الصفحة أو الحصول على رمز الصفحة." };
    }
    pageName = proof.data.pageName;
    pageToken = proof.data.pageAccessToken;
  }
  // اشتراك التطبيق في أحداث الصفحة. عدم الاشتراك لا يُبطل الاتصال لكنه يُعلن
  // صراحةً لأن بدون اشتراك لن تصل أي أحداث webhook.
  const sub = await client.subscribeApp(resolvedPageId, pageToken, FACEBOOK_SUBSCRIBED_FIELDS);
  saveFacebookCredentials({ pageId: resolvedPageId, pageName, pageAccessToken: pageToken, userAccessToken });
  platformConnections.set("facebook", { platform: "facebook", status: "connected", accountId: resolvedPageId, accountName: pageName || "Facebook Page", connectedAt: new Date().toISOString(), providerVerified: true });
  savePlatformConnections();
  return { ok: true, pageName, subscribed: sub.ok, error: sub.ok ? undefined : sub.error };
}

/**
 * يثبت اتصال المزود حقيقةً لمسار `connection-callback` بدل الثقة بالعميل.
 * يدعم فقط المزودات ذات الموصل الحقيقي المنفّذ (Telegram)؛ وغيرها يُرفض
 * صراحةً لأن إثبات الاتصال يجب أن يأتي من طلب مزود لا من تصريح الواجهة.
 */
async function verifyProviderConnection(platform: string): Promise<{ verified: boolean; accountId?: string; accountName?: string; error?: string }> {
  if (platform === "telegram") {
    const client = telegramClient();
    if (!client) return { verified: false, error: "موصل Telegram غير مهيأ (رمز بوت غير متوفر)." };
    const me = await client.getMe();
    if (!me.ok || !me.botId) return { verified: false, error: me.error || "تعذر إثبات اتصال Telegram." };
    // رمز البوت نفسه دليل الاتصال؛ وضبط webhook يجب أن يكون قد اكتمل.
    if (!telegramWebhookSecret()) return { verified: false, error: "webhook غير مضبوط؛ لا يُوثّق الاتصال بدون استقبال حقيقي." };
    return { verified: true, accountId: me.botId, accountName: me.username ? `@${me.username}` : me.firstName || undefined };
  }
  if (platform === "facebook") {
    const stored = getProviderToken("facebook");
    const pageId = stored?.pageId ? String(stored.pageId) : "";
    const token = stored?.pageAccessToken ? String(stored.pageAccessToken) : "";
    const userToken = stored?.userAccessToken ? String(stored.userAccessToken) : "";
    if (!pageId || !token) return { verified: false, error: "لا اعتماد صفحة Facebook محفوظ؛ نفّذ الربط عبر OAuth أولاً." };
    // إثبات حي بلا GET /{page-id}: قراءة عقدة الصفحة مباشرةً تستدعي
    // pages_read_engagement وترد Meta #100 على صفحات لا تمنحها (مُثبت حياً).
    // نُثبت الاتصال عبر /me/accounts (المسار الذي يمنح رمز الصفحة) بأن الصفحة
    // المحفوظة ما زالت ضمن صفحات المستخدم.
    const pages = await facebookClient().listManagedPages(userToken);
    if (!pages.ok) return { verified: false, error: pages.error || "تعذّر إثبات صفحات Facebook." };
    const match = (pages.data || []).find((p) => String(p.pageId) === pageId);
    if (!match) return { verified: false, error: "الصفحة المحفوظة ليست ضمن صفحات هذا الحساب؛ أعد الربط." };
    return { verified: true, accountId: match.pageId, accountName: match.pageName || stored?.pageName || undefined };
  }
  if (platform === "instagram") {
    const igAccountId = instagramAccountId();
    const token = instagramPageToken();
    if (!igAccountId || !token) return { verified: false, error: "لا اعتماد Instagram محفوظ؛ نفّذ الربط عبر OAuth أولاً." };
    // إثبات حي: نستعلم عن هوية حساب Instagram المهني فعلياً من Graph بلا أي ادعاء.
    const proof = await instagramClient().getInstagramProfile(igAccountId, token);
    if (!proof.ok || !proof.data?.igAccountId) return { verified: false, error: proof.error || "تعذر إثبات هوية حساب Instagram." };
    const stored = getProviderToken("instagram");
    return { verified: true, accountId: proof.data.igAccountId, accountName: proof.data.igUsername ? `@${proof.data.igUsername}` : (stored?.pageName || undefined) };
  }
  if (platform === "tiktok") {
    const openId = tiktokOpenId();
    const token = tiktokAccessToken();
    if (!openId || !token) return { verified: false, error: "لا اعتماد TikTok محفوظ؛ نفّذ الربط عبر OAuth أولاً." };
    // إثبات حي: نستعلم عن هوية الحساب فعلياً من TikTok (user.info.basic) بلا أي ادعاء.
    const proof = await tiktokClient().getUserInfo(token);
    if (!proof.ok || !proof.data?.openId) return { verified: false, error: proof.error || "تعذر إثبات هوية حساب TikTok." };
    return { verified: true, accountId: proof.data.openId, accountName: proof.data.displayName || undefined };
  }
  if (platform === "youtube") {
    // إثبات حي مع تجديد تلقائي عند انتهاء الرمز: لا يُعلن اتصال موثق بلا معرّف
    // قناة حقيقي من Google، ولا يُختلق اسم قناة، ولا يُطلب إعادة OAuth إن كان
    // refresh token صالحاً.
    const proof = await fetchYouTubeChannelResilient();
    if (!proof.ok || !proof.data?.channelId) return { verified: false, error: proof.error || "تعذّر إثبات هوية قناة YouTube." };
    return { verified: true, accountId: proof.data.channelId, accountName: proof.data.title || undefined };
  }
  return { verified: false, error: "لا يوجد موصل إثبات حقيقي لهذه المنصة؛ إتمام الاتصال يحتاج اعتماد تطبيق من المزود." };
}
function publicProviderReadiness(platform: string): { configured: boolean; mode: string; action: string; missing?: string[]; invalid?: string[]; next?: string; realConnector?: boolean } {
  const tk = tokenKeyInspection();
  const tokenMissing = tk.state === "missing" && "PLATFORM_TOKEN_ENCRYPTION_KEY";
  const tokenInvalid = tk.state === "invalid" && "PLATFORM_TOKEN_ENCRYPTION_KEY";
  if (platform === "telegram") {
    // موصل حقيقي: يكفي رمز بوت + سرّ webhook + مفتاح تشفير صالح + APP_URL للإرسال والاستقبال.
    const missing = [
      !telegramBotToken() && "TELEGRAM_BOT_TOKEN",
      !telegramWebhookSecret() && "TELEGRAM_WEBHOOK_SECRET",
      tokenMissing,
      !resolvePublicUrl(process.env).valid && "APP_URL",
    ].filter((x): x is string => Boolean(x));
    const invalid = [tokenInvalid].filter((x): x is string => Boolean(x));
    return {
      configured: telegramConnectorConfigured() && Boolean(tokenKeyBytes()),
      mode: "bot-token",
      action: "configure",
      missing,
      invalid,
      realConnector: true,
      next: invalid.length
        ? `استبدل قيمة PLATFORM_TOKEN_ENCRYPTION_KEY بقيمة صالحة (32 بايت hex أو Base64) ثم أعد المحاولة.`
        : missing.length
          ? "زوّد البيئة برمز البوت وسرّ webhook ثم اضغط «ربط Telegram» لتنفيذ getMe وضبط webhook فعلياً."
          : "الموصل مكتمل الإعداد؛ نفّذ الضبط لتسجيل webhook الحقيقي ثم اختبر الإرسال.",
    };
  }
  if (platform === "facebook") {
    // موصل حقيقي: OAuth + رمز صفحة + سرّ توقيع + رمز تحقق + مفتاح تشفير + APP_URL.
    const c = facebookOAuthConfig();
    const stored = getProviderToken("facebook");
    const missing = [
      !c?.clientId && "FACEBOOK_OAUTH_CLIENT_ID",
      !c?.clientSecret && "FACEBOOK_OAUTH_CLIENT_SECRET",
      !facebookAppSecret() && "FACEBOOK_APP_SECRET",
      !facebookVerifyToken() && "FACEBOOK_VERIFY_TOKEN",
      !stored?.pageAccessToken && "Page Access Token (يُكتسب عبر OAuth)",
      tokenMissing,
      !resolvePublicUrl(process.env).valid && "APP_URL",
    ].filter((x): x is string => Boolean(x));
    const invalid = [tokenInvalid].filter((x): x is string => Boolean(x));
    return {
      configured: facebookConnectorConfigured() && Boolean(stored?.pageAccessToken),
      mode: "oauth2",
      action: "authorize",
      missing,
      invalid,
      realConnector: true,
      next: invalid.length
        ? `استبدل قيمة PLATFORM_TOKEN_ENCRYPTION_KEY بقيمة صالحة (32 بايت hex أو Base64) ثم أعد المحاولة.`
        : missing.length
          ? "زوّد البيئة ببيانات تطبيق Meta (Client ID/Secret وAPP_SECRET وVERIFY_TOKEN) ثم نفّذ الربط عبر OAuth لاختيار الصفحة."
          : "الموصل مكتمل الإعداد؛ نفّذ الربط لاختيار الصفحة وإثباتها ثم اختبر الاستقبال والرد.",
    };
  }
  if (platform === "instagram") {
    // موصل حقيقي: نفس تطبيق Meta + رمز صفحة + اكتشاف حساب Instagram + سرّ توقيع + رمز تحقق.
    const c = instagramOAuthConfig();
    const stored = getProviderToken("instagram");
    const missing = [
      !c?.clientId && "INSTAGRAM_OAUTH_CLIENT_ID (أو FACEBOOK_OAUTH_CLIENT_ID)",
      !c?.clientSecret && "INSTAGRAM_OAUTH_CLIENT_SECRET (أو FACEBOOK_OAUTH_CLIENT_SECRET)",
      !instagramAppSecret() && "INSTAGRAM_APP_SECRET (أو FACEBOOK_APP_SECRET)",
      !instagramVerifyToken() && "INSTAGRAM_VERIFY_TOKEN (أو FACEBOOK_VERIFY_TOKEN)",
      !stored?.igAccountId && "حساب Instagram مهني (يُكتسب عبر OAuth)",
      tokenMissing,
      !resolvePublicUrl(process.env).valid && "APP_URL",
    ].filter((x): x is string => Boolean(x));
    const invalid = [tokenInvalid].filter((x): x is string => Boolean(x));
    return {
      configured: instagramConnectorConfigured() && Boolean(stored?.igAccountId),
      mode: "oauth2",
      action: "authorize",
      missing,
      invalid,
      realConnector: true,
      next: invalid.length
        ? `استبدل قيمة PLATFORM_TOKEN_ENCRYPTION_KEY بقيمة صالحة (32 بايت hex أو Base64) ثم أعد المحاولة.`
        : missing.length
          ? "زوّد البيئة ببيانات تطبيق Meta (Client ID/Secret وAPP_SECRET وVERIFY_TOKEN) — تُقبل بيانات Facebook نفسها — ثم نفّذ الربط عبر OAuth لاختيار حساب Instagram المهني."
          : "الموصل مكتمل الإعداد؛ نفّذ الربط لاختيار حساب Instagram وإثباته ثم اختبر الاستقبال والرد.",
    };
  }
  if (platform === "tiktok") {
    // موصل حقيقي: OAuth 2.0 + client_key/secret + مفتاح تشفير + عنوان عام + توكن (يُكتسب).
    const c = tiktokOAuthConfig();
    const stored = tiktokStoredCredentials();
    const missing = [
      !c?.clientId && "TIKTOK_CLIENT_KEY",
      !c?.clientSecret && "TIKTOK_CLIENT_SECRET",
      !stored?.accessToken && "Access Token (يُكتسب عبر OAuth)",
      tokenMissing,
      !resolvePublicUrl(process.env).valid && "APP_URL",
    ].filter((x): x is string => Boolean(x));
    const invalid = [tokenInvalid].filter((x): x is string => Boolean(x));
    return {
      configured: tiktokConnectorConfigured() && Boolean(stored?.accessToken),
      mode: "oauth2",
      action: "authorize",
      missing,
      invalid,
      realConnector: true,
      next: invalid.length
        ? `استبدل قيمة PLATFORM_TOKEN_ENCRYPTION_KEY بقيمة صالحة (32 بايت hex أو Base64) ثم أعد المحاولة.`
        : missing.length
          ? "زوّد البيئة بـTIKTOK_CLIENT_KEY وTIKTOK_CLIENT_SECRET من TikTok Developer Portal ثم نفّذ الربط عبر OAuth."
          : "الموصل مكتمل الإعداد؛ نفّذ الربط لإثبات هوية الحساب (open_id) ثم اختبر النشر/الحالة.",
    };
  }
  const c = OAUTH_CONFIG[platform];
  if (c) return { configured: oauthReady(platform), mode: "oauth2", action: "authorize", next: "ضبط بيانات OAuth وتسجيل Redirect URI", missing: [!c.clientId && "client_id", !c.clientSecret && "client_secret", !resolvePublicUrl(process.env).valid && "APP_URL", tokenMissing].filter((x): x is string => Boolean(x)), invalid: [tokenInvalid].filter((x): x is string => Boolean(x)) };
  return { configured: false, mode: "provider-adapter", action: "configuration-required", next: "إضافة موصل إنتاجي معتمد قبل تفعيل النشر" };
}
function safeConnection(platform: string) { const c:any=platformConnections.get(platform); return c ? { platform:c.platform, status:c.status, accountName:c.accountName, accountId:c.accountId, connectedAt:c.connectedAt, lastSyncAt:c.lastSyncAt, providerVerified:Boolean(c.providerVerified), provider:publicProviderReadiness(platform) } : null; }
// Least-privilege: المالك يرى هوية الحساب (اسم/معرّف) وتفاصيل المزامنة؛ أي مستخدم آخر
// مصرّح له يرى الحالة التقنية فقط (متصل؟ موثّق؟ منذ متى) بلا هوية تنظيمية. يُستخدم في
// /api/workspace/snapshot الذي كان يكشف accountName/accountId لأي مستخدم authenticated.
function snapshotConnection(platform: string, isOwner: boolean) {
  const full = safeConnection(platform);
  if (!full) return null;
  if (isOwner) return full;
  return { platform: full.platform, status: full.status, connectedAt: full.connectedAt ?? null, providerVerified: full.providerVerified };
}
for (const p of SUPPORTED_PLATFORMS) platformConnections.set(p.id, { platform: p.id, status: "disconnected" });
// اتصالات المنصات وتوكناتها تمر عبر نفس المخزن: توكنات المنصات المشفّرة تُحفظ
// داخل workspace.providerTokens، واتصالات المنصات في platformConnections.
function savePlatformConnections() {
  persistState();
}
function loadPlatformConnections() {
  // استرجاع اتصالات المنصات من اللقطة المحمّلة عند الإقلاع (خلفية الملف
  // متزامنة؛ وخلفية Postgres تمرّ عبر applyStateSnapshot بعد قراءة القاعدة).
  // بدون هذا يفقد restart حالة الاتصال فتظهر منصة متصلة كـ disconnected.
  const stored = (persisted as any).platformConnections;
  if (!Array.isArray(stored)) return;
  for (const item of stored) {
    if (item?.platform && platformConnections.has(item.platform)) platformConnections.set(item.platform, item);
  }
}
loadPlatformConnections();
function connectedPlatformIds() { return Array.from(platformConnections.values()).filter(x => x.status === "connected").map(x => x.platform); }
// القدرة تُقرأ من سجل الموصلات مباشرةً، فلا تعتمد على أي قائمة موازية.
function hasCapability(platform: string, capability: string) { return platformSupports(platform, capability); }

// -------------------------------------------------------------
// Central control-plane endpoints (deterministic, no Gemini cost)
// -------------------------------------------------------------

// -------------------------------------------------------------
// YouTube — موصل تشغيلي كامل منفّذ (Google OAuth 2.0 + YouTube Data API v3):
// اتصال + إثبات قناة + قائمة فيديوهات + رفع/تحديث + نشر/جدولة + تعليقات/رد +
// إحصاءات حقيقية. النطاقات: youtube.readonly + youtube.upload + youtube.force-ssl.
// الأسرار تُقرأ من بيئة الخادم أو تُحفظ مشفّرة؛ لا تُسجَّل ولا تُعاد.
// -------------------------------------------------------------
// المغلّف الفعلي (مع حارس حصة YouTube) معرَّف لاحقاً بعد تعريف عدّاد الحصة؛ نفوّض
// إليه lazily هنا كي يبقى العميل الواحد نفسه ويُحتسب كل طلب YouTube تلقائياً بلا
// تعديل مواضع الاستدعاء (نفس نمط جدار حماية Gemini المركزي).
const youtubeFetchImpl: YouTubeFetch = (url, init) => youtubeGuardedFetch(url, init);
function youtubeClient(): YouTubeClient { return new YouTubeClient(youtubeFetchImpl, youtubeApiBase(), youtubeTokenUrl(), youtubeUploadBase()); }
function youtubeOAuthConfig(): any { return OAUTH_CONFIG["youtube"]; }
/** النطاقات النهائية: المطلوبة دائماً + أي تجاوز رسمي محدود من البيئة. */
function youtubeOAuthScopes(): string[] {
  const override = (process.env.YOUTUBE_OAUTH_SCOPES || "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return resolveYouTubeScopes(override.length ? override : YOUTUBE_REQUIRED_SCOPES);
}
/** هل موصل YouTube مكتمل الإعداد للاتصال؟ (clientId + clientSecret + عنوان عام + مفتاح تشفير). */
function youtubeConnectorConfigured(): boolean {
  const c = youtubeOAuthConfig();
  return Boolean(c?.clientId && c?.clientSecret && publicUrlIsPublic() && tokenKeyBytes());
}
/** اعتماد YouTube المحفوظ مشفّراً (رمز الوصول + refresh + انتهاء). */
function youtubeStoredCredentials(): any | null { return getProviderToken("youtube"); }
function youtubeAccessToken(): string | null {
  const stored = youtubeStoredCredentials();
  return stored?.access_token ? String(stored.access_token) : null;
}
function youtubeRefreshToken(): string | null {
  const stored = youtubeStoredCredentials();
  return stored?.refresh_token ? String(stored.refresh_token) : null;
}
function youtubeAccessExpired(): boolean {
  const stored = youtubeStoredCredentials();
  return isAccessTokenExpired({ expiresAt: stored?.expiresAt ?? null });
}
/**
 * هل يحمل الرمز المخزّن نطاق youtube.force-ssl فعلاً؟ يُقرأ من النطاقات الممنوحة
 * المحفوظة عند التبادل/التجديد. غيابه يعني أن إدارة التعليقات ستفشل بـ403، فيجب
 * إعلان الحاجة لإعادة الربط بدل التحايل على Google.
 */
function youtubeForceSslGranted(): boolean {
  const stored = youtubeStoredCredentials();
  const scopes: string[] = Array.isArray(stored?.scope) ? stored.scope : [];
  // قبل وجود أي نطاقات محفوظة (توكن قديم) نُعلن عدم التفعيل بدل افتراضه.
  return scopes.includes(YOUTUBE_FORCE_SSL_SCOPE);
}
/**
 * يجدّد رمز الوصول عبر refresh_token عند انتهائه (تلقائياً قبل أي عملية). لا
 * يُطلب من المالك إعادة OAuth ما دام refresh token صالحاً؛ وإذا فشل التجديد فعلاً
 * يُعلن الحاجة لإعادة الربط بدل فشل صامت. لا يُسجَّل أي رمز.
 */
async function ensureYouTubeAccessToken(): Promise<{ ok: boolean; token?: string; refreshed?: boolean; error?: string; code?: string | null }> {
  const stored = youtubeStoredCredentials();
  const token = youtubeAccessToken();
  if (!token) return { ok: false, error: "لا اعتماد YouTube محفوظ؛ نفّذ الربط عبر OAuth أولاً." };
  // ضمن صلاحيته (بهامش أمان 60 ثانية في isAccessTokenExpired): لا نجدّد بلا داع.
  if (!youtubeAccessExpired() || !youtubeRefreshToken()) return { ok: true, token, refreshed: false };
  const refresh = youtubeRefreshToken() as string;
  const cfg = youtubeOAuthConfig();
  if (!cfg?.clientId || !cfg?.clientSecret) {
    return { ok: false, error: "انتهى رمز YouTube ولا بيانات تطبيق Google متوفرة للتجديد؛ أعد الربط.", code: "invalid_client" };
  }
  const res = await youtubeClient().refreshAccessToken({ clientId: String(cfg.clientId), clientSecret: String(cfg.clientSecret), refreshToken: refresh });
  if (!res.ok || !res.data?.accessToken) {
    // لا فشل صامت: يُعلن أن الاتصال يحتاج إعادة ربط حقيقية بدل ادعاء اتصال قائم.
    platformConnections.set("youtube", { platform: "youtube", status: "reauth_needed", accountId: String(stored?.channelId || ""), connectedAt: stored?.connectedAt || new Date().toISOString() });
    savePlatformConnections();
    await persistStateDurable();
    audit("system", "youtube_refresh_failed", res.code || "provider_error");
    logYouTube("refresh_failed", { code: res.code || "provider_error" });
    // تنبيه المالك مرة واحدة: توقّف الرد الآلي فعلياً ويحتاج إعادة ربط (بلا إغراق).
    maybeAlertYouTubeReauth();
    return { ok: false, error: res.error || "فشل تجديد رمز Google؛ أعد الربط.", code: res.code ?? null };
  }
  saveYouTubeCredentials({
    accessToken: res.data.accessToken,
    refreshToken: res.data.refreshToken || refresh,
    expiresAt: res.data.expiresIn ? Date.now() + res.data.expiresIn * 1000 : null,
    scope: res.data.scope,
  });
  await persistStateDurable();
  audit("system", "youtube_token_refreshed", "auto");
  logYouTube("token_refreshed", { scopeCount: res.data.scope.length });
  return { ok: true, token: res.data.accessToken, refreshed: true };
}

/**
 * ينبّه المالك عند الحاجة لإعادة ربط YouTube (مرة واحدة حتى استعادة الاتصال) —
 * عبر `pushNotification` القائمة. يمنع الإغراق بحالة `watcherAlertState`.
 */
function maybeAlertYouTubeReauth(): void {
  if (!shouldAlertReauth({ reauthAlerted: watcherAlertState.reauthAlerted })) return;
  watcherAlertState.reauthAlerted = true;
  try {
    const conn: any = platformConnections.get("youtube");
    const { title, body } = reauthAlertText({ accountName: conn?.accountName || null });
    pushNotification("owner", "youtube_reauth_needed", title, body, "critical", "platform_connections");
    audit("system", "youtube_reauth_alert", "reauth_needed");
  } catch { /* لا يُسقط فشل التنبيه المسار */ }
  saveYouTubeQuota();
}

/** عند استعادة الاتصال: يُصفَّر علم تنبيه reauth (ليُنبَّه مجدداً لو تكرّر). */
function clearYouTubeReauthAlert(): void {
  if (!watcherAlertState.reauthAlerted) return;
  watcherAlertState.reauthAlerted = false;
  saveYouTubeQuota();
}

/**
 * ينبّه المالك عند تكرار فشل دورات المراقبة (مرة واحدة لكل سلسلة فشل) — عبر
 * `pushNotification` القائمة. يُصفَّر العلم عند أول دورة ناجحة.
 */
function maybeAlertWatcherFailure(): void {
  if (!shouldAlertWatcherFailure({
    consecutiveErrors: watcherState.consecutiveErrors,
    errorAlerted: watcherAlertState.errorAlerted,
    threshold: YOUTUBE_WATCHER_ERROR_ALERT_THRESHOLD,
  })) return;
  watcherAlertState.errorAlerted = true;
  try {
    const { title, body } = watcherFailureAlertText({
      consecutiveErrors: watcherState.consecutiveErrors,
      lastError: watcherState.lastError,
      cadenceMinutes: watcherState.controls.cadenceMinutes,
      threshold: YOUTUBE_WATCHER_ERROR_ALERT_THRESHOLD,
    });
    pushNotification("owner", "youtube_watcher_failure", title, body, "warning", "youtube_operations");
    audit("system", "youtube_watcher_failure_alert", `${watcherState.consecutiveErrors} consecutive errors`);
  } catch { /* لا يُسقط فشل التنبيه المسار */ }
  saveYouTubeQuota();
}

/** عند أول دورة ناجحة: يُصفَّر علم تنبيه الفشل المتكرر (ليُنبَّه مجدداً لو تكرّر). */
function clearWatcherFailureAlert(): void {
  if (!watcherAlertState.errorAlerted) return;
  watcherAlertState.errorAlerted = false;
  saveYouTubeQuota();
}

/**
 * ينفّذ قراءة القناة برمز YouTube مع تجديد تلقائي عند الانتهاء — فلا يسقط الفحص
 * بعد انتهاء access token ما دام refresh token صالحاً. غلاف واحد يمنع تكرار
 * منطق التجديد في كل مسار.
 */
async function fetchYouTubeChannelResilient(): Promise<{ ok: boolean; data: any | null; error?: string; code?: string | null; refreshed?: boolean }> {
  const ensured = await ensureYouTubeAccessToken();
  if (!ensured.ok || !ensured.token) return { ok: false, data: null, error: ensured.error, code: ensured.code ?? null };
  const proof = await youtubeClient().fetchMyChannel(ensured.token);
  // قراءة القناة نجحت ⇒ الاتصال سليم فعلاً: نُصفّر تنبيه reauth ليُعاد التنبيه إن تكرّر الانقطاع.
  if (proof.ok) clearYouTubeReauthAlert();
  return { ok: proof.ok, data: proof.data, error: proof.error, code: proof.code ?? null, refreshed: ensured.refreshed };
}
/** يحفظ اعتماد YouTube مشفّراً بلا كشفه. */
function saveYouTubeCredentials(input: { accessToken: string; refreshToken?: string | null; expiresAt?: number | null; scope?: string[]; channelId?: string; channelTitle?: string | null; uploadsPlaylistId?: string | null }) {
  const existing = youtubeStoredCredentials() || {};
  setProviderToken("youtube", {
    ...existing,
    access_token: input.accessToken,
    refresh_token: input.refreshToken || existing.refresh_token || "",
    expiresAt: input.expiresAt ?? existing.expiresAt ?? null,
    scope: Array.isArray(input.scope) ? input.scope : (existing.scope || []),
    channelId: input.channelId || existing.channelId || "",
    channelTitle: input.channelTitle || existing.channelTitle || "",
    uploadsPlaylistId: input.uploadsPlaylistId || existing.uploadsPlaylistId || "",
    connectedAt: existing.connectedAt || new Date().toISOString(),
  });
}
/** يسجّل حدث YouTube آمن بلا أي سرّ. */
function logYouTube(outcome: string, detail: Record<string, unknown> = {}): void {
  const parts = ["[youtube-oauth]", `outcome=${outcome}`];
  for (const [k, v] of Object.entries(detail)) {
    if (v === undefined || v === null) continue;
    if (k === "code" || k === "token" || k === "state" || k === "access_token") continue; // حماية صريحة
    parts.push(`${k}=${String(v).slice(0, 120)}`);
  }
  console.log(parts.join(" "));
}
/** سجل عملية YouTube آمن (عملية/منصة/معرّف/نتيجة/مدة) بلا أي سرّ. */
function logYouTubeOperation(operation: string, detail: { externalId?: string | null; outcome: string; errorCode?: string | null; durationMs?: number; idempotencyKey?: string | null; actor?: string | null }): void {
  const parts = ["[youtube-op]", `operation=${operation}`, `platform=youtube`, `outcome=${detail.outcome}`];
  if (detail.externalId) parts.push(`externalId=${String(detail.externalId).slice(0, 80)}`);
  if (detail.errorCode) parts.push(`errorCode=${String(detail.errorCode).slice(0, 40)}`);
  if (typeof detail.durationMs === "number") parts.push(`durationMs=${detail.durationMs}`);
  if (detail.idempotencyKey) parts.push(`idempotencyKey=${String(detail.idempotencyKey).slice(0, 16)}`);
  if (detail.actor) parts.push(`actor=${String(detail.actor).slice(0, 60)}`);
  console.log(parts.join(" "));
}
/** حقائق الحالة الصادقة لـYouTube (بلا أي سرّ) — تُبنى من المخزون وحالة الاتصال. */
function youtubeTruthfulState() {
  const stored = youtubeStoredCredentials();
  const conn: any = platformConnections.get("youtube");
  const tk = tokenKeyInspection();
  const input: YouTubeStateInput = {
    clientIdConfigured: Boolean(youtubeOAuthConfig()?.clientId),
    clientSecretConfigured: Boolean(youtubeOAuthConfig()?.clientSecret),
    encryptionKeyValid: tk.state === "valid",
    publicUrlValid: publicUrlIsPublic(),
    pendingAuthorization: pendingOAuth.has("youtube"),
    tokenStored: Boolean(stored?.access_token),
    refreshTokenStored: Boolean(stored?.refresh_token),
    tokenExpired: Boolean(stored?.access_token) && youtubeAccessExpired(),
    forceSslGranted: youtubeForceSslGranted(),
    connectionStatus: (conn?.status === "connected" || conn?.status === "reauth_needed") ? conn.status : "disconnected",
    channelDiscovered: Boolean(stored?.channelId),
    providerVerified: conn?.providerVerified === true,
    operationalEvidence: youtubeOperationalEvidence(),
    providerErrorKind: (youtubeLastProviderError as any) || null,
  };
  const resolved = resolveYouTubeState(input);
  return { ...resolved, input, youtubeOnlyMode: youtubeOnlyModeEnabled() };
}
/** هل يوجد دليل مزود على إتمام عملية محتوى رسمية (نشر أو رد بمعرّف من Google)؟ */
function youtubeOperationalEvidence(): boolean {
  const records = ((workspace as any).publishRecords || []) as any[];
  const published = records.some((r) => r.platform === "youtube" && (r.state === "published" || r.state === "scheduled") && r.externalVideoId);
  const replies = ((workspace as any).socialReplies || []) as any[];
  const deliveredReply = replies.some((r) => r.platform === "youtube" && r.delivered === true && r.externalReplyId);
  return Boolean(published || deliveredReply);
}
/** حالة YouTube غير السرّية (منطقي فقط) — تُعرض في /api/health و/api/readiness. */
function youtubeHealthState() {
  const stored = youtubeStoredCredentials();
  const conn: any = platformConnections.get("youtube");
  const truthful = youtubeTruthfulState();
  return {
    platform: "youtube",
    clientIdConfigured: Boolean(youtubeOAuthConfig()?.clientId),
    clientSecretConfigured: Boolean(youtubeOAuthConfig()?.clientSecret),
    requestedScopes: youtubeOAuthScopes(),
    readonlyScopePresent: youtubeOAuthScopes().includes(YOUTUBE_READONLY_SCOPE),
    uploadScopePresent: youtubeOAuthScopes().includes(YOUTUBE_UPLOAD_SCOPE),
    forceSslScopePresent: youtubeOAuthScopes().includes(YOUTUBE_FORCE_SSL_SCOPE),
    // النطاق الممنوح فعلاً (من الرمز المخزّن) — يفصل «مطلوب» عن «ممنوح فعلاً».
    forceSslGranted: youtubeForceSslGranted(),
    channelIdentityCallImplemented: youtubeCapabilityImplemented("channel_identity"),
    accessTokenStored: Boolean(stored?.access_token),
    refreshTokenStored: Boolean(stored?.refresh_token),
    channelStored: Boolean(stored?.channelId),
    uploadsPlaylistStored: Boolean(stored?.uploadsPlaylistId),
    tokenExpired: Boolean(stored?.access_token) && youtubeAccessExpired(),
    // التجديد التلقائي متاح فعلاً (رمز منتهٍ + refresh token صالح => يُجدَّد بلا إعادة ربط).
    tokenRefreshable: Boolean(stored?.access_token) && Boolean(stored?.refresh_token) && Boolean(youtubeOAuthConfig()?.clientId && youtubeOAuthConfig()?.clientSecret),
    connectorConfigured: youtubeConnectorConfigured(),
    realConnector: hasRealConnector("youtube"),
    connected: conn?.status === "connected",
    providerVerified: conn?.providerVerified === true,
    // الحالة الصادقة (مفردات موحّدة) + وضع التشغيل المركّز.
    operationalState: truthful.state,
    operationalStateLabelAr: truthful.labelAr,
    operationalStateReason: truthful.reason,
    nextAction: truthful.nextAction,
    youtubeOnlyMode: truthful.youtubeOnlyMode,
    capabilityMatrix: YOUTUBE_CAPABILITY_MATRIX,
  };
}
/** يحوّل فيديوهات YouTube إلى سجلات مؤشرات للتحليلات/التعلّم بلا اختراع قيم. */
function youtubeVideoMetricRecords(videos: YouTubeVideo[]): YouTubeVideoMetricRecord[] {
  const at = new Date().toISOString();
  return videos.map((v) => ({
    videoId: v.videoId,
    title: v.title,
    publishedAt: v.publishedAt,
    viewCount: v.viewCount,
    likeCount: v.likeCount,
    commentCount: v.commentCount,
    topic: (v.tags && v.tags.length ? v.tags[0] : (v.title || "").trim().slice(0, 40)) || null,
    at,
  }));
}

/**
 * يحوّل سجلات الأداء الحقيقية المحفوظة (performanceRecords) إلى سجلات العقل
 * المركزي العامة. لا يخترع قيمة: المؤشرات الغائبة تبقى غائبة.
 */
function performanceRecordsForBrain(): PlatformMetricRecord[] {
  const rows = ((workspace as any).performanceRecords || []) as any[];
  return rows
    .map((r) => {
      const platform = String(r?.platform || "") as PlatformId;
      if (!isSupportedPlatform(platform)) return null;
      const values: Record<string, number> = {};
      const raw = r?.values && typeof r.values === "object" ? r.values : {};
      for (const k of ["views", "likes", "comments", "shares", "reach", "saves"]) {
        const n = Number((raw as any)[k]);
        if (Number.isFinite(n) && n >= 0) values[k] = n;
      }
      return {
        platform,
        externalId: String(r?.postExternalId || r?.id || ""),
        productCategory: r?.productCategory ?? null,
        contentType: r?.contentType ?? null,
        title: r?.title ?? null,
        hashtags: Array.isArray(r?.hashtags) ? r.hashtags : [],
        ctaType: r?.ctaType ?? null,
        publishedAt: r?.at ?? r?.publishedAt ?? null,
        values,
      } as PlatformMetricRecord;
    })
    .filter((x): x is PlatformMetricRecord => Boolean(x) && Boolean(x.externalId));
}

/** تعليقات فعلية محفوظة بحسب المنصة (لتحليل الجمهور/التعليقات)، بلا أي سرّ. */
function commentsByPlatformForBrain(platforms: PlatformId[]): Partial<Record<PlatformId, Array<{ text: string; authorName?: string }>>> {
  const out: Partial<Record<PlatformId, Array<{ text: string; authorName?: string }>>> = {};
  const rows = ((workspace as any).socialComments || []) as any[];
  for (const p of platforms) {
    const items = rows.filter((c) => String(c?.platform) === p).slice(0, 500).map((c) => ({ text: String(c?.text || ""), authorName: c?.authorName }));
    if (items.length) out[p] = items;
  }
  return out;
}
void commentsByPlatformForBrain;

/** عدّادات حماية Gemini من السجل المركزي (أرقام فقط، بلا prompt ولا سرّ). */
function brainAiCounters() {
  const s = aiEngine.usageLedger().snapshot();
  return {
    providerCalls: s.providerCalls,
    cacheHits: s.cacheHits,
    inflightJoins: s.inflightJoins,
    guardBlocked: s.guardBlocked,
    deterministic: s.deterministic,
    fallback: s.fallback,
    providerErrors: s.providerErrors,
  };
}

/** وقت النشر المقترح من أوقات تفاعل حقيقية فقط (بلا اختراع). */
function brainScheduleSuggestion() {
  const timestamps = (watcherState.processed || []).map((p: any) => p.publishedAt || p.at);
  return suggestScheduleTime({ engagementTimestamps: timestamps });
}

/** حالة اتصال كل منصة (حقيقية من السجل؛ لا يُدَّعى اتصال). */
function brainConnections(): RuntimeConnection[] {
  return SUPPORTED_PLATFORMS.map((p: any) => {
    const c: any = platformConnections.get(p.id);
    return { platform: p.id as PlatformId, connected: c?.status === "connected", verified: c?.providerVerified === true, accountName: c?.accountName ?? null };
  });
}

/** تعليقات حقيقية من مخزن السوشيال (كل المنصات) للعقل. */
function brainRuntimeComments(): RuntimeComment[] {
  const rows = ((workspace as any).socialComments || []) as any[];
  return rows
    .filter((c) => c && isSupportedPlatform(String(c.platform)) && typeof c.text === "string" && c.text.trim())
    .slice(0, 1000)
    .map((c) => ({ platform: String(c.platform) as PlatformId, externalId: String(c.externalId || c.id || ""), text: String(c.text), authorName: c.authorName ?? null, at: c.createdAt ?? null }));
}

/** ردود حقيقية مُسجَّلة (نجاح/فشل) مع معرّف المزوّد إن وُجد. */
function brainRuntimeReplies(): RuntimeReply[] {
  const rows = ((workspace as any).socialReplies || []) as any[];
  return rows
    .filter((r) => r && isSupportedPlatform(String(r.platform)))
    .slice(0, 1000)
    .map((r) => ({
      platform: String(r.platform) as PlatformId,
      externalId: String(r.externalId || r.id || ""),
      delivered: r.delivered === true,
      providerReplyId: r.providerReplyId ?? r.externalReplyId ?? null,
      reviewStatus: r.reviewStatus ?? null,
      deliveryError: r.deliveryError ?? null,
      repliedAt: r.repliedAt ?? null,
      parentExternalId: r.replyTarget?.commentId ?? null,
    }));
}

/** سجلات نشر حقيقية (نجاح/فشل/تحقق) مع معرّف المنشور من المزود. */
function brainRuntimePublishes(): RuntimePublish[] {
  const rows = ((workspace as any).publishRecords || []) as any[];
  return rows
    .filter((r) => r && isSupportedPlatform(String(r.platform)))
    .slice(0, 1000)
    .map((r) => ({
      platform: String(r.platform) as PlatformId,
      externalId: r.externalVideoId ?? r.receipt?.videoId ?? null,
      state: r.state ?? r.reconciled ?? null,
      verified: r.verified === true,
      error: r.error ?? null,
      createdAt: r.at ?? r.createdAt ?? null,
    }));
}

/** سجل معالجة مراقب YouTube الحقيقي (نجاح/تخطٍّ/إحالة) — بلا اختراع. */
function brainRuntimeWatcher(): RuntimeWatcherEntry[] {
  return (watcherState.processed || [])
    .slice(0, 1000)
    .map((p: any) => ({ commentId: String(p.commentId || ""), stage: String(p.stage || ""), action: p.action ?? null, code: p.code ?? null, videoId: p.videoId ?? null, publishedAt: p.publishedAt ?? null, at: p.at ?? null, externalReplyId: p.externalReplyId ?? null }))
    .filter((p) => p.commentId && p.stage);
}

/** حقائق تجارية مسجّلة من بيانات المعرض الحقيقية فقط (بلا أي رقم مُختلق). */
function brainVerifiedFacts(): RuntimeVerifiedFact[] {
  const facts: RuntimeVerifiedFact[] = [];
  const showroom: any = workspace.showroom || {};
  if (cleanText(showroom.phoneUnified, 40)) facts.push({ id: "showroom_phone", statement: `هاتف المعرض: ${cleanText(showroom.phoneUnified, 40)}`, source: "بيانات المعرض المسجّلة" });
  if (cleanText(showroom.whatsappSales, 40)) facts.push({ id: "showroom_whatsapp", statement: `واتساب المبيعات: ${cleanText(showroom.whatsappSales, 40)}`, source: "بيانات المعرض المسجّلة" });
  const location = cleanText(showroom.address || showroom.city, 120);
  if (location) facts.push({ id: "showroom_location", statement: `موقع المعرض: ${location}`, source: "بيانات المعرض المسجّلة" });
  if (cleanText(showroom.hours, 80)) facts.push({ id: "showroom_hours", statement: `أوقات الدوام: ${cleanText(showroom.hours, 80)}`, source: "بيانات المعرض المسجّلة" });
  return facts;
}

/** بيانات منتج حقيقية (أول منتج مسجّل) لمسار المحتوى — بلا اختراع. */
function brainProductFacts(): RuntimeBrainInput["productFacts"] {
  const showroom: any = workspace.showroom || {};
  const product: any = (workspace.products || [])[0] || null;
  const cashPrice = Number(product?.cashPrice);
  return {
    productName: product ? (cleanText(product.name, 120) || null) : null,
    priceText: Number.isFinite(cashPrice) && cashPrice > 0 ? `${cashPrice.toLocaleString("en-US")} د.ع` : null,
    specs: product && Array.isArray(product.specs) ? product.specs.map((s: any) => cleanText(s, 200)).filter(Boolean) : [],
    inStock: product && typeof product.inStock === "boolean" ? product.inStock : null,
    showroomPhone: cleanText(showroom.phoneUnified, 40) || null,
    showroomLocation: cleanText(showroom.address || showroom.city, 120) || null,
  };
}

/** يجمع مدخلات العقل الحقيقية كاملة (قراءة فقط، بلا شبكة وبلا أسرار). */
function brainRuntimeInput(): Omit<RuntimeBrainInput, "now"> {
  const platforms = SUPPORTED_PLATFORMS.map((p: any) => p.id) as PlatformId[];
  return {
    platforms,
    goalPrimary: "SALES",
    goalSecondary: "TRUST",
    records: performanceRecordsForBrain(),
    comments: brainRuntimeComments(),
    replies: brainRuntimeReplies(),
    publishes: brainRuntimePublishes(),
    watcher: brainRuntimeWatcher(),
    connections: brainConnections(),
    verifiedFacts: brainVerifiedFacts(),
    productFacts: brainProductFacts(),
    memory: brainMemoryStore,
    decisionLedger,
    strategyState: strategyStateSummary(),
    aiCounters: brainAiCounters(),
  };
}

/** ملخّص حالة الاستراتيجية المحفوظة (قراءة فقط — لا دورة دورية ولا سرّ). */
function strategyStateSummary(): StrategyStateSummary {
  const items = strategyState.current?.items || [];
  return {
    currentVersion: strategyState.currentVersion,
    lastReason: strategyState.lastReason,
    itemScopes: [...new Set(items.map((i) => i.scope))].slice(0, 8),
    itemCount: items.length,
    lastUpdatedAt: strategyState.lastUpdatedAt,
  };
}

/**
 * الشكل القديم للقطة العقل مُشتقاً من الحالة canonical (`buildRuntimeBrain`) —
 * للتوافق مع `/api/brain/*` وأداة الوكيل `brain_snapshot` فقط. لا يبني عقلاً ثانياً.
 */
function canonicalBrainSnapshot(extras: Parameters<typeof toCentralBrainSnapshot>[1] = {}) {
  return toCentralBrainSnapshot(buildRuntimeBrain({ ...brainRuntimeInput(), now: Date.now() }).state, extras);
}

/** يبني ContentBrief من بيانات المعرض الحقيقية لمنتج/حملة. */
function buildContentBriefForBrain(productId?: string | null, productName?: string | null, platforms?: PlatformId[], objective?: string | null, extraInstructions?: string | null): ContentBrief {
  const product = resolveContentProduct(productId, productName);
  const showroom: any = workspace.showroom || {};
  const targetPlatforms = (Array.isArray(platforms) && platforms.length ? platforms : SUPPORTED_PLATFORMS.map((p: any) => p.id)) as PlatformId[];
  const cashPrice = Number(product?.cashPrice);
  return {
    objective: cleanText(objective, 200) || null,
    product: product
      ? {
          id: product.id,
          name: cleanText(product.name, 120),
          category: cleanText(product.category, 40) || null,
          specs: Array.isArray(product.specs) ? product.specs.map((s: any) => cleanText(s, 200)).filter(Boolean) : [],
          installmentOptions: Array.isArray(product.installmentOptions) ? product.installmentOptions.map((s: any) => cleanText(s, 200)).filter(Boolean) : [],
          inStock: typeof product.inStock === "boolean" ? product.inStock : null,
          priceText: Number.isFinite(cashPrice) && cashPrice > 0 ? `${cashPrice.toLocaleString("en-US")} د.ع` : null,
        }
      : null,
    showroom: {
      name: cleanText(showroom.name, 80) || null,
      tagline: cleanText(showroom.tagline, 160) || null,
      about: cleanText(showroom.about, 400) || null,
      city: cleanText(showroom.city, 60) || null,
      phone: cleanText(showroom.phoneUnified, 40) || null,
      whatsapp: cleanText(showroom.whatsappSales, 40) || null,
      locationText: cleanText(showroom.address || showroom.city, 120) || null,
      hoursText: cleanText(showroom.hours, 80) || null,
    },
    platforms: targetPlatforms,
    campaign: cleanText((product as any)?.campaign, 60) || null,
    extraInstructions: cleanText(extraInstructions, 400) || null,
  };
}
/** حارس معدّل العمليات الخارجية لـYouTube (يمنع الإغراق؛ pending/retryable عند الحد). */
const youtubeOperationWindows = new Map<string, number[]>();
function youtubeRateLimit(kind: string): { allowed: boolean; retryAfterMs: number; limit: number } {
  const limit = Math.max(1, Number(process.env.YOUTUBE_OP_RATE_LIMIT || 20));
  const windowMs = Math.max(1000, Number(process.env.YOUTUBE_OP_RATE_WINDOW_MS || 60_000));
  const key = `youtube:${kind}`;
  const now = Date.now();
  const decision = checkOperationRateLimit({ timestamps: youtubeOperationWindows.get(key) || [], now, limit, windowMs });
  if (decision.allowed) {
    const list = (youtubeOperationWindows.get(key) || []).filter((t) => now - t < windowMs);
    list.push(now);
    youtubeOperationWindows.set(key, list);
  }
  return { allowed: decision.allowed, retryAfterMs: decision.retryAfterMs, limit };
}
/** آخر فئة خطأ من مزود Google (بلا أي قيمة) — تُغذّي الحالة الصادقة. */
let youtubeLastProviderError: string | null = null;
function noteYouTubeProviderError(kind: string | null | undefined): void {
  if (!kind) return;
  // نبقي فئة الخطأ لآخر عملية فاشلة فقط؛ أي نجاح يمسحها.
  youtubeLastProviderError = ["insufficient_permissions", "invalid_client", "quota_exceeded"].includes(String(kind)) ? String(kind) : null;
}
function clearYouTubeProviderError(): void { youtubeLastProviderError = null; }

/**
 * إثبات الحساب لدى المزود بعد تبادل الرمز. لا نختلق هوية: إن لم تدعم الواجهة
 * استعلاماً مباشراً أو فشل، نُبقي المعرّف العام ونعتمد الإثبات على نجاح التبادل.
 * كل استدعاء هنا رسمي ومحدود، ولا يُسجّل أي رمز.
 */
async function fetchProviderAccount(platform: string, accessToken: string): Promise<{ accountId?: string; accountName?: string } | null> {
  try {
    if (platform === "youtube") {
      const info = await youtubeClient().fetchMyChannel(accessToken);
      if (info.ok && info.data?.channelId) return { accountId: info.data.channelId, accountName: info.data.title || undefined };
    }
    if (platform === "tiktok") {
      // الإثبات عبر عميل TikTok نفسه (يحترم TIKTOK_API_BASE في الاختبار) بلا سرّ في السجل.
      const info = await tiktokClient().getUserInfo(accessToken);
      if (info.ok && info.data?.openId) return { accountId: info.data.openId, accountName: info.data.displayName || undefined };
    }
    if (platform === "facebook" || platform === "instagram") {
      const r = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`);
      const d = await r.json(); if (r.ok && d.id) return { accountId: String(d.id), accountName: d.name };
    }
    if (platform === "threads") {
      const r = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`);
      const d = await r.json(); if (r.ok && d.id) return { accountId: String(d.id), accountName: d.username };
    }
    if (platform === "x") {
      const r = await fetch("https://api.twitter.com/2/users/me", { headers: { Authorization: `Bearer ${accessToken}` } });
      const d = await r.json(); if (r.ok && d.data?.id) return { accountId: String(d.data.id), accountName: d.data.username ? `@${d.data.username}` : d.data.name };
    }
    if (platform === "google_business") {
      const r = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", { headers: { Authorization: `Bearer ${accessToken}` } });
      const d = await r.json(); if (r.ok && d.accounts?.[0]) return { accountId: d.accounts[0].name, accountName: d.accounts[0].accountName };
    }
  } catch { /* الإثبات الإضافي اختياري؛ الفشل لا يُلغي نجاح التبادل */ }
  return null;
}

app.get("/api/platforms/:platform/oauth/start", requireOwner, async (req,res)=>{
  const platform=req.params.platform; const cfg=OAUTH_CONFIG[platform];
  if(!cfg) return res.status(501).json({success:false,error:"هذا المزود يحتاج إعداد موصل خاص قبل بدء OAuth."});
  if(!oauthReady(platform)) {
    // تمييز missing من invalid في الرسالة نفسها بدل افتراض غياب المفتاح دائماً.
    const tk = tokenKeyInspection();
    const tokenNote = tk.state === 'valid' ? "" : ` ${tk.reason}`;
    return res.status(503).json({success:false,error:`إعداد OAuth غير مكتمل. يلزم APP_URL وبيانات تطبيق المزود ومفتاح PLATFORM_TOKEN_ENCRYPTION_KEY صالح.${tokenNote}`});
  }
  const callbackUrl=oauthCallbackUrl(platform);
  const urlInfo=resolvePublicUrl(process.env);
  const publicOk=publicUrlIsPublic();
  // الصلاحيات تُحسَب عند كل بدء (لا وقت الإقلاع) لتعكس البيئة الفعلية وتضمن
  // إضافة اعتماديات Meta الناقصة، فلا ينتج «Invalid Scopes» أو صلاحية مُسقَطة.
  const scopeGaps = platform==="facebook" ? facebookScopeDependencyGaps() : [];
  const scopes = platform==="facebook" ? facebookOAuthScopes() : platform==="instagram" ? instagramOAuthScopes() : platform==="youtube" ? youtubeOAuthScopes() : (Array.isArray(cfg.scopes) ? cfg.scopes : []);
  // فحص ما قبل الحوار: يمنع إرسال المالك إلى صفحة «حدث خطأ ما» بلا تفسير.
  // عند الفشل نُعلن السبب والإجراء الدقيق بدل توليد رابط سيفشل حتماً لدى Meta.
  const preflight = await oauthStartPreflight(platform);
  if (!preflight.ok) {
    logOAuthStart(platform, { outcome: "preflight_blocked", code: preflight.code, appTokenKind: preflight.appToken?.kind ?? null, redirectUri: callbackUrl, domain: urlInfo.host, publicUrlSource: urlInfo.source, publicUrlIsPublic: publicOk });
    return res.status(409).json({
      success: false,
      code: preflight.code,
      error: preflight.error,
      hint: preflight.hint,
      platform,
      redirectUri: callbackUrl,
      domain: urlInfo.host,
      appIdFormatOk: isPlausibleMetaAppId(String(cfg.clientId || "")),
      appTokenKind: preflight.appToken?.kind ?? null,
      loginConfigIdConfigured: preflight.loginConfig?.configured ?? false,
      loginConfigIdValid: preflight.loginConfig?.valid ?? false,
      loginConfigEnvNames: META_OAUTH_PLATFORMS.has(platform) ? loginConfigEnvNames(platform) : undefined,
    });
  }
  // مسار Facebook Login for Business: عند وجود Configuration ID صالح نمرّره
  // كـconfig_id بدل scope (الConfiguration تحمل الصلاحيات وحقول الوصول).
  // لـInstagram في تدفّق الإعداد الموحّد يُتجاهَل config_id (الوثيقة الرسمية
  // تعرّف الرابط بستة معاملات بلا config_id)، فنستخدم القيمة المُطبَّقة فعلاً.
  const loginConfigId = META_OAUTH_PLATFORMS.has(platform) ? effectiveLoginConfigIdFor(platform) : null;
  const state=createOAuthState();
  const pending:OAuthPending={platform,userId:(req as any).user.id,expiresAt:Date.now()+OAUTH_STATE_TTL_MS,redirectUri:callbackUrl};
  let pkceChallenge:string|undefined;
  if(requiresPkce(platform)) { const pkce=createPkcePair(); pending.codeVerifier=pkce.verifier; pkceChallenge=pkce.challenge; }
  pendingOAuth.set(state,pending);
  const u=new URL(authEndpointFor(platform));
  const params=buildAuthorizationParams({platform,clientId:cfg.clientId,redirectUri:callbackUrl,scopes,state,pkceChallenge,loginConfigId,instagramOnboarding:platform==="instagram"&&instagramOnboardingEnabled()});
  for(const [k,v] of Object.entries(params)) u.searchParams.set(k,v);
  // سجل آمن لـTikTok: يُثبت المفتاح المستخدم فعلاً في الرابط (مُخفى + بصمة).
  if (platform === "tiktok") logTikTokOAuthStart(u);
  // فحص ما قبل التوجيه (Meta فقط): نتحقق أن Meta تقبل الرابط فعلاً، فلا يُرسَل
  // المالك إلى صفحة «حدث خطأ ما» عمياء. تعذّر الفحص لا يحجب (لئلا نكسر التطوير).
  let dialogProbe: MetaDialogProbeResult | null = null;
  if (META_OAUTH_PLATFORMS.has(platform)) {
    dialogProbe = await probeMetaDialog({ authorizationUrl: u.toString() });
    if (!dialogProbe.ok) {
      // تشخيص قابل للتنفيذ: نعزل أصغر مجموعة صلاحيات ترفضها Meta (فقط عند الفشل).
      let scopeDiagnosis: { smallestFailingScopeSet: string[]; emptyScopeFails: boolean; probes: number; meaning: string } | null = null;
      if (scopes.length && (dialogProbe.httpStatus === null || dialogProbe.httpStatus >= 400)) {
        const diag = await findMinimalFailingScopeSet({ authorizationUrl: u.toString(), scopes });
        scopeDiagnosis = {
          smallestFailingScopeSet: diag.failingScopes,
          emptyScopeFails: diag.emptyScopeFails,
          probes: diag.attempts,
          meaning: diag.emptyScopeFails
            ? "Meta ترفض الحوار حتى بلا أي صلاحية => العطل في التطبيق/المنتج نفسه (App ID أو App Domains أو Use Case) لا في صلاحية بعينها."
            : "هذه أصغر مجموعة صلاحيات يرفضها الحوار؛ فعّل هذه الصلاحيات تحديداً في Use Case/Configuration.",
        };
      }
      // تشخيص المسار الجوال: يُعلن صراحةً أن الرفض رُصد على مسار الجوال (m.facebook.com)
      // لا على مسار سطح المكتب، فلا يُخفي أن الفحص القديم كان يرى مساراً مختلفاً.
      const mobileFlow = {
        probedAsMobile: true,
        mobileHostReached: Boolean(dialogProbe.mobileHost),
        rejectionHost: dialogProbe.rejectionHost ?? null,
        rejectionPath: dialogProbe.rejectionPath ?? null,
        hops: dialogProbe.hops ?? [],
        meaning: dialogProbe.mobileHost
          ? "أُعيد إنتاج مسار المالك الجوال فعلاً (www.facebook.com → m.facebook.com) ورُصد الرفض هناك."
          : "لم يُرصد تحويل إلى مسار الجوال في هذه المحاولة؛ الرفض رُصد على مسار Meta المباشر.",
      };
      logOAuthStart(platform, { outcome: "dialog_rejected", code: `META_DIALOG_${String(dialogProbe.errorCode || dialogProbe.kind).toUpperCase()}`, httpStatus: dialogProbe.httpStatus, dialogKind: dialogProbe.kind, mobileHostReached: Boolean(dialogProbe.mobileHost), rejectionHost: dialogProbe.rejectionHost ?? null, rejectionPath: dialogProbe.rejectionPath ?? null, hopCount: (dialogProbe.hops || []).length, redirectUri: callbackUrl, domain: urlInfo.host, publicUrlIsPublic: publicOk });
      return res.status(409).json({
        success: false,
        code: `META_DIALOG_${String(dialogProbe.errorCode || dialogProbe.kind).toUpperCase()}`,
        error: "رفض Meta رابط التفويض قبل شاشة الموافقة (صفحة «حدث خطأ ما»). لم يُرسَل المستخدم إلى Meta.",
        hint: dialogProbe.hint,
        platform,
        // تشخيص آمن بلا أي سرّ: لا state ولا client_id ولا سرّ ولا رابط تفويض كامل.
        dialogHttpStatus: dialogProbe.httpStatus,
        dialogKind: dialogProbe.kind,
        dialogErrorCode: dialogProbe.errorCode,
        mobileFlow,
        // واجهة الدخول التي حسمتها Meta: true = Business Login (الصلاحيات من
        // Configuration عبر config_id لا من scope). معلومة منطقية بلا أي سرّ.
        businessLoginSurface: dialogProbe.businessLoginSurface ?? null,
        scopeDiagnosis,
        redirectUri: callbackUrl,
        domain: urlInfo.host,
        appIdFormatOk: isPlausibleMetaAppId(String(cfg.clientId || "")),
        loginConfigIdUsed: Boolean(loginConfigId),
        metaSetupHint: { appDomainsValue: urlInfo.host && !isLocalHost(urlInfo.host) ? `https://${urlInfo.host}` : null, redirectUri: callbackUrl, note: "طابق App ID وApp Domains وValid OAuth Redirect URIs، وتأكد أن كل صلاحية مطلوبة مفعّلة في Use Case أو Configuration ID." },
      });
    }
    // فصل صريح: `is_business_login=1` هو السلوك الطبيعي لأي تطبيق يطلب صلاحيات
    // أعمال/صفحات (يظهر أيضاً لتطبيقات كلاسيكية مرجعية)، و`0` عند صلاحيات استهلاكية
    // أو بلا scope — فالعلم **لا يعني** أن التطبيق Business ولا أن Configuration
    // مطلوب. لذلك لم يعد الحجب الافتراضي: نمرّر scope ونكمل الربط، ويبقى الحجب
    // الصارم متاحاً بمفتاح `META_ALLOW_SCOPE_WITHOUT_CONFIG=false` لمن يثبت لديه
    // أن تطبيقه Business ويلزمه config_id. (كان الحجب الافتراضي إيجاباً كاذباً
    // يمنع ربط أي تطبيق كلاسيكي يطلب صلاحيات صفحات.)
    if (dialogProbe.businessLoginSurface === true && !loginConfigId && !metaScopeWithoutConfigOverride()) {
      logOAuthStart(platform, { outcome: "business_login_without_config", businessLoginSurface: true, loginConfigIdConfigured: preflight.loginConfig?.configured ?? false, redirectUri: callbackUrl, domain: urlInfo.host, scopeCount: scopes.length });
      const result: OAuthStartPreflight = {
        ok: false,
        code: "META_BUSINESS_LOGIN_REQUIRES_CONFIG_ID",
        error: "تطبيق Meta من نوع Business: الحوار يسلك واجهة Business Login التي تقرأ الصلاحيات من Configuration (config_id) لا من scope، فسيعرض «حدث خطأ ما» بعد تسجيل الدخول ولا يعيد رمزاً.",
        hint: `أنشئ Configuration في Meta App Dashboard → Facebook Login for Business → Configurations (نوع User access token) بالصلاحيات التي يعرضها GET /api/platforms/${platform}/oauth/setup في حقل scopes، ثم ضع معرّفه الرقمي في INSTAGRAM_LOGIN_CONFIG_ID (أو FACEBOOK_LOGIN_CONFIG_ID) في بيئة الخادم وأعد التشغيل.`,
      };
      lastOAuthPreflight.set(platform, { at: Date.now(), code: result.code ?? null, appTokenKind: preflight.appToken?.kind ?? null, error: result.error, hint: result.hint });
      return res.status(409).json({
        success: false,
        code: "META_BUSINESS_LOGIN_REQUIRES_CONFIG_ID",
        error: result.error,
        hint: result.hint,
        platform,
        businessLoginSurface: true,
        loginConfigIdConfigured: preflight.loginConfig?.configured ?? false,
        loginConfigEnvNames: loginConfigEnvNames(platform),
        scopes: platform === "instagram" ? instagramOAuthScopes() : facebookOAuthScopes(),
        redirectUri: callbackUrl,
        domain: urlInfo.host,
        bypassEnv: "META_ALLOW_SCOPE_WITHOUT_CONFIG",
        setupUrl: `${publicBaseUrlNow()}/api/platforms/${platform}/oauth/setup`,
      });
    }
  }
  audit((req as any).user.id,"platform_oauth_started",platform);
  // نثبّت جلسة OAuth قبل إرجاع رابط التفويض: قد يقضي المالك دقائق في شاشة
  // الموافقة وقد تُطفأ العملية، فيلزم أن تصمد الحالة في المخزن الدائم.
  await persistCritical();
  // Meta يرفض رابط إرجاع غير عام (localhost/بلا https) برسالة «لا يمكن تحميل
  // عنوان URL / النطاق غير مُضمَّن في نطاقات التطبيق». لا نحجب البدء (لئلا نكسر
  // التطوير المحلي)، لكن نُعلن السبب صراحةً ونُرفق الرابط والنطاق الفعليين
  // اللذين يجب تسجيلهما لدى Meta، فلا يبقى المالك بلا قيمة صحيحة يضعها.
  const domainWarning = publicOk ? null : {
    code:"PUBLIC_URL_NOT_PUBLIC",
    message:"العنوان العام غير إنتاجي (localhost أو بلا https)؛ سيرفض Meta رابط الإرجاع برسالة «لا يمكن تحميل عنوان URL». اضبط APP_URL على نطاقك العام (https) وسجّل رابط الإرجاع لدى Meta.",
    redirectUri:callbackUrl,
    domain:urlInfo.host,
    publicUrlSource:urlInfo.source,
    publicUrlProblems:urlInfo.problems,
  };
  if(domainWarning) console.warn(`[oauth] ${platform} redirect_uri غير عام: ${urlInfo.source} (${urlInfo.host || "-"})`);
  // معلومات الإصلاح للمالك: عند تحذير الرابط أو تعذّر إثبات التطبيق، نُرفق
  // دلائل دقيقة (شكل المعرّف ونتيجة فحص Graph) بلا أي سرّ.
  const metaSetupHint = (META_OAUTH_PLATFORMS.has(platform) && (domainWarning || preflight.code === "META_PREFLIGHT_UNAVAILABLE")) ? {
    appIdFormatOk: isPlausibleMetaAppId(String(cfg.clientId || "")),
    appTokenKind: preflight.appToken?.kind ?? null,
    appTokenMessage: preflight.appToken?.message ?? preflight.hint ?? null,
    note:"إن ظهرت صفحة «حدث خطأ ما» فمعرّف التطبيق/سرّه أو App Domains/Valid OAuth Redirect URIs غير مطابق لدى Meta. القيم الدقيقة في GET /api/platforms/:platform/oauth/setup.",
  } : undefined;
  // سجل آمن: الروابط والنطاق والفاتورة فقط — بلا client_id ولا أي سرّ.
  logOAuthStart(platform, { outcome: "authorized_url_issued", redirectUri: callbackUrl, domain: urlInfo.host, publicUrlSource: urlInfo.source, publicUrlIsPublic: publicOk, appTokenKind: preflight.appToken?.kind ?? null, scopeCount: scopes.length, authEndpoint: authEndpointFor(platform), domainWarning: Boolean(domainWarning), metaSetupHint: Boolean(metaSetupHint), scopeDependencyGaps: scopeGaps, loginConfigIdUsed: Boolean(loginConfigId) });
  res.json({success:true,platform,authorizationUrl:u.toString(),authEndpoint:authEndpointFor(platform),expiresAt:pending.expiresAt,redirectUri:callbackUrl,domain:urlInfo.host,publicUrlSource:urlInfo.source,publicUrlIsPublic:publicOk,scopes,appIdFormatOk:isPlausibleMetaAppId(String(cfg.clientId || "")),appTokenKind:preflight.appToken?.kind ?? null,domainWarning,metaSetupHint,scopeDependencyGaps:scopeGaps.length?scopeGaps:undefined,
    // TikTok: المفتاح المستخدم فعلاً في الرابط (مُخفى + بصمة) بلا أي سرّ، ليُقارَن
    // مباشرةً مع Client key في لوحة TikTok Developers عند رسالة رفض المفتاح.
    tiktokClientKey:(platform==="tiktok")?{
      envVarName:"TIKTOK_CLIENT_KEY",
      usedInAuthorizationUrlMasked:clientKeyFingerprint(u.searchParams.get("client_key")||"").masked,
      usedInAuthorizationUrlLength:clientKeyFingerprint(u.searchParams.get("client_key")||"").length,
      usedInAuthorizationUrlSha256Prefix:clientKeyFingerprint(u.searchParams.get("client_key")||"").sha256Prefix,
      matchesConfiguredEnv:clientKeyFingerprint(u.searchParams.get("client_key")||"").sha256Prefix===clientKeyFingerprint(process.env.TIKTOK_CLIENT_KEY).sha256Prefix,
      authorizationUrlHost:u.host,
    }:undefined,
    // Facebook Login for Business: عند استخدام config_id تُذكر الصلاحيات كالمجموعة
    // المتوقعة في الConfiguration، ويُعلن صراحةً أن الطلب لم يحمل scope.
    loginConfigIdUsed:Boolean(loginConfigId),
    loginConfigIdConfigured:preflight.loginConfig?.configured??false,
    loginConfigIdValid:preflight.loginConfig?.valid??false,
    loginConfigEnvNames:META_OAUTH_PLATFORMS.has(platform)?loginConfigEnvNames(platform):undefined,
    // القيمة الفعلية التي أُرسلت إلى Meta (أسماء وقيم غير سرّية). تُعرَض ليتحقق
    // المالك من الرابط النهائي بلا تخمين، وبلا كشف أي سرّ (Config ID ليس سرّاً،
    // وكلا المعرّفين العامّين redirect_uri/client_id مُعلنان أصلاً في الاستجابة).
    authorizationUrlParams:Object.fromEntries(u.searchParams.entries()),
    permissionSource:loginConfigId?"facebook_login_for_business_configuration":"oauth_scope_parameter",
    // واجهة الدخول التي سلكها الفحص فعلاً (is_business_login). الفحص بلا كوكيز
    // يتوقّف عند شاشة الدخول فلا يرى ما بعدها؛ لكنه يثبت **أي** واجهة اختارتها Meta.
    // عدم تطابق الواجهة مع طريقة تمرير الصلاحيات هو فشل يُرصد قبل الموافقة:
    //  - Business Login (true) يقرأ الصلاحيات من Configuration عبر config_id،
    //    فإن مرّرنا scope بدل config_id تُهمَل الصلاحيات => «حدث خطأ ما» بعد الدخول.
    //  - Facebook Login الكلاسيكي (false) يقرأها من scope، فلا يلزم config_id.
    // واجهة الدخول التي اختارتها Meta فعلاً (is_business_login). وفق وثيقة
    // «Facebook Login for Business - Instagram API» فإن مسار Instagram الرسمي
    // يعمل على واجهة Business Login ويمرّر الصلاحيات عبر scope (لا config_id)،
    // لذا biz=1 مع scope هو السلوك المطابق للوثيقة لا خطأ. القيمة للتشخيص فقط.
    businessLoginSurface:dialogProbe?.businessLoginSurface??null,
  });
});

/**
 * إكمال OAuth عبر POST من الواجهة بعد قراءة مقطع الاستجابة.
 *
 * سبب الوجود (تدفّق Meta الرسمي لـInstagram: response_type=token): تُلحق Meta
 * الرمز في **مقطع** الاستجابة (`#access_token=...`) الذي لا يُرسَل إلى الخادم.
 * الواجهة تقرأ المقطع ثم ترسله في **جسم** الطلب، فلا يظهر الرمز في سجل الخادم
 * ولا في محفوظات المتصفح ولا في Referer — بخلاف تمريره في سطر الطلب.
 */
app.post("/api/platforms/:platform/oauth/callback", express.json({ limit: "32kb" }), async (req,res)=>{
  const rawFragment = typeof req.body?.fragment === "string" ? req.body.fragment : "";
  const rawState = typeof req.body?.state === "string" ? req.body.state : "";
  const query = rawFragment
    ? `state=${encodeURIComponent(rawState)}&fragment=${encodeURIComponent(rawFragment)}`
    : `state=${encodeURIComponent(rawState)}`;
  return handleOAuthCallback(req, res, query, true);
});

app.get("/api/platforms/:platform/oauth/callback", async (req,res)=>{
  // تدفّق Meta الرسمي لـInstagram (Facebook Login for Business - Instagram API)
  // يعيد الرمز في **مقطع** الاستجابة (`#access_token=...`). المقطع لا يُرسَل إلى
  // الخادم أبداً، لذا هذا الطلب GET لا يحمل state/code ويرد 400 — لكنه **وجهة
  // إعادة التوجيه الحقيقية** التي يفتحها المتصفح. يجب أن يُخدم هنا تطبيق React
  // نفسه ليقرأ المقطع من الرابط ويرسله POST إلى نفس المسار بإكمال الربط.
  // بلا هذا الاستثناء كان المتصفح يرى 400 ولا يُنفَّذ أي إكمال => «لم يُربط بعد»
  // رغم أن Meta أرجعت الرمز بالفعل.
  if (platformOauthFragmentReturn(req)) return serveSpaIndex(res);
  return handleOAuthCallback(req, res, req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "", false);
});

/**
 * توجيه آمن عند فشل إكمال OAuth حسب فئة الخطأ الفعلية (لا تخمين ثابت). يمنع
 * إظهار رسالة عامة تُخفي السبب الحقيقي الذي أعاده المزود.
 */
function oauthFailureHint(platform:string, message:string):string{
  const m=message.toLowerCase();
  if(platform==="threads"){
    // Threads API: تطبيق غير منشور + حساب ليس مختبِراً مقبولاً => error_code 1349245.
    if(m.includes("1349245")||m.includes("has not accepted the invite")){
      return "سبب Meta: التطبيق في وضع Development والحساب ليس مختبِراً مقبولاً. أضِف حسابك المستخدَم لتسجيل الدخول كـ Threads Tester من App Dashboard → الأدوار بالتطبيق → Roles → Threads Tester، ثم اقبل الدعوة من Threads (الإعدادات → الحساب → أذونات الموقع → الدعوات) أو من developers.facebook.com/requests.";
    }
    if(m.includes("1349168")||m.includes("url blocked")){
      return "سبب Meta: رابط إعادة التوجيه محظور. أضِف قيمة redirectUri بالضبط في Threads API → تخصيص → الإعدادات → روابط إعادة توجيه OAuth.";
    }
  }
  if(m.includes("redirect_uri")||m.includes("1349168")) return "تحقق أن redirectUri المسجّل لدى المزود مطابق تماماً (بلا شرطة مائلة زائدة).";
  return "";
}

/**
 * جسم إكمال OAuth المشترك بين GET (رمز في سطر الطلب) وPOST (مقطع الاستجابة في
 * الجسم). يستقبل نص الاستعلام صراحةً فيتحقق بنفس القواعد في الحالتين، ولا يعتمد
 * على req.query كي لا تتسرّب قيم المقطع إلى سجلات الوسيط.
 */
async function handleOAuthCallback(req:any, res:any, rawQuery:string, viaPost:boolean){
  // POST (تدفّق المقطع) يرد JSON لاستدعاء fetch؛ GET (تدفّق code) يرد صفحة HTML
  // للمتصفح. المنطق واحد، ويختلف شكل الرد فقط.
  const sendHtml=(html:string)=>viaPost?res.json({success:true}):res.send(html);
  const failHtml=(status:number,msg:string)=>viaPost?res.status(status).json({success:false,error:msg}):res.status(status).send(msg);
  const params=new URLSearchParams(rawQuery||"");
  const platform=String(req.params.platform); const state=params.get("state")||""; const pending=pendingOAuth.get(state); const cfg=OAUTH_CONFIG[platform];
  const redirectUri=oauthCallbackUrl(platform);
  // سجل آمن لعودة Meta: هل وصلت، وبأي رمز خطأ — بلا state ولا code ولا توكن.
  logOAuthStart(platform, { outcome: "callback_received", viaPost, hasState: Boolean(state), hasCode: Boolean(params.get("code")), providerError: params.get("error") ? String(params.get("error")).slice(0, 60) : null, redirectUri });
  const check=validateOAuthCallback({pending,platform,redirectUri});
  if(!check.ok || !cfg) { logOAuthStart(platform, { outcome: "callback_rejected", reason: check.reason || "no_config" }); return failHtml(400, `فشل التحقق من جلسة OAuth: ${check.reason||"مزود غير مُعدّ"}.`); }
  // يُستهلك state مرة واحدة فقط (يمنع إعادة الاستخدام)؛ نثبّت الحذف في المخزن
  // الدائم فوراً فلا يُسترجَع عند إعادة تشغيل لاحقة فيُقبل تكرار الطلب.
  pendingOAuth.delete(state);
  await persistCritical();
  if(params.get("error")) return failHtml(400, `رفض مزود المنصة عملية الربط: ${String(formatOAuthProviderError({ error_message: params.get("error_message"), error_description: params.get("error_description"), error: params.get("error"), error_code: params.get("error_code") }) || params.get("error")).slice(0,300)}`);
  const code=params.get("code")||"";
  // تدفّق Meta الرسمي لـInstagram (Facebook Login for Business - Instagram API)
  // يستخدم response_type=token: لا يعود `code` بل رمز المستخدم (والرمز طويل الأجل)
  // في مقطع الاستجابة الذي يقرأه العميل ويعيده هنا. مسار Facebook لا يتأثّر.
  const fragmentToken=platform==="instagram"?parseInstagramTokenFragment(params.get("fragment")||""):{} as ReturnType<typeof parseInstagramTokenFragment>;
  const hasFragmentToken=Boolean(fragmentToken.longLivedToken||fragmentToken.accessToken);
  if(platform==="instagram"&&hasFragmentToken&&fragmentToken.error) return failHtml(400, `رفض مزود المنصة عملية الربط: ${String(fragmentToken.errorReason||fragmentToken.error).slice(0,200)}`);
  if(!code&&!hasFragmentToken) return failHtml(400, "لم يتم استلام رمز OAuth.");
  try {
    const body=buildTokenExchangeBody({clientId:cfg.clientId,clientSecret:cfg.clientSecret,code,redirectUri:redirectUri,codeVerifier:pending!.codeVerifier});
    // Facebook يبادل الرمز عبر GET على نقطة oauth/access_token (سلوك Meta الرسمي)
    // بخلاف مزودي application/x-www-form-urlencoded؛ الفرق معزول هنا.
    let token: any;
    if(platform==="facebook") {
      const client=facebookClient();
      const short=await client.exchangeCode({clientId:cfg.clientId,clientSecret:cfg.clientSecret,code,redirectUri:redirectUri});
      if(!short.ok || !short.data?.accessToken) throw new Error(short.error||"فشل تبادل رمز Facebook.");
      // رمز الصفحة الدائم يُشتق من رمز مستخدم طويل الأجل؛ نُطيله بدل الاعتماد على رمز قصير.
      const long=await client.exchangeLongLived({clientId:cfg.clientId,clientSecret:cfg.clientSecret,shortToken:short.data.accessToken});
      const userToken=long.ok && long.data?.accessToken ? long.data.accessToken : short.data.accessToken;
      token={access_token:userToken,expires_in:long.data?.expiresIn??short.data.expiresIn};
      // ترشيح الصفحات: صفحة واحدة => ربط مباشر؛ عدة صفحات => اختيار من الواجهة.
      const pages=await client.listManagedPages(userToken);
      if(!pages.ok || !pages.data?.length) throw new Error(pages.error||"لم يُعد Meta أي صفحة لهذا الحساب عبر /me/accounts. السبب الأكثر شيوعاً: الصفحة مملوكة لـBusiness Manager فتحتاج صلاحية business_management ورول على الصفحة (تُمنح تلقائياً لرول التطبيق في وضع Development). تحقق أن المستخدم أدمن/محرر على صفحة «معرض الغرابي للتقسيط».");
      if(pages.data.length===1) {
        const fin=await facebookFinalizePageSelection(pages.data[0].pageId,userToken,pages.data[0]);
        if(!fin.ok) throw new Error(fin.error||"تعذّر إتمام ربط الصفحة.");
        setProviderToken("facebook",{...token,pageId:pages.data[0].pageId,pageName:pages.data[0].pageName||"",pageAccessToken:getProviderToken("facebook")?.pageAccessToken||pages.data[0].pageAccessToken||"",userAccessToken:userToken,expiresAt:parsedTokenExpiry(token)});
        await persistStateDurable();
        audit(pending!.userId,"platform_oauth_connected",`facebook:${pages.data[0].pageId}`);
        return sendHtml(`<html lang='ar' dir='rtl'><meta charset='utf-8'><title>تم الربط</title><body style='font-family:sans-serif;padding:40px'><h2>تم ربط صفحة Facebook بنجاح.</h2><p>${escapeHtml(pages.data[0].pageName||"")} — يمكنك إغلاق هذه النافذة والعودة إلى الغرابي AI.</p></body></html>`);
      }
      // نحفظ رمز المستخدم مؤقتاً (مشفّراً) لاختيار الصفحة، ولا نعلن اتصالاً بعد.
      setProviderToken("facebook",{...token,userAccessToken:userToken,expiresAt:parsedTokenExpiry(token),pendingPageSelection:true});
      await persistStateDurable();
      audit(pending!.userId,"platform_oauth_page_selection_pending",`facebook:${pages.data.length}`);
      return res.send(`<html lang='ar' dir='rtl'><meta charset='utf-8'><title>اختيار الصفحة</title><body style='font-family:sans-serif;padding:40px'><h2>تم الربط، لكن الحساب يدير أكثر من صفحة.</h2><p>اختر الصفحة التي تريد ربطها من مركز ربط المنصات في الغرابي AI لإتمام الربط.</p></body></html>`);
    }
    // Instagram يسلك مسار Meta نفسه (Instagram API with Facebook Login): تبادل
    // الرمز ثم إطالته، ثم اكتشاف حساب Instagram المهني المرتبط بالصفحة.
    if(platform==="instagram") {
      const client=instagramClient();
      const fb=facebookClient();
      // مساران رسميان: (1) response_type=token يعيد الرمز طويل الأجل جاهزاً في
      // مقطع الاستجابة فلا حاجة لتبديل الرمز، (2) response_type=code (المسار
      // القديم) يُبادَل الرمز ثم يُطال. كلاهما ينتهي إلى رمز مستخدم واحد.
      let userToken=""; let tokenExpiresIn:number|undefined;
      if(hasFragmentToken) {
        userToken=fragmentToken.longLivedToken||fragmentToken.accessToken||"";
        tokenExpiresIn=fragmentToken.expiresIn;
      } else {
        const codeRes=await fb.exchangeCode({clientId:cfg.clientId,clientSecret:cfg.clientSecret,code,redirectUri:redirectUri});
        if(!codeRes.ok || !codeRes.data?.accessToken) throw new Error(codeRes.error||"فشل تبادل رمز Instagram.");
        const long=await fb.exchangeLongLived({clientId:cfg.clientId,clientSecret:cfg.clientSecret,shortToken:codeRes.data.accessToken});
        userToken=long.ok && long.data?.accessToken ? long.data.accessToken : codeRes.data.accessToken;
        tokenExpiresIn=long.data?.expiresIn??codeRes.data.expiresIn;
      }
      token={access_token:userToken,expires_in:tokenExpiresIn};
      // نكتشف الصفحات التي تحمل حساب Instagram مهنياً مرتبطاً.
      const pages=await client.listLinkedInstagramAccounts(userToken);
      if(!pages.ok || !pages.data) throw new Error(pages.error||"تعذّر جلب صفحات/حسابات Instagram.");
      const withIg=pages.data.filter((p)=>p.igAccountId);
      if(!withIg.length) throw new Error("لا يوجد حساب Instagram Professional (Business/Creator) مرتبط بأي صفحة يديرها هذا الحساب. اربط الحساب المهني بصفحة Facebook من إعدادات Instagram ثم أعد الربط.");
      if(withIg.length===1) {
        const fin=await instagramFinalizeAccountSelection(withIg[0].pageId,userToken);
        if(!fin.ok) throw new Error(fin.error||"تعذّر إتمام ربط حساب Instagram.");
        setProviderToken("instagram",{...getProviderToken("instagram"),expiresAt:parsedTokenExpiry(token),userAccessToken:userToken});
        await persistStateDurable();
        audit(pending!.userId,"platform_oauth_connected",`instagram:${fin.igAccountId}`);
        return sendHtml(`<html lang='ar' dir='rtl'><meta charset='utf-8'><title>تم الربط</title><body style='font-family:sans-serif;padding:40px'><h2>تم ربط حساب Instagram بنجاح.</h2><p>${escapeHtml(fin.igUsername?`@${fin.igUsername}`:fin.pageName||"")} — يمكنك إغلاق هذه النافذة والعودة إلى الغرابي AI.</p></body></html>`);
      }
      // عدة صفحات تحمل حسابات Instagram: نحفظ رمز المستخدم وننتظر اختيار المالك.
      setProviderToken("instagram",{...token,userAccessToken:userToken,expiresAt:parsedTokenExpiry(token),pendingPageSelection:true});
      await persistStateDurable();
      audit(pending!.userId,"platform_oauth_page_selection_pending",`instagram:${withIg.length}`);
      return res.send(`<html lang='ar' dir='rtl'><meta charset='utf-8'><title>اختيار الحساب</title><body style='font-family:sans-serif;padding:40px'><h2>تم الربط، لكن الحساب يدير أكثر من صفحة لها حساب Instagram.</h2><p>اختر الحساب الذي تريد ربطه من مركز ربط المنصات في الغرابي AI لإتمام الربط.</p></body></html>`);
    }
    // TikTok — مسار OAuth 2.0 الرسمي: تبادل الرمز (client_key) ثم إثبات الهوية
    // (open_id + display_name) ثم حفظ مشفّر مع refresh token والانتهاء.
    if(platform==="tiktok") {
      const client=tiktokClient();
      const exchanged=await client.exchangeCode({clientKey:String(cfg.clientId),clientSecret:String(cfg.clientSecret),code,redirectUri:redirectUri,codeVerifier:pending!.codeVerifier});
      if(!exchanged.ok || !exchanged.data?.accessToken) throw new Error(exchanged.error||"فشل تبادل رمز TikTok.");
      // إثبات الهوية فعلياً — لا اتصال موثق بلا open_id من TikTok.
      const identity=await client.getUserInfo(exchanged.data.accessToken);
      if(!identity.ok || !identity.data?.openId) throw new Error(identity.error||"تعذّر إثبات هوية حساب TikTok (open_id).");
      saveTikTokCredentials({
        accessToken: exchanged.data.accessToken,
        refreshToken: exchanged.data.refreshToken,
        openId: identity.data.openId,
        displayName: identity.data.displayName,
        avatarUrl: identity.data.avatarUrl,
        scope: exchanged.data.scope,
        expiresAt: exchanged.data.expiresIn?Date.now()+exchanged.data.expiresIn*1000:null,
        refreshExpiresAt: exchanged.data.refreshExpiresIn?Date.now()+exchanged.data.refreshExpiresIn*1000:null,
      });
      platformConnections.set("tiktok",{platform:"tiktok",status:"connected",accountId:identity.data.openId,accountName:identity.data.displayName||"TikTok",connectedAt:new Date().toISOString(),providerVerified:true});
      savePlatformConnections();
      await persistStateDurable();
      audit(pending!.userId,"platform_oauth_connected",`tiktok:${identity.data.openId}`);
      logTikTokOAuth("callback_connected",{openId:identity.data.openId,scopeCount:exchanged.data.scope.length,hasRefreshToken:Boolean(exchanged.data.refreshToken)});
      return sendHtml(`<html lang='ar' dir='rtl'><meta charset='utf-8'><title>تم الربط</title><body style='font-family:sans-serif;padding:40px'><h2>تم ربط حساب TikTok بنجاح.</h2><p>${escapeHtml(identity.data.displayName||"")} — يمكنك إغلاق هذه النافذة والعودة إلى الغرابي AI.</p></body></html>`);
    }
    // Threads — تطبيق Meta منفصل. رمز التفويض قصير الأجل (~ساعة) فيجب إطالته
    // فوراً إلى رمز طويل الأجل (grant_type=th_exchange_token)، وإلا انتهى الرمز
    // بعد ساعة فيفشل النشر بـ«Session has expired» (العطل المُثبت).
    if(platform==="threads") {
      const client=threadsClient();
      const short=await client.exchangeCode({clientId:String(cfg.clientId),clientSecret:String(cfg.clientSecret),code,redirectUri:redirectUri});
      if(!short.ok || !short.data?.accessToken) throw new Error(short.error||"فشل تبادل رمز Threads.");
      const long=await client.exchangeLongLived({clientSecret:String(cfg.clientSecret),shortToken:short.data.accessToken});
      const accessToken=long.ok && long.data?.accessToken ? long.data.accessToken : short.data.accessToken;
      const profile=await client.getProfile(accessToken);
      if(!profile.ok || !profile.data?.threadsUserId) throw new Error(profile.error||"تعذّر إثبات هوية حساب Threads.");
      const expiresAt=long.data?.expiresIn ? Date.now()+long.data.expiresIn*1000 : null;
      setProviderToken("threads",{access_token:accessToken,threadsUserId:profile.data.threadsUserId,username:profile.data.username||null,expiresAt,connectedAt:new Date().toISOString()});
      platformConnections.set("threads",{platform:"threads",status:"connected",accountId:profile.data.threadsUserId,accountName:profile.data.username?`@${profile.data.username}`:"Threads",connectedAt:new Date().toISOString(),providerVerified:true});
      savePlatformConnections();
      await persistStateDurable();
      audit(pending!.userId,"platform_oauth_connected",`threads:${profile.data.threadsUserId}`);
      return sendHtml(`<html lang='ar' dir='rtl'><meta charset='utf-8'><title>تم الربط</title><body style='font-family:sans-serif;padding:40px'><h2>تم ربط حساب Threads بنجاح.</h2><p>${escapeHtml(profile.data.username?`@${profile.data.username}`:"Threads")} — يمكنك إغلاق هذه النافذة والعودة إلى الغرابي AI.</p></body></html>`);
    }
    // YouTube — مسار Google OAuth 2.0: تبادل الرمز ثم إثبات هوية القناة فعلياً
    // عبر channels.list?mine=true (نطاق youtube.readonly). لا يُعلن اتصال موثق
    // بلا قناة حقيقية من Google، فلا تُبنى حالة على اسم قناة مُختلق.
    if(platform==="youtube") {
      const client=youtubeClient();
      const exchanged=await client.exchangeCode({clientId:String(cfg.clientId),clientSecret:String(cfg.clientSecret),code,redirectUri:redirectUri});
      if(!exchanged.ok || !exchanged.data?.accessToken) throw new Error(exchanged.error||"فشل تبادل رمز Google.");
      const channel=await client.fetchMyChannel(exchanged.data.accessToken);
      if(!channel.ok || !channel.data?.channelId) throw new Error(channel.error||"تعذّر إثبات هوية قناة YouTube.");
      saveYouTubeCredentials({
        accessToken: exchanged.data.accessToken,
        refreshToken: exchanged.data.refreshToken,
        expiresAt: exchanged.data.expiresIn?Date.now()+exchanged.data.expiresIn*1000:null,
        scope: exchanged.data.scope,
        channelId: channel.data.channelId,
        channelTitle: channel.data.title,
        uploadsPlaylistId: channel.data.uploadsPlaylistId,
      });
      platformConnections.set("youtube",{platform:"youtube",status:"connected",accountId:channel.data.channelId,accountName:channel.data.title||"YouTube",connectedAt:new Date().toISOString(),providerVerified:true});
      savePlatformConnections();
      await persistStateDurable();
      audit(pending!.userId,"platform_oauth_connected",`youtube:${channel.data.channelId}`);
      logYouTube("callback_connected",{channelId:channel.data.channelId,scopeCount:exchanged.data.scope.length,hasRefreshToken:Boolean(exchanged.data.refreshToken)});
      return sendHtml(`<html lang='ar' dir='rtl'><meta charset='utf-8'><title>تم الربط</title><body style='font-family:sans-serif;padding:40px'><h2>تم ربط قناة YouTube بنجاح.</h2><p>${escapeHtml(channel.data.title||"")} — يمكنك إغلاق هذه النافذة والعودة إلى الغرابي AI.</p></body></html>`);
    }
    const tokenRes=await fetch(cfg.token,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body}); token=await tokenRes.json();
    const parsedToken=parseTokenResponse(token);
    if(!tokenRes.ok || !parsedToken.valid) throw new Error(parsedToken.reason||token.error_description||token.error||"فشل تبادل رمز OAuth");
    // إثبات حساب حقيقي إلزامي — **لا** هوية مُختلقة («authorized-user»/«حساب متصل»)
    // عند فشل أو غياب الاستعلام. كانت هذه الهوية الوهمية تُعلن providerVerified:true
    // رغم فشل التحقق الفعلي (الثغرة المُثبتة في التدقيق الجنائي)؛ الآن يُرفض تبادل
    // الرمز كاملاً بلا هوية حقيقية مؤكَّدة من المزود، تماماً كمسارَي يوتيوب/تيك توك
    // أعلاه. هذا يعني أن منصة بلا فرع تحقق حقيقي في fetchProviderAccount (مثل
    // Snapchat حالياً) لا يمكنها إكمال اتصال OAuth إطلاقاً حتى يُضاف فرع حقيقي لها
    // — وهو السلوك الصحيح (لا اتصال "موثق" بلا إثبات)، وليس فيه أي ضرر عملي لأن
    // Snapchat/X/Threads/Google Business جميعها realConnector:false بالفعل (لا
    // تنفيذ خارجي أصلاً عبرها حتى مع هذه الثغرة).
    const proof=await fetchProviderAccount(platform,parsedToken.accessToken!);
    if(!proof || !proof.accountId) throw new Error(`تعذّر إثبات هوية حساب ${platform} الحقيقية لدى المزود بعد تبادل الرمز؛ لا يُعلن اتصال موثق بلا هوية حقيقية مؤكَّدة.`);
    const accountId=proof.accountId, accountName=proof.accountName||proof.accountId;
    // يُخزَّن الرمز مع انتهاء مطلق محسوب ومع refresh token إن وُجد.
    const stored={...token, expiresAt: parsedToken.expiresIn ? Date.now()+parsedToken.expiresIn*1000 : null};
    setProviderToken(platform,stored); platformConnections.set(platform,{platform,status:"connected",accountId,accountName,connectedAt:new Date().toISOString(),providerVerified:true}); savePlatformConnections(); audit(pending!.userId,"platform_oauth_connected",`${platform}:${accountId}`);
    sendHtml("<html lang='ar' dir='rtl'><meta charset='utf-8'><title>تم الربط</title><body style='font-family:sans-serif;padding:40px'><h2>تم ربط المنصة بنجاح.</h2><p>يمكنك إغلاق هذه النافذة والعودة إلى الغرابي AI.</p></body></html>");
  } catch(e:any) { audit(pending!.userId,"platform_oauth_failed",platform); console.error(`[oauth-callback-error] ${platform} status=502 message=${String(e?.message||e)}`); const msg=String(e?.message||e); const hint=oauthFailureHint(platform,msg); failHtml(502, `فشل إكمال ربط المنصة: ${msg.slice(0,300)}${hint?" — "+hint:""}`); }
}

app.post("/api/platforms/telegram/configure", requireOwner, async (req,res)=>{
  // رمز البوت من المدخل ثم من بيئة الخادم؛ في الإنتاج يكفي ضبط البيئة
  // دون نسخ أي سر إلى الواجهة أو المحادثة.
  const botToken=(typeof req.body?.botToken==="string"?req.body.botToken.trim():"")||telegramBotToken();
  // السرّ لا يُدوَّر تلقائياً. إن وُجد سرّ محفوظ أو في البيئة يُعاد استخدامه
  // كما هو، فلا ينفصل السرّ المسجّل لدى Telegram عن السرّ الذي يتحقق منه الخادم
  // (وهو السبب الجذري لبقاء تحديثات Telegram مرفوضة بعد كل restart).
  const webhookSecret=(typeof req.body?.webhookSecret==="string"?req.body.webhookSecret.trim():"")||telegramWebhookSecret()||TELEGRAM_WEBHOOK_SECRET_ENV;
  if(!botToken) return res.status(400).json({success:false,error:"رمز Telegram Bot مطلوب (أو اضبط TELEGRAM_BOT_TOKEN في البيئة)."});
  if(!tokenKeyBytes()) return res.status(503).json({success:false,error:tokenKeyInspection().reason});
  if(!resolvePublicUrl(process.env).valid) return res.status(503).json({success:false,error:"العنوان العام غير مضبوط (APP_URL أو ما يعادله)؛ لا يمكن تسجيل رابط webhook الحقيقي لدى Telegram."});
  // السرّ يجب أن يكون قوياً حسب متطلبات Telegram (1-256 محرفاً، A-Z a-z 0-9 _ -).
  const secret = webhookSecret || crypto.randomBytes(32).toString("hex");
  if(!/^[A-Za-z0-9_-]{8,256}$/.test(secret)) return res.status(400).json({success:false,error:"سرّ webhook يجب أن يكون 8-256 محرفاً من A-Z a-z 0-9 _ - لتقبله Telegram."});
  const client = new TelegramClient(botToken, telegramFetchImpl);
  // 1) إثبات الرمز فعلياً: لا يُعلن اتصال بلا استجابة getMe صحيحة.
  const me = await client.getMe();
  if(!me.ok || !me.botId) return res.status(400).json({success:false,error:me.error||"تعذر التحقق من Telegram Bot Token."});
  // 2) حفظ الاعتماد المشفّر **قبل** تسجيل webhook: لو فشل الحفظ لاحقاً لبقي
  // لدى Telegram سرّ لا يعرفه الخادم فتُرفض كل التحديثات. الحفظ أولاً يمنع ذلك.
  try { saveTelegramCredentials(botToken, secret, telegramWebhookUrl()); }
  catch(e:any) { return res.status(503).json({success:false,error:`تعذّر حفظ اعتماد Telegram: ${String(e?.message||e).slice(0,180)}`}); }
  // 3) تسجيل webhook الحقيقي مع السرّ: يصبح أساس التحقق من كل تحديث وارد.
  const hook = await client.setWebhook(telegramWebhookUrl(), secret);
  if(!hook.ok) return res.status(502).json({success:false,error:`تم التحقق من البوت لكن تعذّر تسجيل webhook: ${hook.description||""}`.trim()});
  // 4) إثبات التسجيل فعلاً لدى Telegram (getWebhookInfo) بدل الاكتفاء برد setWebhook.
  const info = await client.getWebhookInfo();
  const registration = checkWebhookRegistration({ info, expectedUrl: telegramWebhookUrl(), secretConfigured: Boolean(secret) });
  platformConnections.set("telegram",{platform:"telegram",status:"connected",accountId:me.botId,accountName:me.username?`@${me.username}`:me.firstName||"Telegram Bot",connectedAt:new Date().toISOString(),providerVerified:true});
  savePlatformConnections();
  // ننتظر ثبات الاعتماد المشفّر قبل الرد: لا يجوز أن يبدأ Telegram بدفع التحديثات
  // وسرّه ليس بعد في المخزن الدائم (وإلا رُفضت كل تحديثاته بعد restart).
  await persistStateDurable();
  audit((req as any).user.id,"telegram_configured",me.botId);
  // لا يُعاد الرمز ولا السرّ إطلاقاً؛ يُعلن فقط نجاح التحقق وضبط الـwebhook.
  res.json({success:true,connection:safeConnection("telegram"),webhook:{registered:true,url:telegramWebhookUrl(),secretConfigured:true,status:registration.status,verified:registration.matchesExpectedUrl,detail:registration.detail},verified:true});
});

// -------------------------------------------------------------
// استيعاب أحداث webhook (مصدر واحد لكل المنصّات التي تصل كتعليق/رسالة).
// كان المنطق نفسه مكرّراً في أربعة مسارات (Telegram/Facebook/Instagram/الموحّد)؛
// توحيده يمنع أي انحراف بين المنصّات في: منع التكرار، الحفظ قبل الإقرار، وحفظ
// سجل الحدث. القواعد الملزمة محفوظة حرفياً: لا معالجة مكرّرة، والحفظ الدائم
// **قبل** الإقرار، ولا يُخزَّن أي حدث بلا تحقق سابق.
// - `providerEventId`/`seenProviderEventIds`/`appendProviderId`: منع التكرار
//   بمعرّف المزود (update_id لـTelegram، externalId لـFacebook/Instagram). لولاها
//   يُفحص المعرّف الخارجي عبر قائمة سجلات المنصّة وحدها.
// - `omitKind`: يُبقي شكل تعليق Telegram القديم (بلا حقل kind).
// - `webhookEventType`: نوع سجل الحدث (افتراضياً "webhook"، و"message" لـTelegram).
// - `auditKind`: إن وُجد يُسجَّل تدقيقياً بعدد المقبول/الكل.
// -------------------------------------------------------------
type WebhookIngestEvent = {
  kind: string;
  externalId: string;
  parentExternalId: string | null;
  authorName: string | null;
  text: string;
  createdAt: string;
  replyTarget: Record<string, unknown> | null;
};
async function ingestWebhookComments(input: {
  platform: string;
  events: WebhookIngestEvent[];
  providerEventId?: (ev: WebhookIngestEvent) => string | number;
  seenProviderEventIds?: Array<string | number>;
  appendProviderId?: (ev: WebhookIngestEvent) => void;
  omitKind?: boolean;
  webhookEventType?: string | ((ev: WebhookIngestEvent) => string);
  auditKind?: string;
  onEvent?: (ev: WebhookIngestEvent, outcome: "accepted" | "duplicate") => void;
}): Promise<{ accepted: string[]; duplicates: number; created: any[] }> {
  const { platform, events } = input;
  if (!Array.isArray((workspace as any).socialComments)) (workspace as any).socialComments = [];
  if (!Array.isArray((workspace as any).webhookEvents)) (workspace as any).webhookEvents = [];
  const seenExternal = (workspace as any).socialComments.filter((c: any) => c.platform === platform).map((c: any) => c.externalId);
  const seenProvider = input.seenProviderEventIds || [];
  const accepted: string[] = [];
  const acceptedEvents: WebhookIngestEvent[] = [];
  const created: any[] = [];
  let duplicates = 0;
  for (const ev of events) {
    const providerEventId = input.providerEventId ? input.providerEventId(ev) : ev.externalId;
    if (isReplayOrDuplicate({ providerEventId, externalId: ev.externalId, seenProviderEventIds: seenProvider, seenExternalIds: [...seenExternal, ...accepted] })) {
      duplicates += 1;
      input.onEvent?.(ev, "duplicate");
      continue;
    }
    const classification = classifyComment(ev.text);
    const comment: any = {
      id: workspaceId("comment"), platform, externalId: ev.externalId,
      postExternalId: ev.parentExternalId, authorName: ev.authorName, text: ev.text,
      createdAt: ev.createdAt, classification, requiresHumanReview: classification.requiresHumanReview,
      // مصدر الاستقبال حقيقي صراحةً، فلا يظهر كـ simulated/not delivered.
      ingestSource: `${platform}_webhook`, replyTarget: ev.replyTarget,
    };
    if (!input.omitKind) comment.kind = ev.kind;
    (workspace as any).socialComments.unshift(comment);
    if ((workspace as any).socialComments.length > WORKSPACE_MAX_SOCIAL_COMMENTS) (workspace as any).socialComments.length = WORKSPACE_MAX_SOCIAL_COMMENTS;
    input.appendProviderId?.(ev);
    accepted.push(ev.externalId);
    acceptedEvents.push(ev);
    created.push(comment);
    input.onEvent?.(ev, "accepted");
  }
  if (accepted.length) {
    const typeOf = typeof input.webhookEventType === "function" ? input.webhookEventType : () => (input.webhookEventType as string) || "webhook";
    (workspace as any).webhookEvents.unshift(...acceptedEvents.map((ev) => ({ id: workspaceId("event"), platform, type: typeOf(ev), externalId: ev.externalId, receivedAt: new Date().toISOString() })));
    (workspace as any).webhookEvents = (workspace as any).webhookEvents.slice(0, WORKSPACE_MAX_WEBHOOK_EVENTS);
  }
  if (input.auditKind) audit("system", input.auditKind, `${accepted.length}/${events.length}`);
  // الحفظ الدائم **قبل** الإقرار: يضمن ثبات الحدث ومعرّف منع التكرار.
  await persistStateDurable();
  return { accepted, duplicates, created };
}

// -------------------------------------------------------------
// Telegram webhook — استقبال حقيقي للرسائل الواردة ثم تمريرها لمدير السوشيال.
// التحقق: ترويسة Telegram السرّية بزمن ثابت. منع التكرار: update_id والمعرّف الخارجي.
// لا يُقبل أي payload بلا تحقق، ولا يُخزَّن حدث مكرر.
// -------------------------------------------------------------
app.post("/api/platforms/telegram/webhook", express.json({limit:"256kb"}), async (req,res)=>{
  if(!SUPPORTED_PLATFORMS.some((p:any)=>p.id==="telegram")) return res.status(404).json({success:false,error:"المنصة غير مدعومة."});
  const expected = telegramWebhookSecret();
  const rawUpdateId = Number((req.body as any)?.update_id);
  const updateId = Number.isFinite(rawUpdateId) ? rawUpdateId : null;
  const verification = verifyTelegramSecret({ header: String(req.headers[TELEGRAM_SECRET_HEADER]||""), expectedSecret: expected });
  if(!verification.ok) {
    logTelegramWebhook({ updateId, outcome: "rejected" });
    return res.status(401).json({success:false,error:verification.reason||"تحديث غير موثوق."});
  }
  const parsed = parseTelegramUpdate(req.body);
  // تحديث غير نصي (وسائط/تعديلات) يُقبل ويُتجاهل بلا خطأ، فلا يُعيد Telegram المحاولة.
  if(!parsed) {
    logTelegramWebhook({ updateId, outcome: "ignored" });
    return res.status(200).json({success:true,accepted:true,ignored:"non_text_update"});
  }
  const externalId = telegramExternalId(parsed.chatId, parsed.messageId);
  const seenUpdates = (workspace as any).telegramUpdateIds || [];
  const seenExternal = (workspace as any).socialComments.filter((c:any)=>c.platform==="telegram").map((c:any)=>c.externalId);
  if(isDuplicateUpdate({ updateId: parsed.updateId, externalId, seenUpdateIds: seenUpdates, seenExternalIds: seenExternal })){
    logTelegramWebhook({ updateId: parsed.updateId, externalId, outcome: "duplicate" });
    return res.status(200).json({success:true,duplicate:true,externalId});
  }
  // تمرير الرسالة لمخزن تعليقات مدير السوشيال عبر المصدر الموحّد (منع تكرار +
  // حفظ قبل الإقرار). سجل الحدث بنوع "message" كما كان.
  const telegramEvent = buildNormalizedEvent({
    platform: "telegram", kind: "message", externalId, text: parsed.text,
    authorName: parsed.authorName ?? null, createdAt: parsed.date,
    // هدف الرد الحقيقي: الدردشة والرسالة، فيستطيع المُرسل الرد فعلياً لاحقاً.
    replyTarget: { chatId: parsed.chatId, messageId: parsed.messageId },
  });
  const { created } = await ingestWebhookComments({
    platform: "telegram", events: [telegramEvent], omitKind: true, webhookEventType: "message",
    providerEventId: () => parsed.updateId, seenProviderEventIds: seenUpdates,
    // تخزين الحد الأدنى للحماية من التكرار ثم الحفظ الدائم قبل الإقرار.
    appendProviderId: () => { (workspace as any).telegramUpdateIds = [...seenUpdates, parsed.updateId].slice(-20000); },
  });
  const comment = created[0];
  const persisted = !lastPersistError;
  audit("system","telegram_inbound_message",externalId);
  logTelegramWebhook({ updateId: parsed.updateId, externalId, outcome: "accepted", persisted });
  res.status(200).json({success:true,accepted:true,externalId,commentId:comment.id,requiresHumanReview:comment.classification.requiresHumanReview,persisted});
});

// -------------------------------------------------------------
// حالة webhook Telegram الحقيقية — للمالك فقط، بلا أي سرّ.
// تستعلم getWebhookInfo فعلياً من Telegram (رابط، تحديثات معلّقة، آخر خطأ،
// عدد الاتصالات) وتقارن الرابط المسجّل برابط هذا الخادم، فيُعرف من الواجهة هل
// الاستقبال فعّال فعلاً بدل الاكتفاء بظهور الزر أخضر.
// -------------------------------------------------------------
app.get("/api/platforms/telegram/webhook-info", requireOwner, async (_req,res)=>{
  const client = telegramClient();
  if(!client) return res.status(503).json({success:false,error:"موصل Telegram غير مهيأ (رمز بوت غير متوفر)."});
  const info = await client.getWebhookInfo();
  if(!info.ok) return res.status(502).json({success:false,error:info.error||"تعذّر استعلام حالة webhook من Telegram."});
  const expectedUrl = telegramWebhookUrl();
  const registration = checkWebhookRegistration({ info, expectedUrl, secretConfigured: Boolean(telegramWebhookSecret()) });
  const stored = getProviderToken("telegram");
  res.json({
    success:true,
    provider:"telegram",
    expectedUrl,
    registeredUrl: info.url,
    matchesExpectedUrl: registration.matchesExpectedUrl,
    status: registration.status,
    detail: registration.detail,
    pendingUpdateCount: info.pendingUpdateCount,
    lastErrorDate: info.lastErrorDate,
    lastErrorMessage: info.lastErrorMessage,
    lastSynchronizationErrorDate: info.lastSynchronizationErrorDate,
    maxConnections: info.maxConnections,
    allowedUpdates: info.allowedUpdates,
    webhookSecretConfigured: Boolean(telegramWebhookSecret()),
    secretSource: stored?.webhookSecret ? "stored" : (TELEGRAM_WEBHOOK_SECRET_ENV ? "env" : "none"),
    registeredAt: stored?.webhookRegisteredAt || null,
    botTokenConfigured: Boolean(telegramBotToken()),
    checkedAt: new Date().toISOString(),
    // لا يُعاد أي رمز بوت ولا سرّ — getWebhookInfo لا يعيد السرّ أصلاً.
    note:"حالة حقيقية من Telegram بلا أي سرّ. لا يُعلن الاستقبال فعّالاً إلا إذا طابق الرابط المسجّل رابط هذا الخادم ووُجد سرّ محفوظ.",
  });
});

/**
 * الجسم الخام يُلتقط فعلياً في وسيط JSON الأول (أعلى الملف) حيث يقرأ التدفق
 * الوحيد. هذا الوسيط يتحقق فقط من توفّره قبل حساب HMAC، ويرفض صراحةً إن غاب
 * (نوع محتوى غير JSON مثلاً) بدل التحقق على جسم مُعاد تسلسله — فلا يمكن تجاوز
 * التحقق أبداً بإعادة التسلسل.
 */
const requireRawBody: express.RequestHandler = (req, res, next) => {
  if (typeof (req as any).rawBody !== "string") {
    return res.status(400).json({ success: false, error: "جسم الطلب الخام غير متوفر للتحقق من التوقيع." });
  }
  next();
};

// -------------------------------------------------------------
// Facebook — مسارات الموصل الحقيقي (OAuth + webhook + رد + رسالة).
// التحقق: HMAC-SHA256 على الجسم الخام (X-Hub-Signature-256). منع التكرار:
// معرّف الحدث الحقيقي من Meta (comment_id/mid) محفوظاً عبر المحوّل.
// لا يُقبل حدث بلا توقيع صحيح، ولا يُخزَّن مكرر، ولا يُعلن تسليم بلا معرّف مزود.
// -------------------------------------------------------------

/** ترشيح الصفحات التي يديرها المستخدم بعد OAuth (لاختيار الصفحة يدوياً). */
app.get("/api/platforms/facebook/pages", requireOwner, async (_req,res)=>{
  const stored=getProviderToken("facebook");
  const userToken=stored?.userAccessToken?String(stored.userAccessToken):"";
  if(!userToken) return res.status(409).json({success:false,error:"لا رمز مستخدم Facebook محفوظ؛ نفّذ الربط عبر OAuth أولاً."});
  const pages=await facebookClient().listManagedPages(userToken);
  if(!pages.ok) return res.status(502).json({success:false,error:pages.error||"تعذّر جلب صفحات Facebook."});
  // لا يُعاد أي رمز صفحة للواجهة؛ معرّف واسم فقط.
  res.json({success:true,pages:(pages.data||[]).map((p)=>({pageId:p.pageId,pageName:p.pageName})),note:"معرّفات وأسماء فقط بلا أي رمز وصول."});
});

/** اختيار صفحة محدّدة لإتمام الربط (يثبتها ويشترك بها فعلياً). */
app.post("/api/platforms/facebook/select-page", requireOwner, async (req,res)=>{
  const pageId=typeof req.body?.pageId==="string"?req.body.pageId.trim():"";
  if(!pageId) return res.status(400).json({success:false,error:"معرّف الصفحة مطلوب."});
  const stored=getProviderToken("facebook");
  const userToken=stored?.userAccessToken?String(stored.userAccessToken):"";
  if(!userToken) return res.status(409).json({success:false,error:"لا رمز مستخدم Facebook محفوظ؛ نفّذ الربط عبر OAuth أولاً."});
  // نجلب رمز الصفحة من /me/accounts مباشرةً (يمنح رمز كل صفحة)، فلا نستدعي
  // GET /{page-id} الذي يستدعي pages_read_engagement ويرد #100 على صفحات لا تمنحها.
  const pages=await facebookClient().listManagedPages(userToken);
  if(!pages.ok) return res.status(502).json({success:false,error:pages.error||"تعذّر جلب صفحات Facebook."});
  const page=(pages.data||[]).find((p)=>String(p.pageId)===String(pageId));
  if(!page) return res.status(404).json({success:false,error:"الصفحة المختارة ليست ضمن الصفحات التي يديرها هذا الحساب."});
  const result=await facebookFinalizePageSelection(page.pageId,userToken,page);
  if(!result.ok) return res.status(502).json({success:false,error:result.error||"تعذّر ربط الصفحة المختارة."});
  await persistStateDurable();
  audit((req as any).user.id,"facebook_page_selected",pageId);
  res.json({success:true,connection:safeConnection("facebook"),pageName:result.pageName||null,webhookSubscribed:result.subscribed===true});
});

/** إثبات اشتراك الصفحة الفعلي في webhook (مقابل subscribed_apps). */
/**
 * تشخيص ارتباط تطبيق Facebook بحافظة أعمال (Business Portfolio) — للمالك فقط.
 * غرضه حسم مسألة «هل تطبيقنا مرتبط بحافظة أعمال؟» من جهة Graph API بلا تخمين،
 * بجانب إثبات صحة بيانات التطبيق. يعتمد على **وثيقة Meta الرسمية** لا على اختراع:
 * - `GET /{app-id}?fields=id,name,company,app_domains` برمز `client_id|client_secret`
 *   يثبت أن التطبيق صالح من جهة Graph و`company` نصّي حرّ (لا يُثبت الارتباط).
 * - **عقدة /{app-id} لا تحمل حقل `business` إطلاقاً** (موثّق) — لذلك لا يُقرأ ولا
 *   يُخترع؛ نُعلن ذلك صراحةً في الحقل `businessFieldOnAppNode:false`.
 * - ارتباط التطبيق بحافظة يُثبت عكسياً عبر `GET /{business_id}/owned_apps`، لكنه
 *   يعود بلا صلاحية إدارة أعمال؛ لا نُخمّن business_id هنا (يتطلب إجراء المالك).
 *
 * لا يُعاد أي سرّ (المعرّف/الاسم/company/app_domains فقط) ولا رمز تطبيق.
 * `oauth/start` يعمل اليوم (user/page tokens مخزّنة وموثّقة) فالتشخيص **لا يحجب**
 * ولا يغيّر أي سلوك قائم — قرار المشروع: لا حجب بلا إثبات.
 */
app.get("/api/platforms/facebook/business-link-diagnosis", requireOwner, async (_req,res)=>{
  const cfg=OAUTH_CONFIG["facebook"];
  const appId=String(cfg?.clientId||"");
  const appSecret=String(cfg?.clientSecret||"");
  const envNames=["FACEBOOK_OAUTH_CLIENT_ID","FACEBOOK_OAUTH_CLIENT_SECRET","FACEBOOK_APP_SECRET","FACEBOOK_VERIFY_TOKEN","FACEBOOK_LOGIN_CONFIG_ID","FACEBOOK_BUSINESS_ID","META_ALLOW_SCOPE_WITHOUT_CONFIG"];
  // إثبات صحة بيانات التطبيق (client_credentials) — نفس الإثبات المستخدم في oauth/start.
  const appToken=appId&&appSecret?await facebookClient().fetchAppAccessToken({clientId:appId,clientSecret:appSecret}):{kind:"unknown" as const,message:"معرّف التطبيق أو سرّه غير مضبوط في بيئة الخادم.",code:null};
  // قراءة عقدة التطبيق فعلياً (client_id|client_secret) — تُظهر الحقول المعلنة الحقيقية.
  const appNode=appId&&appSecret?await facebookClient().getAppNode({clientId:appId,clientSecret:appSecret}):{ok:false,data:null,error:"معرّف التطبيق أو سرّه غير مضبوط في بيئة الخادم."};
  const resolvedConfig=loginConfigInspection("facebook");
  const scopesResolved=facebookOAuthScopes();
  const scopeGaps=facebookScopeDependencyGaps();
  // أدوار المطوّر على التطبيق: تكشف **معرّف المستخدم الفعلي** المدرَج أدمن (السبب
  // المُرجَّح لتناقض «لا تملك التطبيق» عند استخدام ملف فيسبوك إضافي مختلف المعرّف).
  const appRoles=appId&&appSecret?await facebookClient().getAppRoles({clientId:appId,clientSecret:appSecret}):{ok:false as const,data:null,error:"غير مضبوط"};
  // رمز مستخدم المالك المخزّن (لا يُعاد) لإثبات هوية المستخدم الذي أكمل الربط.
  const userToken=facebookUserToken();
  // الحافظات التي يراها **هذا المستخدم** فعلاً عبر رمزه — يميّز أن الحافظة تحت مستخدم آخر.
  const userBusinesses=userToken?await facebookClient().listUserBusinesses(userToken):{ok:false as const,data:null,error:"لا رمز مستخدم مخزّن (لم يُكمل المالك ربط Facebook)."};
  // إثبات عكسي قراءة-فقط: هل يظهر تطبيقنا ضمن تطبيقات الحافظة (يتطلب معرّف الحافظة + رمز بصلاحية إدارة أعمال).
  const businessId=String(envSecret("FACEBOOK_BUSINESS_ID")||"").trim();
  const ownedApps=businessId&&userToken?await facebookClient().listBusinessOwnedApps({businessId,userAccessToken:userToken}):{ok:false as const,data:null,error:businessId?"لا رمز مستخدم مخزّن.":"معرّف الحافظة غير مضبوط (FACEBOOK_BUSINESS_ID) — اختياري للفحص العكسي."};
  res.json({
    success:true,
    platform:"facebook",
    // القيمة المعرّفة للمالك (المعرّف عام أصلاً في رابط التفويض) — بلا أي سرّ.
    appId:appId||null,
    appSecretConfigured:Boolean(appSecret),
    // إثبات صحة بيانات التطبيق من جهة Graph (لا من شاشة الحوار).
    appCredentials:{
      verdict:appToken.kind==="ok"?"valid":"invalid_or_unknown",
      kind:appToken.kind,
      message:appToken.message,
      providerCode:appToken.code,
    },
    // الحقول المعلنة الحقيقية من عقدة /{app-id} (id/name/company/app_domains).
    appNode:appNode.ok
      ?{ok:true,fields:appNode.data?.raw||null,name:appNode.data?.name||null}
      :{ok:false,error:appNode.error||null},
    /**
     * النتيجة القاطعة الموثّقة: عقدة /{app-id} **لا** تكشف ارتباط التطبيق
     * بحافظة أعمال — لا يوجد حقل `business`. الارتباط يُثبت فقط عكسياً عبر
     * `GET /{business_id}/owned_apps` (يتطلب جلسة إدارة أعمال للمالك).
     */
    businessLink:{
      businessFieldOnAppNode:false,
      detectableViaAppNode:false,
      companyFieldPresent:Boolean(appNode.ok&&appNode.data?.raw&&(appNode.data.raw as any).company),
      companyFieldNote:"`company` نصّي حرّ يكتبه المطوّر ولا يُثبت ارتباطاً بحافظة أعمال.",
      optionalCompanyProbe:{
        attempted:true,
        field:"company",
        present:Boolean(appNode.ok&&appNode.data?.raw&&(appNode.data.raw as any).company),
        value:appNode.ok&&appNode.data?.raw&&(appNode.data.raw as any).company?String((appNode.data.raw as any).company):null,
      },
      reverseRoute:{method:"GET",path:"/{business-id}/owned_apps",requiresOwnerBusinessSession:true},
      howToProveLink:"GET /{business-id}/owned_apps برمز مستخدم يملك إدارة الحافظة؛ يعود بالأسماء/المعرّفات للمالك، وفارغاً لو لم يكن التطبيق ضمنها (أو لو غابت صلاحية إدارة الأعمال). يتطلب جلسة المالك ولا ينفّذه أي وكيل.",
    },
    /**
     * أدوار المطوّر على التطبيق من Graph (لا من الواجهة). **معرّف المستخدم الفعلي**
     * المدرَج أدمن هو مفتاح التشخيص: إن اختلف عن معرّف المستخدم الذي يفتح لوحة
     * الأعمال فالمشكلة «هوية» (ملف فيسبوك إضافي/حساب آخر) لا «صلاحية».
     * ملاحظة موثّقة (Graph App/roles): العقدة لا تُدرج من يحمل الإدارة عبر الحافظة.
     */
    appRoles:appRoles.ok
      ?{ok:true,count:(appRoles.data||[]).length,roles:appRoles.data||[],adminUserIds:(appRoles.data||[]).filter((r:any)=>String(r.role)==="administrators").map((r:any)=>r.userId),note:"administrators هنا = من يحمل دور تطوير التطبيق (roles في developers.facebook.com). قد لا يشمل من يحمل الإدارة عبر الحافظة."}
      :{ok:false,error:(appRoles as any).error||null},
    /**
     * الحافظات التي يراها **الرمز الحالي** فعلاً (GET /me/businesses). يثبت أن
     * المستخدم الذي أكمل الربط عضو في الحافظة؛ وغياب الحافظة هنا يعني أن الحافظة
     * تحت مستخدم آخر (ملف إضافي). لا يُعاد أي رمز.
     */
    userBusinesses:userBusinesses.ok
      ?{ok:true,count:(userBusinesses.data||[]).length,businesses:userBusinesses.data||[],note:"الحافظات التي يراها الرمز الحالي عبر /me/businesses."}
      :{ok:false,error:(userBusinesses as any).error||null},
    /**
     * إثبات عكسي قراءة-فقط (لا ربط): هل يظهر تطبيقنا ضمن تطبيقات الحافظة؟
     * يتطلب FACEBOOK_BUSINESS_ID + رمز مستخدم بصلاحية business_management؛ وغيابه
     * يُعلن بصدق ولا يُخترع ارتباط.
     */
    businessOwnedApps:{
      businessIdConfigured:Boolean(businessId),
      attempted:Boolean(businessId&&userToken),
      ok:ownedApps.ok,
      ownedAppIds:ownedApps.ok?(ownedApps.data||[]):null,
      containsOurApp:ownedApps.ok?(ownedApps.data||[]).includes(appId):null,
      error:ownedApps.ok?null:((ownedApps as any).error||null),
      note:"قراءة فقط عبر GET /{business-id}/owned_apps — لا ينفّذ أي ربط. غياب معرّف الحافظة/الصلاحية يُعلن صراحةً.",
    },
    // الإجراء الخارجي الموثّق (لا ينفّذه أي وكيل): إضافة التطبيق كأصل أعمال في
    // حافظة المالك. وثيقة Meta: «Settings in Meta Business Suite → Apps under
    // Accounts → Add app»، و«app owned by your organisation» أصل أعمال؛ وبعد
    // الارتباط يظهر Facebook Login for Business → Configurations ويُمكن إنشاء
    // Configuration ID. بلا هذا الارتباط لا يوجد config_id لتطبيق Business.
    documentedOwnerAction:{
      where:"Meta Business Suite → Settings → Accounts → Apps",
      steps:[
        "سجّل الدخول إلى Meta Business Suite بحساب يملك إدارة حافظة «عباس الغرابي».",
        "Settings → Accounts → Apps → Add app → أضف تطبيق «معرض الغرابي -صفحات» (App ID المعلن أعلاه) كأصل أعمال في الحافظة.",
        "بعد إضافة التطبيق كأصل أعمال تظهر صفحة Facebook Login for Business → Configurations داخل لوحة التطبيق.",
        "أنشئ Configuration (نوع User access token) بالصلاحيات التي يعرضها /api/platforms/facebook/oauth/setup، وانسخ معرّفها إلى FACEBOOK_LOGIN_CONFIG_ID (أو INSTAGRAM_LOGIN_CONFIG_ID).",
      ],
      source:"https://www.facebook.com/business/help/2199735813629697 (Add an app to your business portfolio)",
      caveat:"الارتباط بحافظة وضغط هذه الخطوات يتطلبان جلسة المالك على Meta؛ لا ينفّذها أي وكيل برمجي. والتشخيص لا يحجب الربط الحالي لأنه يعمل فعلاً برموز موثّقة.",
      /**
       * المسار البرمجي الموثّق (Graph API) لربط تطبيق بحافظة — للتوثيق فقط،
       * **لا يُنفَّذ تلقائياً**. النقطتان الرسميتان المؤكَّدتان من وثيقة Meta:
       *  - POST /{business_id}/client_apps بمعامل `app_id` (Required) يضيف التطبيق
       *    كتطبيق عميل للحافظة (رد read-after-write: {access_status}).
       *  - POST /{business_id}/owned_apps يمتلك التطبيق للحافظة (بلا معاملات).
       * كلاهما يتطلب رمز مستخدم/System User بصلاحية business_management صادراً من
       * شخص يملك إدارة الحافظة. **ليس بديلاً عن واجهة Business Suite في حالة
       * «لا تملك التطبيق»** — لأن الرفض سببه هوية المستخدم لا غياب الصلاحية.
       */
      graphApiAlternatives:{
        addAsClientApp:{method:"POST",path:"/{business_id}/client_apps",param:"app_id",edgeDoc:"https://developers.facebook.com/docs/graph-api/reference/business/client_apps"},
        ownApp:{method:"POST",path:"/{business_id}/owned_apps",edgeDoc:"https://developers.facebook.com/docs/graph-api/reference/business/owned_apps"},
        requiredPermission:"business_management",
        tokenKind:"User Access Token (أو System User Token) من شخص يملك إدارة الحافظة",
        executesAutomatically:false,
        warning:"هذان المساران لا يتجاوزان تناقض «لا تملك التطبيق»: عدم التطابق هو الهوية لا الصلاحية. لا يُنفَّذان من الكود.",
      },
      /**
       * حسم تناقض الواجهة «لا تملك هذا التطبيق» رغم ظهور Administrator.
       * السبب المُرجَّح (يُثبته حقل appRoles.adminUserIds): المستخدم المدرَج أدمن
       * على التطبيق معرّفه ≠ المستخدم الذي يفتح لوحة الأعمال (Facebook Profiles /
       * ملف شخصي إضافي = معرّف مستخدم مختلف فعلاً).
       */
      youDontOwnThisApp:{
        likelyCause:"الملف الشخصي الإضافي على فيسبوك يحمل User ID مختلفاً؛ ودور Administrator على التطبيق مربوط بالمعرّف الأصلي لا بالملف الإضافي. فالمعرّف المُدرَج أدمن ليس هو من يفتح Business Suite حالياً.",
        howToConfirm:"قارن appRoles.adminUserIds أعلاه بمعرّف المستخدم الذي تفتح به business.facebook.com (من واجهة/أدوات معرّف المستخدم). اختلافهما يكشف عدم التطابق.",
        fixes:[
          "افتح developers.facebook.com/apps/"+ (appId||"{APP_ID}") +"/roles وخذ معرّف المستخدم الظاهر بجانب اسم «سيد زيد الغرابي»، ثم سجّل الدخول بالحساب/الملف الذي معرّفه يساوي هذا المعرّف بالضبط.",
          "من الأفضل استخدام «الحساب الأصلي» وليس «الملف الشخصي الإضافي» عند إدارة أدوات الأعمال والمطوّرين (المعروف أن بعض أدوات الأعمال لا تُدار بكامل الوظائف من ملف إضافي).",
          "Sync: قد يلزم تسجيل خروج/دخول كامل (لا تبديل ملف) في المتصفح، وإعادة المحاولة بعد دقائق لأن تزامن الأدوار قد يتأخر.",
          "إن تكرّر الرفض مع تطابق المعرّف: اضغط عبر Business Support Home → «Business Manager admin dispute / claim» مع وصف عدم التطابق، فبعض هذه الحالات عطل متزامن من Meta.",
        ],
        note:"هذا حد هوية/حساب على جهة Meta؛ لا يمكن لأي وكيل برمجي أن يتجاوزه لأنه يحتاج جلستك على Meta.",
      },
      twoFactorFix:{
        appliesTo:"رسالة «غير قادر على تعيين الأصول» أو فشل حفظ عام عند الإضافة",
        fix:"المشكلة المعروفة أن منصة الأعمال تطلب إكمال 2FA داخلية قبل السماح بتعيين الأصول، لكنها تُظهر رسالة الخطأ العامة نفسها بلا توجيه. أكمل 2FA (نافذة تأكيد الهوية/رمز SMS/TOTP) ثم أعد الإضافة.",
        caveat:"يُجرَّب فقط إن لم يكن السبب عدم تطابق الهوية أعلاه.",
      },
    },
    // حالة Configuration ID (مطلب Facebook Login for Business) — منطقي بلا أي قيمة.
    configuration:{
      envNames:loginConfigEnvNames("facebook"),
      configured:resolvedConfig.configured,
      valid:resolvedConfig.valid,
      used:Boolean(effectiveLoginConfigIdFor("facebook")),
      problems:resolvedConfig.problems.length?resolvedConfig.problems:undefined,
      permissionSource:effectiveLoginConfigIdFor("facebook")?"facebook_login_for_business_configuration":"oauth_scope_parameter",
    },
    // حالة بوابة الحجب عند رصد Business Login بلا config_id (الافتراضي: السماح).
    scopeWithoutConfigOverride:metaScopeWithoutConfigOverride(),
    // صلاحيات Facebook المحسومة باعتمادياتها — أسماء فقط (لا أسرار).
    scopes:{
      resolved:scopesResolved,
      count:scopesResolved.length,
      dependencyGaps:scopeGaps.length?scopeGaps:[],
      dependenciesResolved:scopeGaps.length===0,
    },
    // أسماء متغيّرات البيئة ذات الصلة (بلا أي قيمة).
    envNames,
    checkedAt:new Date().toISOString(),
    note:"تشخيص قراءة-فقط يثبت صحة بيانات التطبيق ويفحص ارتباط حافظة الأعمال من جهة Graph API. لا يُوجد حقل `business` على عقدة /{app-id} في وثيقة Meta الرسمية، فالارتباط يُثبت عكسياً عبر /{business-id}/owned_apps (يتطلب جلسة المالك). لا يُعاد أي سرّ ولا يُحجب أي سلوك قائم.",
  });
});

app.get("/api/platforms/facebook/webhook-info", requireOwner, async (_req,res)=>{
  const stored=getProviderToken("facebook");
  const pageId=stored?.pageId?String(stored.pageId):"";
  const pageToken=facebookPageToken(pageId||undefined);
  if(!pageId||!pageToken) return res.status(409).json({success:false,error:"لا صفحة Facebook موثقة؛ نفّذ الربط أولاً."});
  const subs=await facebookClient().getSubscribedApps(pageId,pageToken);
  if(!subs.ok) return res.status(502).json({success:false,error:subs.error||"تعذّر قراءة اشتراكات الصفحة."});
  res.json({
    success:true,provider:"facebook",
    pageId,pageName:stored?.pageName||null,
    webhookUrl:facebookWebhookUrl(),
    subscribedFields:FACEBOOK_SUBSCRIBED_FIELDS,
    appSubscribed:(subs.data||[]).length>0,
    subscribedAppCount:(subs.data||[]).length,
    signatureSecretConfigured:Boolean(facebookAppSecret()),
    verifyTokenConfigured:Boolean(facebookVerifyToken()),
    checkedAt:new Date().toISOString(),
    note:"حالة حقيقية من Meta بلا أي سرّ. لا يُعلن الاستقبال فعّالاً إلا باشتراك الصفحة الفعلي وتطابق رمز التحقق.",
  });
});

/** استقبال أحداث Facebook — تحقق HMAC على الجسم الخام ثم تمييز التعليق عن الرسالة. */
app.post("/api/platforms/facebook/webhook", requireRawBody, async (req,res)=>{
  const secret=facebookAppSecret();
  const rawBody=String((req as any).rawBody ?? "");
  const verifier=hmacSignatureVerifier(FACEBOOK_SIGNATURE_HEADER,"sha256");
  const verification=verifier.verify({headers:req.headers as Record<string,string|undefined>,rawBody,secret});
  if(!verification.ok){ logFacebookWebhook({kind:"unknown",outcome:"rejected"}); return res.status(401).json({success:false,error:verification.reason||"حدث غير موثوق."}); }
  if(!isValidWebhookPayload(req.body)) return res.status(400).json({success:false,error:"حمولة webhook غير صالحة."});
  const parsed=parseFacebookWebhook(req.body);
  if(!parsed.events.length){
    // أحداث مفهومة الشكل لكن غير مدعومة (تفاعلات/منشورات...) تُقبل وتُتجاهل
    // بلا خطأ، فلا يعيد Meta المحاولة، ولا تُخزَّن كتعليق أو رسالة.
    if(parsed.ignored.length) logFacebookWebhook({kind:"ignored",outcome:"ignored"});
    return res.status(200).json({success:true,accepted:true,ignored:parsed.ignored.length?parsed.ignored.map((x)=>x.reason):["no_supported_event"]});
  }
  if(!Array.isArray((workspace as any).facebookEventIds)) (workspace as any).facebookEventIds=[];
  const { accepted, duplicates } = await ingestWebhookComments({
    platform:"facebook", events:parsed.events, auditKind:"facebook_inbound_events",
    seenProviderEventIds:(workspace as any).facebookEventIds,
    appendProviderId:(ev)=>{ (workspace as any).facebookEventIds=[...(workspace as any).facebookEventIds,ev.externalId].slice(-20000); },
    onEvent:(ev,outcome)=>logFacebookWebhook({kind:ev.kind,externalId:ev.externalId,outcome}),
  });
  const persisted=!lastPersistError;
  res.status(200).json({success:true,accepted:true,processed:accepted.length,duplicates,persisted,acceptedKinds:parsed.events.filter((e)=>accepted.includes(e.externalId)).map((e)=>e.kind)});
});

/** يبني هدف الرد الحقيقي من الحالة الحالية (صفحة + تعليق/مستلم). */
function facebookReplyTarget(): { pageId: string; pageToken: string } | { error: string } {
  const stored=getProviderToken("facebook");
  const pageId=stored?.pageId?String(stored.pageId):"";
  const pageToken=facebookPageToken(pageId||undefined);
  if(!pageId||!pageToken) return {error:"لا صفحة Facebook موثقة؛ لا يمكن تنفيذ أي رد خارجي."};
  return {pageId,pageToken};
}

/**
 * الرد الحقيقي على تعليق Facebook — بعد الموافقة والتصنيف وحارس السلامة ومنع
 * التكرار. لا يُسجَّل delivered=true إلا بمعرّف تعليق ردّ من Meta.
 */
app.post("/api/platforms/facebook/reply", requireOwner, async (req,res)=>{
  const user=(req as any).user as {id:string};
  const externalId=typeof req.body?.externalId==="string"?req.body.externalId.trim():"";
  const text=typeof req.body?.text==="string"?req.body.text.trim():"";
  const commentText=typeof req.body?.commentText==="string"?req.body.commentText:"";
  if(!externalId) return res.status(400).json({success:false,error:"معرّف التعليق لدى Facebook مطلوب لمنع الرد المكرر."});
  if(!text) return res.status(400).json({success:false,error:"نص الرد مطلوب."});
  // REL-01: حجز ذرّي لمنع رد مكرر فعلي عند تزامن طلبين على نفس التعليق (نقرة
  // مزدوجة/إعادة محاولة) — طلب ثانٍ متزامن يُرفض فوراً بلا أي إرسال خارجي.
  const replyLock=replyLockKey("facebook","comment",externalId);
  if(!acquireReplyLock(replyLock)) return res.status(409).json({success:false,error:"طلب رد آخر على نفس التعليق قيد التنفيذ بالفعل؛ انتظر حتى يكتمل لمنع التكرار.",code:"REPLY_IN_PROGRESS"});
  try{
  const conn:any=platformConnections.get("facebook");
  if(!conn||conn.status!=="connected"||conn.providerVerified!==true){
    return res.status(409).json({success:false,error:"Facebook غير متصل باتصال موثق؛ لا يمكن إرسال أي رد خارجي."});
  }
  const comment=(workspace as any).socialComments.find((c:any)=>c.platform==="facebook"&&c.externalId===externalId);
  if(!comment) return res.status(404).json({success:false,error:"لا يوجد تعليق وارد بهذا المعرّف؛ لا إرسال بلا تعليق حقيقي."});

  // 1) حمايات التصنيف وself-authored.
  const classification=classifyComment(commentText||text);
  if(!canAutoReply(classification)) return res.status(422).json({success:false,error:classification.reviewReason||"هذا التعليق يستوجب مراجعة بشرية قبل أي رد.",classification,requiresHumanReview:true});
  const ownNames=[String(workspace.showroom?.name||""),"معرض الغرابي"];
  if(isSelfAuthored(comment.authorName,ownNames)) return res.status(409).json({success:false,error:"التعليق صادر من حساب المعرض؛ لا يُرد عليه لتجنب حلقة ردود."});

  // 2) حارس سلامة المحتوى قبل أي إرسال.
  const productId=typeof req.body?.productId==="string"?req.body.productId.trim():"";
  const productName=typeof req.body?.productName==="string"?req.body.productName.trim():"";
  const product=(workspace.products||[]).find((p:any)=>(productId&&p.id===productId)||(productName&&p.name===productName))||null;
  const replyFacts=buildFactsForProduct(product,Number(product?.downPaymentPercent||0),Number(product?.durationMonths||0));
  const safety=analyzeBusinessClaims(text,replyFacts);
  if(!safety.safe) return res.status(422).json({success:false,error:"نص الرد يحمل عرضاً تجارياً غير مسجّل، وتم إيقافه قبل أي إرسال.",contentSafety:{safe:false,violations:safety.blocked.map((v)=>v.detail),codes:safety.blocked.map((v)=>v.code)}});

  // 3) بوابة منع الرد المكرر (على معرّف التعليق الخارجي).
  const history:ReplyRecord[]=(workspace as any).socialReplies.filter((r:any)=>r.platform==="facebook").map((r:any)=>({externalId:r.externalId,replyFingerprint:r.replyFingerprint,repliedAt:r.repliedAt}));
  const decision=evaluateReplyGuard({externalId,replyText:text,history});
  if(!decision.allowed) return res.status(409).json({success:false,error:decision.reason,guard:decision});

  // 4) إرسال حقيقي على مسار التعليقات فقط (comment_reply).
  const target=facebookReplyTarget();
  if("error" in target) return res.status(503).json({success:false,error:target.error});
  const result=await facebookClient().replyToComment(String(comment.replyTarget?.commentId||externalId),target.pageToken,text);
  const record={
    id:workspaceId("reply"),platform:"facebook",externalId,text,kind:"comment",
    replyFingerprint:decision.fingerprint,classification,
    contentSafety:{safe:true,violations:[] as string[],codes:[] as string[]},
    repliedAt:new Date().toISOString(),createdBy:user.id,simulated:false,
    delivered:result.ok,providerReplyId:result.data?.providerCommentId||null,
    receipt:result.ok?{provider:"facebook",commentId:result.data?.providerCommentId,sentAt:new Date().toISOString()}:null,
    deliveryError:result.ok?null:(result.error||"فشل الرد على التعليق عبر Facebook."),
    reviewStatus:result.ok?"delivered":"failed",
    note:result.ok?"أُرسل الرد فعلياً عبر Facebook وثُبّت بمعرّف من Meta.":"فشل الإرسال عبر Facebook؛ لم يُسجَّل أي تسليم.",
  };
  if(!Array.isArray((workspace as any).socialReplies)) (workspace as any).socialReplies=[];
  (workspace as any).socialReplies.unshift(record);
  if((workspace as any).socialReplies.length>WORKSPACE_MAX_SOCIAL_REPLIES) (workspace as any).socialReplies.length=WORKSPACE_MAX_SOCIAL_REPLIES;
  audit(user.id,result.ok?"social_facebook_comment_reply_sent":"social_facebook_comment_reply_failed",`${externalId}:${result.ok?"delivered":"failed"}`);
  await persistStateDurable();
  if(!result.ok) return res.status(502).json({success:false,delivered:false,simulated:false,reply:record,error:record.deliveryError});
  res.json({success:true,delivered:true,simulated:false,providerReplyId:record.providerReplyId,reply:record});
  } finally { releaseReplyLock(replyLock); }
});

/**
 * الرد الحقيقي على رسالة Facebook Messenger — مسار منفصل تماماً عن تعليقات
 * comment_reply (قدرة message_reply). لا تسليم بلا معرّف رسالة من Meta.
 */
app.post("/api/platforms/facebook/message-reply", requireOwner, async (req,res)=>{
  const user=(req as any).user as {id:string};
  const externalId=typeof req.body?.externalId==="string"?req.body.externalId.trim():"";
  const recipientId=typeof req.body?.recipientId==="string"?req.body.recipientId.trim():"";
  const text=typeof req.body?.text==="string"?req.body.text.trim():"";
  const commentText=typeof req.body?.commentText==="string"?req.body.commentText:"";
  if(!text) return res.status(400).json({success:false,error:"نص الرد مطلوب."});
  // REL-01: حجز مبكر بمعرّف المستلم (بديل احتياطي للمعرّف الخارجي قبل تحديده
  // أدناه)، ثم إعادة الحجز بالمفتاح النهائي فوراً دون أي await بينهما.
  const earlyLock=replyLockKey("facebook","message",externalId||`fb-msg:${recipientId}`);
  if(!acquireReplyLock(earlyLock)) return res.status(409).json({success:false,error:"طلب رد آخر على نفس الرسالة قيد التنفيذ بالفعل؛ انتظر حتى يكتمل لمنع التكرار.",code:"REPLY_IN_PROGRESS"});
  try{
  const conn:any=platformConnections.get("facebook");
  if(!conn||conn.status!=="connected"||conn.providerVerified!==true){
    return res.status(409).json({success:false,error:"Facebook غير متصل باتصال موثق؛ لا يمكن إرسال أي رسالة خارجية."});
  }
  const comment=(workspace as any).socialComments.find((c:any)=>c.platform==="facebook"&&c.externalId===externalId&&c.kind==="message");
  const targetRecipient=recipientId||String(comment?.replyTarget?.recipientId||"");
  if(!comment&&!targetRecipient) return res.status(404).json({success:false,error:"لا توجد رسالة Facebook واردة بهذا المعرّف؛ لا إرسال بلا رسالة حقيقية."});
  const classification=classifyComment(commentText||text);
  if(!canAutoReply(classification)) return res.status(422).json({success:false,error:classification.reviewReason||"هذه الرسالة تستوجب مراجعة بشرية قبل أي رد.",classification,requiresHumanReview:true});

  const guardExternalId=externalId||`fb-msg:${targetRecipient}`;
  const history:ReplyRecord[]=(workspace as any).socialReplies.filter((r:any)=>r.platform==="facebook"&&r.kind==="message").map((r:any)=>({externalId:r.externalId,replyFingerprint:r.replyFingerprint,repliedAt:r.repliedAt}));
  const decision=evaluateReplyGuard({externalId:guardExternalId,replyText:text,history});
  if(!decision.allowed) return res.status(409).json({success:false,error:decision.reason,guard:decision});

  const target=facebookReplyTarget();
  if("error" in target) return res.status(503).json({success:false,error:target.error});
  const result=await facebookClient().sendMessage(target.pageId,target.pageToken,targetRecipient,text);
  const record={
    id:workspaceId("reply"),platform:"facebook",externalId:guardExternalId,text,kind:"message",
    replyFingerprint:decision.fingerprint,classification,
    contentSafety:{safe:true,violations:[] as string[],codes:[] as string[]},
    repliedAt:new Date().toISOString(),createdBy:user.id,simulated:false,
    delivered:result.ok,providerReplyId:result.data?.providerMessageId||null,
    receipt:result.ok?{provider:"facebook",messageId:result.data?.providerMessageId,recipientId:result.data?.recipientId,sentAt:new Date().toISOString()}:null,
    deliveryError:result.ok?null:(result.error||"فشل إرسال الرسالة عبر Facebook."),
    reviewStatus:result.ok?"delivered":"failed",
    note:result.ok?"أُرسلت الرسالة فعلياً عبر Facebook وثُبّتت بمعرّف من Meta.":"فشل الإرسال عبر Facebook؛ لم يُسجَّل أي تسليم.",
  };
  if(!Array.isArray((workspace as any).socialReplies)) (workspace as any).socialReplies=[];
  (workspace as any).socialReplies.unshift(record);
  if((workspace as any).socialReplies.length>WORKSPACE_MAX_SOCIAL_REPLIES) (workspace as any).socialReplies.length=WORKSPACE_MAX_SOCIAL_REPLIES;
  audit(user.id,result.ok?"social_facebook_message_reply_sent":"social_facebook_message_reply_failed",`${guardExternalId}:${result.ok?"delivered":"failed"}`);
  await persistStateDurable();
  if(!result.ok) return res.status(502).json({success:false,delivered:false,simulated:false,reply:record,error:record.deliveryError});
  res.json({success:true,delivered:true,simulated:false,providerReplyId:record.providerReplyId,reply:record});
  } finally { releaseReplyLock(earlyLock); }
});

// -------------------------------------------------------------
// Instagram — مسارات الموصل الحقيقي (Instagram API with Facebook Login).
// يُعاد استخدام تطبيق Meta نفسه ومسار OAuth نفسه (start/callback أعلاه).
// التحقق: HMAC-SHA256 على الجسم الخام (X-Hub-Signature-256). منع التكرار:
// معرّف الحدث الحقيقي من Instagram (comment id / mid) محفوظاً عبر المحوّل.
// لا يُقبل حدث بلا توقيع صحيح، ولا يُخزَّن مكرر، ولا يُعلن تسليم بلا معرّف مزود.
// -------------------------------------------------------------

/** ترشيح الصفحات التي لها حساب Instagram مهني مرتبط (لاختيار الحساب يدوياً). */
app.get("/api/platforms/instagram/accounts", requireOwner, async (_req,res)=>{
  const stored=getProviderToken("instagram");
  const userToken=stored?.userAccessToken?String(stored.userAccessToken):"";
  if(!userToken) return res.status(409).json({success:false,error:"لا رمز مستخدم Meta محفوظ؛ نفّذ الربط عبر OAuth أولاً."});
  const pages=await instagramClient().listLinkedInstagramAccounts(userToken);
  if(!pages.ok) return res.status(502).json({success:false,error:pages.error||"تعذّر جلب حسابات Instagram."});
  // لا يُعاد أي رمز للواجهة؛ معرّفات وأسماء فقط، والحسابات بلا Instagram مهني مُستبعدة.
  const accounts=(pages.data||[]).filter((p)=>p.igAccountId).map((p)=>({pageId:p.pageId,pageName:p.pageName,igAccountId:p.igAccountId,igUsername:p.igUsername}));
  res.json({success:true,accounts,note:"معرّفات وأسماء فقط بلا أي رمز وصول. تُعرض الحسابات المهنية المرتبطة بصفحات فقط."});
});

/** اختيار حساب Instagram محدّد لإتمام الربط (يثبته ويشترك في webhook فعلياً). */
app.post("/api/platforms/instagram/select-account", requireOwner, async (req,res)=>{
  const pageId=typeof req.body?.pageId==="string"?req.body.pageId.trim():"";
  if(!pageId) return res.status(400).json({success:false,error:"معرّف الصفحة المرتبطة بالحساب مطلوب."});
  const stored=getProviderToken("instagram");
  const userToken=stored?.userAccessToken?String(stored.userAccessToken):"";
  if(!userToken) return res.status(409).json({success:false,error:"لا رمز مستخدم Meta محفوظ؛ نفّذ الربط عبر OAuth أولاً."});
  const result=await instagramFinalizeAccountSelection(pageId,userToken);
  if(!result.ok) return res.status(502).json({success:false,error:result.error||"تعذّر ربط حساب Instagram المختار."});
  await persistStateDurable();
  audit((req as any).user.id,"instagram_account_selected",String(result.igAccountId||pageId));
  res.json({success:true,connection:safeConnection("instagram"),igUsername:result.igUsername||null,webhookSubscribed:result.subscribed===true,subscribedFields:result.subscribedFields||null});
});

/** إثبات اشتراك الصفحة الفعلي في webhook (مقابل subscribed_apps). */
app.get("/api/platforms/instagram/webhook-info", requireOwner, async (_req,res)=>{
  const stored=getProviderToken("instagram");
  const pageId=stored?.pageId?String(stored.pageId):"";
  const pageToken=instagramPageToken();
  if(!pageId||!pageToken) return res.status(409).json({success:false,error:"لا حساب Instagram موثق؛ نفّذ الربط أولاً."});
  const subs=await instagramClient().getSubscribedFields(pageId,pageToken);
  if(!subs.ok) return res.status(502).json({success:false,error:subs.error||"تعذّر قراءة اشتراكات الصفحة."});
  res.json({
    success:true,provider:"instagram",
    pageId,pageName:stored?.pageName||null,
    igAccountId:stored?.igAccountId||null,igUsername:stored?.igUsername||null,
    webhookUrl:instagramWebhookUrl(),
    subscribedFields:INSTAGRAM_SUBSCRIBED_FIELDS,
    appSubscribed:(subs.data||[]).length>0,
    subscribedFieldsReported:subs.data||[],
    signatureSecretConfigured:Boolean(instagramAppSecret()),
    verifyTokenConfigured:Boolean(instagramVerifyToken()),
    checkedAt:new Date().toISOString(),
    // حد Meta الصريح: حقول Instagram (comments/messages) تُفعَّل من Meta App Dashboard
    // فقط، ولا يمكن ضبطها عبر subscribed_apps لصفحة Facebook. نُثبت ما نستطيع
    // (اشتراك الصفحة) ونعلن ما يلزم من اللوحة، فلا ندّعي «Verified» بلا اختبار فعلي.
    instagramFieldsDashboardOnly:true,
    dashboardWebhookFields:[...INSTAGRAM_SUBSCRIBED_FIELDS],
    webhookFullyVerified:Boolean((subs.data||[]).length>0 && instagramAppSecret() && instagramVerifyToken()),
    note:"حالة حقيقية من Meta بلا أي سرّ. اشتراك الصفحة نُثبته من Graph؛ أما حقول كائن instagram (comments/messages) فتُفعَّل من Meta App Dashboard، ولا يُعتبر الاستقبال موثّقاً بالكامل قبل وصول حدث حقيقي بتوقيع صحيح.",
  });
});

/** استقبال أحداث Instagram — تحقق HMAC على الجسم الخام ثم تمييز التعليق عن الرسالة. */
app.post("/api/platforms/instagram/webhook", requireRawBody, async (req,res)=>{
  const secret=instagramAppSecret();
  const rawBody=String((req as any).rawBody ?? "");
  const verifier=hmacSignatureVerifier(INSTAGRAM_SIGNATURE_HEADER,"sha256");
  const verification=verifier.verify({headers:req.headers as Record<string,string|undefined>,rawBody,secret});
  if(!verification.ok){ logInstagramWebhook({kind:"unknown",outcome:"rejected"}); return res.status(401).json({success:false,error:verification.reason||"حدث غير موثوق."}); }
  if(!isValidWebhookPayload(req.body)) return res.status(400).json({success:false,error:"حمولة webhook غير صالحة."});
  const parsed=parseInstagramWebhook(req.body);
  if(!parsed.events.length){
    // أحداث مفهومة الشكل لكن غير مدعومة (تفاعلات/إشارات...) تُقبل وتُتجاهل بلا خطأ.
    if(parsed.ignored.length) logInstagramWebhook({kind:"ignored",outcome:"ignored"});
    return res.status(200).json({success:true,accepted:true,ignored:parsed.ignored.length?parsed.ignored.map((x)=>x.reason):["no_supported_event"]});
  }
  if(!Array.isArray((workspace as any).instagramEventIds)) (workspace as any).instagramEventIds=[];
  const { accepted, duplicates } = await ingestWebhookComments({
    platform:"instagram", events:parsed.events, auditKind:"instagram_inbound_events",
    seenProviderEventIds:(workspace as any).instagramEventIds,
    appendProviderId:(ev)=>{ (workspace as any).instagramEventIds=[...(workspace as any).instagramEventIds,ev.externalId].slice(-20000); },
    onEvent:(ev,outcome)=>logInstagramWebhook({kind:ev.kind,externalId:ev.externalId,outcome}),
  });
  const persisted=!lastPersistError;
  res.status(200).json({success:true,accepted:true,processed:accepted.length,duplicates,persisted,acceptedKinds:parsed.events.filter((e)=>accepted.includes(e.externalId)).map((e)=>e.kind)});
});

/** يبني هدف الرد الحقيقي من الحالة الحالية (صفحة + رمز). */
function instagramReplyTarget(): { pageId: string; pageToken: string; igAccountId: string } | { error: string } {
  const pageId=instagramPageId();
  const pageToken=instagramPageToken();
  const igAccountId=instagramAccountId();
  if(!pageId||!pageToken||!igAccountId) return {error:"لا حساب Instagram موثق؛ لا يمكن تنفيذ أي رد خارجي."};
  return {pageId,pageToken,igAccountId};
}

/**
 * الرد الحقيقي على تعليق Instagram — بعد التصنيف وحارس السلامة ومنع التكرار.
 * لا يُسجَّل delivered=true إلا بمعرّف تعليق ردّ من Meta.
 */
app.post("/api/platforms/instagram/reply", requireOwner, async (req,res)=>{
  const user=(req as any).user as {id:string};
  const externalId=typeof req.body?.externalId==="string"?req.body.externalId.trim():"";
  const text=typeof req.body?.text==="string"?req.body.text.trim():"";
  const commentText=typeof req.body?.commentText==="string"?req.body.commentText:"";
  if(!externalId) return res.status(400).json({success:false,error:"معرّف التعليق لدى Instagram مطلوب لمنع الرد المكرر."});
  if(!text) return res.status(400).json({success:false,error:"نص الرد مطلوب."});
  // REL-01: حجز ذرّي لمنع رد مكرر فعلي عند تزامن طلبين على نفس التعليق.
  const replyLock=replyLockKey("instagram","comment",externalId);
  if(!acquireReplyLock(replyLock)) return res.status(409).json({success:false,error:"طلب رد آخر على نفس التعليق قيد التنفيذ بالفعل؛ انتظر حتى يكتمل لمنع التكرار.",code:"REPLY_IN_PROGRESS"});
  try{
  const conn:any=platformConnections.get("instagram");
  if(!conn||conn.status!=="connected"||conn.providerVerified!==true){
    return res.status(409).json({success:false,error:"Instagram غير متصل باتصال موثق؛ لا يمكن إرسال أي رد خارجي."});
  }
  const comment=(workspace as any).socialComments.find((c:any)=>c.platform==="instagram"&&c.externalId===externalId);
  if(!comment) return res.status(404).json({success:false,error:"لا يوجد تعليق وارد بهذا المعرّف؛ لا إرسال بلا تعليق حقيقي."});

  const classification=classifyComment(commentText||text);
  if(!canAutoReply(classification)) return res.status(422).json({success:false,error:classification.reviewReason||"هذا التعليق يستوجب مراجعة بشرية قبل أي رد.",classification,requiresHumanReview:true});
  const ownNames=[String(workspace.showroom?.name||""),"معرض الغرابي"];
  if(isSelfAuthored(comment.authorName,ownNames)) return res.status(409).json({success:false,error:"التعليق صادر من حساب المعرض؛ لا يُرد عليه لتجنب حلقة ردود."});

  const productId=typeof req.body?.productId==="string"?req.body.productId.trim():"";
  const productName=typeof req.body?.productName==="string"?req.body.productName.trim():"";
  const product=(workspace.products||[]).find((p:any)=>(productId&&p.id===productId)||(productName&&p.name===productName))||null;
  const replyFacts=buildFactsForProduct(product,Number(product?.downPaymentPercent||0),Number(product?.durationMonths||0));
  const safety=analyzeBusinessClaims(text,replyFacts);
  if(!safety.safe) return res.status(422).json({success:false,error:"نص الرد يحمل عرضاً تجارياً غير مسجّل، وتم إيقافه قبل أي إرسال.",contentSafety:{safe:false,violations:safety.blocked.map((v)=>v.detail),codes:safety.blocked.map((v)=>v.code)}});

  const history:ReplyRecord[]=(workspace as any).socialReplies.filter((r:any)=>r.platform==="instagram").map((r:any)=>({externalId:r.externalId,replyFingerprint:r.replyFingerprint,repliedAt:r.repliedAt}));
  const decision=evaluateReplyGuard({externalId,replyText:text,history});
  if(!decision.allowed) return res.status(409).json({success:false,error:decision.reason,guard:decision});

  const target=instagramReplyTarget();
  if("error" in target) return res.status(503).json({success:false,error:target.error});
  const result=await instagramClient().replyToComment(String(comment.replyTarget?.commentId||externalId),target.pageToken,text);
  const record={
    id:workspaceId("reply"),platform:"instagram",externalId,text,kind:"comment",
    replyFingerprint:decision.fingerprint,classification,
    contentSafety:{safe:true,violations:[] as string[],codes:[] as string[]},
    repliedAt:new Date().toISOString(),createdBy:user.id,simulated:false,
    delivered:result.ok,providerReplyId:result.data?.providerCommentId||null,
    receipt:result.ok?{provider:"instagram",commentId:result.data?.providerCommentId,sentAt:new Date().toISOString()}:null,
    deliveryError:result.ok?null:(result.error||"فشل الرد على التعليق عبر Instagram."),
    reviewStatus:result.ok?"delivered":"failed",
    note:result.ok?"أُرسل الرد فعلياً عبر Instagram وثُبّت بمعرّف من Meta.":"فشل الإرسال عبر Instagram؛ لم يُسجَّل أي تسليم.",
  };
  if(!Array.isArray((workspace as any).socialReplies)) (workspace as any).socialReplies=[];
  (workspace as any).socialReplies.unshift(record);
  if((workspace as any).socialReplies.length>WORKSPACE_MAX_SOCIAL_REPLIES) (workspace as any).socialReplies.length=WORKSPACE_MAX_SOCIAL_REPLIES;
  audit(user.id,result.ok?"social_instagram_comment_reply_sent":"social_instagram_comment_reply_failed",`${externalId}:${result.ok?"delivered":"failed"}`);
  await persistStateDurable();
  if(!result.ok) return res.status(502).json({success:false,delivered:false,simulated:false,reply:record,error:record.deliveryError});
  res.json({success:true,delivered:true,simulated:false,providerReplyId:record.providerReplyId,reply:record});
  } finally { releaseReplyLock(replyLock); }
});

/**
 * الرد الحقيقي على رسالة Instagram المباشرة — مسار منفصل عن comment_reply
 * (قدرة message_reply). لا تسليم بلا معرّف رسالة من Meta.
 */
app.post("/api/platforms/instagram/message-reply", requireOwner, async (req,res)=>{
  const user=(req as any).user as {id:string};
  const externalId=typeof req.body?.externalId==="string"?req.body.externalId.trim():"";
  const recipientId=typeof req.body?.recipientId==="string"?req.body.recipientId.trim():"";
  const text=typeof req.body?.text==="string"?req.body.text.trim():"";
  const commentText=typeof req.body?.commentText==="string"?req.body.commentText:"";
  if(!text) return res.status(400).json({success:false,error:"نص الرد مطلوب."});
  // REL-01: حجز مبكر لمنع رد مكرر فعلي عند تزامن طلبين (نقرة مزدوجة/إعادة محاولة).
  const earlyLock=replyLockKey("instagram","message",externalId||`ig-msg:${recipientId}`);
  if(!acquireReplyLock(earlyLock)) return res.status(409).json({success:false,error:"طلب رد آخر على نفس الرسالة قيد التنفيذ بالفعل؛ انتظر حتى يكتمل لمنع التكرار.",code:"REPLY_IN_PROGRESS"});
  try{
  const conn:any=platformConnections.get("instagram");
  if(!conn||conn.status!=="connected"||conn.providerVerified!==true){
    return res.status(409).json({success:false,error:"Instagram غير متصل باتصال موثق؛ لا يمكن إرسال أي رسالة خارجية."});
  }
  const comment=(workspace as any).socialComments.find((c:any)=>c.platform==="instagram"&&c.externalId===externalId&&c.kind==="message");
  const targetRecipient=recipientId||String(comment?.replyTarget?.recipientId||"");
  if(!comment&&!targetRecipient) return res.status(404).json({success:false,error:"لا توجد رسالة Instagram واردة بهذا المعرّف؛ لا إرسال بلا رسالة حقيقية."});
  const classification=classifyComment(commentText||text);
  if(!canAutoReply(classification)) return res.status(422).json({success:false,error:classification.reviewReason||"هذه الرسالة تستوجب مراجعة بشرية قبل أي رد.",classification,requiresHumanReview:true});

  const guardExternalId=externalId||`ig-msg:${targetRecipient}`;
  const history:ReplyRecord[]=(workspace as any).socialReplies.filter((r:any)=>r.platform==="instagram"&&r.kind==="message").map((r:any)=>({externalId:r.externalId,replyFingerprint:r.replyFingerprint,repliedAt:r.repliedAt}));
  const decision=evaluateReplyGuard({externalId:guardExternalId,replyText:text,history});
  if(!decision.allowed) return res.status(409).json({success:false,error:decision.reason,guard:decision});

  const target=instagramReplyTarget();
  if("error" in target) return res.status(503).json({success:false,error:target.error});
  const result=await instagramClient().sendMessage(target.pageId,target.pageToken,targetRecipient,text);
  const record={
    id:workspaceId("reply"),platform:"instagram",externalId:guardExternalId,text,kind:"message",
    replyFingerprint:decision.fingerprint,classification,
    contentSafety:{safe:true,violations:[] as string[],codes:[] as string[]},
    repliedAt:new Date().toISOString(),createdBy:user.id,simulated:false,
    delivered:result.ok,providerReplyId:result.data?.providerMessageId||null,
    receipt:result.ok?{provider:"instagram",messageId:result.data?.providerMessageId,recipientId:result.data?.recipientId,sentAt:new Date().toISOString()}:null,
    deliveryError:result.ok?null:(result.error||"فشل إرسال الرسالة عبر Instagram."),
    reviewStatus:result.ok?"delivered":"failed",
    note:result.ok?"أُرسلت الرسالة فعلياً عبر Instagram وثُبّتت بمعرّف من Meta.":"فشل الإرسال عبر Instagram؛ لم يُسجَّل أي تسليم.",
  };
  if(!Array.isArray((workspace as any).socialReplies)) (workspace as any).socialReplies=[];
  (workspace as any).socialReplies.unshift(record);
  if((workspace as any).socialReplies.length>WORKSPACE_MAX_SOCIAL_REPLIES) (workspace as any).socialReplies.length=WORKSPACE_MAX_SOCIAL_REPLIES;
  audit(user.id,result.ok?"social_instagram_message_reply_sent":"social_instagram_message_reply_failed",`${guardExternalId}:${result.ok?"delivered":"failed"}`);
  await persistStateDurable();
  if(!result.ok) return res.status(502).json({success:false,delivered:false,simulated:false,reply:record,error:record.deliveryError});
  res.json({success:true,delivered:true,simulated:false,providerReplyId:record.providerReplyId,reply:record});
  } finally { releaseReplyLock(earlyLock); }
});

// -------------------------------------------------------------
// Unified webhook foundation (Batch 6) — مسار واحد لكل المنصات.
// الخطوات: تحقق المصدر (HMAC/سرّ) → منع replay → منع تكرار → تطبيع → حفظ → تصنيف.
// Telegram له مساره الخاص (ترويسة سرّية). هنا المنصات الموقّعة بـHMAC (Meta/Threads/WhatsApp).
// لا يُقبل حدث بلا توقيع صحيح، ولا يُخزَّن مكرر.
// -------------------------------------------------------------

/** سرّ التوقيع لكل منصة (بيئة الخادم فقط؛ لا يُسجَّل ولا يُعاد). */
function webhookSecretFor(platform: string): string {
  if (platform === "facebook") return (process.env.FACEBOOK_APP_SECRET || "").trim();
  if (platform === "instagram") return (process.env.INSTAGRAM_APP_SECRET || process.env.FACEBOOK_APP_SECRET || "").trim();
  if (platform === "threads") return (process.env.THREADS_APP_SECRET || "").trim();
  if (platform === "whatsapp") return (process.env.WHATSAPP_APP_SECRET || "").trim();
  // TikTok: سرّ التوقيع هو client_secret نفسه (نمط TikTok-Signature على timestamp.rawBody).
  if (platform === "tiktok") return tiktokSigningSecret();
  return "";
}

/** رمز تحقق الاشتراك (GET challenge) لكل منصة — يُقارن بزمن ثابت. */
function webhookVerifyTokenFor(platform: string): string {
  if (platform === "facebook") return (process.env.FACEBOOK_VERIFY_TOKEN || "").trim();
  if (platform === "instagram") return (process.env.INSTAGRAM_VERIFY_TOKEN || process.env.FACEBOOK_VERIFY_TOKEN || "").trim();
  if (platform === "threads") return (process.env.THREADS_VERIFY_TOKEN || "").trim();
  if (platform === "whatsapp") return (process.env.WHATSAPP_VERIFY_TOKEN || "").trim();
  return "";
}

/** مُتحقّق التوقيع لكل منصة (Meta Graph يستخدم sha256 على X-Hub-Signature-256). */
function webhookVerifierFor(platform: string): WebhookVerifier | null {
  if (["facebook", "instagram", "threads", "whatsapp"].includes(platform)) {
    return hmacSignatureVerifier("x-hub-signature-256", "sha256");
  }
  return null;
}

/**
 * تطبيع حمولة Meta إلى حدث موحّد. تُغطّى تعليقات الصفحة والرسائل الخاصة:
 * - feed changes: entry[].changes[].value (comment/feed).
 * - messaging: entry[].messaging[].message نصية.
 * أي شكل غير معروف يُعاد [] (يُقبل ويُتجاهل بلا خطأ، فلا يعيد المزود المحاولة).
 */
function normalizeMetaEvents(platform: PlatformId, payload: any): NormalizedSocialEvent[] {
  const events: NormalizedSocialEvent[] = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const pageId = entry?.id ? String(entry.id) : null;
    // 1) تعليقات/تغييرات الصفحة.
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const v = change?.value || {};
      const text = String(v.message ?? v.text ?? "").trim();
      const externalId = v.comment_id ?? v.post_id ?? v.id;
      if (!text || externalId === undefined || externalId === null) continue;
      events.push(buildNormalizedEvent({
        platform,
        kind: "comment",
        externalId: String(externalId),
        parentExternalId: v.post_id ? String(v.post_id) : null,
        authorName: v.from?.name ?? null,
        text,
        createdAt: v.created_time ? new Date(Number(v.created_time) * 1000).toISOString() : undefined,
        // الرد على تعليق الصفحة يتم بمعرّف التعليق نفسه عبر Graph API.
        replyTarget: { commentId: String(externalId), pageId },
        raw: { source: "changes", item: change?.field ?? null },
      }));
    }
    // 2) الرسائل الخاصة (Messenger/Instagram DM).
    for (const m of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const text = String(m?.message?.text ?? "").trim();
      const externalId = m?.message?.mid;
      if (!text || !externalId) continue;
      const senderId = m?.sender?.id ? String(m.sender.id) : null;
      events.push(buildNormalizedEvent({
        platform,
        kind: "message",
        externalId: String(externalId),
        parentExternalId: senderId,
        authorName: null,
        text,
        createdAt: m?.timestamp ? new Date(Number(m.timestamp)).toISOString() : undefined,
        replyTarget: { recipientId: senderId, pageId },
        raw: { source: "messaging" },
      }));
    }
    // 3) WhatsApp Cloud API: entry[].changes[].value.messages[].
    for (const msg of Array.isArray(entry?.changes) ? entry.changes.flatMap((c: any) => c?.value?.messages || []) : []) {
      const text = String(msg?.text?.body ?? "").trim();
      const externalId = msg?.id;
      if (!text || !externalId) continue;
      const from = msg?.from ? String(msg.from) : null;
      events.push(buildNormalizedEvent({
        platform,
        kind: "message",
        externalId: String(externalId),
        parentExternalId: from,
        authorName: from,
        text,
        createdAt: msg?.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : undefined,
        replyTarget: { recipientId: from },
        raw: { source: "whatsapp_messages" },
      }));
    }
  }
  return events;
}

// -------------------------------------------------------------
// TikTok — مسارات الموصل الحقيقي (OAuth 2.0 + Content Posting API + Display API).
// التوقيع: TikTok-Signature (HMAC-SHA256 على `timestamp.rawBody`) بمفتاح client_secret.
// منع التكرار: معرّف الحدث (اسم+حساب+وقت+معرّف داخلي) محفوظ عبر المحوّل.
// لا يُقبل حدث بلا توقيع صحيح، ولا يُخزَّن مكرر، ولا يُعلن نشر بلا معرّف من TikTok.
// التعليقات والرسائل المباشرة غير متاحة عبر الواجهة العامة → لا مسارات لها إطلاقاً.
// -------------------------------------------------------------

/** حالة اتصال TikTok الحقيقية + قدراتها المنفّذة (بلا أي سرّ). */
app.get("/api/platforms/tiktok/status", authenticateToken, async (req,res)=>{
  const stored=tiktokStoredCredentials();
  const conn:any=platformConnections.get("tiktok");
  const verified=Boolean(conn?.status==="connected"&&conn?.providerVerified===true&&stored?.openId);
  // الحالة الصادقة الموحّدة (مصدرها الواحد tiktokState.ts): مفردة واحدة دقيقة
  // بترتيب أسبقية صريح، مع السبب والإجراء التالي — بلا ادعاء اتصال/تشغيل.
  const truthful=tiktokTruthfulState();
  res.json({
    success:true,
    platform:"tiktok",
    state: truthful.state,
    stateLabelAr: truthful.labelAr,
    stateTone: truthful.tone,
    stateReason: truthful.reason,
    nextAction: truthful.nextAction,
    connected: conn?.status==="connected",
    providerVerified: verified,
    accountId: stored?.openId||null,
    accountName: stored?.displayName||null,
    // كلها منطقية بلا أي قيمة سرّية.
    clientKeyConfigured: Boolean(tiktokOAuthConfig()?.clientId),
    clientSecretConfigured: Boolean(tiktokOAuthConfig()?.clientSecret),
    redirectUri: oauthCallbackUrl("tiktok"),
    requestedScopes: tiktokOAuthScopes(),
    oauthStateDurable: storageStatus().durable,
    tokenStored: Boolean(stored?.accessToken),
    refreshTokenStored: Boolean(stored?.refreshToken),
    tokenExpiryKnown: stored?.expiresAt != null,
    tokenExpired: Boolean(stored?.accessToken) && tiktokAccessExpired(),
    refreshExpiresAtKnown: stored?.refreshExpiresAt != null,
    accountDiscovered: Boolean(stored?.openId),
    accountVerified: verified,
    webhookUrl: tiktokWebhookUrl(),
    webhookEvents: [...TIKTOK_WEBHOOK_EVENTS],
    postingCapability: tiktokCapabilityStatus("video_publishing"),
    directPostCapability: tiktokCapabilityStatus("content_posting_direct"),
    draftUploadCapability: tiktokCapabilityStatus("content_posting_draft"),
    photoPublishingCapability: tiktokCapabilityStatus("photo_publishing"),
    analyticsCapability: tiktokCapabilityStatus("analytics"),
    webhookCapability: tiktokCapabilityStatus("webhooks"),
    commentsCapability: tiktokCapabilityStatus("comments_read"),
    directMessagesCapability: tiktokCapabilityStatus("direct_messages_read"),
    appReviewRequired: tiktokAuditRequired(),
    capabilityMatrix: TIKTOK_CAPABILITY_MATRIX,
    // مفردات الحالات الصادقة (مصدرها الواحد) ليعرضها مركز الربط بلا تخمين.
    truthfulStates: [...TIKTOK_TRUTHFUL_STATES],
    truthfulStateLabels: TIKTOK_STATE_LABELS_AR,
    truthfulStateTones: TIKTOK_STATE_TONES,
    checkedAt:new Date().toISOString(),
    note:"حالة حقيقية من TikTok بلا أي سرّ. لا يُعلن الاتصال موثقاً إلا بمعرّف open_id من TikTok.",
  });
});

/**
 * تشخيص مفتاح تطبيق TikTok (للمالك): يُقارن مفتاح البيئة الفعلي بما يظهر في رابط
 * التفويض، ويُثبته لدى TikTok بطلب عميل واحد — فيُعزل سبب رسالة
 * «We couldn't log in with TikTok … correct the following: client_key» إلى:
 *   - مفتاح غير مضبوط/فارغ،
 *   - مفتاح بصيغة مرفوضة،
 *   - مفتاح لا يتعرّف عليه TikTok (أو مفتاح Sandbox مقابل Production)،
 *   - مفتاح مقبول (الحكم من مزود TikTok لا من التخمين).
 * الـclient_key عام فلا يُسرّب شيئاً، ومع ذلك يُعرض مُخفىً (أول 4 وآخر 4) مع بصمة.
 */
app.get("/api/platforms/tiktok/client-key-diagnosis", requireOwner, async (req,res)=>{
  const diagnosis = await tiktokClientKeyDiagnosis();
  logOAuthStart("tiktok", { outcome: "client_key_diagnosis", verdict: diagnosis.verdict, providerKind: diagnosis.providerProof?.kind ?? null, clientKeyLen: diagnosis.configuredValueLength, sha256: diagnosis.configuredValueSha256Prefix });
  res.json({ success: true, platform: "tiktok", diagnosis, checkedAt: new Date().toISOString() });
});

/**
 * استقبال أحداث TikTok — تحقق TikTok-Signature على الجسم الخام ثم حفظ دائم قبل الإقرار.
 * الأحداث الرسمية الثلاثة فقط مدعومة؛ أي حدث آخر يُقبل ويُتجاهل بلا خطأ.
 */
app.post("/api/platforms/tiktok/webhook", requireRawBody, async (req,res)=>{
  const secret=tiktokSigningSecret();
  const rawBody=String((req as any).rawBody??"");
  const header=req.headers[TIKTOK_SIGNATURE_HEADER]??req.headers[TIKTOK_SIGNATURE_HEADER.toLowerCase()];
  const verification=verifyTikTokSignature({header:typeof header==="string"?header:Array.isArray(header)?header[0]:null,rawBody,clientSecret:secret});
  if(!verification.ok){ logTikTokWebhook({event:"unknown",outcome:"rejected"}); return res.status(401).json({success:false,error:verification.reason||"حدث غير موثوق."}); }
  if(!isValidWebhookPayload(req.body)) return res.status(400).json({success:false,error:"حمولة webhook غير صالحة."});
  const parsed=parseTikTokWebhook(req.body);
  if(!parsed.event) return res.status(200).json({success:true,accepted:true,ignored:parsed.reason||"no_supported_event"});
  const ev=parsed.event;
  if(!ev.supported){ logTikTokWebhook({event:ev.event,outcome:"ignored"}); return res.status(200).json({success:true,accepted:true,ignored:"unsupported_event",event:ev.event}); }
  if(!Array.isArray((workspace as any).tiktokEventIds)) (workspace as any).tiktokEventIds=[];
  if(!Array.isArray((workspace as any).providerEvents)) (workspace as any).providerEvents=[];
  if(isReplayOrDuplicate({providerEventId:ev.externalId,externalId:ev.externalId,seenProviderEventIds:(workspace as any).tiktokEventIds,seenExternalIds:[]})){
    logTikTokWebhook({event:ev.event,externalId:ev.externalId,outcome:"duplicate"});
    return res.status(200).json({success:true,accepted:true,duplicate:true});
  }
  (workspace as any).tiktokEventIds=[...(workspace as any).tiktokEventIds,ev.externalId].slice(-20000);
  (workspace as any).providerEvents.unshift({id:workspaceId("event"),platform:"tiktok",type:ev.event,externalId:ev.externalId,userOpenId:ev.userOpenId,content:ev.content,receivedAt:new Date().toISOString()});
  (workspace as any).providerEvents=(workspace as any).providerEvents.slice(0,WORKSPACE_MAX_PROVIDER_EVENTS);
  // حدث إلغاء التفويض يُعلن الحاجة لإعادة الربط فوراً (لا ادعاء اتصال قائم).
  if(ev.event==="authorization.removed"&&ev.userOpenId&&ev.userOpenId===tiktokOpenId()){
    platformConnections.set("tiktok",{platform:"tiktok",status:"reauth_needed",accountId:ev.userOpenId,connectedAt:new Date().toISOString()});
    savePlatformConnections();
  }
  // ننتظر الكتابة الدائمة قبل الإقرار: تضمن ثبات الحدث ومعرّف منع التكرار.
  await persistStateDurable();
  const persisted=!lastPersistError;
  logTikTokWebhook({event:ev.event,externalId:ev.externalId,outcome:"accepted",persisted});
  audit("system","tiktok_inbound_event",ev.event);
  res.status(200).json({success:true,accepted:true,event:ev.event,persisted});
});

/**
 * استعلام حالة نشر TikTok بمفتاح publish_id — للمالك فقط.
 * لا يُعلن تسليم إلا بحالة PUBLISH_COMPLETE من TikTok، ويُحدَّث سجل النشر.
 */
app.get("/api/platforms/tiktok/publish-status", requireOwner, async (req,res)=>{
  const publishId=typeof req.query.publishId==="string"?req.query.publishId.trim():"";
  if(!publishId) return res.status(400).json({success:false,error:"publishId مطلوب.",code:"PUBLISH_ID_REQUIRED"});
  if(!tiktokOperationalNow()) return res.status(409).json({success:false,error:"TikTok غير متصل باتصال موثق؛ لا استعلام حالة خارجي.",code:"NOT_CONNECTED"});
  const result=await withTikTokToken((token)=>tiktokClient().fetchPublishStatus(token,publishId));
  if(!result.ok||!result.data) return res.status(502).json({success:false,error:result.error||"تعذّر استعلام حالة النشر.",code:result.code||"PROVIDER_ERROR"});
  // تحديث سجل النشر المحفوظ إن وُجد (لا إنشاء سجل وهمي).
  const records=(workspace as any).publishRecords;
  if(Array.isArray(records)){
    const rec=records.find((r:any)=>r.platform==="tiktok"&&r.providerPublishId===publishId);
    if(rec){ rec.state=result.data.delivered?"published":result.data.state==="failed"?"failed":"publishing"; rec.providerPostId=result.data.providerPostId||rec.providerPostId||null; rec.deliveryDetail=result.data.detail; rec.lastCheckedAt=new Date().toISOString(); }
  }
  await persistStateDurable();
  res.json({success:true,status:{...result.data},note:"الحالة حقيقية من TikTok بلا أي سرّ. لا يُعلن التسليم إلا بـPUBLISH_COMPLETE."});
});

/**
 * سجل عمليات نشر TikTok المحفوظ (للمالك) — بلا أي سرّ. يُثبت المسار الحقيقي:
 * تهيئة → publish_id من المزود → حالة التسليم (لا `published` بلا PUBLISH_COMPLETE).
 * التسليم يُحسم تلقائياً عبر مصالحة دورية بلا تدخّل المالك.
 */
app.get("/api/platforms/tiktok/publishes", requireOwner, async (req,res)=>{
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
  const records = Array.isArray((workspace as any).publishRecords) ? (workspace as any).publishRecords : [];
  const publishes = records
    .filter((r: any) => r.platform === "tiktok")
    .slice(0, limit)
    .map((r: any) => ({
      id: r.id,
      state: r.state,
      postMode: r.postMode || null,
      providerPublishId: r.providerPublishId || null,
      providerPostId: r.providerPostId || null,
      delivered: r.state === "published" && Boolean(r.providerPostId),
      auditRequired: r.auditRequired === true,
      createdAt: r.createdAt || null,
      lastCheckedAt: r.lastCheckedAt || null,
      deliveryDetail: r.deliveryDetail || null,
    }));
  res.json({ success: true, publishes, count: publishes.length, note: "سجل حقيقي بلا أي سرّ؛ لا يُعلن التسليم إلا بـPUBLISH_COMPLETE من TikTok." });
});

/**
 * سجل تشخيص النشر المحفوظ (للمالك فقط) — جذر «#100 لا صلاحية» و«Instagram CLIENT_ERROR».
 *
 * كل محاولة نشر فاشلة (Facebook/Instagram/Threads) تُحفظ برسالة Meta الكاملة غير
 * المقطوعة + providerCode (error.code) + providerSubcode (error_subcode) + providerTraceId
 * (fbtrace_id) عبر محوّل الحالة، فتصمد بعد restart/cold start ويمكن سحبها من هنا بدل
 * الاعتماد على سجلات Render التي تفنى مع العملية. لا يُعاد أي رمز أو سرّ — فقط وصف الخطأ.
 * الاستعلام: ?platform=facebook|instagram|threads&state=failed&limit=20
 */
app.get("/api/platforms/publish-diagnostics", requireOwner, (req,res)=>{
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
  const platformFilter = typeof req.query.platform === "string" ? String(req.query.platform).trim() : "";
  const stateFilter = typeof req.query.state === "string" ? String(req.query.state).trim() : "";
  const records = Array.isArray((workspace as any).publishRecords) ? (workspace as any).publishRecords : [];
  const rows = records
    .filter((r: any) => (platformFilter ? r.platform === platformFilter : ["facebook","instagram","threads","tiktok"].includes(r.platform)))
    .filter((r: any) => (stateFilter ? r.state === stateFilter : r.state === "failed"))
    .slice(0, limit)
    .map((r: any) => ({
      id: r.id || null,
      platform: r.platform || null,
      state: r.state || null,
      executedAt: r.executedAt || null,
      code: r.code || null,
      providerCode: r.providerCode ?? null,
      providerSubcode: r.providerSubcode ?? null,
      providerTraceId: r.providerTraceId ?? null,
      // رسالة Meta الحقيقية كما أعادها المزود (بلا أي رمز/سرّ).
      error: r.error || null,
    }));
  res.json({ success: true, diagnostics: rows, count: rows.length, note: "رسالة المزود الكاملة + code/subcode/fbtrace الحقيقية بلا أي سرّ؛ محفوظة عبر restart." });
});

/**
 * فحص صلاحيات رمز صفحة Facebook (للمالك فقط) — حسم «(#100) No permission to publish
 * the video» بلا تخمين. يقارن الصلاحيات الممنوحة فعلاً (GET /debug_token) بما يتطلبه
 * نشر فيديو الصفحة رسمياً (pages_manage_posts + pages_read_engagement + pages_show_list).
 * السبب الشائع المؤكَّد لهذا المشروع: صفحة لا تمنح pages_read_engagement (يفسّر لماذا
 * ينجح نشر النصّ عبر /feed بينما يفشل الفيديو عبر /videos). لا يُعاد أي رمز أو سرّ.
 */
app.get("/api/platforms/facebook/video-permission-diagnosis", requireOwner, async (_req,res)=>{
  const stored = getProviderToken("facebook");
  const pageToken = stored?.pageAccessToken ? String(stored.pageAccessToken) : "";
  if (!pageToken) return res.status(409).json({ success: false, error: "لا رمز صفحة Facebook موثّق.", code: "NOT_CONNECTED" });
  const clientId = envSecret("FACEBOOK_OAUTH_CLIENT_ID");
  const clientSecret = envSecret("FACEBOOK_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) return res.status(503).json({ success: false, error: "معرّف/سرّ تطبيق Meta غير مضبوطين في البيئة.", code: "CONNECTOR_NOT_READY" });
  const result = await facebookClient().debugToken(pageToken, `${clientId}|${clientSecret}`);
  if (!result.ok || !result.data) return res.status(502).json({ success: false, error: result.error || "تعذّر فحص الصلاحيات.", code: result.code || "PROVIDER_ERROR" });
  const d = result.data;
  const videoPublishReady = d.isValid && d.missingPublishScopes.length === 0;
  res.json({
    success: true,
    isValid: d.isValid,
    tokenType: d.type,
    grantedScopes: d.scopes,
    missingVideoPublishScopes: d.missingPublishScopes,
    requiredVideoPublishScopes: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
    videoPublishReady,
    reason: videoPublishReady
      ? "الصلاحيات كافية لنشر فيديو الصفحة."
      : d.missingPublishScopes.includes("pages_read_engagement")
        ? "ناقصة pages_read_engagement: يفسّر فشل الفيديو عبر /videos بينما ينجح النصّ عبر /feed. يتطلب منح الصلاحية (وربما App Review) في لوحة Meta."
        : "صلاحية مطلوبة لنشر فيديو الصفحة غير ممنوحة؛ منحها من لوحة Meta.",
    note: "فحص مباشر من Meta بلا أي سرّ؛ لا يُعلن أي نشر.",
  });
});

/**
 * تشخيص ظهور منشورات الصفحة للجمهور (قراءة فقط، للمالك فقط).
 *
 * السبب الجذري الأكثر شيوعاً لظهور منشور أنشأه التطبيق للأونر وحده وللمشرفين
 * فقط: تطبيق Meta في وضع **التطوير (Development)** لا **Live**. في وضع التطوير
 * تقيّد Meta كل محتوى ينشئه التطبيق عبر API بحيث لا يراه إلا أدوار التطبيق/
 * الصفحة، بينما المنشور اليدوي يبقى عاماً. وضع التطبيق **لا يُقرأ عبر Graph API**
 * — لذلك نعلن ذلك صراحةً بدل التخمين، مع قراءة حالة المنشور الحقيقية من Meta.
 *
 * لا ينشر ولا يغيّر أي شيء؛ يقرأ فقط `is_published` وورود المعرّف في حائط الصفحة.
 * بلا أي سرّ في الاستجابة.
 */
app.get("/api/platforms/facebook/post-visibility-diagnosis", requireOwner, async (req,res)=>{
  const stored = getProviderToken("facebook");
  const pageId = stored?.pageId ? String(stored.pageId) : "";
  const pageToken = facebookPageToken(pageId || undefined);
  if (!pageId || !pageToken) return res.status(409).json({ success:false, error:"لا صفحة Facebook موثقة؛ لا فحص ظهور.", code:"NOT_CONNECTED" });
  // postId صريح، أو آخر منشور فيسبوك حقيقي سجّله النظام (بلا اختراع معرّف).
  let providerPostId = typeof req.query.postId === "string" ? req.query.postId.trim() : "";
  let source = "explicit_query";
  if (!providerPostId) {
    const records = ((workspace as any).publishRecords || []) as any[];
    const last = records.find((r:any)=>r.platform==="facebook" && r.providerPostId);
    if (last?.providerPostId) { providerPostId = String(last.providerPostId); source = "last_publish_record"; }
  }
  if (!providerPostId) return res.status(409).json({ success:false, error:"لا يوجد معرّف منشور فيسبوك مسجّل؛ مرّر ?postId= أو انشر عبر النظام أولاً.", code:"NO_POST_ID" });
  const groundingRes = await facebookClient().getPostGrounding(pageId, pageToken, providerPostId);
  if (!groundingRes.ok || !groundingRes.data) {
    return res.status(502).json({ success:false, error: groundingRes.error || "تعذّر قراءة حالة المنشور من Meta.", code: groundingRes.code || "PROVIDER_ERROR", providerCode: groundingRes.providerCode ?? null, providerSubcode: groundingRes.providerSubcode ?? null, providerTraceId: groundingRes.providerTraceId ?? null });
  }
  const g = groundingRes.data;
  // الحكم الصادق: نضع الأسباب المحتملة إزاء الأدلة الفعلية بلا ادّعاء يقين.
  // تنبيه صياغي ملزم: is_published=true تعني «ليس مسودة/مجدولاً»، وليست إثباتاً
  // للظهور العام — فقد يكون المنشور منشوراً فعلاً لكنه مقيَّد لأدوار التطبيق/الصفحة.
  let verdict: string;
  let likelyRootCause: string;
  if (!g.exists) { verdict = "post_not_found"; likelyRootCause = "المعرّف غير موجود أو لا يمكن قراءته بالرمز الحالي."; }
  else if (g.isPublished === false) { verdict = "draft_or_scheduled"; likelyRootCause = "المنشور مسودة أو مجدول (is_published=false) فلا يظهر للجمهور بعد."; }
  else if (g.appearsOnPage === false) { verdict = "published_but_not_on_page_wall"; likelyRootCause = "المنشور منشور (is_published=true) لكنه غير وارد على حائط الصفحة العامة — يطابق تماماً قيد «وضع تطوير التطبيق» الذي يحصر المحتوى المنشأ عبر API في أدوار التطبيق/الصفحة."; }
  else { verdict = "published_and_returns_as_story"; likelyRootCause = "Meta تُعلن is_published=true والمنشور يرد ضمن المنشورات المنشورة. إن ظل مخفياً عن الجمهور فالمؤشر الأقوى هو وضع تطبيق Meta (Development) لا Live، أو اشتراط App Review/Advanced Access لصلاحيات النشر."; }
  res.json({
    success:true,
    pageId,
    providerPostId,
    postIdSource: source,
    grounding: g,
    verdict,
    likelyRootCause,
    // ملخّص ما ثبتته هذه القراءة وما لم تثبته — بلا ادّعاء ظهور عام من is_published.
    evidenceSummary: {
      isDraftOrScheduled: g.isPublished === false,
      returnsAsStory: g.isPublished === true,
      proofOfPublicVisibility: false,
      why: "is_published=true تثبت وجود كائن منشور (ليس مسودة/مجدولاً) فقط، ولا تثبت رؤيته لزائر غير إداري. ظهور المنشورات المُنشأة عبر API للجمهور يتوقف على وضع تطبيق Meta / مستوى الوصول.",
    },
    // رابط المنشور العام إن أعلنته Meta (بلا طلب إضافي): أداة المالك لفحص الظهور
    // يدوياً من جلسة غير إدارية. لا يُنشر أي شيء ولا يُغيّر أي حقل.
    permalink: g.permalink,
    // الصلاحيات المطلوبة للنشر: تُعلن كمرجع للفحص، بلا أي رمز/سرّ.
    requiredPublishPermissions: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
    // وضع التطبيق ومستوى الوصول لا تعرضهما Graph API إطلاقاً: مصدرهما الوحيد لوحة Meta.
    appMode: {
      readableViaApi: false,
      source: "Meta App Dashboard → App Mode (Development/Live) أو Access Levels (لتطبيق Business)",
      note: "تطبيقات Business استُبدل فيها Development/Live بـ«Access Levels» منذ Graph v8.0؛ كلاهما غير مقروء عبر API.",
    },
    manualActionRequired: [
      "افتح Meta App Dashboard → تطبيق «وكيل الغرابي الذكي» وتأكد أن الوضع Live (وإن كان التطبيق من نوع Business فتحقّق من Access Levels: Advanced لصلاحيات النشر pages_manage_posts/pages_read_engagement).",
      "في Development/Standard Access يظهر المحتوى المنشأ عبر API لأدوار التطبيق/الصفحة فقط — انقله إلى Live/Advanced Access.",
      "إن لزم App Review لصلاحيات النشر فأكملها لتظهر المنشورات الجديدة للجمهور.",
      "المنشورات المنشأة قبل التحويل إلى Live تتحول إلى عامة تلقائياً عند تبديل الوضع (تحقّق من منشور سابق).",
    ],
    note: "قراءة فقط بلا أي نشر أو تغيير؛ بلا أي سرّ. وضع التطبيق/مستوى الوصول غير مقروءين عبر API ويُفحصان من لوحة Meta.",
  });
});

/**
 * معلومات الناشر (query creator info) — إلزامية قبل أي نشر مباشر. للمالك فقط.
 */
app.get("/api/platforms/tiktok/creator-info", requireOwner, async (_req,res)=>{
  if(!tiktokOperationalNow()) return res.status(409).json({success:false,error:"TikTok غير متصل باتصال موثق؛ لا استعلام خارجي.",code:"NOT_CONNECTED"});
  const result=await withTikTokToken((token)=>tiktokClient().queryCreatorInfo(token));
  if(!result.ok||!result.data) return res.status(502).json({success:false,error:result.error||"تعذّر قراءة معلومات الناشر.",code:result.code||"PROVIDER_ERROR"});
  res.json({success:true,creator:result.data,note:"معلومات الناشر الرسمية من TikTok بلا أي سرّ."});
});

// اشتراك webhook (GET challenge) — يُقارن رمز التحقق بزمن ثابت.
app.get("/api/platforms/:platform/webhook", (req, res) => {
  const platform = req.params.platform;
  if (!isSupportedPlatform(platform)) return res.status(404).json({ success: false, error: "المنصة غير مدعومة." });
  const expected = webhookVerifyTokenFor(platform);
  const mode = req.query["hub.mode"];
  const token = typeof req.query["hub.verify_token"] === "string" ? req.query["hub.verify_token"] : "";
  const challenge = typeof req.query["hub.challenge"] === "string" ? req.query["hub.challenge"] : "";
  if (!expected) return res.status(404).json({ success: false, error: "webhook غير مُعدّ لهذه المنصة." });
  if (mode !== "subscribe" || !constantTimeEqual(token, expected)) return res.status(403).json({ success: false, error: "فشل التحقق من طلب الاشتراك." });
  res.type("text/plain").send(challenge);
});

// استقبال أحداث موقّعة (POST) — HMAC على الجسم الخام.
// مهم: التوقيع يُحسب على البايتات المرسلة نفسها. Express يحلل JSON أولاً، لذلك
// نحتفظ بالجسم الخام عبر verify لتفادي فشل التحقق بسبب إعادة التسلسل (مسافات/ترتيب).
app.post("/api/platforms/:platform/webhook", requireRawBody, async (req, res) => {
  const platform = req.params.platform;
  if (!isSupportedPlatform(platform)) return res.status(404).json({ success: false, error: "المنصة غير مدعومة." });
  const verifier = webhookVerifierFor(platform);
  if (!verifier) return res.status(404).json({ success: false, error: "لا يوجد مزود توقيع لهذه المنصة." });
  const secret = webhookSecretFor(platform);
  const rawBody = String((req as any).rawBody ?? "");
  const verification = verifier.verify({ headers: req.headers as Record<string, string | undefined>, rawBody, secret });
  if (!verification.ok) return res.status(401).json({ success: false, error: verification.reason || "حدث غير موثوق." });
  if (!isValidWebhookPayload(req.body)) return res.status(400).json({ success: false, error: "حمولة webhook غير صالحة." });

  const events = normalizeMetaEvents(platform as PlatformId, req.body);
  if (!events.length) return res.status(200).json({ success: true, accepted: true, ignored: "no_supported_event" });

  const { accepted, duplicates } = await ingestWebhookComments({
    platform, events, auditKind: `${platform}_inbound_events`,
    webhookEventType: (ev) => ev.kind,
  });
  res.status(200).json({ success: true, accepted: true, processed: accepted.length, ignoredDuplicates: duplicates });
});

// -------------------------------------------------------------
// YouTube FULL OPERATION — مسارات تشغيلية حقيقية على YouTube Data API v3.
// كل مسار يمر بالبوابات بالترتيب: وضع YouTube-only → المصادقة → القدرة →
// الاتصال الموثق → حارس السلامة/الموافقة → idempotency → rate limit → التنفيذ
// → audit → persistence. لا يُسجَّل نجاح بلا معرّف من Google، ولا تُختلق قيمة.
// -------------------------------------------------------------

/** بوابة موحّدة: تمنع أي عملية YouTube إن لم تكن الاعتمادات حاضرة والاتصال موثقاً. */
function youtubeOperationGuard(): { ok: boolean; status?: number; code?: string; error?: string } {
  // العنوان العام مطلوب لبدء OAuth لا لتنفيذ عملية على اتصال قائم؛ فنتحقق هنا من
  // بيانات تطبيق Google ومفتاح التشفير (اللازمان للتجديد والقراءة) لا من العنوان.
  const c = youtubeOAuthConfig();
  if (!c?.clientId || !c?.clientSecret || !tokenKeyBytes()) {
    return { ok: false, status: 503, code: "CONNECTOR_NOT_READY", error: "موصل YouTube غير مهيأ (بيانات Google أو مفتاح التشفير ناقص)." };
  }
  const conn: any = platformConnections.get("youtube");
  if (!conn || conn.status !== "connected" || conn.providerVerified !== true) {
    return { ok: false, status: 409, code: "NOT_CONNECTED", error: "قناة YouTube غير متصلة باتصال موثق؛ لا يمكن تنفيذ أي عملية خارجية." };
  }
  return { ok: true };
}
/**
 * حارس وضع YOUTUBE_ONLY_OPERATIONAL: يمنع أي عملية خارجية على منصة غير YouTube.
 * يُستخدم في كل مسار تنفيذ خارجي فلا يُرسَل أي طلب لغير YouTube في هذا الوضع.
 */
function youtubeOnlyBlock(platform: string): { blocked: boolean; status?: number; body?: any } {
  const g = guardExternalOperationPlatform(platform, process.env);
  if (g.allowed) return { blocked: false };
  return { blocked: true, status: 409, body: { success: false, code: g.code, error: g.reason, platform, youtubeOnlyMode: true } };
}

// -------------------------------------------------------------
// تفويض تشغيل YouTube من المالك إلى العقل المركزي.
// نطاق YouTube فقط؛ يُمنح/يُوقف من المالك؛ يبقى سجل التدقيق وإمكانية الإيقاف.
// لا يُلغي أي حارس (اتصال موثق/سلامة/تكرار/rate limit/audit). بلا أي سرّ.
// -------------------------------------------------------------
let youtubeDelegationState: YouTubeDelegation = defaultYouTubeDelegation();

// -------------------------------------------------------------
// منظومة DR (Google Drive): تفويض منفصل تماماً عن تسجيل الدخول وعن بقية
// المنظومة. لا تُقرأ DATABASE_URL ولا تُرفع قاعدة بيانات خام. تُحفظ هنا فقط
// حالات CSRF ورمز التجديد المشفّر وآخر خطأ — كلها عبر محوّل الحالة.
// -------------------------------------------------------------
const drControl: { driveOAuthStates: any[]; driveRefreshToken: any; driveLastError: string | null; driveBackup: any; driveFolderIdentity: any; driveMirror: any; driveReconciliation: any; driveAutoBackup: any; driveLease: any; driveAlerts: any; driveDbBalance: any; driveMarketingFolderIdentity: any } = {
  driveOAuthStates: [],
  driveRefreshToken: null,
  driveLastError: null,
  driveBackup: null,
  driveFolderIdentity: null,
  driveMirror: null,
  driveReconciliation: null,
  driveAutoBackup: null,
  driveLease: null,
  driveAlerts: {},
  driveDbBalance: null,
  // معرّف مجلد Drive التسويقي («al-gharabi-ai-marketing») — منفصل تماماً عن
  // مجلد DR (driveFolderIdentity أعلاه). يُستخدم فقط لاستضافة فيديوهات علنية
  // (Task #21/videoPublicHosting)؛ لا صلة له بالنسخ الاحتياطي أو الأسرار.
  driveMarketingFolderIdentity: null,
};

/**
 * يبني عميل Drive لاستضافة الفيديو العامة (Task #21) من نفس رمز التجديد
 * المخزَّن لمنظومة DR (نفس حساب Drive الشخصي للمالك، نفس موافقة OAuth
 * `drive.file` التي تمت مرة واحدة) — بلا أي اعتماد جديد وبلا لمس منطق DR
 * الداخلي (فصل متعمد: DR routes تبقى مسؤولة فقط عن نسخها هي).
 * تعيد null إن لم يكن التفويض جاهزاً بعد (لم يُمنح/لا رمز تجديد مخزَّن).
 */
// تشخيص تعثّر استضافة الفيديو إلى Drive (بلا أي سرّ): آخر انتهاء مهلة وقطرة
// زمن آخر النداءات. تُطَّهر دائماً من الاستعلام فتبقى عناوين بلا معرّفات.
type DriveHostTimeoutInfo = { at: string; url: string; ms: number } | null;
type DriveHostCallRecord = { at: string; url: string; method: string; ms: number; status: number; timedOut: boolean };
let driveHostLastTimeout: DriveHostTimeoutInfo = null;
const driveHostCallRecords: DriveHostCallRecord[] = [];
const DRIVE_HOST_CALL_RECORDS_MAX = 20;
function buildMarketingDriveClient(): InstanceType<typeof DriveClient> | null {
  const info = inspectDriveAuthEnv(process.env as NodeJS.ProcessEnv);
  if (!info.configured) return null;
  if (!drControl.driveRefreshToken) return null;
  const provider = createRefreshTokenProvider({ env: process.env, encryptedRefreshToken: drControl.driveRefreshToken });
  const client = new DriveClient({ transport: createGaxiosTransport(), tokenProvider: provider });
  // غلاف صريح يضمن أن أي نداء Drive (حتى لو تجاهل التنفيذ الداخلي خيار timeout)
  // ينتهي خلال مهلة محددة بدل أن يعلّق الطلب العام بلا نهاية. يُخزَّن آخر مهلة/خطأ
  // للتشخيص فقط (بلا أي سرّ) ويُعلن في /api/health عبر driveHostLastError.
  const base = client.transport;
  const guardMs = envTimeoutMs(process.env as NodeJS.ProcessEnv, "DRIVE_HOST_CALL_TIMEOUT_MS", 0) || 120_000;
  client.transport = ((opts: any) => {
    const startedAt = Date.now();
    const endpoint = safeDriveEndpoint(String(opts?.url || ""));
    const method = String(opts?.method || "GET");
    let guardFired = false;
    const record = (status: number, timedOut: boolean) => {
      driveHostCallRecords.push({ at: new Date().toISOString(), url: endpoint, method, ms: Date.now() - startedAt, status, timedOut });
      if (driveHostCallRecords.length > DRIVE_HOST_CALL_RECORDS_MAX) driveHostCallRecords.splice(0, driveHostCallRecords.length - DRIVE_HOST_CALL_RECORDS_MAX);
    };
    return settleWithTimeout(
      Promise.resolve().then(() => base(opts)),
      guardMs,
      () => { guardFired = true; driveHostLastTimeout = { at: new Date().toISOString(), url: endpoint, ms: guardMs }; },
    ).then(
      (res: any) => { record(Number(res?.status ?? 0), false); return res; },
      (err: any) => {
        // يميّز الانتهاء عن فشل عادي: مهلة الغلاف، أو انتهاء مهلة النقل/التحكم.
        const code = String(err?.code || err?.name || "");
        const timedOut = guardFired || /timeout|abort|ETIMEDOUT|ECONNABORTED/i.test(code);
        if (timedOut) driveHostLastTimeout = { at: new Date().toISOString(), url: endpoint, ms: Date.now() - startedAt };
        record(0, timedOut);
        throw err;
      },
    );
  }) as any;
  return client;
}

/** يجرّد عنوان نقطة Drive من الاستعلام (لا معرّفات/أسرار) للتشخيص فقط. */
function safeDriveEndpoint(url: string): string {
  return url.split("?")[0].slice(0, 120);
}

/** يحفظ التفويض عبر محوّل الحالة (يصمد بعد restart) — كتابة تُنتظر عند التغيير. */
async function saveYouTubeDelegationState(): Promise<void> {
  if (!storageReady) return;
  await storageAdapter.write(STORAGE_KEY_CONTROL, buildControlState());
}

/** يقرّر هل تسمح عملية خارجية لأداة عقل بموجب التفويض الحالي (نطاق YouTube فقط). */
function youtubeDelegationCheck(operator: AgentOperator, input: { toolId: string; args: Record<string, any> }): { allowed: boolean; code?: string; reason?: string } {
  const decision = evaluateYouTubeDelegation({ delegation: youtubeDelegationState, toolId: input.toolId, args: input.args, operator });
  return { allowed: decision.allowed, code: decision.code, reason: decision.reason };
}

/** تفاصيل التفويض للعرض في الصحة/الجاهزية/الواجهة (بلا أي سرّ). */
function youtubeDelegationBlock() {
  return {
    ...summarizeYouTubeDelegation(youtubeDelegationState),
    scopeOnly: "youtube",
    note: "التفويض خاص بـYouTube فقط؛ لا يمنح أي منصة أخرى، ولا يُلغي المصادقة/الملكية/التدقيق/سلامة المحتوى.",
  };
}

/** يبني تفاصيل الحالة الصادقة لاستجابة API (بلا أي سرّ). */
function youtubeStateBlock() {
  const t = youtubeTruthfulState();
  return { state: t.state, labelAr: t.labelAr, tone: t.tone, reason: t.reason, nextAction: t.nextAction, youtubeOnlyMode: t.youtubeOnlyMode };
}
/** يسجّل مفتاح idempotency ويعيد هل هو مكرر (يمنع الرفع/الرد/النشر المزدوج). */
function youtubeOperationKeySeen(key: string): boolean {
  if (!key) return false;
  const keys: string[] = Array.isArray((workspace as any).youtubeOperationKeys) ? (workspace as any).youtubeOperationKeys : [];
  return keys.includes(key);
}
function recordYouTubeOperationKey(key: string): void {
  if (!key) return;
  const keys: string[] = Array.isArray((workspace as any).youtubeOperationKeys) ? (workspace as any).youtubeOperationKeys : [];
  (workspace as any).youtubeOperationKeys = [...keys, key].slice(-20000);
}
/** يسجّل تعليق YouTube الوارد محلياً بمنع تكرار بمعرّف التعليق (يصمد بعد restart). */
function ingestYouTubeComment(c: YouTubeComment, videoId: string | null): { duplicate: boolean; record: any } {
  if (!Array.isArray((workspace as any).socialComments)) (workspace as any).socialComments = [];
  const existing = (workspace as any).socialComments.find((x: any) => x.platform === "youtube" && x.externalId === c.commentId);
  if (existing) return { duplicate: true, record: existing };
  const classification = classifyComment(c.text);
  const record = {
    id: workspaceId("comment"), platform: "youtube", externalId: c.commentId,
    threadId: c.threadId, postExternalId: videoId || c.videoId,
    authorName: c.authorName, text: c.text, createdAt: c.publishedAt || new Date().toISOString(),
    updatedAt: c.updatedAt, likeCount: c.likeCount, replyCount: c.replyCount, isReply: c.isReply, parentId: c.parentId,
    classification, requiresHumanReview: classification.requiresHumanReview,
    ingestSource: "youtube_api", replyTarget: { commentId: c.commentId, videoId: videoId || c.videoId },
  };
  (workspace as any).socialComments.unshift(record);
  if ((workspace as any).socialComments.length > WORKSPACE_MAX_SOCIAL_COMMENTS) (workspace as any).socialComments.length = WORKSPACE_MAX_SOCIAL_COMMENTS;
  const ids: string[] = Array.isArray((workspace as any).youtubeCommentIds) ? (workspace as any).youtubeCommentIds : [];
  (workspace as any).youtubeCommentIds = [...ids, c.commentId].slice(-20000);
  return { duplicate: false, record };
}

/** قائمة فيديوهات القناة (قراءة حقيقية) مع الإحصاءات. */
app.get("/api/platforms/youtube/videos", authenticateToken, async (req, res) => {
  const guard = youtubeOperationGuard();
  if (!guard.ok) return res.status(guard.status!).json({ success: false, code: guard.code, error: guard.error, ...youtubeStateBlock() });
  const ensured = await ensureYouTubeAccessToken();
  if (!ensured.ok || !ensured.token) return res.status(409).json({ success: false, code: ensured.code || "TOKEN_UNAVAILABLE", error: ensured.error, ...youtubeStateBlock() });
  const stored = youtubeStoredCredentials();
  const playlistId = String(stored?.uploadsPlaylistId || "");
  if (!playlistId) return res.status(409).json({ success: false, code: "UPLOADS_PLAYLIST_MISSING", error: "لا قائمة رفع محفوظة للقناة؛ أعد ربط YouTube." });
  const maxResults = Math.max(1, Math.min(50, Number(req.query.maxResults || 25)));
  const result = await youtubeClient().listMyVideos(ensured.token, { uploadsPlaylistId: playlistId, maxResults });
  if (!result.ok || !result.data) {
    noteYouTubeProviderError(result.code as any);
    return res.status(502).json({ success: false, code: result.code || "PROVIDER_ERROR", error: result.error, ...youtubeStateBlock() });
  }
  clearYouTubeProviderError();
  res.json({ success: true, channelId: String(stored?.channelId || ""), count: result.data.videos.length, videos: result.data.videos, nextPageToken: result.data.nextPageToken, note: "قائمة فيديوهات حقيقية من YouTube Data API — لا بيانات مُختلقة." });
});

/** إحصاءات القناة والفيديو + تحليل جمهور من المؤشرات المتاحة فعلاً فقط. */
app.get("/api/platforms/youtube/analytics", authenticateToken, async (req, res) => {
  const guard = youtubeOperationGuard();
  if (!guard.ok) return res.status(guard.status!).json({ success: false, code: guard.code, error: guard.error, ...youtubeStateBlock() });
  const ensured = await ensureYouTubeAccessToken();
  if (!ensured.ok || !ensured.token) return res.status(409).json({ success: false, code: ensured.code || "TOKEN_UNAVAILABLE", error: ensured.error, ...youtubeStateBlock() });
  const stored = youtubeStoredCredentials();
  const channelRes = await youtubeClient().getChannelStatistics(ensured.token);
  if (!channelRes.ok || !channelRes.data) {
    noteYouTubeProviderError(channelRes.code as any);
    return res.status(502).json({ success: false, code: channelRes.code || "PROVIDER_ERROR", error: channelRes.error, ...youtubeStateBlock() });
  }
  const videosRes = await youtubeClient().listMyVideos(ensured.token, { uploadsPlaylistId: String(stored?.uploadsPlaylistId || ""), maxResults: 50 });
  const videos = videosRes.ok && videosRes.data ? videosRes.data.videos : [];
  const records = youtubeVideoMetricRecords(videos);
  const summary = summarizeChannelAnalytics(records);
  const audience = analyzeYouTubeAudience(records, summary);
  clearYouTubeProviderError();
  // تُحفظ المؤشرات في سجل الأداء الحقيقي (لتغذية العقل والذاكرة).
  if (!Array.isArray((workspace as any).performanceRecords)) (workspace as any).performanceRecords = [];
  for (const v of videos) {
    if (v.viewCount === null && v.likeCount === null && v.commentCount === null) continue;
    const values: Record<string, number> = {};
    if (v.viewCount !== null) values.views = v.viewCount;
    if (v.likeCount !== null) values.likes = v.likeCount;
    if (v.commentCount !== null) values.comments = v.commentCount;
    if (!Object.keys(values).length) continue;
    (workspace as any).performanceRecords.unshift({ id: workspaceId("perf"), platform: "youtube", contentType: "video", postExternalId: v.videoId, values, at: new Date().toISOString(), recordedBy: "system" });
  }
  if ((workspace as any).performanceRecords.length > 20000) (workspace as any).performanceRecords = (workspace as any).performanceRecords.slice(0, 20000);
  persistState();
  res.json({
    success: true,
    channel: channelRes.data,
    videoCount: videos.length,
    summary,
    audience,
    note: "الإحصاءات من YouTube Data API v3. لا تُخترع بيانات سكانية (عمر/جنس/موقع) لأنها تتطلب YouTube Analytics API ولم تُطلب.",
  });
});

/** حلقة التعلّم: تقارن الأداء الحالي بالسابق وتُنتج دروساً مع مصدرها وحدودها. */
app.get("/api/platforms/youtube/learning", authenticateToken, async (req, res) => {
  const guard = youtubeOperationGuard();
  if (!guard.ok) return res.status(guard.status!).json({ success: false, code: guard.code, error: guard.error, ...youtubeStateBlock() });
  const ensured = await ensureYouTubeAccessToken();
  if (!ensured.ok || !ensured.token) return res.status(409).json({ success: false, code: ensured.code || "TOKEN_UNAVAILABLE", error: ensured.error, ...youtubeStateBlock() });
  const stored = youtubeStoredCredentials();
  const result = await youtubeClient().listMyVideos(ensured.token, { uploadsPlaylistId: String(stored?.uploadsPlaylistId || ""), maxResults: 50 });
  if (!result.ok || !result.data) {
    noteYouTubeProviderError(result.code as any);
    return res.status(502).json({ success: false, code: result.code || "PROVIDER_ERROR", error: result.error, ...youtubeStateBlock() });
  }
  const records = youtubeVideoMetricRecords(result.data.videos);
  // المجموعة السابقة: أحدث 25 فيديو مقابل ما قبلها (مقارنة زمنية حقيقية).
  const learning = buildYouTubeLearning({ records: records.slice(0, 25), previousRecords: records.slice(25) });
  clearYouTubeProviderError();
  res.json({ success: true, learning, note: "كل درس يحمل مصدره وحجم عيّنته ونطاقه الزمني وحدوده؛ لا يُعتبر حقيقة إحصائية بلا عيّنة كافية." });
});

/** قراءة تعليقات فيديو حقيقي (commentThreads.list) وتخزينها كتعليقات حقيقية. */
app.get("/api/platforms/youtube/comments", authenticateToken, async (req, res) => {
  const guard = youtubeOperationGuard();
  if (!guard.ok) return res.status(guard.status!).json({ success: false, code: guard.code, error: guard.error, ...youtubeStateBlock() });
  const videoId = typeof req.query.videoId === "string" ? req.query.videoId.trim() : "";
  if (!videoId) return res.status(400).json({ success: false, error: "معرّف الفيديو (videoId) مطلوب لقراءة التعليقات." });
  if (!youtubeForceSslGranted()) {
    return res.status(409).json({ success: false, code: "SCOPE_UPGRADE_REQUIRED", error: "إعادة ربط YouTube مطلوبة لتفعيل إدارة التعليقات (نطاق youtube.force-ssl).", ...youtubeStateBlock() });
  }
  const ensured = await ensureYouTubeAccessToken();
  if (!ensured.ok || !ensured.token) return res.status(409).json({ success: false, code: ensured.code || "TOKEN_UNAVAILABLE", error: ensured.error, ...youtubeStateBlock() });
  const result = await youtubeClient().listCommentThreads(ensured.token, { videoId, maxResults: Math.max(1, Math.min(100, Number(req.query.maxResults || 100))) });
  if (!result.ok || !result.data) {
    noteYouTubeProviderError(result.code as any);
    return res.status(502).json({ success: false, code: result.code || "PROVIDER_ERROR", error: result.error, ...youtubeStateBlock() });
  }
  let inserted = 0; let duplicates = 0;
  for (const c of result.data.comments) {
    const ing = ingestYouTubeComment(c, videoId);
    if (ing.duplicate) duplicates += 1; else inserted += 1;
  }
  await persistStateDurable();
  clearYouTubeProviderError();
  audit((req as any).user.id, "youtube_comments_read", `${videoId}:${inserted}`);
  res.json({
    success: true, videoId, fetched: result.data.comments.length, inserted, duplicates,
    comments: result.data.comments,
    note: "تعليقات حقيقية من commentThreads.list. لا رد آلي على السبام أو الحالات الحساسة.",
  });
});

/**
 * منفّذ الرد الحقيقي على تعليق YouTube — مصدر واحد يمر بكل البوابات:
 * الاتصال الموثق → نطاق force-ssl → سلامة المحتوى → منع التكرار → منع الرد على
 * حساب المعرض → rate limit → comments.insert. يستخدمه المسار الخارجي والعقل
 * المركزي معاً فلا يوجد مسار يتجاوز بوابة. لا يُسجَّل `sent` بلا معرّف من Google.
 */
async function executeYouTubeReply(input: { commentId: string; text: string; commentText?: string; productId?: string }, actor: string): Promise<{ status: number; body: any }> {
  const started = Date.now();
  const parentCommentId = String(input.commentId || "").trim();
  const text = String(input.text || "").trim();
  const commentText = String(input.commentText || "");
  if (!parentCommentId) return { status: 400, body: { success: false, error: "معرّف التعليق (commentId) مطلوب لمنع الرد المكرر." } };
  if (!text) return { status: 400, body: { success: false, error: "نص الرد مطلوب." } };
  // REL-01: حجز ذرّي يمنع رد مكرر فعلي — هذه الدالة تُستدعى من مسار يدوي
  // (/api/platforms/youtube/reply) **ومن** دورة مراقبة يوتيوب التلقائية معاً؛
  // بلا هذا القفل يمكن أن يتزامن رد يدوي من المالك مع رد تلقائي على نفس التعليق.
  const replyLock = replyLockKey("youtube", "comment", parentCommentId);
  if (!acquireReplyLock(replyLock)) {
    return { status: 409, body: { success: false, error: "طلب رد آخر على نفس التعليق قيد التنفيذ بالفعل (يدوي أو تلقائي)؛ انتظر حتى يكتمل لمنع التكرار.", code: "REPLY_IN_PROGRESS" } };
  }
  try {
  const guard = youtubeOperationGuard();
  if (!guard.ok) return { status: guard.status!, body: { success: false, code: guard.code, error: guard.error, ...youtubeStateBlock() } };
  if (!youtubeForceSslGranted()) {
    return { status: 409, body: { success: false, code: "SCOPE_UPGRADE_REQUIRED", error: "إعادة ربط YouTube مطلوبة لتفعيل إدارة التعليقات (نطاق youtube.force-ssl).", ...youtubeStateBlock() } };
  }
  // حارس سلامة المحتوى من جهة الخادم قبل أي إرسال: لا نص رد يحمل عرضاً غير مسجّل.
  const product = workspace.products.find((p: any) => p.id === String(input.productId || "")) || null;
  const replyFacts = buildFactsForProduct(product, Number(product?.downPaymentPercent || 0), Number(product?.durationMonths || 0));
  const safety = analyzeBusinessClaims(text, replyFacts);
  if (!safety.safe) {
    return { status: 422, body: { success: false, error: "نص الرد يحمل عرضاً تجارياً غير مسجّل، وتم إيقافه قبل الإرسال.", contentSafety: { violations: safety.blocked.map((v) => v.detail), codes: safety.blocked.map((v) => v.code) } } };
  }
  // منع الرد المكرر عبر معرّف التعليق + بصمة النص (حماية replay/retry).
  const history: ReplyRecord[] = ((workspace as any).socialReplies || []).map((r: any) => ({ externalId: r.externalId, replyFingerprint: r.replyFingerprint, repliedAt: r.repliedAt }));
  const decision = evaluateReplyGuard({ externalId: parentCommentId, replyText: text, history });
  if (!decision.allowed) return { status: 409, body: { success: false, code: "DUPLICATE_REPLY", error: decision.reason, guard: decision } };
  // منع حلقات الرد على حساب المعرض نفسه.
  const ownNames = [String(workspace.showroom?.name || ""), "معرض الغرابي"];
  const knownComment = ((workspace as any).socialComments || []).find((c: any) => c.platform === "youtube" && c.externalId === parentCommentId);
  if (isSelfAuthored(knownComment?.authorName, ownNames)) {
    return { status: 409, body: { success: false, error: "التعليق صادر من حساب المعرض؛ لا يُرد عليه لتجنب حلقة ردود." } };
  }
  const rl = youtubeRateLimit("reply");
  if (!rl.allowed) {
    return { status: 429, body: { success: false, code: "RATE_LIMITED", error: "تم بلوغ حد معدّل الردود؛ العملية قابلة لإعادة المحاولة لاحقاً بلا إنشاء نسخة مكررة.", retryAfterMs: rl.retryAfterMs, limit: rl.limit } };
  }
  const ensured = await ensureYouTubeAccessToken();
  if (!ensured.ok || !ensured.token) return { status: 409, body: { success: false, code: ensured.code || "TOKEN_UNAVAILABLE", error: ensured.error, ...youtubeStateBlock() } };
  const result = await youtubeClient().replyToComment(ensured.token, { parentCommentId, text });
  const delivered = Boolean(result.ok && result.data?.commentId);
  const externalReplyId = result.ok && result.data?.commentId ? result.data.commentId : null;
  // دورة الحياة: لا `sent` بلا معرّف رد حقيقي من YouTube. الفشل يُعلن failed صراحةً.
  const replyState: YouTubeReplyLifecycleState = resolveYouTubeReplyState({ delivered, externalReplyId, approved: true, failed: !result.ok });
  const nowIso = new Date().toISOString();
  const replyRecord = {
    id: workspaceId("reply"), platform: "youtube", externalId: parentCommentId,
    text, replyFingerprint: decision.fingerprint, commentText,
    classification: classifyComment(commentText || text),
    contentSafety: { safe: true, violations: [] as string[], codes: [] as string[] },
    repliedAt: nowIso, createdBy: actor,
    simulated: false,
    state: replyState,
    stateLabelAr: YOUTUBE_REPLY_LIFECYCLE_LABELS_AR[replyState],
    approvedAt: nowIso,
    sentAt: delivered ? nowIso : null,
    failedAt: !result.ok ? nowIso : null,
    delivered,
    externalReplyId,
    reviewStatus: delivered ? "sent" : "failed",
    deliveryError: result.ok ? null : (result.error || "فشل الإرسال إلى YouTube"),
  };
  if (!Array.isArray((workspace as any).socialReplies)) (workspace as any).socialReplies = [];
  (workspace as any).socialReplies.unshift(replyRecord);
  if ((workspace as any).socialReplies.length > WORKSPACE_MAX_SOCIAL_REPLIES) (workspace as any).socialReplies.length = WORKSPACE_MAX_SOCIAL_REPLIES;
  await persistStateDurable();
  logYouTubeOperation("comment_reply", { externalId: parentCommentId, outcome: result.ok ? "delivered" : "failed", errorCode: result.ok ? null : (result.code as any) || null, durationMs: Date.now() - started, actor });
  audit(actor, result.ok ? "youtube_reply_delivered" : "youtube_reply_failed", `youtube:${parentCommentId}`);
  if (!result.ok) {
    noteYouTubeProviderError(result.code as any);
    return { status: 502, body: { success: false, code: result.code || "PROVIDER_ERROR", error: result.error, reply: replyRecord, delivered: false, state: replyState, note: "لم يُسجَّل الرد مُسلَّماً بلا معرّف تعليق من Google.", ...youtubeStateBlock() } };
  }
  // الحكم على التسليم من معرّف الرد الحقيقي لا من نجاح الطلب فقط: لا `sent` ولا
  // delivered=true بلا معرّف تعليق فعلي من Google.
  if (!delivered || !externalReplyId) {
    return { status: 502, body: { success: false, code: "PROVIDER_NO_REPLY_ID", error: "لم يُعِد YouTube معرّف رد حقيقي؛ لا يُسجَّل تسليم.", reply: replyRecord, delivered: false, state: replyState, ...youtubeStateBlock() } };
  }
  clearYouTubeProviderError();
  return { status: 200, body: { success: true, reply: replyRecord, delivered: true, externalReplyId, state: replyState, ...youtubeStateBlock() } };
  } finally { releaseReplyLock(replyLock); }
}

// -------------------------------------------------------------
// YouTube Comment Watcher — مدير تشغيل YouTube 24/7 (العقل المركزي).
// مراقبة مستمرة مستقلة عن المتصفح: job داخلي على الخادم (Render web process)
// يقرأ التعليقات الحقيقية، يحلّلها حتمياً، يقرّر الرد/التصعيد، ويرد فعلياً عبر
// نفس executeYouTubeReply عند تمكين المالك ووجود تفويض فعّال. كل حالة تُحفظ عبر
// محوّل الحالة (Postgres) فتصمد بعد restart/deploy. لا سرّ في أي منها.
// -------------------------------------------------------------
const WATCHER_STATE_KEY = "youtubeWatcher";

interface WatcherState {
  controls: YouTubeWatcherControls;
  processed: WatcherProcessedEntry[];
  processedWindow: number[];
  opportunities: WatcherOpportunity[];
  audit: any[];
  lastPollAt: string | null;
  lastCommentId: string | null;
  lastCommentAt: string | null;
  lastError: string | null;
  consecutiveErrors: number;
  pollCount: number;
  brief: any | null;
  briefDate: string | null;
  lastScanned: number;
  /** قرارات مراجعة المالك (Override) — آخر قرار لكل تعليق، تصمد بعد restart. */
  reviewOverrides: WatcherReviewOverride[];
}

let watcherState: WatcherState = {
  controls: defaultWatcherControls(),
  processed: [],
  processedWindow: [],
  opportunities: [],
  audit: [],
  lastPollAt: null,
  lastCommentId: null,
  lastCommentAt: null,
  lastError: null,
  consecutiveErrors: 0,
  pollCount: 0,
  brief: null,
  briefDate: null,
  lastScanned: 0,
  reviewOverrides: [],
};
let watcherRunning = false;
let watcherScheduler: WatcherScheduler | null = null;
let watcherLastRun: { newDetected: number; replied: number; escalated: number; skipped: number; verified: number; failed: number; deferred: number; at: string } | null = null;
// PROC-01: قفل دوام لدورة المراقبة. يُحفظ عبر الحالة الدائمة (ملف/Postgres) فيراه
// أي عملية أخرى — لا تنطلق دورتان متزامنتان عند تعدد العمليات/cold start/إعادة نشر.
// حي لمدة 5 دقائق (> مهلة الدورة الفعلية)، ويُستردّ إن تعطّلت العملية المالكة.
const WATCHER_LEASE_TTL_MS = 5 * 60 * 1000;
let watcherLease: DurableLease | null = null;
const WATCHER_LEASE_OWNER = `watcher-${process.pid}-${Date.now().toString(36)}`;

// -------------------------------------------------------------
// طابور محتوى YouTube (Auto Publish + Auto Schedule + Human Review).
// تُحفظ العناصر عبر المحوّل (تصمد بعد restart/deploy) — بلا أي سرّ.
// -------------------------------------------------------------
interface ContentQueueItem {
  id: string;
  fingerprint: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacyStatus: string;
  publishAt: string | null;
  mediaRef: string;
  source: string;
  /** معرّف المنتج الحقيقي المرتبط بالمحتوى (لربط الفيديو بمنتجات المعرض) — أو null. */
  productId: string | null;
  state: ContentState;
  stateReason: string;
  code: string;
  sensitivity: string;
  externalVideoId: string | null;
  url: string | null;
  verified: boolean;
  /** معرّف الفيديو الذي أُثبتت حالته من YouTube فعلياً، وحالته المؤكدة. */
  verifiedVideoId: string | null;
  verifiedPrivacyStatus: string | null;
  /** هل أُثبت وصول الوصف المعتمد إلى YouTube فعلاً؟ */
  verifiedDescription?: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  history: Array<{ at: string; action: string; actor: string; detail?: string | null; externalVideoId?: string | null; result?: string | null }>;
}

let contentQueue: ContentQueueItem[] = [];
const CONTENT_QUEUE_MAX = 5000;

// -------------------------------------------------------------
// مخزن مادة الفيديو (بايتات حقيقية مرجعها mediaRef) — بلا اختلاق أي فيديو.
// يُحفظ عبر المحوّل فيصمد بعد restart، ويُقيَّد بحجم كي لا يتضخّم المخزن.
// -------------------------------------------------------------
interface ContentMedia {
  mimeType: string;
  base64: string;
  bytes: number;
  sha256: string;
  createdAt: string;
}
let contentMedia = new Map<string, ContentMedia>();
const CONTENT_MEDIA_KEY = "youtubeMedia";
const CONTENT_MEDIA_MAX_ITEM_BYTES = 12 * 1024 * 1024; // 12MB لكل مادة
const CONTENT_MEDIA_MAX_TOTAL_BYTES = 60 * 1024 * 1024; // 60MB إجمالاً
// الأنواع المسموح بها لمادة الفيديو (منفّذة فعلياً في uploadVideo عبر videos.insert).
const CONTENT_ALLOWED_MIME = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/x-msvideo"]);
// امتدادات الملف المرسلة مع نوعها — لتقاطع MIME مع الامتداد (يرفض عدم التطابق).
const CONTENT_MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo",
};
let contentMediaTotalBytes = 0;

/**
 * يتحقق من بايتات مادة الفيديو فعلياً (لا على تصريح العميل): طول كافٍ، توقيع
 * الملف (magic bytes) يطابق نوعاً مسموحاً. الهدف: رفض النص العادي/payload وهمي/
 * MIME غير صحيح قبل التسجيل.
 */
function validateMediaBytes(bytes: Buffer, mimeType: string, filename?: string): { ok: boolean; code?: string; error?: string } {
  if (!bytes.length) return { ok: false, code: "MEDIA_REQUIRED", error: "بايتات فارغة." };
  if (bytes.length < 12) return { ok: false, code: "MEDIA_INVALID", error: "الملف أصغر من أن يكون فيديو صالحاً." };
  // توقيع الملف الحقيقي: MP4/MOV/M4V = 'ftyp' عند الإزاحة 4؛ WebM/MKV = EBML
  // (0x1A45DFA3)؛ AVI = 'RIFF'…'AVI '. أي شيء آخر يُرفض (نص/وهمي/WEBP).
  const b = bytes;
  const four = b.toString("latin1", 0, 4);
  const eight = b.length >= 12 ? b.toString("latin1", 8, 12) : "";
  const isEbml = b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  const detected: string | null = (b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp") ? "video/mp4"
    : isEbml ? "video/webm"
    : (four === "RIFF" && eight === "AVI ") ? "video/x-msvideo"
    : null;
  if (!detected) return { ok: false, code: "MEDIA_INVALID", error: "محتوى الملف ليس فيديو صالحاً (توقيع الملف غير معروف)." };
  const declared = String(mimeType || "").toLowerCase().split(";")[0].trim();
  // نوع مُصرَّح به لكنه غير مسموح ⇒ رفض صريح (لا رجوع صامت للنوع المكتشف).
  if (declared && declared !== "video/quicktime" && !CONTENT_ALLOWED_MIME.has(declared)) {
    return { ok: false, code: "MEDIA_INVALID", error: `نوع الفيديو غير مدعوم (${declared}).` };
  }
  const declaredAllowed = declared === "video/quicktime" ? "video/mp4" : declared;
  const effective = CONTENT_ALLOWED_MIME.has(declaredAllowed) ? declaredAllowed : detected;
  // تقاطع: التوقيع المكتشف يجب أن يتوافق مع النوع الفعّال (لا تنكّر بالنوع).
  const compatible = effective === detected
    || (detected === "video/mp4" && effective === "video/mp4")
    || (detected === "video/webm" && effective === "video/x-matroska")
    || (detected === "video/x-matroska" && effective === "video/webm");
  if (!compatible) return { ok: false, code: "MEDIA_INVALID", error: `نوع الفيديو (${declared || "غير محدّد"}) لا يطابق محتوى الملف.` };
  // تطابق الامتداد مع النوع إن أُرسل اسم ملف. mkv/webm وmov/mp4 يُعدّان متوافقين.
  if (filename) {
    const ext = String(filename).toLowerCase().split(".").pop() || "";
    const byExt = CONTENT_MIME_BY_EXT[ext];
    const extFamily = byExt === "video/x-matroska" ? "video/webm" : byExt;
    const effFamily = effective === "video/x-matroska" ? "video/webm" : effective;
    if (byExt && extFamily !== effFamily) return { ok: false, code: "MEDIA_INVALID", error: `امتداد الملف (${ext}) لا يطابق نوعه (${effective}).` };
  }
  return { ok: true };
}

/** فكّ base64 صارم: يرفض المحارف غير الصالحة والطول المشوّه (لا تسامح صامت). */
function decodeStrictBase64(base64: string): Buffer | null {
  const clean = String(base64 || "").replace(/\s+/g, "");
  if (!clean || clean.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  const bytes = Buffer.from(clean, "base64");
  if (!bytes.length) return null;
  // إعادة الترميز يجب أن تطابق المدخل (يكشف النص المزيف/القطع).
  if (bytes.toString("base64").replace(/=+$/, "") !== clean.replace(/=+$/, "")) return null;
  return bytes;
}

/** يُسجّل مادة فيديو حقيقية بمعرّف مرجع (mediaRef) — يرفض ما هو أكبر/غير صالح. */
function registerContentMedia(input: { mimeType: string; base64: string; filename?: string }): { ok: boolean; mediaRef?: string; code?: string; error?: string; bytes?: number; mimeType?: string } {
  const base64 = String(input.base64 || "");
  if (!base64) return { ok: false, code: "MEDIA_REQUIRED", error: "لا بايتات فيديو." };
  // الحد على البايتات الفعلية لا على طول نص base64.
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > CONTENT_MEDIA_MAX_ITEM_BYTES) {
    return { ok: false, code: "MEDIA_TOO_LARGE", error: `مادة الفيديو أكبر من الحد (${Math.floor(CONTENT_MEDIA_MAX_ITEM_BYTES / 1048576)}MB).` };
  }
  const bytes = decodeStrictBase64(base64);
  if (!bytes) return { ok: false, code: "MEDIA_INVALID", error: "base64 غير صالح (نص مزيف أو مشوّه)." };
  const validation = validateMediaBytes(bytes, input.mimeType, input.filename);
  if (!validation.ok) return { ok: false, code: validation.code, error: validation.error };
  const effectiveMime = CONTENT_ALLOWED_MIME.has(String(input.mimeType || "").toLowerCase().split(";")[0].trim())
    ? String(input.mimeType).toLowerCase().split(";")[0].trim() : "video/mp4";
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const mediaRef = `m-${sha256.slice(0, 16)}`;
  const prev = contentMedia.get(mediaRef);
  if (prev) contentMediaTotalBytes -= prev.bytes;
  contentMedia.set(mediaRef, { mimeType: effectiveMime, base64, bytes: bytes.length, sha256, createdAt: new Date().toISOString() });
  contentMediaTotalBytes += bytes.length;
  // تقييد الحجم الإجمالي: نحذف الأقدم عند التجاوز.
  while (contentMediaTotalBytes > CONTENT_MEDIA_MAX_TOTAL_BYTES && contentMedia.size > 1) {
    const oldest = [...contentMedia.entries()].sort((a, b) => String(a[1].createdAt).localeCompare(String(b[1].createdAt)))[0];
    if (!oldest) break;
    contentMediaTotalBytes -= oldest[1].bytes;
    contentMedia.delete(oldest[0]);
  }
  return { ok: true, mediaRef, bytes: bytes.length, mimeType: effectiveMime };
}

function contentMediaBytes(mediaRef: string): { bytes: Buffer; mimeType: string } | null {
  const m = contentMedia.get(String(mediaRef || ""));
  if (!m) return null;
  try { return { bytes: Buffer.from(m.base64, "base64"), mimeType: m.mimeType }; } catch { return null; }
}

function buildContentMediaState() {
  return { totalBytes: contentMediaTotalBytes, items: [...contentMedia.entries()].map(([ref, m]) => ({ ref, ...m })) };
}
function applyContentMediaState(raw: any): void {
  contentMedia = new Map();
  contentMediaTotalBytes = 0;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return;
  for (const it of raw.items) {
    if (!it?.ref || typeof it.base64 !== "string") continue;
    contentMedia.set(String(it.ref), { mimeType: String(it.mimeType || "video/mp4"), base64: it.base64, bytes: Number(it.bytes) || 0, sha256: String(it.sha256 || ""), createdAt: String(it.createdAt || new Date().toISOString()) });
    contentMediaTotalBytes += Number(it.bytes) || 0;
  }
}

/** يسجّل حدثاً في تاريخ عنصر المحتوى (تدقيق مصغّر بلا سرّ). */
function pushContentHistory(item: ContentQueueItem, entry: { action: string; actor: string; detail?: string | null; externalVideoId?: string | null; result?: string | null }): void {
  item.history.unshift({ at: new Date().toISOString(), action: entry.action, actor: entry.actor, detail: entry.detail ?? null, externalVideoId: entry.externalVideoId ?? null, result: entry.result ?? null });
  if (item.history.length > 100) item.history.length = 100;
}

/** لقطة طابور المحتوى للعرض (بلا أي سرّ). */
function contentQueueView() {
  const controls = normalizeWatcherControls(watcherState.controls);
  return contentQueue.slice(0, 500).map((it) => {
    const hasMedia = Boolean(it.mediaRef && contentMediaBytes(it.mediaRef));
    const mediaState = contentItemMediaState({ mediaRef: it.mediaRef, hasMedia });
    const terminal = isTerminalContentState(it.state);
    // العمليات المتاحة: تُحجب الموافقة/النشر/الجدولة بلا مادة حقيقية، وتُحجب كل
    // القرارات على الحالات النهائية (لا نقض) إلا التعديل.
    const baseActions: ContentReviewAction[] = terminal
      ? ["edit"]
      : filterContentActions(CONTENT_REVIEW_ACTIONS, hasMedia);
    // جاهزية قرار المالك المباشر: لا تعتمد على autoPublish/autoSchedule إطلاقاً،
    // ولا على humanReviewMode. تعتمد فقط على الحالة + المادة + Kill Switch.
    const manual = contentManualReadiness({ state: it.state, hasMedia, mediaRef: it.mediaRef, publishAt: it.publishAt }, controls);
    return {
      id: it.id, fingerprint: it.fingerprint, title: it.title, description: it.description, tags: it.tags,
      privacyStatus: it.privacyStatus, publishAt: it.publishAt, source: it.source,
      productId: it.productId,
      productName: it.productId ? (workspace.products || []).find((p: any) => p.id === it.productId)?.name ?? null : null,
      hasMedia, mediaState, mediaStateLabelAr: mediaState === "COMPLETE" ? "المادة جاهزة" : "المادة مطلوبة",
      mediaBytes: hasMedia ? contentMediaBytes(it.mediaRef)?.bytes.length ?? 0 : 0,
      mediaMimeType: hasMedia ? contentMediaBytes(it.mediaRef)?.mimeType ?? null : null,
      allowedActions: baseActions,
      allowedActionsLabelAr: baseActions.map((a) => CONTENT_REVIEW_ACTION_LABELS_AR[a]),
      // جاهزية القرار المباشر + الخصوصية المتوقعة لكل مسار (public للنشر، private للجدولة).
      canPublishNow: manual.canPublishNow, canSchedule: manual.canSchedule,
      publishBlockedCode: manual.publishBlockedCode, publishBlockedReason: manual.publishBlockedReason,
      scheduleBlockedCode: manual.scheduleBlockedCode, scheduleBlockedReason: manual.scheduleBlockedReason,
      publishPrivacyStatus: manual.publishPrivacyStatus, schedulePrivacyStatus: manual.schedulePrivacyStatus,
      scheduleRequiresPublishAt: manual.scheduleRequiresPublishAt,
      manualDependencyNote: "قرار المالك المباشر (نشر الآن/جدولة) لا يعتمد على autoPublish/autoSchedule ولا على humanReviewMode؛ يعتمد على الحالة + المادة + Kill Switch.",
      state: it.state, stateLabelAr: CONTENT_STATE_LABELS_AR[it.state], stateTone: CONTENT_STATE_TONES[it.state],
      stateReason: it.stateReason, code: it.code, sensitivity: it.sensitivity,
      externalVideoId: it.externalVideoId, url: it.url, verified: it.verified,
      verifiedVideoId: it.verifiedVideoId, verifiedPrivacyStatus: it.verifiedPrivacyStatus,
      verifiedDescription: it.verifiedDescription === true,
      descriptionPresent: String(it.description || "").trim().length > 0,
      createdAt: it.createdAt, updatedAt: it.updatedAt, reviewedBy: it.reviewedBy, reviewedAt: it.reviewedAt, reviewNote: it.reviewNote,
      history: it.history.slice(0, 10),
    };
  });
}

/** ملخص الطابور (أرقام حقيقية من نفس السجلات). */
function contentQueueSummary() {
  return summarizeContentQueue(contentQueue.map((i) => ({ state: i.state, publishAt: i.publishAt, verified: i.verified, externalVideoId: i.externalVideoId, verifiedVideoId: i.verifiedVideoId })));
}

/**
 * النسخة العامة الآمنة من ملخص طابور المحتوى.
 *
 * السبب: /api/health و/api/readiness عامتان، وكانتا تُعلنان توزيع الحالات التفصيلي
 * (byState) وحجم الوسائط المخزّنة بالأرقام. يُكتفى هنا بالإجماليات العاملة: إذا كان
 * الطابور فارغاً فلا شيء يُعرَض، وإلا يُعلن حجم العمل غير المحسوم (بانتظار مراجعة/
 * صادر) وعدد المجدول/المنشور — أرقام تشغيلية عامة بلا تفاصيل ولا حجم وسائط.
 * التفاصيل والحالات الكاملة للمالك عبر /api/platforms/youtube/content/queue.
 */
function contentQueueSummaryPublic(full: ReturnType<typeof contentQueueSummary>) {
  if (!full || full.total === 0) return { total: 0, note: "لا محتوى في الطابور." };
  return {
    total: full.total,
    awaitingReview: full.awaitingReview,
    scheduled: full.scheduled,
    published: full.published,
    failed: full.failed,
    note: "طابور المحتوى: إجماليات عامة فقط؛ التفاصيل للمالك عبر /api/platforms/youtube/content/queue.",
  };
}

/** يحوّل `publishAt` (جدار محلي بغدادي أو لحظة ISO) إلى epoch صالح للفحص. */
function contentPublishAtEpoch(value: string | null): number {
  if (!value) return NaN;
  const wall = wallClockToEpoch(value);
  return Number.isFinite(wall) ? wall : Date.parse(value);
}

/**
 * فحص **قراءة فقط** لعناصر الطابور المجدولة التي حلّ موعدها: يقرأ حالة كل فيديو
 * الحقيقية من YouTube (videos.list) ويُحدّث العنصر وفق الدليل الفعلي:
 * - `public` فعلاً ⇒ VERIFIED مع معرّف الفيديو ووقت التحقق (لا ادعاء بلا دليل).
 * - `private`/`unlisted` بعد الموعد ⇒ يبقى SCHEDULED بسبب صريح (لم يصبح عاماً بعد).
 * - تعذّر القراءة/الفيديو غير موجود ⇒ يبقى SCHEDULED بسبب صريح بلا اختراع حالة.
 * لا يستهلك AI ولا يُنشئ حالة بلا قراءة مزود. يعمل داخل دورة المراقبة الدائمة.
 */
async function verifyDueScheduledContent(): Promise<{ checked: number; verified: number; stillPrivate: number; unreadable: number }> {
  const result = { checked: 0, verified: 0, stillPrivate: 0, unreadable: 0 };
  const guard = youtubeOperationGuard();
  if (!guard.ok) return result;
  const now = Date.now();
  const due = contentQueue.filter((it) =>
    it.state === "SCHEDULED" && it.externalVideoId &&
    Number.isFinite(contentPublishAtEpoch(it.publishAt)) && contentPublishAtEpoch(it.publishAt) <= now,
  ).slice(0, 10);
  if (!due.length) return result;
  const ensured = await ensureYouTubeAccessToken();
  if (!ensured.ok || !ensured.token) return result;
  let changed = false;
  for (const item of due) {
    result.checked += 1;
    const externalVideoId = String(item.externalVideoId);
    try {
      const fetched = await youtubeClient().getVideos(ensured.token, [externalVideoId]);
      const row = fetched.ok && fetched.data?.length === 1 ? fetched.data[0] : null;
      const actual = row ? (row.privacyStatus ?? null) : null;
      const verdict = evaluateDueScheduledContent(item, contentPublishAtEpoch(item.publishAt), actual, now);
      if (!verdict) continue;
      if (verdict.action === "verify") {
        item.state = verdict.state;
        item.verified = true;
        item.verifiedVideoId = externalVideoId;
        item.verifiedPrivacyStatus = "public";
        item.stateReason = verdict.reason;
        item.code = verdict.code;
        item.updatedAt = new Date().toISOString();
        pushContentHistory(item, { action: "verified", actor: "system", detail: verdict.reason, externalVideoId, result: "ok_verified" });
        logYouTubeOperation("scheduled_verified_public", { externalId: externalVideoId, outcome: "public", errorCode: null, durationMs: 0, actor: "system" });
        result.verified += 1;
        changed = true;
      } else {
        item.stateReason = verdict.reason;
        item.code = verdict.code;
        item.updatedAt = new Date().toISOString();
        if (verdict.action === "unreadable") result.unreadable += 1; else result.stillPrivate += 1;
        changed = true;
      }
    } catch {
      result.unreadable += 1;
    }
  }
  if (changed) await persistWatcherState();
  return result;
}

/**
 * رصد تفاعل المتابعة على الردود المُسلَّمة (قراءة فقط) — يُغلق حلقة التعلّم:
 * ACTION → RESULT → FOLLOW-UP ENGAGEMENT → LESSON → MEMORY → FUTURE DECISION.
 * يقرأ الإعجابات/الردود الحقيقية من `commentThreads.list`، ويثبّت بصمة أولى، ثم
 * يكشف تغيّراً حقيقياً فقط. **لا يخترع قيمة**، وإن تعذّرت القراءة لا يُعلن تغيّراً.
 * النتيجة تُكتب في **نفس** الذاكرة طويلة المدى عبر `recordReadOutcome`.
 */
async function sweepFollowUpEngagement(): Promise<{ checked: number; baselined: number; changed: number; unreadable: number }> {
  const result = { checked: 0, baselined: 0, changed: 0, unreadable: 0 };
  const guard = youtubeOperationGuard();
  if (!guard.ok) return result;
  const now = Date.now();
  const candidates = selectFollowUpCandidates(watcherState.processed, now, { limit: 5, baselineDelayMs: followUpBaselineDelayMsFromEnv() });
  if (!candidates.length) return result;
  const videoIds = [...new Set(candidates.map((c) => String(c.videoId || '')).filter(Boolean))].slice(0, commentScanVideoLimitFromEnv());
  if (!videoIds.length) return result;
  const res = await buildAgentToolContext("system", "system").youtubeComments(videoIds);
  if (!res.ok) return result;
  const byId = new Map<string, any>((res.comments || []).map((c: any) => [String(c.commentId), c]));
  let changed = false;
  for (const entry of candidates) {
    result.checked += 1;
    const live = byId.get(String(entry.commentId));
    if (!live) { result.unreadable += 1; continue; }
    const verdict = evaluateFollowUpEngagement(entry, { likes: live.likeCount ?? null, replies: live.replyCount ?? null }, now);
    if (verdict.baseline) {
      entry.followUpBaseline = verdict.baseline;
      result.baselined += 1;
      changed = true;
    }
    if (verdict.outcome) {
      entry.followUpOutcome = verdict.outcome;
      changed = true;
      if (verdict.outcome.kind === 'engagement_changed') {
        result.changed += 1;
        recordReadOutcome({
          id: `yt-followup:${String(entry.commentId)}`, platform: 'youtube', kind: 'engagement_changed',
          summary: `تفاعل متابعة على رد مُسلَّم (+${verdict.outcome.likesDelta} إعجاب، +${verdict.outcome.repliesDelta} رد).`,
          // العيّنة = العدد الحقيقي المتراكم لتغيّرات التفاعل المرصودة (لا قيمة ثابتة)،
          // فلا تُرقّى ملاحظة واحدة إلى معرفة دائمة قبل 3 رصدات. `entry` مُدرج فعلاً في
          // السجل و`followUpOutcome` مُثبَّت أعلاه، فالعيّنة تشمل الرصدة الحالية.
          source: 'platform_data:youtube-comments', sampleSize: watcherObservationCount('engagement_changed'),
          decisionId: decisionIdForEvent(`comment:${String(entry.commentId)}`),
        });
        watcherAudit({ action: "followup_engagement", commentId: String(entry.commentId), videoId: entry.videoId, decision: "observe", reason: verdict.note });
      } else {
        watcherAudit({ action: "followup_no_change", commentId: String(entry.commentId), videoId: entry.videoId, decision: "observe", reason: verdict.note });
      }
    }
  }
  if (changed) await persistWatcherState();
  return result;
}


const WATCHER_MAX_PROCESSED = 5000;
const WATCHER_MAX_AUDIT = 500;

/** يسجّل عملية أتمتة واحدة بلا أي سرّ (timestamp/source/action/معرّفات/قرار/نتيجة). */
function watcherAudit(entry: {
  action: string; commentId?: string | null; videoId?: string | null; reason?: string | null; decision?: string | null;
  generatedText?: string | null; sent?: boolean | null; providerId?: string | null; verification?: string | null;
  error?: string | null; actor?: string | null;
}): void {
  watcherState.audit.unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    source: "youtube_watcher",
    actor: entry.actor || "watcher",
    action: entry.action,
    commentId: entry.commentId || null,
    videoId: entry.videoId || null,
    reason: entry.reason || null,
    decision: entry.decision || null,
    generatedText: entry.generatedText || null,
    sent: entry.sent ?? null,
    providerId: entry.providerId || null,
    verification: entry.verification || null,
    error: entry.error || null,
  });
  if (watcherState.audit.length > WATCHER_MAX_AUDIT) watcherState.audit.length = WATCHER_MAX_AUDIT;
}

/** يحفظ حالة الـwatcher عبر المحوّل (تصمد بعد restart) — كتابة دائمة. */
async function persistWatcherState(): Promise<void> {
  if (!storageReady) return;
  try {
    await storageAdapter.write(WATCHER_STATE_KEY, {
      controls: watcherState.controls,
      processed: watcherState.processed.slice(0, WATCHER_MAX_PROCESSED),
      processedWindow: watcherState.processedWindow.slice(-2000),
      opportunities: watcherState.opportunities.slice(0, 200),
      audit: watcherState.audit.slice(0, WATCHER_MAX_AUDIT),
      lastPollAt: watcherState.lastPollAt,
      lastCommentId: watcherState.lastCommentId,
      lastCommentAt: watcherState.lastCommentAt,
      lastError: watcherState.lastError,
      consecutiveErrors: watcherState.consecutiveErrors,
      pollCount: watcherState.pollCount,
      brief: watcherState.brief,
      briefDate: watcherState.briefDate,
      lastScanned: watcherState.lastScanned,
      reviewOverrides: watcherState.reviewOverrides.slice(0, 5000),
      // PROC-01: القفل الدائم لدورة المراقبة (owner + انتهاء فقط، بلا سرّ).
      lease: watcherLease,
      // طابور المحتوى (نشر/جدولة/مراجعة) يُحفظ ضمن حالة الـwatcher فيصمد بعد restart.
      contentQueue: contentQueue.slice(0, CONTENT_QUEUE_MAX),
      contentMediaTotalBytes,
    });
  } catch (error: any) {
    lastPersistError = String(error?.code || error?.name || "persist_failed").slice(0, 60);
  }
}

/** يحفظ مخزن مادة الفيديو عبر المحوّل (يحفظ بايتات حقيقية حصراً). */
async function persistContentMedia(): Promise<void> {
  if (!storageReady) return;
  try { await storageAdapter.write(CONTENT_MEDIA_KEY, buildContentMediaState()); } catch { /* يُعلن خطأ الحفظ العام */ }
}

/** يسترجع حالة الـwatcher (بعد restart/cold start) — بلا طمس الحالة القائمة. */
function applyWatcherStateSnapshot(raw: any): void {
  if (!raw || typeof raw !== "object") return;
  watcherState.controls = normalizeWatcherControls(raw.controls);
  watcherState.processed = Array.isArray(raw.processed) ? raw.processed.filter((p: any) => p?.commentId).slice(0, WATCHER_MAX_PROCESSED) : [];
  watcherState.processedWindow = Array.isArray(raw.processedWindow) ? raw.processedWindow.filter((n: any) => Number.isFinite(n)).slice(-2000) : [];
  watcherState.opportunities = Array.isArray(raw.opportunities) ? raw.opportunities.slice(0, 200) : [];
  watcherState.audit = Array.isArray(raw.audit) ? raw.audit.slice(0, WATCHER_MAX_AUDIT) : [];
  watcherState.lastPollAt = typeof raw.lastPollAt === "string" ? raw.lastPollAt : null;
  watcherState.lastCommentId = typeof raw.lastCommentId === "string" ? raw.lastCommentId : null;
  watcherState.lastCommentAt = typeof raw.lastCommentAt === "string" ? raw.lastCommentAt : null;
  watcherState.lastError = typeof raw.lastError === "string" ? raw.lastError : null;
  watcherState.consecutiveErrors = Number.isFinite(raw.consecutiveErrors) ? Number(raw.consecutiveErrors) : 0;
  watcherState.pollCount = Number.isFinite(raw.pollCount) ? Number(raw.pollCount) : 0;
  watcherState.brief = raw.brief && typeof raw.brief === "object" ? raw.brief : null;
  watcherState.briefDate = typeof raw.briefDate === "string" ? raw.briefDate : null;
  watcherState.lastScanned = Number.isFinite(raw.lastScanned) ? Number(raw.lastScanned) : 0;
  watcherState.reviewOverrides = normalizeReviewOverrides(raw.reviewOverrides);
  // PROC-01: استرجاع القفل الدائم. قفل حيّ لمالك آخر يبقى محفوظاً فيمنع هذه
  // العملية من التزامن؛ أما المتقادم فيُبقى ليُستردّ عند أول دورة (لا جمود دائم).
  watcherLease = normalizeLease(raw.lease);
  // استرجاع طابور المحتوى: يصمد بعد restart/deploy فلا تُفقد الموافقات/الجدولة/الرفض.
  contentQueue = normalizeContentQueue(raw.contentQueue);
  // لو كان الرد الآلي ممكّناً أصلاً (مثلاً نُشِر الإصلاح بعد تمكينه)، تُحرَّر
  // التعليقات المؤجَّلة القديمة (التي تعذّرت سابقاً بسبب الإعداد) لإعادة تقييمها.
  const c = watcherState.controls;
  if (c.enabled && !c.paused && c.autoReply) {
    const r = releaseDeferredEntries(watcherState.processed);
    watcherState.processed = r.processed;
  }
  // ترميم غير حذفي: أي سجل قديم مُعالج بلا كود (أو بكود متناقض) يُمنح كوداً طرفياً
  // صريحاً — مع الحفاظ الكامل على السجل. يمنع بقاء أي «معالجة بلا قرار» في التاريخ.
  const repair = repairProcessedDecisionCodes(watcherState.processed);
  watcherState.processed = repair.entries;
}

/**
 * يطبّع طابور المحتوى المقروء من المخزن: يحصر الحالات على المفردات الرسمية،
 * ويُسقط العناصر بلا معرّف/بصمة، ويحافظ على الحقول بأمان. لا يختلق عناصر.
 */
function normalizeContentQueue(raw: any): ContentQueueItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ContentQueueItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    if (!r.id || typeof r.id !== "string") continue;
    const state = (CONTENT_STATES as readonly string[]).includes(String(r.state)) ? (String(r.state) as ContentState) : "DRAFT";
    out.push({
      id: String(r.id),
      fingerprint: typeof r.fingerprint === "string" ? r.fingerprint : "",
      title: typeof r.title === "string" ? r.title : "",
      description: typeof r.description === "string" ? r.description : "",
      tags: Array.isArray(r.tags) ? r.tags.map((t: any) => String(t)).filter(Boolean) : [],
      categoryId: typeof r.categoryId === "string" ? r.categoryId : YOUTUBE_DEFAULT_CATEGORY_ID,
      privacyStatus: typeof r.privacyStatus === "string" && r.privacyStatus ? r.privacyStatus : "public",
      publishAt: typeof r.publishAt === "string" ? r.publishAt : null,
      mediaRef: typeof r.mediaRef === "string" ? r.mediaRef : "",
      source: typeof r.source === "string" ? r.source : "owner",
      productId: typeof r.productId === "string" && r.productId ? r.productId : null,
      state,
      stateReason: typeof r.stateReason === "string" ? r.stateReason : "",
      code: typeof r.code === "string" ? r.code : "",
      sensitivity: typeof r.sensitivity === "string" ? r.sensitivity : "low",
      externalVideoId: typeof r.externalVideoId === "string" ? r.externalVideoId : null,
      url: typeof r.url === "string" ? r.url : null,
      // لا يُقبل ادعاء تحقق بلا دليل فعلي (معرّف مزود + حالة نشر/جدولة) عند التحميل.
      verified: isVerificationSubstantiated({
        verified: r.verified === true,
        externalVideoId: typeof r.externalVideoId === "string" ? r.externalVideoId : null,
        verifiedVideoId: typeof r.verifiedVideoId === "string" ? r.verifiedVideoId : null,
        state,
      }),
      verifiedVideoId: typeof r.verifiedVideoId === "string" ? r.verifiedVideoId : null,
      verifiedPrivacyStatus: typeof r.verifiedPrivacyStatus === "string" ? r.verifiedPrivacyStatus : null,
      verifiedDescription: r.verifiedDescription === true,
      createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
      updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : new Date().toISOString(),
      createdBy: typeof r.createdBy === "string" ? r.createdBy : "owner",
      reviewedBy: typeof r.reviewedBy === "string" ? r.reviewedBy : null,
      reviewedAt: typeof r.reviewedAt === "string" ? r.reviewedAt : null,
      reviewNote: typeof r.reviewNote === "string" ? r.reviewNote : null,
      history: Array.isArray(r.history) ? r.history.slice(0, 100) : [],
    });
  }
  return out.slice(0, CONTENT_QUEUE_MAX);
}

/**
 * الإيقاع الفعلي للجدولة (ميلي ثانية). مصدر الحقيقة هو إعداد المالك المحفوظ
 * (`controls.cadenceMinutes`، 1..5)، مع احترام Kill Switch (0 = لا فحص).
 * متغيّر البيئة `YOUTUBE_WATCHER_CADENCE_MS` يبقى احتياطياً فقط عند غياب الإعداد.
 */
function watcherCadenceMs(): number {
  const c = normalizeWatcherControls(watcherState.controls);
  if (c.enabled && c.paused) return 0;
  const hasOwnerSetting = typeof (watcherState.controls as any)?.cadenceMinutes === 'number';
  if (hasOwnerSetting) return cadenceMinutesToMs(c.cadenceMinutes);
  return normalizeCadenceMs(process.env.YOUTUBE_WATCHER_CADENCE_MS ?? null);
}

/** هل حان وقت الفحص وفق الإيقاع الحالي؟ Kill Switch ⇒ لا فحص. */
function watcherPollDue(): boolean {
  const cadence = watcherCadenceMs();
  if (cadence <= 0) return false;
  return isPollDue(watcherState.lastPollAt, Date.now(), cadence);
}

/** هل يمكن للـwatcher تنفيذ الرد فعلياً الآن؟ (مصدر الحقيقة الوحيد للحكم). */
function watcherReplyExecutionReady(): { ready: boolean; code?: string; reason?: string } {
  const g = youtubeOperationGuard();
  if (!g.ok) return { ready: false, code: g.code, reason: g.error };
  if (!youtubeForceSslGranted()) return { ready: false, code: "SCOPE_UPGRADE_REQUIRED", reason: "إعادة ربط YouTube مطلوبة (force-ssl)." };
  const d = youtubeDelegationCheck("system", { toolId: "youtube_reply", args: {} });
  if (!d.allowed) return { ready: false, code: d.code || "DELEGATION_REQUIRED", reason: d.reason };
  return { ready: true };
}

/**
 * دورة مراقبة واحدة: تقرأ أحدث الفيديوهات والتعليقات الحقيقية، تعالج كل تعليق
 * جديد (تجاهل/تصعيد/رد حقيقي)، وتحفظ الحالة. **لا تختلق تعليقاً ولا رداً**،
 * ولا تُعلن نجاحاً بلا معرّف رد من YouTube. لا تفقد شيئاً عند الانقطاع: التقدّم
 * يُحفظ بعد كل معالجة، وكل تعليق معلّق يُعالَج في الدورة التالية.
 */
async function runYouTubeWatcherCycle(trigger: "schedule" | "manual" = "schedule"): Promise<{ ok: boolean; error?: string; [k: string]: any }> {
  if (watcherRunning) return { ok: false, error: "دورة مراقبة قيد التنفيذ." };
  // PROC-01: القفل الدائم يمنع التزامن عبر العمليات. قفل حيّ لغيري ⇒ تخطٍّ بلا عمل.
  const leaseRes = acquireLease(watcherLease, { owner: WATCHER_LEASE_OWNER, nowMs: Date.now(), ttlMs: WATCHER_LEASE_TTL_MS });
  if (!leaseRes.acquired) {
    return { ok: true, skippedPoll: true, reason: "lease_held_elsewhere", newDetected: 0, replied: 0, escalated: 0, skipped: 0, verified: 0, failed: 0 };
  }
  watcherLease = leaseRes.lease;
  watcherRunning = true;
  // نُثبّت القفل دائماً **قبل** أي عمل، فتقرأه أي عملية أخرى فوراً (لا تزامن).
  try { await persistWatcherState(); } catch { /* يبقى الحارس الذاكري فعّالاً داخل العملية */ }
  const now = Date.now();
  let newDetected = 0, replied = 0, escalated = 0, skipped = 0, verified = 0, failed = 0, deferred = 0;
  try {
    const controls = normalizeWatcherControls(watcherState.controls);
    const readGate = watcherGate(controls, "read");
    if (!readGate.allowed) {
      watcherState.lastPollAt = new Date(now).toISOString();
      watcherAudit({ action: "poll_skipped", reason: readGate.reason, decision: readGate.code });
      await persistWatcherState();
      return { ok: true, skippedPoll: true, gate: readGate.code, newDetected, replied, escalated, skipped, verified, failed };
    }
    const guard = youtubeOperationGuard();
    if (!guard.ok) {
      watcherState.lastError = guard.code || "CONNECTOR_NOT_READY";
      watcherState.consecutiveErrors += 1;
      watcherState.lastPollAt = new Date(now).toISOString();
      watcherAudit({ action: "poll_error", error: watcherState.lastError, reason: guard.error });
      maybeAlertWatcherFailure();
      await persistWatcherState();
      return { ok: false, error: guard.error, code: guard.code, newDetected, replied, escalated, skipped, verified, failed };
    }
    const videosRes = await youtubeClient().listMyVideos((await ensureYouTubeAccessToken()).token!, {
      uploadsPlaylistId: String(youtubeStoredCredentials()?.uploadsPlaylistId || ""), maxResults: 25,
    });
    if (!videosRes.ok || !videosRes.data) {
      watcherState.lastError = String(videosRes.code || "VIDEO_LIST_FAILED");
      watcherState.consecutiveErrors += 1;
      watcherState.lastPollAt = new Date(now).toISOString();
      watcherAudit({ action: "poll_error", error: watcherState.lastError, reason: videosRes.error });
      maybeAlertWatcherFailure();
      await persistWatcherState();
      return { ok: false, error: videosRes.error, code: videosRes.code, newDetected, replied, escalated, skipped, verified, failed };
    }
    const videoIds = videosRes.data.videos.map((v: any) => v.videoId).filter(Boolean).slice(0, commentScanVideoLimitFromEnv());
    const commentsRes = await buildAgentToolContext("system", "system").youtubeComments(videoIds);
    if (!commentsRes.ok) {
      watcherState.lastError = String(commentsRes.code || "COMMENTS_FETCH_FAILED");
      watcherState.consecutiveErrors += 1;
      watcherState.lastPollAt = new Date(now).toISOString();
      watcherAudit({ action: "poll_error", error: watcherState.lastError, reason: commentsRes.error });
      maybeAlertWatcherFailure();
      await persistWatcherState();
      return { ok: false, error: commentsRes.error, code: commentsRes.code, newDetected, replied, escalated, skipped, verified, failed };
    }
    const comments: any[] = commentsRes.comments || [];
    const replyReady = watcherReplyExecutionReady();
    const storedYt = youtubeStoredCredentials();
    const expectedChannelId = String(storedYt?.channelId || "");
    // كشف حلقات الرد من حساب القناة نفسه: المعرّف الحقيقي للقناة المتصلة أولاً،
    // ثم الاسم/عنوان القناة المخزّنان، فأسماء المعرض المعروفة.
    const ownNames = [String(storedYt?.channelTitle || ""), String(workspace.showroom?.name || ""), "معرض الغرابي"].filter(Boolean);
    const history = ((workspace as any).socialReplies || []).map((r: any) => ({ externalId: r.externalId, replyFingerprint: r.replyFingerprint, repliedAt: r.repliedAt }));
    // قرارات المالك من مراجعة التقرير — تُطبَّق على القرار الحتمي (لا تُنقض).
    const overrideMap = watcherOverrideMap();
    const latestFirst = [...comments].sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
    const pendingBefore = latestFirst.filter((c) => !hasProcessed(watcherState.processed, c.commentId));
    const budget = Math.min(10, pendingBefore.length);
    let analysed = 0;
    for (const c of latestFirst) {
      if (analysed >= budget) break;
      if (hasProcessed(watcherState.processed, c.commentId)) continue;
      analysed += 1;
      newDetected += 1;
      // حساب القناة نفسه + التصنيف الحتمي + المقارنة الاستشارية — تُحسب **قبل**
      // قرار العقل المركزي لأن العقل يبنى على الأدلة الحقيقية (بما فيها السياق).
      const cls = classifyComment(String(c.text || ""));
      const alreadyReplied = history.some((h: any) => h.externalId === c.commentId);
      const commentVideoId = String(c.videoId || "");
      const belongsToChannel = !expectedChannelId || !commentVideoId || videoIds.includes(commentVideoId);
      // حساب القناة نفسه: بالمعرّف الحقيقي للقناة (أدق) أو بالاسم المخزّن.
      const selfAuthored = isSelfAuthored(c.authorName, ownNames)
        || Boolean(expectedChannelId && c.authorChannelId && String(c.authorChannelId) === expectedChannelId);
      // Priority #2: بيانات المنتج الحقيقية → مسار الرد. المنتج يُحسم بدليل صريح
      // من الفيديو (طابور محتوى منشور/سجل نشر مربوط بمنتج) لا من تخمين النص.
      // وجود منتج بسعر مسجّل + رد يجتاز حارس المحتوى ⇒ استفسار السعر يُرد من
      // بيانات المعرض بدل تصعيده. غياب الدليل يُبقي التصعيد كما كان.
      const videoProductRes = resolveYouTubeVideoProduct(c.videoId);
      const priceReply = verifiedProductFactsForReply({ product: videoProductRes.product, commentText: String(c.text || "") });
      const priceFactsVerified = priceReply.verified;
      // سبب التصعيد من التصنيف الحتمي الحقيقي (بلا اختراع). استفسار السعر مع
      // حقائق منتج موثّقة فعلاً لا يُصعَّد — يُرد من بيانات المعرض.
      const baseReason = escalationReasonFor({
        intent: cls.intent, isSpam: cls.isSpam,
        requiresHumanReview: cls.requiresHumanReview, topic: (cls as any).topic ?? null,
      });
      const preReason = (priceFactsVerified && baseReason === 'price_unverified') ? null : baseReason;
      // أفعال العقول الستة الحتمية: تصنيف التعليق عادي/إيجابي بقاعدة حتمية (بلا
      // Gemini). أي تصنيف غير عادي/إيجابي لا يُنفَّذ محلياً — الجلسة التالية (العقل
      // المركزي) هي سلطة القرار الوحيدة. كل فعل يُسجَّل في سجل التدقيق.
      try {
        await trySixAgentAction({
          agentId: 'analysis', action: 'classify_tag_comment', platform: 'youtube',
          commentId: String(c.commentId), commentText: String(c.text || ''),
          tag: cls.sentiment === 'positive' ? 'positive' : 'neutral',
        });
      } catch { /* فعل العقول الستة لا يُسقط دورة المراقبة */ }
      // فريق الوكلاء (Batch 6): حدث YouTube حقيقي => جلسة فريق واحدة (بلا تكرار،
      // بلا تنفيذ خارجي). تُشغَّل هنا داخل دورة المراقبة الدائمة. أي فشل لا يُسقط
      // الدورة (جلسة الفريق لا ترمي)، والقرار يُكتب في نفس ذاكرة العقل القائمة.
      // **Batch 8.1:** قرار العقل المركزي الناتج هنا هو سلطة التنفيذ الوحيدة.
      try {
        const teamResult = await runTeamSessionNow(
          "youtube_event",
          `تحليل تعليق YouTube جديد والبتّ في الرد عليه من الحقائق المسجّلة (بلا اختراع)`,
          "youtube",
          `comment:${String(c.commentId)}`,
          { externalId: String(c.commentId), commentText: String(c.text || ""), objective: "البتّ في رد آمن على تعليق YouTube من الحقائق المسجّلة", conversationId: `youtube::${String(c.videoId || 'thread')}`, escalationReason: preReason, priceFactsVerified },
        );
        // الطبقة الإدراكية (Batch 7): دورة فهم/تذكّر/تخطيط/تعلّم على نفس الحدث
        // والقرار المحكوم. **لا تنفيذ خارجي** ولا AI؛ تُحدِّث الذاكرة العاملة
        // وتخزّن التقرير. فشلها لا يُسقط دورة المراقبة.
        try {
          const bd = teamResult?.brainDecision || null;
          if (bd && teamResult.session) {
            const connYt = platformConnections.get('youtube');
            runCognitiveCycleNow({
              session: teamResult.session,
              decision: bd,
              platform: 'youtube',
              eventIdentity: `comment:${String(c.commentId)}`,
              eventText: String(c.text || ""),
              objective: "البتّ في رد آمن على تعليق YouTube من الحقائق المسجّلة",
              conversationId: `youtube::${String(c.videoId || 'thread')}`,
              externalId: String(c.commentId),
              escalationReason: preReason,
              replyCapable: capabilityRow('youtube').states.reply === 'AVAILABLE',
              publishCapable: capabilityRow('youtube').states.publish === 'AVAILABLE',
              providerVerified: Boolean(connYt && connYt.status === 'connected' && connYt.providerVerified),
              externalApproved: youtubeDelegationCheck('system', { toolId: 'youtube_reply', args: {} }).allowed === true,
            });
          }
        } catch { /* الدورة الإدراكية لا تُسقط دورة المراقبة */ }
      } catch { /* جلسة الفريق لا تُسقط دورة المراقبة */ }
      // سلطة القرار الوحيدة: قرار العقل المركزي (وليس تصنيفاً مستقلاً). يُقرأ من
      // الجلسة التي قرّرها العقل لهذا الحدث تماماً. غيابه ⇒ لا رد (أمان).
      const centralDecision = centralActionDecisionForEvent(`comment:${String(c.commentId)}`);
      // تصنيف استشاري (فحص سلامة التعليق — ليس قراراً) — يمنع الرد على سبام/نفس
      // الحساب/المُعالَج، ويصعّد الحساس. يبقى مصدر الأكواد التفصيلية.
      const advisory = decideCommentAction({
        intent: cls.intent, requiresHumanReview: cls.requiresHumanReview, isSpam: cls.isSpam,
        isSelfAuthored: selfAuthored, alreadyReplied, controls,
      });
      // القرار التنفيذي النهائي: مشتقّ من قرار العقل المركزي + الفحوص الاستشارية
      // + بوابة الأتمتة. لا يملك سلطة قرار مستقلة (Batch 8.1).
      const replyGate = watcherGate(controls, "reply");
      const decision = resolveCommentExecution({
        centralDecision: centralDecision ?? 'FAILED_SAFE',
        advisory,
        automationAllowed: replyGate.allowed,
        replyReady: replyReady.ready,
        belongsToChannel,
        isPraise: isSafeForAutoReply(cls.intent),
        humanReviewMode: Boolean(controls.humanReviewMode),
        centralEscalationReason: preReason,
        priceFactsVerified,
      });
      const baseEntry: WatcherProcessedEntry = {
        commentId: c.commentId, stage: "ANALYZED", action: decision.action, reason: decision.reason, code: decision.code,
        videoId: c.videoId ?? null, authorName: c.authorName ?? null, text: String(c.text || ""), at: new Date().toISOString(),
        publishedAt: c.publishedAt ?? null,
      };
      // قرار المالك من مراجعة التقرير يتقدّم على القرار الحتمي (لا يُنقض):
      // منع/تجاهل ⇒ لا رد، تصعيد ⇒ للمالك. (allow_reply/reprocess يعالجهما مسار المراجعة.)
      const ownerOverride = overrideMap[c.commentId];
      if (ownerOverride && !overrideForcesReply(ownerOverride)) {
        const forcedStage = overrideForcedStage(ownerOverride) || "SKIPPED";
        baseEntry.stage = forcedStage;
        baseEntry.action = forcedStage === "ESCALATED" ? "escalate" : "skip";
        baseEntry.reason = `قرار المالك من مراجعة التقرير: ${WATCHER_REVIEW_ACTION_LABELS_AR[ownerOverride.action]}.`;
        if (forcedStage === "ESCALATED") escalated += 1; else skipped += 1;
        watcherState.processed.unshift(baseEntry);
        if (watcherState.processed.length > WATCHER_MAX_PROCESSED) watcherState.processed.length = WATCHER_MAX_PROCESSED;
        watcherAudit({ action: "review_override_applied", commentId: c.commentId, videoId: c.videoId, reason: baseEntry.reason, decision: baseEntry.action, actor: ownerOverride.by });
        { const cp = advanceCheckpoint({ lastCommentId: watcherState.lastCommentId, lastCommentAt: watcherState.lastCommentAt }, c.commentId, c.publishedAt || baseEntry.at); watcherState.lastCommentId = cp.lastCommentId; watcherState.lastCommentAt = cp.lastCommentAt; }
        await persistWatcherState();
        continue;
      }
      // تعذّر بسبب إعداد المالك (الرد الآلي معطّل/موقوف): قرار غير نهائي. نُسجّله
      // موسوماً `deferred` (فيمنع التكرار داخل الدورة) لكنه ليس نهائياً — يُحرَّر
      // ويُعاد تقييمه تلقائياً عند تمكين الرد، فلا يُفقد أي تعليق قابل للرد.
      if (isDeferredDecision(decision.code)) {
        baseEntry.stage = "SKIPPED";
        baseEntry.deferred = true;
        deferred += 1;
        watcherState.processed.unshift(baseEntry);
        if (watcherState.processed.length > WATCHER_MAX_PROCESSED) watcherState.processed.length = WATCHER_MAX_PROCESSED;
        watcherAudit({ action: "comment_deferred", commentId: c.commentId, videoId: c.videoId, reason: decision.reason, decision: "defer", error: decision.code });
        await persistWatcherState();
        continue;
      }
      if (decision.action !== "reply") {
        baseEntry.stage = decision.action === "escalate" ? "ESCALATED" : "SKIPPED";
        if (decision.action === "escalate") escalated += 1; else skipped += 1;
        watcherState.processed.unshift(baseEntry);
        watcherAudit({ action: decision.action === "escalate" ? "comment_escalated" : "comment_skipped", commentId: c.commentId, videoId: c.videoId, reason: decision.reason, decision: decision.action });
        { const cp = advanceCheckpoint({ lastCommentId: watcherState.lastCommentId, lastCommentAt: watcherState.lastCommentAt }, c.commentId, c.publishedAt || baseEntry.at); watcherState.lastCommentId = cp.lastCommentId; watcherState.lastCommentAt = cp.lastCommentAt; }
        await persistWatcherState();
        continue;
      }
      // الرد الحقيقي: قرار العقل المركزي (ALLOWED_ACTION) + بوابات التنفيذ مكتملة
      // (فُحصت داخل resolveCommentExecution). يمر بنفس executeYouTubeReply (كل
      // البوابات). دفاع مزدوج: إعادة فرض بوابة الأتمتة عند نقطة التنفيذ نفسها.
      const replyGateFinal = watcherGate(controls, "reply");
      if (!replyReady.ready || !replyGateFinal.allowed) {
        const code = !replyGateFinal.allowed ? replyGateFinal.code : (replyReady.code || "REPLY_NOT_READY");
        baseEntry.stage = "ESCALATED";
        baseEntry.code = "ESCALATE_REPLY_NOT_READY";
        baseEntry.reason = `الرد غير ممكن الآن: ${!replyGateFinal.allowed ? replyGateFinal.reason : (replyReady.reason || replyReady.code)}`;
        escalated += 1;
        watcherState.processed.unshift(baseEntry);
        watcherAudit({ action: "reply_blocked", commentId: c.commentId, videoId: c.videoId, reason: baseEntry.reason, decision: "escalate", error: code });
      } else {
        // بيانات المنتج الحقيقية: إن كان التعليق استفسار سعر وللفيديو منتج موثّق
        // بسعر مسجّل، يُرد من بيانات المعرض (والحارس يقرّه)؛ وإلا القالب العراقي العام.
        const replyText = priceReply.verified ? priceReply.replyText : watcherIraqiReply(String(c.text || ''));
        const result = await executeYouTubeReply({ commentId: String(c.commentId), text: replyText, commentText: String(c.text || ""), productId: priceReply.verified ? String(priceReply.product?.id || "") : "" }, "watcher");
        const delivered = Boolean(result.body?.delivered && result.body?.externalReplyId);
        if (delivered) {
          replied += 1;
          baseEntry.stage = "REPLIED"; baseEntry.replyText = replyText; baseEntry.externalReplyId = String(result.body.externalReplyId);
          baseEntry.reason = "أُرسل الرد الحقيقي وردّ YouTube بمعرّف رد.";
          watcherAudit({ action: "reply_sent", commentId: c.commentId, videoId: c.videoId, reason: baseEntry.reason, decision: "reply", generatedText: replyText, sent: true, providerId: String(result.body.externalReplyId), verification: String(result.body.state || "sent") });
          // التحقق الحقيقي من التسليم من سجل الردود الفعلي (بلا إرسال ثانٍ).
          const vr = await buildAgentToolContext("system", "system").youtubeReplyVerify({ commentId: String(c.commentId), externalReplyId: String(result.body.externalReplyId) });
          if (vr.real) { verified += 1; baseEntry.stage = "VERIFIED"; baseEntry.reason = "تم التحقق من تسجيل الرد المُسلَّم."; }
          else { baseEntry.reason = "أُرسل الرد لكن لم يُثبَّت التحقق من سجل التسليم."; }
          // إغلاق حلقة التعلّم: نتيجة ملاحَظة حقيقية (رد مُسلَّم) — بلا ادعاء بيع.
          // العيّنة = العدد الحقيقي المتراكم للردود المُسلَّمة: ردود الدورات السابقة
          // (من السجل) + ردود هذه الدورة حتى الحالي (`replied` يزيد قبل السجل). لا
          // قيمة ثابتة، فلا تُرقّى ملاحظة واحدة إلى معرفة دائمة قبل 3 ردود فعلية.
          recordReadOutcome({ id: `yt-reply-sent:${String(c.commentId)}`, platform: 'youtube', kind: 'response_received', summary: `أُرسل رد على تعليق YouTube ووصل المزود بمعرّف (${vr.real ? 'مُتحقَّق' : 'غير مُتحقَّق'}).`, source: 'platform_data:youtube-replies', sampleSize: watcherObservationCount('response_received') + replied, decisionId: decisionIdForEvent(`comment:${String(c.commentId)}`), providerReplyId: String(result.body.externalReplyId) });
        } else {
          failed += 1;
          baseEntry.stage = "FAILED";
          baseEntry.reason = `فشل إرسال الرد: ${result.body?.code || result.status}`;
          watcherAudit({ action: "reply_failed", commentId: c.commentId, videoId: c.videoId, reason: baseEntry.reason, decision: "fail", sent: false, error: String(result.body?.code || result.status) });
          // إغلاق حلقة التعلّم: إخفاق حقيقي يُستدعى لاحقاً حتى لا تُعاد التجربة بلا سبب.
          // العيّنة = العدد الحقيقي المتراكم لإخفاقات الردود: إخفاقات الدورات السابقة
          // (من السجل) + إخفاقات هذه الدورة حتى الحالي (`failed` يزيد قبل السجل).
          recordReadOutcome({ id: `yt-reply-failed:${String(c.commentId)}`, platform: 'youtube', kind: 'no_change', summary: `فشل إرسال رد على تعليق YouTube (${String(result.body?.code || result.status)}).`, source: 'platform_data:youtube-reply-failures', sampleSize: watcherObservationCount('no_change') + failed, decisionId: decisionIdForEvent(`comment:${String(c.commentId)}`) });
        }
      }
      watcherState.processed.unshift(baseEntry);
      if (watcherState.processed.length > WATCHER_MAX_PROCESSED) watcherState.processed.length = WATCHER_MAX_PROCESSED;
    { const cp = advanceCheckpoint({ lastCommentId: watcherState.lastCommentId, lastCommentAt: watcherState.lastCommentAt }, c.commentId, c.publishedAt || baseEntry.at); watcherState.lastCommentId = cp.lastCommentId; watcherState.lastCommentAt = cp.lastCommentAt; }
      await persistWatcherState();
    }
    watcherState.lastScanned = videoIds.length;
    // فحص المجدولات التي حلّ موعدها (قراءة فقط من المزود) — يُغلق دورة
    // SCHEDULED → VERIFIED بدليل حقيقي بلا ادعاء، داخل نفس الدورة الدائمة.
    const scheduledCheck = await verifyDueScheduledContent();
    // رصد تفاعل المتابعة على الردود المُسلَّمة (قراءة فقط) — يُغلق حلقة التعلّم.
    // فشله لا يُسقط دورة المراقبة.
    let followUp: { checked: number; baselined: number; changed: number; unreadable: number } | null = null;
    try { followUp = await sweepFollowUpEngagement(); } catch { followUp = null; }
    watcherState.lastPollAt = new Date(now).toISOString();
    watcherState.pollCount += 1;
    watcherState.consecutiveErrors = 0;
    watcherState.lastError = null;
    // أول دورة ناجحة ⇒ الاتصال عاد: نُصفّر علم تنبيه الفشل المتكرر (ليُنبَّه مجدداً لو تكرّر).
    clearWatcherFailureAlert();
    // وقراءة ناجحة تعني أن الرمز صالح فعلاً ⇒ نُصفّر علم تنبيه reauth أيضاً.
    clearYouTubeReauthAlert();
    watcherState.processedWindow = [...watcherState.processedWindow, now].slice(-2000);
    // الفرص: أسئلة متكررة/قفزة تفاعل — تسجيل بلا تنفيذ.
    const questionCounts = new Map<string, number>();
    for (const p of watcherState.processed) {
      if (p.stage === 'SKIPPED' || p.stage === 'ESCALATED') continue;
      const t = String(p.text || '').trim();
      if (t && (p.action === 'reply' || p.action === 'escalate')) questionCounts.set(t, (questionCounts.get(t) || 0) + 1);
    }
    const repeated = [...questionCounts.entries()].filter(([, n]) => n >= 3).map(([text, count]) => ({ text, count }));
    const opps = detectOpportunities({ repeatedQuestions: repeated, newScanned: newDetected, previousScanned: 0, now });
    if (opps.length) {
      for (const o of opps) if (!watcherState.opportunities.some((x) => x.id === o.id)) watcherState.opportunities.unshift(o);
      watcherState.opportunities = watcherState.opportunities.slice(0, 200);
    }
    watcherLastRun = { newDetected, replied, escalated, skipped, verified, failed, deferred, at: new Date(now).toISOString() };
    watcherAudit({ action: "poll_complete", reason: trigger, decision: "ok" });
    await persistWatcherState();
    return { ok: true, newDetected, replied, escalated, skipped, verified, failed, deferred, scheduledCheck, followUp };
  } catch (error: any) {
    watcherState.lastError = String(error?.code || error?.message || "watcher_cycle_failed").slice(0, 120);
    watcherState.consecutiveErrors += 1;
    watcherState.lastPollAt = new Date(now).toISOString();
    watcherAudit({ action: "poll_error", error: watcherState.lastError });
    maybeAlertWatcherFailure();
    await persistWatcherState();
    return { ok: false, error: watcherState.lastError, newDetected, replied, escalated, skipped, verified, failed };
  } finally {
    watcherRunning = false;
    // PROC-01: نُفرج القفل الدائم (مالكنا فقط) ونثبّت الإفراج قبل نهاية الدورة.
    watcherLease = releaseLease(watcherLease, WATCHER_LEASE_OWNER).lease;
    try { await persistWatcherState(); } catch { /* الإفراج الذاكري يكفي داخل العملية */ }
  }
}

/** لقطة حالة المراقبة الكاملة للواجهة/الصحة (بلا أي سرّ). */
function watcherStatusBlock() {
  const controlsView = watcherControlsView(watcherState.controls);
  const cadence = controlsView.cadenceMs && controlsView.cadenceMs > 0 ? controlsView.cadenceMs : watcherCadenceMs();
  const processed = watcherState.processed;
  const now = Date.now();
  // الزخم من زمن نشر التعليق الحقيقي (publishedAt) لا من وقت معالجتنا، مع fallback
  // إلى وقت المعالجة فقط إن غاب الزمن الحقيقي. حجم العيّنة يُعلن صراحةً.
  const velocity = computeCommentVelocity(processed.map((p) => p.publishedAt || p.at), now);
  const peakHours = computePeakHours(processed.map((p) => p.publishedAt));
  const stageCount = (s: YouTubeCommentStage) => processed.filter((p) => p.stage === s).length;
  // عدّادات حقيقية لكل الأنظمة (لا تُصفَّر مع نافذة الـ24 ساعة).
  const counters = {
    detected: processed.length,
    replied: stageCount("REPLIED") + stageCount("VERIFIED"),
    verified: stageCount("VERIFIED"),
    escalated: stageCount("ESCALATED"),
    skipped: stageCount("SKIPPED"),
    failed: stageCount("FAILED"),
    deferred: processed.filter((p) => p.deferred).length,
  };
  const lastReply = processed.find((p) => p.externalReplyId) || null;
  const lastVerified = processed.find((p) => p.stage === "VERIFIED") || null;
  const lastPublish = ((workspace as any).publishRecords || []).find((r: any) => r.platform === "youtube") || null;
  const attentionIds = new Set(processed.filter((p) => p.stage === "ESCALATED").map((p) => p.commentId));
  const attention = processed.filter((p) => p.stage === "ESCALATED").slice(0, 50).map((p) => ({
    commentId: p.commentId, videoId: p.videoId, authorName: p.authorName, text: p.text, reason: p.reason, at: p.at,
  }));
  return {
    watcherActive: Boolean(watcherState.controls.enabled && !watcherState.controls.paused && watcherScheduler?.status().active),
    // PROC-01: حالة القفل الدائم (منطقية فقط: محتجز؟ متقادم؟ بلا أي سرّ).
    lease: { held: Boolean(watcherLease), stale: watcherLease ? watcherLease.expiresAtMs <= Date.now() : false },
    controls: controlsView,
    cadenceMs: cadence,
    cadenceMinutes: controlsView.cadenceMinutes,
    cadenceEffectiveMinutes: controlsView.cadenceEffectiveMinutes,
    scheduler: watcherScheduler?.status() ?? { active: false, activeTimers: 0, cadenceMs: cadence, startedAt: null, reschedules: 0 },
    lastPollAt: watcherState.lastPollAt,
    nextPollAt: cadence > 0 ? nextPollAt(watcherState.lastPollAt, cadence) : null,
    pollCount: watcherState.pollCount,
    lastNewCommentAt: watcherState.lastCommentAt,
    lastCommentId: watcherState.lastCommentId,
    processedCount: processed.length,
    lastReply: lastReply ? { commentId: lastReply.commentId, externalReplyId: lastReply.externalReplyId, replyText: lastReply.replyText, at: lastReply.at } : null,
    lastVerifiedReply: lastVerified ? { commentId: lastVerified.commentId, at: lastVerified.at } : null,
    lastPublish: lastPublish ? { externalVideoId: lastPublish.externalVideoId || null, state: lastPublish.state, at: lastPublish.executedAt } : null,
    lastError: watcherState.lastError,
    consecutiveErrors: watcherState.consecutiveErrors,
    queueSize: 0,
    failedCount: processed.filter((p) => p.stage === "FAILED").length,
    escalatedCount: attentionIds.size,
    counters,
    attentionRequired: attention,
    velocity,
    peakHours,
    byStage: YOUTUBE_COMMENT_STAGES.reduce((acc: Record<string, number>, s) => { acc[s] = processed.filter((p) => p.stage === s).length; return acc; }, {}),
    opportunities: watcherState.opportunities.slice(0, 50),
    brief: watcherState.brief,
    lastRun: watcherLastRun,
    // حلقة التعلّم: تفاعل المتابعة على الردود المُسلَّمة (بلا ادعاء بيع).
    followUp: {
      baselined: processed.filter((p) => p.followUpBaseline).length,
      observed: processed.filter((p) => p.followUpOutcome).length,
      engagementChanged: processed.filter((p) => p.followUpOutcome?.kind === 'engagement_changed').length,
      noChange: processed.filter((p) => p.followUpOutcome?.kind === 'no_change').length,
      lastChanged: (processed.find((p) => p.followUpOutcome?.kind === 'engagement_changed')?.followUpOutcome) || null,
    },
    note: "مراقبة حقيقية لتعليقات YouTube — كل الحالات من سجلات فعلية، لا بيانات مُختلقة.",
  };
}

const WATCHER_PUBLIC_ERROR_MAX = 40;
/**
 * يحوّل آخر خطأ إلى رسالة عامة بلا محتوى عميل. رسائل دورة المراقبة أكواد تقنية
 * (ASCII: VIDEO_LIST_FAILED/…)، فإن خرجت عن ذلك (نص حر) تُستبدل برسالة عامة
 * ثابتة — فلا يمكن أن يمرّ نص تعليق أو اسم حساب إلى النقطة العامة.
 */
function watcherPublicError(err: unknown): string | null {
  if (typeof err !== 'string' || !err) return null;
  const token = err.trim().slice(0, WATCHER_PUBLIC_ERROR_MAX);
  return /^[A-Za-z0-9 _.:\-/]+$/.test(token) ? token : 'connection error';
}

/**
 * نسخة **عامة آمنة** من حالة المراقبة تُعرض في /api/health و/api/readiness.
 * هاتان النقطتان بلا مصادقة (لأدوات المراقبة مثل Render)، لذا تُعلنان الحقول
 * التقنية الدنيا فقط: حالة عامة (healthy/degraded/disabled)، النشاط، الإيقاع،
 * و**آخر خطأ كرمز تقني** — بلا أي عدّاد تفصيلي، وبلا اسم حساب أو نص تعليق أو رد.
 * العدّادات التفصيلية والمعرّفات (attentionRequired, lastReply, counters الكاملة,
 * opportunities, brief, followUp) تُقرأ من المسار المحمي بالمالك فقط:
 * /api/agent/youtube/watcher.
 */
function watcherStatusBlockPublic() {
  const full = watcherStatusBlock();
  // الحالة العامة مشتقة حتمياً من النشاط والأخطاء المتتالية والتفويض — بلا أرقام
  // تفصيلية. degraded = أخطاء متتالية حديثة أو تعطّل الرد الآلي؛ disabled = متوقّف.
  const consecutive = full.consecutiveErrors ?? 0;
  const status = !full.watcherActive
    ? "disabled"
    : consecutive > 0 || full.lastError
      ? "degraded"
      : "healthy";
  return {
    status,
    watcherActive: full.watcherActive,
    cadenceMinutes: full.cadenceMinutes,
    cadenceMs: full.cadenceMs,
    // pollCount: عدّاد تقني تراكمي لعدد دورات الفحص **الناجحة** منذ بدء القياس (يُحفظ
    // عبر محوّل الحالة فيصمد بعد restart). لا يتضمّن الدورات الفاشلة ولا يُصفَّر عند
    // إعادة التشغيل، فلا يصلح كمعدّل مباشر — للمعدّل استخدم lastPollAt + cadenceMs.
    // ليس مؤشراً تجارياً ولا يحمل أي بيانات عملاء، فيُعلن في النقطتين العامتين كمرقاب
    // حياة (liveness) للخدمة.
    pollCount: full.pollCount,
    lastPollAt: full.lastPollAt,
    lastError: watcherPublicError(full.lastError),
    consecutiveErrors: consecutive,
    note: "حالة عامة فقط؛ العدّادات التفصيلية وبيانات التعليقات/الردود متاحة للمالك عبر /api/agent/youtube/watcher.",
  };
}

/** تقرير YouTube اليومي الحتمي من السجلات الحقيقية (بلا استهلاك AI). */
function buildWatcherDailyBrief(): any {
  const processed = watcherState.processed;
  const now = Date.now();
  const recent = processed.filter((p) => Date.parse(p.at) >= now - WATCHER_BRIEF_WINDOW_MS);
  // الأرقام تُحسب من نفس المُحدِّدات المستخدمة في شاشة التفاصيل (مصدر واحد)
  // فيستحيل أن يختلف الرقم عن قائمة السجلات التي فتحها المالك.
  const counts = computeBriefCounts(processed, now);
  const sentiment = { positive: counts.positive, negative: counts.negative, neutral: recent.length - counts.positive - counts.negative };
  const questions = new Map<string, number>();
  for (const p of recent) {
    const cls = classifyComment(p.text);
    if (cls.intent === 'question' || cls.intent === 'business_inquiry') {
      const key = p.text.trim().slice(0, 120);
      questions.set(key, (questions.get(key) || 0) + 1);
    }
  }
  const topQuestions = [...questions.entries()].sort((a, b) => b[1] - a[1]).map(([text, count]) => ({ text, count }));
  const videos = ((workspace as any).youtubeLastAnalytics?.videos || []) as any[];
  const sorted = [...videos].sort((a, b) => Number(b.viewCount || 0) - Number(a.viewCount || 0));
  return buildDailyBrief({
    date: new Date().toISOString().slice(0, 10),
    newComments: counts.newComments,
    replies: counts.replies,
    skipped: counts.skipped,
    escalated: counts.escalated,
    verifiedReplies: counts.verifiedReplies,
    failedReplies: counts.failedReplies,
    sentiment,
    topQuestions,
    velocity: computeCommentVelocity(recent.map((p) => p.publishedAt || p.at), now),
    peakHours: computePeakHours(processed.map((p) => p.publishedAt)),
    videos: {
      total: videos.length,
      bestPerforming: sorted.slice(0, 3).map((v) => ({ videoId: v.videoId, title: v.title ?? null, metric: Number(v.viewCount || 0) })),
      weakPerforming: sorted.slice(-3).filter((v) => v && v.videoId).map((v) => ({ videoId: v.videoId, title: v.title ?? null, metric: Number(v.viewCount || 0) })),
    },
    attentionRequired: selectMetricEntries(processed, 'escalated', now).map((p) => ({ commentId: p.commentId, reason: p.reason, text: p.text })),
    sampleNotes: [`عيّنة اليوم: ${counts.newComments} تعليقاً حقيقياً من آخر 24 ساعة.`, videos.length ? `عدد الفيديوهات في أحدث قراءة: ${videos.length}.` : 'لم تُقرأ فيديوهات بعد.'],
  });
}

/** عناوين الفيديوهات من أحدث قراءة تحليلات (لعرض عنوان حقيقي بجانب التعليق). */
function watcherVideoTitles(): Record<string, string | null> {
  const videos = ((workspace as any).youtubeLastAnalytics?.videos || []) as any[];
  const map: Record<string, string | null> = {};
  for (const v of videos) if (v?.videoId) map[String(v.videoId)] = v.title ?? null;
  return map;
}

/** بطاقات التقرير اليومي (كل رقم + مسمّاه) — مصدر واحد للواجهة. */
function watcherBriefMetricsView(now: number) {
  return buildMetricViews(watcherState.processed, now).map((m) => ({ ...m, labelAr: m.labelAr }));
}

/** آخر override فعّال لكل تعليق (مصدر واحد عند القراءة والحساب). */
function watcherOverrideMap(): Record<string, WatcherReviewOverride> {
  return latestOverridesByComment(watcherState.reviewOverrides);
}

/** يبني السجلات التفصيلية لمجموعة سجلات (بلا تغيير أي حالة). */
function watcherDetailRecords(entries: WatcherProcessedEntry[]) {
  const titles = watcherVideoTitles();
  const overrides = watcherOverrideMap();
  return entries.map((e) => {
    const rec = toDetailRecord(e, { videoTitles: titles });
    const ov = overrides[e.commentId];
    return { ...rec, override: ov ? { action: ov.action, at: ov.at, by: ov.by } : null, overrideLabelAr: ov ? WATCHER_REVIEW_ACTION_LABELS_AR[ov.action] : null };
  });
}


/** صياغة الرد العراقي الحتمي للـwatcher (نفس صياغة العقل، بلا AI). */
function watcherIraqiReply(text: string): string {
  const cls = classifyComment(String(text || ""));
  return buildDeterministicReply(cls);
}

/**
 * حلقة المراقبة المستمرة (24/7): job داخلي يعمل داخل عملية Render الدائمة
 * (web process) مستقل تماماً عن المتصفح — إغلاق المتصفح/الهاتف لا يؤثر. كل
 * دورة تُنفَّذ إن حان وقتها وفق الإيقاع المضبوط، وتحفظ حالتها عبر المحوّل
 * (Postgres) فتصمد بعد restart/deploy. `.unref()` يمنع منع الخروج النظيف.
 */
function startYouTubeWatcher(): void {
  if (watcherScheduler) { watcherScheduler.start(); return; }
  watcherScheduler = createWatcherScheduler({
    setTimer: (fn, ms) => {
      const t = setInterval(fn, ms);
      (t as any).unref?.();
      return { clear: () => clearInterval(t) };
    },
    setTimeoutOnce: (fn, ms) => {
      const t = setTimeout(fn, ms);
      (t as any).unref?.();
      return { clear: () => clearTimeout(t) };
    },
    getCadenceMs: () => Math.max(1, watcherCadenceMs()),
    isDue: () => watcherPollDue(),
    runCycle: () => { runYouTubeWatcherCycle("schedule").catch(() => { /* الخطأ مسجَّل داخل الدورة */ }); },
  });
  // Kill Switch عند الإقلاع: لا نبضات. تُستأنف عند رفع الإيقاف من الواجهة.
  const c = normalizeWatcherControls(watcherState.controls);
  if (c.enabled && c.paused) {
    watcherScheduler.stop();
    return;
  }
  watcherScheduler.start();
}

/**
 * يُعيد جدولة الـwatcher بالإيقاع الجديد بلا تكرار: يُبطل المؤقّت القديم ويُنشئ
 * واحداً جديداً. Kill Switch ⇒ يوقف الجدولة كلياً (لا نبضات). إن كان متوقفاً
 * ويعود مفعّلاً ⇒ يبدأ الجدولة من جديد.
 */
function applyWatcherCadence(): { activeTimers: number; cadenceMs: number; active: boolean } {
  if (!watcherScheduler) startYouTubeWatcher();
  const c = normalizeWatcherControls(watcherState.controls);
  if (c.enabled && c.paused) {
    watcherScheduler?.stop();
    return { activeTimers: 0, cadenceMs: 0, active: false };
  }
  const r = watcherScheduler!.reschedule();
  return { ...r, active: true };
}

// --- مسارات التحكم بالمراقبة (Owner Controls + Kill Switch) — للمالك فقط ---
app.get("/api/agent/youtube/watcher", requireOwner, (_req, res) => {
  res.json({ success: true, watcher: watcherStatusBlock() });
});

// ربط قراءة-فقط: هل ينتج تفاعل YouTube مبيعات موثّقة؟ (Point 3)
// لا تنفيذ ولا كتابة ولا استنتاج سببية/ROI — فقط مطابقة صريحة بمعرّف منتج مسجّل
// على الطرفين + نافذة زمنية، وكل ما لا يمكن إثباته يُعلن صراحةً.
app.get("/api/agent/youtube/sales-correlation", requireOwner, (_req, res) => {
  const products = ((workspace as any).products || []) as any[];
  const productNamesById = new Map<string, string>(products.map((p: any) => [String(p.id), String(p.name || "")]));
  const correlation = buildYouTubeSalesCorrelation({
    comments: (((workspace as any).socialComments || []) as any[]),
    sales: ((workspace.sales || []) as any[]),
    productNamesById,
    now: Date.now(),
  });
  res.json({ success: true, correlation });
});

// تفاصيل حارس حصة YouTube Data API — للمالك فقط. النقطتان العامتان تعلنان الحالة
// المجملة فقط (youtubeQuotaStatusSummary)، والتفاصيل التشغيلية الكاملة هنا.
app.get("/api/agent/youtube/quota", authenticateToken, (_req, res) => {
  res.json({ success: true, quota: youtubeQuotaStatusSnapshot() });
});

app.post("/api/agent/youtube/watcher/controls", requireOwner, async (req, res) => {
  const body = req.body || {};
  const prevControls = normalizeWatcherControls(watcherState.controls);
  // الفاصل (الدقائق): تحقق صريح على الخادم — نفس حدود الواجهة، ورفض بأي طريقة
  // تجاوزت الواجهة. لا يُطبَّق أي تغيير على الفاصل إن كانت القيمة غير صالحة.
  if (body.cadenceMinutes !== undefined || body.cadenceMs !== undefined) {
    const requested = body.cadenceMinutes !== undefined ? body.cadenceMinutes : undefined;
    const v = validateCadenceMinutes(requested);
    if (!v.ok) {
      audit((req as any).user.id, "youtube_watcher_cadence_rejected", JSON.stringify({ requested: String(requested), reason: v.reason }));
      return res.status(400).json({
        success: false,
        error: `قيمة فاصل غير صالحة: ${v.reason}`,
        code: "INVALID_CADENCE",
        allowedMinutes: { min: WATCHER_MIN_CADENCE_MINUTES, max: WATCHER_MAX_CADENCE_MINUTES, values: [1, 2, 3, 4, 5] },
        controls: watcherControlsView(watcherState.controls),
      });
    }
    body.cadenceMinutes = v.minutes;
    delete body.cadenceMs;
  }
  watcherState.controls = normalizeWatcherControls({ ...watcherState.controls, ...body });
  audit((req as any).user.id, "youtube_watcher_controls_updated", JSON.stringify({ ...watcherState.controls }));
  // عند الانتقال من «الرد معطّل» إلى «الرد ممكّن» نحرّر التعليقات المؤجَّلة (التي
  // تعذّرت بسبب إعداد المالك) ليُعاد تقييمها في الدورة التالية — بلا فقدان تعليق.
  const wasReplyOn = prevControls.enabled && !prevControls.paused && !prevControls.humanReviewMode && prevControls.autoReply;
  const nowReplyOn = watcherState.controls.enabled && !watcherState.controls.paused && !watcherState.controls.humanReviewMode && watcherState.controls.autoReply;
  let released = 0;
  if (!wasReplyOn && nowReplyOn) {
    const r = releaseDeferredEntries(watcherState.processed);
    watcherState.processed = r.processed;
    released = r.released;
    if (released) watcherAudit({ action: "deferred_released", decision: "reevaluate", reason: `حُرِّر ${released} تعليقاً مؤجَّلاً لإعادة التقييم بعد تمكين الرد الآلي.` });
  }
  await persistWatcherState();
  // إعادة الجدولة بأمان: يُبطل المؤقّت القديم ويُنشئ واحداً جديداً (لا تكرار).
  const schedulerInfo = applyWatcherCadence();
  const cadenceChanged = prevControls.cadenceMinutes !== watcherState.controls.cadenceMinutes;
  if (cadenceChanged) {
    watcherAudit({ action: "cadence_updated", decision: "reschedule", reason: `فاصل الأتمتة: ${prevControls.cadenceMinutes} → ${watcherState.controls.cadenceMinutes} دقيقة.`, actor: (req as any).user.id });
  }
  res.json({
    success: true,
    controls: watcherControlsView(watcherState.controls),
    cadenceMinutes: watcherState.controls.cadenceMinutes,
    cadenceMs: watcherControlsView(watcherState.controls).cadenceMs,
    cadenceChanged,
    scheduler: schedulerInfo,
    releasedDeferred: released,
    note: cadenceChanged
      ? `حُدِّث فاصل الأتمتة إلى ${watcherState.controls.cadenceMinutes} دقيقة؛ يسري على الدورة التالية.`
      : "حُدِّثت إعدادات الأتمتة؛ تسري فوراً على الدورة التالية.",
  });
});

app.post("/api/agent/youtube/watcher/poll", requireOwner, async (req, res) => {
  const result = await runYouTubeWatcherCycle("manual");
  res.json({ success: result.ok, result, watcher: watcherStatusBlock() });
});

/**
 * مطابقة تشخيصية **قراءة فقط** (للقراءة/التحليل فقط، بلا رد وبلا تعديل سجلات):
 * تقرأ تعليقات YouTube الحقيقية من نفس نافذة الفحص وتقابلها بسجل المعالجة، فتُعلن
 * لكل تعليق: هل اكتُشف؟ ما مرحلته/قراره/سببه؟ وما معرّف الرد الحقيقي إن وُجد؟
 * وتُعلن التعليقات **غير المكتشفة** مع سبب صريح (خارج نافذة الفحص) بلا اختلاق.
 * الغرض: تفسير أي تعليق حقيقي بلا رد بلا أي إرسال ولا كتابة.
 */
async function buildWatcherReconciliation(): Promise<any> {
  const guard = youtubeOperationGuard();
  const readGate = watcherGate(normalizeWatcherControls(watcherState.controls), "read");
  if (!guard.ok) return { ok: false, code: guard.code, error: guard.error };
  if (!readGate.allowed) return { ok: false, code: readGate.code, error: readGate.reason };
  if (!youtubeForceSslGranted()) return { ok: false, code: "SCOPE_UPGRADE_REQUIRED", error: "إعادة ربط YouTube مطلوبة (force-ssl)." };
  const videosRes = await youtubeClient().listMyVideos((await ensureYouTubeAccessToken()).token!, {
    uploadsPlaylistId: String(youtubeStoredCredentials()?.uploadsPlaylistId || ""), maxResults: 25,
  });
  if (!videosRes.ok || !videosRes.data) return { ok: false, code: videosRes.code, error: videosRes.error };
  const scanLimit = commentScanVideoLimitFromEnv();
  const videoIds = videosRes.data.videos.map((v: any) => v.videoId).filter(Boolean).slice(0, scanLimit);
  // قراءة مباشرة بلا أي استيعاب/كتابة: نفس نقطة YouTube الرسمية (commentThreads.list)
  // دون تمرير عبر أداة الاستيعاب، فالفحص **قراءة فقط** فعلاً ولا يمسّ أي سجل.
  const ensured = await ensureYouTubeAccessToken();
  if (!ensured.ok || !ensured.token) return { ok: false, code: ensured.code, error: ensured.error };
  const comments: any[] = [];
  for (const videoId of videoIds) {
    const res = await youtubeClient().listCommentThreads(ensured.token, { videoId, maxResults: 25 });
    if (!res.ok || !res.data) continue;
    for (const c of res.data.comments) comments.push({ ...c, videoId: c.videoId ?? videoId });
  }
  const codeOf = (p: WatcherProcessedEntry) => p?.code || null;
  const rows = comments.map((c) => {
    const entries = watcherState.processed.filter((p) => p.commentId === c.commentId);
    const entry = entries[0] || null;
    return {
      commentId: c.commentId, videoId: c.videoId ?? null, authorName: c.authorName ?? null,
      text: String(c.text || ''), publishedAt: c.publishedAt ?? null,
      detected: Boolean(entry),
      detectedAt: entry?.at ?? null,
      stage: entry?.stage ?? null, decision: entry?.action ?? null, code: codeOf(entry),
      reason: entry?.reason ?? null, deferred: Boolean(entry?.deferred),
      externalReplyId: entry?.externalReplyId ?? null,
      terminalDecisionExplicit: entry ? isExplicitTerminalDecision(entry.stage, codeOf(entry)) : null,
      undetectedReason: entry ? null : 'خارج نافذة الفحص الحالية (لم يُقرأ ضمن أحدث الفيديوهات المفحوصة).',
    };
  });
  rows.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  const violations = watcherState.processed
    .filter((p) => p.stage !== 'NEW' && !isExplicitTerminalDecision(p.stage, codeOf(p)))
    .map((p) => ({ commentId: p.commentId, stage: p.stage, code: codeOf(p), reason: p.reason, at: p.at }));
  return {
    ok: true, readOnly: true, scannedVideoIds: videoIds, scanVideoLimit: scanLimit,
    commentsRead: comments.length, detected: rows.filter((r) => r.detected).length,
    undetected: rows.filter((r) => !r.detected).length,
    terminalDecisionViolations: violations, rows,
  };
}

app.get("/api/agent/youtube/watcher/reconcile", requireOwner, async (_req, res) => {
  try {
    const report = await buildWatcherReconciliation();
    res.status(report.ok ? 200 : 503).json({ success: report.ok, report });
  } catch (error: any) {
    res.status(500).json({ success: false, error: String(error?.message || 'تعذّر بناء تقرير المطابقة.').slice(0, 200) });
  }
});


app.get("/api/agent/youtube/watcher/brief", requireOwner, (_req, res) => {
  const brief = buildWatcherDailyBrief();
  const now = Date.now();
  // البطاقات القابلة للنقر: نفس الرقم + مفتاحه، ليربط الرقم بقائمته بلا discrepancy.
  res.json({ success: true, brief: { ...brief, metrics: watcherBriefMetricsView(now), contentMetrics: contentBriefMetricsView(), contentSummary: contentQueueSummary() } });
});

/** اقتراح وقت جدولة من تفاعل حقيقي فقط (بلا اختراع «أفضل وقت» بلا عيّنة). */
app.get("/api/platforms/youtube/content/schedule-suggestion", authenticateToken, (_req, res) => {
  const timestamps = watcherState.processed.map((p) => p.publishedAt || p.at);
  const suggestion = suggestScheduleTime({ engagementTimestamps: timestamps });
  res.json({ success: true, suggestion, note: "الاقتراح مبني على أوقات التفاعل الحقيقية فقط؛ عند نقص العيّنة يُعلن ذلك بصراحة ولا يُدّعى أفضل وقت." });
});

/**
 * تفاصيل رقم من التقرير: يُعيد **نفس السجلات** التي كوّنت الرقم (بلا اختلاق).
 * للقراءة فقط: فتح التفاصيل لا يغيّر أي حالة. الفلاتر اختيارية.
 */
app.get("/api/agent/youtube/watcher/details", requireOwner, (req, res) => {
  const metric = String(req.query.metric || "");
  if (!WATCHER_BRIEF_METRIC_LABELS_AR[metric as WatcherBriefMetric]) {
    return res.status(400).json({ success: false, error: "بطاقة غير معروفة.", metrics: Object.keys(WATCHER_BRIEF_METRIC_LABELS_AR) });
  }
  const now = Date.now();
  const entries = selectMetricEntries(watcherState.processed, metric as WatcherBriefMetric, now);
  let records = watcherDetailRecords(entries);
  records = applyDetailFilters(records as any, {
    stage: typeof req.query.stage === 'string' && req.query.stage ? String(req.query.stage) : undefined,
    intent: typeof req.query.intent === 'string' && req.query.intent ? String(req.query.intent) : undefined,
    sentiment: typeof req.query.sentiment === 'string' && req.query.sentiment ? String(req.query.sentiment) : undefined,
    delivered: req.query.delivered === 'true' ? true : req.query.delivered === 'false' ? false : undefined,
    needsReview: req.query.needsReview === 'true' ? true : req.query.needsReview === 'false' ? false : undefined,
    q: typeof req.query.q === 'string' ? String(req.query.q) : undefined,
  }) as any;
  res.json({
    success: true,
    metric,
    labelAr: WATCHER_BRIEF_METRIC_LABELS_AR[metric as WatcherBriefMetric],
    count: records.length,
    total: entries.length,
    windowHours: WATCHER_BRIEF_WINDOW_MS / 3_600_000,
    records,
    filtersApplied: {
      stage: req.query.stage || null, intent: req.query.intent || null, sentiment: req.query.sentiment || null,
      delivered: req.query.delivered ?? null, needsReview: req.query.needsReview ?? null, q: req.query.q || null,
    },
    note: "السجلات هي نفسها التي كوّنت الرقم — لا بيانات مُختلقة. فتح التفاصيل لا يغيّر أي حالة.",
  });
});

/** تفاصيل تعليق واحد بمعرّفه (للمراجعة قبل أي قرار). */
app.get("/api/agent/youtube/watcher/comment/:commentId", requireOwner, (req, res) => {
  const entry = watcherState.processed.find((p) => p.commentId === req.params.commentId);
  if (!entry) return res.status(404).json({ success: false, error: "تعليق غير موجود في سجلات المعالجة." });
  res.json({ success: true, record: watcherDetailRecords([entry])[0] });
});

app.get("/api/agent/youtube/watcher/audit", requireOwner, (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
  res.json({ success: true, audit: watcherState.audit.slice(0, limit), count: watcherState.audit.length });
});

/**
 * قرار مراجعة المالك على تعليق — لا يُغيّر الحالة إلا بفعل صريح هنا.
 * - allow_reply: يمر بـexecuteYouTubeReply الحقيقي (كل البوابات سارية، بلا تجاوز).
 * - reprocess: يحرّر التعليق لإعادة تقييمه في الدورة التالية (بلا إرسال فوري).
 * - ignore/escalate/block_reply: قرار حالة فقط (بلا إرسال).
 * لا يُكشف أي سرّ، وكل قرار يُسجَّل في التدقيق ويُحفظ (يصمد بعد restart).
 */
app.post("/api/agent/youtube/watcher/review", requireOwner, async (req, res) => {
  const user = (req as any).user;
  const commentId = String(req.body?.commentId || "").trim();
  const action = String(req.body?.action || "");
  if (!commentId) return res.status(400).json({ success: false, error: "معرّف التعليق مطلوب." });
  if (!isValidReviewAction(action)) {
    return res.status(400).json({ success: false, error: "إجراء غير معروف.", actions: Object.keys(WATCHER_REVIEW_ACTION_LABELS_AR) });
  }
  const entry = watcherState.processed.find((p) => p.commentId === commentId);
  if (!entry) return res.status(404).json({ success: false, error: "تعليق غير موجود في سجلات المعالجة." });

  const now = Date.now();
  const override: WatcherReviewOverride = { commentId, action, at: new Date().toISOString(), by: user.id, note: req.body?.note ? String(req.body.note).slice(0, 300) : null };

  // allow_reply: الإرسال الفعلي يمر بالمنفّذ المركزي نفسه (كل الحمايات).
  if (action === "allow_reply") {
    // بيانات المنتج الحقيقية عند توفرها للفيديو (بلا اختراع): استفسار سعر
    // يُرد من بيانات المعرض بدل قالب عام.
    const productRes = resolveYouTubeVideoProduct(entry.videoId);
    const priceReply = verifiedProductFactsForReply({ product: productRes.product, commentText: String(entry.text || "") });
    const text = String(req.body?.text || "").trim() || (priceReply.verified ? priceReply.replyText : watcherIraqiReply(String(entry.text || "")));
    const result = await executeYouTubeReply({ commentId, text, commentText: String(entry.text || ""), productId: priceReply.verified ? String(priceReply.product?.id || "") : "" }, user.id);
    if (result.status !== 200 || !result.body?.delivered) {
      // لا نُسجّل قراراً ناجحاً ولا نغيّر الحالة عند فشل الإرسال — نُبلّغ السبب الدقيق.
      audit(user.id, "youtube_watcher_review_allow_reply_failed", `youtube:${commentId}:${result.body?.code || result.status}`);
      return res.status(result.status || 502).json({ success: false, action, commentId, sent: false, code: result.body?.code || "REPLY_FAILED", error: result.body?.error || "تعذّر إرسال الرد.", reply: result.body?.reply ?? null });
    }
    // نجح الإرسال: نُسجّل القرار ونحدّث السجل بنفس بيانات المنفّذ الحقيقية.
    entry.stage = "REPLIED";
    entry.action = "reply";
    entry.reason = "أُرسل الرد بقرار المالك (مراجعة التقرير) عبر المنفّذ المركزي.";
    entry.replyText = text;
    entry.externalReplyId = String(result.body.externalReplyId);
    watcherState.reviewOverrides.unshift(override);
    watcherState.reviewOverrides = watcherState.reviewOverrides.slice(0, 5000);
    watcherAudit({ action: "review_allow_reply", commentId, videoId: entry.videoId, reason: entry.reason, decision: "reply", generatedText: text, sent: true, providerId: String(result.body.externalReplyId), actor: user.id });
    audit(user.id, "youtube_watcher_review_allow_reply", `youtube:${commentId}`);
    await persistWatcherState();
    await persistStateDurable();
    return res.json({ success: true, action, commentId, sent: true, externalReplyId: result.body.externalReplyId, state: result.body.reply?.state, record: watcherDetailRecords([entry])[0] });
  }

  // reprocess: تحرير التعليق من سجلات المعالجة ليُعاد تقييمه في الدورة التالية.
  if (action === "reprocess") {
    const before = watcherState.processed.length;
    watcherState.processed = watcherState.processed.filter((p) => p.commentId !== commentId);
    watcherState.reviewOverrides.unshift(override);
    watcherState.reviewOverrides = watcherState.reviewOverrides.slice(0, 5000);
    watcherAudit({ action: "review_reprocess", commentId, videoId: entry.videoId, reason: "أعاد المالك التعليق إلى مسار المعالجة.", decision: "reprocess", actor: user.id });
    audit(user.id, "youtube_watcher_review_reprocess", `youtube:${commentId}`);
    await persistWatcherState();
    return res.json({ success: true, action, commentId, released: before - watcherState.processed.length, note: "سيُعاد تقييم التعليق في دورة المراقبة القادمة (بلا إرسال فوري)." });
  }

  // ignore / escalate / block_reply: قرار حالة صريح، بلا إرسال خارجي.
  const forced = overrideForcedStage(override) || (action === 'escalate' ? 'ESCALATED' : 'SKIPPED');
  entry.stage = forced as YouTubeCommentStage;
  entry.action = action === 'escalate' ? 'escalate' : 'skip';
  entry.reason = action === 'block_reply' ? 'منع المالك الرد على هذا التعليق.'
    : action === 'ignore' ? 'تجاهل بقرار المالك من مراجعة التقرير.'
    : 'صُعِّد للمراجعة البشرية بقرار المالك.';
  watcherState.reviewOverrides.unshift(override);
  watcherState.reviewOverrides = watcherState.reviewOverrides.slice(0, 5000);
  watcherAudit({ action: `review_${action}`, commentId, videoId: entry.videoId, reason: entry.reason, decision: entry.action, actor: user.id });
  audit(user.id, `youtube_watcher_review_${action}`, `youtube:${commentId}`);
  await persistWatcherState();
  return res.json({ success: true, action, commentId, sent: false, record: watcherDetailRecords([entry])[0] });
});

/**
 * منفّذ الرفع الحقيقي للفيديو (videos.insert resumable) — مصدر واحد يمر بكل
 * البوابات: موافقة صريحة → سلامة المحتوى → مادة فعلية → اتصال موثق → idempotency
 * → rate limit → videos.insert. يستخدمه المسار الخارجي والعقل المركزي معاً.
 */
async function executeYouTubePublish(input: {
  title: string; description?: string; tags?: string[]; privacyStatus?: string; publishAt?: string;
  categoryId?: string; videoBase64?: string; videoUrl?: string; mimeType?: string; postId?: string; approved?: boolean;
  mediaRef?: string; queueItemId?: string;
  /** معرّف منتج حقيقي مرتبط بالفيديو (يربطه بمنتجات المعرض للرد بلا اختراع). */
  productId?: string | null;
  /** مصدر القرار: `manual` قرار مالك مباشر (public افتراضاً)، `auto` أتمتة. */
  mode?: "manual" | "auto";
}, actor: string): Promise<{ status: number; body: any }> {
  const started = Date.now();
  const mode = input.mode === "manual" ? "manual" : "auto";
  const title = String(input.title || "").trim();
  const description = typeof input.description === "string" ? input.description : "";
  const tags = Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean) : [];
  // "نشر الآن" قرار مالك مباشر => public افتراضاً (إلا إذا اختار المالك صراحةً غير ذلك).
  const privacyDefault = mode === "manual" ? "public" : "private";
  const privacyStatus = typeof input.privacyStatus === "string" && input.privacyStatus ? input.privacyStatus : privacyDefault;
  const publishAtRaw = typeof input.publishAt === "string" ? input.publishAt.trim() : "";
  const categoryId = typeof input.categoryId === "string" ? input.categoryId : YOUTUBE_DEFAULT_CATEGORY_ID;
  const approved = input.approved === true;
  let mediaBase64 = typeof input.videoBase64 === "string" ? input.videoBase64 : "";
  const videoUrl = typeof input.videoUrl === "string" ? input.videoUrl.trim() : "";
  let mimeType = typeof input.mimeType === "string" ? input.mimeType : "video/mp4";
  // المادة قد تأتي من مخزن المحتوى بمرجع (mediaRef) — بلا اختلاق أي فيديو.
  if (!mediaBase64 && input.mediaRef) {
    const m = contentMediaBytes(input.mediaRef);
    if (m) { mediaBase64 = m.bytes.toString("base64"); mimeType = m.mimeType; }
  }

  if (!approved) return { status: 409, body: { success: false, code: "APPROVAL_REQUIRED", error: "الرفع يحتاج موافقة صريحة (approved=true)." } };
  const safety = analyzeBusinessClaims(`${title}\n${description}`, buildFactsForProduct(null, 0, 0));
  if (!safety.safe) {
    return { status: 422, body: { success: false, code: "CONTENT_SAFETY_BLOCKED", error: "المحتوى يحمل عرضاً تجارياً غير مسجّل، وتم إيقافه قبل الرفع.", contentSafety: { violations: safety.blocked.map((v) => v.detail), codes: safety.blocked.map((v) => v.code) } } };
  }
  const bytes = mediaBase64 ? Uint8Array.from(Buffer.from(mediaBase64, "base64")) : null;
  if (!bytes && !videoUrl) {
    return { status: 422, body: { success: false, code: "MEDIA_REQUIRED", error: "لا توجد مادة فعلية للرفع: زوّد videoBase64 (بايتات الملف) أو mediaRef أو videoUrl عاماً. لا يُولّد النظام فيديو وهمياً." } };
  }
  if (videoUrl) {
    return { status: 422, body: { success: false, code: "MEDIA_REQUIRED", error: "الرفع الرسمي (videos.insert resumable) يحتاج بايتات الملف؛ زوّد videoBase64. الرابط العام وحده لا يكفي لرفع YouTube." } };
  }
  // تحقق فعلي من المادة قبل الرفع (لا نص عادي/وهمي/نوع غير مطابق).
  if (bytes && bytes.length) {
    const mediaCheck = validateMediaBytes(Buffer.from(bytes), mimeType);
    if (!mediaCheck.ok) return { status: 422, body: { success: false, code: mediaCheck.code, error: mediaCheck.error } };
  }
  const validation = validateVideoUploadInput({ title, privacyStatus, publishAt: publishAtRaw || null, categoryId, hasMedia: Boolean(bytes && bytes.length) });
  if (!validation.ok) return { status: 422, body: { success: false, code: validation.code, error: validation.reasons.join(' '), reasons: validation.reasons } };
  const guard = youtubeOperationGuard();
  if (!guard.ok) return { status: guard.status!, body: { success: false, code: guard.code, error: guard.error, ...youtubeStateBlock() } };
  let publishAtIso: string | null = null;
  if (publishAtRaw) {
    // يقبل جداراً محلياً (من datetime-local) أو لحظة ISO (RFC3339) — بلا زحزحة صامتة.
    let epoch = wallClockToEpoch(publishAtRaw);
    if (!Number.isFinite(epoch)) {
      const parsed = Date.parse(publishAtRaw);
      if (Number.isFinite(parsed)) epoch = parsed;
    }
    if (!Number.isFinite(epoch)) return { status: 422, body: { success: false, code: "PUBLISH_AT_INVALID", error: "صيغة وقت الجدولة غير صالحة (يلزم جدار زمني محلي أو RFC3339)." } };
    publishAtIso = new Date(epoch).toISOString();
  }
  const mediaRef = crypto.createHash("sha256").update(bytes!).digest("hex").slice(0, 32);
  const fingerprint = youtubeUploadFingerprint({ title, description, tags, privacyStatus, publishAt: publishAtIso, mediaRef });
  if (youtubeOperationKeySeen(fingerprint)) {
    const existing = ((workspace as any).publishRecords || []).find((r: any) => r.platform === "youtube" && r.idempotencyKey === fingerprint);
    return { status: 409, body: { success: false, code: "DUPLICATE_PUBLISH", error: "نفس الفيديو مُهيّأ سابقاً (منع تكرار الرفع).", existing: existing ? { externalVideoId: existing.externalVideoId, state: existing.state } : null } };
  }
  const rl = youtubeRateLimit("upload");
  if (!rl.allowed) return { status: 429, body: { success: false, code: "RATE_LIMITED", error: "تم بلوغ حد معدّل الرفع؛ أعد المحاولة لاحقاً بلا إنشاء نسخة مكررة.", retryAfterMs: rl.retryAfterMs, limit: rl.limit } };
  const ensured = await ensureYouTubeAccessToken();
  if (!ensured.ok || !ensured.token) return { status: 409, body: { success: false, code: ensured.code || "TOKEN_UNAVAILABLE", error: ensured.error, ...youtubeStateBlock() } };
  // وسم البصمة يُحقن في الفيديو ليتيح المطابقة الحقيقية عند إعادة المزامنة (بلا سرّ).
  const uploadTags = [...tags, fingerprintTag(fingerprint)].slice(0, 30);
  const result = await youtubeClient().uploadVideo(ensured.token, { bytes: bytes!, mimeType, metadata: { title, description, tags: uploadTags, categoryId, privacyStatus, publishAt: publishAtIso } });

  // حالة عدم يقين خارجي: فشل شبكي بعد إرسال الطلب ⇒ إعادة مزامنة قراءة-فقط قبل أي
  // إعادة نشر، فلا يُنشأ فيديو مكرر إذا نجح الطلب لدى YouTube ولم تصل الاستجابة.
  let reconciled: { status: string; videoId: string | null; note: string } | null = null;
  let externalVideoId = result.ok && result.data?.externalVideoId ? result.data.externalVideoId : null;
  if (!result.ok && (result.code === "network" || result.code === "timeout")) {
    try {
      const found = await findYouTubeVideoByFingerprint(fingerprint);
      const rec = reconcileUnknownUpload(found, publishAtIso);
      reconciled = { status: rec.status, videoId: rec.videoId, note: rec.note };
      if (rec.status === "FOUND" && rec.videoId) externalVideoId = rec.videoId;
    } catch { /* تبقى الحالة غير مؤكدة بصراحة */ }
  }
  const delivered = Boolean(externalVideoId && !publishAtIso);

  // تحقق حقيقي من المزود (لا نكتفي بنجاح الطلب): نشر الآن يجب أن يكون public
  // فعلاً، والجدولة private+(publishAt)، **والوصف المعتمد يجب أن يصل فعلاً**.
  // يُقرأ الفيديو مرة واحدة من YouTube وتُشتق منه الحالتان (بلا نداء إضافي).
  let privacyVerification: { requested: string; actual: string | null; verified: boolean; note: string } | null = null;
  let descriptionVerification: { required: boolean; verified: boolean; code: string; expectedLength: number; actualLength: number | null; note: string } | null = null;
  if (externalVideoId && result.ok) {
    const expected = publishAtIso ? "private" : privacyStatus;
    try {
      const fetched = await youtubeClient().getVideos(ensured.token, [externalVideoId]);
      const row = fetched.ok && fetched.data?.length === 1 ? fetched.data[0] : null;
      const actual = row ? (row.privacyStatus ?? null) : null;
      const verified = actual === expected;
      privacyVerification = {
        requested: expected, actual, verified,
        note: actual === null
          ? "تعذّر تأكيد الخصوصية من YouTube الآن (لم تُقرأ الحالة)؛ لم يُدَّع أنها مؤكدة."
          : verified
            ? `أثبت YouTube الحالة الفعلية: ${actual}.`
            : `حالة YouTube الفعلية (${actual}) لا تطابق المطلوب (${expected})؛ لا يُسجَّل تحقق كامل.`,
      };
      if (!verified && actual !== null) {
        logYouTubeOperation("video_privacy_mismatch", { externalId: externalVideoId, outcome: actual, errorCode: null, durationMs: Date.now() - started, idempotencyKey: fingerprint, actor });
      }
      // الوصف: يلزم وصول الوصف المعتمد غير الفارغ إلى YouTube فعلاً، وإلا فلا
      // تُعتبر دورة النشر مُتحقَّقة. أي عدم تطابق يُسجَّل بأمان (بلا محتوى سرّي).
      const dv = verifyUploadedDescription(description, row ? row.description : null);
      descriptionVerification = { required: dv.required, verified: dv.verified, code: dv.code, expectedLength: dv.expectedLength, actualLength: dv.actualLength, note: dv.note };
      if (dv.required && !dv.verified) {
        logYouTubeOperation("video_description_mismatch", { externalId: externalVideoId, outcome: dv.code, errorCode: null, durationMs: Date.now() - started, idempotencyKey: fingerprint, actor });
      }
    } catch { /* تبقى الخصوصية/الوصف غير مؤكدين بصراحة */ }
  }
  // لا يُعلن التحقق الكامل إلا باجتماع الخصوصية والوصف فعلاً من YouTube.
  const fullyVerified = delivered && Boolean(privacyVerification?.verified) && (!descriptionVerification?.required || Boolean(descriptionVerification?.verified));

  const recordState = externalVideoId ? (publishAtIso ? "scheduled" : "published") : "failed";
  const record = {
    id: workspaceId("publish"), platform: "youtube",
    postId: typeof input.postId === "string" ? input.postId : workspaceId("post"),
    state: recordState,
    scheduledFor: publishAtIso, executedAt: new Date().toISOString(),
    providerPostId: externalVideoId, externalVideoId,
    url: youtubeWatchUrl(externalVideoId),
    privacyStatus: publishAtIso ? "private" : privacyStatus,
    privacyVerified: privacyVerification ? privacyVerification.verified : false,
    privacyActual: privacyVerification ? privacyVerification.actual : null,
    descriptionVerified: descriptionVerification ? descriptionVerification.verified : false,
    descriptionVerification: descriptionVerification,
    verified: fullyVerified,
    title, idempotencyKey: fingerprint, createdBy: actor,
    /** المنتج المرتبط (من عنصر الطابور أو الطلب) — يربط الفيديو بمنتجات المعرض للرد بلا اختراع. */
    productId: (input.queueItemId ? contentQueue.find((i) => i.id === input.queueItemId)?.productId : null)
      ?? (typeof input.productId === "string" && (workspace.products || []).some((p: any) => p.id === input.productId) ? input.productId : null),
    simulated: false,
    reconciled: reconciled ? reconciled.status : null,
    error: result.ok || externalVideoId ? null : (result.error || "فشل الرفع إلى YouTube"),
    receipt: (result.ok || externalVideoId) ? { provider: "youtube", videoId: externalVideoId, state: result.data?.state ?? recordState, at: new Date().toISOString() } : null,
  };
  if (!Array.isArray((workspace as any).publishRecords)) (workspace as any).publishRecords = [];
  (workspace as any).publishRecords.unshift(record);
  if ((workspace as any).publishRecords.length > WORKSPACE_MAX_PUBLISH_RECORDS) (workspace as any).publishRecords.length = WORKSPACE_MAX_PUBLISH_RECORDS;
  if (externalVideoId) recordYouTubeOperationKey(fingerprint);

  // تحديث عنصر الطابور المرتبط (إن وُجد) بحالة النشر الحقيقية.
  let queueItem: ContentQueueItem | null = null;
  if (input.queueItemId) {
    queueItem = contentQueue.find((i) => i.id === input.queueItemId) || null;
    if (queueItem) {
      if (externalVideoId) {
        queueItem.state = publishAtIso ? "SCHEDULED" : "PUBLISHED";
        queueItem.externalVideoId = externalVideoId;
        queueItem.url = youtubeWatchUrl(externalVideoId);
        queueItem.verifiedVideoId = externalVideoId;
        queueItem.verifiedPrivacyStatus = privacyVerification ? privacyVerification.actual : null;
        queueItem.verifiedDescription = Boolean(descriptionVerification?.required && descriptionVerification?.verified);
        queueItem.verified = fullyVerified;
        const privacyNote = privacyVerification?.verified ? " — أُثبت من YouTube." : " (لم تُؤكَّد الحالة من YouTube بعد).";
        const descNote = descriptionVerification?.required
          ? (descriptionVerification.verified ? " وأُثبت وصول الوصف المعتمد." : ` لكن الوصف المعتمد لم يُثبَت على YouTube (${descriptionVerification.code}).`)
          : "";
        queueItem.stateReason = publishAtIso
          ? `جدول YouTube النشر (publishAt) بحالة private حتى الموعد${privacyNote}${descNote}`
          : `نشر فوري؛ أعاد YouTube معرّف فيديو حقيقي${privacyVerification?.verified ? " وأثبت الحالة الفعلية: " + privacyVerification.actual : " (لم تُؤكَّد الخصوصية من YouTube بعد)"}.${descNote}`;
        queueItem.code = publishAtIso ? "SCHEDULED_ON_YOUTUBE" : "PUBLISHED_ON_YOUTUBE";
        pushContentHistory(queueItem, { action: publishAtIso ? "scheduled" : "published", actor, detail: queueItem.stateReason, externalVideoId, result: fullyVerified ? "ok_verified" : "ok_unverified" });
      } else if (reconciled) {
        queueItem.stateReason = `حالة خارجية غير مؤكدة: ${reconciled.note}`;
        queueItem.code = "UNKNOWN_EXTERNAL_STATE";
        pushContentHistory(queueItem, { action: "reconcile_unknown", actor, detail: reconciled.note, result: reconciled.status });
      } else {
        queueItem.state = "FAILED";
        queueItem.stateReason = result.error || "فشل الرفع إلى YouTube.";
        queueItem.code = String(result.code || "PROVIDER_ERROR");
        pushContentHistory(queueItem, { action: "publish_failed", actor, detail: queueItem.stateReason, result: "failed" });
      }
      queueItem.updatedAt = new Date().toISOString();
    }
  }

  await persistStateDurable();
  logYouTubeOperation("video_upload", { externalId: externalVideoId, outcome: record.state, errorCode: result.ok ? null : (result.code as any) || null, durationMs: Date.now() - started, idempotencyKey: fingerprint, actor });
  audit(actor, externalVideoId ? (publishAtIso ? "youtube_video_scheduled" : "youtube_video_uploaded") : "youtube_video_upload_failed", `youtube:${externalVideoId || "none"}`);
  if (!externalVideoId) {
    noteYouTubeProviderError(result.code as any);
    return { status: 502, body: { success: false, code: result.code || "PROVIDER_ERROR", error: result.error || "لم يُعد YouTube معرّف فيديو؛ لم يُسجَّل أي نشر.", record, reconciled, delivered: false, ...youtubeStateBlock() } };
  }
  clearYouTubeProviderError();
  return {
    status: 200,
    body: {
      success: true, record, queueItem: queueItem ? contentQueueView().find((q) => q.id === queueItem!.id) : null,
      externalVideoId, url: record.url,
      delivered,
      verified: record.verified === true,
      privacyStatus: record.privacyStatus,
      privacyVerification,
      descriptionVerification,
      descriptionVerified: record.descriptionVerified === true,
      scheduled: record.state === "scheduled",
      state: record.state,
      reconciled,
      note: publishAtIso
        ? `تم الرفع مع جدولة حقيقية (publishAt) لدى YouTube بحالة private حتى الموعد${privacyVerification?.verified ? " — أثبت YouTube الحالة الفعلية." : " (لم تُؤكَّد الحالة من YouTube بعد)."}${descriptionVerification?.required ? (descriptionVerification.verified ? " وأُثبت وصول الوصف المعتمد." : " لكن لم يُثبَت وصول الوصف المعتمد إلى YouTube.") : ""}`
        : `تم الرفع وأعاد YouTube معرّف فيديو حقيقي${privacyVerification?.verified ? " وأثبت الخصوصية الفعلية: " + privacyVerification.actual + "." : " (لم تُؤكَّد الخصوصية من YouTube بعد)."}${descriptionVerification?.required ? (descriptionVerification.verified ? " وأُثبت وصول الوصف المعتمد." : " لكن لم يُثبَت وصول الوصف المعتمد إلى YouTube.") : ""}`,
      ...youtubeStateBlock(),
    },
  };
}

/**
 * يبحث عن فيديو حقيقي لدى YouTube ببصمة المحتوى المحقونة (وسم gharabiai-…).
 * قراءة فقط — تُستخدم لإعادة المزامنة عند انقطاع الاتصال بعد الرفع، فلا نشر مكرر.
 */
async function findYouTubeVideoByFingerprint(fingerprint: string): Promise<{ videoId: string | null; title: string | null } | null> {
  const stored = youtubeStoredCredentials();
  const uploadsPlaylistId = String(stored?.uploadsPlaylistId || "");
  if (!uploadsPlaylistId || !fingerprint) return null;
  const ensured = await ensureYouTubeAccessToken();
  if (!ensured.ok || !ensured.token) return null;
  const res = await youtubeClient().listMyVideos(ensured.token, { uploadsPlaylistId, maxResults: 50 });
  if (!res.ok || !res.data) return null;
  return matchVideoByFingerprint(res.data.videos as any, fingerprint);
}


/** الرد الحقيقي على تعليق YouTube (comments.insert) عبر البوابات كاملة. */
app.post("/api/platforms/youtube/reply", requireOwner, async (req, res) => {
  const user = (req as any).user as { id: string };
  const result = await executeYouTubeReply({
    commentId: typeof req.body?.commentId === "string" ? req.body.commentId : (typeof req.body?.externalId === "string" ? req.body.externalId : ""),
    text: typeof req.body?.text === "string" ? req.body.text : "",
    commentText: typeof req.body?.commentText === "string" ? req.body.commentText : "",
    productId: typeof req.body?.productId === "string" ? req.body.productId : "",
  }, user.id);
  return res.status(result.status).json(result.body);
});


/**
 * الرفع الحقيقي للفيديو (videos.insert resumable) — نشر فوري أو جدولة حقيقية.
 * المحتوى (base64) أو رابط عام للفيديو، مع idempotency وrate limit وحارس سلامة.
 */
app.post("/api/platforms/youtube/publish", express.json({ limit: CONTENT_UPLOAD_JSON_LIMIT }), requireOwner, async (req, res) => {
  const user = (req as any).user as { id: string };
  const result = await executeYouTubePublish({
    title: typeof req.body?.title === "string" ? req.body.title : "",
    description: typeof req.body?.description === "string" ? req.body.description : "",
    tags: Array.isArray(req.body?.tags) ? req.body.tags : [],
    privacyStatus: typeof req.body?.privacyStatus === "string" ? req.body.privacyStatus : undefined,
    publishAt: typeof req.body?.publishAt === "string" ? req.body.publishAt : undefined,
    categoryId: typeof req.body?.categoryId === "string" ? req.body.categoryId : undefined,
    videoBase64: typeof req.body?.videoBase64 === "string" ? req.body.videoBase64 : undefined,
    videoUrl: typeof req.body?.videoUrl === "string" ? req.body.videoUrl : undefined,
    mimeType: typeof req.body?.mimeType === "string" ? req.body.mimeType : undefined,
    postId: typeof req.body?.postId === "string" ? req.body.postId : undefined,
    approved: req.body?.approved === true,
    mediaRef: typeof req.body?.mediaRef === "string" ? req.body.mediaRef : undefined,
    queueItemId: typeof req.body?.queueItemId === "string" ? req.body.queueItemId : undefined,
    productId: typeof req.body?.productId === "string" ? req.body.productId : undefined,
  }, user.id);
  return res.status(result.status).json(result.body);
});

/** تحديث بيانات فيديو مملوك للقناة (videos.update) — عنوان/وصف/وسوم/خصوصية. */
app.post("/api/platforms/youtube/video-update", requireOwner, async (req, res) => {
  const user = (req as any).user as { id: string };
  const videoId = typeof req.body?.videoId === "string" ? req.body.videoId.trim() : "";
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!videoId) return res.status(400).json({ success: false, error: "معرّف الفيديو (videoId) مطلوب." });
  if (!title) return res.status(422).json({ success: false, code: "TITLE_REQUIRED", error: "عنوان الفيديو مطلوب (videos.update يستبدل الsnippet كاملاً)." });
  const guard = youtubeOperationGuard();
  if (!guard.ok) return res.status(guard.status!).json({ success: false, code: guard.code, error: guard.error, ...youtubeStateBlock() });
  const ensured = await ensureYouTubeAccessToken();
  if (!ensured.ok || !ensured.token) return res.status(409).json({ success: false, code: ensured.code || "TOKEN_UNAVAILABLE", error: ensured.error, ...youtubeStateBlock() });
  const metadata = { title, description: typeof req.body?.description === "string" ? req.body.description : "", tags: Array.isArray(req.body?.tags) ? req.body.tags.map((t: any) => String(t)) : [], categoryId: typeof req.body?.categoryId === "string" ? req.body.categoryId : YOUTUBE_DEFAULT_CATEGORY_ID, privacyStatus: typeof req.body?.privacyStatus === "string" ? req.body.privacyStatus : undefined };
  const result = await youtubeClient().updateVideo(ensured.token, { videoId, metadata: metadata as any });
  audit(user.id, result.ok ? "youtube_video_updated" : "youtube_video_update_failed", `youtube:${videoId}`);
  if (!result.ok) { noteYouTubeProviderError(result.code as any); return res.status(502).json({ success: false, code: result.code || "PROVIDER_ERROR", error: result.error }); }
  clearYouTubeProviderError();
  res.json({ success: true, video: result.data, note: "تم التحديث فعلياً لدى YouTube وأعاد بيانات الفيديو المحدّثة." });
});

// -------------------------------------------------------------
// طابور محتوى YouTube — فكرة → تحضير → فحص → مراجعة → نشر/جدولة → تحقق → تقرير.
// كل العمليات الحساسة للمالك فقط. لا نشر آلي بلا إذن، ولا نشر بلا معرّف من Google.
// -------------------------------------------------------------

/**
 * إنشاء عنصر محتوى (فكرة/تحضير). يمر بفحص الحماية ويُصنّف حتمياً:
 * آمن وواضح ⇒ APPROVED إن كان الإذن ممنوحاً؛ تجاري غير موثّق ⇒ REVIEW_REQUIRED؛
 * غير ذلك ⇒ DRAFT/blocked. لا يُنشر شيء في هذه الخطوة.
 */
app.post("/api/platforms/youtube/content/drafts", express.json({ limit: CONTENT_UPLOAD_JSON_LIMIT }), requireOwner, async (req, res) => {
  const user = (req as any).user;
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description : "";
  const tags = Array.isArray(req.body?.tags) ? req.body.tags.map((t: any) => String(t).trim()).filter(Boolean) : [];
  const categoryId = typeof req.body?.categoryId === "string" ? req.body.categoryId : YOUTUBE_DEFAULT_CATEGORY_ID;
  const publishAtRaw = typeof req.body?.publishAt === "string" ? req.body.publishAt.trim() : "";
  const source = typeof req.body?.source === "string" ? req.body.source : "owner";
  // ربط المنتج الحقيقي: يُقبل فقط إن طابق منتجاً مسجّلاً فعلاً (لا معرّف مُختلق).
  const productIdRaw = typeof req.body?.productId === "string" ? req.body.productId.trim() : "";
  const productId = productIdRaw && (workspace.products || []).some((p: any) => p.id === productIdRaw) ? productIdRaw : null;
  const privacyExplicit = typeof req.body?.privacyStatus === "string" && (YOUTUBE_PRIVACY_STATUSES as readonly string[]).includes(req.body.privacyStatus);

  let mediaRef = typeof req.body?.mediaRef === "string" ? req.body.mediaRef : "";
  // مادة جديدة (base64) تُسجّل حقيقية في المخزن وتُعطى مرجعاً — لا فيديو وهمي.
  if (!mediaRef && typeof req.body?.videoBase64 === "string" && req.body.videoBase64) {
    const reg = registerContentMedia({
      mimeType: typeof req.body?.mimeType === "string" ? req.body.mimeType : "video/mp4",
      base64: req.body.videoBase64,
      filename: typeof req.body?.filename === "string" ? req.body.filename : undefined,
    });
    if (!reg.ok) return res.status(422).json({ success: false, code: reg.code, error: reg.error });
    mediaRef = reg.mediaRef!;
    await persistContentMedia();
  }
  const hasMedia = Boolean(mediaRef && contentMediaBytes(mediaRef));

  let publishAtIso: string | null = null;
  if (publishAtRaw) {
    let epoch = wallClockToEpoch(publishAtRaw);
    if (!Number.isFinite(epoch)) { const p = Date.parse(publishAtRaw); if (Number.isFinite(p)) epoch = p; }
    if (!Number.isFinite(epoch)) return res.status(422).json({ success: false, code: "PUBLISH_AT_INVALID", error: "صيغة وقت الجدولة غير صالحة." });
    const fut = isFutureSchedule(new Date(epoch).toISOString(), Date.now());
    if (!fut.ok) return res.status(422).json({ success: false, code: "PUBLISH_AT_NOT_FUTURE", error: fut.reason });
    publishAtIso = new Date(epoch).toISOString();
  }

  const safety = analyzeBusinessClaims(`${title}\n${description}`, buildFactsForProduct(null, 0, 0));
  const decision = classifyContentForReview({
    hasMedia,
    title,
    publishAt: publishAtIso,
    safety: { safe: safety.safe, blockedCount: safety.blocked.length, warnCount: safety.warnings.length, hasCommercialClaim: /سعر|خصم|عرض|تقسيط|متوفر|دفعة/i.test(`${title}\n${description}`) },
  });
  const controls = normalizeWatcherControls(watcherState.controls);
  const mapped = decisionToState(decision, controls);
  // الخصوصية: الجدولة => private حتى الموعد (كقاعدة)، والنشر الفوري => public. أي
  // قيمة صريحة من المالك تتقدّم. هذا يمنع ظهور الفيديو المجدول للعامة مسبقاً.
  const privacyStatus = privacyExplicit ? req.body.privacyStatus : (publishAtIso ? "private" : "public");
  const input: ContentDraftInput = { title, description, tags, privacyStatus, publishAt: publishAtIso, mediaRef, source, categoryId, productId };
  const fingerprint = contentFingerprint(input);
  const dup = contentQueue.find((i) => i.fingerprint === fingerprint && i.productId === productId && !isTerminalContentState(i.state) && i.state !== "FAILED");
  if (dup) return res.status(409).json({ success: false, code: "DUPLICATE_CONTENT", error: "محتوى مطابق موجود بالفعل في الطابور (منع التكرار).", existing: { id: dup.id, state: dup.state } });

  const nowIso = new Date().toISOString();
  const item: ContentQueueItem = {
    id: workspaceId("content"), fingerprint, title, description, tags, categoryId, privacyStatus,
    publishAt: publishAtIso, mediaRef, source, productId,
    state: mapped.state, stateReason: mapped.reason, code: mapped.code, sensitivity: decision.sensitivity,
    externalVideoId: null, url: null, verified: false,
    verifiedVideoId: null, verifiedPrivacyStatus: null,
    createdAt: nowIso, updatedAt: nowIso, createdBy: user.id, reviewedBy: null, reviewedAt: null, reviewNote: null,
    history: [{ at: nowIso, action: "created", actor: user.id, detail: `${decision.kind} — ${decision.reason}`, externalVideoId: null, result: mapped.state }],
  };
  contentQueue.unshift(item);
  if (contentQueue.length > CONTENT_QUEUE_MAX) contentQueue.length = CONTENT_QUEUE_MAX;
  audit(user.id, "youtube_content_draft_created", `content:${item.id}:${mapped.state}`);
  await persistWatcherState();

  // تنفيذ آلي فوري للمحتوى المعتمد إن كان الإذن ممنوحاً وليس Kill Switch.
  let autoExecuted: any = null;
  if (mapped.state === "APPROVED") {
    autoExecuted = await autoExecuteContentItem(item, user.id);
  }
  res.status(201).json({ success: true, item: contentQueueView().find((q) => q.id === item.id), decision, autoExecuted });
});

/** يجلب عناصر الطابور + الملخص (محمي). */
app.get("/api/platforms/youtube/content/queue", authenticateToken, (_req, res) => {
  res.json({ success: true, items: contentQueueView(), summary: contentQueueSummary(), states: CONTENT_STATES.map((s) => ({ state: s, labelAr: CONTENT_STATE_LABELS_AR[s] })), note: "كل عنصر يمثّل محتوى حقيقياً؛ لا عناصر مُختلقة." });
});

/** تفاصيل عنصر واحد + إمكانية النقر من التقرير. */
app.get("/api/platforms/youtube/content/queue/:id", authenticateToken, (req, res) => {
  const it = contentQueue.find((i) => i.id === req.params.id);
  if (!it) return res.status(404).json({ success: false, error: "عنصر محتوى غير موجود." });
  res.json({ success: true, item: contentQueueView().find((q) => q.id === it.id) });
});

/**
 * يلخّص نتيجة executeYouTubePublish للعقد الخارجي المسطّح (status/code/externalVideoId
 * /state/error) بلا فقدان حقول التحقق (verified/privacyVerification) وبلا كشف سرّ.
 * مصدر واحد لمسار القرار اليدوي ومسار الأتمتة.
 */
function summarizePublishExec(exec: { status: number; body: any }, item: ContentQueueItem): any {
  const b = exec.body || {};
  return {
    status: exec.status,
    code: b.code,
    externalVideoId: b.externalVideoId ?? null,
    state: item.state,
    error: b.error,
    delivered: b.delivered === true,
    verified: b.verified === true,
    privacyStatus: b.privacyStatus ?? null,
    privacyVerification: b.privacyVerification ?? null,
    descriptionVerification: b.descriptionVerification ?? null,
    descriptionVerified: b.descriptionVerified === true,
    unverifiedReason: (b.privacyVerification && b.privacyVerification.verified === false) ? b.privacyVerification.note : (b.descriptionVerification && b.descriptionVerification.required && b.descriptionVerification.verified === false ? b.descriptionVerification.note : undefined),
  };
}

/**
 * ينفّذ عنصر محتوى معتمداً (نشر الآن أو جدولة) عبر المنفّذ المركزي نفسه.
 * يعيد نتيجة المنفّذ الحقيقية (بلا ادعاء نجاح). يُستخدم للتنفيذ الآلي ولقرار المالك.
 */
async function autoExecuteContentItem(item: ContentQueueItem, actor: string): Promise<any> {
  const controls = normalizeWatcherControls(watcherState.controls);
  const action = item.publishAt ? "schedule" : "publish";
  const gate = contentGate(controls, action as any, "auto");
  if (!gate.allowed) {
    item.stateReason = `التنفيذ الآلي متعذّر: ${gate.reason}`;
    item.code = gate.code;
    item.state = "REVIEW_REQUIRED";
    item.updatedAt = new Date().toISOString();
    pushContentHistory(item, { action: "auto_blocked", actor, detail: gate.reason, result: gate.code });
    await persistWatcherState();
    return { status: 409, code: gate.code, error: gate.reason };
  }
  const result = await executeYouTubePublish({
    title: item.title, description: item.description, tags: item.tags, privacyStatus: item.privacyStatus,
    publishAt: item.publishAt || undefined, categoryId: item.categoryId, mediaRef: item.mediaRef,
    approved: true, queueItemId: item.id, mode: "auto",
  }, actor);
  return { status: result.status, code: result.body?.code, externalVideoId: result.body?.externalVideoId, state: item.state, error: result.body?.error };
}

/**
 * قرار المالك على عنصر محتوى: موافقة/رفض/تعديل/نشر الآن/جدولة/إلغاء.
 * النشر/الجدولة يمرّان بالمنفّذ المركزي وكل البوابات. المرفوض نهائي ولا يُنشر تلقائياً.
 */
app.post("/api/platforms/youtube/content/queue/:id/review", express.json({ limit: CONTENT_UPLOAD_JSON_LIMIT }), requireOwner, async (req, res) => {
  const user = (req as any).user;
  const action = String(req.body?.action || "");
  if (!isValidContentReviewAction(action)) {
    return res.status(400).json({ success: false, error: "إجراء مراجعة غير معروف.", actions: CONTENT_REVIEW_ACTION_LABELS_AR });
  }
  const item = contentQueue.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ success: false, error: "عنصر محتوى غير موجود." });
  if (isTerminalContentState(item.state) && action !== "edit") {
    return res.status(409).json({ success: false, code: "TERMINAL_STATE", error: `الحالة ${item.state} نهائية؛ أنشئ قراراً/عنصراً جديداً بدل نقضها.` });
  }

  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 300) : null;
  // هل اختار المالك خصوصية صراحةً (غير الافتباضي للنشر الآن/الجدولة)؟
  const privacyExplicit = typeof req.body?.privacyStatus === "string" && (YOUTUBE_PRIVACY_STATUSES as readonly string[]).includes(req.body.privacyStatus);
  if (privacyExplicit && action !== "edit") (item as any).privacyStatus = req.body.privacyStatus;
  item.reviewedBy = user.id;
  item.reviewedAt = new Date().toISOString();
  if (note) item.reviewNote = note;

  // تعديل: يحدّث المحتوى ويعيد التصنيف. يسمح أيضًا بإرفاق مادة الفيديو الفعلية
  // (base64) لتتحوّل المسودة الناقصة إلى قابلة للاعتماد/النشر.
  if (action === "edit") {
    if (typeof req.body?.videoBase64 === "string" && req.body.videoBase64) {
      const reg = registerContentMedia({
        mimeType: typeof req.body?.mimeType === "string" ? req.body.mimeType : "video/mp4",
        base64: req.body.videoBase64,
        filename: typeof req.body?.filename === "string" ? req.body.filename : undefined,
      });
      if (!reg.ok) return res.status(422).json({ success: false, code: reg.code, error: reg.error });
      item.mediaRef = reg.mediaRef!;
      await persistContentMedia();
    }
    if (typeof req.body?.title === "string") item.title = req.body.title.trim();
    if (typeof req.body?.description === "string") item.description = req.body.description;
    if (Array.isArray(req.body?.tags)) item.tags = req.body.tags.map((t: any) => String(t).trim()).filter(Boolean);
    if (typeof req.body?.publishAt === "string" && req.body.publishAt.trim()) {
      const epoch = wallClockToEpoch(req.body.publishAt.trim());
      if (Number.isFinite(epoch)) item.publishAt = new Date(epoch).toISOString();
    }
    item.fingerprint = contentFingerprint({ title: item.title, description: item.description, tags: item.tags, privacyStatus: item.privacyStatus, publishAt: item.publishAt, mediaRef: item.mediaRef });
    item.state = "REVIEW_REQUIRED";
    item.code = "OWNER_EDITED";
    item.stateReason = "عدّل المالك المحتوى؛ أُعيد للمراجعة قبل النشر.";
    item.updatedAt = new Date().toISOString();
    pushContentHistory(item, { action: "edited", actor: user.id, detail: note, result: "REVIEW_REQUIRED" });
    audit(user.id, "youtube_content_edited", `content:${item.id}`);
    await persistWatcherState();
    return res.json({ success: true, action, item: contentQueueView().find((q) => q.id === item.id) });
  }

  // رفض/إلغاء: نهائي بلا نشر.
  if (action === "reject" || action === "cancel") {
    item.state = action === "reject" ? "REJECTED" : "CANCELLED";
    item.code = action === "reject" ? "OWNER_REJECTED" : "OWNER_CANCELLED";
    item.stateReason = action === "reject" ? "رفض المالك المحتوى؛ لا نشر آلي بعد الآن." : "ألغى المالك عنصر المحتوى.";
    item.updatedAt = new Date().toISOString();
    pushContentHistory(item, { action, actor: user.id, detail: note, result: item.state });
    audit(user.id, `youtube_content_${action}`, `content:${item.id}`);
    await persistWatcherState();
    return res.json({ success: true, action, item: contentQueueView().find((q) => q.id === item.id) });
  }

  // موافقة صرفة: حالة APPROVED بلا تنفيذ (ينتظر قراراً/تنفيذاً آلياً لاحقاً).
  if (action === "approve") {
    const hasMedia = Boolean(item.mediaRef && contentMediaBytes(item.mediaRef));
    const mapped = reviewActionToState("approve", normalizeWatcherControls(watcherState.controls), item.publishAt, hasMedia);
    if (mapped.state !== "APPROVED") {
      item.stateReason = mapped.reason; item.code = mapped.code; item.updatedAt = new Date().toISOString();
      pushContentHistory(item, { action: "review_approve_blocked", actor: user.id, detail: mapped.reason, result: mapped.code });
      await persistWatcherState();
      return res.status(409).json({ success: false, action, code: mapped.code, error: mapped.reason, item: contentQueueView().find((q) => q.id === item.id) });
    }
    item.state = mapped.state; item.code = mapped.code; item.stateReason = mapped.reason;
    item.updatedAt = new Date().toISOString();
    pushContentHistory(item, { action: "approved", actor: user.id, detail: note, result: item.state });
    audit(user.id, "youtube_content_approved", `content:${item.id}`);
    await persistWatcherState();
    return res.json({ success: true, action, item: contentQueueView().find((q) => q.id === item.id) });
  }

  // نشر الآن / جدولة: **قرار مالك مباشر** (mode=manual) — لا يعتمد على
  // autoPublish/autoSchedule ولا على humanReviewMode. يمر بالمنفّذ المركزي
  // (كل البوابات + مادة فعلية). النشر الآن => public، والجدولة => private حتى الموعد.
  const hasMedia = Boolean(item.mediaRef && contentMediaBytes(item.mediaRef));
  if (action === "publish_now") {
    // النشر الآن قرار فوري: نتجاهل أي publishAt سابق، والخصوصية public افتراضاً.
    item.publishAt = null;
    if (!privacyExplicit) item.privacyStatus = "public";
  }
  if (action === "schedule") {
    if (!item.publishAt) {
      item.state = "APPROVED"; item.code = "SCHEDULE_TIME_REQUIRED";
      item.stateReason = "الجدولة تحتاج وقت publishAt صالحاً (مستقبلي)."; item.updatedAt = new Date().toISOString();
      pushContentHistory(item, { action: "review_schedule_blocked", actor: user.id, detail: item.stateReason, result: item.code });
      await persistWatcherState();
      return res.status(409).json({ success: false, action, code: "SCHEDULE_TIME_REQUIRED", error: item.stateReason, item: contentQueueView().find((q) => q.id === item.id) });
    }
    // الجدولة private حتى الموعد (إلا إن اختار المالك صراحةً غير ذلك).
    if (!privacyExplicit) item.privacyStatus = "private";
  }
  const mapped = reviewActionToState(action as ContentReviewAction, normalizeWatcherControls(watcherState.controls), item.publishAt, hasMedia);
  if (mapped.state !== "APPROVED") {
    item.state = mapped.state; item.code = mapped.code; item.stateReason = mapped.reason;
    item.updatedAt = new Date().toISOString();
    pushContentHistory(item, { action: `review_${action}_blocked`, actor: user.id, detail: mapped.reason, result: mapped.code });
    await persistWatcherState();
    return res.status(409).json({ success: false, action, code: mapped.code, error: mapped.reason, item: contentQueueView().find((q) => q.id === item.id) });
  }
  item.state = "APPROVED"; item.code = mapped.code; item.stateReason = mapped.reason; item.updatedAt = new Date().toISOString();
  const exec = await executeYouTubePublish({
    title: item.title, description: item.description, tags: item.tags, privacyStatus: item.privacyStatus,
    publishAt: item.publishAt || undefined, categoryId: item.categoryId, mediaRef: item.mediaRef,
    approved: true, queueItemId: item.id, mode: "manual",
  }, user.id);
  return res.status(exec.status || 200).json({ success: exec.status === 200, action, mode: "manual", exec: summarizePublishExec(exec, item), item: contentQueueView().find((q) => q.id === item.id) });
});

/** بطاقات المحتوى القابلة للنقر في التقرير اليومي (مصدر واحد). */
function contentBriefMetricsView() {
  const counts = computeContentBriefCounts(contentQueue.map((i) => ({ state: i.state, verified: i.verified, externalVideoId: i.externalVideoId, verifiedVideoId: i.verifiedVideoId })));
  return CONTENT_BRIEF_METRICS.map((key) => ({ key, labelAr: CONTENT_BRIEF_METRIC_LABELS_AR[key], count: counts[key] }));
}

/** تفاصيل بطاقة محتوى: السجلات التي كوّنت الرقم (بلا اختلاق). */
app.get("/api/platforms/youtube/content/details", authenticateToken, (req, res) => {
  const metric = String(req.query.metric || "") as ContentBriefMetric;
  if (!CONTENT_BRIEF_METRICS.includes(metric)) {
    return res.status(400).json({ success: false, error: "بطاقة محتوى غير معروفة.", metrics: CONTENT_BRIEF_METRICS });
  }
  const filtered = contentQueue.filter((i) => {
    switch (metric) {
      case "contentPublished": return i.state === "PUBLISHED" || i.state === "VERIFIED";
      case "contentScheduled": return i.state === "SCHEDULED";
      case "contentAwaitingReview": return i.state === "REVIEW_REQUIRED";
      case "contentRejected": return i.state === "REJECTED";
      case "contentFailed": return i.state === "FAILED";
      case "contentVerified": return isVerificationSubstantiated(i);
      default: return false;
    }
  });
  res.json({ success: true, metric, labelAr: CONTENT_BRIEF_METRIC_LABELS_AR[metric], count: filtered.length, total: filtered.length, records: filtered.slice(0, 200).map((i) => contentQueueView().find((q) => q.id === i.id)), note: "السجلات هي نفسها التي كوّنت الرقم — لا بيانات مُختلقة." });
});

/**
 * تنظيف بيانات الاختبار التجريبية فقط (owner): يعرض (`dryRun`) أو ينفّذ حذف
 * العناصر المصنّفة **اختباراً** بدليل موثّق (`classifyContentRecord`)، ولا يحذف
 * أي عنصر إنتاج أو منشور فعلي. الإجراء محصور بالمالك، ويُسجَّل في التدقيق.
 */
app.post("/api/platforms/youtube/content/cleanup-test-data", requireOwner, async (req, res) => {
  const user = (req as any).user as { id: string };
  const dryRun = req.body?.dryRun !== false; // آمن افتراضاً: عرض فقط بلا حذف.
  const classified = contentQueue.map((i) => ({ id: i.id, state: i.state, source: i.source, externalVideoId: i.externalVideoId, ...classifyContentRecord(i) }));
  const testItems = classified.filter((c) => c.classification === "test");
  // حماية مزدوجة: لا يُحذف عنصر له معرّف فيديو حقيقي من YouTube مهما كان تصنيفه.
  const deletable = testItems.filter((c) => !c.externalVideoId);
  const keptPublished = testItems.filter((c) => Boolean(c.externalVideoId));
  if (dryRun) {
    return res.json({ success: true, dryRun: true, testCount: testItems.length, deletableCount: deletable.length, keptRealVideoCount: keptPublished.length, testedRecords: testItems.slice(0, 200), keptRealVideo: keptPublished.slice(0, 200), note: "عرض فقط؛ لا حذف. أي عنصر له معرّف فيديو حقيقي من YouTube لا يُحذف إطلاقاً." });
  }
  const ids = new Set(deletable.map((c) => c.id));
  const before = contentQueue.length;
  contentQueue = contentQueue.filter((i) => !ids.has(i.id));
  audit(user.id, "youtube_content_test_cleanup", `removed:${before - contentQueue.length}`);
  await persistWatcherState();
  res.json({ success: true, dryRun: false, removed: before - contentQueue.length, keptRealVideoCount: keptPublished.length, keptRealVideo: keptPublished.slice(0, 200), note: "حُذفت العناصر الاختبارية غير المرتبطة بفيديو حقيقي فقط؛ بقي كل الإنتاج والفيديوهات الحقيقية." });
});

/**
 * توليد وصف YouTube التسويقي عبر العقل المركزي (owner فقط). عملية AI واحدة
 * تمر Central Agent → AiEngine → Gemini Firewall (cache/dedup/quota/breaker/
 * fallback). لا تُستدعى في أي قراءة/عرض/refresh. لا تُعاد أي أسرار.
 */
app.post("/api/platforms/youtube/content/generate-description", requireOwner, async (req, res) => {
  const user = (req as any).user;
  const productId = typeof req.body?.productId === "string" ? req.body.productId : null;
  const productName = typeof req.body?.productName === "string" ? req.body.productName : null;
  const extraInstructions = typeof req.body?.extraInstructions === "string" ? req.body.extraInstructions : null;
  if (!productId && !cleanText(productName, 160)) {
    return res.status(400).json({ success: false, error: "يلزم productId أو productName لصياغة وصف حقيقي بلا اختراع." });
  }
  const gen = await generateYouTubeContentDescription({ productId, productName, extraInstructions });
  const product = resolveContentProduct(productId, productName);
  audit(user.id, "youtube_content_description_generated", `product:${product?.id || productName || "unknown"}:${gen.source}`);
  res.json({
    success: true,
    product: product ? { id: product.id, name: product.name, category: product.category } : null,
    description: gen.description,
    hashtags: gen.hashtags,
    factsUsed: gen.factsUsed,
    source: gen.source,
    usedProvider: gen.usedProvider,
    safetyReplaced: gen.safetyReplaced,
    note: gen.usedProvider
      ? "صياغة الوصف تمت عبر العقل المركزي (مزود AI) بعد فحص السلامة."
      : "مزود AI غير متاح؛ استُخدمت صياغة حتمية آمنة من البيانات الفعلية فقط (بلا اختراع).",
  });
});

/** تشخيص إعداد YouTube (للمالك): النطاقات، القدرات، والحالة الصادقة — بلا سرّ. */
app.get("/api/platforms/youtube/diagnostics", requireOwner, async (_req, res) => {
  const stored = youtubeStoredCredentials();
  res.json({
    success: true,
    configured: youtubeConnectorConfigured(),
    clientIdConfigured: Boolean(youtubeOAuthConfig()?.clientId),
    clientSecretConfigured: Boolean(youtubeOAuthConfig()?.clientSecret),
    requestedScopes: youtubeOAuthScopes(),
    requiredScopes: [...YOUTUBE_REQUIRED_SCOPES],
    grantedScopes: Array.isArray(stored?.scope) ? stored.scope : [],
    forceSslGranted: youtubeForceSslGranted(),
    uploadsPlaylistStored: Boolean(stored?.uploadsPlaylistId),
    capabilityMatrix: YOUTUBE_CAPABILITY_MATRIX,
    implementedCapabilities: YOUTUBE_CAPABILITY_MATRIX.filter((r) => r.status === "SUPPORTED").map((r) => r.key),
    state: youtubeStateBlock(),
    youtubeOnlyMode: youtubeOnlyModeEnabled(),
    note: "إدارة التعليقات تحتاج نطاق youtube.force-ssl الممنوح فعلاً؛ عند غيابه يُعلن النظام SCOPE_UPGRADE_REQUIRED ويطلب إعادة ربط — بلا تحايل على Google.",
  });
});

// -------------------------------------------------------------
// تفويض تشغيل YouTube (للمالك فقط): يمنح العقل المركزي تنفيذ عمليات YouTube
// المحدّدة بلا موافقة منفصلة لكل عملية، مع سجل تدقيق وإمكانية إيقاف فورية.
// النطاق YouTube فقط؛ لا يُلغي المصادقة/الملكية/سلامة المحتوى/منع التكرار/audit.
// -------------------------------------------------------------
app.get("/api/platforms/youtube/delegation", requireOwner, (_req, res) => {
  res.json({
    success: true,
    delegation: youtubeDelegationBlock(),
    availableActions: [...YOUTUBE_DELEGATION_ACTIONS],
    availableActionsLabelAr: YOUTUBE_DELEGATION_ACTIONS.map((a) => YOUTUBE_DELEGATION_ACTION_LABELS_AR[a]),
    scopeOnly: "youtube",
    note: "التفويض خاص بـYouTube فقط. لا يمنح أي منصة أخرى، ولا يتجاوز المصادقة أو الملكية أو سجل التدقيق أو حارس سلامة المحتوى.",
  });
});

app.post("/api/platforms/youtube/delegation", requireOwner, async (req, res) => {
  const user = (req as any).user as { id: string };
  const actions = Array.isArray(req.body?.actions) ? req.body.actions : [];
  if (!actions.length) return res.status(422).json({ success: false, code: "DELEGATION_ACTIONS_REQUIRED", error: "حدّد عملية واحدة على الأقل لتفويضها (reply/publish/schedule/update_video)." });
  const expiresInHours = req.body?.expiresInHours;
  const built = buildYouTubeDelegation({ actions, grantedBy: user.id, expiresInHours: Number.isFinite(Number(expiresInHours)) ? Number(expiresInHours) : null, note: typeof req.body?.note === "string" ? req.body.note : null });
  if (!built.actions.length) return res.status(422).json({ success: false, code: "DELEGATION_ACTIONS_INVALID", error: "لا عملية صالحة في الطلب؛ العمليات المتاحة: " + YOUTUBE_DELEGATION_ACTIONS.join(", ") + "." });
  youtubeDelegationState = built;
  await saveYouTubeDelegationState();
  audit(user.id, "youtube_delegation_granted", `actions=${built.actions.join(",")}`);
  logYouTube("delegation_granted", { actionCount: built.actions.length });
  res.json({ success: true, delegation: youtubeDelegationBlock(), note: "تم منح تفويض تشغيل YouTube للعمليات المحدّدة فقط. يمكن إيقافه فوراً، وكل عملية تبقى مسجّلة في التدقيق." });
});

app.delete("/api/platforms/youtube/delegation", requireOwner, async (req, res) => {
  const user = (req as any).user as { id: string };
  youtubeDelegationState = revokeYouTubeDelegation(youtubeDelegationState);
  await saveYouTubeDelegationState();
  audit(user.id, "youtube_delegation_revoked", "youtube");
  logYouTube("delegation_revoked", {});
  res.json({ success: true, delegation: youtubeDelegationBlock(), note: "تم إيقاف تفويض تشغيل YouTube؛ عاد كل تنفيذ خارجي ليتطلب موافقة صريحة منفصلة." });
});

// -------------------------------------------------------------
// Central Brain (Batch 26) — عقل مركزي عام لكل المنصات.
// تخطيط وتوصيات وتعلّم قابل للتفسير فقط؛ لا تنفيذ خارجي ولا تجاوز لأي بوابة.
// كل المسارات محمية: القراءة للمستخدمين، والعمليات الحسّاسة للمالك.
// -------------------------------------------------------------

/** تشخيص العقل المركزي (للمالك): حالة، قدرات، تعلّم، توصيات، عدّادات Gemini — بلا أسرار. */
app.get("/api/brain/diagnostics", requireOwner, (_req, res) => {
  // facade توافقية: الشكل القديم من الحالة canonical (buildRuntimeBrain)، لا بناء عقل ثانٍ.
  const canonical = buildRuntimeBrain({ ...brainRuntimeInput(), now: Date.now() });
  const snap = toCentralBrainSnapshot(canonical.state, { engagementTimestamps: (watcherState.processed || []).map((p: any) => p.publishedAt || p.at) });
  const sampleByPlatform = Object.fromEntries(snap.learning.byPlatform.map((s) => [s.platform, { sampleSize: s.sampleSize, sufficientSample: s.sufficientSample }]));
  res.json({
    success: true,
    brainStatus: "operational_planning_only",
    platforms: snap.platforms,
    connectedPlatformIds: connectedPlatformIds(),
    learning: snap.learning,
    recommendations: snap.recommendations,
    audience: snap.audience,
    ai: snap.ai,
    caps: { geminiUsedOnReads: false },
    sampleByPlatform,
    limitations: snap.limitations,
    note: snap.note + " هذا المسار لا يستهلك Gemini ولا يكشف أي سرّ.",
  });
});

/** خطة محتوى عامة لمنتج/حملة عبر كل المنصات (قراءة، بلا استهلاك AI). لا تنفيذ نشر. */
app.post("/api/brain/content-plan", authenticateToken, (req, res) => {
  const user = (req as any).user as { id: string };
  const productId = typeof req.body?.productId === "string" ? req.body.productId : null;
  const productName = typeof req.body?.productName === "string" ? req.body.productName : null;
  if (!productId && !cleanText(productName, 160)) {
    return res.status(400).json({ success: false, error: "يلزم productId أو productName لبناء خطة حقيقية بلا اختراع." });
  }
  const platforms = (Array.isArray(req.body?.platforms) ? req.body.platforms : []).filter((p: any) => isSupportedPlatform(String(p))) as PlatformId[];
  const brief = buildContentBriefForBrain(productId, productName, platforms, req.body?.objective, req.body?.extraInstructions);
  const sched = brainScheduleSuggestion();
  const plan = buildContentPlan({
    brief,
    recommendedPublishTime: sched.action === "use_data" ? sched.suggestedAt : null,
    schedulingReason: sched.note,
  });
  audit(user.id, "brain_content_plan", `product:${brief.product?.id || productName || "general"}:platforms=${plan.platformAdaptations.length}`);
  res.json({
    success: true,
    plan,
    scheduling: sched,
    note: "خطة محتوى مبنية من بيانات حقيقية فقط عبر العقل المركزي. لا تُنفّذ نشراً؛ التنفيذ يخضع لبوابات الصلاحيات والمراجعة البشرية.",
  });
});

/** تكييف المحتوى لمنصة واحدة (قراءة، حتمي، بلا استهلاك AI). */
app.post("/api/brain/platform-adaptation", authenticateToken, (req, res) => {
  const platform = String(req.body?.platform || "");
  if (!isSupportedPlatform(platform)) return res.status(404).json({ success: false, error: "المنصة غير مدعومة." });
  const productId = typeof req.body?.productId === "string" ? req.body.productId : null;
  const productName = typeof req.body?.productName === "string" ? req.body.productName : null;
  if (!productId && !cleanText(productName, 160)) {
    return res.status(400).json({ success: false, error: "يلزم productId أو productName لتكييف حقيقي بلا اختراع." });
  }
  const brief = buildContentBriefForBrain(productId, productName, [platform as PlatformId], req.body?.objective, req.body?.extraInstructions);
  const plan = buildContentPlan({ brief });
  const adaptation = plan.platformAdaptations[0];
  res.json({ success: true, platform, adaptation, note: "تكييف حتمي من بيانات حقيقية؛ لا استهلاك AI ولا نشر." });
});

/** تعلّم منصة واحدة من أدائها الحقيقي (قراءة، بلا استهلاك AI) — من الحالة canonical. */
app.get("/api/brain/learning/:platform", authenticateToken, (req, res) => {
  const platform = String(req.params.platform);
  if (!isSupportedPlatform(platform)) return res.status(404).json({ success: false, error: "المنصة غير مدعومة." });
  const records = buildRuntimeBrain({ ...brainRuntimeInput(), now: Date.now() }).state.records.filter((r) => r.platform === platform);
  const analysis = analyzePlatformLearning({ platform: platform as PlatformId, records });
  res.json({
    success: true,
    platform,
    sample: analysis.sample,
    insights: analysis.insights,
    note: analysis.note + " المؤشرات غير المتاحة تُعلن صراحةً ولا تُخترع قيمتها.",
  });
});

/** تعلّم عام عبر كل المنصات (قراءة، بلا استهلاك AI) — من الحالة canonical. */
app.get("/api/brain/learning", authenticateToken, (_req, res) => {
  const summary = canonicalBrainSnapshot().learning;
  res.json({ success: true, learning: summary, note: summary.note });
});

/** توصيات عامة عبر كل المنصات، مبنية على بيانات حقيقية (قراءة، بلا استهلاك AI) — من الحالة canonical. */
app.get("/api/brain/recommendations", authenticateToken, (_req, res) => {
  const timestamps = (watcherState.processed || []).map((p: any) => p.publishedAt || p.at);
  const bundle = canonicalBrainSnapshot({ engagementTimestamps: timestamps }).recommendations;
  res.json({ success: true, recommendations: bundle, note: bundle?.note ?? "لا منصات مُدخَلة." });
});

/** تحليل جمهور عام (مؤشرات + مواضيع تعليقات فعلية) بلا سمات شخصية حساسة — من الحالة canonical. */
app.get("/api/brain/audience", authenticateToken, (_req, res) => {
  const audience = canonicalBrainSnapshot().audience;
  res.json({ success: true, audience, note: audience?.note ?? "لا منصات مُدخَلة." });
});

/** تحليل تعليق واحد عبر العقل (classify → priority → policy → reply مقترح). حتمي بلا AI. */
app.post("/api/brain/comment-intelligence", authenticateToken, (req, res) => {
  const platform = String(req.body?.platform || "");
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (!isSupportedPlatform(platform)) return res.status(404).json({ success: false, error: "المنصة غير مدعومة." });
  if (!text.trim()) return res.status(400).json({ success: false, error: "نص التعليق مطلوب." });
  const intel = buildCommentIntelligence({ platform: platform as PlatformId, text: text.slice(0, 2000) });
  const product = resolveContentProduct(req.body?.productId, req.body?.productName);
  const facts: any = {};
  if (product) facts.productName = cleanText(product.name, 120) || undefined;
  const showroom: any = workspace.showroom || {};
  if (cleanText(showroom.phoneUnified, 40)) facts.phone = cleanText(showroom.phoneUnified, 40);
  const proposal = proposeCommentReply(intel, facts, product ? cleanText(product.name, 120) : undefined);
  res.json({
    success: true,
    platform,
    classification: intel.classification,
    priority: intel.priority,
    policy: intel.policy,
    decision: intel.decision,
    platformReadsComments: intel.platformReadsComments,
    platformReplies: intel.platformReplies,
    proposedReply: proposal.reply,
    reason: intel.reason,
    capabilities: { supported: platformCapabilities(platform as PlatformId) },
    note: "وحدة التعليقات العامة حتمية (بلا AI). المنصة التي لا توفّر تعليقات تُعلن unsupported، ولا يُدَّعى رد على تعليق لم يُقرأ.",
  });
});



// -------------------------------------------------------------
// Unified publishing pipeline (Batch 6) — مسار واحد للنشر المعتمد.
// Approved → Capability Check → Connector → Platform API → Real Response → Record.
// منصة لا تدعم نوع النشر تُردّ صراحةً بـ CAPABILITY_NOT_SUPPORTED، بلا فشل صامت.
// منصة تدعم النشر لكن بلا موصل منفّذ تُردّ بـ EXTERNAL_SETUP_REQUIRED.
// -------------------------------------------------------------
/**
 * المنفّذ المشترك لنشر منصة واحدة — مصدر واحد لكل مسارات النشر.
 *
 * يُعيد { status, body } بلا كتابة رأس استجابة، فيُعاد استخدامه من المسار
 * المفرد (POST /api/platforms/:platform/publish) ومن دالة التوزيع متعدد
 * المنصات (POST /api/workspace/content/:id/publish). السلوك مطابق حرفياً لما
 * كان داخل المسار المفرد (نفس البوابات: القدرة → السلامة → الاتصال الموثق →
 * الموصل الحقيقي → التنفيذ)، ولا يُعلن نجاحاً بلا معرّف نشر حقيقي من المزود.
 */
/**
 * يحوّل جسم نشر فيديو إلى رابط عام جاهز (Task #23) — يغطي إنستغرام/تيك
 * توك/فيسبوك، التي تتطلب جميعاً رابطاً عاماً لا بايتات مباشرة:
 *  - `videoUrl` صريح في الجسم: يُستخدم كما هو بلا تعديل (المسار اليدوي القديم
 *    يبقى يعمل حرفياً — لا كسر توافق).
 *  - `videoBase64` (بايتات فعلية، نفس حقل مسار اليوتيوب): تُسجَّل وتُتحقَّق
 *    بنفس قواعد `registerContentMedia` (الحجم/الحد/سلامة base64)، ثم تُرفع
 *    تلقائياً إلى مجلد Drive التسويقي المنفصل (`videoPublicHosting.ts`،
 *    Task #21) وتُعاد كرابط عام. لا رفع صامت بلا تحقق، ولا نجاح بلا رابط فعلي.
 *  - بلا أي منهما: يُعاد رابط فارغ (تترك كل منصة قاعدتها القائمة — نص فقط
 *    لفيسبوك، أو رفض MEDIA_REQUIRED لإنستغرام/تيك توك كما كان).
 *
 * تخزين مؤقت بالمحتوى (sha256): عند نشر نفس الفيديو على عدة منصات في توزيع
 * واحد (Task #25، كل منصة تستدعي هذه الدالة بمعزل)، لا يُرفع نفس الملف إلى
 * Drive أكثر من مرة — يُعاد نفس الرابط العام خلال نافذة قصيرة. تخزين بالذاكرة
 * فقط (لا يصمد بعد restart، ولا ضرر من ذلك: رفع جديد عند أول طلب بعد إعادة
 * التشغيل).
 */
const PUBLIC_VIDEO_UPLOAD_CACHE_TTL_MS = 10 * 60 * 1000;
const PUBLIC_VIDEO_UPLOAD_CACHE_MAX = 50;
const publicVideoUploadCache = new Map<string, { url: string; folderId: string | null; at: number }>();

type ResolvedPublicVideo = { ok: boolean; url: string; status: number; error: string; code: string };
/** نتيجة نجاح موحّدة (الحقول غير ذات الصلة تُصفَّر لتُوحَّد الشكل وتُرضي الأنواع). */
const resolvedVideoOk = (url: string): ResolvedPublicVideo => ({ ok: true, url, status: 200, error: "", code: "" });
const resolvedVideoErr = (status: number, error: string, code: string): ResolvedPublicVideo => ({ ok: false, url: "", status, error, code });

/**
 * رابط عام موقّع يخدم بايتات الفيديو من الخادم نفسه (تمرير Range) بدل رابط Drive
 * العام. الجذر المُثبت: رابط `drive.google.com/uc?export=download` قد يُعيد صفحة
 * HTML وسيطة (فحص الفيروسات) بدل بايتات الفيديو عند سحبه من خوادم Meta تلقائياً،
 * فيفشل إنشاء الحاوية رغم أن الرابط يعمل في المتصفح. الخدمة من الخادم تضمن بايتات
 * فيديو خام ونوع محتوى صحيحاً ودعم Range — وهو ما تتطلبه Meta.
 * التوقيع HMAC يمنع تخمين المعرّف، والبايتات تبقى في ذاكرة الخادم فقط (لا سرّ يُكشف).
 */
function signMediaRef(mediaRef: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(`media:${mediaRef}`).digest("base64url");
}
/** رابط الفيديو العام عبر الخادم (PublicURL المعتمد) — بديل مضمون لرابط Drive الوسيط. */
function publicMediaUrl(mediaRef: string): string {
  return `${publicBaseUrlNow()}/api/public/video/${encodeURIComponent(mediaRef)}?sig=${signMediaRef(mediaRef)}`;
}
/** يتحقق من توقيع رابط الوسائط بزمن ثابت (مقاومة التلاعب/التخمين). */
function verifyMediaSignature(mediaRef: string, sig: string): boolean {
  const expected = signMediaRef(mediaRef);
  const a = Buffer.from(String(sig || ""));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function resolvePublicVideoUrl(body: any): Promise<ResolvedPublicVideo> {
  const explicit = typeof body?.videoUrl === "string" ? body.videoUrl.trim() : "";
  if (explicit) return resolvedVideoOk(explicit);
  const base64 = typeof body?.videoBase64 === "string" ? body.videoBase64 : "";
  if (!base64) return resolvedVideoOk("");
  const contentHash = crypto.createHash("sha256").update(base64).digest("hex");
  const cached = publicVideoUploadCache.get(contentHash);
  if (cached && (Date.now() - cached.at) < PUBLIC_VIDEO_UPLOAD_CACHE_TTL_MS) return resolvedVideoOk(cached.url);
  const reg = registerContentMedia({
    mimeType: typeof body?.mimeType === "string" ? body.mimeType : "video/mp4",
    base64,
    filename: typeof body?.filename === "string" ? body.filename : undefined,
  });
  if (!reg.ok) return resolvedVideoErr(422, reg.error || "فشل التحقق من بايتات الفيديو.", reg.code || "MEDIA_INVALID");
  const media = contentMediaBytes(reg.mediaRef!);
  if (!media) return resolvedVideoErr(500, "تعذّر قراءة بايتات الفيديو بعد تسجيلها.", "MEDIA_READ_FAILED");

  // ── الجذر المُثبت ─────────────────────────────────────────────────────────
  // الاعتماد الأوّلي على رابط Drive العام (`uc?export=download`) كان يفشل عند سحبه
  // من خوادم Meta: Drive قد يُعيد صفحة HTML وسيطة («فحص الفيروسات») لا بايتات
  // فيديو خام، فيفشل إنشاء حاوية Instagram/Threads/Threads رغم أن الرابط يعمل في
  // المتصفح. الحل: نخدِم البايتات من الخادم نفسه (تمرير Range، نوع محتوى صحيح).
  // رفع Drive يبقى أفضل-جهد للاستمرارية عبر إعادة التشغيل، ولا يُسقط الاستجابة.
  const mediaRef = reg.mediaRef!;
  const serverUrl = publicMediaUrl(mediaRef);
  let driveFolderId: string | null = null;
  try {
    const client = buildMarketingDriveClient();
    if (client) {
      // مهلة صريحة: Drive متعثّر لا يجوز أن يُعلّق خدمة الفيديو (المورد الحاسم للنشر).
      // عند تجاوز المهلة نُكمل بالرابط المخدوم من الخادم ولا نُسقط الاستجابة.
      const mirrorTimeoutMs = envTimeoutMs(process.env as NodeJS.ProcessEnv, "DRIVE_HOST_TIMEOUT_MS", DRIVE_PUBLIC_HOST_TIMEOUT_MS);
      const uploaded = await settleWithTimeout(publishVideoPublicly(client, {
        fileName: typeof body?.filename === "string" && body.filename ? body.filename : `marketing-${Date.now()}.mp4`,
        content: media.bytes,
        mimeType: media.mimeType,
        storedFolder: drControl.driveMarketingFolderIdentity || null,
      }), mirrorTimeoutMs);
      if (uploaded.ok && uploaded.folderId) driveFolderId = uploaded.folderId;
      // عند فشل Drive لا نُعلن فشلاً: الخدمة من الخادم تغطي التشغيل الحالي،
      // والرسالة تبقى صريحة في السجل بلا كشف سرّ.
      if (!uploaded.ok) console.warn(`[الغرابي AI] drive-mirror-skipped code=${uploaded.code || "unknown"}`);
    }
  } catch (mirrorErr: any) {
    console.warn(`[الغرابي AI] drive-mirror-error code=${mirrorErr?.code || "unknown"}`);
  }
  // يصمد معرّف المجلد بعد أول رفع ناجح فلا يُعاد البحث بالاسم كل مرة.
  if (driveFolderId && drControl.driveMarketingFolderIdentity?.rootId !== driveFolderId) {
    drControl.driveMarketingFolderIdentity = { rootId: driveFolderId };
    saveControlState();
  }
  publicVideoUploadCache.set(contentHash, { url: serverUrl, folderId: driveFolderId, at: Date.now() });
  while (publicVideoUploadCache.size > PUBLIC_VIDEO_UPLOAD_CACHE_MAX) {
    const oldestKey = [...publicVideoUploadCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
    if (!oldestKey) break;
    publicVideoUploadCache.delete(oldestKey);
  }
  return resolvedVideoOk(serverUrl);
}

/** هدف نشر Threads الحالي (حساب المستخدم + رمزه) من الاعتماد المشفّر المخزَّن عبر المسار العام. */
function threadsPublishTarget(): { threadsUserId: string; accessToken: string } | { error: string } {
  const conn: any = platformConnections.get("threads");
  const threadsUserId = conn?.accountId ? String(conn.accountId) : "";
  const stored = getProviderToken("threads");
  const accessToken = stored?.access_token ? String(stored.access_token) : "";
  if (!threadsUserId || !accessToken) return { error: "لا حساب Threads موثّق؛ لا يمكن تنفيذ أي نشر خارجي." };
  return { threadsUserId, accessToken };
}

/** نوم قصير قابل للتجاوز في الاختبار (pollIntervalMs) — لا تعليق بلا نهاية. */
function sleepMs(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))); }

/** حدود انتظار جاهزية حاوية الوسائط (Instagram/Threads) — بلا تعليق بلا نهاية. */
const IG_CONTAINER_POLL_MAX_ATTEMPTS = 8;
function containerPollIntervalMs(): number {
  const raw = Number(process.env.CONTAINER_POLL_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 3000;
}

/**
 * ينشئ حاوية إنستغرام ثم **ينتظر فعلياً** حتى `FINISHED` قبل `media_publish`.
 * الجذر المُثبت لعطل «CLIENT_ERROR: Invalid parameter»: كانت الحاوية تُنشر وهي
 * ما تزال `IN_PROGRESS` فيرد Meta بخطأ معلمة غير صالحة. النص/الصورة جاهزان
 * مباشرةً (لا معالجة وسائط)، أما الفيديو/الريل فيتطلبان انتظاراً محدوداً.
 * لا يُعلن الجاهزية بلا دليل (`status_code`)، والفشل يُعلن بسببه الحقيقي.
 */
async function createInstagramContainerReady(
  igAccountId: string,
  pageToken: string,
  input: { imageUrl: string; videoUrl: string; caption: string; reel: boolean; shareToFeed?: boolean },
  poll: { attempts: number; intervalMs: number },
): Promise<{ containerId: string; mediaKind: string } | { error: string; code: string; providerCode?: number | null; providerSubcode?: number | null; providerTraceId?: string | null }> {
  const created = await instagramClient().createMediaContainer(igAccountId, pageToken, input);
  if (!created.ok || !created.data) {
    return { error: created.error || "فشل إنشاء حاوية Instagram.", code: created.code || "MEDIA_REQUIRED", providerCode: created.providerCode ?? null, providerSubcode: created.providerSubcode ?? null, providerTraceId: created.providerTraceId ?? null };
  }
  const { containerId, mediaKind } = created.data;
  // النص/الصورة: الحاوية جاهزة بلا معالجة وسائط معقّدة. الفيديو/الريل: انتظار محدود.
  const needsWait = mediaKind === "video" || mediaKind === "reel";
  if (!needsWait) return { containerId, mediaKind };
  for (let i = 0; i < Math.max(1, poll.attempts); i++) {
    if (i > 0) await sleepMs(poll.intervalMs);
    const status = await instagramClient().getContainerStatus(containerId, pageToken);
    // لا سلامة بلا دليل: خطأ قراءة الحالة لا يُعلن نجاحاً بل فشلاً بسببه.
    if (!status.ok || !status.data) {
      return { error: status.error || "تعذّر قراءة حالة حاوية Instagram قبل النشر.", code: status.code || "CONTAINER_STATUS_FAILED" };
    }
    const code = status.data.statusCode;
    if (isInstagramContainerReady(code)) return { containerId, mediaKind };
    if (isInstagramContainerFailed(code)) return { error: `حاوية Instagram انتهت بحالة ${code} قبل النشر (فشل معالجة الوسائط).`, code: "CONTAINER_FAILED" };
  }
  return { error: "لم تجهز حاوية الفيديو لدى Instagram ضمن المهلة المحددة؛ لم يُنشر شيء (أعد المحاولة).", code: "CONTAINER_TIMEOUT" };
}

/** نفس منطق إنستغرام لـThreads: نص جاهز مباشرةً، والفيديو/الصورة ينتظران `FINISHED`.
 *  يُعاد بشكل ThreadsResult حتى يعمل مع `withThreadsToken` (تجديد الرمز + إعادة المحاولة). */
async function createThreadsContainerReady(
  threadsUserId: string,
  accessToken: string,
  input: { text: string; imageUrl: string; videoUrl: string; replyToId: string },
  poll: { attempts: number; intervalMs: number },
): Promise<{ ok: boolean; data: { containerId: string; mediaKind: string } | null; error?: string; code?: string | null; providerCode?: number | null; providerSubcode?: number | null; providerTraceId?: string | null }> {
  const created = await threadsClient().createMediaContainer(threadsUserId, accessToken, input);
  if (!created.ok || !created.data) {
    return { ok: false, data: null, error: created.error || "فشل إنشاء حاوية Threads.", code: created.code || "PROVIDER_ERROR", providerCode: created.providerCode ?? null, providerSubcode: created.providerSubcode ?? null, providerTraceId: created.providerTraceId ?? null };
  }
  const { containerId, mediaKind } = created.data;
  if (mediaKind === "text") return { ok: true, data: { containerId, mediaKind } };
  for (let i = 0; i < Math.max(1, poll.attempts); i++) {
    if (i > 0) await sleepMs(poll.intervalMs);
    const status = await threadsClient().getContainerStatus(containerId, accessToken);
    if (!status.ok || !status.data) return { ok: false, data: null, error: status.error || "تعذّر قراءة حالة حاوية Threads قبل النشر.", code: "CONTAINER_STATUS_FAILED" };
    const st = status.data.status;
    if (isThreadsContainerReady(st)) return { ok: true, data: { containerId, mediaKind } };
    if (isThreadsContainerFailed(st)) return { ok: false, data: null, error: status.data.errorMessage || `حاوية Threads انتهت بحالة ${st} قبل النشر.`, code: "CONTAINER_FAILED" };
  }
  return { ok: false, data: null, error: "لم تجهز حاوية Threads ضمن المهلة المحددة؛ لم يُنشر شيء (أعد المحاولة).", code: "CONTAINER_TIMEOUT" };
}

async function executePlatformPublish(platform: string, body: any, actor: string): Promise<{ status: number; body: any }> {
  const user = { id: actor };
  if (!isSupportedPlatform(platform)) return { status: 404, body: { success: false, error: "المنصة غير مدعومة." } };
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const approved = body?.approved === true;
  const chatId = typeof body?.chatId === "string" ? body.chatId.trim() : "";

  if (!content) return { status: 400, body: { success: false, error: "المحتوى مطلوب.", code: "CONTENT_REQUIRED" } };
  if (!approved) return { status: 409, body: { success: false, error: "المحتوى لم تتم الموافقة عليه.", code: "APPROVAL_REQUIRED" } };
  // وضع YOUTUBE_ONLY_OPERATIONAL: يمنع أي عملية خارجية على منصة غير YouTube.
  const onlyBlock = youtubeOnlyBlock(platform);
  if (onlyBlock.blocked) return { status: onlyBlock.status!, body: onlyBlock.body };
  // القدرة تُقرأ من السجل: منصة لا تدعم النشر لا تُحاول إطلاقاً.
  if (!hasCapability(platform, "publish")) {
    return { status: 422, body: { success: false, error: "المنصة لا تدعم النشر عبر واجهتها الرسمية في هذا النظام.", code: "CAPABILITY_NOT_SUPPORTED", platform } };
  }
  // محتوى خارجي يمر عبر حارس السلامة قبل أي إرسال.
  const safety = analyzeBusinessClaims(content, buildFactsForProduct(null, 0, 0));
  if (!safety.safe) {
    return { status: 422, body: { success: false, error: "المحتوى يحمل عرضاً تجارياً غير مسجّل، وتم إيقافه قبل الإرسال.", code: "CONTENT_SAFETY_BLOCKED", contentSafety: { violations: safety.blocked.map((v) => v.detail), codes: safety.blocked.map((v) => v.code) } } };
  }
  // لا موصل منفّذ: الرسالة الصادقة هي «غير مبني بعد» (EXTERNAL_SETUP_REQUIRED) لا
  // «غير متصل» — الأخيرة تُربك المالك بأن الاتصال فشل بينما الموصّل غير موجود أصلاً.
  if (!hasRealConnector(platform)) {
    return { status: 501, body: { success: false, error: "لا يوجد موصل نشر منفّذ لهذه المنصة بعد؛ يحتاج اعتماد تطبيق من المزود.", code: "EXTERNAL_SETUP_REQUIRED", platform } };
  }
  const conn: any = platformConnections.get(platform);
  if (!conn || conn.status !== "connected" || conn.providerVerified !== true) {
    return { status: 409, body: { success: false, error: "المنصة غير متصلة باتصال موثق؛ لا نشر خارجي.", code: "NOT_CONNECTED" } };
  }
  // حارس طول النص **قبل** أي نداء مزود: الرفض يأتي صريحاً برسالة واضحة بدل خطأ
  // المزود الغامض. العدّ بطريقة المنصة (Threads = UTF-8 bytes، وثيقة Meta) — فـ
  // `text.length` وحده كان يترك نصاً «قصيراً» ظاهرياً يتجاوز 500 بايت فعلياً.
  // الاختصار يُقترح في الاستجابة (shortenedContent) بلا أي إرسال، والنص الأصلي
  // المحفوظ في المنشور لا يُمسّ إطلاقاً.
  const textCheck = validatePlatformText(platform, content);
  if (!textCheck.ok) {
    const shorten = platformTextLimit(platform) !== null && textCheck.code === "TEXT_TOO_LONG"
      ? shortenToPlatformLimit(platform, content)
      : null;
    return { status: 422, body: {
      success: false,
      error: textCheck.reason,
      code: textCheck.code,
      limit: textCheck.limit,
      used: textCheck.used,
      countMethod: textCheck.method,
      // اختصار مقترح فقط (لا يُنشر تلقائياً): يحافظ على المعنى ويعلن الأسطر المُسقطة.
      shortenedContent: shorten && shorten.changed ? shorten.text : null,
      shortenedOmittedSegments: shorten ? shorten.omittedSegments : 0,
      note: "النص تجاوز حد المنصة قبل الإرسال؛ اختصر النص أو استخدم النسخة المقترحة يدوياً. لم يُرسَل أي شيء ولم يُسجَّل نشر.",
    } };
  }
  try {
    if (platform === "youtube") {
      // النشر الموحّد لـYouTube يوجّه لمسار الرفع الحقيقي (videos.insert resumable)
      // لأنه يحتاج بايتات الملف. لا محاكاة نصية هنا.
      return { status: 409, body: {
        success: false,
        error: "نشر YouTube الحقيقي يحتاج بايتات الفيديو؛ استخدم مسار الرفع المخصص.",
        code: "PLATFORM_USE_DEDICATED_PUBLISH",
        publishRoute: "/api/platforms/youtube/publish",
      } };
    }
    if (platform === "telegram") {
      const client = telegramClient();
      if (!client) return { status: 503, body: { success: false, error: "موصل Telegram غير مهيأ.", code: "CONNECTOR_NOT_READY" } };
      const target = chatId || String(process.env.TELEGRAM_DEFAULT_CHAT_ID || "");
      if (!target) return { status: 503, body: { success: false, error: "Telegram يحتاج chatId أو TELEGRAM_DEFAULT_CHAT_ID.", code: "TARGET_REQUIRED" } };
      const sent = await client.sendMessage({ chatId: target, text: content });
      const record = buildPublishRecord({ platform: platform as any, postId: typeof body?.postId === "string" ? body.postId : workspaceId("post"), providerPostId: sent.providerMessageId, simulated: false, error: sent.ok ? null : sent.error });
      if (!Array.isArray((workspace as any).publishRecords)) (workspace as any).publishRecords = [];
      (workspace as any).publishRecords.unshift({ ...record, id: workspaceId("publish"), createdBy: user.id, receipt: sent.receipt });
      if ((workspace as any).publishRecords.length > WORKSPACE_MAX_PUBLISH_RECORDS) (workspace as any).publishRecords.length = WORKSPACE_MAX_PUBLISH_RECORDS;
      persistState();
      audit(user.id, sent.ok ? "platform_publish_published" : "platform_publish_failed", `${platform}`);
      if (!sent.ok) return { status: 502, body: { success: false, record, error: sent.error, code: sent.code || "PROVIDER_ERROR", providerCode: sent.providerCode ?? null, note: "لم يُسجَّل أي نشر بلا معرّف منشور حقيقي من المزود." } };
      return { status: 200, body: { success: true, record, providerPostId: sent.providerMessageId, receipt: sent.receipt } };
    }
    if (platform === "facebook") {
      // النشر على صفحة Facebook (Page Access Token). لا نشر بلا معرّف من Meta.
      const target = facebookReplyTarget();
      if ("error" in target) return { status: 503, body: { success: false, error: target.error, code: "CONNECTOR_NOT_READY" } };
      // فيديو: رابط عام صريح، أو بايتات (videoBase64) تُستضاف تلقائياً عبر
      // Drive (Task #23) ثم POST /{page-id}/videos بدل /{page-id}/feed.
      const resolvedVideo = await resolvePublicVideoUrl(body);
      if (!resolvedVideo.ok) return { status: resolvedVideo.status, body: { success: false, error: resolvedVideo.error, code: resolvedVideo.code } };
      const videoUrl = resolvedVideo.url;
      const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl.trim() : "";
      const result = videoUrl
        ? await facebookClient().publishVideoToPage(target.pageId, target.pageToken, videoUrl, content)
        : imageUrl
          ? await facebookClient().publishPhotoToPage(target.pageId, target.pageToken, imageUrl, content)
          : await facebookClient().publishToPage(target.pageId, target.pageToken, content);
      const receipt = result.ok ? { provider: "facebook", pageId: target.pageId, postId: result.data?.providerPostId, mediaKind: videoUrl ? "video" : (imageUrl ? "image" : "text"), sentAt: new Date().toISOString() } : null;
      const record = buildPublishRecord({ platform: platform as any, postId: typeof body?.postId === "string" ? body.postId : workspaceId("post"), providerPostId: result.data?.providerPostId || null, simulated: false, error: result.ok ? null : result.error, code: result.code ?? null, providerCode: result.providerCode ?? null, providerSubcode: result.providerSubcode ?? null, providerTraceId: result.providerTraceId ?? null });
      if (!Array.isArray((workspace as any).publishRecords)) (workspace as any).publishRecords = [];
      (workspace as any).publishRecords.unshift({ ...record, id: workspaceId("publish"), createdBy: user.id, receipt });
      if ((workspace as any).publishRecords.length > WORKSPACE_MAX_PUBLISH_RECORDS) (workspace as any).publishRecords.length = WORKSPACE_MAX_PUBLISH_RECORDS;
      persistState();
      audit(user.id, result.ok ? "platform_publish_published" : "platform_publish_failed", `${platform}`);
      if (!result.ok) return { status: 502, body: { success: false, record, error: result.error, code: result.code || "PROVIDER_ERROR", providerCode: result.providerCode ?? null, providerSubcode: result.providerSubcode ?? null, providerTraceId: result.providerTraceId ?? null, note: "لم يُسجَّل أي نشر بلا معرّف منشور حقيقي من المزود." } };
      return { status: 200, body: { success: true, record, providerPostId: result.data?.providerPostId, receipt } };
    }
    if (platform === "instagram") {
      // نشر Instagram عبر الخطوتين الرسميتين: إنشاء حاوية ثم نشرها.
      // Instagram لا ينشر نصاً فقط؛ يلزم رابط صورة/فيديو عام — نُعلن ذلك صراحةً.
      const target = instagramReplyTarget();
      if ("error" in target) return { status: 503, body: { success: false, error: target.error, code: "CONNECTOR_NOT_READY" } };
      const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl.trim() : "";
      // فيديو: رابط عام صريح، أو بايتات (videoBase64) تُستضاف تلقائياً عبر
      // Drive (Task #23) — إنستغرام يتطلب بروتوكولياً رابطاً عاماً، لا بايتات.
      const resolvedVideo = await resolvePublicVideoUrl(body);
      if (!resolvedVideo.ok) return { status: resolvedVideo.status, body: { success: false, error: resolvedVideo.error, code: resolvedVideo.code } };
      const videoUrl = resolvedVideo.url;
      const reel = body?.reel === true;
      // share_to_feed خاص بالريلز: يبقى true افتراضاً (ظهور في الموجز)؛ يقبله الخادم
      // صراحةً كي لا يُفقد سلوك «الفيديو في الموجز» بعد تحويل الفيديو إلى REELS.
      const shareToFeed = body?.shareToFeed === false ? false : true;
      const igPoll = { attempts: IG_CONTAINER_POLL_MAX_ATTEMPTS, intervalMs: containerPollIntervalMs() };
      const container = await createInstagramContainerReady(target.igAccountId, target.pageToken, { imageUrl, videoUrl, caption: content, reel, shareToFeed }, igPoll);
      if ("error" in container) {
        // MEDIA_REQUIRED يبقى فقط إن غاب الوسائط فعلاً قبل أي استدعاء شبكي؛ وإلا نُمرّر
        // كود Meta الحقيقي ورسالته بدل تثبيت MEDIA_REQUIRED الذي كان يُخفي السبب.
        const code = container.code || "MEDIA_REQUIRED";
        const isRealMediaRequired = !imageUrl && !videoUrl && code === "MEDIA_REQUIRED";
        // يُسجَّل الفشل (بمعرّف Meta/الرمز الفرعي/fbtrace) فيبقى قابلاً للسحب من المسار
        // المحمي للمالك بدل أن يضيع في سجلات Render — تشخيص «Invalid parameter» بلا تخمين.
        const failRecord = buildPublishRecord({ platform: platform as any, postId: typeof body?.postId === "string" ? body.postId : workspaceId("post"), providerPostId: null, simulated: false, error: container.error, code: isRealMediaRequired ? "MEDIA_REQUIRED" : code, providerCode: container.providerCode ?? null, providerSubcode: container.providerSubcode ?? null, providerTraceId: container.providerTraceId ?? null });
        if (!Array.isArray((workspace as any).publishRecords)) (workspace as any).publishRecords = [];
        (workspace as any).publishRecords.unshift({ ...failRecord, id: workspaceId("publish"), createdBy: user.id, receipt: null });
        if ((workspace as any).publishRecords.length > WORKSPACE_MAX_PUBLISH_RECORDS) (workspace as any).publishRecords.length = WORKSPACE_MAX_PUBLISH_RECORDS;
        persistState();
        return { status: isRealMediaRequired ? 422 : 502, body: { success: false, record: failRecord, error: container.error, code: isRealMediaRequired ? "MEDIA_REQUIRED" : code, providerCode: container.providerCode ?? null, providerSubcode: container.providerSubcode ?? null, providerTraceId: container.providerTraceId ?? null, note: isRealMediaRequired ? "Instagram لا ينشر نصاً فقط؛ زوّد imageUrl أو videoUrl عاماً." : "فشل نشر Instagram بالسبب الحقيقي من Meta (يتضمّن انتظار جاهزية الحاوية قبل النشر)." } };
      }
      const published = await instagramClient().publishContainer(target.igAccountId, target.pageToken, container.containerId);
      const receipt = published.ok ? { provider: "instagram", igAccountId: target.igAccountId, containerId: container.containerId, postId: published.data?.providerPostId, mediaKind: container.mediaKind, sentAt: new Date().toISOString() } : null;
      const record = buildPublishRecord({ platform: platform as any, postId: typeof body?.postId === "string" ? body.postId : workspaceId("post"), providerPostId: published.data?.providerPostId || null, simulated: false, error: published.ok ? null : published.error, code: published.code ?? null, providerCode: published.providerCode ?? null, providerSubcode: published.providerSubcode ?? null, providerTraceId: published.providerTraceId ?? null });
      if (!Array.isArray((workspace as any).publishRecords)) (workspace as any).publishRecords = [];
      (workspace as any).publishRecords.unshift({ ...record, id: workspaceId("publish"), createdBy: user.id, receipt });
      if ((workspace as any).publishRecords.length > WORKSPACE_MAX_PUBLISH_RECORDS) (workspace as any).publishRecords.length = WORKSPACE_MAX_PUBLISH_RECORDS;
      persistState();
      audit(user.id, published.ok ? "platform_publish_published" : "platform_publish_failed", `${platform}`);
      if (!published.ok) return { status: 502, body: { success: false, record, error: published.error, containerId: container.containerId, code: published.code || "PROVIDER_ERROR", providerCode: published.providerCode ?? null, providerSubcode: published.providerSubcode ?? null, providerTraceId: published.providerTraceId ?? null, note: "لم يُسجَّل أي نشر بلا معرّف منشور حقيقي من المزود." } };
      return { status: 200, body: { success: true, record, providerPostId: published.data?.providerPostId, containerId: container.containerId, receipt } };
    }
    if (platform === "threads") {
      // نشر Threads (Task #24) عبر الخطوتين الرسميتين: حاوية ثم نشر — نفس بنية
      // إنستغرام. خلافاً لإنستغرام، نص مجرّد (TEXT) مقبول رسمياً فلا يُطلب وسيط.
      const target = threadsPublishTarget();
      if ("error" in target) return { status: 503, body: { success: false, error: target.error, code: "CONNECTOR_NOT_READY" } };
      const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl.trim() : "";
      // فيديو: رابط عام صريح، أو بايتات (videoBase64) تُستضاف تلقائياً عبر Drive (Task #23).
      const resolvedVideo = await resolvePublicVideoUrl(body);
      if (!resolvedVideo.ok) return { status: resolvedVideo.status, body: { success: false, error: resolvedVideo.error, code: resolvedVideo.code } };
      const videoUrl = resolvedVideo.url;
      const replyToId = typeof body?.replyToId === "string" ? body.replyToId.trim() : "";
      // تجديد تلقائي للرمز الطويل قبل النشر (وإلا «Session has expired» بلا تفسير)،
      // مع انتظار جاهزية الحاوية قبل النشر (نفس جذر إنستغرام: النشر قبل FINISHED
      // يرد «Invalid parameter»). القيمة تُمرَّر محسوبةً لتفادي تعارض الأنواع.
      const thPollInterval = containerPollIntervalMs();
      const thContainer = await withThreadsToken((token) => createThreadsContainerReady(target.threadsUserId, token, { text: content, imageUrl, videoUrl, replyToId }, { attempts: IG_CONTAINER_POLL_MAX_ATTEMPTS, intervalMs: thPollInterval }));
      if (!thContainer.ok || !thContainer.data) {
        // لا تثبيت PROVIDER_ERROR؛ نُمرّر كود Meta الحقيقي ورسالته (مثلاً خطأ تنزيل
        // الوسائط 9007، أو انتهاء الرمز 190) بدل إخفاء السبب.
        return { status: 502, body: { success: false, error: thContainer.error, code: thContainer.code || "PROVIDER_ERROR", providerCode: thContainer.providerCode ?? null, providerSubcode: thContainer.providerSubcode ?? null, providerTraceId: thContainer.providerTraceId ?? null, note: "لم تُسجَّل أي حاوية بلا معرّف حقيقي من Threads (أو لم تجهز ضمن المهلة)." } };
      }
      const published = await withThreadsToken((token) => threadsClient().publishContainer(target.threadsUserId, token, thContainer.data!.containerId));
      const receipt = published.ok ? { provider: "threads", threadsUserId: target.threadsUserId, containerId: thContainer.data.containerId, postId: published.data?.providerPostId, mediaKind: thContainer.data.mediaKind, sentAt: new Date().toISOString() } : null;
      const record = buildPublishRecord({ platform: platform as any, postId: typeof body?.postId === "string" ? body.postId : workspaceId("post"), providerPostId: published.data?.providerPostId || null, simulated: false, error: published.ok ? null : published.error, code: published.code ?? null, providerCode: published.providerCode ?? null, providerSubcode: published.providerSubcode ?? null, providerTraceId: published.providerTraceId ?? null });
      if (!Array.isArray((workspace as any).publishRecords)) (workspace as any).publishRecords = [];
      (workspace as any).publishRecords.unshift({ ...record, id: workspaceId("publish"), createdBy: user.id, receipt });
      if ((workspace as any).publishRecords.length > WORKSPACE_MAX_PUBLISH_RECORDS) (workspace as any).publishRecords.length = WORKSPACE_MAX_PUBLISH_RECORDS;
      persistState();
      audit(user.id, published.ok ? "platform_publish_published" : "platform_publish_failed", `${platform}`);
      if (!published.ok) return { status: 502, body: { success: false, record, error: published.error, containerId: thContainer.data.containerId, code: published.code || "PROVIDER_ERROR", providerCode: published.providerCode ?? null, providerSubcode: published.providerSubcode ?? null, providerTraceId: published.providerTraceId ?? null, note: "لم يُسجَّل أي نشر بلا معرّف منشور حقيقي من المزود." } };
      return { status: 200, body: { success: true, record, providerPostId: published.data?.providerPostId, containerId: thContainer.data.containerId, receipt } };
    }
    if (platform === "tiktok") {
      // TikTok لا ينشر نصاً فقط: يلزم فيديو (أو صور) عبر رابط عام أو ملف.
      // لا يُسجَّل أي نشر بلا publish_id من TikTok.
      const mode: TikTokPostMode = body?.postMode === "DIRECT_POST" ? "DIRECT_POST" : "MEDIA_UPLOAD";
      const privacy: TikTokPrivacyLevel = (TIKTOK_PRIVACY_LEVELS as readonly string[]).includes(String(body?.privacyLevel)) ? (body.privacyLevel as TikTokPrivacyLevel) : "SELF_ONLY";
      // فيديو: رابط عام صريح، أو بايتات (videoBase64) تُستضاف تلقائياً عبر
      // Drive (Task #23) — PULL_FROM_URL يتطلب بروتوكولياً رابطاً عاماً.
      const resolvedVideo = await resolvePublicVideoUrl(body);
      if (!resolvedVideo.ok) return { status: resolvedVideo.status, body: { success: false, error: resolvedVideo.error, code: resolvedVideo.code } };
      const videoUrl = resolvedVideo.url;
      const photoUrls = Array.isArray(body?.photoUrls) ? body.photoUrls.map((u: any) => String(u).trim()).filter(Boolean) : [];
      if (!videoUrl && !photoUrls.length) {
        return { status: 422, body: { success: false, error: "TikTok لا ينشر نصاً فقط؛ زوّد videoUrl أو photoUrls عامة.", code: "MEDIA_REQUIRED", note: "Content Posting API يلزمه فيديو أو صور عبر PULL_FROM_URL." } };
      }
      // منع التكرار: بصمة (المحتوى + الوسائط + الوضع) تمنع إنشاء نفس النشر مرتين.
      const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ content, videoUrl, photoUrls, mode, privacy })).digest("hex");
      if (!Array.isArray((workspace as any).publishRecords)) (workspace as any).publishRecords = [];
      const dup = (workspace as any).publishRecords.find((r: any) => r.platform === "tiktok" && r.idempotencyKey === fingerprint && r.state !== "failed");
      if (dup) return { status: 409, body: { success: false, error: "نفس النشر مُهيّأ سابقاً (منع تكرار).", code: "DUPLICATE_PUBLISH", existing: { providerPublishId: dup.providerPublishId, state: dup.state } } };
      // معلومات الناشر إلزامية قبل أي نشر مباشر (وثيقة TikTok) — لا تُطلب في رفع المسودة.
      const creatorInfo = mode === "DIRECT_POST" ? await withTikTokToken((token) => tiktokClient().queryCreatorInfo(token)) : { ok: true as const, data: null };
      if (mode === "DIRECT_POST" && (!creatorInfo.ok || !creatorInfo.data)) {
        return { status: 502, body: { success: false, error: (creatorInfo as any).error || "تعذّر قراءة معلومات الناشر قبل النشر المباشر.", code: "CREATOR_INFO_FAILED" } };
      }
      // المسار الرسمي يختلف حسب الوضع:
      //  - DIRECT_POST: فيديو عبر /v2/post/publish/video/init/ (نطاق video.publish)
      //    أو صور عبر /v2/post/publish/content/init/ بـmedia_type=PHOTO.
      //  - MEDIA_UPLOAD (مسودة): فيديو عبر /v2/post/publish/inbox/video/init/
      //    (نطاق video.upload، بجسم source_info فقط) أو صور عبر content/init/
      //    بـpost_mode=MEDIA_UPLOAD. لا يُرسل privacy_level في وضع المسودة.
      const initResult = await withTikTokToken((token) => {
        if (mode === "DIRECT_POST") {
          return videoUrl
            ? tiktokClient().initVideoPost(token, buildVideoPostBody({ postMode: mode, title: content, privacyLevel: privacy, source: "PULL_FROM_URL", videoUrl }))
            : tiktokClient().initPhotoPost(token, buildPhotoPostBody({ postMode: mode, title: content, privacyLevel: privacy, photoUrls }));
        }
        return videoUrl
          ? tiktokClient().initVideoDraft(token, buildVideoDraftBody({ source: "PULL_FROM_URL", videoUrl }))
          : tiktokClient().initPhotoPost(token, buildPhotoPostBody({ postMode: mode, title: content, photoUrls }));
      });
      if (!initResult.ok || !initResult.data) {
        const record = buildPublishRecord({ platform: platform as any, postId: typeof body?.postId === "string" ? body.postId : workspaceId("post"), providerPostId: null, simulated: false, error: initResult.error });
        (workspace as any).publishRecords.unshift({ ...record, id: workspaceId("publish"), createdBy: user.id, idempotencyKey: fingerprint, postMode: mode, receipt: null });
        if ((workspace as any).publishRecords.length > WORKSPACE_MAX_PUBLISH_RECORDS) (workspace as any).publishRecords.length = WORKSPACE_MAX_PUBLISH_RECORDS;
        persistState();
        audit(user.id, "platform_publish_failed", "tiktok");
        return { status: 502, body: { success: false, record, error: initResult.error, code: initResult.code || "PROVIDER_ERROR", note: "لم يُسجَّل أي نشر بلا معرّف نشر من TikTok." } };
      }
      // التهيئة نجحت: يُحفظ publish_id ويبقى التسليم معلّقاً حتى PUBLISH_COMPLETE.
      const publishId = initResult.data.publishId;
      // رفع المسودة لا يحتاج audit (video.upload)؛ النشر العام يحتاجه (video.publish).
      const modeRequiresAudit = mode === "DIRECT_POST" ? tiktokAuditRequired() : false;
      const record = buildPublishRecord({ platform: platform as any, postId: typeof body?.postId === "string" ? body.postId : workspaceId("post"), providerPostId: null, simulated: false, error: null });
      (workspace as any).publishRecords.unshift({
        ...record,
        // الحالة الحقيقية الآن: تهيئة تمت لكن التسليم لم يُثبت بعد.
        state: "publishing",
        id: workspaceId("publish"), createdBy: user.id, idempotencyKey: fingerprint, postMode: mode, privacyLevel: privacy,
        providerPublishId: publishId, uploadUrl: (initResult.data as any).uploadUrl || null,
        auditRequired: modeRequiresAudit,
        receipt: { provider: "tiktok", publishId, postMode: mode, createdAt: new Date().toISOString() },
      });
      if ((workspace as any).publishRecords.length > WORKSPACE_MAX_PUBLISH_RECORDS) (workspace as any).publishRecords.length = WORKSPACE_MAX_PUBLISH_RECORDS;
      persistState();
      audit(user.id, "platform_publish_initiated", `tiktok:${mode}`);
      return { status: 200, body: {
        success: true, record, providerPublishId: publishId, postMode: mode,
        delivered: false,
        auditRequired: modeRequiresAudit,
        note: mode === "DIRECT_POST"
          ? "تمت تهيئة النشر المباشر لدى TikTok (publish_id). لا يُعلن التسليم إلا بحالة PUBLISH_COMPLETE عبر GET /api/platforms/tiktok/publish-status."
          : "تمت تهيئة رفع المسودة لدى TikTok (publish_id). المحتوى في صندوق TikTok وينشره المالك من التطبيق؛ لا يُعلن أي نشر عام.",
      } };
    }
    return { status: 501, body: { success: false, error: "الموصل متصل لكن تنفيذ النشر لهذه المنصة يحتاج بيانات المزود ولم يُختلق تنفيذ وهمي.", code: "EXTERNAL_SETUP_REQUIRED", platform } };
  } catch (e: any) {
    return { status: 502, body: { success: false, error: String(e?.message || e).slice(0, 300), code: "PROVIDER_ERROR" } };
  }

}

app.post("/api/platforms/:platform/publish", requireOwner, async (req, res) => {
  const user = (req as any).user as { id: string };
  const result = await executePlatformPublish(req.params.platform, req.body, user.id);
  return res.status(result.status).json(result.body);
});
/**
 * مؤشرات موحّدة (Batch 6): أي مؤشر غير مدعوم أو غير متوفر يُعلن NOT_SUPPORTED
 * ولا يُخترع له صفر. غير المتصل يُعلن صراحةً أنه لا جلب خارجي.
 */
app.get("/api/platforms/:platform/metrics", authenticateToken, async (req, res) => {
  const platform = req.params.platform;
  if (!isSupportedPlatform(platform)) return res.status(404).json({ success: false, error: "المنصة غير مدعومة." });
  const externalId = typeof req.query.externalId === "string" ? req.query.externalId : "";
  const adapter = buildAdapters((p) => { const c = platformConnections.get(p); return c ? { status: c.status, accountId: c.accountId, accountName: c.accountName, connectedAt: c.connectedAt, providerVerified: c.providerVerified } : null; }).find((a) => a.platform === platform)!;
  if (!adapter.supports("analytics")) {
    return res.json({ success: true, envelope: fetchPostMetrics(platform as PlatformId, externalId, {}), note: "المنصة لا تدعم التحليلات عبر واجهتها الرسمية؛ كل المؤشرات NOT_SUPPORTED." });
  }
  const conn: any = platformConnections.get(platform);
  if (!conn || conn.status !== "connected" || conn.providerVerified !== true) {
    return res.json({ success: true, envelope: fetchPostMetrics(platform as PlatformId, externalId, {}), externalFetchAvailable: false, note: "المنصة غير متصلة باتصال موثق؛ لا جلب مؤشرات خارجي، والقيم غير متاحة." });
  }
  // لا نختلق قيماً: بلا تنفيذ جلب إنتاجي معتمد، تُعلن كل القيم NOT_SUPPORTED.
  return res.json({ success: true, envelope: fetchPostMetrics(platform as PlatformId, externalId, {}), externalFetchAvailable: true, note: "الاتصال موثق، لكن جلب المؤشرات الحقيقي يحتاج موصل تحليلات إنتاجي منفّذ؛ لا تُخترع أي قيمة." });
});

// Telegram real sender — إرسال رد حقيقي بعد الموافقة.
// الدورة: تعليق حقيقي → تصنيف → رد مقترح → سلامة المحتوى → موافقة → إرسال حقيقي
//         → نتيجة تسليم → حفظ. لا يُسجَّل delivered=true إلا باستجابة Telegram حقيقية.
// المسار مقيّد بالمالك لأنه يُرسل فعلاً باسم حساب المعرض.
// -------------------------------------------------------------
app.post("/api/platforms/telegram/reply", requireOwner, async (req,res)=>{
  const user = (req as any).user as { id: string };
  const externalId = typeof req.body?.externalId === "string" ? req.body.externalId.trim() : "";
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const commentText = typeof req.body?.commentText === "string" ? req.body.commentText : "";
  if(!externalId) return res.status(400).json({success:false,error:"معرّف التعليق لدى المنصة مطلوب لمنع الرد المكرر."});
  if(!text) return res.status(400).json({success:false,error:"نص الرد مطلوب."});
  // REL-01: حجز ذرّي لمنع رد مكرر فعلي عند تزامن طلبين على نفس التعليق.
  const replyLock = replyLockKey("telegram","comment",externalId);
  if(!acquireReplyLock(replyLock)) return res.status(409).json({success:false,error:"طلب رد آخر على نفس التعليق قيد التنفيذ بالفعل؛ انتظر حتى يكتمل لمنع التكرار.",code:"REPLY_IN_PROGRESS"});
  try{
  // وضع YOUTUBE_ONLY_OPERATIONAL: يمنع أي إرسال خارجي على منصة غير YouTube.
  const onlyBlock = youtubeOnlyBlock("telegram");
  if (onlyBlock.blocked) return res.status(onlyBlock.status!).json(onlyBlock.body);

  const conn:any = platformConnections.get("telegram");
  if(!conn || conn.status!=="connected" || conn.providerVerified!==true){
    return res.status(409).json({success:false,error:"Telegram غير متصل باتصال موثق؛ لا يمكن إرسال أي رد خارجي."});
  }
  const comment = (workspace as any).socialComments.find((c:any)=>c.platform==="telegram"&&c.externalId===externalId);
  if(!comment) return res.status(404).json({success:false,error:"لا يوجد تعليق وارد بهذا المعرّف؛ لا إرسال بلا تعليق حقيقي."});
  const target = comment.replyTarget || {};
  if(!target.chatId) return res.status(409).json({success:false,error:"هدف الرد (الدردشة) غير متوفر لهذا التعليق."});

  // 1) لا رد على الحالات الحساسة/السبام/تعليقنا (نفس حمايات التعليقات).
  const classification = classifyComment(commentText || text);
  if(!canAutoReply(classification)) return res.status(422).json({success:false,error:classification.reviewReason||"هذا التعليق يستوجب مراجعة بشرية قبل أي رد.",classification,requiresHumanReview:true});
  const ownNames = [String(workspace.showroom?.name||""),"معرض الغرابي"];
  if(isSelfAuthored(comment.authorName,ownNames)) return res.status(409).json({success:false,error:"التعليق صادر من حساب المعرض؛ لا يُرد عليه لتجنب حلقة ردود."});

  // 2) حارس سلامة المحتوى: لا عرض/سعر/رابط غير مسجّل يخرج للمنصة.
  const productId = typeof req.body?.productId === "string" ? req.body.productId.trim() : "";
  const productName = typeof req.body?.productName === "string" ? req.body.productName.trim() : "";
  const product = (workspace.products||[]).find((p:any)=>
    (productId && p.id === productId) || (productName && p.name === productName)) || null;
  const replyFacts = buildFactsForProduct(product, Number(product?.downPaymentPercent||0), Number(product?.durationMonths||0));
  const safety = analyzeBusinessClaims(text, replyFacts);
  if(!safety.safe){
    return res.status(422).json({success:false,error:"نص الرد يحمل عرضاً تجارياً غير مسجّل، وتم إيقافه قبل أي إرسال.",
      contentSafety:{safe:false,violations:safety.blocked.map((v)=>v.detail),codes:safety.blocked.map((v)=>v.code)}});
  }

  // 3) بوابة الرد المكرر (على معرّف التعليق الخارجي — يمنع replay/retry).
  const history: ReplyRecord[] = (workspace as any).socialReplies.filter((r:any)=>r.platform==="telegram").map((r:any)=>({externalId:r.externalId,replyFingerprint:r.replyFingerprint,repliedAt:r.repliedAt}));
  const decision = evaluateReplyGuard({externalId,replyText:text,history});
  if(!decision.allowed) return res.status(409).json({success:false,error:decision.reason,guard:decision});

  // 4) إرسال حقيقي عبر Telegram. لا تسجيل تسليم بلا استجابة مزود.
  const client = telegramClient();
  if(!client) return res.status(503).json({success:false,error:"موصل Telegram غير مهيأ (رمز بوت غير متوفر)."});
  const result = await client.sendMessage({chatId:String(target.chatId),text,replyToMessageId:target.messageId?String(target.messageId):undefined});

  const record = {
    id: workspaceId("reply"), platform:"telegram", externalId, text,
    replyFingerprint: decision.fingerprint, classification,
    contentSafety:{safe:true,violations:[] as string[],codes:[] as string[]},
    repliedAt:new Date().toISOString(), createdBy:user.id,
    simulated:false,
    delivered:result.ok,
    providerReplyId: result.providerMessageId,
    receipt: result.receipt,
    deliveryError: result.ok ? null : (result.error||"فشل الإرسال عبر Telegram."),
    reviewStatus: result.ok ? "delivered" : "failed",
    note: result.ok
      ? "أُرسل الرد فعلياً عبر Telegram وثُبّت بمعرّف رسالة من المزود."
      : "فشل الإرسال عبر Telegram؛ لم يُسجَّل أي تسليم.",
  };
  if(!Array.isArray((workspace as any).socialReplies)) (workspace as any).socialReplies=[];
  (workspace as any).socialReplies.unshift(record);
  if((workspace as any).socialReplies.length>WORKSPACE_MAX_SOCIAL_REPLIES) (workspace as any).socialReplies.length=WORKSPACE_MAX_SOCIAL_REPLIES;
  audit(user.id, result.ok?"social_telegram_reply_sent":"social_telegram_reply_failed", `${externalId}:${result.ok?"delivered":"failed"}`);
  persistState();
  if(!result.ok) return res.status(502).json({success:false,delivered:false,simulated:false,reply:record,error:record.deliveryError});
  res.json({success:true,delivered:true,simulated:false,providerReplyId:result.providerMessageId,reply:record});
  } finally { releaseReplyLock(replyLock); }
});

app.get("/api/platforms/:platform/health", authenticateToken, async (req,res)=>{
  const platform=req.params.platform;
  const c:any=platformConnections.get(platform);
  if(!c || c.status!=="connected" || c.providerVerified!==true) return res.status(409).json({success:false,platform,healthy:false,error:"المنصة غير متصلة باتصال مزود موثق."});
  try {
    const token:any=getProviderToken(platform);
    if(platform==="telegram") {
      // فحص حقيقي فعلي عبر TelegramClient؛ الرمز المسحوب/المبطَل يُعلن reauth_needed.
      const client = telegramClient();
      if(!client) throw new Error("توكن Telegram غير متوفر.");
      const me = await client.getMe();
      if(!me.ok){
        // رمز مرفوض = الاتصال لم يعد صالحاً؛ نُعلن reauth_needed ولا ندّعي الصحة.
        platformConnections.set("telegram",{...(c||{}),platform:"telegram",status:"reauth_needed"});
        savePlatformConnections(); audit((req as any).user.id,"telegram_health_failed","reauth_needed");
        return res.status(409).json({success:false,platform,healthy:false,provider:"telegram",status:"reauth_needed",error:me.error||"رمز Telegram لم يعد صالحاً."});
      }
      return res.json({success:true,platform,healthy:true,provider:"telegram",accountId:me.botId,accountName:me.username?`@${me.username}`:me.firstName||c.accountName,webhookConfigured:Boolean(telegramWebhookSecret()),checkedAt:new Date().toISOString()});
    }
    if(platform==="youtube") {
      if(!token?.access_token) throw new Error("رمز YouTube غير متوفر.");
      // فحص حقيقي فعلي عبر عميل YouTube (يحترم YOUTUBE_API_BASE في الاختبار)، مع
      // تجديد تلقائي عند انتهاء الرمز. الرمز يُرفض/تنقص صلاحيته فقط عندها يُعلن
      // reauth_needed بلا ادعاء صحة؛ أما انتهاء access token فيُجدَّد بلا إزعاج.
      const proof=await fetchYouTubeChannelResilient();
      if(!proof.ok||!proof.data?.channelId){
        // حصة Data API مستنفدة: ليس عطل ربط — نُعلن 429 صراحةً ولا ندّعي reauth كاذباً.
        if(proof.code==="quota_exceeded"){
          return res.status(429).json({success:false,platform,healthy:false,provider:"youtube",status:"quota_exceeded",error:proof.error||"حصة YouTube Data API مستنفدة؛ تُستأنف بعد تجدّد الحصة اليومية.",errorKind:proof.code});
        }
        // رمز مرفوض/صلاحية ناقصة = الاتصال لم يعد صالحاً؛ نُعلن reauth_needed بلا ادعاء صحة.
        platformConnections.set("youtube",{...(c||{}),platform:"youtube",status:"reauth_needed"});
        savePlatformConnections();
        // تنبيه المالك مرة واحدة: توقّف الرد الآلي فعلياً ويحتاج إعادة ربط (بلا إغراق).
        maybeAlertYouTubeReauth();
        return res.status(409).json({success:false,platform,healthy:false,provider:"youtube",status:"reauth_needed",error:proof.error||"تعذّر إثبات هوية قناة YouTube.",errorKind:proof.code??null});
      }
      return res.json({success:true,platform,healthy:true,provider:"youtube",accountId:proof.data.channelId,accountName:proof.data.title||c.accountName,checkedAt:new Date().toISOString(),tokenRefreshed:Boolean(proof.refreshed)});
    }
    if(platform==="tiktok") {
      if(!token?.access_token) throw new Error("رمز TikTok غير متوفر.");
      const r=await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",{headers:{Authorization:`Bearer ${token.access_token}`}}); const d=await r.json();
      return res.status(r.ok&&Boolean(d.data?.user)?200:502).json({success:r.ok&&Boolean(d.data?.user),platform,healthy:r.ok&&Boolean(d.data?.user),provider:"tiktok",accountId:d.data?.user?.open_id||c.accountId,accountName:d.data?.user?.display_name||c.accountName,checkedAt:new Date().toISOString()});
    }
    if(platform==="google_business") {
      if(!token?.access_token) throw new Error("رمز Google Business Profile غير متوفر.");
      const r=await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts",{headers:{Authorization:`Bearer ${token.access_token}`}}); const d=await r.json();
      return res.status(r.ok?200:502).json({success:r.ok,platform,healthy:r.ok,provider:"google_business",accounts:Array.isArray(d.accounts)?d.accounts.map((x:any)=>({name:x.name,displayName:x.accountName||x.name})):[],checkedAt:new Date().toISOString()});
    }
    return res.status(501).json({success:false,platform,healthy:false,error:"لا يوجد فحص مزود إنتاجي لهذا الموصل حتى الآن."});
  } catch(e:any) { return res.status(502).json({success:false,platform,healthy:false,error:String(e?.message||e).slice(0,240)}); }
});

app.get("/api/platforms/readiness", authenticateToken, (_req,res)=>res.json({success:true,platforms:SUPPORTED_PLATFORMS.map(p=>({platform:p.id,name:p.name,connection:safeConnection(p.id)})),generatedAt:new Date().toISOString()}));

app.get("/api/platforms/production-readiness", authenticateToken, (_req,res)=>{
  const rows=SUPPORTED_PLATFORMS.map((p:any)=>{ const r=publicProviderReadiness(p.id); const c:any=platformConnections.get(p.id); const connected=Boolean(c?.status==="connected" && c?.providerVerified===true); const production=connected && hasRealConnector(p.id); return {platform:p.id,name:p.name,configured:r.configured,connected,providerVerified:Boolean(c?.providerVerified),productionReady:production,realConnector:hasRealConnector(p.id),credentialMode:credentialModeOf(p.id),mode:r.mode,missing:r.missing||[],next:p.id==="telegram"?"ضبط Bot Token ثم الضغط على «ربط Telegram» لتسجيل webhook حقيقي":OAUTH_CONFIG[p.id]?"ضبط بيانات OAuth ثم تسجيل Redirect URI والربط": "إضافة موصل إنتاجي معتمد قبل تفعيل النشر"}; });
  res.json({success:true,generatedAt:new Date().toISOString(),projectVersion:PROJECT_VERSION,summary:{total:rows.length,connected:rows.filter(x=>x.connected).length,productionReady:rows.filter(x=>x.productionReady).length},platforms:rows,note:"هذه الصفحة تميز الجاهزية التقنية عن الاتصال الفعلي ولا تمنح أي منصة حالة نجاح وهمية. productionReady يتطلب موصلاً حقيقياً منفّذاً + اتصالاً موثقاً."});
});

/**
 * مصفوفة جاهزية المنصات (Batch 6): مصدر واحد يعكس حالة الكود الحقيقية لكل منصة
 * (موصل/OAuth/اتصال/تحقق/webhook/قراءة/رد/نشر/جدولة/تحليلات + متطلبات خارجية).
 * لا تحمل أي حالة اتصال تشغيلية — تلك تُقرأ من `connection` منفصلاً.
 */
app.get("/api/platforms/readiness-matrix", authenticateToken, (_req,res)=>{
  const liveFor = (p:string): LiveConnection => { const c:any=platformConnections.get(p); return { status: c?.status||"disconnected", providerVerified: Boolean(c?.providerVerified), accountName: c?.accountName||null }; };
  // الصفوف الغنية: جاهزية الكود + حالة الاعتماد + الحالة التشغيلية الآن + الحجب والإجراء التالي.
  const fbPending = facebookPageSelectionPending();
  const igPending = instagramPageSelectionPending();
  const platforms = buildReadinessDetails(liveFor, process.env).map((r)=>({ ...r, pageSelectionPending: r.platform === 'facebook' ? fbPending : r.platform === 'instagram' ? igPending : undefined, connection: { status: r.connected ? "connected" : "disconnected", providerVerified: r.providerVerified, accountName: null } }));
  res.json({success:true,generatedAt:new Date().toISOString(),projectVersion:PROJECT_VERSION,summary:readinessSummary(),platforms,note:"levels أعلاه تصف الكود؛ operational تصف ما يعمل الآن فعلاً، وstate هي الحالة الجامعة الدقيقة. لا تحمل أي سرّ."});
});

/**
 * مركز ربط المنصات (Batch 7): حالة كل منصة بدقة + ما ينقص + الإجراء التالي،
 * مع بوابات العمليات الثماني. لا يحمل أي قيمة سرّية — أسماء المتغيرات فقط.
 */
app.get("/api/platforms/control-plane", authenticateToken, (_req,res)=>{
  const liveFor = (p:string): LiveConnection => { const c:any=platformConnections.get(p); return { status: c?.status||"disconnected", providerVerified: Boolean(c?.providerVerified), accountName: c?.accountName||null }; };
  const statuses = computeAllPlatformStatuses(liveFor, process.env);
  // Facebook خاص: قد يكتمل OAuth بينما ينتظر اختيار الصفحة. تُعلن هذه الحالة
  // صراحةً ولا تُترك الواجهة تظن أن الربط لم يبدأ فتعيد OAuth بلا نهاية.
  const fbPending = facebookPageSelectionPending();
  const igPending = instagramPageSelectionPending();
  const platforms = statuses.map((s)=> s.platform === "facebook" && fbPending
    ? { ...s, pageSelectionPending: true, blockingReason: "تم تفويض Facebook بنجاح، لكن الحساب يدير أكثر من صفحة. اختر الصفحة المطلوبة لإتمام الربط.", nextAction: "اختر الصفحة «معرض الغرابي للتقسيط» من زر «اختيار الصفحة» لإتمام الربط والاشتراك في webhook." }
    : s.platform === "instagram" && igPending
      ? { ...s, pageSelectionPending: true, blockingReason: "تم تفويض Meta بنجاح، لكن الحساب يدير أكثر من صفحة لها حساب Instagram مهني. اختر الحساب المطلوب لإتمام الربط.", nextAction: "اختر حساب Instagram المطلوب من زر «اختيار الحساب» لإتمام الربط والاشتراك في webhook." }
      : { ...s, pageSelectionPending: s.platform === "facebook" || s.platform === "instagram" ? false : undefined });
  res.json({ success:true, generatedAt:new Date().toISOString(), projectVersion:PROJECT_VERSION, summary:controlSummary(statuses), platforms, note:"الحالات منفصلة: CODE_READY ≠ CONFIGURED ≠ CONNECTED ≠ VERIFIED ≠ OPERATIONAL. لا تُعلن OPERATIONAL إلا باتصال موثق وموصل منفّذ." });
});

app.get("/api/platforms/:platform/control", authenticateToken, (req,res)=>{
  const platform = req.params.platform;
  if(!isSupportedPlatform(platform)) return res.status(404).json({success:false,error:"منصة غير مدعومة."});
  const c:any=platformConnections.get(platform);
  let status = computePlatformStatus(platform as PlatformId, { status: c?.status||"disconnected", providerVerified: Boolean(c?.providerVerified), accountName: c?.accountName||null }, process.env);
  if(!status) return res.status(404).json({success:false,error:"منصة غير مدعومة."});
  const fbPending = platform === "facebook" && facebookPageSelectionPending();
  if (fbPending) status = { ...status, pageSelectionPending: true, blockingReason: "تم تفويض Facebook بنجاح، لكن الحساب يدير أكثر من صفحة. اختر الصفحة المطلوبة لإتمام الربط.", nextAction: "اختر الصفحة «معرض الغرابي للتقسيط» من زر «اختيار الصفحة» لإتمام الربط والاشتراك في webhook." } as any;
  const igPending = platform === "instagram" && instagramPageSelectionPending();
  if (igPending) status = { ...status, pageSelectionPending: true, blockingReason: "تم تفويض Meta بنجاح، لكن الحساب يدير أكثر من صفحة لها حساب Instagram مهني. اختر الحساب المطلوب لإتمام الربط.", nextAction: "اختر حساب Instagram المطلوب من زر «اختيار الحساب» لإتمام الربط والاشتراك في webhook." } as any;
  const creds = inspectPlatformCredentials(platform as PlatformId, process.env);
  res.json({ success:true, control:status, credentials:{ connection:creds.connection, webhook:creds.webhook, requiredEnvNames:creds.requiredEnvNames, optionalEnvNames:creds.optionalEnvNames },
    // Facebook Login for Business: هل يُستخدم config_id بدل scope؟ (منطقي فقط بلا قيمة)
    loginConfig: META_OAUTH_PLATFORMS.has(platform) ? { envNames: loginConfigEnvNames(platform), configured: loginConfigInspection(platform).configured, valid: loginConfigInspection(platform).valid, used: Boolean(loginConfigIdFor(platform)), problems: loginConfigInspection(platform).problems } : undefined,
    note:"أسماء متغيرات فقط، بلا قيم." });
});

/**
 * متطلبات الإعداد الخارجي لكل منصة (بلا أسرار): ما على المالك فعله لدى المزود.
 * يقرأ من CREDENTIAL_SPECS (أسماء) + readiness.externalSetup (خطوات).
 */
app.get("/api/platforms/external-setup", authenticateToken, (_req,res)=>{
  const rows = buildReadinessDetails((p)=>{ const c:any=platformConnections.get(p); return { status: c?.status||"disconnected", providerVerified: Boolean(c?.providerVerified) }; }, process.env)
    .map((r)=>({ platform:r.platform, displayName:r.displayName, credentialMode:r.credentialMode, requiredEnvNames:inspectPlatformCredentials(r.platform, process.env).requiredEnvNames, steps:r.externalSetup, blockingReason:r.blockingReason, nextAction:r.nextAction, operationalState:r.operationalState }));
  res.json({ success:true, generatedAt:new Date().toISOString(), platforms:rows, note:"خطوات وأسماء متغيرات فقط — لا أسرار. لا تُنشأ حسابات نيابة عن المالك." });
});

app.get("/api/platforms/:platform/readiness", authenticateToken, (req,res)=>{
  const row=readinessFor(req.params.platform);
  if(!row) return res.status(404).json({success:false,error:"منصة غير مدعومة."});
  const c:any=platformConnections.get(row.platform);
  res.json({success:true,readiness:row,connection:{status:c?.status||"disconnected",providerVerified:Boolean(c?.providerVerified)}});
});

/**
 * إعداد OAuth الدقيق لمنصة (للمالك فقط) — بلا أي سرّ. يعطي المالك حرفياً ما
 * يحتاجه لتسجيله لدى Meta/Google: الرابط الفعلي لـredirect_uri، النطاق، والقيمة
 * المطلوبة في حقل App Domains، والمصدر الذي حُسم منه العنوان إنشاءً.
 * هذا ما كان ناقصاً فعلاً: الرسالة «النطاق غير مُضمَّن» بلا القيمة الصحيحة
 * تُبقي المالك يدور بلا نهاية.
 */
app.get("/api/platforms/:platform/oauth/setup", requireOwner, async (req,res)=>{
  const platform=String(req.params.platform);
  const cfg=OAUTH_CONFIG[platform];
  if(!cfg) return res.status(404).json({success:false,error:"منصة بلا مسار OAuth مُعرَّف."});
  const urlInfo=resolvePublicUrl(process.env);
  const redirectUri=`${urlInfo.baseUrl||publicBaseUrlNow()}/api/platforms/${platform}/oauth/callback`;
  const publicOk=publicUrlIsPublic();
  // Facebook/Instagram: الصلاحيات النهائية مع الاعتماديات الرسمية + أي فارق في تجاوز البيئة.
  const resolvedScopes = platform==="facebook" ? facebookOAuthScopes() : platform==="instagram" ? instagramOAuthScopes() : platform==="tiktok" ? tiktokOAuthScopes() : platform==="youtube" ? youtubeOAuthScopes() : cfg.scopes;
  const scopeDependencyGaps = platform==="facebook" ? facebookScopeDependencyGaps() : platform==="instagram" ? instagramScopeDependencyGaps() : [];
  const metaScopesResolved = platform==="facebook"||platform==="instagram";
  // YouTube: نطاق القراءة المطلوب لإثبات القناة + مصفوفة القدرات (بلا سرّ).
  const youtubeReadonlyPresent = platform==="youtube" && youtubeOAuthScopes().includes(YOUTUBE_READONLY_SCOPE);
  // فحص حي لسلسلة حوار Meta كما يسلكها متصفح المالك الجوال (www → m.facebook.com).
  // الغرض: يرى المالك القفزة التي ترفض بالضبط (مضيف/مسار/حالة) بلا بدء OAuth وبلا
  // أي سرّ ولا استعلام. لا يُحجب شيء هنا؛ الفحص تشخيصي فقط.
  let mobileDialogProbe: any = undefined;
  if (metaScopesResolved) {
    try {
      const p = await probeMetaDialog({ authorizationUrl: buildAuthorizationUrlForProbe(platform) });
      mobileDialogProbe = {
        probed: true,
        probedAsMobile: true,
        mobileHostReached: Boolean(p.mobileHost),
        outcome: p.ok ? "acceptable" : "rejected",
        kind: p.kind,
        errorCode: p.errorCode,
        httpStatus: p.httpStatus,
        rejectionHost: p.rejectionHost ?? null,
        rejectionPath: p.rejectionPath ?? null,
        hops: p.hops ?? [],
        note: "فحص بوكيل جوال حقيقي وبلا متابعة تلقائية وبلا كوكيز: لا يُنفَّذ أي موافقة. يعرض المضيف/المسار فقط (بلا استعلام).",
      };
    } catch (e: any) {
      mobileDialogProbe = { probed: false, probedAsMobile: true, error: String(e?.message || "تعذّر الفحص"), note: "تعذّر إجراء الفحص (شبكة)؛ لا يُحجب شيء." };
    }
  }
  res.json({
    success:true,
    platform,
    provider:cfg.provider,
    authorizationEndpoint:cfg.auth,
    graphVersion:platform==="facebook"||platform==="instagram"?"v21.0":undefined,
    redirectUri,
    domain:urlInfo.host,
    appDomainsValue:urlInfo.host && !isLocalHost(urlInfo.host) ? `https://${urlInfo.host}` : null,
    publicUrlSource:urlInfo.source,
    publicUrlValid:urlInfo.valid,
    publicUrlProblems:urlInfo.problems,
    publicUrlIsPublic:publicOk,
    scopes:resolvedScopes,
    scopeOverrideConfigured:platform==="facebook"?facebookScopeOverride().length>0:platform==="instagram"?instagramScopeOverride().length>0:undefined,
    scopeDependenciesResolved:metaScopesResolved?true:undefined,
    scopeDependencyGaps:scopeDependencyGaps.length?scopeDependencyGaps:undefined,
    // TikTok: إعداد OAuth الدقيق + مصفوفة القدرات الرسمية (بلا أي سرّ).
    tiktokSetup:platform==="tiktok"?{
      clientKeyConfigured:Boolean(cfg.clientId),
      clientKeyFormatOk:isPlausibleTikTokClientKey(String(cfg.clientId||"")),
      clientSecretConfigured:Boolean(cfg.clientSecret),
      // تشخيص مفتاح التطبيق: القيمة المُخفاة (أول 4 وآخر 4) + البصمة للمقارنة مع
      // لوحة TikTok Developers، وما يظهر فعلاً في رابط التفويض، وإثبات المفتاح
      // لدى TikTok. يُنفَّذ طلب عميل واحد فقط (client_credentials) بلا أي سرّ معروض.
      clientKeyDiagnosis:await tiktokClientKeyDiagnosis(),
      requestedScopes:tiktokOAuthScopes(),
      scopeOverrideConfigured:tiktokScopeOverride().length>0,
      // تدفّق الويب الرسمي لا يستخدم PKCE (code_challenge غير موثّق للويب)،
      // بخلاف الجوال/سطح المكتب. نُعلن الحقيقة بدل ادعاء تدفّق غير مطابق للعقد.
      pkceUsed:TIKTOK_WEB_PKCE_SUPPORTED,
      authorizationParams:[...TIKTOK_WEB_AUTHORIZATION_PARAMS],
      tokenEndpoint:`${TIKTOK_OPEN_API_BASE}${TIKTOK_TOKEN_PATH}`,
      revokeEndpoint:`${TIKTOK_OPEN_API_BASE}${TIKTOK_REVOKE_PATH}`,
      webhookUrl:tiktokWebhookUrl(),
      webhookSignatureStyle:"TikTok-Signature: t=<ts>,s=<hmac-sha256(client_secret, ts + '.' + rawBody)>",
      webhookEvents:[...TIKTOK_WEBHOOK_EVENTS],
      postingModes:["DIRECT_POST","MEDIA_UPLOAD"],
      privacyLevels:[...TIKTOK_PRIVACY_LEVELS],
      appReviewRequired:tiktokAuditRequired(),
      capabilityMatrix:TIKTOK_CAPABILITY_MATRIX,
      dashboardSteps:[
        "افتح TikTok for Developers → Manage apps → تطبيقك (أو أنشئ تطبيق Web).",
        "في Basic information انسخ Client key إلى TIKTOK_CLIENT_KEY وClient secret إلى TIKTOK_CLIENT_SECRET.",
        "في Login Kit → Redirect URI أضف القيمة في redirectUri بالضبط (https).",
        "في Scopes فعّل: user.info.basic, video.publish, video.upload, video.list.",
        "video.publish للنشر المباشر (Direct Post) وvideo.upload لرفع المسودة — مساران منفصلان فالنطاقان معاً مطلوبان.",
        "لتفعيل webhooks: أضف Webhook Callback URL (webhookUrl) في إعدادات التطبيق.",
        "لرفع قيد النشر المباشر العام (SELF_ONLY) يجب اجتياز Content Posting audit لدى TikTok؛ رفع المسودة لا يحتاجه.",
      ],
      note:"مسار TikTok الرسمي: /v2/auth/authorize/ (client_key) بمعاملات الويب الخمسة الرسمية بلا PKCE، والرمز على /v2/oauth/token/ بصيغة x-www-form-urlencoded، والإبطال على /v2/oauth/revoke/. النشر عبر Content Posting API، والبيانات عبر Display API. التعليقات والرسائل المباشرة غير متاحة عبر الواجهة العامة.",
      doc:"https://developers.tiktok.com/doc/login-kit-web",
    }:undefined,
    // YouTube: النطاقات المطلوبة + ما هو منفّذ فعلاً + خطوات Google Cloud (بلا أي سرّ).
    youtubeSetup:platform==="youtube"?{
      readonlyScope:YOUTUBE_READONLY_SCOPE,
      uploadScope:YOUTUBE_UPLOAD_SCOPE,
      forceSslScope:YOUTUBE_FORCE_SSL_SCOPE,
      readonlyScopePresent:youtubeReadonlyPresent,
      uploadScopePresent:youtubeOAuthScopes().includes(YOUTUBE_UPLOAD_SCOPE),
      forceSslScopePresent:youtubeOAuthScopes().includes(YOUTUBE_FORCE_SSL_SCOPE),
      requestedScopes:youtubeOAuthScopes(),
      channelIdentityEndpoint:`${youtubeApiBase()}/youtube/v3/channels?part=snippet,contentDetails&mine=true`,
      uploadEndpoint:`${youtubeUploadBase()}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`,
      commentThreadsEndpoint:`${youtubeApiBase()}/youtube/v3/commentThreads?part=snippet,replies`,
      commentsInsertEndpoint:`${youtubeApiBase()}/youtube/v3/comments?part=snippet`,
      capabilityMatrix:YOUTUBE_CAPABILITY_MATRIX,
      implementedCapabilities:YOUTUBE_CAPABILITY_MATRIX.filter(r=>r.status==="SUPPORTED").map(r=>r.key),
      notImplementedCapabilities:YOUTUBE_CAPABILITY_MATRIX.filter(r=>r.status!=="SUPPORTED").map(r=>r.key),
      refreshTokenSupported:true,
      // مسار إعادة الربط المطلوب لتفعيل إدارة التعليقات عند غياب force-ssl.
      scopeUpgradeRequiredForComments:!youtubeForceSslGranted(),
      reauthMessage:"إعادة ربط YouTube مطلوبة لتفعيل إدارة التعليقات.",
      dashboardSteps:[
        "افتح Google Cloud Console → APIs & Services → Library وفعّل YouTube Data API v3.",
        "في OAuth consent screen أضف النطاقات: youtube.readonly وyoutube.upload وyoutube.force-ssl.",
        "في Credentials → OAuth client ID (Web) أضف redirectUri أدناه بالضبط في Authorized redirect URIs.",
        "اضبط GOOGLE_OAUTH_CLIENT_ID وGOOGLE_OAUTH_CLIENT_SECRET في بيئة الخادم.",
        "اضغط «ربط YouTube» ووافق على الصلاحيات الثلاث. إن رُبط سابقاً بنطاقين فقط فأعد الربط لإضافة youtube.force-ssl.",
      ],
      note:"موصل YouTube تشغيلي كامل: اتصال + إثبات قناة + فيديوهات + رفع/جدولة (videos.insert resumable) + تحديث + تعليقات (commentThreads.list) + رد (comments.insert) + إحصاءات (part=statistics). إدارة التعليقات تتطلب نطاق youtube.force-ssl؛ عند غيابه يُعلن النظام SCOPE_UPGRADE_REQUIRED ويطلب إعادة الربط بلا تحايل على Google. لا تُخترع بيانات سكانية (عمر/جنس/موقع) — تتطلب YouTube Analytics API ولم تُطلب.",
      doc:"https://developers.google.com/youtube/v3/docs",
    }:undefined,
    clientIdConfigured:Boolean(cfg.clientId),
    clientSecretConfigured:Boolean(cfg.clientSecret),
    // شكل معرّف التطبيق فقط (منطقي) — لا قيمة سرّية: أي مسافة/حرف يجعل Meta
    // ترد بصفحة «حدث خطأ ما» (PLATFORM__INVALID_APP_ID).
    appIdFormatOk:isPlausibleMetaAppId(String(cfg.clientId||""))||undefined,
    dialogPath:(platform==="facebook"||platform==="instagram")?FACEBOOK_DIALOG_PATH:undefined,
    // Facebook Login for Business: Configuration ID الحقيقي المطلوب. عند وجوده
    // يُمرَّر config_id بدل scope، والصلاحيات تُقرأ من الConfiguration نفسها.
    loginConfigIdEnvNames:metaScopesResolved?loginConfigEnvNames(platform):undefined,
    loginConfigIdConfigured:metaScopesResolved?loginConfigInspection(platform).configured:undefined,
    loginConfigIdValid:metaScopesResolved?loginConfigInspection(platform).valid:undefined,
    loginConfigIdProblems:(metaScopesResolved&&loginConfigInspection(platform).problems.length)?loginConfigInspection(platform).problems:undefined,
    loginConfigIdUsed:metaScopesResolved?Boolean(effectiveLoginConfigIdFor(platform)):undefined,
    permissionSource:metaScopesResolved?(effectiveLoginConfigIdFor(platform)?"facebook_login_for_business_configuration":"oauth_scope_parameter"):undefined,
    // التدفّق الرسمي لـInstagram (Instagram API with Facebook Login). عند وجود
    // Configuration ID صالح (config_id) يمرّ المسار عبر Business Login بصلاحيات
    // الConfiguration — وهو المطلب المُثبت لتطبيق Meta من نوع Business؛ وفيه لا
    // يُرسَل extras/display ويُقرأ الرمز من سطر الطلب (response_type=code). وبلا
    // config_id يبقى التدفّق الموثّق (display/extras/response_type=token عبر scope).
    instagramOnboardingFlow:platform==="instagram"?(()=>{
      const cfgUsed = Boolean(effectiveLoginConfigIdFor("instagram"));
      const onboarding = !cfgUsed && instagramOnboardingEnabled();
      return {
        // active = التدفّق الموحّد (extras)؛ يُلغى عند وجود config_id لأن الConfiguration
        // تحدّد تجربة الدخول والصلاحيات بنفسها.
        active:onboarding,
        display:onboarding?"page":null,
        extras:onboarding?INSTAGRAM_ONBOARDING_EXTRAS:null,
        responseType:onboarding?"token":"code",
        tokenDelivery:onboarding?"url_fragment":"query_code",
        envSwitch:"INSTAGRAM_OAUTH_ONBOARDING",
        envSwitchValue:instagramOnboardingEnabled()?"enabled":"disabled",
        // Configuration ID: مطلوب لتطبيق Meta من نوع Business (واجهة Business Login).
        // عند ضبطه صالحاً يحلّ محل scope ويُلغي extras، ويصبح المسار الكامل عبر
        // Business Login بصلاحيات الConfiguration.
        configIdRequired:cfgUsed,
        configIdUsed:cfgUsed,
        configIdSource:cfgUsed?loginConfigEnvNames("instagram").find((n:string)=>envSecret(n))??null:null,
        permissionSource:cfgUsed?"facebook_login_for_business_configuration":"oauth_scope_parameter",
        note:cfgUsed
          ? "Configuration ID مضبوط: الرابط يحمل config_id فقط (بلا scope وبلا extras/display) ويقرأ الصلاحيات من الConfiguration، والرمز يعود في سطر الطلب (response_type=code). هذا هو المخرج المُثبت لتطبيق Meta من نوع Business الذي يوجّه الحوار إلى Business Login فيرفض scope بلا Configuration."
          : "بلا Configuration ID: الرابط يمرّر scope (التدفّق الموثّق display/extras/response_type=token). إن كان تطبيقك من نوع Business فتظهر صفحة Meta العامة «حدث خطأ ما» بعد تسجيل الدخول لأن Business Login يقرأ الصلاحيات من Configuration لا من scope — الحل هو ضبط Configuration ID.",
        doc:"https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram",
        requiredProducts:["Instagram → API setup with Facebook login","Facebook Login for Business","Webhooks"],
        appType:"Meta Business type app",
        knownIssue:"عطل معروف لدى Meta في تدفّق الإعداد: يظهر «حدث خطأ ما» بعد تسجيل الدخول (GraphQL error 1850019 «error during business onboarding flow») ويرتبط بمعامل extras=IG_API_ONBOARDING. المخرج: إمّا ضبط Configuration ID (config_id) وإمّا تعطيل extras بالتدفّق العادي عبر /me/accounts?fields=instagram_business_account.",
      };
    })():undefined,
    // دليل إنشاء Configuration ID — يصحّ لـFacebook وInstagram (كلاهما Facebook Login for Business).
    loginForBusinessSetup:(platform==="facebook"||platform==="instagram")?{
      where:"Meta App Dashboard → Facebook Login for Business → Configurations",
      steps:[
        "افتح Facebook Login for Business → Configurations واضغط Create configuration (أو أعد استخدام Configuration موجودة).",
        "اختر نوع الرمز: User access token (المطلوب لمسارات الصفحة).",
        "أضف الصلاحيات المذكورة في حقل scopes أعلاه بالضبط (نفس أسماء Facebook Login).",
        "احفظ، ثم انسخ Configuration ID (أرقام فقط) إلى "+(platform==="instagram"?"INSTAGRAM_LOGIN_CONFIG_ID (أو FACEBOOK_LOGIN_CONFIG_ID)":"FACEBOOK_LOGIN_CONFIG_ID")+" في Render.",
        "لا تضع القيمة في Git ولا في أي سجل؛ الخادم يقرأها من البيئة فقط.",
      ],
      note:"عند وجود Configuration ID صالح يمرّره الخادم كـconfig_id بدل scope ولا يُرسَل extras/display، فلا يتعارض المعاملان ويقرأ Business Login الصلاحيات من الConfiguration.",
    }:undefined,
    // روابط Meta Dashboard المباشرة (بلا أي سرّ): App ID معرّف عام معلن أصلاً في
    // رابط التفويض، فلا كشف جديد — والغرض إعطاء المالك المسار الدقيق بنقرة واحدة
    // لإنشاء Configuration، لأن هذه الخطوة تتطلب جلسته ولا ينفّذها أي وكيل.
    metaDashboardUrls:metaScopesResolved&&cfg.clientId?{
      appDashboard:`https://developers.facebook.com/apps/${String(cfg.clientId)}/`,
      configurations:`https://developers.facebook.com/apps/${String(cfg.clientId)}/fb-login-for-business/configurations/`,
      basicSettings:`https://developers.facebook.com/apps/${String(cfg.clientId)}/settings/basic/`,
      roles:`https://developers.facebook.com/apps/${String(cfg.clientId)}/roles/`,
    }:undefined,
    genericErrorMeaning:(platform==="facebook"||platform==="instagram")?{
      message:"صفحة Meta «حدث خطأ ما» (Sorry, something went wrong) لها مواضع محتملة: (1) قبل تسجيل الدخول: معرّف تطبيق غير مطابق أو نطاق/رابط إرجاع غير مسجّل، (2) بعد تسجيل الدخول: تطبيق من نوع Business يوجّه الحوار إلى Business Login الذي يقرأ الصلاحيات من Configuration لا من scope، فإن غاب config_id بقيت الصلاحيات فارغة وظهر الرفض، (3) عطل معروف في تدفّق الإعداد عند استخدام extras=IG_API_ONBOARDING (1850019). حقل dialogPhase يحدد الموضع.",
      checks:["طابق App ID مع Settings → Basic (أرقام فقط بلا مسافات).","أضف appDomainsValue إلى App Domains بلا https وبلا مسار.","أضف redirectUri بالضبط إلى Valid OAuth Redirect URIs.","إن كان التطبيق من نوع Business: أنشئ Configuration في Facebook Login for Business → Configurations واضبط معرّفها في INSTAGRAM_LOGIN_CONFIG_ID / FACEBOOK_LOGIN_CONFIG_ID (config_id يحلّ محل scope في Business Login).","فعّل الصلاحيات المطلوبة داخل Use Case — لا يكفي وجودها في الرابط.","تأكد أن التطبيق يحتوي منتج Instagram → API setup with Facebook login وأن التطبيق من نوع Business.","أضف حساب المالك إلى Roles → Testers إن كان التطبيق في وضع Development.","راجع المتغير FACEBOOK_OAUTH_SCOPES/INSTAGRAM_OAUTH_SCOPES إن وُجد: أي اسم صلاحية غير قائم يُرفض قبل الدخول."],
    }:undefined,
    // Threads API: إعداد دقيق + الفروق الجوهرية عن تطبيق فيسبوك الرئيسي + السبب
    // الحقيقي لخطأي Meta الشائعين (1349168 رابط محظور، 1349245 حساب غير مختبِر).
    threadsSetup:platform==="threads"?{
      clientIdConfigured:Boolean(cfg.clientId),
      clientSecretConfigured:Boolean(cfg.clientSecret),
      redirectUri,
      authorizationEndpoint:cfg.auth,
      tokenEndpoint:cfg.token,
      scopes:resolvedScopes,
      credentialMode:"oauth2",
      // Threads له عميل OAuth منفصل عن تطبيق فيسبوك الرئيسي (Threads App ID مستقل)،
      // وله قائمة روابط إعادة توجيه خاصة به في: حالات الاستخدام → الوصول إلى واجهة
      // API تطبيق Threads → تخصيص → تبويب الإعدادات (وليست قائمة Facebook Login for Business).
      separateOAuthClient:true,
      realConnector:false,
      dashboardSteps:[
        "تأكد أن Use Case «Access the Threads API» مضاف للتطبيق.",
        "انسخ Threads App ID/Secret إلى THREADS_OAUTH_CLIENT_ID/THREADS_OAUTH_CLIENT_SECRET.",
        "أضف قيمة redirectUri بالضبط في: حالات الاستخدام → الوصول إلى واجهة API تطبيق Threads → تخصيص → الإعدادات → روابط إعادة توجيه OAuth (قائمة خاصة بـThreads منفصلة عن Facebook Login for Business).",
        "فعّل نطاقات Threads API: threads_basic, threads_content_publish, threads_manage_replies.",
        "في وضع Development: أضف حساب Threads المستخدَم لتسجيل الدخول كـ Threads Tester ثم اقبل الدعوة (وإلا يرد Meta 1349245).",
      ],
      metaDashboardFields:{
        oauthRedirectUris:"حالات الاستخدام → الوصول إلى واجهة API تطبيق Threads → تخصيص → الإعدادات → روابط إعادة توجيه OAuth",
        roles:"إعدادات التطبيق → الأدوار بالتطبيق → Roles → إضافة Threads Tester ثم قبول الدعوة",
      },
      knownErrors:{
        "1349168":"عنوان URL محظور — redirectUri غير مسجّل في قائمة Threads الخاصة (تخصيص → الإعدادات).",
        "1349245":"الحساب ليس مختبِراً مقبولاً — أضِفه كـ Threads Tester واقبل الدعوة (وضع Development).",
      },
      note:"Threads API له عميل OAuth منفصل وروابط إعادة توجيه خاصة. في وضع Development يجب أن يكون الحساب المستخدَم مختبِراً مقبولاً. القيم أعلاه محسوبة من البيئة بلا أي سرّ.",
      doc:"https://developers.facebook.com/documentation/threads/get-started",
    }:undefined,
    // موضع الرفض الفعلي: يمنع تشخيصاً خاطئاً لأن فحصاً بلا كوكيز لا يرى ما بعد
    // تسجيل الدخول، فيبدو «مقبولاً» مع أن الرفض يقع في مرحلة Use Case.
    dialogPhase:metaScopesResolved&&mobileDialogProbe?(
      mobileDialogProbe.probed===false ? "probe_unavailable"
      : mobileDialogProbe.outcome==="rejected" ? "rejected_before_login"
      : (mobileDialogProbe.hops||[]).some((h:any)=>h.kind==="login") ? "awaiting_owner_login"
      : "acceptable"
    ):undefined,
    appSecretConfigured:(platform==="facebook"||platform==="instagram")?Boolean(platform==="instagram"?instagramAppSecret():facebookAppSecret()):undefined,
    verifyTokenConfigured:(platform==="facebook"||platform==="instagram")?Boolean(platform==="instagram"?instagramVerifyToken():facebookVerifyToken()):undefined,
    // آخر نتيجة فحص بدء OAuth (منطقية فقط، بلا سرّ ولا استدعاء إضافي). تُظهر
    // للمالك سبب 409 داخل الواجهة: invalid_client_secret / invalid_client_id.
    lastPreflight:(()=>{ const p=lastOAuthPreflight.get(platform); return p ? { checkedAt:new Date(p.at).toISOString(), code:p.code, appTokenKind:p.appTokenKind, error:p.error??null, hint:p.hint??null } : null; })(),
    webhookUrl:platform==="facebook"?facebookWebhookUrl():platform==="instagram"?instagramWebhookUrl():undefined,
    metaDashboardFields:platform==="facebook"||platform==="instagram"?{
      appDomains:"Settings → Basic → App Domains",
      validOAuthRedirectUris:"Facebook Login → Settings → Client OAuth Settings → Valid OAuth Redirect URIs",
      instructions:"أضف قيمة appDomainsValue إلى App Domains، وأضف redirectUri بالضبط إلى Valid OAuth Redirect URIs، ثم احفظ.",
    }:undefined,
    // وضع التطبيق (Development/Live) لا يكشفه Graph API إطلاقاً؛ المصدر الوحيد
    // هو لوحة Meta. نُعلن ذلك صراحةً بدل الإيهام بفحص آلي لا وجود له.
    mobileDialogProbe,
    metaAppModeNotice:(platform==="facebook"||platform==="instagram")?{
      apiReadable:false,
      where:"Meta App Dashboard → الأعلى: مفتاح App Mode (Development/Live)",
      impact:platform==="instagram"
        ? "في وضع Development يمكن للرولات (المدير/المطوّر/المختبِر) فقط التفويض، ويلزم رول على الصفحة المرتبطة بحساب Instagram. ولتفعيل استقبال تعليقات/رسائل Instagram يجب تفعيل حقول webhook (comments/messages) لكائن instagram من لوحة Meta (Graph API لا يسمح بضبط حقول Instagram عبر subscribed_apps)."
        : "في وضع Development يمكن للرولات (المدير/المطوّر/المختبِر) فقط التفويض؛ وأي حساب بلا رول يُرفض على شاشة الموافقة. ولأن صفحة المعرض قد تكون مملوكة لـBusiness Manager، فالمطلوب أيضاً رول على الصفحة وصلاحية business_management (يُطلبها الكود افتراضياً).",
    }:undefined,
    note:"قيَم حقيقية محسوبة من بيئة الخادم بلا أي سرّ. لا يُرسَل أي توكن أو مفتاح هنا.",
  });
});

app.get("/api/control/final-check", requireOwner, (_req,res)=>{
  const checks:any[]=[]; const add=(id:string,ok:boolean,detail:string,blocking=false)=>checks.push({id,ok,detail,blocking});
  add("state-persistence",storageStatus().writable,"مخزن الحالة متاح وقابل للكتابة",true);
  add("owner",Boolean(OWNER_EMAIL),"OWNER_EMAIL مضبوط",true);
  add("token-encryption",Boolean(tokenKeyBytes()),`مفتاح تشفير توكنات المنصات: ${tokenKeyInspection().state==="valid"?"صالح":tokenKeyInspection().reason}`,true);
  add("gemini-guard",Number.isFinite(GEMINI_DAILY_LIMIT)&&GEMINI_DAILY_LIMIT>0,"حارس Gemini المحلي فعال",false);
  add("real-connections",connectedPlatformIds().length>0,connectedPlatformIds().length?`متصل فعلياً: ${connectedPlatformIds().join(", ")}`:"لا توجد منصة متصلة فعلياً بعد",false);
  add("fake-publish-safety",automationJobs.every((j:any)=>j.status!=="published" || j.providerVerified===true),"كل سجل نشر خارجي موثق بإيصال مزود",true);
  add("backup",fs.existsSync(BACKUP_DIR),"مجلد النسخ الاحتياطية متاح",true);
  const blocking=checks.filter(x=>x.blocking&&!x.ok); res.status(blocking.length?503:200).json({success:blocking.length===0,ready:blocking.length===0,version:PROJECT_VERSION,schemaVersion:STATE_SCHEMA_VERSION,checks,blocking});
});

app.get("/api/platforms/capabilities", authenticateToken, (_req, res) => {
  res.json({ success: true, platforms: SUPPORTED_PLATFORMS.map(p => ({ ...p, connection: platformConnections.get(p.id) })), connectedPlatforms: connectedPlatformIds(), note: "الاتصال لا يُعتبر حقيقياً إلا بعد OAuth/API فعلي." });
});

app.post("/api/platforms/:platform/connect-intent", requireOwner, (req, res) => {
  const platform = req.params.platform;
  if (!SUPPORTED_PLATFORMS.some(p => p.id === platform)) return res.status(404).json({ success: false, error: "المنصة غير مدعومة." });
  const intent = { id: `conn-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`, platform, createdAt: new Date().toISOString(), status: "awaiting_oauth" };
  audit((req as any).user.id, "platform_connect_intent", `${platform}:${intent.id}`);
  res.status(201).json({ success: true, intent, message: "تم إنشاء نية الربط فقط. لم يتم الاتصال بالحساب بعد." });
});

app.post("/api/platforms/:platform/disconnect", requireOwner, async (req, res) => {
  const platform = req.params.platform;
  if (!platformConnections.has(platform)) return res.status(404).json({ success: false, error: "المنصة غير مدعومة." });
  if (platform === "telegram") {
    // إبطال طرف المزود أيضاً: حذف webhook الحقيقي لدى Telegram قدر الإمكان،
    // ثم مسح الاعتماد المشفّر المحلي كي لا يبقى إرسال ممكّن.
    const client = telegramClient();
    if (client) { try { await client.deleteWebhook(); } catch { /* إبطال محلي يكفي */ } }
  }
  if (platform === "tiktok") {
    // إبطال طرف TikTok أيضاً: revoke للرمز لدى المزود قدر الإمكان، ثم مسح محلي.
    const stored = tiktokStoredCredentials();
    const cfg = tiktokOAuthConfig();
    if (stored?.accessToken && cfg?.clientId && cfg?.clientSecret) {
      try { await tiktokClient().revokeToken({ clientKey: String(cfg.clientId), clientSecret: String(cfg.clientSecret), token: String(stored.accessToken) }); } catch { /* إبطال محلي يكفي */ }
    }
  }
  if (platform === "youtube") {
    // إبطال طرف Google أيضاً: revoke للرمز/refresh_token لدى Google قدر الإمكان،
    // ثم مسح الاعتماد المشفّر محلياً كي لا يبقى رمز صالح.
    const stored = youtubeStoredCredentials();
    const revocable = stored?.refresh_token || stored?.access_token;
    if (revocable) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(String(revocable))}`, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      } catch { /* إبطال محلي يكفي */ }
    }
  }
  platformConnections.set(platform, { platform, status: "disconnected" });
  clearProviderToken(platform); savePlatformConnections(); audit((req as any).user.id, "platform_disconnect", platform);
  res.json({ success: true, connection: platformConnections.get(platform) });
});

app.post("/api/platforms/:platform/connection-callback", requireOwner, async (req, res) => {
  const platform = req.params.platform;
  if (!platformConnections.has(platform)) return res.status(404).json({ success: false, error: "المنصة غير مدعومة." });
  // لا يُوثق الاتصال بتصريح من العميل. يجب إثباته بطلب حقيقي إلى المزود.
  // (كان المسار يقبل providerVerified:true من الجسم — ثغرة اتصال وهمي أُغلقت.)
  const proof = await verifyProviderConnection(platform);
  if (!proof.verified) {
    return res.status(409).json({ success: false, error: proof.error || "لم يُثبت اتصال المزود؛ لا يمكن تفعيل الاتصال.", providerVerified: false });
  }
  const connection: PlatformConnection = { platform, status: "connected", accountId: String(proof.accountId || "").slice(0, 200), accountName: proof.accountName ? String(proof.accountName).slice(0, 200) : undefined, connectedAt: new Date().toISOString(), providerVerified: true };
  platformConnections.set(platform, connection); savePlatformConnections(); audit((req as any).user.id, "platform_verified_connected", platform);
  res.json({ success: true, connection: safeConnection(platform) });
});
app.get("/api/control/activity", authenticateToken, (req, res) => {
  res.json({ success: true, activity: auditLog.filter(x => x.userId === (req as any).user.id || (req as any).user.role === "owner").slice(0, 30) });
});

app.get("/api/control/audit", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const since = typeof req.query.since === "string" ? Date.parse(req.query.since) : NaN;
  const visible = auditLog.filter((entry) => user.role === "owner" || entry.userId === user.id)
    .filter((entry) => !Number.isFinite(since) || Date.parse(entry.at) > since)
    .slice(0, limit);
  res.json({ success: true, entries: visible, count: visible.length, generatedAt: new Date().toISOString() });
});

app.get("/api/system/backups", requireOwner, (_req, res) => {
  const backups = storageAdapter.listBackups();
  res.json({ success: true, backups, retention: 7, backend: storageAdapter.backend });
});

app.post("/api/control/jobs/preflight", requireOwner, (req, res) => {
  const changed = runSafeJobPreflight();
  const ready = automationJobs.filter((j: any) => j.status === "ready").length;
  audit((req as any).user.id, "manual_job_preflight", `ready=${ready}`);
  res.json({ success: true, changed, ready, message: "تم فحص المهام دون تنفيذ أي نشر أو اتصال خارجي." });
});

app.get("/api/ai/capabilities", authenticateToken, (_req, res) => {
  res.json({ success: true, deterministic: ["orchestration", "fallback_content", "message_classification", "platform_readiness"], gemini: ["content_generation", "strategic_chat"], safety: { dailyGuard: GEMINI_DAILY_LIMIT, cache: true, inFlightDeduplication: true, perUserMinuteGuard: 8 } });
});

app.post("/api/ai/plan-week", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const platforms = Array.isArray(req.body?.platforms) ? req.body.platforms.slice(0, 10) : [];
  const focus = typeof req.body?.focus === "string" ? req.body.focus.trim().slice(0, 160) : "عروض ومنتجات المعرض";
  const days = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
  const plan = days.map((day, i) => ({ day, objective: i % 2 === 0 ? "عرض منتج وفائدة عملية" : "توعية بشروط التقسيط وخدمة العملاء", focus, platforms, requiresApproval: true, usesGemini: false }));
  audit(user.id, "plan_week", `platforms=${platforms.length}`);
  res.json({ success: true, plan, generatedBy: "deterministic-planner" });
});

// Central automation queue: plans work once, then waits for explicit approval/external connection.
app.get("/api/control/jobs", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const visible = user.role === "owner" ? automationJobs : automationJobs.filter(j => j.createdBy === user.id);
  res.json({ success: true, jobs: visible.slice(0, 50), count: visible.length });
});

app.post("/api/control/jobs", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const type = typeof req.body?.type === "string" ? req.body.type.trim().slice(0, 60) : "content_campaign";
  const payload = req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {};
  const idem = requestKey(req);
  const duplicate = findRecentJobByIdempotency(user.id, idem);
  if (duplicate) return res.status(200).json({ success: true, job: duplicate, duplicate: true, message: "تمت إعادة نفس المهمة السابقة دون إنشاء مهمة جديدة." });
  const job = {
    id: `job-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    type, status: "queued" as const, createdAt: new Date().toISOString(), createdBy: user.id,
    payload: { ...payload, ...(idem ? { idempotencyKey: idem } : {}) }, requiresExternalConnection: true, scheduledFor: normalizeScheduleInput(payload.scheduledFor) ?? undefined,
  };
  automationJobs.unshift(job);
  persistState();
  audit(user.id, "create_automation_job", `${job.id}:${type}`);
  res.status(201).json({ success: true, job, message: "تم إنشاء المهمة. لن يتم نشر أو إرسال أي شيء قبل الموافقة والاتصال الفعلي بالمنصة." });
});

app.post("/api/control/jobs/:id/approve", requireOwner, (req, res) => {
  const job = automationJobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ success: false, error: "المهمة غير موجودة." });
  if (job.status !== "queued") return res.status(409).json({ success: false, error: "حالة المهمة لا تسمح بالموافقة." });
  job.status = "approved";
  persistState();
  audit((req as any).user.id, "approve_automation_job", job.id);
  res.json({ success: true, job, message: "تمت الموافقة. التنفيذ الخارجي ما زال متوقفاً حتى وجود اتصال فعلي بالمنصة." });
});

app.get("/api/control/jobs/:id/preflight", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const job = automationJobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ success:false, error:"المهمة غير موجودة." });
  if (job.createdBy !== user.id && user.role !== "owner") return res.status(403).json({ success:false, error:"لا تملك صلاحية فحص هذه المهمة." });
  const platform = typeof job.payload?.platform === "string" ? job.payload.platform : "";
  const content = typeof job.payload?.content === "string" ? job.payload.content.trim() : "";
  const scheduledFor = job.scheduledFor || job.payload?.scheduledFor;
  const scheduleReady = !scheduledFor || (Number.isFinite(wallClockToEpoch(scheduledFor)) && wallClockToEpoch(scheduledFor) <= Date.now());
  const checks = { content: Boolean(content), approval: job.status === "approved" || job.status === "ready", connection: platformConnections.get(platform)?.status === "connected", capability: hasCapability(platform, "publish"), schedule: scheduleReady };
  const ready = Object.values(checks).every(Boolean);
  res.json({ success:true, ready, checks, platform, status:job.status, note:"الفحص لا ينفذ أي نشر خارجي." });
});

app.get("/api/control/overview", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const visibleJobs = user.role === "owner" ? automationJobs : automationJobs.filter(j => j.createdBy === user.id);
  const connected = connectedPlatformIds().length;
  res.json({ success: true, overview: { projectVersion: PROJECT_VERSION, supportedPlatforms: 10, connectedPlatforms: connected, disconnectedPlatforms: 10 - connected, jobs: visibleJobs.length, pendingApproval: visibleJobs.filter(j => j.status === "queued").length, approvedAwaitingConnection: visibleJobs.filter(j => j.status === "approved").length, ready: visibleJobs.filter(j => j.status === "ready").length, failed: visibleJobs.filter(j => j.status === "failed").length, scheduled: visibleJobs.filter((j: any) => Boolean(j.scheduledFor)).length, gemini: geminiStatus() }, note: "الأرقام المعروضة فعلية من حالة الخادم وليست بيانات تجريبية." });
});

// -----------------------------------------------------------------------------
// SCOPE ISOLATION (LEGACY ERP): أسطح Inventory/CRM/Finance/Customers-360/Purchases/
// Reports/Catalog/Tasks/Business/Suppliers/Expenses/Contracts/Installments/
// Executive **خارج نطاق المشروع المعلن** (سوشيال + AI + تسويق) ولا مستهلك واجهة
// ظاهر لها. تُعطَّل افتراضياً برد **404 صريح** قبل أي مصادقة (لا 200 HTML)،
// وتُعاد بالكامل بضبط
// `GHARABI_ENABLE_LEGACY_ERP_SCOPE=true`. لا يُزال أي كود ولا بيانات عند التعطيل.
// النمط مطابق لعزل ERP في فرع phase-1d، بمتغيّر بيئة مستقل واضح الاسم.
// المطابقة غير حسّاسة لحالة الأحرف (Express يوجّه كذلك) مع احترام حدّ المسار كي لا
// يلتقط `/api/crm` مساراً مثل `/api/crmx`.
// -----------------------------------------------------------------------------
const LEGACY_ERP_ROUTE_PREFIXES: readonly string[] = Object.freeze([
  "/api/catalog",
  "/api/inventory",
  "/api/customers/360",
  "/api/reports/operations",
  "/api/crm",
  "/api/purchases",
  "/api/finance",
  "/api/tasks",
  "/api/business",
  "/api/suppliers",
  "/api/expenses",
  "/api/contracts",
  "/api/installments",
  "/api/executive",
]);
// خارج النطاق الحالي (سوشيال + AI + تسويق) لكن مستهلكة بواجهات ظاهرة، فتُعزل بنفس
// المفتاح لكن **بشكل منفصل** عن عائلات ERP أعلاه: عائلات المبيعات/المالية/دليل العملاء
// كانت مؤمّنة بفحص دور (owner/manager/staff)، لكنها خارج النطاق المعلن فيجب ألا تكون
// ظاهرة/قابلة للوصول للمستخدم العادي. تفصيله في قسم «Scope Boundary» بـAGENTS.md.
const OUT_OF_SCOPE_LIVE_ROUTE_PREFIXES: readonly string[] = Object.freeze([
  "/api/sales",
  "/api/control/alerts",
  "/api/control/customer-directory",
  "/api/control/cashflow",
  "/api/control/reconciliation",
  "/api/control/daily-brief",
]);
function legacyErpScopeEnabled(): boolean {
  const raw = String(process.env.GHARABI_ENABLE_LEGACY_ERP_SCOPE ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "on" || raw === "yes";
}
function isLegacyErpRouteRequest(rawUrl: string): boolean {
  // تطبيع مطابق لـcanonicalRequestPath (نفس سياسة حارس حزمة المصدر): فكّ ترميز
  // متكرر محدود + توحيد الفواصل + حلّ `.`/`..` + طيّ الشرطة المائلة المكرّرة +
  // حذف الشرطة الختامية + توحيد الحالة. يمنع تجاوز الحارس بصيغة `//api/crm/...`.
  let p = String(rawUrl || "").split("?")[0].split("#")[0].replace(/\\/g, "/");
  for (let i = 0; i < 5; i += 1) {
    if (!/%[0-9a-fA-F]/.test(p)) break;
    try {
      const next = decodeURIComponent(p);
      if (next === p) break;
      p = next;
    } catch {
      break; // ترميز فاسد: نطابق على آخر قيمة سليمة بدل الانهيار.
    }
  }
  const norm = path.posix.normalize(p);
  const canonical = (norm.startsWith("/") ? norm : `/${norm}`).replace(/\/+$/, "").toLowerCase() || "/";
  for (const prefix of LEGACY_ERP_ROUTE_PREFIXES) {
    if (canonical === prefix || canonical.startsWith(prefix + "/")) return true;
  }
  return false;
}
// عائلات خارج النطاق لكنها مستهلكة بواجهات ظاهرة (مبيعات/مالية/دليل عملاء) — تطبيع
// مطابق تماماً لعزل ERP، فلا تتجاوز الحارس صيغة `//api/sales/...` أو `%2f`.
function isOutOfScopeLiveRouteRequest(rawUrl: string): boolean {
  let p = String(rawUrl || "").split("?")[0].split("#")[0].replace(/\\/g, "/");
  for (let i = 0; i < 5; i += 1) {
    if (!/%[0-9a-fA-F]/.test(p)) break;
    try {
      const next = decodeURIComponent(p);
      if (next === p) break;
      p = next;
    } catch {
      break;
    }
  }
  const norm = path.posix.normalize(p);
  const canonical = (norm.startsWith("/") ? norm : `/${norm}`).replace(/\/+$/, "").toLowerCase() || "/";
  for (const prefix of OUT_OF_SCOPE_LIVE_ROUTE_PREFIXES) {
    if (canonical === prefix || canonical.startsWith(prefix + "/")) return true;
  }
  return false;
}
if (!legacyErpScopeEnabled()) {
  app.use((req, res, next) => {
    if (isLegacyErpRouteRequest(String(req.url || ""))) {
      return res.status(404).json({
        success: false,
        error: "هذا السطح (Inventory/CRM/Finance) خارج نطاق المشروع المعلن (سوشيال + AI + تسويق).",
        code: "SCOPE_DISABLED",
        note: "لإعادة التفعيل: GHARABI_ENABLE_LEGACY_ERP_SCOPE=true. لا يُزال الكود ولا البيانات.",
      });
    }
    // عائلات خارج النطاق لكنها مستهلكة بواجهات ظاهرة (مبيعات/مالية/دليل عملاء): تُعزل
    // بنفس المفتاح مع كود مميّز يُثبت أن الحجب بسبب النطاق لا بسبب الصلاحية.
    if (isOutOfScopeLiveRouteRequest(String(req.url || ""))) {
      return res.status(404).json({
        success: false,
        error: "هذا السطح (المبيعات/المالية/دليل العملاء) خارج نطاق المشروع المعلن (سوشيال + AI + تسويق).",
        code: "SCOPE_DISABLED",
        note: "لإعادة التفعيل: GHARABI_ENABLE_LEGACY_ERP_SCOPE=true. لا يُزال الكود ولا البيانات.",
      });
    }
    next();
  });
}


// Operational foundation: deterministic endpoints below consume ZERO Gemini calls.
app.post("/api/catalog/quote", authenticateToken, (req, res) => {
  const price = Number(req.body?.cashPrice); const downPayment = Number(req.body?.downPayment ?? 0); const months = Number(req.body?.months);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(downPayment) || downPayment < 0 || downPayment >= price || !Number.isInteger(months) || months < 1 || months > 60) return res.status(400).json({ success: false, error: "بيانات حسبة القسط غير صحيحة." });
  const financed = Math.max(0, price - downPayment); const monthly = Math.ceil(financed / months);
  res.json({ success: true, quote: { cashPrice: price, downPayment, financedAmount: financed, months, monthlyPayment: monthly, totalInstallments: monthly * months, rounding: "ceil-to-IQD" }, generatedBy: "deterministic-calculator" });
});

app.post("/api/campaigns/draft", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser; const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 120) : "حملة معرض الغرابي";
  const platforms = Array.isArray(req.body?.platforms) ? req.body.platforms.filter((x: any) => typeof x === "string" && SUPPORTED_PLATFORMS.some(p => p.id === x)).slice(0, 10) : [];
  const productName = typeof req.body?.productName === "string" ? req.body.productName.trim().slice(0, 160) : "منتج من المعرض";
  const campaign = { id: `camp-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`, title, productName, platforms, status: "draft", createdBy: user.id, createdAt: new Date().toISOString(), steps: ["brief", "content", "review", "schedule", "publish"], currentStep: "brief", usesGemini: false };
  audit(user.id, "campaign_draft_created", campaign.id); res.status(201).json({ success: true, campaign, message: "تم إنشاء مسودة الحملة دون استهلاك Gemini." });
});

// Unified campaign workflow: one deterministic operation creates a reusable campaign,
// platform-specific drafts, and approval jobs without calling Gemini.
app.post("/api/campaigns/build-batch", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 120) : "حملة معرض الغرابي";
  const productName = typeof req.body?.productName === "string" ? req.body.productName.trim().slice(0, 160) : "منتج من المعرض";
  const focus = typeof req.body?.focus === "string" ? req.body.focus.trim().slice(0, 180) : "عرض المنتج ومزايا التقسيط";
  const requested = Array.isArray(req.body?.platforms) ? req.body.platforms : [];
  const platforms = [...new Set(requested.filter((x: any) => typeof x === "string" && SUPPORTED_PLATFORMS.some(p => p.id === x)))].slice(0, 10);
  if (!platforms.length) return res.status(400).json({ success: false, error: "اختر منصة واحدة على الأقل." });
  const id = `camp-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const createdAt = new Date().toISOString();
  const drafts = platforms.map((platform: string) => ({
    id: `${id}-${platform}`,
    platform,
    status: "draft",
    content: generateSmartFallbackContent(platform, "post", focus, `المنتج: ${productName}`),
    usesGemini: false,
    requiresApproval: true,
  }));
  const jobs = drafts.map((draft: any) => ({
    id: `job-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    type: "campaign_publish",
    status: "queued" as const,
    createdAt,
    createdBy: user.id,
    payload: { campaignId: id, title, productName, focus, platform: draft.platform, draftId: draft.id, content: draft.content },
    requiresExternalConnection: true,
  }));
  automationJobs.unshift(...jobs);
  const campaign = { id, title, productName, focus, platforms, drafts, jobs: jobs.map(j => j.id), status: "draft", createdBy: user.id, createdAt, usesGemini: false };
  persistState();
  audit(user.id, "campaign_batch_built", `${id}:${platforms.length}`);
  res.status(201).json({ success: true, campaign, message: "تم بناء دفعة الحملة كاملة دون استهلاك Gemini. النشر الفعلي متوقف حتى الموافقة والاتصال الحقيقي." });
});

app.get("/api/campaigns", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const jobs = user.role === "owner" ? automationJobs : automationJobs.filter(j => j.createdBy === user.id);
  const grouped = new Map<string, any>();
  for (const job of jobs) {
    const cid = job.payload?.campaignId;
    if (!cid) continue;
    if (!grouped.has(cid)) grouped.set(cid, { id: cid, title: job.payload?.title || "حملة", jobs: [] });
    grouped.get(cid).jobs.push({ id: job.id, platform: job.payload?.platform, status: job.status, draftId: job.payload?.draftId });
  }
  res.json({ success: true, campaigns: Array.from(grouped.values()) });
});

app.post("/api/control/jobs/:id/cancel", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const job = automationJobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ success: false, error: "المهمة غير موجودة." });
  if (job.createdBy !== user.id && user.role !== "owner") return res.status(403).json({ success: false, error: "لا تملك صلاحية إلغاء هذه المهمة." });
  if (!["queued", "approved", "ready"].includes(job.status)) return res.status(409).json({ success: false, error: "لا يمكن إلغاء المهمة في حالتها الحالية." });
  job.status = "failed";
  job.payload = { ...job.payload, cancelled: true, cancelledAt: new Date().toISOString() };
  persistState(); audit(user.id, "cancel_job", job.id);
  res.json({ success: true, job });
});

app.post("/api/control/jobs/:id/retry", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const job = automationJobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ success: false, error: "المهمة غير موجودة." });
  if (job.createdBy !== user.id && user.role !== "owner") return res.status(403).json({ success: false, error: "لا تملك صلاحية إعادة المحاولة." });
  if (job.status !== "failed") return res.status(409).json({ success: false, error: "إعادة المحاولة متاحة للمهام الفاشلة فقط." });
  job.status = "queued";
  job.payload = { ...job.payload, retryCount: Number(job.payload?.retryCount || 0) + 1, lastRetryAt: new Date().toISOString(), cancelled: false };
  persistState();
  audit(user.id, "retry_job", job.id);
  res.json({ success: true, job, message: "أعيدت المهمة إلى طابور الانتظار. لا يوجد تنفيذ خارجي تلقائي." });
});

// Safe queue worker: prepares approved jobs for execution but NEVER calls a social provider.
// A job becomes "ready" only when its platform is really connected, the capability exists,
// content exists, approval is present, and any requested schedule has arrived.
function runSafeJobPreflight() {
  const now = Date.now();
  let changed = false;
  for (const job of automationJobs) {
    if (job.status !== "approved") continue;
    const platform = typeof job.payload?.platform === "string" ? job.payload.platform : "";
    const content = typeof job.payload?.content === "string" ? job.payload.content.trim() : "";
    const scheduledFor = job.scheduledFor || job.payload?.scheduledFor;
    if (scheduledFor) {
      const when = wallClockToEpoch(scheduledFor);
      if (!Number.isFinite(when) || when > now) continue;
    }
    if (!platform || !content || !platformConnections.has(platform) || platformConnections.get(platform)?.status !== "connected" || !hasCapability(platform, "publish")) continue;
    job.status = "ready";
    job.readyAt = new Date().toISOString();
    job.lastError = undefined;
    changed = true;
  }
  if (changed) {
    persistState();
    auditLog.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), userId: "system", action: "safe_job_preflight_ready", detail: "approved jobs prepared without external execution" });
    if (auditLog.length > 100) auditLog.pop();
    persistState();
  }
  return changed;
}
const safeJobWorkerTimer = setInterval(safeTimerCallback(runSafeJobPreflight, "safe-job-preflight"), 60 * 1000);
(safeJobWorkerTimer as any).unref?.();

/**
 * مصالحة دورية لحالة نشر TikTok (status/fetch) — تسدّ فجوة أن التسليم كان
 * يُحسم يدوياً فقط. تعمل داخل عملية Render الدائمة، بلا AI، ولا تكتب حالة بلا
 * تأكيد من المزود. الفترة 60 ثانية كافية ولا تستهلك حصة TikTok بلا داعٍ لأن
 * السجلات المحسومة تُستثنى. قابلة للضبط من البيئة للاختبار فقط (بحدّ أدنى 1s).
 */
function tiktokReconcileIntervalMs(): number {
  const raw = Number(process.env.TIKTOK_RECONCILE_INTERVAL_MS);
  if (Number.isFinite(raw) && raw >= 1000) return raw;
  return 60 * 1000;
}
const tiktokReconcileTimer = setInterval(safeTimerCallback(() => reconcileTikTokPublishes(), "tiktok-reconcile"), tiktokReconcileIntervalMs());
(tiktokReconcileTimer as any).unref?.();

/**
 * ينفّذ مهمة داخلية **معتمدة وجاهزة** عبر الوصلات الحقيقية فقط، بمرور نفس
 * بوابات النشر (جاهزية + اتصال موثق). لا يختلق تنفيذاً: أي نوع غير مدعوم يعيد
 * فشلاً صريحاً. سُحبت من المسار كي يستخدمها العقل المركزي بلا تكرار ولا تجاوز.
 */
async function executeApprovedJob(job: any, userId: string): Promise<{ status: number; body: any }> {
  if (!job) return { status: 404, body: { success: false, error: "المهمة غير موجودة." } };
  if (job.status !== "ready") return { status: 409, body: { success: false, error: "المهمة ليست جاهزة للتنفيذ." } };
  const platform = String(job.payload?.platform || ""); const content = String(job.payload?.content || "").trim(); const conn: any = platformConnections.get(platform);
  // وضع YOUTUBE_ONLY_OPERATIONAL: يمنع تنفيذ أي مهمة خارجية على منصة غير YouTube.
  const onlyBlock = youtubeOnlyBlock(platform);
  if (onlyBlock.blocked) return { status: onlyBlock.status!, body: onlyBlock.body };
  if (!conn || conn.status !== "connected" || conn.providerVerified !== true) return { status: 409, body: { success: false, error: "المنصة غير موثقة باتصال حقيقي." } };
  try {
    if (platform === "telegram") {
      const client = telegramClient(); if (!client) return { status: 503, body: { success: false, error: "موصل Telegram غير مهيأ (رمز بوت غير متوفر)." } };
      const chatId = String(process.env.TELEGRAM_DEFAULT_CHAT_ID || job.payload?.chatId || ""); if (!chatId) return { status: 503, body: { success: false, error: "Telegram يحتاج TELEGRAM_DEFAULT_CHAT_ID أو chatId في المهمة." } };
      const sent = await client.sendMessage({ chatId, text: content });
      if (!sent.ok) throw new Error(sent.error || "فشل إرسال Telegram");
      job.status = "executed"; job.executedAt = new Date().toISOString(); job.providerVerified = true; job.providerReceipt = { provider: "telegram", messageId: sent.providerMessageId, executedAt: new Date().toISOString() }; persistState(); audit(userId, "job_executed", `${job.id}:telegram`);
      return { status: 200, body: { success: true, job, receipt: job.providerReceipt } };
    }
    return { status: 501, body: { success: false, error: "الموصل متصل ومتحقق، لكن تنفيذ هذا النوع من النشر يحتاج بيانات الوسائط/العملية الخاصة بالمزود ولم يتم اختلاق تنفيذ وهمي." } };
  } catch (e: any) {
    job.status = "failed"; job.lastError = String(e?.message || e).slice(0, 500); persistState(); audit(userId, "job_execution_failed", `${job.id}:${platform}`);
    return { status: 502, body: { success: false, error: job.lastError, job } };
  }
}

app.post("/api/control/jobs/:id/execute", requireOwner, async (req,res)=>{
  const job=automationJobs.find((j:any)=>j.id===req.params.id);
  const result=await executeApprovedJob(job,(req as any).user.id);
  return res.status(result.status).json(result.body);
});

app.post("/api/publish/preflight", authenticateToken, (req, res) => {
  const platform = typeof req.body?.platform === "string" ? req.body.platform : ""; const approved = req.body?.approved === true; const hasContent = typeof req.body?.content === "string" && req.body.content.trim().length > 0; const connected = platformConnections.get(platform)?.status === "connected"; const reasons: string[] = [];
  if (!hasContent) reasons.push("المحتوى غير موجود."); if (!approved) reasons.push("المحتوى لم تتم الموافقة عليه."); if (!connected) reasons.push("الحساب غير متصل باتصال فعلي."); if (!hasCapability(platform, "publish")) reasons.push("المنصة لا تملك قدرة نشر في هذا النظام.");
  res.json({ success: reasons.length === 0, ready: reasons.length === 0, platform, checks: { content: hasContent, approval: approved, connection: connected, capability: hasCapability(platform, "publish") }, reasons });
});


// -------------------------------------------------------------
// Central Workspace API — deterministic, no Gemini consumption.
// This is the single operational source for showroom/catalog/content/customer state.
// -------------------------------------------------------------

function cleanText(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function workspaceId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

app.get("/api/workspace/snapshot", authenticateToken, (req, res) => {
  const isOwner = ((req as any).user as ServerUser)?.role === "owner";
  const connected = connectedPlatformIds();
  res.json({
    success: true,
    snapshot: {
      showroom: workspace.showroom,
      products: workspace.products,
      installmentPlans: workspace.installmentPlans,
      posts: workspace.posts,
      conversations: workspace.conversations,
      // Least-privilege: هوية الحساب (accountName/accountId/lastSyncAt) للمالك فقط؛
      // غير المالك يرى الحالة التقنية (status/connectedAt/providerVerified) بلا هوية.
      platforms: SUPPORTED_PLATFORMS.map((p: any) => ({ ...p, connection: snapshotConnection(p.id, isOwner) })),
      connectedPlatforms: connected,
      generatedAt: new Date().toISOString(),
      source: "server-workspace"
    }
  });
});

app.get("/api/workspace/summary", authenticateToken, (_req, res) => {
  const connected = connectedPlatformIds();
  const activePosts = workspace.posts.filter((p: any) => ["review", "approved", "scheduled", "published"].includes(p.status)).length;
  const openConversations = workspace.conversations.filter((c: any) => c.status !== "resolved").length;
  res.json({
    success: true,
    summary: {
      showroomConfigured: Boolean(workspace.showroom?.name && workspace.showroom?.name.trim()),
      products: workspace.products.length,
      inStockProducts: workspace.products.filter((p: any) => p.inStock !== false).length,
      posts: workspace.posts.length,
      activePosts,
      conversations: workspace.conversations.length,
      installmentPlans: workspace.installmentPlans.length,
      leads: workspace.leads.length,
      openLeads: workspace.leads.filter((x:any)=>!['won','lost'].includes(x.status)).length,
      tasks: workspace.tasks.length,
      openTasks: workspace.tasks.filter((x:any)=>['open','in_progress'].includes(x.status)).length,
      openConversations,
      connectedPlatforms: connected.length,
      connectedPlatformIds: connected,
      pendingJobs: automationJobs.filter((j: any) => ["queued", "approved", "ready"].includes(j.status)).length,
      gemini: geminiStatus(),
      source: "server-workspace"
    }
  });
});

app.get("/api/workspace/showroom", authenticateToken, (_req, res) => {
  res.json({ success: true, showroom: workspace.showroom });
});

app.put("/api/workspace/showroom", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  if (user.role !== "owner" && user.role !== "manager") return res.status(403).json({ success: false, error: "لا تملك صلاحية تعديل بيانات المعرض." });
  const next = req.body && typeof req.body === "object" ? req.body : {};
  workspace.showroom = {
    name: cleanText(next.name, 160), tagline: cleanText(next.tagline, 240), address: cleanText(next.address, 240),
    city: cleanText(next.city, 80), phoneUnified: cleanText(next.phoneUnified, 60), whatsappSales: cleanText(next.whatsappSales, 60),
    supportEmail: cleanText(next.supportEmail, 160), workingHours: cleanText(next.workingHours, 160), about: cleanText(next.about, 1000),
    policies: Array.isArray(next.policies) ? next.policies.filter((x: any) => typeof x === "string").slice(0, 30).map((x: string) => x.trim().slice(0, 300)) : [],
    faqs: Array.isArray(next.faqs) ? next.faqs.slice(0, 100).map((x: any) => ({ id: cleanText(x?.id, 80) || workspaceId("faq"), q: cleanText(x?.q, 300), a: cleanText(x?.a, 1000), category: cleanText(x?.category, 80) })) : []
  };
  persistState(); audit(user.id, "workspace_showroom_updated");
  res.json({ success: true, showroom: workspace.showroom });
});

/**
 * يضبط حقول التقسيط المشتقّة على منتج من سعر الكاش فقط (مصدر واحد: src/utils/installmentPrice).
 * لا يقبل قيمة شهرية متناقضة، ويعيد حساب القسط فوراً عند تغيير سعر الكاش أو المدة.
 * للتوافق: يحدّث `installmentFrom` (الذي تعرضه الواجهات الحالية) بالقيمة القديمة نفسها
 * إن لم تكن مشتقّة أصلاً، فلا تتغيّر واجهات أخرى.
 */
function applyInstallmentFields(product: any, input: InstallmentInput): void {
  const fields = productInstallmentFields(input);
  if (!fields) return; // مدخلات غير صالحة تُرفض في مسار الـAPI قبل الوصول هنا.
  product.cashPrice = fields.cashPrice;
  product.installmentPrice = fields.installmentPrice;
  product.installmentMonths = fields.installmentMonths;
  product.monthlyInstallment = fields.monthlyInstallment;
  product.installmentMarkupPercent = fields.installmentMarkupPercent;
}

app.get("/api/workspace/products", authenticateToken, (_req, res) => {
  res.json({ success: true, products: workspace.products, count: workspace.products.length });
});

app.post("/api/workspace/products", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  if (!["owner", "manager", "staff"].includes(user.role)) return res.status(403).json({ success: false, error: "لا تملك صلاحية إضافة المنتجات." });
  const b = req.body || {};
  const name = cleanText(b.name, 160);
  const cashPrice = Number(b.cashPrice);
  if (!name || !Number.isFinite(cashPrice) || cashPrice <= 0) return res.status(400).json({ success: false, error: "اسم المنتج وسعر البيع النقدي مطلوبان." });
  // مدة تقسيط صريحة غير صالحة (0/سالب/كسر/فوق الحد) تُرفض صراحةً — لا قصّ صامت.
  // غياب المدة ⇒ الافتراضي 10 (resolveInstallmentMonths).
  if (!computeInstallmentPrice({ cashPrice, installmentMonths: b.installmentMonths, installmentMarkupPercent: b.installmentMarkupPercent }).ok) {
    return res.status(400).json({ success: false, error: "بيانات التقسيط غير صحيحة: تحقّق من سعر الكاش ومدة التقسيط (1–60 شهراً)." });
  }
  const product = {
    id: cleanText(b.id, 100) || workspaceId("prod"), name, category: ["appliances","phones","construction","electronics","other"].includes(b.category) ? b.category : "other",
    modelYear: cleanText(b.modelYear, 20), cashPrice, installmentFrom: Number.isFinite(Number(b.installmentFrom)) ? Math.max(0, Number(b.installmentFrom)) : cashPrice,
    downPaymentPercent: Number.isFinite(Number(b.downPaymentPercent)) ? Math.max(0, Math.min(100, Number(b.downPaymentPercent))) : 0,
    durationMonths: Number.isInteger(Number(b.durationMonths)) ? Math.max(1, Math.min(60, Number(b.durationMonths))) : 1,
    image: cleanText(b.image, 500), inStock: b.inStock !== false, stockQuantity: Number.isFinite(Number(b.stockQuantity)) ? Math.max(0, Math.floor(Number(b.stockQuantity))) : 0, reorderLevel: Number.isFinite(Number(b.reorderLevel)) ? Math.max(0, Math.floor(Number(b.reorderLevel))) : 0, featured: b.featured === true,
    specs: Array.isArray(b.specs) ? b.specs.filter((x: any) => typeof x === "string").slice(0, 30).map((x: string) => x.trim().slice(0, 200)) : [],
    installmentOptions: Array.isArray(b.installmentOptions) ? b.installmentOptions.filter((x: any) => typeof x === "string").slice(0, 20).map((x: string) => x.trim().slice(0, 200)) : []
  };
  // سعر التقسيط والقسط الشهري مُشتقّان من cashPrice حصراً (لا قيمة يدوية ولا مخفية).
  applyInstallmentFields(product as any, { cashPrice, installmentMonths: b.installmentMonths, installmentMarkupPercent: b.installmentMarkupPercent });
  workspace.products.unshift(product); persistState(); audit(user.id, "workspace_product_created", product.id);
  res.status(201).json({ success: true, product });
});

app.patch("/api/workspace/products/:id", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  if (!["owner", "manager", "staff"].includes(user.role)) return res.status(403).json({ success: false, error: "لا تملك صلاحية تعديل المنتجات." });
  const product = workspace.products.find((p: any) => p.id === req.params.id);
  if (!product) return res.status(404).json({ success: false, error: "المنتج غير موجود." });
  const b = req.body || {};
  if (b.name !== undefined) product.name = cleanText(b.name, 160) || product.name;
  if (b.cashPrice !== undefined && Number.isFinite(Number(b.cashPrice)) && Number(b.cashPrice) > 0) product.cashPrice = Number(b.cashPrice);
  if (b.inStock !== undefined) product.inStock = Boolean(b.inStock);
  if (b.stockQuantity !== undefined && Number.isFinite(Number(b.stockQuantity))) product.stockQuantity = Math.max(0, Math.floor(Number(b.stockQuantity)));
  if (b.reorderLevel !== undefined && Number.isFinite(Number(b.reorderLevel))) product.reorderLevel = Math.max(0, Math.floor(Number(b.reorderLevel)));
  if (b.featured !== undefined) product.featured = Boolean(b.featured);
  if (b.category !== undefined && ["appliances","phones","construction","electronics","other"].includes(b.category)) product.category = b.category;
  if (b.durationMonths !== undefined && Number.isInteger(Number(b.durationMonths))) product.durationMonths = Math.max(1, Math.min(60, Number(b.durationMonths)));
  if (b.installmentFrom !== undefined && Number.isFinite(Number(b.installmentFrom)) && Number(b.installmentFrom) >= 0) product.installmentFrom = Number(b.installmentFrom);
  if (b.downPaymentPercent !== undefined && Number.isFinite(Number(b.downPaymentPercent))) product.downPaymentPercent = Math.max(0, Math.min(100, Number(b.downPaymentPercent)));
  if (b.modelYear !== undefined) product.modelYear = cleanText(b.modelYear, 20);
  if (b.image !== undefined) product.image = cleanText(b.image, 500);
  if (Array.isArray(b.specs)) product.specs = b.specs.filter((x:any)=>typeof x === "string").slice(0,30).map((x:string)=>x.trim().slice(0,200));
  if (Array.isArray(b.installmentOptions)) product.installmentOptions = b.installmentOptions.filter((x:any)=>typeof x === "string").slice(0,20).map((x:string)=>x.trim().slice(0,200));
  // إعادة حساب حقول التقسيط من cashPrice عند تغيّر سعر الكاش/المدة/النسبة فقط.
  // القيمة الشهرية المتناقضة الواردة في الجسم تُتجاهَل (لا تُحفظ) — القسط مُشتقّ دائماً.
  if (b.cashPrice !== undefined || b.installmentMonths !== undefined || b.installmentMarkupPercent !== undefined) {
    const computed = computeInstallmentPrice({ cashPrice: Number(product.cashPrice), installmentMonths: b.installmentMonths, installmentMarkupPercent: b.installmentMarkupPercent });
    if (!computed.ok) return res.status(400).json({ success: false, error: "بيانات التقسيط غير صحيحة: تحقّق من سعر الكاش ومدة التقسيط (1–60 شهراً)." });
    applyInstallmentFields(product, { cashPrice: Number(product.cashPrice), installmentMonths: b.installmentMonths, installmentMarkupPercent: b.installmentMarkupPercent });
  }
  persistState(); audit(user.id, "workspace_product_updated", product.id); res.json({ success: true, product });
});

app.delete("/api/workspace/products/:id", requireOwner, (req, res) => {
  const idx = workspace.products.findIndex((p: any) => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, error: "المنتج غير موجود." });
  const [removed] = workspace.products.splice(idx, 1); persistState(); audit((req as any).user.id, "workspace_product_deleted", removed.id);
  res.json({ success: true, id: removed.id });
});

app.get("/api/workspace/plans", authenticateToken, (_req, res) => {
  res.json({ success: true, plans: workspace.installmentPlans, count: workspace.installmentPlans.length });
});

app.post("/api/workspace/plans", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  if (!["owner", "manager", "staff"].includes(user.role)) return res.status(403).json({ success: false, error: "لا تملك صلاحية إضافة خطط التقسيط." });
  const b = req.body || {};
  const title = cleanText(b.title, 160);
  if (!title) return res.status(400).json({ success: false, error: "عنوان خطة التقسيط مطلوب." });
  const plan = { id: cleanText(b.id, 100) || workspaceId("plan"), title, description: cleanText(b.description, 1000), minDownPaymentPercent: Number.isFinite(Number(b.minDownPaymentPercent)) ? Math.max(0, Math.min(100, Number(b.minDownPaymentPercent))) : 0, maxMonths: Number.isInteger(Number(b.maxMonths)) ? Math.max(1, Math.min(60, Number(b.maxMonths))) : 60, requirements: Array.isArray(b.requirements) ? b.requirements.filter((x:any)=>typeof x === "string").slice(0,20).map((x:string)=>x.trim().slice(0,300)) : [], targetAudience: cleanText(b.targetAudience, 300), features: Array.isArray(b.features) ? b.features.filter((x:any)=>typeof x === "string").slice(0,20).map((x:string)=>x.trim().slice(0,300)) : [], shariaApproved: Boolean(b.shariaApproved) };
  workspace.installmentPlans.unshift(plan); persistState(); audit(user.id, "workspace_plan_created", plan.id);
  res.status(201).json({ success: true, plan });
});

app.patch("/api/workspace/plans/:id", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  if (!["owner", "manager", "staff"].includes(user.role)) return res.status(403).json({ success: false, error: "لا تملك صلاحية تعديل خطط التقسيط." });
  const plan = workspace.installmentPlans.find((p:any)=>p.id===req.params.id);
  if (!plan) return res.status(404).json({ success: false, error: "خطة التقسيط غير موجودة." });
  const b=req.body||{};
  if (b.title !== undefined) plan.title = cleanText(b.title,160) || plan.title;
  if (b.description !== undefined) plan.description = cleanText(b.description,1000);
  if (b.minDownPaymentPercent !== undefined && Number.isFinite(Number(b.minDownPaymentPercent))) plan.minDownPaymentPercent=Math.max(0,Math.min(100,Number(b.minDownPaymentPercent)));
  if (b.maxMonths !== undefined && Number.isInteger(Number(b.maxMonths))) plan.maxMonths=Math.max(1,Math.min(60,Number(b.maxMonths)));
  if (Array.isArray(b.requirements)) plan.requirements=b.requirements.filter((x:any)=>typeof x==='string').slice(0,20).map((x:string)=>x.trim().slice(0,300));
  if (Array.isArray(b.features)) plan.features=b.features.filter((x:any)=>typeof x==='string').slice(0,20).map((x:string)=>x.trim().slice(0,300));
  if (b.targetAudience !== undefined) plan.targetAudience=cleanText(b.targetAudience,300);
  if (b.shariaApproved !== undefined) plan.shariaApproved=Boolean(b.shariaApproved);
  persistState(); audit(user.id,"workspace_plan_updated",plan.id); res.json({success:true,plan});
});

app.delete("/api/workspace/plans/:id", requireOwner, (req,res)=>{
  const idx=workspace.installmentPlans.findIndex((p:any)=>p.id===req.params.id);
  if(idx<0) return res.status(404).json({success:false,error:"خطة التقسيط غير موجودة."});
  const [removed]=workspace.installmentPlans.splice(idx,1); persistState(); audit((req as any).user.id,"workspace_plan_deleted",removed.id); res.json({success:true,id:removed.id});
});

app.get("/api/workspace/content", authenticateToken, (_req, res) => {
  res.json({ success: true, posts: workspace.posts, count: workspace.posts.length });
});

app.post("/api/workspace/content/validate", authenticateToken, (req, res) => {
  const content = cleanText(req.body?.content, 10000);
  const platform = cleanText(req.body?.platform, 40);
  const warnings: string[] = [];
  if (!content) warnings.push("المحتوى فارغ.");
  if (content.length > 4000) warnings.push("المحتوى طويل وقد يحتاج إلى اختصار حسب المنصة.");
  if (/125\s*\/\s*125/i.test(content)) warnings.push("تم اكتشاف عداد استخدام قديم وغير مسموح.");
  if (/سيارة|سيارات|car|cars/i.test(content)) warnings.push("المحتوى يحتوي على مصطلحات سيارات، وهي خارج نشاط معرض الغرابي.");
  if (platform && !SUPPORTED_PLATFORMS.some((p: any) => p.id === platform)) warnings.push("المنصة غير مدعومة في مركز الغرابي.");
  res.json({ success: warnings.length === 0, valid: warnings.length === 0, warnings, checkedBy: "deterministic-content-guard" });
});

app.post("/api/workspace/content", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser; const b = req.body || {};
  if (!canEditContent(user.role)) return res.status(403).json({ success: false, error: "لا تملك صلاحية إنشاء المحتوى." });
  const content = cleanText(b.content, 10000); const targets = Array.isArray(b.targetPlatforms) ? [...new Set(b.targetPlatforms.filter((x: any) => SUPPORTED_PLATFORMS.some((p: any) => p.id === x)))].slice(0,10) : [];
  if (!content || !targets.length) return res.status(400).json({ success: false, error: "المحتوى ومنصة واحدة على الأقل مطلوبان." });
  if (/125\s*\/\s*125/i.test(content) || /سيارة|سيارات|\bcars?\b/i.test(content)) return res.status(422).json({ success: false, error: "المحتوى خالف قواعد مشروع الغرابي: لا عدادات قديمة ولا محتوى سيارات." });
  // سياسة حالة واحدة: لا يُسمح بإنشاء منشور بحالة approved/scheduled (مسار المالك) أو published (يتطلب إثبات مزود).
  const desiredStatus = b.status === undefined ? "draft" : String(b.status);
  const statusDecision = canSetContentStatusByRole(user.role, desiredStatus);
  if (!statusDecision.allowed) return res.status(statusDecision.code === "PUBLISHED_REQUIRES_PROVIDER_PROOF" ? 409 : 403).json({ success: false, code: statusDecision.code, error: statusDecision.reason });
  const resolvedStatus = desiredStatus;
  const post = { id: cleanText(b.id, 100) || workspaceId("post"), title: cleanText(b.title, 160) || "مسودة جديدة", content, platformVersions: b.platformVersions && typeof b.platformVersions === "object" ? b.platformVersions : undefined, targetPlatforms: targets, mediaUrl: cleanText(b.mediaUrl, 500) || undefined, mediaType: ["image","video","carousel"].includes(b.mediaType) ? b.mediaType : undefined, status: resolvedStatus, scheduledFor: normalizeScheduleInput(b.scheduledFor) ?? undefined, publishedAt: cleanText(b.publishedAt, 80) || undefined, createdAt: cleanText(b.createdAt, 80) || new Date().toISOString(), authorId: user.id, authorName: cleanText(b.authorName, 160) || user.name, authorRole: cleanText(b.authorRole, 40) || user.role, history: Array.isArray(b.history) ? b.history.slice(-50) : [], metrics: b.metrics && typeof b.metrics === "object" ? b.metrics : undefined, tags: Array.isArray(b.tags) ? b.tags.filter((x:any)=>typeof x === "string").slice(0,20) : [], campaignName: cleanText(b.campaignName, 160) };
  workspace.posts.unshift(post); persistState(); audit(user.id, "workspace_content_created", post.id); res.status(201).json({ success: true, post });
});

app.patch("/api/workspace/content/:id", authenticateToken, (req,res)=>{
  const user=(req as any).user as ServerUser; const post=workspace.posts.find((p:any)=>p.id===req.params.id);
  if(!post) return res.status(404).json({success:false,error:"المنشور غير موجود."});
  if (!canEditContent(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية تعديل المحتوى."});
  const b=req.body||{};
  if(b.title!==undefined) post.title=cleanText(b.title,160)||post.title;
  if(b.content!==undefined){ const c=cleanText(b.content,10000); if(!c) return res.status(400).json({success:false,error:"المحتوى لا يمكن أن يكون فارغاً."}); if(/125\s*\/\s*125/i.test(c)||/سيارة|سيارات|\bcars?\b/i.test(c)) return res.status(422).json({success:false,error:"المحتوى خالف قواعد مشروع الغرابي."}); post.content=c; }
  if(Array.isArray(b.targetPlatforms)) post.targetPlatforms=[...new Set(b.targetPlatforms.filter((x:any)=>SUPPORTED_PLATFORMS.some((p:any)=>p.id===x)))].slice(0,10);
  // سياسة حالة واحدة: approved/scheduled مقتصران على مساريهما الرسميين (owner)، وpublished يتطلب إثبات مزود.
  if(b.status!==undefined){
    const decision=canSetContentStatusByRole(user.role,String(b.status));
    if(!decision.allowed) return res.status(decision.code==='PUBLISHED_REQUIRES_PROVIDER_PROOF'?409:403).json({success:false,code:decision.code,error:decision.reason});
    post.status=String(b.status);
  }
  if(b.scheduledFor!==undefined){ const norm=normalizeScheduleInput(b.scheduledFor); post.scheduledFor=norm ?? undefined; }
  if(b.campaignName!==undefined) post.campaignName=cleanText(b.campaignName,160);
  persistState(); audit(user.id,"workspace_content_updated",post.id); res.json({success:true,post});
});

/**
 * استضافة فيديو مركز المحتوى تلقائياً على Drive العام قبل إنشاء المنشور (إغلاق الفجوة
 * المذكورة في توثيق Task #25): بدل أن يلصق المالك رابط الفيديو العام يدوياً، تستدعي
 * الواجهة هذا المسار فور إرفاق الفيديو فيحصل على رابط عام حقيقي تلقائياً عبر نفس آلية
 * resolvePublicVideoUrl/publishVideoPublicly المستخدمة أصلاً وقت النشر (Task #21/#23).
 * لا نشر خارجي هنا إطلاقاً — تجهيز وسيط فقط، فلا يحتاج موافقة المالك (owner)، بل نفس
 * صلاحية إنشاء المحتوى (canEditContent) المستخدمة في إنشاء المنشور نفسه.
 */
app.post("/api/workspace/content/video/host", express.json({ limit: CONTENT_UPLOAD_JSON_LIMIT }), authenticateToken, async (req, res) => {
  const user = (req as any).user as ServerUser;
  if (!canEditContent(user.role)) return res.status(403).json({ success: false, error: "لا تملك صلاحية إعداد وسائط المحتوى." });
  // مهلة إجمالية صريحة حول السلسلة كاملة: لا يبقى طلب المتصفح معلّقاً بلا نهاية
  // حتى لو تعلّق Drive (نقل/تجديد). عند التجاوز نرد خطأً واضحاً بدل التعليق.
  const hostTimeoutMs = envTimeoutMs(process.env as NodeJS.ProcessEnv, "DRIVE_HOST_TIMEOUT_MS", DRIVE_PUBLIC_HOST_TIMEOUT_MS);
  let resolved: Awaited<ReturnType<typeof resolvePublicVideoUrl>>;
  try {
    resolved = await settleWithTimeout(resolvePublicVideoUrl(req.body || {}), hostTimeoutMs);
  } catch (hostErr: any) {
    const isTimeout = hostErr?.code === "timeout";
    return res.status(isTimeout ? 504 : 502).json({
      success: false,
      code: isTimeout ? "HOSTING_TIMEOUT" : "VIDEO_HOSTING_FAILED",
      error: isTimeout
        ? "انتهت مهلة تجهيز رابط الفيديو العام قبل اكتمالها. يمكنك إعادة المحاولة أو لصق رابط فيديو عام يدوياً."
        : "فشل تجهيز رابط الفيديو العام. يمكنك إعادة المحاولة أو لصق رابط فيديو عام يدوياً.",
      ...(isTimeout ? { timeoutMs: hostTimeoutMs } : {}),
    });
  }
  if (!resolved.ok) return res.status(resolved.status).json({ success: false, error: resolved.error, code: resolved.code });
  if (!resolved.url) return res.status(400).json({ success: false, error: "لا بايتات فيديو ولا رابط صريح مرسَل.", code: "VIDEO_INPUT_REQUIRED" });
  audit(user.id, "content_video_auto_hosted", resolved.url.slice(0, 120));
  res.json({ success: true, url: resolved.url });
});

/**
 * نقطة خدمة وسائط الفيديو العامة (بلا مصادقة، كما يتطلبها سحب Meta للرابط).
 * تُخدِم البايتات الحقيقية من ذاكرة الخادم بنوع محتوى صحيح ودعم Range — بديل
 * مضمون لرابط Drive الوسيط الذي قد يُعيد HTML. الوصول محمي بتوقيع HMAC على
 * معرّف المادة (يُولَّد في resolvePublicVideoUrl)، فلا يمكن تخمين روابط ملفات
 * أخرى. البايتات لا تُسجَّل ولا تُعاد إلا للرابط الموقّع نفسه.
 */
app.get("/api/public/video/:ref", (req, res) => {
  const ref = String(req.params.ref || "");
  const sig = typeof req.query.sig === "string" ? req.query.sig : "";
  if (!ref || !verifyMediaSignature(ref, sig)) return res.status(403).json({ success: false, error: "رابط غير صالح." });
  const media = contentMediaBytes(ref);
  if (!media) return res.status(404).json({ success: false, error: "المادة غير متوفرة أو انتهت صلاحيتها." });
  const total = media.bytes.length;
  res.setHeader("Content-Type", media.mimeType || "video/mp4");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store");
  // دعم Range (يتطلبه سحب الفيديو من خوادم Meta/المتصفحات) — 206 عند طلب مقطع.
  const range = typeof req.headers.range === "string" ? req.headers.range : "";
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : total - 1;
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end) || end >= total) end = total - 1;
    if (start > end) {
      res.status(416).setHeader("Content-Range", `bytes */${total}`);
      return res.end();
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Content-Length", String(end - start + 1));
    return res.end(media.bytes.subarray(start, end + 1));
  }
  res.setHeader("Content-Length", String(total));
  return res.end(media.bytes);
});

/**
 * النشر متعدد المنصات بنقرة واحدة (دفعة النشر متعدد المنصات).
 *
 * يأخذ منشوراً واحداً (targetPlatforms مصفوفة) ويوزّعه بالتوازي على كل منصة عبر
 * **نفس** المنفّذ المشترك `executePlatformPublish` — لا مسار نشر ثانٍ ولا إعادة
 * كتابة. كل منصة تُتابع بحالة مستقلة في `post.platformPublishResults`.
 *
 * البوابات الثابتة (بلا أي تخفيف):
 *  - owner فقط (requireOwner)، ويبدأ بنقرة إنسان — لا نشر تلقائي.
 *  - المنشور يجب أن يكون status==="approved" عبر المسار الرسمي.
 *  - لا يُعلن "published" بلا معرّف نشر حقيقي من مزود المنصة.
 */
app.post("/api/workspace/content/:id/publish", requireOwner, async (req, res) => {
  const user = (req as any).user as { id: string };
  const post = workspace.posts.find((p: any) => p.id === req.params.id);
  if (!post) return res.status(404).json({ success: false, error: "المنشور غير موجود." });
  if (post.status !== "approved") {
    return res.status(409).json({ success: false, error: "لا نشر إلا لمنشور معتمد (approved) عبر المسار الرسمي.", code: "APPROVAL_REQUIRED", status: post.status });
  }
  const requested = Array.isArray(post.targetPlatforms) ? post.targetPlatforms.filter((x: any) => SUPPORTED_PLATFORMS.some((p: any) => p.id === x)) : [];
  if (!requested.length) return res.status(400).json({ success: false, error: "لا توجد منصات هدف صالحة على المنشور.", code: "NO_TARGET_PLATFORMS" });

  // توزيع متوازٍ: كل منصة مستقلة تماماً عن الأخريات (نجاح/فشل/سبب منفصل).
  //
  // إصلاح حقيقي (Task #25): كانت هذه النقطة تُرسل post.content الحرفي نفسه لكل
  // منصة، فتتجاهل النسخ المكيَّفة per-platform التي يبنيها "مركز صناعة المحتوى"
  // فعلاً (adaptedVersions/platformVersions) — فيصل نص تيك توك القصير مثلاً
  // حرفياً إلى فيسبوك/إنستغرام بلا أي تكييف. كما كانت لا تمرّر أي وسيط (صورة/
  // فيديو) مطلقاً، فتفشل إنستغرام/ثريدز دائماً بـMEDIA_REQUIRED رغم أن المالك
  // أرفق فيديو ورابطاً عاماً فعلياً في واجهة التوليد. الإصلاح: كل منصة تأخذ
  // نسختها المكيَّفة (أو النص العام إن لم توجد نسخة خاصة بها)، ووسيط المنشور
  // الحقيقي (post.mediaUrl/mediaType) يُمرَّر كـvideoUrl/imageUrl بحسب نوعه —
  // فتُستخدم بنية resolvePublicVideoUrl (Task #23) والموصلات الحقيقية
  // (Task #21/22/24) فعلياً بدل تجاهلها بصمت.
  const settled = await Promise.allSettled(requested.map(async (platform: string) => {
    const perPlatformContent = (post.platformVersions && typeof post.platformVersions[platform] === "string" && post.platformVersions[platform].trim())
      ? post.platformVersions[platform]
      : post.content;
    const mediaFields: Record<string, any> = {};
    const mediaUrl = typeof post.mediaUrl === "string" ? post.mediaUrl.trim() : "";
    if (mediaUrl) {
      if (post.mediaType === "video") mediaFields.videoUrl = mediaUrl;
      else if (post.mediaType === "image") mediaFields.imageUrl = mediaUrl;
    }
    const result = await executePlatformPublish(platform, { ...req.body, ...mediaFields, content: perPlatformContent, approved: true, postId: post.id }, user.id);
    return { platform, result };
  }));

  const results: Record<string, any> = {};
  requested.forEach((platform: string, idx: number) => {
    const s = settled[idx];
    if (s.status === "fulfilled") {
      const { result } = s.value;
      const providerPostId = result.body?.providerPostId || result.body?.providerPublishId || null;
      const delivered = result.status === 200 && Boolean(providerPostId);
      results[platform] = { state: delivered ? "published" : (result.status === 200 ? "publishing" : "failed"), httpStatus: result.status, providerPostId, error: delivered ? null : (result.body?.error || null), code: result.body?.code || null, receipt: result.body?.receipt || null, at: new Date().toISOString() };
    } else {
      results[platform] = { state: "failed", httpStatus: 502, providerPostId: null, error: String((s as any).reason?.message || s.reason || "provider_error").slice(0, 200), code: "PROVIDER_ERROR", receipt: null, at: new Date().toISOString() };
    }
  });

  post.platformPublishResults = results;
  // المنشور يُعلن published فقط إن نُشر فعلاً على منصة واحدة على الأقل بمعرّف مزود حقيقي.
  const anyDelivered = Object.values(results).some((r: any) => r.state === "published");
  if (anyDelivered) post.status = "published";
  persistState();
  audit(user.id, "workspace_content_multiplatform_publish", post.id);
  return res.json({ success: true, post, results, anyDelivered });
});

app.delete("/api/workspace/content/:id", authenticateToken, (req,res)=>{
  const user=(req as any).user as ServerUser; if(!["owner","manager","staff","content_creator"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية حذف المحتوى."});
  const idx=workspace.posts.findIndex((p:any)=>p.id===req.params.id); if(idx<0) return res.status(404).json({success:false,error:"المنشور غير موجود."});
  const [removed]=workspace.posts.splice(idx,1); persistState(); audit(user.id,"workspace_content_deleted",removed.id); res.json({success:true,id:removed.id});
});

app.get("/api/workspace/conversations", authenticateToken, (_req, res) => {
  res.json({ success: true, conversations: workspace.conversations, count: workspace.conversations.length });
});

app.patch("/api/workspace/conversations/:id", authenticateToken, (req,res)=>{
  const user=(req as any).user as ServerUser; const c=workspace.conversations.find((x:any)=>x.id===req.params.id);
  if(!c) return res.status(404).json({success:false,error:"المحادثة غير موجودة."});
  if(!["owner","manager","staff","customer_support"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية تعديل المحادثة."});
  const b=req.body||{};
  if(b.status && ["new","ai_replied","transferred_human","resolved"].includes(b.status)) c.status=b.status;
  if(b.assignedStaff!==undefined) c.assignedStaff=cleanText(b.assignedStaff,160);
  if(b.category!==undefined) c.category=cleanText(b.category,120);
  if(b.urgency && ["high","medium","low"].includes(b.urgency)) c.urgency=b.urgency;
  if(b.notes!==undefined) c.notes=cleanText(b.notes,2000);
  if(typeof b.replyText==='string' && b.replyText.trim()){ const text=cleanText(b.replyText,4000); c.history=Array.isArray(c.history)?c.history:[]; c.history.push({id:workspaceId("msg"),sender:b.asAi===true?"ai":"human",senderName:b.asAi===true?"الغرابي AI":user.name,text,timestamp:new Date().toISOString()}); c.lastMessage=text; c.lastMessageTime=new Date().toISOString(); c.status=b.asAi===true?"ai_replied":"transferred_human"; }
  persistState(); audit(user.id,"workspace_conversation_updated",c.id); res.json({success:true,conversation:c});
});

app.post("/api/workspace/conversations", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser; const b = req.body || {}; const message = cleanText(b.message, 4000);
  if (!message) return res.status(400).json({ success: false, error: "رسالة العميل مطلوبة." });
  const c = { id: cleanText(b.id, 100) || workspaceId("conv"), customerName: cleanText(b.customerName,120) || "عميل", phone: cleanText(b.phone,60), channel: SUPPORTED_PLATFORMS.some((p:any)=>p.id===b.channel) ? b.channel : "other", status: "new", createdAt: new Date().toISOString(), lastMessage: message, history: [{ id: workspaceId("msg"), sender: "customer", text: message, timestamp: new Date().toISOString() }] };
  workspace.conversations.unshift(c); persistState(); audit(user.id, "workspace_conversation_created", c.id); res.status(201).json({ success: true, conversation: c });
});


// -------------------------------------------------------------
// Inventory + customer 360 + operational reporting. Deterministic, durable and Gemini-free.
function inventoryProductView(product:any){ const qty=Math.max(0,Math.floor(Number(product.stockQuantity||0))); const reorder=Math.max(0,Math.floor(Number(product.reorderLevel||0))); return {...product,stockQuantity:qty,reorderLevel:reorder,stockStatus:qty===0?"out":(reorder>0&&qty<=reorder?"low":"ok")}; }
app.get("/api/inventory", authenticateToken, (_req,res)=>{ const items=workspace.products.map(inventoryProductView); res.json({success:true,items,summary:{products:items.length,totalUnits:items.reduce((n:number,x:any)=>n+x.stockQuantity,0),lowStock:items.filter((x:any)=>x.stockStatus==="low").length,outOfStock:items.filter((x:any)=>x.stockStatus==="out").length}}); });
app.get("/api/inventory/movements", authenticateToken, (req,res)=>{ const productId=typeof req.query.productId==="string"?req.query.productId:""; let rows=(workspace as any).inventoryMovements.slice(); if(productId) rows=rows.filter((x:any)=>x.productId===productId); res.json({success:true,movements:rows.slice(0,500)}); });
app.post("/api/inventory/:productId/adjust", authenticateToken, (req,res)=>{ const user=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية تعديل المخزون."}); const product=workspace.products.find((x:any)=>x.id===req.params.productId); if(!product) return res.status(404).json({success:false,error:"المنتج غير موجود."}); const delta=Number(req.body?.delta), reason=cleanText(req.body?.reason,240); if(!Number.isInteger(delta)||delta===0||!reason) return res.status(400).json({success:false,error:"قيمة الحركة والسبب مطلوبان."}); const before=Math.max(0,Math.floor(Number(product.stockQuantity||0))), after=before+delta; if(after<0) return res.status(400).json({success:false,error:"لا يمكن أن يصبح المخزون سالباً."}); product.stockQuantity=after; product.inStock=after>0; const movement={id:workspaceId("stock"),productId:product.id,productName:product.name,delta,before,after,reason,createdBy:user.id,createdAt:new Date().toISOString()}; (workspace as any).inventoryMovements.unshift(movement); (workspace as any).inventoryMovements=(workspace as any).inventoryMovements.slice(0,20000); persistState(); audit(user.id,"inventory_adjusted",`${product.id}:${delta}`); res.json({success:true,product:inventoryProductView(product),movement}); });
app.get("/api/inventory/alerts", authenticateToken, (_req,res)=>{ const alerts=workspace.products.map(inventoryProductView).filter((x:any)=>x.stockStatus!=="ok").map((x:any)=>({id:x.id,name:x.name,stockQuantity:x.stockQuantity,reorderLevel:x.reorderLevel,status:x.stockStatus})); res.json({success:true,alerts}); });
app.get("/api/customers/360", authenticateToken, (req,res)=>{ const user=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية الوصول لبيانات العملاء."}); const q=normalizeSearch(req.query.q); const map=new Map<string,any>(); const key=(n:any,p:any)=>String(p||n||"unknown").trim().toLowerCase(); const make=(n:any,p:any)=>({id:`cust-${Buffer.from(key(n,p)).toString("hex").slice(0,18)}`,name:n||"عميل",phone:p||"",leads:0,sales:0,paid:0,balance:0,conversations:0}); for(const l of workspace.leads){const k=key(l.customerName,l.phone),c=map.get(k)||make(l.customerName,l.phone);c.leads++;map.set(k,c)} for(const s of workspace.sales){const k=key(s.customerName,s.phone),c=map.get(k)||make(s.customerName,s.phone);c.sales++;c.paid+=salePaid(s.id);c.balance+=saleBalance(s);map.set(k,c)} for(const v of workspace.conversations){const k=key(v.customerName,v.phone),c=map.get(k)||make(v.customerName,v.phone);c.conversations++;map.set(k,c)} let customers=Array.from(map.values()); if(q) customers=customers.filter((c:any)=>containsQuery(c.name,q)||containsQuery(c.phone,q)); customers.sort((a:any,b:any)=>(b.sales-a.sales)||(b.conversations-a.conversations)); res.json({success:true,customers:customers.slice(0,100),count:customers.length}); });
app.get("/api/reports/operations", authenticateToken, (req,res)=>{ const user=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية الوصول للتقارير التشغيلية."}); const days=Math.min(90,Math.max(1,Number(req.query.days||30))); const since=Date.now()-days*86400000; const sales=workspace.sales.filter((x:any)=>Date.parse(x.createdAt||"")>=since), payments=workspace.payments.filter((x:any)=>Date.parse(x.createdAt||"")>=since), daily=new Map<string,any>(); for(const s of sales){const d=String(s.createdAt).slice(0,10),r=daily.get(d)||{date:d,sales:0,salesValue:0,collected:0};r.sales++;r.salesValue+=Number(s.totalAmount||0);daily.set(d,r)} for(const p of payments){const d=String(p.createdAt).slice(0,10),r=daily.get(d)||{date:d,sales:0,salesValue:0,collected:0};r.collected+=Number(p.amount||0);daily.set(d,r)} const inv=workspace.products.map(inventoryProductView); res.json({success:true,periodDays:days,metrics:{salesCount:sales.length,salesValue:sales.reduce((n:number,x:any)=>n+Number(x.totalAmount||0),0),collected:payments.reduce((n:number,x:any)=>n+Number(x.amount||0),0),openLeads:workspace.leads.filter((x:any)=>!['won','lost'].includes(x.status)).length,openTasks:workspace.tasks.filter((x:any)=>['open','in_progress'].includes(x.status)).length,lowStock:inv.filter((x:any)=>x.stockStatus!=="ok").length,openConversations:workspace.conversations.filter((x:any)=>x.status!=="resolved").length},daily:Array.from(daily.values()).sort((a:any,b:any)=>a.date.localeCompare(b.date))}); });

// CRM + operational task center. Deterministic, durable and Gemini-free.
// -------------------------------------------------------------
const LEAD_STATUSES = ["new", "contacted", "qualified", "proposal", "won", "lost"];
const TASK_STATUSES = ["open", "in_progress", "done", "cancelled"];
const TASK_PRIORITIES = ["low", "medium", "high", "urgent"];

function sanitizeLead(body: any, existing: any = {}) {
  const b = body || {};
  const status = LEAD_STATUSES.includes(b.status) ? b.status : (existing.status || "new");
  const source = cleanText(b.source ?? existing.source, 80) || "direct";
  return {
    ...existing,
    id: cleanText(b.id, 100) || existing.id || workspaceId("lead"),
    customerName: cleanText(b.customerName ?? existing.customerName, 120) || "عميل",
    phone: cleanText(b.phone ?? existing.phone, 60),
    channel: SUPPORTED_PLATFORMS.some((p:any)=>p.id===b.channel) ? b.channel : (existing.channel || "direct"),
    source,
    status,
    interestedProduct: cleanText(b.interestedProduct ?? existing.interestedProduct, 160),
    budget: Number.isFinite(Number(b.budget ?? existing.budget)) ? Math.max(0, Number(b.budget ?? existing.budget)) : undefined,
    notes: cleanText(b.notes ?? existing.notes, 2000),
    nextFollowUpAt: cleanText(b.nextFollowUpAt ?? existing.nextFollowUpAt, 80) || undefined,
    ownerId: cleanText(b.ownerId ?? existing.ownerId, 100) || undefined,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastContactAt: cleanText(b.lastContactAt ?? existing.lastContactAt, 80) || undefined,
    conversationId: cleanText(b.conversationId ?? existing.conversationId, 100) || undefined,
  };
}

app.get("/api/crm/leads", authenticateToken, (req,res) => {
  const user=(req as any).user as ServerUser;
  const status=typeof req.query.status === "string" ? req.query.status : "";
  const dueOnly=req.query.dueOnly === "true";
  const now=Date.now();
  let leads=workspace.leads.slice();
  if(user.role !== "owner" && user.role !== "manager") leads=leads.filter((x:any)=>!x.ownerId || x.ownerId===user.id);
  if(LEAD_STATUSES.includes(status)) leads=leads.filter((x:any)=>x.status===status);
  if(dueOnly) leads=leads.filter((x:any)=>x.nextFollowUpAt && Number.isFinite(Date.parse(x.nextFollowUpAt)) && Date.parse(x.nextFollowUpAt)<=now && !["won","lost"].includes(x.status));
  res.json({success:true,leads:leads.slice(0,500),count:leads.length,generatedAt:new Date().toISOString()});
});

app.post("/api/crm/leads", authenticateToken, (req,res) => {
  const user=(req as any).user as ServerUser;
  if(!["owner","manager","staff","customer_support"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية إضافة العملاء المحتملين."});
  const lead=sanitizeLead({...req.body, ownerId:req.body?.ownerId || user.id});
  workspace.leads.unshift(lead); persistState(); audit(user.id,"crm_lead_created",lead.id);
  res.status(201).json({success:true,lead});
});

app.patch("/api/crm/leads/:id", authenticateToken, (req,res) => {
  const user=(req as any).user as ServerUser;
  const lead=workspace.leads.find((x:any)=>x.id===req.params.id);
  if(!lead) return res.status(404).json({success:false,error:"العميل المحتمل غير موجود."});
  if(user.role!=="owner" && user.role!=="manager" && lead.ownerId && lead.ownerId!==user.id) return res.status(403).json({success:false,error:"لا تملك صلاحية تعديل هذا العميل."});
  const updated=sanitizeLead(req.body,lead); Object.assign(lead,updated);
  persistState(); audit(user.id,"crm_lead_updated",lead.id); res.json({success:true,lead});
});

app.delete("/api/crm/leads/:id", requireOwner, (req,res) => {
  const idx=workspace.leads.findIndex((x:any)=>x.id===req.params.id);
  if(idx<0) return res.status(404).json({success:false,error:"العميل المحتمل غير موجود."});
  const [removed]=workspace.leads.splice(idx,1); persistState(); audit((req as any).user.id,"crm_lead_deleted",removed.id);
  res.json({success:true,id:removed.id});
});

app.post("/api/crm/leads/from-conversation/:id", authenticateToken, (req,res) => {
  const user=(req as any).user as ServerUser;
  const c=workspace.conversations.find((x:any)=>x.id===req.params.id);
  if(!c) return res.status(404).json({success:false,error:"المحادثة غير موجودة."});
  const existing=workspace.leads.find((x:any)=>x.conversationId===c.id);
  if(existing) return res.json({success:true,lead:existing,duplicate:true});
  const lead=sanitizeLead({customerName:c.customerName,phone:c.phone,channel:c.channel,interestedProduct:c.interestedProduct,notes:c.notes,conversationId:c.id,ownerId:user.id,source:c.channel||"conversation"});
  workspace.leads.unshift(lead); persistState(); audit(user.id,"crm_lead_from_conversation",`${c.id}:${lead.id}`);
  res.status(201).json({success:true,lead});
});

app.get("/api/crm/follow-ups", authenticateToken, (req,res) => {
  const now=Date.now();
  const horizonRaw=Number(req.query.horizonHours || 24);
  const horizon=Math.min(168,Math.max(1,Number.isFinite(horizonRaw)?horizonRaw:24));
  const end=now+horizon*60*60*1000;
  const due=workspace.leads.filter((x:any)=>x.nextFollowUpAt && Number.isFinite(Date.parse(x.nextFollowUpAt)) && Date.parse(x.nextFollowUpAt)<=end && !["won","lost"].includes(x.status)).sort((a:any,b:any)=>Date.parse(a.nextFollowUpAt)-Date.parse(b.nextFollowUpAt));
  res.json({success:true,now:new Date(now).toISOString(),horizonHours:horizon,due:due.slice(0,200),count:due.length});
});

function sanitizeTask(body:any, existing:any={}, userId="") {
  const b=body||{};
  return {
    ...existing,
    id:cleanText(b.id,100)||existing.id||workspaceId("task"),
    title:cleanText(b.title??existing.title,180),
    description:cleanText(b.description??existing.description,1500),
    status:TASK_STATUSES.includes(b.status)?b.status:(existing.status||"open"),
    priority:TASK_PRIORITIES.includes(b.priority)?b.priority:(existing.priority||"medium"),
    dueAt:cleanText(b.dueAt??existing.dueAt,80)||undefined,
    assigneeId:cleanText(b.assigneeId??existing.assigneeId,100)||userId||undefined,
    relatedType:cleanText(b.relatedType??existing.relatedType,60)||undefined,
    relatedId:cleanText(b.relatedId??existing.relatedId,100)||undefined,
    createdBy:existing.createdBy||userId,
    createdAt:existing.createdAt||new Date().toISOString(),
    updatedAt:new Date().toISOString(),
    completedAt:b.status==="done"?(existing.completedAt||new Date().toISOString()):existing.completedAt,
  };
}

app.get("/api/tasks", authenticateToken, (req,res) => {
  const user=(req as any).user as ServerUser;
  let tasks=workspace.tasks.slice();
  if(user.role!=="owner" && user.role!=="manager") tasks=tasks.filter((x:any)=>x.assigneeId===user.id || x.createdBy===user.id);
  if(typeof req.query.status==="string" && TASK_STATUSES.includes(req.query.status)) tasks=tasks.filter((x:any)=>x.status===req.query.status);
  res.json({success:true,tasks:tasks.slice(0,500),count:tasks.length});
});

app.post("/api/tasks", authenticateToken, (req,res) => {
  const user=(req as any).user as ServerUser;
  const task=sanitizeTask(req.body,{},user.id);
  if(!task.title) return res.status(400).json({success:false,error:"عنوان المهمة مطلوب."});
  workspace.tasks.unshift(task); persistState(); audit(user.id,"task_created",task.id); res.status(201).json({success:true,task});
});

app.patch("/api/tasks/:id", authenticateToken, (req,res) => {
  const user=(req as any).user as ServerUser;
  const task=workspace.tasks.find((x:any)=>x.id===req.params.id);
  if(!task) return res.status(404).json({success:false,error:"المهمة غير موجودة."});
  if(user.role!=="owner" && user.role!=="manager" && task.assigneeId!==user.id && task.createdBy!==user.id) return res.status(403).json({success:false,error:"لا تملك صلاحية تعديل هذه المهمة."});
  Object.assign(task,sanitizeTask(req.body,task,user.id));
  persistState(); audit(user.id,"task_updated",task.id); res.json({success:true,task});
});

app.delete("/api/tasks/:id", authenticateToken, (req,res) => {
  const user=(req as any).user as ServerUser;
  const idx=workspace.tasks.findIndex((x:any)=>x.id===req.params.id); if(idx<0) return res.status(404).json({success:false,error:"المهمة غير موجودة."});
  const task=workspace.tasks[idx];
  if(user.role!=="owner" && user.role!=="manager" && task.createdBy!==user.id) return res.status(403).json({success:false,error:"لا تملك صلاحية حذف هذه المهمة."});
  workspace.tasks.splice(idx,1); persistState(); audit(user.id,"task_deleted",task.id); res.json({success:true,id:task.id});
});


// -------------------------------------------------------------
// Sales + installment ledger. Durable, auditable and Gemini-free.
// -------------------------------------------------------------
const SALE_STATUSES = ["draft", "confirmed", "active_installment", "completed", "cancelled"];
const PAYMENT_METHODS = ["cash", "bank", "transfer", "other"];
function sanitizeSale(body:any, existing:any={}, userId="") {
  const b=body||{};
  const total=Math.max(0, Number(b.totalAmount ?? existing.totalAmount ?? 0) || 0);
  const down=Math.min(total, Math.max(0, Number(b.downPayment ?? existing.downPayment ?? 0) || 0));
  const months=Math.min(60, Math.max(1, Number(b.months ?? existing.months ?? 1) || 1));
  return { ...existing, id:cleanText(b.id,100)||existing.id||workspaceId("sale"), customerName:cleanText(b.customerName??existing.customerName,120)||"عميل", phone:cleanText(b.phone??existing.phone,60), productId:cleanText(b.productId??existing.productId,100)||undefined, productName:cleanText(b.productName??existing.productName,180), totalAmount:total, downPayment:down, financedAmount:Math.max(0,total-down), months, monthlyAmount:months?Math.ceil(Math.max(0,total-down)/months):0, status:SALE_STATUSES.includes(b.status)?b.status:(existing.status||"draft"), ownerId:cleanText(b.ownerId??existing.ownerId,100)||userId, notes:cleanText(b.notes??existing.notes,1500), createdBy:existing.createdBy||userId, createdAt:existing.createdAt||new Date().toISOString(), updatedAt:new Date().toISOString() };
}
function salePaid(saleId:string){ return workspace.payments.filter((p:any)=>p.saleId===saleId).reduce((n:number,p:any)=>n+Number(p.amount||0),0); }
function saleBalance(s:any){ return Math.max(0,Number(s.financedAmount||0)-salePaid(s.id)); }
app.get("/api/sales", authenticateToken, (req,res)=>{
  const user=(req as any).user as ServerUser; let sales=workspace.sales.slice();
  if(user.role!=="owner" && user.role!=="manager") sales=sales.filter((x:any)=>!x.ownerId||x.ownerId===user.id||x.createdBy===user.id);
  if(typeof req.query.status==="string" && SALE_STATUSES.includes(req.query.status)) sales=sales.filter((x:any)=>x.status===req.query.status);
  res.json({success:true,sales:sales.slice(0,1000).map((x:any)=>({...x,paidAmount:salePaid(x.id),balance:saleBalance(x)})),count:sales.length});
});
app.post("/api/sales", authenticateToken, (req,res)=>{
  const user=(req as any).user as ServerUser;
  if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية إنشاء عملية بيع."});
  const sale=sanitizeSale(req.body,{},user.id); if(!sale.productName||sale.totalAmount<=0) return res.status(400).json({success:false,error:"اسم المنتج وقيمة البيع مطلوبان."});
  workspace.sales.unshift(sale); persistState(); audit(user.id,"sale_created",sale.id); res.status(201).json({success:true,sale:{...sale,paidAmount:0,balance:saleBalance(sale)}});
});
app.patch("/api/sales/:id", authenticateToken, (req,res)=>{
  const user=(req as any).user as ServerUser; const sale=workspace.sales.find((x:any)=>x.id===req.params.id); if(!sale) return res.status(404).json({success:false,error:"عملية البيع غير موجودة."});
  if(user.role!=="owner"&&user.role!=="manager"&&sale.ownerId!==user.id&&sale.createdBy!==user.id) return res.status(403).json({success:false,error:"لا تملك صلاحية تعديل هذه العملية."});
  Object.assign(sale,sanitizeSale(req.body,sale,user.id)); persistState(); audit(user.id,"sale_updated",sale.id); res.json({success:true,sale:{...sale,paidAmount:salePaid(sale.id),balance:saleBalance(sale)}});
});
app.post("/api/sales/:id/payments", authenticateToken, (req,res)=>{
  const user=(req as any).user as ServerUser; const sale=workspace.sales.find((x:any)=>x.id===req.params.id); if(!sale) return res.status(404).json({success:false,error:"عملية البيع غير موجودة."});
  if(user.role!=="owner"&&user.role!=="manager"&&sale.ownerId!==user.id&&sale.createdBy!==user.id) return res.status(403).json({success:false,error:"لا تملك صلاحية تسجيل الدفعة."});
  const amount=Math.max(0,Number(req.body?.amount)||0); if(amount<=0) return res.status(400).json({success:false,error:"قيمة الدفعة يجب أن تكون أكبر من صفر."});
  const balance=saleBalance(sale); if(amount>balance) return res.status(400).json({success:false,error:`قيمة الدفعة تتجاوز الرصيد المتبقي (${balance.toLocaleString()} د.ع).`});
  const method=PAYMENT_METHODS.includes(req.body?.method)?req.body.method:"other";
  const payment={id:workspaceId("pay"),saleId:sale.id,amount,method,note:cleanText(req.body?.note,500),receivedBy:user.id,receivedAt:new Date().toISOString()}; workspace.payments.unshift(payment);
  const newBalance=saleBalance(sale); if(newBalance===0) sale.status="completed"; else if(sale.status==="confirmed"||sale.status==="draft") sale.status="active_installment";
  persistState(); audit(user.id,"sale_payment_recorded",`${sale.id}:${payment.id}`); res.status(201).json({success:true,payment,sale:{...sale,paidAmount:salePaid(sale.id),balance:newBalance}});
});
app.get("/api/sales/:id/payments", authenticateToken, (req,res)=>{ const user=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية عرض دفعات البيع."}); const sale=workspace.sales.find((x:any)=>x.id===req.params.id); if(!sale) return res.status(404).json({success:false,error:"عملية البيع غير موجودة."}); res.json({success:true,payments:workspace.payments.filter((p:any)=>p.saleId===sale.id)}); });

// -------------------------------------------------------------
// v8 business suite: suppliers, purchasing, expenses, contracts
// and installment schedules. Deterministic only; no Gemini usage.
// -------------------------------------------------------------
const VALID_EXPENSE_CATEGORIES = ["تشغيل", "رواتب", "نقل", "تسويق", "إيجار", "خدمات", "أخرى"];
function safeMoney(value: unknown): number { const n=Number(value); return Number.isFinite(n)&&n>=0 ? Math.round(n) : 0; }
function buildInstallmentSchedule(sale:any){
  const financed=Math.max(0,Number(sale.financedAmount||0)); const months=Math.max(1,Math.min(60,Number(sale.months||1)));
  const monthly=Math.floor((financed/months)*100)/100; let remainder=financed;
  const start=Date.parse(sale.firstDueAt||sale.createdAt||new Date().toISOString()); const rows:any[]=[];
  for(let i=1;i<=months;i++){ const amount=i===months?Math.round(remainder*100)/100:monthly; remainder=Math.max(0,remainder-amount); const due=new Date(start+i*30*86400000).toISOString(); rows.push({id:workspaceId("inst"),saleId:sale.id,sequence:i,dueAt:due,amount,paid:0,status:"pending"}); }
  return rows;
}

app.get("/api/business/overview", authenticateToken, (req,res)=>{
  const user=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية الوصول لنظرة الأعمال."});
  const now=Date.now();
  const purchases=workspace.purchases as any[], expenses=workspace.expenses as any[], schedules=workspace.installmentSchedules as any[];
  const due=schedules.filter(x=>x.status!=="paid"&&Date.parse(x.dueAt)<now);
  const purchaseTotal=purchases.reduce((n:number,x:any)=>n+safeMoney(x.total),0);
  const expenseTotal=expenses.reduce((n:number,x:any)=>n+safeMoney(x.amount),0);
  res.json({success:true,metrics:{suppliers:workspace.suppliers.length,purchases:purchases.length,purchaseTotal,expenses:expenses.length,expenseTotal,contracts:workspace.contracts.length,installments:schedules.length,overdueInstallments:due.length,overdueValue:due.reduce((n:number,x:any)=>n+Math.max(0,safeMoney(x.amount)-safeMoney(x.paid)),0)}});
});

app.get("/api/suppliers", authenticateToken, (req,res)=>{ const user=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية الوصول للموردين."}); res.json({success:true,suppliers:workspace.suppliers.slice(0,1000)}); });
app.post("/api/suppliers", authenticateToken, (req,res)=>{ const u=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(u.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية إضافة الموردين."}); const name=cleanText(req.body?.name,160); if(!name)return res.status(400).json({success:false,error:"اسم المورد مطلوب."}); const item={id:workspaceId("sup"),name,phone:cleanText(req.body?.phone,40),address:cleanText(req.body?.address,240),notes:cleanText(req.body?.notes,500),createdAt:new Date().toISOString(),createdBy:u.id}; workspace.suppliers.unshift(item); persistState(); audit(u.id,"supplier_created",item.id); res.status(201).json({success:true,supplier:item}); });
app.patch("/api/suppliers/:id", authenticateToken, (req,res)=>{ const u=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(u.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية تعديل الموردين."}); const item=workspace.suppliers.find((x:any)=>x.id===req.params.id); if(!item)return res.status(404).json({success:false,error:"المورد غير موجود."}); for(const k of ["name","phone","address","notes"]) if(req.body?.[k]!==undefined)item[k]=cleanText(req.body[k],k==="notes"?500:k==="address"?240:k==="name"?160:40); if(!item.name)return res.status(400).json({success:false,error:"اسم المورد مطلوب."}); item.updatedAt=new Date().toISOString(); persistState(); audit(u.id,"supplier_updated",item.id); res.json({success:true,supplier:item}); });
app.delete("/api/suppliers/:id", requireOwner, (req,res)=>{ const i=workspace.suppliers.findIndex((x:any)=>x.id===req.params.id); if(i<0)return res.status(404).json({success:false,error:"المورد غير موجود."}); workspace.suppliers.splice(i,1); persistState(); audit((req as any).user.id,"supplier_deleted",req.params.id); res.json({success:true}); });

app.get("/api/purchases", authenticateToken, (req,res)=>{ const user=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية الوصول للمشتريات."}); res.json({success:true,purchases:workspace.purchases.slice(0,1000)}); });
app.post("/api/purchases", authenticateToken, (req,res)=>{ const u=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(u.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية تسجيل المشتريات."}); const supplierId=cleanText(req.body?.supplierId,100); const items=Array.isArray(req.body?.items)?req.body.items.slice(0,100):[]; if(!supplierId||!workspace.suppliers.some((x:any)=>x.id===supplierId)||!items.length)return res.status(400).json({success:false,error:"المورد وبنود الشراء مطلوبان."}); const normalized=items.map((x:any)=>({productId:cleanText(x.productId,100),productName:cleanText(x.productName,160),quantity:Math.max(1,Math.floor(Number(x.quantity)||0)),unitCost:safeMoney(x.unitCost)})).filter((x:any)=>x.productName&&x.quantity>0); if(!normalized.length)return res.status(400).json({success:false,error:"بنود الشراء غير صالحة."}); const total=normalized.reduce((n:number,x:any)=>n+x.quantity*x.unitCost,0); const item={id:workspaceId("purchase"),supplierId,items:normalized,total,status:"received",notes:cleanText(req.body?.notes,500),createdAt:new Date().toISOString(),createdBy:u.id}; workspace.purchases.unshift(item); for(const line of normalized){ const product=workspace.products.find((p:any)=>p.id===line.productId); if(product){ const before=Math.max(0,Math.floor(Number(product.stockQuantity||0))); const after=before+line.quantity; product.stockQuantity=after; product.inStock=after>0; workspace.inventoryMovements.unshift({id:workspaceId("stock"),productId:product.id,productName:product.name,delta:line.quantity,before,after,reason:`استلام شراء ${item.id}`,createdBy:u.id,createdAt:new Date().toISOString()}); } } persistState(); audit(u.id,"purchase_created",item.id); res.status(201).json({success:true,purchase:item}); });

app.get("/api/expenses", authenticateToken, (req,res)=>{ const user=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية الوصول للمصروفات."}); const cat=cleanText(req.query?.category,60); let rows=workspace.expenses.slice(); if(cat)rows=rows.filter((x:any)=>x.category===cat); res.json({success:true,expenses:rows.slice(0,2000),categories:VALID_EXPENSE_CATEGORIES}); });
app.post("/api/expenses", authenticateToken, (req,res)=>{ const u=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(u.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية تسجيل المصروفات."}); const amount=safeMoney(req.body?.amount),category=cleanText(req.body?.category,60),description=cleanText(req.body?.description,240); if(!amount||!VALID_EXPENSE_CATEGORIES.includes(category)||!description)return res.status(400).json({success:false,error:"المبلغ والتصنيف والوصف مطلوبة."}); const item={id:workspaceId("expense"),amount,category,description,paymentMethod:cleanText(req.body?.paymentMethod,40)||"cash",createdAt:new Date().toISOString(),createdBy:u.id}; workspace.expenses.unshift(item); persistState(); audit(u.id,"expense_created",item.id); res.status(201).json({success:true,expense:item}); });
app.delete("/api/expenses/:id", requireOwner, (req,res)=>{ const i=workspace.expenses.findIndex((x:any)=>x.id===req.params.id); if(i<0)return res.status(404).json({success:false,error:"المصروف غير موجود."}); workspace.expenses.splice(i,1); persistState(); audit((req as any).user.id,"expense_deleted",req.params.id); res.json({success:true}); });

app.get("/api/contracts", authenticateToken, (req,res)=>{ const user=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية الوصول للعقود."}); res.json({success:true,contracts:workspace.contracts.slice(0,1000)}); });
app.post("/api/contracts", authenticateToken, (req,res)=>{ const u=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(u.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية إنشاء العقود."}); const customerName=cleanText(req.body?.customerName,160),phone=cleanText(req.body?.phone,40),saleId=cleanText(req.body?.saleId,100); if(!customerName||!saleId)return res.status(400).json({success:false,error:"اسم العميل ورقم عملية البيع مطلوبان."}); const sale=workspace.sales.find((x:any)=>x.id===saleId); if(!sale)return res.status(404).json({success:false,error:"عملية البيع غير موجودة."}); const existing=workspace.contracts.find((x:any)=>x.saleId===saleId&&x.status!=="cancelled"); if(existing)return res.status(409).json({success:false,error:"يوجد عقد قائم لهذه العملية."}); const item={id:workspaceId("contract"),contractNumber:`GH-${new Date().getFullYear()}-${String(Date.now()).slice(-7)}`,saleId,customerName,phone,status:"draft",signedAt:null,createdAt:new Date().toISOString(),createdBy:u.id}; workspace.contracts.unshift(item); persistState(); audit(u.id,"contract_created",item.id); res.status(201).json({success:true,contract:item}); });
app.post("/api/contracts/:id/sign", authenticateToken, (req,res)=>{ const u=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(u.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية توقيع العقود."}); const item=workspace.contracts.find((x:any)=>x.id===req.params.id); if(!item)return res.status(404).json({success:false,error:"العقد غير موجود."}); if(item.status!=="draft")return res.status(409).json({success:false,error:"حالة العقد لا تسمح بالتوقيع."}); item.status="signed"; item.signedAt=new Date().toISOString(); item.signatureReference=cleanText(req.body?.signatureReference,160)||`local-sign-${crypto.randomBytes(8).toString("hex")}`; persistState(); audit(u.id,"contract_signed",item.id); res.json({success:true,contract:item}); });

app.get("/api/installments/schedule", authenticateToken, (req,res)=>{ const user=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية عرض جدول الأقساط."}); const saleId=cleanText(req.query?.saleId,100); let rows=workspace.installmentSchedules.slice(); if(saleId)rows=rows.filter((x:any)=>x.saleId===saleId); rows.sort((a:any,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt)); res.json({success:true,schedules:rows.slice(0,5000)}); });
app.post("/api/installments/generate", authenticateToken, (req,res)=>{ const u=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(u.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية إنشاء جدول الأقساط."}); const saleId=cleanText(req.body?.saleId,100); const sale=workspace.sales.find((x:any)=>x.id===saleId); if(!sale)return res.status(404).json({success:false,error:"عملية البيع غير موجودة."}); workspace.installmentSchedules=workspace.installmentSchedules.filter((x:any)=>x.saleId!==saleId); const rows=buildInstallmentSchedule(sale); workspace.installmentSchedules.push(...rows); persistState(); audit(u.id,"installment_schedule_generated",saleId); res.status(201).json({success:true,schedules:rows}); });
app.get("/api/installments/due", authenticateToken, (req,res)=>{ const user=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية عرض الأقساط المستحقة."}); const days=Math.min(30,Math.max(0,Number(req.query?.days||7))); const end=Date.now()+days*86400000; const rows=workspace.installmentSchedules.filter((x:any)=>x.status!=="paid"&&Date.parse(x.dueAt)<=end).sort((a:any,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt)); res.json({success:true,schedules:rows.slice(0,2000)}); });

app.get("/api/finance/overview", authenticateToken, (_req,res)=>{
  const sales=workspace.sales; const payments=workspace.payments; const totalSales=sales.filter((s:any)=>s.status!=="cancelled").reduce((n:number,s:any)=>n+Number(s.totalAmount||0),0); const down=sales.filter((s:any)=>s.status!=="cancelled").reduce((n:number,s:any)=>n+Number(s.downPayment||0),0); const collected=payments.reduce((n:number,p:any)=>n+Number(p.amount||0),0); const receivable=sales.filter((s:any)=>!['cancelled','completed'].includes(s.status)).reduce((n:number,s:any)=>n+saleBalance(s),0);
  res.json({success:true,metrics:{salesCount:sales.length,totalSales,downPayments:down,collected,receivable,activeInstallments:sales.filter((s:any)=>s.status==="active_installment").length,completed:sales.filter((s:any)=>s.status==="completed").length},generatedAt:new Date().toISOString()});
});

app.get("/api/calendar/schedule", authenticateToken, (req,res) => {
  // المقارنة تجري على لحظة UTC الحقيقية المشتقة من الجدار المحلي Asia/Baghdad،
  // فلا يختل الترتيب ولا التصفية بسبب تفسير النص بتوقيت المضيف.
  const parseBound = (v: unknown): number => { const s = typeof v === "string" ? v : ""; const wall = wallClockToEpoch(s); return Number.isFinite(wall) ? wall : Date.parse(s); };
  const from=parseBound(req.query.from);
  const to=parseBound(req.query.to);
  const scheduledEpoch = (p:any) => { const wall = wallClockToEpoch(p.scheduledFor); return Number.isFinite(wall) ? wall : Date.parse(p.scheduledFor); };
  const posts=workspace.posts.filter((p:any)=>p.scheduledFor && Number.isFinite(scheduledEpoch(p)))
    .filter((p:any)=>!Number.isFinite(from)||scheduledEpoch(p)>=from)
    .filter((p:any)=>!Number.isFinite(to)||scheduledEpoch(p)<=to)
    .sort((a:any,b:any)=>scheduledEpoch(a)-scheduledEpoch(b));
  res.json({success:true,entries:posts.slice(0,500),count:posts.length,timeZone:"Asia/Baghdad",source:"server-workspace"});
});

// Strict content workflow. These endpoints centralize state transitions and audit them.
app.post("/api/workspace/content/:id/submit-review", authenticateToken, (req,res) => {
  const user=(req as any).user as ServerUser; const post=workspace.posts.find((x:any)=>x.id===req.params.id);
  if(!post) return res.status(404).json({success:false,error:"المنشور غير موجود."});
  if(!["owner","manager","staff","content_creator"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية إرسال المحتوى للمراجعة."});
  if(!post.content || !Array.isArray(post.targetPlatforms)||!post.targetPlatforms.length) return res.status(422).json({success:false,error:"المحتوى والمنصات المستهدفة مطلوبان."});
  post.status="review"; post.history=Array.isArray(post.history)?post.history:[]; post.history.push({id:workspaceId("approval"),byUser:user.name,userRole:user.role,action:"submit_review",timestamp:new Date().toISOString(),note:cleanText(req.body?.note,500)});
  persistState(); audit(user.id,"content_submitted_for_review",post.id); res.json({success:true,post});
});

app.post("/api/workspace/content/:id/approve", requireOwner, (req,res) => {
  const user=(req as any).user as ServerUser; const post=workspace.posts.find((x:any)=>x.id===req.params.id);
  if(!post) return res.status(404).json({success:false,error:"المنشور غير موجود."});
  if(!["review","edited"].includes(post.status)) return res.status(409).json({success:false,error:"حالة المحتوى الحالية لا تسمح بالموافقة."});
  post.status="approved"; post.history=Array.isArray(post.history)?post.history:[]; post.history.push({id:workspaceId("approval"),byUser:user.name,userRole:user.role,action:"approve",timestamp:new Date().toISOString(),note:cleanText(req.body?.note,500)});
  persistState(); audit(user.id,"content_approved",post.id); res.json({success:true,post});
});

app.post("/api/workspace/content/:id/reject", requireOwner, (req,res) => {
  const user=(req as any).user as ServerUser; const post=workspace.posts.find((x:any)=>x.id===req.params.id);
  if(!post) return res.status(404).json({success:false,error:"المنشور غير موجود."});
  if(!["review","edited","approved"].includes(post.status)) return res.status(409).json({success:false,error:"حالة المحتوى الحالية لا تسمح بالرفض."});
  post.status="edited"; post.history=Array.isArray(post.history)?post.history:[]; post.history.push({id:workspaceId("approval"),byUser:user.name,userRole:user.role,action:"reject",timestamp:new Date().toISOString(),note:cleanText(req.body?.note,1000)||"يحتاج إلى تعديل"});
  persistState(); audit(user.id,"content_rejected",post.id); res.json({success:true,post});
});

app.post("/api/workspace/content/:id/schedule", requireOwner, (req,res) => {
  const user=(req as any).user as ServerUser; const post=workspace.posts.find((x:any)=>x.id===req.params.id); const raw=cleanText(req.body?.scheduledFor,80);
  const when=normalizeScheduleInput(raw);
  if(!post) return res.status(404).json({success:false,error:"المنشور غير موجود."});
  if(post.status!=="approved") return res.status(409).json({success:false,error:"لا يمكن الجدولة قبل موافقة المالك."});
  // الجدار الزمني المحلي (Asia/Baghdad) هو المعنى المخزَّن؛ نقارنه باللحظة الحالية بتحويل صحيح.
  if(!when || !isScheduleInFuture(when)) return res.status(400).json({success:false,error:"موعد الجدولة غير صالح أو في الماضي."});
  post.status="scheduled"; post.scheduledFor=when; post.history=Array.isArray(post.history)?post.history:[]; post.history.push({id:workspaceId("approval"),byUser:user.name,userRole:user.role,action:"schedule",timestamp:new Date().toISOString(),note:when});
  persistState(); audit(user.id,"content_scheduled",`${post.id}:${when}`); res.json({success:true,post});
});

app.post("/api/analytics/ingest", requireOwner, (req,res) => {
  const user=(req as any).user as ServerUser; const {providerVerified, postId, platform, metrics}=req.body||{};
  if(providerVerified!==true) return res.status(400).json({success:false,error:"لا يمكن تسجيل مؤشرات خارجية دون إثبات من مزود المنصة."});
  if(!SUPPORTED_PLATFORMS.some((p:any)=>p.id===platform)) return res.status(400).json({success:false,error:"المنصة غير مدعومة."});
  const post=workspace.posts.find((x:any)=>x.id===postId);
  if(!post) return res.status(404).json({success:false,error:"المنشور غير موجود."});
  const safe={views:Math.max(0,Number(metrics?.views)||0),likes:Math.max(0,Number(metrics?.likes)||0),comments:Math.max(0,Number(metrics?.comments)||0),shares:Math.max(0,Number(metrics?.shares)||0),reach:Math.max(0,Number(metrics?.reach)||0)};
  post.metrics={...(post.metrics||{}),...safe}; post.metricSource="provider_verified"; post.metricsUpdatedAt=new Date().toISOString();
  persistState(); audit(user.id,"analytics_ingested",`${platform}:${postId}`); res.json({success:true,postId,platform,metrics:safe,source:"provider_verified"});
});

// -------------------------------------------------------------
// Operations intelligence: deterministic search, analytics and alerts.
// These endpoints never call Gemini and never claim external social metrics.
// -------------------------------------------------------------
function normalizeSearch(value: unknown): string { return String(value ?? "").trim().toLowerCase().slice(0, 120); }
function containsQuery(value: unknown, q: string): boolean { return q ? String(value ?? "").toLowerCase().includes(q) : false; }

app.get("/api/workspace/search", authenticateToken, (req, res) => {
  const q = normalizeSearch(req.query.q);
  if (q.length < 2) return res.status(400).json({ success: false, error: "اكتب كلمتين على الأقل للبحث." });
  const products = workspace.products.filter((x: any) => [x.name, x.category, x.modelYear, ...(x.specs || [])].some(v => containsQuery(v, q))).slice(0, 25);
  const posts = workspace.posts.filter((x: any) => [x.title, x.content, x.campaignName, ...(x.tags || [])].some(v => containsQuery(v, q))).slice(0, 25);
  const conversations = workspace.conversations.filter((x: any) => [x.customerName, x.phone, x.lastMessage, x.interestedProduct, ...(x.history || []).map((m:any)=>m.text)].some(v => containsQuery(v, q))).slice(0, 25);
  audit((req as any).user.id, "workspace_search", q);
  res.json({ success: true, query: q, counts: { products: products.length, posts: posts.length, conversations: conversations.length }, results: { products, posts, conversations } });
});

app.get("/api/analytics/overview", authenticateToken, (_req, res) => {
  const posts = workspace.posts;
  const conversations = workspace.conversations;
  const statusCount = (status: string) => posts.filter((p:any) => p.status === status).length;
  const channels = SUPPORTED_PLATFORMS.map(p => ({ platform: p.id, name: p.name, connected: platformConnections.get(p.id)?.status === "connected", posts: posts.filter((x:any) => (x.targetPlatforms || []).includes(p.id)).length, conversations: conversations.filter((x:any) => x.channel === p.id).length }));
  const metrics = posts.reduce((a:any,p:any) => { const m=p.metrics || {}; a.views += Number(m.views)||0; a.likes += Number(m.likes)||0; a.comments += Number(m.comments)||0; a.shares += Number(m.shares)||0; a.reach += Number(m.reach)||0; return a; }, { views:0, likes:0, comments:0, shares:0, reach:0 });
  res.json({ success:true, source:"local_workspace", externalMetricsAvailable:false, generatedAt:new Date().toISOString(), posts:{ total:posts.length, drafts:statusCount("draft"), review:statusCount("review"), approved:statusCount("approved"), scheduled:statusCount("scheduled"), published:statusCount("published") }, conversations:{ total:conversations.length, new:conversations.filter((x:any)=>x.status==="new").length, open:conversations.filter((x:any)=>x.status!=="resolved").length, resolved:conversations.filter((x:any)=>x.status==="resolved").length }, metrics, channels });
});

app.get("/api/system/diagnostics", requireOwner, (_req, res) => {
  const memory = process.memoryUsage();
  const queued = automationJobs.filter((j:any)=>j.status==="queued").length;
  const approved = automationJobs.filter((j:any)=>j.status==="approved").length;
  const ready = automationJobs.filter((j:any)=>j.status==="ready").length;
  const failed = automationJobs.filter((j:any)=>j.status==="failed").length;
  res.json({ success:true, generatedAt:new Date().toISOString(), version:PROJECT_VERSION, schemaVersion:STATE_SCHEMA_VERSION, node:process.version, uptimeSeconds:Math.round(process.uptime()), memory:{ rss:memory.rss, heapUsed:memory.heapUsed, heapTotal:memory.heapTotal }, sessions:activeSessionCount(), users:serverUsers.length, platforms:{ total:SUPPORTED_PLATFORMS.length, connected:connectedPlatformIds().length }, workspace:{ products:workspace.products.length, posts:workspace.posts.length, conversations:workspace.conversations.length, plans:workspace.installmentPlans.length, leads:workspace.leads.length, tasks:workspace.tasks.length, sales:workspace.sales.length, payments:workspace.payments.length, suppliers:workspace.suppliers.length, purchases:workspace.purchases.length, expenses:workspace.expenses.length, contracts:workspace.contracts.length, installmentSchedules:workspace.installmentSchedules.length }, jobs:{ total:automationJobs.length, queued, approved, ready, failed }, backups:{ count: (()=>{ try{return fs.readdirSync(BACKUP_DIR).filter(n=>n.startsWith("state-")&&n.endsWith(".json")).length;}catch{return 0;} })() } });
});


app.get("/api/executive/overview", authenticateToken, (req,res)=>{
  const user=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية الوصول للوحة القيادة التنفيذية."});
  const now=Date.now();
  const sales=workspace.sales.filter((s:any)=>s.status!=="cancelled");
  const totalSales=sales.reduce((n:number,s:any)=>n+Number(s.totalAmount||0),0);
  const paid=sales.reduce((n:number,s:any)=>n+salePaid(s.id),0);
  const balance=Math.max(0,totalSales-paid);
  const overdueSales=sales.filter((s:any)=>{
    const due=Date.parse(s.nextDueAt||s.dueAt||"");
    return Number.isFinite(due)&&due<now&&saleBalance(s)>0;
  });
  const overdueBalance=overdueSales.reduce((n:number,s:any)=>n+saleBalance(s),0);
  const aging={current:0,days1to30:0,days31to60:0,days61to90:0,over90:0};
  for(const s of sales){
    const due=Date.parse(s.nextDueAt||s.dueAt||"");
    if(!Number.isFinite(due) || due>=now) aging.current+=saleBalance(s);
  }
  for(const s of overdueSales){
    const due=Date.parse(s.nextDueAt||s.dueAt||""); const days=Math.max(0,Math.floor((now-due)/86400000)); const b=saleBalance(s);
    if(days<=30) aging.days1to30+=b; else if(days<=60) aging.days31to60+=b; else if(days<=90) aging.days61to90+=b; else aging.over90+=b;
  }
  const inv=workspace.products.map(inventoryProductView);
  const dueFollowUps=workspace.leads.filter((l:any)=>l.nextFollowUpAt&&Date.parse(l.nextFollowUpAt)<=now&&!['won','lost'].includes(l.status)).length;
  const overdueTasks=workspace.tasks.filter((t:any)=>t.dueAt&&Date.parse(t.dueAt)<now&&['open','in_progress'].includes(t.status)).length;
  const newMessages=workspace.conversations.filter((c:any)=>c.status==='new').length;
  const reviewPosts=workspace.posts.filter((p:any)=>p.status==='review'||p.status==='edited').length;
  const queuedJobs=automationJobs.filter((j:any)=>['queued','approved','ready'].includes(j.status)).length;
  const actionQueue=[
    {id:'collections',type:'finance',severity:overdueBalance>0?'high':'normal',count:overdueSales.length,value:overdueBalance,label:'أقساط متأخرة تحتاج متابعة'},
    {id:'followups',type:'crm',severity:dueFollowUps>0?'high':'normal',count:dueFollowUps,label:'متابعات عملاء مستحقة'},
    {id:'tasks',type:'tasks',severity:overdueTasks>0?'high':'normal',count:overdueTasks,label:'مهام متأخرة'},
    {id:'messages',type:'messages',severity:newMessages>0?'normal':'normal',count:newMessages,label:'استفسارات جديدة'},
    {id:'content',type:'content',severity:reviewPosts>0?'normal':'normal',count:reviewPosts,label:'محتوى ينتظر إجراء'},
    {id:'jobs',type:'jobs',severity:queuedJobs>0?'normal':'normal',count:queuedJobs,label:'مهام نشر/تشغيل في الطابور'}
  ].filter(x=>x.count>0);
  res.json({success:true,generatedAt:new Date().toISOString(),metrics:{salesCount:sales.length,totalSales,paid,balance,overdueSales:overdueSales.length,overdueBalance,openLeads:workspace.leads.filter((x:any)=>!['won','lost'].includes(x.status)).length,lowStock:inv.filter((x:any)=>x.stockStatus!=='ok').length,openConversations:newMessages,openTasks:workspace.tasks.filter((x:any)=>['open','in_progress'].includes(x.status)).length},aging,inventory:{products:inv.length,totalUnits:inv.reduce((n:number,x:any)=>n+x.stockQuantity,0),low:inv.filter((x:any)=>x.stockStatus==='low').length,out:inv.filter((x:any)=>x.stockStatus==='out').length},crm:{new:workspace.leads.filter((x:any)=>x.status==='new').length,qualified:workspace.leads.filter((x:any)=>x.status==='qualified').length,proposal:workspace.leads.filter((x:any)=>x.status==='proposal').length,won:workspace.leads.filter((x:any)=>x.status==='won').length,lost:workspace.leads.filter((x:any)=>x.status==='lost').length},actionQueue});
});

app.get("/api/finance/aging", authenticateToken, (_req,res)=>{
  const now=Date.now();
  const rows=workspace.sales.filter((s:any)=>s.status!=="cancelled"&&saleBalance(s)>0).map((s:any)=>{
    const due=Date.parse(s.nextDueAt||s.dueAt||""); const overdue=Number.isFinite(due)&&due<now; const days=overdue?Math.floor((now-due)/86400000):0;
    return {...s,paidAmount:salePaid(s.id),balance:saleBalance(s),dueAt:s.nextDueAt||s.dueAt||null,overdue,overdueDays:days};
  }).sort((a:any,b:any)=>b.overdueDays-a.overdueDays||b.balance-a.balance);
  res.json({success:true,rows:rows.slice(0,1000),summary:{count:rows.length,overdue:rows.filter((x:any)=>x.overdue).length,overdueBalance:rows.filter((x:any)=>x.overdue).reduce((n:number,x:any)=>n+x.balance,0)}});
});

app.get("/api/crm/follow-ups/today", authenticateToken, (_req,res)=>{
  const now=Date.now(); const end=now+86400000;
  const rows=workspace.leads.filter((x:any)=>x.nextFollowUpAt&&Date.parse(x.nextFollowUpAt)<=end&&!['won','lost'].includes(x.status)).sort((a:any,b:any)=>Date.parse(a.nextFollowUpAt)-Date.parse(b.nextFollowUpAt));
  res.json({success:true,rows:rows.slice(0,500),overdue:rows.filter((x:any)=>Date.parse(x.nextFollowUpAt)<now).length,today:rows.filter((x:any)=>Date.parse(x.nextFollowUpAt)>=now).length});
});

app.get("/api/system/alerts", authenticateToken, (req, res) => {
  const alerts:any[] = [];
  if (!OWNER_EMAIL) alerts.push({ id:"owner-email", severity:"critical", title:"بريد المالك غير مضبوط", detail:"يجب ضبط OWNER_EMAIL قبل الاعتماد على نظام التحقق الخاص بالمالك." });
  if (!GOOGLE_CLIENT_ID) alerts.push({ id:"google-client", severity:"warning", title:"تحقق Google غير مضبوط", detail:"تسجيل Google لن يملك فحص جمهور التطبيق حتى يتم ضبط GOOGLE_CLIENT_ID." });
  if (connectedPlatformIds().length === 0) alerts.push({ id:"platforms", severity:"info", title:"لا توجد منصات متصلة", detail:"جميع المنصات ما زالت بانتظار OAuth/API فعلي؛ لا يوجد نشر خارجي." });
  const failed = automationJobs.filter((j:any)=>j.status==="failed").length;
  if (failed) alerts.push({ id:"jobs-failed", severity:"warning", title:"مهام فاشلة", detail:`يوجد ${failed} مهمة فاشلة تحتاج مراجعة.` });
  const newConversations = workspace.conversations.filter((c:any)=>c.status==="new").length;
  if (newConversations) alerts.push({ id:"messages", severity:"info", title:"استفسارات جديدة", detail:`يوجد ${newConversations} استفسار يحتاج متابعة.` });
  res.json({ success:true, generatedAt:new Date().toISOString(), alerts });
});

app.post("/api/control/jobs/preflight-all", requireOwner, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 100) : automationJobs.filter((j:any)=>j.status === "queued" || j.status === "approved").map((j:any)=>j.id).slice(0,100);
  const results = ids.map(id => { const job:any=automationJobs.find((j:any)=>j.id===id); if(!job) return {id, ok:false, reason:"المهمة غير موجودة"}; const platform=job.payload?.platform; const connection=platform ? platformConnections.get(platform) : null; const approved=job.status==="approved" || job.status==="ready"; const scheduled=!job.scheduledFor || wallClockToEpoch(job.scheduledFor) <= Date.now(); const connected=!job.requiresExternalConnection || connection?.status==="connected"; const content=typeof job.payload?.content === "string" ? job.payload.content.trim().length>0 : true; const ok=approved && scheduled && connected && content; return {id, ok, checks:{approved,scheduled,connected,content}, reason:ok?null:"المهمة غير جاهزة للتنفيذ"}; });
  audit((req as any).user.id,"jobs_preflight_all",String(results.length));
  res.json({success:true,results});
});

// Gemini usage guard: protects the project from accidental loops/retries and
// prevents fake/demo counters from being mistaken for real provider quota.
//
// جدار حماية الحصة المجانية **مركزي واحد للمشروع كله**: لا يوجد أي تفريع على
// اسم منصة هنا. كل منصة (حالية أو مستقبلية) تمرّ عبر نفس المحرك ونفس الحارس،
// فميزانية Gemini واحدة تشاركها كل المنصات والوكيل المركزي وتوليد المحتوى.
const GEMINI_DAILY_LIMIT = resolveGeminiDailyLimit(process.env);
const GEMINI_LIMIT_INFO = inspectGeminiLimit(process.env);
/** وضع الحماية: مفعّل افتراضياً. تعطيله تغيير إعداد صريح من المالك، لا ضمني. */
const GEMINI_FREE_TIER_PROTECTION = (() => {
  const raw = String(process.env.GEMINI_FREE_TIER_PROTECTION ?? "true").trim().toLowerCase();
  return !(raw === "false" || raw === "0" || raw === "no" || raw === "off");
})();
let geminiUsageDay = new Date().toISOString().slice(0, 10);
let geminiUsageCount = 0;
/** سجل استخدام مركزي للتشخيص (عدّادات فقط، بلا أي prompt أو سرّ). */
const aiLedger = new AiUsageLedger();

// -------------------------------------------------------------
// حارس حصة YouTube Data API (نفس نمط freeTierFirewall لكن لوحدات YouTube).
// سجل مركزي بلا أسرار يتتبع الوحدات التقديرية لكل عملية YouTube، ويصمد بعد restart
// عبر محوّل الحالة. لا شبكة ولا سرّ هنا.
// -------------------------------------------------------------
const youtubeQuotaLedger = new YouTubeQuotaLedger();
const YOUTUBE_DAILY_QUOTA = resolveYouTubeDailyQuota(process.env);
const YOUTUBE_QUOTA_ALERT_THRESHOLD = resolveYouTubeQuotaAlertThreshold(process.env);
const YOUTUBE_QUOTA_PROTECTION = String(process.env.YOUTUBE_QUOTA_PROTECTION || 'true').toLowerCase() !== 'false';
const YOUTUBE_WATCHER_ERROR_ALERT_THRESHOLD = resolveWatcherErrorAlertThreshold(process.env);
let youtubeQuotaDay = new Date().toISOString().slice(0, 10);
/** أُرسل تنبيه العتبة لليوم الحالي؟ (يُصفَّر يومياً). */
let youtubeQuotaAlertSent = false;
/** حالة أعلام تنبيهات المراقب (تصمد بعد restart) — منع تكرار التنبيه لنفس السلسلة. */
let watcherAlertState: { errorAlerted: boolean; reauthAlerted: boolean } = { errorAlerted: false, reauthAlerted: false };
/** حارس الاستنفاد: يُفعّل مرة عند بلوغ الحصة فلا تُرسل طلبات مضمونة الفشل. */
let youtubeQuotaExhausted = false;

/** يُصفّر العدّادات عند تغيّر اليوم (UTC) فقط — نفس مبدأ حارس Gemini. */
function rollYouTubeQuotaDayIfNeeded(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== youtubeQuotaDay) {
    youtubeQuotaDay = today;
    youtubeQuotaLedger.resetDaily();
    youtubeQuotaExhausted = false;
    // العدّادات اليومية تُصفَّر، وعلم إرسال تنبيه العتبة يُصفَّر ليُنبَّه المالك مرة واحدة في اليوم الجديد.
    youtubeQuotaAlertSent = false;
    saveYouTubeQuota();
  }
}

/** لقطة حارس الحصة الحالية (بلا أي سرّ). */
function youtubeQuotaStatusSnapshot() {
  return buildYouTubeQuotaStatus({
    counters: youtubeQuotaLedger.snapshot(),
    limit: YOUTUBE_DAILY_QUOTA,
    alertThresholdPercent: YOUTUBE_QUOTA_ALERT_THRESHOLD,
    protectionEnabled: YOUTUBE_QUOTA_PROTECTION,
    day: youtubeQuotaDay,
  });
}

/**
 * النسخة العامة الآمنة من حارس حصة YouTube Data API.
 *
 * السبب: النقطتان /api/health و/api/readiness عامتان بلا مصادقة (لأدوات المراقبة
 * مثل Render)، وكانتا تُعلنان التفاصيل التشغيلية الكاملة (usedUnits/remainingUnits/
 * byOperation…). التفاصيل الكاملة تبقى للمالك عبر /api/agent/youtube/quota، وتُقلَّص
 * هنا إلى ما يلزم لفحص الصحة فقط: العتبة/الاستنفاد/النسبة المشبعة/تفعيل الحماية —
 * بلا أرقام تشغيلية تفصيلية.
 */
function youtubeQuotaStatusSummary() {
  const full = youtubeQuotaStatusSnapshot();
  return {
    protectionEnabled: full.protectionEnabled,
    thresholdReached: full.thresholdReached,
    exhausted: full.exhausted,
    usedPercent: full.usedPercent,
    alertThresholdPercent: full.alertThresholdPercent,
    note: full.note,
  };
}

/** يحفظ حالة حارس الحصة وأعلام التنبيه عبر المحوّل (تصمد بعد restart). */
function saveYouTubeQuota(): void {
  if (!storageReady) return;
  try {
    void storageAdapter.write(STORAGE_KEY_YOUTUBE_QUOTA, {
      day: youtubeQuotaDay,
      counters: youtubeQuotaLedger.snapshot(),
      alertSent: youtubeQuotaAlertSent,
      watcherAlertState: { ...watcherAlertState },
    }).catch(() => { /* فشل الحفظ لا يُسقط الخدمة (حارس محلي) */ });
  } catch { /* تجاهل */ }
}

/** يسترجع حالة حارس الحصة وأعلام التنبيه عند الإقلاع (ملف محلي). */
function loadYouTubeQuota(): void {
  const raw = storageAdapter.readSync<any>(STORAGE_KEY_YOUTUBE_QUOTA);
  if (raw?.day === youtubeQuotaDay) {
    youtubeQuotaLedger.restore(raw.counters);
    youtubeQuotaAlertSent = raw.alertSent === true;
  }
  // أعلام تنبيهات المراقب تُسترجع من أي يوم (لا تتعلق بالعدّاد اليومي) لئلا يُكرَّر
  // التنبيه بعد restart ضمن نفس سلسلة الفشل.
  if (raw?.watcherAlertState && typeof raw.watcherAlertState === 'object') {
    watcherAlertState = {
      errorAlerted: raw.watcherAlertState.errorAlerted === true,
      reauthAlerted: raw.watcherAlertState.reauthAlerted === true,
    };
  }
}

/**
 * يسجّل استهلاك عملية YouTube، ويتعامل مع بلوغ العتبة/الحصة:
 * - عند بلوغ العتبة الآمنة (مرة لكل يوم): تنبيه واحد للمالك عبر pushNotification.
 * - عند بلوغ الحصة: يُعلن الاستنفاد فيُرفض أي طلب جديد (بلا إرسال مضمون الفشل).
 * حتمي وبلا سرّ؛ يُحتسب الطلب المُحاوَل (كما يفعل Google) بغض النظر عن نجاحه.
 */
function recordYouTubeQuota(operation: YouTubeQuotaOperation): void {
  rollYouTubeQuotaDayIfNeeded();
  youtubeQuotaLedger.record(operation);
  const status = youtubeQuotaStatusSnapshot();
  if (YOUTUBE_QUOTA_PROTECTION && status.thresholdReached && !youtubeQuotaAlertSent) {
    youtubeQuotaAlertSent = true;
    youtubeQuotaLedger.recordThresholdReached();
    try {
      pushNotification('owner', 'youtube_quota_warning', 'اقتراب استهلاك حصة YouTube Data API', youtubeQuotaAlertReason(status), 'warning', 'youtube_operations');
      youtubeQuotaLedger.recordAlertSent();
      audit('system', 'youtube_quota_threshold_alert', `${status.usedPercent}% (${status.usedUnits}/${status.limit})`);
    } catch { /* لا يُسقط التسجيل فشل التنبيه */ }
  }
  if (status.exhausted) youtubeQuotaExhausted = true;
  saveYouTubeQuota();
}

/**
 * هل يمكن تنفيذ عملية وحداتها التقديرية ضمن الحصة المتبقية؟ (حارس استباقي).
 * عند الاستنفاد يرفض العملية قبل إرسال طلب مضمون الفشل (safe failure).
 */
function canRunYouTubeOperation(operation: YouTubeQuotaOperation): boolean {
  rollYouTubeQuotaDayIfNeeded();
  if (!YOUTUBE_QUOTA_PROTECTION) return true;
  if (youtubeQuotaExhausted) return false;
  const snap = youtubeQuotaLedger.snapshot();
  return canAffordYouTubeQuota(snap.unitsUsed, YOUTUBE_DAILY_QUOTA, YOUTUBE_QUOTA_COST[operation] ?? 1);
}

/**
 * مغلّف fetch لحارس الحصة: يمرّ عليه **كل** طلب YouTube Data API في المشروع (عبر
 * عميل YouTube الواحد `youtubeFetchImpl`)، فيُحتسب كل طلب تلقائياً بلا احتساب يدوي
 * في كل موضع. نقطة الرمز (/token) مستثناة (ليست ضمن حصة Data API). عند استنفاد
 * الحصة يُرد رفض صريح بلا شبكة (فلا تُرسل طلبات مضمونة الفشل)، فيراه الموصل كخطأ
 * `quota_exceeded` بلا تمييز عن رفض Google الحقيقي.
 */
function youtubeGuardedFetch(url: string, init?: Parameters<YouTubeFetch>[1]): ReturnType<YouTubeFetch> {
  if (!youtubeUrlCountsAgainstQuota(url)) return fetch(url, init as any);
  const operation = classifyYouTubeQuotaOperation(url, init?.method);
  if (!canRunYouTubeOperation(operation)) {
    const rejected: YouTubeHttpResponse = {
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 403, message: 'quotaExceeded', errors: [{ reason: 'quotaExceeded' }] } }),
    };
    return Promise.resolve(rejected);
  }
  recordYouTubeQuota(operation);
  return fetch(url, init as any);
}
const requestWindow = new Map<string, { startedAt: number; count: number }>();
// مهلة صريحة لكل طلب مزود: لا يبقى أي طلب معلقاً بلا نهاية.
const AI_TIMEOUT_MS = Math.min(60_000, Math.max(5_000, Number(process.env.AI_TIMEOUT_MS || 20_000)));
// مهلة التحقق الحي ثابتة وصريحة (30 ثانية) ولا تُشتق من AI_TIMEOUT_MS: الفحص
// الإداري يجب أن يكون متوقع المدة، فلا تُقصّره قيمة بيئة صغيرة ولا تُطوّله كبيرة.
const LIVE_VERIFY_TIMEOUT_MS = 30_000;
// حلقة تشخيص محدودة الحجم: لا تحتوي أي مفتاح أو توكن أو جسم طلب كامل.
const aiEvents: Array<{ at: string; type: string; detail: string }> = [];
const challengeWindow = new Map<string, { startedAt: number; count: number }>();
function allowChallengeAttempt(key: string): boolean {
  const now = Date.now();
  const item = challengeWindow.get(key);
  if (!item || now - item.startedAt >= RATE_WINDOW_TTL_MS) {
    challengeWindow.set(key, { startedAt: now, count: 1 });
    enforceRateWindowCap(challengeWindow, now);
    return true;
  }
  if (item.count >= 5) return false;
  item.count += 1; return true;
}
const auditLog: Array<{ id: string; at: string; userId: string; action: string; detail?: string }> = persisted.audit;
const automationJobs: Array<{ id: string; type: string; status: "queued" | "approved" | "ready" | "executed" | "failed"; createdAt: string; createdBy: string; payload: any; requiresExternalConnection: boolean; scheduledFor?: string; readyAt?: string; executedAt?: string; lastError?: string; providerVerified?: boolean; providerReceipt?: any }> = persisted.jobs as any;

/**
 * يطبّق لقطة حالة (من المخزن) على كل الحاويات الحيّة دون استبدال مراجعها،
 * فيبقى كل الكود الذي يمسك `workspace`/`serverUsers` صالحاً. يُستخدم عند
 * التهيئة غير المتزامنة (Postgres) بعد قراءة الحالة الفعلية.
 */
function applyStateSnapshot(snapshot: any): void {
  const next = loadPersistentState(snapshot);
  serverUsers.splice(0, serverUsers.length, ...next.users);
  for (const key of Object.keys(workspace)) delete (workspace as any)[key];
  Object.assign(workspace, next.workspace);
  revokedSessions.clear();
  for (const entry of Array.isArray(next.revokedSessions) ? next.revokedSessions : []) {
    if (entry?.sid && typeof entry.exp === "number" && entry.exp > Date.now()) revokedSessions.set(entry.sid, entry.exp);
  }
  userRevocationEpoch.clear();
  for (const entry of Array.isArray(next.userRevocations) ? next.userRevocations : []) {
    if (entry?.userId && typeof entry.at === "number") userRevocationEpoch.set(entry.userId, entry.at);
  }
  auditLog.splice(0, auditLog.length, ...(Array.isArray(next.audit) ? next.audit : []));
  automationJobs.splice(0, automationJobs.length, ...(Array.isArray(next.jobs) ? next.jobs : []));
  for (const p of SUPPORTED_PLATFORMS) platformConnections.set(p.id, { platform: p.id, status: "disconnected" });
  if (Array.isArray(snapshot?.platformConnections)) {
    for (const item of snapshot.platformConnections) {
      if (item?.platform && platformConnections.has(item.platform)) platformConnections.set(item.platform, item);
    }
  }
}

/** لا يُسمح بأي كتابة قبل نجاح التهيئة إن كان المخزن خارجياً، حتى لا نطمس حالة قائمة بلقطة فارغة. */
let storageReady = storageAdapter.backend === "file";
let storageInitError: string | null = null;

/**
 * تهيئة المخزن ثم تحميل الحالة منه. للملف المحلي التحميل حصل عند الإقلاع
 * (متزامن)، ولPostgres ننتظر الاتصال ونقرأ الحالة الفعلية قبل بدء الاستماع.
 */
async function bootstrapStorage(): Promise<void> {
  await storageAdapter.init();
  if (!storageAdapter.status().healthy) {
    storageInitError = storageAdapter.status().detail || "storage_unavailable";
    return;
  }
  if (storageAdapter.backend === "postgres") {
    try {
      const snapshot = await storageAdapter.read<any>(STORAGE_KEY_STATE);
      if (snapshot) applyStateSnapshot(snapshot);
      const usage = await storageAdapter.read<any>(STORAGE_KEY_USAGE);
      if (usage?.day === geminiUsageDay && Number.isFinite(usage?.count)) geminiUsageCount = Math.max(0, Number(usage.count));
      // حارس حصة YouTube: يُستَرجع عدّاده وحالة تنبيهاته فيصمد بعد restart/نشر.
      const ytQuota = await storageAdapter.read<any>(STORAGE_KEY_YOUTUBE_QUOTA);
      if (ytQuota?.day === youtubeQuotaDay) {
        youtubeQuotaLedger.restore(ytQuota.counters);
        youtubeQuotaAlertSent = ytQuota.alertSent === true;
      }
      if (ytQuota?.watcherAlertState && typeof ytQuota.watcherAlertState === 'object') {
        watcherAlertState = {
          errorAlerted: ytQuota.watcherAlertState.errorAlerted === true,
          reauthAlerted: ytQuota.watcherAlertState.reauthAlerted === true,
        };
      }
      const control = await storageAdapter.read<any>(STORAGE_KEY_CONTROL);
      if (control) applyControlSnapshot(control);
      const agentState = await storageAdapter.read<any>(STORAGE_KEY_AGENT);
      if (agentState && Array.isArray(agentState.tasks)) agentOrchestrator.restore(agentState.tasks);
      // ذاكرة العقل الدائمة: تُقرأ قبل بدء الخدمة فتصمد بعد restart/cold start.
      const brainMemory = await storageAdapter.read<any>(STORAGE_KEY_BRAIN_MEMORY);
      brainMemoryStore = normalizeBrainMemory(brainMemory);
      // جلسات فريق الوكلاء: تُقرأ قبل بدء الخدمة فتصمد بعد restart/cold start،
      // فيمنع التكرار إعادة العمل المكرر لنفس الحدث.
      const teamSessions = await storageAdapter.read<any>(STORAGE_KEY_TEAM_SESSIONS);
      teamSessionState = normalizeTeamSessionState(teamSessions);
      // الطبقة الإدراكية (Batch 7): الذاكرة العاملة + تقارير الدورات — تصمد بعد restart.
      const cognition = await storageAdapter.read<any>(STORAGE_KEY_WORKING_MEMORY);
      if (cognition) {
        workingMemoryState = normalizeWorkingMemory(cognition?.workingMemory ?? cognition);
        cognitiveReports = Array.isArray(cognition?.reports)
          ? cognition.reports.filter((r: any) => r && typeof r.cycleId === 'string' && typeof r.eventIdentity === 'string').slice(-COGNITIVE_REPORT_MAX)
          : [];
      }
      // حالة مدير تشغيل YouTube (المراقبة/التحكم/سجل المعالجة): تُقرأ قبل بدء
      // الخدمة فيصمد الـcheckpoint وسجل منع التكرار وإعدادات الأتمتة بعد restart.
      const watcher = await storageAdapter.read<any>(WATCHER_STATE_KEY);
      if (watcher) applyWatcherStateSnapshot(watcher);
      // حالة الاستراتيجية + سجل قرار→نتيجة (يملكهما العقل المركزي): تُقرآن قبل بدء الخدمة.
      strategyState = normalizeStrategyState(await storageAdapter.read<any>(STORAGE_KEY_STRATEGY_STATE));
      decisionLedger = normalizeDecisionLedger(await storageAdapter.read<any>(STORAGE_KEY_DECISION_LEDGER));
      const media = await storageAdapter.read<any>(CONTENT_MEDIA_KEY);
      if (media) applyContentMediaState(media);
    } catch (error: any) {
      storageInitError = String(error?.code || error?.name || "state_read_failed").slice(0, 60);
      return;
    }
  } else {
    // للملف المحلي: القراءة متزامنة عند الإقلاع كما في لقطة الحالة.
    loadControlStateSync();
    loadAgentStateSync();
    loadBrainMemorySync();
    loadTeamSessionsSync();
    loadCognitionSync();
    loadStrategyAndLedgerSync();
    const watcher = storageAdapter.readSync<any>(WATCHER_STATE_KEY);
    if (watcher) applyWatcherStateSnapshot(watcher);
    const media = storageAdapter.readSync<any>(CONTENT_MEDIA_KEY);
    if (media) applyContentMediaState(media);
  }
  // الجهوزية تُعلن قبل مزامنة البصمة كي تُحفظ حالة التحكّم فعلاً عند أول إقلاع.
  storageReady = true;
  reconcilePreviewTokenEpoch();
  // نتيجة آخر تحقق حي من Gemini تُطبَّق على الحالة الحيّة بعد استرجاع مفتاح التحكّم.
  hydrateAiLiveVerificationFromDurable();
}

/**
 * حامل دوام لنتيجة آخر تحقق حي من Gemini — يُحفظ في مفتاح التحكّم فيصمد بعد
 * restart/cold start، فلا يبدو المزود «غير متحقَّق» بعد كل نشر رغم إثباته فعلاً
 * (التحقق يستهلك طلباً من الحصة، فلا يجوز إعادته بلا داعٍ). لا يحمل أي سرّ:
 * حالة/نص تشخيصي/موديل/وقت/فئة خطأ/توجيه فقط.
 */
const AI_LIVE_VERIFICATION_STATES = ['not_attempted', 'ok', 'failed', 'skipped_no_key', 'blocked_by_guard'] as const;
type AiLiveVerificationState = (typeof AI_LIVE_VERIFICATION_STATES)[number];
const aiLiveVerificationState = {
  value: null as null | { state: AiLiveVerificationState; detail: string | null; model: string | null; at: string | null; errorKind: string | null; hint: string | null },
  restore(saved: any): void {
    if (!saved || typeof saved !== "object") return;
    const state = (AI_LIVE_VERIFICATION_STATES as readonly string[]).includes(saved.state) ? saved.state : 'not_attempted';
    this.value = {
      state: state as AiLiveVerificationState,
      detail: typeof saved.detail === "string" ? saved.detail.slice(0, 300) : null,
      model: typeof saved.model === "string" ? saved.model.slice(0, 80) : null,
      at: typeof saved.at === "string" ? saved.at.slice(0, 40) : null,
      errorKind: typeof saved.errorKind === "string" ? saved.errorKind.slice(0, 60) : null,
      hint: typeof saved.hint === "string" ? saved.hint.slice(0, 400) : null,
    };
  },
  capture(live: { state: AiLiveVerificationState; detail: string | null; model: string | null; at: string | null; errorKind: string | null; hint: string | null }): void {
    this.value = { state: live.state, detail: live.detail, model: live.model, at: live.at, errorKind: live.errorKind, hint: live.hint };
  },
  snapshot() { return this.value; },
};

/**
 * يطبّق بصمة توكن المعاينة المحفوظة ونوافذ OTP المُستهلكة على الحاويات الحيّة.
 * لا يحتوي أي قيمة سرية: بصمة SHA-256 فقط.
 */
function applyControlSnapshot(control: any): void {
  if (!control || typeof control !== "object") return;
  // البصمة تُقرأ دائماً (قد تكون null في أول تشغيل) ليكتشف reconcile تغيّر التوكن.
  previewControl.tokenHash = typeof control.previewTokenHash === "string" ? control.previewTokenHash : null;
  if (typeof control.previewEpoch === "number" && control.previewEpoch > 0) {
    previewEpoch.value = control.previewEpoch;
  }
  consumedChallengeWindows.clear();
  if (Array.isArray(control.consumedOtpWindows)) {
    for (const entry of control.consumedOtpWindows) {
      if (entry?.email && typeof entry.window === "number") consumedChallengeWindows.set(entry.email, entry.window);
    }
  }
  // جلسات OAuth المعلّقة تُسترجَع لتصمد عبر العمليات: على Render Free قد يُنفَّذ
  // callback الموافقة في عملية جديدة بعد إطفاء/إعادة نشر، فتضيع الحالة الذاكرية
  // ويُرفض الربط بـ400 بلا سبب حقيقي. المنتهية الصلاحية تُستبعد عند الاسترجاع.
  pendingOAuth.clear();
  if (Array.isArray(control.pendingOAuth)) {
    const now = Date.now();
    for (const entry of control.pendingOAuth) {
      if (entry?.state && entry?.platform && entry?.userId && entry?.redirectUri && typeof entry?.expiresAt === "number" && entry.expiresAt > now) {
        pendingOAuth.set(String(entry.state), {
          platform: String(entry.platform),
          userId: String(entry.userId),
          expiresAt: entry.expiresAt,
          redirectUri: String(entry.redirectUri),
          codeVerifier: entry.codeVerifier ? String(entry.codeVerifier) : undefined,
        });
      }
    }
  }
  // استرجاع سجل طلبات ملف تحقق TikTok: يصمد بعد إعادة التشغيل/cold start، فلا
  // يظن المالك أن TikTok لم يطلب الملف إطلاقاً وهو قد طلبه قبل الإطفاء.
  const vr = control.verificationRequests;
  if (vr && typeof vr === "object") {
    verificationRequestLog.count = Number.isFinite(vr.count) ? Math.max(0, Number(vr.count)) : 0;
    verificationRequestLog.firstAt = typeof vr.firstAt === "string" ? vr.firstAt : null;
    verificationRequestLog.lastAt = typeof vr.lastAt === "string" ? vr.lastAt : null;
    verificationRequestLog.last = vr.last && typeof vr.last === "object" ? vr.last : null;
    verificationRequestLog.lastServed = vr.lastServed && typeof vr.lastServed === "object" ? vr.lastServed : null;
    verificationRequestLog.lastEcho = vr.lastEcho && typeof vr.lastEcho === "object" ? vr.lastEcho : null;
    verificationRequestLog.lastMismatch = vr.lastMismatch && typeof vr.lastMismatch === "object" ? vr.lastMismatch : null;
    verificationRequestLog.recent = Array.isArray(vr.recent) ? vr.recent.slice(0, VERIFICATION_REQUEST_LOG_MAX) : [];
  }
  // استرجاع تفويض تشغيل YouTube: يصمد بعد إعادة التشغيل/cold start، فلا يُفقد
  // منح المالك ولا إيقافه. يُطبَّع (نطاق YouTube فقط) قبل الاستخدام.
  if (control.youtubeDelegation) youtubeDelegationState = normalizeYouTubeDelegation(control.youtubeDelegation);
  // استرجاع حالة DR (Google Drive): حالات CSRF ورمز التجديد المشفّر وآخر خطأ.
  // لا يُعاد أي سرّ للعرض؛ رمز التجديد يبقى مشفّراً كما هو.
  drControl.driveOAuthStates = Array.isArray(control.driveOAuthStates) ? control.driveOAuthStates.slice(-200) : [];
  drControl.driveRefreshToken = control.driveRefreshToken && typeof control.driveRefreshToken === "object" ? control.driveRefreshToken : null;
  drControl.driveLastError = typeof control.driveLastError === "string" ? control.driveLastError : null;
  drControl.driveBackup = control.driveBackup && typeof control.driveBackup === "object" ? control.driveBackup : null;
  drControl.driveFolderIdentity = control.driveFolderIdentity && typeof control.driveFolderIdentity === "object" ? control.driveFolderIdentity : null;
  // هوية مجلد Drive التسويقي (فيديوهات علنية فقط — منفصل عن driveFolderIdentity).
  drControl.driveMarketingFolderIdentity = control.driveMarketingFolderIdentity && typeof control.driveMarketingFolderIdentity === "object" ? control.driveMarketingFolderIdentity : null;
  drControl.driveMirror = control.driveMirror && typeof control.driveMirror === "object" ? control.driveMirror : null;
  drControl.driveReconciliation = control.driveReconciliation && typeof control.driveReconciliation === "object" ? control.driveReconciliation : null;
  drControl.driveAutoBackup = control.driveAutoBackup && typeof control.driveAutoBackup === "object" ? control.driveAutoBackup : null;
  // PROC-01: قفل دوام النسخة/المزامنة (owner + انتهاء فقط، بلا سرّ).
  drControl.driveLease = control.driveLease && typeof control.driveLease === "object" ? control.driveLease : null;
  // تنبيهات DR (منع تكرار الإشعار) وتوازن قاعدة البيانات — تصمد بعد restart، بلا سرّ.
  drControl.driveAlerts = control.driveAlerts && typeof control.driveAlerts === "object" ? control.driveAlerts : {};
  drControl.driveDbBalance = control.driveDbBalance && typeof control.driveDbBalance === "object" ? control.driveDbBalance : null;
  // حالة وقت تشغيل العقل (Batch 5): تُسترجَع فتصمد بعد restart/cold start (بلا سرّ).
  brainRuntimeState = normalizeBrainRuntimeState(control.brainRuntime);
  // سجل تدقيق أفعال العقول الستة — يصمد بعد restart (بلا سرّ).
  sixAgentAuditState = normalizeSixAgentAudit(control.sixAgentAudit);
  // نتيجة آخر تحقق حي من Gemini: تُسترجَع فتصمد بعد restart، فلا يبدو المزود
  // غير متحقَّق بعد كل نشر (بلا سرّ — حالة/نص/موديل/وقت فقط).
  aiLiveVerificationState.restore(control.aiLiveVerification);
}

/** يقرأ حالة التحكّم متزامناً (backend الملف) عند الإقلاع. */
function loadControlStateSync(): void {
  const raw = storageAdapter.readSync<any>(STORAGE_KEY_CONTROL);
  if (raw) applyControlSnapshot(raw);
}

function buildControlState() {
  return {
    // بصمة فقط، لا توكن المعاينة ولا أي سر.
    previewTokenHash: previewControl.tokenHash,
    previewEpoch: previewEpoch.value,
    consumedOtpWindows: Array.from(consumedChallengeWindows.entries()).slice(-200).map(([email, window]) => ({ email, window })),
    // جلسات OAuth المعلّقة (بلا أي سر: PKCE verifier ليس سرّ عميل، وstate عشوائي
    // عابر). تُحفظ لتصمد عبر إعادة التشغيل فلا يفشل callback الموافقة في عملية أخرى.
    pendingOAuth: Array.from(pendingOAuth.entries())
      .filter(([, p]) => p.expiresAt > Date.now())
      .slice(-200)
      .map(([state, p]) => ({ state, platform: p.platform, userId: p.userId, expiresAt: p.expiresAt, redirectUri: p.redirectUri, codeVerifier: p.codeVerifier })),
    // سجل طلبات ملف تحقق TikTok: يبقى بعد إعادة التشغيل/cold start فلا يظن المالك
    // أن TikTok لم يطلب الملف إطلاقاً وهو قد طلبه. اسم/رمز عامان بلا سرّ.
    verificationRequests: {
      count: verificationRequestLog.count,
      firstAt: verificationRequestLog.firstAt,
      lastAt: verificationRequestLog.lastAt,
      last: verificationRequestLog.last,
      lastServed: verificationRequestLog.lastServed,
      lastEcho: verificationRequestLog.lastEcho,
      lastMismatch: verificationRequestLog.lastMismatch,
      recent: verificationRequestLog.recent.slice(0, VERIFICATION_REQUEST_LOG_MAX),
    },
    // تفويض تشغيل YouTube (نطاق YouTube فقط): يُحفظ لتصمد فعالية التفويض/الإيقاف
    // بعد إعادة التشغيل/cold start. لا يحمل أي سرّ (عمليات + طوابع + من منحه).
    youtubeDelegation: youtubeDelegationState,
    // منظومة DR: حالات CSRF (عشوائية عابرة، بلا سرّ) + رمز تجديد Drive **مشفّر
    // فقط** + آخر خطأ. لا يُكتب رمز نصي صريح في أي ملف ولا Git ولا log.
    driveOAuthStates: drControl.driveOAuthStates.slice(-200),
    driveRefreshToken: drControl.driveRefreshToken,
    driveLastError: drControl.driveLastError,
    driveBackup: drControl.driveBackup,
    driveFolderIdentity: drControl.driveFolderIdentity,
    // هوية مجلد Drive التسويقي (Task #21) — تصمد بعد restart فلا يُعاد البحث بالاسم كل مرة.
    driveMarketingFolderIdentity: drControl.driveMarketingFolderIdentity,
    // مرآة CURRENT: بصمة الشجرة + سجل الملفات الفردية (بلا أسرار) — تصمد بعد restart.
    driveMirror: drControl.driveMirror,
    // نتيجة آخر فحص ساعي (reconciliation): طابع/نتيجة/سبب فقط — تصمد بعد restart.
    driveReconciliation: drControl.driveReconciliation,
    // حالة الجدولة التلقائية للنسخة الكاملة: آخر تشغيل/نتيجته/عدّاد التخطّي — تصمد
    // بعد restart فيُمنع إنشاء نسخة مكرّرة عند إعادة التشغيل. بلا أي سرّ.
    driveAutoBackup: drControl.driveAutoBackup,
    // PROC-01: قفل دوام النسخة/المزامنة (يمنع نسختين متزامنتين عبر العمليات).
    driveLease: drControl.driveLease,
    // تنبيهات DR (منع تكرار الإشعار) وتوازن قاعدة البيانات — تصمد بعد restart، بلا سرّ.
    driveAlerts: drControl.driveAlerts,
    driveDbBalance: drControl.driveDbBalance,
    // حالة وقت تشغيل العقل (Batch 5): الحالة/القفل/العدّادات — تصمد بعد restart
    // فلا تُنشئ دورة مكرّرة، ويُستردّ القفل المتقادم. بلا أي سرّ.
    brainRuntime: brainRuntimeState,
    // سجل تدقيق أفعال العقول الستة (whitelist حتمية) — تصمد بعد restart. بلا سرّ.
    sixAgentAudit: sixAgentAuditState,
    // نتيجة آخر تحقق حي من Gemini — تصمد بعد restart فلا يبدو المزود غير متحقَّق
    // بعد كل نشر (بلا أي سرّ: حالة/نص تشخيصي/موديل/وقت/فئة/توجيه).
    aiLiveVerification: aiLiveVerificationState.snapshot(),
  };
}

/**
 * يحفظ حالة التحكّم عبر المحوّل. تُسلسَل مع طابور الحالة نفسه كي لا تتراكب
 * الكتابات ويبقى الدوام واحداً للخلفيتين.
 */
function saveControlState(): void {
  if (!storageReady) return;
  persistQueue = persistQueue
    .then(() => storageAdapter.write(STORAGE_KEY_CONTROL, buildControlState()))
    .catch((error: any) => {
      lastPersistError = String(error?.code || error?.name || "persist_failed").slice(0, 60);
      console.warn("Could not persist control state:", lastPersistError);
    });
}

/**
 * مفتاح تخزين سجل مهام العقل المركزي. مستقل عن حالة التحكّم كي لا يختلط
 * (الجداول key/value تُتيح مفتاحاً ثالثاً دون migration). لا يحمل أي سرّ.
 */
const STORAGE_KEY_AGENT = "agent";

/**
 * مفتاح ذاكرة العقل الدائمة. مستقل عن لقطة العمل ومهام العقل؛ يحمل سجلات
 * الذاكرة (بلا أي سرّ) ويصمد بعد إعادة التشغيل/إعادة النشر.
 */
const STORAGE_KEY_BRAIN_MEMORY = "brainMemory";
/** سقف سجلات الذاكرة لمنع التضخّم (الأحدث يُبقى). */
const BRAIN_MEMORY_MAX = 5000;

/**
 * العقل المركزي: المنسّق الوحيد. مهامه تُنفَّذ بأدوات حقيقية محقونة من الخادم،
 * وتُحفظ في المخزن الدائم فتصمد بعد إعادة التشغيل/cold start، فلا تُفقد مهام
 * المالك ولا نتائج التحقق.
 */
const agentOrchestrator = new AgentOrchestrator({
  toolContext: {} as AgentToolContext,
  newId: () => workspaceId("atask"),
});

/** سياق الأدوات الحقيقي لكل مُشغّل: أدوات مسموحة فقط، ونتائج فعلية بلا أسرار. */
function buildAgentToolContext(operator: AgentOperator, userId: string): AgentToolContext {
  return {
    operator,
    userId,
    // تقييم تفويض تشغيل YouTube: مصدره الخادم (الحالة الممنوحة من المالك).
    delegationCheck: (input) => youtubeDelegationCheck(operator, input),
    healthSnapshot: () => agentHealthSnapshot(),
    platformStatuses: () => {
      const liveFor = (p: string) => { const c: any = platformConnections.get(p); return { status: c?.status || "disconnected", providerVerified: Boolean(c?.providerVerified), accountName: c?.accountName || null }; };
      return computeAllPlatformStatuses(liveFor, process.env);
    },
    readinessMatrix: () => buildReadinessDetails((p: string) => { const c: any = platformConnections.get(p); return { status: c?.status || "disconnected", providerVerified: Boolean(c?.providerVerified), accountName: c?.accountName || null }; }, process.env),
    connectionStatus: () => SUPPORTED_PLATFORMS.map((p: any) => {
      const c: any = platformConnections.get(p.id);
      const r = publicProviderReadiness(p.id);
      return {
        platform: p.id,
        name: p.name,
        status: c?.status || "disconnected",
        providerVerified: Boolean(c?.providerVerified),
        configured: r.configured,
        credentialMode: credentialModeOf(p.id),
        realConnector: hasRealConnector(p.id),
      };
    }),
    credentialIntrospection: (platform: string) => {
      if (!isSupportedPlatform(platform)) return { platform, supported: false };
      const r = publicProviderReadiness(platform);
      return { platform, supported: true, configured: r.configured, mode: r.mode, missing: r.missing || [], invalid: r.invalid || [], realConnector: hasRealConnector(platform) };
    },
    workspaceSummary: () => {
      const connected = connectedPlatformIds();
      return {
        products: workspace.products.length,
        inStockProducts: workspace.products.filter((p: any) => p.inStock !== false).length,
        installmentPlans: workspace.installmentPlans.length,
        posts: workspace.posts.length,
        conversations: workspace.conversations.length,
        leads: workspace.leads.length,
        tasks: workspace.tasks.length,
        pendingJobs: automationJobs.filter((j: any) => ["queued", "approved", "ready"].includes(j.status)).length,
        connectedPlatformIds: connected,
        showroomConfigured: Boolean(workspace.showroom?.name && workspace.showroom?.name.trim()),
      };
    },
    listJobs: () => (operator === "owner" ? automationJobs : automationJobs.filter((j: any) => j.createdBy === userId)).slice(0, 100),
    createJob: (input) => {
      const job = {
        id: workspaceId("job"),
        type: String(input.type || "general"),
        status: "queued" as const,
        createdAt: new Date().toISOString(),
        createdBy: userId,
        payload: { ...(input.payload || {}), title: input.title || input.type, platform: input.platform, source: "agent" },
        requiresExternalConnection: true,
        scheduledFor: input.scheduledFor,
      };
      automationJobs.unshift(job as any);
      if (automationJobs.length > 200) automationJobs.pop();
      audit(userId, "agent_job_created", `type=${job.type} platform=${input.platform || "-"}`);
      persistState();
      return job;
    },
    approveJob: (id) => {
      const job = automationJobs.find((j: any) => j.id === id);
      if (!job) return { ok: false, error: "مهمة غير موجودة." };
      job.status = "approved";
      audit(userId, "agent_job_approved", `id=${id}`);
      persistState();
      return { ok: true, id, status: job.status };
    },
    cancelJob: (id) => {
      const job = automationJobs.find((j: any) => j.id === id);
      if (!job) return { ok: false, error: "مهمة غير موجودة." };
      job.status = "failed";
      job.lastError = "أُلغيت بواسطة العقل المركزي";
      audit(userId, "agent_job_cancelled", `id=${id}`);
      persistState();
      return { ok: true, id, status: job.status };
    },
    retryJob: (id) => {
      const job = automationJobs.find((j: any) => j.id === id);
      if (!job) return { ok: false, error: "مهمة غير موجودة." };
      job.status = "queued";
      job.lastError = undefined;
      audit(userId, "agent_job_retried", `id=${id}`);
      persistState();
      return { ok: true, id, status: job.status };
    },
    executeJob: async (id) => {
      // التنفيذ الخارجي الحقيقي يمر بمسار النشر الفعلي ذي البوابات في server.ts
      // (يُربط أدناه). لا يُنفَّذ هنا مباشرة لئلا يُتجاوز أي بوابة.
      if (!agentJobExecutor) throw new Error("منفّذ المهام الخارجي غير مهيّأ.");
      return agentJobExecutor(id, userId);
    },
    listComments: (platform?: string) => {
      const items: any[] = (workspace as any).socialComments || [];
      const filtered = platform ? items.filter((c: any) => c.platform === platform) : items;
      return filtered.slice(0, 200).map((c: any) => ({
        platform: c.platform,
        externalId: c.externalId,
        classification: c.classification?.category || c.category || null,
        ingestSource: c.ingestSource || null,
        reviewStatus: c.reviewStatus || null,
        at: c.receivedAt || c.at || null,
      }));
    },
    listCampaigns: () => ((workspace as any).marketingCampaigns || []).slice(0, 100).map((c: any) => ({ id: c.id, title: c.title, platforms: c.platforms, status: c.status, createdAt: c.createdAt })),
    buildWeekPlan: (platforms: string[], focus: string) => {
      const days = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
      return { plan: days.map((day, i) => ({ day, objective: i % 2 === 0 ? "عرض منتج وفائدة عملية" : "توعية بشروط التقسيط وخدمة العملاء", focus, platforms, requiresApproval: true, usesGemini: false })), generatedBy: "deterministic-planner" };
    },
    marketingDecision: (input?: any) => {
      // إسقاط توافقي من الحالة canonical (buildRuntimeBrain) — لا مُنتِج قرار مستقل.
      const canonicalState = buildRuntimeBrain({ ...brainRuntimeInput(), now: Date.now() }).state;
      const memory = toOperationalMemoryProjection(canonicalState, {
        decisions: ((workspace as any).marketingDecisions || []).slice(0, 200),
        strategiesTested: ((workspace as any).strategiesTested || []).slice(0, 200).map((s: any) => ({ strategy: s.strategy, outcome: s.outcome, at: s.at })),
      });
      return toMarketingDecisionProjection({ state: canonicalState, objective: input?.objective, memory });
    },
    memorySnapshot: () => {
      // إسقاط توافقي من الحالة canonical نفسها — لا بناء ذاكرة مستقل.
      const canonicalState = buildRuntimeBrain({ ...brainRuntimeInput(), now: Date.now() }).state;
      return toOperationalMemoryProjection(canonicalState, {
        decisions: ((workspace as any).marketingDecisions || []).slice(0, 200),
        strategiesTested: ((workspace as any).strategiesTested || []).slice(0, 200).map((s: any) => ({ strategy: s.strategy, outcome: s.outcome, at: s.at })),
      });
    },
    brainSnapshot: () => {
      // facade توافقية من الحالة canonical (لا مُجمِّع عقلي مستقل).
      const canonical = buildRuntimeBrain({ ...brainRuntimeInput(), now: Date.now() });
      return toCentralBrainSnapshot(canonical.state);
    },
    brainContentPlan: (input: { productId?: string | null; productName?: string | null; platforms?: string[]; objective?: string | null }) => {
      const platforms = (Array.isArray(input.platforms) ? input.platforms : []).filter((p) => isSupportedPlatform(String(p))) as PlatformId[];
      const brief = buildContentBriefForBrain(input.productId || null, input.productName || null, platforms, input.objective || null, null);
      const sched = brainScheduleSuggestion();
      return buildContentPlan({
        brief,
        recommendedPublishTime: sched.action === "use_data" ? sched.suggestedAt : null,
        schedulingReason: sched.note,
      });
    },
    systemVerification: () => ({
      version: PROJECT_VERSION,
      storage: { backend: storageAdapter.backend, healthy: storageStatus().healthy, durable: storageAdapter.backend === "postgres" || storageStatus().writable, writable: storageStatus().writable },
      platforms: { total: SUPPORTED_PLATFORMS.length, connected: connectedPlatformIds().length },
      ai: { enabled: geminiStatus().enabled, configured: geminiStatus().configured },
      timestamp: new Date().toISOString(),
    }),
    aiGenerate: async (prompt: string) => {
      const cacheKey = `agent:${Buffer.from(prompt).toString("base64").slice(0, 64)}`;
      const result = await aiEngine.run({ cacheKey, prompt, deterministicFallback: () => "تعذر توليد نص من المزود الآن؛ يلزم إعادة المحاولة أو صياغة يدوية.", meta: { platform: 'general', operation: 'agent_tool_generate' } });
      return { text: result.text, usedProvider: result.usedProvider, source: result.source };
    },
    // --- أدوات YouTube الحقيقية (المنصة التشغيلية الأساسية) ---
    youtubeStatus: () => youtubeTruthfulState(),
    youtubeVideos: async () => {
      const guard = youtubeOperationGuard();
      if (!guard.ok) return { ok: false, error: guard.error, code: guard.code as any };
      const ensured = await ensureYouTubeAccessToken();
      if (!ensured.ok || !ensured.token) return { ok: false, error: ensured.error, code: ensured.code ?? null };
      const stored = youtubeStoredCredentials();
      const res = await youtubeClient().listMyVideos(ensured.token, { uploadsPlaylistId: String(stored?.uploadsPlaylistId || ""), maxResults: 25 });
      if (!res.ok || !res.data) { noteYouTubeProviderError(res.code as any); return { ok: false, error: res.error, code: res.code ?? null }; }
      clearYouTubeProviderError();
      return { ok: true, videos: res.data.videos };
    },
    youtubeAnalytics: async () => {
      const guard = youtubeOperationGuard();
      if (!guard.ok) return { ok: false, error: guard.error, code: guard.code as any };
      const ensured = await ensureYouTubeAccessToken();
      if (!ensured.ok || !ensured.token) return { ok: false, error: ensured.error, code: ensured.code ?? null };
      const stored = youtubeStoredCredentials();
      const channelRes = await youtubeClient().getChannelStatistics(ensured.token);
      if (!channelRes.ok || !channelRes.data) { noteYouTubeProviderError(channelRes.code as any); return { ok: false, error: channelRes.error, code: channelRes.code ?? null }; }
      const videosRes = await youtubeClient().listMyVideos(ensured.token, { uploadsPlaylistId: String(stored?.uploadsPlaylistId || ""), maxResults: 50 });
      const videos = videosRes.ok && videosRes.data ? videosRes.data.videos : [];
      const records = youtubeVideoMetricRecords(videos);
      const summary = summarizeChannelAnalytics(records);
      const audience = analyzeYouTubeAudience(records, summary);
      clearYouTubeProviderError();
      return { ok: true, summary, audience, channel: channelRes.data };
    },
    youtubeComments: async (videoIds: string | string[]) => {
      const guard = youtubeOperationGuard();
      if (!guard.ok) return { ok: false, error: guard.error, code: guard.code as any };
      if (!youtubeForceSslGranted()) return { ok: false, error: "إعادة ربط YouTube مطلوبة لتفعيل إدارة التعليقات (نطاق youtube.force-ssl).", code: "SCOPE_UPGRADE_REQUIRED" };
      const ensured = await ensureYouTubeAccessToken();
      if (!ensured.ok || !ensured.token) return { ok: false, error: ensured.error, code: ensured.code ?? null };
      // نفحص مجموعة محدودة من أحدث الفيديوهات الحقيقية (حدّ ثابت يمنع استهلاكاً غير محدود):
      // طلب commentThreads.list واحد لكل فيديو، وorder=time من الموصل يعطي الأحدث أولاً.
      const list = (Array.isArray(videoIds) ? videoIds : String(videoIds || '').split(',')).map((v) => String(v).trim()).filter(Boolean);
      const scannedVideoIds = [...new Set(list)].slice(0, commentScanVideoLimitFromEnv());
      if (!scannedVideoIds.length) return { ok: false, error: "لم تُقدَّم أي معرّفات فيديو حقيقية.", code: "MISSING_ARGUMENT" };
      const all: any[] = [];
      let inserted = 0; let duplicates = 0; let lastError: { error: string; code: string | null } | null = null; let okCount = 0;
      for (const videoId of scannedVideoIds) {
        const res = await youtubeClient().listCommentThreads(ensured.token, { videoId, maxResults: 25 });
        if (!res.ok || !res.data) { lastError = { error: res.error, code: (res.code as string) ?? null }; continue; }
        okCount += 1;
        for (const c of res.data.comments) {
          const ing = ingestYouTubeComment(c, videoId);
          if (ing.duplicate) duplicates += 1; else inserted += 1;
          all.push({ ...c, videoId: c.videoId ?? videoId });
        }
      }
      if (!okCount) { if (lastError) noteYouTubeProviderError(lastError.code as any); return { ok: false, error: lastError?.error || "تعذّر قراءة تعليقات الفيديوهات المفحوصة.", code: lastError?.code ?? null }; }
      // أحدث تعليق فعلي بين كل الفيديوهات المفحوصة (ترتيب زمني تنازلي حقيقي).
      all.sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
      const top = all.find((c) => c && c.commentId) || null;
      await persistStateDurable();
      clearYouTubeProviderError();
      return {
        ok: true,
        comments: all,
        scannedVideoIds,
        videosScanned: scannedVideoIds.length,
        latestComment: top ? { commentId: top.commentId, videoId: top.videoId ?? null, text: top.text, authorName: top.authorName ?? null, publishedAt: top.publishedAt ?? null } : null,
        inserted, duplicates,
      };
    },
    youtubeLearning: async () => {
      const guard = youtubeOperationGuard();
      if (!guard.ok) return { ok: false, error: guard.error, code: guard.code as any };
      const ensured = await ensureYouTubeAccessToken();
      if (!ensured.ok || !ensured.token) return { ok: false, error: ensured.error, code: ensured.code ?? null };
      const stored = youtubeStoredCredentials();
      const res = await youtubeClient().listMyVideos(ensured.token, { uploadsPlaylistId: String(stored?.uploadsPlaylistId || ""), maxResults: 50 });
      if (!res.ok || !res.data) { noteYouTubeProviderError(res.code as any); return { ok: false, error: res.error, code: res.code ?? null }; }
      const records = youtubeVideoMetricRecords(res.data.videos);
      const learning = buildYouTubeLearning({ records: records.slice(0, 25), previousRecords: records.slice(25) });
      clearYouTubeProviderError();
      return { ok: true, learning };
    },
    youtubeReply: async (input: { commentId: string; text: string; commentText?: string }) => {
      // التنفيذ الخارجي يمر بمنفّذ الرد الحقيقي نفسه (كل البوابات سارية، لا تجاوز).
      const result = await executeYouTubeReply({ commentId: input.commentId, text: input.text, commentText: input.commentText }, userId);
      if (result.status >= 400) throw new Error(result.body?.error || "فشل الرد على تعليق YouTube.");
      // لا تسليم بلا معرّف رد حقيقي من YouTube (منفّذ الرد يضمن ذلك؛ نتحقّق هنا أيضاً).
      const delivered = result.body?.delivered === true && Boolean(result.body?.externalReplyId);
      // `state` يحمل دورة حياة الرد الفعلية (sent) لا حالة المنصة العامة، ليكون
      // الحكم على التسليم صريحاً في مخرَج الخطوة.
      const replyState = result.body.reply?.state ?? null;
      return { delivered, externalReplyId: result.body.externalReplyId || null, state: replyState, youtubeState: result.body.state, reply: result.body.reply };
    },
    /**
     * التحقق من تسجيل رد حقيقي مُسلَّم على تعليق: يقرأ سجل الردود الفعلي (workspace)
     * ويطابق معرّف التعليق ومعرّف الرد الحقيقي من المزوّد. بلا سرّ ولا اختلاق —
     * غياب السجل يعني عدم التسليم صراحةً.
     */
    youtubeReplyVerify: async (input: { commentId: string; externalReplyId?: string | null }) => {
      const commentId = String(input.commentId || "").trim();
      if (!commentId) return { real: false, note: "معرّف التعليق مطلوب للتحقق." };
      const replies = ((workspace as any).socialReplies || []) as any[];
      const record = replies.find((r) => r.platform === "youtube" && r.externalId === commentId && r.delivered === true && r.externalReplyId);
      if (!record) return { real: false, note: "لا يوجد سجل رد مُسلَّم على هذا التعليق بمعرّف من YouTube." };
      if (input.externalReplyId && String(record.externalReplyId) !== String(input.externalReplyId)) {
        return { real: false, note: "معرّف الرد المتوقّع لا يطابق السجل الفعلي." };
      }
      return {
        real: true,
        record: {
          externalId: record.externalId,
          externalReplyId: record.externalReplyId,
          state: record.state ?? null,
          delivered: record.delivered === true,
          sentAt: record.sentAt ?? null,
          repliedAt: record.repliedAt ?? null,
        },
        note: "رُدّ فعلاً على هذا التعليق بمعرّف رد حقيقي من YouTube.",
      };
    },
    youtubePublish: async (input) => {
      // التنفيذ الخارجي يمر بمنفّذ الرفع الحقيقي نفسه (كل البوابات سارية، لا تجاوز).
      const result = await executeYouTubePublish({
        title: input.title, description: input.description, tags: input.tags,
        privacyStatus: input.privacyStatus, publishAt: input.publishAt || undefined,
        videoBase64: input.videoBase64, mimeType: input.mimeType, approved: true,
      }, userId);
      if (result.status >= 400) throw new Error(result.body?.error || "فشل رفع الفيديو إلى YouTube.");
      return { record: result.body.record, externalVideoId: result.body.externalVideoId, url: result.body.url, state: result.body.state };
    },
    youtubeVideoUpdate: async (input: { videoId: string; title: string; description?: string; tags?: string[]; privacyStatus?: string }) => {
      const guard = youtubeOperationGuard();
      if (!guard.ok) throw new Error(guard.error);
      const ensured = await ensureYouTubeAccessToken();
      if (!ensured.ok || !ensured.token) throw new Error(ensured.error);
      const metadata = { title: input.title, description: input.description || "", tags: Array.isArray(input.tags) ? input.tags : [], categoryId: YOUTUBE_DEFAULT_CATEGORY_ID, privacyStatus: input.privacyStatus };
      const result = await youtubeClient().updateVideo(ensured.token, { videoId: input.videoId, metadata: metadata as any });
      audit(userId, result.ok ? "youtube_video_updated" : "youtube_video_update_failed", `youtube:${input.videoId}`);
      if (!result.ok) throw new Error(result.error || "فشل تحديث بيانات الفيديو.");
      return { video: result.data };
    },
  };
}

/** سياق الصحة الآمن للعقل (بلا أسرار) — مستقل عن مسار /api/health الكامل. */
function agentHealthSnapshot() {
  return {
    version: PROJECT_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    storage: { backend: storageAdapter.backend, healthy: storageStatus().healthy, writable: storageStatus().writable },
    platforms: { total: SUPPORTED_PLATFORMS.length, connected: connectedPlatformIds().length },
    jobs: { total: automationJobs.length, queued: automationJobs.filter((j: any) => j.status === "queued").length, failed: automationJobs.filter((j: any) => j.status === "failed").length },
    ai: geminiStatus(),
    timestamp: new Date().toISOString(),
  };
}

/** يُربط بمسار التنفيذ الخارجي الفعلي بعد تعريفه (يمنع تجاوز البوابات). */
let agentJobExecutor: ((id: string, userId: string) => Promise<any>) | null = null;

/** عدد أدوات العقل — المصدر الواحد هو سجل الأدوات (لا رقم مكتوب يدوياً). */
const AGENT_TOOLS_COUNT_FOR_HEALTH = AGENT_TOOLS.length;

/** أسماء المزوّدين وحالة ضبطهم فقط (بلا أي قيمة سرّية) لكتلة الصحة. */
function describeProvidersForHealth(): Array<{ id: string; role: string; configured: boolean }> {
  return describeProviders(process.env).map((p) => ({ id: p.id, role: p.role, configured: p.configured }));
}

/** يسترجع سجل مهام العقل من المخزن الدائم (يصمد بعد إعادة التشغيل). */
function loadAgentStateSync(): void {
  const raw = storageAdapter.readSync<any>(STORAGE_KEY_AGENT);
  if (raw && Array.isArray(raw.tasks)) agentOrchestrator.restore(raw.tasks);
}

/** يحفظ سجل مهام العقل (بلا أسرار؛ السياق منقّى في طبقة المنسّق). */
function saveAgentState(): void {
  if (!storageReady) return;
  persistQueue = persistQueue
    .then(() => storageAdapter.write(STORAGE_KEY_AGENT, { tasks: agentOrchestrator.snapshot() }))
    .catch((error: any) => {
      lastPersistError = String(error?.code || error?.name || "persist_failed").slice(0, 60);
      console.warn("Could not persist agent state:", lastPersistError);
    });
}

/**
 * الذاكرة الدائمة للعقل المركزي. تُحفظ في مفتاح تخزين مستقل (`brainMemory`)
 * عبر محوّل الحالة القائم نفسه (ملف/Postgres) — لا قاعدة بيانات ثانية ولا سرّ.
 */
let brainMemoryStore: BrainMemoryStoreState = emptyBrainMemory();

/** يسترجع ذاكرة العقل الدائمة عند الإقلاع (تصمد بعد restart/cold start). */
function loadBrainMemorySync(): void {
  const raw = storageAdapter.readSync<any>(STORAGE_KEY_BRAIN_MEMORY);
  brainMemoryStore = normalizeBrainMemory(raw);
}

/** يوحّد لقطة الذاكرة المحمّلة (يتجاهل أي شكل غير صالح بلا إسقاط). */
function normalizeBrainMemory(raw: any): BrainMemoryStoreState {
  const records = Array.isArray(raw?.records) ? raw.records : [];
  const valid: BrainMemoryRecord[] = records.filter((r: any) =>
    r && typeof r.id === 'string' && typeof r.kind === 'string' && typeof r.summary === 'string'
    && ['active', 'superseded', 'retracted'].includes(r.status),
  ).map((r: any) => ({
    id: r.id,
    kind: r.kind,
    platform: r.platform ?? null,
    origin: r.origin || 'derived',
    createdAt: r.createdAt || new Date().toISOString(),
    lastValidatedAt: r.lastValidatedAt ?? null,
    confidence: r.confidence || 'low',
    status: r.status,
    sampleSize: Number.isFinite(r.sampleSize) ? r.sampleSize : 0,
    sourceRefs: Array.isArray(r.sourceRefs) ? r.sourceRefs.slice(0, 20) : [],
    summary: r.summary,
    relatedGoal: r.relatedGoal ?? null,
    relatedExperiment: r.relatedExperiment ?? null,
    stale: Boolean(r.stale),
    staleReason: r.staleReason ?? null,
  }));
  return { records: valid.slice(0, BRAIN_MEMORY_MAX) };
}

/**
 * عدّادان خاصان بكتابات ذاكرة العقل: `brainMemoryWriteSeq` يزيد لكل كتابة
 * مجدولة، و`brainMemoryLastErrorSeq` يحمل تسلسل آخر كتابة فاشلة. بهما تعرف دورة
 * العقل نجاح كتابتها **بالضبط** بلا تأثّر بفشل كتابة أخرى (lastPersistError مشترك
 * مع مسارات الحالة الأخرى، فلا يصلح للحكم هنا).
 */
let brainMemoryWriteSeq = 0;
let brainMemoryLastErrorSeq = -1;

/**
 * يدرج سجلات ذاكرة جديدة (بلا تكرار) ثم يحفظها دائمياً. يعيد تسلسل الكتابة
 * المجدولة (أو -1 إن لم تكن هناك كتابة) ليتابع المستدعي نجاحها/فشلها بالضبط.
 */
function persistBrainMemory(records: BrainMemoryRecord[]): number {
  let added = 0;
  for (const record of records) {
    const res = upsertMemoryRecord(brainMemoryStore, record);
    brainMemoryStore = res.store;
    if (res.added) added += 1;
  }
  if (!added) return -1;
  if (brainMemoryStore.records.length > BRAIN_MEMORY_MAX) {
    brainMemoryStore = { records: brainMemoryStore.records.slice(-BRAIN_MEMORY_MAX) };
  }
  if (!storageReady) return -1;
  const snapshot = { records: brainMemoryStore.records };
  const mySeq = brainMemoryWriteSeq++;
  persistQueue = persistQueue
    .then(() => storageAdapter.write(STORAGE_KEY_BRAIN_MEMORY, snapshot))
    .catch((error: any) => {
      brainMemoryLastErrorSeq = mySeq;
      lastPersistError = String(error?.code || error?.name || "persist_failed").slice(0, 60);
      console.warn("Could not persist brain memory:", lastPersistError);
    });
  return mySeq;
}

// -----------------------------------------------------------------------------
// فريق الوكلاء (Agent Council — Batch 6).
//
// جلسة فريق داخلية ينسّقها العقل المركزي: بحث → تحليل → استراتيجية → نقد → قرار.
// **لا تنفيذ خارجي** ولا استدعاء AI بلا داعٍ (منطق حتمي)، وقرارها يُكتب في **نفس**
// ذاكرة العقل القائمة (`persistBrainMemory`) عند استيفاء قواعد الصدق. تُحفظ الجلسات
// عبر محوّل الحالة في مفتاح `teamSessions` فتصمد بعد restart/cold start.
// -----------------------------------------------------------------------------

const STORAGE_KEY_TEAM_SESSIONS = "teamSessions";
let teamSessionState: TeamSessionState = emptyTeamSessionState();

/** يسترجع جلسات الفريق عند الإقلاع (تصمد بعد restart). */
function loadTeamSessionsSync(): void {
  const raw = storageAdapter.readSync<any>(STORAGE_KEY_TEAM_SESSIONS);
  teamSessionState = normalizeTeamSessionState(raw);
}

/** يوحّد لقطة الجلسات المحمّلة (يتجاهل أي شكل غير صالح بلا إسقاط). */
function normalizeTeamSessionState(raw: any): TeamSessionState {
  const sessions = Array.isArray(raw?.sessions) ? raw.sessions : [];
  const valid = sessions.filter((s: any) =>
    s && typeof s.teamSessionId === 'string' && typeof s.task === 'string' && typeof s.dedupeKey === 'string'
    && Array.isArray(s.participants) && ['completed', 'partial', 'failed'].includes(s.status),
  ).map((s: any) => ({ ...s, brainDecision: s.brainDecision ?? null }));
  return { sessions: valid.slice(-2000) };
}

/** يحفظ جلسات الفريق دائمياً (بلا أي سرّ). */
function persistTeamSessions(): void {
  if (!storageReady) return;
  persistQueue = persistQueue
    .then(() => storageAdapter.write(STORAGE_KEY_TEAM_SESSIONS, { sessions: teamSessionState.sessions }))
    .catch((error: any) => {
      lastPersistError = String(error?.code || error?.name || "persist_failed").slice(0, 60);
      console.warn("Could not persist team sessions:", lastPersistError);
    });
}

// -----------------------------------------------------------------------------
// أفعال العقول الستة الحتمية (دفعة النشر متعدد المنصات): whitelist صريحة + تدقيق.
//
// العقول الستة تنفّذ أربعة أفعال حتمية فقط (بلا Gemini): تصنيف تعليق، تسجيل
// عدّادات، إعادة محاولة نشر واحدة، ورد بنمط محفوظ بثقة عالية. أي شيء آخر ⇒ تصعيد
// للعقل المركزي. كل فعل يُسجَّل في سجل تدقيق دائم. الحالة تُحفظ عبر محوّل الحالة
// القائم (control.sixAgentAudit) فتصمد بعد restart/cold start. لا سرّ هنا.
// -----------------------------------------------------------------------------
let sixAgentAuditState: SixAgentAuditState = emptySixAgentAudit();
/** أنماط الردود المحفوظة (من ذاكرة القرارات) — تُقرأ من الذاكرة، لا تخزين موازٍ. */
function storedReplyPatternsForSixAgents(platform: string | null): StoredReplyPattern[] {
  const out: StoredReplyPattern[] = [];
  for (const rec of brainMemoryStore.records || []) {
    if (rec.kind !== 'conversation' && rec.kind !== 'decision') continue;
    if (rec.status !== 'active' || rec.stale) continue;
    if (rec.confidence !== 'high') continue;
    // أصل موثوق فقط: قول AI لا يصبح نمطاً قابلاً للتنفيذ (مكافحة التسميم).
    if (rec.origin === 'ai_statement') continue;
    const pat = (rec as any).replyPattern;
    if (!pat || !Array.isArray(pat.triggers) || typeof pat.replyText !== 'string') continue;
    out.push({
      patternId: rec.id,
      triggers: pat.triggers.map((t: any) => String(t)).slice(0, 20),
      replyText: String(pat.replyText),
      confidence: typeof pat.confidence === 'number' ? pat.confidence : (rec.confidence === 'high' ? 0.9 : 0),
      active: rec.status === 'active' && !rec.stale,
      platform: rec.platform ?? null,
    });
  }
  return out;
}
function persistSixAgentAudit(): void {
  if (!storageReady) return;
  persistQueue = persistQueue
    .then(() => storageAdapter.write(STORAGE_KEY_CONTROL, buildControlState()))
    .catch((error: any) => {
      lastPersistError = String(error?.code || error?.name || "persist_failed").slice(0, 60);
      console.warn("Could not persist six-agent audit:", lastPersistError);
    });
}
/** منفّذات أفعال العقول الستة — كلها تعيد استخدام المنفّذات الحقيقية القائمة. */
function sixAgentActionDeps(): DeterministicActionDeps {
  return {
    tagComment: (platform, commentId, tag) => {
      // تثبيت التصنيف الحتمي (لا قرار، لا إرسال): يُكتب على سجل التعليق إن وُجد،
      // وإلا يُثبَّت في خريطة وسوم مستقلة — الدليل هو معرّف التعليق نفسه.
      if (!commentId) return { ok: false, evidenceRef: null };
      const entry = (watcherState.processed || []).find((e: any) => e.commentId === commentId);
      if (entry) (entry as any).sixAgentTag = tag;
      (workspace as any).sixAgentTags = (workspace as any).sixAgentTags || {};
      (workspace as any).sixAgentTags[commentId] = { tag, platform, at: new Date().toISOString() };
      persistState();
      return { ok: true, evidenceRef: commentId };
    },
    recordCounter: (platform, metric, value) => {
      const key = `counter:${platform}:${metric}`;
      (workspace as any).sixAgentCounters = (workspace as any).sixAgentCounters || {};
      (workspace as any).sixAgentCounters[key] = Number(value || 0);
      persistState();
    },
    retryPublish: async (platform, postId, content) => {
      const r = await executePlatformPublish(platform, { content, approved: true, postId }, "six-agent");
      const providerPostId = r.body?.providerPostId || r.body?.providerPublishId || null;
      return { ok: r.status === 200 && Boolean(providerPostId), providerPostId, error: r.body?.error || r.body?.code || null };
    },
    sendReply: async (platform, target, text) => {
      if (platform === 'youtube') {
        const r = await executeYouTubeReply({ commentId: target.commentId, text }, "six-agent");
        const providerReplyId = r.body?.externalReplyId || null;
        return { ok: Boolean(r.body?.delivered && providerReplyId), providerReplyId, error: r.body?.code || r.body?.error || null };
      }
      return { ok: false, providerReplyId: null, error: 'PLATFORM_REPLY_NOT_IMPLEMENTED' };
    },
  };
}
/**
 * يحاول تنفيذ فعل حتمي من عقل (واحد من الستة) إن كان مسموحاً؛ وإلا يُصعَّد للعقل
 * المركزي. **لا Gemini هنا إطلاقاً.** كل محاولة تُسجَّل في سجل التدقيق.
 */
async function trySixAgentAction(input: {
  agentId: string; action: string; platform: string; commentId?: string; commentText?: string;
  tag?: string; metric?: string; value?: number; postId?: string; content?: string;
  priorRetryCount?: number; singlePlatformFailure?: boolean;
}): Promise<{ decision: any; outcome: string; evidenceRef: string | null; requiresCentralBrain: boolean }> {
  const patterns = storedReplyPatternsForSixAgents(input.platform);
  const exec = await executeSixAgentAction(
    { ...input, platform: input.platform, storedPatterns: patterns },
    sixAgentActionDeps(),
  );
  // عند مطابقة نمط: نمرّر نص النمط المحفوظ (لا اختراع) ثم ننفّذ الرد.
  if (exec.decision.matchedPatternId && input.action === 'reply_from_stored_pattern') {
    const pat = patterns.find((p) => p.patternId === exec.decision.matchedPatternId);
    if (pat) {
      const r = await sixAgentActionDeps().sendReply(input.platform, { commentId: String(input.commentId || '') }, pat.replyText);
      const outcome = r.ok && r.providerReplyId ? 'executed' : 'failed';
      sixAgentAuditState = recordSixAgentAudit(sixAgentAuditState, {
        id: `saa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        agentId: input.agentId as any, action: input.action as any,
        matchedRule: exec.decision.matchedRule, matchedPatternId: exec.decision.matchedPatternId,
        decisionCode: exec.decision.code, outcome: outcome as any, platform: input.platform,
        evidenceRef: r.providerReplyId, note: r.ok ? 'رد بنمط محفوظ بثقة عالية.' : `تعذّر الرد: ${r.error || 'سبب غير معروف'}`,
        now: Date.now(),
      });
      persistSixAgentAudit();
      return { decision: exec.decision, outcome, evidenceRef: r.providerReplyId, requiresCentralBrain: false };
    }
  }
  sixAgentAuditState = recordSixAgentAudit(sixAgentAuditState, {
    id: `saa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    agentId: input.agentId as any, action: input.action as any,
    matchedRule: exec.decision.matchedRule, matchedPatternId: exec.decision.matchedPatternId,
    decisionCode: exec.decision.code, outcome: exec.outcome as any, platform: input.platform,
    evidenceRef: exec.evidenceRef, note: exec.note, now: Date.now(),
  });
  persistSixAgentAudit();
  return { decision: exec.decision, outcome: exec.outcome, evidenceRef: exec.evidenceRef, requiresCentralBrain: exec.decision.requiresCentralBrain };
}

// -----------------------------------------------------------------------------
// الطبقة الإدراكية (Batch 7): ذاكرة عاملة قصيرة المدى + تقارير الدورات الإدراكية.
//
// الذاكرة العاملة **سياق قصير المدى فقط** (TTL) ولا تُرقّى تلقائياً إلى الذاكرة
// طويلة المدى (هذا ممنوع بالتصميم). التقارير **تحليلية فقط** بلا تنفيذ خارجي وبلا
// تفكير داخلي خاص. كلتاهما تُحفظان عبر محوّل الحالة فتصمدان بعد restart/cold start.
// -----------------------------------------------------------------------------

const STORAGE_KEY_WORKING_MEMORY = "workingMemory";
let workingMemoryState: WorkingMemoryState = emptyWorkingMemory();
/** تقارير الدورات الإدراكية (أحدث أولاً محفوظة بحدّ أعلى) — بلا سرّ. */
const COGNITIVE_REPORT_MAX = 200;
let cognitiveReports: CognitiveReport[] = [];

/** يسترجع الذاكرة العاملة + تقارير الدورات عند الإقلاع (تصمد بعد restart). */
function loadCognitionSync(): void {
  const raw = storageAdapter.readSync<any>(STORAGE_KEY_WORKING_MEMORY);
  workingMemoryState = normalizeWorkingMemory(raw?.workingMemory ?? raw);
  const reportsRaw = Array.isArray(raw?.reports) ? raw.reports : [];
  cognitiveReports = reportsRaw.filter((r: any) => r && typeof r.cycleId === 'string' && typeof r.eventIdentity === 'string').slice(-COGNITIVE_REPORT_MAX);
}

/** يحفظ الذاكرة العاملة + تقارير الدورات (بلا أي سرّ). */
function persistCognition(): void {
  if (!storageReady) return;
  persistQueue = persistQueue
    .then(() => storageAdapter.write(STORAGE_KEY_WORKING_MEMORY, {
      workingMemory: { entries: workingMemoryState.entries },
      reports: cognitiveReports.slice(-COGNITIVE_REPORT_MAX),
    }))
    .catch((error: any) => {
      lastPersistError = String(error?.code || error?.name || "persist_failed").slice(0, 60);
      console.warn("Could not persist cognition state:", lastPersistError);
    });
}

/** يحفظ تقرير دورة إدراكية بلا تكرار (نفس cycleId يُستبدل). */
function recordCognitiveReport(report: CognitiveReport): void {
  const others = cognitiveReports.filter((r) => r.cycleId !== report.cycleId && r.eventIdentity !== report.eventIdentity);
  cognitiveReports = [...others, report].slice(-COGNITIVE_REPORT_MAX);
}

/** يُظهر تقرير دورة بالمعرّف (cycleId أو eventIdentity). */
function cognitiveReportById(id: string): CognitiveReport | null {
  return cognitiveReports.find((r) => r.cycleId === id || r.eventIdentity === id) ?? null;
}

// -----------------------------------------------------------------------------
// حالة الاستراتيجية + سجل قرار→نتيجة — يملكهما العقل المركزي (Central Brain 1).
// تُحفظان عبر محوّل الحالة (لا مخزن ثانٍ) فتصمدان بعد restart/cold start.
// -----------------------------------------------------------------------------

const STORAGE_KEY_STRATEGY_STATE = "centralBrainStrategy";
const STORAGE_KEY_DECISION_LEDGER = "centralBrainDecisionLedger";
let strategyState: StrategyState = emptyStrategyState();
let decisionLedger: DecisionLedger = emptyDecisionLedger();

/** يسترجع حالة الاستراتيجية + سجل القرار→النتيجة عند الإقلاع (تصمد بعد restart). */
function loadStrategyAndLedgerSync(): void {
  strategyState = normalizeStrategyState(storageAdapter.readSync<any>(STORAGE_KEY_STRATEGY_STATE));
  decisionLedger = normalizeDecisionLedger(storageAdapter.readSync<any>(STORAGE_KEY_DECISION_LEDGER));
}

function persistStrategyState(): void {
  if (!storageReady) return;
  persistQueue = persistQueue
    .then(() => storageAdapter.write(STORAGE_KEY_STRATEGY_STATE, strategyState))
    .catch((error: any) => {
      lastPersistError = String(error?.code || error?.name || "persist_failed").slice(0, 60);
      console.warn("Could not persist strategy state:", lastPersistError);
    });
}

function persistDecisionLedger(): void {
  if (!storageReady) return;
  persistQueue = persistQueue
    .then(() => storageAdapter.write(STORAGE_KEY_DECISION_LEDGER, decisionLedger))
    .catch((error: any) => {
      lastPersistError = String(error?.code || error?.name || "persist_failed").slice(0, 60);
      console.warn("Could not persist decision ledger:", lastPersistError);
    });
}

/**
 * يُحدّث حالة الاستراتيجية من **خطط الاستراتيجية الكانونية** (`buildRuntimeBrain`).
 * لا يُسجّل إصداراً إلا عند تغيّر فعلي (بلا اختراع). تُستدعى من مسارات العقل.
 */
function syncStrategyStateFromBrain(): void {
  try {
    const built = buildRuntimeBrain({ ...brainRuntimeInput(), now: Date.now() });
    const items = toStrategySnapshot(built.strategies as any);
    const res = updateStrategyState(strategyState, { items, now: Date.now(), source: 'brain:strategyEngine' });
    if (res.changed) {
      strategyState = res.state;
      persistStrategyState();
    }
  } catch { /* أفضل جهد — لا يُسقط أي طلب */ }
}

/**
 * يبني سياق العقل المركزي (Brain 1) المُغذّى للدورة الإدراكية: الاستراتيجية
 * الحالية (التي يملكها العقل) + الهدف الكانوني + ملخّص الجمهور/السوق/المعرفة.
 * لا إعادة حساب: يقرأ الحالة الحالية فقط. بلا سرّ.
 */
function brainContextForCognition(built: { state: any }): CognitiveBrainContext {
  const st = built.state || {};
  const segments = Array.isArray(st.audience?.segments) ? st.audience.segments : [];
  // موضوعات الجمهور الحقيقية (اهتمامات/أسئلة متكررة من تفاعل ملاحَظ فقط) — تُستهلك
  // في تخطيط الإدراك (مطابقة موضوع الحدث) لا للعرض فقط. بلا اختراع.
  const audienceTopics: string[] = [];
  for (const s of segments) {
    const topics = [...(s?.interests || []), ...(s?.commonQuestions || [])];
    for (const t of topics) {
      const v = String(t || '').trim();
      if (v && v !== 'general' && !audienceTopics.includes(v)) audienceTopics.push(v);
    }
  }
  const marketNote = st.market?.note ? String(st.market.note).slice(0, 200) : null;
  return {
    brainId: CENTRAL_BRAIN_ID,
    strategyVersion: strategyState.currentVersion || null,
    strategyScopeCount: strategyState.current?.items.length ?? 0,
    strategySummary: (strategyState.current?.items || []).slice(0, 6).map((i) => ({ scope: i.scope, what: i.what, status: i.status })),
    canonicalGoal: st.goals?.primary ?? null,
    audienceSegments: segments.length,
    audienceTopics: audienceTopics.slice(0, 8),
    marketHasEvidence: Boolean(st.market?.hasCommercialEvidence),
    marketNote,
    knowledgeCount: Array.isArray(st.knowledge?.items) ? st.knowledge.items.length : 0,
    available: true,
  };
}

/**
 * يسجّل قراراً مركزياً حقيقياً في سجل قرار→نتيجة (سلطة واحدة). لا يُخترع قرار.
 * النتيجة تبدأ غير متاحة صراحةً حتى تُلاحظ.
 */
function recordCentralDecision(input: {
  decision: BrainDecision;
  platform: string;
  eventIdentity: string;
  actionText: string;
  memoryRecordIds?: string[];
  escalationExternalId?: string | null;
}): void {
  try {
    const res = recordDecision(decisionLedger, {
      decisionId: input.decision.decisionId,
      platform: input.platform,
      eventIdentity: input.eventIdentity,
      finalStatus: input.decision.finalStatus,
      actionKind: input.decision.proposedAction?.kind || 'none',
      actionText: input.actionText,
      now: Date.now(),
      links: {
        memoryRecordIds: input.memoryRecordIds || [],
        escalationExternalId: input.escalationExternalId ?? null,
      },
    });
    decisionLedger = res.ledger;
    persistDecisionLedger();
  } catch { /* أفضل جهد */ }
}

/**
 * العدد الحقيقي المتراكم للرصدات المطابقة من سجل المراقبة الدائم — مصدر العيّنة
 * لحلقة التعلّم، فلا تُرقّى ملاحظة واحدة إلى معرفة دائمة قبل 3 رصدات مستقلة.
 * يُشتق من الحالة الفعلية (تُحفظ وتُسترجَع) لا من قيمة ثابتة، ويصمد بعد restart.
 * مطابق لمبدأ الحلقة الدائرية (`selectMetricEntries`) المستخدم في التقارير.
 */
function watcherObservationCount(kind: 'engagement_changed' | 'response_received' | 'no_change'): number {
  if (kind === 'engagement_changed') {
    return watcherState.processed.filter((p) => p.followUpOutcome?.kind === 'engagement_changed').length;
  }
  if (kind === 'response_received') {
    return watcherState.processed.filter((p) => Boolean(p.externalReplyId) && (p.stage === 'REPLIED' || p.stage === 'VERIFIED')).length;
  }
  return watcherState.processed.filter((p) => p.stage === 'FAILED').length;
}

/**
 * يسجّل نتيجة ملاحَظة من بيانات حقيقية (رد مُسلَّم/فشل) في الذاكرة طويلة المدى —
 * إغلاقاً لحلقة ACTION→RESULT→OBSERVATION→ANALYSIS→LESSON→MEMORY. **لا ادعاء بيع
 * ولا رقم مالي**: النوع اجتماعي فقط، والدرس لا يُرقّى إلا بمصدر وعيّنة كافية
 * (عبر `lessonToMemoryEntry`/`learningToMemoryEntries`). لا يرمي.
 */
function recordReadOutcome(input: {
  id: string;
  platform: PlatformId;
  kind: 'response_received' | 'no_change' | 'inquiry' | 'purchase_signal' | 'engagement_changed';
  summary: string;
  source: string;
  sampleSize: number;
  /** ربط اختياري بقرار مركزي (decisionId) لإغلاق سجل قرار→نتيجة بمعرّف حقيقي. */
  decisionId?: string | null;
  providerReplyId?: string | null;
}): void {
  try {
    const now = Date.now();
    const obs = makeOutcomeObservation({ id: input.id, platform: input.platform, kind: input.kind, summary: input.summary, source: input.source, sampleSize: input.sampleSize, now });
    const outcome = buildLearningOutcome([obs], now);
    const records = learningToMemoryEntries(outcome, { platform: input.platform, now, source: input.source })
      .map((b) => toMemoryRecord(b.entry));
    if (records.length) persistBrainMemory(records);
    // ربط النتيجة الحقيقية بالقرار المركزي (سجل قرار→نتيجة): معرّفات حقيقية فقط.
    if (input.decisionId) {
      const kindMap: Record<typeof input.kind, LedgerOutcomeKind> = {
        engagement_changed: 'engagement_changed', no_change: 'no_change',
        response_received: 'delivered', inquiry: 'delivered', purchase_signal: 'delivered',
      };
      const res = attachOutcome(decisionLedger, {
        decisionId: input.decisionId,
        kind: kindMap[input.kind],
        summary: input.summary,
        source: input.source,
        now,
        memoryRecordIds: records.map((r) => r.id),
        providerReplyId: input.providerReplyId ?? null,
      });
      if (res.attached) { decisionLedger = res.ledger; persistDecisionLedger(); }
    }
  } catch { /* التعلّم لا يُسقط أي مسار */ }
}

/** معرّف القرار المركزي لهوية حدث (لربط النتيجة بقرارها) — أو null بلا اختراع. */
function decisionIdForEvent(eventIdentity: string): string | null {
  const e = decisionLedger.entries.find((x) => x.eventIdentity === eventIdentity);
  return e ? e.decisionId : null;
}

/**
 * قرار العقل المركزي النهائي لحدث حقيقي (سلطة التنفيذ الوحيدة — Batch 8.1).
 * يقرأ آخر جلسة فريق قرّرها العقل لنفس `eventIdentity`. **لا يُنشئ قراراً** ولا
 * يخترع: عند غياب قرار مركزي يعيد `null` (فيمنع مسار التنفيذ أي رد).
 */
function centralActionDecisionForEvent(eventIdentity: string): BrainDecisionStatus | null {
  const norm = String(eventIdentity).trim().toLowerCase();
  for (let i = teamSessionState.sessions.length - 1; i >= 0; i -= 1) {
    const s = teamSessionState.sessions[i];
    const bd = s.brainDecision;
    if (!bd) continue;
    const bid = `comment:${String(bd.eventIdentity || '').replace(/^comment:/, '')}`.trim().toLowerCase();
    if (bd.eventIdentity?.toLowerCase() === norm || bid === norm) return bd.finalStatus;
  }
  return null;
}

/** سياق الفريق الحقيقي من بيانات الإنتاج (بلا شبكة وبلا أسرار). */
function teamContext(task: string, platform: PlatformId, meta: { escalationReason?: EscalationReason | null } = {}) {
  const input = brainRuntimeInput();
  const activeMemory = brainMemoryStore.records.filter((r) => r.status === 'active' && !r.stale).length;
  // Gap 3 (Batch 8.1): سياق تجاري حقيقي (استراتيجية/جمهور/سوق/تاريخ قرارات) يُغذّي
  // قرار العقل المركزي — قراءة فقط من نفس المصدر الكانوني، بلا عقل ثانٍ وبلا اختراع.
  const dc = buildRuntimeDecisionContext({ ...input, now: Date.now() });
  return {
    now: Date.now(),
    task,
    platform,
    comments: input.comments.map((c) => ({ platform: c.platform, externalId: c.externalId, text: c.text, at: c.at ?? null, authorName: c.authorName ?? null })),
    watcher: input.watcher.map((w) => ({ commentId: w.commentId, stage: w.stage, action: w.action ?? null, code: w.code ?? null, at: w.at ?? null, externalReplyId: w.externalReplyId ?? null })),
    connections: input.connections,
    verifiedFacts: (input.verifiedFacts || []).map((f) => ({ id: f.id, statement: f.statement, source: f.source })),
    memoryActive: activeMemory,
    aiAvailable: Boolean(process.env.GEMINI_API_KEY),
    priorSessions: teamSessionState.sessions.length,
    escalationReason: meta.escalationReason ?? null,
    commercialContext: {
      strategyHeadlines: dc.strategies.map((s) => `${s.scope}: ${s.what}`.slice(0, 160)).slice(0, 5),
      audienceHeadlines: dc.audienceSegments.map((s) => `${s.label} (عيّنة ${s.sampleSize})`).slice(0, 5),
      marketHasEvidence: dc.marketHasEvidence,
      priorOutcomeSummaries: dc.priorOutcomes.map((o) => `${o.finalStatus}: ${o.outcomeSummary}`.slice(0, 160)),
      strategyHint: dc.strategyHint,
    },
  };
}

/** قائمة سجلات التصعيد البشري القائمة (نفس المخزن في مساحة العمل). */
function socialEscalationsList(): EscalationRecord[] {
  if (!Array.isArray((workspace as any).socialEscalations)) (workspace as any).socialEscalations = [];
  return (workspace as any).socialEscalations as EscalationRecord[];
}

/** يسجّل تصعيداً بشرياً في **نفس** المخزن القائم ويثبّته (بلا نظام ثانٍ). */
function socialRecordEscalation(record: EscalationRecord): void {
  const list = socialEscalationsList();
  // منع التكرار لنفس التعليق الخارجي ما دام مفتوحاً (نفس قاعدة مسار السوشيال).
  if (record.externalId && list.some((r) => r.externalId === record.externalId && isEscalationOpen(r))) return;
  list.unshift(record);
  if (list.length > 5000) list.length = 5000;
  persistState();
}

/** مُبلِّغ التصعيد للقرارات العقلية — نفس بنية التنبيه القائمة (`pushNotification`). */
function brainEscalationNotifier() {
  return (record: any) => {
    try {
      const n = pushNotification(
        'owner',
        'brain_escalation',
        `تصعيد العقل المركزي: ${record?.reasonLabelAr || record?.reason || 'حالة تحتاج مراجعة'}`,
        `منصة ${record?.platform || 'غير معروفة'} — ${String(record?.commentText || '').slice(0, 200)}`,
        'warning',
      );
      return { delivered: Boolean(n?.id), channel: 'in_app_notification', error: n?.id ? null : 'notification_not_created' };
    } catch (e) {
      return { delivered: false, channel: null, error: e instanceof Error ? e.name : 'notifier_failed' };
    }
  };
}

/**
 * يشتقّ سبب التصعيد البشري من مخرجات الجلسة الحقيقية (بلا اختراع): السعر غير
 * الموثّق / الشكوى / الحساس يُشتقّان من مخرجات الاستراتيجية والنقد؛ وغير ذلك
 * يبقى `manual` عند التصعيد فقط.
 */
function brainEscalationReasonFor(session: TeamSession, opts: { priceFactsVerified?: boolean } = {}): EscalationReason | null {
  const texts = [...session.recommendations, ...session.analyses, ...session.objections].map((o) => o.statement).join(' ');
  if (/شكوى|complaint/i.test(texts)) return 'complaint';
  if (/حسّاس|sensitive|قانوني/i.test(texts)) return 'sensitive';
  if (/سعر|قسط|price/i.test(session.task) || /سعر غير موثّق|price_unverified/i.test(texts)) {
    // استفسار سعر مع حقائق منتج موثّقة فعلاً => لا تصعيد سعر (يُرد من بيانات المعرض).
    return opts.priceFactsVerified ? null : 'price_unverified';
  }
  return 'manual';
}

/** ملخّص آخر قرار للعقل المركزي (بلا سرّ) — للحالة/الجاهزية. */
function lastBrainDecision(): BrainDecision | null {
  for (let i = teamSessionState.sessions.length - 1; i >= 0; i -= 1) {
    const bd = teamSessionState.sessions[i].brainDecision;
    if (bd) return bd;
  }
  return null;
}

/** كتلة صحة قرار العقل المركزي (بلا أي سرّ): الحالة النهائية + الحوكمة + الهرمية. */
function brainDecisionHealthBlock() {
  const bd = lastBrainDecision();
  const s = summarizeBrainDecision(bd);
  return {
    ...s,
    lastDecisionAt: bd?.timestamp ?? null,
    lastFinalStatusLabelAr: bd?.finalStatusLabelAr ?? null,
    hierarchy: 'CENTRAL_BRAIN > AGENT_COUNCIL(6) > GOVERNANCE > ACTION_OR_ESCALATION',
    executesExternalActions: false,
    note: 'العقل المركزي فوق الوكلاء الستة: يقرّر ويمرّر عبر الحوكمة؛ الوكلاء مستشارون فقط ولا ينفّذون.',
  };
}

/**
 * كتلة صحة الطبقة الإدراكية (Batch 7، بلا أي سرّ): حالة الذاكرة العاملة + آخر
 * دورة إدراكية + الحالات. تُعلن أن العقل يفهم/يتذكّر/يخطّط/يتعلّم بلا تنفيذ خارجي.
 */
function cognitionHealthBlock() {
  const wm = summarizeWorkingMemory(workingMemoryState, Date.now());
  const last = cognitiveReports[cognitiveReports.length - 1] || null;
  return {
    workingMemory: wm,
    reports: cognitiveReports.length,
    lastCycleAt: last?.phases[last.phases.length - 1]?.at ?? null,
    lastCycleStatus: last?.status ?? null,
    // الحقول النصّية الحرة (currentObjective/currentGoal.labelAr/nextAction.labelAr) قد
    // تحمل نص تعليق أو هدفاً مشتقاً منه — لذا لا تُعلن في النسخة العامة (تُخدم في
    // /api/health و/api/readiness بلا مصادقة). التفاصيل النصّية للمالك فقط عبر
    // GET /api/agent/brain/cognition/reports. تُبقى الحالات الرمزية غير الحسّاسة هنا.
    lastDecisionState: last?.decisionStatus ?? null,
    lastEscalationState: last?.observability.escalationState ?? null,
    lastMemoryUsed: last?.observability.memoryUsed ?? 0,
    cognitiveLoop: 'PERCEIVE→UNDERSTAND→REMEMBER→REASON→CONSULT→PLAN→CRITIQUE→DECIDE→ACT→OBSERVE→LEARN',
    /** حلقة التعلّم مغلقة: نتيجة ملاحَظة حقيقية => درس => ذاكرة طويلة المدى (بلا ترقية بلا شرط). */
    outcomeFeedbackWired: true,
    learningBridge: 'ACTION→RESULT→FOLLOW-UP→LESSON→MEMORY→FUTURE_DECISION',
    /** ملخّص حلقة التعلّم الحقيقي (بلا ادعاء بيع): كل رقم من سجلات فعلية. */
    learningLoop: (() => {
      const loop = buildCognitionLearningLoop();
      const stageCount = (name: string) => loop.stages.find((s) => s.stage === name)?.count ?? 0;
      return {
        actions: stageCount('ACTION'), results: stageCount('RESULT'), followUp: stageCount('FOLLOW_UP'),
        lessons: stageCount('LESSON'), memory: stageCount('MEMORY'), futureDecisions: stageCount('FUTURE_DECISION'),
        engagementChanged: loop.followUp.engagementChanged,
      };
    })(),
    executesExternalActions: false,
    storesPrivateChainOfThought: false,
    // إعلان التبعية المعمارية: الإدراك قدرة داخلية للعقل المركزي لا عقل ثانٍ.
    subordinateTo: 'central-brain-1',
    independentDecisionAuthority: false,
    brainAuthority: centralBrainAuthorityContract({
      cognitionConsumesBrainContext: true,
      strategyStateOwned: true,
      decisionLedgerOwned: true,
    }),
    strategyState: summarizeStrategyState(strategyState),
    decisionLedger: summarizeDecisionLedger(decisionLedger),
    note: 'الإدراك قدرة داخلية للعقل المركزي: فهم/تذكّر/تخطيط/تعلّم حتمي — لا عقل ثانٍ ولا سلطة قرار، وبلا تنفيذ خارجي وبلا تفكير داخلي خاص وبلا أسرار.',
  };
}

/**
 * يشغّل جلسة فريق على سياق حقيقي، يحفظها (بلا تكرار)، ويكتب قرارها في ذاكرة العقل
 * القائمة عند استيفاء قواعد الصدق. لا ينفّذ أي إجراء خارجي. لا يرمي.
 */
async function runTeamSessionNow(
  trigger: TeamRunOptions['trigger'],
  task: string,
  platform: PlatformId,
  eventIdentity: string,
  meta: { externalId?: string | null; commentText?: string; objective?: string; conversationId?: string | null; escalationReason?: EscalationReason | null; priceFactsVerified?: boolean } = {},
) {
  const nowMs = Date.now();
  const dedupe = `team:${platform}:${String(eventIdentity).trim().toLowerCase().slice(0, 200)}:${String(task).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200)}`;
  const existing = teamSessionState.sessions.find((s) => s.dedupeKey === dedupe) || null;
  const session = runTeamSession(teamContext(task, platform, { escalationReason: meta.escalationReason ?? null }), {
    trigger,
    platform,
    eventIdentity,
    existing,
    now: nowMs,
  });
  // إعادة جلسة موجودة (منع تكرار) => لا عمل مكرر ولا كتابة ذاكرة/قرار/تصعيد مكرر.
  if (existing && existing.teamSessionId === session.teamSessionId) {
    return { session, memoryWritten: existing.memoryWritten, persistenceError: existing.persistence.error, brainDecision: existing.brainDecision };
  }

  // ---- العقل المركزي: يكوّن قراره المحكوم من مخرجات الوكلاء (Batch 6) ----
  // الوكلاء اقترحوا؛ العقل يقرّر ويمرّر عبر الحوكمة ويحدّد الحالة النهائية.
  const conn = platformConnections.get(platform);
  const providerVerified = Boolean(conn && conn.status === 'connected' && conn.providerVerified);
  const replyCapable = capabilityRow(platform as any).states.reply === 'AVAILABLE';
  const publishCapable = capabilityRow(platform as any).states.publish === 'AVAILABLE';
  // موافقة/تفويض المالك للإجراء الخارجي: تفويض تشغيل YouTube الفعّال (نفس بوابة
  // التنفيذ) — ولا يُعمَّم على منصة أخرى (التفويض خاص بـYouTube دائماً).
  const externalApproved = platform === 'youtube'
    && youtubeDelegationCheck('system', { toolId: 'youtube_reply', args: {} }).allowed === true;
  const externalId = meta.externalId ?? (eventIdentity.startsWith('comment:') ? eventIdentity.slice('comment:'.length) : eventIdentity);
  const priceFactsVerified = meta.priceFactsVerified === true;
  const escalationReason = meta.escalationReason ?? brainEscalationReasonFor(session, { priceFactsVerified });
  const activeMemory = brainMemoryStore.records.filter((r) => r.status === 'active' && !r.stale).length;
  const decision = composeBrainDecision({
    session,
    platform,
    eventIdentity,
    objective: meta.objective || task,
    context: { conversationId: meta.conversationId ?? null, sessionMessages: brainRuntimeComments().filter((c) => c.platform === platform).length, memoryActive: activeMemory },
    capabilities: { replyCapable, publishCapable },
    providerVerified,
    externalApproved,
    escalationReason,
    now: nowMs,
  });
  session.brainDecision = decision;
  session.updatedAt = new Date(nowMs).toISOString();

  // التصعيد البشري: يُسجَّل في **نفس** نظام التصعيد القائم عند استحقاقه فقط.
  const escalation = escalateBrainDecision(
    decision,
    { externalId: externalId || null, commentText: meta.commentText || session.task, nowIso: session.updatedAt, notifier: brainEscalationNotifier() },
    {
      list: () => socialEscalationsList(),
      record: (rec) => socialRecordEscalation(rec),
      newId: () => workspaceId('escalation'),
    } as any,
  );

  // سلسلة التدقيق: EVENT → … → GOVERNANCE → OUTCOME (بلا أي سرّ).
  audit('system', 'brain_decision',
    `${decision.finalStatus} · ${decision.governance.code} · ${platform}:${externalId || 'na'} · وكلاء=${decision.consultedAgents.length} · خلاف=${decision.disagreements.length}${escalation.created ? ' · تصعيد=' + (escalation.reason || 'na') : ''}`);

  const up = upsertTeamSession(teamSessionState, session);
  teamSessionState = up.state;
  // قرار الجلسة => ذاكرة العقل القائمة (بلا نظام ثانٍ) عند استيفاء قواعد الصدق.
  const records = teamSessionToMemoryRecords(session);
  let memoryWritten = false;
  let memoryError: string | null = null;
  if (records.length) {
    const seq = persistBrainMemory(records);
    if (seq >= 0) {
      memoryWritten = true;
      session.memoryRecordIds = records.map((r) => r.id);
    } else {
      memoryError = 'memory_not_persisted';
    }
  }
  session.memoryWritten = memoryWritten;
  // ثبات الجلسة نفسها + بصمة الحفظ الصادقة (لا ادّعاء نجاح عند الفشل).
  session.persistence = { ok: storageReady, error: storageReady ? null : 'storage_not_ready' };
  const up2 = upsertTeamSession(teamSessionState, session);
  teamSessionState = up2.state;
  persistTeamSessions();
  return { session, memoryWritten, persistenceError: memoryError ?? session.persistence.error, brainDecision: decision };
}

/**
 * يشغّل دورة إدراكية كاملة (Batch 7) على نتيجة جلسة الفريق والقرار المحكوم:
 * PERCEIVE → … → LEARN. **لا تنفيذ خارجي** ولا استهلاك AI. تُحدِّث الذاكرة العاملة
 * (سياق قصير المدى) وتُخزّن التقرير (بلا تكرار) فتصمد بعد restart. لا ترمي.
 */
function runCognitiveCycleNow(input: {
  session: TeamSession;
  decision: BrainDecision;
  platform: PlatformId;
  eventIdentity: string;
  eventText: string;
  objective: string;
  conversationId: string | null;
  externalId: string | null;
  escalationReason: EscalationReason | null;
  replyCapable: boolean;
  publishCapable: boolean;
  providerVerified: boolean;
  externalApproved: boolean;
}): CognitiveReport {
  const nowMs = Date.now();
  const cls = classifyConversation({ platform: input.platform, externalId: input.eventIdentity, text: input.eventText });
  const verifiedFacts = brainRuntimeInput().verifiedFacts || [];
  // سياق العقل المركزي (Brain 1): الإدراك قدرة داخلية تقرأ الاستراتيجية/الهدف الكانوني.
  let brainBuilt: { state: any; strategies: any[] } | null = null;
  try { brainBuilt = buildRuntimeBrain({ ...brainRuntimeInput(), now: nowMs }) as any; } catch { brainBuilt = null; }
  if (brainBuilt) {
    try {
      const res = updateStrategyState(strategyState, { items: toStrategySnapshot(brainBuilt.strategies as any), now: nowMs, source: 'brain:strategyEngine' });
      if (res.changed) { strategyState = res.state; persistStrategyState(); }
    } catch { /* أفضل جهد */ }
  }
  const brainCtx: CognitiveBrainContext | null = brainBuilt ? brainContextForCognition(brainBuilt) : null;
  const priceUnverified = input.escalationReason === 'price_unverified';
  const hasPendingEscalation = socialEscalationsList().some((r) => r.externalId === input.externalId && isEscalationOpen(r));
  const sessionSummary = {
    consultedAgents: input.session.participants as unknown as string[],
    conflicts: input.session.conflicts,
    truthState: input.session.truthState,
    confidence: input.session.confidence,
    criticFailed: input.session.criticFailed,
    decisionVerified: Boolean(input.session.decision?.verified),
    decisionStatement: input.session.decision?.statement || '',
    decisionLimitations: input.session.decision?.limitations || [],
    decisionProposedAction: input.session.decision?.proposedAction || '',
    finalStatus: input.decision.finalStatus,
    escalationReason: input.decision.escalation.reason ?? null,
  };
  const report = buildCognitiveCycle({
    now: nowMs,
    platform: input.platform,
    eventIdentity: input.eventIdentity,
    context: {
      now: nowMs,
      platform: input.platform,
      eventIdentity: input.eventIdentity,
      eventText: input.eventText,
      objective: input.objective,
      surfaceKind: 'comment',
      conversationId: input.conversationId,
      sessionMessages: brainRuntimeComments().filter((c) => c.platform === input.platform).length,
      windowSize: 0,
      windowTruncated: false,
      lastActivityAt: input.session.updatedAt,
      previousDiscussion: null,
      evidence: input.session.evidence.slice(0, 20),
      unknown: input.session.truthState === 'UNKNOWN' || input.session.truthState === 'UNAVAILABLE' ? ['لا دليل كافٍ بعد.'] : [],
      unavailable: ['مؤشرات الجمهور السكانية غير متاحة عبر الواجهات الرسمية.'],
      referencedObjectIds: input.conversationId ? [input.conversationId] : [],
      relevantMarketingContext: verifiedFacts.slice(0, 5).map((f) => f.statement),
      requiredNextDecision: 'تحديد الإجراء التالي (رد/متابعة/تصعيد) من الأدلة.',
    },
    memoryStore: brainMemoryStore,
    session: sessionSummary as any,
    capabilities: { replyCapable: input.replyCapable, publishCapable: input.publishCapable, providerVerified: input.providerVerified, externalApproved: input.externalApproved },
    event: {
      category: cls.category as any,
      topic: cls.topic as unknown as string | null,
      priceUnverified,
      hasContentOpportunity: cls.category === 'content_request' || cls.category === 'feature_request',
      needsClarification: cls.category === 'question',
      hasPendingEscalation,
      isSpam: cls.category === 'spam',
    },
    observations: [],
    brain: brainCtx,
  });
  // الذاكرة العاملة: سياق قصير المدى فقط (بلا ترقية تلقائية طويلة المدى).
  const wmKey = input.conversationId || `${input.platform}::${input.eventIdentity}`;
  workingMemoryState = touchWorkingMemory(workingMemoryState, {
    conversationId: wmKey,
    platform: input.platform,
    objective: input.objective,
    lastCustomerMessage: input.eventText.slice(0, 300),
    previousRelevantMessages: [],
    unresolvedQuestion: report.nextAction.kind === 'ask_clarification' || priceUnverified ? input.eventText.slice(0, 200) : null,
    pendingEscalationReason: hasPendingEscalation ? (input.escalationReason ?? 'manual') : null,
    lastDecisionSummary: `${report.nextAction.labelAr}: ${input.decision.finalStatusLabelAr}`,
    lastConsultedAgents: input.session.participants as unknown as string[],
    messageCount: 0,
    lastActivityAt: input.session.updatedAt,
    nowIso: new Date(nowMs).toISOString(),
  });
  recordCognitiveReport(report);
  persistCognition();
  // سجل قرار→نتيجة: قرار مركزي واحد حقيقي (السلطة الواحدة) مربوط بذاكرته/تصعيده.
  // النتيجة تبدأ غير متاحة صراحةً حتى تُلاحظ (لا اختراع).
  recordCentralDecision({
    decision: input.decision,
    platform: input.platform,
    eventIdentity: input.eventIdentity,
    actionText: report.nextAction.labelAr,
    memoryRecordIds: (input.session.memoryRecordIds || []) as string[],
    escalationExternalId: input.externalId,
  });
  return report;
}

// -----------------------------------------------------------------------------
// العقل المركزي — وقت تشغيل 24/7 (Batch 5).
//
// مُشغِّل داخلي على الخادم يبني العقل من بيانات الإنتاج الحقيقية، يحوّل أحداث
// التعلّم إلى ذاكرة دائمة، ويحفظها عبر **نفس** مسار الحفظ القائم
// (`persistBrainMemory`) — بلا نظام ذاكرة ثانٍ ولا جدول جديد. مستقل عن المتصفح.
//
// الأمان: قفل/lease واحد يمنع أي دورة متوازية، ويُستردّ المتقادم فلا جمود دائم.
// لا إجراء خارجي ولا استهلاك Gemini (الدورة تحليل/تعلّم/حفظ فقط). الحالة تُحفظ عبر
// محوّل الحالة (Postgres/ملف) في مفتاح `control` فتصمد بعد restart/deploy.
// -----------------------------------------------------------------------------

/** حالة وقت التشغيل المحفوظة (بلا أي سرّ) + قفل الدورة. */
let brainRuntimeState: BrainRuntimeState = emptyBrainRuntimeState();

/** قفل داخل العملية يمنع محاولة دورة ثانية أثناء جريانها (دفاع إضافي فوق الـlease). */
let brainRuntimeInFlight = false;
let brainRuntimeTimer: NodeJS.Timeout | null = null;
let brainRuntimeBootTimer: NodeJS.Timeout | null = null;
const BRAIN_RUNTIME_BOOT_DELAY_MS = 90 * 1000; // فحص إقلاع بعد 90 ثانية (لا فور الإقلاع)
/** بصمة فريدة لهذه العملية (لا تتكرر): تمنع استيلاء نسخة أخرى على القفل الحي. */
const BRAIN_RUNTIME_OWNER = `brain-${process.pid}-${Date.now().toString(36)}`;

function brainRuntimeIntervalMs(): number {
  return resolveBrainRuntimeIntervalMs(process.env as Record<string, string | undefined>);
}
function brainRuntimeLockTtlMs(): number {
  return resolveBrainLockTtlMs(process.env as Record<string, string | undefined>);
}
function brainRuntimeEnabled(): boolean {
  return resolveBrainRuntimeEnabled(process.env as Record<string, string | undefined>);
}

/** يحفظ حالة وقت التشغيل عبر محوّل الحالة (تصمد بعد restart). */
function persistBrainRuntimeState(): void {
  if (!storageReady) return;
  persistQueue = persistQueue
    .then(() => storageAdapter.write(STORAGE_KEY_CONTROL, buildControlState()))
    .catch((error: any) => {
      lastPersistError = String(error?.code || error?.name || "persist_failed").slice(0, 60);
      console.warn("Could not persist brain runtime state:", lastPersistError);
    });
}

/**
 * دورة عقل واحدة عبر المُشغِّل الداخلي. تستخدم منطق العقل القائم
 * (`buildRuntimeBrain`) ومسار الحفظ القائم (`persistBrainMemory`) حرفياً — بلا
 * تجاوز. لا تُرمي، وتُفرج القفل دائماً.
 */
async function runBrainRuntimeCycleInternal(trigger: "scheduled" | "boot" | "manual" = "scheduled") {
  const out = await runBrainRuntimeCycle(
    {
      now: () => Date.now(),
      isEnabled: () => brainRuntimeEnabled(),
      lockTtlMs: () => brainRuntimeLockTtlMs(),
      owner: () => BRAIN_RUNTIME_OWNER,
      getState: () => brainRuntimeState,
      setState: (next) => { brainRuntimeState = next; persistBrainRuntimeState(); },
      isInFlight: () => brainRuntimeInFlight,
      setInFlight: (v) => { brainRuntimeInFlight = v; },
      build: () => {
        const built = buildRuntimeBrain({ ...brainRuntimeInput(), now: Date.now() });
        // مزامنة حالة الاستراتيجية (يملكها العقل المركزي): تُحدَّث عند تغيّر فعلي فقط.
        try {
          const res = updateStrategyState(strategyState, { items: toStrategySnapshot(built.strategies as any), now: Date.now(), source: 'brain:strategyEngine' });
          if (res.changed) { strategyState = res.state; persistStrategyState(); }
        } catch { /* أفضل جهد */ }
        // Gap 2 (Batch 8.1): قراءة السجل تُغذّي الذاكرة — سجلات القرار→النتيجة ذات
        // النتيجة الملاحَظة الحقيقية فقط تُرحَّل إلى ذاكرة العقل القائمة (بلا نظام
        // ثانٍ؛ منع التكرار عبر معرّف ثابت في persistBrainMemory).
        const decisionMem = decisionHistoryToMemoryRecords(decisionLedger, Date.now());
        const byId = new Map<string, BrainMemoryRecord>();
        for (const r of [...built.newMemoryRecords, ...decisionMem]) byId.set(r.id, r);
        return {
          newMemoryRecords: [...byId.values()],
          learningEventsCount: built.learningEvents.length,
          memoryTotal: brainMemoryStore.records.length,
        };
      },
      persist: async (records) => {
        // مسار الحفظ القائم: `persistBrainMemory` يدرج بلا تكرار ثم يحفظ عبر الطابور،
        // ويعيد تسلسل الكتابة. ننتظر تفريغ الطابور ثم نحكم على **كتابتنا** وحدها
        // (brainMemoryLastErrorSeq === mySeq) فلا يتأثر الحكم بفشل كتابة أخرى.
        const before = brainMemoryStore.records.length;
        const mySeq = persistBrainMemory(records);
        const after = brainMemoryStore.records.length;
        if (mySeq < 0) {
          // لم تُجدول كتابة: إما لا سجلات جديدة (يُعالَج قبل الاستدعاء) أو المخزن غير جاهز.
          return storageReady
            ? { ok: true, added: Math.max(0, after - before), total: after }
            : { ok: false, added: 0, total: after, error: 'storage_not_ready' };
        }
        try {
          await persistQueue;
        } catch (err: any) {
          return { ok: false, added: 0, total: after, error: String(err?.code || err?.name || 'persist_failed').slice(0, 60) };
        }
        if (brainMemoryLastErrorSeq === mySeq) {
          return { ok: false, added: 0, total: after, error: lastPersistError || 'persist_failed' };
        }
        return { ok: true, added: Math.max(0, after - before), total: after };
      },
    },
    trigger,
  );
  return out;
}

/** لقطة حالة وقت التشغيل الصادقة (بلا سرّ) للصحة/الجاهزية. */
function brainRuntimeStatus() {
  return buildBrainRuntimeStatus(brainRuntimeState, Date.now(), brainRuntimeIntervalMs(), {
    enabled: brainRuntimeEnabled(),
    scheduled: brainRuntimeTimer !== null,
    running: brainRuntimeInFlight,
  });
}

/** يبدأ المؤقّت الداخلي (مرة واحدة). `.unref()` يمنع تعليق الإغلاق النظيف. */
function startBrainRuntime(): void {
  if (brainRuntimeTimer) return;
  const intervalMs = brainRuntimeIntervalMs();
  const tickMs = Math.max(60 * 1000, Math.min(BRAIN_RUNTIME_TICK_MS, intervalMs));
  brainRuntimeTimer = setInterval(() => {
    const lastRunAtMs = (() => { const t = Date.parse(String(brainRuntimeState.lastCycleStartedAt || "")); return Number.isFinite(t) ? t : null; })();
    if (!isBrainRuntimeDue(lastRunAtMs, Date.now(), intervalMs)) return; // لا دورة إلا عند الاستحقاق
    void runBrainRuntimeCycleInternal("scheduled").catch(() => { /* الخطأ مسجَّل داخل الدورة */ });
  }, tickMs);
  if (typeof (brainRuntimeTimer as any).unref === "function") (brainRuntimeTimer as any).unref();
  // فحص إقلاع واحد: بعد restart لا تُنفَّذ دورة فوراً إن لم يحل الموعد (لا تكرار)؛
  // وإن كان الموعد قد حلّ أثناء التوقّف تُنفَّذ دورة واحدة فقط.
  brainRuntimeBootTimer = setTimeout(() => {
    brainRuntimeBootTimer = null;
    void runBrainRuntimeCycleInternal("boot").catch(() => { /* لا يُسقط العملية */ });
  }, BRAIN_RUNTIME_BOOT_DELAY_MS);
  if (typeof (brainRuntimeBootTimer as any).unref === "function") (brainRuntimeBootTimer as any).unref();
  console.log(`[الغرابي AI] Central Brain runtime scheduled every ${Math.round(intervalMs / 60000)} min (tick ${Math.round(tickMs / 60000)} min)`);
}

function stopBrainRuntime(): void {
  if (brainRuntimeTimer) { clearInterval(brainRuntimeTimer); brainRuntimeTimer = null; }
  if (brainRuntimeBootTimer) { clearTimeout(brainRuntimeBootTimer); brainRuntimeBootTimer = null; }
}

/** مسار المالك: تشغيل دورة الآن (تشخيص) — بلا تجاوز للقفل/التمكين. */
app.post("/api/agent/brain/runtime/run", authenticateToken, requireOwner, async (_req, res) => {
  const result = await runBrainRuntimeCycleInternal("manual");
  res.status(result.status === "FAILED" ? 500 : 200).json({ success: result.status !== "FAILED", result, runtime: brainRuntimeStatus() });
});

/** حالة وقت التشغيل (للمالك فقط: لا سرّ، لكنها تفاصيل تشغيلية). */
app.get("/api/agent/brain/runtime", authenticateToken, requireOwner, (_req, res) => {
  res.json({ success: true, runtime: brainRuntimeStatus() });
});

/**
 * يقارن بصمة توكن المعاينة الحالي بالمحفوظة. عند اختلافهما (تغيير التوكن)
 * يُرفع الختم الزمني فتُبطل كل جلسات المعاينة الصادرة قبله، ثم تُحفظ البصمة
 * الجديدة. لا يفعل شيئاً إن كان التوكن غير مضبوط أو لم يتغيّر.
 */
function reconcilePreviewTokenEpoch(): void {
  const currentHash = hashPreviewToken(process.env.GHARABI_PREVIEW_TOKEN || "");
  if (!currentHash) return;
  if (previewControl.tokenHash === currentHash) return;
  // تغيّر التوكن (أو أول إقلاع): ارفع الختم فقط إن كان هناك توكن سابق فعلاً.
  if (previewControl.tokenHash && previewControl.tokenHash !== currentHash) {
    previewEpoch.value = Date.now();
  }
  previewControl.tokenHash = currentHash;
  saveControlState();
}

function loadUsage() {
  const raw = storageAdapter.readSync<any>(STORAGE_KEY_USAGE);
  if (raw?.day === geminiUsageDay && Number.isFinite(raw?.count)) geminiUsageCount = Math.max(0, Number(raw.count));
}
function saveUsage() {
  void storageAdapter.write(STORAGE_KEY_USAGE, { day: geminiUsageDay, count: geminiUsageCount }).catch(() => { /* حارس محلي: فشل الحفظ لا يُسقط الخدمة */ });
}
loadUsage();
// حارس حصة YouTube: يُستَرجع عدّاده وأعلام تنبيهاته عند الإقلاع فيصمد بعد restart.
loadYouTubeQuota();

function rateLimitAI(userId: string): boolean {
  const now = Date.now();
  const item = requestWindow.get(userId);
  if (!item || now - item.startedAt >= 60_000) {
    requestWindow.set(userId, { startedAt: now, count: 1 });
    return true;
  }
  if (item.count >= 8) return false;
  item.count += 1;
  return true;
}

// Lightweight housekeeping: bound in-memory request/session maps so a long-lived
// process does not grow without limit. No external calls and no Gemini usage.
// SEC-04: بعض القوائم كانت تنمو بلا حد (جلسات OAuth معلّقة لكل state، وذاكرة
// فحص بدء OAuth لكل منصة، ونوافذ معدّل عمليات YouTube لكل نوع). كلها الآن
// مقيّدة بـTTL صريح مطابق لعمرها الفعلي. لا نحذف قوائم الإبطال (revokedSessions/
// userRevocations) بالتقييد العددي لأنها مصدر صلاحية أمني لا يجوز إسقاطه.
function cleanupRuntimeState() {
  const now = Date.now();
  for (const [sid, exp] of revokedSessions) if (exp < now) revokedSessions.delete(sid);
  for (const [email, exp] of consumedChallenges) if (exp < now) consumedChallenges.delete(email);
  for (const [token, session] of activeSessions) if (session.expiresAt < now) activeSessions.delete(token);
  for (const [userId, window] of requestWindow) if (now - window.startedAt >= 60_000) requestWindow.delete(userId);
  for (const [key, window] of challengeWindow) if (now - window.startedAt >= RATE_WINDOW_TTL_MS) challengeWindow.delete(key);
  for (const [key, window] of authAttemptWindow) if (now - window.startedAt >= RATE_WINDOW_TTL_MS) authAttemptWindow.delete(key);
  // جلسات OAuth المعلّقة تنتهي بصلاحيتها، والذاكرة التشخيصية لبدء OAuth بـTTL قصير.
  for (const [state, pending] of pendingOAuth) if (pending.expiresAt < now) pendingOAuth.delete(state);
  for (const [platform, entry] of oauthStartPreflightCache) if (now - entry.at >= OAUTH_PREFLIGHT_TTL_MS) oauthStartPreflightCache.delete(platform);
  for (const [platform, entry] of lastOAuthPreflight) if (now - entry.at >= OAUTH_PREFLIGHT_TTL_MS) lastOAuthPreflight.delete(platform);
  for (const [key, list] of youtubeOperationWindows) {
    const windowMs = Math.max(1000, Number(process.env.YOUTUBE_OP_RATE_WINDOW_MS || 60_000));
    const live = list.filter((t) => now - t < windowMs);
    if (live.length) youtubeOperationWindows.set(key, live);
    else youtubeOperationWindows.delete(key);
  }
  aiEngine.pruneCache();
}
const runtimeCleanupTimer = setInterval(safeTimerCallback(cleanupRuntimeState, "runtime-cleanup"), 5 * 60 * 1000);
(runtimeCleanupTimer as any).unref?.();

function requestKey(req: express.Request): string {
  const supplied = typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'].trim() : '';
  return supplied.slice(0, 120);
}

function findRecentJobByIdempotency(userId: string, key: string) {
  if (!key) return null;
  return automationJobs.find((j: any) => j.createdBy === userId && j.payload?.idempotencyKey === key && Date.now() - new Date(j.createdAt).getTime() < 24 * 60 * 60 * 1000) || null;
}

function ensureBackupDirectory() {
  try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}
}

// النسخ الاحتياطية اليومية مسؤولية المخزن: ملف محلي بحفظ 7 أيام، أو Postgres
// (نسخ وdurability على مستوى القاعدة). لا منطق نسخ مكرر هنا.

function buildPersistedState() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    users: serverUsers,
    audit: auditLog.slice(0, 200),
    jobs: automationJobs.slice(0, 200),
    // إبطال الجلسات يُحفظ ليبقى سارياً في كل العمليات. منتهية الصلاحية تُستبعد.
    revokedSessions: Array.from(revokedSessions.entries())
      .filter(([, exp]) => exp > Date.now())
      .slice(-500)
      .map(([sid, exp]) => ({ sid, exp })),
    // أختام إبطال المستخدمين — الإبطال الجماعي يبقى سارياً بعد إعادة التشغيل.
    userRevocations: Array.from(userRevocationEpoch.entries())
      .slice(-500)
      .map(([userId, at]) => ({ userId, at })),
    platformConnections: Array.from(platformConnections.values()),
    workspace: {
      showroom: workspace.showroom,
      products: workspace.products.slice(0, 1000),
      posts: workspace.posts.slice(0, 1000),
      conversations: workspace.conversations.slice(0, 1000),
      installmentPlans: workspace.installmentPlans.slice(0, 200),
      leads: workspace.leads.slice(0, 2000),
      tasks: workspace.tasks.slice(0, 1000),
      sales: workspace.sales.slice(0, 5000),
      payments: workspace.payments.slice(0, 10000), suppliers: workspace.suppliers.slice(0, 1000), purchases: workspace.purchases.slice(0, 5000), expenses: workspace.expenses.slice(0, 10000), contracts: workspace.contracts.slice(0, 5000), installmentSchedules: workspace.installmentSchedules.slice(0, 20000), marketingBriefs: (workspace as any).marketingBriefs.slice(0, 2000), marketingCampaigns: (workspace as any).marketingCampaigns.slice(0, 1000),
      // سجلات مخزون/إشعارات/أحداث المزود: تُحمَّل عند الإقلاع فيجب حفظها أيضاً وإلا فُقدت عند restart.
      inventoryMovements: (workspace as any).inventoryMovements.slice(0, 20000), notifications: (workspace as any).notifications.slice(0, 10000), webhookEvents: (workspace as any).webhookEvents.slice(0, 10000), providerEvents: (workspace as any).providerEvents.slice(0, 10000),
      // سجلات مدير السوشيال ميديا: بدونها لا تصمد حماية replay/duplicate بعد restart.
      socialComments: (workspace as any).socialComments.slice(0, 10000),
      socialReplies: (workspace as any).socialReplies.slice(0, 5000), socialApprovals: (workspace as any).socialApprovals.slice(0, 5000), publishRecords: (workspace as any).publishRecords.slice(0, 5000), performanceRecords: (workspace as any).performanceRecords.slice(0, 20000), marketingDecisions: (workspace as any).marketingDecisions.slice(0, 2000), strategiesTested: (workspace as any).strategiesTested.slice(0, 2000),
      // نوافذ المحادثة قصيرة المدى (منصة+خيط): تصمد بعد restart وتُغذّي عزل السياق.
      socialConversations: ((workspace as any).socialConversations || []).slice(0, 500),
      // تصعيدات بشرية ودورة حياة المحادثات: تصمد بعد restart (تمنع إغلاقاً مع تصعيد معلّق).
      socialEscalations: ((workspace as any).socialEscalations || []).slice(0, 5000),
      socialConversationStates: ((workspace as any).socialConversationStates || []).slice(0, 500),
      // معرّفات تحديثات Telegram لصمود منع التكرار بعد restart (يمنع إعادة معالجة رسالة).
      telegramUpdateIds: ((workspace as any).telegramUpdateIds || []).slice(0, 20000),
      // معرّفات أحداث Facebook الواردة لصمود منع التكرار بعد restart.
      facebookEventIds: ((workspace as any).facebookEventIds || []).slice(0, 20000),
      instagramEventIds: ((workspace as any).instagramEventIds || []).slice(0, 20000),
      tiktokEventIds: ((workspace as any).tiktokEventIds || []).slice(0, 20000),
      // معرّفات تعليقات YouTube الواردة (لمنع إعادة إدخال نفس التعليق) ومفاتيح
      // idempotency لعمليات YouTube (لمنع تكرار الرفع/النشر/الرد) — تصمد بعد restart.
      youtubeCommentIds: ((workspace as any).youtubeCommentIds || []).slice(0, 20000),
      youtubeOperationKeys: ((workspace as any).youtubeOperationKeys || []).slice(0, 20000),
      providerTokens: (workspace as any).providerTokens,
    }
  };
}

/**
 * كتابة ذرّية عبر المخزن. تُسلسَل الكتابات لمنع تراكبها، وأي فشل يُسجَّل بصراحة
 * ويُعلَن في /api/health بدل الادعاء بأن الحالة محفوظة.
 */
let persistQueue: Promise<void> = Promise.resolve();
let lastPersistError: string | null = null;

function persistState(): void {
  // لا كتابة قبل جهوزية المخزن: كتابة لقطة فارغة فوق حالة قائمة أسوأ من عدم الكتابة.
  if (!storageReady) {
    lastPersistError = storageInitError || "storage_not_ready";
    return;
  }
  persistQueue = persistStateNow();
}

/**
 * كتابة تُنتظر قبل الرد. تُستخدم في مسارات الاستقبال الخارجي (webhook Telegram)
 * حيث قد تُعلَّق العملية بعد إرجاع الاستجابة، فلو أُرسلت fire-and-forget لفُقد
 * الحدث قبل وصوله للمخزن الدائم (فسقوط حماية التكرار).
 */
function persistStateDurable(): Promise<void> {
  persistState();
  return persistQueue;
}

/**
 * يبني مهمة كتابة الحالة الحالية ويضعها في الطابور ويُعيدها.
 * العمليات الحسّاسة (إنشاء جلسة، إبطال، استهلاك OTP) تنتظر هذه المهمة قبل
 * اعتبار الطلب ناجحاً، فلا يُعاد توكن قبل أن تصل حالته إلى المخزن الدائم.
 */
function persistStateNow(): Promise<void> {
  const snapshot = buildPersistedState();
  return persistQueue
    .then(() => storageAdapter.write(STORAGE_KEY_STATE, snapshot))
    .then(() => { lastPersistError = null; })
    .catch((error: any) => {
      lastPersistError = String(error?.code || error?.name || "persist_failed").slice(0, 60);
      console.warn("Could not persist server state:", lastPersistError);
    });
}

function audit(userId: string, action: string, detail?: string) {
  auditLog.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), userId, action, detail });
  if (auditLog.length > 100) auditLog.pop();

  persistState();
}

/**
 * كتابة حسّاسة تُنتظر قبل اعتبار العملية ناجحة (إنشاء جلسة، إبطال، استهلاك
 * OTP). تُثبّت لقطة الحالة وحالة التحكّم معاً (نافذة OTP المُستهلكة، بصمة
 * توكن المعاينة)، فلا يُعاد توكن أو تُعلن نجاح إبطال قبل استقرارها في المخزن.
 */
function persistCritical(): Promise<void> {
  persistState();
  saveControlState();
  return persistQueue;
}

// تاريخ الاستخدام يُصفَّر عند تغيّر اليوم. يُنادى من كل عملية حماية.
function rollUsageDayIfNeeded(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== geminiUsageDay) {
    geminiUsageDay = today;
    geminiUsageCount = 0;
    aiLedger.resetDaily();
    saveUsage();
  }
}

/**
 * هل يُسمح بطلب مزود الآن؟ **جدار الحماية المركزي**:
 * - عند إيقاف الحماية صراحةً من المالك (`GEMINI_FREE_TIER_PROTECTION=false`)
 *   يبقى الحارس اليومي فعّالاً أيضاً: لا مسار يستهلك حصة بلا حد.
 * - عند تفعيل الحماية (الافتراضي) الحد المحلي الصارم مطبَّق على كل المنصات.
 */
function canUseGemini(): boolean {
  rollUsageDayIfNeeded();
  return geminiUsageCount < GEMINI_DAILY_LIMIT;
}

/** الحارس المحلي الذي يستهلكه محرك الذكاء الاصطناعي — واحد للمشروع كله. */
const aiUsageGuard: AiUsageGuard = {
  canConsume: () => canUseGemini(),
  consume: () => {
    rollUsageDayIfNeeded();
    if (geminiUsageCount >= GEMINI_DAILY_LIMIT) return false;
    geminiUsageCount += 1;
    saveUsage();
    return true;
  },
  release: () => {
    geminiUsageCount = Math.max(0, geminiUsageCount - 1);
    saveUsage();
  },
  status: () => ({
    usedToday: geminiUsageCount,
    limit: GEMINI_DAILY_LIMIT,
    remaining: Math.max(0, GEMINI_DAILY_LIMIT - geminiUsageCount),
    enabled: Boolean(process.env.GEMINI_API_KEY),
    protectionEnabled: GEMINI_FREE_TIER_PROTECTION,
  }),
};

/**
 * محرك الذكاء الاصطناعي المركزي: المزود → الحارس → المهلة → إعادة المحاولة
 * → التخزين المؤقت → البديل الحتمي. تعطل المزود لا يُسقط أي مسار في النظام.
 */
const aiEngine = new AiEngine({
  provider: createGeminiProvider(process.env.GEMINI_API_KEY, AI_TIMEOUT_MS),
  guard: aiUsageGuard,
  models: resolveModelCandidates(process.env.GEMINI_MODEL),
  cacheTtlMs: 10 * 60 * 1000,
  timeoutMs: AI_TIMEOUT_MS,
  breaker: new CircuitBreaker(3, 60_000),
  ledger: aiLedger,
  maxPromptChars: DEFAULT_MAX_PROMPT_CHARS,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  onEvent: (event) => { aiEvents.push({ at: new Date().toISOString(), ...event }); if (aiEvents.length > 200) aiEvents.shift(); },
});

/** حالة قاطع الدائرة الحقيقية من المحرك. */
function aiEngineBreakerSnapshot() {
  return aiEngine.breakerStatus();
}

/**
 * حالة مزود الذكاء الاصطناعي بتمييز صريح بين:
 * configured (المفتاح موجود) / reachable+modelValid (أُثبت بطلب حقيقي) / fallback.
 * لا يُعلن «جاهز» بمجرد وجود مفتاح؛ الإثبات يحتاج نتيجة طلب فعلي هذا التشغيل.
 */
function aiProviderState() {
  const keyPresent = Boolean(process.env.GEMINI_API_KEY);
  return {
    configured: aiEngine.providerConfigured,
    keyPresent,
    /** هل أُثبت الوصول والموديل بطلب حقيقي ناجح خلال هذا التشغيل؟ */
    verifiedLive: aiLiveVerification.state === 'ok',
    verification: aiLiveVerification.state,
    verificationDetail: aiLiveVerification.detail,
    verifiedModel: aiLiveVerification.model,
    verifiedAt: aiLiveVerification.at,
    /** فئة الفشل الفعلية وتوجيهها الأمين — لتمييز عطل المزود عن خطأ المفتاح. */
    verificationErrorKind: aiLiveVerification.errorKind,
    verificationHint: aiLiveVerification.hint,
    fallbackAvailable: true,
    note: !keyPresent
      ? 'GEMINI_API_KEY غير مضبوط؛ يعمل النظام بالمحرك الحتمي فقط دون أي اتصال بمزود.'
      : aiLiveVerification.state === 'ok'
        ? 'أُثبت الاتصال والموديل بطلب حقيقي ناجح.'
        : 'المفتاح موجود لكن لم يُثبت الاتصال بطلب حقيقي بعد؛ لا يُعلن المزود جاهزاً قبل الإثبات.',
  };
}

/** نتيجة آخر تحقق حي من المزود — لا تُعلن نجاحاً بدون طلب فعلي. */
const aiLiveVerification: {
  state: 'not_attempted' | 'ok' | 'failed' | 'skipped_no_key' | 'blocked_by_guard';
  detail: string | null;
  model: string | null;
  at: string | null;
  /** فئة الخطأ الحقيقية عند الفشل، لتمييز عطل المزود عن خطأ المفتاح. */
  errorKind: string | null;
  /** توجيه تشخيصي أمين يطابق الفئة الفعلية — بلا أي سر. */
  hint: string | null;
} = { state: 'not_attempted', detail: null, model: null, at: null, errorKind: null, hint: null };

// استرجاع نتيجة آخر تحقق حي محفوظة (إن وُجدت): يُطبَّق مرة واحدة بعد جهوزية المخزن.
// التحقق يستهلك طلباً من الحصة، فلا يُعاد بلا داعٍ بعد كل restart/cold start.
let aiLiveVerificationHydrated = false;
function hydrateAiLiveVerificationFromDurable(): void {
  if (aiLiveVerificationHydrated) return;
  aiLiveVerificationHydrated = true;
  const saved = aiLiveVerificationState.snapshot();
  if (!saved) return;
  aiLiveVerification.state = saved.state;
  aiLiveVerification.detail = saved.detail;
  aiLiveVerification.model = saved.model;
  aiLiveVerification.at = saved.at;
  aiLiveVerification.errorKind = saved.errorKind;
  aiLiveVerification.hint = saved.hint;
}
/** يثبّت نتيجة التحقق الحي في المخزن الدائم (تصمد بعد restart) ثم يحفظ الحالة. */
function persistAiLiveVerification(): void {
  aiLiveVerificationState.capture({
    state: aiLiveVerification.state, detail: aiLiveVerification.detail, model: aiLiveVerification.model,
    at: aiLiveVerification.at, errorKind: aiLiveVerification.errorKind, hint: aiLiveVerification.hint,
  });
  saveControlState();
}

/**
 * توجيه تشخيصي أمين حسب الفئة الفعلية للخطأ.
 *
 * سبب وجوده: كان الفشل يعرض دائماً «راجع صلاحية GEMINI_API_KEY» حتى عند خطأ
 * ضغط (503) أو تجاوز حصة (429)، فيُوهم المالك بمشكلة مفتاح لا وجود لها.
 * الآن يتطابق التوجيه مع الفئة المرصودة فعلاً، والمفتاح يبقى المشتبه به
 * الوحيد في فئة المصادقة فقط.
 */
function verificationHintFor(info: AiErrorInfo): string {
  switch (info.kind) {
    case 'auth':
      return 'المفتاح مرفوض من المزود: راجع صلاحية GEMINI_API_KEY في بيئة الخادم (لا تُرسل المفتاح في المحادثة).';
    case 'invalid_request':
      return 'المزود رفض شكل الطلب (invalid_request): راجع بناء الطلب/الموديل، وليس المفتاح.';
    case 'not_found':
      return `الموديل ${PRODUCTION_MODEL} غير متاح لهذا الحساب (404): حدّث GEMINI_MODEL إلى معرّف GA متاح.`;
    case 'rate_limited':
      return 'تجاوزت حصة الحساب لدى المزود (429): السبب حصة المزود/الفوترة، وليس الكود ولا المفتاح. أعد الفحص بعد انتهاء النافذة أو راجع خطة Gemini.';
    case 'unavailable':
      return 'الموديل الإنتاجي مشغول لدى المزود (503/504) ولا علاقة للمفتاح أو الكود بذلك. أعد الفحص بعد قليل؛ المزود يوجّه الطلبات تلقائياً للموديلات البديلة عند توفرها.';
    case 'timeout':
      return 'تجاوز الطلب المهلة: المزود لم يستجب خلال 30 ثانية. أعد المحاولة؛ لا صلة للمفتاح بذلك.';
    case 'network':
      return 'تعذر الوصول إلى مزود Google من الخادم (شبكة/تجاوز حمل): راجع الاتصال، وليس المفتاح.';
    case 'blocked':
      return 'حجب المزود الاستجابة وفق سياساته؛ جرّب مدخلاً مختلفاً.';
    default:
      return 'فشل غير مصنّف من المزود. أعد الفحص، وإن تكرر فراجع سجلات المزود.';
  }
}

function geminiStatus() {
  const status = aiUsageGuard.status();
  return {
    enabled: status.enabled,
    configured: aiEngine.providerConfigured,
    providerState: aiProviderState(),
    usedToday: status.usedToday,
    dailyGuard: status.limit,
    remainingByGuard: status.remaining,
    /**
     * سياسة الحد المحلي (بلا سرّ): القيمة المطبَّقة، الحدّ الآمن الأعلى، ومصدرها.
     * تُظهر للمالك بوضوح أن السقف رُفع متحفظاً وأن الحارس ما زال فعّالاً.
     */
    limitPolicy: {
      envName: GEMINI_LIMIT_INFO.envName,
      state: GEMINI_LIMIT_INFO.state,
      defaultLimit: GEMINI_LIMIT_DEFAULT,
      maxSafe: GEMINI_LIMIT_MAX_SAFE,
      configuredRaw: GEMINI_LIMIT_INFO.configuredRaw,
      note: "حدّ حماية محلي متحفظ (ليس حصة Google). يُضبط بـ GEMINI_DAILY_LIMIT ويُقصّ عند الحد الآمن.",
    },
    /** حالة جدار الحماية المركزي وعدّادات التشخيص (بلا أي سرّ). */
    firewall: buildUsageDiagnostics({
      counters: aiLedger.snapshot(),
      last: aiLedger.lastProvider(),
      usedToday: status.usedToday,
      limit: status.limit,
      protectionEnabled: Boolean(status.protectionEnabled),
      providerConfigured: aiEngine.providerConfigured,
      providerVerified: aiLiveVerification.state === 'ok',
    }),
    // سياسة الموديل كاملة: موديل الإنتاج، المرشحون، وموديل البيئة المرفوض إن وُجد.
    modelPolicy: describeModelPolicy(process.env.GEMINI_MODEL),
    modelCandidates: resolveModelCandidates(process.env.GEMINI_MODEL),
    breaker: aiEngineBreakerSnapshot(),
    cachedEntries: aiEngine.cacheSize,
    timeoutMs: AI_TIMEOUT_MS,
    promptLimit: { maxPromptChars: DEFAULT_MAX_PROMPT_CHARS, maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS },
    note: "أرقام حماية محلية داخل هذا الخادم وليست حصة مزود الخدمة.",
  };
}



// Owner-only system diagnostics and durable-state export. No secrets or Gemini keys are included.
app.get("/api/system/integrity", requireOwner, (_req, res) => {
  const status = storageStatus();
  // stateFile يحتفظ بمعناه التاريخي: هل المخزن مهيّأ وقابل للاستخدام.
  const stateUsable = storageAdapter.backend === "file" ? fs.existsSync(path.join(STATE_DIR, ".gharabi-state.json")) || status.writable : status.healthy;
  const checks = {
    stateFile: stateUsable,
    stateWritable: status.writable,
    ownerConfigured: Boolean(OWNER_EMAIL),
    googleAudienceCheckConfigured: Boolean(GOOGLE_CLIENT_ID),
    platformConnectionsPersisted: stateUsable,
    workspaceLoaded: Boolean(workspace && typeof workspace === "object"),
    backupDirectory: storageAdapter.backend === "file" ? (() => { try { ensureBackupDirectory(); return true; } catch { return false; } })() : status.healthy,
  };
  const healthy = Object.values(checks).every(Boolean);
  res.status(healthy ? 200 : 503).json({ success: healthy, healthy, version: PROJECT_VERSION, schemaVersion: STATE_SCHEMA_VERSION, checks, counts: { users: serverUsers.length, products: workspace.products.length, plans: workspace.installmentPlans.length, posts: workspace.posts.length, conversations: workspace.conversations.length, leads: workspace.leads.length, tasks: workspace.tasks.length, sales: workspace.sales.length, payments: workspace.payments.length, inventoryMovements: (workspace as any).inventoryMovements.length, jobs: automationJobs.length, audit: auditLog.length }, timestamp: new Date().toISOString() });
});

app.get("/api/system/export", requireOwner, (_req, res) => {
  const payload = { ...buildPersistedState(), exportVersion: PROJECT_VERSION, exportedAt: new Date().toISOString() };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="al-gharabi-ai-backup-${new Date().toISOString().slice(0,10)}.json"`);
  res.json(payload);
});

// حالة إعداد البريد — للمالك فقط، وبلا كشف أي مفتاح أو قيمة سرية.
app.get("/api/system/email-status", requireOwner, (_req, res) => {
  const config = getOwnerEmailConfig();
  res.json({ success: true, email: config, timestamp: new Date().toISOString() });
});

// Readiness is deterministic and does not call Gemini. It helps deployment systems
// distinguish a running process from a fully initialized application.
app.get("/api/readiness", (_req, res) => {
  installPublicHealthGuard(res);
  // العقل المركزي canonical يُبنى مرة واحدة لكل طلب؛ كل كتل العقل أدناه
  // (centralBrain التوافقية + brain) تُشتق من نفس اللقطة بلا إعادة جمع.
  const readinessBrain = buildRuntimeBrain({ ...brainRuntimeInput(), now: Date.now() });
  // الجاهزية التطبيقية منفصلة تماماً عن جاهزية مزود الذكاء الاصطناعي:
  // التطبيق جاهز للعمل حتى لو لم يُضبط المفتاح، لأن البديل الحتمي متاح دائماً.
  // لا تخزين إطلاقاً: نقطة فحص حيّة تحمل commit النشر ووقتاً حيّاً، فأي كاش
  // (متصفح/وسيط/حافة) قد يقدّم استجابة قديمة مجمّدة فيُوهم بعطل نشر غير موجود.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  // CONFIRMED HIGH (تدقيق مستقل): كان يُرجع 200 دائماً رغم أن الحقل ready يحمل
  // القيمة الصادقة بالفعل في الجسم — أي مراقبة تقرأ رمز الحالة فقط (لا الجسم)
  // لا يمكنها أبداً رؤية عطل حقيقي. نفس المعيار المحافظ المستخدم في /api/health:
  // فقط عطل مخزن فعلي (لا الكتابة إطلاقاً) يُسقط الرمز، لا وضع ephemeral المقصود.
  const appReady = STATE_WRITABLE();
  res.status(appReady ? 200 : 503).json({
    success: true,
    ready: appReady,
    version: PROJECT_VERSION,
    statePersistence: appReady,
    applicationReady: appReady,
    persistence: (() => { const s = storageStatus(); return { backend: s.backend, durable: s.durable, mode: s.durable ? "durable" : "ephemeral", healthy: s.healthy }; })(),
    auth: {
      ownerEmailConfigured: Boolean(OWNER_EMAIL),
      sessionsDurable: SESSIONS_DURABLE,
      sessionSecretSource: SESSION_SECRET_SOURCE,
      emailProviderConfigured: getOwnerEmailConfig().configured,
      emailFromConfigured: getOwnerEmailConfig().fromConfigured,
      /** الدخول الدائم يحتاج بريداً مضبوطاً لجلب الرمز ومفتاح جلسة ثابتاً. */
      permanentAccessReady: Boolean(OWNER_EMAIL) && SESSIONS_DURABLE && getOwnerEmailConfig().configured && getOwnerEmailConfig().fromConfigured,
    },
    ai: {
      ...aiProviderState(),
      /** المزود لا يُعتبر جاهزاً للإنتاج بمجرد وجود مفتاح؛ يلزم إثبات حي. */
      providerReady: aiLiveVerification.state === 'ok',
      /**
       * جدار حماية الحصة المجانية — مركزي واحد لكل المنصات (بلا أي اسم منصة هنا).
       * يُعلن الحالة والعدّادات بلا أي سرّ، ويسمّي الحد «حد الحماية المحلي للمشروع».
       */
      freeTierFirewall: buildUsageDiagnostics({
        counters: aiLedger.snapshot(),
        last: aiLedger.lastProvider(),
        usedToday: aiUsageGuard.status().usedToday,
        limit: aiUsageGuard.status().limit,
        protectionEnabled: GEMINI_FREE_TIER_PROTECTION,
        providerConfigured: aiEngine.providerConfigured,
        providerVerified: aiLiveVerification.state === 'ok',
      }),
      promptLimit: { maxPromptChars: DEFAULT_MAX_PROMPT_CHARS, maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS },
    },
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    /** ملف تحقق ملكية الرابط (TikTok URL prefix) + الصفحات القانونية العامة. */
    siteVerification: siteVerificationState(),
    /**
     * تشخيص تعثّر استضافة الفيديو العامة إلى Drive (Task: لا تعليق بلا نهاية):
     * عناوين نقاط googleapis + مدد + حالة فقط — بلا أي جسم/معرّف/سرّ/بيانات عميل.
     * الغرض كشف سبب التعثّر الفعلي (شبكة/تجديد رمز) لاحقاً بلا تخمين.
     */
    driveHostDiagnostics: {
      timeoutMs: envTimeoutMs(process.env as NodeJS.ProcessEnv, "DRIVE_HOST_TIMEOUT_MS", DRIVE_PUBLIC_HOST_TIMEOUT_MS),
      perCallTimeoutMs: envTimeoutMs(process.env as NodeJS.ProcessEnv, "DRIVE_HOST_CALL_TIMEOUT_MS", 0) || 120_000,
      lastTimeout: driveHostLastTimeout,
      recentCalls: driveHostCallRecords.slice(-DRIVE_HOST_CALL_RECORDS_MAX),
      timeoutCount: driveHostCallRecords.filter((c) => c.timedOut).length,
    },
    /** حالة مفتاح تشفير توكنات المنصات بنفس حكم التشفير الفعلي (بلا قيمة). */
    platformTokenKey: (() => { const tk = tokenKeyInspection(); return { state: tk.state, envName: "PLATFORM_TOKEN_ENCRYPTION_KEY", acceptedBytes: 32, reason: tk.reason }; })(),
    /**
     * حالة تشخيصية غير سرّية لتطبيق Meta: منطقي فقط (shape/configured)، بلا أي
     * قيمة. الغرض تمكين المالك من رؤية سبب «حدث خطأ ما» بلا كشف App ID/Secret.
     * الحكم الكامل مع إثبات Graph في GET /api/platforms/:platform/oauth/setup.
     */
    metaOAuth: (() => {
      const fb = OAUTH_CONFIG["facebook"];
      return {
        platform: "facebook",
        appIdConfigured: Boolean(fb?.clientId),
        appIdFormatOk: isPlausibleMetaAppId(String(fb?.clientId || "")),
        clientSecretConfigured: Boolean(fb?.clientSecret),
        appSecretConfigured: Boolean(facebookAppSecret()),
        verifyTokenConfigured: Boolean(facebookVerifyToken()),
        userAccessTokenStored: Boolean(getProviderToken("facebook")?.userAccessToken),
        pageAccessTokenStored: Boolean(getProviderToken("facebook")?.pageAccessToken),
        pendingPageSelection: facebookPageSelectionPending(),
        businessManagementScope: facebookOAuthScopes().includes("business_management"),
        // اكتمال الصلاحيات مع اعتماديات Meta الرسمية: قبل الإصلاح كانت
        // pages_manage_engagement تُطلب بلا صفحاتها pages_read_user_content.
        scopeCount: facebookOAuthScopes().length,
        scopeDependenciesResolved: facebookScopeDependencyGaps().length === 0,
        scopeDependencyGaps: facebookScopeDependencyGaps().length ? facebookScopeDependencyGaps() : undefined,
        loginConfigIdConfigured: loginConfigInspection("facebook").configured,
        loginConfigIdValid: loginConfigInspection("facebook").valid,
        loginConfigIdUsed: Boolean(loginConfigIdFor("facebook")),
        permissionSource: loginConfigIdFor("facebook") ? "facebook_login_for_business_configuration" : "oauth_scope_parameter",
      };
    })(),
    instagramOAuth: (() => {
      const ig = OAUTH_CONFIG["instagram"];
      return {
        platform: "instagram",
        clientIdConfigured: Boolean(ig?.clientId),
        clientSecretConfigured: Boolean(ig?.clientSecret),
        appSecretConfigured: Boolean(instagramAppSecret()),
        verifyTokenConfigured: Boolean(instagramVerifyToken()),
        pageAccessTokenStored: Boolean(getProviderToken("instagram")?.pageAccessToken),
        igAccountStored: Boolean(getProviderToken("instagram")?.igAccountId),
        pendingPageSelection: instagramPageSelectionPending(),
        scopeCount: instagramOAuthScopes().length,
        scopesResolvedWithDependencies: instagramScopeDependencyGaps().length === 0,
        loginConfigIdConfigured: loginConfigInspection("instagram").configured,
        loginConfigIdValid: loginConfigInspection("instagram").valid,
        loginConfigIdUsed: Boolean(effectiveLoginConfigIdFor("instagram")),
        loginConfigEnvNames: loginConfigEnvNames("instagram"),
        permissionSource: effectiveLoginConfigIdFor("instagram") ? "facebook_login_for_business_configuration" : "oauth_scope_parameter",
        // الجذر المُثبت لعطل «حدث خطأ ما»: تطبيق Meta من نوع Business يوجّه الحوار
        // الذي يحمل scope إلى واجهة Business Login التي تقرأ الصلاحيات من Configuration
        // (config_id) لا من scope. بلا config_id تبقى الصلاحيات فارغة ويظهر الرفض
        // بعد تسجيل الدخول. لذا نُعلن صراحةً هل Configuration مضبوط أم لا والإجراء.
        configurationRequired: true,
        configurationReady: Boolean(effectiveLoginConfigIdFor("instagram")),
        nextAction: effectiveLoginConfigIdFor("instagram")
          ? "اضبط الحساب المهني واربطه بالصفحة ثم ابدأ الربط؛ الصلاحيات تُقرأ من Configuration."
          : "أنشئ Configuration في Meta App Dashboard → Facebook Login for Business → Configurations (نوع User access token) بنفس حقل scopes، ثم ضع معرّفه الرقمي في INSTAGRAM_LOGIN_CONFIG_ID (أو FACEBOOK_LOGIN_CONFIG_ID) في Render وأعد النشر.",
        subscribedWebhookFields: [...INSTAGRAM_SUBSCRIBED_FIELDS],
        webhookFieldsNeedDashboard: true,
        // حالة مفتاح تدفّق الإعداد (منطقي فقط): enabled = extras مفعّل،
        // disabled = التدفّق العادي بلا extras (مخرج عطل Meta 1850019).
        onboardingFlow: instagramOnboardingEnabled() ? "enabled" : "disabled",
      };
    })(),
    // دليل النشر: أي إصدار/commit يعمل فعلاً على المنصة (Render). أسماء ومقتطفات
    // غير سرّية فقط (7 خانات من الـcommit) — تثبت أن الكود المنشور هو المدفوع.
    deploy: deploymentInfo(),
    // حقول YouTube الآمنة (منطقي فقط، بلا أي قيمة سرّية): تفصل وجود بيانات
    // Google عن نطاق القراءة المطلوب لإثبات القناة وعن الاتصال الفعلي.
    youtubeOAuth: youtubeHealthState(),
    // تفويض تشغيل YouTube: حالة التفويض الممنوح من المالك للعقل المركزي (نطاق
    // YouTube فقط) — منطقي بلا أي سرّ، ليتأكد المالك من الفعالية/الإيقاف.
    youtubeDelegation: youtubeDelegationBlock(),
    // طابور المحتوى (نشر/جدولة/مراجعة): مجاميع عامة فقط — التفاصيل للمالك.
    youtubeContent: contentQueueSummaryPublic(contentQueueSummary()),
    // مدير تشغيل YouTube 24/7: النسخة العامة الآمنة فقط (نشاط/حالة عامة/آخر
    // خطأ كرمز تقني). لا اسم حساب ولا نص تعليق ولا نص رد ولا عدّادات تفصيلية —
    // بيانات العملاء والتفاصيل في /api/agent/youtube/watcher (للمالك فقط).
    youtubeWatcher: watcherStatusBlockPublic(),
    // حارس حصة YouTube Data API: حالة عامة فقط (عتبة/استنفاد/نسبة) بلا بيانات عميل.
    youtubeQuota: youtubeQuotaStatusSummary(),
    // PHASE 7 — حقول TikTok الآمنة (منطقي فقط، بلا أي قيمة سرّية).
    tiktokOAuth: (() => {
      const c = tiktokOAuthConfig();
      const stored = tiktokStoredCredentials();
      const conn: any = platformConnections.get("tiktok");
      const verified = Boolean(conn?.status === "connected" && conn?.providerVerified === true && stored?.openId);
      return {
        platform: "tiktok",
        clientKeyConfigured: Boolean(c?.clientId),
        clientKeyFormatOk: isPlausibleTikTokClientKey(String(c?.clientId || "")),
        clientSecretConfigured: Boolean(c?.clientSecret),
        redirectUri: oauthCallbackUrl("tiktok"),
        requestedScopes: tiktokOAuthScopes(),
        oauthStateDurable: storageStatus().durable,
        tokenStored: Boolean(stored?.accessToken),
        refreshTokenStored: Boolean(stored?.refreshToken),
        tokenExpiryKnown: stored?.expiresAt != null,
        tokenExpired: Boolean(stored?.accessToken) && tiktokAccessExpired(),
        accountDiscovered: Boolean(stored?.openId),
        accountVerified: verified,
        postingCapability: tiktokCapabilityStatus("video_publishing"),
        directPostCapability: tiktokCapabilityStatus("content_posting_direct"),
        draftUploadCapability: tiktokCapabilityStatus("content_posting_draft"),
        photoPublishingCapability: tiktokCapabilityStatus("photo_publishing"),
        webhookCapability: tiktokCapabilityStatus("webhooks"),
        commentsCapability: tiktokCapabilityStatus("comments_read"),
        directMessagesCapability: tiktokCapabilityStatus("direct_messages_read"),
        appReviewRequired: tiktokAuditRequired(),
        /** رفع المسودة لا يحتاج audit (video.upload)، والنشر العام يحتاجه (video.publish). */
        draftUploadRequiresAudit: false,
        // الحالة الصادقة الموحّدة (مصدرها الواحد tiktokState.ts) — بلا ادعاء.
        operationalState: tiktokTruthfulState().state,
        operationalStateLabelAr: tiktokTruthfulState().labelAr,
        operationalStateReason: tiktokTruthfulState().reason,
      };
    })(),
    // العقل المركزي العام (Batch 26): حقول آمنة منطقية فقط، بلا أي سرّ. توضح أن
    // التخطيط/التعلّم/التوصيات تغطي كل المنصات العشر، وأن القراءة لا تستهلك Gemini.
    centralBrain: (() => {
      // facade توافقية: الشكل القديم مُشتق من الحالة canonical نفسها (لا بناء مستقل).
      const snap = toCentralBrainSnapshot(readinessBrain.state);
      const insufficient = snap.learning.byPlatform.filter((s) => !s.sufficientSample).map((s) => s.platform);
      return {
        platformAgnostic: true,
        platformsCovered: snap.platforms.length,
        learningPlatforms: snap.learning.byPlatform.length,
        learningSampleSize: readinessBrain.state.records.length,
        insufficientSamplePlatforms: insufficient,
        recommendationsCount: snap.recommendations?.recommendations.length ?? 0,
        audienceDemographicsAvailable: false,
        commentsCapablePlatforms: snap.platforms.filter((p) => p.readsComments).map((p) => p.platform),
        geminiUsedOnReads: false,
        geminiProviderCallsToday: snap.ai.providerCalls,
        limitations: snap.limitations,
      };
    })(),
    /**
     * طبقة العقل المركزي المُطوَّرة (Central Brain upgrade) — حقول آمنة بلا أي سرّ.
     * تُثبت أن العقل يعمل على كل المنصات العشر بقدرات حقيقية، وأنه لا يدّعي
     * مؤشرات/سمات غير متاحة، وأنه لا ينفّذ إجراءً خارجياً بنفسه.
     */
    brain: (() => {
      const out = readinessBrain;
      const state = out.state;
      const diag = brainDiagnostics(state);
      const memSummary = summarizeBrainMemory(brainMemoryStore);
      return {
        platformAgnostic: true,
        platformsCovered: state.platformStates.length,
        realConnectors: state.platformStates.filter((p) => p.realConnector).map((p) => p.platform),
        connectedVerified: state.platformStates.filter((p) => p.connected && p.verified).map((p) => p.platform),
        capabilityStates: state.platformStates.reduce((acc: Record<string, number>, p) => {
          for (const v of Object.values(p.capabilities)) acc[v] = (acc[v] || 0) + 1;
          return acc;
        }, {}),
        audienceDemographicsAvailable: state.audience?.demographicsAvailable ?? false,
        audienceSegments: state.audience?.segments.length ?? 0,
        audienceEvidence: (state.audience?.segments || []).reduce((s, seg) => s + seg.evidence.length, 0),
        commercialEvidence: state.market?.hasCommercialEvidence ?? false,
        knowledgeHealth: diag.knowledgeHealth,
        knowledgeItems: state.knowledge.items.length,
        signalFreshness: diag.signalFreshness,
        pendingDecisions: diag.pendingDecisionCount,
        blockedActions: diag.blockedActionCount,
        recommendations: out.recommendations.length,
        supportedRecommendations: out.recommendations.filter((r) => r.status === 'supported').length,
        experiments: out.experiments.length,
        strategies: out.strategies.length,
        contentPathAvailable: Boolean(out.contentPath),
        timingStatus: out.timing ? out.timing.status : 'no_observations',
        learningEvents: out.learningEvents.length,
        ownerPreferences: out.ownerPreferences.length,
        risks: out.risks.length,
        memoryHealth: memSummary,
        memoryDurable: storageStatus().durable,
        brainHealth: diag.brainHealth,
        executesExternalActions: false,
        geminiUsedOnReads: false,
        geminiProviderCallsToday: state.ai.providerCalls,
        limitations: state.limitations,
        // وقت تشغيل العقل 24/7 (Batch 5): يُثبت أن العقل يعمل على الخادم بلا متصفح.
        runtime: brainRuntimeStatus(),
        // فريق الوكلاء (Batch 6): جلسات/خلافات/تحقق/ذاكرة — بلا تنفيذ خارجي ولا AI.
        agentTeam: {
          enabled: true,
          ...summarizeTeamState(teamSessionState),
          executesExternalActions: false,
          geminiUsedOnSessions: false,
          note: 'فريق وكلاء داخلي: قرار مقترح فقط؛ لا تنفيذ خارجي.',
        },
        // التنفيذ الحتمي المحدود للعقول الستة: whitelist صريحة (4 أفعال) بلا Gemini،
        // وسجل تدقيق دائم. جلسة الفريق تبقى استشارية؛ هذا طبقة تنفيذ منفصلة محدودة.
        sixAgentExecution: {
          enabled: true,
          allowedActions: SIX_AGENT_ALLOWED_ACTIONS,
          executesExternalActions: 'bounded',
          geminiUsed: false,
          ...summarizeSixAgentAudit(sixAgentAuditState),
          note: 'أفعال حتمية محدودة فقط (تصنيف/عدّادات/إعادة نشر واحدة/رد بنمط محفوظ)؛ الغامض/الحساس يُصعَّد للعقل المركزي وحده.',
        },
        brainDecision: brainDecisionHealthBlock(),
        cognition: cognitionHealthBlock(),
      };
    })(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * تحقق حي واحد من مزود الذكاء الاصطناعي — للمالك فقط.
 *
 * طلب واحد قصير وحتمي، بلا cache وبلا retry (ينفَّذ مرة واحدة فقط)،
 * والغرض إثبات: المفتاح + SDK + الموديل + الطلب + الاستجابة.
 * لا يُعاد الطلب إن نجح، ولا يُطبع المفتاح ولا الترويسات.
 *
 * البرهان مقصور على موديل الإنتاج (`PRODUCTION_MODEL`) حصراً: هذا المسار
 * غايته إثبات جاهزية الموديل الإنتاجي المحدد، لا اختبار failover. لذلك لا
 * ينتقل إلى أي موديل بديل، وفشل الموديل الأساسي يُعرض فشلاً صريحاً ولا
 * يُقنَّع بنجاح موديل آخر. (منطق failover العام داخل المحرك لا يُمس.)
 *
 * المسار كله للمالك: POST هو الفعل، وأي طريقة أخرى تُرفض بـ405 صريحة بدل
 * أن تسقط إلى واجهة React وتُعيد HTML بحالة 200.
 */
app.all("/api/ai/verify-provider", (req, res, next) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "هذا المسار يدعم POST فقط." });
  }
  next();
});
app.post("/api/ai/verify-provider", requireOwner, async (_req, res) => {
  // الموديل الإنتاجي هو الوحيد الذي يُختبر — لا مرشحين بدلاء.
  const model = PRODUCTION_MODEL;
  const envPolicy = describeModelPolicy(process.env.GEMINI_MODEL);

  if (!process.env.GEMINI_API_KEY) {
    aiLiveVerification.state = 'skipped_no_key';
    aiLiveVerification.detail = 'GEMINI_API_KEY غير مضبوط في بيئة الخادم.';
    aiLiveVerification.model = null;
    aiLiveVerification.at = new Date().toISOString();
    aiLiveVerification.errorKind = 'provider_not_configured';
    aiLiveVerification.hint = 'اضبط GEMINI_API_KEY في بيئة الخادم ثم أعد الفحص (لا تُرسل المفتاح في المحادثة).';
    persistAiLiveVerification();
    return res.status(200).json({
      success: false,
      verified: false,
      state: aiLiveVerification.state,
      model,
      detail: aiLiveVerification.detail,
      errorKind: aiLiveVerification.errorKind,
      note: 'NOT VERIFIED — GEMINI_API_KEY NOT AVAILABLE IN RUNTIME',
    });
  }

  const provider = createGeminiProvider(process.env.GEMINI_API_KEY, LIVE_VERIFY_TIMEOUT_MS);
  if (!provider) {
    aiLiveVerification.state = 'failed';
    aiLiveVerification.detail = 'تعذر تهيئة موصل المزود.';
    aiLiveVerification.model = null;
    aiLiveVerification.at = new Date().toISOString();
    aiLiveVerification.errorKind = 'provider_init_error';
    aiLiveVerification.hint = 'تعذر تهيئة عميل SDK على الخادم؛ راجع سلامة اعتماديات الحزمة (@google/genai) وإصدار Node.';
    persistAiLiveVerification();
    return res.status(200).json({ success: false, verified: false, state: 'failed', model, detail: aiLiveVerification.detail, errorKind: aiLiveVerification.errorKind, hint: aiLiveVerification.hint });
  }

  // الفحص الإداري يستهلك من **نفس الميزانية المركزية** — لا مسار يتجاوز جدار
  // الحماية. عند نفاد الحصة يُعلن ذلك صراحةً بدل إرسال طلب مزود بلا رصيد.
  if (!aiUsageGuard.consume()) {
    aiLiveVerification.state = 'blocked_by_guard';
    aiLiveVerification.detail = 'تم بلوغ حد الحماية اليومي المحلي؛ لم يُرسل أي طلب للمزود.';
    aiLiveVerification.model = null;
    aiLiveVerification.at = new Date().toISOString();
    aiLiveVerification.errorKind = 'quota_guard';
    aiLiveVerification.hint = 'انتظر تجدّد اليوم أو ارفع GEMINI_DAILY_LIMIT صراحةً؛ الفحص الحي يستهلك طلباً واحداً من نفس ميزانية المشروع.';
    persistAiLiveVerification();
    return res.status(200).json({
      success: false, verified: false, state: aiLiveVerification.state, model,
      detail: aiLiveVerification.detail, errorKind: aiLiveVerification.errorKind, hint: aiLiveVerification.hint,
      note: 'NOT VERIFIED — LOCAL FREE-TIER GUARD BLOCKED THE REQUEST',
    });
  }


  const started = Date.now();
  // مهلة واحدة مشتركة لكل محاولات المرشحين حتى لا يتضاعف زمن الفحص الإداري.
  const deadline = started + LIVE_VERIFY_TIMEOUT_MS;
  const prompt = 'اكتب كلمة: جاهز';
  // نجرّب موديل الإنتاج أولاً ثم المرشحات GA بالترتيب. هذا مطابق لسلوك المحرك
  // وقت التشغيل: موديل واحد مشغول (503 «high demand») لا يعني تعطل المزود —
  // بل يعني تجاوز الضغط إلى موديل GA شقيق يعمل. بلا هذا التجاوز كان الفحص
  // يفشل بينما المحرك الفعلي ينجح، فيُعلن النظام أن Gemini معطّل وهو يعمل.
  const candidates = resolveModelCandidates(process.env.GEMINI_MODEL);
  if (!candidates.includes(model)) candidates.unshift(model);

  const tried: Array<{ model: string; errorKind: string; status: number | null }> = [];
  let servedModel: string | null = null;
  let text = '';
  let lastInfo: AiErrorInfo | null = null;

  for (const candidate of candidates) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) { lastInfo = { kind: 'timeout', status: null, retryable: true, safeMessage: 'انتهت مهلة الفحص قبل تجربة المرشحين جميعاً.' }; break; }
    // طلب حقيقي واحد لكل مرشح، بلا retry وبلا cache — نفس شروط الفحص الأصلي.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const out = await provider.generate({ model: candidate, prompt, signal: controller.signal });
      const trimmed = (out || '').trim();
      if (!trimmed) {
        lastInfo = { kind: 'unknown', status: null, retryable: false, safeMessage: 'المزود أعاد استجابة فارغة.' };
        tried.push({ model: candidate, errorKind: 'empty_response', status: null });
        continue;
      }
      text = trimmed;
      servedModel = candidate;
      break;
    } catch (err: any) {
      const info = classifyAiError(err, candidate);
      lastInfo = info;
      tried.push({ model: candidate, errorKind: info.kind, status: info.status });
      aiEvents.push({ at: new Date().toISOString(), type: 'verify_model_failed', detail: diagnosticLabel(info) });
      // خطأ مفتاح/مصادقة يؤثر على كل الموديلات بالتساوي، فلا فائدة من تجربة شقيق.
      if (info.kind === 'auth' || info.kind === 'invalid_request') break;
    } finally {
      clearTimeout(timer);
    }
  }

  if (servedModel) {
    const usedProduction = servedModel === model;
    aiLiveVerification.state = 'ok';
    // نداء مزود حقيقي واحد ضمن الميزانية المركزية — يُسجَّل للتشخيص.
    aiLedger.recordProviderCall({ platform: 'general', operation: 'provider_verification' }, servedModel);
    aiLiveVerification.detail = usedProduction
      ? `تم إثبات الاتصال بالموديل الإنتاجي ${servedModel} بطلب حقيقي واحد.`
      : `الموديل الإنتاجي ${model} غير متاح مؤقتاً (ضغط)، وأُثبت الاتصال بمرشح GA شقيق ${servedModel} بطلب حقيقي.`;
    aiLiveVerification.model = servedModel;
    aiLiveVerification.at = new Date().toISOString();
    aiLiveVerification.errorKind = null;
    aiLiveVerification.hint = usedProduction
      ? null
      : `الموديل الإنتاجي ${model} واجه ضغط طلب مرتفع (503) وليس خطأ مفتاح/كود. النظام يستخدم المرشح ${servedModel} فعلياً؛ أعد الفحص لاحقاً ليتحول الموديل الإنتاجي تلقائياً عند توفره.`;
    audit('system', 'ai_verify_provider', `model=${servedModel}`);
    persistAiLiveVerification();
    return res.json({
      success: true,
      verified: true,
      state: 'ok',
      model: servedModel,
      productionModel: model,
      usedProduction,
      latencyMs: Date.now() - started,
      responsePreview: text.slice(0, 80),
      modelPolicy: envPolicy,
      candidatesTried: tried.length + 1,
      attempted: tried,
      note: usedProduction
        ? 'تم إثبات الموديل الإنتاجي بطلب حقيقي واحد.'
        : 'الموديل الإنتاجي تحت ضغط مؤقت؛ أُثبت الاتصال بمرشح GA شقيق بطلب حقيقي. لا يوجد خطأ في المفتاح أو الكود.',
    });
  }

  // فشل كل المرشحين = فشل صريح، بلا ادعاء نجاح.
  const info = lastInfo ?? { kind: 'unknown', status: null, retryable: false, safeMessage: 'فشل غير مصنّف من المزود.' } as AiErrorInfo;
  aiEvents.push({ at: new Date().toISOString(), type: 'verify_failed', detail: diagnosticLabel(info) });
  aiLiveVerification.state = 'failed';
  aiLiveVerification.detail = `فشل التحقق من كل مرشحي GA (${candidates.length}): آخر فئة ${info.kind}${info.status ? `/${info.status}` : ''}.`;
  aiLiveVerification.model = null;
  aiLiveVerification.at = new Date().toISOString();
  aiLiveVerification.errorKind = info.kind;
  aiLiveVerification.hint = verificationHintFor(info);
  // فشل الفحص: نُعيد الحجز حتى لا يُحسب طلب فاشل على ميزانية المشروع.
  aiUsageGuard.release();
  aiLedger.recordProviderError();
  persistAiLiveVerification();
  return res.status(200).json({
    success: false,
    verified: false,
    state: 'failed',
    model,
    detail: aiLiveVerification.detail,
    errorKind: info.kind,
    status: info.status,
    safeMessage: info.safeMessage,
    modelPolicy: envPolicy,
    candidatesTried: tried.length,
    attempted: tried,
    hint: aiLiveVerification.hint,
  });
});

// Health endpoint

// -------------------------------------------------------------
// v9 unified operations layer: customer 360, cashflow, alerts,
// reconciliation and operational control. Deterministic only.
// -------------------------------------------------------------
function normalizedPhone(v:any){ return String(v||'').replace(/[^0-9+]/g,'').replace(/^00/,'+').trim(); }
function customerKey(x:any){ const phone=normalizedPhone(x.phone); return phone || cleanText(x.customerName||x.name,160).toLowerCase(); }
// معرّف العميل مُشتق أحادي الاتجاه (SHA-256) من المفتاح — لا يُمثّل رقم الهاتف ولا
// قابلاً للعكس إليه. المعرّف **عابر** (يُعاد بناؤه لكل طلب) وغير مستخدم كمفتاح دائم.
function customerPublicId(key:string){ return `cust_${crypto.createHash('sha256').update(`gharabi-customer:${key}`).digest('hex').slice(0,18)}`; }
function buildCustomerDirectory(){
  const map=new Map<string,any>();
  const touch=(raw:any, source:string)=>{
    const key=customerKey(raw); if(!key)return;
    const c=map.get(key)||{id:customerPublicId(key),name:cleanText(raw.customerName||raw.name,160)||'عميل',phone:normalizedPhone(raw.phone),sources:new Set<string>(),salesCount:0,salesValue:0,paid:0,balance:0,openConversations:0,openLeads:0,lastActivity:null};
    c.sources.add(source); if(raw.phone&&!c.phone)c.phone=normalizedPhone(raw.phone); if(raw.customerName&&!c.name)c.name=cleanText(raw.customerName,160);
    const at=raw.createdAt||raw.updatedAt||raw.at; if(at&&(!c.lastActivity||Date.parse(at)>Date.parse(c.lastActivity)))c.lastActivity=at;
    if(source==='sale'){c.salesCount++;c.salesValue+=safeMoney(raw.totalAmount);c.paid+=safeMoney(raw.paidAmount);c.balance+=safeMoney(raw.balance);}
    if(source==='conversation'&&raw.status!=='resolved')c.openConversations++;
    if(source==='lead'&&!['won','lost'].includes(raw.status))c.openLeads++;
    map.set(key,c);
  };
  for(const x of workspace.sales)touch(x,'sale'); for(const x of workspace.leads)touch(x,'lead'); for(const x of workspace.conversations)touch(x,'conversation');
  return [...map.values()].map(c=>({...c,sources:[...c.sources]})).sort((a,b)=>b.salesValue-a.salesValue || String(b.lastActivity||'').localeCompare(String(a.lastActivity||'')));
}

app.get('/api/control/alerts', authenticateToken, (req,res)=>{
  const user=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية الوصول للتنبيهات التشغيلية."});
  const now=Date.now(), alerts:any[]=[];
  const low=(workspace.products as any[]).filter(p=>Number(p.stockQuantity||0)<=Number(p.reorderLevel||0));
  if(low.length) alerts.push({id:'stock-low',severity:'warning',type:'inventory',title:'مخزون يحتاج إعادة طلب',count:low.length,value:low.reduce((n:number,p:any)=>n+Math.max(0,Number(p.stockQuantity||0)),0)});
  const overdue=(workspace.installmentSchedules as any[]).filter(x=>x.status!=='paid'&&Date.parse(x.dueAt)<now);
  if(overdue.length) alerts.push({id:'installments-overdue',severity:'critical',type:'finance',title:'أقساط متأخرة',count:overdue.length,value:overdue.reduce((n:number,x:any)=>n+Math.max(0,safeMoney(x.amount)-safeMoney(x.paid)),0)});
  const dueTasks=(workspace.tasks as any[]).filter(x=>x.status!=='done'&&x.status!=='cancelled'&&x.dueAt&&Date.parse(x.dueAt)<now);
  if(dueTasks.length) alerts.push({id:'tasks-overdue',severity:'warning',type:'tasks',title:'مهام متأخرة',count:dueTasks.length});
  const openLeads=(workspace.leads as any[]).filter(x=>!['won','lost'].includes(x.status));
  if(openLeads.length) alerts.push({id:'leads-open',severity:'info',type:'crm',title:'عملاء محتملون بانتظار المتابعة',count:openLeads.length});
  const reviewPosts=(workspace.posts as any[]).filter(x=>x.status==='review');
  if(reviewPosts.length) alerts.push({id:'content-review',severity:'info',type:'content',title:'محتوى بانتظار المراجعة',count:reviewPosts.length});
  res.json({success:true,generatedAt:new Date().toISOString(),alerts});
});

app.get('/api/control/customer-directory', authenticateToken, (req,res)=>{
  const user=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية الوصول لدليل العملاء."});
  const q=cleanText(req.query?.q,160).toLowerCase(); let rows=buildCustomerDirectory();
  if(q) rows=rows.filter(x=>String(x.name).toLowerCase().includes(q)||String(x.phone).toLowerCase().includes(q));
  res.json({success:true,customers:rows.slice(0,1000)});
});

app.get('/api/control/cashflow', authenticateToken, (req,res)=>{
  const user=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية الوصول للتدفق النقدي."});
  const days=Math.min(365,Math.max(7,Number(req.query?.days||30))), cutoff=Date.now()-days*86400000;
  const rows:any[]=[]; const push=(at:any,type:string,amount:number,label:string,ref:string)=>{const t=Date.parse(at||'');if(Number.isFinite(t)&&t>=cutoff)rows.push({at:new Date(t).toISOString(),type,amount:safeMoney(amount),label,ref});};
  for(const x of workspace.payments)push(x.createdAt,'in',x.amount,'تحصيل دفعة',x.saleId||x.id);
  for(const x of workspace.sales)push(x.createdAt,'in',x.downPayment,'دفعة مقدمة',x.id);
  for(const x of workspace.purchases)push(x.createdAt,'out',x.total,'مشتريات',x.id);
  for(const x of workspace.expenses)push(x.createdAt,'out',x.amount,'مصروف',x.id);
  rows.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)); let balance=0; for(const r of rows){balance+=r.type==='in'?r.amount:-r.amount;r.runningBalance=balance;}
  const inflow=rows.filter(x=>x.type==='in').reduce((n,x)=>n+x.amount,0), outflow=rows.filter(x=>x.type==='out').reduce((n,x)=>n+x.amount,0);
  res.json({success:true,days,inflow,outflow,net:inflow-outflow,rows:rows.slice(-2000)});
});

app.get('/api/control/reconciliation', requireOwner, (_req,res)=>{
  const salesValue=(workspace.sales as any[]).reduce((n:number,x:any)=>n+safeMoney(x.totalAmount),0);
  const paid=(workspace.sales as any[]).reduce((n:number,x:any)=>n+safeMoney(x.paidAmount),0);
  const payments=(workspace.payments as any[]).reduce((n:number,x:any)=>n+safeMoney(x.amount),0);
  const down=(workspace.sales as any[]).reduce((n:number,x:any)=>n+safeMoney(x.downPayment),0);
  const computedPaid=down+payments;
  const differences={salesPaidVsTransactions:paid-computedPaid,recordedPayments:payments,downPayments:down};
  res.json({success:true,ok:Math.abs(differences.salesPaidVsTransactions)<0.01,salesValue,recordedPaid:paid,transactionPaid:computedPaid,differences,checkedAt:new Date().toISOString()});
});

app.get('/api/control/daily-brief', authenticateToken, (req,res)=>{
  const user=(req as any).user as ServerUser; if(!["owner","manager","staff"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية الوصول للملخص اليومي."});
  const now=new Date(), start=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
  const todaySales=(workspace.sales as any[]).filter(x=>Date.parse(x.createdAt||'')>=start);
  const todayPayments=(workspace.payments as any[]).filter(x=>Date.parse(x.createdAt||'')>=start);
  const todayExpenses=(workspace.expenses as any[]).filter(x=>Date.parse(x.createdAt||'')>=start);
  const pendingJobs=automationJobs.filter((x:any)=>['queued','approved','ready'].includes(x.status)).length;
  res.json({success:true,date:now.toISOString().slice(0,10),sales:{count:todaySales.length,value:todaySales.reduce((n:number,x:any)=>n+safeMoney(x.totalAmount),0)},collections:todayPayments.reduce((n:number,x:any)=>n+safeMoney(x.amount),0),expenses:todayExpenses.reduce((n:number,x:any)=>n+safeMoney(x.amount),0),openConversations:workspace.conversations.filter((x:any)=>x.status!=='resolved').length,openLeads:workspace.leads.filter((x:any)=>!['won','lost'].includes(x.status)).length,lowStock:workspace.products.filter((x:any)=>Number(x.stockQuantity||0)<=Number(x.reorderLevel||0)).length,pendingJobs});
});


// v10 finalization layer: notifications, audit query, provider adapter contract, webhook intake, exports, and final readiness.
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
function pushNotification(userId:string|null, type:string, title:string, body:string, severity:"info"|"warning"|"critical"="info", link?:string){
  const item={id:workspaceId("notif"),userId,title,body,type,severity,read:false,link:link||null,createdAt:new Date().toISOString()};
  (workspace as any).notifications.unshift(item); (workspace as any).notifications=(workspace as any).notifications.slice(0,10000); return item;
}
function providerStatus(platform:string){
  const account=platformConnections.get(platform);
  return {platform, connected:Boolean(account?.status==="connected"), accountId:account?.accountId||null, providerVerified:Boolean(account?.providerVerified), adapter:SUPPORTED_PLATFORMS.some((p:any)=>p.id===platform)?"adapter-contract":"unsupported"};
}
app.get("/api/notifications", authenticateToken, (req,res)=>{
  const u=(req as any).user as ServerUser; const all=(workspace as any).notifications||[];
  const rows=all.filter((n:any)=>!n.userId||n.userId===u.id).slice(0,200);
  res.json({success:true,notifications:rows,unread:rows.filter((n:any)=>!n.read).length});
});
app.post("/api/notifications/:id/read", authenticateToken, (req,res)=>{
  const u=(req as any).user as ServerUser; const n=(workspace as any).notifications.find((x:any)=>x.id===req.params.id);
  if(!n|| (n.userId&&n.userId!==u.id)) return res.status(404).json({success:false,error:"التنبيه غير موجود."});
  n.read=true; n.readAt=new Date().toISOString(); n.readBy=u.id; persistState(); res.json({success:true,notification:n});
});
app.post("/api/notifications/read-all", authenticateToken, (req,res)=>{
  const u=(req as any).user as ServerUser; for(const n of (workspace as any).notifications){ if(!n.userId||n.userId===u.id){n.read=true;n.readAt=new Date().toISOString();n.readBy=u.id;} } persistState(); res.json({success:true});
});
app.get("/api/audit/query", requireOwner, (req,res)=>{
  const q=normalizeSearch(req.query.q); const action=cleanText(req.query.action,80); const limit=Math.min(500,Math.max(1,Number(req.query.limit||100)));
  let rows=auditLog.slice(); if(q) rows=rows.filter((x:any)=>containsQuery(x.action,q)||containsQuery(x.detail,q)||containsQuery(x.userId,q)); if(action) rows=rows.filter((x:any)=>x.action===action);
  res.json({success:true,entries:rows.slice(0,limit),count:rows.length});
});
app.get("/api/providers/capabilities", authenticateToken, (_req,res)=>{ res.json({success:true,contractVersion:"2.0",mode:"real-provider-required",providers:SUPPORTED_PLATFORMS.map((p:any)=>({platform:p.id,name:p.name,...providerStatus(p.id),capabilities:{oauth:Boolean(OAUTH_CONFIG[p.id]),webhook:true,publish:p.capabilities.includes("publish"),analytics:p.capabilities.includes("analytics"),messaging:p.capabilities.includes("messages")},execution:p.id==="telegram"?"production-text-publish":"adapter-ready-credentials-required"}))}); });
app.post("/api/webhooks/:platform", (req,res)=>{
  const platform=String(req.params.platform); if(!SUPPORTED_PLATFORMS.some((p:any)=>p.id===platform)) return res.status(404).json({success:false,error:"المنصة غير مدعومة."});
  if(!WEBHOOK_SECRET) return res.status(503).json({success:false,error:"WEBHOOK_SECRET غير مضبوط؛ تم تعطيل استقبال Webhook لحماية النظام."});
  // SEC-02: التحقق على الجسم الخام الحقيقي (req.rawBody) لا على إعادة تسلسل JSON.
  // إعادة التسلسل تعتمد على تنسيق Node (مسافات/ترتيب مفاتيح) وقد تختلف عن بايتات
  // المرسل، فترفض توقيعاً شرعياً. نرفض صراحةً إن غاب الجسم الخام بدل التحقق الأعمى
  // (نفس نمط Facebook/Instagram/TikTok). المقارنة بزمن ثابت داخل verifier الموحّد.
  if (typeof (req as any).rawBody !== "string") return res.status(400).json({success:false,error:"جسم الطلب الخام غير متوفر للتحقق من التوقيع."});
  const rawBody=String((req as any).rawBody ?? "");
  const verifier=hmacSignatureVerifier("x-gharabi-signature","sha256");
  const verification=verifier.verify({headers:req.headers as Record<string,string|undefined>,rawBody,secret:WEBHOOK_SECRET});
  if(!verification.ok) return res.status(401).json({success:false,error:"توقيع Webhook غير صالح."});
  const eventId=cleanText(req.headers["x-event-id"],160)||workspaceId("event"); if((workspace as any).webhookEvents.some((x:any)=>x.id===eventId)) return res.json({success:true,duplicate:true});
  const event={id:eventId,platform,type:cleanText(req.body?.type,100)||"unknown",payload:req.body?.data||req.body,receivedAt:new Date().toISOString()};
  (workspace as any).webhookEvents.unshift(event); (workspace as any).webhookEvents=(workspace as any).webhookEvents.slice(0,WORKSPACE_MAX_WEBHOOK_EVENTS); (workspace as any).providerEvents.unshift({id:workspaceId("pevent"),platform,eventId,type:event.type,receivedAt:event.receivedAt}); (workspace as any).providerEvents=(workspace as any).providerEvents.slice(0,WORKSPACE_MAX_PROVIDER_EVENTS); persistState();
  res.status(202).json({success:true,accepted:true,eventId});
});
app.get("/api/webhooks/events", requireOwner, (req,res)=>{ const platform=cleanText(req.query.platform,60); let rows=(workspace as any).webhookEvents.slice(); if(platform) rows=rows.filter((x:any)=>x.platform===platform); res.json({success:true,events:rows.slice(0,500)}); });
app.get("/api/system/export/audit", requireOwner, (_req,res)=>{
  res.json({success:true,exportedAt:new Date().toISOString(),version:PROJECT_VERSION,entries:auditLog.slice(0,5000)});
});
app.get("/api/system/final-readiness", requireOwner, (_req,res)=>{
  const checks:any[]=[]; const add=(id:string,label:string,ok:boolean,detail:string)=>checks.push({id,label,ok,detail});
  add("auth","بوابة المصادقة",serverUsers.length>0,"لا يوجد مستخدم نظام" );
  add("owner","حساب المالك",serverUsers.some((u:any)=>u.role==="owner"),"يجب وجود مالك واحد على الأقل");
  add("persistence","التخزين الدائم",Boolean(workspace&&typeof workspace==="object"),"حالة workspace غير متاحة");
  add("integrity","سلامة البيانات",Array.isArray(workspace.products)&&Array.isArray(workspace.sales)&&Array.isArray(workspace.payments),"هياكل البيانات الأساسية غير مكتملة");
  add("social-safety","سلامة النشر الخارجي",automationJobs.every((j:any)=>j.status!=="published" || j.providerVerified===true),"يوجد سجل نشر خارجي غير موثق");
  add("gemini-guard","حارس Gemini",GEMINI_DAILY_LIMIT>=1&&GEMINI_DAILY_LIMIT<=GEMINI_LIMIT_MAX_SAFE,"إعداد حارس Gemini غير آمن");
  add("webhook-safety","حماية Webhook",!WEBHOOK_SECRET || WEBHOOK_SECRET.length>=16,"WEBHOOK_SECRET يجب أن يكون 16 محرفًا على الأقل أو يُترك معطلًا");
  const healthy=checks.every(x=>x.ok); res.status(healthy?200:503).json({success:healthy,ready:healthy,projectVersion:PROJECT_VERSION,schemaVersion:STATE_SCHEMA_VERSION,checks,blocking:checks.filter(x=>!x.ok)});
});

app.get("/api/system/deployment-checklist", requireOwner, (_req,res)=>{
  const platformRows=SUPPORTED_PLATFORMS.map((p:any)=>{ const r=publicProviderReadiness(p.id); const c:any=platformConnections.get(p.id); return {platform:p.id,name:p.name,configured:Boolean(r.configured),connected:Boolean(c?.status==="connected"&&c?.providerVerified===true),providerVerified:Boolean(c?.providerVerified===true),productionReady:Boolean(c?.status==="connected"&&c?.providerVerified===true&&p.id==="telegram"),missing:r.missing||[],next:r.next||"إضافة موصل إنتاجي معتمد"}; });
  const checks=[
    {id:"auth",label:"المصادقة والمالك",ok:serverUsers.some((u:any)=>u.role==="owner")},
    {id:"persistence",label:"التخزين والنسخ الاحتياطية",ok:Boolean(workspace&&typeof workspace==="object")&&storageStatus().healthy},
    {id:"integrity",label:"سلامة البيانات الأساسية",ok:Array.isArray(workspace.products)&&Array.isArray(workspace.sales)&&Array.isArray(workspace.payments)},
    {id:"ai-guard",label:"حارس Gemini",ok:GEMINI_DAILY_LIMIT>=1&&GEMINI_DAILY_LIMIT<=GEMINI_LIMIT_MAX_SAFE},
    {id:"publish-safety",label:"سلامة النشر",ok:automationJobs.every((j:any)=>j.status!=="published"||j.providerVerified===true)},
    {id:"provider-clarity",label:"وضوح حالة المنصات",ok:platformRows.every((x:any)=>!x.connected||x.providerVerified)},
  ];
  res.json({success:true,ready:checks.every(x=>x.ok),projectVersion:PROJECT_VERSION,schemaVersion:STATE_SCHEMA_VERSION,checks,platforms:platformRows,productionAdapters:Object.fromEntries(SUPPORTED_PLATFORMS.map(p=>[p.id, hasRealConnector(p.id) ? "connector-implemented" : (OAUTH_CONFIG[p.id] ? "credentials-required" : "adapter-required")])),note:"الربط الحقيقي للمنصات يحتاج بيانات تطبيقات واعتمادات الحسابات الخاصة بالمالك؛ لا يتم اختلاقها أو اعتبار المنصة متصلة بدون تحقق مزود فعلي."});
});

// دفاع أخير بلا مصادقة: النقطتان العامتان /api/health و/api/readiness يجب ألا
// تحملا أي بيانات عميل (اسم حساب/نص تعليق/نص رد). نُمرّر الحمولة كاملة عبر
// `sanitizePublicHealthPayload` (المصدر الواحد لقائمة الحقول الممنوعة) قبل الإرسال،
// فلا يمكن أن يتسرّب حقل حسّاس حتى لو أُضيف لاحقاً إلى كتلة عامة دون قصد.
function guardPublicHealthPayload(originalJson: (body: any) => any): (body: any) => any {
  return (body: any) => {
    const cleaned = sanitizePublicHealthPayload(body);
    const w = (cleaned as any)?.youtubeWatcher;
    const extra = findDisallowedWatcherPublicKeys(w);
    const forbidden = findForbiddenPublicKeys(cleaned);
    if (extra.length || forbidden.length) {
      // لا نُسقط الاستجابة (نقطة مراقبة عامة)، لكن نُسجّل الانحراف بوضوح كي لا
      // يمرّ صامتاً ويُصلح جذرياً. لا يُسجَّل أي محتوى عميل — أسماء حقول فقط.
      console.warn(`[الغرابي AI] public-health-payload-hardened forbidden=[${forbidden.join(',')}] watcherExtra=[${extra.join(',')}]`);
    }
    return originalJson(cleaned);
  };
}
function installPublicHealthGuard(res: any): void {
  if (typeof res.json !== 'function') return;
  res.json = guardPublicHealthPayload(res.json.bind(res));
}

app.get("/api/health", (_req, res) => {
  installPublicHealthGuard(res);
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  const tokenKey = tokenKeyInspection();
  // لا تخزين إطلاقاً: نقطة فحص حيّة تحمل commit النشر ووقتاً حيّاً، فأي كاش
  // (متصفح/وسيط/حافة) قد يقدّم استجابة قديمة مجمّدة فيُوهم بعطل نشر غير موجود.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  // CONFIRMED HIGH (تدقيق مستقل): هذا المسار هو healthCheckPath الرسمي لدى Render
  // (render.yaml) وHEALTHCHECK الخاص بـ Docker، وكان يُرجع 200 دائماً بصرف النظر
  // عن الحالة الفعلية — فلا يمكن لأي مراقبة آلية اكتشاف عطل حقيقي أبداً.
  // الإصلاح محافظ عمداً: الفشل الوحيد الذي يُسقط رمز الحالة هو عطل مخزن حقيقي
  // (healthy=false — الكتابة نفسها تفشل)، وليس وضع "ephemeral" الدائم المقصود
  // والموثّق بلا DATABASE_URL — ذاك وضع تشغيل مقبول رسمياً، لا عطل.
  const storageHealthy = storageStatus().healthy;
  res.status(storageHealthy ? 200 : 503).json({
    status: storageHealthy ? "ok" : "degraded",
    aiEnabled: hasKey,
    timestamp: new Date().toISOString(),
    service: "Al-Gharabi AI Backend",
    version: PROJECT_VERSION,
    // حالة إعداد بريد رمز تحقق المالك — منطقية فقط وبلا أي قيمة سرّية. تسمح
    // للمالك بتشخيص «لم يصل الرمز» من بيئة هذا النشر بالذات: هل مزود البريد
    // مضبوط؟ هل بريد المُرسِل مضبوط؟ هذا لا يكشف المفتاح ولا البريد.
    ownerEmail: {
      ownerConfigured: Boolean(OWNER_EMAIL),
      providerConfigured: getOwnerEmailConfig().configured,
      provider: getOwnerEmailConfig().provider,
      fromConfigured: getOwnerEmailConfig().fromConfigured,
      envNames: { owner: "OWNER_EMAIL", provider: "RESEND_API_KEY", from: "RESEND_FROM_EMAIL" },
    },
    geminiUsage: geminiStatus(),
    // حالة مفتاح تشفير توكنات المنصات: تفصل missing من invalid بلا كشف القيمة،
    // فتعكس نفس الحكم الذي يستخدمه encryptSecret/credentials فعلياً.
    platformTokenKey: { state: tokenKey.state, envName: "PLATFORM_TOKEN_ENCRYPTION_KEY", acceptedBytes: 32, reason: tokenKey.reason },
    // حالة عزل أسطح ERP/CRM/المالية القديمة (منطقي فقط بلا قيمة سرّية): تُعلن ما إذا
    // كانت هذه الأسطح معزولة برد 404 SCOPE_DISABLED افتراضياً، ومتغيّر الإعادة.
    legacyErpScope: {
      enabled: legacyErpScopeEnabled(),
      isolated: !legacyErpScopeEnabled(),
      envName: "GHARABI_ENABLE_LEGACY_ERP_SCOPE",
      prefixes: [...LEGACY_ERP_ROUTE_PREFIXES],
    },
    // حالة تطبيق Meta غير السرّية (منطقي فقط): تفصل missing من invalid وبين
    // تكوين المعرّف والسرّ، فتكشف سبب صفحة «حدث خطأ ما» قبل إرسال المالك إليها.
    metaOAuth: (() => {
      const fb = OAUTH_CONFIG["facebook"];
      return {
        platform: "facebook",
        appIdConfigured: Boolean(fb?.clientId),
        appIdFormatOk: isPlausibleMetaAppId(String(fb?.clientId || "")),
        clientSecretConfigured: Boolean(fb?.clientSecret),
        appSecretConfigured: Boolean(facebookAppSecret()),
        verifyTokenConfigured: Boolean(facebookVerifyToken()),
        userAccessTokenStored: Boolean(getProviderToken("facebook")?.userAccessToken),
        pageAccessTokenStored: Boolean(getProviderToken("facebook")?.pageAccessToken),
        pendingPageSelection: facebookPageSelectionPending(),
        businessManagementScope: facebookOAuthScopes().includes("business_management"),
        // اكتمال الصلاحيات مع اعتماديات Meta الرسمية: قبل الإصلاح كانت
        // pages_manage_engagement تُطلب بلا صفحاتها pages_read_user_content.
        scopeCount: facebookOAuthScopes().length,
        scopeDependenciesResolved: facebookScopeDependencyGaps().length === 0,
        scopeDependencyGaps: facebookScopeDependencyGaps().length ? facebookScopeDependencyGaps() : undefined,
      };
    })(),
    // حالة الاتصال الخاص بموصل Instagram الحقيقي (منطقي فقط بلا أي سرّ أو رمز).
    instagramOAuth: (() => {
      const ig = OAUTH_CONFIG["instagram"];
      return {
        platform: "instagram",
        clientIdConfigured: Boolean(ig?.clientId),
        clientSecretConfigured: Boolean(ig?.clientSecret),
        appSecretConfigured: Boolean(instagramAppSecret()),
        verifyTokenConfigured: Boolean(instagramVerifyToken()),
        pageAccessTokenStored: Boolean(getProviderToken("instagram")?.pageAccessToken),
        igAccountStored: Boolean(getProviderToken("instagram")?.igAccountId),
        pendingPageSelection: instagramPageSelectionPending(),
        scopeCount: instagramOAuthScopes().length,
        scopesResolvedWithDependencies: true,
        // متطلب Facebook Login for Business لتطبيق Meta من نوع Business: بلا
        // Configuration ID (config_id) يوجّه Meta الحوار إلى Business Login الذي
        // يقرأ الصلاحيات من الConfiguration لا من scope، فيظهر «حدث خطأ ما» بعد
        // تسجيل الدخول. يُعلن فوراً في /api/health ليراه المالك بلا تخمين.
        loginConfigIdConfigured: loginConfigInspection("instagram").configured,
        loginConfigIdValid: loginConfigInspection("instagram").valid,
        loginConfigIdUsed: Boolean(effectiveLoginConfigIdFor("instagram")),
        configurationReady: Boolean(effectiveLoginConfigIdFor("instagram")),
        // حالة مفتاح تدفّق الإعداد (منطقي فقط): enabled = extras مفعّل،
        // disabled = التدفّق العادي بلا extras (مخرج عطل Meta 1850019).
        onboardingFlow: instagramOnboardingEnabled() ? "enabled" : "disabled",
      };
    })(),
    // حالة موصل YouTube الحقيقي (منطقي فقط بلا أي سرّ أو رمز): تفصل وجود بيانات
    // Google عن نطاق القراءة المطلوب لإثبات القناة وعن حالة الاتصال الفعلية.
    youtubeOAuth: youtubeHealthState(),
    // تفويض تشغيل YouTube (نطاق YouTube فقط): منطقي بلا أي سرّ، ويُعلن الإجراء
    // التالي — منح التفويض يسمح للعقل بتنفيذ عمليات YouTube المحدّدة تلقائياً.
    youtubeDelegation: youtubeDelegationBlock(),
    // مدير تشغيل YouTube 24/7: النسخة العامة الآمنة فقط (نشاط/حالة عامة/آخر
    // خطأ كرمز تقني). لا اسم حساب ولا نص تعليق ولا نص رد ولا عدّادات تفصيلية —
    // بيانات العملاء والتفاصيل في /api/agent/youtube/watcher (للمالك فقط).
    youtubeWatcher: watcherStatusBlockPublic(),
    // حارس حصة YouTube Data API: حالة عامة فقط (عتبة/استنفاد/نسبة) بلا بيانات عميل.
    youtubeQuota: youtubeQuotaStatusSummary(),
    // تشخيص تعثّر استضافة الفيديو العامة إلى Drive (بلا تعليق بلا نهاية):
    // عناوين نقاط googleapis (بلا استعلام) + مدد + حالة فقط — لا جسم/سرّ/بيانات عميل.
    driveHostDiagnostics: {
      timeoutMs: envTimeoutMs(process.env as NodeJS.ProcessEnv, "DRIVE_HOST_TIMEOUT_MS", DRIVE_PUBLIC_HOST_TIMEOUT_MS),
      perCallTimeoutMs: envTimeoutMs(process.env as NodeJS.ProcessEnv, "DRIVE_HOST_CALL_TIMEOUT_MS", 0) || 120_000,
      lastTimeout: driveHostLastTimeout,
      recentCalls: driveHostCallRecords.slice(-DRIVE_HOST_CALL_RECORDS_MAX),
      timeoutCount: driveHostCallRecords.filter((c) => c.timedOut).length,
    },
    // وقت تشغيل العقل المركزي 24/7 (Batch 5): حالة/إيقاع/قفل/عدّادات الذاكرة — بلا سرّ.
    brainRuntime: brainRuntimeStatus(),
    // فريق الوكلاء (Batch 6): ملخّص الجلسات/الخلافات/التحقق/الذاكرة — بلا سرّ.
    // يُثبت أن الجلسات تعمل وأن قراراتها تُحفظ في نفس ذاكرة العقل القائمة.
    agentTeam: {
      enabled: true,
      ...summarizeTeamState(teamSessionState),
      executesExternalActions: false,
      geminiUsedOnSessions: false,
      agents: ['orchestrator', 'research', 'analysis', 'strategy', 'critic', 'decision'],
      note: 'فريق وكلاء داخلي: رصد/تحليل/تحقق/قرار مقترح فقط — لا تنفيذ خارجي ولا استهلاك AI.',
    },
    sixAgentExecution: {
      enabled: true,
      allowedActions: SIX_AGENT_ALLOWED_ACTIONS,
      executesExternalActions: 'bounded',
      geminiUsed: false,
      ...summarizeSixAgentAudit(sixAgentAuditState),
      note: 'طبقة تنفيذ حتمية محدودة للعقول الستة (4 أفعال) بلا Gemini؛ الغامض/الحساس يُصعَّد للعقل المركزي.',
    },
    brainDecision: brainDecisionHealthBlock(),
    cognition: cognitionHealthBlock(),
    // طابور المحتوى (نشر/جدولة/مراجعة): مجاميع عامة فقط — التفاصيل للمالك.
    youtubeContent: contentQueueSummaryPublic(contentQueueSummary()),
    // حالة موصل TikTok الحقيقي (منطقي فقط بلا أي سرّ أو رمز).
    tiktokOAuth: (() => {
      const c = tiktokOAuthConfig();
      const stored = tiktokStoredCredentials();
      return {
        platform: "tiktok",
        clientKeyConfigured: Boolean(c?.clientId),
        clientKeyFormatOk: isPlausibleTikTokClientKey(String(c?.clientId || "")),
        clientSecretConfigured: Boolean(c?.clientSecret),
        accessTokenStored: Boolean(stored?.accessToken),
        refreshTokenStored: Boolean(stored?.refreshToken),
        openIdStored: Boolean(stored?.openId),
        tokenExpiryKnown: stored?.expiresAt != null,
        tokenExpired: Boolean(stored?.accessToken) && tiktokAccessExpired(),
        scopeCount: tiktokOAuthScopes().length,
        requestedScopes: tiktokOAuthScopes(),
        webhookUrl: tiktokWebhookUrl(),
        webhookEvents: [...TIKTOK_WEBHOOK_EVENTS],
        appReviewRequired: tiktokAuditRequired(),
        connectorConfigured: tiktokConnectorConfigured(),
        // الحالة الصادقة الموحّدة (مصدرها الواحد tiktokState.ts) — بلا ادعاء.
        operationalState: tiktokTruthfulState().state,
        operationalStateLabelAr: tiktokTruthfulState().labelAr,
        operationalStateReason: tiktokTruthfulState().reason,
      };
    })(),
    // العنوان العام المعتمد: يكشف سبب فشل OAuth قبل وقوعه بلا أي سرّ. يبيّن مصدر
    // العنوان، وهل هو عام/https (شرط تسجيل redirect_uri لدى Meta/Google).
    publicUrl: (() => {
      const u = resolvePublicUrl(process.env);
      return {
        baseUrl: u.baseUrl,
        host: u.host,
        scheme: u.scheme,
        source: u.source,
        valid: u.valid,
        isPublic: u.valid && u.scheme === "https" && !!u.host && !isLocalHost(u.host),
        problems: u.problems,
        candidates: u.candidates.map((c) => ({ source: c.source, valid: c.valid, present: c.raw !== null, reason: c.reason })),
      };
    })(),
    // ملف تحقق ملكية الرابط (TikTok URL prefix) والصفحات القانونية العامة.
    siteVerification: siteVerificationState(),
    // العقل المركزي: عدد المهام وآخر حالة — منطقي حتمي بلا أي سرّ.
    centralAgent: (() => {
      const tasks = agentOrchestrator.snapshot();
      const last = tasks[tasks.length - 1];
      return {
        enabled: true,
        tools: AGENT_TOOLS_COUNT_FOR_HEALTH,
        tasks: tasks.length,
        lastStatus: last ? last.status : null,
        lastVerified: last ? Boolean(last.verified) : null,
        providers: describeProvidersForHealth(),
      };
    })(),
    // دليل النشر: أي commit يعمل فعلاً (Render يضبط RENDER_GIT_COMMIT). يُقرأ هنا
    // مباشرةً لإثبات أن الكود المنشور هو المدفوع، لا استنتاجاً من السلوك.
    deploy: deploymentInfo(),
    // حالة الثبات: تُعلن بصراحة هل تُفقد الجلسات بين العمليات، وهل تنجو بيانات
    // العمل من إعادة النشر. لا تُكشف أي قيمة سرية هنا، ولا يُدّعى الدوام بلا مخزن.
    persistence: (() => {
      const status = storageStatus();
      // "ephemeral" = لا مخزن دائم: الملف المحلي على Render Free يُمسح عند كل نشر.
      const durable = status.durable;
      return {
        backend: status.backend,
        durable,
        mode: durable ? "durable" : "ephemeral",
        healthy: status.healthy,
        stateWritable: status.writable,
        stateDir: status.stateDir,
        lastPersistError,
        warning: durable
          ? null
          : status.backend === "file"
            ? "MISSING DATABASE_URL: الحالة على ملف محلي غير دائم وستُفقد عند كل إعادة نشر. اضبط DATABASE_URL (Neon Free) لتفعيل Postgres."
            : `مخزن Postgres غير مهيّأ: ${status.detail || "غير متاح"}. لن تُحفظ الحالة حتى يعود الاتصال.`,
        sessionsDurable: SESSIONS_DURABLE,
        sessionSecretSource: SESSION_SECRET_SOURCE,
        challengeMode: "stateless-hmac",
        revocationsDurable: durable,
        // منطقي فقط بلا أي قيمة: يتيح للمالك التأكد من ضبط مسار الدخول المباشر
        // في بيئة النشر دون كشف التوكن أو تسجيله.
        previewLoginEnabled: Boolean((process.env.GHARABI_PREVIEW_TOKEN || "").trim()),
      };
    })(),
  });
});

// Protected AI budget status. It reports only this server's safety guard, not provider quota.
app.get("/api/ai/status", authenticateToken, (_req, res) => {
  res.json({ success: true, gemini: geminiStatus(), note: "هذه أرقام حماية محلية وليست حصة مزود الخدمة." });
});

/**
 * جدار حماية حصة Gemini المجاني — تشخيص للمالك فقط.
 * مركزي واحد للمشروع: لا يُفرّق بين المنصات في الحماية، واسم المنصة تشخيص فقط.
 * لا يُعيد أي مفتاح ولا prompt ولا استجابة، والحد المُعلن «حد الحماية المحلي للمشروع».
 */
app.get("/api/ai/firewall", requireOwner, (_req, res) => {
  const status = aiUsageGuard.status();
  res.json({
    success: true,
    firewall: buildUsageDiagnostics({
      counters: aiLedger.snapshot(),
      last: aiLedger.lastProvider(),
      usedToday: status.usedToday,
      limit: status.limit,
      protectionEnabled: GEMINI_FREE_TIER_PROTECTION,
      providerConfigured: aiEngine.providerConfigured,
      providerVerified: aiLiveVerification.state === 'ok',
    }),
    /** المنصات المعروفة للتشخيص فقط — كلها تشترك في الميزانية نفسها. */
    knownPlatforms: [...KNOWN_AI_PLATFORMS],
    scope: 'project-wide',
    platformSpecificQuota: false,
    promptLimit: { maxPromptChars: DEFAULT_MAX_PROMPT_CHARS, maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS },
    note: 'حماية مركزية واحدة لكل المنصات (الحالية والمستقبلية) — لا يوجد حد منصة منفصل، والحد المُعلن حد حماية محلي للمشروع لا حصة Google.',
  });
});

// Central orchestration: deterministic routing first, without consuming Gemini quota
app.post("/api/ai/orchestrate", authenticateToken, (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ success: false, error: "الرسالة مطلوبة." });

  const text = message.toLowerCase();
  const platforms = [
    ["tiktok", "تيك توك"], ["youtube", "يوتيوب"], ["facebook", "فيسبوك"],
    ["instagram", "انستغرام"], ["whatsapp", "واتساب"], ["telegram", "تلغرام"],
    ["x", "تويتر"], ["snapchat", "سناب"], ["threads", "ثريدز"], ["google_business", "جوجل"],
  ];
  const detectedPlatforms = platforms.filter(([id, ar]) => text.includes(id) || text.includes(ar)).map(([id]) => id);
  let intent = "general";
  let targetModule = "agent";
  if (/منشور|محتوى|فيديو|ريلز|ستوري|حملة|اعلان/.test(text)) { intent = "content"; targetModule = "content"; }
  else if (/عميل|رسالة|محادثة|استفسار|شكوى/.test(text)) { intent = "customer_support"; targetModule = "customers"; }
  else if (/منتج|سعر|مخزون|جهاز|هاتف|مواد بناء/.test(text)) { intent = "product_data"; targetModule = "database"; }
  else if (/تقويم|جدول|موعد|مجدول/.test(text)) { intent = "scheduling"; targetModule = "calendar"; }
  else if (/تحليل|احصائ|أداء|تفاعل|متابع/.test(text)) { intent = "analytics"; targetModule = "analytics"; }
  else if (/مستخدم|موظف|صلاحية|دور/.test(text)) { intent = "team"; targetModule = "users"; }

  return res.json({
    success: true,
    intent,
    targetModule,
    platforms: detectedPlatforms,
    requiresGemini: intent === "content" || intent === "general",
    approvalRequired: intent === "content",
    message: "تم توجيه الطلب إلى الوحدة المناسبة دون استهلاك Gemini."
  });
});

// 1. Generate Platform-Specific Content (Authenticated users only)
app.post("/api/ai/generate-content", authenticateToken, async (req, res) => {
  try {
    const user = (req as any).user as ServerUser;
    if (!rateLimitAI(user.id)) return res.status(429).json({ success: false, error: "تم تفعيل حماية الطلبات: انتظر دقيقة قبل إرسال طلبات AI إضافية.", generatedBy: "local-guard" });
    audit(user.id, "generate_content");
    const {
      platform,
      contentType,
      topic,
      tone = "professional",
      productName,
      productId,
      installmentDetails,
      customInstructions,
    } = req.body;

    // المنتج الحقيقي من قاعدة بيانات المعرض إن حُدّد؛ وإلا يبقى السياق عاماً.
    const linkedProduct = productId
      ? workspace.products.find((p: any) => p.id === cleanText(productId, 100)) || null
      : productName
        ? workspace.products.find((p: any) => p.name === cleanText(productName, 160)) || null
        : null;

    const requestText = [topic, productName, linkedProduct?.name, installmentDetails, customInstructions].filter(Boolean).join("\n");
    // حارس المدخلات: لا نطلب من المزود عرضاً غير مسجّل أصلاً.
    const requestFacts = buildFactsForProduct(linkedProduct, Number(linkedProduct?.downPaymentPercent || 0), Number(linkedProduct?.durationMonths || 0));
    const requestCheck = analyzeRequestClaims(requestText, requestFacts);
    if (!requestCheck.safe) {
      return res.status(422).json({
        success: false,
        error: "الطلب يشمل عرضاً تجارياً غير مسجّل في بيانات المعرض.",
        violations: describeViolations(requestCheck.blocked),
        code: requestCheck.blocked[0]?.code || "business_claim_not_recorded",
        note: "أزل العرض غير المسجّل، أو سجّل بياناته الحقيقية في قاعدة بيانات المعرض أولاً.",
      });
    }


    const systemPrompt = `أنت المساعد الذكي الرسمي والمؤلف الإعلاني لـ "معرض الغرابي للتقسيط".
معرض الغرابي يقدم حلول تقسيط وتسهيلات مرنة وإجراءات معتمدة وواضحة.

المطلوب: توليد محتوى تسويقي احترافي مخصص لمنصة: "${platform || 'عامة'}"
نوع المحتوى: "${contentType || 'منشور'}"
الموضوع/المنتج: "${topic || productName || 'عروض التقسيط الميسر'}"
النبرة: "${tone}"
تفاصيل القسط والمنتج إن وجدت: "${installmentDetails || ''}"
تعليمات إضافية: "${customInstructions || ''}"

إرشادات المنصات:
- TikTok: ركز على الهوك الأول (Hook) في البداية، نص سريع وجذاب، هاشتاغات مناسبة (#تقسيط_ميسر #معرض_الغرابي #عروض_التقسيط).
- Instagram: صياغة بصرية مرتبة بفواصل أنيقة، توضيح شروط التقسيط، ودعوة مباشرة للتواصل عبر الرسائل الخاصة أو الرابط في البايو.
- YouTube: عنوان ملفت وجذاب، وصف متكامل ومفصل، وكلمات مفتاحية دقيقة.
- X (Twitter): تغريدة أو ثريد مباشر يبرز مزايا وأنظمة التقسيط والتسهيلات التنافسية.
- Snapchat: سيناريو ستوري مقسم لـ 3 لقطات (اللقطة 1: لفت الانتباه، اللقطة 2: المزايا والتفاصيل، اللقطة 3: اسحب الشاشة للتواصل).
- Facebook: منشور تسويقي مفصل يوضح الفئات المستهدفة، التسهيلات، وإجراءات التقسيط.
- WhatsApp / Telegram: رسالة برودكاست منظمة بنقاط وأيقونات جذابة وروابط تواصل مباشرة.
- Google Business Profile: تحديث إخباري محلي لمعرض الغرابي يوضح أحدث العروض وساعات العمل مع دعوة للزيارة أو الاتصال.

ملاحظة هامة:
لا تقم باختراع أرقام هواتف أو عناوين وهمية أو أسماء موظفين، واعتمد حصراً على المعلومات المحددة من إدارة المعرض.
يُمنع منعاً تاماً ذكر أي عرض تجاري غير موجود في المعطيات أعلاه: لا أسعار، ولا خصومات، ولا «بدون دفعة أولى»، ولا شروط تقسيط، ولا ضمان، ولا توفر مخزون، ولا روابط، ولا أرقام تواصل. إن لم تتوفر معلومة فاحذفها أو استخدم صياغة عامة لا تدّعي وجودها.
أجب باللغة العربية بأسلوب احترافي رفيع دون أي مقدمات إنجليزية.`;

    const cacheKey = `content:${JSON.stringify({ platform, contentType, topic, tone, productName, productId: linkedProduct?.id || null, installmentDetails, customInstructions })}`;
    const result = await aiEngine.run({
      cacheKey,
      prompt: systemPrompt,
      deterministicFallback: () => generateSmartFallbackContent(platform, contentType, topic || productName, installmentDetails),
      // بيانات تشخيصية فقط: لا تُغيّر أي قرار حماية، والميزانية مشتركة للمشروع.
      meta: { platform: normalizePlatformLabel(platform), operation: 'content_generation' },
    });

    // حارس المخارج: يُفحص النص الفعلي (سواء من المزود أو البديل) مقابل بيانات
    // المعرض، فلا يعتمد المنع على تعليمات الـprompt وحدها.
    const outputFacts = buildFactsForProduct(linkedProduct, Number(linkedProduct?.downPaymentPercent || 0), Number(linkedProduct?.durationMonths || 0));
    const outputCheck = analyzeBusinessClaims(result.text, outputFacts);

    // المزود المتعطل لا يُسقط المسار، لكن ادعاءً تجارياً غير مسجّل يُسقط النص:
    // لا يُعاد محتوى يخالف قواعد المشروع مهما كان مصدره.
    const safeContent = outputCheck.safe
      ? result.text
      : generateSmartFallbackContent(platform, contentType, topic || productName, "");

    // تكييف حتمي لكل منصة مطلوبة من **نفس النص المُتحقَّق منه** — بلا أي نداء
    // مزود إضافي. طلب واحد لعدة منصات = نداء Gemini واحد + تكييف حتمي لكل منصة.
    // **مصدر الحقيقة هو طلب العميل (اختيار المالك)** لا قائمة ثابتة: كان يُعاد
    // تكييف للمنصات العشر كلها دائماً حتى لو اختار المالك منصة واحدة، فتظهر في
    // الواجهة تبويبات منصات لم يخترها. الآن: المنصات المطلوبة فقط، وإن لم تُطلب
    // أي منصة نُبني المنصة الأساسية وحدها (لا نشر/عرض لمنصة غير مختارة).
    const requestedPlatforms: string[] = Array.isArray(req.body?.platforms)
      ? Array.from(new Set<string>(req.body.platforms
          .map((p: any) => cleanText(p, 40))
          .filter((v: string) => Boolean(v) && SUPPORTED_PLATFORMS.some((sp: any) => sp.id === v))))
      : [];
    const basePlatform = isSupportedPlatform(String(platform)) ? String(platform) : "";
    const adaptationTargets = Array.from(new Set<string>([
      ...(basePlatform ? [basePlatform] : []),
      ...requestedPlatforms,
    ]));
    const adaptedVersions = Object.fromEntries(
      adaptationTargets.map((p) => [p, adaptContentForPlatform(p, safeContent)]),
    );

    return res.json({
      success: true,
      content: safeContent,
      platform,
      contentType,
      // نسخ المنصات تُبنى حتمياً من النص المُتحقَّق منه، فلا تُضاف أي معلومة جديدة
      // (سعر/دفعة/ضمان/رقم) خارج ما تم فحصه.
      adaptedVersions,
      generatedBy: outputCheck.safe
        ? result.usedProvider
          ? (result.model || PRODUCTION_MODEL)
          : result.source === "cache" ? "ai-cache" : "local-smart-engine"
        : "local-smart-engine",
      aiSource: outputCheck.safe ? result.source : "fallback",
      // سبب اللجوء للبديل للتشخيص الداخلي: يمنع إخفاء مشكلة المزود تحت نجاح HTTP.
      fallbackReason: outputCheck.safe ? result.fallbackReason : "business_claim_not_recorded",
      notice: outputCheck.safe
        ? result.notice
        : "تم حجب نص المزود لأنه تضمّن عرضاً تجارياً غير مسجّل في بيانات المعرض، واستُخدم نص حتمي عام بدلاً منه.",
      model: outputCheck.safe ? result.model : null,
      // سبب الحجب معلن صراحةً (بلا أي تفاصيل داخلية حساسة).
      contentSafety: {
        safe: outputCheck.safe,
        violations: describeViolations(outputCheck.blocked),
        codes: outputCheck.blocked.map((v) => v.code),
      },
    });
  } catch (error: any) {
    // حتى الخطأ غير المتوقع يعيد بديلاً صالحاً بدل إسقاط الطلب.
    res.status(200).json({
      success: true,
      content: generateSmartFallbackContent(req.body.platform, req.body.contentType, req.body.topic, ""),
      platform: req.body.platform,
      contentType: req.body.contentType,
      generatedBy: "local-smart-engine",
      aiSource: "fallback",
      fallbackReason: "unknown_error",
      model: null,
      notice: "تعذر استخدام محرك الذكاء الاصطناعي؛ تم استخدام المحرك المحلي الحتمي.",
    });
  }
});

/**
 * تكييف النص لكل منصة.
 *
 * ملاحظة جوهرية: التكييف **حتمي 100%** ولا يستهلك أي حصة AI، ولا يعيد كتابة
 * الأرقام أو العروض. يعيد استخدام **نفس الحقائق المسجّلة** المستخدمة في النص
 * الأصلي مع تنسيق فقط (هاشتاغ، طول، أسلوب). هذا يمنع أن يخترع النموذج عرضاً
 * جديداً أثناء «إعادة الصياغة»، وهو منفذ شائع لاختراع «بدون دفعة أولى».
 */
function adaptContentForPlatform(platform: string, baseText: string): string {
  const text = cleanText(baseText, 10000);
  if (!text) return "";
  const hashtags = "#معرض_الغرابي #تقسيط #تسهيلات";
  // الحدّ والعدّ من المصدر الواحد (Threads = 500 بأسلوب UTF-8 bytes، وثيقة Meta).
  const limit = platformTextLimit(platform) ?? 4096;

  if (platform === "x") {
    const tweet = text.replace(/\s+/g, " ").trim();
    const withTags = tweet.includes("#") ? tweet : `${tweet} ${hashtags}`;
    return countForPlatform(platform, withTags).used <= limit ? withTags : shortenToPlatformLimit(platform, withTags, limit).text;
  }
  if (platform === "snapchat") {
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, 3);
    const body = lines.map((l, i) => `${i + 1}) ${l}`).join("\n");
    const composed = body.length ? `لقطة 1..2..3:\n${body}` : text;
    return countForPlatform(platform, composed).used <= limit ? composed : shortenToPlatformLimit(platform, composed, limit).text;
  }
  if (platform === "tiktok") {
    const first = text.split(/\n+/).map((l) => l.trim()).filter(Boolean)[0] || text;
    const composed = `${first.slice(0, 150)}\n\n${text}\n\n${hashtags}`;
    return countForPlatform(platform, composed).used <= limit ? composed : shortenToPlatformLimit(platform, composed, limit).text;
  }
  // المنصات الأخرى: النص كما هو مع إضافة الهاشتاغ عند غيابه، ثم **فرض الحد
  // الفعلي**. هذا الجذر الحقيقي لعطل Threads: كان النص يمرّ كاملاً (وبـUTF-16)
  // فيرفضه المزود «Param text must be at most 500 characters long». الاختصار
  // حتمي عند حدود الأسطر/الكلمات ولا يعيد كتابة أي معلومة.
  const composed = text.includes("#") ? text : `${text}\n\n${hashtags}`;
  return countForPlatform(platform, composed).used <= limit ? composed : shortenToPlatformLimit(platform, composed, limit).text;
}

// 2. Classify Customer Message & Suggest Reply (Authenticated users only)
app.post("/api/ai/classify-message", authenticateToken, async (req, res) => {
  try {
    const user = (req as any).user as ServerUser;
    if (!rateLimitAI(user.id)) return res.status(429).json({ success: false, error: "تم تفعيل حماية الطلبات: انتظر دقيقة قبل إرسال طلبات AI إضافية." });
    audit(user.id, "classify_message");
    const { customerName, message, channel, showroomInfo } = req.body;

    const prompt = `أنت مساعد خدمة العملاء الذكي في "معرض الغرابي للتقسيط".
رسالة العميل (${customerName || 'عميل'} عبر ${channel || 'القناة'}): "${message}"

سياسات ومعلومات المعرض المرجعية:
${showroomInfo ? JSON.stringify(showroomInfo) : 'معرض الغرابي للتقسيط - أنظمة تمويل وتقسيط ميسرة.'}

المطلوب إرجاع رد بصيغة JSON حصراً بالشكل التالي:
{
  "category": "تصنيف الاستفسار (مثال: استفسار عن قسط / شروط ومستندات / موقع المعرض / استفسار عن دفعة أولى / شكوى / تفاوض / جاهز للتعاقد)",
  "urgency": "عاجل | متوسط | عادي",
  "needsHumanHandoff": true/false (إذا كان العميل غاضباً أو يريد التفاوض النهائي أو يطلب مستشار مالي شخصي اجعلها true),
  "suggestedReply": "نص الرد المقترح المهذب والدقيق والمرحب بالعميل دون ذكر أرقام هواتف أو عناوين غير محددة",
  "extractedEntities": {
    "productName": "اسم المنتج أو الموديل إن ذكر",
    "budget": "الميزانية إن ذكرت"
  }
}`;

    // التصنيف الحتمي هو الأساس: لا يستهلك حصة، ويعمل حتى عند تعطل المزود.
    const deterministicClassification = classifyMessageDeterministic(customerName, message);
    const cacheKey = `classify:${JSON.stringify({ customerName, message, channel, showroomInfo })}`;
    const result = await aiEngine.run({
      cacheKey,
      prompt,
      json: true,
      deterministicFallback: () => JSON.stringify(deterministicClassification),
      // بيانات تشخيصية فقط — نفس الميزانية المشتركة للمشروع.
      meta: { platform: normalizePlatformLabel(channel), operation: 'message_classification' },
    });

    let parsed: any = deterministicClassification;
    let providerValidated = false;
    if (result.usedProvider || result.source === "cache") {
      try {
        const candidate = JSON.parse(result.text);
        // ندمج مخرجات المزود مع التصنيف الحتمي لضمان اكتمال كل الحقول.
        parsed = { ...deterministicClassification, ...candidate };
        providerValidated = true;
      } catch {
        parsed = deterministicClassification;
      }
    }

    // -------- حارس سلامة المحتوى على الرد المقترح (من جهة الخادم) --------
    // لا يصل أي suggestedReply إلى الواجهة دون المرور بـ analyzeBusinessClaims.
    // أي ادعاء تجاري غير مسجّل (عرض/خصم/ضمان/رقم/رابط/سعر) يُحجب: يُستبدل برد
    // حتمي آمن، وإن لم ينجُ البديل أيضاً يُعرض نص محايد لا يدّعي أي معلومة.
    const facts = buildShowroomFacts();
    const safeReply = buildSafeBusinessReply(
      typeof parsed.suggestedReply === "string" ? parsed.suggestedReply : "",
      facts,
      () => classifyMessageDeterministic(customerName, message).suggestedReply,
    );
    const contentSafety = {
      // safe: هل الرد المعروض سليم؟ blocked: هل حُجب ادعاء من نص المزود؟
      safe: safeReply.report.safe,
      blocked: !safeReply.originalReport.safe,
      codes: safeReply.originalReport.blocked.map((v) => v.code),
      violations: describeViolations(safeReply.originalReport.blocked),
    };

    // الرد المعروض آمن دائماً بالبناء (buildSafeBusinessReply). إن استُبدل نص
    // المزود ببديل حتمي، صار المصدر حتمياً وتُرصد مراجعة بشرية.
    let requiresHumanReview = Boolean(parsed.needsHumanHandoff);
    if (safeReply.replaced) {
      parsed.needsHumanHandoff = true;
      requiresHumanReview = true;
    }

    const aiSource = providerValidated ? result.source : "fallback";
    const fallbackReason = !providerValidated
      ? (result.fallbackReason || (result.source === "cache" ? "provider_error" : "provider_not_configured"))
      : safeReply.replaced
        ? "content_safety"
        : result.fallbackReason;

    return res.json({
      success: true,
      ...parsed,
      suggestedReply: safeReply.text,
      requiresHumanReview,
      generatedBy: providerValidated && !safeReply.replaced ? (result.model || PRODUCTION_MODEL) : "local-deterministic-engine",
      aiSource,
      fallbackReason,
      model: aiSource === "provider" ? result.model : null,
      notice: result.notice,
      contentSafety,
    });
  } catch (error: any) {
    // مسار الطوارئ: حتى هنا يمر الرد الحتمي عبر حارس المحتوى قبل عرضه.
    const fallbackClassification = classifyMessageDeterministic(req.body?.customerName, req.body?.message);
    const facts = buildShowroomFacts();
    const safeReply = buildSafeBusinessReply(fallbackClassification.suggestedReply, facts, () => fallbackClassification.suggestedReply);
    res.status(200).json({
      success: true,
      ...fallbackClassification,
      suggestedReply: safeReply.text,
      requiresHumanReview: safeReply.replaced ? true : fallbackClassification.needsHumanHandoff,
      generatedBy: "local-deterministic-engine",
      aiSource: "fallback",
      fallbackReason: "unknown_error",
      model: null,
      contentSafety: {
        safe: safeReply.report.safe,
        blocked: !safeReply.report.safe,
        codes: safeReply.report.blocked.map((v) => v.code),
        violations: describeViolations(safeReply.report.blocked),
      },
    });
  }
});

/** تصنيف حتمي للرسالة: يعمل بدون أي مزود خارجي. */
function classifyMessageDeterministic(customerName: string | undefined, message: string | undefined) {
    const lower = (message || "").toLowerCase();
    let category = "استفسار عام عن التقسيط";
    let needsHumanHandoff = false;
    let urgency = "متوسط";

    if (lower.includes("شروط") || lower.includes("اوراق") || lower.includes("مستندات") || lower.includes("راتب")) {
      category = "شروط التقسيط والمستندات المطلوبة";
    } else if (lower.includes("قسط") || lower.includes("دفعة") || lower.includes("سعر") || lower.includes("حسبة")) {
      category = "حساب الأقساط والدفعة الشهرية";
    } else if (lower.includes("موقع") || lower.includes("مكان") || lower.includes("ساعات") || lower.includes("فرع")) {
      category = "موقع المعرض وساعات العمل";
    } else if (lower.includes("شكوى") || lower.includes("مدير") || lower.includes("موظف") || lower.includes("تاخير")) {
      category = "طلب محادثة موظف / متابعة خاصة";
      needsHumanHandoff = true;
      urgency = "عاجل";
    }

    const fallbackReply = `أهلاً بك يا ${customerName || 'عزيزنا العميل'} في معرض الغرابي للتقسيط.
يسعدنا خدمتكم وتزويدكم بكافة تفاصيل وأنظمة التقسيط المتاحة.
يمكنكم تزويدنا بتفاصيل طلبكم ليقوم مستشار المبيعات بمراجعتها وتقديم الحسبة المناسبة لكم فوراً.`;

    return {
      category,
      urgency,
      needsHumanHandoff,
      suggestedReply: fallbackReply,
      extractedEntities: {},
    };
}

// 3. Central Showroom AI Agent Chat & Strategist (Authenticated users only)
app.post("/api/ai/agent-chat", authenticateToken, async (req, res) => {
  try {
    const user = (req as any).user as ServerUser;
    if (!rateLimitAI(user.id)) return res.status(429).json({ success: false, reply: "تم تفعيل حماية الطلبات مؤقتاً لتجنب استنزاف الحصة. استخدم المحرك المحلي أو انتظر دقيقة." });
    audit(user.id, "agent_chat");
    const { message, chatHistory = [], context } = req.body;

    const systemPrompt = `أنت "الغرابي AI" - الوكيل الذكي المركزي ومستشار العمليات التسويقية والتشغيلية لمعرض الغرابي للتقسيط.
مهامك:
1. المساعدة في إدارة وتسويق خدمات ومنتجات معرض الغرابي للتقسيط عبر جميع القنوات والمنصات المعتمدة.
2. المساعدة في صياغة منشورات وحملات تسويقية مبتكرة للمنصات (TikTok, YouTube, Facebook, Instagram, WhatsApp, Telegram, X, Snapchat, Threads, Google Business).
3. تحليل الأداء واقتراح استراتيجيات عملية لرفع التفاعل وخدمة العملاء.
4. عدم افتراض أو توليد أرقام هواتف أو عناوين وهمية أو أسماء موظفين، والاعتماد حصراً على ما يحدده مالك النظام في قاعدة البيانات.

نبرتك: احترافية، راقية، دقيقة ومباشرة.
سياق النظام الحالي: ${JSON.stringify(context || {})}
رسالة المستخدم: ${message}`;

    const cacheKey = `agent:${JSON.stringify({ message, chatHistory, context })}`;
    const result = await aiEngine.run({
      cacheKey,
      prompt: systemPrompt,
      deterministicFallback: () => buildDeterministicAgentReply(message, context),
      // بيانات تشخيصية فقط (وكيل مركزي) — الميزانية مشتركة مع كل المنصات.
      meta: { platform: normalizePlatformLabel(context?.platform), operation: 'agent_reasoning' },
    });

    // لا يعود للمستخدم نص يدّعي عرضاً أو رقماً غير مسجّل، حتى من المزود.
    const safed = ensureSafeBusinessText(result.text, buildShowroomFacts(), () => buildDeterministicAgentReply(message, context));

    return res.json({
      success: true,
      reply: safed.text,
      generatedBy: (result.usedProvider && !safed.replaced) ? (result.model || PRODUCTION_MODEL) : result.source === "cache" && !safed.replaced ? "ai-cache" : "local-deterministic-engine",
      aiSource: (!safed.replaced && result.source) || "fallback",
      fallbackReason: safed.replaced ? "business_claim_not_recorded" : result.fallbackReason,
      model: safed.replaced ? null : result.model,
      notice: safed.replaced
        ? "تم حجب نص تضمّن ادعاءً تجارياً غير مسجّل في بيانات المعرض، واستُخدم رد حتمي مطابق للبيانات."
        : result.notice,
    });
  } catch (error: any) {
    res.status(200).json({
      success: true,
      reply: buildDeterministicAgentReply(req.body?.message, req.body?.context),
      generatedBy: "local-deterministic-engine",
      aiSource: "fallback",
      fallbackReason: "unknown_error",
      model: null,
    });
  }
});

/** رد حتمي مركّز حسب نمط طلب المستخدم — يعمل بدون أي مزود خارجي. */
function buildDeterministicAgentReply(message: string | undefined, context: any): string {
  const text = (message || "").trim();
  const lower = text.toLowerCase();
  const platformName = typeof context?.platform === "string" ? context.platform : "";
  const taskType = typeof context?.taskType === "string" ? context.taskType : "";

  const scopeLine = platformName && platformName !== "all"
    ? `النطاق المحدد: ${platformName}.`
    : "النطاق: كافة المنصات الموحدة.";

  if (taskType === "schedule") {
    return `${scopeLine}
دراسة أوقات الزخم:
• الأوقات المقترحة أدناه تقديرية مبنية على طبيعة الجمهور العراقي، وليست مقاسة من بيانات المنصة بعد.
• الفترة المسائية (8-11 مساءً) هي الأكثر ملاءمة للعروض والمنتجات المنزلية.
• الفترة الصباحية مناسبة لرسائل المتابعة والردود على الاستفسارات.
• لا يمكن الجزم بأفضل وقت فعلي قبل توفر مؤشرات أداء حقيقية من المنصة.`;
  }

  if (taskType === "behavior_analysis") {
    return `${scopeLine}
تحليل نية العميل:
• ابحث عن سبب التردد الحقيقي: القدرة على الدفعة الأولى، أو الخوف من التعقيد الإجرائي.
• تجنّب الضغط المباشر، وركّز على وضوح الخطوات والمستندات المطلوبة.
• الرد المقترح: مراجعة مهذبة توضح أن الإجراءات رسمية وواضحة، مع دعوة لتزويدنا بالتفاصيل لإعداد الحسبة المناسبة.`;
  }

  if (taskType === "decision") {
    return `${scopeLine}
قرار تنفيذي مقترح:
• ابدأ بحملة موحدة على المنصات الأعلى وصولاً متى توفرت بيانات الأداء.
• وزّع المهام: صياغة المحتوى، مراجعة الجودة، الرد على الاستفسارات، ومتابعة النتائج.
• قياس النجاح يعتمد على مؤشرات المنصة المتاحة فعلياً، وتُسجَّل النتائج في سجل الأداء لتحسين القرار القادم.`;
  }

  if (text) {
    return `${scopeLine}
ملاحظات على المعطيات الميدانية: "${text.slice(0, 300)}"
التوجيه التنفيذي:
1. حدّد الجمهور المستهدف بوضوح (موظفون، متقاعدون، حاملو الماستر كارد، أسر حديثة التكوين).
2. اختر الصيغة المناسبة لكل منصة بدل استخدام نص واحد للجميع.
3. اربط كل منشور بمؤشر نجاح متاح فعلياً من المنصة.
4. سجّل النتائج بعد النشر لبناء قياس حقيقي قبل أي تعديل استراتيجي.`;
  }

  return `أهلاً بك في الغرابي AI!
أنا جاهز لمساعدتك في كل ما يخص إدارة معرض الغرابي للتقسيط:
• صياغة وجدولة المحتوى لجميع المنصات الاجتماعية العشر.
• مساعدة فريق العمل في تصنيف استفسارات العملاء واقتراح الردود المناسبة.
• تحسين عروض وأنظمة التقسيط المسجلة في قاعدة بيانات المعرض.
كيف يمكنني مساعدتك في مهام المعرض اليوم؟`;
}

// -------------------------------------------------------------
// وكيل الغرابي الذكي — مهمة المحتوى التسويقي العربية (حتمي بالكامل).
// لا يستدعي Gemini، ولا يتطلب أي حساب اجتماعي متصل، ولا يدّعي نشراً خارجياً.
// يعتمد حصراً على بيانات المعرض الحقيقية المحفوظة على الخادم.
// -------------------------------------------------------------
const MARKETING_GOALS: Record<string, { label: string; angle: string }> = {
  offer: { label: "عرض سعر وتقسيط", angle: "إبراز سعر الكاش والقسط الشهري والدفعة الأولى" },
  product_intro: { label: "تعريف بمنتج", angle: "تعريف مختصر بالمواصفات والاستخدام" },
  installment_terms: { label: "توضيح شروط التقسيط", angle: "شرح المستندات والخطوات دون وعود غير مؤكدة" },
  trust_builder: { label: "بناء الثقة", angle: "إبراز وضوح الإجراءات والمتابعة الرسمية" },
  follow_up: { label: "متابعة وتذكير", angle: "تذكير مهذب بعرض قائم ودعوة للتواصل" },
};

// PLATFORM_TEXT_LIMITS وحدود المنصات صارت مصدراً واحداً في engine/social/textLimits.ts
// (تُستورد أعلاه) لأن Threads يعدّ الطول بـUTF-8 bytes لا بوحدات UTF-16.

// Guards that mirror the project rules: no automotive content, no legacy fake counter.
const FORBIDDEN_CONTENT_PATTERN = /سيارة|سيارات|automotive|\bcars?\b/i;
const LEGACY_COUNTER_PATTERN = /125\s*\/\s*125/;

/**
 * يبني الحقائق التجارية المتاحة فعلاً في بيانات المعرض لمنتج معيّن.
 *
 * الغرض: أي ادعاء في المحتوى المولّد (سعر، دفعة أولى، ضمان، توفر، رقم، رابط)
 * يجب أن يقابله رقم أو نص مسجّل هنا. الحقائق المشتقة (دفعة أولى، قسط شهري،
 * إجمالي أقساط) محسوبة رياضياً من السعر المسجّل وخطة التقسيط المسجّلة، فهي
 * مشروعة لا مُختلقة.
 */
function buildFactsForProduct(product: any | null, downPaymentPercent: number, durationMonths: number): BusinessFacts {
  const cashPrice = Number(product?.cashPrice);
  const hasPrice = Number.isFinite(cashPrice) && cashPrice > 0;
  const derived: number[] = [];
  if (hasPrice) {
    const percent = Number.isFinite(downPaymentPercent) ? Math.max(0, Math.min(99, downPaymentPercent)) : 0;
    const months = Number.isInteger(durationMonths) && durationMonths > 0 ? durationMonths : 1;
    const q = buildMarketingQuote(cashPrice, percent, months);
    derived.push(q.cashPrice, q.downPayment, q.financedAmount, q.monthlyPayment, q.totalInstallments);
  }
  const showroom: any = workspace.showroom || {};
  const urls = [product?.image].map((x: any) => cleanText(x, 500)).filter(Boolean);
  return buildBusinessFacts({
    cashPrices: hasPrice ? [cashPrice] : [],
    derivedAmounts: derived,
    downPaymentPercents: Number.isFinite(Number(product?.downPaymentPercent)) ? [Number(product.downPaymentPercent)] : [],
    // أرقام التواصل الحقيقية فقط؛ غيابها يعني عدم إدراج أي رقم إطلاقاً.
    phones: [showroom.phoneUnified, showroom.whatsappSales],
    urls,
    inStock: typeof product?.inStock === "boolean" ? product.inStock : null,
    promotions: [showroom.promotions, showroom.activeOffer].map((x: any) => cleanText(x, 300)).filter(Boolean),
    allowedPhrases: [
      ...(Array.isArray(product?.installmentOptions) ? product.installmentOptions : []),
      ...(Array.isArray(product?.specs) ? product.specs : []),
      ...(Array.isArray(showroom.policies) ? showroom.policies : []),
      cleanText(showroom.about, 1000),
      cleanText(showroom.tagline, 240),
    ],
  });
}

/** ملخص عربي مختصر للانتهاكات يُعرض للمستخدم بلا كشف أي تفاصيل داخلية. */
function describeViolations(violations: BusinessClaimViolation[]): string[] {
  return [...new Set(violations.map((v) => v.detail))];
}

/**
 * حقائق المعرض العامة: تُستخدم للمسارات التي لا ترتبط بمنتج واحد (المحادثة
 * الذكية، الحملات العامة). لا سعر ولا رقم إطلاقاً، فيُحجب أي ادعاء رقمي.
 */
function buildShowroomFacts(): BusinessFacts {
  const showroom: any = workspace.showroom || {};
  return buildBusinessFacts({
    phones: [showroom.phoneUnified, showroom.whatsappSales],
    urls: [],
    inStock: null,
    promotions: [showroom.promotions, showroom.activeOffer].map((x: any) => cleanText(x, 300)).filter(Boolean),
    allowedPhrases: [
      ...(Array.isArray(showroom.policies) ? showroom.policies : []),
      cleanText(showroom.about, 1000),
      cleanText(showroom.tagline, 240),
    ],
  });
}

/**
 * حسم المنتج من معرّف/اسم موثّق. لا يُنشئ منتجاً وهمياً: غياب المطابقة يعني null.
 */
function resolveContentProduct(productId?: string | null, productName?: string | null): any | null {
  const id = cleanText(productId, 80);
  const name = cleanText(productName, 160);
  if (!id && !name) return null;
  return (workspace.products || []).find((p: any) => (id && p.id === id) || (name && p.name === name)) || null;
}

/**
 * يحدّد المنتج الوحيد المرتبط بفيديو YouTube حقيقي — دليل صريح فقط بلا تخمين:
 * (١) عنصر طابور محتوى نُشر فعلاً على نفس معرّف الفيديو ومربوط بمنتج (productId)،
 * أو (٢) سجل نشر حقيقي على نفس الفيديو يحدّد منتجاً.
 * عند تعدّد المنتجات (أو غياب الدليل) يُعيد `null` — فيبقى الرد تصعيداً بلا اختراع.
 */
function resolveYouTubeVideoProduct(videoId: string | null | undefined): { product: any | null; source: string | null } {
  const vid = String(videoId || '').trim();
  if (!vid) return { product: null, source: null };
  const candidateIds = new Set<string>();
  let source: string | null = null;
  for (const it of contentQueue) {
    if (String(it.externalVideoId || '') === vid && it.productId) { candidateIds.add(String(it.productId)); source = source || 'content_queue'; }
  }
  for (const rec of ((workspace as any).publishRecords || [])) {
    const recVid = String(rec?.externalVideoId || rec?.videoId || '');
    if (recVid === vid && rec?.productId) { candidateIds.add(String(rec.productId)); source = source || 'publish_record'; }
  }
  if (candidateIds.size !== 1) return { product: null, source: null };
  const id = [...candidateIds][0];
  const product = (workspace.products || []).find((p: any) => String(p.id) === id) || null;
  return { product, source: product ? source : null };
}

/**
 * حقائق الرد الموثّقة (ReplyFactSet) لمنتج محدّد — قيم مسجّلة فعلاً فقط.
 * مصدر واحد يُستخدم في مسار المراقب والمراجعة، فلا يختلف الرد عن بيانات المعرض.
 */
function replyFactsForProduct(product: any | null): ReplyFactSet {
  if (!product) return {};
  const showroom: any = workspace.showroom || {};
  const address = [showroom.address, showroom.city].map((x: any) => cleanText(x, 200)).filter(Boolean).join(' - ');
  const price = Number(product?.cashPrice);
  return {
    productName: product?.name ? cleanText(product.name, 120) : undefined,
    priceText: Number.isFinite(price) && price > 0 ? `${Math.round(price).toLocaleString('en-US')} د.ع` : undefined,
    locationText: address || undefined,
    hoursText: showroom.workingHours ? cleanText(showroom.workingHours, 120) : undefined,
    inStock: typeof product?.inStock === 'boolean' ? product.inStock : null,
    hasRecordedPromotion: [showroom.promotions, showroom.activeOffer].some((x: any) => cleanText(x, 300).length > 0),
  };
}

/**
 * هل يسمح استفسار هذا التعليق بردٍّ من بيانات المنتج المسجّلة فعلاً؟
 * الشروط مجتمعة: (١) التعليق استفسار سعر/قسط (topic=price أو استفسار تجاري)،
 * (٢) منتج محدّد بدليل، (٣) سعر مسجّل فعلاً، (٤) الرد المولّد يجتاز حارس
 * `analyzeBusinessClaims`. غياب أي شرط ⇒ `verified:false` (يبقى التصعيد).
 * مصدر واحد يُستخدم في النيّة (priceFactsVerified) وفي نقطة التنفيذ (نص الرد).
 */
function verifiedProductFactsForReply(input: { product: any | null; commentText: string }): { product: any | null; facts: ReplyFactSet; replyText: string; verified: boolean; reason: string } {
  const product = input.product;
  const facts = replyFactsForProduct(product);
  const cls = classifyComment(String(input.commentText || ''));
  const isPriceQuery = cls.topic === 'price' || cls.isBusinessInquiry;
  if (!isPriceQuery) return { product, facts, replyText: '', verified: false, reason: 'ليس استفسار سعر/قسط — لا يُطبَّق مسار حقائق المنتج.' };
  if (!product || !facts.priceText) {
    return { product, facts, replyText: '', verified: false, reason: 'لا يوجد منتج محدّد بسعر مسجّل — تُصعَّد القضية بلا اختراع.' };
  }
  const replyText = buildDeterministicReply(cls, facts.productName, facts);
  // الحارس النهائي: لا يُعلن الرد مؤكَّداً إن حمل ادعاءً غير مسجّل.
  const factsBusiness: BusinessFacts = buildFactsForProduct(product, Number(product?.downPaymentPercent || 0), Number(product?.durationMonths || 0));
  const safety = analyzeBusinessClaims(replyText, factsBusiness);
  if (!safety.safe) {
    return { product, facts, replyText, verified: false, reason: 'الرد المولّد حمل ادعاءً غير مسجّل — لا يُؤكَّد.' };
  }
  return { product, facts, replyText, verified: true, reason: 'رد من سعر/توفر المنتج المسجّل فعلاً ومرّ بحارس سلامة المحتوى.' };
}

/** يبني مدخلات وصف YouTube من بيانات المعرض الحقيقية فقط (بلا أي معلومة مُختلقة). */
function buildYouTubeDescriptionInput(productId?: string | null, productName?: string | null, extraInstructions?: string | null): YouTubeDescriptionInput {
  const product = resolveContentProduct(productId, productName);
  const showroom: any = workspace.showroom || {};
  return {
    product: product
      ? {
          name: cleanText(product.name, 120),
          category: cleanText(product.category, 40) || null,
          specs: Array.isArray(product.specs) ? product.specs : [],
          installmentOptions: Array.isArray(product.installmentOptions) ? product.installmentOptions : [],
          inStock: typeof product.inStock === 'boolean' ? product.inStock : null,
        }
      : null,
    showroomName: cleanText(showroom.name, 80) || null,
    tagline: cleanText(showroom.tagline, 160) || null,
    about: cleanText(showroom.about, 400) || null,
    city: cleanText(showroom.city, 60) || null,
    contact: { phone: cleanText(showroom.phoneUnified, 40) || null, whatsapp: cleanText(showroom.whatsappSales, 40) || null },
    extraInstructions: cleanText(extraInstructions, 400) || null,
  };
}

/**
 * يبني وصف YouTube التسويقي الإداري عبر العقل المركزي → AiEngine → Gemini Firewall.
 * الاستدعاء الوحيد المسموح لعملية AI على مسار المحتوى. مضمون بالبديل الحتمي
 * وبحارس سلامة المحتوى (لا وصف يحمل ادعاءً تجارياً غير مسجّل). بلا أي سرّ.
 */
async function generateYouTubeContentDescription(input: { productId?: string | null; productName?: string | null; extraInstructions?: string | null }): Promise<{
  description: string;
  source: string;
  usedProvider: boolean;
  safetyReplaced: boolean;
  factsUsed: string[];
  hashtags: string[];
}> {
  const descInput = buildYouTubeDescriptionInput(input.productId, input.productName, input.extraInstructions);
  if (!descInput.product && cleanText(input.productName, 160)) {
    descInput.product = { name: cleanText(input.productName, 120), category: null, specs: [], installmentOptions: [], inStock: null };
  }
  const deterministic = buildDeterministicYouTubeDescription(descInput);
  const fallbackText = () => buildDeterministicYouTubeDescription(descInput).description;
  const resolved = resolveContentProduct(input.productId, input.productName);
  const facts = resolved
    ? buildFactsForProduct(resolved, Number(resolved.downPaymentPercent || 0), Number(resolved.durationMonths || 0))
    : buildShowroomFacts();
  const cacheKey = `youtube:description:${JSON.stringify({ p: input.productId || null, n: input.productName || null, x: input.extraInstructions || null })}`;
  const result = await aiEngine.run({
    cacheKey,
    prompt: buildYouTubeDescriptionPrompt(descInput),
    deterministicFallback: fallbackText,
    meta: { platform: 'youtube', operation: 'youtube_description' },
  });
  // حارس السلامة على النص الفعلي (سواء من المزود أو البديل) عبر المصدر الواحد نفسه،
  // فلا يخرج وصف يحمل ادعاءً تجارياً غير مسجّل حتى لو كان البديل نفسه غير سليم.
  const safe = ensureSafeBusinessText(result.text, facts, () => deterministic.description);
  const description = safe.text.trim() || deterministic.description;
  return {
    description,
    source: result.source,
    usedProvider: result.usedProvider,
    safetyReplaced: safe.replaced,
    factsUsed: deterministic.factsUsed,
    hashtags: deterministic.hashtags,
  };
}

/**
 * يضمن أن أي نص يعود للمستخدم لا يحمل ادعاءً تجارياً غير مسجّل.
 * يُعيد النص إن كان سليماً، وإلا يُعيد البديل الحتمي إن كان سليماً أيضاً،
 * وإلا يُعيد نصاً عاماً محايداً لا يدّعي أي معلومة.
 */
function ensureSafeBusinessText(text: string, facts: BusinessFacts, fallback: () => string) {
  // نفس المنطق الصافي في contentSafety.buildSafeBusinessReply: مصدر واحد للحماية
  // يشترك فيه كل مسار يولّد نصاً تجارياً (توليد المحتوى، المحادثة، تصنيف الرسائل).
  const result = buildSafeBusinessReply(text, facts, fallback);
  return { text: result.text, check: result.report, replaced: result.replaced };
}

function formatIqd(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} د.ع`;
}

// Mirrors /api/catalog/quote: down payment then ceil-to-IQD monthly installment.
function buildMarketingQuote(cashPrice: number, downPaymentPercent: number, months: number) {
  const downPayment = Math.ceil((cashPrice * downPaymentPercent) / 100);
  const financedAmount = Math.max(0, cashPrice - downPayment);
  const monthlyPayment = Math.ceil(financedAmount / months);
  return {
    cashPrice, downPayment, financedAmount, months, monthlyPayment,
    totalInstallments: monthlyPayment * months, currency: "IQD" as const, rounding: "ceil-to-IQD",
  };
}

/** يقصّ نصاً عند حدود الكلمة **بالعدّ الصحيح للمنصة** (Threads = بايتات UTF-8)،
 *  ويعمل على code points فلا يكسر إيموجي مركّباً. لا يعدّل النص الأصلي، ويضيف «…».
 *  الحدّ يُقاس عبر المصدر الواحد engine/social/textLimits (countForPlatform). */
function trimToWordBoundary(platform: string, text: string, max: number): string {
  if (max <= 0) return "";
  if (countForPlatform(platform, text).used <= max) return text;
  const reserve = countForPlatform(platform, "").method === "utf8_bytes" ? 3 : 1; // «…» = 3 بايتات UTF-8
  let cut = "";
  for (const ch of text) { // التكرار على code points لا وحدات UTF-16 (لا كسر إيموجي)
    const next = cut + ch;
    if (countForPlatform(platform, next).used + reserve > max) break;
    cut = next;
  }
  const lastSpace = cut.lastIndexOf(" ");
  const useWord = lastSpace > cut.length * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${useWord.trimEnd()}…`;
}

// Composes the final platform text and guarantees it fits the platform limit by
// shortening the body first, then dropping hashtags. Never truncates mid-word.
// القياس بطريقة المنصة (Threads = UTF-8 bytes) عبر المصدر الواحد — لا text.length.
function composePlatformText(platform: string, headline: string, body: string, callToAction: string, hashtags: string[], limit: number) {
  let tags = hashtags.slice();
  let currentBody = body;
  const render = () => [headline, currentBody, callToAction, tags.join(" ")].filter((x) => x && x.trim()).join("\n\n");
  const used = (t: string) => countForPlatform(platform, t).used;
  let text = render();
  while (used(text) > limit && tags.length > 1) { tags = tags.slice(0, -1); text = render(); }
  if (used(text) > limit) {
    tags = [];
    const reserved = used(render()) - used(currentBody);
    currentBody = trimToWordBoundary(platform, currentBody, Math.max(0, limit - reserved));
    text = render();
  }
  if (used(text) > limit) text = trimToWordBoundary(platform, render(), limit);
  const finalUsed = used(text);
  return { text, hashtags: tags, charCount: finalUsed, limit, withinLimit: finalUsed <= limit };
}

// Per-platform Arabic copy. Uses only the real product/showroom facts it is given.
function buildPlatformCopy(input: {
  platform: string; platformName: string; goal: string; tone: string; task: string;
  productName: string; categoryLabel: string; quote: any | null; specs: string[];
  installmentOptions: string[]; showroom: any; contactLine: string; notes: string;
}) {
  const { platform, goal, tone, task, productName, categoryLabel, quote, specs, installmentOptions, showroom, contactLine, notes } = input;
  const showroomName = showroom?.name?.trim() || "معرض الغرابي للتقسيط";
  const goalLabel = MARKETING_GOALS[goal]?.label || MARKETING_GOALS.offer.label;
  const specLine = specs.length ? `المواصفات: ${specs.slice(0, 4).join("، ")}` : "";
  const optionsLine = installmentOptions.length ? `خيارات السداد: ${installmentOptions.slice(0, 4).join("، ")}` : "";
  const quoteLine = quote
    ? `سعر الكاش: ${formatIqd(quote.cashPrice)}\nالدفعة الأولى: ${formatIqd(quote.downPayment)}\nالقسط الشهري: ${formatIqd(quote.monthlyPayment)} لمدة ${quote.months} شهراً\nإجمالي الأقساط: ${formatIqd(quote.totalInstallments)}`
    : "";
  const hoursLine = showroom?.workingHours?.trim() ? `ساعات العمل: ${showroom.workingHours.trim()}` : "";
  const locationLine = [showroom?.address?.trim(), showroom?.city?.trim()].filter(Boolean).join(" - ");
  const notesLine = notes ? `ملاحظة: ${notes}` : "";

  const headlineByGoal: Record<string, string> = {
    offer: `${productName} بنظام التقسيط المريح من ${showroomName}`,
    product_intro: `تعرف على ${productName} المتوفر لدى ${showroomName}`,
    installment_terms: `شروط وخطوات تقسيط ${productName} في ${showroomName}`,
    trust_builder: `تقسيط ${productName} بإجراءات واضحة من ${showroomName}`,
    follow_up: `عرضك على ${productName} ما زال متاحاً في ${showroomName}`,
  };
  const headline = headlineByGoal[goal] || headlineByGoal.offer;

  const bodyBase = [
    `${goalLabel} — ${categoryLabel}`,
    `المطلوب: ${task}`,
    quoteLine,
    specLine,
    optionsLine,
  ].filter(Boolean).join("\n");

  const ctaDefault = contactLine || "تواصل مع فريق المعرض لمعرفة التفاصيل والخطة الأنسب لك.";
  const tagsBase = ["#معرض_الغرابي", "#تقسيط", "#العراق", `#${productName.replace(/\s+/g, "_")}`];

  switch (platform) {
    case "tiktok":
      return { headline, body: `🎬 هوك سريع (3 ثوان): "${productName} بخطة تقسيط تناسب دخلك!"\n\n${bodyBase}\n\n⏱️ لقطات مقترحة: 1) المنتج 2) القسط والدفعة الأولى 3) خطوات التقديم.`, cta: `📲 ${ctaDefault}`, hashtags: [...tagsBase, "#عروض_العراق", "#تقسيط_ميسر"] };
    case "instagram":
      return { headline, body: `✨ ${bodyBase}\n\n🔹 إجراءات ميسرة ومتابعة كاملة للطلب.\n🔹 ${hoursLine || "التفاصيل متاحة عبر الرسائل الخاصة."}`, cta: `💬 ${ctaDefault}`, hashtags: [...tagsBase, "#بغداد", "#أجهزة_منزلية"] };
    case "facebook":
      return { headline, body: `${bodyBase}\n\n📍 ${locationLine || "يمكنك التواصل لمعرفة أقرب طريقة لاستلام طلبك."}\n🕒 ${hoursLine || "أوقات العمل متاحة عبر التواصل."}\n${notesLine}`, cta: `✅ ${ctaDefault}`, hashtags: tagsBase };
    case "youtube":
      return { headline, body: `العنوان المقترح: ${headline}\n\nالوصف:\n${bodyBase}\n\n⏱️ الفواصل:\n00:00 مقدمة\n00:20 تفاصيل ${productName}\n01:00 ${quote ? "القسط والدفعة الأولى" : "خيارات التقسيط"}\n01:40 خطوات التقديم\n\nكلمات مفتاحية: تقسيط، ${productName}، ${showroomName}`, cta: ctaDefault, hashtags: tagsBase };
    case "x":
      return { headline: "", body: `${productName} | ${quote ? `قسط شهري ${formatIqd(quote.monthlyPayment)}` : "خطة تقسيط مرنة"}\n${contactLine || showroomName}`, cta: ctaDefault, hashtags: ["#تقسيط", "#العراق"] };
    case "snapchat":
      return { headline: "", body: `👻 لقطة 1: ${productName} متوفر الآن!\n👻 لقطة 2: ${quote ? `قسط شهري ${formatIqd(quote.monthlyPayment)}` : "خطة تقسيط ميسرة"}\n👻 لقطة 3: خطوات التقديم بسيطة وسريعة.`, cta: `اسحب للأعلى — ${ctaDefault}`, hashtags: ["#تقسيط", "#معرض_الغرابي"] };
    case "whatsapp":
      return { headline: "", body: `السلام عليكم 🌟\n${bodyBase}\n${hoursLine}`, cta: `للتفاصيل: ${contactLine || "أرسل لنا اسم المنتج والمدة المطلوبة."}`, hashtags: [] };
    case "telegram":
      return { headline: `📢 ${headline}`, body: bodyBase, cta: ctaDefault, hashtags: ["#تقسيط", "#معرض_الغرابي"] };
    case "threads":
      return { headline: "", body: `${productName}: ${quote ? `قسط شهري ${formatIqd(quote.monthlyPayment)}` : "خطة تقسيط مرنة"} — ${tone}`, cta: ctaDefault, hashtags: ["#تقسيط", "#العراق"] };
    case "google_business":
      return { headline, body: `تحديث من ${showroomName}\n${bodyBase}\n📍 ${locationLine || "زيارة المعرض للاطلاع على التفاصيل."}\n🕒 ${hoursLine || ""}`, cta: ctaDefault, hashtags: [] };
    default:
      return { headline, body: bodyBase, cta: ctaDefault, hashtags: tagsBase };
  }
}

// Shared deterministic generator: used by the single-task agent and by campaigns
// so both produce identical, rule-compliant Arabic copy from real showroom data.
function generateBriefContent(input: {
  task: string; goal: string; tone: string; notes: string; platforms: string[];
  product: any | null; productName: string; downPaymentPercent: number; durationMonths: number;
}) {
  const { task, goal, tone, notes, platforms, product, productName, downPaymentPercent, durationMonths } = input;
  const warnings: string[] = [];

  let quote: any = null;
  const cashPrice = Number(product?.cashPrice);
  if (Number.isFinite(cashPrice) && cashPrice > 0) {
    quote = buildMarketingQuote(cashPrice, downPaymentPercent, durationMonths > 0 ? durationMonths : 1);
    if (durationMonths <= 0) warnings.push("لم تُحدد مدة الأقساط، فتم استخدام شهر واحد لحسبة القسط. حدّد المدة لعرض أدق.");
    if (product?.inStock === false) warnings.push("المنتج غير متوفر حالياً في المخزون؛ راجع الكمية قبل نشر العرض.");
  } else {
    warnings.push("لا يوجد سعر نقدي مسجل لهذا المنتج، فلم تُدرج حسبة قسط. أضف السعر في قاعدة بيانات المعرض لدقة أعلى.");
  }

  // Contact data is only used when it is really configured; never fabricated.
  const contactParts = [workspace.showroom?.phoneUnified, workspace.showroom?.whatsappSales].map((x: any) => cleanText(x, 60)).filter(Boolean);
  const contactLine = contactParts.length ? `تواصل معنا: ${contactParts.join(" أو ")}` : "";
  if (!contactLine) warnings.push("لا يوجد رقم تواصل مسجل في بيانات المعرض، لذلك لم يُدرج أي رقم في المحتوى. سجّل الرقم من قاعدة بيانات المعرض.");
  if (!cleanText(workspace.showroom?.name, 160)) warnings.push("اسم المعرض غير مسجل في بيانات المعرض بعد؛ استخدم الاسم الافتراضي المعتمد.");

  const categoryLabels: Record<string, string> = { appliances: "أجهزة منزلية", phones: "هواتف ذكية", construction: "مواد بناء", electronics: "إلكترونيات", other: "منتجات المعرض" };
  const categoryLabel = categoryLabels[product?.category] || "منتجات المعرض";

  const content = platforms.map((platform: string) => {
    const platformName = SUPPORTED_PLATFORMS.find((p: any) => p.id === platform)?.name || platform;
    const copy = buildPlatformCopy({
      platform, platformName, goal, tone, task, productName, categoryLabel, quote,
      specs: Array.isArray(product?.specs) ? product.specs : [],
      installmentOptions: Array.isArray(product?.installmentOptions) ? product.installmentOptions : [],
      showroom: workspace.showroom, contactLine, notes,
    });
    const composed = composePlatformText(platform, copy.headline, copy.body, copy.cta, copy.hashtags, PLATFORM_TEXT_LIMITS[platform] || 2000);
    return { platform, platformName, headline: copy.headline, body: copy.body, callToAction: copy.cta, hashtags: composed.hashtags, charCount: composed.charCount, limit: composed.limit, withinLimit: composed.withinLimit, text: composed.text };
  });

  return { content, quote, warnings };
}

app.post("/api/ai/content-brief", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  if (!rateLimitAI(user.id)) return res.status(429).json({ success: false, error: "تم تفعيل حماية الطلبات: انتظر دقيقة قبل إرسال طلبات إضافية.", generatedBy: "local-guard" });

  const b = req.body || {};
  const task = cleanText(b.task, 600);
  if (!task || task.length < 3) return res.status(400).json({ success: false, error: "المهمة مطلوبة ويجب أن تكون واضحة (3 أحرف على الأقل)." });

  const goal = typeof b.goal === "string" && MARKETING_GOALS[b.goal] ? b.goal : "offer";
  const tone = cleanText(b.tone, 120) || "احترافية ومباشرة موجهة لعملاء التقسيط";
  const notes = cleanText(b.notes, 600);

  const requested = Array.isArray(b.platforms) ? b.platforms : [];
  const platforms = [...new Set(requested.filter((x: any) => typeof x === "string" && SUPPORTED_PLATFORMS.some((p: any) => p.id === x)))].slice(0, 10) as string[];
  if (!platforms.length) return res.status(400).json({ success: false, error: "اختر منصة واحدة على الأقل من المنصات المدعومة." });

  // Project rules are enforced before anything is generated.
  if (FORBIDDEN_CONTENT_PATTERN.test(`${task} ${notes}`)) return res.status(422).json({ success: false, error: "المهمة تحتوي على مصطلحات سيارات، وهي خارج نشاط معرض الغرابي للتقسيط." });
  if (LEGACY_COUNTER_PATTERN.test(`${task} ${notes}`)) return res.status(422).json({ success: false, error: "تم اكتشاف عداد استخدام قديم غير مسموح في المشروع." });

  let product: any = null;
  const productId = cleanText(b.productId, 100);
  if (productId) {
    product = workspace.products.find((p: any) => p.id === productId) || null;
    if (!product) return res.status(404).json({ success: false, error: "المنتج المحدد غير موجود في قاعدة بيانات المعرض." });
  }
  const manualName = cleanText(b.productName, 160);
  const productName = product?.name || manualName;
  if (!productName) return res.status(400).json({ success: false, error: "حدد منتجاً من قاعدة البيانات أو اكتب اسم المنتج." });

  const downPaymentPercent = Number.isFinite(Number(b.downPaymentPercent)) ? Math.max(0, Math.min(99, Math.floor(Number(b.downPaymentPercent)))) : Number(product?.downPaymentPercent || 0);
  const durationMonths = Number.isInteger(Number(b.durationMonths)) ? Math.max(1, Math.min(60, Number(b.durationMonths))) : Number(product?.durationMonths || 0);
  const cashPrice = Number(product?.cashPrice);

  // حارس المدخلات: لا تُطلب عروض غير مسجّلة من المحرك أصلاً (مثل «بدون دفعة أولى»).
  const briefRequestFacts = buildFactsForProduct(product, downPaymentPercent, durationMonths);
  const briefRequestCheck = analyzeRequestClaims(`${task}\n${notes}`, briefRequestFacts);
  if (!briefRequestCheck.safe) {
    return res.status(422).json({
      success: false,
      error: "المهمة أو الملاحظات تتضمّن عرضاً تجارياً غير مسجّل في بيانات المعرض.",
      violations: describeViolations(briefRequestCheck.blocked),
      code: briefRequestCheck.blocked[0]?.code || "business_claim_not_recorded",
    });
  }

  const { content, quote, warnings } = generateBriefContent({
    task, goal, tone, notes, platforms, product, productName, downPaymentPercent, durationMonths,
  });

  // Final safety net: generated text must obey the same project rules.
  const offending = content.find((c: any) => FORBIDDEN_CONTENT_PATTERN.test(c.text) || LEGACY_COUNTER_PATTERN.test(c.text));
  if (offending) return res.status(422).json({ success: false, error: "المحتوى المولد خالف قواعد مشروع الغرابي وتم إيقافه." });

  // حارس الحقائق التجارية: كل نص مولّد يُفحص مقابل بيانات المنتج الفعلية، فلا
  // يجوز أن يظهر سعر أو دفعة أولى أو ضمان أو رقم أو رابط غير مسجّل.
  const briefFacts = buildFactsForProduct(product, downPaymentPercent, durationMonths);
  const briefClaimIssues: { platform: string; violations: string[]; codes: string[] }[] = [];
  for (const piece of content) {
    const claimCheck = analyzeBusinessClaims(piece.text, briefFacts);
    if (!claimCheck.safe) {
      briefClaimIssues.push({ platform: piece.platform, violations: describeViolations(claimCheck.blocked), codes: claimCheck.blocked.map((v) => v.code) });
    }
  }
  if (briefClaimIssues.length) {
    return res.status(422).json({
      success: false,
      error: "المحتوى المولد تضمّن عرضاً تجارياً غير مسجّل في بيانات المعرض، وتم إيقافه.",
      contentSafety: { safe: false, issues: briefClaimIssues },
      note: "سجّل السعر/الشروط/الضمان الحقيقية في قاعدة بيانات المعرض، أو أزل العرض غير المسجّل من المهمة.",
    });
  }

  const briefId = workspaceId("brief");
  const createdAt = new Date().toISOString();
  const savedPostIds: string[] = [];

  if (b.saveDrafts === true) {
    for (const piece of content) {
      const post = {
        id: workspaceId("post"), title: piece.headline || `عرض ${productName}`,
        content: piece.text, platformVersions: { [piece.platform]: piece.text },
        targetPlatforms: [piece.platform], mediaUrl: cleanText(product?.image, 500) || undefined,
        mediaType: undefined, status: "draft", createdAt,
        authorId: user.id, authorName: user.name, authorRole: user.role,
        history: [{ id: workspaceId("act"), byUser: user.name, userRole: user.role, action: "create", timestamp: createdAt, note: "أُنشئ بواسطة وكيل الغرابي الذكي" }],
        tags: ["تقسيط_منتجات", "معرض_الغرابي", piece.platform], campaignName: cleanText(b.campaignName, 160) || undefined,
      };
      workspace.posts.unshift(post);
      savedPostIds.push(post.id);
    }
  }

  const briefRecord = {
    id: briefId, task, goal, tone, platforms, productName, productId: product?.id || null,
    content: content.map((c: any) => ({ platform: c.platform, text: c.text, charCount: c.charCount, withinLimit: c.withinLimit })),
    quote, warnings, savedPostIds, createdBy: user.id, createdAt,
  };
  (workspace as any).marketingBriefs.unshift(briefRecord);
  (workspace as any).marketingBriefs = (workspace as any).marketingBriefs.slice(0, 2000);
  persistState();
  audit(user.id, "marketing_brief_created", `${briefId}:${platforms.length}`);

  res.status(201).json({
    success: true,
    result: {
      briefId, task, goal, tone,
      product: { id: product?.id, name: productName, category: product?.category, source: product ? "showroom-database" : "manual", cashPrice: Number.isFinite(cashPrice) ? cashPrice : undefined, inStock: product?.inStock },
      platforms, content: content.map(({ text, ...rest }: any) => rest), quote, warnings, savedPostIds,
      generatedBy: "deterministic-marketing-agent", usesGemini: false, requiresExternalConnection: false, createdAt,
      nextStep: savedPostIds.length
        ? "راجع المسودات في مركز المحتوى ثم أرسلها للمراجعة والاعتماد. النشر الخارجي يحتاج اتصالاً حقيقياً بالمنصة."
        : "راجع المحتوى، ثم احفظه كمسودة للدخول في مسار المراجعة والاعتماد.",
    },
    note: "أُنشئ هذا المحتوى بالمحرك المحلي الحتمي دون استهلاك Gemini ودون أي اتصال خارجي.",
  });
});

// Read-only listing of previously generated briefs (owner sees all, others see their own).
app.get("/api/ai/content-briefs", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
  const rows = ((workspace as any).marketingBriefs || [])
    .filter((x: any) => user.role === "owner" || x.createdBy === user.id)
    .slice(0, limit)
    .map((x: any) => ({ id: x.id, task: x.task, goal: x.goal, platforms: x.platforms, productName: x.productName, quote: x.quote, warnings: x.warnings, savedPostIds: x.savedPostIds, createdAt: x.createdAt, content: x.content }));
  res.json({ success: true, briefs: rows, count: rows.length });
});

// -------------------------------------------------------------
// مسار A — الحملات التسويقية الصغيرة (Small Campaigns).
// يحوّل مهمة المحتوى الواحدة إلى حملة تتذكّر: عدة منتجات، هدف واحد، مهام محددة،
// ومسودات محتوى مرتبطة بمسار المراجعة والاعتماد القائم. حتمي بالكامل.
// لا ينشر خارجياً ولا يعتبر أي منصة متصلة بدون إثبات مزود فعلي.
// -------------------------------------------------------------
const CAMPAIGN_STATUSES = ["draft", "active", "completed", "archived"] as const;
const MARKETING_CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "مسودة", active: "نشطة", completed: "مكتملة", archived: "مؤرشفة",
};
const CAMPAIGN_HISTORY_LABELS: Record<string, string> = {
  created: "إنشاء الحملة", status_changed: "تغيير حالة الحملة", draft_decision: "قرار على مسودة",
  draft_linked: "ربط مسودة بمنشور", drafts_bulk_decision: "عملية جماعية على المسودات",
};
const MAX_CAMPAIGN_PRODUCTS = 10;
const MAX_CAMPAIGN_DRAFTS = 80;
const MAX_BULK_DRAFTS = 40;

// Draft state machine. Each transition declares the states it may start from and
// the state it lands in, so an illogical jump is rejected on the server.
// `review` is available to content roles; approving/rejecting stays owner-only,
// matching the existing "/api/workspace/content/:id/approve|reject" rules.
const DRAFT_ACTION_SPECS: Record<string, { from: string[]; to: string; label: string; ownerOnly: boolean; historyAction: string }> = {
  review: { from: ["draft", "edited"], to: "review", label: "إرسال للمراجعة", ownerOnly: false, historyAction: "submit_review" },
  approve: { from: ["review", "edited"], to: "approved", label: "اعتماد", ownerOnly: true, historyAction: "approve" },
  reject: { from: ["review", "edited", "approved"], to: "edited", label: "رفض وإعادة للتعديل", ownerOnly: true, historyAction: "reject" },
};
const DRAFT_SUBMIT_ROLES = ["owner", "manager", "staff", "content_creator"];

// Rebuilds the decision trail from the linked post history so drafts created
// before decisions were recorded still report an accurate state.
function deriveDraftDecision(post: any) {
  const history: any[] = Array.isArray(post?.history) ? post.history : [];
  for (let i = history.length - 1; i >= 0; i--) {
    const action = history[i]?.action;
    if (action === "approve") return { decision: "approve", at: history[i].timestamp, by: history[i].byUser, note: history[i].note };
    if (action === "reject") return { decision: "reject", at: history[i].timestamp, by: history[i].byUser, note: history[i].note };
    if (action === "submit_review") return { decision: "review", at: history[i].timestamp, by: history[i].byUser, note: history[i].note };
  }
  return null;
}

function findCampaign(id: string) {
  return ((workspace as any).marketingCampaigns || []).find((x: any) => x.id === id) || null;
}

function canAccessCampaign(user: ServerUser, campaign: any): boolean {
  return user.role === "owner" || campaign?.createdBy === user.id;
}

// Resolves one draft by its campaign task id, ensuring the draft really belongs
// to the campaign and still points at an existing post.
function locateCampaignDraft(campaign: any, taskId: string) {
  for (const brief of campaign?.briefs || []) {
    for (const draft of brief.drafts || []) {
      if (draft.taskId === taskId) return { brief, draft };
    }
  }
  return null;
}

function draftDecisionView(draft: any, post: any) {
  const derived = deriveDraftDecision(post);
  const decision = draft.decision || derived?.decision || null;
  return {
    decision,
    decisionLabel: decision ? (CAMPAIGN_DECISION_LABELS[decision] || decision) : null,
    decidedAt: draft.decidedAt || derived?.at || null,
    decidedBy: draft.decidedBy || derived?.by || null,
    decisionNote: draft.decisionNote || derived?.note || null,
  };
}

// The post a draft is linked to. The campaign/draft ids are written on the post
// so the link survives a workspace reload and can never be duplicated.
function linkedPostForDraft(draft: any) {
  return workspace.posts.find((p: any) => p?.campaignLink?.draftId === draft?.taskId)
    || workspace.posts.find((p: any) => p?.campaignLink?.draftId === draft?.postId)
    || workspace.posts.find((p: any) => p.id === draft?.postId)
    || null;
}

function recordCampaignHistory(campaign: any, user: ServerUser, action: string, note: string, timestamp: string) {
  campaign.history = Array.isArray(campaign.history) ? campaign.history : [];
  campaign.history.push({ action, byUser: user.name, userRole: user.role, timestamp, note });
  campaign.history = campaign.history.slice(-80);
}

// Live per-platform resources from real configuration only (no fabricated connections).
function campaignPlatformResources(platforms: string[]) {
  return platforms.map((id: string) => {
    const meta: any = SUPPORTED_PLATFORMS.find((p: any) => p.id === id);
    const readiness: any = publicProviderReadiness(id);
    const conn: any = platformConnections.get(id);
    return {
      platform: id,
      name: meta?.name || id,
      capabilities: meta?.capabilities || [],
      textLimit: PLATFORM_TEXT_LIMITS[id] || 2000,
      connectionStatus: conn?.status || "disconnected",
      connected: Boolean(conn?.status === "connected" && conn?.providerVerified === true),
      providerVerified: Boolean(conn?.providerVerified === true),
      configurationReady: Boolean(readiness?.configured),
      missing: readiness?.missing || [],
      next: readiness?.next || "إضافة موصل إنتاجي معتمد قبل تفعيل النشر",
    };
  });
}

// Campaign task status is derived live from the linked draft so nothing is duplicated.
const CAMPAIGN_TASK_STATUS_LABELS: Record<string, string> = {
  draft: "مسودة", review: "قيد المراجعة", edited: "تم التعديل", approved: "تمت الموافقة",
  scheduled: "مجدول", published: "منشور", deleted: "محذوفة",
};
const CAMPAIGN_DECISION_LABELS: Record<string, string> = {
  review: "أُرسلت للمراجعة", approve: "مُعتمدة", reject: "مرفوضة — تحتاج تعديلاً",
};
function campaignTasksFor(briefs: any[]) {
  const byId = new Map<string, any>((workspace as any).posts.map((p: any) => [p.id, p]));
  const tasks: any[] = [];
  for (const b of briefs) {
    for (const d of b.drafts || []) {
      const post: any = byId.get(d.postId);
      const status = post?.status || "deleted";
      const content = typeof post?.content === "string" ? post.content : "";
      const decision = draftDecisionView(d, post);
      tasks.push({
        id: d.taskId,
        title: d.title,
        productId: b.productId,
        productName: b.productName,
        platform: d.platform,
        platformName: SUPPORTED_PLATFORMS.find((p: any) => p.id === d.platform)?.name || d.platform,
        draftPostId: d.postId,
        status,
        statusLabel: post ? (CAMPAIGN_TASK_STATUS_LABELS[status] || status) : "محذوفة",
        createdAt: d.createdAt,
        charCount: content.length,
        contentPreview: content.slice(0, 200),
        content,
        ...decision,
        allowedActions: Object.keys(DRAFT_ACTION_SPECS).filter((a) => DRAFT_ACTION_SPECS[a].from.includes(status)),
      });
    }
  }
  return tasks;
}

function campaignSummary(c: any) {
  const tasks = campaignTasksFor(c.briefs || []);
  const byStatus: Record<string, number> = {};
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  const history: any[] = Array.isArray(c.history) ? c.history : [];
  const lastHistory = history[history.length - 1];
  const lastActivity = lastHistory
    ? { action: lastHistory.action, byUser: lastHistory.byUser, userRole: lastHistory.userRole, timestamp: lastHistory.timestamp, note: lastHistory.note || "" }
    : null;
  return {
    id: c.id, name: c.name, goal: c.goal, goalLabel: MARKETING_GOALS[c.goal]?.label || c.goal,
    status: c.status, statusLabel: MARKETING_CAMPAIGN_STATUS_LABELS[c.status] || c.status, platforms: c.platforms,
    productIds: (c.products || []).map((p: any) => p.id),
    productNames: (c.products || []).map((p: any) => p.name),
    productsCount: (c.products || []).length,
    draftsCount: tasks.length,
    draftsByDecision: {
      pending: tasks.filter((t) => !t.decision).length,
      review: tasks.filter((t) => t.decision === "review").length,
      approve: tasks.filter((t) => t.decision === "approve").length,
      reject: tasks.filter((t) => t.decision === "reject").length,
    },
    tasksByStatus: byStatus,
    createdBy: c.createdBy, createdAt: c.createdAt, updatedAt: c.updatedAt,
    lastActivity,
  };
}

// Creates a real campaign from real showroom products. Deterministic; no Gemini.
app.post("/api/ai/marketing-campaigns", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  if (!rateLimitAI(user.id)) return res.status(429).json({ success: false, error: "تم تفعيل حماية الطلبات: انتظر دقيقة قبل إرسال طلبات إضافية.", generatedBy: "local-guard" });

  const b = req.body || {};
  const name = cleanText(b.name, 160);
  if (!name || name.length < 3) return res.status(400).json({ success: false, error: "اسم الحملة مطلوب (3 أحرف على الأقل)." });

  const goal = typeof b.goal === "string" && MARKETING_GOALS[b.goal] ? b.goal : "offer";
  const task = cleanText(b.task, 600);
  if (!task || task.length < 3) return res.status(400).json({ success: false, error: "مهمة الحملة مطلوبة ويجب أن تكون واضحة (3 أحرف على الأقل)." });
  const tone = cleanText(b.tone, 120) || "احترافية ومباشرة موجهة لعملاء التقسيط";
  const notes = cleanText(b.notes, 600);

  // Project rules are enforced before anything is generated.
  if (FORBIDDEN_CONTENT_PATTERN.test(`${name} ${task} ${notes}`)) return res.status(422).json({ success: false, error: "الحملة تحتوي على مصطلحات سيارات، وهي خارج نشاط معرض الغرابي للتقسيط." });
  if (LEGACY_COUNTER_PATTERN.test(`${name} ${task} ${notes}`)) return res.status(422).json({ success: false, error: "تم اكتشاف عداد استخدام قديم غير مسموح في المشروع." });

  const requestedPlatforms = Array.isArray(b.platforms) ? b.platforms : [];
  const platforms = [...new Set(requestedPlatforms.filter((x: any) => typeof x === "string" && SUPPORTED_PLATFORMS.some((p: any) => p.id === x)))].slice(0, 10) as string[];
  if (!platforms.length) return res.status(400).json({ success: false, error: "اختر منصة واحدة على الأقل من المنصات المدعومة." });

  const requestedProductIds = Array.isArray(b.productIds) ? b.productIds.filter((x: any) => typeof x === "string") : [];
  if (!requestedProductIds.length) return res.status(400).json({ success: false, error: "اختر منتجاً واحداً على الأقل من قاعدة بيانات المعرض." });
  const uniqueIds = [...new Set(requestedProductIds)].slice(0, MAX_CAMPAIGN_PRODUCTS);
  const products: any[] = [];
  for (const pid of uniqueIds) {
    const found = workspace.products.find((p: any) => p.id === pid);
    if (!found) return res.status(404).json({ success: false, error: `المنتج المحدد غير موجود في قاعدة بيانات المعرض: ${pid}` });
    products.push(found);
  }
  if (products.length * platforms.length > MAX_CAMPAIGN_DRAFTS) {
    return res.status(400).json({ success: false, error: `عدد المسودات كبير جداً (${products.length * platforms.length}). الحد الأقصى ${MAX_CAMPAIGN_DRAFTS} مسودة في الحملة.` });
  }

  // Optional explicit payment terms; otherwise each product keeps its own real values.
  const overrideDown = Number.isFinite(Number(b.downPaymentPercent)) ? Math.max(0, Math.min(99, Math.floor(Number(b.downPaymentPercent)))) : null;
  const overrideMonths = Number.isInteger(Number(b.durationMonths)) ? Math.max(1, Math.min(60, Number(b.durationMonths))) : null;
  const createDrafts = b.createDrafts !== false;

  const campaignId = workspaceId("camp");
  const createdAt = new Date().toISOString();
  const briefs: any[] = [];
  let allWarnings: string[] = [];

  // Each product is generated independently so prices and figures never mix.
  for (const product of products) {
    const downPaymentPercent = overrideDown !== null ? overrideDown : Number(product?.downPaymentPercent || 0);
    const durationMonths = overrideMonths !== null ? overrideMonths : Number(product?.durationMonths || 0);

    // حارس المدخلات لكل منتج على حدة: لا عرض غير مسجّل في بيانات هذا المنتج.
    const productRequestFacts = buildFactsForProduct(product, downPaymentPercent, durationMonths);
    const productRequestCheck = analyzeRequestClaims(`${task}\n${notes}`, productRequestFacts);
    if (!productRequestCheck.safe) {
      return res.status(422).json({
        success: false,
        error: `مهمة الحملة تتضمّن عرضاً تجارياً غير مسجّل في بيانات المعرض للمنتج: ${product.name}.`,
        violations: describeViolations(productRequestCheck.blocked),
        code: productRequestCheck.blocked[0]?.code || "business_claim_not_recorded",
      });
    }

    const { content, quote, warnings } = generateBriefContent({
      task, goal, tone, notes, platforms, product, productName: product.name,
      downPaymentPercent, durationMonths,
    });

    const offending = content.find((c: any) => FORBIDDEN_CONTENT_PATTERN.test(c.text) || LEGACY_COUNTER_PATTERN.test(c.text));
    if (offending) return res.status(422).json({ success: false, error: "المحتوى المولد خالف قواعد مشروع الغرابي وتم إيقافه." });

    // حارس المخارج لكل نص مولّد مقابل بيانات هذا المنتج تحديداً.
    const productFacts = buildFactsForProduct(product, downPaymentPercent, durationMonths);
    const productIssues: { platform: string; violations: string[]; codes: string[] }[] = [];
    for (const piece of content) {
      const claimCheck = analyzeBusinessClaims(piece.text, productFacts);
      if (!claimCheck.safe) {
        productIssues.push({ platform: piece.platform, violations: describeViolations(claimCheck.blocked), codes: claimCheck.blocked.map((v) => v.code) });
      }
    }
    if (productIssues.length) {
      return res.status(422).json({
        success: false,
        error: `المحتوى المولد للمنتج ${product.name} تضمّن عرضاً تجارياً غير مسجّل في بيانات المعرض.`,
        contentSafety: { safe: false, issues: productIssues },
      });
    }

    const briefId = workspaceId("brief");
    const drafts: any[] = [];

    if (createDrafts) {
      for (const piece of content) {
        const taskId = workspaceId("task");
        const post = {
          id: workspaceId("post"), title: piece.headline || `عرض ${product.name}`,
          content: piece.text, platformVersions: { [piece.platform]: piece.text },
          targetPlatforms: [piece.platform], mediaUrl: cleanText(product?.image, 500) || undefined,
          mediaType: undefined, status: "draft", createdAt,
          authorId: user.id, authorName: user.name, authorRole: user.role,
          history: [{ id: workspaceId("act"), byUser: user.name, userRole: user.role, action: "create", timestamp: createdAt, note: `أُنشئ ضمن حملة: ${name}` }],
          tags: ["تقسيط_منتجات", "معرض_الغرابي", piece.platform], campaignName: name,
          // Durable, single-source link between the post and its campaign draft.
          campaignLink: { campaignId, campaignName: name, draftId: taskId, productId: product.id, productName: product.name, platform: piece.platform, linkedAt: createdAt },
        };
        workspace.posts.unshift(post);
        drafts.push({ taskId, title: post.title, platform: piece.platform, postId: post.id, createdAt, decision: null, decidedAt: null, decidedBy: null, decisionNote: null });
      }
    }

    const briefRecord = {
      id: briefId, task, goal, tone, platforms, productName: product.name, productId: product.id,
      content: content.map((c: any) => ({ platform: c.platform, text: c.text, charCount: c.charCount, withinLimit: c.withinLimit })),
      quote, warnings, savedPostIds: drafts.map((d) => d.postId), campaignId, campaignName: name,
      createdBy: user.id, createdAt,
    };
    (workspace as any).marketingBriefs.unshift(briefRecord);
    briefs.push({ productId: product.id, productName: product.name, briefId, quote, warnings, drafts });
    allWarnings = allWarnings.concat(warnings.map((w) => `${product.name}: ${w}`));
  }

  (workspace as any).marketingBriefs = (workspace as any).marketingBriefs.slice(0, 2000);

  const campaign = {
    id: campaignId, name, goal, task, tone, notes, platforms, status: "draft",
    products: products.map((p: any) => ({ id: p.id, name: p.name, category: p.category, cashPrice: Number(p.cashPrice) || null, inStock: p.inStock !== false, image: p.image || "" })),
    briefs,
    warnings: [...new Set(allWarnings)],
    platformResources: campaignPlatformResources(platforms),
    createdBy: user.id, createdAt, updatedAt: createdAt,
    history: [{ action: "created", byUser: user.name, userRole: user.role, timestamp: createdAt, note: `أُنشئت الحملة ب${products.length} منتج و${platforms.length} منصة` }],
  };
  (workspace as any).marketingCampaigns.unshift(campaign);
  (workspace as any).marketingCampaigns = (workspace as any).marketingCampaigns.slice(0, 1000);
  persistState();
  audit(user.id, "marketing_campaign_created", `${campaignId}:${products.length}x${platforms.length}`);

  res.status(201).json({
    success: true,
    campaign: { ...campaignSummary(campaign), tasks: campaignTasksFor(briefs), platformResources: campaign.platformResources, warnings: campaign.warnings },
    note: "حملة حتمية مبنية على بيانات المعرض الحقيقية، دون استهلاك Gemini ودون أي نشر خارجي.",
  });
});

// Lists campaigns (owner sees all, others see their own).
app.get("/api/ai/marketing-campaigns", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
  const rows = ((workspace as any).marketingCampaigns || [])
    .filter((x: any) => user.role === "owner" || x.createdBy === user.id)
    .slice(0, limit)
    .map(campaignSummary);
  res.json({ success: true, campaigns: rows, count: rows.length, geminiUsed: false });
});

// Full campaign detail: products, tasks, per-platform resources and live draft status.
app.get("/api/ai/marketing-campaigns/:id", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const id = cleanText(req.params.id, 100);
  const c: any = findCampaign(id);
  if (!c) return res.status(404).json({ success: false, error: "الحملة غير موجودة." });
  if (!canAccessCampaign(user, c)) return res.status(403).json({ success: false, error: "غير مصرح بالوصول إلى هذه الحملة." });

  const tasks = campaignTasksFor(c.briefs || []);
  const linkedPostIds = new Set(tasks.map((t: any) => t.draftPostId));
  const linkedPosts = workspace.posts.filter((p: any) => linkedPostIds.has(p.id) || p?.campaignLink?.campaignId === c.id);
  res.json({
    success: true,
    campaign: {
      ...campaignSummary(c), task: c.task, tone: c.tone, notes: c.notes,
      products: c.products, warnings: c.warnings,
      platformResources: c.platformResources?.length ? c.platformResources : campaignPlatformResources(c.platforms),
      tasks,
      drafts: tasks,
      canDecideDrafts: user.role === "owner" || user.role === "manager",
      linkedPostsCount: linkedPosts.length,
      history: (Array.isArray(c.history) ? c.history : []).map((h: any) => ({ ...h, actionLabel: CAMPAIGN_HISTORY_LABELS[h.action] || h.action })),
    },
    note: "حالة كل مهمة مستمدة مباشرة من مسار المراجعة والاعتماد، ولم يُنشر شيء خارجياً.",
  });
});

// Minimal status update for the campaign record (no publishing side effects).
app.patch("/api/ai/marketing-campaigns/:id", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const id = cleanText(req.params.id, 100);
  const c: any = findCampaign(id);
  if (!c) return res.status(404).json({ success: false, error: "الحملة غير موجودة." });
  if (!canAccessCampaign(user, c)) return res.status(403).json({ success: false, error: "غير مصرح بالوصول إلى هذه الحملة." });

  const status = cleanText(req.body?.status, 40);
  if (!CAMPAIGN_STATUSES.includes(status as any)) return res.status(400).json({ success: false, error: `حالة الحملة غير صالحة. المسموح: ${CAMPAIGN_STATUSES.join(", ")}` });

  c.status = status;
  c.updatedAt = new Date().toISOString();
  recordCampaignHistory(c, user, "status_changed", `الحالة الجديدة: ${MARKETING_CAMPAIGN_STATUS_LABELS[status] || status}`, c.updatedAt);
  persistState();
  audit(user.id, "marketing_campaign_status_changed", `${id}:${status}`);
  res.json({ success: true, campaign: campaignSummary(c), note: "تحديث حالة الحملة لا ينفذ أي نشر خارجي." });
});

// -------------------------------------------------------------
// Draft lifecycle inside a campaign.
// Every transition is validated against DRAFT_ACTION_SPECS on the server, so an
// illogical jump (e.g. approving a rejected draft again) is refused and reported
// explicitly. Ownership and role are always re-checked from the session, never
// trusted from the client payload.
// -------------------------------------------------------------
type DraftTransitionOutcome = {
  taskId: string;
  status: "applied" | "skipped" | "missing";
  from?: string;
  to?: string;
  error?: string;
  applied?: boolean;
  skipped?: boolean;
};

function applyDraftAction(campaign: any, user: ServerUser, taskId: string, action: string, note: string): { ok: boolean; code?: number; error?: string; taskId?: string; from?: string; to?: string; postId?: string; timestamp?: string } {
  const located = locateCampaignDraft(campaign, taskId);
  if (!located) return { ok: false, code: 404, error: `المسودة غير موجودة في هذه الحملة: ${taskId}` };
  const { draft } = located;
  const post: any = linkedPostForDraft(draft);
  if (!post) return { ok: false, code: 409, error: "المنشور المرتبط بالمسودة لم يعد موجوداً، فلا يمكن تنفيذ قرار عليها." };

  const spec = DRAFT_ACTION_SPECS[action];
  if (!spec) return { ok: false, code: 400, error: `إجراء غير معروف. المسموح: ${Object.keys(DRAFT_ACTION_SPECS).join(", ")}` };

  if (spec.ownerOnly && user.role !== "owner" && user.role !== "manager") {
    return { ok: false, code: 403, error: `صلاحية مرفوضة: إجراء «${spec.label}» مقتصر على المالك أو المدير العام.` };
  }
  if (!spec.ownerOnly && !DRAFT_SUBMIT_ROLES.includes(user.role)) {
    return { ok: false, code: 403, error: `صلاحية مرفوضة: إجراء «${spec.label}» غير متاح لدورك.` };
  }

  const currentStatus = String(post.status || "draft");
  if (!spec.from.includes(currentStatus)) {
    return { ok: false, code: 409, error: `انتقال غير منطقي: لا يمكن تنفيذ «${spec.label}» ومسودة بحالة «${CAMPAIGN_TASK_STATUS_LABELS[currentStatus] || currentStatus}».` };
  }

  const timestamp = new Date().toISOString();
  post.status = spec.to;
  post.history = Array.isArray(post.history) ? post.history : [];
  post.history.push({ id: workspaceId("approval"), byUser: user.name, userRole: user.role, action: spec.historyAction, timestamp, note: note || spec.label });
  post.history = post.history.slice(-50);

  draft.decision = action;
  draft.decidedAt = timestamp;
  draft.decidedBy = user.name;
  draft.decisionNote = note || spec.label;

  campaign.updatedAt = timestamp;
  recordCampaignHistory(
    campaign, user, "draft_decision",
    `«${spec.label}» على مسودة ${draft.platform} للمنتج ${located.brief?.productName || "غير محدد"}${note ? ` — ${note}` : ""}`,
    timestamp,
  );
  audit(user.id, `marketing_campaign_draft_${action}`, `${campaign.id}:${taskId}`);
  return { ok: true, taskId, from: currentStatus, to: spec.to, postId: post.id, timestamp };
}

// Single draft review / approve / reject.
app.post("/api/ai/marketing-campaigns/:id/drafts/:taskId/action", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const campaign: any = findCampaign(cleanText(req.params.id, 100));
  if (!campaign) return res.status(404).json({ success: false, error: "الحملة غير موجودة." });
  if (!canAccessCampaign(user, campaign)) return res.status(403).json({ success: false, error: "غير مصرح بالوصول إلى هذه الحملة." });

  const action = cleanText(req.body?.action, 20);
  const note = cleanText(req.body?.note, 500);
  const result = applyDraftAction(campaign, user, cleanText(req.params.taskId, 100), action, note);
  if (!result.ok) return res.status(result.code).json({ success: false, error: result.error });

  persistState();
  res.json({
    success: true,
    result: { taskId: result.taskId, from: result.from, to: result.to, action, note: note || DRAFT_ACTION_SPECS[action].label },
    campaign: { ...campaignSummary(campaign), tasks: campaignTasksFor(campaign.briefs || []) },
    note: "تم تسجيل القرار في سجل الحملة وفي مسار الاعتماد. لا يوجد أي نشر خارجي.",
  });
});

// Bulk review / approve / reject over an explicit selection of drafts.
// Duplicate ids are collapsed, unknown ids are reported instead of silently ignored,
// and already-decided drafts are skipped rather than re-processed.
app.post("/api/ai/marketing-campaigns/:id/drafts/bulk", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const campaign: any = findCampaign(cleanText(req.params.id, 100));
  if (!campaign) return res.status(404).json({ success: false, error: "الحملة غير موجودة." });
  if (!canAccessCampaign(user, campaign)) return res.status(403).json({ success: false, error: "غير مصرح بالوصول إلى هذه الحملة." });

  const rawIds: any[] = Array.isArray(req.body?.taskIds) ? req.body.taskIds : [];
  const cleanedIds: string[] = rawIds.filter((x: any) => typeof x === "string" && x.trim()).map((x: string) => x.trim());
  const taskIds: string[] = [...new Set<string>(cleanedIds)].slice(0, MAX_BULK_DRAFTS);
  if (!taskIds.length) return res.status(400).json({ success: false, error: "حدد مسودة واحدة على الأقل لتنفيذ العملية الجماعية." });
  const duplicatesRemoved = cleanedIds.length - taskIds.length;

  const action = cleanText(req.body?.action, 20);
  const spec = DRAFT_ACTION_SPECS[action];
  if (!spec) return res.status(400).json({ success: false, error: `إجراء جماعي غير معروف. المسموح: ${Object.keys(DRAFT_ACTION_SPECS).join(", ")}` });
  if (spec.ownerOnly && user.role !== "owner" && user.role !== "manager") {
    return res.status(403).json({ success: false, error: `صلاحية مرفوضة: «${spec.label}» الجماعي مقتصر على المالك أو المدير العام.` });
  }
  if (!spec.ownerOnly && !DRAFT_SUBMIT_ROLES.includes(user.role)) {
    return res.status(403).json({ success: false, error: `صلاحية مرفوضة: «${spec.label}» الجماعي غير متاح لدورك.` });
  }

  const note = cleanText(req.body?.note, 500);
  const outcomes: DraftTransitionOutcome[] = [];
  for (const taskId of taskIds) {
    const result: any = applyDraftAction(campaign, user, taskId, action, note);
    if (result.ok) outcomes.push({ taskId, status: "applied", from: result.from, to: result.to, applied: true });
    else outcomes.push({ taskId, status: result.code === 404 ? "missing" : "skipped", error: result.error, skipped: true });
  }

  const applied = outcomes.filter((o) => o.status === "applied");
  const skipped = outcomes.filter((o) => o.status !== "applied");
  if (applied.length) {
    campaign.updatedAt = new Date().toISOString();
    recordCampaignHistory(campaign, user, "drafts_bulk_decision", `عملية جماعية «${spec.label}»: ${applied.length} نجحت، ${skipped.length} لم تُنفّذ`, campaign.updatedAt);
    persistState();
    audit(user.id, "marketing_campaign_drafts_bulk", `${campaign.id}:${action}:${applied.length}/${taskIds.length}`);
  }

  res.json({
    success: true,
    action,
    actionLabel: spec.label,
    requested: taskIds.length,
    duplicatesRemoved,
    appliedCount: applied.length,
    skippedCount: skipped.length,
    appliedTaskIds: applied.map((o) => o.taskId),
    skipped: skipped.map((o) => ({ taskId: o.taskId, reason: o.error })),
    campaign: { ...campaignSummary(campaign), tasks: campaignTasksFor(campaign.briefs || []) },
    note: applied.length
      ? `نُفّذت العملية على ${applied.length} مسودة، ولم يُنشر أي محتوى خارجياً.`
      : "لم تُنفّذ أي مسودة. راجع الأسباب المرفقة لكل مسودة.",
  });
});

// Links an approved draft to its workspace post. Idempotent: if the post already
// carries the campaign/draft link it is returned untouched, so no duplicate post
// is ever created. Nothing here claims an external publish.
app.post("/api/ai/marketing-campaigns/:id/drafts/:taskId/link", authenticateToken, (req, res) => {
  const user = (req as any).user as ServerUser;
  const campaign: any = findCampaign(cleanText(req.params.id, 100));
  if (!campaign) return res.status(404).json({ success: false, error: "الحملة غير موجودة." });
  if (!canAccessCampaign(user, campaign)) return res.status(403).json({ success: false, error: "غير مصرح بالوصول إلى هذه الحملة." });

  const taskId = cleanText(req.params.taskId, 100);
  const located = locateCampaignDraft(campaign, taskId);
  if (!located) return res.status(404).json({ success: false, error: `المسودة غير موجودة في هذه الحملة: ${taskId}` });
  const { draft, brief } = located;

  const post: any = linkedPostForDraft(draft);
  if (!post) return res.status(409).json({ success: false, error: "لا يوجد منشور مرتبط بهذه المسودة، ولا يمكن إنشاء منشور دون محتوى مسودة حقيقي." });

  // Only an approved draft can be linked. The UI hides the action for other
  // states, but the decision must be enforced server-side so a direct API call
  // cannot attach an unreviewed draft to a workspace post.
  if (String(post.status || "draft") !== "approved") {
    return res.status(409).json({
      success: false,
      error: `لا يمكن ربط مسودة بحالة «${CAMPAIGN_TASK_STATUS_LABELS[post.status] || post.status}». الرابط متاح للمسودات المعتمدة فقط.`,
    });
  }

  const alreadyLinked = post?.campaignLink?.campaignId === campaign.id && post?.campaignLink?.draftId === taskId;
  if (!alreadyLinked) {
    post.campaignLink = {
      campaignId: campaign.id, campaignName: campaign.name, draftId: taskId,
      productId: brief?.productId || null, productName: brief?.productName || null,
      platform: draft.platform, linkedAt: new Date().toISOString(), linkedBy: user.id,
    };
    post.campaignName = campaign.name;
    campaign.updatedAt = post.campaignLink.linkedAt;
    recordCampaignHistory(campaign, user, "draft_linked", `ربط مسودة ${draft.platform} بالمنشور ${post.id}`, campaign.updatedAt);
    persistState();
    audit(user.id, "marketing_campaign_draft_linked", `${campaign.id}:${taskId}:${post.id}`);
  }

  res.json({
    success: true,
    created: false,
    alreadyLinked,
    link: post.campaignLink,
    post: { id: post.id, title: post.title, status: post.status, statusLabel: CAMPAIGN_TASK_STATUS_LABELS[post.status] || post.status, targetPlatforms: post.targetPlatforms, scheduledFor: post.scheduledFor || null, publishedAt: post.publishedAt || null, metricsSource: post.metricSource || null },
    externalPublishClaimed: false,
    note: "الربط محلي مع مساحة المنشورات. لا يوجد أي إثبات نشر خارجي لهذه المسودة.",
  });
});

// Helper for local template generation without mock data
function generateSmartFallbackContent(
  platform: string = "",
  type: string = "post",
  topic: string = "عروض تقسيط ميسرة",
  details?: string
) {
  const p = platform.toLowerCase();
  if (p.includes("tiktok") || type === "script") {
    return `🎬 [سكربت تيك توك / ريلز - معرض الغرابي للتقسيط]
⏱️ المدة المقترحة: 20-30 ثانية

[00:00 - 00:03] البداية (Hook):
"تبحث عن خطة تقسيط ميسرة وبدون تعقيدات؟ تفضل معنا..."

[00:04 - 00:15] المحتوى الأساسي:
"معرض الغرابي للتقسيط يوفر لك خيارات دفع ميسرة وأنظمة سداد مرنة تناسب دخلك والتزاماتك."

[00:16 - 00:25] التفاصيل:
${details ? details : 'إجراءات واضحة وسريعة، وإشراف متكامل على كافة خطوات التقديم.'}

[00:26 - 00:30] الدعوة للتفاعل (CTA):
"تواصل معنا الآن عبر الرسائل أو من خلال الرابط المتاح في البايو لمعرفة كامل التفاصيل!"

#معرض_الغرابي #تقسيط #عروض_التقسيط #تسهيلات`;
  }

  if (p.includes("youtube")) {
    return `📌 [محتوى فيديو يوتيوب - معرض الغرابي للتقسيط]

🎯 العنوان المقترح:
"دليلك الشامل لخطط وأنظمة التقسيط الميسر | خدمات معرض الغرابي"

📝 الوصف المفصل:
في هذا المقطع نقدم شرحاً وافياً لخدمات وأنظمة التقسيط المتاحة في معرض الغرابي للتقسيط، مع توضيح الإجراءات والمستندات المطلوبة وطريقة تقديم الطلب بسهولة.

⏱️ الفواصل المقترحة:
00:00 - مقدمة عن خدمات معرض الغرابي
01:00 - أنظمة وخطط التقسيط المتوفرة
02:30 - المستندات والشروط
03:30 - كيفية التواصل والتقديم المباشر

#معرض_الغرابي #تقسيط #خدمات_التقسيط`;
  }

  if (p.includes("snapchat")) {
    return `👻 [سيناريو سناب شات - إعلان ستوري]

📸 سناب 1 (جذب الانتباه):
- "تخطط لشراء جديد بنظام تقسيط مريح ومناسب؟ 👀"

📸 سناب 2 (المزايا):
- حلول تقسيط مرنة من معرض الغرابي
- فترات سداد مريحة
- إجراءات ميسرة وبدون تعقيد

📸 سناب 3 (الدعوة للتواصل):
- "اسحب الشاشة الآن وتواصل مع فريق خدمة العملاء مباشرة 📲"`;
  }

  if (p.includes("x") || p.includes("twitter")) {
    return `في #معرض_الغرابي للتقسيط نوفر لكم حلول تقسيط مرنة ومتوافقة مع احتياجاتكم:
✅ خطط سداد ميسرة
✅ إجراءات سريعة وواضحة
✅ خدمات مخصصة لكافة العملاء

تواصلوا معنا الآن للاستفسار وحساب الخطة الأنسب لكم!
#تقسيط #معرض_الغرابي #عروض_التقسيط`;
  }

  // Default Facebook / Instagram / General
  return `نقدم لكم في معرض الغرابي للتقسيط حلولاً تمويلية وتقسيطاً ميسراً يلبي تطلعاتكم:
🔹 فترات سداد مرنة ومريحة
🔹 شروط واضحة وإجراءات ميسرة
🔹 متابعة سريعة لطلباتكم

${details ? `📌 تفاصيل الخطة: ${details}` : '📌 خيارات متعددة تناسب مختلف الميزانيات والاحتياجات.'}

تفضلوا بالتواصل مع فريقنا للتعرف على كافة الخيارات المتاحة واختيار الخطة الأنسب لكم.

#معرض_الغرابي #تقسيط #تسهيلات #عروض`;
}

// مسارات مدير السوشيال ميديا (منفذة في وحدة مستقلة قابلة للاختبار).
registerSocialManagerRoutes(app, {
  authenticateToken,
  requireOwner,
  workspace,
  platformConnections,
  persistState,
  audit,
  workspaceId,
  // وضع YOUTUBE_ONLY_OPERATIONAL: يمنع تسجيل/إرسال أي عملية على منصة غير YouTube.
  platformOperationGuard: (platform: string) => {
    const g = youtubeOnlyBlock(platform);
    return { blocked: g.blocked, body: g.body };
  },
  // جلب تعليقات YouTube الحقيقية من commentThreads.list (يمر ببوابات الخادم).
  fetchYouTubeComments: async (videoId: string) => {
    const guard = youtubeOperationGuard();
    if (!guard.ok) return { ok: false, error: guard.error, code: guard.code as any };
    if (!youtubeForceSslGranted()) return { ok: false, error: "إعادة ربط YouTube مطلوبة لتفعيل إدارة التعليقات (نطاق youtube.force-ssl).", code: "SCOPE_UPGRADE_REQUIRED" };
    const ensured = await ensureYouTubeAccessToken();
    if (!ensured.ok || !ensured.token) return { ok: false, error: ensured.error, code: ensured.code ?? null };
    const result = await youtubeClient().listCommentThreads(ensured.token, { videoId });
    if (!result.ok || !result.data) { noteYouTubeProviderError(result.code as any); return { ok: false, error: result.error, code: result.code ?? null }; }
    let inserted = 0; let duplicates = 0;
    for (const c of result.data.comments) {
      const ing = ingestYouTubeComment(c, videoId);
      if (ing.duplicate) duplicates += 1; else inserted += 1;
    }
    await persistStateDurable();
    clearYouTubeProviderError();
    return { ok: true, comments: result.data.comments, inserted, duplicates };
  },
  // جلب إحصاءات YouTube الحقيقية (channels.list/videos.list part=statistics).
  fetchYouTubeAnalytics: async () => {
    const guard = youtubeOperationGuard();
    if (!guard.ok) return { ok: false, error: guard.error, code: guard.code as any };
    const ensured = await ensureYouTubeAccessToken();
    if (!ensured.ok || !ensured.token) return { ok: false, error: ensured.error, code: ensured.code ?? null };
    const stored = youtubeStoredCredentials();
    const channelRes = await youtubeClient().getChannelStatistics(ensured.token);
    if (!channelRes.ok || !channelRes.data) { noteYouTubeProviderError(channelRes.code as any); return { ok: false, error: channelRes.error, code: channelRes.code ?? null }; }
    const videosRes = await youtubeClient().listMyVideos(ensured.token, { uploadsPlaylistId: String(stored?.uploadsPlaylistId || ""), maxResults: 50 });
    const videos = videosRes.ok && videosRes.data ? videosRes.data.videos : [];
    const records = youtubeVideoMetricRecords(videos);
    const summary = summarizeChannelAnalytics(records);
    const audience = analyzeYouTubeAudience(records, summary);
    clearYouTubeProviderError();
    return { ok: true, summary, audience, channel: channelRes.data, videoCount: videos.length };
  },
  // حقائق المعرض الفعلية لمنتج محدّد (أو العامة) لفحص أي رد مقترح مقابل بيانات
  // مسجّلة فعلاً، فلا يمر ادعاء تجاري غير مسجّل.
  buildFacts: (productId?: string | null) => {
    const product = productId ? workspace.products.find((p: any) => p.id === productId) || null : null;
    return buildFactsForProduct(product, Number(product?.downPaymentPercent || 0), Number(product?.durationMonths || 0));
  },
  // حقائق الرد الموثوقة: قيم مسجّلة فعلاً فقط. أي حقل غير مسجّل يبقى غائباً
  // فيمتنع محرّك الرد عن ذكره بدل اختراعه (سعر/موقع/دوام/توفر/اسم منتج).
  buildReplyFacts: (productId?: string | null, productName?: string | null) => {
    const products: any[] = Array.isArray(workspace.products) ? workspace.products : [];
    const product = productId
      ? products.find((p: any) => p.id === String(productId)) || null
      : productName
        ? products.find((p: any) => p.name === String(productName)) || null
        : null;
    const showroom: any = workspace.showroom || {};
    const price = Number(product?.cashPrice);
    const address = [showroom.address, showroom.city].map((x: any) => cleanText(x, 200)).filter(Boolean).join(' - ');
    return {
      productName: product?.name ? cleanText(product.name, 120) : undefined,
      priceText: Number.isFinite(price) && price > 0 ? `${Math.round(price).toLocaleString('en-US')} د.ع` : undefined,
      locationText: address || undefined,
      hoursText: showroom.workingHours ? cleanText(showroom.workingHours, 120) : undefined,
      inStock: typeof product?.inStock === 'boolean' ? product.inStock : null,
      hasRecordedPromotion: [showroom.promotions, showroom.activeOffer].some((x: any) => cleanText(x, 300).length > 0),
    };
  },
  // المصدر الوحيد للحقيقة للقرار/الذاكرة: الحالة canonical للعقل المركزي.
  // مسارات /api/social/manager/{brain/decision,memory} إسقاط توافقي منها فقط.
  centralBrainState: () => buildRuntimeBrain({ ...brainRuntimeInput(), now: Date.now() }).state,
  // مُبلِّغ التصعيد البشري: يُعيد استخدام بنية التنبيه القائمة (`pushNotification`).
  // لا يدّعي الإشعار إن لم يُنشأ التنبيه فعلاً؛ والفشل يُعلَن بسببه بلا سرّ.
  notifyEscalation: (record: any) => {
    try {
      const n = pushNotification(
        "owner",
        "social_escalation",
        `تصعيد بشري: ${record?.reasonLabelAr || record?.reason || "حالة تحتاج مراجعة"}`,
        `منصة ${record?.platform || "غير معروفة"} — ${String(record?.commentText || "").slice(0, 200)}`,
        "warning",
      );
      return { delivered: Boolean(n?.id), channel: "in_app_notification", error: n?.id ? null : "notification_not_created" };
    } catch (e) {
      return { delivered: false, channel: null, error: e instanceof Error ? e.name : "notifier_failed" };
    }
  },
});

// العقل المركزي: يُربط بمنفّذ التنفيذ الخارجي الفعلي (نفس بوابات النشر) وبسياق
// الأدوات الحقيقي، ثم تُسجَّل مساراته. لا مسار خارجي يتجاوز بوابات المشروع.
agentOrchestrator.setToolContext(buildAgentToolContext("system", "system"));
agentJobExecutor = async (id: string, userId: string) => {
  const job = automationJobs.find((j: any) => j.id === id);
  const result = await executeApprovedJob(job, userId);
  if (result.status >= 400) throw new Error(result.body?.error || "فشل تنفيذ المهمة الخارجية.");
  return result.body;
};
registerAgentRoutes(app, {
  authenticateToken,
  requireOwner,
  orchestrator: agentOrchestrator,
  toolContextFor: (operator, userId) => buildAgentToolContext(operator, userId),
  persistState: () => { persistState(); saveAgentState(); },
  projectVersion: PROJECT_VERSION,
  env: process.env,
});

// مسارات منظومة DR (Google Drive): تفويض منفصل عن تسجيل الدخول، ونطاق
// drive.file حصراً. مسارات قراءة/تفويض فقط — لا رفع في هذه المرحلة.
registerDriveRoutes(app, {
  authenticateToken,
  requireOwner,
  env: process.env,
  loadControl: () => drControl,
  persistControl: (partial) => {
    Object.assign(drControl, partial);
    saveControlState();
  },
  collectSourceFiles: () => collectTrustedSourceTree(process.cwd(), { env: process.env }),
  dumpDatabase: () => storageAdapter.dump(),
  // بصمة محتوى مستقرة للقاعدة (تتجاهل الطوابع الزمنية): تُخزَّن مع النقطة وتُقارَن
  // دورياً فيكشف تغيّر البيانات (منتجات/أسعار/مبيعات) بلا تغيير كود. بلا سرّ.
  fingerprintDatabase: (dumpText: string) => computeLiveDatabaseFingerprint(dumpText).fingerprint,
  buildSecrets: () => buildSecretsBundle(process.env),
  recoveryInfo: (ctx) => ({
    information: buildRecoveryInformation({ repository: ctx.repository, createdAt: ctx.now }),
    instructions: buildRecoveryInstructions({ latestRecoveryPointId: ctx.recoveryPointId }),
  }),
  isolatedDatabaseUrl: process.env.DR_RECOVERY_TEST_DATABASE_URL || null,
  gitMeta: () => ({
    commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null,
    branch: process.env.RENDER_GIT_BRANCH || process.env.GIT_BRANCH || "main",
    repository: process.env.GHARABI_REPOSITORY || "mrdalghrabylltqsyt-web/al-gharabi-ai",
    project: "al-gharabi-ai",
  }),
  // تنبيه المالك عبر القناة القائمة (نفس pushNotification المستخدمة في تصعيدات
  // السوشيال/العقل). عنوان ونص عامّان فقط بلا أي محتوى عميل. غياب التنبيهة يُعلن.
  notifyOwner: (input) => {
    try {
      const n = pushNotification("owner", input.kind, input.title, input.body, input.severity);
      return { delivered: Boolean(n?.id), channel: "in_app_notification", error: n?.id ? null : "notification_not_created" };
    } catch (e) {
      return { delivered: false, channel: null, error: e instanceof Error ? e.name : "notifier_failed" };
    }
  },
});

// مسارات العقل المركزي (Central Brain) — قراءة/تحليل فقط، بلا أي تنفيذ خارجي.
// تعمل على كل المنصات المسجّلة (بلا منطق خاص بمنصة)، وتقرأ بيانات حقيقية فقط.
registerBrainRoutes(app, {
  authenticateToken,
  requireOwner,
  platforms: () => SUPPORTED_PLATFORMS.map((p: any) => p.id) as PlatformId[],
  runtimeInput: () => brainRuntimeInput(),
  persistMemory: (records) => persistBrainMemory(records),
  strategyState: () => summarizeStrategyState(strategyState),
  syncStrategyState: () => syncStrategyStateFromBrain(),
});

// مسارات فريق الوكلاء (Agent Council — Batch 6) — قراءة/تشخيص فقط.
// العقل المركزي ينسّق فريقاً داخلياً (بحث/تحليل/استراتيجية/نقد/قرار) على بيانات
// حقيقية. لا تنفيذ خارجي: الجلسة تنتج قراراً مقترحاً فقط، والبوابات القائمة تبقى
// المرجع. التشغيل (POST /run) للمالك فقط، والقرار يُكتب في نفس ذاكرة العقل القائمة.
registerTeamRoutes(app, {
  authenticateToken,
  requireOwner,
  sessions: () => teamSessionState.sessions,
  runSession: (trigger) => runTeamSessionNow(
    trigger,
    'تحليل الوضع الحالي للقناة وتقديم قرار مقترح من الأدلة الحقيقية (بلا اختراع)',
    'youtube',
    `manual:${new Date().toISOString().slice(0, 13)}`,
  ),
});

/**
 * أفعال العقول الستة الحتمية — مسارات owner للتدقيق والتنفيذ اليدوي.
 * whitelist صريحة (4 أفعال) بلا Gemini؛ أي شيء آخر يُصعَّد للعقل المركزي.
 * كل فعل يُسجَّل في سجل التدقيق الدائم.
 */
app.get("/api/agent/team/six-agent/audit", authenticateToken, requireOwner, (_req, res) => {
  return res.json({
    success: true,
    summary: summarizeSixAgentAudit(sixAgentAuditState),
    entries: sixAgentAuditState.entries.slice(0, 200),
    allowedActions: SIX_AGENT_ALLOWED_ACTIONS,
    executesExternalActions: false,
    geminiUsed: false,
    note: 'سجل تدقيق أفعال العقول الستة: أي عقل، أي قاعدة/نمط، الوقت، النتيجة. الأفعال الأربعة حتمية بلا Gemini.',
  });
});

app.post("/api/agent/team/six-agent/execute", authenticateToken, requireOwner, async (req, res) => {
  const action = String(req.body?.action || "");
  if (!isAllowedSixAgentAction(action)) {
    return res.status(422).json({ success: false, code: "ACTION_OUT_OF_WHITELIST", error: "الفعل خارج القائمة المسموحة الصريحة للعقول الستة.", allowedActions: SIX_AGENT_ALLOWED_ACTIONS });
  }
  const r = await trySixAgentAction({
    agentId: String(req.body?.agentId || "decision"),
    action,
    platform: String(req.body?.platform || "youtube"),
    commentId: typeof req.body?.commentId === "string" ? req.body.commentId : undefined,
    commentText: typeof req.body?.commentText === "string" ? req.body.commentText : undefined,
    tag: typeof req.body?.tag === "string" ? req.body.tag : undefined,
    metric: typeof req.body?.metric === "string" ? req.body.metric : undefined,
    value: Number.isFinite(req.body?.value) ? Number(req.body.value) : undefined,
    postId: typeof req.body?.postId === "string" ? req.body.postId : undefined,
    content: typeof req.body?.content === "string" ? req.body.content : undefined,
    priorRetryCount: Number.isFinite(req.body?.priorRetryCount) ? Number(req.body.priorRetryCount) : 0,
    singlePlatformFailure: req.body?.singlePlatformFailure === true,
  });
  return res.json({ success: true, decision: r.decision, outcome: r.outcome, evidenceRef: r.evidenceRef, requiresCentralBrain: r.requiresCentralBrain, geminiUsed: false });
});

// الطبقة الإدراكية (Batch 7) — قراءة/تحليل فقط: الذاكرة العاملة + تقارير الدورات
// الإدراكية (فهم/تذكّر/تخطيط/تعلّم). **لا مسار كتابة ولا تنفيذ خارجي ولا أسرار.**

/**
 * حلقة التعلّم الكاملة (ACTION→RESULT→FOLLOW-UP→LESSON→MEMORY→FUTURE) من سجلات
 * حقيقية فقط — بلا اختراع: عدد كل مرحلة من سجلات فعلية، والذاكرة من مخزن العقل
 * القائم (مفاتيح الدروس `lesson:`)، وتفاعل المتابعة من مراقب YouTube.
 */
function buildCognitionLearningLoop() {
  const processed = watcherState.processed;
  const actions = processed.filter((p) => p.stage === 'REPLIED' || p.stage === 'VERIFIED').length;
  const results = processed.filter((p) => Boolean(p.externalReplyId)).length;
  const baselined = processed.filter((p) => Boolean(p.followUpBaseline)).length;
  const observed = processed.filter((p) => Boolean(p.followUpOutcome)).length;
  const engagementChanged = processed.filter((p) => p.followUpOutcome?.kind === 'engagement_changed').length;
  const noChange = processed.filter((p) => p.followUpOutcome?.kind === 'no_change').length;
  const lessons = processed.filter((p) => p.followUpOutcome?.kind === 'engagement_changed').length;
  const lessonRecords = brainMemoryStore.records.filter((r) => r.id.startsWith('lesson:'));
  const stage = (name: string, count: number, note: string): { stage: string; labelAr: string; count: number; available: boolean; note: string } =>
    ({ stage: name, labelAr: '', count, available: true, note });
  return {
    stages: [
      stage('ACTION', actions, 'ردود حقيقية مُرسَلة عبر المنفّذ المركزي.'),
      stage('RESULT', results, 'تسليم مُثبَت بمعرّف من المزوّد.'),
      stage('FOLLOW_UP', observed, 'تفاعل متابعة ملاحَظ على الردود المُسلَّمة.'),
      stage('LESSON', lessons, 'دروس مستخلَصة من تغيّر تفاعل حقيقي (بلا ادعاء بيع).'),
      stage('MEMORY', lessonRecords.length, 'دروس محفوظة في الذاكرة طويلة المدى.'),
      stage('FUTURE_DECISION', cognitiveReports.length, 'دورات إدراكية ستؤثر في القرارات التالية.'),
    ],
    followUp: { baselined, observed, engagementChanged, noChange, lastChanged: processed.find((p) => p.followUpOutcome?.kind === 'engagement_changed')?.followUpOutcome || null },
    memory: {
      total: brainMemoryStore.records.length,
      lessonDerived: lessonRecords.length,
      recent: lessonRecords.slice(-10).map((r) => ({ key: r.id, kind: r.kind, source: r.sourceRefs[0] || '', summary: r.summary })),
    },
    note: 'حلقة تعلّم حقيقية: ACTION→RESULT→FOLLOW-UP→LESSON→MEMORY→FUTURE_DECISION — لا تُخترع نتيجة، وغير المتاح يُعلن صفراً صادقاً.',
  };
}

registerCognitionRoutes(app, {
  authenticateToken,
  requireOwner,
  reports: () => cognitiveReports,
  reportById: (id) => cognitiveReportById(id),
  workingMemory: () => workingMemoryState,
  learningLoop: () => buildCognitionLearningLoop(),
  brainAuthority: () => centralBrainAuthorityContract({
    cognitionConsumesBrainContext: true,
    strategyStateOwned: true,
    decisionLedgerOwned: true,
  }),
  decisionLedgerSummary: () => summarizeDecisionLedger(decisionLedger),
  decisionLedgerEntries: (limit) => decisionLedger.entries.slice(-limit).reverse(),
});

// -------------------------------------------------------------
// مسارات عامة حقيقية (بلا مصادقة): ملف تحقق ملكية الرابط + الصفحات القانونية.
// هذه ليست مسارات API ولا تحتاج جلسة — المزوّد (TikTok/Meta) والمتصفّح العام
// يطلبانها مباشرة. تُسجَّل قبل شبكة أمان /api لأنها لا تبدأ بـ/api أصلاً.
// -------------------------------------------------------------

/** سياق الصفحات القانونية: بريد المالك الفعلي إن وُجد + عنوان الموقع العام. */
function legalPageContext() {
  return {
    contactEmail: OWNER_EMAIL || null,
    publicUrl: resolvePublicUrl(process.env).baseUrl,
    updatedAt: "2026-09-26T00:00:00.000Z",
  };
}

/** يخدم ملف تحقق بلا تحويل (200) بنوع نص صريح وبطول بايت دقيق. */
function serveVerificationFile(res: express.Response, file: SiteVerificationFile) {
  // Buffer صريح يضمن طول بايت دقيقاً وبلا محرف سطر جديد مضاف وبلا تحويل charset.
  const body = Buffer.from(file.content, "utf8");
  res.status(200);
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Length", String(body.length));
  // بلا تخزين وسيط قد يقدّم نسخة قديمة، وبلا تحويل (no-transform) يغيّر البايتات.
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate, no-transform");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(body);
}

/**
 * يُلتقط **كل** طلب لملف تحقق TikTok (أي طريقة HTTP) مرة واحدة قبل معالجته،
 * فيكون السجل كاملاً حتى لو جاء الطلب بمسار فرعي أو استعلام أو طريقة غير GET.
 */
app.use((req, _res, next) => {
  if (isVerificationFileRequest(req.path)) recordVerificationRequest(req);
  next();
});

/**
 * ملف تحقق ملكية الرابط (URL prefix) الخاص بـTikTok. الاسم `/tiktok<token>.txt`
 * والمحتوى `tiktok-developers-site-verification=<token>` — كما تطلبه الوثيقة
 * الرسمية. قبل الإصلاح كان الطلب يسقط إلى index.html بحالة 200 فيفشل التحقق.
 *
 * السياسة: يُخدَم التوقيع **المطابق للاسم المطلوب**. إن طابق الاسم الرمز الفعّال
 * (أو الاسم البديل) يُخدَم كما هو؛ وإن حمل الاسم رمزاً صحيح الصيغة لكن مختلفاً
 * (رمز جديد ولّده TikTok) يُخدَم توقيعه هو (صدّى/echo) — لأن TikTok يتحقق من أن
 * المحتوى يطابق الرمز الذي طلبه، فلا ينجح إن أعدنا توقيع رمز آخر ولا إن أعدنا 404.
 * الاسم غير الصالح (بلا رمز معتبر) يُرفض 404 مع الاسم الصحيح للنشر الحالي.
 */
app.get(SITE_VERIFICATION_PATH_PATTERN, (req, res) => {
  const file = verificationFileForPath(req.path);
  if (file) return serveVerificationFile(res, file);
  res.status(404).type(VERIFICATION_CONTENT_TYPE).send(
    `ملف تحقق TikTok غير موجود: ${String(req.path || "").replace(/^\//, "")}\n` +
    `الملف الصحيح لهذا النشر: ${effectiveVerificationFile().filename}\n`,
  );
});

// اسم بديل شائع لنفس الملف (بالمحتوى نفسه)، فلا يفشل التحقق إن جُرّب.
app.get("/tiktok-developers-site-verification.txt", (_req, res) => {
  serveVerificationFile(res, siteVerificationFiles()[1]);
});

/** الصفحات القانونية العامة: شروط الخدمة وسياسة الخصوصية (Terms/Privacy URLs). */
app.get(["/terms", "/terms-of-service", "/terms-of-use", "/privacy", "/privacy-policy"], (req, res) => {
  const page = legalPageForPath(req.path, legalPageContext());
  if (!page) return res.status(404).type("text/plain; charset=utf-8").send("الصفحة غير موجودة.");
  res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(page.html);
});

// شبكة أمان لمسارات الـAPI: أي مسار تحت /api غير مُعرّف — أو طريقة HTTP غير
// مدعومة على مسار موجود — يجب أن يرد JSON 404 صريحاً. بدون هذا كانت هذه
// الطلبات تسقط إلى واجهة React فتُعيد index.html بحالة 200، فيظن العميل أن
// الطلب نجح ويتلقى HTML بدل خطأ مفهوم.
app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    error: "المسار غير موجود.",
    method: req.method,
    path: req.path,
    requestId: (req as any).requestId,
  });
});

// وسيط الأخطاء العام: أي خطأ غير مُلتقَط من أي مسار لا يُسقط الخادم ولا يُسرّب
// تفاصيل داخلية أو سرّاً. أخطاء محلّل الجسم (JSON مشوّه/حجم كبير) => 4xx صريحة،
// وما عداها 500 عام بلا stack. في الإنتاج الرسالة عامة دائماً.
app.use((err: unknown, req: any, res: any, next: any) => {
  const info = classifyHttpError(err);
  console.error(`[الغرابي AI] request error (${info.code}):`, safeErrorMessage(err, shouldExposeErrorMessage(process.env)));
  if (res.headersSent) return next(err);
  res.status(info.status).json({
    success: false,
    code: info.code,
    error: shouldExposeErrorMessage(process.env) ? safeErrorMessage(err, true) : info.message,
    requestId: req?.requestId,
  });
});

// Start Server and mount Vite middleware
let storageWarmup: Promise<void> | null = null;
/** تهيئة واحدة مشتركة للمخزن (تُستدعى من الخادم ومن دالة Serverless). */
function warmStorage(): Promise<void> {
  if (!storageWarmup) storageWarmup = bootstrapStorage();
  return storageWarmup;
}

async function startServer() {
  // تهيئة المخزن قبل الاستماع: Postgres يحتاج قراءة الحالة الفعلية أولاً،
  // وإلا بدأ الخادم بلقطة فارغة (طمس للإبطال واتصالات المنصات ومساحة العمل).
  await warmStorage();
  if (!storageReady) {
    // عند ضبط DATABASE_URL يكون المخزن الخارجي جزءاً من عقد الدوام: لا يجوز
    // الإقلاع بلا قراءة الحالة، ولا الرجوع لملف محلي، ولا الكتابة فوق حالة
    // قائمة. الفشل هنا صريح وسريع بدل خدمة تطبيق لا يحفظ شيئاً.
    if (storageAdapter.backend === "postgres") {
      throw new Error(`فشل الإقلاع: تعذّر تحميل الحالة من Postgres (${storageInitError || "storage_unavailable"}). لا رجوع لملف محلي ولا كتابة فوق حالة قائمة.`);
    }
    console.warn(`[الغرابي AI] storage not ready: ${storageInitError || "unknown"} — state writes are disabled until it recovers.`);
  }

  if (process.env.NODE_ENV !== "production") {
    // يُستورد Vite ديناميكياً عبر مُعرّف متغيّر ليبقى خارج حزمة Netlify Function:
    // المُجمّع لا يستطيع حلّه ثابتاً، وهو لا يُنفَّذ أصلاً داخل الدالة.
    const viteEntry = "vite";
    const { createServer: createViteServer } = await import(viteEntry);
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // مسارات الـAPI غير المعروفة تُعالَج في الشبكة أعلاه بـJSON 404، وليست هنا.
    // أي مسار يشبه ملف تحقق TikTok (ولو بمسار فرعي أو شرطة مائلة زائدة) لا
    // يُخدَم كواجهة React: HTML بحالة 200 يجعل TikTok يقرأ صفحة بدل التوقيع.
    app.get(/^\/(?!api\/).*/, (req, res) => {
      if (isVerificationFileRequest(req.path)) {
        return res.status(404).type(VERIFICATION_CONTENT_TYPE).send(
          `ملف تحقق TikTok غير موجود في هذا المسار: ${String(req.path || "")}\n` +
          `الملف الصحيح على الجذر: /${effectiveVerificationFile().filename}\n`,
        );
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[الغرابي AI Server] running on http://0.0.0.0:${PORT}`);
  });
  // فشل ربط المنفذ (مثل EADDRINUSE) كان يُسقط العملية بانهيار غير مفسَّر. الآن
  // يُسجَّل السبب صراحةً ثم تُنهى العملية برمز فشل صحيح (لا استمرار بلا استماع).
  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    const code = err?.code || "UNKNOWN";
    const hint = code === "EADDRINUSE"
      ? `المنفذ ${PORT} مستخدم بالفعل — أوقف العملية الأخرى أو اضبط PORT مختلفاً.`
      : "تعذّر ربط المنفذ؛ راجع صلاحيات الشبكة/المنفذ.";
    console.error(`[الغرابي AI Server] فشل الاستماع على المنفذ ${PORT} (${code}): ${hint}`);
    process.exit(1);
  });

  // مدير تشغيل YouTube 24/7: يبدأ حلقة المراقبة الداخلية بعد جهوزية المخزن
  // والاستماع. مستقلة عن المتصفح تماماً، وتصمد بعد restart/deploy بحفظ حالتها.
  startYouTubeWatcher();

  // الفحص الساعي لمنظومة DR: مؤقّت داخلي مستقل عن المتصفح (لا يعتمد على تفاعل
  // المستخدم). يقارن مصدر المشروع مع CURRENT ويزامن عند التغيّر فقط. `.unref()`
  // داخلياً فلا يمنع الإغلاق النظيف، والقفل يمنع التشغيل المتوازي.
  try {
    (app as any).drReconciliation?.start?.();
  } catch (e: any) {
    console.error("[الغرابي AI] failed to start DR hourly reconciliation:", String(e?.message || e).slice(0, 120));
  }

  // النسخة الاحتياطية الكاملة التلقائية كل 6 ساعات: Recovery Point كامل (مصدر + DB
  // مشفّرة + secrets.enc + خزنة المفاتيح) عبر نفس المسار الرسمي. مؤقّت داخلي على
  // الخادم، مستقل عن المتصفح، ولا يُنشئ نسخة عند كل إعادة تشغيل (قرار بالزمن المنقضي)،
  // ويستخدم نفس قفل النسخ فيمنع التشغيل المتوازي.
  try {
    (app as any).drAutoBackup?.start?.();
  } catch (e: any) {
    console.error("[الغرابي AI] failed to start DR full auto-backup:", String(e?.message || e).slice(0, 120));
  }

  // العقل المركزي 24/7 (Batch 5): مُشغِّل داخلي يبني العقل من بيانات الإنتاج
  // الحقيقية ويحفظ الذاكرة الجديدة عبر نفس مسار الحفظ القائم. مؤقّت على الخادم
  // مستقل عن المتصفح، ولا يُنشئ دورة عند كل إعادة تشغيل (قرار بالزمن المنقضي + قفل)،
  // ولا يستدعي Gemini ولا ينفّذ أي إجراء خارجي.
  try {
    startBrainRuntime();
  } catch (e: any) {
    console.error("[الغرابي AI] failed to start Central Brain runtime:", String(e?.message || e).slice(0, 120));
  }

  // إغلاق نظيف: ينتظر تفريغ طابور الكتابة (مع مهلة صارمة ≤ 10 ثوانٍ) ثم يُنهي
  // اتصال قاعدة البيانات ويخرج. المهلة تمنع تعليق العملية إن تجمّد المخزن.
  // نُفرّغ الطابور في حلقة لأن كتابة جديدة قد تُسلسَل أثناء الإغلاق، فنلتقط
  // أحدث وعد حتى يستقر الطابور فعلاً (أو تنتهي المهلة).
  let shuttingDown = false;
  const drainQueue = async (): Promise<void> => {
    const startedAt = Date.now();
    let pending = persistQueue;
    while (Date.now() - startedAt < 10_000) {
      await pending.catch(() => { /* نُكمل الإغلاق حتى لو فشلت كتابة */ });
      if (pending === persistQueue) return;
      pending = persistQueue;
    }
  };
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[الغرابي AI] received ${signal}, flushing pending writes...`);
    // Phase 6: نوقف المؤقّتات الداخلية أولاً فلا تُضاف كتابات جديدة أثناء الإغلاق.
    try { watcherScheduler?.stop(); } catch { /* تجاهل */ }
    try { stopBrainRuntime(); } catch { /* تجاهل */ }
    try { (app as any).drReconciliation?.stop?.(); } catch { /* تجاهل */ }
    try { (app as any).drAutoBackup?.stop?.(); } catch { /* تجاهل */ }
    try { clearInterval(runtimeCleanupTimer); } catch { /* تجاهل */ }
    try { clearInterval(safeJobWorkerTimer); } catch { /* تجاهل */ }
    try { clearInterval(tiktokReconcileTimer); } catch { /* تجاهل */ }
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    Promise.race([drainQueue(), deadline])
      .then(() => storageAdapter.close().catch(() => { /* تجاهل */ }))
      .finally(() => process.exit(0));
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

// داخل Netlify Functions لا يوجد خادم دائم: يلتقط الطلب handler المُصدَّر من
// netlify/functions/api.ts، ولا يُستدعى app.listen() إطلاقاً.
const isNetlifyFunction =
  Boolean(process.env.NETLIFY) ||
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
  Boolean(process.env.LAMBDA_TASK_ROOT);

if (!isNetlifyFunction) {
  startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}

export { app, isNetlifyFunction };
export { warmStorage };
export default app;
