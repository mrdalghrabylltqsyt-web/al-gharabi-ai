/**
 * Batch 6 — اختبار قرار العقل المركزي المحكوم (منطق صافٍ، بلا شبكة/أسرار/ساعة حقيقية).
 *
 * يثبت أن العقل المركزي **فوق** الوكلاء الستة: يجمع مخرجاتهم، يمرّر القرار عبر
 * الحوكمة، ويحدّد الحالة النهائية بصدق (إجراء مسموح/موافقة/تصعيد/لا إجراء/توقف آمن).
 * ولا يُنفّذ أي إجراء خارجي، ولا يخترع معلومة.
 */
import {
  composeBrainDecision, summarizeBrainDecision, BRAIN_DECISION_STATUSES,
} from '../../brain/team/brainDecision';
import { escalateBrainDecision, decisionNeedsEscalation } from '../../brain/team/brainEscalation';
import type { TeamSession, TeamDecision, TeamAgentOutput } from '../../brain/team/types';
import type { EscalationRecord } from '../../social/escalation';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const NOW = Date.parse('2026-10-04T09:00:00.000Z');
const AT = new Date(NOW).toISOString();

function out(agentId: TeamAgentOutput['agentId'], statement: string, truthState: TeamAgentOutput['truthState'], kind: TeamAgentOutput['kind'] = 'analysis'): TeamAgentOutput {
  return {
    agentId, status: 'ran', kind, truthState, statement, evidence: [`دليل: ${statement.slice(0, 20)}`],
    source: 'socialComments (youtube)', sampleSize: 5, confidence: 'medium',
    limitations: 'حدود معروفة.', provenance: 'deterministic', at: AT,
  };
}

function session(over: Partial<TeamSession> = {}): TeamSession {
  const decision: TeamDecision = {
    statement: 'قرار مقترح: جهّز مسودة رد من الحقائق المسجّلة.',
    truthState: 'DERIVED', confidence: 'medium', verified: true, verificationNote: 'خضع لتحقق ناقد.',
    limitations: ['الثقة محدودة بالدليل المتاح.'], requiresHumanApproval: true,
    proposedAction: 'جهّز مسودة رد من الحقائق المسجّلة ومرّرها عبر بوابة الرد القائمة.',
    evidence: ['e1', 'e2'],
  };
  return {
    teamSessionId: 'team-test', task: 'تحليل تعليق YouTube والبتّ في الرد', trigger: 'youtube_event',
    source: 'youtube', participants: ['orchestrator', 'research', 'analysis', 'strategy', 'critic', 'decision'],
    evidence: ['e1'],
    observations: [out('research', 'وُجدت 5 تعليقات حقيقية.', 'FACT', 'observation')],
    analyses: [out('analysis', 'استنتاج: نسبة أسئلة مرتفعة.', 'DERIVED')],
    recommendations: [out('strategy', 'توصية: رد موجّه من الحقائق.', 'HYPOTHESIS', 'recommendation')],
    objections: [out('critic', 'لا رصد ادعاء غير مدعوم.', 'FACT', 'objection')],
    conflicts: [],
    decision,
    brainDecision: null,
    confidence: 'medium', truthState: 'DERIVED', status: 'completed',
    createdAt: AT, updatedAt: AT, memoryWritten: false, memoryRecordIds: [],
    criticRejections: 0, criticRan: true, criticFailed: false,
    persistence: { ok: true, error: null }, dedupeKey: 'team:youtube:comment:x', failedAgents: 0,
    ...over,
  };
}

const baseInput = (over: Partial<Parameters<typeof composeBrainDecision>[0]> = {}) => ({
  session: session(),
  platform: 'youtube',
  eventIdentity: 'comment:c1',
  objective: 'البتّ في رد آمن',
  context: { conversationId: 'youtube::v1', sessionMessages: 5, memoryActive: 3 },
  capabilities: { replyCapable: true, publishCapable: true },
  providerVerified: true,
  externalApproved: true,
  escalationReason: null as any,
  now: NOW,
  ...over,
});

// 1) الهرمية: العقل يتبنّى نموذج الجلسة ويجمع كل الوكلاء.
{
  const d = composeBrainDecision(baseInput());
  check('يتبنّى قرار العقل الجلسة', d.teamSessionId === 'team-test' && d.eventIdentity === 'comment:c1');
  check('يجمع كل الوكلاء المشاركين', d.consultedAgents.length === 6);
  check('يسجّل رؤية كل وكيل (تتبّع)', d.agentFindings.length === 4, String(d.agentFindings.length));
  check('الحالة النهائية ضمن المحدّد', BRAIN_DECISION_STATUSES.includes(d.finalStatus));
  check('مرجع التتبّع موجود', Boolean(d.auditRef) && d.auditRef.includes('team-test'));
  check('يحمل الهدف والسياق', d.objective === 'البتّ في رد آمن' && d.context.memoryActive === 3);
}

// 2) إجراء خارجي معتمد + مزود موثق + نقد ناجح => مسموح (لكن لا يُنفَّذ من العقل).
{
  const d = composeBrainDecision(baseInput({ externalApproved: true, providerVerified: true }));
  check('إجراء خارجي معتمد وموثق => ALLOWED_ACTION', d.finalStatus === 'ALLOWED_ACTION', d.finalStatus);
  check('الصلاحية المطلوبة EXTERNAL_ACTION', d.requiredPermission === 'EXTERNAL_ACTION');
  check('الحوكمة مسموحة', d.governance.allowed === true && d.governance.code === 'ALLOWED');
  check('ملاحظة: لا تنفيذ خارجي من العقل', d.notes.some((n) => n.includes('لا يُنفَّذ')));
}

// 3) إجراء خارجي بلا موافقة => APPROVAL_REQUIRED (لا تنفيذ صامت).
{
  const d = composeBrainDecision(baseInput({ externalApproved: false }));
  check('بلا موافقة => APPROVAL_REQUIRED', d.finalStatus === 'APPROVAL_REQUIRED', d.finalStatus);
  check('الحوكمة تطلب موافقة', d.governance.code === 'APPROVAL_REQUIRED' && d.governance.requiresApproval);
}

// 4) مزود غير موثق => ادعاء غير مثبت => توقف آمن (لا إجراء على ادعاء).
{
  const d = composeBrainDecision(baseInput({ providerVerified: false }));
  check('مزود غير موثق => FAILED_SAFE', d.finalStatus === 'FAILED_SAFE', d.finalStatus);
  check('الفشل الآمن سببه ادعاء غير مثبت', d.governance.code === 'UNVERIFIED_CLAIM');
}

// 5) فشل الناقد => القرار غير متحقق => توقف آمن.
{
  const s = session({ decision: { ...(session().decision as TeamDecision), verified: false }, criticFailed: true });
  const d = composeBrainDecision(baseInput({ session: s }));
  check('ناقد فشل => FAILED_SAFE', d.finalStatus === 'FAILED_SAFE', d.finalStatus);
  check('ملاحظة النقد الفاشل ظاهرة', d.notes.some((n) => n.includes('فشل الناقد')));
}

// 6) غياب القرار أو فشل الجلسة => FAILED_SAFE.
{
  const d1 = composeBrainDecision(baseInput({ session: session({ decision: null }) }));
  check('بلا قرار => FAILED_SAFE', d1.finalStatus === 'FAILED_SAFE');
  const d2 = composeBrainDecision(baseInput({ session: session({ status: 'failed' }) }));
  check('جلسة فاشلة => FAILED_SAFE', d2.finalStatus === 'FAILED_SAFE');
}

// 7) حساس (سعر غير موثّق/شكوى) => تصعيد بشري دائماً، لا أتمتة.
{
  const dPrice = composeBrainDecision(baseInput({ escalationReason: 'price_unverified' }));
  check('سعر غير موثّق => HUMAN_ESCALATION', dPrice.finalStatus === 'HUMAN_ESCALATION', dPrice.finalStatus);
  check('سبب التصعيد معرّب', Boolean(dPrice.escalation.reasonLabelAr) && dPrice.escalation.required);
  const dComplaint = composeBrainDecision(baseInput({ escalationReason: 'complaint' }));
  check('شكوى => HUMAN_ESCALATION', dComplaint.finalStatus === 'HUMAN_ESCALATION');
}

// 8) قدرة غير متاحة => لا توصية/إجراء بما لا يمكن تنفيذه (لا إجراء).
{
  const d = composeBrainDecision(baseInput({ capabilities: { replyCapable: false, publishCapable: false } }));
  check('بلا قدرة رد => لا إجراء خارجي', d.proposedAction.kind === 'internal_response' || d.proposedAction.kind === 'none');
  check('لا EXTERNAL_ACTION بلا قدرة', d.requiredPermission !== 'EXTERNAL_ACTION');
}

// 9) لا دليل كافٍ (truthState UNKNOWN) => لا إجراء (NO_ACTION)، لا اختراع.
{
  const s = session({ decision: { ...(session().decision as TeamDecision), truthState: 'UNKNOWN' }, truthState: 'UNKNOWN' });
  const d = composeBrainDecision(baseInput({ session: s }));
  check('بلا دليل => NO_ACTION', d.finalStatus === 'NO_ACTION', d.finalStatus);
  check('الاقتراح نوعه none', d.proposedAction.kind === 'none');
}

// 10) الخلافات تبقى مرئية ولا تُحسم بلا دليل.
{
  const s = session({ conflicts: [{ id: 'c1', between: ['strategy', 'critic'], statement: 'منصة غير متصلة', leftState: 'HYPOTHESIS', rightState: 'UNAVAILABLE', resolved: false, reason: 'يحتاج اتصالاً موثقاً' }] });
  const d = composeBrainDecision(baseInput({ session: s }));
  check('الخلاف يظهر في القرار', d.disagreements.length === 1 && d.disagreements[0].resolved === false);
  check('ملاحظة الخلاف ظاهرة', d.notes.some((n) => n.includes('خلافات')));
}

// 11) التمثيل المختصر.
{
  const s = summarizeBrainDecision(null);
  check('ملخّص بلا قرار = أصفار', s.finalStatus === null && s.consultedAgents === 0);
  const d = composeBrainDecision(baseInput());
  const sum = summarizeBrainDecision(d);
  check('الملخّص يحمل الحالة والوكلاء', sum.finalStatus === d.finalStatus && sum.consultedAgents === 6);
}

// 12) جسر التصعيد: يُسجَّل فقط للحالات التي تحتاج بشراً؛ منع التكرار؛ لا ادّعاء إشعار.
{
  const humanDecision = composeBrainDecision(baseInput({ escalationReason: 'complaint' }));
  check('قرار بشري يستحق تصعيداً', decisionNeedsEscalation(humanDecision) === true);
  const allowedDecision = composeBrainDecision(baseInput());
  check('قرار مسموح لا يستحق تصعيداً', decisionNeedsEscalation(allowedDecision) === false);

  const stored: EscalationRecord[] = [];
  let delivered = 0;
  const hook = {
    list: () => stored,
    record: (r: EscalationRecord) => stored.push(r),
    newId: () => `esc-${stored.length + 1}`,
  };
  const o1 = escalateBrainDecision(humanDecision, { externalId: 'c1', commentText: 'كم السعر؟', nowIso: AT, notifier: () => { delivered += 1; return { delivered: true, channel: 'in_app_notification', error: null }; } }, hook);
  check('يُنشئ تصعيداً للحالة الحسّاسة', o1.created === true && stored.length === 1);
  check('الإشعار وُصل فعلاً (مُبلِّغ ناجح)', o1.notificationDelivered === true);
  // تكرار لنفس التعليق المفتوح => لا تصعيد مزدوج.
  const o2 = escalateBrainDecision(humanDecision, { externalId: 'c1', commentText: 'كم السعر؟', nowIso: AT, notifier: null }, hook);
  check('منع تكرار التصعيد لنفس التعليق', o2.created === false && o2.skipped === 'duplicate_open_escalation' && stored.length === 1);
  // بلا مُبلِّغ => لا ادّعاء إشعار.
  const o3 = escalateBrainDecision(humanDecision, { externalId: 'c2', commentText: 'شكوى', nowIso: AT, notifier: null }, hook);
  check('بلا مُبلِّغ لا يُدّعى إشعار', o3.created === true && o3.notificationDelivered === false && Boolean(o3.notificationError));
  // القرار المسموح لا يُنشئ تصعيداً.
  const o4 = escalateBrainDecision(allowedDecision, { externalId: 'c3', commentText: 'مدح', nowIso: AT, notifier: null }, hook);
  check('القرار المسموح لا يصعّد', o4.created === false && o4.skipped === 'not_required');
}

// 13) استقلال النموذج: composeBrainDecision لا يعدّل الجلسة ولا ينفّذ.
{
  const s = session();
  const before = JSON.stringify(s);
  composeBrainDecision(baseInput({ session: s }));
  check('لا يعدّل الجلسة الأصلية', JSON.stringify(s) === before);
}

if (failures.length) {
  console.error(`FAILED: ${failures.length}\n` + failures.join('\n'));
  process.exit(1);
}
console.log(`PASSED: ${passed} brain decision (Batch 6) checks`);
