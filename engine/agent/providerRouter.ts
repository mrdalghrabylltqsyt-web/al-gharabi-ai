/**
 * موجّه مزوّدي الذكاء الاصطناعي + أساس AI Council (Provider Router).
 *
 * القاعدة: العقل المركزي هو المنسّق، والمزودون الخارجيون أدوات استشارية فقط
 * ولا يملكون القرار النهائي. لا تُضاف مفاتيح وهمية ولا مزوّدو خدمة غير مضبوطين.
 *
 * المزودون المستقلّون (OpenAI/Anthropic) يُعلنون كـ«غير مضبوطين» بلا اتصال
 * شبكي، وتُضاف لاحقاً بمجرد ضبط متغير البيئة. Gemini هو المزود الأساسي الحالي
 * (محمي بالحصة والذاكرة عبر المحرك القائم).
 *
 * منطق خالص بلا شبكة: يُختبر مباشرة.
 */

export type ProviderRole = 'primary' | 'secondary' | 'advisor';

export interface ProviderDescriptor {
  id: string;
  name: string;
  role: ProviderRole;
  /** اسم متغير البيئة الحامل للمفتاح (لا قيمة). */
  envKeyName: string;
  /** هل المفتاح مضبوط في البيئة الآن؟ (بلا كشف القيمة). */
  configured: boolean;
}

/** قائمة المزوّدين المعروفين بالترتيب: أساسي → ثانوي → مستشار. */
export const PROVIDER_CATALOG: ReadonlyArray<{ id: string; name: string; role: ProviderRole; envKeyName: string }> = [
  { id: 'gemini', name: 'Google Gemini', role: 'primary', envKeyName: 'GEMINI_API_KEY' },
  { id: 'openai', name: 'OpenAI GPT', role: 'secondary', envKeyName: 'OPENAI_API_KEY' },
  { id: 'anthropic', name: 'Anthropic Claude', role: 'advisor', envKeyName: 'ANTHROPIC_API_KEY' },
];

/** يسمّي المزوّدين وحالة ضبطهم — بلا أي قيمة سرّية. */
export function describeProviders(env: Record<string, string | undefined> = process.env): ProviderDescriptor[] {
  return PROVIDER_CATALOG.map((p) => ({
    ...p,
    configured: Boolean((env[p.envKeyName] || '').trim()),
  }));
}

/** المزوّد الأساسي الفعلي المضبوط (أول مضبوط)، أو null. */
export function primaryProvider(env: Record<string, string | undefined> = process.env): ProviderDescriptor | null {
  const all = describeProviders(env);
  return all.find((p) => p.configured && p.role === 'primary') || all.find((p) => p.configured) || null;
}

/** المزوّدون الاستشاريون المضبوطون (لجلسة AI Council عند تفعيلها). */
export function availableAdvisors(env: Record<string, string | undefined> = process.env): ProviderDescriptor[] {
  return describeProviders(env).filter((p) => p.configured && p.role !== 'primary');
}

/** هل يوجد مزوّد أساسي مضبوط؟ (يعادل aiEnabled المنطقي). */
export function hasPrimaryProvider(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(primaryProvider(env));
}

/**
 * هل يجوز تفعيل دورة AI Council لهذه النية؟ القاعدة صريحة: لا تُفعَّل إلا إذا
 * فعّلها المالك صراحةً (AGENT_AI_COUNCIL=true) **و** وُجد مزوّد استشاري ثانٍ.
 * وإلا يبقى العقل المركزي المنسّق الوحيد، فلا تُضاعف استدعاءات المزود بلا سبب.
 */
export function shouldUseCouncil(env: Record<string, string | undefined> = process.env): boolean {
  const enabled = String(env.AGENT_AI_COUNCIL || '').toLowerCase() === 'true';
  return enabled && availableAdvisors(env).length > 0;
}

/** وصف الدورة متعدّد المزوّدين كما تُطبَّق عند التفعيل (بلا تنفيذ شبكي هنا). */
export const COUNCIL_PIPELINE: ReadonlyArray<string> = [
  'Primary Agent يقترح المسار',
  'Secondary Review يراجع الاقتراح',
  'Conflict Resolution عند الاختلاف',
  'Final Decision (العقل المركزي)',
  'Tool Execution (الأدوات المحكومة)',
  'Verification (نتيجة فعلية فقط)',
];
