/**
 * مسارات عقل التسويق والطلب (Growth & Demand) — قراءة فقط.
 *
 * تعرض للمالك: الطلب الحالي والمتزايد، أقوى الفرص، المنتجات المولّدة للاهتمام،
 * الحملات، التجارب، الاستفسارات، العملاء المحتملون، المبيعات الموثّقة، عنق
 * الزجاجة، والإجراءات الموصى بها — كلها من بيانات حقيقية بلا أي سرّ وبلا تنفيذ.
 *
 * الحقن عبر `deps` يجعل الوحدة قابلة للاختبار ببيانات proof-based.
 */

import type express from 'express';
import { buildGrowthRuntime, type GrowthRawData } from './runtime';
import { SEGMENT_STATE_LABELS_AR, SEGMENT_NOT_AVAILABLE_FIELDS } from './segments';
import { DEMAND_DETECTION_LABELS_AR, DEMAND_TREND_LABELS_AR } from './demandDiscovery';
import { MATCH_STATE_LABELS_AR } from './matching';
import { CAMPAIGN_LIFECYCLE_LABELS_AR } from './campaigns';
import { EXPERIMENT_TYPE_LABELS_AR } from './experiments';
import { SALES_FUNNEL_LABELS_AR } from './funnel';
import { EPISTEMIC_LABELS_AR } from '../market/opportunityEngine';

export interface GrowthRoutesDeps {
  authenticateToken: express.RequestHandler;
  requireOwner: express.RequestHandler;
  /** بيانات الغرابي الحقيقية من مساحة العمل (بلا أي سرّ). */
  commercialInput: () => Omit<GrowthRawData, 'now'>;
  now?: () => number;
}

export function growthLabels() {
  return {
    segmentStates: SEGMENT_STATE_LABELS_AR,
    demandKinds: DEMAND_DETECTION_LABELS_AR,
    demandTrends: DEMAND_TREND_LABELS_AR,
    matchStates: MATCH_STATE_LABELS_AR,
    campaignLifecycle: CAMPAIGN_LIFECYCLE_LABELS_AR,
    experimentTypes: EXPERIMENT_TYPE_LABELS_AR,
    funnelStages: SALES_FUNNEL_LABELS_AR,
    epistemic: EPISTEMIC_LABELS_AR,
  };
}

export function registerGrowthRoutes(app: express.Express, deps: GrowthRoutesDeps): void {
  const now = deps.now || (() => Date.now());
  const build = () => buildGrowthRuntime({ ...deps.commercialInput(), now: now() });

  // الحالة الكاملة لعقل التسويق والطلب — للمالك (تحتوي بيانات تجارية/عملاء).
  app.get('/api/agent/brain/growth/state', deps.authenticateToken, deps.requireOwner, (_req, res) => {
    const rt = build();
    res.json({
      success: true,
      generatedAt: rt.generatedAt,
      labels: growthLabels(),
      audienceNotAvailableFields: SEGMENT_NOT_AVAILABLE_FIELDS,
      audience: { summary: rt.segmentSummary, segments: rt.segments },
      demand: {
        summary: rt.demandSummary,
        opportunities: rt.demandOpportunities.map((o) => ({ ...o, kindLabel: DEMAND_DETECTION_LABELS_AR[o.kind] })),
      },
      matching: { summary: rt.matchSummary, matches: rt.matches },
      campaigns: { summary: rt.campaignSummary, items: rt.campaigns },
      experiments: { summary: rt.experimentSummary, items: rt.experiments },
      funnel: { summary: rt.funnelSummary, ...rt.funnel },
      platformBriefs: rt.platformBriefs,
      nextActions: rt.nextActions,
      limitations: rt.limitations,
      note: 'عقل التسويق والطلب — قراءة فقط من بيانات حقيقية، بلا تنفيذ وبلا أسرار.',
    });
  });

  // ملخّص خفيف (بلا تفاصيل عملاء) لأي مستخدم مصرّح.
  app.get('/api/agent/brain/growth/summary', deps.authenticateToken, (_req, res) => {
    const rt = build();
    res.json({
      success: true,
      generatedAt: rt.generatedAt,
      audience: rt.segmentSummary,
      demand: rt.demandSummary,
      matching: rt.matchSummary,
      campaigns: rt.campaignSummary,
      experiments: rt.experimentSummary,
      funnel: rt.funnelSummary,
      nextActions: rt.nextActions.slice(0, 5),
      note: 'ملخّص عقل التسويق والطلب بلا بيانات عملاء تفصيلية.',
    });
  });

  // لوحة المالك: الطلب/الفرص/المنتجات/الحملات/التجارب/القُمع/عنق الزجاجة/الإجراءات.
  app.get('/api/agent/brain/growth/dashboard', deps.authenticateToken, deps.requireOwner, (_req, res) => {
    const rt = build();
    const rising = rt.demandOpportunities.filter((o) => o.trend === 'RISING');
    const strongest = rt.demandOpportunities.filter((o) => o.sufficientSample).slice(0, 10);
    const productsGeneratingInterest = rt.matches
      .filter((m) => m.state !== 'NO_EVIDENCE')
      .map((m) => ({ productId: m.productId, productName: m.productName, state: m.state, who: m.who.map((w) => w.segmentLabel) }))
      .slice(0, 20);
    res.json({
      success: true,
      generatedAt: rt.generatedAt,
      currentDemand: { total: rt.demandSummary.total, sufficient: rt.demandSummary.sufficient, byKind: rt.demandSummary },
      risingDemand: rising.map((o) => ({ id: o.id, kindLabel: o.kindLabel, productId: o.productId, trendLabel: DEMAND_TREND_LABELS_AR[o.trend], evidence: o.evidence })),
      strongestOpportunities: strongest.map((o) => ({ id: o.id, kindLabel: o.kindLabel, sampleSize: o.sampleSize, confidence: o.confidence, recommendedAction: o.recommendedAction })),
      productsGeneratingInterest,
      campaigns: rt.campaigns.map((c) => ({ id: c.id, objective: c.objective, productName: c.productName, status: c.status, expectedResult: c.expectedResult, actualResult: c.actualResult })),
      experiments: rt.experiments.map((e) => ({ id: e.id, typeLabel: e.typeLabel, hypothesis: e.hypothesis, status: e.status, verdict: e.verdict })),
      funnel: rt.funnel,
      conversionBottleneck: rt.funnel.bottleneck,
      nextActions: rt.nextActions,
      note: 'لوحة المالك: الطلب الحالي والمتزايد وأقوى الفرص والحملات والتجارب والقُمع وعنق الزجاجة والإجراءات الموصى بها — بلا اختراع.',
    });
  });
}
