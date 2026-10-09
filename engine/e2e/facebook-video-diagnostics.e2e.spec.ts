/**
 * e2e — إثبات ظهور زرّي تشخيص نشر فيديو Facebook وعملهما فعلياً في متصفح حقيقي.
 *
 * الخلفية: مسارا فحص الصلاحيات (`/api/platforms/facebook/video-permission-diagnosis`)
 * وسجل النشر الفاشل (`/api/platforms/publish-diagnostics`) كانا في الخادم فقط بلا واجهة.
 * هذا الاختبار يثبت في متصفح حقيقي (لا فحص ملفات ساكن):
 *   1) الزرّان يظهران داخل بطاقة Facebook في «مركز ربط المنصات» (جلسة مالك).
 *   2) الضغط على «فحص صلاحيات نشر الفيديو» يستدعي المسار المحمي فعلاً ويعرض النتيجة
 *      بالعربية (الصلاحيات الممنوحة/الناقصة + جهوزية النشر).
 *   3) الضغط على «سجل تشخيص النشر الفاشل» يستدعي المسار المحمي فعلاً ويعرض سجلاً
 *      (المنصة + الرسالة الكاملة + الرمز).
 *
 * الاستجابات مُعترَضة (mock) لتبقى النتيجة حتمية بلا مزوّد خارجي؛ الطلب نفسه حقيقي
 * من الصفحة (نثبت أنه يحمل ترويسة Authorization) فلا يُختبَر الوهم.
 *
 * منفصل عن npm test (يحتاج متصفحاً): npx playwright test facebook-video-diagnostics
 */
import { test, expect } from '@playwright/test';

const PREVIEW_TOKEN = process.env.E2E_PREVIEW_TOKEN || 'e2e-preview-token-0123456789abcdef';

test('زرّا تشخيص نشر فيديو Facebook يظهران ويعملان في متصفح حقيقي', async ({ page }) => {
  const seen: { url: string; authorized: boolean }[] = [];

  // اعتراض الطلبين المحميين: نتحقق أن الطلب حقيقي ويحمل توكن جلسة المالك،
  // ثم نعيد نتيجة حتمية (لا مزوّد خارجي).
  await page.route('**/api/platforms/facebook/video-permission-diagnosis**', async (route) => {
    seen.push({ url: route.request().url(), authorized: !!route.request().headers()['authorization'] });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        isValid: true,
        tokenType: 'PAGE',
        grantedScopes: ['pages_manage_posts', 'pages_show_list'],
        missingVideoPublishScopes: ['pages_read_engagement'],
        requiredVideoPublishScopes: ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list'],
        videoPublishReady: false,
        reason: 'ناقصة pages_read_engagement',
        note: 'فحص مباشر من Meta بلا أي سرّ',
      }),
    });
  });
  await page.route('**/api/platforms/publish-diagnostics**', async (route) => {
    seen.push({ url: route.request().url(), authorized: !!route.request().headers()['authorization'] });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        count: 1,
        diagnostics: [{
          id: 'pub-1', platform: 'facebook', state: 'failed', executedAt: '2026-10-08T10:00:00.000Z',
          code: 'PERMISSION_DENIED', providerCode: 100, providerSubcode: 1234567, providerTraceId: 'AbCdEf12345',
          error: '(#100) No permission to publish the video',
        }],
        note: 'رسالة المزود الكاملة بلا أي سرّ',
      }),
    });
  });

  // جلسة مالك عبر مقطع رابط المعاينة (خادم حقيقي).
  await page.goto('about:blank');
  await page.goto(`/#preview_token=${PREVIEW_TOKEN}`);
  await expect(page.getByRole('heading', { name: /مرحباً .* دورة العمل في مكان واحد/ })).toBeVisible();

  // فتح «مركز ربط المنصات» (owner-only) عبر بحث التنقل الهرمي.
  await page.getByPlaceholder('بحث في الأقسام والوظائف…').fill('مركز ربط المنصات');
  await page.getByRole('button', { name: /مركز ربط المنصات/ }).first().click();
  await expect(page.getByRole('heading', { name: 'مركز ربط المنصات' })).toBeVisible();

  // 1) الزرّان ظاهران.
  const permBtn = page.getByRole('button', { name: 'فحص صلاحيات نشر الفيديو' });
  const diagBtn = page.getByRole('button', { name: 'سجل تشخيص النشر الفاشل' });
  await expect(permBtn).toBeVisible();
  await expect(diagBtn).toBeVisible();

  // 2) فحص الصلاحيات: يعرض النتيجة العربية (ناقص + غير جاهز + الصلاحيات الممنوحة).
  await permBtn.click();
  await expect(page.getByText('نشر فيديو الصفحة غير جاهز')).toBeVisible();
  await expect(page.getByText(/pages_read_engagement/).first()).toBeVisible();
  await expect(page.getByText(/الصلاحيات الممنوحة فعلاً/)).toBeVisible();

  // 3) سجل التشخيص: يعرض المنصة + الرسالة الكاملة + الرمز.
  await diagBtn.click();
  await expect(page.getByText(/سجل النشر الفاشل المحفوظ/)).toBeVisible();
  await expect(page.getByText(/No permission to publish the video/)).toBeVisible();
  await expect(page.getByText(/fbtrace=AbCdEf12345/)).toBeVisible();

  // الطلبان الحقيقيان حصلا ويحملان ترويسة تفويض المالك.
  expect(seen.length).toBeGreaterThanOrEqual(2);
  expect(seen.every((s) => s.authorized)).toBe(true);
});
