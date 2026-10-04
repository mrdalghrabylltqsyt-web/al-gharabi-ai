/**
 * Next-Best-Action Engine — اقتراح الإجراء التالي الأنسب (منطق خالص قابل للاختبار).
 *
 * يقيّم الخيارات المتاحة بناءً على: الهدف، الدليل، السياق، القدرات، المخاطر،
 * الفائدة المتوقّعة، وحالة المنصة. المخرَج **اقتراح إجراء محكوم** (Action Proposal)
 * لا تنفيذ مطلق. لا يُقترح إجراء بكسبيلة لا تدعمه، ولا إجراء خارجي بلا حوكمة.
 *
 * الخيارات: respond / follow_up / create_content / analyze / wait /
 *           ask_clarification / escalate / do_nothing.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا تنفيذ.
 */

import type { NextActionKind, NextActionProposal } from './types';
import { NEXT_ACTION_LABELS_AR } from './types';
import type { BrainDecisionStatus } from '../team/brainDecision';

export interface NextActionInput {
  /** الهدف الحالي (من مدير الأهداف). */
  goalKind: string;
  /** حالة الصدق للقرار (FACT/DERIVED ⇒ يمكن البناء عليه). */
  truthState: 'FACT' | 'DERIVED' | 'HYPOTHESIS' | 'UNKNOWN' | 'UNAVAILABLE';
  /** الحالة النهائية لقرار العقل (من Batch 6) — تقود الإجراء. */
  brainFinalStatus: BrainDecisionStatus;
  /** هل يوجد خلاف جوهري غير محسوم؟ */
  forcesHumanOrSafe: boolean;
  /** قدرات المنصة الفعلية. */
  replyCapable: boolean;
  publishCapable: boolean;
  /** هل المنصة متصلة وموثّقة؟ */
  providerVerified: boolean;
  /** هل السعر/المعلومة الحسّاسة موثّقة؟ */
  priceUnverified: boolean;
  /** فئة الحدث. */
  eventCategory: string;
  /** هل الحدث سبام؟ */
  isSpam: boolean;
  /** هل يوجد تصعيد معلّق؟ */
  hasPendingEscalation: boolean;
  /** هل هناك فرصة جمهور/محتوى ملاحَظة؟ */
  hasContentOpportunity: boolean;
}

/** فائدة متوقّعة تقديرية (منخفضة/متوسطة/عالية) — لا رقم مُخترع. */
type Usefulness = 'none' | 'low' | 'medium' | 'high';

function proposal(kind: NextActionKind, rationale: string, permission: NextActionProposal['requiredPermission'], risk: NextActionProposal['risk'], usefulness: Usefulness, reasons: string[]): NextActionProposal & { usefulness: Usefulness } {
  return { kind, labelAr: NEXT_ACTION_LABELS_AR[kind], rationale, requiredPermission: permission, risk, governed: true, reasons, usefulness };
}

/**
 * يقترح الإجراء التالي بترتيب أسبقية صريح (السلامة قبل الفائدة):
 *   1) سبام/حالة آمنة => do_nothing/wait.
 *   2) حسّاس/تصعيد/خلاف جوهري => escalate.
 *   3) ادعاء غير مثبت/سعر غير موثّق => ask_clarification أو escalate.
 *   4) نية شراء + قدرة رد + اتصال موثق => respond (عبر البوابة).
 *   5) فرصة محتوى + قدرة نشر => create_content.
 *   6) دليل كافٍ => analyze، وإلا wait.
 */
export function proposeNextAction(input: NextActionInput): NextActionProposal & { usefulness: Usefulness } {
  // 1) سبام: لا إجراء (لا رد آلي).
  if (input.isSpam) {
    return proposal('do_nothing', 'سبام: لا يُردّ عليه آلياً للحفاظ على جودة التفاعل.', 'READ', 'low', 'none', ['سبام', 'لا أتمتة على السبام']);
  }

  // 2) تصعيد بشري / خلاص جوهري / قرار العقل = تصعيد => escalate.
  const mustEscalate = input.brainFinalStatus === 'HUMAN_ESCALATION'
    || input.forcesHumanOrSafe
    || input.priceUnverified
    || input.eventCategory === 'complaint';
  if (mustEscalate) {
    return proposal('escalate', 'حالة تحتاج مراجعة بشرية (حسّاسة/شكوى/خلاف جوهري/سعر غير موثّق).', 'SENSITIVE', 'high', 'high', ['سلامة قبل الفائدة', 'لا أتمتة على الحساس']);
  }

  // 3) قرار العقل توقف آمن / ادعاء غير مثبت => طلب توضيح أو انتظار.
  if (input.brainFinalStatus === 'FAILED_SAFE' || input.truthState === 'UNKNOWN' || input.truthState === 'UNAVAILABLE') {
    if (input.eventCategory === 'question') {
      return proposal('ask_clarification', 'لا دليل كافٍ للإجابة؛ طلب توضيح واحد محدّد أفضل من اختراع.', 'READ', 'low', 'medium', ['لا دليل كافٍ', 'لا اختراع']);
    }
    return proposal('wait', 'لا دليل كافٍ لاتخاذ إجراء؛ ننتظر بيانات حقيقية (لا اختراع).', 'READ', 'low', 'low', ['لا دليل كافٍ']);
  }

  // 4) نية شراء: رد عبر البوابة إن أمكن، وإلا متابعة/تحليل.
  if (input.eventCategory === 'purchase_intent') {
    if (input.replyCapable && input.providerVerified && input.brainFinalStatus === 'ALLOWED_ACTION') {
      return proposal('respond', 'نية شراء مع دليل موثّق وقدرة رد واتصال موثق؛ رد من الحقائق عبر البوابة.', 'EXTERNAL_ACTION', 'medium', 'high', ['نية شراء', 'قدرة رد متاحة', 'اتصال موثق']);
    }
    return proposal('follow_up', 'نية شراء؛ المتابعة/Qلكنة الرد تتطلب استيفاء بوابة النشر/الرد (قدرة/اتصال/تفويض).', 'EXECUTE', 'low', 'medium', ['نية شراء', 'البوابة غير مكتملة']);
  }

  // 5) فرصة محتوى: إنشاء محتوى (يحتاج اعتماد).
  if (input.hasContentOpportunity || input.eventCategory === 'content_request' || input.eventCategory === 'feature_request') {
    if (input.publishCapable) {
      return proposal('create_content', 'فرصة محتوى من حاجة ملاحَظة؛ اقتراح محتوى موجّه (يحتاج اعتماد المالك).', 'WRITE', 'low', 'medium', ['فرصة محتوى', 'قدرة نشر متاحة']);
    }
    return proposal('analyze', 'فرصة محتوى ملاحَظة لكن قدرة النشر غير متاحة؛ تحليل فقط بلا ادعاء قدرة.', 'READ', 'low', 'low', ['قدرة نشر غير متاحة']);
  }

  // 6) مدح/سؤال عام بدليل كافٍ: رد إن أمكن، وإلا تحليل.
  if (input.truthState === 'FACT' || input.truthState === 'DERIVED') {
    if (input.replyCapable && input.providerVerified && input.brainFinalStatus === 'ALLOWED_ACTION') {
      return proposal('respond', 'دليل كافٍ + قدرة رد + اتصال موثق؛ رد مناسب عبر البوابة.', 'EXTERNAL_ACTION', 'medium', 'medium', ['دليل كافٍ', 'قدرة رد', 'اتصال موثق']);
    }
    return proposal('analyze', 'دليل كافٍ للتحليل؛ لا قدرة/بوابة رد مكتملة الآن.', 'READ', 'low', 'low', ['دليل كافٍ', 'بوابة الرد غير مكتملة']);
  }

  return proposal('wait', 'لا حاجة لإجراء الآن؛ نراقب بيانات جديدة.', 'READ', 'low', 'low', ['لا دليل حاسم']);
}

/** ملخّص الاقتراح للعرض/التشخيص. */
export function summarizeNextAction(p: NextActionProposal): string {
  return `${p.labelAr} (صلاحية ${p.requiredPermission} · خطر ${p.risk}) — ${p.rationale}`;
}
