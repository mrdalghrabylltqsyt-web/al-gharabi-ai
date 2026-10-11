/**
 * اختبار ثابت: صندوق إفصاح YouTube الأصفر أُزيل من واجهة الموافقة.
 *
 * **تحديث (توحيد النشر بنقرة واحدة):** كان YouTube مستثنى من المنفّذ الموحّد
 * (`409 PLATFORM_USE_DEDICATED_PUBLISH`) ويُوجَّه لطابور منفصل. الآن YouTube
 * يُنشر **داخل** `POST /api/workspace/content/:id/publish` بنفس النقرة عبر
 * `executeYouTubePublish` (كل البوابات محفوظة). شرطه الوحيد: أن يحمل المنشور
 * فيديو فعلياً؛ بلا فيديو يرد `MEDIA_REQUIRED` صراحةً — ويُعرض ذلك **عند الفشل**
 * لا كنبذة صفراء دائمة قبل النشر (تنظيف نصوص فترة الاختبار).
 *
 * هذا الاختبار يثبت:
 *  1) الواجهة **لا** تعرض صندوق التنبيه الأصفر (لا استيراد ولا استخدام).
 *  2) الدالة النقية `youtubeDedicatedDisclosure` تبقى صحيحة (توافق خلفي للاختبارات).
 *  3) التوحيد الفعلي في الخادم: YouTube ينفّذ داخل المنفّذ الموحّد (لا استثناء).
 *  4) لا بوابة أُزيلت — نفس `executeYouTubePublish`.
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

// 1) الواجهة لم تعد تستورد أو تستدعي دالة الإفصاح (أُزيل الصندوق الأصفر).
check('لا يستورد youtubeDedicatedDisclosure', !/youtubeDedicatedDisclosure/.test(view));
check('لا يستدعي youtubeDedicatedDisclosure(post.targetPlatforms)', !view.includes('youtubeDedicatedDisclosure(post.targetPlatforms)'));
check('لا يبقى صندوق تنبيه أصفر لـYouTube', !/bg-amber-950\/40 border border-amber-500\/30 text-\[11px\] text-amber-200/.test(view));

// 2) الدالة النقية تبقى صحيحة (توافق خلفي — لا تُحذف).
{
  check('الإفصاح يعود null بلا يوتيوب', youtubeDedicatedDisclosure(['facebook', 'instagram']) === null);
  check('الإفصاح يعود null لمصفوفة فارغة', youtubeDedicatedDisclosure([]) === null);
  check('الإفصاح يعود null لغير مصفوفة (undefined)', youtubeDedicatedDisclosure(undefined) === null);
  check('الإفصاح يوتيوب وحده يُعلن صراحةً', youtubeDedicatedDisclosure(['youtube']) !== null);
  const disclosure = youtubeDedicatedDisclosure(['youtube', 'facebook']) || '';
  check('النص يذكر يوتيوب وشرط الفيديو', disclosure.includes('يوتيوب') && disclosure.includes('فيديو'), disclosure);
  check('النص المُعاد لم يعد يذكر الاستثناء القديم', !disclosure.includes('مستثنى'), disclosure);
}

// 3) التوحيد الفعلي في الخادم: YouTube لم يعد يُرجع PLATFORM_USE_DEDICATED_PUBLISH
//    بل ينفّذ executeYouTubePublish داخل المنفّذ الموحّد.
check('المنفّذ الموحّد يستدعي executeYouTubePublish لـYouTube', /platform === "youtube"[\s\S]{0,1400}executeYouTubePublish\(/.test(server));
check('لم يبقَ إرجاع PLATFORM_USE_DEDICATED_PUBLISH في المنفّذ الموحّد', !/platform === "youtube"[\s\S]{0,1400}code: "PLATFORM_USE_DEDICATED_PUBLISH"/.test(server));

// 4) لا تخفيف للحمايات: يواصل استخدام نفس بوابة executeYouTubePublish.
check('YouTube يستخدم نفس بوابة executeYouTubePublish (لا مسار جانبي)', server.includes('async function executeYouTubePublish'));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} approval YouTube pre-publish disclosure UI checks`);
}
