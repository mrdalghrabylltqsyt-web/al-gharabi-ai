/**
 * N1 — سلامة العملية (منطق صافٍ قابل للاختبار، بلا ساعة/شبكة/أسرار).
 *
 * المشكلة: كان `uncaughtException` يُسجَّل ثم **تستمر** العملية. الاستمرار بعد
 * استثناء غير مُلتقَط يترك الخادم في حالة غير معروفة (أقفال معلّقة، كتابات نصف
 * منجزة) ويُخفي العطل عن Render فلا يعيد التشغيل أبداً. السلوك الصحيح: تفريغ
 * الكتابات بمهلة قصيرة ثم `exit(1)` ليعود النشر/التشغيل التلقائي.
 *
 * `unhandledRejection` يبقى غير قاتل في الإنتاج (يُسجَّل ويُعدّ، ويظهر العدّاد في
 * /api/readiness)، ويُجعل **قاتلاً داخل الاختبارات فقط** (`GHARABI_TEST_MODE=true`)
 * كي لا يُبتلع فشل غير متوقّع أثناء التطوير.
 *
 * كل الآثار الجانبية (log/flush/close/exit) تُحقَن، فتُختبر بلا تشغيل عملية حقيقية.
 */

export interface ProcessSafetyDeps {
  /** تسجيل سطر واحد (يُمرَّر عبر مُنقّي الأسرار من الخادم). */
  log: (line: string) => void;
  /** تفريغ الكتابات المعلّقة بمهلة قصيرة (لا يرمي). */
  flush: (ms: number) => Promise<void>;
  /** إغلاق اتصال المخزن (لا يرمي). */
  close: () => Promise<void>;
  /** إنهاء العملية برمز. */
  exit: (code: number) => void;
  /** هل نحن في وضع اختبار (يجعل unhandledRejection قاتلاً)؟ */
  testMode: boolean;
}

export const UNCAUGHT_FLUSH_MS = 3000;

export interface ProcessSafety {
  handleUncaughtException: (err: unknown) => void;
  handleUnhandledRejection: (reason: unknown) => void;
  readonly unhandledRejectionCount: number;
  readonly testMode: boolean;
}

/** رسالة قصيرة آمنة (بلا مكدّس) — تُنقّى لاحقاً في الخادم. */
function shortMessage(value: unknown): string {
  const msg = (value as any)?.message ?? value;
  return String(msg ?? "unknown").slice(0, 300);
}

export function createProcessSafety(deps: ProcessSafetyDeps): ProcessSafety {
  let unhandledRejectionCount = 0;
  return {
    handleUncaughtException(err: unknown): void {
      deps.log(`[الغرابي AI] uncaughtException: ${shortMessage(err)}`);
      // تفريغ ثم إغلاق ثم خروج فشل — لا استمرار بحالة غير معروفة.
      void (async () => {
        try { await deps.flush(UNCAUGHT_FLUSH_MS); } catch { /* تجاهل */ }
        try { await deps.close(); } catch { /* تجاهل */ }
        deps.exit(1);
      })();
    },
    handleUnhandledRejection(reason: unknown): void {
      unhandledRejectionCount += 1;
      deps.log(`[الغرابي AI] unhandledRejection: ${shortMessage(reason)}`);
      if (deps.testMode) deps.exit(1);
    },
    get unhandledRejectionCount(): number { return unhandledRejectionCount; },
    get testMode(): boolean { return deps.testMode; },
  };
}
