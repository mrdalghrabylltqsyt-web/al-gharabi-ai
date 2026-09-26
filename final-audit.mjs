import fs from 'node:fs';
import path from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const server = read('server.ts');
const app = read('src/App.tsx');
const rules = read('GHARABI_PROJECT_RULES.md');

const checks = [];
const add = (id, ok, detail) => checks.push({ id, ok, detail });
add('version-consistency', pkg.version === '13.0.0' && server.includes('PROJECT_VERSION = "13.0.0"'), 'package.json و server.ts على 13.0.0');
// لا تشير الوثائق إلى إصدار أحدث من الإصدار الفعلي (مثل v14/v15/v16 القديمة).
add('readme-no-future-version', (() => {
  const md = read('README.md');
  const referenced = [...md.matchAll(/\bv(\d+)\.(\d+)(?:\.(\d+))?\b/g)].map((m) => Number(m[1]));
  const max = referenced.length ? Math.max(...referenced) : 0;
  const currentMajor = Number(pkg.version.split('.')[0]);
  // v10 وv11 وv13 مراجع تاريخية مسموحة؛ أي رقم أكبر من الإصدار الحالي تناقض.
  return max <= currentMajor && md.includes('جزء من الإصدار `13.0.0`');
})(), 'README لا يوثّق إصداراً أحدث من 13.0.0');
add('auth-gate', app.includes('if (!isAuthenticated)') && server.includes('function authenticateToken'), 'بوابة المصادقة موجودة على الواجهة والخادم');
add('owner-guard', server.includes('function requireOwner') && server.includes('app.get("/api/control/final-check", requireOwner'), 'صلاحية المالك مطلوبة للفحوص النهائية');
add('secret-encryption', server.includes('encryptSecret') && server.includes('PLATFORM_TOKEN_ENCRYPTION_KEY'), 'توكنات المنصات مشفرة ومفتاحها من البيئة');
add('no-fake-publish', server.includes('providerVerified===true') && server.includes('providerReceipt'), 'التنفيذ الخارجي يحتاج إثبات المزود وإيصالاً');
add('automotive-guard', /(سيارة|سيارات|\bcars?\b)/i.test(server) && server.includes('المحتوى خالف قواعد مشروع الغرابي'), 'حارس المحتوى يمنع مجال السيارات');
add('gemini-guard', server.includes('GEMINI_DAILY_LIMIT') && server.includes('inFlight'), 'حارس استهلاك Gemini موجود');
add('backup', server.includes('BACKUP_DIR') && server.includes('/api/system/backups'), 'النسخ الاحتياطية موجودة');
add('webhook-replay', server.includes('webhookEvents') && server.includes('signature'), 'طبقة Webhook وسجل الأحداث موجودان');
add('final-readiness', server.includes('/api/system/final-readiness') && server.includes('/api/platforms/production-readiness'), 'فحص الجاهزية النهائية موجود');
add('otp-email-delivery', server.includes('sendOwnerOtpEmail') && server.includes('owner_challenge_email_sent') && server.includes('owner_challenge_email_failed'), 'إرسال OTP بالبريد مسجَّل بنتيجتين آمنتين بلا رمز');
add('otp-no-success-without-send', server.includes('if (!result.sent)') && server.includes('تم إرسال رمز التحقق إلى بريد المالك') && !server.includes('owner_challenge_issued'), 'لا ادعاء إرسال بلا نجاح المزود');
add('email-status-owner-only', server.includes('app.get("/api/system/email-status", requireOwner'), 'فحص حالة البريد محصور بالمالك');
add('email-env-only', !/RESEND_API_KEY\s*[:=]\s*["'`]re_/.test(server) && !/("|'|`)(re_[A-Za-z0-9_\-]{12,})\1/.test(server), 'لا مفتاح Resend مكتوب في الكود');

// فحص أسرار: لا مفاتيح مزودين في الملفات الإنتاجية.
const sourceFiles = ['server.ts', 'engine/notifications/owner-email.ts', 'netlify/functions/api.ts'];
const secretFree = sourceFiles.every((f) => {
  if (!fs.existsSync(path.join(root, f))) return true;
  const src = read(f);
  return !/AIzaSy[A-Za-z0-9_\-]{10,}/.test(src) && !/re_[A-Za-z0-9]{20,}/.test(src) && !/sk-[A-Za-z0-9]{20,}/.test(src);
});
add('secret-free-sources', secretFree, 'لا مفاتيح AIzaSy / re_ / sk- في ملفات الإنتاج');
add('preview-login-optin', server.includes('GHARABI_PREVIEW_TOKEN') && server.includes('app.post("/api/auth/preview-login"') && server.includes('status(404)'), 'دخول المعاينة معطّل افتراضياً (404 بلا إعداد) عبر POST فقط');
add('preview-login-post-only', !server.includes('app.get("/api/auth/preview-login"'), 'لا مسار GET يمرّر توكن المعاينة في سطر الطلب');
add('preview-login-query-rejected', server.includes('لا يُقبل التوكن في سطر الطلب'), 'رفض صريح لتوكن المعاينة في سطر الطلب');
add('preview-login-timing-safe', server.includes('timingSafeEqual'), 'مقارنة توكن المعاينة بزمن ثابت');
add('preview-login-no-token-leak', !/console\.log\([^)]*preview/i.test(server) && server.includes('preview-session-created'), 'لا تسجيل لتوكن المعاينة في السجل');
// الواجهة تقرأ توكن المعاينة من المقطع (#) فقط، فلا يصل الخادم ولا يظهر في سجلاته.
const appContext = read('src/context/AppContext.tsx');
add('preview-fragment-only', appContext.includes("hashParams.get('preview_token')") && !/queryParams\.get\('preview_token'\)/.test(appContext), 'الواجهة تقبل توكن المعاينة من المقطع فقط لا من سطر الطلب');
// حارس المخارج: منع اختراع العروض التجارية مفحوص على النص الفعلي بعد التوليد.
add('content-claim-guard', server.includes('analyzeBusinessClaims(result.text') && server.includes('analyzeRequestClaims'), 'حارس ادعاءات تجارية بعد التوليد وقبل التوليد');
add('content-fabrication-blocked', server.includes('business_claim_not_recorded') && read('engine/social/contentSafety.ts').includes('zero_down_payment_not_recorded'), 'ادعاء «بدون دفعة أولى» غير المسجّل محجوب صراحةً');
// حارس سلامة المحتوى مربوط بمسار الرد: الرد المقترح ونص الرد يمرّان عبر contentSafety.
const socialRoutes = read('engine/social/routes.ts');
add('content-safety-reply-linkage', socialRoutes.includes('analyzeBusinessClaims(text, replyFacts)') && socialRoutes.includes('analyzeBusinessClaims(rawSuggestion, facts)'), 'الرد المقترح ونص الرد يمرّان عبر حارس سلامة المحتوى قبل العرض/التسجيل');
add('reply-safety-server-side-block', socialRoutes.includes('replySafety.safe') && socialRoutes.includes('contentSafety'), 'حارس من جهة الخادم يمنع تسجيل أي رد يحمل ادعاءً غير مسجّل');
// G1: مسار تصنيف الرسائل يجب أن يمر suggestedReply عبر حارس المحتوى قبل الواجهة.
add('classify-message-content-safety', server.includes('buildSafeBusinessReply(') && server.includes('contentSafety') && server.includes('classifyMessageDeterministic(customerName, message).suggestedReply'), 'مسار classify-message يمر suggestedReply عبر حارس سلامة المحتوى');
add('classify-message-no-gemini-fallback', server.includes('const aiSource = providerValidated ? result.source : "fallback";'), 'البديل الحتمي في classify-message لا يُنسب إلى Gemini');
// G2/G3: وحدة الردود والمراجعة موصولة بالواجهة وبمسارات حقيقية، بلا ادعاء نشر.
add('social-reply-console-wired', read('src/components/social/SocialHubView.tsx').includes('apiService.replyToSocialComment') && read('src/components/social/SocialHubView.tsx').includes('apiService.submitSocialApproval'), 'وحدة التعليقات موصولة بمسارات الرد والمراجعة الحقيقية');
add('social-ui-no-fake-publish', !/ينشر\s*فور/.test(read('src/components/social/SocialHubView.tsx')) && !/تم\s*الإرسال/.test(read('src/components/social/SocialHubView.tsx')), 'الواجهة لا تدّعي نشراً خارجياً فورياً');
add('social-approvals-owner-only', socialRoutes.includes("app.post('/api/social/manager/approvals', requireOwner"), 'قرارات المراجعة محمية بصلاحية المالك');
add('social-approvals-persisted', server.includes('socialApprovals: (workspace as any).socialApprovals.slice(0, 5000)') && server.includes('socialApprovals: Array.isArray(raw.workspace.socialApprovals)'), 'قرارات المراجعة تُحفظ وتُحمَّل عبر المحوّل');
// G4: مصدر واحد للقدرات.
add('capabilities-single-source', server.includes('const SUPPORTED_PLATFORMS = PLATFORM_SPECS.map(') && server.includes('return platformSupports(platform, capability);'), 'قدرات المنصات مشتقة من سجل الموصلات وحده');
// سجلات التفاعل تبقى في قائمة الحالة المحفوظة، فلا تسقط حماية replay بعد restart.
add('social-state-persisted', server.includes('socialComments: (workspace as any).socialComments.slice') && server.includes('socialComments: Array.isArray(raw.workspace.socialComments)'), 'تعليقات/ردود السوشيال تُحفظ وتُحمَّل عبر المحوّل');
add('social-persistence-test-exists', fs.existsSync(path.join(root, 'engine/tests/social.persistence.test.ts')), 'اختبار ثبات سجلات السوشيال بعد إعادة التشغيل موجود');
add('platform-connections-restored', server.includes('const stored = (persisted as any).platformConnections') && server.includes('if (item?.platform && platformConnections.has(item.platform)) platformConnections.set(item.platform, item)'), 'اتصالات المنصات تُسترجَع عند الإقلاع بخلفية الملف لا Postgres فقط');
add('inventory-notifications-persisted', ['inventoryMovements','notifications','webhookEvents','providerEvents'].every((k) => server.includes(`${k}: (workspace as any).${k}.slice(`)) && ['inventoryMovements','notifications','webhookEvents','providerEvents'].every((k) => server.includes(`raw.workspace.${k}`)), 'مخزون/إشعارات/أحداث الـwebhook تُحفظ كما تُحمَّل (لا فقدان بعد restart)');
// تبديل الموديلات عند ضغط المزود: 503 يجب أن ينتقل لموديل شقيق سليم لا أن يُهدر المحاولات.
add('model-failover-on-overload', read('engine/ai/engine.ts').includes('attemptAllModels') && !read('engine/ai/engine.ts').includes("info.kind === 'not_found' || info.kind === 'invalid_request'"), 'المحرك يبدّل الموديل عند ضغط المزود بدل حرق المحاولات');

// ملف قفل Bun فارغ أو تالف يدفع Netlify إلى bun install فيفشل فوراً قبل البناء.
// وجوده بلا محتوى صحيح يمنع النشر كلياً، لذا يُرفض.
const bunLockPresent = fs.existsSync(path.join(root, 'bun.lock'));
const bunLockEmpty = bunLockPresent && fs.statSync(path.join(root, 'bun.lock')).size === 0;
add('no-empty-bun-lock', !bunLockEmpty, 'لا ملف bun.lock فارغ يعطّل نشر Netlify');
add('netlify-node-pinned', read('netlify.toml').includes('NODE_VERSION'), 'نسخة Node مثبّتة في netlify.toml');
add('health-preview-flag-boolean-only', server.includes('previewLoginEnabled: Boolean(') && !/previewLoginEnabled:\s*(process\.env\.GHARABI_PREVIEW_TOKEN|["'`])/.test(server), 'فحص الصحة يكشف منطقي تفعيل المعاينة فقط بلا قيمة');

// فحص اتصال Gemini: مسار واحد للمالك، يبدأ من موديل الإنتاج، ويجوز أن يتجاوز
// لموديل GA شقيق عند ضغط المزود (503 «high demand») — بلا retry أسّي وبلا cache،
// وبلا نجاح وهمي: الموديل المخدوم فعلاً يُذكر صراحةً. النجاح لا يُستنتج من HTTP 200.
const verifyRouteStart = server.indexOf('app.post("/api/ai/verify-provider"');
const verifyRouteEnd = server.indexOf('// Health endpoint', verifyRouteStart);
const verifyRoute = verifyRouteStart >= 0 && verifyRouteEnd > verifyRouteStart ? server.slice(verifyRouteStart, verifyRouteEnd) : '';
add('gemini-verify-owner-only', server.includes('app.post("/api/ai/verify-provider", requireOwner'), 'فحص المزود الحي محصور بالمالك');
add('gemini-verify-starts-from-production', verifyRoute.includes('const model = PRODUCTION_MODEL') && verifyRoute.includes('candidates.unshift(model)') && verifyRoute.includes('resolveModelCandidates'), 'التحقق يبدأ من موديل الإنتاج ثم مرشحات GA بترتيب عند ضغط المزود');
const verifyRouteCode = verifyRoute.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
// يُستثنى الحقل `retryable` (تصنيف خطأ) — الممنوع هو منطق إعادة المحاولة/Cache.
add('gemini-verify-no-retry-loop', verifyRouteCode.length > 0 && !/withRetry|maxAttempts/.test(verifyRouteCode) && !verifyRouteCode.includes('aiEngine'), 'لا retry أسّي ولا cache مشترك في مسار التحقق الحي');
// المهلة الإدارية ثابتة 30 ثانية ولا تُشتق من AI_TIMEOUT_MS القابل للضبط.
add('gemini-verify-fixed-30s-timeout', server.includes('const LIVE_VERIFY_TIMEOUT_MS = 30_000') && verifyRoute.includes('LIVE_VERIFY_TIMEOUT_MS') && !verifyRoute.includes('AI_TIMEOUT_MS'), 'مهلة التحقق الحي صريحة 30s ولا تتأثر بـAI_TIMEOUT_MS');
// أي طريقة غير POST على مسار التحقق تُرفض 405 صريحة، فلا تستدعي الفحص واجهةً بحالة 200.
add('gemini-verify-get-405', /app\.all\("\/api\/ai\/verify-provider"[\s\S]{0,200}?status\(405\)/.test(server) && !server.includes('app.get("/api/ai/verify-provider"'), 'التحقق الحي POST فقط وأي طريقة أخرى تُرفض 405');
const geminiVerifyTest = read('engine/tests/gemini.verification.test.ts');
add('gemini-verify-test-exists', fs.existsSync(path.join(root, 'engine/tests/gemini.verification.test.ts')), 'اختبار فحص اتصال Gemini موجود');
add('gemini-verify-ui-owner-only', read('src/components/system/SystemControlView.tsx').includes('اختبار اتصال Gemini') && read('src/components/system/SystemControlView.tsx').includes("currentUser?.role!=='owner'"), 'زر اختبار اتصال Gemini محصور بالمالك في الواجهة');
add('gemini-verify-frontend-timeout', read('src/services/geminiVerification.ts').includes('GEMINI_VERIFY_TIMEOUT_MS') && /AbortController/.test(read('src/services/geminiVerification.ts')), 'مهلة صريحة لفحص Gemini من الواجهة');
add('gemini-verify-test-no-secret', !/AIzaSy[A-Za-z0-9_\-]{5,}/.test(geminiVerifyTest), 'اختبار فحص Gemini لا يحمل أي مفتاح حقيقي');
// التشخيص الأمين: عطل المزود/الحصة لا يُنسب خطأً إلى مفتاح API.
// كان الفشل يعرض دائماً «راجع صلاحية GEMINI_API_KEY» حتى مع 503/429.
add('gemini-verify-accurate-hint', server.includes('function verificationHintFor') && /case 'rate_limited':[\s\S]{0,200}?حصة/.test(server) && /case 'unavailable':[\s\S]{0,220}?مشغول/.test(server) && /case 'auth':[\s\S]{0,160}?GEMINI_API_KEY/.test(server), 'التوجيه التشخيصي يطابق فئة الخطأ الفعلية (مزود/حصة/مفتاح)');
add('gemini-verify-errorKind-exposed', verifyRoute.includes('errorKind: info.kind') && server.includes('verificationErrorKind: aiLiveVerification.errorKind'), 'فئة الفشل الفعلية مكشوفة بلا أسرار في الاستجابة والصحة');

// ثبات الحالة: كل الكتابات تمر عبر محوّل تخزين واحد، وPostgres اختياري عبر
// DATABASE_URL. لا يجب أن يبقى أي كتابة مباشرة لملف الحالة خارج المحوّل.
const adapter = read('engine/storage/adapter.ts');
add('storage-adapter-exists', fs.existsSync(path.join(root, 'engine/storage/adapter.ts')), 'محوّل التخزين الموحد موجود');
add('storage-adapter-interface', adapter.includes('export interface StorageAdapter') && adapter.includes('readSync') && adapter.includes('async write') && adapter.includes('status()'), 'واجهة المحوّل موحدة (read/write/status)');
add('storage-adapter-file-backend', adapter.includes('class FileStorageAdapter') && adapter.includes('renameSync'), 'خلفية الملف موجودة بكتابة ذرّية');
add('storage-adapter-postgres-backend', adapter.includes('class PostgresStorageAdapter') && adapter.includes("gharabi_state") && /jsonb/i.test(adapter), 'خلفية Postgres موجودة (جدول key/value JSONB)');
add('storage-adapter-auto-select', adapter.includes('createStorageAdapter') && /databaseUrl/.test(adapter), 'الاختيار التلقائي حسب DATABASE_URL');
add('no-direct-state-file-write', !/fs\.writeFileSync\(\s*`?\$\{STATE_FILE\}/.test(server) && !server.includes('const STATE_FILE = path.join'), 'لا كتابة مباشرة لملف الحالة في server.ts');
add('persist-via-adapter', server.includes('storageAdapter.write(STORAGE_KEY_STATE'), 'persistState يمر عبر المحوّل');
add('revocations-through-adapter', server.includes('revokedSessions') && server.includes('userRevocations') && server.includes('applyStateSnapshot'), 'الإبطال يُحمَّل ويُطبَّق من المخزن');
add('provider-tokens-encrypted-in-adapter', server.includes('providerTokens: (workspace as any).providerTokens') && server.includes('encryptSecret'), 'توكنات المنصات المشفّرة تُحفظ داخل الحالة عبر المحوّل');
add('ephemeral-warning-honest', server.includes('mode: durable ? "durable" : "ephemeral"') && server.includes('MISSING DATABASE_URL'), 'الصحة تعلن ephemeral بتحذير صريح بدل ادعاء الدوام');
add('database-url-server-only', !/VITE_[A-Z_]*DATABASE_URL/.test(server) && server.includes('process.env.DATABASE_URL'), 'DATABASE_URL من الخادم فقط وبلا VITE_');
add('render-blueprint', fs.existsSync(path.join(root, 'render.yaml')), 'render.yaml موجود');
add('render-no-secrets', (() => {
  const r = read('render.yaml');
  return !/AIzaSy[A-Za-z0-9_\-]{10,}/.test(r) && !/re_[A-Za-z0-9]{20,}/.test(r) && !/sk-[A-Za-z0-9]{20,}/.test(r) && !/postgres(ql)?:\/\/[^\s"']*:[^\s"']*@/.test(r);
})(), 'render.yaml بلا أي سر أو نص اتصال قاعدة');
add('render-secrets-sync-false', (() => { const r = read('render.yaml'); return ['SESSION_SECRET','PLATFORM_TOKEN_ENCRYPTION_KEY','GEMINI_API_KEY','RESEND_API_KEY','DATABASE_URL','OWNER_EMAIL'].every((k) => new RegExp(`key:\\s*${k}\\s*\\n\\s*sync:\\s*false`).test(r)); })(), 'كل الأسرار sync: false في render.yaml');
add('render-free-plan-node20', /plan:\s*free/.test(read('render.yaml')) && read('render.yaml').includes('npm ci && npm run build') && read('render.yaml').includes('npm run start') && /NODE_VERSION\s*\n\s*value:\s*"20"/.test(read('render.yaml')), 'Render Free مع build/start وNode 20');
add('render-healthcheck', /healthCheckPath:\s*\/api\/health/.test(read('render.yaml')), 'Render healthCheckPath هو /api/health');

// قبول Batch 4: بوابة التصريح تُختبر على الخادم الفعلي (لا بحقن برمجي).
add('authz-real-server-test', fs.existsSync(path.join(root, 'engine/tests/acceptance.authz.real.test.ts')), 'اختبار التصريح على الخادم الفعلي موجود');
add('social-routes-require-owner-approvals', /approvals[\s\S]{0,400}?requireOwner/.test(read('engine/social/routes.ts')) && read('engine/social/routes.ts').includes("requireOwner, (req, res)"), 'مسار قرار المراجعة محصور بالمالك');
add('suggested-reply-content-safety', server.includes('buildSafeBusinessReply(') && server.includes('contentSafety') && server.includes('analyzeBusinessClaims'), 'الرد المقترح يمر حارس سلامة المحتوى من جهة الخادم');

// قبول Batch 5: أول موصل اجتماعي حقيقي (Telegram) مع حماية الاتصال والإرسال.
add('telegram-real-connector', /realConnector:\s*true/.test(read('engine/social/registry.ts')) && read('engine/social/registry.ts').includes("credentialMode: 'bot-token'"), 'Telegram معرّف كموصل حقيقي بآلية bot-token');
add('telegram-webhook-verified', server.includes('verifyTelegramSecret') && server.includes('TELEGRAM_SECRET_HEADER') && server.includes('/api/platforms/telegram/webhook'), 'Webhook Telegram يتحقق من السرّ في الترويسة قبل أي معالجة');
add('telegram-reply-real-send', server.includes('/api/platforms/telegram/reply') && server.includes('delivered:result.ok') && server.includes('providerReplyId'), 'الإرسال الحقيقي لا يُعلن التسليم بلا استجابة مزود');
add('telegram-reply-owner-only', /telegram\/reply",\s*requireOwner/.test(server), 'مسار الإرسال الحقيقي محصور بالمالك');
add('connection-callback-no-fake-verify', server.includes('verifyProviderConnection') && !/connection-callback[\s\S]{0,600}?providerVerified\s*!==\s*true\s*\)\s*return res\.status\(400\)/.test(server), 'إثبات الاتصال يأتي من طلب مزود لا من تصريح العميل');
add('telegram-webhook-secret-no-leak', !/res\.json\([^)]*webhookSecret\s*:/.test(server) && server.includes('secretConfigured:true'), 'السرّ لا يُعاد في أي استجابة JSON');
add('telegram-inbound-dup-persisted', server.includes('telegramUpdateIds') && read('server.ts').includes('isDuplicateUpdate'), 'معرّفات تحديثات Telegram تُحفظ لمنع التكرار بعد restart');
add('telegram-test-no-real-provider', fs.existsSync(path.join(root, 'engine/tests/telegram.connector.test.ts')) && fs.existsSync(path.join(root, 'engine/tests/helpers/telegramMock.ts')), 'اختبار الموصل يستخدم خادم Telegram وهمي محلي (بلا مزود حقيقي)');
// إصلاح Webhook Telegram الحقيقي (2026-09-24): إثبات التسجيل + عدم تدوير السرّ + ثبات الاستقبال.
add('telegram-webhook-info-endpoint', server.includes('/api/platforms/telegram/webhook-info') && /telegram\/webhook-info",\s*requireOwner/.test(server), 'مسار حالة webhook الحقيقي (getWebhookInfo) محصور بالمالك');
add('telegram-getwebhookinfo-real', server.includes('getWebhookInfo()') && read('engine/social/telegram.ts').includes('getWebhookInfo') && read('engine/social/telegram.ts').includes('sanitizeWebhookInfo'), 'حالة webhook تُستعلم فعلياً من Telegram وتُنقّى من الحقول الآمنة فقط');
add('telegram-webhook-info-no-secret', read('engine/social/telegram.ts').includes('checkWebhookRegistration') && !/webhook-info[\s\S]{0,900}?webhookSecret\s*:/.test(server), 'استجابة حالة webhook لا تحمل أي سرّ');
add('telegram-secret-not-rotated', server.includes('telegramWebhookSecret()||TELEGRAM_WEBHOOK_SECRET_ENV') && server.includes('const secret = webhookSecret || crypto.randomBytes'), 'الضبط يعيد استخدام السرّ المحفوظ ولا يدوّره تلقائياً');
add('telegram-credentials-persisted-before-hook', /saveTelegramCredentials\(botToken, secret, telegramWebhookUrl\(\)\)[\s\S]{0,400}?setWebhook\(telegramWebhookUrl\(\), secret\)/.test(server) && server.includes('checkWebhookRegistration({ info, expectedUrl: telegramWebhookUrl()'), 'الاعتماد يُحفظ مشفّراً قبل تسجيل webhook، ويُثبت التسجيل بـgetWebhookInfo');
add('telegram-inbound-durable-before-ack', server.includes('persistStateDurable()') && /persistStateDurable\(\);[\s\S]{0,400}?res\.status\(200\)/.test(server) && server.includes('persisted}'), 'الاستقبال ينتظر الكتابة الدائمة قبل الإقرار بحالة 200');
add('telegram-inbound-safe-logging', server.includes('logTelegramWebhook') && server.includes('outcome=') && !/logTelegramWebhook\([^)]*token/i.test(server), 'سجل آمن للاستقبال (معرّفات ونتيجة فقط بلا أسرار)');
add('telegram-webhook-info-test', read('engine/tests/telegram.connector.test.ts').includes('getWebhookInfo') && read('engine/tests/telegram.connector.test.ts').includes('restart'), 'اختبار يثبت حالة webhook وثبات الاستقبال بعد restart');
add('telegram-ui-webhook-status', read('src/components/social/SocialManagerView.tsx').includes('getTelegramWebhookInfo') && read('src/services/api.ts').includes('/api/platforms/telegram/webhook-info'), 'الواجهة تعرض حالة webhook الحقيقية لا لون الزر');

// إصلاح إرسال رد Telegram: فصل الرسائل (message_reply) عن التعليقات (comment_reply).
add('capability-message-reply-explicit', read('engine/social/adapter.ts').includes("'message_reply'") && read('engine/social/registry.ts').includes("'message_reply'"), 'قدرة message_reply معرّفة صراحةً ومنفصلة عن comment_reply');
add('telegram-message-not-comment-reply', (() => { const r = read('engine/social/registry.ts'); return r.includes("capabilities: ['publish', 'messages', 'message_reply', 'scheduling']") && !r.includes("capabilities: ['publish', 'messages', 'comment_reply'"); })(), 'Telegram يعلن message_reply ولا يعلن comment_reply');
add('reply-route-message-platform-redirect', socialRoutes.includes("supports('message_reply')") && socialRoutes.includes('MESSAGE_PLATFORM_NOT_COMMENT'), 'مسار التعليقات يوجّه منصات الرسائل بدل منع مضلل');
add('telegram-ui-routes-message-reply', read('src/components/social/SocialHubView.tsx').includes('apiService.replyTelegram') && read('src/components/social/SocialHubView.tsx').includes('replyTarget?.chatId'), 'واجهة الرد توجّه رسائل Telegram إلى المسار الحقيقي بلا فحص comment_reply');
add('incoming-vs-delivery-separated', read('src/components/social/SocialHubView.tsx').includes('receivedViaWebhook') && read('src/components/social/SocialHubView.tsx').includes('مستلمة فعلياً') && read('src/components/social/SocialHubView.tsx').includes('الرد المُسلَّم فعلياً'), 'الواجهة تفصل استقبال الرسالة عن تسليم الرد');
add('telegram-reply-delivery-honest', server.includes('deliveryError') && server.includes('reviewStatus: result.ok ? "delivered" : "failed"') && server.includes('receipt: result.receipt'), 'نجاح/فشل الإرسال يُسجَّل صراحةً بإيصال أو خطأ بلا ادعاء تسليم');
add('telegram-message-reply-tests', read('engine/tests/telegram.connector.test.ts').includes('message_reply') && read('engine/tests/telegram.connector.test.ts').includes('failSend') && read('engine/tests/social.ui.claims.test.ts').includes('message_reply'), 'اختبارات تغطي توجيه message_reply وفشل الإرسال والواجهة');

// إصلاح مرونة Gemini (2026-09-23): ضغط موديل واحد (503 «high demand») لا يعني تعطل المزود.
add('gemini-verify-failover', server.includes('for (const candidate of candidates)') && server.includes('const deadline = started + LIVE_VERIFY_TIMEOUT_MS'), 'فحص Gemini يتجاوز لموديل GA شقيق عند ضغط المزود بمهلة موحّدة');
add('gemini-verify-honest-model', server.includes('usedProduction = servedModel === model') && server.includes('model: servedModel'), 'الفحص يذكر الموديل المخدوم فعلاً ولا يدّعي نجاح الإنتاج عند استخدام شقيق');
add('gemini-lite-fallback-candidate', read('engine/ai/models.ts').includes("'gemini-3.5-flash-lite'"), 'نموذج GA أخف مضمّن كاحتياطي أخير عند ضغط عائلة Flash');

// Batch 6: أساس تكامل المنصات المتعدد (readiness / OAuth / webhook / publish / analytics).
add('platform-readiness-matrix', fs.existsSync(path.join(root, 'engine/social/readiness.ts')) && read('engine/social/readiness.ts').includes('PLATFORM_READINESS') && server.includes('/api/platforms/readiness-matrix'), 'مصفوفة جاهزية المنصات موجودة ومشتقة من السجل الحقيقي');
add('readiness-reflects-registry', read('engine/social/readiness.ts').includes('PLATFORM_SPECS.map(rowFor)'), 'المصفوفة تُبنى من سجل الموصلات (لا قائمة منحرفة)');
add('platform-oauth-foundation', fs.existsSync(path.join(root, 'engine/social/oauth.ts')) && server.includes('validateOAuthCallback') && server.includes('createPkcePair') && server.includes('requiresPkce'), 'أساس OAuth مشترك (state/CSRF/PKCE) مستخدم في مسار الربط');
add('oauth-state-single-use', /pendingOAuth\.delete\(state\)/.test(server) && server.includes('validateOAuthCallback') && read('engine/social/oauth.ts').includes('isStateExpired'), 'state OAuth يُستهلك مرة واحدة وله انتهاء صلاحية');
add('oauth-state-durable', (() => { const start = server.indexOf('"/api/platforms/:platform/oauth/start"'); const cb = server.indexOf('"/api/platforms/:platform/oauth/callback"'); const route = start >= 0 && cb > start ? server.slice(start, cb) : ''; return server.includes('pendingOAuth.set(state,pending)') && /buildControlState[\s\S]{0,900}?pendingOAuth:/.test(server) && /applyControlSnapshot[\s\S]{0,2000}?pendingOAuth\.set\(/.test(server) && route.includes('await persistCritical()'); })(), 'جلسة OAuth المعلّقة تُحفظ وتُسترجَع فلا تفشل الموافقة بعد إعادة التشغيل');
add('platform-webhook-foundation', fs.existsSync(path.join(root, 'engine/social/webhook.ts')) && server.includes('hmacSignatureVerifier') && server.includes('secretHeaderVerifier'), 'أساس webhook موحّد (ترويسة سرّية + HMAC)');
add('webhook-hmac-raw-body', server.includes('req.rawBody = buf') && server.includes('x-hub-signature-256'), 'توقيع webhook يُحسب على الجسم الخام (لا إعادة تسلسل)');
add('webhook-replay-guard', server.includes('isReplayOrDuplicate') && fs.existsSync(path.join(root, 'engine/social/webhook.ts')), 'حماية replay/idempotency للأحداث الواردة');
add('unified-publish-capability', server.includes('CAPABILITY_NOT_SUPPORTED') && server.includes('EXTERNAL_SETUP_REQUIRED') && /platform\/publish[\s\S]{0,2000}analyzeBusinessClaims/.test(server), 'النشر الموحّد يعلن CAPABILITY_NOT_SUPPORTED/EXTERNAL_SETUP_REQUIRED ويمر عبر Content Safety');
add('analytics-not-supported-honest', fs.existsSync(path.join(root, 'engine/social/analytics.ts')) && read('engine/social/analytics.ts').includes('NOT_SUPPORTED') && server.includes('/api/platforms/:platform/metrics'), 'التحليلات تُعلن NOT_SUPPORTED بلا اختراع قيم');
add('platform-foundation-tests', fs.existsSync(path.join(root, 'engine/tests/platform.foundation.test.ts')) && fs.existsSync(path.join(root, 'engine/tests/platform.integration.test.ts')), 'اختبارات أساس المنصات (وحدة + تكامل خادم حقيقي) موجودة');
add('oauth-config-all-providers', ['youtube','google_business','tiktok','facebook','instagram','x','snapchat','threads'].every((p) => new RegExp(`${p}:\\s*\\{ provider:`).test(server)), 'كل منصات OAuth مُعرّفة في OAUTH_CONFIG');
add('platform-secrets-server-only', !/AIzaSy[A-Za-z0-9_-]{10,}/.test(server) && !/clientSecret:\s*"[^"]+"/.test(read('server.ts')), 'لا أسرار مكتوبة في كود المنصات (تُقرأ من البيئة فقط)');

// Batch 7: طبقة التحكم التشغيلي (control plane) ومركز ربط المنصات.
add('operations-control-plane', fs.existsSync(path.join(root, 'engine/social/operations.ts')) && read('engine/social/operations.ts').includes('computePlatformStatus') && read('engine/social/operations.ts').includes('buildOperationGates'), 'طبقة تحكم تشغيلي موحّدة مع بوابات عمليات');
add('credentials-introspection', fs.existsSync(path.join(root, 'engine/social/credentials.ts')) && read('engine/social/credentials.ts').includes('inspectPlatformCredentials') && !/process\.env\[[^\]]+\]\s*\}\s*\)/.test(read('engine/social/credentials.ts')), 'كشف الاعتماد بأسماء المتغيرات فقط بلا قيم');
add('state-separation-explicit', read('engine/social/operations.ts').includes("'CODE_READY'") && read('engine/social/operations.ts').includes("'OPERATIONAL'") && read('engine/social/operations.ts').includes("'NOT_VERIFIED'"), 'الحالات منفصلة: CODE_READY/CONFIGURED/CONNECTED/VERIFIED/OPERATIONAL');
add('no-operational-without-verify', /state\s*=\s*'OPERATIONAL'/.test(read('engine/social/operations.ts')) && /providerVerified\s*===\s*true/.test(read('engine/social/operations.ts')), 'لا OPERATIONAL بدون اتصال موثق');
add('control-plane-endpoints', server.includes('/api/platforms/control-plane') && server.includes('/api/platforms/external-setup') && server.includes('/api/platforms/:platform/control'), 'مسارات مركز الربط والإعداد الخارجي موجودة');
add('readiness-matrix-enriched', server.includes('buildReadinessDetails') && read('engine/social/operations.ts').includes('operationalState') && read('engine/social/operations.ts').includes('nextAction'), 'مصفوفة الجاهزية غنية بالحالة التشغيلية والإجراء التالي');
add('external-setup-names-only', server.includes('/api/platforms/external-setup') && server.includes('requiredEnvNames') && read('engine/social/credentials.ts').includes('missing'), 'الإعداد الخارجي يعرض أسماء وخطوات فقط بلا أسرار');
add('connection-center-ui', fs.existsSync(path.join(root, 'src/components/social/PlatformConnectionCenter.tsx')) && read('src/components/social/PlatformConnectionCenter.tsx').includes('مركز ربط المنصات') && read('src/App.tsx').includes('platform_connections'), 'مركز ربط المنصات في الواجهة ومسجّل في التنقل');
add('control-plane-tests', fs.existsSync(path.join(root, 'engine/tests/platform.operations.test.ts')) && fs.existsSync(path.join(root, 'engine/tests/platform.control.integration.test.ts')), 'اختبارات طبقة التحكم (وحدة + خادم حقيقي) موجودة');

// إصلاح جذري لمفتاح تشفير التوكنات: تعريف موحّد للصيغة + تمييز missing من invalid.
add('token-key-single-source', (() => {
  const tk = read('engine/social/tokenKey.ts');
  return tk.includes('inspectTokenKey') && tk.includes('decodeTokenKey') && tk.includes('TOKEN_KEY_ENV_NAME') && tk.includes('TOKEN_KEY_BYTES');
})(), 'تعريف موحّد لمفتاح التشفير في engine/social/tokenKey.ts');
add('token-key-server-uses-single-source', server.includes('import { decodeTokenKey, inspectTokenKeyFromEnv }') && server.includes('function tokenKeyBytes() { return decodeTokenKey') && !/Buffer\.from\(PLATFORM_TOKEN_KEY/.test(server), 'server.ts يستخدم التعريف الموحّد ولا يفكّ Base64 بنفسه');
add('token-key-credentials-real-validation', read('engine/social/credentials.ts').includes('isTokenKeyValid') && read('engine/social/credentials.ts').includes('invalid'), 'credentials تفحص صحة المفتاح فعلاً (لا وجود الاسم فقط) وتفصل invalid');
add('token-key-missing-vs-invalid', read('engine/social/tokenKey.ts').includes("'missing'") && read('engine/social/tokenKey.ts').includes("'invalid'") && read('engine/social/operations.ts').includes('describeCredentialGap'), 'الحالة تفرّق missing عن invalid في المنطق ورسائل الحجب');
add('token-key-health-exposes-state', server.includes('platformTokenKey') && server.includes('/api/health') && server.includes('tokenKeyInspection()'), 'الصحة والجاهزية تعرضان حالة المفتاح بلا قيمة');
add('token-key-no-insecure-fallback', !/PLATFORM_TOKEN_ENCRYPTION_KEY\s*[:=]\s*["'`][A-Za-z0-9+/=_-]{16,}["'`]/.test(server) && !/fallback.*(?:token|encryption).*key/i.test(read('engine/social/tokenKey.ts')), 'لا مفتاح مكتوب في الكود ولا fallback غير آمن');
add('token-key-regression-test', fs.existsSync(path.join(root, 'engine/tests/token.key.test.ts')) && pkg.scripts['test:token-key'], 'اختبار انحدار المفتاح مسجّل في package.json');

// Batch 8: ربط Facebook الحقيقي (ثاني موصل اجتماعي خارجي بعد Telegram).
add('facebook-connector-module', fs.existsSync(path.join(root, 'engine/social/facebook.ts')) && read('engine/social/facebook.ts').includes('parseFacebookWebhook') && read('engine/social/facebook.ts').includes('replyToComment') && read('engine/social/facebook.ts').includes('sendMessage') && read('engine/social/facebook.ts').includes('publishToPage'), 'موصل Facebook حقيقي: تطبيع/رد/رسالة/نشر');
add('facebook-real-connector-registry', read('engine/social/registry.ts').includes("pageId") === false && /platform: 'facebook'[\s\S]{0,600}?realConnector: true/.test(read('engine/social/registry.ts')), 'Facebook معلن موصلاً حقيقياً في السجل');
add('facebook-capabilities-message-reply', read('engine/social/registry.ts').includes("capabilities: ['publish', 'messages', 'message_reply', 'analytics', 'comments', 'comment_reply', 'scheduling']"), 'Facebook يعلن message_reply وcomment_reply منفصلين');
add('facebook-webhook-verify-challenge', server.includes('webhookVerifyTokenFor') && /hub\.mode[\s\S]{0,600}?res\.type\("text\/plain"\)\.send\(challenge\)/.test(server) && server.includes('constantTimeEqual(token, expected)'), 'تحقق challenge لـFacebook بمقارنة رمز التحقق بزمن ثابت');
add('facebook-webhook-hmac-raw-body', server.includes('FACEBOOK_SIGNATURE_HEADER') && server.includes("hmacSignatureVerifier(FACEBOOK_SIGNATURE_HEADER") && server.includes('rawBody'), 'توقيع Facebook يُحسب على الجسم الخام عبر X-Hub-Signature-256');
add('facebook-comment-vs-message', read('engine/social/facebook.ts').includes("kind: 'comment'") && read('engine/social/facebook.ts').includes("kind: 'message'") && read('engine/social/facebook.ts').includes('ignored'), 'الموصل يفصل التعليق عن الرسالة ولا يعتبرها حدثاً غير مفهوم');
add('facebook-oauth-real', server.includes('facebookFinalizePageSelection') && server.includes('listManagedPages') && server.includes('exchangeLongLived') && server.includes('subscribeApp'), 'OAuth حقيقي: تبادل + إطالة + اختيار صفحة + اشتراك');
add('facebook-business-management-scope', server.includes('facebookOAuthScopes') && server.includes('"business_management"') && server.includes('FACEBOOK_OAUTH_SCOPES'), 'Facebook يطلب business_management (إلزامي منذ Graph v17 لصفحات Business Manager) مع إمكانية التجاوز من البيئة');
// إصلاح اعتماديات الصلاحيات: pages_manage_engagement (الرد على التعليقات) تعتمد
// رسمياً على pages_read_user_content. قبل الإصلاح كانت غائبة، فيُرفض الطلب بـ
// «Invalid Scopes» أو تُسقط الصلاحية صامتة. المصدر الواحد الآن في facebook.ts.
add('facebook-scope-dependencies-single-source', read('engine/social/facebook.ts').includes('FACEBOOK_PERMISSION_DEPENDENCIES') && read('engine/social/facebook.ts').includes('resolveFacebookScopes') && read('engine/social/facebook.ts').includes('findMissingScopeDependencies'), 'رسم اعتماديات صلاحيات Facebook في وحدة واحدة قابلة للاختبار');
add('facebook-comment-reply-dependency-present', read('engine/social/facebook.ts').includes("pages_read_user_content") && read('engine/social/facebook.ts').includes("FACEBOOK_REQUIRED_SCOPES") && /pages_manage_engagement:\s*\[[^\]]*pages_read_user_content/.test(read('engine/social/facebook.ts')), 'pages_read_user_content (اعتمادية رد التعليقات) موجودة في المجموعة المطلوبة');
add('facebook-scopes-resolved-with-dependencies', server.includes('resolveFacebookScopes') && server.includes('facebookScopeDependencyGaps') && !/scopes:cfg\.scopes/.test(server), 'server.ts يبني صلاحيات Facebook عبر الحلّ مع الاعتماديات لا من cfg.scopes الخام');
add('facebook-scope-gaps-exposed', server.includes('scopeDependencyGaps') && server.includes('scopeDependenciesResolved'), 'الفارق في اعتماديات الصلاحيات يُعلَن في health/oauth-start/setup بلا سرّ');
add('facebook-scope-dependency-test', fs.existsSync(path.join(root, 'engine/tests/facebook.connector.test.ts')) && read('engine/tests/facebook.connector.test.ts').includes('resolveFacebookScopes') && read('engine/tests/facebook.connector.test.ts').includes('findMissingScopeDependencies'), 'اختبار انحدار يثبّت اعتماديات الصلاحيات ورفض المجموعة الناقصة');
// تطبيع مسافات/أسطر بيئة OAuth: Render قد يضيف سطراً زائداً فيبدو السرّ «مضبوطاً»
// بينما يرفضه Meta بـinvalid_client_secret فيمنع بدء الربط بـ409 بلا سبب ظاهر.
add('oauth-env-trimmed-single-helper', server.includes('function envSecret(') && /envSecret\("FACEBOOK_OAUTH_CLIENT_SECRET"\)/.test(server) && /envSecret\("FACEBOOK_OAUTH_CLIENT_ID"\)/.test(server), 'client_id/secret يُقرآن عبر envSecret المطبِّع لا من process.env الخام');
add('oauth-env-trim-no-raw-secret-read', !/clientId:\s*process\.env\.[A-Z_]+/.test(server) && !/clientSecret:\s*process\.env\.[A-Z_]+/.test(server), 'لا قراءة خام لأي clientId/clientSecret في OAUTH_CONFIG');
add('oauth-preflight-result-exposed', server.includes('lastOAuthPreflight') && server.includes('lastPreflight'), 'آخر نتيجة فحص بدء OAuth تُعرَض في oauth/setup بلا سرّ ولا استدعاء إضافي');
add('oauth-trim-regression-test', read('engine/tests/facebook.connector.test.ts').includes("'test-fb-client-secret\\n'"), 'اختبار انحدار: بيئة بمسافات/أسطر تُطبَّع فلا يظهر 409 الخاطئ');
add('facebook-reply-dedicated-routes', server.includes('/api/platforms/facebook/reply') && server.includes('/api/platforms/facebook/message-reply') && server.includes('/api/platforms/facebook/webhook-info'), 'مسارات الرد/الرسالة/حالة webhook موجودة');
add('facebook-publish-real-connector', server.includes('publishToPage(target.pageId, target.pageToken, content)') && server.includes("code: \"CONNECTOR_NOT_READY\""), 'النشر يستخدم الموصل الحقيقي بلا ادعاء بلا معرّف');
add('facebook-reply-delivery-honest', server.includes('providerReplyId:result.data?.providerCommentId') && server.includes('providerReplyId:result.data?.providerMessageId') && server.includes('reviewStatus:result.ok?"delivered":"failed"'), 'نجاح/فشل الإرسال يُسجَّل صراحةً بإيصال أو خطأ بلا ادعاء');
add('facebook-inbound-durable-before-ack', /parseFacebookWebhook\(req\.body\)[\s\S]{0,2500}?await persistStateDurable\(\)[\s\S]{0,400}?res\.status\(200\)/.test(server), 'استقبال Facebook ينتظر الكتابة الدائمة قبل الإقرار');
add('facebook-duplicate-persistence', server.includes('facebookEventIds') && /facebookEventIds[\s\S]{0,200}?slice\(0, 20000\)/.test(server), 'معرّفات أحداث Facebook تُحفظ لصمود منع التكرار بعد restart');
add('facebook-webhook-safe-logging', server.includes('logFacebookWebhook') && !/logFacebookWebhook\([^)]*(token|secret)/i.test(server), 'سجل استقبال آمن بلا أسرار');
add('facebook-no-rotating-secret', !/facebook[\s\S]{0,400}?randomBytes\([^)]*\)[\s\S]{0,200}?webhookSecret/i.test(server), 'لا تدوير سرّ تلقائي في مسار Facebook');
add('facebook-reply-guard-redirects', socialRoutes.includes('PLATFORM_USE_DEDICATED_REPLY') && socialRoutes.includes('PLATFORM_USE_DEDICATED_PUBLISH') && socialRoutes.includes('hasRealConnector(platform)'), 'المسار العام يوجّه منصات الموصل الحقيقي لمساراتها');
add('facebook-connector-tests', fs.existsSync(path.join(root, 'engine/tests/facebook.connector.test.ts')) && fs.existsSync(path.join(root, 'engine/tests/helpers/facebookMock.ts')) && pkg.scripts['test:facebook'], 'اختبار موصل Facebook (وحدة + تكامل بخادم وهمي) مسجّل');
add('facebook-test-in-suite', typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:facebook'), 'اختبار Facebook ضمن npm test');
add('facebook-ui-connection', read('src/components/social/PlatformConnectionCenter.tsx').includes('startOAuth') && read('src/components/social/PlatformConnectionCenter.tsx').includes('OPERATIONAL') && read('src/services/api.ts').includes('/api/platforms/production-readiness'), 'الواجهة تجلب الحالة الحقيقية وتبدأ OAuth وتعرض OPERATIONAL بحسب الواقع');
add('facebook-page-selection-pending', read('server.ts').includes('function facebookPageSelectionPending') && read('server.ts').includes('pageSelectionPending: true'), 'الخادم يميّز «بانتظار اختيار الصفحة» عن فشل الربط ويُعلنها');
add('facebook-page-selection-reachable', read('src/components/social/PlatformConnectionCenter.tsx').includes('fbPageSelection') && read('src/components/social/SocialManagerView.tsx').includes('fbPageSelectionPending'), 'اختيار الصفحة متاح فعلاً في الواجهة ولا يُحجب خلف إعادة OAuth');
add('facebook-multipage-test', read('engine/tests/facebook.connector.test.ts').includes('أكثر من صفحة') && read('engine/tests/facebook.connector.test.ts').includes('select-page'), 'اختبار انحدار لمسار الحساب متعدد الصفحات');
// تشخيص «حدث خطأ ما» في Meta (PLATFORM__INVALID_APP_ID): التصنيف + الفحص + الإعلان.
add('meta-generic-error-classified', read('engine/social/facebook.ts').includes('PLATFORM__INVALID_APP_ID') && read('engine/social/facebook.ts').includes('classifyMetaDialogInteraction') && read('engine/social/facebook.ts').includes('something went wrong'), 'صفحة Meta العامة «حدث خطأ ما» تُصنَّف صراحةً لا كنجاح');
add('meta-app-id-format-guard', read('engine/social/facebook.ts').includes('isPlausibleMetaAppId') && /isPlausibleMetaAppId[\s\S]{0,120}\^\[0-9\]/.test(read('engine/social/facebook.ts')), 'معرّف تطبيق Meta يُفحص رقمياً (المسافة/الحرف يسببان «حدث خطأ ما»)');
add('meta-app-token-preflight', read('engine/social/facebook.ts').includes('fetchAppAccessToken') && read('engine/social/facebook.ts').includes('client_credentials') && server.includes('oauthStartPreflight'), 'فحص client_credentials حقيقي قبل إرسال المالك لشاشة Meta');
add('oauth-start-blocks-invalid-app', server.includes('META_APP_ID_INVALID') && /preflight\.ok[\s\S]{0,700}?status\(409\)/.test(server) && server.includes('INVALID_APP_ID_FORMAT'), 'بدء OAuth يرفض 409 بسبب صريح بدل توليد رابط سيفشل');
add('oauth-start-safe-logging', server.includes('function logOAuthStart') && !/logOAuthStart\([^)]*(clientId|clientSecret|token|secret):/i.test(server), 'سجل بدء OAuth/العودة آمن بلا أي سرّ');
add('oauth-setup-explains-generic-error', server.includes('genericErrorMeaning') && server.includes('appIdFormatOk'), 'oauth/setup يشرح معنى «حدث خطأ ما» ويعرض شكل المعرّف');
add('meta-no-google-only-params', !/platform === 'facebook'[\s\S]{0,400}?access_type/.test(read('engine/social/oauth.ts')) && read('engine/social/oauth.ts').includes("platform === 'facebook' || platform === 'instagram' || platform === 'threads'"), 'Meta لا يرسل access_type/prompt (معاملان خاصان بـGoogle)');
add('meta-generic-error-tests', read('engine/tests/facebook.connector.test.ts').includes('حدث خطأ ما') && read('engine/tests/facebook.connector.test.ts').includes('PLATFORM__INVALID_APP_ID') && read('engine/tests/facebook.connector.test.ts').includes('META_APP_ID_INVALID'), 'اختبارات انحدار لتشخيص «حدث خطأ ما» ومنع الرابط الفاشل');
add('meta-health-non-secret', server.includes('metaOAuth:') && server.includes('appIdFormatOk') && !/metaOAuth[\s\S]{0,400}?clientId\s*:/.test(server), '/api/health يعرض حالة Meta منطقية بلا كشف App ID/Secret');

// إصلاح جذر «لا يمكن تحميل عنوان URL / النطاق غير مُضمَّن» في OAuth (2026-09-24):
// كان redirect_uri يُبنى من APP_URL وحدها، فإن غابت على Render صار localhost فيرفضه
// Meta. الآن مصدر واحد للعنوان العام يقرأ بدائل المنصة، ويُعرض الرابط الدقيق للمالك.
add('public-url-single-source', fs.existsSync(path.join(root, 'engine/social/publicUrl.ts')) && read('engine/social/publicUrl.ts').includes('resolvePublicUrl') && read('engine/social/publicUrl.ts').includes('isLocalHost'), 'مصدر واحد لتحديد العنوان العام في engine/social/publicUrl.ts');
add('public-url-server-integration', server.includes('from "./engine/social/publicUrl"') && server.includes('function oauthCallbackUrl') && !/const BASE_URL = \(process\.env\.APP_URL/.test(server), 'server.ts يستخدم مصدر العنوان العام ولا يبني BASE_URL من APP_URL وحدها');
add('public-url-platform-fallbacks', read('engine/social/publicUrl.ts').includes('RENDER_EXTERNAL_URL') && read('engine/social/publicUrl.ts').includes('RENDER_EXTERNAL_HOSTNAME') && read('engine/social/publicUrl.ts').includes('PUBLIC_URL') && read('engine/social/publicUrl.ts').includes('VERCEL_URL'), 'بدائل المنصة مدعومة عند غياب APP_URL (جذر فشل Render)');
add('public-url-no-silent-fallback', read('engine/social/publicUrl.ts').includes('لا رجوع صامت') && read('engine/social/publicUrl.ts').includes('problems'), 'عنوان صريح غير صالح لا يُستبدل صامتاً ببديل أدنى');
add('public-url-rejects-insecure-public', read('engine/social/publicUrl.ts').includes("http على نطاق عام مرفوض") && read('engine/social/publicUrl.ts').includes("https:"), 'http على نطاق عام مرفوض ويلزم https');
add('oauth-setup-exposes-exact-redirect', server.includes('/api/platforms/:platform/oauth/setup') && server.includes('appDomainsValue') && server.includes('redirectUri') && server.includes('metaDashboardFields'), 'مسار oauth/setup يعرض redirect_uri والنطاق المطلوب للمالك بلا أسرار');
add('oauth-start-blocks-non-public-url', server.includes('PUBLIC_URL_NOT_PUBLIC') && /publicUrlIsPublic\(\)/.test(server), 'بدء OAuth يرفض عنواناً غير عام صراحةً بدل إرسال المالك لشاشة فشل غامضة');
add('health-exposes-public-url', server.includes('publicUrl: (() =>') && server.includes('isPublic:') && server.includes('problems: u.problems'), '/api/health يعرض حالة العنوان العام بلا أي سرّ');
add('public-url-regression-test', fs.existsSync(path.join(root, 'engine/tests/public.url.test.ts')) && pkg.scripts['test:public-url'] && typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:public-url'), 'اختبار انحدار العنوان العام مسجّل في package.json وضمن npm test');

// Instagram — ثالث موصل اجتماعي حقيقي (Instagram API with Facebook Login، 2026-09-25).
// نفس نمط Facebook: تطبيق Meta نفسه، توكن مشفّر، webhook موقّع، كتابة قبل الإقرار،
// منع تكرار صامد، ورد/رسالة/نشر حقيقي بلا ادعاء. لا حساب شخصي (يلزم مهني).
add('instagram-connector-module', fs.existsSync(path.join(root, 'engine/social/instagram.ts')) && read('engine/social/instagram.ts').includes('export class InstagramClient'), 'وحدة موصل Instagram الحقيقية موجودة');
add('instagram-real-connector-registry', /platform: 'instagram'[\s\S]{0,900}?realConnector:\s*true/.test(read('engine/social/registry.ts')), 'Instagram مُعلن realConnector في السجل');
add('instagram-modern-scopes', read('engine/social/instagram.ts').includes('instagram_basic') && read('engine/social/instagram.ts').includes('instagram_manage_comments') && read('engine/social/instagram.ts').includes('instagram_manage_messages') && read('engine/social/instagram.ts').includes('instagram_content_publish'), 'صلاحيات Instagram API with Facebook Login الرسمية مستخدمة');
add('instagram-no-instagram-login-scope-names', !/INSTAGRAM_REQUIRED_SCOPES[\s\S]{0,500}?'instagram_business_/.test(read('engine/social/instagram.ts')), 'لا صلاحية باسم Instagram Login (instagram_business_*) في مخطط Facebook Login');
add('instagram-professional-only', read('engine/social/instagram.ts').includes('INSTAGRAM_REQUIRES_PROFESSIONAL_ACCOUNT') && read('engine/social/instagram.ts').includes('instagram_business_account'), 'لا دعم للحساب الشخصي؛ يلزم Business/Creator مرتبط بصفحة');
add('instagram-scope-dependencies', read('engine/social/instagram.ts').includes('INSTAGRAM_PERMISSION_DEPENDENCIES') && read('engine/social/instagram.ts').includes('resolveInstagramScopes') && read('engine/social/instagram.ts').includes('findMissingInstagramScopeDependencies'), 'اعتماديات صلاحيات Instagram مصدر واحد مُختبَر');
add('instagram-oauth-routes', server.includes('/api/platforms/instagram/oauth/start') === false && server.includes('platform==="instagram"') && server.includes('instagramFinalizeAccountSelection'), 'Instagram يسلك مسار OAuth نفسه (start/callback) بإتمام اكتشاف الحساب');
add('instagram-account-selection', server.includes('/api/platforms/instagram/accounts') && server.includes('/api/platforms/instagram/select-account') && server.includes('function instagramPageSelectionPending'), 'اكتشاف واختيار حساب Instagram المهني (مسار كامل قابل للوصول)');
add('instagram-webhook-signature', server.includes('/api/platforms/instagram/webhook') && server.includes('INSTAGRAM_SIGNATURE_HEADER') && read('engine/social/instagram.ts').includes('parseInstagramWebhook'), 'webhook Instagram بتحقق توقيع وتطبيع صريح');
add('instagram-inbound-durable-before-ack', /await persistStateDurable\(\);\s*const persisted=!lastPersistError;/.test(server) && /instagram\/webhook/.test(server), 'استقبال Instagram ينتظر الكتابة الدائمة قبل الإقرار');
add('instagram-duplicate-persistence', server.includes('instagramEventIds') && read('server.ts').includes('instagramEventIds') && /instagramEventIds[\s\S]{0,400}?buildPersistedState|buildPersistedState[\s\S]{0,4000}?instagramEventIds/.test(server), 'معرّفات أحداث Instagram تُحفظ لصمود منع التكرار بعد restart');
add('instagram-message-not-comment-reply', read('engine/social/registry.ts').includes('message_reply') && server.includes('/api/platforms/instagram/reply') && server.includes('/api/platforms/instagram/message-reply'), 'فصل تعليق Instagram عن رسالته (comment_reply ≠ message_reply)');
add('instagram-reply-delivery-honest', /delivered:result\.ok,providerReplyId/.test(server) && server.includes('providerReplyId'), 'نجاح/فشل إرسال Instagram يُسجَّل صراحةً بلا ادعاء');
add('instagram-publish-real-connector', server.includes('platform === "instagram"') && read('engine/social/instagram.ts').includes('createMediaContainer') && read('engine/social/instagram.ts').includes('publishContainer') && server.includes('MEDIA_REQUIRED'), 'نشر Instagram حقيقي (حاوية+نشر) بلا نص فقط وبلا ادعاء');
add('instagram-webhook-safe-logging', server.includes('function logInstagramWebhook') && !/logInstagramWebhook\([^)]*(token|secret|access)/i.test(server), 'سجل استقبال Instagram آمن بلا أسرار');
add('instagram-connector-tests', fs.existsSync(path.join(root, 'engine/tests/instagram.connector.test.ts')) && fs.existsSync(path.join(root, 'engine/tests/helpers/instagramMock.ts')) && pkg.scripts['test:instagram'], 'اختبار موصل Instagram (وحدة + تكامل بخادم وهمي) مسجّل');
add('instagram-test-in-suite', typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:instagram'), 'اختبار Instagram ضمن npm test');
add('instagram-connection-center-ui', read('src/components/social/PlatformConnectionCenter.tsx').includes('igPageSelection') && read('src/components/social/PlatformConnectionCenter.tsx').includes('InstagramWebhookStatus') && read('src/services/api.ts').includes('/api/platforms/instagram/select-account'), 'مركز الربط يعرض Instagram ويختار الحساب بلا أي سرّ');
add('instagram-hub-real-reply', read('src/components/social/SocialHubView.tsx').includes('replyInstagram') && read('src/components/social/SocialHubView.tsx').includes('messageReplyInstagram'), 'الواجهة توجّه رد Instagram لمساره الحقيقي المنفصل');
// نتحقق من كتلة الصحة تحديداً: لا تُعرَض قيمة clientId بل منطقي فقط (Boolean(...)).
add('instagram-health-non-secret', /instagramOAuth:\s*\(\(\)\s*=>\s*\{[\s\S]{0,500}?clientIdConfigured:\s*Boolean\(/.test(server) && !/instagramOAuth:\s*\(\(\)\s*=>\s*\{[\s\S]{0,500}?clientId:\s*["']/.test(server), '/api/health/readiness يعرضان حالة Instagram منطقية بلا أي سرّ');
// --- Facebook Login for Business (config_id) + دقة اعتماديات Instagram ---
add('oauth-config-id-single-source', read('engine/social/oauth.ts').includes('LOGIN_CONFIG_ENV_NAMES') && read('engine/social/oauth.ts').includes('resolveLoginConfigId') && read('engine/social/oauth.ts').includes('inspectLoginConfigId') && read('engine/social/oauth.ts').includes('isPlausibleLoginConfigId'), 'Configuration ID مصدر واحد (حسم + فحص + صيغة)');
add('oauth-config-id-replaces-scope', /if \(loginConfigId && \(platform === 'facebook' \|\| platform === 'instagram'\)\) \{\s*params\.config_id = loginConfigId;\s*\} else \{\s*params\.scope = scopes\.join\(','/.test(read('engine/social/oauth.ts')), 'config_id يحلّ محل scope ولا يُرسَلان معاً (Meta تتعارض عليهما)');
add('oauth-config-id-env-names', read('engine/social/oauth.ts').includes('INSTAGRAM_LOGIN_CONFIG_ID') && read('engine/social/oauth.ts').includes('FACEBOOK_LOGIN_CONFIG_ID'), 'دعم INSTAGRAM_LOGIN_CONFIG_ID وFACEBOOK_LOGIN_CONFIG_ID مع أولوية');
add('oauth-config-id-instagram-priority', /instagram: \['INSTAGRAM_LOGIN_CONFIG_ID', 'FACEBOOK_LOGIN_CONFIG_ID'\]/.test(read('engine/social/oauth.ts')), 'Instagram يفضّل معرّفه الخاص ثم يرث معرّف Facebook');
add('oauth-config-id-format-validated', server.includes('LOGIN_CONFIG_ID_INVALID') && server.includes('loginConfigInspection'), 'config_id غير صالح يُحجب بـ409 تشخيصي قبل إرسال المالك إلى Meta');
add('oauth-config-id-no-secret-leak', !/res\.json\([\s\S]{0,600}?loginConfigId:/.test(server) && !/console\.\w+\([^)]*loginConfigId[^)]*value/i.test(server), 'لا يُعاد config_id كحقل مستقل ولا يُسجَّل كقيمة');
add('login-config-in-credentials-introspection', read('engine/social/credentials.ts').includes('optional') && read('engine/social/credentials.ts').includes('INSTAGRAM_LOGIN_CONFIG_ID'), 'credentials تعرض متغيرات Configuration كاختيارية بلا شرط اتصال');
add('meta-permission-deps-official', !/'pages_manage_metadata'\]/.test(read('engine/social/instagram.ts').split('INSTAGRAM_REQUIRED_SCOPES')[0]) && /instagram_manage_comments: \['instagram_basic', 'pages_read_engagement', 'pages_show_list'\]/.test(read('engine/social/instagram.ts')), 'اعتماديات Instagram مطابقة للوثيقة الرسمية (pages_manage_metadata ليست اعتمادية instagram_*)');
add('instagram-business-management-scope', read('engine/social/instagram.ts').includes("'business_management'"), 'Instagram يطلب business_management لصفحات Business Manager (كما Facebook)');
add('instagram-basic-official-dependency', /instagram_basic: \['pages_read_user_content', 'pages_show_list'\]/.test(read('engine/social/instagram.ts')) && read('engine/social/instagram.ts').includes("'pages_read_user_content',\n  'pages_manage_metadata'"), 'اعتماديتا instagram_basic (pages_read_user_content, pages_show_list) مضمّنتان كما في وثيقة Meta');
add('instagram-config-id-tests', /INSTAGRAM_LOGIN_CONFIG_ID/.test(fs.readFileSync(path.join(root, 'engine/tests/instagram.connector.test.ts'), 'utf8')), 'اختبار تكاملي يثبت مسار config_id وحجبه عند الصيغة غير الصالحة');
add('login-config-id-tests-in-suite', typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:instagram') && typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:foundation'), 'اختبارات config_id ضمن npm test (وحدة + تكامل)');
// --- فحص ما قبل توجيه المالك إلى Meta (منع صفحة «حدث خطأ ما» العمياء) ---
add('meta-dialog-preprobe', server.includes('async function probeMetaDialog') && server.includes('META_DIALOG_') && server.includes('dialogKind'), 'بدء OAuth لـMeta يفحص رابط التفويض فعلياً قبل التوجيه');
add('meta-dialog-probe-no-follow', /redirect: "manual"/.test(server), 'الفحص لا يتبع التحويل ولا يُنفّذ شاشة الموافقة');
add('meta-dialog-probe-no-secret-log', !/console\.\w+\([^)]*authorizationUrl/i.test(server) && !/logOAuthStart\([\s\S]{0,300}?authorizationUrl/.test(server), 'رابط التفويض (يحمل client_id/state/config_id) لا يُسجَّل');
add('meta-dialog-base-overridable', server.includes('FACEBOOK_DIALOG_BASE') && server.includes('function authEndpointFor'), 'قاعدة حوار Meta قابلة للتجاوز في الاختبار فلا يُلمس مزود حقيقي');
add('meta-dialog-mock-routes', read('engine/tests/helpers/facebookMock.ts').includes("dialogOutcome") && read('engine/tests/helpers/instagramMock.ts').includes("dialogOutcome"), 'الخوادم الوهمية تحاكي حوار Meta (consent/login/invalid_app_id/http_500)');
add('meta-dialog-probe-tests', read('engine/tests/facebook.connector.test.ts').includes('META_DIALOG_PLATFORM__INVALID_APP_ID') && read('engine/tests/instagram.connector.test.ts').includes('META_DIALOG_PLATFORM__INVALID_APP_ID'), 'اختبار تكاملي يثبت حجب 409 عند رفض الحوار للجانبين');
// HTTP 500 + «حدث خطأ ما» كان يسقط كـ«مقبول» فيُرسَل المالك إلى الفشل العام.
add('meta-dialog-http-error-rejected', read('engine/social/facebook.ts').includes("kind: 'http_error'") && /status >= 500/.test(read('engine/social/facebook.ts')) && /status >= 400 && status !== 429/.test(read('engine/social/facebook.ts')), 'التصنيف يعتبر 4xx/5xx رفضاً صريحاً (وبلا حجب عند 429 المؤقت)');
add('meta-dialog-probe-reads-body', /await res\.text\(\)/.test(server) && /classifyMetaDialogChain\(\[\{ status, location, body: bodySample \}\]\)/.test(server), 'الفحص يقرأ الجسم دائماً فيلتقط صفحة «حدث خطأ ما» مع 200 ومع 500');
add('meta-dialog-http-status-exposed', server.includes('dialogHttpStatus') && server.includes('httpStatus: dialogProbe.httpStatus'), 'رد 409 يعلن HTTP status الفعلي بلا سرّ');
add('meta-dialog-500-tests', read('engine/tests/facebook.connector.test.ts').includes("dialogOutcome: 'http_500'") && read('engine/tests/instagram.connector.test.ts').includes("dialogOutcome: 'http_500'"), 'اختبار تكاملي يثبت حجب 500 للجانبين');
// عزل السبب: عندما ترفض Meta المجموعة، يُسمّي التشخيص أصغر مجموعة صلاحيات مسؤولة.
add('meta-dialog-scope-bisection', server.includes('findMinimalFailingScopeSet') && server.includes('smallestFailingScopeSet') && server.includes('emptyScopeFails'), 'التشخيص يعزل أصغر مجموعة صلاحيات مسبِّبة للرفض بدل «حدث خطأ ما» عامة');
add('meta-dialog-bisection-on-failure-only', /if \(scopes\.length && \(dialogProbe\.httpStatus === null \|\| dialogProbe\.httpStatus >= 400\)\)/.test(server), 'العزل يُستدعى فقط عند فشل الفحص الكامل (لا يستهلك طلبات Meta في المسار الناجح)');
add('meta-dialog-bisection-tests', read('engine/tests/facebook.connector.test.ts').includes('failingScope') && read('engine/tests/helpers/facebookMock.ts').includes('failingScope'), 'اختبار تكاملي يثبت أن العزل يسمّي الصلاحية المسبِّبة بالضبط');
// الجذر المُثبت: الفحص كان بوكيل سطح مكتب ولا يتبع تحويل Meta إلى m.facebook.com،
// فيرى مسار سطح المكتب ويظنّ الحوار مقبولاً بينما متصفح المالك الجوال يفشل.
add('meta-dialog-mobile-chain-classifier', read('engine/social/facebook.ts').includes('classifyMetaDialogChain') && read('engine/social/facebook.ts').includes('FACEBOOK_MOBILE_UA') && read('engine/social/facebook.ts').includes('isMetaMobileHost'), 'تصنيف سلسلة حوار Meta يميّز مسار الجوال عن سطح المكتب');
add('meta-dialog-mobile-ua-probe', server.includes('FACEBOOK_MOBILE_UA') && /isFollowableDialogHost/.test(server) && /logicalUrl/.test(server), 'الفحص يسلك سلسلة التحويل بوكيل جوال ويتابع قفزات Meta فقط');
add('meta-dialog-mobile-flow-exposed', server.includes('mobileHostReached') && server.includes('rejectionHost') && server.includes('rejectionPath') && server.includes('mobileFlow'), 'رد 409 يعلن مسار الجوال الفعلي (مضيف/مسار) بلا سرّ');
add('meta-dialog-setup-probe', /mobileDialogProbe/.test(server) && read('src/components/social/PlatformConnectionCenter.tsx').includes('mobileDialogProbe'), 'oauth/setup والواجهة يعرضان فحص مسار الجوال بلا بدء OAuth');
add('meta-dialog-mobile-chain-tests', read('engine/tests/facebook.connector.test.ts').includes("dialogOutcome: 'mobile_redirect_then_fail'") && read('engine/tests/helpers/facebookMock.ts').includes('m.facebook.com/mobile/dialog/oauth'), 'اختبار تكاملي يثبت أن الفحص يحجب بتشخيص مسار الجوال');
add('meta-dialog-probe-no-query-leak', /safeUrlPath\(logicalUrl\)/.test(server) && !/hops\.push\(\{[^}]*location/.test(server), 'قفزات الفحص تحمل المضيف/المسار فقط بلا أي استعلام أو سرّ');
add('instagram-scope-dependency-gaps-exposed', server.includes('instagramScopeDependencyGaps') && server.includes('scopeOverrideConfigured:platform==="facebook"?facebookScopeOverride().length>0:platform==="instagram"?instagramScopeOverride().length>0'), 'oauth/setup يعرض فارق اعتماديات Instagram وتجاوز الصلاحيات بلا سرّ');

const failed = checks.filter(x => !x.ok);
console.table(checks);
if (failed.length) {
  console.error(`FINAL AUDIT FAILED: ${failed.length} checks`);
  process.exit(1);
}
console.log(`FINAL AUDIT PASSED: ${checks.length} checks`);
