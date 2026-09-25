/**
 * سجل موصلات المنصات العشر.
 *
 * القدرات المعلنة هنا تعكس ما تسمح به واجهات كل منصة رسمياً. المنصة التي لا
 * توفر واجهة للتعليقات مثلاً لا تُعلن قدرة "comments"، فتظهر الواجهة بوضوح
 * أنها غير متاحة بدل إظهار أرقام مُختلقة.
 *
 * حالة الاتصال تأتي دائماً من حالة الخادم المحفوظة، وليست ادعاءً من الموصل.
 */

import {
  BasePlatformAdapter,
  type ConnectionStatus,
  type PlatformAccountState,
  type PlatformAdapter,
  type PlatformCapability,
  type PlatformId,
} from './adapter';

interface AdapterSpec {
  platform: PlatformId;
  /** الاسم التقني كما يظهر في مسارات API (مثل Google Business Profile). */
  name: string;
  /** الاسم المعروض في الواجهة العربية/الإنجليزية. */
  displayName: string;
  capabilities: PlatformCapability[];
  /**
   * آلية الاعتماد الرسمية لإتمام اتصال حقيقي:
   * - bot-token: يكفي رمز/توكن من المالك بلا تسجيل تطبيق (قابل للاتصال الآن).
   * - oauth2: يحتاج تسجيل تطبيق ومفتاح عميل وموافقة مراجعة من المزود.
   * - app-registration: يحتاج تطبيقاً معتمداً ومراجعة صلاحيات قبل أي اتصال.
   */
  credentialMode: 'bot-token' | 'oauth2' | 'app-registration';
  /**
   * هل يوجد موصل إرسال/استقبال حقيقي منفّذ في الكود لهذه المنصة الآن؟
   * false تعني أن المنصة معرّفة بقدراتها لكن لا موصل فعلي بعد — فلا يُوهم باكتمال.
   */
  realConnector: boolean;
}

/**
 * مصدر الحقيقة الوحيد للقدرات. ملاحظات مهمة موثقة لكل منصة:
 * - WhatsApp Business: واجهة الرسائل فقط؛ لا نشر منشورات عامة ولا تعليقات.
 * - Telegram: قناة/بوت للرسائل والنشر النصي؛ لا تعليقات عبر API البوت.
 * - Snapchat: واجهة الإعلانات/التحويلات محدودة؛ لا قراءة تعليقات عامة.
 * - X: قراءة التعليقات (replies) والرد عليها متاحة عبر API المدفوع.
 * - Facebook/Instagram: التعليقات والردود متاحة عبر Graph API مع صلاحيات.
 * - YouTube: التعليقات والردود متاحة عبر Data API.
 * - TikTok: التعليقات متاحة عبر Display API، والرد عبر واجهة الإدارة.
 * - Threads: نشر وردود عبر Threads API.
 * - Google Business Profile: تحديثات محلية؛ التعليقات غير متاحة عبر API.
 */
const ADAPTER_SPECS: AdapterSpec[] = [
  {
    platform: 'tiktok',
    name: 'TikTok',
    displayName: 'TikTok',
    capabilities: ['publish', 'analytics', 'comments', 'comment_reply', 'scheduling'],
    credentialMode: 'oauth2',
    realConnector: false,
  },
  {
    platform: 'youtube',
    name: 'YouTube',
    displayName: 'YouTube',
    capabilities: ['publish', 'analytics', 'comments', 'comment_reply', 'scheduling', 'audience_insights'],
    credentialMode: 'oauth2',
    realConnector: false,
  },
  {
    platform: 'facebook',
    name: 'Facebook',
    displayName: 'Facebook',
    // الصفحات فقط (Page Access Token): نشر منشور، رسائل Messenger والرد عليها،
    // تعليقات الصفحة والرد عليها. لا نعلن audience_insights (لم يُنفَّذ جلبها).
    capabilities: ['publish', 'messages', 'message_reply', 'analytics', 'comments', 'comment_reply', 'scheduling'],
    credentialMode: 'oauth2',
    // ثاني موصل حقيقي منفّذ: OAuth + رمز صفحة + webhook + رد + رسالة + نشر.
    realConnector: true,
  },
  {
    platform: 'instagram',
    name: 'Instagram',
    displayName: 'Instagram',
    // Instagram API with Facebook Login: حساب Instagram للأعمال المرتبط بصفحة
    // Facebook. التعليقات/الردود والرسائل المباشرة والنشر والتحليلات كلها عبر
    // graph.facebook.com برمز الصفحة، فالقدرات مطابقة لِما يسمح به المسار فعلاً.
    capabilities: ['publish', 'messages', 'message_reply', 'analytics', 'comments', 'comment_reply', 'scheduling', 'audience_insights'],
    // نفس آلية Facebook (OAuth تطبيق Meta + رمز صفحة) — لا حساب شخصي.
    credentialMode: 'oauth2',
    // ثالث موصل حقيقي منفّذ: OAuth + رمز صفحة + اكتشاف حساب IG + webhook + رد + رسالة + نشر.
    realConnector: true,
  },
  {
    platform: 'whatsapp',
    name: 'WhatsApp Business',
    displayName: 'WhatsApp Business',
    // واتساب للأعمال لا يوفر نشر منشورات عامة ولا تعليقات؛ الرسائل والرد عليها فقط.
    capabilities: ['messages', 'message_reply'],
    credentialMode: 'app-registration',
    realConnector: false,
  },
  {
    platform: 'telegram',
    name: 'Telegram',
    displayName: 'Telegram',
    // البوت ينشر في القناة ويرسل/يستقبل رسائل ويرد عليها؛ لا واجهة لقراءة
    // التعليقات العامة ولذلك لا تُعلن comment_reply إطلاقاً.
    capabilities: ['publish', 'messages', 'message_reply', 'scheduling'],
    // أول موصل حقيقي: يكفي رمز بوت من المالك، والموصل منفّذ فعلاً في الكود.
    credentialMode: 'bot-token',
    realConnector: true,
  },
  {
    platform: 'x',
    name: 'X',
    displayName: 'X',
    capabilities: ['publish', 'analytics', 'comments', 'comment_reply', 'scheduling'],
    credentialMode: 'oauth2',
    realConnector: false,
  },
  {
    platform: 'snapchat',
    name: 'Snapchat',
    displayName: 'Snapchat',
    // لا تتوفر قراءة تعليقات عامة عبر الواجهة الرسمية.
    capabilities: ['publish', 'analytics', 'scheduling'],
    credentialMode: 'oauth2',
    realConnector: false,
  },
  {
    platform: 'threads',
    name: 'Threads',
    displayName: 'Threads',
    capabilities: ['publish', 'analytics', 'comments', 'comment_reply', 'scheduling'],
    credentialMode: 'oauth2',
    realConnector: false,
  },
  {
    platform: 'google_business',
    name: 'Google Business Profile',
    displayName: 'Google Business Profile',
    // التحديثات المحلية متاحة؛ التعليقات غير متاحة عبر الواجهة الرسمية.
    capabilities: ['publish', 'analytics', 'scheduling'],
    credentialMode: 'oauth2',
    realConnector: false,
  },
];

class GenericAdapter extends BasePlatformAdapter {
  constructor(
    readonly platform: PlatformId,
    readonly displayName: string,
    readonly capabilities: readonly PlatformCapability[],
    connection: PlatformAccountState,
    readonly credentialMode: 'bot-token' | 'oauth2' | 'app-registration',
    readonly realConnector: boolean,
  ) {
    super(connection);
  }

  /**
   * جاهزية الإنتاج تنطبق فقط على منصة لها موصل إرسال حقيقي منفّذ AND اتصال
   * موثق. المنصة بلا موصل فعلي تبقى productionReady=false حتى لو اتصلت، فلا
   * يُوهم المالك بقدرة إرسال غير منفّذة.
   */
  override describe() {
    const base = super.describe();
    const connected = this.connection.status === 'connected' && this.connection.providerVerified === true;
    return {
      ...base,
      credentialMode: this.credentialMode,
      realConnector: this.realConnector,
      productionReady: this.realConnector && connected,
      readinessNote: !this.realConnector
        ? 'لا يوجد موصل إرسال/استقبال حقيقي منفّذ لهذه المنصة بعد؛ تحتاج اعتماد تطبيق من المزود قبل أي عملية خارجية.'
        : connected
          ? 'الحساب متصل ومتحقق منه لدى المزود، والموصل الحقيقي جاهز لتنفيذ الإرسال/الاستقبال.'
          : 'الحساب غير متصل. لا تُنفَّذ أي عملية خارجية قبل إتمام الاعتماد والتحقق من المزود.',
    };
  }
}

const disconnectedState = (platform: PlatformId): PlatformAccountState => ({ platform, status: 'disconnected' });

/** ينشئ موصلاً لكل منصة مع حالة اتصالها الحقيقية. */
export function buildAdapters(
  connectionFor: (platform: PlatformId) => { status: ConnectionStatus; accountId?: string; accountName?: string; connectedAt?: string; providerVerified?: boolean } | null,
): PlatformAdapter[] {
  return ADAPTER_SPECS.map((spec) => {
    const conn = connectionFor(spec.platform);
    const state: PlatformAccountState = conn
      ? { platform: spec.platform, status: conn.status, accountId: conn.accountId, accountName: conn.accountName, connectedAt: conn.connectedAt, providerVerified: conn.providerVerified }
      : disconnectedState(spec.platform);
    return new GenericAdapter(spec.platform, spec.displayName, spec.capabilities, state, spec.credentialMode, spec.realConnector);
  });
}

/**
 * تعريف المنصات المرجعي بلا أي حالة اتصال (للواجهات ومسارات القدرات).
 * هذا هو المصدر الوحيد الذي تقرأ منه بقية الوحدات قائمة المنصات وقدراتها،
 * فلا تنحرف قائمة في server.ts عن سجل الموصلات.
 */
export const PLATFORM_SPECS: ReadonlyArray<{
  platform: PlatformId;
  name: string;
  displayName: string;
  capabilities: readonly PlatformCapability[];
  credentialMode: 'bot-token' | 'oauth2' | 'app-registration';
  realConnector: boolean;
}> = ADAPTER_SPECS.map((s) => ({
  platform: s.platform,
  name: s.name,
  displayName: s.displayName,
  capabilities: s.capabilities,
  credentialMode: s.credentialMode,
  realConnector: s.realConnector,
}));

/** هل يوجد موصل إرسال/استقبال حقيقي منفّذ فعلاً لهذه المنصة؟ */
export function hasRealConnector(platform: string): boolean {
  return ADAPTER_SPECS.some((s) => s.platform === platform && s.realConnector);
}

/** آلية الاعتماد الرسمية المطلوبة لإتمام اتصال حقيقي لهذه المنصة. */
export function credentialModeOf(platform: string): 'bot-token' | 'oauth2' | 'app-registration' | null {
  const spec = ADAPTER_SPECS.find((s) => s.platform === platform);
  return spec ? spec.credentialMode : null;
}

export function isSupportedPlatform(id: string): id is PlatformId {
  return ADAPTER_SPECS.some((s) => s.platform === id);
}

/** هل تدعم المنصة هذه القدرة كما تعرّفها واجهتها الرسمية؟ */
export function platformSupports(platform: string, capability: string): boolean {
  return ADAPTER_SPECS.some(
    (s) => s.platform === platform && (s.capabilities as readonly string[]).includes(capability),
  );
}
