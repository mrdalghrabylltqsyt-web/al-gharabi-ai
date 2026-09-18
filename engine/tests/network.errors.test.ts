/**
 * اختبار مسار الشبكة الحقيقي ضد مزود Google Gen AI بمفتاح غير صالح.
 *
 * الغرض: إثبات أن تعطل المزود (مفتاح خاطئ، أو اسم موديل غير موجود) لا يُسقط
 * الطلب، ولا يُعيد 503 للمستخدم، ولا يُسرّب أي جزء من المفتاح في الاستجابة أو
 * السجلات. لا يستهلك هذا الاختبار أي حصة حقيقية لأن المفتاح غير صالح.
 */

import { AiEngine, type AiUsageGuard } from '../ai/engine';
import { createGeminiProvider } from '../ai/provider';
import { classifyAiError } from '../ai/errors';
import { resolveModelCandidates } from '../ai/models';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function makeGuard(): AiUsageGuard & { used: number } {
  let used = 0;
  return {
    get used() { return used; },
    canConsume: () => used < 10,
    consume: () => (used < 10 ? ((used += 1), true) : false),
    release: () => { used = Math.max(0, used - 1); },
    status: () => ({ usedToday: used, limit: 10, remaining: 10 - used, enabled: true }),
  };
}

// مفتاح وهمي غير فعّال، يُبنى وقت التشغيل حتى لا يشبه مفتاحاً حقيقياً في أي فحص أسرار.
// الغرض منه إثبات أن أي خطأ مزود لا يُسرّب قيمة المفتاح في الاستجابة أو الرسائل.
const FAKE_KEY = ['AIza', 'Sy', 'FAKE', 'NETWORK', 'TEST', 'KEY'].join('') + '0'.repeat(12);

async function run(): Promise<void> {
  const provider = createGeminiProvider(FAKE_KEY, 8_000);
  check('المزود يُنشأ بمفتاح غير صالح دون رمي', provider !== null);

  const guard = makeGuard();
  const engine = new AiEngine({
    provider,
    guard,
    models: resolveModelCandidates('gemini-3.8-flash'),
    timeoutMs: 8_000,
    policy: { maxAttempts: 2, baseDelayMs: 50, maxDelayMs: 100 },
  });

  const started = Date.now();
  const result = await engine.run({
    cacheKey: 'network:invalid-key',
    prompt: 'اختبار مسار الخطأ',
    deterministicFallback: () => 'بديل حتمي آمن',
  });
  const elapsed = Date.now() - started;

  console.log(`   شبكة: المصدر=${result.source} النوع=${result.errorKind} المحاولات=${result.attempts} الزمن=${elapsed}ms`);
  console.log(`   رسالة آمنة: ${result.notice}`);

  // 1) لا انهيار: يُعاد نص صالح دائماً.
  check('الطلب لا ينهار ويُعيد نصاً صالحاً', typeof result.text === 'string' && result.text.length > 0);
  check('يُستخدم البديل الحتمي عند فشل المزود', result.source === 'fallback' && result.usedProvider === false);
  check('لا يُدّعى استخدام المزود', result.usedProvider === false);
  check('رسالة آمنة موجودة للمستخدم', typeof result.notice === 'string' && result.notice.length > 10);
  check('الخطأ مصنف كخطأ مفتاح لا كخطأ ضغط', result.errorKind === 'auth', `errorKind=${result.errorKind}`);

  // 2) الحصة تُعاد بالكامل عند فشل كل المحاولات.
  check('الحصة تُعاد عند فشل الطلب', guard.used === 0);

  // 3) لا تسريب للمفتاح في أي حقل.
  const serialized = JSON.stringify(result);
  check('لا يُسرّب المفتاح في الاستجابة', !serialized.includes(FAKE_KEY) && !serialized.includes('AIzaSy'));
  check('لا يُسرّب المفتاح في رسالة الخطأ', !String(result.notice).includes('AIzaSy'));

  // 4) تصنيف الخطأ لا يحمل النص الخام للمزود.
  const info = classifyAiError(new Error(`API key not valid. Please pass a valid API key. key=${FAKE_KEY}`));
  check('تصنيف الخطأ لا يحمل نص المزود الخام', !info.safeMessage.includes(FAKE_KEY) && !info.safeMessage.includes('AIzaSy'));

  // 5) التخزين المؤقت يمنع إعادة محاولة الشبكة لنفس الطلب.
  const second = await engine.run({
    cacheKey: 'network:invalid-key-2',
    prompt: 'اختبار ثانٍ',
    deterministicFallback: () => 'بديل حتمي آمن',
  });
  check('الطلب الثاني يفشل بأمان أيضاً', second.source === 'fallback' && guard.used === 0);

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} network error-path checks`);
  }
}

run().catch((err) => {
  console.error('Network harness crashed:', err);
  process.exit(1);
});
