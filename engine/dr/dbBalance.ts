/**
 * موازنة محتوى قاعدة البيانات الحية مقابل آخر نقطة استعادة — منطق صافٍ قابل للاختبار.
 *
 * المشكلة التي يحلّها: دورة الـreconciliation الحالية تقارن **الكود** فقط (بصمة شجرة
 * المصدر). فلو أدخل المالك منتجات/أسعاراً جديدة دون تغيير الكود، يبقى الفحص `no_op`
 * وتكون أحدث نقطة استعادة **أقدم من البيانات الحية** بلا أن يُكتشف ذلك.
 *
 * الحل: بصمة محتوى مستقرة لقاعدة الحالة (بلا طوابع زمنية تسبب تغيّراً دائماً)، تُقارَن
 * ببصمة النقطة المحفوظة (`manifest.databaseHash`). اختلاف ⇒ تنبيه المالك صراحةً.
 *
 * لا شبكة ولا أسرار: مدخل نصّي (dump) ومخرج بصمة + حكم.
 */

import crypto from 'node:crypto';

export interface LiveDatabaseFingerprint {
  /** بصمة محتوى مستقرة (sha256 مقتطعة) أو null عند تعذّر الحساب. */
  fingerprint: string | null;
  /** عدد الصفوف المقروءة من النسخة المنطقية. */
  rowCount: number;
  /** مجموع أطوال القيم (مؤشّر حجم، بلا أي محتوى). */
  valueBytes: number;
  /** عدد المنتجات الفعلية (مؤشّر عملي للمالك). */
  productCount: number;
  /** عدد المبيعات الفعلية. */
  saleCount: number;
  /** تعذّر الحساب؟ السبب إن وُجد (بلا محتوى). */
  error: string | null;
}

export type DbBalanceStatus = 'in_balance' | 'stale' | 'unavailable' | 'no_point';

export interface DbBalanceVerdict {
  status: DbBalanceStatus;
  changed: boolean;
  /** سبب صريح (بلا محتوى عملاء). */
  reason: string;
  message: string;
  live: LiveDatabaseFingerprint;
  pointFingerprint: string | null;
}

/**
 * بصمة مستقرة لمحتوى قاعدة الحالة.
 *
 * مهم: نتجاهل الحقول المتغيّرة بلا معنى تجاري (`updated_at`, `exportedAt`,
 * `savedAt`, طوابع وقتية داخل الصفوف) لئلا تُنتج «تغيّراً» دائماً في كل فحص.
 * نأخذ الصفوف مرتّبة بمفتاحها، ونبصم (key + قيمة منظّفة)، فنكتشف أي تغيّر حقيقي
 * (منتج/سعر/بيع/عميل) ونهمل الزمن وحده.
 */
const VOLATILE_KEYS = new Set(['updated_at', 'updatedAt', 'exportedAt', 'savedAt', 'at', 'now']);

function stableNormalize(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[depth]';
  if (Array.isArray(value)) return value.map((v) => stableNormalize(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = stableNormalize((value as Record<string, unknown>)[key], depth + 1);
    }
    return out;
  }
  return value;
}

function countArray(obj: any, path: string[]): number {
  let cur = obj;
  for (const p of path) { if (!cur || typeof cur !== 'object') return 0; cur = cur[p]; }
  return Array.isArray(cur) ? cur.length : 0;
}

/** يحسب بصمة المحتوى من نسخة منطقية نصّية (نفس مخرج `storageAdapter.dump()`). */
export function computeLiveDatabaseFingerprint(dumpText: string | null | undefined): LiveDatabaseFingerprint {
  if (dumpText == null || String(dumpText).trim() === '') {
    return { fingerprint: null, rowCount: 0, valueBytes: 0, productCount: 0, saleCount: 0, error: 'empty_dump' };
  }
  let parsed: any;
  try { parsed = JSON.parse(dumpText); } catch { return { fingerprint: null, rowCount: 0, valueBytes: 0, productCount: 0, saleCount: 0, error: 'unparseable_dump' }; }

  // نسخة Postgres: { rows: [{key, value, updated_at}, ...] }
  // نسخة الملف:   { keys: { state: {...}, usage: {...}, control: {...} } }
  const rows: { key: string; value: unknown }[] = [];
  if (Array.isArray(parsed?.rows)) {
    for (const r of parsed.rows) rows.push({ key: String(r?.key ?? ''), value: r?.value ?? null });
  } else if (parsed?.keys && typeof parsed.keys === 'object') {
    for (const key of Object.keys(parsed.keys)) rows.push({ key, value: parsed.keys[key] });
  } else {
    return { fingerprint: null, rowCount: 0, valueBytes: 0, productCount: 0, saleCount: 0, error: 'unknown_dump_shape' };
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));

  const normalized = stableNormalize(rows);
  const canonical = JSON.stringify(normalized);
  const fingerprint = crypto.createHash('sha256').update(canonical).digest('hex');

  // مؤشّرات عملية (بلا محتوى): المنتجات والمبيعات من صف `state` إن وُجد.
  const stateRow = rows.find((r) => r.key === 'state')?.value as any;
  const workspace = stateRow?.workspace;
  const productCount = Array.isArray(workspace?.products) ? workspace.products.length : 0;
  const saleCount = Array.isArray(workspace?.sales) ? workspace.sales.length : 0;

  return { fingerprint, rowCount: rows.length, valueBytes: canonical.length, productCount, saleCount, error: null };
}

/**
 * يقارن بصمة القاعدة الحية ببصمة آخر نقطة استعادة ويصدر حكماً صريحاً:
 *  - no_point: لا نقطة مرجعية بعد (لا ادّعاء تعارض).
 *  - unavailable: تعذّر حساب البصمة الحية (لا ادّعاء تطابق).
 *  - in_balance: البصمتان متطابقتان.
 *  - stale: البصمة الحية مختلفة ⇒ أحدث نقطة أقدم من البيانات الحالية (تنبيه).
 */
export function evaluateDatabaseBalance(live: LiveDatabaseFingerprint, pointFingerprint: string | null | undefined): DbBalanceVerdict {
  const ref = pointFingerprint ?? null;
  if (!ref) {
    return {
      status: 'no_point', changed: false, reason: 'no_reference_point',
      message: 'لا نقطة استعادة مرجعية بعد: لا يمكن الحكم على توازن البيانات.',
      live, pointFingerprint: null,
    };
  }
  if (!live.fingerprint) {
    return {
      status: 'unavailable', changed: false, reason: live.error || 'fingerprint_unavailable',
      message: 'تعذّر حساب بصمة قاعدة البيانات الحية: لا حكم على التوازن.',
      live, pointFingerprint: ref,
    };
  }
  if (live.fingerprint === ref) {
    return {
      status: 'in_balance', changed: false, reason: 'database_in_sync',
      message: 'قاعدة البيانات الحية مطابقة لآخر نقطة استعادة.',
      live, pointFingerprint: ref,
    };
  }
  return {
    status: 'stale', changed: true, reason: 'database_changed_since_last_backup',
    message: `قاعدة البيانات تغيّرت منذ آخر نقطة استعادة (المنتجات: ${live.productCount}، المبيعات: ${live.saleCount}). أحدث نسخة أقدم من بياناتك — يُنصح بإنشاء نسخة الآن.`,
    live, pointFingerprint: ref,
  };
}
