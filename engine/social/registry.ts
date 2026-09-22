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
  },
  {
    platform: 'youtube',
    name: 'YouTube',
    displayName: 'YouTube',
    capabilities: ['publish', 'analytics', 'comments', 'comment_reply', 'scheduling', 'audience_insights'],
  },
  {
    platform: 'facebook',
    name: 'Facebook',
    displayName: 'Facebook',
    capabilities: ['publish', 'messages', 'analytics', 'comments', 'comment_reply', 'scheduling', 'audience_insights'],
  },
  {
    platform: 'instagram',
    name: 'Instagram',
    displayName: 'Instagram',
    capabilities: ['publish', 'messages', 'analytics', 'comments', 'comment_reply', 'scheduling', 'audience_insights'],
  },
  {
    platform: 'whatsapp',
    name: 'WhatsApp Business',
    displayName: 'WhatsApp Business',
    // واتساب للأعمال لا يوفر نشر منشورات عامة ولا تعليقات؛ الرسائل فقط.
    capabilities: ['messages'],
  },
  {
    platform: 'telegram',
    name: 'Telegram',
    displayName: 'Telegram',
    // البوت ينشر في القناة ويرسل رسائل؛ لا واجهة لقراءة التعليقات العامة.
    capabilities: ['publish', 'messages', 'scheduling'],
  },
  {
    platform: 'x',
    name: 'X',
    displayName: 'X',
    capabilities: ['publish', 'analytics', 'comments', 'comment_reply', 'scheduling'],
  },
  {
    platform: 'snapchat',
    name: 'Snapchat',
    displayName: 'Snapchat',
    // لا تتوفر قراءة تعليقات عامة عبر الواجهة الرسمية.
    capabilities: ['publish', 'analytics', 'scheduling'],
  },
  {
    platform: 'threads',
    name: 'Threads',
    displayName: 'Threads',
    capabilities: ['publish', 'analytics', 'comments', 'comment_reply', 'scheduling'],
  },
  {
    platform: 'google_business',
    name: 'Google Business Profile',
    displayName: 'Google Business Profile',
    // التحديثات المحلية متاحة؛ التعليقات غير متاحة عبر الواجهة الرسمية.
    capabilities: ['publish', 'analytics', 'scheduling'],
  },
];

class GenericAdapter extends BasePlatformAdapter {
  constructor(
    readonly platform: PlatformId,
    readonly displayName: string,
    readonly capabilities: readonly PlatformCapability[],
    connection: PlatformAccountState,
  ) {
    super(connection);
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
    return new GenericAdapter(spec.platform, spec.displayName, spec.capabilities, state);
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
}> = ADAPTER_SPECS.map((s) => ({
  platform: s.platform,
  name: s.name,
  displayName: s.displayName,
  capabilities: s.capabilities,
}));

export function isSupportedPlatform(id: string): id is PlatformId {
  return ADAPTER_SPECS.some((s) => s.platform === id);
}

/** هل تدعم المنصة هذه القدرة كما تعرّفها واجهتها الرسمية؟ */
export function platformSupports(platform: string, capability: string): boolean {
  return ADAPTER_SPECS.some(
    (s) => s.platform === platform && (s.capabilities as readonly string[]).includes(capability),
  );
}
