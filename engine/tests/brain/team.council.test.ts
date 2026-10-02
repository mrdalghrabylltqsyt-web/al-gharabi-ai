/**
 * اختبار وحدة فريق الوكلاء (Agent Council) — منطق خالص.
 *
 * يثبت: إنشاء الجلسة، توجيه المنسّق، عزل الوكلاء، انتشار الأدلة، حفظ حالة الصدق
 * (الفرضية لا تصبح حقيقة بتكرار وكيل)، كشف الخلاف، رفض الناقد للادعاءات غير
 * المدعومة، توليد القرار، الثقة، منع التكرار، فشل وكيل، فشل الناقد، حماية المنصة
 * غير المتصلة، حدود الإجراء الخارجي، ولا بيانات تجارية مُختلقة.
 *
 * تشغيل: npx tsx engine/tests/brain/team.council.test.ts
 */

import assert from 'node:assert';

import {
  decideRequiredAgents, teamDedupeKey, runTeamSession, upsertTeamSession,
  teamSessionToMemoryRecords, summarizeTeamState, summarizeTeamSession,
  findSessionByDedupeKey,
} from '../../brain/team/orchestrator';
import {
  confirmTruthState, promoteWithIndependentEvidence, truthStateForEvidence,
  isActionableTruth, TEAM_TRUTH_STATES, TEAM_MIN_SAMPLE_FOR_FACT,
} from '../../brain/team/truth';
import {
  researchAgent, analysisAgent, strategyAgent, criticAgent, decisionAgent,
  connectedPlatforms, platformsInTask, type TeamContext,
} from '../../brain/team/agents';
import { emptyTeamSessionState, TEAM_AGENT_IDS, type TeamAgentOutput } from '../../brain/team/types';
import { emptyBrainMemory, upsertMemoryRecord } from '../../brain/memory/store';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const NOW = Date.parse('2026-10-02T10:00:00.000Z');

function ctx(overrides: Partial<TeamContext> = {}): TeamContext {
  return {
    now: NOW,
    task: 'حلّل تعليقات YouTube واقترح قراراً للرد',
    platform: 'youtube',
    comments: [
      { platform: 'youtube', externalId: 'c1', text: 'كم السعر؟', at: '2026-10-01T00:00:00Z' },
      { platform: 'youtube', externalId: 'c2', text: 'شنو نوع الموبايل؟', at: '2026-10-01T01:00:00Z' },
      { platform: 'youtube', externalId: 'c3', text: 'عاشت إيدكم', at: '2026-10-01T02:00:00Z' },
    ],
    watcher: [
      { commentId: 'c1', stage: 'REPLIED', at: '2026-10-01T03:00:00Z', externalReplyId: 'r1' },
    ],
    connections: [{ platform: 'youtube', connected: true, verified: true, accountName: 'قناة الغرابي' }],
    verifiedFacts: [{ id: 'f1', statement: 'موقع المعرض: بغداد', source: 'بيانات المعرض المسجّلة' }],
    memoryActive: 5,
    aiAvailable: true,
    priorSessions: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1) إنشاء الجلسة + توجيه المنسّق (required agents)
// ---------------------------------------------------------------------------
{
  const agents = decideRequiredAgents('حلّل التعليقات واقترح قراراً');
  check('1-المنسّق يضمّ المنسّق دائماً', agents.includes('orchestrator'));
  check('1-المنسّق يضمّ البحث والتحليل', agents.includes('research') && agents.includes('analysis'));
  check('1-المنسّق يضمّ القرار دائماً', agents.includes('decision'));
  check('1-المنسّق يضمّ الناقد افتراضياً', agents.includes('critic'));
  const analysisOnly = decideRequiredAgents('حلّل الوضع فقط');
  check('1-مهمة تحليلية صرفة تتخطّى الاستراتيجية', !analysisOnly.includes('strategy'));
  const noCritic = decideRequiredAgents('حلّل', { criticEnabled: false });
  check('1-تعطيل الناقد يعمل', !noCritic.includes('critic'));

  const session = runTeamSession(ctx(), { trigger: 'youtube_event', platform: 'youtube', eventIdentity: 'comment:c1', now: NOW });
  check('1-الجلسة لها معرّف', typeof session.teamSessionId === 'string' && session.teamSessionId.startsWith('team-'));
  check('1-الجلسة تحمل المهمة', session.task.includes('YouTube') || session.task.length > 0);
  check('1-الجلسة تحمل المشغّل', session.trigger === 'youtube_event');
  check('1-الجلسة تحمل المشاركين', Array.isArray(session.participants) && session.participants.length >= 4);
  check('1-الجلسة مكتملة بلا فشل', session.status === 'completed' && session.failedAgents === 0);
  check('1-الجلسة لها قرار', Boolean(session.decision));
}

// ---------------------------------------------------------------------------
// 2) عزل الوكلاء: كل وكيل ينتج مخرجاته الخاصة بنوعها الصحيح
// ---------------------------------------------------------------------------
{
  const c = ctx();
  const research = researchAgent(c);
  const analysis = analysisAgent(c, research.outputs);
  const strategy = strategyAgent(c, analysis);
  const all = [...research.outputs, ...analysis, ...strategy];
  check('2-البحث ينتج observations فقط', research.outputs.every((o) => o.agentId === 'research' && o.kind === 'observation'));
  check('2-التحليل ينتج analyses فقط', analysis.every((o) => o.agentId === 'analysis' && o.kind === 'analysis'));
  check('2-الاستراتيجية تنتج recommendations فقط', strategy.every((o) => o.agentId === 'strategy' && o.kind === 'recommendation'));
  check('2-كل مخرج يحمل وكيله', all.every((o) => TEAM_AGENT_IDS.includes(o.agentId)));
  const critic = criticAgent(c, all);
  check('2-النقد ينتج objections فقط', critic.objections.every((o) => o.agentId === 'critic' && o.kind === 'objection'));
}

// ---------------------------------------------------------------------------
// 3) انتشار الأدلة + حفظ حالة الصدق (الفرضية لا تصبح حقيقة بتكرار وكيل)
// ---------------------------------------------------------------------------
{
  const c = ctx();
  const research = researchAgent(c);
  const factObs = research.outputs.filter((o) => o.truthState === 'FACT');
  check('3-البحث ينتج حقائق من بيانات حقيقية', factObs.length > 0);
  check('3-كل حقيقة لها مصدر وعيّنة', factObs.every((o) => o.source.length > 0 && o.sampleSize > 0));
  check('3-كل حقيقة لها دليل', factObs.every((o) => o.evidence.length > 0));

  // الفرضية تبقى فرضية مهما كرّرها الوكلاء.
  const confirm = confirmTruthState('HYPOTHESIS', 5);
  check('3-التأييد لا يرقّي الفرضية', confirm.state === 'HYPOTHESIS' && confirm.promoted === false);
  check('3-التأييد يشرح السبب', confirm.reason.length > 0);
  const promoteNoEvidence = promoteWithIndependentEvidence('HYPOTHESIS', { independentSource: false, sampleSize: 10 });
  check('3-لا ترقية بلا مصدر مستقل', promoteNoEvidence.state === 'HYPOTHESIS' && !promoteNoEvidence.promoted);
  const promoteSmall = promoteWithIndependentEvidence('HYPOTHESIS', { independentSource: true, sampleSize: TEAM_MIN_SAMPLE_FOR_FACT - 1 });
  check('3-لا ترقية بعيّنة ناقصة', !promoteSmall.promoted);
  const promoteOk = promoteWithIndependentEvidence('HYPOTHESIS', { independentSource: true, sampleSize: TEAM_MIN_SAMPLE_FOR_FACT });
  check('3-ترقية بدليل مستقل كافٍ فقط', promoteOk.promoted && promoteOk.state === 'FACT');

  // تصنيف الأدلة.
  check('3-بلا مصدر => UNKNOWN', truthStateForEvidence({ hasSource: false, sampleSize: 5 }) === 'UNKNOWN');
  check('3-غير متاح => UNAVAILABLE', truthStateForEvidence({ hasSource: true, sampleSize: 5, unavailable: true }) === 'UNAVAILABLE');
  check('3-فرضية => HYPOTHESIS', truthStateForEvidence({ hasSource: true, sampleSize: 5, hypothesis: true }) === 'HYPOTHESIS');
  check('3-حقيقة بعيّنة كافية', truthStateForEvidence({ hasSource: true, sampleSize: 3 }) === 'FACT');
  check('3-عيّنة ناقصة => HYPOTHESIS', truthStateForEvidence({ hasSource: true, sampleSize: 1 }) === 'HYPOTHESIS');
  check('3-الحقائق فقط قابلة للتنفيذ', isActionableTruth('FACT') && isActionableTruth('DERIVED') && !isActionableTruth('HYPOTHESIS'));
  check('3-حالات الصدق الخمس معرّفة', TEAM_TRUTH_STATES.length === 5);
}

// ---------------------------------------------------------------------------
// 4) كشف الخلاف + رفض الناقد للادعاءات غير المدعومة
// ---------------------------------------------------------------------------
{
  const c = ctx({ task: 'انشر على Facebook ورد على التعليقات' });
  const research = researchAgent(c);
  const analysis = analysisAgent(c, research.outputs);
  const all = [...research.outputs, ...analysis];
  const critic = criticAgent(c, all);
  check('4-الناقد يكشف منصة غير متصلة (خلاف)', critic.conflicts.some((cf) => cf.id.includes('offline:facebook')));
  check('4-الخلاف غير محسوم بلا دليل', critic.conflicts.every((cf) => cf.resolved === false));

  // ادعاء FACT بلا مصدر => مرفوض.
  const bogus: TeamAgentOutput = {
    agentId: 'analysis', status: 'ran', kind: 'analysis', truthState: 'FACT',
    statement: 'ادعاء بلا دليل', evidence: [], source: '', sampleSize: 0,
    confidence: 'high', limitations: '', provenance: 'deterministic', at: new Date(NOW).toISOString(),
  };
  const critic2 = criticAgent(c, [...all, bogus]);
  check('4-الناقد يرفض FACT بلا مصدر', critic2.rejected >= 1);
  check('4-الناقد يوثّق اعتراضه', critic2.objections.some((o) => o.statement.includes('بلا مصدر')));

  // ادعاء إجراء خارجي => مرفوض.
  const overreach: TeamAgentOutput = {
    agentId: 'strategy', status: 'ran', kind: 'recommendation', truthState: 'HYPOTHESIS',
    statement: 'انشر المنشور الآن وأرسل الرد تلقائياً', evidence: [], source: 'x', sampleSize: 1,
    confidence: 'low', limitations: '', provenance: 'deterministic', at: new Date(NOW).toISOString(),
  };
  const critic3 = criticAgent(c, [...all, overreach]);
  check('4-الناقد يرفض ادعاء الإجراء الخارجي', critic3.objections.some((o) => o.statement.includes('إجراء خارجي')));

  // لا اعتراضات => رسالة صريحة (لا ادّعاء كمال).
  const clean = criticAgent(ctx(), [...research.outputs]);
  check('4-لا اعتراض => إعلان صريح', clean.objections.length > 0 && clean.objections[0].statement.includes('لم يُرصد'));
}

// ---------------------------------------------------------------------------
// 5) توليد القرار + الثقة + عدم تجاوز الصلاحية
// ---------------------------------------------------------------------------
{
  const c = ctx();
  const research = researchAgent(c);
  const analysis = analysisAgent(c, research.outputs);
  const strategy = strategyAgent(c, analysis);
  const all = [...research.outputs, ...analysis, ...strategy];
  const critic = criticAgent(c, all);
  const decision = decisionAgent(c, all, critic.conflicts, { ran: true, failed: false, rejected: critic.rejected });
  check('5-القرار موجود بنص', typeof decision.statement === 'string' && decision.statement.length > 0);
  check('5-القرار يحمل حالة صدق', TEAM_TRUTH_STATES.includes(decision.truthState));
  check('5-القرار مُتحقَّق عند نجاح الناقد', decision.verified === true);
  check('5-القرار يحمل حدوداً', decision.limitations.length > 0);
  check('5-القرار يحمل أدلة', Array.isArray(decision.evidence));
  check('5-القرار لا ينفّذ إجراءً خارجياً', /لا يُنفَّذ|لا إجراء خارجي|بوابة/.test(decision.statement + decision.proposedAction) || decision.requiresHumanApproval === true);

  // فشل الناقد => القرار غير مُتحقَّق (لا ادّعاء تحقق كاذب).
  const unverified = decisionAgent(c, all, critic.conflicts, { ran: true, failed: true, rejected: 0 });
  check('5-فشل الناقد => غير مُتحقَّق', unverified.verified === false);
  check('5-فشل الناقد معلن في الحدود', unverified.limitations.some((l) => l.includes('ناقد')));

  // لا دليل => ثقة منخفضة وحالة UNKNOWN.
  const empty = decisionAgent(ctx({ comments: [], watcher: [], verifiedFacts: [] }), [], [], { ran: true, failed: false, rejected: 0 });
  check('5-لا دليل => UNKNOWN', empty.truthState === 'UNKNOWN');
  check('5-لا دليل => ثقة منخفضة', empty.confidence === 'low');
}

// ---------------------------------------------------------------------------
// 6) منع التكرار + فشل وكيل + فشل الناقد (عبر المنسّق)
// ---------------------------------------------------------------------------
{
  const dedupe = teamDedupeKey({ task: 'مهمة', platform: 'youtube', eventIdentity: 'comment:c1' });
  check('6-مفتاح منع التكرار مشتق من الحدث', dedupe.includes('comment:c1') && dedupe.startsWith('team:youtube'));

  const s1 = runTeamSession(ctx(), { trigger: 'youtube_event', platform: 'youtube', eventIdentity: 'comment:c1', now: NOW });
  const s2 = runTeamSession(ctx(), { trigger: 'youtube_event', platform: 'youtube', eventIdentity: 'comment:c1', now: NOW + 1000, existing: s1 });
  check('6-نفس الحدث => لا جلسة مكررة', s2.teamSessionId === s1.teamSessionId);
  check('6-مفتاح منع التكرار نفسه', s2.dedupeKey === s1.dedupeKey);

  // upsert يمنع التكرار في المخزن.
  let state = emptyTeamSessionState();
  const up1 = upsertTeamSession(state, s1);
  state = up1.state;
  check('6-upsert يضيف أول جلسة', up1.added === true && state.sessions.length === 1);
  const up2 = upsertTeamSession(state, s2);
  state = up2.state;
  check('6-upsert لا يكرّر نفس المفتاح', up2.added === false && state.sessions.length === 1);
  check('6-findSessionByDedupeKey يجدها', findSessionByDedupeKey(state, s1.dedupeKey)?.teamSessionId === s1.teamSessionId);

  // فشل وكيل: البحث يفشل => الجلسة تستمر، تُسجَّل الحالة، لا اختراع مخرجات.
  const failed = runTeamSession(ctx(), {
    trigger: 'youtube_event', platform: 'youtube', eventIdentity: 'comment:c2', now: NOW,
    failAgent: (a) => a === 'research',
  });
  check('6-فشل وكيل يُسجَّل', failed.failedAgents >= 1);
  check('6-الجلسة تستمر بحالة partial', failed.status === 'partial');
  check('6-مخرج الوكيل الفاشل معلن', failed.observations.some((o) => o.status === 'failed' && o.error));
  check('6-لا اختراع مخرجات الوكيل الفاشل', failed.observations.filter((o) => o.status === 'failed').every((o) => o.evidence.length === 0));

  // فشل الناقد: القرار يبقى لكن غير مُتحقَّق.
  const criticFailed = runTeamSession(ctx(), {
    trigger: 'youtube_event', platform: 'youtube', eventIdentity: 'comment:c3', now: NOW,
    failAgent: (a) => a === 'critic',
  });
  check('6-fشل الناقد يُعلن', criticFailed.criticFailed === true);
  check('6-فشل الناقد => قرار غير مُتحقَّق', criticFailed.decision?.verified === false);

  // تعطيل الناقد صراحةً => غير مُتحقَّق أيضاً.
  const noCritic = runTeamSession(ctx(), { trigger: 'manual', platform: 'youtube', eventIdentity: 'comment:c4', now: NOW, criticEnabled: false });
  check('6-تعطيل الناقد => غير مُتحقَّق', noCritic.criticFailed === true && noCritic.decision?.verified === false);
}

// ---------------------------------------------------------------------------
// 7) حماية المنصة غير المتصلة + حدود الإجراء الخارجي + لا بيانات مُختلقة
// ---------------------------------------------------------------------------
{
  check('7-كشف منصات المهمة', platformsInTask('انشر على facebook و tiktok').includes('facebook'));
  const offlineCtx = ctx({ connections: [{ platform: 'youtube', connected: true, verified: true }], task: 'انشر على Facebook' });
  const research = researchAgent(offlineCtx);
  check('7-المنصة غير المتصلة تُعلن UNAVAILABLE', research.outputs.some((o) => o.truthState === 'UNAVAILABLE' && o.statement.includes('facebook')));
  check('7-منصات الاتصال الموثّق فقط', connectedPlatforms(offlineCtx).length === 1 && connectedPlatforms(offlineCtx)[0] === 'youtube');
  check('7-لا يُدَّعى اتصال بلا توثيق', connectedPlatforms({ connections: [{ platform: 'facebook', connected: true, verified: false }] }).length === 0);

  // مهمة رد على منصة لا تدعم الرد => الاستراتيجية تُعلن UNAVAILABLE.
  const tiktok = ctx({ platform: 'tiktok', task: 'رد على التعليقات' });
  const strat = strategyAgent(tiktok, analysisAgent(tiktok, researchAgent(tiktok).outputs));
  check('7-لا توصية بقدرة غير متاحة', strat.some((o) => o.truthState === 'UNAVAILABLE' && o.statement.includes('الرد')));

  // لا سعر/رقم مُختلق: لا مخرج يحوي رقماً تجارياً غير مسجّل.
  const all = runTeamSession(ctx(), { trigger: 'youtube_event', platform: 'youtube', eventIdentity: 'comment:c9', now: NOW });
  const allOutputs = [...all.observations, ...all.analyses, ...all.recommendations, ...all.objections];
  const moneyRe = /\d[\d,]{3,}\s*(د\.ع|دينار|ألف)/;
  check('7-لا أسعار مُختلقة في المخرجات', !allOutputs.some((o) => moneyRe.test(o.statement)));
  check('7-لا معرّفات مزوّد مُختلقة', !allOutputs.some((o) => /providerId|externalReplyId/.test(o.statement)));
}

// ---------------------------------------------------------------------------
// 8) الذاكرة: القرار => سجل ذاكرة عبر النظام القائم + منع التكرار
// ---------------------------------------------------------------------------
{
  const session = runTeamSession(ctx(), { trigger: 'youtube_event', platform: 'youtube', eventIdentity: 'comment:cm', now: NOW });
  const records = teamSessionToMemoryRecords(session);
  check('8-القرار ينتج سجلاً ذاكرة', records.length === 1);
  check('8-سجل الذاكرة من نوع decision', records[0].kind === 'decision');
  check('8-سجل الذاكرة أصله derived', records[0].origin === 'derived');
  check('8-سجل الذاكرة يحمل مصدره', records[0].sourceRefs.length > 0);
  check('8-سجل الذاكرة بلا سرّ', !/token|secret|key/i.test(records[0].summary));

  // إدراج بلا تكرار عبر النظام القائم.
  let store = emptyBrainMemory();
  const r1 = upsertMemoryRecord(store, records[0]);
  store = r1.store;
  check('8-إدراج سجل الذاكرة نجح', r1.added === true && store.records.length === 1);
  const r2 = upsertMemoryRecord(store, records[0]);
  store = r2.store;
  check('8-إعادة إدراج نفس القرار لا تكرّر', r2.duplicate === true && store.records.length === 1);

  // جلسة بلا دليل (UNKNOWN) => لا ذاكرة.
  const noEvidence = runTeamSession(ctx({ comments: [], watcher: [], verifiedFacts: [] }), { trigger: 'manual', platform: 'youtube', eventIdentity: 'none', now: NOW });
  check('8-لا ذاكرة لقرار بلا دليل', teamSessionToMemoryRecords(noEvidence).length === 0);
}

// ---------------------------------------------------------------------------
// 9) ملخّصات
// ---------------------------------------------------------------------------
{
  let state = emptyTeamSessionState();
  state = upsertTeamSession(state, runTeamSession(ctx(), { trigger: 'youtube_event', platform: 'youtube', eventIdentity: 'a', now: NOW })).state;
  state = upsertTeamSession(state, runTeamSession(ctx(), { trigger: 'youtube_event', platform: 'youtube', eventIdentity: 'b', now: NOW, failAgent: (x) => x === 'research' })).state;
  const summary = summarizeTeamState(state);
  check('9-الملخّص يعدّ الجلسات', summary.total === 2);
  check('9-الملخّص يفصل completed/partial', summary.completed >= 1 && summary.partial >= 1);
  const s = summarizeTeamSession(state.sessions[0]);
  check('9-ملخّص الجلسة يحمل حالتها', typeof s.truthState === 'string' && typeof s.confidence === 'string');
  check('9-ملخّص الجلسة يعلن التحقق', typeof s.verified === 'boolean');
}

// ---------------------------------------------------------------------------
// النتيجة
// ---------------------------------------------------------------------------
console.log(`\n=== فريق الوكلاء (Agent Council) — اختبار الوحدة ===`);
console.log(`passed: ${passed}, failed: ${failures.length}`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('كل الفحوص نجحت.');
