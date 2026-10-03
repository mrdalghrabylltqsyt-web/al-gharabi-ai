/**
 * MASTER BATCH — اختبار وحدة لطبقة السياق/المحادثة/السياسة/الحوكمة.
 *
 * منطق صافٍ: لا شبكة ولا أسرار ولا ساعة حقيقية (الزمن يُمرَّر).
 */
import {
  appendMessage,
  conversationKey,
  conversationSummary,
  createConversationState,
  isConversationStale,
  priorBusinessReplies,
  pruneStaleConversations,
  shortTermWindow,
  CONVERSATION_MAX_MESSAGES,
} from '../social/conversationState';
import { isolateContext, findConversation, sameScope } from '../social/contextIsolation';
import { checkCommercialPolicy, normalizePolicyText } from '../social/iraqiCommercialPolicy';
import { evaluateGovernance, AGENT_GOVERNANCE_PRINCIPLES_AR } from '../agent/governanceGuard';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const NOW_ISO = '2026-10-03T10:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);

// --- 1) حالة المحادثة والنافذة قصيرة المدى ---
{
  const key = conversationKey('youtube', 'vid123');
  check('conversationKey يحوي المنصة والخيط', key === 'youtube::vid123', key);
  check('conversationKey بلا منصة/خيط لا ينهار', conversationKey(null, null) === 'unknown::thread');

  let c = createConversationState({ conversationId: key, platform: 'youtube', subjectId: 'vid123', nowIso: NOW_ISO });
  check('محادثة جديدة فارغة', c.messages.length === 0 && c.messageCount === 0);
  c = appendMessage(c, { role: 'customer', text: 'مرحبا', at: NOW_ISO });
  c = appendMessage(c, { role: 'business', text: 'هلا بيك', at: NOW_ISO });
  check('إضافة رسائل تزيد العدّاد', c.messageCount === 2 && c.messages.length === 2);
  check('priorBusinessReplies يعيد ردودنا فقط', priorBusinessReplies(c).length === 1 && priorBusinessReplies(c)[0] === 'هلا بيك');

  // قصّ الحد الأقصى.
  let big = createConversationState({ conversationId: 'x', nowIso: NOW_ISO });
  for (let i = 0; i < CONVERSATION_MAX_MESSAGES + 5; i++) big = appendMessage(big, { role: 'customer', text: `m${i}`, at: NOW_ISO });
  check('النافذة تُقصّ للحد الأقصى (الأحدث تبقى)', big.messages.length === CONVERSATION_MAX_MESSAGES && big.messages[big.messages.length - 1].text === `m${CONVERSATION_MAX_MESSAGES + 4}`);

  const win = shortTermWindow(big, { size: 3 });
  check('shortTermWindow يعيد آخر N ويعلن القصّ', win.messages.length === 3 && win.truncated === true);
  const winSmall = shortTermWindow(c, { size: 10 });
  check('نافذة أصغر من الحجم لا تُعلن قصّاً', winSmall.truncated === false);

  const summary = conversationSummary(c);
  check('الملخّص بلا بيانات هوية', !('authorName' in summary) && summary.conversationId === key);

  // الطزاجة.
  check('محادثة حديثة ليست منتهية', isConversationStale(c, NOW_MS + 1000) === false);
  check('محادثة قديمة منتهية', isConversationStale(c, NOW_MS + 7 * 60 * 60 * 1000) === true);
  const pruned = pruneStaleConversations([c], NOW_MS + 7 * 60 * 60 * 1000);
  check('prune يحذف المنتهية', pruned.length === 0);
}

// --- 2) عزل السياق ---
{
  let a = createConversationState({ conversationId: 'youtube::vidA', platform: 'youtube', subjectId: 'vidA', nowIso: NOW_ISO });
  a = appendMessage(a, { role: 'business', text: 'رد على A', at: NOW_ISO });
  let b = createConversationState({ conversationId: 'youtube::vidB', platform: 'youtube', subjectId: 'vidB', nowIso: NOW_ISO });
  b = appendMessage(b, { role: 'business', text: 'رد على B', at: NOW_ISO });

  const ok = isolateContext(a, { conversationId: 'youtube::vidA', platform: 'youtube', subjectId: 'vidA' });
  check('نفس المحادثة ⇒ عزل ناجح ويعيد الردود', ok.isolated === true && ok.priorReplies.length === 1 && ok.priorReplies[0] === 'رد على A');

  const mismatch = isolateContext(a, { conversationId: 'youtube::vidB', platform: 'youtube', subjectId: 'vidB' });
  check('محادثة مختلفة ⇒ لا عزل ولا ردود', mismatch.isolated === false && mismatch.reason === 'conversation_mismatch' && mismatch.priorReplies.length === 0);

  const platformMismatch = isolateContext(a, { conversationId: 'youtube::vidA', platform: 'facebook', subjectId: 'vidA' });
  check('منصة مختلفة ⇒ لا عزل', platformMismatch.isolated === false && platformMismatch.reason === 'platform_mismatch');

  const subjectMismatch = isolateContext(a, { conversationId: 'youtube::vidA', platform: 'youtube', subjectId: 'vidZ' });
  check('خيط مختلف ⇒ لا عزل', subjectMismatch.isolated === false && subjectMismatch.reason === 'subject_mismatch');

  check('غياب المحادثة مع نطاق صالح ⇒ محادثة جديدة معزولة', isolateContext(null, { conversationId: 'x', platform: null, subjectId: null }).reason === 'new_conversation');
  check('غياب النطاق ⇒ no_scope', isolateContext(a, { conversationId: '', platform: null, subjectId: null }).reason === 'no_scope');

  const found = findConversation([a, b], 'youtube', 'vidB');
  check('findConversation يجد بالمعرّف المحسوب', found?.conversationId === 'youtube::vidB');
  check('sameScope يقارن النطاق', sameScope({ conversationId: 'x', platform: 'y', subjectId: 'z' }, { conversationId: 'x', platform: 'y', subjectId: 'z' }) === true);
}

// --- 3) سياسة التواصل التجاري العراقي ---
{
  check('نص عراقي طبيعي ⇒ متوافق', checkCommercialPolicy('هلا بيك، نورتنا 🌸').compliant === true);
  check('مبالغة ⇒ رفض', checkCommercialPolicy('هذا أفضل عرض في العراق لا يفوتك').compliant === false);
  check('إلحاح كاذب ⇒ رفض', checkCommercialPolicy('آخر قطعة، الحق قبل ما يخلص').compliant === false);
  check('وعد مطلق ⇒ رفض', checkCommercialPolicy('مضمون 100% وبلا أي مشاكل').compliant === false);
  check('حطّ من المنافسين ⇒ رفض', checkCommercialPolicy('احنا أرخص منهم والبقية غالي').compliant === false);
  check('ضغط ⇒ رفض', checkCommercialPolicy('لازم تشتري هسه ولا تفكر').compliant === false);

  const rep = checkCommercialPolicy('عرض خرافي مضمون 100%');
  check('الرموز والمسمّيات تُعلن', rep.violationLabelsAr.length >= 1 && rep.violations.every((v) => typeof v.code === 'string'));
  check('تطبيع النص يوحّد الألف/الهمزات', normalizePolicyText('أفضل إعلان') === 'افضل اعلان');
  check('سعر موثوق بلا مبالغة ⇒ متوافق', checkCommercialPolicy('سعره 1,250,000 د.ع والتقسيط متوفر').compliant === true);
}

// --- 4) حوكمة الوكلاء ---
{
  const g = evaluateGovernance;
  const extApproved = g({ operator: 'owner', permission: 'EXTERNAL_ACTION', externalAction: true, approved: true, claimVerified: true, sensitive: false });
  check('مالك + خارجي + موافقة ⇒ مسموح', extApproved.allowed === true && extApproved.code === 'ALLOWED');

  const extUnapproved = g({ operator: 'owner', permission: 'EXTERNAL_ACTION', externalAction: true, approved: false, claimVerified: true, sensitive: false });
  check('خارجي بلا موافقة ⇒ مرفوض APPROVAL_REQUIRED', extUnapproved.allowed === false && extUnapproved.code === 'APPROVAL_REQUIRED');

  const staffWrite = g({ operator: 'staff', permission: 'WRITE', externalAction: false, approved: false, claimVerified: true, sensitive: false });
  check('staff كتابة ⇒ مرفوض PERMISSION_DENIED', staffWrite.allowed === false && staffWrite.code === 'PERMISSION_DENIED');

  const unverified = g({ operator: 'owner', permission: 'READ', externalAction: false, approved: true, claimVerified: false, sensitive: false });
  check('ادّعاء غير مثبت ⇒ مرفوض UNVERIFIED_CLAIM', unverified.allowed === false && unverified.code === 'UNVERIFIED_CLAIM');

  const sensitive = g({ operator: 'owner', permission: 'SENSITIVE', externalAction: false, approved: true, claimVerified: true, sensitive: true });
  check('حسّاس ⇒ مرفوض ويحتاج بشراً', sensitive.allowed === false && sensitive.code === 'SENSITIVE_HUMAN_REQUIRED' && sensitive.requiresHuman === true);

  const systemExt = g({ operator: 'system', permission: 'EXTERNAL_ACTION', externalAction: true, approved: false, claimVerified: true, sensitive: false });
  check('system لا يملك EXTERNAL_ACTION ⇒ مرفوض (لا تنفيذ صامت)', systemExt.allowed === false && systemExt.code === 'PERMISSION_DENIED');

  const read = g({ operator: 'staff', permission: 'READ', externalAction: false, approved: false, claimVerified: true, sensitive: false });
  check('staff قراءة ⇒ مسموح', read.allowed === true);

  check('المبادئ معلنة (6+)', AGENT_GOVERNANCE_PRINCIPLES_AR.length >= 6);
  check('كل قرار يحمل سبباً عربياً', extUnapproved.reasonAr.length > 0 && sensitive.reasonAr.length > 0);
}

console.log(`PASSED: ${passed} context/conversation/policy/governance checks`);
if (failures.length) {
  console.error('FAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
