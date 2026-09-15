# قواعد مشروع الغرابي AI

## الهوية
- الغرابي AI مساعد ذكي مركزي متعدد المنصات لمعرض الغرابي للتقسيط.
- نشاط المعرض: أجهزة منزلية، هواتف ذكية، مواد بناء، إلكترونيات، وخدمات التقسيط.
- لا تُستخدم بيانات أو معماريات من مشاريع سابقة دون طلب صريح.

## Gemini وحماية الحصة
- لا تستخدم أو تعرض عدادًا وهميًا أو موروثًا مثل 125/125.
- لا توجد بيانات تجريبية تُحسب ضمن الاستهلاك الحقيقي.
- كل طلب Gemini يجب أن يمر عبر الحماية المحلية والتخزين المؤقت ومنع التكرار.
- لا نرفع سقف الاستهلاك لمجرد التطوير؛ نفضّل المحرك المحلي والعمليات الحتمية متى أمكن.
- لا يُعتبر بلوغ حد الحماية نجاحًا.

## المنصات
- المنصات المدعومة: TikTok, YouTube, Facebook, Instagram, WhatsApp Business, Telegram, X, Snapchat, Threads, Google Business Profile.
- دعم المنصة لا يعني اتصال الحساب بها.
- لا يُدّعى النشر أو المزامنة أو استقبال الرسائل قبل وجود اتصال API/OAuth فعلي.
- أي مهمة نشر تمر بمراحل إعداد ثم موافقة ثم اتصال فعلي ثم تنفيذ.

## النشر والتطوير
- نجمع التغييرات المترابطة في دفعات كبيرة.
- لا نُصدر نسخة جديدة بسبب إصلاح صغير منفرد.
- قبل كل إصدار: فحص الملفات، فحص السلامة، ومحاولة اختبار البناء عند توفر الاعتماديات.


## قاعدة الدفعات
- اجمع التعديلات المترابطة في دفعات كبيرة، واختبرها قبل إصدار نسخة جديدة.
- لا تُجرى نشرات متكررة بسبب إصلاحات صغيرة.

## المنصات
- المنصات العشر مدعومة مركزيًا، لكن لا تُعتبر متصلة إلا بعد إثبات OAuth/API فعلي.
- يمنع زر الواجهة وحده تفعيل اتصال أو ادعاء نجاح النشر.

## Gemini
- المسارات الحتمية مثل حسبة الأقساط، فحص النشر، إنشاء هيكل الحملة وحالة المنصات لا تستخدم Gemini.
- يمنع أي تكرار غير ضروري لاستدعاءات Gemini.


## v2.5 Batch Policy
- Group security, reliability, orchestration, and platform-control changes into one release.
- Never expose provider quota as a fixed fake counter.
- Never log OTP/challenge secrets.
- Repeated job creation with the same idempotency key must not create duplicate jobs.
- Deterministic health/readiness checks must not consume Gemini.


## 3.1 Reliability rule
- Server state is durable and atomically written.
- Daily rolling backups are kept for up to 7 days.
- Owner-only integrity/export endpoints never expose secrets.
- Google ID tokens are audience-checked when GOOGLE_CLIENT_ID is configured.
- No fake social connection or publishing state is permitted.

## v4.0 operating rule
- CRM leads, follow-ups, internal tasks and calendar data are server-backed.
- No external metric may be recorded without provider verification.
- Content approval must pass through review before owner approval.
- Never represent a planned/scheduled/ready operation as externally executed.


## v5.0
- Central sales and installment ledger with durable payments, balances, status transitions, finance overview, and audit trail.
- Financial module is deterministic and does not consume Gemini quota.


## v8.0 business suite
- Suppliers, purchasing, expenses, contracts and installment schedules are server-backed.
- Deterministic only; Gemini is not required for these operations.
