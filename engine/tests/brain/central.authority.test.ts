/**
 * Batch 8.1 — فرض سلطة العقل المركزي (اختبارات معمارية، منطق صافٍ بلا شبكة).
 *
 * يُثبت الفجوات الثلاث المغلقة:
 *   1) سلطة قرار واحدة: `resolveCommentExecution` مشتقّة من قرار العقل المركزي
 *      (`composeBrainDecision`)؛ لا رد بلا ALLOWED_ACTION؛ والتصنيف استشاري فقط.
 *   2) قراءة السجل: `decisionHistoryToMemoryRecords` تُرحّل النتائج الملاحَظة فقط
 *      إلى ذاكرة العقل القائمة (بلا نظام ثانٍ)، و`buildRuntimeDecisionContext` يقرأها.
 *   3) استهلاك الإدراك: السبب الحقيقي + السياق التجاري (استراتيجية/جمهور/سياق قرارات)
 *      يدخل قرار العقل كدليل (لا عقل ثانٍ، وليس استشارياً فقط).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decideCommentAction,
  resolveCommentExecution,
  defaultWatcherControls,
  type CommentDecision,
  type CentralActionDecision,
} from '../../social/youtubeWatcher';
import {
  buildRuntimeDecisionContext,
  decisionHistoryToMemoryRecords,
  buildRuntimeBrain,
  type RuntimeBrainInput,
} from '../../brain/runtime';
import { emptyDecisionLedger, recordDecision, attachOutcome } from '../../brain/cognition/decisionLedger';
import { researchAgent } from '../../brain/team/agents';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const ROOT = process.cwd();
const ENABLED = { ...defaultWatcherControls(), autoReply: true, humanReviewMode: true };

// AC-safe advisory: مدح (لا يُصعَّد في وضع المراجعة) — يسمح بأن يكون قرار العقل هو الفيصل.
const safeAdvisory: CommentDecision = decideCommentAction({
  intent: 'praise', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: ENABLED,
});

// -------------------------------------------------------------
// 1) سلطة قرار واحدة — resolveCommentExecution تستهلك قرار العقل
// -------------------------------------------------------------
{
  const base = {
    advisory: safeAdvisory,
    automationAllowed: true,
    replyReady: true,
    belongsToChannel: true,
    isPraise: true,
    humanReviewMode: true,
    centralEscalationReason: null,
  };
  const noAction: CentralActionDecision = 'NO_ACTION';
  const allowed: CentralActionDecision = 'ALLOWED_ACTION';
  const approval: CentralActionDecision = 'APPROVAL_REQUIRED';
  const human: CentralActionDecision = 'HUMAN_ESCALATION';
  const failed: CentralActionDecision = 'FAILED_SAFE';

  // ALLOWED_ACTION فقط يسمح بالرد.
  check('1a قرار NO_ACTION لا يُنتج رداً', resolveCommentExecution({ ...base, centralDecision: noAction }).action !== 'reply');
  check('1b قرار APPROVAL_REQUIRED لا يُنتج رداً', resolveCommentExecution({ ...base, centralDecision: approval }).action !== 'reply');
  check('1c قرار HUMAN_ESCALATION لا يُنتج رداً', resolveCommentExecution({ ...base, centralDecision: human }).action !== 'reply');
  check('1d قرار FAILED_SAFE لا يُنتج رداً', resolveCommentExecution({ ...base, centralDecision: failed }).action !== 'reply');
  const ok = resolveCommentExecution({ ...base, centralDecision: allowed });
  check('1e قرار ALLOWED_ACTION + بوابات مكتملة ⇒ رد', ok.action === 'reply' && ok.code === 'REPLY_ALLOWED', `${ok.action}/${ok.code}`);

  // NO_ACTION due to owner setting ⇒ defer (non-terminal), not escalate.
  const deferred = resolveCommentExecution({ ...base, centralDecision: noAction });
  check('1f NO_ACTION ⇒ تأجيل غير نهائي (لا تصعيد كاذب)', deferred.action === 'skip' && deferred.code === 'DEFER_AUTOREPLY_DISABLED', `${deferred.action}/${deferred.code}`);

  // Automation off + ALLOWED_ACTION ⇒ defer.
  const gateOff = resolveCommentExecution({ ...base, centralDecision: allowed, automationAllowed: false });
  check('1g ALLOWED_ACTION + أتمتة معطّلة ⇒ تأجيل (لا رد)', gateOff.action === 'skip' && gateOff.code === 'DEFER_AUTOREPLY_DISABLED');

  // ALLOWED_ACTION + gate ok but reply-not-ready ⇒ escalate (not fake reply).
  const notReady = resolveCommentExecution({ ...base, centralDecision: allowed, replyReady: false });
  check('1h ALLOWED_ACTION + تنفيذ غير جاهز ⇒ تصعيد بلا اختراع', notReady.action === 'escalate' && notReady.code === 'ESCALATE_REPLY_NOT_READY', `${notReady.action}/${notReady.code}`);

  // Advisory safety still wins: spam/self-authored/duplicate ⇒ لا رد مهما كان قرار العقل.
  for (const bad of ['SKIP_SPAM', 'SKIP_SELF_AUTHORED', 'SKIP_ALREADY_REPLIED'] as const) {
    const adv = { ...safeAdvisory, action: 'skip' as const, code: bad };
    const d = resolveCommentExecution({ ...base, centralDecision: allowed, advisory: adv });
    check(`1i فحص السلامة (${bad}) يمنع الرد رغم ALLOWED_ACTION`, d.action !== 'reply', d.action);
  }

  // Sensitive escalation reason forces human escalation regardless.
  const sensitive = resolveCommentExecution({ ...base, centralDecision: allowed, centralEscalationReason: 'price_unverified' });
  check('1j سبب حساس (سعر غير موثّق) ⇒ تصعيد بلا رد', sensitive.action === 'escalate' && sensitive.code === 'ESCALATE_BUSINESS_INQUIRY', `${sensitive.action}/${sensitive.code}`);
  const complaint = resolveCommentExecution({ ...base, centralDecision: allowed, centralEscalationReason: 'complaint' });
  check('1k شكوى ⇒ تصعيد بلا رد', complaint.action === 'escalate' && complaint.code === 'ESCALATE_SENSITIVE');

  // humanReviewMode: praise passes, non-praise escalates.
  const nonPraise = resolveCommentExecution({ ...base, centralDecision: allowed, isPraise: false });
  check('1l وضع المراجعة + غير مدح ⇒ تصعيد صريح', nonPraise.action === 'escalate' && nonPraise.code === 'ESCALATE_HUMAN_REVIEW_MODE');

  // Out-of-channel skip.
  const outCtx = resolveCommentExecution({ ...base, centralDecision: allowed, belongsToChannel: false });
  check('1m خارج سياق القناة ⇒ تجاهل', outCtx.action === 'skip' && outCtx.code === 'SKIP_OUT_OF_CHANNEL_CONTEXT');

  // Source: the watcher route in server.ts consumes the central decision (single authority).
  const server = readFileSync(join(ROOT, 'server.ts'), 'utf8');
  check('1n المسار يقرأ قرار العقل المركزي للمر الحدث', server.includes('centralActionDecisionForEvent('));
  check('1o المسار يستخدم resolveCommentExecution (لا قراراً مستقلاً)', server.includes('resolveCommentExecution('));
  check('1p لا تنفيذ رد مباشر من قرار مستقل (decideCommentAction استشاري)', server.includes("centralDecision: centralDecision ?? 'FAILED_SAFE'"));
  // decideCommentAction لا يملك سلطة تنفيذ: يُمرَّر كـ advisory فقط.
  check('1q decideCommentAction يُمرَّر كفحص استشاري فقط', /advisory,\s*\n\s*automationAllowed/.test(server) || server.includes('advisory:'));
}

// -------------------------------------------------------------
// 2) قراءة السجل — decisionLedger يُغذّي ذاكرة العقل (لا نظام ثانٍ)
// -------------------------------------------------------------
{
  const now = Date.now();
  const empty = emptyDecisionLedger();
  check('2a قراءة سجل فارغ ⇒ صفر سجلات (لا اختراع)', decisionHistoryToMemoryRecords(empty, now).length === 0);

  // سجل قرار بلا نتيجة ملاحَظة ⇒ لا سجل ذاكرة.
  const pending = recordDecision(emptyDecisionLedger(), {
    decisionId: 'bd-x', platform: 'youtube', eventIdentity: 'comment:c1',
    finalStatus: 'ALLOWED_ACTION', actionKind: 'external_action', actionText: 'رد', now,
  }).ledger;
  check('2b قرار بلا نتيجة ملاحَظة ⇒ لا يُخترع سجل ذاكرة', decisionHistoryToMemoryRecords(pending, now).length === 0);

  // بعد ملاحظة نتيجة حقيقية ⇒ سجل ذاكرة واحد أصله platform_data (دليل حقيقي).
  const observed = attachOutcome(pending, {
    decisionId: 'bd-x', kind: 'delivered',
    summary: 'أُرسل رد وتحقّق المزوّد.', source: 'platform_data:youtube', providerReplyId: 'r-1', now: now + 1,
  }).ledger;
  const mem = decisionHistoryToMemoryRecords(observed, now);
  check('2c نتيجة ملاحَظة ⇒ سجل ذاكرة واحد', mem.length === 1, String(mem.length));
  check('2d السجل مُرحَّل كدليل حقيقي (platform_data)', mem[0]?.origin === 'platform_data', mem[0]?.origin);
  check('2e معرّف القرار داخل معرّف السجل وسجل المصدر صحيح', (mem[0]?.id || '').includes('bd-x') && (mem[0]?.sourceRefs || []).includes('decisionLedger'), `${mem[0]?.id}/${JSON.stringify(mem[0]?.sourceRefs)}`);
  check('2f عيّنة ≥ 1 وثقة عالية (دليل الملاحظة)', (mem[0]?.sampleSize || 0) >= 1 && mem[0]?.confidence === 'high');

  // buildRuntimeDecisionContext يقرأ السجل ⇒ consumedDecisionHistory صحيح.
  const input: RuntimeBrainInput = {
    platforms: ['youtube'], now, goalPrimary: 'SALES', records: [], comments: [], replies: [], publishes: [], watcher: [], connections: [],
    decisionLedger: observed,
  };
  const dc = buildRuntimeDecisionContext(input);
  check('2g السياق يقرأ النتائج الملاحَظة من السجل', dc.priorOutcomes.length === 1 && dc.consumedDecisionHistory === true, String(dc.priorOutcomes.length));
  check('2h السياق يحمل معرّف رد المزوّد (دليل حقيقي)', dc.priorOutcomes[0]?.providerReplyId === 'r-1');
  check('2i السياق يذكر الخطوة التالية من التاريخ', typeof dc.strategyHint === 'string' && dc.strategyHint.length > 0);
  // بلا سجل ⇒ consumedDecisionHistory=false ولا اختراع.
  const dcEmpty = buildRuntimeDecisionContext({ ...(input as any), decisionLedger: empty });
  check('2j بلا سجل ⇒ لا استهلاك تاريخ (لا اختراع)', dcEmpty.consumedDecisionHistory === false && dcEmpty.priorOutcomes.length === 0);
}

// -------------------------------------------------------------
// 3) استهلاك الإدراك — السبب الحقيقي + السياق التجاري يدخل قرار العقل
// -------------------------------------------------------------
{
  const now = Date.now();
  const ctxBase: any = {
    now, task: 'البتّ في رد آمن على تعليق YouTube', platform: 'youtube',
    comments: [{ platform: 'youtube', externalId: 'c1', text: 'كم سعر التقسيط؟' }],
    watcher: [], connections: [{ platform: 'youtube', connected: true, verified: true }],
    verifiedFacts: [], memoryActive: 0, aiAvailable: false, priorSessions: 0,
  };
  // بلا سبب ⇒ لا مخرج سبب.
  const noReason = researchAgent(ctxBase);
  check('3a بلا سبب تصعيد ⇒ لا مخرج سبب مخترع', !noReason.outputs.some((o) => /escalationReason=/.test(o.evidence.join(' '))));
  // مع سبب حقيقي ⇒ دليل FACT يحمل السبب.
  const withReason = researchAgent({ ...ctxBase, escalationReason: 'price_unverified' });
  check('3b السبب الحقيقي يدخل كدليل FACT', withReason.outputs.some((o) => o.truthState === 'FACT' && /price_unverified/.test(o.evidence.join(' '))));
  const withComplaint = researchAgent({ ...ctxBase, escalationReason: 'complaint' });
  check('3c الشكوى تُمرَّر كدليل حقيقي', withComplaint.outputs.some((o) => /complaint/.test(o.evidence.join(' '))));
  // بلا سبب ⇒ لا دليل (لا اختراع).
  check('3d لا سبب ⇒ لا يُختلق سبب', !noReason.outputs.some((o) => /escalationReason=/.test(o.evidence.join(' '))));

  // السياق التجاري يدخل كدليل (استراتيجية/جمهور/تاريخ قرارات) — استهلاك فعلي لا استشاري.
  const withCommercial = researchAgent({
    ...ctxBase,
    commercialContext: {
      strategyHeadlines: ['daily: نشر محتوى موجّه'], audienceHeadlines: ['تجهيز بيت (عيّنة 4)'],
      marketHasEvidence: true, priorOutcomeSummaries: ['ALLOWED_ACTION: أُرسل رد وتحقّق'], strategyHint: 'ابنِ على النتائج السابقة.',
    },
  });
  check('3e الاستراتيجية الكانونية تدخل كدليل', withCommercial.outputs.some((o) => /strategyEngine/.test(o.source)));
  check('3f نموذج الجمهور يدخل كدليل', withCommercial.outputs.some((o) => /audienceModel/.test(o.source)));
  check('3g تاريخ القرارات يدخل كدليل (قراءة السجل تُغذّي القرار)', withCommercial.outputs.some((o) => /decisionLedger/.test(o.source)));
  // لا سياق ⇒ لا مخرجات تجارية مخترعة.
  check('3h بلا سياق تجاري ⇒ لا أدلة تجارية مخترعة', !noReason.outputs.some((o) => /strategyEngine|audienceModel|decisionLedger/.test(o.source)));

  // server: teamContext يبني commercialContext من المصدر الكانوني.
  const server = readFileSync(join(ROOT, 'server.ts'), 'utf8');
  check('3i السياق التجاري يُبنى من buildRuntimeDecisionContext', server.includes('buildRuntimeDecisionContext('));
  check('3j السبب يُمرَّر إلى teamContext', server.includes('escalationReason: meta.escalationReason ?? null'));

  // البناء الكانوني ما زال واحداً (لا عقل ثانٍ): buildRuntimeBrain مصدر الحالة.
  const built = buildRuntimeBrain({ platforms: ['youtube'], now, goalPrimary: 'SALES', records: [], comments: [], replies: [], publishes: [], watcher: [], connections: [] });
  check('3k الحالة الكانونية تُبنى من buildRuntimeBrain (عقل واحد)', Boolean(built.state) && Array.isArray(built.state.strategies) && Array.isArray(built.state.platformStates));
}

console.log(`\n============================================================`);
if (failures.length) {
  console.log(`FAILED: ${failures.length} checks`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`PASSED: ${passed} central-authority (Batch 8.1) checks`);
