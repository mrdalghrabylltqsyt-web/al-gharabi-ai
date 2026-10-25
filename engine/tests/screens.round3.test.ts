/**
 * فحص الشاشات الجولة 3 (2026-10-25) — جذور ما ظهر في لقطات المالك:
 *  1) مسودات ردود الزبائن: «العنوان؟» على منشور غير مربوط كان يُسأل «أي فرع/مدينة» لأن
 *     حقائق المعرض تسقط بلا منتج؛ «السعر والعنوان» يُهمل الموقع؛ «8كليو» لا يُفهم مقاساً.
 *  2) الأوقات الخام (ISO/UTC) في الواجهة ⇒ عرض موحّد بتوقيت بغداد.
 *  3) صفحة النسخ تعرض «غير مربوط/0» قبل وصول الحالة ⇒ حالة تحميل.
 *  4) مركز التشغيل: تنبيهات حقيقية، منصة متصلة لا تُعرض بخطوات الإعداد، سجل العمليات بلا
 *     ضجيج تجديد الرمز، «تحقق Google» اختياري.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyComment } from '../social/comments';
import { resolveInquiry, asksLocationToo } from '../social/inquiryResolver';
import { sizeFromText, deviceTypeFromText } from '../social/productMatch';
import { analyzeBusinessClaims, buildBusinessFacts } from '../social/contentSafety';
import { fmtDateTime } from '../../src/utils/displayTime';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// 1) المسودات — الحقائق كما يبنيها الخادم الآن بلا منتج (المعرض فقط).
const showroomFacts = { locationText: 'كربلاء - طريق كربلاء الطويريج، مقابل العمود 202', hoursText: 'يومياً من 8 صباحاً حتى 8 مساءً', phoneText: '07728705767' };
const products = [
  { id: 'w8a', name: 'غسالة سامسونج 8 كيلو', cashPrice: 500000, inStock: true },
  { id: 'w8b', name: 'غسالة LG 8 كيلو', cashPrice: 550000, inStock: true },
  { id: 'w10', name: 'غسالة LG 10 كيلو', cashPrice: 650000, inStock: true },
];
const run = (t: string) => resolveInquiry({
  classification: classifyComment(t), text: t, products, productFacts: showroomFacts as any,
  buildProductFacts: (p: any) => ({ ...showroomFacts, productName: p.name, priceText: `${p.cashPrice} د.ع` }) as any,
});
for (const t of ['العنوان وسعر', 'السعر والعنوان', 'وين مكانكم']) {
  const r = run(t);
  check(`★ «${t}» ⇒ العنوان المسجّل`, r.text.includes('مقابل العمود 202') && !r.text.includes('أي فرع'), r.text);
}
const combo = run('شو سعر وين بطيط باي محافظة');
check('★ سعر + موقع في رسالة واحدة ⇒ العنوان + سؤال السعر', combo.text.includes('مقابل العمود 202') && /الماركة|موديل/.test(combo.text), combo.text);
const kilo = run('بكام 8كليو');
check('★ «8كليو» يُفهم مقاساً ⇒ خيارا 8 كيلو لا سؤال عن المقاس', kilo.kind === 'product_choice' && kilo.text.includes('8 كيلو') && !kilo.text.includes('10 كيلو'), kilo.text);
check('لا موقع مضاف لسؤال سعر فقط', !run('بكم الغسالة؟').text.includes('العمود 202'));
check('كشف طلب الموقع', asksLocationToo('وين مكانكم') && asksLocationToo('السعر والعنوان') && asksLocationToo('باي محافظة') && !asksLocationToo('بكم السعر'));
const factsGuard = buildBusinessFacts({ phones: ['07728705767'] });
check('★ الردود الجديدة تمر بحارس الادعاءات', [combo.text, run('السعر والعنوان').text, kilo.text].every((t) => analyzeBusinessClaims(t, factsGuard).safe));

check('مقاس كيلو ملتصق', JSON.stringify(sizeFromText('بكام 8كليو')) === JSON.stringify({ value: 8, unit: 'kg' }));
check('طن بكسر', JSON.stringify(sizeFromText('سبلت 1.5 طن')) === JSON.stringify({ value: 1.5, unit: 'ton' }));
check('«سبلت» (تهجئة المخزن) مكيف', deviceTypeFromText('سبلت المتين 2 طن') === 'ac');
check('المقاسات القديمة سليمة', sizeFromText('ثلاجة 18 قدم')?.unit === 'feet' && sizeFromText('شاشة 55')?.value === 55);

const server = read('server.ts');
check('★ حقائق المعرض تُعاد بلا منتج', server.includes('function replyFactsForProduct(product: any | null): ReplyFactSet {') && !/function replyFactsForProduct\(product: any \| null\): ReplyFactSet \{\n  if \(!product\) return \{\};/.test(server));
check('★ المسودات المعلّقة الأضعف تُستبدل بلا إرسال', server.includes('async function refreshStalePendingReplyDrafts(nowIso: string)') && server.includes("code: 'SUPERSEDED_BETTER_REPLY'") && server.includes('try { await refreshStalePendingReplyDrafts(nowIso); }'));

// 2) الأوقات
const f = fmtDateTime('2026-10-25T16:41:55.345Z');
check('★ ISO ⇒ توقيت بغداد لا UTC خام', !f.includes('T16') && !f.includes('Z') && /٧:٤١|7:41/.test(f), f);
check('نص بلا تاريخ يبقى كما هو', fmtDateTime('مؤخراً') === 'مؤخراً' && fmtDateTime(null) === '—');
check('مفتاح الإيقاف يعرض الوقت منسّقاً', read('src/components/agent/CommercialBrainKillSwitch.tsx').includes('fmtDateTime(state.lastRun.at)'));
check('آخر فحص للمراقبين منسّق', read('src/components/social/SocialManagerView.tsx').includes('fmtDateTime(metaWatcher.lastPollAt)'));

// 3) النسخ: لا حالة قبل الجلب
const backup = read('src/components/system/CloudBackupView.tsx');
check('★ صفحة النسخ: تحميل أول بدل «غير مربوط»', backup.includes('const awaitingFirstLoad = !snapshot && !health && !statusError;') && backup.includes('{awaitingFirstLoad ? ('));
const sm = read('src/components/social/SocialManagerView.tsx');
check('حالة TikTok لا تُعرض «غير متصلة» قبل الجلب', sm.includes("{!ttStatus ? 'جارٍ التحميل…'"));

// 4) مركز التشغيل
check('★ منصة متصلة تُعرض بحالتها لا بخطوات الإعداد', server.includes('function connectedPlatformNextHint(platform: string, c: any): string | null') && (server.match(/connectedPlatformNextHint\(p\.id, c\)/g) || []).length === 2);
check('★ تنبيهات حقيقية (ردود منتظرة/قراءة متوقفة)', server.includes('id:"pending-replies"') && server.includes('id:`ingest-${pf}`') && !server.includes('id:"google-client"'));
check('★ تجديد الرمز الروتيني لا يُغرق سجل العمليات', !server.includes('audit("system", "youtube_token_refreshed", "auto");'));
check('«تحقق Google» اختياري لا يُسقط السلامة', server.includes('const optionalChecks = { googleSignInConfigured: Boolean(GOOGLE_CLIENT_ID),') && !server.includes('googleAudienceCheckConfigured: Boolean(GOOGLE_CLIENT_ID),'));
const sys = read('src/components/system/SystemControlView.tsx');
check('التشخيص: وارد حقيقي + ردود منتظرة بدل محادثات CRM', sys.includes("['تعليقات ورسائل الزبائن',diagnostics.workspace.inbound") && sys.includes('ردود بانتظار موافقتك'));
check('نسخ الملف المحلي «غير مستخدمة» على Postgres', sys.includes("diagnostics.storageBackend!=='file'?'Postgres + Drive'"));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const x of failures) console.error('  ✗ ' + x);
  process.exit(1);
}
console.log(`PASSED: ${passed} screens-round3 checks`);
