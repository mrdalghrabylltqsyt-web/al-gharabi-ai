/**
 * اختبار ثابت: إفصاح يوتيوب **قبل** زر النشر الموحّد في نظام الموافقة.
 *
 * الجذر المُثبت (لا تخمين): يوتيوب مستثنى من المنفّذ الموحّد (يحتاج بايتات الفيديو
 * عبر videos.insert resumable لا رابطاً نصياً)، وكان ذلك يظهر للمالك فقط كرسالة نتيجة
 * **بعد** النشر («لا فشل هنا») — فيبقى استثناءه مبهماً ويخالف الاتفاق بأن يكون زراً
 * واحداً يوزّع على كل المنصات. القرار التقني: إبقاء الفصل (خيار ب) لأنه آمن (الرفع
 * الفعلي لا يناسب نقرة فورية) مع **إفصاح صريح عند الزر نفسه**. هذا الاختبار يثبت:
 *  1) الإفصاح يُعرض في ApprovalWorkflowView قبل نقر النشر (شرط الحالة approved/scheduled).
 *  2) الإفصاح مبني على `youtubeDedicatedDisclosure(post.targetPlatforms)` (لا نص ثابت أعمى).
 *  3) الحمايات لم تُخفّف: لم تُضف أي حالة «نشر يوتيوب فوري» ولا تخفيف بوابات.
 *
 * فحص ثابت على المصدر — بلا شبكة ولا سرّ.
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
const view = readFileSync(join(ROOT, 'src/components/approval/ApprovalWorkflowView.tsx'), 'utf8');
const helper = readFileSync(join(ROOT, 'src/utils/publishResult.ts'), 'utf8');

// 1) الاستيراد والاستخدام الفعلي للدالة المشتركة.
check('يستورد youtubeDedicatedDisclosure من publishResult', /import\s*\{[^}]*youtubeDedicatedDisclosure[^}]*\}\s*from\s*'\.\.\/\.\.\/utils\/publishResult'/.test(view));
check('يستدعي youtubeDedicatedDisclosure(post.targetPlatforms)', view.includes('youtubeDedicatedDisclosure(post.targetPlatforms)'));

// 2) الإفصاح يظهر فقط في مرحلتي ما قبل النشر (approved/scheduled) ولا يُعرض للجميع.
check('الإفصاح مقيّد بحالتي approved/scheduled', /post\.status === 'approved' \|\| post\.status === 'scheduled'[\s\S]{0,200}youtubeDedicatedDisclosure\(post\.targetPlatforms\)/.test(view));

// 3) الإفصاح يسبق زر النشر في ترتيب المصدر (قبل handlePublishNow في نفس اللوحة).
const disclosureIdx = view.indexOf('youtubeDedicatedDisclosure(post.targetPlatforms)');
const publishBtnIdx = view.indexOf('نشر الآن فوراً');
check('الإفصاح يظهر قبل زر «نشر الآن فوراً»', disclosureIdx >= 0 && publishBtnIdx >= 0 && disclosureIdx < publishBtnIdx, `disclosure=${disclosureIdx} button=${publishBtnIdx}`);

// 4) النص العربي واضح للمالك (يذكر يوتيوب + الطابور + بقية المنصات).
check('النص يذكر يوتيوب', helper.includes('يوتيوب'));
check('النص يذكر الطابور المخصص', /\u0637\u0627\u0628\u0648\u0631/.test(helper) && helper.includes('طابور'));
check('النص يوضّح أن بقية المنصات تُنشر الآن', helper.includes('بقية المنصات'));
check('النص يذكر سبب الفصل (بايتات الملف/مهلة أطول)', helper.includes('بايتات الملف'));

// 5) لا تخفيف للحمايات: لا مسار نشر يوتيوب فوري ولا إزالة لإشارة المنفّذ الموحّد.
check('لا يُضاف نشر يوتيوب فوري في الواجهة', !view.includes('publishYouTubeNow') && !view.includes('/api/platforms/youtube/publish'));
check('يوتيوب يبقى موسوماً بمساره المخصص', helper.includes('PLATFORM_USE_DEDICATED_PUBLISH'));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} approval YouTube pre-publish disclosure UI checks`);
}
