/**
 * بث لحظي بالانتظار الطويل (2026-10-27) — بديل الاستطلاع كل 4 ثوانٍ.
 *
 * كانت الشاشة الحية تسأل الخادم كل 4 ثوانٍ «هل من جديد؟» — 900 طلب في الساعة لكل شاشة، وأغلبها
 * فارغ، والحدث يتأخر حتى 4 ثوانٍ. الآن: الطلب الخفيف يبقى معلّقاً على الخادم حتى يقع حدث حقيقي
 * (فيُرد فوراً) أو تمضي 20 ثانية (فيُرد بلا جديد). النتيجة: الحدث يظهر خلال أجزاء من الثانية،
 * والطلبات في الهدوء تنخفض ~80%. اختير الانتظار الطويل لا SSE/WebSocket لأنه يمر عبر وكيل
 * Netlify (حدّه ~26 ث) وأي وكيل آخر بلا إعداد، ويرجع تلقائياً للاستطلاع العادي عند أي فشل.
 *
 * حماية الخطة المجانية: سقف للطلبات المعلّقة معاً؛ ما زاد عنه يُرد فوراً كالاستطلاع العادي.
 */

export const LIVE_WAIT_MAX_MS = 20000;
export const LIVE_WAIT_MAX_WAITERS = 8;

export type LiveWaitResult = 'event' | 'timeout' | 'busy' | 'closed';

interface Waiter { resolve: (r: LiveWaitResult) => void; timer: ReturnType<typeof setTimeout> }

export class LiveWaiters {
  private waiters = new Set<Waiter>();
  constructor(private readonly maxWaiters = LIVE_WAIT_MAX_WAITERS) {}

  get size(): number { return this.waiters.size; }

  /**
   * ينتظر الحدث التالي حتى `timeoutMs`. `onClose` يسجّل إلغاءً حين يغلق المتصفح الطلب
   * (فلا يبقى منتظر يتيم). يعيد 'busy' فوراً إن بلغ السقف.
   */
  wait(timeoutMs: number, onClose?: (cancel: () => void) => void): Promise<LiveWaitResult> {
    if (this.waiters.size >= this.maxWaiters) return Promise.resolve('busy');
    const ms = Math.max(0, Math.min(LIVE_WAIT_MAX_MS, Number(timeoutMs) || 0));
    return new Promise<LiveWaitResult>((resolve) => {
      let done = false;
      const w: Waiter = {
        resolve: (r) => { if (done) return; done = true; clearTimeout(w.timer); this.waiters.delete(w); resolve(r); },
        timer: setTimeout(() => w.resolve('timeout'), ms),
      };
      (w.timer as any)?.unref?.();
      this.waiters.add(w);
      onClose?.(() => w.resolve('closed'));
    });
  }

  /** حدث جديد ⇒ كل المنتظرين يُردّ عليهم الآن. */
  notify(): number {
    const list = [...this.waiters];
    for (const w of list) w.resolve('event');
    return list.length;
  }

  /** عند الإغلاق: لا منتظر يبقى معلّقاً. */
  closeAll(): void { for (const w of [...this.waiters]) w.resolve('closed'); }
}
