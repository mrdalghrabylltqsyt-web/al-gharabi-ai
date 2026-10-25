/**
 * فحص الشاشات الجولة الثانية (2026-10-25) — كل شاشة تقرأ من مصدرها الحقيقي.
 *
 *  1) عبارات المنتج العامة الثابتة لا تُعرض ولا تدخل نصوص العقل؛ «موديل» سنة حقيقية فقط.
 *  2) بطاقات المنصات: أرقام من الخادم (متابعون/تفاعل/منشورات) لا قيم واجهة ثابتة.
 *  3) خدمة العملاء: الوارد الحقيقي من المنصات، ولا زر «محاكاة رسالة» يختلق بيانات.
 *  4) المهام والمتابعات: الزبائن الحقيقيون من العقل التجاري بدل CRM المعزول.
 *  5) البحث الموحد: يشمل تعليقات الزبائن والزبائن المحتملين + تطبيع عربي.
 *  6) مصفوفة الصلاحيات تطابق الخادم.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { realProductPhrases, modelLabel, GENERIC_PRODUCT_PLACEHOLDERS } from '../../src/utils/productPhrases';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// 1) عبارات المنتج
check('★ العبارات العامة تُسقط', realProductPhrases(['مواصفات المنتج حسب الفئة', 'ضمان حسب سياسة المورد', 'خيارات تقسيط حسب الأهلية']).length === 0);
check('العبارة الحقيقية تبقى', JSON.stringify(realProductPhrases(['انفرتر', ' 2 طن ', '', 5, 'مدد سداد مرنة'])) === JSON.stringify(['انفرتر', '2 طن']));
check('غير مصفوفة ⇒ []', realProductPhrases(null).length === 0 && realProductPhrases('x').length === 0);
check('ست عبارات معروفة', GENERIC_PRODUCT_PLACEHOLDERS.size === 6);
check('★ سنة حقيقية ⇒ موديل', modelLabel('2026', 2026) === 'موديل 2026' && modelLabel(2027, 2026) === 'موديل 2027');
check('★ رقم طراز ⇒ طراز لا سنة', modelLabel('24000', 2026) === 'طراز 24000' && modelLabel('6640', 2026) === 'طراز 6640');
check('غياب ⇒ null (لا سنة حالية مختلقة)', modelLabel('', 2026) === null && modelLabel(undefined, 2026) === null);

const server = read('server.ts');
const db = read('src/components/database/ShowroomDatabaseView.tsx');
check('★ نموذج الإضافة لا يكتب عبارات عامة', !db.includes("installmentOptions: ['خيارات تقسيط حسب الأهلية'") && db.includes('installmentOptions: [],'));
check('البطاقة تعرض العبارات الحقيقية فقط', db.includes('realProductPhrases(prod.specs)') && db.includes('modelLabel(prod.modelYear'));
check('العقل/المحتوى لا يستلمان العبارات العامة', server.includes('...realProductPhrases(product?.specs),') && server.includes('specs: realProductPhrases(product?.specs),'));
check('خطة التقسيط المشتقة من المنتجات + بنك الأسئلة قابل للإضافة', db.includes('derivedPlans') && db.includes('handleAddFaq') && db.includes('handleAddPolicy'));

// 2) بطاقات المنصات
const hub = read('src/components/social/SocialHubView.tsx');
const ctx = read('src/context/AppContext.tsx');
check('★ اللقطة تحمل أرقام كل منصة', server.includes('metrics: platformCardMetrics(p.id)') && server.includes('function platformCardMetrics(platform: string)'));
check('السياق يقرأ الأرقام الحقيقية', ctx.includes('measured: m,') && ctx.includes("engagementRate: typeof m?.engagementRate === 'number'"));
check('★ زر المزامنة يجلب فعلاً', hub.includes('await apiService.syncAnalytics()') && !hub.includes('syncAllPlatforms,\n    posts'));
check('المتابعون «—» عند عدم القياس', hub.includes('fmtFollowers(p)') && !hub.includes('{(p.followers || 0).toLocaleString()}'));
check('تاريخ الربط منسّق لا ISO خام', hub.includes('fmtDate(p.lastSyncTime)'));
check('عدّاد التعليقات يُحمَّل عند الفتح', hub.includes('void loadConsole();\n  }, [loadConsole]);'));
check('زر «متصل» لا يعرض رسالة شكلية', !hub.includes("p.status === 'connected' ? togglePlatformStatus(p.id)"));

// 3) خدمة العملاء
const cc = read('src/components/customers/CustomerCenterView.tsx');
const inbound = read('src/components/customers/PlatformInboundPanel.tsx');
check('★ الوارد الحقيقي معروض', cc.includes('<PlatformInboundPanel />') && inbound.includes('apiService.getSocialComments(undefined, 1000)'));
check('★ لا زر محاكاة يختلق رسائل', !cc.includes('محاكاة رسالة عميل جديدة'));
check('حالة الرد من سجل الردود الحقيقي', inbound.includes('rep?.delivered'));
check('مسار التعليقات يقبل limit محدوداً', read('engine/social/routes.ts').includes('Math.min(1000, Math.max(1, Number(req.query?.limit) || 200))'));

// 4) المهام والمتابعات
const ops = read('src/components/operations/OperationsView.tsx');
check('★ المتابعات من العقل التجاري', ops.includes('<CommercialFollowUpsPanel />') && read('src/components/operations/CommercialFollowUpsPanel.tsx').includes('apiService.getCommercialInbox()'));
check('★ لا رسالة «خارج النطاق» للمالك', ops.includes('if(!/خارج نطاق|SCOPE/i.test(msg))'));
check('CRM يظهر فقط إن فُعّل', ops.includes('{crmAvailable && <>'));

// 5) البحث
check('★ البحث يشمل الوارد الحقيقي والزبائن', server.includes('const inbound = (((workspace as any).socialComments || []) as any[])') && server.includes('results: { products, posts, conversations, inbound, leads }'));
check('تطبيع عربي (ة/ه، أ/ا)', server.includes('function foldArabicSearch(value: unknown): string'));
check('رسالة الطول «حرفين»', server.includes('اكتب حرفين على الأقل للبحث.'));

// 6) الصلاحيات
check('★ تعديل المنتجات للمالك/المدير فقط (مطابق للمصفوفة)', !server.includes('if (!["owner", "manager", "staff"].includes(user.role)) return res.status(403).json({ success: false, error: "لا تملك صلاحية تعديل المنتجات." });'));
check('المدير لا يربط المنصات (requireOwner)', read('src/components/users/UserManagementView.tsx').includes('      system_settings: false,\n      manage_users: false,\n    },\n    content_creator'));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} screens-round2 checks`);
