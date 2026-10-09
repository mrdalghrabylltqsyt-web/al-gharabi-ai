# الأمان والحوكمة والاعتماديات الخارجية (SECURITY & EXTERNAL DEPENDENCIES)

> مرجع الحالات: [`STATUS_LEGEND.md`](./STATUS_LEGEND.md). **لا تحتوي هذه الوثيقة أي سرّ
> أو رمز وصول أو محتوى عملاء** — فقط أسماء متغيّرات وأسماء ملفات.

## 1) المصادقة والجلسات

| البند | الآلية | الملف | الحالة |
|---|---|---|---|
| جلسة المالك | توكن موقّع HMAC-SHA256 **بلا حالة** (`{uid,iat,exp,sid}`؛ الدور من قاعدة البيانات) | `engine/auth/sessions.ts` | 🟢 CODE+TEST+PRODUCTION |
| رمز التحقق OTP | بنمط TOTP (6 أرقام، نافذة 10 د) بلا ذاكرة مشتركة | `engine/auth/challenge.ts` | 🟢 CODE+TEST |
| إبطال الجلسات | `revokedSessions` + `userRevocations` محفوظة عبر المخزن | `server.ts` | 🟢 CODE+TEST |
| دخول المعاينة (اختياري) | POST فقط، توكن في الجسم، 404 بلا ضبط، مقارنة بزمن ثابت | `server.ts` | 🟢 CODE+TEST |
| إرسال OTP بالبريد | Resend (`RESEND_API_KEY`/`RESEND_FROM_EMAIL`)؛ لا يُسجَّل الرمز | `server.ts` | 🟢 CODE+TEST |

## 2) الصلاحيات

- `authenticateToken` على مسارات `/api/*`؛ `requireOwner` للأفعال الحسّاسة.
- `engine/agent/permissions.ts`: 5 مستويات (READ/WRITE/EXECUTE/EXTERNAL_ACTION/SENSITIVE)
  × (staff/owner/system). **staff قراءة+EXECUTE فقط؛ الكتابة/الحساس/الخارجي للمالك.**

## 3) إدارة الأسرار والرموز

- كل الأسرار على الخادم فقط: `GEMINI_API_KEY`, `SESSION_SECRET`,
  `PLATFORM_TOKEN_ENCRYPTION_KEY`, `*_OAUTH_CLIENT_SECRET`, `*_APP_SECRET`, `*_VERIFY_TOKEN`,
  `TELEGRAM_BOT_TOKEN/WEBHOOK_SECRET`, `DR_*`, `DRIVE_OAUTH_*`, `RECOVERY_CENTER_OWNER_TOKEN`.
- توكنات المنصات تُحفظ **مشفّرة AES-256-GCM** داخل `providerTokens.*` في الحالة.
- مفتاح التوكنات: `engine/social/tokenKey.ts` (64 hex أو Base64 لـ32 بايت — يفرّق missing عن invalid).
- لا تُسجَّل الرموز/OTP/المفاتيح في logs؛ السجلات تحمل أحداثاً أوصافية فقط.

## 4) ملكية الحسابات وحماية المسارات العامة

- `connected`/`verified` تتطلّب `providerVerified === true` من استجابة مزود فعلية.
- webhooks: تحقق HMAC على **الجسم الخام** (`req.rawBody`) — Facebook/Instagram/TikTok/Telegram.
- **`/api/health` و`/api/readiness` عامّان (للمراقبة) لكن منقّيان:**
  - `engine/social/healthPrivacy.ts`: قائمة حقول محظورة (`replyText`, `attentionRequired`,
    نصوص/أسماء عملاء) + `sanitizePublicHealthPayload` + حارس فحص (`final-audit`).
  - تحقق حي 2026-10-09: الاستجابة العامة **خالية** من `replyText`/`attentionRequired` (`PRODUCTION`).
- مسارات `/api` غير المعروفة ترد JSON 404/405 صريحاً (لا HTML 200).

## 5) اعتماد المحتوى والردود

- `engine/social/contentSafety.ts`: يرفض أي نص يحمل عرضاً/سعراً/رابطاً غير مسجّل (422).
- حالات حساسة/سبام => مراجعة بشرية إلزامية (`escalation.ts`).

## 6) سجلات التدقيق

- `audit(...)` عمليات مثل: `youtube_delegation_granted/_revoked`, `digital_sales_consent_updated`
  (تاريخي — الوحدة الرقمية حُذفت لاحقاً), مصادقة/خروج/استهلاك OTP.

## 7) حدود الاستخدام ومراقبة AI

- `engine/ai/firewall.ts`: حارس حصة محلي (افتراضي 4/يوم، أقصى 6)، `GEMINI_FREE_TIER_PROTECTION`،
  قصّ prompt (24k)، سقف مخرجات (2048)، كاش، in-flight dedup، قاطع دائرة.
- `/api/ai/firewall` (owner): نطاق مشروع واحد `project-wide` — لا حصة لكل منصة.
- العمليات الحتمية لا تستهلك AI (تصنيف/حساب/فحص/هيكل/حالة).

## 8) مواضع الخطر والاعتماديات غير المكتملة

| الموضع | الحالة | الملاحظة |
|---|---|---|
| Gemini providerReady | 🔴 | يحتاج تحقق حي بمفتاح صالح (بيئة/حصة Google) |
| Meta Config ID/Redirect/Use Case | 🟠 | `EXTERNAL` — لوحة Meta |
| TikTok client_key/سandbox | 🟠 | `EXTERNAL` |
| Drive DR اعتماد | 🟠 | `EXTERNAL` — مفاتيح Drive |
| صحة عامة | 🟢 | منقّاة + محميّة بحارس مصدر-واحد |
| حذف متغيّر بيئة حساس بالخطأ | 🟠 | يفشل بتدهور آمن (يحجب الكتابة) لا بكشف |

## 9) ممنوع في هذه الوثيقة

لا أسرار، لا رموز، لا محتوى عملاء — فقط أسماء/حالات/مسارات.
