/**
 * Netlify Function يغلّف تطبيق Express الحالي من server.ts.
 *
 * يُعيد الاستخدام نفسه: نفس المسارات، نفس المصادقة، نفس منطق Gemini
 * والسوشيال ميديا — بلا أي تغيير في المنطق.
 *
 * استيراد server.ts لا يستدعي app.listen() لأن server.ts يكشف تشغيل
 * Netlify ويتخطى الاستماع داخل الدالة.
 *
 * التوجيه الطبيعي يأتي من netlify.toml عبر rewrite بحالة 200، وهي تحافظ
 * على المسار الأصلي (/api/...) داخل event.path. لكن الوصول المباشر للدالة
 * أو أي صيغة rewrite أخرى قد يمرّر المسار مُسبَّقاً باسم الدالة، وحينها
 * يعيد Express صفحة HTML 404 بدل JSON. لذا نُطبّع المسار أدناه.
 */
import serverless from "serverless-http";
import { app, warmStorage } from "../../server";

const inner = serverless(app);

// كل عملية دالة جديدة تهيّئ المخزن أولاً (يقرأ الحالة الفعلية من Postgres_عند
// وجود DATABASE_URL). يُخزَّن الوعد فلا تتكرر التهيئة داخل العملية الواحدة.
const warmed = warmStorage();

const FUNCTION_PREFIX = "/.netlify/functions/api";

/**
 * يُعيد مسار الطلب دائماً إلى الصيغة /api/... التي يعرفها Express.
 * يشمل: /.netlify/functions/api/health و /.netlify/functions/api/api/health
 * وأي مسار بلا بادئة /api. النتيجة: رد JSON متسق بدل HTML 404.
 */
function normalizeEvent(event: Record<string, unknown>): Record<string, unknown> {
  const original = typeof event?.path === "string" ? (event.path as string) : "/";
  let path = original;

  if (path === FUNCTION_PREFIX || path.startsWith(`${FUNCTION_PREFIX}/`)) {
    path = path.slice(FUNCTION_PREFIX.length) || "/";
  }
  if (!path.startsWith("/api/")) {
    path = `/api${path.startsWith("/") ? path : `/${path}`}`;
  }

  return { ...event, path, rawPath: path };
}

export const handler = async (event: Record<string, unknown>, context: Record<string, unknown>) => {
  // ننتظر تهيئة المخزن قبل معالجة أي طلب، فلا يقرأ الطلب حالة لم تُحمَّل بعد.
  try { await warmed; } catch { /* يتعامل معها الخادم كحالة تخزين غير جاهزة */ }
  return inner(normalizeEvent(event), context);
};