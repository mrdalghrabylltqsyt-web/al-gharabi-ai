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
import { registerSocialManagerRoutes } from "./engine/social/routes";
import { PLATFORM_SPECS, platformSupports, hasRealConnector, credentialModeOf, isSupportedPlatform, buildAdapters } from "./engine/social/registry";
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
  resolveInstagramScopes,
  missingInstagramScopeDependenciesFromCsv,
  type InstagramFetch,
  type InstagramLinkedPage,
} from "./engine/social/instagram";
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
  buildPhotoPostBody,
  isPlausibleTikTokClientKey,
  tiktokCapabilityStatus,
  tiktokCapabilityNeedsAudit,
  type TikTokFetch,
  type TikTokPostMode,
  type TikTokPrivacyLevel,
} from "./engine/social/tiktok";
import {
  createOAuthState,
  createPkcePair,
  requiresPkce,
  validateOAuthCallback,
  buildAuthorizationParams,
  buildTokenExchangeBody,
  parseTokenResponse,
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
  type ReplyRecord,
} from "./engine/social/comments";
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
  buildMarketingDecision,
  buildMemorySnapshot,
  type PerformanceRecord,
} from "./engine/social/brain";
import {
  analyzeBusinessClaims,
  analyzeRequestClaims,
  buildBusinessFacts,
  buildSafeBusinessReply,
  type BusinessFacts,
  type BusinessClaimViolation,
} from "./engine/social/contentSafety";
import { getOwnerEmailConfig, sendOwnerOtpEmail } from "./engine/notifications/owner-email";
import {
  createStorageAdapter,
  isEphemeralHost,
  STORAGE_KEY_STATE,
  STORAGE_KEY_USAGE,
  STORAGE_KEY_CONTROL,
  type StorageAdapter,
  type StorageStatus,
} from "./engine/storage/adapter";
import { SESSION_TTL_MS, signSession, verifySession, type SessionPayload } from "./engine/auth/sessions";
import { CHALLENGE_TTL_MS, issueChallengeCode, matchChallengeWindow } from "./engine/auth/challenge";
import { isScheduleInFuture, normalizeScheduleInput, wallClockToEpoch } from "./src/utils/scheduleTime";

dotenv.config();

const app = express();
// PORT is configurable so the app can run behind any host that injects its own
// port (containers/PaaS). Values outside the valid TCP range fall back to 3000.
const PORT = (() => {
  const raw = Number(process.env.PORT);
  return Number.isInteger(raw) && raw > 0 && raw <= 65535 ? raw : 3000;
})();
const PROJECT_VERSION = "13.0.0";
const STATE_SCHEMA_VERSION = 16;

// Body parser يُبقي نسخة نصية من البايتات المرسلة نفسها في req.rawBody.
// هذا ضروري للتحقق من توقيع HMAC (X-Hub-Signature-256) على الجسم الخام تماماً
// كما أرسله Meta، لا على إعادة تسلسل req.body (قد تختلف المسافات/ترتيب المفاتيح).
// كونه الوسيط الأول يعني أنه يقرأ التدفق الوحيد نفسه، فلا يجد أي محلّل لاحق شيئاً.
app.use(express.json({
  limit: "256kb",
  verify: (req: any, _res: unknown, buf: Buffer) => {
    if (typeof req.rawBody !== "string") req.rawBody = buf?.toString("utf8") ?? "";
  },
}));

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
  if (!item || now - item.startedAt >= 15 * 60 * 1000) {
    authAttemptWindow.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (item.count >= limit) return false;
  item.count += 1;
  return true;
}


// Baseline security headers without adding another dependency.
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
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
    return { users, revokedSessions: Array.isArray(raw.revokedSessions) ? raw.revokedSessions : [], userRevocations: Array.isArray(raw.userRevocations) ? raw.userRevocations : [], audit: Array.isArray(raw.audit) ? raw.audit.slice(0, 200) : [], jobs: Array.isArray(raw.jobs) ? raw.jobs.slice(0, 200) : [], platformConnections: Array.isArray(raw.platformConnections) ? raw.platformConnections : [], workspace: raw.workspace && typeof raw.workspace === "object" ? { showroom: raw.workspace.showroom || {}, products: Array.isArray(raw.workspace.products) ? raw.workspace.products.slice(0, 1000) : [], posts: Array.isArray(raw.workspace.posts) ? raw.workspace.posts.slice(0, 1000) : [], conversations: Array.isArray(raw.workspace.conversations) ? raw.workspace.conversations.slice(0, 1000) : [], installmentPlans: Array.isArray(raw.workspace.installmentPlans) ? raw.workspace.installmentPlans.slice(0, 200) : [], leads: Array.isArray(raw.workspace.leads) ? raw.workspace.leads.slice(0, 2000) : [], tasks: Array.isArray(raw.workspace.tasks) ? raw.workspace.tasks.slice(0, 1000) : [], sales: Array.isArray(raw.workspace.sales) ? raw.workspace.sales.slice(0, 5000) : [], payments: Array.isArray(raw.workspace.payments) ? raw.workspace.payments.slice(0, 10000) : [], inventoryMovements: Array.isArray(raw.workspace.inventoryMovements) ? raw.workspace.inventoryMovements.slice(0, 20000) : [], suppliers: Array.isArray(raw.workspace.suppliers) ? raw.workspace.suppliers.slice(0, 1000) : [], purchases: Array.isArray(raw.workspace.purchases) ? raw.workspace.purchases.slice(0, 5000) : [], expenses: Array.isArray(raw.workspace.expenses) ? raw.workspace.expenses.slice(0, 10000) : [], contracts: Array.isArray(raw.workspace.contracts) ? raw.workspace.contracts.slice(0, 5000) : [], installmentSchedules: Array.isArray(raw.workspace.installmentSchedules) ? raw.workspace.installmentSchedules.slice(0, 20000) : [], notifications: Array.isArray(raw.workspace.notifications) ? raw.workspace.notifications.slice(0, 10000) : [], webhookEvents: Array.isArray(raw.workspace.webhookEvents) ? raw.workspace.webhookEvents.slice(0, 10000) : [], providerEvents: Array.isArray(raw.workspace.providerEvents) ? raw.workspace.providerEvents.slice(0, 10000) : [], marketingBriefs: Array.isArray(raw.workspace.marketingBriefs) ? raw.workspace.marketingBriefs.slice(0, 2000) : [], marketingCampaigns: Array.isArray(raw.workspace.marketingCampaigns) ? raw.workspace.marketingCampaigns.slice(0, 1000) : [], socialComments: Array.isArray(raw.workspace.socialComments) ? raw.workspace.socialComments.slice(0, 10000) : [], socialReplies: Array.isArray(raw.workspace.socialReplies) ? raw.workspace.socialReplies.slice(0, 5000) : [], socialApprovals: Array.isArray(raw.workspace.socialApprovals) ? raw.workspace.socialApprovals.slice(0, 5000) : [], publishRecords: Array.isArray(raw.workspace.publishRecords) ? raw.workspace.publishRecords.slice(0, 5000) : [], performanceRecords: Array.isArray(raw.workspace.performanceRecords) ? raw.workspace.performanceRecords.slice(0, 20000) : [], marketingDecisions: Array.isArray(raw.workspace.marketingDecisions) ? raw.workspace.marketingDecisions.slice(0, 2000) : [], strategiesTested: Array.isArray(raw.workspace.strategiesTested) ? raw.workspace.strategiesTested.slice(0, 2000) : [], telegramUpdateIds: Array.isArray(raw.workspace.telegramUpdateIds) ? raw.workspace.telegramUpdateIds.slice(0, 20000) : [], facebookEventIds: Array.isArray(raw.workspace.facebookEventIds) ? raw.workspace.facebookEventIds.slice(0, 20000) : [], instagramEventIds: Array.isArray(raw.workspace.instagramEventIds) ? raw.workspace.instagramEventIds.slice(0, 20000) : [], tiktokEventIds: Array.isArray(raw.workspace.tiktokEventIds) ? raw.workspace.tiktokEventIds.slice(0, 20000) : [], providerTokens: raw.workspace.providerTokens && typeof raw.workspace.providerTokens === "object" ? raw.workspace.providerTokens : {} } : { showroom: {}, products: [], posts: [], conversations: [], installmentPlans: [], leads: [], tasks: [], sales: [], payments: [], inventoryMovements: [], suppliers: [], purchases: [], expenses: [], contracts: [], installmentSchedules: [], notifications: [], webhookEvents: [], providerEvents: [], marketingBriefs: [], marketingCampaigns: [], socialComments: [], socialReplies: [], socialApprovals: [], publishRecords: [], performanceRecords: [], marketingDecisions: [], strategiesTested: [], telegramUpdateIds: [], facebookEventIds: [], instagramEventIds: [], tiktokEventIds: [], providerTokens: {} } };
  } catch {
    return { users: [defaultOwner], revokedSessions: [], userRevocations: [], audit: [], jobs: [], workspace: { showroom: {}, products: [], posts: [], conversations: [], installmentPlans: [], leads: [], tasks: [], sales: [], payments: [], inventoryMovements: [], suppliers: [], purchases: [], expenses: [], contracts: [], installmentSchedules: [], notifications: [], webhookEvents: [], providerEvents: [], marketingBriefs: [], marketingCampaigns: [], socialComments: [], socialReplies: [], socialApprovals: [], publishRecords: [], performanceRecords: [], marketingDecisions: [], strategiesTested: [], telegramUpdateIds: [], providerTokens: {} } };
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
for (const key of ["telegramUpdateIds","facebookEventIds","instagramEventIds","tiktokEventIds"]) if (!Array.isArray((workspace as any)[key])) (workspace as any)[key] = [];
if (!(workspace as any).providerTokens || typeof (workspace as any).providerTokens !== "object") (workspace as any).providerTokens = {};
// سجلات مدير السوشيال ميديا: تعليقات، ردود، نتائج نشر، وقرارات تسويقية.
// كلها سجلات تشغيلية حقيقية تُبنى من عمليات فعلية فقط.
for (const key of ["socialComments","socialReplies","socialApprovals","publishRecords","marketingDecisions","strategiesTested","performanceRecords"]) if (!Array.isArray((workspace as any)[key])) (workspace as any)[key] = [];

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
  return session;
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
    // Return standard message to prevent email enumeration
    return res.json({
      success: true,
      message: "إذا كان هذا البريد مسجلاً، فقد تم إصدار رمز التحقق بنجاح.",
    });
  }

  // الرمز يُشتق رياضياً من مفتاح الخادم والنافذة الزمنية، فلا يعتمد على ذاكرة
  // مشتركة ويمكن التحقق منه في أي عملية.
  const code = issueChallengeCode(normalizedEmail, SESSION_SECRET);

  // الإرسال الفعلي عبر Resend. لا يُسجَّل الرمز ولا يُعاد في الاستجابة إطلاقاً.
  const result = await sendOwnerOtpEmail({ to: normalizedEmail, code });
  if (!result.sent) {
    auditLog.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), userId: "system", action: "owner_challenge_email_failed", detail: result.error || "send_failed" });
    if (auditLog.length > 100) auditLog.pop();
    persistState();
    return res.status(502).json({
      success: false,
      error: "تعذر إرسال رمز التحقق، حاول مرة أخرى",
    });
  }

  auditLog.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), userId: "system", action: "owner_challenge_email_sent", detail: "owner-challenge-delivered" });
  if (auditLog.length > 100) auditLog.pop();
  persistState();

  return res.json({
    success: true,
    message: "تم إرسال رمز التحقق إلى بريد المالك",
  });
});

app.post("/api/auth/verify-challenge", async (req, res) => {
  const { email, code } = req.body;
  const normalizedEmail = (email || "").toLowerCase().trim();

  if (!normalizedEmail || !code) {
    return res.status(400).json({ success: false, error: "البريد الإلكتروني ورمز التحقق مطلوبان." });
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
    loginConfigId: META_OAUTH_PLATFORMS.has(platform) ? loginConfigIdFor(platform) : null,
    instagramOnboarding: platform === "instagram",
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
function loginConfigIdFor(platform: string): string | null {
  return resolveLoginConfigId(platform, process.env);
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
  youtube: { provider: "google", auth: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", clientId: envSecret("GOOGLE_OAUTH_CLIENT_ID") || envSecret("GOOGLE_CLIENT_ID"), clientSecret: envSecret("GOOGLE_OAUTH_CLIENT_SECRET"), scopes: ["https://www.googleapis.com/auth/youtube.upload"] },
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
/** سرّ توقيع webhook: من اعتماد الصفحة المحفوظ ثم البيئة. */
function facebookAppSecret(): string {
  const stored = getProviderToken("facebook");
  if (stored?.appSecret) return String(stored.appSecret);
  return FACEBOOK_APP_SECRET_ENV;
}
/** رمز تحقق الاشتراك: من الاعتماد المحفوظ ثم البيئة. */
function facebookVerifyToken(): string { return FACEBOOK_VERIFY_TOKEN_ENV; }
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
 * يثبت صفحة محدّدة فعلياً: يجلب هويتها ورمزها من Graph، يشترك تطبيقنا في
 * أحداثها (feed/messages)، ثم يحفظ الاعتماد ويعلن الاتصال الموثق. لا يُعلن
 * الاتصال بلا استجابة صفحة حقيقية. تُستخدم من OAuth callback ومن اختيار الصفحة.
 */
async function facebookFinalizePageSelection(pageId: string, userAccessToken: string): Promise<{ ok: boolean; pageName?: string | null; error?: string; subscribed?: boolean }> {
  const client = facebookClient();
  const proof = await client.getPageProfile(pageId, userAccessToken);
  if (!proof.ok || !proof.data?.pageId || !proof.data.pageAccessToken) {
    return { ok: false, error: proof.error || "تعذّر إثبات هوية الصفحة أو الحصول على رمز الصفحة." };
  }
  const pageToken = proof.data.pageAccessToken;
  // اشتراك التطبيق في أحداث الصفحة. عدم الاشتراك لا يُبطل الاتصال لكنه يُعلن
  // صراحةً لأن بدون اشتراك لن تصل أي أحداث webhook.
  const sub = await client.subscribeApp(pageId, pageToken, FACEBOOK_SUBSCRIBED_FIELDS);
  saveFacebookCredentials({ pageId: proof.data.pageId, pageName: proof.data.pageName, pageAccessToken: pageToken, userAccessToken });
  platformConnections.set("facebook", { platform: "facebook", status: "connected", accountId: proof.data.pageId, accountName: proof.data.pageName || "Facebook Page", connectedAt: new Date().toISOString(), providerVerified: true });
  savePlatformConnections();
  return { ok: true, pageName: proof.data.pageName, subscribed: sub.ok, error: sub.ok ? undefined : sub.error };
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
    if (!pageId || !token) return { verified: false, error: "لا اعتماد صفحة Facebook محفوظ؛ نفّذ الربط عبر OAuth أولاً." };
    // إثبات حي: نستعلم عن هوية الصفحة فعلياً من Graph API بلا أي ادعاء.
    const proof = await facebookClient().getPageProfile(pageId, token);
    if (!proof.ok || !proof.data?.pageId) return { verified: false, error: proof.error || "تعذر إثبات هوية صفحة Facebook." };
    return { verified: true, accountId: proof.data.pageId, accountName: proof.data.pageName || stored?.pageName || undefined };
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

/**
 * إثبات الحساب لدى المزود بعد تبادل الرمز. لا نختلق هوية: إن لم تدعم الواجهة
 * استعلاماً مباشراً أو فشل، نُبقي المعرّف العام ونعتمد الإثبات على نجاح التبادل.
 * كل استدعاء هنا رسمي ومحدود، ولا يُسجّل أي رمز.
 */
async function fetchProviderAccount(platform: string, accessToken: string): Promise<{ accountId?: string; accountName?: string } | null> {
  try {
    if (platform === "youtube") {
      const r = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${accessToken}` } });
      const d = await r.json(); if (r.ok && d.items?.[0]) return { accountId: d.items[0].id, accountName: d.items[0].snippet?.title };
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
  const scopes = platform==="facebook" ? facebookOAuthScopes() : platform==="instagram" ? instagramOAuthScopes() : (Array.isArray(cfg.scopes) ? cfg.scopes : []);
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
  const loginConfigId = META_OAUTH_PLATFORMS.has(platform) ? loginConfigIdFor(platform) : null;
  const state=createOAuthState();
  const pending:OAuthPending={platform,userId:(req as any).user.id,expiresAt:Date.now()+OAUTH_STATE_TTL_MS,redirectUri:callbackUrl};
  let pkceChallenge:string|undefined;
  if(requiresPkce(platform)) { const pkce=createPkcePair(); pending.codeVerifier=pkce.verifier; pkceChallenge=pkce.challenge; }
  pendingOAuth.set(state,pending);
  const u=new URL(authEndpointFor(platform));
  const params=buildAuthorizationParams({platform,clientId:cfg.clientId,redirectUri:callbackUrl,scopes,state,pkceChallenge,loginConfigId,instagramOnboarding:platform==="instagram"&&instagramOnboardingEnabled()});
  for(const [k,v] of Object.entries(params)) u.searchParams.set(k,v);
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
    // Facebook Login for Business: عند استخدام config_id تُذكر الصلاحيات كالمجموعة
    // المتوقعة في الConfiguration، ويُعلن صراحةً أن الطلب لم يحمل scope.
    loginConfigIdUsed:Boolean(loginConfigId),
    loginConfigIdConfigured:preflight.loginConfig?.configured??false,
    loginConfigIdValid:preflight.loginConfig?.valid??false,
    loginConfigEnvNames:META_OAUTH_PLATFORMS.has(platform)?loginConfigEnvNames(platform):undefined,
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
  return handleOAuthCallback(req, res, req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "", false);
});

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
  if(params.get("error")) return failHtml(400, `رفض مزود المنصة عملية الربط: ${String(params.get("error_description")||params.get("error")).slice(0,200)}`);
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
        const fin=await facebookFinalizePageSelection(pages.data[0].pageId,userToken);
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
    const tokenRes=await fetch(cfg.token,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body}); token=await tokenRes.json();
    const parsedToken=parseTokenResponse(token);
    if(!tokenRes.ok || !parsedToken.valid) throw new Error(parsedToken.reason||token.error_description||token.error||"فشل تبادل رمز OAuth");
    // إثبات حساب حقيقي حيث توفّره الواجهة الرسمية (لا نختلق هوية عند غياب الاستعلام).
    let accountId="authorized-user", accountName="حساب متصل";
    const proof=await fetchProviderAccount(platform,parsedToken.accessToken!);
    if(proof) { accountId=proof.accountId||accountId; accountName=proof.accountName||accountName; }
    // يُخزَّن الرمز مع انتهاء مطلق محسوب ومع refresh token إن وُجد.
    const stored={...token, expiresAt: parsedToken.expiresIn ? Date.now()+parsedToken.expiresIn*1000 : null};
    setProviderToken(platform,stored); platformConnections.set(platform,{platform,status:"connected",accountId,accountName,connectedAt:new Date().toISOString(),providerVerified:true}); savePlatformConnections(); audit(pending!.userId,"platform_oauth_connected",`${platform}:${accountId}`);
    sendHtml("<html lang='ar' dir='rtl'><meta charset='utf-8'><title>تم الربط</title><body style='font-family:sans-serif;padding:40px'><h2>تم ربط المنصة بنجاح.</h2><p>يمكنك إغلاق هذه النافذة والعودة إلى الغرابي AI.</p></body></html>");
  } catch(e:any) { audit(pending!.userId,"platform_oauth_failed",platform); failHtml(502, `فشل إكمال ربط المنصة: ${String(e?.message||e).slice(0,240)}`); }
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
  if(!Array.isArray((workspace as any).webhookEvents)) (workspace as any).webhookEvents = [];
  const externalId = telegramExternalId(parsed.chatId, parsed.messageId);
  const seenUpdates = (workspace as any).telegramUpdateIds || [];
  const seenExternal = (workspace as any).socialComments.filter((c:any)=>c.platform==="telegram").map((c:any)=>c.externalId);
  if(isDuplicateUpdate({ updateId: parsed.updateId, externalId, seenUpdateIds: seenUpdates, seenExternalIds: seenExternal })){
    logTelegramWebhook({ updateId: parsed.updateId, externalId, outcome: "duplicate" });
    return res.status(200).json({success:true,duplicate:true,externalId});
  }
  // تخزين الحد الأدنى للحماية من التكرار ثم تمرير الرسالة لمخزن تعليقات مدير السوشيال.
  (workspace as any).telegramUpdateIds = [...seenUpdates, parsed.updateId].slice(-20000);
  if(!Array.isArray((workspace as any).socialComments)) (workspace as any).socialComments = [];
  const classification = classifyComment(parsed.text);
  const comment = {
    id: workspaceId("comment"), platform: "telegram", externalId,
    postExternalId: null, authorName: parsed.authorName||null, text: parsed.text,
    createdAt: parsed.date || new Date().toISOString(), classification,
    requiresHumanReview: classification.requiresHumanReview, ingestSource: "telegram_webhook",
    // هدف الرد الحقيقي: الدردشة والرسالة، فيستطيع المُرسل الرد فعلياً لاحقاً.
    replyTarget: { chatId: parsed.chatId, messageId: parsed.messageId },
  };
  (workspace as any).socialComments.unshift(comment);
  if((workspace as any).socialComments.length>10000) (workspace as any).socialComments.pop();
  (workspace as any).webhookEvents.unshift({id:workspaceId("event"),platform:"telegram",type:"message",externalId,receivedAt:new Date().toISOString()});
  (workspace as any).webhookEvents=(workspace as any).webhookEvents.slice(0,10000);
  // ننتظر الكتابة الدائمة **قبل** إرجاع 200: تضمن أن التعليق ومعرّف التحديث
  // (حماية التكرار) صارا في Postgres، فلا يُفقدان لو عُلّقت العملية بعد الرد.
  await persistStateDurable();
  const persisted = !lastPersistError;
  audit("system","telegram_inbound_message",externalId);
  logTelegramWebhook({ updateId: parsed.updateId, externalId, outcome: "accepted", persisted });
  res.status(200).json({success:true,accepted:true,externalId,commentId:comment.id,requiresHumanReview:classification.requiresHumanReview,persisted});
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
  const result=await facebookFinalizePageSelection(pageId,userToken);
  if(!result.ok) return res.status(502).json({success:false,error:result.error||"تعذّر ربط الصفحة المختارة."});
  await persistStateDurable();
  audit((req as any).user.id,"facebook_page_selected",pageId);
  res.json({success:true,connection:safeConnection("facebook"),pageName:result.pageName||null,webhookSubscribed:result.subscribed===true});
});

/** إثبات اشتراك الصفحة الفعلي في webhook (مقابل subscribed_apps). */
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
  if(!Array.isArray((workspace as any).socialComments)) (workspace as any).socialComments=[];
  if(!Array.isArray((workspace as any).facebookEventIds)) (workspace as any).facebookEventIds=[];
  const seenExternal=(workspace as any).socialComments.filter((c:any)=>c.platform==="facebook").map((c:any)=>c.externalId);
  const accepted:string[]=[];
  let duplicates=0;
  for(const ev of parsed.events){
    if(isReplayOrDuplicate({providerEventId:ev.externalId,externalId:ev.externalId,seenProviderEventIds:(workspace as any).facebookEventIds,seenExternalIds:[...seenExternal,...accepted]})){ duplicates+=1; logFacebookWebhook({kind:ev.kind,externalId:ev.externalId,outcome:"duplicate"}); continue; }
    const classification=classifyComment(ev.text);
    (workspace as any).socialComments.unshift({
      id:workspaceId("comment"),platform:"facebook",kind:ev.kind,externalId:ev.externalId,
      postExternalId:ev.parentExternalId,authorName:ev.authorName,text:ev.text,
      createdAt:ev.createdAt,classification,requiresHumanReview:classification.requiresHumanReview,
      // مصدر الاستقبال حقيقي صراحةً، فلا يظهر كـ simulated/not delivered.
      ingestSource:"facebook_webhook",replyTarget:ev.replyTarget,
    });
    if((workspace as any).socialComments.length>10000) (workspace as any).socialComments.pop();
    (workspace as any).facebookEventIds=[...(workspace as any).facebookEventIds,ev.externalId].slice(-20000);
    accepted.push(ev.externalId);
    logFacebookWebhook({kind:ev.kind,externalId:ev.externalId,outcome:"accepted"});
  }
  (workspace as any).webhookEvents.unshift(...accepted.map((id)=>({id:workspaceId("event"),platform:"facebook",type:"webhook",externalId:id,receivedAt:new Date().toISOString()})));
  (workspace as any).webhookEvents=(workspace as any).webhookEvents.slice(0,10000);
  // ننتظر الكتابة الدائمة قبل الإقرار: تضمن ثبات الحدث ومعرّف منع التكرار.
  await persistStateDurable();
  const persisted=!lastPersistError;
  if(accepted.length) audit("system","facebook_inbound_events",`${accepted.length}/${parsed.events.length}`);
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
  if((workspace as any).socialReplies.length>5000) (workspace as any).socialReplies.pop();
  audit(user.id,result.ok?"social_facebook_comment_reply_sent":"social_facebook_comment_reply_failed",`${externalId}:${result.ok?"delivered":"failed"}`);
  await persistStateDurable();
  if(!result.ok) return res.status(502).json({success:false,delivered:false,simulated:false,reply:record,error:record.deliveryError});
  res.json({success:true,delivered:true,simulated:false,providerReplyId:record.providerReplyId,reply:record});
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
  if((workspace as any).socialReplies.length>5000) (workspace as any).socialReplies.pop();
  audit(user.id,result.ok?"social_facebook_message_reply_sent":"social_facebook_message_reply_failed",`${guardExternalId}:${result.ok?"delivered":"failed"}`);
  await persistStateDurable();
  if(!result.ok) return res.status(502).json({success:false,delivered:false,simulated:false,reply:record,error:record.deliveryError});
  res.json({success:true,delivered:true,simulated:false,providerReplyId:record.providerReplyId,reply:record});
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
  if(!Array.isArray((workspace as any).socialComments)) (workspace as any).socialComments=[];
  if(!Array.isArray((workspace as any).instagramEventIds)) (workspace as any).instagramEventIds=[];
  const seenExternal=(workspace as any).socialComments.filter((c:any)=>c.platform==="instagram").map((c:any)=>c.externalId);
  const accepted:string[]=[];
  let duplicates=0;
  for(const ev of parsed.events){
    if(isReplayOrDuplicate({providerEventId:ev.externalId,externalId:ev.externalId,seenProviderEventIds:(workspace as any).instagramEventIds,seenExternalIds:[...seenExternal,...accepted]})){ duplicates+=1; logInstagramWebhook({kind:ev.kind,externalId:ev.externalId,outcome:"duplicate"}); continue; }
    const classification=classifyComment(ev.text);
    (workspace as any).socialComments.unshift({
      id:workspaceId("comment"),platform:"instagram",kind:ev.kind,externalId:ev.externalId,
      postExternalId:ev.parentExternalId,authorName:ev.authorName,text:ev.text,
      createdAt:ev.createdAt,classification,requiresHumanReview:classification.requiresHumanReview,
      // مصدر الاستقبال حقيقي صراحةً، فلا يظهر كـ simulated/not delivered.
      ingestSource:"instagram_webhook",replyTarget:ev.replyTarget,
    });
    if((workspace as any).socialComments.length>10000) (workspace as any).socialComments.pop();
    (workspace as any).instagramEventIds=[...(workspace as any).instagramEventIds,ev.externalId].slice(-20000);
    accepted.push(ev.externalId);
    logInstagramWebhook({kind:ev.kind,externalId:ev.externalId,outcome:"accepted"});
  }
  (workspace as any).webhookEvents.unshift(...accepted.map((id)=>({id:workspaceId("event"),platform:"instagram",type:"webhook",externalId:id,receivedAt:new Date().toISOString()})));
  (workspace as any).webhookEvents=(workspace as any).webhookEvents.slice(0,10000);
  // ننتظر الكتابة الدائمة قبل الإقرار: تضمن ثبات الحدث ومعرّف منع التكرار.
  await persistStateDurable();
  const persisted=!lastPersistError;
  if(accepted.length) audit("system","instagram_inbound_events",`${accepted.length}/${parsed.events.length}`);
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
  if((workspace as any).socialReplies.length>5000) (workspace as any).socialReplies.pop();
  audit(user.id,result.ok?"social_instagram_comment_reply_sent":"social_instagram_comment_reply_failed",`${externalId}:${result.ok?"delivered":"failed"}`);
  await persistStateDurable();
  if(!result.ok) return res.status(502).json({success:false,delivered:false,simulated:false,reply:record,error:record.deliveryError});
  res.json({success:true,delivered:true,simulated:false,providerReplyId:record.providerReplyId,reply:record});
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
  if((workspace as any).socialReplies.length>5000) (workspace as any).socialReplies.pop();
  audit(user.id,result.ok?"social_instagram_message_reply_sent":"social_instagram_message_reply_failed",`${guardExternalId}:${result.ok?"delivered":"failed"}`);
  await persistStateDurable();
  if(!result.ok) return res.status(502).json({success:false,delivered:false,simulated:false,reply:record,error:record.deliveryError});
  res.json({success:true,delivered:true,simulated:false,providerReplyId:record.providerReplyId,reply:record});
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
  res.json({
    success:true,
    platform:"tiktok",
    state: verified ? "OPERATIONAL_READY" : conn?.status==="connected" ? "CONNECTED" : "DISCONNECTED",
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
    checkedAt:new Date().toISOString(),
    note:"حالة حقيقية من TikTok بلا أي سرّ. لا يُعلن الاتصال موثقاً إلا بمعرّف open_id من TikTok.",
  });
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
  (workspace as any).providerEvents=(workspace as any).providerEvents.slice(0,10000);
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

  if (!Array.isArray((workspace as any).webhookEvents)) (workspace as any).webhookEvents = [];
  if (!Array.isArray((workspace as any).socialComments)) (workspace as any).socialComments = [];
  const seenExternal = (workspace as any).socialComments.filter((c: any) => c.platform === platform).map((c: any) => c.externalId);
  const accepted: string[] = [];
  for (const ev of events) {
    if (isReplayOrDuplicate({ providerEventId: ev.externalId, externalId: ev.externalId, seenProviderEventIds: [], seenExternalIds: [...seenExternal, ...accepted] })) continue;
    const classification = classifyComment(ev.text);
    (workspace as any).socialComments.unshift({
      id: workspaceId("comment"), platform, externalId: ev.externalId, kind: ev.kind,
      postExternalId: ev.parentExternalId, authorName: ev.authorName, text: ev.text,
      createdAt: ev.createdAt, classification, requiresHumanReview: classification.requiresHumanReview,
      ingestSource: `${platform}_webhook`, replyTarget: ev.replyTarget,
    });
    if ((workspace as any).socialComments.length > 10000) (workspace as any).socialComments.pop();
    (workspace as any).webhookEvents.unshift({ id: workspaceId("event"), platform, type: ev.kind, externalId: ev.externalId, receivedAt: new Date().toISOString() });
    accepted.push(ev.externalId);
  }
  (workspace as any).webhookEvents = (workspace as any).webhookEvents.slice(0, 10000);
  persistState();
  audit("system", `${platform}_inbound_events`, `${accepted.length}/${events.length}`);
  res.status(200).json({ success: true, accepted: true, processed: accepted.length, ignoredDuplicates: events.length - accepted.length });
});

// -------------------------------------------------------------
// Unified publishing pipeline (Batch 6) — مسار واحد للنشر المعتمد.
// Approved → Capability Check → Connector → Platform API → Real Response → Record.
// منصة لا تدعم نوع النشر تُردّ صراحةً بـ CAPABILITY_NOT_SUPPORTED، بلا فشل صامت.
// منصة تدعم النشر لكن بلا موصل منفّذ تُردّ بـ EXTERNAL_SETUP_REQUIRED.
// -------------------------------------------------------------
app.post("/api/platforms/:platform/publish", requireOwner, async (req, res) => {
  const platform = req.params.platform;
  const user = (req as any).user as { id: string };
  if (!isSupportedPlatform(platform)) return res.status(404).json({ success: false, error: "المنصة غير مدعومة." });
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  const approved = req.body?.approved === true;
  const chatId = typeof req.body?.chatId === "string" ? req.body.chatId.trim() : "";

  if (!content) return res.status(400).json({ success: false, error: "المحتوى مطلوب.", code: "CONTENT_REQUIRED" });
  if (!approved) return res.status(409).json({ success: false, error: "المحتوى لم تتم الموافقة عليه.", code: "APPROVAL_REQUIRED" });
  // القدرة تُقرأ من السجل: منصة لا تدعم النشر لا تُحاول إطلاقاً.
  if (!hasCapability(platform, "publish")) {
    return res.status(422).json({ success: false, error: "المنصة لا تدعم النشر عبر واجهتها الرسمية في هذا النظام.", code: "CAPABILITY_NOT_SUPPORTED", platform });
  }
  // محتوى خارجي يمر عبر حارس السلامة قبل أي إرسال.
  const safety = analyzeBusinessClaims(content, buildFactsForProduct(null, 0, 0));
  if (!safety.safe) {
    return res.status(422).json({ success: false, error: "المحتوى يحمل عرضاً تجارياً غير مسجّل، وتم إيقافه قبل الإرسال.", code: "CONTENT_SAFETY_BLOCKED", contentSafety: { violations: safety.blocked.map((v) => v.detail), codes: safety.blocked.map((v) => v.code) } });
  }
  const conn: any = platformConnections.get(platform);
  if (!conn || conn.status !== "connected" || conn.providerVerified !== true) {
    return res.status(409).json({ success: false, error: "المنصة غير متصلة باتصال موثق؛ لا نشر خارجي.", code: "NOT_CONNECTED" });
  }
  if (!hasRealConnector(platform)) {
    return res.status(501).json({ success: false, error: "لا يوجد موصل نشر منفّذ لهذه المنصة بعد.", code: "EXTERNAL_SETUP_REQUIRED", platform });
  }
  try {
    if (platform === "telegram") {
      const client = telegramClient();
      if (!client) return res.status(503).json({ success: false, error: "موصل Telegram غير مهيأ.", code: "CONNECTOR_NOT_READY" });
      const target = chatId || String(process.env.TELEGRAM_DEFAULT_CHAT_ID || "");
      if (!target) return res.status(503).json({ success: false, error: "Telegram يحتاج chatId أو TELEGRAM_DEFAULT_CHAT_ID.", code: "TARGET_REQUIRED" });
      const sent = await client.sendMessage({ chatId: target, text: content });
      const record = buildPublishRecord({ platform: platform as any, postId: typeof req.body?.postId === "string" ? req.body.postId : workspaceId("post"), providerPostId: sent.providerMessageId, simulated: false, error: sent.ok ? null : sent.error });
      if (!Array.isArray((workspace as any).publishRecords)) (workspace as any).publishRecords = [];
      (workspace as any).publishRecords.unshift({ ...record, id: workspaceId("publish"), createdBy: user.id, receipt: sent.receipt });
      persistState();
      audit(user.id, sent.ok ? "platform_publish_published" : "platform_publish_failed", `${platform}`);
      if (!sent.ok) return res.status(502).json({ success: false, record, error: sent.error, note: "لم يُسجَّل أي نشر بلا معرّف منشور حقيقي من المزود." });
      return res.json({ success: true, record, providerPostId: sent.providerMessageId, receipt: sent.receipt });
    }
    if (platform === "facebook") {
      // النشر على صفحة Facebook (Page Access Token). لا نشر بلا معرّف من Meta.
      const target = facebookReplyTarget();
      if ("error" in target) return res.status(503).json({ success: false, error: target.error, code: "CONNECTOR_NOT_READY" });
      const result = await facebookClient().publishToPage(target.pageId, target.pageToken, content);
      const receipt = result.ok ? { provider: "facebook", pageId: target.pageId, postId: result.data?.providerPostId, sentAt: new Date().toISOString() } : null;
      const record = buildPublishRecord({ platform: platform as any, postId: typeof req.body?.postId === "string" ? req.body.postId : workspaceId("post"), providerPostId: result.data?.providerPostId || null, simulated: false, error: result.ok ? null : result.error });
      if (!Array.isArray((workspace as any).publishRecords)) (workspace as any).publishRecords = [];
      (workspace as any).publishRecords.unshift({ ...record, id: workspaceId("publish"), createdBy: user.id, receipt });
      persistState();
      audit(user.id, result.ok ? "platform_publish_published" : "platform_publish_failed", `${platform}`);
      if (!result.ok) return res.status(502).json({ success: false, record, error: result.error, note: "لم يُسجَّل أي نشر بلا معرّف منشور حقيقي من المزود." });
      return res.json({ success: true, record, providerPostId: result.data?.providerPostId, receipt });
    }
    if (platform === "instagram") {
      // نشر Instagram عبر الخطوتين الرسميتين: إنشاء حاوية ثم نشرها.
      // Instagram لا ينشر نصاً فقط؛ يلزم رابط صورة/فيديو عام — نُعلن ذلك صراحةً.
      const target = instagramReplyTarget();
      if ("error" in target) return res.status(503).json({ success: false, error: target.error, code: "CONNECTOR_NOT_READY" });
      const imageUrl = typeof req.body?.imageUrl === "string" ? req.body.imageUrl.trim() : "";
      const videoUrl = typeof req.body?.videoUrl === "string" ? req.body.videoUrl.trim() : "";
      const reel = req.body?.reel === true;
      const container = await instagramClient().createMediaContainer(target.igAccountId, target.pageToken, { imageUrl, videoUrl, caption: content, reel });
      if (!container.ok || !container.data) {
        return res.status(422).json({ success: false, error: container.error, code: "MEDIA_REQUIRED", note: "Instagram لا ينشر نصاً فقط؛ زوّد imageUrl أو videoUrl عاماً." });
      }
      const published = await instagramClient().publishContainer(target.igAccountId, target.pageToken, container.data.containerId);
      const receipt = published.ok ? { provider: "instagram", igAccountId: target.igAccountId, containerId: container.data.containerId, postId: published.data?.providerPostId, mediaKind: container.data.mediaKind, sentAt: new Date().toISOString() } : null;
      const record = buildPublishRecord({ platform: platform as any, postId: typeof req.body?.postId === "string" ? req.body.postId : workspaceId("post"), providerPostId: published.data?.providerPostId || null, simulated: false, error: published.ok ? null : published.error });
      if (!Array.isArray((workspace as any).publishRecords)) (workspace as any).publishRecords = [];
      (workspace as any).publishRecords.unshift({ ...record, id: workspaceId("publish"), createdBy: user.id, receipt });
      persistState();
      audit(user.id, published.ok ? "platform_publish_published" : "platform_publish_failed", `${platform}`);
      if (!published.ok) return res.status(502).json({ success: false, record, error: published.error, containerId: container.data.containerId, note: "لم يُسجَّل أي نشر بلا معرّف منشور حقيقي من المزود." });
      return res.json({ success: true, record, providerPostId: published.data?.providerPostId, containerId: container.data.containerId, receipt });
    }
    if (platform === "tiktok") {
      // TikTok لا ينشر نصاً فقط: يلزم فيديو (أو صور) عبر رابط عام أو ملف.
      // لا يُسجَّل أي نشر بلا publish_id من TikTok.
      const mode: TikTokPostMode = req.body?.postMode === "DIRECT_POST" ? "DIRECT_POST" : "MEDIA_UPLOAD";
      const privacy: TikTokPrivacyLevel = (TIKTOK_PRIVACY_LEVELS as readonly string[]).includes(String(req.body?.privacyLevel)) ? (req.body.privacyLevel as TikTokPrivacyLevel) : "SELF_ONLY";
      const videoUrl = typeof req.body?.videoUrl === "string" ? req.body.videoUrl.trim() : "";
      const photoUrls = Array.isArray(req.body?.photoUrls) ? req.body.photoUrls.map((u: any) => String(u).trim()).filter(Boolean) : [];
      if (!videoUrl && !photoUrls.length) {
        return res.status(422).json({ success: false, error: "TikTok لا ينشر نصاً فقط؛ زوّد videoUrl أو photoUrls عامة.", code: "MEDIA_REQUIRED", note: "Content Posting API يلزمه فيديو أو صور عبر PULL_FROM_URL." });
      }
      // منع التكرار: بصمة (المحتوى + الوسائط + الوضع) تمنع إنشاء نفس النشر مرتين.
      const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ content, videoUrl, photoUrls, mode, privacy })).digest("hex");
      if (!Array.isArray((workspace as any).publishRecords)) (workspace as any).publishRecords = [];
      const dup = (workspace as any).publishRecords.find((r: any) => r.platform === "tiktok" && r.idempotencyKey === fingerprint && r.state !== "failed");
      if (dup) return res.status(409).json({ success: false, error: "نفس النشر مُهيّأ سابقاً (منع تكرار).", code: "DUPLICATE_PUBLISH", existing: { providerPublishId: dup.providerPublishId, state: dup.state } });
      // معلومات الناشر إلزامية قبل أي نشر مباشر (وثيقة TikTok).
      const creatorInfo = mode === "DIRECT_POST" ? await withTikTokToken((token) => tiktokClient().queryCreatorInfo(token)) : { ok: true as const, data: null };
      if (mode === "DIRECT_POST" && (!creatorInfo.ok || !creatorInfo.data)) {
        return res.status(502).json({ success: false, error: (creatorInfo as any).error || "تعذّر قراءة معلومات الناشر قبل النشر المباشر.", code: "CREATOR_INFO_FAILED" });
      }
      const initResult = await withTikTokToken((token) => videoUrl
        ? tiktokClient().initVideoPost(token, buildVideoPostBody({ postMode: mode, title: content, privacyLevel: privacy, source: "PULL_FROM_URL", videoUrl }))
        : tiktokClient().initPhotoPost(token, buildPhotoPostBody({ postMode: mode, title: content, privacyLevel: privacy, photoUrls })));
      if (!initResult.ok || !initResult.data) {
        const record = buildPublishRecord({ platform: platform as any, postId: typeof req.body?.postId === "string" ? req.body.postId : workspaceId("post"), providerPostId: null, simulated: false, error: initResult.error });
        (workspace as any).publishRecords.unshift({ ...record, id: workspaceId("publish"), createdBy: user.id, idempotencyKey: fingerprint, postMode: mode, receipt: null });
        persistState();
        audit(user.id, "platform_publish_failed", "tiktok");
        return res.status(502).json({ success: false, record, error: initResult.error, code: initResult.code || "PROVIDER_ERROR", note: "لم يُسجَّل أي نشر بلا معرّف نشر من TikTok." });
      }
      // التهيئة نجحت: يُحفظ publish_id ويبقى التسليم معلّقاً حتى PUBLISH_COMPLETE.
      const publishId = initResult.data.publishId;
      const record = buildPublishRecord({ platform: platform as any, postId: typeof req.body?.postId === "string" ? req.body.postId : workspaceId("post"), providerPostId: null, simulated: false, error: null });
      (workspace as any).publishRecords.unshift({
        ...record,
        // الحالة الحقيقية الآن: تهيئة تمت لكن التسليم لم يُثبت بعد.
        state: "publishing",
        id: workspaceId("publish"), createdBy: user.id, idempotencyKey: fingerprint, postMode: mode, privacyLevel: privacy,
        providerPublishId: publishId, uploadUrl: (initResult.data as any).uploadUrl || null,
        auditRequired: tiktokAuditRequired(),
        receipt: { provider: "tiktok", publishId, postMode: mode, createdAt: new Date().toISOString() },
      });
      persistState();
      audit(user.id, "platform_publish_initiated", `tiktok:${mode}`);
      return res.json({
        success: true, record, providerPublishId: publishId, postMode: mode,
        delivered: false,
        auditRequired: tiktokAuditRequired(),
        note: "تمت تهيئة النشر لدى TikTok (publish_id). لا يُعلن التسليم إلا بحالة PUBLISH_COMPLETE عبر GET /api/platforms/tiktok/publish-status.",
      });
    }
    return res.status(501).json({ success: false, error: "الموصل متصل لكن تنفيذ النشر لهذه المنصة يحتاج بيانات المزود ولم يُختلق تنفيذ وهمي.", code: "EXTERNAL_SETUP_REQUIRED", platform });
  } catch (e: any) {
    return res.status(502).json({ success: false, error: String(e?.message || e).slice(0, 300), code: "PROVIDER_ERROR" });
  }
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

// -------------------------------------------------------------
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
  if((workspace as any).socialReplies.length>5000) (workspace as any).socialReplies.pop();
  audit(user.id, result.ok?"social_telegram_reply_sent":"social_telegram_reply_failed", `${externalId}:${result.ok?"delivered":"failed"}`);
  persistState();
  if(!result.ok) return res.status(502).json({success:false,delivered:false,simulated:false,reply:record,error:record.deliveryError});
  res.json({success:true,delivered:true,simulated:false,providerReplyId:result.providerMessageId,reply:record});
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
      const r=await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",{headers:{Authorization:`Bearer ${token.access_token}`}}); const d=await r.json();
      return res.status(r.ok&&Array.isArray(d.items)?200:502).json({success:r.ok&&Array.isArray(d.items),platform,healthy:r.ok&&Array.isArray(d.items),provider:"youtube",accountId:d.items?.[0]?.id||c.accountId,accountName:d.items?.[0]?.snippet?.title||c.accountName,checkedAt:new Date().toISOString()});
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
  const resolvedScopes = platform==="facebook" ? facebookOAuthScopes() : platform==="instagram" ? instagramOAuthScopes() : platform==="tiktok" ? tiktokOAuthScopes() : cfg.scopes;
  const scopeDependencyGaps = platform==="facebook" ? facebookScopeDependencyGaps() : platform==="instagram" ? instagramScopeDependencyGaps() : [];
  const metaScopesResolved = platform==="facebook"||platform==="instagram";
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
      requestedScopes:tiktokOAuthScopes(),
      scopeOverrideConfigured:tiktokScopeOverride().length>0,
      pkceRequired:true,
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
        "في Scopes فعّل: user.info.basic, video.publish, video.list.",
        "لتفعيل webhooks: أضف Webhook Callback URL (webhookUrl) في إعدادات التطبيق.",
        "لرفع قيد النشر العام (SELF_ONLY) يجب اجتياز Content Posting audit لدى TikTok.",
      ],
      note:"مسار TikTok الرسمي: /v2/auth/authorize/ (client_key) + PKCE، والرمز على /v2/oauth/token/ بصيغة x-www-form-urlencoded. النشر عبر Content Posting API، والبيانات عبر Display API. التعليقات والرسائل المباشرة غير متاحة عبر الواجهة العامة.",
      doc:"https://developers.tiktok.com/doc/login-kit-web",
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
    loginConfigIdUsed:metaScopesResolved?Boolean(loginConfigIdFor(platform)):undefined,
    permissionSource:metaScopesResolved?(loginConfigIdFor(platform)?"facebook_login_for_business_configuration":"oauth_scope_parameter"):undefined,
    // التدفّق الرسمي لـInstagram: display=page + extras=IG_API_ONBOARDING +
    // response_type=token، والرمز يعود في مقطع الاستجابة (لا code). يُعلن هنا
    // ليعرف المالك أن الرابط مطابق لوثيقة Meta حرفياً.
    instagramOnboardingFlow:platform==="instagram"?{
      // active يتبع مفتاح البيئة فعلياً: false يعني أن الرابط يسلك التدفّق العادي
      // (response_type=code) بلا extras، فلا تُعلن معاملات لا تُرسَل.
      active:instagramOnboardingEnabled(),
      display:instagramOnboardingEnabled()?"page":null,
      extras:INSTAGRAM_ONBOARDING_EXTRAS,
      responseType:"token",
      tokenDelivery:"url_fragment",
      // الوثيقة الرسمية تشترط ستة معاملات ولا تذكر config_id إطلاقاً: مسار
      // Instagram يمرّر الصلاحيات عبر scope على واجهة Business Login.
      configIdRequired:false,
      envSwitch:"INSTAGRAM_OAUTH_ONBOARDING",
      envSwitchValue:instagramOnboardingEnabled()?"enabled":"disabled",
      note:"وفق وثيقة Meta «Facebook Login for Business - Instagram API»: الرابط الرسمي يحمل client_id+display=page+extras+redirect_uri+response_type=token+scope فقط، بلا config_id. تُلحق Meta الرمز (القصير وطويل الأجل) في مقطع الاستجابة، وتقرأه الواجهة وترسله POST في الجسم لإتمام الربط بلا تبديل رمز.",
      doc:"https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram",
      requiredProducts:["Instagram → API setup with Facebook login","Facebook Login for Business","Webhooks"],
      appType:"Meta Business type app",
      knownIssue:"عطل معروف لدى Meta في تدفّق الإعداد: يظهر «حدث خطأ ما» بعد تسجيل الدخول (GraphQL error 1850019 «error during business onboarding flow») ويرتبط بمعامل extras=IG_API_ONBOARDING. المخرج الموثّق من مطوّرين: إزالة extras والعمل بالتدفّق العادي عبر /me/accounts?fields=instagram_business_account. لا تُنفَّذ الإزالة إلا بقرار صريح لأنها تُلغي نافذة الإعداد الموحّدة.",
    }:undefined,
    loginForBusinessSetup:platform==="facebook"?{
      where:"Meta App Dashboard → Facebook Login for Business → Configurations",
      steps:[
        "افتح Facebook Login for Business → Configurations واضغط Create configuration (أو أعد استخدام Configuration موجودة).",
        "اختر نوع الرمز: User access token (المطلوب لمسارات الصفحة).",
        "أضف الصلاحيات المذكورة في حقل scopes أعلاه بالضبط (نفس أسماء Facebook Login).",
        "احفظ، ثم انسخ Configuration ID (أرقام فقط) إلى FACEBOOK_LOGIN_CONFIG_ID.",
        "لا تضع القيمة في Git ولا في أي سجل؛ الخادم يقرأها من البيئة فقط.",
      ],
      note:"عند وجود Configuration ID صالح يمرّره الخادم كـconfig_id بدل scope، فلا يتعارض المعاملان. مسار Instagram لا يستخدم config_id.",
    }:undefined,
    genericErrorMeaning:(platform==="facebook"||platform==="instagram")?{
      message:"صفحة Meta «حدث خطأ ما» (Sorry, something went wrong) لها مواضع محتملة: (1) قبل تسجيل الدخول: معرّف تطبيق غير مطابق أو نطاق/رابط إرجاع غير مسجّل، (2) بعد تسجيل الدخول: الصلاحيات غير مفعّلة كاملةً في Use Case أو الحساب ليس ضمن Testers، (3) عطل معروف في تدفّق الإعداد عند استخدام extras=IG_API_ONBOARDING (1850019). حقل dialogPhase يحدد الموضع: rejected_before_login مقابل awaiting_owner_login (أي أن الفحص بلا كوكيز توقّف عند شاشة الدخول ولم يرَ مرحلة ما بعدها).",
      checks:["طابق App ID مع Settings → Basic (أرقام فقط بلا مسافات).","أضف appDomainsValue إلى App Domains بلا https وبلا مسار.","أضف redirectUri بالضبط إلى Valid OAuth Redirect URIs.","فعّل الصلاحيات المطلوبة داخل Use Case — لا يكفي وجودها في الرابط.","تأكد أن التطبيق يحتوي منتج Instagram → API setup with Facebook login وأن التطبيق من نوع Business.","أضف حساب المالك إلى Roles → Testers إن كان التطبيق في وضع Development.","راجع المتغير FACEBOOK_OAUTH_SCOPES/INSTAGRAM_OAUTH_SCOPES إن وُجد: أي اسم صلاحية غير قائم يُرفض قبل الدخول."],
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
const safeJobWorkerTimer = setInterval(runSafeJobPreflight, 60 * 1000);
(safeJobWorkerTimer as any).unref?.();

app.post("/api/control/jobs/:id/execute", requireOwner, async (req,res)=>{
  const job=automationJobs.find((j:any)=>j.id===req.params.id); if(!job) return res.status(404).json({success:false,error:"المهمة غير موجودة."});
  if(job.status!=="ready") return res.status(409).json({success:false,error:"المهمة ليست جاهزة للتنفيذ."});
  const platform=String(job.payload?.platform||""); const content=String(job.payload?.content||"").trim(); const conn:any=platformConnections.get(platform);
  if(!conn || conn.status!=="connected" || conn.providerVerified!==true) return res.status(409).json({success:false,error:"المنصة غير موثقة باتصال حقيقي."});
  try {
    if(platform==="telegram") {
      const client=telegramClient(); if(!client) return res.status(503).json({success:false,error:"موصل Telegram غير مهيأ (رمز بوت غير متوفر)."});
      const chatId=String(process.env.TELEGRAM_DEFAULT_CHAT_ID||job.payload?.chatId||""); if(!chatId) return res.status(503).json({success:false,error:"Telegram يحتاج TELEGRAM_DEFAULT_CHAT_ID أو chatId في المهمة."});
      // إرسال حقيقي عبر نفس عميل الموصل (مصدر واحد)؛ لا نشر بلا استجابة مزود.
      const sent=await client.sendMessage({chatId,text:content});
      if(!sent.ok) throw new Error(sent.error||"فشل إرسال Telegram");
      job.status="executed"; job.executedAt=new Date().toISOString(); job.providerVerified=true; job.providerReceipt={provider:"telegram",messageId:sent.providerMessageId,executedAt:new Date().toISOString()}; persistState(); audit((req as any).user.id,"job_executed",`${job.id}:telegram`); return res.json({success:true,job,receipt:job.providerReceipt});
    }
    return res.status(501).json({success:false,error:"الموصل متصل ومتحقق، لكن تنفيذ هذا النوع من النشر يحتاج بيانات الوسائط/العملية الخاصة بالمزود ولم يتم اختلاق تنفيذ وهمي."});
  } catch(e:any) { job.status="failed"; job.lastError=String(e?.message||e).slice(0,500); persistState(); audit((req as any).user.id,"job_execution_failed",`${job.id}:${platform}`); return res.status(502).json({success:false,error:job.lastError,job}); }
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

app.get("/api/workspace/snapshot", authenticateToken, (_req, res) => {
  const connected = connectedPlatformIds();
  res.json({
    success: true,
    snapshot: {
      showroom: workspace.showroom,
      products: workspace.products,
      installmentPlans: workspace.installmentPlans,
      posts: workspace.posts,
      conversations: workspace.conversations,
      platforms: SUPPORTED_PLATFORMS.map((p: any) => ({ ...p, connection: platformConnections.get(p.id) })),
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
  const product = {
    id: cleanText(b.id, 100) || workspaceId("prod"), name, category: ["appliances","phones","construction","electronics","other"].includes(b.category) ? b.category : "other",
    modelYear: cleanText(b.modelYear, 20), cashPrice, installmentFrom: Number.isFinite(Number(b.installmentFrom)) ? Math.max(0, Number(b.installmentFrom)) : cashPrice,
    downPaymentPercent: Number.isFinite(Number(b.downPaymentPercent)) ? Math.max(0, Math.min(100, Number(b.downPaymentPercent))) : 0,
    durationMonths: Number.isInteger(Number(b.durationMonths)) ? Math.max(1, Math.min(60, Number(b.durationMonths))) : 1,
    image: cleanText(b.image, 500), inStock: b.inStock !== false, stockQuantity: Number.isFinite(Number(b.stockQuantity)) ? Math.max(0, Math.floor(Number(b.stockQuantity))) : 0, reorderLevel: Number.isFinite(Number(b.reorderLevel)) ? Math.max(0, Math.floor(Number(b.reorderLevel))) : 0, featured: b.featured === true,
    specs: Array.isArray(b.specs) ? b.specs.filter((x: any) => typeof x === "string").slice(0, 30).map((x: string) => x.trim().slice(0, 200)) : [],
    installmentOptions: Array.isArray(b.installmentOptions) ? b.installmentOptions.filter((x: any) => typeof x === "string").slice(0, 20).map((x: string) => x.trim().slice(0, 200)) : []
  };
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
  const content = cleanText(b.content, 10000); const targets = Array.isArray(b.targetPlatforms) ? [...new Set(b.targetPlatforms.filter((x: any) => SUPPORTED_PLATFORMS.some((p: any) => p.id === x)))].slice(0,10) : [];
  if (!content || !targets.length) return res.status(400).json({ success: false, error: "المحتوى ومنصة واحدة على الأقل مطلوبان." });
  if (/125\s*\/\s*125/i.test(content) || /سيارة|سيارات|\bcars?\b/i.test(content)) return res.status(422).json({ success: false, error: "المحتوى خالف قواعد مشروع الغرابي: لا عدادات قديمة ولا محتوى سيارات." });
  const post = { id: cleanText(b.id, 100) || workspaceId("post"), title: cleanText(b.title, 160) || "مسودة جديدة", content, platformVersions: b.platformVersions && typeof b.platformVersions === "object" ? b.platformVersions : undefined, targetPlatforms: targets, mediaUrl: cleanText(b.mediaUrl, 500) || undefined, mediaType: ["image","video","carousel"].includes(b.mediaType) ? b.mediaType : undefined, status: ["draft","review","edited","approved","scheduled","published"].includes(b.status) ? b.status : "draft", scheduledFor: normalizeScheduleInput(b.scheduledFor) ?? undefined, publishedAt: cleanText(b.publishedAt, 80) || undefined, createdAt: cleanText(b.createdAt, 80) || new Date().toISOString(), authorId: user.id, authorName: cleanText(b.authorName, 160) || user.name, authorRole: cleanText(b.authorRole, 40) || user.role, history: Array.isArray(b.history) ? b.history.slice(-50) : [], metrics: b.metrics && typeof b.metrics === "object" ? b.metrics : undefined, tags: Array.isArray(b.tags) ? b.tags.filter((x:any)=>typeof x === "string").slice(0,20) : [], campaignName: cleanText(b.campaignName, 160) };
  workspace.posts.unshift(post); persistState(); audit(user.id, "workspace_content_created", post.id); res.status(201).json({ success: true, post });
});

app.patch("/api/workspace/content/:id", authenticateToken, (req,res)=>{
  const user=(req as any).user as ServerUser; const post=workspace.posts.find((p:any)=>p.id===req.params.id);
  if(!post) return res.status(404).json({success:false,error:"المنشور غير موجود."});
  if (!["owner","manager","staff","content_creator"].includes(user.role)) return res.status(403).json({success:false,error:"لا تملك صلاحية تعديل المحتوى."});
  const b=req.body||{};
  if(b.title!==undefined) post.title=cleanText(b.title,160)||post.title;
  if(b.content!==undefined){ const c=cleanText(b.content,10000); if(!c) return res.status(400).json({success:false,error:"المحتوى لا يمكن أن يكون فارغاً."}); if(/125\s*\/\s*125/i.test(c)||/سيارة|سيارات|\bcars?\b/i.test(c)) return res.status(422).json({success:false,error:"المحتوى خالف قواعد مشروع الغرابي."}); post.content=c; }
  if(Array.isArray(b.targetPlatforms)) post.targetPlatforms=[...new Set(b.targetPlatforms.filter((x:any)=>SUPPORTED_PLATFORMS.some((p:any)=>p.id===x)))].slice(0,10);
  if (b.status === "published") return res.status(409).json({ success:false, error:"لا يمكن تسجيل المنشور كمُنشر دون إيصال تنفيذ خارجي موثّق من مزود المنصة." });
  if(["draft","review","edited","approved","scheduled"].includes(b.status)) post.status=b.status;
  if(b.scheduledFor!==undefined){ const norm=normalizeScheduleInput(b.scheduledFor); post.scheduledFor=norm ?? undefined; }
  if(b.campaignName!==undefined) post.campaignName=cleanText(b.campaignName,160);
  persistState(); audit(user.id,"workspace_content_updated",post.id); res.json({success:true,post});
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
app.get("/api/customers/360", authenticateToken, (req,res)=>{ const q=normalizeSearch(req.query.q); const map=new Map<string,any>(); const key=(n:any,p:any)=>String(p||n||"unknown").trim().toLowerCase(); const make=(n:any,p:any)=>({id:`cust-${Buffer.from(key(n,p)).toString("hex").slice(0,18)}`,name:n||"عميل",phone:p||"",leads:0,sales:0,paid:0,balance:0,conversations:0}); for(const l of workspace.leads){const k=key(l.customerName,l.phone),c=map.get(k)||make(l.customerName,l.phone);c.leads++;map.set(k,c)} for(const s of workspace.sales){const k=key(s.customerName,s.phone),c=map.get(k)||make(s.customerName,s.phone);c.sales++;c.paid+=salePaid(s.id);c.balance+=saleBalance(s);map.set(k,c)} for(const v of workspace.conversations){const k=key(v.customerName,v.phone),c=map.get(k)||make(v.customerName,v.phone);c.conversations++;map.set(k,c)} let customers=Array.from(map.values()); if(q) customers=customers.filter((c:any)=>containsQuery(c.name,q)||containsQuery(c.phone,q)); customers.sort((a:any,b:any)=>(b.sales-a.sales)||(b.conversations-a.conversations)); res.json({success:true,customers:customers.slice(0,100),count:customers.length}); });
app.get("/api/reports/operations", authenticateToken, (req,res)=>{ const days=Math.min(90,Math.max(1,Number(req.query.days||30))); const since=Date.now()-days*86400000; const sales=workspace.sales.filter((x:any)=>Date.parse(x.createdAt||"")>=since), payments=workspace.payments.filter((x:any)=>Date.parse(x.createdAt||"")>=since), daily=new Map<string,any>(); for(const s of sales){const d=String(s.createdAt).slice(0,10),r=daily.get(d)||{date:d,sales:0,salesValue:0,collected:0};r.sales++;r.salesValue+=Number(s.totalAmount||0);daily.set(d,r)} for(const p of payments){const d=String(p.createdAt).slice(0,10),r=daily.get(d)||{date:d,sales:0,salesValue:0,collected:0};r.collected+=Number(p.amount||0);daily.set(d,r)} const inv=workspace.products.map(inventoryProductView); res.json({success:true,periodDays:days,metrics:{salesCount:sales.length,salesValue:sales.reduce((n:number,x:any)=>n+Number(x.totalAmount||0),0),collected:payments.reduce((n:number,x:any)=>n+Number(x.amount||0),0),openLeads:workspace.leads.filter((x:any)=>!['won','lost'].includes(x.status)).length,openTasks:workspace.tasks.filter((x:any)=>['open','in_progress'].includes(x.status)).length,lowStock:inv.filter((x:any)=>x.stockStatus!=="ok").length,openConversations:workspace.conversations.filter((x:any)=>x.status!=="resolved").length},daily:Array.from(daily.values()).sort((a:any,b:any)=>a.date.localeCompare(b.date))}); });

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
app.get("/api/sales/:id/payments", authenticateToken, (req,res)=>{ const sale=workspace.sales.find((x:any)=>x.id===req.params.id); if(!sale) return res.status(404).json({success:false,error:"عملية البيع غير موجودة."}); res.json({success:true,payments:workspace.payments.filter((p:any)=>p.saleId===sale.id)}); });

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

app.get("/api/business/overview", authenticateToken, (_req,res)=>{
  const now=Date.now();
  const purchases=workspace.purchases as any[], expenses=workspace.expenses as any[], schedules=workspace.installmentSchedules as any[];
  const due=schedules.filter(x=>x.status!=="paid"&&Date.parse(x.dueAt)<now);
  const purchaseTotal=purchases.reduce((n:number,x:any)=>n+safeMoney(x.total),0);
  const expenseTotal=expenses.reduce((n:number,x:any)=>n+safeMoney(x.amount),0);
  res.json({success:true,metrics:{suppliers:workspace.suppliers.length,purchases:purchases.length,purchaseTotal,expenses:expenses.length,expenseTotal,contracts:workspace.contracts.length,installments:schedules.length,overdueInstallments:due.length,overdueValue:due.reduce((n:number,x:any)=>n+Math.max(0,safeMoney(x.amount)-safeMoney(x.paid)),0)}});
});

app.get("/api/suppliers", authenticateToken, (_req,res)=>res.json({success:true,suppliers:workspace.suppliers.slice(0,1000)}));
app.post("/api/suppliers", authenticateToken, (req,res)=>{ const u=(req as any).user as ServerUser; const name=cleanText(req.body?.name,160); if(!name)return res.status(400).json({success:false,error:"اسم المورد مطلوب."}); const item={id:workspaceId("sup"),name,phone:cleanText(req.body?.phone,40),address:cleanText(req.body?.address,240),notes:cleanText(req.body?.notes,500),createdAt:new Date().toISOString(),createdBy:u.id}; workspace.suppliers.unshift(item); persistState(); audit(u.id,"supplier_created",item.id); res.status(201).json({success:true,supplier:item}); });
app.patch("/api/suppliers/:id", authenticateToken, (req,res)=>{ const u=(req as any).user as ServerUser; const item=workspace.suppliers.find((x:any)=>x.id===req.params.id); if(!item)return res.status(404).json({success:false,error:"المورد غير موجود."}); for(const k of ["name","phone","address","notes"]) if(req.body?.[k]!==undefined)item[k]=cleanText(req.body[k],k==="notes"?500:k==="address"?240:k==="name"?160:40); if(!item.name)return res.status(400).json({success:false,error:"اسم المورد مطلوب."}); item.updatedAt=new Date().toISOString(); persistState(); audit(u.id,"supplier_updated",item.id); res.json({success:true,supplier:item}); });
app.delete("/api/suppliers/:id", requireOwner, (req,res)=>{ const i=workspace.suppliers.findIndex((x:any)=>x.id===req.params.id); if(i<0)return res.status(404).json({success:false,error:"المورد غير موجود."}); workspace.suppliers.splice(i,1); persistState(); audit((req as any).user.id,"supplier_deleted",req.params.id); res.json({success:true}); });

app.get("/api/purchases", authenticateToken, (_req,res)=>res.json({success:true,purchases:workspace.purchases.slice(0,1000)}));
app.post("/api/purchases", authenticateToken, (req,res)=>{ const u=(req as any).user as ServerUser; const supplierId=cleanText(req.body?.supplierId,100); const items=Array.isArray(req.body?.items)?req.body.items.slice(0,100):[]; if(!supplierId||!workspace.suppliers.some((x:any)=>x.id===supplierId)||!items.length)return res.status(400).json({success:false,error:"المورد وبنود الشراء مطلوبان."}); const normalized=items.map((x:any)=>({productId:cleanText(x.productId,100),productName:cleanText(x.productName,160),quantity:Math.max(1,Math.floor(Number(x.quantity)||0)),unitCost:safeMoney(x.unitCost)})).filter((x:any)=>x.productName&&x.quantity>0); if(!normalized.length)return res.status(400).json({success:false,error:"بنود الشراء غير صالحة."}); const total=normalized.reduce((n:number,x:any)=>n+x.quantity*x.unitCost,0); const item={id:workspaceId("purchase"),supplierId,items:normalized,total,status:"received",notes:cleanText(req.body?.notes,500),createdAt:new Date().toISOString(),createdBy:u.id}; workspace.purchases.unshift(item); for(const line of normalized){ const product=workspace.products.find((p:any)=>p.id===line.productId); if(product){ const before=Math.max(0,Math.floor(Number(product.stockQuantity||0))); const after=before+line.quantity; product.stockQuantity=after; product.inStock=after>0; workspace.inventoryMovements.unshift({id:workspaceId("stock"),productId:product.id,productName:product.name,delta:line.quantity,before,after,reason:`استلام شراء ${item.id}`,createdBy:u.id,createdAt:new Date().toISOString()}); } } persistState(); audit(u.id,"purchase_created",item.id); res.status(201).json({success:true,purchase:item}); });

app.get("/api/expenses", authenticateToken, (req,res)=>{ const cat=cleanText(req.query?.category,60); let rows=workspace.expenses.slice(); if(cat)rows=rows.filter((x:any)=>x.category===cat); res.json({success:true,expenses:rows.slice(0,2000),categories:VALID_EXPENSE_CATEGORIES}); });
app.post("/api/expenses", authenticateToken, (req,res)=>{ const u=(req as any).user as ServerUser; const amount=safeMoney(req.body?.amount),category=cleanText(req.body?.category,60),description=cleanText(req.body?.description,240); if(!amount||!VALID_EXPENSE_CATEGORIES.includes(category)||!description)return res.status(400).json({success:false,error:"المبلغ والتصنيف والوصف مطلوبة."}); const item={id:workspaceId("expense"),amount,category,description,paymentMethod:cleanText(req.body?.paymentMethod,40)||"cash",createdAt:new Date().toISOString(),createdBy:u.id}; workspace.expenses.unshift(item); persistState(); audit(u.id,"expense_created",item.id); res.status(201).json({success:true,expense:item}); });
app.delete("/api/expenses/:id", requireOwner, (req,res)=>{ const i=workspace.expenses.findIndex((x:any)=>x.id===req.params.id); if(i<0)return res.status(404).json({success:false,error:"المصروف غير موجود."}); workspace.expenses.splice(i,1); persistState(); audit((req as any).user.id,"expense_deleted",req.params.id); res.json({success:true}); });

app.get("/api/contracts", authenticateToken, (_req,res)=>res.json({success:true,contracts:workspace.contracts.slice(0,1000)}));
app.post("/api/contracts", authenticateToken, (req,res)=>{ const u=(req as any).user as ServerUser; const customerName=cleanText(req.body?.customerName,160),phone=cleanText(req.body?.phone,40),saleId=cleanText(req.body?.saleId,100); if(!customerName||!saleId)return res.status(400).json({success:false,error:"اسم العميل ورقم عملية البيع مطلوبان."}); const sale=workspace.sales.find((x:any)=>x.id===saleId); if(!sale)return res.status(404).json({success:false,error:"عملية البيع غير موجودة."}); const existing=workspace.contracts.find((x:any)=>x.saleId===saleId&&x.status!=="cancelled"); if(existing)return res.status(409).json({success:false,error:"يوجد عقد قائم لهذه العملية."}); const item={id:workspaceId("contract"),contractNumber:`GH-${new Date().getFullYear()}-${String(Date.now()).slice(-7)}`,saleId,customerName,phone,status:"draft",signedAt:null,createdAt:new Date().toISOString(),createdBy:u.id}; workspace.contracts.unshift(item); persistState(); audit(u.id,"contract_created",item.id); res.status(201).json({success:true,contract:item}); });
app.post("/api/contracts/:id/sign", authenticateToken, (req,res)=>{ const u=(req as any).user as ServerUser; const item=workspace.contracts.find((x:any)=>x.id===req.params.id); if(!item)return res.status(404).json({success:false,error:"العقد غير موجود."}); if(item.status!=="draft")return res.status(409).json({success:false,error:"حالة العقد لا تسمح بالتوقيع."}); item.status="signed"; item.signedAt=new Date().toISOString(); item.signatureReference=cleanText(req.body?.signatureReference,160)||`local-sign-${crypto.randomBytes(8).toString("hex")}`; persistState(); audit(u.id,"contract_signed",item.id); res.json({success:true,contract:item}); });

app.get("/api/installments/schedule", authenticateToken, (req,res)=>{ const saleId=cleanText(req.query?.saleId,100); let rows=workspace.installmentSchedules.slice(); if(saleId)rows=rows.filter((x:any)=>x.saleId===saleId); rows.sort((a:any,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt)); res.json({success:true,schedules:rows.slice(0,5000)}); });
app.post("/api/installments/generate", authenticateToken, (req,res)=>{ const u=(req as any).user as ServerUser; const saleId=cleanText(req.body?.saleId,100); const sale=workspace.sales.find((x:any)=>x.id===saleId); if(!sale)return res.status(404).json({success:false,error:"عملية البيع غير موجودة."}); workspace.installmentSchedules=workspace.installmentSchedules.filter((x:any)=>x.saleId!==saleId); const rows=buildInstallmentSchedule(sale); workspace.installmentSchedules.push(...rows); persistState(); audit(u.id,"installment_schedule_generated",saleId); res.status(201).json({success:true,schedules:rows}); });
app.get("/api/installments/due", authenticateToken, (req,res)=>{ const days=Math.min(30,Math.max(0,Number(req.query?.days||7))); const end=Date.now()+days*86400000; const rows=workspace.installmentSchedules.filter((x:any)=>x.status!=="paid"&&Date.parse(x.dueAt)<=end).sort((a:any,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt)); res.json({success:true,schedules:rows.slice(0,2000)}); });

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
  res.json({ success:true, generatedAt:new Date().toISOString(), version:PROJECT_VERSION, schemaVersion:STATE_SCHEMA_VERSION, node:process.version, uptimeSeconds:Math.round(process.uptime()), memory:{ rss:memory.rss, heapUsed:memory.heapUsed, heapTotal:memory.heapTotal }, sessions:activeSessions.size, users:serverUsers.length, platforms:{ total:SUPPORTED_PLATFORMS.length, connected:connectedPlatformIds().length }, workspace:{ products:workspace.products.length, posts:workspace.posts.length, conversations:workspace.conversations.length, plans:workspace.installmentPlans.length, leads:workspace.leads.length, tasks:workspace.tasks.length, sales:workspace.sales.length, payments:workspace.payments.length, suppliers:workspace.suppliers.length, purchases:workspace.purchases.length, expenses:workspace.expenses.length, contracts:workspace.contracts.length, installmentSchedules:workspace.installmentSchedules.length }, jobs:{ total:automationJobs.length, queued, approved, ready, failed }, backups:{ count: (()=>{ try{return fs.readdirSync(BACKUP_DIR).filter(n=>n.startsWith("state-")&&n.endsWith(".json")).length;}catch{return 0;} })() } });
});


app.get("/api/executive/overview", authenticateToken, (_req,res)=>{
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
const GEMINI_DAILY_LIMIT = Math.min(6, Math.max(1, Number(process.env.GEMINI_DAILY_LIMIT || 4)));
let geminiUsageDay = new Date().toISOString().slice(0, 10);
let geminiUsageCount = 0;
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
  if (!item || now - item.startedAt >= 15 * 60 * 1000) { challengeWindow.set(key, { startedAt: now, count: 1 }); return true; }
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
      const control = await storageAdapter.read<any>(STORAGE_KEY_CONTROL);
      if (control) applyControlSnapshot(control);
    } catch (error: any) {
      storageInitError = String(error?.code || error?.name || "state_read_failed").slice(0, 60);
      return;
    }
  } else {
    // للملف المحلي: القراءة متزامنة عند الإقلاع كما في لقطة الحالة.
    loadControlStateSync();
  }
  // الجهوزية تُعلن قبل مزامنة البصمة كي تُحفظ حالة التحكّم فعلاً عند أول إقلاع.
  storageReady = true;
  reconcilePreviewTokenEpoch();
}

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
function cleanupRuntimeState() {
  const now = Date.now();
  for (const [sid, exp] of revokedSessions) if (exp < now) revokedSessions.delete(sid);
  for (const [email, exp] of consumedChallenges) if (exp < now) consumedChallenges.delete(email);
  for (const [token, session] of activeSessions) if (session.expiresAt < now) activeSessions.delete(token);
  for (const [userId, window] of requestWindow) if (now - window.startedAt >= 60_000) requestWindow.delete(userId);
  for (const [key, window] of challengeWindow) if (now - window.startedAt >= 15 * 60 * 1000) challengeWindow.delete(key);
  for (const [key, window] of authAttemptWindow) if (now - window.startedAt >= 15 * 60 * 1000) authAttemptWindow.delete(key);
  aiEngine.pruneCache();
}
const runtimeCleanupTimer = setInterval(cleanupRuntimeState, 5 * 60 * 1000);
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
      // معرّفات تحديثات Telegram لصمود منع التكرار بعد restart (يمنع إعادة معالجة رسالة).
      telegramUpdateIds: ((workspace as any).telegramUpdateIds || []).slice(0, 20000),
      // معرّفات أحداث Facebook الواردة لصمود منع التكرار بعد restart.
      facebookEventIds: ((workspace as any).facebookEventIds || []).slice(0, 20000),
      instagramEventIds: ((workspace as any).instagramEventIds || []).slice(0, 20000),
      tiktokEventIds: ((workspace as any).tiktokEventIds || []).slice(0, 20000),
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
    saveUsage();
  }
}

function canUseGemini(): boolean {
  rollUsageDayIfNeeded();
  return geminiUsageCount < GEMINI_DAILY_LIMIT;
}

/** الحارس المحلي الذي يستهلكه محرك الذكاء الاصطناعي. */
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
  state: 'not_attempted' | 'ok' | 'failed' | 'skipped_no_key';
  detail: string | null;
  model: string | null;
  at: string | null;
  /** فئة الخطأ الحقيقية عند الفشل، لتمييز عطل المزود عن خطأ المفتاح. */
  errorKind: string | null;
  /** توجيه تشخيصي أمين يطابق الفئة الفعلية — بلا أي سر. */
  hint: string | null;
} = { state: 'not_attempted', detail: null, model: null, at: null, errorKind: null, hint: null };

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
    // سياسة الموديل كاملة: موديل الإنتاج، المرشحون، وموديل البيئة المرفوض إن وُجد.
    modelPolicy: describeModelPolicy(process.env.GEMINI_MODEL),
    modelCandidates: resolveModelCandidates(process.env.GEMINI_MODEL),
    breaker: aiEngineBreakerSnapshot(),
    cachedEntries: aiEngine.cacheSize,
    timeoutMs: AI_TIMEOUT_MS,
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
  // الجاهزية التطبيقية منفصلة تماماً عن جاهزية مزود الذكاء الاصطناعي:
  // التطبيق جاهز للعمل حتى لو لم يُضبط المفتاح، لأن البديل الحتمي متاح دائماً.
  res.json({
    success: true,
    ready: STATE_WRITABLE(),
    version: PROJECT_VERSION,
    statePersistence: STATE_WRITABLE(),
    applicationReady: STATE_WRITABLE(),
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
    },
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
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
        loginConfigIdUsed: Boolean(loginConfigIdFor("instagram")),
        loginConfigEnvNames: loginConfigEnvNames("instagram"),
        permissionSource: loginConfigIdFor("instagram") ? "facebook_login_for_business_configuration" : "oauth_scope_parameter",
        subscribedWebhookFields: [...INSTAGRAM_SUBSCRIBED_FIELDS],
        webhookFieldsNeedDashboard: true,
        // حالة مفتاح تدفّق الإعداد (منطقي فقط): enabled = extras مفعّل،
        // disabled = التدفّق العادي بلا extras (مخرج عطل Meta 1850019).
        onboardingFlow: instagramOnboardingEnabled() ? "enabled" : "disabled",
      };
    })(),
    // دليل النشر: أي إصدار/commit يعمل فعلاً على المنصة (Render). أسماء ومقتطفات
    // غير سرّية فقط (7 خانات من الـcommit) — تثبت أن الكود المنشور هو المدفوع.
    deploy: (() => {
      const sha = (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "").trim();
      return {
        provider: process.env.RENDER ? "render" : process.env.NETLIFY ? "netlify" : "unknown",
        commit: sha ? sha.slice(0, 7) : null,
        branch: (process.env.RENDER_GIT_BRANCH || "").trim() || null,
        nodeEnv: process.env.NODE_ENV || null,
      };
    })(),
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
        operationalState: verified ? "OPERATIONAL_READY" : conn?.status === "connected" ? "CONNECTED" : "DISCONNECTED",
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
    return res.status(200).json({ success: false, verified: false, state: 'failed', model, detail: aiLiveVerification.detail, errorKind: aiLiveVerification.errorKind, hint: aiLiveVerification.hint });
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
function buildCustomerDirectory(){
  const map=new Map<string,any>();
  const touch=(raw:any, source:string)=>{
    const key=customerKey(raw); if(!key)return;
    const c=map.get(key)||{id:`cust_${Buffer.from(key).toString('base64url').slice(0,18)}`,name:cleanText(raw.customerName||raw.name,160)||'عميل',phone:normalizedPhone(raw.phone),sources:new Set<string>(),salesCount:0,salesValue:0,paid:0,balance:0,openConversations:0,openLeads:0,lastActivity:null};
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

app.get('/api/control/alerts', authenticateToken, (_req,res)=>{
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
  const q=cleanText(req.query?.q,160).toLowerCase(); let rows=buildCustomerDirectory();
  if(q) rows=rows.filter(x=>String(x.name).toLowerCase().includes(q)||String(x.phone).toLowerCase().includes(q));
  res.json({success:true,customers:rows.slice(0,1000)});
});

app.get('/api/control/cashflow', authenticateToken, (req,res)=>{
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

app.get('/api/control/daily-brief', authenticateToken, (_req,res)=>{
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
  const signature=String(req.headers["x-gharabi-signature"]||""); const raw=JSON.stringify(req.body||{}); const expected=crypto.createHmac("sha256",WEBHOOK_SECRET).update(raw).digest("hex");
  if(!signature || signature.length!==expected.length || !crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) return res.status(401).json({success:false,error:"توقيع Webhook غير صالح."});
  const eventId=cleanText(req.headers["x-event-id"],160)||workspaceId("event"); if((workspace as any).webhookEvents.some((x:any)=>x.id===eventId)) return res.json({success:true,duplicate:true});
  const event={id:eventId,platform,type:cleanText(req.body?.type,100)||"unknown",payload:req.body?.data||req.body,receivedAt:new Date().toISOString()};
  (workspace as any).webhookEvents.unshift(event); (workspace as any).webhookEvents=(workspace as any).webhookEvents.slice(0,10000); (workspace as any).providerEvents.unshift({id:workspaceId("pevent"),platform,eventId,type:event.type,receivedAt:event.receivedAt}); (workspace as any).providerEvents=(workspace as any).providerEvents.slice(0,10000); persistState();
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
  add("gemini-guard","حارس Gemini",GEMINI_DAILY_LIMIT>=1&&GEMINI_DAILY_LIMIT<=6,"إعداد حارس Gemini غير آمن");
  add("webhook-safety","حماية Webhook",!WEBHOOK_SECRET || WEBHOOK_SECRET.length>=16,"WEBHOOK_SECRET يجب أن يكون 16 محرفًا على الأقل أو يُترك معطلًا");
  const healthy=checks.every(x=>x.ok); res.status(healthy?200:503).json({success:healthy,ready:healthy,projectVersion:PROJECT_VERSION,schemaVersion:STATE_SCHEMA_VERSION,checks,blocking:checks.filter(x=>!x.ok)});
});

app.get("/api/system/deployment-checklist", requireOwner, (_req,res)=>{
  const platformRows=SUPPORTED_PLATFORMS.map((p:any)=>{ const r=publicProviderReadiness(p.id); const c:any=platformConnections.get(p.id); return {platform:p.id,name:p.name,configured:Boolean(r.configured),connected:Boolean(c?.status==="connected"&&c?.providerVerified===true),providerVerified:Boolean(c?.providerVerified===true),productionReady:Boolean(c?.status==="connected"&&c?.providerVerified===true&&p.id==="telegram"),missing:r.missing||[],next:r.next||"إضافة موصل إنتاجي معتمد"}; });
  const checks=[
    {id:"auth",label:"المصادقة والمالك",ok:serverUsers.some((u:any)=>u.role==="owner")},
    {id:"persistence",label:"التخزين والنسخ الاحتياطية",ok:Boolean(workspace&&typeof workspace==="object")&&storageStatus().healthy},
    {id:"integrity",label:"سلامة البيانات الأساسية",ok:Array.isArray(workspace.products)&&Array.isArray(workspace.sales)&&Array.isArray(workspace.payments)},
    {id:"ai-guard",label:"حارس Gemini",ok:GEMINI_DAILY_LIMIT>=1&&GEMINI_DAILY_LIMIT<=6},
    {id:"publish-safety",label:"سلامة النشر",ok:automationJobs.every((j:any)=>j.status!=="published"||j.providerVerified===true)},
    {id:"provider-clarity",label:"وضوح حالة المنصات",ok:platformRows.every((x:any)=>!x.connected||x.providerVerified)},
  ];
  res.json({success:true,ready:checks.every(x=>x.ok),projectVersion:PROJECT_VERSION,schemaVersion:STATE_SCHEMA_VERSION,checks,platforms:platformRows,productionAdapters:Object.fromEntries(SUPPORTED_PLATFORMS.map(p=>[p.id, hasRealConnector(p.id) ? "connector-implemented" : (OAUTH_CONFIG[p.id] ? "credentials-required" : "adapter-required")])),note:"الربط الحقيقي للمنصات يحتاج بيانات تطبيقات واعتمادات الحسابات الخاصة بالمالك؛ لا يتم اختلاقها أو اعتبار المنصة متصلة بدون تحقق مزود فعلي."});
});

app.get("/api/health", (_req, res) => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  const tokenKey = tokenKeyInspection();
  res.json({
    status: "ok",
    aiEnabled: hasKey,
    timestamp: new Date().toISOString(),
    service: "Al-Gharabi AI Backend",
    version: PROJECT_VERSION,
    geminiUsage: geminiStatus(),
    // حالة مفتاح تشفير توكنات المنصات: تفصل missing من invalid بلا كشف القيمة،
    // فتعكس نفس الحكم الذي يستخدمه encryptSecret/credentials فعلياً.
    platformTokenKey: { state: tokenKey.state, envName: "PLATFORM_TOKEN_ENCRYPTION_KEY", acceptedBytes: 32, reason: tokenKey.reason },
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
        // حالة مفتاح تدفّق الإعداد (منطقي فقط): enabled = extras مفعّل،
        // disabled = التدفّق العادي بلا extras (مخرج عطل Meta 1850019).
        onboardingFlow: instagramOnboardingEnabled() ? "enabled" : "disabled",
      };
    })(),
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

    return res.json({
      success: true,
      content: safeContent,
      platform,
      contentType,
      // نسخ المنصات تُبنى حتمياً من النص المُتحقَّق منه، فلا تُضاف أي معلومة جديدة
      // (سعر/دفعة/ضمان/رقم) خارج ما تم فحصه.
      adaptedVersions: Object.fromEntries(
        ["tiktok", "instagram", "x", "snapchat", "facebook", "whatsapp"]
          .map((p) => [p, adaptContentForPlatform(p, safeContent)]),
      ),
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
  const limits: Record<string, number> = { x: 280, snapchat: 250, whatsapp: 4096, telegram: 4096, threads: 500, google_business: 1500 };
  const limit = limits[platform] || 4096;

  if (platform === "x") {
    const tweet = text.replace(/\s+/g, " ").trim();
    const withTags = tweet.includes("#") ? tweet : `${tweet} ${hashtags}`;
    return withTags.length <= limit ? withTags : `${withTags.slice(0, limit - hashtags.length - 1).trimEnd()} ${hashtags}`;
  }
  if (platform === "snapchat") {
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, 3);
    const body = lines.map((l, i) => `${i + 1}) ${l}`).join("\n");
    return body.length ? `لقطة 1..2..3:\n${body}` : text;
  }
  if (platform === "tiktok") {
    const first = text.split(/\n+/).map((l) => l.trim()).filter(Boolean)[0] || text;
    return `${first.slice(0, 150)}\n\n${text}\n\n${hashtags}`;
  }
  // المنصات الأخرى: النص كما هو مع إضافة الهاشتاغ عند غيابه.
  return text.includes("#") ? text : `${text}\n\n${hashtags}`;
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

const PLATFORM_TEXT_LIMITS: Record<string, number> = {
  tiktok: 2200, instagram: 2200, facebook: 2000, youtube: 5000, x: 280,
  snapchat: 250, whatsapp: 4096, telegram: 4096, threads: 500, google_business: 1500,
};

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

function trimToWordBoundary(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// Composes the final platform text and guarantees it fits the platform limit by
// shortening the body first, then dropping hashtags. Never truncates mid-word.
function composePlatformText(headline: string, body: string, callToAction: string, hashtags: string[], limit: number) {
  let tags = hashtags.slice();
  let currentBody = body;
  const render = () => [headline, currentBody, callToAction, tags.join(" ")].filter((x) => x && x.trim()).join("\n\n");
  let text = render();
  while (text.length > limit && tags.length > 1) { tags = tags.slice(0, -1); text = render(); }
  if (text.length > limit) {
    tags = [];
    const reserved = render().length - currentBody.length;
    currentBody = trimToWordBoundary(currentBody, Math.max(0, limit - reserved));
    text = render();
  }
  if (text.length > limit) text = trimToWordBoundary(render(), limit);
  return { text, hashtags: tags, charCount: text.length, limit, withinLimit: text.length <= limit };
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
    const composed = composePlatformText(copy.headline, copy.body, copy.cta, copy.hashtags, PLATFORM_TEXT_LIMITS[platform] || 2000);
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
  // حقائق المعرض الفعلية لمنتج محدّد (أو العامة) لفحص أي رد مقترح مقابل بيانات
  // مسجّلة فعلاً، فلا يمر ادعاء تجاري غير مسجّل.
  buildFacts: (productId?: string | null) => {
    const product = productId ? workspace.products.find((p: any) => p.id === productId) || null : null;
    return buildFactsForProduct(product, Number(product?.downPaymentPercent || 0), Number(product?.durationMonths || 0));
  },
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
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[الغرابي AI Server] running on http://0.0.0.0:${PORT}`);
  });

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
