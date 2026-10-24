/**
 * تنبيهات المالك الخارجية (B1 + Y2) — منطق صافٍ قابل للاختبار.
 *
 * الغرض: إعلام المالك خارج التطبيق (بريد Resend) عند ثلاثة أحداث تشغيلية:
 *   1) استفسار زبون جديد يُنشئ مسودة بانتظار الموافقة.
 *   2) تصعيد بشري (social_escalation).
 *   3) انقطاع رمز منصة (reauth_needed).
 *
 * القواعد الملزمة:
 *   - **تجميع**: رسالة واحدة كحد أقصى كل 30 دقيقة تجمع ما تراكم (لا إغراق).
 *   - **لا تكرار**: نفس الحدث لا يُنبَّه عنه مرتين (مفتاح منع تكرار محفوظ).
 *   - **لا يستهلك Gemini**: لا AI هنا ولا في أي مسار يستدعي هذه الوحدة.
 *   - **لا يُرسل أي شيء للزبون**: البريد للمالك وحده (OWNER_EMAIL).
 *   - **لا سرّ**: لا مفاتيح ولا توكنات في الحالة ولا في الملخّص العام.
 *
 * الوحدة لا تعرف الشبكة ولا الساعة الحقيقية: الزمن يُمرَّر صراحةً، والإرسال يقع
 * في الخادم (Resend القائم). إعادة استخدام كامل بلا نظام تنبيه ثانٍ.
 */

export type OwnerAlertKind = 'commercial_draft' | 'social_escalation' | 'platform_reauth';

export const OWNER_ALERT_KIND_LABELS_AR: Readonly<Record<OwnerAlertKind, string>> = Object.freeze({
  commercial_draft: 'استفسار زبون يحتاج موافقتك',
  social_escalation: 'تصعيد يحتاج مراجعة بشرية',
  platform_reauth: 'انقطاع ربط منصة يحتاج إعادة ربط',
});

export type OwnerAlertSendResult = 'sent' | 'disabled' | 'no_provider' | 'empty' | 'failed';

export interface OwnerAlertItem {
  /** مفتاح منع التكرار (نوع + منصة + معرّف الحدث). */
  key: string;
  kind: OwnerAlertKind;
  platform: string | null;
  /** وصف مختصر (بلا بيانات حسّاسة زائدة). */
  title: string;
  /** أول 120 حرفاً من نص التعليق/الرسالة — يُقصّ في الخادم قبل الإدراج. */
  snippet: string;
  /** طابع الإنشاء (ISO) — يُمرَّر، لا يُقرأ من الساعة. */
  at: string;
}

export interface OwnerAlertState {
  /** مفتاح تشغيل/إيقاف المالك — **الافتراضي مفعّل**. */
  enabled: boolean;
  /** الأحداث المتراكمة بانتظار الدفعة القادمة. */
  pending: OwnerAlertItem[];
  /** مفاتيح أُرسل بها تنبيه (لمنع تكرار نفس الحدث). */
  sentKeys: string[];
  /** آخر وقت إرسال فعلي (ISO) — أساس نافذة الـ30 دقيقة. */
  lastSentAt: string | null;
  /** نتيجة آخر دورة إرسال (بلا سرّ). */
  lastResult: OwnerAlertSendResult | null;
  /** سبب آخر فشل مختصر (كود تقني فقط). */
  lastError: string | null;
  /** إجمالي التنبيهات المُرسلة منذ بدء القياس. */
  sentCount: number;
  /** إجمالي الأحداث التي لم تُرسل لغياب مزوّد البريد. */
  skippedNoProvider: number;
}

/** نافذة التجميع: رسالة واحدة كحد أقصى كل 30 دقيقة. */
export const OWNER_ALERT_BATCH_WINDOW_MS = 30 * 60 * 1000;

/** سقف طول مقتطف نص العميل في التنبيه (120 حرفاً كما طُلب). */
export const OWNER_ALERT_SNIPPET_MAX = 120;

/** سقوف تمنع أي نمو غير محدود في الحالة المحفوظة. */
export const OWNER_ALERT_MAX_PENDING = 200;
export const OWNER_ALERT_MAX_SENT_KEYS = 500;

/** حالة ابتدائية: مفعّل، بلا أحداث. */
export function defaultOwnerAlertState(): OwnerAlertState {
  return {
    enabled: true,
    pending: [],
    sentKeys: [],
    lastSentAt: null,
    lastResult: null,
    lastError: null,
    sentCount: 0,
    skippedNoProvider: 0,
  };
}

/** يُطبّع أي لقطة محفوظة (توافق خلفي: غياب الحقل ⇒ مفعّل). */
export function normalizeOwnerAlertState(raw: unknown): OwnerAlertState {
  const base = defaultOwnerAlertState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const pending = Array.isArray(r.pending)
    ? (r.pending as unknown[])
        .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'))
        .map((x) => ({
          key: String(x.key || ''),
          kind: (['commercial_draft', 'social_escalation', 'platform_reauth'] as OwnerAlertKind[]).includes(x.kind as OwnerAlertKind)
            ? (x.kind as OwnerAlertKind)
            : 'social_escalation',
          platform: x.platform == null ? null : String(x.platform),
          title: String(x.title || '').slice(0, 200),
          snippet: String(x.snippet || '').slice(0, OWNER_ALERT_SNIPPET_MAX),
          at: String(x.at || ''),
        }))
        .filter((x) => x.key.length > 0)
        .slice(-OWNER_ALERT_MAX_PENDING)
    : [];
  return {
    // الافتراضي مفعّل: أي قيمة غير false صريحة تُبقي التنبيه مفعّلاً.
    enabled: r.enabled === false ? false : true,
    pending,
    sentKeys: Array.isArray(r.sentKeys) ? (r.sentKeys as unknown[]).map((k) => String(k)).slice(-OWNER_ALERT_MAX_SENT_KEYS) : [],
    lastSentAt: typeof r.lastSentAt === 'string' ? r.lastSentAt : null,
    lastResult: (['sent', 'disabled', 'no_provider', 'empty', 'failed'] as OwnerAlertSendResult[]).includes(r.lastResult as OwnerAlertSendResult)
      ? (r.lastResult as OwnerAlertSendResult)
      : null,
    lastError: typeof r.lastError === 'string' ? r.lastError.slice(0, 80) : null,
    sentCount: Number.isFinite(r.sentCount) ? Math.max(0, Number(r.sentCount)) : 0,
    skippedNoProvider: Number.isFinite(r.skippedNoProvider) ? Math.max(0, Number(r.skippedNoProvider)) : 0,
  };
}

/** يقصّ مقتطف نص العميل إلى 120 حرفاً ويوحّد المسافات (بلا سرّ). */
export function truncateAlertSnippet(text: unknown): string {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.slice(0, OWNER_ALERT_SNIPPET_MAX);
}

/** مفتاح منع التكرار لنفس الحدث. */
export function ownerAlertKey(kind: OwnerAlertKind, platform: string | null, id: string): string {
  return `${kind}:${platform || '-'}:${String(id)}`;
}

/**
 * يُدرج حدثاً جديداً في الطابور. **لا تكرار**: يُتجاهل إن كان مفتاحه قد أُرسل
 * سابقاً أو ما زال معلّقاً. يُتجاهل كلياً إن كان التنبيه معطّلاً من المالك.
 * يُعيد الحالة الجديدة (لا يُعدّل المدخل).
 */
export function enqueueOwnerAlert(state: OwnerAlertState, item: OwnerAlertItem, _nowMs?: number): OwnerAlertState {
  if (!state.enabled) return state;
  const key = String(item.key || '');
  if (!key) return state;
  if (state.sentKeys.includes(key)) return state;
  if (state.pending.some((p) => p.key === key)) return state;
  const next: OwnerAlertItem = {
    key,
    kind: item.kind,
    platform: item.platform == null ? null : String(item.platform),
    title: String(item.title || '').slice(0, 200),
    snippet: truncateAlertSnippet(item.snippet),
    at: String(item.at || ''),
  };
  const pending = [...state.pending, next].slice(-OWNER_ALERT_MAX_PENDING);
  return { ...state, pending };
}

/**
 * هل يحين إرسال دفعة؟ يلزم: مفعّل + أحداث معلّقة + مضى 30 دقيقة على آخر إرسال
 * (أو لا إرسال سابق). أول تنبيه يُرسل فوراً بلا انتظار.
 */
export function isOwnerAlertDue(state: OwnerAlertState, nowMs: number): boolean {
  if (!state.enabled) return false;
  if (state.pending.length === 0) return false;
  if (!state.lastSentAt) return true;
  const last = Date.parse(state.lastSentAt);
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= OWNER_ALERT_BATCH_WINDOW_MS;
}

/** عدد المعلّق لكل نوع — يُعرض في الملخّص بلا بيانات عملاء. */
export function ownerAlertCountsByKind(state: OwnerAlertState): Record<OwnerAlertKind, number> {
  const out: Record<OwnerAlertKind, number> = { commercial_draft: 0, social_escalation: 0, platform_reauth: 0 };
  for (const p of state.pending) out[p.kind] += 1;
  return out;
}

/** يبني نص/HTML الدفعة المجمّعة (عربي RTL). لا سرّ ولا معرّف عميل زائد. */
export function buildOwnerAlertDigest(state: OwnerAlertState, appUrl: string | null): { count: number; subject: string; text: string; html: string } {
  const count = state.pending.length;
  const counts = ownerAlertCountsByKind(state);
  const approvalsUrl = appUrl ? `${appUrl.replace(/\/$/, '')}/?tab=commercial_inbox` : null;
  const subject = `تنبيه الغرابي AI — ${count} ${count === 1 ? 'حدث يحتاج انتباهك' : 'أحداث تحتاج انتباهك'}`;

  const lines: string[] = [];
  lines.push(`لديك ${count} حدثاً يحتاج انتباهك:`);
  if (counts.commercial_draft) lines.push(`- استفسارات زبائن تنتظر موافقتك: ${counts.commercial_draft}`);
  if (counts.social_escalation) lines.push(`- تصعيدات تحتاج مراجعة بشرية: ${counts.social_escalation}`);
  if (counts.platform_reauth) lines.push(`- منصات تحتاج إعادة ربط: ${counts.platform_reauth}`);
  lines.push('');
  for (const p of state.pending) {
    lines.push(`• [${OWNER_ALERT_KIND_LABELS_AR[p.kind]}]${p.platform ? ` (${p.platform})` : ''} — ${p.snippet || p.title}`);
  }
  if (approvalsUrl) {
    lines.push('');
    lines.push(`صفحة الموافقات: ${approvalsUrl}`);
  }

  const rowsHtml = state.pending
    .map(
      (p) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #334155;font-size:12px;color:#94a3b8;white-space:nowrap;">${OWNER_ALERT_KIND_LABELS_AR[p.kind]}${p.platform ? `<br/><span style="color:#64748b;">${p.platform}</span>` : ''}</td><td style="padding:8px 10px;border-bottom:1px solid #334155;font-size:12px;color:#e2e8f0;">${escapeHtml(p.snippet || p.title)}</td></tr>`,
    )
    .join('');
  const linkHtml = approvalsUrl
    ? `<p style="margin:20px 0 0;font-size:12px;"><a href="${escapeHtml(approvalsUrl)}" style="color:#34d399;">فتح صفحة الموافقات</a></p>`
    : '';
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;padding:24px;background:#0f172a;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:16px;">
      <tr><td style="padding:24px;">
        <h1 style="margin:0 0 6px;font-size:17px;color:#34d399;">معرض الغرابي للتقسيط</h1>
        <p style="margin:0 0 16px;font-size:13px;color:#94a3b8;">${count} ${count === 1 ? 'حدث يحتاج انتباهك' : 'أحداث تحتاج انتباهك'}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>
        ${linkHtml}
      </td></tr>
    </table>
  </body>
</html>`;

  return { count, subject, text: lines.join('\n'), html };
}

/** يُسجّل نتيجة الإرسال ويُفرّغ المعلّق عند النجاح فقط. */
export function markOwnerAlertSent(
  state: OwnerAlertState,
  nowMs: number,
  result: OwnerAlertSendResult,
  error: string | null = null,
): OwnerAlertState {
  const iso = new Date(nowMs).toISOString();
  if (result === 'sent') {
    const keys = [...state.sentKeys, ...state.pending.map((p) => p.key)].slice(-OWNER_ALERT_MAX_SENT_KEYS);
    return {
      ...state,
      pending: [],
      sentKeys: keys,
      lastSentAt: iso,
      lastResult: 'sent',
      lastError: null,
      sentCount: state.sentCount + 1,
    };
  }
  if (result === 'no_provider') {
    // لا مزوّد: لا نُفرّغ المعلّق (قد يُضبط لاحقاً) ونُعلن السبب بصراحة.
    return { ...state, lastResult: 'no_provider', lastError: 'email_provider_not_configured', skippedNoProvider: state.skippedNoProvider + 1 };
  }
  if (result === 'failed') {
    return { ...state, lastResult: 'failed', lastError: String(error || 'send_failed').slice(0, 80) };
  }
  return { ...state, lastResult: result, lastError: null };
}

/** يبدّل مفتاح التشغيل/الإيقاف (للمالك). عند الإيقاف لا تُدرج أحداث جديدة. */
export function setOwnerAlertEnabled(state: OwnerAlertState, enabled: boolean): OwnerAlertState {
  return { ...state, enabled: enabled === true };
}

/**
 * يُزامن تنبيهات انقطاع الربط مع الحالات الحيّة: يُدرج حدثاً لكل منصة حالتها
 * `reauth_needed` لم يُنبَّه عنها، و**يُزيل** مفتاحها عند استعادة الاتصال
 * (فلو انقطع ثانيةً يُنبَّه من جديد). لا بيانات عملاء.
 */
export function syncReauthAlerts(
  state: OwnerAlertState,
  connections: Array<{ platform: string; status?: string }>,
  nowIso: string,
): OwnerAlertState {
  if (!state.enabled) return state;
  let next = state;
  const connected = new Set(connections.filter((c) => c.status === 'connected').map((c) => c.platform));
  // استعادة الاتصال ⇒ إزالة مفتاح التنبيه لهذه المنصة.
  const staleKeys = state.sentKeys.filter((k) => {
    if (!k.startsWith('platform_reauth:')) return false;
    const platform = k.split(':')[1];
    return connected.has(platform);
  });
  if (staleKeys.length) next = { ...next, sentKeys: next.sentKeys.filter((k) => !staleKeys.includes(k)) };
  for (const c of connections) {
    if (c.status !== 'reauth_needed') continue;
    next = enqueueOwnerAlert(next, {
      key: ownerAlertKey('platform_reauth', c.platform, 'reauth'),
      kind: 'platform_reauth',
      platform: c.platform,
      title: `إعادة ربط ${c.platform} مطلوبة`,
      snippet: `انقطع رمز ${c.platform}؛ أعد الربط من مركز ربط المنصات.`,
      at: nowIso,
    });
  }
  return next;
}

/** كتلة عرض عامة (بلا سرّ ولا بيانات عملاء) للحالة/الجاهزية. */
export function ownerAlertPublicBlock(state: OwnerAlertState, emailProviderConfigured: boolean) {
  const counts = ownerAlertCountsByKind(state);
  return {
    enabled: state.enabled,
    emailProviderConfigured,
    batching: true,
    windowMinutes: Math.round(OWNER_ALERT_BATCH_WINDOW_MS / 60000),
    pending: state.pending.length,
    pendingByKind: counts,
    lastSentAt: state.lastSentAt,
    lastResult: state.lastResult,
    lastError: state.lastError,
    sentCount: state.sentCount,
    skippedNoProvider: state.skippedNoProvider,
    note: 'تنبيه خارجي للمالك عبر Resend؛ بلا Gemini وبلا أي رسالة للزبون. غياب إعداد البريد = تعطيل صامت معلن.',
  };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
