/**
 * اختيار موديل الذكاء الاصطناعي.
 *
 * سبب عطل 503 المرصود في النسخة السابقة: الكود كان يطلب موديلات غير موجودة
 * ("gemini-3.8-flash" على الخادم و"gemini-3.6-flash" في المتصفح). أي طلب بهذا
 * الاسم يُرفض من المزود، وكان الرفض يُعرض للمستخدم كأنه "ضغط مرتفع / 503".
 * لذلك لا يُعتمد أي اسم موديل إلا بعد أن ينجح فعلياً مع المزود.
 */

/** موديلات مرشحة بترتيب الأفضلية — أسماء إنتاجية حقيقية من Google Gen AI. */
export const DEFAULT_MODEL_CANDIDATES = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
] as const;

const MODEL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,80}$/i;

/**
 * يبني قائمة المرشحين: موديل البيئة أولاً إن كان صالحاً شكلياً، ثم المرشحات
 * الافتراضية بدون تكرار. موديل البيئة غير الصالح يُتجاهل بدل تمريره للمزود.
 */
export function resolveModelCandidates(envModel?: string): string[] {
  const candidates: string[] = [];
  const configured = (envModel || '').trim();
  if (configured && MODEL_NAME_PATTERN.test(configured)) candidates.push(configured);
  for (const model of DEFAULT_MODEL_CANDIDATES) if (!candidates.includes(model)) candidates.push(model);
  return candidates;
}

/** هل اسم الموديل صالح شكلياً؟ (يمنع تمرير نص فارغ أو اسم فيه محارف غريبة) */
export function isValidModelName(name: string): boolean {
  return MODEL_NAME_PATTERN.test((name || '').trim());
}
