import React from 'react';
import { toScheduleDisplay } from '../../utils/scheduleTime';

/**
 * حاوية معزولة لاتجاه النص: بديل `dir="ltr"` مدعوم في كل المتصفحات.
 * العزل يمنع خوارزمية Bidi من قلب تسلسل التاريخ/الوقت داخل واجهة RTL،
 * فلا تظهر `2026-09-22T11:45` بصرياً كـ `22T11:45-09-2026`.
 */
export const LTR_ISOLATE_STYLE: React.CSSProperties = {
  direction: 'ltr',
  unicodeBidi: 'isolate',
  display: 'inline-block',
  whiteSpace: 'nowrap',
};

/** صيغة عرض صريحة للمستخدم: `YYYY-MM-DD HH:mm` (لا تغيّر القيمة المخزنة). */
export function formatScheduleTimestamp(value: unknown): string {
  const display = toScheduleDisplay(value);
  if (!display) return typeof value === 'string' ? value : '';
  return display.replace('T', ' ');
}

interface ScheduleTimestampProps {
  value: unknown;
  className?: string;
}

/**
 * يغلّف نص موعد الجدولة وحده بعنصر `dir="ltr"` مستقل عن النص العربي المحيط،
 * فيبقى التاريخ والوقت مقروءين بنفس ترتيب القيمة المخزَّنة.
 */
export const ScheduleTimestamp: React.FC<ScheduleTimestampProps> = ({ value, className }) => {
  const text = formatScheduleTimestamp(value);
  if (!text) return null;
  return (
    <span dir="ltr" style={LTR_ISOLATE_STYLE} className={className}>
      {text}
    </span>
  );
};
