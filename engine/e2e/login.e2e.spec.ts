/**
 * M3 — اختبار e2e واحد على الأقل لمتدفق تسجيل الدخول الحقيقي عبر متصفح حقيقي.
 *
 * ملاحظة: هذا الاختبار **منفصل عن `npm test`** ويُشغَّل عبر `npm run test:e2e`
 * (يحتاج متصفحاً مثبّتاً؛ لا يفترض توفّره في CI الحالي). يثبت:
 *   1. الحالة غير المصادق عليها تعرض شاشة الدخول (لا لوحة).
 *   2. رابط المعاينة (#preview_token) يُنشئ جلسة مالك فعلية عبر الخادم الحقيقي
 *      ويعرض لوحة التحكم (لا ادعاء واجهة محلي).
 *   3. الجلسة تصمد عبر إعادة تحميل الصفحة (token في localStorage).
 *   4. المسح من الرابط: التوكن يُزال من شريط العنوان بعد الاستخدام (لا تسريب).
 *
 * لا يلمس مزوّداً خارجياً ولا Gemini ولا حالة الإنتاج (مجلد حالة مؤقت).
 */
import { test, expect } from '@playwright/test';

const PREVIEW_TOKEN = process.env.E2E_PREVIEW_TOKEN || 'e2e-preview-token-0123456789abcdef';

test('تسجيل الدخول عبر متصفح حقيقي: شاشة الدخول ثم جلسة معاينة دائمة ثم صمود إعادة التحميل', async ({ page }) => {
  // 1) بلا جلسة: شاشة الدخول تظهر.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'معرض الغرابي للتقسيط' })).toBeVisible();

  // 2) جلسة معاينة عبر مقطع الرابط: لوحة التحكم تظهر فعلياً (جلسة SPA).
  // ننتقل أولاً إلى blank لضمان تحميل كامل (تغيير المقطع وحده لا يعيد تحميل SPA).
  await page.goto('about:blank');
  await page.goto(`/#preview_token=${PREVIEW_TOKEN}`);
  // بعد الجلسة يعرض مركز القيادة ترحيباً باسم المالك (النص الحالي للتطبيق).
  await expect(page.getByRole('heading', { name: /مرحباً .* دورة العمل في مكان واحد/ })).toBeVisible();
  // التوكن لا يبقى في الرابط بعد الاستخدام (يُمسح فوراً).
  await expect.poll(async () => page.url()).not.toContain('preview_token');

  // 3) الجلسة تصمد عبر إعادة تحميل كاملة (token في localStorage، جلسة موقّعة).
  await page.reload();
  await expect(page.getByRole('heading', { name: /مرحباً .* دورة العمل في مكان واحد/ })).toBeVisible();
  // شاشة الدخول (بوابة المصادقة) لم تعد معروضة بعد إعادة التحميل.
  await expect(page.getByText('بوابة المصادقة والتحكم الآمنة')).toHaveCount(0);

  // 4) طلب محمي من داخل الصفحة يحمل جلسة صالحة فعلاً (دليل أن الخادم قبل التوكن).
  const me = await page.evaluate(async () => {
    const token = localStorage.getItem('algharabi_auth_token') || '';
    const res = await fetch('/api/auth/me', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: res.status, body: await res.json().catch(() => null) };
  });
  expect(me.status).toBe(200);
  expect(me.body?.user?.role).toBe('owner');
});
