/**
 * انحدار التنقل الهرمي في الشريط الجانبي (fail-old / pass-new).
 *
 * عطل حقيقي مُثبت على الإنتاج: كان `toggleSection` في Sidebar.tsx ينقّل إلى القسم
 * **فقط عند فتح قسم مُغلق** (`if (!expandedSections.includes(id)) setActiveTab(id)`).
 * فإذا ضغط المستخدم قسماً **مفتوحاً** (أو فُتح تلقائياً لأن الورقة النشطة داخله)،
 * انطوت فروعه بلا أي تنقّل، فبقي المحتوى على القسم السابق. الأثر المرئي:
 *   (1) الضغط على قسم يبدو كأنه «فتح محتوى قسم آخر» (لأن المحتوى السابق يبقى).
 *   (2) الفروع تبدو غير قابلة للنقر/لا تفتح.
 *
 * هذا الاختبار يثبت: كل قسم ينقل إلى محتواه هو بالضبط (ترويسة الصفحة تطابق اسم
 * القسم)، بما فيه **إعادة الضغط على قسم مفتوح**، وأن الضغط على فرع يفتح فروعه
 * وينقل إلى أول وظيفة فيه.
 *
 * منفصل عن `npm test` (يُشغَّل عبر `npm run test:e2e`، يحتاج متصفحاً) — لا يلمس
 * مزوّداً خارجياً ولا Gemini ولا حالة الإنتاج (مجلد حالة مؤقت عبر webServer).
 */
import { test, expect, Page } from '@playwright/test';

const PREVIEW_TOKEN = process.env.E2E_PREVIEW_TOKEN || 'e2e-preview-token-0123456789abcdef';

const SECTION_LABELS = [
  'مركز القيادة والمالك',
  'النشر الموحد ومنصات التواصل',
  'العقول المتخصصة',
  'العقل المركزي والمنسق التنفيذي',
  'المصادقة والأمان والصلاحيات',
  'مركز الزبائن والتفاعلات',
  'مستودع المنتجات والمعرفة',
  'محرك الأتمتة والجدولة',
  'الذاكرة والتعلم والتحليل',
  'التخزين وقاعدة البيانات',
  'المراقبة وصحة النظام',
  'النسخ الاحتياطي والتعافي والاستنساخ',
  'الخدمات الخارجية والإعدادات',
  'الإعدادات والتشغيل',
];

/** زر ترويسة القسم (يحتوي <p> بالنص الدقيق) — لا يتطابق مع أزرار الفروع/الوظائف. */
function sectionHeader(page: Page, label: string) {
  return page
    .locator('aside button')
    .filter({ has: page.locator(`p:text-is(${JSON.stringify(label)})`) })
    .first();
}

const mainHeading = (page: Page) => page.locator('main h2').first();

async function login(page: Page) {
  await page.goto('/');
  await page.goto('about:blank');
  await page.goto(`/#preview_token=${PREVIEW_TOKEN}`);
  await expect(page.locator('aside')).toBeVisible({ timeout: 30_000 });
  // ابدأ بحالة فتح نظيفة لتفادي تداخل التخزين المحلي بين الجولات.
  await page.evaluate(() => localStorage.removeItem('gharabi-nav-expanded-v1'));
  await page.reload();
  await expect(page.locator('aside')).toBeVisible({ timeout: 30_000 });
}

test('كل قسم ينقل إلى محتواه هو (بما فيه إعادة الضغط على قسم مفتوح)', async ({ page }) => {
  await login(page);

  for (const label of SECTION_LABELS) {
    await sectionHeader(page, label).click();
    await expect(mainHeading(page)).toHaveText(label, { timeout: 15_000 });
  }

  // الانحدار الحاسم: بعد التنقّل، إعادة الضغط على قسم **مفتوح** يجب أن تنقّل إليه،
  // لا أن تطوي فروعه فقط وتبقي المحتوى على القسم السابق.
  for (const label of ['العقول المتخصصة', 'العقل المركزي والمنسق التنفيذي', 'محرك الأتمتة والجدولة']) {
    await sectionHeader(page, label).click();       // قد يفتح/يطوي
    await expect(mainHeading(page)).toHaveText(label, { timeout: 15_000 });
    await sectionHeader(page, label).click();       // إعادة الضغط (القسم غالباً مفتوح)
    await expect(mainHeading(page)).toHaveText(label, { timeout: 15_000 });
  }
});

test('الضغط على فرع يفتح وظائفه وينقل إلى أولها (لا فرع بلا استجابة)', async ({ page }) => {
  await login(page);

  await sectionHeader(page, 'النشر الموحد ومنصات التواصل').click();
  await expect(mainHeading(page)).toHaveText('النشر الموحد ومنصات التواصل', { timeout: 15_000 });

  // فروع قسم النشر داخل الحاوية المفتوحة.
  const branchButtons = page.locator('aside button[aria-expanded]').filter({ has: page.locator('span') });
  const count = await branchButtons.count();
  expect(count).toBeGreaterThan(0);

  // أول فرع: الضغط عليه يجب أن يغيّر محتوى الصفحة (ينقل إلى وظيفته الأولى).
  const before = (await mainHeading(page).textContent())?.trim() || '';
  await branchButtons.first().click();
  await expect
    .poll(async () => (await mainHeading(page).textContent())?.trim() || '', { timeout: 15_000 })
    .not.toBe(before);
});
