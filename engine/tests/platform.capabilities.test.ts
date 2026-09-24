/**
 * اختبار توحيد مصدر القدرات (G4).
 *
 * سبب الوجود: كان يوجد مصدران للقدرات: engine/social/registry.ts و قائمة
 * SUPPORTED_PLATFORMS في server.ts. أي انحراف بينهما يعني قدرة معلنة في واجهة
 * وغير منفّذة في أخرى. الآن registry هو المصدر الوحيد والـserver يشتق منه.
 *
 * كما يثبت الاختبار الفصل الصريح بين:
 *   capability definition  ≠  provider connection  ≠  verified connection  ≠  delivery
 * فوجود قدرة comment_reply في السجل لا يعني أن المنصة متصلة أو أن الرد يُسلَّم.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORM_SPECS, platformSupports, isSupportedPlatform } from '../social/registry';
import { buildAdapters } from '../social/registry';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const REPO_ROOT = process.cwd();
const serverSource = readFileSync(join(REPO_ROOT, 'server.ts'), 'utf8');

function run(): void {
  // 1) عشر منصات معرّفة، بأسماء معروضة وتقنية.
  check('السجل يعرّف عشر منصات', PLATFORM_SPECS.length === 10, `count=${PLATFORM_SPECS.length}`);
  check('كل منصة لها اسم واسم معروض', PLATFORM_SPECS.every((s) => s.name.length > 0 && s.displayName.length > 0));
  check('لا تكرار في معرّفات المنصات', new Set(PLATFORM_SPECS.map((s) => s.platform)).size === 10);

  // 2) server.ts يشتق القائمة من السجل ولا يكرر قائمة يدوية.
  check('server.ts يشتق SUPPORTED_PLATFORMS من PLATFORM_SPECS', /const SUPPORTED_PLATFORMS = PLATFORM_SPECS\.map\(/.test(serverSource));
  check('server.ts لا يضيف قائمة قدرات يدوية موازية', !/"capabilities":\s*\[/.test(serverSource));
  check('hasCapability يقرأ من السجل', serverSource.includes('return platformSupports(platform, capability);'));

  // 3) قدرات المنصات الفعلية محفوظة (لا اختراع ولا فقدان).
  check('واتساب: رسائل فقط بلا نشر', platformSupports('whatsapp', 'messages') && !platformSupports('whatsapp', 'publish'));
  check('واتساب بلا تعليقات', !platformSupports('whatsapp', 'comments') && !platformSupports('whatsapp', 'comment_reply'));
  check('واتساب يعلن message_reply', platformSupports('whatsapp', 'message_reply'));
  check('سناب شات بلا تعليقات', !platformSupports('snapchat', 'comments'));
  check('Google Business بلا تعليقات', !platformSupports('google_business', 'comments'));
  check('فيسبوك يدعم النشر والرسائل والتعليقات', ['publish', 'messages', 'comments'].every((c) => platformSupports('facebook', c)));
  check('يوتيوب يدعم التعليقات', platformSupports('youtube', 'comments'));
  check('telegram ينشر ويراسل بلا تعليقات', platformSupports('telegram', 'publish') && platformSupports('telegram', 'messages') && !platformSupports('telegram', 'comments'));
  check('telegram يعلن message_reply لا comment_reply', platformSupports('telegram', 'message_reply') && !platformSupports('telegram', 'comment_reply'));

  // 4) أي منصة تدعم comment_reply يجب أن تدعم comments أيضاً (اتساق داخلي).
  check('comment_reply تستلزم comments في كل المنصات', PLATFORM_SPECS.every((s) => !platformSupports(s.platform, 'comment_reply') || platformSupports(s.platform, 'comments')));
  // 4b) أي منصة تدعم message_reply يجب أن تدعم messages (اتساق داخلي).
  check('message_reply تستلزم messages في كل المنصات', PLATFORM_SPECS.every((s) => !platformSupports(s.platform, 'message_reply') || platformSupports(s.platform, 'messages')));

  // 5) الفصل بين التعريف والاتصال والإرسال: adapter غير متصل عند غياب الحالة.
  const adapters = buildAdapters(() => null);
  check('بلا حالة اتصال، كل المنصات disconnected', adapters.every((a) => a.describe().connection === 'disconnected'));
  check('productionReady=false دائماً (لا موصل إرسال)', adapters.every((a) => a.describe().productionReady === false));
  const connectedOnly = buildAdapters(() => ({ status: 'connected', providerVerified: true, accountId: 'x' }));
  // الجاهزية الإنتاجية الآن مرتبطة بوجود موصل حقيقي منفّذ AND اتصال موثق.
  // Telegram هو أول موصل حقيقي؛ بقية المنصات تبقى غير جاهزة إنتاجياً حتى يُنفّذ موصلها.
  check('الجاهزية الإنتاجية = موصل حقيقي + اتصال موثق فقط', connectedOnly.every((a) => a.describe().productionReady === (a.platform === 'telegram' && a.describe().providerVerified === true)));
  check('المنصات بلا موصل حقيقي لا تُعلن جاهزية إنتاجية', connectedOnly.filter((a) => a.platform !== 'telegram').every((a) => a.describe().productionReady === false));
  check('المنصات بلا موصل حقيقي تعلن انعدام الموصل', connectedOnly.filter((a) => a.platform !== 'telegram').every((a) => (a.describe() as any).realConnector === false));
  check('وجود capability لا يعني اتصالاً', connectedOnly.find((a) => a.platform === 'facebook')!.supports('comment_reply') === true);

  check('isSupportedPlatform يرفض المجهول', !isSupportedPlatform('myspace') && isSupportedPlatform('facebook'));

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} platform capability checks`);
  }
}

run();
