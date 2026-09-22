import express from "express";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import dotenv from "dotenv";
import { AiEngine, type AiUsageGuard } from "./engine/ai/engine";
import { createGeminiProvider } from "./engine/ai/provider";
import { resolveModelCandidates, describeModelPolicy, PRODUCTION_MODEL } from "./engine/ai/models";
import { classifyAiError, diagnosticLabel } from "./engine/ai/errors";
import { CircuitBreaker } from "./engine/ai/retry";
import { registerSocialManagerRoutes } from "./engine/social/routes";
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

app.use(express.json({ limit: "256kb" }));

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
    return { users, revokedSessions: Array.isArray(raw.revokedSessions) ? raw.revokedSessions : [], userRevocations: Array.isArray(raw.userRevocations) ? raw.userRevocations : [], audit: Array.isArray(raw.audit) ? raw.audit.slice(0, 200) : [], jobs: Array.isArray(raw.jobs) ? raw.jobs.slice(0, 200) : [], platformConnections: Array.isArray(raw.platformConnections) ? raw.platformConnections : [], workspace: raw.workspace && typeof raw.workspace === "object" ? { showroom: raw.workspace.showroom || {}, products: Array.isArray(raw.workspace.products) ? raw.workspace.products.slice(0, 1000) : [], posts: Array.isArray(raw.workspace.posts) ? raw.workspace.posts.slice(0, 1000) : [], conversations: Array.isArray(raw.workspace.conversations) ? raw.workspace.conversations.slice(0, 1000) : [], installmentPlans: Array.isArray(raw.workspace.installmentPlans) ? raw.workspace.installmentPlans.slice(0, 200) : [], leads: Array.isArray(raw.workspace.leads) ? raw.workspace.leads.slice(0, 2000) : [], tasks: Array.isArray(raw.workspace.tasks) ? raw.workspace.tasks.slice(0, 1000) : [], sales: Array.isArray(raw.workspace.sales) ? raw.workspace.sales.slice(0, 5000) : [], payments: Array.isArray(raw.workspace.payments) ? raw.workspace.payments.slice(0, 10000) : [], inventoryMovements: Array.isArray(raw.workspace.inventoryMovements) ? raw.workspace.inventoryMovements.slice(0, 20000) : [], suppliers: Array.isArray(raw.workspace.suppliers) ? raw.workspace.suppliers.slice(0, 1000) : [], purchases: Array.isArray(raw.workspace.purchases) ? raw.workspace.purchases.slice(0, 5000) : [], expenses: Array.isArray(raw.workspace.expenses) ? raw.workspace.expenses.slice(0, 10000) : [], contracts: Array.isArray(raw.workspace.contracts) ? raw.workspace.contracts.slice(0, 5000) : [], installmentSchedules: Array.isArray(raw.workspace.installmentSchedules) ? raw.workspace.installmentSchedules.slice(0, 20000) : [], notifications: Array.isArray(raw.workspace.notifications) ? raw.workspace.notifications.slice(0, 10000) : [], webhookEvents: Array.isArray(raw.workspace.webhookEvents) ? raw.workspace.webhookEvents.slice(0, 10000) : [], providerEvents: Array.isArray(raw.workspace.providerEvents) ? raw.workspace.providerEvents.slice(0, 10000) : [], marketingBriefs: Array.isArray(raw.workspace.marketingBriefs) ? raw.workspace.marketingBriefs.slice(0, 2000) : [], marketingCampaigns: Array.isArray(raw.workspace.marketingCampaigns) ? raw.workspace.marketingCampaigns.slice(0, 1000) : [], socialComments: Array.isArray(raw.workspace.socialComments) ? raw.workspace.socialComments.slice(0, 10000) : [], socialReplies: Array.isArray(raw.workspace.socialReplies) ? raw.workspace.socialReplies.slice(0, 5000) : [], publishRecords: Array.isArray(raw.workspace.publishRecords) ? raw.workspace.publishRecords.slice(0, 5000) : [], performanceRecords: Array.isArray(raw.workspace.performanceRecords) ? raw.workspace.performanceRecords.slice(0, 20000) : [], marketingDecisions: Array.isArray(raw.workspace.marketingDecisions) ? raw.workspace.marketingDecisions.slice(0, 2000) : [], strategiesTested: Array.isArray(raw.workspace.strategiesTested) ? raw.workspace.strategiesTested.slice(0, 2000) : [], providerTokens: raw.workspace.providerTokens && typeof raw.workspace.providerTokens === "object" ? raw.workspace.providerTokens : {} } : { showroom: {}, products: [], posts: [], conversations: [], installmentPlans: [], leads: [], tasks: [], sales: [], payments: [], inventoryMovements: [], suppliers: [], purchases: [], expenses: [], contracts: [], installmentSchedules: [], notifications: [], webhookEvents: [], providerEvents: [], marketingBriefs: [], marketingCampaigns: [], socialComments: [], socialReplies: [], publishRecords: [], performanceRecords: [], marketingDecisions: [], strategiesTested: [], providerTokens: {} } };
  } catch {
    return { users: [defaultOwner], revokedSessions: [], userRevocations: [], audit: [], jobs: [], workspace: { showroom: {}, products: [], posts: [], conversations: [], installmentPlans: [], leads: [], tasks: [], sales: [], payments: [], inventoryMovements: [], suppliers: [], purchases: [], expenses: [], contracts: [], installmentSchedules: [], notifications: [], webhookEvents: [], providerEvents: [], marketingBriefs: [], marketingCampaigns: [], socialComments: [], socialReplies: [], publishRecords: [], performanceRecords: [], marketingDecisions: [], strategiesTested: [], providerTokens: {} } };
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
if (!(workspace as any).providerTokens || typeof (workspace as any).providerTokens !== "object") (workspace as any).providerTokens = {};
// سجلات مدير السوشيال ميديا: تعليقات، ردود، نتائج نشر، وقرارات تسويقية.
// كلها سجلات تشغيلية حقيقية تُبنى من عمليات فعلية فقط.
for (const key of ["socialComments","socialReplies","publishRecords","marketingDecisions","strategiesTested","performanceRecords"]) if (!Array.isArray((workspace as any)[key])) (workspace as any)[key] = [];

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
const SUPPORTED_PLATFORMS = [
  { id: "tiktok", name: "TikTok", capabilities: ["publish", "analytics"] },
  { id: "youtube", name: "YouTube", capabilities: ["publish", "analytics"] },
  { id: "facebook", name: "Facebook", capabilities: ["publish", "messages", "analytics"] },
  { id: "instagram", name: "Instagram", capabilities: ["publish", "messages", "analytics"] },
  { id: "whatsapp", name: "WhatsApp Business", capabilities: ["messages"] },
  { id: "telegram", name: "Telegram", capabilities: ["publish", "messages"] },
  { id: "x", name: "X", capabilities: ["publish", "analytics"] },
  { id: "snapchat", name: "Snapchat", capabilities: ["publish", "analytics"] },
  { id: "threads", name: "Threads", capabilities: ["publish", "messages", "analytics"] },
  { id: "google_business", name: "Google Business Profile", capabilities: ["publish", "analytics"] },
];
const platformConnections = new Map<string, PlatformConnection>();

type OAuthPending = { platform: string; userId: string; expiresAt: number; codeVerifier?: string };
const pendingOAuth = new Map<string, OAuthPending>();
const PLATFORM_TOKEN_KEY = (process.env.PLATFORM_TOKEN_ENCRYPTION_KEY || "").trim();
function tokenKeyBytes() {
  if (!PLATFORM_TOKEN_KEY) return null;
  try {
    const raw = /^[0-9a-fA-F]{64}$/.test(PLATFORM_TOKEN_KEY) ? Buffer.from(PLATFORM_TOKEN_KEY, "hex") : Buffer.from(PLATFORM_TOKEN_KEY, "base64");
    return raw.length === 32 ? raw : null;
  } catch { return null; }
}
function encryptSecret(value: string) {
  const key = tokenKeyBytes();
  if (!key) throw new Error("PLATFORM_TOKEN_ENCRYPTION_KEY غير مضبوط أو غير صالح (يلزم 32 بايت). ");
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

const BASE_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const OAUTH_CONFIG: Record<string, any> = {
  youtube: { provider: "google", auth: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, scopes: ["https://www.googleapis.com/auth/youtube.upload"], callback: `${BASE_URL}/api/platforms/youtube/oauth/callback` },
  google_business: { provider: "google", auth: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, scopes: ["https://www.googleapis.com/auth/business.manage"], callback: `${BASE_URL}/api/platforms/google_business/oauth/callback` },
  tiktok: { provider: "tiktok", auth: "https://www.tiktok.com/v2/auth/authorize/", token: "https://open.tiktokapis.com/v2/oauth/token/", clientId: process.env.TIKTOK_CLIENT_KEY, clientSecret: process.env.TIKTOK_CLIENT_SECRET, scopes: ["user.info.basic", "video.publish"], callback: `${BASE_URL}/api/platforms/tiktok/oauth/callback` },
};
function oauthReady(platform: string) { const c = OAUTH_CONFIG[platform]; return Boolean(c?.clientId && c?.clientSecret && process.env.APP_URL && tokenKeyBytes()); }
function publicProviderReadiness(platform: string): { configured: boolean; mode: string; action: string; missing?: string[]; next?: string } {
  if (platform === "telegram") return { configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && tokenKeyBytes()), mode: "bot-token", action: "configure", next: "ضبط Bot Token ثم اختبار الإرسال" };
  const c = OAUTH_CONFIG[platform];
  if (c) return { configured: oauthReady(platform), mode: "oauth2", action: "authorize", next: "ضبط بيانات OAuth وتسجيل Redirect URI", missing: [!c.clientId && "client_id", !c.clientSecret && "client_secret", !process.env.APP_URL && "APP_URL", !tokenKeyBytes() && "PLATFORM_TOKEN_ENCRYPTION_KEY"].filter((x): x is string => Boolean(x)) };
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
function hasCapability(platform: string, capability: string) { return SUPPORTED_PLATFORMS.some(p => p.id === platform && p.capabilities.includes(capability)); }

// -------------------------------------------------------------
// Central control-plane endpoints (deterministic, no Gemini cost)
// -------------------------------------------------------------
app.get("/api/platforms/:platform/oauth/start", requireOwner, (req,res)=>{
  const platform=req.params.platform; const cfg=OAUTH_CONFIG[platform];
  if(!cfg) return res.status(501).json({success:false,error:"هذا المزود يحتاج إعداد موصل خاص قبل بدء OAuth."});
  if(!oauthReady(platform)) return res.status(503).json({success:false,error:"إعداد OAuth غير مكتمل. يلزم APP_URL وبيانات تطبيق المزود ومفتاح PLATFORM_TOKEN_ENCRYPTION_KEY."});
  const state=crypto.randomBytes(24).toString("hex");
  const pending:OAuthPending={platform,userId:(req as any).user.id,expiresAt:Date.now()+10*60*1000};
  if(platform==="tiktok") { const verifier=crypto.randomBytes(48).toString("base64url"); pending.codeVerifier=verifier; }
  pendingOAuth.set(state,pending);
  const u=new URL(cfg.auth);
  if(platform==="tiktok") { const challenge=crypto.createHash("sha256").update(pending.codeVerifier||"").digest("base64url"); u.searchParams.set("client_key",cfg.clientId); u.searchParams.set("response_type","code"); u.searchParams.set("scope",cfg.scopes.join(",")); u.searchParams.set("redirect_uri",cfg.callback); u.searchParams.set("state",state); u.searchParams.set("code_challenge",challenge); u.searchParams.set("code_challenge_method","S256"); }
  else { u.searchParams.set("client_id",cfg.clientId); u.searchParams.set("redirect_uri",cfg.callback); u.searchParams.set("response_type","code"); u.searchParams.set("scope",cfg.scopes.join(" ")); u.searchParams.set("access_type","offline"); u.searchParams.set("prompt","consent"); u.searchParams.set("state",state); }
  audit((req as any).user.id,"platform_oauth_started",platform); res.json({success:true,platform,authorizationUrl:u.toString(),expiresAt:pending.expiresAt});
});

app.get("/api/platforms/:platform/oauth/callback", async (req,res)=>{
  const platform=req.params.platform; const state=typeof req.query.state==="string"?req.query.state:""; const pending=pendingOAuth.get(state); const cfg=OAUTH_CONFIG[platform];
  if(!pending || pending.platform!==platform || pending.expiresAt<Date.now()) return res.status(400).send("فشل التحقق من جلسة OAuth أو انتهت صلاحيتها.");
  pendingOAuth.delete(state);
  if(req.query.error) return res.status(400).send(`رفض مزود المنصة عملية الربط: ${String(req.query.error_description||req.query.error).slice(0,200)}`);
  const code=typeof req.query.code==="string"?req.query.code:""; if(!code) return res.status(400).send("لم يتم استلام رمز OAuth.");
  try {
    const body=new URLSearchParams(); body.set("client_id",cfg.clientId); body.set("client_secret",cfg.clientSecret); body.set("code",code); body.set("grant_type","authorization_code"); body.set("redirect_uri",cfg.callback); if(pending.codeVerifier) body.set("code_verifier",pending.codeVerifier);
    const tokenRes=await fetch(cfg.token,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body}); const token=await tokenRes.json();
    if(!tokenRes.ok || !token.access_token) throw new Error(token.error_description||token.error||"فشل تبادل رمز OAuth");
    let accountId="authorized-user", accountName="حساب متصل";
    if(platform==="youtube") { const r=await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true`,{headers:{Authorization:`Bearer ${token.access_token}`}}); const d=await r.json(); if(r.ok&&d.items?.[0]) { accountId=d.items[0].id; accountName=d.items[0].snippet?.title||accountName; } }
    if(platform==="tiktok") { const r=await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",{headers:{Authorization:`Bearer ${token.access_token}`}}); const d=await r.json(); if(r.ok&&d.data?.user){ accountId=d.data.user.open_id||accountId; accountName=d.data.user.display_name||accountName; } }
    setProviderToken(platform,token); platformConnections.set(platform,{platform,status:"connected",accountId,accountName,connectedAt:new Date().toISOString(),providerVerified:true}); savePlatformConnections(); audit(pending.userId,"platform_oauth_connected",`${platform}:${accountId}`);
    res.send("<html lang='ar' dir='rtl'><meta charset='utf-8'><title>تم الربط</title><body style='font-family:sans-serif;padding:40px'><h2>تم ربط المنصة بنجاح.</h2><p>يمكنك إغلاق هذه النافذة والعودة إلى الغرابي AI.</p></body></html>");
  } catch(e:any) { audit(pending.userId,"platform_oauth_failed",platform); res.status(502).send(`فشل إكمال ربط المنصة: ${String(e?.message||e).slice(0,240)}`); }
});

app.post("/api/platforms/telegram/configure", requireOwner, async (req,res)=>{
  const botToken=typeof req.body?.botToken==="string"?req.body.botToken.trim():""; if(!botToken) return res.status(400).json({success:false,error:"رمز Telegram Bot مطلوب."});
  if(!tokenKeyBytes()) return res.status(503).json({success:false,error:"PLATFORM_TOKEN_ENCRYPTION_KEY غير مضبوط."});
  const r=await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/getMe`); const d=await r.json(); if(!r.ok||!d.ok||!d.result?.id) return res.status(400).json({success:false,error:"تعذر التحقق من Telegram Bot Token."});
  setProviderToken("telegram",{botToken}); platformConnections.set("telegram",{platform:"telegram",status:"connected",accountId:String(d.result.id),accountName:d.result.username?`@${d.result.username}`:d.result.first_name||"Telegram Bot",connectedAt:new Date().toISOString(),providerVerified:true}); savePlatformConnections(); audit((req as any).user.id,"telegram_configured",String(d.result.id)); res.json({success:true,connection:safeConnection("telegram")});
});

app.get("/api/platforms/:platform/health", authenticateToken, async (req,res)=>{
  const platform=req.params.platform;
  const c:any=platformConnections.get(platform);
  if(!c || c.status!=="connected" || c.providerVerified!==true) return res.status(409).json({success:false,platform,healthy:false,error:"المنصة غير متصلة باتصال مزود موثق."});
  try {
    const token:any=getProviderToken(platform);
    if(platform==="telegram") {
      if(!token?.botToken) throw new Error("توكن Telegram غير متوفر.");
      const r=await fetch(`https://api.telegram.org/bot${encodeURIComponent(token.botToken)}/getMe`); const d=await r.json();
      return res.status(r.ok&&d.ok?200:502).json({success:r.ok&&d.ok,platform,healthy:r.ok&&d.ok,provider:"telegram",accountId:String(d.result?.id||c.accountId),accountName:d.result?.username?`@${d.result.username}`:c.accountName,checkedAt:new Date().toISOString()});
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
  const rows=SUPPORTED_PLATFORMS.map((p:any)=>{ const r=publicProviderReadiness(p.id); const c:any=platformConnections.get(p.id); const connected=Boolean(c?.status==="connected" && c?.providerVerified===true); const production=connected && (p.id==="telegram"); return {platform:p.id,name:p.name,configured:r.configured,connected,providerVerified:Boolean(c?.providerVerified),productionReady:production,mode:r.mode,missing:r.missing||[],next:p.id==="telegram"?"ضبط Bot Token وChat ID ثم اختبار الإرسال":OAUTH_CONFIG[p.id]?"ضبط بيانات OAuth ثم تسجيل Redirect URI والربط": "إضافة موصل إنتاجي معتمد قبل تفعيل النشر"}; });
  res.json({success:true,generatedAt:new Date().toISOString(),projectVersion:PROJECT_VERSION,summary:{total:rows.length,connected:rows.filter(x=>x.connected).length,productionReady:rows.filter(x=>x.productionReady).length},platforms:rows,note:"هذه الصفحة تميز الجاهزية التقنية عن الاتصال الفعلي ولا تمنح أي منصة حالة نجاح وهمية."});
});

app.get("/api/control/final-check", requireOwner, (_req,res)=>{
  const checks:any[]=[]; const add=(id:string,ok:boolean,detail:string,blocking=false)=>checks.push({id,ok,detail,blocking});
  add("state-persistence",storageStatus().writable,"مخزن الحالة متاح وقابل للكتابة",true);
  add("owner",Boolean(OWNER_EMAIL),"OWNER_EMAIL مضبوط",true);
  add("token-encryption",Boolean(tokenKeyBytes()),"مفتاح تشفير توكنات المنصات مضبوط",true);
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

app.post("/api/platforms/:platform/disconnect", requireOwner, (req, res) => {
  const platform = req.params.platform;
  if (!platformConnections.has(platform)) return res.status(404).json({ success: false, error: "المنصة غير مدعومة." });
  platformConnections.set(platform, { platform, status: "disconnected" });
  clearProviderToken(platform); savePlatformConnections(); audit((req as any).user.id, "platform_disconnect", platform);
  res.json({ success: true, connection: platformConnections.get(platform) });
});

app.post("/api/platforms/:platform/connection-callback", requireOwner, (req, res) => {
  const platform = req.params.platform; const { providerVerified, accountId, accountName } = req.body || {};
  if (!platformConnections.has(platform)) return res.status(404).json({ success: false, error: "المنصة غير مدعومة." });
  if (providerVerified !== true || typeof accountId !== "string" || !accountId.trim()) return res.status(400).json({ success: false, error: "لم يتم إثبات اتصال مزود المنصة. لا يمكن تفعيل الاتصال يدوياً." });
  const connection: PlatformConnection = { platform, status: "connected", accountId: accountId.trim().slice(0, 200), accountName: typeof accountName === "string" ? accountName.trim().slice(0, 200) : undefined, connectedAt: new Date().toISOString(), providerVerified: true };
  platformConnections.set(platform, connection); savePlatformConnections(); audit((req as any).user.id, "platform_connected", platform);
  res.json({ success: true, connection });
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
      const token=getProviderToken("telegram")?.botToken; const chatId=String(process.env.TELEGRAM_DEFAULT_CHAT_ID||job.payload?.chatId||""); if(!token||!chatId) return res.status(503).json({success:false,error:"Telegram يحتاج TELEGRAM_DEFAULT_CHAT_ID أو chatId في المهمة."});
      const r=await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chatId,text:content})}); const d=await r.json(); if(!r.ok||!d.ok) throw new Error(d.description||"فشل إرسال Telegram");
      job.status="executed"; job.executedAt=new Date().toISOString(); job.providerVerified=true; job.providerReceipt={provider:"telegram",messageId:d.result?.message_id,executedAt:new Date().toISOString()}; persistState(); audit((req as any).user.id,"job_executed",`${job.id}:telegram`); return res.json({success:true,job,receipt:job.providerReceipt});
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
      socialReplies: (workspace as any).socialReplies.slice(0, 5000), publishRecords: (workspace as any).publishRecords.slice(0, 5000), performanceRecords: (workspace as any).performanceRecords.slice(0, 20000), marketingDecisions: (workspace as any).marketingDecisions.slice(0, 2000), strategiesTested: (workspace as any).strategiesTested.slice(0, 2000),
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
} = { state: 'not_attempted', detail: null, model: null, at: null };

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
    return res.status(200).json({
      success: false,
      verified: false,
      state: aiLiveVerification.state,
      model,
      detail: aiLiveVerification.detail,
      note: 'NOT VERIFIED — GEMINI_API_KEY NOT AVAILABLE IN RUNTIME',
    });
  }

  const provider = createGeminiProvider(process.env.GEMINI_API_KEY, AI_TIMEOUT_MS);
  if (!provider) {
    aiLiveVerification.state = 'failed';
    aiLiveVerification.detail = 'تعذر تهيئة موصل المزود.';
    aiLiveVerification.model = null;
    aiLiveVerification.at = new Date().toISOString();
    return res.status(200).json({ success: false, verified: false, state: 'failed', model, detail: aiLiveVerification.detail });
  }

  const started = Date.now();
  // محاولة واحدة فقط على موديل الإنتاج، بلا retry وبلا بديل.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    let text = '';
    try {
      text = await provider.generate({ model, prompt: 'اكتب كلمة: جاهز', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    const trimmed = (text || '').trim();
    if (!trimmed) {
      aiLiveVerification.state = 'failed';
      aiLiveVerification.detail = `الموديل الإنتاجي ${model} أعاد استجابة فارغة.`;
      aiLiveVerification.model = null;
      aiLiveVerification.at = new Date().toISOString();
      return res.status(200).json({
        success: false,
        verified: false,
        state: 'failed',
        model,
        detail: aiLiveVerification.detail,
        modelPolicy: envPolicy,
        hint: 'راجع صلاحية GEMINI_API_KEY في بيئة الخادم (لا تُرسل المفتاح في المحادثة).',
      });
    }
    aiLiveVerification.state = 'ok';
    aiLiveVerification.detail = `تم إثبات الاتصال بالموديل الإنتاجي ${model} بطلب حقيقي واحد.`;
    aiLiveVerification.model = model;
    aiLiveVerification.at = new Date().toISOString();
    audit('system', 'ai_verify_provider', `model=${model}`);
    return res.json({
      success: true,
      verified: true,
      state: 'ok',
      model,
      latencyMs: Date.now() - started,
      responsePreview: trimmed.slice(0, 80),
      modelPolicy: envPolicy,
      candidatesTried: 1,
      note: 'تم إثبات الموديل الإنتاجي بطلب حقيقي واحد. لم تُستهلك حصة إضافية ولا يوجد failover.',
    });
  } catch (err: any) {
    // فشل الموديل الأساسي (503 أو أي خطأ) = فشل صريح، بلا رجوع لموديل آخر.
    const info = classifyAiError(err, model);
    aiEvents.push({ at: new Date().toISOString(), type: 'verify_failed', detail: diagnosticLabel(info) });
    aiLiveVerification.state = 'failed';
    aiLiveVerification.detail = `فشل التحقق من الموديل الإنتاجي ${model}: ${info.kind}${info.status ? `/${info.status}` : ''}.`;
    aiLiveVerification.model = null;
    aiLiveVerification.at = new Date().toISOString();
    return res.status(200).json({
      success: false,
      verified: false,
      state: 'failed',
      model,
      detail: aiLiveVerification.detail,
      safeMessage: info.safeMessage,
      modelPolicy: envPolicy,
      hint: 'راجع صلاحية GEMINI_API_KEY في بيئة الخادم (لا تُرسل المفتاح في المحادثة).',
    });
  }
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
  res.json({success:true,ready:checks.every(x=>x.ok),projectVersion:PROJECT_VERSION,schemaVersion:STATE_SCHEMA_VERSION,checks,platforms:platformRows,productionAdapters:{telegram:"ready",youtube:"credentials-required",tiktok:"credentials-required",google_business:"credentials-required",facebook:"adapter-required",instagram:"adapter-required",whatsapp:"adapter-required",x:"adapter-required",snapchat:"adapter-required",threads:"adapter-required"},note:"الربط الحقيقي للمنصات يحتاج بيانات تطبيقات واعتمادات الحسابات الخاصة بالمالك؛ لا يتم اختلاقها أو اعتبار المنصة متصلة بدون تحقق مزود فعلي."});
});

app.get("/api/health", (_req, res) => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  res.json({
    status: "ok",
    aiEnabled: hasKey,
    timestamp: new Date().toISOString(),
    service: "Al-Gharabi AI Backend",
    version: PROJECT_VERSION,
    geminiUsage: geminiStatus(),
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
    if (result.usedProvider || result.source === "cache") {
      try {
        const candidate = JSON.parse(result.text);
        // ندمج مخرجات المزود مع التصنيف الحتمي لضمان اكتمال كل الحقول.
        parsed = { ...deterministicClassification, ...candidate };
      } catch {
        parsed = deterministicClassification;
      }
    }

    return res.json({
      success: true,
      ...parsed,
      generatedBy: result.usedProvider ? (result.model || PRODUCTION_MODEL) : result.source === "cache" ? "ai-cache" : "local-deterministic-engine",
      aiSource: result.source,
      fallbackReason: result.fallbackReason,
      model: result.model,
      notice: result.notice,
    });
  } catch (error: any) {
    res.status(200).json({
      success: true,
      ...classifyMessageDeterministic(req.body?.customerName, req.body?.message),
      generatedBy: "local-deterministic-engine",
      aiSource: "fallback",
      fallbackReason: "unknown_error",
      model: null,
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
  const check = analyzeBusinessClaims(text, facts);
  if (check.safe) return { text, check, replaced: false };
  const candidate = fallback();
  const fallbackCheck = analyzeBusinessClaims(candidate, facts);
  if (fallbackCheck.safe) return { text: candidate, check: fallbackCheck, replaced: true };
  return {
    text: "تواصل معنا لمعرفة التفاصيل والخطة المناسبة لك.",
    check: fallbackCheck,
    replaced: true,
  };
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
