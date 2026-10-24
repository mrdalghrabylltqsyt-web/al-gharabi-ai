/**
 * B8 — ربط البيع بالمحادثة + تقرير شهري حتمي (منطق صافٍ قابل للاختبار).
 *
 * الغرض: تسجيل صفقة حقيقية (زر «تم البيع») مرتبطة بالمحادثة/الـlead الذي جاءت
 * منه، مع **المنصة المصدر** والمنتج والمبلغ، ثم بناء تقرير شهري حتمي (عدد
 * الاستفسارات والمبيعات لكل منصة) من البيانات الحقيقية فقط.
 *
 * مبادئ ملزمة:
 *   - **لا اختراع**: كل رقم يُشتقّ من سجل حقيقي (استفسار وارد / صفقة مسجّلة).
 *   - **لا جدول جديد**: السجل يبقى داخل مخزن الحالة القائم (مفتاح `commercial`)،
 *     فلا تغيير في مخطط قاعدة البيانات. (قرار المالك: أي جدول جديد يتوقف لموافقته.)
 *   - **حتمي بالكامل**: بلا شبكة، بلا أسرار، بلا ساعة حقيقية (الزمن يُمرَّر).
 */

export interface CommercialSaleRecord {
  id: string;
  /** منصة المصدر (facebook/instagram/telegram/… أو 'unknown' عند الجهل). */
  sourcePlatform: string;
  /** معرّف الـlead/المحادثة المصدر (إن وُجد). */
  leadId: string | null;
  conversationId: string | null;
  customerName: string | null;
  productId: string | null;
  productName: string;
  /** مبلغ البيع (د.ع) — من إدخال المالك، لا يُخترع. */
  amount: number;
  /** مُنشئ السجل (معرّف المستخدم) + طابعه الزمني. */
  recordedBy: string;
  recordedAt: string;
}

export const COMMERCIAL_SALE_SOURCE_UNKNOWN = 'unknown';

/** يُطبّع منصة مصدر (حروف صغيرة، بلا فراغات) مع قيمة صريحة عند الجهل. */
export function normalizeSourcePlatform(raw: unknown): string {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  return s || COMMERCIAL_SALE_SOURCE_UNKNOWN;
}

/**
 * يبني سجل بيع حقيقي من مدخلات المالك. **يرفض** المدخلات الناقصة (بلا مبلغ موجب
 * أو بلا اسم منتج) بإرجاع null — فلا يُسجَّل بيع وهمي.
 */
export function buildCommercialSaleRecord(input: {
  id: string;
  sourcePlatform?: unknown;
  leadId?: unknown;
  conversationId?: unknown;
  customerName?: unknown;
  productId?: unknown;
  productName?: unknown;
  amount: unknown;
  recordedBy: string;
  recordedAt: string;
}): CommercialSaleRecord | null {
  const amount = Number(input.amount);
  const productName = String(input.productName == null ? '' : input.productName).trim().slice(0, 200);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!productName) return null;
  return {
    id: String(input.id),
    sourcePlatform: normalizeSourcePlatform(input.sourcePlatform),
    leadId: input.leadId == null || String(input.leadId).trim() === '' ? null : String(input.leadId).trim(),
    conversationId: input.conversationId == null || String(input.conversationId).trim() === '' ? null : String(input.conversationId).trim(),
    customerName: input.customerName == null || String(input.customerName).trim() === '' ? null : String(input.customerName).trim().slice(0, 120),
    productId: input.productId == null || String(input.productId).trim() === '' ? null : String(input.productId).trim(),
    productName,
    amount,
    recordedBy: String(input.recordedBy),
    recordedAt: String(input.recordedAt),
  };
}

/** يُطبّع سجلاً محفوظاً (توافق خلفي: يرفض غير الصالح). */
export function normalizeCommercialSaleRecord(raw: unknown): CommercialSaleRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  const amount = Number(r.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const productName = String(r.productName || '').trim();
  if (!productName) return null;
  return {
    id: r.id,
    sourcePlatform: normalizeSourcePlatform(r.sourcePlatform),
    leadId: typeof r.leadId === 'string' && r.leadId ? r.leadId : null,
    conversationId: typeof r.conversationId === 'string' && r.conversationId ? r.conversationId : null,
    customerName: typeof r.customerName === 'string' && r.customerName ? r.customerName : null,
    productId: typeof r.productId === 'string' && r.productId ? r.productId : null,
    productName,
    amount,
    recordedBy: typeof r.recordedBy === 'string' ? r.recordedBy : 'unknown',
    recordedAt: typeof r.recordedAt === 'string' ? r.recordedAt : '',
  };
}

/** مفتاح الشهر المحلي (YYYY-MM) من طابع ISO — يُقارَن نصياً فلا زحزحة مناطق. */
export function monthKeyOf(iso: unknown): string | null {
  const s = String(iso == null ? '' : iso);
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

export interface MonthlyPlatformRow {
  platform: string;
  /** عدد الاستفسارات الحقيقية (leads) الواردة على هذه المنصة. */
  inquiries: number;
  /** عدد المبيعات المسجّلة المصدرها هذه المنصة. */
  sales: number;
  /** إجمالي قيمة المبيعات (د.ع). */
  salesValue: number;
}

export interface MonthlyCommercialReport {
  month: string;
  rows: MonthlyPlatformRow[];
  totals: { inquiries: number; sales: number; salesValue: number };
}

/**
 * يبني تقريراً شهرياً حتمياً (عدد الاستفسارات والمبيعات لكل منصة) من:
 *  - leads: { platform, createdAt } — استفسارات حقيقية.
 *  - sales: CommercialSaleRecord — صفقات مسجّلة (بـsourcePlatform).
 * الشهر يُحدَّد بـ`monthKey` (YYYY-MM). الصفوف تشمل كل منصة ظهرت في أي منهما.
 * لا يُخترع أي صف لمنصة لم تُسجَّل عليها بيانات.
 */
export function buildMonthlyCommercialReport(input: {
  monthKey: string;
  leads: Array<{ platform?: string | null; createdAt?: string | null }>;
  sales: CommercialSaleRecord[];
}): MonthlyCommercialReport {
  const rows = new Map<string, MonthlyPlatformRow>();
  const ensure = (platform: string): MonthlyPlatformRow => {
    let r = rows.get(platform);
    if (!r) { r = { platform, inquiries: 0, sales: 0, salesValue: 0 }; rows.set(platform, r); }
    return r;
  };
  for (const lead of input.leads || []) {
    if (monthKeyOf(lead?.createdAt) !== input.monthKey) continue;
    ensure(normalizeSourcePlatform(lead?.platform)).inquiries += 1;
  }
  for (const sale of input.sales || []) {
    if (monthKeyOf(sale.recordedAt) !== input.monthKey) continue;
    const row = ensure(sale.sourcePlatform);
    row.sales += 1;
    row.salesValue += sale.amount;
  }
  const list = Array.from(rows.values()).sort((a, b) => (b.sales - a.sales) || (b.inquiries - a.inquiries) || a.platform.localeCompare(b.platform));
  const totals = list.reduce((acc, r) => ({ inquiries: acc.inquiries + r.inquiries, sales: acc.sales + r.sales, salesValue: acc.salesValue + r.salesValue }), { inquiries: 0, sales: 0, salesValue: 0 });
  return { month: input.monthKey, rows: list, totals };
}
