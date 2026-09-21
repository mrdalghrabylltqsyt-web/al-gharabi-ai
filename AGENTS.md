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

## نمط الكود
- تعليقات عربية موجزة تشرح «لماذا» فقط، دون شرح ما يفعله الكود.
- الأنواع في `src/types/index.ts` يجب أن تطابق استجابات الخادم فعلياً؛ توجد فحوص عقد في `engine/tests/social.routes.test.ts` تكشف أي انحراف.
- واجهة المستخدم عربية RTL بتصميم لوحة التحكم الحالي (`bg-slate-900 border-slate-800 rounded-2xl`)؛ لا تُعد التصميم من الصفر.
