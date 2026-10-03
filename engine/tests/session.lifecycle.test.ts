/**
 * MASTER BATCH — اختبار وحدة لدورة حياة المحادثة والتصعيد البشري وفصل الذاكرة.
 *
 * منطق صافٍ: لا شبكة ولا أسرار ولا ساعة حقيقية (الزمن يُمرَّر).
 */
import {
  nextConversationState,
  canTransition,
  isTerminalLifecycle,
  CONVERSATION_LIFECYCLE_STATES,
  CONVERSATION_LIFECYCLE_LABELS_AR,
  type ConversationLifecycleState,
} from '../social/conversationLifecycle';
import {
  createEscalationRecord,
  transitionEscalation,
  hasPendingEscalation,
  isEscalationOpen,
  escalationReasonFor,
  ESCALATION_STATES,
  type EscalationNotifier,
} from '../social/escalation';
import {
  classifyConversationMessage,
  classifyLongTermCandidate,
  canPromoteToLongTerm,
  LONG_TERM_MEMORY_KINDS,
} from '../social/memorySeparation';
import { createConversationState, appendMessage, isConversationStale, pruneStaleConversations, shortTermWindow, CONVERSATION_DEFAULT_TTL_MS } from '../social/conversationState';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const NOW = '2026-10-03T10:00:00.000Z';

// --- 1) دورة حياة المحادثة: انتقالات صالحة/غير صالحة + منع الإغلاق مع تصعيد ---
{
  check('الحالات الأربع معلنة', CONVERSATION_LIFECYCLE_STATES.length === 4 && !!CONVERSATION_LIFECYCLE_LABELS_AR.RESOLVED);

  const t = (current: ConversationLifecycleState, event: any, pendingEscalation = false) =>
    nextConversationState({ current, event, pendingEscalation });

  // انتقالات صالحة.
  check('OPEN + customer_message ⇒ AWAITING_BUSINESS', t('OPEN', 'customer_message').to === 'AWAITING_BUSINESS');
  check('OPEN + business_reply ⇒ OPEN', t('OPEN', 'business_reply').ok === true && t('OPEN', 'business_reply').to === 'OPEN');
  check('AWAITING_BUSINESS + business_reply ⇒ OPEN', t('AWAITING_BUSINESS', 'business_reply').to === 'OPEN');
  check('escalation_recorded ⇒ ESCALATED', t('OPEN', 'escalation_recorded').to === 'ESCALATED');
  check('ESCALATED + escalation_resolved ⇒ OPEN', t('ESCALATED', 'escalation_resolved').to === 'OPEN');
  check('OPEN + resolve_requested ⇒ RESOLVED', t('OPEN', 'resolve_requested').to === 'RESOLVED');
  check('RESOLVED + reopen ⇒ OPEN', t('RESOLVED', 'reopen').to === 'OPEN');

  // منع الإغلاق مع تصعيد معلّق (القاعدة الصلبة).
  const blockedResolve = t('ESCALATED', 'resolve_requested', true);
  check('لا RESOLVED مع تصعيد معلّق (ESCALATED)', blockedResolve.ok === false && blockedResolve.to === 'ESCALATED');
  const blockedFromOpen = t('OPEN', 'resolve_requested', true);
  check('لا RESOLVED مع تصعيد معلّق (OPEN)', blockedFromOpen.ok === false && blockedFromOpen.reasonAr.includes('تصعيد'));
  const allowedAfterResolved = t('ESCALATED', 'resolve_requested', false);
  check('RESOLVED مسموح بعد رفع التصعيد', allowedAfterResolved.ok === true && allowedAfterResolved.to === 'RESOLVED');

  // انتقالات غير صالحة.
  check('RESOLVED → AWAITING_BUSINESS غير صالح', canTransition('RESOLVED', 'AWAITING_BUSINESS') === false);
  check('ESCALATED → AWAITING_BUSINESS غير صالح', canTransition('ESCALATED', 'AWAITING_BUSINESS') === false);
  check('لا انتقال بلا تغيير', canTransition('OPEN', 'OPEN') === false);

  // رسالة عميل على مُصعّدة تبقى مُصعّدة (no-op مقبول صراحةً).
  const esc = t('ESCALATED', 'customer_message', true);
  check('رسالة عميل على مُصعّدة تبقى مُصعّدة', esc.ok === true && esc.to === 'ESCALATED');
  // رسالة عميل على مغلقة تُعيد الفتح.
  check('رسالة عميل على مغلقة تُعيد الفتح', t('RESOLVED', 'customer_message').to === 'OPEN');

  check('RESOLVED حالة نهائية', isTerminalLifecycle('RESOLVED') === true && isTerminalLifecycle('OPEN') === false);
}

// --- 2) التصعيد البشري ---
{
  const notifierOk: EscalationNotifier = () => ({ delivered: true, channel: 'in_app_notification', error: null });
  const notifierFail: EscalationNotifier = () => ({ delivered: false, channel: null, error: 'smtp_down' });
  const notifierThrow: EscalationNotifier = () => { throw new Error('boom'); };

  const base = { id: 'esc1', platform: 'youtube', conversationId: 'youtube::vid1', subjectId: 'vid1', externalId: 'c1', commentText: 'كم السعر؟', reason: 'price_unverified' as const, nowIso: NOW };

  const withOk = createEscalationRecord({ ...base, notifier: notifierOk });
  check('تصعيد بإشعار ناجح ⇒ delivered=true وchannel معلن', withOk.notificationDelivered === true && withOk.notificationChannel === 'in_app_notification' && withOk.notificationError === null);
  check('التصعيد يبدأ PENDING', withOk.state === 'PENDING');

  const noNotifier = createEscalationRecord({ ...base, notifier: null });
  check('بلا مُبلِّغ ⇒ لا ادّعاء إشعار', noNotifier.notificationDelivered === false && noNotifier.notificationError !== null);

  const failed = createEscalationRecord({ ...base, notifier: notifierFail });
  check('فشل الإشعار ⇒ delivered=false مع السبب', failed.notificationDelivered === false && failed.notificationError === 'smtp_down');

  const threw = createEscalationRecord({ ...base, notifier: notifierThrow });
  check('رمي المُبلِّغ ⇒ لا ادّعاء إشعار ولا انهيار', threw.notificationDelivered === false && threw.notificationError === 'Error');

  // انتقالات الحالة.
  const ack = transitionEscalation(withOk, 'acknowledge', 'owner', NOW);
  check('PENDING → ACKNOWLEDGED', ack.state === 'ACKNOWLEDGED' && ack.acknowledgedBy === 'owner');
  const resolved = transitionEscalation(ack, 'resolve', 'owner', NOW);
  check('ACKNOWLEDGED → RESOLVED', resolved.state === 'RESOLVED' && resolved.resolvedAt === NOW);
  const noDoubleResolve = transitionEscalation(resolved, 'resolve', 'owner', NOW);
  check('لا حلّ مزدوج', noDoubleResolve === resolved);
  const noAckResolved = transitionEscalation(resolved, 'acknowledge', 'owner', NOW);
  check('لا إطّلاع على محلول', noAckResolved === resolved);

  // hasPendingEscalation يمنع الإغلاق.
  check('تصعيد PENDING معلّق', hasPendingEscalation([withOk], 'youtube::vid1') === true);
  check('تصعيد RESOLVED ليس معلّقاً', hasPendingEscalation([resolved], 'youtube::vid1') === false);
  check('محادثة أخرى غير متأثرة', hasPendingEscalation([withOk], 'youtube::vid2') === false);
  check('isEscalationOpen صحيح للحالتين المفتوحتين', isEscalationOpen(withOk) && isEscalationOpen(ack) && !isEscalationOpen(resolved));
  check('الحالات الثلاث معلنة', ESCALATION_STATES.length === 3);

  // تحديد السبب من التصنيف (بلا اختراع).
  check('سبام ⇒ spam', escalationReasonFor({ isSpam: true }) === 'spam');
  check('شكوى ⇒ complaint', escalationReasonFor({ intent: 'complaint' }) === 'complaint');
  check('سعر ⇒ price_unverified', escalationReasonFor({ topic: 'price' }) === 'price_unverified');
  check('حساس ⇒ sensitive', escalationReasonFor({ requiresHumanReview: true }) === 'sensitive');
  check('سؤال ⇒ unclear', escalationReasonFor({ intent: 'question' }) === 'unclear');
  check('مدح ⇒ لا تصعيد', escalationReasonFor({ intent: 'praise' }) === null);
}

// --- 3) فصل الذاكرة: سياق الجلسة ≠ الذاكرة طويلة المدى ---
{
  const convo = appendMessage(createConversationState({ conversationId: 'x::t', nowIso: NOW }), { role: 'customer', text: 'كم السعر؟', at: NOW });
  const msgClass = classifyConversationMessage(convo.messages[0]);
  check('رسالة محادثة ⇒ تبقى في سياق الجلسة', msgClass.tier === 'session_context');
  check('لا ترقية لرسالة محادثة', canPromoteToLongTerm(msgClass).allowed === false);

  const saleNoEvidence = classifyLongTermCandidate({ kind: 'verified_sale', hasEvidence: false });
  check('بيع بلا دليل ⇒ لا ترقية', saleNoEvidence.tier === 'session_context' && canPromoteToLongTerm(saleNoEvidence).allowed === false);

  const saleEvidence = classifyLongTermCandidate({ kind: 'verified_sale', hasEvidence: true });
  check('بيع بدليل ⇒ يُرقّى', saleEvidence.tier === 'long_term_memory' && canPromoteToLongTerm(saleEvidence).allowed === true);

  const lead = classifyLongTermCandidate({ kind: 'qualified_lead', hasEvidence: true });
  check('عميل مؤهّل بدليل ⇒ يُرقّى', canPromoteToLongTerm(lead).allowed === true);

  const fact = classifyLongTermCandidate({ kind: 'verified_product_fact', hasEvidence: true });
  check('معلومة منتج موثّقة ⇒ تُرقّى', canPromoteToLongTerm(fact).allowed === true);

  check('الأنواع المسموحة معلنة (4)', LONG_TERM_MEMORY_KINDS.length === 4);
  check('لا ترقية لنوع غير مسموح', canPromoteToLongTerm({ tier: 'long_term_memory', kind: 'conversation_message' as any, reasonAr: '', hasEvidence: true }).allowed === false);
}

// --- 4) TTL: عمر النافذة قصيرة المدى + الشذب + القصّ ---
{
  const created = '2026-10-03T10:00:00.000Z';
  const t0 = Date.parse(created);
  let c = createConversationState({ conversationId: 'x::ttl', nowIso: created });
  c = appendMessage(c, { role: 'customer', text: 'مرحبا', at: created });

  check('محادثة حديثة ليست منتهية', isConversationStale(c, t0 + 1000) === false);
  check('محادثة تنتهي بعد TTL الافتراضي', isConversationStale(c, t0 + CONVERSATION_DEFAULT_TTL_MS + 1000) === true);

  const kept = pruneStaleConversations([c], t0 + 1000);
  check('الشذب يُبقي الحديثة', kept.length === 1);
  const pruned = pruneStaleConversations([c], t0 + CONVERSATION_DEFAULT_TTL_MS + 1000);
  check('الشذب يُسقط المنتهية', pruned.length === 0);

  // زمن مشوّه ⇒ تُعتبر منتهية (لا تبقى للأبد).
  const bad = { ...c, createdAt: 'not-a-date', lastActivityAt: null };
  check('زمن مشوّه ⇒ منتهية (لا تراكم)', isConversationStale(bad as any, t0) === true);

  // القصّ: نافذة 10 رسائل تُظهر آخر 10 فقط وتُعلن القصّ.
  let many = createConversationState({ conversationId: 'x::many', nowIso: created });
  for (let i = 0; i < 15; i += 1) many = appendMessage(many, { role: i % 2 ? 'business' : 'customer', text: `m${i}`, at: created });
  const win = shortTermWindow(many, { size: 10 });
  check('النافذة قصيرة المدى = آخر 10 رسائل', win.messages.length === 10 && win.messages[9].text === 'm14');
  check('القصّ مُعلَن صراحةً', win.truncated === true);
  const smallWin = shortTermWindow(many, { size: 20 });
  check('بلا قصّ إن كانت النافذة تكفي', smallWin.truncated === false && smallWin.messages.length === 15);
}

console.log(`PASSED: ${passed} session lifecycle/escalation/memory checks`);
if (failures.length) {
  console.error('FAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
