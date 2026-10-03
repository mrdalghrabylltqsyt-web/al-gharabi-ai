/**
 * Unified Commercial Brain Routes — مسارات العقل التجاري المركزي (قراءة فقط).
 *
 * الغرض: عرض العقل التجاري الموحّد للمالك: الغاية العليا، ذكاء المنتجات، الفرص
 * المرتّبة، دورة العميل، الحملات، التجارب، الإسناد، التعلّم، البحث، الاستراتيجية،
 * القدرات، الصحة، الإصدارات، مركز التحكّم، ومركز القيادة.
 *
 * كل المسارات محمية بـ`authenticateToken`، والحالة الكاملة للمالك فقط. **لا مسار
 * تنفيذ خارجي ولا كتابة هنا** — العقل يقرأ ويحلّل ويقترح.
 */

import type express from 'express';
import { buildUnifiedCommercialBrain, type UnifiedCommercialInput } from './unified';
import { OBJECTIVE_TIER_LABELS_AR, NORTH_STAR_STATEMENT } from './northStar';
import { COMMERCIAL_TRUTH_LABELS_AR, FRESHNESS_LABELS_AR } from './truth';
import { LEARNING_VERDICT_LABELS_AR, LEARNING_SOURCE_LABELS_AR, EXPECTATION_VERDICT_LABELS_AR, IMPROVEMENT_VERDICT_LABELS_AR } from './learning';
import { PRODUCT_STATUS_LABELS_AR, PRODUCT_OPPORTUNITY_LABELS_AR } from './productIntel';
import { LIFECYCLE_STAGE_LABELS_AR, FOLLOW_UP_OUTCOME_LABELS_AR } from './lifecycle';
import { EXPERIMENT_VERDICT_LABELS_AR, EXPERIMENT_VARIABLE_LABELS_AR } from './campaignLoop';
import { COMMERCIAL_GOAL_LABELS_AR } from './strategy';
import { CAPABILITY_LEVEL_LABELS_AR, HEALTH_LEVEL_LABELS_AR } from './health';
import { CHANGE_PIPELINE_LABELS_AR } from './governance';
import { COMMERCIAL_MEMORY_LABELS_AR } from './commercialMemory';
import { OPERATING_LOOP_LABELS_AR, FINAL_COMMERCIAL_QUESTIONS, advanceOperatingLoop } from './operatingLoop';
import { IMPROVEMENT_DOMAIN_LABELS_AR, ACTION_TYPE_LABELS_AR, AUTONOMY_TIER_LABELS_AR } from './governance';
import { AGENT_GOVERNANCE_PRINCIPLES_AR, evaluateGovernance, type GovernanceRequest } from '../../agent/governanceGuard';

export interface CommercialRoutesDeps {
  authenticateToken: express.RequestHandler;
  requireOwner: express.RequestHandler;
  /** يبني مدخل العقل التجاري الموحّد من بيانات التطبيق الحقيقية (بلا سرّ). */
  commercialInput: () => Omit<UnifiedCommercialInput, 'now'>;
  now?: () => number;
}

export function commercialLabels() {
  return {
    objectiveTiers: OBJECTIVE_TIER_LABELS_AR,
    truthStates: COMMERCIAL_TRUTH_LABELS_AR,
    freshness: FRESHNESS_LABELS_AR,
    learningVerdicts: LEARNING_VERDICT_LABELS_AR,
    learningSources: LEARNING_SOURCE_LABELS_AR,
    expectationVerdicts: EXPECTATION_VERDICT_LABELS_AR,
    improvementVerdicts: IMPROVEMENT_VERDICT_LABELS_AR,
    productStatuses: PRODUCT_STATUS_LABELS_AR,
    productOpportunities: PRODUCT_OPPORTUNITY_LABELS_AR,
    lifecycleStages: LIFECYCLE_STAGE_LABELS_AR,
    followUpOutcomes: FOLLOW_UP_OUTCOME_LABELS_AR,
    experimentVerdicts: EXPERIMENT_VERDICT_LABELS_AR,
    experimentVariables: EXPERIMENT_VARIABLE_LABELS_AR,
    goals: COMMERCIAL_GOAL_LABELS_AR,
    capabilityLevels: CAPABILITY_LEVEL_LABELS_AR,
    healthLevels: HEALTH_LEVEL_LABELS_AR,
    changePipeline: CHANGE_PIPELINE_LABELS_AR,
    memoryKinds: COMMERCIAL_MEMORY_LABELS_AR,
    operatingLoop: OPERATING_LOOP_LABELS_AR,
    improvementDomains: IMPROVEMENT_DOMAIN_LABELS_AR,
    actionTypes: ACTION_TYPE_LABELS_AR,
    autonomyTiers: AUTONOMY_TIER_LABELS_AR,
  };
}

export function registerCommercialBrainRoutes(app: express.Express, deps: CommercialRoutesDeps): void {
  const now = deps.now || (() => Date.now());
  const build = () => buildUnifiedCommercialBrain({ ...deps.commercialInput(), now: now() });

  // الحالة الكاملة للعقل التجاري المركزي — للمالك فقط (تحتوي بيانات تجارية).
  app.get('/api/agent/brain/commercial/state', deps.authenticateToken, deps.requireOwner, (_req, res) => {
    const r = build();
    res.json({
      success: true,
      generatedAt: r.generatedAt,
      version: r.version,
      northStarStatement: NORTH_STAR_STATEMENT,
      labels: commercialLabels(),
      northStar: r.northStar,
      productIntel: r.productIntel,
      productOpportunities: r.productOpportunities,
      prioritizedOpportunities: r.prioritizedOpportunities,
      lifecycle: r.lifecycle,
      leadPriorities: r.leadPriorities,
      followUpLearning: r.followUpLearning,
      campaignReports: r.campaignReports,
      experiments: r.experiments,
      attributions: r.attributions,
      learning: r.learning,
      research: r.research,
      improvements: r.improvements,
      goals: r.goals,
      selfImprovementProposals: r.selfImprovementProposals,
      changePipeline: r.changePipeline,
      capabilityEvolution: r.capabilityEvolution,
      systemHealth: r.systemHealth,
      versions: r.versions,
      eventArchitecture: r.eventArchitecture,
      truthSummary: r.truthSummary,
      limitations: r.limitations,
      note: r.note,
    });
  });

  // ملخّص خفيف (بلا بيانات عملاء) لأي مستخدم مصرّح.
  app.get('/api/agent/brain/commercial/summary', deps.authenticateToken, (_req, res) => {
    const r = build();
    res.json({
      success: true,
      generatedAt: r.generatedAt,
      version: r.version,
      northStar: r.northStar,
      topOpportunities: r.prioritizedOpportunities.slice(0, 5).map((o) => ({ id: o.id, title: o.title, rank: o.rank })),
      capabilityCounts: r.capabilityEvolution.counts,
      systemHealth: r.systemHealth.overall,
      limitations: r.limitations,
    });
  });

  // مركز القيادة التجاري (اليوم/الفترة الحالية) — للمالك.
  app.get('/api/agent/brain/commercial/command-center', deps.authenticateToken, deps.requireOwner, (_req, res) => {
    const r = build();
    res.json({ success: true, generatedAt: r.generatedAt, commandCenter: r.commandCenter, northStar: r.northStar, note: 'كل رقم حقيقي أو NOT_AVAILABLE.' });
  });

  // مركز تحكّم المالك — للمالك.
  app.get('/api/agent/brain/commercial/owner-control', deps.authenticateToken, deps.requireOwner, (_req, res) => {
    const r = build();
    res.json({ success: true, generatedAt: r.generatedAt, ownerControlCenter: r.ownerControlCenter, note: 'ما يعرفه/تعلّمه/يراقبه/اكتشفه/يوصي به/يتوقّعه/حدث فعلاً/تغيّر/فشل/يحتاج موافقة/سيختبر/يقترح تحسينه.' });
  });

  // لوحة تطوّر القدرات — للمالك.
  app.get('/api/agent/brain/commercial/capabilities', deps.authenticateToken, deps.requireOwner, (_req, res) => {
    const r = build();
    res.json({ success: true, generatedAt: r.generatedAt, capabilityEvolution: r.capabilityEvolution, labels: CAPABILITY_LEVEL_LABELS_AR, note: 'المستوى من: منفّذة + اختبارات + جهوزية وقت التشغيل — لا نِسَب عشوائية.' });
  });

  // صحة النظام — محمية.
  app.get('/api/agent/brain/commercial/health', deps.authenticateToken, (_req, res) => {
    const r = build();
    res.json({ success: true, generatedAt: r.generatedAt, systemHealth: r.systemHealth, labels: HEALTH_LEVEL_LABELS_AR });
  });

  // دورة التشغيل + الأسئلة التجارية — محمية.
  app.get('/api/agent/brain/commercial/operating-loop', deps.authenticateToken, (_req, res) => {
    const r = build();
    const state = advanceOperatingLoop({ completed: ['OBSERVE', 'UNDERSTAND', 'VERIFY', 'RESEARCH', 'IDENTIFY_OPPORTUNITY', 'PRIORITIZE', 'HYPOTHESIS', 'PLAN', 'PREPARE'] });
    res.json({ success: true, generatedAt: r.generatedAt, operatingLoop: state, questions: FINAL_COMMERCIAL_QUESTIONS, labels: OPERATING_LOOP_LABELS_AR, note: 'لا تقدّم إلى تنفيذ/تحسين بلا اعتماد المالك.' });
  });

  // حوكمة الوكلاء — للمالك: المبادئ + عرض حيّ لقرار الحوكمة على سيناريوهات صريحة.
  // **تشخيص قراءة فقط**: لا يُنفَّذ أي إجراء، بل يُعلن القرار والكود والسبب لكل حالة.
  app.get('/api/agent/brain/commercial/governance', deps.authenticateToken, deps.requireOwner, (_req, res) => {
    const sample = (req: GovernanceRequest) => ({ request: req, decision: evaluateGovernance(req) });
    res.json({
      success: true,
      principles: AGENT_GOVERNANCE_PRINCIPLES_AR,
      // سيناريوهات مرجعية تثبت الفصل: تنفيذ صامت ممنوع، ادّعاء غير مثبت ممنوع، حساس يحتاج بشراً.
      samples: {
        ownerExternalApproved: sample({ operator: 'owner', permission: 'EXTERNAL_ACTION', externalAction: true, approved: true, claimVerified: true, sensitive: false }),
        ownerExternalUnapproved: sample({ operator: 'owner', permission: 'EXTERNAL_ACTION', externalAction: true, approved: false, claimVerified: true, sensitive: false }),
        staffWrite: sample({ operator: 'staff', permission: 'WRITE', externalAction: false, approved: false, claimVerified: true, sensitive: false }),
        unverifiedClaim: sample({ operator: 'owner', permission: 'READ', externalAction: false, approved: true, claimVerified: false, sensitive: false }),
        sensitiveAction: sample({ operator: 'owner', permission: 'SENSITIVE', externalAction: false, approved: true, claimVerified: true, sensitive: true }),
        systemExternalUnapproved: sample({ operator: 'system', permission: 'EXTERNAL_ACTION', externalAction: true, approved: false, claimVerified: true, sensitive: false }),
      },
      note: 'قرار الحوكمة تشخيصي: لا يُنفَّذ إجراء خارجي بلا تفويض صريح، ولا إجراء حسّاس بلا بشر.',
    });
  });
}
