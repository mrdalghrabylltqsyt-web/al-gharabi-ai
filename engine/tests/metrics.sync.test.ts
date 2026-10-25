/**
 * مزامنة المؤشرات الحقيقية (وقود تعلّم العقل) — محلّلات + دمج بلا تكرار.
 *
 * يثبت (منطق صافٍ):
 *  1) محلّلات Facebook/Instagram/Graph insights: الحقل الغائب ⇒ لا قيمة (لا صفر مختلق)،
 *     والخطأ ⇒ لا شيء.
 *  2) المتابعون من followers_count ثم fan_count، وnull عند الغياب/الخطأ.
 *  3) الدمج: صف واحد لكل (منصة + منشور) يُحدَّث بأحدث القيم، يحفظ القيم غير المقاسة
 *     هذه المرة، ويزيل تكرارات قديمة (كان YouTube يضيف صفاً كل فتح للشاشة).
 *  4) معدل التفاعل من الوصول/المشاهدات/المتابعين، وnull بلا مقام.
 */
import {
  parseFacebookPostMetrics, parseInstagramMediaMetrics, parseGraphInsights, parseFollowers,
  upsertPerformanceRecords, engagementRate, summarizePlatformMetrics,
} from '../social/metricsSync';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// 1) المحلّلات
const fb = parseFacebookPostMetrics({ id: 'P_1', reactions: { summary: { total_count: 42 } }, comments: { summary: { total_count: 7 } }, shares: { count: 3 } });
check('★ فيسبوك: تفاعلات/تعليقات/مشاركات', JSON.stringify(fb) === JSON.stringify({ likes: 42, comments: 7, shares: 3 }), JSON.stringify(fb));
check('فيسبوك بلا مشاركات (فيديو) ⇒ بلا حقل shares', !('shares' in parseFacebookPostMetrics({ reactions: { summary: { total_count: 1 } } })));
check('★ خطأ Graph ⇒ لا قيم (لا صفر)', Object.keys(parseFacebookPostMetrics({ error: { code: 10 } })).length === 0);
check('إنستغرام: like_count/comments_count', JSON.stringify(parseInstagramMediaMetrics({ like_count: 15, comments_count: 4 })) === JSON.stringify({ likes: 15, comments: 4 }));
const ins = parseGraphInsights({ data: [{ name: 'reach', values: [{ value: 900 }] }, { name: 'views', total_value: { value: 1500 } }, { name: 'saved', values: [{ value: 6 }] }, { name: 'unknown', values: [{ value: 1 }] }] }, { reach: 'reach', views: 'views', saved: 'saves' });
check('★ رؤى Graph بصيغتيها (values/total_value) + تجاهل غير المعروف', JSON.stringify(ins) === JSON.stringify({ reach: 900, views: 1500, saves: 6 }), JSON.stringify(ins));
check('رؤى مرفوضة (صلاحية) ⇒ لا شيء', Object.keys(parseGraphInsights({ error: { code: 10 } }, { reach: 'reach' })).length === 0);
check('قيمة سالبة/نص ⇒ تُرفض', Object.keys(parseInstagramMediaMetrics({ like_count: -3, comments_count: 'x' })).length === 0);

// 2) المتابعون
check('followers_count أولاً', parseFollowers({ followers_count: 1200, fan_count: 900 }) === 1200);
check('fan_count احتياطاً', parseFollowers({ fan_count: 900 }) === 900);
check('★ غياب/خطأ ⇒ null لا صفر', parseFollowers({}) === null && parseFollowers({ error: {} }) === null && parseFollowers(null) === null);

// 3) الدمج بلا تكرار
let n = 0; const id = () => `perf_${++n}`;
const old = [
  { id: 'a', platform: 'youtube', postExternalId: 'V1', values: { views: 10 }, at: '2026-10-20T00:00:00Z', recordedBy: 'system' },
  { id: 'b', platform: 'youtube', postExternalId: 'V1', values: { views: 9 }, at: '2026-10-19T00:00:00Z', recordedBy: 'system' },
  { id: 'c', platform: 'facebook', postExternalId: 'P1', values: { likes: 5, shares: 2 }, at: '2026-10-21T00:00:00Z', recordedBy: 'metrics_sync' },
];
const m = upsertPerformanceRecords(old as any, [
  { platform: 'youtube', postExternalId: 'V1', values: { views: 25, likes: 3 }, recordedBy: 'metrics_sync' },
  { platform: 'facebook', postExternalId: 'P1', values: { likes: 8 }, recordedBy: 'metrics_sync' },
  { platform: 'instagram', postExternalId: 'M1', values: { likes: 4 }, recordedBy: 'metrics_sync' },
  { platform: 'instagram', postExternalId: 'M2', values: {}, recordedBy: 'metrics_sync' },
] as any, '2026-10-25T16:00:00Z', id);
check('★ التكرار القديم أُزيل', m.deduped === 1 && m.records.filter((r) => r.platform === 'youtube').length === 1, JSON.stringify(m.records));
const v1 = m.records.find((r) => r.postExternalId === 'V1')!;
check('★ التحديث بأحدث القيم مع حفظ المعرّف', v1.id === 'a' && v1.values.views === 25 && v1.values.likes === 3, JSON.stringify(v1));
const p1 = m.records.find((r) => r.postExternalId === 'P1')!;
check('★ قيمة لم تُقَس هذه المرة تبقى (shares)', p1.values.likes === 8 && p1.values.shares === 2, JSON.stringify(p1));
check('صف جديد للقياس الجديد، والفارغ يُتجاهل', m.added === 1 && !m.records.some((r) => r.postExternalId === 'M2'));
check('العدد النهائي = 3 صفوف فريدة', m.records.length === 3 && m.updated === 2);
check('الأحدث أولاً', m.records[0].at === '2026-10-25T16:00:00Z');

// 4) معدل التفاعل
check('★ من الوصول', engagementRate({ likes: 40, comments: 5, shares: 5, reach: 1000 }, null) === 5);
check('من المشاهدات عند غياب الوصول', engagementRate({ likes: 10, views: 200 }, null) === 5);
check('بلا مقام ⇒ null', engagementRate({ likes: 10 }, null) === null);
const sum = summarizePlatformMetrics([{ values: { views: 100, likes: 10 } }, { values: { views: 300, likes: 10 } }] as any, null);
check('ملخص المنصة: مجموع + معدل', sum.posts === 2 && sum.totals.views === 400 && sum.engagementRate === 5, JSON.stringify(sum));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} metrics-sync checks`);
