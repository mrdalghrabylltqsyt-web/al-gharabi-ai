export type SocialPlatformId =
  | 'tiktok'
  | 'youtube'
  | 'facebook'
  | 'instagram'
  | 'whatsapp'
  | 'telegram'
  | 'x'
  | 'snapchat'
  | 'threads'
  | 'google_business'
  | string;

export interface PlatformAccount {
  id: string;
  platform: SocialPlatformId;
  name: string;
  handle: string;
  status: 'connected' | 'reauth_needed' | 'disconnected';
  followers: number;
  engagementRate: string;
  postsCount: number;
  unreadMessages: number;
  scheduledCount: number;
  iconName: string;
  color: string;
  badge?: string;
  lastSyncTime?: string;
}

export type PostStatus =
  | 'draft' // مسودة
  | 'review' // قيد المراجعة
  | 'edited' // تم التعديل
  | 'approved' // تمت الموافقة
  | 'scheduled' // مجدول
  | 'published'; // تم النشر

export interface PostMetric {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  reach: number;
}

export interface ApprovalAction {
  id: string;
  byUser: string;
  userRole: UserRole;
  action: 'create' | 'edit' | 'submit_review' | 'approve' | 'reject' | 'schedule' | 'publish';
  timestamp: string;
  note?: string;
}

export interface Post {
  id: string;
  title: string;
  content: string;
  platformVersions?: Record<string, string>; // Tailored text per platform
  targetPlatforms: SocialPlatformId[];
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'carousel';
  status: PostStatus;
  scheduledFor?: string;
  publishedAt?: string;
  createdAt: string;
  authorName: string;
  authorRole: UserRole;
  history: ApprovalAction[];
  metrics?: PostMetric;
  tags?: string[];
  campaignName?: string;
}

export type ContentFormatType =
  | 'post' // منشور عادي
  | 'ad' // إعلان ترويجي
  | 'short_video' // فيديو قصير
  | 'script' // سكربت تصوير
  | 'youtube' // عنوان ووصف يوتيوب
  | 'hashtags' // هاشتاغات متخصصة
  | 'campaign' // أفكار حملة تسويقية
  | 'comment_reply' // رد على تعليقات
  | 'customer_reply'; // رد على استفسار تقسيط

export interface MessageExchange {
  id: string;
  sender: 'customer' | 'ai' | 'human';
  senderName?: string;
  text: string;
  timestamp: string;
}

export interface CustomerConversation {
  id: string;
  customerName: string;
  phone: string;
  channel: SocialPlatformId;
  avatar: string;
  lastMessage: string;
  lastMessageTime: string;
  category: string;
  urgency: 'high' | 'medium' | 'low';
  status: 'new' | 'ai_replied' | 'transferred_human' | 'resolved';
  suggestedReply?: string;
  assignedStaff?: string;
  history: MessageExchange[];
  notes?: string;
  interestedProduct?: string;
  calculatedQuote?: {
    product: string;
    monthly: number;
    downPayment: number;
    months: number;
  };
}

export interface ShowroomProduct {
  id: string;
  name: string;
  category: 'appliances' | 'phones' | 'construction' | 'electronics' | 'other';
  modelYear?: string;
  cashPrice: number;
  installmentFrom: number;
  downPaymentPercent: number;
  durationMonths: number;
  image: string;
  inStock: boolean;
  featured?: boolean;
  specs: string[];
  installmentOptions: string[];
}

export interface InstallmentPlan {
  id: string;
  title: string;
  description: string;
  minDownPaymentPercent: number;
  maxMonths: number;
  requirements: string[];
  targetAudience: string;
  features: string[];
  shariaApproved: boolean;
}

export interface ShowroomInfo {
  name: string;
  tagline: string;
  address: string;
  city: string;
  phoneUnified: string;
  whatsappSales: string;
  supportEmail: string;
  workingHours: string;
  about: string;
  policies: string[];
  faqs: Array<{ id: string; q: string; a: string; category: string }>;
}

export type UserRole =
  | 'owner' // مالك النظام (Owner) - أعلى صلاحية في النظام
  | 'manager' // المدير العام
  | 'staff' // الموظف
  | 'content_creator' // مسؤول المحتوى
  | 'customer_support'; // مسؤول خدمة العملاء

export interface AppUser {
  id: string;
  name: string;
  role: UserRole;
  roleTitleArabic: string;
  email: string;
  avatar: string;
  active: boolean;
}

export interface CalendarEntry {
  id: string;
  postId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  title: string;
  platforms: SocialPlatformId[];
  status: PostStatus;
}

/**
 * وكيل الغرابي الذكي — مهمة محتوى تسويقي عربية.
 * حتمي بالكامل: لا يستدعي Gemini ولا يتطلب أي حساب اجتماعي متصل.
 */
export type MarketingGoal =
  | 'offer' // عرض سعر/تقسيط
  | 'product_intro' // تعريف بمنتج
  | 'installment_terms' // توضيح شروط التقسيط
  | 'trust_builder' // بناء الثقة والإجراءات
  | 'follow_up'; // متابعة وتذكير

export interface MarketingBriefRequest {
  /** المهمة الواضحة المطلوبة من الوكيل. */
  task: string;
  /** الهدف التسويقي. */
  goal?: MarketingGoal;
  /** معرف منتج حقيقي من قاعدة بيانات المعرض (اختياري). */
  productId?: string;
  /** اسم المنتج الحر إن لم يوجد في قاعدة البيانات. */
  productName?: string;
  /** المنصات المستهدفة (1 إلى 10 من المنصات المدعومة). */
  platforms: SocialPlatformId[];
  /** نبرة المحتوى. */
  tone?: string;
  /** نسبة الدفعة الأولى لحسبة القسط (0-99). */
  downPaymentPercent?: number;
  /** عدد الأشهر لحسبة القسط (1-60). */
  durationMonths?: number;
  /** ملاحظات إضافية من المستخدم. */
  notes?: string;
  /** حفظ الناتج كمسودة في مركز المحتوى تلقائياً. */
  saveDrafts?: boolean;
}

export interface MarketingContentPiece {
  platform: SocialPlatformId;
  platformName: string;
  headline: string;
  body: string;
  callToAction: string;
  hashtags: string[];
  charCount: number;
  limit: number;
  withinLimit: boolean;
}

export interface MarketingQuoteLine {
  cashPrice: number;
  downPayment: number;
  financedAmount: number;
  months: number;
  monthlyPayment: number;
  totalInstallments: number;
  currency: 'IQD';
  rounding: string;
}

export interface MarketingBriefResult {
  briefId: string;
  task: string;
  goal: MarketingGoal;
  tone: string;
  product: {
    id?: string;
    name: string;
    category?: string;
    source: 'showroom-database' | 'manual';
    cashPrice?: number;
    inStock?: boolean;
  };
  platforms: SocialPlatformId[];
  content: MarketingContentPiece[];
  quote?: MarketingQuoteLine;
  warnings: string[];
  savedPostIds: string[];
  generatedBy: 'deterministic-marketing-agent';
  usesGemini: false;
  requiresExternalConnection: false;
  createdAt: string;
  nextStep: string;
}
