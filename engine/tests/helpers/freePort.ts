/**
 * حجز منفذ حر من نظام التشغيل — مصدر واحد لكل اختبارات الخادم.
 *
 * السبب الجذري للفشل المتقطع: كانت الاختبارات تختار منفذاً من نطاق ثابت
 * (`6510 + Math.floor(Math.random() * 150)` وأمثاله). بعض المنافذ داخل تلك
 * النطاقات (6000, 5060, 5061, 6566, 6665..6669, 6679, 6697 ...) محظورة في
 * `fetch`/undici (قائمة WHATWG "bad port"). فبينما يقبل نظام التشغيل `listen`
 * على منفذ محظور، يرفض `fetch` الاتصال به فوراً بـ`bad port` — فيبدو الخادم
 * «مُقلعاً» (listen ناجح) لكن كل طلب HTTP يفشل. وإن تصادف منفذ يستعمله اختبار
 * آخر، يرد خادم الاختبار الآخر على `/api/health` ثم يُغلق.
 *
 * الإصلاح الحتمي: لا نخمّن أرقاماً في نطاق ثابت، بل نطلب من نظام التشغيل منفذاً
 * حراً عبر `listen(0)`. منافذ النظام المؤقتة (ephemeral) تبدأ من 32768 في Linux
 * (‏`/proc/sys/net/ipv4/ip_local_port_range`) — أي أعلى من كل المنافذ المحظورة —
 * فلا يمكن أن يقع منفذ الاختبار على منفذ محظور أو على منفذ ثابت يستعمله اختبار آخر.
 *
 * منطق صافٍ قابل للاختبار: لا شبكة خارجية ولا أسرار.
 */

import net from 'node:net';

/**
 * المنافذ المحظورة في `fetch` (قائمة WHATWG/undici "bad port").
 * نُبقيها هنا للفحص الصريح: لا يجوز أن يعيد الحاجز منفذاً منها.
 */
export const FETCH_BLOCKED_PORTS: readonly number[] = Object.freeze([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
]);

/** هل المنفذ محظور في `fetch`؟ (يُستخدم كفحص صريح داخل الحاجز وفي الاختبارات). */
export function isFetchBlockedPort(port: number): boolean {
  return FETCH_BLOCKED_PORTS.includes(port);
}

/**
 * يحجز منفذاً حراً فعلياً من نظام التشغيل عبر `listen(0)` ثم يحرّره.
 * يرفض (لا يُخفي) أي منفذ محظور — وهو مستحيل عملياً لأن منافذ النظام المؤقتة
 * تبدأ من 32768، لكن الفحص يجعل الضمان صريحاً ومُختبَراً لا مفترضاً.
 */
export function reserveFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('free_port_no_address')));
        return;
      }
      const port = addr.port;
      srv.close(() => {
        if (isFetchBlockedPort(port)) {
          reject(new Error(`free_port_blocked:${port}`));
          return;
        }
        resolve(port);
      });
    });
  });
}
