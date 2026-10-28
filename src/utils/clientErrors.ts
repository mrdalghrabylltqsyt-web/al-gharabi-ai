/**
 * إبلاغ المهندس المشرف بأعطال الواجهة الحقيقية (2026-10-28).
 *
 * ما يراه المالك كـ«الشاشة بيضاء» أو «الزر لا يعمل» أو «تعذّر…» يقع في المتصفح، ولم يكن
 * الخادم يعلم به أبداً. هنا تُلتقط ثلاثة أشياء فقط وتُرسل للمهندس:
 *   1. انهيار شاشة (React ErrorBoundary)،
 *   2. خطأ JavaScript غير ملتقط أو وعد مرفوض،
 *   3. طلب /api لم يصل للخادم أصلاً (502–504: الخادم نائم/متوقف/يُعاد نشره).
 * بلا أي بيانات زبون: الرسالة + الموضع فقط، بسقف 10 تقارير/دقيقة، وتكرار نفس الرسالة يُرسل مرة.
 */
const TOKEN_KEY = 'algharabi_auth_token';
const sent = new Map<string, number>();
let windowStart = 0;
let windowCount = 0;

export function reportClientError(message: string, where?: string | null, frame?: string | null): void {
  try {
    const msg = String(message || '').slice(0, 300);
    if (!msg) return;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return; // قبل الدخول لا يوجد من يُبلَّغ
    const now = Date.now();
    const key = `${msg}|${where || ''}`;
    if ((sent.get(key) || 0) > now - 10 * 60000) return;
    if (now - windowStart > 60000) { windowStart = now; windowCount = 0; }
    if (++windowCount > 10) return;
    sent.set(key, now);
    if (sent.size > 200) sent.clear();
    void nativeFetch('/api/engineer/client-error', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: msg, where: where || location.hash || location.pathname, frame: frame || null }),
    }).catch(() => undefined);
  } catch { /* الإبلاغ لا يكسر الواجهة أبداً */ }
}

/** أول إطار مفيد من المكدّس (ملف:سطر) بلا المكدّس كاملاً. */
export function firstFrame(stack?: string | null): string | null {
  const line = String(stack || '').split('\n').slice(1).find((l) => /\.(tsx?|jsx?):\d+/.test(l));
  return line ? line.trim().replace(/^at\s+/, '').slice(0, 140) : null;
}

let nativeFetch: typeof fetch = (input, init) => fetch(input, init);

/** يُستدعى مرة واحدة عند الإقلاع. */
export function installClientErrorReporting(): void {
  if (typeof window === 'undefined' || (window as any).__gharabiErrorsInstalled) return;
  (window as any).__gharabiErrorsInstalled = true;
  nativeFetch = window.fetch.bind(window);
  window.addEventListener('error', (e) => {
    if (!e?.message) return;
    reportClientError(`${e.error?.name || 'Error'}: ${e.message}`, null, firstFrame(e.error?.stack) || (e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : null));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r: any = e?.reason;
    // رفض طلب شبكة (انقطاع الإنترنت) ليس عيباً في الكود.
    if (r?.name === 'AbortError' || /Failed to fetch|NetworkError|Load failed/i.test(String(r?.message || r))) return;
    reportClientError(`${r?.name || 'Rejection'}: ${r?.message || String(r)}`, null, firstFrame(r?.stack));
  });
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await nativeFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      const path = (() => { try { return new URL(url, location.origin).pathname; } catch { return String(url); } })();
      // 500 يراه الخادم نفسه ويسجّله بتفاصيل أدق؛ الواجهة تبلّغ فقط عن 502–504 (الخادم لم يُجب أصلاً).
      if (res.status >= 502 && res.status <= 504 && path.startsWith('/api/') && path !== '/api/engineer/client-error') {
        reportClientError(`api ${res.status} ${path}`, path, null);
      }
    } catch { /* تجاهل */ }
    return res;
  };
}
