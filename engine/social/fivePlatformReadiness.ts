/**
 * جاهزية المنصات الخمس المربوطة (فيسبوك، إنستغرام، يوتيوب، تيك توك، ثريدز) —
 * تشخيص حتمي صادق لكل منصة: هل يقرأ العقل التعليقات؟ هل يجهّز الرد وينتظر نقرتك؟
 * هل ينشر المنشور الموحّد؟ هل يقيس النتائج ويتعلّم؟ وما الذي ينقص بالضبط ومن يصلحه.
 *
 * صافٍ بلا شبكة ولا أسرار: كل حقيقة تأتي من حالة الخادم الحقيقية. ما لا توفره
 * واجهة المنصة الرسمية يُعلن «غير متاح من المنصة» صراحةً، لا «قريباً» ولا وهماً.
 */

export const FIVE_PLATFORMS = Object.freeze(['facebook', 'instagram', 'youtube', 'tiktok', 'threads'] as const);
export type FivePlatform = (typeof FIVE_PLATFORMS)[number];

export type ReadyState = 'ready' | 'partial' | 'blocked' | 'unavailable';

export interface FivePlatformInput {
  platform: FivePlatform;
  name: string;
  connected: boolean;
  capabilities: readonly string[];
  /** القراءة: آخر محاولة وآخر استقبال فعلي وآخر خطأ (من مراقب المنصة). */
  read: { attempted: boolean; ok: boolean | null; lastIngestAt: string | null; errorCode: string | null; error: string | null };
  /** مفاتيح المالك للمنصة. */
  watcher: { enabled: boolean; paused: boolean; autoReply: boolean } | null;
  /** ردود جاهزة بانتظار نقرتك لهذه المنصة. */
  approvals: { pending: number; oldestPendingAt: string | null; sent24h: number };
  /** آخر نشر حقيقي على المنصة (من سجل النشر). */
  lastPublish: { at: string | null; ok: boolean | null; code: string | null };
  /** القياس بعد النشر (مزامنة الأرقام). */
  metrics: { posts: number; withMetrics: number; issue: string | null } | null;
}

export interface ReadinessLine { key: string; label: string; state: ReadyState; detail: string; fix: string | null }

export interface FivePlatformRow {
  platform: FivePlatform;
  name: string;
  connected: boolean;
  state: ReadyState;
  lines: ReadinessLine[];
  /** ما يحدث للرد الآن بكلمة واحدة: «جاهز بانتظار نقرتك» / «تلقائي» / «متوقف» / «غير متاح». */
  replyMode: 'prepare' | 'auto' | 'off' | 'unavailable';
  replyModeLabelAr: string;
  pendingReplies: number;
}

const MEDIA_RULE_AR: Record<FivePlatform, string> = {
  facebook: 'يقبل نصاً أو صورة أو فيديو.',
  instagram: 'يحتاج صورة أو فيديو (لا نص مجرّد).',
  youtube: 'يحتاج فيديو.',
  tiktok: 'يحتاج فيديو أو صوراً؛ يصل إلى صندوق مسودات تيك توك وتكمل النشر من التطبيق (النشر العلني المباشر يحتاج تدقيق تيك توك لتطبيقنا).',
  threads: 'يقبل نصاً أو صورة أو فيديو.',
};

/** «منذ …» بالعربية من الوقت الحقيقي (بلا تاريخ خام في النص). */
export function agoAr(iso: string | null, nowMs: number): string {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return '—';
  const m = Math.max(0, Math.round((nowMs - t) / 60000));
  if (m < 1) return 'الآن';
  if (m < 60) return `منذ ${m} د`;
  const h = Math.round(m / 60);
  if (h < 48) return `منذ ${h} س`;
  return `منذ ${Math.round(h / 24)} يوم`;
}

function worst(states: ReadyState[]): ReadyState {
  const used = states.filter((s) => s !== 'unavailable');
  if (!used.length) return 'unavailable';
  if (used.includes('blocked')) return 'blocked';
  if (used.includes('partial')) return 'partial';
  return 'ready';
}

export function buildFivePlatformReadiness(inputs: readonly FivePlatformInput[], ctx: { sendMode: string; nowMs: number }): { rows: FivePlatformRow[]; summary: { ready: number; partial: number; blocked: number; pendingReplies: number }; sendModeLabelAr: string } {
  const approvalMode = String(ctx.sendMode || '').toLowerCase() !== 'auto';
  const rows: FivePlatformRow[] = inputs.map((p) => {
    const lines: ReadinessLine[] = [];
    const has = (c: string) => p.capabilities.includes(c);
    // 1) الاتصال
    lines.push(p.connected
      ? { key: 'connection', label: 'الربط', state: 'ready', detail: 'متصل باتصال موثّق من المنصة.', fix: null }
      : { key: 'connection', label: 'الربط', state: 'blocked', detail: 'غير متصل.', fix: `اربط ${p.name} من مركز ربط المنصات.` });

    // 2) قراءة التعليقات
    if (!has('comments')) {
      lines.push({ key: 'read', label: 'قراءة التعليقات', state: 'unavailable', detail: `${p.name} لا يتيح قراءة التعليقات عبر واجهته الرسمية للتطبيقات؛ الردود من تطبيق ${p.name} نفسه.`, fix: null });
    } else if (!p.connected) {
      lines.push({ key: 'read', label: 'قراءة التعليقات', state: 'blocked', detail: 'تتوقف حتى الربط.', fix: null });
    } else if (p.watcher && !p.watcher.enabled) {
      lines.push({ key: 'read', label: 'قراءة التعليقات', state: 'blocked', detail: 'المراقبة معطّلة من المالك.', fix: 'شغّل مراقب المنصة من مركز السيطرة.' });
    } else if (p.read.ok === false) {
      const perm = p.read.errorCode === 'PERMISSION_MISSING';
      lines.push({ key: 'read', label: 'قراءة التعليقات', state: 'blocked', detail: perm ? 'المنصة رفضت القراءة: إذن قراءة التعليقات غير ممنوح لتطبيقنا.' : `آخر محاولة قراءة فشلت${p.read.error ? `: ${p.read.error}` : ''}.`,
        fix: perm ? `فعّل إذن قراءة الردود في تطبيق ${p.name} لدى Meta، ثم أعد ربط ${p.name}.` : 'يعالجها المهندس المشرف تلقائياً؛ إن استمرت أعد الربط.' });
    } else if (!p.read.attempted) {
      lines.push({ key: 'read', label: 'قراءة التعليقات', state: 'partial', detail: 'لم تُجرَ محاولة قراءة بعد منذ الإقلاع (تبدأ مع أول دورة).', fix: null });
    } else {
      lines.push({ key: 'read', label: 'قراءة التعليقات', state: 'ready', detail: p.read.lastIngestAt ? `يقرأ كل دورة؛ آخر تعليق وصل ${agoAr(p.read.lastIngestAt, ctx.nowMs)}.` : 'يقرأ كل دورة؛ لم يصل تعليق جديد بعد.', fix: null });
    }

    // 3) الرد
    let replyMode: FivePlatformRow['replyMode'] = 'unavailable';
    if (!has('comment_reply')) {
      lines.push({ key: 'reply', label: 'الرد على التعليقات', state: 'unavailable', detail: `${p.name} لا يتيح الرد على التعليقات عبر واجهته الرسمية.`, fix: null });
    } else {
      const w = p.watcher;
      const on = Boolean(w && w.enabled && !w.paused);
      replyMode = !on ? 'off' : approvalMode ? 'prepare' : (w!.autoReply ? 'auto' : 'off');
      const state: ReadyState = !p.connected ? 'blocked' : replyMode === 'off' ? 'partial' : 'ready';
      const detail = replyMode === 'prepare'
        ? `يجهّز العقل الرد على كل تعليق ويحجزه بانتظار نقرتك${p.approvals.pending ? ` — ${p.approvals.pending} جاهز الآن` : ''}.`
        : replyMode === 'auto' ? 'يرد العقل تلقائياً (فعّلتَ الإرسال التلقائي لهذه المنصة).'
          : w && w.paused ? 'الرد موقوف بالإيقاف الطارئ.' : 'الرد متوقف لهذه المنصة.';
      lines.push({ key: 'reply', label: 'الرد على التعليقات', state, detail, fix: replyMode === 'off' ? 'شغّل مراقب المنصة (والرد يُجهَّز بانتظار نقرتك).' : null });
    }

    // 4) النشر الموحّد
    if (!has('publish')) {
      lines.push({ key: 'publish', label: 'النشر الموحّد', state: 'unavailable', detail: 'لا نشر عبر واجهة هذه المنصة.', fix: null });
    } else {
      const failedLast = p.lastPublish.ok === false;
      lines.push({ key: 'publish', label: 'النشر الموحّد', state: !p.connected ? 'blocked' : failedLast ? 'partial' : 'ready',
        detail: `${MEDIA_RULE_AR[p.platform]}${p.lastPublish.at ? ` آخر نشر: ${p.lastPublish.ok ? 'نجح' : `فشل (${p.lastPublish.code || 'خطأ'})`} ${agoAr(p.lastPublish.at, ctx.nowMs)}.` : ' لم يُنشر بعد من النظام.'}`,
        fix: failedLast ? 'راجع سبب آخر فشل في تشخيص النشر ثم أعد النشر.' : null });
    }

    // 5) القياس والتعلّم
    if (!p.metrics) {
      lines.push({ key: 'metrics', label: 'القياس والتعلّم', state: p.connected ? 'partial' : 'blocked', detail: 'لا قياس بعد (لا منشورات مسجّلة أو المزامنة لم تعمل بعد).', fix: null });
    } else if (p.metrics.issue && /^SCOPE_MISSING/.test(p.metrics.issue)) {
      // تيك توك: الرمز الحالي لا يحمل نطاق قراءة الأرقام — صادق ومحدّد بدل «لا قياس بعد» المبهم.
      lines.push({ key: 'metrics', label: 'القياس والتعلّم', state: 'partial',
        detail: 'الربط الحالي لا يملك إذن قراءة أرقام الفيديوهات (video.list)، فلا قياس حتى يُمنح.',
        fix: 'في TikTok Developer Portal أضف منتج Display API ونطاقي video.list وuser.info.stats لتطبيقنا، ثم أضفهما إلى TIKTOK_OAUTH_SCOPES في Render وأعد ربط تيك توك.' });
    } else if (p.metrics.issue) {
      const perm = /(^|,)10x|permission|review/i.test(p.metrics.issue);
      lines.push({ key: 'metrics', label: 'القياس والتعلّم', state: 'partial',
        detail: `${p.metrics.withMetrics} من ${p.metrics.posts} منشوراً مقاساً — ${perm ? 'المنصة تحجب الأرقام: إذن الإحصاءات غير ممنوح' : `مشكلة: ${p.metrics.issue}`}.`,
        fix: perm ? (p.platform === 'tiktok' ? 'ينتظر موافقة مراجعة تيك توك على نطاق الإحصاءات.' : `فعّل إذن الإحصاءات (insights) في تطبيق ${p.name} ثم أعد الربط.`) : null });
    } else {
      lines.push({ key: 'metrics', label: 'القياس والتعلّم', state: 'ready', detail: `${p.metrics.withMetrics} من ${p.metrics.posts} منشوراً مقاساً ويتعلّم منها العقل.`, fix: null });
    }

    const state = !p.connected ? 'blocked' : worst(lines.map((l) => l.state));
    const replyModeLabelAr = replyMode === 'prepare' ? 'جاهز بانتظار نقرتك' : replyMode === 'auto' ? 'تلقائي' : replyMode === 'off' ? 'متوقف' : 'غير متاح من المنصة';
    return { platform: p.platform, name: p.name, connected: p.connected, state, lines, replyMode, replyModeLabelAr, pendingReplies: p.approvals.pending };
  });
  return {
    rows,
    summary: {
      ready: rows.filter((r) => r.state === 'ready').length,
      partial: rows.filter((r) => r.state === 'partial').length,
      blocked: rows.filter((r) => r.state === 'blocked').length,
      pendingReplies: rows.reduce((a, r) => a + r.pendingReplies, 0),
    },
    sendModeLabelAr: approvalMode ? 'موافقة — لا يخرج رد بلا نقرتك' : 'تلقائي — يرسل العقل بنفسه على المنصات المفعّلة',
  };
}
