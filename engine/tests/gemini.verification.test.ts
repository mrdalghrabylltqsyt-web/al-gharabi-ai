/**
 * اختبار فحص اتصال Gemini من الواجهة ومسار التحقق الحي — حتمي وبلا شبكة.
 *
 * يثبت الشروط الحرجة:
 * - البرهان يبدأ من النموذج الإنتاجي، ويجوز أن يثبت النجاح بمرشح GA شقيق عند
 *   ضغط المزود (503 «high demand») — بلا أي نجاح وهمي: الموديل المخدوم يُذكر صراحة.
 * - النجاح مشروط بـ verified === true، لا بـ HTTP 200 وحده.
 * - لا كشف أي مفتاح في أي رسالة عرض.
 * - مهلة صريحة تُلغي الطلب ولا تعاود الإرسال.
 * - الواجهة: الزر محصور بالمالك، ولا يُشغَّل تلقائياً عند تحميل الصفحة.
 *
 * لا يستخدم أي مفتاح حقيقي: لا يوجد أي مفتاح في هذا الملف من الأصل.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildGeminiSuccessText,
  interpretGeminiVerification,
  createTimeoutSignal,
  GEMINI_VERIFY_TIMEOUT_MS,
} from '../../src/services/geminiVerification';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const SERVER = readFileSync('server.ts', 'utf8');
const API = readFileSync(join('src', 'services', 'api.ts'), 'utf8');
const VIEW = readFileSync(join('src', 'components', 'system', 'SystemControlView.tsx'), 'utf8');
const secretFree = (s: string) => !/AIzaSy[A-Za-z0-9_\-]{5,}/.test(s) && !/api[_-]?key\s*=/i.test(s);

async function run(): Promise<void> {
  group('1) عرض النجاح — اسم النموذج المتحقق منه');
  check('نجاح بلا موديل يعرض رسالة متصلة عامة', buildGeminiSuccessText(null, null) === 'Gemini متصل.');
  check('نجاح يعرض اسم النموذج المتحقق منه', buildGeminiSuccessText('gemini-x.y-flash', 120).includes('gemini-x.y-flash'));
  check('نجاح يعرض زمن الاستجابة إن وُجد', buildGeminiSuccessText('m', 250).includes('250ms'));
  check('عرض النجاح لا يحمل أي سر', secretFree(buildGeminiSuccessText('m', 1)));
  // عند ضغط الموديل الإنتاجي يُعرض الموديل العامل فعلاً صراحةً بلا ادعاء.
  const siblingText = buildGeminiSuccessText('gemini-3.6-flash', 90, false);
  check('نجاح بمرشح شقيق يذكر السبب والموديل العامل', siblingText.includes('ضغط') && siblingText.includes('gemini-3.6-flash'));
  check('عرض المرشح الشقيق لا يحمل أي سر', secretFree(siblingText));
  const siblingOutcome = interpretGeminiVerification({ success: true, verified: true, model: 'gemini-3.6-flash', usedProduction: false, latencyMs: 90 });
  check('نتيجة المرشح الشقيق نجاح مع اسم الموديل العامل', siblingOutcome.ok === true && siblingOutcome.model === 'gemini-3.6-flash' && siblingOutcome.message.includes('ضغط'));

  group('2) تفسير استجابة الخادم — النجاح لا يُستنتج من HTTP 200 وحده');
  const ok = interpretGeminiVerification({ success: true, verified: true, state: 'ok', model: 'gemini-x.y-flash', latencyMs: 90 });
  check('success+verified => نجاح', ok.ok === true && ok.model === 'gemini-x.y-flash');
  const notVerified = interpretGeminiVerification({ success: false, verified: false, state: 'failed', detail: 'فشل التحقق من الموديل الإنتاجي.' });
  check('success:false => فشل', notVerified.ok === false);
  const verifiedFalse = interpretGeminiVerification({ success: true, verified: false });
  check('verified:false حتى مع success:true => فشل (لا نجاح بديل)', verifiedFalse.ok === false);
  check('غياب verified => فشل', interpretGeminiVerification({ success: true }).ok === false);
  check('استجابة فارغة => فشل آمن', interpretGeminiVerification(null).ok === false);

  group('3) رسالة الفشل — آمنة ومختصرة وبلا سر');
  const withSafe = interpretGeminiVerification({ success: false, verified: false, safeMessage: 'مزود الذكاء الاصطناعي مشغول حالياً...' });
  check('تُستخدم رسالة الخادم الآمنة عند وجودها', withSafe.message.includes('مشغول حالياً'));
  const withDetail = interpretGeminiVerification({ success: false, verified: false, detail: 'فشل التحقق من الموديل الإنتاجي.' });
  check('تُستخدم التفصيل غير السرّي عند غياب الرسالة الآمنة', withDetail.message.includes('فشل التحقق'));
  const fallback = interpretGeminiVerification({ success: false });
  check('فشل بلا تفصيل يعرض رسالة عامة', fallback.message.includes('لم يتم التحقق'));
  check('رسائل الفشل لا تحمل أي مفتاح', secretFree(withSafe.message + withDetail.message + fallback.message));
  check('فشل بلا توجيه => hint = null', fallback.hint === null);

  group('3b) التوجيه التشخيصي الأمين — يُميَّن السبب الحقيقي ولا يلوم المفتاح دائماً');
  const rateLimited = interpretGeminiVerification({
    success: false, verified: false, state: 'failed', model: 'gemini-x.y-flash',
    errorKind: 'rate_limited', detail: 'فشل التحقق من الموديل الإنتاجي: rate_limited/429.',
    hint: 'تجاوزت حصة الحساب لدى المزود (429): السبب حصة المزود/الفوترة، وليس الكود ولا المفتاح.',
  });
  check('حصة المزود (429) تُمرّر التوجيه للأمام', rateLimited.hint !== null && rateLimited.hint.includes('حصة الحساب'));
  check('توجيه الحصة لا يلوم المفتاح', !rateLimited.hint!.includes('GEMINI_API_KEY'));
  const overloaded = interpretGeminiVerification({
    success: false, verified: false, state: 'failed',
    errorKind: 'unavailable', detail: '...unavailable/503',
    hint: 'الموديل الإنتاجي مشغول لدى المزود (503/504) ولا علاقة للمفتاح أو الكود بذلك.',
  });
  check('عطل المزود (503) لا يلوم المفتاح', overloaded.hint !== null && !overloaded.hint!.includes('GEMINI_API_KEY'));
  check('توجيه عطل المزود يذكر الحالة الصحيحة', overloaded.hint!.includes('503'));
  const authFail = interpretGeminiVerification({
    success: false, verified: false, state: 'failed',
    errorKind: 'auth', hint: 'المفتاح مرفوض من المزود: راجع صلاحية GEMINI_API_KEY في بيئة الخادم (لا تُرسل المفتاح في المحادثة).',
  });
  check('خطأ المصادقة وحده يوجّه لمراجعة المفتاح', authFail.hint !== null && authFail.hint!.includes('GEMINI_API_KEY'));
  check('توجيه الفشل لا يحمل أي سر', secretFree(rateLimited.hint + overloaded.hint + authFail.hint));
  check('نجاح لا يحمل توجيهاً', interpretGeminiVerification({ success: true, verified: true, model: 'm' }).hint === null);

  group('4) مهلة صريحة — لا إعادة إرسال');
  check('مهلة الواجهة معرّفة وإيجابية', Number.isFinite(GEMINI_VERIFY_TIMEOUT_MS) && GEMINI_VERIFY_TIMEOUT_MS > 0);
  const t = createTimeoutSignal(30);
  check('الإشارة غير مُلغاة قبل المهلة', t.signal.aborted === false);
  await new Promise((r) => setTimeout(r, 80));
  check('الإشارة تُلغى عند تجاوز المهلة', t.signal.aborted === true);
  t.clear();
  const t2 = createTimeoutSignal(30);
  t2.clear();
  await new Promise((r) => setTimeout(r, 80));
  check('التنظيف قبل المهلة يمنع الإلغاء المتأخر', t2.signal.aborted === false);

  group('5) الخادم: التحقق يجرّب الموديل الإنتاجي أولاً ثم مرشحات GA عند ضغط المزود');
  const routeStart = SERVER.indexOf('app.post("/api/ai/verify-provider"');
  const routeEnd = SERVER.indexOf('// Health endpoint', routeStart);
  const route = SERVER.slice(routeStart, routeEnd > 0 ? routeEnd : routeStart + 6000);
  check('المسار مصادق عليه لمالك النظام فقط', SERVER.includes('app.post("/api/ai/verify-provider", requireOwner'));
  check('التحقق يبدأ من PRODUCTION_MODEL', route.includes('const model = PRODUCTION_MODEL') && route.includes('candidates.unshift(model)'));
  // سلوك مقصود (2026-09-23): ضغط مزود (503 «high demand») على موديل واحد لا يعني
  // تعطل المزود؛ المحرك وقت التشغيل يتجاوز لمرشح GA شقيق، فيجب أن يحاكيه الفحص
  // وإلا أعلن تعطلاً بينما النظام يعمل فعلاً.
  check('يجرّب مرشحي GA بترتيب عند فشل الضغط', route.includes('resolveModelCandidates') && route.includes('for (const candidate of candidates)'));
  const routeCode = route.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
  check('لا retry أسّي صريح في مسار التحقق', !/withRetry|maxAttempts/i.test(routeCode));
  check('المسار لا يعيد 503 أبداً', !route.includes('status(503)') && !route.includes('res.status(503'));
  check('استجابة النجاح تحمل الموديل المخدوم فعلاً', route.includes('model: servedModel') && route.includes('usedProduction'));
  check('يُميَّز النجاح عبر مرشح شقيق عن نجاح الموديل الإنتاجي', route.includes('usedProduction = servedModel === model'));
  check('استجابة الفشل تدرج المرشحين المُجرَّبين', route.includes('attempted: tried') && route.includes('candidatesTried: tried.length'));
  // المهلة الإدارية: ثابتة 30 ثانية لمسار التحقق، وغير مشتقة من AI_TIMEOUT_MS.
  check('مهلة التحقق الحي ثابتة 30 ثانية', SERVER.includes('const LIVE_VERIFY_TIMEOUT_MS = 30_000'));
  check('مسار التحقق يستخدم مهلة 30s لا AI_TIMEOUT_MS', route.includes('LIVE_VERIFY_TIMEOUT_MS') && !route.includes('AI_TIMEOUT_MS'));
  // أي طريقة غير POST تُرفض 405 صريحة قبل المصادقة، فلا يظهر مسار الفحص عبر GET.
  check('طريقة غير POST على مسار التحقق => 405', /app\.all\("\/api\/ai\/verify-provider"[\s\S]{0,200}?status\(405\)/.test(SERVER) && !SERVER.includes('app.get("/api/ai/verify-provider"'));
  check('ميَزانية مهلة موحّدة لكل المرشحين (لا تضاعف)', route.includes('const deadline = started + LIVE_VERIFY_TIMEOUT_MS'));
  check('لا تكرار للمرشح الإنتاجي عند بنائه', route.includes('if (!candidates.includes(model)) candidates.unshift(model)'));

  group('5b) التشخيص الأمين: عطل المزود لا يُنسب إلى المفتاح');
  // كان الفشل يعرض دائماً «راجع صلاحية GEMINI_API_KEY» حتى مع 503/429.
  check('يوجد مُوجِّه تشخيصي حسب فئة الخطأ', SERVER.includes('function verificationHintFor'));
  check('فئة 429 تُوجَّه للحصة لا للمفتاح', /case 'rate_limited':[\s\S]{0,200}?حصة/.test(SERVER));
  check('فئة 503 تُوجَّه لعطل المزود لا للمفتاح', /case 'unavailable':[\s\S]{0,220}?مشغول/.test(SERVER));
  check('فئة المصادقة وحدها توجّه للمفتاح', /case 'auth':[\s\S]{0,160}?GEMINI_API_KEY/.test(SERVER));
  check('التوجيه القديم الملوم للمفتاح دائماً أُزيل', !SERVER.includes("hint: 'راجع صلاحية GEMINI_API_KEY في بيئة الخادم (لا تُرسل المفتاح في المحادثة).'") || (SERVER.match(/راجع صلاحية GEMINI_API_KEY/g) || []).length === 1);
  check('الاستجابة تحمل errorKind للتشخيص', route.includes('errorKind: info.kind'));
  check('الاستجابة تحمل hint المحسوب', route.includes('hint: verificationHintFor(info)') || route.includes('hint: aiLiveVerification.hint'));
  check('/api/health يعرض فئة الفشل وتوجيهه', SERVER.includes('verificationErrorKind: aiLiveVerification.errorKind') && SERVER.includes('verificationHint: aiLiveVerification.hint'));

  group('6) خدمة الواجهة: طلب واحد بمهلة بلا retry');
  const svcStart = API.indexOf('async verifyGeminiProvider');
  const svc = API.slice(svcStart, svcStart + 1600);
  check('تستدعي المسار الموجود فقط', svc.includes("'/api/ai/verify-provider'") && svc.includes("method: 'POST'"));
  check('تستخدم مهلة صريحة', svc.includes('createTimeoutSignal(GEMINI_VERIFY_TIMEOUT_MS)'));
  check('تُصنّف النتيجة عبر منطق خالص', svc.includes('interpretGeminiVerification(data)'));
  check('لا تحتوي أي إعادة محاولة تلقائية', !/for\s*\(/.test(svc) && !svc.includes('retry'));
  check('لا تتعامل مع أي مفتاح Gemini', !/GEMINI_API_KEY|VITE_GEMINI|AIza/.test(svc));

  group('7) الواجهة: زر المالك اليدوي فقط');
  check('يوجد زر باسم «اختبار اتصال Gemini»', VIEW.includes('اختبار اتصال Gemini'));
  check('الزر داخل قسم فحص مزود Gemini لا Google Sign-In', VIEW.includes('فحص مزود Gemini') && VIEW.includes('منفصل تماماً عن Google Sign-In'));
  check('الواجهة تحصر المركز بالمالك', VIEW.includes("currentUser?.role!=='owner'"));
  check('الزر لا يظهر إلا للمالك', VIEW.indexOf("currentUser?.role!=='owner'") < VIEW.indexOf('اختبار اتصال Gemini'));
  check('حالة تحميل واضحة تمنع الضغط المتكرر', VIEW.includes('disabled={geminiTesting}') && VIEW.includes('جارٍ اختبار الاتصال'));
  check('لا تشغيل تلقائي عند تحميل الصفحة (useEffect لا يستدعي الفحص)', !/useEffect\([^)]*verifyGeminiProvider/.test(VIEW) && !/useEffect\([^)]*runGeminiTest/.test(VIEW));
  check('استدعاء الفحص داخل onClick فقط', VIEW.includes('onClick={()=>void runGeminiTest()}'));
  check('لا عرض لأي مفتاح في الواجهة', secretFree(VIEW));

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} gemini verification checks`);
  }
}

run().catch((err) => {
  console.error('Gemini verification harness crashed:', err);
  process.exit(1);
});
