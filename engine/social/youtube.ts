/**
 * موصل YouTube الحقيقي — خامس تكامل اجتماعي خارجي منفّذ بعد Telegram وFacebook
 * وInstagram وTikTok. مبنيّ على Google OAuth 2.0 وYouTube Data API v3 الرسميين.
 *
 * سبب البنية: النطاق المطلوب في المرحلة الحالية هو **الهوية فقط**، لا المحتوى:
 * - `youtube.readonly` هو نطاق القراءة الرسمي الذي يغطّي `channels.list?mine=true`
 *   (وفق وثيقة Google للصلاحيات: channels.list يقبل youtube / youtube.force-ssl /
 *   youtube.readonly / youtubepartner / youtubepartner-channel-audit — وليس
 *   youtube.upload). لذلك كان الاتصال يُعلن «موثقاً» بينما إثبات القناة يفشل بـ403
 *   `insufficientPermissions`، وهو جوهر الفجوة التي أُصلحت.
 * - `youtube.upload` يبقى مطلوباً بقرار المالك للمرحلة القادمة (رفع الفيديو)، لكن
 *   **لا تُعلن قدرة النشر** ما لم يُنفَّذ مسار الرفع كاملاً. طلب نطاق ≠ ادعاء قدرة.
 *
 * القاعدة الملزمة: لا تُعلن قدرة محتوى (نشر/تعليقات/رد/تحليلات/جدولة) لم تُنفَّذ
 * فعلاً. مصفوفة القدرات أدناه تعلن ذلك صراحةً بدل تهيئة المالك بقدرة غير موجودة.
 *
 * كل الأسرار تُمرَّر كوسائط؛ لا تُسجَّل ولا تُعاد. الدوال الحتمية (بناء الروابط،
 * تصنيف الأخطاء، تحليل استجابة القناة) مفصولة عن عميل الشبكة لتُختبر بلا مزود.
 */

import {
  buildTokenExchangeBody,
  parseTokenResponse,
  isAccessTokenExpired,
} from './oauth';

/** القاعدة الرسمية لواجهة YouTube Data API (تُقرأ من YOUTUBE_API_BASE في الاختبار فقط). */
export const YOUTUBE_API_BASE = 'https://www.googleapis.com';
/** نقطة تبادل/تجديد الرمز الرسمية لدى Google. */
export const YOUTUBE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** نطاق القراءة الرسمي الذي يغطّي channels.list?mine=true (إثبات هوية القناة). */
export const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
/** نطاق رفع الفيديو (يبقى مطلوباً بقرار المالك للمرحلة القادمة؛ لا ادعاء نشر بعد). */
export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

/**
 * النطاقات المطلوبة فعلاً في هذه المرحلة. يبقى `youtube.upload` مطلوباً بقرار
 * المالك تمهيداً لرفع الفيديو، مع الإبقاء على `youtube.readonly` الذي يقابله
 * استدعاء حقيقي منفّذ (channels.list?mine=true) لإثبات هوية القناة.
 */
export const YOUTUBE_REQUIRED_SCOPES: readonly string[] = Object.freeze([
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_UPLOAD_SCOPE,
]);

/**
 * تجاوز اختياري من البيئة (قائمة مفصولة بمسافات/فواصل). القاعدة: لا يُقبل نطاق
 * غير رسمي، والنطاقات المطلوبة تُضمّ دائماً فلا يُسقط نطاق تحتاجه قدرة منفّذة.
 */
export function resolveYouTubeScopes(requested?: readonly string[]): string[] {
  const known = new Set(YOUTUBE_REQUIRED_SCOPES);
  const extra = (requested || [])
    .map((s) => String(s).trim())
    .filter((s) => Boolean(s) && known.has(s));
  return [...new Set<string>([...YOUTUBE_REQUIRED_SCOPES, ...extra])];
}

// ---------------------------------------------------------------------------
// مصفوفة القدرات الرسمية (متوافقة مع واجهات Google الرسمية فقط)
// ---------------------------------------------------------------------------

export type YouTubeCapabilityStatus =
  | 'SUPPORTED'
  | 'NOT_IMPLEMENTED'
  | 'REQUIRES_REVIEW';

export interface YouTubeCapabilityRow {
  key: string;
  label: string;
  status: YouTubeCapabilityStatus;
  scope?: string;
  evidence: string;
}

/**
 * مصفوفة القدرات لـYouTube. ما ليس منفّذاً يُعلن NOT_IMPLEMENTED صراحةً، ولا
 * يُترجم إلى قدرة في السجل. التعليقات والردود تحتاج `youtube.force-ssl` ولم
 * تُطلب (غير منفّذة)، والرفع يحتاج مسار بايتات/مقاطع غير منفّذ في هذه البنية.
 */
export const YOUTUBE_CAPABILITY_MATRIX: readonly YouTubeCapabilityRow[] = Object.freeze([
  {
    key: 'oauth_login',
    label: 'تسجيل الدخول (Google OAuth 2.0)',
    status: 'SUPPORTED',
    scope: YOUTUBE_READONLY_SCOPE,
    evidence: 'accounts.google.com/o/oauth2/v2/auth (response_type=code, access_type=offline, prompt=consent) وتبادل الرمز على oauth2.googleapis.com/token.',
  },
  {
    key: 'channel_identity',
    label: 'هوية القناة (قراءة)',
    status: 'SUPPORTED',
    scope: YOUTUBE_READONLY_SCOPE,
    evidence: 'GET /youtube/v3/channels?part=snippet,contentDetails&mine=true — لا يُعلن اتصال موثق بلا معرّف قناة حقيقي من Google.',
  },
  {
    key: 'connection_persistence',
    label: 'حفظ الاتصال المشفّر',
    status: 'SUPPORTED',
    scope: YOUTUBE_READONLY_SCOPE,
    evidence: 'الرمز يُحفظ مشفّراً AES-256-GCM عبر محوّل الحالة، ولا يُعاد ولا يُسجَّل.',
  },
  {
    key: 'video_upload',
    label: 'رفع فيديو (videos.insert)',
    status: 'NOT_IMPLEMENTED',
    scope: YOUTUBE_UPLOAD_SCOPE,
    evidence: 'videos.insert يلزمه رفع بايتات/مقاطع (multipart أو resumable) من الملف نفسه؛ البنية الحالية تعتمد وسائط برابط عام فقط، فلم يُنفَّذ مسار الرفع ولم تُعلن قدرة النشر. النطاق مطلوب بقرار المالك تمهيداً للمرحلة القادمة.',
  },
  {
    key: 'comments_read',
    label: 'قراءة التعليقات',
    status: 'NOT_IMPLEMENTED',
    scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
    evidence: 'commentThreads.list يقبل youtube.force-ssl فقط؛ لم يُطلب ولم يُنفَّذ.',
  },
  {
    key: 'comment_reply',
    label: 'الرد على التعليقات',
    status: 'NOT_IMPLEMENTED',
    scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
    evidence: 'comments.insert/commentThreads.insert تقبل youtube.force-ssl فقط؛ لم يُطلب ولم يُنفَّذ.',
  },
  {
    key: 'analytics',
    label: 'تحليلات الفيديوهات',
    status: 'NOT_IMPLEMENTED',
    scope: YOUTUBE_READONLY_SCOPE,
    evidence: 'لم يُنفَّذ جلب إحصاءات فعلي (videos.list part=statistics) في مسار المؤشرات؛ لا تُخترع قيم.',
  },
  {
    key: 'scheduling',
    label: 'جدولة النشر',
    status: 'NOT_IMPLEMENTED',
    scope: YOUTUBE_UPLOAD_SCOPE,
    evidence: 'لا مسار نشر منفّذ أصلاً، فجدولته غير ذات معنى حتى يُنفَّذ الرفع.',
  },
  {
    key: 'webhook_pubsub',
    label: 'إشعارات PubSubHubbub',
    status: 'REQUIRES_REVIEW',
    evidence: 'تُحتاج موافقة/تسجيل على Google PubSubHubbub وربط نطاق؛ إجراء خارجي على المالك. غير منفّذ في الكود.',
  },
]);

export function youtubeCapabilityStatus(key: string): YouTubeCapabilityStatus | null {
  return YOUTUBE_CAPABILITY_MATRIX.find((r) => r.key === key)?.status ?? null;
}

export function youtubeCapabilityImplemented(key: string): boolean {
  return youtubeCapabilityStatus(key) === 'SUPPORTED';
}

// ---------------------------------------------------------------------------
// القواعد الفعلية للشبكة (قابلة للتجاوز في الاختبار فقط)
// ---------------------------------------------------------------------------

/** القاعدة الفعلية لواجهة YouTube Data API (تُقرأ من YOUTUBE_API_BASE في الاختبار فقط). */
export function youtubeApiBase(override?: string): string {
  const base = override || process.env.YOUTUBE_API_BASE || YOUTUBE_API_BASE;
  return base.replace(/\/+$/, '');
}

/** رابط Microsoft/Google token الرسمي (قابل للتجاوز في الاختبار فقط). */
export function youtubeTokenUrl(override?: string): string {
  return override || process.env.YOUTUBE_TOKEN_BASE || YOUTUBE_TOKEN_ENDPOINT;
}

/** يبني رابط واجهة YouTube كامل بلا أي سرّ في السجل. */
export function youtubeApiUrl(path: string, baseOverride?: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${youtubeApiBase(baseOverride)}${suffix}`;
}

/** رابط إثبات هوية القناة: channels.list?part=snippet,contentDetails&mine=true. */
export function buildChannelsMineUrl(baseOverride?: string): string {
  return youtubeApiUrl('/youtube/v3/channels?part=snippet,contentDetails&mine=true', baseOverride);
}

/** هوية القناة الفعلية كما يعيدها YouTube. */
export interface YouTubeChannel {
  channelId: string;
  title: string | null;
  uploadsPlaylistId: string | null;
}

/**
 * يقرأ استجابة channels.list ويستخرج هوية القناة الأولى. لا يختلق هوية عند
 * غياب items (يعيد null) فلا يُعلن اتصال بلا قناة حقيقية.
 */
export function parseChannelListResponse(data: any): YouTubeChannel | null {
  const item = data?.items?.[0];
  if (!item || !item.id) return null;
  return {
    channelId: String(item.id),
    title: item.snippet?.title != null ? String(item.snippet.title) : null,
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads != null
      ? String(item.contentDetails.relatedPlaylists.uploads)
      : null,
  };
}

/**
 * يصنّف خطأ استجابة Google token بلا كشف أي قيمة. يميّز:
 * - invalid_grant: رمز/تحدٍّ منتهٍ أو أُعيد استخدامه.
 * - invalid_client / unauthorized_client: بيانات العميل غير مقبولة (لم تُمنح صلاحية).
 * - insufficientPermissions / accessNotConfigured: القناة لم تُمنح لهذا الرمز
 *   (يظهر عادةً عند غياب nطاق youtube.readonly — وهو ما أُصلح).
 * - network: تعذّر الاتصال.
 */
export type YouTubeErrorKind =
  | 'invalid_grant'
  | 'invalid_client'
  | 'unauthorized_client'
  | 'insufficient_permissions'
  | 'access_not_configured'
  | 'rate_limited'
  | 'invalid_request'
  | 'provider_error'
  | 'network'
  | 'unknown';

export function classifyYouTubeTokenError(data: any): YouTubeErrorKind {
  const err = String(data?.error || '').toLowerCase();
  if (!err) return 'unknown';
  if (err === 'invalid_grant') return 'invalid_grant';
  if (err === 'invalid_client') return 'invalid_client';
  if (err === 'unauthorized_client') return 'unauthorized_client';
  if (err === 'invalid_request') return 'invalid_request';
  if (err === 'rate_limit_exceeded' || err === 'user_rate_limit_exceeded') return 'rate_limited';
  return 'provider_error';
}

/** يصنّف خطأ قراءة القناة من استجابة Data API (reason داخل error.errors[0].reason). */
export function classifyYouTubeApiError(data: any): YouTubeErrorKind {
  const reason = String(data?.error?.errors?.[0]?.reason || data?.error?.status || '').toLowerCase();
  if (!reason) return 'unknown';
  if (reason.includes('insufficientpermission') || reason === 'forbidden') return 'insufficient_permissions';
  if (reason.includes('accessnotconfigured') || reason.includes('service_disabled')) return 'access_not_configured';
  if (reason.includes('ratelimit') || reason.includes('quota')) return 'rate_limited';
  if (reason === 'invalid_grant') return 'invalid_grant';
  return 'provider_error';
}

// ---------------------------------------------------------------------------
// عميل الشبكة (يُمرَّر fetchImpl فيُختبر بخادم وهمي محلي)
// ---------------------------------------------------------------------------

export type YouTubeFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export interface YouTubeResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
  code?: YouTubeErrorKind | string | null;
}

export class YouTubeClient {
  constructor(
    private readonly fetchImpl: YouTubeFetch,
    private readonly apiBase?: string,
    private readonly tokenUrlOverride?: string,
  ) {}

  /** يبادل رمز التفويض برمز وصول (+ refresh token بسبب access_type=offline). */
  async exchangeCode(input: { clientId: string; clientSecret: string; code: string; redirectUri: string }): Promise<YouTubeResult<{ accessToken: string; refreshToken: string | null; expiresIn: number | null; scope: string[] }>> {
    return this.tokenRequest(
      buildTokenExchangeBody({ clientId: input.clientId, clientSecret: input.clientSecret, code: input.code, redirectUri: input.redirectUri }),
      'فشل تبادل رمز Google.',
    );
  }

  /** يجدّد رمز الوصول عبر refresh_token. */
  async refreshAccessToken(input: { clientId: string; clientSecret: string; refreshToken: string }): Promise<YouTubeResult<{ accessToken: string; refreshToken: string | null; expiresIn: number | null; scope: string[] }>> {
    const body = new URLSearchParams();
    body.set('client_id', input.clientId);
    body.set('client_secret', input.clientSecret);
    body.set('refresh_token', input.refreshToken);
    body.set('grant_type', 'refresh_token');
    return this.tokenRequest(body, 'فشل تجديد رمز Google.');
  }

  private async tokenRequest(body: URLSearchParams, fallback: string): Promise<YouTubeResult<{ accessToken: string; refreshToken: string | null; expiresIn: number | null; scope: string[] }>> {
    try {
      const res = await this.fetchImpl(youtubeTokenUrl(this.tokenUrlOverride), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const data = await res.json().catch(() => null);
      const parsed = parseTokenResponse(data);
      if (!res.ok || !parsed.valid || !parsed.accessToken) {
        const kind = classifyYouTubeTokenError(data);
        return { ok: false, data: null, error: youTubeErrorMessage(data, kind, fallback), code: kind };
      }
      const scope = typeof data?.scope === 'string' ? String(data.scope).split(/\s+/).filter(Boolean) : [];
      return { ok: true, data: { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken, expiresIn: parsed.expiresIn, scope } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'تعذّر الاتصال بـGoogle.'), code: 'network' };
    }
  }

  /**
   * يثبت هوية القناة فعلياً عبر channels.list?mine=true. لا يُعلن اتصال موثق
   * بلا معرّف قناة حقيقي من Google. هذا هو الاستدعاء الذي يحتاج `youtube.readonly`.
   */
  async fetchMyChannel(accessToken: string): Promise<YouTubeResult<YouTubeChannel>> {
    if (!accessToken) return { ok: false, data: null, error: 'رمز الوصول غير متوفر.' };
    try {
      const res = await this.fetchImpl(buildChannelsMineUrl(this.apiBase), {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json().catch(() => null);
      const channel = parseChannelListResponse(data);
      if (!res.ok || !channel) {
        const kind = classifyYouTubeApiError(data);
        return { ok: false, data: null, error: youTubeChannelErrorMessage(kind), code: kind };
      }
      return { ok: true, data: channel };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'تعذّر الاتصال بـGoogle.'), code: 'network' };
    }
  }
}

/** رسالة خطأ عربية دقيقة حسب فئة خطأ Google token (بلا أي قيمة سرّية). */
export function youTubeErrorMessage(data: any, kind: YouTubeErrorKind, fallback: string): string {
  switch (kind) {
    case 'invalid_grant':
      return 'رمز التفويض منتهٍ أو أُعيد استخدامه (invalid_grant)؛ أعد بدء الربط.';
    case 'invalid_client':
      return 'معرّف/سرّ تطبيق Google غير مقبول (invalid_client)؛ تحقق من GOOGLE_OAUTH_CLIENT_ID/SECRET وأن Redirect URI مسجّل بالضبط.';
    case 'unauthorized_client':
      return 'التطبيق غير مصرّح له بطلب هذه الصلاحيات (unauthorized_client)؛ فعّل YouTube Data API وراجع شاشة الموافقة.';
    case 'invalid_request':
      return 'طلب الرمز غير مكتمل (invalid_request)؛ تحقق من redirect_uri وcode.';
    case 'rate_limited':
      return 'حصة/تقييد مؤقت لدى Google؛ أعد المحاولة لاحقاً.';
    default:
      return data?.error_description ? String(data.error_description).slice(0, 200) : fallback;
  }
}

/** رسالة خطأ عربية دقيقة عند فشل قراءة القناة. */
export function youTubeChannelErrorMessage(kind: YouTubeErrorKind): string {
  switch (kind) {
    case 'insufficient_permissions':
      return 'الرمز لا يملك صلاحية قراءة القناة (insufficientPermissions)؛ يلزم نطاق youtube.readonly في رابط التفويض.';
    case 'access_not_configured':
      return 'YouTube Data API v3 غير مُمكّن في مشروع Google (accessNotConfigured)؛ فعّله من Cloud Console ثم أعد المحاولة.';
    case 'rate_limited':
      return 'حصة YouTube Data API مستهلكة؛ أعد المحاولة لاحقاً.';
    case 'invalid_grant':
      return 'رمز الوصول لم يعد صالحاً؛ أعد الربط.';
    default:
      return 'تعذّر إثبات هوية قناة YouTube من Google.';
  }
}

export { isAccessTokenExpired };
