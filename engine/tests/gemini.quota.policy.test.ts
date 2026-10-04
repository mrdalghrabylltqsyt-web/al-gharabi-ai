/**
 * فحوص سياسة حدّ حماية حصة Gemini المحلي (رفع متحفظ مبني على دليل).
 *
 * يثبت:
 *  - الافتراضي رُفع من 4 إلى 40 (متحفظ مقابل حصة Flash المنشورة تاريخياً ~1500 RPD).
 *  - الضبط بالبيئة يعمل، وأي قيمة تتجاوز الحد الآمن (120) تُقصّ ولا تُقبل.
 *  - القيم غير الصالحة (0/سالب/نص/غائب) تُرجع الافتراضي، فلا يمكن تعطيل الحارس.
 *  - الحارس نفسه (منطق المقارنة) يمنع الطلب رقم (limit+1) تماماً كما كان يمنعه بعد 4.
 */

import {
  resolveGeminiDailyLimit,
  inspectGeminiLimit,
  GEMINI_LIMIT_DEFAULT,
  GEMINI_LIMIT_MAX_SAFE,
  GEMINI_DAILY_LIMIT_ENV,
} from '../ai/quotaPolicy';
import { AiEngine, type AiProvider, type AiUsageGuard, type AiCacheEntry } from '../ai/engine';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

/** مزود مزيّف: يعدّ النداءات فقط، بلا شبكة. */
function fakeProvider(): AiProvider & { calls: number } {
  const state = { calls: 0 };
  return {
    name: 'fake',
    get calls() { return state.calls; },
    async generate() { state.calls += 1; return `رد-${state.calls}`; },
  };
}

/** حارس حقيقي بمنطق الحصة نفسه في الخادم (حد + عدّاد + إعادة حجز). */
function realGuard(limit: number): AiUsageGuard & { used: number } {
  let used = 0;
  return {
    get used() { return used; },
    canConsume: () => used < limit,
    consume: () => (used < limit ? (used += 1, true) : false),
    release: () => { used = Math.max(0, used - 1); },
    status: () => ({ usedToday: used, limit, remaining: Math.max(0, limit - used), enabled: true, protectionEnabled: true }),
  };
}

/** محاكاة الحارس اليومي نفسه كما في server.ts (بدون الحالة العامة). */
function guardAllows(count: number, limit: number): boolean {
  return count < limit;
}

function run(): Promise<void> {
  // 1) الافتراضي: 40 لا 4.
  check('الافتراضي = 40 (رفع متحفظ)', GEMINI_LIMIT_DEFAULT === 40, String(GEMINI_LIMIT_DEFAULT));
  check('الحد الآمن الأعلى = 120', GEMINI_LIMIT_MAX_SAFE === 120, String(GEMINI_LIMIT_MAX_SAFE));
  check('البيئة فارغة تُرجع الافتراضي', resolveGeminiDailyLimit({}) === 40);
  check('اسم متغيّر البيئة صحيح', GEMINI_DAILY_LIMIT_ENV === 'GEMINI_DAILY_LIMIT');

  // 2) الضبط بالبيئة.
  check('قيمة بيئة صالحة (60) تُطبَّق', resolveGeminiDailyLimit({ GEMINI_DAILY_LIMIT: '60' }) === 60);
  check('قيمة بيئة صالحة (1) تُطبَّق', resolveGeminiDailyLimit({ GEMINI_DAILY_LIMIT: '1' }) === 1);
  check('قيمة بيئة صالحة (120) تُطبَّق (الحد الآمن)', resolveGeminiDailyLimit({ GEMINI_DAILY_LIMIT: '120' }) === 120);

  // 3) القصّ: لا تجاوز للحد الآمن مهما كانت القيمة.
  check('قيمة 1000 تُقصّ إلى 120', resolveGeminiDailyLimit({ GEMINI_DAILY_LIMIT: '1000' }) === 120);
  check('قيمة 999999 تُقصّ إلى 120', resolveGeminiDailyLimit({ GEMINI_DAILY_LIMIT: '999999' }) === 120);
  check('لا يمكن تعطيل الحارس بقيمة ضخمة', resolveGeminiDailyLimit({ GEMINI_DAILY_LIMIT: '1000000000' }) === GEMINI_LIMIT_MAX_SAFE);

  // 4) القيم غير الصالحة تُرجع الافتراضي (لا حدّ صفري/سالب).
  check('صفر يُرجع الافتراضي', resolveGeminiDailyLimit({ GEMINI_DAILY_LIMIT: '0' }) === 40);
  check('سالب يُرجع الافتراضي', resolveGeminiDailyLimit({ GEMINI_DAILY_LIMIT: '-5' }) === 40);
  check('نص غير رقمي يُرجع الافتراضي', resolveGeminiDailyLimit({ GEMINI_DAILY_LIMIT: 'abc' }) === 40);
  check('NaN يُرجع الافتراضي', resolveGeminiDailyLimit({ GEMINI_DAILY_LIMIT: 'NaN' }) === 40);
  check('قيمة فارغة تُرجع الافتراضي', resolveGeminiDailyLimit({ GEMINI_DAILY_LIMIT: '   ' }) === 40);

  // 5) حالة التشخيص بلا سرّ.
  const def = inspectGeminiLimit({});
  check('حالة الافتراضي = default', def.state === 'default' && def.limit === 40);
  check('حالة الضبط = configured', inspectGeminiLimit({ GEMINI_DAILY_LIMIT: '50' }).state === 'configured');
  check('حالة القصّ = clamped', inspectGeminiLimit({ GEMINI_DAILY_LIMIT: '500' }).state === 'clamped' && inspectGeminiLimit({ GEMINI_DAILY_LIMIT: '500' }).limit === 120);
  check('حالة غير صالحة = invalid', inspectGeminiLimit({ GEMINI_DAILY_LIMIT: 'x' }).state === 'invalid');
  check('التشخيص يعرض القيمة الخام الرقمية فقط', inspectGeminiLimit({ GEMINI_DAILY_LIMIT: '77' }).configuredRaw === '77');

  // 6) الحارس يمنع الطلب بعد بلوغ السقف الجديد تماماً كما كان بعد 4.
  const limit = resolveGeminiDailyLimit({ GEMINI_DAILY_LIMIT: '40' });
  check('قبل السقف: الطلب رقم 40 مسموح', guardAllows(39, limit) === true);
  check('عند السقف: الطلب رقم 41 مرفوض', guardAllows(40, limit) === false);
  check('بعد السقف: مرفوض أيضاً', guardAllows(41, limit) === false);
  // نفس المنطق كان بعد 4:
  check('نفس منطق الحارس القديم (بعد 4)', guardAllows(4, 4) === false && guardAllows(3, 4) === true);
  // القصّ يبقى محكوماً:
  const clamped = resolveGeminiDailyLimit({ GEMINI_DAILY_LIMIT: '1000' });
  check('السقف المقصوص يمنع بعد 120', guardAllows(clamped, clamped) === false && guardAllows(119, clamped) === true);

  // 7) إثبات على المحرك الحقيقي: عند السقف الجديد (40) يمرّ 40 نداء مزود ويُحجب 41.
  return engineEndToEnd();
}

async function engineEndToEnd(): Promise<void> {
  const limit = resolveGeminiDailyLimit({ GEMINI_DAILY_LIMIT: '40' });
  const provider = fakeProvider();
  const guard = realGuard(limit);
  const engine = new AiEngine({ provider, guard, models: ['gemini-test-flash'], cache: new Map<string, AiCacheEntry>() });
  let served = 0;
  let blocked = 0;
  for (let i = 1; i <= limit + 3; i++) {
    const r = await engine.run({ cacheKey: `e2e:${i}`, prompt: `طلب ${i}`, deterministicFallback: () => 'بديل', meta: { platform: 'youtube', operation: 'complex_analysis' } });
    if (r.usedProvider) served += 1;
    if (r.fallbackReason === 'quota_guard') blocked += 1;
  }
  check('محرك حقيقي: 40 نداء مزود تمرّ عند السقف الجديد', served === limit, `served=${served}`);
  check('محرك حقيقي: الطلبات بعد السقف تُحجب بـquota_guard', blocked === 3, `blocked=${blocked}`);
  check('محرك حقيقي: نداءات المزود = 40 بالضبط', provider.calls === limit, `calls=${provider.calls}`);
  check('محرك حقيقي: الحارس لا يزال فعّالاً (used = السقف)', guard.used === limit, `used=${guard.used}`);

  console.log(`\n${failures.length === 0 ? 'PASSED' : 'FAILED'}: ${passed} gemini quota policy checks${failures.length ? ` (${failures.length} failed)` : ''}`);
  if (failures.length) { for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
}

run().catch((e) => { console.error(e); process.exit(1); });
