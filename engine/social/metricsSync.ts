/**
 * مزامنة مؤشرات الأداء الحقيقية من المنصات — وقود تعلّم العقل.
 *
 * الجذر (شاشات المالك 2026-10-25): «سجلات أداء للتعلم 0» و«عيّنة 0 — غير كافية» لكل
 * المنصات، والمتابعون/المشاهدات «0»، رغم 16 منشوراً منشوراً فعلاً. لم يكن أي مسار
 * يجلب المؤشرات تلقائياً: YouTube يُقرأ فقط عند فتح شاشته يدوياً (ويُكرّر السجلات كل
 * مرة)، وMeta/Threads/TikTok لا تُقرأ إطلاقاً. فالعقل يخطط بلا أي دليل.
 *
 * هذه الوحدة صافية: محلّلات استجابات Graph/YouTube الرسمية (بلا اختراع: غياب الحقل
 * ⇒ غياب القيمة لا صفر)، ودمج سجل الأداء **بلا تكرار** (منصة + معرّف منشور)، وحساب
 * معدل التفاعل. الجلب نفسه في الخادم عبر الرموز المخزّنة.
 */

export type MetricValues = Partial<Record<'views' | 'likes' | 'comments' | 'shares' | 'reach' | 'saves', number>>;

function count(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

function put(out: MetricValues, key: keyof MetricValues, v: unknown): void {
  const n = count(v);
  if (n !== undefined) out[key] = n;
}

/** منشور/فيديو فيسبوك: reactions.summary + comments.summary + shares.count. */
export function parseFacebookPostMetrics(json: any): MetricValues {
  const out: MetricValues = {};
  if (!json || typeof json !== 'object' || json.error) return out;
  put(out, 'likes', json?.reactions?.summary?.total_count ?? json?.likes?.summary?.total_count);
  put(out, 'comments', json?.comments?.summary?.total_count);
  put(out, 'shares', json?.shares?.count);
  // فيديو: عدد المشاهدات إن أعاده الحقل views (عقدة Video).
  put(out, 'views', json?.views);
  return out;
}

/** وسائط إنستغرام: like_count + comments_count (حقول أساسية بلا صلاحية رؤى). */
export function parseInstagramMediaMetrics(json: any): MetricValues {
  const out: MetricValues = {};
  if (!json || typeof json !== 'object' || json.error) return out;
  put(out, 'likes', json.like_count);
  put(out, 'comments', json.comments_count);
  return out;
}

/**
 * استجابة رؤى Graph (Instagram/Threads/Facebook insights): data[] بعناصر
 * { name, values:[{value}] } أو { name, total_value:{value} }. الأسماء تُحوَّل عبر `map`.
 */
export function parseGraphInsights(json: any, map: Record<string, keyof MetricValues>): MetricValues {
  const out: MetricValues = {};
  const rows = Array.isArray(json?.data) ? json.data : [];
  for (const r of rows) {
    const key = map[String(r?.name || '')];
    if (!key) continue;
    const v = r?.total_value?.value ?? (Array.isArray(r?.values) ? r.values[r.values.length - 1]?.value : undefined);
    put(out, key, v);
  }
  return out;
}

/** عدد المتابعين من عقدة حساب (followers_count ثم fan_count) — null إن غاب. */
export function parseFollowers(json: any): number | null {
  if (!json || typeof json !== 'object' || json.error) return null;
  const n = count(json.followers_count ?? json.fan_count ?? json.follower_count ?? json?.data?.user?.follower_count);
  return n === undefined ? null : n;
}

export interface PerformanceRow {
  id: string;
  platform: string;
  postExternalId: string;
  values: MetricValues;
  at: string;
  firstAt?: string;
  recordedBy: string;
  contentType?: string | null;
  title?: string | null;
  productCategory?: string | null;
  postId?: string | null;
  [k: string]: unknown;
}

/** قياس جديد لمنشور (بلا معرّف السجل). */
export interface PerformanceIncoming {
  platform: string;
  postExternalId: string;
  values: MetricValues;
  recordedBy: string;
  at?: string;
  contentType?: string | null;
  title?: string | null;
  productCategory?: string | null;
  postId?: string | null;
  publishedAt?: string | null;
}

/**
 * دمج قياسات جديدة في سجل الأداء: صف واحد لكل (منصة + منشور) يُحدَّث بأحدث القيم
 * (لا تكرار يضخّم عيّنة التعلّم). القيم الغائبة في القياس الجديد تبقى كما كانت.
 * يُزيل أيضاً التكرارات القديمة لنفس المفتاح (كان مسار YouTube يضيف صفاً كل فتح).
 */
export function upsertPerformanceRecords(
  existing: readonly PerformanceRow[],
  incoming: ReadonlyArray<PerformanceIncoming>,
  nowIso: string,
  newId: () => string,
  max = 20000,
): { records: PerformanceRow[]; added: number; updated: number; deduped: number } {
  const key = (r: { platform: string; postExternalId: string }) => `${r.platform}::${r.postExternalId}`;
  const map = new Map<string, PerformanceRow>();
  let deduped = 0;
  // الأحدث أولاً في المصفوفة الحالية؛ أول ظهور هو الأحدث فيُحتفظ به.
  for (const r of existing || []) {
    if (!r || !r.platform || !r.postExternalId) continue;
    const k = key(r);
    if (map.has(k)) { deduped += 1; continue; }
    map.set(k, { ...r });
  }
  let added = 0; let updated = 0;
  for (const inc of incoming || []) {
    if (!inc?.platform || !inc?.postExternalId || !inc.values || !Object.keys(inc.values).length) continue;
    const k = key(inc);
    const prev = map.get(k);
    if (prev) {
      map.set(k, { ...prev, ...inc, values: { ...prev.values, ...inc.values }, at: inc.at || nowIso, firstAt: prev.firstAt || prev.at, id: prev.id } as PerformanceRow);
      updated += 1;
    } else {
      map.set(k, { ...inc, id: newId(), at: inc.at || nowIso, firstAt: nowIso } as PerformanceRow);
      added += 1;
    }
  }
  const records = [...map.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, max);
  return { records, added, updated, deduped };
}

/** معدل التفاعل (إعجابات + تعليقات + مشاركات) ÷ (الوصول ثم المشاهدات ثم المتابعين) — null بلا مقام. */
export function engagementRate(values: MetricValues, followers: number | null): number | null {
  const eng = (values.likes || 0) + (values.comments || 0) + (values.shares || 0);
  const base = values.reach || values.views || followers || 0;
  if (!base) return null;
  return Math.round((eng / base) * 10000) / 100;
}

/** ملخص منصة للعرض: مجموع المؤشرات المعروفة + معدل التفاعل الوسيط. */
export function summarizePlatformMetrics(rows: readonly PerformanceRow[], followers: number | null): { posts: number; totals: MetricValues; engagementRate: number | null } {
  const totals: MetricValues = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.values || {})) {
      if (typeof v === 'number') (totals as any)[k] = ((totals as any)[k] || 0) + v;
    }
  }
  return { posts: rows.length, totals, engagementRate: rows.length ? engagementRate(totals, followers ? followers * rows.length : null) : null };
}
