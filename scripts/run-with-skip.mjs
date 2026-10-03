#!/usr/bin/env node
/**
 * مشغّل اختبار يتسامح مع «التخطّي المميّز» (exit 2) دون إخفاء الفشل.
 *
 * لماذا: بعض اختبارات التكامل الحقيقية (Postgres معزول، اختبار التعافي الحقيقي)
 * تتخطّى نفسها عند غياب أداة/قاعدة اختبار، وكانت تُخرج 0 فتبدو كأنها اجتازت في CI.
 * الآن تُخرج 2 (تخطٍّ صريح)، وهذا المشغّل يحوّل 2 إلى نجاح (0) مع طبع تنبيه واضح،
 * ويُبقي أي فشل حقيقي (1 أو غير ذلك) فاشلاً. فلا كسر لسلسلة `npm test` (&&) ولا ادّعاء
 * اجتياز كاذب — التخطّي يظهر صراحةً في السجل.
 *
 * الاستخدام: node scripts/run-with-skip.mjs <script-npm>
 */
import { spawnSync } from 'node:child_process';

const script = process.argv[2];
if (!script) {
  console.error('الاستخدام: node scripts/run-with-skip.mjs <script-npm>');
  process.exit(1);
}

const res = spawnSync('npm', ['run', script], { stdio: 'inherit', shell: process.platform === 'win32' });
const code = res.status === null ? 1 : res.status;

if (code === 0) process.exit(0);
if (code === 2) {
  console.warn(`\n[run-with-skip] "${script}" SKIPPED (exit 2) — لم يُشغَّل فعلياً (بيئة/قاعدة اختبار غير متوفرة). يُعدّ غير فاشل.`);
  process.exit(0);
}
process.exit(code);
