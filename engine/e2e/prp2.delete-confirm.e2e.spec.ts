/**
 * e2e — PR-P2: تأكيد قبل حذف المنتج (متصفح حقيقي).
 *
 * يثبت السلوك الفعلي لا الشكل:
 *  1. نقر زر السلة يفتح نافذة «هل أنت متأكد من حذف هذا المنتج؟» ويعرض الاسم والسعر،
 *     ولا يقع أي حذف بعد.
 *  2. «لا» تُغلق النافذة ولا يُرسَل أي طلب حذف (DELETE) إطلاقاً.
 *  3. «نعم» يُرسل DELETE مرة واحدة ويختفي المنتج من القائمة.
 *
 * منفصل عن npm test (يحتاج متصفحاً): npx playwright test prp2.delete-confirm
 */
import { test, expect } from '@playwright/test';

const PREVIEW_TOKEN = process.env.E2E_PREVIEW_TOKEN || 'e2e-preview-token-0123456789abcdef';

const PRODUCTS = [
  { id: 'prod_del_1', name: 'ثلاجة سامسونغ 18 قدم', modelYear: '2026', category: 'appliances', cashPrice: 750000, installmentFrom: 93750, downPaymentPercent: 0, durationMonths: 10, image: '', installmentOptions: ['خيارات تقسيط'], specs: ['ضمان سنة'], inStock: true, installmentPrice: 937500, installmentMonths: 10, monthlyInstallment: 93750, installmentMarkupPercent: 25, requiredDocuments: [] },
  { id: 'prod_del_2', name: 'شاشة LG 55 بوصة', modelYear: '2026', category: 'electronics', cashPrice: 500000, installmentFrom: 62500, downPaymentPercent: 0, durationMonths: 10, image: '', installmentOptions: ['خيارات تقسيط'], specs: ['ضمان سنة'], inStock: true, installmentPrice: 625000, installmentMonths: 10, monthlyInstallment: 62500, installmentMarkupPercent: 25, requiredDocuments: [] },
];

test('تأكيد حذف المنتج: لا يُحذف إلا بـ«نعم»', async ({ page }) => {
  const deleteCalls: string[] = [];

  // لقطة مساحة العمل: نعيد المنتجين (بيانات حتمية بلا خادم حقيقي للحالة).
  await page.route('**/api/workspace/snapshot**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, snapshot: { products: PRODUCTS, showroomInfo: {}, installmentPlans: [] } }),
    });
  });
  // اعتراض الحذف الفعلي: نسجّل كل نداء DELETE.
  await page.route('**/api/workspace/products/**', async (route) => {
    if (route.request().method() === 'DELETE') {
      deleteCalls.push(route.request().url());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  // جلسة مالك عبر مقطع رابط المعاينة (خادم حقيقي).
  await page.goto(`/#preview_token=${PREVIEW_TOKEN}`);
  await expect(page.getByRole('heading', { name: /مرحباً .* دورة العمل في مكان واحد/ })).toBeVisible();

  // فتح «المنتجات والأسعار والتقسيط».
  await page.getByPlaceholder('بحث في الأقسام والوظائف…').fill('المنتجات والأسعار');
  await page.getByRole('button', { name: /المنتجات والأسعار والتقسيط/ }).first().click();
  await expect(page.getByText('ثلاجة سامسونغ 18 قدم')).toBeVisible();

  // 1) نقر زر السلة ⇒ نافذة التأكيد تظهر، ولا حذف بعد.
  await page.getByRole('button', { name: 'حذف المنتج ثلاجة سامسونغ 18 قدم' }).click();
  await expect(page.getByRole('heading', { name: 'هل أنت متأكد من حذف هذا المنتج؟' })).toBeVisible();
  await expect(page.getByText('سعر الكاش: 750,000 د.ع')).toBeVisible();
  expect(deleteCalls.length).toBe(0);

  // 2) «لا» تُغلق بلا حذف.
  await page.getByRole('button', { name: 'لا', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'هل أنت متأكد من حذف هذا المنتج؟' })).toBeHidden();
  expect(deleteCalls.length).toBe(0);
  await expect(page.getByText('ثلاجة سامسونغ 18 قدم')).toBeVisible();

  // 3) «نعم» ينفّذ الحذف مرة واحدة ويختفي المنتج.
  await page.getByRole('button', { name: 'حذف المنتج ثلاجة سامسونغ 18 قدم' }).click();
  await expect(page.getByRole('heading', { name: 'هل أنت متأكد من حذف هذا المنتج؟' })).toBeVisible();
  await page.getByRole('button', { name: 'نعم' }).click();
  await expect.poll(() => deleteCalls.length).toBe(1);
  expect(deleteCalls[0]).toContain('prod_del_1');
  await expect(page.getByText('ثلاجة سامسونغ 18 قدم')).toBeHidden();
  // المنتج الآخر باقٍ (لا حذف جماعي).
  await expect(page.getByText('شاشة LG 55 بوصة')).toBeVisible();
});
