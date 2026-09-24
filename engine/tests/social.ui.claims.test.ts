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

// 9) إصلاح إرسال رد Telegram للرسائل الواردة (message_reply ≠ comment_reply).
//    كانت الواجهة تمنع الرد لأن Telegram لا يعلن comment_reply، مع أن له مسار
//    رد حقيقي (sendMessage) على مسار /api/platforms/telegram/reply.
const replyFn = hub.slice(hub.indexOf('const recordReply'), hub.indexOf('const decide'));
check('recordReply يوجّه Telegram للرد الحقيقي', replyFn.includes("comment.platform === 'telegram'") && replyFn.includes('apiService.replyTelegram'));
check('التوجيه يعتمد على replyTarget.chatId الرسالة', replyFn.includes('replyTarget?.chatId'));
check('Telegram لا يستخدم مسار التعليقات العام', replyFn.indexOf('apiService.replyTelegram') < replyFn.indexOf('apiService.replyToSocialComment('));
check('بقية المنصات تسلك مسار التعليقات', replyFn.includes('apiService.replyToSocialComment({ platform: comment.platform'));
check('الواجهة تفصل استقبال الرسالة عن تسليم الرد', hub.includes('مستلمة فعلياً') && hub.includes('الرد المُسلَّم فعلياً'));
check('الاستقبال الحقيقي مرتبط بـ telemetry webhook', hub.includes("com.ingestSource === 'telegram_webhook'") && hub.includes('receivedViaWebhook'));
check('لا تعرض الرسالة الواردة كـ simulated دائماً', hub.includes("reply && !reply.delivered"));
check('زر الرد على Telegram يعلن الإرسال الفعلي لا التسجيل الداخلي', hub.includes("'إرسال فعلي عبر Telegram'"));

// 10) لوحة Telegram في SocialManagerView تعرض الرسائل الواردة وتختار هدف الرد.
const manager = readFileSync(join(ROOT, 'src/components/social/SocialManagerView.tsx'), 'utf8');
check('لوحة Telegram تحمّل الرسائل الواردة الحقيقية', manager.includes('loadTelegramIncoming') && manager.includes("apiService.getSocialComments('telegram')"));
check('اللوحة تسمح باختيار هدف الرد من رسالة واردة', manager.includes('setTgExternalId(c.externalId)'));
check('اللوحة تُعلن أن التسليم يحتاج استجابة مزود حقيقية', manager.includes('لا يُسجَّل التسليم إلا باستجابة Telegram حقيقية'));

// 10b) ربط Facebook الحقيقي في الواجهة: تعليق عبر مسار comment_reply ورسالة عبر message_reply.
check('recordReply يوجّه تعليق Facebook لمسار الرد الحقيقي', replyFn.includes("comment.platform === 'facebook'") && replyFn.includes('apiService.replyFacebook'));
check('recordReply يوجّه رسالة Facebook لمسار message_reply', replyFn.includes('apiService.messageReplyFacebook') && replyFn.includes("comment.kind === 'message'"));
check('Facebook لا يسلك مسار التعليقات العام', replyFn.indexOf('apiService.replyFacebook') < replyFn.indexOf('apiService.replyToSocialComment('));
check('الواجهة تعتبر استقبال facebook_webhook استقبالاً حقيقياً', hub.includes("com.ingestSource === 'facebook_webhook'"));
check('زر رد Facebook يعلن الإرسال الفعلي لا التسجيل الداخلي', hub.includes('إرسال فعلي كتعليق'));
check('لوحة Facebook تحمّل الوارد الحقيقي وتعرض حالة الاشتراك', manager.includes('loadFacebookIncoming') && manager.includes("apiService.getSocialComments('facebook')") && manager.includes('getFacebookWebhookInfo'));
check('لوحة Facebook تفصل capacity comment_reply عن message_reply', manager.includes('comment_reply') && manager.includes('message_reply'));
check('عقود API: مسارات Facebook الحقيقية موجودة', api.includes('/api/platforms/facebook/reply') && api.includes('/api/platforms/facebook/message-reply') && api.includes('/api/platforms/facebook/webhook-info'));

// 11) القدرة message_reply موجودة والمنصات الرسائلية تعلنها.
const registry = readFileSync(join(ROOT, 'engine/social/registry.ts'), 'utf8');
const adapter = readFileSync(join(ROOT, 'engine/social/adapter.ts'), 'utf8');
check('قدرة message_reply معرّفة في العقد', adapter.includes("'message_reply'"));
check('Telegram يعلن message_reply ولا يعلن comment_reply', registry.includes("capabilities: ['publish', 'messages', 'message_reply', 'scheduling']") && !registry.includes("capabilities: ['publish', 'messages', 'comment_reply'"));
// مسار التعليقات العام يوجّه منصات الرسائل بدل رسالة منع مضللة.
const socialRoutesSrc = readFileSync(join(ROOT, 'engine/social/routes.ts'), 'utf8');
check('مسار التعليقات يوجّه منصات الرسائل إلى message_reply', socialRoutesSrc.includes("supports('message_reply')") && socialRoutesSrc.includes('MESSAGE_PLATFORM_NOT_COMMENT'));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} social UI claim checks`);
}
