/**
 * صفحات قانونية عامة حقيقية: شروط الخدمة، سياسة الخصوصية، وصفحة الموقع.
 *
 * سبب الوجود: TikTok (وقبله Meta) يشترط أن تكون روابط Terms of Service و
 * Privacy Policy و Website URL عامة وقابلة للوصول وتعود بحالة 200. قبل هذا
 * الملف كان أي مسار غير API يسقط إلى واجهة React فيُعاد `index.html` بلا
 * محتوى قانوني فعلي، فيُرفض التحقق لأن الصفحة لا تحمل نصاً مطابقاً للعنوان.
 *
 * المحتوى هنا **حقيقي ومطابق لما يفعله النظام**: يذكر ما يُجمَع فعلاً (بريد
 * المالك للدخول، توكنات المنصات المشفّرة، التعليقات/الرسائل الواردة، سجلات
 * النشر والتحليلات) وكيف يُستخدم ويُخزَّن. لا يُدّعى جمع بيانات غير موجودة،
 * ولا يُذكر أي رقم هاتف أو بريد لم يُضبط على الخادم.
 *
 * الصفحات ثابتة (بلا حالة) ولا تستهلك أي حصة ذكاء اصطناعي، وتُخدَم من الخادم
 * مباشرة فلا تحتاج بناء الواجهة.
 */

export interface LegalPageContext {
  /** بريد تواصل المالك إن كان مضبوطاً على الخادم؛ لا يُخترع إن كان غائباً. */
  contactEmail?: string | null;
  /** عنوان الموقع العام إن عُرف (لعرضه في الترويسة/التذييل). */
  publicUrl?: string | null;
  /** تاريخ آخر تحديث (نص ISO) — يُمرَّر من الخادم ليبقى قابلاً للاختبار. */
  updatedAt?: string | null;
}

export type LegalPageId = 'terms' | 'privacy' | 'home';

export interface LegalPage {
  id: LegalPageId;
  /** العنوان الظاهر في الترويسة وفي <title>. */
  title: string;
  /** وصف موجز لـ<meta name="description">. */
  description: string;
  /** مسار الصفحة من الجذر. */
  path: string;
  html: string;
}

const BRAND = 'الغرابي AI';
const ORG = 'معرض الغرابي للتقسيط';

/** تهريب النص قبل إدراجه في HTML (بريد المالك/العنوان من البيئة لا يُوثق به شكلاً). */
function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** صف تواصل يُبنى من البريد المضبوط فعلاً، أو جملة صريحة إن لم يُضبط. */
function contactRow(ctx: LegalPageContext): string {
  const email = (ctx.contactEmail || '').trim();
  if (!email) {
    return '<li>للتواصل بشأن هذه السياسة: استخدم بيانات التواصل المنشورة في صفحة الموقع الرسمية.</li>';
  }
  return `<li>للتواصل بشأن هذه السياسة: <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></li>`;
}

function updatedLabel(ctx: LegalPageContext): string {
  const raw = (ctx.updatedAt || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

/**
 * قالب واحد لكل الصفحات القانونية: RTL عربي، تصميم لوحة التحكم نفسه
 * (slate-900 / emerald)، بلا أي مورد خارجي حتى تُخدَم بسرعة وبلا اعتماد شبكي.
 */
function renderLegalPage(page: { title: string; description: string; body: string; updatedAt: string; contactEmail: string }): string {
  const updated = page.updatedAt ? `<p class="updated">آخر تحديث: ${escapeHtml(page.updatedAt)}</p>` : '';
  const contact = page.contactEmail
    ? `<p class="contact">للتواصل: <a href="mailto:${escapeHtml(page.contactEmail)}">${escapeHtml(page.contactEmail)}</a></p>`
    : '';
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(page.title)} — ${escapeHtml(BRAND)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <meta name="robots" content="index,follow" />
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #0f172a; color: #e2e8f0; font-family: "Cairo", "Tajawal", "Segoe UI", system-ui, sans-serif; line-height: 1.9; }
      header { background: #020617; border-bottom: 1px solid #1e293b; padding: 18px 20px; }
      header .brand { color: #34d399; font-weight: 800; font-size: 1.15rem; }
      header nav { margin-top: 8px; display: flex; gap: 16px; flex-wrap: wrap; }
      header nav a { color: #cbd5e1; text-decoration: none; font-size: .95rem; }
      header nav a:hover { color: #34d399; }
      main { max-width: 820px; margin: 0 auto; padding: 28px 20px 64px; }
      h1 { color: #f8fafc; font-size: 1.7rem; margin: 0 0 6px; }
      h2 { color: #34d399; font-size: 1.2rem; margin: 28px 0 8px; }
      p, li { color: #cbd5e1; }
      ul { padding-inline-start: 22px; }
      a { color: #34d399; }
      .updated, .contact { color: #94a3b8; font-size: .9rem; }
      .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 20px; margin: 18px 0; }
      footer { border-top: 1px solid #1e293b; padding: 20px; text-align: center; color: #64748b; font-size: .85rem; }
    </style>
  </head>
  <body>
    <header>
      <div class="brand">${escapeHtml(BRAND)} — ${escapeHtml(ORG)}</div>
      <nav>
        <a href="/">الرئيسية</a>
        <a href="/terms">شروط الخدمة</a>
        <a href="/privacy">سياسة الخصوصية</a>
      </nav>
    </header>
    <main>
      <h1>${escapeHtml(page.title)}</h1>
      ${updated}
      ${page.body}
      ${contact}
    </main>
    <footer>${escapeHtml(BRAND)} — ${escapeHtml(ORG)}. جميع الحقوق محفوظة.</footer>
  </body>
</html>`;
}

/** صفحة الموقع (Website URL): تعريف موجز بالخدمة وروابط السياسات. */
export function buildHomePage(ctx: LegalPageContext = {}): LegalPage {
  const body = `
    <p>${escapeHtml(BRAND)} منصّة داخلية تدير دورة السوشيال ميديا وحسابات التواصل الاجتماعي الخاصة بـ${escapeHtml(ORG)}: تحليل، تخطيط محتوى، جدولة، نشر، ومتابعة التعليقات والرسائل والتحليلات عبر قنوات المنصّة الرسمية.</p>
    <div class="card">
      <h2>ما تفعله المنصّة</h2>
      <ul>
        <li>ربط حسابات التواصل الاجتماعي الرسمية للمعرض عبر OAuth أو رمز بوت معتمد من المزوّد.</li>
        <li>إعداد المحتوى التسويقي وجدولته ونشره بعد موافقة المالك، عبر واجهات المزوّد الرسمية فقط.</li>
        <li>استقبال تعليقات ورسائل العملاء على القنوات المرتبطة والمساعدة في الرد عليها.</li>
        <li>قراءة المؤشرات (الإعجابات، المشاهدات، التعليقات) من واجهات المنصّة عندما يوفّرها المزوّد، بلا اختراع أرقام.</li>
      </ul>
    </div>
    <p>المنصّة أداة تشغيل داخلية للمعرض، ولا تتيح إنشاء حسابات تواصل اجتماعي نيابةً عن المستخدمين.</p>
    <p>اقرأ <a href="/terms">شروط الخدمة</a> و<a href="/privacy">سياسة الخصوصية</a>.</p>`;
  return {
    id: 'home',
    title: 'الموقع الرسمي',
    description: `${BRAND}: منصّة إدارة السوشيال ميديا وحسابات التواصل الاجتماعي الخاصة بـ${ORG}.`,
    path: '/',
    html: renderLegalPage({ title: 'الموقع الرسمي', description: `${BRAND} — ${ORG}`, body, updatedAt: updatedLabel(ctx), contactEmail: (ctx.contactEmail || '').trim() }),
  };
}

/** شروط الخدمة (Terms of Service URL). */
export function buildTermsPage(ctx: LegalPageContext = {}): LegalPage {
  const body = `
    <p>تنظّم هذه الشروط استخدام منصّة ${escapeHtml(BRAND)} (المشار إليها بـ«المنصّة»)، وهي أداة تشغيل داخلية تابعة لـ${escapeHtml(ORG)} لإدارة قنوات السوشيال ميديا الخاصة بالمعرض. باستخدامك المنصّة فإنك توافق على هذه الشروط.</p>

    <h2>1. نطاق الخدمة</h2>
    <p>توفّر المنصّة أدوات لتحليل المحتوى التسويقي، وتخطيطه وجدولته، ونشره عبر واجهات المنصّات الرسمية (مثل TikTok وFacebook وInstagram)، ومتابعة التعليقات والرسائل والتحليلات المرتبطة بالحسابات التي يملكها المعرض ويربطها بنفسه.</p>

    <h2>2. الأهلية والصلاحية</h2>
    <p>الوصول إلى المنصّة محصور في المالك والمستخدمين المصرّح لهم من المعرض. لا يجوز استخدام المنصّة لربط حسابات لا تملك صلاحية إدارتها، ولا لتجاوز سياسات أي مزوّد.</p>

    <h2>3. الاستخدام المقبول</h2>
    <ul>
      <li>عدم نشر محتوى مخالف للقانون أو لسياسات المنصّات المرتبطة، ولا محتوى مضلّل أو مسيء.</li>
      <li>عدم محاولة تجاوز حماية المنصّة أو الوصول غير المصرّح به إلى بيانات الآخرين.</li>
      <li>عدم استخدام المنصّة لإرسال رسائل مزعجة أو ممارسات محظورة (Spam).</li>
      <li>الالتزام بشروط الخدمة وسياسات المطوّرين لكل منصّة يتم الربط بها.</li>
    </ul>

    <h2>4. الحسابات والاعتماد</h2>
    <p>أنت مسؤول عن دقّة الحسابات التي تربطها وعن صلاحيتك لإدارتها. تُخزَّن رموز الوصول (Access Tokens) مشفّرة على الخادم ولا تُشارَك مع أي طرف ثالث خارج واجهة المزوّد الرسمية. يمكنك فصل أي حساب في أي وقت، فيُبطَل الرمز لدى المزوّد ويُمسح محلياً.</p>

    <h2>5. المحتوى والمسؤولية</h2>
    <p>يبقى المحتوى الذي تنشره ملكاً لك، وأنت المسؤول عن صحته ومطابقته للأنظمة. لا تضمن المنصّة نتائج تسويقية محدّدة، وتُقدَّم «كما هي» دون ضمانات صريحة أو ضمنية.</p>

    <h2>6. توفّر الخدمة</h2>
    <p>قد تتوقف بعض الوظائف عند تعطّل مزوّد خارجي أو تغيّر واجهاته. تُعلن المنصّة حالة كل منصّة بصراحة، ولا تدّعي اتصالاً أو نشراً لم يحدث فعلاً.</p>

    <h2>7. التعديلات</h2>
    <p>يجوز تحديث هذه الشروط عند تغيّر الوظائف أو المتطلبات القانونية، ويُعلن تاريخ آخر تحديث في أعلى الصفحة.</p>

    <h2>8. التواصل</h2>
    <ul>${contactRow(ctx)}</ul>`;
  return {
    id: 'terms',
    title: 'شروط الخدمة',
    description: `شروط استخدام منصّة ${BRAND} الخاصة بـ${ORG}.`,
    path: '/terms',
    html: renderLegalPage({ title: 'شروط الخدمة', description: `شروط استخدام ${BRAND}`, body, updatedAt: updatedLabel(ctx), contactEmail: (ctx.contactEmail || '').trim() }),
  };
}

/** سياسة الخصوصية (Privacy Policy URL) — تصف ما يُجمَع فعلاً. */
export function buildPrivacyPage(ctx: LegalPageContext = {}): LegalPage {
  const body = `
    <p>توضّح هذه السياسة كيف تجمع منصّة ${escapeHtml(BRAND)} (${escapeHtml(ORG)}) البيانات وتستخدمها وتحميها عند تشغيلها لإدارة قنوات التواصل الاجتماعي الخاصة بالمعرض.</p>

    <h2>1. البيانات التي نجمعها</h2>
    <ul>
      <li><strong>بيانات الدخول:</strong> بريد المالك/المستخدم المصرّح له لإنشاء الجلسة والتحقق منها. لا نُخزّن كلمات مرور.</li>
      <li><strong>رموز المنصّات:</strong> رموز الوصول (Access/Refresh Tokens) الناتجة عن ربط حسابات المعرض لدى TikTok وFacebook وInstagram وTelegram وغيرها، ومعرّفات الحساب/الصفحة اللازمة لتوجيه العمليات.</li>
      <li><strong>محتوى التواصل:</strong> التعليقات والرسائل الواردة إلى الحسابات المرتبطة، ومعرّفاتها لدى المزوّد، لمنع التكرار وللتمكين من الرد.</li>
      <li><strong>سجلات التشغيل:</strong> سجلات النشر والجدولة والتحليلات وحالة المنصّات وأحداث المراجعة، لأغراض التشغيل والتدقيق.</li>
    </ul>

    <h2>2. كيف نستخدم البيانات</h2>
    <ul>
      <li>ربط الحسابات الرسمية للمعرض وإدارتها عبر واجهات المزوّد المعتمدة.</li>
      <li>إعداد المحتوى وجدولته ونشره بعد الموافقة، والرد على تعليقات ورسائل العملاء.</li>
      <li>عرض المؤشرات والتحليلات التي يوفّرها المزوّد، بلا اختراع أي قيمة.</li>
      <li>حماية النظام من إساءة الاستخدام والتكرار ومنع العمليات غير المصرّح بها.</li>
    </ul>

    <h2>3. التخزين والحماية</h2>
    <p>تُخزَّن الحالة على خادم المعرض (ملف محلي أو قاعدة بيانات Postgres). تُشفَّر رموز المنصّات بخوارزمية AES-256-GCM بمفتاح يُدار من بيئة الخادم، ولا تُسجَّل في السجلات ولا تُعاد في أي استجابة. الوصول إلى المنصّة محميّ بجلسة موقّعة ومحصورة بالمستخدمين المصرّح لهم.</p>

    <h2>4. المشاركة مع الأطراف الثالثة</h2>
    <p>لا نبيع البيانات. يقتصر التبادل على ما يلزم لتنفيذ العملية مع واجهة المزوّد الرسمية التي ربطتها (مثل نشر منشور أو جلب تعليق أو إرسال رد). لا تُشارَك أي بيانات مع أطراف أخرى لأغراض تسويقية.</p>

    <h2>5. الاحتفاظ بالبيانات</h2>
    <p>تُحفظ سجلات التشغيل والمحتوى للمدة اللازمة لإدارة القنوات والتدقيق، ويمكن للمالك فصل أي حساب أو حذف سجلاته. عند فصل الحساب يُبطَل رمزه لدى المزوّد ويُمسح محلياً.</p>

    <h2>6. حقوقك</h2>
    <ul>
      <li>فصل أي حساب مرتبط في أي وقت من إعدادات المنصّة.</li>
      <li>طلب الاطلاع على البيانات المخزّنة المتعلقة بحسابك أو حذفها.</li>
      <li>إلغاء الوصول عبر إبطال التفويض من إعدادات حسابك لدى المزوّد نفسه.</li>
    </ul>

    <h2>7. التواصل</h2>
    <ul>${contactRow(ctx)}</ul>`;
  return {
    id: 'privacy',
    title: 'سياسة الخصوصية',
    description: `سياسة الخصوصية لمنصّة ${BRAND} الخاصة بـ${ORG}.`,
    path: '/privacy',
    html: renderLegalPage({ title: 'سياسة الخصوصية', description: `سياسة الخصوصية — ${BRAND}`, body, updatedAt: updatedLabel(ctx), contactEmail: (ctx.contactEmail || '').trim() }),
  };
}

/** كل الصفحات القانونية العامة (المسار → الصفحة) بمصدر واحد. */
export function legalPages(ctx: LegalPageContext = {}): LegalPage[] {
  return [buildTermsPage(ctx), buildPrivacyPage(ctx)];
}

/** يطابق مسار طلب بصفحة قانونية معروفة، أو null. يشمل المرادفات الشائعة. */
export function legalPageForPath(pathname: string, ctx: LegalPageContext = {}): LegalPage | null {
  const normalized = String(pathname || '').trim().replace(/\/+$/, '') || '/';
  const alias: Record<string, LegalPageId> = {
    '/terms': 'terms',
    '/terms-of-service': 'terms',
    '/terms-of-use': 'terms',
    '/privacy': 'privacy',
    '/privacy-policy': 'privacy',
  };
  const id = alias[normalized];
  if (!id) return null;
  return id === 'terms' ? buildTermsPage(ctx) : buildPrivacyPage(ctx);
}
