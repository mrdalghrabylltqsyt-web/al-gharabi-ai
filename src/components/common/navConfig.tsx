import React from 'react';
import {
  Home, LayoutDashboard, Send, Sparkles, MessageSquareText, Store, Cog,
  Bot, BarChart3, Calendar, Users, Search, ClipboardList, Brain, BrainCircuit, PlugZap,
  CloudUpload, Database, ServerCog, MonitorPlay, ShieldCheck, Activity,
  CreditCard, Network, Power, Boxes, Inbox,
} from 'lucide-react';
import { salesTabEnabled, operationsTabEnabled } from './scopeFlags';

// ─────────────────────────────────────────────────────────────────────────────
// خريطة التنقل الهرمية الموحّدة — **مصدر واحد للحقيقة**.
//
// ثلاثة مستويات: قسم رئيسي (NavSection) ← فرع (NavBranch) ← ورقة (NavLeaf).
// خمسة أقسام رئيسية فقط، مجمّعة حسب دورة العمل الفعلية (قيادة وعقل | نشر ومنصات |
// زبائن وتفاعل | منتجات ومعرفة | إعدادات وتشغيل).
//
// قاعدة ملزمة: لا تُضاف ورقة إلا ومعرّفها مُنفَّذ في switch العرض (مكوّن حقيقي).
// قاعدة الدمج-لا-الحذف: كل وظيفة/معرّف كان موجوداً سابقاً ما زال موجوداً هنا، لكن
// **مرة واحدة فقط** لكل قسم: أي مجموعة أوراق تتقاسم نفس الـid تظهر كرابط واحد،
// والتبديل بين الحالات (منصة/نوع عقل) يقع داخل الصفحة نفسها (تبويب/قائمة منسدلة)،
// لا بتكرارها كبنود منفصلة في الشريط الجانبي.
//
// ملاحظة تطوير (لا تُعرض للمستخدم): الوظائف القديمة كلها ما زالت متاحة داخل الأقسام
// (لا حذف لأي وظيفة) — تغيّر التنظيم/العرض فقط. كان هذا النص يظهر للمستخدم النهائي
// أسفل القائمة، فنُقل إلى تعليق كود.
// ─────────────────────────────────────────────────────────────────────────────

export interface NavLeaf {
  /** معرّف الوظيفة الفعلية = `case` في App.tsx (مكوّن حقيقي). */
  id: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  ownerOnly?: boolean;
  /** أسماء بديلة للبحث (عربي/إنجليزي) بلا تكرار واجهة. */
  keywords?: string[];
}
export interface NavBranch {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavLeaf[];
  ownerOnly?: boolean;
}

/**
 * هوية التمييز **الواحدة** — بلا ألوان متعدّدة للأقسام (لا «أزرق مُبهَم»).
 * لون تمييز واحد فخم (الزمردي) يُستخدم بحساب شديد: صندوق أيقونة القسم **النشط** فقط،
 * وحدّ الصف النشط الرقيق. الصناديق غير النشطة محايدة تماماً (رمادي فحمي) فلا تشتّت.
 * لا كسر الدلالات: العاجل يبقى كهرمانياً في الشارات، والورقة النشطة تبقى بلون التمييز.
 */
export interface NavAccent {
  /** صندوق أيقونة القسم عند عدم التفعيل: محايد بلا لون (رمادي فحمي). */
  box: string;
  /** لون أيقونة القسم عند عدم التفعيل. */
  icon: string;
  /** صندوق أيقونة القسم عند التفعيل: لون التمييز الواحد + توهج خفيف. */
  boxActive: string;
  /** خلفية/حد صف القسم عند التفعيل. */
  rowActive: string;
}

/** الهوية الواحدة (مصدر واحد) — تُستهلك لكل الأقسام الخمسة بلا تمييز لوني بينها. */
export const NAV_ACCENT: NavAccent = {
  box: 'bg-slate-800/70 ring-1 ring-inset ring-slate-700',
  icon: 'text-slate-400',
  boxActive: 'bg-accent text-slate-950 ring-1 ring-inset ring-accent/40 shadow-md shadow-accent/30',
  rowActive: 'bg-slate-800/60 text-white border border-accent/25 shadow-sm',
};

/**
 * توافق خلفي: الأسماء الخمسة القديمة (sky/emerald/amber/violet/steel) تُبقى لكنها
 * تُشير جميعاً إلى **الهوية الواحدة** — فلا ألوان متعدّدة بعد الآن. أي مستورد قديم
 * (`NAV_ACCENTS.sky`) يواصل العمل بلا كسر.
 */
export const NAV_ACCENTS: Record<'sky' | 'emerald' | 'amber' | 'violet' | 'steel', NavAccent> = {
  sky: NAV_ACCENT,
  emerald: NAV_ACCENT,
  amber: NAV_ACCENT,
  violet: NAV_ACCENT,
  steel: NAV_ACCENT,
};
export interface NavSection {
  id: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  ownerOnly?: boolean;
  /** وصف مسار العمل الموحّد للقسم (يُعرض في ترويسة القسم + مسار التنقّل). */
  flow: string;
  /** هوية لونية مميّزة للقسم (تُطبَّق على أيقونة القسم وصندوقه عند التفعيل فقط). */
  accent: NavAccent;
  branches: NavBranch[];
}

// SCOPE ISOLATION (LEGACY ERP): أسطح Inventory/CRM/Finance/Customers-360/Purchases/
// خارج نطاق المشروع المعلن (سوشيال + AI + تسويق)، ومعزولة على الخادم افتراضياً
// (404 SCOPE_DISABLED). نخفي مداخلها كي لا تُعرض واجهات غير قابلة للاستخدام.
// تُعاد بإطفاء العزل على الخادم (GHARABI_ENABLE_LEGACY_ERP_SCOPE=true) وضبط هذا true.
export const LEGACY_ERP_NAV_ENABLED = false;
export const LEGACY_ERP_TAB_IDS = new Set(['executive', 'business', 'finance', 'inventory', 'reports']);
// قرار مالك صريح (2026-10-13): تبويبا «المبيعات» و«غرفة العمليات» يُعاد فتحهما ضمن
// توسيع النطاق لعقل تجاري حقيقي — مفعّلان فقط عند ضبط متغيّرات بناء Vite الصريحة
// ومعها أعلام الخادم (GHARABI_ENABLE_SALES_TAB / GHARABI_ENABLE_OPERATIONS_TAB).
// افتراضياً معطّلان (fail-closed)؛ لا قيمة تفعيل مكتوبة في الكود.
export const SALES_TAB_ENABLED = salesTabEnabled();
export const OPERATIONS_TAB_ENABLED = operationsTabEnabled();

/**
 * أسماء المنصات العشر للعرض — مصدر واحد يستهلكه المفتاح الداخلي (تبويب/قائمة منسدلة)
 * في صفحات النشر والمنصات، فلا تُكرَّر كأوراق منفصلة في الشريط الجانبي (نفس الوظيفة
 * `social` تُفتح مرة واحدة وتُبدَّل المنصة داخلها).
 */
export const NAV_PLATFORM_LABELS = [
  'Facebook', 'Instagram', 'TikTok', 'YouTube', 'Telegram',
  'Threads', 'WhatsApp Business', 'X', 'Snapchat', 'Google Business Profile',
] as const;

export const NAV_SECTIONS: NavSection[] = [
  // 1) مركز القيادة والعقل — نظرة موحّدة + كل العقول (مركزي/متخصصة) + الحوكمة.
  {
    id: 'section_home',
    label: 'مركز القيادة والعقل',
    desc: 'الحالة العامة، العقل المركزي والعقول المتخصصة، والاعتماد',
    icon: Home,
    accent: NAV_ACCENT,
    flow: 'نظرة موحّدة: ما يعمل، ما يحتاج إجراءً، وما ينتظر موافقة المالك.',
    branches: [
      {
        id: 'home_command',
        title: 'القيادة والنظرة العامة',
        icon: LayoutDashboard,
        items: [
          { id: 'command_center', label: 'مركز القيادة', desc: 'حالة النظام، ملخص العمل، والتنبيهات', icon: LayoutDashboard, keywords: ['dashboard', 'overview'] },
          { id: 'dashboard', label: 'لوحة التحكم الرئيسية', desc: 'المؤشرات والعمليات الحالية', icon: LayoutDashboard, keywords: ['dashboard'] },
        ],
      },
      {
        id: 'home_brains',
        title: 'العقل المركزي والعقول المتخصصة',
        icon: Brain,
        items: [
          { id: 'central_brain', label: 'العقل المركزي متعدد المنصات', desc: 'الإدراك، الجمهور، السوق، الاستراتيجية، القرار، التجارب، التعلم، الذاكرة — بنوع عقل داخلي', icon: Brain, keywords: ['perception', 'knowledge', 'truth', 'audience', 'market', 'strategy', 'decision', 'experiments', 'learning', 'memory'] },
          { id: 'brain_manager', label: 'عقل السياق والفريق والعروض', desc: 'السياق والذاكرة العاملة، فريق الوكلاء، وصياغة العروض — بنوع عقل داخلي', icon: BrainCircuit, keywords: ['context', 'team', 'council', 'offers', 'sales'] },
          { id: 'central_agent', label: 'المنسّق التنفيذي المركزي', desc: 'فهم الأوامر، التخطيط، الأدوات، التوزيع، التنفيذ، والصلاحيات — بمرحلة داخلية', icon: Bot, keywords: ['intent', 'planner', 'tools', 'routing', 'tasks', 'permissions', 'audit'] },
        ],
      },
      {
        id: 'home_governance',
        title: 'الحوكمة والاعتماد',
        icon: ShieldCheck,
        items: [
          { id: 'approval', label: 'الموافقة والاعتماد', desc: 'مراجعة المحتوى والأوامر التي تحتاج موافقة قبل التنفيذ', icon: ShieldCheck, keywords: ['approval', 'review', 'governance'] },
        ],
      },
    ],
  },

  // 2) النشر والمنصات — دورة المحتوى + النشر والنتائج + المنصات العشر + المبيعات (توسيع نطاق).
  {
    id: 'section_publish',
    label: 'النشر والمنصات',
    desc: 'إنشاء المحتوى، النشر والجدولة والنتائج، وموصلات المنصات العشر',
    icon: Send,
    accent: NAV_ACCENT,
    flow: 'إنشاء ← تجهيز لكل منصة ← اعتماد ← نشر/جدولة ← متابعة النتيجة لكل منصة.',
    branches: [
      {
        id: 'pub_content',
        title: 'دورة المحتوى',
        icon: Sparkles,
        items: [
          { id: 'content', label: 'إنشاء المحتوى وتحريره', desc: 'توليد منشورات وتعديل النص لكل منصة', icon: Sparkles, keywords: ['content', 'create'] },
          { id: 'calendar', label: 'الجدولة والتقويم', desc: 'جدولة المنشورات حسب الأيام', icon: Calendar, keywords: ['schedule', 'calendar'] },
        ],
      },
      {
        id: 'pub_publish',
        title: 'النشر والنتائج',
        icon: Send,
        items: [
          { id: 'social_manager', label: 'مدير النشر (نشر/تعليقات/تحليل)', desc: 'النشر والتعليقات والتحليل لكل منصة', icon: Bot, keywords: ['publish'] },
          { id: 'analytics', label: 'النتائج والتحليلات', desc: 'المشاهدات والوصول والتفاعل والتوصيات', icon: BarChart3, keywords: ['analytics', 'reports'] },
          { id: 'agent', label: 'الوكيل الذكي المركزي', desc: 'استراتيجيات التسويق والأداء', icon: Sparkles, keywords: ['marketing'] },
          { id: 'marketing_agent', label: 'وكيل صياغة المحتوى', desc: 'مهمة → محتوى عربي جاهز', icon: Sparkles, keywords: ['copywriting'] },
        ],
      },
      {
        id: 'pub_platforms',
        title: 'المنصات العشر (الموصلات)',
        icon: Network,
        items: [
          { id: 'platform_connections', label: 'مركز ربط المنصات (الكل)', desc: 'حالة كل منصة والإجراء التالي لتفعيلها', icon: PlugZap, keywords: ['connect', 'meta', 'tiktok', 'youtube', 'telegram'] },
          { id: 'social', label: 'المنصات المتصلة والمنشورات', desc: 'حالة الحسابات وقدرات النشر لكل منصة (فيسبوك/إنستغرام/تيك توك/يوتيوب/تيليغرام/ثريدز/واتساب/X/سناب/جوجل)', icon: PlugZap, keywords: ['platforms', 'connected', 'facebook', 'instagram', 'tiktok', 'youtube', 'telegram', 'threads', 'whatsapp', 'x', 'snapchat', 'google business'] },
          { id: 'youtube_operations', label: 'مدير تشغيل YouTube', desc: 'مراقبة القناة والتعليقات والرد الآلي + طابور المحتوى 24/7', icon: MonitorPlay, ownerOnly: true, keywords: ['youtube', 'watcher', 'cadence', 'auto-reply'] },
        ],
      },
      // قرار مالك صريح (2026-10-13): الأسطح التجارية (مبيعات/غرفة عمليات) تظهر في
      // الفرع فقط عند تفعيل علميها (visibleBranchItems)، فلا تظهر افتراضياً.
      {
        id: 'pub_commercial',
        title: 'المبيعات وغرفة العمليات (توسيع نطاق)',
        icon: CreditCard,
        items: [
          { id: 'sales', label: 'مركز المبيعات والتقسيط', desc: 'دورة البيع والتحصيل الفعلية على الخادم', icon: CreditCard, keywords: ['sales', 'installments'] },
          { id: 'control', label: 'غرفة العمليات الموحدة', desc: 'المتابعة اليومية، التنبيهات، التدفق النقدي ودليل العملاء', icon: Activity, keywords: ['operations', 'control', 'cashflow'] },
        ],
      },
    ],
  },

  // 3) الزبائن والتفاعلات — الوارد والردود + المهام والمتابعات.
  {
    id: 'section_customers',
    label: 'الزبائن والتفاعلات',
    desc: 'التعليقات، الرسائل، الردود، تحليل النية، والمتابعة',
    icon: MessageSquareText,
    accent: NAV_ACCENT,
    flow: 'قراءة التفاعل ← فهم السؤال والمنتج ← رد عامي عراقي ← متابعة/تصعيد للمالك.',
    branches: [
      {
        id: 'cust_inbox',
        title: 'الوارد والمتابعة',
        icon: MessageSquareText,
        items: [
          { id: 'customers', label: 'التعليقات والرسائل الواردة', desc: 'صندوق موحّد لكل التفاعلات، تحليل النية، واقتراح الردود', icon: MessageSquareText, keywords: ['inbox', 'comments', 'intent', 'reply'] },
          { id: 'operations', label: 'المهام والمتابعات', desc: 'العملاء المحتملون والمهام والمتابعات', icon: ClipboardList, keywords: ['tasks', 'follow-up'] },
        ],
      },
    ],
  },

  // 4) المنتجات والمعرفة — مصدر الحقيقة التجارية + البحث.
  {
    id: 'section_products',
    label: 'المنتجات والمعرفة',
    desc: 'المنتجات، المواصفات، الأسعار، التقسيط، والبحث ومصادر المعلومات',
    icon: Store,
    accent: NAV_ACCENT,
    flow: 'المصدر الوحيد للحقيقة التجارية: السعر/المواصفات/التقسيط المسجّلة فعلاً.',
    branches: [
      {
        id: 'prod_repo',
        title: 'المستودع والمعلومات',
        icon: Boxes,
        items: [
          { id: 'database', label: 'المنتجات والأسعار والتقسيط', desc: 'المنتجات والأقساط والسياسات والمواد التسويقية', icon: Database, keywords: ['products', 'price', 'installment', 'media'] },
        ],
      },
      {
        id: 'prod_link',
        title: 'البحث والتحقق',
        icon: Search,
        items: [
          { id: 'search', label: 'البحث في النظام', desc: 'بحث سريع في بيانات النظام (منتجات/محتوى/تفاعلات)', icon: Search, keywords: ['search'] },
        ],
      },
    ],
  },

  // 5) الإعدادات والتشغيل — الربط والصلاحيات + النظام والتعافي والأتمتة.
  {
    id: 'section_settings',
    label: 'الإعدادات والتشغيل',
    desc: 'الصلاحيات، النظام، الأتمتة، والتعافي',
    icon: Cog,
    accent: NAV_ACCENT,
    flow: 'الصلاحيات ← النظام والأتمتة ← (للمالك: التعافي والنسخ السحابي).',
    branches: [
      {
        id: 'set_connect',
        title: 'المستخدمون والصلاحيات',
        icon: Users,
        items: [
          { id: 'users', label: 'المستخدمون والصلاحيات', desc: 'أدوار الفريق وصلاحيات النشر والجلسات (RBAC)', icon: Users, keywords: ['users', 'rbac', 'sessions'] },
        ],
      },
      {
        id: 'set_system',
        title: 'النظام والأتمتة والتعافي',
        icon: ServerCog,
        items: [
          { id: 'system', label: 'مراقبة النظام', desc: 'Health/Readiness، سلامة النظام، الخدمات، النسخ، وسجل العمليات', icon: ServerCog, ownerOnly: true, keywords: ['system', 'health', 'services'] },
          { id: 'cloud_backup', label: 'التعافي والنسخ السحابي', desc: 'منظومة تعافٍ كاملة واستعادة معزولة', icon: CloudUpload, ownerOnly: true, keywords: ['recovery', 'dr', 'backup'] },
          { id: 'commercial_inbox', label: 'صندوق الزبائن (العقل التجاري)', desc: 'الزبائن المحتملون والرسائل بانتظار موافقتك — موافقة/تعديل/رفض', icon: Inbox, ownerOnly: true, keywords: ['commercial', 'inbox', 'leads', 'صندوق الزبائن', 'العقل التجاري', 'موافقة'] },
          { id: 'commercial_kill_switch', label: 'العقل التجاري — مفتاح الإيقاف الطارئ', desc: 'مفتاح رئيسي واحد: إيقاف/استئناف شامل للعقل التجاري', icon: Power, ownerOnly: true, keywords: ['commercial', 'kill switch', 'إيقاف', 'العقل التجاري'] },
        ],
      },
    ],
  },
];

/** يزيل الأوراق المتكرّرة بنفس المعرّف ويُبقي أول ظهور (لا تكرار وهمي في الشجرة). */
export function dedupeLeaves(items: NavLeaf[]): NavLeaf[] {
  const seen = new Set<string>();
  const out: NavLeaf[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

/** الأوراق الفريدة على مستوى القسم (معرّف واحد لكل وظيفة عبر كل الفروع). */
export function sectionUniqueLeaves(section: NavSection): NavLeaf[] {
  return dedupeLeaves(section.branches.flatMap((b) => b.items));
}

/**
 * تصنيف شارات التنبيه: **عاجل** (يحتاج إجراءً من المالك) مقابل **عدّاد معلوماتي**
 * (معلومة لا تستدعي إجراءً). يفرّق الشريط بينهما باللون/الوزن لا بشكل موحّد.
 */
export const NAV_BADGE_URGENT_IDS = new Set(['approval', 'customers']);
export const NAV_BADGE_INFO_IDS = new Set(['calendar']);
export type NavBadgeTone = 'urgent' | 'info';
export function navBadgeTone(leafId: string): NavBadgeTone {
  return NAV_BADGE_URGENT_IDS.has(leafId) ? 'urgent' : 'info';
}

/** الأوراق الظاهرة في فرعٍ ما بحسب دور المستخدم. */
export function visibleBranchItems(branch: NavBranch, isOwner: boolean): NavLeaf[] {
  return branch.items.filter((item) => {
    if (item.ownerOnly && !isOwner) return false;
    // أسطح ERP/CRM/المالية القديمة: مخفية افتراضياً حتى يُطفأ العزل على الخادم.
    if (!LEGACY_ERP_NAV_ENABLED && LEGACY_ERP_TAB_IDS.has(item.id)) return false;
    // تبويبا المبيعات/غرفة العمليات: قرار مالك صريح — يظهران فقط عند تفعيل علميهما.
    if (item.id === 'sales' && !SALES_TAB_ENABLED) return false;
    if (item.id === 'control' && !OPERATIONS_TAB_ENABLED) return false;
    return true;
  });
}

/** الفروع الظاهرة في قسمٍ ما بحسب دور المستخدم (نسخة واحدة للشريط ولوحة القسم). */
export function visibleSectionBranches(section: NavSection, isOwner: boolean): NavBranch[] {
  return section.branches
    .map((b) => ({ ...b, items: visibleBranchItems(b, isOwner) }))
    .filter((b) => b.items.length > 0);
}

/** كل معرّفات الأوراق الفريدة داخل قسم (لتمييز «نشط» عند فتح أي وظيفة تابعة). */
export function sectionLeafIds(section: NavSection): string[] {
  return sectionUniqueLeaves(section).map((i) => i.id);
}

/** كل الفروع/الأوراق في المشروع (للبحث). */
export function allNavBranches(): { section: NavSection; branch: NavBranch; leaf: NavLeaf }[] {
  const out: { section: NavSection; branch: NavBranch; leaf: NavLeaf }[] = [];
  for (const s of NAV_SECTIONS) for (const b of s.branches) for (const l of b.items) out.push({ section: s, branch: b, leaf: l });
  return out;
}

/**
 * بحث في الأقسام/الفروع/الوظائف. يعيد الأقسام المطابقة (ومعها ما يطابق) ليعرضها
 * الشريط الجانبي. مطابقة بالاسم أو الوصف أو الكلمات المفتاحية (بلا حساسية حالة).
 */
export function searchNav(query: string, isOwner: boolean): NavSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return NAV_SECTIONS.filter((s) => !s.ownerOnly || isOwner);
  const matches = (s: NavSection, b: NavBranch, l: NavLeaf) =>
    [s.label, s.desc, b.title, l.label, l.desc, ...(l.keywords || [])].join(' ').toLowerCase().includes(q);
  const out: NavSection[] = [];
  for (const s of NAV_SECTIONS) {
    if (s.ownerOnly && !isOwner) continue;
    const branches = visibleSectionBranches(s, isOwner)
      .map((b) => ({ ...b, items: b.items.filter((l) => matches(s, b, l)) }))
      .filter((b) => b.items.length > 0);
    // مطابقة على مستوى اسم القسم/الفرع أيضاً
    const sectionHit = [s.label, s.desc].join(' ').toLowerCase().includes(q) ||
      visibleSectionBranches(s, isOwner).some((b) => b.title.toLowerCase().includes(q));
    if (branches.length > 0 || sectionHit) {
      out.push({ ...s, branches: branches.length > 0 ? branches : visibleSectionBranches(s, isOwner) });
    }
  }
  return out;
}
