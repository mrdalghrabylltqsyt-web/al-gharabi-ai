/**
 * تصنيف الاستعادة (Recovery Classification) — منطق صافٍ قابل للاختبار.
 *
 * يفصل صراحةً ما يمكن استعادته فعلياً عند فقدان كل مفاتيح بيئة التشغيل:
 *  - RESTORABLE            : تُستعاد قيمته الحرفية من الخزنة/النسخة (حرج، محفوظ).
 *  - REGENERATABLE         : يُعاد توليده داخل النظام أو لا يمنع الإقلاع (اختياري).
 *  - REQUIRES_OWNER_ACTION : يجب أن يحتفظ به المالك خارج النظام أو يُعاد إصداره من مزوّد.
 *  - NOT_RECOVERABLE       : قيمة حرجة مفقودة من الخزنة — لا يمكن استعادتها (فشل صريح).
 *
 * لا يحتوي هذا الملف أي قيمة سرّية؛ أسماء وتصنيفات فقط.
 */

import type { SecretInventoryEntry, VaultRecoverability } from './inventory';
import { VAULT_SELF_KEY_ENV } from './inventory';

export type RecoveryClass = 'RESTORABLE' | 'REGENERATABLE' | 'REQUIRES_OWNER_ACTION' | 'NOT_RECOVERABLE';

export interface RecoveryClassification {
  name: string;
  recoverability: VaultRecoverability;
  recoveryCritical: boolean;
  presentInVault: boolean;
  classification: RecoveryClass;
  reason: string;
}

/**
 * يصنّف كل عنصر جرد مقابل قيم الخزنة المستعادة.
 * @param inventory الجرد المعتمد (أسماء/تصنيفات فقط).
 * @param vaultValues القيم المفكوكة من الخزنة `{ NAME: value }` (بلا قيم في المخرَج).
 */
export function classifyInventoryForRecovery(
  inventory: SecretInventoryEntry[],
  vaultValues: Record<string, string> = {},
): RecoveryClassification[] {
  return inventory.map((e) => {
    const inVault = Object.prototype.hasOwnProperty.call(vaultValues, e.name);
    let classification: RecoveryClass;
    let reason: string;
    if (e.name === VAULT_SELF_KEY_ENV) {
      // مفتاح فتح الخزنة لا يُحفظ داخلها (منع الاحتواء الدائري)؛ المالك يحتفظ به خارجاً.
      classification = 'REQUIRES_OWNER_ACTION';
      reason = 'مفتاح فتح الخزنة يُحفظ عند المالك خارج النظام ولا يدخل الخزنة.';
    } else if (e.recoverability === 'reissue') {
      classification = 'REQUIRES_OWNER_ACTION';
      reason = 'يُعاد إصداره من المزوّد الخارجي.';
    } else if (e.recoverability === 'regenerate') {
      classification = 'REGENERATABLE';
      reason = 'يُعاد توليده داخل النظام.';
    } else if (inVault) {
      classification = 'RESTORABLE';
      reason = 'قيمته محفوظة في الخزنة وتُستعاد حرفياً.';
    } else if (e.recoverability === 'optional') {
      classification = 'REGENERATABLE';
      reason = 'اختياري: غيابه لا يمنع الإقلاع.';
    } else {
      classification = 'NOT_RECOVERABLE';
      reason = 'قيمة حرجة غير موجودة في الخزنة: لا يمكن استعادتها.';
    }
    return {
      name: e.name,
      recoverability: e.recoverability,
      recoveryCritical: e.recoveryCritical,
      presentInVault: inVault,
      classification,
      reason,
    };
  });
}

/** ملخّص أعداد لكل تصنيف (للتقرير/الواجهة بلا قيم). */
export function summarizeRecovery(classes: RecoveryClassification[]): Record<RecoveryClass, number> {
  const out: Record<RecoveryClass, number> = { RESTORABLE: 0, REGENERATABLE: 0, REQUIRES_OWNER_ACTION: 0, NOT_RECOVERABLE: 0 };
  for (const c of classes) out[c.classification] += 1;
  return out;
}
