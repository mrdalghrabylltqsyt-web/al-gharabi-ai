/**
 * اختبارات دفعة محرك الذكاء الاصطناعي ومدير السوشيال ميديا.
 * حتمية بالكامل: لا شبكة، ولا مزود حقيقي، ولا استهلاك حصة.
 */

import { classifyAiError, diagnosticLabel } from '../ai/errors';
import { resolveModelCandidates, resolveModelPolicy, isValidModelName, isShutdownModel, SHUTDOWN_MODELS, PRODUCTION_MODEL, DEFAULT_MODEL_CANDIDATES } from '../ai/models';
import { CircuitBreaker, computeBackoffDelay, withRetry } from '../ai/retry';
import { AiEngine, type AiProvider, type AiUsageGuard } from '../ai/engine';
import { buildAdapters, isSupportedPlatform, PLATFORM_SPECS } from '../social/registry';
import {
  buildDeterministicReply,
  canAutoReply,
  classifyComment,
  evaluateReplyGuard,
  fingerprintReply,
  isSelfAuthored,
} from '../social/comments';
import {
  buildPublishRecord,
  canTransition,
  collectAvailableMetrics,
  engagementRate,
  metricAvailability,
  publishPreflight,
} from '../social/publishing';
import { buildMarketingDecision, buildMemorySnapshot, analyzeAudience } from '../social/brain';

// ---------------------------------------------------------------- harness
let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

async function checkAsync(name: string, fn: () => Promise<boolean>, detail = ''): Promise<void> {
  try {
    const ok = await fn();
    check(name, ok, detail);
  } catch (err: any) {
    failures.push(`${name} — threw: ${err?.message || err}`);
  }
}

function group(title: string): void {
  console.log(`\n== ${title} ==`);
}

// ---------------------------------------------------------------- fixtures
function makeGuard(limit = 10): AiUsageGuard & { used: number; releases: number } {
  let used = 0;
  let releases = 0;
  return {
    get used() { return used; },
    get releases() { return releases; },
    canConsume: () => used < limit,
    consume: () => (used < limit ? (used += 1, true) : false),
    release: () => { used = Math.max(0, used - 1); releases += 1; },
    status: () => ({ usedToday: used, limit, remaining: Math.max(0, limit - used), enabled: true }),
  };
}

const noSleep = async () => {};

function providerReturning(text: string): AiProvider {
  return { name: 'test-ok', generate: async () => text };
}

function providerThrowing(err: any, times = Infinity): AiProvider {
  let calls = 0;
  return {
    name: 'test-fail',
    generate: async () => {
      calls += 1;
      if (calls <= times) throw err;
      return 'نجح بعد إعادة المحاولة';
    },
  };
}

function apiError(status: number, message = 'provider error'): Error {
  const err: any = new Error(message);
  err.status = status;
  return err;
}

async function run(): Promise<void> {
  // -------------------------------------------------------------- errors
  group('تصنيف الأخطاء');
  check('429 مصنف rate_limited وقابل للإعادة', (() => {
    const info = classifyAiError(apiError(429));
    return info.kind === 'rate_limited' && info.retryable === true;
  })());
  check('503 مصنف unavailable وقابل للإعادة', (() => {
    const info = classifyAiError(apiError(503));
    return info.kind === 'unavailable' && info.retryable === true;
  })());
  check('401 مصنف auth وغير قابل للإعادة', (() => {
    const info = classifyAiError(apiError(401));
    return info.kind === 'auth' && info.retryable === false;
  })());
  check('404 مصنف not_found وغير قابل للإعادة', (() => {
    const info = classifyAiError(apiError(404));
    return info.kind === 'not_found' && info.retryable === false;
  })());
  check('400 مصنف invalid_request وغير قابل للإعادة', (() => {
    const info = classifyAiError(apiError(400));
    return info.kind === 'invalid_request' && info.retryable === false;
  })());
  check('TimeoutError مصنف timeout وقابل للإعادة', (() => {
    const err: any = new Error('AI request timed out');
    err.name = 'TimeoutError';
    const info = classifyAiError(err);
    return info.kind === 'timeout' && info.retryable === true;
  })());
  check('خطأ شبكة مصنف network وقابل للإعادة', (() => {
    const info = classifyAiError(new Error('fetch failed'));
    return info.kind === 'network' && info.retryable === true;
  })());
  check('رسالة الخطأ الآمنة لا تسرب المفتاح', (() => {
    const info = classifyAiError(apiError(401, 'API key not valid: AIzaSyFAKEKEY123'));
    return !info.safeMessage.includes('AIzaSy') && !info.safeMessage.includes('FAKEKEY');
  })());
  check('diagnosticLabel لا يحتوي نص الخطأ الخام', (() => {
    const info = classifyAiError(apiError(503, 'internal detail leak'));
    const label = diagnosticLabel(info);
    return !label.includes('leak') && label.includes('unavailable');
  })());

  // -------------------------------------------------------------- models
  group('اختيار الموديل');
  // الموديلات الافتراضية يجب أن تكون GA حقيقية. تم التحقق من معرّفاتها مقابل
  // المصادر الرسمية لـ Google، وليس استنتاجاً من الاسم.
  check('موديل الإنتاج معرّف صراحةً', PRODUCTION_MODEL === 'gemini-3.8-flash');
  check('كل المرشحين الافتراضيين معرّفات Gemini صالحة شكلياً', resolveModelCandidates().every((m) => /^gemini-[0-9]/.test(m)));
  check('لا مرشح افتراضي مُوقف فعلياً', resolveModelCandidates().every((m) => !isShutdownModel(m)));
  check('الموديلات الموقوفة لا تظهر في المرشحين', !resolveModelCandidates().some((m) => SHUTDOWN_MODELS.includes(m)));
  check('موديل البيئة الصالح يتقدم القائمة', resolveModelCandidates('gemini-3.8-flash')[0] === 'gemini-3.8-flash');
  check('موديل البيئة الفارغ يُتجاهل', !resolveModelCandidates('   ').includes(''));
  check('قائمة المرشحين بلا تكرار', (() => {
    const list = resolveModelCandidates('gemini-3.6-flash');
    return new Set(list).size === list.length;
  })());
  check('رفض اسم موديل غير صالح شكلياً', !isValidModelName('gemini 2.5 flash!!'));
  check('قبول اسم موديل صالح', isValidModelName('gemini-3.8-flash'));

  // رفض الموديلات الموقوفة — هذا هو جوهر منع تكرار عطل 503.
  check('gemini-2.0-flash مُصنَّف كمُوقف', isShutdownModel('gemini-2.0-flash'));
  check('gemini-2.0-flash-001 مُصنَّف كمُوقف', isShutdownModel('gemini-2.0-flash-001'));
  check('gemini-1.5-flash مُصنَّف كمُوقف', isShutdownModel('gemini-1.5-flash'));
  check('gemini-3-pro-preview مُصنَّف كمُوقف', isShutdownModel('gemini-3-pro-preview'));
  check('موديل حالي ليس مُوقفاً', !isShutdownModel('gemini-3.8-flash'));

  // موديل بيئة مُوقف: يُرفض ولا يُمرَّر للمزود أبداً.
  check('موديل البيئة المُوقف يُرفض', (() => {
    const p = resolveModelPolicy('gemini-2.0-flash');
    return p.configuredModel === null && p.rejectedReason !== null && !p.candidates.includes('gemini-2.0-flash');
  })());
  check('رفض موديل البيئة المُوقف يُبقي مرشحين صالحين', resolveModelPolicy('gemini-2.0-flash-001').candidates.every((m) => !isShutdownModel(m)));
  check('موديل البيئة غير الصالح شكلياً يُرفض بسبب', resolveModelPolicy('not a model!!').rejectedReason !== null);
  check('موديل بيئة غير متاح للحسابات الجديدة يُرفض بسبب', (() => {
    // مُثبت حياً (2026-09-21): المزود يرفض gemini-2.5-flash بحالة 404.
    const p = resolveModelPolicy('gemini-2.5-flash');
    return p.configuredModel === null && p.rejectedReason !== null && !p.candidates.includes('gemini-2.5-flash');
  })());
  check('موديل معاينة يُقبل مع تحذير', (() => {
    const p = resolveModelPolicy('gemini-3-flash-preview');
    return p.configuredModel === 'gemini-3-flash-preview' && p.warnings.some((w) => w.includes('معاينة') || w.includes('تجريبي'));
  })());
  check('لا تحذير لموديل إنتاج نظيف', resolveModelPolicy('gemini-3.8-flash').warnings.length === 0);

  // -------------------------------------------------------------- retry
  group('إعادة المحاولة والتأخير التصاعدي');
  check('التأخير يتصاعد أُسّياً', (() => {
    const policy = { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 10_000, factor: 2 };
    const d1 = computeBackoffDelay(1, policy, () => 0.5);
    const d2 = computeBackoffDelay(2, policy, () => 0.5);
    const d3 = computeBackoffDelay(3, policy, () => 0.5);
    return d1 === 100 && d2 === 200 && d3 === 400;
  })());
  check('التأخير لا يتجاوز السقف', computeBackoffDelay(20, { maxAttempts: 25, baseDelayMs: 100, maxDelayMs: 5_000, factor: 2 }, () => 0.5) <= 5_000);
  check('العشوائية تبقى ضمن حدود معقولة', (() => {
    const policy = { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 10_000, factor: 2 };
    const low = computeBackoffDelay(1, policy, () => 0);
    const high = computeBackoffDelay(1, policy, () => 1);
    return low >= 750 && high <= 1_250;
  })());

  await checkAsync('إعادة المحاولة تنجح على خطأ مؤقت', async () => {
    const guard = makeGuard();
    const engine = new AiEngine({
      provider: providerThrowing(apiError(503), 2),
      guard, models: ['gemini-2.5-flash'], sleep: noSleep, random: () => 0.5,
    });
    const result = await engine.run({ cacheKey: 'k1', prompt: 'p', deterministicFallback: () => 'بديل' });
    return result.usedProvider && result.source === 'provider' && result.attempts === 3;
  });

  await checkAsync('لا إعادة محاولة على خطأ دائم (401)', async () => {
    let calls = 0;
    const provider: AiProvider = { name: 'auth-fail', generate: async () => { calls += 1; throw apiError(401); } };
    const engine = new AiEngine({ provider, guard: makeGuard(), models: ['gemini-2.5-flash'], sleep: noSleep });
    const result = await engine.run({ cacheKey: 'k2', prompt: 'p', deterministicFallback: () => 'بديل' });
    return calls === 1 && !result.usedProvider && result.errorKind === 'auth';
  });

  await checkAsync('لا إعادة محاولة على 400', async () => {
    let calls = 0;
    const provider: AiProvider = { name: 'bad-req', generate: async () => { calls += 1; throw apiError(400); } };
    const engine = new AiEngine({ provider, guard: makeGuard(), models: ['gemini-2.5-flash'], sleep: noSleep });
    const result = await engine.run({ cacheKey: 'k3', prompt: 'p', deterministicFallback: () => 'بديل' });
    return calls === 1 && result.errorKind === 'invalid_request';
  });

  await checkAsync('عدد المحاولات محدود بـ maxAttempts', async () => {
    let calls = 0;
    const provider: AiProvider = { name: 'always-503', generate: async () => { calls += 1; throw apiError(503); } };
    const engine = new AiEngine({
      provider, guard: makeGuard(), models: ['gemini-2.5-flash'], sleep: noSleep,
      policy: { maxAttempts: 2 },
    });
    await engine.run({ cacheKey: 'k4', prompt: 'p', deterministicFallback: () => 'بديل' });
    return calls === 2;
  });

  await checkAsync('قاطع الدائرة يفتح بعد تكرار الفشل ويمنع الطلبات', async () => {
    let calls = 0;
    const provider: AiProvider = { name: 'always-503', generate: async () => { calls += 1; throw apiError(503); } };
    const breaker = new CircuitBreaker(2, 60_000);
    const engine = new AiEngine({
      provider, guard: makeGuard(100), models: ['gemini-2.5-flash'], sleep: noSleep, breaker,
      policy: { maxAttempts: 1 },
    });
    await engine.run({ cacheKey: 'b1', prompt: 'p', deterministicFallback: () => 'بديل' });
    await engine.run({ cacheKey: 'b2', prompt: 'p', deterministicFallback: () => 'بديل' });
    const callsBefore = calls;
    const result = await engine.run({ cacheKey: 'b3', prompt: 'p', deterministicFallback: () => 'بديل' });
    return calls === callsBefore && result.source === 'fallback' && result.errorKind === 'unavailable';
  });

  await checkAsync('قاطع الدائرة يسمح بمحاولة بعد انتهاء التهدئة', async () => {
    const provider: AiProvider = { name: 'always-503', generate: async () => { throw apiError(503); } };
    const breaker = new CircuitBreaker(1, 1_000);
    let now = 0;
    const engine = new AiEngine({
      provider, guard: makeGuard(100), models: ['gemini-2.5-flash'], sleep: noSleep, breaker,
      policy: { maxAttempts: 1 }, now: () => now,
    });
    await engine.run({ cacheKey: 'c1', prompt: 'p', deterministicFallback: () => 'بديل' });
    const openNow = breaker.isOpen(now);
    now += 5_000;
    const openLater = breaker.isOpen(now);
    return openNow === true && openLater === false;
  });

  // -------------------------------------------------------------- fallback
  group('البديل الحتمي والحصة والتخزين المؤقت');
  await checkAsync("غياب المزود يعطي بديلاً حتمياً دون استهلاك", async () => {
    const guard = makeGuard();
    const engine = new AiEngine({ provider: null, guard, models: ['gemini-2.5-flash'] });
    const result = await engine.run({ cacheKey: 'n1', prompt: 'p', deterministicFallback: () => 'نص حتمي' });
    return result.text === 'نص حتمي' && result.source === 'fallback' && !result.usedProvider && guard.used === 0;
  });

  await checkAsync('نفاد الحصة يعطي بديلاً دون استدعاء المزود', async () => {
    let calls = 0;
    const provider: AiProvider = { name: 'x', generate: async () => { calls += 1; return 'ok'; } };
    const engine = new AiEngine({ provider, guard: makeGuard(0), models: ['gemini-2.5-flash'] });
    const result = await engine.run({ cacheKey: 'n2', prompt: 'p', deterministicFallback: () => 'بديل حصة' });
    return calls === 0 && result.text === 'بديل حصة' && result.errorKind === 'rate_limited';
  });

  await checkAsync('الحصة تُعاد عند فشل الطلب', async () => {
    const guard = makeGuard(5);
    const engine = new AiEngine({
      provider: providerThrowing(apiError(401), Infinity), guard, models: ['gemini-2.5-flash'], sleep: noSleep,
    });
    await engine.run({ cacheKey: 'n3', prompt: 'p', deterministicFallback: () => 'بديل' });
    return guard.used === 0 && guard.releases === 1;
  });

  await checkAsync('الحصة تُستهلك مرة واحدة عند النجاح', async () => {
    const guard = makeGuard(5);
    const engine = new AiEngine({ provider: providerReturning('نص المزود'), guard, models: ['gemini-2.5-flash'], sleep: noSleep });
    await engine.run({ cacheKey: 'n4', prompt: 'p', deterministicFallback: () => 'بديل' });
    return guard.used === 1;
  });

  await checkAsync('التخزين المؤقت يمنع الاستهلاك المتكرر', async () => {
    let calls = 0;
    const provider: AiProvider = { name: 'count', generate: async () => { calls += 1; return `نتيجة-${calls}`; } };
    const guard = makeGuard(10);
    const engine = new AiEngine({ provider, guard, models: ['gemini-2.5-flash'], sleep: noSleep });
    const first = await engine.run({ cacheKey: 'same', prompt: 'p', deterministicFallback: () => 'بديل' });
    const second = await engine.run({ cacheKey: 'same', prompt: 'p', deterministicFallback: () => 'بديل' });
    return calls === 1 && first.text === second.text && second.source === 'cache' && guard.used === 1;
  });

  await checkAsync('الطلبات المتزامنة المتطابقة تُدمج في تنفيذ واحد', async () => {
    let calls = 0;
    const provider: AiProvider = {
      name: 'slow',
      generate: async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return 'نتيجة مشتركة'; },
    };
    const engine = new AiEngine({ provider, guard: makeGuard(10), models: ['gemini-2.5-flash'], sleep: noSleep });
    const [a, b, c] = await Promise.all([
      engine.run({ cacheKey: 'dup', prompt: 'p', deterministicFallback: () => 'بديل' }),
      engine.run({ cacheKey: 'dup', prompt: 'p', deterministicFallback: () => 'بديل' }),
      engine.run({ cacheKey: 'dup', prompt: 'p', deterministicFallback: () => 'بديل' }),
    ]);
    return calls === 1 && a.text === b.text && b.text === c.text;
  });

  await checkAsync('التخزين المؤقت ينتهي بانتهاء صلاحيته', async () => {
    let calls = 0;
    const provider: AiProvider = { name: 'count', generate: async () => { calls += 1; return 'قيمة'; } };
    let now = 0;
    const engine = new AiEngine({
      provider, guard: makeGuard(10), models: ['gemini-2.5-flash'], sleep: noSleep,
      now: () => now, cacheTtlMs: 1_000,
    });
    await engine.run({ cacheKey: 'ttl', prompt: 'p', deterministicFallback: () => 'بديل' });
    now += 5_000;
    await engine.run({ cacheKey: 'ttl', prompt: 'p', deterministicFallback: () => 'بديل' });
    return calls === 2;
  });

  await checkAsync('الانتقال إلى الموديل التالي عند 404', async () => {
    const seen: string[] = [];
    const provider: AiProvider = {
      name: 'model-router',
      generate: async ({ model }) => {
        seen.push(model);
        if (model === 'gemini-2.5-flash') throw apiError(404, 'model not found');
        return 'نجح بالموديل البديل';
      },
    };
    const engine = new AiEngine({ provider, guard: makeGuard(10), models: ['gemini-2.5-flash', 'gemini-2.0-flash'], sleep: noSleep });
    const result = await engine.run({ cacheKey: 'm1', prompt: 'p', deterministicFallback: () => 'بديل' });
    return result.usedProvider && seen.length === 2 && seen[1] === 'gemini-2.0-flash';
  });

  // ★ ضغط المزود (503) يجب أن ينتقل لموديل شقيق سليم في نفس الطلب، لا أن يُهدر
  // كل المحاولات على الموديل المشغول. هذا ما لوحظ حياً: 3.8 يعيد 503 و3.5 ينجح.
  await checkAsync('★ خطأ 503 ينتقل للموديل التالي بدل حرق المحاولات', async () => {
    const seen: string[] = [];
    const candidates = [...DEFAULT_MODEL_CANDIDATES];
    const healthy = candidates[candidates.length - 1];
    const provider: AiProvider = {
      name: 'overload-then-ok',
      generate: async ({ model }) => {
        seen.push(model);
        // كل الموديلات مشغولة إلا الأخير — تعافٍ فعلي من ضغط المزود.
        if (model !== healthy) throw apiError(503, 'high demand');
        return 'نجح بالموديل الشقيق';
      },
    };
    const engine = new AiEngine({ provider, guard: makeGuard(10), models: candidates, sleep: noSleep });
    const result = await engine.run({ cacheKey: 'f1', prompt: 'p', deterministicFallback: () => 'بديل' });
    // نجح فعلاً، وجرّب المرشحين بالترتيب مرة واحدة بلا إعادة على نفس الموديل.
    return result.usedProvider && result.model === healthy && seen.join(',') === candidates.join(',');
  });

  await checkAsync('استجابة المزود الفارغة تُعامل كفشل', async () => {
    const provider: AiProvider = { name: 'empty', generate: async () => '   ' };
    const engine = new AiEngine({ provider, guard: makeGuard(10), models: ['gemini-2.5-flash'], sleep: noSleep, policy: { maxAttempts: 1 } });
    const result = await engine.run({ cacheKey: 'e1', prompt: 'p', deterministicFallback: () => 'بديل فارغ' });
    return !result.usedProvider && result.text === 'بديل فارغ';
  });

  await checkAsync('المهلة توقف الطلب ولا تُعلّقه', async () => {
    const provider: AiProvider = { name: 'hang', generate: () => new Promise(() => {}) };
    const engine = new AiEngine({
      provider, guard: makeGuard(10), models: ['gemini-2.5-flash'], sleep: noSleep,
      timeoutMs: 50, policy: { maxAttempts: 1 },
    });
    const started = Date.now();
    const result = await engine.run({ cacheKey: 't1', prompt: 'p', deterministicFallback: () => 'بديل مهلة' });
    return Date.now() - started < 3_000 && result.text === 'بديل مهلة' && result.errorKind === 'timeout';
  });

  // -------------------------------------------------------------- adapters
  group('موصلات المنصات');
  const adapters = buildAdapters(() => null);
  check('يوجد موصل لكل المنصات العشر', adapters.length === 10 && PLATFORM_SPECS.length === 10);
  check('كل المنصات تبدأ غير متصلة', adapters.every((a) => a.describe().connection === 'disconnected'));
  check('لا منصة تُعلن جاهزية إنتاجية', adapters.every((a) => a.describe().productionReady === false));
  check('واتساب لا يعلن قدرة نشر', (() => {
    const wa = adapters.find((a) => a.platform === 'whatsapp');
    return Boolean(wa) && wa!.supports('messages') && !wa!.supports('publish') && !wa!.supports('comments');
  })());
  check('تليجرام لا يعلن قدرة تعليقات', (() => {
    const tg = adapters.find((a) => a.platform === 'telegram');
    return Boolean(tg) && !tg!.supports('comments');
  })());
  check('سناب شات لا يعلن قدرة تعليقات', (() => {
    const sc = adapters.find((a) => a.platform === 'snapchat');
    return Boolean(sc) && !sc!.supports('comments');
  })());
  check('جوجل بزنس لا يعلن قدرة تعليقات', (() => {
    const gb = adapters.find((a) => a.platform === 'google_business');
    return Boolean(gb) && !gb!.supports('comments');
  })());
  check('فيسبوك يعلن النشر والتعليقات والرسائل', (() => {
    const fb = adapters.find((a) => a.platform === 'facebook');
    return Boolean(fb) && fb!.supports('publish') && fb!.supports('comments') && fb!.supports('messages');
  })());
  check('الاتصال الموثق يظهر متصلاً', (() => {
    const list = buildAdapters((p) => (p === 'facebook' ? { status: 'connected' as const, providerVerified: true, accountId: '1' } : null));
    const fb = list.find((a) => a.platform === 'facebook')!;
    const tt = list.find((a) => a.platform === 'tiktok')!;
    return fb.describe().connection === 'connected' && fb.describe().providerVerified && tt.describe().connection === 'disconnected';
  })());
  check('اتصال غير موثق لا يُعد متصلاً', (() => {
    const list = buildAdapters((p) => (p === 'facebook' ? { status: 'connected' as const, providerVerified: false } : null));
    const fb = list.find((a) => a.platform === 'facebook')!;
    return fb.describe().productionReady === false;
  })());
  check('تمييز المنصة المدعومة من غيرها', isSupportedPlatform('tiktok') && !isSupportedPlatform('myspace'));

  // -------------------------------------------------------------- comments
  group('تحليل التعليقات وحمايات الرد');
  check('تصنيف الاستفسار التجاري', classifyComment('بكم سعر الغسالة بالتقسيط؟').intent === 'business_inquiry');
  check('تصنيف الشكوى وحاجتها لمراجعة بشرية', (() => {
    const c = classifyComment('عندي شكوى على التأخير في التسليم');
    return c.intent === 'complaint' && c.requiresHumanReview === true && c.sentiment === 'negative';
  })());
  check('تصنيف المدح', classifyComment('شكراً لكم خدمة ممتازة').intent === 'praise');
  check('تصنيف السؤال', classifyComment('متى تفتحون؟').intent === 'question');
  check('تصنيف السبام', classifyComment('اربح المال من البيت https://spam.example').intent === 'spam');
  check('السبام لا يُرد عليه آلياً', canAutoReply(classifyComment('اربح المال https://spam.example')) === false);
  check('الاستفسار العادي يُرد عليه آلياً', canAutoReply(classifyComment('بكم سعر الثلاجة؟')) === true);
  check('الحالة الحساسة لا تُرد آلياً', canAutoReply(classifyComment('سأرفع قضية قانونية ضدكم')) === false);
  check('كشف تعليق صادر من حسابنا (حلقة ردود)', isSelfAuthored('معرض الغرابي', ['معرض الغرابي', 'AlGharabi']) === true);
  check('عدم اعتبار عميل عادي حساباً ذاتياً', isSelfAuthored('أحمد', ['معرض الغرابي']) === false);
  check('الرد الحتمي يختلف حسب النية', buildDeterministicReply(classifyComment('بكم السعر؟')) !== buildDeterministicReply(classifyComment('شكراً لكم')));
  check('الرد الحتمي لا يحتوي رقم هاتف مخترع', !/\d{7,}/.test(buildDeterministicReply(classifyComment('بكم السعر؟'))));

  check('بوابة الرد تمنع الرد المكرر على نفس التعليق', (() => {
    const history = [{ externalId: 'c1', replyFingerprint: fingerprintReply('رد'), repliedAt: new Date().toISOString() }];
    const decision = evaluateReplyGuard({ externalId: 'c1', replyText: 'رد جديد', history });
    return decision.allowed === false && decision.reason!.includes('مسبقاً');
  })());
  check('بوابة الرد تمنع تكرار نفس النص على تعليقات متعددة', (() => {
    const history = [
      { externalId: 'c1', replyFingerprint: fingerprintReply('نفس الرد'), repliedAt: '' },
      { externalId: 'c2', replyFingerprint: fingerprintReply('نفس الرد'), repliedAt: '' },
    ];
    const decision = evaluateReplyGuard({ externalId: 'c3', replyText: 'نفس الرد', history });
    return decision.allowed === false;
  })());
  check('بوابة الرد تسمح برد جديد على تعليق جديد', (() => {
    const history = [{ externalId: 'c1', replyFingerprint: fingerprintReply('رد قديم'), repliedAt: '' }];
    return evaluateReplyGuard({ externalId: 'c2', replyText: 'رد جديد مختلف', history }).allowed === true;
  })());
  check('بوابة الرد ترفض غياب معرّف التعليق', evaluateReplyGuard({ externalId: '', replyText: 'رد', history: [] }).allowed === false);
  check('بوابة الرد ترفض النص الفارغ', evaluateReplyGuard({ externalId: 'c9', replyText: '   ', history: [] }).allowed === false);
  check('البصمة تتجاهل اختلاف المسافات', fingerprintReply('رد  واحد') === fingerprintReply('  رد واحد  '));

  // -------------------------------------------------------------- publishing
  group('دورة النشر والتحليلات');
  check('انتقالات الحالة الصحيحة مسموحة', canTransition('draft', 'review') && canTransition('approved', 'scheduled') && canTransition('publishing', 'published'));
  check('القفز من مسودة إلى منشور مرفوض', canTransition('draft', 'published') === false);
  check('النشر من حالة مرفوضة مرفوض', canTransition('failed', 'published') === false);

  check('فحص النشر يفشل عند عدم الاتصال', (() => {
    const r = publishPreflight({ platform: 'facebook', approved: true, hasContent: true, connected: false, providerVerified: false, supportsPublish: true });
    return r.ready === false && r.reasons.some((x) => x.includes('غير متصل'));
  })());
  check('فحص النشر يفشل بدون موافقة', publishPreflight({ platform: 'facebook', approved: false, hasContent: true, connected: true, providerVerified: true, supportsPublish: true }).ready === false);
  check('فحص النشر ينجح عند تحقق كل الشروط', publishPreflight({ platform: 'facebook', approved: true, hasContent: true, connected: true, providerVerified: true, supportsPublish: true }).ready === true);
  check('فحص النشر يفشل على منصة لا تدعم النشر', publishPreflight({ platform: 'whatsapp', approved: true, hasContent: true, connected: true, providerVerified: true, supportsPublish: false }).ready === false);

  check('نشر بدون معرّف مزود يُسجّل فاشلاً لا منشوراً', (() => {
    const record = buildPublishRecord({ platform: 'facebook', postId: 'p1', providerPostId: null, simulated: false });
    return record.state === 'failed' && record.error !== null;
  })());
  check('نشر بمعرّف مزود يُسجّل منشوراً', (() => {
    const record = buildPublishRecord({ platform: 'facebook', postId: 'p1', providerPostId: 'ext-1', simulated: false });
    return record.state === 'published' && record.providerPostId === 'ext-1' && record.error === null;
  })());
  check('النشر المحاكي مُعلَّم بوضوح', buildPublishRecord({ platform: 'facebook', postId: 'p1', providerPostId: 'mock-1', simulated: true }).simulated === true);
  check('سجل النشر يحفظ المنصة والتوقيت', (() => {
    const record = buildPublishRecord({ platform: 'tiktok', postId: 'p2', scheduledFor: '2026-01-01T10:00:00Z', providerPostId: 'x', simulated: false, executedAt: '2026-01-01T10:00:05Z' });
    return record.platform === 'tiktok' && record.scheduledFor === '2026-01-01T10:00:00Z' && record.executedAt === '2026-01-01T10:00:05Z';
  })());

  check('المؤشرات غير المدعومة تُعلن غير متاحة', (() => {
    const list = metricAvailability('snapchat');
    const reach = list.find((m) => m.metric === 'reach')!;
    return reach.available === false && Boolean(reach.reason);
  })());
  check('واتساب لا يدّعي أي مؤشر', metricAvailability('whatsapp').every((m) => !m.available));
  check('إنستغرام يعلن حفظ المنشورات', metricAvailability('instagram').find((m) => m.metric === 'saves')!.available === true);
  check('جمع المؤشرات يستبعد غير المتاح', (() => {
    const values = collectAvailableMetrics('snapchat', { views: 10, likes: 5, reach: 99, saves: 3 });
    return values.views === 10 && values.likes === undefined && values.reach === undefined;
  })());
  check('جمع المؤشرات يرفض القيم غير الرقمية', Object.keys(collectAvailableMetrics('instagram', { views: 'abc' })).length === 0);
  check('نسبة التفاعل تُحسب من المتاح', engagementRate({ views: 1000, likes: 50, comments: 10, shares: 5 }) === 6.5);
  check('نسبة التفاعل غير محسوبة بدون أساس', engagementRate({ likes: 5 }) === null);

  // -------------------------------------------------------------- brain
  group('العقل التسويقي والذاكرة');
  check('الجمهور يُعلن غياب البيانات عند غياب القياس', (() => {
    const profile = analyzeAudience([]);
    return profile.dataAvailable === false && profile.segments.length > 0 && profile.note.includes('لا توجد');
  })());
  check('الجمهور يُعلن توفر البيانات عند وجود قياس', analyzeAudience([{ platform: 'facebook', values: { views: 10 }, at: '' }]).dataAvailable === true);

  const decision = buildMarketingDecision({
    objective: 'زيادة استفسارات التقسيط',
    platforms: ['facebook', 'tiktok', 'whatsapp'],
    performance: [],
    memory: buildMemorySnapshot({ posts: [], comments: [], decisions: [], strategies: [] }),
  });
  check('الخطة تغطي كل المنصات المطلوبة', decision.plan.length === 3);
  check('التوقيت تقديري عند غياب القياس', decision.plan.every((p) => p.timingConfidence === 'estimated'));
  check('كل توصية تحمل سبباً صريحاً', decision.plan.every((p) => p.reason.length > 10));
  check('الخطة تُعلن الفجوات بدل اختلاق نتائج', decision.dataGaps.length >= 2);
  check('التعلم لا يدّعي أفضلية بلا بيانات', decision.learnings.some((l) => l.includes('لا يمكن الجزم')));
  check('كل عنصر خطة يحدد مؤشر نجاح وتوافره', decision.plan.every((p) => typeof p.metricAvailable === 'boolean' && p.successMetric.length > 0));

  const decisionMeasured = buildMarketingDecision({
    objective: 'اختبار',
    platforms: ['facebook', 'instagram'],
    performance: [
      { platform: 'facebook', values: { views: 500, likes: 40 }, at: '' },
      { platform: 'instagram', values: { views: 100, likes: 2 }, at: '' },
    ],
    memory: buildMemorySnapshot({ posts: [], comments: [], decisions: [], strategies: [] }),
  });
  check('التوقيت يصبح مقاساً عند وجود بيانات', decisionMeasured.plan.every((p) => p.timingConfidence === 'measured'));
  check('التعلم يستخرج أفضل منصة من البيانات', decisionMeasured.learnings.some((l) => l.includes('facebook')));

  const memory = buildMemorySnapshot({
    posts: [
      { status: 'published', targetPlatforms: ['facebook'], tags: ['تقسيط'] },
      { status: 'scheduled', targetPlatforms: ['tiktok'], tags: ['عروض'] },
      { status: 'published', targetPlatforms: ['facebook'], tags: ['تقسيط'] },
    ],
    comments: [
      { text: 'بكم سعر الغسالة؟', intent: 'business_inquiry' },
      { text: 'شكراً لكم', intent: 'praise' },
      { text: 'متى تفتحون؟', intent: 'question' },
    ],
    decisions: [{ decision: 'التركيز على فيسبوك', at: '', reason: 'أعلى وصول' }],
    strategies: [{ strategy: 'اختبار فيديو قصير', outcome: 'قيد القياس', at: '' }],
  });
  check('الذاكرة تحسب المنشورات المنشورة والمجدولة', memory.publishedCount === 2 && memory.scheduledCount === 1);
  check('الذاكرة تحسب توزيع المنصات', memory.platformBreakdown.facebook === 2 && memory.platformBreakdown.tiktok === 1);
  check('الذاكرة تجمع الأسئلة المتكررة فقط', memory.frequentQuestions.length === 2 && !memory.frequentQuestions.some((q) => q.includes('شكراً')));
  check('الذاكرة تحفظ القرارات والاستراتيجيات', memory.decisions.length === 1 && memory.strategiesTested.length === 1);

  // -------------------------------------------------------------- summary
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} checks`);
}

run().catch((err) => {
  console.error('Harness crashed:', err);
  process.exit(1);
});
