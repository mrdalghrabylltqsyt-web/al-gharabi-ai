/**
 * e2e — دليل تشغيل حقيقي أن صفحة «مركز ربط المنصات» (PlatformConnectionCenter)
 * تُصيَّر فعلاً في متصفح حقيقي بلا خطأ React.
 *
 * الخلفية: كان useEffect الخاص بمعالجة عودة OAuth موضوعاً خطأً **داخل** دالة async
 * (load) الممرَّرة إلى useCallback، فيُستدعى عند كل زيارة للصفحة ويسبب خطأ React
 * وقت التشغيل «Invalid hook call» يعطّل الصفحة. tsc لا يكشف هذا؛ يكشفه وقت التشغيل.
 *
 * هذا الاختبار يثبت: (1) الصفحة تُعرض فعلاً (عنوانها ظاهر)، (2) لا خطأ خطافات في
 * الكونسول ولا pageerror، (3) لا خطأ React عام (minified error).
 *
 * منفصل عن npm test (يحتاج متصفحاً)، يُشغَّل عبر: npx playwright test platform-connection
 */
import { test, expect } from '@playwright/test';

const PREVIEW_TOKEN = process.env.E2E_PREVIEW_TOKEN || 'e2e-preview-token-0123456789abcdef';

test('مركز ربط المنصات يُصيَّر بلا خطأ React في الكونسول (دليل خطافات سليم)', async ({ page }) => {
  const errors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));

  // جلسة مالك عبر مقطع رابط المعاينة (خادم حقيقي — نفس مسار تسجيل الدخول المعتمد).
  await page.goto('about:blank');
  await page.goto(`/#preview_token=${PREVIEW_TOKEN}`);
  await expect(page.getByRole('heading', { name: /أهلاً بك/ })).toBeVisible();

  // فتح صفحة «مركز ربط المنصات» من الشريط الجانبي.
  await page.getByRole('button', { name: /مركز ربط المنصات/ }).first().click();

  // دليل التصيير الفعلي: العنوان الرئيسي للصفحة ظاهر (وهو h2 في المكوّن).
  await expect(page.getByRole('heading', { name: 'مركز ربط المنصات' })).toBeVisible();

  // مهلة قصيرة لالتقاط أي خطأ تأخيري من دورة useEffect.
  await page.waitForTimeout(800);

  const hookErrors = [...errors, ...pageErrors].filter((t) =>
    /Invalid hook call|Rendered (more|fewer) hooks|Rules of Hooks|Minified React error/i.test(t));
  expect(hookErrors, `أخطاء خطافات: ${hookErrors.join(' | ')}`).toHaveLength(0);
  // لا خطأ React غير ملتقط على مستوى الصفحة (يشمل أخطاء التصيير).
  expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
});
