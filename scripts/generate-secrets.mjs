/**
 * مولّد أسرار الإنتاج: يعرض القيم في الطرفية فقط، بلا كتابة أي ملف ولا سجل.
 *
 * السبب: SESSION_SECRET وPLATFORM_TOKEN_ENCRYPTION_KEY وGHARABI_PREVIEW_TOKEN
 * يجب أن تكون قيماً عشوائية قوية، ولا يجوز أن تدخل Git ولا أي ملف حالة.
 *
 * الاستخدام:
 *   node scripts/generate-secrets.mjs
 * ثم انسخ كل قيمة إلى Environment Secrets في منصة النشر، وامسح الطرفية.
 * لا يكتب أي ملف.
 */
import crypto from 'node:crypto';

const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
// 32 بايت base64 => مفتاح AES-256-GCM صالح تماماً (tokenKeyBytes يقبله).
const PLATFORM_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
const GHARABI_PREVIEW_TOKEN = crypto.randomBytes(32).toString('hex');

const line = '─'.repeat(64);
process.stdout.write(
  [
    line,
    'أسرار الإنتاج — انسخها الآن إلى Environment Secrets ثم امسح الطرفية.',
    'لا تُحفظ في ملف ولا تُرسل في محادثة ولا تُكتب في Git.',
    line,
    `SESSION_SECRET=${SESSION_SECRET}`,
    `PLATFORM_TOKEN_ENCRYPTION_KEY=${PLATFORM_TOKEN_ENCRYPTION_KEY}`,
    `GHARABI_PREVIEW_TOKEN=${GHARABI_PREVIEW_TOKEN}`,
    line,
    'ملاحظة: تغيير SESSION_SECRET يُبطل كل الجلسات الحالية.',
    'ملاحظة: تغيير GHARABI_PREVIEW_TOKEN يُبطل جلسات المعاينة الصادرة قبله.',
    'ملاحظة: تغيير PLATFORM_TOKEN_ENCRYPTION_KEY يجعل توكنات المنصات المشفّرة غير قابلة للفك.',
    line,
  ].join('\n') + '\n',
);
