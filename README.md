# الغرابي AI

مساعد ذكي مركزي متعدد المنصات لمعرض الغرابي للتقسيط.

## الحالة
- الإصدار: 1.9.0
- لا توجد حسابات اجتماعية متصلة افتراضيًا.
- لا توجد منتجات أو محادثات أو منشورات تجريبية.
- Gemini محمي بحد محلي منخفض، مع cache وin-flight deduplication وfallback محلي.
- التخطيط والأوركسترايشن والمهام الإدارية يمكن تنفيذها دون Gemini.

## المنصات
TikTok، YouTube، Facebook، Instagram، WhatsApp Business، Telegram، X، Snapchat، Threads، Google Business Profile.

## البنية الجديدة
- Control Plane مركزي للقدرات والمهام.
- طابور مهام آمن ينتظر الموافقة والاتصال الخارجي قبل التنفيذ.
- حفظ خادمي للبيانات الإدارية وسجل التدقيق والمهام (عند توفر تخزين قابل للكتابة).
- جلسات المصادقة لا تُحفظ داخل ملف الحالة.

## التشغيل
`npm install`
`npm run dev`

لا تضع مفاتيح حقيقية داخل المستودع. استخدم متغيرات البيئة/Secrets.


## v2.1 — دفعة تشغيلية كبيرة
- Central platform registry with real connection state.
- Connection intent / disconnect APIs with no fake OAuth success.
- Deterministic installment quote API (IQD rounding).
- Campaign draft pipeline foundation.
- Publish preflight guard requiring content, approval, capability and real connection.
- Client API methods for the new control-plane functions.
- No Gemini calls are made by these deterministic endpoints.


## الإصدار 3.2.0 — دفعة تشغيلية كبيرة
- تحسين حماية تحدي المالك ضد المحاولات المتكررة.
- منع تسجيل أسرار التحقق في السجل.
- إضافة idempotency لمهام مركز التحكم.
- إضافة إعادة محاولة آمنة للمهام الفاشلة.
- إضافة readiness endpoint مستقل عن Gemini.
- إضافة واجهات Frontend لحالة مركز التحكم وقدرات المنصات.
- تنظيف دوري للذاكرة المؤقتة والجلسات.
- لا توجد بيانات تجريبية أو عدادات 125/125.


## v3.2 operational batch
- Safe server-side job preflight runs every minute without external publishing.
- Approved jobs become `ready` only after real connection, capability, content, approval, and schedule checks pass.
- Owner audit feed and backup inventory endpoints are available.
- Manual preflight is available for the owner and never publishes externally.


## v4.0.0 — Operations Core
- Durable CRM leads and follow-up queue.
- Internal task center with assignees, priorities and due dates.
- Server-backed scheduling view.
- Strict content review/approval/scheduling transitions.
- Verified external analytics ingestion only; no fabricated metrics.
- All new modules are deterministic and do not consume Gemini quota.


## v5.0
- Central sales and installment ledger with durable payments, balances, status transitions, finance overview, and audit trail.
- Financial module is deterministic and does not consume Gemini quota.


## v8.0 business suite
- Suppliers, purchasing, expenses, contracts and installment schedules are server-backed.
- Deterministic only; Gemini is not required for these operations.

## v10.0 Finalization Layer
- Unified notifications and read-state APIs.
- Owner-only audit querying/export.
- Provider capability contract with explicit real-provider gating.
- HMAC-verified inbound webhook intake with replay/idempotency protection.
- Final readiness endpoint for owner verification before production launch.
- No fake external connection, publishing, analytics, or messaging state.

## التشغيل الحقيقي للمنصات — v11

- لا تعتبر أي منصة متصلة إلا بعد تحقق مزودها فعلياً.
- أسرار OAuth وTelegram تحفظ مشفرة على الخادم باستخدام `PLATFORM_TOKEN_ENCRYPTION_KEY` ولا ترسل للواجهة.
- تم تجهيز OAuth فعلي لـ YouTube وGoogle Business Profile وTikTok.
- تم تجهيز تحقق وربط Telegram Bot فعلياً، مع تنفيذ نشر نصي حقيقي عبر Bot API عند وجود `TELEGRAM_DEFAULT_CHAT_ID`.
- بقية المنصات تبقى في وضع `adapter-ready-credentials-required` إلى أن تضاف بيانات تطبيق المزود وعمليات API الخاصة به؛ لا يوجد أي ادعاء بالنشر الوهمي.
- قبل التشغيل يجب تسجيل redirect URIs الفعلية لدى المزودين واستخدام HTTPS.

## Finalization
This release is the finalization baseline: it prioritizes end-to-end verification, production-readiness clarity, real provider receipts, and safe deployment. Provider credentials are never fabricated.
