/**
 * المسح الجذري النهائي (2026-10-26) — يثبّت ما أُصلح ورُبط:
 *  1) TLS: إعدادنا الصريح هو الحاكم (sslmode يُزال من الرابط) — كان pg يدمجه فوقنا ويطبع تحذيراً.
 *  2) مزامنة الأرقام: سبب فشل صادق (أول محاولة)، منشور محذوف من المنصة (100/33) يُعلَّم ولا يُعاد طلبه،
 *     وسطر السجل بلا كلمة error (Render كان يصنّف قياس يوتيوب الناجح كخطأ).
 *  3) جرس التنبيهات يعرض تنبيهات الخادم الحقيقية (كانت تُخزَّن بلا أي شاشة).
 *  4) طابور مهام النشر + مفتاح التنفيذ التلقائي لهما شاشة، ورابط الجاهزية يقود إليها.
 *  5) التصعيدات البشرية تُعرض وتُحلّ، وتنبيهها يقود إلى مدير النشر.
 *  6) تقرير الشهر التجاري مربوط بصندوق الزبائن.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripSslModeParam, postgresPoolConfig } from '../storage/adapter';
import { classifyLogLine } from '../ops/liveRoom';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

// 1) TLS
check('★ يزيل sslmode ويُبقي باقي المعاملات', stripSslModeParam('postgresql://u:p@h/d?sslmode=require&channel_binding=require') === 'postgresql://u:p@h/d?channel_binding=require');
check('يزيل الاستعلام كله إن لم يبقَ غيره', stripSslModeParam('postgresql://u:p@h/d?sslmode=require') === 'postgresql://u:p@h/d');
check('بلا استعلام يبقى كما هو', stripSslModeParam('postgresql://u:p@h/d') === 'postgresql://u:p@h/d');
check('uselibpqcompat يُزال أيضاً', stripSslModeParam('postgresql://h/d?uselibpqcompat=true&sslmode=require&x=1') === 'postgresql://h/d?x=1');
const pc: any = postgresPoolConfig('postgresql://u:p@h/d?sslmode=require', { verifyTls: true });
check('★ الرابط المُمرَّر لـ pg بلا sslmode، وTLS مفروض بإعدادنا', !/sslmode/.test(pc.connectionString) && pc.ssl?.rejectUnauthorized === true);
check('sslmode=disable يبقى كما هو (محلي)', (postgresPoolConfig('postgresql://u:p@h/d?sslmode=disable') as any).connectionString.includes('sslmode=disable'));

// 2) مزامنة الأرقام
const server = read('server.ts');
check('★ منشور محذوف من المنصة لا يُعاد طلبه', server.includes('if (r?.remoteGone) continue;') && server.includes('function graphObjectGone(json: any): boolean'));
check('★ 100/33 يعلّم السجل (بلا حذف بيانات)', server.includes('r.remoteGone = { at: nowIso, code: "100/33" };'));
check('★ سبب الفشل من أول محاولة لا آخر صيغة', server.includes('const tag = graphErrTag(firstErr || json);'));
check('★ سطر السجل بلا كلمة error', server.includes('issue=${issue}') && !server.includes('error=${st.error ?? "-"}'));
check('قياس صفري ⇒ تحذير لا سجل عادي', server.includes('if (st.posts > 0 && st.withMetrics === 0) console.warn(line); else console.log(line);'));
const ev = classifyLogLine('[metrics] platform=instagram posts=12 withMetrics=10 followers=107 issue=100/33x2 gone=2');
check('غرفة العقل تقرأ الصيغة الجديدة', ev?.module === 'memory' && ev.text.includes('100/33x2'), JSON.stringify(ev));

// 3) الجرس
const header = read('src/components/common/Header.tsx');
check('★ الجرس يقرأ تنبيهات الخادم', header.includes('apiService.getNotifications()') && header.includes('serverUnread'));
check('تعليم مقروء فردي وجماعي', header.includes('apiService.markNotificationRead(n.id)') && header.includes('apiService.markAllNotificationsRead()'));
check('★ أُزيل الادعاء الثابت «الوكيل الذكي جاهز»', !header.includes('الوكيل الذكي جاهز'));
check('التصعيد ينبّه ويقود لمدير النشر', (server.match(/"social_manager",|'social_manager',/g) || []).length >= 2);

// 4) طابور المهام
const jobs = read('src/components/calendar/ScheduledJobsPanel.tsx');
check('★ لوحة المهام تقرأ الطابور الحقيقي', jobs.includes('apiService.listJobs()'));
check('★ مفتاح التنفيذ التلقائي للمالك', jobs.includes('apiService.setJobAutoExecute(') && jobs.includes('role="switch"'));
check('التنفيذ للجاهزة فقط (كما يشترط الخادم)', jobs.includes("isOwner && j.status === 'ready' &&") && server.includes('if (job.status !== "ready") return { status: 409'));
check('★ لوحة المهام داخل الجدولة', read('src/components/calendar/ContentCalendarView.tsx').includes('<ScheduledJobsPanel />'));
check('★ رابط الجاهزية يقود للجدولة لا لشاشة مالية', read('src/components/dashboard/SalesReadinessPanel.tsx').includes("if (id === 'ready-jobs') return 'calendar';") && read('engine/ops/salesReadiness.ts').includes('طابور مهام النشر'));

// 5) التصعيدات
const esc = read('src/components/social/EscalationsPanel.tsx');
check('★ التصعيدات تُعرض وتُحل', esc.includes('apiService.getEscalations()') && esc.includes("apiService.transitionEscalation(id, ev)"));
check('داخل مدير النشر', read('src/components/social/SocialManagerView.tsx').includes('<EscalationsPanel />'));

// 6) تقرير الشهر
check('★ تقرير الشهر مربوط', read('src/components/agent/CommercialMonthlyReport.tsx').includes('apiService.getCommercialMonthlyReport(month)') && read('src/components/agent/CommercialInbox.tsx').includes('<CommercialMonthlyReport />'));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const x of failures) console.error('  ✗ ' + x);
  process.exit(1);
}
console.log(`PASSED: ${passed} final-sweep checks`);
