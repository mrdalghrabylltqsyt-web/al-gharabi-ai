/**
 * حارس الرموز — تجديد كل رموز المنصات قبل انتهائها (2026-10-28).
 *
 * يثبت جذر شكوى المالك: «رمز تيك توك ينتهي بعد 13 ساعة — أعد الربط» كان خطأً؛ رمز TikTok
 * يُجدَّد آلياً بتصميم TikTok، فالمطلوب أن يجدّده المهندس قبل انتهائه لا أن يطلب من المالك.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOKEN_KEEPER_POLICY, decideRenewal, ownerTokenNeeds, autoRenewable, shouldMarkReauth, isPermanentRefreshError, backoffMs, keeperSummary, leadFor, type TokenState } from '../ops/tokenKeeper';
import { buildForecasts, type ForecastInput } from '../ops/engineerProactive';
import { PATROL_CHECKS } from '../ops/engineerPatrol';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
let passed = 0; const failures: string[] = [];
const check = (n: string, ok: boolean, info = '') => { if (ok) passed++; else failures.push(n + (info ? ` — ${info}` : '')); };
const NOW = Date.parse('2026-10-28T12:00:00Z');
const MIN = 60000; const H = 60 * MIN; const D = 24 * H;

const st = (o: Partial<TokenState>): TokenState => ({
  id: 'tiktok', label: 'تيك توك', status: 'connected', renewal: 'refresh_token', hasToken: true, hasRefreshToken: true, appConfigured: true,
  accessExpiresAt: NOW + 20 * H, refreshExpiresAt: NOW + 300 * D, issuedAt: NOW - 4 * H, failures: 0, lastErrorCode: null, lastAttemptAt: null, ...o,
});

// 1) الحالة التي اشتكى منها المالك: TikTok ينتهي بعد 13 ساعة
check('★ TikTok بعد 13 ساعة: صالح، لا تجديد ولا مالك', decideRenewal(st({ accessExpiresAt: NOW + 13 * H }), NOW).action === 'ok');
check('★ TikTok بعد 13 ساعة: لا حاجة للمالك إطلاقاً', ownerTokenNeeds([st({ accessExpiresAt: NOW + 13 * H })], NOW).length === 0);
check('★ TikTok قبل الانتهاء بـ3 ساعات: يجدّده الحارس', decideRenewal(st({ accessExpiresAt: NOW + 3 * H }), NOW).action === 'refresh');
check('★ TikTok منتهٍ: تجديد فوري (لا إعادة ربط)', decideRenewal(st({ accessExpiresAt: NOW - H }), NOW).action === 'refresh');
check('TikTok بلا تاريخ انتهاء: تجديد لتثبيته', decideRenewal(st({ accessExpiresAt: null }), NOW).action === 'refresh');
check('★ TikTok يُعدّ قابلاً للتجديد الآلي', autoRenewable(st({}), NOW));
check('★ هامش TikTok أكبر من دورة الحارس بمرتين على الأقل', leadFor('tiktok') >= 2 * TOKEN_KEEPER_POLICY.intervalMs);
check('★ هامش Google أكبر من دورة الحارس (رمز ساعة)', leadFor('youtube') > TOKEN_KEEPER_POLICY.intervalMs && leadFor('google_business') > TOKEN_KEEPER_POLICY.intervalMs && leadFor('youtube') < H);

// 2) المالك يُشرَك فقط حين يلزم فعلاً
check('بلا refresh token ⇒ المالك', decideRenewal(st({ hasRefreshToken: false }), NOW).action === 'owner');
check('بلا بيانات تطبيق ⇒ المالك', decideRenewal(st({ appConfigured: false }), NOW).action === 'owner');
check('★ رفض دائم invalid_grant ⇒ المالك', decideRenewal(st({ failures: 1, lastErrorCode: 'invalid_grant', accessExpiresAt: NOW + H }), NOW).action === 'owner');
check('★ فشل عابر (شبكة) ⇒ لا مالك، انتظار ثم إعادة', decideRenewal(st({ failures: 1, lastErrorCode: 'network', lastAttemptAt: NOW - MIN, accessExpiresAt: NOW + 2 * H }), NOW).action === 'wait');
check('فشل عابر بعد انقضاء الانتظار ⇒ يعيد', decideRenewal(st({ failures: 1, lastErrorCode: 'network', lastAttemptAt: NOW - 10 * MIN, accessExpiresAt: NOW + 2 * H }), NOW).action === 'refresh');
check('★ فشل عابر والرمز على وشك الانتهاء ⇒ لا ينتظر', decideRenewal(st({ failures: 5, lastErrorCode: null, lastAttemptAt: NOW - MIN, accessExpiresAt: NOW + 5 * MIN }), NOW).action === 'refresh');
check('refresh token انتهى ⇒ المالك', decideRenewal(st({ refreshExpiresAt: NOW - H }), NOW).action === 'owner');
const yearly = ownerTokenNeeds([st({ refreshExpiresAt: NOW + 10 * D })], NOW);
check('★ إذن TikTok السنوي قبل 10 أيام ⇒ تحذير للمالك (ليس حرجاً)', yearly.length === 1 && yearly[0].severity === 'warning' && /السنوي/.test(yearly[0].title));
check('إذن TikTok السنوي قبل 3 أيام ⇒ حرج', ownerTokenNeeds([st({ refreshExpiresAt: NOW + 3 * D })], NOW)[0]?.severity === 'critical');
check('إذن سنوي بعيد ⇒ لا شيء', ownerTokenNeeds([st({ refreshExpiresAt: NOW + 200 * D })], NOW).length === 0);
check('رفض دائم ⇒ حاجة حرجة للمالك بإجراء واضح', (() => { const n = ownerTokenNeeds([st({ failures: 1, lastErrorCode: 'invalid_grant' })], NOW); return n.length === 1 && n[0].severity === 'critical' && /مركز ربط المنصات/.test(n[0].action); })());

// 3) Threads: التمديد قبل الانتهاء فقط (الجذر: كان يحاول بعد الانتهاء فيفشل دائماً)
const th = (o: Partial<TokenState>) => st({ id: 'threads', label: 'ثريدز', renewal: 'extend_before_expiry', hasRefreshToken: false, refreshExpiresAt: null, accessExpiresAt: NOW + 50 * D, issuedAt: NOW - 10 * D, ...o });
check('Threads بعد 50 يوماً ⇒ صالح', decideRenewal(th({}), NOW).action === 'ok');
check('★ Threads بعد 15 يوماً ⇒ تمديد الآن (قبل الانتهاء بوقت طويل)', decideRenewal(th({ accessExpiresAt: NOW + 15 * D }), NOW).action === 'refresh');
check('★ Threads عمره أقل من 24 ساعة ⇒ انتظار (شرط Meta)', decideRenewal(th({ accessExpiresAt: NOW + 15 * D, issuedAt: NOW - 2 * H }), NOW).action === 'wait');
check('Threads منتهٍ ⇒ المالك (Meta لا يمدّد منتهياً)', decideRenewal(th({ accessExpiresAt: NOW - H }), NOW).action === 'owner');
check('Threads صالح ⇒ قابل للتجديد الآلي', autoRenewable(th({}), NOW) && !autoRenewable(th({ accessExpiresAt: NOW - H }), NOW));
check('Threads بلا تاريخ (ربط قديم) ⇒ لا يُجدَّد عشوائياً', decideRenewal(th({ accessExpiresAt: null }), NOW).action === 'ok');
check('★ هامش Threads ≥ 15 يوماً', leadFor('threads') >= 15 * D);

// 4) رموز لا تنتهي
check('★ رمز صفحة Facebook دائم ⇒ لا شيء', decideRenewal(st({ id: 'facebook', renewal: 'permanent_page_token', accessExpiresAt: NOW + D }), NOW).action === 'ok' && ownerTokenNeeds([st({ id: 'facebook', renewal: 'permanent_page_token', accessExpiresAt: NOW + D })], NOW).length === 0);
check('بوت Telegram ثابت ⇒ لا شيء', decideRenewal(st({ id: 'telegram', renewal: 'static' }), NOW).action === 'ok');
check('منصة غير مربوطة ⇒ تخطٍّ', decideRenewal(st({ hasToken: false }), NOW).action === 'skip');

// 5) متى يُعلن الانقطاع
check('★ فشل عابر واحد لا يقطع الربط', !shouldMarkReauth(null, 1, NOW + 5 * H, NOW));
check('فشل عابر متكرر والرمز ما زال صالحاً ⇒ لا قطع', !shouldMarkReauth('network', 10, NOW + H, NOW));
check('فشل عابر متكرر بعد الانتهاء ⇒ قطع', shouldMarkReauth('network', TOKEN_KEEPER_POLICY.transientLimit, NOW - H, NOW));
check('★ رفض دائم ⇒ قطع فوري', shouldMarkReauth('invalid_grant', 1, NOW + 5 * H, NOW));
check('تصنيف الأخطاء', isPermanentRefreshError('invalid_grant') && isPermanentRefreshError('invalid_client') && !isPermanentRefreshError('network') && !isPermanentRefreshError(null) && !isPermanentRefreshError('rate_limit_exceeded'));
check('انتظار متزايد بسقف', backoffMs(0) === 0 && backoffMs(1) === 5 * MIN && backoffMs(2) === 10 * MIN && backoffMs(20) === TOKEN_KEEPER_POLICY.backoffMaxMs);
const sum = keeperSummary([st({ accessExpiresAt: NOW + 10 * H }), th({}), st({ id: 'youtube', failures: 1, lastErrorCode: 'invalid_grant' })], NOW);
check('ملخص الحارس', sum.managed === 3 && sum.owner === 1 && sum.healthy === 2 && sum.nextRenewal?.id === 'tiktok');

// 6) التوقعات لم تعد تطلب من المالك إعادة ربط رمز يُجدَّد آلياً
const base: ForecastInput = { nowMs: NOW, platforms: [], collections: [], memory: { mb: 200, limitMb: 512, slopeMbPerHour: null }, youtubeQuota: null, gemini: null, slow: [], spiking: [], backup: null };
check('★ TikTok قابل للتجديد بعد 13 ساعة ⇒ لا توقع', buildForecasts({ ...base, platforms: [{ id: 'tiktok', label: 'تيك توك', connected: true, expiresAt: new Date(NOW + 13 * H).toISOString(), refreshable: true }] }).length === 0);
const late = buildForecasts({ ...base, platforms: [{ id: 'tiktok', label: 'تيك توك', connected: true, expiresAt: new Date(NOW - H).toISOString(), refreshable: true }] });
check('★ قابل للتجديد وانتهى ⇒ عمل المهندس لا المالك', late.length === 1 && late[0].owner === 'engineer' && late[0].severity === 'warning');
check('غير قابل للتجديد يقترب ⇒ المالك (كما كان)', buildForecasts({ ...base, platforms: [{ id: 'x', label: 'X', connected: true, expiresAt: new Date(NOW + 30 * H).toISOString(), refreshable: false }] })[0]?.owner === 'owner');

// 7) فحص الدورية: رمز يُجدَّد آلياً لا يُحذّر المالك
const expiry = Object.values(PATROL_CHECKS).flat().find((ch) => { try { return ch({ nowMs: NOW, platforms: [] } as any).id === 'platforms.expiry'; } catch { return false; } });
if (expiry) {
  const facts: any = { nowMs: NOW, platforms: [{ id: 'tiktok', connected: true, providerVerified: true, expiresAt: new Date(NOW + 13 * H).toISOString(), tokenReadable: true, autoRenew: true }] };
  check('★ الدورية: TikTok يُجدَّد آلياً ⇒ سليم', expiry(facts).status === 'ok');
  facts.platforms[0].autoRenew = false;
  check('الدورية: رمز يدوي يقترب ⇒ تحذير', expiry(facts).status === 'warn');
} else check('فحص platforms.expiry موجود', false);

// 8) التوصيل في الخادم
const server = read('server.ts');
check('★ الحارس يعمل بدورة مستقلة', server.includes('function startTokenKeeper()') && server.includes('startTokenKeeper();') && server.includes('TOKEN_KEEPER_POLICY.intervalMs'));
check('★ التوقعات تستخدم الحارس لا «يوتيوب فقط»', !server.includes('refreshable: p.id === "youtube"') && server.includes('refreshable: t ? autoRenewable(t, nowMs) : false'));
check('★ تجديد TikTok منفصل ويُستدعى استباقياً', server.includes('async function refreshTikTokNow()') && server.includes('if (id === "tiktok") { const r = await refreshTikTokNow();'));
check('★ فشل TikTok العابر لا يقطع الربط', server.includes('if (!shouldMarkReauth(code, tr.failures, accessExp, Date.now()))'));
check('★ Threads يُمدَّد قبل الانتهاء عند الاستخدام أيضاً', server.includes('exp - Date.now() < leadFor("threads")'));
check('★ Threads يحفظ عمر الرمز', server.includes('issuedAt: Date.now() });'));
check('يوتيوب يُجدَّد مسبقاً بالحارس', server.includes('ensureYouTubeAccessToken({ ahead: true })'));
check('Google Business يسجّل سبب الرفض', server.includes('noteRenewal("google_business", false, code);'));
check('★ نجاح التجديد يستعيد اتصالاً عُلِّم «يحتاج إعادة ربط»', server.includes('if (r.ok && conn?.status === "reauth_needed")'));
check('رمز صفحة Facebook لا يُعرض كمنتهٍ', server.includes('facebook: "permanent_page_token"'));
check('الحارس في عرض المهندس', server.includes('tokens: (() => { try { return tokenKeeperView(); }'));
check('★ فيسبوك: نقص pages_messaging لا يوقف اشتراك التعليقات', server.includes('async function subscribeFacebookPage(') && server.includes('FACEBOOK_SUBSCRIBED_FIELDS.filter((f) => !/^messag/i.test(f))') && server.includes('const sub = await subscribeFacebookPage(resolvedPageId, pageToken);'));
check('★ فيسبوك: إعادة الاشتراك ذاتياً عند الإقلاع إن سقط', server.includes('async function healFacebookSubscription()') && server.includes('const h = await healFacebookSubscription()'));
check('★ إرشاد إذن Meta يذكر إعداد تسجيل الدخول لا «أعد الربط» فقط', read('engine/ops/defectLedger.ts').includes('Login Configuration'));
check('★ الحارس في غرفة المهندس', read('src/components/live/LiveBrainRoom.tsx').includes('حارس الرموز'));

console.log('\n' + '='.repeat(60));
if (failures.length) { console.error(`FAILED: ${failures.length} — passed ${passed}`); for (const f of failures) console.error('  ✗ ' + f); process.exit(1); }
console.log(`PASSED: ${passed} token-keeper checks`);
