/**
 * صفحة فشل الربط (2026-10-28): إعادة ربط يوتيوب انتهت بسطر خام «رفض مزود المنصة عملية الربط:
 * access_denied» على صفحة بيضاء. الآن صفحة عربية بالسبب المرجّح وخطوات العلاج وزر العودة.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { oauthFailPage, oauthDenialHint } from '../social/oauthFailPage';
import { pickGoogleCredentialPair } from '../social/googleCredPair';

let passed = 0; const failures: string[] = [];
const check = (name: string, ok: boolean, info = '') => { if (ok) passed++; else failures.push(name + (info ? ` — ${info}` : '')); };

const page = oauthFailPage({ platform: 'youtube', message: 'رفض مزود المنصة عملية الربط: access_denied', providerError: 'access_denied', appUrl: 'https://al-gharabi-ai.onrender.com/' });
check('★ صفحة عربية كاملة (RTL، قياس الجوال)', page.includes('dir="rtl"') && page.includes('name="viewport"') && page.includes('لم يكتمل ربط يوتيوب'));
check('★ الرسالة الأصلية محفوظة', page.includes('رفض مزود المنصة عملية الربط: access_denied'));
check('★ يوتيوب: شرح «غير موثّق» و«Testing» وخطواتهما', page.includes('Google hasn’t verified this app') && page.includes('Test users') && page.includes('Publish app'));
check('★ زر العودة إلى ربط المنصات', page.includes('href="https://al-gharabi-ai.onrender.com/?tab=platform_connections"'));
check('Meta لها شرحها', /Meta/.test(oauthDenialHint('facebook', 'access_denied')?.cause || '') && /Development/.test((oauthDenialHint('instagram', 'access_denied')?.steps || []).join(' ')));
check('خطأ ليس رفضاً ⇒ بلا شرح مختلق', oauthDenialHint('youtube', 'invalid_request') === null && oauthDenialHint('youtube', null) === null);
const xss = oauthFailPage({ platform: 'youtube', message: '<script>alert(1)</script>', providerError: null });
check('★ لا حقن: النص يُهرَّب', !xss.includes('<script>') && xss.includes('&lt;script&gt;'));
const server = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
check('★ مسار العودة يستعمل الصفحة (GET) ويبقي JSON لـPOST', server.includes('const failHtml=(status:number,msg:string)=>viaPost?res.status(status).json({success:false,error:msg}):res.status(status).send(oauthFailPage({'));

// اعتماد Google Business زوجاً متّسقاً (فشل 05:22 «The provided client secret is invalid»)
{
  const B = { clientId: 'biz-id', clientSecret: 'biz-secret' }, S = { clientId: 'shared-id', clientSecret: 'shared-secret' }, E = { clientId: '', clientSecret: '' };
  const p1 = pickGoogleCredentialPair({ business: B, shared: S });
  check('★ الزوج الخاص الكامل يُستعمل كاملاً', p1.clientId === 'biz-id' && p1.clientSecret === 'biz-secret' && p1.source === 'business');
  const p2 = pickGoogleCredentialPair({ business: { clientId: '', clientSecret: 'stale-biz-secret' }, shared: S });
  check('★ سرّ خاص بلا معرّفه لا يُقرن بالمعرّف المشترك (سبب العطل)', p2.clientId === 'shared-id' && p2.clientSecret === 'shared-secret' && p2.source === 'shared');
  const p3 = pickGoogleCredentialPair({ business: B, shared: S, businessRejected: true });
  check('★ رفضت Google الزوج الخاص ⇒ الزوج المشترك المُثبت', p3.clientId === 'shared-id' && p3.source === 'shared');
  check('رفض الخاص بلا مشترك ⇒ يبقى الخاص (لا فراغ)', pickGoogleCredentialPair({ business: B, shared: E, businessRejected: true }).source === 'business');
  check('لا اعتماد ⇒ none', pickGoogleCredentialPair({ business: E, shared: E }).source === 'none');
  check('★ الخادم يحوّل للمشترك عند invalid_client ويشرح للمالك', server.includes('googleBusinessPairRejected=true;') && server.includes('صار الخادم يستعمل اعتماد Google المشترك'));
}

console.log('\n' + '='.repeat(60));
if (failures.length) { console.error(`FAILED: ${failures.length} — passed ${passed}`); for (const f of failures) console.error('  ✗ ' + f); process.exit(1); }
console.log(`PASSED: ${passed} oauth-fail-page checks`);
