/**
 * PR-B — قواعد جودة الرد (مصدر واحد صافٍ، بلا شبكة ولا سرّ).
 *
 * الغرض:
 *  1) **حظر الصيغ التي تفترض جنس العميل** («هلا بيك»/«مرحبا بيك») — ترحيب محايد فقط.
 *  2) **ربط منشور بمنتج مسجّل** بتحقق فعلي من وجود المنتج (لا ربط بالتخمين).
 *
 * المنطق صافٍ قابل للاختبار، ويُستدعى من الخادم (`server.ts`) ليتطابق السلوك في
 * الواجهة والخادم بلا ازدواج.
 */

/**
 * الصيغ المحرَّمة: كلها تفترض أن العميل رجل (ضمير مخاطب مذكّر). الترحيب المسموح
 * محايد: هلا وغلا، حياك الله، أهلاً وسهلاً، نورتنا، تدلل.
 */
export const FORBIDDEN_GENDERED_OPENERS: readonly string[] = Object.freeze(['هلا بيك', 'مرحبا بيك']);

/** هل يحمل النص صيغة ترحيب تفترض جنس العميل؟ */
export function hasGenderedOpener(text: string): boolean {
  const s = String(text || '');
  return FORBIDDEN_GENDERED_OPENERS.some((b) => s.includes(b));
}

/**
 * يتحقق من ربط منشور بمنتج: يُقبل المعرّف فقط إن كان المنتج موجوداً فعلاً في قاعدة
 * المعرض. معرّف فارغ أو غير مسجّل ⇒ `undefined` (فكّ الربط بلا اختراع ربط).
 */
export function resolveProductLink(productId: unknown, products: ReadonlyArray<{ id?: unknown }> | null | undefined): string | undefined {
  const pid = typeof productId === 'string' ? productId.trim() : '';
  if (!pid) return undefined;
  const exists = Array.isArray(products) && products.some((p) => String(p?.id) === pid);
  return exists ? pid : undefined;
}
