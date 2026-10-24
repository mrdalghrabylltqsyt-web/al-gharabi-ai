/**
 * موصل WhatsApp Business Cloud API الحقيقي — إكمال حلقة المنصّات الرسائلية.
 *
 * الفجوة التي يُغلقها: كان WhatsApp يستقبل webhook فقط (تطبيع داخل
 * `normalizeMetaEvents` في server.ts) بلا أي **إرسال** ولا تحقّق هوية ولا نافذة
 * مراسلة — فلا يمكن الرد على زبون أصلاً. هذا الموصل يبني الدورة كاملة بنفس مبادئ
 * بقية الموصلات (Telegram/Facebook/Instagram/Threads): لا يُعلن اتصال بلا تحقّق
 * حقيقي من المزود، ولا تسليم بلا معرّف رسالة من Meta.
 *
 * الحقائق الرسمية المستخدمة (Meta Cloud API):
 * - الإرسال: `POST /{phone-number-id}/messages` بترويسة `Authorization: Bearer`.
 * - التحقّق: `GET /{phone-number-id}?fields=id,display_phone_number,verified_name`
 *   — لا يُعلن اتصال بلا استجابة مزود حقيقية.
 * - **نافذة 24 ساعة**: يمكن إرسال رسالة نصية حرة فقط خلال 24 ساعة من آخر رسالة
 *   للعميل. خارجها يجب استخدام **قالب معتمد** (`type=template`)؛ وإلا يرد Meta
 *   بخطأ النافذة (كود 131047). عند غياب قالب مُهيّأ ⇒ حجب الإرسال بسبب صريح.
 * - الاستقبال: `entry[].changes[].value.messages[]` (نص) و`value.statuses[]`
 *   (حالة التسليم). معرّف الرسالة (`wamid...`) هو أساس منع التكرار.
 *
 * كل الأسرار تُمرَّر كوسائط وتُحفظ مشفّرة في طبقة الخادم؛ لا تُسجَّل هنا أبداً.
 * الدوال الحتمية (بناء الطلب، التطبيع، التصنيف، حارس النافذة) مفصولة عن عميل
 * الشبكة لتُختبر بلا أي مزود.
 */

import { extractFacebookGraphError, formatFacebookGraphError } from './facebook';
import { createRetryingProviderFetch, providerRetryConfig } from './providerRetry';
import type { NormalizedSocialEvent } from './webhook';
import { buildNormalizedEvent } from './webhook';

export const WHATSAPP_GRAPH_BASE = 'https://graph.facebook.com';
export const WHATSAPP_GRAPH_VERSION = 'v21.0';

/**
 * نافذة مراسلة WhatsApp الرسمية: 24 ساعة من آخر رسالة للعميل. مطابقة لسياسة Meta
 * ونفس ثابت نافذة مراسلة العقل التجاري (`COMMERCIAL_META_MESSAGE_WINDOW_HOURS`)
 * فلا يوجد رقمان متباعدان لنفس القيد.
 */
export const WHATSAPP_MESSAGE_WINDOW_HOURS = 24;

/**
 * كود خطأ Meta الصريح لانتهاء نافذة الـ24 ساعة:
 * «Message failed to send because more than 24 hours have passed since the
 * customer last replied». المصدر: WhatsApp Cloud API error codes (131047).
 */
export const WHATSAPP_WINDOW_CLOSED_CODE = 131047;

/** أكواد قوالب WhatsApp: قالب غير موجود/غير معتمد (132001) أو معاملاته غير مطابقة (132000). */
export const WHATSAPP_TEMPLATE_CODES: readonly number[] = Object.freeze([132000, 132001, 132005, 132007, 132012, 132015]);

/** قاعدة Graph الفعلية؛ تُتجاوز في الاختبار فقط (خادم وهمي محلي). */
export function whatsappGraphBase(override?: string): string {
  const base = override || process.env.WHATSAPP_API_BASE || WHATSAPP_GRAPH_BASE;
  return base.replace(/\/+$/, '');
}

/** نسخة Graph API؛ قابلة للتجاوز عبر البيئة للاختبار فقط. */
export function whatsappGraphVersion(override?: string): string {
  const v = override || process.env.WHATSAPP_API_VERSION || WHATSAPP_GRAPH_VERSION;
  return v.replace(/^\/+|\/+$/g, '');
}

/** يبني رابط Graph كامل لمسار WhatsApp (بلا رمز في أي سجل). */
export function whatsappGraphUrl(path: string, baseOverride?: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${whatsappGraphBase(baseOverride)}/${whatsappGraphVersion()}/${suffix.replace(/^\/+/, '')}`;
}

// ---------------------------------------------------------------------------
// أسماء متغيرات البيئة (أسماء فقط، بلا أي قيمة سرّية)
// ---------------------------------------------------------------------------

export const WHATSAPP_ENV_NAMES = Object.freeze({
  phoneNumberId: 'WHATSAPP_PHONE_NUMBER_ID',
  accessToken: 'WHATSAPP_ACCESS_TOKEN',
  appSecret: 'WHATSAPP_APP_SECRET',
  verifyToken: 'WHATSAPP_VERIFY_TOKEN',
  defaultTemplate: 'WHATSAPP_DEFAULT_TEMPLATE',
  defaultTemplateLanguage: 'WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE',
});

/** رقم هاتف الأعمال (Phone Number ID) من البيئة — لا يُعاد في أي مخرَج سرّي. */
export function whatsappPhoneNumberIdFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return String(env[WHATSAPP_ENV_NAMES.phoneNumberId] || '').trim();
}

/** رمز وصول Cloud API من البيئة. */
export function whatsappAccessTokenFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return String(env[WHATSAPP_ENV_NAMES.accessToken] || '').trim();
}

/** قالب الرسائل الافتراضي المُهيّأ (اسم فقط؛ الاعتماد لدى Meta لا يُدَّعى هنا). */
export function whatsappDefaultTemplateFromEnv(env: NodeJS.ProcessEnv = process.env): { name: string; language: string } | null {
  const name = String(env[WHATSAPP_ENV_NAMES.defaultTemplate] || '').trim();
  if (!name) return null;
  const language = String(env[WHATSAPP_ENV_NAMES.defaultTemplateLanguage] || 'ar').trim() || 'ar';
  return { name, language };
}

// ---------------------------------------------------------------------------
// بناء الطلبات (حتمي، بلا شبكة)
// ---------------------------------------------------------------------------

export interface WhatsAppTextInput {
  to: string;
  text: string;
  /** معاينة الروابط (افتراضياً معطّلة — نصوص الرد قصيرة بلا روابط). */
  previewUrl?: boolean;
}

/**
 * جسم رسالة نصية حرة. تُقبل فقط داخل نافذة الـ24 ساعة؛ الحارس مسؤولية المستدعي
 * (`evaluateWhatsAppSend`)، فلا نبني طلباً يرفضه Meta بلا سبب معلن.
 */
export function buildWhatsAppTextBody(input: WhatsAppTextInput): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(input.to || '').trim(),
    type: 'text',
    text: { preview_url: input.previewUrl === true, body: String(input.text || '').trim() },
  };
}

export interface WhatsAppTemplateInput {
  to: string;
  /** اسم القالب المعتمد لدى Meta (يُمرَّر كما هو؛ لا ندّعي اعتماده). */
  name: string;
  /** رمز لغة القالب (مثلاً `ar` أو `ar_IQ`). */
  language: string;
  /** معاملات متغيّرات القالب (نصوص بترتيب {{1}}..{{n}}) — اختيارية. */
  bodyParams?: string[];
}

/** جسم رسالة قالب. يُستخدم خارج نافذة الـ24 ساعة حصراً. */
export function buildWhatsAppTemplateBody(input: WhatsAppTemplateInput): Record<string, unknown> {
  const params = Array.isArray(input.bodyParams) ? input.bodyParams.map((p) => String(p)) : [];
  const template: Record<string, unknown> = {
    name: String(input.name || '').trim(),
    language: { code: String(input.language || 'ar').trim() },
  };
  if (params.length) {
    template.components = [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }];
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(input.to || '').trim(),
    type: 'template',
    template,
  };
}

// ---------------------------------------------------------------------------
// حارس نافذة الـ24 ساعة + قرار الإرسال (منطق صافٍ قابل للاختبار)
// ---------------------------------------------------------------------------

export type WhatsAppSendMode = 'text' | 'template' | 'blocked';

export interface WhatsAppSendDecision {
  mode: WhatsAppSendMode;
  /** داخل نافذة الـ24 ساعة (يُسمح بالنص الحر)؟ */
  withinWindow: boolean;
  /** كود صريح عند الحجب — لا حجب صامت. */
  code: string | null;
  reason: string;
  /** القالب المطلوب خارج النافذة (إن وُجد مُهيّأ). */
  template: { name: string; language: string } | null;
}

/**
 * يقرّر شكل الإرسال قبل أي نداء مزود:
 *  - داخل النافذة ⇒ نص حر.
 *  - خارج النافذة + قالب مُهيّأ ⇒ قالب معتمد.
 *  - خارج النافذة بلا قالب ⇒ **حجب** بسبب صريح (لا إرسال يخالف سياسة Meta).
 * لا يخترع قالباً ولا يدّعي اعتماده.
 */
export function evaluateWhatsAppSend(input: {
  lastCustomerMessageAt: string | null | undefined;
  nowIso: string;
  template: { name: string; language: string } | null;
  windowHours?: number;
}): WhatsAppSendDecision {
  const hours = Number.isFinite(Number(input.windowHours)) && Number(input.windowHours) > 0
    ? Number(input.windowHours)
    : WHATSAPP_MESSAGE_WINDOW_HOURS;
  const last = Date.parse(String(input.lastCustomerMessageAt || ''));
  const now = Date.parse(input.nowIso);
  // غياب وقت آخر رسالة ⇒ لا أساس ⇒ لا نص حر (نطلب قالباً أو نحجب).
  const withinWindow = Number.isFinite(last) && Number.isFinite(now) && now - last < hours * 3600_000;
  if (withinWindow) {
    return { mode: 'text', withinWindow: true, code: null, reason: `داخل نافذة المراسلة (${hours} ساعة) — يُسمح بالنص الحر.`, template: input.template };
  }
  if (input.template && input.template.name) {
    return { mode: 'template', withinWindow: false, code: null, reason: `خارج النافذة (${hours} ساعة) — يُرسل قالب معتمد فقط.`, template: input.template };
  }
  return {
    mode: 'blocked', withinWindow: false, code: 'WHATSAPP_WINDOW_CLOSED_NO_TEMPLATE',
    reason: `خارج نافذة المراسلة (${hours} ساعة) ولا قالب معتمد مُهيّأ — حُجب الإرسال بدل مخالفة سياسة WhatsApp.`,
    template: null,
  };
}

// ---------------------------------------------------------------------------
// تطبيع الرسائل الواردة وحالات التسليم (حتمي)
// ---------------------------------------------------------------------------

/** معرّف رسالة WhatsApp الحقيقي (`wamid...`) — أساس منع التكرار. */
export function isPlausibleWhatsAppMessageId(value: unknown): boolean {
  return typeof value === 'string' && /^wamid\.[A-Za-z0-9+/=_-]{8,}$/.test(value);
}

/**
 * يطبّع حمولة webhook الخاصة بـWhatsApp إلى أحداث موحّدة (نص فقط). أي شكل غير
 * معروف (وسائط/موقع/تفاعل) يُعاد [] بلا خطأ حتى لا يعيد المزود المحاولة.
 * الرد على العميل يكون بمعرّف هاتفه (`from`) — هدف الرد الحقيقي.
 */
export function normalizeWhatsAppInbound(payload: any): NormalizedSocialEvent[] {
  const events: NormalizedSocialEvent[] = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      // اسم المرسل الحقيقي من جهات الاتصال إن أعلنه المزود (لا اختراع).
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      const contactByWaId = new Map<string, string>();
      for (const c of contacts) {
        const waId = c?.wa_id ? String(c.wa_id) : '';
        const name = c?.profile?.name ? String(c.profile.name) : '';
        if (waId && name) contactByWaId.set(waId, name);
      }
      for (const msg of messages) {
        const text = String(msg?.text?.body ?? '').trim();
        const externalId = msg?.id ? String(msg.id) : '';
        const from = msg?.from ? String(msg.from) : '';
        if (!text || !externalId || !from) continue;
        events.push(buildNormalizedEvent({
          platform: 'whatsapp',
          kind: 'message',
          externalId,
          parentExternalId: from,
          authorName: contactByWaId.get(from) || null,
          authorId: from,
          text,
          createdAt: msg?.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : undefined,
          replyTarget: { recipientId: from, waId: from, phoneNumberId: value?.metadata?.phone_number_id ? String(value.metadata.phone_number_id) : null },
          raw: { source: 'whatsapp_messages' },
        }));
      }
    }
  }
  return events;
}

export interface WhatsAppDeliveryStatus {
  messageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipientId: string | null;
  at: string | null;
  errorCode: number | null;
  errorMessage: string | null;
}

/** يستخرج حالات التسليم (`statuses[]`) — تُستخدم للمصالحة، بلا اختراع حالة. */
export function parseWhatsAppStatuses(payload: any): WhatsAppDeliveryStatus[] {
  const out: WhatsAppDeliveryStatus[] = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      for (const st of Array.isArray(change?.value?.statuses) ? change.value.statuses : []) {
        const id = st?.id ? String(st.id) : '';
        const status = String(st?.status || '').toLowerCase();
        if (!id || !['sent', 'delivered', 'read', 'failed'].includes(status)) continue;
        const err = Array.isArray(st?.errors) ? st.errors[0] : null;
        out.push({
          messageId: id,
          status: status as WhatsAppDeliveryStatus['status'],
          recipientId: st?.recipient_id ? String(st.recipient_id) : null,
          at: st?.timestamp ? new Date(Number(st.timestamp) * 1000).toISOString() : null,
          errorCode: err?.code !== undefined ? Number(err.code) : null,
          errorMessage: err?.title ? String(err.title) : (err?.message ? String(err.message) : null),
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// تصنيف أخطاء المزود (لا يُخفي رسالة Meta)
// ---------------------------------------------------------------------------

/**
 * يصنّف خطأ WhatsApp بكود داخلي صريح مع إبقاء رسالة Meta كما هي. يميّز **انتهاء
 * النافذة** (131047) عن قالب غير معتمد عن رمز/صلاحية عن شبكة — فلا يُعرض عطل
 * نافذة كأنه عطل صلاحية.
 */
export function classifyWhatsAppProviderError(message: string, providerCode: number | null): string {
  const m = String(message || '').toLowerCase();
  if (providerCode === WHATSAPP_WINDOW_CLOSED_CODE || /24 hours|re-engagement|reengagement|message window/.test(m)) {
    return 'WHATSAPP_WINDOW_CLOSED';
  }
  if (providerCode !== null && WHATSAPP_TEMPLATE_CODES.includes(providerCode)) {
    return 'WHATSAPP_TEMPLATE_INVALID';
  }
  if (providerCode === 190 || /access token|session has expired|expired|validate access|oauth/.test(m)) {
    return 'TOKEN_EXPIRED';
  }
  if (providerCode === 10 || providerCode === 200 || /permission|not authorized|no permission/.test(m)) {
    return 'PERMISSION_DENIED';
  }
  return 'PROVIDER_ERROR';
}

// ---------------------------------------------------------------------------
// عميل الشبكة
// ---------------------------------------------------------------------------

export type WhatsAppFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

/** F-14: غلاف fetch بإعادة محاولة آمنة (قراءة فقط تُعاد؛ الكتابة لا تُعاد أبداً). */
export function createWhatsAppFetch(
  baseFetch: (url: string, init: any) => Promise<any>,
  overrides: Parameters<typeof providerRetryConfig>[1] = {},
): WhatsAppFetch {
  return createRetryingProviderFetch(baseFetch, { config: providerRetryConfig(process.env, overrides) }) as WhatsAppFetch;
}

export interface WhatsAppResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
  code?: string;
  providerCode?: number | null;
  providerSubcode?: number | null;
  providerTraceId?: string | null;
}

function errorMessage(data: any, fallback: string): string {
  return String(data?.error?.message || data?.error_description || data?.error || fallback);
}

export interface WhatsAppPhoneIdentity {
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}

export class WhatsAppClient {
  constructor(
    private readonly fetchImpl: WhatsAppFetch,
    private readonly baseUrl?: string,
  ) {}

  /**
   * يثبت أن (Phone Number ID + Access Token) يمثّلان رقم أعمال حقيقياً لدى Meta
   * عبر `GET /{phone-number-id}`. لا يُعلن أي اتصال بلا استجابة مزود حقيقية،
   * ولا يُعاد أي رمز في المخرَج.
   */
  async verifyPhoneNumber(phoneNumberId: string, accessToken: string): Promise<WhatsAppResult<WhatsAppPhoneIdentity>> {
    if (!phoneNumberId || !accessToken) return { ok: false, data: null, error: 'معرّف رقم الأعمال ورمز الوصول مطلوبان.', code: 'CREDENTIALS_MISSING' };
    try {
      const u = new URL(whatsappGraphUrl(`/${phoneNumberId}`, this.baseUrl));
      u.searchParams.set('fields', 'id,display_phone_number,verified_name');
      const res = await this.fetchImpl(u.toString(), { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) {
        const ex = extractFacebookGraphError(data, `GET /${phoneNumberId}`, res.status);
        const msg = errorMessage(data, 'تعذّر إثبات رقم أعمال WhatsApp.');
        const pCode = ex.code ?? null;
        return { ok: false, data: null, error: msg, providerCode: pCode, providerSubcode: ex.subcode, providerTraceId: ex.fbtraceId, code: classifyWhatsAppProviderError(msg, pCode) };
      }
      return {
        ok: true,
        data: {
          phoneNumberId: String(data.id),
          displayPhoneNumber: data.display_phone_number ? String(data.display_phone_number) : null,
          verifiedName: data.verified_name ? String(data.verified_name) : null,
        },
      };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـWhatsApp.'), code: 'NETWORK_ERROR' };
    }
  }

  /** يرسل رسالة نصية حرة (داخل نافذة الـ24 ساعة). لا نجاح بلا معرّف رسالة من Meta. */
  async sendText(phoneNumberId: string, accessToken: string, to: string, text: string): Promise<WhatsAppResult<{ providerMessageId: string; waId: string | null }>> {
    return this.send(phoneNumberId, accessToken, buildWhatsAppTextBody({ to, text }), `POST /${phoneNumberId}/messages(text)`);
  }

  /** يرسل قالباً معتمداً (خارج نافذة الـ24 ساعة). لا نجاح بلا معرّف رسالة من Meta. */
  async sendTemplate(phoneNumberId: string, accessToken: string, input: WhatsAppTemplateInput): Promise<WhatsAppResult<{ providerMessageId: string; waId: string | null }>> {
    return this.send(phoneNumberId, accessToken, buildWhatsAppTemplateBody(input), `POST /${phoneNumberId}/messages(template)`);
  }

  private async send(phoneNumberId: string, accessToken: string, body: Record<string, unknown>, endpoint: string): Promise<WhatsAppResult<{ providerMessageId: string; waId: string | null }>> {
    if (!phoneNumberId || !accessToken) return { ok: false, data: null, error: 'معرّف رقم الأعمال ورمز الوصول مطلوبان.', code: 'CREDENTIALS_MISSING' };
    try {
      const u = new URL(whatsappGraphUrl(`/${phoneNumberId}/messages`, this.baseUrl));
      const res = await this.fetchImpl(u.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      const messageId = data?.messages?.[0]?.id ? String(data.messages[0].id) : '';
      if (!res.ok || data?.error || !messageId) {
        const ex = extractFacebookGraphError(data, endpoint, res.status);
        const msg = errorMessage(data, 'فشل إرسال الرسالة عبر WhatsApp.');
        const pCode = ex.code ?? null;
        console.error(formatFacebookGraphError(ex));
        return { ok: false, data: null, error: msg, providerCode: pCode, providerSubcode: ex.subcode, providerTraceId: ex.fbtraceId, code: classifyWhatsAppProviderError(msg, pCode) };
      }
      const waId = data?.contacts?.[0]?.wa_id ? String(data.contacts[0].wa_id) : null;
      return { ok: true, data: { providerMessageId: messageId, waId } };
    } catch (e: any) {
      // F-07: انقطاع بعد الإرسال بلا رد مزود — لا يُصنَّف فشلاً مؤكداً.
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـWhatsApp.'), code: 'NETWORK_ERROR' };
    }
  }

  /** يقرأ حالة رسالة أُرسلت (`GET /{message-id}?fields=status`) — للمصالحة فقط. */
  async getMessageStatus(messageId: string, accessToken: string): Promise<WhatsAppResult<{ status: string }>> {
    if (!messageId || !accessToken) return { ok: false, data: null, error: 'معرّف الرسالة والرمز مطلوبان.' };
    try {
      const u = new URL(whatsappGraphUrl(`/${messageId}`, this.baseUrl));
      u.searchParams.set('fields', 'status');
      const res = await this.fetchImpl(u.toString(), { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.status) {
        const ex = extractFacebookGraphError(data, `GET /${messageId}`, res.status);
        return { ok: false, data: null, error: errorMessage(data, 'تعذّر قراءة حالة رسالة WhatsApp.'), providerCode: ex.code ?? null, providerTraceId: ex.fbtraceId, code: classifyWhatsAppProviderError(errorMessage(data, ''), ex.code ?? null) };
      }
      return { ok: true, data: { status: String(data.status) } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـWhatsApp.'), code: 'NETWORK_ERROR' };
    }
  }
}
