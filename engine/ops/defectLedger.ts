/**
 * سجل الأعطال الحقيقية (2026-10-28) — عين المهندس المشرف على ما يحدث فعلاً.
 *
 * لماذا: الدورية القديمة كانت تقرأ «إعدادات وأعداد» (هل البريد مضبوط؟ كم إشعاراً؟) فلم
 * تكتشف عطلاً واحداً، لأن الأعطال الحقيقية تقع في مكان آخر: طلب يرجع 500، استثناء داخل
 * مسار، شاشة تنهار في متصفح المالك، مزوّد يرفض الرمز، عملية تستغرق نصف ساعة. كانت هذه
 * تُبتلع (catch صامت) أو تُكتب في السجل بجملة عامة «خطأ داخلي» فلا يراها أحد.
 *
 * هذا الملف منطق صافٍ قابل للاختبار:
 *   1. `classifyFailure` — يقرأ حدثاً واحداً (سطر سجل، 500، استثناء، خطأ واجهة) ويقرّر:
 *      ليس عطلاً / عطل من أي نوع، مع التشخيص (لماذا حدث) والعلاج (ماذا يُفعل ومن يفعله).
 *   2. `fingerprint` — بصمة ثابتة تجمع تكرارات العطل نفسه (تُزال الأرقام والمعرّفات).
 *   3. `recordFailure` / `sweepLedger` — دفتر مجمّع: كم مرة، متى أول/آخر مرة، أين، عيّنات
 *      منقّاة، وحالة (مفتوح/حُلّ/عاد بعد الحل) — مع سقف حجم صارم.
 *
 * لا شبكة، لا أسرار (كل نص يمر عبر المنقّي قبل الحفظ)، لا حصة Gemini.
 */
import crypto from 'node:crypto';
import { redactSecretsFromText } from '../runtime/errorSafety';

export type DefectKind = 'code' | 'client' | 'provider' | 'config' | 'performance';
export type DefectSeverity = 'critical' | 'warning';
/** من يملك العلاج: المهندس (إصلاح تشغيلي آمن)، المالك (إعداد/ربط)، أو مهندس الكود (تعديل برمجي). */
export type DefectOwner = 'engineer' | 'owner' | 'developer';
export type DefectSource = 'log' | 'http' | 'exception' | 'client';

export interface FailureEvent {
  source: DefectSource;
  /** نص الحدث (سطر السجل، رسالة الخطأ، …). */
  text: string;
  level?: 'info' | 'warn' | 'error';
  /** مسار الطلب أو الشاشة أو اسم الدورة. */
  where?: string | null;
  /** أول إطار من المكدّس (ملف:سطر) إن توفر — بلا المكدّس كاملاً. */
  frame?: string | null;
  status?: number | null;
  durationMs?: number | null;
  /** طريقة الطلب والمسار الخام (لإعادة تنفيذ GET فاشل عند الإصلاح) — بلا جسم ولا ترويسات. */
  method?: string | null;
  path?: string | null;
}

export interface Diagnosis {
  kind: DefectKind;
  severity: DefectSeverity;
  owner: DefectOwner;
  /** عنوان قصير بالعربية. */
  title: string;
  /** التشخيص: لماذا يحدث هذا غالباً. */
  diagnosis: string;
  /** العلاج المحدد. */
  fix: string;
  /** جزء ثابت يدخل البصمة (يميّز أعطالاً من نفس النوع في أماكن مختلفة). */
  key: string;
}

export interface DefectGroup {
  fp: string;
  kind: DefectKind;
  severity: DefectSeverity;
  owner: DefectOwner;
  title: string;
  diagnosis: string;
  fix: string;
  where: string[];
  frame: string | null;
  count: number;
  firstAt: string;
  lastAt: string;
  /** آخر عيّنات منقّاة (للتحليل) — لا أسرار ولا هويات. */
  samples: string[];
  status: 'open' | 'resolved' | 'ignored';
  resolvedAt: string | null;
  resolvedBy: 'auto' | 'owner' | 'engineer' | null;
  /** القاعدة التي صنّفته (تحدد خطة الإصلاح). */
  rule: string;
  /** آخر طلب فشل (GET فقط يُعاد تنفيذه عند الإصلاح). */
  lastMethod: string | null;
  lastPath: string | null;
  /** آخر ما فعله المهندس بهذا العطل — يظهر على بطاقته. */
  repair: DefectRepair | null;
  /** عاد بعد أن عُلّم محلولاً: إصلاح لم ينجح. */
  regressions: number;
  /** نسخة الكود التي ظهر عليها أول مرة (commit مختصر). */
  firstVersion: string | null;
  lastVersion: string | null;
}

export interface DefectRepair {
  at: string;
  outcome: 'fixed' | 'failed' | 'owner' | 'developer';
  summary: string;
  steps: string[];
  attempts: number;
}

export interface DefectLedger {
  groups: Record<string, DefectGroup>;
  /** إجمالي الأحداث المسجلة (للإحصاء). */
  events: number;
  updatedAt: string | null;
}

export const LEDGER_POLICY = Object.freeze({
  maxGroups: 150,
  maxSamples: 3,
  maxWhere: 6,
  sampleChars: 220,
  /** عطل لم يتكرر منذ هذه المدة يُعلَّم «حُلّ تلقائياً» (إن لم يكن عيب كود — ذاك يُغلقه الإصلاح). */
  autoResolveMs: 24 * 3600000,
  /** عيب الكود يُغلق تلقائياً فقط بعد نشر نسخة جديدة وغيابه 6 ساعات عليها. */
  codeResolveAfterDeployMs: 6 * 3600000,
  /** المحلول يُحذف من الدفتر بعد 14 يوماً. */
  forgetResolvedMs: 14 * 86400000,
  /** عملية أبطأ من هذا عطل أداء. */
  slowRequestMs: 15000,
  slowBackupMs: 10 * 60000,
});

export function emptyLedger(): DefectLedger {
  return { groups: {}, events: 0, updatedAt: null };
}

// -----------------------------------------------------------------------------
// البصمة
// -----------------------------------------------------------------------------
/** يزيل ما يتغيّر بين تكرارات العطل نفسه (أرقام، معرّفات، روابط، نصوص مقتبسة). */
export function normalizeForFingerprint(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/\b[0-9a-f]{12,}\b/g, '<hex>')
    .replace(/\b[a-z]{2,6}_[a-z0-9]{6,}\b/g, '<id>')
    .replace(/"[^"]{0,120}"|'[^']{0,120}'/g, '<str>')
    .replace(/\d+(\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** مسار طلب بلا معرّفات: /api/posts/abc123/publish ⇒ /api/posts/:id/publish */
export function normalizeRoute(path: string | null | undefined): string {
  const p = String(path || '').split('?')[0];
  return p
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f-]{8,}$/i.test(seg) || /^[a-z]{2,6}_[A-Za-z0-9_-]{6,}$/.test(seg) || seg.length > 32 ? ':id' : seg))
    .join('/')
    .slice(0, 120);
}

export function fingerprint(d: Pick<Diagnosis, 'kind' | 'key'>, ev: FailureEvent): string {
  const base = `${d.kind}|${d.key}|${normalizeForFingerprint(ev.text)}|${ev.frame ? normalizeForFingerprint(ev.frame) : ''}`;
  return crypto.createHash('sha1').update(base).digest('hex').slice(0, 12);
}

// -----------------------------------------------------------------------------
// قاعدة المعرفة: من حدث إلى تشخيص
// -----------------------------------------------------------------------------
const PLATFORM_AR: Record<string, string> = { facebook: 'فيسبوك', instagram: 'إنستغرام', youtube: 'يوتيوب', threads: 'ثريدز', tiktok: 'تيك توك', telegram: 'تيليغرام', whatsapp: 'واتساب', google_business: 'Google Business', x: 'X', snapchat: 'سناب شات' };
const pa = (p: string) => PLATFORM_AR[p] || p;

/** أخطاء برمجية صريحة (JavaScript) — لا يصلحها إلا تعديل الكود. */
const JS_BUG_RE = /\b(TypeError|ReferenceError|RangeError|SyntaxError)\b|cannot read propert|is not a function|is not defined|is not iterable|undefined is not|cannot set propert|maximum call stack|invalid time value|unexpected token/i;

/** رموز Meta/Graph المعروفة لإذن ناقص أو رمز ملغى. */
const META_PERMISSION_CODES = new Set(['10', '100', '200', '190', '3', '33']);

/** أسطر لا تمثّل عطلاً حتى لو احتوت كلمة «error» (ملخصات سليمة، رسائل المهندس نفسه). */
const NOT_A_FAILURE_RE = /^\[(defect|engineer-ledger|storage\] state_writes|storage\] coalesced)|request (error|rejected) \(|\bissue=-(\s|$)|outcome=(ok|connected|token_refreshed|authorized_url_issued|callback_received|callback_completed|callback_duplicate_replayed)\b/i;

/**
 * يصنّف حدثاً واحداً. يُرجع null إن لم يكن عطلاً. القواعد مأخوذة من أسطر سجل الإنتاج
 * الفعلية (Render، أكتوبر 2026) لا من افتراضات.
 */
export function classifyFailure(ev: FailureEvent): Diagnosis | null {
  const text = String(ev.text || '').trim();
  if (!text && ev.source !== 'http') return null;
  // سطر النسخ الاحتياطي الناجح يُفحص لاحقاً للبطء، فلا يُستبعد هنا.
  if (ev.source === 'log' && !/^\[dr-backup\]/i.test(text) && NOT_A_FAILURE_RE.test(text)) return null;
  const where = ev.where ? normalizeRoute(ev.where) : '';

  // 1) استثناء غير مُلتقَط / وعد مرفوض — عيب كود دائماً.
  if (ev.source === 'exception' && /^crash:/.test(String(ev.where || ''))) {
    const oom = ev.where === 'crash:oom';
    return {
      kind: oom ? 'performance' : 'code', severity: 'critical', owner: 'developer', key: String(ev.where),
      title: oom ? 'الخادم انهار بنفاد الذاكرة وأعيد تشغيله' : 'الخادم انهار وأعيد تشغيله',
      diagnosis: oom ? 'آخر قراءة ذاكرة قبل الموت كانت قرب حد 512 ميغا (خطة Render المجانية) — عمل يحمّل بيانات كثيرة دفعة واحدة أو تسرّب.' : 'العملية ماتت بلا إغلاق نظيف (خطأ قاتل) — ضاعت أي كتابة لم تُحفظ وانقطعت الشاشات لحظتها.',
      fix: oom ? 'مهندس الكود يحدد ما يستهلك الذاكرة (سجل الذاكرة + آخر نسخة) ويقلّله؛ المهندس ينذر قبلها من اتجاه الذاكرة.' : 'مهندس الكود يقرأ سجل Render لحظة الانهيار ويصلح السبب.',
    };
  }
  if (ev.source === 'exception') {
    return {
      kind: 'code', severity: 'critical', owner: 'developer', key: `exception:${where}`,
      title: `استثناء غير مُعالَج${where ? ` في ${where}` : ''}`,
      diagnosis: 'خطأ برمجي أفلت من كل معالجة. قد يترك عملية في منتصفها (رد لم يُرسل، حفظ لم يكتمل).',
      fix: 'يحتاج تعديل كود: مهندس الكود يقرأ الموضع والعيّنة ويضيف المعالجة الصحيحة مع اختبار يمنع عودته.',
    };
  }

  // 2) انهيار شاشة أو خطأ JavaScript في متصفح المالك.
  if (ev.source === 'client') {
    const apiFail = /^api\s+(\d{3})\b/i.exec(text);
    if (apiFail) {
      const st = Number(apiFail[1]);
      if (st >= 502 && st <= 504) return {
        kind: 'provider', severity: 'warning', owner: 'engineer', key: 'client-gateway',
        title: 'الخادم لم يُجب على الشاشة',
        diagnosis: `المتصفح تلقّى ${st}: الخادم كان نائماً أو يُعاد نشره أو انهار — المالك يرى «تعذّر الاتصال».`,
        fix: 'إن تكرر خارج أوقات النشر: راجع أحداث Render (انهيار/نفاد ذاكرة) وحارس الإبقاء مستيقظاً.',
      };
      return {
        kind: 'code', severity: st >= 500 ? 'critical' : 'warning', owner: 'developer', key: `client-api:${where}:${st}`,
        title: `الشاشة تلقّت خطأ ${st} من ${where || 'الخادم'}`,
        diagnosis: 'طلب من الواجهة فشل على الخادم. هذا ما يراه المالك كرسالة «تعذّر…» أو زر لا يعمل.',
        fix: 'يحتاج تعديل كود في مسار الخادم المذكور (السجل يحمل رقم الطلب للمطابقة).',
      };
    }
    return {
      kind: 'client', severity: /render|chunk|white|boundary|انهيار/i.test(text) ? 'critical' : 'warning', owner: 'developer', key: `client:${where}`,
      title: `خطأ في الواجهة${where ? ` (${where})` : ''}`,
      diagnosis: JS_BUG_RE.test(text) ? 'خطأ برمجي في شاشة الواجهة (قيمة غير متوقعة من الخادم أو حالة لم تُعالج).' : 'خطأ في متصفح المالك أثناء العمل.',
      fix: 'يحتاج تعديل كود الواجهة في الموضع المذكور مع اختبار للحالة التي سبّبته.',
    };
  }

  // 3) استجابة HTTP من مسارات الخادم.
  if (ev.source === 'http') {
    const st = Number(ev.status || 0);
    if (st >= 500) {
      const providerSide = st === 502 || st === 503 || st === 504;
      return {
        kind: providerSide ? 'provider' : 'code', severity: providerSide ? 'warning' : 'critical', owner: providerSide ? 'engineer' : 'developer', key: `http:${where}:${st}`,
        title: `${where || 'مسار'} يرجع ${st}`,
        diagnosis: providerSide ? 'المسار يعتمد على مزوّد خارجي لم يستجب أو رفض.' : 'المسار انهار داخل الخادم — هذا ما يظهر للمالك كفشل عملية.',
        fix: providerSide ? 'إن تكرر: افحص المزوّد المعني (رمز/حصة/إذن).' : 'يحتاج تعديل كود: الموضع والرسالة الحقيقية في العيّنة.',
      };
    }
    if (ev.durationMs != null && ev.durationMs >= LEDGER_POLICY.slowRequestMs) {
      return {
        kind: 'performance', severity: 'warning', owner: 'developer', key: `slow:${where}`,
        title: `${where || 'مسار'} بطيء جداً`,
        diagnosis: `استغرق الطلب ${Math.round(ev.durationMs / 1000)} ث — المالك ينتظر أو يظن أن الزر معطّل.`,
        fix: 'تحسين المسار (عمل متزامن ثقيل أو استدعاء مزوّد بلا مهلة).',
      };
    }
    return null;
  }

  // 4) أسطر السجل.
  // 4أ) خطأ المسار يُسجَّل من مراقب /api مع الرسالة الحقيقية (مرة واحدة) — سطر السجل مستبعد أعلاه.
  // 4ب) فشل OAuth بعد العودة من المزوّد.
  let m = /\[oauth-callback-error\]\s+(\w+)\s+status=(\d+)\s+message=(.*)$/i.exec(text);
  if (m) {
    const [, platform, , msg] = m;
    if (/client secret is invalid|invalid_client|unauthorized_client/i.test(msg)) return {
      kind: 'config', severity: 'critical', owner: 'owner', key: `oauth-secret:${platform}`,
      title: `سرّ تطبيق ${pa(platform)} خاطئ`,
      diagnosis: `المزوّد رفض «client secret» المضبوط في Render لربط ${pa(platform)} — الرمز لم يُبادَل.`,
      fix: `انسخ السرّ الصحيح من لوحة المطوّر (Google Cloud/Meta) إلى متغيّر Render الخاص بـ${pa(platform)} ثم أعد الربط.`,
    };
    if (/redirect_uri|redirect uri/i.test(msg)) return {
      kind: 'config', severity: 'critical', owner: 'owner', key: `oauth-redirect:${platform}`,
      title: `رابط الإرجاع غير مسجّل لـ${pa(platform)}`,
      diagnosis: 'المزوّد لا يعرف رابط الإرجاع الذي أرسلناه.',
      fix: 'أضف رابط الإرجاع الظاهر في مركز ربط المنصات إلى إعدادات التطبيق لدى المزوّد حرفياً.',
    };
    return {
      kind: 'provider', severity: 'warning', owner: 'owner', key: `oauth-fail:${platform}`,
      title: `فشل ربط ${pa(platform)}`,
      diagnosis: `المزوّد رفض إكمال الربط: ${msg.slice(0, 140)}`,
      fix: 'اتبع النص المعروض في نافذة الربط؛ إن تكرر بلا سبب واضح فالمسار يحتاج فحص كود.',
    };
  }
  // 4ب٢) رفض Graph API (فيسبوك/إنستغرام/ثريدز) — كان يُكتب في السجل ولا يراه أحد (رُصد حياً 2026-10-28:
  //       اشتراك رسائل الصفحة رُفض لغياب pages_messaging).
  m = /^\[(facebook|instagram|threads)-graph-error\]\s+(\{.*\})\s*$/i.exec(text);
  if (m) {
    let info: any = {};
    try { info = JSON.parse(m[2]); } catch { /* سطر تالف */ }
    const platform = m[1].toLowerCase();
    const code = String(info.code ?? '');
    const msg = String(info.message || '').slice(0, 200);
    const endpoint = String(info.endpoint || '').replace(/\/\d{6,}\//g, '/:id/');
    const perm = /permission|permissions|(#(10|200|3)\))/i.exec(msg) || ['10', '200', '3', '100'].includes(code) && /permission/i.test(msg);
    const needed = /needed:\s*([a-z_,\s]+)/i.exec(msg)?.[1]?.trim() || null;
    if (perm || code === '190') return {
      kind: 'config', severity: 'critical', owner: 'owner', key: `graph-perm:${platform}:${endpoint}`,
      title: code === '190' ? `رمز ${pa(platform)} ملغى أو منتهٍ` : `${pa(platform)} ترفض: إذن ناقص${needed ? ` (${needed})` : ''}`,
      diagnosis: `${endpoint || 'نداء Graph'} رُفض: ${msg}`,
      fix: code === '190' ? `أعد ربط ${pa(platform)} من «مركز ربط المنصات».` : `أعد ربط ${pa(platform)} ووافق على كل الأذونات${needed ? ` — خصوصاً ${needed}` : ''}؛ إن لم يظهر الإذن في نافذة الربط فأضفه لتطبيق Meta (App Review/Advanced Access).`,
    };
    return {
      kind: 'provider', severity: 'warning', owner: 'engineer', key: `graph:${platform}:${endpoint}`,
      title: `${pa(platform)} رفضت طلباً (${info.status || '?'}/${code || '?'})`,
      diagnosis: `${endpoint}: ${msg}`, fix: 'إن تكرر فالسبب في الرسالة؛ المهندس يتابعه.',
    };
  }
  // 4ج) فشل تجديد رمز (يعني أن المنصة ستتوقف).
  m = /\[(\w+)-oauth\]\s+outcome=refresh_failed/i.exec(text);
  if (m) return {
    kind: 'provider', severity: 'critical', owner: 'owner', key: `refresh:${m[1]}`,
    title: `تعذّر تجديد رمز ${pa(m[1])}`,
    diagnosis: 'المزوّد رفض refresh token (أُلغي الإذن، تغيّرت كلمة السر، أو التطبيق في وضع الاختبار فتنتهي الرموز بعد 7 أيام).',
    fix: `أعد ربط ${pa(m[1])} من مركز ربط المنصات. إن تكرر أسبوعياً فانقل تطبيق Google إلى «In production».`,
  };
  // 4د) رفض جلسة OAuth متكرر (العودة بعد إعادة النشر أو زر «رجوع»).
  m = /\[oauth\]\s+(\w+)\s+\{.*"outcome":"callback_rejected".*"reason":"([^"]+)"/i.exec(text);
  if (m) return {
    kind: 'provider', severity: 'warning', owner: 'owner', key: `oauth-rejected:${m[1]}`,
    title: `عودة ربط ${pa(m[1])} رُفضت`,
    diagnosis: `${m[2]} — يحدث عند إعادة استخدام نافذة ربط قديمة أو نشر نسخة جديدة أثناء الربط.`,
    fix: 'ابدأ الربط من جديد من مركز ربط المنصات ولا تستخدم زر «رجوع» في نافذة المزوّد.',
  };
  // 4هـ) مزامنة الأرقام: رمز مشكلة لكل منصة.
  m = /\[metrics\]\s+platform=(\w+).*?\b(?:issue|error)=([^\s]+)/i.exec(text);
  if (m && m[2] !== '-') {
    const [, platform, issue] = m;
    const code = issue.split(/[x/,]/)[0];
    if (/^SCOPE_MISSING/i.test(issue) || META_PERMISSION_CODES.has(code)) return {
      kind: 'config', severity: 'warning', owner: 'owner', key: `metrics-perm:${platform}`,
      title: `إحصاءات ${pa(platform)} ناقصة الإذن`,
      diagnosis: `المنصة ترفض قراءة الأرقام (${issue}) — منشورات بلا قياس لا يتعلّم منها العقل.`,
      fix: `أعد ربط ${pa(platform)} مع الموافقة على كل الأذونات المطلوبة (insights/video.list).`,
    };
    return {
      kind: 'provider', severity: 'warning', owner: 'engineer', key: `metrics:${platform}`,
      title: `مزامنة أرقام ${pa(platform)} متعثّرة`,
      diagnosis: `رمز المشكلة: ${issue}.`,
      fix: 'المهندس يعيد المزامنة؛ إن استمر فالرمز يحدد السبب.',
    };
  }
  if (/\[metrics\]\s+outcome=failed/i.test(text)) return {
    kind: 'code', severity: 'warning', owner: 'developer', key: 'metrics-cycle',
    title: 'دورة مزامنة الأرقام انهارت', diagnosis: 'الدورة كلها فشلت لا منصة واحدة.', fix: 'يحتاج فحص كود دورة المزامنة.',
  };
  // 4و) النسخ الاحتياطي: فشل أو بطء شديد.
  m = /\[dr-backup\]\s+outcome=(\w+).*?\bms=(\d+)/i.exec(text) || /\[dr-backup\]\s+outcome=(\w+)/i.exec(text);
  if (m) {
    const outcome = m[1]; const ms = Number(m[2] || 0);
    if (outcome === 'failed') return {
      kind: 'provider', severity: 'critical', owner: 'engineer', key: 'backup-failed',
      title: 'النسخ الاحتياطي فشل', diagnosis: `نتيجة الدورة: ${outcome}.`, fix: 'المهندس يعيد الدورة؛ إن تكرر فراجع تفويض Drive ومساحته.',
    };
    if (ms >= LEDGER_POLICY.slowBackupMs) return {
      kind: 'performance', severity: 'warning', owner: 'developer', key: 'backup-slow',
      title: 'النسخ الاحتياطي بطيء جداً',
      diagnosis: `استغرقت النسخة ${Math.round(ms / 60000)} دقيقة على خادم بذاكرة 512 ميغا — نافذة طويلة يضغط فيها على الذاكرة والشبكة، وإعادة نشر خلالها تقطعها.`,
      fix: 'تحسين: رفع الأجزاء غير المتغيّرة مرة واحدة فقط، أو تقليل حجم اللقطة.',
    };
    return null;
  }
  // 4ز) فشل الحفظ في قاعدة البيانات.
  if (/could not persist|persist.*failed|storage not ready/i.test(text)) return {
    kind: 'provider', severity: 'critical', owner: 'engineer', key: 'persist',
    title: 'فشل حفظ البيانات', diagnosis: 'الكتابة إلى Postgres فشلت — التغييرات في الذاكرة فقط حتى تنجح.', fix: 'المهندس يعيد المحاولة؛ إن استمر فراجع حالة Neon وحصته.',
  };
  // 4ح) فشل داخلي في دورات المهندس أو غيرها (tick_failed/step_failed…).
  if (/\b\w+_failed\b/.test(text) && /^\[(engineer|brain|commercial|watcher|meta|youtube|telegram|cycle)/i.test(text)) return {
    kind: 'code', severity: 'warning', owner: 'developer', key: `cycle:${text.split(']')[0]}`,
    title: `دورة داخلية فشلت: ${text.split(']')[0].replace('[', '')}`, diagnosis: 'دورة خلفية ألقت خطأ والتقطته الحماية — العمل الذي كانت تؤديه لم يتم.', fix: 'يحتاج فحص كود الدورة المذكورة.',
  };
  // 4ط) خطأ JavaScript صريح في أي سطر تحذير/خطأ.
  if ((ev.level === 'error' || ev.level === 'warn') && JS_BUG_RE.test(text)) return {
    kind: 'code', severity: 'critical', owner: 'developer', key: `js:${where}`,
    title: 'خطأ برمجي في الخادم', diagnosis: 'خطأ JavaScript (قيمة غير متوقعة أو دالة غير موجودة).', fix: 'يحتاج تعديل كود في الموضع المذكور.',
  };
  return null;
}

// -----------------------------------------------------------------------------
// الدفتر
// -----------------------------------------------------------------------------
export function sanitizeSample(text: string): string {
  return redactSecretsFromText(String(text || ''))
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\+?\d[\d\s-]{8,}\d/g, '[phone]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LEDGER_POLICY.sampleChars);
}

export interface RecordResult { group: DefectGroup; isNew: boolean; isRegression: boolean }

/** يسجّل حدثاً مصنّفاً. يُرجع null إن لم يكن عطلاً. */
export function recordFailure(ledger: DefectLedger, ev: FailureEvent, opts: { nowMs: number; version?: string | null }): RecordResult | null {
  const d = classifyFailure(ev);
  if (!d) return null;
  const fp = fingerprint(d, ev);
  const nowIso = new Date(opts.nowMs).toISOString();
  const version = opts.version || null;
  const sample = sanitizeSample([ev.where ? `[${normalizeRoute(ev.where)}]` : '', ev.status ? `status=${ev.status}` : '', ev.text, ev.frame ? `@ ${ev.frame}` : ''].filter(Boolean).join(' '));
  ledger.events += 1;
  ledger.updatedAt = nowIso;
  const existing = ledger.groups[fp];
  if (existing) {
    const isRegression = existing.status === 'resolved';
    existing.count += 1;
    existing.lastAt = nowIso;
    existing.lastVersion = version || existing.lastVersion;
    if (isRegression) { existing.status = 'open'; existing.resolvedAt = null; existing.resolvedBy = null; existing.regressions += 1; if (existing.repair?.outcome === 'fixed') existing.repair = { ...existing.repair, outcome: 'failed', summary: `عاد بعد إصلاحي: ${existing.repair.summary}`.slice(0, 300) }; }
    if (ev.where) { const w = normalizeRoute(ev.where); if (!existing.where.includes(w)) existing.where = [w, ...existing.where].slice(0, LEDGER_POLICY.maxWhere); }
    existing.rule = d.key;
    if (ev.path) { existing.lastMethod = String(ev.method || 'GET').toUpperCase(); existing.lastPath = String(ev.path).slice(0, 200); }
    if (!existing.samples.includes(sample)) existing.samples = [sample, ...existing.samples].slice(0, LEDGER_POLICY.maxSamples);
    // التشخيص قد يتحسّن مع تحديث قاعدة المعرفة — يؤخذ الأحدث.
    Object.assign(existing, { title: d.title, diagnosis: d.diagnosis, fix: d.fix, severity: d.severity, owner: d.owner });
    return { group: existing, isNew: false, isRegression };
  }
  const group: DefectGroup = {
    fp, kind: d.kind, severity: d.severity, owner: d.owner, title: d.title, diagnosis: d.diagnosis, fix: d.fix,
    where: ev.where ? [normalizeRoute(ev.where)] : [], frame: ev.frame ? sanitizeSample(ev.frame).slice(0, 120) : null,
    count: 1, firstAt: nowIso, lastAt: nowIso, samples: [sample], status: 'open', resolvedAt: null, resolvedBy: null,
    regressions: 0, firstVersion: version, lastVersion: version,
    rule: d.key, lastMethod: ev.path ? String(ev.method || 'GET').toUpperCase() : null, lastPath: ev.path ? String(ev.path).slice(0, 200) : null, repair: null,
  };
  ledger.groups[fp] = group;
  enforceCap(ledger);
  return { group, isNew: true, isRegression: false };
}

/** السقف: يُحذف الأقدم من المحلول أولاً ثم من المفتوح الأقل تكراراً. */
function enforceCap(ledger: DefectLedger): void {
  const all = Object.values(ledger.groups);
  if (all.length <= LEDGER_POLICY.maxGroups) return;
  const order = all.slice().sort((a, b) => {
    const ra = a.status === 'open' ? 1 : 0; const rb = b.status === 'open' ? 1 : 0;
    if (ra !== rb) return ra - rb;
    return a.lastAt < b.lastAt ? -1 : a.lastAt > b.lastAt ? 1 : a.count - b.count;
  });
  for (const g of order.slice(0, all.length - LEDGER_POLICY.maxGroups)) delete ledger.groups[g.fp];
}

/**
 * صيانة دورية: عطل غاب طويلاً يُعلَّم محلولاً تلقائياً، والمحلول القديم يُنسى.
 * عيب الكود لا يُغلق بمجرد الصمت (قد يكون المسار لم يُستدعَ) — يُغلق فقط إن ظهرت نسخة
 * كود جديدة وبقي غائباً عليها. يُرجع المفاتيح التي حُلّت الآن.
 */
export function sweepLedger(ledger: DefectLedger, opts: { nowMs: number; version?: string | null; versionSinceMs?: number | null }): string[] {
  const resolved: string[] = [];
  const P = LEDGER_POLICY;
  for (const g of Object.values(ledger.groups)) {
    const last = Date.parse(g.lastAt);
    if (g.status === 'resolved') {
      if (g.resolvedAt && opts.nowMs - Date.parse(g.resolvedAt) > P.forgetResolvedMs) delete ledger.groups[g.fp];
      continue;
    }
    if (g.status !== 'open') continue;
    const isCode = g.kind === 'code' || g.kind === 'client';
    const quietLongEnough = opts.nowMs - last > (isCode ? P.codeResolveAfterDeployMs : P.autoResolveMs);
    const newCode = !isCode || (opts.version && g.lastVersion && opts.version !== g.lastVersion && opts.versionSinceMs != null && opts.nowMs - opts.versionSinceMs > P.codeResolveAfterDeployMs);
    if (quietLongEnough && newCode) {
      g.status = 'resolved'; g.resolvedAt = new Date(opts.nowMs).toISOString(); g.resolvedBy = 'auto';
      resolved.push(g.fp);
    }
  }
  return resolved;
}

/** قرار المالك: «عولج» أو «تجاهل». */
export function markDefect(ledger: DefectLedger, fp: string, action: 'resolved' | 'ignored' | 'open', nowMs: number): DefectGroup | null {
  const g = ledger.groups[fp];
  if (!g) return null;
  g.status = action;
  g.resolvedAt = action === 'open' ? null : new Date(nowMs).toISOString();
  g.resolvedBy = action === 'open' ? null : 'owner';
  return g;
}

const SEV = { critical: 0, warning: 1 } as const;
/** المفتوح مرتباً: الحرج ثم الأحدث ثم الأكثر تكراراً. */
export function openDefects(ledger: DefectLedger): DefectGroup[] {
  return Object.values(ledger.groups)
    .filter((g) => g.status === 'open')
    .sort((a, b) => SEV[a.severity] - SEV[b.severity] || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0) || b.count - a.count);
}

export function ledgerSummary(ledger: DefectLedger) {
  const open = openDefects(ledger);
  const by = (k: DefectOwner) => open.filter((g) => g.owner === k).length;
  return {
    open: open.length,
    critical: open.filter((g) => g.severity === 'critical').length,
    forDeveloper: by('developer'),
    forOwner: by('owner'),
    forEngineer: by('engineer'),
    regressions: open.filter((g) => g.regressions > 0).length,
    events: ledger.events,
    updatedAt: ledger.updatedAt,
  };
}

/** تحميل آمن من المخزن. */
export function normalizeLedger(raw: any): DefectLedger {
  const base = emptyLedger();
  if (!raw || typeof raw !== 'object' || !raw.groups || typeof raw.groups !== 'object') return base;
  for (const [fp, g] of Object.entries(raw.groups as Record<string, any>)) {
    if (!g || typeof g !== 'object' || typeof g.title !== 'string' || typeof g.firstAt !== 'string') continue;
    base.groups[fp] = {
      fp, kind: g.kind, severity: g.severity === 'critical' ? 'critical' : 'warning', owner: g.owner || 'developer',
      title: g.title, diagnosis: String(g.diagnosis || ''), fix: String(g.fix || ''),
      where: Array.isArray(g.where) ? g.where.slice(0, LEDGER_POLICY.maxWhere).map(String) : [], frame: g.frame ? String(g.frame) : null,
      count: Number(g.count) || 1, firstAt: g.firstAt, lastAt: String(g.lastAt || g.firstAt),
      samples: Array.isArray(g.samples) ? g.samples.slice(0, LEDGER_POLICY.maxSamples).map(String) : [],
      status: g.status === 'resolved' || g.status === 'ignored' ? g.status : 'open',
      resolvedAt: g.resolvedAt ? String(g.resolvedAt) : null, resolvedBy: g.resolvedBy === 'owner' || g.resolvedBy === 'auto' || g.resolvedBy === 'engineer' ? g.resolvedBy : null,
      regressions: Number(g.regressions) || 0, firstVersion: g.firstVersion || null, lastVersion: g.lastVersion || null,
      rule: typeof g.rule === 'string' ? g.rule : '', lastMethod: g.lastMethod ? String(g.lastMethod) : null, lastPath: g.lastPath ? String(g.lastPath) : null,
      repair: g.repair && typeof g.repair === 'object' && typeof g.repair.summary === 'string'
        ? { at: String(g.repair.at || ''), outcome: ['fixed', 'failed', 'owner', 'developer'].includes(g.repair.outcome) ? g.repair.outcome : 'failed', summary: g.repair.summary, steps: Array.isArray(g.repair.steps) ? g.repair.steps.slice(0, 8).map(String) : [], attempts: Number(g.repair.attempts) || 0 }
        : null,
    };
  }
  base.events = Number(raw.events) || 0;
  base.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;
  enforceCap(base);
  return base;
}

/**
 * سطر سجل واحد مُهيكل لكل عطل جديد/عائد — هو ما يقرؤه «مهندس الكود» المجدول من سجلات
 * Render ليفتح إصلاحاً. منقّى، بلا أسرار، سطر واحد.
 */
export function defectLogLine(g: DefectGroup, event: 'new' | 'regression'): string {
  const parts = [
    `[defect] ${event}`, `fp=${g.fp}`, `kind=${g.kind}`, `sev=${g.severity}`, `owner=${g.owner}`,
    g.where.length ? `where=${g.where[0]}` : '', g.frame ? `frame=${g.frame.replace(/\s+/g, '')}` : '',
    g.lastVersion ? `ver=${g.lastVersion}` : '',
    `title=${JSON.stringify(g.title)}`, `sample=${JSON.stringify(g.samples[0] || '')}`,
  ];
  return parts.filter(Boolean).join(' ');
}

// -----------------------------------------------------------------------------
// الإصلاح الذاتي (2026-10-28): لكل عطل مرصود خطة إصلاح حقيقية أو جهة مسؤولة صريحة.
// -----------------------------------------------------------------------------
export type RepairPlan =
  /** إعادة تنفيذ الطلب الذي فشل (قراءة GET فقط — الكتابة لا تُعاد أبداً). */
  | { action: 'replay_route'; method: 'GET'; path: string }
  /** التحقق أن الخادم يجيب الآن (عطل لحظة إعادة النشر/النوم). */
  | { action: 'verify_server'; path: string | null }
  /** تجديد رمز منصة رفض المزوّد تجديده. */
  | { action: 'refresh_token'; platform: string }
  /** إعادة مزامنة الأرقام لمنصة/للكل. */
  | { action: 'rerun_metrics'; platform: string | null }
  /** إعادة دورة النسخ الاحتياطي. */
  | { action: 'rerun_backup' }
  /** إعادة محاولة الحفظ في قاعدة البيانات. */
  | { action: 'retry_persist' }
  /** لا إصلاح آلي ممكن: إعداد/ربط بيد المالك (يُذكر الإجراء بالضبط). */
  | { action: 'owner'; instructions: string }
  /** عيب في الكود نفسه: يُصلحه مهندس الكود (تعديل + اختبار + طلب دمج). */
  | { action: 'developer' };

/** يحدد خطة الإصلاح من القاعدة التي صنّفت العطل. منطق صافٍ مختبر. */
export function repairPlanFor(g: Pick<DefectGroup, 'kind' | 'owner' | 'rule' | 'fix' | 'lastMethod' | 'lastPath'>): RepairPlan {
  const rule = String(g.rule || '');
  const getPath = g.lastMethod === 'GET' && g.lastPath && g.lastPath.startsWith('/api/') ? g.lastPath : null;
  if (rule === 'client-gateway') return { action: 'verify_server', path: getPath };
  if (rule.startsWith('http:') && g.kind === 'provider') return getPath ? { action: 'replay_route', method: 'GET', path: getPath } : { action: 'verify_server', path: null };
  if (rule.startsWith('refresh:')) {
    const platform = rule.slice('refresh:'.length);
    return platform === 'youtube' ? { action: 'refresh_token', platform } : { action: 'owner', instructions: g.fix };
  }
  if (rule.startsWith('metrics:')) return { action: 'rerun_metrics', platform: rule.slice('metrics:'.length) || null };
  if (rule === 'backup-failed') return { action: 'rerun_backup' };
  if (rule === 'persist') return { action: 'retry_persist' };
  if (g.owner === 'owner') return { action: 'owner', instructions: g.fix };
  return { action: 'developer' };
}

/** يسجّل نتيجة محاولة إصلاح على العطل نفسه؛ النجاح المتحقَّق يغلقه «أصلحه المهندس». */
export function recordRepair(ledger: DefectLedger, fp: string, r: { outcome: DefectRepair['outcome']; summary: string; steps: string[]; nowMs: number }): DefectGroup | null {
  const g = ledger.groups[fp];
  if (!g) return null;
  const attempts = (g.repair?.attempts || 0) + 1;
  g.repair = { at: new Date(r.nowMs).toISOString(), outcome: r.outcome, summary: r.summary.slice(0, 300), steps: r.steps.slice(0, 8).map((x) => String(x).slice(0, 200)), attempts };
  if (r.outcome === 'fixed') { g.status = 'resolved'; g.resolvedAt = g.repair.at; g.resolvedBy = 'engineer'; }
  return g;
}

/** ما أصلحه المهندس مؤخراً (للعرض: «أُصلح ذاتياً»). */
export function recentlyRepaired(ledger: DefectLedger, nowMs: number, withinMs = 48 * 3600000): DefectGroup[] {
  return Object.values(ledger.groups)
    .filter((g) => g.resolvedBy === 'engineer' && g.resolvedAt && nowMs - Date.parse(g.resolvedAt) < withinMs)
    .sort((a, b) => (a.resolvedAt! < b.resolvedAt! ? 1 : -1));
}
