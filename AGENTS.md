# AGENTS.md — دليل عمل وكلاء الذكاء الاصطناعي على مشروع الغرابي AI

## الهوية والنطاق
- المشروع: `al-gharabi-ai` — مساعد ذكي مركزي متعدد المنصات لمعرض الغرابي للتقسيط.
- الهدف الحالي: بناء «مدير سوشيال ميديا ذكي» يدير دورة السوشيال ميديا (تحليل → تخطيط → محتوى → نشر → تعليقات → تحليل → تعلّم).
- هذا المشروع **ليس ERP**. لا تُضاف وحدات مخازن/مبيعات/عقود/أقساط/مشتريات/تحصيل كتوسعة ERP.
- اقرأ `GHARABI_PROJECT_RULES.md` قبل أي تعديل؛ فهو المصدر الملزم للقواعد.

## أوامر البناء والاختبار
```bash
npm install
npm run dev            # tsx server.ts
npm run lint           # tsc --noEmit
npm run build          # vite build + esbuild server.ts -> dist/server.cjs
npm run final-audit    # node final-audit.mjs (37 فحصاً)
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
