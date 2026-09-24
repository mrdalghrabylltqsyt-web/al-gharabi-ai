/**
 * اختبار صدق واجهة مدير السوشيال (G2/G3) — فحوص ثابتة على الملفات المصدرية.
 *
 * سبب الوجود: كانت SocialHubView تعرض «الرد المباشر ينشر فوراً على المنصة»
 * وزر «إرسال الرد» يحدّث الحالة محلياً كأن النشر تم. وكل هذا غير صحيح لأن
 * لا يوجد موصل إرسال إنتاجي معتمد.
 *
 * يثبت الاختبار:
 *  1) لا يوجد أي ادعاء بنشر خارجي فوري أو تم الإرسال.
 *  2) الواجهة موصولة بمسارات الـAPI الحقيقية (ingest/classify/reply/approvals).
 *  3) تعلن صراحةً أن الرد يُسجَّل داخلياً فقط وأن التسليم simulated/not delivered.
 *  4) لا تكرّر منطق الحارس على العميل بدل الخادم.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const ROOT = process.cwd();
const hub = readFileSync(join(ROOT, 'src/components/social/SocialHubView.tsx'), 'utf8');
const api = readFileSync(join(ROOT, 'src/services/api.ts'), 'utf8');
const customer = readFileSync(join(ROOT, 'src/components/customers/CustomerCenterView.tsx'), 'utf8');

// 1) لا ادعاء بنشر خارجي فوري أو نجاح إرسال.
check('لا عبارة «ينشر فوراً»', !/ينشر\s*فور/.test(hub));
check('لا عبارة «تم الإرسال»', !/تم\s*الإرسال/.test(hub));
check('لا زر «إرسال الرد» (يوحي بنشر خارجي)', !/إرسال\s*الرد/.test(hub));
check('لا عبارة «سيُنشر» بلا قيد', !/سيُنشر/.test(hub));

// 2) الواجهة تعلن أن التسجيل داخلي فقط.
check('الواجهة تعلن التسجيل داخل النظام فقط', hub.includes('داخل النظام فقط'));
check('الواجهة تعلن simulated / not delivered', /simulated\s*\/\s*not delivered/.test(hub));
check('الواجهة تعلن الحاجة لموصل إرسال معتمد', /موصل\s*إرسال\s*إنتاجي/.test(hub));

// 3) الواجهة موصولة بمسارات الـAPI الحقيقية.
check('الواجهة تستدعي ingestSocialComment', hub.includes('apiService.ingestSocialComment'));
check('الواجهة تستدعي classifySocialComment', hub.includes('apiService.classifySocialComment'));
check('الواجهة تستدعي replyToSocialComment', hub.includes('apiService.replyToSocialComment'));
check('الواجهة تستدعي getSocialComments', hub.includes('apiService.getSocialComments'));
check('الواجهة تستدعي getSocialReplies', hub.includes('apiService.getSocialReplies'));
check('الواجهة تستدعي getSocialApprovals', hub.includes('apiService.getSocialApprovals'));
check('الواجهة تستدعي submitSocialApproval', hub.includes('apiService.submitSocialApproval'));

// 4) الدوال المعلنة موجودة فعلاً في طبقة الـAPI.
check('دوال الـAPI موجودة في api.ts', ['ingestSocialComment', 'classifySocialComment', 'replyToSocialComment', 'getSocialReplies', 'getSocialApprovals', 'submitSocialApproval'].every((m) => api.includes(m)));
check('مسارات الـAPI الحقيقية مستخدمة', ['/api/social/manager/comments/ingest', '/api/social/manager/comments/classify', '/api/social/manager/comments/reply', '/api/social/manager/replies', '/api/social/manager/approvals'].every((p) => api.includes(p)));

// 5) الحقن الحقيقي: زر «تسجيل الرد» بدل «إرسال».
check('الواجهة تستخدم زر «تسجيل الرد»', hub.includes('تسجيل الرد'));
check('الاعتماد متاح للمالك فقط في الواجهة', hub.includes("currentUser?.role === 'owner'") && hub.includes('الاعتماد متاح للمالك فقط'));

// 6) لا ينسِب الرد إلى Gemini، ولا يحفظ نصاً غير مفحوص.
check('لا ادعاء «عبر Gemini 3.8» في مركز العملاء', !/Gemini 3\.8/.test(customer));
check('مركز العملاء يعلن الحاجة لمراجعة بشرية عند غياب رد آمن', customer.includes('مراجعة بشرية'));
check('لا يُصدر المتصفح suggestedReply غير مفحوص', !customer.includes('setReplyInputText(result.suggestedReply)') || customer.includes('if (result && result.suggestedReply)'));

// 7) توجيه زر «ربط حقيقي»: Telegram عبر موصله الحقيقي، وبقية المنصات عبر OAuth.
//    كان الزر يمرّر Telegram إلى مسار OAuth فيفشل، مع أن للمنصة موصلاً خاصاً برمز بوت.
const connectFn = hub.slice(hub.indexOf('const handleRealConnect'), hub.indexOf('const handleIngest'));
check('دالة الربط الحقيقي موجودة في الواجهة', connectFn.includes('handleRealConnect'));
check('Telegram له فرع صريح في دالة الربط', connectFn.includes("platformId === 'telegram'"));
check('Telegram يستخدم configureTelegram', connectFn.includes('apiService.configureTelegram()'));
check('Telegram لا يستخدم startPlatformOAuth', connectFn.indexOf('apiService.configureTelegram()') < connectFn.indexOf('apiService.startPlatformOAuth(') && connectFn.indexOf("platformId === 'telegram'") < connectFn.indexOf('apiService.startPlatformOAuth('));
check('فرع Telegram يُنهي الدالة بـ return قبل OAuth', /return;\s*\}[\s\S]*startPlatformOAuth/.test(connectFn));
check('بقية المنصات ما زالت تستخدم startPlatformOAuth', connectFn.includes('apiService.startPlatformOAuth(platformId)'));
check('رسالة النجاح مربوطة بـ verified', /data\.verified/.test(connectFn) && connectFn.includes('تم التحقق من بوت Telegram وتسجيل webhook الحقيقي.'));
check('يوجد مسار بديل عند عدم إثبات التحقق', connectFn.includes('إعداد Telegram'));

// 8) عقود الـAPI: مسار Telegram الحقيقي موجود ولم يُنشأ بديل OAuth له.
check('configureTelegram يستدعي POST /api/platforms/telegram/configure', /async configureTelegram\([\s\S]*?fetch\('\/api\/platforms\/telegram\/configure'[\s\S]*?method\s*:\s*'POST'/.test(api));
check('startPlatformOAuth ما زال مسار OAuth', api.includes('/oauth/start'));
check('لا مسار oauth/start لـ Telegram في api.ts', !/platforms\/telegram\/oauth/.test(api));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} social UI claim checks`);
}
