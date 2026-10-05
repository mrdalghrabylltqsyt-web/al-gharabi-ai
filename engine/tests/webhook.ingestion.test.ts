/**
 * اختبار حارس لمصدر استيعاب webhook الواحد.
 *
 * الهدف: منع عودة تكرار منطق الاستيعاب الحسّاس (منع التكرار + الحفظ قبل الإقرار)
 * في مسارات متعددة، لأن أي انحراف بينها يعني إمّا تسريب حدث مكرر أو فقدانه بعد
 * الرد. الاختبار بنيوي (يقرأ server.ts) لأنه الوحدة موضعية داخل الخادم، مع تأكيد
 * أن المسارات الأربعة (Telegram/Facebook/Instagram/الموحّد) تستدعي المصدر الواحد.
 *
 * لا يلمس أي سرّ ولا شبكة.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const src = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');

group('1) المصدر الواحد موجود');
check('دالة ingestWebhookComments معرّفة مرة واحدة', (src.match(/async function ingestWebhookComments\(/g) || []).length === 1);
check('تستدعي بوابة منع التكرار isReplayOrDuplicate', /ingestWebhookComments[\s\S]{0,2200}?isReplayOrDuplicate\(/.test(src));
check('تحفظ قبل الإقرار (persistStateDurable)', /ingestWebhookComments[\s\S]{0,4000}?await persistStateDurable\(\)/.test(src));
check('تُخزّن مصدر استقبال صريحاً (ingestSource)', src.includes('ingestSource: `${platform}_webhook`'));

group('2) المسارات الأربعة تستدعي المصدر الواحد');
const calls = (src.match(/ingestWebhookComments\(\{/g) || []).length;
check('أربع نداءات على الأقل من المسارات', calls >= 4, `count=${calls}`);
check('مسار Telegram يستدعيه', /telegram[\s\S]{0,400}?ingestWebhookComments\(\{/.test(src));
check('مسار Facebook يستدعيه', /platform:"facebook", events:parsed\.events, auditKind:"facebook_inbound_events"/.test(src));
check('مسار Instagram يستدعيه', /platform:"instagram", events:parsed\.events, auditKind:"instagram_inbound_events"/.test(src));
check('المسار الموحّد يستدعيه', /platform, events, auditKind: `\$\{platform\}_inbound_events`/.test(src));

group('3) لا حلقة استيعاب مكرّرة داخل المسارات (انحراف ممنوع)');
check('لا إدراج مباشر مكرّر لتعليق facebook', !src.includes('ingestSource:"facebook_webhook",replyTarget'));
check('لا إدراج مباشر مكرّر لتعليق instagram', !src.includes('ingestSource:"instagram_webhook",replyTarget'));
// القائمة تُمرَّر كوسيط صحيح؛ الممنوع هو حلقة الاستيعاب اليدوية القديمة التي كانت
// تحمل `seenExternalIds:[...seenExternal,...accepted]` ثم `accepted.push` بنفسها.
check('لا حلقة Facebook يدوية قديمة', !src.includes('seenExternalIds:[...seenExternal,...accepted]})){ duplicates+=1; logFacebookWebhook'));
check('لا حلقة Instagram يدوية قديمة', !src.includes('seenExternalIds:[...seenExternal,...accepted]})){ duplicates+=1; logInstagramWebhook'));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} webhook-ingestion checks`);
}
