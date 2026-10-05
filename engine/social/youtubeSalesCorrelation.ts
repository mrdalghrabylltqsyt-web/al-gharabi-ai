/**
 * ربط قراءة-فقط بين تفاعل YouTube ومبيعات موثّقة (Point 3).
 *
 * القاعدة الحاكمة: **لا استنتاج سببية، ولا نسبة، ولا ROI**. يُعلن فقط ما يمكن إثباته
 * بربط **صريح** (نفس `productId` مسجّل على الطرفين) + نافذة زمنية. كل ما لا يمكن
 * إثباته يُعلن `UNAVAILABLE`/`INSUFFICIENT_DATA` وفق نموذج الصدق القائم في
 * `engine/brain/knowledge/truth.ts` (لا نموذج جديد).
 *
 * منطق خالص: لا شبكة، ولا أسرار، ولا كتابة.
 */

import { TRUTH_STATE_LABELS_AR, type TruthState } from '../brain/knowledge/truth';

export interface YouTubeCommentLike {
  platform?: string | null;
  externalId?: string | null;
  productId?: string | null;
  createdAt?: string | null;
}

export interface SaleLike {
  id?: string | null;
  productId?: string | null;
  customerName?: string | null;
  createdAt?: string | null;
  status?: string | null;
}

export interface YouTubeSalesCorrelation {
  generatedAt: string;
  /** طريقة الربط الصريحة الوحيدة المتاحة اليوم. */
  linkMethod: string;
  /** النافذة الزمنية المستخدمة لاعتبار المطابقة موثّقة. */
  windowDays: number;
  windowFrom: string;
  windowTo: string;
  states: { commentVolume: TruthState; saleLink: TruthState };
  statesLabelsAr: { commentVolume: string; saleLink: string };
  youtubeCommentsWithExplicitProduct: number;
  matchedSalesCount: number;
  /** مطابقات صريحة: تعليق YouTube + بيع مسجّل بنفس productId داخل النافذة. */
  matches: Array<{
    productId: string;
    productName: string | null;
    youtubeComment: { externalId: string; createdAt: string | null };
    sale: { id: string; customerName: string | null; createdAt: string | null; status: string | null };
  }>;
  limitations: string[];
}

const DAY_MS = 86_400_000;

/**
 * يبني تقرير الربط من بيانات حقيقية فقط.
 *
 * @param comments كل التعليقات (يُفلتر على platform==='youtube').
 * @param sales مبيعات مساحة العمل الحقيقية.
 * @param productNamesById خريطة معرّف المنتج → اسمه (من workspace.products).
 * @param now لحظة التقرير (يُمرَّر صراحةً لتفادي ساعة غير حتمية في الاختبار).
 * @param windowDays نافذة المطابقة الزمنية.
 */
export function buildYouTubeSalesCorrelation(input: {
  comments: YouTubeCommentLike[];
  sales: SaleLike[];
  productNamesById: Map<string, string>;
  now: number;
  windowDays?: number;
}): YouTubeSalesCorrelation {
  const windowDays = Number.isFinite(input.windowDays) && (input.windowDays as number) > 0 ? Math.floor(input.windowDays as number) : 30;
  const nowMs = input.now;
  const windowFromMs = nowMs - windowDays * DAY_MS;

  const ytComments = (input.comments || []).filter((c) => c && c.platform === 'youtube');
  const withProduct = ytComments.filter((c) => typeof c.productId === 'string' && c.productId.trim().length > 0);

  // فهرسة المبيعات ذات productId صريح وطابع زمني صالح.
  const salesByProduct = new Map<string, SaleLike[]>();
  for (const s of input.sales || []) {
    const pid = typeof s.productId === 'string' ? s.productId.trim() : '';
    if (!pid) continue;
    const t = Date.parse(String(s.createdAt || ''));
    if (!Number.isFinite(t)) continue;
    const list = salesByProduct.get(pid) || [];
    list.push(s);
    salesByProduct.set(pid, list);
  }

  const matches: YouTubeSalesCorrelation['matches'] = [];
  for (const c of withProduct) {
    const pid = String(c.productId).trim();
    const ct = Date.parse(String(c.createdAt || ''));
    const candidates = salesByProduct.get(pid) || [];
    for (const s of candidates) {
      const st = Date.parse(String(s.createdAt || ''));
      // المطابقة الصريحة: نفس المنتج، وبيع في نفس النافذة الزمنية للتقرير.
      const inWindow = Number.isFinite(ct) ? st >= ct : st >= windowFromMs;
      const withinReportWindow = st >= windowFromMs && st <= nowMs;
      if (!inWindow || !withinReportWindow) continue;
      matches.push({
        productId: pid,
        productName: input.productNamesById.get(pid) ?? null,
        youtubeComment: { externalId: String(c.externalId || ''), createdAt: c.createdAt ?? null },
        sale: { id: String(s.id || ''), customerName: s.customerName ?? null, createdAt: s.createdAt ?? null, status: s.status ?? null },
      });
    }
  }

  // حالة الصدق: كمية التعليقات الربطية حقيقة موثّقة (مقروءة مباشرة)، أما الربط
  // بالبيع فهو استنتاج حسابي (نفس المعرّف + نافذة) — لا سببية.
  const commentVolumeState: TruthState = withProduct.length >= 3 ? 'VERIFIED_FACT' : withProduct.length > 0 ? 'DERIVED_FACT' : 'UNKNOWN';
  const saleLinkState: TruthState = matches.length > 0 ? 'DERIVED_FACT' : withProduct.length > 0 ? 'INSUFFICIENT_DATA' : 'UNAVAILABLE';

  const limitations = [
    'الربط بمعرّف المنتج الصريح + النافذة الزمنية فقط؛ لا سببية ولا نسبة ولا ROI.',
    'التعليقات الملتقطة تلقائياً من مراقب YouTube لا تحمل productId (لا يوجد ربط تلقائي اليوم)، فيُدرج الـproductId صراحةً عبر /api/social/manager/comments/ingest.',
    'لا يوجد معرّف عميل مشترك (هاتف/leadId) بين تعليق YouTube والبيع اليوم؛ فمطابقة نفس العميل غير قابلة للإثبات.',
  ];

  return {
    generatedAt: new Date(nowMs).toISOString(),
    linkMethod: 'explicit_product_id_and_time_window',
    windowDays,
    windowFrom: new Date(windowFromMs).toISOString(),
    windowTo: new Date(nowMs).toISOString(),
    states: { commentVolume: commentVolumeState, saleLink: saleLinkState },
    statesLabelsAr: {
      commentVolume: TRUTH_STATE_LABELS_AR[commentVolumeState],
      saleLink: TRUTH_STATE_LABELS_AR[saleLinkState],
    },
    youtubeCommentsWithExplicitProduct: withProduct.length,
    matchedSalesCount: matches.length,
    matches,
    limitations,
  };
}
