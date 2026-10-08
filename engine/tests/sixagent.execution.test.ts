/**
 * اختبار وحدة: أفعال العقول الستة الحتمية (whitelist) + سجل التدقيق.
 *
 * يثبت أن:
 *  - القائمة المسموحة صريحة ومحصورة بأربعة أفعال فقط (لا صلاحية مفتوحة).
 *  - التنفيذ الحتمي لا يستدعي Gemini إطلاقاً (سلوكياً + مصدرياً).
 *  - أي شيء غامض/حساس/خارج القائمة ⇒ تصعيد للعقل المركزي وحده.
 *  - النمط المحفوظ لا يُنفَّذ إلا بثقة عالية، ومكافحة التسميم محفوظة (أصل AI مرفوض).
 *  - كل فعل يُسجَّل في سجل تدقيق قابل للمراجعة.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SIX_AGENT_ALLOWED_ACTIONS,
  isAllowedSixAgentAction,
  evaluateSixAgentAction,
  matchStoredReplyPattern,
  normalizeForMatch,
  SIX_AGENT_PATTERN_MIN_CONFIDENCE,
  type StoredReplyPattern,
} from '../brain/team/executionPolicy';
import {
  emptySixAgentAudit,
  recordSixAgentAudit,
  summarizeSixAgentAudit,
  SIX_AGENT_AUDIT_MAX,
} from '../brain/team/auditLog';
import { executeSixAgentAction, type DeterministicActionDeps } from '../brain/team/deterministicActions';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();

group('1) القائمة المسموحة صريحة ومحصورة');
check('4 أفعال بالضبط', SIX_AGENT_ALLOWED_ACTIONS.length === 4, String(SIX_AGENT_ALLOWED_ACTIONS.length));
check('تصنيف التعليق مسموح', isAllowedSixAgentAction('classify_tag_comment'));
check('تحديث العدّادات مسموح', isAllowedSixAgentAction('update_engagement_counters'));
check('إعادة نشر واحدة مسموحة', isAllowedSixAgentAction('retry_failed_publish_once'));
check('الرد بنمط محفوظ مسموح', isAllowedSixAgentAction('reply_from_stored_pattern'));
check('النشر العام غير مسموح', !isAllowedSixAgentAction('publish'));
check('حذف غير مسموح', !isAllowedSixAgentAction('delete_post'));
check('فعل خارج القائمة يُرفض صراحةً', evaluateSixAgentAction({ action: 'publish' }).code === 'REJECT_OUT_OF_WHITELIST');

group('2) التصنيف الحتمي: عادي/إيجابي فقط، والباقي تصعيد');
const praise = evaluateSixAgentAction({ action: 'classify_tag_comment', commentText: 'ما شاء الله تبارك الله مرتب' });
check('مدح ⇒ تنفيذ حتمي', praise.allowed && praise.code === 'ALLOW_DETERMINISTIC');
check('مدح بلا Gemini', praise.requiresGemini === false && praise.requiresCentralBrain === false);
const emoji = evaluateSixAgentAction({ action: 'classify_tag_comment', commentText: '❤️❤️' });
check('إيموجي إيجابي ⇒ تنفيذ حتمي', emoji.allowed);
const question = evaluateSixAgentAction({ action: 'classify_tag_comment', commentText: 'شنو نوع الموبايل؟' });
check('سؤال ⇒ تصعيد للعقل المركزي', !question.allowed && question.code === 'ESCALATE_CENTRAL' && question.requiresCentralBrain);
const negative = evaluateSixAgentAction({ action: 'classify_tag_comment', commentText: 'خدمة سيئة جداً وماكو التزام' });
check('سلبي/شكوى ⇒ تصعيد', !negative.allowed && negative.code === 'ESCALATE_CENTRAL');
const empty = evaluateSixAgentAction({ action: 'classify_tag_comment', commentText: '   ' });
check('نص فارغ ⇒ تصعيد (لا تخمين)', !empty.allowed && empty.code === 'ESCALATE_CENTRAL');

group('3) العدّادات مسموحة حتمياً');
const counters = evaluateSixAgentAction({ action: 'update_engagement_counters', platform: 'youtube' });
check('تحديث عدّاد ⇒ تنفيذ حتمي', counters.allowed && counters.code === 'ALLOW_DETERMINISTIC');
check('عدّاد بلا Gemini', counters.requiresGemini === false);

group('4) إعادة النشر: مرة واحدة فقط وعلى منصة واحدة');
check('بلا فشل منصة واحدة ⇒ تصعيد', evaluateSixAgentAction({ action: 'retry_failed_publish_once', singlePlatformFailure: false }).code === 'ESCALATE_CENTRAL');
check('محاولة سابقة ⇒ تصعيد', evaluateSixAgentAction({ action: 'retry_failed_publish_once', singlePlatformFailure: true, priorRetryCount: 1 }).code === 'ESCALATE_CENTRAL');
check('أول مرة على منصة واحدة ⇒ مسموح', evaluateSixAgentAction({ action: 'retry_failed_publish_once', singlePlatformFailure: true, priorRetryCount: 0 }).allowed);

group('5) الرد بالنمط المحفوظ: ثقة عالية فقط');
const patterns: StoredReplyPattern[] = [
  { patternId: 'p-high', triggers: ['كم السعر'], replyText: 'سعر المنتج مسجّل لدينا؛ راسلنا للتفاصيل.', confidence: 0.95, active: true, platform: 'youtube' },
  { patternId: 'p-low', triggers: ['متى تفتحون'], replyText: 'نفتح يومياً.', confidence: 0.4, active: true, platform: 'youtube' },
  { patternId: 'p-inactive', triggers: ['هل متوفر'], replyText: 'نعم.', confidence: 0.99, active: false, platform: 'youtube' },
];
check('تطابق تام عالي الثقة يُختار', matchStoredReplyPattern('كم السعر', patterns, 'youtube')?.patternId === 'p-high');
check('ثقة منخفضة لا تُطابَق', matchStoredReplyPattern('متى تفتحون', patterns, 'youtube') === null);
check('نمط غير نشط لا يُطابَق', matchStoredReplyPattern('هل متوفر', patterns, 'youtube') === null);
check('التطبيع العربي يوحّد الألف والتاء', normalizeForMatch('كم السّعر؟') === normalizeForMatch('كم السعر'));
const allowPattern = evaluateSixAgentAction({ action: 'reply_from_stored_pattern', commentText: 'كم السعر', storedPatterns: patterns, platform: 'youtube' });
check('نمط مطابق ⇒ تنفيذ حتمي', allowPattern.allowed && allowPattern.matchedPatternId === 'p-high');
const noPattern = evaluateSixAgentAction({ action: 'reply_from_stored_pattern', commentText: 'شيء غامض لا نمط له', storedPatterns: patterns, platform: 'youtube' });
check('لا نمط ⇒ تصعيد للعقل المركزي', !noPattern.allowed && noPattern.code === 'ESCALATE_CENTRAL');
check('حد الثقة معلن', SIX_AGENT_PATTERN_MIN_CONFIDENCE === 0.85);

group('6) لا Gemini في أي قرار للعقول الستة');
const actions = ['classify_tag_comment', 'update_engagement_counters', 'retry_failed_publish_once', 'reply_from_stored_pattern'];
check('لا قرار يطلب Gemini', actions.every((a) => evaluateSixAgentAction({ action: a, commentText: 'ما شاء الله' }).requiresGemini === false));
const policySrc = readFileSync(join(REPO_ROOT, 'engine/brain/team/executionPolicy.ts'), 'utf8');
const actionsSrc = readFileSync(join(REPO_ROOT, 'engine/brain/team/deterministicActions.ts'), 'utf8');
check('executionPolicy لا يستورد مزوّد AI', !/from ['"].*(ai\/provider|ai\/engine|gemini)/i.test(policySrc));
check('deterministicActions لا يستورد مزوّد AI', !/from ['"].*(ai\/provider|ai\/engine|gemini)/i.test(actionsSrc));
check('لا ذكر GEMINI_API_KEY في الوحدتين', !/GEMINI_API_KEY/.test(policySrc) && !/GEMINI_API_KEY/.test(actionsSrc));

group('7) التنفيذ الحتمي عبر المنفّذات المحقونة (بلا شبكة)');
const calls: string[] = [];
const deps: DeterministicActionDeps = {
  tagComment: (_p, id) => { calls.push(`tag:${id}`); return { ok: true, evidenceRef: id }; },
  recordCounter: (_p, m) => { calls.push(`counter:${m}`); },
  retryPublish: async (p) => { calls.push(`retry:${p}`); return { ok: true, providerPostId: 'post-1' }; },
  sendReply: async (_p, _t, text) => { calls.push(`reply:${text}`); return { ok: true, providerReplyId: 'r-1' }; },
};
(async () => {
  const tag = await executeSixAgentAction({ agentId: 'analysis', action: 'classify_tag_comment', platform: 'youtube', commentId: 'c1', commentText: 'ما شاء الله', tag: 'positive' }, deps);
  check('تصنيف نُفّذ وأعاد دليلاً', tag.outcome === 'executed' && tag.evidenceRef === 'c1');

  const cnt = await executeSixAgentAction({ agentId: 'analysis', action: 'update_engagement_counters', platform: 'youtube', metric: 'views', value: 12 }, deps);
  check('عدّاد نُفّذ', cnt.outcome === 'executed');

  const retry = await executeSixAgentAction({ agentId: 'decision', action: 'retry_failed_publish_once', platform: 'youtube', postId: 'p1', singlePlatformFailure: true }, deps);
  check('إعادة نشر نُفّذت بمعرّف المزود', retry.outcome === 'executed' && retry.evidenceRef === 'post-1');

  const reply = await executeSixAgentAction({ agentId: 'decision', action: 'reply_from_stored_pattern', platform: 'youtube', commentId: 'c2', commentText: 'كم السعر', storedPatterns: patterns, patternReplyText: 'سعر المنتج مسجّل لدينا؛ راسلنا للتفاصيل.' }, deps);
  check('رد بنمط نُفّذ بمعرّف رد', reply.outcome === 'executed' && reply.evidenceRef === 'r-1');

  const replyNoText = await executeSixAgentAction({ agentId: 'decision', action: 'reply_from_stored_pattern', platform: 'youtube', commentId: 'c3', commentText: 'كم السعر', storedPatterns: patterns }, deps);
  check('نمط بلا نص محفوظ ⇒ تصعيد (لا اختراع)', replyNoText.outcome === 'escalated');

  const rejected = await executeSixAgentAction({ agentId: 'decision', action: 'publish', platform: 'youtube' }, deps);
  check('فعل خارج القائمة ⇒ رفض بلا تنفيذ', rejected.outcome === 'rejected');

  group('8) سجل التدقيق');
  let audit = emptySixAgentAudit();
  audit = recordSixAgentAudit(audit, { id: 'a1', agentId: 'analysis', action: 'classify_tag_comment', matchedRule: 'classify:praise/positive', matchedPatternId: null, decisionCode: 'ALLOW_DETERMINISTIC', outcome: 'executed', platform: 'youtube', evidenceRef: 'c1', note: 'ok', now: 1000 });
  audit = recordSixAgentAudit(audit, { id: 'a2', agentId: 'decision', action: 'reply_from_stored_pattern', matchedRule: 'pattern:stored', matchedPatternId: 'p-high', decisionCode: 'ALLOW_DETERMINISTIC', outcome: 'executed', platform: 'youtube', evidenceRef: 'r-1', note: 'ok', now: 2000 });
  audit = recordSixAgentAudit(audit, { id: 'a3', agentId: 'analysis', action: 'classify_tag_comment', matchedRule: null, matchedPatternId: null, decisionCode: 'ESCALATE_CENTRAL', outcome: 'escalated', platform: 'youtube', evidenceRef: null, note: 'سؤال', now: 3000 });
  const sum = summarizeSixAgentAudit(audit);
  check('السجل يحتفظ بكل الأفعال', audit.entries.length === 3);
  check('عدّ المنفّذ صحيح', sum.executed === 2);
  check('عدّ المصعَّد صحيح', sum.escalated === 1);
  check('كل سجل يحمل أي عقل/قاعدة/وقت', audit.entries.every((e) => e.agentId && e.at && (e.matchedRule !== undefined)));
  check('الحد الأعلى محترم', (() => { let s = emptySixAgentAudit(); for (let i = 0; i < SIX_AGENT_AUDIT_MAX + 50; i += 1) s = recordSixAgentAudit(s, { id: `x${i}`, agentId: 'analysis', action: 'update_engagement_counters', matchedRule: 'counters:write', matchedPatternId: null, decisionCode: 'ALLOW_DETERMINISTIC', outcome: 'executed', platform: 'youtube', evidenceRef: null, now: i }); return s.entries.length === SIX_AGENT_AUDIT_MAX; })());

  console.log('\n' + '='.repeat(60));
  if (failures.length === 0) { console.log(`PASSED: ${passed} six-agent execution checks`); process.exit(0); }
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`); failures.forEach((f) => console.error(' - ' + f)); process.exit(1);
})();
