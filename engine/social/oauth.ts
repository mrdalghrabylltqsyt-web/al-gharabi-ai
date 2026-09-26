/**
 * أساس OAuth المشترك — منطق خالص قابل للاختبار بلا شبكة.
 *
 * سبب الوجود: كان منطق بدء OAuth مبعثراً في مسار الخادم. هنا تُجمع القواعد
 * الحرجة (حماية state من CSRF، PKCE لـTikTok/X، انتهاء الصلاحية، منع إعادة
 * استخدام state) في دوال حتمية، ويستدعيها الخادم.
 *
 * لا يحتوي هذا الملف أي سرّ ولا يستدعي أي شبكة. تبادل الرمز وتشفيره يبقيان في
 * طبقة الخادم حيث مفتاح التشفير.
 */

import crypto from 'node:crypto';

export interface OAuthPendingState {
  platform: string;
  userId: string;
  expiresAt: number;
  /** مُتحقّق PKCE للمنصات التي تفرضه (TikTok/X). */
  codeVerifier?: string;
  /** رابط الإرجاع المستخدم عند البدء للتحقق منه عند العودة. */
  redirectUri: string;
}

/** مهلة صلاحية state الافتراضية (10 دقائق) — أقصر ما يسمح به إتمام الربط. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * قيمة `extras` الرسمية لتدفّق «Facebook Login for Business - Instagram API».
 * المصدر: وثيقة Meta الرسمية (business-login-for-instagram) — تُطلب حرفياً
 * `{"setup":{"channel":"IG_API_ONBOARDING"}}` لتظهر نافذة الإعداد الموحّدة التي
 * تحوّل الحساب إلى مهني وتربط صفحة Facebook في نافذة واحدة.
 */
export const INSTAGRAM_ONBOARDING_EXTRAS = '{"setup":{"channel":"IG_API_ONBOARDING"}}';

/**
 * يحلل مقطع الاستجابة الذي تُلحقه Meta بـredirect_uri في تدفّق
 * «response_type=token»: `#access_token=...&long_lived_token=...&expires_in=...`.
 * يفضّل الرمز طويل الأجل (المطلوب للاستمرار)، ويرجع الرمز القصير إن غاب.
 * لا يحتفظ بأي قيمة في السجل ولا يطبعها — التخزين مسؤولية طبقة الخادم المشفّرة.
 */
export function parseInstagramTokenFragment(fragment: string): { accessToken?: string; longLivedToken?: string; expiresIn?: number; dataAccessExpirationTime?: number; error?: string; errorReason?: string } {
  const raw = String(fragment || '').replace(/^#/, '');
  if (!raw) return {};
  const p = new URLSearchParams(raw);
  const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  return {
    accessToken: p.get('access_token') || undefined,
    longLivedToken: p.get('long_lived_token') || undefined,
    expiresIn: num(p.get('expires_in')),
    dataAccessExpirationTime: num(p.get('data_access_expiration_time')),
    error: p.get('error') || undefined,
    errorReason: p.get('error_reason') || undefined,
  };
}

/** يولّد state عشوائياً قوياً (192 بت) غير قابل للتخمين. */
export function createOAuthState(): string {
  return crypto.randomBytes(24).toString('hex');
}

/** يولّد مُتحقّق PKCE (RFC 7636) وتحدّيه. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * هل ينطبق PKCE على هذه المنصة؟ (تفرضه TikTok و X عبر OAuth 2.0.)
 */
export function requiresPkce(platform: string): boolean {
  return platform === 'tiktok' || platform === 'x';
}

/**
 * أسماء متغيرات بيئة Configuration ID لـFacebook Login for Business، لكل منصة
 * بترتيب أولوية واضح. Instagram يفضّل معرّفه الخاص ثم يتشارك معرّف Facebook.
 *
 * سبب الوجود: مسار Facebook Login for Business يمرّر `config_id` بدل `scope`،
 * والConfiguration تحمل الصلاحيات وحقول الوصول. استخدام معرّف خاطئ (أو تمريره مع
 * scope معاً) يُنتج رفضاً من Meta قبل شاشة الموافقة بلا سبب ظاهر.
 */
export const LOGIN_CONFIG_ENV_NAMES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  facebook: ['FACEBOOK_LOGIN_CONFIG_ID'],
  instagram: ['INSTAGRAM_LOGIN_CONFIG_ID', 'FACEBOOK_LOGIN_CONFIG_ID'],
});

/**
 * Configuration ID صالح شكلياً: أرقام فقط (بلا مسافات ولا حروف). Meta ترفض
 * معرّفاً غير صالح أو تعرض صفحة عامة، فنرفضه محلياً قبل إرسال المالك.
 */
export function isPlausibleLoginConfigId(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9]{6,20}$/.test(value);
}

/**
 * يحسم Configuration ID من البيئة بترتيب الأولوية، ويميّز الغائب من المضبوط
 * بشكل غير صالح (بلا كشف أي قيمة).
 *
 * المسافة/السطر الزائد لا يُبطل القيمة: تُطبَّع كما يفعل `envSecret` لبقية
 * الأسرار، وتُسجَّل في `normalized` للتشخيص فقط. أما محتوى غير رقمي فيُبطل
 * القيمة (`valid=false`) لأن Meta ترفضه أو تعرض صفحة عامة.
 */
export function inspectLoginConfigId(
  platform: string,
  env: Record<string, string | undefined> = process.env,
): { configured: boolean; valid: boolean; normalized: boolean; envName: string | null; problems: string[] } {
  const names = LOGIN_CONFIG_ENV_NAMES[platform] || [];
  const problems: string[] = [];
  let firstPresent: string | null = null;
  let normalized = false;
  for (const name of names) {
    const raw = env[name];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    if (firstPresent === null) firstPresent = name;
    const trimmed = raw.trim();
    if (trimmed !== raw) normalized = true;
    if (!isPlausibleLoginConfigId(trimmed)) {
      problems.push(`${name} ليس أرقاماً فقط (Configuration ID رقم من Meta App Dashboard).`);
    }
  }
  const valid = problems.length === 0 && firstPresent !== null;
  return { configured: firstPresent !== null, valid, normalized, envName: firstPresent, problems };
}

/** يعيد Configuration ID الصالح (مطبّعاً) أو null إن غاب/كان غير صالح. */
export function resolveLoginConfigId(
  platform: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const names = LOGIN_CONFIG_ENV_NAMES[platform] || [];
  for (const name of names) {
    const raw = env[name];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (isPlausibleLoginConfigId(trimmed)) return trimmed;
  }
  return null;
}

/** هل انتهت صلاحية state؟ */
export function isStateExpired(pending: Pick<OAuthPendingState, 'expiresAt'>, now = Date.now()): boolean {
  return !Number.isFinite(pending.expiresAt) || pending.expiresAt <= now;
}

/**
 * يتحقق أن العودة تطابق جلسة البدء: نفس المنصة، نفس المستخدم، نفس رابط الإرجاع،
 * ولم تنتهِ الصلاحية. أي اختلاف = رفض (حماية CSRF ومنع تبديل السياق).
 */
export function validateOAuthCallback(input: {
  pending: OAuthPendingState | undefined | null;
  platform: string;
  redirectUri: string;
  now?: number;
}): { ok: boolean; reason?: string } {
  const { pending, platform, redirectUri } = input;
  if (!pending) return { ok: false, reason: 'جلسة OAuth غير معروفة أو أُعيد استخدامها.' };
  if (pending.platform !== platform) return { ok: false, reason: 'المنصة لا تطابق جلسة OAuth المبدوءة.' };
  if (pending.redirectUri !== redirectUri) return { ok: false, reason: 'رابط الإرجاع لا يطابق جلسة OAuth.' };
  if (isStateExpired(pending, input.now ?? Date.now())) return { ok: false, reason: 'انتهت صلاحية جلسة OAuth.' };
  return { ok: true };
}

/**
 * يبني معاملات رابط التفويض. يعزل الفروق بين المزودين:
 * - TikTok: تسمية client_key وcode_challenge (PKCE إلزامي).
 * - Meta (facebook/instagram): scope مفصول بفواصل، وبلا access_type/prompt
 *   (معاملان خاصان بـGoogle؛ Meta لا تعرفهما ولا تحتاجهما).
 * - Threads: client_id وscope بفواصل.
 * - Google/X: client_id وscope بمسافة وaccess_type=offline وprompt=consent
 *   للحصول على refresh token.
 */
export function buildAuthorizationParams(input: {
  platform: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  pkceChallenge?: string;
  /** Configuration ID لـFacebook Login for Business (facebook/instagram فقط). */
  loginConfigId?: string | null;
  /** تفعيل تدفّق Instagram الرسمي (display/extras/response_type=token) — Instagram فقط. */
  instagramOnboarding?: boolean;
}): Record<string, string> {
  const { platform, clientId, redirectUri, scopes, state, pkceChallenge, loginConfigId, instagramOnboarding } = input;
  const params: Record<string, string> = {
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  };
  if (platform === 'tiktok') {
    params.client_key = clientId;
    params.scope = scopes.join(',');
    if (pkceChallenge) {
      params.code_challenge = pkceChallenge;
      params.code_challenge_method = 'S256';
    }
    return params;
  }
  // منصات Meta وThreads تستخدم client_id وscope بفواصل، ولا تتوقّع
  // access_type/prompt (معاملان خاصان بـGoogle). إضافتهما ليست سبب رفض Meta،
  // لكن حذفهما يجعل الطلب مطابقاً لعقد Meta الرسمي حرفياً.
  if (platform === 'facebook' || platform === 'instagram' || platform === 'threads') {
    params.client_id = clientId;
    // Instagram API with Facebook Login → «Facebook Login for Business - Instagram API»:
    // الوثيقة الرسمية تشترط display=page وextras={"setup":{"channel":"IG_API_ONBOARDING"}}
    // وresponse_type=token (لا code). بلا هذه المعاملات يمرّ المالك بمسار عام بلا
    // نافذة الإعداد الموحّدة (تحويل الحساب المهني + ربط الصفحة) — وهو موضع «حدث خطأ ما».
    // Facebook لا يتأثّر: الفرع خاص بـinstagram وحده.
    if (platform === 'instagram' && instagramOnboarding) {
      params.display = 'page';
      params.extras = INSTAGRAM_ONBOARDING_EXTRAS;
      params.response_type = 'token';
    }
    // Facebook Login for Business: config_id يحلّ محل scope، وإرسالهما معاً
    // يتعارض (الConfiguration تحمل الصلاحيات وحقول الوصول). Threads لا يستخدمه.
    if (loginConfigId && (platform === 'facebook' || platform === 'instagram')) {
      params.config_id = loginConfigId;
    } else {
      params.scope = scopes.join(',');
    }
    if (pkceChallenge) {
      params.code_challenge = pkceChallenge;
      params.code_challenge_method = 'S256';
    }
    return params;
  }
  params.client_id = clientId;
  params.scope = scopes.join(' ');
  // طلب refresh token: مطلوب لاستمرار الاتصال بعد انتهاء access token.
  params.access_type = 'offline';
  params.prompt = 'consent';
  if (pkceChallenge) {
    params.code_challenge = pkceChallenge;
    params.code_challenge_method = 'S256';
  }
  return params;
}

/** يبني جسم تبادل الرمز بصيغة application/x-www-form-urlencoded. */
export function buildTokenExchangeBody(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}): URLSearchParams {
  const body = new URLSearchParams();
  body.set('client_id', input.clientId);
  body.set('client_secret', input.clientSecret);
  body.set('code', input.code);
  body.set('grant_type', 'authorization_code');
  body.set('redirect_uri', input.redirectUri);
  if (input.codeVerifier) body.set('code_verifier', input.codeVerifier);
  return body;
}

/**
 * هل الرمز المُعاد صالح للاستخدام؟ يلزم access_token، ويُعلن وجود refresh token
 * صراحةً (بعض المزودين لا يعيدونه في وضع معيّن).
 */
export function parseTokenResponse(token: any): { valid: boolean; accessToken: string | null; refreshToken: string | null; expiresIn: number | null; reason?: string } {
  if (!token || typeof token !== 'object') return { valid: false, accessToken: null, refreshToken: null, expiresIn: null, reason: 'استجابة تبادل الرمز فارغة أو مشوّهة.' };
  const accessToken = typeof token.access_token === 'string' && token.access_token.trim() ? token.access_token.trim() : null;
  if (!accessToken) return { valid: false, accessToken: null, refreshToken: null, expiresIn: null, reason: 'لم يُعد المزود access_token صالحاً.' };
  const refreshToken = typeof token.refresh_token === 'string' && token.refresh_token.trim() ? token.refresh_token.trim() : null;
  const expiresIn = Number.isFinite(Number(token.expires_in)) ? Number(token.expires_in) : null;
  return { valid: true, accessToken, refreshToken, expiresIn };
}

/**
 * هل انتهى access token؟ يستخدم انتهاءً مطلقاً محسوباً عند الحفظ، مع هامش
 * أمان افتراضي (60 ثانية) لتفادي الاستخدام على حدّ الانتهاء.
 */
export function isAccessTokenExpired(input: { expiresAt: number | null | undefined; now?: number; skewMs?: number }): boolean {
  if (input.expiresAt === null || input.expiresAt === undefined) return false; // لا انتهاء معلن => لا نحكم بالانتهاء
  const skew = input.skewMs ?? 60_000;
  return (input.now ?? Date.now()) >= Number(input.expiresAt) - skew;
}
