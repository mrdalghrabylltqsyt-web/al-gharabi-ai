/**
 * اختبار وحدة لحارس خصوصية النقطتين العامتين (engine/social/healthPrivacy.ts).
 *
 * يثبت أن:
 *  - قائمة الحقول الممنوعة وقائمة allow-list للكتلة العامة مصدر واحد صريح.
 *  - أي حقل بيانات عميل (اسم/نص تعليق/نص رد) يُكتشف ويُزال في أي عمق.
 *  - التنقية لا تمسّ الحقول التقنية المسموحة (status/deploy/pollCount/lastError).
 *  - كتلة youtubeWatcher العامة لا تحمل أي مفتاح خارج allow-list.
 * منطق خالص: لا شبكة ولا أسرار.
 */

import {
  PUBLIC_ENDPOINT_FORBIDDEN_CUSTOMER_FIELDS,
  PUBLIC_WATCHER_ALLOWED_KEYS,
  PUBLIC_ENDPOINT_FORBIDDEN_OPERATIONAL_FIELDS,
  collectPublicPayloadKeys,
  findForbiddenPublicKeys,
  findDisallowedWatcherPublicKeys,
  sanitizePublicHealthPayload,
} from '../social/healthPrivacy';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

group('1) قوائم المصدر الواحد صريحة');
check('replyText ممنوع', PUBLIC_ENDPOINT_FORBIDDEN_CUSTOMER_FIELDS.includes('replyText'));
check('attentionRequired ممنوع', PUBLIC_ENDPOINT_FORBIDDEN_CUSTOMER_FIELDS.includes('attentionRequired'));
check('authorName ممنوع', PUBLIC_ENDPOINT_FORBIDDEN_CUSTOMER_FIELDS.includes('authorName'));
check('lastReply ممنوع', PUBLIC_ENDPOINT_FORBIDDEN_CUSTOMER_FIELDS.includes('lastReply'));
check('allow-list youtubeWatcher يحتوي الحقول التقنية', ['status', 'watcherActive', 'pollCount', 'lastError'].every((k) => PUBLIC_WATCHER_ALLOWED_KEYS.includes(k)));
check('allow-list لا يحتوي أي حقل عميل', !PUBLIC_WATCHER_ALLOWED_KEYS.some((k) => PUBLIC_ENDPOINT_FORBIDDEN_CUSTOMER_FIELDS.includes(k)));
check('الحقول التشغيلية التفصيلية معلنة', PUBLIC_ENDPOINT_FORBIDDEN_OPERATIONAL_FIELDS.includes('counters'));

group('2) كشف الحقول الممنوعة في أي عمق');
const nested = {
  status: 'ok',
  youtubeWatcher: { status: 'healthy', watcherActive: true, pollCount: 7, lastError: 'connection error' },
  brain: { cognition: { reports: [{ lastGoal: 'نص هدف', lastNextAction: 'نص إجراء' }] } },
  attentionRequired: [{ authorName: 'PRIVACY_CANARY_AUTHOR_ZZZ', text: 'PRIVACY_CANARY_COMMENT_TEXT_ZZZ' }],
  lastReply: { replyText: 'PRIVACY_CANARY_REPLY_TEXT_ZZZ' },
};
const forbidden = findForbiddenPublicKeys(nested);
check('يكتشف attentionRequired', forbidden.includes('attentionRequired'));
check('يكتشف lastReply', forbidden.includes('lastReply'));
check('يكتشف authorName داخل مصفوفة متداخلة', forbidden.includes('authorName'));
check('يكتشف replyText', forbidden.includes('replyText'));
check('يكتشف lastGoal/lastNextAction', forbidden.includes('lastGoal') && forbidden.includes('lastNextAction'));
check('لا إنذار كاذب على مفاتيح تقنية', !findForbiddenPublicKeys({ status: 'ok', pollCount: 3, lastError: 'connection error' }).length);

group('3) التنقية تُزيل الممنوع وتُبقي التقني');
const cleaned: any = sanitizePublicHealthPayload(nested);
check('attentionRequired أُزيل', !('attentionRequired' in cleaned));
check('lastReply أُزيل', !('lastReply' in cleaned));
check('authorName/replyText أُزيلا من العمق', !findForbiddenPublicKeys(cleaned).length, JSON.stringify(findForbiddenPublicKeys(cleaned)));
check('status بقي', cleaned.status === 'ok');
check('كتلة youtubeWatcher التقنية بقيت كاملة', cleaned.youtubeWatcher?.pollCount === 7 && cleaned.youtubeWatcher?.lastError === 'connection error');
check('الهدف/الإجراء النصّي أُزيلا', cleaned.brain?.cognition?.reports?.[0] && !('lastGoal' in cleaned.brain.cognition.reports[0]) && !('lastNextAction' in cleaned.brain.cognition.reports[0]));

group('4) allow-list للكتلة العامة youtubeWatcher');
check('كتلة نظيفة تمرّ', findDisallowedWatcherPublicKeys({ status: 'healthy', watcherActive: true, pollCount: 1, lastError: null, note: 'x', cadenceMinutes: 1, cadenceMs: 60000, consecutiveErrors: 0, lastPollAt: null }).length === 0);
check('حقل زائد (counters) يُكشف', findDisallowedWatcherPublicKeys({ status: 'healthy', counters: { replied: 5 } }).includes('counters'));
check('حقل عميل زائد يُكشف', findDisallowedWatcherPublicKeys({ status: 'healthy', attentionRequired: [] }).includes('attentionRequired'));

group('5) collectPublicPayloadKeys شامل');
const keys = collectPublicPayloadKeys({ a: { b: [{ c: 1 }] }, d: 2 });
check('يجمع كل المفاتيح المتداخلة', ['a', 'b', 'c', 'd'].every((k) => keys.has(k)));

console.log('\n' + '='.repeat(60));
if (failures.length === 0) { console.log(`PASSED: ${passed} public health guard checks`); process.exit(0); }
console.error(`FAILED: ${failures.length} / ${passed + failures.length}`); failures.forEach((f) => console.error(' - ' + f)); process.exit(1);
