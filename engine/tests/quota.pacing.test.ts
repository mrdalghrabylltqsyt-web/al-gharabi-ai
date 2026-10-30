/**
 * توزيع الحصص المجانية على مدتها (قاعدة المالك 2026-10-29):
 * كل حصة تُستهلك على إيقاع مدتها — لا تنفد مبكراً ولا تُبطَّأ وهي تحت إيقاعها — والمهندس المشرف
 * نفسه لا يوقظ الخادم (ساعات Render) ولا القاعدة (حوسبة Neon) بفحوصه.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { judgePace, paceAllowedPercent, periodElapsed, periodBounds, pacedAllows, catchUpInMs, pacificOffsetMin, PACE_POLICY } from '../ops/quotaPacing';
import { resolveUsagePressure } from '../ops/usagePressure';
import { EDGE_POLICY } from '../ops/edgeProbe';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0; const failures: string[] = [];
const check = (name: string, ok: boolean, info = '') => { if (ok) passed++; else failures.push(name + (info ? ` — ${info}` : '')); };
const H = 3600000;

// 1) المدد
{
  const t = Date.parse('2026-10-16T00:00:00Z');
  check('نصف الشهر تقريباً', Math.abs(periodElapsed(t, 'month_utc') - 15 / 31) < 1e-9);
  check('منتصف يوم UTC', periodElapsed(Date.parse('2026-10-16T12:00:00Z'), 'day_utc') === 0.5);
  check('توقيت المحيط الهادئ صيفاً/شتاءً', pacificOffsetMin(Date.parse('2026-07-01T00:00:00Z')) === -420 && pacificOffsetMin(Date.parse('2026-12-01T00:00:00Z')) === -480);
  const b = periodBounds(Date.parse('2026-10-16T08:00:00Z'), 'day_pacific');
  check('★ يوم حصص Google يبدأ منتصف ليل المحيط الهادئ (07:00 UTC صيفاً)', new Date(b.start).toISOString() === '2026-10-16T07:00:00.000Z' && b.end - b.start === 24 * H);
  check('قبل منتصف ليل المحيط الهادئ = اليوم السابق', new Date(periodBounds(Date.parse('2026-10-16T06:59:00Z'), 'day_pacific').start).toISOString() === '2026-10-15T07:00:00.000Z');
}

// 2) خط الإيقاع
{
  const morning = Date.parse('2026-10-16T03:00:00Z'); // 3 ساعات من يوم UTC
  check('المسموح بعد 3 ساعات = 12.5% + هامش 8%×(1−0.125) = 19.5%', paceAllowedPercent(morning, 'day_utc') === 19.5);
  check('آخر اليوم يقترب من 100% ولا يتجاوزها', paceAllowedPercent(Date.parse('2026-10-16T23:59:00Z'), 'day_utc') >= 99.9 && paceAllowedPercent(Date.parse('2026-10-16T23:59:59Z'), 'day_utc') <= 100);
  const early = judgePace(60, 'day_utc', morning);
  check('★ 60% من الحصة اليومية في 3 ساعات = سبق كثيراً ⇒ حرج (لا يأكل اليوم كله صباحاً)', early.state === 'far_ahead' && early.level === 'critical', JSON.stringify(early));
  check('★ 25% بعد 3 ساعات = سبق قليلاً ⇒ مراقبة (أبطأ حتى يعود لخطه)', judgePace(25, 'day_utc', morning).level === 'watch');
  check('★ 15% بعد 3 ساعات = على الإيقاع ⇒ الإيقاع الكامل', judgePace(15, 'day_utc', morning).level === 'normal');
  const late = judgePace(85, 'month_utc', Date.parse('2026-10-31T12:00:00Z'));
  check('★ 85% في آخر يوم من الشهر = تحت الإيقاع ⇒ بلا إبطاء (الحصة تُستعمل حتى أقصاها)', late.level === 'normal', JSON.stringify(late));
  check('★ 95% = حرج مهما كان الوقت (لا تجاوز للسقف)', judgePace(95, 'month_utc', Date.parse('2026-10-31T23:00:00Z')).state === 'exhausted');
  check('السعة: 80 مراقبة و95 حرج', judgePace(81, 'capacity', 0).level === 'watch' && judgePace(96, 'capacity', 0).level === 'critical' && judgePace(50, 'capacity', 0).level === 'normal');
  check('غير مقيس لا يُعلن ضغطاً', judgePace(null, 'day_utc', morning).level === 'normal');
  check('تاريخ التجدد', judgePace(10, 'day_utc', morning).resetsAt === Date.parse('2026-10-17T00:00:00Z'));
}

// 3) العمل الخلفي يأخذ حصته على امتداد المدة
{
  const t = Date.parse('2026-10-16T06:00:00Z'); // ربع يوم UTC ⇒ المسموح 33%
  check('★ حصة 250 طلباً: بعد 6 ساعات (31%) يُسمح حتى 77 للخلفي', pacedAllows(76, 250, 1, 'day_utc', t) && !pacedAllows(77, 250, 1, 'day_utc', t), String(paceAllowedPercent(t, 'day_utc')));
  check('ميزانية صفرية = لا', !pacedAllows(0, 0, 1, 'day_utc', t));
  // محاكاة يوم كامل: طلب خلفي كل دقيقة بلا توقف — الحارس يوزّعه فلا ينفد قبل نهاية اليوم
  let used = 0; let lastAllowedHour = -1; const limit = 250;
  const start = Date.parse('2026-10-16T00:00:00Z');
  for (let m = 0; m < 24 * 60; m++) { const now = start + m * 60000; if (pacedAllows(used, limit, 1, 'day_utc', now)) { used += 1; lastAllowedHour = Math.floor(m / 60); } }
  check('★ يوم كامل من الطلبات المتواصلة: يُستعمل كل الحصة تقريباً ولا تنفد قبل آخر ساعة', used >= limit - 1 && used <= limit && lastAllowedHour === 23, `used=${used} lastHour=${lastAllowedHour}`);
  let usedByNoon = 0; for (let m = 0; m < 12 * 60; m++) if (pacedAllows(usedByNoon, limit, 1, 'day_utc', start + m * 60000)) usedByNoon += 1;
  check('★ حتى منتصف اليوم ≈ نصف الحصة + الهامش فقط', usedByNoon <= Math.ceil(limit * (0.5 + PACE_POLICY.burst.day)) && usedByNoon >= Math.floor(limit * 0.5), String(usedByNoon));
  check('وقت اللحاق موجب حين يسبق الإيقاع', catchUpInMs(60, 'day_utc', Date.parse('2026-10-16T03:00:00Z')) > 6 * H);
}

// 4) الحارس العام: الإيقاع يحكم حين تحمل الإشارات مدتها
{
  const t = Date.parse('2026-10-16T00:00:00Z');
  const ahead = resolveUsagePressure([{ provider: 'render', usedPercent: 60, period: 'month_utc' }], { nowMs: t });
  check('★ Render 60% منتصف الشهر ⇒ مراقبة (تُضاعف الفواصل)', ahead.level === 'watch' && ahead.slowDown && !ahead.deferNonCritical && ahead.pace?.length === 1);
  const far = resolveUsagePressure([{ provider: 'neonCompute', usedPercent: 75, period: 'month_utc' }], { nowMs: t });
  check('★ حوسبة Neon 75% منتصف الشهر ⇒ حرج: يُؤجَّل الثقيل والاستقبال مستمر', far.level === 'critical' && far.deferNonCritical && far.deferIngest === false);
  const fine = resolveUsagePressure([{ provider: 'render', usedPercent: 86, period: 'month_utc' }, { provider: 'drive', usedPercent: 40, period: 'capacity' }], { nowMs: Date.parse('2026-10-31T06:00:00Z') });
  check('★ 86% آخر الشهر ⇒ عادي (كانت العتبة الثابتة 80% تبطئ المشروع بلا داعٍ)', fine.level === 'normal' && !fine.slowDown);
  check('بلا مدة: السلوك السابق كما هو (توافق)', resolveUsagePressure([{ provider: 'x', usedPercent: 85 }]).level === 'watch' && resolveUsagePressure([{ provider: 'x', usedPercent: 96 }]).level === 'critical');
  check('الأشد يحكم', resolveUsagePressure([{ provider: 'a', usedPercent: 10, period: 'day_utc' }, { provider: 'b', usedPercent: 97, period: 'capacity' }], { nowMs: t }).provider === 'b');
}

// 5) الخادم موصول فعلاً
{
  const srv = read('server.ts');
  check('★ كل إشارة حصة تحمل مدتها، والحارس يُحسم بالوقت', srv.includes("{ usedPercent: neon.usedPercent, provider: 'neon', period: 'month_utc' }") && srv.includes("provider: 'driveApi', period: 'day_pacific'") && srv.includes("provider: 'drive', period: 'capacity'") && srv.includes('return resolveUsagePressure(usagePressureSignals(), { nowMs: Date.now() });'));
  check('★ حوسبة Neon (100 CU-ساعة) صارت إشارة ضغط', srv.includes("provider: 'neonCompute', period: 'month_utc'"));
  check('★ Gemini: العمل الخلفي موزّع على اليوم وطلب المالك حتى السقف', srv.includes('canConsume: (meta) => canUseGemini() && geminiBackgroundPaced(meta)') && srv.includes('const GEMINI_BACKGROUND_OPERATIONS = new Set(["comment_reply", "message_reply", "meta_clarification", "message_classification", "job_execute"])') && !srv.match(/GEMINI_BACKGROUND_OPERATIONS = new Set\([^)]*agent_/));
  check('★ محرك الذكاء يمرّر نوع العملية للحارس', read('engine/ai/engine.ts').includes('this.guard.canConsume(meta)'));
  check('★ قراءات YouTube موزّعة على يوم المحيط الهادئ مع حفظ احتياطي النشر', srv.includes('!pacedAllows(quotaSnap.unitsUsed, readBudget, unitsPerPoll, "day_pacific", now)') && srv.includes('gate: "QUOTA_PACED"') && srv.includes('const readBudget = Math.max(0, YOUTUBE_DAILY_QUOTA - YOUTUBE_QUOTA_PUBLISH_RESERVE_UNITS);'));
  check('★ المهندس لا يوقظ Render بفحصه الخارجي (زوار حقيقيون خلال 10 د فقط)', srv.includes('Date.now() - lastExternalTrafficAt > EDGE_POLICY.selfWakeGuardMs') && srv.includes('req.headers["user-agent"] !== EDGE_PROBE_UA') && EDGE_POLICY.selfWakeGuardMs <= 10 * 60000 && EDGE_POLICY.intervalMs >= 30 * 60000);
  check('★ المهندس لا يوقظ Neon بقياس الحجم (يركب على كتابة حقيقية حديثة)', srv.includes('Date.now() - lastStateWriteAt > 3 * 60000) { storageSizePending = true; return; }') && srv.includes('lastStateWriteAt = Date.now();'));
  check('★ حفظ الحارس نادر: فوراً عند تغيّر الحظر فقط، وإلا كل 6 س وبالكتابة المدموجة', srv.includes('persistMinMs: 6 * 3600000') && srv.includes('writeWatcherStateCoalesced(STORAGE_KEY_GUARDIAN, snap, force || blocksChanged)'));
  check('★ الفحص اليدوي من المالك يتجاوز الحارسين (قرار صريح)', srv.includes('runEdgeRound({ manual: true })') && srv.includes('runStorageSize({ manual: true })'));
  check('★ غرفة المهندس تعرض توزيع كل حصة', srv.includes('pacing: quotaPacingView(),') && read('src/components/live/GuardianPanel.tsx').includes('الحصص المجانية — موزّعة على مدتها'));
}

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} quota-pacing checks`);
