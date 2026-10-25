/**
 * ميزانية زمنية كلية لنداء AI — انحدار لفشل «اقترح خطة محتوى» (TIMEOUT 40s ×2).
 *
 * الجذر: المحرك يتناوب على 5+ موديلات بمهلة 20 ثانية لكلٍّ منها، بينما خطوة الوكيل
 * مهلتها 20 ثانية؛ عند بطء Gemini تنتهي الخطوة قبل أن يعود البديل الحتمي ⇒ فشل المهمة.
 * الآن: `deadlineMs` يحدّ التناوب كله، ومهلة كل موديل ≤ المتبقي، فيعود البديل الآمن
 * داخل الميزانية. بلا deadline يبقى السلوك كما كان.
 */
import { AiEngine, type AiProvider, type AiUsageGuard } from '../ai/engine';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function guard(): AiUsageGuard {
  let used = 0;
  return {
    canConsume: () => used < 100,
    consume: () => (used < 100 ? (used += 1, true) : false),
    release: () => { used = Math.max(0, used - 1); },
    status: () => ({ usedToday: used, limit: 100, remaining: 100 - used, enabled: true }),
  };
}

/** مزود بطيء: لا يرد إلا عند الإلغاء (يحاكي ضغط Gemini). */
function hangingProvider(calls: string[]): AiProvider {
  return {
    name: 'gemini',
    generate: ({ model, signal }: any) => new Promise<string>((_, reject) => {
      calls.push(model);
      signal?.addEventListener?.('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  } as any;
}

async function main(): Promise<void> {
  const models = ['m1', 'm2', 'm3', 'm4', 'm5'];
  {
    const calls: string[] = [];
    const engine = new AiEngine({ provider: hangingProvider(calls), guard: guard(), models, timeoutMs: 20_000, sleep: async () => {} });
    const t0 = Date.now();
    const res = await engine.run({ cacheKey: 'k1', prompt: 'p', deadlineMs: 2_600, deterministicFallback: () => 'FALLBACK' });
    const ms = Date.now() - t0;
    check('★ مزود بطيء + ميزانية 2.6s ⇒ البديل الحتمي يعود', res.text === 'FALLBACK' && res.usedProvider === false, JSON.stringify(res));
    check('★ يعود داخل الميزانية (لا 5×20s)', ms < 4_500, `ms=${ms}`);
    check('لا يبدأ موديلاً بلا وقت كافٍ (موديل واحد فقط جُرّب)', calls.length === 1, JSON.stringify(calls));
  }
  {
    const engine = new AiEngine({
      provider: { name: 'gemini', generate: async ({ model }: any) => (model === 'm1' ? Promise.reject(Object.assign(new Error('503 high demand'), { status: 503 })) : 'نص حقيقي') } as any,
      guard: guard(), models, timeoutMs: 20_000, sleep: async () => {},
    });
    const res = await engine.run({ cacheKey: 'k2', prompt: 'p', deadlineMs: 16_000, deterministicFallback: () => 'FALLBACK' });
    check('★ المزود السريع ينجح ضمن الميزانية (التناوب يعمل)', res.text === 'نص حقيقي' && res.usedProvider === true, JSON.stringify(res));
  }
  {
    const engine = new AiEngine({ provider: { name: 'gemini', generate: async () => 'بلا ميزانية' } as any, guard: guard(), models, timeoutMs: 20_000, sleep: async () => {} });
    const res = await engine.run({ cacheKey: 'k3', prompt: 'p', deterministicFallback: () => 'FALLBACK' });
    check('التوافق: بلا deadline السلوك كما كان', res.text === 'بلا ميزانية');
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} — passed ${passed}`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} ai-deadline checks`);
}

void main();
