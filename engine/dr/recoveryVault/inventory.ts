/**
 * جرد أسرار الاستعادة (Recovery Secret Inventory) — مصدر واحد schema-based.
 *
 * هذا ليس قائمة "كل متغيّرات البيئة"، بل جرد **معتمد ومُراجَع** لما يلزم فعلاً
 * لإعادة بناء الغرابي بعد كارثة كاملة. لكل سرّ: الخدمة، الغرض، هل هو حرج للاستعادة،
 * المصدر، وهل يُستعاد كقيمة ثابتة أم يُعاد توليده/إصداره.
 *
 * القواعد:
 *  - لا نُدرج أي اسم لم نتحقق من استخدامه فعلياً في الكود.
 *  - لا قيم هنا إطلاقاً؛ الأسماء والتصنيف فقط.
 *  - ما لا يُستعاد كقيمة ثابتة يُوسَم `regenerate`/`reissue` صراحةً فلا ادّعاء استعادة.
 *
 * `recoverability`:
 *   - 'value'        => تُستعاد قيمته الحرفية من الخزنة (حرج للاستعادة).
 *   - 'regenerate'   => يُعاد توليده داخل النظام (لا حاجة لنسخته).
 *   - 'reissue'      => يُعاد إصداره من المزوّد الخارجي (لا يمكن استعادته كقيمة).
 *   - 'optional'     => يُستعاد إن وُجد، وغيابه لا يمنع الإقلاع.
 */

export type VaultRecordSource = 'environment' | 'database' | 'generated' | 'owner-entered';
export type VaultRecoverability = 'value' | 'regenerate' | 'reissue' | 'optional';

export interface SecretInventoryEntry {
  /** اسم متغيّر البيئة كما هو (المفتاح في الخزنة). */
  name: string;
  /** نوع السرّ (مفتاح تشفير/سرّ عميل/رمز/اتصال...). */
  kind:
    | 'encryption-key'
    | 'client-secret'
    | 'app-secret'
    | 'verify-token'
    | 'api-key'
    | 'bot-token'
    | 'webhook-secret'
    | 'connection-string'
    | 'session-secret'
    | 'config-id';
  /** الخدمة/الجهة. */
  service: string;
  /** الغرض بالعربية. */
  purpose: string;
  /** هل هو حرج لإعادة تشغيل النظام أو فكّ النسخ؟ */
  recoveryCritical: boolean;
  source: VaultRecordSource;
  recoverability: VaultRecoverability;
  /** ملاحظة استعادة عند اللزوم (بلا قيمة). */
  note?: string;
}

/**
 * الجرد المعتمد. الترتيب: مفاتيح DR أولاً (الأحرج)، ثم النظام، ثم مزوّدو المنصّات.
 * كل اسم هنا مستخدم فعلاً في الكود (انظر فحوص final-audit).
 */
export const RECOVERY_SECRET_INVENTORY: SecretInventoryEntry[] = [
  // --- مفاتيح منظومة التعافي (حرجة: بلا مفتاح لا فكّ) ---
  { name: 'DR_RECOVERY_MASTER_KEY', kind: 'encryption-key', service: 'DR', purpose: 'فكّ حزمة الأسرار secrets.enc', recoveryCritical: true, source: 'environment', recoverability: 'value', note: 'مفتاح رئيسي — لا يُحفظ داخل النسخة نفسها.' },
  { name: 'DR_RECOVERY_VAULT_KEY', kind: 'encryption-key', service: 'DR', purpose: 'فتح خزنة مفاتيح الطوارئ (هذه)', recoveryCritical: true, source: 'environment', recoverability: 'value', note: 'مفتاح فتح الخزنة — لا يُحفظ داخل Drive أبداً؛ نسخة المالك مستقلة.' },
  { name: 'DRIVE_TOKEN_ENCRYPTION_KEY', kind: 'encryption-key', service: 'Google Drive', purpose: 'تشفير رمز تجديد Drive المخزّن', recoveryCritical: true, source: 'environment', recoverability: 'value' },
  { name: 'DRIVE_DB_BACKUP_KEY', kind: 'encryption-key', service: 'DR', purpose: 'تشفير/فكّ نسخة قاعدة البيانات database.enc', recoveryCritical: true, source: 'environment', recoverability: 'value' },
  // --- اعتماد Google Drive (مصدر نسخ الطوارئ) ---
  { name: 'DRIVE_OAUTH_CLIENT_ID', kind: 'client-secret', service: 'Google Drive', purpose: 'معرّف عميل OAuth لنسخ Drive', recoveryCritical: true, source: 'environment', recoverability: 'value' },
  { name: 'DRIVE_OAUTH_CLIENT_SECRET', kind: 'client-secret', service: 'Google Drive', purpose: 'سرّ عميل OAuth لنسخ Drive', recoveryCritical: true, source: 'environment', recoverability: 'value' },
  // --- النظام الأساسي ---
  { name: 'SESSION_SECRET', kind: 'session-secret', service: 'Auth', purpose: 'توقيع جلسات المستخدمين/المالك', recoveryCritical: true, source: 'environment', recoverability: 'value', note: 'فقدانه يُبطل الجلسات القائمة فقط، لا يمنع الإقلاع.' },
  { name: 'PLATFORM_TOKEN_ENCRYPTION_KEY', kind: 'encryption-key', service: 'Platforms', purpose: 'تشفير توكنات المنصّات المخزّنة (AES-256-GCM)', recoveryCritical: true, source: 'environment', recoverability: 'value', note: 'بدونه لا تُفكّ توكنات المنصّات المشفّرة في القاعدة.' },
  { name: 'DATABASE_URL', kind: 'connection-string', service: 'Postgres/Neon', purpose: 'اتصال قاعدة الحالة (يتغيّر مع مزوّد جديد)', recoveryCritical: true, source: 'environment', recoverability: 'value', note: 'يُستعاد لكن غالباً يُعاد إصداره من مزوّد القاعدة الجديد.' },
  { name: 'OWNER_EMAIL', kind: 'api-key', service: 'Auth', purpose: 'بريد المالك الوحيد (دخول OTP)', recoveryCritical: true, source: 'environment', recoverability: 'value' },
  // --- البريد (OTP) ---
  { name: 'RESEND_API_KEY', kind: 'api-key', service: 'Resend', purpose: 'إرسال رمز OTP بالبريد', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'RESEND_FROM_EMAIL', kind: 'api-key', service: 'Resend', purpose: 'عنوان الإرسال', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  // --- الذكاء الاصطناعي (اختياري للتشغيل: غيابه => بديل حتمي) ---
  { name: 'GEMINI_API_KEY', kind: 'api-key', service: 'Google Gemini', purpose: 'مزوّد الذكاء الاصطناعي', recoveryCritical: false, source: 'environment', recoverability: 'value', note: 'غيابه لا يُسقط النظام (بديل حتمي).' },
  // --- Meta (Facebook/Instagram/Threads/WhatsApp) ---
  { name: 'FACEBOOK_OAUTH_CLIENT_ID', kind: 'client-secret', service: 'Meta', purpose: 'Facebook OAuth', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'FACEBOOK_OAUTH_CLIENT_SECRET', kind: 'client-secret', service: 'Meta', purpose: 'Facebook OAuth', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'FACEBOOK_APP_SECRET', kind: 'app-secret', service: 'Meta', purpose: 'توقيع webhook Facebook', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'FACEBOOK_VERIFY_TOKEN', kind: 'verify-token', service: 'Meta', purpose: 'تحقق اشتراك webhook Facebook', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'FACEBOOK_LOGIN_CONFIG_ID', kind: 'config-id', service: 'Meta', purpose: 'Configuration ID (Facebook Login for Business)', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'INSTAGRAM_OAUTH_CLIENT_ID', kind: 'client-secret', service: 'Meta', purpose: 'Instagram OAuth', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'INSTAGRAM_OAUTH_CLIENT_SECRET', kind: 'client-secret', service: 'Meta', purpose: 'Instagram OAuth', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'INSTAGRAM_APP_SECRET', kind: 'app-secret', service: 'Meta', purpose: 'توقيع webhook Instagram', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'INSTAGRAM_VERIFY_TOKEN', kind: 'verify-token', service: 'Meta', purpose: 'تحقق اشتراك webhook Instagram', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'INSTAGRAM_LOGIN_CONFIG_ID', kind: 'config-id', service: 'Meta', purpose: 'Configuration ID لمسار Instagram', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'THREADS_OAUTH_CLIENT_ID', kind: 'client-secret', service: 'Meta', purpose: 'Threads OAuth', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'THREADS_OAUTH_CLIENT_SECRET', kind: 'client-secret', service: 'Meta', purpose: 'Threads OAuth', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'THREADS_APP_SECRET', kind: 'app-secret', service: 'Meta', purpose: 'توقيع webhook Threads', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'THREADS_VERIFY_TOKEN', kind: 'verify-token', service: 'Meta', purpose: 'تحقق اشتراك webhook Threads', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'WHATSAPP_APP_SECRET', kind: 'app-secret', service: 'Meta', purpose: 'توقيع webhook WhatsApp', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'WHATSAPP_VERIFY_TOKEN', kind: 'verify-token', service: 'Meta', purpose: 'تحقق اشتراك webhook WhatsApp', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  // --- Google (YouTube + Business) ---
  { name: 'GOOGLE_OAUTH_CLIENT_ID', kind: 'client-secret', service: 'Google', purpose: 'OAuth لـYouTube/Google Business', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'GOOGLE_OAUTH_CLIENT_SECRET', kind: 'client-secret', service: 'Google', purpose: 'OAuth لـYouTube/Google Business', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  // --- TikTok ---
  { name: 'TIKTOK_CLIENT_KEY', kind: 'client-secret', service: 'TikTok', purpose: 'Login Kit client key', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'TIKTOK_CLIENT_SECRET', kind: 'client-secret', service: 'TikTok', purpose: 'توقيع webhook + تبادل الرمز', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  // --- Telegram (رمز بوت — يُعاد إصداره من BotFather عند اللزوم) ---
  { name: 'TELEGRAM_BOT_TOKEN', kind: 'bot-token', service: 'Telegram', purpose: 'موصل Telegram', recoveryCritical: false, source: 'environment', recoverability: 'value', note: 'يمكن إعادة إصداره من BotFather إن فُقد.' },
  { name: 'TELEGRAM_WEBHOOK_SECRET', kind: 'webhook-secret', service: 'Telegram', purpose: 'تحقق webhook Telegram', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'TELEGRAM_DEFAULT_CHAT_ID', kind: 'config-id', service: 'Telegram', purpose: 'دردشة افتراضية للمهام المجدولة', recoveryCritical: false, source: 'environment', recoverability: 'optional' },
  // --- X / Snapchat ---
  { name: 'X_OAUTH_CLIENT_ID', kind: 'client-secret', service: 'X', purpose: 'X OAuth', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'X_OAUTH_CLIENT_SECRET', kind: 'client-secret', service: 'X', purpose: 'X OAuth', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'SNAPCHAT_OAUTH_CLIENT_ID', kind: 'client-secret', service: 'Snapchat', purpose: 'Snapchat OAuth', recoveryCritical: false, source: 'environment', recoverability: 'value' },
  { name: 'SNAPCHAT_OAUTH_CLIENT_SECRET', kind: 'client-secret', service: 'Snapchat', purpose: 'Snapchat OAuth', recoveryCritical: false, source: 'environment', recoverability: 'value' },
];

/** خريطة سريعة بالاسم. */
export const INVENTORY_BY_NAME: Map<string, SecretInventoryEntry> = new Map(
  RECOVERY_SECRET_INVENTORY.map((e) => [e.name, e]),
);

/** الأسماء المعتمدة فقط (للتقاطع مع البيئة). */
export function inventoryNames(): string[] {
  return RECOVERY_SECRET_INVENTORY.map((e) => e.name);
}

/** الأسماء الحرجة للاستعادة. */
export function criticalInventoryNames(): string[] {
  return RECOVERY_SECRET_INVENTORY.filter((e) => e.recoveryCritical).map((e) => e.name);
}

/**
 * الأسماء الموجودة فعلاً في البيئة وضمن الجرد المعتمد (بلا قيم).
 * لا نُدرج أي متغيّر غير موجود، ولا أي اسم خارج الجرد.
 */
export function presentInventoryNames(env: Record<string, string | undefined> = {}): string[] {
  return RECOVERY_SECRET_INVENTORY
    .filter((e) => env[e.name] != null && String(env[e.name]).length > 0)
    .map((e) => e.name);
}
