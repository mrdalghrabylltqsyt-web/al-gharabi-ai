# مركز استعادة الغرابي AI — حزمة النشر المستقلة

هذه حزمة **مستقلة تماماً** تُنشر كخدمة منفصلة (Render منفصل، بلا علاقة بخدمة الغرابي
الرئيسية). غرضها الوحيد: تبقى متاحة ولو توقّف تطبيق الغرابي/واجهته/جلسته.

## التشغيل المحلي (اختصار الهاتف/الكمبيوتر)

```bash
cd dr-recovery-center
npm install --omit=dev
npm start        # ثم افتح http://127.0.0.1:4600
```

أو: `./start.sh` (لينكس/ماك) أو `start.cmd` (ويندوز).

## التثبيت كتطبيق (جوال + سطح مكتب) — PWA

المركز **تطبيق ويب تقدّمي (PWA) قابل للتثبيت** من نفس الخدمة المركزية
`https://gharabi-recovery-center.onrender.com` (لا خادم ثانٍ ولا تطبيق Electron منفصل).

- **أندرويد:** افتح العنوان في Chrome → قائمة المتصفح → «تثبيت التطبيق» / «إضافة إلى
  الشاشة الرئيسية» → تظهر أيقونة «استعادة الغرابي». عند فتحها تبدأ مباشرة بالمركز (وضع
  standalone بلا شريط متصفح).
- **سطح المكتب (Chrome/Edge):** افتح العنوان → أيقونة التثبيت في شريط العنوان →
  «تثبيت» → يظهر التطبيق في قائمة ابدأ/سطح المكتب/قائمة التطبيقات، ويُفتح في نافذة مستقلة.
- **iOS (Safari):** مشاركة → «إضافة إلى الشاشة الرئيسية» (يستخدم `apple-touch-icon`).

مكوّنات PWA: `manifest.webmanifest` (display=standalone, start_url=/, scope=/) + أيقونات
192/512 + maskable + Apple touch (180) + Service Worker **بلا كاش إطلاقاً** (تمرير شفّاف،
لا يتدخّل في `/api/*` ولا في أي طلب غير GET). لا يُخزَّن أي رد مصادقة/رمز/خزنة/نسخة.

## النشر المستقل على Render

1. Render → **New +** → **Blueprint** (أو Web Service) ووجّه `rootDir` إلى `dr-recovery-center`.
2. ملف `render.yaml` في هذه الحزمة يعرّف الخدمة (`gharabi-recovery-center`، خطة Free).
3. اضبط متغيّرات البيئة (Render → Environment) — **بلا أي قيمة في Git**:
   - `DRIVE_OAUTH_CLIENT_ID` / `DRIVE_OAUTH_CLIENT_SECRET`
   - `DRIVE_TOKEN_ENCRYPTION_KEY` (نفس مفتاح التطبيق الرئيسي — لفكّ رمز التجديد)
   - `DR_STATE_DATABASE_URL` — اتصال **قراءة فقط** بجدول حالة الغرابي (نفس قاعدة Neon).
     يقرأ المركز منه رمز التجديد **المشفّر** (`control.driveRefreshToken`) ويفكّه بمفتاح
     التشفير أعلاه. **بهذا لا يُنقل أي رمز نصي إلى خدمة الاستعادة.** (بديل قديم: `DR_RECOVERY_STATE_DATABASE_URL`.)
   - `DRIVE_DB_BACKUP_KEY` (أو `DR_RECOVERY_MASTER_KEY`)
   - `DR_FOLDER_IDENTITY` (اختياري)
   - `DR_RECOVERY_TEST_DATABASE_URL` (اختياري، قاعدة هدف معزولة)
   - `RECOVERY_CENTER_OWNER_TOKEN` — **مفتاح مالك هذه الخدمة المستقلة** (إلزامي). بدونه
     تُرد `/api/points` و`/api/verify` و`/api/restore` بـ**401** فلا يرى أي زائر بيانات
     نقاط الاستعادة. بديل: `RECOVERY_CENTER_OWNER_TOKEN_HASH` (SHA-256 hex للمفتاح).
   - `DRIVE_OAUTH_REFRESH_TOKEN` **توافق خلفي فقط** — لا تضبطه؛ الأفضل ترك الرمز مشفّراً في قاعدة الحالة.
4. **لا تضبط `DR_RECOVERY_VAULT_KEY` هنا إطلاقاً** — يُدخله المالك في الواجهة وقت الاستعادة فقط.

## ما بعد النشر

- سجّل العنوان الحقيقي للخدمة في `recovery-instructions.md` و`recovery-information.md`.
- اختبر `GET /api/health` (يجب `ok:true` و`standalone:true`، و`drive.refreshTokenSource` = `state_database`).

## الأمان

- **مصادقة المالك إلزامية**: المسارات التي تكشف بيانات وصفية لنقاط الاستعادة
  (`/api/points`، `/api/verify`) أو تنفّذ استعادة (`/api/restore`) تُرد **401** بلا مفتاح
  مالك صالح (`Authorization: Bearer <RECOVERY_CENTER_OWNER_TOKEN>`). بلا ضبط المفتاح تبقى
  مقيّدة افتراضياً (fail-closed)، ولا يمكن تعطيلها إلا بـ`RECOVERY_CENTER_ALLOW_UNAUTHENTICATED=true`
  (وضع محلي صريح فقط). `/api/health` والواجهة و`/api/owner-auth` عامة ولا تكشف أي سرّ.
- قراءة فقط من Drive: لا حذف/تعديل لأي Recovery Point (بما فيها rp-002/003/004).
- تُرفض قاعدة الهدف إن طابقت `DATABASE_URL`.
- لا سرّ في أي استجابة أو سجل؛ الأسماء والأعداد والحالات فقط.
- مفتاح الخزنة يُمرَّر في جسم POST فقط، ولا يُحفظ ولا يُسجَّل.

## مزامنة الكود

`lib/` نسخة من وحدات `tools/dr/` الضرورية. بعد أي تعديل على `tools/dr/`:

```bash
node dr-recovery-center/sync-lib.mjs
```

يوجد فحص `final-audit` يمنع أي انحراف بين النسختين.
