# جدول المصادر — كل رقم في المخططين ومصدره القابل للتحقق

> الغرض: لا رقم واحد بلا مصدر. كل صف يحمل الأمر أو الملف أو الاستدعاء الذي أنتج القيمة.
> التاريخ: 2026-10-08 · main/الإنتاج: `8825a67` · فرع العمل: `feat/multiplatform-publish-six-agent-lifecycle` (من main `c5ec98d`)

## أ) هوية الإصدار (المصدر: Git + استدعاء حي)

| القيمة | المصدر (أمر قابل للتنفيذ) |
|---|---|
| فرع العمل = `feat/multiplatform-publish-six-agent-lifecycle` | `git branch --show-current` |
| `main = origin/main = 8825a67b06302a270bc4a535fbe531f395a8ed40` | `git rev-parse origin/main` |
| الإنتاج `deploy.commit = 8825a67`, `branch=main`, `nodeEnv=production` | `curl -s https://al-gharabi-ai.onrender.com/api/health` → `.deploy` |
| `version = 13.0.0`, `status = ok` | نفس الاستدعاء → `.version` / `.status` |
| طابع قراءة الإنتاج `2026-10-08T04:30:00Z` | حقل زمن الاستدعاء الحي |

## ب) عدّادات الكود (المصدر: ملفات المستودع على فرع العمل)

| القيمة | المصدر |
|---|---|
| `server.ts = 14617` سطر | `wc -l server.ts` |
| تسجيل مسارات `get 119 · post 88 · put 3 · patch 9 · delete 9` = 228 | `grep -cE 'app\.(get\|post\|put\|patch\|delete)\(' server.ts` لكل طريقة |
| `app.use( = 10` (المجموع app.* = 238) | `grep -cE 'app\.use\(' server.ts` |
| مكوّنات الواجهة `.tsx = 38` | `find src/components -name '*.tsx' \| wc -l` |
| ملفات `engine/**/*.ts = 250` | `find engine -name '*.ts' \| wc -l` |
| `tools/dr = 27` ملف `.mjs` | `ls tools/dr/*.mjs \| wc -l` |
| `test:* scripts = 119` · المُستدعاة في `npm test` = 93 | تحليل `package.json` |
| `final-audit = 1355` فحص | `grep -oE '^\s*add\(' final-audit.mjs \| wc -l` + مخرج `node final-audit.mjs` |

## ج) الحالة الحية للمنصّات (المصدر: `/api/health` و `/api/readiness`)

| القيمة | المصدر |
|---|---|
| `realConnector = true` لـ [tiktok, youtube, facebook, instagram, telegram] | `engine/social/registry.ts` (كود) + حقل الصحة |
| `connectedVerified = [telegram]` فقط | `/api/readiness.brain.connectedVerified` |
| YouTube `connected=false`, `operationalState=TOKEN_REFRESH_REQUIRED`, `tokenExpired=true`, `refreshTokenable=true` | `/api/health.youtubeOAuth` |
| Facebook `userAccessTokenStored=false`, `pageAccessTokenStored=false`, `pendingPageSelection=false` | `/api/health.facebookOAuth` |
| Instagram `scopeCount=9`, `configurationReady=false`, `loginConfigIdUsed=false`, `onboardingFlow=disabled` | `/api/health.instagramOAuth` |
| TikTok `clientKeyConfigured=true`, `operationalState=READY_TO_CONNECT`, `appReviewRequired=true`, `tokenStored=false` | `/api/health.tiktokOAuth` |
| Gemini `configured=true`, `keyPresent=true`, `verifiedLive=false`, `verification=not_attempted` | `/api/health.geminiUsage` |
| Firewall حد 40، مُستهلك 0 | `/api/health.freeTierFirewall` / `/api/ai/firewall` (owner) |
| المنصّات بلا موصل: whatsapp, x, snapchat, threads, google_business (`realConnector=false`) | `engine/social/registry.ts` |

## د) العقل المركزي (المصدر: `/api/health` كتل brain*)

| القيمة | المصدر |
|---|---|
| التسلسل الهرمي `CENTRAL_BRAIN > AGENT_COUNCIL(6) > GOVERNANCE > ACTION_OR_ESCALATION` | `/api/health.brainDecision.hierarchy` |
| `executesExternalActions=false`, `independentDecisionAuthority=false`, `subordinateTo=central-brain-1` | `/api/health.brainDecision` |
| brainRuntime `enabled=true`, `scheduled=true`, `intervalMinutes=15`, `status=NO_NEW_DATA`, آخر دورة `04:18:15Z` | `/api/health.brainRuntime` |
| cognitiveLoop `PERCEIVE→...→LEARN` | `/api/health.cognition.cognitiveLoop` (كود: `engine/brain/cognition/cognitiveLoop.ts`) |
| learningLoop `actions=11, results=11, followUp=11, lessons=0` | `/api/health.cognition` |
| workingMemory `total=0` | `/api/health.cognition.workingMemory` |
| Agent Team `total=1, completed=1, failed=0, memoryWritten=1` | `/api/health.agentTeam` |
| Central Agent `tools=30`, `tasks=14`, `lastStatus=completed`, `lastVerified=true` | `/api/health.centralAgent` |
| المزوّدون `gemini(primary,true)`, `openai(secondary,false)`, `anthropic(advisor,false)` | `/api/health.centralAgent.providers` |
| تفويض YouTube `granted=true, active=true, actions=[reply,publish,schedule,update_video]`, `grantedBy=owner` | `/api/health.youtubeDelegation` |
| watcher `active=true, cadenceMinutes=5, pollCount=1185`, `lastError=NOT_CONNECTED`, `consecutiveErrors=211` | `/api/health.youtubeWatcher` |
| طابور المحتوى `total=2, published=1, awaitingReview=0` | `/api/health.youtubeContent` |
| capabilityMatrix `AVAILABLE=73, NOT_AVAILABLE=55, REQUIRES_REVIEW=2` | `/api/readiness.brain.capabilityStates` |
| knowledgeHealth `verified=0, derived=1, hypothesis=0, unknown=0, humanRequired=0` | `/api/readiness.brain.knowledgeHealth` |
| signalFreshness `total=50, fresh=12, stale=38` | `/api/readiness.brain.signalFreshness` |
| `pendingDecisions=1, blockedActions=1, recommendations=1, experiments=1, strategies=1` | `/api/readiness.brain.*` |
| `platformAgnostic=true, platformsCovered=10, audienceDemographicsAvailable=false` | `/api/readiness.centralBrain` |

## هـ) التعافي (المصدر: `/api/dr/health` + خدمة الاستعادة المستقلة)

| القيمة | المصدر |
|---|---|
| Drive `scope=drive.file`, `authorized=true`, `refreshTokenUsable=true` | `GET /api/dr/health.dr` |
| autoBackup `intervalMinutes=360`, `lastRunResult=backed_up`, آخر نقطة `rp-020`, `runCount=14` | `GET /api/dr/health.dr.autoBackup` |
| CURRENT مرآة `fileCount=373`, `synced=true` | `GET /api/dr/health.dr.currentMirror` |
| خزنة المفاتيح `inventoryCount=40`, `vaultKey=valid` | `GET /api/dr/health.dr.keyVault` |
| مركز الاستعادة `build=owner-auth-1`, `ownerAuth.required=true` | `GET https://gharabi-recovery-center.onrender.com/api/health` |

## هـ) دفعة النشر متعدد المنصات + تقسيم العقل المركزي/العقول الستة (فرع العمل)

| القيمة | المصدر |
|---|---|
| منفّذ نشر مشترك واحد `executePlatformPublish` | `grep -n 'async function executePlatformPublish' server.ts` |
| مسار التوزيع `POST /api/workspace/content/:id/publish` (owner) | `grep -n 'app.post("/api/workspace/content/:id/publish"' server.ts` |
| توزيع متوازٍ + حالة مستقلة لكل منصة | `Promise.allSettled(requested.map(...))` → `post.platformPublishResults` |
| لا نشر بلا `approved` | `post.status !== "approved"` → 409 `APPROVAL_REQUIRED` |
| whitelist العقول الستة (4 أفعال) | `engine/brain/team/executionPolicy.ts` → `SIX_AGENT_ALLOWED_ACTIONS` |
| لا Gemini في أفعال العقول الستة | `sixAgentExecution.geminiUsed=false` في `/api/health` و `/api/readiness` |
| سجل التدقيق الدائم | `engine/brain/team/auditLog.ts` + `control.sixAgentAudit` (محوّل الحالة) |
| اختبارا الانحدار | `engine/tests/publish.multiplatform.test.ts` (25) · `engine/tests/sixagent.execution.test.ts` (41) |

## و) عناصر «قيد الإنجاز» و«غير منجز» — دليل تصنيفها

| العنصر | اللون | الدليل |
|---|---|---|
| sales / control (مالي/دليل عملاء) | برتقالي | الكود موجود في المستودع، لكن `GET /api/sales` و `/api/control/*` تعيد **404 SCOPE_DISABLED** حياً (تم التحقق) |
| عائلات ERP القديمة (inventory/crm/...) | برتقالي | نفس آلية العزل 404، معزولة بالكود |
| engine/brain/{commercial,sales,growth,digital} | برتقالي | `git ls-tree` يُظهرها على 3 فروع فقط (integration/phase-1d-on-central-brain، fix/health-readiness-privacy-leak، fix/recovery-center-owner-auth) — **غير موجودة على main** |
| موصلات WhatsApp/X/Snapchat/Threads/Google Business | أحمر | `realConnector=false` + لا ملف موصل في `engine/social/` |
| اتصال YouTube/Facebook/Instagram/TikTok الحي | أحمر | `connected=false` و `providerVerified=false` في الصحة |
| التحقق الحي من Gemini | أحمر | `verifiedLive=false` |
| التنفيذ الخارجي على YouTube (رد/نشر) | أحمر | `connected=false` → المراقب يسجّل `NOT_CONNECTED`، لا تنفيذ فعلي |
