/**
 * موصل Facebook (Meta Graph) الحقيقي — ثاني تكامل اجتماعي خارجي فعلي.
 *
 * سبب البنية: Facebook لا يتصل برمز واحد كما Telegram؛ يحتاج OAuth لتطبيق Meta
 * ثم رمز صفحة (Page Access Token) مُشتق من رمز المستخدم. لذلك كل خطوة تُثبت
 * فعلياً من واجهة Meta الرسمية، ولا يُعلن اتصال بلا إثبات:
 * - تبادل الرمز: POST/GET `/oauth/access_token`.
 * - رمز طويل الأجل: `grant_type=fb_exchange_token`.
 * - الصفحات: GET `/me/accounts` (يُرجِع رمز كل صفحة) أو GET `/{page-id}?fields=access_token`.
 * - إثبات الصفحة: GET `/{page-id}?fields=id,name`.
 * - اشتراك webhook للصفحة: POST `/{page-id}/subscribed_apps`.
 * - رد على تعليق: POST `/{comment-id}/comments`.
 * - رسالة مباشرة: POST `/{page-id}/messages`.
 * - نشر منشور صفحة: POST `/{page-id}/feed`.
 *
 * كل الأسرار تُمرَّر كوسائط؛ لا تُسجَّل ولا تُعاد. الدوال الحتمية (تطبيع الحدث،
 * بناء الطلب، تمييز التعليق عن الرسالة) مفصولة عن عميل الشبكة لتُختبر بلا مزود.
 */

export const FACEBOOK_GRAPH_BASE = 'https://graph.facebook.com';
export const FACEBOOK_OAUTH_DIALOG_BASE = 'https://www.facebook.com';
export const FACEBOOK_GRAPH_VERSION = 'v21.0';
export const FACEBOOK_SIGNATURE_HEADER = 'x-hub-signature-256';

/**
 * القاعدة الفعلية لاستدعاءات Graph API. تُقرأ من `FACEBOOK_GRAPH_API_BASE`
 * في الاختبار فقط (خادم وهمي محلي)، فلا تُشغَّل اختبارات على مزود حقيقي.
 */
export function facebookGraphBase(override?: string): string {
  const base = override || process.env.FACEBOOK_GRAPH_API_BASE || FACEBOOK_GRAPH_BASE;
  return base.replace(/\/+$/, '');
}

/** نسخة Graph API؛ قابلة للتجاوز عبر البيئة للاختبار فقط. */
export function facebookGraphVersion(override?: string): string {
  const v = override || process.env.FACEBOOK_GRAPH_VERSION || FACEBOOK_GRAPH_VERSION;
  return v.replace(/^\/+|\/+$/g, '');
}

/** قاعدة حوار OAuth؛ قابلة للتجاوز عبر البيئة للاختبار فقط. */
export function facebookOAuthDialogBase(override?: string): string {
  const base = override || process.env.FACEBOOK_OAUTH_DIALOG_BASE || FACEBOOK_OAUTH_DIALOG_BASE;
  return base.replace(/\/+$/, '');
}

/** يبني رابط Graph API كامل (بلا رمز في السجل). */
export function facebookGraphUrl(path: string, baseOverride?: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${facebookGraphBase(baseOverride)}/${facebookGraphVersion()}/${suffix.replace(/^\/+/, '')}`;
}

/** رابط تبادل/إطالة الرمز الرسمي. */
export function facebookTokenUrl(baseOverride?: string): string {
  return facebookGraphUrl('/oauth/access_token', baseOverride);
}

// ---------------------------------------------------------------------------
// تطبيع أحداث webhook — تمييز صريح بين التعليق والرسالة وأي حدث آخر
// ---------------------------------------------------------------------------

export type FacebookEventKind = 'comment' | 'message' | 'other';

export interface FacebookNormalizedEvent {
  kind: FacebookEventKind;
  /** معرّف الحدث لدى Meta — أساس منع التكرار. */
  externalId: string;
  /** معرّف المنشور/المحادثة الأم. */
  parentExternalId: string | null;
  pageId: string | null;
  authorName: string | null;
  text: string;
  createdAt: string;
  /** هدف الرد الحقيقي حسب نوع الحدث. */
  replyTarget: Record<string, unknown> | null;
  /** البيانات الخام المطهّرة (بلا أسرار). */
  raw: Record<string, unknown>;
}

export interface FacebookWebhookParse {
  /** الأحداث المفهومة والمؤهلة للمعالجة (تعليق/رسالة). */
  events: FacebookNormalizedEvent[];
  /** أحداث وصلت لكنها غير مفهومة/غير معالجة — تُعلن صراحةً ولا تُصنَّف تعليقاً. */
  ignored: { reason: string; field: string | null }[];
}

/** يحوّل created_time (ثوانٍ) إلى ISO؛ يعيد undefined عند غيابه. */
function epochToIso(v: unknown): string | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : undefined;
}

/** يبني حدث تعليق من تغيير feed صراحةً (field=feed & item=comment). */
function commentFromChange(pageId: string | null, change: any): FacebookNormalizedEvent | null {
  const v = change?.value || {};
  const text = String(v.message ?? v.text ?? '').trim();
  const externalId = v.comment_id ?? v.id;
  if (!text || externalId === undefined || externalId === null) return null;
  return {
    kind: 'comment',
    externalId: String(externalId),
    parentExternalId: v.post_id ? String(v.post_id) : null,
    pageId,
    authorName: v.from?.name ? String(v.from.name) : null,
    text,
    createdAt: epochToIso(v.created_time) || new Date().toISOString(),
    // الرد على تعليق الصفحة يتم بمعرّف التعليق نفسه عبر Graph API.
    replyTarget: { commentId: String(externalId), pageId },
    raw: { source: 'changes', field: change?.field ?? null, item: v.item ?? null },
  };
}

/** يبني حدث رسالة من messaging (Messenger) صراحةً. */
function messageFromMessaging(pageId: string | null, m: any): FacebookNormalizedEvent | null {
  const text = String(m?.message?.text ?? '').trim();
  const externalId = m?.message?.mid;
  if (!text || !externalId) return null;
  const senderId = m?.sender?.id ? String(m.sender.id) : null;
  return {
    kind: 'message',
    externalId: String(externalId),
    parentExternalId: senderId,
    pageId,
    authorName: null,
    text,
    createdAt: epochToIso(m?.timestamp) || new Date().toISOString(),
    replyTarget: { recipientId: senderId, pageId },
    raw: { source: 'messaging' },
  };
}

/**
 * يطبّع حمولة webhook الخاصة بـFacebook إلى أحداث واضحة النوع.
 * القاعدة: أي تغيير ليس تعليقاً (field=feed & item=comment) ولا رسالة (messaging)
 * يُعاد ضمن `ignored` ولا يُخزَّن كتعليق أو رسالة. هذا يمنع اعتبار أحداث غير
 * مفهومة (reactions/posts/mentions...) كتعليقات بالخطأ.
 */
export function parseFacebookWebhook(payload: any, pageIdOverride?: string | null): FacebookWebhookParse {
  const events: FacebookNormalizedEvent[] = [];
  const ignored: { reason: string; field: string | null }[] = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const pageId = entry?.id ? String(entry.id) : (pageIdOverride ?? null);
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const field = change?.field ?? null;
      const item = change?.value?.item ?? null;
      if (field === 'feed' && (item === 'comment' || item === undefined || item === null)) {
        const ev = commentFromChange(pageId, change);
        if (ev) { events.push(ev); continue; }
        ignored.push({ reason: 'feed_change_without_comment_payload', field });
        continue;
      }
      // تغييرات معروفة لكنها ليست تعليقاً (منشورات/تفاعلات...) => غير معالجة صراحةً.
      ignored.push({ reason: 'unsupported_change_field', field });
    }
    for (const m of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const ev = messageFromMessaging(pageId, m);
      if (ev) events.push(ev);
      else ignored.push({ reason: 'messaging_without_text', field: 'messaging' });
    }
    for (const key of ['standby', 'reactions', 'mentions', 'feed']) {
      if (Array.isArray(entry?.[key]) && entry[key].length) ignored.push({ reason: 'unsupported_entry_key', field: key });
    }
  }
  return { events, ignored };
}

// ---------------------------------------------------------------------------
// بناء الطلبات (حتمي، بلا شبكة)
// ---------------------------------------------------------------------------

/** يبني جسم اشتراك الصفحة بحقول webhook المطلوبة. */
export function buildSubscribeBody(fields: string[]): URLSearchParams {
  const body = new URLSearchParams();
  body.set('subscribed_fields', fields.join(','));
  return body;
}

/** يبني جسم الرد على تعليق. */
export function buildCommentReplyBody(message: string): URLSearchParams {
  const body = new URLSearchParams();
  body.set('message', message);
  return body;
}

/** يبني جسم رسالة Messenger (recipient + text). */
export function buildSendMessagePayload(recipientId: string, text: string): string {
  return JSON.stringify({ recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text } });
}

// ---------------------------------------------------------------------------
// عميل Graph API
// ---------------------------------------------------------------------------

export type FacebookFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export interface FacebookPageIdentity {
  pageId: string;
  pageName: string | null;
  pageAccessToken: string | null;
  tasks: string[];
}

export interface FacebookResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
}

function errorMessage(data: any, fallback: string): string {
  return String(data?.error?.message || data?.error_description || data?.error || fallback);
}

export class FacebookClient {
  constructor(
    private readonly fetchImpl: FacebookFetch,
    private readonly baseUrl?: string,
  ) {}

  /** يبادل رمز OAuth برمز وصول قصير الأجل. */
  async exchangeCode(input: { clientId: string; clientSecret: string; code: string; redirectUri: string }): Promise<FacebookResult<{ accessToken: string; expiresIn: number | null }>> {
    try {
      const u = new URL(facebookTokenUrl(this.baseUrl));
      u.searchParams.set('client_id', input.clientId);
      u.searchParams.set('client_secret', input.clientSecret);
      u.searchParams.set('redirect_uri', input.redirectUri);
      u.searchParams.set('code', input.code);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      const accessToken = typeof data?.access_token === 'string' ? data.access_token : null;
      if (!res.ok || !accessToken) return { ok: false, data: null, error: errorMessage(data, 'فشل تبادل رمز Facebook.') };
      return { ok: true, data: { accessToken, expiresIn: Number.isFinite(Number(data?.expires_in)) ? Number(data.expires_in) : null } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.') };
    }
  }

  /** يطيل رمز الوصول القصير إلى رمز طويل الأجل (fb_exchange_token). */
  async exchangeLongLived(input: { clientId: string; clientSecret: string; shortToken: string }): Promise<FacebookResult<{ accessToken: string; expiresIn: number | null }>> {
    try {
      const u = new URL(facebookTokenUrl(this.baseUrl));
      u.searchParams.set('grant_type', 'fb_exchange_token');
      u.searchParams.set('client_id', input.clientId);
      u.searchParams.set('client_secret', input.clientSecret);
      u.searchParams.set('fb_exchange_token', input.shortToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      const accessToken = typeof data?.access_token === 'string' ? data.access_token : null;
      if (!res.ok || !accessToken) return { ok: false, data: null, error: errorMessage(data, 'فشل إطالة رمز Facebook.') };
      return { ok: true, data: { accessToken, expiresIn: Number.isFinite(Number(data?.expires_in)) ? Number(data.expires_in) : null } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.') };
    }
  }

  /** يسرد صفحات المستخدم مع رمز كل صفحة ومهامها (GET /me/accounts). */
  async listManagedPages(userAccessToken: string): Promise<FacebookResult<FacebookPageIdentity[]>> {
    if (!userAccessToken) return { ok: false, data: null, error: 'رمز المستخدم غير متوفر.' };
    try {
      const u = new URL(facebookGraphUrl('/me/accounts', this.baseUrl));
      u.searchParams.set('fields', 'id,name,access_token,tasks');
      u.searchParams.set('access_token', userAccessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) return { ok: false, data: null, error: errorMessage(data, 'تعذّر جلب صفحات Facebook.') };
      const pages: FacebookPageIdentity[] = (Array.isArray(data?.data) ? data.data : [])
        .filter((p: any) => p?.id)
        .map((p: any) => ({ pageId: String(p.id), pageName: p.name ? String(p.name) : null, pageAccessToken: p.access_token ? String(p.access_token) : null, tasks: Array.isArray(p.tasks) ? p.tasks.map((t: any) => String(t)) : [] }));
      return { ok: true, data: pages };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.') };
    }
  }

  /** يثبت هوية الصفحة ويعيد رمزها (GET /{page-id}?fields=id,name,access_token). */
  async getPageProfile(pageId: string, accessToken: string): Promise<FacebookResult<FacebookPageIdentity>> {
    if (!pageId || !accessToken) return { ok: false, data: null, error: 'معرّف الصفحة والرمز مطلوبان.' };
    try {
      const u = new URL(facebookGraphUrl(`/${pageId}`, this.baseUrl));
      u.searchParams.set('fields', 'id,name,access_token,tasks');
      u.searchParams.set('access_token', accessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) return { ok: false, data: null, error: errorMessage(data, 'تعذّر إثبات هوية الصفحة.') };
      return {
        ok: true,
        data: {
          pageId: String(data.id),
          pageName: data.name ? String(data.name) : null,
          pageAccessToken: data.access_token ? String(data.access_token) : (accessToken || null),
          tasks: Array.isArray(data.tasks) ? data.tasks.map((t: any) => String(t)) : [],
        },
      };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.') };
    }
  }

  /** يشترك تطبيقنا في أحداث الصفحة (feed/messages) عبر subscribed_apps. */
  async subscribeApp(pageId: string, pageAccessToken: string, fields: string[]): Promise<FacebookResult<boolean>> {
    if (!pageId || !pageAccessToken) return { ok: false, data: null, error: 'معرّف الصفحة ورمزها مطلوبان للاشتراك.' };
    try {
      const u = new URL(facebookGraphUrl(`/${pageId}/subscribed_apps`, this.baseUrl));
      u.searchParams.set('access_token', pageAccessToken);
      u.searchParams.set('subscribed_fields', fields.join(','));
      const res = await this.fetchImpl(u.toString(), { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || data?.success !== true) return { ok: false, data: null, error: errorMessage(data, 'تعذّر اشتراك الصفحة في webhook.') };
      return { ok: true, data: true };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.') };
    }
  }

  /** يقرأ اشتراكات التطبيق الحالية للصفحة (لإثبات التسجيل). */
  async getSubscribedApps(pageId: string, pageAccessToken: string): Promise<FacebookResult<string[]>> {
    if (!pageId || !pageAccessToken) return { ok: false, data: null, error: 'معرّف الصفحة ورمزها مطلوبان.' };
    try {
      const u = new URL(facebookGraphUrl(`/${pageId}/subscribed_apps`, this.baseUrl));
      u.searchParams.set('access_token', pageAccessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) return { ok: false, data: null, error: errorMessage(data, 'تعذّر قراءة اشتراكات الصفحة.') };
      const apps = (Array.isArray(data?.data) ? data.data : []).map((a: any) => String(a?.id ?? '')).filter(Boolean);
      return { ok: true, data: apps };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.') };
    }
  }

  /** يرد على تعليق حقيقي. لا نجاح بلا معرّف تعليق من Meta. */
  async replyToComment(commentId: string, pageAccessToken: string, message: string): Promise<FacebookResult<{ providerCommentId: string }>> {
    if (!commentId || !message?.trim()) return { ok: false, data: null, error: 'معرّف التعليق ونص الرد مطلوبان.' };
    try {
      const u = new URL(facebookGraphUrl(`/${commentId}/comments`, this.baseUrl));
      const res = await this.fetchImpl(u.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${pageAccessToken}` },
        body: buildCommentReplyBody(message).toString(),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) return { ok: false, data: null, error: errorMessage(data, 'فشل الرد على التعليق عبر Facebook.') };
      return { ok: true, data: { providerCommentId: String(data.id) } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.') };
    }
  }

  /** يرسل رسالة Messenger حقيقية. لا تسليم بلا معرّف رسالة من Meta. */
  async sendMessage(pageId: string, pageAccessToken: string, recipientId: string, text: string): Promise<FacebookResult<{ providerMessageId: string; recipientId: string | null }>> {
    if (!pageId || !recipientId || !text?.trim()) return { ok: false, data: null, error: 'معرّف الصفحة والمستلم ونص الرسالة مطلوبة.' };
    try {
      const u = new URL(facebookGraphUrl(`/${pageId}/messages`, this.baseUrl));
      u.searchParams.set('access_token', pageAccessToken);
      const res = await this.fetchImpl(u.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: buildSendMessagePayload(recipientId, text),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.message_id) return { ok: false, data: null, error: errorMessage(data, 'فشل إرسال الرسالة عبر Facebook.') };
      return { ok: true, data: { providerMessageId: String(data.message_id), recipientId: data.recipient_id ? String(data.recipient_id) : null } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.') };
    }
  }

  /** ينشر منشوراً على الصفحة. لا نجاح بلا معرّف منشور من Meta. */
  async publishToPage(pageId: string, pageAccessToken: string, message: string): Promise<FacebookResult<{ providerPostId: string }>> {
    if (!pageId || !message?.trim()) return { ok: false, data: null, error: 'معرّف الصفحة ونص المنشور مطلوبان.' };
    try {
      const u = new URL(facebookGraphUrl(`/${pageId}/feed`, this.baseUrl));
      u.searchParams.set('access_token', pageAccessToken);
      const res = await this.fetchImpl(u.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ message }).toString(),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) return { ok: false, data: null, error: errorMessage(data, 'فشل النشر على صفحة Facebook.') };
      return { ok: true, data: { providerPostId: String(data.id) } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.') };
    }
  }
}
