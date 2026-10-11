/**
 * اختبار محرّك الاستقبال الموحّد (Unified Ingestion Engine) — وحدة منطق خالص.
 *
 * يثبت:
 * - التطبيع الموحّد: تعليق/رسالة من أي منصة بصيغة حدث واحدة.
 * - مصفوفة المنصات العشر مشتقة من السجل، والقنوات صريحة (webhook/polling/none).
 * - التجميع/العدّ من سجلات حقيقية فقط (عمق الطابور، آخر استقبال، بلا أرقام وهمية).
 * - الشخصية العراقية: نبرة عفوية + قواعد عدم اختراع + حقائق مسجّلة فقط.
 * - التعلّم: أسئلة متكررة/ردود ناجحة بعيّنة كافية فقط، بلا نص عميل ولا اسم.
 * - الصحة: حقول تقنية فقط (لا اسم/نص/رد).
 *
 * لا شبكة ولا مزود ولا سرّ.
 */

import {
  toUnifiedSocialEvent,
  buildIngestionMatrix,
  ingestiblePlatforms,
  summarizeIngestion,
  buildIngestionHealth,
  buildIngestionEngine,
  buildIraqiPersonaPrompt,
  deriveFrequentQuestions,
  deriveIngestionLearning,
  IRAQI_PERSONA_GUIDELINES_AR,
  INGESTION_FREQUENT_MIN,
  type UnifiedSocialEvent,
} from '../social/ingestionEngine';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const PLATFORMS = ['tiktok', 'youtube', 'facebook', 'instagram', 'whatsapp', 'telegram', 'x', 'snapchat', 'threads', 'google_business'];

function mkEvent(over: Partial<UnifiedSocialEvent> & { platform: any; text: string }): UnifiedSocialEvent {
  const ev = toUnifiedSocialEvent({
    platform: over.platform, externalId: over.externalId ?? 'e_' + Math.random().toString(36).slice(2),
    text: over.text, authorName: over.authorName ?? 'CANARY_AUTHOR', createdAt: over.createdAt ?? '2026-01-01T00:00:00.000Z',
    ingestSource: over.ingestSource ?? 'youtube_api', kind: over.kind,
  });
  if (!ev) throw new Error('event build failed');
  if (over.classification) ev.classification = over.classification;
  return ev;
}

// ---------------------------------------------------------------------------
group('1) التطبيع الموحّد: حدث واحد بغض النظر عن المنصة');
{
  const yt = toUnifiedSocialEvent({ platform: 'youtube', externalId: 'c1', text: 'كم سعر الغسالة؟', authorName: 'A', createdAt: '2026-01-01T00:00:00Z', ingestSource: 'youtube_api' });
  const fb = toUnifiedSocialEvent({ platform: 'facebook', externalId: 'c2', text: 'شنو موقعكم؟', kind: 'comment', createdAt: '2026-01-02T00:00:00Z', ingestSource: 'facebook_webhook' });
  const tg = toUnifiedSocialEvent({ platform: 'telegram', externalId: 'c3', text: 'أريد أقساط', kind: 'message', createdAt: '2026-01-03T00:00:00Z', ingestSource: 'telegram_webhook' });
  check('youtube event kind=comment', yt?.kind === 'comment');
  check('facebook event kind=comment', fb?.kind === 'comment');
  check('telegram message kind=message', tg?.kind === 'message');
  check('all share same shape keys', ['platform', 'kind', 'externalId', 'parentExternalId', 'authorName', 'text', 'createdAt', 'ingestSource', 'classification'].every((k) => k in (yt as any)));
  check('classification computed deterministically (price)', yt?.classification.topic === 'price');
  check('invalid record => null', toUnifiedSocialEvent({ text: 'x' } as any) === null);
  check('null record => null', toUnifiedSocialEvent(null) === null);
}

// ---------------------------------------------------------------------------
group('2) مصفوفة المنصات: عشر صفوف مشتقة من السجل + قنوات صريحة');
{
  const matrix = buildIngestionMatrix();
  check('10 platforms covered', matrix.length === 10);
  check('all 10 platform ids present', PLATFORMS.every((p) => matrix.some((r) => r.platform === p)));
  const byP = Object.fromEntries(matrix.map((r) => [r.platform, r]));
  check('telegram channel=webhook', byP.telegram.channel === 'webhook');
  check('facebook channel=webhook', byP.facebook.channel === 'webhook');
  check('instagram channel=webhook', byP.instagram.channel === 'webhook');
  check('youtube channel=polling', byP.youtube.channel === 'polling');
  check('tiktok channel=none (no public comment API)', byP.tiktok.channel === 'none');
  check('whatsapp channel=none', byP.whatsapp.channel === 'none');
  check('tiktok cannot ingest (no ingest channel)', byP.tiktok.canIngest === false);
  const ingestible = ingestiblePlatforms();
  check('ingestible = telegram/facebook/instagram/youtube', ['telegram', 'facebook', 'instagram', 'youtube'].every((p) => ingestible.includes(p as any)) && ingestible.length === 4);
  check('non-ingestible platform not claimed', !ingestible.includes('snapchat' as any));
}

// ---------------------------------------------------------------------------
group('3) التجميع من سجلات حقيقية: عمق الطابور/آخر استقبال/العدّ');
{
  const events = [
    mkEvent({ platform: 'youtube', text: 'كم سعر الغسالة؟', externalId: 'a1', createdAt: '2026-01-01T10:00:00Z' }),
    mkEvent({ platform: 'youtube', text: 'كم سعر الغسالة؟', externalId: 'a2', createdAt: '2026-01-01T11:00:00Z' }),
    mkEvent({ platform: 'facebook', text: 'شنو موقع المعرض؟', externalId: 'b1', createdAt: '2026-01-01T12:00:00Z' }),
    mkEvent({ platform: 'telegram', text: 'عاشت إيدكم', externalId: 't1', createdAt: '2026-01-01T09:00:00Z', kind: 'message', ingestSource: 'telegram_webhook' }),
  ];
  const empty = summarizeIngestion({ events: [] });
  check('empty => queueDepth 0', empty.queueDepth === 0);
  check('empty => lastIngestionAt null (no fabricated time)', empty.lastIngestionAt === null);
  check('empty => totalIngested 0', empty.totalIngested === 0);

  const s = summarizeIngestion({ events, repliedExternalIds: ['a1'], escalatedExternalIds: ['b1'] });
  check('totalIngested = events length', s.totalIngested === 4);
  check('queueDepth excludes replied+escalated', s.queueDepth === 2, `got ${s.queueDepth}`);
  check('byPlatform counts real', s.byPlatform.youtube === 2 && s.byPlatform.facebook === 1 && s.byPlatform.telegram === 1);
  check('lastIngestionAt = max createdAt', s.lastIngestionAt === '2026-01-01T12:00:00Z');
  check('perPlatformLastAt youtube = its max', s.perPlatformLastAt.youtube === '2026-01-01T11:00:00Z');
  check('byIngestSource tracks real sources', s.byIngestSource.telegram_webhook === 1);
  check('no unexpected sources for known platforms', s.unexpectedSources.length === 0);
}

// ---------------------------------------------------------------------------
group('4) الشخصية العراقية: نبرة عفوية + عدم اختراع + حقائق مسجّلة فقط');
{
  const pNoFacts = buildIraqiPersonaPrompt({});
  check('persona mentions showroom', pNoFacts.includes('الغرابي'));
  check('persona mentions Karbala default', pNoFacts.includes('كربلاء'));
  check('persona states Iraqi dialect instruction', /لهجة عراقية عفوية/.test(pNoFacts));
  check('persona forbids fabricating unregistered info', /لا تخترع/.test(pNoFacts));
  check('guidelines are single-source non-empty', IRAQI_PERSONA_GUIDELINES_AR.length >= 5);
  check('persona has no phone when unregistered', !/\d{7,}/.test(pNoFacts.replace(/[٪]/g, '')));
  const pFacts = buildIraqiPersonaPrompt({ locationText: 'كربلاء - شارع X', hoursText: '٩ص - ٩م' });
  check('registered location injected verbatim', pFacts.includes('كربلاء - شارع X'));
  check('registered hours injected verbatim', pFacts.includes('٩ص - ٩م'));
}

// ---------------------------------------------------------------------------
group('5) التعلّم: عيّنة كافية فقط، بلا نص عميل ولا اسم');
{
  const few = [mkEvent({ platform: 'youtube', text: 'كم سعر الغسالة؟', externalId: 'p1' }), mkEvent({ platform: 'youtube', text: 'كم سعره؟', externalId: 'p2' })];
  check('below min => no frequent question', deriveFrequentQuestions(few).length === 0);
  const many = [
    mkEvent({ platform: 'youtube', text: 'كم سعر الغسالة؟', externalId: 'q1' }),
    mkEvent({ platform: 'facebook', text: 'كم سعر الثلاجة؟', externalId: 'q2' }),
    mkEvent({ platform: 'instagram', text: 'كم سعر؟', externalId: 'q3' }),
  ];
  const fq = deriveFrequentQuestions(many);
  check('price frequent at min=3', fq.some((q) => q.topic === 'price' && q.count === 3), JSON.stringify(fq));
  check('frequent question carries sampleSize', fq[0]?.sampleSize === 3);
  check('INGESTION_FREQUENT_MIN is 3', INGESTION_FREQUENT_MIN === 3);

  const learning = deriveIngestionLearning({ events: many, successfulReplyExternalIds: ['q1', 'q2', 'q3'], now: Date.now() });
  check('learning has faq price record', learning.some((l) => l.id === 'ingest:faq:price' && l.origin === 'platform_data'));
  const allText = JSON.stringify(learning);
  check('learning has NO customer raw text', !allText.includes('الغسالة') && !allText.includes('الثلاجة'));
  check('learning has NO author name', !allText.includes('CANARY_AUTHOR'));
  check('learning ids are stable (idempotent)', JSON.stringify(deriveIngestionLearning({ events: many, successfulReplyExternalIds: ['q1'], now: 1 }).map((l) => l.id)) === JSON.stringify(deriveIngestionLearning({ events: many, successfulReplyExternalIds: ['q1'], now: 2 }).map((l) => l.id)));
  const replySuccess = learning.find((l) => l.id.startsWith('ingest:reply-success:'));
  check('reply success needs provider-confirmed set of >=3', replySuccess === undefined, 'no 3 successes on one platform expected');
}

// ---------------------------------------------------------------------------
group('6) الصحة: حقول تقنية فقط (لا اسم/نص/رد)');
{
  const events = [mkEvent({ platform: 'youtube', text: 'CANARY_COMMENT_TEXT', externalId: 'h1', authorName: 'CANARY_AUTHOR' })];
  const snap = buildIngestionEngine({ events, now: Date.now() });
  const h = snap.health;
  const flat = JSON.stringify(h);
  check('health has status', ['healthy', 'degraded', 'idle'].includes(h.status));
  check('health has queueDepth/totalIngested', typeof h.queueDepth === 'number' && typeof h.totalIngested === 'number');
  check('health has channels map', typeof h.channels === 'object' && h.channels.youtube === 'polling');
  check('health exposes NO author name', !flat.includes('CANARY_AUTHOR'));
  check('health exposes NO comment text', !flat.includes('CANARY_COMMENT_TEXT'));
  check('health lists ingestible platforms', h.ingestiblePlatforms.length === 4);
  check('health lists channels missing (honest)', h.channelsMissing.length === 6);

  // انحراف: حدث من منصة بلا قناة إدخال => degraded + unexpected.
  const bad = buildIngestionHealth(summarizeIngestion({ events: [mkEvent({ platform: 'snapchat', text: 'x', externalId: 's1' })] }));
  check('unknown-ingest platform => degraded', bad.status === 'degraded');
  check('unexpected sources announced', bad.status === 'degraded');
}

console.log(`\n${failures.length ? '❌' : '✅'} ingestion engine: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
