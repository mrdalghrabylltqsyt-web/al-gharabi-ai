/**
 * Netlify Function يغلّف تطبيق Express الحالي من server.ts.
 *
 * يُعيد الاستخدام نفسه: نفس المسارات، نفس المصادقة، نفس منطق Gemini
 * والسوشيال ميديا — بلا أي تغيير في المنطق.
 *
 * استيراد server.ts لا يستدعي app.listen() لأن server.ts يكشف تشغيل
 * Netlify ويتخطى الاستماع داخل الدالة.
 *
 * التوجيه يأتي من netlify.toml عبر rewrite بحالة 200، وهي تحافظ على
 * المسار الأصلي (/api/...) داخل event.path، فيرى Express مساراته كما هي.
 */
import serverless from "serverless-http";
import { app } from "../../server";

export const handler = serverless(app);