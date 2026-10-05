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
add('telegram-inbound-durable-before-ack',
  /telegram\/webhook[\s\S]{0,3000}?await ingestWebhookComments\([\s\S]{0,900}?res\.status\(200\)/.test(server) &&
  /async function ingestWebhookComments\([\s\S]{0,4200}?await persistStateDurable\(\)/.test(server) &&
  server.includes('persisted}'),
  'الاستقبال ينتظر الكتابة الدائمة قبل الإقرار بحالة 200 (عبر المصدر الموحّد ingestWebhookComments)');
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
add('facebook-inbound-durable-before-ack',
  /parseFacebookWebhook\(req\.body\)[\s\S]{0,1800}?await ingestWebhookComments\([\s\S]{0,900}?res\.status\(200\)/.test(server) &&
  /async function ingestWebhookComments\([\s\S]{0,4200}?await persistStateDurable\(\)/.test(server),
  'استقبال Facebook ينتظر الكتابة الدائمة قبل الإقرار (عبر المصدر الموحّد ingestWebhookComments)');
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
add('instagram-inbound-durable-before-ack',
  /instagram\/webhook[\s\S]{0,3000}?await ingestWebhookComments\([\s\S]{0,900}?res\.status\(200\)/.test(server) &&
  /async function ingestWebhookComments\([\s\S]{0,4200}?await persistStateDurable\(\)/.test(server),
  'استقبال Instagram ينتظر الكتابة الدائمة قبل الإقرار (عبر المصدر الموحّد ingestWebhookComments)');
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
add('oauth-config-id-replaces-scope', /if \(loginConfigId && \(platform === 'facebook' \|\| platform === 'instagram'\)\) \{\s*params\.config_id = loginConfigId;/.test(read('engine/social/oauth.ts')), 'config_id يحلّ محل scope ولا يُرسَلان معاً لـFacebook وInstagram (Configuration تحدّد الصلاحيات)');
add('oauth-config-id-overrides-extras', /if \(loginConfigId && \(platform === 'facebook' \|\| platform === 'instagram'\)\)[\s\S]{0,400}?return params;[\s\S]{0,400}?const instagramOnboardingFlow/.test(read('engine/social/oauth.ts')), 'عند وجود config_id يُعاد قبل فرع extras فلا يُنتج رابط هجين (config_id + extras)');
add('oauth-config-id-env-names', read('engine/social/oauth.ts').includes('INSTAGRAM_LOGIN_CONFIG_ID') && read('engine/social/oauth.ts').includes('FACEBOOK_LOGIN_CONFIG_ID'), 'دعم INSTAGRAM_LOGIN_CONFIG_ID وFACEBOOK_LOGIN_CONFIG_ID مع أولوية');
add('oauth-config-id-instagram-priority', /instagram: \['INSTAGRAM_LOGIN_CONFIG_ID', 'FACEBOOK_LOGIN_CONFIG_ID'\]/.test(read('engine/social/oauth.ts')), 'Instagram يفضّل معرّفه الخاص ثم يرث معرّف Facebook');
add('oauth-config-id-format-validated', server.includes('LOGIN_CONFIG_ID_INVALID') && server.includes('loginConfigInspection'), 'config_id غير صالح يُحجب بـ409 تشخيصي قبل إرسال المالك إلى Meta');
add('oauth-config-id-no-secret-leak', !/res\.json\([\s\S]{0,600}?loginConfigId:/.test(server) && !/console\.\w+\([^)]*loginConfigId[^)]*value/i.test(server), 'لا يُعاد config_id كحقل مستقل ولا يُسجَّل كقيمة');
add('login-config-in-credentials-introspection', read('engine/social/credentials.ts').includes('optional') && read('engine/social/credentials.ts').includes('INSTAGRAM_LOGIN_CONFIG_ID'), 'credentials تعرض متغيرات Configuration كاختيارية بلا شرط اتصال');
add('meta-permission-deps-official', !/'pages_manage_metadata'\]/.test(read('engine/social/instagram.ts').split('INSTAGRAM_REQUIRED_SCOPES')[0]) && /instagram_manage_comments: \['instagram_basic', 'pages_read_engagement', 'pages_show_list'\]/.test(read('engine/social/instagram.ts')), 'اعتماديات Instagram مطابقة للوثيقة الرسمية (pages_manage_metadata ليست اعتمادية instagram_*)');
add('instagram-business-management-scope', read('engine/social/instagram.ts').includes("'business_management'"), 'Instagram يطلب business_management لصفحات Business Manager (كما Facebook)');
add('instagram-basic-official-dependency', /instagram_basic: \['pages_show_list'\]/.test(read('engine/social/instagram.ts')) && !/instagram_basic: \[[^\]]*pages_read_user_content/.test(read('engine/social/instagram.ts')), 'اعتمادية instagram_basic الرسمية لهذا المسار هي pages_show_list وحدها؛ pages_read_user_content (غير مطلوبة في وثيقة Instagram API with Facebook Login) أُزيلت');
// --- التدفّق الرسمي لـInstagram (Facebook Login for Business - Instagram API) ---
// الوثيقة الرسمية تشترط: display=page + extras={"setup":{"channel":"IG_API_ONBOARDING"}}
// + response_type=token، والرمز يعود في مقطع الاستجابة (لا في سطر الطلب).
add('instagram-onboarding-display-page', /params\.display = 'page'/.test(read('engine/social/oauth.ts')), 'رابط Instagram يحمل display=page كما في الوثيقة الرسمية');
add('instagram-onboarding-extras', read('engine/social/oauth.ts').includes('IG_API_ONBOARDING') && /INSTAGRAM_ONBOARDING_EXTRAS = '\{"setup":\{"channel":"IG_API_ONBOARDING"\}\}'/.test(read('engine/social/oauth.ts')), 'extras يحمل {"setup":{"channel":"IG_API_ONBOARDING"}} حرفياً');
add('instagram-onboarding-response-type-token', /const instagramOnboardingFlow = platform === 'instagram' && Boolean\(instagramOnboarding\)/.test(read('engine/social/oauth.ts')) && /params\.response_type = 'token'/.test(read('engine/social/oauth.ts')), 'Instagram يستخدم response_type=token (لا code) وفق التدفّق الرسمي، عبر بوابة instagramOnboardingFlow');
add('facebook-oauth-untouched-by-instagram', /response_type: 'code',[\s\S]{0,80}\n  \};/.test(read('engine/social/oauth.ts')) && /const instagramOnboardingFlow = platform === 'instagram'/.test(read('engine/social/oauth.ts')), 'التدفّق الرسمي مقيّد بـinstagram؛ Facebook يبقى response_type=code');
add('instagram-fragment-parser', read('engine/social/oauth.ts').includes('parseInstagramTokenFragment') && /long_lived_token/.test(read('engine/social/oauth.ts')), 'يُقرأ مقطع الاستجابة (access_token/long_lived_token/expires_in) رسمياً');
add('instagram-callback-post-no-token-in-url', server.includes('app.post("/api/platforms/:platform/oauth/callback"') && server.includes('handleOAuthCallback(req, res, query, true)') && server.includes('handleOAuthCallback(req, res,'), 'الواجهة ترسل المقطع POST في الجسم فلا يظهر الرمز في سطر الطلب ولا السجلات');
add('instagram-fragment-no-log', !/logOAuthStart\([^)]*fragment/i.test(server) && !/console\.\w+\([^)]*fragment/i.test(server), 'المقطع (يحمل الرمز) لا يُسجَّل');
add('instagram-onboarding-tests', /IG_API_ONBOARDING/.test(fs.readFileSync(path.join(root, 'engine/tests/instagram.connector.test.ts'), 'utf8')) && /response_type=token/.test(fs.readFileSync(path.join(root, 'engine/tests/instagram.connector.test.ts'), 'utf8')), 'اختبار تكاملي يثبت display/extras/response_type=token وتدفّق المقطع');
// --- إصلاح جذري: وجهة إعادة التوجيه في تدفّق المقطع تخدم تطبيق React ---
// تدفّق Meta الرسمي يعيد المتصفح إلى مسار الـcallback بلا state/code (المقطع لا
// يُرسَل للخادم). كان ذلك يرد 400 فيتوقف إكمال الربط. الآن يُخدم تطبيق React.
add('instagram-fragment-return-serves-spa', server.includes('platformOauthFragmentReturn(req)') && server.includes('serveSpaIndex(res)') && server.includes('function platformOauthFragmentReturn'), 'وجهة إعادة التوجيه في تدفّق المقطع تخدم تطبيق React ليقرأ المقطع ويرسله POST بدل 400');
add('instagram-fragment-return-no-state-only', /if \(p\.get\("state"\)[\s\S]{0,60}return false/.test(server), 'الاستثناء للطلب بلا state/code/error فقط؛ الطلب الذي يحمل state يبقى للمعالجة العادية');
add('instagram-fragment-return-spa-safe', /function serveSpaIndex[\s\S]{0,400}dist"?, ?"index\.html"|function serveSpaIndex[\s\S]{0,400}indexPath/.test(server) && server.includes('fs.readFileSync(indexPath'), 'خدمة SPA تُقرأ من dist/index.html بأمان بلا كشف مسار مُدخل من العميل');
add('instagram-fragment-return-tests', /6د\)[\s\S]{0,400}React/.test(fs.readFileSync(path.join(root, 'engine/tests/instagram.connector.test.ts'), 'utf8')), 'اختبار تكاملي يثبت أن وجهة المقطع تخدم React ولا ترد 400');
// --- الصدق في الإعلان: config_id غير مُطبَّق في تدفّق الإعداد الموحّد ---
add('oauth-config-id-effective-honest', server.includes('effectiveLoginConfigIdFor') && /function effectiveLoginConfigIdFor\(platform: string\): string \| null \{\s*return loginConfigIdFor\(platform\);/.test(server), 'يُعلن config_id المُطبَّق فعلاً (يُمرَّر لـFacebook وInstagram)');
add('instagram-probe-matches-real-flow', /instagramOnboarding: platform === "instagram" && instagramOnboardingEnabled\(\)/.test(server) && server.includes('effectiveLoginConfigIdFor(platform)'), 'فحص الحوار في oauth/setup يطابق الرابط الحقيقي (يحترم config_id المُطبَّق)');
// واجهة الدخول التي تسلكها Meta (is_business_login) تُعلن للتشخيص بلا أي سرّ:
// تطبيق Business + scope بلا config_id يُوجَّه لـBusiness Login فيفشل بعد الدخول.
add('meta-dialog-business-login-surface', read('engine/social/facebook.ts').includes('businessLoginSurface') && /is_business_login=\(0\|1\)/.test(read('engine/social/facebook.ts')), 'تصنيف سلسلة الحوار يكشف واجهة الدخول التي تسلكها Meta (Business Login مقابل الكلاسيكي)');
add('meta-dialog-surface-exposed-safe', server.includes('businessLoginSurface: dialogProbe.businessLoginSurface') && !/console\.\w+\([^)]*is_business_login/i.test(server), 'الواجهة تُعلن في رد الفحص (منطقي) بلا تسجيل رابط يحمل الاستعلام');
add('meta-business-login-requires-config-block', server.includes('businessLoginSurface === true && !loginConfigId') && server.includes('META_BUSINESS_LOGIN_REQUIRES_CONFIG_ID'), 'رصد Business Login بلا config_id يُحجب بـ409 بإجراء دقيق بدل إرسال المالك إلى «حدث خطأ ما» مضمونة');
add('meta-business-login-block-bypass-env', server.includes('function metaScopeWithoutConfigOverride') && server.includes('META_ALLOW_SCOPE_WITHOUT_CONFIG'), 'مفتاح تجاوز صريح يمنع حجباً مزمناً بلا تعديل كود (الافتراضي: الحجب)');
add('meta-business-login-block-no-secret', !/META_BUSINESS_LOGIN_REQUIRES_CONFIG_ID[\s\S]{0,900}clientSecret/.test(server), 'رد الحجب لا يحمل أي سرّ (لا clientSecret في كتلته)');
add('meta-business-login-block-tests', read('engine/tests/instagram.connector.test.ts').includes('META_BUSINESS_LOGIN_REQUIRES_CONFIG_ID') && read('engine/tests/instagram.connector.test.ts').includes('META_ALLOW_SCOPE_WITHOUT_CONFIG'), 'اختبار يثبت الحجب ومفتاح التجاوز لـBusiness Login بلا config_id');
add('meta-dialog-surface-no-false-block', !server.includes('permissionDeliveryMismatch'), 'لا يُحجب الربط بذريعة «عدم تطابق الواجهة»؛ الإصلاح هو تمرير config_id الصحيح لا الحجب');
// الجذر المُثبت: تطبيق Business يوجّه الحوار إلى Business Login الذي يقرأ الصلاحيات
// من Configuration (config_id) لا من scope. oauth/setup يوجّه لإنشاء Configuration.
add('instagram-config-id-required', server.includes('configIdRequired:cfgUsed') && /loginForBusinessSetup:\(platform==="facebook"\|\|platform==="instagram"\)/.test(server), 'oauth/setup يعلن متطلب config_id لتطبيق Business ويوجّه لإنشاء Configuration لـFacebook وInstagram');
add('instagram-config-ready-flag', server.includes('configurationRequired: true') && server.includes('configurationReady: Boolean(effectiveLoginConfigIdFor("instagram"))'), 'readiness/health يُعلنان صراحةً هل Configuration جاهز وما الإجراء التالي');
add('instagram-known-onboarding-issue-exposed', /knownIssue:/.test(server) && /1850019/.test(server), 'يُعلن عطل Meta المعروف في تدفّق الإعداد (1850019) بدل إخفائه');
add('instagram-setup-config-id-test', /oauth\/setup يعلن استخدام config_id/.test(fs.readFileSync(path.join(root, 'engine/tests/instagram.connector.test.ts'), 'utf8')), 'اختبار يثبت أن oauth/setup يعلن config_id المُطبَّق ومصدر الصلاحيات من الConfiguration');
// مفتاح INSTAGRAM_OAUTH_ONBOARDING يحوّل مخرج عطل Meta 1850019 إلى تغيير إعداد
// بلا كود جديد: تعطيله يسلك التدفّق العادي (response_type=code بلا extras).
add('instagram-onboarding-env-switch', server.includes('function instagramOnboardingEnabled') && server.includes('instagramOnboardingEnabled()'), 'مفتاح بيئة يتحكّم بتدفّق الإعداد الموحّد (extras) بلا تعديل كود');
add('instagram-onboarding-switch-test', /INSTAGRAM_OAUTH_ONBOARDING: 'false'/.test(fs.readFileSync(path.join(root, 'engine/tests/instagram.connector.test.ts'), 'utf8')), 'اختبار يثبت أن تعطيل المفتاح ينتج response_type=code بلا extras');
add('instagram-onboarding-switch-documented', fs.readFileSync(path.join(root, '.env.example'), 'utf8').includes('INSTAGRAM_OAUTH_ONBOARDING') && fs.readFileSync(path.join(root, 'render.yaml'), 'utf8').includes('INSTAGRAM_OAUTH_ONBOARDING'), 'المفتاح موثّق في .env.example وrender.yaml بلا قيمة سرّية');
add('instagram-config-id-tests', /INSTAGRAM_LOGIN_CONFIG_ID/.test(fs.readFileSync(path.join(root, 'engine/tests/instagram.connector.test.ts'), 'utf8')), 'اختبار تكاملي يثبت مسار config_id وحجبه عند الصيغة غير الصالحة');
// الحالة التشخيصية لـConfiguration ID تظهر في /api/health أيضاً (لا في readiness
// وحده) ليراها المالك مباشرة عند فتح بوابة الصحة.
add('instagram-config-ready-in-health', /insta[g]ramOAuth: \(\(\) => \{[\s\S]{0,1500}?configurationReady: Boolean\(effectiveLoginConfigIdFor\("instagram"\)\)/.test(server) && /configurationReady: Boolean\(effectiveLoginConfigIdFor\("instagram"\)\)[\s\S]{0,1500}?onboardingFlow: instagramOnboardingEnabled\(\)/.test(server), '/api/health.instagramOAuth يعرض Configuration Ready بلا أي سرّ');
// المسار الكامل للمالك بعد ضبط Configuration ID: config_id => callback => تبادل
// => اكتشاف الحساب المهني => CONNECTED + VERIFIED (لا يتوقف الفحص عند توليد الرابط).
add('instagram-config-id-full-flow-test', /مسار config_id الكامل/.test(fs.readFileSync(path.join(root, 'engine/tests/instagram.connector.test.ts'), 'utf8')) && /callback مع config_id يُكمل الربط/.test(fs.readFileSync(path.join(root, 'engine/tests/instagram.connector.test.ts'), 'utf8')), 'اختبار تكاملي يثبت الاتصال الكامل بوجود config_id');
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
// فحص بلا كوكيز يتوقّف عند شاشة الدخول؛ إعلانه «مقبولاً» يوهم المالك أن المسار
// سليم بينما الرفض يقع بعد الدخول (Use Case/Configuration) — لذا dialogPhase.
add('meta-dialog-phase-exposed', server.includes('dialogPhase') && /"rejected_before_login"/.test(server) && /"awaiting_owner_login"/.test(server), 'oauth/setup يعلن موضع الرفض (قبل الدخول/بانتظار الدخول) بدل «مقبول» مضلِّل');
add('meta-dialog-phase-tests', read('engine/tests/facebook.connector.test.ts').includes('awaiting_owner_login') && read('engine/tests/facebook.connector.test.ts').includes('rejected_before_login'), 'اختبار تكاملي يثبت التمييز بين المرحلتين');
add('meta-login-hop-in-probe-hops', /kind: classifyMetaDialogInteraction\(\{ status, location, body: bodySample \}\)\.kind/.test(server), 'قفزات الفحص تحمل تصنيفها فلا يضيع نوع قفزة الدخول');
add('meta-dialog-probe-no-query-leak', /hops\.push\(\{ step, status, host: logicalHost, path: safeUrlPath\(logicalUrl\)/.test(server) && !/hops\.push\([^)]*location/.test(server) && !/mobileFlow\s*[:=][\s\S]{0,80}location:/.test(server), 'قفزات الفحص تحمل المضيف/المسار فقط بلا أي استعلام أو سرّ');
add('instagram-scope-dependency-gaps-exposed', server.includes('instagramScopeDependencyGaps') && server.includes('scopeOverrideConfigured:platform==="facebook"?facebookScopeOverride().length>0:platform==="instagram"?instagramScopeOverride().length>0'), 'oauth/setup يعرض فارق اعتماديات Instagram وتجاوز الصلاحيات بلا سرّ');

// --- TikTok — رابع موصل اجتماعي حقيقي (OAuth 2.0 + Content Posting + Display) ---
add('tiktok-connector-module', fs.existsSync(path.join(root, 'engine/social/tiktok.ts')) && read('engine/social/tiktok.ts').includes('export class TikTokClient'), 'وحدة موصل TikTok الحقيقية موجودة');
add('tiktok-real-connector-registry', /platform: 'tiktok'[\s\S]{0,500}?realConnector:\s*true/.test(read('engine/social/registry.ts')), 'TikTok مُعلن realConnector في السجل');
add('tiktok-capability-matrix', read('engine/social/tiktok.ts').includes('TIKTOK_CAPABILITY_MATRIX') && read('engine/social/tiktok.ts').includes('NOT_AVAILABLE_BY_PUBLIC_API'), 'مصفوفة قدرات TikTok الرسمية معلنة صراحةً');
add('tiktok-no-fake-comments-messages', /comments_read[\s\S]{0,400}?NOT_AVAILABLE_BY_PUBLIC_API/.test(read('engine/social/tiktok.ts')) && /direct_messages_reply[\s\S]{0,400}?NOT_AVAILABLE_BY_PUBLIC_API/.test(read('engine/social/tiktok.ts')) && !read('engine/social/registry.ts').match(/platform: 'tiktok'[\s\S]{0,400}?comment_reply/), 'لا تُعلن تعليقات/رسائل TikTok (غير متاحة عبر الواجهة العامة)');
add('tiktok-required-scopes-official', read('engine/social/tiktok.ts').includes("'user.info.basic'") && read('engine/social/tiktok.ts').includes("'video.publish'") && read('engine/social/tiktok.ts').includes("'video.list'"), 'نطاقات TikTok الرسمية فقط (بلا نطاق بلا استدعاء)');
add('tiktok-web-oauth-contract', read('engine/social/oauth.ts').includes("platform === 'x'") && read('engine/social/oauth.ts').includes('client_key'), 'TikTok يسلك OAuth الرسمي للويب بـclient_key (بلا PKCE — PKCE للجوال/سطح المكتب فقط)');
add('tiktok-oauth-routes', server.includes('/api/platforms/tiktok/oauth/start') === false && server.includes('platform==="tiktok"') && server.includes('function tiktokConnectorConfigured'), 'TikTok يسلك مسار OAuth المشترك (start/callback) بإتمام إثبات الهوية');
add('tiktok-status-endpoint', server.includes('/api/platforms/tiktok/status') && server.includes('accountVerified') && server.includes('refreshTokenStored'), 'GET /api/platforms/tiktok/status يعرض الحالة الحقيقية بلا سرّ');
add('tiktok-disconnect-revoke', server.includes('/api/platforms/tiktok/disconnect') === false && /platform === "tiktok"[\s\S]{0,600}?revokeToken/.test(server), 'فصل TikTok يُبطل الرمز لدى المزود ثم يمسح محلياً');
add('tiktok-token-refresh', server.includes('async function ensureTikTokAccessToken') && server.includes('function withTikTokToken') && server.includes('tiktok_refresh_failed'), 'تجديد تلقائي لرمز TikTok مع إعلان الحاجة لإعادة الربط عند الفشل');
add('tiktok-publish-init-real', server.includes('/v2/post/publish/video/init/') || read('engine/social/tiktok.ts').includes('/v2/post/publish/video/init/'), 'تهيئة نشر TikTok عبر Content Posting API الرسمي');
add('tiktok-publish-no-media-guard', server.includes('MEDIA_REQUIRED') && /platform === "tiktok"[\s\S]{0,900}?MEDIA_REQUIRED/.test(server), 'TikTok لا ينشر نصاً فقط؛ غياب الوسائط يُرفض 422');
add('tiktok-publish-no-fake-delivery', /providerPublishId: publishId[\s\S]{0,400}?delivered: false/.test(server) && server.includes('PUBLISH_COMPLETE'), 'لا يُعلن تسليم TikTok إلا بـPUBLISH_COMPLETE من المزود');
add('tiktok-publish-idempotency', /idempotencyKey/.test(server) && /DUPLICATE_PUBLISH/.test(server) && /platform === "tiktok"[\s\S]{0,1200}?fingerprint/.test(server), 'منع تكرار نشر TikTok عبر بصمة idempotency محفوظة');
add('tiktok-publish-status-honest', server.includes('/api/platforms/tiktok/publish-status') && read('engine/social/tiktok.ts').includes('classifyPublishStatus'), 'استعلام حالة النشر يعتمد التصنيف الرسمي بلا ادعاء');
add('tiktok-webhook-signature-raw-body', server.includes('/api/platforms/tiktok/webhook') && server.includes('verifyTikTokSignature') && server.includes('requireRawBody'), 'webhook TikTok يتحقق TikTok-Signature على الجسم الخام');
add('tiktok-webhook-events-official', read('engine/social/tiktok.ts').includes("'authorization.removed'") && read('engine/social/tiktok.ts').includes("'video.upload.failed'") && read('engine/social/tiktok.ts').includes("'video.publish.completed'"), 'أحداث webhook الرسمية الثلاثة فقط (لا تعليقات/رسائل مختلقة)');
add('tiktok-webhook-durable-before-ack', /tiktok\/webhook/.test(server) && /await persistStateDurable\(\);\s*const persisted=!lastPersistError;/.test(server), 'استقبال TikTok ينتظر الكتابة الدائمة قبل الإقرار');
add('tiktok-webhook-duplicate-persistence', server.includes('tiktokEventIds') && /buildPersistedState[\s\S]{0,6000}?tiktokEventIds/.test(server) && /tiktokEventIds[\s\S]{0,400}?slice\(0, 20000\)/.test(server), 'معرّفات أحداث TikTok تُحفظ لصمود منع التكرار بعد restart');
add('tiktok-webhook-safe-logging', server.includes('function logTikTokWebhook') && !/logTikTokWebhook\([^)]*(token|secret|access)/i.test(server), 'سجل استقبال TikTok آمن بلا أسرار');
add('tiktok-oauth-safe-logging', server.includes('function logTikTokOAuth') && /k === "state" \|\| k === "code"/.test(server), 'سجل OAuth TikTok يستثني state/code صراحةً');
add('tiktok-credentials-encrypted', /function saveTikTokCredentials[\s\S]{0,900}?setProviderToken\("tiktok"/.test(server), 'اعتماد TikTok يُحفظ مشفّراً عبر المحوّل نفسه');
add('tiktok-verification-real', /platform === "tiktok"[\s\S]{0,500}?tiktokClient\(\)\.getUserInfo\(token\)/.test(server), 'إثبات اتصال TikTok حي من المزود (open_id) لا ادعاء');
add('tiktok-credentials-introspection', read('engine/social/credentials.ts').includes('TIKTOK_CLIENT_KEY') && read('engine/social/credentials.ts').includes('TIKTOK_CLIENT_SECRET'), 'credentials.ts يعرف اعتماد TikTok بأسماء المتغيرات فقط');
add('tiktok-readiness-safe-fields', /tiktokOAuth:\s*\(\(\)\s*=>\s*\{[\s\S]{0,1400}?clientKeyConfigured:\s*Boolean\(/.test(server) && server.includes('requestedScopes') && server.includes('oauthStateDurable'), '/api/readiness و/health يعرضان حقول TikTok الآمنة بلا أي سرّ');
add('tiktok-public-provider-readiness', /platform === "tiktok"[\s\S]{0,900}?TIKTOK_CLIENT_KEY/.test(server), 'publicProviderReadiness يعرض نقص إعداد TikTok بأسماء المتغيرات');
add('tiktok-oauth-setup-endpoint', server.includes('tiktokSetup:platform==="tiktok"?{') && server.includes('webhookSignatureStyle') && server.includes('dashboardSteps'), 'oauth/setup يعرض إعداد TikTok الدقيق وخطوات اللوحة بلا سرّ');
add('tiktok-connection-center-ui', read('src/components/social/PlatformConnectionCenter.tsx').includes('TikTokStatusPanel') && read('src/components/social/PlatformConnectionCenter.tsx').includes("p.platform === 'tiktok'"), 'مركز الربط يعرض حالة TikTok الحقيقية');
add('tiktok-one-primary-button', read('src/components/social/PlatformConnectionCenter.tsx').includes("'ربط TikTok'") && read('src/components/social/SocialManagerView.tsx').includes('ربط TikTok'), 'زر واحد أساسي «ربط TikTok» في المركز وفي بطاقة المدير');
add('tiktok-ui-no-secret', !/getTikTokStatus[\s\S]{0,200}?client_secret/i.test(read('src/services/api.ts')), 'واجهة TikTok لا تتعامل مع أي سرّ');
add('tiktok-api-service-methods', read('src/services/api.ts').includes('getTikTokStatus') && read('src/services/api.ts').includes('publishTikTok') && read('src/services/api.ts').includes('getTikTokPublishStatus'), 'خدمة الواجهة تغطي حالة/نشر/استعلام TikTok');
add('tiktok-connector-tests', fs.existsSync(path.join(root, 'engine/tests/tiktok.connector.test.ts')) && fs.existsSync(path.join(root, 'engine/tests/helpers/tiktokMock.ts')) && pkg.scripts['test:tiktok'], 'اختبار موصل TikTok (وحدة + تكامل بخادم وهمي) مسجّل');
add('tiktok-test-in-suite', typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:tiktok'), 'اختبار TikTok ضمن npm test');
add('tiktok-regression-telegram-facebook-instagram', typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:telegram') && pkg.scripts.test.includes('test:facebook') && pkg.scripts.test.includes('test:instagram'), 'فيروس انحدار Telegram/Facebook/Instagram باقية ضمن npm test');
add('tiktok-no-scraping-or-unofficial', !/puppeteer|playwright|selenium/i.test(read('engine/social/tiktok.ts')) && !/scrap/i.test(read('engine/social/tiktok.ts')), 'لا استخدام لأدوات كشط أو واجهات غير رسمية في موصل TikTok');
add('tiktok-no-fake-analytics', read('engine/social/publishing.ts').includes('tiktok'), 'publishing.ts يعرّف مؤشرات TikTok المدعومة بلا اختراع قيم');
// --- TikTok: مطابقة المسار الرسمي — رفع المسودة منفصل عن النشر المباشر ---
// وثيقة TikTok الرسمية: رفع المسودة يستخدم /v2/post/publish/inbox/video/init/
// بنطاق video.upload (بجسم source_info فقط)، والنشر المباشر /v2/post/publish/video/init/
// بنطاق video.publish. طلب نطاق واحد لكليهما يُفشل أحد المسارين بـscope_not_authorized.
add('tiktok-upload-scope-present', /TIKTOK_REQUIRED_SCOPES[\s\S]{0,300}?'video\.upload'/.test(read('engine/social/tiktok.ts')), 'نطاق video.upload مطلوب (مسار رفع المسودة الرسمي)');
add('tiktok-inbox-endpoint-used', read('engine/social/tiktok.ts').includes('/v2/post/publish/inbox/video/init/'), 'رفع مسودة الفيديو يستخدم مسار inbox الرسمي');
add('tiktok-draft-body-source-only', /buildVideoDraftBody[\s\S]{0,600}?return \{ source_info: sourceInfo \}/.test(read('engine/social/tiktok.ts')), 'جسم رفع المسودة source_info فقط بلا post_info');
add('tiktok-draft-no-privacy', /input\.postMode === 'DIRECT_POST'[\s\S]{0,200}?privacy_level/.test(read('engine/social/tiktok.ts')), 'privacy_level للصور يُرسل في DIRECT_POST فقط لا في المسودة');
add('tiktok-publish-routes-draft-separately', /mode === "DIRECT_POST"[\s\S]{0,900}?initVideoDraft/.test(server), 'مسار النشر يوجّه MEDIA_UPLOAD إلى initVideoDraft والصور للوضع الصحيح');
add('tiktok-draft-audit-honest', /modeRequiresAudit = mode === "DIRECT_POST"/.test(server), 'auditRequired معلن حسب الوضع: DIRECT_POST فقط، لا المسودة');
add('tiktok-draft-capability-honest', /content_posting_draft[\s\S]{0,300}?scope: 'video\.upload'/.test(read('engine/social/tiktok.ts')), 'قدرة رفع المسودة معلنة بنطاق video.upload لا video.publish');
add('tiktok-readiness-direct-post-field', /tiktokOAuth[\s\S]{0,1800}?directPostCapability/.test(server), 'readiness يعرض directPostCapability منفصلاً عن postingCapability');
add('tiktok-setup-lists-upload-scope', server.includes('video.publish, video.upload, video.list'), 'oauth/setup يوجّه المالك لتفعيل النطاقين معاً');
add('tiktok-draft-tests', /رفع المسودة نُفِّذ على مسار inbox الرسمي/.test(read('engine/tests/tiktok.connector.test.ts')), 'اختبار يثبت مسار رفع المسودة الرسمي');
add('tiktok-draft-body-tests', read('engine/tests/tiktok.connector.test.ts').includes('buildVideoDraftBody'), 'اختبارات جسم رفع المسودة (source_info فقط)');
// تدفّق الويب الرسمي: وثيقة Login Kit for Web تُعرّف خمسة معاملات فقط بلا
// code_challenge، ووثيقة إدارة الرمز تنصّ على أن code_verifier للجوال/سطح المكتب فقط.
// إرسال code_challenge في الويب معامل غير موثّق، فإزالته تطابق العقد الرسمي.
add('tiktok-web-no-pkce', /requiresPkce\(platform: string\): boolean \{\s*return platform === 'x';/.test(read('engine/social/oauth.ts')), 'TikTok لا يسلك PKCE في تدفّق الويب (العقد الرسمي)');
add('tiktok-web-authorization-params-official', read('engine/social/tiktok.ts').includes('TIKTOK_WEB_AUTHORIZATION_PARAMS') && /'client_key',\s*'response_type',\s*'scope',\s*'redirect_uri',\s*'state'/.test(read('engine/social/tiktok.ts')), 'معاملات تفويض الويب الرسمية الخمسة معلنة كمصدر واحد');
add('tiktok-web-pkce-flag-honest', read('engine/social/tiktok.ts').includes('TIKTOK_WEB_PKCE_SUPPORTED = false'), 'الحقيقة معلنة: PKCE غير مدعوم لتدفّق TikTok الويب');
add('tiktok-revoke-endpoint-separate', /TIKTOK_REVOKE_PATH = '\/v2\/oauth\/revoke\/'/.test(read('engine/social/tiktok.ts')) && /revokeToken[\s\S]{0,300}?tiktokRevokeUrl/.test(read('engine/social/tiktok.ts')), 'الإبطال يستخدم المسار الرسمي المنفصل /v2/oauth/revoke/ لا مسار الرمز');
add('tiktok-revoke-not-token-path', !/revokeToken[\s\S]{0,300}?tiktokTokenUrl/.test(read('engine/social/tiktok.ts')), 'لا يُرسل الإبطال إلى مسار الرمز (أُثبت حياً أنه غير موجود)');
add('tiktok-setup-exposes-token-endpoints', server.includes('revokeEndpoint') && server.includes('tokenEndpoint') && server.includes('authorizationParams'), 'oauth/setup يعرض مسارات الرمز والإبطال والمعاملات بلا سرّ');
add('tiktok-web-flow-tests', /تدفّق الويب الرسمي/.test(read('engine/tests/tiktok.connector.test.ts')) && /مسار TikTok الرسمي المنفصل/.test(read('engine/tests/tiktok.connector.test.ts')), 'اختبارات تثبت تدفّق الويب الرسمي ومسار الإبطال المنفصل');

// الحالة الصادقة لموصل TikTok (Batch 13): مفردات إحدى عشرة حالة من مصدر واحد،
// بترتيب أسبقية صريح، وبلا ادعاء اتصال/توثيق/تشغيل بلا دليل.
const tiktokState = read('engine/social/tiktokState.ts');
add('tiktok-truthful-state-module', fs.existsSync(path.join(root, 'engine/social/tiktokState.ts')) && tiktokState.includes('export function resolveTikTokState'), 'وحدة الحالة الصادقة لـTikTok موجودة (منطق خالص)');
add('tiktok-truthful-state-vocabulary', ['NOT_CONFIGURED', 'CODE_READY', 'READY_TO_CONNECT', 'AUTHORIZATION_REQUIRED', 'CONNECTED', 'TOKEN_REFRESH_REQUIRED', 'REVIEW_REQUIRED', 'PUBLISHING_RESTRICTED', 'VERIFIED', 'OPERATIONAL', 'EXTERNAL_BLOCKER'].every((s) => tiktokState.includes(`'${s}'`)), 'المفردات الإحدى عشرة معلنة في المصدر الواحد');
add('tiktok-state-single-source', server.includes('resolveTikTokState') && /import \{[\s\S]{0,400}?resolveTikTokState[\s\S]{0,200}?\} from "\.\/engine\/social\/tiktokState"/.test(server), 'الخادم يستخدم resolveTikTokState كمصدر واحد (لا منطق حالة موازٍ)');
add('tiktok-state-no-operational-without-evidence', /operationalEvidence: tiktokOperationalEvidence\(\)/.test(server) && /function tiktokOperationalEvidence[\s\S]{0,400}?state === "published"[\s\S]{0,200}?providerPostId/.test(server), 'لا OPERATIONAL بلا دليل مزود (سجل نشر published بمعرّف منشور)');
add('tiktok-state-no-connected-without-verify', /providerVerified: verified/.test(server) && tiktokState.includes("state === 'VERIFIED' || state === 'OPERATIONAL' || state === 'PUBLISHING_RESTRICTED'"), 'لا تُعلن حالات الاتصال الموثق بلا providerVerified');
add('tiktok-state-not-configured-priority', /if \(!input\.clientKeyConfigured \|\| !input\.clientSecretConfigured\)[\s\S]{0,400}?'NOT_CONFIGURED'/.test(tiktokState), 'NOT_CONFIGURED تتقدّم على أي ادعاء اتصال (أسبقية صريحة)');
add('tiktok-state-code-ready-priority', /!prerequisitesComplete[\s\S]{0,300}?'CODE_READY'/.test(tiktokState), 'CODE_READY تتقدّم على ادعاء الاتصال عند نقص البيئة');
add('tiktok-state-refresh-required', tiktokState.includes("'reauth_needed'") && tiktokState.includes("'TOKEN_REFRESH_REQUIRED'"), 'TOKEN_REFRESH_REQUIRED معلنة عند reauth/انتهاء بلا refresh');
add('tiktok-state-review-required', tiktokState.includes("'review_required'") && tiktokState.includes("'REVIEW_REQUIRED'"), 'REVIEW_REQUIRED معلنة من إشارة مراجعة صريحة لا تخمين');
add('tiktok-state-publishing-restricted', tiktokState.includes('directPostAuditRequired') && tiktokState.includes("'PUBLISHING_RESTRICTED'"), 'PUBLISHING_RESTRICTED معلنة حين يلزم audit للنشر المباشر');
add('tiktok-state-external-blocker', tiktokState.includes("'EXTERNAL_BLOCKER'") && tiktokState.includes('clientKeyFormatOk'), 'EXTERNAL_BLOCKER معلنة عند صيغة مرفوضة/رفض بيانات التطبيق');
add('tiktok-state-labels-ar', tiktokState.includes('TIKTOK_STATE_LABELS_AR') && tiktokState.includes('TIKTOK_STATE_TONES'), 'تسميات عربية ودلالات لون للحالات (للعرض)');
add('tiktok-status-exposes-truthful-state', server.includes('state: truthful.state') && server.includes('stateLabelAr') && server.includes('stateReason') && server.includes('nextAction: truthful.nextAction'), 'GET /api/platforms/tiktok/status يعرض الحالة الصادقة + السبب + الإجراء');
add('tiktok-readiness-truthful-state', /operationalState: tiktokTruthfulState\(\)\.state/.test(server), 'readiness/health يعكسان الحالة الصادقة الموحّدة');
add('tiktok-state-no-secret-in-labels', !/Bearer\s/.test(tiktokState) && !/['"]client_secret['"]\s*:/.test(tiktokState) && !/TIKTOK_STATE_LABELS_AR[\s\S]{0,2000}?(eyJ|sk-|re_)/.test(tiktokState), 'وحدة الحالة بلا أي قيمة سرّية (أسماء المتغيرات فقط)');
add('tiktok-ui-truthful-state', read('src/components/social/PlatformConnectionCenter.tsx').includes('stateLabelAr') && read('src/components/social/SocialManagerView.tsx').includes('stateLabelAr'), 'الواجهة تعرض الحالة الصادقة (مركز الربط + بطاقة المدير)');
add('tiktok-state-tests', read('engine/tests/tiktok.connector.test.ts').includes('resolveTikTokState') && read('engine/tests/tiktok.connector.test.ts').includes('الحالة الصادقة'), 'اختبارات تغطي الحالة الصادقة (وحدة + تكامل)');

// مصالحة حالة نشر TikTok تلقائياً: التسليم يُحسم من دليل المزود بلا تدخّل المالك.
const tiktokPublishRecon = read('engine/social/tiktok.ts');
add('tiktok-publish-reconcile-single-source', tiktokPublishRecon.includes('export function shouldReconcileTikTokRecord') && tiktokPublishRecon.includes('export function applyTikTokPublishStatus'), 'منطق المصالحة مصدر واحد قابل للاختبار في وحدة TikTok');
add('tiktok-publish-reconcile-no-claim', /export function applyTikTokPublishStatus[\s\S]{0,900}?status\.delivered && status\.state === 'delivered'/.test(tiktokPublishRecon), 'لا published بلا delivered الحقيقي من المزود');
add('tiktok-publish-reconcile-server-sweep', server.includes('reconcileTikTokPublishes') && /fetchPublishStatus\(ensured\.token, publishId\)/.test(server), 'الخادم يستعلم حالة النشر فعلياً من TikTok ويحدّث السجل');
add('tiktok-publish-reconcile-timer', /tiktokReconcileTimer = setInterval\(safeTimerCallback\(\(\) => reconcileTikTokPublishes\(\), "tiktok-reconcile"\)/.test(server), 'مصالحة دورية داخل عملية الخادم (بلا تدخّل المالك)');
add('tiktok-publish-reconcile-verified-only', /async function reconcileTikTokPublishes[\s\S]{0,400}?if \(!tiktokOperationalNow\(\)\) return result;/.test(server), 'لا مصالحة بلا اتصال موثق (لا استعلام خارجي بلا توثيق)');
add('tiktok-publish-history-endpoint', /app\.get\("\/api\/platforms\/tiktok\/publishes", requireOwner/.test(server), 'سجل عمليات النشر للمالك فقط (requireOwner)');
add('tiktok-publish-history-no-secret', /app\.get\("\/api\/platforms\/tiktok\/publishes"[\s\S]{0,1200}?res\.json/.test(server) && !/tiktok\/publishes"[\s\S]{0,1500}?providerTokens/.test(server), 'سجل النشر لا يكشف أي اعتماد أو سرّ');
add('tiktok-publish-reconcile-tests', read('engine/tests/tiktok.connector.test.ts').includes('shouldReconcileTikTokRecord') && read('engine/tests/tiktok.connector.test.ts').includes('مصالحة تلقائية'), 'اختبارات تغطي المصالحة (وحدة + تكامل تلقائي)');
add('tiktok-publish-history-ui', read('src/components/social/PlatformConnectionCenter.tsx').includes('getTikTokPublishes') && read('src/services/api.ts').includes('/api/platforms/tiktok/publishes'), 'الواجهة تعرض سجل عمليات النشر الحقيقي من مسار المالك');

// تشخيص مفتاح تطبيق TikTok (client_key): يُثبت المفتاح لدى المزود بلا كشفه،
// فيُنسب خطأ «correct the following: client_key» إلى سببه بدل التخمين.
const tiktokModule = read('engine/social/tiktok.ts');
add('tiktok-clientkey-fingerprint-single-source', tiktokModule.includes('export function clientKeyFingerprint') && tiktokModule.includes('export function maskSecretValue'), 'بصمة المفتاح وإخفاؤه مصدر واحد في وحدة TikTok');
add('tiktok-clientkey-mask-first-last-4', /maskSecretValue[\s\S]{0,300}?slice\(0, 4\)[\s\S]{0,120}?slice\(-4\)/.test(tiktokModule), 'الإخفاء يُظهر أول 4 وآخر 4 فقط (القيم القصيرة تُخفى كاملة)');
add('tiktok-clientkey-provider-proof', /async verifyClientKey/.test(tiktokModule) && tiktokModule.includes("body.set('grant_type', 'client_credentials')"), 'إثبات المفتاح لدى TikTok عبر طلب client_credentials فعلي واحد');
add('tiktok-clientkey-error-classified', tiktokModule.includes('export function classifyTikTokClientKeyError') && tiktokModule.includes("'invalid_client'") && tiktokModule.includes("'unsupported_grant_type'"), 'تصنيف خطأ المفتاح يميّز المفتاح المجهول عن الناقص');
add('tiktok-clientkey-diagnosis-endpoint', server.includes('/api/platforms/tiktok/client-key-diagnosis') && /client-key-diagnosis", requireOwner/.test(server), 'مسار تشخيص المفتاح للمالك فقط (requireOwner)');
add('tiktok-clientkey-diagnosis-masked-only', server.includes('tiktokClientKeyDiagnosis') && server.includes('configuredValueMasked') && !/tiktokClientKeyDiagnosis[\s\S]{0,3000}?process\.env\.TIKTOK_CLIENT_KEY\)/.test(server), 'التشخيص يعرض القيمة مُخفاة ولا يطبع المفتاح أو السرّ');
add('tiktok-clientkey-oauth-start-log', server.includes('logTikTokOAuthStart') && server.includes('tiktok-oauth-start'), 'سجل آمن عند بدء OAuth يُثبت المفتاح المستخدم فعلاً (مُخفى + بصمة)');
add('tiktok-clientkey-setup-exposed', server.includes('clientKeyDiagnosis'), 'oauth/setup يعرض تشخيص المفتاح بلا سرّ');
add('tiktok-clientkey-tests', read('engine/tests/tiktok.connector.test.ts').includes('clientKeyFingerprint') && read('engine/tests/tiktok.connector.test.ts').includes('classifyTikTokClientKeyError') && read('engine/tests/tiktok.connector.test.ts').includes('client-key-diagnosis'), 'اختبارات تغطي البصمة والإخفاء والتصنيف ومسار التشخيص');

// التحقق من ملكية الرابط (TikTok URL prefix): ملف تحقق عام يُخدَم من مسار ثابت
// بمحتوى التوقيع الرسمي، والصفحات القانونية العامة (Terms/Privacy/Website URLs).
const siteVerification = read('engine/social/siteVerification.ts');
const legalPages = read('engine/social/legalPages.ts');
add('site-verification-module', fs.existsSync(path.join(root, 'engine/social/siteVerification.ts')) && siteVerification.includes('export function buildTikTokVerificationFile'), 'وحدة ملف تحقق ملكية الرابط موجودة (مصدر واحد)');
add('site-verification-content-official', siteVerification.includes("tiktok-developers-site-verification=") && /TIKTOK_VERIFICATION_FILENAME = `tiktok\$\{TIKTOK_VERIFICATION_TOKEN\}\.txt`/.test(siteVerification), 'الاسم والمحتوى يطابقان عقد TikTok الرسمي (file_name + signature)');
add('site-verification-route-static', server.includes('SITE_VERIFICATION_PATH_PATTERN') && server.includes('app.get(SITE_VERIFICATION_PATH_PATTERN') && server.includes('serveVerificationFile'), 'الخادم يخدم ملف التحقق من مسار ثابت (لا من واجهة React)');
add('site-verification-no-redirect', /serveVerificationFile[\s\S]{0,400}?res\.status\(200\)/.test(server) && !/serveVerificationFile[\s\S]{0,400}?res\.redirect/.test(server), 'ملف التحقق يُخدَم 200 بلا تحويل (3xx مرفوض لدى TikTok)');
add('site-verification-plain-text', server.includes('VERIFICATION_CONTENT_TYPE') && siteVerification.includes("text/plain; charset=utf-8"), 'نوع المحتوى نص صريح لا HTML');
add('site-verification-alt-filename', siteVerification.includes('tiktok-developers-site-verification.txt'), 'اسم بديل شائع لنفس الملف بنفس المحتوى');
add('site-verification-health-exposed', server.includes('siteVerification: siteVerificationState()') && /function siteVerificationState[\s\S]{0,900}?filename/.test(server), 'الحالة تعرض اسم الملف ورابطه في health/readiness');
add('site-verification-strict-default', siteVerification.includes('echoFallbackEnabled') && siteVerification.includes('TIKTOK_VERIFICATION_ECHO') && /if \(!echoFallbackEnabled\(\)\) return null/.test(siteVerification), 'الوضع الافتراضي صارم: الرمز المرجعي فقط، والصدّى تفعيل صريح — لإثبات أن الرمز وحده يُرضي TikTok');
add('site-verification-echo-opt-in', siteVerification.includes('servedViaEcho') && /parseTikTokVerificationToken\(name\)[\s\S]{0,140}?buildTikTokVerificationFile\(requestedToken\)/.test(siteVerification), 'الصدّى عند تفعيله يخدم توقيع اسم الرمز المطلوب (لا 404 ولا توقيع رمز آخر)');
add('site-verification-echo-diagnosis', server.includes('served_echo_match') && server.includes('lastEchoRequest'), 'الحالة تكشف خدمة الصدّى (served_echo_match) وتُعلن آخر طلب صدّى فوراً');
add('site-verification-canonical-token', siteVerification.includes("DEFAULT_TIKTOK_VERIFICATION_TOKEN = 'djxlJcC4WFlCh4OZY8iVHgezp491vPoZ'"), 'الرمز المرجعي المدموج هو الرمز الذي طلبته TikTok فعلاً (حالة الأحرف الصحيحة)');
add('site-verification-mismatch-rejected', server.includes('verificationFileForPath(req.path)') && server.includes('recordVerificationRequest') && /if \(file\) return serveVerificationFile/.test(server), 'إطار المسار يخدم ما يُرجعه verificationFileForPath ويسجّل الطلب');
add('deploy-info-health', /app\.get\("\/api\/health"[\s\S]*?deploy: deploymentInfo\(\)/.test(server) && server.includes('function deploymentInfo()') && server.includes('RENDER_GIT_COMMIT'), 'دليل النشر (commit/provider) معلن في /api/health لإثبات الكود العامل');
add('site-verification-request-capture', siteVerification.includes('captureVerificationRequest') && siteVerification.includes('VerificationRequestSnapshot') && server.includes('recordVerificationRequest(req)'), 'التقاط طلبات ملف التحقق (الاسم/الرمز/وكيل المستخدم/الوقت) في مصدر واحد');
add('site-verification-capture-middleware', /app\.use\(\(req, _res, next\) => \{[\s\S]{0,200}?isVerificationFileRequest\(req\.path\)[\s\S]{0,120}?recordVerificationRequest\(req\)/.test(server), 'وسيط يلتقط كل طلب لملف تحقق (أي طريقة HTTP) قبل معالجته');
add('site-verification-last-request-exposed', /siteVerificationState[\s\S]{0,1800}?lastRequest: verificationRequestLog\.last/.test(server) && server.includes('lastServedRequest') && server.includes('lastMismatchedRequest') && server.includes('recentRequests'), 'آخر طلب تحقق معلن في /api/health.siteVerification.lastRequest (ومع آخر مخدوم/منحرف وسجل حديث)');
add('site-verification-capture-no-secrets', !/captureVerificationRequest[\s\S]{0,600}?(secret|token=|authorization|api[_-]?key)/i.test(siteVerification) && siteVerification.includes('userAgent: String(input.userAgent'), 'الالتقاط لا يسجّل أي سرّ: اسم/رمز عامان + وكيل مستخدم مقطوع');
add('site-verification-capture-safe-log', server.includes('tiktok-verification-request') && !/recordVerificationRequest[\s\S]{0,900}?console\.log\([\s\S]{0,80}?(secret|password)/i.test(server), 'سطر سجل آمن يُقرأ من سجلات الاستضافة بعد انتهاء العملية (بلا سرّ)');
add('site-verification-capture-durable', server.includes('verificationRequests: {') && server.includes('control.verificationRequests') && /recordVerificationRequest[\s\S]{0,1600}?saveControlState\(\)/.test(server), 'سجل الطلبات يُحفظ في المخزن الدائم ويُسترجع، فلا يضيع عند cold start فيظهر «لم يطلب» كذباً');
add('site-verification-zero-unambiguous', server.includes('requestCountSinceBoot') && server.includes('processStartedAt') && server.includes('requestCountDurable'), 'تمييز صريح بين العدّاد المُثبت والذاكرة منذ الإقلاع لتفسير requestCount=0 بلا لبس');
add('site-verification-diagnosis-field', server.includes('diagnosis: !verificationRequestLog.last') && server.includes("no_request_observed") && server.includes("served_ok"), 'حكم صريح (no_request_observed/served_ok/token_differs...) يفسّر الحالة الآن');
add('site-verification-host-forensics', siteVerification.includes('forwardedHost') && siteVerification.includes('viaProxy') && server.includes("h('x-forwarded-host')"), 'تسجيل المضيف ومرور وسيط الشبكة لكشف اعتراض Edge/دومين خطأ');
add('site-verification-capture-durable-test', server.includes('verificationRequests: {') && siteVerification.includes('viaProxy'), 'اختبارات الثبات والطب الشرعي مُضافة');
add('site-verification-capture-tests', read('engine/tests/site.verification.test.ts').includes('captureVerificationRequest') && read('engine/tests/site.verification.test.ts').includes('lastRequest'), 'اختبار يثبت التقاط الطلب وإعلانه في health');
add('site-verification-env-overridable', siteVerification.includes('effectiveTikTokVerificationToken') && siteVerification.includes('TIKTOK_VERIFICATION_TOKEN_ENV_NAME'), 'الرمز قابل للتجاوز من البيئة TIKTOK_VERIFICATION_TOKEN بلا تعديل كود');
add('site-verification-spa-guard', server.includes('isVerificationFileRequest(req.path)') && /isVerificationFileRequest\(req\.path\)[\s\S]{0,400}?res\.status\(404\)/.test(server), 'مسار شبيه بملف تحقق لا يسقط إلى index.html بحالة 200');
add('site-verification-exact-length', /serveVerificationFile[\s\S]{0,600}?Content-Length/.test(server) && server.includes('Buffer.from(file.content'), 'يُخدم بطول بايت دقيق وبلا محرف سطر جديد مضاف');
add('site-verification-mismatch-tests', read('engine/tests/site.verification.test.ts').includes('الوضع الصارم') && read('engine/tests/site.verification.test.ts').includes('served_echo_match') && read('engine/tests/site.verification.test.ts').includes('isVerificationFileRequest'), 'اختبار يثبت الوضع الصارم افتراضياً والصدّى عند تفعيله وعدم السقوط إلى HTML');
add('site-verification-public-file', fs.existsSync(path.join(root, 'public', 'tiktokdjxlJcC4WFlCh4OZY8iVHgezp491vPoZ.txt')), 'الملف موجود أيضاً في public/ لخدمته ثابتاً على Netlify');
add('legal-pages-module', fs.existsSync(path.join(root, 'engine/social/legalPages.ts')) && legalPages.includes('export function buildTermsPage') && legalPages.includes('export function buildPrivacyPage'), 'صفحتا الشروط والخصوصية بمحتوى حقيقي (مصدر واحد)');
add('legal-pages-routes-public', server.includes('app.get(["/terms"') && server.includes('"/privacy"') && server.includes('legalPageForPath'), 'مسارات /terms و/privacy عامة بلا مصادقة');
add('legal-pages-real-content', legalPages.includes('نطاق الخدمة') && legalPages.includes('البيانات التي نجمعها') && legalPages.includes('AES-256-GCM'), 'المحتوى القانوني يصف ما يفعله النظام فعلاً');
add('legal-pages-no-fake-contact', legalPages.includes('contactEmail') && legalPages.includes('المنشورة في صفحة الموقع الرسمية'), 'لا يُخترع بريد/رقم تواصل غير مضبوط على الخادم');
add('site-verification-tests', fs.existsSync(path.join(root, 'engine/tests/site.verification.test.ts')) && typeof pkg.scripts['test:site-verification'] === 'string' && pkg.scripts.test.includes('test:site-verification'), 'اختبار التحقق من الرابط والصفحات القانونية مسجّل وضمن npm test');

// ---------------------------------------------------------------------------
// YouTube connector (Batch 14) — OAuth + إثبات هوية القناة عبر youtube.readonly
// ---------------------------------------------------------------------------
const youtubeModule = read('engine/social/youtube.ts');
const ytRegistry = read('engine/social/registry.ts');
add('youtube-connector-module', fs.existsSync(path.join(root, 'engine/social/youtube.ts')) && youtubeModule.includes('class YouTubeClient') && youtubeModule.includes('YOUTUBE_CAPABILITY_MATRIX'), 'موصل YouTube الحقيقي منفّذ في وحدة مستقلة');
add('youtube-readonly-scope-required', youtubeModule.includes('YOUTUBE_READONLY_SCOPE') && youtubeModule.includes('https://www.googleapis.com/auth/youtube.readonly') && youtubeModule.includes('YOUTUBE_REQUIRED_SCOPES'), 'youtube.readonly مطلوب (يغطّي channels.list?mine=true لإثبات القناة)');
add('youtube-upload-scope-retained', youtubeModule.includes('YOUTUBE_UPLOAD_SCOPE') && server.includes('YOUTUBE_REQUIRED_SCOPES'), 'youtube.upload باقٍ في النطاقات المطلوبة بقرار المالك');
add('youtube-force-ssl-scope-required', /YOUTUBE_REQUIRED_SCOPES[\s\S]{0,200}?YOUTUBE_FORCE_SSL_SCOPE,/.test(youtubeModule) && youtubeModule.includes("https://www.googleapis.com/auth/youtube.force-ssl"), 'youtube.force-ssl مطلوب لإدارة التعليقات والردود (إضافة مقصودة بقرار المالك)');
add('youtube-channel-identity-impl', /channels\?part=snippet,contentDetails(,statistics)?&mine=true/.test(youtubeModule) && server.includes('youtubeClient().fetchMyChannel'), 'إثبات هوية القناة يستدعي channels.list?mine=true فعلاً');
add('youtube-capability-matrix-honest', /audience_demographics[\s\S]{0,200}?NOT_AVAILABLE/.test(youtubeModule) && /webhook_pubsub[\s\S]{0,200}?REQUIRES_REVIEW/.test(youtubeModule), 'مصفوفة القدرات تُعلن ما ليس منفّذاً/متاحاً صراحةً (تركيبة سكانية NOT_AVAILABLE، PubSub REQUIRES_REVIEW) — لا ادعاء');
add('youtube-registry-real-connector', /platform: 'youtube',[\s\S]{0,900}?realConnector: true/.test(ytRegistry), 'YouTube مُعلن موصلاً حقيقياً في السجل');
add('youtube-content-capabilities-declared', /platform: 'youtube',[\s\S]{0,900}?capabilities: \[[^\]]*'publish'[\s\S]{0,120}?'comments'[\s\S]{0,120}?'comment_reply'[\s\S]{0,120}?'analytics'[\s\S]{0,120}?'scheduling'/.test(ytRegistry), 'قدرات المحتوى المنفّذة مُعلنة صراحةً في السجل (نشر/تعليقات/رد/تحليلات/جدولة)');
add('youtube-callback-verifies-channel', /platform==="youtube"[\s\S]{0,900}?fetchMyChannel/.test(server) && /platform==="youtube"[\s\S]{0,1400}?saveYouTubeCredentials/.test(server), 'callback يبادل الرمز ثم يثبت القناة فعلًا قبل إعلان الاتصال');
add('youtube-health-block', server.includes('youtubeOAuth: youtubeHealthState()') && server.includes('readonlyScopePresent'), 'health/readiness يكشفان حالة YouTube الآمنة (نطاق القراءة + الاتصال)');
add('youtube-setup-block', server.includes('youtubeSetup:platform==="youtube"') && server.includes('channelIdentityEndpoint'), 'oauth/setup يعرض إعداد YouTube (النطاقان + القدرات) بلا سرّ');
add('youtube-disconnect-revokes', /platform === "youtube"[\s\S]{0,600}?oauth2\.googleapis\.com\/revoke/.test(server), 'الفصل يُبطل الرمز لدى Google ثم يمسح الاعتماد المشفّر');
add('youtube-secrets-server-only', !/VITE_[A-Z_]*GOOGLE/.test(server) && !youtubeModule.includes('GOOGLE_OAUTH_CLIENT_SECRET'), 'لا مفتاح Google في الواجهة ولا سرّ مكتوب في الوحدة');
add('youtube-tests', fs.existsSync(path.join(root, 'engine/tests/youtube.connector.test.ts')) && typeof pkg.scripts['test:youtube'] === 'string' && pkg.scripts.test.includes('test:youtube'), 'اختبار موصل YouTube مسجّل وضمن npm test');

// ---------------------------------------------------------------------------
// YouTube Batch 15 — تجديد الرمز تلقائياً + فحص القناة (قراءة فقط) من الواجهة
// ---------------------------------------------------------------------------
const youtubeUi = read('src/components/social/PlatformConnectionCenter.tsx');
add('youtube-token-refresh-single-source', server.includes('async function ensureYouTubeAccessToken') && server.includes('refreshAccessToken('), 'تجديد رمز YouTube عبر refresh_token منفّذ في الخادم (مصدر واحد)');
add('youtube-refresh-resilient-wrapper', server.includes('function fetchYouTubeChannelResilient') && /fetchYouTubeChannelResilient\(\)/.test(server), 'قراءة القناة تمر عبر غلاف يجدّد الرمز عند الانتهاء فلا يسقط الاتصال');
add('youtube-health-uses-resilient', /platform==="youtube"[\s\S]{0,700}?fetchYouTubeChannelResilient/.test(server) && /platform === "youtube"[\s\S]{0,700}?fetchYouTubeChannelResilient/.test(server), 'health وverifyProviderConnection يستخدمان القراءة المُجدِّدة لا الرمز المباشر');
add('youtube-refresh-no-oauth-when-valid', /if \(!youtubeAccessExpired\(\) \|\| !youtubeRefreshToken\(\)\) return \{ ok: true, token, refreshed: false \}/.test(server), 'لا يُطلب إعادة OAuth إن كان الرمز صالحاً أو refresh متاحاً');
add('youtube-refresh-fail-reauth', /youtube_refresh_failed[\s\S]{0,400}?reauth_needed|reauth_needed[\s\S]{0,400}?youtube_refresh_failed/.test(server), 'فشل التجديد الفعلي فقط يُعلن reauth_needed');
add('youtube-health-exposes-token-refreshed', server.includes('tokenRefreshed:Boolean(proof.refreshed)'), 'استجابة health تُعلن إن جُدِّد الرمز (بلا أي قيمة سرّية)');
add('youtube-health-exposes-refreshable', server.includes('tokenRefreshable:'), 'health يُعلن أن التجديد متاح (منطقي فقط)');
add('youtube-ui-operational-check', youtubeUi.includes("getPlatformHealth('youtube')") && youtubeUi.includes('فحص القناة والحالة'), 'لوحة YouTube تستدعي health بزر الفحص التشغيلي');
add('youtube-ui-shows-channel', youtubeUi.includes('اسم القناة') && youtubeUi.includes('معرّف القناة') && youtubeUi.includes('accountId'), 'اللوحة تعرض اسم القناة ومعرّفها ووقت الفحص');
add('youtube-ui-reconnect-on-409', youtubeUi.includes('إعادة ربط Google مطلوبة') && youtubeUi.includes('إعادة ربط OAuth'), '409 يُعرض كإعادة ربط مطلوبة مع زر');
add('youtube-ui-no-secret', !/access_token|refresh_token/.test(youtubeUi), 'لوحة YouTube لا تعرض أي access/refresh token');
add('youtube-status-panel-mounted', /platform === 'youtube'[\s\S]{0,120}?YouTubeStatusPanel/.test(youtubeUi), 'لوحة YouTube مركّبة في مركز ربط المنصات');
add('youtube-ui-operational-capabilities', youtubeUi.includes('قائمة الفيديوهات') && youtubeUi.includes('قراءة التعليقات') && youtubeUi.includes('الإحصاءات') && youtubeUi.includes('الرد على التعليقات'), 'اللوحة تعرض قدرات YouTube التشغيلية الحقيقية فقط');
add('youtube-refresh-tests', youtubeUi.length > 0 && /11b\)/.test(read('engine/tests/youtube.connector.test.ts')), 'اختبارات التجديد (صالح/منتهٍ/فشل/لا تسريب) موجودة');

// ---------------------------------------------------------------------------
// YouTube FULL OPERATION (Batch 16) — تشغيل المحتوى الكامل عبر Data API v3
// ---------------------------------------------------------------------------
const youtubeStateModule = read('engine/social/youtubeState.ts');
const youtubeLearningModule = read('engine/social/youtubeLearning.ts');
const youtubeRoutes = read('engine/social/routes.ts');
add('youtube-full-operation-modules', fs.existsSync(path.join(root, 'engine/social/youtubeState.ts')) && fs.existsSync(path.join(root, 'engine/social/youtubeLearning.ts')), 'وحدات الحالة الصادقة والتعلّم منفّذة في وحدات مستقلة قابلة للاختبار');
add('youtube-video-upload-real', youtubeModule.includes('uploadVideo(') && /upload\/youtube\/v3\/videos\?uploadType=resumable/.test(youtubeModule) && server.includes('youtubeClient().uploadVideo('), 'رفع الفيديو حقيقي عبر videos.insert resumable (لا محاكاة)');
add('youtube-video-update-real', youtubeModule.includes('async updateVideo(') && server.includes('/api/platforms/youtube/video-update'), 'تحديث الفيديو حقيقي عبر videos.update');
add('youtube-publish-schedule-real', server.includes('buildVideoInsertMetadata') && /publishAt/.test(server) && youtubeModule.includes('publishAt'), 'النشر والجدولة عبر publishAt الحقيقي لدى YouTube (لا حقل داخلي)');
add('youtube-comments-read-real', youtubeModule.includes('listCommentThreads(') && server.includes('ingestYouTubeComment'), 'قراءة التعليقات الحقيقية عبر commentThreads.list مع تطبيع وتخزين');
add('youtube-comment-reply-real', youtubeModule.includes('replyToComment(') && /comments\?part=snippet/.test(youtubeModule) && server.includes('/api/platforms/youtube/reply'), 'الرد الحقيقي عبر comments.insert بلا تسجيل تسليم بلا معرّف من Google');
add('youtube-idempotency-single-source', server.includes('youtubeUploadFingerprint(') && server.includes('youtubeOperationKeySeen(') && server.includes('recordYouTubeOperationKey('), 'idempotency موحّد يمنع الرفع/الرد/النشر المزدوج');
add('youtube-rate-limit-enforced', youtubeModule.includes('checkOperationRateLimit(') && /youtubeRateLimit\(/.test(server) && server.includes('RATE_LIMITED'), 'حدّ معدّل العمليات مفروض (لا ردود/رفع غير محدود)');
add('youtube-operation-guard-single-source', server.includes('function youtubeOperationGuard(') && /CONNECTOR_NOT_READY/.test(server) && /NOT_CONNECTED/.test(server), 'بوابة تشغيل موحّدة تمنع التنفيذ بلا اعتماد/اتصال موثق');
add('youtube-only-guard-module', youtubeStateModule.includes('guardExternalOperationPlatform') && youtubeStateModule.includes('YOUTUBE_ONLY_PLATFORM') && server.includes('youtubeOnlyBlock('), 'حارس YOUTUBE_ONLY_OPERATIONAL مصدر واحد يمنع أي منصة غير YouTube');
add('youtube-truthful-state-module', youtubeStateModule.includes('resolveYouTubeState') && youtubeStateModule.includes('SCOPE_UPGRADE_REQUIRED') && server.includes('youtubeTruthfulState()'), 'الحالة الصادقة مفردات موحّدة (منها SCOPE_UPGRADE_REQUIRED) بلا ادعاء');
add('youtube-scope-upgrade-honest', /youtubeForceSslGranted\(/.test(server) && /إعادة ربط YouTube مطلوبة لتفعيل إدارة التعليقات/.test(server), 'غياب force-ssl يُعلن SCOPE_UPGRADE_REQUIRED بلا تحايل على Google');
add('youtube-learning-loop-module', youtubeLearningModule.includes('buildYouTubeLearning') && youtubeLearningModule.includes('summarizeChannelAnalytics') && server.includes('/api/platforms/youtube/learning'), 'حلقة تعلّم من الأداء الحقيقي مع مصدر وحجم عيّنة وحدود');
add('youtube-audience-no-fabrication', youtubeLearningModule.includes('demographicsAvailable: false') && youtubeLearningModule.includes('analyzeYouTubeAudience'), 'تحليل الجمهور يعلن غياب البيانات السكانية صراحةً ولا يخترعها');
add('youtube-operation-observability', server.includes('function logYouTubeOperation(') && /logYouTubeOperation\("video_upload"/.test(server) && /logYouTubeOperation\("comment_reply"/.test(server), 'كل عملية خارجية تُسجَّل (عملية/معرّف/نتيجة/مدة/idempotency) بلا أي سرّ');
add('youtube-no-secret-logging', server.includes('function logYouTube(') && /k === "token"/.test(server) && !/console\.log\([^)]*access_token/.test(server), 'لا يُسجَّل أي رمز/سرّ في سجلات YouTube');
add('youtube-central-brain-tools', read('engine/agent/tools.ts').includes("id: 'youtube_publish'") && read('engine/agent/tools.ts').includes("id: 'youtube_analytics'") && read('engine/agent/tools.ts').includes("id: 'youtube_reply'"), 'العقل المركزي يملك أدوات YouTube الحقيقية (لا عقل ثانٍ)');
add('youtube-external-tools-approval', /id: 'youtube_reply'[\s\S]{0,400}?permission: 'EXTERNAL_ACTION'/.test(read('engine/agent/tools.ts')) && /id: 'youtube_publish'[\s\S]{0,400}?permission: 'EXTERNAL_ACTION'/.test(read('engine/agent/tools.ts')), 'أدوات الرد/الرفع خارجية وتتطلب موافقة صريحة (لا تنفيذ تلقائي)');
add('youtube-social-manager-real', youtubeRoutes.includes('fetchYouTubeComments') && youtubeRoutes.includes('fetchYouTubeAnalytics'), 'مدير السوشيال يربط YouTube بجلبه الحقيقي لا ببيانات داخلية');
add('youtube-dedicated-publish-route', /app\.post\("\/api\/platforms\/youtube\/publish"/.test(server) && server.indexOf('app.post("/api/platforms/youtube/publish"') < server.indexOf('app.post("/api/platforms/:platform/publish"'), 'مسار رفع YouTube المخصص مسجّل قبل المسار العام (لا يلتقطه العام)');
add('youtube-full-operation-tests', /12g\)/.test(read('engine/tests/youtube.connector.test.ts')) && /12i\)/.test(read('engine/tests/youtube.connector.test.ts')) && /4a\)/.test(read('engine/tests/youtube.connector.test.ts')), 'اختبارات الرفع/الجدولة/حارس النطاق/الحالة/التعلّم موجودة');

// -------------------------------------------------------------
// العقل المركزي (Central AI Agent)
// -------------------------------------------------------------
const agentOrch = read('engine/agent/orchestrator.ts');
const agentTools = read('engine/agent/tools.ts');
const agentPlanner = read('engine/agent/planner.ts');
const agentPerms = read('engine/agent/permissions.ts');
const agentRoutes = read('engine/agent/routes.ts');
const agentRouter = read('engine/agent/providerRouter.ts');
const agentTest = read('engine/tests/agent.central.test.ts');
const agentUi = read('src/components/agent/CentralAgentConsole.tsx');
add('agent-module-structure', ['engine/agent/orchestrator.ts', 'engine/agent/tools.ts', 'engine/agent/planner.ts', 'engine/agent/permissions.ts', 'engine/agent/routes.ts', 'engine/agent/providerRouter.ts'].every((f) => fs.existsSync(path.join(root, f))), 'طبقة العقل المركزي بوحداتها الست موجودة');
add('agent-uses-existing-ai-engine', agentRoutes.length > 0 && server.includes('aiEngine.run') && !read('engine/agent/orchestrator.ts').includes('@google/genai'), 'المحرك يعيد استخدام محرك AI القائم ولا ينشئ مزوّداً ثانياً');
add('agent-permission-levels', agentPerms.includes("'READ'") && agentPerms.includes("'WRITE'") && agentPerms.includes("'EXECUTE'") && agentPerms.includes("'EXTERNAL_ACTION'") && agentPerms.includes("'SENSITIVE'"), 'مستويات الصلاحية الخمسة معرّفة');
add('agent-no-external-from-task', agentOrch.includes("EXTERNAL_APPROVAL_REQUIRED") && agentPerms.includes('toolRequiresApproval'), 'الأدوات الخارجية محجوبة داخل المهمة ولا تُنفَّذ تلقائياً');
add('agent-rbac', agentPerms.includes("staff: ['READ', 'EXECUTE']") && agentPerms.includes("owner: ['READ', 'WRITE', 'EXECUTE', 'EXTERNAL_ACTION', 'SENSITIVE']"), 'فصل صلاحيات staff/owner صريح');
add('agent-planner-deterministic', agentPlanner.includes('classifyIntent') && agentPlanner.includes('requiresAi: false'), 'التخطيط حتمي محلي ولا يستهلك AI في العمليات الحتمية');
add('agent-idempotency', agentOrch.includes('findIdempotent') && agentRoutes.includes('duplicate: true'), 'منع التنفيذ المزدوج بمفتاح idempotency');
add('agent-execution-journal', agentOrch.includes('journal') && agentOrch.includes('AgentJournalEntry'), 'سجل تنفيذ مفصّل لكل خطوة');
add('agent-failure-recovery', agentOrch.includes('maxAttempts') && agentOrch.includes('attemptsAllowed'), 'إعادة محاولة محدودة للأخطاء القابلة للإصلاح');
add('agent-step-timeout', agentOrch.includes('withTimeout') && agentOrch.includes('TIMEOUT'), 'مهلة لكل خطوة تمنع الحلقة المعلّقة');
add('agent-no-secret-in-context', agentOrch.includes('sanitizeContext') && agentOrch.includes('SECRET_KEY_RE'), 'إسقاط أي سرّ من لقطة السياق قبل الحفظ');
add('agent-verified-flag', agentOrch.includes('task.verified') && agentOrch.includes('anyOk'), 'التحقق النهائي مبني على نجاح خطوات فعلية لا على ادّعاء');
add('agent-router-council', agentRouter.includes('PROVIDER_CATALOG') && agentRouter.includes('shouldUseCouncil') && agentRouter.includes('COUNCIL_PIPELINE'), 'موجّه المزوّدين وأساس AI Council موجودان');
add('agent-no-fake-provider', agentRouter.includes('configured') && !/(sk-[A-Za-z0-9]{20,}|AIzaSy[A-Za-z0-9_\-]{10,})/.test(agentRouter), 'لا مفاتيح وهمية ولا مزوّد غير مضبوط يُدّعى');
add('agent-endpoints', server.includes('registerAgentRoutes') && agentRoutes.includes("app.post('/api/agent/tasks'") && agentRoutes.includes("app.get('/api/agent/tasks/:id'") && agentRoutes.includes("app.get('/api/agent/health'") && agentRoutes.includes("app.get('/api/agent/tools'") && agentRoutes.includes("app.get('/api/agent/providers'"), 'مسارات العقل المركزي مسجّلة');
add('agent-endpoints-authz', (agentRoutes.match(/authenticateToken/g) || []).length >= 5, 'كل مسارات العقل محمية بالمصادقة');
add('agent-persistence', server.includes('STORAGE_KEY_AGENT') && server.includes('loadAgentStateSync') && server.includes('saveAgentState'), 'سجل مهام العقل يُحفظ ويُسترجع (يصمد بعد إعادة التشغيل)');
add('agent-execution-reuses-gates', server.includes('executeApprovedJob') && server.includes('agentJobExecutor'), 'التنفيذ الخارجي يمر بنفس بوابات النشر');
add('agent-health-exposed', server.includes('centralAgent:') && server.includes('describeProvidersForHealth'), 'حالة العقل معروضة في /api/health بلا أسرار');
add('agent-ui-console', agentUi.includes('agentCreateTask') && agentUi.includes('agentReplay') && agentUi.includes('سجل المهام السابقة'), 'واجهة العقل المركزي (إرسال + حالة + سجل + أدوات)');
add('agent-ui-no-fake-success', agentUi.includes("res.task") && !/fake success|نجاح وهمي/.test(agentUi), 'الواجهة تعرض نتيجة الخادم الفعلية لا نجاحاً محلياً');
add('agent-nav-entry', app.includes('central_agent') && read('src/components/common/Sidebar.tsx').includes("id: 'central_agent'"), 'تبويب العقل المركزي في الواجهة');
add('agent-test-script', pkg.scripts['test:agent'] === 'tsx engine/tests/agent.central.test.ts', 'سكربت اختبار العقل مضاف إلى package.json');
add('agent-tests-cover-critical', ['idempotency', 'PERMISSION_DENIED', 'TIMEOUT', 'restore'].every((k) => agentTest.includes(k)) && agentTest.includes('job_execute') && (agentTest.includes('clientSecret') || agentTest.includes('sanitize')), 'اختبارات العقل تغطي idempotency/RBAC/مهلة/أمان/دوام');
// --- العقل المركزي: تمرير بيانات بين الخطوات وجلب تعليقات YouTube الحقيقية ---
add('agent-output-passing-refs', agentPlanner.includes('AgentArgRef') && agentOrch.includes('resolveArgValue') && agentOrch.includes('outputs[stepDef.toolId]'), 'المنسّق يمرّر مخرَجات الخطوات السابقة عبر مراجع محسوبة وقت التنفيذ');
add('agent-no-fabricated-id', /function resolveArgValue[\s\S]{0,700}?return undefined/.test(agentOrch) && agentPlanner.includes("pick: 'all'"), 'المرجع يُعيد undefined عند غياب البيانات (لا معرّف مُختلق)');
add('planner-youtube-comments-explicit', agentPlanner.includes('wantsYouTubeComments') && /wantsComments[\s\S]{0,400}?youtube_comments/.test(agentPlanner), 'خطة YouTube تضيف مسار التعليقات فقط عند طلب صريح');
add('planner-youtube-no-comments-default', /const wantsComments = wantsYouTubeComments\(task\)/.test(agentPlanner), 'طلب YouTube العام لا يجلب التعليقات افتراضياً (توفير استدعاءات API)');
add('youtube-comments-tool-real-data', /id: 'youtube_comments'[\s\S]{0,1600}?latestComment:/.test(agentTools), 'أداة youtube_comments تُعيد أحدث تعليق حقيقي ومعرّفه للتحليل التالي');
add('youtube-videos-tool-latest-id', /id: 'youtube_videos'[\s\S]{0,900}?latestVideoId/.test(agentTools), 'أداة youtube_videos تُعلن أحدث معرّف فيديو حقيقي ناتج من playlistItems+videos');
const youtubeModuleSrc = read('engine/social/youtube.ts');
add('youtube-comment-scan-bounded', youtubeModuleSrc.includes('YOUTUBE_COMMENT_SCAN_VIDEO_LIMIT') && server.includes('slice(0, commentScanVideoLimitFromEnv())'), 'حدّ لف عدد الفيديوهات المفحوصة (افتراضي ثابت + قابل للضبط بحدّ أقصى) يمنع استهلاكاً غير محدود للـAPI');
add('youtube-comments-multi-video', /for \(const videoId of scannedVideoIds\)/.test(server) && server.includes('order=time'), 'قراءة التعليقات تفحص مجموعة أحدث الفيديوهات مرتّبة زمنياً لا فيديو واحداً');
add('youtube-comments-latest-by-time', /all\.sort\(\(a, b\) => String\(b\.publishedAt/.test(server), 'أحدث تعليق فعلي يُختار بترتيب زمني تنازلي حقيقي');
const youtubeTest = read('engine/tests/youtube.connector.test.ts');
add('agent-youtube-comments-e2e-test', youtubeTest.includes('commentThreads') && youtubeTest.includes('lastCommentsVideoId') && youtubeTest.includes('/api/agent/tasks'), 'اختبار تكامل يثبت العقل → youtubeVideos → videoId → youtubeComments → commentThreads.list');
add('agent-youtube-comment-non-first-video-test', youtubeTest.includes('cmt_late') && youtubeTest.includes('videos[1]'), 'اختبار يثبت الوصول لتعليق موجود على فيديو غير أول فيديو');
add('agent-youtube-comments-no-external', agentTest.includes('youtube_comments') && agentTest.includes('EXTERNAL_ACTION'), 'اختبارات العقل تثبت التعليقات قراءة والرد يبقى خارجياً بموافقة');
// --- إصلاح: مخرَج الخطوات يُحفظ في result.data + نص التعليق يصل لـai_draft + الواجهة تعرضه ---
add('agent-result-data-carries-output', /data:\s*journal\.map\(\(e\)\s*=>\s*\([\s\S]{0,220}?output:/.test(agentOrch), 'task.result.data يحمل مخرَج كل خطوة لا ملخّصها فقط');
add('agent-sanitize-output-exists', /function sanitizeOutput/.test(agentOrch) && agentOrch.includes('MAX_OUTPUT_DEPTH') && agentOrch.includes('MAX_OUTPUT_ARRAY'), 'sanitizeOutput موجود فعلاً بحدود حجم/عمق ويُسقط المفاتيح السرّية');
add('agent-sanitize-output-used', agentOrch.includes('sanitizeOutput(outputs[') , 'المنسّق يستخدم sanitizeOutput على مخرَجات الخطوات قبل الحفظ');
add('planner-comments-feed-ai-draft', /step\('ai_draft'[\s\S]{0,200}?fromTool: 'youtube_comments'[\s\S]{0,80}?mode: 'list'/.test(agentPlanner), 'خطوة ai_draft تستلم تعليقات حقيقية من youtube_comments.comments (لا نص المهمة)');
add('argref-list-mode', agentPlanner.includes("mode?: 'first' | 'all' | 'list'") && agentOrch.includes("arg.mode === 'list'"), 'آلية AgentArgRef موسّعة بوضع list لتمرير عناصر حقيقية كاملة');
add('ai-draft-analyzes-comments', agentTools.includes('normalizeCommentsInput') && agentTools.includes('analyzeCommentInput') && agentTools.includes('classifyComment') && agentTools.includes('buildDeterministicReply'), 'ai_draft يصنّف التعليق ويحدّد المشاعر ويقترح رداً حتمياً');
add('ai-draft-no-auto-send', /willAutoSend:\s*false/.test(agentTools), 'ai_draft يعلن willAutoSend:false صراحةً (لا إرسال)');
add('ai-draft-deterministic-not-blocked', agentTools.includes('kind: \'comment_analysis\''), 'تحليل التعليقات حتمي ولا يعتمد على مزوّد AI قد يفشل');
add('console-reads-result-data', agentUi.includes('task.result.data') && agentUi.includes('CommentAnalysisPanel'), 'CentralAgentConsole يقرأ result.data ويعرض لوحة تحليل التعليقات');
add('console-comment-fields', ['latestComment', 'typeAr', 'sentimentAr', 'iraqiSuggestedReply'].every((k) => agentUi.includes(k)) && agentUi.includes('لم يُرسل'), 'الواجهة تعرض النص والنوع والمشاعر والرد العراقي ووسم «لم يُرسل»');
add('console-video-title-optional', agentUi.includes('videoTitle') && agentUi.includes("toolId === 'youtube_videos'"), 'الواجهة تعرض اسم الفيديو إن توفّر (من مخرج youtube_videos الحقيقي)');
add('console-no-secret-display', !/(apiKey|accessToken|clientSecret)/.test(agentUi), 'الواجهة لا تعرض أي سرّ/توكن');
add('agent-output-passing-tests', agentTest.includes('result.data[youtube_comments].output') && agentTest.includes('willAutoSend') && agentTest.includes('iraqiSuggestedReply'), 'اختبارات تثبت وصول نص التعليق والتحليل إلى result.data.output');
add('agent-ui-real-data-test', agentTest.includes('CommentAnalysisPanel') && agentTest.includes('task.result.data'), 'اختبار يثبت أن الواجهة تقرأ المخرجات الفعلية من result.data');

// -------------------------------------------------------------
// تفويض تشغيل YouTube (من المالك إلى العقل المركزي) + دورة حياة الرد
// -------------------------------------------------------------
const ytDelegation = read('engine/social/youtubeDelegation.ts');
const ytModuleSrc = read('engine/social/youtube.ts');
const pcc = read('src/components/social/PlatformConnectionCenter.tsx');
add('youtube-delegation-module', fs.existsSync(path.join(root, 'engine/social/youtubeDelegation.ts')) && ytDelegation.includes('evaluateYouTubeDelegation') && ytDelegation.includes('buildYouTubeDelegation'), 'وحدة تفويض تشغيل YouTube موجودة بمنح/إيقاف/تقييم');
add('youtube-delegation-scope-only', ytDelegation.includes("YOUTUBE_DELEGATION_SCOPE = 'youtube'") && ytDelegation.includes("String(raw.scope || YOUTUBE_DELEGATION_SCOPE) === YOUTUBE_DELEGATION_SCOPE"), 'التفويض محصور بنطاق YouTube فقط (لا يمنح أي منصة أخرى)');
add('youtube-delegation-owner-only', ytDelegation.includes("input.operator !== 'owner' && input.operator !== 'system'") && ytDelegation.includes('DELEGATION_OPERATOR_NOT_OWNER'), 'المالك والعقل المركزي (system) ينفّذان التفويض؛ المشغّل staff ممنوع');
add('youtube-delegation-no-default-grant', ytDelegation.includes('granted: false') && ytDelegation.includes('defaultYouTubeDelegation'), 'لا تفويض افتراضي: يبدأ غير ممنوح حتى قرار المالك');
add('youtube-delegation-schedule-needs-both', ytDelegation.includes('requiredDelegationActions') && /return \['publish', 'schedule'\]/.test(ytDelegation), 'النشر المجدول يحتاج publish+schedule معاً (لا جدولة غير مفوّضة)');
add('youtube-delegation-tool-map', ytDelegation.includes("youtube_reply: 'reply'") && ytDelegation.includes("youtube_publish: 'publish'") && ytDelegation.includes("youtube_video_update: 'update_video'"), 'خريطة الأداة→العملية مصدر واحد للتفويض');
add('orchestrator-delegation-gate', agentOrch.includes('delegationCheck') && agentOrch.includes('DELEGATION_NOT_GRANTED') && agentOrch.includes("task.status = 'waiting'"), 'المنسّق يسمح بالتنفيذ الخارجي فقط عبر تقييم التفويض المحقون، وإلا ينتظر');
add('orchestrator-external-failure-halts', agentOrch.includes("tool.permission === 'EXTERNAL_ACTION'") && /!result\.ok[\s\S]{0,200}?EXTERNAL_ACTION/.test(agentOrch), 'فشل أداة خارجية مفوّضة يوقف المهمة بحالة failed (لا تجاهل)');
add('server-delegation-endpoints', server.includes('"/api/platforms/youtube/delegation"') && /app\.post\("\/api\/platforms\/youtube\/delegation"[\s\S]{0,200}?requireOwner/.test(server) && /app\.delete\("\/api\/platforms\/youtube\/delegation"[\s\S]{0,200}?requireOwner/.test(server), 'مسارات منح/إيقاف التفويض محمية بالمالك');
add('server-delegation-persisted', server.includes('youtubeDelegation: youtubeDelegationState') && server.includes('normalizeYouTubeDelegation(control.youtubeDelegation)'), 'التفويض يُحفظ ويُسترجع (يصمد بعد إعادة التشغيل/cold start)');
add('server-delegation-health', server.includes('youtubeDelegation: youtubeDelegationBlock()'), 'حالة التفويض معروضة في /api/health و/readiness بلا سرّ');
add('server-delegation-audit', server.includes('youtube_delegation_granted') && server.includes('youtube_delegation_revoked'), 'منح/إيقاف التفويض مسجّلان في التدقيق');
add('youtube-reply-lifecycle-module', ytModuleSrc.includes('resolveYouTubeReplyState') && ytModuleSrc.includes("'draft' | 'approved' | 'sent' | 'failed'"), 'دورة حياة الرد (draft/approved/sent/failed) معرّفة كمصدر واحد');
add('youtube-reply-no-sent-without-id', /if \(input\.delivered && input\.externalReplyId\) return 'sent'/.test(ytModuleSrc), 'لا حالة sent بلا معرّف رد حقيقي من YouTube');
add('server-reply-uses-lifecycle', server.includes('resolveYouTubeReplyState(') && server.includes('YOUTUBE_REPLY_LIFECYCLE_LABELS_AR'), 'مسار الرد الحقيقي يسجّل دورة الحياة الصريحة');
add('youtube-shared-reply-executor', server.includes('async function executeYouTubeReply(') && /executeYouTubeReply\(\{ commentId/.test(server) && /youtubeReply: async[\s\S]{0,300}?executeYouTubeReply/.test(server), 'الرد الحقيقي منفّذ واحد يمرّ بكل البوابات (المسار الخارجي والعقل معاً — لا تجاوز)');
add('youtube-shared-publish-executor', server.includes('async function executeYouTubePublish(') && /executeYouTubePublish\(\{/.test(server) && /youtubePublish: async[\s\S]{0,400}?executeYouTubePublish/.test(server), 'الرفع الحقيقي منفّذ واحد يمرّ بكل البوابات (لا تجاوز للسلامة/idempotency/rate limit)');
add('youtube-video-update-tool', agentTools.includes("id: 'youtube_video_update'") && /youtubeVideoUpdate: async/.test(server), 'أداة تحديث بيانات فيديو YouTube منفّذة ومربوطة بالخادم');
add('youtube-delegation-no-secret', !/(accessToken|refreshToken|clientSecret|GEMINI_API_KEY|apiKey)/.test(ytDelegation) && !/(accessToken|clientSecret)/.test(read('engine/social/youtubeDelegation.ts')), 'وحدة التفويض بلا أي سرّ/توكن');
add('youtube-delegation-ui', pcc.includes('YouTubeDelegationPanel') && pcc.includes('grantYouTubeDelegation') && pcc.includes('revokeYouTubeDelegation'), 'لوحة منح/إيقاف تفويض YouTube في مركز ربط المنصات');
add('agent-console-delegation-badge', agentUi.includes('getYouTubeDelegation') && agentUi.includes('تفويض YouTube'), 'واجهة العقل المركزي تعرض حالة تفويض YouTube');
add('youtube-delegation-api-client', read('src/services/api.ts').includes('grantYouTubeDelegation') && read('src/services/api.ts').includes('revokeYouTubeDelegation') && read('src/services/api.ts').includes('getYouTubeDelegation'), 'طبقة API تحمل مسارات التفويض الثلاثة');
add('youtube-delegation-tests', youtubeTest.includes('12k-2') && youtubeTest.includes('DELEGATION') && youtubeTest.includes('youtube/delegation'), 'اختبار تكامل يثبت منح التفويض ثم تنفيذ رد حقيقي ثم الحجب بعد الإيقاف');
add('agent-delegation-tests', agentTest.includes('evaluateYouTubeDelegation') && agentTest.includes('DELEGATION_ACTION_NOT_GRANTED') && agentTest.includes('resolveYouTubeReplyState'), 'اختبارات وحدة للتفويض ودورة حياة الرد');
add('agent-delegation-gate-tests', agentTest.includes('delegationCheck') && agentTest.includes('DELEGATION_NOT_GRANTED') && agentTest.includes('c1'), 'اختبارات المنطوق: بلا تفويض يُحجب، ومع التفويض تُنفَّذ بقيم سياق حقيقية');

// -------------------------------------------------------------
// دورة YouTube الكاملة في العقل المركزي: قراءة تعليق حقيقي → تحليل → اقتراح → إرسال → تحقق
// -------------------------------------------------------------
add('youtube-cycle-intent', agentPlanner.includes('youtube_cycle') && agentPlanner.includes('wantsYouTubeFullCycle'), 'نية الدورة الكاملة (youtube_cycle) معرّفة ومكتشفة حتمياً من نص المهمة');
add('youtube-cycle-plan-order', (() => {
  const i = agentPlanner.indexOf("case 'youtube_cycle'");
  if (i < 0) return false;
  const seg = agentPlanner.slice(i, i + 2600);
  const order = ['youtube_status', 'youtube_videos', 'youtube_comments', 'ai_draft', 'youtube_reply', 'youtube_reply_verify'].map((t) => seg.indexOf(`step('${t}'`));
  return order.every((p, k) => p >= 0) && order.every((p, k) => k === 0 || p > order[k - 1]);
})(), 'الخطة الحقيقية مرتبة: status → videos → comments → ai_draft → reply → verify');
add('argref-nested-output-path', agentPlanner.includes('outputPath?: string') && agentOrch.includes("arg.outputPath && !arg.listPath"), 'آلية AgentArgRef موسّعة بمسار متداخل لتمرير latestComment.commentId وlatestAnalysis.iraqiSuggestedReply');
add('youtube-cycle-real-commentid', /commentId:\s*\{\s*fromTool:\s*'youtube_comments',\s*outputPath:\s*'latestComment',\s*field:\s*'commentId'/.test(agentPlanner), 'يوتيوب الرد يحصل على commentId حقيقي من مخرَج youtube_comments (لا اختلاق)');
add('youtube-cycle-real-replytext', /text:\s*\{\s*fromTool:\s*'ai_draft',\s*outputPath:\s*'latestAnalysis',\s*field:\s*'iraqiSuggestedReply'/.test(agentPlanner), 'يوتيوب الرد يحصل على نص الرد المقترح من مخرَج ai_draft (لا اختلاق)');
add('youtube-cycle-reply-external', /case 'youtube_cycle'[\s\S]{0,2600}?reason:\s*'الرد الإرسالي عملية خارجية/.test(agentPlanner) && /id: 'youtube_reply'[\s\S]{0,400}?permission: 'EXTERNAL_ACTION'/.test(agentTools), 'الرد يبقى خاضعاً لبوابة التفويض (EXTERNAL_ACTION)');
add('youtube-reply-verify-tool', agentTools.includes("id: 'youtube_reply_verify'") && /youtubeReplyVerify: async/.test(server), 'أداة التحقق youtube_reply_verify (قراءة) مربوطة بالخادم من سجل الردود الفعلي');
add('youtube-reply-verify-read-only', /id: 'youtube_reply_verify'[\s\S]{0,400}?permission: 'READ'/.test(agentTools), 'التحقق قراءة فقط لا ينفّذ عملية خارجية');
add('youtube-reply-honest-delivery', /PROVIDER_NO_REPLY_ID/.test(server) && /delivered === true && Boolean\(result\.body\?\.externalReplyId\)/.test(server), 'لا تسليم بلا معرّف رد حقيقي من YouTube (لا delivered=true مُختلق)');
add('youtube-reply-tool-honest', /REPLY_NOT_DELIVERED/.test(agentTools), 'أداة الرد ترفض النجاح بلا معرّف رد حقيقي');
add('youtube-cycle-test-unit', agentTest.includes('youtube_cycle') && agentTest.includes('latestComment') && agentTest.includes('iraqiSuggestedReply') && agentTest.includes('wantsYouTubeFullCycle'), 'اختبارات وحدة تثبت تمرير commentId/نص الرد الحقيقيين ومنع الإرسال بلا قيم');
add('youtube-cycle-test-integration', youtubeTest.includes('12k-3') && youtubeTest.includes('cmt_cycle') && youtubeTest.includes("startsWith('DELEGATION')"), 'اختبار تكامل يثبت الدورة الكاملة بمعرّف تعليق/رد حقيقيين ثم الحجب بلا تفويض');
add('youtube-cycle-no-side-channel', /externalTools\.join\(','\) === 'job_execute,youtube_publish,youtube_reply,youtube_video_update'/.test(agentTest), 'اختبار يثبت حصر أدوات التنفيذ الخارجي (لا مسار إرسال جانبي)');
add('agent-console-delivery-state', agentUi.includes('deliveredReal') && agentUi.includes('externalReplyId') && agentUi.includes('youtube_reply_verify'), 'الواجهة تعرض نتيجة التسليم الحقيقية (معرّف رد + مُتحقَّق) من الخادم');

// -------------------------------------------------------------
// انحدار: طلب الدورة الكاملة لا يُختزل إلى «تحقق» — ترتيب التصنيف + مرادفات الأفعال
// -------------------------------------------------------------
add('youtube-cycle-before-verify', (() => {
  const i = agentPlanner.indexOf('export function classifyIntent');
  const seg = agentPlanner.slice(i, i + 1500);
  const pCycle = seg.indexOf("return 'youtube_cycle'");
  const pVerify = seg.indexOf("if (VERIFY_RE.test(task)) return 'verification'");
  return pCycle >= 0 && pVerify >= 0 && pCycle < pVerify;
})(), 'الدورة الكاملة تُفحص قبل VERIFY_RE فلا يُختزل طلب «تحقق من وصول الرد» إلى مهمة تحقق');
add('youtube-cycle-synonyms', agentPlanner.includes('YT_GEN_VERB') && agentPlanner.includes('YT_SEND_VERB') && /ولّد/.test(agentPlanner) && /نفّذ/.test(agentPlanner), 'مرادفات التوليد (ولّد/صيغ/أنشئ) والإرسال (أرسل/نفّذ/ابعث) معرّفة كمصدر واحد');
add('youtube-cycle-platform-agnostic', agentPlanner.includes('wantsYouTubeCommentCycle') && agentPlanner.includes('YOUTUBE_READ_CYCLE_RE'), 'دورة كاملة بلا ذكر المنصة تُوجَّه للدورة الكاملة لا للقراءة/التحقق');
add('youtube-cycle-owner-phrase-test', agentTest.includes('صياغة المالك => youtube_cycle') && agentTest.includes('ولّد') && agentTest.includes('نفّذ'), 'اختبار انحدار يثبت صياغة المالك الفعلية (ولّد/نفّذ/تحقق) => youtube_cycle');
add('youtube-cycle-no-missing-arg-regression', agentTest.includes("seenReplyArgs?.commentId === 'rc1'") && agentTest.includes('iraqiSuggestedReply') && agentTest.includes('replyCalledNoComment') && agentTest.includes('replyCalledNoText'), 'اختبار يمنع رجوع MISSING_ARGUMENT: commentId/نص الرد يُمرَّران من المخرَجات الحقيقية');

// -------------------------------------------------------------
// YouTube 24/7 Autonomous Operations Manager (مدير تشغيل YouTube)
// -------------------------------------------------------------
const watcherModule = read('engine/social/youtubeWatcher.ts');
const watcherTest = read('engine/tests/youtube.watcher.test.ts');
const watcherUi = read('src/components/agent/YouTubeOperationsView.tsx');
add('youtube-watcher-module', watcherModule.includes('defaultWatcherControls') && watcherModule.includes('watcherGate') && watcherModule.includes('decideCommentAction') && watcherModule.includes('computeCommentVelocity') && watcherModule.includes('buildDailyBrief'), 'وحدة مدير تشغيل YouTube (منطق خالص: تحكم/بوابة/قرار/زخم/تقرير) موجودة');
add('youtube-watcher-safe-default', watcherModule.includes('autoReply: false') && watcherModule.includes('autoPublish: false') && watcherModule.includes("return { enabled: true, autoReply: false"), 'الأتمتة آمنة افتراضياً: الرد/النشر/الجدولة معطّلة حتى يمكّنها المالك');
add('youtube-watcher-kill-switch', watcherModule.includes('paused') && watcherModule.includes('AUTOMATION_PAUSED') && watcherModule.includes('killSwitchActive'), 'Kill Switch يوقف كل الإرسال فوراً مع إبقاء القراءة/التحليل');
add('youtube-watcher-lifecycle', watcherModule.includes('YOUTUBE_COMMENT_STAGES') && watcherModule.includes("'ESCALATED'") && watcherModule.includes("'VERIFIED'"), 'دورة حياة التعليق (NEW→…→REPLIED→VERIFIED + SKIPPED/ESCALATED/FAILED) معرّفة');
add('youtube-watcher-escalation', watcherModule.includes("input.intent === 'business_inquiry'") && watcherModule.includes("input.intent === 'complaint' || input.requiresHumanReview") && watcherModule.includes('يحتاج بيانات المنتج المؤكدة'), 'الشكاوى/الاستفسارات التجارية/الحساسة تُصعَّد للمالك بسبب حقيقي مرتبط بالمضمون (لا تصعيد كاذب للتفاعل الإيجابي)');
add('youtube-watcher-no-fake-data', watcherModule.includes('sampleSize') && watcherModule.includes('sampleNotes') && watcherModule.includes("= 'insufficient'"), 'لا اختراع أرقام: حجم العيّنة والقيود تُعلن، والاتجاه لا يُعلن بلا عيّنة كافية');
add('youtube-watcher-cadence-1min-default', watcherModule.includes('WATCHER_DEFAULT_CADENCE_MS = 60 * 1000') && watcherModule.includes('WATCHER_MIN_CADENCE_MS = 60 * 1000'), 'الإيقاع الافتراضي دقيقة واحدة (60,000ms) والحد الأدنى دقيقة — مراقبة 24/7 بدون polling عدواني');
add('youtube-watcher-peak-hours-honest', watcherModule.includes('computePeakHours') && watcherModule.includes('total >= 6') && watcherModule.includes('peakHour: number | null = null'), 'وقت الذروة لا يُعلن بلا عيّنة كافية (≥6 تعليقات حقيقية)');
add('youtube-watcher-velocity-real-published', watcherModule.includes('publishedAt') && server.includes('computeCommentVelocity(processed.map((p) => p.publishedAt || p.at)') && server.includes('publishedAt: c.publishedAt ?? null'), 'الزخم وأوقات الذروة من publishedAt الحقيقي لا من وقت المعالجة');
add('youtube-watcher-ui-counters', watcherUi.includes('counters?.detected') && watcherUi.includes('counters?.replied') && watcherUi.includes('counters?.escalated') && watcherUi.includes('counters?.skipped') && watcherUi.includes('Running') && watcherUi.includes('Paused'), 'الواجهة تعرض بوضوح: يعمل/موقوف، المكتشفة، الردود، التصعيدات، التجاهلات، الأخطاء');
add('youtube-watcher-worker-in-process', server.includes('function startYouTubeWatcher') && server.includes('watcherScheduler = createWatcherScheduler') && server.includes('startYouTubeWatcher();'), 'حلقة المراقبة تعمل داخل عملية الخادم الدائمة (مستقلة عن المتصفح)');
add('youtube-watcher-cycle-real-executor', /executeYouTubeReply\(\{ commentId: String\(c\.commentId\)[\s\S]{0,220}?productId:[\s\S]{0,120}?\}, "watcher"\)/.test(server), 'دورة المراقبة تنفّذ الرد عبر منفّذ الرد الحقيقي الموحّد (لا مسار جانبي)');
add('youtube-watcher-delegation-gated', server.includes('watcherReplyExecutionReady') && server.includes('youtubeDelegationCheck') && server.includes('DELEGATION_REQUIRED'), 'الرد الآلي محجوب بلا تفويض فعّال (delegation gate محفوظ)');
add('youtube-watcher-double-gate', server.includes('const replyGate = watcherGate(controls, "reply")') && server.includes('if (!replyReady.ready || !replyGateFinal.allowed)'), 'فرض مزدوج: بوابة الأتمتة تُعاد فحصها عند نقطة التنفيذ نفسها (لا تجاوز)');
add('youtube-watcher-no-fake-arg', !/commentId:\s*"[a-zA-Z0-9_-]+"/.test(server.slice(server.indexOf('async function runYouTubeWatcherCycle'), server.indexOf('function startYouTubeWatcher'))), 'لا معرّف تعليق مُختلق في دورة المراقبة (commentId يأتي من YouTube فقط)');
add('youtube-watcher-honest-delivery', server.includes("const delivered = Boolean(result.body?.delivered && result.body?.externalReplyId);") && server.includes("baseEntry.stage = \"REPLIED\""), 'لا يُسجَّل رد مُسلَّم بلا معرّف رد حقيقي من YouTube');
add('youtube-watcher-durable-state', server.includes('WATCHER_STATE_KEY') && server.includes('persistWatcherState') && server.includes('applyWatcherStateSnapshot') && server.includes('storageAdapter.read<any>(WATCHER_STATE_KEY)') && server.includes('storageAdapter.readSync<any>(WATCHER_STATE_KEY)'), 'حالة المراقبة تُحفظ/تُسترجع عبر المحوّل فتصمد بعد restart/deploy');
add('youtube-watcher-owner-controls', server.includes('/api/agent/youtube/watcher/controls') && server.includes('requireOwner') && server.includes('/api/agent/youtube/watcher/poll') && server.includes('/api/agent/youtube/watcher/brief'), 'مسارات التحكم/التشغيل/التقرير للمالك فقط');
add('youtube-watcher-health-block', server.includes('youtubeWatcher: watcherStatusBlockPublic()') && !server.includes('youtubeWatcher: watcherStatusBlock()'), 'حالة مدير YouTube تُعلن في /api/health و/api/readiness بنسخة عامة آمنة فقط (بلا بيانات عميل)');
add('youtube-watcher-health-public-safe', (() => {
  const start = server.indexOf('function watcherStatusBlockPublic');
  const end = server.indexOf('/** تقرير YouTube اليومي');
  if (start < 0 || end < 0 || end <= start) return false;
  const publicBlock = server.slice(start, end);
  const healthUsesPublic = (server.match(/youtubeWatcher: watcherStatusBlockPublic\(\)/g) || []).length === 2;
  const publicHasNoCustomer = !/attentionRequired|replyText|authorName|lastReply/.test(publicBlock);
  return healthUsesPublic && publicHasNoCustomer;
})(), 'الصحة والجاهزية تستخدمان النسخة العامة في الموضعين، والنسخة العامة لا تحوي اسم حساب/نص تعليق/نص رد');
add('youtube-watcher-detail-owner-auth', server.includes('app.get("/api/agent/youtube/watcher", requireOwner') && server.includes('watcher: watcherStatusBlock()'), 'التفاصيل الكاملة (attentionRequired/lastReply) تُقدَّم فقط عبر المسار المقتصر على المالك /api/agent/youtube/watcher');
// كل مسارات بيانات المراقب (التي تحمل اسم حساب/نص تعليق/نص رد) مقتصرة على المالك،
// لا مجرّد مصادقة: بيانات عملاء YouTube لا يجوز أن تصل لأي مستخدم مسجَّل بلا دور مالك.
add('youtube-watcher-data-owner-only', (() => {
  const routes = [
    'app.get("/api/agent/youtube/watcher", requireOwner',
    'app.get("/api/agent/youtube/watcher/brief", requireOwner',
    'app.get("/api/agent/youtube/watcher/details", requireOwner',
    'app.get("/api/agent/youtube/watcher/comment/:commentId", requireOwner',
    'app.get("/api/agent/youtube/watcher/audit", requireOwner',
    'app.post("/api/agent/youtube/watcher/review", requireOwner',
  ];
  const allOwner = routes.every((r) => server.includes(r));
  // لا مسار بيانات مراقب يستخدم authenticateToken وحده (لا دور).
  const leakyData = /app\.get\("\/api\/agent\/youtube\/watcher(?:\/brief|\/details|\/audit|\/comment\/:commentId)?"\s*,\s*authenticateToken/.test(server);
  return allOwner && !leakyData;
})(), 'مسارات بيانات المراقب (الحالة/التقرير/التفاصيل/التعليق/السجل) مقتصرة على المالك (requireOwner) لا مجرّد مصادقة');
add('youtube-watcher-public-error-sanitized', server.includes('function watcherPublicError') && server.includes("'connection error'"), 'آخر خطأ في النقطة العامة يُقتصر على رمز تقني ASCII أو رسالة عامة ثابتة (لا محتوى عميل)');
// حارس خصوصية النقطتين العامتين: اختبار حقيقي يزرع canary ويقرأ الاستجابات الفعلية.
const healthPrivacyTest = fs.existsSync(path.join(root, 'engine/tests/health.privacy.test.ts')) ? read('engine/tests/health.privacy.test.ts') : '';
add('health-privacy-test-registered', (pkg.scripts['test'] || '').includes('test:health-privacy') && pkg.scripts['test:health-privacy'] === 'tsx engine/tests/health.privacy.test.ts', 'اختبار خصوصية /api/health و/api/readiness مسجّل ضمن npm test');
add('health-privacy-canary-live', healthPrivacyTest.includes('PRIVACY_CANARY_AUTHOR_ZZZ') && healthPrivacyTest.includes('PRIVACY_CANARY_COMMENT_TEXT_ZZZ') && healthPrivacyTest.includes('PRIVACY_CANARY_REPLY_TEXT_ZZZ') && healthPrivacyTest.includes('hasLeak(health)'), 'اختبار يزرع canary (اسم/نص تعليق/نص رد) ويتحقق أن الاستجابة العامة لا تكشفه');
add('health-privacy-field-allowlist', healthPrivacyTest.includes('ALLOWED_WATCHER_PUBLIC_KEYS') && healthPrivacyTest.includes('FORBIDDEN_CUSTOMER_FIELDS') && healthPrivacyTest.includes('watcherPublicExtra'), 'حارس allow-list صارم للكتلة العامة + قائمة حقول عميل ممنوعة (يمنع رجوع أي حقل حسّاس جديد)');
add('health-privacy-detail-owner-only', healthPrivacyTest.includes('/api/agent/youtube/watcher') && healthPrivacyTest.includes('owner.watcher?.attentionRequired?.[0]?.text === LEAK_COMMENT') && healthPrivacyTest.includes('lastReply?.replyText === LEAK_REPLY'), 'البيانات التفصيلية تبقى متاحة للمالك عبر المسار المحمي (لا حذف من النظام)');

// ------------------------------------------------------------
// Point 5 — pollCount محسوم تقنياً: مؤشر liveness (عدّاد دورات الفحص الناجحة + طابع
// آخر دورة) يُعلن في العامتين، وليس عدّاداً تجارياً. يمنع هذا الحارس أي إعادة تعريف
// غامضة أو إعادة إدراجه في قائمة الحقول الممنوعة، ويضمن بقاء توثيق معناه.
// ------------------------------------------------------------
add('pollcount-exposed-as-technical-metric',
  /function watcherStatusBlockPublic\(\)[\s\S]{0,1400}?pollCount: full\.pollCount/.test(server) &&
  /function watcherStatusBlockPublic\(\)[\s\S]{0,1600}?lastPollAt: full\.lastPollAt/.test(server) &&
  server.includes('pollCount: watcherState.pollCount'),
  'pollCount/lastPollAt يُعلنان في الكتلة العامة كمؤشر تقني (liveness) من مصدر الحالة الواحد');
add('pollcount-semantics-documented',
  server.includes('عدّاد تقني تراكمي لعدد دورات الفحص **الناجحة**') &&
  read('AGENTS.md').includes('pollCount'),
  'معنى pollCount موثّق في الكود وفي AGENTS.md (مؤشر تقني لا تجاري)');
add('pollcount-not-forbidden-leak',
  healthPrivacyTest.includes("'pollCount', 'lastPollAt'") &&
  !/FORBIDDEN_OPERATIONAL_DETAIL_FIELDS\s*=\s*\[[\s\S]*?'pollCount'/.test(healthPrivacyTest),
  'pollCount مُستثنى عن قصد من قائمة الحقول الممنوعة (مؤشر تقني لا تسريب)');

// ------------------------------------------------------------
// Point 3 — /api/workspace/snapshot Least-Privilege: الهوية التنظيمية للحسابات (اسم/
// معرّف/آخر مزامنة) للمالك فقط؛ أي دور آخر يرى الحالة التقنية فقط.
// ------------------------------------------------------------
add('workspace-snapshot-least-privilege',
  server.includes('function snapshotConnection(platform: string, isOwner: boolean)') &&
  /snapshotConnection\(p\.id, isOwner\)/.test(server) &&
  /app\.get\("\/api\/workspace\/snapshot", authenticateToken[\s\S]{0,300}?role === "owner"/.test(server) &&
  // غير المالك لا يحصل على الحقول الحسّاسة.
  (() => {
    const i = server.indexOf('function snapshotConnection');
    const block = server.slice(i, i + 500);
    return block.includes('accountName') === false || /if \(isOwner\) return full;[\s\S]{0,200}?return \{ platform: full\.platform, status: full\.status, connectedAt: full\.connectedAt \?\? null, providerVerified: full\.providerVerified \}/.test(block);
  })(),
  '/api/workspace/snapshot: الهوية التنظيمية للمنصات للمالك فقط، وغير المالك يرى الحالة التقنية بلا accountName/accountId/lastSyncAt');
add('workspace-snapshot-authz-test',
  fs.existsSync(path.join(root, 'engine/tests/workspace.snapshot.authz.test.ts')) &&
  (pkg.scripts['test'] || '').includes('test:workspace-snapshot-authz') &&
  read('engine/tests/workspace.snapshot.authz.test.ts').includes('لا accountName/accountId/lastSyncAt') &&
  read('engine/tests/workspace.snapshot.authz.test.ts').includes('owner: accountName ظاهر'),
  'اختبار Least-Privilege لـ/api/workspace/snapshot موجود ومسجّل (owner يرى الهوية، غيره لا)');
add('watcher-product-facts-gate', server.includes('verifiedProductFactsForReply(') && server.includes('resolveYouTubeVideoProduct(') && server.includes('priceFactsVerified,'), 'المراقب يربط استفسار السعر ببيانات المنتج المسجّلة فعلاً عبر بوابة صريحة (لا اختراع)');
add('watcher-product-facts-honest', /if \(!product \|\| !facts\.priceText\)[\s\S]{0,120}?verified: false/.test(server) && server.includes('analyzeBusinessClaims(replyText, factsBusiness)'), 'لا ردّ سعر بلا منتج/سعر مسجّل، والرد يمر بحارس سلامة المحتوى قبل الإرسال');
add('watcher-product-facts-reply-uses-product', /executeYouTubeReply\(\{ commentId: String\(c\.commentId\)[\s\S]{0,200}?productId: priceReply\.verified/.test(server), 'منفّذ الرد يستلم معرّف المنتج الحقيقي عند تحقّق الحقائق (الرد من بيانات المعرض)');
add('watcher-product-facts-test', read('engine/tests/youtube.connector.test.ts').includes('12k-7') && read('engine/tests/brain/central.authority.test.ts').includes('priceFactsVerified: true'), 'اختبار انحدار: استفسار سعر مع حقائق ⇒ رد، وبلا حقائق ⇒ تصعيد (وحدة + تكامل)');
add('watcher-product-facts-ui-wired', (() => { const p = read('src/components/agent/YouTubeContentQueuePanel.tsx'); return p.includes('productId: productId || undefined') && p.includes('it.productName'); })(), 'الواجهة تربط المنتج الحقيقي بعنصر المحتوى وتعرضه (فالمسار قابل للوصول فعلاً لا مجرد كود معطّل)');
add('youtube-watcher-ui-tab', app.includes('YouTubeOperationsView') && app.includes("case 'youtube_operations'") && read('src/components/common/Sidebar.tsx').includes("id: 'youtube_operations'"), 'واجهة مدير تشغيل YouTube مرتبطة بتبويب فعّال في القائمة');
// التبويب مقتصر على المالك في القائمة، مطابقةً لبوابة requireOwner على بيانات المراقب.
add('youtube-watcher-ui-owner-only', /id: 'youtube_operations',[\s\S]{0,140}?ownerOnly: true/.test(read('src/components/common/Sidebar.tsx')), 'تبويب مدير تشغيل YouTube مقتصر على المالك في القائمة (مطابق لبوابة الخادم)');
add('youtube-watcher-ui-honest', watcherUi.includes('getYouTubeWatcher') && watcherUi.includes('setYouTubeWatcherControls') && watcherUi.includes('pollYouTubeWatcher') && watcherUi.includes('lastReply') && watcherUi.includes('attentionRequired'), 'الواجهة تعرض الحالة الحقيقية من الخادم وتتيح التحكم (Kill Switch) للمالك');
add('youtube-watcher-tests', watcherTest.includes('watcherGate') && watcherTest.includes('decideCommentAction') && watcherTest.includes('computeCommentVelocity') && watcherTest.includes('watcherReplyExecutionReady') && watcherTest.includes('executeYouTubeReply'), 'اختبارات مدير YouTube تثبت البوابة/القرار/الزخم/بوابة التفويض/الربط بالمنفّذ الحقيقي');
const commentsModule = read('engine/social/comments.ts');
add('youtube-praise-iraqi-phrases', commentsModule.includes('مرتب') && commentsModule.includes('ما شاء الله') && commentsModule.includes('تسلمون') && commentsModule.includes('عاشت ايدك'), 'تصنيف المدح يشمل العبارات العراقية العفوية (مرتب/ما شاء الله/تسلمون) لا الفصحى وحدها');
add('youtube-positive-emoji-interaction', commentsModule.includes('POSITIVE_EMOJI_RE') && commentsModule.includes('EMOJI_ONLY_RE') && commentsModule.includes("intent = 'praise'"), 'التعليق الإيجابي بالإيموجي (قلوب/إعجاب) يُعامل كتفاعل إيجابي قابل للرد لا كمجهول');
add('youtube-iraqi-reply-dialect', commentsModule.includes('هلا بيك') && commentsModule.includes('نورتنا') && commentsModule.includes('تدلل'), 'الردود الحتمية باللهجة العراقية العفوية القصيرة (لا فصحى جامدة)');
add('youtube-escalation-specific-reason', watcherModule.includes('يحتاج بيانات المنتج المؤكدة') && watcherModule.includes('شكوى/حالة حساسة'), 'سبب التصعيد محدد ومرتبط بالمضمون لا رسالة عامة');
add('youtube-escalation-not-config-noise', watcherModule.includes("code: 'DEFER_AUTOREPLY_DISABLED'") && watcherModule.includes("code: 'ESCALATE_BUSINESS_INQUIRY'") && watcherModule.includes("code: 'ESCALATE_SENSITIVE'") && watcherModule.includes('isDeferredDecision'), 'تعذّر الرد بسبب إعداد المالك قرار غير نهائي (DEFER بكود صريح) لا تصعيد كاذب، والتصعيد بسبب حقيقي مرتبط بالمضمون فقط');
add('youtube-defer-release-on-enable', watcherModule.includes('releaseDeferredEntries') && server.includes('releaseDeferredEntries(watcherState.processed)') && server.includes('releasedDeferred: released'), 'التعليقات المؤجَّلة (تعذّر بسبب الإعداد) تُحرَّر وتُعاد تقييمها تلقائياً عند تمكين الرد — بلا فقدان تعليق');
add('youtube-defer-release-legacy', watcherModule.includes("p.reason.includes('الرد الآلي غير ممكّن')"), 'التحرير يغطّي السجلات القديمة (قبل إدخال deferred) فلا تبقى تعليقات عالقة بعد الإصلاح');
add('youtube-defer-not-escalated', server.includes('comment_deferred') && server.includes('baseEntry.deferred = true') && server.includes('baseEntry.stage = "SKIPPED"'), 'التعليق المؤجَّل يُسجَّل مؤجَّلاً (deferred) لا مُصعَّداً — يظهر كتأجيل إعداد لا كحالة تحتاج تدخل المالك');
add('youtube-decision-code-honest', watcherModule.includes('CommentDecisionCode') && watcherModule.includes("code: 'REPLY_ALLOWED'") && watcherModule.includes("code: 'SKIP_SPAM'") && server.includes('isDeferredDecision(decision.code)'), 'قرار الرد/التجاهل/التصعيد يحمل كوداً حتمياً يُصنَّف آلياً بلا الاعتماد على نص السبب');
add('youtube-watcher-deferred-counter', server.includes('deferred: processed.filter((p) => p.deferred).length') && server.includes('deferred,'), 'عدّاد المؤجَّل يُعلن في حالة المراقبة (شفافية الحالة بلا خلط مع التصعيد/التجاهل)');
add('youtube-watcher-defer-cycle-test', read('engine/tests/youtube.connector.test.ts').includes('12k-5') && read('engine/tests/youtube.connector.test.ts').includes('releasedDeferred') && read('engine/tests/youtube.watcher.test.ts').includes('releaseDeferredEntries'), 'اختبار تكامل يثبت: تعطيل => تأجيل بلا إرسال، تمكين => تحرير + رد حقيقي، Kill Switch => لا إرسال');
add('youtube-self-authored-by-channel-id', server.includes('c.authorChannelId') && server.includes('expectedChannelId'), 'كشف ردود القناة نفسها بالمعرّف الحقيقي (authorChannelId) لا بالاسم فقط');

// --- مركز مراجعة التقرير اليومي: من الرقم إلى التعليق الحقيقي ---
const watcherReview = read('engine/social/watcherReview.ts');
const watcherReviewTest = read('engine/tests/watcher.review.test.ts');
const watcherReviewInt = read('engine/tests/watcher.review.integration.test.ts');
const reviewUi = read('src/components/agent/YouTubeBriefReview.tsx');
add('brief-review-module', fs.existsSync(path.join(root, 'engine/social/watcherReview.ts')) && watcherReview.includes('WATCHER_BRIEF_METRICS') && watcherReview.includes('selectMetricEntries') && watcherReview.includes('computeBriefCounts'), 'وحدة مركز مراجعة التقرير (محدّدات/حساب/فلاتر/قرارات) موجودة');
add('brief-review-single-source-selector', server.includes('const counts = computeBriefCounts(processed, now)') && server.includes("selectMetricEntries(processed, 'escalated', now)"), 'أرقام التقرير تُحسب من نفس مُحدِّدات شاشة التفاصيل (مصدر واحد ⇒ لا discrepancy)');
add('brief-review-details-endpoint', server.includes('/api/agent/youtube/watcher/details') && server.includes('selectMetricEntries(watcherState.processed, metric') && server.includes('applyDetailFilters'), 'مسار التفاصيل يُرجع نفس سجلات الرقم مع الفلاتر ويُعيد 400 لبطاقة غير معروفة');
add('brief-review-comment-endpoint', server.includes('/api/agent/youtube/watcher/comment/:commentId') && server.includes('404') && server.includes('تعليق غير موجود'), 'مسار تفاصيل تعليق واحد بمعرّفه (404 إن غير موجود)');
add('brief-review-open-is-readonly', server.includes('فتح التفاصيل لا يغيّر أي حالة') && /app\.get\("\/api\/agent\/youtube\/watcher\/details"[\s\S]{0,1200}?res\.json/.test(server), 'فتح التفاصيل للقراءة فقط ولا يغيّر أي حالة');
add('brief-review-owner-action', server.includes('app.post("/api/agent/youtube/watcher/review", requireOwner'), 'قرارات المراجعة للمالك فقط (requireOwner)');
add('brief-review-uses-central-executor', /app\.post\("\/api\/agent\/youtube\/watcher\/review", requireOwner[\s\S]{0,1600}?await executeYouTubeReply\(/.test(server), 'إرسال الرد من المراجعة يمر بالمنفّذ المركزي executeYouTubeReply (لا مسار جانبي)');
add('brief-review-actions-explicit', watcherReview.includes("'allow_reply'") && watcherReview.includes("'reprocess'") && watcherReview.includes("'ignore'") && watcherReview.includes("'escalate'") && watcherReview.includes("'block_reply'") && watcherReview.includes('isValidReviewAction'), 'الإجراءات المعروفة فقط مسموحة (allow_reply/reprocess/ignore/escalate/block_reply)');
add('brief-review-no-send-without-provider-id', server.includes('if (result.status !== 200 || !result.body?.delivered)') && server.includes('sent: false') && server.includes('externalReplyId: result.body.externalReplyId'), 'لا يُسجَّل قرار ناجح/تسليم إلا بمعرّف رد حقيقي من YouTube');
add('brief-review-overrides-durable', server.includes('reviewOverrides: watcherState.reviewOverrides.slice(0, 5000)') && server.includes('normalizeReviewOverrides(raw.reviewOverrides)'), 'قرارات المراجعة تُحفظ/تُسترجع عبر المحوّل فتصمد بعد restart');
add('brief-review-override-respected-in-cycle', server.includes('const ownerOverride = overrideMap[c.commentId]') && server.includes('overrideForcesReply(ownerOverride)') && server.includes('overrideForcedStage(override)') && server.includes('review_override_applied'), 'قرار المالك (منع/تجاهل/تصعيد) يُحترم في دورة المراقبة التالية');
add('brief-review-zero-honest', watcherReview.includes('return recent.filter') && watcherReview.includes("case 'verifiedReplies'"), 'البطاقة الصفر تُرجع قائمة فارغة صحيحة (لا اختراع سجلات)');
add('brief-review-no-secret', !/(accessToken|refreshToken|clientSecret|GEMINI_API_KEY)/.test(watcherReview) && !/(accessToken|clientSecret)/.test(reviewUi), 'وحدة/واجهة المراجعة بلا أي سرّ/توكن');
add('brief-review-ui-clickable', watcherUi.includes('setActiveMetric') && watcherUi.includes('brief.metrics') && reviewUi.includes('getYouTubeWatcherDetails') && reviewUi.includes('reviewYouTubeWatcherComment'), 'البطاقات قابلة للنقر وتفتح شاشة المراجعة الحقيقية');
add('brief-review-ui-suggested-reply', reviewUi.includes('suggestedReply') && reviewUi.includes('allow_reply') && reviewUi.includes('block_reply'), 'شاشة المراجعة تعرض الرد المقترح وتتيح الإجراءات الصريحة');
add('brief-review-ui-owner-only', reviewUi.includes("currentUser?.role === 'owner'") && reviewUi.includes('للمالك فقط'), 'أزرار المراجعة تظهر للمالك فقط في الواجهة');
add('brief-review-api-client', read('src/services/api.ts').includes('/api/agent/youtube/watcher/details') && read('src/services/api.ts').includes('/api/agent/youtube/watcher/review'), 'طبقة API تحمل مساري التفاصيل والمراجعة');
add('brief-review-tests', fs.existsSync(path.join(root, 'engine/tests/watcher.review.test.ts')) && watcherReviewTest.includes('computeBriefCounts') && watcherReviewTest.includes('selectMetricEntries') && watcherReviewTest.includes('overrideForcesReply'), 'اختبار وحدة يثبت: العدد=السجلات، الفلاتر لا تُنشئ بيانات، الصفر صادق، القرارات');
add('brief-review-integration-tests', fs.existsSync(path.join(root, 'engine/tests/watcher.review.integration.test.ts')) && watcherReviewInt.includes('watcher/review') && watcherReviewInt.includes('allow_reply') && watcherReviewInt.includes('comments.insert'), 'اختبار تكامل حقيقي: قراءة → تقرير → تفاصيل → قرار رد → comments.insert → معرّف حقيقي');

// --- وقت الأتمتة: فاصل فحص تعليقات YouTube يتحكم به المالك (1..5 دقائق) ---
const watcherModuleText = read('engine/social/youtubeWatcher.ts');
const schedulerModuleText = read('engine/social/youtubeWatcherScheduler.ts');
add('youtube-cadence-owner-control', watcherModuleText.includes('cadenceMinutes') && watcherModuleText.includes("'cadenceMinutes'"), 'فاصل الأتمتة حقل تحكم مملوك (cadenceMinutes) في وحدة الـwatcher');
add('youtube-cadence-validate-single-source', watcherModuleText.includes('export function validateCadenceMinutes') && watcherModuleText.includes('WATCHER_MIN_CADENCE_MINUTES') && watcherModuleText.includes('WATCHER_MAX_CADENCE_MINUTES'), 'تحقق الفاصل (1..5 فقط) مصدر واحد في الوحدة');
add('youtube-cadence-reject-invalid', /validateCadenceMinutes[\s\S]{0,600}?!Number\.isInteger/.test(watcherModuleText) && /validateCadenceMinutes[\s\S]{0,900}?input > WATCHER_MAX_CADENCE_MINUTES/.test(watcherModuleText), 'يرفض العشري والأكبر من الحد صراحةً (لا تقريب صامت)');
add('youtube-cadence-ms-after-validate', /export function cadenceMinutesToMs[\s\S]{0,200}?validateCadenceMinutes/.test(watcherModuleText), 'التحويل إلى ms يقع بعد التحقق فقط');
add('youtube-cadence-server-enforced', server.includes('validateCadenceMinutes(requested)') && server.includes('INVALID_CADENCE') && server.includes('status(400)'), 'الخادم يفرض نفس الحدود ويرد 400 صراحةً حتى لو تجاوز أحد الواجهة');
add('youtube-cadence-owner-only', /youtube\/watcher\/controls", requireOwner/.test(server), 'تعديل الفاصل محصور بالمالك (requireOwner)');
add('youtube-cadence-single-timer', schedulerModuleText.includes('export function createWatcherScheduler') && schedulerModuleText.includes('clearTimer()') && /reschedule\(\)[\s\S]{0,300}?clearTimer\(\)[\s\S]{0,200}?createTimer\(\)/.test(schedulerModuleText), 'إعادة الجدولة تُبطل المؤقّت القديم قبل إنشاء الجديد (لا تكرار)');
add('youtube-cadence-reschedule-server', server.includes('function applyWatcherCadence') && server.includes('createWatcherScheduler') && server.includes('reschedule()'), 'الخادم يمتلك جدولة واحدة ويعيد الجدولة عند تغيير الفاصل/Kill Switch');
add('youtube-cadence-persisted', server.includes('cadenceMinutes') && watcherModuleText.includes('cadenceMinutes: cadence.ok ? cadence.minutes : d.cadenceMinutes'), 'الفاصل يُحفظ/يُسترجَع عبر آلية الـwatcher نفسها (بلا مخزن جديد)');
add('youtube-cadence-killswitch-zero', /watcherControlsView[\s\S]{0,400}?cadenceMs: cadencePaused \? 0/.test(watcherModuleText), 'عند Kill Switch لا فحص: الفاصل الفعلي 0');
add('youtube-cadence-ui-selector', read('src/components/agent/YouTubeOperationsView.tsx').includes('yt-cadence') && read('src/components/agent/YouTubeOperationsView.tsx').includes('وقت الأتمتة') && read('src/components/agent/YouTubeOperationsView.tsx').includes('فاصل المراقبة'), 'واجهة وقت الأتمتة: قائمة اختيار واضحة 1..5');
add('youtube-cadence-ui-api', read('src/services/api.ts').includes('cadenceMinutes') && read('src/services/api.ts').includes('boolean | number'), 'خدمة الـAPI تمرّر cadenceMinutes للمالك');
add('youtube-cadence-tests', fs.existsSync(path.join(root, 'engine/tests/youtube.interval.test.ts')) && pkg.scripts['test:youtube-interval'], 'اختبار فاصل الأتمتة مسجّل');
add('youtube-cadence-test-in-suite', typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:youtube-interval'), 'اختبار فاصل الأتمتة ضمن npm test');
add('youtube-cadence-no-secret', !/client_secret|Bearer\s|eyJ/.test(schedulerModuleText), 'وحدة الجدولة بلا أي سرّ');

// --- Reply Intelligence: ردود عراقية طبيعية واعية بالسياق ---
// كان buildDeterministicReply قالباً واحداً لكل نية (4-5 جمل ثابتة)، فتبدو الردود
// شبه ثابتة مهما اختلف نص التعليق. الآن يوجد محرّك generateReply يشتق الرد من
// النص + المعنى + النبرة + النوع + الموضوع + السياق + حقائق المعرض الموثوقة،
// ويمتنع عن اختراع أي معلومة غير مسجّلة. حتمي بالكامل بلا استهلاك حصة.
const replyComments = read('engine/social/comments.ts');
add('reply-intelligence-engine', replyComments.includes('export function generateReply') && replyComments.includes('export interface GeneratedReply'), 'محرّك Reply Intelligence (generateReply) موجود بمنطق صافٍ');
add('reply-intelligence-topic', replyComments.includes('CommentTopic') && replyComments.includes('detectTopic') && /Topic:\s*'location'/.test(replyComments) === false, 'تصنيف الموضوع (موقع/سعر/توفر/دوام) مستخرج من النص');
add('reply-intelligence-subintent', replyComments.includes('CommentSubIntent') && replyComments.includes('detectSubIntent'), 'النية الثانوية (شكر/دعاء/تحية/إعجاب/إيموجي) مستخرجة من النص');
add('reply-intelligence-no-template', replyComments.includes('pickVariant') && replyComments.includes('stableHash') && replyComments.includes('previousReplies'), 'الردود تتنوّع حسب المدخل والسياق لا قالباً واحداً (pickVariant + منع التكرار الميكانيكي)');
add('reply-intelligence-no-invented-facts', replyComments.includes('needsInfo') && replyComments.includes('price_needs_info') && replyComments.includes('location_needs_info') && replyComments.includes('availability_needs_info'), 'لا اختراع سعر/موقع/توفر: إحالة للمعلومة الحقيقية عند غيابها');
add('reply-intelligence-trusted-facts', replyComments.includes('price_trusted') && replyComments.includes('location_trusted') && replyComments.includes('hours_trusted') && replyComments.includes('usedFacts'), 'يُستخدم السعر/الموقع/الدوام الموثوق فقط ويُوسَم في usedFacts');
add('reply-intelligence-delegates', /export function buildDeterministicReply[\s\S]{0,600}?generateReply\(/.test(replyComments), 'buildDeterministicReply يفوّض إلى محرّك واحد (مصدر واحد للصياغة)');
add('reply-intelligence-context', replyComments.includes('videoTitle') && replyComments.includes('authorName'), 'السياق (الفيديو/المؤلف) يدخل في صياغة الرد');
add('reply-intelligence-route-wired', /generateReply\(classification, replyFacts, replyContext\)/.test(read('engine/social/routes.ts')), 'مسار التصنيف يمر عبر محرّك الرد الجديد');
add('reply-intelligence-route-diagnostic', read('engine/social/routes.ts').includes('replyIntelligence') && read('engine/social/routes.ts').includes('needsInfo'), 'الاستجابة تعرض تشخيص الرد الصادق (استراتيجية/حقائق/إحالة)');
add('reply-intelligence-reply-facts-dep', read('engine/social/routes.ts').includes('buildReplyFacts') && server.includes('buildReplyFacts:'), 'حقائق الرد الموثوقة تُحقن من الخادم (بيانات مسجّلة فقط)');
add('reply-intelligence-no-fake-marketing', !/عرض خاص.{0,40}احجز الآن/.test(replyComments), 'لا عبارات إعلانية جاهزة في محرّك الرد');
add('reply-intelligence-types', read('src/types/index.ts').includes('ReplyIntelligence') && read('src/types/index.ts').includes('subIntent'), 'أنواع Reply Intelligence معلنة ومطابقة للخادم');
add('reply-intelligence-ui', read('src/components/social/SocialManagerView.tsx').includes('replyIntelligence') && read('src/components/social/SocialManagerView.tsx').includes('استراتيجية الرد'), 'واجهة التصنيف تعرض الاستراتيجية والحقائق الموثوقة');
add('reply-intelligence-tests', fs.existsSync(path.join(root, 'engine/tests/reply.intelligence.test.ts')) && pkg.scripts['test:reply-intelligence'], 'اختبار Reply Intelligence مسجّل');
add('reply-intelligence-test-in-suite', typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:reply-intelligence'), 'اختبار Reply Intelligence ضمن npm test');
add('reply-intelligence-no-ai-quota', !/aiEngine|gemini|fetch\(|https?:/.test(replyComments), 'محرّك الرد حتمي بالكامل: لا مزود ولا شبكة ولا استهلاك حصة');

// ===== جدار حماية حصة Gemini المجاني — مركزي واحد للمشروع كله =====
const firewall = read('engine/ai/firewall.ts');
const quotaPolicy = read('engine/ai/quotaPolicy.ts');
const aiEngineSrc = read('engine/ai/engine.ts');
const aiProviderSrc = read('engine/ai/provider.ts');
add('gemini-firewall-module', firewall.includes('export class AiUsageLedger') && firewall.includes('export function buildUsageDiagnostics') && firewall.includes('export function enforcePromptLimit'), 'وحدة جدار الحماية المركزية موجودة');
add('gemini-firewall-project-scope', server.includes("scope: 'project-wide'") && server.includes('platformSpecificQuota: false') && !/perPlatformQuota|platformDailyLimit/i.test(server + firewall), 'النطاق مشروع كامل ولا حد منصة منفصل');
add('gemini-firewall-no-platform-branch', !/if\s*\(\s*platform\s*===/.test(firewall) && !/if\s*\(\s*platform\s*===/.test(aiEngineSrc), 'قرار الحماية بلا أي تفريع على اسم منصة');
add('gemini-firewall-future-platform', firewall.includes('KNOWN_AI_PLATFORMS') && firewall.includes('normalizePlatformLabel') && /return \(KNOWN_AI_PLATFORMS as readonly string\[\]\)\.includes\(s\) \? s : 'unknown'/.test(firewall), 'المنصة غير المعروفة تُقبل وتُحسب (لا استبعاد)');
add('gemini-firewall-ledger-sources', firewall.includes('providerCalls') && firewall.includes('cacheHits') && firewall.includes('inflightJoins') && firewall.includes('guardBlocked') && firewall.includes('deterministic') && firewall.includes('fallback') && firewall.includes('providerErrors'), 'العدّادات تميّز نداء المزود عن الكاش/الحتمي/الحجب');
add('gemini-firewall-only-provider-consumes', /providerCalls \+= 1/.test(firewall) && !/cacheHits \+= 1[\s\S]{0,80}usedToday/.test(firewall), 'نداء المزود وحده يستهلك الميزانية اليومية');
add('gemini-firewall-guard-single-source', server.includes('const aiUsageGuard: AiUsageGuard') && (server.match(/aiUsageGuard/g) || []).length >= 4, 'حارس واحد مركزي يستهلكه المحرك وكل المسارات');
add('gemini-firewall-limit-default-4', server.includes('resolveGeminiDailyLimit(process.env)') && quotaPolicy.includes('GEMINI_LIMIT_DEFAULT = 40') && firewall.includes('localDailyLimit'), 'الحد المحلي الافتراضي 40 طلباً/يوم عبر مصدر سياسة واحد (كان 4)');
add('gemini-limit-env-configurable', quotaPolicy.includes("GEMINI_DAILY_LIMIT_ENV = 'GEMINI_DAILY_LIMIT'") && quotaPolicy.includes('resolveGeminiDailyLimit'), 'الحد قابل للضبط بمتغيّر بيئة عبر مصدر واحد');
add('gemini-limit-clamped-safely', quotaPolicy.includes('GEMINI_LIMIT_MAX_SAFE = 120') && /Math\.min\(GEMINI_LIMIT_MAX_SAFE/.test(quotaPolicy), 'أي قيمة بيئة تتجاوز الحد الآمن تُقصّ (لا تعطيل للحارس)');
add('gemini-limit-guard-still-enforced', server.includes('geminiUsageCount >= GEMINI_DAILY_LIMIT') && server.includes('GEMINI_DAILY_LIMIT<=GEMINI_LIMIT_MAX_SAFE'), 'الحارس اليومي ما زال يمنع أي طلب بعد بلوغ السقف');
add('gemini-limit-policy-tests', /limitPolicy/.test(server) && fs.readFileSync(path.join(root, 'engine/tests/gemini.quota.policy.test.ts'), 'utf8').includes('GEMINI_LIMIT_MAX_SAFE'), 'اختبار يثبت الرفع المتحفظ والقصّ ومنع التجاوز');
add('gemini-firewall-protection-flag', server.includes('GEMINI_FREE_TIER_PROTECTION') && server.includes('protectionEnabled'), 'وضع الحماية معلن ومفعّل افتراضياً');
add('gemini-firewall-no-paid-provider', !/openai|anthropic|claude|deepseek|kimi/i.test(firewall) && !/openai|anthropic|claude|deepseek/i.test(server), 'لا مزود مدفوع ولا مزود بديل مُضاف');
add('gemini-firewall-quota-guard-reason', aiEngineSrc.includes("'quota_guard'") && aiEngineSrc.includes("source: 'fallback'"), 'الحجب يعيد بديلاً حتمياً صريحاً (quota_guard/fallback)');
add('gemini-firewall-prompt-limit', aiEngineSrc.includes('enforcePromptLimit') && aiEngineSrc.includes('maxPromptChars') && aiProviderSrc.includes('maxOutputTokens'), 'حدود حجم الـprompt والمخرجات مطبَّقة قبل النداء');
add('gemini-firewall-owner-endpoint', server.includes('app.get("/api/ai/firewall", requireOwner'), 'مسار تشخيص الجدار للمالك فقط');
add('gemini-firewall-readiness-block', server.includes('freeTierFirewall') && server.includes('promptLimit'), 'الجاهزية تعرض كتلة الجدار وحدود الـprompt');
add('gemini-firewall-health-block', server.includes('firewall: buildUsageDiagnostics'), 'الصحة تعرض تشخيص الجدار');
add('gemini-firewall-verify-uses-guard', /aiUsageGuard\.consume\(\)[\s\S]{0,400}blocked_by_guard/.test(server), 'الفحص الحي يستهلك من نفس الميزانية المركزية');
add('gemini-firewall-no-google-quota-claim', server.includes('حد الحماية المحلي للمشروع') && firewall.includes('حد الحماية المحلي للمشروع') && !/Google quota/i.test(firewall), 'الحد مُسمّى حماية محلية للمشروع لا حصة Google');
add('gemini-firewall-multi-platform-one-call', server.includes('adaptContentForPlatform(p, safeContent)') && /adaptationTargets/.test(server), 'طلب محتوى واحد لعشر منصات = نداء واحد + تكييف حتمي');
add('gemini-firewall-tests', fs.existsSync(path.join(root, 'engine/tests/gemini.firewall.test.ts')) && pkg.scripts['test:gemini-firewall'], 'اختبار جدار الحماية (وحدة) مسجّل');
add('gemini-firewall-server-tests', fs.existsSync(path.join(root, 'engine/tests/gemini.firewall.server.test.ts')) && pkg.scripts['test:gemini-firewall-server'], 'اختبار جدار الحماية (خادم حقيقي) مسجّل');
add('gemini-firewall-tests-in-suite', typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:gemini-firewall') && pkg.scripts.test.includes('test:gemini-firewall-server'), 'اختبارا الجدار ضمن npm test');
add('gemini-firewall-no-direct-provider', (() => {
  const walk = (dir, out = []) => {
    for (const name of fs.readdirSync(dir)) {
      if (['node_modules', 'dist', '.git', 'coverage'].includes(name)) continue;
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx|mjs|cjs)$/.test(name)) out.push(full);
    }
    return out;
  };
  const files = walk(root);
  return files.every((f) => !/new GoogleGenAI\(/.test(fs.readFileSync(f, 'utf8')) || f.endsWith('engine/ai/provider.ts'));
})(), 'لا إنشاء عميل Gemini خارج الموصل المركزي (لا تجاوز للجدار)');

// -------------------------------------------------------------
// طابور محتوى YouTube — نشر/جدولة/مراجعة بشرية (دفعة الاكتمال التشغيلي)
// -------------------------------------------------------------
const contentPipeline = read('engine/social/contentPipeline.ts');
const contentPipelineTest = read('engine/tests/content.pipeline.test.ts');
const contentPanel = read('src/components/agent/YouTubeContentQueuePanel.tsx');
const apiSrc = read('src/services/api.ts');
add('content-pipeline-module', fs.existsSync(path.join(root, 'engine/social/contentPipeline.ts')) && contentPipeline.includes('contentGate') && contentPipeline.includes('classifyContentForReview') && contentPipeline.includes('decisionToState'), 'مسار المحتوى الموحّد (بوابة→تصنيف→قرار) موجود كمصدر واحد');
add('content-state-separation', contentPipeline.includes('CONTENT_STATES') && contentPipeline.includes("'APPROVED'") && contentPipeline.includes("'SCHEDULED'") && contentPipeline.includes("'PUBLISHED'") && contentPipeline.includes("'REVIEW_REQUIRED'"), 'فصل الحالات صريح (APPROVED/SCHEDULED/PUBLISHED/REVIEW_REQUIRED)');
add('content-idempotency-fingerprint', contentPipeline.includes('contentFingerprint') && contentPipeline.includes('fingerprintTag') && contentPipeline.includes('matchVideoByFingerprint'), 'بصمة idempotency + وسم مطابقة حقيقي لإعادة المزامنة');
add('content-reconcile-unknown', contentPipeline.includes('reconcileUnknownUpload') && server.includes('UNKNOWN_EXTERNAL_STATE') && server.includes('findYouTubeVideoByFingerprint'), 'إعادة مزامنة الحالة غير المؤكدة بعد فشل شبكي (لا نشر مكرر)');
add('content-schedule-no-fabrication', contentPipeline.includes('suggestScheduleTime') && contentPipeline.includes('sampleInsufficient'), 'ذكاء الجدولة لا يدّعي «أفضل وقت» بلا عيّنة كافية');
add('content-no-fake-publish-guard', server.includes('QUEUE_PUBLISH_REQUIRES_MEDIA') === false && server.includes('MEDIA_REQUIRED') && server.includes('CONTENT_SAFETY_BLOCKED'), 'الرفع يحتاج مادة حقيقية وسلامة محتوى قبل التنفيذ');
add('content-publish-central-executor', server.includes('async function executeYouTubePublish') && server.includes('queueItemId') && /executeYouTubePublish\(\{[\s\S]{0,400}approved: true, queueItemId/.test(server), 'النشر يستخدم المنفّذ المركزي executeYouTubePublish مع معرّف عنصر الطابور (لا مسار جانبي)');
add('content-publish-state-honest', server.includes('queueItem.verified = fullyVerified') && server.includes('publishAtIso ? "SCHEDULED" : "PUBLISHED"') && server.includes('queueItem.verifiedDescription'), 'لا يُعلن PUBLISHED/verified بلا معرّف فيديو حقيقي وتحقق فعلي (خصوصية+وصف)؛ المجدول يبقى SCHEDULED');
add('content-media-store-real-bytes', server.includes('registerContentMedia') && server.includes('contentMediaBytes') && server.includes('CONTENT_MEDIA_MAX'), 'مخزن المادة يحفظ بايتات حقيقية فقط ويعيد ref');
add('content-queue-persistence', server.includes('contentQueue.slice(0, CONTENT_QUEUE_MAX)') && server.includes('applyContentMediaState'), 'طابور المحتوى ومخزن المادة يُحفظان ويُسترجعان بعد restart');
add('content-brief-metrics-clickable', server.includes('contentBriefMetricsView') && server.includes('computeContentBriefCounts') && contentPipeline.includes('CONTENT_BRIEF_METRICS'), 'بطاقات المحتوى في التقرير قابلة للنقر بمصدر واحد');
add('content-brief-details-same-records', server.includes('/api/platforms/youtube/content/details') && server.includes('total: filtered.length'), 'تفاصيل بطاقة المحتوى = نفس السجلات التي كوّنت الرقم (بلا discrepancy)');
add('content-reject-terminal', server.includes("action === \"reject\" || action === \"cancel\"") && contentPipeline.includes('isTerminalContentState'), 'الرفض/الإلغاء نهائي ولا يُنشر تلقائياً');
add('content-kill-switch-blocks', contentPipeline.includes('AUTOMATION_PAUSED') && contentPipeline.includes('AUTO_PUBLISH_DISABLED') && contentPipeline.includes('AUTO_SCHEDULE_DISABLED'), 'Kill Switch وحده يمنع النشر والجدولة قبل أي تنفيذ');
add('content-owner-only', /app\.post\("\/api\/platforms\/youtube\/content\/drafts",[\s\S]{0,120}requireOwner/.test(server) && server.includes('app.post("/api/platforms/youtube/content/queue/:id/review", requireOwner'), 'إنشاء/قرار المحتوى محصور بالمالك');
add('content-media-validation', server.includes('function validateMediaBytes') && server.includes('function decodeStrictBase64') && server.includes('CONTENT_ALLOWED_MIME'), 'تحقق فعلي من مادة الفيديو (توقيع/نوع/حجم/base64 صارم) على الخادم');
add('content-media-gated-actions', server.includes('filterContentActions') && server.includes('contentItemMediaState') && server.includes('hasMedia'), 'الموافقة/النشر/الجدولة محجوبة بلا مادة فعلية (مصدر واحد)');
add('content-upload-route-limit', server.includes('CONTENT_UPLOAD_JSON_LIMIT') && server.includes('CONTENT_UPLOAD_PATH'), 'مسار رفع الفيديو له حد جسم أعلى مع بقاء حد 256kb لبقية المسارات');
const panelTsx = fs.existsSync(path.join(root, 'src/components/agent/YouTubeContentQueuePanel.tsx')) ? fs.readFileSync(path.join(root, 'src/components/agent/YouTubeContentQueuePanel.tsx'), 'utf8') : '';
add('content-ui-real-file-upload', panelTsx.includes('type="file"') && panelTsx.includes('accept="video/*"') && !panelTsx.includes('بايتات الفيديو base64'), 'واجهة المحتوى تختار ملف فيديو حقيقياً بلا كتابة base64 يدوياً');
add('content-ui-honors-allowed-actions', panelTsx.includes('allowedActions') && panelTsx.includes('CONTENT_UPLOAD_MAX_BYTES'), 'الواجهة تحترم العمليات المتاحة وتتحقق من الحجم قبل الإرسال');
add('content-firewall-untouched', server.includes('youtubeOnlyModeEnabled') && server.includes('aiUsageGuard'), 'لم تُمَسّ حماية Gemini ولا نمط YouTube-only');
add('content-no-secret', !/(accessToken|refreshToken|clientSecret|GEMINI_API_KEY|apiKey)\s*[:=]/.test(contentPipeline), 'وحدة مسار المحتوى بلا أي سرّ/توكن');
const pkgTest = typeof pkg.scripts.test === 'string' ? pkg.scripts.test : '';
add('content-pipeline-tests', fs.existsSync(path.join(root, 'engine/tests/content.pipeline.test.ts')) && pkg.scripts['test:content-pipeline'], 'اختبار وحدة مسار المحتوى مسجّل');
add('content-pipeline-integration-tests', fs.existsSync(path.join(root, 'engine/tests/content.pipeline.integration.test.ts')) && pkg.scripts['test:content-integration-ep'], 'اختبار تكاملي لطابور المحتوى مسجّل');
add('content-pipeline-tests-in-suite', pkgTest.includes('test:content-pipeline') && pkgTest.includes('test:content-integration-ep'), 'اختبارا المحتوى ضمن npm test');
add('content-ui-queue-panel', contentPanel.includes('getYouTubeContentQueue') && contentPanel.includes('reviewYouTubeContentItem') && contentPanel.includes('getYouTubeScheduleSuggestion'), 'لوحة طابور المحتوى موصولة بمسارات الخادم');

// --- قرار المالك المباشر: نشر الآن public + جدولة private + تحقق حقيقي (Batch 24) ---
add('content-manual-mode-explicit', contentPipeline.includes("ContentActionMode = 'manual' | 'auto'") && contentPipeline.includes("mode: ContentActionMode = 'auto'"), 'فصل صريح بين قرار المالك المباشر والأتمتة في بوابة المحتوى');
add('content-manual-independent-of-automation', /if \(mode === 'auto'\) \{[\s\S]*?AUTO_PUBLISH_DISABLED[\s\S]*?AUTO_SCHEDULE_DISABLED[\s\S]*?\n  \}/.test(contentPipeline) && /export function reviewActionToState[\s\S]{0,2500}contentGate\(controls, 'publish', 'manual'\)/.test(contentPipeline), 'قرار المالك المباشر (mode=manual) يتجاوز autoPublish/autoSchedule؛ فحص الأتمتة داخل فرع auto فقط');
add('content-publish-now-public', server.includes('const privacyDefault = mode === "manual" ? "public" : "private"'), 'النشر الآن (قرار مالك) => public افتراضاً، والأتمتة => private');
add('content-schedule-private', server.includes('item.privacyStatus = "private"') && server.includes('(publishAtIso ? "private" : "public")'), 'الجدولة تُبقي الفيديو private حتى الموعد (خادم + إنشاء)');
add('content-privacy-verified-real', server.includes('privacyVerification') && /getVideos\(ensured\.token, \[externalVideoId\]\)/.test(server), 'يُقرأ الفيديو من YouTube للتأكد من الخصوصية الفعلية (لا ادعاء)');
add('content-privacy-mismatch-honest', server.includes('privacyActual') && server.includes('video_privacy_mismatch'), 'عدم تطابق الخصوصية لا يُسجَّل تحققاً كاملاً ويُسجَّل بأمان');
add('content-verified-only-with-provider', server.includes('const fullyVerified = delivered && Boolean(privacyVerification?.verified)'), 'verified لا تُعلن إلا بتحقق فعلي من المزود (خصوصية + وصف)');
add('content-verification-substantiated', contentPipeline.includes('isVerificationSubstantiated') && server.includes('isVerificationSubstantiated({') && server.includes('case "contentVerified": return isVerificationSubstantiated(i)'), 'لا يُعلن تحقق بلا دليل فعلي (معرّف مزود + حالة نشر/جدولة) في الملخص والبطاقات والتحميل');
add('content-verification-load-guard', /verified: isVerificationSubstantiated\(\{/.test(server), 'التحقق غير المُدعَّم بدليل يُسقَط عند تحميل الحالة (بيانات قديمة لا تدّعي تحققاً)');
add('content-manual-readiness-exposed', contentPipeline.includes('contentManualReadiness') && contentPanel.includes('canPublishNow') && contentPanel.includes('publishPrivacyStatus'), 'جاهزية القرار المباشر والخصوصية المتوقعة معروضة في الواجهة');
add('content-test-cleanup-owner-only', /app\.post\("\/api\/platforms\/youtube\/content\/cleanup-test-data", requireOwner/.test(server), 'تنظيف بيانات الاختبار محصور بالمالك');
add('content-test-cleanup-proof-based', contentPipeline.includes('classifyContentRecord') && server.includes('classifyContentRecord(i)'), 'التصنيف اختبار/إنتاج بدليل موثّق لا بتخمين');
add('content-test-cleanup-protects-real', server.includes('keptRealVideo') && /filter\(\(c\) => !c\.externalVideoId\)/.test(server), 'بيانات الاختبار المرتبطة بفيديو حقيقي لا تُحذف مطلقاً');
add('content-manual-mode-tests', contentPipelineTest.includes('contentManualReadiness') && contentPipelineTest.includes('classifyContentRecord'), 'اختبارات وحدة لجاهزية القرار المباشر وتصنيف بيانات الاختبار');
add('content-manual-integration-tests', read('engine/tests/content.pipeline.integration.test.ts').includes('يمكن نشر الآن يدوياً رغم تعطيل autoPublish'), 'اختبار تكاملي يثبت استقلال القرار المباشر عن الأتمتة');
add('content-scheduled-due-evaluator', contentPipeline.includes('evaluateDueScheduledContent') && contentPipeline.includes('VERIFIED_PUBLIC_ON_YOUTUBE') && contentPipeline.includes('SCHEDULED_STILL_NOT_PUBLIC'), 'حكم حتمي لعنصر مجدول حلّ موعده: لا VERIFIED إلا بحالة public فعلية من المزود');
add('content-scheduled-due-sweep-reads-provider', server.includes('verifyDueScheduledContent') && /getVideos\(ensured\.token, \[externalVideoId\]\)/.test(server) && server.includes('evaluateDueScheduledContent('), 'دورة المراقبة تقرأ حالة المجدول الحقيقية من YouTube وتُغلق SCHEDULED→VERIFIED بدليل');
add('content-scheduled-due-in-cycle', /const scheduledCheck = await verifyDueScheduledContent\(\);/.test(server) && server.includes('scheduledCheck'), 'فحص المجدولات مدمج في دورة المراقبة الدائمة ويُعلن نتيجته');
add('content-scheduled-due-tests', contentPipelineTest.includes('evaluateDueScheduledContent') && read('engine/tests/content.pipeline.integration.test.ts').includes('public فعلي => تحقق واحد'), 'اختبارات وحدة وتكامل لفحص المجدولات عند حلول الموعد');

// --- Batch 25: وصف YouTube عبر العقل المركزي + إلغاء مؤكَّد + عقد وقت النشر (عقد الجوال) ---
const youtubeDescModule = fs.existsSync(path.join(root, 'engine/social/youtubeDescription.ts')) ? fs.readFileSync(path.join(root, 'engine/social/youtubeDescription.ts'), 'utf8') : '';
const contentIntegrationTest = read('engine/tests/content.pipeline.integration.test.ts');
add('youtube-description-module', youtubeDescModule.includes('buildDeterministicYouTubeDescription') && youtubeDescModule.includes('verifyUploadedDescription'), 'وحدة وصف YouTube (صياغة حتمية + تحقق وصول) موجودة');
add('youtube-description-deterministic-honest', youtubeDescModule.includes('buildDeterministicYouTubeDescription') && youtubeDescModule.includes('factsUsed') && !/cashPrice|سعر\s*[:=]\s*\d/.test(youtubeDescModule), 'الصياغة الحتمية مبنية على الحقائق المُمرَّرة فقط بلا اختراع سعر');
add('youtube-description-central-brain', server.includes('generateYouTubeContentDescription') && /aiEngine\.run\(\{[\s\S]{0,400}youtube_description/.test(server), 'توليد الوصف يمر بالعقل المركزي AiEngine (Gemini Firewall: cache/quota/breaker/fallback)');
add('youtube-description-owner-only', /app\.post\("\/api\/platforms\/youtube\/content\/generate-description", requireOwner/.test(server), 'توليد الوصف محصور بالمالك');
add('youtube-description-safety-guard', /generateYouTubeContentDescription[\s\S]{0,1600}ensureSafeBusinessText\(result\.text, facts/.test(server), 'نص الوصف يمر بحارس السلامة على النص الفعلي عبر المصدر الواحد (مزود أو بديل)');
add('youtube-description-verify-real', server.includes('verifyUploadedDescription') && /verifyUploadedDescription\(description, row \? row\.description : null\)/.test(server), 'تحقق وصول الوصف يُقرأ من YouTube فعلاً (لا ادعاء)');
add('youtube-description-verified-composed', server.includes('const fullyVerified = delivered && Boolean(privacyVerification?.verified)'), 'verified لا تُعلن إلا باجتماع الخصوصية والوصف فعلاً');
add('youtube-description-mismatch-honest', server.includes('video_description_mismatch') && server.includes('descriptionVerified'), 'عدم تطابق/غياب الوصف لا يُسجَّل تحققاً ويُسجَّل بأمان');
add('youtube-description-ui', panelTsx.includes('generateYouTubeContentDescription') && panelTsx.includes('verifiedDescription'), 'الواجهة توفّر صياغة الوصف وتعرض حالة إثباته');
add('youtube-description-test', fs.existsSync(path.join(root, 'engine/tests/youtube.description.test.ts')) && Boolean(pkg.scripts['test:youtube-description']) && pkgTest.includes('test:youtube-description'), 'اختبار وصف YouTube مسجّل وضمن npm test');
add('content-cancel-action-confirmed', panelTsx.includes("action === 'cancel'") && panelTsx.includes('window.confirm'), 'زر الإلغاء فعلي ومؤكَّد قبل التنفيذ (منفصل عن شارة الحالة)');
add('content-cancel-terminal-verified', contentIntegrationTest.includes('لا نقض بعد الإلغاء') && contentIntegrationTest.includes('الإلغاء متاح ضمن العمليات المسموحة'), 'اختبار تكاملي يثبت الإلغاء وحالة CANCELLED النهائية');
add('content-publish-time-wallclock-contract', contentIntegrationTest.includes('المعروض يطابق ما اختاره المالك') && panelTsx.includes('toScheduleDisplay(it.publishAt)') && !panelTsx.includes('new Date(it.publishAt).toLocaleString'), 'وقت النشر: المحفوظ == المعروض بسياسة المنطقة (لا زحزحة UTC ولا تغيير لمكوّن الوقت)');
const decisionTest = read('engine/tests/youtube.decision.test.ts');

// --- دقة قرارات الـwatcher وتفسير التعليقات الحقيقية (Batch 23) ---
add('youtube-decision-code-stage-map', watcherModule.includes('YOUTUBE_DECISION_CODE_STAGES') && watcherModule.includes('isExplicitTerminalDecision'), 'خريطة صريحة بين كود القرار والمرحلة الطرفية');
add('youtube-terminal-decision-forced', watcherModule.includes('stage: YouTubeCommentStage, code: string | null | undefined') && watcherModule.includes('return allowed.includes(stage)'), 'لا «معالجة بلا قرار»: المرحلة يجب أن تطابق الكود');
add('youtube-channel-skip-has-code', watcherModule.includes('SKIP_OUT_OF_CHANNEL_CONTEXT'), 'تجاهل خارج سياق القناة يحمل كوداً صريحاً (سلطة التنفيذ في الوحدة — Batch 8.1)');
add('youtube-reply-blocked-has-code', server.includes('ESCALATE_REPLY_NOT_READY'), 'حجب الرد يحمل كود تصعيد صريح لا REPLY_ALLOWED');
add('youtube-reconcile-endpoint', server.includes('/api/agent/youtube/watcher/reconcile') && server.includes('buildWatcherReconciliation'), 'مسار مطابقة تشخيصي للتعليقات الحقيقية');
add('youtube-reconcile-read-only', /function buildWatcherReconciliation[\s\S]*?readOnly: true/.test(server) && !server.slice(server.indexOf('function buildWatcherReconciliation'), server.indexOf('app.get("/api/agent/youtube/watcher/reconcile"')).includes('executeYouTubeReply'), 'المطابقة قراءة فقط بلا أي إرسال رد');
add('youtube-reconcile-owner-only', /app.get\("\/api\/agent\/youtube\/watcher\/reconcile", requireOwner/.test(server), 'المطابقة للمالك فقط');
add('youtube-reconcile-reports-undetected', server.includes('undetectedReason') && server.includes('terminalDecisionViolations'), 'تُعلن التعليقات غير المكتشفة والمخالفات بلا اختلاق');
add('youtube-scan-window-configurable', server.includes('commentScanVideoLimitFromEnv()') && read('engine/social/youtube.ts').includes('resolveCommentScanVideoLimit'), 'نافذة فحص التعليقات قابلة للضبط بحدود آمنة');
add('youtube-scan-window-bounded', read('engine/social/youtube.ts').includes('YOUTUBE_COMMENT_SCAN_MAX_VIDEOS = 25'), 'حد أقصى صريح لنافذة الفحص (لا استهلاك غير محدود)');
add('youtube-decision-tests', fs.existsSync(path.join(root, 'engine/tests/youtube.decision.test.ts')) && pkg.scripts['test:youtube-decision'], 'اختبار انحدار قرارات الـwatcher مسجّل');
add('youtube-decision-tests-in-suite', typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:youtube-decision'), 'اختبار القرارات ضمن npm test');
add('youtube-praise-real-comment', decisionTest.includes('عاشت إيدكم') && decisionTest.includes("c.intent === 'praise'"), '«عاشت إيدكم» تُصنَّف مدحاً في الاختبار');
add('youtube-inquiry-real-comment', decisionTest.includes('شنو نوع الموبايل'), '«شنو نوع الموبايل» مغطّى في الاختبار بلا اختراع');
add('youtube-no-fake-reply-claim', decisionTest.includes('externalReplyId') && decisionTest.includes('FAILED'), 'لا ادعاء تسليم بلا معرّف رد حقيقي');
add('youtube-decision-no-ai', !/GoogleGenAI|generateContent/.test(watcherModule) && !/from ['"]\\.\\.\/ai\//.test(watcherModule), 'محرك القرارات حتمي بلا أي نداء AI (صفر حصة)');

// ============================================================================
// C1 — حارس حصة YouTube Data API (منصة واحدة مركزية، بلا تفريع على اسم منصة).
// C2 — تنبيهات فشل/إعادة ربط المراقب (نفس pushNotification القائم).
// ============================================================================
const quotaModule = read('engine/social/youtubeQuota.ts');
const alertsModule = read('engine/social/watcherAlerts.ts');
const quotaUnitTest = fs.existsSync(path.join(root, 'engine/tests/youtube.quota.test.ts')) ? read('engine/tests/youtube.quota.test.ts') : '';
const quotaIntegrationTest = fs.existsSync(path.join(root, 'engine/tests/youtube.quota.integration.test.ts')) ? read('engine/tests/youtube.quota.integration.test.ts') : '';
const storageAdapter = read('engine/storage/adapter.ts');

add('youtube-quota-single-source', quotaModule.includes('export class YouTubeQuotaLedger') && quotaModule.includes('export function classifyYouTubeQuotaOperation') && quotaModule.includes('export const YOUTUBE_QUOTA_COST'), 'حارس حصة YouTube مصدر واحد (سجل + تصنيف + تكلفة)');
add('youtube-quota-costs-official', /upload:\s*1600/.test(quotaModule) && /reply:\s*50/.test(quotaModule) && /video_update:\s*50/.test(quotaModule) && /comments_read:\s*1/.test(quotaModule), 'تكاليف الوحدات مطابقة لوثيقة YouTube Data API');
add('youtube-quota-upload-session-no-double', quotaModule.includes('upload_session: 0') && quotaModule.includes("m === 'PUT' ? 'upload_session' : 'upload'"), 'PUT بايتات الجلسة لا يحتسب الـ1600 مرتين');
add('youtube-quota-token-excluded', quotaModule.includes('youtubeUrlCountsAgainstQuota') && quotaModule.includes("includes('/token')"), 'نقطة الرمز /token مستثناة من حصة Data API');
add('youtube-quota-central-wrapper', server.includes('function youtubeGuardedFetch') && server.includes('const youtubeFetchImpl: YouTubeFetch = (url, init) => youtubeGuardedFetch(url, init)'), 'مغلّف واحد يمرّ عليه كل طلب YouTube تلقائياً (بلا احتساب يدوي)');
add('youtube-quota-proactive-guard', server.includes('function canRunYouTubeOperation') && server.includes('youtubeQuotaExhausted') && server.includes("reason: 'quotaExceeded'"), 'حارس استباقي يرفض بلا شبكة عند الاستنفاد (safe failure)');
add('youtube-quota-alert-once', server.includes('youtubeQuotaAlertSent') && server.includes("'youtube_quota_warning'") && server.includes('youtubeQuotaAlertReason(status)'), 'تنبيه واحد للمالك عند بلوغ العتبة (بلا إغراق)');
add('youtube-quota-threshold-honest', quotaModule.includes('thresholdReached') && quotaModule.includes('exhausted') && quotaModule.includes('remainingUnits') && quotaModule.includes('usedPercent'), 'الحالة تعلن العتبة/الاستنفاد/المتبقي بصدق');
add('youtube-quota-durable', storageAdapter.includes('STORAGE_KEY_YOUTUBE_QUOTA') && server.includes('function saveYouTubeQuota') && server.includes('function loadYouTubeQuota') && server.includes('youtubeQuotaLedger.restore'), 'عدّاد الحصة وأعلام التنبيه تصمد بعد restart/نشر');
// M2: النقطتان العامتان تعلنان ملخص الحصة فقط؛ التفاصيل الكاملة في مسار المالك المحمي.
add('youtube-quota-exposed-health', (server.match(/youtubeQuota: youtubeQuotaStatusSummary\(\)/g) || []).length >= 2 && server.includes('app.get("/api/agent/youtube/quota", authenticateToken'), 'كتلة youtubeQuota معلنة في /api/health و/api/readiness (ملخص عام) وتفاصيلها في مسار المالك');
add('youtube-quota-no-secret', !/(client_secret|clientSecret|refresh_token|access_token|GOOGLE_OAUTH)/.test(quotaModule) && quotaModule.includes('note:'), 'وحدة الحارس بلا أي سرّ وتُعلن أن الرقم تقديري');
add('youtube-quota-regression-test', Boolean(pkg.scripts['test:youtube-quota']) && quotaUnitTest.includes('YOUTUBE_QUOTA_COST.upload === 1600') && quotaUnitTest.includes('classifyYouTubeQuotaOperation'), 'اختبار وحدة للحارس مسجّل ويغطي التكاليف والتصنيف');
add('youtube-quota-test-in-suite', typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:youtube-quota &&') && pkg.scripts.test.includes('test:youtube-quota-integration &&'), 'اختبارا الحارس ضمن npm test');
add('youtube-quota-integration-test', Boolean(pkg.scripts['test:youtube-quota-integration']) && quotaIntegrationTest.includes('channel_read') && quotaIntegrationTest.includes('quota_exceeded'), 'اختبار تكامل: احتساب تلقائي + حجب عند الاستنفاد + ثبات بعد restart');
add('watcher-alerts-single-source', alertsModule.includes('export function shouldAlertWatcherFailure') && alertsModule.includes('export function shouldAlertReauth') && alertsModule.includes('export function watcherFailureAlertText') && alertsModule.includes('export function reauthAlertText'), 'منطق تنبيهات المراقب مصدر واحد (فشل متكرر + reauth)');
add('watcher-alerts-no-dup', server.includes('function maybeAlertWatcherFailure') && server.includes('function clearWatcherFailureAlert') && server.includes('watcherAlertState.errorAlerted'), 'تنبيه الفشل مرة واحدة لكل سلسلة (يُصفَّر عند النجاح)');
add('watcher-alerts-reauth', server.includes('function maybeAlertYouTubeReauth') && server.includes('function clearYouTubeReauthAlert') && server.includes('shouldAlertReauth'), 'تنبيه reauth مرة واحدة حتى استعادة الاتصال');
add('watcher-alerts-wired', server.includes('maybeAlertWatcherFailure();') && server.includes('youtube_watcher_failure') && server.includes('youtube_reauth_needed'), 'التنبيهان موصولان في مسار المراقب وفحص الصحة');
add('watcher-alerts-tests', quotaUnitTest.includes('shouldAlertWatcherFailure') && quotaUnitTest.includes('shouldAlertReauth') && quotaIntegrationTest.includes('youtube_watcher_failure') && quotaIntegrationTest.includes('youtube_reauth_needed'), 'اختبارات التنبيهين (وحدة + تكامل) موصولة');


// ============================================================================
// Batch 26 — العقل المركزي العام (Platform-Agnostic) لكل المنصات.
// ============================================================================
const contentIntelligence = read('engine/social/contentIntelligence.ts');
const platformLearning = read('engine/social/platformLearning.ts');
const recommendationEngine = read('engine/social/recommendationEngine.ts');
const audienceIntelligence = read('engine/social/audienceIntelligence.ts');
const centralBrain = read('engine/social/centralBrain.ts');
const centralBrainTest = read('engine/tests/central.brain.test.ts');

add('central-brain-modules-exist',
  ['contentIntelligence', 'platformLearning', 'recommendationEngine', 'audienceIntelligence', 'centralBrain']
    .every((m) => fs.existsSync(path.join(root, `engine/social/${m}.ts`))),
  'وحدات العقل المركزي العامة موجودة');

add('content-intelligence-platform-agnostic',
  contentIntelligence.includes('PLATFORM_CONTENT_PROFILES') &&
  contentIntelligence.includes("'tiktok'") && contentIntelligence.includes("'google_business'") &&
  contentIntelligence.includes('adaptForPlatforms'),
  'طبقة ذكاء المحتوى تعرّف المنصات العشر بلا منطق خاص بمنصة واحدة');

add('content-plan-covers-ten-platforms',
  contentIntelligence.includes('adaptForPlatforms') && contentIntelligence.includes('platformAdaptations'),
  'ContentPlan ينتج تكييفاً لكل المنصات العشر');

add('platform-adaptation-deterministic-no-ai',
  !/GoogleGenAI|aiEngine|generateContent/.test(contentIntelligence) &&
  !/GoogleGenAI|aiEngine|generateContent/.test(recommendationEngine) &&
  !/GoogleGenAI|aiEngine|generateContent/.test(platformLearning),
  'التكييف والتوصيات والتعلّم حتمية بلا أي نداء AI (صفر حصة)');

add('learning-engine-general-not-youtube-only',
  platformLearning.includes('buildLearningSample') && platformLearning.includes('analyzePlatformLearning') &&
  platformLearning.includes('summarizeCrossPlatformLearning') && platformLearning.includes('metricAvailability'),
  'محرك التعلّم عام لكل المنصات ويقرأ توفر المؤشرات من جدول القدرات');

add('learning-no-fake-metrics',
  platformLearning.includes('unavailableMetrics') && platformLearning.includes('لا تُخترع قيمة بديلة لمؤشر غير متاح'),
  'التعلّم يعلن المؤشرات غير المتاحة بلا اختراع قيمة');

add('audience-intelligence-no-sensitive',
  audienceIntelligence.includes('demographicsAvailable: false') && audienceIntelligence.includes('سمات شخصية'),
  'تحليل الجمهور لا يستنتج سمات شخصية حساسة');

add('recommendation-explainable',
  recommendationEngine.includes('insufficient_sample') && recommendationEngine.includes('reason:') &&
  recommendationEngine.includes('limitations') && recommendationEngine.includes('sampleSize'),
  'كل توصية قابلة للتفسير (سبب/مصدر/عيّنة/حدود) وتعلن نقص العيّنة');

add('central-brain-platform-agnostic',
  centralBrain.includes('platformCapabilities') && centralBrain.includes('PLATFORM_SPECS') &&
  centralBrain.includes('buildCentralBrainSnapshot') && !/youtubeWatcher/.test(centralBrain),
  'المنسّق المركزي يعمل على PlatformId وقدرات السجل بلا اعتماد خاص بمنصة');

add('central-brain-comment-policy-respects-capability',
  centralBrain.includes('platformReadsComments') && centralBrain.includes('unsupported') &&
  centralBrain.includes("caps.includes('comments')"),
  'وحدة التعليقات تحترم قدرة المنصة وتعلن unsupported بدل ادعاء قراءة');

add('central-brain-endpoints',
  server.includes('app.get("/api/brain/diagnostics", requireOwner') &&
  server.includes('app.post("/api/brain/content-plan", authenticateToken') &&
  server.includes('app.get("/api/brain/learning", authenticateToken') &&
  server.includes('app.get("/api/brain/recommendations", authenticateToken') &&
  server.includes('app.get("/api/brain/audience", authenticateToken') &&
  server.includes('app.post("/api/brain/comment-intelligence", authenticateToken'),
  'مسارات العقل المركزي مسجّلة ومحمية');

add('central-brain-diagnostics-owner-only',
  /app\.get\("\/api\/brain\/diagnostics", requireOwner/.test(server),
  'تشخيص العقل المركزي محصور بالمالك');

add('central-brain-reads-no-gemini',
  !/aiEngine\.run|GoogleGenAI/.test(centralBrain) && server.includes('geminiUsedOnReads: false'),
  'قراءات العقل المركزي لا تستهلك Gemini');

add('central-brain-readiness-block',
  server.includes('centralBrain: (() =>') && server.includes('platformAgnostic: true') &&
  server.includes('audienceDemographicsAvailable: false'),
  'الجاهزية تعرض كتلة العقل المركزي الآمنة (بلا أسرار)');

add('central-brain-agent-tools',
  read('engine/agent/tools.ts').includes("id: 'brain_snapshot'") &&
  read('engine/agent/tools.ts').includes("id: 'brain_content_plan'") &&
  read('engine/agent/planner.ts').includes("step('brain_snapshot')"),
  'الوكيل المركزي يملك أدوات العقل ووظّفها في خطة التحليل');

add('central-brain-test-registered',
  fs.existsSync(path.join(root, 'engine/tests/central.brain.test.ts')) && pkg.scripts['test:central-brain'] &&
  typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:central-brain'),
  'اختبار العقل المركزي مسجّل وضمن npm test');

add('central-brain-test-antifabrication',
  centralBrainTest.includes('لا سعر مختلق') && centralBrainTest.includes('demographicsAvailable === false') &&
  centralBrainTest.includes('unsupported') && centralBrainTest.includes('tiktok reach غير متاح'),
  'اختبار العقل المركزي يثبت منع الاختراع واحترام القدرات');

add('central-brain-future-platform',
  centralBrainTest.includes('linkedin') && centralBrainTest.includes('المنصة 11'),
  'اختبار يثبت أن منصة مستقبلية تدخل بلا إعادة بناء العقل');

add('central-brain-ui-surface',
  fs.existsSync(path.join(root, 'src/components/agent/CentralBrainView.tsx')) &&
  app.includes("case 'central_brain': return <CentralBrainView />") &&
  read('src/components/common/Sidebar.tsx').includes("id: 'central_brain'") &&
  read('src/services/api.ts').includes('/api/brain/diagnostics'),
  'سطح العقل المركزي معروض في الواجهة وقائمة الجانب ومربوط بالـAPI');

add('central-brain-ui-no-publish',
  !/\/api\/platforms\/[^'"`]*\/publish|executeJob|replyTelegram|replyFacebook|replyInstagram|publishTikTok/.test(read('src/components/agent/CentralBrainView.tsx')),
  'سطح العقل لا ينفّذ أي نشر أو رد خارجي من الواجهة');

// --- العقل المركزي — وقت تشغيل 24/7 (Batch 5) ---
const brainRuntimeMod = read('engine/brain/brainRuntime.ts');
const brainRtCycleTest = read('engine/tests/brain/brain.runtime.cycle.test.ts');
const brainRtCycleServerTest = read('engine/tests/brain/brain.runtime.cycle.server.test.ts');

add('brain-runtime-module-single-source',
  fs.existsSync(path.join(root, 'engine/brain/brainRuntime.ts')) &&
  brainRuntimeMod.includes('runBrainRuntimeCycle') && brainRuntimeMod.includes('buildBrainRuntimeStatus'),
  'وحدة وقت تشغيل العقل موجودة كمصدر واحد للدورة والحالة');

add('brain-runtime-started-on-server',
  /startBrainRuntime\(\)/.test(server) && server.includes('BRAIN_RUNTIME_BOOT_DELAY_MS') &&
  server.includes('const BRAIN_RUNTIME_OWNER = '),
  'المُشغِّل الداخلي يُبدأ على الخادم بعد listen (بلا متصفح)');

add('brain-runtime-reuses-existing-persist',
  /runBrainRuntimeCycleInternal[\s\S]{0,2600}?persistBrainMemory\(records\)/.test(server) &&
  /runBrainRuntimeCycleInternal[\s\S]{0,2600}?buildRuntimeBrain\(\{/.test(server),
  'الدورة تستخدم منطق العقل القائم ومسار الحفظ القائم (لا نظام ثانٍ)');

add('brain-runtime-lock-and-lease',
  brainRuntimeMod.includes('acquireBrainLock') && brainRuntimeMod.includes('releaseBrainLock') &&
  brainRuntimeMod.includes('isBrainLockStale') && brainRuntimeMod.includes('staleLockRecoveries'),
  'قفل/lease يمنع التوازي ويستردّ المتقادم فلا جمود دائم');

add('brain-runtime-no-parallel-cycle',
  brainRuntimeMod.includes("'SKIPPED_LOCKED'") && server.includes('brainRuntimeInFlight'),
  'لا دورة متوازية: قفل العملية + lease');

add('brain-runtime-no-fake-success',
  brainRuntimeMod.includes("status: BrainCycleStatus = persistResult.ok") &&
  brainRuntimeMod.includes('persistenceFailureCount'),
  'لا ادّعاء نجاح حفظ: الحالة من نتيجة persist الحقيقية');

add('brain-runtime-no-fabrication',
  brainRuntimeMod.includes("noData ? 'NO_NEW_DATA' : 'SUCCESS'") &&
  brainRuntimeMod.includes('executesExternalActions: false') && brainRuntimeMod.includes('geminiUsedOnCycles: false'),
  'لا اختراع بيانات (NO_NEW_DATA)، ولا إجراء خارجي، ولا استهلاك Gemini');

add('brain-runtime-persists-state',
  server.includes('brainRuntime: brainRuntimeState,') && server.includes('normalizeBrainRuntimeState(control.brainRuntime)'),
  'حالة وقت التشغيل تُحفظ وتُسترجع عبر محوّل الحالة (تصمد بعد restart)');

add('brain-runtime-cadence-bounded',
  brainRuntimeMod.includes('BRAIN_RUNTIME_DEFAULT_INTERVAL_MS') && brainRuntimeMod.includes('BRAIN_RUNTIME_MIN_INTERVAL_MS') &&
  brainRuntimeMod.includes('BRAIN_RUNTIME_MAX_INTERVAL_MS') && brainRuntimeMod.includes('isBrainRuntimeDue'),
  'الإيقاع بحدود آمنة وقرار استحقاق زمني (لا دورة عند كل restart)');

add('brain-runtime-health-exposed',
  server.includes('brainRuntime: brainRuntimeStatus(),') && /brain: \(\(\) => \{[\s\S]{0,4000}?runtime: brainRuntimeStatus\(\)/.test(server),
  'حالة وقت التشغيل معلنة في /api/health و/api/readiness بلا سرّ');

add('brain-runtime-endpoints-owner',
  server.includes('"/api/agent/brain/runtime/run"') && server.includes('"/api/agent/brain/runtime"') &&
  /app\.post\("\/api\/agent\/brain\/runtime\/run", authenticateToken, requireOwner/.test(server),
  'مسارات وقت التشغيل محمية والملكية مطلوبة لتشغيل دورة');

add('brain-runtime-no-secrets',
  !/api[_-]?key|client_secret|refresh_token|access_token/i.test(brainRuntimeMod),
  'وحدة وقت التشغيل لا تحمل أي سرّ');

add('brain-runtime-tests',
  fs.existsSync(path.join(root, 'engine/tests/brain/brain.runtime.cycle.test.ts')) &&
  fs.existsSync(path.join(root, 'engine/tests/brain/brain.runtime.cycle.server.test.ts')) &&
  pkg.scripts['test:brain-runtime-cycle'] && pkg.scripts['test:brain-runtime-cycle-server'] &&
  typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:brain-runtime-cycle') && pkg.scripts.test.includes('test:brain-runtime-cycle-server'),
  'اختبارات وقت التشغيل (وحدة + تكامل) مسجّلة وضمن npm test');

add('brain-runtime-server-test-restart',
  brainRtCycleServerTest.includes('durability across real restart') &&
  brainRtCycleServerTest.includes('memoryHealth.total محفوظ بعد restart') &&
  brainRtCycleServerTest.includes('real YouTube reply via watcher'),
  'اختبار الخادم يثبت الحفظ من نتيجة حقيقية والثبات بعد restart فعلي');

add('brain-runtime-unit-test-guards',
  brainRtCycleTest.includes('duplicate memory prevention') && brainRtCycleTest.includes('commercial truth guards') &&
  brainRtCycleTest.includes('no non-YouTube platform logic') && brainRtCycleTest.includes('persistence failure'),
  'اختبار الوحدة يثبت منع التكرار وحماية الحقيقة التجارية وعدم الفشل الصامت');

add('brain-runtime-ui-surface',
  read('src/components/agent/CentralBrainView.tsx').includes('getBrainRuntime') &&
  read('src/components/agent/CentralBrainView.tsx').includes('وقت تشغيل العقل 24/7') &&
  read('src/services/api.ts').includes('/api/agent/brain/runtime') &&
  read('src/services/api.ts').includes('/api/agent/brain/runtime/run'),
  'لوحة العقل تعرض وقت التشغيل وتشغّل دورة (للمالك) بلا أي سرّ');

// --- فريق الوكلاء (Agent Council — Batch 6) ---
const teamDir = (p) => read(path.join('engine/brain/team', p));
const teamTruth = teamDir('truth.ts');
const teamTypes = teamDir('types.ts');
const teamAgents = teamDir('agents.ts');
const teamOrchestrator = teamDir('orchestrator.ts');
const teamRoutesSrc = teamDir('routes.ts');
const teamCouncilTest = read('engine/tests/brain/team.council.test.ts');
const teamCouncilServerTest = read('engine/tests/brain/team.council.server.test.ts');
const teamCouncilYoutubeTest = read('engine/tests/brain/team.council.youtube.test.ts');

add('agent-team-module-structure',
  ['truth.ts', 'types.ts', 'agents.ts', 'orchestrator.ts', 'routes.ts']
    .every((f) => fs.existsSync(path.join(root, 'engine/brain/team', f))),
  'وحدة فريق الوكلاء موجودة بمكوّناتها (حقيقة/أنواع/وكلاء/منسّق/مسارات)');

add('agent-team-truth-model-separation',
  teamTruth.includes("'FACT'") && teamTruth.includes("'DERIVED'") && teamTruth.includes("'HYPOTHESIS'") &&
  teamTruth.includes("'UNKNOWN'") && teamTruth.includes("'UNAVAILABLE'") &&
  teamTruth.includes('truthStateForEvidence'),
  'نموذج الصدق يفصل FACT/DERIVED/HYPOTHESIS/UNKNOWN/UNAVAILABLE صراحةً');

add('agent-team-hypothesis-not-promoted',
  teamTruth.includes('confirmTruthState') && teamTruth.includes('promoted: false') &&
  teamTruth.includes('promoteWithIndependentEvidence') && teamTruth.includes('independentSource'),
  'الفرضية لا تصبح حقيقة بالتأييد؛ الترقية تحتاج دليلاً مستقلاً فقط');

add('agent-team-agents-role-separated',
  teamTypes.includes('TEAM_AGENT_ROLE') && teamTypes.includes("research: 'observe'") &&
  teamTypes.includes("strategy: 'recommend'") && teamTypes.includes("critic: 'verify'") &&
  teamTypes.includes("decision: 'decide'"),
  'أدوار الوكلاء مفصولة (رصد/تحليل/توصية/تحقق/قرار) — لا تجاوز صلاحيات');

add('agent-team-capability-gated',
  teamAgents.includes('capabilityRow') && teamAgents.includes("'UNAVAILABLE'") &&
  teamAgents.includes('connectedPlatforms') && teamAgents.includes('verified'),
  'الفريق يحترم مصفوفة القدرات ولا يدّعي اتصالاً بلا توثيق');

add('agent-team-no-external-execution',
  !/executeYouTubeReply|executeYouTubePublish|publishNow|sendMessage|comments\.insert/.test(teamAgents + teamOrchestrator + teamRoutesSrc) &&
  !/app\.post\('\/api\/agent\/team\/(execute|publish|reply)/.test(teamRoutesSrc),
  'فريق الوكلاء لا ينفّذ أي إجراء خارجي (قرار مقترح فقط)');

add('agent-team-routes-authenticated-owner-run',
  teamRoutesSrc.includes("'/api/agent/team'") && teamRoutesSrc.includes("'/api/agent/team/:teamSessionId'") &&
  teamRoutesSrc.includes("'/api/agent/team/run'") &&
  /app\.post\('\/api\/agent\/team\/run', deps\.authenticateToken, deps\.requireOwner/.test(teamRoutesSrc),
  'مسارات الفريق محمية، والتشغيل للمالك فقط');

add('agent-team-wired-server',
  server.includes('registerTeamRoutes(app,') && server.includes('runTeamSessionNow') &&
  server.includes('teamSessionState'),
  'فريق الوكلاء موصول في server.ts بحقن التبعيات');

add('agent-team-triggered-by-real-event',
  /runTeamSessionNow\(\s*"youtube_event"/.test(server) && server.includes('comment:${String(c.commentId)}'),
  'جلسة الفريق تُشغَّل من حدث YouTube حقيقي داخل دورة المراقبة');

add('agent-team-reuses-brain-memory',
  server.includes('teamSessionToMemoryRecords') && server.includes('persistBrainMemory(records)') &&
  teamOrchestrator.includes("from '../memory/store'") && teamOrchestrator.includes('toMemoryRecord') &&
  !/new Map|CREATE TABLE|secondMemory|teamMemoryStore/i.test(teamOrchestrator),
  'قرار الفريق يُكتب في نفس ذاكرة العقل القائمة (لا نظام/جدول ثانٍ)');

add('agent-team-persists-state',
  server.includes('STORAGE_KEY_TEAM_SESSIONS') && server.includes('loadTeamSessionsSync') &&
  server.includes('normalizeTeamSessionState') && server.includes('persistTeamSessions'),
  'جلسات الفريق تُحفظ وتُسترجع عبر محوّل الحالة (تصمد بعد restart)');

add('agent-team-dedupe-by-event',
  teamOrchestrator.includes('teamDedupeKey') && teamOrchestrator.includes('findSessionByDedupeKey') &&
  teamOrchestrator.includes('upsertTeamSession') && teamOrchestrator.includes('options.existing.dedupeKey === dedupeKey'),
  'منع التكرار مشتق من هوية الحدث الحقيقي (لا جلسة مكررة)');

add('agent-team-critic-verifies-honestly',
  teamOrchestrator.includes('criticFailed') && teamAgents.includes('criticAgent') &&
  teamAgents.includes('rejected') && teamAgents.includes('بلا مصدر'),
  'الناقد يرفض الادعاءات غير المدعومة وفشله يجعل القرار غير مُتحقَّق');

add('agent-team-failure-isolated',
  teamOrchestrator.includes('safe(') && teamOrchestrator.includes('failedOutput') &&
  teamOrchestrator.includes("'partial'") && teamOrchestrator.includes('failedAgents'),
  'فشل وكيل لا يُسقط الجلسة ويُسجَّل صراحةً (حالة partial)');

add('agent-team-no-gemini-consumption',
  server.includes('geminiUsedOnSessions: false') && teamAgents.includes('aiAvailable') &&
  !/new GoogleGenAI|generateContent/.test(teamDir('agents.ts') + teamOrchestrator + teamRoutesSrc),
  'جلسات الفريق لا تستهلك Gemini (منطق حتمي)');

add('agent-team-no-secrets',
  !/api[_-]?key|client_secret|refresh_token|access_token|GEMINI_API_KEY/i.test(
    teamDir('agents.ts') + teamDir('truth.ts') + teamTypes + teamOrchestrator + teamRoutesSrc),
  'وحدة فريق الوكلاء لا تحمل أي سرّ');

add('agent-team-health-exposed',
  server.includes('agentTeam: {') && server.includes('summarizeTeamState(teamSessionState)') &&
  server.includes('executesExternalActions: false'),
  'حالة الفريق معلنة في /api/health و/api/readiness بلا سرّ');

add('agent-team-ui-surface',
  read('src/components/agent/AgentTeamCenter.tsx').includes('getTeamSessions') &&
  read('src/components/agent/AgentTeamCenter.tsx').includes('runTeamSession') &&
  read('src/components/agent/CentralBrainView.tsx').includes('AgentTeamCenter') &&
  read('src/services/api.ts').includes('/api/agent/team'),
  'لوحة الفريق موصولة في العقل المركزي عبر apiService بلا أي سرّ');

add('agent-team-tests',
  fs.existsSync(path.join(root, 'engine/tests/brain/team.council.test.ts')) &&
  fs.existsSync(path.join(root, 'engine/tests/brain/team.council.server.test.ts')) &&
  fs.existsSync(path.join(root, 'engine/tests/brain/team.council.youtube.test.ts')) &&
  pkg.scripts['test:team-council'] && pkg.scripts['test:team-council-server'] && pkg.scripts['test:team-council-youtube'] &&
  typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:team-council') &&
  pkg.scripts.test.includes('test:team-council-server') && pkg.scripts.test.includes('test:team-council-youtube'),
  'اختبارات الفريق (وحدة + خادم + تدفّق YouTube حقيقي) مسجّلة وضمن npm test');

add('agent-team-youtube-flow-test',
  teamCouncilYoutubeTest.includes('real YouTube event') &&
  teamCouncilYoutubeTest.includes('restart persistence') &&
  teamCouncilYoutubeTest.includes('deduplication'),
  'اختبار التدفّق يثبت حدث YouTube حقيقي => جلسة فريق + ثبات بعد restart + منع تكرار');


// --- Central Brain upgrade (طبقة العقل المركزي المُطوَّرة) ---
const brainDir = (p) => read(path.join('engine/brain', p));
const brainState = brainDir('state.ts');
const brainCaps = brainDir('strategy/capabilityMatrix.ts');
const brainTruth = brainDir('knowledge/truth.ts');
const brainMemory = brainDir('memory/longTerm.ts');
const brainAudience = brainDir('audience/audienceModel.ts');
const brainMarket = brainDir('market/commercialRelevance.ts');
const brainExp = brainDir('experiments/experimentEngine.ts');
const brainTiming = brainDir('timing/timingModel.ts');
const brainDecisions = brainDir('decisions/decisionEngine.ts');
const brainLearning = brainDir('learning/learningLoop.ts');
const brainPerception = brainDir('perception/signals.ts');
const brainConversation = brainDir('audience/conversationIntelligence.ts');
const brainContent = brainDir('strategy/contentIntelligence.ts');
const brainCycles = brainDir('cycles.ts');
const brainDryRun = brainDir('dryRun.ts');
const brainRoutes = brainDir('routes.ts');
const brainUpgradeTest = read('engine/tests/central.brain.upgrade.test.ts');
const brainIntegrationTest = read('engine/tests/brain.integration.test.ts');

add('brain-perception-single-source',
  brainPerception.includes('SIGNAL_SPECS') && brainPerception.includes('NOT_AVAILABLE') &&
  brainPerception.includes('hasValidSource') && !/aiEngine\.run|GoogleGenAI/.test(brainPerception),
  'طبقة الإدراك مصدر واحد للإشارات، والمؤشر غير المتاح يُعلن بلا قيمة مُختلقة');

add('brain-truth-five-states',
  ['VERIFIED_FACT', 'DERIVED_FACT', 'HYPOTHESIS', 'UNKNOWN', 'UNAVAILABLE', 'HUMAN_INPUT_REQUIRED', 'INSUFFICIENT_DATA'].every((s) => brainTruth.includes(s)) &&
  brainTruth.includes('classifyClaim') && brainTruth.includes('MIN_SAMPLE_FOR_VERIFIED'),
  'طبقة الحقيقة تفرّق بين موثّق/استنتاج/فرضية/مجهول/غير متاح/يحتاج مالك/بيانات ناقصة');

add('brain-no-fabricated-commercial-fact',
  brainTruth.includes('commercialFact') && brainTruth.includes('requiresHumanInput') &&
  brainTruth.includes('لا مصدر مسجّل'),
  'الحقائق التجارية بلا مصدر => HUMAN_INPUT_REQUIRED (لا سعر مُختلق)');

add('brain-memory-provenance',
  brainMemory.includes('MemoryOrigin') && brainMemory.includes('ai_statement') &&
  brainMemory.includes('isAiStatementTrusted') && brainMemory.includes('previouslyFailed'),
  'الذاكرة تحفظ الأصل والثقة، وقول AI لا يصبح حقيقة، والإخفاق السابق يُتذكّر');

add('brain-goals-with-signals',
  brainDir('goals/goalEngine.ts').includes('GOAL_SUCCESS_SIGNALS') &&
  brainDir('goals/goalEngine.ts').includes('UNAVAILABLE_SUCCESS_SIGNALS') &&
  brainDir('goals/goalEngine.ts').includes('DEFAULT_HARD_CONSTRAINTS'),
  'محرّك الأهداف يعلن إشارات نجاح متاحة/غير متاحة وقيوداً صلبة');

add('brain-audience-no-demographics',
  brainAudience.includes('AUDIENCE_NOT_AVAILABLE_FIELDS') && brainAudience.includes('demographicsAvailable: false') &&
  brainAudience.includes('لا تُخترع') && !/age.*=.*Math\.random|gender.*guess/.test(brainAudience),
  'نموذج الجمهور لا يستنتج سمات حساسة، والحقول غير المتاحة معلنة');

add('brain-commercial-funnel',
  brainMarket.includes('FUNNEL_ORDER') && brainMarket.includes('BUYING_SIGNAL') &&
  brainMarket.includes('compareByCommercialRelevance') && brainMarket.includes('RELEVANT_VIEW'),
  'الأهمية التجارية تُقاس بمراحل القُمع لا بالمشاهدات وحدها');

add('brain-experiment-single-variable',
  brainExp.includes('MIN_EXPERIMENT_EVIDENCE') && brainExp.includes('inconclusive') &&
  brainExp.includes('variable: string') && brainExp.includes('supports_hypothesis'),
  'التجارب بمتغيّر واحد، ولا حكم بلا عيّنة كافية (inconclusive)');

add('brain-timing-baghdad-single-source',
  brainTiming.includes('APP_TIMEZONE') && brainTiming.includes('TIMING_MIN_SAMPLE') &&
  brainTiming.includes('insufficient_sample') && brainTiming.includes("from '../../../src/utils/scheduleTime'"),
  'التوقيت يعتمد المصدر الواحد Asia/Baghdad، ولا «أفضل وقت» بلا عيّنة');

add('brain-capability-matrix-five-states',
  ['AVAILABLE', 'PARTIAL', 'REQUIRES_REVIEW', 'NOT_AVAILABLE', 'OWNER_ONLY'].every((s) => brainCaps.includes(s)) &&
  brainCaps.includes('PLATFORM_SPECS') && brainCaps.includes('CAPABILITY_KEYS'),
  'مصفوفة القدرات خمس حالات صريحة ومشتقة من السجل');

add('brain-tiktok-comments-not-available',
  brainCaps.includes('comments: \'NOT_AVAILABLE\'') && brainCaps.includes('messaging: \'NOT_AVAILABLE\'') &&
  brainCaps.includes("publish: 'REQUIRES_REVIEW'"),
  'TikTok: التعليقات والرسائل NOT_AVAILABLE، والنشر REQUIRES_REVIEW — بلا ادعاء');

add('brain-decisions-autonomy-levels',
  brainDecisions.includes('L5') && brainDecisions.includes('human_required') &&
  brainDecisions.includes('not_available') && brainDecisions.includes('SAFE_LOCAL_KINDS') &&
  brainDecisions.includes('reversible'),
  'محرّك القرارات يفصل آلي/مقترح/بشري/محجوب/غير متاح مع مستويات L0..L5');

add('brain-no-autonomous-external-execution',
  !/fetch\(|axios|http\.request|executeJob|publishTikTok|replyTelegram/.test(brainDecisions) &&
  !/fetch\(|axios/.test(brainCycles) && !/fetch\(|axios/.test(brainDryRun),
  'العقل لا ينفّذ أي إجراء خارجي (لا شبكة في القرار/الدورات/dry-run)');

add('brain-learning-owner-preference-not-fact',
  brainLearning.includes('OwnerPreference') && brainLearning.includes('isCommercialFact: false') &&
  brainLearning.includes('OWNER_PREFERENCE_MIN_EVIDENCE') && brainLearning.includes('LEARNING_MIN_SAMPLE'),
  'التعلّم من أحداث حقيقية، وتفضيل المالك ليس حقيقة تجارية');

add('brain-conversation-loops',
  brainConversation.includes('proposeContentFromNeed') && brainConversation.includes('runSalesLoop') &&
  brainConversation.includes('escalate_owner') && brainConversation.includes('aggregateRepeatedNeeds'),
  'حلقات comment→content وcomment→sales مع تصعيد السعر غير الموثّق للمالك');

add('brain-video-quality-no-invented-cause',
  brainContent.includes('analyzeVideoQuality') && brainContent.includes('possibleCause') &&
  brainContent.includes('retentionAvailable') && brainContent.includes('PERFORMANCE_DIMENSION_LABELS_AR'),
  'تحليل جودة الفيديو يعطي احتمال سبب لا يقيناً، ولا يحلّل بلا بيانات احتفاظ');

add('brain-state-aggregates-layers',
  brainState.includes('buildCentralBrainState') && brainState.includes('brainDiagnostics') &&
  brainState.includes('brainIsPlatformAgnostic') && brainState.includes('buildCrossPlatformAudienceModel'),
  'اللقطة الموحّدة تجمع الطبقات وتجيب اختبار منصة #11');

add('brain-cycles-no-external-action',
  brainCycles.includes('runDailyBrainCycle') && brainCycles.includes('runWeeklyBrainReview') &&
  brainCycles.includes('externalAction: false'),
  'الدورة اليومية/الأسبوعية تحليلية فقط بلا إجراء خارجي');

add('brain-dry-run-honest',
  brainDryRun.includes('externalActionTaken: false') && brainDryRun.includes('whatIKnow') &&
  brainDryRun.includes('whatIDontKnow') && brainDryRun.includes('whatRequiresOwnerApproval'),
  'dry-run يفصل المعروف/المجهول/الموافقة ويتوقف قبل أي إجراء');

add('brain-routes-read-only',
  brainRoutes.includes("app.get('/api/agent/brain/state'") &&
  brainRoutes.includes("app.get('/api/agent/brain/capabilities'") &&
  brainRoutes.includes('deps.requireOwner') && !/app\.post\(|app\.put\(|app\.delete\(/.test(brainRoutes),
  'مسارات العقل قراءة فقط (GET)، وdry-run للمالك — بلا أي مسار كتابة');

add('brain-server-registered',
  server.includes('registerBrainRoutes(app, {') && server.includes('brain: (() =>') &&
  server.includes('executesExternalActions: false') && server.includes('audienceDemographicsAvailable'),
  'مسارات العقل مسجّلة في الخادم وكتلة brain في /api/readiness صادقة');

add('brain-tests-registered',
  fs.existsSync(path.join(root, 'engine/tests/central.brain.upgrade.test.ts')) &&
  fs.existsSync(path.join(root, 'engine/tests/brain.integration.test.ts')) &&
  pkg.scripts['test:brain-upgrade'] && pkg.scripts['test:brain-integration'] &&
  pkg.scripts.test.includes('test:brain-upgrade') && pkg.scripts.test.includes('test:brain-integration'),
  'اختبارات العقل المُطوَّرة مسجّلة وضمن npm test');

add('brain-tests-antifabrication',
  brainUpgradeTest.includes('لا صفر مُختلق') && brainUpgradeTest.includes('demographicsAvailable === false') &&
  brainUpgradeTest.includes('لا SALE بلا مصدر') && brainUpgradeTest.includes('سعر غير موثّق => تصعيد للمالك') &&
  brainUpgradeTest.includes('noSALE') === false,
  'اختبارات العقل تثبت منع الاختراع وتصعيد الحقائق التجارية غير الموثّقة');

add('brain-tests-no-external-execution',
  brainUpgradeTest.includes('dry-run بلا إجراء خارجي') && brainUpgradeTest.includes('دورة يومية بلا إجراء خارجي') &&
  brainIntegrationTest.includes('externalActionTaken === false') && brainIntegrationTest.includes('لا تنفيذ خارجي'),
  'الاختبارات تثبت أن العقل لا ينفّذ إجراءً خارجياً');

add('brain-ui-panel',
  read('src/components/agent/CentralBrainView.tsx').includes('getBrainCapabilities') &&
  read('src/components/agent/CentralBrainView.tsx').includes('getBrainDryRun') &&
  read('src/components/agent/CentralBrainView.tsx').includes('مصفوفة قدرات المنصات') &&
  read('src/services/api.ts').includes('/api/agent/brain/state') &&
  read('src/services/api.ts').includes('/api/agent/brain/dry-run'),
  'واجهة العقل تعرض مصفوفة القدرات وصناديق الصدق وسيناريو dry-run');

// --- ربط العقل بالتشغيل + الذاكرة الدائمة (Batch 2) ---
const brainRuntime = read('engine/brain/runtime.ts');
const brainMemoryStore = read('engine/brain/memory/store.ts');
const brainCompat = read('engine/brain/compat.ts');
const brainMemoryTest = read('engine/tests/brain.memory.persistence.test.ts');
const brainRuntimeTest = read('engine/tests/brain.runtime.test.ts');
const brainRuntimeServerTest = read('engine/tests/brain.runtime.server.test.ts');

add('brain-runtime-aggregates-real-data',
  brainRuntime.includes('buildRuntimeBrain') && brainRuntime.includes('buildLearningEvents') &&
  brainRuntime.includes('performanceRecordsForBrain') === false &&
  brainRuntime.includes('records: PlatformMetricRecord[]') && brainRuntime.includes('comments: RuntimeComment[]') &&
  brainRuntime.includes('replies: RuntimeReply[]') && brainRuntime.includes('publishes: RuntimePublish[]') &&
  brainRuntime.includes('watcher: RuntimeWatcherEntry[]'),
  'طبقة التشغيل تجمع بيانات حقيقية (سجلات/تعليقات/ردود/نشر/مراقب) بلا شبكة');

add('brain-runtime-no-invention',
  brainRuntime.includes('observedProviderIds') &&
  brainRuntime.includes('providerId = r.providerReplyId || null') && brainRuntime.includes('dedupeLearningEvents'),
  'التشغيل لا يخترع معرّفات؛ providerId يُشتق من النتيجة الفعلية فقط');

add('brain-memory-store-persistent',
  brainMemoryStore.includes('BrainMemoryRecord') && brainMemoryStore.includes('upsertMemoryRecord') &&
  brainMemoryStore.includes('memoryToKnowledge') && brainMemoryStore.includes('summarizeBrainMemory') &&
  brainMemoryStore.includes('ai_statement') && brainMemoryStore.includes('staleReason'),
  'مخزن الذاكرة يحمل الأصل والثقة والتقادم، ويحوّل قول AI إلى فرضية لا حقيقة');

add('brain-memory-server-wired',
  server.includes('STORAGE_KEY_BRAIN_MEMORY') && server.includes('loadBrainMemorySync') &&
  server.includes('persistBrainMemory') && server.includes('normalizeBrainMemory') &&
  server.includes('storageAdapter.write(STORAGE_KEY_BRAIN_MEMORY'),
  'الذاكرة الدائمة مربوطة بمحوّل الحالة القائم (ملف/Postgres) وتُحمّل عند الإقلاع');

add('brain-runtime-input-real-sources',
  server.includes('brainRuntimeInput') && server.includes('brainRuntimeComments') &&
  server.includes('brainRuntimeReplies') && server.includes('brainRuntimePublishes') &&
  server.includes('brainRuntimeWatcher') && server.includes('brainVerifiedFacts') &&
  server.includes('brainProductFacts') && server.includes('performanceRecordsForBrain()'),
  'مدخلات العقل تُجمع من مصادر التطبيق الحقيقية (سوشيال/نشر/مراقب/بيانات المعرض)');

add('brain-routes-use-runtime',
  brainRoutes.includes('buildRuntimeBrain') && brainRoutes.includes('runtimeInput') &&
  brainRoutes.includes('persistMemory') && brainRoutes.includes('/api/agent/brain/content-path'),
  'مسارات العقل تستخدم طبقة التشغيل وتحفظ الذاكرة الدائمة');

add('brain-readiness-runtime-honest',
  server.includes('memoryHealth') && server.includes('memoryDurable') &&
  server.includes('contentPathAvailable') && server.includes('supportedRecommendations'),
  '/api/readiness يعرض صحة الذاكرة وتوفر مسار المحتوى بلا أي سرّ');

add('brain-runtime-tests-registered',
  fs.existsSync(path.join(root, 'engine/tests/brain.runtime.test.ts')) &&
  fs.existsSync(path.join(root, 'engine/tests/brain.runtime.server.test.ts')) &&
  fs.existsSync(path.join(root, 'engine/tests/brain.memory.persistence.test.ts')) &&
  pkg.scripts['test:brain-runtime'] && pkg.scripts['test:brain-runtime-server'] &&
  pkg.scripts['test:brain-memory'] &&
  pkg.scripts.test.includes('test:brain-runtime') && pkg.scripts.test.includes('test:brain-runtime-server') &&
  pkg.scripts.test.includes('test:brain-memory'),
  'اختبارات طبقة التشغيل والذاكرة (بما فيها ثبات Postgres) مسجّلة وضمن npm test');

// --- التوحيد canonical: مصدر حالة واحد (Batch 2 final fix) ---
add('brain-canonical-single-source',
  brainCompat.includes('toCentralBrainSnapshot') &&
  !brainCompat.includes('buildRecommendationBundle') &&
  !brainCompat.includes('analyzeCrossPlatformAudience') &&
  !brainCompat.includes('summarizeCrossPlatformLearning') &&
  !brainCompat.includes('buildCentralBrainSnapshot') &&
  brainCompat.includes('state.recommendations') &&
  brainCompat.includes('state.crossPlatformLearning'),
  'الشكل القديم يُشتق من الحالة canonical عبر facade توافقية لا تُعيد تشغيل أي محرّك توصية/جمهور/تعلّم مستقل');

// --- إزالة العقل الموازي: مصدر قرار/ذاكرة واحد (REMOVE-LAST-PARALLEL-BRAIN) ---
const brainProjections = read('engine/brain/projections.ts');
const socialRoutesSrc = read('engine/social/routes.ts');
const socialBrain = read('engine/social/brain.ts');

add('brain-projections-single-source',
  fs.existsSync(path.join(root, 'engine/brain/projections.ts')) &&
  brainProjections.includes('toMarketingDecisionProjection') &&
  brainProjections.includes('toOperationalMemoryProjection') &&
  brainProjections.includes('CentralBrainState'),
  'إسقاطات القرار/الذاكرة التوافقية موجودة في engine/brain/projections.ts وتُشتق من الحالة canonical');

add('brain-projections-no-independent-logic',
  !/buildRecommendationBundle|recommendPlatformFocus|analyzeCrossPlatformAudience|buildLearningLoop|buildStrategyPlan|aiEngine|GoogleGenAI|generateContent/.test(brainProjections),
  'إسقاطات القرار/الذاكرة لا تُعيد تشغيل أي محرّك توصية/جمهور/تعلّم/استراتيجية ولا تستهلك AI');

add('brain-no-runtime-consumers',
  !/social\/brain|from '\.\/brain'/.test(server) &&
  !/social\/brain|from '\.\/brain'/.test(socialRoutes),
  'engine/social/brain.ts بلا أي مستهلك runtime (لا الخادم ولا مسارات السوشيال)');

add('social-brain-marked-legacy',
  socialBrain.includes('LEGACY') && socialBrain.includes('TEST-ONLY'),
  'engine/social/brain.ts موثّق صراحةً LEGACY / TEST-ONLY');

add('marketing-decision-canonical-projection',
  socialRoutesSrc.includes('toMarketingDecisionProjection') &&
  socialRoutesSrc.includes('centralBrainState') &&
  server.includes('toMarketingDecisionProjection') &&
  !socialRoutesSrc.includes('buildMarketingDecision'),
  'مسار /api/social/manager/brain/decision وأداة marketing_decision إسقاط من الحالة canonical (لا مُنتِج قرار ثانٍ)');

add('memory-snapshot-canonical-projection',
  socialRoutesSrc.includes('toOperationalMemoryProjection') &&
  server.includes('toOperationalMemoryProjection') &&
  !socialRoutesSrc.includes('buildMemorySnapshot'),
  'مسار /api/social/manager/memory وأداة memory_snapshot إسقاط من الحالة canonical (لا بناء ذاكرة مستقل)');

add('brain-canonical-readiness-reuses',
  /app\.get\("\/api\/readiness"[\s\S]{0,400}buildRuntimeBrain/.test(server) &&
  server.includes('const readinessBrain = buildRuntimeBrain') &&
  server.includes('toCentralBrainSnapshot(readinessBrain.state)'),
  '/api/readiness يبني العقل canonical مرة واحدة وتُشتق منه centralBrain + brain');

add('brain-canonical-legacy-routes-use-facade',
  server.includes('canonicalBrainSnapshot') &&
  server.includes('toCentralBrainSnapshot(canonical.state') &&
  server.includes('toCentralBrainSnapshot(canonical.state, { engagementTimestamps'),
  'مسارات /api/brain/* وأداة brain_snapshot تستخدم facade من الحالة canonical لا بناءً مستقلاً');

add('brain-canonical-legacy-not-a-source',
  server.includes('canonicalBrainSnapshot') &&
  /app\.get\("\/api\/brain\/diagnostics"[\s\S]{0,300}canonicalBrainSnapshot|app\.get\("\/api\/brain\/diagnostics"[\s\S]{0,300}buildRuntimeBrain/.test(server) &&
  centralBrain.includes('هذا ليس مصدر الحقيقة'),
  'مُنشئ اللقطة القديم موثّق كغير مصدر، والمسارات كلها من الحالة canonical');

add('brain-memory-postgres-test-real',
  brainMemoryTest.includes('REAL INTEGRATION') && brainMemoryTest.includes('GHARABI_TEST_DATABASE_URL') &&
  brainMemoryTest.includes('SKIPPED') && brainMemoryTest.includes('التكرار لا يُضاف') &&
  brainMemoryTest.includes('الأصل محفوظ') && brainMemoryTest.includes('تصمد بعد إعادة إنشاء الطبقة'),
  'اختبار ثبات ذاكرة العقل على Postgres حقيقي (تكامل) أو تخطٍّ صريح، مع منع تكرار وحفظ الأصل');

add('brain-memory-postgres-harness',
  fs.existsSync(path.join(root, 'tools/local-verification/verify-brain-memory.mjs')) &&
  read('tools/local-verification/package.json').includes('verify:brain-memory'),
  'أداة تحقق محلية لتشغيل اختبار Postgres الحقيقي بلا قاعدة إنتاج');

add('brain-runtime-tests-honest',
  brainRuntimeTest.includes('لا معرّفات مُختلقة') && brainRuntimeTest.includes('قول AI يُصنّف فرضية') &&
  brainRuntimeTest.includes('الذاكرة الدائمة تصمد') && brainRuntimeTest.includes('إعادة البناء بلا سجلات جديدة') &&
  brainRuntimeServerTest.includes('الذاكرة صمدت بعد إعادة التشغيل') &&
  brainRuntimeServerTest.includes('الذاكرة لا تتضاعف عند إعادة القراءة') &&
  brainRuntimeServerTest.includes('لا تسريب رمز البوت'),
  'اختبارات التشغيل تثبت منع الاختراع ومنع التكرار وثبات الذاكرة وعدم تسريب الأسرار');

// ---------------------------------------------------------------------------
// منظومة DR (Google Drive): وجود الملفات، نطاق drive.file، غياب الصلاحية الكاملة،
// عدم قراءة DATABASE_URL، رفض قاعدة البيانات الخام، وحماية الأسرار.
// ---------------------------------------------------------------------------
const drDir = path.join(root, 'tools/dr');
const drFiles = ['cloud-lib.mjs', 'cloud-sync.mjs', 'cloud-status.mjs', 'drive-client.mjs', 'drive-auth.mjs', 'drive-auth-url.mjs', 'drive-store.mjs', 'drive-sync.mjs', 'db-crypto.mjs', 'dump-db.mjs', 'restore-db.mjs', 'backup.mjs', 'key-vault-crypto.mjs', 'vault-restore.mjs'];
const drTests = ['dr.core.test.ts', 'dr.store.test.ts', 'dr.sync.test.ts', 'dr.auth.test.ts', 'dr.db.test.ts', 'dr.routes.test.ts', 'dr.backup.test.ts'];
const drSources = drFiles.map((f) => (fs.existsSync(path.join(drDir, f)) ? read(path.join('tools/dr', f)) : ''));
const drRoutes = fs.existsSync(path.join(root, 'engine/dr/routes.ts')) ? read('engine/dr/routes.ts') : '';

add('dr-files-present', drFiles.every((f) => fs.existsSync(path.join(drDir, f))), 'ملفات منظومة DR كلها موجودة في tools/dr');
add('dr-tests-present', drTests.every((f) => fs.existsSync(path.join(root, 'engine/tests/dr', f))), 'اختبارات DR الستة موجودة');
add('dr-fake-drive-only', fs.existsSync(path.join(root, 'engine/tests/dr/helpers/fakeDrive.ts')) && read('engine/tests/dr/helpers/fakeDrive.ts').includes('createFakeDriveState'), 'اختبارات DR تستخدم Drive وهمياً بالكامل');
add('dr-scope-drive-file', drSources[0].includes('drive.file') && read('tools/dr/drive-auth.mjs').includes('drive.file') && drRoutes.includes('drive.file'), 'نطاق drive.file هو المصدر الوحيد للصلاحية');
// الصلاحية الكاملة قد تُذكر فقط في قائمة المنع؛ لا تُسنَد كـ scope فعلي.
const fullDriveLiteral = 'https://www.googleapis.com/auth/drive';
const scopeAssignments = drSources.map((s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''));
const fullDriveAssigned = scopeAssignments.some((s) => new RegExp(`scopes?\\s*[:=]\\s*\\[[^\\]]*['"\`]${fullDriveLiteral}['"\`]`).test(s));
add('dr-no-full-drive-scope', !fullDriveAssigned && drSources[0].includes('DRIVE_FORBIDDEN_SCOPES'), 'لا تُسنَد صلاحية Drive الكاملة؛ وهي في قائمة المنع');
add('dr-redirect-uri', (drSources[0] || '').includes('https://al-gharabi-ai.onrender.com/api/dr/drive/callback'), 'Redirect URI مطابق للمطلوب');
add('dr-routes-registered', server.includes('registerDriveRoutes') && drRoutes.includes('/api/dr/drive/callback') && drRoutes.includes('/api/dr/drive/auth-url'), 'مسارات DR مسجّلة من server.ts');
add('dr-callback-no-upload', drRoutes.includes('MISSING_CODE_OR_STATE') && !drRoutes.includes('.syncCurrent('), 'callback لا ينفّذ أي رفع');
// يُمنع الاتصال/القراءة الفعلية بـDATABASE_URL في مسار النسخ؛ القراءة الوحيدة المسموحة
// هي مقارنة *رفض* قاعدة الإنتاج في بوابة اختبار الاستعادة (لا تُتصل بها أبداً).
const drCode = [...drSources, drRoutes].map((s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''));
const drEnvDbReads = drCode.filter((s) => /process\.env\.DATABASE_URL|env\.DATABASE_URL/.test(s));
add('dr-no-database-url', drEnvDbReads.length === 0 || (drEnvDbReads.length === 1 && drRoutes.includes('REFUSED_PRODUCTION_DATABASE')), 'منظومة DR لا تقرأ DATABASE_URL إلا لرفض قاعدة الإنتاج في بوابة الاختبار');
add('dr-raw-db-blocked', drSources.some((s) => s.includes('raw_database_dump_forbidden')) && drRoutes.includes('classifyDbDump') === false && read('tools/dr/drive-store.mjs').includes('classifyDbDump'), 'المسموح فقط DB encrypted dump');
// refreshToken: الوحيد المسموح هو كتلة التشخيص (stored/decryptable/providerRefresh/reason) — لا قيمة سرّية.
add('dr-encrypted-token-only', drRoutes.includes('encryptDriveSecret') && drRoutes.includes('DRIVE_AUTHORIZED') && /refreshToken:\s*\{\s*stored:/.test(drRoutes) && !/refreshToken:\s*(?!\{)[^\n]*(token|secret)/i.test(drRoutes) && !drRoutes.includes('accessToken:'), 'رمز التجديد يُخزّن مشفّراً فقط ولا يُعاد أي رمز (كتلة التشخيص وحدها)');
add('dr-csrf-single-use', read('tools/dr/drive-auth-url.mjs').includes('state_reused') && drRoutes.includes('stateStore.consume'), 'state أحادي الاستخدام لحماية CSRF');
add('dr-rp001-canonical', drSources[0].includes('dd09c32077e2cc3cc326345e8bbc740c025c14e2') && drSources.some((s) => s.includes('immutable_restore_point')), 'rp-001 مرتبط بالـcommit المعتمد ونقاط الاستعادة غير قابلة للتعديل');
add('dr-quota-gate', drSources[0].includes('DESIGN_QUOTA_BYTES') && drSources[0].includes('quota_exceeded') && drSources.some((s) => s.includes('withinQuota')), 'بوابة المساحة 15GiB + هامش 512MiB بلا شراء/تجاوز');
add('dr-hourly-readonly', read('tools/dr/cloud-status.mjs').includes('runHourlyCheck') && drSources[0].includes('hourlySafetyCheck'), 'الفحص الساعي قراءة فقط');
add('dr-monitoring-snapshot', drSources[0].includes('buildMonitoringSnapshot') && read('tools/dr/cloud-status.mjs').includes('buildStatus'), 'لقطة المراقبة الكاملة موجودة');
add('dr-secret-scan-excluded', drSources[0].includes('scanForSecrets') && drSources[0].includes('shouldExclude') && read('tools/dr/cloud-sync.mjs').includes('excluded'), 'فحص الأسرار يشمل الملفات المستبعدة');
add('dr-tests-in-package', (pkg.scripts['test:dr'] || '').includes('test:dr-core') && pkg.scripts.test.includes('test:dr'), 'اختبارات DR مضافة إلى npm test');
add('dr-client-deps', Boolean(pkg.dependencies.gaxios) && Boolean(pkg.dependencies['google-auth-library']), 'gaxios وgoogle-auth-library مضافتان (بلا googleapis)');

// --- واجهة النسخ السحابي (DR) + العودة الآمنة من OAuth ---
const cloudView = read('src/components/system/CloudBackupView.tsx');
const sidebar = read('src/components/common/Sidebar.tsx');
add('dr-ui-view-exists', fs.existsSync(path.join(root, 'src/components/system/CloudBackupView.tsx')), 'مكوّن واجهة النسخ السحابي موجود');
add('dr-ui-tab-owner-only', sidebar.includes("id: 'cloud_backup'") && /id:\s*'cloud_backup'[\s\S]{0,220}ownerOnly:\s*true/.test(sidebar) && /ownerOnly[\s\S]{0,80}currentUser\?\.role\s*===\s*'owner'/.test(sidebar), 'تبويب النسخ السحابي يظهر للمالك فقط');
add('dr-ui-app-case', app.includes("case 'cloud_backup': return <CloudBackupView />"), 'حالة cloud_backup مضافة في App.tsx');
add('dr-ui-api-methods', read('src/services/api.ts').includes('getDrStatus') && read('src/services/api.ts').includes('getDrHealth') && read('src/services/api.ts').includes('getDrAuthUrl'), 'دوال DR مضافة إلى apiService');
add('dr-ui-api-uses-authheaders', /getDrStatus[\s\S]{0,320}getAuthHeaders\(\)/.test(read('src/services/api.ts')) && /getDrAuthUrl[\s\S]{0,220}getAuthHeaders\(\)/.test(read('src/services/api.ts')), 'دوال DR تستخدم getAuthHeaders الحالي (بلا نظام جلسات جديد)');
add('dr-ui-connect-button-gated', /configured\s*&&\s*\(!canOperate\)/.test(cloudView) && cloudView.includes('apiService.getDrAuthUrl') && cloudView.includes('window.location.assign'), 'زر الربط/إعادة الربط يظهر عند الإعداد الجاهز وعدم قابلية التشغيل، وينتقل لرابط الخادم');
add('dr-ui-reauth-reachable', cloudView.includes('reauthorizationNeeded') && cloudView.includes('إعادة الربط بنقرة واحدة'), 'إعادة التفويض ممكنة من الواجهة عند رفض Google للرمز (لا قفل بزر مخفي)');
add('dr-ui-operate-requires-refresh-usable', cloudView.includes('canOperate = authorized && !reauthorizationNeeded') && cloudView.includes('refreshTokenUsable'), 'أزرار النسخ/المزامنة/الاختبار لا تظهر إلا بعد إثبات قابلية التجديد');
add('dr-health-refresh-truth-flags', drRoutes.includes('reauthorizationNeeded') && drRoutes.includes('refreshTokenUsable') && /backupReady:\s*readiness\.authorized\s*&&\s*!refreshFailed/.test(drRoutes), 'health يعلن reauthorizationNeeded/refreshTokenUsable ويربط backupReady بنجاح التجديد الفعلي');
add('dr-backup-reauth-explicit-code', drRoutes.includes("code: 'REAUTHORIZATION_NEEDED'") && drRoutes.includes('tokenRefreshFailure'), 'فشل تجديد الرمز في النسخة يُعلن REAUTHORIZATION_NEEDED (409) بدل عطل عام');
add('dr-callback-invalidates-refresh-diag', /driveRefreshToken = encrypted;[\s\S]{0,400}refreshDiagCache = null/.test(drRoutes), 'التفويض الجديد يُبطل فحص الرمز المخبَّأ فلا يبقى «يلزم إعادة تفويض» بعد الربط');
add('dr-ui-status-error-explicit', cloudView.includes('classifyDrStatusError') && cloudView.includes('resolveDrStatusUpdate') && cloudView.includes('Promise.allSettled') && !cloudView.includes('.catch(() => null)'), 'فشل /api/dr/status يُعالَج صراحةً (لا ابتلاع) مع إبقاء البيانات السابقة');
add('dr-ui-status-error-messages', /status === 401[\s\S]{0,120}إعادة تسجيل الدخول/.test(cloudView) && /status === 403[\s\S]{0,120}مالك/.test(cloudView) && cloudView.includes('إعادة المحاولة'), 'رسائل 401/403/500 صريحة مع زر إعادة المحاولة');
add('dr-ui-refresh-loading-state', /loading\s*\?\s*'جارٍ التحديث/.test(cloudView) && /disabled=\{loading\}/.test(cloudView), 'زر التحديث يُظهر حالة تحميل ويعود لحالته الطبيعية');
add('dr-ui-no-secret-in-frontend', !cloudView.includes('authorizationCode') && !/localStorage[\s\S]{0,40}(state|token|code)/i.test(cloudView), 'الواجهة لا تخزّن/تعرض state أو code أو refresh token');
add('dr-ui-return-handling', /params\.get\('dr'\)/.test(app) && app.includes("dr === 'authorized'") && /params\.get\('reason'\)/.test(app) && /params\.delete\('dr'\)/.test(app), 'App.tsx يقرأ dr ويعالج النجاح/الفشل وينظّف الرابط');
add('dr-ui-oauth-redirect', drRoutes.includes("res.redirect(302") && drRoutes.includes('/?dr=authorized') && drRoutes.includes('dr=error&reason='), 'فرع المتصفح في callback يعيد التوجيه إلى الواجهة (بلا سرّ)');
add('dr-ui-oauth-json-preserved', drRoutes.includes("String(req.headers.accept || '').includes('application/json')") && drRoutes.includes('res.status(status).json(payload)'), 'فرع JSON في callback باقٍ كما هو');
add('dr-ui-test-present', fs.existsSync(path.join(root, 'engine/tests/dr/dr.ui.test.ts')) && (pkg.scripts['test:dr'] || '').includes('test:dr-ui') && pkg.scripts.test.includes('test:dr-ui'), 'اختبار واجهة DR مضمّن في test:dr وnpm test');

// --- النسخة الاحتياطية الفعلية (رفع حقيقي إلى Drive) ---
const drBackup = fs.existsSync(path.join(drDir, 'backup.mjs')) ? read('tools/dr/backup.mjs') : '';
const drCloudLib = fs.existsSync(path.join(drDir, 'cloud-lib.mjs')) ? read('tools/dr/cloud-lib.mjs') : '';
const drAdapter = read('engine/storage/adapter.ts');
add('dr-backup-module', fs.existsSync(path.join(drDir, 'backup.mjs')) && drBackup.includes('export async function runBackup') && drBackup.includes('readBackCurrent'), 'وحدة النسخة الاحتياطية الفعلية موجودة (runBackup + تحقق)');
add('dr-backup-route', drRoutes.includes("'/api/dr/backup'") && drRoutes.includes('runBackup') && drRoutes.includes('deps.requireOwner') && drRoutes.includes('encryptDbDump'), 'مسار POST /api/dr/backup للمالك يمر بالمسار الرسمي وبتشفير DB');
add('dr-backup-secret-scan-before-upload', drBackup.indexOf('scanForSecretsStrict(files)') > -1 && drBackup.indexOf('scanForSecretsStrict(files)') < drBackup.indexOf('createVersionedRestorePoint'), 'فحص الأسرار الصارم يقع قبل أي رفع (لا سرّ يصل إلى Drive)');
add('dr-backup-strict-gate-single-source', drSources[0].includes('export function scanForSecretsStrict') && drSources[0].includes('FAKE_SECRET_MARKERS') && read('tools/dr/drive-sync.mjs').includes('scanForSecretsStrict'), 'بوابة الأسرار الصارمة مصدر واحد وتُستخدم في المزامنة والنسخة');
add('dr-backup-strict-blocks-real-secret', drSources[0].includes('looksLikeFakeSecret') && drSources[0].includes('isPlaceholderValue'), 'البوابة الصارمة تميّز السر الحقيقي من القيم الوهمية/القوالب');
add('dr-backup-no-raw-db', read('tools/dr/drive-store.mjs').includes('writeCurrentVersion') && read('tools/dr/drive-store.mjs').includes('createVersionedRestorePoint') && drSources[0].includes('raw_database_dump_forbidden'), 'لا رفع لنسخة DB خام في current أو history');
add('dr-backup-atomic-current', drBackup.indexOf('createVersionedRestorePoint') < drBackup.indexOf('writeCurrentVersion'), 'نقطة الاستعادة تُكتب قبل ترقية current (فشل جزئي لا يترك current نصف مكتمل)');
add('dr-backup-verify', drBackup.includes('evaluateBackupVerification') && drSources[0].includes('export function evaluateBackupVerification') && drBackup.includes('verification_failed'), 'النجاح يتطلّب تحققاً فعلياً من Drive (لا نسخة كاذبة)');
add('dr-backup-no-change', drSources[0].includes('export function isSameSource') && drBackup.includes("state: 'no_change'"), 'لا نسخة تاريخية مكررة عند عدم تغيّر (commit + treeHash + sourceHash)');
add('dr-backup-rp-numbering', drSources[0].includes('export function nextRecoveryPointId') && drSources[0].includes('FIRST_AUTO_RP_NUMBER'), 'ترقيم نقاط الاستعادة من قائمة النقاط الحالية (rp-001 محجوزة)');
add('dr-backup-db-source', drAdapter.includes('dump(): Promise<string>') && drAdapter.includes('async dump()') && drRoutes.includes('deps.dumpDatabase') && server.includes('storageAdapter.dump'), 'نسخة DB تأتي من محوّل التخزين (بلا DATABASE_URL) وتُشفَّر قبل الرفع');
add('dr-backup-encrypted-only', drSources.some((s) => s.includes('GHARABI-DB-DUMP-V1')) && drRoutes.includes('encryptDbDump'), 'قاعدة البيانات تُشفَّر AES-256-GCM قبل أي رفع');
add('dr-backup-single-path', drBackup.includes('inProcessLock') && drRoutes.includes('backupRunning'), 'قفل مزدوج (عملية + خادم) يمنع تشغيل نسختين متزامنتين');
add('dr-backup-last-attempt-persisted', server.includes('driveBackup') && drRoutes.includes('persistControl') && drRoutes.includes('recordBackupResult'), 'نتيجة آخر نسخة تُحفظ عبر محوّل الحالة (تصمد بعد restart)');
add('dr-backup-health-exposes', drRoutes.includes('backupReady') && drRoutes.includes('backupRoute') && drRoutes.includes('backup: control().driveBackup'), 'health يعرض جاهزية النسخة وآخر محاولة بلا أسرار');
add('dr-backup-status-history', drRoutes.includes('summarizeBackupState') && drRoutes.includes('history') && drRoutes.includes('restorePointCount'), 'status يعرض ملخص النسخة وسجل نقاط الاستعادة');

// --- إثبات المرحلة 4: مزامنة CURRENT + نقاط استعادة + drill + تلف + بوابات ---
const drStage4 = fs.existsSync(path.join(root, 'engine/tests/dr/dr.stage4.evidence.ts')) ? read('engine/tests/dr/dr.stage4.evidence.ts') : '';
add('dr-stage4-evidence-script', fs.existsSync(path.join(root, 'engine/tests/dr/dr.stage4.evidence.ts')) && (pkg.scripts['test:dr-stage4'] || '').includes('dr.stage4.evidence.ts'), 'سكربت إثبات المرحلة 4 موجود ومضاف إلى package.json');
add('dr-stage4-real-or-contract', drStage4.includes("process.argv.includes('--real')") && drStage4.includes('drive_not_configured'), 'السكربت يدعم Drive حقيقي (--real) ويفشل بأمان بلا اعتماد');
add('dr-stage4-covers-ordered-steps', ['create_rp_003', 'current_mirror_individual_files', 'history_rp_003', 'database_dir_encrypted_only', 'secrets_dir_encrypted_only', 'recovery_docs', 'sync_add_file', 'sync_modify_file', 'sync_delete_file_current_not_history', 'sync_no_change_no_new_history', 'recovery_drill_isolated', 'tamper_detected_healthy_intact', 'rp_002_intact', 'one_click_restore_plan_no_production', 'security_gates'].every((n) => drStage4.includes(`'${n}'`)), 'السكربت يغطّي الترتيب المطلوب كاملاً (15 خطوة)');
add('dr-stage4-no-production-restore', drStage4.includes('one_click_restore_plan_no_production') && !drStage4.includes('restore/production') && !drStage4.includes('runProductionRestore'), 'لا تنفيذ استعادة إنتاجية في سكربت الإثبات');
add('dr-stage4-isolated-db', drStage4.includes('applyDatabaseDump') && drStage4.includes('embedded-postgres') && drStage4.includes('production: false'), 'اختبار الاستعادة يستخدم قاعدة معزولة فقط');
add('dr-source-bundle-deterministic', drSources[0].includes('mtime ثابت') && /write\('00000000000',\s*136/.test(drSources[0]) && read('engine/tests/dr/dr.core.test.ts').includes('source bundle deterministic'), 'حزمة المصدر قابلة لإعادة الإنتاج (بلا mtime متغيّر) مع اختبار انحدار');
add('dr-no-change-deterministic', drBackup.includes("state: 'no_change'") && drSources[0].includes('export function isSameSource') && read('engine/tests/dr/dr.core.test.ts').includes('source bundle tar mtime is fixed epoch'), 'كشف «لا تغيير» مضمون (لا يعتمد على زمن البناء)');

// --- حزمة المصدر الموثوقة زمن البناء (بيئة Docker بلا .git) ---
const sourceBundleModule = fs.existsSync(path.join(root, 'tools/dr/source-bundle.mjs')) ? read('tools/dr/source-bundle.mjs') : '';
const sourceBundleTest = fs.existsSync(path.join(root, 'engine/tests/dr/dr.source.bundle.test.ts')) ? read('engine/tests/dr/dr.source.bundle.test.ts') : '';
const cloudSyncSrc = read('tools/dr/cloud-sync.mjs');
add('dr-build-source-bundle-module', sourceBundleModule.includes('buildTrustedSourceBundle') && sourceBundleModule.includes('writeSourceBundle') && sourceBundleModule.includes('readTrustedSourceBundle'), 'وحدة حزمة المصدر الموثوقة موجودة (بناء/كتابة/قراءة)');
add('dr-source-bundle-deterministic-build', sourceBundleModule.includes("zlib.gzipSync(tar, { level: 9, mtime: 0 })") && sourceBundleModule.includes('mtime ثابت') && /write\('00000000000',\s*136/.test(sourceBundleModule), 'أرشيف الحزمة حتمي (mtime ثابت + gzip مستوى ثابت)');
add('dr-source-bundle-from-git', sourceBundleModule.includes("execFileSync('git', ['-C', rootDir, 'ls-files', '-z']") && sourceBundleModule.includes('resolveGitCommit'), 'الحزمة تُبنى من الشجرة المتتبَّعة في Git (لا dist/node_modules)');
add('dr-source-bundle-no-secret-gate', sourceBundleModule.includes('scanForSecretsStrict') && sourceBundleModule.includes("code: 'secret_detected'"), 'بناء الحزمة يوقف فوراً عند أي سرّ مرصود (fail-closed)');
add('dr-source-bundle-commit-bound', cloudSyncSrc.includes('export function bindBundleCommit') && cloudSyncSrc.includes('commit_mismatch') && sourceBundleModule.includes('SOURCE_BUNDLE_COMMIT_FILE'), 'الحزمة مرتبطة بالـcommit مع إعلان صريح عند عدم التطابق (لا ادّعاء commit)');
add('dr-collector-reads-bundle', cloudSyncSrc.includes("source: 'bundle'") && cloudSyncSrc.includes('readTrustedSourceBundle') && cloudSyncSrc.includes("source: 'git'") && cloudSyncSrc.includes("source: 'walk'"), 'الـcollector يجرّب الحزمة ثم Git ثم المشي (بلا تعطيل الحرس)');
add('dr-source-bundle-guard-intact', cloudSyncSrc.includes('assessSourceCompleteness(bundle.included, options)') && /complete\s*=\s*paths\.size\s*>=\s*minFiles\s*&&\s*missingRequired\.length\s*===\s*0/.test(cloudSyncSrc), 'حرس SOURCE_INCOMPLETE مطبَّق على الحزمة أيضاً (لم يُخفَّف)');
add('dr-source-bundle-build-script', (pkg.scripts['build'] || '').includes('tools/dr/source-bundle.mjs') && Boolean(pkg.scripts['build:source-bundle']), 'خطوة البناء تُنتج الحزمة داخل dist (لا حاجة لـ.git في الصورة)');
add('dr-source-bundle-docker-copy', read('Dockerfile').includes('COPY --from=build /app/dist ./dist') && !read('Dockerfile').includes('COPY --from=build /app/.git'), 'صورة الإنتاج تنسخ dist (وفيه الحزمة) بلا .git');
add('dr-source-bundle-docker-git-buildstage', /apt-get install -y --no-install-recommends git/.test(read('Dockerfile')) && /FROM node:20-slim AS build[\s\S]*?apt-get install[\s\S]*?git[\s\S]*?FROM node:20-slim AS runtime/.test(read('Dockerfile')), 'git يُثبَّت في مرحلة البناء فقط ليبني الحزمة من الشجرة المتتبَّعة (الصورة النهائية بلا git)');
add('dr-source-bundle-walk-fallback', sourceBundleModule.includes('export function walkProjectSource') && sourceBundleModule.includes("sourceMode = 'walk'") && sourceBundleModule.includes('NON_SOURCE_DIRS'), 'احتياطي بناء من مشي الشجرة عند غياب git زمن البناء (بلا تعطيل فحص الأسرار)');
add('dr-source-bundle-docker-context', !/^\.git$/m.test(read('.dockerignore')) && !/^docs$/m.test(read('.dockerignore')), 'سياق بناء Docker يحوي .git (للـcommit) وكامل شجرة المصدر (لا استبعاد صامت لملفات متتبَّعة)');
add('dr-source-bundle-test', sourceBundleTest.includes('docker-like collector uses bundle') && sourceBundleTest.includes('guard rejects bundle missing server.ts') && sourceBundleTest.includes('CURRENT treeHash unchanged after failed collection'), 'اختبار الحزمة يثبت: بيئة Docker + الحرس + عدم تأثّر CURRENT');
add('dr-source-bundle-in-package', (pkg.scripts['test:dr'] || '').includes('test:dr-source-bundle') && pkg.scripts.test.includes('test:dr-source-bundle'), 'اختبار الحزمة مضافة إلى npm test');
add('dr-source-bundle-health-exposed', drRoutes.includes('bundle: (c as any).bundle ?? null') && drRoutes.includes('bundle: collected?.bundle ?? null'), 'health/ردود الرفض تُعلن كتلة الحزمة (commit/bound/treeHash) بلا أي سرّ');

// SEC-01: لا تُقدَّم حزمة المصدر (dist/dr-source) للعامة. الحجب في Express (قبل
// express.static) وفي Netlify (على الحافة قبل قاعدة SPA)، واختبار تشغيلي يثبت 404.
const exposureTest = read('engine/tests/source.bundle.exposure.test.ts');
add('sec01-express-blocks-dr-source',
  server.includes('BLOCKED_SOURCE_BUNDLE_SEGMENT = "/dr-source"') &&
  server.includes('function canonicalRequestPath(') &&
  server.includes('function isBlockedSourceRequest(') &&
  server.includes('isBlockedSourceRequest(String(req.path') &&
  server.indexOf('isBlockedSourceRequest(String(req.path') < server.indexOf('app.use(express.static(distPath))'),
  'Express يمنع /dr-source عبر مطابقة مسار مُطبَّع قبل express.static (لا تسريب حزمة المصدر)');
add('sec01-express-canonicalizes-path',
  server.includes('decodeURIComponent(p)') &&
  /for \(let i = 0; i < 5; i \+= 1\)/.test(server) &&
  server.includes('path.posix.normalize(p)') &&
  server.includes('.toLowerCase()') &&
  server.includes('catch {'),
  'التطبيع يفكّ الترميز متكرراً (محدود) + يوحّد الفواصل/الحالة ويقبل الترميز الفاسد بلا انهيار');
add('sec01-express-blocks-encoded-bypass',
  server.includes('p.includes(`${BLOCKED_SOURCE_BUNDLE_SEGMENT}/`)') &&
  server.includes('p.endsWith(BLOCKED_SOURCE_BUNDLE_SEGMENT)') &&
  server.includes('p.endsWith(".cjs") || p.endsWith(".cjs.map")') &&
  server.includes('BLOCKED_DIST_SOURCE_PREFIX'),
  'الحجب يغطّي أي موضع لـ/dr-source و/dist/dr-source وأي ملف .cjs/.cjs.map (لا تجاوز بالترميز)');
add('sec01-express-blocks-encoded-test',
  exposureTest.includes("'/%64r-source/source.tar.gz'") &&
  exposureTest.includes("'/%73erver.cjs.map'") &&
  exposureTest.includes("'/dr-source%2fsource.tar.gz'") &&
  exposureTest.includes("'/%2564r-source/source.tar.gz'") &&
  exposureTest.includes('encoded server.cjs.map does not disclose sourcesContent'),
  'اختبار SEC-01 يغطّي التجاوز بالترميز والترميز المزدوج والاجتياز (كلها 404)');
add('sec01-netlify-blocks-dr-source',
  /from = "\/dr-source\/\*"[\s\S]*?status = 404/.test(read('netlify.toml')),
  'Netlify تمنع /dr-source/* بحالة 404 قبل قاعدة SPA');
add('sec01-exposure-test',
  pkg.scripts['test:source-bundle-exposure'] === 'tsx engine/tests/source.bundle.exposure.test.ts' &&
  pkg.scripts.test.includes('test:source-bundle-exposure') &&
  exposureTest.includes('/dr-source/source.tar.gz') && exposureTest.includes("=== 404"),
  'اختبار انحدار SEC-01 مضمّن في npm test ويؤكد 404 على حزمة المصدر');
add('sec01-express-blocks-server-bundle',
  server.includes('BLOCKED_DIST_FILES') &&
  server.includes('"/server.cjs"') && server.includes('"/server.cjs.map"') &&
  server.indexOf('BLOCKED_DIST_FILES') < server.indexOf('app.use(express.static(distPath))'),
  'SEC-01 تكملة: Express يمنع /server.cjs و/server.cjs.map (خريطة تحمل الكود المصدري كاملاً)');
add('sec01-netlify-blocks-server-bundle',
  /from = "\/server\.cjs"[\s\S]*?status = 404/.test(read('netlify.toml')) &&
  /from = "\/server\.cjs\.map"[\s\S]*?status = 404/.test(read('netlify.toml')),
  'SEC-01 تكملة: Netlify تمنع /server.cjs و/server.cjs.map بحالة 404');
add('sec01-server-bundle-test',
  exposureTest.includes("'/server.cjs'") && exposureTest.includes("'/server.cjs.map'") &&
  exposureTest.includes('server.cjs.map is not served as the source map') &&
  exposureTest.includes('sourcesContent'),
  'اختبار SEC-01 يثبت أن خريطة الخادم وحزمته لا تُخدمان (لا sourcesContent عام)');
add('dr-source-bundle-render-commit-env', sourceBundleModule.includes('export function resolveBuildCommit') && sourceBundleModule.includes("RENDER_GIT_COMMIT") && sourceBundleModule.includes("source: 'RENDER_GIT_COMMIT'"), 'commit الحزمة يُحسم من RENDER_GIT_COMMIT (بيئة Render بلا .git) بترتيب أسبقية صريح');
add('dr-source-bundle-render-commit-priority', /options\.commit[\s\S]*?RENDER_GIT_COMMIT[\s\S]*?resolveGitCommit/.test(sourceBundleModule) && sourceBundleModule.includes("source: 'none'"), 'الأسبقية: provided ثم RENDER_GIT_COMMIT ثم git ثم null (بلا اختراع commit)');
add('dr-source-bundle-render-commit-no-invention', /bad_sha/.test(sourceBundleModule) && sourceBundleModule.includes("commitRes.commit ?? null"), 'RENDER_GIT_COMMIT غير الصالح يُرفض ولا يُخترع commit');
add('dr-source-bundle-render-commit-test', sourceBundleTest.includes('RENDER_GIT_COMMIT is recorded verbatim') && sourceBundleTest.includes('no env + no git => commit null') && sourceBundleTest.includes('render-like boundToCommit true') && sourceBundleTest.includes('render-like without env => not bound (null)'), 'اختبارات RENDER_GIT_COMMIT: موجود يُسجَّل، غائب لا يُخترع، وبيئة شبيهة بـRender');
add('dr-source-bundle-build-env-diagnostic', sourceBundleModule.includes('renderGitCommitPresent') && sourceBundleModule.includes('renderVarNames') && sourceBundleModule.includes('renderGitBranch') && sourceBundleModule.includes('buildEnv,'), 'تشخيص بيئة البناء (بلا سرّ): يُكشف هل وصل RENDER_GIT_COMMIT/RENDER إلى خطوة البناء');
add('dr-source-bundle-build-env-exposed', cloudSyncSrc.includes('buildEnv: bundle.buildEnv ?? null') && sourceBundleModule.includes('buildEnv: man.manifest.buildEnv ?? null'), 'buildEnv يُحفظ في البيان ويُقرأ ويُعرض في health (بلا قيمة سرّية)');
add('dr-source-bundle-build-env-test', sourceBundleTest.includes('buildEnv exposes renderGitCommitPresent') && sourceBundleTest.includes('buildEnv carries no secret value'), 'اختبار التشخيص يثبت الحضور/الغياب وعدم تسريب سرّ');
add('dr-runtime-commit-binding', /runtime_commit_matches/.test(cloudSyncSrc) && cloudSyncSrc.includes("bound: true, reason: 'runtime_commit_matches'"), 'الربط وقت التشغيل: حزمة بلا commit زمن البناء تُربط بـRENDER_GIT_COMMIT المنشور (Render لا يوفّر RENDER_* أثناء البناء)');
add('dr-runtime-commit-no-invention', cloudSyncSrc.includes('declaredValid') && cloudSyncSrc.includes('[0-9a-f]{40}') && cloudSyncSrc.includes("reason: 'no_declared_commit', commit: null"), 'لا اختراع commit: قيمة غير صالحة/غائبة => bound null بلا تخمين');
add('dr-runtime-commit-exposed', cloudSyncSrc.includes('resolvedCommit: bound.commit ?? null') && cloudSyncSrc.includes('boundVia:') && cloudSyncSrc.includes('buildCommit: bundle.commit ?? null'), 'health يعرض commit الفعّال وbuildCommit وبوابة الربط بلا سرّ');
add('dr-runtime-commit-test', sourceBundleTest.includes('runtime commit binds when bundle has none') && sourceBundleTest.includes('invalid runtime commit => not bound'), 'اختبارات الربط وقت التشغيل: يربط عند وجود RENDER_GIT_COMMIT ولا يخترع عند غيابه/فساده');
add('dr-mirror-no-silent-failure', drRoutes.includes('لا فشل صامت') && drRoutes.includes('driveMirror = prev') && drRoutes.includes('error: reason'), 'فشل المرآة (backup وsync) يُحفظ سببه ويُعلن بدل الفشل الصامت');
add('dr-mirror-error-exposed-health', /currentMirror:\s*\{[\s\S]{0,400}error:\s*mirror\?\.error/.test(drRoutes) && drRoutes.includes('Boolean(mirror?.treeHash)'), 'health يعرض سبب فشل المرآة وsynced تتطلّب بصمة فعلية');

// --- النسخة الاحتياطية الكاملة التلقائية كل 6 ساعات ---
const autoBackupModule = fs.existsSync(path.join(root, 'engine/dr/autoBackup.ts')) ? read('engine/dr/autoBackup.ts') : '';
const autoBackupTest = fs.existsSync(path.join(root, 'engine/tests/dr/dr.autoBackup.test.ts')) ? read('engine/tests/dr/dr.autoBackup.test.ts') : '';
const serverSrc = read('server.ts');
add('dr-auto-backup-module', autoBackupModule.includes('AUTO_BACKUP_DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000') && autoBackupModule.includes('resolveAutoBackupIntervalMs') && autoBackupModule.includes('isAutoBackupDue') && autoBackupModule.includes('buildAutoBackupStatus'), 'وحدة الجدولة: إيقاع افتراضي 6 ساعات + حسم آمن + قرار استحقاق');
add('dr-auto-backup-reuses-manual-path', drRoutes.includes('async function runFullBackup') && drRoutes.includes("runFullBackup('manual')") && drRoutes.includes("runFullBackup(trigger)") && /app\.post\('\/api\/dr\/backup'[\s\S]{0,200}runFullBackup\('manual'\)/.test(drRoutes), 'النسخة التلقائية واليدوية تمرّان بنفس المسار الرسمي runFullBackup (لا مسار موازٍ)');
add('dr-auto-backup-shared-lock', /runAutoBackupCycle[\s\S]{0,600}backupRunning \|\| autoBackupInFlight/.test(drRoutes) && drRoutes.includes("recordAutoBackupSkip('already_running')"), 'القفل المشترك: دورة تلقائية لا تبدأ إن كانت نسخة/مزامنة قيد التنفيذ');
add('dr-auto-backup-no-restart-duplicate', drRoutes.includes('parseLastRunAtMs') && drRoutes.includes('isAutoBackupDue(lastRunAtMs, startedMs, autoBackupIntervalMs)') && drRoutes.includes("reason: 'not_due'"), 'لا نسخة مكرّرة عند إعادة التشغيل: القرار من الزمن المنقضي منذ آخر تشغيل محفوظ');
add('dr-auto-backup-durable-state', serverSrc.includes('driveAutoBackup') && serverSrc.includes('drControl.driveAutoBackup = control.driveAutoBackup') && serverSrc.includes('driveAutoBackup: drControl.driveAutoBackup'), 'حالة الجدولة تُحفظ وتُسترجع عبر محوّل الحالة (تصمد بعد restart)');
add('dr-auto-backup-failure-not-success', drRoutes.includes("lastError: result.state === 'failed'") && drRoutes.includes("lastRecoveryPointId: result.state === 'backed_up'") && drRoutes.includes("outcome: status >= 200 && status < 300 ? 'ran' : 'failed'"), 'الفشل يُسجَّل فشلاً ولا يُعدّ نقطة استعادة ناجحة (لا ادّعاء نجاح)');
add('dr-retention-bounded-protected', drRoutes.includes('pruneCompletedRestorePoints') && drRoutes.includes('retentionEnabled') && read('tools/dr/retention.mjs').includes('DEFAULT_PROTECTED_IDS') && read('tools/dr/retention.mjs').includes("'rp-002', 'rp-003', 'rp-004'"), 'الاحتفاظ محدود (3 نقاط مكتملة) ومحميّ (rp-002/003/004 لا تُحذف)');
add('dr-retention-after-success-only', /result\.state === 'backed_up' \|\| result\.state === 'no_change'[\s\S]{0,300}pruneCompletedRestorePoints/.test(drRoutes), 'التقليم يقع فقط بعد نسخة ناجحة ومتحقّقة (لا حذف قبل اكتمال الجديدة)');
add('dr-retention-plan-pure', read('tools/dr/retention.mjs').includes('export function planRetention') && read('tools/dr/retention.mjs').includes('skippedProtected') && read('tools/dr/retention.mjs').includes('incomplete'), 'منطق الاحتفاظ صافٍ قابل للاختبار: يتخطّى المحميّ والناقص والأحدث');
add('dr-retention-tests', (pkg.scripts['test:dr'] || '').includes('test:dr-standalone') && read('engine/tests/dr/dr.standalone.test.ts').includes('protected points never deleted') && read('engine/tests/dr/dr.standalone.test.ts').includes('incomplete never deleted'), 'اختبارات الاحتفاظ (لا حذف المحميّ/الناقص/الأحدث) مربوطة بـtest:dr');
const standaloneModule = fs.existsSync(path.join(root, 'tools/dr/standalone-recovery.mjs')) ? read('tools/dr/standalone-recovery.mjs') : '';
const standaloneConsole = fs.existsSync(path.join(root, 'tools/dr/recovery-console.mjs')) ? read('tools/dr/recovery-console.mjs') : '';
add('dr-standalone-module', standaloneModule.includes('runStandaloneRestore') && standaloneModule.includes('listRecoveryPoints') && standaloneModule.includes('openKeyVault') && standaloneModule.includes('RESTORE_STAGES'), 'وحدة الاستعادة المستقلة موجودة (قائمة/تحقق/فتح خزنة/استعادة كاملة)');
add('dr-standalone-console', standaloneConsole.includes('--list') && standaloneConsole.includes('--restore') && standaloneConsole.includes('--target'), 'وحدة تحكّم CLI مستقلة تعمل بـNode بلا خادم الغرابي');
const standaloneUi = fs.existsSync(path.join(root, 'tools/dr/recovery-console-ui.mjs')) ? read('tools/dr/recovery-console-ui.mjs') : '';
add('dr-standalone-ui', standaloneUi.includes('createRecoveryUiServer') && standaloneUi.includes('127.0.0.1') && standaloneUi.includes('DR_RECOVERY_VAULT_KEY') && standaloneUi.includes('REFUSED_PRODUCTION_DATABASE'), 'واجهة ويب مستقلة محلية (127.0.0.1) تأخذ مفتاح الخزنة وترفض الإنتاج');
add('dr-standalone-ui-test', read('engine/tests/dr/dr.standalone.test.ts').includes('ui serves html page') && read('engine/tests/dr/dr.standalone.test.ts').includes('ui restore ok'), 'اختبار واجهة الويب المستقلة (صفحة + نقاط + استعادة فعلية)');
add('dr-standalone-no-project-import', !/from ['"]\.\.\/\.\.\/server/.test(standaloneModule) && !/from ['"]\.\.\/\.\.\/engine\//.test(standaloneModule), 'الاستعادة المستقلة لا تستورد خادم الغرابي ولا كود المشروع المترجم (استقلال فعلي)');
add('dr-standalone-vault-key-required', standaloneModule.includes('DR_RECOVERY_VAULT_KEY') && standaloneModule.includes('openKeyVault') && standaloneConsole.includes('DR_RECOVERY_VAULT_KEY'), 'الاستعادة المستقلة تطلب مفتاح خزنة الطوارئ المستقل عند الفكّ');
add('dr-standalone-refuses-production-db', standaloneModule.includes('REFUSED_PRODUCTION_DATABASE') && standaloneModule.includes('sameAsProduction'), 'الاستعادة المستقلة ترفض قاعدة الإنتاج صراحةً');
add('dr-standalone-read-only-point', standaloneModule.includes('immutablePointUntouched') && standaloneModule.includes('readOnlyStructure'), 'لا تُعدَّل نقاط الاستعادة (قراءة فقط)');
add('dr-standalone-endpoints', drRoutes.includes("'/api/dr/standalone/points'") && drRoutes.includes("'/api/dr/standalone/restore'") && /standalone\/restore'[\s\S]{0,600}OWNER_CONFIRMATION_REQUIRED/.test(drRoutes), 'مسارات الويب للاستعادة المستقلة (owner + تأكيد صريح)');
add('dr-standalone-endpoints-test', read('engine/tests/dr/dr.endpoints.test.ts').includes('standalone restore reached complete') && read('engine/tests/dr/dr.endpoints.test.ts').includes('standalone restore refuses production db'), 'اختبارات مسارات الاستعادة المستقلة (نجاح + رفض الإنتاج + 428)');
add('dr-standalone-test', (pkg.scripts['test:dr'] || '').includes('test:dr-standalone') && read('engine/tests/dr/dr.standalone.test.ts').includes('project-loss'), 'اختبار محاكاة فقدان المشروع بالكامل (Drive + نقطة + مفتاح يكفي)');
add('dr-standalone-recovery-doc', read('tools/dr/cloud-lib.mjs').includes('recovery-console.mjs') && read('tools/dr/cloud-lib.mjs').includes('واجهة الاستعادة المستقلة'), 'وثائق RECOVERY تشرح واجهة الاستعادة المستقلة (تعمل بلا الغرابي)');
add('dr-auto-backup-started-on-server', /drAutoBackup\?\.start\?\.\(\)/.test(serverSrc) && drRoutes.includes('DR full auto-backup scheduled'), 'المؤقّت الداخلي يبدأ على الخادم بعد الاستماع (بلا متصفح)');
add('dr-auto-backup-health-exposed', drRoutes.includes('autoBackup: autoBackupStatus()') && autoBackupModule.includes('intervalMinutes'), 'health يعرض حالة الجدولة (الإيقاع/آخر تشغيل/الاستحقاق) بلا سرّ');
add('dr-auto-backup-endpoint', drRoutes.includes("'/api/dr/auto-backup/run'") && drRoutes.includes('deps.requireOwner'), 'مسار owner لتشغيل دورة الجدولة الآن (تشخيص)');
add('dr-auto-backup-tests', pkg.scripts['test:dr-autobackup'] === 'tsx engine/tests/dr/dr.autoBackup.test.ts' && (pkg.scripts['test:dr'] || '').includes('test:dr-autobackup') && autoBackupTest.includes('restart') && autoBackupTest.includes('already_running') && autoBackupTest.includes('SOURCE_INCOMPLETE'), 'اختبارات الجدولة (6 ساعات/إعادة تشغيل/قفل/فشل/اكتمال مصدر) مربوطة بـtest:dr');

// ---- سدّ فجوات النسخ: تنبيه المالك + موازنة محتوى قاعدة البيانات ----
const dbBalanceModule = fs.existsSync(path.join(root, 'engine/dr/dbBalance.ts')) ? read('engine/dr/dbBalance.ts') : '';
const backupGapsTest = fs.existsSync(path.join(root, 'engine/tests/dr/dr.backupGaps.test.ts')) ? read('engine/tests/dr/dr.backupGaps.test.ts') : '';
const backupModule = fs.existsSync(path.join(root, 'tools/dr/backup.mjs')) ? read('tools/dr/backup.mjs') : '';
add('dr-db-balance-module', dbBalanceModule.includes('computeLiveDatabaseFingerprint') && dbBalanceModule.includes('evaluateDatabaseBalance') && dbBalanceModule.includes('LiveDatabaseFingerprint') && dbBalanceModule.includes('DbBalanceVerdict'), 'وحدة موازنة قاعدة البيانات (بصمة مستقرة + حكم صريح) موجودة');
add('dr-db-balance-fingerprint-timeless', dbBalanceModule.includes('VOLATILE_KEYS') && /VOLATILE_KEYS = new Set\(\[[^\]]*'exportedAt'/.test(dbBalanceModule) && dbBalanceModule.includes('fingerprint'), 'البصمة تتجاهل الطوابع الزمنية (exportedAt/savedAt) فلا تُنتج اختلافاً وهمياً');
add('dr-db-balance-no-invention', dbBalanceModule.includes('no_point') && dbBalanceModule.includes('unavailable') && dbBalanceModule.includes('in_balance') && dbBalanceModule.includes('stale'), 'حالات الموازنة صريحة: لا نقطة/غير متاح/متوازن/متقادم (لا حكم بلا بيانات)');
add('dr-owner-alert-on-backup-failure', drRoutes.includes('notifyOwnerOnce(') && drRoutes.includes("notifyOwnerOnce('backup_failed'") && drRoutes.includes("kind: 'backup_failed'"), 'فشل النسخة يُنبّه المالك عبر القناة القائمة (عنوان عام بلا محتوى)');
add('dr-owner-alert-deduped', drRoutes.includes('function notifyOwnerOnce') && drRoutes.includes('ALERT_DEDUP_MS') && drRoutes.includes('alerts[dedupKey]') && drRoutes.includes('atMs'), 'التنبيه يمنع التكرار داخل نافذة زمنية (لا إغراق المالك)');
add('dr-db-balance-detects-new-data', drRoutes.includes('checkDatabaseBalance') && /database_stale/.test(drRoutes) && drRoutes.includes('notifyOwnerOnce(') && drRoutes.includes('database_stale:'), 'الفحص الدوري يكشف بيانات جديدة (منتجات/أسعار/مبيعات) ويُنبّه بلا تغيير كود');
add('dr-db-balance-wired-in-cycle', /runReconciliationCycle[\s\S]{0,4000}checkDatabaseBalance\(\)/.test(drRoutes) && drRoutes.includes('databaseBalance'), 'موازنة القاعدة مربوطة بدورة الفحص الساعي وتُحفظ نتيجتها (تصمد بعد restart)');
add('dr-db-balance-durable-state', serverSrc.includes('driveDbBalance') && serverSrc.includes('drControl.driveDbBalance = control.driveDbBalance') && serverSrc.includes('driveDbBalance: drControl.driveDbBalance') && serverSrc.includes('driveAlerts'), 'حالة الموازنة والتنبيهات تُحفظ وتُسترجع عبر محوّل الحالة');
add('dr-db-balance-in-change-detection', backupModule.includes('databaseFingerprint') && /prevDb === nextDb/.test(backupModule), 'تغيّر قاعدة البيانات وحده يُنتج نقطة استعادة جديدة (لا يبقى no_change كاذباً)');
add('dr-db-balance-health-exposed', drRoutes.includes('databaseBalance: control().driveDbBalance') && drRoutes.includes('ownerAlerts:'), 'health يعرض الموازنة والتنبيهات (أرقام/أنواع فقط بلا محتوى)');
add('dr-db-balance-endpoint-owner', drRoutes.includes("'/api/dr/database-balance/check'") && drRoutes.includes('deps.requireOwner'), 'مسار owner لفحص الموازنة الآن (تشخيص)');
add('dr-db-balance-tests', pkg.scripts['test:dr-backup-gaps'] === 'tsx engine/tests/dr/dr.backupGaps.test.ts' && (pkg.scripts['test:dr'] || '').includes('test:dr-backup-gaps') && backupGapsTest.includes('الموازنة تكشف بيانات جديدة') && backupGapsTest.includes('تنبيه فشل النسخة'), 'اختبارات سدّ الفجوات (تنبيه الفشل + كشف بيانات جديدة + بلا تكرار) مربوطة بـtest:dr');

// ---- مركز استعادة الغرابي AI (خدمة مستقلة) + تعليمات الاختصار + اختبار الانهيار ----
const recoveryCenterModule = fs.existsSync(path.join(root, 'tools/dr/recovery-center.mjs')) ? read('tools/dr/recovery-center.mjs') : '';
const recoveryCenterPkg = fs.existsSync(path.join(root, 'dr-recovery-center/package.json')) ? read('dr-recovery-center/package.json') : '';
const recoveryCenterRender = fs.existsSync(path.join(root, 'dr-recovery-center/render.yaml')) ? read('dr-recovery-center/render.yaml') : '';
const recoveryCenterInstructions = fs.existsSync(path.join(root, 'recovery-instructions.md')) ? read('recovery-instructions.md') : '';
const recoveryCenterInfo = fs.existsSync(path.join(root, 'recovery-information.md')) ? read('recovery-information.md') : '';
add('recovery-center-module', recoveryCenterModule.includes('createRecoveryCenterServer') && recoveryCenterModule.includes('RECOVERY_HONEST_STATES') && recoveryCenterModule.includes('honestStatesFromReport'), 'وحدة مركز الاستعادة المستقلة موجودة (خدمة + حالات صادقة)');
add('recovery-center-standalone', recoveryCenterModule.includes('standalone: true') && !/from ['"][^'"]*\/server(\.ts|\.cjs)?['"]/.test(recoveryCenterModule) && !/dist\/server/.test(recoveryCenterModule) && !/child_process|api\.github\.com/.test(recoveryCenterModule), 'المركز مستقل: لا يستورد خادم الغرابي/dist/git/GitHub');
add('recovery-center-no-vault-key-env', recoveryCenterModule.includes('vaultKeyInEnv: false') && !/DR_RECOVERY_VAULT_KEY:\s*process\.env/.test(recoveryCenterModule), 'المركز لا يحمل مفتاح الخزنة في بيئته (يُدخل وقت الاستعادة فقط)');
add('recovery-center-key-in-body-only', /body\.vaultKey/.test(recoveryCenterModule) && !/query\.vaultKey|searchParams\.get\('vaultKey'\)/.test(recoveryCenterModule), 'مفتاح الخزنة يُمرَّر في جسم POST فقط (لا يظهر في سطر الطلب/السجل)');
add('recovery-center-readonly', recoveryCenterModule.includes('readOnlyStructure: true') && recoveryCenterModule.includes('REFUSED_PRODUCTION_DATABASE'), 'المركز يقرأ Drive فقط ويرفض قاعدة الإنتاج');
add('recovery-center-honest-states', /service_started:\s*false/.test(recoveryCenterModule) && /service_verified:\s*false/.test(recoveryCenterModule) && recoveryCenterModule.includes('تم تشغيل الخدمة'), 'لا يُدّعى تشغيل/تحقق الخدمة (خطوة خارجية) + الحالات الصادقة معلنة');
add('recovery-center-verify-readonly', recoveryCenterModule.includes("url.pathname === '/api/verify'") && recoveryCenterModule.includes('readOnly: true'), 'مسار التحقق قراءة فقط (يتوقف قبل أي كتابة)');
add('recovery-center-target-env-separate', recoveryCenterModule.includes('parseTargetEnv') && recoveryCenterModule.includes('targetEnvNames'), 'إعداد بيئة الهدف خطوة منفصلة؛ تُعلن الأسماء فقط بلا قيم');
add('recovery-center-deploy-package', recoveryCenterPkg.includes('gharabi-recovery-center') && recoveryCenterPkg.includes('node lib/recovery-center.mjs') && recoveryCenterRender.includes('gharabi-recovery-center') && recoveryCenterRender.includes('rootDir: dr-recovery-center'), 'حزمة نشر مستقلة (Render منفصل) لمركز الاستعادة');
add('recovery-center-render-no-vault-key', !/DR_RECOVERY_VAULT_KEY\s*\n\s*sync/.test(recoveryCenterRender) && recoveryCenterRender.includes('DR_RECOVERY_VAULT_KEY **لا يُضبط هنا'), 'render.yaml لا يضبط مفتاح الخزنة إطلاقاً');
add('recovery-center-lib-synced', fs.existsSync(path.join(root, 'dr-recovery-center/lib/recovery-center.mjs')) && fs.existsSync(path.join(root, 'dr-recovery-center/lib/standalone-recovery.mjs')) && read('dr-recovery-center/lib/recovery-center.mjs') === recoveryCenterModule, 'حزمة lib المستقلة مطابقة لوحدة tools/dr (بلا انحراف)');
add('recovery-center-no-secret-literal', !/(GOCSPX|AIzaSy|1\/\/)[A-Za-z0-9_-]{8,}/.test(recoveryCenterModule + recoveryCenterPkg + recoveryCenterRender), 'لا سرّ حقيقي في ملفات المركز (نصوص قوالب فقط)');
add('recovery-instructions-doc', recoveryCenterInstructions.includes('مركز استعادة الغرابي AI') && recoveryCenterInstructions.includes('DR_RECOVERY_VAULT_KEY') && recoveryCenterInstructions.includes('استعادة الغرابي AI') && recoveryCenterInstructions.includes('الشاشة الرئيسية'), 'تعليمات الاختصار (هاتف/كمبيوتر) باسم «استعادة الغرابي AI» بلا أسرار');
add('recovery-information-doc', recoveryCenterInfo.includes('al-gharabi-ai-dr') && recoveryCenterInfo.includes('rp-002') && recoveryCenterInfo.includes('الاحتفاظ') && recoveryCenterInfo.includes('6 ساعات'), 'معلومات الاستعادة: Drive + نقاط محميّة + الاحتفاظ + النسخ كل 6 ساعات');
add('recovery-center-crash-test', (pkg.scripts['test:dr'] || '').includes('test:dr-recovery-center') && fs.existsSync(path.join(root, 'engine/tests/dr/dr.recovery.center.test.ts')) && read('engine/tests/dr/dr.recovery.center.test.ts').includes('render+github down') && read('engine/tests/dr/dr.recovery.center.test.ts').includes('no false service-started claim'), 'اختبار الانهيار (فقدان Render + GitHub + عدم ادّعاء الخدمة) مربوط بـtest:dr');
add('recovery-center-tests-in-npm', pkg.scripts['test:dr-recovery-center'] === 'tsx engine/tests/dr/dr.recovery.center.test.ts' && pkg.scripts.test.includes('test:dr'), 'اختبار المركز مضمّن في test:dr وnpm test');

// ---- مصادقة المالك لمركز الاستعادة المستقل (إغلاق ثغرة كشف بيانات نقاط الاستعادة) ----
const recoveryAuthModule = fs.existsSync(path.join(root, 'tools/dr/recoveryAuth.mjs')) ? read('tools/dr/recoveryAuth.mjs') : '';
const recoveryAuthLib = fs.existsSync(path.join(root, 'dr-recovery-center/lib/recoveryAuth.mjs')) ? read('dr-recovery-center/lib/recoveryAuth.mjs') : '';
add('recovery-center-owner-auth-module', recoveryAuthModule.includes('checkRecoveryOwnerAuth') && recoveryAuthModule.includes('inspectRecoveryOwnerAuth') && recoveryAuthModule.includes('extractBearerToken'), 'وحدة مصادقة المالك للمركز موجودة (منطق صافٍ: فحص/استخراج/حالة)');
add('recovery-center-owner-auth-paths', recoveryAuthModule.includes("RECOVERY_CENTER_PROTECTED_PATHS = ['/api/points', '/api/verify', '/api/restore']") && recoveryAuthModule.includes('isProtectedRecoveryPath'), 'مصدر واحد للمسارات المحميّة (نقاط/تحقق/استعادة)');
add('recovery-center-owner-auth-guard', recoveryCenterModule.includes('isProtectedRecoveryPath(url.pathname)') && /code:\s*'UNAUTHORIZED'/.test(recoveryCenterModule) && /json\(res,\s*401/.test(recoveryCenterModule), 'المركز يفرض 401 على المسارات المحميّة قبل أي معالجة');
add('recovery-center-owner-auth-timing-safe', recoveryAuthModule.includes('timingSafeEqual') && recoveryAuthModule.includes('createHash') && recoveryAuthModule.includes('sha256'), 'مقارنة المفتاح بزمن ثابت + بديل بصمة SHA-256 (بلا مقارنة نصية)');
add('recovery-center-owner-auth-fail-closed', recoveryAuthModule.includes("reason: 'owner_token_not_configured'") && /ALLOW_UNAUTHENTICATED_ENV/.test(recoveryAuthModule) && recoveryAuthModule.includes('allowUnauthenticated'), 'بلا مفتاح: مقيّد افتراضياً (fail-closed) مع مفتاح تجاوز محلي صريح فقط');
add('recovery-center-owner-auth-bearer-header-only', recoveryAuthModule.includes('authorization') && !/searchParams\.get\(|query\.token|body\.ownerToken|body\.token/.test(recoveryAuthModule), 'المفتاح يُقبل من ترويسة Authorization فقط (لا سطر طلب ولا جسم)');
add('recovery-center-owner-auth-health-block', recoveryCenterModule.includes('ownerAuth: recoveryOwnerAuthStatus(env)') && recoveryAuthModule.includes('recoveryOwnerAuthStatus'), 'الصحة تُعلن حالة مصادقة المالك (منطقي فقط — بلا أي قيمة سرّية)');
add('recovery-center-owner-auth-health-no-secret', !/RECOVERY_CENTER_OWNER_TOKEN\s*:/.test(recoveryCenterModule) && recoveryAuthModule.includes('protectedPaths'), 'المركز لا يُعيد قيمة المفتاح ولا يضبطه نصاً');
add('recovery-center-owner-auth-ui', recoveryCenterModule.includes('ownerToken') && recoveryCenterModule.includes('authHeaders') && recoveryCenterModule.includes('gharabi_recovery_owner'), 'الواجهة تجمع مفتاح المالك وتُرسله كـBearer (بلا تسجيله على الخادم)');
add('recovery-center-owner-auth-render-env', /key:\s*RECOVERY_CENTER_OWNER_TOKEN\s*\n\s*sync:\s*false/.test(recoveryCenterRender) && /key:\s*RECOVERY_CENTER_OWNER_TOKEN_HASH\s*\n\s*sync:\s*false/.test(recoveryCenterRender), 'render.yaml يوثّق RECOVERY_CENTER_OWNER_TOKEN(_HASH) بلا قيمة في Git');
add('recovery-center-owner-auth-lib-synced', recoveryAuthLib !== '' && recoveryAuthLib === recoveryAuthModule && read('dr-recovery-center/lib/recovery-center.mjs').includes("from './recoveryAuth.mjs'"), 'نسخة lib المتزامنة لمصادقة المالك مطابقة لوحدة tools/dr (بلا انحراف)');
add('recovery-center-owner-auth-test', (pkg.scripts['test:dr'] || '').includes('test:dr-recovery-center-auth') && fs.existsSync(path.join(root, 'engine/tests/dr/dr.recovery.center.auth.test.ts')) && read('engine/tests/dr/dr.recovery.center.auth.test.ts').includes('anonymous /api/points => 401') && read('engine/tests/dr/dr.recovery.center.auth.test.ts').includes('correct token /api/points => 200'), 'اختبار مصادقة المالك (401 بلا مفتاح + 200 بالمفتاح) مربوط بـtest:dr');

// ---- مصدر رمز Drive لمركز الاستعادة المستقل (بلا نقل أي رمز نصي) ----
const tokenSourceModule = fs.existsSync(path.join(root, 'tools/dr/token-source.mjs')) ? read('tools/dr/token-source.mjs') : '';
add('token-source-module', tokenSourceModule.includes('loadRefreshTokenFromDatabase') && tokenSourceModule.includes('resolveRefreshTokenSource') && tokenSourceModule.includes('inspectRefreshTokenSource'), 'وحدة مصدر الرمز موجودة (قراءة مشفّرة/بيئة/صريح)');
add('token-source-state-db-env', tokenSourceModule.includes("DR_STATE_DATABASE_URL_ENV = 'DR_STATE_DATABASE_URL'") && tokenSourceModule.includes('DR_RECOVERY_STATE_DATABASE_URL'), 'متغيّر اتصال قاعدة الحالة واضح (DR_STATE_DATABASE_URL) + بديل مقبول');
add('token-source-reads-encrypted', /driveRefreshToken/.test(tokenSourceModule) && tokenSourceModule.includes('decryptDriveSecret') && tokenSourceModule.includes('gharabi_state'), 'يقرأ رمز التجديد **المشفّر** من جدول الحالة ويفكّه بمفتاح التشفير نفسه (بلا رمز نصي)');
add('token-source-no-plaintext-transfer', !/process\.env\.DATABASE_URL/.test(tokenSourceModule) && !/new DriveClient|createRefreshTokenProvider/.test(tokenSourceModule), 'لا يقرأ قاعدة الإنتاج ولا يبني عميلاً (قراءة الرمز فقط)');
add('token-source-env-backcompat-only', tokenSourceModule.includes('env_plaintext') && tokenSourceModule.includes('state_database') && read('recovery-information.md').includes('DR_STATE_DATABASE_URL'), 'الرمز من البيئة توافق خلفي فقط، والمصدر المفضّل قاعدة الحالة المشفّرة (موثّق)');
add('token-source-pg-dep', read('dr-recovery-center/package.json').includes('"pg"') && fs.existsSync(path.join(root, 'dr-recovery-center/lib/token-source.mjs')), 'حزمة الاستعادة تحمل pg ونسخة token-source المتزامنة');
add('token-source-render-env', /key:\s*DR_STATE_DATABASE_URL\s*\n\s*sync:\s*false/.test(read('dr-recovery-center/render.yaml')) && read('dr-recovery-center/render.yaml').includes('DRIVE_TOKEN_ENCRYPTION_KEY'), 'render.yaml يوثّق DR_STATE_DATABASE_URL + DRIVE_TOKEN_ENCRYPTION_KEY (sync:false)');
add('token-source-no-vault-key', !/DR_RECOVERY_VAULT_KEY\s*\n\s*sync/.test(read('dr-recovery-center/render.yaml')) && tokenSourceModule.includes('DR_RECOVERY_VAULT_KEY') === false, 'لا مفتاح خزنة في مصدر الرمز ولا في render.yaml');
add('token-source-center-health', recoveryCenterModule.includes('refreshTokenSource') && recoveryCenterModule.includes('refreshTokenAvailable') && recoveryCenterModule.includes('stateDatabaseConfigured'), 'صحة المركز تعلن مصدر الرمز وقاعدة الحالة بلا أي قيمة سرّية');
add('token-source-center-no-secret', !/refreshToken\s*:\s*(plain|token)\b/.test(recoveryCenterModule) && !/DRIVE_OAUTH_REFRESH_TOKEN\s*:/.test(recoveryCenterModule), 'المركز لا يُعيد الرمز ولا يضبطه نصاً');
add('token-source-test', (pkg.scripts['test:dr'] || '').includes('test:dr-token-source') && fs.existsSync(path.join(root, 'engine/tests/dr/dr.token.source.test.ts')) && read('engine/tests/dr/dr.token.source.test.ts').includes('state_database') && read('engine/tests/dr/dr.token.source.test.ts').includes('no secret'), 'اختبار مصدر الرمز (قاعدة الحالة المشفّرة + عدم التسريب) مربوط بـtest:dr');

// ---- PWA: مركز الاستعادة تطبيق قابل للتثبيت (جوال + سطح مكتب) ----
const pwaModule = fs.existsSync(path.join(root, 'tools/dr/recoveryPwa.mjs')) ? read('tools/dr/recoveryPwa.mjs') : '';
const pwaLib = fs.existsSync(path.join(root, 'dr-recovery-center/lib/recoveryPwa.mjs')) ? read('dr-recovery-center/lib/recoveryPwa.mjs') : '';
add('pwa-module', pwaModule.includes('buildManifest') && pwaModule.includes('iconPng') && pwaModule.includes('servePwaAsset') && pwaModule.includes('injectPwaIntoHtml'), 'وحدة PWA موجودة (بيان + أيقونات + خدمة أصول + حقن)');
add('pwa-manifest-standalone', pwaModule.includes("display: 'standalone'") && pwaModule.includes("start_url: '/'") && pwaModule.includes("scope: '/'") && pwaModule.includes('theme_color'), 'البيان: display standalone + start_url/scope + theme_color');
add('pwa-icons-192-512-maskable', pwaModule.includes("'/icons/icon-192.png': 192") && pwaModule.includes("'/icons/icon-512.png': 512") && pwaModule.includes('maskable') && pwaModule.includes('apple-touch-icon'), 'أيقونات 192/512 + maskable + Apple touch icon');
add('pwa-service-worker-no-cache', pwaModule.includes('self.skipWaiting') && !/caches\.open|cache\.put|CacheStorage/.test(pwaModule) && !/respondWith/.test(pwaModule.replace(/\/\*[\s\S]*?\*\//g, '')), 'Service Worker بلا كاش إطلاقاً (لا respondWith ولا caches) — online-first');
add('pwa-service-worker-guards-api', /\/api\//.test(pwaModule) && /GET/.test(pwaModule), 'سياسة الـService Worker تعلن حماية /api/* والطلبات غير GET (بلا كاش لاستجابات المصادقة/النقاط)');
add('pwa-center-wired', recoveryCenterModule.includes("from './recoveryPwa.mjs'") && recoveryCenterModule.includes('injectPwaIntoHtml') && recoveryCenterModule.includes('servePwaAsset'), 'المركز يحقن وسوم PWA ويخدم أصولها (بلا تغيير أي منطق استعادة)');
add('pwa-lib-synced', pwaLib !== '' && pwaLib === pwaModule, 'نسخة lib المتزامنة للـPWA مطابقة لوحدة tools/dr (بلا انحراف)');
add('pwa-no-secret', !/(GOCSPX|AIzaSy|1\/\/)[A-Za-z0-9_-]{8,}/.test(pwaModule) && !/DRIVE_TOKEN_ENCRYPTION_KEY|DR_RECOVERY_VAULT_KEY|refresh[_-]?token\s*[:=]/.test(pwaModule), 'لا سرّ/مفتاح/متغيّر بيئة داخل وحدة PWA (بيانات عرض فقط)');
add('pwa-test-wired', (pkg.scripts['test:dr'] || '').includes('test:dr-pwa') && fs.existsSync(path.join(root, 'engine/tests/dr/dr.pwa.test.ts')) && read('engine/tests/dr/dr.pwa.test.ts').includes('standalone') && read('engine/tests/dr/dr.pwa.test.ts').includes('no secret'), 'اختبار PWA (بيان/أيقونات/service worker/عدم التسريب) مربوط بـtest:dr');
// بصمة بناء غير سرّية: بلا بصمة لا يمكن إثبات أي نسخة تعمل فعلاً على الخدمة المستقلة.
add('recovery-center-build-marker', recoveryCenterModule.includes('RECOVERY_CENTER_BUILD') && recoveryCenterModule.includes('build: RECOVERY_CENTER_BUILD'), 'صحة المركز تعلن بصمة بناء غير سرّية تُثبت النسخة العاملة (منع «إصلاح لم يُنشر» صامتاً)');
// autoDeploy مفعّل: بدون ذلك لا يستلم المركز أي إصلاح مدموج إلى main.
add('recovery-center-autodeploy', /autoDeploy:\s*true/.test(recoveryCenterRender) && /branch:\s*main/.test(recoveryCenterRender), 'خدمة مركز الاستعادة تتابع فرع main مع autoDeploy (تستلم الإصلاحات المدموجة)');
// فشل قراءة Drive يُعلن كوداً صريحاً بدل خطأ 500 غامض.
add('recovery-center-points-explicit-failure', /listed\.ok !== true/.test(recoveryCenterModule) && /reason: listed\.code \|\| 'list_failed'/.test(recoveryCenterModule), 'فشل /api/points يُعلن السبب الصريح (لا 500 غامض يخفي العطل الحقيقي)');
add('dr-token-errors-distinct', drSources[4].includes("code: 'no_refresh_token'") && drSources[4].includes("code: 'invalid_client'") && drSources[4].includes("code: 'token_refresh_unauthorized'") && drSources[4].includes("code: 'token_refresh_other_error'"), 'أكواد خطأ الرمز منفصلة (لا تُجمع تحت unauthorized)');
add('dr-token-no-collapse-unauthorized', !/code:\s*'unauthorized'/.test(drSources[4]), 'طبقة OAuth لا تُصدر كود unauthorized إطلاقاً بعد التمييز');
add('dr-refresh-diagnostic-readonly', drSources[4].includes('diagnoseDriveRefreshToken') && drSources[4].includes('refresh_token_undecryptable') && drSources[4].includes('client_missing') && drSources[4].includes('client_secret_missing'), 'فحص تشخيصي قراءة-فقط يفرّق فكّ التشفير عن غياب الاعتماد');
add('dr-oauth-client-trim', drSources[4].includes('export function trimmedEnvValue') && drSources[4].includes('clientIdHadWhitespace') && /trimmedEnvValue\(options\.clientId/.test(drSources[4]), 'قيم اعتماد OAuth تُقصّ (مسافة/سطر/تنصيص) قبل الإرسال — منع invalid_client من قيمة ملوّثة');
add('dr-oauth-google-fallback', drSources[4].includes('resolveDriveClientCredentials') && drSources[4].includes('google_fallback') && drSources[4].includes('driveClientIdIgnored'), 'تجاوز قيمة DRIVE غير الصالحة إلى اعتماد Google القائم (بلا مطالبة المالك بأي سرّ)');
// كتلة الصحة العامة أُقلّصت: لا تفاصيل اعتماد/مفتاح (أطوال/بصمات) بلا مصادقة.
const drHealthBlock = (drRoutes.match(/app\.get\('\/api\/dr\/health',[\s\S]*?\n  \}\);\n/) || [''])[0];
add('dr-health-public-oauthClient-minimal', /oauthClient:\s*\{[\s\S]{0,160}clientIdPresent:\s*oauthDiag\.clientIdPresent[\s\S]{0,80}clientSecretPresent:\s*oauthDiag\.clientSecretPresent/.test(drHealthBlock), 'الصحة العامة تعلن وجود الاعتماد فقط (بلا طول/صيغة/بصمة)');
add('dr-health-public-no-oauth-fingerprint', !drHealthBlock.includes('oauthClient: oauthDiag') && !drHealthBlock.includes('oauthClient: inspectDriveOAuthClient') && !drHealthBlock.includes('clientIdFingerprint') && !drHealthBlock.includes('effectiveClientIdFingerprint'), 'الصحة العامة لا تعرض أي بصمة/طول لاعتماد OAuth');
add('dr-health-public-recoveryMasterKey-minimal', /recoveryMasterKey:\s*\{\s*state:\s*masterKey\.state\s*\}/.test(drHealthBlock) && !/recoveryMasterKey:\s*masterKey,/.test(drHealthBlock), 'الصحة العامة تعلن حالة المفتاح الرئيسي فقط بلا perKey');
add('dr-health-public-no-vault-fingerprint', /vaultKey:\s*\{\s*state:\s*inspectVaultKey\(env as NodeJS\.ProcessEnv\)\.state\s*\}/.test(drHealthBlock), 'الصحة العامة تعلن حالة مفتاح الخزنة فقط (بلا طول/بصمة)');
add('dr-health-detail-owner-route', /app\.get\('\/api\/dr\/health\/detail',\s*deps\.authenticateToken,\s*deps\.requireOwner/.test(drRoutes), 'مسار تفاصيل التشخيص محمي بـauthenticateToken + requireOwner (owner فقط)');
add('dr-health-detail-full-diagnostics', /app\.get\('\/api\/dr\/health\/detail'[\s\S]*?oauthClient:\s*inspectDriveOAuthClient\(/.test(drRoutes) && /app\.get\('\/api\/dr\/health\/detail'[\s\S]*?recoveryMasterKey:\s*inspectMasterKey\(/.test(drRoutes), 'المسار المحمي يعرض التشخيص الكامل (oauthClient + recoveryMasterKey) للمالك');
add('dr-health-detail-refresh-shared', drRoutes.includes('refreshTokenDiagnosticNow') && (drRoutes.match(/refreshTokenDiagnosticNow\(/g) || []).length >= 3, 'التشخيص مُستخرَج في دالة مشتركة تستخدمها الصحة العامة ومسار التفاصيل (لا انحراف)');
add('dr-health-privacy-test', fs.existsSync(path.join(root, 'engine/tests/dr/dr.health.privacy.test.ts')) && (pkg.scripts['test:dr'] || '').includes('test:dr-health-privacy') && pkg.scripts.test.includes('test:dr'), 'اختبار خصوصية /api/dr/health موجود ومربوط في test:dr وnpm test');
add('dr-oauth-effective-source-exposed', drSources[4].includes('effectiveClientIdSource') && /app\.get\('\/api\/dr\/health\/detail'[\s\S]*?oauthClient:\s*inspectDriveOAuthClient\(/.test(drRoutes), 'فحص اعتماد OAuth يعرض مصدر المعرّف الفعّال (drive/google_fallback) في المسار المحمي');
add('dr-oauth-google-fallback-test', read('engine/tests/dr/dr.auth.test.ts').includes('google_fallback') && read('engine/tests/dr/dr.auth.test.ts').includes('resolveDriveClientCredentials'), 'اختبار التجاوز إلى اعتماد Google + عدم استخدامه عند صلاح قيمة DRIVE');
add('dr-oauth-client-inspect-no-secret', drSources[4].includes('inspectDriveOAuthClient') && drSources[4].includes('clientIdFingerprint') && !/inspectDriveOAuthClient[\s\S]{0,600}clientSecret\s*:/.test(drSources[4]), 'فحص اعتماد العميل يعرض طولاً/صيغة/بصمة فقط بلا أي قيمة سرّية');
add('dr-health-oauthClient-owner-only', drRoutes.includes('inspectDriveOAuthClient'), 'فحص اعتماد OAuth Client الكامل متاح فقط عبر مسار owner المحمي');
add('dr-health-next-action-single', drRoutes.includes('nextActionMessage') && /nextAction\s*=\s*'reauthorize_drive'/.test(drRoutes), 'health يعلن إجراءً واحداً صريحاً (none/connect/configure/reauthorize) بلا أي سرّ');
add('dr-health-refreshToken-diagnostic', /refreshToken:\s*\{[\s\S]{0,200}providerRefresh/.test(drRoutes) && drRoutes.includes('diagnoseDriveRefreshToken') && drRoutes.includes('decryptable'), 'health يعرض تشخيص refreshToken المختصر (stored/decryptable/providerRefresh/reason)');
add('dr-health-refreshToken-no-secret', !/refreshToken:\s*\{[\s\S]{0,200}(token|secret|accessToken):/.test(drRoutes), 'حقول تشخيص الرمز لا تحمل أي قيمة سرّية');
add('dr-refresh-diagnostic-tests', read('engine/tests/dr/dr.auth.test.ts').includes('diagnoseDriveRefreshToken') && read('engine/tests/dr/dr.auth.test.ts').includes('refresh_token_undecryptable') && read('engine/tests/dr/dr.auth.test.ts').includes('token_refresh_unauthorized'), 'اختبارات التشخيص: فكّ صحيح/مفتاح خاطئ/مفقود/invalid_client/unauthorized/بلا تسريب');
add('dr-backup-tests-present', fs.existsSync(path.join(root, 'engine/tests/dr/dr.backup.test.ts')) && (pkg.scripts['test:dr'] || '').includes('test:dr-backup') && pkg.scripts.test.includes('test:dr'), 'اختبار النسخة الاحتياطية مضمّن في test:dr وnpm test');
add('dr-backup-api-post', /createDrBackup[\s\S]{0,200}method:\s*'POST'/.test(read('src/services/api.ts')), 'واجهة API تُنشئ النسخة عبر POST');
add('dr-backup-ui-button', cloudView.includes('apiService.createDrBackup') && cloudView.includes('إنشاء Recovery Point') && cloudView.includes('resolveDrBackupResult'), 'زر النسخة الاحتياطية الفعلي موجود ويعرض نتيجة الخادم الصادقة');
add('dr-backup-ui-history', cloudView.includes('snapshot?.history') && cloudView.includes('نقاط الاستعادة'), 'واجهة نقاط الاستعادة الحقيقية معروضة');

// --- منظومة التعافي الكامل: مرآة CURRENT، حزمة الأسرار، وثائق RECOVERY، ومحرّك الاستعادة ---
const drSecrets = fs.existsSync(path.join(drDir, 'secret-crypto.mjs')) ? read('tools/dr/secret-crypto.mjs') : '';
const drMirror = fs.existsSync(path.join(drDir, 'current-mirror.mjs')) ? read('tools/dr/current-mirror.mjs') : '';
const drRestore = fs.existsSync(path.join(drDir, 'restore.mjs')) ? read('tools/dr/restore.mjs') : '';
const drStore = read('tools/dr/drive-store.mjs');

add('dr-secrets-module', drSecrets.includes('export function buildSecretsBundle') && drSecrets.includes('export function decryptSecretsPackage') && drSecrets.includes('aes-256-gcm'), 'حزمة الأسرار المشفّرة موجودة (AES-256-GCM)');
add('dr-secrets-magic-versioned', drSources[0].includes("SECRETS_PACKAGE_MAGIC = 'GHARABI-SECRETS-V1'") && drSecrets.includes('scrypt'), 'الحزمة موسومة بإصدار (GHARABI-SECRETS-V1) ومفتاح مشتقّ (scrypt)');
add('dr-secrets-env-discovery', drSecrets.includes('export function discoverSecretEnvNames') && drSecrets.includes('NON_SECRET_ENV'), 'اكتشاف أسماء الأسرار من البيئة الفعلية فقط بلا اختراع');
add('dr-secrets-master-key-single-source', drSecrets.includes('export function resolveMasterKey') && drSecrets.includes('DR_RECOVERY_MASTER_KEY') && drSecrets.includes('DRIVE_DB_BACKUP_KEY'), 'مفتاح الاستعادة الرئيسي مصدر واحد مع سقوط آمن');
add('dr-secrets-no-plaintext-upload', read('tools/dr/drive-store.mjs').includes('writeSecretsPackage') && !read('tools/dr/drive-store.mjs').includes('secrets: raw'), 'الأسرار تُرفع مشفّرة فقط (writeSecretsPackage)');
add('dr-secrets-manifest-names-only', drSecrets.includes('includedNames') && drSecrets.includes('encryptedSecretsHash') && drSecrets.includes('keyFingerprint'), 'بيان الأسرار يحمل أسماء وبصمات فقط بلا قيم');

add('dr-current-mirror-module', drMirror.includes('export async function runCurrentMirror') && drMirror.includes('treeHash'), 'مرآة CURRENT الفردية موجودة (ملفات بمكانها + treeHash)');
add('dr-current-mirror-atomic', drMirror.includes('writeVersionManifest') && drMirror.includes('writeMirrorHead') && drMirror.includes('partial_upload'), 'ترقية CURRENT ذرّية: بناء نسخة مستقلة + التحقق ثم اعتماد HEAD أخيراً (لا نسخة نصف مكتملة)');
add('dr-current-mirror-no-change', drMirror.includes("state: 'no_change'") && drMirror.includes('diffSnapshots'), 'لا إعادة رفع بلا تغيّر (مقارنة لقطة)');
add('dr-current-mirror-history-safe', drMirror.includes('deleteVersionDir') && !drMirror.includes('history'), 'حذف النسخ القديمة من CURRENT فقط ولا يمسّ HISTORY');
// نموذج النسخة المُرقّمة: نسخ مستقلة + مرجع اعتماد واحد (HEAD.json) + تنظيف لاحق.
add('dr-current-mirror-versioned', drStore.includes('writeMirrorHead') && drStore.includes('readMirrorHead') && drStore.includes('writeVersionManifest') && drStore.includes('listVersions') && drSources[0].includes('MIRROR_HEAD_NAME'), 'نسخ CURRENT مُرقّمة مستقلة + مرجع اعتماد واحد (HEAD.json)');
add('dr-current-mirror-head-single-commit', drMirror.indexOf('writeVersionManifest(newVersion') > -1 && drMirror.indexOf('writeVersionManifest(newVersion') < drMirror.indexOf('writeMirrorHead(head)'), 'الاعتماد (HEAD) يجري بعد كتابة البيان والتحقق — نقطة التزام واحدة');
add('dr-current-mirror-cleanup-pending', drMirror.includes('export async function cleanupOldVersions') && drMirror.includes('cleanupPending') && drMirror.includes('export async function resolveCurrentMirror'), 'التنظيف لاحق لا يُسقط الاعتماد؛ فشله يُعلَن cleanupPending ويُعاد، وCURRENT تُحسم من HEAD');
add('dr-current-mirror-read-via-head', drStore.includes('readCurrentMirrorManifest') && drStore.includes('listCurrentFiles') && drStore.includes('readCurrentFile'), 'قراءة CURRENT تمرّ من HEAD.json مع رجوع للبنية القديمة للقراءة فقط');

add('dr-restore-engine-module', drRestore.includes('export async function verifyRecoveryPoint') && drRestore.includes('export async function runRecoveryDrill'), 'محرّك الاستعادة موجود (تحقق + اختبار معزول)');
add('dr-restore-verify-hashes', drRestore.includes('source_hash_mismatch') && drRestore.includes('secrets_hash_mismatch') && drRestore.includes('manifest_missing'), 'الاستعادة تتحقق من كل البصمات وتفشل بأمان عند التلف/النقص');
add('dr-restore-isolated-only', drRestore.includes('wroteToProduction: false') && drRestore.includes('applyDatabaseDump') && drRestore.includes('gharabi_state'), 'الاستعادة في قاعدة معزولة فقط ولا تكتب فوق الإنتاج');
add('dr-restore-no-raw-in-response', drRoutes.includes('const { sql, secrets, ...safe }') && drRoutes.includes('returnSecrets: false'), 'رد الاستعادة لا يحمل SQL خاماً ولا أسراراً');

add('dr-recovery-docs', drSources[0].includes('buildRecoveryInformation') && drSources[0].includes('buildRecoveryInstructions') && drSources[0].includes('buildLatestRecovery'), 'وثائق RECOVERY المستقلة موجودة (بلا تشغيل الغرابي)');
add('dr-recovery-docs-no-secret', drSources[0].includes('لا تحتوي أي قيمة سرّية'), 'وثيقة التعافي تعلن صراحةً أنها بلا أسرار');
add('dr-store-recovery-docs', drStore.includes('writeRecoveryDoc') && drStore.includes('readRecoveryDoc') && drStore.includes('writeCurrentState'), 'مخزن Drive يكتب/يقرأ وثائق التعافي وcurrent-state');
add('dr-store-independent-dirs', drStore.includes('writeSecretsPackage') && drStore.includes('keepAliveDbDump') && drStore.includes('listDbDumps'), 'حزمة الأسرار ونسخة DB في مجلدات مستقلة');

add('dr-endpoints-recovery', drRoutes.includes("'/api/dr/recovery-points'") && drRoutes.includes("'/api/dr/secrets/status'") && drRoutes.includes("'/api/dr/restore/plan'") && drRoutes.includes("'/api/dr/restore/drill'") && drRoutes.includes("'/api/dr/restore/production'"), 'مسارات التعافي الكاملة موجودة (owner-gated)');
add('dr-restore-production-locked', drRoutes.includes('OWNER_CONFIRMATION_REQUIRED') && drRoutes.includes('PRODUCTION_RESTORE_EXTERNAL'), 'الاستعادة الإنتاجية مقفلة بتأكيد المالك ولا تكتب فوق الإنتاج تلقائياً');
add('dr-drill-refuses-production-db', drRoutes.includes('REFUSED_PRODUCTION_DATABASE') && drRoutes.includes('DR_RECOVERY_TEST_DATABASE_URL'), 'اختبار الاستعادة يرفض قاعدة الإنتاج صراحةً');
add('dr-recovery-tests-present', ['dr.secrets.test.ts', 'dr.mirror.test.ts', 'dr.restore.test.ts', 'dr.endpoints.test.ts', 'dr.real-drill.test.ts'].every((f) => fs.existsSync(path.join(root, 'engine/tests/dr', f))) && (pkg.scripts['test:dr'] || '').includes('test:dr-real-drill'), 'اختبارات التعافي (أسرار/مرآة/استعادة/معزول) موجودة ومضمّنة');
add('dr-real-drill-isolated', fs.existsSync(path.join(root, 'engine/tests/dr/dr.real-drill.test.ts')) && read('engine/tests/dr/dr.real-drill.test.ts').includes('EmbeddedPostgres') && read('engine/tests/dr/dr.real-drill.test.ts').includes('bootRestoredSource'), 'اختبار تعافٍ حقيقي معزول (PG حقيقية + إقلاع الخادم المستعاد)');
add('dr-real-drill-no-prod', read('engine/tests/dr/dr.real-drill.test.ts').includes('isolated db differs from production db') && read('engine/tests/dr/dr.real-drill.test.ts').includes('no secret leaked in boot logs'), 'الاختبار المعزول يفصل قاعدة الاستعادة ويؤكّد عدم تسريب الأسرار');
add('dr-secret-scan-no-self-block', !/engine\/tests\/dr\/dr\.secrets\.test\.ts['"][^\n]*AIzaSy/.test(drSources[0]) && read('engine/tests/dr/dr.secrets.test.ts').includes('dummy test value'), 'قيم الأسرار الوهمية في الاختبار موسومة فلا تُعطّل النسخة الحقيقية');

// --- مصدر DR الموثوق + حماية «المصدر الناقص» (جذر نسخة الملفين على Docker) ---
const drCloudSync = fs.existsSync(path.join(drDir, 'cloud-sync.mjs')) ? read('tools/dr/cloud-sync.mjs') : '';
add('dr-source-git-tracked', drCloudSync.includes('export function collectGitTrackedFiles') && drCloudSync.includes("'ls-files'") && drCloudSync.includes('export function collectTrustedSourceTree'), 'مصدر DR يجمع الشجرة المتتبَّعة في Git (لا مجرد مشي على المجلد)');
add('dr-source-walk-fallback', drCloudSync.includes("source: 'git'") && drCloudSync.includes("source: 'walk'"), 'سقوط صريح إلى المشي على المجلد عند غياب Git مع وسم المصدر');
add('dr-source-completeness-single-source', drCloudSync.includes('export function assessSourceCompleteness') && drCloudSync.includes('SOURCE_MIN_FILES') && drCloudSync.includes('SOURCE_REQUIRED_FILES'), 'فحص اكتمال المصدر مصدر واحد (حد أدنى + ملفات إلزامية)');
add('dr-server-uses-trusted-collector', server.includes('collectTrustedSourceTree') && !server.includes('collectRepoFiles(process.cwd())'), 'server.ts يستخدم جامع الشجرة الموثوق (لا مشي مجلد ناقص)');
add('dr-backup-guards-incomplete', drRoutes.includes('SOURCE_INCOMPLETE') && drRoutes.indexOf('SOURCE_INCOMPLETE') < drRoutes.indexOf('await runBackup('), 'مسار النسخة يرفض المصدر الناقص (SOURCE_INCOMPLETE) قبل أي رفع');
const drIncompleteGuards = (drRoutes.match(/code: 'SOURCE_INCOMPLETE'/g) || []).length;
const drSecondIncompleteGuard = drRoutes.indexOf("code: 'SOURCE_INCOMPLETE'", drRoutes.indexOf("code: 'SOURCE_INCOMPLETE'") + 1);
add('dr-sync-guards-incomplete', drIncompleteGuards >= 2 && drSecondIncompleteGuard > -1 && drSecondIncompleteGuard < drRoutes.lastIndexOf('await runCurrentMirror('), 'مسارا النسخة والمزامنة يرفضان المصدر الناقص (لا نسخة سليمة من شجرة ناقصة)');
add('dr-health-source-collection', /sourceCollection:\s*sourceCollectionStatus\(\)/.test(drRoutes) && drRoutes.includes('function sourceCollectionStatus'), 'health يعرض حالة جمع المصدر (اكتمال + مصدر + عدد) بلا محتوى');
add('dr-source-collection-no-secret', !/sourceCollection[\s\S]{0,400}(clientSecret|refreshToken|GOCSPX|masterKey)/.test(drRoutes), 'حالة جمع المصدر لا تحمل أي قيمة سرّية');
add('dr-source-test-present', fs.existsSync(path.join(root, 'engine/tests/dr/dr.source.test.ts')) && (pkg.scripts['test:dr'] || '').includes('test:dr-source'), 'اختبار مصدر DR الموثوق + حماية النقص مضمّن في test:dr');
// الفحص الساعي (reconciliation) + مشغّل التغيّر + وثائق RECOVERY الموحّدة.
add('dr-hourly-reconciliation-single-source', drRoutes.includes('runReconciliationCycle') && drRoutes.includes('startDriveReconciliation') && /RECONCILE_INTERVAL_MS = 60 \* 60 \* 1000/.test(drRoutes), 'الفحص الساعي مصدر واحد بمؤقّت داخلي كل ساعة');
add('dr-reconciliation-no-op-on-match', drRoutes.includes("outcome = 'no_op'") && /prevMirror\.treeHash === sourceTreeHash/.test(drRoutes), 'التطابق ⇒ no-op بلا رفع (كشف «لا تغيير» قبل المزامنة)');
add('dr-reconciliation-no-false-no-op-on-pending', /prevMirror\.treeHash === sourceTreeHash && !prevMirror\.cleanupPending/.test(drRoutes) && drRoutes.includes('result.headVersion = sync.body?.headVersion') && drRoutes.includes('result.cleanupPending = sync.body?.cleanupPending'), 'no-op صادق: لا يُعلن «لا تغيير» عند وجود تنظيف معلّق، والرد يحمل نسخة الاعتماد');
add('dr-reconciliation-incomplete-guard', drRoutes.includes("outcome = 'source_incomplete'"), 'المصدر الناقص ⇒ source_incomplete بلا تغيير');
add('dr-reconciliation-concurrency-lock', drRoutes.includes('reconciliationRunning') && drRoutes.includes("reason: 'already_running'"), 'قفل يمنع تشغيل دورة متوازية لنفس العملية');
add('dr-reconciliation-unref', /reconciliationTimer as any\)\.unref/.test(drRoutes), 'المؤقّت .unref() فلا يمنع الإغلاق النظيف/persist');
add('dr-reconciliation-started-after-listen', /startYouTubeWatcher\(\);[\s\S]{0,400}drReconciliation\?\.start\?\.\(\)/.test(server), 'الخادم يبدأ الفحص الساعي بعد الاستماع (مستقل عن المتصفح)');
add('dr-reconciliation-health-fields', drRoutes.includes('changeTrigger:') && drRoutes.includes('hourlyReconciliation: reconciliationStatus()') && drRoutes.includes('lastReconciliationAt:') && drRoutes.includes('lastReconciliationResult:'), 'health يعرض changeTrigger/hourlyReconciliation/lastReconciliationAt/lastReconciliationResult');
add('dr-reconciliation-no-ai', !/reconciliation[\s\S]{0,2000}aiEngine|aiEngine[\s\S]{0,2000}reconciliation/.test(drRoutes), 'الفحص الساعي لا يستدعي Gemini/أي ذكاء اصطناعي');
add('dr-reconciliation-persisted', server.includes('driveReconciliation: drControl.driveReconciliation') && drRoutes.includes("lastReconciliationResult: result.outcome"), 'نتيجة الفحص تُحفظ وتصمد بعد restart');
add('dr-recovery-docs-unified-names', drCloudLib.includes('START-HERE.md') && drCloudLib.includes('RECOVERY-GUIDE.md') && drCloudLib.includes('RECOVERY-MANIFEST.json'), 'أسماء وثائق RECOVERY موحّدة: START-HERE/RECOVERY-GUIDE/RECOVERY-MANIFEST');
add('dr-recovery-docs-written-on-backup', drBackup.includes('writeRecoveryDocs'), 'النسخة تكتب وثائق RECOVERY الموحّدة');
add('dr-recovery-docs-no-secret', !/START-HERE[\s\S]{0,400}(GOCSPX|refreshToken|masterKey)/.test(drCloudLib), 'وثائق RECOVERY بلا أي قيمة سرّية');
add('dr-recovery-docs-explains-key-not-stored', drCloudLib.includes('لا يُحفظ داخل النسخة'), 'الوثائق تشرح أن المفتاح الرئيسي لا يُحفظ داخل النسخة');
add('dr-reconciliation-test-present', fs.existsSync(path.join(root, 'engine/tests/dr/dr.reconciliation.test.ts')) && (pkg.scripts['test:dr'] || '').includes('test:dr-reconciliation'), 'اختبار الفحص الساعي/مشغّل التغيّر/الوثائق مضمّن في test:dr');

// --- خزنة مفاتيح الطوارئ (Emergency Key Vault): تشفير مستقل + نموذج مُرقّم + استعادة يدوية ---
const drVaultCrypto = fs.existsSync(path.join(drDir, 'key-vault-crypto.mjs')) ? read('tools/dr/key-vault-crypto.mjs') : '';
const drVaultRestore = fs.existsSync(path.join(drDir, 'vault-restore.mjs')) ? read('tools/dr/vault-restore.mjs') : '';
const drVaultEngine = fs.existsSync(path.join(root, 'engine/dr/recoveryVault/vault.ts')) ? read('engine/dr/recoveryVault/vault.ts') : '';
const drVaultInventory = fs.existsSync(path.join(root, 'engine/dr/recoveryVault/inventory.ts')) ? read('engine/dr/recoveryVault/inventory.ts') : '';
const drVaultTest = fs.existsSync(path.join(root, 'engine/tests/dr/dr.keyvault.test.ts')) ? read('engine/tests/dr/dr.keyvault.test.ts') : '';
const drVaultRecoveryReport = fs.existsSync(path.join(root, 'engine/dr/recoveryVault/recoveryReport.ts')) ? read('engine/dr/recoveryVault/recoveryReport.ts') : '';
const drLostKeysTest = fs.existsSync(path.join(root, 'engine/tests/dr/dr.lostkeys.test.ts')) ? read('engine/tests/dr/dr.lostkeys.test.ts') : '';
add('dr-keyvault-single-source', drVaultCrypto.includes('export function buildVaultRecords') && drVaultCrypto.includes('export function encryptKeyVault') && drVaultCrypto.includes('export function decryptKeyVault') && drVaultCrypto.includes('export function inspectVaultKey'), 'خزنة المفاتيح مصدر واحد (بناء/تشفير/فكّ/فحص المفتاح)');
add('dr-keyvault-independent-key', drVaultCrypto.includes('VAULT_KEY_ENV') && drVaultCrypto.includes('env[VAULT_KEY_ENV]') && !drVaultCrypto.includes('resolveMasterKey'), 'الخزنة تُفتح بمفتاح مستقل (DR_RECOVERY_VAULT_KEY) لا بالمفتاح الرئيسي');
add('dr-keyvault-aes-gcm', drVaultCrypto.includes('aes-256-gcm') && drVaultCrypto.includes('scrypt'), 'الخزنة مشفّرة AES-256-GCM بمفتاح مشتقّ scrypt');
add('dr-keyvault-magic-versioned', drCloudLib.includes('KEY_VAULT_PACKAGE_NAME') && drCloudLib.includes('GHARABI-KEY-VAULT-V1'), 'حزمة الخزنة موسومة بإصدار GHARABI-KEY-VAULT-V1');
add('dr-keyvault-manifest-names-only', drVaultEngine.includes('vaultContentHash') && drVaultCrypto.includes('fingerprint') && !/records[\s\S]{0,120}\bvalue\s*:/.test(drVaultCrypto.split('export function buildVaultRecords')[1] || ''), 'سجلات الخزنة تحمل أسماء/بصمات بلا أي قيمة سرّية');
add('dr-keyvault-inventory-schema', drVaultInventory.includes('RECOVERY_SECRET_INVENTORY') && drVaultInventory.includes('presentInventoryNames') && drVaultInventory.includes('criticalInventoryNames'), 'جرد الأسرار مبني على schema ثابت بلا اختراع أسماء');
add('dr-keyvault-no-unrelated-secret', drVaultInventory.includes('RECOVERY_SECRET_INVENTORY') && !/SOME_UNRELATED|Math\.random|Object\.keys\(process\.env\)/.test(drVaultInventory), 'الخزنة لا تشمل أي اسم خارج الجرد المعتمد');
add('dr-keyvault-versioned-head', drVaultEngine.includes('resolveCurrentKeyVault') && drVaultEngine.includes('buildKeyVaultHead') && drCloudLib.includes('KEY_VAULT_HEAD_NAME'), 'الخزنة بنموذج مُرقّم بمرجع اعتماد واحد (HEAD)');
add('dr-keyvault-no-change', drVaultEngine.includes("state: 'no_change'") && drVaultEngine.includes('vaultContentHash'), 'لا نسخة جديدة عند عدم تغيّر بصمة المحتوى');
add('dr-keyvault-commit-after-verify', drVaultEngine.includes('verify_hash_mismatch') && drVaultEngine.indexOf('verify_hash_mismatch') < drVaultEngine.indexOf('writeKeyVaultHead(head)'), 'لا اعتماد (HEAD) قبل التحقق الفعلي من الحزمة المرفوعة');
add('dr-keyvault-cleanup-pending', drVaultEngine.includes('cleanupPending') && drVaultEngine.includes('cleanupOldKeyVaultVersions'), 'فشل التنظيف = cleanupPending بلا إسقاط الاعتماد');
add('dr-keyvault-recover-readonly', drVaultEngine.includes('export async function recoverKeyVault') && drRoutes.includes('wroteToProduction: false') && drRoutes.includes('/api/dr/key-vault/drill'), 'استعادة الخزنة قراءة فقط (لا كتابة إنتاجية)');
add('dr-keyvault-restore-cli', drVaultRestore.includes('decryptKeyVault') && drVaultRestore.includes('0600') && !/console\.log\([^)]*values/.test(drVaultRestore), 'أداة فكّ يدوية (vault-restore) بلا طباعة أي قيمة سرّية وملف بإذن 0600');
add('dr-keyvault-routes', drRoutes.includes('/api/dr/key-vault/status') && drRoutes.includes('/api/dr/key-vault/sync') && drRoutes.includes('/api/dr/key-vault/verify') && drRoutes.includes('/api/dr/key-vault/drill'), 'مسارات الخزنة (حالة/مزامنة/فحص/اختبار) مسجّلة');
add('dr-keyvault-owner-only', /'\/api\/dr\/key-vault\/sync'[\s\S]{0,120}requireOwner/.test(drRoutes) && /'\/api\/dr\/key-vault\/backup'[\s\S]{0,120}requireOwner/.test(drRoutes), 'عمليات الكتابة على الخزنة للمالك فقط');
add('dr-keyvault-backup-autosync', drRoutes.includes('runKeyVaultSync') && /keyVault[\s\S]{0,40}(state|error)/.test(drRoutes), 'النسخة الاحتياطية تُزامن الخزنة تلقائياً وتُعلن النتيجة');
add('dr-keyvault-health-no-secret', /keyVault:\s*\{[\s\S]{0,600}inventoryCount/.test(drRoutes) && !/keyVault[\s\S]{0,600}(clientSecret|refreshToken|GOCSPX|AIzaSy)/.test(drRoutes), 'health يعرض كتلة الخزنة بلا أي قيمة سرّية');
add('dr-keyvault-env-documented', read('.env.example').includes('DR_RECOVERY_VAULT_KEY') && read('render.yaml').includes('DR_RECOVERY_VAULT_KEY'), 'DR_RECOVERY_VAULT_KEY موثّق في .env.example وrender.yaml (بلا قيمة)');
add('dr-keyvault-ui', cloudView.includes('خزنة مفاتيح الطوارئ') && cloudView.includes('apiService.syncDrKeyVault') && cloudView.includes('apiService.getDrKeyVaultStatus'), 'واجهة خزنة المفاتيح موجودة وتستدعي الخادم الفعلي');
add('dr-keyvault-ui-no-values', !/keyVault[^\n]{0,80}\.value\b/.test(cloudView), 'واجهة الخزنة لا تعرض أي قيمة سرّية');
add('dr-keyvault-tests', drVaultTest.includes('decrypt fails with wrong key') && drVaultTest.includes('tampered package detected') && drVaultTest.includes('cleanup retried and clears pending') && (pkg.scripts['test:dr'] || '').includes('test:dr-keyvault'), 'اختبار الخزنة يغطّي المفتاح الخاطئ/العبث/التنظيف ومضمّن في test:dr');
// منع الاحتواء الدائري: مفتاح فتح الخزنة لا يُدرج داخل الخزنة أبداً.
add('dr-keyvault-no-self-key', drVaultInventory.includes('VAULT_SELF_KEY_ENV') && /presentInventoryNames[\s\S]{0,220}VAULT_SELF_KEY_ENV/.test(drVaultInventory) && /buildVaultRecords[\s\S]{0,260}name !== VAULT_KEY_ENV/.test(drVaultCrypto), 'مفتاح فتح الخزنة مستبعد من الخزنة (لا احتواء دائري) في الجرد والمشفّر');
add('dr-keyvault-self-key-test', drVaultTest.includes('present excludes vault self key') && drVaultTest.includes('decrypted values exclude vault self key') && drVaultTest.includes('encryptKeyVault never stores vault key'), 'اختبار يثبت أن مفتاح الخزنة لا يدخل الخزنة');
add('dr-lostkeys-drill', drLostKeysTest.includes('vault opens with owner key alone') && drLostKeysTest.includes('database decrypts with vault-recovered key') && drLostKeysTest.includes('secrets decrypt with vault-recovered master key') && drLostKeysTest.includes('isolated restored app boots') && (pkg.scripts['test:dr'] || '').includes('test:dr-lostkeys'), 'اختبار فقدان كل المفاتيح: فتح الخزنة والاستعادة والإقلاع المعزول ومضمّن في test:dr');
add('dr-lostkeys-honest-classification', drLostKeysTest.includes('missing critical key => NOT_RECOVERABLE') && drVaultRecoveryReport.includes('NOT_RECOVERABLE') && drVaultRecoveryReport.includes('REQUIRES_OWNER_ACTION'), 'تصنيف الاستعادة صادق: قيمة حرجة مفقودة تُعلن NOT_RECOVERABLE لا تُخفى');
add('dr-lostkeys-no-production', !drLostKeysTest.includes('restore/production') && !drLostKeysTest.includes('runProductionRestore') && drLostKeysTest.includes('fakeDrive'), 'اختبار فقدان المفاتيح لا ينفّذ أي استعادة إنتاجية (معزول بالكامل)');
// علاقة المفاتيح الأربعة: استقلال كامل + استعادة master/db/token من الخزنة دون مفتاح الخزنة.
const drKeyRelTest = fs.existsSync(path.join(root, 'engine/tests/dr/dr.keyrelations.test.ts')) ? read('engine/tests/dr/dr.keyrelations.test.ts') : '';
add('dr-keyrelations-test', drKeyRelTest.includes('secrets NOT decryptable with vault key') && drKeyRelTest.includes('vault restores master key') && drKeyRelTest.includes('vault does NOT store its own key') && (pkg.scripts['test:dr'] || '').includes('test:dr-keyrelations'), 'اختبار علاقة المفاتيح الأربعة (استقلال + استعادة من الخزنة) مضمّن في test:dr');

const durableLease = read('engine/social/durableLease.ts');
const secHardeningTest = read('engine/tests/security.hardening.test.ts');
const leaseTest = read('engine/tests/durable.lease.test.ts');
const runWithSkip = read('scripts/run-with-skip.mjs');

add('sec02-webhook-rawbody-hmac',
  server.includes('hmacSignatureVerifier("x-gharabi-signature"') &&
  server.includes('typeof (req as any).rawBody !== "string"') &&
  !server.includes('createHmac("sha256",WEBHOOK_SECRET).update(raw)'),
  'SEC-02: توقيع /api/webhooks/:platform على الجسم الخام (req.rawBody) لا على إعادة التسلسل');
add('sec03-csp-production-only',
  server.includes('CONTENT_SECURITY_POLICY') &&
  server.includes('process.env.NODE_ENV === "production") res.setHeader("Content-Security-Policy"') &&
  server.includes("frame-ancestors 'none'"),
  'SEC-03: CSP في الإنتاج فقط مع frame-ancestors none (بلا كسر Vite dev)');
add('sec04-runtime-maps-bounded',
  server.includes('for (const [state, pending] of pendingOAuth) if (pending.expiresAt < now)') &&
  server.includes('for (const [platform, entry] of oauthStartPreflightCache)') &&
  server.includes('for (const [key, list] of youtubeOperationWindows)'),
  'SEC-04: القوائم غير المحدودة (OAuth/preflight/YouTube) مقيّدة في حلقة التنظيف');
add('sec04-revocation-lists-untouched',
  !/for \(const \[[^\]]+\] of userRevocationEpoch\)[^\n]*delete/.test(server),
  'SEC-04: لا حذف عددي لقوائم الإبطال الأمنية (revokedSessions/userRevocations)');
add('proc01-durable-lease-module',
  durableLease.includes('export function acquireLease') && durableLease.includes('export function releaseLease') && durableLease.includes('export function normalizeLease') && durableLease.includes('isLeaseStale'),
  'PROC-01: وحدة قفل الدوام موجودة (استحواذ/إفراج/استرداد متقادم)');
add('proc01-watcher-uses-durable-lease',
  server.includes('acquireLease(watcherLease') && server.includes('releaseLease(watcherLease, WATCHER_LEASE_OWNER)') && server.includes('lease: watcherLease') && server.includes('watcherLease = normalizeLease(raw.lease)'),
  'PROC-01: دورة مراقب YouTube تستحوذ/تفرج القفل الدائم وتسترجعه بعد restart');
add('proc01-dr-backup-durable-lease',
  drRoutes.includes('acquireLease(normalizeLease(control().driveLease)') && drRoutes.includes('releaseLease(normalizeLease(control().driveLease), BACKUP_LEASE_OWNER)'),
  'PROC-01: النسخة الكاملة تحمل قفل دوام فلا تتزامن نسختان عبر العمليات');
add('test-skip-is-explicit',
  runWithSkip.includes('code === 2') &&
  (pkg.scripts['test:db'] || '').includes('run-with-skip') &&
  (pkg.scripts['test:brain-memory'] || '').includes('run-with-skip') &&
  (pkg.scripts['test:dr-real-drill'] || '').includes('run-with-skip') &&
  read('engine/tests/database.persistence.test.ts').includes('process.exitCode = 2') &&
  read('engine/tests/dr/dr.real-drill.test.ts').includes('process.exit(2)'),
  'Phase 3: التخطّي يخرج 2 صراحةً والمشغّل يحوّله إلى 0 مع تحذير (لا اجتياز كاذب)');
add('security-hardening-test-present',
  secHardeningTest.includes('SEC-02') && secHardeningTest.includes('SEC-03') && secHardeningTest.includes('raw-body mismatch cannot bypass') && (pkg.scripts['test'] || '').includes('test:security-hardening'),
  'Phase 1: اختبار انحدار أمني حقيقي (webhook/CSP/maps/leak) مضمّن في npm test');
add('durable-lease-test-present',
  leaseTest.includes('live lease is not stolen') && leaseTest.includes('stale lease recovered') && (pkg.scripts['test'] || '').includes('test:durable-lease'),
  'Phase 2: اختبار قفل الدوام مضمّن في npm test');
add('env-vars-documented', (() => {
  const envExample = read('.env.example');
  const documented = new Set([...envExample.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
  const used = new Set([...server.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]));
  // أسماء تُحقنها المنصّة تلقائياً (Render/Netlify/Lambda) أو أدوات تشخيص، لا تُوثَّق.
  const platformInjected = new Set(['NODE_ENV', 'PORT', 'NETLIFY', 'RENDER', 'LAMBDA_TASK_ROOT', 'AWS_LAMBDA_FUNCTION_NAME', 'RENDER_GIT_COMMIT', 'RENDER_GIT_BRANCH', 'GIT_COMMIT', 'GIT_BRANCH']);
  const missing = [...used].filter((v) => !documented.has(v) && !platformInjected.has(v));
  return missing.length === 0;
})(), 'Phase 5: كل متغيّر بيئة يقرأه server.ts موثّق في .env.example (عدا المُحقَن من المنصّة)');

const safeTimer = read('engine/social/safeTimer.ts');
const safeTimerTest = read('engine/tests/safe.timer.test.ts');
add('phase6-timers-safe-wrapped',
  server.includes('safeTimerCallback(runSafeJobPreflight') &&
  server.includes('safeTimerCallback(cleanupRuntimeState') &&
  server.includes('safeTimerCallback(() => reconcileTikTokPublishes()') &&
  safeTimer.includes('export function safeTimerCallback'),
  'Phase 6: مؤقّتات الخادم ملفوفة بغلاف يلتقط الاستثناء/الرفض فلا تُسقط العملية');
add('phase6-reconcile-overlap-guard',
  server.includes('let tiktokReconcileRunning = false') && server.includes('if (tiktokReconcileRunning) return result;'),
  'Phase 6: مصالحة TikTok محميّة من التداخل (لا استعلامات متراكمة)');
add('phase6-shutdown-stops-timers',
  server.includes('watcherScheduler?.stop();') && server.includes('stopBrainRuntime();') && server.includes('drReconciliation?.stop?.();') && server.includes('drAutoBackup?.stop?.();'),
  'Phase 6: الإغلاق النظيف يوقف المؤقّتات قبل تفريغ الطابور');
add('phase6-safe-timer-test-present',
  safeTimerTest.includes('sync throw is swallowed') && safeTimerTest.includes('reconcile overlap guard') && (pkg.scripts['test'] || '').includes('test:safe-timer'),
  'Phase 6: اختبار غلاف المؤقّتات مضمّن في npm test');

// ---- Phase 7: frontend bundle splitting ----
add('phase7-heavy-views-lazy',
  app.includes('lazy(') && app.includes('<Suspense') &&
  app.includes("lazy(() => import('./components/agent/CentralBrainView')") &&
  app.includes("lazy(() => import('./components/system/CloudBackupView')") &&
  app.includes("lazy(() => import('./components/agent/YouTubeOperationsView')"),
  'Phase 7: اللوحات الثقيلة (العقل/الوكيل/النسخ السحابي) تُحمَّل عند الطلب عبر lazy+Suspense');
add('phase7-kept-views-static',
  app.includes("import { DashboardView } from './components/dashboard/DashboardView'") &&
  app.includes("import { LoginView } from './components/auth/LoginView'") &&
  app.includes("import { PlatformConnectionCenter } from './components/social/PlatformConnectionCenter'"),
  'Phase 7: اللوحات الأساسية/شاشة الدخول تبقى ثابتة (لا تأخير للتحميل الأول)');
add('phase7-initial-bundle-reduced', (() => {
  const assets = path.join(root, 'dist/assets');
  if (!fs.existsSync(assets)) return true; // يُفحص بعد البناء فقط
  const main = fs.readdirSync(assets).filter((f) => /^index-.*\.js$/.test(f));
  if (!main.length) return true;
  const size = fs.statSync(path.join(assets, main[0])).size;
  const chunks = fs.readdirSync(assets).filter((f) => f.endsWith('.js')).length;
  return size < 800 * 1024 && chunks >= 8;
})(), 'Phase 7: الحزمة الأولية < 800KB مع 8+ مقاطع (بعد البناء)');


// ===========================================================================
// Central Brain (A): الإدراك/قرار العقل/الحوكمة/التوطيد/الاستراتيجية/السياق — فحوص الفئة A.
// ===========================================================================
const teamBrainDecision = teamDir('brainDecision.ts');
const teamBrainEscalation = teamDir('brainEscalation.ts');
const teamDecisionTest = read('engine/tests/brain/brain.decision.test.ts');
const cogDir = (p) => read(path.join('engine/brain/cognition', p));
const cogTypes = cogDir('types.ts');
const cogContext = cogDir('contextEngine.ts');
const cogWorking = cogDir('workingMemory.ts');
const cogRecall = cogDir('memoryRecall.ts');
const cogGoals = cogDir('goalManager.ts');
const cogCouncil = cogDir('agentCouncil.ts');
const cogDisagreement = cogDir('disagreement.ts');
const cogNextAction = cogDir('nextAction.ts');
const cogPlanning = cogDir('planningEngine.ts');
const cogLearning = cogDir('outcomeLearning.ts');
const cogLoop = cogDir('cognitiveLoop.ts');
const cogRoutes = cogDir('routes.ts');
const cogUnitTest = read('engine/tests/brain/cognition.test.ts');
const cogIntegrationTest = read('engine/tests/brain/cognition.integration.test.ts');
const convState = read('engine/social/conversationState.ts');
const ctxIsolation = read('engine/social/contextIsolation.ts');
const iraqiPolicy = read('engine/social/iraqiCommercialPolicy.ts');
const govGuard = read('engine/agent/governanceGuard.ts');
const ctxTest = read('engine/tests/context.governance.test.ts');
const routesTest = read('engine/tests/social.routes.test.ts');
const lifecycleModule = read('engine/social/conversationLifecycle.ts');
const escalationModule = read('engine/social/escalation.ts');
const memorySepModule = read('engine/social/memorySeparation.ts');
const lifecycleTest = read('engine/tests/session.lifecycle.test.ts');
const watcherSrc = read('engine/social/youtubeWatcher.ts');
const runtimeSrc = read('engine/brain/runtime.ts');
const agentsSrc = read('engine/brain/team/agents.ts');
const authorityTest = read('engine/tests/brain/central.authority.test.ts');
const brainAuthorityTest = read('engine/tests/brain/central.brain.authority.test.ts');
add('agent-governance-guard-module',
  govGuard.includes('export function evaluateGovernance') && govGuard.includes('SENSITIVE_HUMAN_REQUIRED') &&
  govGuard.includes('UNVERIFIED_CLAIM') && govGuard.includes('APPROVAL_REQUIRED') && govGuard.includes('AGENT_GOVERNANCE_PRINCIPLES_AR'),
  'حوكمة الوكلاء: قرار موحّد (صلاحية + صدق + موافقة خارجية + حساسية بشرية) بلا تنفيذ صامت');
add('agent-governance-guard-wired', (() => {
  // كتلة استدعاء evaluateGovernance كاملة بين الأقواس المتوازنة (لا نمط تقريبي بالمسافة).
  const callBlock = (src) => {
    const start = src.indexOf('evaluateGovernance({');
    if (start === -1) return '';
    let depth = 0, began = false, end = -1;
    for (let i = start; i < src.length; i++) {
      const ch = src[i];
      if (ch === '(' || ch === '{') { depth++; began = true; }
      else if (ch === ')' || ch === '}') { depth--; if (began && depth === 0) { end = i; break; } }
    }
    return end === -1 ? '' : src.slice(start, end + 1);
  };
  const socialRoutes = read('engine/social/routes.ts');
  const brainDecision = read('engine/brain/team/brainDecision.ts');
  const socialBlock = callBlock(socialRoutes);
  const brainBlock = callBlock(brainDecision);
  return socialRoutes.includes("from '../agent/governanceGuard'") &&
    socialBlock.includes("permission: 'EXTERNAL_ACTION'") &&   // وسيط صريح داخل كتلة الاستدعاء نفسها
    socialBlock.includes('externalAction: true') &&
    brainBlock.includes('permission') && brainBlock.includes('externalAction');
})(), 'حوكمة الوكلاء مربوطة فعلياً بمسار الرد الحقيقي (/api/social/manager/comments/reply) بوسيط permission: EXTERNAL_ACTION صريح داخل كتلة الاستدعاء، وبسلطة القرار الواحدة (composeBrainDecision) — لا بالمسار التجاري المحذوف');
add('batch81-no-new-brain',
  !/buildSecondBrain|centralBrain2|secondDecisionEngine|secondLedger|secondMemoryStore/.test(server) &&
  /single decision authority|سلطة القرار الواحدة|سلطة التنفيذ الوحيدة/.test(watcherSrc),
  'Batch 8.1 لا يُدخل عقلاً/محرّك قرار/ذاكرة ثانية — يوحّد السلطة فقط');
add('batch81-tests',
  pkg.scripts['test:central-authority'] === 'tsx engine/tests/brain/central.authority.test.ts' &&
  pkg.scripts.test.includes('test:central-authority') &&
  authorityTest.includes('resolveCommentExecution') && authorityTest.includes('decisionHistoryToMemoryRecords') &&
  authorityTest.includes('buildRuntimeDecisionContext'),
  'اختبار Batch 8.1 يثبت الفجوات الثلاث (سلطة/قراءة سجل/استهلاك إدراك) ومضمّن في npm test');
add('brain-context-populates-audience-topics',
  server.includes('audienceTopics: audienceTopics.slice(0, 8)') && server.includes('marketNote'),
  'سياق العقل يُغذّي موضوعات الجمهور ودليل السوق الكانونيين إلى الإدراك');
add('brain-decision-central-brain-over-council',
  teamBrainDecision.includes('العقل المركزي') && teamBrainDecision.includes('مخرجات استشارية') &&
  teamTypes.includes('brainDecision: BrainDecision | null') &&
  teamOrchestrator.includes('brainDecision: null'),
  'العقل المركزي فوق الوكلاء الستة: يحمل قراره المحكوم داخل الجلسة (الوكلاء مستشارون)');
add('brain-decision-escalation-no-fake-notification',
  teamBrainEscalation.includes('notificationDelivered') && teamBrainEscalation.includes('duplicate_open_escalation') &&
  server.includes('brainEscalationNotifier') && server.includes('pushNotification('),
  'التصعيد لا يدّعي إشعاراً بلا مُبلِّغ ناجح، ويمنع التكرار (نفس بنية التنبيه القائمة)');
add('brain-decision-escalation-reuses-system',
  teamBrainEscalation.includes('createEscalationRecord') && teamBrainEscalation.includes("'../../social/escalation'") &&
  !/new Map|CREATE TABLE|secondEscalation/i.test(teamBrainEscalation),
  'جسر التصعيد يستخدم نظام التصعيد القائم (لا نظام ثانٍ)');
add('brain-decision-final-statuses',
  teamBrainDecision.includes("'ALLOWED_ACTION'") && teamBrainDecision.includes("'APPROVAL_REQUIRED'") &&
  teamBrainDecision.includes("'HUMAN_ESCALATION'") && teamBrainDecision.includes("'NO_ACTION'") &&
  teamBrainDecision.includes("'FAILED_SAFE'"),
  'الحالات النهائية خمس صريحة (إجراء مسموح/موافقة/تصعيد/لا إجراء/توقف آمن)');
add('brain-decision-governed',
  teamBrainDecision.includes('evaluateGovernance') && teamBrainDecision.includes('governance') &&
  teamBrainDecision.includes('claimVerified') && teamBrainDecision.includes('externalApproved'),
  'قرار العقل يمرّ عبر الحوكمة (صلاحية + ادعاء مثبت + موافقة خارجية)');
add('brain-decision-health-exposed',
  server.includes('brainDecisionHealthBlock') && server.includes('brainDecision: brainDecisionHealthBlock()') &&
  server.includes('executesExternalActions: false') && server.includes('hierarchy:'),
  'قرار العقل معلن في /api/health و/api/readiness بلا سرّ (مع الهرمية)');
add('brain-decision-integration-test',
  teamCouncilYoutubeTest.includes('central brain governed decision') &&
  teamCouncilYoutubeTest.includes('brainDecision') &&
  teamCouncilYoutubeTest.includes('HUMAN_ESCALATION'),
  'اختبار التكامل يثبت قرار العقل المحكوم فعلاً على حدث YouTube حقيقي');
add('brain-decision-module',
  fs.existsSync(path.join(root, 'engine/brain/team/brainDecision.ts')) &&
  fs.existsSync(path.join(root, 'engine/brain/team/brainEscalation.ts')) &&
  teamBrainDecision.includes('composeBrainDecision') && teamBrainDecision.includes('BRAIN_DECISION_STATUSES'),
  'وحدة قرار العقل المركزي المحكوم موجودة (تكويب + حالات نهائية محدّدة)');
add('brain-decision-no-external-execution',
  !/executeYouTubeReply|executeYouTubePublish|publishNow|sendMessage|comments\.insert/.test(teamBrainDecision + teamBrainEscalation) &&
  teamBrainDecision.includes('لا يُنفَّذ أي إجراء خارجي من العقل'),
  'قرار العقل لا ينفّذ أي إجراء خارجي (توجيه فقط عبر بوابات المشروع)');
add('brain-decision-no-secrets',
  !/api[_-]?key|client_secret|refresh_token|access_token|GEMINI_API_KEY/i.test(teamBrainDecision + teamBrainEscalation),
  'وحدة قرار العقل وجسر التصعيد لا يحملان أي سرّ');
add('brain-decision-sensitive-escalates',
  teamBrainDecision.includes('reasonRequiresHuman') && teamBrainDecision.includes('SENSITIVE_HUMAN_REQUIRED') &&
  teamBrainDecision.includes('HUMAN_ESCALATION'),
  'الإجراء الحسّاس (سعر غير موثّق/شكوى) يُصعّد بشرياً دائماً ولا يُنفَّذ آلياً');
add('brain-decision-tests',
  fs.existsSync(path.join(root, 'engine/tests/brain/brain.decision.test.ts')) &&
  pkg.scripts['test:brain-decision'] &&
  typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:brain-decision') &&
  teamDecisionTest.includes('ALLOWED_ACTION') && teamDecisionTest.includes('HUMAN_ESCALATION'),
  'اختبار قرار العقل (وحدة) مسجّل وضمن npm test');
add('brain-decision-unverified-is-safe',
  teamBrainDecision.includes("'UNVERIFIED_CLAIM'") && teamBrainDecision.includes("'FAILED_SAFE'") &&
  teamBrainDecision.includes('cookie') === false,
  'الادعاء غير المثبت (نقد فاشل/مزود غير موثق) => توقف آمن (لا إجراء)');
add('brain-decision-wired-and-audited',
  server.includes('composeBrainDecision(') && server.includes('escalateBrainDecision(') &&
  server.includes("audit('system', 'brain_decision'") &&
  /runTeamSessionNow\([\s\S]*brainDecision/.test(server),
  'قرار العقل يُكوَّن ويُسجَّل تدقيقياً عند كل جلسة (سلسلة EVENT→GOVERNANCE→OUTCOME)');
add('central-brain-authority-coverage',
  brainAuthorityTest.includes('CENTRAL_BRAIN_ID') && brainAuthorityTest.includes('ADVISOR_AGENT_IDS') &&
  brainAuthorityTest.includes('resolveCommentExecution') && brainAuthorityTest.includes('decisionHistoryToMemoryRecords'),
  'الاختبار الشامل يغطي: عقل واحد/ذاكرة واحدة/وكلاء استشاريون/سلطة تنفيذ واحدة/سجل قابل للقراءة');
add('central-brain-authority-tests-registered',
  pkg.scripts['test:central-brain-authority'] === 'tsx engine/tests/brain/central.brain.authority.test.ts' &&
  pkg.scripts.test.includes('test:central-brain-authority'),
  'اختبار سلطة العقل المركزي الشامل مسجّل ومضمّن في npm test');
add('cognition-consumed-not-advisory-only',
  agentsSrc.includes('escalationReason?: string | null') &&
  agentsSrc.includes('commercialContext?') &&
  agentsSrc.includes('source: \'decisionLedger (قراءة تاريخية)\''),
  'استهلاك الإدراك: السبب الحقيقي + السياق التجاري (استراتيجية/جمهور/سجل القرارات) يدخل قرار العقل كدليل');
add('cognition-context-answers-dimensions',
  cogContext.includes('buildCognitiveContext') && cogContext.includes('previousDiscussion') &&
  cogContext.includes('conversationState') && cogContext.includes('requiredNextDecision') &&
  cogContext.includes('relevantMarketingContext') && cogContext.includes('truth:'),
  'السياق يجيب WHAT/WHO/WHERE/WHEN/ما سبق/حالة المحادثة/الهدف/الأدلة/المجهول/الذاكرة/القرار المطلوب');
add('cognition-context-no-fabrication',
  cogContext.includes('availableEvidence') && cogContext.includes('unknown') &&
  cogContext.includes('unavailable') && cogContext.includes('لا يُخترع') === false &&
  cogContext.includes('مجهولاً أو غير متاح'),
  'السياق لا يخترع: المجهول/غير المتاح يُعلنان صراحةً');
add('cognition-context-wired-server',
  server.includes('buildRuntimeDecisionContext(') &&
  server.includes('escalationReason: meta.escalationReason ?? null') &&
  server.includes('commercialContext:'),
  'الخادم يبني السياق التجاري ويمرّر السبب الحقيقي إلى قرار العقل (لا عقل ثانٍ)');
add('cognition-council-reuses-team-session',
  cogCouncil.includes("from '../team/orchestrator'") && cogCouncil.includes('runTeamSession') &&
  !/function runTeamSession/.test(cogCouncil),
  'المجلس يعيد استخدام `runTeamSession` القائم (لا فريق ثانٍ)');
add('cognition-council-selective-routing',
  cogCouncil.includes('SCENARIO_AGENTS') && cogCouncil.includes('routeCouncilDecision') &&
  cogCouncil.includes('requiredAgentsForScenario') && cogCouncil.includes('detectCouncilScenario'),
  'المجلس يوجّه لوكلاء محدّدين حسب السيناريو (لا الستة دائماً)');
add('cognition-disagreement-no-consensus',
  cogDisagreement.includes('analyzeDisagreements') && cogDisagreement.includes('materialToSafety') &&
  cogDisagreement.includes('forcesHumanOrSafe') && cogDisagreement.includes('canResolveConflict') &&
  cogDisagreement.includes('لا يُختار فائز'),
  'الخلاف يُمثَّل بلا فرض إجماع؛ الجوهري يفرض تصعيداً بشرياً/توقفاً آمناً');
add('cognition-followup-engagement-single-source',
  watcherModule.includes('selectFollowUpCandidates') && watcherModule.includes('evaluateFollowUpEngagement') &&
  watcherModule.includes('FOLLOWUP_BASELINE_DELAY_MS') && watcherModule.includes('FOLLOWUP_MIN_DELTA') &&
  watcherModule.includes('followUpBaselineDelayMsFromEnv'),
  'منطق تفاعل المتابعة مصدر واحد في وحدة المراقب (اختيار + تقييم + مهلة قابلة للضبط)');
add('cognition-followup-no-fabrication',
  watcherModule.includes('likes === null && replies === null') &&
  watcherModule.includes('لا ادعاء تغيّر') && watcherModule.includes('followUpBaseline'),
  'التفاعل غير المتاح لا يُعلن تغيّراً؛ البصمة تُثبَّت قبل الحكم (لا اختراع قيمة)');
add('cognition-followup-no-financial',
  !/إيراد|ربح|ROI|هامش|تكلفة اكتساب|محاسبة/i.test(
    server.slice(server.indexOf('async function sweepFollowUpEngagement'), server.indexOf('async function sweepFollowUpEngagement') + 2200)) &&
  watcherModule.slice(watcherModule.indexOf('evaluateFollowUpEngagement')).includes('لا تغيّر ملاحَظ في تفاعل المتابعة بعد'),
  'تفاعل المتابعة لا يحمل أي رقم مالي مُخترع (ملاحظة سلوكية فقط)');
add('cognition-followup-tests',
  watcherTest.includes('تفاعل المتابعة') && watcherTest.includes('selectFollowUpCandidates') &&
  read('engine/tests/youtube.connector.test.ts').includes('تفاعل المتابعة يُغلق حلقة التعلّم') &&
  cogIntegrationTest.includes('learning-loop') && cogIntegrationTest.includes('learningLoop'),
  'اختبارات تفاعل المتابعة (وحدة + تكامل) ومسار حلقة التعلّم مسجّلة');
add('cognition-followup-wired-server',
  server.includes('sweepFollowUpEngagement') && server.includes('selectFollowUpCandidates(watcherState.processed') &&
  server.includes('evaluateFollowUpEngagement(entry') && server.includes("kind: 'engagement_changed'") &&
  server.includes('recordReadOutcome({') && server.includes('yt-followup:'),
  'رصد المتابعة موصول داخل دورة المراقبة ويُغلق الحلقة في ذاكرة العقل (بلا مسار ثانٍ)');
add('cognition-goals-full-plan',
  cogGoals.includes('buildGoalPlan') && cogGoals.includes('currentGoal') && cogGoals.includes('subGoals') &&
  cogGoals.includes('nextBestStep'),
  'خطة الأهداف: الهدف الأعلى ← الحالي ← الفرعية ← الخطوة التالية');
add('cognition-goals-social-only',
  cogGoals.includes('SOCIAL_GOAL_LABELS_AR') && cogGoals.includes('PRIMARY_BUSINESS_OBJECTIVE') &&
  cogGoals.includes('OUT_OF_SCOPE_FINANCIAL_TERMS') && cogGoals.includes('goalPlanViolatesScope'),
  'الأهداف اجتماعية/تسويقية فقط مع حرس يمنع المصطلحات المالية خارج النطاق');
add('cognition-health-exposed',
  server.includes('cognitionHealthBlock') && server.includes('cognition: cognitionHealthBlock()') &&
  server.includes('storesPrivateChainOfThought: false') && server.includes('cognitiveLoop:'),
  'الطبقة الإدراكية معلنة في /api/health و/api/readiness بلا سرّ');
add('cognition-learning-sample-real-count',
  server.includes('function watcherObservationCount(') &&
  !/recordReadOutcome\(\{[^}]*sampleSize: 3\b/.test(server) &&
  server.includes("watcherObservationCount('engagement_changed')") &&
  server.includes("watcherObservationCount('response_received')") &&
  server.includes("watcherObservationCount('no_change')"),
  'عيّنة حلقة التعلّم تُشتق من العدد الحقيقي المرصود (لا قيمة ثابتة sampleSize: 3)');
add('cognition-learning-sample-observation-test',
  fs.existsSync(path.join(root, 'engine/tests/youtube.observation.count.test.ts')) &&
  read('engine/tests/youtube.observation.count.test.ts').includes('العيّنة الحقيقية = 3 >= 3') &&
  read('engine/tests/youtube.observation.count.test.ts').includes('لا درس دائم (العيّنة الحقيقية = 1 < 3)'),
  'اختبار تكاملي يثبت أن العيّنة الحقيقية تتحكم بالترقية (1/2 لا، 3 نعم)');
add('process-error-safety-handlers',
  server.includes('process.on("uncaughtException"') && server.includes('process.on("unhandledRejection"') &&
  server.includes('redactSecretsFromText(String((err as Error)?.message || err))'),
  'معالجات uncaughtException/unhandledRejection لا تُسقط الخادم وتُسجّل رسالة مُنقّاة بلا سرّ');
add('express-global-error-middleware',
  server.includes('classifyHttpError(err)') && server.includes('res.status(info.status).json({') &&
  server.includes('safeErrorMessage(err, shouldExposeErrorMessage(process.env))') &&
  !/res\.[a-z]+\([^)]*err\.stack/.test(server),
  'وسيط أخطاء عام رباعي يعيد JSON صريحاً بلا stack ولا سرّ (4xx للأخطاء العميلية)');
add('error-safety-single-source',
  read('engine/runtime/errorSafety.ts').includes('export function classifyHttpError') &&
  read('engine/runtime/errorSafety.ts').includes('export function redactSecretsFromText') &&
  read('engine/runtime/errorSafety.ts').includes('export function safeErrorMessage'),
  'منطق سلامة الأخطاء مصدر واحد قابل للاختبار (تصنيف + تنقية + رسالة آمنة)');
add('error-safety-tests',
  fs.existsSync(path.join(root, 'engine/tests/error.safety.test.ts')) &&
  read('engine/tests/error.safety.test.ts').includes('INVALID_JSON') &&
  read('engine/tests/error.safety.test.ts').includes('PAYLOAD_TOO_LARGE'),
  'اختبار وحدة + خادم حقيقي لجسم مشوّه/كبير وعدم سقوط الخادم');
add('rate-window-bounded',
  server.includes('enforceRateWindowCap(authAttemptWindow, now)') &&
  server.includes('enforceRateWindowCap(challengeWindow, now)') &&
  !server.includes('function enforceRateWindowCap(') &&
  read('engine/runtime/rateWindow.ts').includes('export function enforceRateWindowCap'),
  'خرائط محاولات الدخول/رموز التحقق مقيّدة بسقف دفاعي (مثل سقف الجلسات) بمصدر واحد');
add('rate-window-tests',
  fs.existsSync(path.join(root, 'engine/tests/rate.window.test.ts')) &&
  read('engine/tests/rate.window.test.ts').includes('فوق السقف: الأقدم أُزيل') &&
  read('engine/tests/rate.window.test.ts').includes('يُسمح 12 محاولة ثم يُحجب'),
  'اختبار سقف النوافذ ودلالات تحديد المعدّل');
// /api/auth/verify-challenge كان بلا حدّ محاولات (رمز 6 أرقام): يُثبت الآن أنه يحدّ
// التخمين عبر allowAuthAttempt قبل مقارنة الرمز (فلا يمنح الردّ أي إشارة عن صحّته).
add('otp-verify-rate-limited',
  /app\.post\("\/api\/auth\/verify-challenge"[\s\S]{0,600}?allowAuthAttempt\(`verify-challenge:/.test(server) &&
  read('engine/tests/security.hardening.test.ts').includes('OTP verify rate limit enforced'),
  'التحقق من رمز OTP محدود المحاولات (منع تخمين الرمز) مع اختبار انحدار');
add('ai-verification-persisted',
  server.includes('aiLiveVerification: aiLiveVerificationState.snapshot()') &&
  server.includes('aiLiveVerificationState.restore(control.aiLiveVerification)') &&
  server.includes('hydrateAiLiveVerificationFromDurable()'),
  'نتيجة التحقق الحي من Gemini تُحفظ في مفتاح التحكّم وتُسترجع بعد restart (بلا إعادة استهلاك حصة)');
add('ai-verification-persist-tests',
  fs.existsSync(path.join(root, 'engine/tests/ai.verification.persistence.test.ts')) &&
  read('engine/tests/ai.verification.persistence.test.ts').includes('verifiedLive = true بعد إعادة التشغيل') &&
  read('engine/tests/ai.verification.persistence.test.ts').includes('الحفظ يُستدعى في كل فرع نهائي'),
  'اختبار يثبت استرجاع نتيجة التحقق بعد إعادة التشغيل وبلا تسريب مفتاح');
add('dr-master-key-fallback-documented',
  read('tools/dr/secret-crypto.mjs').includes('DRIVE_TOKEN_ENCRYPTION_KEY') &&
  read('tools/dr/secret-crypto.mjs').includes('سلسلة المفتاح الرئيسي'),
  'سلسلة مفتاح الاستعادة الرئيسي موثّقة كاملة (3 بدائل) مطابقة لـresolveMasterKey');
add('env-names-documented',
  read('.env.example').includes('X_OAUTH_CLIENT_ID=') &&
  read('.env.example').includes('SNAPCHAT_OAUTH_CLIENT_ID=') &&
  read('.env.example').includes('THREADS_OAUTH_CLIENT_ID=') &&
  read('.env.example').includes('GOOGLE_OAUTH_CLIENT_ID=') &&
  read('.env.example').includes('FACEBOOK_DIALOG_BASE='),
  'كل اعتماد OAuth يقرأه الكود موثّق في .env.example (X/Snapchat/Threads/Google/Facebook)');
add('env-vite-no-secret',
  read('.env.example').includes('VITE_GOOGLE_CLIENT_ID=') &&
  !/VITE_[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|_KEY)/.test(read('.env.example')),
  'VITE_GOOGLE_CLIENT_ID موثّق كمعرّف عام للواجهة فقط، ولا سرّ عبر أي متغيّر VITE_');
add('env-names-reconciliation-tests',
  fs.existsSync(path.join(root, 'engine/tests/env.names.reconciliation.test.ts')) &&
  read('engine/tests/env.names.reconciliation.test.ts').includes('لا اسم اعتماد غير موثّق') &&
  read('engine/tests/env.names.reconciliation.test.ts').includes('لا VITE_ سرّي'),
  'اختبار يمنع انحراف أسماء متغيّرات البيئة وتسريب سرّ عبر VITE_');
add('webhook-ingestion-single-source',
  (server.match(/async function ingestWebhookComments\(/g) || []).length === 1 &&
  server.includes('ingestSource: `${platform}_webhook`') &&
  /ingestWebhookComments[\s\S]{0,4000}?await persistStateDurable\(\)/.test(server),
  'استيعاب أحداث webhook من مصدر واحد (منع التكرار + الحفظ قبل الإقرار) في كل المسارات');
add('webhook-ingestion-tests',
  fs.existsSync(path.join(root, 'engine/tests/webhook.ingestion.test.ts')) &&
  read('engine/tests/webhook.ingestion.test.ts').includes('المسارات الأربعة تستدعي المصدر الواحد') &&
  read('engine/tests/webhook.ingestion.test.ts').includes('لا حلقة استيعاب مكرّرة'),
  'اختبار حارس يمنع عودة تكرار منطق استيعاب webhook في المسارات');
add('brain-scope-removal-documented',
  read('AGENTS.md').includes('إزالة وحدات المبيعات/النمو/التجاري/الرقمي') &&
  !fs.existsSync(path.join(root, 'engine/brain/sales')) &&
  !fs.existsSync(path.join(root, 'engine/brain/growth')) &&
  !fs.existsSync(path.join(root, 'engine/brain/commercial')) &&
  !fs.existsSync(path.join(root, 'engine/brain/digital')),
  'حذف وحدات المبيعات/النمو/التجاري/الرقمي موثّق، ولا تشير الوثائق إليها كوحدات قائمة');
add('brain-scope-removal-docs-purged',
  // الوثائق التصميمية للمبيعات/النمو/الرقمي/الموحّد حُذفت فعلياً (كانت تشرح وحدات غير
  // موجودة فتضلّل المطوّر). هذا الحارس يمنع عودة أي وثيقة تشير إلى تلك الوحدات.
  !fs.existsSync(path.join(root, 'docs/دفعة-1-العقل-التجاري.md')) &&
  !fs.existsSync(path.join(root, 'docs/دفعة-2-عقل-التسويق-والطلب.md')) &&
  !fs.existsSync(path.join(root, 'docs/دفعة-3-العقل-الرقمي.md')) &&
  !fs.existsSync(path.join(root, 'docs/دفعة-4-العقل-الموحّد.md')) &&
  !fs.existsSync(path.join(root, 'docs/تحضير-العقل-التجاري.md')),
  'الوثائق التصميمية لوحدات المبيعات/النمو المحذوفة أُزيلت (لا مرجع مضلّل قائم)');
add('brain-removed-modules-no-stale-refs',
  // لا يبقى أي مرجع لوحدات محذوفة في أي ملف نصي (عدا هذا الحارس نفسه وAGENTS.md الذي
  // يوثّق الإزالة صراحةً كسجل). يمنع إعادة إدخال مرجع مضلّل إلى وحدات غير موجودة.
  (() => {
    const stale = 'engine/brain/';
    const removed = ['sales', 'digital', 'growth', 'commercial'];
    const skip = new Set(['final-audit.mjs']);
    const exts = new Set(['.ts', '.tsx', '.mjs', '.js', '.md', '.json']);
    const bad = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) { walk(full); continue; }
        if (!exts.has(path.extname(name))) continue;
        const rel = path.relative(root, full);
        if (skip.has(rel)) continue;
        const text = fs.readFileSync(full, 'utf8');
        for (const mod of removed) {
          if (text.includes(stale + mod)) { bad.push(`${rel}:${mod}`); break; }
        }
      }
    };
    walk(root);
    return bad.length === 0;
  })(),
  'لا مراجع مضلّلة لوحدات brain المحذوفة (sales/digital/growth/commercial) في أي ملف نصي');
add('cognition-health-no-customer-text',
  (() => {
    const start = server.indexOf('function cognitionHealthBlock');
    const end = server.indexOf('async function runTeamSessionNow', start);
    if (start < 0 || end <= start) return false;
    // نُزيل التعليقات قبل الفحص كي لا يطابق الفحص شرحاً يذكر أسماء الحقول المحذوفة.
    const block = server.slice(start, end).replace(/\/\/[^\n]*/g, '');
    return !/lastObjective|lastGoal|lastNextAction|currentObjective|currentGoal/.test(block)
      && block.includes('lastDecisionState');
  })(),
  'كتلة الإدراك العامة لا تُعلن حقولاً نصّية حرة قد تحمل نص تعليق/هدف مشتق (كانت تُسرّب)؛ الحالات الرمزية فقط');
add('cognition-detail-owner-only',
  cogRoutes.includes("'/api/agent/brain/cognition/reports'") && cogRoutes.includes('deps.requireOwner') &&
  cogRoutes.includes('currentObjective') && cogRoutes.includes('nextAction'),
  'التفاصيل النصّية للإدراك تبقى للمالك فقط عبر مسار محمي بالتصريح (لا حذف من النظام)');
add('cognition-learning-evidence-gated',
  cogLearning.includes('deriveLesson') && cogLearning.includes('durable') &&
  cogLearning.includes('LESSON_DURABLE_MIN_SAMPLE') && cogLearning.includes('buildLearningOutcome'),
  'التعلّم لا يُرقّى لمعرفة دائمة بلا مصدر وعيّنة كافية');
add('cognition-learning-loop-health',
  server.includes('buildCognitionLearningLoop') && server.includes('learningLoop: () => buildCognitionLearningLoop()') &&
  server.includes('learningBridge:') && server.includes('FOLLOW-UP') &&
  server.includes('memory: stageCount(') && server.includes('lessonRecords'),
  'حلقة التعلّم معلنة في health و/api/agent/brain/cognition/learning-loop بأرقام من سجلات فعلية');
add('cognition-learning-loop-route',
  cogRoutes.includes("'/api/agent/brain/cognition/learning-loop'") && cogRoutes.includes('deps.requireOwner') &&
  cogRoutes.includes('deps.learningLoop') && cogRoutes.includes('LearningLoopView'),
  'مسار حلقة التعلّم للمالك فقط، ويُعلن عدم التوفر صراحةً عند غياب الربط (لا اختراع)');
add('cognition-learning-no-financial-and-no-selfmod',
  cogLearning.includes('learningOutcomeViolatesScope') && cogLearning.includes('learningIsNonSelfModifying') &&
  cogLearning.includes('selfModifying: false') && cogLearning.includes('لا تعلّم معزّز'),
  'التعلّم لا يحسب إيراد/ربح/ROI ولا يعدّل قواعد النظام (لا تعلّم معزّز)');
add('cognition-learning-no-promotion-without-evidence',
  cogLearning.includes('if (!lesson.durable || !lesson.source) return null') &&
  cogLearning.includes("'platform_data'") && cogLearning.includes("'derived'"),
  'الدرس غير الدائم لا يُرقّى (null)، والأصل صريح (بيانات منصة/استنتاج)');
add('cognition-learning-to-memory-bridge',
  cogLearning.includes('learningToMemoryEntries') && cogLearning.includes('lessonToMemoryEntry') &&
  cogLearning.includes("from '../memory/longTerm'") && cogLearning.includes('makeMemoryEntry') &&
  !/new Map|CREATE TABLE|secondMemory/i.test(cogLearning),
  'التعلّم يُجسر إلى **نفس** الذاكرة طويلة المدى القائمة (لا مخزن ثانٍ)');
add('cognition-loop-closes-to-future-decision',
  cogUnitTest.includes('إغلاق حلقة التعلّم') &&
  cogUnitTest.includes('القرار المستقبلي استدعى الدرس من الذاكرة') &&
  cogUnitTest.includes('الدرس حاضر في سياق القرار المستقبلي') &&
  cogUnitTest.includes('learningOutcomeViolatesScope') && cogUnitTest.includes('relevantMemoryIds'),
  'إثبات أن حلقة التعلّم تُغلق فعلاً: درس من تفاعل المتابعة يُستدعى في دورة إدراكية لاحقة (MEMORY ⇒ FUTURE DECISION) بلا قفز بلا دليل');
add('cognition-loop-composes-existing-layers',
  cogLoop.includes('buildCognitiveContext') && cogLoop.includes('recallMemories') &&
  cogLoop.includes('buildGoalPlan') && cogLoop.includes('routeCouncilDecision') &&
  cogLoop.includes('analyzeDisagreements') && cogLoop.includes('proposeNextAction') &&
  cogLoop.includes('buildPlan') && cogLoop.includes('buildLearningOutcome'),
  'الدورة الإدراكية تجميع حتمي فوق الطبقات القائمة (لا إعادة بناء)');
add('cognition-loop-no-external-execution',
  cogLoop.includes('externalAction: false') && cogLoop.includes('externalActionTaken: false') &&
  !/executeYouTubeReply|executeYouTubePublish|publishNow|sendMessage|comments\.insert|fetch\(/.test(cogLoop + cogNextAction + cogPlanning),
  'الدورة الإدراكية لا تنفّذ أي إجراء خارجي ولا شبكة');
add('cognition-loop-observability',
  cogLoop.includes('observability') && cogLoop.includes('cognitiveState') &&
  cogLoop.includes('agentsConsulted') && cogLoop.includes('memoryUsed') &&
  cogLoop.includes('lastObservedOutcome'),
  'الدورة تُنتج كتلة مراقبة (حالة/هدف/وكلاء/ذاكرة/قرار/تصعيد/تعلّم)');
add('cognition-loop-phases-order',
  cogTypes.includes("'PERCEIVE'") && cogTypes.includes("'UNDERSTAND'") && cogTypes.includes("'REMEMBER'") &&
  cogTypes.includes("'REASON'") && cogTypes.includes("'CONSULT'") && cogTypes.includes("'PLAN'") &&
  cogTypes.includes("'CRITIQUE'") && cogTypes.includes("'DECIDE'") && cogTypes.includes("'ACT'") &&
  cogTypes.includes("'OBSERVE'") && cogTypes.includes("'LEARN'") && cogTypes.includes('COGNITIVE_PHASES'),
  'الدورة الإدراكية تشمل المراحل الإحدى عشرة بالترتيب المعلن');
add('cognition-memory-recall-relevance',
  cogRecall.includes('recallMemories') && cogRecall.includes('scoreMemoryRecord') &&
  cogRecall.includes('relevance') && cogRecall.includes('reasons') && cogRecall.includes('maxResults'),
  'الاستدعاء بالصلة مع حدّ أعلى (لا تحميل كل الذاكرة على كل قرار)');
add('cognition-memory-recall-reuses-store',
  cogRecall.includes("from '../memory/store'") && cogRecall.includes('BrainMemoryStoreState') &&
  !/new Map|CREATE TABLE|secondMemory/i.test(cogRecall),
  'الاستدعاء يقرأ من **نفس** مخزن Brain Memory القائم (لا ذاكرة ثانية)');
add('cognition-memory-recall-stale-excluded',
  cogRecall.includes('record.stale') && cogRecall.includes('متقادم') && cogRecall.includes('stale: true'),
  'السجل المتقادم لا يُقدَّم للقرار (يُعلن السبب)');
add('cognition-module-structure',
  ['types.ts', 'contextEngine.ts', 'workingMemory.ts', 'memoryRecall.ts', 'goalManager.ts',
    'agentCouncil.ts', 'disagreement.ts', 'nextAction.ts', 'planningEngine.ts', 'planTypes.ts',
    'outcomeLearning.ts', 'cognitiveLoop.ts', 'routes.ts']
    .every((f) => fs.existsSync(path.join(root, 'engine/brain/cognition', f))),
  'وحدة الإدراك موجودة بمكوّناتها (سياق/ذاكرة عاملة/استدعاء/أهداف/مجلس/خلاف/إجراء/تخطيط/تعلّم/دورة/مسارات)');
add('cognition-next-action-governed',
  cogNextAction.includes('proposeNextAction') && cogNextAction.includes('requiredPermission') &&
  cogNextAction.includes('governed: true') && cogNextAction.includes("'escalate'") &&
  cogNextAction.includes("'do_nothing'"),
  'الإجراء التالي اقتراح محكوم (صلاحية/خطر) بترتيب سلامة — لا تنفيذ');
add('cognition-no-erp-crm-sales',
  // الطبقة الإدراكية لا تُنشئ أي نظام مالي/مخزون: لا حساب ربح/إيراد/ROI ولا جدول مخزون.
  !/calculateProfit|computeRevenue|revenue\s*=|profit\s*=|roi\s*=|inventoryTable|createInventory|erpSystem|crmSystem/i.test(
    cogContext + cogWorking + cogRecall + cogGoals + cogCouncil + cogDisagreement + cogNextAction + cogPlanning + cogLearning + cogLoop) &&
  cogGoals.includes('OUT_OF_SCOPE_FINANCIAL_TERMS') && cogGoals.includes('goalPlanViolatesScope') &&
  cogLearning.includes('learningOutcomeViolatesScope'),
  'الطبقة الإدراكية لا تُنشئ ERP/CRM/مخزون/محاسبة ولا تحسب إيراد/ربح/ROI (وحرس النطاق قائم)');
add('cognition-no-private-chain-of-thought',
  cogTypes.includes('storesPrivateChainOfThought: false') && cogTypes.includes('ReasoningState') &&
  cogLoop.includes('storesPrivateChainOfThought: false') && cogTypes.includes('لا تفكير داخلي'),
  'حالة التفكير المنظّمة بيانات قابلة للتتبع فقط — لا تُحفظ سلسلة تفكير خاصة');
add('cognition-no-secrets',
  !/api[_-]?key|client_secret|refresh_token|access_token|GEMINI_API_KEY|PRIVATE KEY/i.test(
    cogContext + cogWorking + cogRecall + cogGoals + cogCouncil + cogDisagreement + cogNextAction + cogPlanning + cogLearning + cogLoop + cogRoutes),
  'وحدة الإدراك لا تحمل أي سرّ');
add('cognition-outcome-feedback-no-financial',
  !/إيراد|ربح|ROI|هامش|تكلفة اكتساب|قيمة عمر|محاسبة|مخزون/i.test(
    server.slice(server.indexOf('function recordReadOutcome'), server.indexOf('function recordReadOutcome') + 1400)),
  'حلقة النتيجة لا تحمل أي رقم مالي مُخترع (اجتماعية فقط)');
add('cognition-outcome-feedback-wired-server',
  server.includes('recordReadOutcome') && server.includes('makeOutcomeObservation') &&
  server.includes('learningToMemoryEntries') && server.includes('persistBrainMemory(records)') &&
  server.includes('yt-reply-sent:') && server.includes('yt-reply-failed:'),
  'حلقة النتيجة (رد مُسلَّم/فشل) تُغلق فعلاً في الخادم وتُكتب في ذاكرة العقل');
add('cognition-planning-governed-steps',
  cogPlanning.includes('buildPlan') && cogPlanning.includes('requiresApproval') &&
  cogPlanning.includes('external: true') && cogPlanning.includes('planRespectsGovernance'),
  'الخطة خطوات محكومة (مسموحة/تحتاج اعتماداً) وحرس يمنع خطوة خارجية مسموحة بلا سبب');
add('cognition-routes-read-only',
  cogRoutes.includes("'/api/agent/brain/cognition'") && cogRoutes.includes("'/api/agent/brain/cognition/reports'") &&
  cogRoutes.includes('deps.requireOwner') && !/app\.post\(|app\.put\(|app\.delete\(/.test(cogRoutes),
  'مسارات الإدراك قراءة فقط (GET)، وللمالك — بلا أي مسار كتابة');
add('cognition-state-persists',
  server.includes('STORAGE_KEY_WORKING_MEMORY') && server.includes('loadCognitionSync') &&
  server.includes('persistCognition') && server.includes('normalizeWorkingMemory') &&
  server.includes('cognitiveReports'),
  'الذاكرة العاملة + تقارير الدورات تُحفظ وتُسترجع عبر محوّل الحالة (تصمد بعد restart)');
add('cognition-tests-cover-critical',
  cogUnitTest.includes('الدورة تشمل 11 مرحلة') && cogUnitTest.includes('السعر غير الموثّق') &&
  cogUnitTest.includes('الخلاف الجوهري') && cogUnitTest.includes('رفض نتيجة مالية') &&
  cogIntegrationTest.includes('دورة إدراكية كاملة') && cogIntegrationTest.includes('منع التكرار'),
  'اختبارات الإدراك تغطي المراحل/التصعيد/الخلاف/المنع المالي/التكامل ومنع التكرار');
add('cognition-tests-registered',
  fs.existsSync(path.join(root, 'engine/tests/brain/cognition.test.ts')) &&
  fs.existsSync(path.join(root, 'engine/tests/brain/cognition.integration.test.ts')) &&
  pkg.scripts['test:cognition'] && pkg.scripts['test:cognition-integration'] &&
  typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:cognition') &&
  pkg.scripts.test.includes('test:cognition-integration'),
  'اختبارات الإدراك (وحدة + خادم حقيقي) مسجّلة وضمن npm test');
add('cognition-triggered-by-real-event',
  /runTeamSessionNow\([\s\S]{0,2000}runCognitiveCycleNow\(/.test(server) &&
  server.includes('runCognitiveCycleNow({') && server.includes("eventIdentity: `comment:${String(c.commentId)}`"),
  'الدورة الإدراكية تُشغَّل من حدث YouTube حقيقي داخل دورة المراقبة');
add('cognition-ui-panel',
  fs.existsSync(path.join(root, 'src/components/agent/CentralBrainCognitionPanel.tsx')) &&
  read('src/components/agent/CentralBrainCognitionPanel.tsx').includes('getCognitionLearningLoop') &&
  read('src/components/agent/CentralBrainCognitionPanel.tsx').includes('CentralBrainCognitionPanel') &&
  read('src/components/agent/CentralBrainView.tsx').includes('CentralBrainCognitionPanel'),
  'لوحة الإدراك (Cognition/Memory/Goals/Plans/Agents/Critic/Decisions/Outcomes/Learning) مدمجة في واجهة العقل المركزي');
add('cognition-ui-read-only-no-secrets',
  !/method:\s*'POST'|method:\s*'PUT'|method:\s*'DELETE'/.test(read('src/components/agent/CentralBrainCognitionPanel.tsx')) &&
  !/api[_-]?key|client_secret|refresh_token|access_token/i.test(read('src/components/agent/CentralBrainCognitionPanel.tsx')),
  'لوحة الإدراك قراءة فقط (GET) وبلا أي سرّ');
add('cognition-wired-server',
  server.includes('registerCognitionRoutes(app,') && server.includes('buildCognitiveCycle') &&
  server.includes('runCognitiveCycleNow') && server.includes('workingMemoryState'),
  'الطبقة الإدراكية موصولة في server.ts بحقن التبعيات');
add('cognition-working-memory-no-auto-promotion',
  cogWorking.includes('لا ترقية تلقائية') && cogWorking.includes('لا تُرقّى تلقائياً إلى الذاكرة طويلة المدى') &&
  !/remember\(|upsertMemoryRecord|toMemoryRecord/.test(cogWorking),
  'الذاكرة العاملة لا تُرقّى تلقائياً إلى الذاكرة طويلة المدى (ممنوع بالتصميم)');
add('cognition-working-memory-ttl',
  cogWorking.includes('WORKING_MEMORY_TTL_MS') && cogWorking.includes('isWorkingMemoryStale') &&
  cogWorking.includes('pruneWorkingMemory') && cogWorking.includes('touchWorkingMemory'),
  'الذاكرة العاملة قصيرة المدى بعمر TTL صريح وتشذيب — لا نمو بلا حد');
add('context-conversation-state-module',
  convState.includes('export function conversationKey') && convState.includes('export function shortTermWindow') &&
  convState.includes('CONVERSATION_MAX_MESSAGES') && convState.includes('export function priorBusinessReplies') &&
  convState.includes('export function isConversationStale'),
  'وحدة حالة المحادثة: معرّف صريح + نافذة قصيرة المدى محدودة + طزاجة (منطق صافٍ)');
add('context-conversations-durable',
  server.includes('socialConversations: ((workspace as any).socialConversations || []).slice(0, 500)') &&
  server.includes('socialConversations: Array.isArray(raw.workspace.socialConversations)') &&
  server.includes('"socialConversations"'),
  'نوافذ المحادثة تُحفظ وتُسترجع عبر محوّل الحالة (تصمد بعد restart)');
add('context-governance-tests',
  pkg.scripts['test:context-governance'] === 'tsx engine/tests/context.governance.test.ts' &&
  pkg.scripts.test.includes('test:context-governance') &&
  ctxTest.includes('isolateContext') && ctxTest.includes('checkCommercialPolicy') && ctxTest.includes('evaluateGovernance'),
  'اختبار وحدة شامل للسياق/العزل/السياسة/الحوكمة مضمّن في npm test');
add('context-isolation-integration-test',
  routesTest.includes("isolated === true") && routesTest.includes("priorRepliesUsed === 0") &&
  routesTest.includes('commercialPolicy'),
  'اختبار تكامل: عزل فعلي بين خيطين + سياسة التواصل مطبَّقة على الخادم الحقيقي');
add('context-isolation-module',
  ctxIsolation.includes('export function isolateContext') && ctxIsolation.includes('priorReplies: []') &&
  ctxIsolation.includes('conversation_mismatch') && ctxIsolation.includes('platform_mismatch') && ctxIsolation.includes('subject_mismatch'),
  'وحدة عزل السياق: ترفض أي تسرّب بين محادثة/منصة/خيط وتُفرغ السياق عند عدم التطابق');
add('context-isolation-wired-reply',
  server.includes('socialConversations') && socialRoutes.includes('isolateContext') && socialRoutes.includes('conversationScopeFor') &&
  socialRoutes.includes('shortTermWindow'),
  'عزل السياق مربوط بمسار الرد الفعلي (لا كود معزول): نوافذ محادثة معزولة بالمحادثة/الخيط');
add('conversation-lifecycle-module',
  lifecycleModule.includes('nextConversationState') && lifecycleModule.includes('pendingEscalation') &&
  /target === 'RESOLVED' && input.pendingEscalation/.test(lifecycleModule) &&
  lifecycleModule.includes('CONVERSATION_LIFECYCLE_STATES'),
  'دورة حياة المحادثة: آلة حالات تمنع الانتقالات غير الصالحة والإغلاق مع تصعيد معلّق');
add('decide-comment-action-advisory-only',
  /advisory: CommentDecision/.test(watcherSrc) && /centralDecision: CentralActionDecision/.test(watcherSrc) &&
  watcherSrc.includes('لا تنشئ قراراً مستقلاً'),
  'decideCommentAction استشاري فقط (فحص سلامة) ولا يفوّض تنفيذاً');
add('decision-ledger-readable-by-brain',
  runtimeSrc.includes('export function decisionHistoryToMemoryRecords') &&
  runtimeSrc.includes('consumedDecisionHistory') &&
  server.includes('decisionHistoryToMemoryRecords(decisionLedger'),
  'سجل القرار→النتيجة قابل للقراءة من العقل المركزي (بلا نظام ذاكرة ثانٍ)');
add('human-escalation-module',
  escalationModule.includes('createEscalationRecord') && escalationModule.includes('notificationDelivered') &&
  escalationModule.includes('hasPendingEscalation') && escalationModule.includes('transitionEscalation') &&
  escalationModule.includes('ESCALATION_REASON_LABELS_AR'),
  'التصعيد البشري: سجل حقيقي بسياقه، ولا ادّعاء إشعار بلا مُبلِّغ ناجح');
add('iraqi-commercial-policy-module',
  iraqiPolicy.includes('export function checkCommercialPolicy') && iraqiPolicy.includes('hype_language') &&
  iraqiPolicy.includes('false_urgency') && iraqiPolicy.includes('absolute_promise') &&
  iraqiPolicy.includes('competitor_disparagement') && iraqiPolicy.includes('IRAQI_TONE_GUIDELINES_AR'),
  'سياسة التواصل التجاري العراقي: تمنع المبالغة/الإلحاح/الوعد المطلق/الحطّ من المنافسين (طبقة حتمية)');
add('iraqi-commercial-policy-wired',
  socialRoutes.includes('checkCommercialPolicy') && socialRoutes.includes('commercialPolicy') &&
  /commercialPolicy[\s\S]{0,200}status\(422\)/.test(socialRoutes),
  'السياسة مطبَّقة على مسار الرد (رفض 422) وعلى الرد المقترح في التصنيف');
add('ledger-read-back',
  runtimeSrc.includes('export function decisionHistoryToMemoryRecords') &&
  runtimeSrc.includes("e.outcome.availability !== 'available'") &&
  server.includes('decisionHistoryToMemoryRecords(decisionLedger'),
  'قراءة السجل: النتائج الملاحَظة تُرحَّل إلى ذاكرة العقل القائمة (بلا نظام ثانٍ، بلا اختراع)');
add('ledger-read-back-consumed-context',
  runtimeSrc.includes('buildRuntimeDecisionContext') && runtimeSrc.includes('consumedDecisionHistory') &&
  runtimeSrc.includes('priorOutcomes'),
  'قراءة السجل تُغذّي القرار المستقبلي (سياق تاريخ قابل للقراءة: نتائج ملاحَظة فقط)');
add('memory-separation-module',
  memorySepModule.includes('classifyConversationMessage') && memorySepModule.includes('canPromoteToLongTerm') &&
  memorySepModule.includes("tier: 'session_context'") && memorySepModule.includes('LONG_TERM_MEMORY_KINDS'),
  'فصل الذاكرة: رسالة الجلسة لا تُرقّى تلقائياً؛ الترقية بدليل موثّق فقط');
add('no-invented-outcomes',
  runtimeSrc.includes("e.outcome.availability !== 'available'") &&
  brainAuthorityTest.includes('لا اختراع'),
  'لا تُخترع نتائج: غير المتاح يبقى غير متاح ولا يتحول إلى ذاكرة');
add('no-reply-without-central-allowed',
  watcherSrc.includes("input.centralDecision === 'ALLOWED_ACTION'") &&
  watcherSrc.includes("code: 'REPLY_ALLOWED'") &&
  /if \(input\.centralDecision === 'ALLOWED_ACTION'\)[\s\S]*?action: 'reply', code: 'REPLY_ALLOWED'/.test(watcherSrc),
  'لا رد إلا بقرار العقل المركزي ALLOWED_ACTION (تصعيد/تأجيل بخلافه)');
add('one-decision-authority-runtime-path',
  server.includes('resolveCommentExecution(') && server.includes('centralActionDecisionForEvent(') &&
  server.includes("centralDecision: centralDecision ?? 'FAILED_SAFE'") &&
  watcherSrc.includes('export function resolveCommentExecution'),
  'مسار التنفيذ يعتمد قرار العقل المركزي وحده (سلطة واحدة): لا رد بلا ALLOWED_ACTION');
add('session-lifecycle-tests',
  pkg.scripts['test:session-lifecycle'] === 'tsx engine/tests/session.lifecycle.test.ts' &&
  pkg.scripts.test.includes('test:session-lifecycle') &&
  lifecycleTest.includes('nextConversationState') && lifecycleTest.includes('canPromoteToLongTerm'),
  'اختبار وحدة لدورة الحياة/التصعيد/فصل الذاكرة مضمّن في npm test');
add('single-decision-authority',
  server.includes('centralActionDecisionForEvent(') && server.includes('resolveCommentExecution(') &&
  server.includes("centralDecision: centralDecision ?? 'FAILED_SAFE'"),
  'سلطة قرار واحدة: مسار التنفيذ يقرأ قرار العقل المركزي (composeBrainDecision) وحده — لا قرار مستقل');
add('watcher-advisory-not-authority',
  watcherSrc.includes('export function resolveCommentExecution') &&
  watcherSrc.includes('سلطة التنفيذ الوحيدة') &&
  watcherSrc.includes('centralDecision: CentralActionDecision'),
  'decideCommentAction تصنيف استشاري فقط؛ سلطة التنفيذ في resolveCommentExecution (بلا قرار مستقل)');

  // نقطتا الفحص الحيّتان يجب ألا تُخزَّنا إطلاقاً: جسمهما يحمل commit النشر الحالي
  // ووقتاً حيّاً، فأي كاش (متصفح/وسيط/حافة) قد يقدّم استجابة قديمة مجمّدة فيُوهم
  // بعطل نشر غير موجود. غياب no-store عن أي منهما يُفشل الفحص النهائي.
  add('health-readiness-no-store', (() => {
    const noStore = (routePath) => new RegExp(
      'app\\.get\\("' + routePath + '",[\\s\\S]{0,600}?res\\.setHeader\\("Cache-Control",\\s*"no-store[^"]*"\\)[\\s\\S]{0,200}?res\\.setHeader\\("Pragma",\\s*"no-cache"\\)'
    ).test(server);
    return noStore('/api/health') && noStore('/api/readiness');
  })(), 'كلا نقطتي الفحص الحيّتين (/api/health و/api/readiness) تضبطان Cache-Control: no-store و Pragma: no-cache');

  // نبضة الإيقاظ محدودة النطاق: خطة Render المجانية 750 ساعة/شهر لكل Workspace
  // (مشتركة مع مركز التعافي)، فنطاق 24/7 يكسر الحصة ويخالف «مجاني للأبد». لذلك
  // يجب أن يكون كل جدول cron بالضبط "*/10 3-20 * * *" (06:00→24:00 بغداد = 03:00→21:00 UTC)
  // ولا يجوز أي جدول يغطّي كل الساعات (حقل الساعة = * أو 0-23).
  add('keep-alive-window-scoped', (() => {
    const wfPath = '.github/workflows/keep-alive.yml';
    if (!fs.existsSync(path.join(root, wfPath))) return false;
    const wf = read(wfPath);
    const crons = [...wf.matchAll(/cron:\s*["']?([^"'\n]+)["']?/g)].map((m) => m[1].trim());
    if (crons.length === 0) return false;
    const allExpected = crons.every((c) => c === '*/10 3-20 * * *');
    const hitsHealth = wf.includes('https://al-gharabi-ai.onrender.com/api/health');
    // منع أي جدول يغطّي كل الساعات: حقل الساعة (الثاني) = * أو 0-23.
    const anyFullDay = crons.some((c) => {
      const hour = (c.split(/\s+/) || [])[1];
      return hour === '*' || hour === '0-23';
    });
    return allExpected && hitsHealth && !anyFullDay;
  })(), 'نبضة الإيقاظ محصورة بنافذة 18 ساعة (كل جدول cron = "*/10 3-20 * * *") وتستهدف /api/health فقط، بلا أي جدول يغطّي 24 ساعة');

  // -------------------------------------------------------------------------
  // SCOPE ISOLATION (LEGACY ERP): أسطح Inventory/CRM/Finance/Customers-360/
  // Purchases/Reports خارج نطاق المشروع المعلن (سوشيال + AI + تسويق). تمنع هذه
  // الفحوص عودة أي مسار من هذه العائلات فعّالاً بلا عزل — كأي مسار جديد يُضاف
  // مستقبلاً ضمن نفس البادئات (البادئات كافية لتغطية أي مسار فرعي جديد).
  // -------------------------------------------------------------------------
  add('legacy-erp-scope-guard-present',
    server.includes('legacyErpScopeEnabled') &&
    server.includes('LEGACY_ERP_ROUTE_PREFIXES') &&
    server.includes('isLegacyErpRouteRequest') &&
    server.includes('GHARABI_ENABLE_LEGACY_ERP_SCOPE') &&
    server.includes('SCOPE_DISABLED'),
    'حارس عزل أسطح ERP/CRM/المالية القديمة موجود في server.ts');

  add('legacy-erp-scope-fail-closed',
    /function legacyErpScopeEnabled\(\)[\s\S]{0,220}return raw === "true" \|\| raw === "1" \|\| raw === "on" \|\| raw === "yes"/.test(server) &&
    server.includes('if (!legacyErpScopeEnabled())') &&
    !/process\.env\.GHARABI_ENABLE_LEGACY_ERP_SCOPE\s*=\s*["']?(true|1|on|yes)/i.test(server) &&
    !server.includes('GHARABI_ENABLE_LEGACY_ERP_SCOPE ?? "true"'),
    'الحارس fail-closed: لا قيمة تفعيل مكتوبة في الكود ولا افتراضي مُفعّل');

  add('legacy-erp-prefixes-complete',
    ['/api/inventory', '/api/customers/360', '/api/reports/operations', '/api/crm', '/api/purchases', '/api/finance',
      '/api/catalog', '/api/tasks', '/api/business', '/api/suppliers', '/api/expenses', '/api/contracts', '/api/installments', '/api/executive']
      .every((p) => server.includes(`"${p}"`)),
    'بادئات أسطح ERP/CRM/المالية القديمة كلها معزولة (بما فيها catalog/tasks/business/suppliers/expenses/contracts/installments/executive)');

  // عائلات خارج النطاق (سوشيال + AI + تسويق) لكنها مستهلكة بواجهات: المبيعات والمالية/
  // دليل العملاء. تُعزل بنفس المفتاح في قائمة منفصلة (`OUT_OF_SCOPE_LIVE_ROUTE_PREFIXES`)
  // عبر `isOutOfScopeLiveRouteRequest` الموصولة داخل كتلة fail-closed. يمنع هذا الحارس
  // إعادة أي منها إلى الواجهة الظاهرة أو إخراجها من العزل.
  add('out-of-scope-live-routes-isolated', (() => {
    const m = server.match(/const OUT_OF_SCOPE_LIVE_ROUTE_PREFIXES[^=]*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
    if (!m) return false;
    const list = m[1];
    const required = ['/api/sales', '/api/control/alerts', '/api/control/customer-directory', '/api/control/cashflow', '/api/control/reconciliation', '/api/control/daily-brief'];
    const allListed = required.every((p) => list.includes(`"${p}"`));
    const matcherWired = server.includes('function isOutOfScopeLiveRouteRequest') &&
      /isOutOfScopeLiveRouteRequest\(String\(req\.url \|\| ""\)\)/.test(server);
    return allListed && matcherWired;
  })(), 'عائلات المبيعات/المالية/دليل العملاء خارج النطاق ومُعزَلة عبر isOutOfScopeLiveRouteRequest (404 SCOPE_DISABLED)');
  add('out-of-scope-no-visible-consumer',
    // لا مكوّن داخل النطاق (ظاهر) يستهلك مسارات خارج النطاق — وإلا لكان العزل يكسر واجهة ظاهرة.
    (() => {
      const methods = ['getSales', 'getCashflow', 'getCustomerDirectory', 'getControlAlerts', 'getDailyBrief', 'getReconciliation'];
      const outOfScopeComponents = ['sales/SalesCenterView.tsx', 'finance/FinanceView.tsx', 'business/BusinessSuiteView.tsx', 'control/OperationsControlView.tsx'];
      const inScope = [];
      const walk = (dir) => {
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name);
          if (fs.statSync(full).isDirectory()) { walk(full); continue; }
          const rel = path.relative(path.join(root, 'src/components'), full);
          if (outOfScopeComponents.includes(rel)) continue;
          const text = fs.readFileSync(full, 'utf8');
          for (const mth of methods) if (text.includes(mth)) { inScope.push(`${rel}:${mth}`); break; }
        }
      };
      walk(path.join(root, 'src/components'));
      return inScope.length === 0;
    })(), 'لا مستهلك داخل النطاق لمسارات المبيعات/المالية (العزل لا يكسر واجهة ظاهرة)');
  add('sidebar-hides-out-of-scope-tabs',
    read('src/components/common/Sidebar.tsx').includes("'sales'") &&
    read('src/components/common/Sidebar.tsx').includes("'control'") &&
    /LEGACY_ERP_TAB_IDS\s*=\s*new Set\(\[[\s\S]*?'sales'[\s\S]*?'control'[\s\S]*?\]\)/.test(read('src/components/common/Sidebar.tsx')) &&
    read('src/components/common/Sidebar.tsx').includes('LEGACY_ERP_NAV_ENABLED = false'),
    'تبويبا sales/control مخفيان من التنقل (LEGACY_ERP_TAB_IDS + NAV_ENABLED=false)');

  add('legacy-erp-no-visible-consumer-surface-guarded',
    // الأسطح المعزولة الجديدة بلا مستهلك واجهة ظاهر: لا مكوّن ظاهر يستدعي مساراتها.
    ['getSuppliers', 'getExpenses', 'getContracts', 'getInstallmentSchedule', 'getBusinessOverview', 'getExecutiveOverview', 'getTasks']
      .every((m) => {
        const used = ['business/BusinessSuiteView.tsx', 'operations/OperationsView.tsx', 'executive/ExecutiveCommandView.tsx'];
        return used.some((f) => fs.existsSync(path.join(root, 'src/components', f)) && read(`src/components/${f}`).includes(m));
      }),
    'الأسطح المعزولة الجديدة يستهلكها فقط مكوّنات التبويبات المخفية (لا كسر لواجهة ظاهرة)');

  add('legacy-erp-guard-before-routes', (() => {
    const guardIdx = server.indexOf('if (!legacyErpScopeEnabled())');
    if (guardIdx < 0) return false;
    const routeRe = /app\.(?:get|post|patch|delete|put|use)\(\s*"\/api\/(?:catalog|inventory|customers\/360|reports\/operations|crm|purchases|finance|tasks|business|suppliers|expenses|contracts|installments|executive)[/"]/g;
    let m; let earliest = Infinity;
    while ((m = routeRe.exec(server))) { if (m.index < earliest) earliest = m.index; }
    return earliest !== Infinity && guardIdx < earliest;
  })(), 'حارس العزل مسجَّل قبل أول مسار من كل أسطح ERP/CRM/المالية (فلا مسار فعّال بلا عزل، بما فيها /api/catalog/quote)');

  add('legacy-erp-ui-nav-gated',
    sidebar.includes('LEGACY_ERP_NAV_ENABLED') &&
    sidebar.includes('LEGACY_ERP_TAB_IDS') &&
    /LEGACY_ERP_NAV_ENABLED \|\| !LEGACY_ERP_TAB_IDS\.has\(item\.id\)/.test(sidebar),
    'مداخل الواجهة لأسطح ERP/CRM/المالية مخفية افتراضياً في Sidebar');

  add('legacy-erp-health-exposed',
    server.includes('legacyErpScope') &&
    /legacyErpScope:\s*\{[\s\S]{0,200}isolated:\s*!legacyErpScopeEnabled\(\)/.test(server),
    '/api/health يعلن حالة عزل أسطح ERP/CRM/المالية (منطقي بلا قيمة سرّية)');

  add('legacy-erp-isolation-test',
    fs.existsSync(path.join(root, 'engine/tests/scope.legacy.erp.isolation.test.ts')) &&
    read('package.json').includes('test:scope-legacy-erp'),
    'اختبار عزل أسطح ERP/CRM/المالية موجود ومربوط في npm test');

  // تحصين دفاعي: الحارس يطبّع المسار (شرطة مكرّرة/ترميز/نقاط) قبل المطابقة، فلا
  // تتجاوز صيغة `//api/crm/...` المطابقة النصية الخام. مطابق لسياسة canonicalRequestPath.
  add('legacy-erp-guard-normalizes-path', (() => {
    const fnIdx = server.indexOf('function isLegacyErpRouteRequest');
    if (fnIdx < 0) return false;
    const body = server.slice(fnIdx, fnIdx + 1200);
    return body.includes('decodeURIComponent') && body.includes('path.posix.normalize') &&
      body.includes('replace(/\\\\/g, "/")') && body.includes('.replace(/\\/+$/, "")');
  })(), 'حارس عزل ERP يطبّع المسار (فكّ ترميز + توحيد فواصل + حلّ النقاط + طيّ الشرطة المكرّرة) قبل المطابقة');

  add('legacy-erp-dup-slash-test',
    read('engine/tests/scope.legacy.erp.isolation.test.ts').includes('//api/crm/leads') &&
    read('engine/tests/scope.legacy.erp.isolation.test.ts').includes('/api//crm/leads') &&
    read('engine/tests/scope.legacy.erp.isolation.test.ts').includes('dup-slash'),
    'اختبار عزل ERP يثبت عزل صيغ الشرطة المائلة المكرّرة (//api/... و/api//...)');

  // ------------------------------------------------------------
  // M2 — تقليص الكشف التشغيلي في النقطتين العامتين /api/health و/api/readiness.
  // ------------------------------------------------------------
  add('health-public-shrinks-watcher-counters',
    server.includes('function watcherStatusBlockPublic()') &&
    /watcherStatusBlockPublic\(\)[\s\S]{0,900}status\b/.test(server) &&
    // الكتلة العامة لم تعد تحمل counters/pollCount التفصيلية.
    !/function watcherStatusBlockPublic\(\)[\s\S]{0,1200}?counters:/.test(server),
    'الكتلة العامة youtubeWatcher أُقلّصت إلى حالة عامة بلا عدّادات تفصيلية');

  add('health-public-quota-summary-only',
    server.includes('function youtubeQuotaStatusSummary()') &&
    // النقطتان العامتان تستخدمان الملخص لا اللقطة الكاملة.
    (server.match(/youtubeQuota: youtubeQuotaStatusSummary\(\)/g) || []).length >= 2 &&
    !server.includes('youtubeQuota: youtubeQuotaStatusSnapshot()'),
    'النقطتان العامتان تعلنان ملخص الحصة (youtubeQuotaStatusSummary) لا التفاصيل');

  add('health-public-content-summary-only',
    server.includes('function contentQueueSummaryPublic(') &&
    (server.match(/youtubeContent: contentQueueSummaryPublic\(contentQueueSummary\(\)\)/g) || []).length >= 2 &&
    !server.includes('youtubeContent: { summary: contentQueueSummary(), mediaStored'),
    'النقطتان العامتان تعلنان مجاميع المحتوى لا byState/mediaTotalBytes');

  add('health-operational-details-owner-route',
    server.includes('app.get("/api/agent/youtube/quota", authenticateToken') &&
    server.includes('quota: youtubeQuotaStatusSnapshot()'),
    'التفاصيل التشغيلية الكاملة (الحصة) نُقلت لمسار محمي بالمصادقة');

  add('health-operational-shrink-test',
    fs.existsSync(path.join(root, 'engine/tests/health.privacy.test.ts')) &&
    read('engine/tests/health.privacy.test.ts').includes('FORBIDDEN_OPERATIONAL_DETAIL_FIELDS'),
    'اختبار الخصوصية يمنع رجوع الحقوق التشغيلية التفصيلية للنقطتين العامتين');

  // ------------------------------------------------------------
  // M5 — حجب ملفات الإعداد/القوائم من الخدمة العامة.
  // ------------------------------------------------------------
  add('static-blocks-config-files',
    server.includes('BLOCKED_ROOT_FILES') &&
    server.includes('"/package.json"') &&
    server.includes('"/package-lock.json"') &&
    server.includes('"/render.yaml"') &&
    /if \(BLOCKED_ROOT_FILES\.has\(p\)\) return true;/.test(server),
    'ملفات package.json/package-lock.json/render.yaml محجوبة من الخدمة العامة (404)');

  add('static-config-block-test',
    read('engine/tests/source.bundle.exposure.test.ts').includes("'/package.json'") &&
    read('engine/tests/source.bundle.exposure.test.ts').includes("'/render.yaml'"),
    'اختبار كشف المصدر يتحقق من حجب ملفات الإعداد');

  // ------------------------------------------------------------
  // M6 — سقوف صارمة لمصفوفات الحالة في الذاكرة (منع OOM).
  // ------------------------------------------------------------
  add('workspace-array-caps-defined',
    ['WORKSPACE_MAX_WEBHOOK_EVENTS', 'WORKSPACE_MAX_PROVIDER_EVENTS', 'WORKSPACE_MAX_SOCIAL_COMMENTS',
     'WORKSPACE_MAX_SOCIAL_REPLIES', 'WORKSPACE_MAX_PUBLISH_RECORDS']
      .every((c) => server.includes(`const ${c} =`)),
    'سقوف مصفوفات الحالة في الذاكرة محدّدة كثوابت مسماة');

  add('workspace-unshift-capped', (() => {
    // لكل unshift على مصفوفة سجلات: يجب أن يتبعه سقف صارم خلال الأسطر التالية
    // (سقف على نفس السطر، أو slice/length في نافذة 6 أسطر) — يغطي الشكل أحادي
    // السطر والمتعدد الأسطر. يُثبت أن لا مصفوفة تنمو بلا حدّ.
    const lines = server.split('\n');
    const re = /\(workspace as any\)\.(webhookEvents|providerEvents|socialComments|socialReplies|publishRecords)\.unshift\(/;
    for (let i = 0; i < lines.length; i += 1) {
      if (!re.test(lines[i])) continue;
      // نافذة 12 سطراً تغطي أطول كتلة unshift متعددة الأسطر حتى سطر السقف التالي.
      const window = lines.slice(i, i + 12).join('\n');
      const capped = /WORKSPACE_MAX_[A-Z_]+/.test(window) || /\.slice\(0,\s*WORKSPACE_MAX_[A-Z_]+\)/.test(window);
      if (!capped) return false;
    }
    return true;
  })(), 'كل unshift لمصفوفات السجلات يتبعه سقف صارم (لا نموّ بلا حدّ)');

  add('active-sessions-capped',
    server.includes('WORKSPACE_MAX_ACTIVE_SESSIONS') && server.includes('function enforceActiveSessionCap()'),
    'خريطة الجلسات في الذاكرة مقيّدة بسقف دفاعي');

  add('active-sessions-count-honest',
    server.includes('function activeSessionCount()') &&
    !server.includes('sessions:activeSessions.size') &&
    server.includes('sessions:activeSessionCount()'),
    'عدّاد الجلسات المعروض يحسب غير المنتهية فعلياً (L4)');

  // ------------------------------------------------------------
  // M3 — اختبار e2e حقيقي واحد على الأقل (متصفح حقيقي).
  // ------------------------------------------------------------
  add('e2e-login-test-present',
    fs.existsSync(path.join(root, 'engine/e2e/login.e2e.spec.ts')) &&
    fs.existsSync(path.join(root, 'playwright.config.ts')) &&
    Boolean(pkg.scripts['test:e2e']) &&
    pkg.devDependencies?.['@playwright/test'],
    'اختبار e2e حقيقي لمتدفق الدخول موجود ومربوط بـnpm run test:e2e (منفصل عن npm test)');

  add('e2e-not-in-default-suite',
    typeof pkg.scripts.test === 'string' && !pkg.scripts.test.includes('test:e2e'),
    'اختبار المتصفح منفصل عن npm test (لا يفترض متصفحاً في CI الحالي)');

  // ------------------------------------------------------------
  // Point 2 — فحص دور موحّد على مسارات البيع/الأعمال/المالية.
  // (المسارات التي كانت مُحصّنة أصلاً — GET/POST /api/sales وPATCH/payments — مستثناة.)
  // ------------------------------------------------------------
  const guardedRoutes = [
    'app.get("/api/customers/360"', 'app.get("/api/reports/operations"',
    'app.get("/api/sales/:id/payments"', 'app.get("/api/business/overview"',
    'app.get("/api/suppliers"', 'app.post("/api/suppliers"', 'app.patch("/api/suppliers/:id"',
    'app.get("/api/purchases"', 'app.post("/api/purchases"',
    'app.get("/api/expenses"', 'app.post("/api/expenses"',
    'app.get("/api/contracts"', 'app.post("/api/contracts"', 'app.post("/api/contracts/:id/sign"',
    'app.get("/api/installments/schedule"', 'app.post("/api/installments/generate"', 'app.get("/api/installments/due"',
    'app.get("/api/executive/overview"',
    "app.get('/api/control/customer-directory'", "app.get('/api/control/cashflow'",
  ];
  const missingGuard = guardedRoutes.filter((sig) => {
    const i = server.indexOf(sig);
    if (i < 0) return true;
    return !/\["owner","manager","staff"\]\.includes/.test(server.slice(i, i + 500));
  });
  add('sales-erp-role-guards-present', missingGuard.length === 0,
    missingGuard.length ? `بلا فحص دور: ${missingGuard.join(', ')}` : 'كل مسارات البيع/الأعمال/المالية تحمل فحص ["owner","manager","staff"]');

  // مسارا /api/control/alerts و/api/control/daily-brief يكشفان بيانات مالية/تشغيلية
  // حقيقية؛ يلزمهما نفس فحص الدور (لا requireOwner، اتساقاً مع بقية /api/control/*).
  const controlGuards = ["app.get('/api/control/alerts'", "app.get('/api/control/daily-brief'"];
  const missingControlGuard = controlGuards.filter((sig) => {
    const i = server.indexOf(sig);
    if (i < 0) return true;
    return !/\["owner","manager","staff"\]\.includes/.test(server.slice(i, i + 500));
  });
  add('control-alerts-brief-role-guards', missingControlGuard.length === 0,
    missingControlGuard.length ? `بلا فحص دور: ${missingControlGuard.join(', ')}` : '/api/control/alerts و/api/control/daily-brief يحملان فحص ["owner","manager","staff"]');

  // ------------------------------------------------------------
  // Point 3 — ربط YouTube بالمبيعات الموثّقة: قراءة فقط، بلا سببية/ROI.
  // ------------------------------------------------------------
  const corrModule = read('engine/social/youtubeSalesCorrelation.ts');
  add('youtube-sales-correlation-module',
    corrModule.includes('export function buildYouTubeSalesCorrelation') && corrModule.includes("from '../brain/knowledge/truth'"),
    'وحدة الربط موجودة وتعيد استخدام نموذج الصدق القائم (truth.ts)');
  add('youtube-sales-correlation-read-only',
    !/\bpersistState\s*\(|writeFileSync\s*\(|\.unshift\s*\(|\.splice\s*\(/.test(corrModule),
    'الوحدة قراءة فقط (لا كتابة دائمة ولا تعديل بيانات)');
  add('youtube-sales-correlation-owner-only',
    server.includes('app.get("/api/agent/youtube/sales-correlation", requireOwner'),
    'المسار مقتصر على المالك (requireOwner)');
  add('youtube-sales-correlation-no-causation',
    corrModule.includes('لا سببية') && corrModule.includes('UNAVAILABLE'),
    'لا يدّعي سببية/نسبة/ROI؛ وغير المتاح يُعلن صراحةً');
  add('youtube-sales-correlation-tests',
    Boolean(pkg.scripts['test:youtube-sales-correlation']) && typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:youtube-sales-correlation'),
    'اختبار الربط موجود ومربوط بـnpm test');
  add('sales-erp-authz-tests',
    Boolean(pkg.scripts['test:sales-erp-authz']) && typeof pkg.scripts.test === 'string' && pkg.scripts.test.includes('test:sales-erp-authz'),
    'اختبار تصريح البيع/ERP موجود ومربوط بـnpm test');

  // ------------------------------------------------------------
  // إصلاح خطاف React في PlatformConnectionCenter: يمنع رجوع خطاف داخل دالة async.
  // tsc لا يكشف هذا النوع؛ يكشفه فحص react-hooks/rules-of-hooks وقت التشغيل.
  // ------------------------------------------------------------
  const hookSrc = read('src/components/social/PlatformConnectionCenter.tsx');
  // آخر `const load` هو load الخاص بالمكوّن الرئيسي (هناك load آخر في TikTokStatusPanel).
  const hookLoadStart = hookSrc.lastIndexOf('const load = useCallback(async () => {');
  const hookLoadEnd = hookLoadStart >= 0 ? hookSrc.indexOf('}, [showToast]);', hookLoadStart) : -1;
  const hookLoadBody = hookLoadStart >= 0 && hookLoadEnd > hookLoadStart ? hookSrc.slice(hookLoadStart, hookLoadEnd) : null;
  add('platform-connection-no-hook-in-load',
    hookLoadBody !== null && !/\buseEffect\b/.test(hookLoadBody),
    'لا useEffect داخل دالة load (async/useCallback) — الخطافات على المستوى الأعلى فقط');
  const hookAfterLoad = hookLoadEnd > hookLoadStart ? hookSrc.slice(hookLoadEnd) : '';
  add('platform-connection-oauth-effect-top-level',
    /useEffect\(\(\) => \{\s*if \(!oauthReturn\) return;/.test(hookAfterLoad),
    'useEffect الخاص بمعالجة oauthReturn موضوع بعد إغلاق load (المستوى الأعلى) لا داخله');
  const hookE2e = read('engine/e2e/platform-connection.e2e.spec.ts');
  add('platform-connection-hooks-e2e',
    /Invalid hook call/.test(hookE2e) && /مركز ربط المنصات/.test(hookE2e),
    'اختبار e2e يفتح صفحة مركز ربط المنصات ويؤكد غياب خطأ الخطافات في الكونسول');
  add('platform-connection-hooks-e2e-wired',
    Boolean(pkg.scripts['test:e2e']) && String(pkg.scripts['test:e2e']).includes('playwright'),
    'اختبار e2e مربوط بـnpm run test:e2e');
  const hookDrBundleSrc = read('tools/dr/source-bundle.mjs');
  add('dr-source-walk-excludes-playwright-artifacts',
    /test-results/.test(hookDrBundleSrc) && /playwright-report/.test(hookDrBundleSrc),
    'مشي المصدر يستبعد مخرجات Playwright فلا تفشل حزمة المصدر عند وجودها');

  // ------------------------------------------------------------
  // الدفعة الأخيرة (تحسينات غير حرجة): حرّاس انحدار.
  // ------------------------------------------------------------
  // 1) Dockerfile: مرحلة البناء تبني الواجهة بوضع الإنتاج (Vite يحترم NODE_ENV)،
  //    مع --include=dev الصريح كي لا تُسقَط devDependencies رغم NODE_ENV=production.
  const docker = read('Dockerfile');
  const buildStage = docker.slice(docker.indexOf('AS build'), docker.indexOf('AS runtime'));
  add('docker-build-nodeenv-production',
    /ENV NODE_ENV=production/.test(buildStage) && !/ENV NODE_ENV=development/.test(buildStage) && /npm ci --include=dev/.test(buildStage),
    'مرحلة البناء تضبط NODE_ENV=production وتُثبّت devDependencies صراحةً (--include=dev)');
  add('docker-runtime-nodeenv-production',
    /ENV NODE_ENV=production/.test(docker.slice(docker.indexOf('AS runtime'))),
    'مرحلة التشغيل تبقى NODE_ENV=production');

  // 2) توحيد كشف الأسرار: مصدر واحد (SECRET_KEY_RE) + أنماط نص موسّعة.
  const errorSafety = read('engine/runtime/errorSafety.ts');
  const orchestrator = read('engine/agent/orchestrator.ts');
  add('error-safety-secret-source-unified',
    /export const SECRET_KEY_RE = /.test(errorSafety) && /export const SECRET_TEXT_PATTERNS/.test(errorSafety) &&
    orchestrator.includes("import { SECRET_KEY_RE } from '../runtime/errorSafety'") && !/^const SECRET_KEY_RE =/m.test(orchestrator),
    'SECRET_KEY_RE مصدر واحد في errorSafety يستورده orchestrator (لا قائمتان تتباعدان)');
  add('error-safety-secret-patterns-expanded',
    /cookie/.test(errorSafety) && /session/.test(errorSafety) && /credential/.test(errorSafety) && /\|token\|secret\|/.test(errorSafety),
    'أنماط الأسرار تشمل cookie/session/credential وtoken/secret المجرّدين');

  // 3) إسقاط مقاطع الجمهور بحقول النوع الحقيقي + بلا any.
  const runtimeBrainSrc = read('engine/brain/runtime.ts');
  add('brain-audience-projection-real-fields',
    runtimeBrainSrc.includes('function projectAudienceSegment(s: AudienceSegment)') && !/\.map\(\(s: any\)/.test(runtimeBrainSrc) &&
    /audienceSegments: \(built\.state\.audience\?\.segments \|\| \[\]\)\.slice\(0, 6\)\.map\(projectAudienceSegment\)/.test(runtimeBrainSrc),
    'إسقاط المقاطع مطابق للنوع الحقيقي (label/sampleSize/confidence) وبلا any — لا إفراغ صامت');
  add('brain-audience-headlines-use-label',
    server.includes('dc.audienceSegments.map((s) => `${s.label} (عيّنة ${s.sampleSize})`)'),
    'مستهلك سياق القرار يقرأ label الحقيقي لا topic المُختلق');

  // 4) معالج فشل ربط المنفذ.
  add('server-listen-error-handler',
    /httpServer\.on\("error"/.test(server) && server.includes('EADDRINUSE') && server.includes('المنفذ ${PORT} مستخدم بالفعل'),
    'app.listen يملك معالج error يفسّر EADDRINUSE وينهي العملية بفشل صريح');

  // 5) معرّف العميل تجزئة أحادية الاتجاه.
  add('customer-id-irreversible-hash',
    /function customerPublicId\(key:string\)\{ return `cust_\$\{crypto\.createHash\('sha256'\)/.test(server) &&
    !/cust_\$\{Buffer\.from\(key\)\.toString\('base64url'\)/.test(server),
    'معرّف العميل تجزئة SHA-256 أحادية الاتجاه (لا base64url قابل للعكس إلى رقم الهاتف)');

  // 6) مكوّنات ERP القديمة lazy (code splitting) لا استيراداً ثابتاً.
  const legacyNames = ['ExecutiveCommandView', 'BusinessSuiteView', 'FinanceView', 'InventoryView', 'ReportsView', 'OperationsView'];
  add('app-legacy-erp-lazy',
    legacyNames.every((n) => new RegExp(`const ${n} = lazy\\(\\(\\) => import\\('\\./components/`).test(app) && !new RegExp(`import \\{ ${n} \\}`).test(app)) &&
    app.includes("case 'finance': return <FinanceView />"),
    'مكوّنات ERP القديمة تُحمَّل عند الطلب (لا تثقل الحزمة) مع بقاء حالات التنقّل');

  // 7) شاشة الدخول: لا بريد مالك حقيقي.
  const loginView = read('src/components/auth/LoginView.tsx');
  add('login-no-real-owner-email',
    !loginView.includes('mrdalghrabylltqsyt') && loginView.includes('example@domain.com'),
    'LoginView لا يعرض بريد المالك الحقيقي (placeholder عام)');

  // 8) AGENTS.md: عدد فحوصات final-audit مطابق للفعلي (يُعَدّ من نص الملف نفسه).
  const auditCount = (read('final-audit.mjs').match(/^\s*add\(/gm) || []).length;
  add('agents-audit-count-accurate',
    read('AGENTS.md').includes(`final-audit.mjs (${auditCount} فحصاً)`),
    `AGENTS.md يذكر العدد الفعلي لفحوصات final-audit (${auditCount})`);

  const failed = checks.filter(x => !x.ok);
console.table(checks);
if (failed.length) {
  console.error(`FINAL AUDIT FAILED: ${failed.length} checks`);
  for (const f of failed) console.error(`  - ${f.id}: ${f.detail}`);
  process.exit(1);
}
console.log(`FINAL AUDIT PASSED: ${checks.length} checks`);
