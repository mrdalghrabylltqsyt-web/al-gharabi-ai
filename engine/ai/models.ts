/**
 * سياسة اختيار موديل Gemini — المصدر الوحيد لمعرّفات النماذج في المشروع.
 *
 * لا يجوز ظهور أي معرّف موديل في أي ملف آخر. كل مكان يحتاج قائمة مرشحين
 * يستدعي `resolveModelCandidates` من هنا.
 *
 * تم التحقق من صحة المعرّفات مقابل المصادر الرسمية لـ Google (صفحة النماذج
 * وصفحة الإيقاف) بتاريخ 2026-09-18، وليس استنتاجاً من الاسم:
 * - gemini-3.8-flash: GA منذ 2026-09-02، لا تاريخ إيقاف معلن.
 * - gemini-3.7-flash: GA منذ 2026-08، لا تاريخ إيقاف معلن.
 * - gemini-3.6-flash: GA منذ 2026-07-21، لا تاريخ إيقاف معلن.
 * - gemini-3.5-flash: GA منذ 2026-05-19، لا تاريخ إيقاف معلن.
 * - gemini-2.0-flash{,,-001,-lite,-lite-001}: أُوقفت فعلياً في 2026-06-01.
 * - gemini-2.5-flash: ما زال يعمل لكن مجدول للإيقاف في 2026-10-16.
 */

/** موديل الإنتاج المعتمد — أحدث نموذج GA حقيقي وقت التحقق. */
export const PRODUCTION_MODEL = 'gemini-3.8-flash';

/**
 * مرشحون بترتيب الأفضلية: كلهم GA وحُقّق من معرّفاتهم رسمياً.
 * الترتيب مقصود: الأحدث أولاً، ومن نفس العائلة لتجنّب فروق السلوك.
 */
export const DEFAULT_MODEL_CANDIDATES: readonly string[] = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
] as const;

/**
 * معرّفات أُوقفت فعلياً من المزود: أي طلب بها يفشل حتماً.
 * تُرفض صراحةً حتى لو وردت في GEMINI_MODEL، لأن تمريرها يعني طلباً فاشلاً
 * يُعرَض على المستخدم كأنه «ضغط مرتفع» — وهذا جوهر عطل 503 السابق.
 */
export const SHUTDOWN_MODELS: readonly string[] = [
  // أُوقفت 2026-06-01
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-lite-001',
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.0-flash-lite-preview',
  'gemini-2.0-flash-lite-preview-02-05',
  'gemini-2.0-pro-exp',
  'gemini-2.0-pro-exp-02-05',
  // أُوقفت 2026-02-17 / 2026-01-14 / 2026-03-09
  'gemini-2.5-flash-preview-09-25',
  'gemini-2.5-flash-preview-09-2025',
  'gemini-2.5-flash-lite-preview-09-2025',
  'gemini-2.5-flash-image-preview',
  'gemini-2.5-flash-preview-native-audio-dialog',
  'gemini-2.5-flash-exp-native-audio-thinking-dialog',
  'gemini-3-pro-preview',
  'gemini-3.1-flash-lite-preview',
  'text-embedding-004',
  // الجيل الأول
  'gemini-1.5-flash',
  'gemini-1.5-flash-001',
  'gemini-1.5-flash-002',
  'gemini-1.5-pro',
  'gemini-1.5-pro-001',
  'gemini-1.5-pro-002',
  'gemini-1.0-pro',
] as const;

/** موديلات تعمل حالياً لكن لها تاريخ إيقاف معلن — مسموحة مع تحذير. */
export const SCHEDULED_SHUTDOWN_MODELS: Readonly<Record<string, string>> = {
  'gemini-2.5-flash': '2026-10-16',
  'gemini-2.5-pro': '2026-10-16',
  'gemini-2.5-flash-lite': '2026-10-16',
  'gemini-3.1-flash-lite': '2027-05-07',
};

const MODEL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,80}$/i;

export function isValidModelName(name: string): boolean {
  return MODEL_NAME_PATTERN.test((name || '').trim());
}

/** هل هذا المعرّف مُوقف فعلياً من المزود؟ */
export function isShutdownModel(name: string): boolean {
  return SHUTDOWN_MODELS.includes((name || '').trim().toLowerCase());
}

/** تاريخ الإيقاف المعلن إن وُجد، أو null. */
export function scheduledShutdownDate(name: string): string | null {
  return SCHEDULED_SHUTDOWN_MODELS[(name || '').trim().toLowerCase()] ?? null;
}

export interface ModelResolution {
  /** القائمة النهائية المرسلة للمزود بالترتيب. */
  candidates: string[];
  /** الموديل المطلوب من البيئة إن كان صالحاً. */
  configuredModel: string | null;
  /** سبب تجاهل موديل البيئة إن تُجوهل. */
  rejectedReason: string | null;
  /** تحذيرات غير مانعة (مثل تاريخ إيقاف قريب أو نموذج معاينة). */
  warnings: string[];
}

/**
 * يبني قائمة المرشحين النهائية.
 *
 * القواعد:
 * - موديل البيئة يتقدم إن كان صالحاً شكلياً وغير مُوقف.
 * - موديل البيئة المُوقف يُرفض ولا يُمرَّر للمزود أبداً (يمنع تكرار عطل 503).
 * - المرشحات الافتراضية تُضاف بدون تكرار لتضمن نجاح الطلب دائماً.
 */
export function resolveModelPolicy(envModel?: string): ModelResolution {
  const warnings: string[] = [];
  let configuredModel: string | null = null;
  let rejectedReason: string | null = null;

  const configured = (envModel || '').trim();
  if (configured) {
    if (!isValidModelName(configured)) {
      rejectedReason = 'اسم الموديل في GEMINI_MODEL غير صالح شكلياً؛ تم تجاهله.';
    } else if (isShutdownModel(configured)) {
      rejectedReason = 'الموديل المحدد في GEMINI_MODEL أُوقف فعلياً من المزود؛ تم تجاهله لتجنّب طلب فاشل.';
    } else {
      configuredModel = configured;
      const shutdown = scheduledShutdownDate(configured);
      if (shutdown) warnings.push(`الموديل ${configured} مجدول للإيقاف في ${shutdown}؛ يُفضّل نموذج أحدث.`);
      if (configured.includes('-preview') || configured.includes('-exp')) {
        warnings.push(`الموديل ${configured} تجريبي/معاينة؛ يُفضّل نموذج GA للإنتاج.`);
      }
    }
  }

  const candidates: string[] = [];
  if (configuredModel) candidates.push(configuredModel);
  for (const model of DEFAULT_MODEL_CANDIDATES) if (!candidates.includes(model)) candidates.push(model);

  return { candidates, configuredModel, rejectedReason, warnings };
}

/** واجهة مختصرة متوافقة مع الاستخدامات الحالية. */
export function resolveModelCandidates(envModel?: string): string[] {
  return resolveModelPolicy(envModel).candidates;
}

/** ملخص آمن للعرض في /api/health — بلا أي أسرار. */
export function describeModelPolicy(envModel?: string) {
  const policy = resolveModelPolicy(envModel);
  return {
    productionModel: PRODUCTION_MODEL,
    candidates: policy.candidates,
    configuredModel: policy.configuredModel,
    rejectedReason: policy.rejectedReason,
    warnings: policy.warnings,
    shutdownModelCount: SHUTDOWN_MODELS.length,
  };
}
