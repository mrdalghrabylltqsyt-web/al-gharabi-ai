/**
 * الإنذار الفوري للمالك (2026-10-27):
 *   1) ربط Telegram المالك بنقرة — بلا إعدادات Render: رمز لمرة واحدة يُرسل للبوت من المحادثة
 *      الخاصة. على الخادم الحي كان «تنبيه Telegram الفوري غير مكتمل» (OWNER_TELEGRAM_CHAT_ID ناقص)،
 *      فالحالات الحرجة لا تصل هاتف المالك.
 *   2) إنذار ذاكرة الخادم: قِيس صعودها من 101 إلى 207 ميغا خلال 19 ساعة على الخطة المجانية (حد 512).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  defaultOwnerTelegramPairing, normalizeOwnerTelegramPairing, newPairingCode, hashPairingCode, startOwnerTelegramPairing,
  extractPairingCode, completeOwnerTelegramPairing, unpairOwnerTelegram, effectiveOwnerChat, pairingOutcomeText,
  OWNER_TG_PAIRING_TTL_MS, OWNER_TG_PAIRING_MAX_ATTEMPTS, OWNER_TG_PAIRING_CODE_LEN,
} from '../notifications/ownerTelegramPairing';
import { memoryPressureAlert, MEMORY_LEAK_HORIZON_HOURS } from '../ops/memoryWatch';
import { OWNER_ALERT_KIND_LABELS_AR, normalizeOwnerAlertState, ownerAlertCountsByKind, enqueueOwnerAlert, defaultOwnerAlertState, ownerAlertKey, buildOwnerAlertDigest } from '../notifications/ownerAlerts';
import { buildOwnerTelegramMessage } from '../notifications/ownerTelegram';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0; const failures: string[] = [];
const check = (name: string, ok: boolean, info = '') => { if (ok) passed++; else failures.push(name + (info ? ` — ${info}` : '')); };

const SECRET = 'test-session-secret-0123456789';
const NOW = Date.parse('2026-10-27T15:00:00Z');
const OWNER = '123456789';

// 1) ربط Telegram بالرمز
{
  const code = newPairingCode((n) => randomBytes(n));
  check('★ رمز من 8 أحرف بلا أحرف ملتبسة (0/O/1/I/L)', code.length === OWNER_TG_PAIRING_CODE_LEN && /^[A-HJKMNP-Z2-9]+$/.test(code), code);
  const codes = new Set(Array.from({ length: 200 }, () => newPairingCode((n) => randomBytes(n))));
  check('الرموز عشوائية (لا تكرار في 200)', codes.size === 200);

  let st = startOwnerTelegramPairing(defaultOwnerTelegramPairing(), code, SECRET, NOW);
  check('★ الرمز لا يُخزَّن نصاً — بصمته فقط', st.pending !== null && st.pending.codeHash === hashPairingCode(code, SECRET) && !JSON.stringify(st).includes(code));
  check('★ الحالة المحفوظة بلا سرّ ولا رمز وتصمد عند التحميل', JSON.stringify(normalizeOwnerTelegramPairing(JSON.parse(JSON.stringify(st)))) === JSON.stringify(st));

  check('★ رابط البوت العميق: /start CODE', extractPairingCode(`/start ${code}`) === code);
  check('أو /link CODE (وبصيغة @البوت)', extractPairingCode(`/link ${code.toLowerCase()}`) === code && extractPairingCode(`/link@GharabiBot ${code}`) === code);
  check('★ /start وحده أو نص زبون عادي ليس محاولة ربط (يبقى رسالة زبون)', extractPairingCode('/start') === null && extractPairingCode('بكم الثلاجة؟') === null && extractPairingCode(`ابي ${code}`) === null);

  const grp = completeOwnerTelegramPairing(st, { code, chatId: '-1001234567890' }, SECRET, NOW + 1000);
  check('★ مجموعة/قناة مرفوضة (رقم سالب) — لا تصل بيانات زبائن لمجموعة', grp.outcome === 'not_private' && grp.state.chatId === null);

  let s2 = st;
  for (let i = 1; i < OWNER_TG_PAIRING_MAX_ATTEMPTS; i++) s2 = completeOwnerTelegramPairing(s2, { code: 'WRONG234', chatId: OWNER }, SECRET, NOW).state;
  check('رمز خاطئ يُعدّ محاولة', s2.pending?.attempts === OWNER_TG_PAIRING_MAX_ATTEMPTS - 1 && s2.chatId === null);
  const locked = completeOwnerTelegramPairing(s2, { code: 'WRONG234', chatId: OWNER }, SECRET, NOW);
  check(`★ ${OWNER_TG_PAIRING_MAX_ATTEMPTS} محاولات خاطئة تُلغي الرمز (لا تخمين)`, locked.outcome === 'locked' && locked.state.pending === null);
  check('بعد الإلغاء الرمز الصحيح لا يعمل', completeOwnerTelegramPairing(locked.state, { code, chatId: OWNER }, SECRET, NOW).outcome === 'no_pending');

  const late = completeOwnerTelegramPairing(st, { code, chatId: OWNER }, SECRET, NOW + OWNER_TG_PAIRING_TTL_MS + 1);
  check('★ انتهاء 10 دقائق يُلغي الرمز', late.outcome === 'expired' && late.state.pending === null && late.state.chatId === null);

  const ok = completeOwnerTelegramPairing(st, { code, chatId: OWNER }, SECRET, NOW + 60000);
  check('★ الرمز الصحيح من المحادثة الخاصة ⇒ رُبط، ويُمسح الرمز (مرة واحدة)', ok.outcome === 'paired' && ok.state.chatId === OWNER && ok.state.pending === null && Boolean(ok.state.pairedAt));
  check('الرمز نفسه لا يُستخدم مرتين', completeOwnerTelegramPairing(ok.state, { code, chatId: '987654321' }, SECRET, NOW + 70000).outcome === 'no_pending');
  check('★ رمز صادر بسرّ خادم آخر لا يُقبل', completeOwnerTelegramPairing(st, { code, chatId: OWNER }, 'other-secret', NOW).outcome === 'bad_code');

  check('★ البيئة أولاً (قرار إعداد صريح) ثم الربط بالرمز', effectiveOwnerChat('555555555', ok.state).source === 'env' && effectiveOwnerChat(null, ok.state).chatId === OWNER && effectiveOwnerChat(null, ok.state).source === 'paired' && effectiveOwnerChat(null, defaultOwnerTelegramPairing()).chatId === null);
  check('إلغاء الربط يمسح المحادثة', unpairOwnerTelegram(ok.state).chatId === null);
  check('قيم تالفة عند التحميل تُرفض', normalizeOwnerTelegramPairing({ chatId: '-100', pending: { codeHash: 'x', expiresAt: 'y' } }).chatId === null && normalizeOwnerTelegramPairing(null).pending === null);
  check('نصوص الرد للمالك واضحة', /تم ربط/.test(pairingOutcomeText('paired')) && /انتهت/.test(pairingOutcomeText('expired')));
}

// 2) إنذار الذاكرة
{
  const at = (rss: number, slope: number | null) => memoryPressureAlert({ rssMb: rss, limitMb: 512, slopeMbPerHour: slope, nowMs: NOW });
  check('★ الحالة الحية (207 ميغا، +5.5/س ⇒ الحد بعد ~55 س) = لا إزعاج', at(207, 5.5) === null);
  check('★ ≥70% = تحذير', at(360, 1)?.level === 'warn');
  check('★ ≥85% = خطر', at(440, 0)?.level === 'critical');
  const fc = at(300, 20);
  check(`★ تنبؤ: ميل ثابت يبلغ الحد خلال ${MEMORY_LEAK_HORIZON_HOURS} ساعة ولو الذاكرة دون 70%`, fc?.level === 'forecast' && Math.round(fc.hoursToLimit || 0) === 11, JSON.stringify(fc));
  check('ميل صغير (ضجيج) لا يُنذر', at(300, 2) === null && at(300, null) === null);
  check('★ تنبيه واحد لكل مستوى في اليوم (مفتاح ثابت)', at(360, 1)?.id === at(380, 3)?.id && at(360, 1)?.id !== at(440, 0)?.id && at(360, 1)!.id.endsWith('2026-10-27'));
  check('مدخلات تالفة لا تُنذر', memoryPressureAlert({ rssMb: NaN, limitMb: 512, slopeMbPerHour: 1, nowMs: NOW }) === null && memoryPressureAlert({ rssMb: 100, limitMb: 0, slopeMbPerHour: 1, nowMs: NOW }) === null);

  check('★ نوع تنبيه جديد «ذاكرة الخادم» في طابور المالك', OWNER_ALERT_KIND_LABELS_AR.memory_pressure === 'ذاكرة الخادم تقترب من الحد');
  const q = enqueueOwnerAlert(defaultOwnerAlertState(), { key: ownerAlertKey('memory_pressure', null, 'warn:2026-10-27'), kind: 'memory_pressure', platform: null, title: 't', snippet: 's', at: new Date(NOW).toISOString() });
  check('يصمد عند التحميل ويُعدّ في الملخص', normalizeOwnerAlertState(JSON.parse(JSON.stringify(q))).pending[0]?.kind === 'memory_pressure' && ownerAlertCountsByKind(q).memory_pressure === 1 && /ذاكرة الخادم/.test(buildOwnerAlertDigest(q, null).text));
  check('رسالة Telegram بأيقونة الدماغ ورابط صفحة النظام', /^🧠/.test(buildOwnerTelegramMessage(q.pending[0], 'https://x.test')) && buildOwnerTelegramMessage(q.pending[0], 'https://x.test').includes('?tab=system'));
}

// 3) الربط في الخادم والواجهة
{
  const server = read('server.ts');
  const sys = read('src/components/system/SystemControlView.tsx');
  const pairUi = read('src/components/system/OwnerTelegramPair.tsx');
  const api = read('src/services/api.ts');
  check('★ مسارا الربط للمالك فقط', server.includes('app.post("/api/agent/owner-alerts/telegram/pair", requireOwner') && server.includes('app.delete("/api/agent/owner-alerts/telegram/pair", requireOwner'));
  check('★ رسالة الربط ليست رسالة زبون (تُعالج قبل التسجيل ولا تولّد مسودة)', server.indexOf('if(parsed && await ownerPairingIntercept(parsed, res)) return;') > 0 && server.indexOf('if(parsed && await ownerPairingIntercept(parsed, res)) return;') < server.indexOf('const telegramEvent = buildNormalizedEvent({') && server.includes('const code = extractPairingCode(parsed.text);\n  if (!code) return false;'));
  check('★ كل استعمالات محادثة المالك من مصدر واحد (البيئة ثم الربط)', (server.match(/parseOwnerTelegramChatId\(process\.env\)/g) || []).length === 3 && server.includes('return effectiveOwnerChat(parseOwnerTelegramChatId(process.env), ownerTelegramPairing);') && server.includes('const ownerChat = ownerTelegramChatId();') && server.includes('const ownerChatForInbound = ownerTelegramChatId();'));
  check('★ يصمد بعد restart في حالة التحكّم', server.includes('ownerTelegramPairing = normalizeOwnerTelegramPairing(control.ownerTelegramPairing);') && server.includes('    ownerTelegramPairing,\n'));
  check('★ الرمز بالعشوائية التشفيرية وسرّ الجلسة', server.includes('newPairingCode((n) => crypto.randomBytes(n))') && server.includes('startOwnerTelegramPairing(ownerTelegramPairing, code, SESSION_SECRET, Date.now())'));
  check('★ إنذار الذاكرة من وقفة المراقبة ودورة التنبيه', server.includes('try { syncMemoryPressureAlert(); } catch') && server.includes('    syncMemoryPressureAlert();\n'));
  check('★ زر «اربط هاتفي بنقرة» + رابط البوت + تحديث تلقائي حتى التأكيد', pairUi.includes('data-tg-pair') && sys.includes('<OwnerTelegramPair') && pairUi.includes('افتح البوت واضغط Start') && pairUi.includes('apiService.startOwnerTelegramPairing()') && api.includes("'/api/agent/owner-alerts/telegram/pair'"));
}

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} owner-instant-alerts checks`);
