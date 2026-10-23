/**
 * اختبار وحدة العقل التجاري (Commercial Brain) — منطق خالص بلا شبكة/مزوّد.
 *
 * يثبت:
 *  - تسجيل عميل محتمل من تفاعل حقيقي + ثباته + منع التكرار (idempotency).
 *  - ترقية المرحلة (NEW→ENGAGED→QUALIFIED→NEGOTIATING) بلا ترقية كاذبة إلى WON.
 *  - جدولة المتابعة: فقط لمَن بدأ التواصل، وبعد 24/72 ساعة، وبلا رسالة باردة.
 *  - التفاوض المحدود: قبول ضمن الحدّ، عرض مضاد فوقه، تصعيد للطلبات المبالغ فيها.
 *  - اقتراح الصفقة + التأكيد البشري (لا WON بلا تأكيد مخوَّل).
 *  - الكتلة العامة بلا أي بيانات عميل.
 */

import {
  defaultNegotiationLimits, normalizeNegotiationLimits, maxDiscountPercentFor,
  evaluateNegotiation, monthlyInstallmentFor,
  createCommercialLead, mergeCommercialInteraction, commercialLeadKey,
  requestsNegotiation, parseRequestedDiscountPercent, hasBuyingSignal,
  nextFollowUpAt, isFollowUpDue, applyFollowUpSent,
  buildCommercialProposal, confirmCommercialProposal, rejectCommercialProposal,
  toCommercialLeadRow, summarizeCommercialLeads, commercialPublicBlock,
  COMMERCIAL_MAX_FOLLOWUPS, COMMERCIAL_MAX_DISCOUNT_PERCENT_DEFAULT,
  type CommercialLead, type InboundInteraction,
} from '../commercial/commercialBrain';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const T0 = '2026-10-13T10:00:00.000Z';
const hoursLater = (n: number): string => new Date(Date.parse(T0) + n * 3600_000).toISOString();

function inbound(over: Partial<InboundInteraction> = {}): InboundInteraction {
  return {
    externalId: 'ext-1',
    platform: 'facebook',
    conversationId: 'post-100',
    customerName: 'أحمد',
    text: 'كم سعر الغسالة؟',
    at: T0,
    fromCustomer: true,
    classification: { isBusinessInquiry: true, intent: 'business_inquiry', topic: 'price', isSpam: false },
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
group('1) الحدود والتطبيع');
check('حدود افتراضية: نسبة 5% وسقف مطلق 200,000', (() => {
  const l = defaultNegotiationLimits();
  return l.maxDiscountPercent === COMMERCIAL_MAX_DISCOUNT_PERCENT_DEFAULT && l.maxDiscountAmount === 200000;
})());
check('تطبيع يرفض القيم الفاسدة ويعيد الافتراضي', (() => {
  const l = normalizeNegotiationLimits({ maxDiscountPercent: 'x', maxDiscountAmount: -5 });
  return l.maxDiscountPercent === COMMERCIAL_MAX_DISCOUNT_PERCENT_DEFAULT && l.maxDiscountAmount === 200000;
})());
check('تطبيع يقبل النسبة الصحيحة ويحفظ حدود الفئات', (() => {
  const l = normalizeNegotiationLimits({ maxDiscountPercent: 8, perCategoryPercent: { phones: 3, bad: 500 } });
  return l.maxDiscountPercent === 8 && l.perCategoryPercent?.phones === 3 && l.perCategoryPercent?.bad === undefined;
})());
check('حدّ الفئة يتقدّم على العام', maxDiscountPercentFor(normalizeNegotiationLimits({ maxDiscountPercent: 5, perCategoryPercent: { phones: 3 } }), 'phones') === 3);
check('فئة بلا حدّ خاص تستخدم العام', maxDiscountPercentFor(normalizeNegotiationLimits({ maxDiscountPercent: 5 }), 'appliances') === 5);

group('2) القسط الشهري (تقريب لأعلى دينار)');
check('1,250,000 / 10 = 125,000', monthlyInstallmentFor(1_250_000, 10) === 125_000);
check('تقريب لأعلى: 1,000,003 / 3 = 333,335', monthlyInstallmentFor(1_000_003, 3) === 333_335);
check('شهر واحد = السعر نفسه', monthlyInstallmentFor(500_000, 1) === 500_000);
check('مدة 0 تُصحَّح إلى 1', monthlyInstallmentFor(500_000, 0) === 500_000);

group('3) التفاوض المحدود');
{
  const limits = defaultNegotiationLimits(); // 5% / 200,000 سقف احتياطي
  const cash = 1_000_000;
  const accept = evaluateNegotiation({ cashPrice: cash, requestedDiscountPercent: 3, installmentMonths: 10, limits });
  check('طلب 3% ⇒ قبول', accept.outcome === 'accept');
  check('قبول: خصم 30,000 (3% من سعر مسجّل)', accept.discountAmount === 30_000);
  check('القبول لا يتجاوز الحدّ', accept.exceedsLimit === false);

  const counter = evaluateNegotiation({ cashPrice: cash, requestedDiscountPercent: 6, installmentMonths: 10, limits });
  // 6% = 60,000 > 5%=50,000 لكن < ضِعف الحدّ ⇒ عرض مضاد بالحدّ 5%.
  check('طلب 6% (فوق الحدّ لكن < ضِعف) ⇒ عرض مضاد', counter.outcome === 'counter');
  check('العرض المضاد لا يتجاوز الحدّ (5% = 50,000)', counter.discountAmount === 50_000 && counter.discountPercent === 5);
  check('العرض المضاد يعلن تجاوز الحدّ', counter.exceedsLimit === true);

  const escalate = evaluateNegotiation({ cashPrice: cash, requestedDiscountPercent: 20, installmentMonths: 10, limits });
  // 20% = 200,000 > 2×(5%=50,000)=100,000 ⇒ تصعيد.
  check('طلب 20% (مبالغ فيه) ⇒ تصعيد للمالك', escalate.outcome === 'escalate');
  check('التصعيد بلا قرار منفرد', escalate.reason.includes('يُصعَّد'));

  const noPrice = evaluateNegotiation({ cashPrice: 0, requestedDiscountPercent: 5, installmentMonths: 10, limits });
  check('غياب سعر مسجّل ⇒ تصعيد (لا تخمين)', noPrice.outcome === 'escalate');
}
check('طلب 6% على 1,000,000 ⇒ عرض مضاد بالحدّ الأقصى (5%) ثم لا يُخترق', (() => {
  const d = evaluateNegotiation({ cashPrice: 1_000_000, requestedDiscountPercent: 6, installmentMonths: 10, limits: defaultNegotiationLimits() });
  return d.outcome === 'counter' && d.discountPercent === 5;
})());
check('الفئة الخاصة (هواتف 2%) تُقيّد', (() => {
  // طلب 3% = 30,000 على 1,000,000؛ حدّ الهواتف 2% = 20,000؛ 30,000 > 20,000 لكن < 2×20,000 ⇒ عرض مضاد بـ2%.
  const d = evaluateNegotiation({ cashPrice: 1_000_000, requestedDiscountPercent: 3, installmentMonths: 10, category: 'phones', limits: normalizeNegotiationLimits({ maxDiscountPercent: 5, perCategoryPercent: { phones: 2 } }) });
  return d.outcome === 'counter' && d.discountPercent === 2;
})());
check('السقف المطلق يحمي المنتجات المكلفة (20,000,000 × 2% ⇒ عرض مضاد 200,000)', (() => {
  const d = evaluateNegotiation({ cashPrice: 20_000_000, requestedDiscountPercent: 2, installmentMonths: 10, limits: defaultNegotiationLimits() });
  return d.outcome === 'counter' && d.discountAmount === 200_000;
})());
check('طلب مبالغ فيه على منتج مكلف ⇒ تصعيد (السقف المطلق يوقف)', (() => {
  const d = evaluateNegotiation({ cashPrice: 20_000_000, requestedDiscountPercent: 5, installmentMonths: 10, limits: defaultNegotiationLimits() });
  return d.outcome === 'escalate';
})());

group('4) كشف التفاوض/الشراء من النص');
check('«خصملي شكد» ⇒ طلب تفاوض', requestsNegotiation('خصملي شكد تكدر تسويلي') === true);
check('«كم سعرها؟» ⇒ ليس تفاوضاً', requestsNegotiation('كم سعرها؟') === false);
check('استخراج نسبة «خصم 10%»', parseRequestedDiscountPercent('سويلي خصم 10%') === 10);
check('استخراج نسبة عربية «خصم ٧»', parseRequestedDiscountPercent('خصم ٧ بالمية') === 7);
check('نص بلا نسبة ⇒ null', parseRequestedDiscountPercent('خصملي') === null);
check('إشارة شراء: «اريد اشتري»', hasBuyingSignal(null, 'اريد اشتري الغسالة') === true);
check('إشارة شراء من التصنيف (استفسار أعمال)', hasBuyingSignal({ isBusinessInquiry: true }, 'شنو التفاصيل') === true);
check('لا إشارة شراء في «شكراً»', hasBuyingSignal(null, 'شكراً جزيلاً') === false);

group('5) تسجيل العميل المحتمل + التكرار');
{
  const lead = createCommercialLead(inbound());
  check('عميل جديد من تفاعل حقيقي', lead.platform === 'facebook' && lead.touches === 1);
  check('بدأ العميل التواصل', lead.initiatedByCustomer === true);
  check('سجّل معرّف الحدث الحقيقي', lead.sourceEventIds.includes('ext-1'));
  check('الحالة: استفسار شراء ⇒ QUALIFIED', lead.stage === 'QUALIFIED');
  check('لا ترقية إلى WON تلقائياً', lead.stage !== 'WON');
  const merged = mergeCommercialInteraction(lead, inbound({ externalId: 'ext-1' }));
  check('نفس الحدث ⇒ idempotent (لا تكرار)', merged.touches === lead.touches && merged.sourceEventIds.length === 1);
  const merged2 = mergeCommercialInteraction(lead, inbound({ externalId: 'ext-2', text: 'ممكن خصم 3%؟' }));
  check('حدث جديد ⇒ +touch ومرحلة تفاوض', merged2.touches === 2 && merged2.stage === 'NEGOTIATING');
}
check('مفتاح العميل = منصة+خيط (بلا اختراع هوية)', commercialLeadKey('Facebook', 'post-9') === 'facebook::post-9');
check('عميل لم يبدأ التواصل لا يُعدّ initiatedByCustomer', createCommercialLead(inbound({ fromCustomer: false })).initiatedByCustomer === false);

group('6) جدولة المتابعة (من رد المعرض، لا من تعليق الزبون)');
{
  const lead = createCommercialLead(inbound());
  // بلا رد للمعرض لا أساس لمتابعة (لا نُنكز على سؤال لم نُجب عنه).
  check('بلا رد للمعرض ⇒ لا نافذة متابعة', nextFollowUpAt(lead) === null);
  check('بلا رد للمعرض ⇒ غير مستحقة', isFollowUpDue(lead, hoursLater(25)).due === false);

  // رد المعرض بعد 5 ساعات ⇒ المتابعة بعد 48 ساعة من **ردّنا** (لا من تعليق الزبون).
  const replied = { ...lead, lastBusinessReplyAt: hoursLater(5) };
  check('نافذة المتابعة = رد المعرض + 48 ساعة', nextFollowUpAt(replied) === hoursLater(5 + 48));
  check('قبل الموعد ⇒ غير مستحقة', isFollowUpDue(replied, hoursLater(5 + 47)).due === false);
  check('بعد الموعد ⇒ مستحقة', isFollowUpDue(replied, hoursLater(5 + 49)).due === true);

  // المحادثة حيّة: ردّ الزبون بعد آخر رد للمعرض ⇒ لا متابعة.
  const live = { ...replied, lastCustomerInteractionAt: hoursLater(6) };
  check('ردّ الزبون بعد رد المعرض ⇒ لا متابعة', nextFollowUpAt(live) === null);
  check('حالة المتابعة STOPPED عند عدم بدء العميل', (() => {
    const cold = createCommercialLead(inbound({ fromCustomer: false }));
    return isFollowUpDue(cold, hoursLater(48)).state === 'STOPPED';
  })());
  check('لا متابعة بعد استنفاد الحدّ', (() => {
    const l: CommercialLead = { ...replied, followUpsSent: COMMERCIAL_MAX_FOLLOWUPS };
    return nextFollowUpAt(l) === null;
  })());
  // إرسال متابعة حقيقي يزيد العدّاد ويسجّل ردّ المعرض.
  const sent = applyFollowUpSent(replied, hoursLater(5 + 48));
  check('إرسال متابعة ⇒ +1 وردّ معرض مسجّل', sent.followUpsSent === 1 && sent.lastBusinessReplyAt === hoursLater(5 + 48));
  check('متابعة واحدة فقط ⇒ لا نافذة تالية', sent.nextFollowUpAt === null);
  check('لا متابعة لعميل محسوم (WON)', nextFollowUpAt({ ...replied, stage: 'WON' }) === null);
}

group('7) اقتراح الصفقة + التأكيد البشري');
{
  const lead = createCommercialLead(inbound());
  const neg = evaluateNegotiation({ cashPrice: 1_000_000, requestedDiscountPercent: 3, installmentMonths: 10, limits: defaultNegotiationLimits() });
  const proposal = buildCommercialProposal({ id: 'prop-1', product: { id: 'p1', name: 'غسالة', cashPrice: 1_000_000 }, negotiation: neg, installmentMonths: 10, at: T0 });
  check('اقتراح يُبنى من سعر مسجّل', proposal !== null && proposal.cashPrice === 1_000_000);
  check('الاقتراح يبدأ pending (لا إغلاق تلقائي)', proposal?.status === 'pending');
  check('لا اقتراح بلا سعر مسجّل', buildCommercialProposal({ id: 'x', product: { id: 'p', name: 'x', cashPrice: 0 }, negotiation: neg, installmentMonths: 10, at: T0 }) === null);

  const withProposal: CommercialLead = { ...lead, stage: 'PROPOSAL_PENDING', pendingProposal: proposal };
  const denied = confirmCommercialProposal({ lead: withProposal, proposalId: 'prop-1', confirmedBy: 'staff', allowed: false, at: T0 });
  check('غير مخوَّل ⇒ لا تأكيد', denied.ok === false);
  const confirmed = confirmCommercialProposal({ lead: withProposal, proposalId: 'prop-1', confirmedBy: 'owner', allowed: true, at: T0 });
  check('المالك يؤكّد ⇒ ok + WON', confirmed.ok === true && confirmed.leadStage === 'WON');
  check('التأكيد يوثّق المؤكِّد والوقت', confirmed.proposal?.status === 'confirmed' && confirmed.proposal?.confirmedBy === 'owner');
  const rejected = rejectCommercialProposal(withProposal, 'prop-1', T0);
  check('الرفض لا يُغلق (status=rejected)', rejected?.status === 'rejected');
  check('تأكيد اقتراح غير مطابق يفشل', confirmCommercialProposal({ lead: withProposal, proposalId: 'nope', confirmedBy: 'owner', allowed: true, at: T0 }).ok === false);
}

group('8) الصفّ والملخص والكتلة العامة (بلا بيانات عميل في العامة)');
{
  const lead = createCommercialLead(inbound());
  const row = toCommercialLeadRow(lead);
  check('الصفّ يحمل مسمّى المرحلة العربية', row.stageLabelAr === 'مؤهّل');
  check('الصفّ يحمل حالة المتابعة', typeof row.followUpLabelAr === 'string' && row.followUpLabelAr.length > 0);
  const summary = summarizeCommercialLeads([lead], hoursLater(1));
  check('الملخص يحسب الإجمالي وهذا التوزيع', summary.total === 1 && summary.byStage.QUALIFIED === 1);
  const pub = commercialPublicBlock([lead], hoursLater(1));
  check('الكتلة العامة: أرقام فقط بلا اسم/نص عميل', !('customerName' in pub) && !('lastCustomerText' in pub) && (pub as any).leads === 1);
  check('الكتلة العامة تعلن عدم التنفيذ الخارجي وعدم إغلاق بلا بشر', pub.executesExternalActions === false && pub.closesDealWithoutHuman === false);
}

console.log('\n============================================================');
if (failures.length === 0) {
  console.log(`PASSED: ${passed} commercial brain checks`);
  process.exit(0);
} else {
  console.error(`FAILED: ${failures.length} of ${passed + failures.length} checks:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
