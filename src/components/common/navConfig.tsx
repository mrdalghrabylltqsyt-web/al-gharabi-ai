import React from 'react';
import {
  Home, LayoutDashboard, Send, Sparkles, MessageSquare, Package, Settings,
  Bot, BarChart3, Calendar, Users, Search, ClipboardList, Brain, PlugZap,
  CloudUpload, Database, ServerCog, Youtube, ShieldCheck, Activity, Workflow,
  ListChecks, HardDrive, KeyRound, Gem, Facebook, Instagram, Twitter, Globe,
  MessageCircle, Boxes, Bell, RefreshCw, CreditCard, Layers,
  RadioTower, Cpu, Network,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// خريطة التنقل الهرمية الموحّدة — **مصدر واحد للحقيقة**.
//
// ثلاثة مستويات:
//   1) قسم رئيسي (NavSection) — عنوان قابل للفتح/الإغلاق في الشريط الجانبي.
//   2) فرع (NavBranch) — مجموعة/فرع تحت القسم، قابل للفتح/الإغلاق.
//   3) ورقة (NavLeaf) — وظيفة فعلية لها `id` يقابلها `case` في App.tsx (مكوّن حقيقي).
//
// قاعدة ملزمة: لا تُضاف ورقة إلا ومعرّفها مُنفَّذ في switch العرض (مكوّن حقيقي)،
// فيستحيل وجود «زر شكلي بلا وظيفة». الوظائف القديمة كلها محفوظة كما هي (لا حذف).
//
// معرّفات الأقسام تبدأ بـ`section_` — تبقى متوافقة مع الفحوص القائمة.
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
export interface NavSection {
  id: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  ownerOnly?: boolean;
  /** وصف مسار العمل الموحّد للقسم (يُعرض في ترويسة القسم + مسار التنقّل). */
  flow: string;
  branches: NavBranch[];
}

// أيقونة مساعدة لـSnapchat (لا أيقونة مخصّصة في lucide) — بلا وظيفة إضافية.
const RotateIcon = (props: { className?: string }) => <RefreshCw {...props} />;

// SCOPE ISOLATION (LEGACY ERP): أسطح Inventory/CRM/Finance/Customers-360/Purchases/
// خارج نطاق المشروع المعلن (سوشيال + AI + تسويق)، ومعزولة على الخادم افتراضياً
// (404 SCOPE_DISABLED). نخفي مداخلها كي لا تُعرض واجهات غير قابلة للاستخدام.
// تُعاد بإطفاء العزل على الخادم (GHARABI_ENABLE_LEGACY_ERP_SCOPE=true) وضبط هذا true.
export const LEGACY_ERP_NAV_ENABLED = false;
export const LEGACY_ERP_TAB_IDS = new Set(['executive', 'business', 'finance', 'inventory', 'reports', 'sales', 'control']);

export const NAV_SECTIONS: NavSection[] = [
  // 1) مركز القيادة والمالك
  {
    id: 'section_home',
    label: 'مركز القيادة والمالك',
    desc: 'الحالة العامة، المنصات، النشر، التفاعلات، التنبيهات، والتقارير',
    icon: Home,
    flow: 'نظرة موحّدة: ما يعمل، ما يحتاج إجراءً، وما ينتظر موافقة المالك.',
    branches: [
      {
        id: 'home_command',
        title: 'القيادة والنظرة العامة',
        icon: LayoutDashboard,
        items: [
          { id: 'command_center', label: 'مركز القيادة', desc: 'حالة النظام، ملخص العمل، والتنبيهات', icon: LayoutDashboard, keywords: ['dashboard', 'overview'] },
          { id: 'dashboard', label: 'لوحة التحكم الرئيسية', desc: 'المؤشرات والعمليات الحالية', icon: LayoutDashboard, keywords: ['dashboard'] },
          { id: 'system', label: 'حالة النظام والخدمات', desc: 'سلامة النظام والنسخ وسجل العمليات', icon: ServerCog, ownerOnly: true, keywords: ['health', 'system'] },
        ],
      },
      {
        id: 'home_platforms',
        title: 'المنصات والنشر',
        icon: PlugZap,
        items: [
          { id: 'social', label: 'ملخص المنصات المتصلة', desc: 'حالة الحسابات وقدرات النشر لكل منصة', icon: PlugZap, keywords: ['platforms', 'connected'] },
          { id: 'calendar', label: 'حالة النشر والجدولة', desc: 'المنشورات المجدولة حسب الأيام', icon: Calendar, keywords: ['schedule', 'calendar'] },
        ],
      },
      {
        id: 'home_customers',
        title: 'التفاعلات والمتابعة',
        icon: MessageSquare,
        items: [
          { id: 'customers', label: 'ملخص التفاعلات والتعليقات والرسائل', desc: 'التعليقات والرسائل والردود والمتابعة', icon: MessageSquare, keywords: ['inbox', 'comments'] },
          { id: 'operations', label: 'المهام والمتابعات', desc: 'العملاء المحتملون والمهام والمتابعات', icon: ClipboardList, keywords: ['tasks'] },
        ],
      },
      {
        id: 'home_reports',
        title: 'التقارير والاعتماد',
        icon: BarChart3,
        items: [
          { id: 'analytics', label: 'التقارير والنتائج والتوصيات', desc: 'المشاهدات والوصول والتفاعل', icon: BarChart3, keywords: ['reports', 'analytics'] },
          { id: 'approval', label: 'مراجعة الأوامر التي تحتاج موافقة', desc: 'حوكمة النشر والمراجعة قبل النشر الموحّد', icon: ShieldCheck, keywords: ['approval', 'review'] },
        ],
      },
    ],
  },

  // 2) النشر الموحد ومنصات التواصل
  {
    id: 'section_publish',
    label: 'النشر الموحد ومنصات التواصل',
    desc: 'إنشاء المحتوى، اختيار المنصات، النشر والجدولة والنتائج، وموصلات المنصات',
    icon: Send,
    flow: 'إنشاء ← تجهيز لكل منصة ← اعتماد ← نشر/جدولة ← متابعة النتيجة لكل منصة.',
    branches: [
      {
        id: 'pub_content',
        title: 'دورة المحتوى',
        icon: Sparkles,
        items: [
          { id: 'content', label: 'إنشاء المحتوى وتحريره ومعاينته', desc: 'توليد منشورات وتعديل النص لكل منصة', icon: Sparkles, keywords: ['content', 'create'] },
          { id: 'approval', label: 'الموافقة والاعتماد', desc: 'مراجعة المحتوى قبل النشر الموحّد', icon: ShieldCheck, keywords: ['approval'] },
          { id: 'calendar', label: 'الجدولة والتقويم', desc: 'جدولة المنشورات حسب الأيام', icon: Calendar, keywords: ['schedule'] },
        ],
      },
      {
        id: 'pub_publish',
        title: 'النشر والنتائج',
        icon: Send,
        items: [
          { id: 'social_manager', label: 'مدير النشر (نشر/تعليقات/تحليل)', desc: 'النشر والتعليقات والتحليل لكل منصة', icon: Bot, keywords: ['publish'] },
          { id: 'analytics', label: 'نتائج النشر والتحليلات', desc: 'المشاهدات والوصول والتفاعل', icon: BarChart3, keywords: ['analytics'] },
          { id: 'agent', label: 'الوكيل الذكي المركزي', desc: 'استراتيجيات التسويق والأداء', icon: Sparkles, keywords: ['marketing'] },
          { id: 'marketing_agent', label: 'وكيل صياغة المحتوى', desc: 'مهمة → محتوى عربي جاهز', icon: Sparkles, keywords: ['copywriting'] },
        ],
      },
      {
        id: 'pub_platforms',
        title: 'المنصات العشر (الموصلات)',
        icon: Network,
        items: [
          { id: 'platform_connections', label: 'مركز ربط المنصات (الكل)', desc: 'حالة كل منصة والإجراء التالي لتفعيلها', icon: PlugZap, keywords: ['connect'] },
          { id: 'social', label: 'Facebook', desc: 'منشورات الصفحة، Messenger، تعليقات الصفحة', icon: Facebook, keywords: ['facebook', 'meta'] },
          { id: 'social', label: 'Instagram', desc: 'حساب أعمال مرتبط بصفحة: نشر/تعليقات/رسائل', icon: Instagram, keywords: ['instagram', 'ig'] },
          { id: 'social', label: 'TikTok', desc: 'نشر الفيديو (Content Posting) وبيانات العرض', icon: Sparkles, keywords: ['tiktok'] },
          { id: 'youtube_operations', label: 'YouTube', desc: 'رفع/جدولة/تعليقات/تحليلات + مدير تشغيل 24/7', icon: Youtube, ownerOnly: true, keywords: ['youtube'] },
          { id: 'social', label: 'Telegram', desc: 'بوت: نشر في القناة ورسائل وردود', icon: Send, keywords: ['telegram'] },
          { id: 'social', label: 'Threads', desc: 'نشر عبر Threads API', icon: MessageCircle, keywords: ['threads'] },
          { id: 'social', label: 'WhatsApp Business', desc: 'رسائل وردود (بلا نشر عام)', icon: MessageCircle, keywords: ['whatsapp'] },
          { id: 'social', label: 'X', desc: 'نشر وتعليقات عبر API المدفوع', icon: Twitter, keywords: ['twitter', 'x'] },
          { id: 'social', label: 'Snapchat', desc: 'إعلانات/تحويلات (بلا تعليقات عامة)', icon: RotateIcon, keywords: ['snapchat'] },
          { id: 'social', label: 'Google Business Profile', desc: 'تحديثات محلية (بلا تعليقات)', icon: Globe, keywords: ['gbp', 'google business'] },
        ],
      },
    ],
  },

  // 3) العقول المتخصصة
  {
    id: 'section_brains',
    label: 'العقول المتخصصة',
    desc: 'وحدات التحليل والتوصية: الإدراك، الجمهور، السوق، الاستراتيجية، التجارب، التعلم، التوقيت، السياق، الفريق',
    icon: Brain,
    flow: 'تحليل بيانات حقيقية ← توصية/قرار مقترح ← تغذية العقل المركزي (بلا تنفيذ خارجي).',
    branches: [
      {
        id: 'brains_core',
        title: 'عقول المعرفة والجمهور والسوق',
        icon: Cpu,
        items: [
          { id: 'central_brain', label: 'عقل الإدراك والمعرفة', desc: 'الإشارات وطبقة الحقيقة والتوصيات لكل المنصات', icon: Brain, keywords: ['perception', 'knowledge', 'truth'] },
          { id: 'central_brain', label: 'عقل الجمهور واكتشاف الطلب', desc: 'مقاطع سلوكية وإشارات طلب من تفاعل حقيقي', icon: Users, keywords: ['audience', 'demand'] },
          { id: 'central_brain', label: 'عقل السوق وتحليل الفرص', desc: 'القُمع التجاري وملاءمة الجمهور', icon: BarChart3, keywords: ['market', 'opportunity'] },
        ],
      },
      {
        id: 'brains_decision',
        title: 'عقول الاستراتيجية والقرار والعروض',
        icon: Layers,
        items: [
          { id: 'central_brain', label: 'عقل الاستراتيجية واتخاذ القرارات', desc: 'توصيات مفسّرة وقرارات حسب المستويات L0..L5', icon: Layers, keywords: ['strategy', 'decision'] },
          { id: 'brain_manager', label: 'عقل العروض والمبيعات', desc: 'صياغة العروض ومسار الاستفسار (بلا اختراع سعر)', icon: CreditCard, keywords: ['offers', 'sales'] },
        ],
      },
      {
        id: 'brains_learning',
        title: 'عقول التجارب والتعلم والتوقيت',
        icon: Activity,
        items: [
          { id: 'central_brain', label: 'عقل التجارب والاختبارات', desc: 'تجارب بمتغيّر واحد وحكم inconclusive بلا عيّنة', icon: Activity, keywords: ['experiments'] },
          { id: 'central_brain', label: 'عقل التعلم وتحليل النتائج', desc: 'تعلّم من الأحداث وتفضيل المالك (بلا تدريب أوزان)', icon: RefreshCw, keywords: ['learning'] },
          { id: 'calendar', label: 'عقل التوقيت وجدولة العمليات', desc: 'نوافذ النشر وفق Asia/Baghdad', icon: Calendar, keywords: ['timing'] },
        ],
      },
      {
        id: 'brains_context',
        title: 'عقول السياق والذاكرة والفريق',
        icon: MessageCircle,
        items: [
          { id: 'brain_manager', label: 'عقل الإدراك والسياق والذاكرة', desc: 'سياق المحادثة واستدعاء الذاكرة العاملة', icon: MessageCircle, keywords: ['context', 'memory'] },
          { id: 'brain_manager', label: 'عقل إدارة الفريق وتوزيع المهام', desc: 'فريق داخلي: بحث/تحليل/استراتيجية/نقد/قرار', icon: Users, keywords: ['team', 'council'] },
        ],
      },
    ],
  },

  // 4) العقل المركزي والمنسق التنفيذي
  {
    id: 'section_central',
    label: 'العقل المركزي والمنسق التنفيذي',
    desc: 'فهم الأوامر، التخطيط، الأدوات، التوزيع، متابعة التنفيذ، والصلاحيات',
    icon: Bot,
    ownerOnly: true,
    flow: 'أمر ← تصنيف نية ← خطة ← أدوات ← (بوابة صلاحيات) ← تنفيذ/تحقق ← سجل.',
    branches: [
      {
        id: 'central_plan',
        title: 'الفهم والتخطيط',
        icon: ClipboardList,
        items: [
          { id: 'central_agent', label: 'فهم الأوامر وتصنيف النية', desc: 'تصنيف حتمي للنية وبناء خطة خطوات', icon: ClipboardList, keywords: ['intent', 'planner'] },
          { id: 'central_agent', label: 'تخطيط المهام واختيار الأدوات', desc: '٣٠ أداة مرتبطة بوظائف الخادم الحقيقية', icon: Workflow, keywords: ['tools'] },
          { id: 'central_agent', label: 'توزيع المهام على العقول', desc: 'تسليم النتائج بين الوحدات داخل المهمة', icon: Network, keywords: ['routing'] },
        ],
      },
      {
        id: 'central_run',
        title: 'التنفيذ والمراقبة',
        icon: Activity,
        items: [
          { id: 'central_agent', label: 'متابعة تنفيذ المهام', desc: 'حالة كل مهمة وخطواتها ونتائجها', icon: Activity, keywords: ['tasks'] },
          { id: 'central_agent', label: 'التحقق من الصلاحيات والقيود', desc: 'بوابة EXTERNAL_ACTION + تفويض المالك + كشف الأخطاء', icon: ShieldCheck, keywords: ['permissions'] },
          { id: 'central_agent', label: 'سجل القرارات والأحداث', desc: 'تدقيق وتقارير حالة التنفيذ والتوصيات', icon: ListChecks, keywords: ['audit', 'ledger'] },
        ],
      },
    ],
  },

  // 5) المصادقة والأمان والصلاحيات
  {
    id: 'section_security',
    label: 'المصادقة والأمان والصلاحيات',
    desc: 'تسجيل الدخول، الجلسات، الأدوار، حماية API، وحالة الإعدادات الأمنية',
    icon: ShieldCheck,
    ownerOnly: true,
    flow: 'دخول ← جلسة موقّعة ← دور ← بوابة صلاحيات ← تدقيق (بلا كشف أي سرّ).',
    branches: [
      {
        id: 'sec_access',
        title: 'الوصول والجلسات',
        icon: KeyRound,
        items: [
          { id: 'users', label: 'إدارة الجلسات وصلاحيات المالك', desc: 'أدوار الفريق وصلاحيات النشر (RBAC)', icon: Users, keywords: ['sessions', 'rbac'] },
          { id: 'system', label: 'حالة إعدادات الأمان ومفاتيح التشفير', desc: 'حالة الإعداد فقط بلا كشف قيمة السر', icon: KeyRound, keywords: ['keys', 'encryption'] },
          { id: 'system', label: 'تدقيق محاولات الدخول والأخطاء', desc: 'سجل الأحداث الأمنية المتاحة', icon: ListChecks, keywords: ['audit', 'login'] },
        ],
      },
      {
        id: 'sec_external',
        title: 'صلاحيات الإجراءات الخارجية والموافقات',
        icon: ShieldCheck,
        items: [
          { id: 'approval', label: 'الموافقات المطلوبة قبل التنفيذ', desc: 'حوكمة الإجراءات الخارجية الحسّاسة', icon: ShieldCheck, keywords: ['approval'] },
          { id: 'central_agent', label: 'إدارة صلاحيات الإجراءات الخارجية', desc: 'مستويات الصلاحية الخمسة × المشغّل', icon: ShieldCheck, keywords: ['permissions', 'delegation'] },
        ],
      },
    ],
  },

  // 6) مركز الزبائن والتفاعلات
  {
    id: 'section_customers',
    label: 'مركز الزبائن والتفاعلات',
    desc: 'التعليقات، الرسائل، الردود، تحليل النية، والمتابعة',
    icon: MessageSquare,
    flow: 'قراءة التفاعل ← فهم السؤال والمنتج ← رد عامي عراقي ← متابعة/تصعيد للمالك.',
    branches: [
      {
        id: 'cust_inbox',
        title: 'الوارد والردود',
        icon: MessageSquare,
        items: [
          { id: 'customers', label: 'التعليقات والرسائل الواردة', desc: 'صندوق موحّد لكل التفاعلات والمتابعة', icon: MessageSquare, keywords: ['inbox', 'comments'] },
          { id: 'customers', label: 'تحليل نية الزبون وربط المنتجات', desc: 'تصنيف السؤال (سعر/مواصفات/تقسيط) وربطه بالمنتج', icon: Cpu, keywords: ['intent'] },
          { id: 'customers', label: 'اقتراح الردود ومراجعتها قبل الإرسال', desc: 'ردود حتمية بلا اختراع + حارس سلامة المحتوى', icon: Sparkles, keywords: ['reply'] },
        ],
      },
      {
        id: 'cust_history',
        title: 'السجل والنتائج',
        icon: ListChecks,
        items: [
          { id: 'customers', label: 'سجل المحادثات والتفاعلات', desc: 'حالات معالجة التعليقات والرسائل', icon: ListChecks, keywords: ['history'] },
          { id: 'analytics', label: 'إحصائيات التفاعل والنتائج', desc: 'مؤشرات التفاعل والنتائج', icon: BarChart3, keywords: ['stats'] },
          { id: 'youtube_operations', label: 'الرد التلقائي (YouTube)', desc: 'يُعرض فعّالاً فقط عند تمكينه وإثبات اتصاله', icon: Youtube, ownerOnly: true, keywords: ['auto-reply'] },
        ],
      },
    ],
  },

  // 7) مستودع المنتجات والمعرفة
  {
    id: 'section_products',
    label: 'مستودع المنتجات والمعرفة',
    desc: 'المنتجات، المواصفات، الأسعار، التقسيط، والبحث ومصادر المعلومات',
    icon: Package,
    flow: 'المصدر الوحيد للحقيقة التجارية: السعر/المواصفات/التقسيط المسجّلة فعلاً.',
    branches: [
      {
        id: 'prod_repo',
        title: 'المستودع والمعلومات',
        icon: Boxes,
        items: [
          { id: 'database', label: 'بيانات المنتجات والتصنيفات', desc: 'المنتجات والأقساط والسياسات', icon: Database, keywords: ['products'] },
          { id: 'database', label: 'الأسعار والعروض والتقسيط', desc: 'أسعار فعلية وتقسيط مشتق من سعر مسجّل', icon: CreditCard, keywords: ['price', 'installment'] },
          { id: 'database', label: 'الصور والمواد التسويقية', desc: 'مواد المنتج ومصادر المعلومات', icon: Package, keywords: ['media'] },
        ],
      },
      {
        id: 'prod_link',
        title: 'الربط والتحقق',
        icon: Search,
        items: [
          { id: 'search', label: 'البحث عن المنتجات', desc: 'بحث سريع في بيانات النظام', icon: Search, keywords: ['search'] },
          { id: 'database', label: 'التحقق من صحة المعلومات وسجل التحديثات', desc: 'ربط المنتجات بالتعليقات والرسائل', icon: ListChecks, keywords: ['verify'] },
        ],
      },
    ],
  },

  // 8) محرك الأتمتة والجدولة
  {
    id: 'section_automation',
    label: 'محرك الأتمتة والجدولة',
    desc: 'المهام المجدولة، المهام الخلفية، قوائم الانتظار، وسجل التنفيذ',
    icon: Workflow,
    ownerOnly: true,
    flow: 'إنشاء مهمة ← طابور ← بوابة شروط ← تنفيذ ← إعادة عند الفشل ← سجل (بلا تكرار).',
    branches: [
      {
        id: 'auto_jobs',
        title: 'المهام والطوابير',
        icon: ListChecks,
        items: [
          { id: 'central_agent', label: 'المهام المجدولة وقوائم الانتظار', desc: 'مهام الوكيل الخلفية وحالاتها', icon: ListChecks, keywords: ['jobs', 'queue'] },
          { id: 'calendar', label: 'جدولة المنشورات والمواعيد', desc: 'مواعيد النشر والمتابعة', icon: Calendar, keywords: ['schedule'] },
          { id: 'youtube_operations', label: 'الأتمتة الدورية (YouTube 24/7)', desc: 'دورة داخلية بالفاصل 1..5 دقائق + إيقاف/استئناف', icon: Youtube, ownerOnly: true, keywords: ['watcher', 'cadence'] },
        ],
      },
      {
        id: 'auto_logs',
        title: 'السجل والأخطاء',
        icon: Activity,
        items: [
          { id: 'system', label: 'سجل التنفيذ والإشعارات', desc: 'نتائج المهام وانتهاؤها', icon: Activity, keywords: ['logs'] },
          { id: 'system', label: 'الأخطاء وإعادة المحاولة', desc: 'حالات الفشل والاستثناءات', icon: RefreshCw, keywords: ['errors', 'retry'] },
        ],
      },
    ],
  },

  // 9) الذاكرة والتعلم والتحليل
  {
    id: 'section_memory',
    label: 'الذاكرة والتعلم والتحليل',
    desc: 'ذاكرة النظام، سجل الأحداث، نتائج النشر والتفاعلات، والمؤشرات والتوصيات',
    icon: Brain,
    flow: 'حدث ← تخزين ← تحليل ← استخراج مؤشرات ← توصية ← (موافقة) ← تحسين ← قياس.',
    branches: [
      {
        id: 'mem_memory',
        title: 'الذاكرة والأحداث',
        icon: HardDrive,
        items: [
          { id: 'central_brain', label: 'ذاكرة النظام وذاكرة السياق', desc: 'ذاكرة طويلة المدى وعاملة (ضمن الصلاحيات)', icon: HardDrive, keywords: ['memory'] },
          { id: 'central_brain', label: 'سجل الأحداث والقرارات', desc: 'أحداث حقيقية وقرارات مسجّلة', icon: ListChecks, keywords: ['events', 'ledger'] },
        ],
      },
      {
        id: 'mem_analysis',
        title: 'التحليل والنتائج',
        icon: BarChart3,
        items: [
          { id: 'analytics', label: 'نتائج النشر والتفاعلات ومؤشرات الأداء', desc: 'مؤشرات متعددة الأبعاد بلا رقم مُختلق', icon: BarChart3, keywords: ['kpi'] },
          { id: 'analytics', label: 'اكتشاف الأنماط وقياس أداء الحملات', desc: 'أنماط وتوصيات للتحسين', icon: Activity, keywords: ['patterns'] },
          { id: 'central_brain', label: 'التوصيات للتحسين ومتابعة النتائج', desc: 'تحسين التوصيات/القواعد (لا تدريب نموذج)', icon: Sparkles, keywords: ['optimization'] },
        ],
      },
    ],
  },

  // 10) التخزين وقاعدة البيانات
  {
    id: 'section_storage',
    label: 'التخزين وقاعدة البيانات',
    desc: 'حالة قاعدة البيانات، التخزين الدائم، ومصادر الحالة للأقسام الأخرى',
    icon: Database,
    ownerOnly: true,
    flow: 'قراءة/كتابة عبر محوّل واحد (ملف أو Postgres) — بلا تغيير المخطط.',
    branches: [
      {
        id: 'store_state',
        title: 'الحالة والدوام',
        icon: HardDrive,
        items: [
          { id: 'system', label: 'حالة قاعدة البيانات والتخزين', desc: 'backend (ملف/Postgres) والإعداد الحالي', icon: Database, keywords: ['db', 'postgres'] },
          { id: 'system', label: 'التحقق من استمرارية البيانات', desc: 'حالة التخزين الدائم ونتائج اختبارات الاستمرارية', icon: HardDrive, keywords: ['durability'] },
        ],
      },
      {
        id: 'store_data',
        title: 'بيانات النطاق',
        icon: Boxes,
        items: [
          { id: 'customers', label: 'بيانات التفاعلات', desc: 'التعليقات والرسائل والردود', icon: MessageSquare, keywords: ['interactions'] },
          { id: 'social_manager', label: 'بيانات المحتوى والمنشورات', desc: 'المنشورات وسجلاتها', icon: Send, keywords: ['content'] },
        ],
      },
    ],
  },

  // 11) المراقبة وصحة النظام
  {
    id: 'section_monitoring',
    label: 'المراقبة وصحة النظام',
    desc: 'Health/Readiness، حالة API والخدمات والموصلات والأتمتة، والإصدار',
    icon: Activity,
    flow: 'فحص حي للخدمة والواجهات والموصلات — قراءة فقط بلا بيانات حساسة.',
    branches: [
      {
        id: 'mon_health',
        title: 'الصحة والإصدار',
        icon: Activity,
        items: [
          { id: 'system', label: 'Health / Readiness / حالة API', desc: 'نقاط النهاية الفعلية بلا بيانات حساسة', icon: Activity, keywords: ['health', 'readiness'] },
          { id: 'system', label: 'معلومات الإصدار والبناء', desc: 'الإصدار وcommit النشر والبيئة', icon: ListChecks, keywords: ['version', 'build'] },
        ],
      },
      {
        id: 'mon_runtime',
        title: 'الخدمات الخلفية',
        icon: ServerCog,
        items: [
          { id: 'system', label: 'حالة الخدمات والموصلات والأتمتة', desc: 'الموقّتات الداخلية وحالة الاتصال', icon: ServerCog, keywords: ['services'] },
          { id: 'system', label: 'الأخطاء والتنبيهات والفحوصات', desc: 'نتائج الفحوصات المتاحة وتنبيهاتها', icon: Bell, keywords: ['alerts'] },
        ],
      },
    ],
  },

  // 12) النسخ الاحتياطي والتعافي
  {
    id: 'section_recovery',
    label: 'النسخ الاحتياطي والتعافي والاستنساخ',
    desc: 'مركز التعافي، النسخ، التحقق من السلامة، واختبار الاستعادة',
    icon: CloudUpload,
    ownerOnly: true,
    flow: 'نسخة كاملة ← Drive (CURRENT/HISTORY) ← تحقق ← استعادة معزولة (لا استعادة إنتاجية).',
    branches: [
      {
        id: 'rec_backup',
        title: 'النسخ والمصادر',
        icon: CloudUpload,
        items: [
          { id: 'cloud_backup', label: 'مركز التعافي وحالة النسخ', desc: 'CURRENT + نقاط الاستعادة + وجهات التخزين', icon: CloudUpload, keywords: ['dr', 'recovery'] },
          { id: 'cloud_backup', label: 'سجل النسخ والتحقق من السلامة', desc: 'سجلات النسخ واختبارات السلامة', icon: ShieldCheck, keywords: ['integrity'] },
        ],
      },
      {
        id: 'rec_restore',
        title: 'الاستعادة والاستنساخ',
        icon: RefreshCw,
        items: [
          { id: 'cloud_backup', label: 'اختبار الاستعادة ونتائجها', desc: 'استعادة معزولة (لا إنتاج)', icon: Activity, keywords: ['restore', 'drill'] },
          { id: 'cloud_backup', label: 'استمرارية البيانات والتبعيات الخارجية', desc: 'حالة الاستمرارية والإعداد المطلوب', icon: HardDrive, keywords: ['external'] },
        ],
      },
    ],
  },

  // 13) الخدمات الخارجية والإعدادات
  {
    id: 'section_external',
    label: 'الخدمات الخارجية والإعدادات',
    desc: 'Gemini، Google، Meta، TikTok، YouTube، Telegram، وحالة الاعتماد والصلاحيات',
    icon: PlugZap,
    ownerOnly: true,
    flow: 'حالة كل تكامل (configured/connected/verified) بلا كشف أي سرّ أو توكن.',
    branches: [
      {
        id: 'ext_ai',
        title: 'الذكاء والبحث',
        icon: Gem,
        items: [
          { id: 'system', label: 'Gemini AI — الحالة والصلاحيات', desc: 'مزوّد التوليد وجودة الاتصال (بلا مفتاح)', icon: Gem, keywords: ['gemini'] },
          { id: 'system', label: 'Google Sign-In / Drive', desc: 'الدخول والنسخ السحابي (حالة التكامل)', icon: Globe, keywords: ['google'] },
        ],
      },
      {
        id: 'ext_platforms',
        title: 'تكاملات المنصات',
        icon: Network,
        items: [
          { id: 'platform_connections', label: 'Meta / Facebook / Instagram', desc: 'بيانات التطبيق والصلاحيات والربط', icon: Facebook, keywords: ['meta'] },
          { id: 'platform_connections', label: 'TikTok API / YouTube API / Telegram Bot', desc: 'حالة الاعتماد والنطاقات لكل مزوّد', icon: RadioTower, keywords: ['tiktok', 'youtube', 'telegram'] },
          { id: 'system', label: 'سجل أخطاء الاتصال', desc: 'أخطاء المزوّدين الحقيقية (بلا أسرار)', icon: Activity, keywords: ['errors'] },
        ],
      },
    ],
  },

  // 14) الإعدادات والتشغيل
  {
    id: 'section_settings',
    label: 'الإعدادات والتشغيل',
    desc: 'ربط المنصات، الصلاحيات، سياسات التشغيل، والنظام',
    icon: Settings,
    flow: 'ربط المنصات ← الصلاحيات ← سياسات التشغيل ← (للمالك: النظام والتعافي).',
    branches: [
      {
        id: 'set_connect',
        title: 'الربط والصلاحيات',
        icon: PlugZap,
        items: [
          { id: 'platform_connections', label: 'ربط المنصات', desc: 'حالة كل منصة والإجراء التالي لتفعيلها', icon: PlugZap, keywords: ['connect'] },
          { id: 'users', label: 'المستخدمون والصلاحيات', desc: 'أدوار الفريق وصلاحيات النشر', icon: Users, keywords: ['users'] },
        ],
      },
      {
        id: 'set_system',
        title: 'النظام والأتمتة والتعافي',
        icon: ServerCog,
        items: [
          { id: 'system', label: 'مراقبة النظام', desc: 'سلامة النظام والنسخ وسجل العمليات', icon: ServerCog, ownerOnly: true, keywords: ['system'] },
          { id: 'youtube_operations', label: 'مدير تشغيل YouTube', desc: 'مراقبة القناة والتعليقات والرد الآلي', icon: Youtube, ownerOnly: true, keywords: ['youtube'] },
          { id: 'cloud_backup', label: 'التعافي والنسخ السحابي', desc: 'منظومة تعافٍ كاملة واستعادة معزولة', icon: CloudUpload, ownerOnly: true, keywords: ['recovery'] },
        ],
      },
    ],
  },
];

/** الأوراق الظاهرة في فرعٍ ما بحسب دور المستخدم. */
export function visibleBranchItems(branch: NavBranch, isOwner: boolean): NavLeaf[] {
  return branch.items.filter(
    (item) => (!item.ownerOnly || isOwner) && (LEGACY_ERP_NAV_ENABLED || !LEGACY_ERP_TAB_IDS.has(item.id)),
  );
}

/** الفروع الظاهرة في قسمٍ ما بحسب دور المستخدم (نسخة واحدة للشريط ولوحة القسم). */
export function visibleSectionBranches(section: NavSection, isOwner: boolean): NavBranch[] {
  return section.branches
    .map((b) => ({ ...b, items: visibleBranchItems(b, isOwner) }))
    .filter((b) => b.items.length > 0);
}

/** كل معرّفات الأوراق داخل قسم (لتمييز «نشط» عند فتح أي وظيفة تابعة). */
export function sectionLeafIds(section: NavSection): string[] {
  return section.branches.flatMap((b) => b.items.map((i) => i.id));
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
