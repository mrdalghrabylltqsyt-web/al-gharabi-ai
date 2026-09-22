/**
 * حارس عرض موعد الجدولة في واجهة RTL — يمنع رجوع مشكلة Bidi.
 *
 * القيمة المخزَّنة جدار محلي `YYYY-MM-DDTHH:mm`. داخل واجهة RTL تُعيد خوارزمية
 * Bidi ترتيب الأرقام والفواصل بصرياً فتظهر `22T11:45-09-2026` بدل `2026-09-22T11:45`.
 * الحل: تغليف نص الموعد وحده في عنصر `dir="ltr"` مع `unicode-bidi: isolate`،
 * فلا يتأثر بالنص العربي المحيط في أي موضع عرض.
 *
 * الجزء الأول يتحقق من المكوّن rendered فعلياً (SSR)، والثاني فحص مصدري يمنع
 * عودة الدمج النصي المباشر للتاريخ داخل جملة عربية في مواضع العرض.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { ScheduleTimestamp, formatScheduleTimestamp, LTR_ISOLATE_STYLE } from '../../src/components/common/ScheduleTimestamp';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const STORED = '2026-09-22T11:45';

// ------------------------------------------------------------ منطق/عرض المغلف
group('1) صيغة العرض واضحة ولا تغيّر القيمة المخزَّنة');
check('الصيغة المعروضة `YYYY-MM-DD HH:mm`', formatScheduleTimestamp(STORED) === '2026-09-22 11:45', formatScheduleTimestamp(STORED));
check('القيمة المخزَّنة تُقبل بصيغتها المعيارية بلا تحويل', formatScheduleTimestamp('2026-09-22 11:45') === '2026-09-22 11:45');
check('لحظة ISO تُعرض بجدار بغداد الصحيح', formatScheduleTimestamp('2026-09-22T08:45:00.000Z') === '2026-09-22 11:45', formatScheduleTimestamp('2026-09-22T08:45:00.000Z'));
check('النص غير الصالح يُعاد كما هو بلا كسر', formatScheduleTimestamp('غير صالح') === 'غير صالح');
check('نمط العزل يفرض اتجاه LTR و isolate', LTR_ISOLATE_STYLE.direction === 'ltr' && LTR_ISOLATE_STYLE.unicodeBidi === 'isolate');

group('2) العزل الفعلي داخل سياق RTL (SSR)');
const arabicContext = renderToStaticMarkup(
  React.createElement('div', { dir: 'rtl' },
    'مجدول للإطلاق في: ',
    React.createElement(ScheduleTimestamp, { value: STORED }),
  ),
);
check('العنصر المُغلف يحمل dir="ltr"', arabicContext.includes('<span dir="ltr"'), arabicContext);
check('العنصر المُغلف يحمل unicode-bidi:isolate', /unicode-bidi:isolate/.test(arabicContext), arabicContext);
check('التاريخ يظهر بصيغته الصحيحة داخل العنصر المعزول', arabicContext.includes('>2026-09-22 11:45</span>'), arabicContext);
check('لا يوجد تاريخ مكشوف خارج العنصر المعزول', !arabicContext.includes('>مجدول للإطلاق في: 2026-09-22'), arabicContext);
check('القيمة المخزَّنة لم تُلمس (تُعرض نفس الساعة)', arabicContext.includes('11:45') && !arabicContext.includes('08:45'));

group('3) عزل قيمة غير صالحة/مفقودة');
check('العنصر يُرجع null عند غياب القيمة', renderToStaticMarkup(React.createElement(ScheduleTimestamp, { value: undefined })) === '');
const invalidMarkup = renderToStaticMarkup(React.createElement(ScheduleTimestamp, { value: 'ليس وقتاً' }));
check('القيمة غير الصالحة تُعزل أيضاً بـ dir="ltr"', invalidMarkup.includes('dir="ltr"') && invalidMarkup.includes('ليس وقتاً'), invalidMarkup);

// ---------------------------------------------------- فحص مصدري لمواضع العرض
group('4) كل موضع عرض لـ scheduledFor يمر عبر المغلف المعزول');
const approvalSrc = readFileSync(join(process.cwd(), 'src/components/approval/ApprovalWorkflowView.tsx'), 'utf8');
const socialSrc = readFileSync(join(process.cwd(), 'src/components/social/SocialHubView.tsx'), 'utf8');
check('Approval Workflow يغلّف الموعد بـ ScheduleTimestamp', approvalSrc.includes('ScheduleTimestamp value={post.scheduledFor}'));
check('Social Hub يغلّف الموعد بـ ScheduleTimestamp', socialSrc.includes('ScheduleTimestamp value={post.scheduledFor}'));
check('لا دمج نصي مباشر للتاريخ في Approval Workflow', !/مجدول للإطلاق في[^\n]*\{\s*toScheduleDisplay/.test(approvalSrc) && !approvalSrc.includes('toScheduleDisplay(post.scheduledFor)'));
check('لا دمج نصي مباشر للتاريخ في Social Hub', !socialSrc.includes('toScheduleDisplay(post.scheduledFor)'));
check('المكوّن يفرض dir="ltr" و isolate على مستوى المصدر', readFileSync(join(process.cwd(), 'src/components/common/ScheduleTimestamp.tsx'), 'utf8').includes("unicodeBidi: 'isolate'"));

console.log('');
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} RTL schedule display checks`);
}
