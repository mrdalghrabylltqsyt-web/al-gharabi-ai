/**
 * PR-S5 — «زبون حقيقي فقط + متابعة نظيفة» (وحدة، منطق صافٍ بلا شبكة).
 *
 * يثبت (يفشل على الكود القديم):
 *  - تعليق إيموجي فقط (😍/👏💯) أو مدح/تحية بلا سؤال ⇒ **لا lead ولا مسودة**.
 *  - «كم سعر» (وكل سؤال حقيقي: سعر/قسط/توفر/نية شراء/سؤال منتج) ⇒ lead + مسودة جواب.
 *  - تعليق عمره 20 يوماً ⇒ لا متابعة (الحدّ 7 أيام).
 *  - التنظيف يحوّل المسودات المخالفة إلى `cancelled` (بسبب مكتوب) ويؤرشف الـleads
 *    المخالفة — **بلا حذف** — ولا يلمس مسودة جواب صحيحة.
 *  - التعليق العام يُتابَع مرة واحدة كحد أقصى، والتعليقات المستوردة بأثر رجعي
 *    (backfill) لا تولّد متابعات.
 */

import {
  isRealCommercialQuestion,
  createCommercialLead,
  mergeCommercialInteraction,
  type InboundInteraction,
  type CommercialLead,
} from '../commercial/commercialBrain';
import {
  leadAskedRealQuestion, evaluateFollowUpEligibility, planCommercialDraftCleanup,
  planCommercialLeadArchive, summarizeQualification, diagnoseAuthorNameAvailability,
  isFollowUpAgeEligible, isBackfillImport, textQualifiesAsRealQuestion,
  COMMERCIAL_FOLLOWUP_MAX_AGE_MS,
} from '../commercial/leadQualification';
import { classifyComment } from '../social/comments';
import type { CommercialDraft } from '../commercial/commercialDrafts';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const NOW = '2026-10-18T12:00:00.000Z';
const iso = (msAgo: number) => new Date(Date.parse(NOW) - msAgo).toISOString();
const H = 3600_000, D = 24 * H;

/** يبني تفاعلاً وارِداً (سؤال حقيقي افتراضاً). */
function interaction(over: Partial<InboundInteraction> = {}): InboundInteraction {
  const text = over.text ?? 'كم سعر هذا الموبايل؟';
  return {
    externalId: over.externalId ?? 'c1',
    platform: over.platform ?? 'facebook',
    conversationId: over.conversationId ?? 'author:A1',
    customerName: over.customerName ?? 'زبون',
    text,
    at: over.at ?? iso(2 * H),
    fromCustomer: over.fromCustomer ?? true,
    kind: over.kind ?? 'comment',
    replyTarget: over.replyTarget ?? { commentId: 'c1' },
    classification: over.classification ?? classifyComment(text),
    product: over.product ?? null,
    backfill: over.backfill ?? false,
  };
}

function draft(over: Partial<CommercialDraft> = {}): CommercialDraft {
  return {
    id: over.id ?? 'd1',
    leadId: over.leadId ?? 'lead_1',
    leadKey: over.leadKey ?? 'facebook::author:A1',
    platform: over.platform ?? 'facebook',
    kind: over.kind ?? 'comment',
    purpose: over.purpose ?? 'follow_up',
    text: over.text ?? 'متابعة',
    externalId: over.externalId ?? 'c1',
    recipientId: over.recipientId ?? null,
    productId: over.productId ?? null,
    proposalId: over.proposalId ?? null,
    idempotencyKey: over.idempotencyKey ?? null,
    createdAt: over.createdAt ?? iso(2 * H),
    windowExpiresAt: over.windowExpiresAt ?? null,
    status: over.status ?? 'pending',
    decidedBy: over.decidedBy ?? null,
    decidedAt: over.decidedAt ?? null,
    approvedText: over.approvedText ?? null,
    deliveryStatus: over.deliveryStatus ?? null,
    deliveryError: over.deliveryError ?? null,
    providerReplyId: over.providerReplyId ?? null,
    cancelledReason: over.cancelledReason ?? null,
    cancelledAt: over.cancelledAt ?? null,
  };
}

/** عميل بسيط من نص (بلا لمس الدورة). */
function leadFrom(text: string, over: Partial<InboundInteraction> = {}): CommercialLead {
  return createCommercialLead(interaction({ text, ...over }));
}

function main(): void {
  group('1) تصنيف «سؤال حقيقي» — مصدر واحد حتمي');
  check('😍 ليس سؤالاً حقيقياً', !textQualifiesAsRealQuestion('😍'));
  check('👏💯 ليس سؤالاً حقيقياً', !textQualifiesAsRealQuestion('👏💯'));
  check('مدح «عاشت إيدكم» ليس سؤالاً', !textQualifiesAsRealQuestion('عاشت إيدكم'));
  check('تحية «مرحبا» ليست سؤالاً', !textQualifiesAsRealQuestion('مرحبا'));
  check('«شكراً» ليس سؤالاً', !textQualifiesAsRealQuestion('شكراً'));
  check('«حبيت أتأكد» ليس سؤالاً حقيقياً', !textQualifiesAsRealQuestion('حبيت أتأكد'));
  check('«كم سعر» سؤال حقيقي', textQualifiesAsRealQuestion('كم سعر'));
  check('«كم القسط؟» سؤال حقيقي', textQualifiesAsRealQuestion('كم القسط؟'));
  check('«هل متوفر؟» سؤال حقيقي', textQualifiesAsRealQuestion('هل متوفر؟'));
  check('«اريد اشتري» نية شراء', textQualifiesAsRealQuestion('اريد اشتري'));
  check('«عندكم تقسيط؟» سؤال حقيقي', textQualifiesAsRealQuestion('عندكم تقسيط؟'));
  check('«😍 كم سعر؟» سؤال حقيقي (إيموجي + سؤال)', textQualifiesAsRealQuestion('😍 كم سعر؟'));

  group('2) الإيموجي/المدح لا ينشئ lead مؤهّلاً؛ «كم سعر» يُنشئ lead مؤهّلاً');
  const emojiLead = leadFrom('😍');
  check('lead إيموجي: غير مؤهّل', leadAskedRealQuestion(emojiLead) === false);
  const praiseLead = leadFrom('عاشت إيدكم');
  check('lead مدح: غير مؤهّل', leadAskedRealQuestion(praiseLead) === false);
  const priceLead = leadFrom('كم سعر هذا الموبايل؟');
  check('lead سعر: مؤهّل', leadAskedRealQuestion(priceLead) === true);
  check('lead سعر: نصّه محفوظ', priceLead.lastCustomerText === 'كم سعر هذا الموبايل؟');

  group('3) قواعد عمر المتابعة (7 أيام) والـbackfill');
  check('تفاعل قبل ساعتين مؤهّل زمنياً', isFollowUpAgeEligible(iso(2 * H), NOW));
  check('تفاعل عمره 6 أيام مؤهّل', isFollowUpAgeEligible(iso(6 * D), NOW));
  check('تفاعل عمره 20 يوماً **غير** مؤهّل', !isFollowUpAgeEligible(iso(20 * D), NOW));
  check('الحدّ 7 أيام بالضبط', COMMERCIAL_FOLLOWUP_MAX_AGE_MS === 7 * D);
  check('عمر 2 ساعة ليس backfill', !isBackfillImport(iso(2 * H), NOW));
  check('عمر 3 أيام = backfill', isBackfillImport(iso(3 * D), NOW));

  group('4) بوابة المتابعة النظيفة (مصدر واحد)');
  // رسالة خاصة (المسار الوحيد المسموح للمتابعة). الزبون سأل ثم **ردّ المعرض** عليه
  // قبل 49 ساعة والزبون ساكت بعدها ⇒ المحادثة باردة ومؤهّلة للمتابعة.
  const msgBase = (over: Partial<InboundInteraction> = {}) => leadFrom('كم القسط؟', { kind: 'message', conversationId: 'PSID9', replyTarget: { recipientId: 'PSID9' }, ...over });
  const msgLead = msgBase({ at: iso(50 * H) });
  // بلا رد للمعرض ⇒ لا أساس لمتابعة.
  check('بلا رد للمعرض ⇒ NO_BUSINESS_REPLY',
    evaluateFollowUpEligibility({ lead: msgLead, drafts: [], nowIso: NOW }).code === 'NO_BUSINESS_REPLY');
  // تعليق عام (kind=comment) ⇒ لا متابعة إطلاقاً.
  check('تعليق عام ⇒ PUBLIC_COMMENT_NO_FOLLOWUP',
    evaluateFollowUpEligibility({ lead: priceLead, drafts: [], nowIso: NOW }).code === 'PUBLIC_COMMENT_NO_FOLLOWUP');
  // رسالة خاصة: رد المعرض قبل 49 ساعة، الزبون ساكت، داخل النافذة ⇒ مؤهّل.
  const reply49 = { ...msgLead, lastBusinessReplyAt: iso(49 * H) };
  check('رسالة خاصة + رد معرض قبل 49س + الزبون ساكت ⇒ مؤهّل',
    evaluateFollowUpEligibility({ lead: reply49, drafts: [], nowIso: NOW }).code === 'ELIGIBLE');
  // خارج نافذة المتابعة (بعد 80 ساعة من ردّنا) ⇒ لا متابعة.
  const reply80 = { ...msgBase({ at: iso(90 * H) }), lastBusinessReplyAt: iso(80 * H) };
  check('خارج نافذة المراسلة ⇒ OUTSIDE_META_WINDOW',
    evaluateFollowUpEligibility({ lead: reply80, drafts: [], nowIso: NOW }).code === 'OUTSIDE_META_WINDOW');
  // المحادثة حيّة: الزبون ردّ بعد رد المعرض ⇒ لا متابعة.
  const liveLead = { ...reply49, lastCustomerInteractionAt: iso(2 * H) };
  check('ردّ الزبون بعد رد المعرض ⇒ CONVERSATION_LIVE',
    evaluateFollowUpEligibility({ lead: liveLead, drafts: [], nowIso: NOW }).code === 'CONVERSATION_LIVE');
  // متابعة واحدة فقط: مسودة متابعة قائمة ⇒ لا ثانية.
  const oneDraft = draft({ id: 'm1', leadId: msgLead.id, leadKey: msgLead.key, purpose: 'follow_up', kind: 'message', externalId: 'msg1', recipientId: 'PSID9' });
  check('متابعة واحدة قائمة ⇒ لا ثانية (FOLLOWUP_ONCE)',
    evaluateFollowUpEligibility({ lead: reply49, drafts: [oneDraft], nowIso: NOW }).code === 'FOLLOWUP_ONCE');
  // القواعد القديمة تبقى سارية.
  const staleLead = leadFrom('كم سعر؟', { at: iso(20 * D) });
  check('20 يوماً ⇒ لا متابعة (STALE_BEYOND_7_DAYS)',
    evaluateFollowUpEligibility({ lead: staleLead, drafts: [], nowIso: NOW }).code === 'STALE_BEYOND_7_DAYS');
  const emojiFollow = evaluateFollowUpEligibility({ lead: emojiLead, drafts: [], nowIso: NOW });
  check('إيموجي ⇒ لا متابعة (NOT_A_REAL_QUESTION)', !emojiFollow.eligible && emojiFollow.code === 'NOT_A_REAL_QUESTION');
  const backfillLead: CommercialLead = { ...msgBase(), backfill: true, lastBusinessReplyAt: iso(49 * H) };
  check('backfill ⇒ لا متابعة (BACKFILL_NO_FOLLOWUP)',
    evaluateFollowUpEligibility({ lead: backfillLead, drafts: [], nowIso: NOW }).code === 'BACKFILL_NO_FOLLOWUP');

  group('5) التنظيف: إلغاء المسودات المخالفة بلا حذف + أرشفة الـleads المخالفة');
  const emojiLead2 = leadFrom('😍', { externalId: 'cE', conversationId: 'author:E' });
  const staleLead2 = leadFrom('كم سعر؟', { externalId: 'cS', conversationId: 'author:S', at: iso(20 * D) });
  const goodLead = leadFrom('كم سعر هذا الموبايل؟', { externalId: 'cG', conversationId: 'author:G' });
  // متابعة على تعليق عام (مخالفة) + متابعة رسالة صحيحة.
  const msgCleanLead = leadFrom('كم القسط؟', { kind: 'message', conversationId: 'PSID_C', replyTarget: { recipientId: 'PSID_C' }, externalId: 'mc', at: iso(50 * H) });
  msgCleanLead.lastBusinessReplyAt = iso(49 * H);
  const leads = [emojiLead2, staleLead2, goodLead, msgCleanLead];
  const drafts: CommercialDraft[] = [
    draft({ id: 'dE', leadId: emojiLead2.id, leadKey: emojiLead2.key, externalId: 'cE', purpose: 'follow_up' }),
    draft({ id: 'dS', leadId: staleLead2.id, leadKey: staleLead2.key, externalId: 'cS', purpose: 'follow_up' }),
    draft({ id: 'dPub', leadId: goodLead.id, leadKey: goodLead.key, externalId: 'cG', purpose: 'follow_up', kind: 'comment' }),
    draft({ id: 'dMsg', leadId: msgCleanLead.id, leadKey: msgCleanLead.key, purpose: 'follow_up', kind: 'message', externalId: 'mc', recipientId: 'PSID_C' }),
    draft({ id: 'dG', leadId: goodLead.id, leadKey: goodLead.key, externalId: 'cG', purpose: 'reply' }),
  ];
  const plan = planCommercialDraftCleanup({ drafts, leads, nowIso: NOW });
  const byId = new Map(plan.cancellations.map((c) => [c.id, c]));
  check('مسودة الإيموجي تُلغى بسبب NOT_A_REAL_QUESTION', byId.get('dE')?.code === 'NOT_A_REAL_QUESTION', JSON.stringify(byId.get('dE')));
  check('مسودة الـ20 يوماً تُلغى بسبب STALE_BEYOND_7_DAYS', byId.get('dS')?.code === 'STALE_BEYOND_7_DAYS', JSON.stringify(byId.get('dS')));
  check('متابعة التعليق العام تُلغى بسبب PUBLIC_COMMENT_NO_FOLLOWUP', byId.get('dPub')?.code === 'PUBLIC_COMMENT_NO_FOLLOWUP', JSON.stringify(byId.get('dPub')));
  check('مسودة الجواب الصحيحة **لا تُلغى**', !byId.has('dG'));
  check('متابعة الرسالة الخاصة الصحيحة **لا تُلغى**', !byId.has('dMsg'));
  check('كل إلغاء يحمل سبباً مكتوباً', plan.cancellations.every((c) => c.reason.trim().length > 0));
  const archivePlan = planCommercialLeadArchive(leads);
  check('يُؤرشف lead الإيموجي فقط', archivePlan.length === 1 && archivePlan[0].id === emojiLead2.id, JSON.stringify(archivePlan));
  check('lead السؤال الصحيح (حتى القديم) لا يُؤرشف — التأهيل لا الأقدمية', !archivePlan.some((a) => a.id === goodLead.id || a.id === staleLead2.id));

  group('6) متابعة واحدة لكل استفسار (تُبقي الأقدم)');
  const leadMsg = leadFrom('كم القسط؟', { externalId: 'mP', conversationId: 'PSID_P', kind: 'message', replyTarget: { recipientId: 'PSID_P' }, at: iso(50 * H) });
  leadMsg.lastBusinessReplyAt = iso(49 * H);
  const pubDrafts: CommercialDraft[] = [
    draft({ id: 'p1', leadId: leadMsg.id, leadKey: leadMsg.key, externalId: 'mP', recipientId: 'PSID_P', purpose: 'follow_up', kind: 'message', createdAt: iso(3 * H) }),
    draft({ id: 'p2', leadId: leadMsg.id, leadKey: leadMsg.key, externalId: 'mP', recipientId: 'PSID_P', purpose: 'follow_up', kind: 'message', createdAt: iso(1 * H) }),
  ];
  const pubPlan = planCommercialDraftCleanup({ drafts: pubDrafts, leads: [leadMsg], nowIso: NOW });
  check('الأقدم يبقى والأحدث يُلغى (FOLLOWUP_ONCE)', !pubPlan.cancellations.some((c) => c.id === 'p1') && pubPlan.cancellations.some((c) => c.id === 'p2' && c.code === 'FOLLOWUP_ONCE'), JSON.stringify(pubPlan.cancellations));

  group('7) ملخّص التأهيل');
  const summary = summarizeQualification({ leads, drafts, nowIso: NOW });
  check('إجمالي العملاء = 4', summary.totalLeads === 4, JSON.stringify(summary));
  check('المؤهّلون = 3 (سؤال حقيقي)', summary.qualifiedLeads === 3, JSON.stringify(summary));
  check('متابعات قديمة/backfill مُعلّقة = 1', summary.staleFollowUpDrafts === 1, JSON.stringify(summary));
  check('مسودات الجواب = 1', summary.answerDrafts === 1, JSON.stringify(summary));

  group('8) دمج التفاعل: الإيموجي لا يُرقّي، والسؤال يفتح نافذة');
  const merged = mergeCommercialInteraction(emojiLead2, interaction({ externalId: 'cE2', conversationId: emojiLead2.conversationId, text: 'كم سعر؟' }));
  check('بعد سؤال حقيقي صار مؤهّلاً', leadAskedRealQuestion(merged) === true);
  const mergedEmoji = mergeCommercialInteraction(merged, interaction({ externalId: 'cE3', conversationId: emojiLead2.conversationId, text: '😍' }));
  check('آخر تفاعل إيموجي ⇒ بوابة المتابعة تمنع', leadAskedRealQuestion(mergedEmoji) === true && mergedEmoji.lastCustomerQualifiedQuestion === false);

  group('9) تشخيص اسم الكاتب (from) — قراءة فقط');
  const diagMissing = diagnoseAuthorNameAvailability([
    { platform: 'facebook', authorName: null, authorId: null },
    { platform: 'facebook', authorName: null, authorId: null },
  ]);
  check('غياب from ⇒ verdict=from_field_missing', diagMissing.verdict === 'from_field_missing', JSON.stringify(diagMissing));
  check('غياب from ⇒ OWNER SESSION REQUIRED + خطوات لوحة Meta', diagMissing.ownerSessionRequired === true && diagMissing.metaDashboardSteps.length >= 4);
  const diagOk = diagnoseAuthorNameAvailability([
    { platform: 'instagram', authorName: 'زبون حقيقي', authorId: '1789' },
  ]);
  check('وجود from ⇒ verdict=from_field_returned', diagOk.verdict === 'from_field_returned', JSON.stringify(diagOk));
  check('لا خطوات عندما لا حجب', diagOk.ownerSessionRequired === false && diagOk.metaDashboardSteps.length === 0);
  const diagEmpty = diagnoseAuthorNameAvailability([]);
  check('بلا بيانات ⇒ no_data (غير حاسم)', diagEmpty.verdict === 'no_data');

  console.log(`\nPR-S5 qualification: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
}

main();
