/**
 * Customer Journey — فصل مراحل العميل صراحةً (منطق خالص).
 *
 * الغرض: منع «خلط» كل تفاعل في حالة «عميل» واحدة. من يسأل «شكد القسط؟» ليس
 * مشترياً، ومن يعلّق «أريد وحدة» ليس بيعاً مؤكّداً. لكل مرحلة دليلها ومصدرها،
 * والانتقال إلى `VERIFIED_SALE` لا يقع إلا **بمصدر بيع موثوق** (نظام البيع).
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../../social/adapter';
import { type ConversationCategory } from '../audience/conversationIntelligence';

/**
 * المراحل من الأضعف إلى الأقوى. لا تُدمج: كل مرحلة لها معنى تجاري مستقل،
 * والانتقال بينها يحتاج دليلاً لا مجرد وجود تفاعل.
 */
export type JourneyStage =
  | 'VIEW'
  | 'INTEREST'
  | 'ENGAGEMENT'
  | 'INQUIRY'
  | 'PURCHASE_SIGNAL'
  | 'LEAD'
  | 'REQUEST'
  | 'VERIFIED_SALE';

export const JOURNEY_STAGE_LABELS_AR: Record<JourneyStage, string> = Object.freeze({
  VIEW: 'مشاهدة',
  INTEREST: 'اهتمام',
  ENGAGEMENT: 'تفاعل',
  INQUIRY: 'استفسار',
  PURCHASE_SIGNAL: 'إشارة شراء',
  LEAD: 'عميل محتمل',
  REQUEST: 'طلب',
  VERIFIED_SALE: 'بيع موثّق',
});

export const JOURNEY_ORDER: readonly JourneyStage[] = Object.freeze([
  'VIEW', 'INTEREST', 'ENGAGEMENT', 'INQUIRY', 'PURCHASE_SIGNAL', 'LEAD', 'REQUEST', 'VERIFIED_SALE',
]);

/** الدليل الذي يُسند كل مرحلة. */
export interface JourneyEvidence {
  stage: JourneyStage;
  reason: string;
  source: string;
  /** هل هذا الانتقال مُثبت فعلاً أم مجرّد حالة مُدخَلة؟ */
  verified: boolean;
}

export interface JourneyState {
  subjectKey: string;
  platform: PlatformId | 'cross_platform';
  stage: JourneyStage;
  /** كل الأدلة المتوفرة (لا تُحذف عند الترقية). */
  evidence: JourneyEvidence[];
  productId: string | null;
  updatedAt: string;
  /** هل يمكن إعلان بيع لهذا الموضوع؟ لا إلا بمصدر بيع موثوق. */
  saleVerified: boolean;
  limitations: string;
}

function stageIndex(stage: JourneyStage): number {
  return JOURNEY_ORDER.indexOf(stage);
}

/**
 * يشتقّ المرحلة من تفاعل حقيقي واحد (تعليق/رسالة). لا يرقّي إلى LEAD/REQUEST/
 * VERIFIED_SALE من نص وحده: تلك تحتاج مصدراً تجارياً (نظام العملاء/البيع).
 */
export function stageFromInteraction(input: {
  platform: PlatformId;
  category: ConversationCategory;
  isBusinessInquiry: boolean;
}): JourneyEvidence {
  const source = `${input.platform} — تعليق/رسالة حقيقية`;
  if (input.isBusinessInquiry) {
    return { stage: 'PURCHASE_SIGNAL', reason: 'استفسار أعمال صريح (سعر/تقسيط/توفر).', source, verified: true };
  }
  switch (input.category) {
    case 'question':
      return { stage: 'INQUIRY', reason: 'سؤال حقيقي يحتاج جواباً.', source, verified: true };
    case 'complaint':
    case 'objection':
    case 'feature_request':
    case 'content_request':
      return { stage: 'ENGAGEMENT', reason: 'تفاعل ذو مضمون (اعتراض/طلب/شكوى).', source, verified: true };
    case 'praise':
      return { stage: 'INTEREST', reason: 'إعجاب/مدح — اهتمام بلا نية شراء مثبتة.', source, verified: true };
    default:
      return { stage: 'VIEW', reason: 'وجود تفاعل بلا دليل أقوى.', source, verified: true };
  }
}

/** يرفع المرحلة إلى الأعلى فقط (لا نزول)، مع حفظ كل الأدلة. */
export function advanceJourney(current: JourneyState, evidence: JourneyEvidence, now: number): JourneyState {
  const higher = stageIndex(evidence.stage) > stageIndex(current.stage);
  return {
    ...current,
    stage: higher ? evidence.stage : current.stage,
    evidence: [...current.evidence, evidence],
    updatedAt: new Date(now).toISOString(),
    limitations: higher
      ? 'المرحلة مشتقة من تفاعل حقيقي؛ لا تُرقّى إلى عميل/طلب/بيع بلا مصدر تجاري موثوق.'
      : current.limitations,
  };
}

export function newJourneyState(input: {
  subjectKey: string;
  platform: PlatformId | 'cross_platform';
  productId?: string | null;
  now: number;
}): JourneyState {
  return {
    subjectKey: input.subjectKey,
    platform: input.platform,
    stage: 'VIEW',
    evidence: [],
    productId: input.productId ?? null,
    updatedAt: new Date(input.now).toISOString(),
    saleVerified: false,
    limitations: 'لا بيع بلا مصدر موثوق؛ ولا يُعتبر المستفسر مشترياً.',
  };
}

/**
 * ترقية صريحة إلى LEAD/REQUEST بمصدر تجاري (نظام العملاء/المحادثات). لا تقع
 * من نص تعليق وحده.
 */
export function promoteToLead(state: JourneyState, evidence: { source: string; reason: string }, now: number): JourneyState {
  return {
    ...state,
    stage: stageIndex('LEAD') > stageIndex(state.stage) ? 'LEAD' : state.stage,
    evidence: [...state.evidence, { stage: 'LEAD', reason: evidence.reason, source: evidence.source, verified: true }],
    updatedAt: new Date(now).toISOString(),
    limitations: 'عميل محتمل مسجّل بمصدر تجاري؛ ليس بيعاً.',
  };
}

export function promoteToRequest(state: JourneyState, evidence: { source: string; reason: string }, now: number): JourneyState {
  return {
    ...state,
    stage: stageIndex('REQUEST') > stageIndex(state.stage) ? 'REQUEST' : state.stage,
    evidence: [...state.evidence, { stage: 'REQUEST', reason: evidence.reason, source: evidence.source, verified: true }],
    updatedAt: new Date(now).toISOString(),
    limitations: 'طلب مسجّل؛ يبقى بيعاً محتملاً حتى تأكيد المصدر.',
  };
}

/**
 * **القاعدة الحاكمة:** لا `VERIFIED_SALE` إلا بمصدر بيع موثوق (معرّف عملية بيع
 * فعلية). أي محاولة بلا مصدر تُرفض صراحةً.
 */
export function verifySale(state: JourneyState, evidence: { source: string; reason: string; saleId: string | null }, now: number): JourneyState {
  if (!evidence.saleId) {
    return {
      ...state,
      evidence: [...state.evidence, { stage: state.stage, reason: `مُنع إعلان بيع بلا مصدر موثوق: ${evidence.reason}`, source: evidence.source, verified: false }],
      limitations: 'لا يُعلن البيع إلا بمعرّف عملية بيع حقيقي من نظام البيع.',
    };
  }
  return {
    ...state,
    stage: 'VERIFIED_SALE',
    saleVerified: true,
    evidence: [...state.evidence, { stage: 'VERIFIED_SALE', reason: evidence.reason, source: evidence.source, verified: true }],
    updatedAt: new Date(now).toISOString(),
    limitations: 'بيع موثّق بمعرّف عملية بيع حقيقي.',
  };
}

/** هل المرحلة تعني «مشترٍ مؤكّد»؟ لا إلا `VERIFIED_SALE`. */
export function isConfirmedBuyer(state: JourneyState): boolean {
  return state.stage === 'VERIFIED_SALE' && state.saleVerified;
}

export interface JourneySummary {
  total: number;
  byStage: Record<string, number>;
  confirmedSales: number;
  note: string;
}

export function summarizeJourneys(states: JourneyState[]): JourneySummary {
  const byStage: Record<string, number> = {};
  for (const s of states) byStage[s.stage] = (byStage[s.stage] || 0) + 1;
  return {
    total: states.length,
    byStage,
    confirmedSales: states.filter(isConfirmedBuyer).length,
    note: 'المراحل منفصلة صراحةً؛ «البيع» يُعدّ فقط بحالة VERIFIED_SALE بمصدر موثوق.',
  };
}
