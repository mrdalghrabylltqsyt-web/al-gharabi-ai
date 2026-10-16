/**
 * العقل التجاري (Digital Salesperson) — منطق خالص قابل للاختبار.
 *
 * قرار مالك صريح (2026-10-13) أعاد فتح نطاق كان مغلقاً: توسيع المشروع بعقل تجاري
 * فعلي هدفه زيادة مبيعات معرض الغرابي للتقسيط، مع تجاوز صريح لقاعدة «لا يُعاد إدخال
 * عقل تجاري دون قرار مالك». هذا هو القرار — والكود هنا جديد ومنفصل تماماً عن أي وحدة
 * تجارية محذوفة سابقاً (sales/growth/commercial/digital). لا يستورد شيئاً منها.
 *
 * مبادئ ملزمة (نفس قواعد المشروع):
 *  - **لا اختراع**: كل رقم (سعر/قسط/خصم) يُشتقّ من بيانات المعرض المسجّلة فعلاً، أو
 *    يُصعَّد صراحةً. غياب السعر = تصعيد لا تخمين.
 *  - **قُمع واحد**: يعيد استخدام مراحل `commercialRelevance` (VIEW→…→SALE) ولا
 *    ينشئ قُمعاً ثانياً. القرار هنا يربط التفاعل الحقيقي بحالة العميل المحتمل.
 *  - **لا تفاوض خارج الحدّ**: أي خصم يتجاوز النسبة القصوى المسموحة للمنتج/الفئة
 *    يُصعَّد للمالك فوراً بلا قرار منفرد.
 *  - **لا إغلاق صفقة بلا تأكيد بشري**: العقل يقترح فقط (منتج + سعر + قسط)، ولا
 *    يُعلن «تم البيع» إلا بتأكيد المالك/موظف مخوَّل.
 *  - **لا رسالة باردة**: المتابعة فقط لمن بدأ هو التواصل (تعليق/رسالة واردة حقيقية).
 *
 * منطق صافٍ: بلا شبكة وبلا أسرار وبلا ساعة حقيقية (الزمن يُمرَّر).
 */

import type { ClassifiedComment } from '../social/comments';

// ─────────────────────────────────────────────────────────────────────────────
// الحدود الافتراضية للتفاوض (قابلة للتجاوز من البيئة عبر server.ts).
// ─────────────────────────────────────────────────────────────────────────────

/** أقصى نسبة خصم افتراضية مسموحة (%) — ما فوقها يُصعَّد للمالك. */
export const COMMERCIAL_MAX_DISCOUNT_PERCENT_DEFAULT = 5;
/**
 * سقف مطلق احتياطي (د.ع) يمنع خصماً ضخماً على منتج مكلف رغم أن نسبته تبدو صغيرة.
 * القيمة الافتراضية سخيّة (200,000) كي تبقى **النسبة** هي الضابط الأساسي للمنتجات
 * المعتادة، ويعمل السقف المطلق كشبكة أمان فقط.
 */
export const COMMERCIAL_MAX_DISCOUNT_ABS_DEFAULT = 200000;
/** نوافذ المتابعة الافتراضية (ساعات) — بلا رسالة باردة، فقط لمَن بدأ التواصل. */
export const COMMERCIAL_FOLLOWUP_HOURS: readonly number[] = Object.freeze([24, 72]);
/** حدّ أقصى لعدد المتابعات قبل التوقف عن الإلحاح (لا إزعاج). */
export const COMMERCIAL_MAX_FOLLOWUPS = 2;

/**
 * PR-S1 — حارس مؤقت: نافذة مراسلة Meta الرسمية (24 ساعة من آخر رسالة للعميل).
 * خارج هذه النافذة، إرسال رسالة عبر Messenger/DM يخالف سياسة Meta ويعرّض الصفحة
 * للتقييد. هذا حارس مؤقت (يُوسَّع لاحقاً في PR منفصل لمعالجة كل حالات النافذة).
 */
export const COMMERCIAL_META_MESSAGE_WINDOW_HOURS = 24;

/** هل آخر تفاعل للعميل داخل نافذة مراسلة Meta (24 ساعة) الآن؟ */
export function isWithinMetaMessageWindow(lastCustomerInteractionAt: string | null | undefined, nowIso: string): boolean {
  const last = Date.parse(String(lastCustomerInteractionAt || ''));
  const now = Date.parse(nowIso);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return false;
  return now - last < COMMERCIAL_META_MESSAGE_WINDOW_HOURS * 3600_000;
}
/** عتبة «العميل جاهز للتعاقد»: تفاعل كافٍ + إشارة شراء صريحة. */
export const COMMERCIAL_MIN_TOUCHES_FOR_READY = 2;

/** مراحل حياة العميل المحتمل (Lead) — مشتقة من القُمع التجاري القائم. */
export type CommercialLeadStage =
  | 'NEW'
  | 'ENGAGED'
  | 'QUALIFIED'
  | 'NEGOTIATING'
  | 'PROPOSAL_PENDING'
  | 'WON'
  | 'LOST'
  | 'ESCALATED';

export const COMMERCIAL_LEAD_STAGES: readonly CommercialLeadStage[] = Object.freeze([
  'NEW', 'ENGAGED', 'QUALIFIED', 'NEGOTIATING', 'PROPOSAL_PENDING', 'WON', 'LOST', 'ESCALATED',
]);

export const COMMERCIAL_LEAD_STAGE_LABELS_AR: Readonly<Record<CommercialLeadStage, string>> = Object.freeze({
  NEW: 'جديد',
  ENGAGED: 'متفاعل',
  QUALIFIED: 'مؤهّل',
  NEGOTIATING: 'قيد التفاوض',
  PROPOSAL_PENDING: 'صفقة مقترحة بانتظار التأكيد',
  WON: 'صفقة مؤكَّدة',
  LOST: 'مفقود',
  ESCALATED: 'مُصعَّد للمالك',
});

/** حالة المتابعة المجدولة. */
export type CommercialFollowUpState = 'SCHEDULED' | 'DUE' | 'SENT' | 'SKIPPED' | 'STOPPED';

export const COMMERCIAL_FOLLOWUP_LABELS_AR: Readonly<Record<CommercialFollowUpState, string>> = Object.freeze({
  SCHEDULED: 'مجدولة',
  DUE: 'مستحقة الآن',
  SENT: 'أُرسلت',
  SKIPPED: 'مُتخطّاة',
  STOPPED: 'متوقّفة',
});

/** عميل محتمل حقيقي — يُبنى من تفاعل وارد حقيقي فقط (لا صفوف مختلقة). */
export interface CommercialLead {
  id: string;
  /** المفتاح الحقيقي للتجميع: منصة + هوية المرسل/الخيط. */
  key: string;
  platform: string;
  /** معرّف الخيط/المحادثة للرد على نفس السياق (لا رسالة باردة). */
  conversationId: string;
  /** نوع الحدث الأصلي: تعليق أو رسالة (يحدد مسار الرد الصحيح). */
  kind: 'comment' | 'message';
  /** هدف الرد الحقيقي على نفس الخيط (معرّف التعليق/المستلم/الفيديو). */
  replyTarget: { commentId?: string; recipientId?: string; videoId?: string };
  /** آخر معرّف حدث خارجي حقيقي (لإرسال المتابعة على نفس الخيط). */
  lastExternalId: string | null;
  /** هل بدأ العميل التواصل بنفسه؟ لا متابعة إن لم يبدأ. */
  initiatedByCustomer: boolean;
  /** معرّفات الأحداث الواردة الحقيقية التي كوّنت هذا الـLead (لمنع التكرار). */
  sourceEventIds: string[];
  customerName: string | null;
  /** المنتج المهتم به إن رُبط بدليل حقيقي، وإلا null. */
  interestedProductId: string | null;
  interestedProductName: string | null;
  stage: CommercialLeadStage;
  /** عدد التفاعلات الحقيقية (تعليق/رسالة) — لا يُقدَّر. */
  touches: number;
  lastCustomerText: string | null;
  lastInteractionAt: string;
  createdAt: string;
  updatedAt: string;
  /** آخر وقت تفاعل من العميل فقط (لحساب نافذة المتابعة). */
  lastCustomerInteractionAt: string | null;
  /** آخر وقت رد من المعرض (يمنع متابعة بعد رد حديث). */
  lastBusinessReplyAt: string | null;
  followUpState: CommercialFollowUpState;
  followUpsSent: number;
  nextFollowUpAt: string | null;
  /** اقتراح الصفقة المعلّق بانتظار تأكيد بشري (بلا إغلاق تلقائي). */
  pendingProposal: CommercialProposal | null;
  /** سبب التصعيد إن وُجد (بلا سرّ). */
  escalationReason: string | null;
  notes: string[];
}

/** اقتراح صفقة نهائي — يُعرض على المالك للتأكيد، ولا يُغلق تلقائياً. */
export interface CommercialProposal {
  id: string;
  productId: string;
  productName: string;
  /** سعر الكاش المسجّل (المصدر الوحيد). */
  cashPrice: number;
  /** نسبة الخصم المقترحة (%) ضمن الحدّ المسموح. */
  discountPercent: number;
  /** مبلغ الخصم المطلق (د.ع) المقترح. */
  discountAmount: number;
  /** السعر النهائي بعد الخصم (د.ع). */
  finalPrice: number;
  /** مدة التقسيط (شهر) المقترحة. */
  installmentMonths: number;
  /** القسط الشهري المشتقّ (د.ع) — تقريب لأعلى دينار (سياسة المشروع). */
  monthlyInstallment: number;
  createdAt: string;
  /** حالة التأكيد البشري: لا «تم البيع» بلا `confirmed`. */
  status: 'pending' | 'confirmed' | 'rejected';
  confirmedBy: string | null;
  confirmedAt: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// الحدود الفعلية للتفاوض.
// ─────────────────────────────────────────────────────────────────────────────

export interface CommercialNegotiationLimits {
  maxDiscountPercent: number;
  maxDiscountAmount: number;
  /** حدود خاصة لكل فئة منتج (نسبة قصوى) — تتقدّم على العام. */
  perCategoryPercent?: Record<string, number>;
}

export function defaultNegotiationLimits(): CommercialNegotiationLimits {
  return {
    maxDiscountPercent: COMMERCIAL_MAX_DISCOUNT_PERCENT_DEFAULT,
    maxDiscountAmount: COMMERCIAL_MAX_DISCOUNT_ABS_DEFAULT,
    perCategoryPercent: {},
  };
}

/** يطبّع الأرقام العربية-الهندية (٠-٩) إلى لاتينية قبل أي استخراج رقمي. */
function normalizeDigits(input: string): string {
  return String(input || '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** يطبّع الحدود من مدخل خارجي (بيئة/واجهة) بلا قيم سالبة ولا NaN. */
export function normalizeNegotiationLimits(raw: any): CommercialNegotiationLimits {
  const d = defaultNegotiationLimits();
  const pct = Number(raw?.maxDiscountPercent);
  const abs = Number(raw?.maxDiscountAmount);
  const perCategory: Record<string, number> = {};
  if (raw?.perCategoryPercent && typeof raw.perCategoryPercent === 'object') {
    for (const [k, v] of Object.entries(raw.perCategoryPercent)) {
      const n = Number(v);
      if (typeof k === 'string' && Number.isFinite(n) && n >= 0 && n <= 100) perCategory[k] = n;
    }
  }
  return {
    maxDiscountPercent: Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : d.maxDiscountPercent,
    maxDiscountAmount: Number.isFinite(abs) && abs >= 0 ? abs : d.maxDiscountAmount,
    perCategoryPercent: perCategory,
  };
}

/** النسبة القصوى الفعلية لمنتج (فئة خاصة إن وُجدت، وإلا العام). */
export function maxDiscountPercentFor(limits: CommercialNegotiationLimits, category: string | null | undefined): number {
  const l = normalizeNegotiationLimits(limits);
  const key = String(category || '').trim();
  if (key && typeof l.perCategoryPercent?.[key] === 'number') return l.perCategoryPercent[key];
  return l.maxDiscountPercent;
}

export type NegotiationOutcome = 'accept' | 'counter' | 'escalate';

export interface NegotiationDecision {
  outcome: NegotiationOutcome;
  /** الخصم المقترح فعلاً (ضمن الحدّ) عند القبول أو العرض المضاد. */
  discountPercent: number;
  discountAmount: number;
  finalPrice: number;
  monthlyInstallment: number;
  /** هل الطلب يخرج عن الحدّ المسموح؟ (يوجب التصعيد للمالك). */
  exceedsLimit: boolean;
  reason: string;
}

/** يحسب القسط الشهري بالسياسة الموثّقة: تقريب لأعلى دينار (ceil-to-IQD). */
export function monthlyInstallmentFor(price: number, months: number): number {
  const p = Math.max(0, Number(price) || 0);
  const m = Math.max(1, Math.min(60, Math.floor(Number(months) || 1)));
  return Math.ceil(p / m);
}

/**
 * يحسم طلب التفاوض ضمن حدود آمنة:
 *  - الطلب داخل الحدّ ⇒ قبول بالخصم المطلوب.
 *  - الطلب فوق الحدّ ⇒ **عرض مضاد** بالحدّ الأقصى المسموح (لا يتجاوزه أبداً).
 *  - الطلب فوق الحدّ بكثير (ضِعف الحدّ أو أكثر) ⇒ تصعيد فوري للمالك بلا قرار منفرد.
 * لا يخترع سعراً: السعر النهائي مشتقّ من سعر الكاش المسجّل حصراً.
 */
export function evaluateNegotiation(input: {
  cashPrice: number;
  requestedDiscountPercent: number;
  requestedDiscountAmount?: number;
  installmentMonths: number;
  category?: string | null;
  limits: CommercialNegotiationLimits;
}): NegotiationDecision {
  const cash = Number(input.cashPrice);
  if (!Number.isFinite(cash) || cash <= 0) {
    return {
      outcome: 'escalate', discountPercent: 0, discountAmount: 0, finalPrice: 0, monthlyInstallment: 0,
      exceedsLimit: true, reason: 'لا سعر كاش مسجّل للمنتج — يُصعَّد للمالك بلا تخمين.',
    };
  }
  const limits = normalizeNegotiationLimits(input.limits);
  const maxPct = maxDiscountPercentFor(limits, input.category);
  const reqPct = Math.max(0, Number(input.requestedDiscountPercent) || 0);
  const reqAbs = Number.isFinite(Number(input.requestedDiscountAmount)) ? Math.max(0, Number(input.requestedDiscountAmount)) : null;

  // الخصم المطلق المطلوب (من النسبة أو الصريح).
  const reqAmount = reqAbs !== null ? reqAbs : Math.round((cash * reqPct) / 100);
  const maxAmount = Math.min(Math.round((cash * maxPct) / 100), limits.maxDiscountAmount);

  // الطلب مبالغ فيه جداً (≥ ضِعف الحدّ المطلق) ⇒ تصعيد فوري بلا عرض مضاد.
  if (reqAmount > maxAmount * 2 && maxAmount > 0) {
    return {
      outcome: 'escalate', discountPercent: reqPct, discountAmount: reqAmount,
      finalPrice: Math.max(0, cash - reqAmount), monthlyInstallment: monthlyInstallmentFor(Math.max(0, cash - reqAmount), input.installmentMonths),
      exceedsLimit: true,
      reason: `طلب خصم ${reqAmount} د.ع يتجاوز الحدّ المسموح (${maxAmount} د.ع) بأكثر من الضِعف — يُصعَّد للمالك فوراً.`,
    };
  }

  if (reqAmount <= maxAmount) {
    const finalPrice = Math.max(0, cash - reqAmount);
    return {
      outcome: 'accept', discountPercent: reqPct, discountAmount: reqAmount,
      finalPrice, monthlyInstallment: monthlyInstallmentFor(finalPrice, input.installmentMonths),
      exceedsLimit: false,
      reason: `الخصم المطلوب ${reqAmount} د.ع ضمن الحدّ المسموح (${maxAmount} د.ع).`,
    };
  }

  // فوق الحدّ لكن ليس ضِعفاً ⇒ عرض مضاد بالحدّ الأقصى (لا يتجاوزه).
  const finalPrice = Math.max(0, cash - maxAmount);
  return {
    outcome: 'counter', discountPercent: maxPct, discountAmount: maxAmount,
    finalPrice, monthlyInstallment: monthlyInstallmentFor(finalPrice, input.installmentMonths),
    exceedsLimit: true,
    reason: `الخصم المطلوب ${reqAmount} د.ع يتجاوز الحدّ المسموح؛ يُقدَّم عرض مضاد بحدّ ${maxAmount} د.ع (${maxPct}%).`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// بناء/تحديث العميل المحتمل من تفاعل حقيقي.
// ─────────────────────────────────────────────────────────────────────────────

/** هل نص العميل يطلب تفاوضاً/خصماً صريحاً؟ (تصنيف حتمي بلا AI). */
const NEGOTIATION_RE = /خصم|تخفيض|نزّل|نزل|ارخص|أرخص|ارخصلي|خصملي|آخر سعر|اخر سعر|احسبلي|حسومي|نص السعر|سعر خاص|بلاش ربح|اتنازل|تنازل/;
export function requestsNegotiation(text: string): boolean {
  return NEGOTIATION_RE.test(String(text || ''));
}

/**
 * يستخرج نسبة الخصم المطلوبة من نص العميل («خصم ١٠٪» / «نزّل 10%» / «خصم بالمية»).
 * يعيد `null` عند غياب نسبة صريحة (فيُعامَل الطلب كطلب تفاوض بلا رقم — عرض مضاد
 * بالحدّ الأقصى، لا تصعيد أعمى). لا يخترع رقماً من فراغ.
 */
export function parseRequestedDiscountPercent(text: string): number | null {
  const raw = normalizeDigits(String(text || ''));
  const m = raw.match(/(?:خصم|تخفيض|نزّل|نزل|ارخص|أرخص|حسومي|احسبلي)\D{0,4}(\d{1,3})\s*(?:%|بالمئه|بالمئة|بالميه)?/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** هل النص يحمل إشارة شراء صريحة (نية تعاقد/شراء)؟ */
const BUYING_RE = /اشتري|أشتري|اريد اشتري|أريد أشتري|نشتري|احجز|أحجز|اريد احجز|تعاقد|أتعاقد|اتعاقد|جهزلي|جهز لي|اعمل عقد|موافق|اكيد|أكيد|وين ادفع|كيف ادفع|مستعد/;
export function hasBuyingSignal(cls: Pick<ClassifiedComment, 'isBusinessInquiry'> | null | undefined, text: string): boolean {
  if (BUYING_RE.test(String(text || ''))) return true;
  return Boolean(cls?.isBusinessInquiry);
}

export interface InboundInteraction {
  /** معرّف الحدث الخارجي الحقيقي (يمنع التكرار ويصمد بعد restart). */
  externalId: string;
  platform: string;
  conversationId: string;
  customerName: string | null;
  text: string;
  at: string;
  /** من بدأ؟ الرسائل/التعليقات الواردة = العميل. */
  fromCustomer: boolean;
  /** نوع الحدث وهدف الرد على نفس الخيط (يُمرَّران من سجل الاستقبال الحقيقي). */
  kind?: 'comment' | 'message';
  replyTarget?: { commentId?: string; recipientId?: string; videoId?: string };
  classification?: Pick<ClassifiedComment, 'isBusinessInquiry' | 'intent' | 'topic' | 'isSpam'> | null;
  /** المنتج المرتبط بدليل حقيقي (من resolveProductForPost) أو null. */
  product?: { id: string; name: string; cashPrice?: number; category?: string } | null;
}

/** يبني مفتاح العميل الحقيقي: منصة + هوية المرسل/الخيط (بلا اختراع هوية). */
export function commercialLeadKey(platform: string, conversationId: string): string {
  return `${String(platform || '').trim().toLowerCase()}::${String(conversationId || '').trim()}`;
}

function newLeadId(key: string): string {
  // معرّف حتمي مشتقّ من المفتاح (بلا عشوائية في المنطق الصافي).
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `lead_${h.toString(16)}`;
}

/** ينشئ عميلاً محتملاً جديداً من أول تفاعل حقيقي. */
export function createCommercialLead(input: InboundInteraction): CommercialLead {
  const key = commercialLeadKey(input.platform, input.conversationId);
  const buying = hasBuyingSignal(input.classification, input.text);
  const negotiation = requestsNegotiation(input.text);
  const stage: CommercialLeadStage = negotiation ? 'NEGOTIATING' : (buying ? 'QUALIFIED' : 'ENGAGED');
  return {
    id: newLeadId(key),
    key,
    platform: String(input.platform || '').trim().toLowerCase(),
    conversationId: String(input.conversationId || ''),
    kind: input.kind === 'message' ? 'message' : 'comment',
    replyTarget: input.replyTarget || {},
    lastExternalId: String(input.externalId),
    initiatedByCustomer: input.fromCustomer === true,
    sourceEventIds: [String(input.externalId)],
    customerName: input.customerName || null,
    interestedProductId: input.product?.id || null,
    interestedProductName: input.product?.name || null,
    stage,
    touches: 1,
    lastCustomerText: input.text,
    lastInteractionAt: input.at,
    createdAt: input.at,
    updatedAt: input.at,
    lastCustomerInteractionAt: input.fromCustomer ? input.at : null,
    lastBusinessReplyAt: input.fromCustomer ? null : input.at,
    followUpState: 'SCHEDULED',
    followUpsSent: 0,
    nextFollowUpAt: null,
    pendingProposal: null,
    escalationReason: null,
    notes: [],
  };
}

/**
 * يدمج تفاعلاً وارداً في عميل محتمل قائم: يحدّث المرحلة/المنتج/الأوقات بلا
 * فقدان أي حدث (sourceEventIds تتراكم). لا يُرقّي إلى WON إلا بتأكيد بشري.
 */
export function mergeCommercialInteraction(lead: CommercialLead, input: InboundInteraction): CommercialLead {
  const eid = String(input.externalId);
  if (lead.sourceEventIds.includes(eid)) return lead; // idempotent — لا تكرار.
  const buying = hasBuyingSignal(input.classification, input.text);
  const negotiation = requestsNegotiation(input.text);
  const nextStage: CommercialLeadStage = (() => {
    if (lead.stage === 'WON' || lead.stage === 'LOST') return lead.stage;
    if (negotiation) return 'NEGOTIATING';
    if (buying) return 'QUALIFIED';
    if (lead.stage === 'NEW') return 'ENGAGED';
    return lead.stage;
  })();
  return {
    ...lead,
    sourceEventIds: [...lead.sourceEventIds, eid],
    customerName: input.customerName || lead.customerName,
    interestedProductId: input.product?.id || lead.interestedProductId,
    interestedProductName: input.product?.name || lead.interestedProductName,
    stage: nextStage,
    touches: lead.touches + 1,
    kind: lead.kind || (input.kind === 'message' ? 'message' : 'comment'),
    replyTarget: input.replyTarget || lead.replyTarget,
    lastExternalId: eid,
    lastCustomerText: input.fromCustomer ? input.text : lead.lastCustomerText,
    lastInteractionAt: input.at,
    updatedAt: input.at,
    lastCustomerInteractionAt: input.fromCustomer ? input.at : lead.lastCustomerInteractionAt,
    lastBusinessReplyAt: input.fromCustomer ? lead.lastBusinessReplyAt : input.at,
    // أي تفاعل جديد من العميل يعيد فتح نافذة المتابعة.
    followUpState: input.fromCustomer ? 'SCHEDULED' : lead.followUpState,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// جدولة المتابعة (لا رسالة باردة).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يحدّد وقت المتابعة القادم: آخر تفاعل من العميل + نافذة المتابعة التالية، **فقط**
 * إذا بدأ العميل التواصل، ولم يرد المعرض بعده، ولم يُستنفد حدّ المتابعات.
 * غياب شرط ⇒ `null` (لا متابعة).
 */
export function nextFollowUpAt(lead: CommercialLead): string | null {
  if (!lead.initiatedByCustomer) return null; // لا رسالة باردة أبداً.
  if (lead.stage === 'WON' || lead.stage === 'LOST' || lead.stage === 'ESCALATED') return null;
  if (lead.followUpsSent >= COMMERCIAL_MAX_FOLLOWUPS) return null; // لا إلحاح.
  if (!lead.lastCustomerInteractionAt) return null;
  // إن ردّ المعرض بعد آخر رسالة للعميل، لا متابعة (لا تكرار بعد رد حديث).
  if (lead.lastBusinessReplyAt && Date.parse(lead.lastBusinessReplyAt) >= Date.parse(lead.lastCustomerInteractionAt)) return null;
  const base = Date.parse(lead.lastCustomerInteractionAt);
  if (!Number.isFinite(base)) return null;
  const hours = COMMERCIAL_FOLLOWUP_HOURS[Math.min(lead.followUpsSent, COMMERCIAL_FOLLOWUP_HOURS.length - 1)];
  return new Date(base + hours * 3600_000).toISOString();
}

export interface FollowUpDueResult {
  due: boolean;
  state: CommercialFollowUpState;
  reason: string;
}

/** هل حان وقت المتابعة الآن؟ (قرار حتمي بلا ساعة حقيقية). */
export function isFollowUpDue(lead: CommercialLead, nowIso: string): FollowUpDueResult {
  const scheduled = lead.nextFollowUpAt || nextFollowUpAt(lead);
  if (!lead.initiatedByCustomer) return { due: false, state: 'STOPPED', reason: 'لم يبدأ العميل التواصل — لا رسالة باردة.' };
  if (lead.stage === 'WON' || lead.stage === 'LOST') return { due: false, state: 'STOPPED', reason: 'العميل محسوم (صفقة/مفقود).' };
  if (lead.followUpsSent >= COMMERCIAL_MAX_FOLLOWUPS) return { due: false, state: 'STOPPED', reason: 'استُنفد حدّ المتابعات (لا إلحاح).' };
  if (!scheduled) return { due: false, state: 'SKIPPED', reason: 'لا نافذة متابعة مستحقّة.' };
  const t = Date.parse(scheduled);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(t) || !Number.isFinite(now)) return { due: false, state: 'SKIPPED', reason: 'وقت غير صالح.' };
  if (now >= t) return { due: true, state: 'DUE', reason: 'حان وقت المتابعة (بعد آخر تفاعل للعميل بلا رد).' };
  return { due: false, state: 'SCHEDULED', reason: 'لم يحن الوقت بعد.' };
}

/** يطبّق إرسال متابعة فعلية على العميل (يُستدعى بعد نجاح الإرسال الحقيقي فقط). */
export function applyFollowUpSent(lead: CommercialLead, atIso: string): CommercialLead {
  const updated: CommercialLead = {
    ...lead,
    followUpsSent: lead.followUpsSent + 1,
    lastBusinessReplyAt: atIso,
    updatedAt: atIso,
    followUpState: lead.followUpsSent + 1 >= COMMERCIAL_MAX_FOLLOWUPS ? 'STOPPED' : 'SCHEDULED',
  };
  return { ...updated, nextFollowUpAt: nextFollowUpAt(updated) };
}

/**
 * نص متابعة حتمي بلا أي ادعاء تجاري (لا سعر ولا خصم ولا رقم): مجرّد تذكير ودّي
 * يذكر اسم المنتج المسجّل إن وُجد. يمرّ إجبارياً بحارس سلامة المحتوى قبل الإرسال.
 */
export function buildCommercialFollowUpText(lead: CommercialLead): string {
  const name = String(lead.interestedProductName || '').trim();
  if (name) {
    return `هلا بيك 🌹 شفت استفسارك عن ${name} وحبيت أتأكد إذا بعدك مهتم — نحن بالخدمة ونكدر نوضّحلك التفاصيل المناسبة لك.`;
  }
  return 'هلا بيك 🌹 حبيت أتأكد إذا بعدك مهتم بالاستفسار — نحن بالخدمة ونرد على أي سؤال.';
}

// ─────────────────────────────────────────────────────────────────────────────
// اقتراح الصفقة + التأكيد البشري.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يبني اقتراح صفقة نهائياً من بيانات المنتج المسجّلة + نتيجة التفاوض. لا يُغلق شيئاً:
 * الحالة `pending` دائماً حتى يؤكّد بشري. غياب سعر مسجّل ⇒ لا اقتراح (تصعيد).
 */
export function buildCommercialProposal(input: {
  id: string;
  product: { id: string; name: string; cashPrice: number };
  negotiation: NegotiationDecision;
  installmentMonths: number;
  at: string;
}): CommercialProposal | null {
  const cash = Number(input.product?.cashPrice);
  if (!Number.isFinite(cash) || cash <= 0) return null;
  return {
    id: input.id,
    productId: String(input.product.id),
    productName: String(input.product.name),
    cashPrice: cash,
    discountPercent: input.negotiation.discountPercent,
    discountAmount: input.negotiation.discountAmount,
    finalPrice: input.negotiation.finalPrice,
    installmentMonths: Math.max(1, Math.min(60, Math.floor(Number(input.installmentMonths) || 1))),
    monthlyInstallment: input.negotiation.monthlyInstallment,
    createdAt: input.at,
    status: 'pending',
    confirmedBy: null,
    confirmedAt: null,
  };
}

export interface ProposalConfirmationResult {
  ok: boolean;
  proposal: CommercialProposal | null;
  leadStage: CommercialLeadStage;
  reason: string;
}

/**
 * يؤكّد اقتراح الصفقة بشرياً. **لا «تم البيع» بلا تأكيد صريح** من مالك/موظف مخوَّل،
 * ولا استلام دفع ولا تعديل مخزون (خارج نطاق هذه الوحدة كلياً).
 */
export function confirmCommercialProposal(input: {
  lead: CommercialLead;
  proposalId: string;
  confirmedBy: string;
  allowed: boolean;
  at: string;
}): ProposalConfirmationResult {
  const p = input.lead.pendingProposal;
  if (!p || p.id !== input.proposalId) return { ok: false, proposal: null, leadStage: input.lead.stage, reason: 'لا اقتراح مطابق معلّق.' };
  if (!input.allowed) return { ok: false, proposal: p, leadStage: input.lead.stage, reason: 'المؤكِّد غير مخوَّل (المالك أو موظف بصلاحية).' };
  if (p.status !== 'pending') return { ok: false, proposal: p, leadStage: input.lead.stage, reason: 'الاقتراح محسوم مسبقاً.' };
  const confirmed: CommercialProposal = { ...p, status: 'confirmed', confirmedBy: input.confirmedBy, confirmedAt: input.at };
  return { ok: true, proposal: confirmed, leadStage: 'WON', reason: 'أُكّدت الصفقة بشرياً.' };
}

/** يرفض اقتراح الصفقة بشرياً (لا يُغلق تلقائياً). */
export function rejectCommercialProposal(lead: CommercialLead, proposalId: string, at: string): CommercialProposal | null {
  const p = lead.pendingProposal;
  if (!p || p.id !== proposalId) return null;
  return { ...p, status: 'rejected', confirmedAt: at };
}

// ─────────────────────────────────────────────────────────────────────────────
// ملخص لوحة المتابعة (بلا بيانات حساسة في الصيغة العامة).
// ─────────────────────────────────────────────────────────────────────────────

export interface CommercialLeadRow {
  id: string;
  platform: string;
  customerName: string | null;
  interestedProductName: string | null;
  stage: CommercialLeadStage;
  stageLabelAr: string;
  touches: number;
  lastInteractionAt: string;
  followUpState: CommercialFollowUpState;
  followUpLabelAr: string;
  nextFollowUpAt: string | null;
  followUpsSent: number;
  hasPendingProposal: boolean;
  escalationReason: string | null;
  lastCustomerText: string | null;
}

/** يحوّل عميلاً إلى صفّ عرض للوحة (آخر نص للعميل يبقى للمسار المحمي). */
export function toCommercialLeadRow(lead: CommercialLead): CommercialLeadRow {
  return {
    id: lead.id,
    platform: lead.platform,
    customerName: lead.customerName,
    interestedProductName: lead.interestedProductName,
    stage: lead.stage,
    stageLabelAr: COMMERCIAL_LEAD_STAGE_LABELS_AR[lead.stage],
    touches: lead.touches,
    lastInteractionAt: lead.lastInteractionAt,
    followUpState: lead.followUpState,
    followUpLabelAr: COMMERCIAL_FOLLOWUP_LABELS_AR[lead.followUpState],
    nextFollowUpAt: lead.nextFollowUpAt,
    followUpsSent: lead.followUpsSent,
    hasPendingProposal: Boolean(lead.pendingProposal && lead.pendingProposal.status === 'pending'),
    escalationReason: lead.escalationReason,
    lastCustomerText: lead.lastCustomerText,
  };
}

export interface CommercialSummary {
  total: number;
  byStage: Record<CommercialLeadStage, number>;
  pendingProposals: number;
  escalated: number;
  followUpsDue: number;
  followUpsScheduled: number;
}

/** ملخص حتمي من العملاء الحقيقيين (بلا تقدير). */
export function summarizeCommercialLeads(leads: readonly CommercialLead[], nowIso: string): CommercialSummary {
  const byStage = {
    NEW: 0, ENGAGED: 0, QUALIFIED: 0, NEGOTIATING: 0, PROPOSAL_PENDING: 0, WON: 0, LOST: 0, ESCALATED: 0,
  } as Record<CommercialLeadStage, number>;
  let pendingProposals = 0, escalated = 0, followUpsDue = 0, followUpsScheduled = 0;
  for (const l of leads) {
    byStage[l.stage] = (byStage[l.stage] || 0) + 1;
    if (l.pendingProposal && l.pendingProposal.status === 'pending') pendingProposals += 1;
    if (l.stage === 'ESCALATED') escalated += 1;
    const f = isFollowUpDue(l, nowIso);
    if (f.due) followUpsDue += 1;
    else if (f.state === 'SCHEDULED') followUpsScheduled += 1;
  }
  return { total: leads.length, byStage, pendingProposals, escalated, followUpsDue, followUpsScheduled };
}

/** كتلة عامة (لـ/api/health) — أرقام فقط بلا أي بيانات عميل. */
export function commercialPublicBlock(leads: readonly CommercialLead[], nowIso: string) {
  const s = summarizeCommercialLeads(leads, nowIso);
  return {
    leads: s.total,
    pendingProposals: s.pendingProposals,
    escalated: s.escalated,
    followUpsDue: s.followUpsDue,
    followUpsScheduled: s.followUpsScheduled,
    executesExternalActions: false,
    closesDealWithoutHuman: false,
    note: 'أرقام تشغيلية فقط؛ بيانات العملاء (الأسماء/النصوص/الاقتراحات) في المسارات المحمية للمالك.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// تطبيع دفاعي عند الاسترجاع من التخزين (توافق خلفي مع أي شكل قديم).
// ─────────────────────────────────────────────────────────────────────────────

/** يطبّع عميلاً محتملاً محفوظاً؛ يرفض غير الصالح (بلا صفوف مختلقة). */
export function normalizeCommercialLead(raw: any): CommercialLead | null {
  if (!raw || typeof raw !== 'object') return null;
  const key = String(raw.key || '').trim();
  const id = String(raw.id || '').trim();
  if (!key && !id) return null;
  const stage: CommercialLeadStage = (COMMERCIAL_LEAD_STAGES as readonly string[]).includes(raw.stage) ? raw.stage : 'NEW';
  const followUpState = ['SCHEDULED', 'DUE', 'SENT', 'SKIPPED', 'STOPPED'].includes(raw.followUpState) ? raw.followUpState : 'SCHEDULED';
  const at = String(raw.lastInteractionAt || raw.createdAt || new Date().toISOString());
  return {
    id: id || newLeadId(key),
    key: key || id,
    platform: String(raw.platform || '').trim().toLowerCase(),
    conversationId: String(raw.conversationId || ''),
    kind: raw.kind === 'message' ? 'message' : 'comment',
    replyTarget: raw.replyTarget && typeof raw.replyTarget === 'object' ? raw.replyTarget : {},
    lastExternalId: raw.lastExternalId ? String(raw.lastExternalId) : null,
    initiatedByCustomer: raw.initiatedByCustomer === true,
    sourceEventIds: Array.isArray(raw.sourceEventIds) ? raw.sourceEventIds.map((x: any) => String(x)) : [],
    customerName: raw.customerName ? String(raw.customerName) : null,
    interestedProductId: raw.interestedProductId ? String(raw.interestedProductId) : null,
    interestedProductName: raw.interestedProductName ? String(raw.interestedProductName) : null,
    stage,
    touches: Number.isFinite(Number(raw.touches)) ? Math.max(0, Math.trunc(Number(raw.touches))) : 0,
    lastCustomerText: raw.lastCustomerText ? String(raw.lastCustomerText) : null,
    lastInteractionAt: at,
    createdAt: String(raw.createdAt || at),
    updatedAt: String(raw.updatedAt || at),
    lastCustomerInteractionAt: raw.lastCustomerInteractionAt ? String(raw.lastCustomerInteractionAt) : null,
    lastBusinessReplyAt: raw.lastBusinessReplyAt ? String(raw.lastBusinessReplyAt) : null,
    followUpState,
    followUpsSent: Number.isFinite(Number(raw.followUpsSent)) ? Math.max(0, Math.trunc(Number(raw.followUpsSent))) : 0,
    nextFollowUpAt: raw.nextFollowUpAt ? String(raw.nextFollowUpAt) : null,
    pendingProposal: raw.pendingProposal && typeof raw.pendingProposal === 'object' ? raw.pendingProposal : null,
    escalationReason: raw.escalationReason ? String(raw.escalationReason) : null,
    notes: Array.isArray(raw.notes) ? raw.notes.map((x: any) => String(x)) : [],
  };
}

/** يطبّع قائمة العملاء المحفوظة (يتخطّى غير الصالح بلا اختلاق). */
export function normalizeCommercialLeads(raw: any): CommercialLead[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeCommercialLead).filter((x): x is CommercialLead => x !== null);
}
