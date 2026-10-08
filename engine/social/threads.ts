/**
 * موصل Threads الحقيقي (Task #24) — رابع تكامل اجتماعي خارجي بعد
 * Telegram/Facebook/Instagram، وأول موصل ينشر عبر `graph.threads.net` (تطبيق
 * Meta منفصل عن تطبيق Facebook الرئيسي، كما وُثِّق مسبقاً في OAUTH_CONFIG
 * وفي `server.ts:8154` — `separateOAuthClient:true`).
 *
 * المسار الرسمي («Threads API»، Meta، 2024+) يطابق بنية Instagram حرفياً
 * (حاوية ثم نشر، ثم فحص حالة اختياري عند التأخر):
 * - إنشاء حاوية: `POST /{threads-user-id}/threads` (media_type=TEXT/IMAGE/VIDEO،
 *   `text`، `image_url`/`video_url`، و`reply_to_id` اختياري للرد على منشور قائم —
 *   Threads لا يملك endpoint ردود مستقلاً كـInstagram/Facebook؛ الرد هو منشور
 *   جديد يحمل `reply_to_id`).
 * - نشر الحاوية: `POST /{threads-user-id}/threads_publish` (creation_id).
 * - فحص حالة الحاوية: `GET /{container-id}?fields=status,error_message`
 *   (نفس حاجة Instagram لفيديو يحتاج وقت معالجة قبل أن يصبح قابلاً للنشر).
 * - إثبات الهوية: `GET /{threads-user-id}/threads_publishing_limit` غير مطلوب
 *   هنا؛ الهوية تُثبت فعلاً عبر `GET /me?fields=id,username` (مُستخدَمة أصلاً في
 *   `fetchProviderAccount` بـ`server.ts`، إصلاح Task #24 لإلزامية هذا الإثبات).
 *
 * Threads لا يدعم نشر نص فقط بلا أي قيد — خلافاً لإنستغرام، نص فقط (`TEXT`)
 * **مقبول رسمياً** (هذا هو الفرق الجوهري عن Instagram الذي يرفض نص بلا وسائط).
 *
 * كل الأسرار تُمرَّر كوسائط؛ لا تُسجَّل ولا تُعاد. الدوال الحتمية (بناء
 * الطلبات) مفصولة عن عميل الشبكة لتُختبر بلا أي مزود.
 */

export const THREADS_GRAPH_BASE = 'https://graph.threads.net';
export const THREADS_GRAPH_VERSION = 'v1.0';

/** القاعدة الفعلية لاستدعاءات Graph؛ تُقرأ من البيئة في الاختبار فقط (خادم وهمي محلي). */
export function threadsGraphBase(override?: string): string {
  const base = override || process.env.THREADS_GRAPH_API_BASE || THREADS_GRAPH_BASE;
  return base.replace(/\/+$/, '');
}

export function threadsGraphVersion(override?: string): string {
  const v = override || process.env.THREADS_GRAPH_VERSION || THREADS_GRAPH_VERSION;
  return v.replace(/^\/+|\/+$/g, '');
}

/** يبني رابط Graph كامل (بلا رمز في السجل). */
export function threadsGraphUrl(path: string, baseOverride?: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${threadsGraphBase(baseOverride)}/${threadsGraphVersion()}/${suffix.replace(/^\/+/, '')}`;
}

// ---------------------------------------------------------------------------
// بناء الطلبات (حتمي، بلا شبكة)
// ---------------------------------------------------------------------------

export interface ThreadsPublishInput {
  text?: string;
  imageUrl?: string;
  videoUrl?: string;
  /** معرّف منشور Threads قائم — وجوده يحوّل هذا المنشور الجديد إلى رد عليه. */
  replyToId?: string;
}

export type ThreadsMediaKind = 'text' | 'image' | 'video';

/**
 * يبني جسم إنشاء الحاوية (`POST /{threads-user-id}/threads`). خلافاً
 * لإنستغرام، النص المجرّد (`TEXT`) مقبول رسمياً — فلا يُرفض بلا وسائط.
 * الأولوية: فيديو > صورة > نص (أول وسيط مزوَّد يُستخدم؛ لا مزج في نداء واحد،
 * كما تفرضه Threads API).
 */
export function buildThreadsContainerBody(input: ThreadsPublishInput): { body: URLSearchParams; mediaKind: ThreadsMediaKind } {
  const body = new URLSearchParams();
  const text = input.text?.trim() || '';
  if (input.videoUrl?.trim()) {
    body.set('media_type', 'VIDEO');
    body.set('video_url', input.videoUrl.trim());
    if (text) body.set('text', text);
    if (input.replyToId?.trim()) body.set('reply_to_id', input.replyToId.trim());
    return { body, mediaKind: 'video' };
  }
  if (input.imageUrl?.trim()) {
    body.set('media_type', 'IMAGE');
    body.set('image_url', input.imageUrl.trim());
    if (text) body.set('text', text);
    if (input.replyToId?.trim()) body.set('reply_to_id', input.replyToId.trim());
    return { body, mediaKind: 'image' };
  }
  body.set('media_type', 'TEXT');
  if (text) body.set('text', text);
  if (input.replyToId?.trim()) body.set('reply_to_id', input.replyToId.trim());
  return { body, mediaKind: 'text' };
}

/** جسم نشر الحاوية (`POST /{threads-user-id}/threads_publish`). */
export function buildThreadsPublishBody(creationId: string): URLSearchParams {
  const body = new URLSearchParams();
  body.set('creation_id', creationId);
  return body;
}

// ---------------------------------------------------------------------------
// عميل Threads Graph
// ---------------------------------------------------------------------------

export type ThreadsFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export interface ThreadsResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
  /**
   * كود فشل حقيقي يُمرَّر للمسار العام بدل تثبيت PROVIDER_ERROR (كان يُخفي السبب).
   * MEDIA_DOWNLOAD_FAILED لخطأ Meta 9007/«download the video» (رابط وسائط لا يعيد
   * بايتات فيديو خام)، وNETWORK_ERROR/CLIENT_ERROR لبقية الحالات.
   */
  code?: string;
  /** كود/رقم Meta الفرعي الخام (error.code/error_subcode) — للتشخيص الصريح بلا تثبيت. */
  providerCode?: number | null;
}

function errorMessage(data: any, fallback: string): string {
  return String(data?.error?.message || data?.error_description || data?.error || fallback);
}

function providerErrorCode(data: any): number | null {
  const c = data?.error?.code;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

/**
 * مميِّز حقيقي لأخطاء Threads: لا تثبيت كود. إن كان الخطأ مرتبطاً بتنزيل الوسائط
 * من رابط عام (Meta 9007 / رسالة تفيد بتعذّر تنزيل الفيديو/الصورة) نُعلن
 * MEDIA_DOWNLOAD_FAILED صراحةً؛ وإلا نُمرّر الكود الخام. الرسالة الحقيقية تُبقى
 * كما هي دائماً (لا تُستبدل بنص ثابت).
 */
function classifyThreadsProviderError(message: string, providerCode: number | null): string {
  const m = String(message || '').toLowerCase();
  const mediaRelated = providerCode === 9007
    || /download|video_url|image_url|media|video|image|fetch the (video|image)|couldn'?t? (get|download)/.test(m);
  if (mediaRelated && /download|video|image|media|fetch/.test(m)) return 'MEDIA_DOWNLOAD_FAILED';
  return 'CLIENT_ERROR';
}

export class ThreadsClient {
  constructor(
    private readonly fetchImpl: ThreadsFetch,
    private readonly baseUrl?: string,
  ) {}

  /** يثبت هوية حساب Threads (`GET /me?fields=id,username`). نفس الاستدعاء المستخدم في fetchProviderAccount. */
  async getProfile(accessToken: string): Promise<ThreadsResult<{ threadsUserId: string; username: string | null }>> {
    if (!accessToken) return { ok: false, data: null, error: 'رمز الوصول مطلوب.' };
    try {
      const u = new URL(threadsGraphUrl('/me', this.baseUrl));
      u.searchParams.set('fields', 'id,username');
      u.searchParams.set('access_token', accessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) return { ok: false, data: null, error: errorMessage(data, 'تعذّر إثبات هوية حساب Threads.') };
      return { ok: true, data: { threadsUserId: String(data.id), username: data.username ? String(data.username) : null } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـThreads.') };
    }
  }

  /** ينشئ حاوية نشر (الخطوة الأولى). لا نجاح بلا معرّف حاوية من Meta. */
  async createMediaContainer(threadsUserId: string, accessToken: string, input: ThreadsPublishInput): Promise<ThreadsResult<{ containerId: string; mediaKind: ThreadsMediaKind }>> {
    if (!threadsUserId) return { ok: false, data: null, error: 'معرّف حساب Threads مطلوب.' };
    const built = buildThreadsContainerBody(input);
    try {
      const u = new URL(threadsGraphUrl(`/${threadsUserId}/threads`, this.baseUrl));
      u.searchParams.set('access_token', accessToken);
      const res = await this.fetchImpl(u.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: built.body.toString(),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) {
        const msg = errorMessage(data, 'فشل إنشاء حاوية النشر عبر Threads.');
        const pCode = providerErrorCode(data);
        return { ok: false, data: null, error: msg, providerCode: pCode, code: classifyThreadsProviderError(msg, pCode) };
      }
      return { ok: true, data: { containerId: String(data.id), mediaKind: built.mediaKind } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـThreads.'), code: 'NETWORK_ERROR' };
    }
  }

  /** ينشر الحاوية (الخطوة الثانية). لا نجاح بلا معرّف منشور من Meta. */
  async publishContainer(threadsUserId: string, accessToken: string, creationId: string): Promise<ThreadsResult<{ providerPostId: string }>> {
    if (!threadsUserId || !creationId) return { ok: false, data: null, error: 'معرّف حساب Threads ومعرّف الحاوية مطلوبان.' };
    try {
      const u = new URL(threadsGraphUrl(`/${threadsUserId}/threads_publish`, this.baseUrl));
      u.searchParams.set('access_token', accessToken);
      const res = await this.fetchImpl(u.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: buildThreadsPublishBody(creationId).toString(),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) return { ok: false, data: null, error: errorMessage(data, 'فشل نشر الحاوية عبر Threads.') };
      return { ok: true, data: { providerPostId: String(data.id) } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـThreads.') };
    }
  }

  /** يقرأ حالة الحاوية (للتشخيص عند تأخر معالجة الفيديو). */
  async getContainerStatus(containerId: string, accessToken: string): Promise<ThreadsResult<{ status: string | null; errorMessage: string | null }>> {
    if (!containerId) return { ok: false, data: null, error: 'معرّف الحاوية مطلوب.' };
    try {
      const u = new URL(threadsGraphUrl(`/${containerId}`, this.baseUrl));
      u.searchParams.set('fields', 'status,error_message');
      u.searchParams.set('access_token', accessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) return { ok: false, data: null, error: errorMessage(data, 'تعذّر قراءة حالة الحاوية.') };
      return { ok: true, data: { status: data.status ? String(data.status) : null, errorMessage: data.error_message ? String(data.error_message) : null } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـThreads.') };
    }
  }
}
