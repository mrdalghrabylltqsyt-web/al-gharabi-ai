/**
 * أعلام إعادة تفعيل تبويبي المبيعات وغرفة العمليات — قرار مالك صريح (2026-10-13).
 *
 * كانت هاتان الواجهتان معزولتين افتراضياً (خارج نطاق «سوشيال + AI + تسويق»). بعد
 * قرار المالك بتوسيع النطاق ليشمل عقلاً تجارياً حقيقياً، تُفعَّلان عبر متغيّرات
 * بناء Vite فقط، وتبقى **معطّلة افتراضياً (fail-closed)** بلا قيمة صريحة.
 *
 * المصدر الواحد للحقيقة في الواجهة؛ يقابله على الخادم `GHARABI_ENABLE_SALES_TAB`
 * و`GHARABI_ENABLE_OPERATIONS_TAB` (خادم) — يضبطهما المالك معاً لتفعيل التبويب فعلياً.
 * لا قيمة مُفعَّلة مكتوبة في الكود.
 */

type ScopeFlagName = 'sales' | 'operations';

function readViteFlag(name: string): boolean {
  const env = (import.meta as any)?.env || {};
  const raw = String(env[name] ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes';
}

/** تبويب «المبيعات والتقسيط» مُفعَّل؟ (افتراضياً لا). */
export function salesTabEnabled(): boolean {
  return readViteFlag('VITE_GHARABI_ENABLE_SALES_TAB');
}

/** تبويب «غرفة العمليات» مُفعَّل؟ (افتراضياً لا). */
export function operationsTabEnabled(): boolean {
  return readViteFlag('VITE_GHARABI_ENABLE_OPERATIONS_TAB');
}

export function scopeFlagEnabled(name: ScopeFlagName): boolean {
  return name === 'sales' ? salesTabEnabled() : operationsTabEnabled();
}
