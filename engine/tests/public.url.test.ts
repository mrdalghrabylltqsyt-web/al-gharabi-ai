/**
 * اختبار تحديد العنوان العام (Public URL) ومسار رفض Meta لرابط الإرجاع.
 *
 * يثبت الجذر الفعلي لفشل OAuth على الإنتاج: كان redirect_uri يُبنى من APP_URL
 * وحدها، فإن غابت على Render صار localhost فيرفضه Meta بـ«لا يمكن تحميل عنوان
 * URL / النطاق غير مُضمَّن في نطاقات التطبيق». هنا نثبت:
 *  - حسم العنوان من APP_URL ثم بدائل المنصة (RENDER_EXTERNAL_URL/HOSTNAME/PUBLIC_URL/VERCEL_URL).
 *  - لا رجوع صامت من عنوان صريح غير صالح إلى عنوان أدنى (حتى لا نُخفي السبب).
 *  - رفض http على نطاق عام، وقبول localhost للتطوير فقط.
 *  - بناء redirect_uri بالضبط، ومطابقته للنطاق الذي يجب تسجيله في App Domains.
 *  - أن الخادم يعرض الرابط الدقيق في عقد مسار oauth/setup وفي /api/health.
 *
 * منطق خالص بلا شبكة ولا مزود.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePublicUrl, inspectPublicUrlCandidate, isLocalHost, publicBaseUrl } from '../social/publicUrl';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();
const serverSource = readFileSync(join(REPO_ROOT, 'server.ts'), 'utf8');

function run(): void {
  group('1) فحص مرشّح واحد — القبول والرفض الصريح');
  check('https على نطاق عام صالح', inspectPublicUrlCandidate('APP_URL', 'https://gallery.example.com').valid);
  check('http على نطاق عام مرفوض', !inspectPublicUrlCandidate('APP_URL', 'http://gallery.example.com').valid);
  check('localhost مسموح (تطوير)', inspectPublicUrlCandidate('APP_URL', 'http://localhost:3000').valid);
  check('127.0.0.1 مسموح (تطوير)', inspectPublicUrlCandidate('APP_URL', 'http://127.0.0.1:4517').valid);
  check('رابط بمسار مرفوض', !inspectPublicUrlCandidate('APP_URL', 'https://host/app').valid);
  check('رابط باستعلام مرفوض', !inspectPublicUrlCandidate('APP_URL', 'https://host?x=1').valid);
  check('قيمة غير مطلقة مرفوضة', !inspectPublicUrlCandidate('APP_URL', 'not-a-url').valid);
  check('مخطّط غير http مرفوض', !inspectPublicUrlCandidate('APP_URL', 'ftp://host').valid);
  check('isLocalHost يميّز المحلي', isLocalHost('localhost') && isLocalHost('127.0.0.1') && !isLocalHost('gallery.example.com'));

  group('2) حسم العنوان — APP_URL يفوز');
  const appOnly = resolvePublicUrl({ APP_URL: 'https://app.example.com', RENDER_EXTERNAL_URL: 'https://render.example.com' });
  check('APP_URL يسبق بدائل المنصة', appOnly.baseUrl === 'https://app.example.com' && appOnly.source === 'APP_URL');
  check('host والسكيمة صحيحان', appOnly.host === 'app.example.com' && appOnly.scheme === 'https' && appOnly.valid);

  group('3) بدائل المنصة عندما تغيب APP_URL (جذر فشل Render)');
  const renderUrl = resolvePublicUrl({ RENDER_EXTERNAL_URL: 'https://svc.onrender.com' });
  check('RENDER_EXTERNAL_URL يُحسم عند غياب APP_URL', renderUrl.baseUrl === 'https://svc.onrender.com' && renderUrl.source === 'RENDER_EXTERNAL_URL', JSON.stringify(renderUrl));
  const renderHost = resolvePublicUrl({ RENDER_EXTERNAL_HOSTNAME: 'svc.onrender.com' });
  check('RENDER_EXTERNAL_HOSTNAME يُحوَّل إلى https', renderHost.baseUrl === 'https://svc.onrender.com' && renderHost.source === 'RENDER_EXTERNAL_HOSTNAME');
  const vercel = resolvePublicUrl({ VERCEL_URL: 'myapp.vercel.app' });
  check('VERCEL_URL يُحوَّل إلى https', vercel.baseUrl === 'https://myapp.vercel.app');
  const publicUrl = resolvePublicUrl({ PUBLIC_URL: 'https://public.example.com' });
  check('PUBLIC_URL مدعوم', publicUrl.baseUrl === 'https://public.example.com' && publicUrl.source === 'PUBLIC_URL');

  group('4) لا رجوع صامت من عنوان صريح غير صالح');
  const invalidApp = resolvePublicUrl({ APP_URL: 'http://insecure.example.com', RENDER_EXTERNAL_URL: 'https://svc.onrender.com' });
  check('APP_URL غير صالح لا يُستبدل صامتاً ببديل أدنى', invalidApp.valid === false && invalidApp.baseUrl === null, JSON.stringify(invalidApp));
  check('سبب المشكلة يُعلَن صراحةً', invalidApp.problems.length === 1 && invalidApp.problems[0].includes('APP_URL'));
  check('المرشّحات تُعرض ليُشخّص المالك المصدر', invalidApp.candidates.some((c) => c.source === 'APP_URL' && !c.valid && c.raw !== null));

  group('5) localhost عند غياب كل شيء (تطوير)');
  const local = resolvePublicUrl({ PORT: '4517' });
  check('بلا أي متغير => localhost للتطوير', local.baseUrl === 'http://localhost:4517' && local.scheme === 'http' && isLocalHost(local.host!));
  const localDefault = resolvePublicUrl({});
  check('بلا PORT => 3000 افتراضي', localDefault.baseUrl === 'http://localhost:3000');

  group('6) ترويسات الوسيط كخيار أخير');
  const hdrs = resolvePublicUrl({}, { forwardedProto: 'https', forwardedHost: 'proxy.example.com' });
  check('X-Forwarded-Host/Proto يُحسمان عند غياب المتغيرات', hdrs.baseUrl === 'https://proxy.example.com' && hdrs.source.includes('headers'), JSON.stringify(hdrs));
  const hdrsPlain = resolvePublicUrl({}, { host: 'plain.example.com' });
  check('Host العادي يُستخدم كخيار أخير', hdrsPlain.baseUrl === 'https://plain.example.com');

  group('7) شراء النطاق الذي يجب تسجيله في Meta App Domains');
  const fbEnv = resolvePublicUrl({ APP_URL: 'https://al-gharabi-ai.onrender.com' });
  const redirectUri = `${fbEnv.baseUrl}/api/platforms/facebook/oauth/callback`;
  check('redirect_uri الدقيق يُبنى صحيحاً', redirectUri === 'https://al-gharabi-ai.onrender.com/api/platforms/facebook/oauth/callback', redirectUri);
  check('نطاق App Domains مطابق لمضيف redirect_uri', fbEnv.host === 'al-gharabi-ai.onrender.com');
  check('publicBaseUrl مكافئ لـresolvePublicUrl().baseUrl', publicBaseUrl({ APP_URL: 'https://x.example.com' }) === 'https://x.example.com');

  group('8) عقد الخادم — العنوان العام مصدر واحد');
  check('server يستورد resolvePublicUrl من publicUrl', serverSource.includes('from "./engine/social/publicUrl"') && serverSource.includes('resolvePublicUrl'));
  check('لا يبنى BASE_URL من APP_URL وحدها بعد الآن', !/const BASE_URL = \(process\.env\.APP_URL/.test(serverSource), 'يجب ألا يستخدم BASE_URL القديم');
  check('redirect_uri يُبنى عبر oauthCallbackUrl', serverSource.includes('function oauthCallbackUrl') && serverSource.includes('redirectUri:callbackUrl'));
  check('مسارات webhook تُبنى من العنوان العام المعتمد', serverSource.includes('`${publicBaseUrlNow()}/api/platforms/facebook/webhook`') && serverSource.includes('`${publicBaseUrlNow()}/api/platforms/telegram/webhook`'));
  check('مسار oauth/start يرفض العنوان غير العام صراحةً', serverSource.includes('PUBLIC_URL_NOT_PUBLIC'));
  check('مسار oauth/setup يعرض redirectUri و appDomainsValue', serverSource.includes('/api/platforms/:platform/oauth/setup') && serverSource.includes('appDomainsValue'));
  check('/api/health يعرض كتلة publicUrl', serverSource.includes('publicUrl: (() =>') && serverSource.includes('isPublic:'));
}

run();
console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} public URL checks`);
}
