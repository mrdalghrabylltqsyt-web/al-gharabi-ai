/**
 * دقة التنبيهات (2026-10-28) — ما وصل لهاتف المالك وكان غير دقيق:
 *   1) «ذاكرة الخادم تقترب من الحد — 164 من 512 (32%) · +29.1 ميغا/ساعة (الحد بعد ~12 س)» بعد ساعتين
 *      من الإقلاع. الذاكرة الحقيقية تتأرجح 100–215 حول ~120 بلا تسرّب: الانحدار على العيّنات الخام
 *      قرأ قفزة واحدة اتجاهاً، والعيّنات لم تتجاوز 84 دقيقة.
 *   2) رابط بريد تنبيه الذاكرة «فتح صفحة الموافقات» (صفحة لا علاقة لها).
 *   3) المنصة بالاسم الخام «youtube» في تيليغرام والبريد.
 *   4) المرسل يظهر «onboarding» في Gmail.
 *   5) انقطاع يوتيوب: سبب الرفض لم يُسجَّل، وأي فشل عابر (شبكة) كان يقطع الربط فوراً.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baselineSlopePerHour, memoryPressureAlert, MEMORY_FORECAST_MIN_UPTIME_SEC } from '../ops/memoryWatch';
import { ownerAlertTargetTab, platformLabelAr, buildOwnerAlertDigest, enqueueOwnerAlert, defaultOwnerAlertState, ownerAlertKey, syncReauthAlerts } from '../notifications/ownerAlerts';
import { buildOwnerTelegramMessage } from '../notifications/ownerTelegram';
import { withSenderName } from '../notifications/senderName';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0; const failures: string[] = [];
const check = (name: string, ok: boolean, info = '') => { if (ok) passed++; else failures.push(name + (info ? ` — ${info}` : '')); };

const NOW = Date.parse('2026-10-27T19:58:00Z');
const MIN = 60000;

// 1) الذاكرة
{
  // ما قاسه Render فعلاً بعد نشر 18:46: أرضية ~110–120 مع قفزة 158 ثم 215 (النسخة الاحتياطية).
  const real = [101, 104, 110, 112, 114, 114, 150, 158, 134, 131, 135, 140, 120, 118, 119, 122, 160, 215, 117, 123].map((v, i) => ({ t: NOW - (19 - i) * 15 * MIN, v }));
  const raw = (() => { const n = real.length; const mt = real.reduce((a, s) => a + s.t, 0) / n, mv = real.reduce((a, s) => a + s.v, 0) / n; let num = 0, den = 0; for (const s of real) { num += (s.t - mt) * (s.v - mv); den += (s.t - mt) ** 2; } return (num / den) * 3600000; })();
  const base = baselineSlopePerHour(real);
  check('العيّنات الخام تُظهر «اتجاهاً» صاعداً كاذباً', raw > 5, `raw=${raw.toFixed(1)}`);
  check('★ أرضية الذاكرة الحقيقية: لا تسرّب (< 5 ميغا/ساعة)', base != null && base < 5, `base=${base}`);
  check('★ الحالة نفسها لا تُنذر', memoryPressureAlert({ rssMb: 164, limitMb: 512, slopeMbPerHour: base, nowMs: NOW, uptimeSec: 5 * 3600 }) === null);

  const leak = Array.from({ length: 30 }, (_, i) => ({ t: NOW - (29 - i) * 10 * MIN, v: 150 + i * 5 + (i % 3 === 0 ? 40 : 0) }));
  const ls = baselineSlopePerHour(leak);
  check('★ تسرّب حقيقي (الأرضية تصعد +30 ميغا/ساعة) يُكشف رغم القفزات', ls != null && ls > 25 && ls < 35, `slope=${ls}`);
  check('★ والتسرّب يُنذر بعد فترة الإحماء', memoryPressureAlert({ rssMb: 300, limitMb: 512, slopeMbPerHour: ls, nowMs: NOW, uptimeSec: 6 * 3600 })?.level === 'forecast');
  check(`★ لا تنبؤ في أول ${MEMORY_FORECAST_MIN_UPTIME_SEC / 3600} ساعات بعد الإقلاع (الصعود الطبيعي)`, memoryPressureAlert({ rssMb: 300, limitMb: 512, slopeMbPerHour: 40, nowMs: NOW, uptimeSec: 2 * 3600 }) === null);
  check('بلا زمن تشغيل لا تنبؤ (لا افتراض)', memoryPressureAlert({ rssMb: 300, limitMb: 512, slopeMbPerHour: 40, nowMs: NOW }) === null);
  check('الحدود الفعلية (70%/85%) تبقى تُنذر فوراً ولو أثناء الإحماء', memoryPressureAlert({ rssMb: 380, limitMb: 512, slopeMbPerHour: null, nowMs: NOW, uptimeSec: 60 })?.level === 'warn' && memoryPressureAlert({ rssMb: 450, limitMb: 512, slopeMbPerHour: null, nowMs: NOW, uptimeSec: 60 })?.level === 'critical');
  const short = Array.from({ length: 20 }, (_, i) => ({ t: NOW - (19 - i) * 4 * MIN, v: 100 + i * 4 }));
  check('★ مدى أقل من ساعتين = لا حكم (null)', baselineSlopePerHour(short) === null);
  const server = read('server.ts');
  check('★ الخادم يستعمل الأرضية + زمن التشغيل للإنذار وللفحص', server.includes('slopeMbPerHour: baselineSlopePerHour(memorySamples), nowMs: Date.now(), uptimeSec: Math.round(process.uptime())') && server.includes('memorySlopeMbPerHour: process.uptime() >= 3 * 3600 ? baselineSlopePerHour(memorySamples) : null'));
  check('★ العيّنات كل 5 د وتمتد 6 ساعات (كانت 84 دقيقة)', server.includes('if (!lastSample || nowMs - lastSample.t >= 5 * 60000) memorySamples.push(') && server.includes('nowMs - memorySamples[0].t > 6 * 3600000'));
}

// 2–4) الرابط واسم المنصة والمرسل
{
  const mem = enqueueOwnerAlert(defaultOwnerAlertState(), { key: ownerAlertKey('memory_pressure', null, 'w'), kind: 'memory_pressure', platform: null, title: 't', snippet: 's', at: new Date(NOW).toISOString() });
  const d = buildOwnerAlertDigest(mem, 'https://x.test');
  check('★ بريد تنبيه الذاكرة يفتح «مراقبة النظام» لا «صفحة الموافقات»', d.html.includes('?tab=system') && d.html.includes('فتح مراقبة النظام') && !d.html.includes('فتح صفحة الموافقات') && d.text.includes('فتح مراقبة النظام: https://x.test/?tab=system'));
  check('الرابط بحسب النوع', ownerAlertTargetTab(['commercial_draft']).tab === 'commercial_inbox' && ownerAlertTargetTab(['platform_reauth']).tab === 'platform_connections' && ownerAlertTargetTab(['backup_stale']).tab === 'cloud_backup' && ownerAlertTargetTab(['memory_pressure', 'commercial_draft']).tab === 'command_center');

  const re = syncReauthAlerts(defaultOwnerAlertState(), [{ platform: 'youtube', status: 'reauth_needed', reason: 'رفضت Google تجديد رمز يوتيوب (invalid_grant).' }], new Date(NOW).toISOString());
  const item = re.pending[0];
  check('★ تنبيه الانقطاع بالعربية وبسببه الحقيقي', item?.title === 'إعادة ربط يوتيوب مطلوبة' && /invalid_grant/.test(item?.snippet || ''));
  const tg = buildOwnerTelegramMessage(item, 'https://x.test');
  check('★ رسالة تيليغرام: «يوتيوب» لا «youtube»', tg.split('\n')[0].endsWith('— يوتيوب') && !/— youtube/.test(tg));
  check('بلا سبب: النص الافتراضي بالعربية', syncReauthAlerts(defaultOwnerAlertState(), [{ platform: 'instagram', status: 'reauth_needed' }], new Date(NOW).toISOString()).pending[0]?.snippet.includes('إنستغرام'));
  check('البريد يعرض اسم المنصة بالعربية', buildOwnerAlertDigest(re, null).text.includes('(يوتيوب)'));
  check('أسماء المنصات', platformLabelAr('google_business') === 'Google Business' && platformLabelAr('unknown_x') === 'unknown_x' && platformLabelAr(null) === '');

  check('★ المرسل يظهر «الغرابي AI» لا «onboarding»', withSenderName('onboarding@resend.dev') === 'الغرابي AI <onboarding@resend.dev>');
  check('اسم مضبوط مسبقاً لا يُغيَّر، والفارغ يبقى فارغاً', withSenderName('Ali <a@b.c>') === 'Ali <a@b.c>' && withSenderName('') === '' && withSenderName(null) === '');
}

// 5) يوتيوب
{
  const server = read('server.ts');
  check('★ سبب رفض Google يُسجَّل في سجل الخادم', server.includes('console.log(`[youtube-oauth] outcome=refresh_failed reason=${reasonCode.slice(0, 40)}`);'));
  check('★ الرفض الدائم فقط يقطع فوراً (invalid_grant/invalid_client/unauthorized_client)', server.includes('const YOUTUBE_PERMANENT_REFRESH_ERRORS = new Set(["invalid_grant", "invalid_client", "unauthorized_client"]);'));
  check('★ العطل العابر لا يقطع الربط حتى 3 إخفاقات متتالية', server.includes('if (!permanent && youtubeTransientRefreshFailures < 3) {') && server.indexOf('if (!permanent && youtubeTransientRefreshFailures < 3) {') < server.indexOf('platformConnections.set("youtube", { platform: "youtube", status: "reauth_needed", accountId: String(stored?.channelId'));
  check('نجاح التجديد يصفّر العدّاد والسبب', server.includes('  youtubeTransientRefreshFailures = 0;\n  youtubeLastRefreshError = null;\n  saveYouTubeCredentials({'));
  check('★ invalid_grant يشرح وضع «Testing» (انتهاء كل 7 أيام) وعلاجه', server.includes('فتطبيق Google في وضع «Testing»: من Google Cloud ← OAuth consent screen اضغط «Publish app»'));
  check('السبب يصل لتنبيه المالك', server.includes('reason: c.platform === "youtube" ? youtubeReauthReason() : null'));
}

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} alerts-accuracy checks`);
