/**
 * موصل TikTok الحقيقي — رابع تكامل اجتماعي خارجي منفّذ بعد Telegram وFacebook
 * وInstagram. مبنيّ على واجهات TikTok for Developers الرسمية فقط.
 *
 * سبب البنية: TikTok يختلف جوهرياً عن Meta. لا رمز صفحة ولا Graph موحّد، بل:
 * - OAuth 2.0 على `www.tiktok.com/v2/auth/authorize/` بمفتاح اسمه `client_key`
 *   (لا client_id)، ورمز على `open.tiktokapis.com/v2/oauth/token/` بصيغة
 *   `application/x-www-form-urlencoded` (لا GET كما في Meta).
 * - هوية الحساب هي `open_id` (وليس معرّفاً رقمياً).
 * - النشر عبر Content Posting API بوضعين رسميين: `DIRECT_POST` و`MEDIA_UPLOAD`
 *   (مسودة إلى صندوق TikTok). كلاهما يحتاج `video.publish`، والوضع المباشر
 *   يبقى محصوراً بـ`SELF_ONLY` قبل اجتياز مراجعة TikTok (audit).
 * - التوقيع على webhooks بنمط مختلف: ترويسة `TikTok-Signature` بصيغة
 *   `t=<timestamp>,s=<hmac>` حيث التوقيع على `timestamp + "." + rawBody`.
 *
 * القاعدة الملزمة: لا يُعلن دعم قدرة لم تُنفَّذ أو لا توفّرها الواجهة الرسمية.
 * التعليقات العامة والرسائل المباشرة **لا توفّرها** واجهة TikTok العامة (المفتوحة
 * للمطوّرين)، فتُعلن `NOT_AVAILABLE_BY_PUBLIC_API` صراحةً ولا تُختلق لها قدرة.
 *
 * كل الأسرار تُمرَّر كوسائط؛ لا تُسجَّل ولا تُعاد. الدوال الحتمية (بناء الطلبات،
 * تصنيف الحمولة، فحص التوقيع) مفصولة عن عميل الشبكة لتُختبر بلا أي مزود.
 */

import crypto from 'node:crypto';

export const TIKTOK_OAUTH_AUTHORIZE_BASE = 'https://www.tiktok.com';
export const TIKTOK_OPEN_API_BASE = 'https://open.tiktokapis.com';
/** مسار التفويض الرسمي (OAuth 2.0) — client_key لا client_id. */
export const TIKTOK_AUTHORIZE_PATH = '/v2/auth/authorize/';
/** ترويسة توقيع webhooks TikTok. */
export const TIKTOK_SIGNATURE_HEADER = 'tiktok-signature';

// ---------------------------------------------------------------------------
// PHASE 1 — مصفوفة القدرات الرسمية (Audit)
// ---------------------------------------------------------------------------

export type TikTokCapabilityStatus =
  | 'SUPPORTED'
  | 'REQUIRES_REVIEW'
  | 'REQUIRES_AUDIT'
  | 'SANDBOX_ONLY'
  | 'NOT_AVAILABLE_BY_PUBLIC_API';

export interface TikTokCapabilityRow {
  /** معرّف القدرة التقني. */
  key: string;
  /** الاسم المعروض. */
  label: string;
  status: TikTokCapabilityStatus;
  /** النطاق الرسمي الذي يغطّيها (إن وُجد). */
  scope?: string;
  /** دليل/ملاحظة رسمية تشرح الحالة. */
  evidence: string;
}

/**
 * مصفوفة القدرات الرسمية لـTikTok، مُشتقة من وثائق TikTok for Developers
 * (Login Kit, Display API, Content Posting API, Webhooks). كل صف يحمل حالته
 * الدقيقة بدل ادعاء دعم غير موجود.
 */
export const TIKTOK_CAPABILITY_MATRIX: readonly TikTokCapabilityRow[] = Object.freeze([
  {
    key: 'login_kit',
    label: 'Login Kit (OAuth 2.0)',
    status: 'SUPPORTED',
    scope: 'user.info.basic',
    evidence: 'Web Login Kit رسمي: /v2/auth/authorize/ + تبادل الرمز على /v2/oauth/token/ (client_key).',
  },
  {
    key: 'user_identity',
    label: 'هوية الحساب (open_id + display_name)',
    status: 'SUPPORTED',
    scope: 'user.info.basic',
    evidence: 'POST /v2/user/info/ يُعيد open_id وdisplay_name وavatar_url.',
  },
  {
    key: 'display_api',
    label: 'Display API (بيانات الفيديوهات)',
    status: 'SUPPORTED',
    scope: 'video.list',
    evidence: 'POST /v2/video/list/ و/v2/video/query/ يُعيدان بيانات الفيديوهات العامة للحساب.',
  },
  {
    key: 'content_posting_draft',
    label: 'رفع كمسودة (MEDIA_UPLOAD → صندوق TikTok)',
    status: 'SUPPORTED',
    scope: 'video.publish',
    evidence: 'Content Posting API: post_mode=MEDIA_UPLOAD يضع المحتوى في صندوق TikTok لإكماله.',
  },
  {
    key: 'content_posting_direct',
    label: 'نشر مباشر (DIRECT_POST)',
    status: 'REQUIRES_AUDIT',
    scope: 'video.publish',
    evidence: 'وثيقة TikTok: كل محتوى من تطبيق غير مُراجَع يبقى SELF_ONLY حتى اجتياز Content Posting audit.',
  },
  {
    key: 'video_publishing',
    label: 'نشر فيديو',
    status: 'REQUIRES_AUDIT',
    scope: 'video.publish',
    evidence: 'POST /v2/post/publish/video/init/ (FILE_UPLOAD أو PULL_FROM_URL) ثم GET /v2/post/publish/status/fetch/.',
  },
  {
    key: 'photo_publishing',
    label: 'نشر صور (Photo Post)',
    status: 'REQUIRES_AUDIT',
    scope: 'video.publish',
    evidence: 'POST /v2/post/publish/content/init/ بـmedia_type=PHOTO (منشور صور/كاروسيل).',
  },
  {
    key: 'creator_info',
    label: 'معلومات الناشر (query creator info)',
    status: 'SUPPORTED',
    scope: 'video.publish',
    evidence: 'POST /v2/post/publish/creator_info/query/ — إلزامي قبل أي نشر مباشر.',
  },
  {
    key: 'post_status',
    label: 'حالة النشر (polling)',
    status: 'SUPPORTED',
    scope: 'video.publish',
    evidence: 'POST /v2/post/publish/status/fetch/ بمفتاح publish_id — يُعلن الحالة النهائية.',
  },
  {
    key: 'analytics',
    label: 'تحليلات الفيديو (views/likes/comments/shares)',
    status: 'SUPPORTED',
    scope: 'video.list',
    evidence: 'Display API يُعيد view_count/like_count/comment_count/share_count للفيديوهات العامة.',
  },
  {
    key: 'webhooks',
    label: 'Webhooks (أحداث التطبيق)',
    status: 'REQUIRES_REVIEW',
    evidence: 'callback URL يُسجَّل في Developer Portal، وتُوقَّع الرسائل بـTikTok-Signature. الأحداث: authorization.removed، video.upload.failed، video.publish.completed.',
  },
  {
    key: 'comments_read',
    label: 'قراءة التعليقات',
    status: 'NOT_AVAILABLE_BY_PUBLIC_API',
    evidence: 'لا واجهة عامة لقراءة تعليقات TikTok. Query Video Comments متاح فقط عبر Research API المحصور بالباحثين المعتمدين.',
  },
  {
    key: 'comments_reply',
    label: 'الرد على التعليقات',
    status: 'NOT_AVAILABLE_BY_PUBLIC_API',
    evidence: 'لا واجهة عامة للرد على تعليقات TikTok. الضبط الوحيد المتاح هو allow_comment عند النشر.',
  },
  {
    key: 'direct_messages_read',
    label: 'قراءة الرسائل المباشرة',
    status: 'NOT_AVAILABLE_BY_PUBLIC_API',
    evidence: 'Business Messaging API محصور بحسابات تجارية معتمدة وبمناطق محدّدة، وليس ضمن واجهة TikTok العامة للمطوّرين.',
  },
  {
    key: 'direct_messages_reply',
    label: 'الرد على الرسائل المباشرة',
    status: 'NOT_AVAILABLE_BY_PUBLIC_API',
    evidence: 'لا واجهة عامة للرسائل المباشرة؛ تحتاج Business Messaging API بموافقة TikTok ومناطق محدّدة.',
  },
]);

/** حالة قدرة واحدة من المصفوفة (أو undefined إن لم تُعرَّف). */
export function tiktokCapabilityStatus(key: string): TikTokCapabilityStatus | null {
  const row = TIKTOK_CAPABILITY_MATRIX.find((r) => r.key === key);
  return row ? row.status : null;
}

/** هل القدرة متاحة للتنفيذ الفعلي الآن (بلا انتظار مراجعة/audit)؟ */
export function tiktokCapabilitySupported(key: string): boolean {
  return tiktokCapabilityStatus(key) === 'SUPPORTED';
}

/** هل تحتاج القدرة مراجعة TikTok قبل التشغيل الكامل؟ */
export function tiktokCapabilityNeedsAudit(key: string): boolean {
  const s = tiktokCapabilityStatus(key);
  return s === 'REQUIRES_AUDIT' || s === 'REQUIRES_REVIEW' || s === 'SANDBOX_ONLY';
}

/**
 * النطاقات المطلوبة — مشتقة من القدرات المنفّذة فعلاً فقط:
 * - user.info.basic  → هوية الحساب (إثبات الاتصال والتحقق).
 * - video.publish    → Content Posting API (نشر مباشر + رفع مسودة + حالة النشر).
 * - video.list       → Display API (بيانات الفيديوهات للتحليلات).
 * لا يُطلب نطاق لا يقابله استدعاء حقيقي في الكود.
 */
export const TIKTOK_REQUIRED_SCOPES: readonly string[] = Object.freeze([
  'user.info.basic',
  'video.publish',
  'video.list',
]);

/**
 * تجاوز اختياري من البيئة (قائمة مفصولة بفواصل). القاعدة الملزمة: لا يُطلب
 * نطاق لا يقابله استدعاء حقيقي، ولا يُسقط نطاق تحتاجه قدرة منفّذة. لذلك:
 *  - أي نطاق غير رسمي في التجاوز يُهمَل.
 *  - النطاقات المطلوبة (المشتقة من القدرات المنفّذة) تُضمّ دائماً.
 */
export function resolveTikTokScopes(requested?: readonly string[]): string[] {
  const known = new Set(TIKTOK_REQUIRED_SCOPES);
  const extra = (requested || [])
    .map((s) => String(s).trim())
    .filter((s) => Boolean(s) && known.has(s));
  return [...new Set<string>([...TIKTOK_REQUIRED_SCOPES, ...extra])];
}

// ---------------------------------------------------------------------------
// القواعد الفعلية للشبكة (قابلة للتجاوز في الاختبار فقط)
// ---------------------------------------------------------------------------

/** القاعدة الفعلية لواجهة TikTok المفتوحة (تُقرأ من TIKTOK_API_BASE في الاختبار فقط). */
export function tiktokApiBase(override?: string): string {
  const base = override || process.env.TIKTOK_API_BASE || TIKTOK_OPEN_API_BASE;
  return base.replace(/\/+$/, '');
}

/** قاعدة التفويض الرسمية (تُقرأ من TIKTOK_OAUTH_BASE في الاختبار فقط). */
export function tiktokAuthorizeBase(override?: string): string {
  const base = override || process.env.TIKTOK_OAUTH_BASE || TIKTOK_OAUTH_AUTHORIZE_BASE;
  return base.replace(/\/+$/, '');
}

/** رابط تبادل/تجديد/إبطال الرمز الرسمي. */
export function tiktokTokenUrl(baseOverride?: string): string {
  return `${tiktokApiBase(baseOverride)}/v2/oauth/token/`;
}

/** يبني رابط واجهة مفتوحة كامل بلا أي سرّ في السجل. */
export function tiktokApiUrl(path: string, baseOverride?: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${tiktokApiBase(baseOverride)}${suffix}`;
}

// ---------------------------------------------------------------------------
// بناء طلبات OAuth (حتمي، بلا شبكة)
// ---------------------------------------------------------------------------

/**
 * جسم تبادل رمز التفويض. TikTok يستخدم `client_key` لا `client_id`، ويقبل
 * `code_verifier` عند تفعيل PKCE.
 */
export function buildTikTokTokenExchangeBody(input: { clientKey: string; clientSecret: string; code: string; redirectUri: string; codeVerifier?: string }): URLSearchParams {
  const body = new URLSearchParams();
  body.set('client_key', input.clientKey);
  body.set('client_secret', input.clientSecret);
  body.set('code', input.code);
  body.set('grant_type', 'authorization_code');
  body.set('redirect_uri', input.redirectUri);
  if (input.codeVerifier) body.set('code_verifier', input.codeVerifier);
  return body;
}

/** جسم تجديد الرمز (refresh_token صالح 365 يوماً). */
export function buildTikTokRefreshBody(input: { clientKey: string; clientSecret: string; refreshToken: string }): URLSearchParams {
  const body = new URLSearchParams();
  body.set('client_key', input.clientKey);
  body.set('client_secret', input.clientSecret);
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', input.refreshToken);
  return body;
}

/** جسم إبطال الرمز عند الفصل (revoke). */
export function buildTikTokRevokeBody(input: { clientKey: string; clientSecret: string; token: string }): URLSearchParams {
  const body = new URLSearchParams();
  body.set('client_key', input.clientKey);
  body.set('client_secret', input.clientSecret);
  body.set('token', input.token);
  return body;
}
/**
 * يتحقق من استجابة تبادل/تجديد الرمز. TikTok يُعيد `open_id` إضافةً إلى الرمز،
 * وهو أساس هوية الحساب. لا يُقبل رمز بلا open_id (لأن إثبات الحساب يلزمه).
 */
export function parseTikTokTokenResponse(token: any): {
  valid: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  openId: string | null;
  scope: string[];
  expiresIn: number | null;
  refreshExpiresIn: number | null;
  reason?: string;
} {
  const empty = { valid: false, accessToken: null, refreshToken: null, openId: null, scope: [] as string[], expiresIn: null, refreshExpiresIn: null };
  if (!token || typeof token !== 'object') return { ...empty, reason: 'استجابة رمز TikTok فارغة أو مشوّهة.' };
  if (token.error) return { ...empty, reason: String(token.error_description || token.error) };
  const accessToken = typeof token.access_token === 'string' && token.access_token.trim() ? token.access_token.trim() : null;
  if (!accessToken) return { ...empty, reason: 'لم يُعد TikTok access_token صالحاً.' };
  const openId = typeof token.open_id === 'string' && token.open_id.trim() ? token.open_id.trim() : null;
  const refreshToken = typeof token.refresh_token === 'string' && token.refresh_token.trim() ? token.refresh_token.trim() : null;
  const scope = typeof token.scope === 'string' ? token.scope.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
  const expiresIn = Number.isFinite(Number(token.expires_in)) ? Number(token.expires_in) : null;
  const refreshExpiresIn = Number.isFinite(Number(token.refresh_expires_in)) ? Number(token.refresh_expires_in) : null;
  return { valid: true, accessToken, refreshToken, openId, scope, expiresIn, refreshExpiresIn };
}

// ---------------------------------------------------------------------------
// Content Posting — بناء الأجسام (حتمي، بلا شبكة)
// ---------------------------------------------------------------------------

/** أوضاع النشر الرسمية. */
export type TikTokPostMode = 'DIRECT_POST' | 'MEDIA_UPLOAD';
/** مستويات الخصوصية الرسمية. */
export type TikTokPrivacyLevel = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';

export const TIKTOK_PRIVACY_LEVELS: readonly TikTokPrivacyLevel[] = Object.freeze([
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
]);

/**
 * يبني جسم تهيئة نشر الفيديو (Direct Post أو رفع مسودة).
 * `source=FILE_UPLOAD` يلزمه chunk_size وtotal_chunk_count، و
 * `source=PULL_FROM_URL` يلزمه video_url عام.
 */
export function buildVideoPostBody(input: {
  postMode: TikTokPostMode;
  title?: string;
  privacyLevel?: TikTokPrivacyLevel;
  source: 'FILE_UPLOAD' | 'PULL_FROM_URL';
  videoUrl?: string;
  fileSize?: number;
  chunkSize?: number;
  totalChunkCount?: number;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  isAigc?: boolean;
}): Record<string, unknown> {
  const postInfo: Record<string, unknown> = {
    title: (input.title || '').slice(0, 2200),
    privacy_level: input.privacyLevel || 'SELF_ONLY',
    disable_comment: Boolean(input.disableComment),
    disable_duet: Boolean(input.disableDuet),
    disable_stitch: Boolean(input.disableStitch),
    // is_aigc حقل رسمي في Content Posting API: يُوسَم المحتوى المولَّد بالذكاء
    // الاصطناعي. يُرسَل فقط عند التصريح به فلا نُوسم محتوى المعرض خطأً.
    is_aigc: Boolean(input.isAigc),
  };
  const sourceInfo: Record<string, unknown> = { source: input.source };
  if (input.source === 'PULL_FROM_URL') {
    sourceInfo.video_url = input.videoUrl || '';
  } else {
    sourceInfo.video_size = input.fileSize ?? 0;
    sourceInfo.chunk_size = input.chunkSize ?? 0;
    sourceInfo.total_chunk_count = input.totalChunkCount ?? 0;
  }
  return { post_info: postInfo, source_info: sourceInfo, post_mode: input.postMode };
}

/** يبني جسم تهيئة نشر الصور (PHOTO) — صور متعددة = كاروسيل. */
export function buildPhotoPostBody(input: {
  postMode: TikTokPostMode;
  title?: string;
  privacyLevel?: TikTokPrivacyLevel;
  photoUrls: string[];
  photoCoverIndex?: number;
  disableComment?: boolean;
  isAigc?: boolean;
}): Record<string, unknown> {
  const postInfo: Record<string, unknown> = {
    title: (input.title || '').slice(0, 90),
    privacy_level: input.privacyLevel || 'SELF_ONLY',
    disable_comment: Boolean(input.disableComment),
    is_aigc: Boolean(input.isAigc),
  };
  return {
    media_type: 'PHOTO',
    post_mode: input.postMode,
    post_info: postInfo,
    source_info: { source: 'PULL_FROM_URL', photo_cover_index: input.photoCoverIndex ?? 0, photo_images: input.photoUrls },
  };
}

/** جسم استعلام حالة النشر. */
export function buildPublishStatusBody(publishId: string): Record<string, unknown> {
  return { publish_id: publishId };
}

/**
 * تصنيف حالة النشر من استجابة TikTok. لا يُعتبر المنشور مُسلَّماً إلا بحالة
 * `PUBLISH_COMPLETE` مع معرّف نشر عام (`publicaly_available_post_id`) أو نجاح
 * صريح. أي حالة أخرى تُعلن كما هي بلا ادعاء تسليم.
 */
export function classifyPublishStatus(input: { status?: string; failReason?: string; publiclyAvailablePostIds?: Array<string | number> }): {
  state: 'pending' | 'processing' | 'delivered' | 'failed';
  delivered: boolean;
  providerPostId: string | null;
  detail: string;
} {
  const status = String(input.status || '').toUpperCase();
  const ids = (input.publiclyAvailablePostIds || []).map((x) => String(x)).filter(Boolean);
  if (status === 'PUBLISH_COMPLETE') {
    return { state: 'delivered', delivered: true, providerPostId: ids[0] || null, detail: 'أكمل TikTok النشر وأعلن الحالة PUBLISH_COMPLETE.' };
  }
  if (status === 'FAILED') {
    return { state: 'failed', delivered: false, providerPostId: null, detail: input.failReason ? `فشل النشر لدى TikTok: ${input.failReason}` : 'فشل النشر لدى TikTok.' };
  }
  if (status === 'PROCESSING_UPLOAD' || status === 'PROCESSING_DOWNLOAD') {
    return { state: 'processing', delivered: false, providerPostId: null, detail: 'TikTok ما زال يعالج المحتوى.' };
  }
  return { state: 'pending', delivered: false, providerPostId: null, detail: 'حالة النشر لم تُحسم بعد؛ لا يُعلن أي تسليم.' };
}

// ---------------------------------------------------------------------------
// Webhooks — فحص التوقيع (نمط TikTok) + تطبيع الحدث
// ---------------------------------------------------------------------------

/**
 * يحلل ترويسة `TikTok-Signature` بصيغة `t=<ts>,s=<sig>`. لا يحتفظ بأي قيمة
 * سرّية ولا يطبع الترويسة.
 */
export function parseTikTokSignatureHeader(header: string | null | undefined): { timestamp: string | null; signature: string | null } {
  const raw = String(header || '');
  const out: { timestamp: string | null; signature: string | null } = { timestamp: null, signature: null };
  for (const part of raw.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const prefix = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (prefix === 't') out.timestamp = value;
    if (prefix === 's') out.signature = value;
  }
  return out;
}

/**
 * يتحقق من توقيع TikTok: `signed_payload = timestamp + "." + rawBody`، والتوقيع
 * هو HMAC-SHA256 بمفتاح `client_secret`. يُقارن بزمن ثابت. رفض صريح عند غياب
 * الترويسة/السرّ أو عدم التطابق.
 *
 * ملاحظة: هذا النمط مختلف عن Meta (توقيع مباشر على الجسم بترويسة `X-Hub-Signature-256`)،
 * لذا لا يُعاد استخدام `hmacSignatureVerifier` كما هي.
 */
export function verifyTikTokSignature(input: { header: string | null | undefined; rawBody: string; clientSecret: string }): { ok: boolean; reason?: string } {
  if (!input.clientSecret) return { ok: false, reason: 'سرّ توقيع TikTok (client_secret) غير مضبوط؛ رُفض الحدث لحماية النظام.' };
  const { timestamp, signature } = parseTikTokSignatureHeader(input.header);
  if (!timestamp || !signature) return { ok: false, reason: 'ترويسة TikTok-Signature غائبة أو غير مكتملة؛ الحدث غير موثوق.' };
  const signedPayload = `${timestamp}.${input.rawBody}`;
  const expected = crypto.createHmac('sha256', input.clientSecret).update(signedPayload, 'utf8').digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || a.length === 0 || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'توقيع حدث TikTok غير مطابق؛ الحدث غير موثوق.' };
  }
  return { ok: true };
}

/** أسماء أحداث TikTok الرسمية المدعومة. */
export const TIKTOK_WEBHOOK_EVENTS: readonly string[] = Object.freeze([
  'authorization.removed',
  'video.upload.failed',
  'video.publish.completed',
]);

export interface TikTokWebhookEvent {
  event: string;
  /** معرّف الحساب صاحب الحدث (open_id). */
  userOpenId: string | null;
  /** وقت الحدث (epoch ثوانٍ → ISO). */
  createdAt: string | null;
  /** محتوى الحدث (نص JSON مُسلسَل من TikTok) — يُحلَّل بلا كسر عند التشوّه. */
  content: Record<string, unknown>;
  /** معرّف فريد للحدث (لمنع التكرار). */
  externalId: string;
  /** هل الحدث مدعوم ومفهوم الشكل؟ */
  supported: boolean;
}

/**
 * يطبّع حمولة webhook TikTok. الأحداث الرسمية الثلاثة مدعومة، وأي حدث آخر
 * يُعاد بـ`supported=false` بدل اعتباره معروفاً (لا اختراع تعليقات/رسائل).
 */
export function parseTikTokWebhook(payload: any): { event: TikTokWebhookEvent | null; reason?: string } {
  if (!payload || typeof payload !== 'object') return { event: null, reason: 'حمولة webhook غير صالحة.' };
  const name = typeof payload.event === 'string' ? payload.event : '';
  if (!name) return { event: null, reason: 'حدث بلا اسم؛ غير معروف.' };
  let content: Record<string, unknown> = {};
  if (typeof payload.content === 'string' && payload.content.trim()) {
    try { const parsed = JSON.parse(payload.content); content = parsed && typeof parsed === 'object' ? parsed : {}; } catch { content = {}; }
  } else if (payload.content && typeof payload.content === 'object') {
    content = payload.content;
  }
  const userOpenId = typeof payload.user_openid === 'string' ? payload.user_openid : null;
  const createTime = Number(payload.create_time);
  const createdAt = Number.isFinite(createTime) && createTime > 0 ? new Date(createTime * 1000).toISOString() : null;
  // معرّف فريد لمنع التكرار: الاسم + الحساب + الوقت + أي معرّف داخلي متاح.
  const inner = String((content as any)?.share_id || (content as any)?.publish_id || (content as any)?.video_id || '');
  const externalId = `tiktok:${name}:${userOpenId || '-'}:${Number.isFinite(createTime) ? createTime : '-'}:${inner || '-'}`;
  return {
    event: {
      event: name,
      userOpenId,
      createdAt,
      content,
      externalId,
      supported: TIKTOK_WEBHOOK_EVENTS.includes(name),
    },
  };
}

/**
 * كل استدعاءات TikTok المفتوحة (Content Posting / Display) تستخدم POST مع
 * `Authorization: Bearer`. هذه الدالة تبني الترويسات فقط بلا كشف الرمز.
 */
export function tiktokAuthHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' };
}

/**
 * الحد الأدنى الرسمي للتحقق من معرّف تطبيق TikTok: `client_key` معرّف نصي
 * (أحرف/أرقام) بلا مسافات. أي مسافة أو سطر زائد ينتج رفضاً بلا سبب ظاهر.
 */
export function isPlausibleTikTokClientKey(value: unknown): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(value);
}

// ---------------------------------------------------------------------------
// عميل TikTok Open API
// ---------------------------------------------------------------------------

export type TikTokFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export interface TikTokResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
  /** رمز خطأ TikTok الرسمي إن وُجد (بلا أي سرّ). */
  code?: string | null;
}

/** رسالة خطأ TikTok المُطبَّعة (error_description ثم message ثم code). */
function tiktokError(data: any, fallback: string): string {
  return String(data?.error_description || data?.message || data?.error?.message || data?.error?.code || data?.error || fallback);
}

/** رمز خطأ TikTok الرسمي من أشكال الاستجابة المختلفة. */
function tiktokErrorCode(data: any): string | null {
  const code = data?.error?.code ?? data?.error_code ?? (typeof data?.error === 'string' ? data.error : null);
  return code && String(code) !== 'ok' ? String(code) : null;
}

export interface TikTokAccountIdentity {
  openId: string;
  displayName: string | null;
  avatarUrl: string | null;
  unionId: string | null;
}

export interface TikTokCreatorInfo {
  nickname: string | null;
  username: string | null;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number | null;
}

export class TikTokClient {
  constructor(
    private readonly fetchImpl: TikTokFetch,
    private readonly baseUrl?: string,
  ) {}

  /** يبادل رمز التفويض برمز وصول + refresh token + open_id. */
  async exchangeCode(input: { clientKey: string; clientSecret: string; code: string; redirectUri: string; codeVerifier?: string }): Promise<TikTokResult<{ accessToken: string; refreshToken: string | null; openId: string; scope: string[]; expiresIn: number | null; refreshExpiresIn: number | null }>> {
    return this.tokenRequest(buildTikTokTokenExchangeBody(input), 'فشل تبادل رمز TikTok.');
  }

  /** يجدّد رمز الوصول عبر refresh_token (صالح 365 يوماً). */
  async refreshToken(input: { clientKey: string; clientSecret: string; refreshToken: string }): Promise<TikTokResult<{ accessToken: string; refreshToken: string | null; openId: string; scope: string[]; expiresIn: number | null; refreshExpiresIn: number | null }>> {
    return this.tokenRequest(buildTikTokRefreshBody(input), 'فشل تجديد رمز TikTok.');
  }

  /** يُبطل الرمز لدى TikTok عند فصل المنصة (revoke). */
  async revokeToken(input: { clientKey: string; clientSecret: string; token: string }): Promise<TikTokResult<boolean>> {
    try {
      const res = await this.fetchImpl(tiktokTokenUrl(this.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: buildTikTokRevokeBody(input).toString(),
      });
      const data = await res.json().catch(() => null);
      // TikTok يُعيد {} عند نجاح الإبطال.
      if (!res.ok || data?.error) return { ok: false, data: null, error: tiktokError(data, 'فشل إبطال رمز TikTok.'), code: tiktokErrorCode(data) };
      return { ok: true, data: true };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـTikTok.') };
    }
  }

  private async tokenRequest(body: URLSearchParams, fallback: string): Promise<TikTokResult<{ accessToken: string; refreshToken: string | null; openId: string; scope: string[]; expiresIn: number | null; refreshExpiresIn: number | null }>> {
    try {
      const res = await this.fetchImpl(tiktokTokenUrl(this.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const data = await res.json().catch(() => null);
      const parsed = parseTikTokTokenResponse(data);
      if (!res.ok || !parsed.valid || !parsed.accessToken) return { ok: false, data: null, error: parsed.reason || tiktokError(data, fallback), code: tiktokErrorCode(data) };
      return {
        ok: true,
        data: {
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          openId: parsed.openId || '',
          scope: parsed.scope,
          expiresIn: parsed.expiresIn,
          refreshExpiresIn: parsed.refreshExpiresIn,
        },
      };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـTikTok.') };
    }
  }

  /**
   * يثبت هوية الحساب الحقيقي عبر /v2/user/info/ (user.info.basic).
   * لا يُعلن اتصال موثق بلا open_id من TikTok.
   */
  async getUserInfo(accessToken: string): Promise<TikTokResult<TikTokAccountIdentity>> {
    if (!accessToken) return { ok: false, data: null, error: 'رمز الوصول غير متوفر.' };
    try {
      const u = new URL(tiktokApiUrl('/v2/user/info/', this.baseUrl));
      u.searchParams.set('fields', 'open_id,union_id,display_name,avatar_url');
      const res = await this.fetchImpl(u.toString(), { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json().catch(() => null);
      const user = data?.data?.user;
      const errorCode = tiktokErrorCode(data);
      if (!res.ok || errorCode || !user?.open_id) {
        return { ok: false, data: null, error: tiktokError(data, 'تعذّر إثبات هوية حساب TikTok.'), code: errorCode };
      }
      return {
        ok: true,
        data: {
          openId: String(user.open_id),
          displayName: user.display_name ? String(user.display_name) : null,
          avatarUrl: user.avatar_url ? String(user.avatar_url) : null,
          unionId: user.union_id ? String(user.union_id) : null,
        },
      };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـTikTok.') };
    }
  }

  /** يقرأ معلومات الناشر (إلزامية قبل أي نشر مباشر). */
  async queryCreatorInfo(accessToken: string): Promise<TikTokResult<TikTokCreatorInfo>> {
    if (!accessToken) return { ok: false, data: null, error: 'رمز الوصول غير متوفر.' };
    try {
      const res = await this.fetchImpl(tiktokApiUrl('/v2/post/publish/creator_info/query/', this.baseUrl), {
        method: 'POST',
        headers: tiktokAuthHeaders(accessToken),
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      const d = data?.data;
      const errorCode = tiktokErrorCode(data);
      if (!res.ok || errorCode || !d) {
        return { ok: false, data: null, error: tiktokError(data, 'تعذّر قراءة معلومات الناشر من TikTok.'), code: errorCode };
      }
      return {
        ok: true,
        data: {
          nickname: d.creator_nickname ? String(d.creator_nickname) : null,
          username: d.creator_username ? String(d.creator_username) : null,
          privacyLevelOptions: Array.isArray(d.privacy_level_options) ? d.privacy_level_options.map((x: any) => String(x)) : [],
          commentDisabled: d.comment_disabled === true,
          duetDisabled: d.duet_disabled === true,
          stitchDisabled: d.stitch_disabled === true,
          maxVideoPostDurationSec: Number.isFinite(Number(d.max_video_post_duration_sec)) ? Number(d.max_video_post_duration_sec) : null,
        },
      };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـTikTok.') };
    }
  }

  /**
   * يهيّئ نشر فيديو. `PULL_FROM_URL` يلزمه رابط عام، و`FILE_UPLOAD` يلزمه
   * حجم الملف وحجم القطعة. لا نجاح بلا publish_id من TikTok.
   */
  async initVideoPost(accessToken: string, body: Record<string, unknown>): Promise<TikTokResult<{ publishId: string; uploadUrl: string | null }>> {
    if (!accessToken) return { ok: false, data: null, error: 'رمز الوصول غير متوفر.' };
    try {
      const res = await this.fetchImpl(tiktokApiUrl('/v2/post/publish/video/init/', this.baseUrl), {
        method: 'POST',
        headers: tiktokAuthHeaders(accessToken),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      const publishId = data?.data?.publish_id ? String(data.data.publish_id) : '';
      const errorCode = tiktokErrorCode(data);
      if (!res.ok || errorCode || !publishId) {
        return { ok: false, data: null, error: tiktokError(data, 'تعذّر تهيئة نشر الفيديو على TikTok.'), code: errorCode };
      }
      return { ok: true, data: { publishId, uploadUrl: data?.data?.upload_url ? String(data.data.upload_url) : null } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـTikTok.') };
    }
  }

  /** يهيّئ نشر صور (PHOTO) — صورة واحدة أو كاروسيل. */
  async initPhotoPost(accessToken: string, body: Record<string, unknown>): Promise<TikTokResult<{ publishId: string }>> {
    if (!accessToken) return { ok: false, data: null, error: 'رمز الوصول غير متوفر.' };
    try {
      const res = await this.fetchImpl(tiktokApiUrl('/v2/post/publish/content/init/', this.baseUrl), {
        method: 'POST',
        headers: tiktokAuthHeaders(accessToken),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      const publishId = data?.data?.publish_id ? String(data.data.publish_id) : '';
      const errorCode = tiktokErrorCode(data);
      if (!res.ok || errorCode || !publishId) {
        return { ok: false, data: null, error: tiktokError(data, 'تعذّر تهيئة نشر الصور على TikTok.'), code: errorCode };
      }
      return { ok: true, data: { publishId } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـTikTok.') };
    }
  }

  /** يستعلم حالة النشر بمفتاح publish_id. لا يُعلن تسليم إلا بحالة PUBLISH_COMPLETE. */
  async fetchPublishStatus(accessToken: string, publishId: string): Promise<TikTokResult<ReturnType<typeof classifyPublishStatus> & { rawStatus: string }>> {
    if (!accessToken || !publishId) return { ok: false, data: null, error: 'رمز الوصول ومعرّف النشر مطلوبان.' };
    try {
      const res = await this.fetchImpl(tiktokApiUrl('/v2/post/publish/status/fetch/', this.baseUrl), {
        method: 'POST',
        headers: tiktokAuthHeaders(accessToken),
        body: JSON.stringify(buildPublishStatusBody(publishId)),
      });
      const data = await res.json().catch(() => null);
      const d = data?.data;
      const errorCode = tiktokErrorCode(data);
      if (!res.ok || errorCode || !d) {
        return { ok: false, data: null, error: tiktokError(data, 'تعذّر استعلام حالة النشر من TikTok.'), code: errorCode };
      }
      const classified = classifyPublishStatus({
        status: d.status,
        failReason: d.fail_reason,
        publiclyAvailablePostIds: d.publicaly_available_post_id || d.publicly_available_post_id,
      });
      return { ok: true, data: { ...classified, rawStatus: String(d.status || '') } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـTikTok.') };
    }
  }
}
