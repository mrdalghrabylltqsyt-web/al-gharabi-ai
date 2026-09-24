/**
 * عقود موصلات منصات التواصل.
 *
 * قاعدة أساسية في هذا المشروع: لا يُدّعى أي اتصال أو نشر أو تحليل غير مدعوم
 * من الـAPI الرسمي للمنصة. لذلك كل موصل يعلن صراحة قدراته، وأي قدرة غير معلنة
 * تُعامل كغير متاحة بدل اختلاق نتيجة.
 *
 * كل موصل معزول تماماً عن الآخر، وإضافة منصة جديدة تعني إضافة ملف موصل واحد
 * وتسجيله في السجل، دون تعديل بقية النظام.
 */

export type PlatformId =
  | 'tiktok'
  | 'youtube'
  | 'facebook'
  | 'instagram'
  | 'whatsapp'
  | 'telegram'
  | 'x'
  | 'snapchat'
  | 'threads'
  | 'google_business';

export type PlatformCapability =
  | 'publish'
  | 'messages'
  | 'analytics'
  | 'comments'
  | 'comment_reply'
  // الرد على رسالة/محادثة مباشرة (message) — مفهوم منفصل تماماً عن التعليقات
  // العامة (comment_reply). Telegram مثلاً يستقبل رسائل ويستطيع الرد عليها
  // عبر sendMessage، بينما لا يوفر واجهة لقراءة/الرد على تعليقات عامة.
  | 'message_reply'
  | 'audience_insights'
  | 'scheduling';

export type ConnectionStatus = 'connected' | 'reauth_needed' | 'disconnected';

export interface PlatformAccountState {
  platform: PlatformId;
  status: ConnectionStatus;
  accountId?: string;
  accountName?: string;
  connectedAt?: string;
  /** هل تم التحقق من الحساب فعلياً لدى المزود؟ لا يُعتبر الاتصال حقيقياً بدونه. */
  providerVerified?: boolean;
}

export interface PublishRequest {
  platform: PlatformId;
  content: string;
  mediaUrl?: string;
  /** وقت التنفيذ المطلوب؛ غيابه يعني نشراً فورياً. */
  scheduledFor?: string;
}

export interface PublishResult {
  ok: boolean;
  /** لم تُنشأ أي حالة "منشور" ما لم يعد المزود بمعرّف منشور. */
  providerPostId: string | null;
  /** إيصال التنفيذ الخام من المزود، يُحفظ كدليل على النشر الحقيقي. */
  receipt: Record<string, unknown> | null;
  error?: string;
  /** هل هذا تنفيذ حقيقي أم محاكاة اختبارية مميزة بوضوح؟ */
  simulated: boolean;
}

export interface CommentItem {
  platform: PlatformId;
  /** معرّف التعليق لدى المنصة — يُستخدم لمنع الرد المكرر. */
  externalId: string;
  postExternalId?: string;
  authorName?: string;
  text: string;
  createdAt?: string;
}

export interface CommentReplyResult {
  ok: boolean;
  providerReplyId: string | null;
  simulated: boolean;
  error?: string;
}

export interface MetricAvailability {
  /** اسم المؤشر كما تسميه المنصة. */
  metric: string;
  available: boolean;
  /** سبب عدم الإتاحة عند غياب المؤشر. */
  reason?: string;
}

export interface PlatformMetrics {
  platform: PlatformId;
  postExternalId: string;
  metrics: MetricAvailability[];
  /** القيم المتاحة فعلاً فقط — لا قيم مُختلقة. */
  values: Record<string, number>;
  fetchedAt: string;
}

/**
 * واجهة الموصل. كل منصة تنفذ ما تستطيع فقط، وترمي خطأ واضحاً لما لا تدعمه.
 */
export interface PlatformAdapter {
  readonly platform: PlatformId;
  readonly displayName: string;
  readonly capabilities: readonly PlatformCapability[];
  /** هل تدعم المنصة هذا الإجراء عبر API الرسمي؟ */
  supports(capability: PlatformCapability): boolean;
  /** قدرات معلنة للواجهة بدون أي ادعاء اتصال. */
  describe(): {
    platform: PlatformId;
    displayName: string;
    capabilities: PlatformCapability[];
    connection: ConnectionStatus;
    accountId: string | null;
    accountName: string | null;
    connectedAt: string | null;
    providerVerified: boolean;
    productionReady: boolean;
    readinessNote: string;
    credentialMode?: 'bot-token' | 'oauth2' | 'app-registration';
    realConnector?: boolean;
  };
}

/** قاعدة مشتركة تمنع تكرار منطق الأهلية في كل موصل. */
export abstract class BasePlatformAdapter implements PlatformAdapter {
  abstract readonly platform: PlatformId;
  abstract readonly displayName: string;
  abstract readonly capabilities: readonly PlatformCapability[];

  /** تُحقن حالة الاتصال من طبقة الخادم حتى لا يخترع الموصل اتصالاً. */
  constructor(protected readonly connection: PlatformAccountState) {}

  supports(capability: PlatformCapability): boolean {
    return this.capabilities.includes(capability);
  }

  describe() {
    const connected = this.connection.status === 'connected' && this.connection.providerVerified === true;
    return {
      platform: this.platform,
      displayName: this.displayName,
      capabilities: [...this.capabilities] as PlatformCapability[],
      connection: this.connection.status,
      // تُعرض تفاصيل الاتصال كما هي محفوظة؛ لا يوجد اتصال مُختلق بدون OAuth فعلي.
      accountId: this.connection.accountId ?? null,
      accountName: this.connection.accountName ?? null,
      connectedAt: this.connection.connectedAt ?? null,
      providerVerified: this.connection.providerVerified === true,
      // لا يوجد نشر إنتاجي فعلي لأي منصة حتى تتوفر اعتمادات المالك الحقيقية.
      productionReady: false && connected,
      readinessNote: connected
        ? 'الحساب متصل ومتحقق منه لدى المزود. النشر الإنتاجي يحتاج موصل إرسال معتمد.'
        : 'الحساب غير متصل. لا تُنفَّذ أي عملية خارجية قبل إتمام OAuth والتحقق من المزود.',
    };
  }

  /** يحمي كل عمليات الكتابة: لا تنفيذ بدون اتصال موثق. */
  protected assertConnected(): void {
    if (this.connection.status !== 'connected' || this.connection.providerVerified !== true) {
      throw new Error(`المنصة ${this.displayName} غير متصلة باتصال موثق؛ لا يمكن تنفيذ أي عملية خارجية.`);
    }
  }
}
