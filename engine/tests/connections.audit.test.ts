/**
 * تدقيق الوصلات (2026-10-28) — ما رُصد على شاشات المالك:
 *   1) «متابعة مستحقة الآن (16)» من قيم مخزّنة بقاعدة قديمة، بينما الخادم يحسبها من الحقائق.
 *   2) المتابعات المستحقة لا تُجهَّز والعقل التجاري موقوف — بلا أي إشارة على الشاشة.
 *   3) بعد إعادة ربط يوتيوب يبقى «إعادة ربط youtube مطلوبة» حرجاً غير مقروء (11 تنبيهاً حرجاً).
 *   4) «Telegram الفوري: أُرسل 0» رغم وصول الرسائل — العدّاد يُصفَّر مع كل نشر.
 *   5) «تعليقات ورسائل الزبائن 166» والتحليلات تعدّ ردود المعرض نفسه.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toCommercialLeadRow, nextFollowUpAt } from '../commercial/commercialBrain';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
let passed = 0; const failures: string[] = [];
const check = (name: string, ok: boolean, info = '') => { if (ok) passed++; else failures.push(name + (info ? ` — ${info}` : '')); };

const server = read('server.ts');
const panel = read('src/components/operations/CommercialFollowUpsPanel.tsx');

// 1) المتابعة من الحقائق
{
  const base: any = { id: 'l1', platform: 'facebook', customerName: null, interestedProductName: null, stage: 'QUALIFIED', touches: 1, lastInteractionAt: '2026-10-27T10:00:00Z', followUpState: 'SCHEDULED', followUpsSent: 0, escalationReason: null, lastCustomerText: 'بكم', initiatedByCustomer: true };
  const stale = { ...base, nextFollowUpAt: '2026-10-20T00:00:00Z', lastBusinessReplyAt: null };
  check('★ قيمة مخزّنة قديمة بلا ردّ للمعرض ⇒ لا متابعة (لا «مستحقة» كاذبة)', toCommercialLeadRow(stale).nextFollowUpAt === null && nextFollowUpAt(stale) === null);
  const replied = { ...base, nextFollowUpAt: null, lastBusinessReplyAt: '2026-10-27T10:00:00Z' };
  check('ردّ المعرض ⇒ المتابعة بعد 48 ساعة من ردّه', toCommercialLeadRow(replied).nextFollowUpAt === '2026-10-29T10:00:00.000Z', String(toCommercialLeadRow(replied).nextFollowUpAt));
  check('المُصعَّد لا متابعة آلية له', toCommercialLeadRow({ ...replied, stage: 'ESCALATED' }).nextFollowUpAt === null);
}
// 2) العقل التجاري موقوف
check('★ تنبيه: متابعات حان وقتها والعقل التجاري موقوف + زر تشغيله', panel.includes('data-followups-paused') && panel.includes("data.killSwitchEnabled === false") && panel.includes("setActiveTab('commercial_kill_switch')"));
// 3) حل تنبيهات الانقطاع تلقائياً
check('★ إعادة الربط تحلّ تنبيهات انقطاعها (مقروءة + وقت الحل، بلا حذف)', server.includes('function resolveReauthNotificationsForConnected(): number {') && server.includes('item.read = true; item.resolvedAt = at; item.resolvedBy = "auto_reconnected"') && server.includes('function savePlatformConnections() {\n  resolveReauthNotificationsForConnected();'));
check('تنبيه الانقطاع العام باسم المنصة بالعربية', server.includes("`إعادة ربط ${platformLabelAr(platform)} مطلوبة`"));
// 4) عدّاد تيليغرام
check('★ عدّاد رسائل تيليغرام يصمد بعد النشر', server.includes('ownerTelegramStats: { ...ownerTelegramStatus },') && server.includes('ownerTelegramStatus.sentCount = Math.max(0, Number(tgs.sentCount) || 0);') && server.includes("ownerTelegramStatus.sentCount += 1; saveControlState(); return true;"));
// 5) أصوات الزبائن فقط
check('★ التشخيص والتحليلات تعدّ أصوات الزبائن فقط', server.includes('inbound:customerComments().length, inboundAll:') && (server.match(/const inbound = customerComments\(\);/g) || []).length === 2);

console.log('\n' + '='.repeat(60));
if (failures.length) { console.error(`FAILED: ${failures.length} — passed ${passed}`); for (const f of failures) console.error('  ✗ ' + f); process.exit(1); }
console.log(`PASSED: ${passed} connections-audit checks`);
