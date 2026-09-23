/**
 * فحص إعدادات الاعتماد لكل منصة — بلا كشف أي قيمة سرّية.
 *
 * سبب الوجود: يجب أن يعرف المالك بدقة «ما المضبوط وما الناقص» لتشغيل منصة،
 * دون أن يقترب أي سرّ من الواجهة أو الردود أو السجلات. هنا تُعلن أسماء متغيرات
 * البيئة المطلوبة لكل غرض (اتصال/webhook/نشر)، ويُفحص وجودها فقط.
 *
 * لا يُعاد أي قيمة؛ فقط:
 * - configured: المطلوب موجود.
 * - missing: أسماء المتغيرات الناقصة (أسماء لا قيم).
 * - مشتق لكل غرض على حدة حتى يُعلن بدقة أي جزء ناقص.
 */

import type { PlatformId } from './adapter';

/** متطلبات الاعتماد لكل منصة، مقسّمة حسب الغرض. */
export interface CredentialSpec {
  /** بيانات إتمام الاتصال (OAuth client أو رمز بوت). */
  connection: string[];
  /** بيانات التحقق من توقيع/اشتراك webhook. */
  webhook: string[];
  /** بيانات إضافية للنشر/الهدف إن لزمت (اختيارية غالباً). */
  publish?: string[];
  /** بدائل مقبولة: أي مجموعة منها تكفي (مثل Instagram يرث بيانات Facebook). */
  alternatives?: string[][];
}

/** إعدادات عامة يحتاجها أي مزود OAuth لإتمام الربط. */
export const GLOBAL_CREDENTIALS = {
  connection: ['APP_URL', 'PLATFORM_TOKEN_ENCRYPTION_KEY'],
} as const;

export const CREDENTIAL_SPECS: Record<PlatformId, CredentialSpec> = {
  telegram: {
    connection: ['TELEGRAM_BOT_TOKEN'],
    webhook: ['TELEGRAM_WEBHOOK_SECRET'],
    publish: ['TELEGRAM_DEFAULT_CHAT_ID'],
  },
  youtube: {
    connection: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    webhook: [],
  },
  google_business: {
    connection: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    webhook: [],
  },
  tiktok: {
    connection: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
    webhook: [],
  },
  facebook: {
    connection: ['FACEBOOK_OAUTH_CLIENT_ID', 'FACEBOOK_OAUTH_CLIENT_SECRET'],
    webhook: ['FACEBOOK_APP_SECRET', 'FACEBOOK_VERIFY_TOKEN'],
  },
  instagram: {
    connection: ['INSTAGRAM_OAUTH_CLIENT_ID', 'INSTAGRAM_OAUTH_CLIENT_SECRET'],
    webhook: ['INSTAGRAM_APP_SECRET', 'INSTAGRAM_VERIFY_TOKEN'],
    alternatives: [['INSTAGRAM_OAUTH_CLIENT_ID', 'FACEBOOK_OAUTH_CLIENT_ID'], ['INSTAGRAM_OAUTH_CLIENT_SECRET', 'FACEBOOK_OAUTH_CLIENT_SECRET'], ['INSTAGRAM_APP_SECRET', 'FACEBOOK_APP_SECRET'], ['INSTAGRAM_VERIFY_TOKEN', 'FACEBOOK_VERIFY_TOKEN']],
  },
  x: {
    connection: ['X_OAUTH_CLIENT_ID', 'X_OAUTH_CLIENT_SECRET'],
    webhook: [],
  },
  snapchat: {
    connection: ['SNAPCHAT_OAUTH_CLIENT_ID', 'SNAPCHAT_OAUTH_CLIENT_SECRET'],
    webhook: [],
  },
  threads: {
    connection: ['THREADS_OAUTH_CLIENT_ID', 'THREADS_OAUTH_CLIENT_SECRET'],
    webhook: ['THREADS_APP_SECRET', 'THREADS_VERIFY_TOKEN'],
  },
  whatsapp: {
    connection: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
    webhook: ['WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'],
  },
};

/** حالة إعداد الاعتماد لغرض واحد. */
export interface CredentialStatus {
  configured: boolean;
  /** أسماء المتغيرات الناقصة فقط (لا قيم). */
  missing: string[];
  /** الأدوار المطلوبة (أسماء متغيرات) — للعرض التشخيصي. */
  required: string[];
}

/** فحص وجود متغير بيئة فعلاً (قيمة غير فارغة) بلا إرجاع القيمة. */
function present(env: Record<string, string | undefined>, key: string): boolean {
  return typeof env[key] === 'string' && String(env[key]).trim().length > 0;
}

/**
 * يفحص متطلباً واحداً مع احترام البدائل: متغير يُعدّ مضبوطاً إن وُجد هو أو بديله.
 * هذا يسمح لـInstagram بالاعتماد على بيانات Facebook عند غياب بيانات خاصة.
 */
function checkNames(env: Record<string, string | undefined>, names: string[], alternatives?: string[][]): { missing: string[]; satisifiedBy: Record<string, boolean> } {
  const missing: string[] = [];
  const satisifiedBy: Record<string, boolean> = {};
  for (const name of names) {
    if (present(env, name)) { satisifiedBy[name] = true; continue; }
    const alt = alternatives?.find((group) => group.includes(name));
    const usedAlt = alt?.some((k) => k !== name && present(env, k));
    if (usedAlt) { satisifiedBy[name] = true; continue; }
    missing.push(name);
  }
  return { missing, satisifiedBy };
}

/** يفحص إعداد الاعتماد لمنصة لغرض معيّن. */
export function inspectCredentialPurpose(platform: PlatformId, purpose: 'connection' | 'webhook' | 'publish', env: Record<string, string | undefined> = process.env): CredentialStatus {
  const spec = CREDENTIAL_SPECS[platform];
  const names = (purpose === 'connection' ? [...GLOBAL_CREDENTIALS.connection, ...(spec?.connection || [])]
    : purpose === 'webhook' ? (spec?.webhook || [])
      : (spec?.publish || []));
  if (!names.length) return { configured: true, missing: [], required: [] };
  // ATTENTION: publish may be optional by design for some platforms — handled by caller.
  const { missing } = checkNames(env, names, spec?.alternatives);
  return { configured: missing.length === 0, missing, required: names };
}

export interface PlatformCredentialReport {
  platform: PlatformId;
  connection: CredentialStatus;
  webhook: CredentialStatus;
  publish: CredentialStatus;
  /** أسماء المتغيرات المطلوبة فعلاً لهذه المنصة (بلا قيم) — للتوثيق. */
  requiredEnvNames: string[];
}

/** تقرير اعتماد كامل لمنصة (اتصال + webhook + نشر) بلا أي قيمة سرّية. */
export function inspectPlatformCredentials(platform: PlatformId, env: Record<string, string | undefined> = process.env): PlatformCredentialReport {
  const spec = CREDENTIAL_SPECS[platform];
  const connection = inspectCredentialPurpose(platform, 'connection', env);
  const webhook = inspectCredentialPurpose(platform, 'webhook', env);
  const publish = inspectCredentialPurpose(platform, 'publish', env);
  const names = new Set<string>([...GLOBAL_CREDENTIALS.connection, ...(spec?.connection || []), ...(spec?.webhook || []), ...(spec?.publish || [])]);
  return { platform, connection, webhook, publish, requiredEnvNames: [...names] };
}

/** هل يلزم اعتماد خارجي (إعداد ناقص) لتفعيل هذه المنصة؟ */
export function needsExternalCredentials(platform: PlatformId, env: Record<string, string | undefined> = process.env): boolean {
  return !inspectPlatformCredentials(platform, env).connection.configured;
}
