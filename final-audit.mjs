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
add('youtube-comment-scan-bounded', youtubeModuleSrc.includes('YOUTUBE_COMMENT_SCAN_VIDEO_LIMIT') && server.includes('slice(0, YOUTUBE_COMMENT_SCAN_VIDEO_LIMIT)'), 'حدّ ثابت لعدد الفيديوهات المفحوصة يمنع استهلاكاً غير محدود للـAPI');
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
add('youtube-watcher-worker-in-process', server.includes('function startYouTubeWatcher') && server.includes('setInterval(tick') && server.includes('startYouTubeWatcher();'), 'حلقة المراقبة تعمل داخل عملية الخادم الدائمة (مستقلة عن المتصفح)');
add('youtube-watcher-cycle-real-executor', server.includes('await executeYouTubeReply({ commentId: String(c.commentId), text: replyText, commentText: String(c.text || "") }, "watcher")'), 'دورة المراقبة تنفّذ الرد عبر منفّذ الرد الحقيقي الموحّد (لا مسار جانبي)');
add('youtube-watcher-delegation-gated', server.includes('watcherReplyExecutionReady') && server.includes('youtubeDelegationCheck') && server.includes('DELEGATION_REQUIRED'), 'الرد الآلي محجوب بلا تفويض فعّال (delegation gate محفوظ)');
add('youtube-watcher-double-gate', server.includes('const replyGate = watcherGate(controls, "reply")') && server.includes('if (!replyReady.ready || !replyGate.allowed)'), 'فرض مزدوج: بوابة الأتمتة تُعاد فحصها عند نقطة التنفيذ نفسها (لا تجاوز)');
add('youtube-watcher-no-fake-arg', !/commentId:\s*"[a-zA-Z0-9_-]+"/.test(server.slice(server.indexOf('async function runYouTubeWatcherCycle'), server.indexOf('function startYouTubeWatcher'))), 'لا معرّف تعليق مُختلق في دورة المراقبة (commentId يأتي من YouTube فقط)');
add('youtube-watcher-honest-delivery', server.includes("const delivered = Boolean(result.body?.delivered && result.body?.externalReplyId);") && server.includes("baseEntry.stage = \"REPLIED\""), 'لا يُسجَّل رد مُسلَّم بلا معرّف رد حقيقي من YouTube');
add('youtube-watcher-durable-state', server.includes('WATCHER_STATE_KEY') && server.includes('persistWatcherState') && server.includes('applyWatcherStateSnapshot') && server.includes('storageAdapter.read<any>(WATCHER_STATE_KEY)') && server.includes('storageAdapter.readSync<any>(WATCHER_STATE_KEY)'), 'حالة المراقبة تُحفظ/تُسترجع عبر المحوّل فتصمد بعد restart/deploy');
add('youtube-watcher-owner-controls', server.includes('/api/agent/youtube/watcher/controls') && server.includes('requireOwner') && server.includes('/api/agent/youtube/watcher/poll') && server.includes('/api/agent/youtube/watcher/brief'), 'مسارات التحكم/التشغيل/التقرير للمالك فقط');
add('youtube-watcher-health-block', server.includes('youtubeWatcher: watcherStatusBlock()'), 'حالة مدير YouTube تُعلن في /api/health (نشاط/إيقاع/آخر رد/معلّق)');
add('youtube-watcher-ui-tab', app.includes('YouTubeOperationsView') && app.includes("case 'youtube_operations'") && read('src/components/common/Sidebar.tsx').includes("id: 'youtube_operations'"), 'واجهة مدير تشغيل YouTube مرتبطة بتبويب فعّال في القائمة');
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

const failed = checks.filter(x => !x.ok);
console.table(checks);
if (failed.length) {
  console.error(`FINAL AUDIT FAILED: ${failed.length} checks`);
  for (const f of failed) console.error(`  - ${f.id}: ${f.detail}`);
  process.exit(1);
}
console.log(`FINAL AUDIT PASSED: ${checks.length} checks`);
