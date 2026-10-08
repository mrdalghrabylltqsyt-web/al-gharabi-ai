/**
 * مهلات Google Drive — مصدر واحد (Task: تعليق رفع الفيديو إلى Drive بلا نهاية).
 *
 * الجذر المُثبت: `createGaxiosTransport` في `drive-client.mjs` كان يستدعي
 * `instance.request({...})` بلا خيار `timeout`، فلا يوجد أي حدّ زمني في السلسلة.
 * إن تعثّر اتصال TLS/شبكة عند googleapis.com (أو تعثّر تجديد رمز OAuth عند
 * oauth2.googleapis.com) بقي `await` معلّقاً **بلا نهاية**، فلا يدخل حتى منطق
 * إعادة المحاولة (الذي يتطلّب أولاً انتهاء الطلب ليُصنَّف). والمسار
 * `POST /api/workspace/content/video/host` ينتظره مباشرةً، فيبقى طلب المتصفح
 * معلّقاً بلا أي رسالة خطأ تصل للمالك أبداً.
 *
 * هذا الملف هو **المصدر الوحيد** لقيم المهلة، مُستخدَم في:
 *   - ناقل gaxios (مهلة لكل طلب فردي إلى googleapis.com) — drive-client.mjs.
 *   - مزوّد رمز التجديد (مهلة استدعاء oauth2.googleapis.com) — drive-auth.mjs.
 *   - المسار العام (مهلة إجمالية إجمالية تُغلّف السلسلة كاملة) — server.ts.
 * لا يقرأ أي سرّ ولا يعيد أي قيمة سرّية.
 */

/** مهلة الطلبات الوصفية القصيرة (مجرد بحث مجلد، قراءة بيانات، منح صلاحية). */
export const DRIVE_METADATA_TIMEOUT_MS = 60_000;
/** مهلة رفع/تنزيل البايتات؛ رفع 12MB على اتصال بطيء يحتاج هامشاً أوسع. */
export const DRIVE_TRANSFER_TIMEOUT_MS = 90_000;
/** مهلة تجديد رمز OAuth لدى Google؛ قصيرة لأنها عملية صغيرة لكنها قد تعلق. */
export const DRIVE_TOKEN_TIMEOUT_MS = 20_000;
/** مهلة إجمالية صريحة حول سلسلة الاستضافة كاملةً (تمنع تعليق المسار العام). */
export const DRIVE_PUBLIC_HOST_TIMEOUT_MS = 90_000;

/**
 * يستنتج مهلة الطلب المناسبة من شكله: طلبات البايتات (رفع multipart/related،
 * استبدال media، تنزيل arraybuffer) تأخذ مهلة النقل، وبقية الطلبات (JSON وصفية)
 * تأخذ مهلة البيانات الوصفية. لا يفترض استدعاءً واحداً؛ يقرأ `responseType` وطول
 * الجسم وحجمه.
 */
export function resolveRequestTimeoutMs(opts = {}) {
  if (opts.responseType === 'arraybuffer') return DRIVE_TRANSFER_TIMEOUT_MS;
  const body = opts.body;
  if (body && typeof body.length === 'number' && body.length > 512 * 1024) return DRIVE_TRANSFER_TIMEOUT_MS;
  if (typeof body === 'string' && body.length > 512 * 1024) return DRIVE_TRANSFER_TIMEOUT_MS;
  return DRIVE_METADATA_TIMEOUT_MS;
}

/** يقرأ تجاوزاً رقمياً صالحاً من البيئة إن وُجد وإلا القيمة الافتراضية (بلا انهيار). */
export function envTimeoutMs(env, name, fallback) {
  const raw = env && env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

/** يغلّف وعداً بمهلة صريحة. عند التجاوز يرمي خطأً مُصنَّفاً (code: timeout). */
export function settleWithTimeout(promise, timeoutMs, onTimeout) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  const racing = Promise.resolve(promise);
  // إن فازت المهلة ورفض الوعد الأصلي لاحقاً فلا نُنتج رفضاً غير معالَج.
  racing.catch(() => {});
  let timer = null;
  const guard = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error('انتهت مهلة العملية.');
      err.code = 'timeout';
      if (typeof onTimeout === 'function') {
        try { onTimeout(); } catch { /* لا نُسقط بسبب ردّ النداء */ }
      }
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([racing, guard]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
