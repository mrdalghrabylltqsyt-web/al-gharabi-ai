/**
 * Phase 6 — غلاف مؤقّتات آمن: أي استثناء داخل نداء مؤقّت (`setInterval`/`setTimeout`)
 * يُلتقط ويُسجَّل بلا كسر العملية، بدل أن يتحوّل إلى `uncaughtException` يُسقط الخادم.
 *
 * لماذا: node يُنهي العملية عند استثناء غير مُلتقط داخل نداء مؤقّت. مؤقّتات المشروع
 * (تنظيف الذاكرة، مصالحة TikTok، مهام آمنة) لا يجوز أن تُسقط الخادم عند خطأ عارض.
 * النداءات غير المتزامنة تُغلَّف أيضاً برفض مُلتقط.
 *
 * منطق صافٍ قابل للاختبار (لا ساعة حقيقية ولا شبكة ولا أسرار).
 */

/** يحوّل أي قيمة مرفوضة/مُرمية إلى نص آمن قصير (بلا تسريب كائن كامل). */
export function safeErrorText(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200);
  if (typeof err === 'string') return err.slice(0, 200);
  try { return String(err).slice(0, 200); } catch { return 'unknown'; }
}

export type TimerLogger = (message: string) => void;

/**
 * يلفّ نداء مؤقّت متزامناً كان أو غير متزامن. أي استثناء/رفض يُلتقط ويُمرَّر للسجل.
 * يُعيد دالة لا ترمي أبداً، فيصلح تمريرها إلى setInterval/setTimeout مباشرةً.
 */
export function safeTimerCallback(fn: () => unknown, label: string, logger?: TimerLogger): () => void {
  const log = logger ?? ((m: string) => console.error(m));
  return () => {
    try {
      const out = fn();
      if (out && typeof (out as Promise<unknown>).then === 'function') {
        (out as Promise<unknown>).catch((err) => log(`[الغرابي AI] timer "${label}" async error: ${safeErrorText(err)}`));
      }
    } catch (err) {
      log(`[الغرابي AI] timer "${label}" error: ${safeErrorText(err)}`);
    }
  };
}
