/**
 * المهندس المشرف — الطبقة الاستباقية (2026-10-28): كشف الأعطال قبل أن يراها المالك.
 *
 * سجل الأعطال يرى ما وقع؛ الإصلاح الذاتي يعالجه. هذه الطبقة تسبق الاثنين:
 *   1. **الفحص الاستباقي للشاشات** (`PROBE_ROUTES`): كل 10 دقائق يفتح المهندس — بالمسار الحقيقي
 *      وبجلسة مالك قصيرة — المسارات التي تغذّي شاشات المالك. أي 5xx أو بطء يُسجَّل عطلاً ويُعالج
 *      قبل أن يضغط المالك الزر. مسارات قراءة داخلية فقط (لا نداء مزوّد، لا حصة، لا كتابة).
 *   2. **قياس زمن كل مسار** (`RouteLatency`): p50/p95 لكل مسار من الطلبات الحقيقية؛ مسار يتباطأ
 *      يُنذَر به قبل أن تنتهي مهلته.
 *   3. **التوقعات** (`buildForecasts`): متى تنتهي صلاحية رمز، متى تمتلئ مجموعة، متى تبلغ الذاكرة
 *      حدّها، متى تنفد حصة، أي عطل يتصاعد — مع الإجراء قبل الوقوع.
 *   4. **نظافة التنبيهات** (`notificationHygiene`): مئات الإشعارات غير المقروءة تُغرق الحرج. القديم
 *      المعلوماتي والمكرر يُعلَّم مقروءاً (لا حذف)، فيبقى ما يحتاج المالك فعلاً ظاهراً.
 *   5. **فحص ما بعد النشر** (`deployVerdict`): بعد كل نسخة جديدة جولة فحص كاملة وحكم صريح.
 *
 * منطق صافٍ مختبر؛ لا شبكة ولا أسرار هنا.
 */

export interface ProbeRoute {
  path: string;
  label: string;
  /** الشاشة التي تعتمد عليه (للتقرير). */
  screen: string;
}

/**
 * مسارات القراءة التي تغذّي شاشات المالك — كلها داخلية (لا نداء لأي مزوّد خارجي ولا حصة)،
 * تحققتُ من كل معالج أنه يقرأ من حالة الخادم فقط. لا يُضاف هنا مسار يكتب أو يتصل بمزوّد.
 */
export const PROBE_ROUTES: readonly ProbeRoute[] = Object.freeze([
  { path: '/api/health', label: 'صحة الخادم', screen: 'مراقبة النظام' },
  { path: '/api/readiness', label: 'جاهزية الخادم', screen: 'مراقبة النظام' },
  { path: '/api/auth/me', label: 'جلسة الدخول', screen: 'كل الشاشات' },
  { path: '/api/live/room?lite=1', label: 'غرفة العقل الحية', screen: 'غرفة العقل الحية' },
  { path: '/api/engineer', label: 'المهندس المشرف', screen: 'غرفة العقل الحية' },
  { path: '/api/system/alerts', label: 'تنبيهات النظام', screen: 'مركز القيادة' },
  { path: '/api/notifications?unread=1', label: 'الإشعارات', screen: 'مركز السيطرة' },
  { path: '/api/social/manager/escalations', label: 'الحالات المصعّدة', screen: 'مركز السيطرة' },
  { path: '/api/commercial/inbox', label: 'صندوق الزبائن', screen: 'صندوق الزبائن' },
  { path: '/api/workspace/snapshot', label: 'بيانات المعرض والمنتجات', screen: 'المنتجات والأسعار' },
  { path: '/api/control/sales-readiness', label: 'جاهزية البيع', screen: 'مركز القيادة' },
  { path: '/api/analytics/overview', label: 'النتائج والتحليلات', screen: 'النتائج والتحليلات' },
  { path: '/api/platforms/five-readiness', label: 'جاهزية المنصات', screen: 'مركز ربط المنصات' },
  { path: '/api/agent/youtube/watcher', label: 'مراقب يوتيوب', screen: 'مدير تشغيل YouTube' },
  { path: '/api/agent/meta/watcher', label: 'مراقب فيسبوك/إنستغرام', screen: 'مركز السيطرة' },
  { path: '/api/agent/telegram/watcher', label: 'مراقب تيليغرام', screen: 'مركز السيطرة' },
  { path: '/api/agent/youtube/quota', label: 'حصة يوتيوب', screen: 'مدير تشغيل YouTube' },
  { path: '/api/brain/recommendations', label: 'توصيات العقل', screen: 'العقل المركزي' },
]);

export const PROACTIVE_POLICY = Object.freeze({
  probeIntervalMs: 10 * 60000,
  /** أول جولة بعد الإقلاع (فحص ما بعد النشر). */
  firstProbeAfterBootMs: 3 * 60000,
  /** فحص يتجاوز هذا الزمن «بطيء» (المالك يرى الشاشة معلّقة). */
  slowProbeMs: 8000,
  latencySamples: 60,
  slowP95Ms: 5000,
  /** عطل يتكرر هذا العدد خلال النافذة = يتصاعد. */
  spikeCount: 5,
  spikeWindowMs: 10 * 60000,
  /** إشعار معلوماتي غير مقروء أقدم من هذا يُعلَّم مقروءاً (بلا حذف). */
  hygieneInfoAgeMs: 7 * 86400000,
  /** تحذير غير مقروء أقدم من هذا يُعلَّم مقروءاً. الحرج لا يُلمس أبداً. */
  hygieneWarningAgeMs: 21 * 86400000,
});

// -----------------------------------------------------------------------------
// نتائج الفحص الاستباقي
// -----------------------------------------------------------------------------
export interface ProbeResult { path: string; label: string; screen: string; status: number; ms: number; at: string; ok: boolean; slow: boolean; detail: string }

export function evaluateProbe(route: ProbeRoute, r: { status: number; ms: number; detail?: string }, nowMs: number): ProbeResult {
  const ok = r.status > 0 && r.status < 500;
  const slow = ok && r.ms >= PROACTIVE_POLICY.slowProbeMs;
  return {
    path: route.path, label: route.label, screen: route.screen, status: r.status, ms: Math.round(r.ms), at: new Date(nowMs).toISOString(), ok, slow,
    detail: !ok ? (r.detail || `أجاب ${r.status || 'لا شيء'}`) : slow ? `بطيء: ${(r.ms / 1000).toFixed(1)} ث` : `${r.status} في ${Math.round(r.ms)}ms`,
  };
}

export interface ProbeRound { at: string; trigger: 'schedule' | 'deploy' | 'manual'; version: string | null; results: ProbeResult[]; ok: number; failed: number; slow: number }

export function summarizeRound(results: ProbeResult[], trigger: ProbeRound['trigger'], version: string | null, nowMs: number): ProbeRound {
  return { at: new Date(nowMs).toISOString(), trigger, version, results, ok: results.filter((r) => r.ok && !r.slow).length, failed: results.filter((r) => !r.ok).length, slow: results.filter((r) => r.slow).length };
}

/** حكم فحص ما بعد النشر: نسخة جديدة سليمة أم أدخلت عطلاً (مع مقارنة الجولة السابقة إن وُجدت). */
export function deployVerdict(round: ProbeRound, previous: ProbeRound | null): { ok: boolean; summary: string; regressions: string[] } {
  const prevOk = new Set((previous?.results || []).filter((r) => r.ok).map((r) => r.path));
  const regressions = round.results.filter((r) => !r.ok && (previous ? prevOk.has(r.path) : true)).map((r) => `${r.label} (${r.detail})`);
  const total = round.results.length;
  if (!round.failed) return { ok: true, summary: `النسخة ${round.version || 'الجديدة'} سليمة: ${total}/${total} شاشة تعمل${round.slow ? ` (${round.slow} بطيئة)` : ''}.`, regressions: [] };
  return {
    ok: false,
    summary: `النسخة ${round.version || 'الجديدة'}: ${round.failed} من ${total} شاشة تفشل${regressions.length && previous ? ` — ${regressions.length} كانت تعمل قبل النشر` : ''}.`,
    regressions,
  };
}

// -----------------------------------------------------------------------------
// زمن كل مسار (من الطلبات الحقيقية)
// -----------------------------------------------------------------------------
export class RouteLatency {
  private samples = new Map<string, Array<{ ms: number; err: boolean; t: number }>>();
  record(route: string, ms: number, status: number, nowMs = Date.now()): void {
    if (!route) return;
    const list = this.samples.get(route) || [];
    list.push({ ms, err: status >= 500, t: nowMs });
    if (list.length > PROACTIVE_POLICY.latencySamples) list.splice(0, list.length - PROACTIVE_POLICY.latencySamples);
    this.samples.set(route, list);
    if (this.samples.size > 300) { const first = this.samples.keys().next().value; if (first) this.samples.delete(first); }
  }
  summary(minSamples = 5): Array<{ route: string; n: number; p50: number; p95: number; errors: number }> {
    const out: Array<{ route: string; n: number; p50: number; p95: number; errors: number }> = [];
    for (const [route, list] of this.samples) {
      if (list.length < minSamples) continue;
      const sorted = list.map((x) => x.ms).sort((a, b) => a - b);
      const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
      out.push({ route, n: list.length, p50: Math.round(q(0.5)), p95: Math.round(q(0.95)), errors: list.filter((x) => x.err).length });
    }
    return out.sort((a, b) => b.p95 - a.p95);
  }
}

/** مسار يتباطأ (p95 فوق الحد): يُنذر به قبل أن تنتهي مهلته عند المالك. */
export function slowRoutes(summary: ReturnType<RouteLatency['summary']>): Array<{ route: string; p95: number; n: number }> {
  return summary.filter((s) => s.p95 >= PROACTIVE_POLICY.slowP95Ms && !/wait=1|\/dr\/|backup|upload|oauth/i.test(s.route)).map((s) => ({ route: s.route, p95: s.p95, n: s.n }));
}

/** عطل يتصاعد: تكرّر spikeCount مرات خلال النافذة. */
export function isSpiking(times: number[], nowMs: number): boolean {
  return times.filter((t) => nowMs - t <= PROACTIVE_POLICY.spikeWindowMs).length >= PROACTIVE_POLICY.spikeCount;
}

// -----------------------------------------------------------------------------
// التوقعات: ما سيقع إن لم يُفعل شيء
// -----------------------------------------------------------------------------
export interface Forecast {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  /** بعد كم ساعة يقع (إن أمكن الحساب). */
  etaHours: number | null;
  /** ماذا يُفعل الآن، ومن. */
  action: string;
  owner: 'engineer' | 'owner' | 'developer';
}

export interface ForecastInput {
  nowMs: number;
  platforms: Array<{ id: string; label: string; connected: boolean; expiresAt: string | null; refreshable: boolean }>;
  collections: Array<{ key: string; label: string; size: number; cap: number; growthPerDay: number | null }>;
  memory: { mb: number; limitMb: number; slopeMbPerHour: number | null };
  youtubeQuota: { usedPercent: number | null; resetInHours: number | null } | null;
  gemini: { used: number; limit: number; hoursLeftInDay: number; hoursElapsed: number } | null;
  slow: Array<{ route: string; p95: number }>;
  spiking: Array<{ title: string; count10m: number }>;
  backup: { ageHours: number | null; intervalHours: number } | null;
}

const H = 3600000;
const fmtH = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} دقيقة` : h < 48 ? `${Math.round(h)} ساعة` : `${Math.round(h / 24)} يوم`);

export function buildForecasts(f: ForecastInput): Forecast[] {
  const out: Forecast[] = [];
  for (const p of f.platforms) {
    if (!p.connected || !p.expiresAt) continue;
    const hours = (Date.parse(p.expiresAt) - f.nowMs) / H;
    if (!Number.isFinite(hours) || hours > 10 * 24) continue;
    if (p.refreshable) continue; // يُجدَّد تلقائياً (يوتيوب) — لا إنذار
    out.push({
      id: `token:${p.id}`, severity: hours <= 48 ? 'critical' : 'warning', etaHours: Math.max(0, hours), owner: 'owner',
      title: hours <= 0 ? `رمز ${p.label} انتهى` : `رمز ${p.label} ينتهي بعد ${fmtH(hours)}`,
      detail: 'عند انتهائه تتوقف قراءة التعليقات والنشر والرد على هذه المنصة فجأة.',
      action: `أعد ربط ${p.label} من «مركز ربط المنصات» قبل الانتهاء (دقيقة واحدة).`,
    });
  }
  for (const c of f.collections) {
    if (!c.growthPerDay || c.growthPerDay <= 0) continue;
    const days = (c.cap - c.size) / c.growthPerDay;
    if (days > 45) continue;
    out.push({
      id: `cap:${c.key}`, severity: days < 7 ? 'critical' : 'warning', etaHours: Math.max(0, days * 24), owner: 'developer',
      title: `${c.label} تبلغ سقفها بعد ${fmtH(days * 24)}`,
      detail: `${c.size} من ${c.cap} وتنمو ${Math.round(c.growthPerDay)} يومياً؛ عند السقف يُقصّ الأقدم بصمت.`,
      action: 'أرشفة الأقدم إلى جدول مستقل قبل السقف (تعديل كود — مهندس الكود).',
    });
  }
  if (f.memory.slopeMbPerHour != null && f.memory.slopeMbPerHour > 2) {
    const hrs = (f.memory.limitMb - f.memory.mb) / f.memory.slopeMbPerHour;
    if (hrs < 24) out.push({
      id: 'memory', severity: hrs < 4 ? 'critical' : 'warning', etaHours: Math.max(0, hrs), owner: 'developer',
      title: `ذاكرة الخادم تبلغ حدّها بعد ${fmtH(hrs)}`,
      detail: `${f.memory.mb} من ${f.memory.limitMb} ميغا وتزيد ${f.memory.slopeMbPerHour.toFixed(1)} ميغا/ساعة — عند الحد ينهار الخادم ويُعاد تشغيله.`,
      action: 'تسرّب محتمل: مهندس الكود يراجع آخر تغيير؛ إعادة النشر تؤجّل الانهيار فقط.',
    });
  }
  if (f.youtubeQuota && f.youtubeQuota.usedPercent != null && f.youtubeQuota.usedPercent >= 70 && f.youtubeQuota.resetInHours != null && f.youtubeQuota.resetInHours > 2) {
    out.push({
      id: 'youtube-quota', severity: f.youtubeQuota.usedPercent >= 90 ? 'critical' : 'warning', etaHours: null, owner: 'engineer',
      title: `حصة يوتيوب ${Math.round(f.youtubeQuota.usedPercent)}% والتجدد بعد ${fmtH(f.youtubeQuota.resetInHours)}`,
      detail: 'إن نفدت توقفت القراءة والرد والنشر على يوتيوب حتى التجدد.',
      action: 'المهندس يبطّئ الأعمال الثقيلة تلقائياً (حارس الضغط)؛ تجنّب رفع فيديو جديد قبل التجدد.',
    });
  }
  if (f.gemini && f.gemini.limit > 0 && f.gemini.hoursElapsed >= 2) {
    const rate = f.gemini.used / f.gemini.hoursElapsed;
    const projected = f.gemini.used + rate * f.gemini.hoursLeftInDay;
    if (projected > f.gemini.limit && f.gemini.used < f.gemini.limit) {
      const hrs = (f.gemini.limit - f.gemini.used) / Math.max(rate, 0.0001);
      out.push({
        id: 'gemini-quota', severity: hrs < 3 ? 'warning' : 'info', etaHours: hrs, owner: 'engineer',
        title: `حصة Gemini تنفد بعد ${fmtH(hrs)} بهذا المعدل`,
        detail: `${f.gemini.used}/${f.gemini.limit} اليوم. بعدها يعمل المحتوى بالبديل الحتمي (أضعف) حتى الغد.`,
        action: 'المسارات الحتمية لا تستهلك الحصة؛ أجّل التوليد غير العاجل للغد.',
      });
    }
  }
  for (const s of f.slow) out.push({
    id: `slow:${s.route}`, severity: s.p95 >= 12000 ? 'critical' : 'warning', etaHours: null, owner: 'developer',
    title: `${s.route} يتباطأ (p95 ${(s.p95 / 1000).toFixed(1)} ث)`,
    detail: 'شاشة تعتمد عليه ستبدو معلّقة، وقد تنتهي مهلتها فيرى المالك فشلاً.',
    action: 'مهندس الكود يحسّن المسار (عمل ثقيل متزامن أو استعلام بلا حد).',
  });
  for (const s of f.spiking) out.push({
    id: `spike:${s.title}`, severity: 'critical', etaHours: 0, owner: 'engineer',
    title: `عطل يتصاعد: ${s.title}`,
    detail: `تكرر ${s.count10m} مرات خلال 10 دقائق — ليس حادثة عابرة.`,
    action: 'المهندس يعالجه الآن بأولوية؛ إن كان عيب كود يُحال فوراً.',
  });
  if (f.backup && f.backup.ageHours != null && f.backup.ageHours > f.backup.intervalHours * 2) out.push({
    id: 'backup-age', severity: f.backup.ageHours > 24 ? 'critical' : 'warning', etaHours: 0, owner: 'engineer',
    title: `آخر نسخة احتياطية قبل ${fmtH(f.backup.ageHours)}`,
    detail: 'كارثة الآن تعني فقدان كل ما بعد تلك النسخة.',
    action: 'المهندس يشغّل دورة النسخ.',
  });
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.etaHours ?? 1e9) - (b.etaHours ?? 1e9));
}

// -----------------------------------------------------------------------------
// نظافة التنبيهات
// -----------------------------------------------------------------------------
export interface HygieneNotification { id: string; read?: boolean; severity?: string; type?: string; title?: string; createdAt?: string; userId?: string | null }

/**
 * ما يُعلَّم مقروءاً (لا يُحذف شيء): معلوماتي أقدم من 7 أيام، تحذير أقدم من 21 يوماً، والمكرر
 * (نفس النوع والعنوان) يبقى أحدثه فقط. **الحرج لا يُلمس أبداً** — قراره للمالك وحده.
 */
export function notificationHygiene(rows: HygieneNotification[], nowMs: number): { ids: string[]; old: number; duplicates: number } {
  const P = PROACTIVE_POLICY;
  const ids = new Set<string>();
  let old = 0, duplicates = 0;
  const seen = new Set<string>();
  const unread = rows.filter((n) => n && !n.read && n.severity !== 'critical' && (!n.userId || n.userId === 'owner'))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  for (const n of unread) {
    const age = nowMs - Date.parse(String(n.createdAt || ''));
    const limit = n.severity === 'warning' ? P.hygieneWarningAgeMs : P.hygieneInfoAgeMs;
    if (Number.isFinite(age) && age > limit) { ids.add(n.id); old += 1; continue; }
    const key = `${n.type || ''}|${String(n.title || '').trim()}`;
    if (seen.has(key)) { ids.add(n.id); duplicates += 1; } else seen.add(key);
  }
  return { ids: [...ids], old, duplicates };
}
