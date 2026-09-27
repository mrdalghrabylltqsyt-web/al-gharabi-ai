# مستند Go-Live — ربط YouTube الرسمي (الغرابي AI)

الحالة: **جاهز للتشغيل**. الموصل منفّذ ومُختبر (204 فحصاً) ولا يحتاج أي تعديل كود إضافي.
لا يُعلن أي اتصال/رد/تحليل قبل إثباته من Google. **رفع الفيديو غير منفّذ** في النظام كله.

---

## 1) قيم المتغيرات المطلوبة (أسماء فقط — بلا قيم)

### إلزامية
| اسم المتغير | الغرض |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | معرّف عميل OAuth 2.0 (نوع Web application) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | سرّ العميل المقابل |

### بدائل مقبولة (تُستخدم تلقائياً إن غابت الإلزامية)
| اسم المتغير | ملاحظة |
|---|---|
| `GOOGLE_CLIENT_ID` | بديل عن `GOOGLE_OAUTH_CLIENT_ID` |
| `GOOGLE_CLIENT_SECRET` | بديل عن `GOOGLE_OAUTH_CLIENT_SECRET` |

### متغيرات عامة يعتمد عليها الربط (يجب أن تكون مضبوطة على بيئة الإنتاج مسبقاً)
| اسم المتغير | الغرض |
|---|---|
| `APP_URL` | العنوان العام (مصدر redirect_uri). أو يُترك لبدائل المنصة أدناه |
| `PLATFORM_TOKEN_ENCRYPTION_KEY` | تشفير رموز Google (AES-256-GCM) — 64 hex أو Base64 لـ32 بايت |

### اختيارية
| اسم المتغير | الافتراضي | الغرض |
|---|---|---|
| `YOUTUBE_OAUTH_SCOPES` | فارغ | تجاوز النطاقات؛ تُبقي المطلوب دائماً وتهمل غير الرسمي. **لا تُضِف `youtube.upload`** (الرفع غير منفّذ) |
| `YOUTUBE_PUBSUB_SECRET` | فارغ | سرّ توقيع إشعارات PubSubHubbub (HMAC-SHA1). بدونه تُرفض الإشعارات الواردة 503 |
| `YOUTUBE_API_BASE` / `YOUTUBE_GOOGLE_BASE` | مضبوط | **للاختبار فقط** — لا تُوجّه الإنتاج إلى مضيف وهمي |

> الأسرار لا تُطبع ولا تُسجَّل ولا تُعاد في أي استجابة. تُحفظ رموز Google **مشفّرة** ولا
> تُعرض في الواجهة.

---

## 2) Redirect URI النهائي

```
https://<النطاق-العام-الإنتاجي>/api/platforms/youtube/oauth/callback
```

القيمة الإنتاجية المعتمدة للمشروع (Render):

```
https://al-gharabi-ai.onrender.com/api/platforms/youtube/oauth/callback
```

> **قبل التسجيل لدى Google**، أكّد القيمة الفعلية من الخادم (للمالك) عبر:
> `GET /api/platforms/youtube/oauth-info` (حقل `redirectUri`)، أو
> `GET /api/health` (`publicUrl.baseUrl` + `valid`). القيمة المضافة عند Google يجب أن
> تطابق حرفياً ما يعرضه الخادم. عنوان `http://localhost` أو نطاق غير عام يُرفض.

---

## 3) خطوات إعداد Google Cloud

1. **Google Cloud Console** → أنشئ مشروعاً (أو اختر مشروع المعرض).
2. **APIs & Services → Library** → فعّل: **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - أضف بيانات التطبيق، ودعم: البريد الإلكتروني للمالك.
   - **Scopes**: لا تضف `youtube.upload`. النظام يطلب النطاقين:
     `.../auth/youtube.readonly` و`.../auth/youtube.force-ssl`.
   - **Test users**: أضف حساب Google الخاص بالقناة (وضع Testing) — أو انشر التطبيق
     (Publishing status) لتوسيع الوصول.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized redirect URIs** → أضف القيمة من القسم (2) بالضبط.
   - انسخ **Client ID** (ينتهي بـ`.apps.googleusercontent.com`) و**Client secret**.
5. تأكد أن القناة المطلوبة من نوع **YouTube Channel** (لا حساب مشاهدة فقط) لتُثبت
   `channels.list?mine=true`.

> **سياسة Google**: معلومات القناة الحقيقية مطلوبة. لا يُعلن النظام اتصالاً موثقاً بلا
> قناة حقيقية مُرجعة من Google.

---

## 4) خطوات إعداد Render

1. Render Dashboard → الخدمة **al-gharabi-ai** → **Environment**.
2. أضف/تحقق من:
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `APP_URL` = النطاق العام https (أو تأكد من ضبطه مسبقاً)
   - `PLATFORM_TOKEN_ENCRYPTION_KEY` (صالح: 64 hex أو Base64 لـ32 بايت)
   - اختياري: `YOUTUBE_PUBSUB_SECRET`
3. **Save** ثم أعد النشر (Manual Deploy أو Deploy latest commit).
4. انتظر اكتمال النشر، ثم تحقّق (القسم 5).

> لا الأسرار في `render.yaml` (كلها `sync: false`). لا `VITE_` لأي مفتاح.

---

## 5) خطوات التحقق بعد النشر

1. **الصحة العامة**: `GET /api/health`
   - `publicUrl.valid = true` والنطاق عام https.
   - `platformTokenKey.state = "valid"`.
   - `youtubeOAuth.clientIdConfigured = true` و`clientSecretConfigured = true`.
2. **الجهوزية**: `GET /api/readiness` — كتلة YouTube تعرض بيانات التطبيق مضبوطة.
3. **معلومات OAuth (للمالك)**: `GET /api/platforms/youtube/oauth-info`
   - `redirectUri` يطابق ما سُجّل عند Google حرفياً.
   - `scopes` = النطاقان (بلا `youtube.upload`).
   - طريقة GET على مسار التحقق الإداري تُرفض 405 (سلوك صحيح).
4. **الحالة قبل الربط (للمالك/المصادق)**: `GET /api/platforms/youtube/status`
   - `state = READY_TO_CONNECT` مع `nextAction` واضح (وليس VERIFIED/OPERATIONAL).
   - `connected = false`, `providerVerified = false`.
5. **الربط الفعلي بزر واحد**: تبويب **مركز ربط المنصات** → بطاقة YouTube → **«ربط YouTube»**.
   - يجب أن يُفتح رابط `accounts.google.com` ثم شاشة موافقة Google بحساب القناة.
   - بعد الموافقة يعود المالك تلقائياً إلى التطبيق (`#oauth_return=youtube:ok`).
6. **بعد العودة**: `GET /api/platforms/youtube/status`
   - `state = VERIFIED` و`connected = true` و`providerVerified = true` مع `channelId`.
   - `tokenStored = true` و`refreshTokenStored = true`.
7. **قراءة حقيقية**: `GET /api/platforms/youtube/channel` و`/videos` — بيانات فعلية بلا اختراع.
   - عند غياب بيانات: تُعلن فارغة/غير متاحة صراحةً، لا أصفار وهمية.
8. **إثبات تشغيلي (اختياري)**: سجّل تعليقات فيديو ثم اردّ عليها عبر
   `POST /api/platforms/youtube/reply` — بمعرّف تعليق من YouTube فقط تنتقل الحالة إلى
   `OPERATIONAL`.

> القاعدة: **HTTP 200 لا يعني نجاح Google**. الحكم من `providerVerified` والحالة الصادقة
> والموديل/السبب المذكور صراحةً (`reauth_needed` / `QUOTA_EXCEEDED` / `EXTERNAL_BLOCKER`).

---

## 6) خطة Rollback إذا فشل الربط

**لا يمسّ Rollback أي منصة أخرى (TikTok/Facebook/Instagram/Telegram) ولا Gemini.**

### أ. فشل قبل شاشة الموافقة (رسالة Google عن redirect/عميل)
- تحقق أن `redirectUri` من `/api/platforms/youtube/oauth-info` مطابق حرفياً لما سُجّل
  في **Authorized redirect URIs**. صحّح Google أو `APP_URL` ثم أعد المحاولة.
- إن ظهر `INVALID_CLIENT` / `client_id` غير مقبول: تأكد أن القيمة هي Client ID تطبيق
  ويب صحيح (بلا مسافة/سطر) وأن `GOOGLE_OAUTH_CLIENT_ID`/`SECRET` من **نفس** المشروع.

### ب. فشل بعد الموافقة (تبادل الرمز / إثبات القناة)
- تبادل الرمز فاشل → تحقق من صحة السرّ ومن تطابق `redirect_uri` بين الطلب والتفويض.
- لا قناة مُرجعة → الحساب ليس قناة YouTube؛ استخدم حساباً يملك قناة.
- **إجراء التراجع الفوري**: أوقف محاولات الربط (لا تُعيد المحاولة آلياً)، وأبقِ المنصة
  `disconnected`. لا تُفقد أي بيانات قائمة؛ حالة YouTube لا تُكتب إلا بعد إثبات القناة.

### ج. فصل الربط (إن نجح ثم أردت التراجع)
- من مركز ربط المنصات → **«فصل»**، أو `POST /api/platforms/youtube/disconnect` (للمالك):
  يُبطل الرمز لدى Google (`oauth2.googleapis.com/revoke`) ثم يمسحه محلياً ويُعلن الانقطاع.

### د. تراجع عام على مستوى النشر (Kill-switch بلا كود)
- لحجب الربط مؤقتاً: أزل `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` من Render
  وأعد النشر. تعود حالة YouTube إلى `NOT_CONFIGURED`/`CODE_READY` بلا أي اتصال، ويبقى
  باقي النظام يعمل. لا حذف بيانات ولا تغيير معماري.

### هـ. فحص أمان التراجع
- لا يُحفظ رمز ما لم يُثبت المزود القناة. لا يُسجَّل أي سرّ. لا يُعاد أي توكن في استجابة.
- خروج المالك/تدوير المفاتيح لا يُبطل باقي المنصات.

---

## ملحق — ما هو خارج نطاق YouTube (ممنوع افتراضه)
- **رفع الفيديو / النشر**: غير منفّذ (`NOT_IMPLEMENTED`) — لا `videos.insert` ولا مسار نشر.
- **قراءة التعليقات/الرد عليها**: منفّذ عبر Data API وحده، بمعرّف مزود إلزامي للتسليم.
- **إشعارات PubSubHubbub الواردة**: تحتاج `YOUTUBE_PUBSUB_SECRET`؛ بدونها تُرفض 503 صراحةً.

_أُعدّ هذا المستند بمساعدة وكيل ذكاء اصطناعي (OpenHands) نيابةً عن مالك المستودع._
