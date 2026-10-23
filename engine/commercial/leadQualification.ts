/**
 * PR-S5 — «زبون حقيقي فقط + متابعة نظيفة».
 *
 * الدليل من الإنتاج: صندوق الزبائن امتلأ بـ24 مسودة «متابعة 24/72» بنفس النص على
 * تعليقات إيموجي/مدح عمرها أسابيع، والموافقة عليها تنشر ردوداً علنية تشبه السبام.
 * هذا الملف هو **المنطق الصافي الوحيد** (بلا شبكة وبلا سرّ وبلا ساعة) الذي يضبط:
 *
 *  1) من يُعتبر زبوناً: الـlead يُنشأ **فقط** مع سؤال حقيقي (سعر/قسط/توفر/نية شراء/
 *     سؤال عن منتج). إيموجي فقط، أو مدح/تحية بلا سؤال، أو سبام ⇒ لا lead ولا مسودة
 *     (يبقى في «التعليقات الواردة» فقط).
 *  2) قواعد المتابعة 24/72: فقط لزبون سأل سؤالاً حقيقياً ولم يُجب بعد، ولا متابعة على
 *     تفاعل أقدم من 7 أيام، ولا متابعة علنية متكررة على نفس التعليق (مرة واحدة كحد
 *     أقصى)، والتعليقات المستوردة بأثر رجعي (backfill) لا تولّد متابعات.
 *  3) تنظيف المسودات المخالفة: تُحوَّل إلى `cancelled` بسبب مكتوب وسجل audit — بلا حذف.
 *
 * لا يخترع أي حكم: كل قرار مشتقّ من تصنيف حتمي (`classifyComment`) ونصوص/أوقات حقيقية.
 * قرار «سؤال حقيقي» مصدره الواحد `isRealCommercialQuestion` في `commercialBrain.ts`.
 */

import { classifyComment, type ClassifiedComment } from '../social/comments';
import {
  isRealCommercialQuestion,
  isCustomerRepliedAfterBusiness,
  isWithinFollowUpWindow,
  COMMERCIAL_MAX_FOLLOWUPS,
  type CommercialLead,
  type LeadQuestionSignals,
} from './commercialBrain';
import type { CommercialDraft } from './commercialDrafts';

export { isRealCommercialQuestion };
export type { LeadQuestionSignals };

// ─────────────────────────────────────────────────────────────────────────────
// 1) تأهيل الزبون الحقيقي (سؤال حقيقي فقط).
// ─────────────────────────────────────────────────────────────────────────────

/** الحدّ الأقصى لعمر التفاعل الذي يُسمح بمتابعته (7 أيام) — بلا متابعة على القديم. */
export const COMMERCIAL_FOLLOWUP_MAX_AGE_HOURS = 168;
export const COMMERCIAL_FOLLOWUP_MAX_AGE_MS = COMMERCIAL_FOLLOWUP_MAX_AGE_HOURS * 3600_000;

/**
 * أي تعليق/رسالة يُستورد بعد أكثر من هذه المدة من إنشائه = استيراد بأثر رجعي
 * (backfill). الإيقاع الطبيعي دقائق، فـ24 ساعة حدّ محافظ يفصل الاستيراد المتأخر.
 */
export const COMMERCIAL_BACKFILL_MIN_AGE_HOURS = 24;
export const COMMERCIAL_BACKFILL_MIN_AGE_MS = COMMERCIAL_BACKFILL_MIN_AGE_HOURS * 3600_000;

/** تأهيل من نص خام (يُصنّف محلياً) — للمدخلات التي لا تحمل تصنيفاً محفوظاً. */
export function textQualifiesAsRealQuestion(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  return isRealCommercialQuestion(classifyComment(t), t);
}

/** تصنيف محفوظ أو اشتقاق حتمي من نص آخر تفاعل للعميل. */
function signalsForLead(lead: CommercialLead): { cls: ClassifiedComment; text: string } {
  const text = String(lead.lastCustomerText || '');
  return { cls: classifyComment(text), text };
}

/**
 * هل الـlead «سأل سؤالاً حقيقياً»؟ يُفضّل العلم المحفوظ، وإلا يُشتقّ حتمياً من نص
 * آخر تفاعل للعميل (توافق خلفي مع الـleads القائمة بلا علم).
 */
export function leadAskedRealQuestion(lead: CommercialLead): boolean {
  if (lead.qualifiedQuestion === true) return true;
  if (lead.qualifiedQuestion === false) return false;
  const { cls, text } = signalsForLead(lead);
  return isRealCommercialQuestion(cls, text);
}

/** هل آخر تفاعل للعميل كان سؤالاً حقيقياً؟ (بوابة المتابعة) — بلا علم يُشتقّ من النص. */
export function leadLastCustomerAskedRealQuestion(lead: CommercialLead): boolean {
  if (lead.lastCustomerQualifiedQuestion === true) return true;
  if (lead.lastCustomerQualifiedQuestion === false) return false;
  return leadAskedRealQuestion(lead);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) قواعد المتابعة النظيفة.
// ─────────────────────────────────────────────────────────────────────────────

/** هل عمر آخر تفاعل للعميل ضمن 7 أيام؟ (لا متابعة على تفاعل أقدم). */
export function isFollowUpAgeEligible(lastInteractionAt: string | null | undefined, nowIso: string): boolean {
  const t = Date.parse(String(lastInteractionAt || ''));
  const now = Date.parse(nowIso);
  if (!Number.isFinite(t) || !Number.isFinite(now)) return false;
  const age = now - t;
  return age >= 0 && age <= COMMERCIAL_FOLLOWUP_MAX_AGE_MS;
}

/** هل هذا الاستيراد بأثر رجعي (backfill)؟ (عمر التعليق عند الاستقبال > 24 ساعة). */
export function isBackfillImport(createdAt: string | null | undefined, nowIso: string): boolean {
  const t = Date.parse(String(createdAt || ''));
  const now = Date.parse(nowIso);
  if (!Number.isFinite(t) || !Number.isFinite(now)) return false;
  return now - t > COMMERCIAL_BACKFILL_MIN_AGE_MS;
}

/**
 * مسودات المتابعة الفعلية لزبون واحد — كلها تُحتسب للمنع (بلا حذف). المتابعة
 * «واحدة لكل استفسار»: أي مسودة متابعة قائمة (pending/approved/أُرسلت) لهذا الزبون
 * تُستنفد الحدّ، فلا تُقترح متابعة ثانية قبل انتهاء المدة ولا بعدها.
 */
export function countLeadFollowUps(leadKey: string, drafts: readonly CommercialDraft[]): number {
  const key = String(leadKey || '');
  if (!key) return 0;
  return drafts.filter(
    (d) => d.purpose === 'follow_up' && String(d.leadKey || '') === key && d.status !== 'rejected' && d.status !== 'cancelled',
  ).length;
}

/** هل استُنفدت متابعة هذا الاستفسار (متابعة واحدة كحد أقصى)؟ */
export function followUpExhaustedForLead(lead: CommercialLead, drafts: readonly CommercialDraft[]): boolean {
  if (lead.followUpsSent >= COMMERCIAL_MAX_FOLLOWUPS) return true;
  return countLeadFollowUps(lead.key, drafts) >= COMMERCIAL_MAX_FOLLOWUPS;
}

export interface FollowUpEligibility {
  eligible: boolean;
  code: string;
  reason: string;
}

/**
 * بوابة المتابعة النظيفة (مصدر واحد) — تُحسم بالترتيب الصريح:
 *  1) ليس lead مؤرشفاً ولا سبام (سؤال حقيقي مسجّل، وآخر تفاعل للعميل سؤال حقيقي).
 *  2) **الرسائل الخاصة فقط**: لا متابعة على تعليق عام (comment_reply) إطلاقاً.
 *  3) ليس استيراداً بأثر رجعي (backfill).
 *  4) عمر تفاعل العميل ≤ 7 أيام.
 *  5) يوجد **رد فعلي من المعرض** (الأساس الزمني) وداخل نافذة المتابعة المسموحة.
 *  6) **المحادثة باردة**: لم يردّ الزبون بعد آخر رد للمعرض.
 *  7) **متابعة واحدة لكل استفسار** (لا متابعة ثانية).
 * كل منع يحمل كوداً صريحاً — لا يُنشأ شيء عند المنع.
 */
export function evaluateFollowUpEligibility(input: {
  lead: CommercialLead;
  drafts: readonly CommercialDraft[];
  nowIso: string;
}): FollowUpEligibility {
  const { lead, drafts, nowIso } = input;
  if (lead.archived === true) return { eligible: false, code: 'LEAD_ARCHIVED', reason: 'العميل مؤرشف (لا سؤال حقيقي).' };
  if (!leadAskedRealQuestion(lead)) return { eligible: false, code: 'NOT_A_REAL_QUESTION', reason: 'لا سؤال حقيقي مسجّل — لا متابعة.' };
  if (!leadLastCustomerAskedRealQuestion(lead)) return { eligible: false, code: 'LAST_NOT_A_QUESTION', reason: 'آخر تفاعل للعميل ليس سؤالاً حقيقياً — لا متابعة.' };
  if (lead.backfill === true) return { eligible: false, code: 'BACKFILL_NO_FOLLOWUP', reason: 'تعليق مستورد بأثر رجعي (backfill) — لا يولّد متابعة.' };
  if (!isFollowUpAgeEligible(lead.lastCustomerInteractionAt, nowIso)) {
    return { eligible: false, code: 'STALE_BEYOND_7_DAYS', reason: `التفاعل أقدم من ${COMMERCIAL_FOLLOWUP_MAX_AGE_HOURS / 24} أيام — لا متابعة.` };
  }
  // لا متابعة على التعليقات العامة إطلاقاً — المتابعة في الرسائل الخاصة فقط.
  if (lead.kind !== 'message') return { eligible: false, code: 'PUBLIC_COMMENT_NO_FOLLOWUP', reason: 'لا متابعة على التعليقات العامة — المتابعة تُقترح في الرسائل الخاصة فقط.' };
  // الأساس الزمني = آخر رد فعلي من المعرض، لا تعليق الزبون. بلا رد للمعرض لا أساس.
  if (!lead.lastBusinessReplyAt) return { eligible: false, code: 'NO_BUSINESS_REPLY', reason: 'لا رد سابق من المعرض — لا أساس لمتابعة.' };
  if (isCustomerRepliedAfterBusiness(lead)) {
    return { eligible: false, code: 'CONVERSATION_LIVE', reason: 'ردّ الزبون بعد آخر رد للمعرض — المحادثة حيّة، لا متابعة.' };
  }
  if (!isWithinFollowUpWindow(lead.lastBusinessReplyAt, nowIso)) {
    return { eligible: false, code: 'OUTSIDE_META_WINDOW', reason: 'خارج نافذة المراسلة المسموحة بعد ردّنا — لا متابعة.' };
  }
  if (followUpExhaustedForLead(lead, drafts)) {
    return { eligible: false, code: 'FOLLOWUP_ONCE', reason: 'متابعة واحدة لكل استفسار كحد أقصى.' };
  }
  return { eligible: true, code: 'ELIGIBLE', reason: 'مؤهّل لمتابعة واحدة نظيفة.' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) تنظيف المسودات والـleads المخالفة (بلا حذف).
// ─────────────────────────────────────────────────────────────────────────────

export interface DraftCancellation {
  id: string;
  code: string;
  reason: string;
}

/**
 * يخطّط إلغاء المسودات المعلّقة المخالفة للقواعد (لا يحذف شيئاً):
 *  - lead مفقود/مؤرشف/غير مؤهّل (إيموجي/مدح) ⇒ إلغاء.
 *  - متابعة على تعليق عام ⇒ إلغاء (المتابعة في الرسائل الخاصة فقط).
 *  - متابعة على backfill أو تفاعل أقدم من 7 أيام ⇒ إلغاء.
 *  - متابعة بلا رد سابق للمعرض، أو خارج نافذة المراسلة، أو والمحادثة حيّة ⇒ إلغاء.
 *  - متابعة ثانية لنفس الزبون ⇒ إلغاء (تُبقي الأقدم؛ متابعة واحدة لكل استفسار).
 * مسودة «جواب على سؤال» لعميل مؤهّل حديث تبقى سليمة.
 */
export function planCommercialDraftCleanup(input: {
  drafts: readonly CommercialDraft[];
  leads: readonly CommercialLead[];
  nowIso: string;
}): { cancellations: DraftCancellation[]; keptPending: number } {
  const { drafts, leads, nowIso } = input;
  const leadByKey = new Map<string, CommercialLead>();
  for (const l of leads) leadByKey.set(l.key, l);
  const cancellations: DraftCancellation[] = [];
  const cancelSet = new Set<string>();
  // متابعات مقبولة سابقاً لكل زبون (لإبقاء الأقدم فقط — متابعة واحدة لكل استفسار).
  const acceptedFollowUpLead = new Set<string>();

  const pending = drafts.filter((d) => d.status === 'pending').slice().sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const d of pending) {
    const lead = leadByKey.get(d.leadKey) || null;
    let code = '';
    let reason = '';
    if (!lead) {
      code = 'NO_LEAD';
      reason = 'لا عميل مرتبط بالمسودة — أُلغيت.';
    } else if (!leadAskedRealQuestion(lead)) {
      code = 'NOT_A_REAL_QUESTION';
      reason = 'لا سؤال حقيقي (إيموجي/مدح/تحية فقط) — لا مسودة ولا متابعة.';
    } else if (lead.archived === true) {
      code = 'LEAD_ARCHIVED';
      reason = 'العميل مؤرشف (لا سؤال حقيقي) — أُلغيت المسودة.';
    } else if (d.purpose === 'follow_up') {
      if (lead.backfill === true) {
        code = 'BACKFILL_NO_FOLLOWUP';
        reason = 'تعليق مستورد بأثر رجعي (backfill) — لا يولّد متابعة.';
      } else if (!isFollowUpAgeEligible(lead.lastCustomerInteractionAt, nowIso)) {
        code = 'STALE_BEYOND_7_DAYS';
        reason = `التفاعل أقدم من ${COMMERCIAL_FOLLOWUP_MAX_AGE_HOURS / 24} أيام — لا متابعة.`;
      } else if (d.kind !== 'message') {
        code = 'PUBLIC_COMMENT_NO_FOLLOWUP';
        reason = 'لا متابعة على التعليقات العامة — المتابعة في الرسائل الخاصة فقط.';
      } else if (!lead.lastBusinessReplyAt) {
        code = 'NO_BUSINESS_REPLY';
        reason = 'لا رد سابق من المعرض — لا أساس لمتابعة.';
      } else if (isCustomerRepliedAfterBusiness(lead)) {
        code = 'CONVERSATION_LIVE';
        reason = 'ردّ الزبون بعد آخر رد للمعرض — المحادثة حيّة، لا متابعة.';
      } else if (acceptedFollowUpLead.has(lead.key)) {
        code = 'FOLLOWUP_ONCE';
        reason = 'متابعة واحدة لكل استفسار كحد أقصى — أُلغيت المتابعة المكرّرة.';
      } else {
        acceptedFollowUpLead.add(lead.key);
      }
    }
    if (code) {
      cancellations.push({ id: d.id, code, reason });
      cancelSet.add(d.id);
    }
  }
  const keptPending = pending.length - cancelSet.size;
  return { cancellations, keptPending };
}

export interface LeadArchivePlan {
  id: string;
  code: string;
  reason: string;
}

/**
 * يخطّط أرشفة الـleads المخالفة (إيموجي/مدح فقط) — لا حذف. الأرشيف يُخرج العميل من
 * دورة المتابعة ويُعلن السبب، وتبقى سجلاته في «التعليقات الواردة».
 */
export function planCommercialLeadArchive(leads: readonly CommercialLead[]): LeadArchivePlan[] {
  const out: LeadArchivePlan[] = [];
  for (const l of leads) {
    if (l.archived === true) continue;
    if (leadAskedRealQuestion(l)) continue;
    out.push({
      id: l.id,
      code: 'NO_REAL_QUESTION',
      reason: 'لا سؤال حقيقي (إيموجي/مدح/تحية فقط) — أُرشف بلا حذف؛ يبقى في التعليقات الواردة.',
    });
  }
  return out;
}

/** ملخّص تشخيصي للواجهة/التقرير (بلا نص عميل). */
export interface LeadQualificationSummary {
  totalLeads: number;
  qualifiedLeads: number;
  archivedLeads: number;
  backfillLeads: number;
  pendingDrafts: number;
  answerDrafts: number;
  followUpDrafts: number;
  staleFollowUpDrafts: number;
}

export function summarizeQualification(input: {
  leads: readonly CommercialLead[];
  drafts: readonly CommercialDraft[];
  nowIso: string;
}): LeadQualificationSummary {
  const { leads, drafts, nowIso } = input;
  const leadByKey = new Map<string, CommercialLead>();
  for (const l of leads) leadByKey.set(l.key, l);
  const pending = drafts.filter((d) => d.status === 'pending');
  let staleFollowUpDrafts = 0;
  for (const d of pending) {
    if (d.purpose !== 'follow_up') continue;
    const lead = leadByKey.get(d.leadKey);
    if (!lead || lead.backfill === true || !isFollowUpAgeEligible(lead.lastCustomerInteractionAt, nowIso)) staleFollowUpDrafts += 1;
  }
  return {
    totalLeads: leads.length,
    qualifiedLeads: leads.filter((l) => leadAskedRealQuestion(l)).length,
    archivedLeads: leads.filter((l) => l.archived === true).length,
    backfillLeads: leads.filter((l) => l.backfill === true).length,
    pendingDrafts: pending.length,
    answerDrafts: pending.filter((d) => d.purpose !== 'follow_up').length,
    followUpDrafts: pending.filter((d) => d.purpose === 'follow_up').length,
    staleFollowUpDrafts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) تشخيص اسم الكاتب (هل يعيد Graph الحقل from؟) — قراءة فقط، بلا سرّ.
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthorNameDiagnosis {
  /** عدد السجلات المفحوصة. */
  checked: number;
  /** سجلات حملت اسماً حقيقياً. */
  withName: number;
  /** سجلات حملت معرّف كاتب (from.id / IG user id). */
  withAuthorId: number;
  /** سجلات بلا اسم (يظهر لها البديل الصريح). */
  withoutName: number;
  /** هل يعيد Meta الحقل `from` فعلاً في السجلات المفحوصة؟ */
  fromFieldReturned: boolean;
  /** الحكم الصادق + ما يلزم المالك إن كان محجوباً. */
  verdict: 'from_field_returned' | 'from_field_missing' | 'no_data';
  ownerSessionRequired: boolean;
  hint: string;
  metaDashboardSteps: string[];
}

/** خطوات لوحة Meta للمطوّرين عند حجب الحقل (بلا تعديل أي إعداد من الكود). */
export const META_AUTHOR_NAME_STEPS: readonly string[] = Object.freeze([
  'Meta App Dashboard → تطبيق المعرض → Use Cases (أو Permissions and features).',
  'فعّل الصلاحية pages_read_user_content على مستوى التطبيق (وإن لزم Advanced Access في وضع Live).',
  'تأكّد أن التطبيق في وضع Live (أو أضف حساب المالك كـ Tester في وضع Development).',
  'أعد التفويض (تسجيل خروج/دخول عبر «بدء الربط») كي تُضمَّن الصلاحية في الرمز.',
  'أعد تشغيل دورة مراقب Meta ثم اقرأ التشخيص من جديد.',
]);

/**
 * يفحص السجلات الواردة الحقيقية (تعليقات/رسائل Meta) ليحسم بدليل: هل يعيد Graph
 * الحقل `from` (اسم/معرّف الكاتب) أم يحجبه؟ لا يخترع اسماً ولا يعدّل أي إعداد.
 */
export function diagnoseAuthorNameAvailability(rows: readonly any[]): AuthorNameDiagnosis {
  const meta = rows.filter((r) => r && ['facebook', 'instagram'].includes(String(r.platform || '').toLowerCase()));
  let withName = 0;
  let withAuthorId = 0;
  for (const r of meta) {
    if (String(r.authorName || '').trim()) withName += 1;
    if (String(r.authorId || '').trim()) withAuthorId += 1;
  }
  const checked = meta.length;
  const fromFieldReturned = checked > 0 && (withName > 0 || withAuthorId > 0);
  const verdict: AuthorNameDiagnosis['verdict'] = checked === 0 ? 'no_data' : (fromFieldReturned ? 'from_field_returned' : 'from_field_missing');
  const ownerSessionRequired = verdict === 'from_field_missing';
  const hint = verdict === 'from_field_returned'
    ? 'Meta تعيد حقل from (اسم/معرّف الكاتب) فعلاً — الأسماء الحقيقية متاحة في الصندوق.'
    : verdict === 'from_field_missing'
      ? 'Meta لا تعيد حقل from في السجلات المفحوصة — OWNER SESSION REQUIRED: فعّل الصلاحية/الوضع من لوحة Meta (لا يُعدّلها الكود).'
      : 'لا سجلات Meta واردة بعد — التشخيص غير حاسم.';
  return {
    checked,
    withName,
    withAuthorId,
    withoutName: checked - withName,
    fromFieldReturned,
    verdict,
    ownerSessionRequired,
    hint,
    metaDashboardSteps: ownerSessionRequired ? [...META_AUTHOR_NAME_STEPS] : [],
  };
}
