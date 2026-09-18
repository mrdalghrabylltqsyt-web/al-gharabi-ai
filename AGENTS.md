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
npm run final-audit    # node final-audit.mjs (10 فحوص)
npm test               # engine + social + network + runtime
```
- التشغيل الإنتاجي: `PORT=4517 NODE_ENV=production APP_URL=http://localhost:4517 node dist/server.cjs`
- فحوص منفردة: `npm run test:engine` | `test:social` | `test:network` | `test:runtime`.

## البنية الفعلية (مصدر الحقيقة)
```
server.ts                     خادم Express المركزي (كل المسارات، الحالة، المصادقة)
engine/ai/engine.ts           المحرك المركزي: مزود → حارس → مهلة → إعادة → cache → بديل
engine/ai/provider.ts         موصل Gemini (يقرأ المفتاح من الخادم فقط)
engine/ai/errors.ts           تصنيف الأخطاء (auth/service/rate/timeout/network)
engine/ai/retry.ts            تراجع أسّي + CircuitBreaker
engine/ai/models.ts           resolveModelCandidates — أسماء موديلات حقيقية فقط
engine/social/adapter.ts      عقد الموصل + BasePlatformAdapter + assertConnected
engine/social/registry.ts     سجل المنصات العشر (كل موصل معزول)
engine/social/comments.ts     تصنيف التعليقات الحتمي + منع الرد المكرر
engine/social/publishing.ts   preflight/execute + توفر المؤشرات لكل منصة
engine/social/brain.ts        العقل التسويقي + الذاكرة التشغيلية
engine/social/routes.ts       مسارات /api/social/manager/* (تُسجَّل من server.ts)
engine/tests/                 4 مجموعات اختبار (214 فحصاً)
src/components/social/SocialManagerView.tsx   واجهة المدير
src/components/agent/BrainCommandView.tsx     لوحة العقل المفكر
```
- المسارات تُسجَّل عبر `registerSocialManagerRoutes(app, {...})` في `server.ts` (حوالي السطر 3283) بحقن التبعيات.

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

## ملاحظات تشغيلية مهمة
- الإصدار الحالي `13.0.0`. إن كان `GEMINI_API_KEY` غير مضبوط، فالمحرك يعمل بالبديل الحتمي و`aiEnabled: false` — وهذا سلوك صحيح وليس خطأً.
- `/api/health` يعرض حالة المزود وموديلاته وقاطع الدائرة؛ `/api/readiness` للجاهزية.
- كل مسارات `/api/social/manager/*` محمية بـ `authenticateToken` وتعيد 401 بدون جلسة.
- الحالة تُحفظ في ملف JSON على الخادم مع كتابة ذرّية ونسخ احتياطية يومية (7 أيام).
- اختبار الدخان `engine/tests/runtime.smoke.test.ts` يشغّل `dist/server.cjs` فعلياً، لذا شغّل `npm run build` قبله.
- قبل أي commit: `npm run lint && npm run build && npm test && npm run final-audit`، ثم افحص عدم وجود أسرار أو ملفات مؤقتة.

## نمط الكود
- تعليقات عربية موجزة تشرح «لماذا» فقط، دون شرح ما يفعله الكود.
- الأنواع في `src/types/index.ts` يجب أن تطابق استجابات الخادم فعلياً؛ توجد فحوص عقد في `engine/tests/social.routes.test.ts` تكشف أي انحراف.
- واجهة المستخدم عربية RTL بتصميم لوحة التحكم الحالي (`bg-slate-900 border-slate-800 rounded-2xl`)؛ لا تُعد التصميم من الصفر.
