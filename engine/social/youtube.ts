/**
 * موصل YouTube الحقيقي — خامس تكامل اجتماعي خارجي منفّذ بعد Telegram وFacebook
 * وInstagram وTikTok. مبنيّ على YouTube Data API v3 الرسمي فقط.
 *
 * سبب البنية: YouTube يختلف عن Meta وTikTok:
 * - OAuth 2.0 قياسي من Google (`accounts.google.com/o/oauth2/v2/auth`) بترميز
 *   `client_id`، ويحتاج `access_type=offline` + `prompt=consent` للحصول على
 *   refresh token (وإلا انتهى الاتصال صامتاً بعد ساعة).
 * - الهوية هي قناة (`channelId`) تُثبت بـ`channels.list?mine=true`.
 * - الحصة (quota) نظام وحدات يومي (10,000 وحدة افتراضياً)، وكل استدعاء يستهلك
 *   وحدات مختلفة (search = 100 وحدة). لذلك **يجب** تصنيف خطأ `quotaExceeded`
 *   صريحاً بدل اعتباره عطلاً عاماً، ولا يُعلن نجاح عند استهلاك الحصة.
 * - التعليقات والردود متاحة رسمياً عبر `commentThreads`/`comments` (بخلاف TikTok
 *   الذي لا يوفرها). لذلك يُعلن `comment_reply` بصراحة هنا.
 *
 * القاعدة الملزمة (نفس بقية الموصلات): لا يُعلن دعم قدرة لم تُنفَّذ أو لا توفّرها
 * الواجهة الرسمية، ولا يُخترع مؤشر، ولا يُسجَّل نشر/رد بلا معرّف حقيقي من المزود.
 *
 * كل الأسرار تُمرَّر كوسائط؛ لا تُسجَّل ولا تُعاد. الدوال الحتمية (بناء الروابط،
 * تصنيف الأخطاء، تحليل الحمولات، حساب وحدات الحصة) مفصولة عن عميل الشبكة لتُختبر
 * بلا أي مزود ولا استهلاك حصة.
 */

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// PHASE 1 — ثوابت النقاط الرسمية (YouTube Data API v3)
// ---------------------------------------------------------------------------

export const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
export const YOUTUBE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const YOUTUBE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const YOUTUBE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
/** نقطة اكتشاف القنوات (تُعرف أيضاً بإثبات الهوية). */
export const YOUTUBE_CHANNELS_PATH = '/channels';
/** لاحقة نطاق Google الصحيحة لمعرّف عميل الويب. */
export const YOUTUBE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';
/** ترويسة توقيع إشعارات PubSubHubbub (HMAC-SHA1 على الجسم الخام بصيغة sha1=<hex>). */
export const YOUTUBE_PUBSUB_SIGNATURE_HEADER = 'x-hub-signature';

/**
 * القاعدة الفعلية لاستدعاءات API. تُقرأ من `YOUTUBE_API_BASE` للاختبار فقط
 * (خادم YouTube وهمي محلي)، فلا تُشغَّل اختبارات الشبكة على مزود حقيقي.
 * في الإنتاج تبقى القاعدة الرسمية.
 */
export function youtubeApiBase(override?: string): string {
  const base = override || process.env.YOUTUBE_API_BASE || YOUTUBE_API_BASE;
  return base.replace(/\/+$/, '');
}

/** قاعدة خدمات Google (auth/token/revoke)؛ قابلة للتجاوز للاختبار فقط. */
export function youtubeGoogleBase(override?: string): string {
  const base = override || process.env.YOUTUBE_GOOGLE_BASE || 'https://oauth2.googleapis.com';
  return base.replace(/\/+$/, '');
}

export function youtubeTokenUrl(override?: string): string {
  return `${youtubeGoogleBase(override)}/token`;
}

export function youtubeRevokeUrl(token: string, override?: string): string {
  return `${youtubeGoogleBase(override)}/revoke?token=${encodeURIComponent(token)}`;
}

export function youtubeApiUrl(path: string, baseOverride?: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${youtubeApiBase(baseOverride)}${suffix}`;
}

// ---------------------------------------------------------------------------
// PHASE 2 — مصفوفة القدرات الرسمية (لا تُعلن قدرة غير منفّذة/غير متاحة)
// ---------------------------------------------------------------------------

export type YouTubeCapabilityStatus =
  | 'SUPPORTED'
  | 'REQUIRES_REVIEW'
  | 'REQUIRES_AUDIT'
  | 'NOT_AVAILABLE_BY_PUBLIC_API';

export interface YouTubeCapabilityRow {
  /** معرّف القدرة التقني. */
  key: string;
  /** الاسم المعروض. */
  label: string;
  status: YouTubeCapabilityStatus;
  /** النطاق الرسمي الذي يغطّيها (إن وُجد). */
  scope?: string;
  /** دليل/ملاحظة رسمية تشرح الحالة. */
  evidence: string;
}

/**
 * مصفوفة القدرات الرسمية لـYouTube، مُشتقة من وثائق Google الرسمية
 * (OAuth 2.0 for Google APIs, YouTube Data API v3 — channels/playlists/search/
 * videos/commentThreads/comments, Push Notifications).
 */
export const YOUTUBE_CAPABILITY_MATRIX: readonly YouTubeCapabilityRow[] = Object.freeze([
  {
    key: 'oauth_connection',
    label: 'OAuth 2.0 (Google)',
    status: 'SUPPORTED',
    scope: 'https://www.googleapis.com/auth/youtube.readonly',
    evidence: 'تدفّق Google القياسي (response_type=code) مع access_type=offline وprompt=consent للحصول على refresh token؛ التبادل على oauth2.googleapis.com/token.',
  },
  {
    key: 'channel_identity',
    label: 'هوية القناة (channelId + العنوان)',
    status: 'SUPPORTED',
    scope: 'https://www.googleapis.com/auth/youtube.readonly',
    evidence: 'GET /channels?part=snippet&mine=true يُعيد id وsnippet.title — لا يُعلن اتصال موثق بدونه.',
  },
  {
    key: 'channel_management',
    label: 'إدارة القناة (قراءة الإحصاءات الأساسية)',
    status: 'SUPPORTED',
    scope: 'https://www.googleapis.com/auth/youtube.readonly',
    evidence: 'GET /channels?part=statistics يُعيد viewCount, subscriberCount, videoCount.',
  },
  {
    key: 'playlists_read',
    label: 'قوائم التشغيل (قراءة)',
    status: 'SUPPORTED',
    scope: 'https://www.googleapis.com/auth/youtube.readonly',
    evidence: 'GET /playlists?part=snippet,contentDetails&channelId=...',
  },
  {
    key: 'videos_list',
    label: 'فيديوهات القناة + بيانات كل فيديو',
    status: 'SUPPORTED',
    scope: 'https://www.googleapis.com/auth/youtube.readonly',
    evidence: 'GET /search?part=snippet&channelId=...&type=video (search يستهلك 100 وحدة) ثم GET /videos?part=snippet,statistics,contentDetails&id=... (وحدة واحدة لكل نداء).',
  },
  {
    key: 'analytics_read',
    label: 'التحليلات (مشاهدات/إعجابات/تعليقات)',
    status: 'SUPPORTED',
    scope: 'https://www.googleapis.com/auth/youtube.readonly',
    evidence: 'statistics تُعيد viewCount, likeCount, commentCount لكل فيديو، وviewCount/subscriberCount/videoCount للقناة.',
  },
  {
    key: 'comments_read',
    label: 'قراءة التعليقات',
    status: 'SUPPORTED',
    scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
    evidence: 'GET /commentThreads?part=snippet,replies&videoId=... وGET /comments?part=snippet&videoId=...',
  },
  {
    key: 'comment_reply',
    label: 'الرد على التعليقات',
    status: 'SUPPORTED',
    scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
    evidence: 'POST /comments?part=snippet بجسم {snippet:{parentId,textOriginal}} — لا يُسجَّل رد بلا معرّف تعليق من المزود.',
  },
  {
    key: 'video_upload',
    label: 'رفع فيديو',
    status: 'REQUIRES_AUDIT',
    scope: 'https://www.googleapis.com/auth/youtube.upload',
    evidence: 'POST /videos?uploadType=resumable يتطلب نطاق youtube.upload ومراجعة Google للتطبيق قبل الاستخدام الإنتاجي (unverified apps محصورة بقنوات test users).',
  },
  {
    key: 'push_notifications',
    label: 'إشعارات Push (PubSubHubbub)',
    status: 'REQUIRES_REVIEW',
    evidence: 'اشتراك PubSubHubbub على topic القناة مع callback URL عام، وتوقيع X-Hub-Signature (HMAC-SHA1) على الجسم الخام؛ التسجيل إجراء خارجي.',
  },
]);

export function youtubeCapabilityStatus(key: string): YouTubeCapabilityStatus | null {
  const row = YOUTUBE_CAPABILITY_MATRIX.find((r) => r.key === key);
  return row ? row.status : null;
}

export function youtubeCapabilitySupported(key: string): boolean {
  return youtubeCapabilityStatus(key) === 'SUPPORTED';
}

export function youtubeCapabilityNeedsAudit(key: string): boolean {
  const s = youtubeCapabilityStatus(key);
  return s === 'REQUIRES_AUDIT' || s === 'REQUIRES_REVIEW';
}

// ---------------------------------------------------------------------------
// PHASE 3 — النطاقات الرسمية (لا نطاق بلا استدعاء حقيقي)
// ---------------------------------------------------------------------------

/**
 * النطاقات الرسمية التي تغطّي القدرات المنفّذة فعلاً:
 * - `youtube.readonly`: الهوية + القناة + قوائم التشغيل + الفيديوهات + الإحصاءات.
 * - `youtube.force-ssl`: قراءة التعليقات والرد عليها (كتابة) — مطلوب لـcommentThreads/comments.
 *   ملاحظة: القراءة المجرّدة للتعليقات تتيحها `youtube.readonly`، لكن الرد (كتابة)
 *   يحتاج `force-ssl`، فنطلبهما معاً لأن الموصل ينفّذ الرد فعلاً.
 */
export const YOUTUBE_REQUIRED_SCOPES: readonly string[] = Object.freeze([
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
]);

/**
 * النطاقات المعلومة عبر الواجهة الرسمية. أي اسم خارجها في تجاوز البيئة يُهمَل،
 * ولا يُسقط نطاق تحتاجه قدرة منفّذة، فلا يُطلب نطاق بلا استدعاء ولا تُسقط قدرة.
 */
export const YOUTUBE_KNOWN_SCOPES: readonly string[] = Object.freeze([
  ...YOUTUBE_REQUIRED_SCOPES,
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
]);

/** يُبقي النطاقات المطلوبة دائماً، ويضيف أي نطاق رسمي معلوم مطلوب صراحةً. */
export function resolveYouTubeScopes(requested?: readonly string[]): string[] {
  const known = new Set(YOUTUBE_KNOWN_SCOPES);
  const extra = (requested || [])
    .map((s) => String(s).trim())
    .filter((s) => known.has(s));
  return [...new Set<string>([...YOUTUBE_REQUIRED_SCOPES, ...extra])];
}

/** هل هذه إضافة إلى النطاقات المطلوبة (لتُعلن بوضوح في التشخيص)؟ */
export function youtubeExtraScopes(requested?: readonly string[]): string[] {
  const required = new Set(YOUTUBE_REQUIRED_SCOPES);
  return resolveYouTubeScopes(requested).filter((s) => !required.has(s));
}

/**
 * صيغة معرّف عميل Google: ينتهي بـ`.apps.googleusercontent.com` وطوله معقول.
 * مسافة/سطر زائد أو معرّف من نوع آخر يُرفض محلياً قبل إرسال المالك إلى Google.
 */
export function isPlausibleYouTubeClientId(value: unknown): boolean {
  const v = String(value ?? '');
  if (!v || v !== v.trim()) return false;
  if (v.length < 16 || v.length > 200) return false;
  return v.endsWith(YOUTUBE_CLIENT_ID_SUFFIX) && /^[A-Za-z0-9._-]+$/.test(v);
}

/** إخفاء قيمة سرّية للعرض التشخيصي (أول 4 وآخر 4 فقط). */
export function maskSecretValue(value: unknown): string {
  const v = String(value ?? '');
  if (v.length <= 8) return v ? '••••' : '';
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

/** بصمة قصيرة للمقارنة (SHA-256 مقتطعة) — لا تكشف القيمة وتُثبت التطابق. */
export function fingerprintValue(value: unknown): string {
  const v = String(value ?? '');
  if (!v) return '';
  return crypto.createHash('sha256').update(v).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// PHASE 4 — وحدات الحصة (Quota) وتصنيف الأخطاء
// ---------------------------------------------------------------------------

/** الحدّ اليومي الافتراضي لوحدات YouTube Data API v3 (معلوم وموثّق). */
export const YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS = 10_000;

/** تكلفة وحدات الحصة لكل نوع استدعاء معلن رسمياً. */
export const YOUTUBE_QUOTA_COST: Readonly<Record<string, number>> = Object.freeze({
  channels_list: 1,
  playlists_list: 1,
  videos_list: 1,
  commentThreads_list: 1,
  comments_list: 1,
  comments_insert: 50,
  search_list: 100,
  videos_insert: 1600,
});

/** تكلفة استدعاء واحدة بالوحدات (0 إن كان غير معلوم — لا تخمين). */
export function quotaUnitsFor(operation: string): number {
  return YOUTUBE_QUOTA_COST[operation] ?? 0;
}

export type YouTubeErrorKind =
  | 'auth_error'
  | 'quota_exceeded'
  | 'rate_limit'
  | 'permission_denied'
  | 'not_found'
  | 'invalid_request'
  | 'provider_error'
  | 'unknown';

export interface YouTubeErrorClassification {
  kind: YouTubeErrorKind;
  /** رمز HTTP إن وُجد. */
  httpStatus: number | null;
  /** سبب Google الرسمي (reason) إن وُجد — لا يُعاد أي سرّ. */
  reason: string | null;
  /** رسالة المزود مقتطعة (بلا سرّ). */
  message: string | null;
  /** هل يستحق إعادة المحاولة؟ (quota/rate لا تُعاد فوراً في نفس اليوم). */
  retryable: boolean;
  /** هل يلزم إعادة الربط (رمز مرفوض/مُبطل)؟ */
  requiresReauth: boolean;
}

/** يستخرج رمز خطأ Google الرسمي من جسم الاستجابة (بلا سرّ). */
export function parseGoogleErrorReason(body: any): string | null {
  const errors = body?.error?.errors;
  if (Array.isArray(errors) && errors.length && errors[0]?.reason) return String(errors[0].reason);
  if (typeof body?.error === 'string') return String(body.error);
  return null;
}

/**
 * تصنيف خطأ YouTube/Google. القاعدة: `quotaExceeded` و`rateLimitExceeded` فئتان
 * مستقلتان عن العطل العام، و`invalid_grant`/401 يعني إعادة ربط لا عطلاً عارضاً.
 */
export function classifyYouTubeError(input: { status?: number | null; body?: any; networkError?: boolean }): YouTubeErrorClassification {
  const status = typeof input.status === 'number' ? input.status : null;
  const reason = parseGoogleErrorReason(input.body);
  const message = typeof input.body?.error === 'object' && input.body?.error?.message
    ? String(input.body.error.message).slice(0, 300)
    : (typeof input.body?.error === 'string' ? String(input.body.error).slice(0, 300) : null);

  if (input.networkError) {
    return { kind: 'provider_error', httpStatus: status, reason, message: message || 'تعذّر الوصول إلى YouTube (شبكة).', retryable: true, requiresReauth: false };
  }

  // حصة المزود اليومية منفصلة تماماً عن معدّل الطلبات اللحظي.
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
    return { kind: 'quota_exceeded', httpStatus: status, reason, message, retryable: false, requiresReauth: false };
  }
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || status === 429) {
    return { kind: 'rate_limit', httpStatus: status, reason, message, retryable: true, requiresReauth: false };
  }
  if (reason === 'invalid_grant' || status === 401) {
    return { kind: 'auth_error', httpStatus: status, reason, message, retryable: false, requiresReauth: true };
  }
  if (reason === 'insufficientPermissions' || reason === 'forbidden' || status === 403) {
    return { kind: 'permission_denied', httpStatus: status, reason, message, retryable: false, requiresReauth: false };
  }
  if (status === 404 || reason === 'notFound') {
    return { kind: 'not_found', httpStatus: status, reason, message, retryable: false, requiresReauth: false };
  }
  if (status === 400 || reason === 'invalid' || reason === 'badRequest') {
    return { kind: 'invalid_request', httpStatus: status, reason, message, retryable: false, requiresReauth: false };
  }
  if (status !== null && status >= 500) {
    return { kind: 'provider_error', httpStatus: status, reason, message, retryable: true, requiresReauth: false };
  }
  return { kind: status === null ? 'unknown' : 'provider_error', httpStatus: status, reason, message, retryable: false, requiresReauth: false };
}

/** وصف عربي موجز لفئة الخطأ (للتوجيه في الواجهة بلا تخمين). */
export function describeYouTubeErrorKind(kind: YouTubeErrorKind): string {
  switch (kind) {
    case 'auth_error': return 'رمز YouTube مرفوض/منتهٍ؛ يلزم إعادة الربط.';
    case 'quota_exceeded': return 'استُهلكت حصة YouTube Data API اليومية (quota). تُعاد المحاولة بعد تجديد الحصة أو زيادة الحدّ لدى Google.';
    case 'rate_limit': return 'تجاوز معدّل الطلبات اللحظي؛ يُعاد المحاولة بعد فترة قصيرة.';
    case 'permission_denied': return 'الصلاحيات غير كافية لهذه العملية (نطاق ناقص أو غير مُفعَّل).';
    case 'not_found': return 'العنصر غير موجود (فيديو/تعليق/قناة).';
    case 'invalid_request': return 'طلب غير صالح لدى YouTube (وسيط مفقود أو خاطئ).';
    case 'provider_error': return 'عطل عارض من YouTube؛ يُعاد المحاولة.';
    default: return 'سبب غير محدّد من YouTube.';
  }
}

// ---------------------------------------------------------------------------
// PHASE 5 — تحليل الاستجابات (حتمي، بلا شبكة)
// ---------------------------------------------------------------------------

export interface YouTubeTokenData {
  accessToken: string | null;
  refreshToken: string | null;
  scope: string[];
  expiresIn: number | null;
  tokenType: string | null;
  error: string | null;
  errorDescription: string | null;
}

export function parseYouTubeTokenResponse(body: any): YouTubeTokenData {
  const raw = body && typeof body === 'object' ? body : {};
  return {
    accessToken: typeof raw.access_token === 'string' && raw.access_token.trim() ? raw.access_token.trim() : null,
    refreshToken: typeof raw.refresh_token === 'string' && raw.refresh_token.trim() ? raw.refresh_token.trim() : null,
    scope: typeof raw.scope === 'string' ? raw.scope.split(/\s+/).map((s: string) => s.trim()).filter(Boolean) : [],
    expiresIn: Number.isFinite(Number(raw.expires_in)) ? Number(raw.expires_in) : null,
    tokenType: typeof raw.token_type === 'string' ? raw.token_type : null,
    error: typeof raw.error === 'string' ? raw.error : null,
    errorDescription: typeof raw.error_description === 'string' ? String(raw.error_description).slice(0, 300) : null,
  };
}

export interface YouTubeChannelIdentity {
  channelId: string;
  title: string | null;
  description: string | null;
  customUrl: string | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  /** إحصاءات القناة (أرقام نصية كما تعيدها Google — تُحوَّل عند العرض). */
  statistics: { viewCount: number | null; subscriberCount: number | null; videoCount: number | null; hiddenSubscriberCount: boolean };
  uploadsPlaylistId: string | null;
}

/** يحلّل قناة من استجابة channels.list (عنصر واحد). */
export function parseYouTubeChannel(item: any): YouTubeChannelIdentity | null {
  if (!item || typeof item !== 'object' || !item.id) return null;
  const sn = item.snippet || {};
  const st = item.statistics || {};
  const num = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  return {
    channelId: String(item.id),
    title: typeof sn.title === 'string' ? sn.title : null,
    description: typeof sn.description === 'string' ? sn.description.slice(0, 5000) : null,
    customUrl: typeof sn.customUrl === 'string' ? sn.customUrl : null,
    publishedAt: typeof sn.publishedAt === 'string' ? sn.publishedAt : null,
    thumbnailUrl: sn.thumbnails?.default?.url ? String(sn.thumbnails.default.url) : null,
    statistics: {
      viewCount: num(st.viewCount),
      subscriberCount: num(st.subscriberCount),
      videoCount: num(st.videoCount),
      hiddenSubscriberCount: st.hiddenSubscriberCount === true,
    },
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ? String(item.contentDetails.relatedPlaylists.uploads) : null,
  };
}

export interface YouTubeVideoSummary {
  videoId: string;
  title: string | null;
  description: string | null;
  publishedAt: string | null;
  channelId: string | null;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  statistics: { viewCount: number | null; likeCount: number | null; commentCount: number | null; favoriteCount: number | null };
  duration: string | null;
}

export function parseYouTubeVideo(item: any): YouTubeVideoSummary | null {
  if (!item || typeof item !== 'object' || !item.id) return null;
  const sn = item.snippet || {};
  const st = item.statistics || {};
  const num = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const id = typeof item.id === 'object' ? item.id.videoId : item.id;
  if (!id) return null;
  return {
    videoId: String(id),
    title: typeof sn.title === 'string' ? sn.title : null,
    description: typeof sn.description === 'string' ? sn.description.slice(0, 1000) : null,
    publishedAt: typeof sn.publishedAt === 'string' ? sn.publishedAt : null,
    channelId: typeof sn.channelId === 'string' ? sn.channelId : null,
    channelTitle: typeof sn.channelTitle === 'string' ? sn.channelTitle : null,
    thumbnailUrl: sn.thumbnails?.default?.url ? String(sn.thumbnails.default.url) : null,
    statistics: {
      viewCount: num(st.viewCount),
      likeCount: num(st.likeCount),
      commentCount: num(st.commentCount),
      favoriteCount: num(st.favoriteCount),
    },
    duration: item.contentDetails?.duration ? String(item.contentDetails.duration) : null,
  };
}

export interface YouTubePlaylistSummary {
  playlistId: string;
  title: string | null;
  description: string | null;
  itemCount: number | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
}

export function parseYouTubePlaylist(item: any): YouTubePlaylistSummary | null {
  if (!item || typeof item !== 'object' || !item.id) return null;
  const sn = item.snippet || {};
  const cd = item.contentDetails || {};
  return {
    playlistId: String(item.id),
    title: typeof sn.title === 'string' ? sn.title : null,
    description: typeof sn.description === 'string' ? sn.description.slice(0, 1000) : null,
    itemCount: Number.isFinite(Number(cd.itemCount)) ? Number(cd.itemCount) : null,
    publishedAt: typeof sn.publishedAt === 'string' ? sn.publishedAt : null,
    thumbnailUrl: sn.thumbnails?.default?.url ? String(sn.thumbnails.default.url) : null,
  };
}

export interface YouTubeComment {
  /** معرّف التعليق لدى YouTube — أساس منع الرد المكرر. */
  commentId: string;
  /** الفيديو الأم. */
  videoId: string | null;
  /** معرّف التعليق الأب (للردود). */
  parentId: string | null;
  authorName: string | null;
  authorChannelId: string | null;
  text: string;
  likeCount: number | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

/** يحلّل تعليقاً واحداً من شكل comments/commentThreads (topLevel أو reply). */
export function parseYouTubeComment(raw: any): YouTubeComment | null {
  const sn = raw?.snippet || raw;
  const commentId = raw?.id ?? sn?.id;
  if (!commentId) return null;
  const text = String(sn?.textOriginal ?? sn?.textDisplay ?? '').trim();
  if (!text) return null;
  return {
    commentId: String(commentId),
    videoId: sn?.videoId ? String(sn.videoId) : null,
    parentId: sn?.parentId ? String(sn.parentId) : null,
    authorName: sn?.authorDisplayName ? String(sn.authorDisplayName).slice(0, 200) : null,
    authorChannelId: sn?.authorChannelId?.value ? String(sn.authorChannelId.value) : null,
    text: text.slice(0, 8000),
    likeCount: Number.isFinite(Number(sn?.likeCount)) ? Number(sn.likeCount) : null,
    publishedAt: sn?.publishedAt ? String(sn.publishedAt) : null,
    updatedAt: sn?.updatedAt ? String(sn.updatedAt) : null,
  };
}

/**
 * يحلّل commentThreads.list إلى تعليقات مسطّحة: التعليق الأعلى ثم ردوده.
 * تُغطّي الصفحة الواحدة ما يعيده YouTube بالفعل، فلا يُخترع أي تعليق.
 */
export function parseYouTubeCommentThreads(body: any): YouTubeComment[] {
  const items = Array.isArray(body?.items) ? body.items : [];
  const out: YouTubeComment[] = [];
  for (const thread of items) {
    const top = parseYouTubeComment(thread?.snippet?.topLevelComment || thread);
    if (top) out.push(top);
    const replies = thread?.replies?.comments;
    if (Array.isArray(replies)) {
      for (const r of replies) {
        const reply = parseYouTubeComment(r);
        if (reply) out.push(reply);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// PHASE 6 — بناء الطلبات (حتمي)
// ---------------------------------------------------------------------------

/** يبني رابط تفويض Google القياسي (client_id + scope بمسافة + offline + consent). */
export function buildYouTubeAuthorizationUrl(input: { clientId: string; redirectUri: string; scopes: readonly string[]; state: string; promptConsent?: boolean }): string {
  const u = new URL(YOUTUBE_AUTH_ENDPOINT);
  u.searchParams.set('client_id', input.clientId);
  u.searchParams.set('redirect_uri', input.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', input.scopes.join(' '));
  u.searchParams.set('state', input.state);
  // طلب refresh token: بدونه ينتهي الاتصال صامتاً بعد ساعة. prompt=consent يضمن
  // إعادة إصدار refresh token عند إعادة الربط.
  u.searchParams.set('access_type', 'offline');
  if (input.promptConsent !== false) u.searchParams.set('prompt', 'consent');
  // تضمين النطاقات الممنوحة سابقاً فيمنع إسقاط صلاحية مُنحت فعلاً.
  u.searchParams.set('include_granted_scopes', 'true');
  return u.toString();
}

/** يبني جسم تبادل/تجديد الرمز (application/x-www-form-urlencoded). */
export function buildYouTubeTokenExchangeBody(input: { clientId: string; clientSecret: string; code: string; redirectUri: string }): URLSearchParams {
  const body = new URLSearchParams();
  body.set('client_id', input.clientId);
  body.set('client_secret', input.clientSecret);
  body.set('code', input.code);
  body.set('grant_type', 'authorization_code');
  body.set('redirect_uri', input.redirectUri);
  return body;
}

export function buildYouTubeRefreshBody(input: { clientId: string; clientSecret: string; refreshToken: string }): URLSearchParams {
  const body = new URLSearchParams();
  body.set('client_id', input.clientId);
  body.set('client_secret', input.clientSecret);
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', input.refreshToken);
  return body;
}

/** يبني جسم الرد على تعليق: parentId + النص الأصلي (textOriginal). */
export function buildCommentReplyBody(input: { parentId: string; text: string }): Record<string, unknown> {
  return { snippet: { parentId: input.parentId, textOriginal: String(input.text).slice(0, 10000) } };
}

/**
 * بيانات رفع فيديو (resumable). تُبنى هنا حتمياً فلا تُرسل حقول مخترعة:
 * العنوان إلزامي، والخصوصية (`privacyStatus`) تُمرَّر صراحةً.
 */
export function buildVideoUploadMetadata(input: { title: string; description?: string; tags?: string[]; privacyStatus?: string; categoryId?: string; madeForKids?: boolean }): Record<string, unknown> {
  const allowed = new Set(['public', 'private', 'unlisted']);
  const privacy = allowed.has(String(input.privacyStatus)) ? String(input.privacyStatus) : 'private';
  return {
    snippet: {
      title: String(input.title).slice(0, 100),
      description: String(input.description || '').slice(0, 5000),
      tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t)).slice(0, 30) : undefined,
      categoryId: input.categoryId ? String(input.categoryId) : '22',
    },
    status: {
      privacyStatus: privacy,
      // الإعلان الصريح إلزامي لدى YouTube؛ الافتراضي الآمن: ليس للأطفال.
      selfDeclaredMadeForKids: input.madeForKids === true,
    },
  };
}

// ---------------------------------------------------------------------------
// PHASE 7 — تحليل إشعارات PubSubHubbub (حتمي)
// ---------------------------------------------------------------------------

export interface YouTubePushNotification {
  videoId: string;
  channelId: string;
  title: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

/**
 * يحلّل تغذية Atom التي يدفعها PubSubHubbub عند نشر/تحديث فيديو.
 * المصدر الحقيقي هو `entry` بداخل `<feed>`؛ نقرأ الحقول الضرورية فقط.
 * أي شكل غير معروف يُعاد null (يُقبل ويُتجاهل بلا خطأ).
 */
export function parseYouTubePushNotification(body: any): YouTubePushNotification | null {
  const entry = body?.feed?.entry || body?.entry;
  if (!entry || typeof entry !== 'object') return null;
  const videoId = entry['yt:videoId'] || entry.videoId;
  const channelId = entry['yt:channelId'] || entry.channelId;
  if (!videoId || !channelId) return null;
  const title = typeof entry.title === 'string' ? entry.title : (entry.title?.$t ? String(entry.title.$t) : null);
  return {
    videoId: String(videoId),
    channelId: String(channelId),
    title,
    publishedAt: typeof entry.published === 'string' ? entry.published : null,
    updatedAt: typeof entry.updated === 'string' ? entry.updated : null,
  };
}

/** معرّف الحدث الخارجي الموحّد لإشعار فيديو — أساس منع التكرار. */
export function youtubePushExternalId(videoId: string, updatedAt?: string | null): string {
  return `yt:${videoId}:${updatedAt || 'na'}`;
}

// ---------------------------------------------------------------------------
// PHASE 8 — عميل YouTube (شبكة فقط، بلا منطق قرار)
// ---------------------------------------------------------------------------

export interface YouTubeResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
  /** فئة الخطأ الحقيقية — تُستخدم في الردود بلا تخمين. */
  errorKind?: YouTubeErrorKind;
  httpStatus?: number | null;
  retryable?: boolean;
  requiresReauth?: boolean;
}

export type YouTubeFetch = (url: string, init: { method: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text?: () => Promise<string> }>;

export class YouTubeClient {
  constructor(private readonly fetchImpl: YouTubeFetch, private readonly baseOverride?: string) {}

  private async request<T>(url: string, init: { method: string; headers?: Record<string, string>; body?: string }, map: (body: any) => T | null, fallback: string): Promise<YouTubeResult<T>> {
    let res: { ok: boolean; status: number; json: () => Promise<any> };
    try {
      res = await this.fetchImpl(url, init);
    } catch (e: any) {
      const c = classifyYouTubeError({ networkError: true, status: null });
      return { ok: false, data: null, error: c.message || fallback, errorKind: c.kind, httpStatus: null, retryable: true, requiresReauth: false };
    }
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      const c = classifyYouTubeError({ status: res.status, body });
      return { ok: false, data: null, error: c.message || describeYouTubeErrorKind(c.kind) || fallback, errorKind: c.kind, httpStatus: c.httpStatus, retryable: c.retryable, requiresReauth: c.requiresReauth };
    }
    const data = map(body);
    if (data === null) return { ok: false, data: null, error: fallback, errorKind: 'provider_error', httpStatus: res.status, retryable: false, requiresReauth: false };
    return { ok: true, data, errorKind: undefined, httpStatus: res.status, retryable: false, requiresReauth: false };
  }

  /** يثبت هوية القناة (mine=true) — لا اتصال موثق بلا هذه الاستجابة. */
  async fetchMyChannel(accessToken: string): Promise<YouTubeResult<YouTubeChannelIdentity>> {
    const url = youtubeApiUrl('/channels?part=snippet,statistics,contentDetails&mine=true', this.baseOverride);
    return this.request(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } }, (b) => (Array.isArray(b?.items) && b.items[0] ? parseYouTubeChannel(b.items[0]) : null), 'لم يُعد YouTube أي قناة لهذا الحساب.');
  }

  /** يجلب قناة بمعرّفها (يستعمل لاحقاً لتحديث الإحصاءات). */
  async fetchChannelById(accessToken: string, channelId: string): Promise<YouTubeResult<YouTubeChannelIdentity>> {
    const url = youtubeApiUrl(`/channels?part=snippet,statistics,contentDetails&id=${encodeURIComponent(channelId)}`, this.baseOverride);
    return this.request(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } }, (b) => (Array.isArray(b?.items) && b.items[0] ? parseYouTubeChannel(b.items[0]) : null), 'القناة غير موجودة.');
  }

  /** يجلب قوائم تشغيل القناة. */
  async listPlaylists(accessToken: string, channelId: string, maxResults = 25): Promise<YouTubeResult<YouTubePlaylistSummary[]>> {
    const url = youtubeApiUrl(`/playlists?part=snippet,contentDetails&channelId=${encodeURIComponent(channelId)}&maxResults=${Math.min(50, Math.max(1, maxResults))}`, this.baseOverride);
    return this.request(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } }, (b) => (Array.isArray(b?.items) ? b.items.map(parseYouTubePlaylist).filter(Boolean) as YouTubePlaylistSummary[] : []), 'تعذّر جلب قوائم التشغيل.');
  }

  /** يبحث عن فيديوهات القناة (search = 100 وحدة حصة) — يستهلك الحصة فعلاً. */
  async searchChannelVideos(accessToken: string, channelId: string, maxResults = 25): Promise<YouTubeResult<YouTubeVideoSummary[]>> {
    const url = youtubeApiUrl(`/search?part=snippet&channelId=${encodeURIComponent(channelId)}&type=video&order=date&maxResults=${Math.min(50, Math.max(1, maxResults))}`, this.baseOverride);
    return this.request(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } }, (b) => (Array.isArray(b?.items) ? b.items.map(parseYouTubeVideo).filter(Boolean) as YouTubeVideoSummary[] : []), 'تعذّر جلب فيديوهات القناة.');
  }

  /** يجلب بيانات فيديوهات محدّدة بالمعرّفات (1 وحدة لكل نداء). */
  async listVideosByIds(accessToken: string, videoIds: string[]): Promise<YouTubeResult<YouTubeVideoSummary[]>> {
    const ids = videoIds.map((x) => String(x).trim()).filter(Boolean).slice(0, 50);
    if (!ids.length) return { ok: true, data: [], httpStatus: 200 };
    const url = youtubeApiUrl(`/videos?part=snippet,statistics,contentDetails&id=${encodeURIComponent(ids.join(','))}`, this.baseOverride);
    return this.request(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } }, (b) => (Array.isArray(b?.items) ? b.items.map(parseYouTubeVideo).filter(Boolean) as YouTubeVideoSummary[] : []), 'تعذّر جلب بيانات الفيديوهات.');
  }

  /** يقرأ تعليقات فيديو (commentThreads). */
  async listCommentThreads(accessToken: string, videoId: string, maxResults = 50): Promise<YouTubeResult<YouTubeComment[]>> {
    const url = youtubeApiUrl(`/commentThreads?part=snippet,replies&videoId=${encodeURIComponent(videoId)}&maxResults=${Math.min(100, Math.max(1, maxResults))}&textFormat=plainText`, this.baseOverride);
    return this.request(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } }, (b) => parseYouTubeCommentThreads(b), 'تعذّر جلب التعليقات.');
  }

  /** ينشر رداً على تعليق — لا نجاح بلا معرّف تعليق من YouTube. */
  async replyToComment(accessToken: string, parentId: string, text: string): Promise<YouTubeResult<YouTubeComment>> {
    const url = youtubeApiUrl('/comments?part=snippet', this.baseOverride);
    return this.request(url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(buildCommentReplyBody({ parentId, text })) }, (b) => parseYouTubeComment(b), 'لم يُعد YouTube معرّف التعليق للرد.');
  }

  /**
   * يجدّد رمز الوصول عبر refresh_token. لا يُخترع نجاح: إن لم يُعد Google رمزاً
   * صالحاً يُعلن السبب ويُطلب إعادة الربط.
   */
  async refreshAccessToken(input: { clientId: string; clientSecret: string; refreshToken: string }): Promise<YouTubeResult<YouTubeTokenData>> {
    // نقاط Google (token/revoke) تُبنى من YOUTUBE_GOOGLE_BASE لا من baseOverride
    // (الذي يخصّ قاعدة Data API) — فلا تختلط القاعدتان في الاختبار/الإنتاج.
    const url = youtubeTokenUrl();
    return this.request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: buildYouTubeRefreshBody(input).toString() }, (b) => {
      const parsed = parseYouTubeTokenResponse(b);
      return parsed.accessToken ? parsed : null;
    }, 'فشل تجديد رمز YouTube.');
  }

  /** يبادل رمز التفويض برمز وصول (يُستخدم عند العودة من Google). */
  async exchangeCode(input: { clientId: string; clientSecret: string; code: string; redirectUri: string }): Promise<YouTubeResult<YouTubeTokenData>> {
    const url = youtubeTokenUrl();
    return this.request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: buildYouTubeTokenExchangeBody(input).toString() }, (b) => {
      const parsed = parseYouTubeTokenResponse(b);
      return parsed.accessToken ? parsed : null;
    }, 'فشل تبادل رمز YouTube.');
  }

  /** يُبطل الرمز لدى Google (فصل حقيقي). نجاح شبكي كافٍ — لا يُدّعى إبطال لم يحدث. */
  async revokeToken(token: string): Promise<YouTubeResult<boolean>> {
    const url = youtubeRevokeUrl(token);
    try {
      const res = await this.fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      // Google يُعيد 200 عند الإبطال، وقد يُعيد 400 إن كان الرمز مُبطلًا بالفعل.
      return { ok: res.ok, data: res.ok, httpStatus: res.status };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'تعذّر إبطال رمز YouTube').slice(0, 200), errorKind: 'provider_error', retryable: true };
    }
  }
}
