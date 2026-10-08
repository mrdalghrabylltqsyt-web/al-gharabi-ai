/**
 * اختبار صدق قائمة منصات الفيديو في مركز صناعة المحتوى (ContentEngineView).
 *
 * سبب الوجود: كانت الواجهة تصنّف فيسبوك وثريدز ضمن «غير مدعوم» (تحذير أحمر خاطئ
 * «لا يدعمان نشر فيديو حالياً») رغم أن الخادم يدعمهما فعلياً بنفس آلية الرابط العام
 * (فيسبوك Task #22 عبر POST /{page-id}/videos، ثريدز Task #24 عبر حاوية الوسائط).
 * الاختبار يثبت:
 *  1) قائمة المنصات المدعومة برابط عام تضم الأربع (instagram/tiktok/facebook/threads).
 *  2) فيسبوك/ثريدز يقعان في فئة «يحتاج رابطاً عاماً» (تحذير أصفر) لا «غير مدعوم» (أحمر).
 *  3) التوزيع الموحّد في server.ts يمرّر videoUrl لكل منصة (لا مسار خاص بإنستغرام/تيك توك).
 *  4) موصل فيسبوك/ثريدز يستهلك videoUrl فعلاً (file_url/VIDEO).
 *
 * فحوص ثابتة على الملفات المصدرية — بلا خادم ولا مزود ولا سرّ.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const ROOT = process.cwd();
const view = readFileSync(join(ROOT, 'src/components/content/ContentEngineView.tsx'), 'utf8');
const server = readFileSync(join(ROOT, 'server.ts'), 'utf8');
const facebook = readFileSync(join(ROOT, 'engine/social/facebook.ts'), 'utf8');
const threads = readFileSync(join(ROOT, 'engine/social/threads.ts'), 'utf8');

/** يستخرج مصفوفة نصية من تعريف ثابت في المصدر. */
function extractList(source: string, constName: string): string[] {
  const re = new RegExp(`const ${constName}\\s*:[^=]*=\\s*\\[([^\\]]*)\\]`);
  const m = source.match(re);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

group('1) قائمة منصات الفيديو في الواجهة مطابقة لدعم الخادم');
const realUpload = extractList(view, 'VIDEO_REAL_UPLOAD_PLATFORMS');
const publicUrl = extractList(view, 'VIDEO_PUBLIC_URL_PLATFORMS');
check('الرفع الحقيقي المباشر ليوتيوب فقط', realUpload.length === 1 && realUpload[0] === 'youtube', realUpload.join(','));
check('الرابط العام يضم إنستغرام', publicUrl.includes('instagram'), publicUrl.join(','));
check('الرابط العام يضم تيك توك', publicUrl.includes('tiktok'), publicUrl.join(','));
check('الرابط العام يضم فيسبوك (Task #22)', publicUrl.includes('facebook'), publicUrl.join(','));
check('الرابط العام يضم ثريدز (Task #24)', publicUrl.includes('threads'), publicUrl.join(','));
check('القائمة هي الأربع بالضبط', publicUrl.length === 4, publicUrl.join(','));

group('2) فئات العرض الثلاث تعكس الواقع (أصفر لا أحمر لفيسبوك/ثريدز)');
// نفس منطق الفلترة المستخدم في المكوّن.
const capable = (p: string) => realUpload.includes(p);
const urlNeeded = (p: string) => publicUrl.includes(p);
const unsupported = (p: string) => !capable(p) && !urlNeeded(p);
for (const p of ['facebook', 'threads']) {
  check(`${p}: في فئة «يحتاج رابطاً عاماً» (أصفر)`, urlNeeded(p) === true, `${p}`);
  check(`${p}: ليس في فئة «غير مدعوم» (أحمر)`, unsupported(p) === false, `${p}`);
}
check('يوتيوب في فئة الرفع الحقيقي (أخضر)', capable('youtube') && !urlNeeded('youtube'));
check('تيليغرام/إكس (بلا نشر فيديو) في فئة «غير مدعوم»', unsupported('telegram') && unsupported('x'));

group('3) نص التحذير الأصفر لا ينفي دعم فيسبوك/ثريدز');
check('لا نص ثنائي مضلّل «لا يقبلان»', !/لا يقبلان/.test(view));
check('لا نص «لا يدعمان نشر فيديو» أحمر على فيسبوك/ثريدز', !/لا يدعمان/.test(view));
check('النص الأصفر يعلن الحاجة لرابط عام', /رابط فيديو عام/.test(view));

group('4) التوزيع الموحّد في الخادم يمرّر videoUrl لكل منصة (لا استثناء)');
check('المسار الموحّد موجود', server.includes('/api/workspace/content/:id/publish'));
// الوسيط يُبنى عاماً من post.mediaUrl/mediaType ويُمرَّر داخل حلقة المنصات بلا شرط على اسم المنصة.
check('mediaFields تُبنى من نوع الوسيط الفعلي', /mediaFields\.videoUrl\s*=\s*mediaUrl/.test(server));
check('mediaFields تُمرَّر إلى executePlatformPublish بلا شرط منصة', /\{ \.\.\.req\.body, \.\.\.mediaFields/.test(server));
check('لا استثناء منصة في بناء الوسيط (لا قائمة إنستغرام/تيك توك)', !/mediaFields[\s\S]{0,200}(instagram|tiktok)\s*===/.test(server));

group('5) موصلات فيسبوك/ثريدز تستهلك رابط الفيديو فعلاً');
check('فيسبوك ينشر فيديو عبر file_url', facebook.includes('buildPublishVideoBody') && /file_url/.test(facebook));
check('فيسبوك يستدعي POST /{page-id}/videos', facebook.includes('publishVideoToPage') && facebook.includes('/videos'));
check('ثريدز يبني media_type=VIDEO من videoUrl', threads.includes("media_type', 'VIDEO'") || threads.includes('media_type=VIDEO') || /media_type['"]?\s*,\s*['"]VIDEO/.test(threads));
check('ثريدز يحفظ video_url', threads.includes('video_url'));

console.log('\n' + '='.repeat(60));
if (failures.length === 0) { console.log(`PASSED: ${passed} content video-platform checks`); process.exit(0); }
console.error(`FAILED: ${failures.length} / ${passed + failures.length}`); failures.forEach((f) => console.error(' - ' + f)); process.exit(1);
