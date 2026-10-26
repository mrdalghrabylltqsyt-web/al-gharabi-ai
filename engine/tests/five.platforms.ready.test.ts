/**
 * المنصات الخمس جاهزة: قراءة التعليقات ← تجهيز الرد ← نقرة المالك ← إرسال عبر
 * المنفّذ المركزي، مع النشر الموحّد والقياس، وصدق كامل فيما لا توفره المنصة.
 */
import { readFileSync } from 'node:fs';
import {
  approvalExecutorFor, normalizeOutboundApprovals, findPendingForTarget, findDecidedForTarget,
  applyApprovalOutcome, summarizeApprovalsByPlatform, preparesRepliesForApproval, type OutboundApprovalRequest,
} from '../social/outboundApprovals';
import { buildFivePlatformReadiness, FIVE_PLATFORMS, type FivePlatformInput } from '../social/fivePlatformReadiness';
import { parseThreadsReplies, ThreadsClient, THREADS_REPLY_SCOPES } from '../social/threads';
import { PLATFORM_SPECS } from '../social/registry';

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); } };
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const NOW = Date.parse('2026-10-26T12:00:00Z');
const iso = (minAgo: number) => new Date(NOW - minAgo * 60000).toISOString();
const req = (over: Partial<OutboundApprovalRequest> = {}): OutboundApprovalRequest => ({
  id: 'a1', platform: 'youtube', operation: 'comment_reply', externalId: 'c1', recipientId: null, text: 'أهلاً بك',
  productId: null, actor: 'watcher', at: iso(30), status: 'pending', ...over,
});

// 1) طابور الردود الجاهزة
check('★ لكل منصة من الخمس (ما عدا تيك توك) منفّذ رد مركزي', approvalExecutorFor('youtube', 'comment_reply') === 'youtube_comment'
  && approvalExecutorFor('facebook', 'comment_reply') === 'meta_comment' && approvalExecutorFor('instagram', 'comment_reply') === 'meta_comment'
  && approvalExecutorFor('facebook', 'message_reply') === 'meta_message' && approvalExecutorFor('threads', 'comment_reply') === 'threads_comment');
check('تيك توك بلا منفّذ رد (المنصة لا تتيحه)', approvalExecutorFor('tiktok', 'comment_reply') === null);
const norm = normalizeOutboundApprovals([req(), { id: 'x' }, null, req({ id: 'a2', status: 'weird' as any })], 10);
check('التطبيع يُسقط التالف ويعيد الحالة المجهولة إلى «جاهز»', norm.length === 2 && norm[1].status === 'pending');
const t = { platform: 'youtube', operation: 'comment_reply', externalId: 'c1', recipientId: null };
check('إيجاد الجاهز للهدف نفسه (لا طلب مكرر)', findPendingForTarget([req()], t)?.id === 'a1');
const sent = applyApprovalOutcome(req(), { kind: 'sent', text: 'نص', providerReplyId: 'R1', by: 'owner1', at: iso(1) });
check('★ «أُرسل» فقط بمعرّف رد حقيقي ويُسجَّل النص والفاعل', sent.status === 'sent' && sent.providerReplyId === 'R1' && sent.decidedBy === 'owner1' && sent.sentText === 'نص');
check('★ هدف حُسم (أُرسل) لا يُجهَّز له رد ثانٍ', findDecidedForTarget([sent], t)?.id === 'a1' && findPendingForTarget([sent], t) === null);
const rej = applyApprovalOutcome(req(), { kind: 'rejected', by: 'o', at: iso(1) });
check('★ الرد المرفوض لا يعود', findDecidedForTarget([rej], t)?.status === 'rejected');
const fail = applyApprovalOutcome(req(), { kind: 'failed', error: 'x', by: 'o', at: iso(1) });
check('الفاشل لا يمنع إعادة التجهيز', findDecidedForTarget([fail], t) === null && fail.status === 'failed');
const sum = summarizeApprovalsByPlatform([req(), req({ id: 'b', platform: 'facebook', at: iso(90) }), sent, rej], NOW);
check('ملخّص لكل منصة (جاهز/أُرسل/رُفض اليوم)', sum.youtube.pending === 1 && sum.youtube.sent24h === 1 && sum.youtube.rejected24h === 1 && sum.facebook.pending === 1);
check('★ وضع الموافقة: العقل يجهّز الرد حتى مع الرد الآلي مطفأ', preparesRepliesForApproval({ sendMode: 'approval', enabled: true, paused: false }));
check('★ الإيقاف الطارئ/المراقبة المعطّلة توقف التجهيز', !preparesRepliesForApproval({ sendMode: 'approval', enabled: true, paused: true }) && !preparesRepliesForApproval({ sendMode: 'approval', enabled: false, paused: false }));
check('★ الوضع التلقائي: مفتاح المنصة هو الحَكَم (لا تجهيز إضافي)', !preparesRepliesForApproval({ sendMode: 'auto', enabled: true, paused: false }));
check('القيمة المجهولة تُعامل كموافقة (أمان)', preparesRepliesForApproval({ sendMode: '', enabled: true, paused: false }));

// 2) جاهزية المنصات الخمس
const base = (platform: any, over: Partial<FivePlatformInput> = {}): FivePlatformInput => ({
  platform, name: platform, connected: true, capabilities: ['publish', 'comments', 'comment_reply', 'analytics'],
  read: { attempted: true, ok: true, lastIngestAt: iso(20), errorCode: null, error: null },
  watcher: { enabled: true, paused: false, autoReply: false }, approvals: { pending: 2, oldestPendingAt: iso(30), sent24h: 0 },
  lastPublish: { at: iso(600), ok: true, code: null }, metrics: { posts: 5, withMetrics: 5, issue: null }, ...over,
});
const rep = buildFivePlatformReadiness([
  base('facebook'), base('instagram'), base('youtube'),
  base('tiktok', { capabilities: ['publish', 'analytics'], watcher: null, read: { attempted: false, ok: null, lastIngestAt: null, errorCode: null, error: null }, approvals: { pending: 0, oldestPendingAt: null, sent24h: 0 }, metrics: { posts: 3, withMetrics: 0, issue: 'review' } }),
  base('threads', { read: { attempted: true, ok: false, lastIngestAt: null, errorCode: 'PERMISSION_MISSING', error: 'perm' }, metrics: { posts: 11, withMetrics: 0, issue: '10x11' } }),
], { sendMode: 'approval', nowMs: NOW });
check('★ الخمس كلها معروضة', rep.rows.length === 5 && FIVE_PLATFORMS.every((p) => rep.rows.some((r) => r.platform === p)));
const fb = rep.rows.find((r) => r.platform === 'facebook')!;
check('★ فيسبوك: يقرأ ويجهّز الرد بانتظار النقرة', fb.state === 'ready' && fb.replyMode === 'prepare' && fb.pendingReplies === 2 && fb.replyModeLabelAr.includes('نقرتك'));
const tk = rep.rows.find((r) => r.platform === 'tiktok')!;
check('★ تيك توك: قراءة/رد التعليقات «غير متاح من المنصة» بصدق (لا وهم)', tk.replyMode === 'unavailable' && tk.lines.some((l) => l.key === 'read' && l.state === 'unavailable'));
check('تيك توك: النشر يصل صندوق المسودات (مصرَّح به)', tk.lines.some((l) => l.key === 'publish' && /مسودات/.test(l.detail)));
const th = rep.rows.find((r) => r.platform === 'threads')!;
check('★ ثريدز: نقص إذن القراءة يُعلن بسببه وطريقة إصلاحه', th.lines.some((l) => l.key === 'read' && l.state === 'blocked' && /إذن/.test(l.detail) && Boolean(l.fix)));
check('★ ثريدز: إحصاءات محجوبة (10x) = إذن الإحصاءات', th.lines.some((l) => l.key === 'metrics' && /إذن الإحصاءات/.test(l.detail)));
const auto = buildFivePlatformReadiness([base('youtube', { watcher: { enabled: true, paused: false, autoReply: true } }), base('facebook')], { sendMode: 'auto', nowMs: NOW });
check('الوضع التلقائي: المنصة المفعّلة «تلقائي» والأخرى «متوقف»', auto.rows[0].replyMode === 'auto' && auto.rows[1].replyMode === 'off');
check('منصة غير متصلة = متوقفة مع طريقة الربط', buildFivePlatformReadiness([base('instagram', { connected: false })], { sendMode: 'approval', nowMs: NOW }).rows[0].state === 'blocked');

// 3) Threads: قراءة التعليقات والرد عليها
const parsed = parseThreadsReplies({ data: [{ id: '1', text: 'بكم؟', username: 'ali', timestamp: iso(5), is_reply_owned_by_me: false }, { id: '2', text: 'شكراً', is_reply_owned_by_me: true }, { id: '3', text: '  ' }, { text: 'بلا معرّف' }, { id: '4', text: 'مخفي', hide_status: 'HIDDEN' }] });
check('★ تحليل ردود Threads: يسقط التالف ويعلّم ردّ المعرض والمخفي', parsed.length === 3 && parsed[1].ownedByMe === true && parsed[2].hidden === true && parsed[0].username === 'ali');
check('نطاقات Threads للتعليقات معلنة', THREADS_REPLY_SCOPES.includes('threads_read_replies') && THREADS_REPLY_SCOPES.includes('threads_manage_replies'));
(async () => {
  const calls: string[] = [];
  const client = new ThreadsClient(async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ data: [{ id: '9', text: 'وين المعرض؟', username: 'z' }] }) }; });
  const r = await client.listReplies('M1', 'tok');
  check('★ listReplies يستدعي /{media}/replies الحقيقي', r.ok && r.data!.replies[0].id === '9' && calls[0].includes('/M1/replies'));
  const denied = new ThreadsClient(async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 10, message: 'Application does not have permission' } }) }));
  const d = await denied.listReplies('M1', 'tok');
  check('★ رفض الإذن يُعلن PERMISSION_MISSING (لا فشل غامض)', !d.ok && d.code === 'PERMISSION_MISSING');
  const lc = new ThreadsClient(async (url) => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'P1', timestamp: iso(10) }] }) }));
  const posts = await lc.listRecentThreads('U1', 'tok', 6);
  check('listRecentThreads يقرأ منشورات الحساب (تشمل المنشور من التطبيق)', posts.ok && posts.data!.posts[0].id === 'P1');

  const spec = PLATFORM_SPECS.find((s: any) => s.platform === 'threads') as any;
  check('★ سجل القدرات: ثريدز يعلن التعليقات والرد', spec && spec.capabilities.includes('comments') && spec.capabilities.includes('comment_reply'));
  const tiktok = PLATFORM_SPECS.find((s: any) => s.platform === 'tiktok') as any;
  check('سجل القدرات: تيك توك بلا تعليقات (صدق)', tiktok && !tiktok.capabilities.includes('comment_reply'));

  // 4) الخادم: الأسلاك الفعلية
  const server = read('server.ts');
  check('★ مسارات الردود الجاهزة للمالك فقط', server.includes('app.get("/api/commercial/approvals", requireOwner') && server.includes('app.post("/api/commercial/approvals/:id/decision", requireOwner') && server.includes('app.post("/api/commercial/approvals/bulk", requireOwner'));
  check('★ الإرسال عبر المنفّذ المركزي لكل منصة (لا مسار جانبي)', /dispatchOutboundApproval[\s\S]{0,1600}executeYouTubeReply[\s\S]{0,300}executeMetaCommentReply[\s\S]{0,300}executeMetaMessageReply[\s\S]{0,300}executeThreadsCommentReply/.test(server));
  check('★ «أرسل الكل» تسلسلي بسقف 25', server.includes('.slice(0, 25);') && /approvals\/bulk[\s\S]{0,1500}for \(const r of targets\)/.test(server));
  check('★ البوابة لا تعيد إنشاء رد لهدف حُسم، ولا تكرر مسودة صندوق الزبائن', server.includes('const decided = findDecidedForTarget(outboundApprovals, target);') && server.includes("d.status === 'pending' && d.platform === input.platform && String(d.externalId || '') === targetExt"));
  check('★ وضع التجهيز في مراقب Meta (تعليقات + رسائل)', (server.match(/const prepareOk = replyGate\.allowed \|\| preparesRepliesForApproval\(/g) || []).length >= 3);
  check('★ وضع التجهيز في مراقب يوتيوب + دفاع مزدوج عند التنفيذ', server.includes('const prepareYt = !replyGate.allowed && preparesRepliesForApproval(') && server.includes('const replyGateFinal = finalPrepare ? { ...replyGateRaw, allowed: true } : replyGateRaw;') && server.includes("const centralDecision = prepareYt && centralDecisionRaw === 'APPROVAL_REQUIRED' ? 'ALLOWED_ACTION' : centralDecisionRaw;"));
  check('★ تعليقات Threads ضمن دورة Meta', server.includes('const th = await runThreadsRepliesCycle(controls);') && server.includes('threadsClient().listReplies(postId, token)'));
  check('★ منفّذ رد Threads يمر ببوابة الموافقة ومنع التكرار والسلامة', /async function executeThreadsCommentReply[\s\S]{0,900}guardCustomerSend\(/.test(server) && /async function executeThreadsCommentReply[\s\S]{0,4000}beginExternalOperation[\s\S]{0,800}evaluateReplyGuard/.test(server));
  check('نطاق قراءة ردود Threads مطلوب في الربط', server.includes('"threads_read_replies"'));
  check('★ جاهزية المنصات الخمس للمالك', server.includes('app.get("/api/platforms/five-readiness", requireOwner'));
  check('الغرفة الحية تحسب الردود الجاهزة ضمن «بانتظار موافقتك»', server.includes('pending: pending.length + ready.length,'));
  const ui = read('src/components/agent/ReadyRepliesPanel.tsx');
  check('★ الواجهة: إرسال/تعديل/رفض لكل رد + «أرسل كل الجاهز» لكل منصة', ui.includes("decide(x.id, 'approve')") && ui.includes("decide(x.id, 'edit_approve', editText)") && ui.includes("decide(x.id, 'reject')") && ui.includes("bulk(r.platform, 'approve')"));
  check('اللوحة داخل صندوق الزبائن', read('src/components/agent/CommercialInbox.tsx').includes('<ReadyRepliesPanel />'));

  console.log('\n' + '='.repeat(60));
  if (failed) { console.log(`FAILED: ${failed} — passed ${passed}`); process.exit(1); }
  console.log(`PASSED: ${passed} five-platforms-ready checks`);
})();
