/**
 * Digital Sales — محرّك المتابعة (منطق خالص).
 *
 * الغرض: اقتراح فرص متابعة **مبنية على دليل** مع احترام الموافقة/الإلغاء/حدود
 * التكرار/قواعد المنصة/الخصوصية/مكافحة السبام. لا رسائل خارجية تلقائية، ولا
 * تكرار لنفس المتابعة.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../../social/adapter';

export type FollowUpState = 'FOLLOW_UP_OPPORTUNITY' | 'NOT_ELIGIBLE';

export interface FollowUpPolicy {
  /** هل وافق العميل على المتابعة؟ */
  consent: boolean;
  /** هل طلب إلغاء الاشتراك/عدم المتابعة؟ */
  optedOut: boolean;
  /** أقصى عدد متابعات مسموح. */
  maxFollowUps: number;
  /** أدنى فاصل بالأيام بين متابعتين. */
  minDaysBetween: number;
  /** أقصى عدد متابعات خلال آخر 30 يوماً (مكافحة سبام). */
  maxPer30Days: number;
}

export const DEFAULT_FOLLOW_UP_POLICY: Readonly<FollowUpPolicy> = Object.freeze({
  consent: false, optedOut: false, maxFollowUps: 3, minDaysBetween: 3, maxPer30Days: 4,
});

export const FOLLOW_UP_STATE_LABELS_AR: Record<FollowUpState, string> = Object.freeze({
  FOLLOW_UP_OPPORTUNITY: 'فرصة متابعة',
  NOT_ELIGIBLE: 'غير مؤهّل للمتابعة',
});

export interface FollowUpOpportunity {
  state: FollowUpState;
  why: string;
  when: string | null;
  whatToSay: string;
  evidence: string[];
  confidence: 'high' | 'medium' | 'low';
  /** ما يمنع المتابعة الآن (إن مُنعت). */
  blockers: string[];
  at: string;
}

/**
 * يقرّر فرصة متابعة لأي عميل سأل عن منتج ولم يُتمّم. يمنع المتابعة عند غياب
 * الموافقة/الإلغاء/تجاوز الحدود/التكرار.
 */
export function planFollowUp(input: {
  /** هل سأل العميل عن منتج ولم يشترِ؟ */
  askedAboutProductNoPurchase: boolean;
  productId: string | null;
  /** هل هناك إشارة شراء (تزيد أولوية المتابعة)؟ */
  purchaseSignal: boolean;
  policy: FollowUpPolicy;
  /** عدد المتابعات السابقة لهذا العميل/المنتج. */
  priorFollowUps: number;
  /** آخر متابعة (ISO) إن وُجدت. */
  lastFollowUpAt: string | null;
  /** عدد المتابعات خلال آخر 30 يوماً. */
  followUpsLast30Days: number;
  nowMs: number;
}): FollowUpOpportunity {
  const at = new Date(input.nowMs).toISOString();
  const p = input.policy;
  const blockers: string[] = [];

  if (!input.askedAboutProductNoPurchase) blockers.push('لا سؤال سابق عن منتج بلا شراء.');
  if (p.optedOut) blockers.push('العميل طلب عدم المتابعة (opt-out) — لا متابعة.');
  if (!p.consent) blockers.push('لا موافقة على المتابعة (consent) — لا متابعة تلقائية.');
  if (input.priorFollowUps >= p.maxFollowUps) blockers.push(`تجاوز الحد الأقصى للمتابعات (${p.maxFollowUps}).`);
  if (input.followUpsLast30Days >= p.maxPer30Days) blockers.push(`تجاوز حدّ 30 يوماً (${p.maxPer30Days}) — مكافحة سبام.`);

  if (input.lastFollowUpAt) {
    const last = Date.parse(input.lastFollowUpAt);
    if (Number.isFinite(last)) {
      const days = (input.nowMs - last) / (24 * 60 * 60 * 1000);
      if (days < p.minDaysBetween) blockers.push(`أقل من الفاصل الأدنى (${p.minDaysBetween} أيام) منذ آخر متابعة.`);
    }
  }

  if (blockers.length) {
    return {
      state: 'NOT_ELIGIBLE',
      why: 'لا متابعة الآن.',
      when: null,
      whatToSay: '',
      evidence: blockers,
      confidence: 'low',
      blockers,
      at,
    };
  }

  // أقرب وقت مسموح = الآن (الشروط محققة)؛ نعرض فقط ما يُقال من بيانات موثّقة.
  const whenEarliest = input.lastFollowUpAt && Number.isFinite(Date.parse(input.lastFollowUpAt))
    ? new Date(Date.parse(input.lastFollowUpAt) + p.minDaysBetween * 24 * 60 * 60 * 1000).toISOString()
    : at;

  return {
    state: 'FOLLOW_UP_OPPORTUNITY',
    why: input.purchaseSignal
      ? 'العميل أبدى إشارة شراء عن منتج ولم يُتمّم البيع.'
      : 'العميل سأل عن منتج ولم يُتمّم البيع.',
    when: whenEarliest,
    whatToSay: input.productId
      ? 'تذكير مهذّب بالمنتج الذي سأل عنه، مع عرض المعلومات الموثّقة فقط (سعر/تقسيط/توفر) ودعوة للتحدّث مع الفريق — بلا التزام غير معتمد.'
      : 'متابعة مهذّبة للاستفسار السابق ودعوة لتحديد المنتج.',
    evidence: [
      `askedAboutProductNoPurchase=${input.askedAboutProductNoPurchase}`,
      `purchaseSignal=${input.purchaseSignal}`,
      `priorFollowUps=${input.priorFollowUps}`,
      `followUpsLast30Days=${input.followUpsLast30Days}`,
      `consent=${p.consent}`,
    ],
    confidence: input.purchaseSignal ? 'high' : 'medium',
    blockers: [],
    at,
  };
}

/**
 * يمنع تكرار نفس المتابعة لنفس العميل/المنتج خلال نافذة زمنية (حماية مزدوجة
 * إضافةً لحدود السياسة).
 */
export function isDuplicateFollowUp(input: {
  customerKey: string;
  productId: string | null;
  recent: Array<{ customerKey: string; productId: string | null; at: string }>;
  nowMs: number;
  windowDays?: number;
}): { duplicate: boolean; reason: string } {
  const windowMs = (input.windowDays ?? 3) * 24 * 60 * 60 * 1000;
  for (const r of input.recent || []) {
    if (r.customerKey !== input.customerKey) continue;
    if ((r.productId || null) !== (input.productId || null)) continue;
    const at = Date.parse(r.at);
    if (Number.isFinite(at) && input.nowMs - at < windowMs) {
      return { duplicate: true, reason: 'متابعة مطابقة حديثة لنفس العميل/المنتج — لا تكرار.' };
    }
  }
  return { duplicate: false, reason: 'لا تكرار مطابق.' };
}

/** حالة موافقة/إلغاء صريحة — تُحفظ بأقل قدر من البيانات. */
export interface ConsentState {
  customerKey: string;
  consent: boolean;
  optedOut: boolean;
  updatedAt: string;
}

/** يُطبّق تغيير الموافقة/الإلغاء. الإلغاء يُقدَّم دائماً. */
export function applyConsentUpdate(current: ConsentState, update: { consent?: boolean; optedOut?: boolean; nowMs: number }): ConsentState {
  const optedOut = update.optedOut === true ? true : (current.optedOut && update.optedOut !== false ? true : Boolean(update.optedOut ?? current.optedOut));
  const consent = optedOut ? false : Boolean(update.consent ?? current.consent);
  return { customerKey: current.customerKey, consent, optedOut, updatedAt: new Date(update.nowMs).toISOString() };
}
