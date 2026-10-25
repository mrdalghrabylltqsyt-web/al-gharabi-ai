/**
 * صحة النشر على المنصات المتصلة — هل ينشر الموظف فعلاً، أم يفشل بصمت؟
 *
 * الجذر: سجل النشر (publishRecords) يحفظ كل نجاح/فشل بسببه الحقيقي من المزود، لكن
 * لا شيء يقرؤه ويعرضه للمالك: منصة متصلة قد تفشل في كل نشر (صلاحية ناقصة، رمز
 * منتهٍ، وسائط مطلوبة) والمالك يرى «متصل ✓» فقط. وفي سجل الخادم لم يكن أي سطر
 * يثبت نشراً ناجحاً أو فاشلاً، فتعذّر التحقق من الإنتاج.
 *
 * هذه الوحدة صافية (بلا شبكة ولا أسرار ولا نص منشور): تلخّص السجل لكل منصة متصلة،
 * وتترجم سبب الفشل إلى إجراء محدد، وتبني سطر سجل منظّم لكل محاولة نشر.
 */

export interface PublishHealthRecordInput {
  platform?: string;
  state?: string;
  executedAt?: string;
  providerPostId?: string | null;
  error?: string | null;
  code?: string | null;
  providerCode?: number | null;
  simulated?: boolean;
}

export interface PublishHealthPlatform {
  platform: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailure: { code: string | null; providerCode: number | null; error: string } | null;
  /** إخفاقات متتالية منذ آخر نجاح (الأحدث أولاً). */
  consecutiveFailures: number;
  successes7d: number;
  failures7d: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SUCCESS_STATES = new Set(['published', 'scheduled']);

function ts(v: unknown): number | null {
  const t = Date.parse(String(v ?? ''));
  return Number.isFinite(t) ? t : null;
}

/** يلخّص سجل النشر لكل منصة مطلوبة. السجلات المحاكاة تُتجاهل؛ «قيد النشر» محايد. */
export function summarizePublishHealth(records: PublishHealthRecordInput[], platforms: string[], nowMs: number): PublishHealthPlatform[] {
  const rows = (Array.isArray(records) ? records : [])
    .filter((r) => r && !r.simulated && r.platform && ts(r.executedAt) !== null)
    .map((r) => ({ r, t: ts(r.executedAt) as number }))
    .sort((a, b) => b.t - a.t);
  return platforms.map((platform) => {
    const mine = rows.filter((x) => x.r.platform === platform);
    let lastSuccessAt: string | null = null;
    let lastFailureAt: string | null = null;
    let lastFailure: PublishHealthPlatform['lastFailure'] = null;
    let consecutiveFailures = 0;
    let streakOpen = true;
    let successes7d = 0;
    let failures7d = 0;
    for (const { r, t } of mine) {
      const ok = SUCCESS_STATES.has(String(r.state)) && Boolean(r.providerPostId);
      const failed = String(r.state) === 'failed';
      const recent = nowMs - t <= 7 * DAY_MS;
      if (ok) {
        if (!lastSuccessAt) lastSuccessAt = new Date(t).toISOString();
        if (recent) successes7d += 1;
        streakOpen = false;
      } else if (failed) {
        if (!lastFailureAt) {
          lastFailureAt = new Date(t).toISOString();
          lastFailure = { code: r.code ?? null, providerCode: r.providerCode ?? null, error: String(r.error || 'فشل بلا سبب مُعاد من المزود.').slice(0, 160) };
        }
        if (recent) failures7d += 1;
        if (streakOpen) consecutiveFailures += 1;
      }
    }
    return { platform, lastSuccessAt, lastFailureAt, lastFailure, consecutiveFailures, successes7d, failures7d };
  });
}

/** يترجم سبب فشل النشر إلى من يصلحه وكيف — بلا تخمين خارج الأكواد المعروفة. */
export function publishFailureHint(platformName: string, failure: { code: string | null; providerCode: number | null; error: string }): { actor: 'owner' | 'system'; action: string } {
  const code = String(failure.code || '').toUpperCase();
  const pc = failure.providerCode;
  const text = `${code} ${failure.error}`;
  if (pc === 190 || /REAUTH|TOKEN_EXPIRED|INVALID_GRANT|expired|Session has expired/i.test(text)) {
    return { actor: 'owner', action: `انتهى تفويض ${platformName}: أعد الربط من مركز ربط المنصات ثم أعد النشر.` };
  }
  if (pc === 10 || (pc !== null && pc >= 200 && pc < 300) || /PERMISSION|SCOPE|not authorized|permission/i.test(text)) {
    return { actor: 'owner', action: `صلاحية النشر ناقصة لدى ${platformName}: امنح صلاحية النشر للتطبيق في لوحة المزود ثم أعد الربط.` };
  }
  if (/MEDIA_REQUIRED|9007|media|وسائط|فيديو|صورة/i.test(text)) {
    return { actor: 'owner', action: `${platformName} يحتاج صورة أو فيديو مع المنشور: أرفق الوسائط من مركز المحتوى ثم أعد النشر.` };
  }
  if (/TEXT_TOO_LONG/.test(code)) {
    return { actor: 'owner', action: 'النص أطول من حد المنصة: استخدم النسخة المختصرة المقترحة ثم أعد النشر.' };
  }
  if (/QUOTA|quotaExceeded|rate ?limit|RATE_LIMIT/i.test(text) || pc === 4 || pc === 17 || pc === 32) {
    return { actor: 'system', action: 'حدّ المزود المؤقت: يُعاد النشر بعد تجدّد الحصة؛ لا إجراء مطلوب الآن.' };
  }
  return { actor: 'owner', action: `افتح سجل النشر لـ ${platformName} لقراءة السبب الكامل، ثم أعد المحاولة.` };
}

/** نتيجة محاولة نشر من استجابة المنفّذ الموحّد (للسجل). */
export function publishOutcomeOf(result: { status: number; body: any }): 'published' | 'pending' | 'blocked' | 'rejected' | 'failed' {
  const b = result?.body || {};
  if (result?.status === 200) return b.pendingRetry === true || b.delivered === false ? 'pending' : 'published';
  if (/IDEMPOTENT|DUPLICATE/.test(String(b.code || ''))) return 'blocked';
  if (result?.status === 409 || result?.status === 422 || result?.status === 501 || result?.status === 503) return 'rejected';
  return 'failed';
}

function safeToken(v: unknown, max = 60): string {
  const s = String(v ?? '').replace(/[^A-Za-z0-9_:.\-]/g, '').slice(0, max);
  return s || '-';
}

/**
 * سطر سجل منظّم لكل محاولة نشر — يثبت من سجلات Render أن النشر يعمل (أو سبب فشله)
 * بلا نص المنشور ولا أي رمز. معرّف المنشور لدى المزود عام أصلاً (رابط المنشور).
 */
export function formatPublishLogLine(platform: string, result: { status: number; body: any }, ms: number): string {
  const b = result?.body || {};
  const providerPostId = b.providerPostId || b.providerPublishId || b.externalVideoId || b.record?.providerPostId || null;
  return [
    '[publish]',
    `platform=${safeToken(platform, 20)}`,
    `outcome=${publishOutcomeOf(result)}`,
    `status=${Number(result?.status) || 0}`,
    `providerPostId=${safeToken(providerPostId)}`,
    `code=${safeToken(b.code, 40)}`,
    `providerCode=${b.providerCode ?? '-'}`,
    `ms=${Math.max(0, Math.round(ms))}`,
  ].join(' ');
}
