# AGENTS.md — دليل عمل وكلاء الذكاء الاصطناعي على مشروع الغرابي AI

## الهوية والنطاق
- المشروع: `al-gharabi-ai` — مساعد ذكي مركزي متعدد المنصات لمعرض الغرابي للتقسيط.
- **النطاق الرسمي الحالي: سوشيال + AI + تسويق.** هذا هو المعيار الوحيد لقبول أي ميزة.
- الهدف: «مدير سوشيال ميديا ذكي» يدير دورة السوشيال ميديا (تحليل → تخطيط → محتوى → نشر → تعليقات → تحليل → تعلّم)، مع عقل مركزي متعدد المنصات.
- اقرأ `GHARABI_PROJECT_RULES.md` قبل أي تعديل؛ فهو المصدر الملزم للقواعد.

### Scope Boundary — ما هو داخل النطاق وما هو خارجه (مصدر الحقيقة)
هذا القسم يصف **الواقع الفعلي للكود** لا طموحاً. الوجود الفني لسطح ما لا يعني أنه داخل
النطاق؛ المعيار هو «سوشيال + AI + تسويق».

**داخل النطاق (ACTIVE — ظاهر للمستخدم ومُختبر):**
- إدارة وسائل التواصل (10 منصات)، الموصلات الحقيقية (Telegram/Facebook/Instagram/YouTube/TikTok).
- مركز المحتوى، الموافقة والاعتماد، التقويم، التحليلات، مركز العملاء الموحد (تعليقات/رسائل).
- العقل المركزي (`central_agent`)، العقل المركزي متعدد المنصات (`central_brain`)، مدير تشغيل YouTube، مراجعة التقرير اليومي، طابور المحتوى.
- مركز ربط المنصات، مركز التشغيل والحماية، المستخدمون والصلاحيات، قاعدة بيانات المعرض (المنتجات/الأقساط)، التعافي والنسخ السحابي (للمالك).

**خارج النطاق (OUT OF SCOPE — الكود باقٍ لكنه معزول ومخفي، لا يُحذف):**
- `sales` (مركز المبيعات والعقود)، `control` (غرفة العمليات: دليل العملاء/التدفق النقدي/المطابقة).
- `finance`، `inventory`، `reports`، `operations`، `business`، `executive`.
- مساراتها: `/api/sales*`، `/api/control/{alerts,customer-directory,cashflow,reconciliation,daily-brief}`، `/api/{inventory,finance,reports/operations,crm,purchases,catalog,customers/360,tasks,business,suppliers,expenses,contracts,installments,executive}`.
- **العزل الفعلي:** خلف `GHARABI_ENABLE_LEGACY_ERP_SCOPE` (افتراضياً معطّل ⇒ fail-closed). عند التعطيل ترد هذه المسارات **404 `SCOPE_DISABLED`** قبل أي مصادقة، والتبويبات `sales/control/finance/inventory/reports/operations/business/executive` **مخفية** من `Sidebar` (`LEGACY_ERP_NAV_ENABLED=false` + `LEGACY_ERP_TAB_IDS`). لا يُحذف أي كود أو بيانات عند التعطيل.
- **لماذا بقيت؟** أسطح مستهلكة بواجهات كانت ظاهرة، وأسطح إرث تجاري. حُذف بعضها فعلاً (وحدات brain التجارية أدناه) وبقيت واجهاتها/مساراتها معزولة لأن حذفها يكسر مسارات تنقّل قائمة؛ القرار الصحيح هو **العزل لا الحذف العشوائي**.

**محذوف فعلاً (لا تعِد إدخاله بلا قرار صريح):**
- `engine/brain/{sales,growth,commercial,digital}/`، `engine/brain/knowledge/catalog.ts`، `engine/brain/market/{demandSignals,opportunityEngine}.ts`.
- واجهاتها: `CommercialBrainView`/`GrowthBrainView`/`SalesDashboardView`/`UnifiedGrowthBrainView`.
- مساراتها: `/api/agent/brain/sales/*` و`/growth/*` و`/commercial/*`، واختباراتها وفحوص final-audit الخاصة بها.
- حُذفت في `cc6e86f` لأنها **خارج النطاق** (عقل مبيعات/نمو تجاري). الوثائق التصميمية لها أُزيلت أيضاً. لا مرجع لأي منها في أي ملف نصي (فحص `brain-removed-modules-no-stale-refs`).

**حدود العقل المركزي (Central Brain) الحالية:**
- الباقي والموصول: الإدراك (`cognition`)، الفريق (`team`)، القرار (`decisions`)، التعلّم (`learning`)، الذاكرة (`memory`)، الاستراتيجية (`strategy`)، الإيقاع (`timing`)، الأهداف (`goals`)، التجارب (`experiments`)، الجمهور (`audience`)، السوق (`market/commercialRelevance`)، المعرفة (`knowledge/truth`)، وقت التشغيل 24/7 (`brainRuntime`).
- **قدرات العقل تحليلية/توصية/تعلّم فقط.** التنفيذ الخارجي يمرّ ببوابات المشروع القائمة (`EXTERNAL_ACTION` + تفويض المالك) ولا يقع من العقل مباشرة. لا تنفيذ صامت، ولا اختراع حقيقة تجارية.

**أنظمة لا يجوز إعادة إدخالها دون قرار مالك صريح:**
- أي وحدة ERP (مخازن/مبيعات/عقود/أقساط/مشتريات/تحصيل/مالية) كتوسعة فعلية.
- أي عقل تجاري/مبيعات/نمو/رقمي/موحّد (حُذف).
- أي قدرة تُعلن اتصالاً/تسليماً بلا إثبات مزود، أو أي بيانات وهمية.

## أوامر البناء والاختبار
```bash
npm install
npm run dev            # tsx server.ts
npm run lint           # tsc --noEmit
npm run build          # vite build + esbuild server.ts -> dist/server.cjs
npm run final-audit    # node final-audit.mjs (1438 فحصاً)
npm test               # storage + engine + auth + ... + db + runtime
```
- التشغيل الإنتاجي: `PORT=4517 NODE_ENV=production APP_URL=http://localhost:4517 node dist/server.cjs`
- فحوص منفردة: `npm run test:engine` | `test:social` | `test:network` | `test:runtime` | `test:storage`.
- استمرارية Postgres محلياً: `cd tools/local-verification && npm install && npm run verify:db`
  (يشغّل Postgres مدمجاً ثم `engine/tests/database.persistence.test.ts`).

## البنية الفعلية (مصدر الحقيقة)
```
server.ts                     خادم Express المركزي (كل المسارات، الحالة، المصادقة)
engine/ai/engine.ts           المحرك المركزي: مزود → حارس → مهلة → إعادة → cache → بديل
engine/ai/provider.ts         موصل Gemini (يقرأ المفتاح من الخادم فقط)
engine/ai/errors.ts           تصنيف الأخطاء (auth/service/rate/timeout/network)
engine/ai/retry.ts            تراجع أسّي + CircuitBreaker
engine/ai/models.ts           المصدر الوحيد لمعرّفات الموديلات + رفض الموديلات الموقوفة
engine/social/adapter.ts      عقد الموصل + BasePlatformAdapter + assertConnected
engine/social/registry.ts     سجل المنصات العشر (كل موصل معزول)
engine/social/comments.ts     تصنيف التعليقات الحتمي + منع الرد المكرر
engine/social/publishing.ts   preflight/execute + توفر المؤشرات لكل منصة
engine/social/brain.ts        العقل التسويقي + الذاكرة التشغيلية
engine/social/routes.ts       مسارات /api/social/manager/* (تُسجَّل من server.ts)
engine/storage/adapter.ts     محوّل تخزين واحد: ملف محلي أو Postgres (DATABASE_URL)
engine/tests/                 8 مجموعات اختبار (380+ فحصاً)
netlify/functions/api.ts      غلاف Netlify Function حول تطبيق Express نفسه
src/components/social/SocialManagerView.tsx   واجهة المدير
src/components/agent/BrainCommandView.tsx     لوحة العقل المفكر
```
- المسارات تُسجَّل عبر `registerSocialManagerRoutes(app, {...})` في `server.ts` (حوالي السطر 3283) بحقن التبعيات.
- النشر على Netlify: نفس تطبيق Express يعمل داخل Function واحدة. `server.ts` يصدّر `app` ويتخطى `app.listen()` عند كشف بيئة Netlify/Lambda، ويستورد `vite` ديناميكياً ليبقى خارج الحزمة. التوجيه من `netlify.toml` عبر rewrite بحالة 200 يحافظ على المسار الأصلي.

## قواعد ملزمة عند التعديل
1. **لا بيانات وهمية إطلاقاً.** لا حسابات، متابعين، منشورات، إعجابات، تعليقات، ولا Analytics مختلقة.
2. **لا اتصال بدون إثبات.** `connected` تتطلب `providerVerified === true`. أي منصة بلا OAuth فعلي تظهر `disconnected`.
3. **لا نشر بدون معرّف منشور حقيقي** من المزود. النشر المحاكى يُوسَم `simulated` صراحةً.
4. **لا عدّاد وهمي** مثل `125/125`؛ يوجد فحص يرفض هذا المحتوى.
5. **المؤشر غير المتاح يُعلن صراحة** مع سبب، ولا يُقدَّر أو يُخترع.
6. **العمليات الحتمية لا تستهلك حصة AI**: حسبة الأقساط، فحص النشر، هيكل الحملة، حالة المنصات، تصنيف التعليقات.
7. **الأسرار في الخادم فقط.** لا `VITE_` لمفاتيح، ولا secrets في Git، ولا تسجيل OTP/مفاتيح في logs.
8. **تعطل المزود لا يُسقط النظام**: مسارات AI تعيد محتوى بديلاً صالحاً، ولا تعيد 503 أبداً.
9. **الحالات الحساسة والسبام** تتطلب مراجعة بشرية؛ لا رد آلي عليها.
10. **حماية الرد المكرر** عبر معرّف التعليق الخارجي (يمنع webhook replay/retry من إنشاء ردود متعددة).
11. **نطاق المشروع: سوشيال + AI + تسويق فقط.** لا ERP/Inventory/Sales/Finance/CRM فعّالاً بلا عزل. أي سطح من هذه العائلات يُعزَل افتراضياً خلف مفتاح بيئة صريح (fail-closed) أو يُحذف — تفصيله في قسم «عزل أسطح ERP/CRM/المالية القديمة».

## عزل أسطح ERP/CRM/المالية القديمة (2026-10-04) — تطبيق مبدأ النطاق
**القرار:** هذه الأسطح **خارج النطاق المعلن** (سوشيال + AI + تسويق)، فتُعطَّل افتراضياً
برد **404 صريح** بترميز `SCOPE_DISABLED` **قبل أي مصادقة**، وتُعاد بالكامل بضبط
`GHARABI_ENABLE_LEGACY_ERP_SCOPE=true`. **لم يُحذف أي كود ولا بيانات** — العزل فقط.

**لماذا العزل لا الحذف؟** الـAudit الفعلي (`grep` على كل المستودع) أثبت أن هذه المسارات
**مستهلكة فعلياً من واجهة أمامية مُثبَّتة**، فحذفها يكسر ميزات قائمة (خارج نطاق هذه المهمة):
- `/api/inventory` + `/api/inventory/:id/adjust` → `src/components/inventory/InventoryView.tsx` (تبويب `inventory`)
- `/api/reports/operations` → `src/components/reports/ReportsView.tsx` (تبويب `reports`)
- `/api/crm/leads` (GET/POST/PATCH) → `src/components/operations/OperationsView.tsx` (تبويب `operations`)
- `/api/purchases` (GET/POST) → `src/components/business/BusinessSuiteView.tsx` (تبويب `business`)
- `/api/finance/overview` → `src/components/finance/FinanceView.tsx` (تبويب `finance`)
- `/api/finance/aging` → `src/components/executive/ExecutiveCommandView.tsx` (تبويب `executive`)
- بلا استهلاك مباشر: `/api/inventory/movements`, `/api/inventory/alerts`,
  `/api/customers/360`, `/api/crm/leads/from-conversation/:id`, `/api/crm/follow-ups`,
  `/api/crm/follow-ups/today` (الطريقة `getTodayFollowUps` معرّفة بلا مستدعٍ) — لكنها
  عُزلت ضمن نفس البادئات لأنها من نفس العائلات.

**التفاصيل:**
- **17 مساراً** تحت 6 بادئات: `/api/inventory`, `/api/customers/360`, `/api/reports/operations`,
  `/api/crm`, `/api/purchases`, `/api/finance`. **كلها عُزلت** (لم يُحذف أي مسار).
- الحارس في `server.ts` (`legacyErpScopeEnabled`/`LEGACY_ERP_ROUTE_PREFIXES`/
  `isLegacyErpRouteRequest`) مُسجَّل **قبل** أول مسار من هذه العائلات، مطابقة غير حسّاسة
  لحالة الأحرف مع احترام حدّ المسار (لا تلتقط `/api/crmx`).
- **الواجهة:** مداخل التبويبات التابعة (executive/business/finance/inventory/reports/operations)
  مخفية في `Sidebar.tsx` عبر `LEGACY_ERP_NAV_ENABLED=false`. تبويبا `sales` و`control`
  ليسا معزولين (يستخدمان `/api/sales` و`/api/control/*` غير المشمولة) فبقيَا ظاهرين.
- **المراقبة:** `/api/health` يعلن `legacyErpScope: { enabled, isolated, envName, prefixes }`
  (منطقي بلا قيمة سرّية).
- **الاختبار:** `engine/tests/scope.legacy.erp.isolation.test.ts` (`npm run test:scope-legacy-erp`)
  يشغّل خادماً حقيقياً ويثبت العزل لكل المسارات (GET/POST/PATCH/DELETE، حالة الأحرف،
  حدّ المسار، المسارات المشتركة/الداخلية غير محجوبة) + العودة عند تفعيل المفتاح.
- **الفحوص:** 7 فحوص `legacy-erp-*` في `final-audit.mjs` تمنع عودة أي مسار من هذه
  العائلات فعّالاً بلا عزل (البادئات تغطي أي مسار فرعي جديد).

## سياسة موديل Gemini (مهم — صُحّحت بعد تدقيق 2026-09-18)
- `engine/ai/models.ts` هو **المصدر الوحيد** لمعرّفات الموديلات. يوجد فحص يمنع ظهور أي معرّف `gemini-x.y` في أي ملف إنتاج آخر.
- موديل الإنتاج: `gemini-3.8-flash` (GA منذ 2026-09-02). المرشحات: 3.8 → 3.7 → 3.6 → 3.5 (كلها GA بدون تاريخ إيقاف معلن).
- **ممنوع** استخدام `gemini-2.0-flash` و`-001` و`-lite` و`-lite-001`: أُوقفت فعلياً في **2026-06-01**، وأي طلب بها يفشل حتماً.
- `gemini-2.5-flash` ما زال يعمل لكن مجدول للإيقاف في **2026-10-16**؛ يُقبل من البيئة مع تحذير فقط.
- موديل `GEMINI_MODEL` إن كان مُوقفاً أو غير صالح شكلياً **يُرفض تلقائياً** ولا يُمرَّر للمزود، ثم تُستخدم المرشحات الافتراضية — لذا قيمة بيئة قديمة لا يمكن أن تُعطّل المحرك.

### القاعدة التشخيصية (كانت مقلوبة سابقاً)
التقرير السابق ادّعى أن `gemini-3.8-flash` غير موجود وأنه سبب 503. **هذا خطأ**: الموديل حقيقي وGA.
السبب الحقيقي لعرض «503 / High Demand» كان سلوكاً في الكود القديم:
1. أخطاء الموديل/المفتاح كانت تُعرض للمستخدم كأنها ضغط مرتفع بدل تمييزها.
2. العميل كان يُنشأ في المتصفح بمفتاح `VITE_` غير موجود أصلاً، فكان الطلب يفشل دائماً.
3. `GEMINI_MODEL || "gemini-3.8-flash"` كان يُكتب في `generatedBy` بلا تحقق من نجاح المزود فعلياً.

لذلك: **HTTP 200 لا يعني أن Gemini نجح.** الحكم دائماً من `aiSource` (`provider` / `cache` / `fallback`)
مع `fallbackReason` الصريح (`auth_error` / `invalid_model` / `rate_limit` / `provider_error` / `timeout` / `quota_guard` / `provider_not_configured` / `circuit_open`).

## ملاحظات تشغيلية مهمة
- الإصدار الحالي `13.0.0`. إن كان `GEMINI_API_KEY` غير مضبوط، فالمحرك يعمل بالبديل الحتمي و`aiEnabled: false` — وهذا سلوك صحيح وليس خطأً.
- `/api/health` يعرض `geminiUsage.providerState` (configured / verifiedLive / verification) و`modelPolicy` وقاطع الدائرة.
- `/api/readiness` يفصل `applicationReady` عن `ai.providerReady`؛ **لا يُعلن المزود جاهزاً بمجرد وجود مفتاح**، بل يلزم تحقق حي.
- `POST /api/ai/verify-provider` (للمالك فقط) ينفّذ **طلباً حقيقياً واحداً فقط** لإثبات المفتاح+SDK+الموديل+الاستجابة، بلا retry وبلا cache. عند غياب المفتاح يعيد `NOT VERIFIED — GEMINI_API_KEY NOT AVAILABLE IN RUNTIME`.
- التحقق الحي **POST فقط**: أي طريقة أخرى تُرفض 405 صريحة قبل المصادقة؛ والمسار محصور بالمالك على الخادم (`requireOwner`) فلا يكفي إخفاء الزر في الواجهة. **مهلة التحقق ثابتة 30 ثانية** (`LIVE_VERIFY_TIMEOUT_MS`) ولا تُشتق من `AI_TIMEOUT_MS` القابل للضبط، والواجهة تستخدم 30 ثانية أيضاً (`GEMINI_VERIFY_TIMEOUT_MS`). إثبات الملكية على الخادم الفعلي في `engine/tests/acceptance.authz.real.test.ts` (401 بلا جلسة، 403 لغير المالك، 405 لـGET، ولا تسريب مفتاح).
- **التشخيص الأمين للفشل (صُحّح 2026-09-23)**: `verificationHintFor(info)` في `server.ts` يوجّه حسب فئة الخطأ الفعلية لا حسب تخمين ثابت. سابقاً كان كل فشل يعرض «راجع صلاحية GEMINI_API_KEY» حتى مع 503 (ضغط المزود) أو 429 (نفاد حصة الحساب)، فيُوهم المالك بعطل مفتاح غير موجود. الآن: `auth` وحدها توجّه للمفتاح، و`rate_limited` توجّه لحصة المزود/الفوترة، و`unavailable` لعطل المزود. `errorKind` و`hint` يظهران في استجابة `/api/ai/verify-provider` وكتلة `providerState` في `/api/health` (`verificationErrorKind`/`verificationHint`) والواجهة تعرض التوجيه تحت رسالة الفشل. اختبارات: `engine/tests/gemini.verification.test.ts` (مجموعة 3b/5b) و`final-audit` (`gemini-verify-accurate-hint`, `gemini-verify-errorKind-exposed`).
- كل مسارات `/api/social/manager/*` محمية بـ `authenticateToken` وتعيد 401 بدون جلسة.
- الحالة تُحفظ في ملف JSON على الخادم مع كتابة ذرّية ونسخ احتياطية يومية (7 أيام).
- اختبار الدخان `engine/tests/runtime.smoke.test.ts` يشغّل `dist/server.cjs` فعلياً، لذا شغّل `npm run build` قبله.
- **إرسال OTP بالبريد**: `POST /api/auth/request-owner-challenge` يولّد رمزاً من 6 أرقام (صالح 10 دقائق) ويرسله فعلاً إلى `OWNER_EMAIL` عبر Resend. الإعداد من البيئة فقط: `RESEND_API_KEY` و`RESEND_FROM_EMAIL`. إذا غاب المفتاح أو فشل الإرسال يُعاد خطأ صريح (لا ادعاء نجاح) ويُلغى الرمز المعلّق. لا يُسجَّل الرمز ولا يُعاد في JSON؛ السجل يحمل `owner_challenge_email_sent` أو `owner_challenge_email_failed` فقط. `GET /api/system/email-status` (للمالك) يعرض `configured` / `provider` / `fromConfigured` بلا أي سر. اختبار `engine/tests/owner.email.test.ts` يوجّه Resend إلى خادم وهمي محلي عبر `RESEND_BASE_URL` فلا يُرسل بريد حقيقي.
- **معاينة الجوال (اختياري)**: لتجربة الواجهة من متصفح الهاتف بدون Resend/Google، اضبط `GHARABI_PREVIEW_TOKEN` في بيئة الخادم (قيمة عشوائية قوية، لا تُكتب في Git). المسار `/api/auth/preview-login` يقبل **POST فقط** بالتوكن في الجسم (`{ token }`) فلا يظهر في سجلات الخادم ولا في محفوظات المتصفح؛ وأي توكن في سطر الطلب يُرفض بـ **400**. الواجهة تقرأ التوكن من مقطع الرابط `/#preview_token=...` حصراً (لا تقبل `?preview_token` لأنه يسرّب التوكن إلى سجلات الخادم) ثم تمسحه من الرابط فوراً، فيمنح رابطاً محفوظاً واحداً وصولاً دائماً بلا OTP. بدون ضبط المتغير يعيد المسار **404** كأنه غير موجود، والمقارنة بزمن ثابت (`timingSafeEqual`)، وحدّ 10 محاولات لكل IP كل 15 دقيقة، وتدوير التوكن يُبطل الجلسات الصادرة قبله. لا يُسجَّل التوكن ولا يُعاد في أي استجابة خطأ. اختبار `engine/tests/preview.login.test.ts` يثبت هذه الشروط.
- قبل أي commit: `npm run lint && npm run build && npm test && npm run final-audit`، ثم افحص عدم وجود أسرار أو ملفات مؤقتة.

## الوصول الدائم للمالك (صُحّح 2026-09-18) — جذر مشكلة «الوصول المؤقت»
كان المالك يُطرد إلى شاشة الدخول باستمرار لسببين حقيقيين، لا لانتهاء صلاحية حقيقي:
1. **الخادم**: `activeSessions` و`verificationChallenges` كانتا `Map` في الذاكرة فقط.
   داخل Netlify Functions قد يُنفَّذ كل طلب في عملية جديدة، فتُفقد الجلسة فوراً،
   والأسوأ: رمز OTP يُنشأ في عملية ويُتحقق منه في أخرى فيفشل دائماً.
2. **المتصفح**: التوكن كان في `sessionStorage`، وهو يُمسح عند إغلاق التبويب.

الحل المطبَّق:
- `engine/auth/sessions.ts`: توكن موقّع HMAC-SHA256 بلا حالة، حمولته `{uid, iat, exp, sid}` فقط.
  **الدور لا يُخزَّن في التوكن أبداً** بل يُقرأ من قاعدة البيانات في كل طلب، فيسري تغيير
  الدور/التعطيل/الحذف فوراً. مدة الجلسة 30 يوماً.
- `engine/auth/challenge.ts`: رمز تحقق مشتق رياضياً بنمط TOTP (6 أرقام، نافذة 10 دقائق،
  وتُقبل النافذة السابقة أيضاً) فلا يعتمد على أي ذاكرة مشتركة.
- الإبطال يُحفظ على القرص: `revokedSessions` (خروج فردي) و`userRevocations` (ختم زمني
  لكل مستخدم يُبطل كل توكناته الصادرة قبله). لذا الإبطال يسري في كل العمليات وبعد إعادة التشغيل.
- `SESSION_SECRET` هو المصدر المفضّل لتوقيع الجلسات؛ وإن غاب يُستخدم
  `PLATFORM_TOKEN_ENCRYPTION_KEY`؛ وإن غابا معاً يُولَّد مفتاح عابر للعملية **وتُعلن
  `persistence.sessionsDurable=false` بصراحة** في `/api/health` بدل الإيهام بالدوام.
- الواجهة: التوكن في `localStorage` لا `sessionStorage`، ويُمسح تلقائياً عند رفضه.
- `STATE_DIR` يضبط مجلد الحالة (للأقراص الدائمة). `STATE_WRITABLE` يُفحص مرة واحدة ويُعلَن
  في `/api/health` و`/api/readiness`؛ على نظام ملفات للقراءة فقط لا يُدَّعى أن البيانات دائمة.
- `/api/readiness` يعرض كتلة `auth.permanentAccessReady` = بريد المالك مضبوط + جلسات دائمة
  + مزود بريد مضبوط. اختبارات: `engine/tests/auth.challenge.test.ts` و`engine/tests/session.durability.test.ts`.

### عقد مسارات API (صُحّح 2026-09-18)
أي مسار تحت `/api` غير مُعرَّف — أو طريقة HTTP غير مدعومة على مسار موجود — يجب أن يرد
**JSON 404/405 صريحاً**. سابقاً كانت هذه الطلبات تسقط إلى واجهة React فتُعيد `index.html`
بحالة 200، فيظن العميل أن الطلب نجح. الشبكة في `app.use("/api", ...)` وواجهة SPA تستثني `/api/*`.
`GET /api/ai/verify-provider` يعيد الآن 405 (كان يعيد HTML 200 بلا مصادقة).

## ثبات جلسة الواجهة (صُحّح 2026-09-20) — جذر «يطلب OTP بعد cold start»
الخادم كان سليماً (جلسات موقّعة بلا حالة تنجو من إعادة التشغيل)، لكن **الواجهة** كانت
تُظهر شاشة الدخول عند أي فشل في طلب التحقق، بما فيه 5xx وانقطاع الشبكة. فيظهر للمالك
أن الدخول مؤقت ويُطلب منه OTP من جديد — مع أن التوكن في `localStorage` ما زال صالحاً.

القاعدة الملزمة الآن: **الخروج يقع فقط على رفض صريح.** السياسة في `src/services/sessionPolicy.ts`
(منطق خالص قابل للاختبار) بثلاث حالات:
- `authenticated`: الخادم أكّد الجلسة.
- `rejected`: 401/403 صراحةً أو غياب توكن محفوظ — هنا فقط تُمسح الجلسة وتُعرض شاشة الدخول.
- `unavailable`: شبكة/مهلة/5xx/استجابة مشوّهة — لا يُمسح التوكن ولا تُعرض شاشة الدخول،
  بل `authUnavailable` مع شاشة «إعادة المحاولة» (`retryAuth`).
`apiService.checkSession()` لا يرمي أبداً ويُصنّف النتيجة. تبادل توكن المعاينة يُصنَّف
بالمثل: 401/403/404 = توكن غير صالح، أما 5xx/الشبكة فعطل عابر يُعاد بلا مسح الجلسة.

اختبارات: `engine/tests/session.policy.test.ts` (سياسة) و`engine/tests/netlify.coldstart.test.ts`
(دالة Netlify في عمليات منفصلة: login، me، users، OTP، بدء بارد بمجلد فارغ، نجاة إعادة
النشر، رفض سرّ مختلف، خروج يسري عبر العمليات، `STATE_DIR` للقراءة فقط، ولا تسريب توكنات).

## ثبات الحالة على Render Free (صُحّح 2026-09-20) — جذر «يُطلب OTP ويضيع كل شيء بعد النشر»
Render Free بلا قرص دائم: ملف `.gharabi-state.json` يُمسح عند كل إعادة نشر، فتضيع
قائمة إبطال الجلسات وتوكنات المنصات المشفّرة ومساحة العمل بالكامل. الإصلاح:
- `engine/storage/adapter.ts` واجهة تخزين واحدة (`readSync`/`read`/`write` ذرّي/`status`)
  بخلفيتين: **ملف محلي** (الافتراضي للتطوير والنسخ الاحتياطية اليومية بحفظ 7 أيام)
  و**Postgres** يُفعَّل تلقائياً عند وجود `DATABASE_URL` (متوافق مع Neon Free).
  لا migrations معقدة: جدول واحد `gharabi_state(key text pk, value jsonb, updated_at)`.
- كل ما كان يُكتب في ملف الحالة يمر عبر المحوّل: `revokedSessions`، `userRevocations`,
  `serverUsers`، `workspace` (وفيه `providerTokens` مشفّرة AES-256-GCM)، `jobs`، `audit`،
  `platformConnections`، ومفتاح `usage` لحارس Gemini. لا كتابة مباشرة لملف الحالة في `server.ts`.
- التهيئة غير متزامنة قبل `app.listen` وعبر `warmStorage()` في غلاف Netlify: تُقرأ الحالة
  الفعلية من Postgres أولاً، ثم يُسمح بالكتابة. **لا كتابة قبل الجهوزية** لئلا تُطمس حالة
  قائمة بلقطة فارغة.
- `/api/health` يعرض `persistence: { backend, durable, mode, healthy, warning, ... }`.
  بلا `DATABASE_URL` على بيئة إنتاج: `mode: "ephemeral"` مع تحذير صريح
  `MISSING DATABASE_URL`، و`revocationsDurable: false` — **لا ادعاء دوام غير مثبت**.
  توكنات المنصات تبقى مشفّرة داخل القاعدة ولا تُسجَّل ولا تُعاد في أي استجابة.
- `render.yaml`: خطة Free، `npm ci && npm run build`، `npm run start`،
  `healthCheckPath: /api/health`، `NODE_VERSION=20`، وكل الأسرار `sync: false` بلا أي قيمة.

اختبارات: `engine/tests/storage.adapter.test.ts` (واجهة المحوّل، الكتابة الذرّية، النسخ،
الاختيار التلقائي، القراءة فقط) و`engine/tests/database.persistence.test.ts` (Postgres حقيقي:
write → restart بمجلد فارغ → الإبطال يسري → جلسة المالك تنجو). الثاني يُتخطى صراحةً بدون
`GHARABI_TEST_DATABASE_URL`؛ يمكن تشغيله محلياً عبر `tools/local-verification` (Postgres مدمج،
أداة تطوير فقط وغير مثبّتة في CI/Render).
- **الإنتاج لا يُعتبر جاهزاً للثبات قبل تشغيل اختبار الاستمرارية على النشر الفعلي.**

## فشل النشر على Netlify (صُحّح 2026-09-20) — جذر «الإنتاج يخدم كوداً قديماً»
كان الإنتاج يخدم بنية قديمة (`eab658a`) مع أن `main` متقدم عليها، وكل محاولات النشر
بعد `eab658a` تُرجِع `state=error` خلال **~0.1 ثانية** دون أن تبدأ البناء أصلاً
(النشر الناجح السابق استغرق 24–29 ثانية). سبب التوقف التلقائي: وجود ملف **`bun.lock`
فارغ (0 بايت)** في المستودع. Netlify يكتشف `bun.lock` فيتحوّل إلى `bun install` بدلاً
من npm، وملف القفل الفارغ يُفشل تثبيت الاعتماديات فوراً قبل خطوة البناء.

الإصلاح:
- حذف `bun.lock` الفارغ من التتبع، وإضافته إلى `.gitignore` مع `bun.lockb`،
  فالاعتماد الآن على `package-lock.json` و`npm ci` حصراً.
- تثبيت `NODE_VERSION = "20"` في `netlify.toml` لمنع أي انحراف في بيئة البناء.
- فحوص جديدة في `final-audit.mjs`: `no-empty-bun-lock` و`netlify-node-pinned`،
  فيمنع الفحص عودة ملف قفل Bun فارغ.
- `/api/health` يعرض `persistence.previewLoginEnabled` (منطقي فقط بلا قيمة) ليتأكد
  المالك من ضبط مسار الدخول المباشر في بيئة النشر دون كشف التوكن.

ملاحظة: إذا استمرت حالة `error` بعد هذا الإصلاح فالمشكلة خارج الكود (رصيد/تجاوز حدود
حساب Netlify)، إذ إن زمن الفشل القصير جداً يعني أن البناء لم يبدأ.

## إبطال جلسات المعاينة ودوام الإبطال (صُحّح 2026-09-21)
- تغيير `GHARABI_PREVIEW_TOKEN` يرفع ختماً زمنياً (`previewEpoch`) يُبطل كل جلسة معاينة
  صادرة قبله — بلا تدوير `SESSION_SECRET`. البصمة (SHA-256) ورقم الختم يُحفظان عبر
  المحوّل في مفتاح `control` (`.gharabi-control.json` أو جدول `gharabi_state`)، فتصمد
  الإبطال في كل العمليات وبعد إعادة التشغيل. التوكن نفسه لا يُخزَّن ولا يُسجَّل.
- الجلسة غير المعاينة تحمل `iat`؛ تغيير دور/تعطيل مستخدم يُبطل توكناته الصادرة قبله.
- رمز OTP يُستهلك لكل نافذة: `matchChallengeWindow` يُعيد رقم النافذة المطابقة، ويُخزَّن
  `consumedOtpWindows` عبر المحوّل فيمنع استخدام الرمز مرتين، ويبقى المنع بعد restart.
- الكتابات الحسّاسة (إنشاء جلسة، خروج/إبطال، استهلاك OTP، دخول معاينة) تُنتظر عبر
  `persistCritical()` قبل الرد. SIGTERM/SIGINT يُفرّغ الطابور في حلقة بمهلة ≤ 10 ثوانٍ.
- تعذّر تحميل الحالة من Postgres عند الإقلاع **يُفشل الإقلاع صراحةً** (بلا رجوع لملف ولا
  كتابة فوق حالة قائمة). Postgres: SSL مفروض من التطبيق، `max: 5`، مهلة 15 ثانية،
  3 محاولات لتغطية استيقاظ Neon.
- فحوص: `engine/tests/persistence.control.test.ts` (عمليات منفصلة: تدوير التوكن، تفريغ
  SIGTERM، إعادة استخدام OTP، فشل إقلاع Postgres). سكربتات: `scripts/generate-secrets.mjs`
  و`scripts/verify-deployment.mjs`، و`Dockerfile` عام على Node 20، ودليل `docs/دليل-الهاتف.md`.

## سياسة الجدولة والتوقيت (صُحّحت 2026-09-22)
- المنطقة الزمنية المعتمدة للجدولة هي **Asia/Baghdad**، ومصدرها الوحيد
  `src/utils/scheduleTime.ts` (يعمل على الخادم والمتصفح معاً).
- **المعنى المحلي هو الثابت**: قيمة `datetime-local` تُرسل والتُخزَّن كجدار زمني محلي
  نصاً `YYYY-MM-DDTHH:mm`، لذا تظهر للمستخدم بنفس الساعة التي اختارها بعد إعادة الفتح.
- **يُمنع `toISOString()` في مسار الجدولة**: كان يحوّل الاختيار المحلي إلى UTC فيزحزح
  الساعة 3 ساعات (بغداد UTC+3 بلا توقيت صيفي). لا تحويل عند الإرسال أو العرض.
- المقارنات اللحظية (ماضٍ/مستقبل، ترتيب التقويم) تمر عبر `wallClockToEpoch` الذي يحوّل
  الجدار المحلي إلى لحظة UTC صحيحة قابلة للعكس، لا عبر `Date.parse` (يفسّر النص بتوقيت
  المضيف = UTC على Render/Netlify) ولا عبر مقارنة نصية.
- حماية «لا جدولة في الماضي» محفوظة في الواجهة والخادم (`isScheduleInFuture`)، وتُرفض
  كذلك القيم التي تحمل منطقة ISO بدل الجدار المحلي لئلا تُزحزح الساعة صامتة.
- اختبار `engine/tests/schedule.timezone.test.ts` (43 فحصاً): اختيار محلي بغدادي، غياب فرق
  الساعات، رفض الماضي، قبول المستقبل، حفظ ثم قراءة بنفس المعنى، عبور منتصف الليل، ومسار
  الخادم الفعلي (تخزين/إعادة قراءة/تقويم).

## ثبات سجلات التفاعل وربط حارس المحتوى (صُحّح 2026-09-22)
دفعة إكمال وتدقيق دورة إدارة التعليقات والتفاعلات، بعد Phase 0 VERIFY ONLY أثبتت
أن التصنيف وبوابة الرد ومنع replay وحارس Gemini وحماية الجلب من المنصات غير
المتصلة كلها تعمل فعلياً. الفجوتان الحقيقيتان الوحيدتان كانتا:

1. **سجلات السوشيال لا تصمد بعد restart.** `socialComments` و`socialReplies`
   و`publishRecords` و`performanceRecords` و`marketingDecisions` و`strategiesTested`
   كانت تُكتب في `workspace`، لكن `loadPersistentState` و`buildPersistedState` لم
   تضمناها، فتُفقد عند كل إعادة تشغيل/نشر. النتيجة الأخطر: حماية replay/duplicate
   تسقط بعد restart، فيُنشئ نفس `externalId` سجلاً مكرراً. أُضيفت القائمة كاملة إلى
   طرفَي الحفظ (بحدود أعلى لكل مصفوفة) — بلا أي تغيير في schema لأن الجدول
   `gharabi_state` مخزن key/value عام.
2. **حارس سلامة المحتوى لم يكن مربوطاً بمسار الرد.** `suggestedDeterministicReply`
   ونص الرد في `/comments/reply` كانا يمرّان دون `contentSafety.ts`. الآن الرد
   المقترح في `/comments/classify` يُفحص عبر `analyzeBusinessClaims` قبل عرضه
   (ويُعلن `contentSafety`)، و`/comments/reply` يفرض حارساً من جهة الخادم يرفض
   (422) أي نص رد يحمل عرضاً/رقماً/رابطاً غير مسجّل **قبل التسجيل**. الحقائق تُبنى
   من بيانات المعرض الفعلية عبر `buildFacts` المحقونة من `server.ts`.

اختبارات: `engine/tests/social.persistence.test.ts` (file backend: create → persist
→ restart → read للتعليقات والردود و replay/duplicate)، وتحقق السوشيال أُضيف إلى
`database.persistence.test.ts` (Postgres حقيقي عبر `tools/local-verification`)،
وفحوص ربط حارس المحتوى في `social.routes.test.ts`.

## فجوتا ثبات إضافيتان (صُحّحت 2026-09-22) — اتصالات المنصات وسجلات المخزون
1. **اتصالات المنصات لم تكن تُسترجَع بخلفية الملف.** `platformConnections` كانت
   تُحفظ في اللقطة عبر `buildPersistedState`، لكن `loadPersistentState` لم يُرجعها،
   و`loadPlatformConnections` كان جسمها فارغاً، والاسترجاع الفعلي موجود فقط في
   `applyStateSnapshot` (مسار Postgres). النتيجة: على التخزين الملفي (التطوير أو
   `STATE_DIR` دائم) كان restart يُظهر منصة متصلة موثقة كـ `disconnected` رغم بقاء
   توكنها المشفّر، فيسقط شرط `connected && providerVerified` بلا سبب فعلي. أُصلح
   بإرجاع `platformConnections` من اللقطة واسترجاعها في `loadPlatformConnections`.
2. **سجلات المخزون/الإشعارات/أحداث المزود كانت تُحمَّل ولا تُحفظ.** `inventoryMovements`
   و`notifications` و`webhookEvents` و`providerEvents` موجودة في قائمة `loadPersistentState`
   لكنها غائبة عن `buildPersistedState`، فتُفقد عند كل restart/نشر. أُضيفت بحدود أعلى
   مطابقة لتحميلها.

الدرس العام: أي مفتاح في `loadPersistentState` يجب أن يقابله مفتاح في `buildPersistedState`
والعكس — وكلاهما يجب أن يُسترجَع فعلاً على الحالتين (ملف وPostgres). فحصان في
`final-audit.mjs`: `platform-connections-restored` و`inventory-notifications-persisted`،
وفحص ثبات الاتصال في `engine/tests/social.persistence.test.ts`.

## موصل Telegram الحقيقي — أول تكامل اجتماعي خارجي (Batch 5)
Telegram هو **أول** منصة بموصل إرسال/استقبال حقيقي منفّذ في الكود
(`engine/social/telegram.ts`)، لأنه المنصة الوحيدة المدعومة التي تصل إلى حالة
«متصل ومتحقق + إرسال حقيقي» بـ**رمز بوت فقط**، بلا تسجيل تطبيق ولا OAuth.
بقية المنصات مسجّلة بـ`realConnector: false` وتبقى `productionReady=false`
حتى يُنفّذ موصلها، ولا يُوهم المالك بقدرة إرسال غير موجودة.

- السجل: `engine/social/registry.ts` صار يحمل لكل منصة `credentialMode`
  (`bot-token` | `oauth2` | `app-registration`) و`realConnector`. دالتا
  `hasRealConnector` و`credentialModeOf` مصدرهما الوحيد.
- الدورة الكاملة: `POST /api/platforms/telegram/configure` (للمالك) ينفّذ
  `getMe` فعلياً ثم `setWebhook` بسرّ حقيقي — لا اتصال بلا استجابة مزود.
  `POST /api/platforms/telegram/webhook` يتحقق من ترويسة
  `X-Telegram-Bot-Api-Secret-Token` بزمن ثابت، ثم يحلل الرسالة ويصنّفها ويخزّنها
  كتعليق حقيقي (`ingestSource: telegram_webhook`). `POST /api/platforms/telegram/reply`
  (للمالك) يمر بحارس سلامة المحتوى وبوابة الرد المكرر ثم يرسل `sendMessage` فعلياً،
  ولا يسجّل `delivered=true` بلا `message_id` من المزود.
- الأسرار: `TELEGRAM_BOT_TOKEN` و`TELEGRAM_WEBHOOK_SECRET` من بيئة الخادم أو
  محفوظة مشفّرة عبر محوّل الحالة (`providerTokens.telegram`)؛ لا تُعاد في أي استجابة
  ولا تُسجَّل. `TELEGRAM_DEFAULT_CHAT_ID` اختياري لتنفيذ المهام المجدولة.
- منع التكرار: `update_id` و`externalId` (`tg:<chatId>:<messageId>`) محفوظان في
  `telegramUpdateIds` عبر `loadPersistentState`/`buildPersistedState`، فيصمدان بعد restart.
- إغلاق ثغرة: `POST /api/platforms/:platform/connection-callback` كان يقبل
  `providerVerified:true` من الجسم (اتصال وهمي). الآن يثبت الاتصال بطلب مزود فعلي
  (`verifyProviderConnection`) ولا يقبله من تصريح العميل.
- اختبارات: `engine/tests/telegram.connector.test.ts` (وحدة + تكامل مع خادم
  Telegram وهمي محلي عبر `TELEGRAM_API_BASE`، بلا مزود أو حصة)، وثبات السوشيال صار
  يقيس المسار الحقيقي. فحوص final-audit السبعة الخاصة بـ`telegram-*`.

## إصلاح مرونة Gemini — 503 «high demand» ليس عطل مزود (صُحّح 2026-09-23)
الفحص الحي أثبت أن 503 الحالي **خاص بالموديل لا بالمفتاح ولا بالكود**: في اللحظة
نفسها كان `gemini-3.8-flash` و`3.7-flash` و`3.5-flash` يعيدون
`503 UNAVAILABLE — This model is currently experiencing high demand`، بينما
`gemini-3.6-flash` و`gemini-3.5-flash-lite` يعيدان `200` بنص صحيح. المفتاح صالح
(53 حرفاً)، و`gemini-3.8-flash` موجود فعلاً في `models.list` للحساب وGA منذ
2026-09-02 — فلا علاقة للمفتاح ولا للمعرّف بالعطل.

الجذر الحقيقي كان في **مسار التحقق الإداري** `POST /api/ai/verify-provider`:
كان يجرّب **موديل الإنتاج وحده بلا تجاوز**، فيفشل بـ503 ويُعلن
`verifiedLive=false` بينما **المحرك وقت التشغيل** كان ينجح فعلاً لأنه يتجاوز
للمرشحات (failover). تناقض صريح: النظام يعمل والمؤشر يقول معطّل.

الإصلاح:
- مسار التحقق صار يجرّب **موديل الإنتاج أولاً ثم مرشحات GA بالترتيب** بمهلة
  موحّدة واحدة (`LIVE_VERIFY_TIMEOUT_MS`)، مطابقاً لسلوك المحرك. خطأ المصادقة/
  الطلب يُوقف التجاوز فوراً (يؤثر على كل الموديلات)، أما 503/404 فينتقل للشقيق.
- **بلا نجاح وهمي**: الاستجابة تحمل `model` = الموديل المخدوم فعلاً،
  و`productionModel`، و`usedProduction`، و`attempted[]` بفئات أخطاء كل مرشح.
  عند النجاح بشقيق يظهر في الصحة والواجهة: «الموديل الإنتاجي تحت ضغط مؤقت،
  والنموذج العامل حالياً: …».
- `DEFAULT_MODEL_CANDIDATES` أضاف `gemini-3.5-flash-lite` كاحتياطي GA أخير أخف
  وأقل عرضة لضغط عائلة Flash (أُثبت حياً أنه ينجح وقت ضغطها).
- الحمايات كلها باقية: حارس الحصة اليومي، الـcache، in-flight dedup، البديل
  الحتمي، وقاطع الدائرة. لم يُزل أي شيء لنجاح الاختبار.
- فحوص: `engine/tests/gemini.verification.test.ts` (62 فحصاً) و`final-audit.mjs`
  (`gemini-verify-failover`، `gemini-verify-honest-model`، `gemini-lite-fallback-candidate`).

**القاعدة:** HTTP 200 لا يعني نجاح Gemini؛ الحكم من `verified` + `usedProduction`
+ الموديل المخدوم، مع بقاء `fallbackReason` صريحاً عند البديل.

## أساس تكامل المنصات المتعدد — Batch 6 (2026-09-23)

بناء أساس موحّد حقيقي للمنصات العشر بلا أي ادعاء اتصال غير مثبت. الفصل الصريح:
**Capability ≠ Connection ≠ Verification ≠ Delivery** يبقى قائماً في كل الوحدات الجديدة.

وحدات جديدة (منطق خالص قابل للاختبار، بلا شبكة):
- `engine/social/readiness.ts`: **مصفوفة الجاهزية** مشتقة من `PLATFORM_SPECS` مباشرة
  (connector/oauth/connection/verification/webhook/read/reply/publish/schedule/analytics
  + `externalSetup` + `implementationStatus`). لا تحمل حالة اتصال تشغيلية؛ «متصل»
  يُقرأ من الخادم منفصلاً. `READY` / `EXTERNAL_SETUP_REQUIRED` / `NOT_SUPPORTED`.
- `engine/social/oauth.ts`: أساس OAuth مشترك — `createOAuthState`، `createPkcePair`،
  `validateOAuthCallback` (منصة + مستخدم + redirect + انتهاء)، `buildAuthorizationParams`
  (فرق TikTok client_key عن Google/Meta client_id + offline/consent)، `parseTokenResponse`،
  `isAccessTokenExpired` بهامش أمان. state يُستهلك مرة واحدة فقط.
- `engine/social/webhook.ts`: أساس webhook موحّد — `secretHeaderVerifier` (نمط Telegram)
  و`hmacSignatureVerifier` (نمط Meta `X-Hub-Signature-256`)، `isReplayOrDuplicate`،
  `isValidWebhookPayload`، `buildNormalizedEvent` (حدث اجتماعي داخلي واحد).
- `engine/social/analytics.ts`: غلاف موحّد `fetchPostMetrics/fetchAccountMetrics/fetchEngagement`
  يعيد `NOT_SUPPORTED` بلا قيمة عند غياب المؤشر — **لا صفر وهمي**، والصفر الحقيقي يبقى صفراً.

مسارات الخادم الجديدة:
- `GET /api/platforms/readiness-matrix` و`GET /api/platforms/:platform/readiness` (محمية).
- `GET /api/platforms/:platform/webhook` (challenge اشتراك، مقارنة بزمن ثابت) و
  `POST /api/platforms/:platform/webhook` (تحقق HMAC على **الجسم الخام** عبر `req.rawBody`،
  تطبيع Meta comments/messaging/WhatsApp، منع تكرار، تصنيف، حفظ).
- `POST /api/platforms/:platform/publish` (owner): قدرة → سلامة محتوى → اتصال موثق →
  موصل حقيقي. يُعلن `CAPABILITY_NOT_SUPPORTED` / `APPROVAL_REQUIRED` / `NOT_CONNECTED` /
  `EXTERNAL_SETUP_REQUIRED` بصراحة، ولا يُسجّل نشراً بلا معرّف منشور من المزود.
- `GET /api/platforms/:platform/metrics` (محمية): مؤشرات NOT_SUPPORTED بلا اختراع.

`OAUTH_CONFIG` صار يغطي كل منصات OAuth الثماني (youtube/google_business/tiktok/facebook/
instagram/x/snapchat/threads) ببيانات من **البيئة فقط** (`*_OAUTH_CLIENT_ID/SECRET`,
`*_APP_SECRET`, `*_VERIFY_TOKEN`) — لا سرّ مكتوب في الكود ولا يُعاد في أي استجابة.
WhatsApp يستخدم Cloud API token وليس OAuth، وTelegram bot token، فيظهران
`oauth: NOT_SUPPORTED` صراحةً.

واجهة: قسم «مصفوفة جاهزية المنصات العشر» في `SocialManagerView` يعرض الحالة لكل قدرة.
اختبارات: `engine/tests/platform.foundation.test.ts` (71 فحصاً، وحدة) و
`engine/tests/platform.integration.test.ts` (33 فحصاً، خادم حقيقي + webhook موقّع + نشر
موحّد + تصريح). فحوص final-audit: `platform-readiness-matrix`, `readiness-reflects-registry`,
`platform-oauth-foundation`, `oauth-state-single-use`, `platform-webhook-foundation`,
`webhook-hmac-raw-body`, `webhook-replay-guard`, `unified-publish-capability`,
`analytics-not-supported-honest`, `platform-foundation-tests`, `oauth-config-all-providers`,
`platform-secrets-server-only` (94 فحصاً إجمالاً).

**حالة التكامل الفعلية:** Telegram هو الموصل الوحيد المنفّذ (CONNECTOR_READY). بقية المنصات
أساسها جاهز (FOUNDATION_READY) وتنتظر إجراءً خارجياً (تطبيق مطوّر/مراجعة/صلاحيات/Redirect URI).

## طبقة التحكم التشغيلي ومركز ربط المنصات — Batch 7 (2026-09-23)

نقل المشروع من «أساس تكامل» إلى **Social Operations Control Plane**: طبقة موحّدة تعرف
وتدير دورة كل منصة كاملة، مع فصل صريح للحالات وتسلسل بوابات ملزم.

**فصل الحالات الملزم (لا خلط):**
`CODE_READY` (منفّذ بالكود) ≠ `EXTERNAL_SETUP_REQUIRED` ≠ `CONFIGURED` (الاعتماد حاضر)
≠ `CONNECTED` (اتصال قائم) ≠ `VERIFIED` (أثبته المزود) ≠ `OPERATIONAL` (تشغيل حقيقي مثبت)
≠ `NOT_SUPPORTED` / `FAILED` / `DISCONNECTED`. **لا يُعلن OPERATIONAL إلا باتصال موثق
وموصل منفّذ** (`providerVerified === true && realConnector`).

**تسلسل بوابات كل عملية:** Capability → Connection → Verification → Safety/Approval →
Provider Operation. التصنيف حتمي محلي (متاح دائماً، لا حصة ولا اتصال).

وحدات جديدة (منطق خالص قابل للاختبار):
- `engine/social/credentials.ts`: كشف إعداد الاعتماد لكل منصة/غرض (اتصال/webhook/نشر)
  **بأسماء متغيرات البيئة فقط** — لا يُعاد أي قيمة أبداً. يدعم بدائل (Instagram يرث
  بيانات Facebook). `inspectPlatformCredentials`, `needsExternalCredentials`, `CREDENTIAL_SPECS`.
- `engine/social/operations.ts`: طبقة التحكم — `computePlatformStatus` يحسب الحالة الدقيقة
  من (جاهزية الكود + الاعتماد + الاتصال الحي)، وينتج `blockingReason` و`nextAction` وبوابات
  العمليات الثماني. `buildReadinessDetails` يبني صفوف مركز الربط الغنية (levels للكود +
  `operational` للحالة الآن + `operationalState` + `credentials` + `webhookCredentials`).
  `computeAllPlatformStatuses` و`controlSummary`.

مسارات الخادم الجديدة (محمية):
- `GET /api/platforms/control-plane`: حالة كل منصة + بوابات العمليات الثماني + الملخص.
- `GET /api/platforms/:platform/control`: منصة واحدة + أسماء الاعتماد المطلوبة.
- `GET /api/platforms/external-setup`: خطوات الإعداد الخارجي وأسماء المتغيرات (بلا أسرار).
- `GET /api/platforms/readiness-matrix`: أُثرِي بحقول `operational`/`operationalState`/
  `blockingReason`/`nextAction`/`credentials` مع الحفاظ على حقل `connection` السابق.

واجهة: `src/components/social/PlatformConnectionCenter.tsx` — **مركز ربط المنصات** (تبويب
`platform_connections` في Sidebar، للمالك): يعرض لكل منصة حالتها الدقيقة، ما ينقص، الإجراء
التالي، بوابات العمليات، وخطوات الإعداد الخارجي. الأزرار مرتبطة بالحالة الحقيقية: «بدء الربط»
يظهر فقط حين يكون المسار جاهزاً، و«إكمال الإعداد الخارجي» حين يلزم إجراء من المزود، و«فصل»
حين تكون متصلة.

اختبارات: `engine/tests/platform.operations.test.ts` (48 فحصاً وحدة: فصل الحالات، بوابات
العمليات، نقاء الاعتماد، لا OPERATIONAL بلا توثيق) و`engine/tests/platform.control.integration.test.ts`
(30 فحصاً خادم حقيقي: تصريح 401، الحالات، الإعداد الخارجي بلا أسرار). final-audit: 103 فحصاً
(`operations-control-plane`, `credentials-introspection`, `state-separation-explicit`,
`no-operational-without-verify`, `control-plane-endpoints`, `readiness-matrix-enriched`,
`external-setup-names-only`, `connection-center-ui`, `control-plane-tests`).

**حالة المنصات التشغيلية الآن:** Telegram فقط يمكن أن يبلغ OPERATIONAL (موصل منفّذ)؛ بقية
المنصات `EXTERNAL_SETUP_REQUIRED` (يلزم تطبيق مطوّر/مراجعة/صلاحيات/Redirect لدى المزود).
لا تُنشئ المنصة أي حساب أو اتصال نيابة عن المالك، ولا تعرض أي سرّ.

## تعريف مفتاح تشفير التوكنات — مصدر واحد (صُحّح 2026-09-24)
كان `tokenKeyBytes()` في `server.ts` يفكّ Base64 بتسامح (`Buffer.from(v,"base64")`) ثم
يسقط أي نتيجة ليست 32 بايت بصمت، فتُعرض «غير مضبوط أو غير صالح (يلزم 32 بايت)» رغم أن
`PLATFORM_TOKEN_ENCRYPTION_KEY` موجود في Render. وفي الوقت نفسه `credentials.ts`/`readiness`
كانا يفحصان **وجود الاسم فقط** فيُعلنان «مضبوط» لنفس القيمة => تضارب بين اللوحة والعمل الفعلي.

الإصلاح (بلا أي fallback غير آمن ولا مفتاح في الكود):
- `engine/social/tokenKey.ts` هو **المصدر الوحيد**: `decodeTokenKey` و`inspectTokenKey`
  و`inspectTokenKeyFromEnv` و`isTokenKeyValid` و`TOKEN_KEY_ENV_NAME` و`TOKEN_KEY_BYTES`.
- الصيغ المقبولة حصراً: **64 محرفاً hex** أو **Base64/Base64url يمثّل 32 بايت بالضبط**.
  يُرفض أي تمثيل ملتبس: 32 محرفاً ASCII (تفكّ إلى 24 بايت)، Base64 لبيانات غير 32 بايت،
  محارف غريبة، أو علامات تنصيب/تنصيص (لا اعتماد على تسامح مكتبة Base64).
- `server.ts` صار يفكّ عبر `decodeTokenKey`، و`tokenKeyBytes()` تقرأ البيئة عند كل استخدام
  (لا تُلتقط وقت الإقلاع). `encryptSecret` ورسائل 503 تستخدم `inspectTokenKeyFromEnv().reason`
  التي تفرّق **missing** عن **invalid**.
- `credentials.ts` يستخدم `isTokenKeyValid` لمفتاح التشفير ويضيف قائمة `invalid` مستقلة عن
  `missing`، ويُعلن `configured=false` عند أي منهما. `operations.ts` يبني رسالة الحجب
  والإجراء التالي عبر `describeCredentialGap` فيقول صراحةً «مضبوط لكن غير صالح» بدل «ناقص».
- `/api/health` و`/api/readiness` يعرضان كتلة `platformTokenKey`
  (`state`/`envName`/`acceptedBytes`/`reason`) بلا أي قيمة سرّية، فيراه المالك مباشرة.
- التوجيه الآمن: استخدم ناتج `node scripts/generate-secrets.mjs` (Base64 لـ32 بايت) أو
  `openssl rand -hex 32`؛ كلاهما مقبول. لا تغيّر السر لمجرد اختلاف الصيغة إذا كان صالحاً.

اختبار: `engine/tests/token.key.test.ts` (`npm run test:token-key`، 32 فحصاً) يثبّت قبول
hex وBase64، ورفض 32 محرفاً لا تمثّل 32 بايت، وتمييز missing من invalid في الحالة والرسائل
وفي الحجب وفي credentials. فحوص final-audit: `token-key-single-source`,
`token-key-server-uses-single-source`, `token-key-credentials-real-validation`,
`token-key-missing-vs-invalid`, `token-key-health-exposes-state`,
`token-key-no-insecure-fallback`, `token-key-regression-test`.

## إثبات مسار Telegram Webhook الحقيقي — إصلاح جذري (2026-09-24)

الفجوة لم تكن في Render ولا في Telegram. المسار (`/api/platforms/telegram/webhook`)
كان يعمل: التحقق من الترويسة السرّية يرد 401 صريحاً قبل أي معالجة، وترتيب middleware
سليم (لا auth على الـwebhook، والـwebhook يستخدم ترويسة Telegram السرّية فقط). لكن كان
يوجد ثلاث فجوات حقيقية تمنع إثبات الاستقبال أو تسبّب فشله صامتاً:

1. **تدوير السرّ عند إعادة الضبط**: `configure` كان يولّد سرّاً عشوائياً جديداً في كل
   نداء عند غياب السرّ من الجسم/البيئة، ثم يستدعي `setWebhook` **قبل** حفظ الاعتماد.
   لو فشل الحفظ (كما كان يحدث سابقاً بمفتاح تشفير غير صالح) لبقيت لدى Telegram قيمة سرّ
   لا يعرفها الخادم، فتُرفض كل التحديثات بعدها بـ401 بلا سبب ظاهر. الإصلاح:
   - `const secret = webhookSecret || crypto.randomBytes(...)` حيث `webhookSecret` يُبنى من
     `telegramWebhookSecret()` (المحفوظ مشفّراً) ثم `TELEGRAM_WEBHOOK_SECRET_ENV`، **فلا
     يُدوَّر سرّ قائم أبداً**.
   - `saveTelegramCredentials(botToken, secret, telegramWebhookUrl())` يُنفَّذ **قبل**
     `setWebhook`، فلا ينفصل السرّ المسجّل عن السرّ المتحقَّق منه.
2. **عدم إثبات التسجيل**: كان `configure` يثق برد `setWebhook` فقط. الآن يستدعي
   `getWebhookInfo()` فعلياً ويقيّم التسجيل عبر `checkWebhookRegistration` مقابل
   `telegramWebhookUrl()`، فتظهر حالات صريحة: `registered` / `url_mismatch` /
   `not_registered` / `secret_missing` / `unavailable`. ويُحفظ الرابط المسجّل
   (`webhookUrl`) ووقته داخل `providerTokens.telegram` المشفّر.
3. **الكتابة fire-and-forget قبل الإقرار**: الـwebhook كان يستدعي `persistState()` ثم
   يرد 200 فوراً؛ على Render قد تُعلَّق العملية بعد الرد فيُفقد التعليق ومعرّف التحديث
   (فسقوط حماية التكرار). الآن `await persistStateDurable()` **قبل** إرجاع 200، والرد
   يحمل `persisted` صريحاً.

إضافات:
- `engine/social/telegram.ts`: `getWebhookInfo()` + `sanitizeWebhookInfo()` (يحذف أي حقل
  غير آمن — لا رمز ولا سرّ) + `checkWebhookRegistration()` (منطق خالص قابل للاختبار).
- `GET /api/platforms/telegram/webhook-info` (**للمالك فقط**): يعيد الرابط المسجّل،
  التحديثات المعلّقة، آخر خطأ دفع، مصدر السرّ (stored/env/none)، ومطابقة الرابط —
  بلا أي سرّ.
- سجل آمن `logTelegramWebhook`: `outcome=accepted|duplicate|rejected|ignored` مع
  `update_id`/`external`/`persisted` فقط. **ممنوع** تسجيل الرمز أو الترويسة أو نص الرسالة.
- واجهة: لوحة «حالة استقبال Telegram (getWebhookInfo)» في `SocialManagerView` +
  `apiService.getTelegramWebhookInfo()`. لا يُعتبر الاستقبال فعّالاً بمجرد ظهور الزر أخضر،
  بل بحالة `registered` المطابقة.

اختبار `engine/tests/telegram.connector.test.ts` صار **76 فحصاً**: وحدة لتنقية
getWebhookInfo وتقييم التسجيل، وتكامل لإثبات getMe+setWebhook+getWebhookInfo، وعدم تدوير
السرّ عند إعادة الضبط، وإثبات التسجيل، وثبات التعليق وهدف الرد وحماية التكرار **بعد
restart فعلي** (إعادة تشغيل العملية بنفس مجلد الحالة). فحوص final-audit الجديدة:
`telegram-webhook-info-endpoint`, `telegram-getwebhookinfo-real`,
`telegram-webhook-info-no-secret`, `telegram-secret-not-rotated`,
`telegram-credentials-persisted-before-hook`, `telegram-inbound-durable-before-ack`,
`telegram-inbound-safe-logging`, `telegram-webhook-info-test`, `telegram-ui-webhook-status`.

## فصل «الرسالة» عن «التعليق» في الرد — إصلاح جذر «Telegram لا تدعم الرد» (2026-09-24)
كانت الواجهة تمنع إرسال أي رد على رسالة Telegram الواردة وتعرض «المنصة Telegram لا تدعم
الرد على التعليقات…»، لأن `SocialHubView` كان يمرّر كل الردود عبر مسار التعليقات العام
`/api/social/manager/comments/reply`، وTelegram لا يعلن `comment_reply` (لا تعليقات عامة
عبر Bot API). التشخيص كان صحيحاً للمفهوم لكنه خاطئ للسياق: رسالة Telegram ليست تعليقاً عاماً.

الإصلاح — **فصل مفهوم صريح**:
- قدرة جديدة `message_reply` في `engine/social/adapter.ts`، منفصلة تماماً عن `comment_reply`.
- `engine/social/registry.ts`: Telegram/WhatsApp يعلنان `message_reply` (لا `comment_reply`)؛
  Facebook/Instagram يعلنان الاثنين معاً (رسائل + تعليقات).
- `readiness.ts` و`operations.ts` يقرآن `message_reply` لبوابة الرد بدل `messages`، فيصبح
  رد الرسائل عملية مستقلة قابلة للبوابة.
- `engine/social/routes.ts` (مسار التعليقات العام): منصة رسائلية لها موصل حقيقي (Telegram)
  تعيد **409** مع `code: MESSAGE_PLATFORM_NOT_COMMENT` و`replyRoute` يوجّه لمسار الرسائل
  الحقيقي، بدل **501** المضلل. المنصة بلا موصل فعلي تبقى 501 كما كانت.
- `SocialHubView` `recordReply`: إن كانت المنصة Telegram والسجل يحمل `replyTarget.chatId`
  يُرسل الرد فعلياً عبر `apiService.replyTelegram` → `POST /api/platforms/telegram/reply`
  (sendMessage حقيقي باستخدام `replyToMessageId`). غير ذلك يسلك مسار التعليقات كما كان.

**فصل حالة الاستقبال عن حالة التسليم في الواجهة**: الرسالة الواردة عبر webhook تُعرض بوسم
«مستلمة فعلياً» (مبنياً على `ingestSource === 'telegram_webhook'`)، ووسم `simulated / not delivered`
لا يظهر إلا للردود المسجّلة داخلياً (`!reply.delivered`). الرد الحقيقي يظهر «الرد المُسلَّم فعلياً»
مع معرّف رسالة المزود `providerReplyId`. لوحة Telegram في `SocialManagerView` تعرض الرسائل
الواردة الحقيقية (`getSocialComments('telegram')`) وتسمح باختيار هدف الرد من قائمة.

لا تغيير في: `PLATFORM_TOKEN_ENCRYPTION_KEY`، Gemini، webhook secret، معمارية webhook،
`TELEGRAM_DEFAULT_CHAT_ID`، PostgreSQL، أو أي منصة أخرى. لا تدوير لأي سرّ.

اختبارات: `telegram.connector.test.ts` صار **83 فحصاً** (توجيه message_reply، فشل sendMessage
لا يُسجَّل تسليماً مع `deliveryError`/`reviewStatus=failed`، منع الرد على رسالة حساب المعرض،
self-authored). `social.ui.claims.test.ts` صار **46 فحصاً** (توجيه الواجهة، فصل الاستقبال عن
التسليم، القدرة الجديدة). فحوص final-audit: `capability-message-reply-explicit`,
`telegram-message-not-comment-reply`, `reply-route-message-platform-redirect`,
`telegram-ui-routes-message-reply`, `incoming-vs-delivery-separated`,
`telegram-reply-delivery-honest`, `telegram-message-reply-tests`.

## موصل Facebook الحقيقي (Facebook Pages) — Batch 8 (2026-09-24)

Facebook صار **ثاني موصل اجتماعي حقيقي منفّذ** بعد Telegram (`engine/social/facebook.ts`)،
مع الفصل الصريح نفسه: `Capability ≠ Connection ≠ Verification ≠ Delivery`.

- **الربط خاص بصفحات Facebook لا بالحساب الشخصي.** التدفق: `GET /api/platforms/facebook/oauth/start`
  (state محمي عبر `createOAuthState`) → موافقة المالك لدى Meta → `oauth/callback` →
  `listManagedPages` (GET `/me/accounts`) → `GET /api/platforms/facebook/pages` →
  `POST /api/platforms/facebook/select-page` (إثبات الصفحة فعلياً + تبادل رمز طويل الأجل
  `fb_exchange_token` + اشتراك `{page}/subscribed_apps`). لا يُعلن الاتصال إلا بعد إثبات Meta.
- **Webhook حقيقي**: `GET /api/platforms/:platform/webhook` يتحقق من `hub.challenge`
  بمقارنة `FACEBOOK_VERIFY_TOKEN` بزمن ثابت؛ `POST` يتحقق من توقيع `X-Hub-Signature-256`
  (HMAC sha256 على **الجسم الخام** عبر `req.rawBody`) ويرفض 401 عند غياب/فساد التوقيع.
- **تطبيع صريح**: `parseFacebookWebhook` يميّز `comment` (feed changes) عن `message`
  (messaging) ويعيد أي شكل غير معروف في `ignored` بدل اعتباره تعليقاً/رسالة.
- **منع التكرار يصمد**: معرّفات الأحداث تُخزَّن في `facebookEventIds` (داخل `workspace`)
  وتُحفظ في طرفَي الحفظ، فلا يُنشئ إعادة إرسال Meta سجلاً ثانياً حتى بعد restart.
- **الكتابة قبل الإقرار**: مسار الاستقبال ينتظر `persistStateDurable()` قبل `res.status(200)`،
  والرد يحمل `persisted` صريحاً.
- **الرد الحقيقي عبر مسارين منفصلين**: `POST /api/platforms/facebook/reply` (comment →
  `{comment-id}/comments`) و`POST /api/platforms/facebook/message-reply` (message →
  `{page-id}/messages`). كلاهما يمر بحارس سلامة المحتوى (422) وبوابة منع الرد المكرر،
  ولا يُسجَّل `delivered=true` بلا `providerCommentId`/`providerMessageId` من Meta.
- **المسار العام يوجّه**: `/api/social/manager/comments/reply` و`.../publish/execute`
  يعيدان `409` مع `code: PLATFORM_USE_DEDICATED_REPLY` / `PLATFORM_USE_DEDICATED_PUBLISH`
  لمنصات الموصل الحقيقي بدل تسجيل محاكاة داخلية.
- **الأسرار من البيئة فقط**: `FACEBOOK_OAUTH_CLIENT_ID/SECRET`، `FACEBOOK_APP_SECRET`،
  `FACEBOOK_VERIFY_TOKEN` (واختياري `FACEBOOK_GRAPH_VERSION`/`FACEBOOK_SUBSCRIBED_FIELDS`).
  لا تُسجَّل ولا تُعاد في أي استجابة؛ صفحة التوكن تُحفظ مشفّرة عبر `providerTokens.facebook`.
- **الواجهة**: `GET /api/platforms/facebook/webhook-info` يعرض اشتراك الصفحة وضبط رمز
  التحقق وسرّ التوقيع ورابط الـwebhook (حقيقي من Meta بلا سرّ). لوحة Facebook في
  `SocialManagerView` تفصل comment_reply عن message_reply، و`PlatformConnectionCenter`
  يوفّر اختيار الصفحة وحالة الاشتراك.
- **الجاهزية**: `readiness.ts` يعلن Facebook `CONNECTOR_READY` وwebhook `READY`؛
  `operations.ts` لا يعلن `OPERATIONAL` إلا باتصال موثق + موصل منفّذ.

اختبارات: `engine/tests/facebook.connector.test.ts` (`npm run test:facebook`، 73 فحصاً) مع
`engine/tests/helpers/facebookMock.ts` (خادم Meta وهمي محلي عبر `FACEBOOK_GRAPH_API_BASE`).
فحوص final-audit: `facebook-connector-module` … `facebook-ui-connection`.

**حالة التكامل الفعلية:** Telegram (bot-token) وFacebook (OAuth صفحة) هما الموصلان الحقيقيان؛
بقية المنصات `FOUNDATION_READY` وتنتظر إجراءً خارجياً من المزود.

## إصلاح جذر التحقق من توقيع webhook — الجسم الخام (2026-09-24)
كان `captureRawBody` (وسيط JSON ثانٍ) يوضع على المسار فقط، لكن `app.use(express.json(...))`
العام (أول الملف) يقرأ تدفق الطلب ويستهلكه قبل أن يصل الوسيط الثاني، فيبقى `req.rawBody`
غير معرّف **دائماً** في الإنتاج (لا في الاختبار، لأن الاختبار يبني الجسم عبر `JSON.stringify`
فيتطابق البديل). النتيجة: التحقق من HMAC كان يسقط إلى `JSON.stringify(req.body)` — وهو
هشّ لأن Meta لا يضمن أن تنسيقه (مسافات/أسطر/ترتيب مفاتيح) يطابق إعادة تسلسل Node، فيرفض
webhook حقيقي بـ401 بلا سبب ظاهر.

الإصلاح:
- `req.rawBody` يُلتقط الآن في **وسيط JSON العام الأول** عبر `verify`، فهو الذي يقرأ التدفق
  الوحيد فعلاً. `captureRawBody` أُزيل واستُبدل بـ`requireRawBody` الذي يرفض صراحةً (400)
  إن غاب الجسم الخام بدل التحقق على جسم مُعاد تسلسله — فلا يمكن تجاوز التحقق أبداً.
- مسارا webhook (Facebook الخاص والموحّد) يستخدمان `String(req.rawBody ?? "")` حصراً.
- `FACEBOOK_SUBSCRIBED_FIELDS` صار محترماً فعلاً (كان موثّقاً لكن مُهملاً) مع بقاء
  `feed,messages` افتراضاً.
- اختبار `facebook.connector.test.ts` صار **76 فحصاً**: أُضيف فحص الجسم الخام غير المضغوط
  (مسافات/أسطر) الذي كان يفشل قبل الإصلاح، وفحص أن إعادة التسلسل لا تخلق حدثاً ثانياً.
- نطاقات منافذ اختبار Facebook نُقلت إلى `6700/6800` لتجنّب المنفذ المحظور 6000 في
  `fetch` (كان يسبب فشلاً عشوائياً ~1/120 في `npm test`).

## النشر متعدد المنصات + تقسيم العقل المركزي/العقول الستة (دفعة على فرع منفصل)

دفعة تفتح صلاحيات محدودة للعقول الستة وتضيف نشراً متعدد المنصات بنقرة واحدة. **على فرع
`feat/multiplatform-publish-six-agent-lifecycle`** (من main)، بلا دمج/نشر قبل إذن المالك.

- **استلام الفيديو:** بلا أي معالجة AI على الفيديو؛ مسار الرفع القائم فقط (`contentMedia` +
  `validateMediaBytes`).
- **منفّذ نشر مشترك واحد:** `executePlatformPublish(platform, body, actor)` في `server.ts`
  يحوي منطق facebook/instagram/tiktok/telegram/youtube حرفياً، ويُستدعى من المسار المفرد
  `POST /api/platforms/:platform/publish` ومن مسار التوزيع. **لا مسار نشر ثانٍ.**
- **النشر متعدد المنصات:** `POST /api/workspace/content/:id/publish` (**requireOwner**)
  يفرض `post.status === "approved"`، ثم `Promise.allSettled` على `post.targetPlatforms`،
  ويخزّن حالة مستقلة لكل منصة في `post.platformPublishResults` (`published` فقط بمعرّف
  مزود حقيقي). يبدأ فقط بنقرة إنسان — لا نشر تلقائي.
- **الواجهة:** `ContentEngineView` اختيار متعدد (checkboxes) على `selectedPlatforms`؛
  `ApprovalWorkflowView` زر «نشر الآن» يستدعي `apiService.publishWorkspaceContentMultiPlatform`
  ويعرض حالة كل منصة.

**إرفاق الفيديو داخل `ContentEngineView` (بدل عزله في «مدير تشغيل YouTube» فقط):**
طلب مالك صريح — كان رفع الفيديو موجوداً فقط في `YouTubeContentQueuePanel` (داخل شاشة
منفصلة)، فلم تكن شاشة توليد المحتوى الموحّدة تعرض أي حقل رفع. أُضيف حقل رفع فيديو إلى
`ContentEngineView.tsx` نفسه (نفس قيود `YouTubeContentQueuePanel`: MP4/WebM/MOV/MKV/AVI،
حتى 12MB، تحويل base64 محلي في المتصفح — لا تغيير خلفي). **لا ادّعاء دعم موحَّد وهمي**:
الواجهة تعرض صراحةً قدرة كل منصة محدّدة:
- يوتيوب فقط يقبل رفعاً حقيقياً اليوم → عند الإرسال، الفيديو يذهب لنفس طابور مراجعة
  يوتيوب الحقيقي (`apiService.createYouTubeContentDraft` → `/api/platforms/youtube/content/drafts`)
  **قبل** إنشاء المنشور النصي العام؛ فشل الإرسال الفعلي يوقف العملية بخطأ واضح (لا نجاح
  وهمي) ولا يُنشأ منشور بصمت عن الفشل.
- إنستغرام/تيك توك: الباكند هنا يقبل `videoUrl` عاماً فقط (سحب، ليس رفعاً مباشراً —
  Instagram Graph API وTikTok `PULL_FROM_URL` حسب `engine/social/instagram.ts`/`tiktok.ts`؛
  لا مسار `FILE_UPLOAD` مفعّل في `executePlatformPublish` اليوم). الواجهة تعرض حقل رابط
  فيديو عام اختيارياً، وتوضّح أنه مطلوب فعلياً وقت النشر لا وقت الإنشاء.
- فيسبوك/تيليغرام: **لا يوجد كود رفع/إرسال فيديو إطلاقاً** في `engine/social/facebook.ts`/
  `telegram.ts` أو في `executePlatformPublish` — الواجهة تُعلن ذلك صراحةً بدل الصمت.
  بناء دعم فيديو حقيقي لهما (Graph API `/videos`، Telegram `sendVideo`) أو استضافة تلقائية
  لإنستغرام/تيك توك (مثلاً عبر Drive) **لم يُنفَّذ بعد** — يحتاج قراراً معمارياً من المالك
  (الاستضافة العامة للفيديو لها تبعات خصوصية/تكلفة).

### تقسيم العمل (العقول الستة ↔ العقل المركزي)
وحدة المصدر الواحد `engine/brain/team/executionPolicy.ts`:
- `SIX_AGENT_ALLOWED_ACTIONS` = **4 أفعال حتمية فقط** بلا Gemini: `classify_tag_comment`،
  `update_engagement_counters`، `retry_failed_publish_once` (مرّة واحدة، منصة واحدة)،
  `reply_from_stored_pattern` (تطابق تام مع نمط محفوظ بثقة ≥ `SIX_AGENT_PATTERN_MIN_CONFIDENCE=0.85`).
- `evaluateSixAgentAction` يُعيد `ALLOW_DETERMINISTIC` / `ESCALATE_CENTRAL` /
  `REJECT_OUT_OF_WHITELIST`. أي غامض/سلبي/حساس/غير مطابق ⇒ **تصعيد للعقل المركزي وحده**
  (وهو الوحيد المخوَّل باستدعاء Gemini ضمن `GEMINI_DAILY_LIMIT` القائم، بلا تغيير).
- التنفيذ الفعلي في `engine/brain/team/deterministicActions.ts` يعيد استخدام المنفّذات
  الحقيقية القائمة (`executePlatformPublish`, `executeYouTubeReply`) عبر `sixAgentActionDeps()`
  المحقونة من `server.ts` — كل بوابات المشروع سارية داخلها.
- **مكافحة التسميم محفوظة:** `storedReplyPatternsForSixAgents` يقرأ من **نفس** `brainMemoryStore`
  (لا بنية موازية) ويقبل فقط سجلات نشطة غير متقادمة بثقة عالية وأصل غير `ai_statement`.
- **سجل التدقيق:** `engine/brain/team/auditLog.ts` + `sixAgentAuditState` محفوظ في
  `control.sixAgentAudit` عبر محوّل الحالة (يصمد بعد restart). مسارات owner:
  `GET /api/agent/team/six-agent/audit` و`POST /api/agent/team/six-agent/execute`.
- `/api/health.sixAgentExecution` و`/api/readiness.brain.sixAgentExecution` يعرضان
  (`allowedActions`, `executesExternalActions: "bounded"`, `geminiUsed: false` + ملخّص التدقيق)
  بلا أي سرّ.

اختبارات: `engine/tests/publish.multiplatform.test.ts` (`npm run test:multi-platform-publish`،
25 فحصاً) و`engine/tests/sixagent.execution.test.ts` (`npm run test:six-agent`، 41 فحصاً).
فحوص final-audit: `multi-platform-*`، `six-agent-*`، `memory-reuse-no-parallel-store`،
`diagrams-current-state`. المخططات في `docs/diagrams/` مُحدَّثة (الإصدار/الـcommit/المسار/التقسيم).
## حارس خصوصية النقطتين العامتين — مصدر واحد (2026-10-04)

`/api/health` و`/api/readiness` **عامتان بلا مصادقة** (لأدوات المراقبة مثل Render)، فلا
يجوز أن تحملا أي بيانات عميل: اسم حساب، نص تعليق، أو نص رد. كان التسريب (attentionRequired/
lastReply.replyText) قد أُزيل في commit سابق، وأُضيف الآن **حارس مصدر-واحد** يمنع رجوعه:

- `engine/social/healthPrivacy.ts` هو **المصدر الواحد**: قائمة الحقول الممنوعة
  (`PUBLIC_ENDPOINT_FORBIDDEN_CUSTOMER_FIELDS`)، allow-list الكتلة العامة youtubeWatcher
  (`PUBLIC_WATCHER_ALLOWED_KEYS`)، الحقول التشغيلية التفصيلية الممنوعة، ودوال
  `sanitizePublicHealthPayload`/`findForbiddenPublicKeys`/`findDisallowedWatcherPublicKeys`.
- `server.ts`: وسيط `installPublicHealthGuard(res)` على النقطتين يمرّر الحمولة كاملة عبر
  `sanitizePublicHealthPayload` **قبل الإرسال**، ويسجّل أي انحراف (أسماء حقول فقط، بلا محتوى)
  فلا يمرّ تسرّب صامت. الحقول التقنية فقط تبقى: `status`، `deploy.commit`، `watcherActive`،
  `pollCount`، `lastError` (كرمز تقني ASCII أو `connection error` — لا محتوى محادثة).
- البيانات التفصيلية (attentionRequired/lastReply) **لم تُحذف**؛ تبقى للمالك عبر
  `/api/agent/youtube/watcher` (requireOwner)، وتستهلكها الواجهة من هناك لا من الصحة العامة.
- اختبارات: `engine/tests/health.privacy.test.ts` (45 فحصاً، canary حي عبر خادم فعلي،
  يقرأ قوائم المصدر الواحد) و`engine/tests/health.guard.test.ts` (23 فحصاً وحدة للحارس).
  فحوص final-audit: `public-health-privacy-single-source` … `public-health-guard-test-exists`.

## نمط الكود
- تعليقات عربية موجزة تشرح «لماذا» فقط، دون شرح ما يفعله الكود.
- الأنواع في `src/types/index.ts` يجب أن تطابق استجابات الخادم فعلياً؛ توجد فحوص عقد في `engine/tests/social.routes.test.ts` تكشف أي انحراف.
- واجهة المستخدم عربية RTL بتصميم لوحة التحكم الحالي (`bg-slate-900 border-slate-800 rounded-2xl`)؛ لا تُعد التصميم من الصفر.

## اختيار صفحة Facebook بعد OAuth — إصلاح جذر «موصل حقيقي / غير متصلة» (2026-09-24)
كان OAuth يكتمل بنجاح، لكن على حساب يدير **أكثر من صفحة** كان callback يحفظ رمز
المستخدم وينتظر اختيار الصفحة **بلا أي وسيلة لاختيارها**:
- زر «بدء الربط» في `PlatformConnectionCenter` كان يظهر دائماً (بوابة connect
  `allowed=true` والحالة `CONFIGURED` لا `EXTERNAL_SETUP_REQUIRED`)، فيحجب فرع
  «اختيار الصفحة» الذي يظهر فقط عند تعذّر OAuth. الفرع كان **غير قابل للوصول رياضياً**
  لأن اختيار الصفحة يحتاج رمز مستخدم لا يوجد إلا بعد OAuth.
- النتيجة: يظن المالك أن الربط لم يبدأ فيعيد OAuth، وتبقى الصفحة غير متصلة للأبد.

الفصل المعتمد الآن: **`pendingPageSelection` ≠ فشل الربط**. نهاية OAuth بحالة انتظار
صراحةً، والدليل وجود `userAccessToken` بلا `pageId` مع العلَم. تُعلن في
`/api/platforms/control-plane` و`/:platform/control` و`/readiness-matrix` مع
`blockingReason`/`nextAction` صريحين، ويصبح «اختيار الصفحة» الإجراء الأول في
`PlatformConnectionCenter` و`SocialManagerView`. اختبار `facebook.connector.test.ts`
المجموعة **19** يغطي: OAuth متعدد الصفحات → pending → pages → select-page →
connected. فحوص final-audit: `facebook-page-selection-pending`,
`facebook-page-selection-reachable`, `facebook-multipage-test`.

**درس عام:** لا يكفي أن يكون إجراء موجوداً في الواجهة؛ يجب إثبات أن شرط ظهوره
قابل للتحقق فعلاً في الحالة التي يحتاجها، وإلا صار الكود موجوداً ومعطّلاً.

**نقطة توقف بشرية:** ما تبقى لإتمام Facebook COMPLETE هو تسجيل دخول/موافقة مالك
Facebook نفسه على شاشة Meta (OAuth consent + الصفحة). لا يمكن تنفيذ ذلك نيابةً عنه
من دون جلسته، ولا يوجد أي وكيل برمجي يمنح وصولاً لصفحته.

## مصدر واحد للعنوان العام — إصلاح «لا يمكن تحميل عنوان URL» (2026-09-24)
عند فشل OAuth الحقيقي كان redirect_uri يُبنى حرفياً من APP_URL وحدها:
`const BASE_URL = (process.env.APP_URL || http://localhost:${PORT})`. فإن غابت على
Render لصار الرابط `http://localhost/...` فيرفضه Meta برسالة «لا يمكن تحميل عنوان
URL / النطاق غير مُضمَّن في نطاقات التطبيق». والأسوأ: لم يكن الرابط الفعلي يُعرض
للمالك ليُسجّله لدى Meta، فيدور بلا نهاية على رسالة غامضة.

الإصلاح:
- `engine/social/publicUrl.ts` هو **المصدر الوحيد** لحسم العنوان العام:
  APP_URL → PUBLIC_URL → RENDER_EXTERNAL_URL → RENDER_EXTERNAL_HOSTNAME → VERCEL_URL
  → ترويسات الوسيط (X-Forwarded-Host/Proto/Host) → localhost للتطوير.
  يُقرأ عند كل استخدام لا وقت الإقلاع. **لا رجوع صامت**: إن كان أعلى مرشّح موجوداً
  لكنه غير صالح (http على نطاق عام، أو بمسار/استعلام) يُعلن `valid=false` مع
  `problems` ولا يُستبدل بعنوان أدنى لا يعرفه المزود (لئلا يُخفى سبب الفشل).
- `server.ts`: `oauthCallbackUrl()` و`telegramWebhookUrl()`/`facebookWebhookUrl()`
  تُبنى كلها من العنوان المعتمد. `oauthReady` و`facebookConnectorConfigured` يشترطان
  `resolvePublicUrl().valid`. بدء OAuth يُعيد `domainWarning` صريحاً (بلا حجب لئلا
  ينكسر التطوير المحلي) يحمل redirect_uri والنطاق الفعليين.
- `GET /api/platforms/:platform/oauth/setup` (**للمالك**): يعرض redirect_uri الدقيق،
  قيمة App Domains المقترحة، رابط webhook، وحقول Meta Dashboard — بلا أي سرّ.
  `/api/health` يعرض كتلة `publicUrl` (`baseUrl`/`host`/`scheme`/`source`/`valid`/
  `isPublic`/`problems`/`candidates`).
- الواجهة: `OAuthSetupPanel` في `PlatformConnectionCenter` ولوحة في `SocialManagerView`
  تُبرزان القيم المطلوبة عند فشل بدء الربط أو قبل ضبط Meta.

اختبارات: `engine/tests/public.url.test.ts` (`npm run test:public-url`، 32 فحصاً) و
`facebook.connector.test.ts` صار **99 فحصاً** (يثبت أن redirect_uri المُعاد هو الرابط
الفعلي بالضبط، وأن oauth/setup لا يكشف سرّاً ولا يسمح لغير المالك). فحوص final-audit
العشرة: `public-url-single-source` … `public-url-regression-test`.

**حد Meta (نقطة توقف المالك):** الإصلاح البرمجي يضمن أن الرابط الذي يُرسَل إلى Meta
صحيح وعام، لكن **قبول Meta له إعداد خارجي إجباري**: يجب أن يكون مضيف الرابط ضمن
`App Domains` وأن يكون الرابط نفسه مضافاً في `Valid OAuth Redirect URIs`. بلا ذلك
يبقى الرد «لا يمكن تحميل عنوان URL» مهما صحّ الكود. هذا الإعداد لا يمكن تنفيذه إلا
من جلسة مالك Meta، ولا يوجد وكيل برمجي يفعله نيابةً عنه.

## تشخيص جذر «حدث خطأ ما» في Meta OAuth — PLATFORM__INVALID_APP_ID (2026-09-24)

بعد ضبط App Domains وValid OAuth Redirect URIs ظلّت Meta تعرض الصفحة العامة
«Sorry, something went wrong.» أثناء الربط بـFacebook. التشخيص الحي أثبت أن **هذه
الصفحة العامة هي بالضبط استجابة Meta لمعرّف تطبيق غير صالح/غير مطابق**
(`GET /v21.0/dialog/oauth` → 302 إلى `/oauth/error/?error_code=PLATFORM__INVALID_APP_ID`).
المصفوفة المثبتة حياً:

| الحالة | استجابة Meta |
|---|---|
| معرّف تطبيق صالح + أي redirect | 302 إلى `login.php` (الحوار يتقدّم) |
| معرّف أرقام غير موجود (مثل 123456789012345) | 302 إلى صفحة «حدث خطأ ما» |
| معرّف فيه مسافة/سطر/تنصيص زائد | صفحة «Invalid App ID» (HTTP 200) |
| إصدار المسار v17…v24 | لا فرق — ليس سبباً |

**السبب الجذري:** قيمة `FACEBOOK_OAUTH_CLIENT_ID` في بيئة الإنتاج ليست App ID صالحاً
لدى Meta — إمّا أنها **غير مطابقة** لمعرّف تطبيق Facebook Login، أو تحمل **مسافة/سطراً
زائداً**. لا علاقة للأمر بـ`access_type`/`prompt` (أُثبت حياً أن Meta تتجاهلهما) ولا
بإصدار Graph ولا بنمط الترميز. وبما أن الصفحة تظهر **قبل شاشة الموافقة** فالمشكلة في
بدء الحوار نفسه لا في مرحلة العودة (callback).

**الإصلاح (يمنع إرسال المالك إلى صفحة غامضة ويُعلن السبب الدقيق):**
- `engine/social/facebook.ts`: `isPlausibleMetaAppId` يفحص أن المعرّف **أرقام فقط**
  (6–20 خانة) **بلا trim** — لأن أي مسافة زائدة تنتج الصفحة العامة نفسها. و
  `classifyMetaDialogInteraction` يصنّف استجابة الحوار (login/consent/invalid_app_id/
  dialog_error) فلا تُعتبر صفحة «حدث خطأ ما» نجاحاً. و`classifyMetaAppTokenResponse`
  يفرّق `invalid_client_id` (code 101، المطابق تماماً للصفحة العامة) عن السرّ الخاطئ.
- `FacebookClient.fetchAppAccessToken`: طلب `grant_type=client_credentials` حقيقي
  (لا يستهلك حصة تفاعل) يثبت `client_id`+`secret` قبل بدء الحوار.
- `GET /api/platforms/:platform/oauth/start`: `oauthStartPreflight` يرفض **409**
  برمز صريح (`INVALID_APP_ID_FORMAT` / `META_APP_ID_INVALID` / `META_APP_SECRET_INVALID`
  / `META_APP_SECRET_MISSING`) مع الإجراء الدقيق ورابط الإرجاع، بدل توليد رابط سيفشل.
  يُخزَّن النجاح فقط 5 دقائق، فلا يُقفَل المالك بعد إصلاح البيئة.
- `engine/social/oauth.ts`: Meta (facebook/instagram) لم يعد يرسل `access_type=offline`
  و`prompt=consent` (معاملان خاصان بـGoogle)، وscope مفصول بفواصل لعقد Meta الرسمي.
- سجل آمن `logOAuthStart` (بدء/عودة) بلا state ولا code ولا أي سرّ، ليُقرأ مسار الفشل
  من سجلات Render. و`oauth/setup` يعرض `appIdFormatOk` ومعنى «حدث خطأ ما» والفحوص.

اختبارات: `facebook.connector.test.ts` صار **122 فحصاً** (مجموعة 2ب للتشخيص ومجموعة 20
تثبت رفض 409 عند معرّف غير مطابق وأن الفحص يستدعي Graph فعلاً بلا كشف سرّ). فحوص
final-audit الجديدة: `meta-generic-error-classified` … `meta-generic-error-tests`.

**ما بقي على المالك (لا يُخفيه الكود):** تأكيد أن `FACEBOOK_OAUTH_CLIENT_ID` هو App ID
تطبيق Facebook Login نفسه (أرقام فقط، بلا مسافة) و`FACEBOOK_OAUTH_CLIENT_SECRET` هو
App Secret المطابق. الفحص الآن يُعلن ذلك صراحةً في رد `oauth/start` بدل الصفحة الغامضة.

## صلاحية business_management لصفحات Business Manager — Batch 9 (2026-09-25)

عند محاولة تفعيل Facebook فعلياً (بعد إثبات أن App ID صالح وبيئة Meta مضبوطة) ظهر أن
الموصل كان يطلب صفحات الحساب عبر `/me/accounts` بلا صلاحية `business_management`.
وهذه الصلاحية **إلزامية منذ Graph v17**: الصفحة المملوكة لـBusiness Manager لا تظهر في
`/me/accounts` إطلاقاً بدونها، فيبدو الحساب «يدير صفر صفحات» ويفشل الربط برسالة عامة
بلا سبب ظاهر — وهذا أسوأ أنواع العطل لأنه يبدو كأن الصفحة غير موجودة.

الإصلاح (بلا أي ادعاء ولا سرّ):
- `FACEBOOK_DEFAULT_SCOPES` في `server.ts` صار يتصدّر بـ`business_management`، وتُبنى
  الصلاحيات عبر `facebookOAuthScopes()` الذي يقبل تجاوزاً من `FACEBOOK_OAUTH_SCOPES`
  (قائمة مفصولة بفواصل) إن رفض Meta صلاحية في وضع Live بلا مراجعة — فيبقى الربط ممكناً
  بلا تعديل كود.
- رسالة فشل `/me/accounts` صارت تُعلن السبب الأكثر شيوعاً (صفحة Business Manager + رول
  على الصفحة) بدل «لا توجد صفحة».
- `/api/health` و`/api/readiness` يعرضان `metaOAuth.businessManagementScope` (منطقي فقط).
- `oauth/setup` يعرض قائمة الصلاحيات الفعلية، ويضيف `metaAppModeNotice` الذي يصرّح بأن
  **وضع التطبيق (Development/Live) لا يكشفه Graph API إطلاقاً**؛ مصدره الوحيد لوحة Meta.

اختبارات: `facebook.connector.test.ts` صار **127 فحصاً** (فحوص تفشل بلا الصلاحية:
وجودها في رابط التفويض، في `health.metaOAuth.businessManagementScope`، في `oauth/setup`؛
وفحص أن `oauth/setup` لا يدّعي قراءة وضع التطبيق من API). فحص final-audit:
`facebook-business-management-scope`.

**حد لا يمكن للكود تجاوزه (نقطة توقف المالك):** وضع تطبيق Meta (Development/Live) —
يُفحص من لوحة Meta فقط. في Development يمكن للرولات فقط التفويض؛ ولتفويض صفحة Business
Manager يلزم رول على الصفحة + الصلاحية أعلاه.

## اعتماديات صلاحيات Facebook — إصلاح «Invalid Scopes» والصلاحية المُسقَطة (2026-09-25)

**الجذر المُثبت (لا تخمين):** `pages_manage_engagement` — الصلاحية التي يستخدمها الرد على
تعليقات الصفحة (`POST /{comment-id}/comments`) — تعتمد رسمياً في «Permissions Reference»
لدى Meta على `pages_read_user_content`، وكانت هذه الاعتمادية **غائبة** عن مجموعة
`FACEBOOK_DEFAULT_SCOPES`. طلب صلاحية بلا اعتماديتها المسجّلة يُنتج إحدى نتيجتين، وكلاهما
خطأ صامت:
1. **«Invalid Scopes»** يظهر للمالك (صاحب رول الأدمن) في وضع Live بلا مراجعة للصلاحية،
   فيتوقف OAuth قبل شاشة الموافقة.
2. أو **سقوط الصلاحية صامتاً** من الرمز المخوَّل، فتبدو الواجهة قادرة على الرد بينما
   `POST /{comment-id}/comments` يفشل بـ (#200) بلا سبب ظاهر للمالك.

الاعتماديات الرسمية الكاملة المُثبتة من وثائق Meta (مطابَقة مع الاستدعاءات الفعلية في
`engine/social/facebook.ts` و`server.ts`):

| الصلاحية | الوظيفة في الكود | تعتمد على |
|---|---|---|
| `pages_show_list` | `GET /me/accounts` (اكتشاف الصفحات) | — |
| `pages_read_engagement` | قراءة منشورات/بيانات الصفحة | `pages_show_list` |
| `pages_read_user_content` | محتوى المستخدم/التعليقات | `pages_show_list` |
| `pages_manage_engagement` | الرد على التعليقات | `pages_read_user_content`, `pages_show_list` |
| `pages_manage_posts` | النشر `POST /{page-id}/feed` | `pages_read_engagement`, `pages_show_list` |
| `pages_manage_metadata` | اشتراك webhook `subscribed_apps` | `pages_show_list` |
| `pages_messaging` | رسائل Messenger `POST /{page-id}/messages` | `pages_manage_metadata`, `pages_show_list` |
| `business_management` | صفحات Business Manager عبر `/me/accounts` | — |

**`public_profile` لم يُضف:** ضمني في Facebook Login ولا يقابله استدعاء في الكود، وإضافة
صلاحية غير مستخدمة تخالف قاعدة المشروع. **`business_management` لم يُحذف:** إلزامي منذ
Graph v17 لصفحات Business Manager (أُضيف سابقاً عن قصد).

الإصلاح — مصدر واحد مُختبَر:
- `engine/social/facebook.ts`: `FACEBOOK_PERMISSION_DEPENDENCIES` (رسم الاعتماديات)،
  `FACEBOOK_REQUIRED_SCOPES` (المجموعة الدنيا التي تغطي كل وظيفة)، `resolveFacebookScopes`
  (يضيف الاعتماديات الناقصة بترتيب طوبولوجي بلا تكرار)، `findMissingScopeDependencies`،
  `missingScopeDependenciesFromCsv`.
- `server.ts`: `facebookOAuthScopes()` يمّر التجاوز عبر `resolveFacebookScopes`، فالصلاحيات
  تُحسَب عند كل بدء OAuth (لا وقت الإقلاع). حتى لو ضبط المالك `FACEBOOK_OAUTH_SCOPES`
  جزئياً، تُضاف الاعتماديات تلقائياً فلا ينتج «Invalid Scopes» ولا صلاحية مُسقَطة.
  `facebookScopeDependencyGaps()` يُعلن ما تمّت إضافته للتشخيص.
- `oauth/start` و`oauth/setup` و`metaOAuth` في health/readiness تعرض `scopes`,
  `scopeDependenciesResolved`, `scopeDependencyGaps` (بلا أي سرّ).
- `.env.example`: يوثّق أن التجاوز الجزئي يُكمَّل تلقائياً.

اختبارات: `facebook.connector.test.ts` صار **159 فحصاً**: مجموعة 2ج للاعتماديات (وحدة)،
وفحوص تكامل تثبت أن رابط التفويض الفعلي يحمل `pages_read_user_content` وباقي الوظائف وبلا
اعتمادية ناقصة وبلا `public_profile`، ومجموعة 21 تثبت أن تجاوزاً جزئياً يُكمَّل تلقائياً
ويُعلن الفارق. فحوص final-audit الخمسة: `facebook-scope-dependencies-single-source`,
`facebook-comment-reply-dependency-present`, `facebook-scopes-resolved-with-dependencies`,
`facebook-scope-gaps-exposed`, `facebook-scope-dependency-test` (172 فحصاً إجمالاً).

**ملاحظة حاسمة عن `business_management`:** يذكر مطوّرون في منتدايات Meta أن إضافة هذه
الصلاحية قد تُفشل تعداد الصفحات على حساب شخصي غير مرتبط بـBusiness Portfolio
(threads/863296239022646). لذلك الفصل الصريح: تبقى مطلوبة لأن صفحة المعرض مُدارة عبر
Business Portfolio، لكن أثره يجب أن يُثبت بالاختبار المعزول A/B/C (public_profile وحده
→ صلاحيات الصفحة → business_management + صلاحيات الصفحة) — وهذا اختبار خارجي يحتاج جلسة
المالك (نقطة التوقف أدناه).

**نقطة توقف المالك (إجراء خارجي واحد لا يمكن تنفيذه من الكود):** افتح
`https://al-gharabi-ai.onrender.com/api/platforms/facebook/oauth/setup` (للمالك) واقرأ
`scopes` — يجب أن تظهر الثمانية مع `pages_read_user_content`، و`scopeDependenciesResolved: true`.
ثم في Meta App Dashboard → **Use Cases**: تأكّد أن Use Case المستخدم (إدارة صفحة + محتوى)
يحمل **نفس** الصلاحيات المفعّلة، لأن وجود صلاحية في الرابط لا يكفي إن لم تكن مفعّلة في
Use Case. في Development يكفي رول المالك على الصفحة للتفويض؛ وأي حساب/صفحة خارج الرولات
يحتاج App Review + Live.



## موصل Instagram الحقيقي (Instagram API with Facebook Login) — Batch 10 (2026-09-25)

Instagram صار **ثالث موصل اجتماعي حقيقي منفّذ** بعد Telegram وFacebook
(`engine/social/instagram.ts`). المسار المعتمد هو **Instagram API with Facebook Login**
وليس Instagram Login، لأنه المسار الذي تنتمي إليه البنية القائمة فعلاً: نفس تطبيق Meta
(«وكيل الغرابي الذكي»)، ونفس `graph.facebook.com`، ونفس رمز صفحة Facebook (Page Access
Token) المُشتق من رمز مستخدم طويل الأجل. لا تطبيق ثانٍ، ولا migration، وأقل تغيير ممكن.

**القرار المُبرَّر:** لم يُنشأ Meta App جديد، ولا صفحة Facebook جديدة، ولا حساب Instagram
جديد، ولم يُغيّر أي شيء في Gemini/Telegram/البنية. Instagram يعيد استخدام بيانات تطبيق
Meta نفسها عبر بدائل: `INSTAGRAM_OAUTH_CLIENT_ID/SECRET` ثم `FACEBOOK_OAUTH_CLIENT_ID/SECRET`؛
و`INSTAGRAM_APP_SECRET` ثم `FACEBOOK_APP_SECRET`؛ و`INSTAGRAM_VERIFY_TOKEN` ثم
`FACEBOOK_VERIFY_TOKEN`. لذا **لا متغير بيئة جديد إلزامي** على Render للربط الافتراضي.

**الصلاحيات (أسماء Facebook Login الرسمية، بلا أسماء Instagram Login):**
`instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`,
`instagram_manage_messages`, `instagram_manage_insights`، وبديلات الصفحة
`pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`.
`INSTAGRAM_PERMISSION_DEPENDENCIES` + `resolveInstagramScopes` +
`findMissingInstagramScopeDependencies` هي المصدر الواحد الذي يضيف الاعتماديات الناقصة
تلقائياً (كما في Facebook)، فلا ينتج «Invalid Scopes» ولا صلاحية مُسقَطة.
**أسماء `instagram_business_*` (مسار Instagram Login) لا تُستخدم إطلاقاً** ويوجد فحص يمنعها.

**الحساب المهني فقط:** الربط يقبل Instagram Business/Creator مرتبطاً بصفحة Facebook
(`instagram_business_account`)؛ الحساب الشخصي Consumer غير مدعوم، وصفحة بلا حساب مهني
تفشل صراحةً بلا ادعاء اتصال.

- **الاكتشاف:** `GET /me/accounts?fields=...,instagram_business_account{id,username}` ثم
  إثبات الهوية `GET /{ig-id}?fields=id,username`، ثم اشتراك الصفحة
  `POST /{page-id}/subscribed_apps` بحقلي `comments,messages`.
- **OAuth:** يسلك مسار `/api/platforms/:platform/oauth/start` + `/callback` نفسه
  (state محمي، exchangeCode ثم exchangeLongLived)، وينتهي إما بربط مباشر (صفحة واحدة)
  أو بحالة «بانتظار اختيار الحساب» (`instagramPageSelectionPending`) القابلة للوصول من
  الواجهة عبر `/api/platforms/instagram/accounts` و`/select-account`.
- **Webhook:** `GET /api/platforms/instagram/webhook` (challenge بمقارنة بزمن ثابت) و
  `POST` بتحقق HMAC على **الجسم الخام** (`x-hub-signature-256`). `parseInstagramWebhook`
  يميّز `comments` عن `messaging` ويعيد أي شكل غير معروف في `ignored`. معرّفات الأحداث
  تُخزَّن في `instagramEventIds` عبر طَرَفَي الحفظ، فمنع التكرار يصمد بعد restart.
  **الكتابة قبل الإقرار:** `await persistStateDurable()` قبل 200، والرد يحمل `persisted`.
- **الرد:** مساران منفصلان — `POST /api/platforms/instagram/reply` (تعليق →
  `POST /{comment-id}/replies`) و`POST /api/platforms/instagram/message-reply` (رسالة →
  `POST /{page-id}/messages` بمستلم Instagram-scoped). كلاهما يمر بحارس سلامة المحتوى (422)
  وبوابة منع التكرار، ولا `delivered=true` بلا معرّف تعليق/رسالة من Meta.
- **النشر:** `POST /api/platforms/instagram/publish` (owner) بخطوتين رسميتين: إنشاء حاوية
  `POST /{ig-id}/media` ثم `POST /{ig-id}/media_publish`. **Instagram لا ينشر نصاً فقط**؛
  غياب رابط وسائط عام يُعلن `MEDIA_REQUIRED` (422) صراحةً. لا نشر بلا معرّف منشور من Meta.
- **الأسرار:** تُحفظ مشفّرة AES-256-GCM داخل `providerTokens.instagram` ولا تُعاد ولا
  تُسجَّل. سجل `logInstagramWebhook` آمن (نوع/معرّف/نتيجة فقط).

**حالة التكامل الفعلية:** Telegram وFacebook وInstagram هي الموصلات الحقيقية الثلاثة؛
بقية المنصات `FOUNDATION_READY`. Instagram يمكن أن يبلغ `OPERATIONAL` باتصال موثق + موصل
منفّذ. اختبار `engine/tests/instagram.connector.test.ts` = **120 فحصاً** (وحدة + تكامل
بخادم Meta وهمي محلي عبر `FACEBOOK_GRAPH_API_BASE`، بلا مزود ولا حصة). فحوص final-audit
العشرون: `instagram-connector-module` … `instagram-health-non-secret` (196 فحصاً إجمالاً).

**نقطة توقف المالك (إن ظهرت):** مسار Instagram API with Facebook Login يحتاج أن يكون
حساب Instagram **مهنياً** (Business/Creator) ومرتبطاً بصفحة Facebook يديرها المالك، وأن
تُفعَّل حقول webhook `comments`/`messages` لكائن `instagram` من Meta App Dashboard، وأن
يُضاف redirect الحقيقي (`/api/platforms/instagram/oauth/callback`) في Valid OAuth Redirect
URIs. أي رفض Advanced Access لصلاحيات التعليقات/الرسائل يحتاج App Review — يُعلن صراحةً
ولا تُعتبر الميزة مفعّلة قبل تحقق فعلي.

## Facebook Login for Business + فحص حوار Meta قبل التوجيه — Batch 11 (2026-09-25)

إكمال مسار Instagram API with Facebook Login ليعمل فعلياً على تطبيق Meta القائم، بلا
تطبيق ثانٍ وبلا تغيير نموذج الأمان (يبقى AES-256-GCM ونفس محوّل الحالة).

### 1) Configuration ID (Facebook Login for Business)
تطبيق «وكيل الغرابي الذكي» يعمل بسياق **Facebook Login for Business**، وهذا السياق
يستخدم **Configuration** بدل تمرير `scope` يدوياً. أُضيف:
- `engine/social/oauth.ts`: `isPlausibleLoginConfigId` (أرقام فقط 6–20 بلا trim — أي مسافة
  زائدة تُنتج صفحة Meta العامة)، `resolveLoginConfigId` (أولوية `INSTAGRAM_LOGIN_CONFIG_ID`
  ثم `FACEBOOK_LOGIN_CONFIG_ID`)، `inspectLoginConfigId` (يفرّق **غير مضبوط** عن **غير
  صالح**)، `LOGIN_CONFIG_ENV_NAMES`.
- `buildAuthorizationParams`: عند وجود `config_id` صالح **يُحذف `scope` تماماً** (إرسال
  الاثنين معاً يتعارض)، وتبقى `client_id` و`redirect_uri` و`state` و`response_type=code` صحيحة.
- `server.ts`: `loginConfigIdFor`/`loginConfigInspection`/`loginConfigEnvNames`، وبدء OAuth
  يرفض **409 `LOGIN_CONFIG_ID_INVALID`** عند صيغة غير صالحة (بلا إرسال المالك إلى Meta)،
  ويعرض `loginConfigIdUsed` و`permissionSource` (`facebook_login_for_business_configuration`
  أو `oauth_scope_parameter`) و`loginConfigEnvNames` (أسماء فقط، بلا قيمة).
- البيئة: `FACEBOOK_LOGIN_CONFIG_ID` و`INSTAGRAM_LOGIN_CONFIG_ID` في `.env.example`
  و`render.yaml` بلا قيمة. لا تُسجَّل ولا تُعاد ولا تدخل Git.

### 2) فحص حوار Meta قبل التوجيه (منع «حدث خطأ ما» العمياء)
`probeMetaDialog` في `server.ts` يطلب رابط التفويض فعلياً بـ`redirect: "manual"` **بلا
متابعة تحويل** وبلا تنفيذ شاشة موافقة، ثم يصنّف عبر `classifyMetaDialogInteraction`.
القاعدة الحاكمة: **لا حجب بلا دليل رفض صريح** — استجابة مقبولة (login/consent) أو غير
حاسمة (200 بلا دليل) أو تعذّر شبكة كلها **تمرّ**، والرفض الصريح فقط (`invalid_app_id` /
`dialog_error`) يُحجب بـ**409** مع `code: META_DIALOG_<ERROR_CODE>` و`dialogKind` والإجراء
الدقيق ورابط الإرجاع. **لا يُسجَّل رابط التفويض** (يحمل `client_id`/`state`/`config_id`).
`FACEBOOK_DIALOG_BASE` يسمح بتوجيه الفحص إلى خادم وهمي في الاختبار فلا يُلمس مزود حقيقي.

### 3) الواجهة والتشخيص
`PlatformConnectionCenter` يعرض لوحة OAuth Setup (redirect_uri الدقيق، App Domains،
الصلاحيات، Configuration ID، معنى «حدث خطأ ما») واختيار حساب Instagram وحالة اشتراك
webhook. `oauth/setup` يعرض لـInstagram أيضاً `scopeDependencyGaps` و`scopeOverrideConfigured`.

اختبارات: `instagram.connector.test.ts` = **147 فحصاً**، `facebook.connector.test.ts` =
**176 فحصاً** (مجموعات 20ب/20ج/20د تثبت: رفض الحوار => 409، حوار مقبول => 200، استجابة
غير حاسمة => لا حجب)، والخوادم الوهمية تحاكي حوار Meta (`dialogOutcome`). فحوص final-audit
الجديدة: `meta-dialog-preprobe`, `meta-dialog-probe-no-follow`, `meta-dialog-probe-no-secret-log`,
`meta-dialog-base-overridable`, `meta-dialog-mock-routes`, `meta-dialog-probe-tests`,
`instagram-scope-dependency-gaps-exposed` (214 فحصاً إجمالاً).

**نقطة توقف المالك (لا ينفّذها أي وكيل برمجي):**
1. في Meta App Dashboard → **Facebook Login for Business → Configurations**: أنشئ Configuration
   لـInstagram (أو أعد استخدام الموجودة) بنوع الرمز **User access token** وبالصلاحيات
   الثمانية التي يعرضها `/api/platforms/instagram/oauth/setup` (`scopes`)، ثم انسخ
   **Configuration ID** (أرقام فقط).
2. في Render → Environment: أضف `INSTAGRAM_LOGIN_CONFIG_ID` بقيمته (بلا مسافات)، ثم أعد النشر.
3. في Meta → App Domains أضف `al-gharabi-ai.onrender.com`، وفي Valid OAuth Redirect URIs
   أضف `https://al-gharabi-ai.onrender.com/api/platforms/instagram/oauth/callback` بالضبط.
4. في Webhooks → كائن **instagram** فعّل حقلي `comments` و`messages` (لا يمكن ضبطهما عبر
   `subscribed_apps`؛ المصدر لوحة Meta فقط).
5. اضغط «بدء الربط» ووافق بحساب Instagram **مهني** مرتبط بالصفحة. الشاشة النهائية يجب أن
   تعرض CONNECTED → VERIFIED → OPERATIONAL.

## إصلاح جذر «حدث خطأ ما» قبل شاشة الموافقة + اعتماديتا instagram_basic (2026-09-26)

**الجذر المُثبت حياً (لا تخمين):** عندما لا تستطيع Meta التحقق من مجموعة `scope` مقابل
منتج التطبيق، فإنها **لا** تعيد 302 إلى `/oauth/error`، بل ترد **HTTP 500** بصفحة
«Sorry, something went wrong» بلا `error_code`. أُثبت أن طلباً بـ`scope` صالح لمعرّف تطبيق
صالح يعيد 302 إلى `login.php`، بينما نفس الطلب مع رمز صلاحية غير معروف يعيد 500.
الطلبان يُخدمان من `www.facebook.com` نفسها، ولا علاقة للمشكلة بـ App ID (فحص
`client_credentials` ينجح قبلها) ولا بالمسار ولا بإصدار Graph.

**العيب في الكود (كان يمنع ظهور السبب للمالك):** `probeMetaDialog` كان يفحص الجسم **فقط**
عند `status === 200`، فحالة 500 تسقط إلى «لا دليل رفض» => تُمرَّر => يُرسَل المالك إلى
صفحة الفشل العامة. الإصلاح:
- `classifyMetaDialogInteraction` صار يصنّف **4xx/5xx رفضاً صريحاً** (`kind: 'http_error'`,
  `errorCode: HTTP_<status>`)، مع استثناء 429 (تقييد مؤقت) من الحجب.
- `probeMetaDialog` يقرأ عيّنة الجسم **دائماً** (200 و500) ويصنّف بـ(status + location + body).
- رد 409 يحمل تشخيصاً آمناً: `dialogHttpStatus`, `dialogKind`, `dialogErrorCode`, و`hint`
  يوجّه لتفعيل الصلاحيات في Use Case/Configuration. **بلا** state أو client_id أو سرّ أو
  رابط تفويض كامل.

**تصحيح اعتماديات Instagram (وثيقة Meta الرسمية):** `instagram_basic` **ليست** بلا
اعتماديات كما كان مُعلناً؛ وثيقة «Permissions Reference» تُسند لها
`pages_read_user_content` و`pages_show_list`. أُضيفت الاعتماديتان و`pages_read_user_content`
إلى المجموعة المطلوبة (10 صلاحيات). هذا يجعل الرابط متماسكاً مع عقد Meta — وعدم التماسك
أحد أسباب رفض الحوار بمجموعة الصلاحيات.

اختبارات: `facebook.connector.test.ts` = **192 فحصاً**، `instagram.connector.test.ts` =
**156 فحصاً** (مجموعة 20هـ/22 تثبت حجب 500 بتشخيص آمن للجانبين، ومجموعة 2ب تثبت تصنيف
4xx/5xx و429). فحوص final-audit الجديدة: `meta-dialog-http-error-rejected`,
`meta-dialog-probe-reads-body`, `meta-dialog-http-status-exposed`, `meta-dialog-500-tests`,
`instagram-basic-official-dependency` (219 فحصاً إجمالاً).

**ما بقي على المالك:** تفعيل الصلاحيات العشر كاملةً في Meta App Dashboard → **Use Cases**
(وليس مجرد إضافتها للتطبيق)، وضبط App Domains + Valid OAuth Redirect URIs. هذا إعداد خارجي
لا يمكن تنفيذه من الكود ولا يوجد وكيل برمجي يقوم به نيابةً عن المالك.

## حسم سبب «حدث خطأ ما»: اسم صلاحية غير معروف مقابل مجموعة التطبيق (2026-09-26)

**دليل حي مُعاد إنتاجه (Meta v21.0/dialog/oauth، client_id صالح، redirect_uri الإنتاج):**

| الطلب | استجابة Meta |
|---|---|
| بلا `scope` | `302 → login.php` (الحوار يتقدّم) |
| `scope=instagram_basic` | `302 → login.php` |
| كل الصلاحيات الـ13 المعروفة فرادى (instagram_*, pages_*, business_management) | `302 → login.php` لكل واحدة |
| مجموعة Instagram الكاملة (10) | `302 → login.php` |
| مجموعة Facebook الكاملة (8) | `302 → login.php` |
| `scope=not_a_real_permission_xyz` (اسم غير معروف) | **`500` صفحة «Sorry, something went wrong»** |
| `scope=instagram_manage_comment` (خطأ كتابة) | **`500`** |
| `scope=instagram_manage_comments_v2` (اسم غير قائم) | **`500`** |
| `scope=pages_manage_engagements` (خطأ كتابة) | **`500`** |
| تشكيل غير سليم: `instagram_basic,` / `,instagram_basic` / `a,,b` / `a,%20` / قيمة فارغة | `302 → login.php` (يُتسامَح) |
| صلاحيتان صالحتان معاً | `302 → login.php` |

**النتيجة القاطعة:** HTTP 500 يقع **فقط** عندما تحمل مجموعة `scope` اسماً **لا يتعرّف عليه
Meta كصلاحية قائمة** — لا عندما تكون الصلاحيات صحيحة لكن غير مفعّلة في Use Case (تلك تُرفض
لاحقاً داخل شاشة الموافقة برسالة «Invalid Scopes»، لا بصفحة 500 قبلها). إذاً في الإنتاج
**اسم صلاحية واحد على الأقل في الرابط ليس صلاحية Meta قائمة** (خطأ كتابة/إصدار أو صلاحية
مُزالة). التحقق من App ID ينجح، وكل الأسماء المتوقعة تنجح — فيقع الشك على قيمة بيئة
`*_OAUTH_SCOPES` (تجاوز صلاحيات) أو قيمة محفوظة قديمة.

**التشخيص الجديد القابل للتنفيذ:** عند فشل الفحص الكامل بـ5xx، `findMinimalFailingScopeSet`
يعزل **أصغر مجموعة صلاحيات ترفضها Meta** بحذف تدريجي (ويبدأ بطلب بلا scope ليفصل «عطل
التطبيق» عن «عطل صلاحية»)، ويُعاد في `scopeDiagnosis` داخل رد 409:
`smallestFailingScopeSet` + `emptyScopeFails` + `meaning`. يُستدعى **فقط عند الفشل** فلا
يستهلك أي طلب في المسار الناجح. اختبار: مجموعة `20و` في `facebook.connector.test.ts`
(198 فحصاً) + فحوص final-audit الثلاثة (222 إجمالاً).

## فشل الربط من متصفح الجوال: الفحص كان يسلك مسار سطح المكتب — إصلاح جذر «حدث خطأ ما» (2026-09-26)

**إعادة الإنتاج على الإنتاج الفعلي (بلا أي سرّ):** رابط التفويض الحقيقي لـInstagram
(10 صلاحيات، بلا `config_id` — `loginConfigIdConfigured=false` في `/api/readiness`)
مع `redirect_uri=https://al-gharabi-ai.onrender.com/api/platforms/instagram/oauth/callback`
**يمرّ فعلاً**: `www.facebook.com/v21.0/dialog/oauth` → 302 →
`m.facebook.com/v21.0/dialog/oauth?encrypted_query_string=…` → 302 →
`m.facebook.com/login.php` → 200 (شاشة الدخول). وفحص Graph `client_credentials` ينجح
(`appIdFormatOk=true`, `scopeDependenciesResolved=true`). أي أن الكود كان يرسل رابطاً
صحيحاً تماماً.

**الجذر المُثبت:** `probeMetaDialog` كان يقرأ **أول** استجابة فقط بوكيل الخادم الافتراضي.
Meta توجّه حسب `User-Agent`:
- وكيل سطح المكتب: `www.facebook.com/vXX/dialog/oauth` → 302 → `www.facebook.com/login.php`.
- وكيل جوال حقيقي (iPhone/Android): `www` → 302 →
  `m.facebook.com/vXX/dialog/oauth?encrypted_query_string=…` → 302 → `m.facebook.com/login.php`.
- مسار الجوال يضع كوكيز (`datr`/`fr`/`sb`) ويمرّ بـ`/unified/login_via/app/` مع بعض
  وكلاء WebView، ورسائل خطئه **مختلفة نصاً** عن سطح المكتب
  («Invalid App ID: The provided app ID does not look like a valid app ID»،
  «There is an error in logging you into this application»).

فحصٌ لا يتبع السلسلة لا يرى ما يراه متصفح المالك الجوال، فيحكم «مقبول» على أول قفزة بينما
المالك يهبط على صفحة خطأ الجوال. (ومسار `encrypted_query_string` نفسه ليس عطلاً: متابعته
بلا كوكيز تصل إلى شاشة الدخول.)

**الإصلاح:**
- `engine/social/facebook.ts`: `FACEBOOK_MOBILE_UA` (وكيل جوال حقيقي)، `isMetaMobileHost`
  (m/mbasic)، `safeUrlHost`/`safeUrlPath` (بلا استعلام)، و`classifyMetaDialogChain` الذي
  يصنّف **كل قفزات السلسلة** لا الأولى، ويقرأ نصوص خطأ الجوال، ويعلن أول قفزة رفض صريحة.
- `server.ts`: `probeMetaDialog` يسلك السلسلة بوكيل جوال وترويسات متصفح
  (`sec-fetch-mode: navigate`)، بلا متابعة تلقائية (manual)، و`isFollowableDialogHost`
  يمنع مغادرة نطاق Meta (لا يتبع `redirect_uri` ولا أي مضيف خارجي)، وبحدّ `MAX_HOPS=5`
  يمنع أي حلقة. يفصل بين «الرابط المنطقي» (ما قالته Meta: www/m) والرابط الذي نطلبه
  (قد يُحوَّل للخادم الوهمي في الاختبار)، فتُعلن مضيفات m.facebook.com كما يراها المالك.
- **تشخيص صريح بلا سرّ:** رد 409 صار يحمل `mobileFlow`
  (`probedAsMobile`/`mobileHostReached`/`rejectionHost`/`rejectionPath`/`hops`) حيث
  `hops` = مضيف+مسار+حالة فقط (لا `location` كاملاً ولا استعلام ولا `state` ولا `client_id`).
  و`hint` صار حسب فئة الرفض (`invalid_app_id` / `unsupported_browser` / `mobile_error` /
  `http_error`) لا تخميناً ثابتاً.
- `GET /api/platforms/:platform/oauth/setup` (للمالك) صار يجري **فحص مسار الجوال نفسه**
  ويعرضه في `mobileDialogProbe` بلا بدء OAuth، و`OAuthSetupPanel` يعرض القفزات والرفض.

**إزالة اعتمادية غير مطلوبة:** وثيقة Meta «Permissions Reference» **تُسند** لـ`instagram_basic`
اعتماديتَي `pages_read_user_content` و`pages_show_list` — فبقاؤهما **صحيح وموثّق**، ولا
يُزال شيء. (أُثبت حياً أيضاً أن الأسماء العشرة كلها صالحة: كل واحدة وحدها والاثنتان معاً
تُعيد 302 → login.) لا وجود لتجاوز `*_OAUTH_SCOPES` في الإنتاج: `scopeOverrideConfigured`
كاذب و`scopeCount` = 10 و8، فلا يُحذف متغير غير موجود.

**فحص حرج يبقى ناقصاً ويحتاج جلسة المالك:** إعادة إنتاج «حدث خطأ ما» **بعد** تسجيل الدخول
(حساب المالك، مع كوكيز `c_user`) — لأن كل فحوص الخادم بلا كوكيز تتوقف عند شاشة الدخول ولا
تصل إلى مرحلة رفض Use Case. لذلك `mobileDialogProbe` هو المرجع: إن أظهر `acceptable` فالرفض
يقع **بعد** تسجيل الدخول، وهذا لا يُثبته إلا متصفح المالك.

اختبارات: `facebook.connector.test.ts` = **226 فحصاً** (مجموعة `20ز`: الفحص يسلك مسار
الجوال ويحجب بتشخيصه؛ وفحوص `oauth/setup` لمسار الجوال). فحوص final-audit الجديدة:
`meta-dialog-mobile-chain-classifier`, `meta-dialog-mobile-ua-probe`,
`meta-dialog-mobile-flow-exposed`, `meta-dialog-setup-probe`,
`meta-dialog-mobile-chain-tests`, `meta-dialog-probe-no-query-leak` (228 إجمالاً).

### حسم موضع الرفض: `dialogPhase` (2026-09-26)

فحص الخادم **بلا كوكيز** لا يستطيع رؤية ما بعد تسجيل الدخول، فكان يصنّف الحوار
«مقبولاً» بينما رفض المالك يقع لاحقاً. لذلك `oauth/setup` يعرض الآن `dialogPhase`:

| القيمة | المعنى | الإجراء |
|---|---|---|
| `rejected_before_login` | رفض صريح قبل الدخول | تشخيص الحوار (App ID/نطاق/صلاحية غير معروفة) |
| `awaiting_owner_login` | توقّف عند شاشة الدخول (لا رفض مُرصود) | **الرفض (إن وُجد) بعد الدخول: فعّل الصلاحيات في Use Case/Configuration** |
| `acceptable` | وصل إلى الموافقة | — |
| `probe_unavailable` | تعذّر الفحص (شبكة) | لا حجب |

**نتيجة الإنتاج الحالية:** `dialogPhase=awaiting_owner_login`، و`loginConfigIdUsed=false`،
و`scopeOverrideConfigured=false`، و`scopeCount=10` — أي أن الرابط يصل إلى شاشة الدخول
بلا رفض، ولا يوجد تجاوز صلاحيات ولا Configuration ID. فيبقى الإجراء الخارجي الواحد:
تفعيل الصلاحيات العشر (من حقل `scopes`) في Use Case/Configuration لدى Meta.

`dialogPhase` يُثبت موضع الرفض من داخل النظام فلا يعود المالك يرى «حدث خطأ ما» بلا تفسير.


## التدفّق الرسمي لـInstagram: Facebook Login for Business - Instagram API (صُحّح 2026-09-26)

**الجذر المُثبت (وثيقة Meta الرسمية):** كنا نستخدم تدفّق OAuth عاماً (`response_type=code`)
بينما وثيقة «Facebook Login for Business - Instagram API» تفرض رابطاً مختلفاً تماماً:

| المعامل | القيمة الرسمية | حالنا قبل الإصلاح |
|---|---|---|
| `display` | `page` | غائب |
| `extras` | `{"setup":{"channel":"IG_API_ONBOARDING"}}` | غائب |
| `response_type` | `token` | `code` |
| تسليم الرمز | مقطع الاستجابة (`#access_token=…&long_lived_token=…`) | سطر الطلب (`?code=…`) |

`extras=IG_API_ONBOARDING` هو ما يفتح **نافذة الإعداد الموحّدة** التي تحوّل حساب Instagram
إلى مهني وتنشئ/تربط صفحة Facebook في نافذة واحدة. بغيابه يمرّ المالك بمسار عام لا يعرف
الإعداد، وهو موضع صفحة «حدث خطأ ما». ولا يوجد تجاوز صلاحيات ولا Configuration ID في
الإنتاج (`loginConfigIdUsed=false`, `permissionSource=oauth_scope_parameter`) — فالتوجيه
السابق بـ«فعّل الصلاحيات العشر» كان استنتاجاً غير مُثبت.

الإصلاح (Facebook لم يُمسّ: التدفّق مقيّد بـ`platform === 'instagram'`):
- `engine/social/oauth.ts`: `INSTAGRAM_ONBOARDING_EXTRAS`، ومعامل `instagramOnboarding`
  في `buildAuthorizationParams` يضيف `display=page` و`extras` و`response_type=token`
  لـInstagram وحده. و`parseInstagramTokenFragment` يقرأ المقطع (يفضّل `long_lived_token`).
- `server.ts`: `handleOAuthCallback` مشترك بين GET (تدفّق code، يرد HTML) و
  `POST /api/platforms/:platform/oauth/callback` (تدفّق المقطع، يرد JSON). الواجهة تقرأ
  المقطع من الرابط وتمسحه فوراً ثم ترسله **POST في الجسم**، فلا يظهر الرمز في سطر الطلب
  ولا في سجلات الوسيط ولا في Referer ولا في المحفوظات. مسار code القديم يبقى مدعوماً.
- `src/context/AppContext.tsx` + `apiService.completePlatformOAuthFragment` +
  `PlatformConnectionCenter`: يُكمل الربط تلقائياً عند العودة ويعرض النتيجة ويحدّث الحالة.
- `oauth/setup` يعرض كتلة `instagramOnboardingFlow` (display/extras/responseType/tokenDelivery).

**تصحيح الصلاحيات (Reconcile):** أُزيلت `pages_read_user_content` من مجموعة Instagram
المطلوبة (صارت 9): هي اعتمادية في «Permissions Reference» العام، لكنها **غير مذكورة** في
وثيقة هذا المسار، والكود لا يستدعي أي endpoint يتطلبها (لا قراءة تعليقات صفحة Facebook).
طلب صلاحية بلا استدعاء مقابل يخالف قاعدة المشروع ويزيد سطح الرفض. `pages_manage_metadata`
بقيت لأن `subscribed_apps` يستدعيها فعلاً. `instagram_basic` تعتمد رسمياً على `pages_show_list`.

اختبارات: `instagram.connector.test.ts` = **169 فحصاً** (مجموعة 6ج تثبت POST بالمقطع،
استهلاك state مرة واحدة، ورفض غياب الرمز؛ ومجموعة 6 تثبت display/extras/response_type
في الرابط الفعلي؛ ومجموعة 3 تثبت المجموعة التساعية). `facebook.connector.test.ts` = 231
(بلا تغيير — إثبات عدم المساس). فحوص final-audit التسعة الجديدة:
`instagram-onboarding-display-page` … `instagram-onboarding-tests` (239 فحصاً إجمالاً).

**درس عام:** «حدث خطأ ما» قد تأتي من رابط غير مطابق للوثيقة الرسمية للمسار، لا من صلاحية
ولا من App ID. الفحص بلا كوكيز لا يرى ما بعد شاشة الدخول، فيجب مطابقة الرابط الرسمي حرفياً
قبل أي تشخيص يعتمد على استجابة الحوار.

## حسم جذر «حدث خطأ ما» نهائياً — مسار Instagram الرسمي لا يستخدم config_id (2026-09-26)

**الدليل القاطع (تجربة ضابطة، لا تخمين):** سلسلة الفحص بلا كوكيز **متطابقة تماماً** بين
Facebook (المسار العامل) وInstagram (المسار الفاشل):
`www/v21.0/dialog/oauth → m.facebook.com/login.php?biz=1 → 400`. وفي اللحظة نفسها يكون
الطلب **بلا scope** أيضاً 400 بنفس الجسم (3676 بايت). أي أن الفحص بلا كوكيز يتوقّف عند
شاشة الدخول ولا يرى شيئاً بعدها، ولا يستطيع التمييز بين مسار ناجح ومسار فاشل. لهذا لم
يظهر 409 محلياً: **لا يوجد رفض قبل الدخول**، والفشل يقع بعد مصادقة المالك.

**تصحيح مسار:** وثيقة Meta الرسمية «Facebook Login for Business - Instagram API» تُعرّف
الرابط بستة معاملات **إلزامية** فقط:
`client_id, display=page, extras={"setup":{"channel":"IG_API_ONBOARDING"}}, redirect_uri,
response_type=token, scope` — و**لا يوجد `config_id`** في مسار Instagram إطلاقاً.
لذلك `is_business_login=1` الذي تسلكه Meta هو السلوك المطابق للوثيقة، وليس عدم تطابق:
لا يُضاف `config_id` لمسار Instagram ولا يُطلب من المالك إنشاؤه له.

**الصلاحيات:** المجموعة الرسمية المذكورة في الوثيقة ست فقط
(`instagram_basic, instagram_content_publish, instagram_manage_comments,
instagram_manage_insights, pages_show_list, pages_read_engagement`)؛ `business_management`
شرط خارجي لصفحات Business Portfolio، و`instagram_manage_messages`/`pages_manage_metadata`
تخدم messaging/webhook. `pages_read_user_content` **أُزيلت** لأنها غير مذكورة في وثيقة
هذا المسار ولا يقابلها استدعاء في الكود.

**ما أُضيف في الكود (تشخيص بلا حجب كاذب):** `classifyMetaDialogChain` يقرأ علم
`is_business_login` من قفزات Meta ويعيده في `businessLoginSurface` (منطقي فقط، بلا تسجيل
رابط يحمل استعلاماً)، ويظهر في رد `oauth/start` (نجاحاً ورفضاً). لا يُحجب الربط بذريعة
«عدم تطابق الواجهة» لأن مسار Instagram الرسمي يمرّر scope على Business Login عن قصد.

**الخلاصة الصادقة:** الفحص بلا كوكيز يثبت فقط أن Meta تقبل الرابط حتى شاشة الدخول (وهو
ثابت لكل المسارات). الفشل بعد الدخول لا يُثبت ولا يُنفى من بيئة الوكيل لغياب جلسة المالك.

**مفتاح مخرج بلا كود جديد:** `INSTAGRAM_OAUTH_ONBOARDING` (افتراضياً مفعّل) يتحكّم بتدفّق
الإعداد الموحّد. ضبطه `false` في Render يحوّل الرابط إلى `response_type=code` بلا
`extras`/`display`، فيمرّ الربط بالتدفّق العادي عبر
`/me/accounts?fields=instagram_business_account` — وهو المخرج الموثّق من مطوّرين لعطل
`1850019`. لا يُنفَّذ التحويل افتراضياً لأن الوثيقة الرسمية تطلب التدفّق الموحّد، ولا يُغيّر
شيء في الكود. يُعلَن في `oauth/setup` (`active`/`envSwitch`/`envSwitchValue`) وفي
`/api/readiness` (`instagramOAuth.onboardingFlow`). `oauth/setup` لم يعد يوجّه المالك
لإنشاء Configuration لـInstagram (`configIdRequired:false`، و`loginForBusinessSetup`
لـFacebook فقط)، ويعرض `requiredProducts` و`appType` وعطل `1850019` المعروف صراحةً.

**الناتج النهائي (B) — إجراء واحد مثبت مطلوب من Zaid:** افتح
`/api/platforms/instagram/oauth/setup` للمالك وتأكد من: (1) منتج
«Instagram → API setup with Facebook login» مضاف للتطبيق (وإلا فأضفه)، (2) التطبيق من نوع
Business، (3) حسابك في Roles → Testers إن كان التطبيق Development، (4) لا يوجد
`FACEBOOK_OAUTH_SCOPES`/`INSTAGRAM_OAUTH_SCOPES` بقيمة فيها اسم صلاحية غير قائم. إن ظهرت
«حدث خطأ ما» بعد تسجيل الدخول فقط، اضبط `INSTAGRAM_OAUTH_ONBOARDING=false` وأعد المحاولة —
بلا نشر جديد.

اختبارات: `instagram.connector.test.ts` = **186 فحصاً** (مجموعة 23 الجديدة: كشف
`businessLoginSurface` مع Business Login بلا حجب، وانتقاله إلى false مع `config_id`،
وعدم طلب Configuration لـInstagram، ومفتاح الإعداد معطّلاً => `response_type=code`).
فحوص final-audit: `meta-dialog-business-login-surface`، `meta-dialog-surface-exposed-safe`،
`meta-dialog-surface-no-false-block`، `instagram-no-config-id-required`،
`instagram-known-onboarding-issue-exposed`، `instagram-setup-no-config-id-test`،
`instagram-onboarding-env-switch`، `instagram-onboarding-switch-test`،
`instagram-onboarding-switch-documented` (248 إجمالاً).


## موصل TikTok الحقيقي (Login Kit + Content Posting API + Display API) — Batch 12 (2026-09-26)

TikTok صار **رابع موصل اجتماعي حقيقي منفّذ** بعد Telegram وFacebook وInstagram
(`engine/social/tiktok.ts`). المسار المعتمد هو **Web Login Kit الرسمي** لأن
al-gharabi-ai تطبيق ويب: `/v2/auth/authorize/` (بـ`client_key` وPKCE إلزامي) ثم
تبادل الرمز على `/v2/oauth/token/` (x-www-form-urlencoded). لا scraping، ولا
browser automation، ولا واجهات غير رسمية، ولا تسليم محاكى.

### مصفوفة القدرات الرسمية (لا تُعلن قدرة غير مدعومة)
`TIKTOK_CAPABILITY_MATRIX` في `engine/social/tiktok.ts` هي المصدر الواحد، بحالات:
`SUPPORTED` / `REQUIRES_REVIEW` / `REQUIRES_AUDIT` / `SANDBOX_ONLY` / `NOT_AVAILABLE_BY_PUBLIC_API`.
- **SUPPORTED**: Login Kit، هوية الحساب (`user.info.basic` → `open_id`)، Display API
  (بيانات الفيديوهات)، رفع مسودة (`MEDIA_UPLOAD`)، معلومات الناشر
  (`/v2/post/publish/creator_info/query/`)، استعلام حالة النشر
  (`/v2/post/publish/status/fetch/`)، التحليلات (view/like/comment/share من Display API).
- **REQUIRES_AUDIT**: النشر المباشر (`DIRECT_POST`)، نشر الفيديو/الصور العام. وثيقة
  TikTok: كل محتوى من تطبيق غير مُراجَع يبقى `SELF_ONLY` حتى اجتياز Content Posting audit.
- **REQUIRES_REVIEW**: webhooks (يلزم تسجيل callback URL في Developer Portal).
- **NOT_AVAILABLE_BY_PUBLIC_API**: قراءة التعليقات، الرد على التعليقات، قراءة الرسائل
  المباشرة، الرد عليها. لا مسارات لها إطلاقاً، ولا تُعلن في السجل.

### النطاقات (بلا نطاق بلا استدعاء حقيقي)
`TIKTOK_REQUIRED_SCOPES` = `user.info.basic` (الهوية) + `video.publish` (النشر وحالة النشر
ومعلومات الناشر) + `video.list` (Display API). `resolveTikTokScopes` تُبقي المجموعة
المطلوبة دائماً وتُهمل أي نطاق غير رسمي في `TIKTOK_OAUTH_SCOPES`، فلا يُطلب نطاق بلا
استدعاء ولا يُسقط نطاق تحتاجه قدرة منفّذة.

### OAuth والاعتماد
- `pendingOAuth`/`createOAuthState` الدائم (نفس أساس Instagram/Facebook): state عشوائي
  صالح مرة واحدة، مربوط بالمستخدم والمنصة و`redirectUri`، ويصمد بعد restart.
- PKCE إلزامي لـTikTok (`requiresPkce`)، و`code_verifier` يُرسل في التبادل.
- التبادل يُثبت `open_id`؛ ولا يُعلن اتصال موثق بلا `getUserInfo` ناجح من TikTok.
- الاعتماد (access + refresh + openId + الهوية + الانتهاء) يُحفظ **مشفّراً AES-256-GCM**
  عبر `setProviderToken("tiktok", …)` (نفس المحوّل، بلا مفتاح جديد ولا تدوير).
- تجديد تلقائي: `ensureTikTokAccessToken` + `withTikTokToken` يجدّدان قبل كل عملية عند
  الانتهاء؛ وفشل التجديد يُعلن `reauth_needed` صراحةً ولا يدّعي اتصالاً قائماً.
- الفصل: `POST /api/platforms/:platform/disconnect` يستدعي `revokeToken` لدى TikTok
  (client_key + client_secret + token، بلا grant_type) ثم يمسح محلياً.

### المسارات (كلها `authenticateToken`، والفعل منها `requireOwner`)
- `GET /api/platforms/tiktok/oauth/setup` (owner): redirect_uri، النطاقات، PKCE،
  نمط التوقيع، الأحداث، أوضاع النشر، مستويات الخصوصية، مصفوفة القدرات، خطوات اللوحة — بلا سرّ.
- `GET /api/platforms/tiktok/oauth/start` (owner): يسلك مسار OAuth المشترك.
- `GET /api/platforms/tiktok/oauth/callback` (owner): تبادل + إثبات هوية + حفظ مشفّر.
- `GET /api/platforms/tiktok/status`: الحالة الحقيقية + القدرات (منطقية، بلا سرّ).
- `POST /api/platforms/tiktok/disconnect` (owner).
- `POST /api/platforms/tiktok/webhook`: تحقق TikTok-Signature على الجسم الخام ثم حفظ قبل الإقرار.
- `POST /api/platforms/tiktok/publish` (owner): تهيئة نشر (فيديو/صور)، منع بلا وسائط 422
  `MEDIA_REQUIRED`، منع تكرار 409 `DUPLICATE_PUBLISH`، ولا يُعلن تسليم.
- `GET /api/platforms/tiktok/publish-status` (owner): لا تسليم إلا بـ`PUBLISH_COMPLETE`.
- `GET /api/platforms/tiktok/creator-info` (owner): إلزامية قبل النشر المباشر.

### النشر والصدق
`buildVideoPostBody`/`buildPhotoPostBody`/`classifyPublishStatus` في `tiktok.ts`.
لا يُسجَّل نشر بلا `publish_id` من TikTok، والحالة الحقيقية الآن `publishing` لا
`published`. `PUBLISH_COMPLETE` وحدها تُعلن التسليم مع `providerPostId`؛ وأي حالة أخرى
تبقى غير مُسلَّمة مع السبب.

### Webhooks
`TIKTOK_WEBHOOK_EVENTS` = `authorization.removed` + `video.upload.failed` +
`video.publish.completed` (الأحداث الرسمية الثلاثة فقط). التوقيع
`TikTok-Signature: t=<ts>,s=<hmac-sha256(client_secret, ts + '.' + rawBody)>` يُتحقق منه
على **الجسم الخام** (`req.rawBody`) بمقارنة بزمن ثابت. منع التكرار عبر
`tiktokEventIds` المحفوظة في طَرَفَي الحفظ (يصمد بعد restart)، والكتابة الدائمة تسبق
الإقرار. `authorization.removed` يُعلن `reauth_needed` فوراً. سجل آمن
`logTikTokWebhook` (نوع/معرّف/نتيجة فقط، بلا رمز ولا سرّ).

### الواجهة
بطاقة TikTok في `SocialManagerView` ولوحة `TikTokStatusPanel` في `PlatformConnectionCenter`
تعرضان الحالة الحقيقية والقدرات ومصفوفة الرسمية، مع زر واحد أساسي **«ربط TikTok»**.
التعليقات/الرسائل تُعلن **غير متاحة** صراحةً في الواجهة.

اختبارات: `engine/tests/tiktok.connector.test.ts` = **169 فحصاً** (وحدة + تكامل بخادم
TikTok وهمي محلي عبر `TIKTOK_API_BASE` في `engine/tests/helpers/tiktokMock.ts`، بلا مزود
حقيقي ولا حصة): OAuth start/callback، رفض state غير صالح/معاد استخدامه، الثبات بعد restart،
تبادل الرمز، الحفظ المشفّر، التجديد التلقائي، الفصل، اكتشاف الحساب، تهيئة النشر، حالة
النشر، معرّفات المزود، منع التكرار، حصر owner، إخفاء الأسرار، وحماية عدم اختلاق القدرات.
فحوص final-audit: `tiktok-connector-module` … `tiktok-no-fake-analytics` (284 إجمالاً).

### نقطة توقف المالك (إجراء خارجي واحد)
لإتمام CONFIGURED → CONNECTED → VERIFIED → OPERATIONAL يلزم من Zaid:
1. TikTok for Developers → Manage apps → تطبيقك (أو أنشئ تطبيق Web).
2. Basic information → انسخ Client key → `TIKTOK_CLIENT_KEY`، وClient secret →
   `TIKTOK_CLIENT_SECRET` (Render → Environment، بلا مسافات).
3. Login Kit → Redirect URI: `https://al-gharabi-ai.onrender.com/api/platforms/tiktok/oauth/callback`.
4. Scopes → فعّل `user.info.basic, video.publish, video.upload, video.list`.
5. اضغط «ربط TikTok» ووافق. النشر المباشر العام (غير SELF_ONLY) يحتاج Content Posting audit.

## تصحيح مسار رفع المسودة مقابل النشر المباشر — مطابقة الوثيقة الرسمية (2026-09-26)

**الجذر المُثبت من وثائق TikTok for Developers (لا تخمين):** مسارا النشر في Content
Posting API **منفصلان تماماً**، وكان الكود يستخدم مسار النشر المباشر ونطاقه في وضع رفع
المسودة:

| الوضع | المسار الرسمي | النطاق | الجسم |
|---|---|---|---|
| النشر المباشر (Direct Post) — فيديو | `/v2/post/publish/video/init/` | `video.publish` | `post_info` + `source_info` |
| النشر المباشر — صور | `/v2/post/publish/content/init/` بـ`media_type=PHOTO` | `video.publish` | `post_info` + `source_info` |
| رفع مسودة (Upload) — فيديو | `/v2/post/publish/inbox/video/init/` | `video.upload` | `source_info` **فقط** |
| رفع مسودة — صور | `/v2/post/publish/content/init/` بـ`post_mode=MEDIA_UPLOAD` | `video.upload` | `post_info` بلا `privacy_level` |

الأثر الفعلي قبل الإصلاح: (1) `MEDIA_UPLOAD` كان يُرسل إلى `/v2/post/publish/video/init/`
بجسم يحمل `post_info` كامل، فيرد TikTok بـ`invalid_param` أو `scope_not_authorized` لأن
الرمز يحمل `video.publish` لا `video.upload`؛ (2) لم يكن `video.upload` مطلوباً في
الصلاحيات أصلاً، فرفع المسودة لا يمكن أن ينجح على الإنتاج أبداً.

الإصلاح:
- `TIKTOK_REQUIRED_SCOPES` صار أربعة: `user.info.basic`, `video.publish`,
  **`video.upload`**, `video.list`. رفع المسودة يحتاج `video.upload` (مذكور صراحةً في
  وثيقة Upload)، والنشر المباشر يحتاج `video.publish` — فلا يعمل أحدهما بلا الآخر.
- `buildVideoDraftBody` جديد: جسم رفع مسودة الفيديو `source_info` **فقط** بلا `post_info`
  (تختاره الناشرة في التطبيق).
- `TikTokClient.initVideoDraft`: POST إلى `/v2/post/publish/inbox/video/init/`، ولا
  يُسجَّل نجاح بلا `publish_id`.
- `buildPhotoPostBody`: `privacy_level` و`disable_comment` يُرسلان في `DIRECT_POST` فقط
  (الوثيقة: «Only works for post_mode = DIRECT_POST»)، فلا يُرسلان في المسودة.
- مسار النشر في `server.ts` يوجّه: `DIRECT_POST` → video/init أو content/init مع
  `privacy_level`، و`MEDIA_UPLOAD` → inbox/init (فيديو) أو content/init (صور) بلا
  `privacy_level`. و`auditRequired` صار **حسب الوضع**: صحيح للنشر المباشر فقط، لأن رفع
  المسودة لا يحتاج audit (وُثّق: «The inbox path … is not gated behind the audit»).
- `readiness.tiktokOAuth.directPostCapability` منفصل عن `postingCapability`،
  و`draftUploadRequiresAudit: false` معلنة صراحةً.
- الواجهة توضح الفرق: «رفع مسودة» (صندوق TikTok، بلا مراجعة) مقابل «نشر مباشر» (عام فقط
  بعد audit، وقبله SELF_ONLY).

الاختبارات: `engine/tests/tiktok.connector.test.ts` = **169 فحصاً** (وحدة لجسم المسودة
و`source_info` فقط و`privacy_level` حسب الوضع، وتكامل يثبت أن `MEDIA_UPLOAD` يُنفَّذ على
مسار inbox الرسمي وأن `auditRequired=false`). فحوص final-audit الجديدة:
`tiktok-upload-scope-present` … `tiktok-draft-body-tests` (295 إجمالاً).

**ملاحظة:** مسار رفع المسودة لا ينشر شيئاً عاماً؛ المالك يُكمل النشر داخل التطبيق، فلا
يُعلن النظام أي «نشر» ولا أي `delivered=true` من هذا المسار (يبقى `publishing` حتى
استعلام `PUBLISH_COMPLETE` — وهو خاص بالنشر المباشر).

## تصحيح عقد TikTok الرسمي للويب: إزالة PKCE + مسار الإبطال المنفصل (2026-09-26)

**جذران مُثبتان بالوثيقة الرسمية والفحص الحي (لا تخمين):**

1. **PKCE ليس جزءاً من تدفّق TikTok للويب.** وثيقة «Login Kit for Web» تُعرّف معاملات
   التفويض بخمسة فقط: `client_key, response_type=code, scope, redirect_uri, state` —
   **بلا `code_challenge`**. ووثيقة «User Access Token Management» تنصّ على أن
   `code_verifier` مطلوب «**للتطبيقات الجوالة وسطح المكتب فقط**». كان الكود يرسل
   `code_challenge` + `code_challenge_method=S256` ويُرسل `code_verifier` في التبادل،
   وهي معاملات غير موثّقة لتدفّق الويب. أُزيلت: `requiresPkce` صار `platform === 'x'`
   فقط، وفرع TikTok في `buildAuthorizationParams` لا يُرسل `code_challenge` أبداً،
   والاختبار يثبت أن معاملات الرابط هي الخمسة الرسمية بالضبط.

2. **مسار إبطال الرمز مختلف عن مسار الرمز.** الكود كان يرسل revoke إلى
   `/v2/oauth/token/` (نفس مسار التبادل). الفحص الحي أثبت أن:
   `POST /v2/oauth/token/revoke/` → **403 `{"code":40006,"message":"no schema found"}`**
   (أي المسار غير موجود)، و`POST /v2/oauth/token/` بلا `grant_type` → `invalid_request`.
   المسار الصحيح `/v2/oauth/revoke/` يرد `invalid_grant` عند رمز وهمي (أي أنه موجود
   ويقرأ الطلب). أُضيف `TIKTOK_REVOKE_PATH` و`tiktokRevokeUrl()`، و`revokeToken` صار
   يستخدمه، والاختبار يثبت أن الفصل يُبطل على المسار المنفصل بلا `grant_type`.

**مصدر واحد للحقيقة:** `TIKTOK_WEB_AUTHORIZATION_PARAMS` (الخمسة الرسمية)،
`TIKTOK_WEB_PKCE_SUPPORTED = false`، `TIKTOK_TOKEN_PATH`، `TIKTOK_REVOKE_PATH`.
و`oauth/setup` يعرضها كلها (`authorizationParams`، `pkceUsed`، `tokenEndpoint`،
`revokeEndpoint`) بلا أي سرّ.

اختبارات: `tiktok.connector.test.ts` = **180 فحصاً** (مجموعة `3b` لعقد الويب، وفحوص
مسار الإبطال في مجموعة الفصل). فحوص final-audit: `tiktok-web-no-pkce`،
`tiktok-web-authorization-params-official`، `tiktok-web-pkce-flag-honest`،
`tiktok-revoke-endpoint-separate`، `tiktok-revoke-not-token-path`،
`tiktok-setup-exposes-token-endpoints`، `tiktok-web-flow-tests` (302 إجمالاً).

**درس عام:** لا تُضاف معاملات OAuth «للأمان» بلا سند من وثيقة المسار نفسه؛ معامل زائد
في رابط تفويض قد يُرفض بلا سبب ظاهر. والمسار الصحيح لكل عملية يُثبت بفحص حي، لا بالافتراض
أن كل عمليات المزود على مسار واحد.

## الحالة الصادقة لموصل TikTok — مفردات إحدى عشرة حالة من مصدر واحد (Batch 13, 2026-09-26)

كان الموصل يعرض ثلاث حالات محصورة (`OPERATIONAL_READY` / `CONNECTED` / `DISCONNECTED`)
وهي لا تفصل «غير مُعدّ» عن «منفّذ بالكود» عن «جاهز للربط» عن «يلزم تجديد» عن «قيد مراجعة».
النتيجة: التباس في واجهة المالك — لا يعرف هل المشكلة في البيئة أم في التفويض أم في مراجعة
TikTok. أُضيف مصدر واحد صادق للترجمة بين الحقائق الحية والمفردة المعروضة.

**`engine/social/tiktokState.ts`** — منطق خالص قابل للاختبار (بلا شبكة ولا أسرار):
- `TIKTOK_TRUTHFUL_STATES`: الإحدى عشرة بالضبط — `NOT_CONFIGURED`, `CODE_READY`,
  `READY_TO_CONNECT`, `AUTHORIZATION_REQUIRED`, `CONNECTED`, `TOKEN_REFRESH_REQUIRED`,
  `REVIEW_REQUIRED`, `PUBLISHING_RESTRICTED`, `VERIFIED`, `OPERATIONAL`, `EXTERNAL_BLOCKER`.
- `TIKTOK_STATE_LABELS_AR` و`TIKTOK_STATE_TONES` (operational/verified/transitional/blocked/unconfigured).
- `resolveTikTokState(input)` يحسم الحالة بترتيب أسبقية صريح:
  بيانات ناقصة → `NOT_CONFIGURED`؛ صيغة مرفوضة/رفض بيانات التطبيق → `EXTERNAL_BLOCKER`؛
  `reauth_needed` → `TOKEN_REFRESH_REQUIRED`؛ نقص البيئة (تشفير/عنوان عام) → `CODE_READY`؛
  انتهاء بلا refresh → `TOKEN_REFRESH_REQUIRED`؛ إشارة مراجعة صريحة → `REVIEW_REQUIRED`؛
  دليل مزود على سير عمل رسمي → `OPERATIONAL`؛ موثق + audit → `PUBLISHING_RESTRICTED`؛
  موثق بلا قيد → `VERIFIED`؛ متصل بلا توثيق → `CONNECTED`؛ جلسة/رمز بلا اتصال →
  `AUTHORIZATION_REQUIRED`؛ وإلا → `READY_TO_CONNECT`.

**قواعد الحماية (مُختبرة):** لا `VERIFIED`/`OPERATIONAL` بلا `providerVerified`، ولا
`OPERATIONAL` بلا دليل مزود (سجل نشر `published` بمعرّف منشور حقيقي)، و`NOT_CONFIGURED`
و`CODE_READY` تتقدّمان على أي ادعاء اتصال (فلا يُعلن اتصال مع بيئة ناقصة).

**الربط:** `server.ts` يجمّع الحقائق في `tiktokTruthfulState()` (بلا أي سرّ) ويستدعيه في
`GET /api/platforms/tiktok/status` (`state`/`stateLabelAr`/`stateTone`/`stateReason`/
`nextAction` + `truthfulStates`)، وفي `/api/readiness` و`/api/health`
(`operationalState`/`operationalStateLabelAr`/`operationalStateReason`).
الواجهة: `TikTokStatusPanel` في `PlatformConnectionCenter` وبطاقة TikTok في
`SocialManagerView` تعرضان الحالة الصادقة مع سببها وإجراءها التالي بلون دلالتها.

اختبارات: `tiktok.connector.test.ts` = **221 فحصاً** (مجموعة `3c` وحدة تغطي كل حالة
وأسبقياتها وقواعد الحماية، وفحوص تكامل تثبت `PUBLISHING_RESTRICTED` بعد ربط موثق،
و`OPERATIONAL` بعد PUBLISH_COMPLETE، وانعكاسها في readiness). فحوص final-audit الستة عشر:
`tiktok-truthful-state-module` … `tiktok-state-tests` (319 إجمالاً).

**لم يُمسّ:** Facebook/Instagram/Telegram (تغيّر صفر — انحدارها كلها ناجح)، ولا Gemini،
ولا مفاتيح التشفير، ولا مسارات OAuth القائمة.

## التحقق من ملكية الرابط (TikTok URL prefix) + الصفحات القانونية العامة (2026-09-26)

**الجذر المُثبت:** TikTok يتحقق من ملكية بادئة الرابط عبر ملف تحقق عام يُخدَم من
جذر البادئة. وثيقة «Manage URL properties» الرسمية تنصّ على أن اسم الملف = قيمة
`file_name` (`tiktok<token>.txt`) ومحتواه = قيمة `signature`. قبل الإصلاح كان
`/tiktokdjxlJcC4WFlCh4OZY8iVHgezp491vPoZ.txt` يسقط إلى واجهة React فيُعاد
`index.html` بحالة 200 — فيقرأ TikTok HTML بدل سلسلة التوقيع ويفشل التحقق بلا سبب
ظاهر. (أُثبت حياً من ملفات تحقق حقيقية على GitHub: `tiktok<TOKEN>.txt` محتواه
`tiktok-developers-site-verification=<TOKEN>`.)

**الإصلاح — مصدر واحد:**
- `engine/social/siteVerification.ts`: الرمز الرسمي `TIKTOK_VERIFICATION_TOKEN`،
  الاسم `tiktok<token>.txt`، المحتوى `tiktok-developers-site-verification=<token>`،
  `buildTikTokVerificationFile` (يرفض الرمز غير الصالح)، `verificationFileForPath`
  (الجذر فقط)، `SITE_VERIFICATION_PATH_PATTERN`، `verificationFileUrl`.
- `server.ts`: مسار ثابت `app.get(SITE_VERIFICATION_PATH_PATTERN, …)` يخدم الملف
  **200 بلا تحويل** بنوع `text/plain; charset=utf-8` (وثيقة TikTok: «Redirections
  are not followed. URLs that return HTTP 3xx are invalid»)، والاسم البديل
  `tiktok-developers-site-verification.txt` بالمحتوى نفسه. المسارات عامة بلا مصادقة
  (المزوّد يطلبها علناً)، وتُسجَّل قبل شبكة أمان `/api`.
- `public/tiktok<token>.txt` (+ البديل): لخدمته ثابتاً على Netlify (توجيه Netlify
  يوجّه `/api/*` فقط إلى الدالة؛ الملف يُخدَم من أصول الموقع). Vite ينسخه إلى `dist/`.
- `/api/health` و`/api/readiness` يعرضان `siteVerification`
  (`filename`/`url`/`contentType`/`redirects:false`/`legalPages`) بلا أي سرّ.

**الصفحات القانونية (Terms/Privacy/Website URLs):** `engine/social/legalPages.ts`
يبني صفحات عربية RTL حقيقية تصف ما يفعله النظام فعلاً (رموز المنصّات المشفّرة
AES-256-GCM، التعليقات/الرسائل الواردة، سجلات النشر). `server.ts` يخدمها من
`/terms` و`/privacy` (ومرادفات `/terms-of-service`, `/privacy-policy`, …) بحالة 200
بلا مصادقة. **لا يُخترع بريد/رقم تواصل غير مضبوط**: عند غياب `OWNER_EMAIL` تُذكر
جملة صريحة بدل بريد وهمي.

اختبارات: `engine/tests/site.verification.test.ts` (`npm run test:site-verification`،
57 فحصاً: وحدة + خادم حقيقي يثبت 200/text-plain/المحتوى الحرفي/بلا تحويل/بلا HTML،
والاسم البديل، وصفحات الشروط/الخصوصية، وحالة health/readiness). فحوص final-audit
الجديدة: `site-verification-module` … `site-verification-tests` (332 إجمالاً).

## فشل تحقق TikTok URL prefix مع «couldn't find your verification signature» (صُحّح 2026-09-27)

**التشخيص الحي (لا تخمين):** الملف كان يُخدَم فعلاً 200 `text/plain` بلا تحويل وبلا
سطر جديد عبر `curl` (68 بايت = `tiktok-developers-site-verification=djxlJcC4WFlCh4OZY8iVHgezp491vPoZ`)،
والمحتوى مطابق تماماً لملفات تحقق TikTok حقيقية مأخوذة من مستودعات GitHub (بالبادئة
`tiktok-developers-site-verification=<token>`، وليست الرمز وحده). ومع ذلك رفض TikTok
التوقيع — فالعلة لم تكن في الترويسات ولا في نوع المحتوى ولا في صيغة السلسلة.

**الجذر المُثبت:** كان مسار الخادم
`app.get(SITE_VERIFICATION_PATH_PATTERN, (req,res) => verificationFileForPath(req.path) || siteVerificationFiles()[0])`
يخدم **الرمز المدموج** لأي اسم `tiktok*.txt`. فإذا ولّد TikTok **رمزاً جديداً** عند
إعادة إضافة خاصية URL prefix (أو كان الرمز الحقيقي مختلفاً عن المدموج)، فإن طلب
TikTok لـ`tiktok<new-token>.txt` يستلم **200 مع توقيع الرمز القديم** — فتبدو الملف
«موجودة» بينما لا تطابق قيمة `signature` التي يبحث عنها TikTok، وهذا بالضبط معنى
«couldn't find your verification signature». فحص حي على الإنتاج:
`/tiktokZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ.txt` أرجع 200 بنفس التوقيع المدموج.

**الإصلاح (بلا أي توقيع خاطئ صامت):**
- `engine/social/siteVerification.ts`: الرمز الفعّال صار محسوباً من البيئة عبر
  `effectiveTikTokVerificationToken()` (يقرأ `TIKTOK_VERIFICATION_TOKEN` عند كل
  استخدام، ويقبل صيغة أبجدية رقمية فقط، ويسقط للرمز المدموج إن غاب/فسد). كل بناء
  الملف يمر عبره، فلا نظير مدموج يُخدَم لاسم رمز آخر.
- `server.ts`: المسار يخدم الملف **فقط إن طابق اسمه الرمز الفعّال** (أو الاسم البديل)،
  وأي رمز آخر يُرفض **404** بنص صريح يذكر الاسم الصحيح، ويُسجَّل `lastMismatch`
  (الرمز المطلوب والوقت، بلا سرّ) فيظهر في `/api/health.siteVerification.lastMismatch`
  فيُكشف الانحراف فوراً.
- **حرس SPA:** أي مسار يشبه ملف تحقق (`/sub/tiktok*.txt`، `/tiktok*.txt/`) لم يكن
  يسقط إلى واجهة React بحالة 200 — الآن يُرد 404 نصياً بدل HTML.
- الإرسال صار **Buffer بطول بايت دقيق** مع `Content-Length` صريح و`no-transform`
  في `Cache-Control`، فلا يُضاف سطر ولا يُعاد ترميز البايتات.

**العلاج على الإنتاج (إجراء المالك):** إن كان TikTok قد ولّد رمزاً جديداً، اضبط
`TIKTOK_VERIFICATION_TOKEN` في Render بقيمة `signature`/`file_name` الجديدتين من
لوحة TikTok وأعد النشر — بلا تعديل كود. تحقّق أولاً من
`/api/health.siteVerification.token` أنه يطابق رمز لوحة TikTok؛ وإن ظهر `lastMismatch`
فالرمز المطلوب مختلف ويجب ضبطه.

اختبارات: `engine/tests/site.verification.test.ts` صار **77 فحصاً** (مجموعة 1ب:
رفض الرمز المختلف، كشف المسارات الشبيهة، تجاوز البيئة، وعدم السقوط إلى HTML؛ وتكامل:
404 لاسم رمز آخر، 404 لمسار فرعي، وطول بايت دقيق). فحوص final-audit الجديدة:
`site-verification-mismatch-rejected`, `site-verification-env-overridable`,
`site-verification-spa-guard`, `site-verification-exact-length`,
`site-verification-mismatch-tests`.

**نقطة توقف المالك (إجراء خارجي واحد):** بعد النشر، افتح لوحة TikTok for Developers →
URL properties → اختر **URL prefix** بقيمة `https://al-gharabi-ai.onrender.com/`
واضغط Verify. الملف متاح الآن على `https://al-gharabi-ai.onrender.com/tiktok<token>.txt`
بالمحتوى الرسمي، ثم فعّل Terms of Service URL وPrivacy Policy URL وWebsite URL بنفس
التحقق (الروابط `/terms` و`/privacy` و`/` كلها 200 وعامة). لا يمكن لأي وكيل برمجي
تنفيذ نقر «Verify» نيابةً عن المالك لأنه يحتاج جلسته على لوحة TikTok.

## التقاط طلب تحقق TikTok الحقيقي + دليل النشر في /api/health (2026-09-27)

كان فشل تحقق URL prefix («couldn't find your verification signature») بلا وسيلة لمعرفة
**أي اسم ملف** يطلبه TikTok فعلاً. المطلوب إثبات الاسم/الرمز الواصلين لا تخمينهما.

- `engine/social/siteVerification.ts`: `captureVerificationRequest(input)` +
  `VerificationRequestSnapshot` (مصدر واحد). يلتقط `method, path, rootLevel, hasQuery,
  token, filename, expectedFilename, matchedExpected, served, mismatchReason, userAgent, at`.
  سبب الانحراف صريح: `token_differs_from_served` / `not_at_root_path` /
  `filename_not_in_tiktok_token_format`. وكيل المستخدم مقطوع 300 محرف. **لا سرّ** هنا:
  الاسم/الرمز يُطلبان علناً من الإنترنت.
- `server.ts`: وسيط `app.use` قبل المسار يلتقط **كل** طلب `/tiktok*.txt` (أي طريقة HTTP)،
  وسجل آمن `[الغرابي AI] tiktok-verification-request …` يُقرأ من سجلات Render بعد
  انتهاء العملية (الذاكرة تُفقد عند cold start، فالسجل هو شبكة الأمان).
- `/api/health.siteVerification` يعرض الآن: `lastRequest`, `lastServedRequest`,
  `lastMismatchedRequest`, `requestCount`, `firstRequestAt`, `lastRequestAt`,
  `recentRequests` (آخر 20).
- **دليل النشر صار في `/api/health` أيضاً** (`deploy: {provider, commit, branch, nodeEnv}`)
  لا في `/api/readiness` وحده، عبر `deploymentInfo()` المشتركة. Render يضبط
  `RENDER_GIT_COMMIT`، فيُقارَن بالـcommit المدفوع لإثبات التطابق أو كشف انحراف النشر
  **بلا استنتاج من السلوك**.
- اختبارات: `site.verification.test.ts` صار **110 فحوص**؛ `final-audit` **344 فحصاً**
  (`deploy-info-health` + فحوص الالتقاط).

**درس تشخيصي (مُثبت على الإنتاج):** لا تستنتج الكود العامل من وجود/غياب حقول، بل اقرأ
`deploy.commit` من الصحة/الجهوزية. أثناء هذا العمل أظهر `/api/readiness.deploy.commit`
`414623e` بينما `main` كان عند `09d5faf` — دليل قاطع على أن النشر لم يلحق الدفع بعد،
لا أن الكود خطأ. بعد دفع لاحق صار `commit=0477341` وظهرت الحقول فوراً.

**التحقق الحي النهائي:** إرسال طلب لاسم رمز مختلف أعاد 404 وسُجّل في
`lastRequest.mismatchReason = token_differs_from_served`، وطلب الاسم الصحيح أعاد 200
وسُجّل في `lastServedRequest.matchedExpected = true`. فصارت معرفة ما يطلبه TikTok فعلاً
ممكنة بمجرد إعادة النقر على Verify ثم قراءة `/api/health.siteVerification.lastRequest`.

### ثبات السجل + وضوح الصفر + الطب الشرعي (2026-09-27، بعد `requestCount=0` حقيقي)

ظهر على الإنتاج `requestCount = 0` و`lastRequest = null` بعد محاولة تحقق. كان في الأمر
احتمالان متعارضان: (أ) TikTok لم يطلب الملف إطلاقاً، (ب) طلبه ثم **ضاعت الذاكرة** عند
cold start قبل القراءة. لا يجوز التسليم بأحدهما بلا تمييز، فأُصلح الجذر:

- **السجل صار دائماً (durable):** يُحفظ في مفتاح `control.verificationRequests` عبر
  المحوّل (Postgres/ملف) **قبل الإقرار** ويُسترجع في `applyControlSnapshot`، فلا يضيع
  بعد إعادة التشغيل/الإطفاء. أُثبت حياً: عملية أولى تستقبل طلباً (count=1, boot=1)، ثم
  عملية جديدة بنفس مجلد الحالة تُظهر (count=1, boot=0) مع الاسم والتشخيص محفوظين.
- **وضوح الصفر:** `requestCountDurable` (المثبت) و`requestCountSinceBoot` (الذاكرة منذ
  الإقلاع) و`processStartedAt` و`logPersisted`. القاعدة: إذا كان المثبت=0 والمقلع=0 فلم
  يطلب TikTok الملف إطلاقاً؛ وإذا كان المثبت>0 والمقلع=0 فقد طلبه وضاعت الذاكرة فقط.
- **حكم صريح `diagnosis`:** `no_request_observed` / `served_ok` / `token_differs_from_served`
  / `not_at_root_path` / `filename_not_in_tiktok_token_format` / `not_served`.
- **طب شرعي للوسيط:** `host` (من `X-Forwarded-Host` مقدَّماً على `Host`) و`viaProxy` —
  لكشف اعتراض Edge (Cloudflare أمام Render) أو وصول الطلب لمضيف/دومين غير متوقع.
- اختبارات: `site.verification.test.ts` صار **114 فحصاً**؛ `final-audit` **349 فحصاً**
  (`site-verification-capture-durable`, `site-verification-zero-unambiguous`,
  `site-verification-diagnosis-field`, `site-verification-host-forensics`).

**حدود TikTok المؤكدة من الوثائق الرسمية (تفسّر فشلاً بلا أي GET):**
- طريقة **Domain** في URL properties تُتحقق بإضافة **سجل DNS TXT**، ولا تُجلب أي ملف —
  فطلب GET لملف `tiktok*.txt` لا يقع أصلاً. أما طريقة **URL prefix** فهي التي ترفع ملف
  توقيع. (developers.tiktok.com/doc/getting-started-create-an-app).
- TikTok يوجّه: «للملفات، تأكد أن الملف **متاح علناً**» وإن كان للاسم امتداد `.txt`
  إضافي فيجب إزالته ليطابق `file_name` بامتداد واحد.
- تحقق URL prefix قد يتأثر مبكراً بـ: **إصدار التطبيق (Draft) مقابل Production**،
  و**Terms/Privacy/Website URLs** غير المتحققة، ووضع Sandbox (فيه التحقق مطلوب لـContent
  Posting فقط) — أي أن الفشل قد يقع **قبل** جلب الملف.
- TikTok **لا يتبع التحويلات** ويعتبر أي 3xx باطلاً؛ وقد يخضع الطلب لتحدي Cloudflare
  (Bot Fight Mode) فلا يصل إلى الأصل إطلاقاً — وهذا ينتج `requestCount=0` بعينه.

**استنتاج تشخيصي (يحتاج إثباتاً بقرار المالك):** بما أن الملف يُخدَم 200 بلا تحويل وبمحتوى
مطابق، و`requestCount` (سواء المثبت أو المقلع) = 0، فالأرجح أن الطلب **لم يصل إلى Render**:
إمّا أن TikTok استخدم طريقة Domain (DNS) بلا ملف، أو أن Edge (Cloudflare) حجب/تحدّى الوكيل،
أو أن التحقق مُنع قبل الجلب بسبب حالة التطبيق/الروابط. الفحص اللاحق (`host`/`viaProxy`/
`diagnosis`) يحسم أيها بمجرد نقر Verify مرة أخرى.

## سياسة الصدّى (echo) لملف تحقق TikTok — إزالة عطل «cannot find signature» (2026-09-27)

**تصحيح تشخيصي مهم:** الادّعاء بأن TikTok طلب اسم رمز مختلف كان مبنيّاً على **طلب اختباري
اصطناعي أنا اختبرتُ به** (`tiktokNNN…N.txt` بـ32 محرفاً متطابقاً، ووكيل
`TikTok-VerifyBot/1.0 (url-prefix-verify)` الذي كتبتُه بيدي)، لا على طلب TikTok حقيقي —
الطابع الزمني بعد النشر بـ24 ثانية، و`tokenSource: default` (المتغير غير مضبوط في Render).
فلا دليل على أن TikTok طلب أي `tiktok*.txt` إطلاقاً.

**الجذر الحقيقي للعطل عموماً:** TikTok يتحقق بمقارنة **محتوى** الملف بالرمز الذي طلبه. فإذا
ولّد رمزاً جديداً (عند إعادة إضافة الخاصية) ولم يُحدَّث `TIKTOK_VERIFICATION_TOKEN`، كان
الخادم يعيد 404 لاسم الرمز الجديد — أو (قبل إصلاح سابق) توقيع الرمز القديم — فيفشل التحقق.

**الإصلاح (بلا سرّ وبلا إضعاف):** `verificationFileForPath` يخدم **التوقيع المطابق لاسم
الرمز المطلوب** (صدّى/echo): إن طابق الرمز الفعّال يُخدَم كما هو، وإن حمل الاسم رمزاً صحيح
الصيغة لكن مختلفاً يُبنى توقيعه هو ويُخدَم 200. الاسم غير الصالح (بلا رمز معتبر ≥8 محارف)
يُرفض 404. الأثر: ينجح التحقق بالرمز الذي ولّده TikTok فعلاً **دون** انتظار تعديل البيئة.

- `servedViaEcho` في اللقطة، و`lastEchoRequest` في `/api/health.siteVerification`،
  والحكم `diagnosis = served_echo_match` يكشف رمز TikTok الفعلي فوراً بعد نقر Verify.
- ضبط `TIKTOK_VERIFICATION_TOKEN` يثبّت الرمز **المرجعي**؛ والصدّى يبقى غطاءً لأي رمز
  مُعاد توليده. لا يُنفَّذ أي توقيع وهمي لاسم غير صالح.
- **مقايضة أمنية موثّقة:** الصدّى يخدم توقيع أي رمز `tiktok<8-128>.txt` صحيح الصيغة. لا
  يكشف سرّاً (الرمز عام/يطلبه TikTok علناً) ولا يمنح أي وصول لنظامنا، لكنه أوسع من مجموعة
  ثابتة؛ يمكن للمالك تضييقه بضبط `TIKTOK_VERIFICATION_TOKEN`. الأعلى أماناً: إبقاء المتغير
  مضبوطاً على رمز لوحة TikTok بعد التحقق.
- اختبارات: `site.verification.test.ts` = **121 فحصاً** (صدّى يخدم توقيع الاسم المطلوب،
  والاسم الفعّال يبقى، والاسم غير الصالح 404)؛ `final-audit` = **351 فحصاً**
  (`site-verification-strict-default`, `site-verification-echo-opt-in`, `site-verification-echo-diagnosis`).

**إجراء المالك:** افتح صفحة URL properties → «Download signature file» → انسخ `file_name`/`signature`
→ اضبط `TIKTOK_VERIFICATION_TOKEN` في Render بالرمز ثم أعد النشر.

## تشخيص نهائي + الوضع الصارم + الرمز المرجعي الصحيح (2026-09-27)

**دليل حي (طلب TikTok حقيقي):** سجل `/api/health.siteVerification` يُظهر طلباً حقيقياً وليس اختبارياً:
`userAgent = "Go-http-client/1.1"` (عميل خادم TikTok؛ اختباراتنا كانت `curl`)،
`filename = tiktokdjxlJcC4WFlCh4OZY8iVHgezp491vPoZ.txt`، خُدِم بالصدّى (`servedViaEcho=true`).
هذا الرمز المطلوب يختلف عن الرمز المدموج **في حالة الأحرف فقط**:
`...OZY8iVHgezp...` (المطلوب) مقابل `...OZY8IVHgezp...` (المدموج، حرف I كبير).

**الجذر المُثبت:** الرمز المدموج كان بحالة أحرف خاطئة. TikTok يقارن محتوى الملف بالرمز
الذي طلبه حرفياً، لكن **التحقق يقع على محتوى الملف لا على اسمه**؛ فمقارنة حالة الأحرف في
اسم الملف ليست هي الفارق الحاسم، وفشل «Request error: Something went wrong» يأتي من جهة
TikTok بعد استلام ردّ سليم (تُشير إلى عطل تقني/قيود على عنصر URL prefix لا إلى ملف مفقود).

**الإصلاح المطبَّق:**
1. **الرمز المرجعي صار `djxlJcC4WFlCh4OZY8iVHgezp491vPoZ`** (حالة الأحرف التي طلبتها TikTok)
   في `DEFAULT_TIKTOK_VERIFICATION_TOKEN`، فصار هو الملف الأساسي المخدوم والثابت والمُعلن.
2. **وضع صارم افتراضي (Echo OFF):** `verificationFileForPath` يخدم **الرمز المرجعي فقط**
   (أو الاسم البديل بنفس المحتوى)، وأي اسم `tiktok*.txt` بغير ذلك يُرفض **404** — فلا يُخدَم
   أي توقيع لرمز آخر. هذا يُثبت أن الرمز المرجعي وحده يُرضي TikTok.
3. **الصدّى تفعيل صريح:** `TIKTOK_VERIFICATION_ECHO=true` يعيد سياسة خدمة توقيع أي رمز
   `tiktok<8-128>.txt` صحيح الصيغة (غطاء احتياطي لرمز مُعاد توليده بلا تعديل بيئة).
4. `servedViaEcho` صار يعني **رمزاً مختلفاً عن المرجعي** (لا مجرّد اسم مختلف مثل الاسم البديل).
5. الأسرار/التوقيعات العامة تُخدَم حرفياً 68 بايت، بلا تحويل وبلا HTML، ونوع `text/plain`.

**المتبقي على المالك (خارج نطاق كل تعديل برمجي):** أخطاء TikTok من نوع
«Request error: Something went wrong» بعد استلام ملف صحيح تُشير عادةً إلى **قيود على عقار
URL prefix نفسه** (تعارض المسار، أو كونه أُضيف مسبقاً، أو مشكلة حساب/حصص من جهة TikTok)
لا إلى محتوى الملف. الخطوة العملية: احذف عقار URL prefix وأعِد إضافته (سيولّد TikTok رمزاً
جديداً — اضبطه في `TIKTOK_VERIFICATION_TOKEN`)، أو راسل TikTok for Developers مع
`redirect`/معرّف التطبيق وأثر الطلب بعد أن صار الملف يُخدَم 200 بالمحتوى الصحيح.

**الشبكة/الوسيط:** الطلب الحقيقي وصل من `al-gharabi-ai.onrender.com` عبر الوسيط
(`viaProxy=true`) بوكيل `Go-http-client/1.1`، أي أن Cloudflare/Render لم يحجب طلب TikTok.
لا عطل شبكي.

اختبارات: `site.verification.test.ts` = **130 فحصاً** (الوضع الصارم افتراضياً + الصدّى
صراحةً + الرمز المرجعي الصحيح)، و`final-audit` يشمل
`site-verification-strict-default`، `site-verification-echo-opt-in`،
`site-verification-canonical-token`.


## تشخيص رفض مفتاح تطبيق TikTok — «correct the following: client_key» (2026-09-27)

**الرسالة الحقيقية من TikTok للحوار:** «We couldn't log in with TikTok … If you're a
developer, correct the following and try again: client_key». أُثبت أنها تعني **رفض قيمة
`client_key`** لا `redirect_uri` (رفض `redirect_uri` يعود بصيغة منفصلة
`error=param_error&error_type=redirect_uri&errCode=10006`).

**السبب الجذري المُثبت حياً (لا تخمين):** المفتاح المُرسل غير مطابق لبيئة التطبيق — أشهر
حالة: **خلط مفتاح Sandbox مع Production** (أو العكس). تعليق في وثائق Postiz: «Creating an
organization and then activating Sandbox Mode … **Note that the Client_ID and Secret are
different for the Sandbox environment!**»، وهو نفس عطل `#167`/`#1161` في مجتمعهم.

**إثبات حي للمزود (2026-09-27) — يميّز الحالات بدقة عبر `client_credentials`:**

| الطلب | استجابة TikTok |
|---|---|
| مفتاح مجهول (`abcINVALIDkey123`) | `400 {"error":"invalid_client","error_description":"Client info is illegal or malformed."}` |
| مفتاح بصيغة سليمة لكن غير مسجّل (`awzzz…`) | `invalid_client` (نفسه) |
| مفتاح فارغ | `invalid_request` — `The request parameters are malformed.` |
| مفتاح/سرّ مقبولان (أي حساب حقيقي) | `unsupported_grant_type` — `Grant type in request is unsupported.` |

الخلاصة: `invalid_client` = **TikTok لا يعرف هذا المفتاح** (بيئة/تطبيق مختلف)؛
`unsupported_grant_type` = **المفتاح والسرّ مقبولان**. أما حوار `/v2/auth/authorize/`
بمفتاح مجهول فيُعيد 302 إلى شاشة دخول `enter_from=dev_<client_key>` بلا رفض (الفحص بلا
كوكيز لا يفصل)، فالاعتماد على فحص `client_credentials` هو الحكم.

**الإصلاح البرمجي (يمنع التخمين ويثبت التطابق بلا كشف أي سرّ):**
- `engine/social/tiktok.ts`: `clientKeyFingerprint` (طول + قيمة مُخفاة أول4/آخر4 + بصمة
  SHA-256 مقتطعة)، `maskSecretValue`، و`classifyTikTokClientKeyError` (يفرّق
  `invalid_client` عن `invalid_request` عن `unsupported_grant_type` عن `network`).
- `TikTokClient.verifyClientKey` يطلب `client_credentials` فعلياً (بلا رمز مستخدم وبلا
  حصة تفاعل) ويترجم النتيجة إلى `recognized: true|false`.
- `server.ts`: `tiktokClientKeyDiagnosis()` يجمع: أي متغيّر بيئة يُقرأ، القيمة مُخفاة،
  هل البيئة تحمل مسافة زائدة، **ما يظهر فعلاً في رابط التفويض** (نفس القناة
  `envSecret`→`buildAuthorizationParams`)، المفتاح المطلوب في لوحة TikTok بنفس البصمة،
  والحكم من مزود TikTok. يُعرض في `oauth/setup` (كتلة `clientKeyDiagnosis`) وفي مسار
  جديد **`GET /api/platforms/tiktok/client-key-diagnosis` (للمالك فقط)**، ويُسجَّل سطر آمن
  `tiktok-oauth-start` عند كل بدء OAuth. `oauth/start` يعيد `tiktokClientKey` (مُخفى +
  بصمة فقط). **لا يُطبع المفتاح ولا السرّ كاملين في أي مكان.**

**إجراء المالك المباشر:** افتح `/api/platforms/tiktok/client-key-diagnosis` (للمالك)
واقرأ `configuredValueMasked`/`configuredValueLength` ثم قارنهما بـClient key في TikTok
Developers → Basic information:
- إن ظهر `verdict=not_recognized_by_tiktok` فالمفتاح إمّا من بيئة Sandbox/تطبيق آخر أو
  منسوخ خطأً → انسخ Client key الصحيح لنفس التطبيق إلى `TIKTOK_CLIENT_KEY` وأعد النشر.
- إن ظهر `verdict=recognized_by_tiktok` فالمفتاح مقبول على مستوى Open API، ويبقى فحص
  شاشة الحوار (وضع التطبيق Sandbox/Production + Redirect URI المسجّل بالضبط).

اختبارات: `tiktok.connector.test.ts` = **255 فحصاً** (مجموعة `3d` وحدة للإخفاء/البصمة/التصنيف،
وفحوص تكامل تثبت `recognized_by_tiktok` عبر الخادم الوهمي والتصريح على مسار التشخيص).
final-audit: `tiktok-clientkey-fingerprint-single-source` … `tiktok-clientkey-tests`
(362 فحصاً إجمالاً).

## دفعة YouTube — فحص القناة (قراءة فقط) من الواجهة + تجديد access token (Batch 15, 2026-09-27)

بعد إثبات الربط الحقيقي (commit `382e424`)، أُغلقت فجوتان عمليتان قبل اعتماد YouTube:

1. **الفحص لم يكن متاحاً من الواجهة.** `GET /api/platforms/youtube/health` كان يستدعي
   `channels.list?mine=true` (قراءة فقط) لكنه بلا سطح واجهة (`getPlatformHealth` مُعرّفة
   وغير مستدعاة من أي مكوّن).
2. **لا مسار تجديد لرمز Google.** `youtubeRefreshToken()` و`YouTubeClient.refreshAccessToken`
   كانا معرّفين وغير مستدعيين، فانتهاء access token (عمره ~ساعة) يسقط الاتصال إلى
   `reauth_needed` رغم وجود refresh token صالح.

الإصلاح (بلا لمس Google Cloud/Render، وبلا توسيع نطاق YouTube):
- `server.ts`: `ensureYouTubeAccessToken()` يجدّد عبر `refresh_token` المخزّن مشفّراً بنفس
  مبدأ TikTok — لا يعيد OAuth ما دام الرمز صالحاً أو refresh متاحاً، ويُعلن `reauth_needed`
  **فقط** عند فشل تجديد فعلي. كل الكتابات تمر عبر `persistStateDurable()`، ولا يُسجَّل أي رمز.
- `fetchYouTubeChannelResilient()` غلاف واحد يجدّد ثم يقرأ القناة، ويُستخدم في
  `verifyProviderConnection` ومسار `/api/platforms/youtube/health`، فيصمد الفحص بعد انتهاء الرمز.
- استجابة health تحمل `tokenRefreshed`، و`/api/health.youtubeOAuth` يعلن `tokenRefreshable`
  (منطقي فقط بلا قيمة).
- واجهة: `YouTubeStatusPanel` في `PlatformConnectionCenter` (للمالك): زر «فحص القناة — قراءة
  فقط» يستدعي `apiService.getPlatformHealth('youtube')`، ويعرض `accountName`/`accountId`/
  `checkedAt` وحالة «ناجح»، وعند 409 يعرض «إعادة ربط Google مطلوبة» مع زر OAuth. لا يُعرض أي
  token/secret.
- **القدرات لم تتغيّر:** `video_upload`/`comments_read`/`comment_reply`/`analytics`/
  `scheduling` تبقى NOT_IMPLEMENTED، و`webhook_pubsub` REQUIRES_REVIEW.

اختبارات: `youtube.connector.test.ts` = **94 فحصاً** (كان 73): رمز صالح بلا تجديد، رمز منتهٍ
+ refresh صالح => الفحص ينجح ويُعلن `tokenRefreshed`، فشل refresh => reauth_needed، لا تسريب
أي token/secret، وربط الواجهة. final-audit = **390 فحصاً** (`youtube-token-refresh-single-source`
… `youtube-refresh-tests`). النشر: `0294132` — تأكد أن `/api/health.youtubeOAuth.connected:true`
و`providerVerified:true` و`tokenRefreshable:true`.

**نقطة توقف المالك (لاحقاً):** أُنجزت هذه الدفعة لتثبيت الاتصال الدائم؛ وظائف YouTube الفعلية
(رفع/نشر/تعليقات/تحليلات) تبقى مؤجّلة ولم تُعلن.

## إصلاح جذري: وجهة إعادة التوجيه في تدفّق Instagram الرسمي + صدق config_id (2026-09-27)

### السبب الحقيقي لعطل «لم يُربط بعد» — ليس Meta config_id
مسار Instagram الرسمي (وثيقة «Facebook Login for Business - Instagram API») يستخدم
`response_type=token`، وMeta تُلحق الرمز في **مقطع الاستجابة** (`#access_token=...`).
المقطع لا يُرسَل إلى الخادم إطلاقاً. فطلب GET الواصل إلى
`/api/platforms/instagram/oauth/callback` **بلا state وبلا code** هو وجهة إعادة التوجيه
الحقيقية التي يفتحها المتصفح — وقد كان يرد **400** («جلسة OAuth غير معروفة») فيتوقف
إكمال الربط تماماً، ويبقى Instagram «لم يُربط بعد» رغم أن Meta أرجعت الرمز فعلاً.

الدليل الحي على الإنتاج: طلب GET للمسار أرجع `HTTP/2 400` بنص «فشل التحقق من جلسة OAuth».
وتدفّق Facebook لم يتأثّر لأنه `response_type=code` (يحمل `?code=` في سطر الطلب).

**الإصلاح:** `platformOauthFragmentReturn(req)` يكتشف GET بلا state/code/error لمسار
إرجاع OAuth معروف، و`serveSpaIndex(res)` يخدم `dist/index.html` كي يقرأ تطبيق React
المقطع ويرسله POST في الجسم (`completePlatformOAuthFragment`). الطلب الذي يحمل
state/code/error يبقى للمعالجة العادية (لا يخدم React)، فلا تُضعَف أي حماية.

### خطأ ثانٍ مُثبت: رابط هجين غير موثّق (config_id + extras)
`buildAuthorizationParams` كان يرسل `config_id` مع `display=page` و`extras=IG_API_ONBOARDING`
و`response_type=token` في الوقت نفسه لـInstagram. وثيقة مسار Instagram تُعرّف الرابط
بستة معاملات **بلا config_id**؛ الروابط الهجينة تردّها Meta بـ500 «حدث خطأ ما» (وأي
`config_id` وهمي/غير موجود يُعيد 500 أيضاً — مُثبت حياً). الإصلاح: `instagramOnboardingFlow`
بوابة واحدة؛ في تدفّق الإعداد الموحّد **يُتجاهَل config_id ويُبقى scope**، وفي التدفّق
العادي (`INSTAGRAM_OAUTH_ONBOARDING=false`) يُطبَّق config_id مع `response_type=code`
والحذف الكامل لـscope. Facebook لا يتأثّر.

### صدق الإعلان (بلا إيهام)
- `effectiveLoginConfigIdFor(platform)` يحسب config_id **المُطبَّق فعلاً**، و
  `loginConfigIdUsed`/`permissionSource`/`instagramOnboardingFlow` في `oauth/start`
  و`oauth/setup` تعكسها، فلا يُعلن استخدام Configuration بينما الرابط يحمل scope.
- فحص الحوار في `oauth/setup` (`buildAuthorizationUrlForProbe`) كان يفرض التدفّق
  الموحّد مفعّلاً دائماً، فيعرض مساراً مختلفاً عن الحقيقي عندما يعطّل المالك المفتاح.
  الآن يحترم `instagramOnboardingEnabled()`.
- `authorizationUrlParams` في رد `oauth/start` يُعلن **معاملات الرابط النهائي** الفعلية
  (بلا سرّ) للتحقق بلا تخمين (config_id عام، وclient_id/redirect_uri معلنان أصلاً).
- الرفض الذي تعيده Meta في **المقطع** (`error=...`) صار يُعرض في الواجهة بدل إهماله صامتاً.

### ما لم يتغيّر (عن قصد)
- `INSTAGRAM_REQUIRED_SCOPES` تبقى 9 بلا `pages_read_user_content`: لا استدعاء في الكود
  يقابلها في هذا المسار، وإضافة صلاحية بلا استدعاء تزيد سطح الرفض — قرار موثّق مسبقاً.
- `business_management` مطلوبة (صفحات Business Manager)، وFacebook/YouTube/Telegram
  بلا أي تغيير (انحدارها كلها ناجح).

اختبارات: `instagram.connector.test.ts` = **196 فحصاً**: مجموعة `6د` تثبت أن وجهة
المقطع تخدم React (200 + عنصر الجذر) وأن مسار Facebook كذلك وأن الطلب الذي يحمل
state يبقى 400؛ ومجموعة `6أ` تثبت config_id في التدفّق العادي، وتجاهله مع extras في
التدفّق الموحّد، و`loginConfigIdUsed=false` مع `loginConfigIdConfigured=true`، والمعاملات
الرسمية الستة. فحوص final-audit الجديدة: `instagram-fragment-return-serves-spa`,
`instagram-fragment-return-no-state-only`, `instagram-fragment-return-spa-safe`,
`instagram-fragment-return-tests`, إضافةً إلى `oauth-config-id-effective-honest` و
`instagram-probe-matches-real-flow` (396 فحصاً إجمالاً).

**ما بقي على المالك (إجراء خارجي واحد لا ينفّذه أي وكيل):** بعد نشر هذا الإصلاح، اضغط
«بدء الربط» وأكمل الموافقة بحساب Instagram **مهني** مرتبط بالصفحة. سيقرأ المتصفح الآن
المقطع ويُكمل الربط تلقائياً. إن ظهر «حدث خطأ ما» **بعد** تسجيل الدخول، فاضبط
`INSTAGRAM_OAUTH_ONBOARDING=false` في Render وأعد المحاولة (يتحوّل للتدفّق العادي بلا
`extras` — مخرج عطل Meta 1850019) بلا نشر جديد.



## الجذر المُثبت لعطل «حدث خطأ ما» في Instagram — config_id إلزامي لتطبيق Business (2026-09-27)

**السؤال المطروح:** هل يجب إضافة `config_id`؟ نعم — أُثبت ذلك بالكود والسلوك الحي ووثيقة Meta،
لا بالتخمين.

**الدليل الحي (بلا أي سرّ):** رابط حوار Meta لمعرّفات تطبيق صالحة متعددة (`145634995501895`
و`124024574287414` و`442224939723604`) أعاد:
- بلا `scope`: 302 إلى `login.php` مع `is_business_login=0`.
- مع `scope` (أي صلاحية): 302 إلى `login.php` مع **`is_business_login=1`**.
- مع `config_id`: 302 إلى `login.php` مع `is_business_login=0`.

أي أن Meta توجّه الحوار الذي يحمل `scope` إلى **واجهة Business Login**. وهذه الواجهة تقرأ
الصلاحيات من **Configuration عبر `config_id`** لا من `scope` (وثيقة Facebook Login for
Business: «Business Login uses a Configuration and a config_id instead of scope»).
فإن غاب `config_id` بقيت الصلاحيات **فارغة**، فيعرض الحوار بعد تسجيل الدخول صفحة Meta
العامة «Sorry, something went wrong» («This app needs at least one supported permission»)
ولا يعود أي `code`/رمز — وهو بالضبط عطل الإنتاج.

**الوضع في الإنتاج قبل الإصلاح:** `loginConfigIdUsed=false` و`permissionSource=oauth_scope_parameter`
(لا Configuration ID مضبوط)، والرابط يحمل `scope` على واجهة Business Login => لا صلاحيات =>
رفض بعد الدخول. كان ادّعاء `oauth/setup` أن config_id «غير مطلوب لـInstagram» **خطأً**.

**الإصلاح (مصدر واحد):**
- `engine/social/oauth.ts`: عند وجود `config_id` صالح لـFacebook **أو Instagram** يُمرَّر
  `config_id` **بدل** `scope`، ويُعاد **قبل** فرع `extras/display` فلا يُنتج رابط هجين
  (`config_id` + `extras`) أبداً. بلا `config_id` يبقى المسار الموثّق (`scope` + extras).
- `server.ts`: `effectiveLoginConfigIdFor` يعيد المعرّف المضبوط الصالح لأي من المنصتين (لم
  يعد يُتجاهل لـInstagram)، ودليل `loginForBusinessSetup` يُعرض لـFacebook وInstagram معاً.
  `oauth/setup` يعلن `configIdRequired`/`configIdUsed`/`configIdSource`، وreadiness/health
  يعلنان `configurationRequired`/`configurationReady`/`nextAction` بصراحة.
- الواجهة: `PlatformConnectionCenter` يعرض تنبيهاً صريحاً عندما لا يكون `config_id` مفعّلاً،
  ويشرح أن تطبيق Business يرفض `scope` بلا Configuration، مع خطوات الإنشاء.
- `.env.example` و`render.yaml` يوثّقان أن `INSTAGRAM_LOGIN_CONFIG_ID` **مطلوب** لتطبيق Business.

**ما لم يتغيّر:** التدفّق الموثّق بلا config_id (display/extras/response_type=token + scope)
يبقى كما هو ويُستخدم حين لا يوجد config_id؛ `INSTAGRAM_REQUIRED_SCOPES` تبقى 9؛ Facebook/YouTube/
Telegram/TikTok بلا تغيير (انحدارها ناجح).

اختبارات: `instagram.connector.test.ts` = **202 فحصاً** (مجموعة `6أ` تثبت أن config_id يحلّ محل
`scope` ويُلغي extras/display حتى مع المفتاح مفعّلاً، وأن الرابط النهائي نظيف بلا `scope`،
و`oauth/setup` يعلن config_id المُطبَّق ومصدر الصلاحيات من الConfiguration). `platform.foundation.test.ts`
= 94 فحصاً (وحدة: config_id لـInstagram يحلّ محل scope ويُلغي extras). `final-audit` = **398 فحصاً**
(`oauth-config-id-overrides-extras`, `instagram-config-id-required`, `instagram-config-ready-flag`،
وحذف الفحص القديم الذي كان يؤكّد «config_id غير مطلوب»).

**نقطة توقف المالك (إجراء خارجي واحد لا ينفّذه أي وكيل):** في Meta App Dashboard →
**Facebook Login for Business → Configurations** أنشئ Configuration (نوع User access token)
بالصلاحيات الثمانية التي يعرضها `/api/platforms/instagram/oauth/setup` في حقل `scopes`، ثم انسخ
**Configuration ID** (أرقام فقط) وضعه في Render → Environment باسم `INSTAGRAM_LOGIN_CONFIG_ID`
(أو `FACEBOOK_LOGIN_CONFIG_ID`)، وأضف Redirect URI المسجّل في `oauth/setup` إلى Valid OAuth
Redirect URIs، ثم أعد النشر واضغط «بدء الربط». بعد الإصلاح يقرأ الرمز من سطر الطلب
(`response_type=code`) ويُكمل الربط ويُحفظ مشفّراً في Postgres.

## العقل المركزي التنفيذي (Central AI Agent) — Batch 16 (2026-09-27)

العقل المركزي لم يكن كافياً كواجهة «مستشار»: أُضيف **منسّق تنفيذي حقيقي** يدير دورة
كاملة (فهم → تخطيط → أدوات → تنفيذ → تحقق → سجل) بصلاحيات مفروضة على الخادم، وسجل
تنفيذ مفصّل، ودوام بعد إعادة التشغيل، وربط ببوابات النشر القائمة بلا تجاوز.

**الوحدات الجديدة (`engine/agent/`، منطق خالص قابل للاختبار):**
- `permissions.ts`: مستويات الصلاحية الخمسة (`READ`/`WRITE`/`EXECUTE`/`EXTERNAL_ACTION`/
  `SENSITIVE`) + مصفوفة `staff`/`owner`/`system` + `canUseTool` + `toolRequiresApproval`.
  **staff يقرأ وينفّذ فقط؛ الكتابة والحساس والخارجي للمالك وحده.**
- `tools.ts`: سجل **19 أداة** (مصدر واحد) كل واحدة: معرّف + وصف عربي + صلاحية + معاملات +
  منفّذ حقيقي مربوط بوظائف الخادم عبر `AgentToolContext`. لا قدرة غير موجودة.
- `planner.ts`: تصنيف نية **حتمي** (`diagnose`/`status`/`content`/`analysis`/`verification`/
  `jobs`/`report`) + كشف المنصات + بناء خطة خطوات. العمليات الحتمية `requiresAi:false`.
- `orchestrator.ts`: المنسّق — `createTask`/`run`/`replay`/`snapshot`/`restore`، مهلة لكل
  خطوة (`withTimeout`)، إعادة محاولة محدودة للأخطاء القابلة للإصلاح فقط، `setToolContext`
  لمنع تطاير السياق بين المستخدمين، وحماية من التنفيذ المتزامن المزدوج.
- `providerRouter.ts`: موجّه المزوّدين (Gemini أساسي، ثانوي/مستشار اختياري) + `shouldUseCouncil`
  (لا يُفعّل بلا مزوّد ثانوي مضبوط — لا مزوّد وهمي) + `primaryProvider`.
- `routes.ts`: مسارات `/api/agent/*` المحمية (`health`/`tools`/`providers`/`tasks` CRUD + replay).

**قواعد ملزمة مطبَّقة:**
- **لا تنفيذ خارجي تلقائي**: أي أداة `EXTERNAL_ACTION` تُحجب داخل المهمة و`task.status='waiting'`
  (`EXTERNAL_APPROVAL_REQUIRED`)، ولا تُنفَّذ إلا بموافقة صريحة.
- **العمل الخارجي يمر بنفس البوابات**: `executeApprovedJob` (مستخرجة من مسار
  `/api/control/jobs/:id/execute`) تشترط جاهزية المهمة + اتصالاً موثقاً + موصلاً حقيقياً.
- **لا نجاح وهمي**: `task.verified` يُحسم من نجاح خطوات فعلية؛ فشل أداة ذات أثر يُوقف المهمة
  بحالة `failed` وكود فشل صريح.
- **إخفاء الأسرار**: `sanitizeContext` يُسقط أي مفتاح سرّي (token/secret/key/otp...) قبل
  حفظ لقطة السياق، ولا تُسجَّل ولا تُعاد أي قيمة سرّية.
- **الدوام**: سجل المهام يُحفظ في المخزن عبر `STORAGE_KEY_AGENT` (`loadAgentStateSync`/
  `saveAgentState`) ويُسترجع عند الإقلاع — يصمد بعد restart/cold start.
- **إعادة استخدام محرك AI القائم** (`aiEngine.run`) لا مزوّد ثانٍ ولا مفاتيح جديدة.

**الواجهة**: `src/components/agent/CentralAgentConsole.tsx` — تبويب «العقل المركزي»
(`central_agent`): إرسال مهمة، عرض حالتها/خطتها/سجل خطواتها/نتائجها، إعادة تشغيل، مرجع
الأدوات. تعرض نتيجة الخادم الفعلية فقط بلا أي ادّعاء نجاح محلي.

`/api/health` يعرض `centralAgent` (`enabled`/`tools`/`tasks`/`lastStatus`/`lastVerified`/
`providers`) بلا أي سرّ. اختبار: `engine/tests/agent.central.test.ts` (`npm run test:agent`،
71 فحصاً). فحوص final-audit الجديدة: `agent-module-structure` … `agent-tests-cover-critical`
(422 فحصاً إجمالاً).

## إيقاف التوجيه إلى «حدث خطأ ما» عند رصد Business Login بلا config_id (2026-09-27)

**الجذر المُثبت حياً (لا تخمين):** رابط حوار Meta لمعرّف تطبيق صالح بلا `scope` يعيد
`is_business_login=0`، وبـ`scope` يعيد **`is_business_login=1`** (واجهة Business Login)،
وبـ`config_id` يعيد `is_business_login=0` + `config_id`. واجهة Business Login تقرأ
الصلاحيات من **Configuration** عبر `config_id` لا من `scope`، فتكون الصلاحيات فارغة
«This app needs at least one supported permission» => «Sorry, something went wrong» بعد
تسجيل الدخول بلا إرجاع رمز. (أُعيد إنتاجه بوكيل سطح مكتب وبوكيل جوال iPhone على `www`
و`m.facebook.com` عبر `curl`/`node fetch`.)

**الفجوة البرمجية الحقيقية:** `probeMetaDialog` كان **يكشف** `businessLoginSurface`
لكنه لا يفعل بها شيئاً؛ فيُمرَّر الربط ويُرسَل المالك إلى فشل مضمون. أُصلح:
- `server.ts` (`/oauth/start`): بعد الفحص، إن رُصد `businessLoginSurface === true` مع
  غياب `config_id` يُرد **409 `META_BUSINESS_LOGIN_REQUIRES_CONFIG_ID`** بإجراء دقيق
  (`loginConfigEnvNames`، `scopes` المطلوبة للConfiguration، `redirectUri`، `setupUrl`)
  وسطر سجل آمن `business_login_without_config` — بلا أي سرّ. **لا حجب** عند
  `businessLoginSurface=null` (تعذّر الفحص) ولا عند Business Login **مع** config_id.
- `metaScopeWithoutConfigOverride()`: مفتاح تجاوز صريح `META_ALLOW_SCOPE_WITHOUT_CONFIG`
  يمنع حجباً مزمناً بلا تعديل كود إن ثبت أن المتطلب يُوفَّر بطريقة أخرى (Use Case). الافتراضي: الحجب.
- `oauth/setup`: يُضاف `metaDashboardUrls` (روابط مباشرة لـApp Dashboard/Configurations/
  Basic Settings/Roles عبر App ID **العام** المعلن أصلاً في رابط التفويض) بلا أي سرّ.
- `.env.example` و`render.yaml`: توثيق `INSTAGRAM_LOGIN_CONFIG_ID` كـ**مطلوب** لتطبيق
  Business، وإضافة `META_ALLOW_SCOPE_WITHOUT_CONFIG` (`sync: false`).

اختبارات: `instagram.connector.test.ts` = **209 فحصاً** (المجموعة 23: حجب 409 بالإجراء
الدقيق، ومفتاح التجاوز يعيد 200). `facebook.connector.test.ts` = 231 (بلا تغيير).
final-audit = **426 فحصاً** (`meta-business-login-requires-config-block` … `-block-tests`).

**نقطة توقف المالك (نقرة واحدة لا ينفّذها أي وكيل):** افتح
`https://developers.facebook.com/apps/<APP_ID>/fb-login-for-business/configurations/`
(الرابط الدقيق في `oauth/setup.metaDashboardUrls.configurations`) → Create configuration →
نوع **User access token** → أضف الصلاحيات في حقل `scopes` → انسخ **Configuration ID**
(أرقام فقط) → Render → Environment → `INSTAGRAM_LOGIN_CONFIG_ID` → أعد النشر. بعد ذلك
يحلّ `config_id` محل `scope` ويُكمل الربط ويُحفظ مشفّراً. (المتطلب الأساسي المتبقي بالضبط:
مُعرّف Configuration واحد من جلسة مالك Meta — لا يمكن لأي وكيل برمجي إنشاؤه نيابةً عنه.)

## إثبات المسار الكامل بعد Configuration ID + إظهار الحالة في /api/health (2026-09-27)

إكمال مباشر للبند أعلاه في نفس يوم الإصلاح (دفعة على `main` بعد `d1721a7`):
- **إظهار جاهزية Configuration في `/api/health`** بجانب `/api/readiness`:
  `instagramOAuth.loginConfigId{Configured,Valid,Used}` و`configurationReady`. سبب الوجود:
  كانت الحالة التشخيصية في `readiness` فقط، فيجب أن يرى المالك فوراً من بوابة الصحة أن
  `INSTAGRAM_LOGIN_CONFIG_ID` غير مضبوط (`configurationReady=false`) والإجراء المطلوب.
- **اختبار تكاملي للمسار الكامل** في `instagram.connector.test.ts` (المجموعة `6أ` الفرعية):
  `config_id => /oauth/start (config_id بلا scope) => callback بسطر الطلب => تبادل الرمز
  => اكتشاف الحساب المهني => اشتراك الصفحة => CONNECTED + VERIFIED`. كان الفحص يقف عند
  توليد الرابط فقط، فلا يُثبت أن الإكمال يعمل فعلاً بعد ضبط Configuration ID.
- فحصا final-audit: `instagram-config-ready-in-health` و`instagram-config-id-full-flow-test`.

**حالة الإنتاج قبل تدخل المالك (مؤكدة بعد النشر `62aa2fa`):**
`https://al-gharabi-ai.onrender.com/api/health` → `instagramOAuth`:
`clientIdConfigured=true`, `clientSecretConfigured=true`, `appSecretConfigured=true`,
`scopeCount=9`, `loginConfigIdConfigured=false`, `configurationReady=false`,
`onboardingFlow=disabled`؛ و`readiness.instagramOAuth.nextAction` يوجّه لإنشاء Configuration.
أي أن الإصلاح البرمجي كامل، والمتبقي الوحيد هو إدخال Configuration ID من جلسة المالك.
(Render ينشر تلقائياً عند الدفع لأن `autoDeploy: true`؛ لا وكيل برمجي يوافق على شاشة Meta
نيابةً عن المالك، وهو حد خارجي لا يمكن تجاوزه من الكود.)


## تفويض تشغيل YouTube من المالك إلى العقل المركزي (Batch 17, 2026-09-28)

كانت بوابات المشروع تمنع **كل** عملية خارجية (EXTERNAL_ACTION) من داخل مهمة العقل، فتصبح
مهام الرد/الرفع على YouTube بلا نتيجة (تُحجب وتبقى `waiting`). هذا صحيح أمنياً لكنه يجعل
العقل عاجزاً عن إدارة القناة فعلياً. الحل: **تفويض تشغيل صريح محدود النطاق** يمنحه المالك
للعقل، بلا إلغاء أي حارس أمني.

**وحدة `engine/social/youtubeDelegation.ts` (منطق خالص قابل للاختبار):**
- `YOUTUBE_DELEGATION_ACTIONS` = `reply` / `publish` / `schedule` / `update_video`، والنطاق
  محصور بـ`youtube` دائماً (`YOUTUBE_DELEGATION_SCOPE`)؛ أي نطاق آخر يُسقَط في التطبيع.
- `buildYouTubeDelegation` / `revokeYouTubeDelegation` / `normalizeYouTubeDelegation` /
  `youtubeDelegationStatus` (حالات: `not_granted` / `active` / `expired` / `revoked`) /
  `evaluateYouTubeDelegation` (يسمح فقط للمالك + التفويض الفعّال + العملية الممنوحة).
- `requiredDelegationActions`: النشر المجدول (`publishAt`) يحتاج `publish` **و**`schedule`
  معاً، فلا جدولة غير مفوّضة. `YOUTUBE_TOOL_DELEGATION` خريطة الأداة→العملية (مصدر واحد).
- **لا تفويض افتراضي**: يبدأ `granted:false`. **لا سرّ** في الوحدة إطلاقاً.

**بوابة المنسّق (`engine/agent/orchestrator.ts`):** عند خطوة `EXTERNAL_ACTION` تُحلّ
المعاملات أولاً ثم يُستدعى `delegationCheck` المحقون من الخادم:
- مسموح ⇒ تُنفَّذ عبر **نفس المنفّذ الحقيقي** (كل بوابات المشروع سارية داخله).
- ممنوع ⇒ الخطوة تُسجَّل بكود التفويض الصريح والمهمة تبقى `waiting` (لا تنفيذ).
- فشل أداة خارجية **مفوّضة** يوقف المهمة بحالة `failed` (لا يُتجاهل) — أُضيف
  `EXTERNAL_ACTION` إلى قائمة الأدوات ذات الأثر التي تُوقف عند الفشل.
- مراجع السياق (`fromContext`) جديدة: تسمح بتمرير `commentId`/`replyText`/`videoId` الحقيقية
  من جسم المهمة، وإن غابت تفشل الخطوة بـ`MISSING_ARGUMENT` (لا معرّف مُختلق).

**منفّذات مشتركة (مصدر واحد، بلا تجاوز):** `executeYouTubeReply` و`executeYouTubePublish`
في `server.ts` تمرّ بكل البوابات (اتصال موثق → force-ssl → سلامة المحتوى → منع التكرار →
منع الرد على حساب المعرض → rate limit → idempotency → التنفيذ). يستخدمها **المسار الخارجي
والعقل المركزي معاً**، فلم يعد للعقل مسار يتجاوز بوابة. كان `youtubeReply` في سياق الأدوات
يستدعي `comments.insert` مباشرة بلا سلامة محتوى/منع تكرار — أُصلح.

**REL-01 — قفل داخل العملية يمنع الرد الخارجي المكرر (تدقيق جنائي، نتيجة HIGH #7):**
كل مسارات الرد الخارجي (`facebook/reply`, `facebook/message-reply`, `instagram/reply`,
`instagram/message-reply`, `executeYouTubeReply` — يستدعيها المسار اليدوي **ومراقب
يوتيوب التلقائي معاً**، `telegram/reply`) تتبع نمط "تحقق من عدم التكرار (`evaluateReplyGuard`
على سجل الذاكرة) ← انتظار شبكي حقيقي (إرسال فعلي للمزوّد) ← تسجيل الرد بعد الإرسال".
بين التحقق والتسجيل يوجد `await` حقيقي، فطلبان متزامنان لنفس الحدث الخارجي (نقرة مزدوجة
من المالك، إعادة محاولة بعد انقطاع شبكي، أو تزامن رد يدوي مع الرد التلقائي على يوتيوب)
كانا يتجاوزان الفحص معاً فيُرسلان رداً فعلياً مكرراً لعميل حقيقي على المنصة.
الإصلاح: `engine/social/replyInFlightLock.ts` (منطق صافٍ، بلا شبكة/سرّ) — مفتاح
(منصة+نوع الحدث+معرّف خارجي) يُحجز ذرّياً (`acquireReplyLock`، تحقق+إضافة في عبارة
متزامنة واحدة بلا `await` بينهما) **قبل** أي عمل في كل مسار، ويُفرَج عنه دائماً من
`finally` (`releaseReplyLock`) نجاحاً أو فشلاً. طلب ثانٍ متزامن لنفس المفتاح يُرفض فوراً
(409 `REPLY_IN_PROGRESS`) بلا أي إرسال خارجي. **حدود صريحة**: قفل داخل العملية فقط
(لا يغطي تعدد نسخ الخادم — يكفي اليوم، نسخة واحدة فعلية على Render). اختبار:
`engine/tests/reply.inflight.lock.test.ts` (بما فيه محاكاة مباشرة للسباق: طلبان
متزامنان، واحد فقط يصل فعلياً لمرحلة الإرسال).

**دورة حياة الرد (`engine/social/youtube.ts`):** `resolveYouTubeReplyState` +
`YOUTUBE_REPLY_LIFECYCLE_STATES` = `draft` / `approved` / `sent` / `failed`.
**لا `sent` بلا معرّف رد حقيقي من YouTube**؛ الفشل يُعلن `failed` صراحةً مع `deliveryError`.
السجل يحمل `state`/`stateLabelAr`/`approvedAt`/`sentAt`/`failedAt` بجانب الحقول القديمة.

**مسارات الخادم (للمالك):** `GET/POST/DELETE /api/platforms/youtube/delegation` (منح/عرض/
إيقاف). كل تغيير يُسجَّل في التدقيق (`youtube_delegation_granted`/`_revoked`) ويُحفظ عبر
المحوّل في `control.youtubeDelegation` فيصمد بعد إعادة التشغيل/cold start. `/api/health`
و`/api/readiness` يعرضان `youtubeDelegation` (منطقي بلا سرّ). **العمليات على غير YouTube
ممنوعة** (`TOOL_NOT_DELEGATABLE`) — لا Facebook/Instagram/TikTok/Telegram/X/أي منصة.

**أداة جديدة:** `youtube_video_update` (videos.update) خارجية وتخضع للتفويض.

**الواجهة:** `YouTubeDelegationPanel` في `PlatformConnectionCenter` (منح/إيقاف + عرض الحالة)
ووسم حالة التفويض في `CentralAgentConsole`.

اختبارات: `agent.central.test.ts` = **157 فحصاً** (مجموعات H/I/J للتفويض ودورة الحياة وبوابة
المنسّق) و`youtube.connector.test.ts` = **200 فحص** (مجموعة `12k-2`: لا تفويض ⇒ حجب و`waiting`
بلا `comments.insert`؛ منح `reply` ⇒ مهمة رد حقيقية `completed` بـ`state=sent` ومعرّف من
YouTube؛ إيقاف ⇒ حجب فوري). final-audit = **500 فحص** (`youtube-delegation-*`،
`youtube-reply-lifecycle-*`، `youtube-shared-*-executor`، `orchestrator-delegation-*`).

**نقطة توقف المالك (اختيارية):** التفويض يبدأ غير ممنوح (آمن افتراضياً). لمنح العقل إدارة
قناة YouTube فعلياً: افتح مركز ربط المنصات → بطاقة YouTube → «منح/تحديث التفويض» واختر
العمليات (الرد/النشر/الجدولة/التحديث). لا يمكن لأي وكيل برمجي منح تفويض نيابةً عن المالك.

## إصلاح جذري: طلب الدورة الكاملة كان يُختزل إلى مهمة «تحقق» (Batch 19, 2026-09-28)

**Root Cause المُثبت بإعادة إنتاج فعلية:** `classifyIntent` كان يفحص `VERIFY_RE`
(`/(تحقق|فحص النظام|جاهز|سلامة|استمراري|persistence|صحة النظام)/`) **قبل** أي معالجة
لـYouTube. وصياغة المالك الحقيقية تنتهي بـ«**وتحقق من وصوله من YouTube**»، فيلتقط
`VERIFY_RE` الطلب فوراً ويُعيد `verification` بخطتين فقط
(`system_health, system_verification`) — أي خطة قراءة/فحص بلا `youtube_reply`، فيظهر
`MISSING_ARGUMENT` عند فقدان commentId/text، أو لا يظهر مسار الرد أصلاً. وعامل ثانٍ:
مفردات التوليد/الإرسال كانت ضيّقة («اقترح» فقط) فلا تتعرّف على «**ولّد** رداً» ولا على
«**نفّذ** الرد» ولا على المرادفات.

**الإصلاح (بلا workaround):**
- مصادر مفردات واحدة في `planner.ts`: `YT_READ_VERB` (اقرأ/اجلب/حلّل/...) و
  `YT_COMMENT_WORD` و`YT_GEN_VERB` (اقترح/**ولّد**/صيغ/أنشئ/اكتب/جهّز/...) و
  `YT_SEND_VERB` (**أرسل**/ابعث/انشر/**نفّذ**/send/reply). يُبنى منها
  `YOUTUBE_FULL_CYCLE_RE` (قراءة+تعليق+توليد+إرسال) و`YOUTUBE_SEND_SUGGESTED_RE` و
  `YOUTUBE_REPLY_RE`، فيُكتشف الطلب حتى بصيغ المالك المرادفة.
- `wantsYouTubeReply` يمنح فعل الإرسال/التنفيذ الصريح أولوية (`YOUTUBE_EXPLICIT_SEND_RE`)
  فلا يُسقَط طلب إرسال لأنه يحوي «اقترح» عرضاً.
- **ترتيب `classifyIntent` صار:** YouTube update → publish → **cycle** → reply → youtube
  → **ثم** verification/diagnose. فالمذكور يوتيوب صراحةً يُوجَّه لمساره الحقيقي قبل أي
  التقاط عام لكلمة «تحقق».
- **دورة بلا ذكر المنصة** (`wantsYouTubeCommentCycle`): طلب تنفيذي صريح
  (اقرأ+تعليق+ولّد+أرسل) بلا «يوتيوب» يُوجَّه أيضاً إلى الدورة الكاملة، فلا يُختزل إلى
  قراءة/تحقق (حسب الشرط: لا تحويل طلب إرسال صريح إلى مهمة قراءة فقط).

**انتقال القيم (داخل نفس التنفيذ):** خطة `youtube_cycle` تمرّر
`youtube_comments.latestComment.commentId → youtube_reply.commentId` و
`ai_draft.latestAnalysis.iraqiSuggestedReply → youtube_reply.text` عبر `AgentArgRef.outputPath`
(محلولة في `orchestrator.resolveArgValue` من مخرَجات الخطوات الفعلية)، ثم
`youtube_reply_verify` يتأكد من تسجيل رد مُسلَّم بمعرّف من Google. لا يبقى أي `MISSING_ARGUMENT`
دائم لأن القيم تُقرأ آلياً من نتائج الخطوات السابقة، وفشلها الصريح يعني غياب تعليق حقيقي
(لا قيمة افتراضية).

اختبارات: `agent.central.test.ts` = **188 فحصاً** (منها فحوص الانحدار: صياغة المالك =>
`youtube_cycle` وليس `verification`؛ «تحقق من جاهزية النظام» يبقى `verification`؛ دورة بلا
منصة => `youtube_cycle`). final-audit = **519 فحصاً** (`youtube-cycle-before-verify`،
`youtube-cycle-synonyms`، `youtube-cycle-platform-agnostic`، `youtube-cycle-owner-phrase-test`،
`youtube-cycle-no-missing-arg-regression`).

## دورة YouTube الكاملة في مهمة واحدة — تمرير القيم الحقيقية من مخرَجات الخطوات (Batch 18, 2026-09-28)

**الجذر المُثبت:** مهمة تحليل تعليق YouTube كانت تعمل فعلاً (قراءة حقيقية عبر
`commentThreads.list` + `ai_draft` يولّد الرد العراقي)، لكن عند إنشاء مهمة رد مستقلة
تظهر `MISSING_ARGUMENT: commentId وtext مطلوبان`، لأن خطة `youtube_reply` كانت تقرأ
`commentId`/`replyText` من **سياق المهمة** فقط، ونتيجة مهمة التحليل السابقة لا تُحقن
تلقائياً في المهمة التالية. فالمستخدم مضطر لنسخ القيم يدوياً بين مهمتين، وإن لم يفعل
لا يُرسل الرد إطلاقاً.

الإصلاح — **دورة واحدة متكاملة** بلا نسخ يدوي:
- `planner.ts`: نية جديدة `youtube_cycle` تُكتشف حتمياً عبر `wantsYouTubeFullCycle`
  (طلب صريح يجمع: اقرأ/حلل/اقترح **وأرسل** الرد المقترح). لا تُصنَّف دورةً بلا فعل إرسال
  صريح، فمهام «اقترح رداً» تبقى في نية `youtube` بلا عملية خارجية. ترتيب الخطوات:
  `youtube_status → youtube_videos → youtube_comments → ai_draft → youtube_reply →
  youtube_reply_verify`.
- توسيع `AgentArgRef` بمسار متداخل `outputPath`: يُقرأ الحقل من كائن داخل مخرَج الخطوة
  السابقة، فيصل `youtube_comments.latestComment.commentId` و
  `ai_draft.latestAnalysis.iraqiSuggestedReply` حقيقيَّين إلى خطوة الرد. `resolveArgValue`
  يعيد `undefined` عند غياب القيمة فتفشل الخطوة بـ`MISSING_ARGUMENT` — **لا fake
  commentId ولا fake reply**.
- أداة جديدة `youtube_reply_verify` (**READ**): تتأكد من تسجيل رد مُسلَّم فعلياً على
  التعليق (بمعرّف رد من المزوّد) من سجل الردود الفعلي، وتُستخدم كخطوة تحقق أخيرة.
- **صدق التسليم**: `youtube_reply` ومنفّذ الرد `executeYouTubeReply` لا يعلنان
  `delivered=true` بلا `externalReplyId` حقيقي (كود `PROVIDER_NO_REPLY_ID`)، وأداة الرد
  ترفض النجاح بلا معرّف (`REPLY_NOT_DELIVERED`).
- **gates محفوظة**: `youtube_reply` تبقى `EXTERNAL_ACTION`؛ بلا تفويض تشغيل YouTube فعّال
  تُحجب الخطوة وتبقى المهمة `waiting` ولا يُستدعى المنفّذ إطلاقاً. مع التفويض يُنفَّذ عبر
  **نفس** `executeYouTubeReply` (سلامة المحتوى + منع التكرار + rate limit + idempotency).
  لم يُمسّ OAuth/scopes ولا أي منصة أخرى ولا Gemini ولا أي سرّ.

اختبارات: `agent.central.test.ts` = **183 فحصاً** (مجموعة K: التصنيف، ترتيب الخطة، حلّ
المسار المتداخل، وصول commentId/نص الرد الحقيقيين، منع الإرسال بلا commentId، منع الإرسال
بلا نص رد، الحجب بلا تفويض، حصر أدوات التنفيذ الخارجي) و`youtube.connector.test.ts` =
**215 فحصاً** (مجموعة 12k-3: دورة كاملة عبر HTTP تنتهي برد حقيقي `parentId=cmt_cycle`
ونصه الرد العراقي المقترح، ثم الحجب بلا تفويض). فحوص final-audit: `youtube-cycle-*`،
`argref-nested-output-path`، `youtube-reply-verify-*`، `youtube-reply-honest-delivery`،
`agent-console-delivery-state`.

## مدير تشغيل YouTube المستقل 24/7 (YouTube Autonomous Operations Manager) — Batch 18 (2026-09-28)

تحويل العقل المركزي من وكيل ينفّذ مهمة يدوية فقط إلى **مدير تشغيل حقيقي لقناة YouTube
يعمل 24/7** داخل خدمة Render (web process) **بلا أي اعتماد على المتصفح** — إغلاق
المتصفح/الهاتف لا يوقف المراقبة، لأنها job داخلي في الخادم.

**آلية العمل غير المتزامنة (لماذا هذا التصميم):** اختيرت مراقبة في نفس عملية الخادم
بدل Webhook لأن استقبال تعليقات YouTube webhook يستلزم Google Cloud Pub/Sub + endpoint
عام + قناة نشر — بنية خارجية جديدة وليست تحويلاً استباقياً حقيقياً. المراقبة الدورية
(كل **دقيقة واحدة** افتراضياً = 60,000ms، قابلة للضبط بحدود آمنة 1–60 دقيقة) تستخدم نفس الأدوات الحقيقية
الموجودة، بدون أي تعديل OAuth/scopes أو منصة أخرى.

**وحدة المنطق الخالص `engine/social/youtubeWatcher.ts` (بلا شبكة وبلا أسرار):**
- `YouTubeWatcherControls` + `defaultWatcherControls` (**آمن افتراضياً**: المراقبة قراءة/
  تحليل فقط؛ `autoReply`/`autoPublish`/`autoSchedule` معطّلة حتى يمكّنها المالك) + Kill
  Switch (`paused`).
- `watcherGate(controls, action)` — بوابة موحّدة لا تُتجاوز: القراءة مسموحة ما لم يكن
  `paused`، والإرسال يحتاج `enabled && !paused && !humanReviewMode && <الإذن>`.
- `decideCommentAction` — قرار حتمي: تعليق حساب المعرض/سبام/مُعالَج ⇒ تجاهل؛ شكوى/
  استفسار تجاري/حساس ⇒ **تصعيد للمالك بلا رد** (لا اختراع معلومات سعر/تقسيط)؛ سؤال عام/
  مدح/تفاعل بسيط ⇒ رد عند التمكين.
- `YOUTUBE_COMMENT_STAGES` (NEW→FETCHED→ANALYZED→REPLY_DECISION→REPLIED→VERIFIED +
  SKIPPED/ESCALATED/FAILED)، `hasProcessed`، `advanceCheckpoint` (منع المعالجة المزدوجة
  يصمد بعد restart).
- `computeCommentVelocity` (نوافذ ساعة/6/24/7أيام + اتجاه لا يُعلن بلا عيّنة كافية ≥4/24س)،
  `buildDailyBrief` (تقرير حتمي بلا AI)، `detectOpportunities` (أسئلة متكررة/قفزة تفاعل).

**دمج الخادم (`server.ts`):**
- حالة المراقبة تُحفظ عبر محوّل الحالة في مفتاح `youtubeWatcher`
  (`persistWatcherState`/`applyWatcherStateSnapshot`) وتُقرأ عند الإقلاع (file + Postgres)
  فتصمد بعد restart/deploy/cold start.
- `runYouTubeWatcherCycle` تقرأ الفيديوهات والتعليقات الحقيقية عبر نفس أدوات العقل، تعالج
  كل تعليق جديد (بحدٍّ ثابت 10 لكل دورة)، وتنفّذ الرد عبر **نفس `executeYouTubeReply`**
  (كل البوابات: اتصال موثق → force-ssl → سلامة محتوى → منع تكرار → منع الرد على حساب
  المعرض → rate limit → idempotency). لا مسار إرسال جانبي إطلاقاً.
- **بوابة التفويض محفوظة:** `watcherReplyExecutionReady()` تشترط اتصالاً موثقاً +
  `force-ssl` + تفويض `youtube_reply` فعّال؛ بلا ذلك يُصعَّد التعليق ولا يُرسَل شيء.
- **صدق التسليم:** لا يُسجَّل `REPLIED` ولا تُزاد عدّادات الرد/التحقق إلا بـ`externalReplyId`
  حقيقي من YouTube وحالة `sent`، ثم يُتحقَّق من سجل التسليم الفعلي → `VERIFIED`.
- `startYouTubeWatcher()` تُستدعى بعد `app.listen` (job داخلي مستقل عن المتصفح).
- مسارات المالك: `GET /api/agent/youtube/watcher` (حالة)،
  `POST .../watcher/controls` (Kill Switch/التمكين — `requireOwner`)،
  `POST .../watcher/poll` (دورة يدوية)، `GET .../watcher/brief` (التقرير)،
  `GET .../watcher/audit` (السجل). كلها عبر `authenticateToken`.
- `/api/health.youtubeWatcher` يعلن: النشاط، الإيقاع، آخر فحص/تعليق/رد/تحقق، المعلّق،
  الأخطاء، الزخم، الفرص — بلا أي سرّ.

**الواجهة:** `src/components/agent/YouTubeOperationsView.tsx` (تبويب
`youtube_operations` = «مدير تشغيل YouTube» في Sidebar) — تعرض الحالة الحقيقية من الخادم
فقط: التشغيل المباشر، عناصر التحكم/Kill Switch (للمالك)، التعليقات التي تحتاج تدخلاً،
الزخم، التقرير اليومي، وسجل الأتمتة.

**اختبارات:** `engine/tests/youtube.watcher.test.ts` (`npm run test:watcher`، **71 فحصاً**):
الافتراضي الآمن، البوابة، Kill Switch، دورة الحياة، القرار/التصعيد، منع التكرار،
الإيقاع، الزخم، التقرير، دورة محاكاة تثبت وصول `commentId`/نص الرد الحقيقيين للمنفّذ
ومنع الإرسال بلا أحدهما، وربط الـwatcher بالخادم/المنفّذ الحقيقي/بوابة التفويض. فحوص
final-audit الستة عشر: `youtube-watcher-module` … `youtube-watcher-tests` (**535 فحصاً**
إجمالاً).

**لا يُمسّ:** OAuth/credentials/scopes، Facebook/Instagram/TikTok/Telegram، Gemini، أي سرّ.
**نقطة توقف المالك:** لتشغيل الرد الآلي فعلياً: من تبويب «مدير تشغيل YouTube» فعّل
«الرد الآلي» (مع بقاء تفويض YouTube `reply` فعّالاً). بلا التمكين تبقى القناة تحت المراقبة
والتصعيد فقط — وهي الحالة الافتراضية الآمنة.

## إصلاح جذر «التصعيد الكاذب وتوقف الرد الآلي» في مراقب YouTube 24/7 (Batch 20, 2026-09-28)

**الدليل الحي من الإنتاج (`2f080a6`، بلا تخمين):** `youtubeWatcher.controls.autoReply=true`
و`autoReplyEffective=true` و`youtubeDelegation.granted=true, active=true, actions: reply/publish/
schedule/update_video` و`youtubeOAuth.connected/verified/forceSsl=true`، ومع ذلك العدّادات
`detected=7, replied=0, verified=0, escalated=6, skipped=1`. أي أن كل شيء «مفعّل» لكن **لا رد
يُرسَل إطلاقاً**، وأمثلة التصعيد كانت `'كم السعر؟'` (صحيح) و`'المعرض مرتب ما شاء الله ❤️'`
(خطأ: تفاعل إيجابي بسيط كان يجب أن يُردّ عليه).

**جذران مُثبتان:**
1. **عدم تطابق المشغّل في بوابة التفويض:** دورة المراقب تنفّذ الردة بمشغّل `system`
   (`youtubeDelegationCheck("system", …)`) و`watcherReplyExecutionReady()` كذلك، لكن
   `evaluateYouTubeDelegation` كان يشترط `operator === 'owner'` فقط ⇒ كل رد يُحجب
   بـ`DELEGATION_OPERATOR_NOT_OWNER` ويُصعَّد. التفويض صحيح، والقاطع خاطئ.
2. **تصنيف وصفات تفضيل خاطئ:** `PATTERNS.praise` لم يكن يحوي العبارات العراقية العفوية
   («مرتب»، «ما شاء الله»، «تسلمون») ولا الإيموجي الإيجابي، فيُصنَّف التعليق `other`
   بدل `praise`، ويُصعَّد بدل أن يُردّ عليه.

**الإصلاح (بلا لمس أي سرّ/مصادقة/منصة أخرى):**
- `engine/social/youtubeDelegation.ts`: `evaluateYouTubeDelegation` يقبل `owner` و`system`
  (العقل المركزي/المراقب الداخلي) ويُبقي `staff` ممنوعاً؛ النطاق يبقى YouTube فقط.
- `engine/social/comments.ts`: توسيع `praise` بالعبارات العراقية العفوية، وإضافة
  `POSITIVE_EMOJI_RE` + `EMOJI_ONLY_RE`؛ التعليق الإيجابي بالإيموجي (قلوب/إعجاب) صار
  `intent='praise'` و`sentiment='positive'` و`isPraise=true` بدل `other`. الردود الحتمية
  أُعيدت لصياغة عراقية عفوية قصيرة («هلا بيك»، «نورتنا»، «تدلل») بلا أي معلومة مُختلقة.
- `engine/social/youtubeWatcher.ts`: `decideCommentAction` صار يُصعَّد **بسبب حقيقي مرتبط
  بالمضمون** فقط (استفسار سعر/شكوى/حساس) مع رسالة محددة، أما تعذّر الرد بسبب **إعداد
  المالك** (autoReply مُطفأ/إيقاف مؤقت) فيُرجع `skip` لا `escalate` — فلا تصعيد كاذب.
- `server.ts`: كشف حلقات القناة نفسها بالمعرّف الحقيقي `authorChannelId === channelId`
  إضافةً للاسم، فلا يُصعَّد/يُردّ على ردود المعرض نفسه.

**القاعدة:** «مفعّل» في الإعداد لا يعني أن التنفيذ يعمل؛ يجب مطابقة المشغّل في **كل** بوابة
(هنا التفويض) مع المشغّل المستخدم فعلاً في نقطة التنفيذ. اختبارات: `youtube.watcher.test.ts`
= 97، `agent.central.test.ts` = 191، `youtube.connector.test.ts` = 215، وfinal-audit = 547
(`youtube-praise-iraqi-phrases`، `youtube-positive-emoji-interaction`، `youtube-iraqi-reply-dialect`،
`youtube-escalation-specific-reason`، `youtube-escalation-not-config-noise`،
`youtube-self-authored-by-channel-id`، `youtube-delegation-owner-only` أُثرِي بـsystem).

**ملاحظة إثبات حي (north star):** إثبات أن الرد يصل فعلاً إلى YouTube يحتاج قراءة تعليق حقيقي
(`commentThreads.list`) ثم تنفيذ `executeYouTubeReply` في نفس الجلسة القائمة على قناة المعرض؛
الرد الحقيقي لا يمكن اختلاقه، ولا يُنفَّذ أي رد/نشر/جدولة في دفعات الكود.

## Batch 22 — جذر «المراقب يقرأ ولا يرد»: قرار غير نهائي + تحرير تلقائي (2026-09-29)

**التتبّع الفعلي للقيمة (لا أسماء متغيرات):** مسار الدورة
`runYouTubeWatcherCycle` → `const controls = normalizeWatcherControls(watcherState.controls)`
→ `decideCommentAction({ ..., controls })`. القيمة التي تصل إلى القرار **هي
`watcherState.controls` المطبَّعة عند لحظة الدورة**، و`autoReplyEffective` المعروض في
الصحة/الواجهة محسوب من `watcherState.controls` نفسه — فلا انحراف بين الاثنين.

**جذر الالتباس المُثبت (زمني، لا منطقي):** كل سجلات المراقب على الإنتاج كانت بتوقيت
16:07–18:01Z، وcommit الإصلاح السابق `b4301bf` دخل الإنتاج ~19:11Z. أي أن `detected=7,
replied=0, escalated=6` **سجلات تاريخية** أُنتجت قبل الإصلاح: عندها كان `autoReply` الافتراضي
`false`، وكان فرع «الرد الآلي غير ممكّن» يُنتج **تصعيداً** (`requiresHuman: true`) بنص قديم
«الرد الآلي غير ممكّن حالياً؛ سُجّل التعليق للمالك بلا إرسال.» — وهو نص **لم يعد موجوداً في
الكود الحالي**. فالصحة أظهرت `autoReply=true` (الإعداد الحالي) بينما القرار التاريخي تعامل
مع `false` (الإعداد القديم). أُثبت حياً أن الكود الحالي (HEAD) يرد فعلاً: تعليق «عاشت إيدكم»
=> `comments.insert` بمعرّف رد، و«كم السعر؟» => تصعيد بلا اختراع.

**العيب الحقيقي الباقي في الكود:** حتى مع `autoReply=false`، كان التعليق القابل للرد يُوسَم
`SKIPPED` **نهائياً** في `watcherState.processed`، و`hasProcessed` يمنع إعادة معالجته. فلو
قرأ المراقب تعليقاً والأتمتة معطّلة ثم مكّنها المالك، **يُفقد التعليق للأبد** بلا رد.

**الإصلاح (بلا workaround ولا كسر أي حارس):**
- `engine/social/youtubeWatcher.ts`: `CommentDecisionCode` (8 أكواد حتمية) + `code` في
  `CommentDecision`؛ فرع تعذّر الإعداد صار `DEFER_AUTOREPLY_DISABLED` (skip غير نهائي) لا
  تصعيداً ولا تجاهلاً دائماً. `isDeferredDecision` و`releaseDeferredEntries` (يُزيل المؤجَّل
  فقط ويحفظ الرد/التصعيد/السبام/المكرر)، وحقل `deferred` في `WatcherProcessedEntry`.
- `server.ts`: عند `isDeferredDecision` تُسجَّل الحالة `SKIPPED + deferred:true` (تظهر
  كتأجيل إعداد لا كتصعيد)، وعند الانتقال «الرد معطّل → ممكّن» عبر
  `POST /api/agent/youtube/watcher/controls` تُحرَّر المؤجَّلة (`releasedDeferred`) فتُعاد
  تقييمها في الدورة التالية؛ وكذلك عند الإقلاع إن كان الرد ممكّناً أصلاً. عدّاد `deferred`
  يُعلن في `watcherStatusBlock` و`watcherLastRun`.
- توافق رجعي: التحرير يغطّي السجلات القديمة بنص «الرد الآلي غير ممكّن» فلا تبقى عالقة.
- الواجهة: `YouTubeOperationsView` تعرض عدّاد «مؤجَّلة» ونتيجة الدورة تشمل `deferred`.

**الحمايات لم تُمسّ:** التصعيد الحقيقي (سعر/شكوى/حساس) كما هو، Kill Switch، `humanReviewMode`،
بوابة التفويض `watcherReplyExecutionReady`، force-ssl، منع التكرار، والمنفّذ الموحّد
`executeYouTubeReply` وحده. **لا تعليق «عاشت إيدكم» خاص، ولا رد على كل التعليقات، ولا مساس
بأي OAuth/سرّ/منصة أخرى.**

اختبارات: `youtube.watcher.test.ts` = **105 فحوص** (مجموعة D2: أكواد القرار + التأجيل/التحرير
+ التوافق الرجعي)، `youtube.connector.test.ts` = **225 فحصاً** (مجموعة 12k-5 تكامل: تعطيل =>
تأجيل بلا إرسال؛ تمكين => `releasedDeferred` + رد حقيقي بـ`parentId` صحيح؛ Kill Switch =>
لا إرسال). فحوص final-audit: `youtube-escalation-not-config-noise` (مُحدَّث)،
`youtube-defer-release-on-enable`, `youtube-defer-release-legacy`, `youtube-defer-not-escalated`,
`youtube-decision-code-honest`, `youtube-watcher-deferred-counter`, `youtube-watcher-defer-cycle-test`
(553 إجمالاً). `npm run lint` + `npm run build` + `npm test` (EXIT=0) + `final-audit` كلها ناجحة.

**الإثبات الحقيقي المتبقي على المالك فقط:** إن كان الرد الآلي مفعّلاً، تُحرَّر التعليقات
المؤجَّلة تلقائياً بعد النشر ويبدأ الرد الفعلي في الدورة التالية؛ وإن كان معطّلاً، شغّله من
مركز «مدير تشغيل YouTube» (Owner) فيُحرَّر كل مؤجَّل ويُرد عليه فعلياً.

## ذكاء الرد الإنساني العراقي — YouTube/كل المنصات (2026-09-26)

**المشكلة الحقيقية:** `buildDeterministicReply` كان قالباً واحداً لكل نية (4-5 جمل
ثابتة)، فتبدو الردود شبه متطابقة مهما اختلف نص التعليق: «شكراً» و«عاشت إيدكم» و«تسلمون»
كلها تعطي نفس الجملة تقريباً، ولا فرق بين سؤال الموقع وسؤال السعر. ثلاثة عيوب:
1. لا فهم دقيق للمعنى (لا موضوع السؤال ولا نبرته الدقيقة).
2. لا سياق (لا يستخدم عنوان الفيديو ولا ردودنا السابقة، فيتكرر ميكانيكياً).
3. ردود طويلة إعلانية النبرة على تعليقات قصيرة (إيموجي فقط ⇒ فقرة كاملة).

**الإصلاح — محرّك `generateReply` في `engine/social/comments.ts` (منطق صافٍ حتمي):**
- **تصنيف أدق**: الحقول الجديدة `topic` (location/price/availability/hours/general)
  و`subIntent` (thanks/blessing/greeting/appreciation/emoji/none) و`isEmojiOnly`
  و`normalized` (توحيد الألف/التاء/الهمزات). تُستخرج من النص بأنماط مطبَّعة، فلا يفوت
  «أين موقعكم» مقابل «وين موقعكم».
- **صياغة واعية بالسياق**: `generateReply(classification, facts, context)` يختار
  استراتيجية صريحة (`thanks_short`, `blessing_respect`, `greeting_short`,
  `appreciation_warm`, `emoji_ack`, `price_trusted`/`price_needs_info`,
  `location_*`, `hours_*`, `availability_*`, `complaint_escalate`, `neutral_generic`).
  الرد القصير يبقى قصيراً، والدعاء يُردّ باحترام، والشكوى تُحوَّل لتواصل بشري.
- **ثبات وتنوّع معاً**: `stableHash` + `pickVariant` + `previousReplies` ⇒ نفس المدخل
  يعطي نفس الرد (idempotency)، لكن الصيغ المستخدمة سابقاً في نفس المنشور تُستثنى
  (لا تكرار ميكانيكي).
- **لا اختراع معلومة**: حقائق الرد (`ReplyFactSet`) تُحقن من الخادم بقيم مسجّلة فعلاً
  فقط (سعر/موقع/دوام/توفر/اسم منتج). غيابها ⇒ `needsInfo=true` وإحالة للرسائل بلا
  رقم أو عنوان مختلق. الحقائق المستخدمة تُوسَم في `usedFacts`.
- **تكامل**: مسار `/comments/classify` يمر عبر المحرّك، ويعرض `replyIntelligence`
  (strategy/usedFacts/needsInfo/escalate/reason/blockedBySafety) بعد حارس سلامة
  المحتوى. `buildDeterministicReply` صار يفوّض للمحرّك (مصدر واحد للصياغة).
- **بلا حصة AI**: المحرّك حتمي بالكامل (لا مزود ولا شبكة)؛ Gemini يبقى طبقة اختيارية أعلى.
- الواجهة (`SocialManagerView`) تعرض الموضوع والنبرة والاستراتيجية والحقائق الموثوقة.

اختبار جديد: `engine/tests/reply.intelligence.test.ts` (`npm run test:reply-intelligence`،
45 فحصاً): وحدة لكل مثال سلوكي (إيموجي/شكر/عاشت إيدكم/ما شاء الله/دعاء/تحية/سعر/موقع/
شكوى/سبام/غامض)، وثبات الصيغة لنفس المدخل، وتنوّعها عبر السياق، وطول الردود القصيرة،
وغياب العبارات الإعلانية، وعدم اختراع أي رقم بلا حقائق، وتكامل على خادم حقيقي ببيانات
موثوقة (يذكر السعر/الموقع المسجّلين فعلاً ويمرّان حارس السلامة). فحوص final-audit الـ17:
`reply-intelligence-engine` … `reply-intelligence-no-ai-quota` (570 إجمالاً).

**لم يُمسّ:** Facebook/Instagram/Telegram/TikTok، ولا Gemini، ولا مفاتيح التشفير، ولا
مسارات OAuth، ولا أي سرّ.

## التحكم بفاصل أتمتة YouTube (وقت الأتمتة) — 1..5 دقائق (2026-09-26)

الفاصل كان ثابتاً من البيئة (`YOUTUBE_WATCHER_CADENCE_MS`) بلا وسيلة للمالك لتغييره
من الواجهة. أُضيف تحكم حقيقي بفاصل فحص تعليقات YouTube ضمن نطاق آمن [1..5] دقائق.

- **مصدر واحد للتحقق:** `validateCadenceMinutes` في `engine/social/youtubeWatcher.ts`
  يقبل عدداً صحيحاً فقط ضمن [1..5] ويرفض صراحةً: 0، السالب، العشري، الأكبر من 5، NaN،
  والنصوص غير الرقمية — بلا تقريب أو قصّ صامت. `cadenceMinutesToMs` يحوّل بعد التحقق
  فقط، و`cadenceMsToMinutes` يقرأ الحالة القديمة (توافق خلفي مع `cadenceMs`).
- **حقل مملوك:** `cadenceMinutes` صار جزءاً من `YouTubeWatcherControls`، يُحفظ ويُسترجَع
  عبر آلية الـwatcher نفسها (`WATCHER_STATE_KEY`) فيصمد بعد restart/deploy. الافتراضي 1.
- **فرض على الخادم:** مسار `/api/agent/youtube/watcher/controls` (للمالك) يتحقق من الفاصل
  ويرد **400 `INVALID_CADENCE`** بأي قيمة غير صالحة، فلا يكفي إخفاء الخيار في الواجهة.
- **جدولة بمؤقّت واحد:** `engine/social/youtubeWatcherScheduler.ts` مصدر واحد يضمن أن
  `reschedule()` يُبطل المؤقّت القديم **قبل** إنشاء الجديد، فلا تتراكم المؤقّتات عند تغيير
  الفاصل. عند Kill Switch يتوقف المؤقّت كلياً (الفاصل الفعلي 0). تغيير الفاصل لا يمسّ
  autoReply/autoPublish/autoSchedule/humanReviewMode، ولا منطق الرد أو التصنيف.
- **الواجهة:** قسم «وقت الأتمتة» في `YouTubeOperationsView` بقائمة 1..5 دقائق (للمالك فقط)،
  ويعرض القيمة الرسمية بعد الحفظ؛ القيمة المرسلة الخاطئة تُرفض ولا تُغيّر المحفوظ.
- اختبارات: `engine/tests/youtube.interval.test.ts` (`npm run test:youtube-interval`، 28
  فحصاً على خادم حقيقي: الافتراضي 1، قبول 1..5، رفض 0/سالب/عشري/>5/نص، 401 بلا جلسة،
  الثبات بعد إعادة التشغيل)، ومجموعتا P/Q في `youtube.watcher.test.ts` (تحقق الحدود +
  سلامة الجدولة بمؤقّت واحد). فحوص final-audit الـ15: `youtube-cadence-*` (585 إجمالاً).

**لم يُمسّ:** YouTube OAuth/التفويض/الرد/التصنيف/`executeYouTubeReply`، ولا Facebook/
Instagram/Telegram/TikTok، ولا Gemini، ولا مفاتيح التشفير، ولا أي سرّ.

## جدار حماية حصة Gemini المجاني — مركزي واحد لكل المشروع (Batch 23, 2026-09-26)

**المشكلة الحقيقية:** حصة Gemini مورد **مشروع واحد**، لا مورد منصة. أي إضافة منصة جديدة
(أو وكيل مركزي، أو مراقب يعمل 24/7) تستهلك من نفس الحصة، وكانت الحماية مبعثرة (حارس يومي
في `server.ts` + حدود داخل المحرك) بلا سجل مركزي يوضّح من استهلك وماذا.

**الحل:** جدار حماية مركزي واحد بلا أي تفريع على اسم منصة. المنصة مجرد **بيانات تشخيصية**
لا تغيّر أي قرار حماية: منصة غير معروفة (`future_platform`) تخضع لنفس الحارس ونفس الميزانية
تماماً، فلا يلزم تعديل أي كود عند إضافة منصة.

### المكوّنات
- `engine/ai/firewall.ts` (مصدر واحد، منطق صافٍ بلا شبكة/أسرار):
  - `AiUsageLedger`: عدّادات تميّز **نداء المزود الحقيقي** عن الكاش والانضمام أثناء التنفيذ
    والحجب والحتمي والبديل والأخطاء + آخر نداء مزود (وصف فقط: منصة/عملية/موديل/وقت — بلا
    أي prompt أو استجابة أو مفتاح). `resetDaily()` يصفّر عند تغيّر اليوم فقط.
  - `enforcePromptLimit`: قصّ حتمي لـprompt الضخم (`DEFAULT_MAX_PROMPT_CHARS` = 24000)
    قبل أي نداء، مع إعلان `truncated`. `DEFAULT_MAX_OUTPUT_TOKENS` = 2048 يمرّ للمزود.
  - `normalizePlatformLabel` + `KNOWN_AI_PLATFORMS` + `buildUsageDiagnostics`.
- `engine/ai/engine.ts`: يقبل `ledger`/`maxPromptChars`/`maxOutputTokens`، ويقصّ الـprompt
  **قبل** فحص الحارس، ويسجّل كل مصدر نتيجة. الحجب يعيد بديلاً حتمياً صريحاً
  (`fallbackReason: 'quota_guard'`)، والفشل يُعيد الحجز (`guard.release()`).
- `engine/ai/provider.ts`: يمرّر `maxOutputTokens` للمزود (سقف مخرجات صريح).
- `server.ts`: حارس واحد `aiUsageGuard` يستهلكه **كل** مسار: `aiEngine.run` (توليد المحتوى،
  الوكيل المركزي، التصنيف، أدوات الوكيل) **والفحص الحي** `verify-provider` (كان يتجاوز
  الجدار — أُغلق: عند نفاد الحصة يرد `blocked_by_guard` صراحةً بلا إرسال أي طلب للمزود).

### حدود الحماية (صادقة)
- الحد المحلي `GEMINI_DAILY_LIMIT` (افتراضي 4، أقصى 6) ووضع `GEMINI_FREE_TIER_PROTECTION`
  (افتراضي مفعّل) — **حد حماية محلي للمشروع وليس حصة Google**، وهذا مكتوب في كل استجابة.
- الحدود الوقائية: قصّ الـprompt، سقف المخرجات، الكاش، الانضمام أثناء التنفيذ، وقاطع الدائرة.
- لا مزود مدفوع ولا بديل مُضاف، ولا حصة لكل منصة (يوجد فحص يمنع عودة هذه المتغيرات).
- **توليد المحتوى متعدد المنصات = نداء Gemini واحد**: النص المُتحقَّق منه يُكيَّف حتمياً لكل
  المنصات العشر عبر `adaptContentForPlatform` بلا أي نداء إضافي (`platforms` في الطلب).

### المراقبة والتشخيص
- `GET /api/ai/firewall` (**للمالك فقط**): `scope: project-wide`، `platformSpecificQuota: false`،
  العدّادات، حدود الـprompt، وأسماء المنصات المعروفة — بلا أي سرّ.
- `/api/health` و`/api/readiness`: كتلة `freeTierFirewall` (`ai.freeTierFirewall`) بنفس الحقول.
- `geminiStatus()` يعرض `firewall` و`promptLimit` إضافة إلى الحقول السابقة.

### اختبارات
- `engine/tests/gemini.firewall.test.ts` (`npm run test:gemini-firewall`، 51 فحصاً): الحد
  العالمي (4 تمر/الخامس يُحجب)، **المنصات العشر تشترك في ميزانية واحدة**، المنصة المستقبلية
  محجوبة بنفس الجدار، العمليات الحتمية صفر استهلاك، الكاش/الانضمام = نداء واحد، الفشل
  يُعيد الحجز، حدود الـprompt، التشخيص، و**فحوص عدم التجاوز** (لا `new GoogleGenAI` خارج
  الموصل، لا `generateContent` مباشر، لا حد منصة، لا تفريع على اسم منصة).
- `engine/tests/gemini.firewall.server.test.ts` (`npm run test:gemini-firewall-server`،
  21 فحصاً): خادم حقيقي — 401 بلا جلسة، المالك يقرأ التشخيص، 30 دورة صحة/جاهزية = 0 نداء
  مزود، طلب محتوى لعشر منصات = 0 نداء مزود + تكييف للعشر، الجاهزية تعرض الكتلة، بلا سرّ.
- فحوص final-audit الـ22: `gemini-firewall-*` (607 إجمالاً).

**لم يُمسّ:** Facebook/Instagram/Telegram/YouTube (OAuth/التفويض/الرد/المراقب/الوكيل)، ولا
سياسة الموديلات، ولا مفاتيح التشفير، ولا أي سرّ، ولا أي منطق سوشيال حتمي.

## مركز مراجعة التقرير اليومي: من الرقم إلى التعليق الحقيقي (Batch 18, 2026-09-28)

كان التقرير اليومي يعرض أرقاماً غير قابلة للتتبع (تعليقات جديدة 22، ردود 8، مؤجلة 10،
مصعدة 3، ردود متحققة 8، ردود فاشلة 1، مشاعر +15 / −0) فلا يعرف المالك **أي** تعليق كوّن
كل رقم. المطلوب ربط كل رقم بالسجلات الحقيقية ومراجعتها واحداً واحداً.

**تتبع المصادر (بلا افتراض):** كل الأرقام مشتقّة من `watcherState.processed`
(`WatcherProcessedEntry[]` المحفوظة عبر المحوّل فتصمد بعد restart). العدّادات = نفس أرقام
المستخدم بالضبط: `detected=22`, `replied=REPLIED|VERIFIED=8`, `skipped=10`, `escalated=3`,
`verifiedReplies=8`, `failedReplies=1`، والمشاعر من `classifyComment`. **لا فجوة بيانات
ولا رقم بلا سجلات retrievable.**

**وحدة `engine/social/watcherReview.ts` (منطق خالص، بلا شبكة/أسرار):**
- `WATCHER_BRIEF_METRICS` + `WATCHER_BRIEF_METRIC_LABELS_AR`: مصدر واحد يربط الرقم بقائمته.
- `selectMetricEntries(entries, metric, now)` + `computeBriefCounts`: كل بطاقة لها **شرط
  واحد واضح**، ونفس المُحدِّد يُستخدم لحساب الرقم ولإرجاع سجلاته ⇒ **يستحيل discrepancy**.
- `toDetailRecord`: سجل تفصيلي حقيقي (نص/حساب/فيديو+رابط/حالة+مسمّى/سبب/كود/تصنيف
  بمسمّيات عربية/الرد المقترح الحتمي/التسليم بمعرّف رد).
- `applyDetailFilters`: فلاتر (stage/intent/sentiment/delivered/needsReview/q) **لا تنشئ
  بيانات**؛ الصفر يُعيد حالة فارغة صحيحة.
- قرارات المراجعة: `WATCHER_REVIEW_ACTIONS` (`allow_reply`/`reprocess`/`ignore`/`escalate`/
  `block_reply`) + `isValidReviewAction` + `overrideForcesReply`/`overrideForcedStage`
  + `normalizeReviewOverrides`/`latestOverridesByComment`.

**الخادم:**
- `buildWatcherDailyBrief` صار يحسب الأرقام عبر `computeBriefCounts` (مصدر واحد مع التفاصيل).
- `GET /api/agent/youtube/watcher/brief` أُثرِي بحقل `metrics` (بطاقات قابلة للنقر).
- `GET /api/agent/youtube/watcher/details?metric=…&filters` — **قراءة فقط**، يُرجع نفس
  سجلات الرقم + الفلاتر، 400 لبطاقة غير معروفة، 401 بلا جلسة.
- `GET /api/agent/youtube/watcher/comment/:commentId` — تفاصيل تعليق واحد (404 إن غاب).
- `POST /api/agent/youtube/watcher/review` (**requireOwner**): `allow_reply` يمر
  بـ`executeYouTubeReply` المركزي نفسه (كل البوابات سارية، لا تجاوز) ولا يُسجَّل تسليم بلا
  معرّف رد حقيقي؛ `reprocess` يحرّر التعليق لإعادة تقييمه؛ `ignore/escalate/block_reply`
  قرار حالة بلا إرسال. لا تغيير حالة عند فشل الإرسال.
- `reviewOverrides` تُحفظ/تُسترجع عبر المحوّل (تصمد بعد restart)، ودورة المراقبة تحترم قرار
  المالك (منع/تجاهل/تصعيد) فلا يُنقض في الدورة التالية.

**الواجهة:** `YouTubeBriefReview` (جديد) — كل بطاقة تُفتح بنقرة وتعرض التعليقات الحقيقية
بنصها وصنفها وسبب قرارها والرد المقترح، مع فلاتر وإجراءات مراجعة (للمالك فقط). البطاقات في
`YouTubeOperationsView` صارت أزراراً تستدعي التفاصيل. لا يُعرض أي سرّ.

اختبارات: `engine/tests/watcher.review.test.ts` (**58 فحصاً** وحدة: العدد=السجلات، الفلاتر
لا تُنشئ بيانات، الصفر صادق، تمييز المؤجَّل، قرارات المراجعة، الـoverrides) و
`engine/tests/watcher.review.integration.test.ts` (**52 فحصاً** خادم حقيقي + خادم YouTube
وهمي: قراءة → تقرير → تفاصيل كل بطاقة = عددها → قرار رد → `comments.insert` → معرّف رد
حقيقي/`sent` → منع التكرار 409 → تجاهل/تصعيد بلا إرسال → لا تسريب سرّ). فحوص final-audit
الجديدة (626 إجمالاً): `brief-review-*`.

**لم يُمسّ:** OAuth/scopes/الأسرار، ولا Facebook/Instagram/TikTok/Telegram/Gemini، ولا
تفويض YouTube ولا المراقب 24/7 ولا المنفّذ المركزي (المراجعة تستخدمه كما هو).

## طابور محتوى YouTube — نشر آلي + جدولة + مراجعة بشرية (Batch 18, 2026-09-28)

إكمال ثلاثية (نشر آلي + جدولة آلية + مراجعة بشرية) في مسار واحد موحّد سياسةً، بلا
تعارض حالات وبلا نشر وهمي. المعمارية: **بوابة → تصنيف → قرار → تنفيذ مركزي → تحقق**.

### وحدة `engine/social/contentPipeline.ts` (منطق خالص قابل للاختبار)
- `contentGate(controls, action)`: بوابة حتمية بترتيب أسبقية صريح
  (WATCHER_DISABLED → AUTOMATION_PAUSED → AUTO_*_DISABLED). Kill Switch وحده يمنع الكل.
- `classifyContentForReview`: آمن وواضح ⇒ `auto_publish`/`auto_schedule`؛ تجاري بمعلومة
  غير مؤكدة ⇒ `review_required` (حساسية عالية)؛ مخالفة حاجبة أو بلا مادة/عنوان ⇒ `blocked`.
- `decisionToState` يُترجم القرار إلى حالة الطابور مع تصريح بسبب الحجب (AUTO_PUBLISH_DISABLED
  ⇒ REVIEW_REQUIRED لا APPROVED).
- `CONTENT_STATES` = DRAFT/APPROVED/SCHEDULED/PUBLISHED/VERIFIED/REVIEW_REQUIRED/REJECTED/
  CANCELLED/FAILED، وانتقالات صريحة (`canTransitionContent`) وحالات نهائية لا تُنقض.
- `contentFingerprint` (FNV) + `fingerprintTag` (وسم قناة `gharabiai-…` يُحقن في الفيديو)
  + `matchVideoByFingerprint` + `reconcileUnknownUpload`: مطابقة حقيقية لقراءة-فقط بعد فشل
  شبكي، فلا نشر مكرر عند نجاح الطلب لدى YouTube وضياع الاستجابة.
- `suggestScheduleTime`: ساعة الذروة من أوقات تفاعل حقيقية فقط؛ العيّنة غير الكافية تُعلَن
  `sampleInsufficient` ولا يُدّعى «أفضل وقت» إطلاقاً.

### الخادم (`server.ts`)
- `ContentQueueItem` + `contentQueue` (حد 5000) + مخزن مادة `contentMedia` يحفظ **بايتات
  حقيقية فقط** بمرجع `mediaRef` (بلا فيديو وهمي، حد 5 ميجابايت/عنصر و25 ميجابايت إجمالي).
  كلاهما يُحفظ/يُسترجع عبر المحوّل (`persistContentMedia`/`applyContentMediaState`) فيصمد
  بعد restart/cold start.
- `executeYouTubePublish` وُسّع ليقبل `mediaRef` (من المخزن) و`queueItemId`، ويكتب حالة
  الطابور من نتيجة YouTube الحقيقية: `PUBLISHED` فقط بمعرّف فيديو حقيقي، و`SCHEDULED` مع
  `publishAt` (private حتى الموعد)، و`UNKNOWN_EXTERNAL_STATE` عند عدم التأكد. يقبل وقت
  الجدولة كجدار محلي (datetime-local) **أو** لحظة ISO بلا زحزحة صامتة.
- المسارات: `POST /api/platforms/youtube/content/drafts` (**owner**)،
  `POST /api/platforms/youtube/content/queue/:id/review` (**owner**: approve/reject/edit/
  publish_now/schedule/cancel)، `GET /api/platforms/youtube/content/queue` و`/:id` و
  `GET /api/platforms/youtube/content/details?metric=` (محميّة)، و
  `GET /api/platforms/youtube/content/schedule-suggestion` (محميّة).
- التنفيذ الآلي واليدوي يمرّان بـ`autoExecuteContentItem` → `executeYouTubePublish` المركزي
  نفسه (كل البوابات: إذن → سلامة محتوى → مادة حقيقية → اتصال موثق → idempotency → rate limit)
  — **لا مسار جانبي**. الرفض/الإلغاء نهائي ولا يُنقض.
- بطاقات المحتوى الست في التقرير اليومي (`contentMetrics`) قابلة للنقر وتفاصيلها = نفس
  السجلات التي كوّنت الرقم (`total`). `/api/health.youtubeContent` يعرض الملخص وحجم المخزن.

### الواجهة
`src/components/agent/YouTubeContentQueuePanel.tsx`: طابور المحتوى بحالاته الصادقة، إنشاء
محتوى (عنوان/وصف/وسوم/وقت جدولة/بايتات base64)، اقتراح وقت الجدولة، وأزرار القرار للمالك.
مدمج في `YouTubeOperationsView`. تُعرض نتيجة الخادم الفعلية فقط بلا أي ادّعاء نجاح محلي.

### قواعد ملزمة (مُختبرة)
- **لا نشر آلي بلا إذن صريح** (autoPublish/autoSchedule)، وKill Switch يمنع الكل.
- **لا PUBLISHED بلا معرّف فيديو حقيقي من YouTube**؛ المجدول يبقى SCHEDULED.
- **حتى قرار المالك لا يجيز نشر ادعاء تجاري غير مسجّل** (حارس سلامة المحتوى يرفض 422).
- **الرفض نهائي** (REJECTED/CANCELLED) بلا نشر تلقائي لاحق.
- **لا فيديو وهمي**: الرفع بلا بايتات مرفوض (MEDIA_REQUIRED).
- **العمليات الحتمية لا تستهلك Gemini** (الطابور والتصنيف والجدولة حتمية).

اختبارات: `engine/tests/content.pipeline.test.ts` (**51 فحصاً** وحدة) و
`engine/tests/content.pipeline.integration.test.ts` (**45 فحصاً** خادم حقيقي + خادم Google
وهمي: نشر تجاري→مراجعة، آمن→نشر حقيقي بمعرّف، جدولة→SCHEDULED+private، رفض نهائي، Kill
Switch، تصريح 401، منع تكرار، ثبات بعد restart، بلا تسريب سرّ، Gemini=0). فحوص final-audit
الجديدة (`content-*`، **647 إجمالاً**).

**لم يُمسّ:** OAuth/scopes/الأسرار، ولا تفويض YouTube ولا المراقب 24/7 ولا `executeYouTubeReply`
ولا Gemini ولا أي منصة أخرى (Facebook/Instagram/TikTok/Telegram). دورة الرد القائمة تستخدم
المنفّذ المركزي كما هو.

## رفع فيديو حقيقي في طابور المحتوى + حجب النشر بلا مادة (Batch 19, 2026-09-28)

ملاحظات المالك الفعلي من واجهة الإنتاج كشفت فجوتين حقيقيتين في Batch 18:

1. **الواجهة كانت تطلب كتابة base64 يدوياً.** حقل «بيانات الفيديو base64» كان نصاً حراً؛
   مستحيل عملياً من الجوال. أُزيل تماماً واستُبدل بزر **«📹 اختيار فيديو»**
   (`input type=file` بـ`accept="video/*"`) يعمل على Android والكمبيوتر: يقرأ الملف الحقيقي،
   يتحقق من النوع والحجم (≤12MB) محلياً، يحوّله base64 **داخلياً**، ويعرض الاسم/الحجم/النوع/
   «✓ جاهز للرفع» مع إمكانية الاستبدال/الإلغاء. المستخدم لا يرى base64 إطلاقاً.
2. **Draft بلا مادة كانت تُعرض بأزرار نشر/جدولة/موافقة.** الآن المصدر الواحد
   `filterContentActions`/`contentItemMediaState` في `contentPipeline.ts` يحجب
   `approve`/`publish_now`/`schedule` بلا مادة حقيقية، ويُعلن `hasMedia`/`mediaState:
   MEDIA_REQUIRED`/`allowedActions` في `contentQueueView`. الواجهة تعرض الأزرار من
   `allowedActions` فقط (تبقى: تعديل/رفض/إلغاء)، والخادم يفرض الحجب فعلاً (409
   `MEDIA_REQUIRED`) فلا يكفي إخفاء الأزرار.

**تحقق فعلي من المادة (خادم):** `validateMediaBytes` + `decodeStrictBase64` يرفضان النص
العادي/base64 المزيف/payload الفارغ/النوع المصرّح غير المدعوم/عدم تطابق الامتداد مع النوع/
الحجم > الحد، ويقارنان **توقيع الملف** (ftyp للـMP4/MOV، EBML للـWebM/MKV، RIFF…AVI).
يُطبَّق في مساري الإنشاء **والتعديل** (لإرفاق فيديو بمسودة ناقصة) وفي `executeYouTubePublish`
(دفاع مزدوج). أُضيف تقاطع mkv≈webm وmov≈mp4.

**حد الجسم:** `express.json({limit:"256kb"})` العام كان يرفض أي فيديو (16MB base64) قبل
الوصول للمسار. أُضيف استثناء مضبوط: مسار `/api/platforms/youtube/content/drafts` وحده
يُترك لمحلّل به حد `20mb` (لا يتجاوز 12MB مادة + base64 ≈16MB)، مع بقاء الحد الصغير
وحماية `req.rawBody` (توقيع HMAC) كما هي لكل المسارات الأخرى.

اختبارات: `content.pipeline.test.ts` 59 (حجب العمليات بلا مادة)،
`content.pipeline.integration.test.ts` 66 (بلا مادة/وهمي/نوع خاطئ/حجم/إرفاق عبر تعديل/
allowedActions)، `youtube.connector.test.ts` 227 (تحقق المادة في مسار النشر). final-audit
**652**. الرفض نهائي (`REJECTED`) ولا يُنشر/يُجدول آلياً، وREJECTED لا تُقبل قرارات جديدة
غير التعديل. الواجهة تفصل بوضوح «تعليق يحتاج مراجعة» عن «محتوى يحتاج مراجعة».

**لم يُمسّ:** OAuth/scopes/refresh token، ولا تفويض YouTube (reply/publish/schedule/
update_video)، ولا دورة المراقب (cadence/تصنيف/autoReply/escalation/التقرير)، ولا حماية
Gemini (كل التحقق أعلاه حتمي بلا AI)، ولا Facebook/Instagram/TikTok/Telegram.
## تفسير تعليقات YouTube الحقيقية: قرار صريح لكل تعليق + مطابقة قراءة فقط (Batch 23, 2026-09-29)

**الجذر المُثبت (بلا تخمين):** تعليقان حقيقيان على القناة بلا رد. التشخيص من الحالة
الحيّة (`/api/health`) أثبت **لا عطل اكتشاف**: `controls.humanReviewMode = true` مع
`autoReplyEffective = false`، والمراقب يعمل (`activeTimers = 1`, `pollCount` يتقدّم,
`lastError = null`, `consecutiveErrors = 0`).

- التصنيف الحتمي صحيح تماماً: «عاشت إيدكم» ⇒ `praise/thanks/positive`، و«شنو نوع الموبايل»
  ⇒ `question`. أي أن الإصلاح السابق للمدح العراقي يعمل.
- **القاعدة الحاكمة (المقصودة):** في `decideCommentAction`، الحالات **الآمنة الواضحة**
  (`praise` فقط عبر `isSafeForAutoReply`) تُرد آلياً حتى مع `humanReviewMode`، أما
  **غير الواضحة** (سؤال/مجهول) فتُحوَّل إلى `ESCALATE_HUMAN_REVIEW_MODE`. لذا:
  «عاشت إيدكم» (مدح) **يُرد عليها آلياً**، و«شنو نوع الموبايل» (سؤال) **يُصعَّد للمراجعة
  بلا رد** — وهذا سلوك مقصود لا عطل. التعليقان إذن اكتُشفا وصُنِّفا وقُرِّرا صراحةً.
- لا علاقة للسبب بـdelegation (`active`) ولا autoReply (`true`) ولا Kill Switch (`false`).

**الفجوات الحقيقية في الكود (أُصلحت):**

1. **تناقض كود/مرحلة + «معالجة بلا قرار».** `server.ts` كان يكتب `stage: ESCALATED`
   مع الاحتفاظ بكود `REPLY_ALLOWED` عند حجب الرد، ويكتب `stage: SKIPPED` **بلا كود**
   عند تجاهل تعليق خارج سياق القناة. أُضيفت خريطة صريحة
   `YOUTUBE_DECISION_CODE_STAGES` + `isExplicitTerminalDecision` تضمن أن كل (مرحلة، كود)
   متّسق: `SKIP_OUT_OF_CHANNEL_CONTEXT` و`ESCALATE_REPLY_NOT_READY` صارا كودين صريحين.
2. **ترميم غير حذفي للتاريخ.** `repairProcessedDecisionCodes` يُمنح أي سجل قديم مُعالج
   بكود مفقود/متناقض كوداً طرفياً (`SKIP_LEGACY_UNCLASSIFIED` / `ESCALATE_LEGACY_UNCLASSIFIED`
   / `REPLY_ALLOWED`) — **بلا حذف أي سجل** ولا تغيير مرحلته. يُطبَّق عند تحميل الحالة.
3. **نافذة فحص قابلة للضبط.** `commentScanVideoLimitFromEnv` تقرأ
   `YOUTUBE_COMMENT_SCAN_VIDEO_LIMIT` ضمن [1..25] (افتراضي 5)، فلا تُغفل تعليقات حقيقية
   على فيديو أقدم بقليل، بضبط المالك لا بتثبيت في الكود.
4. **مسار مطابقة تشخيصي قراءة فقط** `GET /api/agent/youtube/watcher/reconcile`
   (للمالك فقط): يقرأ التعليقات الحقيقية مباشرة (`commentThreads.list` بلا استيعاب ولا
   كتابة) ويقابلها بسجل المعالجة، فيُعلن لكل تعليق: هل اكتُشف؟ مرحلته/قراره/سببه؟ معرّف
   الرد الحقيقي؟ ولماذا لم يُكتشف غير المكتشَف — **بلا اختلاق** وبلا أي إرسال رد.

الوضع الصادق: «عاشت إيدكم» (مدح) يُرد عليه آلياً في الوضع الحالي؛ «شنو نوع الموبايل»
(سؤال) يُصعَّد للمراجعة بلا رد لأن `humanReviewMode` يحوّل غير الواضح للمراجعة. لا
يُدَّعى أي رد لم يقع، ومسار المطابقة يثبت لكل تعليق حقيقٍ هل اكتُشف وما قراره.

اختبارات: `engine/tests/youtube.decision.test.ts` (`npm run test:youtube-decision`، 60
فحصاً): تصنيف «عاشت إيدكم» مدحاً، «شنو نوع الموبايل» بلا اختراع مع قرار صريح، خريطة
القرار/المرحلة، الفشل يبقى FAILED، منع التكرار، ثبات سلوك autoReply/humanReview/Kill
Switch (مدح⇒رد، سؤال⇒تصعيد)، الترميم غير الحذفي، وصفر نداء AI. فحوص final-audit
(`youtube-decision-*`، `youtube-reconcile-*`، `youtube-scan-window-*`، 668 إجمالاً).


## قرار المالك المباشر + الخصوصية الصادقة + تنظيف بيانات الاختبار (Batch 24، 2026-09-26)

إكمال دورة محتوى YouTube: كان قرار المالك المباشر (نشر الآن/جدولة) **مقفولاً بالأتمتة**،
وكان «نشر الآن» قد يُرفع `private` فيبدو منشوراً بينما هو غير مرئي، ولم يكن هناك تحقق
فعلي من الخصوصية من YouTube ولا وسيلة آمنة لإزالة بيانات الاختبار. الإصلاح:

1. **فصل صريح `manual` ≠ `auto` في بوابة المحتوى.** `contentGate(controls, action, mode)`
   صار يستقبل `ContentActionMode = 'manual' | 'auto'`. `autoPublish`/`autoSchedule` تُفحص
   داخل فرع `auto` فقط، فلا تُقفل **قرار المالك اليدوي** بعد استيفاء شروط الحالة. Kill
   Switch (`paused`) وتعطيل المراقبة يمنعان الاثنين (توقف التشغيل كله). `humanReviewMode`
   سياسة مراجعة لا قفل تنفيذ. مصدر واحد: `reviewActionToState` (يدوي) و`canAutoPublish`
   (آلي)، و`contentManualReadiness` يحسب جاهزية القرار المباشر للواجهة والخادم معاً.
2. **الخصوصية الصادقة.** «نشر الآن» (قرار مالك) => `public` افتراضاً، والجدولة => `private`
   حتى موعد `publishAt` (تُفرض في إنشاء المسودة وفي مسار القرار). المسار القديم
   `/api/platforms/youtube/publish` يفترض `manual=>public`. أي قيمة صريحة من المالك تتقدّم.
3. **تحقق فعلي من YouTube.** بعد نجاح الرفع يُقرأ الفيديو عبر `videos.list` وتُقارَن
   `status.privacyStatus` بالمطلوب. `verified` لا تُعلن إلا عند تطابق مؤكد (`delivered &&
   privacyVerification.verified`)؛ عدم التطابق/التعذّر يبقى **غير مؤكد بصراحة** مع
   `privacyActual`، ويُسجَّل `video_privacy_mismatch` بلا أي سرّ. حقول جديدة في عنصر
   الطابور: `verifiedVideoId` و`verifiedPrivacyStatus`.
4. **تنظيف بيانات الاختبار بدليل موثّق (owner فقط).**
   `POST /api/platforms/youtube/content/cleanup-test-data` (+ زر «تنظيف بيانات الاختبار»).
   `classifyContentRecord` لا يصنّف اختباراً إلا بدليل مقصود (`source='test'` أو وسم
   test/dummy/sample/smoke/e2e/qa/اختبار/تجريب في العنوان/الوصف أو سجل `test_marker`)،
   والعناصر المُنشأة عبر الواجهة (`source='owner'`) تبقى إنتاجاً. `dryRun` افتراضي (عرض
   فقط)، ولا يُحذف **أبداً** عنصر له معرّف فيديو حقيقي من YouTube.

**درس عام:** «نشر الآن» يجب أن يعني `public` فعلاً، لا أن يُخفي الفيديو بـ`private`
افتراضي؛ وأي ادعاء تحقق يجب أن يُقرأ من المزود لا من نجاح الطلب. وقرار المالك بعد
استيفاء شروط الحالة لا يجوز أن يعتمد على مفاتيح الأتمتة — الأتمتة سياسة تلقائية، لا قفل يدوي.

اختبارات: `engine/tests/content.pipeline.test.ts` (79 فحصاً وحدة، منها جاهزية القرار
المباشر وتصنيف بيانات الاختبار) و`content.pipeline.integration.test.ts` (91 فحصاً تكاملياً:
استقلال القرار المباشر عن autoPublish/autoSchedule/humanReviewMode، `public` عند النشر الآن،
`private`+`publishAt` عند الجدولة، تحقق فعلي وإعلان عدم التطابق، تنظيف آمن). فحوص final-audit
الجديدة `content-manual-*`, `content-publish-now-public`, `content-schedule-private`,
`content-privacy-*`, `content-verified-only-with-provider`, `content-test-cleanup-*` (681 إجمالاً).

## وصف YouTube عبر العقل المركزي + إلغاء مؤكَّد + عقد وقت النشر (Batch 25 — 2026-09-26)

إكمال دورة المحتوى بثلاث إضافات صادقة، بلا مساس بـGemini/الأتمتة/مكوّن الوقت/بقية المنصات:

### 1) وصف YouTube تسويقي بالعقل المركزي + تحقق وصوله فعلاً
- `engine/social/youtubeDescription.ts` (منطق خالص): `buildDeterministicYouTubeDescription`
  (صياغة حتمية من **الحقائق المُمرَّرة فقط**: اسم المنتج/المواصفات/خيارات التقسيط/بيانات
  تواصل المعرض — لا سعر ولا خصم ولا ضمان إلا إن وُجد صراحةً)، `buildYouTubeDescriptionPrompt`
  (برومبت يُلزم بالمصدر الواحد ويستثني كل ادعاء غير مسجّل)، `buildDescriptionHashtags`
  (وسوم حسب التصنيف المسجّل، ووسم عام عند الجهل)، `normalizeDescriptionForMatch`
  (تطبيع عربي/مسافات/أسطر)، و`verifyUploadedDescription` (لا يُعلن وصول الوصف بلا دليل).
- المسار `POST /api/platforms/youtube/content/generate-description` (**owner فقط**): عملية
  AI **واحدة** تمر `Central Agent → AiEngine → Gemini Firewall` (cache/dedup/quota/breaker/
  fallback)، والنص الفعلي (مزود أو بديل) يمر `ensureSafeBusinessText` (المصدر الواحد
  `buildSafeBusinessReply` من `contentSafety.ts`). بلا أي سرّ في الاستجابة.
- **الوصف جزء من دورة النشر**: `executeYouTubePublish` يقرأ الفيديو **مرة واحدة** من
  YouTube (`videos.list`) ويشتق منها الخصوصية **و** الوصف (بلا نداء إضافي). لا تُعلن
  `verified` إلا باجتماع: معرّف حقيقي + خصوصية مؤكدة + وصول الوصف إن كان مطلوباً.
  أكواد الوصف: `DESCRIPTION_CONFIRMED` / `DESCRIPTION_MISSING` / `DESCRIPTION_MISMATCH` /
  `DESCRIPTION_UNREADABLE` / `DESCRIPTION_NOT_REQUIRED`. عدم التطابق يُسجَّل
  `video_description_mismatch` بأمان، ويظهر `unverifiedReason` صريحاً.
- حقل جديد في عنصر الطابور: `verifiedDescription` (منطقي) + `descriptionVerification` في
  نتيجة النشر، ويُعرضان في الواجهة («الوصف: أُثبت وصوله» / «لم يُثبَت وصوله بعد»).
- **الواجهة**: `YouTubeContentQueuePanel` يضيف اختيار منتج حقيقي وزر «✨ صياغة الوصف بالعقل
  المركزي» (يُظهر إن كانت الصياغة عبر مزود أم حتمية، وهل استُبدل نص غير آمن، والحقائق المستخدمة).

### 2) زر الإلغاء فعلي ومؤكَّد
- بوجود شارة الحالة (عرض)، `reject`/`cancel` زرّان ضمن `allowedActions` مع تأكيد
  `window.confirm` قبل التنفيذ (لأن الحالة نهائية لا تُنقض). اختبار تكاملي يثبت الإلغاء
  (`CANCELLED`) ورفض النقض (`TERMINAL_STATE` 409) وعدم أي رفع.

### 3) عقد وقت النشر (فحص فقط — المكوّن لم يُمَسّ)
- عرض `publishAt` في اللوحة صار عبر `toScheduleDisplay` (سياسة Asia/Baghdad الموحّدة) بدل
  `Date.toLocaleString` غير المحدد، فلا زحزحة ساعة على الجوال. اختبار تكاملي يثبت أن
  المعروض == ما اختاره المالك بعد الحفظ وإعادة القراءة (٢١:٣٠ تبقى ٢١:٣٠، لا ٠٠:٣٠).

اختبارات: `engine/tests/youtube.description.test.ts` (29 فحصاً وحدة) و`content.pipeline.integration.test.ts`
صار **116 فحصاً** (مجموعة 15هـ عقد الوقت، مجموعة 16/16ب الوصف، مجموعة 17 الإلغاء).
فحوص final-audit الجديدة: `youtube-description-*`, `content-cancel-*`,
`content-publish-time-wallclock-contract` (696 إجمالاً).

**لا تغيير في:** Gemini/الـFirewall، نموذج الجدولة، مكوّن الوقت على الجوال، Facebook/Instagram/
Telegram/TikTok، أو أي سرّ. الوصف لا يُنشر تلقائياً ولا يستهلك حصة في أي قراءة.

## إغلاق دورة التحقق للمحتوى المجدول (SCHEDULED → VERIFIED بدليل مزود) — 2026-09-29

**الفجوة الحقيقية المُثبتة:** `isVerificationSubstantiated` كان يعتبر عنصر `SCHEDULED`
متحققاً بمجرد وجود معرّف الفيديو، لكن **لا إعادة قراءة من YouTube تحدث بعد حلول `publishAt`**.
النتيجة: عنصر جدولناه على YouTube بحالة `private` + `publishAt` قد يصبح `public` فعلاً
(أو لا يصبح أبداً)، ويبقى النظام يعدّه `SCHEDULED` بلا أي إثبات للحالة النهائية — أي أن
دورة الجدولة لم تكن مغلقة بدليل حقيقي.

**الإصلاح (قراءة فقط، بلا مساس بنموذج الجدولة ولا بمكوّن الوقت على الجوال):**
- `engine/social/contentPipeline.ts`: `evaluateDueScheduledContent(item, publishAtEpoch,
  actualPrivacyStatus, nowMs)` — منطق صافٍ قابل للاختبار. لا يُعلن `VERIFIED` إلا بحالة
  `public` **فعلية مقروءة من المزود**؛ `private`/`unlisted` ⇒ يبقى `SCHEDULED` بسبب صريح؛
  تعذّر القراءة ⇒ `SCHEDULED` بلا ادعاء. `publishAtEpoch` يُمرَّر محسوباً مسبقاً بسياسة
  المنطقة الموحّدة (لا `Date.parse` داخل الدالة) لئلا يُزحزح الجدار المحلي.
- `server.ts`: `verifyDueScheduledContent()` تُستدعى داخل دورة المراقبة الدائمة
  (`runYouTubeWatcherCycle`)، تقرأ حالة كل مجدول حلّ موعده عبر `videos.list` الحقيقي
  وتُغلق الدورة: `public` ⇒ `VERIFIED` + `verifiedVideoId` + `verifiedPrivacyStatus` +
  سجل تاريخي؛ وإلا فسبب صريح (`SCHEDULED_STILL_NOT_PUBLIC` / `SCHEDULED_VERIFY_UNREADABLE`).
  النتيجة تُعلن في رد الدورة (`result.scheduledCheck`). لا AI، ولا كتابة بلا دليل،
  والحد 10 عناصر لكل دورة.
- فحوص final-audit: `content-scheduled-due-evaluator`, `content-scheduled-due-sweep-reads-provider`,
  `content-scheduled-due-in-cycle`, `content-scheduled-due-tests` (720 إجمالاً).
- اختبارات: `content.pipeline.test.ts` (94 فحصاً، مجموعة 10هـ) و`content.pipeline.integration.test.ts`
  (130 فحصاً، مجموعتا 13ب/13ج: لا فحص قبل الموعد، ثم حلول الموعد + `public` فعلي ⇒ `VERIFIED`
  بمعرّف المزود، عبر restart حقيقي وخادم Google وهمي).

**لا تغيير في:** Gemini، OAuth/الصلاحيات/الاعتمادات، Facebook/Instagram/Telegram/TikTok،
نموذج الجدولة، مكوّن الوقت على الجوال، أو أي سرّ.

## مصالحة تسليم TikTok تلقائياً — إغلاق حلقة publishing → published (2026-09-29)

الفجوة الحقيقية: `fetchPublishStatus` كان يُستدعى من مسار المالك اليدوي فقط
(`GET /api/platforms/tiktok/publish-status`)، فلا يوجد أي استعلام دوري. النتيجة أن سجل
نشر TikTok يبقى `publishing` للأبد ما لم يضغط المالك «استعلام الحالة» بنفسه، مع أن
التسليم من جهة TikTok يكتمل تلقائياً. والحالة الصادقة `OPERATIONAL` تحتاج دليلاً
(`publishRecords` بحالة `published` + `providerPostId`)، فكانت لا تتحقق بلا تدخّل يدوي.

الإصلاح — بلا أي ادعاء ولا حصة مهدرة:
- `engine/social/tiktok.ts`: `shouldReconcileTikTokRecord` (لا استعلام على سجل منتهٍ
  `published`/`failed`، ولا على سجل بلا `providerPublishId`، ولا استعلام مكرر أثناء جارٍ)
  و`applyTikTokPublishStatus` (لا `published` ولا `providerPostId` إلا بحالة
  `PUBLISH_COMPLETE`؛ غير ذلك يبقى `publishing`، والفشل `failed`، بلا اختراع معرّف).
- `server.ts`: `reconcileTikTokPublishes` يستعلم حالة كل سجل غير محسوم من TikTok
  (`status/fetch`) ويحدّث السجل بالدليل الفعلي، بحدّ 5 سجلات/دورة، ويشترط اتصالاً موثقاً
  (`tiktokOperationalNow`) فلا استعلام خارجي بلا توثيق. مؤقّت `setInterval` داخل عملية
  Render الدائمة (`.unref()`)، والفترة من `TIKTOK_RECONCILE_INTERVAL_MS` (افتراضياً 60
  ثانية، وأدنى 1s — يُضبط في الاختبار فقط).
- `GET /api/platforms/tiktok/publishes` (للمالك): سجل عمليات حقيقي بلا أي سرّ
  (`state`/`providerPublishId`/`providerPostId`/`delivered`/`lastCheckedAt`)، ويُثبت أن
  التسليم يُحسم تلقائياً.

اختبارات: `tiktok.connector.test.ts` صار **274 فحصاً** (مجموعة `5b` وحدة للمصالحة،
ومجموعة `16b` تكامل: قيد المعالجة ⇒ يبقى `publishing`، ثم `PUBLISH_COMPLETE` ⇒
`published` تلقائياً بمعرّف المزود، ثم `FAILED` ⇒ `failed` بلا ادعاء). فحوص final-audit
الثمانية: `tiktok-publish-reconcile-single-source` … `tiktok-publish-reconcile-tests`
(728 إجمالاً).

**لا تغيير في:** Gemini، OAuth/الصلاحيات/الاعتمادات، Facebook/Instagram/Telegram،
نموذج الجدولة، أو أي سرّ.


## العقل المركزي المُطوَّر — من تنفيذ العمليات إلى وكيل مركزي ذكي (Batch 13, 2026-09-29)

ترقية جوهرية لطبقة العقل: من «تنفيذ عمليات سوشيال» إلى **عقل مركزي واحد** يُدرك
ويحلّل ويخطّط ويقرّر ويجرّب ويتعلّم ويُحسّن — مع بقاء **الفصل الصارم** بين التحليل
(آمن، آلي) والتنفيذ الخارجي (لا يقع من العقل نفسه؛ يمر ببوابات الصلاحيات القائمة).

**قواعد ملزمة غير قابلة للتفاوض في هذه الطبقة:**
1. **لا خلط مع أي نظام سابق** ولا تغيير لهوية المشروع/بنيته الأساسية.
2. **عقل مركزي واحد فقط** — ممنوع عقل منفصل لكل منصة. كل شيء يعمل على `PlatformId`
   + مصفوفة القدرات المشتقة من السجل، فيدخل أي منصة #11 بصفّ في السجل بلا إعادة كتابة.
3. **الفصل الصريح**: `Capability ≠ Connection ≠ Verification ≠ Delivery` باقٍ،
   ويُضاف إليه `Knowledge ≠ Inference ≠ Hypothesis` و`Analysis ≠ Execution`.
4. **لا اختراع ولا ادّعاء**: كل مخرَج يحمل مصدره وعيّنته وثقته وحدوده، وغير المتاح
   يُعلن صراحةً (`UNKNOWN` / `UNAVAILABLE` / `INSUFFICIENT_DATA` / `HUMAN_INPUT_REQUIRED`).

### الوحدات الجديدة (منطق خالص، بلا شبكة وبلا أسرار)
```
engine/brain/perception/signals.ts            الإدراك: مواصفات إشارة واحدة لكل مؤشر،
                                              مصدر/طزاجة/تطبيع، والمؤشر غير المتاح بلا قيمة
engine/brain/knowledge/truth.ts               طبقة الحقيقة: VERIFIED_FACT/DERIVED_FACT/
                                              HYPOTHESIS/UNKNOWN/UNAVAILABLE/HUMAN_INPUT_REQUIRED/
                                              INSUFFICIENT_DATA + الحقائق التجارية
engine/brain/memory/longTerm.ts               ذاكرة طويلة المدى بعشرة أنواع، أصل المعرفة،
                                              وقول AI لا يصبح حقيقة
engine/brain/goals/goalEngine.ts              الأهداف + إشارات نجاح متاحة/غير متاحة + قيود صلبة
engine/brain/audience/audienceModel.ts        نموذج جمهور من تفاعل حقيقي فقط، بلا سمات حساسة
engine/brain/audience/conversationIntelligence.ts  تصنيف التعليقات + حلقات comment→content و→sales
engine/brain/market/commercialRelevance.ts    قُمع تجاري: VIEW→ENGAGED→RELEVANT→BUYING_SIGNAL→LEAD→SALE
engine/brain/experiments/experimentEngine.ts  تجارب بمتغيّر واحد + حكم inconclusive بلا عيّنة
engine/brain/timing/timingModel.ts            توقيت Asia/Baghdad عبر المصدر الواحد scheduleTime
engine/brain/strategy/capabilityMatrix.ts     مصفوفة القدرات: AVAILABLE/PARTIAL/REQUIRES_REVIEW/
                                              NOT_AVAILABLE/OWNER_ONLY (مشتقة من PLATFORM_SPECS)
engine/brain/strategy/strategyEngine.ts       توصيات قابلة للتفسير (recommendation/reason/evidence/
                                              source/sampleSize/confidence/limitations/risk/nextTest)
engine/brain/strategy/contentIntelligence.ts  مسار المحتوى + جودة الفيديو (احتمال سبب لا يقين) +
                                              نموذج أداء متعدد الأبعاد (لا views فقط)
engine/brain/decisions/decisionEngine.ts      آلي/مقترح/بشري/محجوب/غير متاح + مستويات L0..L5
engine/brain/learning/learningLoop.ts         التعلّم من الأحداث + تفضيل المالك (ليس حقيقة تجارية)
engine/brain/state.ts                         اللقطة الموحّدة + brainDiagnostics + اختبار منصة #11
engine/brain/cycles.ts                        دورة يومية/مراجعة أسبوعية (بلا تنفيذ خارجي)
engine/brain/dryRun.ts                        سيناريو تجريبي يتوقف قبل أي إجراء خارجي
engine/brain/routes.ts                        مسارات GET للقراءة فقط (dry-run للمالك)
```

### المسارات الجديدة (كلها `authenticateToken`، والـdry-run `requireOwner`)
`GET /api/agent/brain/state` | `.../diagnostics` | `.../capabilities` |
`.../cycles/daily` | `.../cycles/weekly` | `.../dry-run` — **قراءة/تحليل فقط، بلا أي مسار كتابة**.

### قرارات معمارية جوهرية
- **القدرات مشتقة من السجل لا مكتوبة يدوياً**: `capabilityMatrix` يقرأ `PLATFORM_SPECS`
  ويطبّق قيوداً صريحة موثّقة. TikTok: التعليقات/الرسائل/الجمهور/الموقع `NOT_AVAILABLE`،
  والنشر `REQUIRES_REVIEW` (نشر عام يحتاج audit). لا قدرة مُعلنة بلا تنفيذ.
- **القرار لا يُنفّذ**: `decide()` يوجّه فقط. النشر/الحذف/تغيير الإعدادات => `human_required`
  دائماً؛ والإجراء الخارجي منخفض الخطورة يبقى `L4` (موافقة المالك) لا `L5`.
- **الاستقلالية L0..L5**: L0 إدراك، L1 تحليل، L2 توصية، L3 مسودة، L4 تنفيذ بموافقة،
  L5 تنفيذ آمن مستقل — وL5 لا يُفعَّل افتراضياً.
- **الحقائق التجارية لا تُخترع**: `commercialFact` بلا مصدر => `HUMAN_INPUT_REQUIRED`،
  وحلقة البيع `runSalesLoop` تصعّد سؤال السعر غير الموثّق للمالك بدل توليد رقم.
- **لا سمات حساسة**: العمر/الجنس/المدينة/الدخل/الهوية `NOT_AVAILABLE` معلنة، والجمهور
  يُبنى من تفاعل حقيقي (موضوعات/أسئلة/أوقات) لا من تخمين.
- **مؤشرات الأداء متعددة الأبعاد**: الوصول/التفاعل/الاحتفاظ/ملاءمة الجمهور/الملاءمة
  المحلية/إشارات الشراء/نمو المتابعين/جودة المحادثة/دليل التحويل — بلا score واحد كحقيقة،
  والمعروف/المستنتج/المجهول مفصولة صراحةً.
- **/api/readiness كتلة `brain`**: `executesExternalActions: false`, `geminiUsedOnReads: false`,
  `platformsCovered`, `realConnectors`, `capabilityStates`, `knowledgeHealth`, `signalFreshness`,
  `audienceDemographicsAvailable: false` — بلا أي سرّ.

اختبارات: `engine/tests/central.brain.upgrade.test.ts` (**108 فحوص** وحدة) و
`engine/tests/brain.integration.test.ts` (**45 فحصاً** خادم حقيقي عبر HTTP: تصريح 401،
اللقطة، القدرات، الدورات، dry-run للمالك فقط، كتلة readiness، ولا تسريب أسرار).
فحوص final-audit الـ26 الجديدة: `brain-perception-single-source` … `brain-ui-panel`
(**754 إجمالاً**). سكربتات: `npm run test:brain-upgrade` و`test:brain-integration`
(مضافان إلى `npm test`).

**درس معماري:** العقل المركزي يجب أن يكون **مصدر حقيقة واحداً** يفصل التحليل عن التنفيذ،
ويشتقّ قدراته من سجل المنصات لا من فروع مكتوبة يدوياً — فيبقى صادقاً وقابلاً للتوسّع معاً.


## منظومة التعافي الكامل من الكوارث (Google Drive DR) — Batch 26 (2026-09-30)

تحويل النسخ الاحتياطي إلى **نظام تعافٍ كامل**: مخزن Google Drive مستقل يحتوي مرآة ملفات
حقيقية + نقاط استعادة كاملة (مصدر + قاعدة بيانات مشفّرة + أسرار مشفّرة + وثائق تعافٍ)،
مع محرّك استعادة واختبار تعافٍ معزول حقيقي. نطاق OAuth يبقى `drive.file` حصراً،
وتفويض Drive منفصل عن تسجيل الدخول، والمفاتيح القائمة لم تُدوَّر.

**البنية على Drive** (`al-gharabi-ai-dr`): `CURRENT/` (مرآة الملفات الفردية + manifest +
current-state)، `HISTORY/rp-XXX/` (نقاط مستقلة غير قابلة للتعديل)، `DATABASE/`، `SECRETS/`،
`RECOVERY/` (وثائق مستقلة تُقرأ بلا تشغيل الغرابي).

**الوحدات الجديدة (`tools/dr/`):**
- `secret-crypto.mjs`: حزمة `secrets.enc` موسومة `GHARABI-SECRETS-V1`، AES-256-GCM بمفتاح
  مشتقّ scrypt (N=16384,r=8,p=1)، `buildSecretsBundle`/`decryptSecretsPackage`،
  `discoverSecretEnvNames` (يكتشف الأسماء الفعلية من البيئة فقط، بلا اختراع)،
  `resolveMasterKey` (`DR_RECOVERY_MASTER_KEY` ثم `DRIVE_DB_BACKUP_KEY` ثم مفتاح التوكنات).
  البيان يحمل **أسماء وبصمات فقط** (includedNames/encryptedSecretsHash/keyFingerprint).
- `current-mirror.mjs`: `runCurrentMirror` — مرآة فردية متداخلة، رفع المتغيّر فقط، حذف
  المتقادم من CURRENT (لا من HISTORY)، **ترقية ذرّية** (بيان معلّق ثم تثبيت أخيراً)،
  لا تغيير => `no_change` بلا رفع، تحقق فعلي بإعادة قراءة كل ملف من Drive.
- `restore.mjs`: `verifyRecoveryPoint` (بصمات source/db/secrets/manifest، فشل آمن عند
  التلف/النقص/المفتاح الخاطئ) و`runRecoveryDrill` (تنزيل → تحقق → فكّ → استخراج مصدر →
  استعادة قاعدة في قاعدة **معزولة** فقط، `wroteToProduction:false`).
- `secrets-restore.mjs`: أداة فكّ الأسرار يدوياً عند الكارثة (بلا تشغيل الغرابي).
- `cloud-lib.mjs`: `buildRecoveryInformation`/`buildRecoveryInstructions`/`buildLatestRecovery`
  (وثائق RECOVERY)، `scanForSecretsStrict` (بوابة صارمة تميّز السر الحقيقي من الوهمي/القالب).

**المسارات (`engine/dr/routes.ts`، كلها `authenticateToken` والفعل منها `requireOwner`):**
`/api/dr/drive/auth-url`, `/callback` (GET+POST)، `/api/dr/backup`, `/api/dr/sync`,
`/api/dr/health`, `/api/dr/status`, `/api/dr/secrets/status`, `/api/dr/recovery-points`,
`/api/dr/restore/plan`, `/api/dr/restore/drill`, `/api/dr/restore/production`.

**حمايات ملزمة (مُختبرة):**
- **لا استعادة إنتاجية تلقائية**: `/restore/production` يرد 428 بلا `confirm:true`، ثم 501
  بخطوات خارجية موثّقة (Render redeploy + env vars) — لا كتابة فوق الإنتاج من الكود.
- **اختبار الاستعادة يرفض قاعدة الإنتاج** صراحةً (`REFUSED_PRODUCTION_DATABASE` عند تطابق
  `DR_RECOVERY_TEST_DATABASE_URL` مع `DATABASE_URL`)، ولا يُعيد SQL خاماً ولا أسراراً.
- **الأسرار لا تظهر** في manifest/الواجهة/السجلات/الردود — أسماء وبصمات فقط، وفكّ تجريبي
  يثبت أن المفتاح يفتح الحزمة بلا كشف أي قيمة.
- **لا حذف HISTORY تلقائياً**، وفشل جزئي لا يرقّي CURRENT ولا يحذف نسخة سليمة.
- **لا تُقرأ DATABASE_URL** في منظومة النسخ إلا لمقارنة *رفض* قاعدة الإنتاج.

**اختبارات:** `engine/tests/dr/` = 13 مجموعة، **537 فحصاً** كلها ناجحة (CORE 48, STORE 33,
SYNC 38, AUTH 48, DB 17, ROUTES 46, BACKUP 98, SECRETS 29, MIRROR 20, RESTORE 28,
ENDPOINTS 33, REAL-DRILL 27, UI 72). `final-audit` = **853 فحصاً**. اختبار التعافي الحقيقي
`dr.real-drill.test.ts` يشغّل Postgres مدمجة **معزولة** (بلا شبكة/إنتاج)، ينشئ نقطة استعادة
على fakeDrive، يتحقق من البصمات، يفكّ التشفير، يستعيد المصدر، يقلع الخادم المستعاد فعلياً
على القاعدة المعزولة ويفحص health/readiness/brain، ويثبت أن المفتاح الخاطئ يفشل بأمان.
هارنس `tools/local-verification/recovery-drill.mjs` يقرأ **نقطة استعادة حقيقية من Google Drive**
حين تتوفر اعتماداته في البيئة (يفشل بأمان `drive_not_configured` بلا اعتماد).

**حدود الأتمتة (صادقة):** AUTOMATIC = النسخ/المزامنة/نقاط الاستعادة/التحقق/فكّ التشفير/
الاستعادة في بيئة معزولة. OWNER CONFIRMATION = أي استعادة إنتاجية وأي حذف تاريخي.
EXTERNAL PLATFORM REQUIREMENT = إعادة نشر Render وضبط متغيّراتها وتفويض Google OAuth.
MANUAL FALLBACK = الاستعادة اليدوية من الحزمة عند تعذّر Drive.

**لا تغيير في:** YouTube/TikTok/Instagram/Facebook/Telegram، Gemini firewall، Central Brain،
قاعدة البيانات، Authentication، OAuth، Content Pipeline، YouTube watcher، التعليقات/الردود/
النشر/الجدولة. لا تدوير لأي مفتاح، ولا توسيع `drive.file`.

## إثبات المرحلة 4 (DR Stage 4) + إصلاح جذر «لا تغيير» الكاذب (2026-10-01)

سكربت إثبات واحد قابل لإعادة الإنتاج يمرّ بالترتيب المطلوب ويثبت كل مرحلة بدليل صادق:
`engine/tests/dr/dr.stage4.evidence.ts` (`npm run test:dr-stage4`). خلفيتان:
- الافتراضي: Google Drive **وهمي محلي** يطبّق نفس عقد REST (الناقل القابل للحقن) — يثبت
  منطق المنظومة كاملاً، وليس دليلاً على Google Drive الحقيقي.
- `--real`: يستخدم اعتماد Drive الحقيقي من البيئة (`DRIVE_OAUTH_*`) ويرفع فعلاً؛ بلا اعتماد
  يفشل بأمان `drive_not_configured` بلا أي ادعاء.

الخطوات الـ15: إنشاء rp-003 · CURRENT مجلد مرآة **فردية** (ملفات متداخلة لا ملف مضغوط) ·
HISTORY/rp-003 · DATABASE مشفّرة فقط (لا SQL خام) · SECRETS مشفّرة فقط (بلا قيمة مكشوفة) ·
RECOVERY وثائق · إضافة ملف · تعديل ملف · حذف ملف (ينعكس في CURRENT ويبقى في HISTORY) ·
لا تغيير (لا نقطة تاريخية جديدة) · Recovery Drill معزول (Postgres مدمجة حقيقية + كتابة
المصدر + فكّ الأسرار/القاعدة) · تلف نسخة اختبارية (يُكتشف، والنسخ السليمة لا تُستبدل) ·
rp-002 سليمة · خطة استعادة «بنقرة واحدة» بلا استعادة إنتاجية · بوابات الأمان.

**الجذر المُصلح:** `tarHeader` في `tools/dr/cloud-lib.mjs` كان يكتب `mtime = Date.now()`
في ترويسة tar، فبصمة حزمة المصدر (`sourceHash`) تتغيّر كل تشغيل **وإن لم يتغيّر المحتوى**.
النتيجة: كشف «لا تغيير» (`isSameSource`) يفشل عشوائياً، وكل نسخة تُنشئ نقطة استعادة جديدة
بلا تغيير حقيقي (والاختبار القديم كان يمرّ فقط عندما تقع النسختان في الثانية نفسها).
الإصلاح: mtime ثابت (`00000000000`) فتصبح الحزمة قابلة لإعادة الإنتاج لنفس المدخلات.
اختبار انحدار في `dr.core.test.ts` (تطابق البصمة + ثبات حقل mtime + تغيّرها مع المحتوى).

**إصلاح ثانٍ — لا فشل صامت في المرآة:** كان `currentMirror` في `/api/dr/health` يعرض
`synced: true` بمجرد وجود كائن `driveMirror`، حتى لو فشلت المزامنة (بلا `treeHash`)، ولا
يُحفظ سبب الفشل إطلاقاً. الآن `synced` تتطلّب **بصمة شجرة فعلية** (`Boolean(mirror?.treeHash)`)،
وسبب آخر فشل للمرآة (من مساري `/api/dr/backup` و`/api/dr/sync`) يُحفظ في `driveMirror.error`
ويُعلن في `health.dr.currentMirror.error` بلا أي سرّ. اختبارات في `dr.endpoints.test.ts`
(39 فحصاً): صحة المرآة بعد المزامنة + فشل مزامنة مُعلن بسببه بلا سرّ.

فحوص final-audit: `dr-stage4-*` و`dr-source-bundle-deterministic` و`dr-no-change-deterministic`
و`dr-mirror-no-silent-failure` و`dr-mirror-error-exposed-health` (**862 فحصاً**). DR = 543 فحصاً.

**إصلاح ثالث — لا يُجمع سبب فشل الرمز تحت `unauthorized` (2026-10-01):** كان
`classifyTokenError` في `tools/dr/drive-auth.mjs` يطوي `invalid_client` و401 العام تحت كود
`unauthorized` واحد، وكان `createRefreshTokenProvider` يرمي `no_refresh_token` بكود
`unauthorized` أيضاً. النتيجة: فشل `POST /api/dr/backup` ظهر «فشل غير متوقّع (unauthorized)»
بلا تمييز السبب الحقيقي. الآن الأكواد منفصلة تماماً ولا يُصدر مسار OAuth كود `unauthorized`
إطلاقاً: `no_refresh_token` / `refresh_token_undecryptable` / `invalid_client` /
`token_refresh_unauthorized` (401 عام) / `token_refresh_other_error`.

**فحص تشخيصي قراءة-فقط (`diagnoseDriveRefreshToken`):** يثبت أن رمز التجديد المخزّن موجود
و**يُفكّ بالمفتاح الحالي**، ثم — فقط عند وجود اعتماد كامل — ينفّذ **طلب تجديد واحد** لجلب
access token (بلا أي عملية Drive كتابة، بلا تغيير الرمز، بلا إعادة تفويض). لا يُعيد أي قيمة
سرّية أبداً، فقط: `stored` / `decryptable` / `providerRefresh` (`ok|failed|not_tested`) /
`reason`. `/api/dr/health` يعرضها في كتلة `refreshToken` (مع تخبئة 5 دقائق تمنع تكرار طلب
التجديد عند كل نداء). اختبارات في `dr.auth.test.ts` (60 فحصاً: فكّ صحيح، مفتاح خاطئ، رمز
مفقود، `invalid_client`، 401 عام، اعتماد غير مضبوط، وعدم تسريب أي سرّ) و`dr.endpoints.test.ts`
(41 فحصاً). فحوص final-audit الجديدة: `dr-token-errors-distinct` … `dr-refresh-diagnostic-tests`
(**868 فحصاً**). DR = 565 فحصاً.

**حد صادق:** لا يوجد اعتماد Drive في بيئة التطوير هذه، ولا تُشغَّل النسخة تلقائياً (لا
`setInterval`؛ المسار `POST /api/dr/backup` للمالك فقط). لذا «rp-003 حقيقية على Google Drive»
تتطلّب تفعيل النسخة من جلسة المالك على الإنتاج (`/api/dr/backup`)، ثم إعادة تشغيل السكربت
بـ`--real` مع توفّر `DRIVE_OAUTH_*` في البيئة. لا يُعلن أي وكيل برمجي إنشاء rp-003 على Drive
بلا هذا الدليل. rp-002 لا تُحذف ولا تُعدّل (نقاط الاستعادة غير قابلة للتعديل).

## جذر «نسخة الملفين» في CURRENT — مصدر موثوق من Git + حماية المصدر الناقص (2026-10-01)

**الدليل القاطع (لا تخمين):** CURRENT في Google Drive كان يحوي ملفين فقط
(`package.json`, `package-lock.json`)، وبصمته تطابق تلك المجموعة حرفياً:
`treeHash 2f70746bab8e18fe7f00ba7094730c913d1d03a91ebc32147290c167152e6f28` و
`sourceHash df9c0d09fe584ab79c6d41e53177a89e839829bfa122b88476a621f4dc66cb81`
(أُعيد إنتاجهما محلياً لمجموعة الملفين بالضبط؛ الشجرة الكاملة 243 ملفاً تعطي بصمة مختلفة).

**السبب الحقيقي:** `collectRepoFiles(process.cwd())` كان يمشي على مجلد التشغيل. لكن
مستودع المشروع يحوي **`Dockerfile`** (مرحلة runtime تنسخ فقط `package.json`+`package-lock.json`+
`dist/`)، و`render.yaml` يقول `runtime: node` لكن **خدمة Render مضبوطة فعلياً على Docker**
(يُثبت بوجود `.dockerignore` + Dockerfile منذ 2026-09-21 + البصمة المطابقة تماماً لمجموعة
الملفين). أي أن `process.cwd()` على الإنتاج = مجلد الصورة = ملفان فقط. لا fallback ولا allowlist
في الكود، والمشي يعمل كما هو مُبرمَج؛ المدخل نفسه كان ناقصاً.

**الإصلاح:**
- `tools/dr/cloud-sync.mjs`: `collectGitTrackedFiles(rootDir)` (عبر `git ls-files -z`) و
  `collectTrustedSourceTree(rootDir)` — يفضّل **الشجرة المتتبَّعة في Git** (المشروع المعتمد
  الكامل، 243 ملفاً)، ويسقط صراحةً إلى المشي على المجلد عند غياب Git مع وسم `source: git|walk`.
  لا يُستبعد ملف مهم لمجرد حجمه (الحد 8MiB فقط لملفات ضخمة جداً).
- `assessSourceCompleteness(files)` — مصدر واحد: حد أدنى `SOURCE_MIN_FILES=10` + ملفات إلزامية
  `SOURCE_REQUIRED_FILES=[server.ts, package.json, package-lock.json]`. يعيد `complete` و`reason`.
- `server.ts`: `collectSourceFiles: () => collectTrustedSourceTree(process.cwd())`.
- `engine/dr/routes.ts`: **حماية صريحة** في `/api/dr/backup` و`/api/dr/sync` — إن كان
  `collected.complete === false` يُرد **409 `SOURCE_INCOMPLETE`** (بلا أي رفع ولا ترقية)، مع
  تفاصيل `sourceCollection` (source/fileCount/minFiles/missingRequired/reason) بلا محتوى ولا سرّ.
- `/api/dr/health`: كتلة `sourceCollection` (مخبّأة 5 دقائق) تُعلن فوراً مصدر الجمع واكتماله
  وعدد ملفاته — فيُكشف أي مجلد تشغيل ناقص قبل أي نسخة.
- اختبار `engine/tests/dr/dr.source.test.ts` (`npm run test:dr-source`، 23 فحصاً): الشجرة الموثوقة
  كاملة محلياً (تضم server.ts/engine/src، وتستبعد node_modules/dist/.env)، رفض مجموعة الملفين،
  ورفض `/api/dr/backup` و`/api/dr/sync` بـ409 بلا رفع. final-audit = **889 فحصاً**.

**درس عام:** لا تُبنَ النسخة من `process.cwd()` بلا إثبات محتواه على بيئة التشغيل. على Docker
يكون مجلد العمل صورة مصغّرة، فيجب الجمع من مصدر موثوق (Git) + حماية اكتمال صريحة تمنع
«نسخة سليمة» من شجرة ناقصة.

**ما بقي على المالك (إجراء خارجي لا ينفّذه أي وكيل):**
1. على Render، تأكد أن خدمة `al-gharabi-ai` إمّا Runtime=Node (لا Docker)، أو أن صورة Docker
   تنسخ الشجرة الكاملة. بدونه يعمل `collectTrustedSourceTree` عبر Git فقط إن وُجد `.git`،
   وإلا يُرفض بـ`SOURCE_INCOMPLETE` (وهذا مقصود: لا نسخة ناقصة).
2. نفّذ `/api/dr/sync` ثم `/api/dr/backup` من جلسة المالك بعد النشر لإصلاح CURRENT (مرآة 243
   ملفاً) وإنشاء نقطة استعادة كاملة جديدة. لا تُحذف rp-002/rp-003.
3. شغّل `/api/dr/restore/drill` و`dr.stage4.evidence.ts --real` مع `DRIVE_OAUTH_*` لإثبات
   الاستعادة الحقيقية من Drive خارج الغرابي.


## المزامنة التلقائية + الفحص الساعي + وثائق RECOVERY الموحّدة (2026-10-01)

إكمال دورة CURRENT بلا اعتماد على تفاعل المستخدم، على نفس فرع PR #9.

### 1) مشغّل التغيّر (change-trigger)
`runReconciliationCycle` في `engine/dr/routes.ts` يقارن **بصمة شجرة المصدر الحالية**
(عبر `buildMirrorSnapshot`) مع بصمة CURRENT المحفوظة في `control.driveMirror.treeHash`.
- تطابق ⇒ `no_op` (لا رفع، لا كتابة).
- اختلاف ⇒ مزامنة CURRENT عبر **نفس** مسار `/api/dr/sync` (`runSync`) بكل بواباته.
- المصدر ناقص (`complete === false`) ⇒ `source_incomplete` بلا أي تغيير.
- يُكتشف تغيّر `commit` أيضاً (`commitChanged`) ويُعلن في health. لا نقطة استعادة لكل
  تعديل ملف: CURRENT يتحدث فقط؛ HISTORY/Recovery Point وفق سياسة النقاط.

### 2) الفحص الساعي (hourly reconciliation)
مؤقّت داخلي `setInterval(..., 60*60*1000)` يُبدأ في `server.ts` **بعد** `app.listen`
(لا يعتمد على المتصفح)، ويُخزَّن في `(app as any).drReconciliation`. `.unref()` فلا يمنع
الإغلاق النظيف. **لا يستدعي Gemini ولا أي AI** (كل شيء حتمي: جمع + بصمة + مزامنة).
- **منع التزامن**: `reconciliationRunning` يمنع دورة متوازية؛ والمؤقّت يتخطّى الدورة إن
  كان `backupRunning` (نسخة/مزامنة جارية). `runSync` نفسه محمي بـ`backupRunning`.
- **idempotency/restart**: نتيجة آخر فحص تُحفظ في `control.driveReconciliation` عبر
  المحوّل (`loadControl`/`buildControlState`/`applyControlSnapshot`) فتصمد بعد
  restart/cold start، والفحص التالي على نفس المصدر يعطي `no_op` بلا رفع مكرّر.
- مسار يدوي للمالك `POST /api/dr/reconcile` (تشخيص) بلا AI.

### 3) الصدق في /api/dr/health
`changeTrigger` (enabled/detection/lastCommit/currentMirrorCommit/commitChanged)،
`hourlyReconciliation` (enabled/intervalMinutes/running/scheduled/lastReconciliationAt/
lastReconciliationResult/lastReconciliationTrigger/lastReconciliationReason/count)،
`lastReconciliationAt`، `lastReconciliationResult`، و`currentMirror` — كلها بلا أي سرّ.

### 4) وثائق RECOVERY الموحّدة (تُقرأ من Google Drive مباشرة)
`RECOVERY/START-HERE.md` و`RECOVERY-GUIDE.md` و`RECOVERY-MANIFEST.json` (مصدر واحد في
`cloud-lib.mjs`: `buildStartHereDoc`/`buildRecoveryGuideDoc`/`buildRecoveryManifestDoc` +
`writeRecoveryDocs`). تُكتب عند كل نسخة (`backup.mjs`) عبر `store.writeRecoveryDoc/
writeRecoveryJson`. تشرح: أين CURRENT/HISTORY/القاعدة المشفّرة/الأسرار المشفّرة، كيف نختار
آخر نقطة سليمة، ترتيب الاستعادة، ما يُستعاد تلقائياً، ما يحتاج المالك، وأن المفتاح الرئيسي
**لا يُحفظ داخل النسخة**. الأسماء القديمة (`recovery-information.md`/`recovery-instructions.md`/
`latest-recovery.json`) تبقى للتوافق.

### 5) اختبارات
`engine/tests/dr/dr.reconciliation.test.ts` (`npm run test:dr-reconciliation`، 48 فحصاً):
المؤقّت 60 دقيقة، أول تشغيل synced، no-op، تغيّر يُزامَن، مصدر ناقص، قفل التزامن،
restart/idempotency، وثائق RECOVERY، وحالة health بلا أسرار. `dr.backup.test.ts` صار 104
(أسماء الوثائق الموحّدة). final-audit = **903 فحصاً**. `npm run lint/build/test` ناجحة.

**لم يُمسّ:** لا رفع إلى Drive، لا rp-004، لا تعديل Render، لا سرّ/مفتاح، لا rp-002/rp-003.


## خزنة مفاتيح الطوارئ (Emergency Key Vault) + تشخيص DR OAuth redirect — Batch DR (2026-10-01)

### خزنة مفاتيح الطوارئ `KEY-VAULT/` — إكمال وتوثيق واختبار
استُكملت خزنة الطوارئ (كانت الكود فقط) ببيئة/توثيق/واجهة/اختبارات:
- `tools/dr/key-vault-crypto.mjs`: مصدر واحد (`buildVaultRecords`، `encryptKeyVault`،
  `decryptKeyVault`، `inspectVaultKey`، `decodeVaultKey`). تُفتح بمفتاح **مستقل تماماً**
  `DR_RECOVERY_VAULT_KEY` (64 hex أو Base64 لـ32 بايت) — لا بالمفتاح الرئيسي.
- `tools/dr/vault-restore.mjs`: أداة فكّ يدوية عند الكارثة (بلا تشغيل الغرابي): تطبع
  الأسماء فقط افتراضياً، وتكتب القيم في `--out` بصلاحيات 0600، ولا تطبع أي قيمة سرّية.
- `engine/dr/recoveryVault/{inventory.ts,vault.ts}`: الجرد schema-based بلا أسرار، والمنطق
  المُرقّم (HEAD واحد + نسخ `KV-<N>` + `current.enc`) مع كشف «لا تغيير» ببصمة المحتوى،
  وإصلاح جذر: التنظيف المعلّق يُعاد بلا إنشاء نسخة جديدة ولا `no_change` كاذب.
- `engine/dr/routes.ts`: مسارات owner (`status`/`sync`/`backup`/`verify`/`drill`)، والنسخة
  الاحتياطية تُزامن الخزنة تلقائياً (غير قاتلة)، و`/api/health.dr.keyVault` بلا أي سرّ.
- `.env.example` و`render.yaml` و`scripts/generate-secrets.mjs`: `DR_RECOVERY_VAULT_KEY`
  (بلا قيمة في Git). الواجهة: قسم «خزنة مفاتيح الطوارئ» في `CloudBackupView`.
- اختبار: `engine/tests/dr/dr.keyvault.test.ts` (`npm run test:dr-keyvault`، **63 فحصاً**)
  + فحوص خزنة في `dr.endpoints.test.ts` (70) و`dr.real-drill.test.ts` (34). final-audit
  صار **929 فحصاً** (`dr-keyvault-*`).

### تشخيص `redirect_uri_mismatch` في إعادة ربط Google Drive (تشخيص فقط، بلا تعديل)
- قيمة `redirectUri` الفعلية التي ينتجها `/api/dr/drive/auth-url` هي **ثابت صريح**:
  `https://al-gharabi-ai.onrender.com/api/dr/drive/callback`
  (`DRIVE_OAUTH_REDIRECT_URI` في `tools/dr/cloud-lib.mjs`) — **لا تُشتق من `APP_URL`**
  ولا من أي متغيّر بيئة، فلا يوجد أي انحراف بمصدر مختلف.
- لا شرطة مائلة زائدة، ولا نطاق مختلف: المسار `/api/dr/drive/callback` هو نفسه في
  التسجيل والتفويض والتبادل (`stateStore.consume` يقارن `redirectUri` بالضبط).
- `DRIVE_OAUTH_CLIENT_ID` مُضبوط فعلاً في الإنتاج (`oauthClient.clientIdPresent=true`,
  `effectiveClientIdSource=drive`, صيغة `google_client_id` صحيحة، بلا مسافات، بصمة
  `7d755d3442b7`) — **لا يُعرض السرّ ولا الرمز**.
- الوضع الحالي على الإنتاج: `configured=true`, `authorized=true`, `reauthorizationNeeded=false`,
  `refreshTokenUsable=true`, `nextAction=none` — أي أن الربط **قائم وسليم الآن**، وفحص
  `/api/dr/drive/callback` بلا `state` يرد **302** إلى `/?dr=error&reason=MISSING_CODE_OR_STATE`
  (لا 500). فالعطل السابق كان `redirect_uri` مسجّلاً خطأً في Google Cloud Console فقط.
- **الشرط الخارجي الوحيد المتبقي (لا ينفّذه أي وكيل):** أن يطابق المسجّل في
  Google Cloud Console → OAuth Client (نفس `client_id` بالبصمة أعلاه) → Authorized redirect
  URIs القيمة أعلاه **حرفياً**. لو ظهر `redirect_uri_mismatch` مستقبلاً فسببه أن المسجّل
  هناك مختلف (شرطة مائلة/نطاق/http) وليس الكود.


## إغلاق DR: منع الاحتواء الدائري لمفتاح الخزنة + إثبات «فقدان كل المفاتيح» (2026-10-01)

**العطل المُثبت (لا تخمين):** `DR_RECOVERY_VAULT_KEY` — المفتاح الذي **يفتح** خزنة مفاتيح
الطوارئ — كان **يُخزَّن داخل الخزنة نفسها** لأن `presentInventoryNames()` كانت تُرجعه (فهو
في الجرد كي يظهر للمالك في واجهة الجرد)، فيشفّره `encryptKeyVault` ضمن الحمولة. أُثبت حياً:
`buildVaultSnapshot(env).names` كان يحوي `DR_RECOVERY_VAULT_KEY`، و`decryptKeyVault`
يعيده بين القيم. هذا يخالف توثيق الوحدة صراحةً («المفتاح لا يُحفظ داخل Drive أبداً») ويخلق
احتواءً دائرياً: من يفتح الخزنة يسترجع مفتاح فتحها، فتنهار قيمة «مفتاح مستقل خارج النظام».

**الإصلاح (مصدر واحد + دفاع مزدوج، بلا أي سرّ):**
- `engine/dr/recoveryVault/inventory.ts`: ثابت `VAULT_SELF_KEY_ENV`، و`presentInventoryNames`
  تستبعده فلا يدخل الخزنة (يبقى في الجرد ليُعرض تصنيفه).
- `tools/dr/key-vault-crypto.mjs`: `buildVaultRecords` و`encryptKeyVault` يُسقطان
  `VAULT_KEY_ENV` دفاعاً مزدوجاً حتى لو وصل خطأً.
- تصنيف الاستعادة الجديد `engine/dr/recoveryVault/recoveryReport.ts`
  (`RESTORABLE`/`REGENERATABLE`/`REQUIRES_OWNER_ACTION`/`NOT_RECOVERABLE`) يوسم مفتاح الخزنة
  `REQUIRES_OWNER_ACTION` صراحةً، ويعرض ملخّصه في `keyVaultStatus` (`recovery.summary` +
  `vaultSelfKeyStored`) بلا أي قيمة. **قيمة حرجة مفقودة تُعلن `NOT_RECOVERABLE` لا تُخفى.**

**إثبات «فقدان كل المفاتيح» (All-Keys-Lost Drill):** `engine/tests/dr/dr.lostkeys.test.ts`
(`npm run test:dr-lostkeys`، 30 فحصاً، مضاف إلى `test:dr`): يبني نسخة + خزنة على Drive وهمي،
ثم **يُسقط كل مفاتيح بيئة التشغيل** ويُبقي فقط مفتاح الخزنة، ويثبت: فتح الخزنة بالمفتاح
وحده، رفض المفتاح الخطأ، كشف عبث الحزمة، فكّ `database.enc` و`secrets.enc` بمفاتيح
**مُستعادة من الخزنة** (لا من بيئة التشغيل)، استخراج المصدر، وإقلاع نسخة معزولة
(health/readiness/dr). لا يلمس الإنتاج، ولا يطبع أي سرّ.

**سلامة CURRENT ضد الانقطاع (مُتحقّقة ومُختبرة):** `runCurrentMirror` يكتب البيان ثم
`HEAD.json` (نقطة الالتزام الوحيدة) **قبل** حذف النسخ القديمة؛ فشل الكتابة/البيان/الاعتماد
يُبقي CURRENT السابقة سليمة، وفشل التنظيف = `cleanupPending` بلا إسقاط الاعتماد. أُضيف
اختبار تزامن متوازٍ (`dr.mirror.test.ts`) يثبت أن مزامنتين متزامنتين لا تُنتجان اعتماداً
على بصمة غير صحيحة ولا نسخة بلا بيان (48 فحصاً).

فحوص final-audit الجديدة: `dr-keyvault-no-self-key`، `dr-keyvault-self-key-test`،
`dr-lostkeys-drill`، `dr-lostkeys-honest-classification`، `dr-lostkeys-no-production`
(**934 فحصاً** إجمالاً). لم يُمسّ أي سرّ/مفتاح/إعداد Render، ولم يُنفَّذ أي نشر أو دمج PR #9.


## حالة إغلاق DR (2026-10-01): تحقق محلي كامل + نقطة توقف على صلاحيات المالك

أُنجزت كل خطوات التحقق الممكنة **محلياً** بنجاح؛ وما تبقّى (دمج/نشر/rp-004 حقيقي/فحص
الإنتاج) موقوف على صلاحيات غير متوفّرة في بيئة الوكيل — أُعلن صراحةً لا يُدّعى إنجازه.

**بيئة الوكيل (مُثبت):** الإنتاج `bca35d9` يعمل و`/api/health` يرد 200، لكن **لا اعتماد
Drive/DR في البيئة** (كل `DRIVE_*`/`DR_*`/`DATABASE_URL` غير مضبوطة)، وGitHub API يرد 401،
و`git push` يطلب كلمة مرور (لا صلاحية كتابة)، ولا أداة نشر/إعادة تشغيل Render. لذا لا يمكن
إنشاء rp-004 حقيقي ولا دمج PR #9 ولا النشر ولا فحص DR على الإنتاج من هنا.

**ما أُثبت محلياً (كل شيء PASS):**
- `npm run test:dr` = 18 مجموعة (CORE 51, SOURCE 23, STORE 33, SYNC 38, AUTH 82, DB 17,
  ROUTES 48, BACKUP 104, SECRETS 34, MIRROR 48, KEY VAULT 70, KEY RELATIONS 35,
  RECONCILIATION 48, RESTORE 28, ENDPOINTS 70, REAL DRILL 34, LOST-KEYS 30, UI 81).
- اختبار جديد `dr.keyrelations.test.ts` (**35 فحصاً**): يثبت أن المفاتيح الأربعة
  (`DR_RECOVERY_VAULT_KEY`/`DR_RECOVERY_MASTER_KEY`/`DRIVE_DB_BACKUP_KEY`/
  `DRIVE_TOKEN_ENCRYPTION_KEY`) **مستقلة تماماً** (لا مفتاح يفتح عمل آخر)، وأن master/db/token
  تُستعاد من الخزنة، وأن مفتاح الخزنة لا يُخزَّن داخلها، وأن مفتاح التوكنات يصلح بديلاً
  لنسخة القاعدة فقط. بلا تغيير أي قيمة إنتاجية.
- `dr.real-drill.test.ts` (**34 فحصاً**): يستعيد فعلياً من نقطة استعادة إلى **Postgres مدمجة
  معزولة**، يُقلع نسخة من المصدر المستعاد ويفحص `/api/health` (backend=postgres) و
  `/api/readiness` (applicationReady) وكتلة `brain`، ويثبت أن المفتاح الخاطئ يفشل بأمان وأن
  النسخة السليمة تبقى تُفكّ. **هذا إثبات استعادة فعلي في بيئة معزولة.**
- `dr.stage4.evidence.ts` (15 خطوة) يمرّ بـ0 فشل على Drive **وهمي محلي** (عقد REST نفسه)،
  ويشمل: مرآة CURRENT فردية، حذف ينعكس في CURRENT ويبقى في HISTORY، «لا تغيير» لا يُنشئ نقطة،
  دورة استعادة معزولة، كشف عبث، rp-002 سليمة، خطة استعادة «بنقرة» بلا استعادة إنتاجية.
- `npm test` كامل ✅ (EXIT=0، 72 مجموعة، بلا فشل) · `lint` ✅ · `build` ✅ ·
  `final-audit` ✅ (**935 فحصاً**) · secret scan على الملفات المتتبَّعة = نظيف (كل المطابقات
  قيم وهمية في الاختبارات).

**نقطة توقف المالك (لا ينفّذها أي وكيل):** (1) صلاحية كتابة GitHub لدمج PR #9 (الفرع
`dr/trusted-source-and-incomplete-guard`، head المحلي `29830da`، head المدفوع لـPR=`cc475fd`)
— لا دمج بلا موافقة صريحة. (2) Render auto-deploy بعد الدفع. (3) من جلسة المالك على الإنتاج:
`POST /api/dr/backup` لإنشاء **rp-004 الحقيقي**، ثم فحص CURRENT/DATABASE/SECRETS/KEY-VAULT/
RECOVERY وRecovery Drill المعزول من rp-004. لا حذف/تعديل لـrp-002/rp-003، ولا تغيير أي مفتاح.

## إغلاق فجوة SOURCE_INCOMPLETE في الإنتاج — حزمة مصدر موثوقة زمن البناء (2026-10-01)

**الجذر المُثبت:** صورة الإنتاج (Docker) النهائية تحوي `dist/` و`package.json` فقط — بلا
`.git` وبلا `server.ts` (وسيط متعدد المراحل ينسخ `dist` فقط). فجمع المصدر وقت التشغيل
يسقط إلى مشي نظام الملفات فيجد ملفين، ويرفضه حرس `SOURCE_INCOMPLETE`
(`missingRequired=['server.ts']`) فيمنع `POST /api/dr/backup` (rp-004). الإصلاح لا يعطّل
الحرس إطلاقاً، بل يُغذّيه بشجرة مصدر **موثوقة كاملة**.

**الوحدة الجديدة `tools/dr/source-bundle.mjs` (منطق صافٍ قابل للاختبار):**
- `buildTrustedSourceBundle` يبني `tar.gz` حتمياً من **الشجرة المتتبَّعة في Git**
  (`git ls-files -z`) — لا `dist`/`node_modules`/`.env`/`.git`، مع احتياطي مشي الشجرة
  عند غياب git زمن البناء. **بوابة أسرار صارمة fail-closed** (`scanForSecretsStrict`):
  لا تُشحن حزمة تحمل سرّاً حقيقياً الشكل.
- حتمية: mtime ثابت (epoch 0) + gzip مستوى ثابت ⇒ نفس الشجرة = نفس `treeHash` ونفس
  الأرشيف بالبايت.
- ربط بالـcommit: يُسجَّل `commit` من `git rev-parse HEAD`، و`bindBundleCommit` يقارنه
  بـ`RENDER_GIT_COMMIT` ويُعلن التطابق/الاختلاف صراحةً (لا ادّعاء commit).
- `readTrustedSourceBundle` يفكّ إلى ذاكرة فقط ويتحقق من `treeHash` مقابل البيان.

**الـcollector (`tools/dr/cloud-sync.mjs`) — بترتيب أسبقية بلا تعطيل الحرس:**
`git` (إن كانت الشجرة **كاملة**) ثم **`bundle`** (بيئة الإنتاج بلا `.git`) ثم `walk` (آخر
خيار، يُرفض إن كان ناقصاً). `assessSourceCompleteness` تُطبَّق على الحزمة أيضاً، فالحرس
`SOURCE_INCOMPLETE` باقٍ كما هو.

**البناء والنشر:** `npm run build` صار `vite build` ثم `node tools/dr/source-bundle.mjs
dist/dr-source` ثم `esbuild`، فتُشحن الحزمة داخل `dist/dr-source` وتنسخها الصورة مع `dist`.
`.dockerignore` لم يعد يستبعد `.git` (ليبني الـcommit)، و`git` يُثبَّت في **مرحلة البناء
فقط** (`node:20-slim` لا يحوي git)، فالصورة النهائية بلا git وبلا مصدر — فقط الحزمة + `dist`.

**إثبات حي (صورة فعلية):** بناء الصورة ثم تشغيل `dist/server.cjs` داخلها أعطى
`/api/dr/health.dr.sourceCollection = { complete:true, source:'bundle', fileCount:253,
missingRequired:[], bundle:{ commit:'05c18e9…', treeMatchesManifest:true } }`. أي أن
`SOURCE_INCOMPLETE` اختفى **بشجرة كاملة**، بلا تعطيل الحرس.

اختبارات: `engine/tests/dr/dr.source.bundle.test.ts` (`npm run test:dr-source-bundle`،
35 فحصاً): حتمية البناء، فكّ الأرشيف، قراءة الحزمة في بيئة شبيهة بـDocker (complete=true +
`server.ts`)، رفض الحزمة عند حذف `server.ts` (الحرس)، ربط/عدم تطابق الـcommit، و**عدم
تأثّر CURRENT عند فشل الجمع (crash-safe)**. فحوص final-audit الجديدة `dr-source-bundle-*`
(950 إجمالاً). `npm test` كامل ناجح · `lint` ناجح · `build` ناجح.

**لا تغيير في:** Gemini، OAuth/الاعتمادات/المفاتيح، سوشيال المنصات، Central Brain، أو أي سرّ.

## ربط حزمة المصدر بـcommit النشر في Render — `RENDER_GIT_COMMIT` (2026-10-01)

**الجذر المُثبت:** Render يبني عبر `runtime: node` (`buildCommand: npm ci && npm run build`)
بلا `.git` في خطوة البناء (يستخرج ملفات الـcommit فقط). فكان `resolveGitCommit` يفشل،
ويُكتب `source-commit.txt` فارغاً، فتظهر الحزمة كاملة (`complete:true`) لكن
`bundle.commit=null` و`boundToCommit=false` و`commitBinding=bundle_commit_missing` —
أي أن `SOURCE_INCOMPLETE` مُغلق فعلاً لكن الربط بالـcommit غير محقّق في الإنتاج.

**الإصلاح (محدود بـ`tools/dr/source-bundle.mjs` فقط):** دالة `resolveBuildCommit` بترتيب
أسبقية صريح **بلا أي تخمين**: `options.commit` (مُمرَّر صراحةً) ← **`RENDER_GIT_COMMIT`**
(القيمة التي توفّرها Render زمن البناء) ← `git rev-parse HEAD` ← وإلا `null`. القيمة
تُقبل فقط بصيغة sha 40-محرفاً؛ أي قيمة غير صالحة **تُرفض** ولا تُخترع. و`buildTrustedSourceBundle`
صار يقبل `options.env`. `SOURCE_INCOMPLETE` وCURRENT والنسخ التاريخية وGoogle Drive/OAuth
والمفاتيح لم تُمسّ. CLI (`node tools/dr/source-bundle.mjs`) يقرأ `process.env` تلقائياً.

اختبارات: `engine/tests/dr/dr.source.bundle.test.ts` صار **54 فحصاً** (مجموعتا 7/8:
`RENDER_GIT_COMMIT` موجود يُسجَّل حرفياً، غائب ⇒ `null` بلا اختراع، صيغة غير صالحة تُرفض،
الأسبقية، وبيئة شبيهة بـRender بلا `.git` ⇒ حزمة كاملة ومربوطة `commit_matches`).
فحوص final-audit الجديدة `dr-source-bundle-render-commit-*` (954 إجمالاً).

**النتيجة الإنتاجية بعد نشر ذلك الإصلاح (مُصحَّحة أدناه):** تبيّن أن
`bundle.commit` بقي `null` فعلاً (`commitBinding=bundle_commit_missing`) لأن
`RENDER_GIT_COMMIT` غير متاح زمن البناء — التفصيل والإصلاح النهائي في القسم التالي.

**لا تغيير في:** rp-002/rp-003، `DR_RECOVERY_VAULT_KEY`، أي مفتاح/OAuth/Drive، Gemini،
سوشيال المنصات. لم تُنشأ rp-004.

### تصحيح حاسم: Render لا يوفّر `RENDER_*` زمن البناء لهذه الخدمة (2026-10-01)
الافتراض السابق بأن `RENDER_GIT_COMMIT` متاح زمن البناء **خطأ مُثبت تجريبياً**. أُضيف
تشخيص بلا سرّ إلى بيان الحزمة (`buildEnv`: وجود/طول `RENDER_GIT_COMMIT`، `RENDER`،
`RENDER_GIT_BRANCH`، وأسماء متغيّرات `RENDER_*` فقط — بلا أي قيمة سرّية) ونُشر فعلياً.
النتيجة على الإنتاج: `renderVarNames: []`, `renderGitCommitPresent: false`,
`renderPresent: false` — أي **لا وجود لأي متغيّر `RENDER_*` زمن البناء** لهذه الخدمة
(خدمة أُنشئت قبل تاريخ القطع المذكور في وثائق Render: «At build time … created before
the cutoff date, this value is empty»). في الوقت نفسه `RENDER_GIT_COMMIT` **موجود وقت
التشغيل** ويساوي الـcommit المنشور بالضبط (`/api/dr/health.changeTrigger.lastCommit` =
sha كامل). لذلك `git` زمن البناء لا يساعد (لا `.git`)، و`RENDER_GIT_COMMIT` زمن البناء
غائب — فلا يمكن للحزمة أن تحمل commit من البناء إطلاقاً.

**الإصلاح النهائي (الربط وقت التشغيل):** `bindBundleCommit` يربط الحزمة التي **بلا** commit
زمن البناء بـ`RENDER_GIT_COMMIT` المنشور وقت التشغيل (`commitBinding: 'runtime_commit_matches'`)،
لأن `dist/dr-source` يُنتَج في **نفس** نشر هذه العملية. لا اختراع: القيمة من البيئة،
وتُقبل فقط بصيغة sha 40-محرفاً؛ غائبة/فسادة ⇒ `bound:null` بلا تخمين. صراحةً:
- حزمة تحمل commit زمن البناء ⇒ مقارنة صريحة (`commit_matches` / `commit_mismatch:...`).
- حزمة بلا commit + `RENDER_GIT_COMMIT` صالح وقت التشغيل ⇒ `runtime_commit_matches` (مرتبطة).
- لا بيئة ⇒ `no_declared_commit` (`bound:null`).

`/api/dr/health` يعرض الآن: `bundle.commit` (الفاعل)، `bundle.buildCommit` (زمن البناء أو
null)، `bundle.resolvedCommit`، `bundle.boundVia`، و`bundle.buildEnv`. اختبارات:
`dr.source.bundle.test.ts` = **60 فحصاً** (مجموعة 5ب للربط وقت التشغيل + التشخيص).
final-audit = **961** (`dr-runtime-commit-*`، `dr-source-bundle-build-env-*`).

**الدرس العام:** لا تفترض توفّر متغيّر بيئة زمن البناء من الوثائق؛ أثبته بتشخيص بلا سرّ
من داخل خطوة البناء نفسها. وفي بيئة لا يوفّر المزوّد فيها الـcommit زمن البناء، الربط
بالـcommit المنشور وقت التشغيل صادق لأن الحزمة تُبنى في نفس النشر.


## النسخة الاحتياطية الكاملة التلقائية كل 6 ساعات (2026-10-01)

تحويل إنشاء Recovery Point الكامل من عملية يدوية إلى عملية تلقائية كل **6 ساعات**،
مع بقاء النسخ اليدوي يعمل، وبلا أي مساس بالمفاتيح/OAuth/النسخ القائمة.

**المسار الرسمي الواحد:** `runFullBackup(trigger)` في `engine/dr/routes.ts` هو الوحيد
الذي ينفّذ النسخة الكاملة (source bundle → فحص الأسرار الصارم → DB مشفّرة AES-256-GCM
→ secrets.enc → مرآة CURRENT → خزنة المفاتيح KEY-VAULT → رفع Drive → تحقق فعلي → نقطة
استعادة). كلٌّ من `POST /api/dr/backup` (اليدوي) والدورة التلقائية يستدعيان **نفس**
الدالة — لا مسار نسخ موازٍ إطلاقاً، فحُذف تكرار الجسم القديم ونُقل كما هو حرفياً.

**الوحدة `engine/dr/autoBackup.ts` (منطق صافٍ قابل للاختبار، بلا شبكة/ساعة حقيقية):**
- `AUTO_BACKUP_DEFAULT_INTERVAL_MS = 6h`، وحدّان آمنان [1 دقيقة .. 24 ساعة].
- `resolveAutoBackupIntervalMs(env)` يقرأ `DR_AUTO_BACKUP_INTERVAL_MS` ويرفض أي قيمة
  غائبة/غير رقمية/خارج الحدود => 6 ساعات (لا إيقاع صفري/سالب).
- `isAutoBackupDue(lastRunAtMs, nowMs, intervalMs)` — لا تشغيل سابق ⇒ مستحق.
- `parseLastRunAtMs` / `nextAutoBackupAtMs` / `buildAutoBackupStatus` (حالة صادقة بلا سرّ).

**الجدولة في الخادم (لا تعتمد على المتصفح):** مؤقّت داخلي `setInterval` يُبدأ بعد
`app.listen` عبر `(app as any).drAutoBackup.start()` (`.unref()`)، + فحص إقلاع واحد بعد
دقيقتين. الحالة `driveAutoBackup` تُحفظ وتُسترجع عبر محوّل الحالة (`buildControlState`/
`applyControlSnapshot` في `server.ts`) فتصمد بعد restart/deploy/cold start.

**كيف تمنع التكرار عند إعادة التشغيل:** القرار مبني على الزمن المنقضي منذ `lastRunAt`
المحفوظ، لا على وجود العملية. فعند الإقلاع، إن لم يحل الموعد تُتخطّى الدورة (`not_due`)
بلا نسخة جديدة؛ وإن حلّ أثناء التوقّف تُنشأ نسخة واحدة فقط.

**كيف تمنع التشغيل المتوازي:** نفس قفل `backupRunning` (المشترك مع النسخة اليدوية
والمزامنة وخزنة المفاتيح) + `autoBackupInFlight`. أي نسخة قيد التنفيذ تُتخطّى الدورة
بأمان (`already_running`) بلا بدء عمل ثانٍ، ويُسجَّل التخطّي (`skippedCount`).

**لا فشل يُعلن نجاحاً:** `recordAutoBackupRun` يضع `lastError` عند `failed`، و
`lastRecoveryPointId` فقط عند `backed_up`. المصدر الناقص ⇒ `SOURCE_INCOMPLETE` (409)
بلا نقطة. لا حذف تلقائي للنسخ القديمة (لا منطق حذف إطلاقاً في هذه المرحلة).

**المراقبة:** `/api/dr/health.dr.autoBackup` يعرض (`enabled`, `intervalMinutes=360`,
`lastRunAt`, `lastRunResult`, `lastTrigger`, `lastRecoveryPointId`, `nextRunAt`, `due`,
`skippedCount`, `lastSkippedReason`) بلا أي سرّ. ومسار owner `POST /api/dr/auto-backup/run`
يشغّل دورة الآن (احتراماً للموعد/القفل).

**اختبار `engine/tests/dr/dr.autoBackup.test.ts` (`npm run test:dr-autobackup`، 70 فحصاً):**
الإيقاع والحدود، قرار الاستحقاق، دورة تنتج نقطة كاملة (DB مشفّرة + أسرار + خزنة بـrecords)،
منع التكرار قبل الموعد، إعادة التشغيل بلا تكرار، نسخة قيد التنفيذ تُتخطّى، منع التوازي
(القفل المشترك)، الفشل يُسجَّل فشلاً بلا نقطة، المصدر الناقص، عدم حذف النقاط، وhealth
بلا سرّ. فحوص final-audit: `dr-auto-backup-*` (972 إجمالاً).

**لا تغيير في:** DR_RECOVERY_VAULT_KEY / DR_RECOVERY_MASTER_KEY / DRIVE_DB_BACKUP_KEY /
DRIVE_TOKEN_ENCRYPTION_KEY، ولا OAuth الخاص بـDrive، ولا rp-002/rp-003/rp-004، ولا
YouTube/TikTok/Instagram/Facebook/Telegram، ولا Gemini، ولا المزامنة الحالية. لم تُنشأ
rp-005 في هذه المهمة (الإنتاج لم يُلمس؛ التوقف قبل push/merge/deploy بطلب المالك).

## الاحتفاظ بنقاط الاستعادة (3 مكتملة) — 2026-10-01

`tools/dr/retention.mjs` (منطق صافٍ قابل للاختبار، بلا شبكة): `planRetention`,
`pruneCompletedRestorePoints`, `resolveKeep` (افتراضياً 3، 1..50)، `resolveProtectedIds`
(افتراضياً `rp-002,rp-003,rp-004`)، `retentionEnabled` (`DR_AUTO_RETENTION=false` يُعطّل).

**قواعد مُختبرة:** لا حذف قبل اكتمال النقطة الجديدة والتحقق منها؛ التقليم يقع في
`runFullBackup` **بعد** `backed_up`/`no_change` فقط؛ لا تُحذف النقطة الأحدث، ولا نقطة ناقصة،
ولا نقطة محميّة (`rp-002/003/004`). فشل الحذف لا يُسقط النسخة (يُعاد كـ`pending`).
مسارات owner: `GET /api/dr/retention/status` و`POST /api/dr/retention/prune`.

## الاستعادة المستقلة — واجهة منفصلة عن المشروع (Task B) — 2026-10-01

عند انهيار المشروع بالكامل (Render متوقف، `dist` مفقود، لا جلسة مالك) لا يبقى زر داخل
التطبيق. لذلك أُضيف **مسار استعادة مستقل** لا يستورد خادم الغرابي ولا كود المشروع المترجم:

- `tools/dr/standalone-recovery.mjs`: `listRecoveryPoints` (نقاط + تحقق فعلي)،
  `openKeyVault` (فكّ خزنة الطوارئ من `HEAD.json` مع تحقق بصمات السجلات)،
  `runStandaloneRestore` (اختيار نقطة → فتح خزنة → فكّ أسرار → فكّ قاعدة → استخراج مصدر
  → كتابته → قاعدة هدف → تقرير صادق بمراحل ومشاكل)، `inspectRecoveryReadiness`,
  `inspectTargetEnvironment`. **لا تُعدَّل النقاط** (قراءة فقط)، وتُرفض قاعدة الإنتاج.
- `tools/dr/recovery-console.mjs`: واجهة CLI (`--list`/`--verify`/`--restore --target`).
- `tools/dr/recovery-console-ui.mjs`: **واجهة ويب مستقلة** (`node tools/dr/recovery-console-ui.mjs`
  ثم `http://127.0.0.1:4599`): عرض النقاط، إدخال `DR_RECOVERY_VAULT_KEY`، بدء الاستعادة.
  تستمع على `127.0.0.1` فقط، لا تسجّل المفتاح، ولا تعتمد على خادم الغرابي.
- مسارات داخل اللوحة (owner): `GET /api/dr/standalone/points` و`POST /api/dr/standalone/restore`
  (تأكيد صريح `confirm:true`، مفتاح الخزنة في الجسم POST فلا يُسجَّل).
- وثائق `RECOVERY/` (START-HERE + RECOVERY-GUIDE) تشرح الواجهة المستقلة صراحةً.

اختبار `engine/tests/dr/dr.standalone.test.ts` (`npm run test:dr-standalone`، **72 فحصاً**):
سياسة الاحتفاظ، الاستعادة الكاملة عبر Drive وهمي، فشل المفتاح، نقطة تالفة، أسرار/قاعدة
تالفة، رفض قاعدة الإنتاج، بيئة هدف غير متاحة، محاكاة فقدان المشروع بالكامل، وواجهة الويب
المستقلة. فحوص final-audit: `dr-retention-*` و`dr-standalone-*` (985 إجمالاً).

**لا تغيير في:** أي سرّ/مفتاح، ولا OAuth، ولا rp-002/rp-003/rp-004 (محميّة من التقليم)،
ولا المنصّات، ولا Gemini.

## مركز استعادة الغرابي AI — خدمة مستقلة + إغلاق منظومة DR (الدفعة النهائية، 2026-10-01)

الدفعة الأخيرة في موضوع النسخ الاحتياطي والاستعادة. أُضيف **مركز استعادة الغرابي AI**
كخدمة مستقلة تماماً عن تطبيق الغرابي الرئيسي، فتبقى متاحة ولو توقّف Render/التطبيق/جلسته.

- `tools/dr/recovery-center.mjs`: **خدمة ويب مستقلة** (`createRecoveryCenterServer`) بلا أي
  استيراد لـ`server.ts`/`dist`/git/GitHub. واجهة عربية: حالة Google Drive + نقاط الاستعادة
  (رقم/تاريخ/التزام/ملفات/بصمة/DB/أسرار/خزنة/تحقق/قابلية استعادة) + حقل مفتاح الخزنة المخفي
  + «التحقق من النسخة» (قراءة فقط) + «بدء الاستعادة» + حالات صادقة + «إعداد بيئة الاستعادة».
  - مسارات: `GET /api/health` (standalone + `vaultKeyInEnv:false`)، `GET /api/points`،
    `POST /api/verify` (قراءة فقط)، `POST /api/restore` (تأكيد `confirm:true`).
  - `RECOVERY_HONEST_STATES` (8 حالات): تم التحقق/فكّ الخزنة/استعادة المصدر/قاعدة البيانات/
    الأسرار/تجهيز البيئة + **service_started/service_verified دائماً false** (خطوة خارجية،
    لا ادّعاء آلي). `honestStatesFromReport` يترجم التقرير بلا ادّعاء.
  - مفتاح `DR_RECOVERY_VAULT_KEY` يُمرَّر في **جسم POST فقط**، لا يُحفظ/يُسجَّل/يُعاد.
  - `parseTargetEnv` لخطوة «إعداد بيئة الاستعادة» المنفصلة (أسماء فقط في التقرير).
- `dr-recovery-center/`: **حزمة نشر مستقلة** (`package.json`, `render.yaml` بخدمة منفصلة
  `gharabi-recovery-center` `rootDir: dr-recovery-center`, `sync-lib.mjs`, `start.sh`,
  `start.cmd`, `lib/` نسخة من وحدات `tools/dr/` الضرورية). **لا يضبط مفتاح الخزنة إطلاقاً.**
- `recovery-instructions.md` و`recovery-information.md`: تعليمات الاختصار (هاتف/كمبيوتر)
  باسم **«استعادة الغرابي AI»** بلا أي سرّ، والعنوان المستقل، وحدود الأتمتة الصادقة.
- اختبار `engine/tests/dr/dr.recovery.center.test.ts` (`npm run test:dr-recovery-center`،
  **25 فحصاً**): استقلال المركز (لا server/dist/git/GitHub)، **فقدان Render الرئيسي + فقدان
  GitHub** مع بقاء القراءة والاستعادة، عدم كشف المفتاح، عدم تغيّر النقطة الأصلية، وعدم
  ادّعاء تشغيل/تحقق الخدمة.
- `dr.standalone.test.ts` صار **94 فحصاً** (مجموعة I لمركز الاستعادة على خادم حقيقي +
  تكافؤ نسخة `dr-recovery-center/lib`).
- الاحتفاظ (المرحلة 14) مطبَّق مسبقاً: 3 نقاط مكتملة، حذف الأقدم فقط **بعد** نجاح الجديدة
  والتحقق منها، ولا حذف المحميّ/الناقص/الأحدث. النسخ كل 6 ساعات يعمل على الخادم بلا متصفح
  عبر `runFullBackup(trigger)` الواحد. لا تغيير مطلوب في OAuth (`redirect_uri_mismatch`
  خارج نطاق الكود: العنوان مسجَّل في عميل «AI-Gharabi AI — Google Drive Backup»).

**لا تغيير في:** أي سرّ/مفتاح، ولا OAuth، ولا YouTube/Facebook/Instagram/TikTok/Telegram،
ولا Gemini، ولا rp-002/rp-003/rp-004، ولا PostgreSQL. فحوص final-audit الجديدة
`recovery-center-*` (1003 إجمالاً).

## إصلاح جذر `no_refresh_token` في مركز الاستعادة — رمز التجديد المشفّر من قاعدة الحالة (2026-10-01)

**الجذر المُثبت:** مركز الاستعادة `gharabi-recovery-center` خدمة **مستقلة**، وكان يبني عميل
Drive من `env.DRIVE_OAUTH_REFRESH_TOKEN` وحده. لمّا لم يكن هذا المتغيّر مضبوطاً في بيئته،
كان كل نداء يفشل بـ`no_refresh_token` رغم أن `driveConfigured:true` (لوجود Client ID/Secret).
في الوقت نفسه يخزّن تطبيق الغرابي رمز التجديد **مشفّراً** في جدول الحالة المشترك
(`gharabi_state`، الصف `control`، الحقل `driveRefreshToken`).

**الإصلاح (بلا نقل أي سرّ نصي، بلا سرّ جديد، بلا مطالبة المالك بأي قيمة):**
- `tools/dr/token-source.mjs` (**مصدر واحد**): `loadRefreshTokenFromDatabase` يقرأ الصف
  المشفّر من Postgres ويفكّه بـ`decryptDriveSecret` (مفتاح `DRIVE_TOKEN_ENCRYPTION_KEY`
  نفسه)، و`resolveRefreshTokenSource` يحسم الترتيب: صريح → مشفّر مُمرَّر → بيئة نصية
  (توافق خلفي) → قاعدة الحالة المشفّرة. أكواد الفشل صريحة: `state_db_not_configured` /
  `refresh_token_not_found` / `refresh_token_undecryptable` / `state_db_error` /
  `token_key_missing` / `pg_not_installed`. `inspectRefreshTokenSource` فحص قراءة-فقط بلا سرّ.
- متغيّر جديد `DR_STATE_DATABASE_URL` (بديل قديم `DR_RECOVERY_STATE_DATABASE_URL`) لاتصال
  **قراءة فقط** بجدول الحالة؛ لا يُقرأ `DATABASE_URL` الإنتاجي في هذا المسار إطلاقاً.
- `standalone-recovery.mjs`: `inspectRecoveryReadiness` و`buildRecoveryClient` صارا `async`،
  ويعيدان مصدر الرمز (`provided`/`provided_encrypted`/`env_plaintext`/`state_database`) أو
  كوداً صريحاً عند الفشل (`buildRecoveryClient` يعيد `{ok:false, code}` بدل client).
- `recovery-center.mjs`/`recovery-console-ui.mjs`/`recovery-console.mjs`: كلها تنتظر الدوال،
  وصحة المركز تعرض `drive.refreshTokenAvailable`/`refreshTokenSource`/`refreshTokenCode`/
  `stateDatabaseConfigured` — بلا أي قيمة سرّية. `engine/dr/routes.ts` يمرّر الرمز المشفّر
  المحفوظ لـ`inspectRecoveryReadiness` في `/api/dr/standalone/points`.
- حزمة `dr-recovery-center`: أُضيفت `pg`، وأُضيف `token-source.mjs` إلى `sync-lib.mjs`
  (12 وحدة)، و`render.yaml`/`.env.example`/`recovery-information.md` توثّق `DR_STATE_DATABASE_URL`
  وتُصرّح بأن `DRIVE_OAUTH_REFRESH_TOKEN` **توافق خلفي فقط** وأنه لا يُنقل رمز نصي.

اختبارات: `engine/tests/dr/dr.token.source.test.ts` (`npm run test:dr-token-source`، **34 فحصاً**:
ترتيب المصادر، الفكّ من قاعدة الحالة، أكواد الفشل، مركز يقرأ نقاطاً حقيقية عبر رمز القاعدة
المشفّر، وعدم تسريب أي سرّ). فحوص final-audit الجديدة `token-source-*` (**1014 إجمالاً**).

**إجراء المالك الوحيد (بلا سرّ):** في Render → خدمة `gharabi-recovery-center` → Environment:
أضف `DR_STATE_DATABASE_URL` بقيمة اتصال قاعدة Neon **نفسها** المستخدمة في التطبيق الرئيسي
(`DATABASE_URL`)، وتأكد من وجود `DRIVE_TOKEN_ENCRYPTION_KEY` (نفس مفتاح التطبيق). لا حاجة
لوضع `DRIVE_OAUTH_REFRESH_TOKEN` إطلاقاً. بعد النشر تظهر في `/api/health`
`drive.refreshTokenSource = state_database` وتُقرأ نقاط الاستعادة فعلياً.

**لا تغيير في:** أي سرّ/مفتاح قائم، ولا OAuth/scopes، ولا YouTube/Facebook/Instagram/TikTok/
Telegram، ولا Gemini، ولا rp-002/rp-003/rp-004، ولا PostgreSQL الإنتاجي (قراءة الرمز فقط).

## مركز الاستعادة تطبيق قابل للتثبيت (PWA: جوال + سطح مكتب) — 2026-10-02

تحويل مركز الاستعادة المستقل القائم (`gharabi-recovery-center`) إلى **تطبيق واحد قابل
للتثبيت** من نفس الخدمة المركزية `https://gharabi-recovery-center.onrender.com` — بلا
خادم ثانٍ ولا قاعدة ثانية ولا Electron/Tauri. لا تغيير في المصادقة/الجلسات/التشفير/OAuth/
الخزنة/النسخ/الاستعادة.

**وحدة واحدة جديدة `tools/dr/recoveryPwa.mjs` (منطق صافٍ + أصول، بلا أسرار):**
- `buildManifest()`/`manifestJson()`: بيان `display=standalone`, `start_url=/`, `scope=/`,
  `theme_color/background_color=#0b1220`, `lang=ar dir=rtl`, اسم عربي كامل + قصير، وأيقونات
  192/512 (any + maskable).
- **مُرمّز PNG داخلي** (`encodePng`) — بلا أي مكتبة خارجية. `renderIconRgba(size)` يرسم
  أيقونة الهوية: درع (حماية) + صليب (استعادة/طوارئ) أخضر زمردي على خلفية داكنة، **معتمة
  تماماً** (آمنة للـmaskable)، بsupersampling للتلطيف. `iconPng(size)` مُخزَّن بالذاكرة.
- `servePwaAsset(path)` يخدم `/manifest.webmanifest` (`application/manifest+json`) +
  `/service-worker.js` (`no-cache`) + 5 أيقونات (192/512/maskable-192/maskable-512/apple-180).
- `injectPwaIntoHtml(html)` يحقن وسوم `<head>` (manifest/theme-color/icons/apple) + سكربت
  تسجيل الـSW قبل `</body>` — **idempotent**.
- **Service Worker تمرير شفّاف بلا كاش إطلاقاً**: `install`/`activate` فقط، **بلا
  `respondWith`** وبلا `caches.*`؛ لا يتدخّل في `/api/*` ولا في أي طلب غير GET. وجوده يجعل
  التطبيق قابلاً للتثبيت مع بقاء العمليات الحسّاسة online-first بلا تخزين أي استجابة مصادقة/
  رمز/خزنة/نسخة.

**الربط (بلا تغيير أي منطق استعادة):** `tools/dr/recovery-center.mjs` و`recovery-console-ui.mjs`
يستوردان الوحدة، يلفّان `page()` بـ`injectPwaIntoHtml`، ويخدمان الأصول عبر `servePwaAsset`
في فرع GET قبل `/api/health`. `sync-lib.mjs` صار يزامن **13 وحدة** (أُضيف `recoveryPwa.mjs`).

**تحسينات واجهة حقيقية للتثبيت (فقط ما يلزم):** `viewport-fit=cover` + `env(safe-area-inset-*)`
للحواف (notch) + `min-height:44px` لأزرار اللمس + `font-size:16px` للحقول (منع تكبير iOS
التلقائي) + `@media(max-width:520px)` للجوال. لم يُعد التصميم من الصفر.

**اختبار `engine/tests/dr/dr.pwa.test.ts`** (`npm run test:dr-pwa`، **74 فحصاً**، مضاف
لـ`test:dr`): صحة البيان، أبعاد/نوع PNG الفعلية لكل أيقونة، عمّية الأيقونة (maskable)،
الـSW بلا كاش وبلا `respondWith` وبلا تدخّل API، الحقن idempotent، خادم حقيقي يخدم كل أصل
200 بنوعه، `no-store` على `/api/*`، عدم وجود أي سرّ في أي أصل، وتطابق نسخة `lib` بلا انحراف.
فحوص final-audit الجديدة `pwa-*` (**1026 إجمالاً**).

**إجراء المالك (بلا سرّ):** على Render `gharabi-recovery-center` النشر تلقائي (`autoDeploy:
true`, `branch: main`) فيستلم هذا الإصلاح بمجرد الدفع إلى main. للتثبيت: أندرويد Chrome →
«تثبيت التطبيق/إضافة للشاشة الرئيسية»؛ سطح المكتب Chrome/Edge → أيقونة التثبيت في شريط
العنوان. لا حاجة لأي متغيّر بيئة جديد ولا تغيير أي إعداد.

## جذر بقاء `no_refresh_token` في الإنتاج — الخدمة المستقلة لم تستلم الإصلاح (2026-10-02)

**التشخيص الإنتاجي (لا من الكود فقط):** `https://gharabi-recovery-center.onrender.com`
كانت تُرجع في `/api/health` الشكل **ما قبل الإصلاح** (بلا كتلة `drive`)، و`/api/points`
و`POST /api/verify` تردّان **HTTP 500** بـ`{"ok":false,"code":"no_refresh_token"}`.
بالمقارنة مع كل نسخ `recovery-center.mjs` في المستودع (blobs: `870a327` قبل الإصلاح،
`f62d59e` بعده) تبيّن أن **النسخة العاملة هي `a3a27e1`** (قبل إصلاح رمز التجديد من قاعدة
الحالة)، وأن إصلاح `e8cbb36` المدموج إلى `main` **لم يُبنَ ولم يُنشر** على هذه الخدمة.
السبب: `dr-recovery-center/render.yaml` كان يحمل `autoDeploy: false` بلا `branch`، فبقيت
الخدمة على آخر نشر يدوي (زمن إنشائها) ولم تستلم أي إصلاح مدموج — بينما تطبيق الغرابي
الرئيسي يستخدم `autoDeploy: true` فاستلم كل الإصلاحات (`/api/health` يُظهر `7d6ee86`).

**إصلاح الرؤية (يمنع تكرار «إصلاح منشور لكن غير عامل»):**
- `dr-recovery-center/render.yaml`: `autoDeploy: true` + `branch: main` — فتستلم الخدمة
  المستقلة كل إصلاح مدموج، وتتوقف الحاجة لأي نشر يدوي.
- `RECOVERY_CENTER_BUILD` بصمة بناء **غير سرّية** تُعلن في `/api/health.build`، فيمكن إثبات
  أي نسخة تعمل فعلاً من الخارج بلا تخمين (كان هذا بالضبط ما يخفي أن الإصلاح لم يُنشر).
- `/api/points`: فشل قراءة Drive يُعاد الآن `{ok:false, reason:<code>}` بحالة 200 مع كتلة
  الجاهزية، بدل السقوط إلى 500 عام يُخفي الكود الحقيقي.
- فحوص final-audit: `recovery-center-build-marker`، `recovery-center-autodeploy`،
  `recovery-center-points-explicit-failure` (1017 إجمالاً)، وفحص بصمة البناء في
  `dr.token.source.test.ts` (35 فحصاً).

**ما أُثبت محلياً على قاعدة Postgres حقيقية (embedded) وDrive وهمي:** الصف
`gharabi_state.control.driveRefreshToken` المشفّر يُقرأ ويُفكّ بمفتاح `DRIVE_TOKEN_ENCRYPTION_KEY`
ويعيد `source=state_database`، والرمز المطابق تماماً للمخزَّن؛ ومفتاح خاطئ ⇒
`refresh_token_undecryptable`؛ وغياب الصف ⇒ `refresh_token_not_found`؛ ولا يُطبع أي سرّ.
أي أن كود الإصلاح صحيح تماماً، والعائق الوحيد كان **النشر**.

**لا تغيير في:** أي سرّ/مفتاح، ولا OAuth/scopes، ولا YouTube/Facebook/Instagram/TikTok/
Telegram، ولا Gemini، ولا rp-002/rp-003/rp-004، ولا PostgreSQL الإنتاجي (قراءة الرمز فقط).

## إزالة وحدات المبيعات/النمو/التجاري/الرقمي — تصحيح النطاق (2026-10-04)

وحدات `engine/brain/{sales,growth,commercial,digital}/` و`knowledge/catalog.ts`
و`market/{demandSignals,opportunityEngine}.ts` وواجهاتها (`CommercialBrainView`/
`GrowthBrainView`/`SalesDashboardView`/`UnifiedGrowthBrainView`) ومساراتها
(`/api/agent/brain/sales/*` و`/growth/*` و`/commercial/*`) واختباراتها **حُذفت** في
`cc6e86f` لأنها **خارج نطاق المشروع المعلن** (سوشيال + AI + تسويق، وليست وحدة ERP/مبيعات).

الفجوة التي أُغلقت: ظلّت هذه الدفعات (1–4/4 وما قبلها) موثّقة في AGENTS.md وتشير إلى
وحدات ومسارات **غير موجودة**، فيوهم الدليل بأن العقل التجاري/الرقمي/الموحّد جزء من
النظام القائم. لا يعمل أي منها فعلاً، ولا استيراد لها في `server.ts`، وفحوص final-audit
الخاصة بها (`sales-*`/`growth-*`/`digital-sales-*`/`commercial-*`) حُذفت معها.

الوحدات التجارية الوحيدة الباقية والموصولة فعلاً هي الوحدات **الخالصة** المستخدمة في
الإدراك/الفريق: `engine/brain/knowledge/truth.ts` و`engine/brain/market/commercialRelevance.ts`
و`engine/brain/audience/*` (تُستخدم من `cognition`/`team`). أما ما حُذف فليس جزءاً من النظام.


## Batch 5 — وقت تشغيل العقل 24/7 + ذاكرة دائمة (2026-10-02)

تحويل العقل المركزي من طبقة تُقرأ عند الطلب إلى **مدير يعمل 24/7 داخل خدمة Render**
بلا أي اعتماد على المتصفح: دورة داخلية تحلّل الواقع الحقيقي، تُنتج أحداث تعلّم، وتحفظ
ذاكرة دائمة تصمد بعد restart/cold start. **لا نظام ثانٍ**: الدورة تُعيد استخدام
`buildRuntimeBrain` ومنطق الذاكرة القائم ومسار الحفظ القائم حرفياً.

### الوحدة `engine/brain/brainRuntime.ts` (منطق خالص قابل للاختبار، بلا شبكة/أسرار/ساعة حقيقية)
- `BRAIN_CYCLE_STATUSES` = `SUCCESS` / `NO_NEW_DATA` / `FAILED` / `SKIPPED_LOCKED` /
  `SKIPPED_DISABLED` / `SKIPPED_RUNNING`، و`BRAIN_CYCLE_STATUS_LABELS_AR` (بلا `as any`).
- الإيقاع بحدود آمنة: `BRAIN_RUNTIME_DEFAULT_INTERVAL_MS` (6 ساعات) و
  `BRAIN_RUNTIME_MIN_INTERVAL_MS` (5 دقائق) و`BRAIN_RUNTIME_MAX_INTERVAL_MS` (24 ساعة)،
  و`resolveBrainIntervalMs(env)` يرفض أي قيمة غائبة/غير رقمية/خارج الحدود.
- `isBrainRuntimeDue(lastCompletedAt, nowMs, intervalMs)` — لا تشغيل سابق ⇒ مستحق؛ وغياب
  `now` لا يُخترع (يُعلن `not_due`).
- قفل/lease: `acquireBrainLock` / `releaseBrainLock` / `isBrainLockStale` / `BRAIN_LOCK_MAX_TTL_MS`
  (10 دقائق) + `staleLockRecoveries`، فلا توازٍ ولا جمود دائم بعد تعطّل عملية.
- `runBrainRuntimeCycle(deps, trigger)` — البوابات: معطّل ⇒ `SKIPPED_DISABLED`، دورة جارية
  ⇒ `SKIPPED_RUNNING`، قفل حيّ لغيري ⇒ `SKIPPED_LOCKED`؛ ثم `build` → `persist` →
  `release`. **لا ادّعاء نجاح**: الحالة من `persistResult.ok` الفعلي، وفشل الحفظ ⇒ `FAILED`
  + `persistenceFailureCount` + `lastError` (بلا سرّ).
- **NO_NEW_DATA الصادقة**: تشمل `records.length === 0` **و** `added === 0` (تكرار كل السجلات)،
  فلا يُعلن SUCCESS بلا ذاكرة جديدة فعلية.
- `sanitizeBrainRuntimeError` يقتصر على اسم/كود الخطأ (بلا نص قد يحمل سرّاً)،
  و`buildBrainRuntimeStatus` يعرض كل العدّادات + `executesExternalActions:false` +
  `geminiUsedOnCycles:false` + `intervalMinutes` + `lastStatusLabelAr` بلا أي سرّ.
- `normalizeBrainRuntimeState` للتوافق الخلفي عند استرجاع الحالة.

### الربط في `server.ts`
- `brainRuntimeState` يُحفظ ويُسترجع عبر محوّل الحالة (`buildControlState` /
  `applyControlSnapshot` → `control.brainRuntime`) فيصمد بعد restart/deploy/cold start.
- `runBrainRuntimeCycleInternal(trigger)` يحقن: `build` = `buildRuntimeBrain` (نفس مدخلات
  العقل الحقيقية) + `dedupeLearningEvents` + `memoryRecordsFromEvents`، و`persist` = مسار
  `persistBrainMemory` القائم. **`persistBrainMemory` يعيد تسلسل الكتابة**، والدورة تنتظر
  الطابور وتحكم على **كتابتها وحدها** (`brainMemoryLastErrorSeq === mySeq`) بلا تأثّر بفشل
  كتابة أخرى — فلا ادّعاء نجاح ولا فشل كاذب.
- `startBrainRuntime()` يُبدأ بعد `app.listen` (`BRAIN_RUNTIME_BOOT_DELAY_MS`) بمؤقّت
  واحد `.unref()`؛ `rescheduleBrainRuntime` يُبطل القديم قبل الجديد. مالك داخلي ثابت
  (`BRAIN_RUNTIME_OWNER`) يعزل قفل الدورة عن قفل أداة العقل.
- مسارات owner: `GET /api/agent/brain/runtime` (حالة) و`POST /api/agent/brain/runtime/run`
  (تشغيل دورة الآن — تحليل/تعلّم/حفظ، **بلا إجراء خارجي وبلا Gemini**).
- `/api/health.brainRuntime` و`/api/readiness.brain.runtime` يعرضان الحالة بلا سرّ.

### الواجهة
`CentralBrainView` (تبويب `central_brain`): بطاقة «وقت تشغيل العقل 24/7» تعرض الحالة
والإيقاع والعدّادات والقفل وآخر خطأ، وزر «تشغيل دورة الآن (تشخيص)» للمالك. تُعرض نتيجة
الخادم الفعلية فقط؛ فشل قراءة وقت التشغيل لا يُسقط بقية اللوحة.

اختبارات: `engine/tests/brain/brain.runtime.cycle.test.ts` (`npm run test:brain-runtime-cycle`،
66 فحصاً وحدة) و`engine/tests/brain/brain.runtime.cycle.server.test.ts`
(`npm run test:brain-runtime-cycle-server`، 30 فحصاً على خادم حقيقي + خادم YouTube وهمي:
دورة بلا بيانات ⇒ NO_NEW_DATA، رد حقيقي عبر المراقب ⇒ حدث تعلّم حقيقي، حفظ الذاكرة، منع
التكرار، الثبات بعد restart فعلي، ولا تسريب أسرار). فحوص final-audit الجديدة `brain-runtime-*`
(**1172 إجمالاً**). `npm run lint` + `build` + `test` + `final-audit` كلها ناجحة.

**لم يُمسّ:** Gemini/firewall، OAuth/الاعتمادات، المصادقة، قاعدة البيانات، DR/الاستعادة،
YouTube (المراقب/الطابور/التفويض)، بقية المنصات، ونموذج الجدولة. لا تغيير في أي سرّ أو مفتاح.
(وحدات المبيعات/النمو/التجاري/الرقمي حُذفت سابقاً في `cc6e86f` — خارج النطاق؛ انظر قسم الإزالة.)

## فريق الوكلاء الداخلي (Agent Council) — Batch 6 (2026-10-02)

تحويل العقل المركزي من وكيل واحد إلى **فريق تفكير تعاوني داخلي** ينسّقه العقل المركزي
على **بيانات حقيقية**، مع الفصل الصريح `FACT ≠ DERIVED ≠ HYPOTHESIS ≠ UNKNOWN ≠ UNAVAILABLE`
و`Analysis ≠ Execution`. الهدف: رفع جودة القرار حول الأنظمة القائمة (سوشيال/AI/تسويق) بلا
نظام ذاكرة ثانٍ وبلا أي تنفيذ خارجي وبلا استهلاك Gemini.

### الوحدات الجديدة (`engine/brain/team/`، منطق خالص قابل للاختبار)
- `truth.ts`: نموذج الصدق — `TeamTruthState` (FACT/DERIVED/HYPOTHESIS/UNKNOWN/UNAVAILABLE)،
  `truthStateForEvidence`، `confidenceForTruth`، `confirmTruthState` (**التأييد لا يرقّي
  الفرضية أبداً**)، `promoteWithIndependentEvidence` (الترقية إلى FACT تحتاج مصدراً مستقلاً
  + عيّنة كافية)، `isActionableTruth` (الحقائق/الاستنتاجات فقط).
- `types.ts`: أنواع الجلسة (`TeamSession`, `TeamAgentOutput`, `TeamConflict`, `TeamDecision`)،
  معرّفات الوكلاء الستة، `TEAM_AGENT_ROLE` (رصد/تحليل/توصية/تحقق/قرار)، `TEAM_SESSION_MAX`.
- `agents.ts`: الوكلاء المتخصّصون (وحدات منطقية حتمية، لا اشتراكات AI خارجية):
  `researchAgent` (يجمع الأدلة الحقيقية فقط)، `analysisAgent` (يشتقّ نمطاً حسابياً + فرضية
  معلنة)، `strategyAgent` (توصية مبنية على أدلة + تحذير قدرة NOT_AVAILABLE)، `criticAgent`
  (يرفض FACT بلا مصدر، يرفض ادّعاء إجراء خارجي، يكشف خلاف المنصة غير المتصلة وتناقض
  دليل/فجوة)، `decisionAgent` (قرار مقترح + ثقة + حدود؛ غير مُتحقَّق إن فشل الناقد).
- `orchestrator.ts`: المنسّق — `decideRequiredAgents`، `teamDedupeKey`، `runTeamSession`
  (فشل وكيل معزول عبر `safe`، حالة `partial`)، `upsertTeamSession` (بلا تكرار)،
  `teamSessionToMemoryRecords` (**يحوّل القرار إلى ذاكرة عبر `toMemoryRecord` القائم فقط**)،
  `summarizeTeamSession`/`summarizeTeamState`.
- `routes.ts`: مسارات الفريق (قراءة/تشخيص)، بحقن تبعيات `authenticateToken`/`requireOwner`.

### الربط في `server.ts`
- `teamSessionState` تُحفظ وتُسترجع عبر محوّل الحالة في مفتاح `teamSessions` (file + Postgres)
  فتصمد بعد restart/cold start. `runTeamSessionNow` يبني السياق من بيانات الإنتاج الحقيقية
  (`brainRuntimeInput` + `platformConnections` + `verifiedFacts`)، يمنع التكرار بمفتاح الحدث،
  ويكتب القرار في **نفس** `persistBrainMemory` — **لا نظام/جدول ثانٍ**.
- **المشغّل الحقيقي:** داخل دورة مراقب YouTube 24/7 (`runYouTubeWatcherCycle`)، كل تعليق جديد
  حقيقي يُنشئ جلسة فريق واحدة (`trigger: youtube_event`, `eventIdentity: comment:<id>`) بلا
  تكرار. أي فشل لا يُسقط دورة المراقبة.
- مسارات owner: `POST /api/agent/team/run` (تشغيل جلسة الآن — قرار مقترح فقط)، و`GET
  /api/agent/team` و`GET /api/agent/team/:teamSessionId` (قراءة محمية).
- `/api/health.agentTeam` و`/api/readiness.brain.agentTeam` يعرضان الملخّص
  (`executesExternalActions: false`, `geminiUsedOnSessions: false`) بلا أي سرّ.

### الواجهة
`src/components/agent/AgentTeamCenter.tsx` (مدمج في `CentralBrainView`): قائمة الجلسات،
تفاصيل كاملة (الأدلة/التحليل/التوصيات/الاعتراضات/الخلافات/القرار/الثقة/حالة الصدق/حالة
الذاكرة)، وزر «تشغيل جلسة فريق الآن» للمالك. تُعرض نتيجة الخادم الفعلية فقط بلا أي ادّعاء.

### القواعد الملزمة (مُختبرة)
- **لا تنفيذ خارجي من الفريق**: القرار مقترح فقط، والتنفيذ يمر ببوابات المشروع القائمة.
- **الفرضية لا تصبح حقيقة بالتكرار**؛ الترقية تحتاج دليلاً مستقلاً.
- **لا اختراع**: لا سعر/قسط/توفر/معرّف مزوّد؛ غير المتاح يُعلن UNAVAILABLE، والناقد يرفض
  الادعاء بلا مصدر.
- **لا استهلاك Gemini** في الجلسات (منطق حتمي)، **ولا ذاكرة ثانية** (نفس Brain Memory).

اختبارات: `engine/tests/brain/team.council.test.ts` (`npm run test:team-council`، 80 فحصاً
وحدة) و`engine/tests/brain/team.council.server.test.ts` (`npm run test:team-council-server`،
44 فحصاً على خادم حقيقي: تصريح، منع تكرار، ثبات بعد restart، ذاكرة العقل، بلا سرّ) و
`engine/tests/brain/team.council.youtube.test.ts` (`npm run test:team-council-youtube`، 25
فحصاً: حدث YouTube حقيقي عبر خادم Google وهمي => جلسة فريق + ثبات بعد restart + منع تكرار).
فحوص final-audit الجديدة `agent-team-*` (**1192 إجمالاً**). `npm run lint` + `build` + `test`
+ `final-audit` كلها ناجحة.

**لم يُمسّ:** وقت تشغيل العقل (Batch 5)، Gemini/firewall، OAuth/الاعتمادات/الأسرار، المصادقة،
قاعدة البيانات، DR/الاستعادة، YouTube (المراقب/الطابور/التفويض)، بقية المنصات، ونموذج الجدولة.
(وحدات المبيعات/النمو/التجاري/الرقمي حُذفت سابقاً في `cc6e86f` — خارج النطاق؛ انظر قسم الإزالة.)

## إغلاق ثغرة مركز الاستعادة: مصادقة المالك إلزامية (2026-10-03)

**الثغرة:** خدمة `gharabi-recovery-center` المستقلة كانت تخدم `/api/points` بلا أي مصادقة،
فيكشف أي زائر بيانات وصفية لنقاط الاستعادة (الالتزامات، عدد الملفات، عدد الأسرار).

**الإصلاح (فرع منفصل، بلا لمس منطق الاستعادة ولا مفتاح الخزنة):**
- `tools/dr/recoveryAuth.mjs` (وحدة منطق صافٍ جديدة، مصدر واحد): `checkRecoveryOwnerAuth`،
  `inspectRecoveryOwnerAuth`، `extractBearerToken`، `isProtectedRecoveryPath`،
  `recoveryOwnerAuthStatus`، و`RECOVERY_CENTER_PROTECTED_PATHS` = `/api/points` · `/api/verify` · `/api/restore`.
- المفتاح مستقل لهذه الخدمة فقط (لا يُعاد استخدام مفتاح الخزنة ولا أي سرّ قائم):
  `RECOVERY_CENTER_OWNER_TOKEN` (أساسي) أو `RECOVERY_CENTER_OWNER_TOKEN_HASH` (SHA-256 hex).
  يُرسَل في ترويسة `Authorization: Bearer` فقط، ومقارنته بزمن ثابت (`timingSafeEqual`).
- **fail-closed:** بلا مفتاح مضبوط تُرد المسارات الحسّاسة 401، ولا يمكن تجاوزها إلا بـ
  `RECOVERY_CENTER_ALLOW_UNAUTHENTICATED=true` (وضع محلي صريح فقط).
- `/api/health` و`/` و`/api/owner-auth` تبقى عامة (بلا أي بيانات وصفية). الصحة تعرض كتلة
  `ownerAuth` منطقية فقط. الواجهة تجمع المفتاح في بطاقة «مصادقة المالك» وتُرسله Bearer
  (يُحفظ في متصفح المالك، لا يُسجَّل على الخادم).
- `dr-recovery-center/render.yaml` و`.env.example` يوثّقان المتغيّرين (sync: false)، والوثائق
  (`README.md`، `recovery-instructions.md`، `recovery-information.md`) محدَّثة. `sync-lib.mjs`
  صار 14 وحدة. بصمة البناء صارت `owner-auth-1`.

**اختبار حي (فعلي على الخدمة نفسها، بلا مصادقة في الاختبار):** بلا ترويسة ⇒ 401
`missing_bearer_token`؛ مفتاح خاطئ ⇒ 401 `invalid_bearer_token`؛ مفتاح صحيح ⇒ 200 ويعمل
كما كان؛ بلا مفتاح مضبوط ⇒ 401 `owner_token_not_configured`؛ `/api/health` و`/` ⇒ 200 عام.

**اختبارات:** `engine/tests/dr/dr.recovery.center.auth.test.ts` (`npm run test:dr-recovery-center-auth`،
52 فحصاً) + تحديث اختبارات المركز القائمة (standalone/token-source/pwa/recovery-center) لتمرير
المفتاح، و16 فحص final-audit جديد (`recovery-center-owner-auth-*`، 1231 إجمالاً).
`npm run lint` + `build` + `test` (0 فشل) + `final-audit` كلها ناجحة.

**إجراء المالك (إلزامي بعد النشر):** في Render → خدمة `gharabi-recovery-center` → Environment
أضف `RECOVERY_CENTER_OWNER_TOKEN` بقيمة عشوائية قوية، ثم أدخلها مرة واحدة في بطاقة «مصادقة
المالك» داخل الواجهة. لا تُكتب في Git ولا تُشارَك.

## إزالة تسريب بيانات العملاء من /api/health و/api/readiness (2026-10-04)

**العطل المُثبت:** النقطتان عامتان بلا مصادقة (لأدوات المراقبة مثل Render)، وكانتا
تُعلنان حقول عملاء حساسة داخل كتلة `youtubeWatcher`: `attentionRequired[]` (أسماء حسابات
ونصوص تعليقات) و`lastReply.replyText` (نص الردود الفعلية للعملاء) — إضافة إلى
`opportunities`/`brief`/`followUp` المشتقة من نص التعليق. لا علاقة لهذه الحقول بفحص صحة
الخادم. عُثر على التسريب فعلياً في `origin/main` بعد أن تقدّم بـcognition/scope cleanup.

**الإصلاح (بلا حذف من النظام):** `watcherStatusBlockPublic()` في `server.ts` — نسخة عامة
آمنة تُستخدم في **الموضعين** (`/api/health` و`/api/readiness`): `watcherActive`,
`cadenceMinutes`, `cadenceMs`, `pollCount`, `lastPollAt`, `nextPollAt`, `consecutiveErrors`,
و`counters` (أرقام إجمالية فقط)، و`lastError` **كرسالة تقنية عامة**. `watcherPublicError`
يقتصر على رمز ASCII (مثل `COMMENTS_FETCH_FAILED`) ويستبدل أي نص حر بـ`connection error`،
فلا يمكن أن يمرّ اسم/نص عربي إلى النقطة العامة.
- **البيانات التفصيلية تبقى للمالك فقط** عبر المسار المحمي بالتصريح
  `GET /api/agent/youtube/watcher` (يعيد `watcherStatusBlock()` الكامل مع
  `attentionRequired`/`lastReply`). لا مسار عام جديد.
- الواجهة `YouTubeOperationsView` تقرأ `attentionRequired` من المسار المحمي نفسه
  (`getYouTubeWatcher`) — لا من الصحة العامة.

**فحص حي على البناء الفعلي (`dist/server.cjs`) بحالة مزروعة تحمل بصمة `LIVE_CANARY_*`:**
`/api/health` و`/api/readiness` بلا مصادقة ⇒ لا اسم/نص تعليق/نص رد ولا مفاتيح
`replyText`/`attentionRequired`/`authorName`/`lastReply`؛ و`/api/agent/youtube/watcher`
للمالك ⇒ يعيد النص والاسم كاملين.

اختبار انحدار: `engine/tests/health.privacy.test.ts` (`npm run test:health-privacy`، 23 فحصاً،
مضاف إلى `npm test`) يزرع حالة عملاء (بصمة canary) ثم يقرأ النقطتين العامتين فعلياً ويثبت
غياب أي تسريب، ويثبت بقاء التفاصيل في المسار المحمي. فحوص final-audit:
`youtube-watcher-health-public-safe`, `youtube-watcher-detail-owner-auth`,
`youtube-watcher-public-error-sanitized`.

## نبضة الإيقاظ المحدودة النطاق (Keep-Alive) — لا 24/7 (2026-10-04)

السبب الجذري للقيد: خطة Render المجانية تمنح **750 ساعة تشغيل شهرياً لكل Workspace
كاملة**، مشتركة بين `al-gharabi-ai` و`gharabi-recovery-center` معاً. نبضة 24/7 تستهلك
~744 ساعة بمفردها وتعرّض كل الخدمات المجانية للتعليق عند تجاوز الحصة — وهذا يخالف
مبدأ «المشروع يبقى مجانياً للأبد» المُقرَّر صراحةً. لذلك النبضة **محصورة بنافذة 18 ساعة
فقط يومياً** ولا يجوز توسيعها لـ24/7.

- الملف: `.github/workflows/keep-alive.yml` (الريبو عام ⇒ دقائق GitHub Actions مجانية
  بلا حدود؛ **لا خدمة خارجية** مثل cron-job.org أو UptimeRobot).
- الجدول: `cron: "*/10 3-20 * * *"` = كل 10 دقائق بين **03:00 و20:59 UTC** فقط
  (= 06:00 → 23:59 بتوقيت بغداد UTC+3). خارج هذا النطاق (21:00–02:59 UTC = منتصف
  الليل حتى 6 صباحاً بغداد) **لا نبضة إطلاقاً**؛ تُترك الخدمة تنام طبيعياً. الهامش
  الطبيعي ~10–15 دقيقة يُبقي الصحو حتى قرب منتصف الليل بالضبط.
- الطلب: `GET https://al-gharabi-ai.onrender.com/api/health` فقط — **لا يستدعي Gemini
  ولا أي منطق ثقيل**، وغرضه الوحيد إبقاء العملية صاحية. الطلب **best-effort**: فشله
  لا يُفشل الـworkflow (قد تكون الخدمة في أول ثانية إيقاظ).
- **مركز التعافي `gharabi-recovery-center` بلا أي نبضة**: يبقى بسلوكه الافتراضي (نادر
  الزيارة، يستهلك ساعات ضئيلة).
- حماية من التعديل الخاطئ: فحص `final-audit` باسم `keep-alive-window-scoped` يفشل
  البناء إذا غاب الملف، أو اختلف أي جدول cron عن `*/10 3-20 * * *`، أو ظهر جدول يغطّي
  كل الساعات (حقل الساعة = `*` أو `0-23`)، أو لم يستهدف الطلب `/api/health`.


## إصلاح خطاف React في PlatformConnectionCenter + حارس وقت التشغيل (2026-10-05)

**العطل المُثبت (لا افتراض):** في `src/components/social/PlatformConnectionCenter.tsx`
كان `useEffect` الخاص بمعالجة عودة OAuth (`oauthReturn`) موضوعاً **داخل** جسم دالة `load`
(async، ممرَّرة إلى `useCallback`)، بدل المستوى الأعلى للمكوّن. وهذا انتهاك لقواعد React
Hooks، و`load` تُستدعى عند كل زيارة للصفحة عبر `useEffect(() => { void load(); }, [load])`،
فيرمي React وقت التشغيل: **«Invalid hook call. Hooks can only be called inside of the body
of a function component»** ويعطّل صفحة «مركز ربط المنصات» (صفحة ربط YouTube).

**السبب الجذري لعدم الالتقاط:** `npm run lint` = `tsc --noEmit` فقط، **لا يوجد ESLint
config** ولا `eslint-plugin-react-hooks`، فهذا النوع لا يُكتشف إلا وقت التشغيل.

**الإصلاح:** نُقل `useEffect` إلى المستوى الأعلى بعد إغلاق `load` مباشرةً، بنفس السلوك
الوظيفي بالضبط (قراءة `oauthReturn`، `showToast`، `clearOauthReturn()`، ثم `void load()`).
فحص `react-hooks/rules-of-hooks` على كامل المستودع (تشغيل مؤقت لـESLint في `/tmp`) = **0
مخالفات**؛ هذه كانت الوحيدة. (8 تحذيرات `exhaustive-deps` فقط، ليست أخطاء.)

**الدليل الحقيقي (متصفح حقيقي، لا افتراض):** اختبار Playwright جديد
`engine/e2e/platform-connection.e2e.spec.ts` (يُشغَّل بـ`npm run test:e2e`) يفتح الصفحة
ويؤكد تصييرها وغياب خطأ الخطافات في الكونسول:
- على الكود المكسور: **يفشل** ويُظهر نص الخطأ الحقيقي «Invalid hook call…».
- على الكود المُصلَح: **يمر** (PAGE_HEADING_VISIBLE=true، HOOK_ERRORS=[]، PAGE_ERRORS=[]).
- إثبات إضافي على **البناء المنشور** (`dist/server.cjs` بعد `npm run build`): تصيير سليم
  بلا أي خطأ React (سجل الكونسول نظيف؛ الـ404 الوحيد هو `/favicon.ico` غير المؤذِ).

**فجوة مصاحبة أُغلقت:** `walkProjectSource` في `tools/dr/source-bundle.mjs` كان يستبعد
`dist/build/coverage/.git` لكن **لا** `test-results`/`playwright-report` (مخرجات Playwright
المُتجاهَلة في Git)، فكان وجودها يجعل بصمة الشجرة في `dr.source.bundle.test.ts` لا تطابق
البيان فيفشل الاختبار. أُضيف المجلدان إلى `NON_SOURCE_DIRS`.

**حرّاس `final-audit` (1302 فحصاً، +5):** `platform-connection-no-hook-in-load` (يفشل على
الكود المكسور التاريخي — مُثبت)، `platform-connection-oauth-effect-top-level`،
`platform-connection-hooks-e2e`، `platform-connection-hooks-e2e-wired`،
`dr-source-walk-excludes-playwright-artifacts`.

**النشر:** دُمج على `main` (merge `3634827`)، ونُشر على Render (autoDeploy) — تأكّد حياً
`deploy.commit=3634827` **وتغيّر بصمة أصول الواجهة** (`index-VnD0bQKQ.js` →
`index-DhwoGX2g.js`)، وهو دليل سلوكي لا يعتمد على الحقل النصي وحده.

**ملاحظة منفصلة (لم تُعالَج — تحتاج قرار المالك):** البناء المنشور على Render يخدم
**React development** (الحزمة تحمل `react.development` وبلا `react.production`، وحجمها
~1.16MB مقابل ~680KB للبناء الإنتاجي المحلي). السبب: `Dockerfile` يضبط
`ENV NODE_ENV=development` في مرحلة البناء (السطر 7)، فـvite يختار فرع development.
الأثر: تحذيرات React الإنتاجية + حجم أكبر + أداء أبطأ. `render.yaml` يقول `runtime: node`
لكن الخدمة مضبوطة فعلياً على Docker (يُثبت بتطابق بصمة المصدر لمجموعة ملفات الصورة).
هذا إعداد نشر لا يمسّه إصلاح الخطافات، ويُترك لقرار المالك.



## تدقيق أمني نهائي — إغلاق عزل ERP المتبقي + حدّ محاولات OTP (2026-10-04)

**فرع `audit/final-security-scope` من `main` (`2f8dfa2`).** تدقيق شامل كـPrincipal/Architect/
Security/QA/Reliability. الأساس سليم (المصادقة/التوقيعات/عدم تسريب /health و/readiness/منع
تجاوز العزل بالترميز والنقاط والشرطة المكرّرة). عولجت فجوتان حقيقيتان:

### 1) عزل نطاق ERP كان ناقصاً (تسريب أسطح legacy)
- **السبب الجذري:** الحارس `legacyErpScopeEnabled()` كان مُسجَّلاً في السطر ~8667 **بعد**
  `/api/catalog/quote` (8205)، فلم يُعزل هذا المسار إطلاقاً، كما أن `LEGACY_ERP_ROUTE_PREFIXES`
  غطّى 6 بادئات فقط. فبقيت أسطح legacy تُرجع **401** (المسار فعّال) بدل **404 SCOPE_DISABLED**:
  `/api/catalog/quote`, `/api/tasks`, `/api/business/overview`, `/api/suppliers`,
  `/api/expenses`, `/api/contracts`, `/api/installments/*`, `/api/executive/overview`.
- **الإصلاح (بلا كسر واجهة ظاهرة):** نُقل الحارس **قبل أول مسار ERP** (`/api/catalog/quote`)
  ووُسّعت البادئات لتشمل الأسطح الثمانية. أُثبت أن كل مساراتها يستهلكها **فقط** مكوّنات
  التبويبات المخفية (`BusinessSuiteView`/`OperationsView`/`ExecutiveCommandView`)، فلم تُمسّ
  تبويبات `sales`/`control` الظاهرة (قرار المؤلف الصريح) ولا `/api/workspace/*` المشتركة.
  المفتاح `GHARABI_ENABLE_LEGACY_ERP_SCOPE=true` يُعيدها كما هي.
  **تصحيح مهم:** `/api/sales` **ليس** Legacy ERP بل ميزة حيّة (تبويب `sales` الظاهر
  يستهلكها عبر `SalesCenterView`)، وقد أُضيف للقائمة خطأً ثم أُزيل. يمنع حارس
  `legacy-erp-excludes-live-sales` عودة إضافته، ويثبت اختبار النطاق أن `/api/sales*`
  لا يُحجب في أي من حالتي المفتاح (401/200 لا 404).
- **اختبار:** `scope.legacy.erp.isolation.test.ts` صار **156 فحصاً** (أُضيفت الأسطح الثمانية
  GET+POST/PATCH/DELETE وphase-on). `final-audit`: `legacy-erp-prefixes-complete`،
  `legacy-erp-guard-before-routes`، `legacy-erp-no-visible-consumer-surface-guarded`.

### 2) `/api/auth/verify-challenge` بلا حدّ محاولات (تخمين OTP)
- **السبب الجذري:** الرمز 6 أرقام بنافذة 10 دقائق، والمقارنة بزمن ثابت لكن **بلا أي حدّ**،
  فالتخمين ممكن عملياً. (بقية مسارات المصادقة محدودة: google 12، request-challenge، preview 10.)
- **الإصلاح:** `allowAuthAttempt` بمفتاح (IP + بريد) وحدّ 10 **قبل** مقارنة الرمز (فلا يمنح
  429 أي إشارة عن صحّة الرمز). اختبار في `security.hardening.test.ts` (`SEC-04b`).
  `final-audit`: `otp-verify-rate-limited`.

### 3) بيانات عملاء YouTube متاحة لأي مستخدم مصادَق (لا للمالك فقط)
- **السبب الجذري:** مسارات بيانات المراقب (`/api/agent/youtube/watcher` + `/brief` +
  `/details` + `/comment/:commentId` + `/audit`) كانت `authenticateToken` فقط، رغم أن
  توثيقها يقول «للمالك فقط». أي مستخدم مسجَّل (بأي دور) كان يقرأ أسماء حسابات ونصوص
  تعليقات ونصوص ردود العملاء عبر `attentionRequired`/`lastReply`.
- **الإصلاح:** صارت كلها `requireOwner` (لا مجرّد مصادقة)، فبيانات عملاء YouTube لا تصل
  إلا للمالك. اختبارات `health.privacy.test.ts` و`watcher.review.integration.test.ts`
  تستخدم جلسة المالك فتظل ناجحة. `final-audit`: `youtube-watcher-detail-owner-auth`
  (مُحدَّث) و`youtube-watcher-data-owner-only` (جديد). والتبويب `youtube_operations` في
  القائمة صار `ownerOnly` مطابقةً للخادم، مع حارس `youtube-watcher-ui-owner-only`.

### نتائج التحقق
`npm run lint` ✅ · `npm run build` ✅ · `npm test` ✅ (EXIT=0، 0 فشل) · `final-audit` ✅
(**1326 فحصاً**). لم يُنفَّذ دفع/دمج/نشر — بانتظار إذن المالك.

### Five-Point Closure (2026-10-05) — إغلاق النقاط الخمس من جذورها
الملاحظات المفتوحة السابقة أُغلقت فعلياً. التفصيل:

**1) توثيق AGENTS.md/النطاق:** أُعيد كتابة قسم «الهوية والنطاق» ليعكس **الواقع الفعلي**
(سوشيال + AI + تسويق)، مع Scope Boundary صريح (داخل/خارج النطاق، العزل، المحذوف، حدود
العقل المركزي، ما لا يُعاد إدخاله). لا وصف مثالي غير مطابق للكود.

**2) تبويبا `sales`/`control` (والأسطح المالية/العملاء):** كانتا «ظاهرتين ومقصودتين»
سابقاً؛ صُحِّحت إلى **خارج النطاق**: أُضيفت `OUT_OF_SCOPE_LIVE_ROUTE_PREFIXES` +
`isOutOfScopeLiveRouteRequest` في `server.ts` تُعزل (404 `SCOPE_DISABLED` افتراضياً،
قبل المصادقة، تطبيع مسار كامل ضد `//api/sales`/`%2f`) بنفس مفتاح `GHARABI_ENABLE_LEGACY_ERP_SCOPE`.
`LEGACY_ERP_TAB_IDS` في `Sidebar` صار يضم `sales` و`control` (مخفيان، NAV_ENABLED=false).
لا مستهلك داخل النطاق لهذه المسارات (فحص `out-of-scope-no-visible-consumer`)، فالعزل
لا يكسر واجهة ظاهرة. فحوص: `out-of-scope-live-routes-isolated`, `sidebar-hides-out-of-scope-tabs`.

**3) `/api/workspace/snapshot` Least-Privilege:** أُضيف `snapshotConnection(platform, isOwner)`
— المالك يرى الهوية الكاملة (`accountName`/`accountId`/`lastSyncAt`/`provider`)؛ أي دور
آخر يرى الحالة التقنية فقط (`platform`/`status`/`connectedAt`/`providerVerified`) بلا هوية
تنظيمية. اختبار `workspace.snapshot.authz.test.ts` (owner يرى، manager/staff/creator/support
لا يرون، 401/403، لا قيمة خام في النص). فحوص: `workspace-snapshot-least-privilege`,
`workspace-snapshot-authz-test`.

**4) توثيق وحدات brain المحذوفة:** `docs/{تحضير-العقل-التجاري,دفعة-1..4-*}.md` حُذفت
فعلياً (كانت تشرح وحدات غير موجودة)، والفحص القديم `brain-scope-removal-docs-flagged`
استُبدل بحارس `brain-scope-removal-docs-purged` + `brain-removed-modules-no-stale-refs`
(يمنع عودة أي مرجع `engine/brain/{sales,digital,growth,commercial}` في أي ملف نصي).
لا مرجع متبقٍ (بحث شامل).

**5) pollCount:** محسوم تقنياً — **مؤشر liveness تقني**، لا تجاري:
- **المصدر:** `watcherState.pollCount` (حالة المراقبة، تُحفظ عبر محوّل الحالة).
- **المعنى:** عدّاد **تراكمي** لعدد **دورات الفحص الناجحة** منذ بدء القياس؛ يزيد بواحد
  فقط في نهاية دورة ناجحة (`runYouTubeWatcherCycle`)، **لا يتضمّن الدورات الفاشلة**
  (مسار الـcatch لا يزيده)، و**لا يُصفَّر** عند restart/deploy (يُسترجع من اللقطة).
- **السلوك:** لا يصلح كمعدّل مباشر (ليس معدّل زمني)؛ للمعدّل استخدم `lastPollAt` +
  `cadenceMs`. يختلف عن `counters` (عدّادات تصنيف التعليقات التجارية للمالك فقط).
- **القرار:** يُعلن في `/api/health` و`/api/readiness` (الكتلة العامة) مع `lastPollAt`
  لأنهما لا يحملان بيانات عملاء ولا عدّادات تجارية — مرقاب حياة للخدمة. الفحوص:
  `pollcount-exposed-as-technical-metric`, `pollcount-semantics-documented`,
  `pollcount-not-forbidden-leak`، واختبار `health.privacy.test.ts` (يُثبت القيمة الفعلية).

### أخطاء منصّة خارجية (EXTERNAL BLOCKER — ليست كوداً)
- نشر TikTok URL-prefix (`Something went wrong`) وربط Meta OAuth: توقفا عند إعدادات
  لوحة المزوّد (App Domains / Redirect URIs / Use Cases / رول الصفحة) لا الكود.

## تصحيح جذر: علم `is_business_login=1` كان يمنع ربط فيسبوك الكلاسيكي (2026-10-05)

**الدليل الحي (بلا تخمين، طلبات GET read-only على `www.facebook.com/v21.0/dialog/oauth`
بوكيل جوال، بلا تسجيل دخول):**

| الطلب | استجابة Meta |
|---|---|
| تطبيقنا `1060341853401123` + `scope=pages_show_list` | `is_business_login=1` |
| تطبيق مرجعي كلاسيكي `145634995501895` + `scope=pages_show_list` | `is_business_login=1` |
| تطبيق مرجعي `124024574287414` / `442224939723604` + صلاحية صفحة | `is_business_login=1` |
| تطبيقنا + `scope=public_profile` أو `email` | `is_business_login=0` |
| تطبيقنا بلا `scope` إطلاقاً | `is_business_login=0` |

**النتيجة القاطعة:** `is_business_login=1` هو **السلوك الطبيعي لكل تطبيق يطلب صلاحيات
أعمال/صفحات** (يظهر أيضاً لتطبيقات مرجعية كلاسيكية مؤكدة)، و`0` فقط عند صلاحيات
استهلاكية أو بلا scope. فهو **لا يعني** أن التطبيق من نوع Business ولا أن
`config_id` مطلوباً.

**العطل الحقيقي:** الكود كان يحجب ربط Facebook/Instagram بـ**409
`META_BUSINESS_LOGIN_REQUIRES_CONFIG_ID`** متى رصد `businessLoginSurface===true`
(أي `is_business_login=1`) بلا `config_id`. وبما أن أي تطبيق يطلب صلاحيات صفحات يعطي
هذا العلم، فقد كان الحجب **إيجاباً كاذباً** يمنع ربط **أي** تطبيق كلاسيكي — ومنه
تطبيقنا الذي لا يملك منتج «Facebook Login for Business» أصلاً، فاستحال إنشاء
`config_id`. ونتيجةً لذلك لم يُنفَّذ الربط الحقيقي إطلاقاً.

**الإصلاح (بلا كسر أي حارس):**
- `server.ts`: `metaScopeWithoutConfigOverride()` صار الافتراضي فيها **السماح**
  (`return !(raw === "false" || raw === "0" || raw === "off" || raw === "no")`)، أي
  تمرير `scope` وإكمال الربط. الحجب الصارم يبقى متاحاً صراحةً بـ
  `META_ALLOW_SCOPE_WITHOUT_CONFIG=false` لمن يثبت لديه أن تطبيقه Business فعلاً
  ويلزمه `config_id`.
- لم يُمسّ أي شيء آخر: فحص الحوار `probeMetaDialog`، `businessLoginSurface` (يبقى
  للتشخيص في الرد)، `config_id` عند وجوده، سلامة المحتوى، منع التكرار، حارس الصلاحيات.
- `render.yaml` و`.env.example`: توثيق أن الافتراضي تمرير `scope` وأن `false` يعيد الحجب.
- `final-audit.mjs`: فحص جديد `meta-business-login-default-allows-scope` + تحديث
  وصف فحصي الحجب/المفتاح. `engine/tests/instagram.connector.test.ts` المجموعة 23
  أُعيدت صياغتها: الافتراضي 200 بلا حجب، والحجب الصارم 409 عند `...=false`.

اختبارات: `test:instagram` = 216 فحصاً · `test:facebook` = 231 · `npm run lint` ✅ ·
`npm run build` ✅ · `npm test` ✅ · `final-audit` = 1327 فحصاً.

**درس عام:** لا تُبنَ بوابة حجب على علم عام من المزوّد (مثل `is_business_login`) بلا
إثبات أنه **خاص** بالتطبيق؛ يجب مقارنته بتطبيق مرجعي. وإلا صار الحارس نفسه سبب التعطّل.
وقاعدة المشروع الملزمة («لا حجب بلا إثبات») تعني إثباتاً **مميَّزاً** لا علماً يظهر عند
الجميع.

## تشخيص قراءة-فقط لفشل ربط Facebook: تسجيل خطأ Graph كاملاً بلا قطع (2026-10-04)

**الجذر المُثبت (لا تخمين):** النص الذي رآه المالك ينتهي حرفياً عند «…feature or» في كل مرة
نسخه فيها (هاتف وسطح مكتب). هذا **قطعٌ من كودنا لا من Meta**: كتلة `catch` في
`handleOAuthCallback` كانت تبني رسالة الفشل بـ
`` `فشل إكمال ربط المنصة: ${String(e?.message||e).slice(0,240)}` ``
(server.ts). البادئة «فشل إكمال ربط المنصة: » = 22 محرفاً، و`slice(0,240)` يقع بالضبط عند
`"...Page Public Cont"` — أي قبل `"Access' feature or the 'Page Public Metadata Access' feature…"`.
فلا يعني القطع أن Meta أرسلت رسالة قصيرة. (ومثله `providerLog.eventAlias` يقطع `providerError`
بـ`.slice(0,200)`.)

**تعديل تشخيصي فقط — لا تغيير سلوك** (فرع `diag/facebook-graph-error-logging`):
- `engine/social/facebook.ts`: `extractFacebookGraphError(data, endpoint, status)` +
  `formatFacebookGraphError(info)` — دالتان صافيتان تستخرجان الحقول الكاملة
  (`code`/`error_subcode`/`message` غير مقطوعة/`type`/`fbtrace_id`/`error_user_title`/
  `error_user_msg`/`endpoint`/`status`) **بلا أي رمز أو سرّ**. تُسجَّل عبر `console.error`
  في مسارات القراءة الثلاثة عند الفشل فقط: `GET /me/accounts`، `GET /{page-id}`،
  `POST /{page-id}/subscribed_apps`.
- `server.ts`: كتلة `catch` تسجّل الآن
  `[oauth-callback-error] ${platform} status=502 message=${String(e?.message||e)}`
  **بلا قطع** (بلا توكن). **رسالة الاستجابة العامة تبقى كما هي** بـ`slice(0,240)` — لا تغيير
  على تجربة المستخدم.

**مكاسب الفحص:** عند تكرار المحاولة تظهر في سجلات Render السبب الكامل + `fbtrace_id`، فيُحسم
أي استدعاء يرمي الخطأ (المرشّح: `getPageProfile` أو `listManagedAccounts`) — علماً أن فشل
`subscribeApp` **لا يُفشل الربط** (server.ts يعيد `ok:true` دائماً مع `subscribed: sub.ok`).

**اختبار/حرّاس:** `facebook.connector.test.ts` = **238 فحصاً** (مجموعة 1ز: النص الكامل
> 240 محرفاً يُستخرَج بلا قطع + الرمز/الرقم الفرعي/`fbtrace_id` + عدم وجود أي توكن في السطر).
`final-audit` = **1330 فحصاً** (+3: `facebook-graph-error-logged-full`،
`-logged-on-catch`، `-logging-test`). `npm run lint` ✅ · `npm run build` ✅ · `npm test`
✅ (0 فشل) · `final-audit` ✅.

**لم يُمسّ:** المنطق التشغيلي، رسائل الواجهة، الصلاحيات/scopes، OAuth، أي سرّ/مفتاح،
وبقية المنصّات. **لم يُدفع/يُدمج/يُنشر** — بانتظار إذن المالك.

## إصلاح #100: إزالة الحقل الزائد `tasks` من إثبات هوية الصفحة (2026-10-04)

**الجذر المُثبت حياً (سجلات Render، لا تخمين):**
`[facebook-graph-error] {"endpoint":"GET /102540549308721","status":400,"code":100,"message":"(#100) ... requires the 'pages_read_engagement' permission ...","type":"OAuthException","fbtraceId":"ANUoPP0bw9bX3_IN-GdAZ56"}`.
أي أن الاستدعاء الفاشل هو **`getPageProfile` بالضبط** (`GET /{page-id}`)، لا `listManagedPages`
ولا `subscribeApp`. الطلب كان `fields=id,name,access_token,tasks`، وحقل **`tasks` غير مستخدم
في الكود إطلاقاً** (مُثبت بالفحص الشامل: يظهر فقط تعريفاً في النوع `FacebookPageIdentity`
وتعبئةً في `listManagedPages`/`getPageProfile`، بلا أي قارئ — كل `.tasks` أخرى تعود لسجلات
الوظائف/الحملات لا لصفحات Facebook). وطلب `tasks` على عقدة الصفحة يستدعي قراءة الصفحة،
فترد Meta `#100` بصيغة تسمّي `pages_read_engagement` على صفحات لا تمنح هذه الصلاحية
(الـConfiguration يمنحها جزئياً)، فيُفشل إكمال الربط رغم أن `id/name/access_token` وحدها
كافية ولا تحتاج أي صلاحية متقدمة.

**الإصلاح (بلا أي أثر جانبي):**
- `engine/social/facebook.ts` — `getPageProfile`: `fields` صارت `id,name,access_token`
  (حُذف `tasks` من هذا الاستدعاء تحديداً). لم يُمسّ `listManagedPages` (مسار `/me/accounts`
  منفصل لم يظهر في الخطأ) ولا أي شيء آخر.

**اختبار/حرّاس:** `facebook.connector.test.ts` = **242 فحصاً** (مجموعة 1ح وحدة: تثبيت أن
`getPageProfile` يبني `fields=id,name,access_token` بلا `tasks`؛ ومجموعة 2 تكامل: الخادم
الوهمي يلتقط `lastPageProfileFields` ويثبت غياب `tasks`). `final-audit` = **1331 فحصاً**
(+`facebook-page-profile-no-tasks-field`). `npm run lint` ✅ · `npm run build` ✅ · `npm test`
✅ · `final-audit` ✅. الفرع: `fix/facebook-drop-tasks-field`.

**لا ادّعاء نجاح قبل اختبار حيّ من المالك** يصل إلى «تم ربط صفحة Facebook بنجاح». لم يُدمج
على `main` ولم يُنشر.

**درس عام (مُصحَّح):** طلب حقل اختياري غير مستخدم في Graph API ممارسة خاطئة، لكن الاختبار
الحيّ أثبت أن `tasks` لم يكن سبب `#100` — السبب الجذري هو استدعاء عقدة الصفحة نفسه (القسم
التالي). يُبقى هذا القسم للتوثيق: الحقول الزائدة تُزال، لكن لا تفترض أنها السبب بلا إثبات
حيّ بـfbtraceId جديد.

## الجذر الحقيقي لـ#100: لا تستدعِ GET /{page-id} في الربط — رمز الصفحة يأتي من /me/accounts (2026-10-04)

**التصحيح الحاسم (دليل حيّ من المالك):** بعد نشر إزالة `tasks` (commit `691eede`) استمر
الخطأ بنفس `endpoint=GET /{page-id}` ونفس `code=100` لكن بـ`fbtraceId` **مختلف**
(`AUFu1JytQ8eLtBkEUXthSsk`) — أي محاولة جديدة فعلية على الكود المُصلَح. ⇒ **حقل `tasks`
لم يكن السبب.** السبب أن **استدعاء عقدة الصفحة مباشرةً `GET /{page-id}` نفسه** يستدعي
صلاحية قراءة صفحة (`pages_read_engagement`) وترد Meta `#100` على صفحات لا تمنحها، بلا
علاقة بأي حقول مطلوبة.

**لماذا الاستدعاء زائد أصلاً (إجابة السؤال 2):** رمز الصفحة (Page Access Token) يُمنح
**في استجابة `/me/accounts`** لكل صفحة (`access_token`). فاستدعاء `getPageProfile` بعدها
كان يعيد جلب نفس البيانات عبر عقدة الصفحة — طلب لا لزوم له يضيف سطح صلاحيات. والتدفّق
كان: `listManagedPages` (ينجح) → `facebookFinalizePageSelection` → `getPageProfile`
(يفشل #100) → `throw` → «فشل إكمال ربط المنصة: … pages_read_engagement …».

**الإصلاح الجذري (بلا أي مساس بـgetPageProfile كدالة):**
- `facebookFinalizePageSelection(pageId, userAccessToken, pageData?)` صار يقبل بيانات
  الصفحة (`pageId`/`pageName`/`pageAccessToken`) القادمة من `/me/accounts` مباشرةً،
  ويستخدمها بلا أي `GET /{page-id}`. `getPageProfile` يبقى **مساراً احتياطياً فقط** عند
  غياب رمز الصفحة من القائمة، وتبقى دالةً متاحةً ومُختبَرة وحدياً (لا مسار تشغيلي حاسم
  يستدعيها في Facebook بعد إصلاح `verifyProviderConnection` أدناه).
- `server.ts` — مسارا الربط يمرّران بيانات الصفحة: callback صفحة واحدة
  (`facebookFinalizePageSelection(pages.data[0].pageId,userToken,pages.data[0])`) و
  `POST /api/platforms/facebook/select-page` (يجد الصفحة من `listManagedPages` بالمعرّف
  ثم يمرّرها).
- **إصلاح تابع (verifyProviderConnection):** مسار `POST /api/platforms/:platform/connection-callback`
  كان يُثبت اتصال Facebook عبر `getPageProfile` → `GET /{page-id}` فيفشل حتماً بـ`#100`.
  الآن يُثبت عبر `listManagedPages` (يطابق `stored.pageId` ضمن صفحات المستخدم) — بلا
  عقدة الصفحة إطلاقاً. **الأثر بعد الإصلاح: `getPageProfile` لم يبقَ لها أي استدعاء في
  مسار حاسم**؛ تبقى دالةً متاحةً (احتياطي في الربط، ومُختبَرة وحدياً) لكن لا مسار تشغيلي
  يعتمد عليها في Facebook.
- **سجل نجاح** `[facebook-graph] GET /me/accounts ok pages=N withToken=M` (بلا اسم/رمز)
  يُثبت أن القائمة تنجح وتمنح رمز الصفحة — طُلب صراحةً للتشخيص.

**اختبار انحدار حاسم (المجموعة 19ب):** خادم Graph وهمي بـ`failPageProfile: true`
(يحاكي `#100` الحقيقي على `GET /{page-id}`) **مع** `/me/accounts` ناجح: الربط يكتمل
`200` وتظهر «تم ربط صفحة Facebook بنجاح»، و`pageProfileCalls === 0` (لا استدعاء للعقدة
إطلاقاً). ومثله في مسار اختيار الصفحة (المجموعة 19)، وفحص `connection-callback`
(المجموعة 5) يثبت أن إثبات الاتصال لا يستدعي عقدة الصفحة. `facebook.connector.test.ts` =
**250 فحصاً** (+8). `final-audit` = **1335 فحصاً** (+`facebook-finalize-uses-page-from-accounts`،
`-no-pageprofile-primary`، `facebook-accounts-success-logged`، `-on-connect-test`،
`facebook-verify-uses-accounts-not-page-node`). الفرع: `fix/facebook-finalize-from-accounts`.

**هل يفشل `GET /{page-id}` بحقل `id` فقط؟ (السؤال 4):** لا اختبار حي مباشر على الإنتاج،
لكن الفشل لم يكن يوماً بسبب الحقول: حتى `fields=id,name,access_token` (بعد إزالة tasks)
فشل بنفس `#100`. والاستدلال من سلوك Meta: طلب العقدة يُخضع للتحقق من الصلاحية قبل
الإرجاع، فتظهر رسالة الصلاحية رغم أن الحقول المسموحة محدودة. الفرق الجوهري: `/me/accounts`
تُعدّد الصفحات ضمن رمز المستخدم (مع `pages_show_list`/`business_management`) فتمرّ، بينما
قراءة عقدة الصفحة تحتاج `pages_read_engagement`. **الحل المتّبع:** تجنّب عقدة الصفحة في
الربط كلياً — وهو الحل الذي يزيل الاعتماد على تلك الصلاحية نهائياً.

**لا ادّعاء نجاح قبل اختبار حيّ من المالك** يصل إلى «تم ربط صفحة Facebook بنجاح». لم يُدمج
على `main` ولم يُنشر.

**درس عام:** لا تطلب بيانات تملكها بالفعل من نقطة نهاية أضيق صلاحية. رمز الصفحة وصل في
`/me/accounts`؛ فاستدعاء عقدة الصفحة لإعادة جلبه أضاف سطح صلاحية غير مضمون وأفشل الربط
رغم صحة كل شيء آخر.

### حدود ما بعد الإصلاح — أثر الصلاحيات غير المُمنوحة (تقرير إغلاق)

بعد هذا الإصلاح **لا يوجد أي مسار تشغيلي في Facebook يعتمد على `pages_read_engagement`
أو على `GET /{page-id}`**؛ الربط واكتشاف الصفحات وإثبات الاتصال كلها تمر عبر `/me/accounts`
(المسار الذي يمنح رمز الصفحة). لذلك:

- **مؤكّد:** `verifyProviderConnection` (مسار `connection-callback`) كان سيفشل لاحقاً بنفس
  `#100`، وقد أُصلح بنفس المنطق (إثبات عبر `/me/accounts`). لا مسار حاسم يعتمد على عقدة
  الصفحة الآن.
- **القدرات المعلنة في السجل** (`publish`، `messages`، `message_reply`، `analytics`،
  `comments`، `comment_reply`، `scheduling`) تعتمد على مسارات **برمز الصفحة** لا على
  `pages_read_engagement`:
  - رد التعليقات `POST /{comment-id}/comments` → `pages_manage_engagement` + اعتماديتها.
  - رسائل Messenger `POST /{page-id}/messages` → `pages_messaging`.
  - النشر `POST /{page-id}/feed` → `pages_manage_posts`.
  - اشتراك webhook `POST /{page-id}/subscribed_apps` → `pages_manage_metadata` + `pages_show_list`.
- **الفجوة الوحيدة المتبقية (صادقة):** أي عملية **تحتاج `pages_read_engagement` صراحةً**
  (مثل قراءة engagement/insights للصفحة، أو قراءة عقدة الصفحة مباشرةً) ستبقى مقيّدة حتى
  تُفعَّل الصلاحية في Configuration/Use Case لدى Meta. **لا يوجد في الكود أي استدعاء يتطلبها
  حالياً** — فالحدّ نظري للميزات المستقبلية لا أثر فوري. إن أُريدت لاحقاً، تُفعَّل الصلاحية
  في Meta App Dashboard → Use Cases/Configurations ثم تُضاف القدرة المقابلة.
- **`business_management`**: مطلوبة أصلاً (لصفحات Business Manager عبر `/me/accounts`) وهي
  ضمن المجموعة المطلوبة، فلا فجوة هناك.
- **`getPageProfile`**: تبقى دالةً مُختبَرة وحدياً ومتاحة كاحتياطي في الربط (عند غياب رمز
  الصفحة من القائمة فقط) — لا مسار تشغيلي يستدعيها في Facebook الآن. إن استُخدمت مستقبلاً
  في سياق لا يمنح `pages_read_engagement` فسترد `#100`، ولهذا أُبقيت **خارج كل مسار حاسم**.

## ربط Threads OAuth — عميل OAuth منفصل + إظهار خطأ Meta الحقيقي (2026-10-04)

**تصحيح مفاهيمي مُثبت (وثيقة Meta الرسمية):** Threads API له **عميل OAuth منفصل** عن
تطبيق فيسبوك الرئيسي (Threads App ID مستقل)، وله **قائمة روابط إعادة توجيه خاصة به** في:
حالات الاستخدام → الوصول إلى واجهة API تطبيق Threads → تخصيص → تبويب الإعدادات. هذه
القائمة **منفصلة** عن «Valid OAuth Redirect URIs» في Facebook Login for Business، فيجب
إضافة `redirectUri` في المكان الصحيح لكل منصة.

**عطلان متتاليان (مُثبتان حياً من المالك):**
1. `error_code 1349168` («عنوان URL محظور») — اختفى بإضافة الرابط في قائمة Threads الخاصة.
2. `error_code 1349245` («The user has not accepted the invite to test the app») — على مستوى
   Meta لا الكود: التطبيق في وضع **Development**، فأي حساب يسجّل الدخول عبر Threads OAuth
   يجب أن يكون مُضافاً كـ **Threads Tester** وقد **قبل الدعوة**.

**فجوة الكود الحقيقية التي أُصلحت (كانت تُخفي السبب):** خطأ Meta/Threads يستخدم
`error_message` + `error_code`، بينما الكود كان يقرأ `error_description`/`error` فقط
(صيغة Google)، فيظهر «فشل تبادل رمز OAuth» عام بلا السبب. الإصلاح:
- `engine/social/oauth.ts`: `formatOAuthProviderError(token)` مصدر واحد يقدّم `error_message`
  على `error_description` ثم `error`، ويُلحق `error_code` إن غاب من النص. `parseTokenResponse`
  يستخدمه عند غياب `access_token` (مع بقاء نجاح الرمز غالباً على أي خطأ).
- `server.ts`: `oauthFailureHint(platform, message)` يوجّه حسب الفئة الفعلية — لـThreads:
  `1349245` ⇒ خطوة Threads Tester + قبول الدعوة؛ `1349168` ⇒ قائمة روابط Threads الخاصة.
  يُضاف إلى رسالة الفشل في `handleOAuthCallback`، ويُطبَّق المُصيغ على معاملات `error*` القادمة
  في سطر الطلب/المقطع.
- `oauth/setup` (للمالك): كتلة `threadsSetup` تعرض `separateOAuthClient:true`، القائمة
  الصحيحة للروابط، الصلاحيات، `knownErrors` (1349168/1349245)، وخطوات لوحة Meta — بلا أي سرّ.

**قرار تشخيصي (بلا ادّعاء):** الخطأ الحالي `1349245` **ليس عطلاً في الكود** — env vars و
redirect URI صحيحة. الحدّ خارجي بحت: إضافة الحساب كـ Tester وقبول الدعوة من لوحة Meta/تطبيق
Threads، ولا ينفّذه أي وكيل برمجي. (احتمال إضافي يستحق التحقق: أن يكون حساب الدخول هو نفسه
المالك/المدير لتطبيق Meta Developer — يُفحص إن استمر الخطأ بعد إضافة Tester.)

اختبارات: `engine/tests/platform.foundation.test.ts` = **99 فحصاً** (+5: عرض رسالة Threads
الحقيقية ورمزها، عدم إخفائها خلف نص عام، بقاء صيغة Google مدعومة). فحوص final-audit الخمسة
الجديدة: `oauth-provider-error-formatter`، `parse-token-response-uses-provider-message`،
`threads-oauth-failure-hint`، `threads-setup-block-exposed`، `threads-oauth-error-test`
(**1342 إجمالاً**). لم يُمسّ Facebook/Instagram/TikTok/YouTube/Telegram، ولا Gemini، ولا
مفاتيح التشفير، ولا أي سرّ.

## إصلاح ثغرة انتحال قرار الاعتماد على النشر + حالة published عند الإنشاء (2026-10-04)

**الثغرة المُثبتة (تجاوز تفويض حقيقي):** مسار `PATCH /api/workspace/content/:id` كان يقبل من أي
دور محرّر (manager/staff/content_creator) كتابة `status:"approved"` أو `"scheduled"` مباشرةً،
بينما مسارا الاعتماد والجدولة الرسميان محصوران بالمالك (`requireOwner`). وبما أن بوابة النشر
تقرأ حالة المنشور مباشرةً (`publishPreflight({approved: post.status==='approved'})`)، كان موظف
عادي قادراً على **انتحال قرار الاعتماد** فيمرّ النشر بلا موافقة المالك — تجاوز مباشر لبوابة
اعتماد النشر الحرجة (النتيجة #1 في دفعة الإصلاحات).

**ثغرة ثانية:** `POST /api/workspace/content` كان بلا فحص دور أصلاً، وقائمة الحالة المقبولة
تتضمن `"published"` — فيمكن إنشاء منشور معلَّم كمُنشَر مباشرةً، بينما PATCH يحجبه صراحةً
(تجاوز قاعدة «لا نشر بلا إثبات مزود»).

**الإصلاح — مصدر واحد `engine/social/contentStatusPolicy.ts`:**
- `CONTENT_EDITOR_ROLES` و`canEditContent(role)`.
- `CONTENT_DIRECT_SETTABLE_STATUSES` = `draft|review|edited` (المسموح عبر PATCH/الإنشاء).
- `CONTENT_OWNER_ONLY_STATUSES` = `approved|scheduled` (مسار المالك الرسمي فقط).
- `CONTENT_PROVIDER_PROOF_STATUS` = `published` (يتطلب إيصال تنفيذ من مزود المنصة).
- `canSetContentStatusByRole(role,status)` يعيد قراراً صريحاً بكود
  (`ROLE_NOT_PERMITTED`/`OWNER_APPROVAL_ENDPOINT_REQUIRED`/`PUBLISHED_REQUIRES_PROVIDER_PROOF`).

`server.ts`: PATCH وPOST يستخدمان `canEditContent` و`canSetContentStatusByRole`؛ لا توجد أي
قائمة حالات مضمّنة بعد الآن. الواجهة (`AppContext.updatePostStatus`) تعتمد/تجدول عبر
المسارين الرسميين الجديدين `apiService.approveWorkspaceContent`/`scheduleWorkspaceContent`
(لا PATCH)، فلا ينكسر تدفّق المالك ولا يمكن انتحال الاعتماد.

اختبارات: `acceptance.authz.real.test.ts` (+9 فحوص على الخادم الفعلي: PATCH approved/scheduled
مرفوض 403، published مرفوض 409، الإنشاء بحالة published/approved مرفوض، والمالك يمرّ عبر
المسار الرسمي). فحصا final-audit: `content-status-approval-owner-only`،
`content-post-no-published-status` (**1342 إجمالاً**). لم يُمسّ أي سر أو متغير بيئة.

## استضافة Drive عامة لفيديوهات التسويق — الأساس لتوحيد النشر متعدد المنصات (2026-10-08)

**السياق:** طلب المالك توحيد توليد/نشر الفيديو عبر 5 منصات (يوتيوب/فيسبوك/إنستغرام/تيك
توك/ثريدز) من زر واحد في مركز المحتوى الذكي. إنستغرام وتيك توك يتطلبان بروتوكولياً رابط
فيديو عاماً قابلاً للسحب (`video_url`) — لا يقبلان رفع بايتات مباشرة عبر الأتمتة. وافق
المالك صريحاً على تفعيل هذا عبر Google Drive («نعم، فعّلها عبر Drive، موافق على الرابط
العام»)، معتمداً نفس تفويض Drive الشخصي المستخدم أصلاً لمنظومة DR (نطاق `drive.file` فقط،
رمز تجديد مشفّر مخزَّن).

**فصل متعمد عن DR (قاعدة ملزمة):** صلاحية القراءة العامة لا تُمنح أبداً لأي ملف نسخة
احتياطية أو سرّ. أُنشئ مجلد جذر منفصل تماماً `al-gharabi-ai-marketing` (ثابت مستقل عن
`DR_FOLDER_NAME`/`al-gharabi-ai-dr`)، ومعرّفه يُحفظ في حقل جديد منفصل كلياً
`driveMarketingFolderIdentity` (وليس `driveFolderIdentity` الخاص بـDR). لا تعديل على منطق
DR الداخلي (`engine/dr/routes.ts`) إطلاقاً — إعادة استخدام فقط لرمز التجديد المخزَّن ولعميل
`DriveClient` العام القابل للحقن.

**ما أُنشئ:**
- `tools/dr/drive-client.mjs`: دالتان جديدتان على `DriveClient` — `createPublicPermission(fileId)`
  (تمنح `{type:'anyone', role:'reader'}` فقط — قراءة عامة، لا كتابة ولا ملكية) و
  `deletePermission(fileId, permissionId)` (سحب — مسار تراجع).
- `engine/social/videoPublicHosting.ts` (وحدة جديدة مستقلة):
  - `ensureMarketingFolder` — يضمن وجود `al-gharabi-ai-marketing` (معرّف محفوظ → بحث بالاسم
    → إنشاء)، بنفس قواعد `drive.file` المفروضة في DR (لا يُستخدم `root` أبداً).
  - `uploadPublicVideo` — يرفع، يمنح الصلاحية العامة، ويعيد `publicUrl` مباشراً
    (`webContentLink` إن توفّر، وإلا رابط `uc?export=download` المعروف كبديل). **تراجع
    تلقائي:** فشل منح الصلاحية بعد رفع ناجح ⇒ حذف الملف فوراً (لا يُترك ملف عام بالخطأ ولا
    ملف يتيم بلا رابط صالح).
  - `revokePublicVideo` — يسحب الصلاحية ويحذف الملف معاً (لتقليل التعرّض العلني بعد اكتمال
    النشر على كل المنصات المستهدفة، بدل تركه عاماً إلى الأبد).
  - `publishVideoPublicly` — تركيب شامل (ensure + upload) بنداء واحد، نقطة الدخول المقترحة
    لبقية النظام (Task #23/#25).
- `server.ts`: حقل حالة جديد `drControl.driveMarketingFolderIdentity` (يصمد بعد
  restart/cold start، بلا أي سرّ — معرّف مجلد فقط)، ودالة `buildMarketingDriveClient()` تبني
  عميل Drive جاهزاً من رمز التجديد المخزَّن نفسه (`createRefreshTokenProvider`) — جاهزة
  للاستخدام من Task #23 (ربط إنستغرام/تيك توك تلقائياً) بلا أي اعتماد OAuth جديد.
- اختبار منطقي كامل بخادم Drive وهمي بالذاكرة (بلا شبكة): `engine/tests/dr/dr.video.public.hosting.test.ts`
  (22 فحصاً) يثبت إنشاء/إعادة استخدام المجلد، نجاح الرفع+المنح، التراجع عند فشل المنح،
  السحب الكامل، والتركيب الشامل. وُسِّع الـDrive الوهمي
  (`engine/tests/dr/helpers/fakeDrive.ts`) بدعم `permissions` (منح/سحب) و`webContentLink`/
  `webViewLink` ليغطي السلوك الجديد لبقية اختبارات DR أيضاً.

**تنبيه تشغيلي موثَّق (قيد خارجي في Drive نفسه، وليس عيباً في الكود):** رابط
`webContentLink`/`uc?export=download` العام غير مضمون رسمياً كبثّ بايتات مباشر لكل طالب
تلقائي خارجي — قد يُعيد Drive صفحة HTML وسيطة ("تعذّر فحص الملف بحثاً عن فيروسات") خصوصاً
للملفات الكبيرة، وهذا سلوك غير رسمي قابل للتغيير. **لم يُتحقَّق منه تجريبياً بعد** (يتطلب
رفع فيديو حقيقي وفحص Content-Type الفعلي عند سحب إنستغرام/تيك توك له) — يجب فعل ذلك عند
أول استخدام حقيقي (Task #23)، وإن ظهرت الصفحة الوسيطة فالحل خدمة الفيديو من نقطة نهاية
الخادم نفسها (تمرير Range) بدل الاعتماد على رابط Drive العام مباشرة.

**الحالة: Task #21 (الأساس) مكتمل ومُختبر. لم يُربط بعد بأي مسار نشر فعلي** — الربط
الحقيقي بمسارات إنستغرام/تيك توك (Task #23)، نشر فيديو فيسبوك (Task #22)، موصل ثريدز
الحقيقي (Task #24)، وزر التوليد الواحد الموحّد (Task #25) تبقى أعمالاً منفصلة لاحقة، كما
اتُّفق مع المالك. لم يُمسّ أي سرّ، ولا منطق DR، ولا أي مسار نشر قائم.

## نشر فيديو حقيقي على صفحة فيسبوك (Task #22) — 2026-10-08

**السياق:** `engine/social/facebook.ts` كان يدعم فقط `publishToPage` (نص صِرف عبر
`POST /{page-id}/feed`) — لا مسار فيديو إطلاقاً، بينما طلب المالك توحيد النشر على 5 منصات
بما فيها فيسبوك. إنستغرام وتيك توك يستخدمان `video_url` (Graph API الخاص بهما)؛ **فيسبوك
يستخدم اسم حقل مختلفاً فعلياً**: `POST /{page-id}/videos` يقرأ الفيديو من رابط عام عبر
`file_url` — وهذا فرق موثَّق قصداً تجنّباً لخلطه بـ`video_url` الخاص بإنستغرام.

**ما أُضيف:**
- `engine/social/facebook.ts`:
  - `buildPublishVideoBody(fileUrl, description?)` — دالة حتمية بلا شبكة تبني جسم الطلب
    (`file_url` + `description` اختياري، بلا `video_url` إطلاقاً).
  - `FacebookClient.publishVideoToPage(pageId, pageAccessToken, fileUrl, description?)` —
    `POST /{page-id}/videos`. **لا نجاح بلا `id` حقيقي من Meta** (نفس قاعدة بقية الموصل).
    يسجّل خطأ Graph الكامل عبر `extractFacebookGraphError`/`formatFacebookGraphError`
    الموجودتين مسبقاً (بلا أي سرّ) عند الفشل.
  - **لا صلاحية OAuth جديدة مطلوبة**: `pages_manage_posts` (الموجودة أصلاً لنشر النص) تكفي
    لنشر الفيديو أيضاً حسب وثائق Meta.
- `server.ts` (`executePlatformPublish`، فرع `facebook`): إن ورد `body.videoUrl` (رابط عام
  — مثلاً مخرَج `publishVideoPublicly` من Task #21) يُستدعى `publishVideoToPage` بدل
  `publishToPage` النصي، ويُسجَّل `mediaKind:"video"` في الإيصال. **لا تنزيل ولا إعادة
  استضافة هنا** — الرابط يجب أن يكون عاماً مسبقاً (مسؤولية الطبقة التي تستدعي هذا المسار:
  Task #25 لاحقاً تربط Task #21 بهذا المسار تلقائياً).

**اختبارات:** `engine/tests/facebook.connector.test.ts` — فحوص وحدة جديدة (القسم "1ط"):
بناء الجسم (`file_url` لا `video_url`، الوصف اختياري)، نجاح النشر بمعرّف من Meta، استهداف
`/{page-id}/videos` فعلياً، فشل بلا `id`، ورفض رابط فارغ قبل أي طلب شبكي. تحقّق إضافي
مستقل (`tsc` + Node بمحاكاة fetch، بلا شبكة حقيقية — نفس أسلوب الجلسة بسبب حظر npm في
الـsandbox): **10/10 فحصاً ناجحاً**.

**الحالة: Task #22 مكتمل.** لم يُمسّ أي مسار رد/تعليق فيسبوك قائم، ولا أي صلاحية، ولا أي
سرّ. يبقى: Task #23 (ربط إنستغرام/تيك توك تلقائياً بـTask #21)، Task #24 (ثريدز)، Task #25
(الزر الموحّد يربط Task #21 بهذا المسار وبباقي المنصات تلقائياً مع بقاء بوابة اعتماد
المالك قائمة).

## ربط إنستغرام/تيك توك/فيسبوك تلقائياً باستضافة Drive العامة (Task #23) — 2026-10-08

**السياق:** Task #21 بنى استضافة Drive عامة للفيديو، وTask #22 أضاف نشر فيديو فيسبوك —
لكن كلاهما كان يتطلب من المُستدعي تزويد `videoUrl` عاماً جاهزاً يدوياً. هذا يربطهما: إن لم
يُزوَّد `videoUrl` صريحاً لكن وردت بايتات الفيديو (`videoBase64` — نفس حقل مسار اليوتيوب
الحالي)، تُستضاف تلقائياً عبر Drive وتُستخدم النتيجة كرابط عام، بلا أي تدخل يدوي.

**ما أُضيف (`server.ts`):**
- `resolvePublicVideoUrl(body)` — دالة مشتركة جديدة تُستدعى من فروع `facebook`/
  `instagram`/`tiktok` في `executePlatformPublish`:
  1. `videoUrl` صريح في الجسم ⇒ يُستخدم كما هو حرفياً (**لا كسر توافق** مع المسار اليدوي
     القديم ولا مع أي اختبار قائم يزوّد رابطاً جاهزاً).
  2. وإلا `videoBase64` ⇒ يُسجَّل ويُتحقَّق بنفس قواعد `registerContentMedia` الموجودة
     أصلاً (الحجم/base64/mime)، ثم يُرفع تلقائياً إلى Drive عبر `publishVideoPublicly`
     (Task #21) ويُعاد كرابط عام. فشل أي خطوة ⇒ رمز خطأ صريح
     (`MEDIA_INVALID`/`DRIVE_NOT_CONFIGURED`/`VIDEO_HOSTING_FAILED`)، **لا نشر صامت بلا
     رابط فعلي**.
  3. بلا أي منهما ⇒ رابط فارغ (كل منصة تتولى رفضها القائم: فيسبوك ينشر نصاً، إنستغرام/تيك
     توك يرفضان بـ`MEDIA_REQUIRED` كما كانا).
- **تخزين مؤقت بالمحتوى (sha256 لنص base64، 10 دقائق، حتى 50 عنصراً بإخلاء الأقدم):** عند
  توزيع نفس الفيديو على عدة منصات في طلب واحد (تمهيداً لـTask #25)، لا يُرفع نفس الملف إلى
  Drive أكثر من مرة — تُعاد نفس الرابط العام لكل منصة لاحقة ضمن النافذة. ذاكرة فقط (لا
  يصمد بعد restart عمداً — رفع جديد عند أول طلب تالٍ، لا ضرر).
  يصمد `driveMarketingFolderIdentity` (Task #21) عبر `saveControlState()` عند أول رفع
  فعلي، فلا يُعاد البحث عن مجلد `al-gharabi-ai-marketing` بالاسم كل مرة.

**التحقق (قيود الـsandbox):** `tsc --noEmit` أظهر **683** خطأ قبل وبعد التعديل بالضبط (صفر
أخطاء جديدة، كلها من الفئة الأساسية القائمة أصلاً — بلا `@types/node`). منطق التخزين
المؤقت (TTL + الحد الأقصى + إخلاء الأقدم) ومنطق تمرير `videoUrl` الصريح تم التحقق منهما
بنسخة مستقلة مطابقة حرفياً (6 فحوص ناجحة) بلا شبكة. **لم يتسنَّ تشغيل اختبار تكاملي حقيقي
يُشغِّل الخادم فعلياً** (يتطلب express وباقي الاعتماديات؛ `npm install` محظور في هذا
الـsandbox كما وُثِّق سابقاً) — خطوة الفن (`registerContentMedia`/`contentMediaBytes`
الموجودتان أصلاً وتُستخدمان بلا تعديل) وخطوة الرفع (`publishVideoPublicly`) مُختبرتان
بالفعل بمعزل (Task #21: 22 فحصاً). يُنصح بتشغيل `npm run test:multi-platform-publish` في
CI عند أول فرصة قبل الاعتماد على هذا المسار في الإنتاج الفعلي.

**الحالة: Task #23 مكتمل منطقياً، غير مُتحقَّق تكامليّاً في هذا الـsandbox.** لم يُمسّ أي
مسار نشر نصّي/صورة قائم، ولا أي اختبار يزوّد `videoUrl` صريحاً (لا يزال يعمل حرفياً كما
كان). يبقى: Task #24 (ثريدز)، Task #25 (الزر الموحّد في مركز المحتوى يبني `videoBase64`
من الفيديو المرفوع ويوزّعه على كل المنصات المختارة عبر هذا المسار، مع بقاء بوابة اعتماد
المالك قائمة).

## موصل Threads الحقيقي + إصلاح ثغرة إثبات الهوية في OAuth العام (Task #24) — 2026-10-08

**السياق:** خامس منصة اجتماعية (بعد Telegram/Facebook/Instagram/TikTok) تحصل على موصل
نشر حقيقي، وأول موصل يستخدم `graph.threads.net` (تطبيق Meta منفصل عن تطبيق Facebook
الرئيسي، موثَّق أصلاً في `OAUTH_CONFIG` بـ`separateOAuthClient:true`). تزامن هذا مع إصلاح
ثغرة كانت موجودة فعلاً في مسار OAuth العام المشترك بين threads/x/snapchat/google_business.

**(أ) الثغرة المُصلَحة — مسار OAuth العام كان يُثبِّت هوية مزيَّفة عند فشل الإثبات الحقيقي:**
الفرع العام في `server.ts` (المستخدَم لأي منصة بلا فرع callback مخصَّص — خلافاً لـ
YouTube/TikTok/Facebook/Instagram التي تملك فرعها الخاص بالفعل) كان يضبط
`providerVerified:true` بهوية مكان محجوز ثابتة (`"authorized-user"` / `"حساب متصل"`) **حتى
لو فشل `fetchProviderAccount` فعلياً أو لم يكن له فرع إثبات مطابق لتلك المنصة أصلاً** (حالة
Snapchat: صفر كود إثبات هوية). التعليق الأصلي كان يُجادل بأن «الإثبات الإضافي اختياري؛
الفشل لا يُلغي نجاح التبادل» — وهذا يُسقِط الفرق بين «تبادل رمز OAuth نجح» و«أثبتنا هوية
حساب حقيقي قابل للنشر عليه فعلاً»، فيُعلن النظام منصة «موثَّقة» ويُظهرها جاهزة للنشر رغم
عدم إثبات أي هوية إطلاقاً. الإصلاح: فشل `fetchProviderAccount` (بما يشمل غياب فرع الإثبات
نفسه) يُفشل تبادل OAuth بصريح (`throw`)، فلا اتصال «موثَّق» بلا دليل حقيقي من المزوّد. طُبِّق
على الفرع العام ككل (threads/x/snapchat/google_business معاً) لا على Threads فقط — لأن
Snapchat أصلاً `realConnector:false` (لا نشر فعلي ممكن عبره بثغرة أو بدونها)، فتطبيق
الإصلاح عليه آمن ولا يكسر أي قدرة منفَّذة فعلاً، بل يمنع ادعاء اتصال زائف واحد أقل.

**(ب) الموصل الجديد — `engine/social/threads.ts`:** يطابق بنية Instagram حرفياً (حاوية ثم
نشر، فحص حالة اختياري): `buildThreadsContainerBody` (أولوية فيديو > صورة > نص؛ خلافاً
لإنستغرام، **نص مجرّد بلا وسائط مقبول رسمياً** في Threads)، `buildThreadsPublishBody`،
و`ThreadsClient` بأربع دوال: `getProfile` (إثبات الهوية الحقيقي عبر
`GET /me?fields=id,username` — نفس الاستدعاء المُلزَم الآن في `fetchProviderAccount`)،
`createMediaContainer`، `publishContainer`، `getContainerStatus`. لا نجاح في أي دالة بلا
معرّف حقيقي صادر من Meta. Threads لا يملك endpoint ردود مستقل كـInstagram/Facebook — الرد
هو منشور جديد بحقل `reply_to_id` (مدعوم في `buildThreadsContainerBody` لكنه **غير مُستخدَم**
في Task #24: لم تُعلن قدرة `comment_reply`، أدناه).

**(ج) السجل (`engine/social/registry.ts`):** `realConnector` صار `true` لـThreads، لكن
`capabilities` تم **تقليصها** من `['publish', 'analytics', 'comments', 'comment_reply',
'scheduling']` إلى `['publish']` فقط — القدرة الوحيدة المنفَّذة فعلياً فعلاً. هذا يتبع قاعدة
المشروع الصريحة: «القدرة تُقرأ من السجل ويقابلها استدعاء حقيقي»، فالأمانة في الإعلان أولى من
اكتمال الواجهة. لا webhook ولا مراقبة تعليقات لـThreads في هذا الإصدار (غير مطلوب ضمن Task
#24 — سيُنظر فيه لاحقاً إن طلبه المالك صريحاً).

**(د) السلك في `executePlatformPublish`:** فرع `threads` جديد بين `instagram` و`tiktok` —
نفس شكل كل الفروع الأخرى (حل الهدف/بيانات التفويض ← بناء الطلب ← استدعاء العميل الحقيقي ←
بناء سجل النشر/الإيصال ← حفظ ← تدقيق ← استجابة)، بلا نجاح بلا معرّف منشور حقيقي من Meta.
يستخدم `resolvePublicVideoUrl` (Task #23) لفيديو Threads أيضاً — استضافة Drive تلقائية إن
لم يُزوَّد رابط فيديو عام صريحاً.

**التحقق:**
- `tsc --noEmit -p tsconfig.json`: **683 → 684** خطأ على `server.ts`، والفارق الوحيد بعد
  تطبيع رسائل الخطأ (حذف أرقام السطر/العمود) هو سطر إضافي واحد من فئة `TS2591 Cannot find
  name 'process'` القائمة أصلاً (غياب `@types/node`) — **صفر أخطاء من فئة جديدة، صفر أخطاء
  تركيبية (`TS1xxx`)**. `engine/social/threads.ts` مُفرَداً: صفر أخطاء `TS1xxx`.
- فحوص نصية ثابتة جديدة في `engine/tests/platform.foundation.test.ts` (4 فحوص) تؤكد غياب
  الهوية المزيَّفة القديمة ووجود نمط `throw` الجديد في المصدر الفعلي — ناجحة.
- `engine/tests/threads.connector.test.ts` (جديد، 46 فحصاً وحدوياً بمحاكي fetch محلي —
  روابط Graph، أولوية الوسائط في بناء الحاوية، نص مجرَّد مقبول، `reply_to_id`، وكل دوال
  `ThreadsClient` الأربع بما فيها مسارات الفشل/الاستثناء) — **46/46 ناجحة**، مُحقَّقة عبر
  نسخة مُجمَّعة مستقلة (`tsc` إلى JS خام + `node` مباشرة) لأن `npm install`/`tsx` محظوران في
  هذا الـsandbox (التسجيل مضاف إلى `package.json` كـ`test:threads` لتشغيله فعلياً في CI).
- ثلاثة ملفات اختبار قائمة كانت تفترض `realConnector:false` لـThreads
  (`platform.capabilities.test.ts`, `platform.foundation.test.ts`,
  `platform.operations.test.ts`) تم تحديثها لتعكس حالته الجديدة (نفس نمط انتقال Instagram
  السابق بالضبط) — قبل أن تفشل هذه الثغرة الافتراضية القديمة اختبارات CI.
- **لم يتسنَّ تشغيل اختبار تكامل حقيقي يُشغِّل الخادم فعلياً** (يتطلب `express`؛ `npm
  install` محظور في هذا الـsandbox كما وُثِّق مسبقاً لكل المهام السابقة) — لا OAuth حقيقي
  مع خادم Graph وهمي لـThreads تحديداً بعد. يُنصح بتشغيل `npm run test:threads` و`npm run
  test:multi-platform-publish` في CI عند أول فرصة قبل الاعتماد على هذا المسار في الإنتاج.

**عائق خارجي يجب الإشارة إليه — لا يحجب الدمج أو النشر:** تشغيل Threads فعلياً في الإنتاج
يتطلب من المالك تسجيل تطبيق «Threads API» **منفصل** في Meta for Developers (ليس تطبيق
Facebook الحالي نفسه — كما وُثِّق أصلاً في `separateOAuthClient:true`) وتزويد Render بمتغيرات
البيئة: `THREADS_OAUTH_CLIENT_ID`، `THREADS_OAUTH_CLIENT_SECRET`، `THREADS_APP_SECRET`،
`THREADS_VERIFY_TOKEN`. بلا هذه القيم، يبقى الموصل مكتمل الكود وجاهزاً، لكن محاولة ربط
Threads من واجهة المالك تفشل بوضوح (بيانات تفويض ناقصة) بدل أي ادعاء اتصال زائف — وهذا هو
السلوك الصحيح المطلوب، لا عطلاً يُصلَح هنا.

**الحالة: Task #24 مكتمل (كود + اختبارات وحدوية)، غير مُتحقَّق تكامليّاً بخادم حقيقي في هذا
الـsandbox.** لم يُمسّ أي مسار نشر/رد قائم لمنصة أخرى. يبقى: اعتماد المالك لتطبيق Threads API
الخارجي (عائق خارجي بحت، لا يحجب هذا الدمج)، وTask #25 (الزر الموحّد في مركز المحتوى يربط
Tasks #21-#24 بتجربة ضغطة واحدة فعلية عبر كل المنصات المختارة، مع بقاء بوابة اعتماد المالك
الحالية — `requireOwner` + `status === "approved"` — كما هي بلا أي التفاف).

## ربط زر التوليد الواحد بالتوزيع الفعلي عبر كل المنصات (Task #25) — 2026-10-08

**السياق:** "مركز صناعة المحتوى الذكي" (`ContentEngineView.tsx`) يولّد نصاً، يكيّفه لكل منصة
مختارة (`adaptedVersions`)، ويسمح بإرفاق فيديو ورابطه العام. مسار النشر الفعلي بنقرة واحدة
(`POST /api/workspace/content/:id/publish`، مبني مسبقاً مع بوابة الحوكمة الصحيحة —
`requireOwner` + `status === "approved"` + توزيع متوازٍ عبر `executePlatformPublish` نفسه)
كان موجوداً فعلاً من عمل سابق — **لكن عند فحصه فعلياً تبيَّن أنه يحتوي ثغرة حقيقية لم
تُكتشف من قبل**: كان يرسل `post.content` الحرفي نفسه لكل منصة مستهدفة، متجاهلاً تماماً
`post.platformVersions` (النسخ المكيَّفة التي يبنيها "مركز المحتوى" بالذات)، **ولا يمرّر أي
وسيط (صورة/فيديو) إطلاقاً** — فحتى لو أرفق المالك فيديو ورابطه العام، تصل إنستغرام/ثريدز
بلا `videoUrl`/`imageUrl` فتفشلان دوماً بـ`MEDIA_REQUIRED`، وفيسبوك ينشر نصاً فقط حتى مع
فيديو مرفق فعلياً. هذا هو جوهر "عدم التوحيد الحقيقي" الذي طلبه المالك أصلاً — الزر كان
موجوداً شكلياً لكنه لا يوزّع المحتوى الصحيح فعلياً.

**الإصلاح (`server.ts`, مسار `/api/workspace/content/:id/publish`):** لكل منصة في
`requested.map(...)`:
1. `perPlatformContent` = `post.platformVersions[platform]` إن وُجدت وغير فارغة، وإلا
   `post.content` كاحتياط — فتصل كل منصة نسختها المكيَّفة فعلاً بدل نص عام واحد لكل المنصات.
2. `mediaFields` تُبنى من `post.mediaUrl`/`post.mediaType` الحقيقيين: `videoUrl` إن كان
   `mediaType === "video"`، أو `imageUrl` إن كان `"image"` — فتُستخدم بنية
   `resolvePublicVideoUrl` (Task #23) والموصلات الحقيقية (Task #21/22/24) بدل تجاهلها
   بصمت داخل `executePlatformPublish`.
3. لا تغيير في بوابة الحوكمة: لا يزال owner فقط، ولا يزال `status !== "approved"` يرفض
   بـ409، ولا يزال "published" لا يُعلَن بلا معرّف مزود حقيقي واحد على الأقل.

**(`ContentEngineView.tsx`):** كان `createPost` يرسل `mediaUrl: selectedProduct?.image`
دائماً (حتى مع فيديو مرفق!) و`mediaType` مشتقّاً من نوع المحتوى (`contentType`) لا من وجود
فيديو فعلي — فلو اختار المالك "فيديو قصير/ريلز" بلا أي ملف مرفق كانت توصف الحالة
`mediaType:'video'` بلا أي `mediaUrl` أصلاً، ولو أرفق فيديو ورابطه العام كان الرابط يُذكر
فقط كنص داخل `content` (`"رابط الفيديو العام..."`) لا كحقل بنيوي يقرأه مسار النشر. الإصلاح:
`effectiveMediaUrl`/`effectiveMediaType` تُحسَب من وجود فيديو **ورابطه العام الفعلي**
أولاً (`video && publicVideoUrl` ⇒ `mediaType:'video'`, `mediaUrl: publicVideoUrl`)، وإلا
صورة المنتج كاحتياط (`mediaType:'image'`) — فالقيمة المخزَّنة على المنشور تطابق الوسيط
الحقيقي الذي سيُستخدم وقت النشر الفعلي حرفياً.

**التحقق:**
- `tsc --noEmit -p tsconfig.json`: **684 → 684** خطأ على `server.ts` بالضبط (صفر جديد) و**213
  → 213** على `ContentEngineView.tsx` بالضبط (صفر جديد، مُقارَن عبر `git stash`/`git stash
  pop`) — كلها من الفئة الأساسية القائمة أصلاً (غياب `@types/node`/`@types/react`). صفر
  أخطاء `TS1xxx` في كلا الملفين.
- 9 فحوص نصية ثابتة جديدة في `engine/tests/platform.foundation.test.ts` (مجموعة "النشر
  متعدد المنصات بنقرة واحدة — Task #25") تؤكد مباشرة من المصدر الفعلي: قراءة
  `platformVersions[platform]` مع احتياط `post.content`، غياب نمط الثغرة القديمة
  (`content: post.content` الحرفي الموحَّد)، تحويل `mediaUrl`/`mediaType` إلى
  `videoUrl`/`imageUrl`، ودمجها فعلياً في نداء `executePlatformPublish` — **9/9 ناجحة**،
  مُحقَّقة بتشغيل الفحوص مباشرة بـ`node` على نص `server.ts` الفعلي (نفس أسلوب الفحص
  النصي الثابت المستخدَم مسبقاً لإصلاح Task #24). كما تؤكد المجموعة بقاء بوابتَي
  `requireOwner` و`status === "approved"` كما هما بلا أي تخفيف.
- **لم يتسنَّ تشغيل اختبار تكامل حقيقي يُشغِّل الخادم فعلياً مع موصل متصل** (لإثبات أن نصاً
  مختلفاً فعلياً وصل فيسبوك عن إنستغرام، ووصل رابط فيديو حقيقي كـ`videoUrl` إلى الموصل) —
  يتطلب `express` وامتداد خادم Graph وهمي متصل لكل منصة؛ `npm install` محظور في هذا
  الـsandbox كما وُثِّق لكل مهمة سابقة. `engine/tests/publish.multiplatform.test.ts` القائم
  (تكاملي حقيقي يُشغِّل الخادم) يبقى الأساس الصحيح لإضافة حالة مع موصل فيسبوك متصل فعلاً
  (مطابقة لنمط `facebook.connector.test.ts`) عند أول فرصة تشغيل حقيقية.

**الحالة: Task #25 مكتمل — الزر الموحّد في "مركز صناعة المحتوى" يوزّع الآن فعلياً نسخة
مكيَّفة مختلفة لكل منصة مع الوسيط الحقيقي الصحيح (فيديو/صورة)، بدل نص وسيط موحَّد مُتجاهَل
جزئياً كما كان.** بوابة اعتماد المالك (`requireOwner` + `status === "approved"`) لم تُمسّ
ولم تُخفَّف إطلاقاً — لا نشر تلقائي صامت بأي حال.

## نموذج المنتج: عرض سعر التقسيط (Product Catalog / Display فقط) — 2026-10-04

تحسين بيانات وعرض سعر المنتج فقط — ليس نظام أقساط/عقود/تحصيل/مالية، ولا إعادة أي نظام
ERP/Sales/CRM/Finance.

- **مصدر واحد للحساب:** `src/utils/installmentPrice.ts` (يعمل على الخادم والمتصفح، كـ
  `scheduleTime.ts`). التقريبيات الافتراضية: `INSTALLMENT_MARKUP_PERCENT_DEFAULT = 25`،
  `INSTALLMENT_MONTHS_DEFAULT = 10`، المدة المقبولة 1–60. **نسبة الزيادة الحالية حقل يدوي**
  (قيمتها الابتدائية 25 لكن يمكن تغييرها لأي رقم ≥ 0).
- **المعادلة:** `installmentPrice = cashPrice + نسبة الزيادة%` (النسبة من الحقل اليدوي؛
  الافتراضي 25 عند غيابها)، `monthlyInstallment = installmentPrice / months`. التقريب:
  السعر لأقرب دينار (`Math.round`)، القسط لأعلى دينار (`Math.ceil`) — نفس سياسة `ceil-to-IQD`
  في `/api/catalog/quote`.
- **الحقول (بالعربية):** ثلاثة حقول يدوية — سعر الكاش (د.ع)، نسبة الزيادة (%)، مدة التقسيط
  (بالأشهر) — وحقلان محسوبان للقراءة فقط — سعر التقسيط (د.ع)، القسط الشهري (د.ع).
- **الخادم:** `applyInstallmentFields` (بجانب مسار المنتجات) يشتق الحقول من `cashPrice` +
  `installmentMarkupPercent` ويُطبَّق في مساري الإنشاء والتعديل؛ نسبة/مدة صريحة غير صالحة
  تُرفض 400؛ القيمة الشهرية الواردة في الجسم تُتجاهَل (لا تُحفظ). للتوافق: `installmentFrom`
  يُحدَّث بالقسط المشتق نفسه.
- **الواجهة:** `ShowroomDatabaseView.tsx` — عند إدخال سعر الكاش أو تغيير النسبة أو المدة
  يُحسب سعر التقسيط والقسط الشهري فوراً. الحقل يُعاد إلى 25 بعد الإضافة.
- **التوافق:** حقول `ShowroomProduct` الجديدة اختيارية؛ المنتجات القديمة بلا هذه الحقول لا
  تتأثر (عرض احتياطي عبر `installmentFrom`).
- اختبار: `engine/tests/product.installment.price.test.ts` (`npm run test:product-installment`،
  78 فحصاً: وحدة + خادم حقيقي، يشمل الأمثلة الإلزامية TEST 1–8 والتقريب والتوافق ونسبة مخصّصة
  (40%) تُحفظ فعلاً وربط الواجهة). فحوص final-audit: `product-installment-*` (1368 إجمالاً).

## إغلاق فجوة الرفع اليدوي: استضافة فيديو مركز المحتوى تلقائياً (Task #25 follow-up) — 2026-10-08

الفجوة الوحيدة المتبقية من Task #25 كانت أن المالك يجب أن يلصق رابط الفيديو العام يدوياً
في حقل "رابط الفيديو العام" بعد إرفاق الفيديو — خطوة يدوية تكسر وعد "ضغطة واحدة تفعل كل شيء".

**الإصلاح:**
- مسار خادم جديد `POST /api/workspace/content/video/host` (`server.ts`): يعيد استخدام
  **نفس** `resolvePublicVideoUrl`/`publishVideoPublicly` المستخدمتين أصلاً وقت النشر
  (Task #21/#23) — لا منطق رفع مزدوج. **لا نشر خارجي هنا إطلاقاً** (تجهيز وسيط فقط)،
  فالحارس `authenticateToken` + `canEditContent(user.role)` يكفي — ليس `requireOwner`،
  لأن أي محرّر محتوى يملك أصلاً صلاحية إنشاء المنشور نفسه.
- `apiService.hostContentVideo()` (`src/services/api.ts`): غلاف نداء بسيط لهذا المسار.
- `ContentEngineView.tsx`: `onPickVideo` يستدعي الرفع التلقائي **فور** اختيار الفيديو
  (بلا انتظار أي إجراء آخر من المالك) ويملأ حقل الرابط العام تلقائياً عند النجاح. الحقل
  يبقى قابلاً للتعديل يدوياً كبديل/تجاوز، وفشل الرفع التلقائي لا يُسقط التدفّق — يُعرض
  تحذير ويُترك الحقل اليدوي متاحاً. أزرار "حفظ/إرسال للمراجعة" تُعطَّل أثناء الرفع
  (`isHostingVideo`) لمنع إرسال منشور قبل جهوزية الرابط.

اختبارات: مجموعة جديدة في `engine/tests/platform.foundation.test.ts` (9 فحوص نصية ثابتة:
وجود المسار، حراسته الصحيحة (تحرير محتوى لا owner)، إعادة استخدام `resolvePublicVideoUrl`،
لا نجاح بلا رابط، وجود `apiService.hostContentVideo`، الاستدعاء التلقائي داخل `onPickVideo`،
تعطيل الأزرار أثناء الرفع، وبقاء المسار اليدوي كبديل عند الفشل) — 9/9 ناجحة. تحقّق
TypeScript: فرق عدد الأخطاء قبل/بعد باستخدام `tsc --noEmit` (نفس منهجية Task #24/#25
الموثّقة، بسبب حظر `npm install` في بيئة التطوير): زيادة +12 خطأ، كلها من 4 فئات ضوضاء
أساسية قائمة أصلاً (process/Buffer بلا `@types/node`، implicit-any بلا `@types/react`)
وبنفس التناسب مع حجم الكود المُضاف — **صفر أخطاء `TS1xxx` تركيبية جديدة**.

**الحالة النهائية: مسار "فيديو واحد + تحديد المنصات + توليد + إرسال للمراجعة + اعتماد
واحد" صار آلياً بالكامل من طرف لطرف** بلا أي لصق رابط يدوي — الخطوة الوحيدة المتبقية
بيد المالك عمداً هي ضغطة الاعتماد/النشر الواحدة (بوابة حوكمة لا تُلغى أبداً).

## إصلاح جذر «حجم الطلب أكبر من الحد المسموح» عند رفع فيديو (حد النقل) — 2026-10-04

**الجذر المُثبت (لا تخمين):** الوسيط العام في `server.ts` (أول الواجهات) يطبّق
`express.json({ limit: "256kb" })` على كل المسارات، باستثناء مسار واحد فقط كان
`/api/platforms/youtube/content/drafts`. فكل مسار يستقبل `videoBase64` ولم يكن مُستثنى
يرفضه الوسيط بحالة **413 `PAYLOAD_TOO_LARGE`** (والرسالة العربية
«حجم الطلب أكبر من الحد المسموح.» مصدرها `engine/runtime/errorSafety.ts`) قبل أن يصل
إلى `validateMediaBytes`. فيديو 3MB يتحوّل إلى base64 ≈4MB، فيُرفض فوراً.

**الثلاثة مسارات المعطّلة فعلياً (كانت بلا محلّل خاص):**
- `POST /api/workspace/content/video/host` (استضافة رابط الفيديو العام متعددة المنصات —
  مسار «مركز صناعة المحتوى الذكي» الذي أبلغ عنه المالك؛ أُضيف في Task #25 follow-up).
- `POST /api/platforms/youtube/publish` (الرفع الحقيقي `videos.insert`).
- `POST /api/platforms/youtube/content/queue/:id/review` (إرفاق مادة لفيديو في عنصر الطابور).

**الإصلاح (حد النقل/الشبكة فقط):**
- `CONTENT_UPLOAD_PATHS` (مصفوفة: drafts/publish/video-host) +
  `CONTENT_UPLOAD_PATH_PATTERNS` (نمط `content/queue/:id/review`) صارت مصدر الاستثناء
  الواحد، بدل مسار واحد.
- كل مسار مُستثنى يمرّر **محلّل خاصاً به** `express.json({ limit: CONTENT_UPLOAD_JSON_LIMIT })`
  (20mb) — مطابق لأسلوب مسار drafts القائم. **إلزامي:** المسار المُستثنى من الوسيط العام
  بلا محلّل خاص = `req.body` غير معرّف؛ كل المسارات الأربعة الآن لها محلّل خاص.
- **الحد المنطقي للمادة يبقى كما هو:** `CONTENT_MEDIA_MAX_ITEM_BYTES = 12MB` للعنصر
  (`validateMediaBytes`/`registerContentMedia`)؛ فيديو >12MB يُرفض بـ**422 `MEDIA_TOO_LARGE`**
  برسالة واضحة، لا بـ413 شبكة غامض. (الواجهة تتحقق مسبقاً عند 12MB.)
- **الوسيط الأمني لم يُمَسّ:** `req.rawBody` (لتحقق توقيعات HMAC، نمط Meta/TikTok) يبقى
  كما هو لكل المسارات غير المُستثناة (حد 256kb مع `verify`). المسارات المُستثناة لا
  تحمل توقيعات webhook، فلا حاجة لـrawBody عندها.

**اختبار fail-old/pass-new:** `engine/tests/content.pipeline.integration.test.ts` المجموعة 15:
فيديو 4MB على `video/host` لا يُرفض 413 (يصل لمنطق Drive فيفشل 503 `DRIVE_NOT_CONFIGURED`
بلا Drive)، و`queue/review` بـ4MB => 200، و>12MB => 422 `MEDIA_TOO_LARGE`، ومسار غير
مُستثنى بـ300KB => 413 كما كان. **قبل الإصلاح: 7 إخفاقات (كلها 413 `PAYLOAD_TOO_LARGE`)؛
بعده: 140/140.** فحوص final-audit: `content-upload-route-limit` (موسّع)،
`content-upload-path-parser`، `content-upload-limit-test` (1368 إجمالاً).

## جذر فشل استضافة فيديو التسويق: رمز Drive مرفوض من Google + عيب إخفاء السبب (2026-10-08)

**العَرَض:** عند إرفاق فيديو واختيار platforms، تظهر رسالة حمراء عامة «فشل تجهيز رابط
الفيديو العام. يمكنك إعادة المحاولة أو لصق رابط فيديو عام يدوياً.» رغم أن مهمة مهلة Drive
(#21–#25) منشورة. وظهر لبس ثانٍ: `deploy.commit` في /api/health كان `c5ec98d` (أقدم من كل
مهام الفيديو) بينما `git` يقول إن الصور الأحدث مدفوعة.

**حسم اللبس (لا تخمين):** `c5ec98d` هو «Merge PR #21» (2026-10-07 21:43 UTC) وهو **سلف**
لكل مهام الفيديو (741ea87/c72bbce/1141955/a737bc6) — أي أنه لقطة من **نسخة قديمة أثناء
النشر** (Render يخدم إصداراً سابقاً لدقائق). بعد اكتمال النشر صار `deploy.commit=082daf9`
دقيقاً. **درس:** لا تستنتج فشل النشر من commit قديم فور الدفع؛ تحقّق بعد دقائق، واقرأ
`deploy.startedAt` (زمن إقلاع العملية) لتمييز النسخة العاملة فعلاً.

**الجذر الحقيقي المُثبت (من `/api/dr/health` الحي، لا من الواجهة):**
`refreshToken.providerRefresh=failed, reason=invalid_grant, httpStatus=400,
reauthorizationNeeded=true, nextAction=reauthorize_drive` — أي أن **Google رفض رمز تجديد
Drive المخزّن** (أُلغي/تغيّر العميل)، فيفشل تجديد رمز الوصول **قبل** أي طلب Drive، ولا تكتمل
الاستضافة. هذا إجراء مالك خارجي (إعادة ربط) لا يمكن للكود توليد رمز تجديد صالح بدلاً عنه.

**عيبا كود كانا يُخفيان السبب (أُصلحا):**
1. `tools/dr/drive-client.mjs`: استدعاء `authHeaders()`/`tokenProvider()` كان **خارج**
   `try` في `request()`، ففشل التجديد يرمي استثناءً يمرّ **قبل** `classifyDriveError`، فلا
   يُصنَّف ولا يُسجَّل (ولهذا `driveHostDiagnostics.recentCalls` كان فارغاً — الفشل وقع
   قبل محاولة النقل)، وينتج 502 عاماً. نُقل التجديد داخل `try`.
2. `classifyDriveError` لم يكن يعرف أكواد فشل المصادقة (`invalid_grant`) فوضعها تحت
   `network_error`. أُضيف تصنيف صريح `code='drive_reauth_required'`.
3. `server.ts` `resolvePublicVideoUrl`: تمييز `drive_reauth_required` برد **503
   `DRIVE_REAUTH_REQUIRED`** ورسالة قابلة للتنفيذ («أعد الربط بنقرة واحدة…») بدل الرسالة
   العامة المضلِّلة.

**القاعدة:** أي عملية خارجية تفشل **قبل** الوصول للمزود (تجديد رمز/مصادقة) يجب أن تُصنَّف
وتُعرض بسببها الحقيقي، لا كخطأ عام قابل لإعادة المحاولة. وفحص `/api/dr/health` هو الحكم
الصادق لحالة تفويض Drive، لا نص الواجهة.

**إجراء المالك:** «إعادة الربط بنقرة واحدة» من بطاقة النسخ الاحتياطي السحابي بحساب Google
نفسه (يولّد رمز تجديد صالحاً جديداً) ثم إعادة رفع الفيديو.

اختبار: `dr.video.public.hosting.test.ts` +4 فحوص (فشل التجديد يُصنَّف ولا يرمي، في
`request` وفي `publishVideoPublicly`). final-audit: 1392 فحصاً (`drive-reauth-*`،
`deploy-started-at-exposed`).

## إصلاح فشل النشر الموحّد (Facebook/Instagram/Threads) + خدمة الفيديو من الخادم (2026-10-05)

**الجذران المُثبتان (لا تخمين):**
1. **إخفاء خطأ Meta الحقيقي.** كان `executePlatformPublish` يثبّت الكود للمنصتين:
   Instagram يعيد `MEDIA_REQUIRED` دائماً، وThreads يعيد `PROVIDER_ERROR` دائماً، بلا
   اعتبار لرسالة Meta الفعلية. فإذا كان الخطأ الحقيقي «تعذّر تنزيل الفيديو من الرابط
   العام» (Meta 9007) ظهر للمالك كأنه «لا وسائط» — تشخيص مضلِّل يمنع إصلاح السبب.
2. **رابط Drive العام غير صالح لسحب Meta.** كان مسار الاستضافة يعيد رابط
   `drive.google.com/uc?export=download`، وDrive قد يُعيد صفحة HTML وسيطة (فحص
   الفيروسات) لا بايتات فيديو خام عند سحبه من خوادم Meta — فيفشل إنشاء الحاوية رغم أن
   الرابط يعمل في المتصفح. (المسار الموحّد يرفض YouTube عن قصد: يحتاج بايتات فعلية عبر
   `videos.insert`، ويوجّهه بـ`PLATFORM_USE_DEDICATED_PUBLISH` إلى طابوره المخصص.)

**الإصلاح:**
- `engine/social/instagram.ts` و`threads.ts`: `InstagramResult`/`ThreadsResult` يحملان
  `code?` و`providerCode?` (كود Meta الخام)، و`classifyInstagramProviderError`/
  `classifyThreadsProviderError` يميّزان `MEDIA_DOWNLOAD_FAILED` (خطأ تنزيل وسائط، 9007)
  عن `CLIENT_ERROR`/`NETWORK_ERROR`. **الرسالة الحقيقية تُمرَّر كما هي دائماً.**
- `server.ts`: فرعا Instagram/Threads يمرّران كود المزود الحقيقي؛ `MEDIA_REQUIRED` يبقى
  فقط عند غياب الوسائط فعلاً (`!imageUrl && !videoUrl`) لا ككود ثابت.
- **خدمة الفيديو من الخادم (إصلاح جذري لرابط Meta):** `GET /api/public/video/:ref`
  يخدم البايتات الحقيقية بنوع محتوى صحيح و**دعم Range (206)** — وهو ما يتطلبه سحب Meta.
  الوصول موقّع بـHMAC على معرّف المادة (لا تخمين روابط)، والبايتات من ذاكرة الخادم.
  `resolvePublicVideoUrl` يعيد الآن رابط الخادم المضمون، ورفع Drive صار **أفضل-جهد**
  بمهلة صريحة (لا يُسقط الاستجابة عند تعثّره).
- `src/utils/publishResult.ts`: الواجهة تعرض **الكود والرسالة معاً** (لا إخفاء لأحدهما)،
  وتُميّز YouTube بأنه يُنشر عبر طابوره المخصص لا «فشل».
- **إصلاح فحوص قديمة:** أُزيلت 42 خطأ `tsc` كامنة على `main` (تضييق أنواع `DriveClient`):
  واجهة `DriveClientLike` مُعلَنة + `settleWithTimeout` للتأكيد، و`ResolvedPublicVideo`
  بشكل موحّد — كانت `npm run lint` حمراء على المنشور بلا أن يُلتقط.

اختبارات: `publish.provider.error.test.ts` (18 فحصاً)، و`dr.video.host.timeout.integration.test.ts`
(26 فحصاً: رابط الخدمة الموقّع، Range=206، توقيع مزوّر=403)، وتحديث
`content.pipeline.integration.test.ts` (الاستضافة تنجح بلا Drive). فحوص final-audit
الجديدة: `publish-real-error-not-fixed-code`، `instagram-threads-error-classifier`،
`publish-ui-shows-code-and-message`، `content-server-streams-video-with-range`،
`video-host-prefers-server-url`، `publish-provider-error-tests`، `video-host-streams-tested`
(1392 إجمالاً). `npm run lint` (0) + `build` + `npm test` (EXIT 0) + `final-audit` ناجحة.

**خصوصية النقطتين العامتين (تأكيد):** الإصلاح السابق (commit `8825a67`، داخل المنشور
`080f44d`) يمنع تسريب بيانات العملاء من `/api/health` و`/api/readiness` عبر
`engine/social/healthPrivacy.ts` (allow-list صارم + حجب) و`watcherStatusBlockPublic`
(`attentionRequired`/`lastReply`/`replyText` متاحة للمالك فقط عبر `/api/agent/youtube/watcher`).
تحقق حي: النقطتان تُعلنان الحقول التقنية فقط (status/watcherActive/pollCount/lastError)
بلا أي اسم حساب أو نص تعليق أو نص رد.

## دورة حياة رمز Threads: التجديد القسري عند رفض المزود + تمرير أكواد Meta الحقيقية (2026-10-04)

**الجذر المُثبت (T1):** `isAccessTokenExpired({ expiresAt: null })` يُعيد `false` (لا انتهاء
معلن)، فحساب Threads مربوط **قبل** تخزين `expiresAt` يُمرَّر رمزه كما هو بلا تجديد، ثم يرد
Meta بـ**190 «Session has expired»**. الأسوأ: كان الفشل يتكرّر صامتاً بلا أي محاولة تجديد،
ولا يُعلن `reauth_needed`، فيبدو الحساب متصلاً وهو معطّل فعلاً.

**الإصلاح (بلا ادّعاء ولا تكرار صامت):** أُضيف تجديد قسري واحد عند رفض المزود فعلياً:
- `server.ts`: `forceRefreshThreadsToken()` يفصل التجديد عن الحكم القبلي، و`markThreadsReauthNeeded()`
  يعلن `reauth_needed` صراحةً (يحفظ عبر `persistStateDurable` ويسجّل تدقيقياً).
- `withThreadsToken`: بعد المحاولة الأولى، إن فشلت بـ`TOKEN_EXPIRED` ولم يكن الرمز قد جُدِّد
  قبلاً ⇒ تجديد قسري واحد ثم **إعادة محاولة واحدة**؛ نجاح التجديد ⇒ النشر ينجح بمعرّف منشور
  حقيقي من Meta؛ فشل التجديد ⇒ `reauth_needed` + كود 190 الحقيقي (لا بقاء على `connected`).
  وحتى الرمز المُجدَّد إن رُفض ⇒ `reauth_needed` (لا تكرار صامت). لا حلقة، ولا أكثر من محاولتين.

**الإصلاح (T2 — أكواد الأخطاء الحقيقية):** كل موصلات Meta (Instagram/Facebook/Threads) تُمرّر
الآن الحقول التشخيصية الكاملة من Meta بدل كود ثابت مُضلِّل:
- `providerCode` (error.code) + **`providerSubcode`** (error.error_subcode) + **`providerTraceId`**
  (error.fbtrace_id) — تُعاد في استجابة النشر الموحّد `/api/platforms/:platform/publish`
  للـFacebook وInstagram وThreads. `facebook.ts` صار يوفّر `logAndExtractFacebookError`
  (تسجيل كامل بلا قطع + إرجاع الحقول)، و`instagram.ts` يعيد استخدام
  `extractFacebookGraphError`/`formatFacebookGraphError` (نفس تطبيق Meta، بلا ازدواج منطق).
- `threads.ts`: `providerSubcode` + `logThreadsError` (سطر `[threads-graph-error]` آمن بلا سرّ)،
  وكل مسارات الفشل تُمرّر subcode/trace.
- **لا سرّ في أي سجل أو استجابة**: المعرّف/الرسالة فقط، بلا رمز أو client secret.

**اختبار الانحدار (fail-old/pass-new):** `engine/tests/threads.publish.recovery.test.ts`
(`npm run test:threads-recovery`، 15 فحصاً، خادم Threads وهمي محلي): سيناريو (أ) فشل التجديد
⇒ `TOKEN_EXPIRED` + كود 190 + `reauth_needed` (لا بقاء على connected)؛ سيناريو (ب) نجاح
التجديد ⇒ إعادة محاولة تلقائية تنشر بمعرّف `POST_1` حقيقي مع بقاء الاتصال. **أُثبت فشل
الاختبار قبل الإصلاح** (6/15 يفشل: `refreshCalls=0`، لا reauth_needed، فشل النشر) ونجاحه بعده.
`publish.provider.error.test.ts` صار **35 فحصاً** (يثبت تمرير subcode/traceId لـIG/FB/Threads).

**لم يُمسّ:** Gemini/الـfirewall، OAuth/scopes، المصادقة، قاعدة البيانات، بقية المنصّات
(Telegram/TikTok/YouTube)، ونموذج الجدولة. لا تدوير لأي مفتاح، ولا سرّ جديد.

## تشخيص #100 قابل للسحب + فحص صلاحية نشر فيديو الصفحة (Facebook) — Real Root Cause (2026-10-08)

**جذر المشكلة المؤكَّد (لا تخمين):** خطأ Meta «(#100) No permission to publish the video»
على `POST /{page-id}/videos` يظهر لأن نشر **الفيديو** على الصفحة يتطلب صلاحية
`pages_read_engagement` إضافة إلى `pages_manage_posts` (وثيقة Meta — Page Videos)، بينما
نشر **النصّ** عبر `/feed` يكتفي بـ`pages_manage_posts`. صفحة لا تمنح `pages_read_engagement`
ينجح عندها النصّ ويفشل الفيديو بـ#100. الكود سليم (يستخدم Page Access Token و`file_url`)،
والعائق إعداد صلاحيات لدى Meta يحتاج جلسة المالك.

**الفجوة الحقيقية التي أُصلحت (قابلة للإصلاح برمجياً):** رسالة Meta الكاملة + `error.code`
+ `error_subcode` + `fbtrace_id` كانت تُسجَّل في سجلات Render فقط، فتفنى مع العملية ولا
يمكن سحبها. لا سجل أخطاء محفوظ، ولا وسيلة للمالك لمعرفة الصلاحية الناقصة.

**الإصلاح:**
- `engine/social/publishing.ts`: `PublishRecord` يحمل الآن `code`/`providerCode`/
  `providerSubcode`/`providerTraceId`، و`buildPublishRecord` يمرّرها.
- `server.ts`: مسارات Facebook/Instagram/Threads تُحفظ بها رسالة المزود الكاملة + الأكواد
  في `workspace.publishRecords` عبر محوّل الحالة (تصمد بعد restart/cold start). فشل إنشاء
  حاوية Instagram (مصدر `CLIENT_ERROR: Invalid parameter`) يُحفظ أيضاً.
- مسار owner جديد `GET /api/platforms/publish-diagnostics?platform=&state=&limit=` يُرجع
  السجلات الفاشلة برسالة المزود الكاملة وأكوادها بلا أي سرّ — بدل الاعتماد على سجلات Render.
- `engine/social/facebook.ts`: `debugToken(inputToken, appAccessToken)` يفحص
  `GET /debug_token` ويعيد `is_valid`/`scopes`/`missingPublishScopes` (الصلاحيات الناقصة
  من `pages_manage_posts`+`pages_read_engagement`+`pages_show_list`).
- مسار owner جديد `GET /api/platforms/facebook/video-permission-diagnosis`: يعرض
  الصلاحيات الممنوحة فعلاً والناقصة و`videoPublishReady` + السبب الدقيق. لا يكشف أي رمز/سرّ.

**إجراء المالك (إلزامي، لا ينفّذه أي وكيل — يحتاج جلسته على Meta):**
1. افتح `/api/platforms/facebook/video-permission-diagnosis` (بجلسة المالك) بعد النشر.
2. إن ظهرت `pages_read_engagement` في `missingVideoPublishScopes`: أضفها لـUse Case/Configuration
   في Meta App Dashboard، ثم أعد التفويض (تسجيل خروج/دخول عبر «بدء الربط») لتُضمَّن في الرمز.
   Advanced Access لهذه الصلاحية قد يحتاج App Review (وضع Live).
3. إن فشل الفيديو رغم اكتمال الصلاحيات: الخطأ الكامل + fbtrace_id صار في
   `/api/platforms/publish-diagnostics` — قدّمه لدعم Meta مع fbtrace_id.

**اختبار:** `facebook.connector.test.ts` = **277 فحصاً** (المجموعة 23: نشر فيديو يرد #100
بحقوله الحقيقية => يُحفظ => يُسحب من المسار المحمي بلا سرّ => يصمد بعد restart؛ وفحص
`debug_token` يكشف `pages_read_engagement` الناقصة). فحوص final-audit الثلاثة الجديدة:
`facebook-publish-diagnostics-persisted`، `facebook-video-permission-diagnosis`،
`facebook-publish-diagnostics-test` (**1407 إجمالاً**).

**لم يُمسّ:** Gemini/الـfirewall، OAuth/scopes، المصادقة، قاعدة البيانات، DR/الاستعادة،
المنصّات الأخرى، والنقطتان العامتان `/api/health` و`/api/readiness` (بلا حقول حساسة).

## واجهة تشخيص نشر فيديو Facebook (owner-only) — Batch (2026-10-08)

**الفجوة الحقيقية:** المساران `GET /api/platforms/facebook/video-permission-diagnosis`
و`GET /api/platforms/publish-diagnostics` كانا مبنيَّين في الخادم **فقط** بلا أي واجهة،
فلا يستطيع المالك استدعاءهما إلا بأدوات تقنية (curl) — غير عملي من الهاتف.

**الإصلاح (واجهة فقط، بلا أي تغيير في منطق الخادم أو الأسرار أو المنصات):**
- `src/services/api.ts`: دالتان جديدتان `getFacebookVideoPermissionDiagnosis()` و
  `getPublishDiagnostics({platform?,state?,limit?})` تمرّران `getAuthHeaders()` (نفس آلية
  التوكن المستخدمة أصلاً) وتصرّحان النوع.
- `src/components/social/PlatformConnectionCenter.tsx`: مكوّن
  `FacebookVideoDiagnosticsPanel` داخل بطاقة Facebook، بزرّين: «فحص صلاحيات نشر الفيديو»
  و«سجل تشخيص النشر الفاشل». يعرض بالعربية: الصلاحيات الممنوحة، الناقصة (مع تفسير
  `pages_read_engagement` كإلزامية لنشر الفيديو)، وهل النشر جاهز (`videoPublishReady`)؛
  وسجل الأخطاء (المنصة، الرسالة الكاملة، `code`/`subcode`/`fbtrace`). اللوحة داخل مركز
  الربط المحصور بالمالك (`currentUser?.role !== 'owner'`) وتُعرض لبطاقة facebook فقط.
  لا تدّعي إصلاح الصلاحية ولا أي نشر (المسار تشخيصي).

**اختبارات:** `engine/tests/facebook.video.diagnostics.ui.test.ts`
(`npm run test:facebook-video-diagnostics-ui`، 25 فحصاً، موصول بـ`npm test`)، وe2e حقيقي
`engine/e2e/facebook-video-diagnostics.e2e.spec.ts` (Playwright/Chromium: يفتح مركز الربط
بجلسة مالك، يضغط الزرّين، يثبت ظهور النتيجة العربية، ويتحقق أن الطلبين الحقيقيين يحملان
ترويسة Authorization). فحوص final-audit الستة الجديدة: `facebook-diagnostics-ui-buttons` …
`facebook-diagnostics-ui-tests` (**1413 إجمالاً**).

**لم يُمسّ:** منطق الخادم، Gemini/الـfirewall، OAuth/scopes، المصادقة، قاعدة البيانات،
DR/الاستعادة، بقية المنصّات، والنقطتان العامتان `/api/health` و`/api/readiness`.
**يبقى مفتوحاً (إجراء خارجي):** منح `pages_read_engagement` من لوحة Meta — لا يُصلحه الكود.

## إصلاح تسريب بيانات العملاء في النقطتين العامتين + انتظار جاهزية حاوية الوسائط عند النشر (2026-10-05)

### جزء 1 — خصوصية `/api/health` و`/api/readiness` (تأكيد + حرس)
النقطتان عامتان بلا مصادقة (لأدوات المراقبة مثل Render)، وكانتا قد كشفتا سابقاً حقولاً
حساسة (`youtubeWatcher.attentionRequired[]` بأسماء حسابات ونصوص تعليقات، و`lastReply.replyText`
بنصوص ردود فعلية). المعالجة القائمة والمؤكَّدة الآن:
- `engine/social/healthPrivacy.ts` هو المصدر الواحد لقائمة الحقول الممنوعة
  (`PUBLIC_ENDPOINT_FORBIDDEN_CUSTOMER_FIELDS` = replyText/attentionRequired/authorName/
  lastReply/text/customerName...) وقائمة allow-list لكتلة `youtubeWatcher` العامة، مع
  `sanitizePublicHealthPayload` و`findForbiddenPublicKeys` و`findDisallowedWatcherPublicKeys`.
- `server.ts` يعرض بديلاً محلياً `watcherStatusBlockPublic` في `/api/health` و`/api/readiness`
  يعلن حقولاً تقنية فقط (`status/watcherActive/cadenceMinutes/cadenceMs/pollCount/lastPollAt/
  lastError/consecutiveErrors`)، و`lastError` يمر عبر `watcherPublicError` (رسالة تقنية قصيرة
  مثل «connection timeout» بلا نص محادثة عميل، وإلا «connection error»). التفاصيل الكاملة
  (`attentionRequired/lastReply/counters/opportunities/brief/followUp`) في المسار المحمي
  `/api/agent/youtube/watcher` (owner فقط). وتُطبَّق `sanitizePublicHealthPayload` قبل إرسال
  `/api/health` و`/api/readiness`.
- الحرس مُختبَر: `engine/tests/health.guard.test.ts` (وحدة) و`engine/tests/health.privacy.test.ts`
  (تكامل: `/api/health` و`/api/readiness` بلا مصادقة لا يحملان `replyText`/`attentionRequired`/
  `authorName`/`text` في أي عمق) + فحص final-audit `health-no-customer-data-regression`.

### جزء 2 — جذر نشر وسائط Instagram/Threads (CLIENT_ERROR: Invalid parameter)
- الجذر المُثبت: نشر الفيديو/الصورة عبر Instagram وThreads غير متزامن؛ بعد إنشاء الحاوية
  تبقى `IN_PROGRESS` حتى يفرغ Meta من تنزيل الوسائط ومعالجتها. `media_publish` قبل `FINISHED`
  يرد Meta بخطأ معلمة غير صالحة (#100/Invalid parameter). وكان الكود يُبقي `getContainerStatus`
  معرّفة لكنها غير مستدعاة إطلاقاً، فينشر مباشرةً.
- الإصلاح (مصدر واحد): `INSTAGRAM_CONTAINER_READY_STATES`/`isInstagramContainerReady`/
  `isInstagramContainerFailed` في `engine/social/instagram.ts`، ونظيرها في `engine/social/threads.ts`.
  و`createInstagramContainerReady`/`createThreadsContainerReady` في `server.ts` ينشئان الحاوية
  ثم ينتظران فعلياً `status_code/status` حتى `FINISHED`/`PUBLISHED` (والنص جاهز مباشرةً)،
  وبعدها فقط `media_publish`. الحالة الفاشلة (`ERROR`/`EXPIRED`) تُعلن بفشل صريح بلا نشر،
  وتجاوز المهلة (`CONTAINER_TIMEOUT`) يُعلن بلا نشر — لا ادعاء تسليم بلا معرّف مزود.
- الانتظار محدود وقابل للضبط: 8 محاولات كحد أقصى، والفاصل من `CONTAINER_POLL_INTERVAL_MS`
  (افتراضي 3000ms؛ 0 في الاختبار) — موثّق في `.env.example`.
- تمييز MEDIA_REQUIRED: لا يُعلن إلا عند غياب الوسائط فعلاً (`!imageUrl && !videoUrl &&
  code === "MEDIA_REQUIRED"`)؛ وإلا يُمرَّر كود Meta الحقيقي (502) بلا إخفاء السبب.
- لوحة الموافقة: تعرض مصير كل منصة على حدة (`platformPublishResults` عبر
  `formatPlatformResultState`: نُشر وثُبّت بمعرّف المزود / قيد المعالجة / فشل بسببه /
  توجيه YouTube لطابوره) بدل رقم أخضر إجمالي واحد يُخفي فشل بعض المنصات.

اختبارات: `instagram.connector.test.ts` = 228 فحصاً (وحدة لحالات الجاهزية، وتكامل
مجموعة 16ب: `IN_PROGRESS→FINISHED` => نشر ناجح بعد قراءتين، `ERROR` => `CONTAINER_FAILED`
بلا نشر)، `threads.publish.recovery.test.ts` = 15 فحصاً (خادم Threads يخدم حالة الحاوية)،
و`publish.provider.error.test.ts` = 41 فحصاً (تمييز مصير كل منصة في الواجهة).
فحوص final-audit الجديدة: `media-container-readiness-single-source`،
`publish-waits-for-container-ready`، `container-wait-bounded-and-testable`،
`container-readiness-tests`، `approval-per-platform-results-panel` (1422 إجمالاً).

لم يُمسّ: Gemini/firewall، OAuth/scopes، المصادقة، قاعدة البيانات، DR/الاستعادة،
بقية المنصات، ومسارات الصحة العامة (بقيت بلا بيانات عملاء).

## تدقيق موحّد للمنصات العشر + إصلاح فجوة وسيط صورة فيسبوك — منشور (`d8241fd`، 2026-10-09)

**المشهد (مثبت حياً على الإنتاج بعد النشر):** استدعاء النشر الموحّد يوزّع على المنصات
العشر عبر `executePlatformPublish` مع `Promise.allSettled` (عزل فشل كل منصة). الموصلات
الحقيقية الست (Facebook/Instagram/Threads/Telegram/TikTok/YouTube) تُنفّذ فعلاً وتُرجع
معرّف مزود حقيقي؛ والمنصات الأربع غير المنفّذة تُعلن كوداً صادقاً مميزاً لا يُخفى:
`x`/`snapchat`/`google_business` ⇒ `EXTERNAL_SETUP_REQUIRED`، و`whatsapp` ⇒
`CAPABILITY_NOT_SUPPORTED`. لا `NOT_CONNECTED` مضلِّل، ولا نشر بلا معرّف مزود.

**الإصلاح الجذري (الفجوة الوحيدة المؤكدة):** فرع النشر الموحّد لفيسبوك كان يتجاهل
`imageUrl` صامتاً فينشر نصاً بلا الصورة. الآن:
- `engine/social/facebook.ts`: `buildPublishPhotoBody` + `FacebookClient.publishPhotoToPage`
  (`POST /{page-id}/photos` عبر `url` العام) بنفس صلاحية `pages_manage_posts` (بلا صلاحية جديدة).
- `server.ts`: فرع فيسبوك واعٍ بالنوع — فيديو `/videos` (`file_url`) / صورة `/photos` (`url`)
  / نص `/feed` — ويُعلن `mediaKind` الصحيح في الإيصال.
- `engine/tests/helpers/facebookMock.ts`: مسار `photos` + حالة `photos[]`.

**اختبار موحّد جديد `engine/tests/publish.all-platforms.test.ts` (`npm run test:all-platforms`،
40 فحصاً):** العشر معاً + كل منصة منفردة، نتيجة مستقلة لكل منصة، عزل الفشل، كل منصة على مسار
نوعها الصحيح، `anyDelivered=false` بلا تسليم، لا معرّف مختلق، لا تسريب سرّ، بلا مزود/حصة
(خوادم Meta/Threads/TikTok/Telegram وهمية محلية). فحوص final-audit الجديدة:
`facebook-photo-publish-separate-path`, `all-platforms-content-type-fidelity`,
`all-platforms-multi-publish-isolation`, `all-platforms-no-connector-honest-codes`,
`all-platforms-integration-test` (1427 إجمالاً).

**تأكيد حي للإنتاج (`d8241fd`):** `/api/health` و`/api/readiness` العامّتان (بلا مصادقة)
تُظهران حالة مراقبة تقنية فقط (`status/watcherActive/pollCount/lastError/consecutiveErrors`)
ولا تحملان `replyText`/`attentionRequired`/`authorName`/`lastReply`/`commentText` إطلاقاً؛
البيانات المفصّلة تبقى في `GET /api/agent/youtube/watcher` للمالك.

**حالة المنصات على الإنتاج (صادقة):** Facebook موصول موثق (8 صلاحيات، `business_management`)،
Instagram موصول موثق (Configuration ID مضبوط `configurationReady=true`، onboarding معطّل)،
YouTube موصول موثق، Telegram/TikTok مهيّأ (`READY_TO_CONNECT`)؛ X/Snapchat/Google Business/
WhatsApp بلا موصل منفّذ. **لا يمكن لأي وكيل برمجي إتمام handshake خارجي نيابةً عن المالك**
(موافقة OAuth على شاشة المزود، أو ضغط «موافقة واعتماد» داخل جلسة المالك).

## تشخيص ارتباط تطبيق Facebook بحافظة الأعمال + حسم «حدث خطأ ما» (2026-10-09)

**العطل المعروض:** «Sorry, something went wrong» قبل/خلال ربط Facebook/Instagram OAuth.

**الفحص الكامل للمنطق (لا انحراف عن الموثّق):** أُعيد فحص `oauth/start` و`oauth/setup`
و`engine/social/facebook.ts` و`engine/social/oauth.ts`:
- `metaScopeWithoutConfigOverride()` لا يزال افتراضه **السماح** (يرفض الحجب إلا بـ
  `META_ALLOW_SCOPE_WITHOUT_CONFIG=false`)، فلا حجب من كودنا افتراضياً.
- بوابة `META_BUSINESS_LOGIN_REQUIRES_CONFIG_ID` (409) لا تُطلق إلا عند
  `businessLoginSurface===true` **مع** `META_ALLOW_SCOPE_WITHOUT_CONFIG=false` صراحةً —
  غير مُفعّلة افتراضياً.
- `buildAuthorizationParams` لـFacebook يبني الرابط الصحيح (`client_id`+`response_type=code`
  +`redirect_uri`+`state`+`scope` بفواصل)، وعند `config_id` صالح يحلّ محل `scope` تماماً.
- كل الصلاحيات الثمانية لـFacebook (والعشر لـInstagram) محسومة باعتمادياتها الرسمية
  (`resolveFacebookScopes`/`resolveInstagramScopes`).

**الدليل الحي (read-only، بلا تسجيل دخول):** قاعدة الفحص الكامل (بلا كوكيز) تتوقف عند شاشة
الدخول في كل الحالات، فلا تميّز نجاحاً من فشل. أُعيد إنتاجه للمعرّفين الحقيقيين:
- `1879571969871804` (تطبيق المعرض) و`1060341853401123` (وكيل الغرابي الذكي) ومرجعي
  `145634995501895` — بوكيل جوال حقيقي على `www.facebook.com/v21.0/dialog/oauth`:
  كلها تُعيد `302 → m.facebook.com/login.php` مع `is_business_login=1` بلا رفض.
- أربع حالات (بلا scope / `config_id` / مع scope / config_id+scope) تعطي السلوك **نفسه**
  قبل الدخول. **لا رفض قبل تسجيل الدخول** لأي منها.

**الخلاصة القاطعة:** لا مصدر لـ«حدث خطأ ما» قبل الدخول في الكود ولا في رابط التفويض
(كل الحالات تصل إلى `login.php`). فالأرجح أن الرفض يقع **بعد** مصادقة المالك (نطاق لا
يراه أي فحص بلا كوكيز)، أو أنه إجراء استخدام من واجهة قديمة. **لا فجوة كود أُثبتت** —
بعد إصلاح 2026-10-05 (إزالة الحجب الكاذب) يعمل الربط فعلاً برموز موثّقة (الإنتاج:
`userAccessTokenStored`+`pageAccessTokenStored`، Facebook وInstagram موصولان موثقان).

**حقيقة موثّقة (لا اختراع):** عقدة Graph `GET /{app-id}` — بحسب وثيقة Meta الرسمية
(Graph API App reference) — **لا تحمل حقل `business` إطلاقاً**. الحقول الحقيقية تتضمن
`id/name/company/app_domains` (و`company` نصّي حرّ يكتبه المطوّر ولا يُثبت ارتباطاً).
لذلك المسار التشخيصي يُعلن `businessFieldOnAppNode:false` بصراحة ولا يقرأ حقلاً غير موجود.

**المسار التشخيصي الجديد (owner فقط، قراءة-فقط):**
`GET /api/platforms/facebook/business-link-diagnosis` — يستدعي Graph فعلياً:
`GET /{app-id}?fields=id,name,company,app_domains` برمز `client_id|client_secret` (يثبت
صحة بيانات التطبيق؛ نفس إثبات `client_credentials` المستخدم في `oauth/start`)، ويعرض
حالة Configuration ID، والصلاحيات المحسومة، وأسماء متغيّرات البيئة، والإجراء الخارجي
الموثّق. لا يُعاد أي سرّ ولا يُحجب أي سلوك قائم. دالة جديدة في `engine/social/facebook.ts`:
`FacebookClient.getAppNode`.

**إجراء المالك الموثّق (لا ينفّذه أي وكيل):** لإتمام Facebook Login for Business وإنشاء
Configuration ID يلزم أن يكون التطبيق **أصلاً من أصول حافظة الأعمال**: Meta Business Suite
→ Settings → Accounts → Apps → Add app → أضف تطبيق «معرض الغرابي -صفحات». عندها فقط تظهر
صفحة `Facebook Login for Business → Configurations` وتُنسخ معرّفتها إلى
`FACEBOOK_LOGIN_CONFIG_ID`. (المصدر: help/2199735813629697 «Add an app to your business
portfolio»). ارتباط التطبيق بحافظة يُثبت عكسياً عبر `GET /{business-id}/owned_apps` (يتطلب
جلسة إدارة أعمال).

اختبارات: `facebook.connector.test.ts` = **300 فحصاً** (المجموعة 5ب: 401 بلا جلسة، 403
لغير المالك، إثبات صحة بيانات التطبيق، إعلان غياب حقل business، عدم الاختراع، والحالة
الافتراضية المسموحة). فحوص final-audit الجديدة: `facebook-business-link-diagnosis-route`,
`facebook-app-node-real-read`, `facebook-business-link-reverse-route-documented`,
`facebook-business-link-diagnosis-no-block`, `facebook-business-link-diagnosis-test`
(**1432 إجمالاً**). `npm run lint` ✅ · `npm run build` ✅ · `npm test` ✅ (113 كتلة PASSED،
0 فشل).

## حسم مطلب ربط تطبيق Facebook بحافظة الأعمال + تناقض «لا تملك هذا التطبيق» (2026-10-09)

**السؤال:** كيف تُربط تطبيق (App) بحافظة أعمال (Business Portfolio) برمجياً، وما سبب رفض واجهة
Business Suite بـ«لا تملك هذا التطبيق» رغم ظهور Administrator، وهل للـ«ملف الشخصي الإضافي» دور؟

### 1) المسار البرمجي الرسمي (موثّق من Graph API Reference — لا تخمين)
| العملية | الطلب | المعامل | الصلاحية |
|---|---|---|---|
| إضافة تطبيق **عميل** للحافظة | `POST /{business_id}/client_apps` | `app_id` (Required) | `business_management` |
| تمليك التطبيق للحافظة | `POST /{business_id}/owned_apps` | — | `business_management` |
| قراءة تطبيقات الحافظة | `GET /{business_id}/owned_apps` | — | `business_management` |

كلها تحتاج **رمز مستخدم (User Access Token) أو System User Token بصلاحية `business_management`
صادراً من شخص يملك إدارة الحافظة**. **مهم:** هذان المساران **لا يتجاوزان** تناقض «لا تملك
التطبيق»، لأن سبب الرفض هو **هوية المستخدم** لا غياب الصلاحية.

### 2) سبب «لا تملك هذا التطبيق» رغم ظهور Administrator
الواجهة تتطلب أن يكون **المستخدم المُصادق الحالي** هو مالك التطبيق/أحد أدمنه بالمعرّف الفعلي.
الأرجح (متوافق مع شكوى المالك): **الملف الشخصي الإضافي على فيسبوك (Facebook Profiles) يحمل
معرّف مستخدم (User ID) مختلفاً فعلاً**، ودور Administrator مربوط بالمعرّف الأصلي لا بالملف
الإضافي. فالمعرّف المُدرَج أدمن ليس هو من يفتح Business Suite حالياً ⇒ رفض. (منصة الأعمال/أدوات
المطوّرين قد لا تُدار بكامل الوظائف من ملف إضافي.)
- **إثبات عدم التطابق:** `GET /{app-id}/roles` يكشف **معرّف المستخدم الفعلي** المدرَج أدمن؛
  يُقارَن بمعرّف المستخدم الذي تفتح به business.facebook.com.
- **الحلول:** تسجيل الدخول بالحساب/الملف الذي معرّفه يساوي المعرّف المُدرَج أدمن (الحساب
  الأصلي أولى من الملف الإضافي)؛ ثم خروج/دخول كامل وانتظار تزامن الأدوار؛ وإن تكرّر الرفض مع
  تطابق المعرّف فـ Business Support Home → «Business Manager admin dispute/claim».
- **إصلاح مرتبط آخر:** فشل حفظ عام عند إضافة أصول عادة سببه طلب **2FA داخلية** تُخفيها Meta
  خلف نفس الرسالة العامة → أكمل 2FA ثم أعد المحاولة.

### 3) التشخيص القراءة-فقط (موجود في المسار المحمي owner فقط — لا ينفّذ أي ربط)
وُسّع `GET /api/platforms/facebook/business-link-diagnosis` بثلاث قراءات Graph إضافية:
- `appRoles` (`GET /{app-id}/roles`) — معرّف المستخدم الفعلي المدرَج أدمن + `adminUserIds`.
- `userBusinesses` (`GET /me/businesses?fields=id,name,permitted_roles`) — الحافظات التي
  يراها **رمز المستخدم المخزّن** (يثبت هوية الحساب؛ لا يُعاد الرمز).
- `businessOwnedApps` (`GET /{business-id}/owned_apps`) — إثبات عكسي: هل تطبيقنا ضمن الحافظة؟
  يتطلب `FACEBOOK_BUSINESS_ID` (اختياري) + رمز بصلاحية `business_management`.
- `documentedOwnerAction.graphApiAlternatives` + `youDontOwnThisApp` + `twoFactorFix` — توثيق
  المسارين الرسميين والحلول، بصراحة `executesAutomatically:false`. **لا يُنفَّذ أي ربط.**

### 4) الخلاصة
- الربط البرمجي **ممكن رسمياً** لكنه **بنفس شروط واجهة Business Suite** (مستخدم يملك إدارة
  الحافظة + مالك للتطبيق بالمعرّف) ⇒ **لا يتجاوز** تناقض الهوية.
- الحل الجذري **إجراء المالك**: تسجيل الدخول بالحساب/الملف ذي المعرّف المطابق للمدرَج أدمن،
  ثم الإضافة من Business Suite (أو استدعاء `client_apps` برمز ذلك المستخدم)، أو فتح نزاع
  إداري مع Meta إن تطابق المعرّف وبقي الرفض. لا يوجد حل برمجي خالص.

اختبارات: `facebook.connector.test.ts` = **309 فحصاً** (المجموعتان 5ب/5ج: أدوار المطوّر،
الحافظات، الإثبات العكسي، والتوثيق — على خادم وهمي عبر `FACEBOOK_GRAPH_API_BASE`).
فحوص final-audit الجديدة: `facebook-app-roles-read`, `facebook-user-businesses-read`,
`facebook-business-owned-apps-probe`, `facebook-you-dont-own-this-app-documented`,
`facebook-graph-api-link-alternatives-documented`, `facebook-biz-diag-read-only-no-post`
(بـ`FACEBOOK_BUSINESS_ID` موثّق في `.env.example`/`render.yaml`). `npm run lint` ✅ ·
`npm run build` ✅ · `final-audit` ✅ (**1438** فحصاً).
