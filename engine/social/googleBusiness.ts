/**
 * موصل Google Business Profile — نشر localPosts حقيقي (Task G3).
 *
 * الفجوة التي يُغلقها: الموصل كان يقرأ الحسابات فقط
 * (`mybusinessaccountmanagement.googleapis.com/v1/accounts`) ولا ينفّذ أي نشر،
 * فمسارات النشر ترد «غير مدعوم». هذا الملف يضيف **نشر localPost** بنفس بوابات
 * المشروع، ثم يُعلن `publish` في السجل صراحةً.
 *
 * الحقائق الرسمية المستخدمة (Google Business Profile APIs):
 * - النشر: `POST https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/localPosts`
 *   بجسم `{ languageCode, summary, topicType: 'STANDARD', callToAction?, media? }`.
 * - الموقع (location): يُقرأ عبر
 *   `GET https://mybusinessbusinessinformation.googleapis.com/v1/accounts/{accountId}/locations`
 *   (`readMask=name,title`). لا نُنشر بلا معرّف موقع حقيقي مقروء من Google.
 * - النطاق: `https://www.googleapis.com/auth/business.manage` (المطلوب أصلاً في OAUTH_CONFIG).
 * - رابط CTA: `callToAction.actionType = 'LEARN_MORE'` مع `url` (اختياري).
 *
 * القاعدة الملزمة: لا تُعلن قدرة لم تُنفَّذ فعلاً، ولا تُخترع قيمة، ولا نجاح بلا
 * معرّف منشور حقيقي من Google. كل الدوال الحتمية (بناء الأجسام/تطبيع الاستجابة/
 * تصنيف الأخطاء) مفصولة عن عميل الشبكة لتُختبر بخادم وهمي محلي بلا مزود ولا حصة.
 *
 * كل الأسرار تُمرَّر كوسائط؛ لا تُسجَّل ولا تُعاد.
 */

import { createRetryingProviderFetch, providerRetryConfig } from './providerRetry';

export const GOOGLE_BUSINESS_ACCOUNT_BASE = 'https://mybusinessaccountmanagement.googleapis.com';
export const GOOGLE_BUSINESS_INFO_BASE = 'https://mybusinessbusinessinformation.googleapis.com';
export const GOOGLE_BUSINESS_POSTS_BASE = 'https://mybusiness.googleapis.com';

/** النطاق المطلوب (مطابق لـOAUTH_CONFIG لـgoogle_business). */
export const GOOGLE_BUSINESS_SCOPE = 'https://www.googleapis.com/auth/business.manage';

/**
 * حدود محتوى المنشور المحلي الرسمية (Google): الملخّص ≤ 1500 محرف.
 * الفحص يقع **قبل** أي نداء مزود فلا نرسل ما يرفضه Google.
 */
export const GOOGLE_BUSINESS_SUMMARY_MAX = 1500;

/** قواعد Google: `topicType` المسموح للمنشورات القياسية. */
export const GOOGLE_BUSINESS_TOPIC_TYPES: readonly string[] = Object.freeze(['STANDARD', 'EVENT', 'OFFER']);

/** قواعد CTA المدعومة (نستخدم LEARN_MORE للنصّي القياسي). */
export const GOOGLE_BUSINESS_CTA_TYPES: readonly string[] = Object.freeze([
  'BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL',
]);

/** قواعد قاعدات الخدمة؛ تُتجاوز في الاختبار فقط (خوادم وهمية محلية). */
export function googleBusinessInfoBase(override?: string): string {
  return (override || process.env.GOOGLE_BUSINESS_INFO_BASE || GOOGLE_BUSINESS_INFO_BASE).replace(/\/+$/, '');
}
export function googleBusinessPostsBase(override?: string): string {
  return (override || process.env.GOOGLE_BUSINESS_POSTS_BASE || GOOGLE_BUSINESS_POSTS_BASE).replace(/\/+$/, '');
}
export function googleBusinessAccountBase(override?: string): string {
  return (override || process.env.GOOGLE_BUSINESS_ACCOUNT_BASE || GOOGLE_BUSINESS_ACCOUNT_BASE).replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// بناء الأجسام + التحقق (حتمي، بلا شبكة)
// ---------------------------------------------------------------------------

export interface GoogleBusinessLocalPostInput {
  /** ملخّص المنشور (النص الظاهر). مطلوب. */
  summary: string;
  /** رابط اختياري ضمن CTA (LEARN_MORE). */
  linkUrl?: string;
  /** لغة المحتوى (افتراضياً `ar`). */
  languageCode?: string;
  /** نوع الموضوع (افتراضياً STANDARD). */
  topicType?: string;
}

export interface GoogleBusinessPostValidation {
  ok: boolean;
  code: string | null;
  reason: string;
}

/** يتحقق من مدخلات المنشور قبل أي نداء مزود (لا نرسل ما يعرفه Google رفضاً). */
export function validateGoogleBusinessPost(input: GoogleBusinessLocalPostInput): GoogleBusinessPostValidation {
  const summary = String(input?.summary || '').trim();
  if (!summary) return { ok: false, code: 'SUMMARY_REQUIRED', reason: 'نص المنشور (summary) مطلوب.' };
  if (summary.length > GOOGLE_BUSINESS_SUMMARY_MAX) {
    return { ok: false, code: 'SUMMARY_TOO_LONG', reason: `نص المنشور يتجاوز الحد الرسمي (${GOOGLE_BUSINESS_SUMMARY_MAX} محرف).` };
  }
  const topic = String(input?.topicType || 'STANDARD').trim().toUpperCase();
  if (!GOOGLE_BUSINESS_TOPIC_TYPES.includes(topic)) {
    return { ok: false, code: 'INVALID_TOPIC_TYPE', reason: `نوع المنشور غير مدعوم (${GOOGLE_BUSINESS_TOPIC_TYPES.join('|')}).` };
  }
  const url = String(input?.linkUrl || '').trim();
  if (url && !/^https?:\/\/.+/i.test(url)) {
    return { ok: false, code: 'INVALID_LINK', reason: 'رابط CTA يجب أن يبدأ بـhttp/https.' };
  }
  return { ok: true, code: null, reason: 'مدخلات صالحة.' };
}

/**
 * يبني جسم `localPost`. لا يُضاف CTA بلا رابط (Google يرفض CTA بلا url)، ولا
 * media (نشر نصّي فقط في هذه الدفعة — لا ندّعي نشر صورة لم ننفّذه).
 */
export function buildGoogleBusinessPostBody(input: GoogleBusinessLocalPostInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    languageCode: String(input?.languageCode || 'ar').trim() || 'ar',
    summary: String(input?.summary || '').trim(),
    topicType: String(input?.topicType || 'STANDARD').trim().toUpperCase() || 'STANDARD',
  };
  const url = String(input?.linkUrl || '').trim();
  if (url) body.callToAction = { actionType: 'LEARN_MORE', url };
  return body;
}

/** يستخرج معرّف الموقع من اسم المورد `accounts/X/locations/Y` — بلا اختراع. */
export function parseLocationResourceName(resourceName: string): { accountId: string; locationId: string } | null {
  const m = /^accounts\/([^/]+)\/locations\/([^/]+)$/.exec(String(resourceName || '').trim());
  if (!m) return null;
  return { accountId: m[1], locationId: m[2] };
}

// ---------------------------------------------------------------------------
// تصنيف أخطاء Google (لا يُخفي رسالة Google)
// ---------------------------------------------------------------------------

/**
 * يصنّف خطأ Google بكود داخلي صريح. يميّز **نقص الصلاحية** (403 PERMISSION_DENIED)
 * عن **رمز منتهٍ** (401 UNAUTHENTICATED) عن موقع غير موجود عن خطأ عام — فلا يُعرض
 * عطل صلاحية كأنه عطل شبكة.
 */
export function classifyGoogleBusinessError(message: string, httpStatus: number | null, googleStatus: string | null): string {
  const st = String(googleStatus || '').toUpperCase();
  const m = String(message || '').toLowerCase();
  if (httpStatus === 401 || st === 'UNAUTHENTICATED' || /invalid credentials|invalid_grant|expired/.test(m)) return 'TOKEN_EXPIRED';
  if (httpStatus === 403 || st === 'PERMISSION_DENIED' || /permission|not authorized/.test(m)) return 'PERMISSION_DENIED';
  if (httpStatus === 404 || st === 'NOT_FOUND' || /not found/.test(m)) return 'LOCATION_NOT_FOUND';
  if (httpStatus === 400 || st === 'INVALID_ARGUMENT' || /invalid argument|invalid/.test(m)) return 'INVALID_ARGUMENT';
  return 'PROVIDER_ERROR';
}

// ---------------------------------------------------------------------------
// عميل الشبكة
// ---------------------------------------------------------------------------

export type GoogleBusinessFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

/** F-14: غلاف fetch بإعادة محاولة آمنة (قراءة فقط تُعاد؛ الكتابة لا تُعاد أبداً). */
export function createGoogleBusinessFetch(
  baseFetch: (url: string, init: any) => Promise<any>,
  overrides: Parameters<typeof providerRetryConfig>[1] = {},
): GoogleBusinessFetch {
  return createRetryingProviderFetch(baseFetch, { config: providerRetryConfig(process.env, overrides) }) as GoogleBusinessFetch;
}

export interface GoogleBusinessResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
  code?: string;
  providerCode?: number | null;
  providerStatus?: string | null;
}

function googleErrorMessage(data: any, fallback: string): string {
  return String(data?.error?.message || data?.error_description || data?.error || fallback);
}

export interface GoogleBusinessLocation {
  resourceName: string;
  accountId: string;
  locationId: string;
  title: string | null;
}

export class GoogleBusinessClient {
  constructor(
    private readonly fetchImpl: GoogleBusinessFetch,
    private readonly infoBase?: string,
    private readonly postsBase?: string,
  ) {}

  /** يقرأ مواقع الحساب فعلياً (readMask=name,title) — لا نشر بلا موقع حقيقي. */
  async listLocations(accountResourceName: string, accessToken: string): Promise<GoogleBusinessResult<GoogleBusinessLocation[]>> {
    if (!accountResourceName || !accessToken) return { ok: false, data: null, error: 'معرّف الحساب والرمز مطلوبان.', code: 'CREDENTIALS_MISSING' };
    try {
      const u = new URL(`${googleBusinessInfoBase(this.infoBase)}/v1/${accountResourceName}/locations`);
      u.searchParams.set('readMask', 'name,title');
      u.searchParams.set('pageSize', '100');
      const res = await this.fetchImpl(u.toString(), { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        const msg = googleErrorMessage(data, 'تعذّر قراءة مواقع Google Business.');
        const gStatus = data?.error?.status ? String(data.error.status) : null;
        return { ok: false, data: null, error: msg, providerCode: data?.error?.code !== undefined ? Number(data.error.code) : null, providerStatus: gStatus, code: classifyGoogleBusinessError(msg, res.status, gStatus) };
      }
      const locations = Array.isArray(data?.locations) ? data.locations : [];
      const parsed: GoogleBusinessLocation[] = [];
      for (const loc of locations) {
        const parsedName = parseLocationResourceName(String(loc?.name || ''));
        if (!parsedName) continue;
        parsed.push({ resourceName: String(loc.name), accountId: parsedName.accountId, locationId: parsedName.locationId, title: loc?.title ? String(loc.title) : null });
      }
      return { ok: true, data: parsed };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـGoogle Business.'), code: 'NETWORK_ERROR' };
    }
  }

  /**
   * ينشر localPost حقيقياً. لا نجاح بلا معرّف منشور حقيقي من Google.
   * التحقق من المدخلات يقع هنا أيضاً (دفاع مزدوج) فلا يصل طلب مرفوض للمزود.
   */
  async createLocalPost(input: {
    accountId: string;
    locationId: string;
    post: GoogleBusinessLocalPostInput;
    accessToken: string;
  }): Promise<GoogleBusinessResult<{ providerPostId: string; state: string | null }>> {
    const { accountId, locationId, post, accessToken } = input;
    if (!accountId || !locationId || !accessToken) return { ok: false, data: null, error: 'معرّف الحساب والموقع والرمز مطلوبة.', code: 'CREDENTIALS_MISSING' };
    const validation = validateGoogleBusinessPost(post);
    if (!validation.ok) return { ok: false, data: null, error: validation.reason, code: validation.code || 'INVALID_POST' };
    try {
      const u = `${googleBusinessPostsBase(this.postsBase)}/v4/accounts/${accountId}/locations/${locationId}/localPosts`;
      const res = await this.fetchImpl(u, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(buildGoogleBusinessPostBody(post)),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.name) {
        const msg = googleErrorMessage(data, 'فشل نشر المنشور على Google Business.');
        const gStatus = data?.error?.status ? String(data.error.status) : null;
        return { ok: false, data: null, error: msg, providerCode: data?.error?.code !== undefined ? Number(data.error.code) : null, providerStatus: gStatus, code: classifyGoogleBusinessError(msg, res.status, gStatus) };
      }
      // معرّف المنشور = اسم المورد الكامل (accounts/X/locations/Y/localPosts/Z).
      return { ok: true, data: { providerPostId: String(data.name), state: data.state ? String(data.state) : null } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـGoogle Business.'), code: 'NETWORK_ERROR' };
    }
  }
}
