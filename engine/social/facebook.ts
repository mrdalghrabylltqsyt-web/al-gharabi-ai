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
