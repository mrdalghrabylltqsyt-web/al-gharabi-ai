/**
 * مسارات العقل التجاري (Sales & Growth) — قراءة فقط.
 *
 * تعرض الحالة التجارية الحقيقية للمالك: المنتجات، إشارات الطلب، الفرص، مسار
 * العميل، العملاء المحتملون، المبيعات الموثّقة، حالة الحملات، والمؤشرات — كلها
 * من بيانات حقيقية، بلا أي سرّ وبلا أي تنفيذ.
 *
 * الحقن عبر `deps` يجعل الوحدة قابلة للاختبار ببيانات proof-based.
 */

import type express from 'express';
import { buildCommercialRuntime, type CommercialRawData } from './commercialRuntime';
import { buildCommercialMemorySeeds, mergeCommercialMemory, summarizeCommercialMemory } from './commercialMemory';
import { describeMissingInfo } from '../knowledge/catalog';
import type { BrainMemoryRecord, BrainMemoryStoreState } from '../memory/store';
import { DEMAND_SIGNAL_LABELS_AR, DEMAND_STRENGTH_LABELS_AR } from '../market/demandSignals';
import { OPPORTUNITY_LABELS_AR, EPISTEMIC_LABELS_AR } from '../market/opportunityEngine';
import { JOURNEY_STAGE_LABELS_AR } from './journey';
import { SALES_BLOCKER_LABELS_AR } from './salesReasoning';

export interface CommercialRoutesDeps {
  authenticateToken: express.RequestHandler;
  requireOwner: express.RequestHandler;
  /** بيانات الغرابي الحقيقية من مساحة العمل (بلا أي سرّ). */
  commercialInput: () => Omit<CommercialRawData, 'now'>;
  /** ذاكرة العقل الحالية (تُقرأ فقط). */
  memory: () => BrainMemoryStoreState;
  /** يحفظ سجلات الذاكرة الجديدة (بلا تكرار). لا يرمي. */
  persistMemory?: (records: BrainMemoryRecord[]) => void;
  now?: () => number;
}

/** ملخّص منتج آمن للعرض (بلا أي سرّ؛ أرقام تجارية حقيقية للمالك). */
function safeProduct(product: ReturnType<typeof buildCommercialRuntime>['catalog'][number]) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    brand: product.brand,
    model: product.model,
    inStock: product.availability.value ? product.availability.value.inStock : null,
    cashPrice: product.cashPrice.value,
    cashPriceState: product.cashPrice.state,
    availabilityState: product.availability.state,
    installmentOffers: product.installmentOffers.map((o) => ({
      durationMonths: o.durationMonths,
      downPaymentAmount: o.downPaymentAmount,
      monthlyAmount: o.monthlyAmount,
      state: o.state,
    })),
    ownerApproval: product.ownerApproval,
    lastVerifiedAt: product.lastVerifiedAt,
    missing: describeMissingInfo(product),
  };
}

export function registerCommercialRoutes(app: express.Express, deps: CommercialRoutesDeps): void {
  const now = deps.now || (() => Date.now());

  /** يبني الحالة ثم يدمج أي ذاكرة تجارية جديدة (بلا تكرار). */
  const buildState = () => {
    const runtime = buildCommercialRuntime({ ...deps.commercialInput(), now: now() });
    const seeds = buildCommercialMemorySeeds(runtime, now());
    const merged = mergeCommercialMemory(deps.memory(), seeds);
    if (merged.added > 0 && deps.persistMemory) {
      try { deps.persistMemory(seeds); } catch { /* الحفظ أفضل جهد */ }
    }
    return runtime;
  };

  // الحالة التجارية الكاملة — قراءة فقط، للمالك (بيانات عملاء/مبيعات حقيقية).
  app.get('/api/agent/brain/sales/state', deps.authenticateToken, deps.requireOwner, (_req, res) => {
    const runtime = buildState();
    const confirmedSales = runtime.journeys.filter((j) => j.saleVerified);
    const leads = deps.commercialInput().leads || [];
    res.json({
      success: true,
      generatedAt: runtime.generatedAt,
      labels: {
        demandKinds: DEMAND_SIGNAL_LABELS_AR,
        opportunityKinds: OPPORTUNITY_LABELS_AR,
        epistemic: EPISTEMIC_LABELS_AR,
        journeyStages: JOURNEY_STAGE_LABELS_AR,
        salesBlockers: SALES_BLOCKER_LABELS_AR,
      },
      catalog: {
        readiness: runtime.catalogReadiness,
        products: runtime.catalog.map(safeProduct),
      },
      demand: {
        summary: runtime.foundation.demand,
        topSignals: runtime.demandAggregates.slice(0, 20).map((a) => ({
          ...a,
          label: DEMAND_SIGNAL_LABELS_AR[a.kind],
          strengthLabel: DEMAND_STRENGTH_LABELS_AR[a.strength],
        })),
      },
      opportunities: runtime.opportunities.map((o) => ({ ...o, kindLabel: OPPORTUNITY_LABELS_AR[o.kind] })),
      journeys: {
        summary: runtime.foundation.journeys,
        confirmedSales: confirmedSales.map((j) => ({ subjectKey: j.subjectKey, productId: j.productId, stage: j.stage })),
      },
      sales: {
        verifiedSales: confirmedSales.length,
        revenue: runtime.foundation.roi.metrics.find((m) => m.key === 'revenue')?.value ?? null,
        leads: leads.length,
        requests: leads.filter((l: any) => String(l?.status) === 'proposal').length,
      },
      campaigns: runtime.foundation.campaigns,
      roi: runtime.foundation.roi,
      salesReasoning: runtime.foundation.salesReasoning,
      memory: summarizeCommercialMemory(deps.memory()),
      readinessGaps: runtime.foundation.readinessGaps,
      limitations: runtime.foundation.limitations,
      note: 'الحالة التجارية الحقيقية للغرابي: منتجات وإشارات طلب وفرص ومسار عملاء ومبيعات موثّقة — قراءة فقط بلا تنفيذ وبلا أسرار.',
    });
  });

  // ملخّص خفيف (للوحة المصغّرة) بلا تفاصيل العملاء.
  app.get('/api/agent/brain/sales/summary', deps.authenticateToken, (_req, res) => {
    const runtime = buildState();
    res.json({
      success: true,
      generatedAt: runtime.generatedAt,
      products: { total: runtime.catalogReadiness.total, incomplete: runtime.catalogReadiness.incomplete, withVerifiedPrice: runtime.catalogReadiness.withVerifiedPrice },
      demand: { total: runtime.foundation.demand.total, sufficient: runtime.foundation.demand.sufficient, insufficient: runtime.foundation.demand.insufficient },
      opportunities: runtime.foundation.opportunitySummary,
      journeys: runtime.foundation.journeys,
      campaigns: runtime.foundation.campaigns,
      readinessGaps: runtime.foundation.readinessGaps,
      note: 'ملخّص تجاري بلا بيانات عملاء تفصيلية.',
    });
  });
}
