/**
 * تحديد العنوان العام (Public Base URL) للتطبيق — مصدر واحد لكل رابط خارجي.
 *
 * سبب الوجود: كان الرابط يُبنى حرفياً من `APP_URL` وحدها:
 *   const BASE_URL = (process.env.APP_URL || `http://localhost:${PORT}`)
 * فإذا كان `APP_URL` غير مضبوط على بيئة إنتاج (Render مثلاً) لصار redirect_uri
 * هو `http://localhost:3000/...` فيرفضه Meta بـ«لا يمكن تحميل عنوان URL / النطاق
 * غير مُضمَّن في نطاقات التطبيق». وكان منصّة Render توفر عنوانها العام أصلاً في
 * `RENDER_EXTERNAL_URL`، لكن الكود لم يقرأه قط.
 *
 * هنا مصدر واحد يجرّب بالترتيب: APP_URL ثم بدائل المنصة (PUBLIC_URL،
 * RENDER_EXTERNAL_URL/HOSTNAME، VERCEL_URL) ثم ترويسات الوسيط (X-Forwarded-*)
 * كخيار أخير، ثم localhost للتطوير فقط. ولا يُعاد أي سرّ ولا يُسجَّل أي شيء.
 *
 * القاعدة: المضبوط الصريح يفوز. إن وُجد أعلى مرشّح لكنه غير صالح (http على
 * نطاق عام، أو يحمل مساراً/استعلاماً) يُعلَن صراحةً ولا يُستبدل بصمت بعنوان آخر
 * لا يعرفه المزود، حتى لا نُخفي سبب فشل OAuth.
 */

export interface PublicUrlCandidate {
  /** اسم المصدر: APP_URL / PUBLIC_URL / RENDER_EXTERNAL_URL / headers... */
  source: string;
  /** القيمة الخام كما وُجدت (بلا أي سرّ). null إن كان المتغير غائباً. */
  raw: string | null;
  valid: boolean;
  reason: string;
}

export interface PublicUrlInspection {
  /** العنوان الأساسي المعتمد بلا شرطة أخيرة، أو null إن تعذّر تحديده. */
  baseUrl: string | null;
  /** اسم المضيف فقط (بلا مخطّط ولا منفذ إن كان افتراضياً). */
  host: string | null;
  scheme: 'https' | 'http' | null;
  /** المصدر الذي أنتج العنوان المعتمد. */
  source: string;
  valid: boolean;
  /** مشكلات صريحة (عنوان أعلى أولوية موجود لكنه غير صالح مثلاً). */
  problems: string[];
  /** كل المرشّحات ليعرف المالك ما وُجد وما رُفض ولماذا. */
  candidates: PublicUrlCandidate[];
}

/** منافذ/مضيفات التطوير المحلية — يُسمح لها بـhttp ولا تُعدّ نطاقاً عاماً. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** هل المضيف محلي؟ (يُسمح بـhttp ولا يصلح لـOAuth إنتاجي). */
export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.toLowerCase());
}

/**
 * يفحص مرشّحاً واحداً: يجب أن يكون URL مطلقاً بمخطّط http/https، بلا مسار
 * (أو جذر فقط) وبلا استعلام/مقطع. ويجب https إلا للمضيف المحلي.
 */
export function inspectPublicUrlCandidate(source: string, raw: string | null | undefined): PublicUrlCandidate {
  const value = (raw || '').trim();
  if (!value) return { source, raw: null, valid: false, reason: 'غير مضبوط.' };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { source, raw: value, valid: false, reason: 'ليس رابطاً مطلقاً صالحاً (يلزم https://host).' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { source, raw: value, valid: false, reason: 'المخطّط يجب أن يكون https (أو http للمضيف المحلي فقط).' };
  }
  const host = parsed.hostname;
  const local = isLocalHost(host);
  if (parsed.protocol === 'http:' && !local) {
    return { source, raw: value, valid: false, reason: 'http على نطاق عام مرفوض؛ استخدم https.' };
  }
  // لا مسار ولا استعلام ولا مقطع: العنوان أساسي فقط.
  if ((parsed.pathname && parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) {
    return { source, raw: value, valid: false, reason: 'يجب أن يكون الأساس بلا مسار أو استعلام أو مقطع (مثال https://host).' };
  }
  return { source, raw: value, valid: true, reason: local ? 'مضيف محلي (للتطوير).' : 'رابط عام صالح.' };
}

/** يحوّل قيمة مضيف فقط (RENDER_EXTERNAL_HOSTNAME/VERCEL_URL) إلى رابط https. */
function asHttpsUrl(raw: string | undefined): string | null {
  const v = (raw || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

export interface PublicUrlEnv {
  [key: string]: string | undefined;
}

/** ترويسات الطلب ذات الصلة (تُمرَّر فقط من نداء الخادم، ولا تُخزَّن). */
export interface PublicUrlHeaders {
  forwardedProto?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
}

/**
 * يحسم العنوان العام. الترتيب: APP_URL → PUBLIC_URL → RENDER_EXTERNAL_URL →
 * RENDER_EXTERNAL_HOSTNAME → VERCEL_URL → ترويسات الوسيط → localhost.
 *
 * إن كان أعلى مرشّح موجوداً لكنه غير صالح، يتوقف الحسم ويُعلن المشكلة (بلا
 * رجوع صامت لمصدر أدنى) لئلا يعمل التطبيق على نطاق لا يعرفه المزود.
 */
export function resolvePublicUrl(env: PublicUrlEnv = process.env, headers: PublicUrlHeaders = {}): PublicUrlInspection {
  const candidates: PublicUrlCandidate[] = [];
  const problems: string[] = [];

  const explicit: { source: string; raw: string | undefined }[] = [
    { source: 'APP_URL', raw: env.APP_URL },
    { source: 'PUBLIC_URL', raw: env.PUBLIC_URL },
    { source: 'RENDER_EXTERNAL_URL', raw: env.RENDER_EXTERNAL_URL },
    { source: 'RENDER_EXTERNAL_HOSTNAME', raw: asHttpsUrl(env.RENDER_EXTERNAL_HOSTNAME) || undefined },
    { source: 'VERCEL_URL', raw: asHttpsUrl(env.VERCEL_URL) || undefined },
  ];

  const proto = (headers.forwardedProto || '').split(',')[0].trim().toLowerCase();
  const fwdHost = (headers.forwardedHost || '').split(',')[0].trim();
  const plainHost = (headers.host || '').split(',')[0].trim();
  const headerHost = fwdHost || plainHost;
  if (headerHost) {
    const scheme = proto === 'https' || proto === 'http' ? proto : 'https';
    explicit.push({ source: 'request headers (X-Forwarded-Host/Host)', raw: `${scheme}://${headerHost}` });
  }

  let chosen: PublicUrlCandidate | null = null;
  for (const c of explicit) {
    const inspected = inspectPublicUrlCandidate(c.source, c.raw);
    candidates.push(inspected);
    // نتوقف عند أول مرشّح *موجود* — صالحاً كان أو غير صالح (لا رجوع صامت).
    if (c.raw !== undefined && (c.raw || '').trim() !== '') {
      chosen = inspected;
      break;
    }
  }

  const portFallback = `http://localhost:${(env.PORT || '').trim() || '3000'}`;
  const localCandidate = inspectPublicUrlCandidate('localhost (تطوير)', portFallback);
  candidates.push(localCandidate);

  if (!chosen) chosen = localCandidate;
  if (!chosen.valid) {
    problems.push(`${chosen.source}: ${chosen.reason}`);
    // لا عنوان صالح: نُعلن ذلك ولا نُخفي المشكلة بعنوان آخر.
    return { baseUrl: null, host: null, scheme: null, source: chosen.source, valid: false, problems, candidates };
  }

  const url = new URL(chosen.raw as string);
  return {
    baseUrl: chosen.raw!.replace(/\/+$/, ''),
    host: url.hostname,
    scheme: url.protocol === 'https:' ? 'https' : 'http',
    source: chosen.source,
    valid: true,
    problems,
    candidates,
  };
}

/** العنوان العام الأساسي أو null إن تعذّر. */
export function publicBaseUrl(env: PublicUrlEnv = process.env, headers: PublicUrlHeaders = {}): string | null {
  return resolvePublicUrl(env, headers).baseUrl;
}
