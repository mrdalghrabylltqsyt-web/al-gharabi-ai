/**
 * موصل Instagram الحقيقي — ثالث تكامل اجتماعي خارجي بعد Telegram وFacebook.
 *
 * المسار المعتمد هو **Instagram API with Facebook Login** (وليس Instagram Login)،
 * لأنه هو المسار الذي تنتمي إليه بنية المشروع القائمة بالفعل: نفس تطبيق Meta
 * («وكيل الغرابي الذكي»)، ونفس `graph.facebook.com`، ونفس رمز صفحة Facebook
 * (Page Access Token) الذي يُشتق من رمز مستخدم طويل الأجل. هذا يعني أقل تغيير
 * ممكن وأعلى استقرار إنتاجي، بلا تسجيل تطبيق ثانٍ ولا migration.
 *
 * الحقائق الرسمية المُثبتة من وثائق Meta (2025) والمطابقة للاستدعاءات هنا:
 * - الصلاحيات: instagram_basic, instagram_content_publish, instagram_manage_comments,
 *   instagram_manage_messages, instagram_manage_insights (وبديلاتها pages_show_list,
 *   pages_read_engagement, pages_manage_metadata). أسماء Instagram Login
 *   (instagram_business_*) **لا تُستخدم** في هذا المسار.
 * - اكتشاف الحساب: الصفحة المُوصولة بحساب Instagram للأعمال عبر
 *   `GET /{page-id}?fields=instagram_business_account`.
 * - الرد على تعليق: `POST /{ig-comment-id}/replies`.
 * - إرسال رسالة: `POST /{page-id}/messages` والمستلم هو Instagram-scoped user id.
 * - النشر: `POST /{ig-id}/media` (حاوية) ثم `POST /{ig-id}/media_publish`.
 * - webhook: كائن `instagram`، تعليقات عبر `changes[].field = comments`،
 *   ورسائل عبر `entry[].messaging[]`.
 *
 * كل الأسرار تُمرَّر كوسائط؛ لا تُسجَّل ولا تُعاد. الدوال الحتمية (تطبيع الحدث،
 * بناء الطلبات، الاعتماديات) مفصولة عن عميل الشبكة لتُختبر بلا أي مزود.
 */

export const INSTAGRAM_GRAPH_BASE = 'https://graph.facebook.com';
export const INSTAGRAM_GRAPH_VERSION = 'v21.0';
export const INSTAGRAM_SIGNATURE_HEADER = 'x-hub-signature-256';

// ---------------------------------------------------------------------------
// صلاحيات Instagram API with Facebook Login — المصدر الواحد مع رسم الاعتماديات
// ---------------------------------------------------------------------------

/**
 * رسم الاعتماديات الرسمي من «Permissions Reference» لـMeta (المسار المستخدم:
 * Instagram API with Facebook Login). طلب صلاحية بلا اعتماديتها إما يُرفض
 * بـ«Invalid Scopes» (تطبيق Live بلا مراجعة) أو يُسقَط صامتاً من الرمز فتبدو
 * الواجهة قادرة والتنفيذ يفشل بلا سبب ظاهر.
 *
 * نصّ الوثيقة (مجموعة Dependencies لكل صلاحية):
 *   instagram_basic            → (بلا اعتماديات)
 *   instagram_content_publish  → instagram_basic, pages_read_engagement, pages_show_list
 *   instagram_manage_comments  → instagram_basic, pages_read_engagement, pages_show_list
 *   instagram_manage_messages  → instagram_basic, pages_read_engagement, pages_show_list
 *   instagram_manage_insights  → instagram_basic, pages_read_engagement, pages_show_list
 *   pages_read_engagement      → pages_show_list
 *   pages_manage_metadata      → pages_show_list
 *   business_management        → (بلا اعتماديات)
 *
 * ملاحظة مهمة: `pages_manage_metadata` ليست اعتمادية لأي صلاحية instagram_*، لكنها
 * شرط مستقل لحقل webhook `comments` (وثائق Instagram Webhooks) ولذلك تبقى مطلوبة
 * في المجموعة الدنيا رغم عدم كونها اعتمادية.
 */
export const INSTAGRAM_PERMISSION_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  instagram_basic: [],
  instagram_content_publish: ['instagram_basic', 'pages_read_engagement', 'pages_show_list'],
  instagram_manage_comments: ['instagram_basic', 'pages_read_engagement', 'pages_show_list'],
  instagram_manage_messages: ['instagram_basic', 'pages_read_engagement', 'pages_show_list'],
  instagram_manage_insights: ['instagram_basic', 'pages_read_engagement', 'pages_show_list'],
  pages_show_list: [],
  pages_read_engagement: ['pages_show_list'],
  pages_manage_metadata: ['pages_show_list'],
  business_management: [],
});

/**
 * المجموعة الدنيا التي تغطي كل وظائف الموصل فعلاً: النشر + التعليقات + الرسائل +
 * التحليلات + اشتراك webhook + اكتشاف الصفحة + صفحات Business Manager.
 * كل صلاحية هنا يقابلها استدعاء حقيقي في الكود:
 * - instagram_content_publish → POST /{ig-id}/media + media_publish (النشر).
 * - instagram_manage_comments → POST /{comment-id}/replies (الرد على التعليق).
 * - instagram_manage_messages → POST /{page-id}/messages (الرسائل).
 * - instagram_manage_insights → قراءة مؤشرات الحساب (analytics).
 * - pages_manage_metadata     → POST /{page-id}/subscribed_apps (اشتراك webhook).
 * - business_management       → ظهور صفحات Business Manager في /me/accounts.
 */
export const INSTAGRAM_REQUIRED_SCOPES: readonly string[] = Object.freeze([
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_messages',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'business_management',
]);

/** حقيقة صريحة: هذا المسار يُوصَل عبر حساب Instagram للأعمال وليس الحساب الشخصي. */
export const INSTAGRAM_REQUIRES_PROFESSIONAL_ACCOUNT = true;

/**
 * أنواع الحساب المقبولة للمسار: Business أو Creator فقط. الحساب الشخصي (Consumer)
 * لا تدعمه هذه الواجهة، فلا يُقبل كحساب تشغيلي. المصدر الرسمي هو حقل
 * `instagram_business_account` على الصفحة (لا يوجد حقل نوع منفصل في Graph v21).
 */
export const INSTAGRAM_PROFESSIONAL_ACCOUNT_TYPES: readonly string[] = Object.freeze(['business', 'creator']);

/**
 * حقول webhook الافتراضية لحساب Instagram المهني: التعليقات والرسائل.
 * تُفعَّل من Meta App Dashboard، ولا يمكن ضبط حقول Instagram عبر subscribed_apps
 * لصفحة Facebook (وثيقة Meta: «You cannot use the subscribed_fields parameter to
 * configure or subscribe to Webhooks for Instagram»). لذلك نُثبت تجهيزنا المحلي
 * هنا، ونطالب بتفعيلها في اللوحة، ولا ندّعي التحقق بلا اختبار فعلي.
 */
export const INSTAGRAM_SUBSCRIBED_FIELDS_DEFAULT: readonly string[] = Object.freeze(['comments', 'messages']);

/** يوسّع قائمة صلاحيات بإضافة اعتمادياتها (بشكل متعدٍّ) بلا تكرار. */
export function expandInstagramScopes(scopes: readonly string[]): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();
  const visit = (scope: string) => {
    if (!scope || seen.has(scope)) return;
    seen.add(scope);
    for (const dep of INSTAGRAM_PERMISSION_DEPENDENCIES[scope] || []) visit(dep);
    resolved.push(scope);
  };
  for (const scope of scopes) visit(scope);
  return resolved;
}

/** يبني صلاحيات Instagram النهائية بعد إضافة الاعتماديات الناقصة (ترتيب طوبولوجي). */
export function resolveInstagramScopes(requested: readonly string[]): string[] {
  return expandInstagramScopes(requested);
}

/** يعيد الاعتماديات الناقصة (بلا تكرار) — فارغة تعني مجموعة متماسكة مع عقد Meta. */
export function findMissingInstagramScopeDependencies(scopes: readonly string[]): string[] {
  const present = new Set(scopes);
  const missing: string[] = [];
  for (const scope of scopes) {
    for (const dep of INSTAGRAM_PERMISSION_DEPENDENCIES[scope] || []) {
      if (!present.has(dep) && !missing.includes(dep)) missing.push(dep);
    }
  }
  return missing;
}

/** يستنتج الاعتماديات الناقصة من قيمة بيئة مفصولة بفواصل (بلا أي سرّ). */
export function missingInstagramScopeDependenciesFromCsv(raw: string | undefined | null): string[] {
  const scopes = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  return scopes.length ? findMissingInstagramScopeDependencies(scopes) : [];
}

// ---------------------------------------------------------------------------
// بناء الروابط — تُقرأ قاعدة Graph من البيئة في الاختبار فقط
// ---------------------------------------------------------------------------

/** القاعدة الفعلية لاستدعاءات Graph (خادم وهمي محلي في الاختبار). */
export function instagramGraphBase(override?: string): string {
  const base = override || process.env.FACEBOOK_GRAPH_API_BASE || process.env.INSTAGRAM_GRAPH_API_BASE || INSTAGRAM_GRAPH_BASE;
  return base.replace(/\/+$/, '');
}

export function instagramGraphVersion(override?: string): string {
  const v = override || process.env.FACEBOOK_GRAPH_VERSION || process.env.INSTAGRAM_GRAPH_VERSION || INSTAGRAM_GRAPH_VERSION;
  return v.replace(/^\/+|\/+$/g, '');
}

/** يبني رابط Graph كامل (بلا رمز في السجل). */
export function instagramGraphUrl(path: string, baseOverride?: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${instagramGraphBase(baseOverride)}/${instagramGraphVersion()}/${suffix.replace(/^\/+/, '')}`;
}

// ---------------------------------------------------------------------------
// تطبيع أحداث webhook — تمييز صريح بين التعليق والرسالة وأي حدث آخر
// ---------------------------------------------------------------------------

export type InstagramEventKind = 'comment' | 'message' | 'other';

export interface InstagramNormalizedEvent {
  kind: InstagramEventKind;
  /** معرّف الحدث لدى Instagram (comment id / message mid) — أساس منع التكرار. */
  externalId: string;
  /** معرّف المنشور/المحادثة الأم. */
  parentExternalId: string | null;
  /** معرّف حساب Instagram المهني صاحب الحدث (recipient). */
  igAccountId: string | null;
  authorName: string | null;
  /** معرّف Instagram-scoped للمُعلّق/المُرسل (يُستخدم لهدف الرد). */
  authorId: string | null;
  text: string;
  createdAt: string;
  replyTarget: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}

export interface InstagramWebhookParse {
  events: InstagramNormalizedEvent[];
  ignored: { reason: string; field: string | null }[];
}

function epochToIso(v: unknown): string | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : undefined;
}

/**
 * يطبّع حمولة webhook الخاصة بـInstagram (كائن instagram) إلى أحداث واضحة النوع.
 * أي تغيير ليس تعليقاً (`field=comments`) ولا رسالة (`messaging`) يُعاد في
 * `ignored` ولا يُخزَّن كتعليق أو رسالة بالخطأ.
 */
export function parseInstagramWebhook(payload: any, igAccountOverride?: string | null): InstagramWebhookParse {
  const events: InstagramNormalizedEvent[] = [];
  const ignored: { reason: string; field: string | null }[] = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const igAccountId = entry?.id ? String(entry.id) : (igAccountOverride ?? null);
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const field = change?.field ?? null;
      if (field === 'comments' || field === 'live_comments') {
        const v = change?.value || {};
        const text = String(v.text ?? v.message ?? '').trim();
        const externalId = v.comment_id ?? v.id;
        if (!text || externalId === undefined || externalId === null) {
          ignored.push({ reason: 'comment_without_text_or_id', field });
          continue;
        }
        events.push({
          kind: 'comment',
          externalId: String(externalId),
          parentExternalId: v.media?.id ? String(v.media.id) : null,
          igAccountId,
          authorName: v.from?.username ? String(v.from.username) : null,
          authorId: v.from?.id ? String(v.from.id) : null,
          text,
          createdAt: epochToIso(entry?.time) || new Date().toISOString(),
          // الرد على تعليق Instagram يتم بمعرّف التعليق عبر POST /{comment-id}/replies.
          replyTarget: { commentId: String(externalId), igAccountId },
          raw: { source: 'changes', field },
        });
        continue;
      }
      ignored.push({ reason: 'unsupported_change_field', field });
    }
    for (const m of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const text = String(m?.message?.text ?? '').trim();
      const externalId = m?.message?.mid;
      if (!text || !externalId) {
        ignored.push({ reason: 'messaging_without_text', field: 'messaging' });
        continue;
      }
      const senderId = m?.sender?.id ? String(m.sender.id) : null;
      const recipientId = m?.recipient?.id ? String(m.recipient.id) : igAccountId;
      events.push({
        kind: 'message',
        externalId: String(externalId),
        parentExternalId: senderId,
        igAccountId: recipientId,
        authorName: null,
        authorId: senderId,
        text,
        createdAt: epochToIso(m?.timestamp) || new Date().toISOString(),
        // إرسال الرد يتم عبر POST /{page-id}/messages والمستلم هو Instagram-scoped id.
        replyTarget: { recipientId: senderId, igAccountId: recipientId },
        raw: { source: 'messaging' },
      });
    }
    for (const key of ['reactions', 'mentions', 'story_insights']) {
      if (Array.isArray(entry?.[key]) && entry[key].length) ignored.push({ reason: 'unsupported_entry_key', field: key });
    }
  }
  return { events, ignored };
}

// ---------------------------------------------------------------------------
// بناء الطلبات (حتمي، بلا شبكة)
// ---------------------------------------------------------------------------

/** جسم الرد على تعليق Instagram. */
export function buildInstagramReplyBody(message: string): URLSearchParams {
  const body = new URLSearchParams();
  body.set('message', message);
  return body;
}

/** جسم رسالة Instagram المباشرة (recipient + text). */
export function buildInstagramMessagePayload(igsid: string, text: string): string {
  return JSON.stringify({ recipient: { id: igsid }, message: { text } });
}

/** حقول الاكتشاف: الحساب المهني المرتبط بالصفحة. */
export const INSTAGRAM_ACCOUNT_FIELDS = 'instagram_business_account{id,username}';

export interface InstagramPublishInput {
  /** رابط صورة عام (مطلوب لمنشور الصورة). */
  imageUrl?: string;
  /** رابط فيديو/ريل عام. */
  videoUrl?: string;
  caption?: string;
  /** نشر كريل (media_type=REELS) بدل فيديو عادي. */
  reel?: boolean;
}

/**
 * يبني جسم إنشاء الحاوية (`POST /{ig-id}/media`).
 * Instagram لا يدعم نشر نص فقط؛ غياب رابط وسائط = طلب غير صالح يُعلن صراحةً.
 */
export function buildMediaContainerBody(input: InstagramPublishInput): { ok: boolean; body: URLSearchParams; error?: string; mediaKind: 'image' | 'video' | 'reel' | null } {
  const body = new URLSearchParams();
  if (input.caption && input.caption.trim()) body.set('caption', input.caption.trim());
  if (input.videoUrl && input.videoUrl.trim()) {
    body.set('video_url', input.videoUrl.trim());
    if (input.reel) { body.set('media_type', 'REELS'); return { ok: true, body, mediaKind: 'reel' }; }
    return { ok: true, body, mediaKind: 'video' };
  }
  if (input.imageUrl && input.imageUrl.trim()) {
    body.set('image_url', input.imageUrl.trim());
    return { ok: true, body, mediaKind: 'image' };
  }
  return { ok: false, body, error: 'Instagram لا ينشر نصاً فقط؛ يلزم رابط صورة أو فيديو عام.', mediaKind: null };
}

/** جسم نشر الحاوية (`POST /{ig-id}/media_publish`). */
export function buildPublishContainerBody(creationId: string): URLSearchParams {
  const body = new URLSearchParams();
  body.set('creation_id', creationId);
  return body;
}

// ---------------------------------------------------------------------------
// عميل Instagram Graph
// ---------------------------------------------------------------------------

export type InstagramFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export interface InstagramLinkedPage {
  pageId: string;
  pageName: string | null;
  pageAccessToken: string | null;
  /** معرّف حساب Instagram للأعمال المرتبط بالصفحة (إن وُجد). */
  igAccountId: string | null;
  igUsername: string | null;
}

export interface InstagramAccountIdentity {
  igAccountId: string;
  igUsername: string | null;
  pageId: string | null;
}

export interface InstagramResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
}

function errorMessage(data: any, fallback: string): string {
  return String(data?.error?.message || data?.error_description || data?.error || fallback);
}

export class InstagramClient {
  constructor(
    private readonly fetchImpl: InstagramFetch,
    private readonly baseUrl?: string,
  ) {}

  /**
   * يسرد صفحات Facebook التي يديرها المستخدم مع حساب Instagram المهني المرتبط بكل
   * صفحة (`GET /me/accounts?fields=...,instagram_business_account{id,username}`).
   * الصفحات بلا حساب مرتبط تُعاد بـigAccountId=null لتُستبعد بصراحة من الربط.
   */
  async listLinkedInstagramAccounts(userAccessToken: string): Promise<InstagramResult<InstagramLinkedPage[]>> {
    if (!userAccessToken) return { ok: false, data: null, error: 'رمز المستخدم غير متوفر.' };
    try {
      const u = new URL(instagramGraphUrl('/me/accounts', this.baseUrl));
      u.searchParams.set('fields', `id,name,access_token,${INSTAGRAM_ACCOUNT_FIELDS}`);
      u.searchParams.set('access_token', userAccessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) return { ok: false, data: null, error: errorMessage(data, 'تعذّر جلب صفحات/حسابات Instagram.') };
      const pages: InstagramLinkedPage[] = (Array.isArray(data?.data) ? data.data : [])
        .filter((p: any) => p?.id)
        .map((p: any) => ({
          pageId: String(p.id),
          pageName: p.name ? String(p.name) : null,
          pageAccessToken: p.access_token ? String(p.access_token) : null,
          igAccountId: p.instagram_business_account?.id ? String(p.instagram_business_account.id) : null,
          igUsername: p.instagram_business_account?.username ? String(p.instagram_business_account.username) : null,
        }));
      return { ok: true, data: pages };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـInstagram.') };
    }
  }

  /** يثبت حساب Instagram المهني المرتبط بصفحة (`GET /{page-id}?fields=instagram_business_account`). */
  async getLinkedInstagramAccount(pageId: string, pageAccessToken: string): Promise<InstagramResult<InstagramLinkedPage>> {
    if (!pageId || !pageAccessToken) return { ok: false, data: null, error: 'معرّف الصفحة ورمزها مطلوبان.' };
    try {
      const u = new URL(instagramGraphUrl(`/${pageId}`, this.baseUrl));
      u.searchParams.set('fields', `id,name,access_token,${INSTAGRAM_ACCOUNT_FIELDS}`);
      u.searchParams.set('access_token', pageAccessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) return { ok: false, data: null, error: errorMessage(data, 'تعذّر إثبات الحساب المرتبط بالصفحة.') };
      const ig = data.instagram_business_account;
      if (!ig?.id) return { ok: false, data: null, error: 'لا حساب Instagram للأعمال مرتبطاً بهذه الصفحة. اربط الحساب المهني بالصفحة من إعدادات Instagram أولاً.' };
      return {
        ok: true,
        data: {
          pageId: String(data.id),
          pageName: data.name ? String(data.name) : null,
          pageAccessToken: data.access_token ? String(data.access_token) : (pageAccessToken || null),
          igAccountId: String(ig.id),
          igUsername: ig.username ? String(ig.username) : null,
        },
      };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـInstagram.') };
    }
  }

  /** يثبت هوية حساب Instagram للأعمال (`GET /{ig-id}?fields=id,username`). */
  async getInstagramProfile(igAccountId: string, pageAccessToken: string): Promise<InstagramResult<InstagramAccountIdentity>> {
    if (!igAccountId || !pageAccessToken) return { ok: false, data: null, error: 'معرّف حساب Instagram والرمز مطلوبان.' };
    try {
      const u = new URL(instagramGraphUrl(`/${igAccountId}`, this.baseUrl));
      u.searchParams.set('fields', 'id,username');
      u.searchParams.set('access_token', pageAccessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) return { ok: false, data: null, error: errorMessage(data, 'تعذّر إثبات هوية حساب Instagram.') };
      return { ok: true, data: { igAccountId: String(data.id), igUsername: data.username ? String(data.username) : null, pageId: null } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـInstagram.') };
    }
  }

  /** يشترك تطبيقنا في أحداث الصفحة (تعليقات/رسائل Instagram تمرّ عبرها). */
  async subscribePage(pageId: string, pageAccessToken: string, fields: string[]): Promise<InstagramResult<boolean>> {
    if (!pageId || !pageAccessToken) return { ok: false, data: null, error: 'معرّف الصفحة ورمزها مطلوبان للاشتراك.' };
    try {
      const u = new URL(instagramGraphUrl(`/${pageId}/subscribed_apps`, this.baseUrl));
      u.searchParams.set('access_token', pageAccessToken);
      u.searchParams.set('subscribed_fields', fields.join(','));
      const res = await this.fetchImpl(u.toString(), { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || data?.success !== true) return { ok: false, data: null, error: errorMessage(data, 'تعذّر اشتراك الصفحة في webhook.') };
      return { ok: true, data: true };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـInstagram.') };
    }
  }

  /** يقرأ اشتراكات التطبيق الحالية للصفحة (لإثبات التسجيل). */
  async getSubscribedFields(pageId: string, pageAccessToken: string): Promise<InstagramResult<string[]>> {
    if (!pageId || !pageAccessToken) return { ok: false, data: null, error: 'معرّف الصفحة ورمزها مطلوبان.' };
    try {
      const u = new URL(instagramGraphUrl(`/${pageId}/subscribed_apps`, this.baseUrl));
      u.searchParams.set('access_token', pageAccessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) return { ok: false, data: null, error: errorMessage(data, 'تعذّر قراءة اشتراكات الصفحة.') };
      const fields = (Array.isArray(data?.data) ? data.data : []).flatMap((a: any) => Array.isArray(a?.subscribed_fields) ? a.subscribed_fields.map((f: any) => String(f)) : []);
      return { ok: true, data: fields };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـInstagram.') };
    }
  }

  /** يرد على تعليق Instagram حقيقي. لا نجاح بلا معرّف تعليق ردّ من Meta. */
  async replyToComment(commentId: string, pageAccessToken: string, message: string): Promise<InstagramResult<{ providerCommentId: string }>> {
    if (!commentId || !message?.trim()) return { ok: false, data: null, error: 'معرّف التعليق ونص الرد مطلوبان.' };
    try {
      const u = new URL(instagramGraphUrl(`/${commentId}/replies`, this.baseUrl));
      const res = await this.fetchImpl(u.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${pageAccessToken}` },
        body: buildInstagramReplyBody(message).toString(),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) return { ok: false, data: null, error: errorMessage(data, 'فشل الرد على التعليق عبر Instagram.') };
      return { ok: true, data: { providerCommentId: String(data.id) } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـInstagram.') };
    }
  }

  /** يرسل رسالة Instagram مباشرة (Messaging API). لا تسليم بلا معرّف رسالة من Meta. */
  async sendMessage(pageId: string, pageAccessToken: string, igsid: string, text: string): Promise<InstagramResult<{ providerMessageId: string; recipientId: string | null }>> {
    if (!pageId || !igsid || !text?.trim()) return { ok: false, data: null, error: 'معرّف الصفحة والمستلم ونص الرسالة مطلوبة.' };
    try {
      const u = new URL(instagramGraphUrl(`/${pageId}/messages`, this.baseUrl));
      u.searchParams.set('access_token', pageAccessToken);
      const res = await this.fetchImpl(u.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: buildInstagramMessagePayload(igsid, text),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.message_id) return { ok: false, data: null, error: errorMessage(data, 'فشل إرسال الرسالة عبر Instagram.') };
      return { ok: true, data: { providerMessageId: String(data.message_id), recipientId: data.recipient_id ? String(data.recipient_id) : null } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـInstagram.') };
    }
  }

  /** ينشئ حاوية وسائط (الخطوة الأولى للنشر). لا نجاح بلا معرّف حاوية من Meta. */
  async createMediaContainer(igAccountId: string, pageAccessToken: string, input: InstagramPublishInput): Promise<InstagramResult<{ containerId: string; mediaKind: string }>> {
    if (!igAccountId) return { ok: false, data: null, error: 'معرّف حساب Instagram مطلوب.' };
    const built = buildMediaContainerBody(input);
    if (!built.ok) return { ok: false, data: null, error: built.error };
    try {
      const u = new URL(instagramGraphUrl(`/${igAccountId}/media`, this.baseUrl));
      u.searchParams.set('access_token', pageAccessToken);
      const res = await this.fetchImpl(u.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: built.body.toString(),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) return { ok: false, data: null, error: errorMessage(data, 'فشل إنشاء حاوية النشر عبر Instagram.') };
      return { ok: true, data: { containerId: String(data.id), mediaKind: String(built.mediaKind) } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـInstagram.') };
    }
  }

  /** ينشر الحاوية (الخطوة الثانية). لا نجاح بلا معرّف منشور من Meta. */
  async publishContainer(igAccountId: string, pageAccessToken: string, creationId: string): Promise<InstagramResult<{ providerPostId: string }>> {
    if (!igAccountId || !creationId) return { ok: false, data: null, error: 'معرّف حساب Instagram ومعرّف الحاوية مطلوبان.' };
    try {
      const u = new URL(instagramGraphUrl(`/${igAccountId}/media_publish`, this.baseUrl));
      u.searchParams.set('access_token', pageAccessToken);
      const res = await this.fetchImpl(u.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: buildPublishContainerBody(creationId).toString(),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) return { ok: false, data: null, error: errorMessage(data, 'فشل نشر الحاوية عبر Instagram.') };
      return { ok: true, data: { providerPostId: String(data.id) } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـInstagram.') };
    }
  }

  /** يقرأ حالة الحاوية (للتشخيص عند تأخر معالجة الفيديو). */
  async getContainerStatus(containerId: string, pageAccessToken: string): Promise<InstagramResult<{ statusCode: string | null }>> {
    if (!containerId) return { ok: false, data: null, error: 'معرّف الحاوية مطلوب.' };
    try {
      const u = new URL(instagramGraphUrl(`/${containerId}`, this.baseUrl));
      u.searchParams.set('fields', 'status_code,status');
      u.searchParams.set('access_token', pageAccessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) return { ok: false, data: null, error: errorMessage(data, 'تعذّر قراءة حالة الحاوية.') };
      return { ok: true, data: { statusCode: data.status_code ? String(data.status_code) : null } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـInstagram.') };
    }
  }
}
