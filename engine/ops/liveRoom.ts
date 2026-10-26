/**
 * غرفة العقل الحية — منطق صافٍ (2026-10-25).
 *
 * يحوّل ما يجري فعلاً داخل الخادم (أسطر السجل المنظّمة، عمليات audit، استقبال تعليق،
 * مسودة رد…) إلى «أحداث حية» مصنّفة حسب أقسام المخطط الهندسي الثلاثة عشر + العقل
 * المركزي، ويبني حالة كل قسم من أرقام الخادم الحقيقية. لا شبكة، لا ساعة (الزمن يُمرَّر)،
 * لا أسرار: أسطر السجل المقبولة محصورة بقائمة بادئات معروفة، وكل نص يُقصّ.
 */

export type LiveModuleKey =
  | 'core' | 'owner' | 'auth' | 'agents' | 'platforms' | 'external' | 'gate' | 'automation'
  | 'backup' | 'monitor' | 'storage' | 'memory' | 'products' | 'customers';

export type LiveLevel = 'ok' | 'info' | 'warn' | 'error';

export interface LiveEventInput {
  module: LiveModuleKey;
  level: LiveLevel;
  title: string;
  text: string;
}

export interface LiveEvent extends LiveEventInput {
  id: number;
  at: string;
}

export const LIVE_MODULE_KEYS: readonly LiveModuleKey[] = Object.freeze([
  'owner', 'auth', 'agents', 'platforms', 'external', 'gate', 'automation',
  'backup', 'monitor', 'storage', 'memory', 'products', 'customers',
]);

const PLATFORM_AR: Record<string, string> = {
  facebook: 'فيسبوك', instagram: 'إنستغرام', youtube: 'يوتيوب', threads: 'ثريدز', tiktok: 'تيك توك',
  telegram: 'تيليغرام', whatsapp: 'واتساب', x: 'X', snapchat: 'سناب شات', google_business: 'Google Business',
};
export function platformAr(p: string): string { return PLATFORM_AR[String(p || '').toLowerCase()] || String(p || '—'); }

function clip(s: unknown, n = 160): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
}
function kv(line: string, key: string): string | null {
  const m = new RegExp(`(?:^|\\s)${key}=([^\\s]+)`).exec(line);
  return m ? m[1] : null;
}

/**
 * سطر سجل ⇒ حدث حي، أو null إن لم يكن من البادئات المعروفة (لا يُبث أي سطر عشوائي).
 */
export function classifyLogLine(raw: string): LiveEventInput | null {
  const line = clip(raw, 400);
  if (!line) return null;
  if (line.startsWith('[metrics]')) {
    if (kv(line, 'outcome') === 'deferred') return { module: 'memory', level: 'warn', title: 'مزامنة الأرقام مؤجّلة', text: 'بسبب ضغط استهلاك الخطة المجانية' };
    if (kv(line, 'outcome') === 'failed') return { module: 'memory', level: 'error', title: 'فشلت مزامنة الأرقام', text: clip(kv(line, 'issue') || kv(line, 'error')) };
    const p = kv(line, 'platform');
    if (!p) return null;
    const posts = Number(kv(line, 'posts') || 0), ok = Number(kv(line, 'withMetrics') || 0);
    const fol = kv(line, 'followers'); const err = kv(line, 'issue') || kv(line, 'error');
    const level: LiveLevel = posts > 0 && ok === 0 ? 'warn' : 'ok';
    return { module: 'memory', level, title: `أرقام ${platformAr(p)}`, text: `قيست ${ok} من ${posts}${fol && fol !== '-' ? ` — ${fol} متابع` : ''}${err && err !== '-' && ok < posts ? ` (رمز ${err})` : ''}` };
  }
  if (line.startsWith('[comments]')) {
    const p = platformAr(kv(line, 'platform') || '');
    const o = kv(line, 'outcome');
    if (o === 'recovered') return { module: 'customers', level: 'ok', title: `عادت قراءة تعليقات ${p}`, text: 'الاستقبال يعمل من جديد' };
    if (o === 'failed' || o === 'still_failing') return { module: 'customers', level: 'error', title: `قراءة تعليقات ${p} متعثّرة`, text: `رمز ${clip(kv(line, 'code'), 20)} — ${clip(kv(line, 'streak'), 6)} دورات` };
    return null;
  }
  if (line.startsWith('[publish]')) {
    const p = platformAr(kv(line, 'platform') || '');
    const o = kv(line, 'outcome') || '';
    const ok = o === 'published' || o === 'scheduled' || o === 'ok';
    return { module: 'platforms', level: ok ? 'ok' : o === 'blocked' ? 'warn' : 'error', title: ok ? `نُشر على ${p}` : `تعذّر النشر على ${p}`, text: ok ? `بمعرّف حقيقي من المنصة` : `السبب: ${clip(kv(line, 'code'), 40)}` };
  }
  if (line.startsWith('[dr-backup]')) {
    const o = kv(line, 'outcome');
    if (o === 'ok') return { module: 'backup', level: 'ok', title: 'نسخة احتياطية جديدة', text: `نقطة ${clip(kv(line, 'recoveryPoint'), 20)} على Google Drive` };
    if (o === 'failed') return { module: 'backup', level: 'error', title: 'فشل النسخ الاحتياطي', text: clip(kv(line, 'reason') || kv(line, 'state'), 80) };
    if (o === 'deferred') return { module: 'backup', level: 'warn', title: 'النسخ الاحتياطي مؤجّل', text: 'ضغط الخطة المجانية (بحد أقصى 24 ساعة)' };
    return null;
  }
  if (line.startsWith('[storage]')) {
    if (line.includes('tls verify=ok')) return { module: 'storage', level: 'ok', title: 'اتصال قاعدة البيانات', text: 'مشفّر وموثّق الشهادة' };
    if (line.includes('tls verify=failed')) return { module: 'storage', level: 'error', title: 'شهادة قاعدة البيانات رُفضت', text: clip(kv(line, 'code'), 40) };
    if (line.includes('state_writes')) return { module: 'storage', level: Number(kv(line, 'fail_streak') || 0) > 0 ? 'warn' : 'info', title: 'حفظ الحالة', text: `كتابات ${kv(line, 'written') || 0} · مدموجة ${kv(line, 'coalesced') || 0}` };
    if (line.includes('outcome=recovered')) return { module: 'storage', level: 'ok', title: 'عاد الحفظ يعمل', text: 'بعد فشل مؤقت' };
    return null;
  }
  if (line.startsWith('Could not persist')) return { module: 'storage', level: 'error', title: 'فشل حفظ البيانات', text: clip(line.replace(/^Could not persist[^:]*:/, ''), 60) };
  if (line.startsWith('[commercial]')) {
    const n = kv(line, 'drafts_refreshed');
    if (n) return { module: 'customers', level: 'info', title: 'تحسين ردود منتظرة', text: `${n} مسودة أُعيدت صياغتها من بيانات المعرض` };
    return null;
  }
  if (line.startsWith('[youtube] token_refreshed')) return { module: 'external', level: 'info', title: 'تجديد رمز يوتيوب', text: 'تلقائي' };
  if (line.includes('Server] running on')) return { module: 'monitor', level: 'ok', title: 'الخادم يعمل', text: 'إقلاع ناجح' };
  if (line.includes('received SIGTERM')) return { module: 'monitor', level: 'info', title: 'تبديل نسخة الخادم', text: 'نشر جديد — حفظ ما تبقّى قبل الإغلاق' };
  return null;
}

const AUDIT_MAP: Record<string, { module: LiveModuleKey; level: LiveLevel; title: string }> = {
  commercial_draft_refreshed: { module: 'customers', level: 'info', title: 'مسودة رد أدق' },
  commercial_draft_skipped: { module: 'customers', level: 'info', title: 'لا حاجة لرد (ردّت الصفحة)' },
  commercial_qualification_cleanup: { module: 'customers', level: 'info', title: 'تنظيف المسودات' },
  commercial_send_mode_changed: { module: 'gate', level: 'warn', title: 'تغيير وضع الإرسال' },
  commercial_kill_switch: { module: 'gate', level: 'warn', title: 'مفتاح الإيقاف الطارئ' },
  owner_alert_sent: { module: 'owner', level: 'info', title: 'تنبيه أُرسل لك' },
  login_success: { module: 'auth', level: 'ok', title: 'دخول المالك' },
  logout: { module: 'auth', level: 'info', title: 'خروج' },
  product_created: { module: 'products', level: 'ok', title: 'منتج جديد في المخزن' },
  product_updated: { module: 'products', level: 'info', title: 'تحديث منتج' },
  product_deleted: { module: 'products', level: 'warn', title: 'حذف منتج' },
  showroom_updated: { module: 'products', level: 'info', title: 'تحديث بيانات المعرض' },
  post_created: { module: 'owner', level: 'info', title: 'محتوى جديد' },
  post_status_changed: { module: 'gate', level: 'info', title: 'تغيّر حالة منشور' },
  platform_connected: { module: 'platforms', level: 'ok', title: 'ربط منصة' },
  platform_disconnected: { module: 'platforms', level: 'warn', title: 'فصل منصة' },
  jobs_preflight_all: { module: 'automation', level: 'info', title: 'فحص مهام النشر' },
};

/** عملية audit ⇒ حدث حي. عمليات القراءة الروتينية (بحث/عرض) لا تُبث. */
export function auditToLiveEvent(action: string, detail?: string | null): LiveEventInput | null {
  const a = String(action || '').trim();
  if (!a || /search|_view|_read|_list|snapshot/.test(a)) return null;
  const hit = AUDIT_MAP[a];
  const text = clip(detail && !/^\s*[{[]/.test(String(detail)) ? detail : '', 100);
  if (hit) return { ...hit, text };
  const module: LiveModuleKey = a.startsWith('commercial') ? 'customers'
    : a.startsWith('youtube') || a.startsWith('watcher') ? 'automation'
    : a.startsWith('dr_') || a.includes('backup') ? 'backup'
    : a.includes('publish') || a.startsWith('post') ? 'platforms'
    : a.includes('product') || a.includes('showroom') ? 'products'
    : a.includes('user') || a.includes('session') || a.includes('auth') || a.includes('otp') ? 'auth'
    : a.includes('brain') || a.includes('agent') || a.includes('team') ? 'agents'
    : 'core';
  return { module, level: 'info', title: `عملية: ${a.replace(/_/g, ' ')}`, text };
}

/** مخزن أحداث دائري في الذاكرة (لا كتابة للقاعدة): الأحدث آخراً، مع منع تكرار فوري. */
export class LiveEventBuffer {
  private events: LiveEvent[] = [];
  private nextId = 1;
  constructor(private readonly max = 300) {}
  push(input: LiveEventInput, atIso: string): LiveEvent | null {
    const last = this.events[this.events.length - 1];
    if (last && last.title === input.title && last.text === input.text && Date.parse(atIso) - Date.parse(last.at) < 3000) return null;
    const ev: LiveEvent = { id: this.nextId++, at: atIso, module: input.module, level: input.level, title: clip(input.title, 80), text: clip(input.text, 160) };
    this.events.push(ev);
    if (this.events.length > this.max) this.events.splice(0, this.events.length - this.max);
    return ev;
  }
  /** الأحداث بعد معرّف (للتحديث التدريجي)، أو آخر `limit` عند البدء. */
  since(id: number, limit = 40): LiveEvent[] {
    const after = Number.isFinite(id) && id > 0 ? this.events.filter((e) => e.id > id) : this.events;
    return after.slice(-limit);
  }
  get lastId(): number { return this.nextId - 1; }
}

export type ModuleStatus = 'ok' | 'partial' | 'off';
export interface LiveModuleView {
  key: LiveModuleKey;
  status: ModuleStatus;
  metric: string;
  items: Array<{ name: string; value: string; status: ModuleStatus | 'neutral' }>;
}

export interface LiveRoomInput {
  nowMs: number;
  platforms: Array<{ id: string; connected: boolean; partial?: string | null }>;
  pendingReplies: number;
  inbound: number;
  inquiries24h: number;
  leadsOpen: number;
  products: number;
  productsInStock: number;
  publishedPosts: number;
  measured: Array<{ platform: string; ok: number; total: number }>;
  followers: Record<string, number | null>;
  sendModeApproval: boolean;
  commercialEnabled: boolean;
  youtubeAutoReply: boolean;
  youtubeCycles: number;
  youtubeLastPollAt: string | null;
  metaLastPollAt: string | null;
  metaFailing: string[];
  brainCycles: number;
  brainLastSuccessAt: string | null;
  storageHealthy: boolean;
  tls: string | null;
  persistFailStreak: number;
  writesCoalesced: number;
  writesDone: number;
  backupLevel: 'ok' | 'warning' | 'critical' | null;
  backupLastSuccessAt: string | null;
  memoryMb: number;
  uptimeSec: number;
  geminiEnabled: boolean;
  ownerTelegram: boolean;
  ownerEmailAlerts: boolean;
  usagePressure: string;
}

function ago(iso: string | null, nowMs: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '—';
  const m = Math.max(0, Math.round((nowMs - t) / 60000));
  if (m < 1) return 'الآن';
  if (m < 60) return `قبل ${m} د`;
  const h = Math.round(m / 60);
  return h < 48 ? `قبل ${h} س` : `قبل ${Math.round(h / 24)} يوم`;
}

/** حالة الأقسام الثلاثة عشر من أرقام الخادم الحقيقية فقط. */
export function buildLiveModules(i: LiveRoomInput): Record<LiveModuleKey, LiveModuleView> {
  const conn = i.platforms.filter((p) => p.connected);
  const partial = conn.filter((p) => p.partial);
  const measuredOk = i.measured.reduce((a, m) => a + m.ok, 0);
  const measuredAll = i.measured.reduce((a, m) => a + m.total, 0);
  const st = (b: boolean, warn = false): ModuleStatus => (b ? (warn ? 'partial' : 'ok') : 'off');
  const views: Record<string, LiveModuleView> = {};
  views.core = { key: 'core', status: i.brainLastSuccessAt ? 'ok' : 'partial', metric: `دورات العقل ${i.brainCycles}`, items: [] };
  views.owner = {
    key: 'owner', status: i.pendingReplies > 0 ? 'partial' : 'ok',
    metric: i.pendingReplies > 0 ? `${i.pendingReplies} ردود تنتظر قرارك` : 'لا شيء ينتظرك',
    items: [
      { name: 'ردود بانتظار موافقتك', value: String(i.pendingReplies), status: i.pendingReplies ? 'partial' : 'ok' },
      { name: 'تنبيه البريد', value: i.ownerEmailAlerts ? 'مفعّل' : 'معطّل', status: i.ownerEmailAlerts ? 'ok' : 'partial' },
      { name: 'تنبيه Telegram الفوري', value: i.ownerTelegram ? 'مفعّل' : 'ينقصه الربط', status: i.ownerTelegram ? 'ok' : 'partial' },
      { name: 'المحتوى المنشور', value: `${i.publishedPosts} بمعرّف حقيقي`, status: 'neutral' },
    ],
  };
  views.auth = {
    key: 'auth', status: 'ok', metric: 'دخول برمز البريد + جلسات موقّعة',
    items: [
      { name: 'تحدّي بريد المالك', value: 'يعمل', status: 'ok' },
      { name: 'جلسات HMAC', value: 'تُبطَل عند الخروج', status: 'ok' },
      { name: 'RBAC + requireOwner', value: 'مفعّل', status: 'ok' },
      { name: 'حد محاولات الدخول', value: 'مفعّل', status: 'ok' },
    ],
  };
  views.agents = {
    key: 'agents', status: i.brainLastSuccessAt ? 'ok' : 'partial', metric: `آخر دورة ناجحة ${ago(i.brainLastSuccessAt, i.nowMs)}`,
    items: ['الإدراك والمعرفة', 'الجمهور والطلب', 'الاستراتيجية والقرار', 'العروض والمبيعات', 'التعلّم والتوقيت', 'الناقد'].map((n) => ({ name: n, value: 'ضمن الفريق', status: 'ok' as const })),
  };
  views.platforms = {
    key: 'platforms', status: conn.length === 0 ? 'off' : conn.length < i.platforms.length || partial.length ? 'partial' : 'ok',
    metric: `${conn.length} من ${i.platforms.length} متصلة · ${i.publishedPosts} منشوراً`,
    items: i.platforms.map((p) => ({
      name: platformAr(p.id),
      value: p.connected ? (p.partial ? `متصل — ${p.partial}` : `متصل${typeof i.followers[p.id] === 'number' ? ` · ${i.followers[p.id]} متابع` : ''}`) : 'غير مربوط',
      status: p.connected ? (p.partial ? 'partial' : 'ok') : 'off',
    })),
  };
  views.external = {
    key: 'external', status: partial.length ? 'partial' : 'ok', metric: `Gemini ${i.geminiEnabled ? 'مفعّل' : 'معطّل'} · ${partial.length} تحتاج صلاحية`,
    items: [
      { name: 'Gemini AI', value: i.geminiEnabled ? 'مفعّل' : 'معطّل', status: i.geminiEnabled ? 'ok' : 'partial' },
      { name: 'Google Drive', value: i.backupLastSuccessAt ? 'مربوط' : 'غير مؤكد', status: i.backupLastSuccessAt ? 'ok' : 'partial' },
      ...partial.map((p) => ({ name: platformAr(p.id), value: String(p.partial), status: 'partial' as const })),
    ],
  };
  views.gate = {
    key: 'gate', status: 'ok', metric: i.sendModeApproval ? 'لا إرسال بلا موافقتك' : 'إرسال تلقائي مفعّل',
    items: [
      { name: 'وضع الإرسال', value: i.sendModeApproval ? 'موافقة المالك' : 'تلقائي', status: i.sendModeApproval ? 'ok' : 'partial' },
      { name: 'العقل التجاري', value: i.commercialEnabled ? 'مفعّل' : 'موقوف (طوارئ)', status: i.commercialEnabled ? 'ok' : 'off' },
      { name: 'حارس الادعاءات', value: 'لا سعر/وعد غير مسجّل', status: 'ok' },
    ],
  };
  views.automation = {
    key: 'automation', status: i.youtubeAutoReply ? 'ok' : 'partial', metric: i.youtubeAutoReply ? 'الرد الآلي يعمل' : 'الرد الآلي على يوتيوب موقوف',
    items: [
      { name: 'مراقب يوتيوب', value: `${i.youtubeCycles} دورة · ${ago(i.youtubeLastPollAt, i.nowMs)}`, status: 'ok' },
      { name: 'مراقب فيسبوك/إنستغرام', value: ago(i.metaLastPollAt, i.nowMs), status: i.metaFailing.length ? 'partial' : 'ok' },
      { name: 'الرد الآلي', value: i.youtubeAutoReply ? 'يعمل' : 'موقوف بقرارك', status: i.youtubeAutoReply ? 'ok' : 'off' },
      { name: 'ضغط الاستهلاك', value: i.usagePressure, status: i.usagePressure === 'normal' ? 'ok' : 'partial' },
    ],
  };
  views.backup = {
    key: 'backup', status: i.backupLevel === 'ok' ? 'ok' : i.backupLevel ? 'partial' : 'off', metric: `آخر نسخة ${ago(i.backupLastSuccessAt, i.nowMs)}`,
    items: [
      { name: 'حداثة النسخة', value: i.backupLevel === 'ok' ? 'ضمن 6 ساعات' : i.backupLevel ? 'متأخرة' : 'لا نسخ', status: i.backupLevel === 'ok' ? 'ok' : 'partial' },
      { name: 'المكان', value: 'Google Drive مشفّرة', status: 'ok' },
    ],
  };
  views.monitor = {
    key: 'monitor', status: i.persistFailStreak || i.metaFailing.length ? 'partial' : 'ok', metric: `الذاكرة ${i.memoryMb} ميغا · يعمل منذ ${Math.round(i.uptimeSec / 60)} د`,
    items: [
      { name: 'الخادم', value: `يعمل · ${i.memoryMb}/512 ميغا`, status: i.memoryMb > 420 ? 'partial' : 'ok' },
      { name: 'قراءة التعليقات', value: i.metaFailing.length ? `متعثّرة: ${i.metaFailing.map(platformAr).join('، ')}` : 'سليمة', status: i.metaFailing.length ? 'partial' : 'ok' },
      { name: 'الحفظ', value: i.persistFailStreak ? `${i.persistFailStreak} فشل متتالٍ` : 'سليم', status: i.persistFailStreak ? 'off' : 'ok' },
    ],
  };
  views.storage = {
    key: 'storage', status: !i.storageHealthy || i.persistFailStreak ? 'off' : i.tls === 'verified' ? 'ok' : 'partial',
    metric: i.tls === 'verified' ? 'مشفّر وموثّق الشهادة' : 'اتصال بلا تحقق من الشهادة',
    items: [
      { name: 'الاتصال', value: i.tls === 'verified' ? 'TLS إلزامي' : String(i.tls || '—'), status: i.tls === 'verified' ? 'ok' : 'partial' },
      { name: 'كتابات منفّذة', value: String(i.writesDone), status: 'neutral' },
      { name: 'كتابات مدموجة (موفّرة)', value: String(i.writesCoalesced), status: 'ok' },
    ],
  };
  views.memory = {
    key: 'memory', status: measuredAll && measuredOk < measuredAll ? 'partial' : 'ok', metric: `${measuredOk} من ${measuredAll} منشوراً مقاساً`,
    items: i.measured.map((m) => ({ name: platformAr(m.platform), value: `${m.ok} / ${m.total}`, status: m.total === 0 ? 'neutral' : m.ok === m.total ? 'ok' : m.ok === 0 ? 'off' : 'partial' })),
  };
  views.products = {
    key: 'products', status: i.products > 0 ? 'ok' : 'off', metric: `${i.products} منتجاً · المتوفر ${i.productsInStock}`,
    items: [
      { name: 'المنتجات', value: String(i.products), status: 'ok' },
      { name: 'المتوفر', value: String(i.productsInStock), status: 'ok' },
    ],
  };
  views.customers = {
    key: 'customers', status: i.metaFailing.length ? 'partial' : 'ok', metric: `${i.inbound} تعليقاً ورسالة · ${i.inquiries24h} استفسار اليوم`,
    items: [
      { name: 'الوارد من المنصات', value: String(i.inbound), status: 'neutral' },
      { name: 'استفسارات آخر 24 ساعة', value: String(i.inquiries24h), status: 'neutral' },
      { name: 'زبائن محتملون مفتوحون', value: String(i.leadsOpen), status: 'neutral' },
      { name: 'ردود جاهزة', value: `${i.pendingReplies} بانتظارك`, status: i.pendingReplies ? 'partial' : 'ok' },
    ],
  };
  return views as Record<LiveModuleKey, LiveModuleView>;
}

// -----------------------------------------------------------------------------
// رؤى حية (الإصدار 2): كل ما يقرؤه المشروع عن زبائنه ومنشوراته — من السجلات الحقيقية فقط.
// -----------------------------------------------------------------------------
export interface LiveInsightsInput {
  nowMs: number;
  comments: Array<{ createdAt?: string; platform?: string; kind?: string; text?: string; backfill?: boolean; classification?: { intent?: string; topic?: string; isBusinessInquiry?: boolean } }>;
  leads: Array<{ interestedProductName?: string | null; archived?: boolean; stage?: string }>;
  publishRecords: Array<{ platform?: string; state?: string; simulated?: boolean; providerPostId?: string; externalVideoId?: string; createdAt?: string; publishedAt?: string }>;
}

export interface LiveInsights {
  /** تعليقات/رسائل واردة لكل ساعة من آخر 24 ساعة (الأقدم أولاً). */
  hourly24: number[];
  /** الاستفسارات التجارية لكل ساعة من آخر 24 ساعة. */
  hourlyInquiries24: number[];
  intents: Array<{ key: string; label: string; count: number }>;
  topics: Array<{ key: string; label: string; count: number }>;
  byPlatform: Array<{ platform: string; label: string; total: number; last24h: number }>;
  topProducts: Array<{ name: string; count: number }>;
  publish: Array<{ platform: string; label: string; published: number; failed: number }>;
  latestComments: Array<{ platform: string; label: string; intent: string; text: string; at: string }>;
  leadStages: Array<{ key: string; count: number }>;
}

const INTENT_AR: Record<string, string> = { business_inquiry: 'استفسار تجاري', question: 'سؤال', praise: 'مدح', complaint: 'شكوى', spam: 'سبام', other: 'أخرى' };
const TOPIC_AR: Record<string, string> = { price: 'السعر', installment: 'التقسيط', installment_terms: 'شروط التقسيط', availability: 'التوفر', location: 'الموقع', hours: 'الدوام', delivery: 'التوصيل', warranty: 'الضمان', contact: 'التواصل' };

function intentOf(c: LiveInsightsInput['comments'][number]): string {
  const k = c.classification || {};
  if (k.isBusinessInquiry === true || k.intent === 'business_inquiry') return 'business_inquiry';
  return String(k.intent || 'other');
}

export function buildLiveInsights(i: LiveInsightsInput): LiveInsights {
  const hourMs = 3600000;
  const start = i.nowMs - 24 * hourMs;
  const hourly24 = new Array(24).fill(0);
  const hourlyInquiries24 = new Array(24).fill(0);
  const intents = new Map<string, number>();
  const topics = new Map<string, number>();
  const plat = new Map<string, { total: number; last24h: number }>();
  const real = (i.comments || []).filter((c) => c && !c.backfill);
  for (const c of real) {
    const t = Date.parse(String(c.createdAt || ''));
    const intent = intentOf(c);
    intents.set(intent, (intents.get(intent) || 0) + 1);
    const topic = String(c.classification?.topic || '');
    if (topic && TOPIC_AR[topic]) topics.set(topic, (topics.get(topic) || 0) + 1);
    const p = String(c.platform || 'other');
    const cur = plat.get(p) || { total: 0, last24h: 0 };
    cur.total += 1;
    if (Number.isFinite(t) && t >= start && t <= i.nowMs) {
      cur.last24h += 1;
      const idx = Math.min(23, Math.max(0, Math.floor((t - start) / hourMs)));
      hourly24[idx] += 1;
      if (intent === 'business_inquiry') hourlyInquiries24[idx] += 1;
    }
    plat.set(p, cur);
  }
  const products = new Map<string, number>();
  const stages = new Map<string, number>();
  for (const l of i.leads || []) {
    if (!l || l.archived) continue;
    const n = String(l.interestedProductName || '').trim();
    if (n) products.set(n, (products.get(n) || 0) + 1);
    const s = String(l.stage || 'NEW');
    stages.set(s, (stages.get(s) || 0) + 1);
  }
  const pub = new Map<string, { published: number; failed: number }>();
  for (const r of i.publishRecords || []) {
    if (!r || r.simulated) continue;
    const p = String(r.platform || 'other');
    const cur = pub.get(p) || { published: 0, failed: 0 };
    if ((r.state === 'published' || r.state === 'scheduled') && (r.providerPostId || r.externalVideoId)) cur.published += 1;
    else if (r.state === 'failed') cur.failed += 1;
    pub.set(p, cur);
  }
  const sorted = <T,>(m: Map<string, T>, f: (k: string, v: T) => any, by: (x: any) => number) => [...m.entries()].map(([k, v]) => f(k, v)).sort((a, b) => by(b) - by(a));
  const latestComments = real
    .slice()
    .sort((a, b) => Date.parse(String(b.createdAt || '')) - Date.parse(String(a.createdAt || '')))
    .slice(0, 8)
    .map((c) => ({ platform: String(c.platform || ''), label: platformAr(String(c.platform || '')), intent: INTENT_AR[intentOf(c)] || 'تفاعل', text: clip(c.text, 110), at: String(c.createdAt || '') }));
  return {
    hourly24,
    hourlyInquiries24,
    intents: sorted(intents, (k, v) => ({ key: k, label: INTENT_AR[k] || k, count: v }), (x) => x.count),
    topics: sorted(topics, (k, v) => ({ key: k, label: TOPIC_AR[k] || k, count: v }), (x) => x.count).slice(0, 8),
    byPlatform: sorted(plat, (k, v) => ({ platform: k, label: platformAr(k), total: v.total, last24h: v.last24h }), (x) => x.total),
    topProducts: sorted(products, (k, v) => ({ name: clip(k, 60), count: v }), (x) => x.count).slice(0, 6),
    publish: sorted(pub, (k, v) => ({ platform: k, label: platformAr(k), published: v.published, failed: v.failed }), (x) => x.published),
    latestComments,
    leadStages: sorted(stages, (k, v) => ({ key: k, count: v }), (x) => x.count),
  };
}
