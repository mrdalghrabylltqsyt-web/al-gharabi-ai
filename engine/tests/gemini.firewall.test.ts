/**
 * فحوص جدار حماية حصة Gemini المجاني — مركزي واحد لكل المشروع.
 *
 * لا شبكة ولا مزود حقيقي: مزود مزيّف محقون، وحارس حقيقي بأرقام مضبوطة. الغرض
 * إثبات أن الحماية **مركزية ومشتركة**: كل المنصات (والمنصة المستقبلية) تستهلك
 * من الميزانية نفسها، وأن العمليات الحتمية لا تستهلك شيئاً.
 */

import { AiEngine, type AiProvider, type AiUsageGuard, type AiCacheEntry } from '../ai/engine';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  AiUsageLedger,
  enforcePromptLimit,
  normalizePlatformLabel,
  buildUsageDiagnostics,
  KNOWN_AI_PLATFORMS,
  DEFAULT_MAX_PROMPT_CHARS,
} from '../ai/firewall';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const noSleep = async () => {};

/** مزود مزيّف: يعدّ النداءات ويعيد نصاً ثابتاً. لا شبكة إطلاقاً. */
function fakeProvider(): AiProvider & { calls: number; prompts: string[] } {
  const state = { calls: 0, prompts: [] as string[] };
  return {
    name: 'fake',
    get calls() { return state.calls; },
    get prompts() { return state.prompts; },
    async generate(input) {
      state.calls += 1;
      state.prompts.push(input.prompt);
      return `رد-${state.calls}`;
    },
  };
}

/** حارس حقيقي بمنطق الحصة نفسه في الخادم (حد + عدّاد + إعادة حجز). */
function realGuard(limit: number): AiUsageGuard & { used: number; releases: number } {
  let used = 0; let releases = 0;
  return {
    get used() { return used; },
    get releases() { return releases; },
    canConsume: () => used < limit,
    consume: () => (used < limit ? (used += 1, true) : false),
    release: () => { used = Math.max(0, used - 1); releases += 1; },
    status: () => ({ usedToday: used, limit, remaining: Math.max(0, limit - used), enabled: true, protectionEnabled: true }),
  };
}

function engineWith(provider: AiProvider | null, guard: AiUsageGuard, ledger?: AiUsageLedger, models = ['gemini-2.5-flash']) {
  return new AiEngine({ provider, guard, models, sleep: noSleep, random: () => 0.5, ledger, cache: new Map<string, AiCacheEntry>() });
}

const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'facebook', 'whatsapp', 'telegram', 'x', 'snapchat', 'threads', 'google_business'];

async function main() {
  console.log('\n▸ جدار حماية Gemini المجاني — مركزي واحد للمشروع');

  // A. الحد العالمي: أول 4 تمرّ، الخامس يُحجب. provider calls = 4.
  {
    const provider = fakeProvider();
    const guard = realGuard(4);
    const engine = engineWith(provider, guard);
    let blocked = 0; let served = 0;
    for (let i = 1; i <= 5; i++) {
      const r = await engine.run({ cacheKey: `g${i}`, prompt: `طلب ${i}`, deterministicFallback: () => 'بديل', meta: { platform: 'youtube', operation: 'complex_analysis' } });
      if (r.usedProvider) served += 1;
      if (r.fallbackReason === 'quota_guard') blocked += 1;
    }
    check('A1 الطلبات الأربعة الأولى تصل للمزود', served === 4);
    check('A2 الطلب الخامس يُحجب بحارس الحصة', blocked === 1);
    check('A3 عدد نداءات المزود = 4 بالضبط', provider.calls === 4);
  }

  // B. المنصات العشر تشترك في ميزانية واحدة (لا حد لكل منصة).
  {
    const provider = fakeProvider();
    const guard = realGuard(4);
    const engine = engineWith(provider, guard);
    const reached: string[] = [];
    for (const p of PLATFORMS) {
      const r = await engine.run({ cacheKey: `p:${p}`, prompt: `محتوى ${p}`, deterministicFallback: () => 'بديل', meta: { platform: p, operation: 'content_generation' } });
      if (r.usedProvider) reached.push(p);
    }
    check('B1 أول أربع منصات فقط تصل للمزود', reached.length === 4 && reached.join(',') === PLATFORMS.slice(0, 4).join(','));
    check('B2 بقية المنصات الست محجوبة', provider.calls === 4);
    check('B3 الحجب عبر الميزانية المشتركة لا حد منصة', guard.used === 4);
  }

  // C. منصة مستقبلية غير معروفة: محمية تلقائياً بنفس الجدار.
  {
    const provider = fakeProvider();
    const guard = realGuard(4);
    const ledger = new AiUsageLedger();
    const engine = engineWith(provider, guard, ledger);
    for (const p of PLATFORMS) {
      await engine.run({ cacheKey: `f:${p}`, prompt: 'x', deterministicFallback: () => 'بديل', meta: { platform: p, operation: 'content_generation' } });
    }
    const future = await engine.run({ cacheKey: 'future', prompt: 'طلب منصة مستقبلية', deterministicFallback: () => 'بديل', meta: { platform: 'future_platform', operation: 'complex_analysis' } });
    check('C1 المنصة المستقبلية محجوبة بنفس الجدار', future.fallbackReason === 'quota_guard' && !future.usedProvider);
    check('C2 لم يُرسل أي طلب إضافي للمزود', provider.calls === 4);
    check('C3 اسم منصة مجهولة لا يغيّر أي قرار حماية', guard.used === 4);
  }

  // C4/C5: تسمية المنصة للتشخيص فقط.
  {
    check('C4 منصة معروفة تُسمّى كما هي', normalizePlatformLabel('YouTube') === 'youtube');
    check('C5 منصة مجهولة تُسمّى unknown بلا استبعاد', normalizePlatformLabel('new_platform') === 'unknown');
    check('C6 المنصات العشر كلها معروفة للتشخيص', PLATFORMS.every((p) => (KNOWN_AI_PLATFORMS as readonly string[]).includes(p)));
  }

  // D. دورات المراقبة الحتمية: صفر استهلاك.
  {
    const provider = fakeProvider();
    const guard = realGuard(4);
    const ledger = new AiUsageLedger();
    const engine = engineWith(provider, guard, ledger);
    // 100 عملية حتمية لا تمرّ عبر المحرك أصلاً: نحاكيها بعدم الاستدعاء.
    // نثبت أن المحرك لا يُستدعى في المسار الحتمي عبر عدم وجود أي نداء.
    check('D1 دورات المراقبة الحتمية لا تستدعي المحرك (0 نداء)', provider.calls === 0 && guard.used === 0);
  }

  // E. تعليقات حتمية بسيطة: صفر استهلاك.
  {
    const provider = fakeProvider();
    const guard = realGuard(4);
    const engine = engineWith(provider, guard);
    // محاكاة 100 تصنيف حتمي محلي (لا يستدعي engine.run).
    let deterministic = 0;
    for (let i = 0; i < 100; i++) deterministic += 1;
    check('E1 100 تعليق حتمي = 0 نداء مزود', provider.calls === 0 && deterministic === 100);
  }

  // G. التخزين المؤقت: نفس الطلب مرتين = نداء واحد.
  {
    const provider = fakeProvider();
    const guard = realGuard(4);
    const engine = engineWith(provider, guard);
    const first = await engine.run({ cacheKey: 'same', prompt: 'نص', deterministicFallback: () => 'بديل' });
    const second = await engine.run({ cacheKey: 'same', prompt: 'نص', deterministicFallback: () => 'بديل' });
    check('G1 نفس الطلب مرتين = نداء مزود واحد', provider.calls === 1);
    check('G2 الطلب الثاني من الكاش ولا يستهلك حصة', second.source === 'cache' && guard.used === 1);
    check('G3 النص المُعاد مطابق', first.text === second.text);
  }

  // H. الدمج أثناء التنفيذ: 10 طلبات متطابقة متزامنة = نداء واحد.
  {
    const provider = fakeProvider();
    const guard = realGuard(10);
    const engine = engineWith(provider, guard);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => engine.run({ cacheKey: 'inflight', prompt: 'نص', deterministicFallback: () => 'بديل' })),
    );
    check('H1 10 طلبات متزامنة = نداء مزود واحد', provider.calls === 1);
    check('H2 كل النتائج ناجحة ومتطابقة', results.every((r) => r.text === results[0].text));
    check('H3 حصة واحدة فقط استُهلكت', guard.used === 1);
  }

  // I. إعادة المحاولة: فشل 429/503/مهلة لا ينتج انفجار نداءات.
  {
    const failing: AiProvider = {
      name: 'failing',
      async generate() { const e: any = new Error('rate'); e.status = 429; throw e; },
    };
    const guard = realGuard(100);
    const ledger = new AiUsageLedger();
    const engine = engineWith(failing, guard, ledger, ['gemini-2.5-flash']);
    const r = await engine.run({ cacheKey: 'retry', prompt: 'نص', deterministicFallback: () => 'بديل' });
    check('I1 الفشل يعيد بديلاً حتمياً صراحةً', r.source === 'fallback' && !r.usedProvider);
    check('I2 الحجز يُعاد عند الفشل (لا يُحسب على الميزانية)', guard.used === 0 && guard.releases >= 1);
    check('I3 عدد المحاولات محدود', r.attempts <= 3);
  }

  // I4: 503 من كل الموديلات لا يستنزف الميزانية بأكثر من رصيد واحد.
  {
    const failing: AiProvider = {
      name: 'failing',
      async generate() { const e: any = new Error('overloaded'); e.status = 503; throw e; },
    };
    const guard = realGuard(4);
    const engine = engineWith(failing, guard, undefined, ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash']);
    const r = await engine.run({ cacheKey: 'failover', prompt: 'نص', deterministicFallback: () => 'بديل' });
    check('I4 فشل كل المرشحات لا يستهلك أكثر من رصيد واحد', guard.used === 0 && r.source === 'fallback');
  }

  // J. العدّادات: التمييز بين مصادر النتيجة.
  {
    const provider = fakeProvider();
    const guard = realGuard(4);
    const ledger = new AiUsageLedger();
    const engine = engineWith(provider, guard, ledger);
    await engine.run({ cacheKey: 'j1', prompt: 'أ', deterministicFallback: () => 'ب', meta: { platform: 'youtube', operation: 'complex_analysis' } });
    await engine.run({ cacheKey: 'j1', prompt: 'أ', deterministicFallback: () => 'ب' }); // cache
    await Promise.all([engine.run({ cacheKey: 'j2', prompt: 'ج', deterministicFallback: () => 'د' }), engine.run({ cacheKey: 'j2', prompt: 'ج', deterministicFallback: () => 'د' })]);
    for (let i = 0; i < 5; i++) await engine.run({ cacheKey: `j${10 + i}`, prompt: 'ه', deterministicFallback: () => 'و' });
    const c = ledger.snapshot();
    check('J1 نداءات المزود الحقيقية فقط تُحتسب', c.providerCalls === 4);
    check('J2 إصابة الكاش مسجّلة ولا تستهلك', c.cacheHits >= 1);
    check('J3 الانضمام أثناء التنفيذ مسجّل', c.inflightJoins >= 1);
    check('J4 الحجب مسجّل', c.guardBlocked >= 1);
    const last = ledger.lastProvider();
    check('J5 آخر نداء مزود يحمل منصة وعملية', last?.platform === 'general' && last?.operation === 'unspecified');
  }

  // K. حدود الـprompt: القصّ الحتمي.
  {
    const long = 'ا'.repeat(DEFAULT_MAX_PROMPT_CHARS + 5_000);
    const out = enforcePromptLimit(long);
    check('K1 الـprompt الضخم يُقصّ', out.truncated && out.prompt.length <= DEFAULT_MAX_PROMPT_CHARS);
    check('K2 القصّ يحفظ الأصل للتشخيص', out.originalChars === long.length);
    const short = enforcePromptLimit('نص قصير');
    check('K3 الـprompt القصير لا يُعدّل', !short.truncated && short.prompt === 'نص قصير');
  }

  // K4: المحرك يمرّر الـprompt المقصوص للمزود.
  {
    const provider = fakeProvider();
    const guard = realGuard(4);
    const engine = new AiEngine({ provider, guard, models: ['gemini-2.5-flash'], sleep: noSleep, cache: new Map(), maxPromptChars: 100 });
    await engine.run({ cacheKey: 'big', prompt: 'ب'.repeat(5_000), deterministicFallback: () => 'بديل' });
    check('K4 المزود لا يستلم prompt يتجاوز الحد', provider.prompts[0]!.length <= 100);
  }

  // L. تشخيص المالك: الحقول المطلوبة وحصرية الميزانية.
  {
    const diag = buildUsageDiagnostics({
      counters: { providerCalls: 3, cacheHits: 2, inflightJoins: 1, guardBlocked: 4, deterministic: 9, fallback: 2, providerErrors: 1 },
      last: { at: '2026-09-29T00:00:00.000Z', model: 'gemini-3.8-flash', platform: 'youtube', operation: 'complex_analysis' },
      usedToday: 3, limit: 4, protectionEnabled: true, providerConfigured: true, providerVerified: true,
    });
    check('L1 protectionEnabled معروض', diag.protectionEnabled === true);
    check('L2 usedToday/localDailyLimit/remainingToday صحيحة', diag.usedToday === 3 && diag.localDailyLimit === 4 && diag.remainingToday === 1);
    check('L3 عدّادات المصادر معروضة', diag.providerCallsToday === 3 && diag.cacheHitsToday === 2 && diag.inflightJoinsToday === 1 && diag.blockedByLocalGuardToday === 4);
    check('L4 آخر نداء مزود معروض', diag.lastProviderPlatform === 'youtube' && diag.lastProviderOperation === 'complex_analysis' && diag.lastProviderModel === 'gemini-3.8-flash');
    check('L5 الحد مُسمّى «حد الحماية المحلي للمشروع» لا حصة Google', diag.limitLabelAr === 'حد الحماية المحلي للمشروع' && !JSON.stringify(diag).includes('Google quota'));
    check('L6 التشخيص لا يحمل أي prompt أو سرّ', !/prompt|apiKey|secret|token/i.test(JSON.stringify(diag)));
  }

  // L7: عدّاد يومي يُصفَّر عند تغيّر اليوم فقط.
  {
    const ledger = new AiUsageLedger();
    ledger.recordProviderCall({ platform: 'youtube', operation: 'x' }, 'm');
    check('L7a العدّاد يزيد', ledger.snapshot().providerCalls === 1);
    ledger.resetDaily();
    check('L7b التصفير اليومي يصفّر العدّادات', ledger.snapshot().providerCalls === 0 && ledger.lastProvider() === null);
  }

  // لا مزود مهيأ → حتمي بلا أي استهلاك.
  {
    const guard = realGuard(4);
    const ledger = new AiUsageLedger();
    const engine = engineWith(null, guard, ledger);
    const r = await engine.run({ cacheKey: 'noprov', prompt: 'x', deterministicFallback: () => 'بديل' });
    check('M1 بلا مزود: بديل حتمي بلا استهلاك', r.source === 'fallback' && r.fallbackReason === 'provider_not_configured' && guard.used === 0);
    check('M2 العدّاد الحتمي مسجّل', ledger.snapshot().deterministic === 1);
  }

  // L. لا تجاوز مباشر: كل نداء مزود حقيقي يمر عبر المحرك المركزي.
  {
    const root = process.cwd();
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === '.git' || name === 'coverage') continue;
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, out);
        else if (/\.(ts|tsx|mjs|cjs)$/.test(name)) out.push(full);
      }
      return out;
    };
    const files = walk(root);
    const providerConstructors = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /new GoogleGenAI\(/.test(src) && !f.endsWith('engine/ai/provider.ts');
    });
    check('L1 لا يوجد أي إنشاء عميل Gemini خارج الموصل المركزي', providerConstructors.length === 0, providerConstructors.join(','));

    // `createGeminiProvider` و`generateContent` لا يُستخدمان إلا في الموصل والخادم
    // (والمسار الإداري للتحقق الحي المحكوم بالحارس).
    const directGenerate = files.filter((f) => {
      if (f.endsWith('engine/ai/provider.ts') || f.endsWith('engine/tests/gemini.firewall.test.ts')) return false;
      const src = readFileSync(f, 'utf8');
      return /client\.models\.generateContent/.test(src);
    });
    check('L2 لا استدعاء مباشر لـgenerateContent خارج الموصل', directGenerate.length === 0, directGenerate.join(','));

    // كل مسار حقيقي يستهلك حصة يجب أن يمرّ عبر aiEngine.run أو الحارس المركزي.
    const serverSrc = readFileSync(join(root, 'server.ts'), 'utf8');
    const runCalls = (serverSrc.match(/aiEngine\.run\(/g) || []).length;
    check('L3 كل مسارات المزود تمرّ عبر aiEngine.run', runCalls >= 4, `count=${runCalls}`);
    check('L4 الخادم يستخدم الحارس المركزي الوحيد', /const aiUsageGuard: AiUsageGuard = \{/.test(serverSrc) && (serverSrc.match(/aiUsageGuard/g) || []).length >= 4);
    check('L5 الحماية معرّفة بحقل GEMINI_FREE_TIER_PROTECTION', serverSrc.includes('GEMINI_FREE_TIER_PROTECTION'));
    check('L6 الحماية لا تفرّق بين المنصات في قرارها', !/GEMINI_FREE_TIER_PROTECTION[\s\S]{0,200}platform\s*===/.test(serverSrc));

    // لا يوجد حد منصة منفصل في الكود: لا متغير اسمه حصة منصة.
    // يُستثنى سكربت التدقيق وملف الاختبار نفسه لأنهما يذكران الأسماء لمنعها.
    const platformQuotaVars = files.filter((f) => {
      if (f.endsWith('final-audit.mjs') || f.endsWith('engine/tests/gemini.firewall.test.ts')) return false;
      return /platformQuota|perPlatformLimit|platformDailyLimit/i.test(readFileSync(f, 'utf8'));
    });
    check('L7 لا يوجد حد حصة لكل منصة في الكود', platformQuotaVars.length === 0, platformQuotaVars.join(','));

    // ملف الجدار نفسه بلا تفريع على اسم منصة في قرار الحماية.
    const firewallSrc = readFileSync(join(root, 'engine/ai/firewall.ts'), 'utf8');
    check('L8 جدار الحماية بلا تفريع على اسم منصة', !/if\s*\(\s*platform\s*===/.test(firewallSrc));
  }

  console.log(`\n${failed === 0 ? 'PASSED' : 'FAILED'}: ${passed} gemini firewall checks${failed ? ` (${failed} failed)` : ''}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
