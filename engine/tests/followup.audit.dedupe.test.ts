/**
 * تسجيل قرارات المتابعة بالتغيّر لا بالتكرار (2026-10-29).
 *
 * العطل: دورة العقل التجاري (كل 10 د) كانت تكتب سطر audit لكل زبون «مستحق متابعة لكن غير
 * مؤهل» في كل دورة بالسبب نفسه ⇒ سجل العمليات (سقف 100) يُمحى، وكل سطر يطلب حفظ الحالة،
 * والغرفة الحية تعرض التكرار كأنه نشاط حقيقي منتظم («عملية: commercial followup…»).
 * ومعه: لوحة 24 ساعة الفارغة تقول متى وصل آخر تفاعل حقيقي، وتوضيح أن النوايا/المواضيع على كل الفترة.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFollowUpDecisionMemo } from '../commercial/followUpDecisionMemo';
import { auditToLiveEvent, buildLiveInsights } from '../ops/liveRoom';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0; const failures: string[] = [];
const check = (name: string, ok: boolean, info = '') => { if (ok) passed++; else failures.push(name + (info ? ` — ${info}` : '')); };

// 1) الذاكرة: أول مرة تُسجَّل، التكرار لا، تغيّر السبب يُسجَّل، النسيان يعيد التسجيل
{
  const m = createFollowUpDecisionMemo(3);
  check('★ أول قرار لزبون يُسجَّل', m.changed('fb:1', 'NOT_MESSAGE') === true);
  let repeats = 0;
  for (let i = 0; i < 144; i++) if (m.changed('fb:1', 'NOT_MESSAGE')) repeats++; // يوم كامل من الدورات
  check('★ القرار نفسه لا يُسجَّل مرة أخرى طوال يوم من الدورات', repeats === 0, String(repeats));
  check('★ تغيّر السبب يُسجَّل', m.changed('fb:1', 'OUTSIDE_META_WINDOW') === true);
  m.forget('fb:1');
  check('★ بعد أن صار مؤهلاً ثم مُنع من جديد يُسجَّل', m.changed('fb:1', 'OUTSIDE_META_WINDOW') === true);
  m.changed('a', 'X'); m.changed('b', 'X'); m.changed('c', 'X');
  check('★ الحجم محدود (الأقدم يُسقط)', m.size() === 3, String(m.size()));
  check('★ مفتاح فارغ لا يُبتلع صامتاً', m.changed('', 'X') === true);
}

// 2) الخادم يستعمل الذاكرة حول سطري audit المنع، وينسى عند الأهلية
{
  const server = read('server.ts');
  check('★ الخادم ينشئ ذاكرة القرارات', server.includes('const followUpDecisionMemo = createFollowUpDecisionMemo(2000);'));
  check('★ منع النافذة يُسجَّل عند التغيّر فقط', server.includes("if (newDecision) audit('commercial-brain', 'commercial_followup_blocked_meta_window'"));
  check('★ «غير مؤهل» يُسجَّل عند التغيّر فقط', server.includes("} else if (newDecision) {\n          audit('commercial-brain', 'commercial_followup_not_eligible'"));
  check('★ العدّاد windowBlocked يبقى لكل دورة (لا يتأثر بالتسجيل)', /commercialWindowBlocked \+= 1;\n\s+if \(newDecision\)/.test(server));
  check('★ الأهلية تنسى القرار', server.includes('followUpDecisionMemo.forget(lead.key);'));
}

// 3) الغرفة الحية: عنوان عربي مفهوم بدل «عملية: commercial followup not eligible»
{
  const a = auditToLiveEvent('commercial_followup_not_eligible', '{"leadKey":"x"}');
  const b = auditToLiveEvent('commercial_followup_blocked_meta_window', '{"leadKey":"x"}');
  check('★ عنوان عربي لـ«غير مؤهل»', Boolean(a && !a.title.startsWith('عملية:') && a.text === ''), JSON.stringify(a));
  check('★ عنوان عربي لـ«خارج نافذة المراسلة»', Boolean(b && b.module === 'gate' && !b.title.startsWith('عملية:')), JSON.stringify(b));
}

// 4) آخر تفاعل حقيقي ومجموع المخزَّن
{
  const NOW = Date.parse('2026-10-29T15:00:00Z');
  const ins = buildLiveInsights({
    nowMs: NOW, leads: [], publishRecords: [],
    comments: [
      { createdAt: new Date(NOW - 3 * 86400000).toISOString(), platform: 'facebook', text: 'بكم', classification: { intent: 'question' } },
      { createdAt: new Date(NOW - 5 * 86400000).toISOString(), platform: 'youtube', text: 'حلو', classification: { intent: 'praise' } },
      { createdAt: new Date(NOW - 60000).toISOString(), platform: 'facebook', text: 'مستورد', backfill: true },
    ],
  });
  check('★ لا تفاعل في 24 ساعة', ins.hourly24.reduce((x, y) => x + y, 0) === 0);
  check('★ آخر تفاعل حقيقي = الأحدث بلا المستورد', ins.lastInboundAt === new Date(NOW - 3 * 86400000).toISOString(), String(ins.lastInboundAt));
  check('★ مجموع المخزَّن بلا المستورد', ins.storedTotal === 2, String(ins.storedTotal));
  const empty = buildLiveInsights({ nowMs: NOW, leads: [], publishRecords: [], comments: [] });
  check('★ بلا تفاعلات: null صريح', empty.lastInboundAt === null && empty.storedTotal === 0);
}

// 5) الواجهة
{
  const ui = read('src/components/live/LiveBrainRoom.tsx');
  check('★ اللوحة الفارغة تذكر آخر تفاعل حقيقي بدل مخطط فارغ', ui.includes('آخر تفاعل حقيقي وصل') && ui.includes('ins.lastInboundAt'));
  check('★ النوايا والمواضيع موسومة بنافذتها', ui.includes('· كل التفاعلات المخزَّنة') && ui.includes('· كل الفترة'));
  const lcc = read('src/components/live/LiveControlCenter.tsx');
  check('★ الشريط يعدّ «تنبيهات» لا «حالات» (لا يتعارض مع عدد التصعيدات)', lcc.includes('تنبيه يحتاج') && !lcc.includes('حالة تحتاج انتباهك'));
}

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} followup-audit-dedupe checks`);
