/**
 * الجزء 2 — اختبار وحدة حقيقي للوحدات الجديدة (B4/B7/B8).
 *
 * يثبت المنطق الصافي بلا شبكة ولا خادم:
 *   - B4: مفتاح التنفيذ التلقائي معطَّل افتراضياً؛ لا تنفيذ إلا لحالة `ready`؛
 *         انتظار حصة YouTube يمنع التنفيذ؛ الحالات المنتهية لا تُعاد.
 *   - B7: الحدّ الصريح 500 لكل مصفوفة، الأحدث أولاً، والأقدم يُسقَط.
 *   - B8: بناء سجل بيع حقيقي (يرفض مبلغاً غير موجب/بلا منتج)، التطبيع، والتقرير
 *         الشهري الحتمي (عدد الاستفسارات والمبيعات لكل منصة).
 *
 * **يفشل على الكود القديم** (لا وجود لهذه الوحدات).
 */

import {
  defaultJobAutomationState, normalizeJobAutomationState, setJobAutoExecute,
  decideAutoExecute, jobAutomationPublicBlock,
} from '../social/jobAutomation';
import { CONVERSATION_STATE_MAX, capNewestFirst, conversationLimitsPublicBlock } from '../social/conversationLimits';
import {
  buildCommercialSaleRecord, normalizeCommercialSaleRecord, normalizeSourcePlatform,
  monthKeyOf, buildMonthlyCommercialReport,
} from '../../engine/commercial/commercialSales';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function testB4(): void {
  const d = defaultJobAutomationState();
  check('B4: الافتراضي معطَّل (fail-closed)', d.autoExecuteApproved === false);
  check('B4: التطبيع يرفض أي قيمة غير true صريحة', normalizeJobAutomationState({ autoExecuteApproved: 'yes' }).autoExecuteApproved === false);
  check('B4: التطبيع يقبل true صريحة', normalizeJobAutomationState({ autoExecuteApproved: true }).autoExecuteApproved === true);
  check('B4: التطبيع يقبل غياب الحقل ⇒ معطَّل', normalizeJobAutomationState({}).autoExecuteApproved === false);

  const on = setJobAutoExecute(d, true);
  check('B4: التبديل يفعّل', on.autoExecuteApproved === true && d.autoExecuteApproved === false);

  const now = Date.parse('2026-10-24T10:00:00Z');
  check('B4: معطَّل ⇒ لا تنفيذ (DISABLED)', decideAutoExecute({ status: 'ready', enabled: false, nowMs: now }).code === 'DISABLED');
  check('B4: غير جاهزة (approved) ⇒ لا تنفيذ', decideAutoExecute({ status: 'approved', enabled: true, nowMs: now }).code === 'NOT_READY');
  check('B4: queued ⇒ لا تنفيذ', decideAutoExecute({ status: 'queued', enabled: true, nowMs: now }).code === 'NOT_READY');
  check('B4: executed ⇒ لا إعادة', decideAutoExecute({ status: 'executed', enabled: true, nowMs: now }).code === 'NOT_READY');
  check('B4: failed ⇒ لا إعادة تلقائية', decideAutoExecute({ status: 'failed', enabled: true, nowMs: now }).code === 'NOT_READY');
  check('B4: ready + مفعَّل ⇒ تنفيذ', decideAutoExecute({ status: 'ready', enabled: true, nowMs: now }).allow === true);
  check('B4: ready لكن حصة YouTube لم تتجدد ⇒ انتظار', decideAutoExecute({ status: 'ready', enabled: true, quotaRetryAt: '2026-10-24T12:00:00Z', nowMs: now }).code === 'QUOTA_WAIT');
  check('B4: ready وحصة تجددت ⇒ تنفيذ', decideAutoExecute({ status: 'ready', enabled: true, quotaRetryAt: '2026-10-24T09:00:00Z', nowMs: now }).allow === true);

  const block = jobAutomationPublicBlock(on);
  check('B4: الكتلة العامة تُعلن defaultOff', block.defaultOff === true);
  check('B4: الكتلة العامة بلا أي حقل سرّي', !/key|secret|token/i.test(JSON.stringify(block)));
}

function testB7(): void {
  check('B7: الحدّ الصريح 500', CONVERSATION_STATE_MAX === 500);
  const list = Array.from({ length: 520 }, (_, i) => i);
  const capped = capNewestFirst(list);
  check('B7: القصّ إلى 500', capped.length === 500);
  check('B7: الأحدث أولاً محفوظ', capped[0] === 0 && capped[499] === 499);
  check('B7: الأقدم أُسقط', !capped.includes(519));
  check('B7: لا يُعدّل المدخل الأصلي', list.length === 520);
  check('B7: ما دون الحدّ يبقى كما هو', capNewestFirst([1, 2, 3]).length === 3);
  const block = conversationLimitsPublicBlock(500, 120);
  check('B7: الكتلة تُعلن الحدّ', block.max === 500);
  check('B7: الكتلة تُعلن بلوغ حدّ المحادثات', block.conversationsCapped === true);
  check('B7: الكتلة لا تُعلن بلوغ حدّ الحالات', block.conversationStatesCapped === false);
}

function testB8(): void {
  check('B8: تطبيع المنصة المجهولة صريح', normalizeSourcePlatform('') === 'unknown' && normalizeSourcePlatform(null) === 'unknown');
  check('B8: تطبيع المنصة بحروف صغيرة', normalizeSourcePlatform('Facebook') === 'facebook');

  const ok = buildCommercialSaleRecord({ id: 's1', sourcePlatform: 'facebook', leadId: 'l1', productName: 'آيفون', amount: 500000, recordedBy: 'u1', recordedAt: '2026-10-05T10:00:00Z' });
  check('B8: سجل بيع صالح يُبنى', ok !== null && ok.amount === 500000 && ok.sourcePlatform === 'facebook');
  check('B8: رفض مبلغ صفر/سالب', buildCommercialSaleRecord({ id: 's2', productName: 'x', amount: 0, recordedBy: 'u', recordedAt: '' }) === null && buildCommercialSaleRecord({ id: 's3', productName: 'x', amount: -5, recordedBy: 'u', recordedAt: '' }) === null);
  check('B8: رفض بلا اسم منتج', buildCommercialSaleRecord({ id: 's4', productName: '  ', amount: 100, recordedBy: 'u', recordedAt: '' }) === null);
  check('B8: رفض مبلغ غير رقمي', buildCommercialSaleRecord({ id: 's5', productName: 'x', amount: 'abc', recordedBy: 'u', recordedAt: '' }) === null);

  const restored = normalizeCommercialSaleRecord({ id: 's6', sourcePlatform: 'instagram', productName: 'غسالة', amount: 250000, recordedAt: '2026-10-05T10:00:00Z' });
  check('B8: تطبيع سجل محفوظ صالح', restored !== null && restored.sourcePlatform === 'instagram');
  check('B8: تطبيع يرفض سجلاً بلا مبلغ موجب', normalizeCommercialSaleRecord({ id: 's7', productName: 'x', amount: -1 }) === null);

  check('B8: مفتاح الشهر من ISO', monthKeyOf('2026-10-05T10:00:00Z') === '2026-10');
  check('B8: مفتاح الشهر لطابع غير صالح ⇒ null', monthKeyOf('not-a-date') === null);

  const report = buildMonthlyCommercialReport({
    monthKey: '2026-10',
    leads: [
      { platform: 'facebook', createdAt: '2026-10-01T00:00:00Z' },
      { platform: 'facebook', createdAt: '2026-10-02T00:00:00Z' },
      { platform: 'instagram', createdAt: '2026-10-03T00:00:00Z' },
      { platform: 'facebook', createdAt: '2026-09-30T00:00:00Z' }, // شهر آخر — يُستبعد
    ],
    sales: [
      { id: 'a', sourcePlatform: 'facebook', leadId: null, conversationId: null, customerName: null, productId: null, productName: 'x', amount: 100000, recordedBy: 'u', recordedAt: '2026-10-04T00:00:00Z' },
      { id: 'b', sourcePlatform: 'instagram', leadId: null, conversationId: null, customerName: null, productId: null, productName: 'y', amount: 200000, recordedBy: 'u', recordedAt: '2026-10-04T00:00:00Z' },
      { id: 'c', sourcePlatform: 'facebook', leadId: null, conversationId: null, customerName: null, productId: null, productName: 'z', amount: 50000, recordedBy: 'u', recordedAt: '2026-09-15T00:00:00Z' }, // شهر آخر
    ],
  });
  check('B8: التقرير يحوي المنصتين فقط', report.rows.length === 2, JSON.stringify(report.rows.map((r) => r.platform)));
  const fb = report.rows.find((r) => r.platform === 'facebook')!;
  check('B8: استفسارات فيسبوك = 2 (يستبعد الشهر الآخر)', fb.inquiries === 2, String(fb.inquiries));
  check('B8: مبيعات فيسبوك = 1', fb.sales === 1, String(fb.sales));
  check('B8: قيمة مبيعات فيسبوك = 100000', fb.salesValue === 100000, String(fb.salesValue));
  check('B8: مجاميع التقرير صحيحة', report.totals.inquiries === 3 && report.totals.sales === 2 && report.totals.salesValue === 300000, JSON.stringify(report.totals));
  check('B8: التقرير لا يخترع صفاً لمنصة بلا بيانات', !report.rows.some((r) => r.platform === 'telegram'));
}

testB4();
testB7();
testB8();

if (failures.length) {
  console.error(`\nPART2 LOGIC TEST FAILED: ${failures.length} failures / ${passed} passed`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nPART2 LOGIC TEST PASSED: ${passed} checks`);
