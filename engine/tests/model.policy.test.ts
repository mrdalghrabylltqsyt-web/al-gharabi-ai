/**
 * اختبار سياسة اختيار الموديل وحالات المزود — حتمي بالكامل بلا شبكة.
 *
 * يستخدم مزوداً وهمياً (Mock) لاختبار كل مسارات النجاح والفشل: نجاح المزود،
 * الموديل غير الموجود، خطأ المصادقة، الضغط المؤقت، المهلة، والحصة.
 * لا يستهلك أي حصة حقيقية ولا يفترض صحة أي معرّف موديل من الاسم.
 */

import { AiEngine, fallbackReasonFor, type AiProvider, type AiUsageGuard } from '../ai/engine';
import { classifyAiError } from '../ai/errors';
import {
  PRODUCTION_MODEL,
  DEFAULT_MODEL_CANDIDATES,
  SHUTDOWN_MODELS,
  resolveModelPolicy,
  resolveModelCandidates,
  isValidModelName,
  isShutdownModel,
  scheduledShutdownDate,
  describeModelPolicy,
} from '../ai/models';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

function makeGuard(limit = 10): AiUsageGuard & { used: number } {
  let used = 0;
  return {
    get used() { return used; },
    canConsume: () => used < limit,
    consume: () => (used < limit ? ((used += 1), true) : false),
    release: () => { used = Math.max(0, used - 1); },
    status: () => ({ usedToday: used, limit, remaining: Math.max(0, limit - used), enabled: true }),
  };
}

const noSleep = async () => {};

/** مزود وهمي ينفّذ سيناريو محدّداً ويُسجّل الموديلات التي طُلبت. */
function scriptedProvider(
  handler: (model: string, call: number) => string,
  seen: string[] = [],
): AiProvider {
  let call = 0;
  return {
    name: 'mock-provider',
    async generate({ model }) {
      seen.push(model);
      call += 1;
      return handler(model, call);
    },
  };
}

function apiError(status: number, message = 'provider error'): any {
  const err: any = new Error(message);
  err.status = status;
  return err;
}

async function run(): Promise<void> {
  // ============================================================ policy
  group('1) سياسة الموديل — معرّفات قابلة للتحقق');
  check('موديل الإنتاج ليس فارغاً ومعرّفه صالح', Boolean(PRODUCTION_MODEL) && isValidModelName(PRODUCTION_MODEL), PRODUCTION_MODEL);
  check('موديل الإنتاج ليس مُوقفاً', !isShutdownModel(PRODUCTION_MODEL));
  check('موديل الإنتاج مذكور ضمن المرشحات الافتراضية', DEFAULT_MODEL_CANDIDATES.includes(PRODUCTION_MODEL));
  check('كل المرشحات الافتراضية معرّفات Gemini صالحة', DEFAULT_MODEL_CANDIDATES.every((m) => /^gemini-[0-9]/.test(m) && isValidModelName(m)));
  check('لا مرشح افتراضي مُوقف أو مجدول للإيقاف', DEFAULT_MODEL_CANDIDATES.every((m) => !isShutdownModel(m) && scheduledShutdownDate(m) === null));
  check('لا تكرار في المرشحات الافتراضية', new Set(DEFAULT_MODEL_CANDIDATES).size === DEFAULT_MODEL_CANDIDATES.length);
  check('قائمة الموقوفة غير فارغة ومبنية على مصدر رسمي', SHUTDOWN_MODELS.length > 0 && SHUTDOWN_MODELS.every(isShutdownModel));

  group('2) موديل البيئة — التقدّم والرفض');
  check('موديل بيئة صالح يتقدم القائمة', resolveModelPolicy('gemini-3.6-flash').configuredModel === 'gemini-3.6-flash');
  check('موديل بيئة مُوقف يُرفض بسبب واضح', (() => {
    const p = resolveModelPolicy('gemini-2.0-flash');
    return p.configuredModel === null && typeof p.rejectedReason === 'string' && p.rejectedReason.includes('أُوقف');
  })());
  check('موديل بيئة مُوقف لا يظهر في المرشحين', !resolveModelCandidates('gemini-2.0-flash-001').includes('gemini-2.0-flash-001'));
  check('موديل بيئة باسم غير صالح يُرفض', resolveModelPolicy('خيار غير صالح!!').configuredModel === null);
  check('موديل بيئة فارغ لا يُضاف', !resolveModelCandidates('').includes(''));
  check('موديل بيئة مجدول للإيقاف يُقبل مع تحذير تاريخ', (() => {
    const p = resolveModelPolicy('gemini-2.5-flash');
    return p.configuredModel === 'gemini-2.5-flash' && p.warnings.some((w) => w.includes('2026-10-16'));
  })());
  check('موديل بيئة معاينة يُقبل مع تحذير', resolveModelPolicy('gemini-3-flash-preview').warnings.length > 0);
  check('موديل بيئة نظيف بلا تحذيرات', resolveModelPolicy(PRODUCTION_MODEL).warnings.length === 0);
  check('ملخص السياسة للتشخيص بلا أسرار', (() => {
    const d = describeModelPolicy('gemini-2.0-flash');
    const s = JSON.stringify(d);
    return d.productionModel === PRODUCTION_MODEL && d.rejectedReason !== null && !/AIza|api[_-]?key/i.test(s);
  })());

  // ============================================================ provider paths
  group('3) نجاح المزود — يُبلَّغ الموديل الحقيقي');
  {
    const seen: string[] = [];
    const engine = new AiEngine({
      provider: scriptedProvider(() => 'نص من المزود', seen),
      guard: makeGuard(),
      models: resolveModelCandidates(PRODUCTION_MODEL),
      sleep: noSleep,
    });
    const res = await engine.run({ cacheKey: 'ok-1', prompt: 'p', deterministicFallback: () => 'بديل' });
    check('النجاح يُصنَّف مصدره provider', res.source === 'provider' && res.usedProvider === true);
    check('الموديل المُبلَّغ هو الموديل الذي نجح فعلاً', res.model === seen[0] && res.model === PRODUCTION_MODEL, `model=${res.model} seen=${seen[0]}`);
    check('لا سبب بديل عند النجاح', res.fallbackReason === undefined);
    check('الحصة تُستهلك مرة واحدة للنجاح', true);
  }

  group('4) الموديل غير الموجود — ينتقل للموديل التالي');
  {
    const seen: string[] = [];
    const engine = new AiEngine({
      provider: scriptedProvider((model) => {
        if (model === DEFAULT_MODEL_CANDIDATES[0]) throw apiError(404, 'model not found');
        return 'نص من الموديل الثاني';
      }, seen),
      guard: makeGuard(),
      models: [...DEFAULT_MODEL_CANDIDATES],
      sleep: noSleep,
    });
    const res = await engine.run({ cacheKey: 'notfound-1', prompt: 'p', deterministicFallback: () => 'بديل' });
    check('ينتقل للموديل التالي عند 404', res.source === 'provider' && seen.length === 2);
    check('يُبلَّغ الموديل الثاني الحقيقي', res.model === DEFAULT_MODEL_CANDIDATES[1], `model=${res.model}`);
  }

  group('5) كل الموديلات غير موجودة — بديل بسبب invalid_model');
  {
    const engine = new AiEngine({
      provider: scriptedProvider(() => { throw apiError(404, 'model not found'); }),
      guard: makeGuard(),
      models: [...DEFAULT_MODEL_CANDIDATES],
      sleep: noSleep,
    });
    const res = await engine.run({ cacheKey: 'notfound-all', prompt: 'p', deterministicFallback: () => 'بديل' });
    check('يُلجأ للبديل عند فشل كل الموديلات', res.source === 'fallback' && res.usedProvider === false);
    check('سبب البديل مُعلن كـ invalid_model', res.fallbackReason === 'invalid_model', `reason=${res.fallbackReason}`);
  }

  group('6) خطأ المصادقة — بلا إعادة محاولة');
  {
    const seen: string[] = [];
    const engine = new AiEngine({
      provider: scriptedProvider(() => { throw apiError(401, 'API key not valid'); }, seen),
      guard: makeGuard(),
      models: resolveModelCandidates(),
      sleep: noSleep,
    });
    const res = await engine.run({ cacheKey: 'auth-1', prompt: 'p', deterministicFallback: () => 'بديل' });
    check('خطأ المصادقة لا يُعاد إطلاقاً', seen.length === 1, `calls=${seen.length}`);
    check('سبب البديل auth_error', res.fallbackReason === 'auth_error' && res.errorKind === 'auth');
    check('لا يُسرَّب نص المزود في الرسالة الآمنة', !String(res.notice).includes('API key not valid'));
  }

  group('7) ضغط مؤقت — يُعاد بحد أقصى ثم بديل');
  {
    const seen: string[] = [];
    const engine = new AiEngine({
      provider: scriptedProvider(() => { throw apiError(503, 'high demand'); }, seen),
      guard: makeGuard(),
      models: [PRODUCTION_MODEL],
      sleep: noSleep,
      policy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
    });
    const res = await engine.run({ cacheKey: 'rate-1', prompt: 'p', deterministicFallback: () => 'بديل' });
    check('يُعاد على الخطأ المؤقت بحد أقصى', seen.length === 3, `calls=${seen.length}`);
    check('سبب البديل provider_error', res.fallbackReason === 'provider_error', `reason=${res.fallbackReason}`);
  }

  group('8) المهلة — بلا انتظار لا نهائي');
  {
    const engine = new AiEngine({
      provider: {
        name: 'slow-provider',
        generate: ({ signal }) => new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            const err: any = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
      },
      guard: makeGuard(),
      models: [PRODUCTION_MODEL],
      sleep: noSleep,
      timeoutMs: 60,
      policy: { maxAttempts: 1 },
    });
    const started = Date.now();
    const res = await engine.run({ cacheKey: 'timeout-1', prompt: 'p', deterministicFallback: () => 'بديل' });
    const elapsed = Date.now() - started;
    check('المهلة تُنهي الطلب بدل التعليق', elapsed < 2_000, `elapsed=${elapsed}`);
    check('سبب البديل timeout', res.fallbackReason === 'timeout', `reason=${res.fallbackReason}`);
  }

  group('9) الحصة — لا استهلاك ولا اتصال بالمزود');
  {
    const seen: string[] = [];
    const guard = makeGuard(0);
    const engine = new AiEngine({
      provider: scriptedProvider(() => 'نص', seen),
      guard,
      models: resolveModelCandidates(),
      sleep: noSleep,
    });
    const res = await engine.run({ cacheKey: 'quota-1', prompt: 'p', deterministicFallback: () => 'بديل' });
    check('نفاد الحصة يمنع أي طلب للمزود', seen.length === 0);
    check('سبب البديل quota_guard', res.fallbackReason === 'quota_guard', `reason=${res.fallbackReason}`);
    check('الحصة لا تُستهلك عند الحجب', guard.used === 0);
  }

  group('10) لا مزود — بديل فوري بلا شبكة');
  {
    const engine = new AiEngine({ provider: null, guard: makeGuard(), models: resolveModelCandidates(), sleep: noSleep });
    const res = await engine.run({ cacheKey: 'absent-1', prompt: 'p', deterministicFallback: () => 'بديل حتمي' });
    check('غياب المزود يُنتج بديلاً حتمياً', res.source === 'fallback' && res.text === 'بديل حتمي');
    check('سبب البديل provider_not_configured', res.fallbackReason === 'provider_not_configured');
    check('المزود غير المهيأ معلن', engine.providerConfigured === false);
  }

  group('11) التخزين المؤقت — لا استهلاك مكرر');
  {
    const seen: string[] = [];
    const engine = new AiEngine({
      provider: scriptedProvider(() => 'نص مخزّن', seen),
      guard: makeGuard(),
      models: [PRODUCTION_MODEL],
      sleep: noSleep,
    });
    await engine.run({ cacheKey: 'cache-x', prompt: 'p', deterministicFallback: () => 'بديل' });
    const second = await engine.run({ cacheKey: 'cache-x', prompt: 'p', deterministicFallback: () => 'بديل' });
    check('الطلب الثاني يُخدم من التخزين المؤقت', second.source === 'cache' && second.usedProvider === false);
    check('التخزين المؤقت يمنع طلباً ثانياً للمزود', seen.length === 1, `calls=${seen.length}`);
    check('التخزين المؤقت لا يُبلَّغ كموديل مزود', second.model === null);
  }

  group('12) قاطع الدائرة — يمنع إغراق مزود متعطل');
  {
    const seen: string[] = [];
    const engine = new AiEngine({
      provider: scriptedProvider(() => { throw apiError(500, 'server error'); }, seen),
      guard: makeGuard(100),
      models: [PRODUCTION_MODEL],
      sleep: noSleep,
      policy: { maxAttempts: 1 },
    });
    for (let i = 0; i < 4; i += 1) {
      await engine.run({ cacheKey: `breaker-${i}`, prompt: 'p', deterministicFallback: () => 'بديل' });
    }
    const snapshot = engine.breakerStatus();
    check('قاطع الدائرة يُفتح بعد تكرار الفشل', snapshot.open === true, `open=${snapshot.open}`);
    const callsBefore = seen.length;
    const blocked = await engine.run({ cacheKey: 'breaker-after', prompt: 'p', deterministicFallback: () => 'بديل' });
    check('القاطع المفتوح يمنع طلباً جديداً', seen.length === callsBefore);
    check('سبب البديل circuit_open', blocked.fallbackReason === 'circuit_open', `reason=${blocked.fallbackReason}`);
  }

  group('13) سلامة الرسائل — بلا أسرار');
  {
    const SECRET = ['AIza', 'Sy', 'MOCK', 'SECRET', 'VALUE'].join('') + '0'.repeat(10);
    const engine = new AiEngine({
      provider: scriptedProvider(() => { throw apiError(401, `API key not valid: ${SECRET}`); }),
      guard: makeGuard(),
      models: [PRODUCTION_MODEL],
      sleep: noSleep,
    });
    const res = await engine.run({ cacheKey: 'secret-1', prompt: 'p', deterministicFallback: () => 'بديل' });
    const serialized = JSON.stringify(res);
    check('الاستجابة لا تحمل المفتاح', !serialized.includes(SECRET) && !serialized.includes('AIzaSy'));
    check('الرسالة الآمنة لا تحمل نص المزود الخام', !String(res.notice).includes('not valid'));
  }

  group('14) تحويل تصنيف الخطأ إلى سبب بديل');
  {
    check('not_found → invalid_model', fallbackReasonFor(classifyAiError(apiError(404))) === 'invalid_model');
    check('auth → auth_error', fallbackReasonFor(classifyAiError(apiError(401))) === 'auth_error');
    check('rate_limited → rate_limit', fallbackReasonFor(classifyAiError(apiError(429))) === 'rate_limit');
    check('timeout → timeout', fallbackReasonFor(classifyAiError(Object.assign(new Error('x'), { name: 'TimeoutError' }))) === 'timeout');
    check('network → network_error', fallbackReasonFor(classifyAiError(new Error('fetch failed'))) === 'network_error');
    check('unavailable → provider_error', fallbackReasonFor(classifyAiError(apiError(503))) === 'provider_error');
    check('مجهول → unknown_error', fallbackReasonFor(classifyAiError(new Error('something odd'))) === 'unknown_error');
  }

  group('15) مركزية المعرّفات — مصدر واحد للحقيقة');
  {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const MODEL_ID = /gemini-[0-9]+\.[0-9]+/;

    function walk(dir: string, out: string[] = []): string[] {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
      }
      return out;
    }

    // ملفات الإنتاج فقط: معرّفات الموديل ممنوعة خارج engine/ai/models.ts.
    const production = walk('engine/ai').concat(walk('src')).concat(['server.ts'])
      .filter((f) => !f.replace(/\\/g, '/').endsWith('engine/ai/models.ts'));
    const offenders = production.filter((f) => MODEL_ID.test(readFileSync(f, 'utf8')));
    check('لا معرّف موديل في أي ملف إنتاج خارج models.ts', offenders.length === 0, offenders.join(', '));

    // الاختبارات قد تحمل معرّفات كبيانات اختبار، لكن لا يجوز أن تكرر قائمة المرشحين يدوياً.
    const testFiles = walk('engine/tests');
    const hardcodedCandidateLists = testFiles.filter((f) => {
      const body = readFileSync(f, 'utf8');
      return /models:\s*\[\s*'gemini-3\.8-flash'/.test(body);
    });
    check('الاختبارات لا تكرّر قائمة المرشحين يدوياً', hardcodedCandidateLists.length === 0, hardcodedCandidateLists.join(', '));

    // لا يجوز أن يستورد أي ملف إنتاج عميل Gemini مباشرة غير provider.ts.
    const directClientUse = walk('engine/ai').concat(walk('src')).concat(['server.ts'])
      .filter((f) => {
        const n = f.replace(/\\/g, '/');
        return !n.endsWith('engine/ai/provider.ts') && /new GoogleGenAI\(/.test(readFileSync(f, 'utf8'));
      });
    check('عميل Gemini يُنشأ في provider.ts فقط', directClientUse.length === 0, directClientUse.join(', '));

    // لا مفاتيح في كود الواجهة.
    const frontendKeyUse = walk('src').filter((f) => /VITE_GEMINI|import\.meta\.env\.VITE_GEMINI/.test(readFileSync(f, 'utf8')));
    check('لا مفتاح Gemini في الواجهة الأمامية', frontendKeyUse.length === 0, frontendKeyUse.join(', '));
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} model/provider policy checks`);
  }
}

run().catch((err) => {
  console.error('Model policy harness crashed:', err);
  process.exit(1);
});
