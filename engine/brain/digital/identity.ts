/**
 * Digital Sales — نموذج هوية العميل/المحادثة الآمن (منطق خالص).
 *
 * الغرض: ربط المحادثات بالعميل نفسه **فقط عند وجود معرّف موثوق**، ومنع أي دمج
 * قائم على تشابه اسم/نص أو تخمين AI. ويقلّل تخزين المعلومات الشخصية غير الضرورية.
 *
 * القواعد الملزمة:
 * - الدمج يقع فقط بمعرّف موثوق: رقم هاتف مطبَّع كامل، أو `platform:customerId`.
 * - لا دمج بسبب تشابه الأسماء أو النصوص أو رقم غير مؤكّد أو «ظنّ» AI.
 * - لا تخزين سمات حساسة (عمر/جنس/دين/هوية/موقع دقيق).
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../../social/adapter';
import { createHash } from 'node:crypto';

export type IdentityConfidence = 'strong' | 'weak';

export const IDENTITY_CONFIDENCE_LABELS_AR: Record<IdentityConfidence, string> = Object.freeze({
  strong: 'معرّف موثوق (يسمح بالربط)',
  weak: 'معرّف غير موثوق (لا يسمح بالربط)',
});

export interface CustomerIdentity {
  /** مفتاح العميل الموحّد — يُبنى من معرّف موثوق فقط، أو يبقى محلياً للمحادثة. */
  customerKey: string;
  confidence: IdentityConfidence;
  platform: PlatformId | 'cross_platform' | null;
  platformCustomerId: string | null;
  conversationId: string | null;
  leadId: string | null;
  /** معرّفات ربط أخرى (حملة/منتج) بلا بيانات شخصية. */
  refs: Record<string, string | null>;
  /** سبب حسم الهوية (للتفسير). */
  reason: string;
  /** حقول حساسة لم تُخزَّن صراحةً. */
  withheldFields: string[];
}

/** الحقول الحساسة التي لا تُخزَّن — مصدر واحد. */
export const IDENTITY_WITHHELD_FIELDS: ReadonlyArray<{ field: string; reason: string }> = Object.freeze([
  { field: 'age', reason: 'سمة حساسة غير مطلوبة ولا تُستنتج.' },
  { field: 'gender', reason: 'سمة حساسة غير مطلوبة ولا تُستنتج.' },
  { field: 'religion', reason: 'سمة حساسة غير مطلوبة ولا تُستنتج.' },
  { field: 'national_id', reason: 'معرّف هوية رسمي غير مطلوب في هذه الطبقة.' },
  { field: 'exact_location', reason: 'موقع دقيق غير مطلوب ولا يُخزَّن.' },
  { field: 'inferred_personality', reason: 'ملف شخصي مُستنتَج ممنوع.' },
]);

/**
 * يطبّع رقماً إلى صيغة موثوقة: أرقام فقط بطول معقول (10–15 خانة). الرقم غير
 * المكتمل أو الغامض لا يُعتبر معرّفاً موثوقاً.
 */
export function normalizeTrustedPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D+/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

/** مفتاح معرّف منصة موثوق: `platform:customerId` إن وُجد المعرّف. */
export function platformIdentityKey(platform: string | null | undefined, customerId: string | null | undefined): string | null {
  const p = typeof platform === 'string' ? platform.trim() : '';
  const c = typeof customerId === 'string' ? customerId.trim() : '';
  if (!p || !c || p === 'cross_platform') return null;
  return `${p}:${c}`;
}

/**
 * بصمة عميل **آمنة الخصوصية** تُستخدم كمفتاح حفظ للموافقة/سجل المتابعة: SHA-256
 * مقتطعة. لا تُخزَّن قيمة الهاتف/المعرّف الخام في ملفات الحالة، وتصمد البصمة
 * للربط بعد إعادة التشغيل.
 */
export function privacyCustomerHash(customerKey: string | null | undefined): string | null {
  if (!customerKey) return null;
  return `k_${createHash('sha256').update(String(customerKey)).digest('hex').slice(0, 24)}`;
}

/**
 * يبني هوية العميل من معرّفات حقيقية. الدمج يقع فقط عند معرّف موثوق؛ وإلا تبقى
 * الهوية محلية للمحادثة (`weak`) ولا تُدمج مع أي عميل آخر.
 */
export function buildCustomerIdentity(input: {
  platform?: PlatformId | 'cross_platform' | null;
  platformCustomerId?: string | null;
  phone?: string | null;
  conversationId?: string | null;
  leadId?: string | null;
  refs?: Record<string, string | null>;
}): CustomerIdentity {
  const withheld = IDENTITY_WITHHELD_FIELDS.map((f) => f.field);
  const phone = normalizeTrustedPhone(input.phone);
  if (phone) {
    return {
      customerKey: `phone:${phone}`,
      confidence: 'strong',
      platform: input.platform ?? null,
      platformCustomerId: input.platformCustomerId ?? null,
      conversationId: input.conversationId ?? null,
      leadId: input.leadId ?? null,
      refs: { ...(input.refs || {}) },
      reason: 'رقم هاتف مطبَّع كامل — معرّف موثوق يسمح بالربط.',
      withheldFields: withheld,
    };
  }
  const platKey = platformIdentityKey(input.platform, input.platformCustomerId);
  if (platKey) {
    return {
      customerKey: platKey,
      confidence: 'strong',
      platform: input.platform ?? null,
      platformCustomerId: input.platformCustomerId ?? null,
      conversationId: input.conversationId ?? null,
      leadId: input.leadId ?? null,
      refs: { ...(input.refs || {}) },
      reason: 'معرّف عميل المنصة موثوق — يسمح بالربط.',
      withheldFields: withheld,
    };
  }
  // لا معرّف موثوق: الهوية محلية للمحادثة فقط ولا تُدمج.
  const localKey = input.conversationId ? `conv:${input.conversationId}` : `anon:${input.platform || 'unknown'}`;
  return {
    customerKey: localKey,
    confidence: 'weak',
    platform: input.platform ?? null,
    platformCustomerId: input.platformCustomerId ?? null,
    conversationId: input.conversationId ?? null,
    leadId: input.leadId ?? null,
    refs: { ...(input.refs || {}) },
    reason: 'لا معرّف موثوق — الهوية محلية للمحادثة ولا تُدمج مع عميل آخر.',
    withheldFields: withheld,
  };
}

/**
 * يقرّر هل يجوز ربط هويتين بالعميل نفسه. **فقط** عند وجود مفتاح موثوق متطابق.
 * لا ربط بتشابه اسم/نص أو «ظنّ» — تُرفض صراحةً.
 */
export function canLinkIdentities(a: CustomerIdentity, b: CustomerIdentity): { link: boolean; reason: string } {
  if (a.confidence !== 'strong' || b.confidence !== 'strong') {
    return { link: false, reason: 'لا ربط بلا معرّف موثوق من الطرفين.' };
  }
  if (a.customerKey === b.customerKey) {
    return { link: true, reason: 'تطابق معرّف موثوق تماماً.' };
  }
  return { link: false, reason: 'المعرّفان الموثوقان مختلفان — لا دمج.' };
}

/**
 * **ممنوع** الربط بالاسم/التشابه. هذه الدالة موجودة كحرس صريح: تُعيد دائماً
 * الرفض، وتُستخدم في الاختبارات وفي أي مسار قد يُغري بالدمج الخاطئ.
 */
export function linkByNameSimilarity(_nameA: string, _nameB: string): { link: false; reason: string } {
  return { link: false, reason: 'ممنوع ربط العملاء بتشابه الأسماء أو النصوص أو ظنّ AI — لا معرّف موثوق.' };
}
