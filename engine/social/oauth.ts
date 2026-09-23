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
 * - Google/Meta/X: client_id وaccess_type=offline وprompt=consent للحصول على refresh token.
 */
export function buildAuthorizationParams(input: {
  platform: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  pkceChallenge?: string;
}): Record<string, string> {
  const { platform, clientId, redirectUri, scopes, state, pkceChallenge } = input;
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
