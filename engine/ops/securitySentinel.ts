/**
 * الحارس الأمني للمهندس المشرف (2026-10-29) — منطق صافٍ قابل للاختبار.
 *
 * يرى المهندس الآن محاولات الاختراق لحظة وقوعها، لا الأعطال فقط:
 *   - فاحصو الثغرات (طلب /.env، /.git، wp-admin، phpMyAdmin، ملفات .php…)،
 *   - اجتياز المسارات (../) وحقن SQL/سكربت في الرابط،
 *   - محاولة سحب حزمة المصدر المحجوبة،
 *   - تخمين الدخول (رموز تحقق خاطئة متتالية، بلوغ حد المحاولات)،
 *   - أحداث webhook بتوقيع مزوّر.
 * ويحكم: هادئ / استطلاع / هجوم، ويحظر مؤقتاً **المصدر الذي لا يمكن تزويره فقط** (عنوان الاتصال
 * المباشر بالخادم)، بمدة تتضاعف مع التكرار (ساعة ← 24 ساعة كحد أقصى).
 *
 * قواعد الأمان (لا يضرّ المالك أبداً):
 *   - لا يُحظر عنوان داخلي/خاص/loopback (فحوص المهندس الداخلية، فحص صحة Render).
 *   - لا يُحظر طلب يمرّ عبر وكيل Netlify: عنوان الاتصال هنا هو عقدة Netlify المشتركة بين كل الزوار،
 *     والعنوان الذي يذكره الوكيل يمكن تزويره بطلب مباشر — فيُسجَّل ويُنذر به فقط. هذا يمنع
 *     أيضاً «تلفيق» عنوان المالك لحظره.
 *   - أحداث webhook المزوّرة لا تحظر أبداً (قد تكون Meta نفسها بسرّ خاطئ): تُسجَّل ويُنذر بها مع السبب المرجّح.
 *   - العنوان الذي دخل منه المالك بنجاح «موثوق» 30 يوماً ولا يُحظر.
 *   - العناوين الخام لا تُعرض: الواجهة ترى عنواناً مقنّعاً (a.b.*.*) وبصمة قصيرة فقط.
 * لا شبكة، لا ساعة (الزمن يُمرَّر)، لا أسرار.
 */
import { createHash } from 'node:crypto';

export type SecurityEventKind =
  | 'scanner' | 'traversal' | 'injection' | 'source_probe'
  | 'auth_fail' | 'auth_limited' | 'webhook_forged';

export type SecurityLevel = 'calm' | 'probing' | 'attack';

export const SECURITY_KIND_AR: Readonly<Record<SecurityEventKind, string>> = Object.freeze({
  scanner: 'فحص ثغرات (مسارات معروفة للاختراق)',
  traversal: 'محاولة اجتياز مسارات (../)',
  injection: 'محاولة حقن (SQL/سكربت) في الرابط',
  source_probe: 'محاولة سحب حزمة المصدر المحجوبة',
  auth_fail: 'دخول فاشل',
  auth_limited: 'بلوغ حد محاولات الدخول',
  webhook_forged: 'حدث webhook بتوقيع غير صحيح',
});

/** وزن كل نوع في «درجة الخطورة» لمصدر واحد. webhook لا يدخل في قرار الحظر. */
export const SECURITY_WEIGHTS: Readonly<Record<SecurityEventKind, number>> = Object.freeze({
  scanner: 1, traversal: 3, injection: 3, source_probe: 2, auth_fail: 0.5, auth_limited: 2, webhook_forged: 0,
});

export const SENTINEL_POLICY = Object.freeze({
  /** نافذة حساب درجة المصدر. */
  windowMs: 10 * 60 * 1000,
  /** درجة الحظر داخل النافذة (مثلاً 6 مسارات فحص، أو 2 اجتياز، أو 12 دخولاً فاشلاً). */
  blockScore: 6,
  /** مدة الحظر الأول، وتتضاعف مع كل تكرار للمصدر نفسه. */
  baseBlockMs: 60 * 60 * 1000,
  maxBlockMs: 24 * 60 * 60 * 1000,
  /** العنوان الذي دخل منه المالك موثوق هذه المدة. */
  trustMs: 30 * 24 * 60 * 60 * 1000,
  /** نافذة «المستوى» (هادئ/استطلاع/هجوم). */
  levelWindowMs: 60 * 60 * 1000,
  /** درجة إجمالية في ساعة تُعدّ هجوماً حتى بلا حظر (موزّع/عبر الوكيل). */
  attackScore: 30,
  /** webhook مزوّر بهذا العدد في ساعة = إنذار. */
  forgedWebhookAlert: 5,
  maxEvents: 400,
  maxSources: 2000,
  /** أيام العدّادات اليومية المحفوظة. */
  keepDays: 14,
});

// ─────────────────────────────────────────────────────────────────────────────
// هوية المصدر (عنوان IP حقيقي لا يُزوَّر حيث أمكن)
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientIdentityInput {
  /** X-Forwarded-For كما وصل (Render يُلحق عنوان من اتصل به في آخره). */
  forwardedFor?: string | string[] | null;
  /** عنوان المقبس (req.socket.remoteAddress). */
  socketIp?: string | null;
  /** ترويسات وكيل Netlify (x-nf-client-connection-ip / x-nf-request-id) — قابلة للتزوير بطلب مباشر. */
  nfClientIp?: string | null;
  nfRequestId?: string | null;
  /** Host وX-Forwarded-Host: اختلافهما يعني أن وسيطاً (Netlify) مرّر الطلب. */
  host?: string | null;
  forwardedHost?: string | null;
}
export interface ClientIdentity {
  /** العنوان المنسوب إليه الطلب (لمفاتيح حدود المحاولات والإحصاء). */
  ip: string;
  /** عنوان الاتصال المباشر بالخادم — لا يمكن تزويره. */
  edge: string;
  /** يدّعي المرور عبر وكيل Netlify. */
  viaProxy: boolean;
  /** هل يجوز حظره؟ (اتصال مباشر من عنوان عام فقط). */
  blockable: boolean;
  /** عنوان داخلي (loopback/خاص): فحوص المهندس الداخلية وفحص صحة المنصة — لا يُسجَّل. */
  internal: boolean;
}

export function normalizeIp(raw: unknown): string {
  let s = String(raw ?? '').trim().replace(/^"|"$/g, '');
  if (!s) return '';
  if (s.startsWith('[')) s = s.slice(1, s.indexOf(']') > 0 ? s.indexOf(']') : undefined); // [v6]:port
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(s)) s = s.slice(7);
  const v4port = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(s);
  if (v4port) s = v4port[1];
  if (!/^[0-9a-f:.]+$/i.test(s) || s.length > 45) return '';
  return s.toLowerCase();
}

export function isInternalIp(ip: string): boolean {
  const s = normalizeIp(ip);
  if (!s) return true;
  if (s === '::1' || s === '::' || s.startsWith('127.') || s === '0.0.0.0') return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return /^(fc|fd|fe80)/i.test(s);
}

export function resolveClientIdentity(input: ClientIdentityInput): ClientIdentity {
  const raw = Array.isArray(input.forwardedFor) ? input.forwardedFor.join(',') : String(input.forwardedFor || '');
  const chain = raw.split(',').map(normalizeIp).filter(Boolean);
  const socket = normalizeIp(input.socketIp);
  const edge = chain.length ? chain[chain.length - 1] : socket || 'unknown';
  // أي وسيط قبل الحافة (ترويسات Netlify، أو سلسلة X-Forwarded-For من أكثر من عنوان) يجعل عنوان الحافة
  // عقدة وسيط مشتركة لا زائراً واحداً ⇒ لا حظر عليها. من يضيف سلسلة مزيّفة يتهرّب من الحظر فقط (يبقى مرصوداً)
  // ولا يستطيع أبداً تلفيق حظر لعنوان غيره.
  const fwdHost = String(input.forwardedHost || '').split(',')[0].trim().toLowerCase();
  const host = String(input.host || '').split(',')[0].trim().toLowerCase();
  const viaProxy = Boolean(String(input.nfRequestId || '').trim() || String(input.nfClientIp || '').trim()) || chain.length >= 2 || Boolean(fwdHost && host && fwdHost !== host);
  const claimed = normalizeIp(input.nfClientIp) || (chain.length >= 2 ? chain[chain.length - 2] : '');
  const ip = viaProxy && claimed ? claimed : edge;
  const internal = edge === 'unknown' || (isInternalIp(edge) && !viaProxy);
  return { ip, edge, viaProxy, blockable: !viaProxy && !internal && edge !== 'unknown', internal };
}

/** عرض آمن للعنوان: لا يُعرض الخام أبداً. */
export function maskIp(ip: string): string {
  const s = normalizeIp(ip);
  if (!s) return 'غير معروف';
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(s);
  if (v4) return `${v4[1]}.${v4[2]}.*.*`;
  const parts = s.split(':').filter(Boolean);
  return `${parts.slice(0, 3).join(':')}:*`;
}
/** بصمة قصيرة ثابتة للربط بين الأحداث دون كشف العنوان. */
export function ipFingerprint(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}|${normalizeIp(ip)}`).digest('hex').slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// تصنيف الطلب: هل هو فحص ثغرات؟
// ─────────────────────────────────────────────────────────────────────────────

const SCANNER_RES: RegExp[] = [
  /(^|\/)\.(env|git|svn|hg|aws|ssh|docker|kube|npmrc|bash_history|htaccess|htpasswd|ds_store|vscode|idea)(\/|$|\.|\?)/i,
  /(^|\/)(wp-admin|wp-login|wp-content|wp-includes|wp-json|xmlrpc\.php|wordpress)(\/|$|\?|\.)/i,
  /\.(php\d?|asp|aspx|jsp|jspx|cgi|pl|bak|sql|old|swp|ini|cfg|conf|env|log)(\?|$|\/)/i,
  /(^|\/)(phpmyadmin|pma|adminer|mysql|myadmin|cgi-bin|vendor\/phpunit|eval-stdin|actuator|server-status|solr|jenkins|manager\/html|boaform|hnap1|setup\.cgi|shell|cmd|telescope|_ignition|debug\/default|owa|ecp|autodiscover|remote\/login|sdk|containers\/json)(\/|$|\?|\.)/i,
  /(etc\/passwd|proc\/self|win\.ini|boot\.ini)/i,
];
const TRAVERSAL_RE = /(\.\.\/|\.\.\\|%2e%2e|\.\.%2f|%2e\.\/|\.%2e\/|%252e)/i;
const INJECTION_RE = /(union(\s|%20|\+)+select|information_schema|sleep\(\s*\d|benchmark\(|<script|%3cscript|javascript:|onerror=|'\s*or\s*'1'\s*=\s*'1|%27(\s|%20|\+)*or(\s|%20|\+)|\$\{jndi:|%24%7bjndi)/i;

/** مسار التطبيق المشروع لا يُصنّف أبداً (يحمي شاشات المالك وملفات تحقق TikTok وغيرها). */
const LEGIT_RE = /^\/(api\/(?!.*\.(php|asp|aspx|jsp|cgi)(\?|$))|assets\/[\w.-]+\.(js|css|png|jpg|jpeg|svg|webp|woff2?|ico|json|map)$|tiktok[\w-]*\.txt$|favicon|robots\.txt$|manifest|sitemap|terms|privacy|$)/i;

/**
 * يصنّف طلباً من مساره ورابطه الخام. `blockedSource` = نتيجة حارس حزمة المصدر في الخادم.
 * يُرجع null للطلب العادي.
 */
export function classifyRequest(input: { path: string; rawUrl?: string; blockedSource?: boolean }): SecurityEventKind | null {
  const p = String(input.path || '');
  const raw = String(input.rawUrl || p);
  if (input.blockedSource) return 'source_probe';
  if (TRAVERSAL_RE.test(raw)) return 'traversal';
  if (INJECTION_RE.test(raw)) return 'injection';
  if (LEGIT_RE.test(p.split('?')[0])) return null;
  for (const re of SCANNER_RES) if (re.test(p)) return 'scanner';
  return null;
}

/** حكم استجابة مسار حساس بعد انتهائه (دخول/webhook). */
export function classifyResponse(input: { method: string; path: string; status: number }): SecurityEventKind | null {
  const p = String(input.path || '');
  const st = Number(input.status) || 0;
  // محاولات الدخول = طلبات POST فقط (‏/api/auth/me بلا جلسة يرجع 401 لكل زائر عادي ولا يُعدّ هجوماً).
  if (/^\/api\/auth\//.test(p) && String(input.method).toUpperCase() === 'POST') {
    if (st === 429) return 'auth_limited';
    if (st === 401 || st === 403) return 'auth_fail';
    return null;
  }
  if (String(input.method).toUpperCase() === 'POST' && /\/webhook(s\/[\w-]+)?$/.test(p) && (st === 401 || st === 403)) return 'webhook_forged';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// الحارس
// ─────────────────────────────────────────────────────────────────────────────

export interface SecurityEvent { at: number; kind: SecurityEventKind; fp: string; masked: string; path: string; viaProxy: boolean }
interface SourceState { fp: string; masked: string; ip: string; blockable: boolean; events: Array<{ at: number; w: number }>; offenses: number; blockedUntil: number; firstAt: number; lastAt: number; total: number; kinds: Partial<Record<SecurityEventKind, number>> }

export interface SentinelPersist {
  v: 1;
  blocks: Array<{ ip: string; masked: string; fp: string; until: number; offenses: number; reason: string }>;
  trusted: Array<{ ip: string; until: number }>;
  daily: Record<string, Partial<Record<SecurityEventKind, number>>>;
  totalBlocks: number;
}

export interface SentinelSummary {
  level: SecurityLevel;
  levelText: string;
  since: string;
  last24h: Partial<Record<SecurityEventKind, number>>;
  lastHourScore: number;
  daily: Array<{ day: string; total: number; byKind: Partial<Record<SecurityEventKind, number>> }>;
  activeBlocks: Array<{ fp: string; masked: string; until: string; offenses: number; reason: string }>;
  totalBlocks: number;
  topSources: Array<{ fp: string; masked: string; total: number; viaProxyOnly: boolean; kinds: Partial<Record<SecurityEventKind, number>>; lastAt: string; blocked: boolean }>;
  recent: Array<{ at: string; kind: SecurityEventKind; label: string; masked: string; fp: string; path: string; viaProxy: boolean }>;
  forgedWebhooks1h: number;
  advice: string[];
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clipPath = (s: string) => String(s || '').replace(/[\u0000-\u001f<>"'`]/g, '').slice(0, 90);

export class SecuritySentinel {
  private sources = new Map<string, SourceState>();
  private events: SecurityEvent[] = [];
  private trusted = new Map<string, number>();
  private daily: SentinelPersist['daily'] = {};
  private totalBlocks = 0;
  private readonly bootAt: number;
  constructor(private readonly salt: string, nowMs: number, restore?: SentinelPersist | null) {
    this.bootAt = nowMs;
    if (restore && restore.v === 1) {
      for (const b of restore.blocks || []) {
        if (!(b.until > nowMs)) continue;
        this.sources.set(b.ip, { fp: b.fp, masked: b.masked, ip: b.ip, blockable: true, events: [], offenses: b.offenses, blockedUntil: b.until, firstAt: nowMs, lastAt: nowMs, total: 0, kinds: {} });
      }
      for (const t of restore.trusted || []) if (t.until > nowMs) this.trusted.set(t.ip, t.until);
      this.daily = { ...(restore.daily || {}) };
      this.totalBlocks = Number(restore.totalBlocks || 0);
    }
  }

  /** المالك دخل بنجاح من هذا المصدر: لا يُحظر 30 يوماً، ويُرفع أي حظر عنه فوراً. */
  trust(id: ClientIdentity, nowMs: number): void {
    for (const ip of new Set([id.edge, id.ip])) {
      if (!ip || ip === 'unknown') continue;
      this.trusted.set(ip, nowMs + SENTINEL_POLICY.trustMs);
      const s = this.sources.get(ip); if (s) s.blockedUntil = 0;
    }
  }
  isTrusted(ip: string, nowMs: number): boolean { return (this.trusted.get(ip) || 0) > nowMs; }

  /** هل يُرفض هذا الطلب الآن؟ (المصدر المباشر المحظور فقط). */
  isBlocked(id: ClientIdentity, nowMs: number): boolean {
    if (!id.blockable) return false;
    const s = this.sources.get(id.edge);
    return Boolean(s && s.blockedUntil > nowMs && !this.isTrusted(id.edge, nowMs));
  }

  /**
   * يسجّل حدثاً. يُرجع ما تغيّر: `blocked` إن حُظر المصدر للتو (لتنبيه المالك والغرفة الحية).
   */
  record(kind: SecurityEventKind, id: ClientIdentity, path: string, nowMs: number): { blocked: boolean; until: number | null; score: number } {
    if (id.internal) return { blocked: false, until: null, score: 0 };
    const key = id.blockable ? id.edge : id.ip;
    let s = this.sources.get(key);
    if (!s) {
      if (this.sources.size >= SENTINEL_POLICY.maxSources) this.evictOldest(nowMs);
      s = { fp: ipFingerprint(key, this.salt), masked: maskIp(key), ip: key, blockable: id.blockable, events: [], offenses: 0, blockedUntil: 0, firstAt: nowMs, lastAt: nowMs, total: 0, kinds: {} };
      this.sources.set(key, s);
    }
    s.blockable = s.blockable && id.blockable;
    s.lastAt = nowMs; s.total += 1; s.kinds[kind] = (s.kinds[kind] || 0) + 1;
    s.events = s.events.filter((e) => nowMs - e.at <= SENTINEL_POLICY.windowMs);
    s.events.push({ at: nowMs, w: SECURITY_WEIGHTS[kind] });
    this.events.unshift({ at: nowMs, kind, fp: s.fp, masked: s.masked, path: clipPath(path), viaProxy: id.viaProxy });
    if (this.events.length > SENTINEL_POLICY.maxEvents) this.events.length = SENTINEL_POLICY.maxEvents;
    const d = dayOf(nowMs);
    const day = (this.daily[d] = this.daily[d] || {});
    day[kind] = (day[kind] || 0) + 1;
    this.pruneDaily(nowMs);
    const score = s.events.reduce((a, e) => a + e.w, 0);
    if (s.blockable && s.blockedUntil <= nowMs && score >= SENTINEL_POLICY.blockScore && !this.isTrusted(key, nowMs)) {
      const dur = Math.min(SENTINEL_POLICY.maxBlockMs, SENTINEL_POLICY.baseBlockMs * 2 ** s.offenses);
      s.offenses += 1;
      s.blockedUntil = nowMs + dur;
      s.events = [];
      this.totalBlocks += 1;
      return { blocked: true, until: s.blockedUntil, score };
    }
    return { blocked: false, until: null, score };
  }

  /** رفع كل الحظر (قرار المالك). يُرجع عدد ما رُفع. */
  unblockAll(nowMs: number): number {
    let n = 0;
    for (const s of this.sources.values()) if (s.blockedUntil > nowMs) { s.blockedUntil = 0; n += 1; }
    return n;
  }

  activeBlocks(nowMs: number): SourceState[] {
    return [...this.sources.values()].filter((s) => s.blockedUntil > nowMs && !this.isTrusted(s.ip, nowMs));
  }

  level(nowMs: number): SecurityLevel {
    const recent = this.events.filter((e) => nowMs - e.at <= SENTINEL_POLICY.levelWindowMs);
    const score = recent.reduce((a, e) => a + SECURITY_WEIGHTS[e.kind], 0);
    if (this.activeBlocks(nowMs).length || score >= SENTINEL_POLICY.attackScore) return 'attack';
    const forged = recent.filter((e) => e.kind === 'webhook_forged').length;
    const authFails = recent.filter((e) => e.kind === 'auth_fail' || e.kind === 'auth_limited').length;
    if (recent.some((e) => ['scanner', 'traversal', 'injection', 'source_probe'].includes(e.kind)) || forged >= SENTINEL_POLICY.forgedWebhookAlert || authFails >= 5) return 'probing';
    return 'calm';
  }

  /** لا شيء جديد بعد `sinceMs` ولا حظر قائم — سبب أي إنذار أمني قديم زال. */
  quietSince(sinceMs: number, nowMs: number): boolean {
    return this.level(nowMs) === 'calm' && this.activeBlocks(nowMs).length === 0 && !this.events.some((e) => e.at > sinceMs && SECURITY_WEIGHTS[e.kind] > 0);
  }

  summary(nowMs: number): SentinelSummary {
    const lvl = this.level(nowMs);
    const day = 86400000;
    const last24h: Partial<Record<SecurityEventKind, number>> = {};
    for (const e of this.events) if (nowMs - e.at <= day) last24h[e.kind] = (last24h[e.kind] || 0) + 1;
    const hourEvents = this.events.filter((e) => nowMs - e.at <= SENTINEL_POLICY.levelWindowMs);
    const lastHourScore = Math.round(hourEvents.reduce((a, e) => a + SECURITY_WEIGHTS[e.kind], 0) * 10) / 10;
    const forgedWebhooks1h = hourEvents.filter((e) => e.kind === 'webhook_forged').length;
    const blocks = this.activeBlocks(nowMs);
    const advice: string[] = [];
    if (blocks.length) advice.push(`حُظر ${blocks.length} مصدراً يفحص ثغرات — الحظر تلقائي ومؤقت ولا يمسّك.`);
    if (forgedWebhooks1h >= SENTINEL_POLICY.forgedWebhookAlert) advice.push('أحداث webhook بتوقيع خاطئ متكررة: إن كانت من Meta نفسها فسرّ التطبيق (META_APP_SECRET) في Render لا يطابق لوحة المطوّر؛ وإلا فهي محاولات تزوير مرفوضة.');
    if ((last24h.auth_limited || 0) > 0) advice.push('بُلغ حد محاولات الدخول — إن لم تكن أنت فهي محاولة تخمين وقد رُفضت.');
    if (lvl === 'calm') advice.push('لا محاولة اختراق في الساعة الأخيرة.');
    const top = [...this.sources.values()].filter((s) => s.total > 0).sort((a, b) => b.lastAt - a.lastAt).slice(0, 8);
    return {
      level: lvl,
      levelText: lvl === 'attack' ? 'هجوم نشط — الحارس يصدّه' : lvl === 'probing' ? 'استطلاع/فحص ثغرات — مرصود ومرفوض' : 'هادئ',
      since: new Date(this.bootAt).toISOString(),
      last24h, lastHourScore,
      daily: Object.keys(this.daily).sort().slice(-SENTINEL_POLICY.keepDays).map((d) => ({ day: d, byKind: this.daily[d], total: Object.values(this.daily[d]).reduce((a: number, b) => a + Number(b || 0), 0) })),
      activeBlocks: blocks.map((s) => ({ fp: s.fp, masked: s.masked, until: new Date(s.blockedUntil).toISOString(), offenses: s.offenses, reason: topKindText(s.kinds) })),
      totalBlocks: this.totalBlocks,
      topSources: top.map((s) => ({ fp: s.fp, masked: s.masked, total: s.total, viaProxyOnly: !s.blockable, kinds: { ...s.kinds }, lastAt: new Date(s.lastAt).toISOString(), blocked: s.blockedUntil > nowMs })),
      recent: this.events.slice(0, 25).map((e) => ({ at: new Date(e.at).toISOString(), kind: e.kind, label: SECURITY_KIND_AR[e.kind], masked: e.masked, fp: e.fp, path: e.path, viaProxy: e.viaProxy })),
      forgedWebhooks1h,
      advice,
    };
  }

  snapshot(nowMs: number): SentinelPersist {
    return {
      v: 1,
      blocks: this.activeBlocks(nowMs).map((s) => ({ ip: s.ip, masked: s.masked, fp: s.fp, until: s.blockedUntil, offenses: s.offenses, reason: topKindText(s.kinds) })),
      trusted: [...this.trusted.entries()].filter(([, u]) => u > nowMs).slice(-50).map(([ip, until]) => ({ ip, until })),
      daily: this.daily,
      totalBlocks: this.totalBlocks,
    };
  }

  private pruneDaily(nowMs: number) {
    const keys = Object.keys(this.daily).sort();
    const cutoff = dayOf(nowMs - SENTINEL_POLICY.keepDays * 86400000);
    for (const k of keys) if (k < cutoff) delete this.daily[k];
  }
  private evictOldest(nowMs: number) {
    let oldestKey: string | null = null, oldest = Infinity;
    for (const [k, s] of this.sources) if (s.blockedUntil <= nowMs && s.lastAt < oldest) { oldest = s.lastAt; oldestKey = k; }
    if (oldestKey) this.sources.delete(oldestKey);
  }
}

function topKindText(kinds: Partial<Record<SecurityEventKind, number>>): string {
  const e = Object.entries(kinds).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  return e ? `${SECURITY_KIND_AR[e[0] as SecurityEventKind]} ×${e[1]}` : '—';
}
