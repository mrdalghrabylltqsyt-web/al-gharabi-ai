/**
 * الحالة الصادقة لموصل YouTube — المصدر الواحد الذي يترجم الحقائق الحية إلى
 * مفردات حالات دقيقة، بلا أي ادعاء ولا خلط.
 *
 * سبب الوجود: تعدد الحقائق (اعتماد تطبيق Google، مفتاح التشفير، العنوان العام،
 * جلسة التفويض، التوكن وتجديده، صلاحية youtube.force-ssl، إثبات القناة، دليل
 * مزود على نشر/رد فعلي) يجعل من السهل إعلان حالة واحدة مضللة. هنا تُحسم حالة
 * واحدة بدقة بترتيب أسبقية صريح مع سبب وإجراء تالٍ.
 *
 * حالة خاصة مهمة: عند إضافة youtube.force-ssl قد لا يحمل refresh token القديم
 * النطاق الجديد، فتفشل التعليقات بـ403. نُعلن `SCOPE_UPGRADE_REQUIRED` صراحةً
 * («إعادة ربط YouTube مطلوبة لتفعيل إدارة التعليقات») بدل التحايل على Google.
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
  'SCOPE_UPGRADE_REQUIRED',
  'VERIFIED',
  'PUBLISHING_RESTRICTED',
  'OPERATIONAL',
  'EXTERNAL_BLOCKER',
] as const);

export type YouTubeTruthfulState = (typeof YOUTUBE_TRUTHFUL_STATES)[number];

/** التسميات العربية المعروضة في مركز الربط وبطاقة YouTube. */
export const YOUTUBE_STATE_LABELS_AR: Record<YouTubeTruthfulState, string> = Object.freeze({
  NOT_CONFIGURED: 'غير مُعدّ (بيانات تطبيق Google ناقصة)',
  CODE_READY: 'منفّذ في الكود — البيئة ناقصة',
  READY_TO_CONNECT: 'جاهز للربط',
  AUTHORIZATION_REQUIRED: 'يلزم تفويض Google',
  CONNECTED: 'متصل — بانتظار التوثيق',
  TOKEN_REFRESH_REQUIRED: 'يلزم تجديد التوكن / إعادة الربط',
  SCOPE_UPGRADE_REQUIRED: 'إعادة ربط YouTube مطلوبة لتفعيل إدارة التعليقات',
  VERIFIED: 'موثق (أُثبتت القناة)',
  PUBLISHING_RESTRICTED: 'متصل — قدرة النشر لم تُختبر بعد بدليل مزود',
  OPERATIONAL: 'يعمل فعلياً (دليل من Google)',
  EXTERNAL_BLOCKER: 'مانع خارجي',
});

/** دلالة الحالة لتلوين الواجهة. */
export type YouTubeStateTone = 'operational' | 'verified' | 'transitional' | 'blocked' | 'unconfigured';

export const YOUTUBE_STATE_TONES: Record<YouTubeTruthfulState, YouTubeStateTone> = Object.freeze({
  NOT_CONFIGURED: 'unconfigured',
  CODE_READY: 'unconfigured',
  READY_TO_CONNECT: 'transitional',
  AUTHORIZATION_REQUIRED: 'transitional',
  CONNECTED: 'transitional',
  TOKEN_REFRESH_REQUIRED: 'blocked',
  SCOPE_UPGRADE_REQUIRED: 'blocked',
  VERIFIED: 'verified',
  PUBLISHING_RESTRICTED: 'verified',
  OPERATIONAL: 'operational',
  EXTERNAL_BLOCKER: 'blocked',
});

/** الحقائق الحية المحقونة — أعلام منطقية فقط، بلا أي قيمة سرّية. */
export interface YouTubeStateInput {
  /** GOOGLE_OAUTH_CLIENT_ID مضبوط. */
  clientIdConfigured: boolean;
  /** GOOGLE_OAUTH_CLIENT_SECRET مضبوط. */
  clientSecretConfigured: boolean;
  /** PLATFORM_TOKEN_ENCRYPTION_KEY صالح (32 بايت). */
  encryptionKeyValid: boolean;
  /** APP_URL عام https صالح. */
  publicUrlValid: boolean;
  /** جلسة OAuth معلّقة قائمة. */
  pendingAuthorization: boolean;
  /** توكن وصول مخزّن مشفّراً. */
  tokenStored: boolean;
  /** refresh token مخزّن. */
  refreshTokenStored: boolean;
  /** التوكن المخزّن منتهٍ الصلاحية. */
  tokenExpired: boolean;
  /** النطاقات الممنوحة فعلاً تتضمّن youtube.force-ssl (لإدارة التعليقات). */
  forceSslGranted: boolean;
  /** حالة الاتصال المحفوظة. */
  connectionStatus: 'connected' | 'reauth_needed' | 'disconnected';
  /** معرّف القناة محفوظ. */
  channelDiscovered: boolean;
  /** أُثبتت القناة بطلب حي ناجح من Google. */
  providerVerified: boolean;
  /** دليل مزود على إتمام عملية محتوى رسمية (فيديو بمعرّف حقيقي / رد مُسلَّم). */
  operationalEvidence: boolean;
  /** رفض صريح من Google (إن وُجد) — يُنقل كما هي بلا تخمين. */
  providerErrorKind?: 'insufficient_permissions' | 'invalid_credentials' | 'quota' | 'review_required' | null;
}

export interface YouTubeStateResolution {
  state: YouTubeTruthfulState;
  labelAr: string;
  tone: YouTubeStateTone;
  reason: string;
  nextAction: string;
}

/**
 * يحسم الحالة الصادقة بترتيب أسبقية صريح. القاعدة الحاكمة: لا تُعلن حالة أعلى
 * (VERIFIED/OPERATIONAL) بلا دليلها، ولا تُخفى حالة أدنى (NOT_CONFIGURED/مانع).
 */
export function resolveYouTubeState(input: YouTubeStateInput): YouTubeStateResolution {
  const out = (state: YouTubeTruthfulState, reason: string, nextAction: string): YouTubeStateResolution => ({
    state,
    labelAr: YOUTUBE_STATE_LABELS_AR[state],
    tone: YOUTUBE_STATE_TONES[state],
    reason,
    nextAction,
  });

  const connected = input.connectionStatus === 'connected';
  const verified = connected && input.providerVerified;
  const prerequisitesComplete = input.encryptionKeyValid && input.publicUrlValid;

  // 1) بيانات تطبيق Google ناقصة.
  if (!input.clientIdConfigured || !input.clientSecretConfigured) {
    const missing = [
      !input.clientIdConfigured && 'GOOGLE_OAUTH_CLIENT_ID',
      !input.clientSecretConfigured && 'GOOGLE_OAUTH_CLIENT_SECRET',
    ].filter(Boolean).join(' و');
    return out('NOT_CONFIGURED', `بيانات تطبيق Google ناقصة: ${missing}.`, 'اضبط بيانات تطبيق Google من Cloud Console ثم أعد المحاولة.');
  }

  // 2) رفض صريح لبيانات التطبيق من Google => مانع خارجي.
  if (input.providerErrorKind === 'invalid_credentials') {
    return out('EXTERNAL_BLOCKER', 'رفض Google بيانات التطبيق (client_id/secret) صراحةً.', 'صحّح GOOGLE_OAUTH_CLIENT_ID/SECRET من Cloud Console ثم أعد الربط.');
  }

  // 3) فشل تجديد الرمز => إعادة ربط.
  if (input.connectionStatus === 'reauth_needed') {
    return out('TOKEN_REFRESH_REQUIRED', 'فشل تجديد رمز Google أو أُبطل التفويض لدى المزود.', 'أعد ربط YouTube من مركز ربط المنصات (تفويض جديد).');
  }

  // 4) البنية جاهزة لكن البيئة ناقصة. مفتاح التشفير لازم دائماً (لقراءة الرمز
  //    المخزّن)، أما العنوان العام فيلزم لبدء التفويض فقط — فاتصال موثق قائم
  //    لا يُخفَض إلى CODE_READY لغيابه.
  if (!input.encryptionKeyValid) {
    return out('CODE_READY', 'موصل YouTube منفّذ بالكامل، لكن PLATFORM_TOKEN_ENCRYPTION_KEY (32 بايت) غير صالح.', 'اضبط PLATFORM_TOKEN_ENCRYPTION_KEY في بيئة الخادم ثم أعد المحاولة.');
  }
  if (!input.publicUrlValid && !verified) {
    return out('CODE_READY', 'موصل YouTube منفّذ بالكامل، لكن APP_URL عام https ناقص (يلزم لبدء التفويض).', 'اضبط APP_URL عام https في بيئة الخادم ثم أعد الربط.');
  }

  // 5) التوكن منتهٍ بلا refresh => إعادة ربط.
  if (input.tokenStored && input.tokenExpired && !input.refreshTokenStored) {
    return out('TOKEN_REFRESH_REQUIRED', 'انتهى رمز Google ولا يوجد refresh token.', 'أعد ربط YouTube لتحصل على رمز وrefresh token جديدين.');
  }

  // 6) اتصال موثق لكن النطاقات الممنوحة تفتقد force-ssl => إعادة ربط للتعليقات.
  //    هذه الحالة بالضبط ما تطلبه سياسة المشروع: لا تحايل على Google، بل إعلان
  //    الحاجة لإعادة الربط.
  if (verified && !input.forceSslGranted) {
    return out(
      'SCOPE_UPGRADE_REQUIRED',
      'الاتصال موثق لكن الرمز لا يحمل نطاق youtube.force-ssl اللازم لقراءة التعليقات والرد عليها.',
      'أعد ربط YouTube لتفعيل إدارة التعليقات (يُطلب نطاق youtube.force-ssl عند إعادة التفويض).',
    );
  }

  // 7) رفض صريح للصلاحية من Google على عملية محتوى.
  if (verified && input.providerErrorKind === 'insufficient_permissions') {
    return out('SCOPE_UPGRADE_REQUIRED', 'رفض Google العملية بسبب نطاق ناقص (insufficientPermissions).', 'أعد ربط YouTube لتفعيل النطاقات المطلوبة.');
  }

  // 8) حصة/مراجعة صريحة من المزود.
  if (input.providerErrorKind === 'review_required') {
    return out('EXTERNAL_BLOCKER', 'Google يطلب مراجعة/تحققاً إضافياً قبل الاستخدام.', 'أكمل التحقق في Google Cloud Console ثم أعد الربط.');
  }

  // 9) دليل مزود على إتمام عملية محتوى رسمية => OPERATIONAL.
  if (verified && input.operationalEvidence) {
    return out('OPERATIONAL', 'اتصال موثق + دليل مزود على إتمام عملية محتوى رسمية (معرّف من Google).', 'لا إجراء مطلوب؛ الموصل يعمل فعلياً.');
  }

  // 10) اتصال موثق بلا دليل محتوى بعد => قدرات المحتوى متاحة لكن لم تُثبت بدليل.
  if (verified) {
    return out('PUBLISHING_RESTRICTED', 'أُثبتت القناة، لكن قدرة النشر/الرد لم تُثبت بعد بدليل مزود (فيديو/رد بمعرّف من Google).', 'نفّذ أول عملية محتوى (رفع فيديو أو رد) لإثبات القدرة التشغيلية.');
  }

  // 11) اتصال قائم لكن القناة لم تُثبت بعد.
  if (connected) {
    return out('CONNECTED', 'الاتصال قائم لكن قناة YouTube لم تُثبت بعد من Google.', 'أعد المحاولة لإثبات القناة (channels.list?mine=true).');
  }

  // 12) تفويض قائم/توكن بلا اتصال => يلزم إكمال التفويض.
  if (input.pendingAuthorization || input.tokenStored || input.channelDiscovered) {
    return out('AUTHORIZATION_REQUIRED', 'بدأ التفويض أو حُفظ رمز، ولم يكتمل ربط موثق بعد.', 'أكمل شاشة تفويض Google حتى العودة التلقائية لإتمام الربط.');
  }

  // 13) كل الشروط حاضرة ولا توكن: جاهز للربط.
  return out('READY_TO_CONNECT', 'بيانات التطبيق والبيئة مكتملة ولم يبدأ الربط بعد.', 'اضغط «ربط YouTube» ووافق على الصلاحيات.');
}

/** هل الحالة تعني اتصالاً قائماً وموثقاً؟ */
export function youtubeStateIsVerified(state: YouTubeTruthfulState): boolean {
  return state === 'VERIFIED' || state === 'OPERATIONAL' || state === 'PUBLISHING_RESTRICTED';
}

/** هل الحالة تعني تشغيلاً فعلياً مثبتاً بدليل مزود؟ */
export function youtubeStateIsOperational(state: YouTubeTruthfulState): boolean {
  return state === 'OPERATIONAL';
}

// ---------------------------------------------------------------------------
// وضع YOUTUBE_ONLY_OPERATIONAL — حارس مركزي لتنفيذ المنصة الواحدة
// ---------------------------------------------------------------------------

/** المنصة الوحيدة المسموح بها في الوضع المركّز. */
export const YOUTUBE_ONLY_PLATFORM = 'youtube';

/**
 * هل وضع YouTube-only مفعّل؟ يُقرأ من البيئة عند كل استخدام (لا وقت الإقلاع)
 * كي يسري التغيير بلا إعادة بناء. القيم المقبولة: 1/true/yes/on.
 */
export function youtubeOnlyModeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = String(env.YOUTUBE_ONLY_OPERATIONAL || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

export interface PlatformGuardDecision {
  allowed: boolean;
  code?: 'PLATFORM_NOT_ALLOWED_IN_YOUTUBE_ONLY';
  reason?: string;
}

/**
 * الحارس المركزي: في وضع YouTube-only لا يُسمح بأي عملية خارجية على منصة غير
 * YouTube. لا يُرسَل أي طلب خارجي، ويُعلن المنع صراحةً بلا فشل صامت.
 */
export function guardExternalOperationPlatform(platform: string, env: Record<string, string | undefined> = process.env): PlatformGuardDecision {
  if (!youtubeOnlyModeEnabled(env)) return { allowed: true };
  if (String(platform) === YOUTUBE_ONLY_PLATFORM) return { allowed: true };
  return {
    allowed: false,
    code: 'PLATFORM_NOT_ALLOWED_IN_YOUTUBE_ONLY',
    reason: `وضع YOUTUBE_ONLY_OPERATIONAL مفعّل: لا تُنفَّذ أي عملية خارجية على منصة «${platform}»؛ المسموح هو YouTube فقط.`,
  };
}
