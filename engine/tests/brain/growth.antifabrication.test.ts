/**
 * اختبار مكافحة الاختلاق في عقل التسويق والطلب (Growth & Demand).
 *
 * يثبت صراحةً أنه **لا** يُختلق: جمهور، وصول، مبيعات، إيراد، معدّل تحويل،
 * نتيجة حملة، ولا منتج. كل رقم إمّا من سجل حقيقي أو يُعلن غير متاح.
 *
 * تشغيل: npx tsx engine/tests/brain/growth.antifabrication.test.ts
 */

import assert from 'node:assert';

import { buildGrowthRuntime } from '../../brain/growth/runtime';
import { buildSalesFunnel } from '../../brain/growth/funnel';
import { deriveAudienceSegments, SEGMENT_NOT_AVAILABLE_FIELDS } from '../../brain/growth/segments';
import { detectDemandOpportunities } from '../../brain/growth/demandDiscovery';
import { buildCampaignFromOpportunity, recordActualResult } from '../../brain/growth/campaigns';
import { buildRoiReport } from '../../brain/sales/roi';
import { buildRoiInput } from '../../brain/sales/commercialRuntime';

let passed = 0;
const check = (name: string, cond: boolean) => {
  assert.ok(cond, `FAIL: ${name}`);
  passed += 1;
};

const NOW = Date.parse('2026-10-02T10:00:00.000Z');

// 1) بلا بيانات ⇒ لا جمهور، لا فرص، لا حملات، لا أرقام
{
  const rt = buildGrowthRuntime({ now: NOW } as any);
  check('1-لا جمهور بلا دليل', rt.segments.length === 0 && rt.matches.every((m) => m.state === 'NO_EVIDENCE'));
  check('1-لا فرص بلا دليل', rt.demandOpportunities.length === 0);
  check('1-لا حملات بلا سبب', rt.campaigns.length === 0);
  check('1-لا تجارب بلا حملات', rt.experiments.length === 0);
  check('1-القُمع يعلن غير المتاح لا صفراً', rt.funnel.stages.find((s) => s.stage === 'REACH')!.available === false);
}

// 2) القُمع: لا معدّل تحويل بمقام ناقص/صفر ولا بيع مُختلق
{
  const funnel = buildSalesFunnel({ reach: null, interest: null, inquiries: null, leads: null, verifiedSales: null });
  check('2-لا معدّلات بلا بيانات', funnel.conversions.every((c) => c.ratePct === null));
  check('2-لا عنق زجاجة بلا بيانات', funnel.bottleneck === null);

  const zero = buildSalesFunnel({ reach: 100, interest: 0, inquiries: 0, leads: 0, verifiedSales: 0 });
  check('2-لا قسمة على صفر', zero.conversions.find((c) => c.from === 'INTEREST')!.ratePct === null);
  check('2-الصفر الحقيقي يبقى صفراً (لا يُعلن غير متاح)', zero.stages.find((s) => s.stage === 'INTEREST')!.value === 0 && zero.stages.find((s) => s.stage === 'INTEREST')!.available);
}

// 3) ROI: لا إيراد ولا تكلفة مُختلقة
{
  const roiInput = buildRoiInput({ performanceRecords: [], demandSignals: 5, leads: [], sales: [] });
  const roi = buildRoiReport(roiInput);
  check('3-الوصول غير متاح بلا سجل', roi.metrics.find((m) => m.key === 'reach')!.value === null);
  check('3-تكلفة الحملة غير متاحة', roi.metrics.find((m) => m.key === 'campaign_cost')!.value === null);
  check('3-لا ROAS بلا تكلفة/إيراد', roi.roas.value === null);
}

// 4) المقاطع: لا سمات سكانية مُختلقة (معلنة NOT_AVAILABLE)
{
  check('4-الحقول الحساسة معلنة غير متاحة', SEGMENT_NOT_AVAILABLE_FIELDS.some((f) => f.field === 'age') && SEGMENT_NOT_AVAILABLE_FIELDS.some((f) => f.field === 'income'));
  const segs = deriveAudienceSegments({ interactions: [], hasInstallmentPlans: false });
  check('4-لا مقاطع بلا تفاعل', segs.length === 0);
}

// 5) فرص الطلب: لا منتج مُختلق، والعيّنة الناقصة تُعلن
{
  const interactions = [{
    platform: 'facebook' as any, externalId: 'x1', text: 'شكد السعر؟', at: '2026-10-01T00:00:00Z',
    productId: null, productCategory: null,
    classification: { category: 'question' as any, topic: 'price' as any, text: 'شكد السعر؟', externalId: 'x1', platform: 'facebook' as any },
  }];
  const opps = detectDemandOpportunities({ interactions, catalogProductIds: [] });
  check('5-بلا منتج ⇒ productId يبقى null', opps.every((o) => o.productId === null));
  check('5-عيّنة ناقصة تُعلن', opps.every((o) => !o.sufficientSample));
}

// 6) الحملات: لا نتيجة بلا مصدر
{
  const opps = detectDemandOpportunities({
    interactions: [1, 2, 3].map((i) => ({
      platform: 'facebook' as any, externalId: `s${i}`, text: 'شكد سعر الغسالة؟', at: `2026-09-2${i}T00:00:00Z`,
      productId: 'p1', productCategory: 'appliances',
      classification: { category: 'question' as any, topic: 'price' as any, text: 'شكد سعر الغسالة؟', externalId: `s${i}`, platform: 'facebook' as any },
    })),
    catalogProductIds: ['p1'],
  });
  const campaign = buildCampaignFromOpportunity({ opportunity: opps[0], segment: null, match: null, now: NOW });
  check('6-النتيجة الفعلية تبدأ غير متاحة', campaign.actualResult.value === null && campaign.revenue === null && campaign.verifiedSales === null);
  const attempt = recordActualResult(campaign, { value: 99, source: null, now: NOW });
  check('6-رفض نتيجة بلا مصدر', attempt.recorded === false && attempt.campaign.actualResult.value === null);
}

// 7) لا Gemini في أي مخرج
{
  const rt = buildGrowthRuntime({ now: NOW } as any);
  check('7-لا مزوّد AI في المخرج', !/gemini|generateContent|GoogleGenAI/i.test(JSON.stringify(rt)));
}

console.log(`PASSED: ${passed} Growth & Demand anti-fabrication checks`);
