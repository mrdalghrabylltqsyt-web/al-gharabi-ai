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
   - `DRIVE_OAUTH_REFRESH_TOKEN` **توافق خلفي فقط** — لا تضبطه؛ الأفضل ترك الرمز مشفّراً في قاعدة الحالة.
4. **لا تضبط `DR_RECOVERY_VAULT_KEY` هنا إطلاقاً** — يُدخله المالك في الواجهة وقت الاستعادة فقط.

## ما بعد النشر

- سجّل العنوان الحقيقي للخدمة في `recovery-instructions.md` و`recovery-information.md`.
- اختبر `GET /api/health` (يجب `ok:true` و`standalone:true`، و`drive.refreshTokenSource` = `state_database`).

## الأمان

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
