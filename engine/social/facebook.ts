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

import { createRetryingProviderFetch, providerRetryConfig } from './providerRetry';

export const FACEBOOK_GRAPH_BASE = 'https://graph.facebook.com';
export const FACEBOOK_OAUTH_DIALOG_BASE = 'https://www.facebook.com';
export const FACEBOOK_GRAPH_VERSION = 'v21.0';
export const FACEBOOK_SIGNATURE_HEADER = 'x-hub-signature-256';
/**
 * مسار حوار Facebook Login الرسمي (مع إصدار Graph كما في وثائق Meta).
 *
 * ملاحظة تشخيصية مهمة: أُثبت حياً أن `/v21.0/dialog/oauth` **يعمل** مع معرّف
 * تطبيق صالح، وأن صفحة Meta العامة «حدث خطأ ما» (`PLATFORM__INVALID_APP_ID`)
 * تظهر عند معرّف تطبيق **غير صالح/غير مطابق** لا عند إصدار المسار. أي مسافة أو
 * سطر زائد في قيمة المعرّف ينتج نفس الصفحة العامة (أُثبت حياً أيضاً).
 */
export const FACEBOOK_DIALOG_PATH = '/v21.0/dialog/oauth';

/**
 * وكيل مستخدم جوال حقيقي (iPhone Safari).
 *
 * سبب الوجود: أُثبت حياً أن `www.facebook.com/vXX/dialog/oauth` يوجّه حسب
 * User-Agent: مع وكيل سطح مكتب يبقى على `www` (302 إلى `/login.php`)، ومع وكيل
 * جوال يحوّل إلى `m.facebook.com/vXX/dialog/oauth?encrypted_query_string=...`
 * ثم إلى `m.facebook.com/login.php` أو إلى صفحة خطأ جوال مختلفة. لذلك فحصٌ
 * بوكيل الخادم الافتراضي (`node`) لا يرى ما يراه متصفح المالك الجوال: هذا هو
 * جذر «الفحص يمرّ والمتصفح الجوال يفشل».
 */
export const FACEBOOK_MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/** مضيفات مسار Meta الجوال (m/mbasic) — تختلف عن www في مسار الأخطاء. */
export function isMetaMobileHost(host: string | null | undefined): boolean {
  const h = String(host || '').toLowerCase();
  return h === 'm.facebook.com' || h === 'mbasic.facebook.com';
}

/** يستخرج المضيف بأمان من رابط (بلا أي استعلام) — للتشخيص الآمن فقط. */
export function safeUrlHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).host || null; } catch { return null; }
}

/** يستخرج المسار بأمان من رابط (بلا أي استعلام) — للتشخيص الآمن فقط. */
export function safeUrlPath(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).pathname || null; } catch { return null; }
}

// ---------------------------------------------------------------------------
// صلاحيات Facebook Login — المصدر الواحد مع رسم الاعتماديات الرسمي
// ---------------------------------------------------------------------------

/**
 * الصلاحيات التي يحتاجها هذا الموصل فعلاً + اعتمادياتها الرسمية من Meta.
 *
 * سبب الوجود: طلب صلاحية بلا اعتماديتها المسجلة لدى Meta إما يُرفض كـ
 * «Invalid Scopes» (عند تطبيق في وضع Live بلا مراجعة للصلاحية)، أو يُسقَط
 * صامتاً من الرمز المخوَّل فتبدو الواجهة قادرة والرد الفعلي لا يعمل. أخطر ما
 * في ذلك صلاحية الرد على التعليقات `pages_manage_engagement` التي تعتمد
 * رسمياً على `pages_read_user_content` — وكانت غائبة عن المجموعة القديمة.
 *
 * الوظائف التي تغطّيها كل صلاحية (مقابلة مباشرة مع الكود):
 * - pages_show_list        → GET /me/accounts (اكتشاف الصفحات) + شروط اعتماد بقية الصلاحيات.
 * - pages_read_engagement  → قراءة منشورات/بيانات الصفحة والتحليلات.
 * - pages_manage_engagement→ POST /{comment-id}/comments (الرد على التعليقات).
 * - pages_read_user_content→ اعتمادية pages_manage_engagement (محتوى المستخدم/التعليقات).
 * - pages_manage_posts     → POST /{page-id}/feed (النشر على الصفحة).
 * - pages_manage_metadata  → POST /{page-id}/subscribed_apps (اشتراك webhook) وإعدادات الصفحة.
 * - pages_messaging        → POST /{page-id}/messages (رسائل Messenger والرد عليها).
 * - business_management    → /me/accounts لصفحات Business Manager منذ Graph v17.
 *
 * ملاحظة عن public_profile: ضمني في Facebook Login ولا يلزم إدراجه صراحةً،
 * فلا نضيفه (تجنّب صلاحية غير مستخدمة هو شرط هذا التطبيق).
 */
export const FACEBOOK_PERMISSION_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  pages_show_list: [],
  pages_read_engagement: ['pages_show_list'],
  pages_read_user_content: ['pages_show_list'],
  pages_manage_engagement: ['pages_read_user_content', 'pages_show_list'],
  pages_manage_posts: ['pages_read_engagement', 'pages_show_list'],
  pages_manage_metadata: ['pages_show_list'],
  pages_messaging: ['pages_manage_metadata', 'pages_show_list'],
  business_management: [],
});

/**
 * المجموعة الافتراضية الدنيا التي تغطي كل وظائف الموصل فعلاً. لا تُضاف صلاحية
 * لا يقابلها استدعاء حقيقي، ولا تُحذف صلاحية يحتاجها استدعاء قائم:
 * النشر + الرد على التعليقات + الرسائل + اشتراك webhook + صفحات Business Manager.
 */
export const FACEBOOK_REQUIRED_SCOPES: readonly string[] = Object.freeze([
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_engagement',
  'pages_manage_posts',
  'pages_manage_metadata',
  'pages_messaging',
]);

/**
 * يوسّع قائمة صلاحيات بإضافة اعتمادياتها المسجلة (بشكل متعدٍّ) بلا تكرار،
 * فيبقى الطلب مطابقاً لعقد Meta: لا صلاحية بلا اعتماديتها.
 */
export function expandWithDependencies(scopes: readonly string[]): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();
  const visit = (scope: string) => {
    if (!scope || seen.has(scope)) return;
    seen.add(scope);
    for (const dep of FACEBOOK_PERMISSION_DEPENDENCIES[scope] || []) visit(dep);
    resolved.push(scope);
  };
  for (const scope of scopes) visit(scope);
  return resolved;
}

/**
 * يبني قائمة الصلاحيات النهائية من تجاوز حرّ (أو المجموعة المطلوبة)، بعد
 * إضافة الاعتماديات وإزالة التكرار مع الحفاظ على الترتيب الطوبولوجي
 * (الاعتمادية قبل التابع) — وهو الترتيب الذي تعرضه Meta في وثائقها.
 * لا يرمي أبداً: التجاوز المجهول يبقى كما هو (مستخدم لتقدير المالك).
 */
export function resolveFacebookScopes(requested: readonly string[]): string[] {
  return expandWithDependencies(requested);
}

/**
 * يتحقق أن قائمة الصلاحيات لا تحمل صلاحية بلا اعتماديتها. يعيد الاعتماديات
 * الناقصة (بلا تكرار) — قائمة فارغة تعني مجموعة متماسكة مع عقد Meta.
 * الغرض: منع فشل OAuth صامت أو «Invalid Scopes» قبل إرسال المالك إلى Meta.
 */
export function findMissingScopeDependencies(scopes: readonly string[]): string[] {
  const present = new Set(scopes);
  const missing: string[] = [];
  for (const scope of scopes) {
    for (const dep of FACEBOOK_PERMISSION_DEPENDENCIES[scope] || []) {
      if (!present.has(dep) && !missing.includes(dep)) missing.push(dep);
    }
  }
  return missing;
}

/** يستنتج الاعتماديات الناقصة من قيمة بيئة مفصولة بفواصل (بلا أي سرّ). */
export function missingScopeDependenciesFromCsv(raw: string | undefined | null): string[] {
  const scopes = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  return scopes.length ? findMissingScopeDependencies(scopes) : [];
}


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
// تفاعل الحوار + فحص معرّف التطبيق (بلا أي سرّ)
// ---------------------------------------------------------------------------

/**
 * معرّف تطبيق Meta صالح شكلياً: أرقام فقط (15–16 خانة عملياً، ونقبل 6+).
 * لا يتم trim هنا: أي مسافة أو سطر أو علامة تنصيص زائدة يجعل Meta ترد «حدث
 * خطأ ما»، فنُعلنها صراحةً بدل تمريرها للمزود.
 */
export function isPlausibleMetaAppId(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9]{6,20}$/.test(value);
}

export type MetaDialogInteractionKind = 'login' | 'consent' | 'invalid_app_id' | 'dialog_error' | 'http_error' | 'unknown';

export interface MetaDialogInteraction {
  /** تصنيف تفاعل Meta: دخول/موافقة/معرّف تطبيق غير صالح/عطل حوار/خطأ HTTP/غير معروف. */
  kind: MetaDialogInteractionKind;
  /** هل يتقدّم الحوار إلى تسجيل الدخول/الموافقة (أي أن التطبيق مقبول)؟ */
  acceptable: boolean;
  /** رمز خطأ Meta إن وُجد (بلا أي سرّ). `HTTP_<status>` لاستجابات 4xx/5xx. */
  errorCode: string | null;
  /** رابط إعادة التوجيه كما أعاده Meta (بلا جسم الاستجابة). */
  location: string | null;
}

/**
 * يصنّف استجابة أول طلب لحوار Facebook Login من الحالة والترويسة والجسم.
 *
 * سبب الوجود: كانت «حدث خطأ ما» تظهر للمالك بلا أي تفسير. أُثبت حياً أن Meta
 * تردّ بثلاث صور مختلفة: 302 إلى `/oauth/error/?error_code=...` (معرّف تطبيق
 * غير صالح)، أو صفحة عامة في الجسم، أو **HTTP 500 مع صفحة «حدث خطأ ما»** عندما
 * لا تستطيع Meta التحقق من مجموعة `scope` مقابل منتج التطبيق (Use Case /
 * Configuration). الصورة الثالثة كانت تسقط سابقاً كـ«مقبولة» فيُرسَل المالك إلى
 * الفشل العام؛ الآن تُصنَّف رفضاً صريحاً.
 *
 * القاعدة الحاكمة: أي دليل رفض صريح (رمز خطأ، صفحة عامة، 4xx، 5xx) = رفض.
 * الاستجابة غير الحاسمة (200 بلا دليل، أو 429 تقييد مؤقت) تُمرَّر بلا حجب.
 */
export function classifyMetaDialogInteraction(input: { status: number; location?: string | null; body?: string | null }): MetaDialogInteraction {
  const location = (input.location || '').trim() || null;
  const body = input.body || '';
  const status = Number(input.status);
  const errorMatch = location ? /[?&]error_code=([A-Za-z0-9_]+)/.exec(location) : null;
  const errorCode = errorMatch ? errorMatch[1] : null;

  // 1) رمز خطأ صريح: معرّف تطبيق غير صالح أو عطل حوار آخر.
  if (errorCode === 'PLATFORM__INVALID_APP_ID' || /PLATFORM__INVALID_APP_ID/.test(body)) {
    return { kind: 'invalid_app_id', acceptable: false, errorCode: errorCode || 'PLATFORM__INVALID_APP_ID', location };
  }
  if (errorCode) return { kind: 'dialog_error', acceptable: false, errorCode, location };

  // 2) صفحة Meta العامة في الجسم = عطل صريح، تعمل مع 200 ومع 5xx.
  // يشمل ذلك صفحات مسار الجوال (m.facebook.com/oauth/error) التي تعرض نصاً
  // مختلفاً: «Invalid App ID: The provided app ID does not look like a valid
  // app ID» أو «There is an error in logging you into this application».
  if (/does not look like a valid app ID/i.test(body)) {
    return { kind: 'invalid_app_id', acceptable: false, errorCode: errorCode || 'PLATFORM__INVALID_APP_ID', location };
  }
  if (/something went wrong|Invalid App ID/i.test(body)) {
    return { kind: 'dialog_error', acceptable: false, errorCode: 'META_DIALOG_PAGE', location };
  }
  if (/error in logging you into this application|error_logging_into/i.test(body)) {
    return { kind: 'dialog_error', acceptable: false, errorCode: 'META_DIALOG_MOBILE_ERROR', location };
  }

  // 3) 5xx = فشل Meta صريح (لا يُمرَّر ولو كان الحوار صالحاً نظرياً).
  if (Number.isFinite(status) && status >= 500) {
    return { kind: 'http_error', acceptable: false, errorCode: `HTTP_${status}`, location };
  }

  // 4) 4xx (غير 429 تقييد مؤقت) = طلب مرفوض صراحةً.
  if (Number.isFinite(status) && status >= 400 && status !== 429) {
    return { kind: 'http_error', acceptable: false, errorCode: `HTTP_${status}`, location };
  }

  // 5) توجيه لصفحة «متصفح غير مدعوم» = مسار مسدود، لا شاشة موافقة.
  if (location && /\/unsupportedbrowser\b/.test(location)) {
    return { kind: 'dialog_error', acceptable: false, errorCode: 'META_DIALOG_UNSUPPORTED_BROWSER', location };
  }

  // 6) إعادة توجيه مقبولة (بلا رمز خطأ): تسجيل دخول أو شاشة موافقة.
  if (location && /\/(v[0-9.]+\/)?dialog\/oauth\b/.test(location)) {
    return { kind: 'consent', acceptable: true, errorCode: null, location };
  }
  if (location && /\/login\.php\b/.test(location)) {
    return { kind: 'login', acceptable: true, errorCode: null, location };
  }

  // 7) بلا دليل رفض قاطع (200 مبهم أو 429): لا حجب بلا إثبات.
  return { kind: 'unknown', acceptable: false, errorCode: null, location };
}

/** قفزة واحدة في سلسلة حوار Meta (تشخيص آمن: مضيف/مسار فقط، بلا استعلام). */
export interface MetaDialogHop {
  /** ترتيب القفزة (1 = أول طلب). */
  step: number;
  /** رمز حالة HTTP الفعلي. */
  status: number;
  /** مضيف القفزة (بلا استعلام). */
  host: string | null;
  /** مسار القفزة (بلا استعلام). */
  path: string | null;
  /** هل هذه القفزة على مسار الجوال (m/mbasic)؟ */
  mobile: boolean;
  /** تصنيف هذه القفزة. */
  kind: MetaDialogInteractionKind;
  /** رمز الخطأ الصريح لهذه القفزة (أو null). */
  errorCode: string | null;
  /**
   * واجهة الدخول التي اختارتها Meta لهذه القفزة (من `is_business_login`).
   * `true` = Business Login (يقرأ الصلاحيات من Configuration عبر config_id)،
   * `false` = Facebook Login الكلاسيكي (يقرأها من معامل scope)، `null` = غير معلوم.
   */
  businessLogin: boolean | null;
}

export interface MetaDialogChain {
  /** هل تتقدّم السلسلة فعلاً إلى تسجيل الدخول/الموافقة؟ */
  acceptable: boolean;
  /** القفزة التي حسمت الرفض (أول قفزة غير مقبولة). */
  rejection: MetaDialogHop | null;
  /** كل القفزات المرصودة بالترتيب. */
  hops: MetaDialogHop[];
  /** هل مرّت السلسلة بمسار الجوال (m.facebook.com)؟ */
  sawMobileHost: boolean;
  /**
   * واجهة الدخول النهائية التي تحسمها Meta (آخر قفزة معلنة). القيمة من
   * `is_business_login`: true = Business Login (الصلاحيات من Configuration عبر
   * config_id)، false = Facebook Login الكلاسيكي (الصلاحيات من scope).
   */
  businessLoginSurface: boolean | null;
}

/**
 * يصنّف سلسلة قفزات حوار Meta كاملة بدل أول استجابة فقط.
 *
 * سبب الوجود: الفحص السابق كان يقرأ **أول** استجابة بوكيل الخادم، فيرى مسار
 * سطح المكتب (`www` → `/login.php`) ويظنّ الحوار مقبولاً، بينما متصفح المالك
 * الجوال يُحوَّل إلى `m.facebook.com` حيث تظهر صفحة الخطأ الجوال. تصنيف السلسلة
 * يجعل الحكم على النتيجة الفعلية التي يصل إليها المتصفح، لا على أول قفزة.
 *
 * القاعدة: أول قفزة **غير مقبولة** ولها دليل رفض صريح تُعلن الرفض فوراً؛
 * قفزة غير حاسمة (بلا دليل) تُمرَّر لأن Meta قد تحسمها في قفزة تالية.
 */
export function classifyMetaDialogChain(hops: ReadonlyArray<{ status: number; location?: string | null; body?: string | null }>): MetaDialogChain {
  const classified: MetaDialogHop[] = [];
  let rejection: MetaDialogHop | null = null;
  let sawMobileHost = false;
  let businessLoginSurface: boolean | null = null;
  hops.forEach((h, i) => {
    const interaction = classifyMetaDialogInteraction(h);
    const loc = (h.location || '').trim() || null;
    const host = safeUrlHost(loc);
    const mobile = isMetaMobileHost(host);
    if (mobile) sawMobileHost = true;
    // is_business_login معلنة من Meta على قفزة تسجيل الدخول: true يعني أن Meta
    // وجّهت المالك إلى واجهة Business Login التي تقرأ الصلاحيات من Configuration
    // (config_id) لا من معامل scope. تُقرأ القيمة فقط (علم منطقي) ولا يُسجَّل الرابط.
    const bizMatch = loc ? /[?&]is_business_login=(0|1)\b/.exec(loc) : null;
    const businessLogin = bizMatch ? bizMatch[1] === '1' : null;
    if (businessLogin !== null) businessLoginSurface = businessLogin;
    const hop: MetaDialogHop = { step: i + 1, status: Number(h.status), host, path: safeUrlPath(loc), mobile, kind: interaction.kind, errorCode: interaction.errorCode, businessLogin };
    classified.push(hop);
    if (!rejection && !interaction.acceptable && interaction.errorCode) rejection = hop;
  });
  return { acceptable: !rejection, rejection, hops: classified, sawMobileHost, businessLoginSurface };
}

/** مسار Graph لرمز التطبيق (client_credentials) — يثبت صحة client_id/secret. */
export function facebookAppTokenPath(): string {
  return '/oauth/access_token';
}

export type MetaAppTokenKind = 'ok' | 'invalid_client_id' | 'invalid_client_secret' | 'secret_required' | 'unknown';

/**
 * يصنّف نتيجة طلب client_credentials من Graph: يفرّق معرّف التطبيق الخاطئ
 * (code 101 «Invalid Client ID» — وهو مطابق تماماً لـ«حدث خطأ ما» في شاشة
 * الحوار) عن السرّ الخاطئ وعن باقي الأخطاء.
 */
export function classifyMetaAppTokenResponse(input: { status: number; data?: any }): { kind: MetaAppTokenKind; message: string; code: number | null } {
  const err = input.data?.error;
  const message = String(err?.message || input.data?.error_description || '').slice(0, 200);
  const code = Number.isFinite(Number(err?.code)) ? Number(err.code) : null;
  if (input.data?.access_token && input.status >= 200 && input.status < 300) return { kind: 'ok', message, code };
  if (code === 101 || /Invalid Client ID/i.test(message)) return { kind: 'invalid_client_id', message, code };
  if (/client secret/i.test(message)) return { kind: 'invalid_client_secret', message, code };
  if (/access token is required|unknown error/i.test(message)) return { kind: 'secret_required', message, code };
  return { kind: 'unknown', message: message || `HTTP ${input.status}`, code };
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
  /** معرّف الكاتب الحقيقي (from.id / PSID) — أساس هوية الزبون. */
  authorId: string | null;
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
    authorId: v.from?.id ? String(v.from.id) : null,
    text,
    createdAt: epochToIso(v.created_time) || new Date().toISOString(),
    // الرد على تعليق الصفحة يتم بمعرّف التعليق نفسه عبر Graph API.
    replyTarget: { commentId: String(externalId), pageId },
    raw: { source: 'changes', field: change?.field ?? null, item: v.item ?? null },
  };
}

/** يبني حدث رسالة من messaging (Messenger) صراحةً. */
function messageFromMessaging(pageId: string | null, m: any): FacebookNormalizedEvent | null {
  // صدى الرسائل الصادرة من الصفحة نفسها (`is_echo`) ليس رسالة عميل واردة؛
  // معالجته كواردة تسبب ردّاً على ردّنا إلى الصفحة. يُتجاهل صراحةً.
  if (m?.message?.is_echo === true) return null;
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
    // هوية المرسل (PSID) — أساس هوية الزبون في المحادثات الخاصة.
    authorId: senderId,
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

/**
 * يبني جسم نشر فيديو على صفحة (`POST /{page-id}/videos`). Graph API يقرأ
 * الفيديو من رابط عام عبر `file_url` (وليس `video_url` — ذاك خاص بـInstagram
 * فقط) حين لا نرفع بايتات مباشرة. الوصف اختياري.
 *
 * `published=true` **صريح** (ليس اعتماداً على الافتراضي): يمنع تحويل الفيديو
 * سهواً إلى مسودة/غير منشور (`published=false`) فيبقى ظاهراً للأونر فقط. القيمة
 * الافتراضية في Graph `true`، لكن التصريح يجعل النية قاطعة وقابلة للاختبار.
 */
export function buildPublishVideoBody(fileUrl: string, description?: string): URLSearchParams {
  const body = new URLSearchParams();
  body.set('file_url', fileUrl);
  body.set('published', 'true');
  if (description?.trim()) body.set('description', description.trim());
  return body;
}

/**
 * يبني جسم نشر منشور نصي/رابط على صفحة (`POST /{page-id}/feed`).
 *
 * `published=true` **صريح** (وليس اعتماداً على الافتراضي): يمنع — بحسب عقد Graph —
 * بقاء المنشور مسودة أو مجدولاً (`is_published=false`) فيراه المالك فقط. رغم أن
 * الافتراضي للمنشور الفوري `true`، التصريح يجعل النية قاطعة ويحمي من انحراف العقد.
 *
 * **قيود موثّقة لا تُخترع:** منشور الصفحة عبر `/feed` **عام بطبيعته** — أي أن متابعي
 * الصفحة يرونه دون أي معامل إضافي. ولا يقبل هذا المسار معامل `privacy`
 * (`{value:'EVERYONE'}`) — ذلك معامل لجدول المستخدم/`/me/feed` لا لصفحة، ويُرفض على
 * صفحة بخطأ `100/#200 Invalid parameter`. لذلك لا نرسله (لا ادّعاء ضمان عبر معامل
 * غير مدعوم). الظهور العام الفعلي يتوقف على **وضع تطبيق Meta** (Live/Access Levels)
 * لا على أي معامل HTTP — يُشخَّص عبر `/api/platforms/facebook/post-visibility-diagnosis`.
 */
export function buildPublishTextBody(message: string): URLSearchParams {
  const body = new URLSearchParams();
  body.set('message', message);
  body.set('published', 'true');
  return body;
}

/**
 * حرس صريح: منشور الصفحة لا يقبل معامل `privacy`. أي محاولة لبناء جسم نشر صفحة
 * يحمل `privacy` خطأ عقد — يُرفض بدل إرساله (فيرد Meta `100/#200 Invalid parameter`
 * ويفشل النشر). السبب: `{value:'EVERYONE'}` خاص بجدول المستخدم لا بالصفحة.
 */
export function assertNoPagePostPrivacyParam(params: URLSearchParams): boolean {
  return !params.has('privacy');
}

/**
 * يبني جسم نشر صورة على صفحة (`POST /{page-id}/photos`). Graph API يقرأ الصورة
 * من رابط عام عبر `url` (وليس `source` المخصّص للبايتات) حين لا نرفع ملفاً
 * مباشرة. الرسالة اختيارية. الصلاحية: pages_manage_posts (نفس صلاحية النشر).
 *
 * `published=true` **صريح** (وليس اعتماداً على الافتراضي): يمنع — بحسب عقد Graph —
 * بقاء الصورة منشوراً غير معلن (`is_published=false`) فيراها المالك/المشرفون فقط
 * ولا تظهر على حائط الصفحة العام. هذا هو **نفس** العقد المطبَّق على المنشور النصي
 * (`/feed`) والفيديو (`/videos`): التصريح يمنع انحراف الافتراضي ويجعل النية قاطعة
 * وقابلة للاختبار. (لا يُرسل معامل `privacy` — غير مدعوم على الصفحة.)
 */
export function buildPublishPhotoBody(imageUrl: string, message?: string): URLSearchParams {
  const body = new URLSearchParams();
  body.set('url', imageUrl);
  body.set('published', 'true');
  if (message?.trim()) body.set('message', message.trim());
  return body;
}

// ---------------------------------------------------------------------------
// عميل Graph API
// ---------------------------------------------------------------------------

export type FacebookFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

/**
 * F-14: غلاف fetch بإعادة محاولة آمنة. القراءة (GET) وحدها تُعاد عند فشل عابر
 * (5xx/429/انقطاع)، مع احترام Retry-After؛ والكتابة (POST) لا تُعاد أبداً.
 * يُحقن `sleep` في الاختبار فلا ساعة حقيقية. الغلاف يُصدَّر ليُثبَت سلوكه بلا شبكة.
 */
export function createFacebookFetch(
  baseFetch: (url: string, init: any) => Promise<any>,
  overrides: Parameters<typeof providerRetryConfig>[1] = {},
): FacebookFetch {
  return createRetryingProviderFetch(baseFetch, { config: providerRetryConfig(process.env, overrides) }) as FacebookFetch;
}

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
  /** كود داخلي مصنَّف (لا يُخفي رسالة Meta). */
  code?: string;
  /** كود خطأ Meta الحقيقي (مثلاً 100/9007) إن وُجد. */
  providerCode?: number | null;
  /** رمز Meta الفرعي (error_subcode) — للتشخيص اللاحق. */
  providerSubcode?: number | null;
  /** معرّف تتبّع Meta (fbtrace_id) — يُقدَّم للدعم بلا أي سرّ. */
  providerTraceId?: string | null;
  /**
   * معرّفات المنشورات التي فُحصت فعلاً في السحب (feed + videos + video_reels +
   * سجلات النشر) — تُغذّي عدّاد «المنشورات المفحوصة» في حالة المراقب. اختيارية.
   */
  postIdsScanned?: string[];
  /**
   * عدد نداءات Graph الفعلية التي استهلكها السحب (جمع المعرّفات + قراءة
   * التعليقات المجمّعة) — يُعلن في حالة المراقب كـ`callsPerCycle`.
   */
  graphCalls?: number;
}

function errorMessage(data: any, fallback: string): string {
  return String(data?.error?.message || data?.error_description || data?.error || fallback);
}

/** يستخرج كود خطأ Meta الحقيقي من استجابة Graph (بلا اختراع). */
export function facebookProviderErrorCode(data: any): number | null {
  const c = data?.error?.code;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

/**
 * يصنّف خطأ نشر/وسائط Facebook بـكود داخلي صريح دون إخفاء رسالة Meta. يبقى
 * الرمز الحقيقي متاحاً في `providerCode` ليعرضه المالك مع النص كما هو.
 */
export function classifyFacebookProviderError(message: string, providerCode: number | null): string {
  const m = String(message || '').toLowerCase();
  if (providerCode === 9007 || /could not be fetched|couldn't be downloaded|download|fetch.*url|media.*url/.test(m)) {
    return 'MEDIA_DOWNLOAD_FAILED';
  }
  if (providerCode === 190 || /access token|session has expired|expired|validate access/.test(m)) {
    return 'TOKEN_EXPIRED';
  }
  if (providerCode === 10 || /permission|no permission/.test(m)) {
    return 'PERMISSION_DENIED';
  }
  return 'PROVIDER_ERROR';
}

/** حقول Graph API التشخيصية المسموح تسجيلها — بلا أي رمز أو سرّ. */
export interface FacebookGraphErrorInfo {
  endpoint: string;
  status: number | null;
  code: number | null;
  subcode: number | null;
  message: string;
  type: string | null;
  fbtraceId: string | null;
  errorUserTitle: string | null;
  errorUserMsg: string | null;
}

/**
 * يستخرج حقول خطأ Graph API الكاملة (بلا قطع) للتشخيص القراءة-فقط. لا يُعاد
 * ولا يُسجَّل أي رمز وصول أو سرّ — فقط وصف الخطأ الذي يوفّره Meta. مفصول عن
 * منطق العميل كي يبقى الاستخراج قابلاً للاختبار دوالً صافية.
 */
export function extractFacebookGraphError(data: any, endpoint: string, status: number | null): FacebookGraphErrorInfo {
  const err = data && typeof data === 'object' && data.error && typeof data.error === 'object' ? data.error : data;
  const code = Number.isFinite(Number(err?.code)) ? Number(err.code) : null;
  return {
    endpoint,
    status: status ?? null,
    code,
    subcode: Number.isFinite(Number(err?.error_subcode)) ? Number(err.error_subcode) : null,
    message: typeof err?.message === 'string' ? err.message : (data?.raw != null ? String(data.raw) : ''),
    type: typeof err?.type === 'string' ? err.type : null,
    fbtraceId: typeof err?.fbtrace_id === 'string' ? err.fbtrace_id : null,
    errorUserTitle: typeof err?.error_user_title === 'string' ? err.error_user_title : null,
    errorUserMsg: typeof err?.error_user_msg === 'string' ? err.error_user_msg : null,
  };
}

/** سطر سجل تشخيصي آمن: الرمز/الرقم/النص الكامل غير المقطوع + fbtrace_id — بلا أي سرّ. */
export function formatFacebookGraphError(info: FacebookGraphErrorInfo): string {
  return '[facebook-graph-error] ' + JSON.stringify(info);
}

/** يسجّل خطأ Meta الكامل ويرجع الحقول التشخيصية (code/subcode/fbtrace) — بلا سرّ. */
function logAndExtractFacebookError(data: any, endpoint: string, status: number): { providerCode: number | null; providerSubcode: number | null; providerTraceId: string | null } {
  const info = extractFacebookGraphError(data, endpoint, status);
  console.error(formatFacebookGraphError(info));
  return { providerCode: info.code, providerSubcode: info.subcode, providerTraceId: info.fbtraceId };
}

// ---------------------------------------------------------------------------
// تشخيص ظهور المنشور للجمهور (بلا أي نشر أو تغيير)
// ---------------------------------------------------------------------------
// السبب الجذري المُثبت لظهور منشورات API للأونر فقط: تطبيق Meta في وضع
// **التطوير (Development)** لا في **Live**. في وضع التطوير تقيّد Meta كل محتوى
// ينشئه التطبيق عبر API بحيث لا يراه إلا أدوار التطبيق/الصفحة، بينما المنشور
// الذي يُنشئه المالك يدوياً يبقى عاماً (لهذا نجح النشر اليدوي وفشل نشر API).
// وضع التطبيق **لا يُقرأ عبر Graph API إطلاقاً** — مصدره الوحيد لوحة Meta.
// لذلك نبني تشخيصاً صادقاً يعلن هذا صراحةً بدل التخمين.

// ---------------------------------------------------------------------------
// قراءة الحقول بذكاء (إصلاح جذر): كان طلب `is_published` على عقدة منشور/فيديو
// يُرد بـ(#100) «Tried accessing nonexisting field (is_published)» فيفشل التشخيص
// بالكامل. الحل: طلب قائمة كاملة، ثم السقوط إلى قائمة أساسية عند رفض الحقل، ثم
// اختبار كل حقل على حدة لعزل أي حقل غير مدعوم على نوع العقدة — بلا اختراع قيمة
// بديلة ولا إسقاط الفحص. `is_published` صالح على عقدة Post وليس على Video.
// ---------------------------------------------------------------------------

/** حقول Grounding الكاملة المطلوبة من Graph (Post node). */
export const FACEBOOK_POST_GROUNDING_FIELDS: readonly string[] = Object.freeze([
  'id', 'is_published', 'created_time', 'scheduled_publish_time', 'privacy', 'permalink_url', 'status_type',
]);
/** حقول Grounding الأساسية (احتياطي عند رفض أي حقل موسّع — تعمل على كل الأنواع). */
export const FACEBOOK_POST_GROUNDING_FALLBACK_FIELDS: readonly string[] = Object.freeze([
  'id', 'created_time', 'permalink_url',
]);

/** نتيجة قراءة حقول عقدة Graph — بلا أي سرّ. */
export interface FacebookFieldRead {
  /** الحقول التي طُلبت في القراءة الناجحة فعلاً. */
  requested: string[];
  /** الحقول التي ردّتها Meta فعلاً (مفاتيح الاستجابة). */
  returned: string[];
  /** نجحت القراءة الأساسية (المعرّف موجود). */
  ok: boolean;
  /** الحقول غير المدعومة على نوع العقدة هذا (من الاختبار الحقلي عند الفشل). */
  unsupported: string[];
  /** حالة HTTP للقراءة الأولى (قبل أي احتياطي). */
  status: number | null;
  /** رمز خطأ Meta للقراءة الأولى (مثل 100) — دليل سبب السقوط للاحتياطي. */
  providerCode: number | null;
  /** نص خطأ Meta الحقيقي غير المقطوع للقراءة الأولى (بلا سرّ). */
  providerMessage: string | null;
  /** true إذا سقطنا للقائمة الأساسية بسبب رفض حقل. */
  usedFallback: boolean;
}

/** حالة الفيديو/المنشور كما أعلنها Meta (لا تُخترع قيمة عند الغياب). */
export interface FacebookPostGrounding {
  /** نوع المورد: `video` أو `post`. */
  kind: 'video' | 'post';
  providerPostId: string;
  exists: boolean;
  /** is_published إن أعلنتها Meta: true=منشور فعلاً، false=مسودة/مجدول، null=غير معلوم. */
  isPublished: boolean | null;
  /** وقت النشر (غير المجدول) إن توفر — null عند المسودة/الجدولة. */
  createdTime: string | null;
  scheduledPublishTime: string | null;
  /** الخصوصية العامة حيث يوفّرها المورد (نادر، ويُعلن null عند عدمها). */
  privacy: string | null;
  /** ظهور المنشور على حائط الصفحة `/{page-id}/published_posts` (دليل ظهور فعلي). */
  appearsOnPage: boolean | null;
  /** رابط المنشور العام (permalink_url) إن أعلنته Meta — عرض فقط، بلا طلب شبكي إضافي. */
  permalink: string | null;
  /** true فقط إذا كانت Meta قد أعلنت isPublished=true صراحةً. */
  confirmedPublicStory: boolean;
  /** حالة قراءة الحقول (أي حقول طُلبت/رُدّت، وأي حقول غير مدعومة على نوع العقدة). */
  fieldRead?: FacebookFieldRead;
  /** الحقول غير المدعومة على نوع العقدة هذا — تُعلن صراحةً بدل إسقاط الفحص. */
  unsupportedFields?: string[];
}

/**
 * يفسّر استجابة `GET /{page-id}/videos?fields=...` أو `GET /{post-id}?fields=...`
 * إلى حالة ظهور صادقة. أي حقل غائب يبقى `null` — لا يُفترض نجاح ولا فشل.
 */
export function interpretPostGrounding(kind: 'video' | 'post', raw: any, appearsOnPage: boolean | null = null, fieldRead?: FacebookFieldRead): FacebookPostGrounding {
  const d = raw && typeof raw === 'object' ? raw : {};
  const providerPostId = d.id != null ? String(d.id) : '';
  const isPubRaw = d.is_published;
  const isPublished = typeof isPubRaw === 'boolean' ? isPubRaw : (isPubRaw === 'true' ? true : isPubRaw === 'false' ? false : null);
  const createdTime = typeof d.created_time === 'string' ? d.created_time : null;
  const scheduledPublishTime = Number.isFinite(Number(d.scheduled_publish_time)) && Number(d.scheduled_publish_time) > 0 ? String(d.scheduled_publish_time) : null;
  const privacy = typeof d.privacy === 'string' ? d.privacy : (d.privacy && typeof d.privacy.value === 'string' ? d.privacy.value : null);
  const permalink = typeof d.permalink_url === 'string' && d.permalink_url ? d.permalink_url : null;
  return {
    kind,
    providerPostId,
    exists: Boolean(providerPostId),
    isPublished,
    createdTime,
    scheduledPublishTime,
    privacy,
    appearsOnPage,
    permalink,
    confirmedPublicStory: isPublished === true,
    ...(fieldRead ? { fieldRead, unsupportedFields: fieldRead.unsupported.length ? fieldRead.unsupported : [] } : {}),
  };
}

/**
 * يبني تشخيص ظهور المنشور الصادق من نتيجة Grounding (منطق صافٍ قابل للاختبار).
 * يفصل بدقّة: منشور/مسودة/مجدول/غير موجود، والحقول غير المدعومة على نوع العقدة،
 * والسبب الجذري المرجَّح. **لا يدّعي ظهوراً عاماً** من `is_published=true`.
 */
export function buildPostVisibilityDiagnosis(grounding: FacebookPostGrounding): {
  verdict: string;
  likelyRootCause: string;
  evidenceSummary: { isDraftOrScheduled: boolean; returnsAsStory: boolean; proofOfPublicVisibility: boolean; why: string };
} {
  const g = grounding;
  let verdict: string;
  let likelyRootCause: string;
  if (!g.exists) { verdict = 'post_not_found'; likelyRootCause = 'المعرّف غير موجود أو لا يمكن قراءته بالرمز الحالي.'; }
  else if (g.isPublished === false) { verdict = 'draft_or_scheduled'; likelyRootCause = 'المنشور مسودة أو مجدول (is_published=false) فلا يظهر للجمهور بعد.'; }
  else if (g.appearsOnPage === false) { verdict = 'published_but_not_on_page_wall'; likelyRootCause = 'المنشور منشور (is_published=true) لكنه غير وارد على حائط الصفحة العامة — يطابق تماماً قيد «وضع تطوير التطبيق» الذي يحصر المحتوى المنشأ عبر API في أدوار التطبيق/الصفحة.'; }
  else { verdict = 'published_and_returns_as_story'; likelyRootCause = 'Meta تُعلن is_published=true والمنشور يرد ضمن المنشورات المنشورة. إن ظل مخفياً عن الجمهور فالمؤشر الأقوى هو وضع تطبيق Meta (Development) لا Live، أو اشتراط App Review/Advanced Access لصلاحيات النشر.'; }
  return {
    verdict,
    likelyRootCause,
    evidenceSummary: {
      isDraftOrScheduled: g.isPublished === false,
      returnsAsStory: g.isPublished === true,
      proofOfPublicVisibility: false,
      why: 'is_published=true تثبت وجود كائن منشور (ليس مسودة/مجدولاً) فقط، ولا تثبت رؤيته لزائر غير إداري. ظهور المنشورات المُنشأة عبر API للجمهور يتوقف على وضع تطبيق Meta / مستوى الوصول.',
    },
  };
}

export class FacebookClient {
  constructor(
    private readonly fetchImpl: FacebookFetch,
    private readonly baseUrl?: string,
  ) {}
  /**
   * يثبت أن (client_id + client_secret) يعرّفان تطبيق Meta حقيقياً عبر
   * `grant_type=client_credentials`. لا يستهلك حصة تفاعل المستخدم، ولا يعيد
   * client_secret في أي مخرَج — فقط تصنيف النتيجة.
   *
   * السبب: كانت شاشة الحوار تُظهر «حدث خطأ ما» (PLATFORM__INVALID_APP_ID) بلا
   * تفسير. هذا الطلب يحسم إن كان معرّف/سرّ التطبيق هو السبب قبل إرسال المالك.
   */
  async fetchAppAccessToken(input: { clientId: string; clientSecret: string }): Promise<{ kind: MetaAppTokenKind; message: string; code: number | null }> {
    let u: URL;
    try {
      u = new URL(facebookGraphUrl(facebookAppTokenPath(), this.baseUrl));
    } catch (e: any) {
      return { kind: 'unknown', message: String(e?.message || 'رابط غير صالح.'), code: null };
    }
    u.searchParams.set('client_id', input.clientId);
    u.searchParams.set('client_secret', input.clientSecret);
    u.searchParams.set('grant_type', 'client_credentials');
    try {
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      const classified = classifyMetaAppTokenResponse({ status: res.status, data });
      // لا يُسجَّل ولا يُعاد أي سرّ: نُبقي التصنيف والرسالة المطهّرة فقط.
      if (classified.kind === 'ok') return { kind: 'ok', message: 'تطبيق Meta صالح ومثبت.', code: classified.code };
      return { kind: classified.kind === 'unknown' ? 'unknown' : classified.kind, message: classified.message, code: classified.code };
    } catch (e: any) {
      return { kind: 'unknown', message: String(e?.message || 'فشل الاتصال بـMeta.'), code: null };
    }
  }

  /**
   * يفحص رمزاً عبر `GET /debug_token` (يستلزم app access token = client_id|client_secret).
   * يعيد الصلاحيات الممنوحة فعلاً (`scopes`) والصلاحيات الناقصة مما يتطلبه نشر فيديو
   * الصفحة — تشخيص حاسم لخطأ «(#100) No permission to publish the video» من دون أي
   * تخمين: الفرق بين `pages_manage_posts` (ينجح للنص) و`pages_read_engagement` (يلزمه
   * نشر الفيديو). لا يُعاد الرمز ولا السرّ — الحالة والنوع والصلاحيات فقط.
   * صلاحيات نشر الفيديو المطلوبة رسمياً (Page Videos): pages_manage_posts,
   * pages_read_engagement, pages_show_list.
   */
  async debugToken(inputToken: string, appAccessToken: string): Promise<FacebookResult<{ isValid: boolean; type: string | null; scopes: string[]; expiresAt: number | null; missingPublishScopes: string[] }>> {
    if (!inputToken || !appAccessToken) return { ok: false, data: null, error: 'الرمز ورمز التطبيق مطلوبان لفحص الصلاحيات.' };
    try {
      const u = new URL(facebookGraphUrl('/debug_token', this.baseUrl));
      u.searchParams.set('input_token', inputToken);
      u.searchParams.set('access_token', appAccessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      // رمز مُدخَل غير صالح: يرد Meta في data.data.is_valid=false بلا error.
      // نُعلن ذلك صراحةً بدل السقوط إلى «تعذّر الفحص».
      if (res.ok && !data?.error && data?.data && data.data.is_valid === false) {
        return { ok: true, data: { isValid: false, type: data.data.type ? String(data.data.type) : null, scopes: [], expiresAt: null, missingPublishScopes: ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list'] } };
      }
      if (!res.ok || data?.error || !data?.data) {
        const ex = logAndExtractFacebookError(data, 'GET /debug_token', res.status);
        return { ok: false, data: null, error: errorMessage(data, 'تعذّر فحص صلاحيات الرمز لدى Meta.'), providerCode: ex.providerCode, providerSubcode: ex.providerSubcode, providerTraceId: ex.providerTraceId };
      }
      const scopes: string[] = Array.isArray(data.data.scopes) ? data.data.scopes.map((s: any) => String(s)) : [];
      const required = ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list'];
      const missingPublishScopes = required.filter((s) => !scopes.includes(s));
      return { ok: true, data: { isValid: data.data.is_valid === true, type: data.data.type ? String(data.data.type) : null, scopes, expiresAt: Number.isFinite(Number(data.data.expires_at)) ? Number(data.data.expires_at) : null, missingPublishScopes } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـMeta.') };
    }
  }

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
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
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
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
    }
  }

  /**
   * يقرأ عقدة التطبيق `GET /{app-id}?fields=id,name,company,app_domains` برمز
   * تطبيق (`client_id|client_secret`). غرضه إثبات أن بيانات التطبيق صالحة **من
   * جهة Graph API** (لا من شاشة الحوار فقط)، وإظهار الحقل `company` الحقيقي.
   * **لا يوجد حقل `business` على عقدة /{app-id}** في وثيقة Meta الرسمية — فلا
   * يُقرأ ولا يُخترع؛ ارتباط التطبيق بحافظة أعمال يُثبت فقط عبر
   * `GET /{business_id}/owned_apps` (يعود فارغاً بلا صلاحية إدارة أعمال).
   * لا يُعاد أي سرّ — المعرّف/الاسم/الحقول المعلنة فقط.
   */
  async getAppNode(input: { clientId: string; clientSecret: string }): Promise<FacebookResult<{ id: string; name: string | null; raw: Record<string, unknown> }>> {
    if (!input.clientId || !input.clientSecret) return { ok: false, data: null, error: 'معرّف التطبيق وسرّه مطلوبان لقراءة عقدة التطبيق.' };
    try {
      const u = new URL(facebookGraphUrl(`/${encodeURIComponent(input.clientId)}`, this.baseUrl));
      u.searchParams.set('fields', 'id,name,company,app_domains');
      u.searchParams.set('access_token', `${input.clientId}|${input.clientSecret}`);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) {
        const ex = logAndExtractFacebookError(data, `GET /${input.clientId}`, res.status);
        return { ok: false, data: null, error: errorMessage(data, 'تعذّر قراءة عقدة التطبيق من Graph API.'), providerCode: ex.providerCode, providerSubcode: ex.providerSubcode, providerTraceId: ex.providerTraceId };
      }
      // نُبقي الحقول المعلنة فقط (id/name/company/app_domains) — بلا أي حقل سرّي.
      const raw: Record<string, unknown> = { id: String(data.id) };
      if (typeof data.name === 'string') raw.name = data.name;
      if (typeof data.company === 'string') raw.company = data.company;
      if (Array.isArray(data.app_domains)) raw.app_domains = data.app_domains.map((d: any) => String(d));
      return { ok: true, data: { id: String(data.id), name: typeof data.name === 'string' ? data.name : null, raw } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
    }
  }

  /**
   * يقرأ أدوار المطوّر المعرّفة على التطبيق `GET /{app-id}/roles` (administrators/
   * developers/testers/insights users). حاسم لتشخيص تناقض «مدرَج أدمن لكن الواجهة
   * تقول لا تملك التطبيق»: يكشف **معرّف المستخدم الفعلي** الذي يحمل الدور، فيُقارَن
   * بمعرّف المستخدم الذي يفتح Money Manager Business Suite (يختلف مع ملف فيسبوك
   * إضافي). ملاحظة موثّقة: هذه العقدة **لا تُدرج** من يحمل دور الإدارة عبر الحافظة —
   * فقط أدوار تطوير التطبيق. لا يُعاد شيء سرّي (معرّف/دور فقط).
   */
  async getAppRoles(input: { clientId: string; clientSecret: string }): Promise<FacebookResult<Array<{ userId: string; role: string }>>> {
    if (!input.clientId || !input.clientSecret) return { ok: false, data: null, error: 'معرّف التطبيق وسرّه مطلوبان لقراءة أدوار التطبيق.' };
    try {
      const u = new URL(facebookGraphUrl(`/${encodeURIComponent(input.clientId)}/roles`, this.baseUrl));
      u.searchParams.set('access_token', `${input.clientId}|${input.clientSecret}`);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        const ex = logAndExtractFacebookError(data, `GET /${input.clientId}/roles`, res.status);
        return { ok: false, data: null, error: errorMessage(data, 'تعذّر قراءة أدوار التطبيق من Graph API.'), providerCode: ex.providerCode, providerSubcode: ex.providerSubcode, providerTraceId: ex.providerTraceId };
      }
      const roles = (Array.isArray(data?.data) ? data.data : [])
        .filter((r: any) => r?.user)
        .map((r: any) => ({ userId: String(r.user), role: r.role ? String(r.role) : 'unknown' }));
      return { ok: true, data: roles };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
    }
  }

  /**
   * يسرد الحافظات (Business Portfolios) التي يملك المستخدم دوراً فيها
   * `GET /me/businesses?fields=id,name,permitted_roles` برمز المستخدم الحقيقي.
   * الغرض: إثبات أن الرمز الحالي (الذي يفتح به المالك لوحة الأعمال) **يرى الحافظة
   * فعلاً** — فيُميّز أن الحافظة تحت مستخدم مختلف (ملف إضافي/حساب آخر). لا سرّ.
   */
  async listUserBusinesses(userAccessToken: string): Promise<FacebookResult<Array<{ businessId: string; name: string | null; permittedRoles: string[] }>>> {
    if (!userAccessToken) return { ok: false, data: null, error: 'رمز المستخدم غير متوفر.' };
    try {
      const u = new URL(facebookGraphUrl('/me/businesses', this.baseUrl));
      u.searchParams.set('fields', 'id,name,permitted_roles');
      u.searchParams.set('access_token', userAccessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        const ex = logAndExtractFacebookError(data, 'GET /me/businesses', res.status);
        return { ok: false, data: null, error: errorMessage(data, 'تعذّر جلب حافظات الأعمال من Graph API.'), providerCode: ex.providerCode, providerSubcode: ex.providerSubcode, providerTraceId: ex.providerTraceId };
      }
      const businesses = (Array.isArray(data?.data) ? data.data : [])
        .filter((b: any) => b?.id)
        .map((b: any) => ({ businessId: String(b.id), name: b.name ? String(b.name) : null, permittedRoles: Array.isArray(b.permitted_roles) ? b.permitted_roles.map((r: any) => String(r)) : [] }));
      return { ok: true, data: businesses };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
    }
  }

  /**
   * إثبات عكسي قراءة-فقط لارتباط التطبيق بحافظة: `GET /{business-id}/owned_apps`
   * برمز المستخدم. يعيد قائمة معرّفات التطبيقات المملوكة للحافظة. **لا ينفّذ أي
   * ربط** — قراءة فقط. غياب الصلاحية/الجلسة يُعلن بصدق بلا اختراع.
   */
  async listBusinessOwnedApps(input: { businessId: string; userAccessToken: string }): Promise<FacebookResult<string[]>> {
    if (!input.businessId || !input.userAccessToken) return { ok: false, data: null, error: 'معرّف الحافظة ورمز المستخدم مطلوبان.' };
    try {
      const u = new URL(facebookGraphUrl(`/${encodeURIComponent(input.businessId)}/owned_apps`, this.baseUrl));
      u.searchParams.set('fields', 'id,name');
      u.searchParams.set('access_token', input.userAccessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        const ex = logAndExtractFacebookError(data, `GET /${input.businessId}/owned_apps`, res.status);
        return { ok: false, data: null, error: errorMessage(data, 'تعذّر قراءة تطبيقات الحافظة (يلزم رمز مستخدم بصلاحية business_management).'), providerCode: ex.providerCode, providerSubcode: ex.providerSubcode, providerTraceId: ex.providerTraceId };
      }
      const apps = (Array.isArray(data?.data) ? data.data : []).filter((a: any) => a?.id).map((a: any) => String(a.id));
      return { ok: true, data: apps };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
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
      if (!res.ok || data?.error) { console.error(formatFacebookGraphError(extractFacebookGraphError(data, 'GET /me/accounts', res.status))); return { ok: false, data: null, error: errorMessage(data, 'تعذّر جلب صفحات Facebook.') }; }
      const pages: FacebookPageIdentity[] = (Array.isArray(data?.data) ? data.data : [])
        .filter((p: any) => p?.id)
        .map((p: any) => ({ pageId: String(p.id), pageName: p.name ? String(p.name) : null, pageAccessToken: p.access_token ? String(p.access_token) : null, tasks: Array.isArray(p.tasks) ? p.tasks.map((t: any) => String(t)) : [] }));
      // سجل نجاح بلا أي اسم/رمز: يُثبت أن /me/accounts يُعيد الصفحات ورمزها.
      console.log(`[facebook-graph] GET /me/accounts ok pages=${pages.length} withToken=${pages.filter((p) => p.pageAccessToken).length}`);
      return { ok: true, data: pages };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
    }
  }

  /** يثبت هوية الصفحة ويعيد رمزها (GET /{page-id}?fields=id,name,access_token). */
  async getPageProfile(pageId: string, accessToken: string): Promise<FacebookResult<FacebookPageIdentity>> {
    if (!pageId || !accessToken) return { ok: false, data: null, error: 'معرّف الصفحة والرمز مطلوبان.' };
    try {
      const u = new URL(facebookGraphUrl(`/${pageId}`, this.baseUrl));
      // بلا tasks: الحقل غير مستخدم في الكود، وطلبه كان يستدعي صلاحية قراءة
      // صفحة (pages_read_engagement) فيرد Meta #100 على صفحات لا تمنحها،
      // فيُفشل إكمال الربط. id/name/access_token كافية لإثبات الهوية.
      u.searchParams.set('fields', 'id,name,access_token');
      u.searchParams.set('access_token', accessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) { console.error(formatFacebookGraphError(extractFacebookGraphError(data, `GET /${pageId}`, res.status))); return { ok: false, data: null, error: errorMessage(data, 'تعذّر إثبات هوية الصفحة.') }; }
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
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
    }
  }

  /**
   * F-02: فحص صحة حقيقي خفيف للصفحة عبر Graph: `GET /{page-id}?fields=id`.
   *
   * لماذا: مسار `/api/platforms/:platform/health` كان يرد 501 لفيسبوك، فيبقى
   * الاتصال «متحققاً» إلى الأبد حتى لو سُحب التفويض أو انتهى الرمز. هذا النداء
   * الحقيقي يجعل الفحص يعكس الواقع: أي OAuthException (رمز 190) يعني أن الاتصال
   * لم يعد صالحاً فيجب إعلان `reauth_needed` بدل ادعاء الصحة.
   *
   * لا يُعاد أي رمز ولا سرّ؛ فقط تصنيف النتيجة والرسالة من Meta.
   */
  async getPageHealth(pageId: string, accessToken: string): Promise<FacebookResult<{ pageId: string }>> {
    if (!pageId || !accessToken) return { ok: false, data: null, error: 'معرّف الصفحة والرمز مطلوبان.' };
    try {
      const u = new URL(facebookGraphUrl(`/${pageId}`, this.baseUrl));
      u.searchParams.set('fields', 'id');
      u.searchParams.set('access_token', accessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) {
        const ex = logAndExtractFacebookError(data, `GET /${pageId}?fields=id`, res.status);
        const msg = errorMessage(data, 'تعذّر إثبات صحة صفحة Facebook.');
        const pCode = ex.providerCode ?? facebookProviderErrorCode(data);
        return { ok: false, data: null, error: msg, providerCode: pCode, providerSubcode: ex.providerSubcode, providerTraceId: ex.providerTraceId, code: classifyFacebookProviderError(msg, pCode) };
      }
      return { ok: true, data: { pageId: String(data.id) } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
    }
  }

  /** يقرأ حالة ظهور فيديو/منشور أُنشئ عبر API (قراءة فقط، بلا تغيير).
   *
   *  إصلاح جذر (#100 is_published): كان الطلب يضمّ `is_published` دائماً فيُرد بـ
   *  «Tried accessing nonexisting field (is_published)» على أنواع عقد لا تدعمه
   *  (مثل Video)، فيفشل التشخيص بالكامل. الآن نقرأ قائمة كاملة، ونسقط لقائمة أساسية
   *  عند رفض الحقل، ثم نختبر كل حقل على حدة لعزل الحقل غير المدعوم — فلا يُسقط حقل
   *  واحد الفحص، ولا تُخترع قيمة بديلة. كل حقل غير معلن يبقى null. */
  async getPostGrounding(pageId: string, pageAccessToken: string, providerPostId: string): Promise<FacebookResult<FacebookPostGrounding>> {
    if (!pageId || !pageAccessToken || !providerPostId) return { ok: false, data: null, error: 'معرّف الصفحة والرمز ومعرّف المنشور مطلوبة.' };
    const read = await this.readNodeFields(pageAccessToken, providerPostId);
    if (!read.ok || !read.data) {
      return { ok: false, data: null, error: read.error, code: read.code, providerCode: read.providerCode, providerSubcode: read.providerSubcode, providerTraceId: read.providerTraceId };
    }
    // دليل الظهور على الحائط: هل يرد المعرّف ضمن published_posts؟
    let appearsOnPage: boolean | null = null;
    try {
      const p = new URL(facebookGraphUrl(`/${encodeURIComponent(pageId)}/published_posts`, this.baseUrl));
      p.searchParams.set('fields', 'id');
      p.searchParams.set('limit', '100');
      p.searchParams.set('access_token', pageAccessToken);
      const pres = await this.fetchImpl(p.toString(), { method: 'GET' });
      const pdata = await pres.json().catch(() => null);
      if (pres.ok && !pdata?.error && Array.isArray(pdata?.data)) {
        appearsOnPage = pdata.data.some((x: any) => String(x?.id ?? '') === String(providerPostId));
      }
    } catch { /* الحائط غير مقروء ⇒ تبقى الحالة غير معلومة، لا فشل */ }
    return { ok: true, data: interpretPostGrounding('video', read.data, appearsOnPage, read.fieldRead) };
  }

  /**
   * يقرأ حقول عقدة Graph بذكاء بلا إسقاط الفحص عند حقل غير مدعوم:
   *  1) محاولة القائمة الكاملة.
   *  2) عند رفض حقل (#100) => محاولة القائمة الأساسية (تعمل على كل الأنواع).
   *  3) لعزل الحقل غير المدعوم بدقّة: اختبار كل حقل موسّع على حدة (قراءات قراءة-فقط،
   *     بلا تغيير). لا يُعاد أي رمز/سرّ، ويُعلن كل حقل غير مدعوم صراحةً.
   */
  private async readNodeFields(pageAccessToken: string, nodeId: string): Promise<{ ok: boolean; data: any | null; fieldRead: FacebookFieldRead; error?: string; code?: string; providerCode?: number | null; providerSubcode?: number | null; providerTraceId?: string | null }> {
    const full = [...FACEBOOK_POST_GROUNDING_FIELDS];
    const fallback = [...FACEBOOK_POST_GROUNDING_FALLBACK_FIELDS];
    const attempt = async (fields: string[]): Promise<{ res: Awaited<ReturnType<FacebookFetch>>; data: any }> => {
      const u = new URL(facebookGraphUrl(`/${encodeURIComponent(nodeId)}`, this.baseUrl));
      u.searchParams.set('fields', fields.join(','));
      u.searchParams.set('access_token', pageAccessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      return { res, data };
    };
    const fieldRead: FacebookFieldRead = { requested: full, returned: [], ok: false, unsupported: [], status: null, providerCode: null, providerMessage: null, usedFallback: false };
    // 1) القائمة الكاملة.
    const first = await attempt(full);
    fieldRead.status = first.res.status;
    const firstErr = extractFacebookGraphError(first.data, `GET /${nodeId}`, first.res.status);
    fieldRead.providerCode = firstErr.code;
    fieldRead.providerMessage = firstErr.message || null;
    if (first.res.ok && first.data?.id && !first.data?.error) {
      fieldRead.ok = true;
      fieldRead.returned = Object.keys(first.data || {});
      return { ok: true, data: first.data, fieldRead };
    }
    // 2) السقوط للقائمة الأساسية عند رفض حقل (لا يُسقط الفحص).
    fieldRead.usedFallback = true;
    const second = await attempt(fallback);
    if (!second.res.ok || !second.data?.id || second.data?.error) {
      const ex = logAndExtractFacebookError(second.data, `GET /${nodeId}`, second.res.status);
      return { ok: false, data: null, fieldRead, error: errorMessage(second.data, 'تعذّر قراءة حالة المنشور من Meta.'), providerCode: ex.providerCode, providerSubcode: ex.providerSubcode, providerTraceId: ex.providerTraceId };
    }
    fieldRead.ok = true;
    fieldRead.requested = fallback;
    fieldRead.returned = Object.keys(second.data || {});
    // 3) عزل الحقول غير المدعومة: اختبار كل حقل موسّع على حدة (لا يفشل الفحص كله).
    for (const f of full) {
      if (fallback.includes(f)) continue;
      try {
        const t = await attempt(['id', f]);
        if (!t.res.ok || t.data?.error) fieldRead.unsupported.push(f);
      } catch { fieldRead.unsupported.push(f); }
    }
    return { ok: true, data: second.data, fieldRead };
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
      if (!res.ok || data?.error || data?.success !== true) { console.error(formatFacebookGraphError(extractFacebookGraphError(data, `POST /${pageId}/subscribed_apps`, res.status))); return { ok: false, data: null, error: errorMessage(data, 'تعذّر اشتراك الصفحة في webhook.') }; }
      return { ok: true, data: true };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
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
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
    }
  }

  /**
   * يقرأ منشورات الصفحة الأخيرة (قراءة فقط) — لاكتشاف سياق المنشور الذي ورد
   * عليه تعليق، ولجلب تعليقاتها في السحب الاحتياطي. لا كتابة ولا نشر.
   */
  async listPagePosts(pageId: string, pageAccessToken: string, limit = 10): Promise<FacebookResult<Array<{ postId: string; createdAt: string | null }>>> {
    if (!pageId) return { ok: false, data: null, error: 'معرّف الصفحة مطلوب.' };
    try {
      const u = new URL(facebookGraphUrl(`/${pageId}/feed`, this.baseUrl));
      u.searchParams.set('fields', 'id,created_time');
      u.searchParams.set('limit', String(Math.max(1, Math.min(50, Math.trunc(limit)))));
      u.searchParams.set('access_token', pageAccessToken);
      const res = await this.fetchImpl(u.toString(), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) return { ok: false, data: null, error: errorMessage(data, 'فشل قراءة منشورات الصفحة.') };
      const rows = Array.isArray(data?.data) ? data.data : [];
      return { ok: true, data: rows.map((p: any) => ({ postId: String(p?.id || ''), createdAt: p?.created_time ? String(p.created_time) : null })).filter((p: any) => p.postId) };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
    }
  }

  /**
   * يقرأ تعليقات الصفحة الأخيرة من **كل أنواع المنشورات** لا من `/feed` وحده.
   *
   * الجذر المُثبت (توثيق Meta الرسمي — Page Feed reference): «Video Posts - To get
   * a list of video posts, the person making the request must be an admin of the
   * Page. Reels - To get a list of Reels published to your Page, use the Page
   * VideoReels edge.» أي أن `/{page-id}/feed` **لا يضمن** منشورات الفيديو/الريلز،
   * بينما النظام ينشر فيديو عبر `POST /{page-id}/videos`. فتعليق على منشور فيديو
   * كان غير مرئي إطلاقاً، وتعود القراءة `ok` بلا تعليقات = **فشل صامت**.
   *
   * الحل: جمع المنشورات من ثلاثة مصادر معاً — `feed` + `videos` + `video_reels` —
   * إضافةً إلى معرّفات المنشورات التي نشرها النظام فعلاً (`extraPostIds` من سجلات
   * النشر)، ثم قراءة تعليقاتها بـ`order(reverse_chronological)` (الأحدث أولاً)
   * كي لا يختفي تعليق جديد بعد تعليقات قديمة. منع التكرار بمعرّف التعليق.
   *
   * حجم النداءات (إصلاح): كان يُقرأ كل منشور بنداء منفصل (حتى ~50 نداء كل دورة).
   * الآن تُقرأ التعليقات **مجمّعة** بطلب واحد لخمسين معرّفاً عبر
   * `GET /?ids=<id1,id2,...>&fields=comments...` — فالهدف ≤ 5 نداءات للدورة على
   * فيسبوك (3 لجمع المعرّفات + 1-2 للتعليقات). فشل معرّف واحد داخل الطلب المجمّع
   * لا يُسقط الباقي (كل معرّف يُقرأ على حدة داخل الاستجابة)، وأكواد 190/10/102
   * تبقى تُوقف السحب كما كانت.
   */
  async listPageComments(pageId: string, pageAccessToken: string, limit = 25, extraPostIds: string[] = []): Promise<FacebookResult<Array<{ commentId: string; postId: string | null; message: string; authorName: string | null; authorId: string | null; createdAt: string | null; parentId: string | null }>>> {
    if (!pageId) return { ok: false, data: null, error: 'معرّف الصفحة مطلوب.' };
    try {
      const perPost = Math.max(1, Math.min(50, Math.trunc(limit)));
      const collected = await this.collectPagePostIds(pageId, pageAccessToken, extraPostIds);
      const postIds = collected.ids;
      let graphCalls = collected.calls;
      const commentsField = `comments.order(reverse_chronological).limit(${perPost}){id,message,from,created_time,parent{id},permalink_url}`;
      const out: Array<{ commentId: string; postId: string | null; message: string; authorName: string | null; authorId: string | null; createdAt: string | null; parentId: string | null }> = [];
      const seen = new Set<string>();
      let lastError: { msg: string; pCode: number | null; subcode: number | null; trace: string | null } | null = null;
      // قراءة مجمّعة: حتى 50 معرّفاً في الطلب الواحد.
      for (let i = 0; i < postIds.length; i += 50) {
        const chunk = postIds.slice(i, i + 50);
        const u = new URL(facebookGraphUrl('/', this.baseUrl));
        u.searchParams.set('ids', chunk.join(','));
        u.searchParams.set('fields', commentsField);
        u.searchParams.set('access_token', pageAccessToken);
        graphCalls += 1;
        const res = await this.fetchImpl(u.toString(), { method: 'GET' });
        const data = await res.json().catch(() => null);
        if (!res.ok || data?.error) {
          // فشل الطلب المجمّع كاملاً (مثلاً رمز منتهٍ) — يُصنَّف كخطأ حقيقي.
          // F-02: 190/10/102 تُوقف السحب ليُقلب الاتصال إلى reauth_needed.
          const msg = errorMessage(data, 'فشل قراءة تعليقات المنشورات.');
          const ex = logAndExtractFacebookError(data, 'GET /?ids=...', res.status);
          lastError = { msg, pCode: ex.providerCode ?? facebookProviderErrorCode(data), subcode: ex.providerSubcode ?? null, trace: ex.providerTraceId ?? null };
          if (lastError.pCode === 190 || lastError.pCode === 102 || lastError.pCode === 10) {
            return { ok: false, data: null, error: msg, providerCode: lastError.pCode, providerSubcode: lastError.subcode, providerTraceId: lastError.trace, code: classifyFacebookProviderError(msg, lastError.pCode) };
          }
          continue;
        }
        for (const postId of chunk) {
          const node = data && typeof data === 'object' ? (data as any)[postId] : null;
          // فشل معرّف واحد داخل الاستجابة (مثلاً `{ error: ... }`) لا يُسقط الباقي.
          if (!node || node.error) {
            if (node?.error) logAndExtractFacebookError({ error: node.error }, `GET /${postId}`, res.status);
            continue;
          }
          for (const c of Array.isArray(node?.comments?.data) ? node.comments.data : []) {
            const commentId = c?.id ? String(c.id) : '';
            const message = typeof c?.message === 'string' ? c.message : '';
            if (!commentId || !message || seen.has(commentId)) continue;
            seen.add(commentId);
            out.push({
              commentId, postId, message,
              authorName: c?.from?.name ? String(c.from.name) : null,
              authorId: c?.from?.id ? String(c.from.id) : null,
              createdAt: c?.created_time ? String(c.created_time) : null,
              parentId: c?.parent?.id ? String(c.parent.id) : null,
            });
          }
        }
      }
      if (!out.length && lastError && postIds.length) {
        // لم نقرأ أي تعليق وكل المحاولات فشلت ⇒ خطأ حقيقي لا نجاح صامت.
        return { ok: false, data: null, error: lastError.msg, providerCode: lastError.pCode, providerSubcode: lastError.subcode, providerTraceId: lastError.trace, code: classifyFacebookProviderError(lastError.msg, lastError.pCode) };
      }
      return { ok: true, data: out, postIdsScanned: postIds, graphCalls };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
    }
  }

  /**
   * يجمع معرّفات منشورات الصفحة من كل المصادر: `feed` (منشورات نصية/صور) +
   * `videos` (فيديوهات) + `video_reels` (ريلز) + معرّفات منشورة فعلاً من سجلات
   * النظام. منع تكرار بالمعرّف، مع تجاهل أي مصدر يفشل (لا يُسقط السحب كاملاً).
   * يعيد أيضاً عدد نداءات Graph التي استهلكها الجمع (3 كحدّ أقصى).
   */
  async collectPagePostIds(pageId: string, pageAccessToken: string, extraPostIds: string[] = []): Promise<{ ids: string[]; calls: number }> {
    const ids: string[] = [];
    const seen = new Set<string>();
    let calls = 0;
    const add = (v: unknown) => { const s = String(v || '').trim(); if (s && !seen.has(s)) { seen.add(s); ids.push(s); } };
    const edges: Array<{ path: string; fields: string }> = [
      { path: `/${pageId}/feed`, fields: 'id' },
      { path: `/${pageId}/videos`, fields: 'id' },
      { path: `/${pageId}/video_reels`, fields: 'id' },
    ];
    for (const edge of edges) {
      try {
        const u = new URL(facebookGraphUrl(edge.path, this.baseUrl));
        u.searchParams.set('fields', edge.fields);
        u.searchParams.set('limit', '15');
        u.searchParams.set('access_token', pageAccessToken);
        calls += 1;
        const res = await this.fetchImpl(u.toString(), { method: 'GET' });
        const data = await res.json().catch(() => null);
        if (!res.ok || data?.error) { logAndExtractFacebookError(data, `GET ${edge.path}`, res.status); continue; }
        for (const row of Array.isArray(data?.data) ? data.data : []) add(row?.id);
      } catch { /* مصدر واحد فشل ⇒ لا يُسقط الباقي */ }
    }
    for (const id of extraPostIds) add(id);
    return { ids, calls };
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
      if (!res.ok || data?.error || !data?.id) {
        const msg = errorMessage(data, 'فشل الرد على التعليق عبر Facebook.');
        const ex = logAndExtractFacebookError(data, `POST /${commentId}/comments`, res.status);
        const pCode = ex.providerCode ?? facebookProviderErrorCode(data);
        return { ok: false, data: null, error: msg, providerCode: pCode, providerSubcode: ex.providerSubcode, providerTraceId: ex.providerTraceId, code: classifyFacebookProviderError(msg, pCode) };
      }
      return { ok: true, data: { providerCommentId: String(data.id) } };
    } catch (e: any) {
      // F-07: انقطاع بعد الإرسال بلا رد مزود — لا يُصنَّف فشلاً مؤكداً (انظر idempotencyStore).
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
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
      if (!res.ok || data?.error || !data?.message_id) {
        const msg = errorMessage(data, 'فشل إرسال الرسالة عبر Facebook.');
        const ex = logAndExtractFacebookError(data, `POST /${pageId}/messages`, res.status);
        const pCode = ex.providerCode ?? facebookProviderErrorCode(data);
        return { ok: false, data: null, error: msg, providerCode: pCode, providerSubcode: ex.providerSubcode, providerTraceId: ex.providerTraceId, code: classifyFacebookProviderError(msg, pCode) };
      }
      return { ok: true, data: { providerMessageId: String(data.message_id), recipientId: data.recipient_id ? String(data.recipient_id) : null } };
    } catch (e: any) {
      // F-07: انقطاع بعد الإرسال بلا رد مزود — لا يُصنَّف فشلاً مؤكداً.
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
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
        body: buildPublishTextBody(message).toString(),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) {
        const msg = errorMessage(data, 'فشل النشر على صفحة Facebook.');
        const ex = logAndExtractFacebookError(data, `POST /${pageId}/feed`, res.status);
        const pCode = ex.providerCode ?? facebookProviderErrorCode(data);
        return { ok: false, data: null, error: msg, providerCode: pCode, providerSubcode: ex.providerSubcode, providerTraceId: ex.providerTraceId, code: classifyFacebookProviderError(msg, pCode) };
      }
      return { ok: true, data: { providerPostId: String(data.id) } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
    }
  }

  /**
   * ينشر فيديو حقيقياً على الصفحة (`POST /{page-id}/videos`) من رابط عام
   * (`file_url` — مثلاً رابط Drive العام من `videoPublicHosting.ts`). لا نجاح
   * بلا معرّف فيديو من Meta. يتطلب نفس صلاحية النشر النصي (`pages_manage_posts`)
   * — لا صلاحية إضافية.
   */
  async publishVideoToPage(pageId: string, pageAccessToken: string, fileUrl: string, description?: string): Promise<FacebookResult<{ providerPostId: string }>> {
    if (!pageId || !fileUrl?.trim()) return { ok: false, data: null, error: 'معرّف الصفحة ورابط الفيديو العام مطلوبان.' };
    try {
      const u = new URL(facebookGraphUrl(`/${pageId}/videos`, this.baseUrl));
      u.searchParams.set('access_token', pageAccessToken);
      const res = await this.fetchImpl(u.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: buildPublishVideoBody(fileUrl, description).toString(),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) { const msg = errorMessage(data, 'فشل نشر الفيديو على صفحة Facebook.'); const ex = logAndExtractFacebookError(data, `POST /${pageId}/videos`, res.status); const pCode = ex.providerCode ?? facebookProviderErrorCode(data); return { ok: false, data: null, error: msg, providerCode: pCode, providerSubcode: ex.providerSubcode, providerTraceId: ex.providerTraceId, code: classifyFacebookProviderError(msg, pCode) }; }
      return { ok: true, data: { providerPostId: String(data.id) } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
    }
  }

  /**
   * ينشر صورة حقيقية على الصفحة (`POST /{page-id}/photos`) من رابط عام
   * (`url`). لا نجاح بلا معرّف منشور من Meta. يتطلب نفس صلاحية النشر النصي
   * (`pages_manage_posts`) — لا صلاحية إضافية. بلا صورة ⇒ رفض فوري بلا شبكة.
   */
  async publishPhotoToPage(pageId: string, pageAccessToken: string, imageUrl: string, message?: string): Promise<FacebookResult<{ providerPostId: string }>> {
    if (!pageId || !imageUrl?.trim()) return { ok: false, data: null, error: 'معرّف الصفحة ورابط الصورة العام مطلوبان.' };
    try {
      const u = new URL(facebookGraphUrl(`/${pageId}/photos`, this.baseUrl));
      u.searchParams.set('access_token', pageAccessToken);
      const res = await this.fetchImpl(u.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: buildPublishPhotoBody(imageUrl, message).toString(),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.id) { const msg = errorMessage(data, 'فشل نشر الصورة على صفحة Facebook.'); const ex = logAndExtractFacebookError(data, `POST /${pageId}/photos`, res.status); const pCode = ex.providerCode ?? facebookProviderErrorCode(data); return { ok: false, data: null, error: msg, providerCode: pCode, providerSubcode: ex.providerSubcode, providerTraceId: ex.providerTraceId, code: classifyFacebookProviderError(msg, pCode) }; }
      return { ok: true, data: { providerPostId: String(data.id) } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'فشل الاتصال بـFacebook.'), code: 'NETWORK_ERROR' };
    }
  }
}
