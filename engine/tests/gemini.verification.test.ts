/**
 * اختبار فحص اتصال Gemini من الواجهة ومسار التحقق الحي — حتمي وبلا شبكة.
 *
 * يثبت الشروط الحرجة:
 * - البرهان يخصّ النموذج الإنتاجي فقط، ولا يوجد failover صامت في مسار التحقق.
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

  group('5) الخادم: التحقق محصور بموديل الإنتاج بلا failover');
  const routeStart = SERVER.indexOf('app.post("/api/ai/verify-provider"');
  const routeEnd = SERVER.indexOf('// Health endpoint', routeStart);
  const route = SERVER.slice(routeStart, routeEnd > 0 ? routeEnd : routeStart + 6000);
  check('المسار مصادق عليه لمالك النظام فقط', SERVER.includes('app.post("/api/ai/verify-provider", requireOwner'));
  check('التحقق يستخدم PRODUCTION_MODEL حصراً', route.includes('const model = PRODUCTION_MODEL'));
  check('لا حلقة على مرشحين بدلاء داخل مسار التحقق (لا failover)', !route.includes('for (const model of candidates)') && !route.includes('resolveModelCandidates'));
  const routeCode = route.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
  check('لا يوجد cache/retry صريح في مسار التحقق', !/retry/i.test(routeCode) && !routeCode.includes('aiEngine'));
  check('المسار لا يعيد 503 أبداً', !route.includes('status(503)') && !route.includes('res.status(503'));
  check('استجابة النجاح تحمل model و candidatesTried=1', route.includes('candidatesTried: 1'));

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
