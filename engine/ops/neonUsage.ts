/**
 * قراءة استهلاك Neon **الفعلي** (compute + transfer) عبر واجهة Neon الرسمية —
 * منطق خالص قابل للاختبار (بلا سرّ في المخرَج، وبلا شبكة في الاختبار عبر fake).
 *
 * لماذا: كان مؤشّر النقل يُقدَّر من بايتات الكتابة الداخلية فيبالغ جوهرياً (96%
 * بينما لوحة Neon ~188MB). الأولوية الآن: قراءة الرقم الفعلي من Neon عند توفّر
 * اعتماد (`NEON_API_KEY` + `NEON_PROJECT_ID`)، وإلا يبقى التقدير من الصادر الفعلي
 * (egress) — ويُعلَن `basis` صراحةً (measured مقابل estimated).
 *
 * قواعد ملزمة:
 *  - **اختياري بالكامل**: بلا اعتماد ⇒ لا نداء شبكة إطلاقاً (`configured:false`).
 *  - **fail-safe**: أي خطأ (شبكة/HTTP/شكل) يُعيد null ولا يوقف أي شيء — يبقى التقدير.
 *  - **لا سرّ في المخرَج**: لا يُعاد الرمز ولا يُسجَّل؛ يُعاد الرقم فقط.
 *  - **حدّ نداء صريح**: النبضة دورية (لا استعلام متكرر) — انظر `NEON_USAGE_POLL_MIN_INTERVAL_MS`.
 */

export interface NeonUsageApiConfig {
  configured: boolean;
  apiKey: string | null;
  projectId: string | null;
  baseUrl: string;
}

export interface NeonActualUsage {
  /** ثواني compute الفعلية المتراكمة في الفترة (0 إن غابت). */
  computeSeconds: number;
  /** بايتات نقل الشبكة الفعلية المتراكمة في الفترة (0 إن غابت). */
  transferBytes: number;
  /** مصدر الرقم (للتوثيق فقط، بلا سرّ). */
  source: 'neon_api';
}

/** الحدّ الأدنى بين نبضتين لقراءة Neon (ساعة) — يمنع أي استعلام متكرر. */
export const NEON_USAGE_POLL_MIN_INTERVAL_MS = 60 * 60 * 1000;

/** يقرأ إعداد Neon API من البيئة فقط. لا يُعلن configured بلا معرّف مشروع ومفتاح. */
export function neonUsageApiConfig(env: NodeJS.ProcessEnv = process.env): NeonUsageApiConfig {
  const apiKey = typeof env.NEON_API_KEY === 'string' && env.NEON_API_KEY.trim() ? env.NEON_API_KEY.trim() : null;
  const projectId = typeof env.NEON_PROJECT_ID === 'string' && env.NEON_PROJECT_ID.trim() ? env.NEON_PROJECT_ID.trim() : null;
  const baseUrl = typeof env.NEON_API_BASE === 'string' && env.NEON_API_BASE.trim()
    ? env.NEON_API_BASE.trim().replace(/\/+$/, '')
    : 'https://console.neon.tech/api/v2';
  return { configured: Boolean(apiKey && projectId), apiKey, projectId, baseUrl };
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * يحلّل استجابة استهلاك Neon بحقول موثّقة متعدّدة الاحتمالات (الشكل تطوّر بين
 * الإصدارات) — يعيد `computeSeconds` و`transferBytes`، أو null إن تعذّر استخراج
 * أي رقم (فلا يُخترع صفر كاذب).
 */
export function parseNeonConsumption(json: any): NeonActualUsage | null {
  if (!json || typeof json !== 'object') return null;
  // الشكل الشائع: { periods: [ { consumption: [ { metric, value } ] } ] } أو حقول مباشرة.
  let computeSeconds: number | null = null;
  let transferBytes: number | null = null;
  const addMetric = (name: unknown, value: unknown) => {
    const key = String(name || '').toLowerCase();
    const v = num(value);
    if (v == null) return;
    if (key.includes('compute') && (key.includes('second') || key.includes('time'))) computeSeconds = (computeSeconds || 0) + v;
    else if (key.includes('transfer') || (key.includes('data') && key.includes('byte'))) transferBytes = (transferBytes || 0) + v;
  };
  const walk = (node: any): void => {
    if (Array.isArray(node)) { for (const x of node) walk(x); return; }
    if (!node || typeof node !== 'object') return;
    // { metric, value }
    if (node.metric !== undefined) addMetric(node.metric, node.value ?? node.amount);
    // حقول مباشرة
    if (node.compute_time_seconds !== undefined) addMetric('compute_time_seconds', node.compute_time_seconds);
    if (node.active_time_seconds !== undefined) addMetric('compute_time_seconds', node.active_time_seconds);
    if (node.data_transfer_bytes !== undefined) addMetric('data_transfer_bytes', node.data_transfer_bytes);
    if (node.transfer_bytes !== undefined) addMetric('data_transfer_bytes', node.transfer_bytes);
    for (const v of Object.values(node)) walk(v);
  };
  walk(json);
  if (computeSeconds == null && transferBytes == null) return null;
  return { computeSeconds: Math.max(0, computeSeconds || 0), transferBytes: Math.max(0, transferBytes || 0), source: 'neon_api' };
}

/**
 * يقرأ الاستهلاك الفعلي من Neon API لفترة زمنية. fail-safe: يعيد null عند أي
 * خطأ (بلا اعتماد/شبكة/HTTP غير 2xx/شكل غير معروف) — لا يرمي ولا يسجّل سرّاً.
 */
export async function fetchNeonActualUsage(
  config: NeonUsageApiConfig,
  range: { fromIso: string; toIso: string },
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<NeonActualUsage | null> {
  if (!config.configured || !config.apiKey || !config.projectId) return null;
  const fetchImpl = deps.fetchImpl || (globalThis as any).fetch;
  if (typeof fetchImpl !== 'function') return null;
  try {
    const url = `${config.baseUrl}/projects/${encodeURIComponent(config.projectId)}/consumption_history/v2?from=${encodeURIComponent(range.fromIso)}&to=${encodeURIComponent(range.toIso)}&granularity=monthly`;
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
    });
    if (!res || !res.ok) return null;
    const json = await res.json();
    return parseNeonConsumption(json);
  } catch {
    return null;
  }
}

/** يحوّل ثواني compute إلى CU-ساعات (وحدة حدّ Neon الموثّق 100 CU-ساعة/شهر). */
export function computeCuHours(computeSeconds: number): number {
  return Math.max(0, Number(computeSeconds) || 0) / 3600;
}
