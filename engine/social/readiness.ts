/**
 * مصفوفة جاهزية المنصات — المصدر الواحد الذي يعكس حالة الكود الحقيقية.
 *
 * سبب الوجود: تعدد المنصات يجعل من السهل الانحراف بين ما يعلنه السجل وما هو
 * منفّذ فعلاً. هنا يُبنى كل صف من `PLATFORM_SPECS` مباشرة (القدرات) مع أعلام
 * التنفيذ الحقيقية (الموصل) والمتطلبات الخارجية، فلا يُعلن شيء غير موجود.
 *
 * المصطلحات المستخدمة:
 * - READY: منفّذ فعلاً في الكود وقابل للاستعمال عند توفر الاعتماد.
 * - EXTERNAL_SETUP_REQUIRED: البنية جاهزة لكن الإتمام يحتاج إجراءً خارجياً
 *   (تطبيق مطوّر/مراجعة/صلاحية/تسجيل Redirect URI...).
 * - NOT_SUPPORTED: المنصة نفسها لا توفر هذه القدرة عبر واجهتها الرسمية.
 *
 * تنبيه: هذه المصفوفة تصف الكود والمتطلبات. أما «متصل» فهي حالة تشغيلية تُقرأ
 * من الخادم بعد إثبات المزود، ولا تُشتق من هنا.
 */

import { PLATFORM_SPECS, platformSupports } from './registry';
import type { PlatformId } from './adapter';

export type ReadinessLevel = 'READY' | 'EXTERNAL_SETUP_REQUIRED' | 'NOT_SUPPORTED';

/** مستوى الحالة العملي المعروض في مصفوفة المالك (يشمل الحجب). */
export type OperationalLevel = ReadinessLevel | 'BLOCKED';

export type ImplementationStatus =
  | 'CONNECTOR_READY'
  | 'FOUNDATION_READY'
  | 'EXTERNAL_SETUP_REQUIRED'
  | 'CAPABILITY_NOT_SUPPORTED';

export interface PlatformReadiness {
  platform: PlatformId;
  displayName: string;
  /** موصل إرسال/استقبال حقيقي منفّذ في الكود. */
  connector: ReadinessLevel;
  /** آلية الاعتماد الرسمية (token/oauth/app-registration). */
  credentialMode: 'bot-token' | 'oauth2' | 'app-registration';
  /** بدء مصافحة OAuth (auth + token endpoints) جاهزة في الكود. */
  oauth: ReadinessLevel;
  /** إتمام الاتصال (رمز/تبادل/تشفير/تحقق حساب). */
  connection: ReadinessLevel;
  /** إثبات الحساب لدى المزود. */
  verification: ReadinessLevel;
  /** استقبال webhook حقيقي موثّق. */
  webhook: ReadinessLevel;
  /** قراءة التعليقات/الرسائل الواردة. */
  read: ReadinessLevel;
  /** الرد على تعليق/رسالة. */
  reply: ReadinessLevel;
  /** نشر منشور/رسالة عامة. */
  publish: ReadinessLevel;
  /** الجدولة (منطق النظام) مقيدة بقدرة المنصة. */
  schedule: ReadinessLevel;
  /** مؤشرات الأداء عبر الواجهة الرسمية. */
  analytics: ReadinessLevel;
  /** إجراءات خارجية لازمة قبل أي تشغيل حقيقي (متغيرات بيئة/خطوات مزود). */
  externalSetup: string[];
  implementationStatus: ImplementationStatus;
  note: string;
}

/** صف جاهزية غني يضيف حالة الاعتماد والاتصال والإجراء التالي للمالك. */
export interface PlatformReadinessDetail extends PlatformReadiness {
  /** حالة البيانات اللازمة لإتمام الاتصال (أسماء متغيرات بيئة ناقصة/غير صالحة إن وُجدت). */
  credentials: { configured: boolean; missing: string[]; invalid: string[] };
  /** حالة بيانات webhook. */
  webhookCredentials: { configured: boolean; missing: string[]; invalid: string[] };
  /** الحالة التشغيلية الدقيقة الآن (من control plane): CODE_READY/CONNECTED/OPERATIONAL... */
  operationalState: string;
  /** هل الاتصال قائم الآن؟ */
  connected: boolean;
  providerVerified: boolean;
  /**
   * مستويات العمليات التشغيلية الفعلية الآن: READY إن كان الحساب موثقاً وكانت
   * القدرة مدعومة، وBLOCKED إن كانت مدعومة لكن الحساب غير موثق، وNOT_SUPPORTED
   * إن كانت المنصة لا توفرها. منفصلة عن مستويات الكود أعلاه حتى لا يختلط
   * «منفّذ في الكود» بـ«يعمل الآن».
   */
  operational: {
    connection: OperationalLevel;
    verification: OperationalLevel;
    webhook: OperationalLevel;
    read: OperationalLevel;
    reply: OperationalLevel;
    publish: OperationalLevel;
    schedule: OperationalLevel;
    analytics: OperationalLevel;
  };
  /** سبب الحجب الرئيسي (إن وُجد). */
  blockingReason: string | null;
  /** الإجراء التالي المحدد. */
  nextAction: string;
}

/**
 * دعم المنصات للـwebhooks عبر واجهاتها الرسمية. منصات لا تقدم webhooks
 * (Snapchat، Google Business) تُعلن NOT_SUPPORTED بصراحة.
 * TikTok: webhooks أحداث التطبيق الرسمية (authorization.removed، video.upload.failed،
 * video.publish.completed) — التوقيع TikTok-Signature منفّذ، والتسجيل يتم من
 * Developer Portal (callback URL)، وهو إجراء خارجي.
 */
const WEBHOOK_SUPPORT: Record<PlatformId, { level: ReadinessLevel; note: string }> = {
  tiktok: { level: 'EXTERNAL_SETUP_REQUIRED', note: 'webhooks TikTok منفّذة في الكود: تحقق TikTok-Signature على الجسم الخام (timestamp.rawBody) + منع تكرار + حفظ قبل الإقرار. يلزم تسجيل callback URL في TikTok Developer Portal.' },
  youtube: { level: 'EXTERNAL_SETUP_REQUIRED', note: 'إشعارات PubSubHubbub لليوتيوب تحتاج تسجيل تطبيق وتحقق نطاق.' },
  facebook: { level: 'READY', note: 'webhook Facebook منفّذ فعلاً: تحقق challenge + توقيع X-Hub-Signature-256 على الجسم الخام + منع تكرار بمعرّف الحدث.' },
  instagram: { level: 'READY', note: 'webhook إنستغرام منفّذ فعلاً عبر نفس تطبيق Meta: تحقق challenge + توقيع X-Hub-Signature-256 على الجسم الخام + منع تكرار بمعرّف التعليق/الرسالة. تُفعَّل حقول instagram من لوحة تطبيق Meta.' },
  whatsapp: { level: 'EXTERNAL_SETUP_REQUIRED', note: 'WhatsApp Cloud API تدعم webhooks بعد ربط رقم أعمال معتمد.' },
  telegram: { level: 'READY', note: 'webhook حقيقي منفّذ بترويسة سرّية + منع تكرار update_id.' },
  x: { level: 'EXTERNAL_SETUP_REQUIRED', note: 'Account Activity API يحتاج خطة مدفوعة واشتراكاً.' },
  snapchat: { level: 'NOT_SUPPORTED', note: 'لا توفر Snapchat webhooks للتعليقات/الرسائل العامة.' },
  threads: { level: 'EXTERNAL_SETUP_REQUIRED', note: 'Threads webhooks تحتاج تطبيق Meta معتمداً.' },
  google_business: { level: 'NOT_SUPPORTED', note: 'لا توفر Google Business Profile webhooks للمراجعات عبر واجهتها.' },
};

/**
 * المتطلبات الخارجية لكل منصة. لا تحمل أي قيمة سرّية — أسماء متغيرات وخطوات فقط.
 */
const EXTERNAL_SETUP: Record<PlatformId, string[]> = {
  tiktok: ['تطبيق TikTok for Developers (Web)', 'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET', 'تسجيل Redirect URI: /api/platforms/tiktok/oauth/callback', 'النطاقات: user.info.basic, video.publish, video.list', 'مراجعة Content Posting (audit) لرفع قيد النشر العام (SELF_ONLY قبله)', 'تسجيل callback URL للـwebhooks (اختياري)'],
  youtube: ['Google Cloud Project', 'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET', 'تمكين YouTube Data API', 'تسجيل Redirect URI', 'مراجعة الصلاحيات الحساسة'],
  facebook: ['Meta App', 'FACEBOOK_OAUTH_CLIENT_ID / FACEBOOK_OAUTH_CLIENT_SECRET', 'App Review لصلاحيات الصفحة', 'تسجيل Redirect URI'],
  instagram: ['Meta App + حساب Instagram Professional (Business/Creator) مرتبط بالصفحة', 'بيانات تطبيق Meta نفسها (FACEBOOK_OAUTH_CLIENT_ID/SECRET) أو INSTAGRAM_* خاصة', 'App Review لصلاحيات instagram_manage_comments/manage_messages (Advanced Access)', 'تسجيل Redirect URI وتفعيل حقول webhook من لوحة Meta'],
  whatsapp: ['Meta Business + رقم أعمال', 'WhatsApp Cloud API access token + phone number id', 'قوالب رسائل معتمدة', 'webhook مع رمز تحقق'],
  telegram: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_DEFAULT_CHAT_ID (للنشر)', 'APP_URL عام'],
  x: ['X Developer App (خطة مدفوعة)', 'X_OAUTH_CLIENT_ID / X_OAUTH_CLIENT_SECRET', 'OAuth 2.0 PKCE', 'تسجيل Redirect URI'],
  snapchat: ['Snap Developer App', 'SNAPCHAT_OAUTH_CLIENT_ID / SNAPCHAT_OAUTH_CLIENT_SECRET', 'صلاحيات الإعلانات/الحساب', 'تسجيل Redirect URI'],
  threads: ['Meta App', 'THREADS_OAUTH_CLIENT_ID / THREADS_OAUTH_CLIENT_SECRET', 'مراجعة صلاحيات Threads API', 'تسجيل Redirect URI'],
  google_business: ['Google Cloud Project', 'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET', 'تمكين Business Profile API', 'طلب وصول عبر نموذج Google', 'تسجيل Redirect URI'],
};

/**
 * المنصات التي لها مصافحة OAuth منفّذة في الكود (بدء + تبادل رمز). WhatsApp
 * يستخدم Cloud API token وليس OAuth، وTelegram يستخدم bot token. لذلك تظهر
 * NOT_SUPPORTED لـOAuth بصراحة، لا فشلاً صامتاً.
 */
const OAUTH_FOUNDATION: PlatformId[] = ['tiktok', 'youtube', 'facebook', 'instagram', 'x', 'snapchat', 'threads', 'google_business'];

function levelFromCapability(platform: PlatformId, capability: string): ReadinessLevel {
  return platformSupports(platform, capability) ? 'READY' : 'NOT_SUPPORTED';
}

/** يبني صف جاهزية واحداً من السجل الحقيقي (بلا أي حالة اتصال). */
function rowFor(spec: (typeof PLATFORM_SPECS)[number]): PlatformReadiness {
  const platform = spec.platform;
  const realConnector = spec.realConnector;
  const webhook = WEBHOOK_SUPPORT[platform];
  const oauth: ReadinessLevel = OAUTH_FOUNDATION.includes(platform)
    ? 'EXTERNAL_SETUP_REQUIRED'
    : 'NOT_SUPPORTED';
  // المنصة ذات الموصل الحقيقي (Telegram) بلغت الاتصال/التحقق/الإرسال فعلاً.
  const connector: ReadinessLevel = realConnector ? 'READY' : 'EXTERNAL_SETUP_REQUIRED';
  const connection: ReadinessLevel = realConnector ? 'READY' : 'EXTERNAL_SETUP_REQUIRED';
  const verification: ReadinessLevel = realConnector ? 'READY' : 'EXTERNAL_SETUP_REQUIRED';
  const read = levelFromCapability(platform, 'comments') !== 'NOT_SUPPORTED' || platformSupports(platform, 'messages')
    ? (realConnector ? 'READY' : 'EXTERNAL_SETUP_REQUIRED')
    : 'NOT_SUPPORTED';
  // الرد يشمل التعليقات العامة (comment_reply) أو الرسائل المباشرة (message_reply)؛
  // كلاهما قدرة رد مستقلة عن الأخرى.
  const replySupported = platformSupports(platform, 'comment_reply') || platformSupports(platform, 'message_reply');
  const reply: ReadinessLevel = replySupported ? (realConnector ? 'READY' : 'EXTERNAL_SETUP_REQUIRED') : 'NOT_SUPPORTED';
  const publishSupported = platformSupports(platform, 'publish');
  const publish: ReadinessLevel = publishSupported ? (realConnector ? 'READY' : 'EXTERNAL_SETUP_REQUIRED') : 'NOT_SUPPORTED';
  const schedule = levelFromCapability(platform, 'scheduling');
  const analytics = levelFromCapability(platform, 'analytics');

  const implementationStatus: ImplementationStatus = realConnector
    ? 'CONNECTOR_READY'
    : 'FOUNDATION_READY';

  const needExternal = Object.values({ connector, connection, verification, webhook: webhook.level, read, reply, publish })
    .some((v) => v === 'EXTERNAL_SETUP_REQUIRED');

  const note = realConnector
    ? 'موصل حقيقي منفّذ. يبقى الإرسال مقيداً بشرط الاتصال الموثق من المزود.'
    : needExternal
      ? 'البنية (قدرات + OAuth + طبقة الرد/النشر) جاهزة؛ إتمام الاتصال يحتاج إجراءً خارجياً من المزود.'
      : 'لا قدرات متاحة عبر الواجهة الرسمية.';

  return {
    platform,
    displayName: spec.displayName,
    connector,
    credentialMode: spec.credentialMode,
    oauth,
    connection,
    verification,
    webhook: webhook.level,
    read,
    reply,
    publish,
    schedule,
    analytics,
    externalSetup: EXTERNAL_SETUP[platform],
    implementationStatus,
    note,
  };
}

/** المصفوفة الكاملة للمنصات العشر، مشتقة من السجل الحقيقي. */
export const PLATFORM_READINESS: readonly PlatformReadiness[] = PLATFORM_SPECS.map(rowFor);

export function readinessFor(platform: string): PlatformReadiness | null {
  return PLATFORM_READINESS.find((r) => r.platform === platform) || null;
}

/** ملخص عددي للجاهزية — لا يحمل أي حالة اتصال. */
export function readinessSummary() {
  return {
    total: PLATFORM_READINESS.length,
    connectorReady: PLATFORM_READINESS.filter((r) => r.implementationStatus === 'CONNECTOR_READY').length,
    foundationReady: PLATFORM_READINESS.filter((r) => r.implementationStatus === 'FOUNDATION_READY').length,
    needExternalSetup: PLATFORM_READINESS.filter((r) => r.connector === 'EXTERNAL_SETUP_REQUIRED').length,
  };
}
