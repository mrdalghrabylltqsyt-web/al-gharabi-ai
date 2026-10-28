/**
 * المهندس المشرف (2026-10-26) — منطق صافٍ قابل للاختبار.
 *
 * ليس مطوّراً ولا يضيف شيئاً: وظيفته الوحيدة إبقاء ما بُني يعمل. يرصد كل دقيقة من حالة
 * الخادم الحقيقية (بلا شبكة)، وإن تعطّل قسم «يتحرك» إليه وينفّذ إصلاحاً آمناً معروفاً
 * (إعادة تسليح مؤقّت، تشغيل دورة متوقفة عبر مشغّلها نفسه، إعادة محاولة حفظ، نسخة متأخرة،
 * تجديد رمز)، ثم **يتحقق** أن العطل زال فعلاً، ويكتب تقريراً كاملاً.
 *
 * قواعد ثابتة لا تُكسر (مفروضة هنا وفي كتيّب الخادم):
 *  1. لا يغيّر قرار المالك أبداً: الموقوف عمداً (Kill Switch/إيقاف طارئ/تعطيل) ليس عطلاً.
 *  2. لا حذف بيانات، لا تغيير مخطط/إعدادات/أسرار، لا نشر ولا تراجع عن كود، لا إعادة تشغيل للعملية.
 *  3. ما يحتاج قرار المالك (إعادة ربط منصة، إذن ناقص) يُصعَّد إليه — لا يُحاوَل.
 *  4. حدود صارمة: 3 محاولات لكل عطل بتباعد متزايد، ثم تصعيد وتهدئة 6 ساعات؛ وسقف 12 إجراء/ساعة.
 *  5. الإصلاح الثقيل لا يعمل تحت ضغط الخطة المجانية (يُؤجَّل ويُعلَن).
 *  6. مهمة واحدة في كل مرة (العنكبوت في مكان واحد)، بمهلة لكل خطوة.
 */

export type EngineerModule =
  | 'core' | 'owner' | 'auth' | 'agents' | 'platforms' | 'external' | 'gate' | 'automation'
  | 'backup' | 'monitor' | 'storage' | 'memory' | 'products' | 'customers';

export type IncidentSeverity = 'warning' | 'critical';
export type IncidentKind =
  | 'cycle_stale' | 'persist_failing' | 'storage_down' | 'backup_stale'
  | 'meta_read_failing' | 'youtube_errors' | 'memory_high' | 'loop_lag' | 'patrol_fix'
  /** عطل حقيقي من سجل الأعطال (defectLedger) له خطة إصلاح. */
  | 'defect_fix';

export interface Incident {
  key: string;
  kind: IncidentKind;
  module: EngineerModule;
  severity: IncidentSeverity;
  title: string;
  evidence: string[];
  /** لا إصلاح آلي ممكن/مسموح: يحتاج قرار المالك (يُصعَّد مباشرة). */
  needsOwner?: string | null;
  /** للمراقبة فقط (لا إجراء آمن): يُبلَّغ بتقرير. */
  observeOnly?: boolean;
  /** إصلاح ثقيل يُؤجَّل تحت ضغط الخطة. */
  heavy?: boolean;
  /** مفتاح فرعي (دورة/منصة) للكتيّب. */
  target?: string;
  /** تهدئة خاصة بعد التصعيد/المراقبة (الافتراضي 6 س) — عطل إعداد لا يتغيّر بالساعة يُذكَّر به أقل. */
  cooldownMs?: number;
}

export interface EngineerSnapshot {
  nowMs: number;
  storageReady: boolean;
  persistFailStreak: number;
  persistFailingSince: string | null;
  cycles: Array<{ key: string; label: string; cadenceMs: number | null; lastRunAt: string | null; active: boolean; deferred: boolean }>;
  backup: { configured: boolean; level: 'ok' | 'warning' | 'critical' | null; running: boolean; lastSuccessAt: string | null; consecutiveFailures: number };
  metaFailing: Array<{ platform: string; code: string | null; streak: number }>;
  youtube: { connected: boolean; consecutiveErrors: number; lastError: string | null };
  memoryMb: number;
  limitMb: number;
  loopLagMs: number;
}

const CYCLE_MODULE: Record<string, EngineerModule> = {
  youtube: 'automation', meta: 'automation', telegram: 'automation', brain: 'agents', commercial: 'customers', metrics: 'memory',
};
const HEAVY_CYCLES = new Set(['brain', 'commercial', 'metrics']);
/** رموز تعني أن الإصلاح بيد المالك (صلاحية/رمز ملغى) لا بيد المهندس. */
const OWNER_CODES = new Set(['190', '10', '200', 'invalid_grant', 'AUTH', 'UNAUTHORIZED', 'TOKEN_REVOKED', 'REAUTH_REQUIRED']);

function missed(lastRunAt: string | null, cadenceMs: number | null, nowMs: number): number {
  if (!lastRunAt || !cadenceMs || cadenceMs <= 0) return 0;
  const t = Date.parse(lastRunAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / cadenceMs));
}

/**
 * الرصد: من لقطة حالة حقيقية إلى قائمة أعطال. `streaks` يحفظ عدد الفحوص المتتالية لمؤشرات
 * متذبذبة (الذاكرة/التأخّر) فلا يُعلن عطل من قراءة واحدة.
 */
export function detectIncidents(s: EngineerSnapshot, streaks: Record<string, number>): Incident[] {
  const out: Incident[] = [];
  if (!s.storageReady) {
    out.push({ key: 'storage_down', kind: 'storage_down', module: 'storage', severity: 'critical', title: 'قاعدة البيانات غير جاهزة', evidence: ['المخزن لم يكتمل تهيئته — لا كتابة ممكنة'], needsOwner: 'تحقق من DATABASE_URL وحالة Neon — لا يُعاد تهيئة الاتصال آلياً حمايةً للبيانات' });
  } else if (s.persistFailStreak >= 2) {
    out.push({ key: 'persist_failing', kind: 'persist_failing', module: 'storage', severity: 'critical', title: 'فشل حفظ البيانات', evidence: [`${s.persistFailStreak} محاولات حفظ فاشلة متتالية`, s.persistFailingSince ? `منذ ${s.persistFailingSince}` : ''].filter(Boolean) });
  }
  for (const c of s.cycles) {
    if (!c.active || c.deferred) continue; // الموقوف بقرار المالك أو المؤجَّل المُعلَن ليس عطلاً
    const m = missed(c.lastRunAt, c.cadenceMs, s.nowMs);
    if (m > 2) {
      out.push({
        key: `cycle_stale:${c.key}`, kind: 'cycle_stale', target: c.key, module: CYCLE_MODULE[c.key] || 'core',
        severity: m >= 6 ? 'critical' : 'warning', title: `${c.label} متوقف عن العمل`, heavy: HEAVY_CYCLES.has(c.key),
        evidence: [`آخر دورة ${c.lastRunAt}`, `فاتته ${m} دورات (الإيقاع كل ${Math.round((c.cadenceMs || 0) / 60000)} د)`],
      });
    }
  }
  if (s.backup.configured && s.backup.level && s.backup.level !== 'ok' && !s.backup.running) {
    out.push({
      key: 'backup_stale', kind: 'backup_stale', module: 'backup', severity: s.backup.level === 'critical' ? 'critical' : 'warning', heavy: true,
      title: 'النسخة الاحتياطية متأخرة', evidence: [`آخر نسخة ناجحة ${s.backup.lastSuccessAt || 'لا توجد'}`, s.backup.consecutiveFailures ? `${s.backup.consecutiveFailures} فشل متتالٍ` : ''].filter(Boolean),
    });
  }
  for (const f of s.metaFailing) {
    const code = String(f.code || '');
    out.push({
      key: `meta_read_failing:${f.platform}`, kind: 'meta_read_failing', target: f.platform, module: 'platforms', severity: 'warning',
      title: `قراءة تعليقات ${f.platform} متعثّرة`, evidence: [`${f.streak} دورات فاشلة متتالية`, code ? `الرمز ${code}` : ''].filter(Boolean),
      needsOwner: OWNER_CODES.has(code) ? 'الصلاحية أو الرمز ملغى/ناقص — أعد ربط المنصة من «مركز ربط المنصات»' : null,
    });
  }
  if (s.youtube.connected && s.youtube.consecutiveErrors >= 3) {
    const code = String(s.youtube.lastError || '');
    out.push({
      key: 'youtube_errors', kind: 'youtube_errors', module: 'external', severity: s.youtube.consecutiveErrors >= 6 ? 'critical' : 'warning',
      title: 'مراقب يوتيوب يفشل', evidence: [`${s.youtube.consecutiveErrors} أخطاء متتالية`, code ? `آخر خطأ ${code}` : ''].filter(Boolean),
      needsOwner: OWNER_CODES.has(code) ? 'رمز يوتيوب ملغى — أعد ربط يوتيوب' : null,
    });
  }
  const memHigh = s.limitMb > 0 && s.memoryMb >= s.limitMb * 0.85;
  streaks.memory = memHigh ? (streaks.memory || 0) + 1 : 0;
  if (streaks.memory >= 3) {
    out.push({ key: 'memory_high', kind: 'memory_high', module: 'monitor', severity: s.memoryMb >= s.limitMb * 0.95 ? 'critical' : 'warning', observeOnly: true, title: 'ذاكرة الخادم قرب الحد', evidence: [`${s.memoryMb} من ${s.limitMb} ميغا لثلاثة فحوص متتالية`] });
  }
  const lagHigh = s.loopLagMs >= 400;
  streaks.lag = lagHigh ? (streaks.lag || 0) + 1 : 0;
  if (streaks.lag >= 3) {
    out.push({ key: 'loop_lag', kind: 'loop_lag', module: 'monitor', severity: 'warning', observeOnly: true, title: 'الخادم بطيء الاستجابة', evidence: [`تأخّر حلقة الأحداث ${s.loopLagMs}ms لثلاثة فحوص`] });
  }
  return out;
}

// -----------------------------------------------------------------------------
// السياسة والتقارير
// -----------------------------------------------------------------------------
export const ENGINEER_POLICY = Object.freeze({
  maxAttempts: 3,
  backoffMs: [2 * 60000, 10 * 60000, 30 * 60000] as readonly number[],
  cooldownAfterEscalateMs: 6 * 3600000,
  maxActionsPerHour: 12,
  stepTimeoutMs: 120000,
  maxReports: 60,
});

export type ReportStatus = 'resolved' | 'escalated' | 'deferred' | 'retrying' | 'monitoring' | 'self_recovered';
export interface ReportStep { at: string; label: string; ok: boolean; detail: string }
export interface EngineerReport {
  id: string;
  incidentKey: string;
  kind: IncidentKind;
  module: EngineerModule;
  severity: IncidentSeverity;
  title: string;
  evidence: string[];
  attempt: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: ReportStatus;
  steps: ReportStep[];
  verification: string;
  summary: string;
  nextAction: string | null;
}

export interface IncidentMemory { attempts: number; lastAttemptAt: number | null; escalatedAt: number | null; firstSeenAt: number }
export interface EngineerState {
  enabled: boolean;
  /** خط أساس السعة: أول قياس لحجم كل مجموعة (لحساب معدل النمو اليومي). يُجدَّد كل 7 أيام. */
  baseline: Record<string, { t: number; v: number }>;
  /** آخر تنبيه للمالك لكل فحص (لا تكرار قبل 12 ساعة). */
  notified: Record<string, number>;
  incidents: Record<string, IncidentMemory>;
  reports: EngineerReport[];
  actions: number[];
  checks: number;
  lastCheckAt: string | null;
}

export function emptyEngineerState(): EngineerState {
  return { enabled: true, baseline: {}, notified: {}, incidents: {}, reports: [], actions: [], checks: 0, lastCheckAt: null };
}

/** تحميل آمن من المخزن (أي حقل تالف يُستبدل بالافتراضي). */
export function normalizeEngineerState(raw: any): EngineerState {
  const base = emptyEngineerState();
  if (!raw || typeof raw !== 'object') return base;
  const reports = Array.isArray(raw.reports) ? raw.reports.filter((r: any) => r && typeof r.id === 'string').slice(0, ENGINEER_POLICY.maxReports) : [];
  const incidents: Record<string, IncidentMemory> = {};
  if (raw.incidents && typeof raw.incidents === 'object') {
    for (const [k, v] of Object.entries(raw.incidents as Record<string, any>)) {
      if (!v || typeof v !== 'object') continue;
      incidents[k] = { attempts: Number(v.attempts) || 0, lastAttemptAt: Number.isFinite(v.lastAttemptAt) ? v.lastAttemptAt : null, escalatedAt: Number.isFinite(v.escalatedAt) ? v.escalatedAt : null, firstSeenAt: Number(v.firstSeenAt) || Date.now() };
    }
  }
  const numMap = (o: any) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, v]) => Number.isFinite(v as number))) as Record<string, number>;
  const baseline: Record<string, { t: number; v: number }> = {};
  for (const [k, v] of Object.entries(raw.baseline && typeof raw.baseline === 'object' ? raw.baseline : {})) { const b: any = v; if (b && Number.isFinite(b.t) && Number.isFinite(b.v)) baseline[k] = { t: b.t, v: b.v }; }
  return { enabled: raw.enabled !== false, baseline, notified: numMap(raw.notified), incidents, reports, actions: Array.isArray(raw.actions) ? raw.actions.filter((x: any) => Number.isFinite(x)).slice(-50) : [], checks: Number(raw.checks) || 0, lastCheckAt: typeof raw.lastCheckAt === 'string' ? raw.lastCheckAt : null };
}

const SEV_RANK: Record<IncidentSeverity, number> = { critical: 0, warning: 1 };

export type Decision =
  | { kind: 'repair'; incident: Incident }
  | { kind: 'escalate'; incident: Incident; reason: string }
  | { kind: 'observe'; incident: Incident }
  | { kind: 'defer'; incident: Incident; reason: string }
  | { kind: 'wait' };

/**
 * يختار المهمة التالية للعنكبوت (مهمة واحدة). الأخطر أولاً، مع احترام التباعد والتهدئة
 * والسقف الساعي وضغط الخطة. يُرجع `wait` إن لم يكن هناك ما يُفعل الآن.
 */
export function decideNext(state: EngineerState, incidents: Incident[], nowMs: number, opts: { pressureCritical: boolean }): Decision {
  const P = ENGINEER_POLICY;
  const recentActions = state.actions.filter((t) => nowMs - t < 3600000).length;
  const sorted = incidents.slice().sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  for (const inc of sorted) {
    const mem = state.incidents[inc.key];
    const cool = inc.cooldownMs ?? P.cooldownAfterEscalateMs;
    if (mem?.escalatedAt && nowMs - mem.escalatedAt < cool) continue; // صُعِّد — تهدئة
    if (inc.needsOwner) return { kind: 'escalate', incident: inc, reason: inc.needsOwner };
    if (inc.observeOnly) {
      if (mem?.lastAttemptAt && nowMs - mem.lastAttemptAt < cool) continue;
      return { kind: 'observe', incident: inc };
    }
    const attempts = mem?.attempts || 0;
    if (attempts >= P.maxAttempts) return { kind: 'escalate', incident: inc, reason: `فشل الإصلاح الآلي ${attempts} مرات` };
    const wait = P.backoffMs[Math.min(attempts, P.backoffMs.length - 1)];
    if (attempts > 0 && mem?.lastAttemptAt && nowMs - mem.lastAttemptAt < wait) continue;
    if (inc.heavy && opts.pressureCritical) {
      if (mem?.lastAttemptAt && nowMs - mem.lastAttemptAt < P.backoffMs[0]) continue;
      return { kind: 'defer', incident: inc, reason: 'إصلاح ثقيل مؤجَّل: الخطة المجانية تحت ضغط حرج' };
    }
    if (recentActions >= P.maxActionsPerHour) return { kind: 'wait' };
    return { kind: 'repair', incident: inc };
  }
  return { kind: 'wait' };
}

/** ينسى الأعطال التي زالت (تعافت) ويُرجع مفاتيح ما تعافى بعد محاولة منا (لتقرير «تعافى»). */
export function forgetRecovered(state: EngineerState, activeKeys: Set<string>): string[] {
  const recovered: string[] = [];
  for (const k of Object.keys(state.incidents)) {
    if (activeKeys.has(k)) continue;
    if ((state.incidents[k].attempts || 0) > 0 && !state.incidents[k].escalatedAt) recovered.push(k);
    delete state.incidents[k];
  }
  return recovered;
}

export function addReport(state: EngineerState, r: EngineerReport): void {
  state.reports.unshift(r);
  if (state.reports.length > ENGINEER_POLICY.maxReports) state.reports.length = ENGINEER_POLICY.maxReports;
}

/** خطوة بمهلة: لا تعلق مهمة العنكبوت أبداً. */
export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: any;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`انتهت مهلة «${label}» (${Math.round(ms / 1000)} ث)`)), ms); if (t?.unref) t.unref(); });
  try { return await Promise.race([p, timeout]); } finally { clearTimeout(t); }
}

/** أعطال قابلة للإصلاح الآمن مصدرها الدورية (ما لا يغطيه الرصد الأساسي). */
export function incidentsFromPatrol(checks: Array<{ id: string; module: EngineerModule; label: string; status: string; detail: string; repair?: string | null }>): Incident[] {
  const out: Incident[] = [];
  for (const c of checks) {
    if (c.repair === 'drafts_expired' && (c.status === 'warn' || c.status === 'fail')) {
      out.push({ key: 'patrol_fix:drafts_expired', kind: 'patrol_fix', target: 'drafts_expired', module: c.module, severity: 'warning', title: c.label, evidence: [c.detail] });
    }
  }
  return out;
}

/**
 * أعطال سجل الأعطال ⇒ مهام للمهندس. ما له إصلاح تشغيلي يُصلَح ويُتحقَّق منه؛ ما بيد المالك
 * يُصعَّد مرة كل 3 أيام بالإجراء الدقيق؛ عيب الكود يُحال لمهندس الكود (مراقبة بلا إزعاج).
 */
export function incidentsFromDefects(defects: Array<{ fp: string; kind: string; severity: 'critical' | 'warning'; title: string; samples: string[]; plan: { action: string; instructions?: string } }>): Incident[] {
  const moduleOf = (kind: string): EngineerModule => (kind === 'config' || kind === 'provider' ? 'platforms' : kind === 'performance' ? 'monitor' : 'core');
  return defects.map((d) => {
    const base: Incident = {
      key: `defect:${d.fp}`, kind: 'defect_fix', target: d.fp, module: moduleOf(d.kind), severity: d.severity,
      title: d.title, evidence: [d.samples[0] || d.title].filter(Boolean),
    };
    if (d.plan.action === 'owner') return { ...base, needsOwner: d.plan.instructions || 'يحتاج إجراءك', cooldownMs: 72 * 3600000 };
    if (d.plan.action === 'developer') return { ...base, observeOnly: true, cooldownMs: 72 * 3600000 };
    if (d.plan.action === 'rerun_backup' || d.plan.action === 'rerun_metrics') return { ...base, heavy: true };
    return base;
  });
}
