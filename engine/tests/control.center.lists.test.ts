/**
 * مركز السيطرة: «11 تنبيهاً حرجاً» و«44 حالة» يجب أن يُوصل إليها بنقرة (2026-10-28).
 * كان تنبيه الحرجة بلا زر، والحمولة الحية تحمل آخر 12 إشعاراً و6 تصعيدات فقط، و«افتح»
 * الحالات ينقل لشاشة أخرى قد لا تُظهر شيئاً أثناء التحميل.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
let passed = 0; const failures: string[] = [];
const check = (n: string, ok: boolean) => { if (ok) passed++; else failures.push(n); };

const cc = read('src/components/live/LiveControlCenter.tsx');
check('★ تنبيه «الحرجة غير المقروءة» له زر يفتح قائمتها', cc.includes("a.id === 'notifications-critical'") && cc.includes('onClick={openCritical}>اعرضها الآن'));
check('★ تنبيه «حالات تحتاج تدخّلك» يفتح الحالات في المكان نفسه', cc.includes("a.id === 'escalations-open'") && cc.includes('onClick={openEscalations}>اعرض الحالات'));
check('★ الحرجة تُجلب كاملة مرشّحة على الخادم', cc.includes("severity: 'critical' as const") && cc.includes('getNotifications({ unread: true'));
check('★ كل الحالات المفتوحة تُجلب (لا آخر 6 فقط)', cc.includes('apiService.getEscalations()') && cc.includes("fullEsc.filter((e: any) => e.state !== 'RESOLVED')"));
check('تبويب «الحرجة» ظاهر حين توجد', cc.includes('الحرجة ({Number(notes.critical)})'));
check('«قرأتها كلها» و«اطّلعت على كل الجديدة»', cc.includes('قرأتها كلها (') && cc.includes('اطّلعت على كل الجديدة ('));
check('القائمة تتمرّر للعرض عند الفتح', cc.includes('listRef.current?.scrollIntoView'));
check('«الرد اليدوي» يفتح لوحة التصعيدات مباشرة', cc.includes("focusFeature('التصعيدات البشرية', 'panel')"));
const srv = read('server.ts');
check('★ /api/notifications يرشّح قبل القصّ (لا يضيع حرج قديم)', srv.includes('const onlyUnread=String(req.query?.unread||"")==="1"') && srv.includes('const rows=mine.slice(0,200);'));
const ep = read('src/components/social/EscalationsPanel.tsx');
check('★ لوحة التصعيدات لا تختفي أثناء التحميل أو الفشل', ep.includes("useState<'loading' | 'ok' | 'error'>") && ep.includes('أعد المحاولة'));
const api = read('src/services/api.ts');
check('واجهة getNotifications تقبل الترشيح', api.includes("async getNotifications(filter: { unread?: boolean; severity?:"));

console.log('\n' + '='.repeat(60));
if (failures.length) { console.error(`FAILED: ${failures.length} — passed ${passed}`); for (const f of failures) console.error('  ✗ ' + f); process.exit(1); }
console.log(`PASSED: ${passed} control-center-lists checks`);
