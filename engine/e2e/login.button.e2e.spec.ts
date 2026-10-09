/**
 * إصلاح «زر طلب رمز التحقق لا يستجيب» — اختبار e2e حقيقي على متصفح حقيقي.
 *
 * يثبت السلوك الفعلي لا الشكل فقط:
 *  1. على سطح المكتب: نقر «طلب رمز التحقق الآمن» يُرسل فعلاً
 *     POST /api/auth/request-owner-challenge (لا نقر ميّت) ثم ينتقل لخطوة الرمز.
 *  2. على مقاس جوال (viewport + touch): النقر يرسل الطلب نفسه (لا فرق سلوك).
 *  3. بريد فارغ: رسالة داخل الواجهة بلا أي إرسال (لا اعتماد على فقاعة المتصفح).
 *  4. عند فشل الطلب: رسالة واضحة (role=alert) + زر «إعادة المحاولة» قابل للنقر.
 *
 * منفصل عن `npm test` (يحتاج متصفحاً) ويُشغَّل عبر `npm run test:e2e`. يستخدم
 * خادم الاختبار المحلي (webServer). نعترض نداء الشبكة فيُحدَّد رد الخادم بدقة
 * (نجاح/فشل) بلا أي مزوّد بريد ولا حالة إنتاج وبلا كشف أي سرّ.
 */
import { test, expect } from '@playwright/test';

const CHALLENGE_URL = '**/api/auth/request-owner-challenge';

async function openChallengeTab(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'معرض الغرابي للتقسيط' })).toBeVisible();
  await page.getByRole('button', { name: 'تحقق البريد المعتمد' }).click();
  await expect(page.getByRole('button', { name: /طلب رمز التحقق الآمن/ })).toBeVisible();
}

test('سطح المكتب: النقر يرسل طلب الرمز فعلاً ثم ينتقل لخطوة الرمز', async ({ page }) => {
  const methods: string[] = [];
  await page.route(CHALLENGE_URL, (route) => {
    methods.push(route.request().method());
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: 'تم إرسال رمز التحقق إلى بريد المالك' }) });
  });

  await openChallengeTab(page);
  await page.getByPlaceholder('example@domain.com').fill('owner@example.com');
  await page.getByRole('button', { name: /طلب رمز التحقق الآمن/ }).click();

  await expect.poll(() => methods.length).toBe(1);
  expect(methods[0]).toBe('POST');
  // الانتقال الحقيقي لخطوة إدخال الرمز (دليل أن المعالج نُفِّذ فعلاً).
  await expect(page.getByPlaceholder('••••••')).toBeVisible();
});

test.describe('جوال', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('جوال (viewport + touch): النقر اللمسي يرسل الطلب نفسه', async ({ page }) => {
    const methods: string[] = [];
    await page.route(CHALLENGE_URL, (route) => {
      methods.push(route.request().method());
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: 'ok' }) });
    });

    await openChallengeTab(page);
    await page.getByPlaceholder('example@domain.com').fill('owner@example.com');
    // نقر لمسي فعلي على الزر (لا استدعاء برمجي).
    await page.getByRole('button', { name: /طلب رمز التحقق الآمن/ }).tap();
    await expect.poll(() => methods.length).toBe(1);
    expect(methods[0]).toBe('POST');
  });
});

test('بريد فارغ: رسالة داخل الواجهة بلا إرسال', async ({ page }) => {
  const methods: string[] = [];
  await page.route(CHALLENGE_URL, (route) => { methods.push(route.request().method()); route.fulfill({ status: 200, body: '{}' }); });

  await openChallengeTab(page);
  await page.getByRole('button', { name: /طلب رمز التحقق الآمن/ }).click();
  await expect(page.getByRole('alert')).toContainText('يرجى إدخال البريد الإلكتروني المصرح له.');
  expect(methods.length).toBe(0);
});

test('فشل الطلب: رسالة واضحة + زر إعادة المحاولة قابل للنقر', async ({ page }) => {
  let calls = 0;
  await page.route(CHALLENGE_URL, (route) => {
    calls += 1;
    route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'تعذر إرسال رمز التحقق، حاول مرة أخرى' }) });
  });

  await openChallengeTab(page);
  await page.getByPlaceholder('example@domain.com').fill('owner@example.com');
  await page.getByRole('button', { name: /طلب رمز التحقق الآمن/ }).click();

  const retry = page.getByRole('button', { name: /إعادة المحاولة/ });
  await expect(retry).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('alert')).toContainText('رمز التحقق');
  // زر إعادة المحاولة ينفّذ الطلب فعلاً عند النقر (لا زر شكلي).
  await retry.click();
  await expect.poll(() => calls).toBeGreaterThan(1);
});
