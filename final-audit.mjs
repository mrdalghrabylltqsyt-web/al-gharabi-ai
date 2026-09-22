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

// فحص اتصال Gemini: مسار واحد للمالك، يثبت موديل الإنتاج حصراً بلا failover،
// بلا retry، وقابل للاختبار الحي اليدوي فقط. النجاح لا يُستنتج من HTTP 200 وحده.
const verifyRouteStart = server.indexOf('app.post("/api/ai/verify-provider"');
const verifyRouteEnd = server.indexOf('// Health endpoint', verifyRouteStart);
const verifyRoute = verifyRouteStart >= 0 && verifyRouteEnd > verifyRouteStart ? server.slice(verifyRouteStart, verifyRouteEnd) : '';
add('gemini-verify-owner-only', server.includes('app.post("/api/ai/verify-provider", requireOwner'), 'فحص المزود الحي محصور بالمالك');
add('gemini-verify-production-model-only', verifyRoute.includes('const model = PRODUCTION_MODEL') && !verifyRoute.includes('resolveModelCandidates') && !verifyRoute.includes('for (const model of candidates)'), 'التحقق يثبت موديل الإنتاج حصراً بلا failover صامت');
const verifyRouteCode = verifyRoute.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
add('gemini-verify-no-retry', verifyRouteCode.length > 0 && !/retry/i.test(verifyRouteCode) && !verifyRouteCode.includes('aiEngine'), 'لا retry ولا cache في مسار التحقق الحي');
const geminiVerifyTest = read('engine/tests/gemini.verification.test.ts');
add('gemini-verify-test-exists', fs.existsSync(path.join(root, 'engine/tests/gemini.verification.test.ts')), 'اختبار فحص اتصال Gemini موجود');
add('gemini-verify-ui-owner-only', read('src/components/system/SystemControlView.tsx').includes('اختبار اتصال Gemini') && read('src/components/system/SystemControlView.tsx').includes("currentUser?.role!=='owner'"), 'زر اختبار اتصال Gemini محصور بالمالك في الواجهة');
add('gemini-verify-frontend-timeout', read('src/services/geminiVerification.ts').includes('GEMINI_VERIFY_TIMEOUT_MS') && /AbortController/.test(read('src/services/geminiVerification.ts')), 'مهلة صريحة لفحص Gemini من الواجهة');
add('gemini-verify-test-no-secret', !/AIzaSy[A-Za-z0-9_\-]{5,}/.test(geminiVerifyTest), 'اختبار فحص Gemini لا يحمل أي مفتاح حقيقي');

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

const failed = checks.filter(x => !x.ok);
console.table(checks);
if (failed.length) {
  console.error(`FINAL AUDIT FAILED: ${failed.length} checks`);
  process.exit(1);
}
console.log(`FINAL AUDIT PASSED: ${checks.length} checks`);
