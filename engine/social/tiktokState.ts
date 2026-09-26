/**
 * الحالة الصادقة لموصل TikTok — المصدر الواحد الذي يترجم الحقائق الحية إلى
 * مفردات الحالات المطلوبة، بلا أي ادعاء ولا خلط.
 *
 * سبب الوجود: تعدد الحقائق (اعتماد التطبيق، مفتاح التشفير، العنوان العام، جلسة
 * التفويض، التوكن، التحقق من الهوية، قيد مراجعة النشر) يجعل من السهل إعلان حالة
 * واحدة مضللة. هنا تُحسم حالة واحدة دقيقة بترتيب أسبقية صريح، مع سبب وإجراء تالٍ.
 *
 * منطق خالص بلا شبكة ولا أسرار — يُختبر بلا أي مزود حقيقي.
 */

/** مفردات الحالات الصادقة لموصل TikTok (بترتيب السلّم المنطقي). */
export const TIKTOK_TRUTHFUL_STATES = Object.freeze([
  'NOT_CONFIGURED',
  'CODE_READY',
  'READY_TO_CONNECT',
  'AUTHORIZATION_REQUIRED',
  'CONNECTED',
  'TOKEN_REFRESH_REQUIRED',
  'REVIEW_REQUIRED',
  'PUBLISHING_RESTRICTED',
  'VERIFIED',
  'OPERATIONAL',
  'EXTERNAL_BLOCKER',
] as const);

export type TikTokTruthfulState = (typeof TIKTOK_TRUTHFUL_STATES)[number];

/** التسميات العربية المعروضة في مركز الربط وبطاقة TikTok. */
export const TIKTOK_STATE_LABELS_AR: Record<TikTokTruthfulState, string> = Object.freeze({
  NOT_CONFIGURED: 'غير مُعدّ (بيانات التطبيق ناقصة)',
  CODE_READY: 'منفّذ في الكود — البيئة ناقصة',
  READY_TO_CONNECT: 'جاهز للربط',
  AUTHORIZATION_REQUIRED: 'يلزم تفويض TikTok',
  CONNECTED: 'متصل — بانتظار التوثيق',
  TOKEN_REFRESH_REQUIRED: 'يلزم تجديد التوكن / إعادة الربط',
  REVIEW_REQUIRED: 'مراجعة TikTok مطلوبة',
  PUBLISHING_RESTRICTED: 'النشر العام مقيّد (قيد المراجعة)',
  VERIFIED: 'موثق (أُثبتت الهوية)',
  OPERATIONAL: 'يعمل فعلياً (دليل من المزود)',
  EXTERNAL_BLOCKER: 'مانع خارجي',
});

/** دلالة الحالة لتلوين الواجهة: تشغيلية / انتقالية / محجوبة. */
export type TikTokStateTone = 'operational' | 'verified' | 'transitional' | 'blocked' | 'unconfigured';

export const TIKTOK_STATE_TONES: Record<TikTokTruthfulState, TikTokStateTone> = Object.freeze({
  NOT_CONFIGURED: 'unconfigured',
  CODE_READY: 'unconfigured',
  READY_TO_CONNECT: 'transitional',
  AUTHORIZATION_REQUIRED: 'transitional',
  CONNECTED: 'transitional',
  TOKEN_REFRESH_REQUIRED: 'blocked',
  REVIEW_REQUIRED: 'blocked',
  PUBLISHING_RESTRICTED: 'verified',
  VERIFIED: 'verified',
  OPERATIONAL: 'operational',
  EXTERNAL_BLOCKER: 'blocked',
});

/**
 * الحقائق الحية المحقونة. لا تحمل أي قيمة سرّية — أعلام منطقية فقط.
 */
export interface TikTokStateInput {
  /** TIKTOK_CLIENT_KEY مضبوط (وجود قيمة غير فارغة). */
  clientKeyConfigured: boolean;
  /** TIKTOK_CLIENT_SECRET مضبوط. */
  clientSecretConfigured: boolean;
  /** صيغة TIKTOK_CLIENT_KEY صالحة (بلا مسافات/محارف غريبة). */
  clientKeyFormatOk: boolean;
  /** PLATFORM_TOKEN_ENCRYPTION_KEY صالح (32 بايت). */
  encryptionKeyValid: boolean;
  /** APP_URL عام https صالح (لازم لبناء redirect_uri وتوقيع الحالة). */
  publicUrlValid: boolean;
  /** جلسة OAuth معلّقة قائمة (بدأ المالك التفويض ولم تكتمل العودة). */
  pendingAuthorization: boolean;
  /** توكن وصول مخزّن مشفّراً. */
  tokenStored: boolean;
  /** refresh token مخزّن. */
  refreshTokenStored: boolean;
  /** التوكن المخزّن منتهٍ الصلاحية. */
  tokenExpired: boolean;
  /** حالة الاتصال المحفوظة. */
  connectionStatus: 'connected' | 'reauth_needed' | 'disconnected';
  /** معرّف الحساب (open_id) محفوظ. */
  accountDiscovered: boolean;
  /** أُثبتت هوية الحساب بطلب حي ناجح من TikTok. */
  providerVerified: boolean;
  /** دليل مزود على إتمام سير عمل رسمي (نشر PUBLISH_COMPLETE مثلاً). */
  operationalEvidence: boolean;
  /** النشر المباشر العام يلزمه اجتياز Content Posting audit. */
  directPostAuditRequired: boolean;
  /**
   * إشارة رفض صريحة من المزود (إن وُجدت) — تُنقل كما هي بلا تخمين.
   * `review_required`: المزود يطلب مراجعة قبل الاستخدام.
   * `invalid_credentials`: المزود رفض بيانات التطبيق.
   */
  providerErrorKind?: 'review_required' | 'invalid_credentials' | null;
}

export interface TikTokStateResolution {
  state: TikTokTruthfulState;
  labelAr: string;
  tone: TikTokStateTone;
  /** سبب الحالة الحالي (بلا أسرار). */
  reason: string;
  /** الإجراء التالي المحدد للمالك. */
  nextAction: string;
}

/**
 * يحسم الحالة الصادقة بترتيب أسبقية صريح. القاعدة الحاكمة: لا تُعلن حالة أعلى
 * (VERIFIED/OPERATIONAL) بلا دليلها، ولا تُخفى حالة أدنى (NOT_CONFIGURED/مانع).
 */
export function resolveTikTokState(input: TikTokStateInput): TikTokStateResolution {
  const out = (state: TikTokTruthfulState, reason: string, nextAction: string): TikTokStateResolution => ({
    state,
    labelAr: TIKTOK_STATE_LABELS_AR[state],
    tone: TIKTOK_STATE_TONES[state],
    reason,
    nextAction,
  });

  const connected = input.connectionStatus === 'connected';
  const verified = connected && input.providerVerified;
  const prerequisitesComplete = input.encryptionKeyValid && input.publicUrlValid;

  // 1) بيانات تطبيق ناقصة: لا يمكن بدء أي شيء.
  if (!input.clientKeyConfigured || !input.clientSecretConfigured) {
    const missing = [
      !input.clientKeyConfigured && 'TIKTOK_CLIENT_KEY',
      !input.clientSecretConfigured && 'TIKTOK_CLIENT_SECRET',
    ].filter(Boolean).join(' و');
    return out('NOT_CONFIGURED', `بيانات تطبيق TikTok ناقصة: ${missing}.`, 'اضبط بيانات تطبيق TikTok من Developer Portal ثم أعد المحاولة.');
  }

  // 2) بيانات موجودة لكن غير صالحة شكلياً، أو رفض صريح من المزود لبيانات التطبيق.
  if (!input.clientKeyFormatOk || input.providerErrorKind === 'invalid_credentials') {
    return out('EXTERNAL_BLOCKER', !input.clientKeyFormatOk
      ? 'TIKTOK_CLIENT_KEY يحمل مسافة/محارف غريبة فلا يقبله TikTok.'
      : 'رفض TikTok بيانات التطبيق (client_key/secret) صراحةً.', 'صحّح TIKTOK_CLIENT_KEY (أرقام/محارف بلا مسافات) وTIKTOK_CLIENT_SECRET من Developer Portal.');
  }

  // 3) فشل تجديد الرمز: لا رمز صالح ولا مسار تجديد => إعادة ربط.
  if (input.connectionStatus === 'reauth_needed') {
    return out('TOKEN_REFRESH_REQUIRED', 'فشل تجديد رمز TikTok أو أُبطل التفويض لدى المزود.', 'أعد ربط TikTok من مركز ربط المنصات (تفويض جديد).');
  }

  // 4) البنية جاهزة لكن البيئة ناقصة (تشفير/عنوان عام): الكود منفّذ، لا اتصال ممكن.
  if (!prerequisitesComplete) {
    const gap = [
      !input.encryptionKeyValid && 'PLATFORM_TOKEN_ENCRYPTION_KEY (32 بايت)',
      !input.publicUrlValid && 'APP_URL عام https',
    ].filter(Boolean).join(' و');
    return out('CODE_READY', `موصل TikTok منفّذ بالكامل، لكن البيئة ناقصة: ${gap}.`, `اضبط ${gap} في بيئة الخادم ثم أعد المحاولة.`);
  }

  // 5) التوكن منتهٍ بلا refresh token => يلزم إعادة ربط.
  if (input.tokenStored && input.tokenExpired && !input.refreshTokenStored) {
    return out('TOKEN_REFRESH_REQUIRED', 'انتهى رمز TikTok ولا يوجد refresh token.', 'أعد ربط TikTok لتحصل على رمز وrefresh token جديدين.');
  }

  // 6) إشارة مراجعة صريحة من المزود قبل الاتصال => REVIEW_REQUIRED.
  if (input.providerErrorKind === 'review_required') {
    return out('REVIEW_REQUIRED', 'TikTok يطلب مراجعة التطبيق/الصلاحيات قبل الاستخدام.', 'أكمل مراجعة التطبيق والصلاحيات في TikTok Developer Portal ثم أعد الربط.');
  }

  // 7) دليل مزود على إتمام سير عمل رسمي => OPERATIONAL.
  if (verified && input.operationalEvidence) {
    return out('OPERATIONAL', 'اتصال موثق + دليل مزود على إتمام سير عمل رسمي.', 'لا إجراء مطلوب؛ الموصل يعمل فعلياً.');
  }

  // 8) اتصال موثق: النشر المباشر العام مقيّد حتى اجتياز audit، وإلا فموثق فقط.
  if (verified) {
    return input.directPostAuditRequired
      ? out('PUBLISHING_RESTRICTED', 'الاتصال موثق، لكن النشر المباشر العام يبقى SELF_ONLY حتى اجتياز Content Posting audit.', 'استخدم «رفع مسودة» الآن (بلا audit)، وأكمل Content Posting audit للنشر العام.')
      : out('VERIFIED', 'أُثبتت هوية حساب TikTok بطلب حي (open_id).', 'لا إجراء مطلوب؛ الحساب موثق.');
  }

  // 9) اتصال قائم لكن الهوية لم تُثبت بعد.
  if (connected) {
    return out('CONNECTED', 'الاتصال قائم لكن هوية الحساب لم تُثبت بعد من TikTok.', 'أعد المحاولة لإثبات الهوية (open_id) عبر TikTok.');
  }

  // 10) تفويض قائم/جلسة معلّقة أو توكن بلا اتصال => يلزم إكمال التفويض.
  if (input.pendingAuthorization || input.tokenStored || input.accountDiscovered) {
    return out('AUTHORIZATION_REQUIRED', 'بدأ التفويض أو حُفظ رمز، ولم يكتمل ربط موثق بعد.', 'أكمل شاشة تفويض TikTok حتى العودة التلقائية لإتمام الربط.');
  }

  // 11) كل الشروط حاضرة ولا توكن: جاهز للربط.
  return out('READY_TO_CONNECT', 'بيانات التطبيق والبيئة مكتملة ولم يبدأ الربط بعد.', 'اضغط «ربط TikTok» ووافق على الصلاحيات.');
}

/** هل الحالة تعني اتصالاً قائماً وموثقاً؟ (لا يُستخدم للتخمين، فقط للعرض). */
export function tiktokStateIsVerified(state: TikTokTruthfulState): boolean {
  return state === 'VERIFIED' || state === 'OPERATIONAL' || state === 'PUBLISHING_RESTRICTED';
}

/** هل الحالة تعني تشغيلاً فعلياً مثبتاً بدليل مزود؟ */
export function tiktokStateIsOperational(state: TikTokTruthfulState): boolean {
  return state === 'OPERATIONAL';
}
