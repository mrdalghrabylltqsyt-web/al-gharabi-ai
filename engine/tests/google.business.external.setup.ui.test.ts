/**
 * اختبار زر «إكمال الإعداد الخارجي» لـGoogle Business Profile.
 *
 * الفجوة المُصلَحة: كان الزر **وسماً ثابتاً** (span) لا يفعل شيئاً عند
 * `state === 'EXTERNAL_SETUP_REQUIRED'` — وهي بالضبط حالة Google Business/X/Snapchat
 * (بلا موصل منفّذ). فلم يستطع المالك بدء ربط OAuth رغم توفّر اعتماد Google.
 *
 * الإصلاح: الزر صار **زراً حقيقياً** يبدأ OAuth عبر `startOAuth(platform)` (المسار
 * `/api/platforms/:platform/oauth/start` عبر apiService.startPlatformOAuth) متى كان
 * `oauthAvailable=true` (البنية تدعم OAuth + بيانات الاعتماد مضبوطة). وعند نقص
 * الاعتماد يبقى وسماً تشخيصياً يذكر الأسماء المطلوبة بدل إرسال المالك إلى مسار 503.
 *
 * فحوص ثابتة على المصدر — بلا شبكة ولا مزود ولا حصة.
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
const center = readFileSync(join(ROOT, 'src/components/social/PlatformConnectionCenter.tsx'), 'utf8');
const api = readFileSync(join(ROOT, 'src/services/api.ts'), 'utf8');
const server = readFileSync(join(ROOT, 'server.ts'), 'utf8');
const operations = readFileSync(join(ROOT, 'engine/social/operations.ts'), 'utf8');
const credentials = readFileSync(join(ROOT, 'engine/social/credentials.ts'), 'utf8');
const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8');
const renderYaml = readFileSync(join(ROOT, 'render.yaml'), 'utf8');

// 1) الزر صار فعّالاً وقابلاً للنقر عند توفّر الاعتماد.
check('شرط الزر يعتمد على oauthAvailable', center.includes('needsExternal && p.oauthAvailable'));
check('الزر يستدعي startOAuth(platform)', /needsExternal && p\.oauthAvailable[\s\S]{0,400}?startOAuth\(p\.platform\)/.test(center));
check('عنوان الزر «إكمال الإعداد الخارجي» محفوظ', center.includes('إكمال الإعداد الخارجي'));
check('الزر يحمل onClick وdisabled حالة الانشغال', /onClick=\{\(\) => void startOAuth\(p\.platform\)\} disabled=\{busy === p\.platform\}/.test(center));
check('لا يزال يظهر للمنصة عند نقص الاعتماد (وسم تشخيصي)', /needsExternal \? \([\s\S]{0,800}?إكمال الإعداد الخارجي \(يبدأ بعد ضبط الاعتماد\)/.test(center));

// 2) المكوّن يقرأ مصدر الحالة الحقيقي (control-plane) ويبدأ OAuth عبر apiService.
check('الحالة تُقرأ من control-plane', api.includes("'/api/platforms/control-plane'"));
check('startPlatformOAuth تستهدف مسار البدء المعتمد', api.includes('/oauth/start'));
check('apiService يمرّر Authorization', /startPlatformOAuth[\s\S]{0,200}?getAuthHeaders\(\)/.test(api));

// 3) الخادم: oauthAvailable يُحسب من دعم OAuth + ضبط الاتصال.
check('oauthAvailable معرّف في نوع الحالة', operations.includes('oauthAvailable: boolean'));
check('oauthAvailable = دعم OAuth + اعتماد مضبوط', /oauthAvailable:\s*readiness\.oauth\s*!==\s*'NOT_SUPPORTED'\s*&&\s*connectionConfigured/.test(operations));

// 4) اعتماد Google Business يُقرأ من متغيراته الصحيحة (الخاصة أو المشتركة).
check('OAUTH_CONFIG لـgoogle_business يقرأ GOOGLE_BUSINESS_OAUTH_CLIENT_ID',
  /google_business:\s*\{[\s\S]{0,900}?GOOGLE_BUSINESS_OAUTH_CLIENT_ID/.test(server));
check('والسرّ GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET',
  /google_business:\s*\{[\s\S]{0,900}?GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET/.test(server));
check('البديل GOOGLE_BUSINESS_CLIENT_ID مقبول',
  /google_business:\s*\{[\s\S]{0,900}?GOOGLE_BUSINESS_CLIENT_ID/.test(server));
check('يسقط لاعتماد Google المشترك (GOOGLE_OAUTH_CLIENT_ID) عند غياب الخاص',
  /GOOGLE_BUSINESS_OAUTH_CLIENT_ID"\)\s*\|\|\s*envSecret\("GOOGLE_BUSINESS_CLIENT_ID"\)\s*\|\|\s*envSecret\("GOOGLE_OAUTH_CLIENT_ID"\)/.test(server));
check('نطاق Business Profile الصحيح مطلوب',
  server.includes('https://www.googleapis.com/auth/business.manage'));

// 5) مسار البدء المعتمد + alias google-business/oauth/connect مُسجّلان بنفس المنفّذ.
check('مسار /oauth/connect alias مُسجّل', server.includes('"/api/platforms/:platform/oauth/connect", requireOwner, handleOAuthStart'));
check('مسار البدء المعتمد /oauth/start مُسجّل', server.includes('"/api/platforms/:platform/oauth/start", requireOwner, handleOAuthStart'));
check('المعرّف المفصول بشرطة يُطبّع للمعرّف القانوني', /platform\s*=\s*String\(req\.params\.platform\s*\|\|\s*""\)\.replace\(\/-\/g,\s*"_"\)/.test(server));
check('لا مسار بدء ثانٍ مكرّر بالكامل (منفّذ واحد)', (server.match(/handleOAuthStart/g) || []).length >= 3);

// 6) credentials.ts يعلن البدائل فلا تُعدّ Google Business «ناقصة» عند ضبط Google المشترك.
check('google_business في CREDENTIAL_SPECS يحمل بدائل', /google_business:\s*\{[\s\S]{0,700}?alternatives:/.test(credentials));
check('البديل يذكر GOOGLE_OAUTH_CLIENT_ID', /GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_BUSINESS_OAUTH_CLIENT_ID'/.test(credentials));

// 7) التوثيق: المتغيرات في .env.example وrender.yaml بلا أي قيمة سرّية.
check('.env.example يوثّق GOOGLE_BUSINESS_OAUTH_CLIENT_ID', envExample.includes('GOOGLE_BUSINESS_OAUTH_CLIENT_ID='));
check('.env.example يوثّق GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET', envExample.includes('GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET='));
check('render.yaml يعرّف GOOGLE_BUSINESS_OAUTH_CLIENT_ID', renderYaml.includes('key: GOOGLE_BUSINESS_OAUTH_CLIENT_ID'));
check('render.yaml يعرّف GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET', renderYaml.includes('key: GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET'));

// 8) لا تغيير في بقية المنصات: مسار YouTube يبقى على GOOGLE_OAUTH_CLIENT_ID وحده.
check('YouTube لم يمسّ بدائل Google Business',
  /youtube:\s*\{\s*provider:\s*"google"[\s\S]{0,400}?envSecret\("GOOGLE_OAUTH_CLIENT_ID"\)\s*\|\|\s*envSecret\("GOOGLE_CLIENT_ID"\)[\s\S]{0,120}?clientSecret:\s*envSecret\("GOOGLE_OAUTH_CLIENT_SECRET"\)/.test(server));
check('Threads/Snapchat لم تُمسّ (مرجع المنصتين قائم)', server.includes('threads: { provider: "meta"') && server.includes('snapchat: { provider: "snapchat"'));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} Google Business external-setup UI checks`);
}
