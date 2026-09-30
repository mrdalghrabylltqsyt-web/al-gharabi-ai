/**
 * اختبار معمارية: مصدر قرار/ذاكرة واحد — ONE CENTRAL BRAIN + PLATFORM ARMS.
 *
 * يُثبت بالدليل أن العقل المركزي canonical (`engine/brain/*`) هو المصدر الوحيد
 * للقرار والذاكرة في التشغيل، وأن `engine/social/brain.ts` لم يعد له أي مستهلك
 * runtime، وأن الإسقاطات التوافقية لا تُعيد تشغيل أي منطق أعمال مستقل.
 *
 * منطق خالص + خادم Express حقيقي: لا شبكة خارجية ولا أسرار ولا AI.
 */

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { registerSocialManagerRoutes } from '../social/routes';
import { buildRuntimeBrain, type RuntimeBrainInput } from '../brain/runtime';
import { emptyBrainMemory } from '../brain/memory/store';
import { toMarketingDecisionProjection, toOperationalMemoryProjection } from '../brain/projections';
import type { PlatformId } from '../social/adapter';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ملفات الإنتاج (بلا اختبارات) التي يجوز أن تحوي منطق تشغيل.
function runtimeSourceFiles(): string[] {
  const out: string[] = ['server.ts'];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === 'tests' || entry.name === 'node_modules') continue;
        walk(rel);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push(rel);
      }
    }
  };
  walk('engine');
  walk('src');
  return out;
}

const RUNTIME_FILES = runtimeSourceFiles();
const readsBrainModule = (src: string) => /from ['"]\.\.?\/.*\bsocial\/brain['"]|from ['"]\.\/brain['"]/.test(src);

const NOW = Date.parse('2026-09-28T12:00:00Z');
const PLATFORMS: PlatformId[] = ['youtube', 'facebook', 'instagram', 'telegram', 'tiktok', 'x', 'snapchat', 'threads', 'whatsapp', 'google_business'];

function canonicalInput(): RuntimeBrainInput {
  return {
    platforms: PLATFORMS,
    now: NOW,
    goalPrimary: 'SALES',
    records: [
      { platform: 'youtube', externalId: 'VID_A', contentType: 'تعليمي', values: { views: 4000, likes: 120 }, publishedAt: '2026-09-20T18:00:00Z' },
      { platform: 'youtube', externalId: 'VID_B', contentType: 'تعليمي', values: { views: 3800, likes: 100 }, publishedAt: '2026-09-21T19:00:00Z' },
      { platform: 'youtube', externalId: 'VID_C', contentType: 'إعلان', values: { views: 1200, likes: 30 }, publishedAt: '2026-09-22T20:00:00Z' },
    ],
    comments: [
      { platform: 'youtube', externalId: 'C1', text: 'هل عندكم تقسيط؟' },
      { platform: 'youtube', externalId: 'C2', text: 'وين موقع المعرض؟' },
      { platform: 'youtube', externalId: 'C3', text: 'شكد سعر الغسالة؟' },
    ],
    replies: [],
    publishes: [],
    watcher: [],
    connections: [{ platform: 'youtube', connected: true, verified: true }],
    verifiedFacts: [],
    productFacts: { productName: 'غسالة', priceText: null, specs: [], inStock: null, showroomPhone: null, showroomLocation: null },
    memory: emptyBrainMemory(),
  };
}

function buildApp(workspace: any, centralBrainState: () => any) {
  const app = express();
  app.use(express.json());
  const auth: express.RequestHandler = (req, _res, next) => { (req as any).user = { id: 'owner', role: 'owner' }; next(); };
  const connections = new Map<string, any>();
  for (const id of PLATFORMS) connections.set(id, { platform: id, status: 'disconnected' });
  registerSocialManagerRoutes(app, {
    authenticateToken: auth,
    requireOwner: auth,
    workspace,
    platformConnections: connections,
    persistState: () => {},
    audit: () => {},
    workspaceId: (prefix: string) => `${prefix}-arch-${Math.random().toString(16).slice(2, 8)}`,
    centralBrainState,
  });
  return app;
}

async function run(): Promise<void> {
  const PORT = 4519 + Math.floor(Math.random() * 400);
  const BASE = `http://127.0.0.1:${PORT}`;

  // --------------------------------------------------------------------- A
  group('A) العقل canonical هو مُنتِج القرار الوحيد في التشغيل');
  {
    const offenders = RUNTIME_FILES.filter((f) => readsBrainModule(read(f)));
    check('لا ملف تشغيل يستورد engine/social/brain.ts', offenders.length === 0, `offenders=${offenders.join(', ')}`);
    const routes = read('engine/social/routes.ts');
    check('routes.ts يستخدم إسقاط canonical', routes.includes('toMarketingDecisionProjection') && !routes.includes('buildMarketingDecision'));
    const server = read('server.ts');
    check('server.ts يستخدم buildRuntimeBrain للقرار', server.includes('toMarketingDecisionProjection') && !/buildMarketingDecision/.test(server));
  }

  // --------------------------------------------------------------------- B
  group('B) العقل canonical هو مُنتِج الذاكرة الوحيد في التشغيل');
  {
    const routes = read('engine/social/routes.ts');
    check('routes.ts يستخدم إسقاط الذاكرة canonical', routes.includes('toOperationalMemoryProjection') && !routes.includes('buildMemorySnapshot'));
    const server = read('server.ts');
    check('server.ts لا يبني ذاكرة مستقلة', server.includes('toOperationalMemoryProjection') && !/buildMemorySnapshot/.test(server));
  }

  // --------------------------------------------------------------------- C
  group('C) marketing_decision يساوي إسقاط القرار canonical');
  {
    const state = buildRuntimeBrain(canonicalInput()).state;
    const projection = toMarketingDecisionProjection({ state, objective: 'هدف اختباري' });
    check('الخطة تغطي كل منصات الحالة canonical', projection.plan.length === state.platformStates.length, `${projection.plan.length}/${state.platformStates.length}`);
    check('شرائح الجمهور = شرائح العقل canonical', JSON.stringify(projection.audience.segments) === JSON.stringify((state.audience?.segments || []).map((s) => s.label)));
    check('الفجوات مُشتقة من التعلّم canonical (عيّنات ناقصة)', projection.dataGaps.some((g) => g.includes('عيّنة أداء غير كافية')));
    check('الهدف يُمرَّر كما هو', projection.objective === 'هدف اختباري');
    // ثبات: نفس الحالة canonical => نفس الإسقاط (بلا حساب عشوائي).
    const again = toMarketingDecisionProjection({ state, objective: 'هدف اختباري' });
    check('الإسقاط ثابت لنفس الحالة', JSON.stringify(again) === JSON.stringify(projection));
  }

  // --------------------------------------------------------------------- D
  group('D) memory_snapshot يساوي إسقاط الذاكرة canonical');
  {
    const state = buildRuntimeBrain(canonicalInput()).state;
    const memory = toOperationalMemoryProjection(state, { decisions: [], strategiesTested: [] });
    const allComments = Object.values(state.commentsByPlatform || {}).flat().filter(Boolean) as Array<{ text: string }>;
    check('الأسئلة المتكررة مشتقة من تعليقات الحالة canonical', memory.frequentQuestions.length >= 1 && memory.frequentQuestions.length <= allComments.length, `q=${memory.frequentQuestions.length} comments=${allComments.length}`);
    check('تفصيل المنصات = سجلات الحالة canonical', Object.values(memory.platformBreakdown).reduce((s, n) => s + n, 0) === state.records.length);
    const again = toOperationalMemoryProjection(state, { decisions: [], strategiesTested: [] });
    check('الذاكرة ثابتة لنفس الحالة', JSON.stringify(again) === JSON.stringify(memory));
  }

  // --------------------------------------------------------------------- E
  group('E) مسارات/إسقاطات التوافق بلا منطق أعمال مستقل');
  {
    const compat = read('engine/brain/compat.ts');
    check('compat لا تُعيد تشغيل محرّك التوصيات', !compat.includes('buildRecommendationBundle'));
    check('compat لا تُعيد تشغيل محرّك الجمهور', !compat.includes('analyzeCrossPlatformAudience'));
    check('compat لا تُعيد تشغيل محرّك التعلّم', !compat.includes('summarizeCrossPlatformLearning'));
    const proj = read('engine/brain/projections.ts');
    check('projections لا تستدعي أي محرّك توصية/جمهور/تعلّم/استراتيجية', !/buildRecommendationBundle|recommendPlatformFocus|analyzeCrossPlatformAudience|buildLearningLoop|buildStrategyPlan/.test(proj));
    check('projections لا تستهلك AI', !/aiEngine|GoogleGenAI|generateContent/.test(proj));
    check('compat مشتق من state مباشرةً', compat.includes('state.recommendations') && compat.includes('state.crossPlatformLearning'));
  }

  // --------------------------------------------------------------------- F
  group('F) engine/social/brain.ts بلا أي مستهلك runtime');
  {
    const brain = read('engine/social/brain.ts');
    check('الملف موثّق LEGACY / TEST-ONLY', brain.includes('LEGACY') && brain.includes('TEST-ONLY'));
    const offenders = RUNTIME_FILES.filter((f) => readsBrainModule(read(f)));
    check('لا مستهلك runtime', offenders.length === 0, offenders.join(', '));
  }

  // --------------------------------------------------------------------- G
  group('G) محوّلات المنصات لا تنتج قرارات استراتيجية');
  {
    const adapter = read('engine/social/adapter.ts');
    const registry = read('engine/social/registry.ts');
    for (const [name, src] of [['adapter', adapter], ['registry', registry]] as const) {
      check(`${name} لا ينتج قراراً/توصية/ذاكرة`, !/buildMarketingDecision|buildMemorySnapshot|buildRecommendationBundle|buildStrategyPlan/.test(src));
    }
    // وحدات البيانات/التحليل (platformLearning/audienceIntelligence) لا تنتج قراراً بنفسها — تُستهلك من العقل.
    const learning = read('engine/social/platformLearning.ts');
    const audience = read('engine/social/audienceIntelligence.ts');
    check('platformLearning لا تُنتج قراراً', !/buildMarketingDecision|buildStrategyPlan|recommendPlatformFocus/.test(learning));
    check('audienceIntelligence لا تُنتج قراراً', !/buildMarketingDecision|buildStrategyPlan/.test(audience));
  }

  // --------------------------------------------------------------------- ربط حقيقي (HTTP)
  group('H) المسارات الحقيقية تُعيد نفس إسقاط الحالة canonical');
  {
    const workspace = {
      showroom: { name: 'معرض الغرابي للتقسيط' },
      posts: [], socialComments: [], socialReplies: [], publishRecords: [],
      performanceRecords: [], marketingDecisions: [], strategiesTested: [],
    };
    const state = buildRuntimeBrain(canonicalInput()).state;
    const app = buildApp(workspace, () => state);
    const server = app.listen(PORT, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const decisionRes = await fetch(`${BASE}/api/social/manager/brain/decision`);
      const decisionBody = await decisionRes.json();
      const expected = toMarketingDecisionProjection({ state, objective: 'زيادة استفسارات التقسيط من منصات التواصل' });
      check('قرار المسار = إسقاط الحالة canonical', decisionBody.decision.plan.length === expected.plan.length && decisionBody.decision.audience.segments.length === expected.audience.segments.length);
      check('generatedAt من الحالة canonical', decisionBody.generatedAt === state.generatedAt);

      const memoryRes = await fetch(`${BASE}/api/social/manager/memory`);
      const memoryBody = await memoryRes.json();
      const expectedMem = toOperationalMemoryProjection(state, { decisions: [], strategiesTested: [] });
      check('ذاكرة المسار = إسقاط الحالة canonical', memoryBody.memory.frequentQuestions.length === expectedMem.frequentQuestions.length);
    } finally {
      server.close();
    }

    // غياب الحالة canonical => 503 صريح بلا قرار مستقل.
    const app2 = buildApp(workspace, () => null);
    const server2 = app2.listen(PORT + 1, '127.0.0.1');
    await new Promise((r) => server2.once('listening', r));
    try {
      const r = await fetch(`http://127.0.0.1:${PORT + 1}/api/social/manager/brain/decision`);
      check('بلا عقل canonical => 503 لا قرار مستقل', r.status === 503 && (await r.json()).code === 'CENTRAL_BRAIN_NOT_AVAILABLE');
    } finally {
      server2.close();
    }
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} checks — architecture: ONE CENTRAL BRAIN`);
}

run().catch((e) => { console.error(e); process.exit(1); });
