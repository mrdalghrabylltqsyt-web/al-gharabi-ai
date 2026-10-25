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

/**
 * إزالة الحمل المكرر (فحص 2026-10-25): منذ R1 كل /api/* يمرّ proxy إلى Render،
 * لكن Netlify ظل ينشر هذه الدالة (حزمة 2.4MB، ذاكرة 1024MB) وتبقى قابلة للاستدعاء
 * مباشرة على /.netlify/functions/api/* — أي خادم ثانٍ كامل يقرأ ويكتب **نفس**
 * قاعدة البيانات (عكس هدف R1: خادم واحد يكتب). الآن الدالة **معطّلة افتراضياً**:
 * ترد 410 بلا تحميل server.ts ولا أي اتصال بالقاعدة. تُفعَّل صراحةً فقط عند الحاجة
 * (اختبارات/طوارئ) بـ GHARABI_NETLIFY_FUNCTION_ENABLED=1. التحميل كسول (dynamic import).
 */
const ENABLED = () => process.env.GHARABI_NETLIFY_FUNCTION_ENABLED === "1";

let innerPromise: Promise<{ inner: (e: any, c: any) => Promise<any> }> | null = null;
function loadInner() {
  if (!innerPromise) {
    innerPromise = import("../../server").then(async ({ app, warmStorage }) => {
      // كل عملية دالة جديدة تهيّئ المخزن أولاً (يقرأ الحالة الفعلية من Postgres عند
      // وجود DATABASE_URL). يُخزَّن الوعد فلا تتكرر التهيئة داخل العملية الواحدة.
      try { await warmStorage(); } catch { /* يتعامل معها الخادم كحالة تخزين غير جاهزة */ }
      return { inner: serverless(app) as any };
    });
  }
  return innerPromise;
}

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
  if (!ENABLED()) {
    return {
      statusCode: 410,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ success: false, code: "NETLIFY_FUNCTION_RETIRED", error: "هذه الدالة متوقفة؛ الخادم الوحيد على Render (/api عبر proxy)." }),
    };
  }
  // ننتظر تهيئة المخزن قبل معالجة أي طلب، فلا يقرأ الطلب حالة لم تُحمَّل بعد.
  const { inner } = await loadInner();
  return inner(normalizeEvent(event), context);
};