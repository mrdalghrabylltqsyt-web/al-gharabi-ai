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

/**
 * (مسار A) حملة تسويقية صغيرة.
 * حتمية بالكامل: لا تستدعي Gemini، ولا تنشر خارجياً، ولا تعتبر أي منصة متصلة
 * بدون إثبات مزود فعلي. تُبنى حصراً من منتجات قاعدة بيانات المعرض الحقيقية.
 */
export type MarketingCampaignStatus = 'draft' | 'active' | 'completed' | 'archived';

export interface MarketingCampaignRequest {
  /** اسم الحملة كما سيظهر في السجل. */
  name: string;
  /** المهمة الواضحة المطبقة على كل منتج في الحملة. */
  task: string;
  goal?: MarketingGoal;
  tone?: string;
  notes?: string;
  /** منتجات حقيقية من قاعدة بيانات المعرض. */
  productIds: string[];
  platforms: SocialPlatformId[];
  /** إن مُحدد يُطبّق على كل المنتجات؛ وإلا تُستخدم قيم كل منتج الحقيقية. */
  downPaymentPercent?: number;
  durationMonths?: number;
  /** افتراضياً true — إنشاء مسودات مرتبطة بمسار المراجعة والاعتماد. */
  createDrafts?: boolean;
}

/** الموارد المتاحة فعلياً لكل منصة — لا تُختلق أي حالة اتصال. */
export interface MarketingPlatformResource {
  platform: SocialPlatformId;
  name: string;
  capabilities: string[];
  textLimit: number;
  connectionStatus: 'connected' | 'reauth_needed' | 'disconnected';
  connected: boolean;
  providerVerified: boolean;
  configurationReady: boolean;
  missing: string[];
  next: string;
}

export interface MarketingCampaignProduct {
  id: string;
  name: string;
  category?: string;
  cashPrice?: number | null;
  inStock?: boolean;
}

/** مهمة داخل الحملة — حالتها مستمدة مباشرة من مسودة مسار المراجعة. */
export interface MarketingCampaignTask {
  id: string;
  title: string;
  productId: string;
  productName: string;
  platform: SocialPlatformId;
  platformName: string;
  draftPostId: string;
  status: string;
  statusLabel: string;
  createdAt: string;
  charCount: number;
  contentPreview: string;
  content: string;
  decision: MarketingDraftDecision | null;
  decisionLabel: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  /** الإجراءات المسموحة فعلياً من الحالة الحالية حسب قواعد الخادم. */
  allowedActions: string[];
}

/** قرار مسار المراجعة المسجّل على مسودة داخل حملة. */
export type MarketingDraftDecision = 'review' | 'approve' | 'reject';

/** الإجراءات الجماعية والفردية المتاحة على مسودات الحملة. */
export type MarketingDraftAction = 'review' | 'approve' | 'reject';

export interface MarketingDraftActionSpec {
  action: MarketingDraftAction;
  label: string;
  from: string[];
  to: string;
  ownerOnly: boolean;
}

export interface MarketingCampaignLastActivity {
  action: string;
  byUser: string;
  userRole: string;
  timestamp: string;
  note: string;
}

export interface MarketingCampaignHistoryEntry {
  action: string;
  actionLabel?: string;
  byUser: string;
  userRole: string;
  timestamp: string;
  note?: string;
}

export interface MarketingCampaignSummary {
  id: string;
  name: string;
  goal: MarketingGoal;
  goalLabel: string;
  status: MarketingCampaignStatus;
  statusLabel: string;
  platforms: SocialPlatformId[];
  productIds: string[];
  productNames: string[];
  productsCount: number;
  draftsCount: number;
  draftsByDecision: Record<'pending' | MarketingDraftDecision, number>;
  tasksByStatus: Record<string, number>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastActivity: MarketingCampaignLastActivity | null;
}

export interface MarketingCampaignDetail extends MarketingCampaignSummary {
  task: string;
  tone: string;
  notes: string;
  products: MarketingCampaignProduct[];
  warnings: string[];
  platformResources: MarketingPlatformResource[];
  tasks: MarketingCampaignTask[];
  /** نفس مهام الحملة، مسمّاة صراحةً كمسودات في واجهة إدارة الحملة. */
  drafts: MarketingCampaignTask[];
  canDecideDrafts: boolean;
  linkedPostsCount: number;
  history: MarketingCampaignHistoryEntry[];
}

/** نتيجة عملية جماعية على مجموعة مسودات محددة. */
export interface MarketingDraftBulkResult {
  success: boolean;
  action: MarketingDraftAction;
  actionLabel: string;
  requested: number;
  duplicatesRemoved: number;
  appliedCount: number;
  skippedCount: number;
  appliedTaskIds: string[];
  skipped: Array<{ taskId: string; reason?: string }>;
  campaign: MarketingCampaignSummary & { tasks: MarketingCampaignTask[] };
  note: string;
}

/** رابط المسودة بالمنشور داخل مساحة المنشورات. */
export interface MarketingDraftPostLink {
  campaignId: string;
  campaignName: string;
  draftId: string;
  productId?: string | null;
  productName?: string | null;
  platform: SocialPlatformId;
  linkedAt: string;
  linkedBy?: string;
}

export interface MarketingDraftLinkResult {
  success: boolean;
  created: boolean;
  alreadyLinked: boolean;
  link: MarketingDraftPostLink;
  post: {
    id: string;
    title: string;
    status: PostStatus | string;
    statusLabel: string;
    targetPlatforms: SocialPlatformId[];
    scheduledFor: string | null;
    publishedAt: string | null;
    metricsSource: string | null;
  };
  externalPublishClaimed: false;
  note: string;
}

/** تفاصيل إضافية تُعاد فقط عند إنشاء الحملة. */
export interface MarketingCampaignCreationResult extends MarketingCampaignSummary {
  tasks: MarketingCampaignTask[];
  platformResources: MarketingPlatformResource[];
  warnings: string[];
}

/** قواعد الانتقال المنطقي بين حالات المسودة، كما يعرضها الخادم. */
export const MARKETING_DRAFT_ACTIONS: MarketingDraftActionSpec[] = [
  { action: 'review', label: 'إرسال للمراجعة', from: ['draft', 'edited'], to: 'review', ownerOnly: false },
  { action: 'approve', label: 'اعتماد', from: ['review', 'edited'], to: 'approved', ownerOnly: true },
  { action: 'reject', label: 'رفض وإعادة للتعديل', from: ['review', 'edited', 'approved'], to: 'edited', ownerOnly: true },
];

export const MARKETING_DRAFT_STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  review: 'قيد المراجعة',
  edited: 'تم التعديل',
  approved: 'تمت الموافقة',
  scheduled: 'مجدول',
  published: 'منشور',
  deleted: 'محذوفة',
};

// ---------------------------------------------------------------
// مدير السوشيال ميديا — أنواع مطابقة لاستجابات الخادم الفعلية.
// كل حقل هنا يعكس حالة حقيقية؛ لا توجد قيم تجريبية في هذه الأنواع.
// ---------------------------------------------------------------

export interface SocialPlatformState {
  platform: string;
  displayName: string;
  /** connected تعني اتصالاً موثقاً من المزود، وليس مجرد إعداد محلي. */
  connection: 'connected' | 'reauth_needed' | 'disconnected';
  accountId: string | null;
  accountName: string | null;
  connectedAt: string | null;
  providerVerified: boolean;
  capabilities: string[];
  /** لا تكون true إلا بوجود موصل نشر إنتاجي معتمد. */
  productionReady: boolean;
  readinessNote: string;
  /** آلية الاعتماد الرسمية المطلوبة (bot-token | oauth2 | app-registration). */
  credentialMode?: string;
  /** هل يوجد موصل إرسال/استقبال حقيقي منفّذ لهذه المنصة؟ */
  realConnector?: boolean;
}

export interface SocialManagerStatus {
  success: boolean;
  generatedAt: string;
  platforms: SocialPlatformState[];
  summary: {
    totalPlatforms: number;
    connected: number;
    disconnected: number;
    reauthNeeded: number;
    publishCapable: number;
    commentCapable: number;
  };
  content: {
    total: number;
    drafts: number;
    review: number;
    approved: number;
    scheduled: number;
    published: number;
  };
  activity: {
    commentsTracked: number;
    repliesRecorded: number;
    publishRecords: number;
  };
  note: string;
}

/** توفر مؤشر واحد: غير المتاح يحمل سبباً صريحاً. */
export interface SocialMetricAvailability {
  metric: string;
  available: boolean;
  reason?: string;
  /** القيمة الفعلية عند توفرها؛ تبقى null عند غياب أي سجل. */
  value?: number | null;
}

export interface SocialCapabilitiesResult {
  success: boolean;
  platforms: (SocialPlatformState & { metrics: SocialMetricAvailability[] })[];
  note: string;
}

export interface SocialCommentClassification {
  intent: string;
  sentiment: string;
  isQuestion: boolean;
  isComplaint: boolean;
  isPraise: boolean;
  isBusinessInquiry: boolean;
  isSpam: boolean;
  requiresHumanReview: boolean;
  reviewReason?: string;
  signals: string[];
}

export interface SocialCommentClassificationResult {
  success: boolean;
  platform: string | null;
  classification: SocialCommentClassification;
  autoReplyAllowed: boolean;
  suggestedDeterministicReply: string | null;
  /** نتيجة حارس سلامة المحتوى على الرد المقترح؛ null إن لم يوجد رد مقترح. */
  contentSafety: { safe: boolean; violations: string[]; codes: string[] } | null;
  note: string;
}

export interface SocialCommentRecord {
  id: string;
  platform: string;
  externalId: string;
  postExternalId: string | null;
  authorName: string | null;
  text: string;
  createdAt: string;
  classification: SocialCommentClassification;
  requiresHumanReview: boolean;
  /**
   * هدف الرد الحقيقي للمنصات الرسائلية: دردشة/رسالة (Telegram) أو مستلم (Facebook).
   */
  replyTarget?: { chatId?: string; messageId?: string; recipientId?: string; commentId?: string; pageId?: string } | null;
  /** مصدر السجل الوارد: webhook حقيقي أم تسجيل يدوي. */
  ingestSource?: string | null;
  /** نوع الحدث الوارد: تعليق (comment) أم رسالة (message) — يفصل مساري الرد. */
  kind?: 'comment' | 'message' | string | null;
}

export interface SocialCommentsResult {
  success: boolean;
  platform: string | null;
  /** true فقط عند وجود اتصال موثق ودعم جلب التعليقات. */
  externalFetchAvailable: boolean;
  comments: SocialCommentRecord[];
  count: number;
  note: string;
}

/**
 * سجل الرد على تعليق/رسالة.
 * - التعليقات العامة (comment_reply): لا يوجد موصل إرسال إنتاجي معتمد، فيبقى
 *   التسجيل داخلياً: simulated:true و delivered:false دائماً.
 * - رسائل Telegram (message_reply): إرسال حقيقي عبر sendMessage، فتُسجَّل
 *   delivered:true فقط باستجابة مزود حقيقية مع providerReplyId.
 */
export interface SocialReplyRecord {
  id: string;
  platform: string;
  externalId: string;
  text: string;
  replyFingerprint: string;
  classification: SocialCommentClassification;
  repliedAt: string;
  createdBy: string;
  simulated: boolean;
  delivered: boolean;
  note: string;
  /** معرّف الرسالة من المزود عند التسليم الحقيقي (Telegram). */
  providerReplyId?: string | null;
  /** إيصال التنفيذ الخام من المزود. */
  receipt?: Record<string, unknown> | null;
  /** مرجع الحالة: delivered / failed / recorded / pending_review. */
  reviewStatus?: string;
  deliveryError?: string | null;
}

/** حالة قرار الرد: معلّق للمراجعة أو معتمد/مرفوض داخلياً. */
export type SocialApprovalStatus = 'pending' | 'approved' | 'rejected';

/**
 * قرار مراجعة بشرية داخلي. الاعتماد لا يعني أي نشر خارجي — هو تسجيل قرار
 * داخلي فقط (الرد أصلاً غير مُسلَّم إلى أي منصة).
 */
export interface SocialApprovalRecord {
  id: string;
  platform: string;
  externalId: string;
  status: SocialApprovalStatus;
  commentText: string;
  replyText: string | null;
  replyId: string | null;
  classification: SocialCommentClassification | null;
  contentSafety: { safe: boolean; violations: string[]; codes: string[] } | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  simulated: boolean;
  delivered: boolean;
  note: string;
}

export interface SocialApprovalsResult {
  success: boolean;
  approvals: SocialApprovalRecord[];
  count: number;
  note: string;
}

export interface SocialRepliesResult {
  success: boolean;
  replies: SocialReplyRecord[];
  count: number;
  note: string;
}

export interface SocialAnalyticsResult {
  success: boolean;
  platform: string;
  displayName: string;
  connection: string;
  metrics: SocialMetricAvailability[];
  engagementRate: number | null;
  sampleSize: number;
  externalFetchAvailable: boolean;
  note: string;
}

export interface MarketingDecisionPlanItem {
  platform: string;
  contentType: string;
  format: string;
  suggestedTiming: string;
  /** estimated حتى تتوفر بيانات أداء فعلية تدعم التوقيت. */
  timingConfidence: 'estimated' | 'measured';
  reason: string;
  successMetric: string;
  /** هل المؤشر المختار متاح فعلاً عبر واجهة المنصة الرسمية؟ */
  metricAvailable: boolean;
}

export interface MarketingDecision {
  audience: { segments: string[]; dataAvailable: boolean; note: string };
  objective: string;
  plan: MarketingDecisionPlanItem[];
  /** ما تعلمناه فعلياً من السجلات السابقة. */
  learnings: string[];
  /** ما الذي يجب تغييره في المنشور القادم. */
  nextAdjustment: string;
  /** بيانات ناقصة تمنع توصية أدق — تُعلن صراحة. */
  dataGaps: string[];
}

export interface SocialMemorySnapshot {
  publishedCount: number;
  scheduledCount: number;
  platformBreakdown: Record<string, number>;
  contentTypeBreakdown: Record<string, number>;
  topComments: string[];
  frequentQuestions: string[];
  decisions: { decision: string; at: string; reason: string }[];
  strategiesTested: { strategy: string; outcome: string; at: string }[];
}

export interface MarketingDecisionResult {
  success: boolean;
  generatedAt: string;
  objective: string;
  connectedPlatforms: string[];
  decision: MarketingDecision;
  memory: SocialMemorySnapshot;
  note: string;
}

export interface SocialMemoryResult {
  success: boolean;
  memory: SocialMemorySnapshot;
  note: string;
}
