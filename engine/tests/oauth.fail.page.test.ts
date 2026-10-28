/**
 * صفحة فشل الربط (2026-10-28): إعادة ربط يوتيوب انتهت بسطر خام «رفض مزود المنصة عملية الربط:
 * access_denied» على صفحة بيضاء. الآن صفحة عربية بالسبب المرجّح وخطوات العلاج وزر العودة.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { oauthFailPage, oauthDenialHint } from '../social/oauthFailPage';

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

console.log('\n' + '='.repeat(60));
if (failures.length) { console.error(`FAILED: ${failures.length} — passed ${passed}`); for (const f of failures) console.error('  ✗ ' + f); process.exit(1); }
console.log(`PASSED: ${passed} oauth-fail-page checks`);
