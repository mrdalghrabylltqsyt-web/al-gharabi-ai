/**
 * موصل Telegram الحقيقي — أول تكامل اجتماعي خارجي فعلي.
 *
 * سبب اختيار Telegram أولاً: هو المنصة الوحيدة المدعومة التي تصل إلى حالة
 * «متصل ومتحقق + إرسال حقيقي» بـ**رمز بوت فقط**، بلا تسجيل تطبيق خارجي ولا
 * مراجعة OAuth ولا client secret. بقية المنصات تحتاج تسجيل تطبيق وموافقة
 * مراجعة لا يمكن إتمامها من داخل المشروع.
 *
 * الحقائق التقنية الرسمية المستخدمة هنا:
 * - الاتصال: `getMe` يثبت الرمز ويعيد معرّف البوت واسمه. لا يُعلن اتصال بدونه.
 * - الاستقبال: Telegram يدفع التحديثات إلى webhook، ويُضمّن ترويسة
 *   `X-Telegram-Bot-Api-Secret-Token` (نص سرّي يحدَّده المستدعي عبر setWebhook).
 *   Telegram لا يوقّع الجسم بـHMAC؛ لذا الترويسة السرّية هي آلية التوقيع،
 *   وتُقارن بزمن ثابت.
 * - منع التكرار: `update_id` معرّف حدث متزايد، فيمنع إعادة الإرسال (replay/retry).
 * - الإرسال: `sendMessage` مع chat_id ونص؛ لا يُسجَّل تسليم إلا إذا أعاد
 *   Telegram `ok:true` و`message_id` حقيقي.
 *
 * كل الأسرار تُمرَّر كوسائط وتُحفظ مشفّرة في طبقة الخادم؛ لا تُسجَّل هنا أبداً.
 * الدوال الحتمية (التحقق/التحليل/بناء الطلب) مفصولة عن عميل الشبكة حتى تُختبر
 * بلا اتصال حقيقي.
 */

import crypto from 'node:crypto';

export const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * القاعدة الفعلية لاستدعاءات API. تُقرأ من `TELEGRAM_API_BASE` للاختبار فقط
 * (خادم Telegram وهمي محلي)، فلا تُشغَّل اختبارات الشبكة على مزود حقيقي.
 * في الإنتاج تبقى القاعدة الرسمية.
 */
export function telegramApiBase(override?: string): string {
  const base = override || process.env.TELEGRAM_API_BASE || TELEGRAM_API_BASE;
  return base.replace(/\/+$/, '');
}

/** ترويسة Telegram السرّية التي تُرسل مع كل تحديث عند ضبط secret_token. */
export const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * مقارنة بزمن ثابت. الفرق في الطول يعود false فوراً، والمحتوى يُقارن عبر
 * `timingSafeEqual` لمنع هجمات التوقيت.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length || ab.length === 0) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * يتحقق من أن التحديث الوارد موثوق فعلاً من Telegram.
 * يفشل إن كان السرّ غير مضبوط (لا قبول تحديثات بلا تحقق)، أو غابت الترويسة،
 * أو اختلفت. أي payload مزيف يُرفض هنا قبل أي تحليل أو تخزين.
 */
export function verifyTelegramSecret(input: {
  header: string | undefined | null;
  expectedSecret: string;
}): { ok: boolean; reason?: string } {
  if (!input.expectedSecret) return { ok: false, reason: 'سرّ webhook غير مضبوط؛ رُفض التحديث لحماية النظام.' };
  if (!input.header) return { ok: false, reason: 'الترويسة السرّية غائبة؛ التحديث غير موثوق.' };
  if (!constantTimeEqual(String(input.header), input.expectedSecret)) {
    return { ok: false, reason: 'الترويسة السرّية غير مطابقة؛ التحديث غير موثوق.' };
  }
  return { ok: true };
}

export interface InboundTelegramMessage {
  /** معرّف التحديث (update_id) — يُستخدم لمنع التكرار. */
  updateId: number;
  /** معرّف الدردشة المصدر. */
  chatId: string;
  /** معرّف الرسالة نفسه — يُستخدم لمنع الرد على نفس الرسالة مرتين. */
  messageId: string;
  text: string;
  authorName?: string;
  date?: string;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    date?: number;
    text?: string;
    caption?: string;
    chat?: { id?: number | string; type?: string; title?: string };
    from?: { id?: number; first_name?: string; last_name?: string; username?: string };
  };
  edited_message?: unknown;
  channel_post?: unknown;
}

/** يحلل تحديث Telegram إلى رسالة داخلية، أو يعيد null إن لم يكن نصاً وارداً. */
export function parseTelegramUpdate(update: TelegramUpdate | null | undefined): InboundTelegramMessage | null {
  if (!update || typeof update !== 'object') return null;
  const msg = update.message;
  if (!msg || typeof msg !== 'object') return null;
  const text = typeof msg.text === 'string' ? msg.text.trim() : typeof msg.caption === 'string' ? msg.caption.trim() : '';
  if (!text) return null;
  const chatId = msg.chat?.id;
  const messageId = msg.message_id;
  if (chatId === undefined || chatId === null || messageId === undefined || messageId === null) return null;
  if (typeof update.update_id !== 'number' || !Number.isFinite(update.update_id)) return null;
  const from = msg.from;
  const authorName = from
    ? [from.first_name, from.last_name].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ') || (from.username ? `@${from.username}` : undefined)
    : msg.chat?.title;
  return {
    updateId: update.update_id,
    chatId: String(chatId),
    messageId: String(messageId),
    text,
    authorName: authorName || undefined,
    date: typeof msg.date === 'number' ? new Date(msg.date * 1000).toISOString() : undefined,
  };
}

/**
 * معرّف التعليق/الرسالة الخارجي الموحّد لمنع الرد المكرر. يجمع الدردشة والرسالة
 * لأنه قد تتكرر معرّفات الرسائل بين الدردشات المختلفة.
 */
export function telegramExternalId(chatId: string, messageId: string): string {
  return `tg:${chatId}:${messageId}`;
}

/**
 * بوابة منع التكرار: التحديث نفسه (update_id) أو الرسالة نفسها لا تُعالج مرتين.
 * تُستخدم عند إعادة إرسال webhook من Telegram (retry) أو إعادة تشغيل حدث.
 */
export function isDuplicateUpdate(input: {
  updateId: number;
  externalId: string;
  seenUpdateIds: number[];
  seenExternalIds: string[];
}): boolean {
  if (input.seenUpdateIds.includes(input.updateId)) return true;
  if (input.seenExternalIds.includes(input.externalId)) return true;
  return false;
}

export interface TelegramSendRequest {
  chatId: string;
  text: string;
  replyToMessageId?: string;
}

/** يبني جسم طلب sendMessage الرسمي (حتمي، قابل للاختبار بلا شبكة). */
export function buildSendMessageBody(req: TelegramSendRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { chat_id: req.chatId, text: req.text };
  if (req.replyToMessageId) {
    const asNumber = Number(req.replyToMessageId);
    body.reply_to_message_id = Number.isFinite(asNumber) ? asNumber : req.replyToMessageId;
  }
  // بلا معاينة روابط لتفادي مظهر سبام؛ لا يغيّر المحتوى نفسه.
  body.link_preview_options = { is_disabled: true };
  return body;
}

/** يبني رابط استدعاء API لبوت محدّد، بلا كشف الرمز في أي سجل. */
export function telegramApiUrl(method: string, botToken: string, baseOverride?: string): string {
  return `${telegramApiBase(baseOverride)}/bot${encodeURIComponent(botToken)}/${method}`;
}

export type TelegramFetch = (url: string, init: { method: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export interface TelegramSendResult {
  ok: boolean;
  providerMessageId: string | null;
  receipt: Record<string, unknown> | null;
  error?: string;
}

export interface TelegramGetMeResult {
  ok: boolean;
  botId: string | null;
  username: string | null;
  firstName: string | null;
  error?: string;
}

/** حالة webhook الحقيقية كما يعيدها Telegram عبر getWebhookInfo (مُنقّاة من أي سرّ). */
export interface TelegramWebhookInfo {
  ok: boolean;
  /** الرابط المسجّل حالياً لدى Telegram (null يعني لا webhook). */
  url: string | null;
  pendingUpdateCount: number;
  /** آخر خطأ دفع من Telegram تجاه رابط الـwebhook (إن وُجد). */
  lastErrorDate: string | null;
  lastErrorMessage: string | null;
  /** آخر خطأ مزامنة (getUpdates/deleteWebhook...) — منفصل عن خطأ الدفع. */
  lastSynchronizationErrorDate: string | null;
  maxConnections: number | null;
  allowedUpdates: string[] | null;
  error?: string;
}

/** تقييم تسجيل webhook مقارنةً بالرابط المتوقع منه في هذا الخادم. */
export type WebhookRegistrationStatus =
  | 'registered'
  | 'not_registered'
  | 'url_mismatch'
  | 'secret_missing'
  | 'unavailable';

/**
 * ينقّي استجابة getWebhookInfo إلى الحقول الآمنة فقط.
 * لا يعيد أي رمز بوت ولا سرّ (Telegram لا يعيد السرّ أصلاً)، فيمكن عرضه للمالك.
 */
export function sanitizeWebhookInfo(data: any): TelegramWebhookInfo {
  const r = data?.result && typeof data.result === 'object' ? data.result : {};
  const toIso = (v: any): string | null => (typeof v === 'number' && Number.isFinite(v) ? new Date(v * 1000).toISOString() : null);
  return {
    ok: Boolean(data?.ok),
    url: typeof r.url === 'string' && r.url ? r.url : null,
    pendingUpdateCount: Number.isFinite(Number(r.pending_update_count)) ? Number(r.pending_update_count) : 0,
    lastErrorDate: toIso(r.last_error_date),
    lastErrorMessage: typeof r.last_error_message === 'string' && r.last_error_message ? r.last_error_message : null,
    lastSynchronizationErrorDate: toIso(r.last_synchronization_error_date),
    maxConnections: Number.isFinite(Number(r.max_connections)) ? Number(r.max_connections) : null,
    allowedUpdates: Array.isArray(r.allowed_updates) ? r.allowed_updates.map((x: any) => String(x)) : null,
  };
}

/**
 * يفحص هل الـwebhook مسجّل فعلاً على الرابط المتوقع وبنفس السرّ.
 * لا يمكن لـTelegram أن يعيد السرّ، لذا يُعلن «secret_missing» عند غياب
 * السرّ من جهة الخادم بصراحة بدل ادعاء تسجيل سليم.
 */
export function checkWebhookRegistration(input: {
  info: TelegramWebhookInfo;
  expectedUrl: string;
  secretConfigured: boolean;
}): { status: WebhookRegistrationStatus; matchesExpectedUrl: boolean; detail: string } {
  if (!input.info.ok) {
    return { status: 'unavailable', matchesExpectedUrl: false, detail: input.info.error || 'تعذّر استعلام Telegram عن حالة الـwebhook.' };
  }
  if (!input.info.url) {
    return { status: 'not_registered', matchesExpectedUrl: false, detail: 'لا يوجد webhook مسجّل لدى Telegram؛ أعد الضبط لتسجيل رابط الاستقبال.' };
  }
  const matchesExpectedUrl = input.info.url.replace(/\/+$/, '') === input.expectedUrl.replace(/\/+$/, '');
  if (!matchesExpectedUrl) {
    return { status: 'url_mismatch', matchesExpectedUrl: false, detail: `الرابط المسجّل لدى Telegram (${input.info.url}) لا يطابق رابط هذا الخادم (${input.expectedUrl})؛ أعد الضبط بعد تصحيح APP_URL.` };
  }
  if (!input.secretConfigured) {
    return { status: 'secret_missing', matchesExpectedUrl: true, detail: 'الرابط مسجّل لكن لا سرّ webhook محفوظ في الخادم؛ ستُرفض كل التحديثات الواردة.' };
  }
  return { status: 'registered', matchesExpectedUrl: true, detail: 'الـwebhook مسجّل على رابط هذا الخادم وسرّه محفوظ.' };
}

/**
 * عميل Telegram الحقيقي. يستقبل `fetchImpl` للحقن، فتُختبر الدورة كاملة
 * (نجاح/فشل/استجابة مشوّهة) بلا أي اتصال شبكي في الاختبارات.
 * `baseUrl` يُضبط في الاختبار فقط لتوجيه الطلبات إلى خادم وهمي محلي.
 */
export class TelegramClient {
  constructor(
    private readonly botToken: string,
    private readonly fetchImpl: TelegramFetch,
    private readonly baseUrl?: string,
  ) {}

  /** يثبت الرمز فعلياً لدى Telegram ويعيد هوية البوت. لا نجاح بلا استجابة صحيحة. */
  async getMe(): Promise<TelegramGetMeResult> {
    if (!this.botToken) return { ok: false, botId: null, username: null, firstName: null, error: 'رمز البوت غير متوفر.' };
    try {
      const res = await this.fetchImpl(telegramApiUrl('getMe', this.botToken, this.baseUrl), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.result?.id) {
        return { ok: false, botId: null, username: null, firstName: null, error: String(data?.description || 'تعذر التحقق من رمز البوت.') };
      }
      return {
        ok: true,
        botId: String(data.result.id),
        username: data.result.username ? String(data.result.username) : null,
        firstName: data.result.first_name ? String(data.result.first_name) : null,
      };
    } catch (e: any) {
      return { ok: false, botId: null, username: null, firstName: null, error: String(e?.message || 'فشل الاتصال بـTelegram.') };
    }
  }

  /**
   * يرسل رسالة نصية حقيقية. لا يُعد الإرسال ناجحاً إلا باستجابة `ok:true`
   * ومعرّف رسالة حقيقي من Telegram؛ وإلا يعود فشلاً صريحاً بلا ادعاء تسليم.
   */
  async sendMessage(req: TelegramSendRequest): Promise<TelegramSendResult> {
    if (!this.botToken) return { ok: false, providerMessageId: null, receipt: null, error: 'رمز البوت غير متوفر.' };
    if (!req.chatId || !String(req.text || '').trim()) {
      return { ok: false, providerMessageId: null, receipt: null, error: 'chat_id ونص الرسالة مطلوبان.' };
    }
    try {
      const res = await this.fetchImpl(telegramApiUrl('sendMessage', this.botToken, this.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSendMessageBody(req)),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || data?.result?.message_id === undefined) {
        return { ok: false, providerMessageId: null, receipt: null, error: String(data?.description || 'فشل إرسال الرسالة عبر Telegram.') };
      }
      return {
        ok: true,
        providerMessageId: String(data.result.message_id),
        receipt: { provider: 'telegram', chatId: String(data.result.chat?.id ?? req.chatId), messageId: String(data.result.message_id), sentAt: new Date().toISOString() },
      };
    } catch (e: any) {
      return { ok: false, providerMessageId: null, receipt: null, error: String(e?.message || 'فشل الاتصال بـTelegram.') };
    }
  }

  /**
   * يسجّل webhook الحقيقي لدى Telegram مع سرّ secret_token. Telegram سيرسل هذا
   * السرّ في ترويسة كل تحديث، فيصبح أساس التحقق من صحة المصدر.
   */
  async setWebhook(url: string, secretToken: string): Promise<{ ok: boolean; description?: string }> {
    if (!this.botToken) return { ok: false, description: 'رمز البوت غير متوفر.' };
    if (!url || !secretToken) return { ok: false, description: 'رابط webhook والسرّ مطلوبان.' };
    try {
      const res = await this.fetchImpl(telegramApiUrl('setWebhook', this.botToken, this.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, secret_token: secretToken, allowed_updates: ['message', 'channel_post'] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) return { ok: false, description: String(data?.description || 'تعذر ضبط webhook.') };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, description: String(e?.message || 'فشل الاتصال بـTelegram.') };
    }
  }

  /**
   * يستعلم عن حالة webhook الحقيقية لدى Telegram (getWebhookInfo).
   * يُستخدم لإثبات أن الرابط مسجّل فعلاً وبلا أسرار: النتيجة مُنقّاة عبر
   * sanitizeWebhookInfo فلا تحمل إلا الحقول الآمنة.
   */
  async getWebhookInfo(): Promise<TelegramWebhookInfo> {
    if (!this.botToken) {
      return { ok: false, url: null, pendingUpdateCount: 0, lastErrorDate: null, lastErrorMessage: null, lastSynchronizationErrorDate: null, maxConnections: null, allowedUpdates: null, error: 'رمز البوت غير متوفر.' };
    }
    try {
      const res = await this.fetchImpl(telegramApiUrl('getWebhookInfo', this.botToken, this.baseUrl), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        return { ok: false, url: null, pendingUpdateCount: 0, lastErrorDate: null, lastErrorMessage: null, lastSynchronizationErrorDate: null, maxConnections: null, allowedUpdates: null, error: String(data?.description || 'تعذّر استعلام حالة webhook من Telegram.') };
      }
      return sanitizeWebhookInfo(data);
    } catch (e: any) {
      return { ok: false, url: null, pendingUpdateCount: 0, lastErrorDate: null, lastErrorMessage: null, lastSynchronizationErrorDate: null, maxConnections: null, allowedUpdates: null, error: String(e?.message || 'فشل الاتصال بـTelegram.') };
    }
  }

  /** يحذف الـwebhook لدى Telegram عند قطع الاتصال. */
  async deleteWebhook(): Promise<{ ok: boolean }> {
    try {
      const res = await this.fetchImpl(telegramApiUrl('deleteWebhook', this.botToken, this.baseUrl), { method: 'POST' });
      const data = await res.json().catch(() => null);
      return { ok: Boolean(res.ok && data?.ok) };
    } catch { return { ok: false }; }
  }
}
