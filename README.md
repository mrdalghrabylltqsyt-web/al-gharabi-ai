# الغرابي AI

مساعد ذكي مركزي متعدد المنصات لمعرض الغرابي للتقسيط.

## الحالة
- الإصدار: 13.0.0
- لا توجد حسابات اجتماعية متصلة افتراضيًا.
- لا توجد منتجات أو محادثات أو منشورات تجريبية.
- مزود الذكاء الاصطناعي يمر عبر محرك مركزي: مزود → حارس → مهلة → إعادة محاولة → تخزين مؤقت → بديل حتمي.
- التخطيط والأوركسترايشن والمهام الإدارية وتصنيف التعليقات تُنفَّذ دون مزود خارجي.

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


## v14.0 — وكيل الغرابي الذكي (أول وظيفة عملية)

أول وظيفة تشغيلية حقيقية داخل المنصة: يستطيع المستخدم اختيار منتج من قاعدة بيانات المعرض أو كتابة اسمه، ثم إعطاء الوكيل مهمة واضحة (مثل "اكتب عرضاً تسويقياً يبرز القسط الشهري")، فيحصل على محتوى تسويقي عربي مخصص لكل منصة بشكل فوري.

### الخصائص
- **حتمي بالكامل:** لا يستدعي Gemini ولا يستهلك أي حصة، ولا يحتاج أي حساب اجتماعي متصل حتى يعمل.
- **مبني على بيانات حقيقية:** يستخدم اسم المعرض، المنتج، المواصفات، خيارات السداد، ورقم التواصل المسجل فقط. لا يختلق أرقاماً أو عناوين أو أسماء.
- **حسبة القسط بالدينار العراقي:** نفس منطق `/api/catalog/quote` تماماً (تقريب لأعلى إلى أقرب دينار عراقي).
- **احترام قيود المنصة:** يقصر النص تلقائياً ليطابق حد كل منصة (X وSnapchat والبقية) دون قطع الكلمات.
- **حماية القواعد:** يرفض المهام التي تحتوي على محتوى سيارات أو عدّاد الاستهلاك القديم، ويعيد فحص الناتج قبل إعادته.
- **حفظ منظم:** يمكن حفظ الناتج كمسودات في `workspace.posts`، فتدخل مباشرة في مسار المراجعة والاعتماد الحالي. وتُسجَّل كل مهمة في `workspace.marketingBriefs` مع سجل التدقيق.
- **لا ادعاء بنشر خارجي:** لا يعتبر أي منصة متصلة ولا يسجل أي منشور كمُنشر دون إيصال مزود فعلي.

### نقاط النهاية
- `POST /api/ai/content-brief` — تنفيذ مهمة المحتوى التسويقي (يتطلب مصادقة).
- `GET /api/ai/content-briefs` — سجل المهام المنفذة (المالك يرى الجميع، وغيره يرى مهامه).

### الواجهة
قسم جديد في الشريط الجانبي باسم **"وكيل الغرابي الذكي"** (`marketing_agent`).


## v15.0 — مسار A: الحملات التسويقية الصغيرة

توسعة طبيعية للوكيل: بدل مهمة واحدة على منتج واحد، يستطيع المستخدم بناء **حملة صغيرة** على عدة منتجات حقيقية دفعة واحدة، مع مسودات تدخل مسار المراجعة والاعتماد القائم.

### الخصائص
- **حتمية بالكامل:** نفس المحرك المحلي المستخدم في المهمة الواحدة (`generateBriefContent`)، بلا استدعاء Gemini وبلا استهلاك حصة.
- **منتجات حقيقية فقط:** كل منتج يُطابق من `workspace.products` بالمعرّف؛ أي معرّف غير موجود يُرفض بـ`404`. الحد الأقصى 10 منتجات و80 مسودة في الحملة.
- **أرقام منفصلة لكل منتج:** تُحسب أرقام التقسيط لكل منتج على حدة فلا تختلط الأسعار بين المنتجات.
- **شروط سداد اختيارية:** إن تُركت حقول الدفعة الأولى والمدة فارغة، يُستخدم لكل منتج ما هو مسجّل فعلاً في قاعدة البيانات.
- **حماية القواعد:** تُفحص المهمة والاسم والملاحظات قبل التوليد، ويُعاد فحص الناتج؛ أي مصطلح سيارات أو عدّاد استهلاك قديم يوقف الطلب بـ`422`.
- **حالة المهمة حية:** حالة كل مهمة داخل الحملة مستمدة مباشرة من حالة المسودة المرتبطة، فلا توجد حالة مكرّرة قد تتضارب.
- **صلاحيات:** المالك يرى كل الحملات، وغيره يرى حملاته فقط؛ والوصول لحملة الغير يُرفض بـ`403`.
- **سجل تدقيق:** `marketing_campaign_created` و`marketing_campaign_status_changed` يُسجَّلان في سجل التدقيق.
- **لا نشر خارجي:** لا تُعتبر أي منصة متصلة، ولا يوجد أي أثر نشر. تعديل حالة الحملة لا ينفّذ نشراً.

### نقاط النهاية
- `POST /api/ai/marketing-campaigns` — إنشاء حملة على عدة منتجات (يتطلب مصادقة).
- `GET /api/ai/marketing-campaigns` — سجل الحملات.
- `GET /api/ai/marketing-campaigns/:id` — تفاصيل الحملة مع المنتجات والمهام والموارد لكل منصة وحالة كل مسودة.
- `PATCH /api/ai/marketing-campaigns/:id` — تحديث حالة الحملة فقط (`draft` / `active` / `completed` / `archived`).

### الواجهة
مفتاح تبديل داخل تبويب "وكيل الغرابي الذكي" بين **"مهمة واحدة"** و**"حملة على عدة منتجات"** (المكوّن `MarketingCampaignPanel`).


## v16.0 — مسار B / المرحلة 3: إدارة الحملة التسويقية

إدارة كاملة للحملة بعد إنشائها: فتح أي حملة، عرض مسوداتها، اتخاذ قرار على مسودة واحدة أو عدة مسودات دفعة واحدة، وربط المسودة المعتمدة بمنشورها في مساحة المنشورات.

### تفاصيل الحملة
- شاشة تفاصيل (`MarketingCampaignDetailView`) تعرض الاسم والوصف (المهمة) والنبرة والملاحظات والحالة، وتواريخ الإنشاء والتحديث، والمنتجات الحقيقية المرتبطة، والمنصات المحددة، وعدد المسودات وتوزيعها، وآخر نشاط، وسجل التغييرات.
- `PATCH /api/ai/marketing-campaigns/:id` يحدّث حالة الحملة ضمن الحالات المدعومة فقط.

### إدارة المسودات
- لكل مسودة: المنصة، النص، المنتج المرتبط، الحالة، تاريخ الإنشاء، والقرار المسجّل.
- الإجراءات المتاحة من الخادم (`DRAFT_ACTION_SPECS`) مع منع الانتقالات غير المنطقية:
  - `review`: إرسال للمراجعة، من `draft` أو `edited`.
  - `approve`: اعتماد، من `review` أو `edited` — للمالك أو المدير العام فقط.
  - `reject`: رفض وإعادة للتعديل، من `review` أو `edited` أو `approved` — للمالك أو المدير العام فقط.
- الانتقال غير المنطقي يُرفض بـ`409` مع رسالة عربية تذكر الحالة الحالية.

### العمليات الجماعية
- `POST /api/ai/marketing-campaigns/:id/drafts/bulk` يطبّق الإجراء نفسه على عدة مسودات.
- تُزال تكرارات المعرّفات، وتُبلَّغ المعرّفات غير الموجودة، ويُعاد لكل مسودة سببٌ عند تجاهلها بدل تجاهلها بصمت.
- الاستجابة تعرض بوضوح: `appliedCount` و`skippedCount` و`appliedTaskIds` وقائمة المتجاهَل مع السبب.

### الربط مع مساحة المنشورات
- `POST /api/ai/marketing-campaigns/:id/drafts/:taskId/link` يربط **المسودة المعتمدة فقط** بمنشورها، ويُرفض أي حالة أخرى بـ`409` حتى لو نُودي عليه مباشرة من الـAPI.
- الربط **خامل التكرار (idempotent):** إعادة النداء تُرجع نفس المنشور دون إنشاء منشور مكرر.
- يُحفظ `campaignId` و`draftId` والمنتج والمنصة داخل `post.campaignLink`.
- الحالات المدعومة فعلاً هي حالات مساحة المنشورات ووسم القرار: `draft` / `review` / `edited` / `approved` / `scheduled` / `published` / `deleted`. لا يُوسم أي منشور كـ"منشور" إلا بوجود نتيجة نشر حقيقية من المزود.
- لا تُنشأ مسودة بلا محتوى حقيقي: إن غاب المنشور المرتبط تُرفض العملية بـ`409`.

### الصلاحيات والتدقيق
- التحقق من الملكية على الخادم: غير المالك لا يرى الحملة ولا مسوداتها ولا ينفّذ إجراءً عليها (`403`)، وسجل التدقيق متاح للمالك فقط.
- كل عملية تُسجَّل في سجل التدقيق: `marketing_campaign_created`، `marketing_campaign_status_changed`، `marketing_campaign_draft_<action>`، `marketing_campaign_drafts_bulk`، `marketing_campaign_draft_linked`.
- كل قرار يُسجَّل أيضاً في سجل التدقيق الخاص بالمنشور وفي سجل تغييرات الحملة.

### نقاط النهاية
- `POST /api/ai/marketing-campaigns/:id/drafts/:taskId/action` — قرار على مسودة واحدة.
- `POST /api/ai/marketing-campaigns/:id/drafts/bulk` — قرار جماعي على عدة مسودات.
- `POST /api/ai/marketing-campaigns/:id/drafts/:taskId/link` — ربط مسودة معتمدة بمنشورها.

### الواجهة
- تنقّل واضح داخل "وكيل الغرابي الذكي" بين: مهمة واحدة، حملة تسويقية، تفاصيل الحملة، والمسودات.
- قائمة "الحملات السابقة" تتيح فتح تفاصيل أي حملة والعودة لمساحة الوكيل، مع تحديث البيانات دون إعادة تحميل الصفحة.

## v13.0.0 — مدير السوشيال ميديا الذكي
- محرك AI مركزي معزول: مزود Gemini → حارس الحصة → مهلة → إعادة محاولة محدودة → تخزين مؤقت → بديل حتمي.
- تصنيف أخطاء المزود: خطأ المصادقة (400/401/403) لا يُعاد، وأخطاء الخدمة (429/5xx) تُعاد بتراجع أسّي.
- لا يعيد أي مسار AI حالة 503 عند تعطل المزود؛ يُعاد دائماً محتوى صالح مع توضيح المصدر.
- **سياسة الموديل في مكان واحد** (`engine/ai/models.ts`): موديل الإنتاج `gemini-3.8-flash` (GA)، والموديلات المُوقفة
  مثل `gemini-2.0-flash` تُرفض تلقائياً ولا تُرسل للمزود، فلا يمكن لقيمة `GEMINI_MODEL` قديمة أن تُعطّل المحرك.
- **HTTP 200 لا يعني نجاح Gemini**: كل استجابة AI تحمل `aiSource` (`provider` / `cache` / `fallback`)
  و`fallbackReason` صريحاً (`auth_error` / `invalid_model` / `rate_limit` / `provider_error` / `timeout` / `quota_guard`).
- `/api/health` و`/api/readiness` يفصلان «المفتاح مضبوط» عن «المزود مُثبت فعلياً»، و`POST /api/ai/verify-provider`
  ينفّذ طلباً حقيقياً واحداً لإثبات الاتصال والموديل دون استهلاك حصة إضافية.
- طبقة منصات معزولة: كل منصة موصل مستقل يعلن قدراته الرسمية فقط، وإضافة منصة لا تتطلب تعديل النظام.
- حالة الاتصال لا تُدَّعى: connected تتطلب تحقق المزود، ولا يوجد نشر إنتاجي بدون موصل إرسال معتمد.
- تصنيف تعليقات حتمي (سؤال/شكوى/مدح/استفسار تجاري/سبام) دون استهلاك أي حصة.
- حماية من الرد المكرر عبر معرّف التعليق الخارجي، ومراجعة بشرية إلزامية للحالات الحساسة والسبام.
- سجلات نشر موثقة: لا يُسجَّل «منشور» بدون معرّف منشور حقيقي من المنصة.
- تحليلات تعلن توفر كل مؤشر عبر الواجهة الرسمية، وغير المتاح يظهر صراحة كغير متاح.
- ذاكرة تشغيلية للسوشيال ميديا من السجلات الفعلية، وعقل تسويقي يعلن فجوات بياناته.
- واجهة «مدير السوشيال ميديا» بنفس تصميم لوحة التحكم الحالية ودعم RTL.
