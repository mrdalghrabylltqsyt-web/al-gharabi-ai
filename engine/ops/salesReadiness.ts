/**
 * جاهزية البيع — تشخيص ذاتي حتمي لما يمنع «الموظف الرقمي» من البيع الآن.
 *
 * الغرض: بدل أن يكتشف المالك العوائق يدوياً (إعداد مفقود، سر خاطئ، زبائن ينتظرون
 * الموافقة، مسودات بسعر قديم)، يقرأ النظام حالته الحقيقية ويعيد قائمة مرتبة:
 * ما العائق، لماذا يهم البيع، ومن يصلحه وكيف. صافٍ بلا شبكة ولا أسرار ولا Gemini،
 * ولا يعيد أي نص زبون أو قيمة سرية — أعداد وأسماء منصات وأسماء متغيرات فقط.
 */

import { publishFailureHint, type PublishHealthPlatform } from './publishHealth';

export type ReadinessSeverity = 'blocker' | 'warning' | 'info' | 'ok';
export type ReadinessArea = 'customers' | 'platforms' | 'automation' | 'content' | 'system';
export type ReadinessActor = 'owner' | 'system';

export interface ReadinessPlatformInput {
  id: string;
  name: string;
  /** متصل باتصال موثّق من المزود. */
  connected: boolean;
  /** بيانات تطبيق المزود مضبوطة في البيئة (لازمة لبدء الربط). */
  credentialsConfigured: boolean;
  /** هل للمنصة موصل حقيقي منفّذ في الكود؟ */
  realConnector: boolean;
  /** آخر فشل ربط OAuth (نص منقّى بلا أسرار) إن وُجد بعد آخر نجاح. */
  lastOAuthFailure?: { at: string; message: string } | null;
}

export interface SalesReadinessInput {
  nowIso: string;
  youtubeOnlyMode: boolean;
  platforms: ReadinessPlatformInput[];
  commercialBrainEnabled: boolean;
  sendMode: string;
  ownerAlerts: { enabled: boolean; emailConfigured: boolean; telegramConfigured?: boolean };
  /** طلبات رد على زبائن تنتظر موافقة المالك. */
  pendingApprovals: { count: number; oldestAt: string | null };
  /** مهام نشر معتمدة حان موعدها وتنتظر التنفيذ. */
  readyJobs: number;
  autoExecuteEnabled: boolean;
  /** مسودات/منشورات تسويق وُلّدت بحسبة القسط القديمة (قبل إصلاح نسبة الزيادة). */
  staleMarketing: { unpublished: number; published: number };
  geminiConfigured: boolean;
  /** حداثة آخر نسخة احتياطية ناجحة (حماية بيانات الزبائن والمنتجات والمبيعات). */
  backup?: {
    configured: boolean;
    level: 'ok' | 'warning' | 'critical';
    lastSuccessAt: string | null;
    ageHours: number | null;
    lastError: string | null;
    lastSkippedReason: string | null;
  };
  /** صحة النشر الفعلي على كل منصة متصلة (من سجل النشر الحقيقي). */
  publishing?: Array<PublishHealthPlatform & { name: string }>;
  /** قراءة التعليقات لكل منصة متصلة: هل تفشل الآن (لا يصل أي تعليق زبون)؟ */
  commentIngest?: Array<{ platform: string; name: string; failing: boolean; reason: string; code: string | null }>;
}

export interface ReadinessItem {
  id: string;
  severity: ReadinessSeverity;
  area: ReadinessArea;
  actor: ReadinessActor;
  title: string;
  detail: string;
  action: string;
}

export interface SalesReadinessReport {
  generatedAt: string;
  /** 0..100 — نسبة القدرات التجارية الأساسية العاملة فعلاً. */
  score: number;
  verdict: 'selling' | 'partial' | 'blocked';
  verdictText: string;
  counts: Record<ReadinessSeverity, number>;
  items: ReadinessItem[];
}

/** منصات البيع الأساسية لمعرض تقسيط في العراق، مرتبة حسب أثرها على المبيعات. */
export const CORE_SALES_PLATFORMS: readonly string[] = Object.freeze([
  'whatsapp', 'facebook', 'instagram', 'tiktok', 'telegram', 'google_business', 'youtube',
]);

/** انتظار الزبون أكثر من هذا (بالساعات) يُعدّ عائقاً لا تحذيراً. */
export const CUSTOMER_WAIT_BLOCKER_HOURS = 2;

const SEVERITY_ORDER: Record<ReadinessSeverity, number> = { blocker: 0, warning: 1, info: 2, ok: 3 };

function hoursBetween(fromIso: string | null, nowIso: string): number | null {
  if (!fromIso) return null;
  const a = Date.parse(fromIso);
  const b = Date.parse(nowIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, (b - a) / 3_600_000);
}

function formatWait(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} دقيقة`;
  if (hours < 48) return `${Math.round(hours)} ساعة`;
  return `${Math.round(hours / 24)} يوم`;
}

/** تصفية رسالة فشل الربط: سطر واحد قصير، بلا أي شيء يشبه رمزاً أو سراً. */
export function sanitizeOAuthFailureMessage(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\b(?:sk|pk|ghp|gho|EAA|ya29|AIza)[A-Za-z0-9._-]{8,}/g, '[محجوب]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[محجوب]')
    .trim()
    .slice(0, 200);
}

export function buildSalesReadiness(input: SalesReadinessInput): SalesReadinessReport {
  const items: ReadinessItem[] = [];
  const push = (item: ReadinessItem) => items.push(item);

  // 1) زبائن ينتظرون — أعلى أثر مباشر على البيع.
  const waitHours = hoursBetween(input.pendingApprovals.oldestAt, input.nowIso);
  if (input.pendingApprovals.count > 0) {
    const blocker = waitHours !== null && waitHours >= CUSTOMER_WAIT_BLOCKER_HOURS;
    push({
      id: 'customers-waiting', area: 'customers', actor: 'owner',
      severity: blocker ? 'blocker' : 'warning',
      title: `${input.pendingApprovals.count} رد على زبائن ينتظر موافقتك`,
      detail: waitHours !== null
        ? `أقدم زبون ينتظر منذ ${formatWait(waitHours)}. الرد لا يُرسل قبل موافقتك (وضع الموافقة).`
        : 'الرد لا يُرسل قبل موافقتك (وضع الموافقة).',
      action: 'افتح صندوق الموافقات وراجع الردود المقترحة ووافق عليها.',
    });
  } else {
    push({ id: 'customers-waiting', area: 'customers', actor: 'owner', severity: 'ok', title: 'لا زبائن ينتظرون الموافقة', detail: 'كل الردود المقترحة حُسمت.', action: '' });
  }

  // 2) وضع YouTube فقط يحجب كل المنصات الأخرى.
  if (input.youtubeOnlyMode) {
    push({
      id: 'youtube-only-mode', area: 'system', actor: 'owner', severity: 'blocker',
      title: 'وضع «YouTube فقط» مفعّل',
      detail: 'المتغير YOUTUBE_ONLY_OPERATIONAL يمنع أي رد أو نشر على فيسبوك وإنستغرام وواتساب وكل منصة غير يوتيوب.',
      action: 'في Render ← al-gharabi-ai ← Environment: احذف YOUTUBE_ONLY_OPERATIONAL أو اجعله false، ثم احفظ.',
    });
  }

  // 3) المنصات الأساسية للبيع.
  const byId = new Map(input.platforms.map((p) => [p.id, p]));
  for (const id of CORE_SALES_PLATFORMS) {
    const p = byId.get(id);
    if (!p || !p.realConnector) continue;
    if (p.connected) {
      push({ id: `platform-${id}`, area: 'platforms', actor: 'owner', severity: 'ok', title: `${p.name} متصل`, detail: 'اتصال موثّق من المزود.', action: '' });
      continue;
    }
    const failure = p.lastOAuthFailure && p.lastOAuthFailure.message ? p.lastOAuthFailure : null;
    const important = id === 'whatsapp' || id === 'facebook' || id === 'instagram';
    if (failure) {
      push({
        id: `platform-${id}`, area: 'platforms', actor: 'owner', severity: important ? 'blocker' : 'warning',
        title: `فشل ربط ${p.name}`,
        detail: `آخر محاولة ربط فشلت: «${failure.message}».`,
        action: /client secret|invalid_client|secret/i.test(failure.message)
          ? `سر تطبيق ${p.name} في Render خاطئ: انسخ السر الصحيح من لوحة المزود، ثم أعد الربط من مركز ربط المنصات.`
          : `راجع إعداد تطبيق ${p.name} لدى المزود، ثم أعد الربط من مركز ربط المنصات.`,
      });
    } else if (!p.credentialsConfigured) {
      push({
        id: `platform-${id}`, area: 'platforms', actor: 'owner', severity: important ? 'warning' : 'info',
        title: `${p.name} غير مهيّأ`,
        detail: 'بيانات تطبيق المزود غير مضبوطة في الخادم، فلا يمكن بدء الربط.',
        action: `أضف متغيرات ${p.name} في Render (الأسماء في .env.example)، ثم اربط من مركز ربط المنصات.`,
      });
    } else {
      push({
        id: `platform-${id}`, area: 'platforms', actor: 'owner', severity: important ? 'warning' : 'info',
        title: `${p.name} جاهز للربط وغير مربوط`,
        detail: 'الإعداد موجود، لكن الحساب لم يُربط بعد.',
        action: `اضغط «ربط» لـ ${p.name} في مركز ربط المنصات.`,
      });
    }
  }
  const connectedCore = CORE_SALES_PLATFORMS.filter((id) => byId.get(id)?.connected);
  if (connectedCore.length === 0) {
    push({
      id: 'no-sales-channel', area: 'platforms', actor: 'owner', severity: 'blocker',
      title: 'لا توجد أي منصة بيع متصلة',
      detail: 'الموظف لا يستطيع استقبال زبون أو الرد أو النشر.',
      action: 'اربط فيسبوك أو واتساب أولاً من مركز ربط المنصات.',
    });
  }

  // 4) التنبيه الخارجي — بدونه لا يعلم المالك بالزبون (بريد ملخّص + Telegram فوري).
  const telegramOn = input.ownerAlerts.telegramConfigured === true;
  const anyChannel = input.ownerAlerts.emailConfigured || telegramOn;
  if (!anyChannel) {
    push({
      id: 'owner-alerts', area: 'customers', actor: 'owner', severity: 'blocker',
      title: 'لا قناة تنبيه مهيّأة',
      detail: 'لن يصلك أي تنبيه عند وصول زبون أو تصعيد أو انقطاع منصة.',
      action: 'اضبط OWNER_EMAIL وRESEND_API_KEY وRESEND_FROM_EMAIL في Render، أو OWNER_TELEGRAM_CHAT_ID مع بوت تيليغرام.',
    });
  } else if (!input.ownerAlerts.enabled) {
    push({
      id: 'owner-alerts', area: 'customers', actor: 'owner', severity: 'warning',
      title: 'تنبيه المالك موقوف',
      detail: 'لن يصلك تنبيه عند وصول زبون.',
      action: 'فعّل «تنبيه المالك» من لوحة التحكم.',
    });
  } else {
    const channels = [input.ownerAlerts.emailConfigured ? 'البريد (ملخّص كل 30 دقيقة)' : null, telegramOn ? 'Telegram (فوري)' : null].filter(Boolean).join(' + ');
    push({ id: 'owner-alerts', area: 'customers', actor: 'owner', severity: 'ok', title: 'تنبيه المالك مفعّل', detail: `القنوات: ${channels}.`, action: '' });
  }
  if (anyChannel && !telegramOn) {
    push({
      id: 'owner-telegram', area: 'customers', actor: 'owner', severity: 'info',
      title: 'التنبيه الفوري على Telegram غير مفعّل',
      detail: 'البريد يصل كملخص كل 30 دقيقة؛ Telegram يوصل كل زبون جديد إلى هاتفك خلال ثوانٍ.',
      action: 'أرسل أي رسالة لبوت المعرض على Telegram، واحصل على رقم محادثتك (مثلاً من @userinfobot)، ثم ضعه في OWNER_TELEGRAM_CHAT_ID في Render.',
    });
  }

  // 5) المتابعة التجارية.
  push(input.commercialBrainEnabled
    ? { id: 'commercial-brain', area: 'automation', actor: 'owner', severity: 'ok', title: 'العقل التجاري يعمل', detail: 'يتابع الزبائن المؤهلين وفق قواعد المتابعة.', action: '' }
    : {
      id: 'commercial-brain', area: 'automation', actor: 'owner', severity: 'warning',
      title: 'العقل التجاري موقوف',
      detail: 'الزبون الذي سأل ولم يشترِ لا يُتابَع.',
      action: 'فعّل العقل التجاري من لوحة التحكم (المتابعة تبقى عبر بوابة الموافقة).',
    });

  // 6) النشر المجدول.
  if (input.readyJobs > 0 && !input.autoExecuteEnabled) {
    push({
      id: 'ready-jobs', area: 'automation', actor: 'owner', severity: 'warning',
      title: `${input.readyJobs} منشور معتمد حان موعده ولم يُنشر`,
      detail: 'التنفيذ التلقائي للمعتمد معطّل، فتنتظر المنشورات ضغطة تنفيذ.',
      action: 'نفّذها من «الجدولة والتقويم ← طابور مهام النشر»، أو فعّل «نشر المعتمد تلقائياً في موعده» هناك.',
    });
  }

  // 7) محتوى بسعر قديم.
  if (input.staleMarketing.unpublished > 0) {
    push({
      id: 'stale-marketing-drafts', area: 'content', actor: 'owner', severity: 'warning',
      title: `${input.staleMarketing.unpublished} مسودة تسويق بقسط قديم`,
      detail: 'وُلّدت قبل تصحيح الحسبة، فقسطها أقل من الكتالوج (بلا نسبة الزيادة).',
      action: 'أعد توليدها من وكيل التسويق قبل النشر، أو احذفها.',
    });
  }
  if (input.staleMarketing.published > 0) {
    push({
      id: 'stale-marketing-published', area: 'content', actor: 'owner', severity: 'info',
      title: `${input.staleMarketing.published} منشور منشور بقسط قديم`,
      detail: 'نُشر بقسط أقل من الكتالوج قبل التصحيح؛ قد يطالب زبون بالرقم المنشور.',
      action: 'راجع المنشورات وعدّلها أو احذفها من حساب المنصة.',
    });
  }

  // 8) النسخة الاحتياطية — ضياع بيانات الزبائن والمنتجات يوقف البيع كلياً.
  if (input.backup) {
    const b = input.backup;
    const age = b.ageHours == null ? null : b.ageHours < 1 ? 'أقل من ساعة' : `${Math.round(b.ageHours)} ساعة`;
    const why = b.lastError
      ? `آخر خطأ: «${String(b.lastError).slice(0, 80)}».`
      : b.lastSkippedReason === 'pressure_defer' ? 'السبب: تأجيل بسبب اقتراب حدود الخطة المجانية.' : '';
    const authLike = /NOT_AUTHORIZED|invalid_grant|reauth|unauthor|401|token/i.test(String(b.lastError || ''));
    if (!b.configured) {
      push({
        id: 'backup', area: 'system', actor: 'owner', severity: 'blocker',
        title: 'النسخ الاحتياطي غير مفعّل',
        detail: 'لا نسخة احتياطية لبيانات الزبائن والمنتجات والمبيعات؛ أي عطل في قاعدة البيانات يُفقدها.',
        action: 'افتح «النسخ السحابية» في التطبيق واربط Google Drive.',
      });
    } else if (b.level === 'ok') {
      push({ id: 'backup', area: 'system', actor: 'system', severity: 'ok', title: 'النسخة الاحتياطية حديثة', detail: `آخر نسخة ناجحة قبل ${age}.`, action: '' });
    } else {
      push({
        id: 'backup', area: 'system', actor: authLike ? 'owner' : 'system', severity: b.level === 'critical' ? 'blocker' : 'warning',
        title: age ? `النسخة الاحتياطية متوقفة منذ ${age}` : 'لا نسخة احتياطية ناجحة معروفة',
        detail: `يُفترض نسخة كل 6 ساعات. ${why}`.trim(),
        action: authLike
          ? 'تفويض Google Drive انتهى: افتح «النسخ السحابية» واضغط «ربط Google Drive» من جديد، ثم «نسخة الآن».'
          : 'افتح «النسخ السحابية» واضغط «نسخة الآن»؛ النظام يعيد المحاولة تلقائياً كل 30 دقيقة.',
      });
    }
  }

  // 8b) النشر الفعلي — «متصل» لا يعني «ينشر»: نقرأ آخر نتيجة حقيقية لكل منصة.
  const DAY = 24 * 60 * 60 * 1000;
  const nowMs = Date.parse(input.nowIso);
  const failingNow = (p: PublishHealthPlatform) => Boolean(p.lastFailureAt) && (!p.lastSuccessAt || Date.parse(p.lastFailureAt!) > Date.parse(p.lastSuccessAt));
  if (input.publishing && input.publishing.length) {
    const working: string[] = [];
    for (const p of input.publishing) {
      if (failingNow(p) && p.lastFailure) {
        const hint = publishFailureHint(p.name, p.lastFailure);
        const n = p.consecutiveFailures;
        push({
          id: `publish-${p.platform}`, area: 'platforms', actor: hint.actor, severity: 'warning',
          title: n > 1 ? `آخر ${n} محاولات نشر على ${p.name} فشلت` : `آخر نشر على ${p.name} فشل`,
          detail: `السبب من ${p.name}: «${p.lastFailure.error}».${p.lastSuccessAt ? '' : ' لم يُسجَّل أي نشر ناجح على هذه المنصة بعد.'}`,
          action: hint.action,
        });
        continue;
      }
      if (!p.lastSuccessAt) {
        push({
          id: `publish-${p.platform}`, area: 'content', actor: 'owner', severity: 'info',
          title: `لم يُنشر على ${p.name} بعد`,
          detail: 'المنصة متصلة لكن لا يوجد منشور ناجح مسجّل عليها.',
          action: `انشر أول منتج على ${p.name} من مركز المحتوى.`,
        });
        continue;
      }
      const days = Number.isFinite(nowMs) ? Math.floor((nowMs - Date.parse(p.lastSuccessAt)) / DAY) : 0;
      if (days >= 7) {
        push({
          id: `publish-${p.platform}`, area: 'content', actor: 'owner', severity: 'info',
          title: `لا نشر على ${p.name} منذ ${days} يوماً`,
          detail: 'النشر يعمل، لكن الصفحة ساكتة؛ الزبون يرى منشورات قديمة.',
          action: `انشر منتجاً أو عرضاً على ${p.name} من مركز المحتوى.`,
        });
      }
      working.push(p.name);
    }
    if (working.length) {
      push({ id: 'publish-health', area: 'platforms', actor: 'system', severity: 'ok', title: 'النشر يعمل فعلياً', detail: `آخر نشر نجح بمعرّف حقيقي من المنصة على: ${working.join('، ')}.`, action: '' });
    }
  }

  // 8c) قراءة تعليقات الزبائن — منصة متصلة لا تُقرأ تعليقاتها = زبائن بلا رد.
  for (const c of input.commentIngest || []) {
    if (!c.failing) continue;
    const reauth = /\.190\b|REAUTH|TOKEN/i.test(String(c.code || ''));
    push({
      id: `comments-${c.platform}`, area: 'customers', actor: reauth ? 'owner' : 'system', severity: 'blocker',
      title: `تعليقات ${c.name} لا تصل`,
      detail: c.reason,
      action: reauth
        ? `انتهى تفويض ${c.name}: أعد الربط من مركز ربط المنصات.`
        : 'النظام يعيد القراءة كل دورة تلقائياً؛ إن استمر أكثر من ساعة راجع صلاحيات القراءة في لوحة المزود.',
    });
  }

  // 9) معلومات النظام.
  if (input.sendMode !== 'auto') {
    push({
      id: 'send-mode', area: 'customers', actor: 'owner', severity: 'info',
      title: 'وضع الموافقة مفعّل (آمن)',
      detail: 'كل رد على زبون يحتاج موافقتك قبل الإرسال.',
      action: '',
    });
  }
  if (!input.geminiConfigured) {
    push({
      id: 'gemini', area: 'system', actor: 'owner', severity: 'info',
      title: 'Gemini غير مهيّأ',
      detail: 'الردود والمحتوى تعمل بالمحرك المحلي الحتمي؛ Gemini تحسين اختياري.',
      action: '',
    });
  }

  items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const counts: Record<ReadinessSeverity, number> = { blocker: 0, warning: 0, info: 0, ok: 0 };
  for (const it of items) counts[it.severity] += 1;

  // الدرجة: القدرات التجارية الأساسية (منصات البيع + التنبيه + المتابعة + لا انتظار + لا حجب).
  const checks: boolean[] = [
    ...CORE_SALES_PLATFORMS.filter((id) => byId.get(id)?.realConnector).map((id) => Boolean(byId.get(id)?.connected)),
    input.ownerAlerts.enabled && (input.ownerAlerts.emailConfigured || input.ownerAlerts.telegramConfigured === true),
    input.commercialBrainEnabled,
    !input.youtubeOnlyMode,
    !(waitHours !== null && waitHours >= CUSTOMER_WAIT_BLOCKER_HOURS && input.pendingApprovals.count > 0),
    input.staleMarketing.unpublished === 0,
    ...(input.backup ? [input.backup.configured && input.backup.level !== 'critical'] : []),
    ...(input.publishing && input.publishing.length ? [input.publishing.every((p) => !failingNow(p))] : []),
    ...(input.commentIngest && input.commentIngest.length ? [input.commentIngest.every((c) => !c.failing)] : []),
  ];
  const score = checks.length ? Math.round((checks.filter(Boolean).length / checks.length) * 100) : 0;
  const verdict: SalesReadinessReport['verdict'] = counts.blocker > 0 ? 'blocked' : counts.warning > 0 ? 'partial' : 'selling';
  const verdictText = verdict === 'blocked'
    ? `يوجد ${counts.blocker} عائق يمنع البيع الآن`
    : verdict === 'partial'
      ? `الموظف يعمل جزئياً — ${counts.warning} بند يحتاج إجراءً`
      : 'الموظف جاهز للبيع على كل القنوات المهيّأة';

  return { generatedAt: input.nowIso, score, verdict, verdictText, counts, items };
}
