/**
 * جدار حماية حصة Gemini المجاني — طبقة مركزية واحدة للمشروع كله.
 *
 * المبدأ: حصة Gemini مورد **مشروع** واحد، لا مورد منصة. لا يوجد في هذا الملف
 * أي تفريع على اسم منصة (`youtube`/`tiktok`/...) ولا أي منطق خاص بمنصة: كل
 * منصة (حالية أو مستقبلية) تمرّ عبر المحرك المركزي نفسه، واسم المنصة مجرّد
 * بيانات تشخيصية لا تُغيّر أي سلوك حماية.
 *
 * هذا الملف منطق صافٍ قابل للاختبار: لا شبكة، ولا أسرار، ولا ساعة حقيقية
 * إلا عبر حقن `now`.
 */

/** حدود الطلب الواقية من المدخلات الضخمة (حماية حصة لا ميزة ذكاء). */
export const DEFAULT_MAX_PROMPT_CHARS = 24_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 2_048;
/** سقف سياق اجتماعي خام يُمرَّر للمزود (يُلخَّص حتمياً قبل ذلك). */
export const DEFAULT_MAX_CONTEXT_CHARS = 12_000;

/** المنصات المعروفة للتشخيص فقط. أي اسم آخر يُقبل ويُحسب ضمن نفس الميزانية. */
export const KNOWN_AI_PLATFORMS = [
  'tiktok', 'youtube', 'facebook', 'instagram', 'whatsapp', 'telegram',
  'x', 'snapchat', 'threads', 'google_business', 'general',
] as const;

export type KnownAiPlatform = (typeof KNOWN_AI_PLATFORMS)[number];

/**
 * وصف الطلب لأغراض التشخيص فقط. **لا يغيّر أي قرار حماية**: المنصة غير
 * المعروفة (`future_platform`) تخضع لنفس الحارس ونفس الميزانية تماماً.
 */
export interface AiCallMeta {
  platform?: string;
  operation?: string;
}

/** يطبّع اسم المنصة للتشخيص: معروف أو `unknown`. لا يُستبعد أي طلب. */
export function normalizePlatformLabel(platform: unknown): string {
  const s = typeof platform === 'string' ? platform.trim().toLowerCase() : '';
  if (!s) return 'general';
  return (KNOWN_AI_PLATFORMS as readonly string[]).includes(s) ? s : 'unknown';
}

/** عدّادات التشخيص. `providerCalls` وحدها تستهلك الميزانية اليومية. */
export interface AiLedgerCounters {
  providerCalls: number;
  cacheHits: number;
  inflightJoins: number;
  guardBlocked: number;
  deterministic: number;
  fallback: number;
  providerErrors: number;
}

export interface AiLastProvider {
  at: string;
  model: string | null;
  platform: string;
  operation: string;
}

/**
 * سجل استخدام مركزي بلا أسرار: يحفظ أعداداً فقط + آخر نداء مزود (وصف لا نص).
 * لا يُخزَّن أي prompt ولا أي استجابة ولا أي مفتاح.
 */
export class AiUsageLedger {
  private counters: AiLedgerCounters = {
    providerCalls: 0, cacheHits: 0, inflightJoins: 0,
    guardBlocked: 0, deterministic: 0, fallback: 0, providerErrors: 0,
  };
  private last: AiLastProvider | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  recordProviderCall(meta: AiCallMeta, model: string | null): void {
    this.counters.providerCalls += 1;
    this.last = {
      at: new Date(this.now()).toISOString(),
      model,
      platform: normalizePlatformLabel(meta.platform),
      operation: typeof meta.operation === 'string' && meta.operation.trim() ? meta.operation.trim() : 'unspecified',
    };
  }
  recordCacheHit(): void { this.counters.cacheHits += 1; }
  recordInflightJoin(): void { this.counters.inflightJoins += 1; }
  recordGuardBlocked(): void { this.counters.guardBlocked += 1; }
  recordDeterministic(): void { this.counters.deterministic += 1; }
  recordFallback(): void { this.counters.fallback += 1; }
  recordProviderError(): void { this.counters.providerErrors += 1; }

  snapshot(): AiLedgerCounters { return { ...this.counters }; }
  lastProvider(): AiLastProvider | null { return this.last ? { ...this.last } : null; }

  /** تصفير عدّادات التشخيص اليومية (عند تغيّر اليوم فقط). */
  resetDaily(): void {
    this.counters = { providerCalls: 0, cacheHits: 0, inflightJoins: 0, guardBlocked: 0, deterministic: 0, fallback: 0, providerErrors: 0 };
    this.last = null;
  }
}

/**
 * تطبيق حد حجم الـprompt قبل أي نداء مزود. يُقصّ حتمياً (لا يُرسل طلب ضخم)
 * ويُعلن القصّ صراحةً. لا يعتمد على المنصة.
 */
export function enforcePromptLimit(prompt: string, maxChars = DEFAULT_MAX_PROMPT_CHARS): { prompt: string; truncated: boolean; originalChars: number } {
  const text = typeof prompt === 'string' ? prompt : '';
  if (text.length <= maxChars) return { prompt: text, truncated: false, originalChars: text.length };
  const marker = '\n\n[تم قصّ السياق الزائد حتمياً لحماية حصة الذكاء الاصطناعي]';
  return { prompt: text.slice(0, Math.max(0, maxChars - marker.length)) + marker, truncated: true, originalChars: text.length };
}

/**
 * يبني عدّادات تشخيصية مقروءة من العدّادات الخام + حالة الحارس، بلا أي سرّ.
 * تُستخدم في `/api/health` و`/api/ai/status` (للمالك) وفي الفحوص.
 */
export function buildUsageDiagnostics(input: {
  counters: AiLedgerCounters;
  last: AiLastProvider | null;
  usedToday: number;
  limit: number;
  protectionEnabled: boolean;
  providerConfigured: boolean;
  providerVerified: boolean;
}) {
  return {
    protectionEnabled: input.protectionEnabled,
    usedToday: input.usedToday,
    localDailyLimit: input.limit,
    remainingToday: Math.max(0, input.limit - input.usedToday),
    providerConfigured: input.providerConfigured,
    providerVerified: input.providerVerified,
    providerCallsToday: input.counters.providerCalls,
    cacheHitsToday: input.counters.cacheHits,
    inflightJoinsToday: input.counters.inflightJoins,
    blockedByLocalGuardToday: input.counters.guardBlocked,
    providerErrorsToday: input.counters.providerErrors,
    deterministicToday: input.counters.deterministic,
    fallbackToday: input.counters.fallback,
    lastProviderAt: input.last?.at ?? null,
    lastProviderModel: input.last?.model ?? null,
    lastProviderPlatform: input.last?.platform ?? null,
    lastProviderOperation: input.last?.operation ?? null,
    limitLabelAr: 'حد الحماية المحلي للمشروع',
    note: 'هذه أرقام حماية محلية داخل المشروع وليست حصة Google. حصة المزود الفعلية تعتمد على الحساب والموديل.',
  };
}
