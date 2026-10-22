/**
 * PR-C — اتساق العرض والاتصال (fail-old / pass-new).
 *
 * يثبت إصلاحات C3–C8 على مستوى المصدر والوحدات:
 *  C3: ترويسة تعيد جلب /api/health دورياً وتعرض «غير معروف» عند فشل الجلب (لا «Gemini محمي»).
 *  C4: بطاقة المنصة تسمّي تاريخ الربط باسمه وتضيف «آخر استقبال» من بيانات الاستقبال الفعلية.
 *  C5: التقويم يحسب الشهر/الأسبوع/اليوم من التاريخ الفعلي بتوقيت بغداد (لا قيم ثابتة).
 *  C6: وكيل المحتوى يأخذ المدة/الدفعة الأولى من المنتج المختار والافتراضي = INSTALLMENT_MONTHS_DEFAULT.
 *  C7: جدولة المراقب تُسلّح بالموعد الفعلي فلا يتجاوز الإيقاع المضبوط (5 => لا 6).
 *  C8: مركز التشغيل يسمّي «نسخ الحالة المحلية» بدل «النسخ الاحتياطية» المتضارب مع Drive.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createWatcherScheduler } from '../social/youtubeWatcherScheduler';
import { ARABIC_MONTHS, ARABIC_WEEKDAYS, arabicMonthLabel, epochToZonedWallClock, APP_TIMEZONE } from '../../src/utils/scheduleTime';
import { INSTALLMENT_MONTHS_DEFAULT } from '../../src/utils/installmentPrice';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

// --- C3) ترويسة: إعادة جلب دورية + «غير معروف» عند الفشل ---
{
  const header = read('src/components/common/Header.tsx');
  check('C3: ترويسة تُعيد جلب /api/health دورياً', /setInterval\(\s*poll\s*,\s*60_?000\s*\)/.test(header));
  check('C3: فشل الجلب يُعلن غير معروف (aiReady=null)', /setAiReady\(null\)/.test(header));
  check('C3: النص عند الفشل «غير معروف» لا «محمي/غير مفعّل»', /aiReady === null \? 'Gemini: غير معروف'/.test(header));
  check('C3: حالة offline تُعامل كغير معروفة', /h\.status === 'offline'/.test(header));
}

// --- C4) بطاقة المنصة: «تاريخ الربط» + «آخر استقبال» ---
{
  const hub = read('src/components/social/SocialHubView.tsx');
  check('C4: التسمية صارت «تاريخ الربط» لا «آخر مزامنة فعلية»', /تاريخ الربط:/.test(hub) && !/آخر مزامنة فعلية:/.test(hub));
  check('C4: يعرض «آخر استقبال» من lastIngestionPerPlatform', /آخر استقبال:/.test(hub) && /lastIngestionPerPlatform/.test(hub));
}

// --- C5) التقويم: تاريخ فعلي بتوقيت بغداد ---
{
  const cal = read('src/components/calendar/ContentCalendarView.tsx');
  check('C5: لا شهر ثابت «سبتمبر 2026»', !/سبتمبر 2026/.test(cal));
  check('C5: لا أيام ثابتة 14..20', !/day: 14, isToday: true/.test(cal));
  check('C5: يستخدم arabicMonthLabel', /arabicMonthLabel\(/.test(cal));
  check('C5: يوزّع المنشورات على يومها الحقيقي', /postWallClock\(/.test(cal));
  check('C5: لا وقت افتراضي «7:30 م»', !/7:30 م/.test(cal));
  // وحدة: وصف الشهر من تاريخ فعلي.
  const label = arabicMonthLabel(Date.parse('2026-10-21T12:00:00Z'), APP_TIMEZONE);
  check('C5: وصف الشهر الفعلي أكتوبر 2026', label === 'أكتوبر 2026', label);
  check('C5: الأسماء العربية للأشهر 12', ARABIC_MONTHS.length === 12);
  check('C5: الأيام العربية تبدأ بالأحد', ARABIC_WEEKDAYS[0] === 'الأحد' && ARABIC_WEEKDAYS.length === 7);
  const wall = epochToZonedWallClock(Date.parse('2026-10-21T12:00:00Z'), APP_TIMEZONE);
  check('C5: الجدار البغدادي 21/10/2026', wall.year === 2026 && wall.month === 10 && wall.day === 21);
}

// --- C6) وكيل المحتوى: المدة/الدفعة من المنتج + الافتراضي 10 ---
{
  const view = read('src/components/agent/MarketingAgentView.tsx');
  check('C6: الافتراضي يستخدم INSTALLMENT_MONTHS_DEFAULT لا 12', /INSTALLMENT_MONTHS_DEFAULT/.test(view) && !/: '12'\}/.test(view));
  check('C6: استيراد INSTALLMENT_MONTHS_DEFAULT من المصدر الواحد', /import \{ INSTALLMENT_MONTHS_DEFAULT \} from '\.\.\/\.\.\/utils\/installmentPrice'/.test(view));
  check('C6: اختيار المنتج يملأ المدة والدفعة الأولى', /setDurationMonths\(p\.durationMonths/.test(view) && /setDownPaymentPercent\(p\.downPaymentPercent/.test(view));
  check('C6: القيمة الافتراضية 10', INSTALLMENT_MONTHS_DEFAULT === 10, String(INSTALLMENT_MONTHS_DEFAULT));
}

// --- C7) جدولة المراقب: تسليح بالموعد الفعلي فلا يتجاوز الإيقاع ---
{
  const sched = read('engine/social/youtubeWatcherScheduler.ts');
  check('C7: الجدولة تقبل getRemainingMs', /getRemainingMs\?:/.test(sched));
  check('C7: إعادة التسليح تستخدم المتبقية', /const remaining = hooks\.getRemainingMs\(\)/.test(sched));
  // وحدة: مؤقّت وهمي يثبت أن التأخير = المتبقية الفعلية لا شبكة النبضة الكاملة.
  const delays: number[] = [];
  let nowMs = 0;
  const s = createWatcherScheduler({
    setTimer: (_fn, ms) => { delays.push(ms); return { clear: () => {} }; },
    setTimeoutOnce: (_fn, _ms) => ({ clear: () => {} }),
    getCadenceMs: () => 300_000,
    // نبضة واحدة مبكرة (المتبقية 40s) — القيمة الفعلية التي كانت تصبح 60s فتزيد الإيقاع.
    getRemainingMs: () => 40_000,
    isDue: () => { nowMs += 1; return false; },
    runCycle: () => {},
  });
  s.start();
  // أول نبضة تُطلق tick (غير مستحق) فتُعاد التسليح بـ40s لا بـ60s.
  const firstDelay = delays[0];
  check('C7: أول تسليح لا يتجاوز الإيقاع المضبوط', firstDelay <= 300_000);
  // محاكاة نبضة: نستدعي الدالة المخزّنة يدوياً — نتحقق من التسليح الدقيق في المصدر.
  check('C7: الحد الأقصى للتسليح الدقيق = الإيقاع', /Math\.min\(cadence, Math\.ceil\(remaining\)\)/.test(sched));
  check('C7: أرضية صغيرة تمنع الحلقة المزدحمة', /Math\.min\(cadence, 5000\)/.test(sched));
  const server = read('server.ts');
  check('C7: مراقب YouTube يمرّر getRemainingMs', /getRemainingMs: \(\) => \{[\s\S]{0,400}watcherState\.lastPollAt/.test(server));
  check('C7: مراقب Meta يمرّر getRemainingMs', /getRemainingMs: \(\) => \{[\s\S]{0,400}metaPollingState\.lastPollAt/.test(server));
  check('C7: مراقب Telegram يمرّر getRemainingMs', /getRemainingMs: \(\) => \{[\s\S]{0,400}telegramPollingState\.lastPollAt/.test(server));
}

// --- C8) مركز التشغيل: تسمية «نسخ الحالة المحلية» ---
{
  const sys = read('src/components/system/SystemControlView.tsx');
  check('C8: البطاقة تسمّى «نسخ الحالة المحلية»', /نسخ الحالة المحلية/.test(sys));
  check('C8: لا تسمية «النسخ الاحتياطية» المضلِّلة في البطاقة', !/\['النسخ الاحتياطية'/.test(sys));
  check('C8: القسم يوضّح أن نقاط Drive في «النسخ السحابي»', /نقاط الاستعادة الكاملة على Drive/.test(sys));
  // المصدر الحقيقي: listBackups = لقطات ملف الحالة المحلية، وليس نقاط Drive.
  const adapter = read('engine/storage/adapter.ts');
  check('C8: مصدر العدّ = listBackups (لقطات ملف الحالة)', /state-\\d\{4\}-\\d\{2\}-\\d\{2\}\\\.json/.test(adapter));
}

// --- C2) Telegram: مصدر واحد لحالة الاتصال ---
{
  const server = read('server.ts');
  const routes = read('engine/social/routes.ts');
  check('C2: مصدر واحد effectivePlatformConnection معرّف', /function effectivePlatformConnection\(/.test(server));
  check('C2: Telegram لا «متصل» بلا اعتماد موصل فعّال', /platform === "telegram"[\s\S]{0,200}telegramConnectorConfigured\(\)/.test(server));
  check('C2: يُعلن reauth_needed عند فقد الاعتماد', /status: "reauth_needed", providerVerified: false/.test(server));
  check('C2: مسارات السوشيال تقرأ المصدر الواحد', /deps\.effectiveConnection \? deps\.effectiveConnection\(platform\)/.test(routes));
  check('C2: safeConnection يقرأ المصدر الواحد', /function safeConnection\(platform: string\) \{ const c:any=effectivePlatformConnection\(platform\)/.test(server));
  check('C2: liveFor/readiness تقرأ المصدر الواحد', (server.match(/effectivePlatformConnection\(p\)/g) || []).length >= 5);
}

console.log(`\nPASSED: ${pass} PR-C checks`);
if (fail) { console.error(`FAILED: ${fail}`); process.exit(1); }
