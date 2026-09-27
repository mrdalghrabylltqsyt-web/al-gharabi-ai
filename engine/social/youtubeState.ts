/**
 * الحالة الصادقة لموصل YouTube — المصدر الواحد الذي يترجم الحقائق الحية إلى
 * مفردة حالة واحدة دقيقة، بلا ادعاء ولا خلط.
 *
 * نفس فلسفة tiktokState.ts: الحقائق متعددة (اعتماد Google، مفتاح التشفير،
 * العنوان العام، جلسة التفويض، التوكن، التحقق من القناة، حصة المزود)، فتُحسم
 * حالة واحدة بترتيب أسبقية صريح، مع سبب وإجراء تالٍ.
 *
 * منطق خالص بلا شبكة ولا أسرار — يُختبر بلا أي مزود حقيقي.
 */

/** مفردات الحالات الصادقة لموصل YouTube (بترتيب السلّم المنطقي). */
export const YOUTUBE_TRUTHFUL_STATES = Object.freeze([
  'NOT_CONFIGURED',
  'CODE_READY',
  'READY_TO_CONNECT',
  'AUTHORIZATION_REQUIRED',
  'CONNECTED',
  'TOKEN_REFRESH_REQUIRED',
  'QUOTA_EXCEEDED',
  'REVIEW_REQUIRED',
  'VERIFIED',
  'OPERATIONAL',
  'EXTERNAL_BLOCKER',
] as const);

export type YouTubeTruthfulState = (typeof YOUTUBE_TRUTHFUL_STATES)[number];

export const YOUTUBE_STATE_LABELS_AR: Record<YouTubeTruthfulState, string> = Object.freeze({
  NOT_CONFIGURED: 'غير مُعدّ (بيانات تطبيق Google ناقصة)',
  CODE_READY: 'منفّذ في الكود — البيئة ناقصة',
  READY_TO_CONNECT: 'جاهز للربط',
  AUTHORIZATION_REQUIRED: 'يلزم تفويض Google',
  CONNECTED: 'متصل — بانتظار التوثيق',
  TOKEN_REFRESH_REQUIRED: 'يلزم تجديد التوكن / إعادة الربط',
  QUOTA_EXCEEDED: 'حصة YouTube Data API مستهلكة اليوم',
  REVIEW_REQUIRED: 'مراجعة Google مطلوبة',
  VERIFIED: 'موثق (أُثبتت القناة)',
  OPERATIONAL: 'يعمل فعلياً (دليل من المزود)',
  EXTERNAL_BLOCKER: 'مانع خارجي',
});

export type YouTubeStateTone = 'operational' | 'verified' | 'transitional' | 'blocked' | 'unconfigured';

export const YOUTUBE_STATE_TONES: Record<YouTubeTruthfulState, YouTubeStateTone> = Object.freeze({
  NOT_CONFIGURED: 'unconfigured',
  CODE_READY: 'unconfigured',
  READY_TO_CONNECT: 'transitional',
  AUTHORIZATION_REQUIRED: 'transitional',
  CONNECTED: 'transitional',
  TOKEN_REFRESH_REQUIRED: 'blocked',
  QUOTA_EXCEEDED: 'blocked',
  REVIEW_REQUIRED: 'blocked',
  VERIFIED: 'verified',
  OPERATIONAL: 'operational',
  EXTERNAL_BLOCKER: 'blocked',
});

/** الحقائق الحية المحقونة — أعلام منطقية فقط، بلا أي قيمة سرّية. */
export interface YouTubeStateInput {
  /** GOOGLE_OAUTH_CLIENT_ID مضبوط. */
  clientIdConfigured: boolean;
  /** GOOGLE_OAUTH_CLIENT_SECRET مضبوط. */
  clientSecretConfigured: boolean;
  /** صيغة معرّف عميل Google صالحة (.apps.googleusercontent.com بلا مسافات). */
  clientIdFormatOk: boolean;
  /** PLATFORM_TOKEN_ENCRYPTION_KEY صالح (32 بايت). */
  encryptionKeyValid: boolean;
  /** APP_URL عام https صالح (لازم لبناء redirect_uri وتوقيع الحالة). */
  publicUrlValid: boolean;
  /** جلسة OAuth معلّقة قائمة. */
  pendingAuthorization: boolean;
  /** توكن وصول مخزّن مشفّراً. */
  tokenStored: boolean;
  /** refresh token مخزّن. */
  refreshTokenStored: boolean;
  /** التوكن المخزّن منتهٍ الصلاحية. */
  tokenExpired: boolean;
  /** حالة الاتصال المحفوظة. */
  connectionStatus: 'connected' | 'reauth_needed' | 'disconnected';
  /** معرّف القناة (channelId) محفوظ. */
  accountDiscovered: boolean;
  /** أُثبتت القناة بطلب حي ناجح (channels.list). */
  providerVerified: boolean;
  /** دليل مزود على إتمام سير عمل رسمي (نشر/رد بمعرّف حقيقي). */
  operationalEvidence: boolean;
  /** استُهلكت حصة YouTube Data API مؤخراً (خطأ quotaExceeded حقيقي). */
  quotaExceeded?: boolean;
  /** إشارة رفض صريحة من المزود (إن وُجدت) — تُنقل كما هي بلا تخمين. */
  providerErrorKind?: 'review_required' | 'invalid_credentials' | 'quota_exceeded' | null;
}

export interface YouTubeStateResolution {
  state: YouTubeTruthfulState;
  labelAr: string;
  tone: YouTubeStateTone;
  reason: string;
  nextAction: string;
}

/**
 * يحسم الحالة الصادقة بترتيب أسبقية صريح. القاعدة: لا تُعلن حالة أعلى
 * (VERIFIED/OPERATIONAL) بلا دليلها، ولا تُخفى حالة أدنى (NOT_CONFIGURED/مانع).
 */
export function resolveYouTubeState(input: YouTubeStateInput): YouTubeStateResolution {
  const out = (state: YouTubeTruthfulState, reason: string, nextAction: string): YouTubeStateResolution => ({
    state, labelAr: YOUTUBE_STATE_LABELS_AR[state], tone: YOUTUBE_STATE_TONES[state], reason, nextAction,
  });

  const connected = input.connectionStatus === 'connected';
  const verified = connected && input.providerVerified;
  const prerequisitesComplete = input.encryptionKeyValid && input.publicUrlValid;

  // 1) بيانات تطبيق Google ناقصة: لا يمكن بدء أي شيء.
  if (!input.clientIdConfigured || !input.clientSecretConfigured) {
    const missing = [
      !input.clientIdConfigured && 'GOOGLE_OAUTH_CLIENT_ID',
      !input.clientSecretConfigured && 'GOOGLE_OAUTH_CLIENT_SECRET',
    ].filter(Boolean).join(' و');
    return out('NOT_CONFIGURED', `بيانات تطبيق Google ناقصة: ${missing}.`, 'أنشئ OAuth 2.0 Client ID من Google Cloud Console ثم اضبط المتغيرين.');
  }

  // 2) بيانات موجودة لكن غير صالحة شكلياً، أو رفض صريح لبيانات التطبيق.
  if (!input.clientIdFormatOk || input.providerErrorKind === 'invalid_credentials') {
    return out('EXTERNAL_BLOCKER', !input.clientIdFormatOk
      ? 'GOOGLE_OAUTH_CLIENT_ID يحمل مسافة/محارف غريبة أو ليس معرّف عميل ويب.'
      : 'رفض Google بيانات التطبيق (client_id/secret) صراحةً.', 'صحّح GOOGLE_OAUTH_CLIENT_ID (ينتهي بـ.apps.googleusercontent.com) وGOOGLE_OAUTH_CLIENT_SECRET.');
  }

  // 3) فشل تجديد الرمز: يلزم إعادة ربط.
  if (input.connectionStatus === 'reauth_needed') {
    return out('TOKEN_REFRESH_REQUIRED', 'فشل تجديد رمز YouTube أو أُبطل التفويض لدى Google.', 'أعد ربط YouTube من مركز ربط المنصات (تفويض جديد).');
  }

  // 4) البنية جاهزة لكن البيئة ناقصة (تشفير/عنوان عام).
  if (!prerequisitesComplete) {
    const gap = [
      !input.encryptionKeyValid && 'PLATFORM_TOKEN_ENCRYPTION_KEY (32 بايت)',
      !input.publicUrlValid && 'APP_URL عام https',
    ].filter(Boolean).join(' و');
    return out('CODE_READY', `موصل YouTube منفّذ بالكامل، لكن البيئة ناقصة: ${gap}.`, `اضبط ${gap} في بيئة الخادم ثم أعد المحاولة.`);
  }

  // 5) التوكن منتهٍ بلا refresh token => إعادة ربط.
  if (input.tokenStored && input.tokenExpired && !input.refreshTokenStored) {
    return out('TOKEN_REFRESH_REQUIRED', 'انتهى رمز YouTube ولا يوجد refresh token.', 'أعد ربط YouTube لتحصل على رمز وrefresh token جديدين.');
  }

  // 6) حصة المزود مستهلكة (خطأ quotaExceeded حقيقي، لا تخمين) — اتصال قائم لكن العمل مقيّد.
  if (input.providerErrorKind === 'quota_exceeded' || input.quotaExceeded === true) {
    return out('QUOTA_EXCEEDED', 'استُهلكت حصة YouTube Data API اليومية (quotaExceeded من Google).', 'انتظر تجديد الحصة اليومية أو ارفع الحدّ من Google Cloud Console؛ لا استدعاءات API حتى ذلك.');
  }

  // 7) مراجعة صريحة من المزود.
  if (input.providerErrorKind === 'review_required') {
    return out('REVIEW_REQUIRED', 'Google يطلب مراجعة التطبيق/الصلاحيات (app verification) قبل الاستخدام الإنتاجي.', 'أكمل مراجعة Google (OAuth consent + verification) ثم أعد الربط.');
  }

  // 8) دليل مزود على إتمام سير عمل رسمي => OPERATIONAL.
  if (verified && input.operationalEvidence) {
    return out('OPERATIONAL', 'اتصال موثق بقناة YouTube + دليل مزود على إتمام سير عمل رسمي.', 'لا إجراء مطلوب؛ الموصل يعمل فعلياً.');
  }

  // 9) اتصال موثق بقناة.
  if (verified) {
    return out('VERIFIED', 'أُثبتت قناة YouTube بطلب حي (channels.list?mine=true).', 'لا إجراء مطلوب؛ القناة موثقة.');
  }

  // 10) اتصال قائم لكن القناة لم تُثبت بعد.
  if (connected) {
    return out('CONNECTED', 'الاتصال قائم لكن هوية القناة لم تُثبت بعد.', 'أعد المحاولة لإثبات القناة عبر channels.list.');
  }

  // 11) تفويض قائم/توكن بلا اتصال.
  if (input.pendingAuthorization || input.tokenStored || input.accountDiscovered) {
    return out('AUTHORIZATION_REQUIRED', 'بدأ التفويض أو حُفظ رمز، ولم يكتمل ربط قناة موثق بعد.', 'أكمل شاشة تفويض Google حتى العودة التلقائية لإتمام الربط.');
  }

  return out('READY_TO_CONNECT', 'بيانات التطبيق والبيئة مكتملة ولم يبدأ الربط بعد.', 'اضغط «ربط YouTube» ووافق على الصلاحيات.');
}

export function youtubeStateIsVerified(state: YouTubeTruthfulState): boolean {
  return state === 'VERIFIED' || state === 'OPERATIONAL';
}

export function youtubeStateIsOperational(state: YouTubeTruthfulState): boolean {
  return state === 'OPERATIONAL';
}
