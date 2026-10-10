/**
 * اختبار ثابت: إفصاح YouTube **قبل** زر النشر الموحّد في نظام الموافقة.
 *
 * **تحديث (توحيد النشر بنقرة واحدة):** كان YouTube مستثنى من المنفّذ الموحّد
 * (`409 PLATFORM_USE_DEDICATED_PUBLISH`) ويُوجَّه لطابور منفصل. الآن YouTube
 * يُنشر **داخل** `POST /api/workspace/content/:id/publish` بنفس النقرة عبر
 * `executeYouTubePublish` (كل البوابات محفوظة). شرطه الوحيد: أن يحمل المنشور
 * فيديو فعلياً؛ بلا فيديو يرد `MEDIA_REQUIRED` صراحةً. هذا الاختبار يثبت:
 *  1) الإفصاح يُعرض في ApprovalWorkflowView قبل نقر النشر (approved/scheduled).
 *  2) الإفصاح مبني على `youtubeDedicatedDisclosure(post.targetPlatforms)`.
 *  3) النص لم يعد يذكر «الاستثناء» بل شرط الفيديو وأنه ضمن نفس النقرة.
 *  4) لا ادعاء «نشر فوري بلا حماية» — لا بوابة أُزيلت.
 *
 * فحص ثابت على المصدر — بلا شبكة ولا سرّ.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { youtubeDedicatedDisclosure } from '../../src/utils/publishResult';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const ROOT = process.cwd();
const view = readFileSync(join(ROOT, 'src/components/approval/ApprovalWorkflowView.tsx'), 'utf8');
const server = readFileSync(join(ROOT, 'server.ts'), 'utf8');

// 1) الاستيراد والاستخدام الفعلي للدالة المشتركة.
check('يستورد youtubeDedicatedDisclosure من publishResult', /import\s*\{[^}]*youtubeDedicatedDisclosure[^}]*\}\s*from\s*'\.\.\/\.\.\/utils\/publishResult'/.test(view));
check('يستدعي youtubeDedicatedDisclosure(post.targetPlatforms)', view.includes('youtubeDedicatedDisclosure(post.targetPlatforms)'));

// 2) الإفصاح يظهر فقط في مرحلتي ما قبل النشر (approved/scheduled) ولا يُعرض للجميع.
check('الإفصاح مقيّد بحالتي approved/scheduled', /post\.status === 'approved' \|\| post\.status === 'scheduled'[\s\S]{0,200}youtubeDedicatedDisclosure\(post\.targetPlatforms\)/.test(view));

// 3) الإفصاح يسبق زر النشر في ترتيب المصدر (قبل handlePublishNow في نفس اللوحة).
const disclosureIdx = view.indexOf('youtubeDedicatedDisclosure(post.targetPlatforms)');
const publishBtnIdx = view.indexOf('نشر الآن فوراً');
check('الإفصاح يظهر قبل زر «نشر الآن فوراً»', disclosureIdx >= 0 && publishBtnIdx >= 0 && disclosureIdx < publishBtnIdx, `disclosure=${disclosureIdx} button=${publishBtnIdx}`);

// 4) النص العربي الفعلي المُعاد واضح: يذكر يوتيوب + ضمن النقرة + شرط الفيديو، ولا يذكر الاستثناء.
{
  const disclosure = youtubeDedicatedDisclosure(['youtube', 'facebook']) || '';
  check('النص يذكر يوتيوب', disclosure.includes('يوتيوب'), disclosure);
  check('النص يُصرّح بأن يوتيوب ضمن نفس النقرة', disclosure.includes('نقرة'), disclosure);
  check('النص يذكر شرط الفيديو', disclosure.includes('فيديو'), disclosure);
  check('النص المُعاد لم يعد يذكر الاستثناء القديم', !disclosure.includes('مستثنى'), disclosure);
}

// 5) التوحيد الفعلي في الخادم: YouTube لم يعد يُرجع PLATFORM_USE_DEDICATED_PUBLISH
//    بل ينفّذ executeYouTubePublish داخل المنفّذ الموحّد.
check('المنفّذ الموحّد يستدعي executeYouTubePublish لـYouTube', /platform === "youtube"[\s\S]{0,1400}executeYouTubePublish\(/.test(server));
check('لم يبقَ إرجاع PLATFORM_USE_DEDICATED_PUBLISH في المنفّذ الموحّد', !/platform === "youtube"[\s\S]{0,1400}code: "PLATFORM_USE_DEDICATED_PUBLISH"/.test(server));

// 6) لا تخفيف للحمايات: يواصل استخدام نفس بوابة executeYouTubePublish.
check('YouTube يستخدم نفس بوابة executeYouTubePublish (لا مسار جانبي)', server.includes('async function executeYouTubePublish'));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} approval YouTube pre-publish disclosure UI checks`);
}
