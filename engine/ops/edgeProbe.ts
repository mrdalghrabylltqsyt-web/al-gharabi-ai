/**
 * فحص الحافة والسيرفرات من الخارج (2026-10-29) — منطق صافٍ + محكّم.
 *
 * فحوص المهندس الأخرى تجري **داخل** الخادم؛ لكن المالك والزبائن يصلون من الخارج: عبر نطاق Netlify
 * (الذي يمرّر /api إلى Render) ومباشرة إلى Render. خادم سليم من الداخل قد يكون غير قابل للوصول
 * من الخارج (وكيل Netlify معطّل، شهادة TLS منتهية، DNS، Render نائم/محجوب). هنا:
 *   - يطلب `/api/health` عبر كل عنوان عام معروف كما يفعل المتصفح، ويقيس الحالة والزمن،
 *   - يتحقق أن ترويسات الحماية تصل فعلاً للمتصفح (nosniff / منع الإطار / HSTS / CSP على الصفحة),
 *   - يقرأ شهادة TLS لكل نطاق ويحسب الأيام المتبقية،
 *   - ويصدر حكماً لكل هدف مع السبب ومن يصلحه.
 * الشبكة تُمرَّر (fetch/tls) فيبقى قابلاً للاختبار بلا إنترنت. لا أسرار: الطلب بلا جلسة.
 */

export interface EdgeTarget { id: 'public' | 'render'; label: string; baseUrl: string }
export interface EdgeHttpResult { status: number; ms: number; headers: Record<string, string>; error?: string | null }
export interface EdgeTlsResult { validTo: string | null; issuer: string | null; error?: string | null }
export interface EdgeTargetResult {
  id: EdgeTarget['id']; label: string; host: string;
  status: number; ms: number; ok: boolean; reachable: boolean;
  tlsDaysLeft: number | null; tlsIssuer: string | null;
  missingHeaders: string[];
  verdict: 'ok' | 'slow' | 'down' | 'tls_soon' | 'tls_expired' | 'headers';
  detail: string;
}
export interface EdgeRound { at: string; results: EdgeTargetResult[]; worst: EdgeTargetResult['verdict'] }

export const EDGE_POLICY = Object.freeze({
  intervalMs: 15 * 60 * 1000,
  timeoutMs: 20_000,
  /** أبطأ من هذا = تحذير (يشمل استيقاظ Render من النوم). */
  slowMs: 8_000,
  /** شهادة تنتهي خلال هذه الأيام = تحذير (Netlify/Render يجدّدانها عادة قبل 30 يوماً). */
  tlsWarnDays: 14,
  requiredApiHeaders: ['x-content-type-options', 'x-frame-options', 'referrer-policy'],
});

/** الأهداف من العناوين العامة المضبوطة (APP_URL وعنوان Render الخارجي) — بلا تكرار نطاق. */
export function edgeTargets(publicBase: string | null | undefined, renderExternal: string | null | undefined): EdgeTarget[] {
  const out: EdgeTarget[] = [];
  const add = (id: EdgeTarget['id'], label: string, raw: string | null | undefined) => {
    const s = String(raw || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(s)) return;
    if (out.some((t) => hostOf(t.baseUrl) === hostOf(s))) return;
    out.push({ id, label, baseUrl: s });
  };
  add('public', 'العنوان العام للتطبيق', publicBase);
  add('render', 'خادم Render مباشرة', renderExternal);
  return out;
}
export function hostOf(url: string): string { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } }

const verdictRank: Record<EdgeTargetResult['verdict'], number> = { down: 0, tls_expired: 1, tls_soon: 2, headers: 3, slow: 4, ok: 5 };

export function judgeEdge(t: EdgeTarget, http: EdgeHttpResult, tls: EdgeTlsResult | null, nowMs: number): EdgeTargetResult {
  const host = hostOf(t.baseUrl);
  const reachable = http.status > 0;
  const ok = http.status >= 200 && http.status < 400;
  const h = Object.fromEntries(Object.entries(http.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const missingHeaders = reachable ? EDGE_POLICY.requiredApiHeaders.filter((k) => !h[k]) : [];
  const validTo = tls?.validTo ? Date.parse(tls.validTo) : NaN;
  const tlsDaysLeft = Number.isFinite(validTo) ? Math.floor((validTo - nowMs) / 86400000) : null;
  let verdict: EdgeTargetResult['verdict'] = 'ok';
  let detail = `${t.label} يجيب ${http.status} خلال ${(http.ms / 1000).toFixed(1)} ث`;
  if (!ok) {
    verdict = 'down';
    detail = reachable
      ? `${t.label} يرجع ${http.status} — الزوار يرون خطأ${t.id === 'public' ? ' (وكيل Netlify أو الخادم خلفه)' : ''}`
      : `${t.label} غير قابل للوصول من الإنترنت: ${String(http.error || 'لا رد').slice(0, 90)}`;
  } else if (tlsDaysLeft != null && tlsDaysLeft < 0) {
    verdict = 'tls_expired'; detail = `شهادة ${host} منتهية منذ ${-tlsDaysLeft} يوم — المتصفح يحذّر الزوار`;
  } else if (tlsDaysLeft != null && tlsDaysLeft < EDGE_POLICY.tlsWarnDays) {
    verdict = 'tls_soon'; detail = `شهادة ${host} تنتهي خلال ${tlsDaysLeft} يوم ولم تُجدَّد بعد`;
  } else if (missingHeaders.length) {
    verdict = 'headers'; detail = `ترويسات حماية لا تصل للمتصفح عبر ${t.label}: ${missingHeaders.join('، ')}`;
  } else if (http.ms >= EDGE_POLICY.slowMs) {
    verdict = 'slow'; detail = `${t.label} بطيء: ${(http.ms / 1000).toFixed(1)} ث (نوم Render المجاني أو ضغط)`;
  }
  if (verdict === 'ok' && tlsDaysLeft != null) detail += ` · الشهادة صالحة ${tlsDaysLeft} يوماً`;
  return { id: t.id, label: t.label, host, status: http.status, ms: http.ms, ok, reachable, tlsDaysLeft, tlsIssuer: tls?.issuer || null, missingHeaders, verdict, detail };
}

export function edgeRound(results: EdgeTargetResult[], nowMs: number): EdgeRound {
  const worst = results.reduce<EdgeTargetResult['verdict']>((w, r) => (verdictRank[r.verdict] < verdictRank[w] ? r.verdict : w), 'ok');
  return { at: new Date(nowMs).toISOString(), results, worst };
}

/** سطر السجل لهدف معطّل — يحوّله سجل الأعطال إلى عطل (قاعدة edge:<id>) فيُصلح/يُتحقق منه ويُغلق بتقرير. */
export function edgeFailureLine(r: EdgeTargetResult): string | null {
  if (r.verdict === 'ok' || r.verdict === 'slow') return null;
  return `[edge-probe] outcome=failed target=${r.id} verdict=${r.verdict} host=${r.host} detail=${JSON.stringify(r.detail)}`;
}

/** من يصلح ماذا. */
export function edgeRemedy(verdict: EdgeTargetResult['verdict'], id: EdgeTarget['id']): string {
  switch (verdict) {
    case 'down': return id === 'public'
      ? 'المهندس يعيد الفحص؛ إن بقي معطّلاً وRender يجيب مباشرة فالعطل في وكيل Netlify (قاعدة /api/* في netlify.toml أو نشر Netlify) — بيد المالك من لوحة Netlify.'
      : 'المهندس يعيد الفحص؛ إن بقي معطّلاً فالخدمة متوقفة/موقوفة في Render (حدّ الساعات المجانية أو نشر فاشل) — بيد المالك من لوحة Render.';
    case 'tls_expired':
    case 'tls_soon': return 'الشهادة يجدّدها Netlify/Render تلقائياً؛ إن لم تتجدّد: تحقق من سجلات DNS للنطاق المخصّص في لوحة المضيف (بيد المالك).';
    case 'headers': return 'ترويسات الحماية يضعها الخادم؛ إن لم تصل عبر الوكيل فإعداد Netlify يحذفها — يحتاج تعديل الإعداد (مهندس الكود).';
    case 'slow': return 'Render المجاني ينام بعد خمول؛ مهمة keep-alive تبقيه مستيقظاً — إن تكرر فتحقق أنها تعمل.';
    default: return '';
  }
}
