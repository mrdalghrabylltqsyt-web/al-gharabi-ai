/**
 * Digital Sales — إسناد البيع (Attribution) (منطق خالص).
 *
 * الغرض: ربط حملة → تفاعل → محادثة → عميل → طلب → بيع **فقط عند وجود معرّفات
 * موثوقة**. لا يُعلن سببية عند الشك؛ `UNCERTAIN` تُعلن صراحةً.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../../social/adapter';

export type AttributionState = 'DIRECT' | 'SUPPORTED' | 'UNCERTAIN' | 'NOT_ATTRIBUTABLE';

export const ATTRIBUTION_LABELS_AR: Record<AttributionState, string> = Object.freeze({
  DIRECT: 'إسناد مباشر (معرّف موثوق من الحملة إلى البيع)',
  SUPPORTED: 'إسناد مدعوم (سلسلة معرّفات موثوقة)',
  UNCERTAIN: 'إسناد غير مؤكّد',
  NOT_ATTRIBUTABLE: 'غير قابل للإسناد',
});

export interface AttributionChain {
  campaignId: string | null;
  interactionId: string | null;
  conversationId: string | null;
  leadId: string | null;
  requestId: string | null;
  saleId: string | null;
  platform: PlatformId | 'cross_platform' | null;
}

/** المعرّفات الموثوقة المطلوبة لكل حلقة في السلسلة. */
export const ATTRIBUTION_REQUIRED_LINKS: readonly string[] = Object.freeze([
  'campaignId', 'leadId', 'saleId',
]);

export interface AttributionResult {
  state: AttributionState;
  /** الحلقات الموثوقة الموجودة فعلاً. */
  linked: string[];
  /** الحلقات المفقودة. */
  missing: string[];
  /** هل يجوز قول «الحملة سبّبت البيع»؟ لا إلا DIRECT/SUPPORTED. */
  canClaimCausation: boolean;
  reason: string;
  limitations: string[];
}

/**
 * يحسب حالة الإسناد. لا سببية بلا سلسلة معرّفات موثوقة من الحملة إلى البيع.
 */
export function computeAttribution(chain: AttributionChain): AttributionResult {
  const has = (k: keyof AttributionChain) => Boolean(chain[k]);
  const linked: string[] = [];
  const missing: string[] = [];
  for (const k of ['campaignId', 'interactionId', 'conversationId', 'leadId', 'requestId', 'saleId'] as Array<keyof AttributionChain>) {
    if (has(k)) linked.push(k); else missing.push(k);
  }

  if (!has('saleId')) {
    return {
      state: 'NOT_ATTRIBUTABLE', linked, missing,
      canClaimCausation: false,
      reason: 'لا بيع موثّق (بلا معرّف بيع) — لا إسناد.',
      limitations: ['الإسناد يتطلّب بيعاً موثّقاً.'],
    };
  }
  if (has('campaignId') && has('leadId')) {
    // سلسلة كاملة الحملة→العميل→البيع.
    if (has('interactionId') || has('conversationId')) {
      return {
        state: 'DIRECT', linked, missing, canClaimCausation: true,
        reason: 'سلسلة معرّفات موثوقة كاملة من الحملة إلى البيع.',
        limitations: ['الإسناد المباشر لا يُثبت وحده أن الحملة هي السبب الوحيد — يبقى ارتباطاً موثّقاً.'],
      };
    }
    return {
      state: 'SUPPORTED', linked, missing, canClaimCausation: true,
      reason: 'الحملة والعميل والبيع مرتبطون بمعرّفات موثوقة (بلا حلقة تفاعل/محادثة).',
      limitations: ['الحلقة الوسيطة مفقودة لكن الإسناد مدعوم بالمعرّفات المتوفرة.'],
    };
  }
  if (has('campaignId') || has('leadId')) {
    return {
      state: 'UNCERTAIN', linked, missing, canClaimCausation: false,
      reason: 'يوجد بيع ومرجع جزئي (حملة أو عميل) بلا ربط موثوق كامل.',
      limitations: ['لا يجوز قول «الحملة سبّبت البيع» — الإسناد غير مؤكّد.'],
    };
  }
  return {
    state: 'NOT_ATTRIBUTABLE', linked, missing, canClaimCausation: false,
    reason: 'بيع موثّق بلا أي مرجع حملة/عميل قابل للربط.',
    limitations: ['لا يمكن نسبة البيع لأي حملة.'],
  };
}
