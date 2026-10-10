/**
 * اختبار انحدار أمني: عزل بيئات الاختبار + منع تمرير الرموز في URL (ISO-A / SEC-A).
 *
 * يمنع رجوع الفجوتين بشكل دائم:
 * 1) أي اختبار يُشغّل الخادم الحقيقي (server.cjs/server.ts) ويورّث `process.env`
 *    كاملاً دون حذف `DATABASE_URL` أو استخدام `buildServerTestEnv` — لأن ذلك يسمح
 *    للخادم المُقلع بالكتابة في قاعدة بيانات حية (تلوّث/تلف بيانات الإنتاج).
 * 2) أي عودة لتمرير رمز (id_token/access_token/token/secret) في سطر طلب URL داخل
 *    server.ts — يمنع تسرّبه إلى سجلات الوسيط/الـCDN.
 *
 * فحوص ثابتة (قراءة ملفات) + فحوص وحدة للـhelper. لا شبكة ولا أسرار.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildServerTestEnv, hasLiveDbEnv, LIVE_DB_ENV_KEYS } from './helpers/serverTestEnv';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const ROOT = process.cwd();
const TESTS_DIR = join(ROOT, 'engine', 'tests');

/** يجمع كل ملفات .test.ts (وأدلة dr الفرعية) بشكل متداخل. */
function collectTestFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) collectTestFiles(full, acc);
    else if (name.endsWith('.test.ts')) acc.push(full);
  }
  return acc;
}

// ---------------------------------------------------------------
// 1) عزل بيئات الاختبار: لا اختبار يشغّل الخادم بـprocess.env مكشوفاً
// ---------------------------------------------------------------
const spawnsServerRe = /dist\/server\.cjs|serverEntry|tsx[^\n]*server\.ts/;
const inheritsAllEnvRe = /env:\s*\{\s*\.\.\.process\.env|\.\.\.\(process\.env as Record/;
const isolatedRe = /buildServerTestEnv|delete env\.DATABASE_URL|delete env\[['"]DATABASE_URL['"]\]/;

const serverTests = collectTestFiles(TESTS_DIR).filter((f) => {
  const src = readFileSync(f, 'utf8');
  return spawnsServerRe.test(src) && /spawn\(/.test(src);
});

check('يوجد اختبارات تُشغّل الخادم (المجموعة غير فارغة)', serverTests.length > 5, `count=${serverTests.length}`);

const offenders = serverTests.filter((f) => {
  const src = readFileSync(f, 'utf8');
  return inheritsAllEnvRe.test(src) && !isolatedRe.test(src);
});
check(
  'لا اختبار يُشغّل الخادم يورّث process.env دون عزل قاعدة البيانات',
  offenders.length === 0,
  offenders.join(', '),
);

// نفس الفحص لكل ملفات الاختبار (وليس فقط المُشغّلة للخادم): أي وراثة env يجب أن
// تكون مصحوبة بعزل. نستثني helper نفسه (مصدر العزل).
const allTests = collectTestFiles(TESTS_DIR).filter((f) => !f.endsWith('helpers/serverTestEnv.ts'));
const anyInheritNoIsolation = allTests.filter((f) => {
  const src = readFileSync(f, 'utf8');
  return inheritsAllEnvRe.test(src) && !isolatedRe.test(src);
});
check(
  'لا ملف اختبار يورّث البيئة كاملة دون عزل',
  anyInheritNoIsolation.length === 0,
  anyInheritNoIsolation.join(', '),
);

// ---------------------------------------------------------------
// 2) منع تمرير الرموز في سطر الطلب داخل server.ts (SEC-A)
// ---------------------------------------------------------------
const serverSrc = readFileSync(join(ROOT, 'server.ts'), 'utf8');
check('server.ts بلا tokeninfo?id_token (التحقق لم يعد يمرّر الرمز في URL)', !/tokeninfo\?id_token=/.test(serverSrc));
check('server.ts بلا revoke?token= (الإبطال في الجسم لا في URL)', !/revoke\?token=/.test(serverSrc));
check('server.ts بلا id_token= في أي URL', !/id_token=\$\{/.test(serverSrc));
// لا رمز Google في سطر طلب أي نقطة على googleapis.com
check('لا رمز Google في URL لنقاط googleapis', !/googleapis\.com\/[^\n`]*[?&](id_token|token|access_token)=\$\{/.test(serverSrc));
// تحقق أن المسار يستخدم المُتحقّق المحلي
check('مسار Google يستخدم verifyIdToken المحلي', /verifyIdToken\(/.test(serverSrc) && /googleVerifier\(\)/.test(serverSrc));
// سجل الخطأ مُنقّى
check('سجل خطأ Google مُنقّى (لا كائن خطأ خام)', /safeErrorMessage\(err/.test(serverSrc) && !/console\.error\(\s*["']Google auth error["'],\s*err\s*\)/.test(serverSrc));

// ---------------------------------------------------------------
// 3) فحوص وحدة للـhelper
// ---------------------------------------------------------------
const built = buildServerTestEnv({ prefix: 'gharabi-unit-', overrides: { PORT: '1234' } });
check('buildServerTestEnv يحذف كل متغيّرات قاعدة البيانات الحية', !hasLiveDbEnv(built), LIVE_DB_ENV_KEYS.join(','));
check('buildServerTestEnv يثبّت STATE_DIR مؤقتاً', Boolean(built.STATE_DIR) && built.STATE_DIR.includes('gharabi-unit-'));
check('buildServerTestEnv يطبّق overrides', built.PORT === '1234');
check('buildServerTestEnv يُزيل علامات المضيف العابر (RENDER)', !('RENDER' in built));
const explicit = buildServerTestEnv({ stateDir: '/tmp/x', overrides: {} });
check('buildServerTestEnv يحترم stateDir الصريح', explicit.STATE_DIR === '/tmp/x');

// ---------------------------------------------------------------
console.log(`\nPASSED: ${passed} test-isolation & credential-in-url regression checks`);
if (failures.length > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
