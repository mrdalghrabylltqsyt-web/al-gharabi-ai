/**
 * مسارات العقل المركزي للمبيعات الرقمية — قراءة فقط.
 *
 * تعرض للمالك: القُمع الرقمي، الإشارات الشرائية، العملاء المؤهّلون، الطلبات،
 * المبيعات الموثّقة، الخسائر وأسبابها، التسليم البشري، المتابعات، الإسناد،
 * والاستدلال البيعي — كلها من بيانات حقيقية بلا أي سرّ وبلا تنفيذ خارجي.
 *
 * الحقن عبر `deps` يجعل الوحدة قابلة للاختبار ببيانات proof-based.
 */

import type express from 'express';
import { buildDigitalSalesState, type DigitalRawData } from './runtime';
import { LEAD_STAGE_LABELS_AR, QUALIFICATION_LABELS_AR } from './lead';
import { PURCHASE_INTENT_LABELS_AR, PURCHASE_SIGNAL_LABELS_AR } from './intent';
import { OFFER_ANSWER_STATE_LABELS_AR } from './offer';
import { HANDOFF_REASON_LABELS_AR } from './handoff';
import { ATTRIBUTION_LABELS_AR } from './attribution';
import { SALES_EVENT_LABELS_AR } from './events';
import { DIGITAL_FUNNEL_LABELS_AR } from './salesFunnel';
import { AUTONOMY_LEVEL_LABELS_AR, ACTION_REQUIRED_LEVEL, NEVER_SILENT_ACTIONS, defaultGrantedLevel } from './autonomy';
import { IDENTITY_CONFIDENCE_LABELS_AR, IDENTITY_WITHHELD_FIELDS } from './identity';

export interface DigitalRoutesDeps {
  authenticateToken: express.RequestHandler;
  requireOwner: express.RequestHandler;
  /** بيانات الغرابي الحقيقية من مساحة العمل (بلا أي سرّ). */
  commercialInput: () => Omit<DigitalRawData, 'now'>;
  now?: () => number;
}

export function digitalLabels() {
  return {
    leadStages: LEAD_STAGE_LABELS_AR,
    qualification: QUALIFICATION_LABELS_AR,
    purchaseIntent: PURCHASE_INTENT_LABELS_AR,
    purchaseSignals: PURCHASE_SIGNAL_LABELS_AR,
    offerAnswerStates: OFFER_ANSWER_STATE_LABELS_AR,
    handoffReasons: HANDOFF_REASON_LABELS_AR,
    attribution: ATTRIBUTION_LABELS_AR,
    salesEvents: SALES_EVENT_LABELS_AR,
    digitalFunnel: DIGITAL_FUNNEL_LABELS_AR,
    autonomyLevels: AUTONOMY_LEVEL_LABELS_AR,
    identityConfidence: IDENTITY_CONFIDENCE_LABELS_AR,
  };
}

export function registerDigitalSalesRoutes(app: express.Express, deps: DigitalRoutesDeps): void {
  const now = deps.now || (() => Date.now());
  const build = () => buildDigitalSalesState({ ...deps.commercialInput(), now: now() });

  // الحالة الكاملة للعقل الرقمي — للمالك (تحتوي بيانات عملاء/تجارية).
  app.get('/api/agent/brain/sales/digital/state', deps.authenticateToken, deps.requireOwner, (_req, res) => {
    const st = build();
    res.json({
      success: true,
      generatedAt: st.generatedAt,
      labels: digitalLabels(),
      identityNotStored: IDENTITY_WITHHELD_FIELDS,
      summary: st.summary,
      funnel: st.funnel,
      intents: st.intents.map((i) => ({
        platform: i.platform,
        externalId: i.externalId,
        productId: i.productId,
        intent: { state: i.intent.state, stateLabel: PURCHASE_INTENT_LABELS_AR[i.intent.state], confidence: i.intent.confidence, signals: i.intent.signals, reason: i.intent.reason, productVerified: i.intent.productVerified },
        answer: i.answer ? { state: i.answer.state, stateLabel: OFFER_ANSWER_STATE_LABELS_AR[i.answer.state], questionKind: i.answer.questionKind, productName: i.answer.productName, answerText: i.answer.answerText, valueSource: i.answer.valueSource, missing: i.answer.missing, needsHuman: i.answer.needsHuman } : null,
        handoff: i.handoff ? { required: i.handoff.required, reasonLabel: i.handoff.reasonLabelAr, recommendedAction: i.handoff.recommendedAction, evidence: i.handoff.evidence } : null,
        identity: { confidence: i.identity.confidence, confidenceLabel: IDENTITY_CONFIDENCE_LABELS_AR[i.identity.confidence], reason: i.identity.reason },
      })),
      leads: st.leads.map((l) => ({ leadId: l.leadId, stage: l.stage, stageLabel: LEAD_STAGE_LABELS_AR[l.stage], platform: l.platform, productId: l.productId, campaignId: l.campaignId, qualification: l.qualification, qualificationLabel: QUALIFICATION_LABELS_AR[l.qualification], evidence: l.evidence, history: l.history })),
      lostOpportunities: st.lostOpportunities,
      followUps: st.followUps.map((f) => ({ leadId: f.leadId, state: f.opportunity.state, why: f.opportunity.why, when: f.opportunity.when, whatToSay: f.opportunity.whatToSay, evidence: f.opportunity.evidence, confidence: f.opportunity.confidence, blockers: f.opportunity.blockers })),
      handoffs: st.handoffs,
      attributions: st.attributions.map((a) => ({ saleId: a.saleId, leadId: a.leadId, state: a.result.state, stateLabel: ATTRIBUTION_LABELS_AR[a.result.state], canClaimCausation: a.result.canClaimCausation, linked: a.result.linked, missing: a.result.missing, reason: a.result.reason })),
      reasoning: st.reasoning,
      limitations: st.limitations,
      nextActions: st.nextActions,
      note: 'عقل المبيعات الرقمية — قراءة وتحضير فقط من بيانات حقيقية، بلا تنفيذ وبلا أسرار.',
    });
  });

  // ملخّص خفيف (بلا بيانات عملاء) لأي مستخدم مصرّح.
  app.get('/api/agent/brain/sales/digital/summary', deps.authenticateToken, (_req, res) => {
    const st = build();
    res.json({
      success: true,
      generatedAt: st.generatedAt,
      summary: st.summary,
      funnel: st.funnel,
      lostReasons: st.lostOpportunities.map((l) => l.reason),
      attributionStates: st.attributions.map((a) => a.result.state),
      nextActions: st.nextActions.slice(0, 5),
      note: 'ملخّص المبيعات الرقمية بلا بيانات عملاء تفصيلية.',
    });
  });

  // لوحة المالك: القُمع الرقمي + المنتجات المولّدة للمبيعات + الحملات + الفجوات.
  app.get('/api/agent/brain/sales/digital/dashboard', deps.authenticateToken, deps.requireOwner, (_req, res) => {
    const st = build();
    const productSales = new Map<string, number>();
    for (const s of (deps.commercialInput().sales || [])) {
      const pid = typeof s?.productId === 'string' ? s.productId : '';
      if (pid) productSales.set(pid, (productSales.get(pid) || 0) + 1);
    }
    const productsGeneratingSales = [...productSales.entries()].map(([productId, count]) => {
      const p = st.catalog.find((c) => c.id === productId);
      return { productId, productName: p ? p.name : null, verifiedSales: count };
    });
    res.json({
      success: true,
      generatedAt: st.generatedAt,
      digitalSalesFunnel: st.funnel,
      funnelBottleneck: st.funnel.bottleneck,
      inquiries: st.summary.interactions,
      purchaseSignals: st.summary.purchaseSignals,
      qualifiedLeads: st.summary.qualifiedLeads,
      unresolvedLeads: st.summary.unresolved,
      followUps: st.summary.followUpOpportunities,
      humanHandoffs: st.summary.humanHandoffs,
      requests: st.summary.requests,
      verifiedSales: st.summary.verifiedSales,
      productsGeneratingSales,
      campaignsGeneratingLeads: st.leads.filter((l) => l.campaignId).map((l) => ({ leadId: l.leadId, campaignId: l.campaignId, stage: l.stage })),
      campaignsLinkedToSales: st.attributions.filter((a) => a.result.canClaimCausation).map((a) => ({ saleId: a.saleId, campaignId: (a.result.linked.includes('campaignId') ? true : null), state: a.result.state })),
      lostOpportunities: st.lostOpportunities,
      attributionStates: st.attributions.map((a) => ({ saleId: a.saleId, state: a.result.state, stateLabel: ATTRIBUTION_LABELS_AR[a.result.state] })),
      reasoning: st.reasoning.map((r) => ({ productId: r.productId, productName: r.productName, verdictAvailable: r.verdictAvailable, supportedBlockers: r.supportedBlockers.map((b) => b.blocker), whatWeKnow: r.whatWeKnow, whatWeDontKnow: r.whatWeDontKnow, ownerActions: r.ownerActions })),
      nextActions: st.nextActions,
      note: 'لوحة المبيعات الرقمية: كل رقم من سجل حقيقي، وعنق الزجاجة والإجراءات من بيانات فعلية.',
    });
  });

  // طبقة الأحداث الجاهزة للتعلّم (الدفعة 4) — بلا بيانات شخصية.
  app.get('/api/agent/brain/sales/digital/events', deps.authenticateToken, deps.requireOwner, (_req, res) => {
    const st = build();
    res.json({
      success: true,
      generatedAt: st.generatedAt,
      labels: SALES_EVENT_LABELS_AR,
      count: st.events.length,
      events: st.events.map((e) => ({ eventId: e.eventId, type: e.type, typeLabel: SALES_EVENT_LABELS_AR[e.type], at: e.at, platform: e.platform, productId: e.productId, leadId: e.leadId, campaignId: e.campaignId, previousState: e.previousState, newState: e.newState, evidence: e.evidence, attribution: e.attribution, reason: e.reason, confidence: e.confidence, humanIntervention: e.humanIntervention, outcome: e.outcome, learningEligible: e.learningEligible })),
      note: 'أحداث تجارية منظّمة آمنة الخصوصية جاهزة لتعلّم الدفعة 4 — بلا بيانات شخصية.',
    });
  });

  // مرجع مستويات الاستقلالية — بلا أي سرّ.
  app.get('/api/agent/brain/sales/digital/autonomy', deps.authenticateToken, (_req, res) => {
    res.json({
      success: true,
      defaultLevel: defaultGrantedLevel(),
      levels: AUTONOMY_LEVEL_LABELS_AR,
      requiredLevelPerAction: ACTION_REQUIRED_LEVEL,
      neverSilentActions: NEVER_SILENT_ACTIONS,
      note: 'الافتراضي آمن (مراقبة). لا فعل تجاري خارجي بلا اعتماد مطابق.',
    });
  });
}
