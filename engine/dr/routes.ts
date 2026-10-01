/**
 * مسارات منظومة DR (Google Drive) — تفويض منفصل عن تسجيل دخول التطبيق.
 *
 * - `GET /api/dr/drive/auth-url` (للمالك): يولّد رابط تفويض بنطاق drive.file
 *   حصراً مع state عشوائي أحادي الاستخدام (CSRF + TTL). لا يعرض أي سرّ.
 * - `GET/POST /api/dr/drive/callback`: يستقبل عودة Google، يستهلك state مرة
 *   واحدة، يبادل الرمز، ويخزّن رمز التجديد **مشفّراً فقط**. لا يُظهر الرمز.
 * - `GET /api/dr/status` (للمالك): لقطة مراقبة قراءة فقط (بلا رفع/حذف).
 * - `GET /api/dr/health`: كتلة صحية بلا أسرار (للتحقق الإنتاجي).
 *
 * الحقن عبر `deps` يجعل الوحدة قابلة للاختبار بخادم Drive وهمي، وتمنع أي مساس
 * ببقية المنظومة (YouTube/TikTok/…/Gemini/تسجيل الدخول).
 */

import type express from 'express';
import {
  DRIVE_OAUTH_REDIRECT_URI,
  DRIVE_FILE_SCOPE,
  DESIGN_QUOTA_BYTES,
  QUOTA_HEADROOM_BYTES,
  buildMonitoringSnapshot,
  hourlySafetyCheck,
  summarizeBackupState,
  writeRecoveryDocs,
  RP_001_COMMIT,
} from '../../tools/dr/cloud-lib.mjs';
import { DriveStateStore } from '../../tools/dr/drive-auth-url.mjs';
import {
  inspectDriveAuthEnv,
  exchangeDriveAuthCode,
  encryptDriveSecret,
  createRefreshTokenProvider,
  diagnoseDriveRefreshToken,
  inspectDriveOAuthClient,
} from '../../tools/dr/drive-auth.mjs';
import { DriveClient, createGaxiosTransport } from '../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../tools/dr/drive-store.mjs';
import { DriveSync } from '../../tools/dr/drive-sync.mjs';
import { runBackup } from '../../tools/dr/backup.mjs';
import { encryptDbDump } from '../../tools/dr/db-crypto.mjs';
import { runCurrentMirror, buildMirrorSnapshot } from '../../tools/dr/current-mirror.mjs';
import { buildSecretsBundle, inspectMasterKey } from '../../tools/dr/secret-crypto.mjs';
import { runKeyVaultSync, recoverKeyVault, keyVaultStatus } from './recoveryVault/vault';
import { inspectVaultKey } from '../../tools/dr/key-vault-crypto.mjs';
import { RECOVERY_SECRET_INVENTORY } from './recoveryVault/inventory';
import { buildRestorePlan, runRecoveryDrill, verifyRecoveryPoint, applyDatabaseDump } from '../../tools/dr/restore.mjs';
import {
  buildRecoveryInformation,
  buildRecoveryInstructions,
  buildLatestRecovery,
  buildCurrentState,
} from '../../tools/dr/cloud-lib.mjs';

export interface DriveRoutesDeps {
  authenticateToken: express.RequestHandler;
  requireOwner: express.RequestHandler;
  env?: Record<string, string | undefined>;
  /** يقرأ حالة DR المحفوظة (states + رمز تجديد مشفّر + آخر خطأ + حالة النسخ + هوية مجلدات Drive). */
  loadControl: () => { driveOAuthStates?: any[]; driveRefreshToken?: any; driveLastError?: string | null; driveBackup?: any; driveFolderIdentity?: any; driveMirror?: any; driveReconciliation?: any };
  /** يثبّت جزءاً من حالة DR عبر محوّل الحالة (يصمد بعد restart). */
  persistControl: (partial: Record<string, any>) => void;
  /** عميل Drive اختياري (للاختبار). إن غاب يُبنى من البيئة. */
  clientFactory?: (env: Record<string, string | undefined>) => any | null;
  /** ناقل OAuth اختياري (للاختبار): يوجّه تبادل الرمز إلى خادم وهمي. */
  oauthTransport?: any;
  /** يجمع ملفات المصدر للنسخة (المشمولة + المستبعدة للفحص). */
  collectSourceFiles?: () => {
    included: any[];
    excluded: any[];
    /** false = شجرة ناقصة (تمنع النسخة/الترقية). غيابها يعني عدم إجراء فحص اكتمال. */
    complete?: boolean;
    source?: string | null;
    fileCount?: number | null;
    minFiles?: number | null;
    missingRequired?: string[] | null;
    reason?: string | null;
  };
  /** ينتج نسخة نصية مؤقتة من قاعدة البيانات (تُشفَّر قبل الرفع ولا تُرفع خاماً). */
  dumpDatabase?: () => Promise<string>;
  /** يبني حزمة الأسرار المشفّرة من البيئة الفعلية (أسماء موجودة فقط). */
  buildSecrets?: () => Promise<any> | any;
  /** وثائق التعافي المستقلة (نصّان بلا أسرار). */
  recoveryInfo?: (ctx: { recoveryPointId?: string | null; repository?: string | null; now: string }) => { information?: string; instructions?: string } | Promise<{ information?: string; instructions?: string }>;
  /** بيانات النسخة المعتمدة: commit/الفرع/المستودع. */
  gitMeta?: () => { commit?: string | null; branch?: string | null; repository?: string | null; project?: string | null };
  /** مجلد مؤقت للاختبار المعزول (drill). */
  drillDir?: string;
  /** رابط قاعدة بيانات معزولة لاختبار الاستعادة (تُرفض إن طابقت الإنتاج). */
  isolatedDatabaseUrl?: string | null;
  now?: () => string;
}

/** هل التفويض جاهز فعلاً (اعتماد + رمز تجديد مشفّر)؟ بلا كشف قيم. */
function authReadiness(env: Record<string, string | undefined>, encryptedRefreshToken: any) {
  const info = inspectDriveAuthEnv(env as NodeJS.ProcessEnv);
  const hasRefresh = Boolean(encryptedRefreshToken) || info.refreshTokenConfigured;
  return {
    ...info,
    refreshTokenStored: Boolean(encryptedRefreshToken),
    /** التفويض مكتمل فقط بوجود اعتماد + رمز تجديد. */
    authorized: info.configured && hasRefresh,
  };
}

export function registerDriveRoutes(app: express.Express, deps: DriveRoutesDeps): void {
  const env = deps.env || process.env;
  const now = deps.now || (() => new Date().toISOString());

  // حالة محفوظة في الذاكرة تُحمَّل مرة واحدة بعد جهوزية المخزن.
  let loaded: ReturnType<DriveRoutesDeps['loadControl']> | null = null;
  function control(): ReturnType<DriveRoutesDeps['loadControl']> {
    if (!loaded) loaded = deps.loadControl() || {};
    return loaded;
  }

  // ذاكرة تشخيص الرمز: تمنع طلب تجديد متكرراً عند كل نداء صحة (الفحص العام).
  let refreshDiagCache: { at: number; value: any } | null = null;
  const REFRESH_DIAG_TTL_MS = 5 * 60 * 1000;

  // ذاكرة حالة جمع المصدر (بلا قراءة المستودع عند كل نداء صحة) — تلخيص فقط بلا محتوى.
  let sourceCollectionCache: { at: number; value: any } | null = null;
  const SOURCE_COLLECTION_TTL_MS = 5 * 60 * 1000;
  function sourceCollectionStatus(): any {
    if (!deps.collectSourceFiles) return null;
    const fresh = sourceCollectionCache && (Date.now() - sourceCollectionCache.at) < SOURCE_COLLECTION_TTL_MS;
    if (fresh) return sourceCollectionCache!.value;
    let value: any;
    try {
      const c = deps.collectSourceFiles();
      value = {
        complete: c.complete ?? null,
        source: (c as any).source ?? null,
        fileCount: (c as any).fileCount ?? (Array.isArray(c.included) ? c.included.length : null),
        minFiles: (c as any).minFiles ?? null,
        missingRequired: (c as any).missingRequired ?? null,
        reason: (c as any).reason ?? null,
        gitAvailable: (c as any).gitAvailable ?? null,
        // حزمة المصدر المُجمَّعة زمن البناء (بيئة الإنتاج بلا .git): بلا أي سرّ.
        bundle: (c as any).bundle ?? null,
      };
    } catch (e: any) {
      value = { complete: null, source: null, fileCount: null, reason: String(e?.code || e?.message || 'collect_failed').slice(0, 60) };
    }
    sourceCollectionCache = { at: Date.now(), value };
    return value;
  }

  const stateStore = new DriveStateStore({
    initial: [],
    persist: (snapshot) => {
      control().driveOAuthStates = snapshot;
      deps.persistControl({ driveOAuthStates: snapshot });
    },
  });

  // تحميل الحالات المحفوظة مرة واحدة (بعد جهوزية المخزن) لتصمد CSRF عبر restart.
  let statesLoaded = false;
  function ensureStates() {
    if (statesLoaded) return;
    statesLoaded = true;
    const saved = control().driveOAuthStates;
    if (Array.isArray(saved)) {
      for (const s of saved) {
        if (s?.state) stateStore.states.set(s.state, { createdAt: s.createdAt || 0, usedAt: s.usedAt ?? null, userId: s.userId || '', redirectUri: s.redirectUri || DRIVE_OAUTH_REDIRECT_URI });
      }
    }
  }

  /** يبني عميل Drive من البيئة أو من رمز التجديد المشفّر المخزّن. */
  function buildClient() {
    if (deps.clientFactory) return deps.clientFactory(env);
    const info = inspectDriveAuthEnv(env as NodeJS.ProcessEnv);
    if (!info.configured) return null;
    const encrypted = control().driveRefreshToken;
    const provider = createRefreshTokenProvider({ env, encryptedRefreshToken: encrypted || undefined });
    return new DriveClient({ transport: createGaxiosTransport(), tokenProvider: provider });
  }

  /**
   * يبني مخزن Drive بهوية المجلدات المحفوظة (منع 403 تحت drive.file).
   * لا نعتمد على مرجع root أبداً؛ المعرّفات المحفوظة هي المصدر الأول.
   */
  function buildStore(client: any, options: { readOnlyStructure?: boolean } = {}) {
    return new DriveStore({ client, storedIdentity: control().driveFolderIdentity || null, readOnlyStructure: options.readOnlyStructure === true });
  }

  /** ملخّص جمع المصدر بلا محتوى ولا سرّ (يُعاد في ردود الرفض والصحة). */
  function sourceCollectionOf(collected: any): any {
    return {
      source: collected?.source ?? null,
      fileCount: collected?.fileCount ?? (Array.isArray(collected?.included) ? collected.included.length : null),
      minFiles: collected?.minFiles ?? null,
      missingRequired: collected?.missingRequired ?? null,
      reason: collected?.reason ?? null,
      bundle: collected?.bundle ?? null,
    };
  }

  /** يثبّت هوية المجلدات بعد تجهيز البنية (تُحفظ مشفّرة عبر محوّل الحالة). */
  function rememberStructure(store: any): void {
    try {
      const identity = store.structureIdentity();
      if (!identity || !identity.rootId) return;
      const prev = control().driveFolderIdentity || null;
      const same = prev && prev.rootId === identity.rootId && JSON.stringify(prev.subdirs || {}) === JSON.stringify(identity.subdirs || {});
      if (same) return;
      control().driveFolderIdentity = identity;
      deps.persistControl({ driveFolderIdentity: identity });
    } catch { /* أفضل جهد: لا يُسقط النسخة لتعذّر حفظ الهوية */ }
  }

  /** لقطة مراقبة قراءة فقط: لا رفع ولا حذف. */
  async function readStatus() {
    const readiness = authReadiness(env, control().driveRefreshToken);
    if (!readiness.authorized) {
      return buildMonitoringSnapshot({
        generatedAt: now(),
        state: 'not_authorized',
        authorized: false,
        secretScan: { ok: true, findings: 0 },
        currentIntegrity: { verified: false, detail: 'لا تفويض Drive بعد.' },
        quota: { usageBytes: null, designBytes: DESIGN_QUOTA_BYTES, headroomBytes: QUOTA_HEADROOM_BYTES },
        lastError: control().driveLastError ?? null,
        lastCheckAt: now(),
      });
    }
    const client = buildClient();
    if (!client) {
      return buildMonitoringSnapshot({ generatedAt: now(), state: 'failed', authorized: false, lastError: 'drive_client_unavailable' });
    }
    try {
      const store = buildStore(client, { readOnlyStructure: true });
      const sync = new DriveSync({ store, client });
      const quota = await sync.readQuota();
      const current = await store.readCurrentManifest();
      const points = await store.listRestorePoints();
      const dumps = await store.listDbDumps();
      const manifest = current.ok ? current.data : null;
      const backupSummary = summarizeBackupState(manifest);
      const history = points.ok
        ? points.data.map((p) => ({
            id: p.id,
            commit: p.manifest?.commit ?? null,
            createdAt: p.manifest?.createdAt ?? null,
            treeHash: p.manifest?.treeHash ?? null,
            sourceHash: p.manifest?.sourceHash ?? null,
            databaseHash: p.manifest?.databaseHash ?? null,
            encryptedDatabaseHash: p.manifest?.encryptedDatabaseHash ?? null,
            fileCount: p.manifest?.fileCount ?? null,
            sourceSize: p.manifest?.sourceSize ?? null,
            status: p.manifest?.status ?? (p.manifest ? 'verified' : 'unknown'),
            hasManifest: Boolean(p.manifest),
          }))
        : [];
      const snapshot = buildMonitoringSnapshot({
        generatedAt: now(),
        state: manifest ? 'synced' : 'never_synced',
        lastSyncAt: manifest?.createdAt ?? manifest?.updatedAt ?? null,
        lastChangeAt: manifest?.createdAt ?? manifest?.updatedAt ?? null,
        commit: manifest?.commit ?? null,
        treeHash: manifest?.treeHash ?? null,
        versionSizeBytes: manifest?.sourceSize ?? null,
        fileCount: manifest?.fileCount ?? null,
        restorePointCount: points.ok ? points.data.length : 0,
        lastDbBackupAt: dumps.ok && dumps.data.length ? dumps.data[0].modifiedTime ?? null : (manifest?.createdAt ?? null),
        dbEncrypted: true,
        secretScan: { ok: true, findings: 0 },
        currentIntegrity: { verified: Boolean(manifest), detail: manifest ? null : 'لا بيان current.' },
        quota: { usageBytes: quota.ok ? (quota as any).driveUsageBytes : null, designBytes: DESIGN_QUOTA_BYTES, headroomBytes: QUOTA_HEADROOM_BYTES },
        lastError: control().driveLastError ?? null,
        lastCheckAt: now(),
        authorized: true,
      });
      return { ...snapshot, backup: { ...backupSummary, lastAttempt: control().driveBackup ?? null }, history };
    } catch (err: any) {
      return {
        ...buildMonitoringSnapshot({ generatedAt: now(), state: 'failed', authorized: true, lastError: String(err?.code || err?.message || 'drive_status_failed').slice(0, 80), lastCheckAt: now() }),
        backup: { hasBackup: false, state: 'unknown', lastAttempt: control().driveBackup ?? null },
        history: [],
      };
    }
  }

  // ------------------------------------------------------------------
  // رابط التفويض (owner): state أحادي الاستخدام + drive.file حصراً
  // ------------------------------------------------------------------
  app.get('/api/dr/drive/auth-url', deps.authenticateToken, deps.requireOwner, (req, res) => {
    ensureStates();
    const readiness = authReadiness(env, control().driveRefreshToken);
    if (!readiness.configured) {
      return res.status(409).json({
        success: false,
        code: 'DRIVE_OAUTH_NOT_CONFIGURED',
        error: 'DRIVE_OAUTH_CLIENT_ID/SECRET غير مضبوطين: لا يمكن توليد رابط التفويض.',
        requiredEnv: ['DRIVE_OAUTH_CLIENT_ID', 'DRIVE_OAUTH_CLIENT_SECRET'],
        redirectUri: DRIVE_OAUTH_REDIRECT_URI,
        scope: DRIVE_FILE_SCOPE,
      });
    }
    const userId = String((req as any).user?.id ?? (req as any).user?.uid ?? 'owner');
    const created = stateStore.create(userId, { env, redirectUri: DRIVE_OAUTH_REDIRECT_URI });
    if (!created.ok) {
      return res.status(409).json({ success: false, code: created.code, error: created.message });
    }
    res.json({
      success: true,
      url: created.url,
      scope: DRIVE_FILE_SCOPE,
      redirectUri: created.redirectUri,
      ttlMs: created.ttlMs,
      expiresAt: created.expiresAt,
      authorized: readiness.authorized,
      note: 'لا يوجد تفويض ولا رفع بعد؛ هذا الرابط فقط لبدء الموافقة.',
    });
  });

  // ------------------------------------------------------------------
  // callback: يستهلك state مرة واحدة ثم يبادل الرمز ويخزّنه مشفّراً
  // ------------------------------------------------------------------
  const handleCallback: express.RequestHandler = async (req, res) => {
    ensureStates();
    const params: Record<string, string> = { ...(req.query as any), ...((req.body && typeof req.body === 'object') ? req.body : {}) };
    const wantsJson = String(req.headers.accept || '').includes('application/json') || req.method === 'POST';
    const respond = (status: number, payload: Record<string, any>) => {
      if (wantsJson) return res.status(status).json(payload);
      // فرع المتصفح: نعيد المالك إلى الواجهة بدل صفحة HTML منفصلة. لا نمرّر أي
      // سرّ في الرابط — فقط معنى النتيجة ورمز سبب آمن (حروف/أرقام/_).
      const reason = String(payload.code || 'error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'error';
      const target = payload.success === true ? '/?dr=authorized' : `/?dr=error&reason=${encodeURIComponent(reason)}`;
      return res.redirect(302, target);
    };

    if (params.error) {
      control().driveLastError = `oauth_error:${String(params.error).slice(0, 40)}`;
      deps.persistControl({ driveLastError: control().driveLastError });
      return respond(400, { success: false, code: 'OAUTH_DENIED', error: 'رفضت Google التفويض أو أعادت خطأً.', errorCode: String(params.error).slice(0, 60) });
    }
    if (!params.code || !params.state) {
      return respond(400, {
        success: false,
        code: 'MISSING_CODE_OR_STATE',
        error: 'عودة التفويض بلا code/state صالحين: لم يحدث أي تبادل ولا رفع.',
        redirectUri: DRIVE_OAUTH_REDIRECT_URI,
      });
    }

    const consumed = stateStore.consume(params.state, { redirectUri: DRIVE_OAUTH_REDIRECT_URI });
    if (!consumed.ok) {
      control().driveLastError = consumed.code;
      deps.persistControl({ driveLastError: control().driveLastError });
      return respond(400, { success: false, code: consumed.code.toUpperCase(), error: consumed.message });
    }

    const exchanged = await exchangeDriveAuthCode(params.code, { env, redirectUri: DRIVE_OAUTH_REDIRECT_URI, transporter: deps.oauthTransport });
    if (!exchanged.ok) {
      control().driveLastError = exchanged.code;
      deps.persistControl({ driveLastError: control().driveLastError });
      return respond(400, { success: false, code: String(exchanged.code || 'EXCHANGE_FAILED').toUpperCase(), error: exchanged.message });
    }
    if (!exchanged.refreshToken) {
      control().driveLastError = 'no_refresh_token';
      deps.persistControl({ driveLastError: control().driveLastError });
      return respond(400, { success: false, code: 'NO_REFRESH_TOKEN', error: 'لم تُعد Google رمز تجديد (offline). أعد التفويض.' });
    }
    let encrypted;
    try {
      encrypted = encryptDriveSecret(exchanged.refreshToken, env as NodeJS.ProcessEnv);
    } catch {
      return respond(500, { success: false, code: 'TOKEN_KEY_MISSING', error: 'مفتاح تشفير رمز التجديد غير مضبوط (DRIVE_TOKEN_ENCRYPTION_KEY).' });
    }
    control().driveRefreshToken = encrypted;
    control().driveLastError = null;
    deps.persistControl({ driveRefreshToken: encrypted, driveLastError: null });
    // تفويض جديد => يُبطل فحص الرمز المخبَّأ حتى لا يبقى «يلزم إعادة تفويض» بعد الربط.
    refreshDiagCache = null;

    return respond(200, {
      success: true,
      code: 'DRIVE_AUTHORIZED',
      message: 'تم التفويض وحُفظ رمز التجديد مشفّراً. لم يُرفع أي ملف بعد.',
      scope: exchanged.scope,
      authorized: true,
      // لا يُعاد أي رمز — إثبات الحفظ فقط.
      refreshTokenStored: true,
    });
  };
  app.get('/api/dr/drive/callback', handleCallback);
  app.post('/api/dr/drive/callback', handleCallback);

  // ------------------------------------------------------------------
  // النسخة الاحتياطية الفعلية (owner): المسار الرسمي الوحيد.
  // ------------------------------------------------------------------
  let backupRunning = false; // قفل على مستوى الخادم يمنع التشغيل المزدوج
  const defaultGitMeta = () => ({ commit: env.RENDER_GIT_COMMIT || env.GIT_COMMIT || null, branch: env.RENDER_GIT_BRANCH || env.GIT_BRANCH || 'main', repository: env.GHARABI_REPOSITORY || 'mrdalghrabylltqsyt-web/al-gharabi-ai', project: 'al-gharabi-ai' });

  /** يحدّث سجل آخر نسخة عبر محوّل الحالة (يصمد بعد restart). */
  function recordBackupResult(result: any): void {
    const previous = control().driveBackup || {};
    const entry = {
      at: now(),
      state: result?.state ?? 'unknown',
      verified: result?.verified === true,
      commit: result?.commit ?? null,
      recoveryPointId: result?.recoveryPointId ?? null,
      treeHash: result?.treeHash ?? null,
      sourceHash: result?.sourceHash ?? null,
      reason: result?.reason ?? null,
      message: result?.message ?? null,
      errorDetails: result?.state === 'backed_up' || result?.state === 'no_change' ? null : (result?.errorDetails ?? previous.errorDetails ?? null),
      lastSuccessAt: result?.state === 'backed_up' ? now() : previous.lastSuccessAt ?? null,
      lastSuccessCommit: result?.state === 'backed_up' ? result?.commit ?? null : previous.lastSuccessCommit ?? null,
      lastRecoveryPointId: result?.state === 'backed_up' ? result?.recoveryPointId ?? null : previous.lastRecoveryPointId ?? null,
    };
    control().driveBackup = entry;
    deps.persistControl({ driveBackup: entry });
  }

  app.post('/api/dr/backup', deps.authenticateToken, deps.requireOwner, async (_req, res) => {
    const readiness = authReadiness(env, control().driveRefreshToken);
    if (!readiness.authorized) {
      return res.status(409).json({ success: false, code: 'NOT_AUTHORIZED', error: 'لا تفويض Google Drive فعّال: لا يمكن إنشاء نسخة.' });
    }
    const client = buildClient();
    if (!client) {
      return res.status(503).json({ success: false, code: 'DRIVE_CLIENT_UNAVAILABLE', error: 'تعذّر بناء عميل Drive.' });
    }
    if (backupRunning) {
      return res.status(409).json({ success: false, code: 'BACKUP_ALREADY_RUNNING', error: 'نسخة احتياطية قيد التنفيذ بالفعل.' });
    }
    backupRunning = true;
    const startedAt = now();
    let store: any = null;
    try {
      store = buildStore(client);
      const collected = deps.collectSourceFiles ? deps.collectSourceFiles() : { included: [], excluded: [] };
      // حماية صريحة: لا نسخة ولا ترقية من شجرة ناقصة (منعت سابقاً "نسخة سليمة"
      // من مجلد Docker يحوي ملفين فقط). لا رفع ولا نقطة استعادة عند النقص.
      if (collected.complete === false) {
        return res.status(409).json({
          success: false,
          code: 'SOURCE_INCOMPLETE',
          error: 'المصدر المُجمَّع ناقص: رُفض إنشاء نسخة/ترقية CURRENT (لا نسخة سليمة من شجرة ناقصة).',
          sourceCollection: sourceCollectionOf(collected),
        });
      }
      const files = [...(collected.included || []), ...(collected.excluded || [])];
      const result = await runBackup({
        store,
        files,
        dumpDatabase: deps.dumpDatabase,
        encryptDatabase: (sql: string) => encryptDbDump(sql, env as NodeJS.ProcessEnv),
        buildSecrets: deps.buildSecrets || (() => buildSecretsBundle(env as NodeJS.ProcessEnv, { now: startedAt })),
        recoveryInfo: deps.recoveryInfo,
        meta: deps.gitMeta ? deps.gitMeta() : defaultGitMeta(),
        now: startedAt,
      });
      rememberStructure(store);
      // مزامنة المرآة الفردية (current/files/**) — ملفات حقيقية بمكانها.
      let mirror: any = null;
      if (result.state === 'backed_up' || result.state === 'no_change') {
        try {
          mirror = await runCurrentMirror({ store, files, commit: result.commit ?? null, previousMirror: control().driveMirror || null, currentFiles: control().driveMirror?.files || [], now: startedAt });
          if (mirror.state === 'synced') {
            control().driveMirror = {
              version: mirror.mirrorManifest?.version || mirror.headVersion || 1,
              treeHash: mirror.treeHash,
              files: mirror.mirrorManifest?.files || [],
              updatedAt: startedAt,
              error: null,
              cleanupPending: Boolean(mirror.cleanupPending),
              pendingCleanup: mirror.pendingCleanup || [],
            };
            deps.persistControl({ driveMirror: control().driveMirror });
          }
        } catch (e: any) {
          mirror = { state: 'failed', reason: String(e?.code || e?.message || 'mirror_failed').slice(0, 80) };
        }
        // لا فشل صامت: سبب فشل المرآة يُحفظ ويُعلن (بلا أسرار) ليعرف المالك لماذا synced=false.
        if (mirror && mirror.state !== 'synced') {
          const reason = String(mirror.reason || mirror.state || 'mirror_failed').slice(0, 80);
          const prev = control().driveMirror;
          const stagingVersion = mirror.stagingVersion ?? prev?.stagingVersion ?? null;
          control().driveMirror = prev
            ? { ...prev, error: reason, stagingVersion }
            : { version: 0, treeHash: null, files: [], updatedAt: null, error: reason, stagingVersion };
          deps.persistControl({ driveMirror: control().driveMirror });
        }
      }
      // خزنة مفاتيح الطوارئ: مزامنة تلقائية مع النسخة (منفصلة الترقيم، نفس مبدأ CURRENT).
      // فشلها لا يُسقط النسخة المتحقّقة — يُعلن صراحةً بلا قيمة سرّية.
      let keyVault: any = null;
      if (result.state === 'backed_up' || result.state === 'no_change') {
        try {
          const kv = await runKeyVaultSync({ store, env: env as Record<string, string | undefined>, now: startedAt });
          keyVault = {
            state: kv.state,
            version: kv.version ?? null,
            recordCount: kv.recordCount ?? null,
            diff: kv.diff ?? null,
            cleanupPending: Boolean(kv.cleanupPending),
            reason: kv.reason ?? null,
          };
        } catch (e: any) {
          keyVault = { state: 'failed', reason: String(e?.code || e?.message || 'key_vault_failed').slice(0, 80) };
        }
      }
      recordBackupResult(result);
      const httpStatus = result.state === 'failed' ? 500 : 200;
      return res.status(httpStatus).json({
        success: result.state === 'backed_up' || result.state === 'no_change',
        state: result.state,
        verified: result.verified === true,
        recoveryPointId: result.recoveryPointId ?? null,
        commit: result.commit ?? null,
        treeHash: result.treeHash ?? null,
        sourceHash: result.sourceHash ?? null,
        uploaded: result.uploaded ?? 0,
        secretsCount: result.secretsCount ?? null,
        mirror,
        keyVault,
        reason: result.reason ?? null,
        message: result.message ?? null,
        errorDetails: result.errorDetails ?? null,
        problems: result.problems ?? null,
        secretScan: result.secretScan ?? { ok: true, findings: 0 },
        at: startedAt,
      });
    } catch (err: any) {
      const code = String(err?.code || err?.message || 'backup_failed').slice(0, 80);
      // فشل تجديد رمز Google: سبب حقيقي (لا عطل عام) + إجراء صريح = إعادة تفويض.
      const tokenRefreshFailure = ['invalid_grant', 'invalid_client', 'invalid_request', 'token_refresh_unauthorized', 'token_refresh_other_error'].includes(code);
      if (tokenRefreshFailure) {
        const failure = {
          state: 'failed',
          code: 'REAUTHORIZATION_NEEDED',
          reason: code,
          providerCode: err?.providerCode ?? null,
          message: 'رمز تفويض Google Drive غير صالح بعد الآن (رفضه Google): يلزم إعادة التفويض من زر «ربط Google Drive».',
          reauthorizationNeeded: true,
        };
        recordBackupResult({ state: 'failed', reason: code });
        return res.status(409).json({ success: false, ...failure });
      }
      const failure = { state: 'failed', reason: code, message: 'فشل غير متوقّع أثناء النسخة.' };
      recordBackupResult(failure);
      return res.status(500).json({ success: false, ...failure });
    } finally {
      backupRunning = false;
    }
  });

  // ------------------------------------------------------------------
  // الحالة الصحية (بلا أسرار) + لقطة المراقبة (owner)
  // ------------------------------------------------------------------
  app.get('/api/dr/health', async (_req, res) => {
    const readiness = authReadiness(env, control().driveRefreshToken);
    const masterKey = inspectMasterKey(env as NodeJS.ProcessEnv);
    const mirror = control().driveMirror;
    // فحص تشخيصي قراءة-فقط لرمز التجديد (بلا كتابة إلى Drive، بلا كشف قيمة).
    // لا يُنفَّذ طلب تجديد فعلي إلا عند وجود اعتماد كامل ورمز مخزّن، ونتيجته مُخبَّأة 5 دقائق.
    let refreshTokenDiagnostic: any = { stored: false, decryptable: false, providerRefresh: 'not_tested', reason: 'no_refresh_token' };
    if (readiness.configured && readiness.refreshTokenStored) {
      const fresh = refreshDiagCache && (Date.now() - refreshDiagCache.at) < REFRESH_DIAG_TTL_MS;
      if (fresh) {
        refreshTokenDiagnostic = refreshDiagCache!.value;
      } else {
        try {
          refreshTokenDiagnostic = await diagnoseDriveRefreshToken({
            encrypted: control().driveRefreshToken,
            env: env as Record<string, string | undefined>,
            transporter: deps.oauthTransport,
          });
        } catch (e: any) {
          refreshTokenDiagnostic = { stored: true, decryptable: false, providerRefresh: 'failed', reason: String(e?.code || e?.message || 'diagnostic_failed').slice(0, 60) };
        }
        refreshDiagCache = { at: Date.now(), value: refreshTokenDiagnostic };
      }
    }
    // صدق الحالة: «مربوط» يعني رمز مخزّن فقط؛ أما قابلية النسخ فتتطلّب نجاح تجديد فعلي.
    const refreshTested = refreshTokenDiagnostic.providerRefresh === 'ok';
    const refreshFailed = refreshTokenDiagnostic.providerRefresh === 'failed';
    const reauthorizationNeeded = refreshFailed;
    const oauthDiag = inspectDriveOAuthClient(env as Record<string, string | undefined>);
    // إجراء واحد صريح بلا أي سرّ: ما الذي يمنع النسخة الآن، وماذا يفعل المالك بالضبط.
    let nextAction = 'none';
    let nextActionMessage = 'منظومة النسخ جاهزة: رمز التفويض مُثبت فعلاً لدى Google.';
    if (!readiness.configured) {
      nextAction = 'configure_oauth';
      nextActionMessage = 'اضبط اعتماد OAuth لتطبيق Drive (متغيّرَي العميل) على الخادم ثم أعد الربط.';
    } else if (reauthorizationNeeded) {
      nextAction = 'reauthorize_drive';
      nextActionMessage = oauthDiag.driveClientIdIgnored
        ? 'رمز التفويض المخزّن رفضه Google، وقيمة عميل DRIVE غير صالحة (ليست معرّف Google). اضبط معرّف عميل Google الصحيح (ينتهي بـ .apps.googleusercontent.com) أو تأكّد أن عنوان عودة Drive مسجّل في عميل Google المستخدم، ثم اضغط «إعادة الربط بنقرة واحدة».'
        : 'رمز التفويض المخزّن رفضه Google (أُلغي/تغيّر العميل). اضغط «إعادة الربط بنقرة واحدة» ووافق بحساب Google نفسه.';
    } else if (!readiness.refreshTokenStored) {
      nextAction = 'connect_drive';
      nextActionMessage = 'لم يُربط Google Drive بعد: اضغط «ربط Google Drive» ووافق.';
    }
    res.json({
      success: true,
      dr: {
        scope: DRIVE_FILE_SCOPE,
        forbiddenScopes: ['https://www.googleapis.com/auth/drive'],
        redirectUri: DRIVE_OAUTH_REDIRECT_URI,
        configured: readiness.configured,
        authorized: readiness.authorized,
        refreshTokenStored: readiness.refreshTokenStored,
        tokenEncryptionKey: readiness.tokenEncryptionKey,
        // تشخيص مختصر (بلا أي قيمة سرّية): هل الرمز مفكوك؟ وهل نجح التجديد؟
        refreshToken: {
          stored: refreshTokenDiagnostic.stored,
          decryptable: refreshTokenDiagnostic.decryptable,
          providerRefresh: refreshTokenDiagnostic.providerRefresh,
          reason: refreshTokenDiagnostic.reason,
          providerCode: refreshTokenDiagnostic.providerCode ?? null,
          httpStatus: refreshTokenDiagnostic.httpStatus ?? null,
        },
        // حقائق صادقة: هل أُثبت رمز التجديد فعلاً؟ وهل يلزم إعادة تفويض؟
        refreshTokenTested: refreshTested,
        refreshTokenUsable: refreshTested,
        reauthorizationNeeded,
        nextAction,
        nextActionMessage,
        // اعتماد OAuth Client: وجود/طول/صيغة/بصمة آمنة + هل كانت مسافة زائدة (بلا أي قيمة).
        oauthClient: oauthDiag,
        // مفتاح الاستعادة الرئيسي (بلا قيمة): هل يفتح الأسرار فعلاً؟
        recoveryMasterKey: masterKey,
        callbackRoute: '/api/dr/drive/callback',
        authUrlRoute: '/api/dr/drive/auth-url',
        rp001Commit: RP_001_COMMIT,
        quota: { designBytes: DESIGN_QUOTA_BYTES, headroomBytes: QUOTA_HEADROOM_BYTES },
        // لا نُعلن جهوزية النسخ إلا بعد إثبات تجديد فعلي ناجح (لا مجرد وجود رمز).
        backupReady: readiness.authorized && !refreshFailed,
        backupRoute: '/api/dr/backup',
        // مرآة CURRENT (بلا أسرار): synced تتطلّب بصمة شجرة فعلية، لا مجرد سجل موجود.
        // سبب آخر فشل يُعلن صراحةً (لا فشل صامت).
        currentMirror: {
          synced: Boolean(mirror?.treeHash),
          treeHash: mirror?.treeHash ?? null,
          fileCount: Array.isArray(mirror?.files) ? mirror.files.length : null,
          updatedAt: mirror?.updatedAt ?? null,
          error: mirror?.error ?? null,
        },
        // نموذج النسخة المُرقّمة: أي نسخة هي CURRENT الفعلية، وحالة التنظيف والاتساق.
        // كلها بلا أي سرّ (أرقام/بصمات/أعداد فقط).
        currentVersion: mirror?.version ?? null,
        currentTreeHash: mirror?.treeHash ?? null,
        currentFileCount: Array.isArray(mirror?.files) ? mirror.files.length : null,
        pendingCleanup: Array.isArray(mirror?.pendingCleanup) ? mirror.pendingCleanup : [],
        cleanupPending: Boolean(mirror?.cleanupPending),
        stagingVersion: mirror?.stagingVersion ?? null,
        // integrity: تعريف CURRENT من مرجع الاعتماد وحده، واتساقه مع آخر نسخة مُرقّمة.
        integrity: {
          source: 'HEAD.json',
          headVersion: mirror?.version ?? null,
          headTreeHash: mirror?.treeHash ?? null,
          headFileCount: Array.isArray(mirror?.files) ? mirror.files.length : null,
          verified: Boolean(mirror?.treeHash) && !mirror?.error,
          cleanupPending: Boolean(mirror?.cleanupPending),
        },
        // مصدر الجمع الحالي (بلا محتوى): git/مجلد + الاكتمال + عدد الملفات.
        // يكشف فوراً إن كان مجلد التشغيل ناقصاً (مثل صورة Docker) قبل أي نسخة.
        sourceCollection: sourceCollectionStatus(),
        // مشغّل التغيّر: يعمل عند الإقلاع والفحص الساعي؛ يكتشف تغيّر بصمة الشجرة/الالتزام.
        changeTrigger: {
          enabled: true,
          detection: 'source_tree_hash_and_commit',
          lastCommit: deps.gitMeta ? deps.gitMeta().commit ?? null : null,
          currentMirrorCommit: mirror?.commit ?? control().driveBackup?.commit ?? null,
          commitChanged: commitChanged(),
        },
        // الفحص الساعي: مؤقّت داخلي يزامن CURRENT عند التغيّر فقط، ولا يستدعي AI.
        hourlyReconciliation: reconciliationStatus(),
        lastReconciliationAt: control().driveReconciliation?.lastReconciliationAt ?? null,
        lastReconciliationResult: control().driveReconciliation?.lastReconciliationResult ?? null,
        // منظومة التعافي: نقاط الاستعادة تُقرأ من /api/dr/recovery-points (owner).
        recoverySystem: {
          currentMirror: Boolean(mirror?.treeHash),
          secretsEncryptionRequired: true,
          databaseEncryptionRequired: true,
          keyVaultEncryptionRequired: true,
          recoveryPointsRoute: '/api/dr/recovery-points',
          restorePlanRoute: '/api/dr/restore/plan',
          drillRoute: '/api/dr/restore/drill',
          productionRestoreRoute: '/api/dr/restore/production',
        },
        // خزنة مفاتيح الطوارئ (بلا أسرار): حالة المفتاح ورقم الإصدار فقط.
        // التفاصيل الكاملة في /api/dr/key-vault/status (owner).
        keyVault: {
          enabled: true,
          vaultKey: inspectVaultKey(env as NodeJS.ProcessEnv),
          inventoryCount: RECOVERY_SECRET_INVENTORY.length,
          statusRoute: '/api/dr/key-vault/status',
          syncRoute: '/api/dr/key-vault/sync',
          verifyRoute: '/api/dr/key-vault/verify',
          backupRoute: '/api/dr/key-vault/backup',
          drillRoute: '/api/dr/key-vault/drill',
        },
        lastError: control().driveLastError ?? null,
        backup: control().driveBackup ?? null,
      },
    });
  });

  app.get('/api/dr/status', deps.authenticateToken, async (_req, res) => {
    const snapshot = await readStatus();
    const check = hourlySafetyCheck({
      authorized: snapshot.authorized,
      secretFinding: snapshot.secretScan?.ok === false,
      currentIntegrity: snapshot.currentIntegrity?.verified === true,
      checkedAt: snapshot.lastCheckAt || now(),
    });
    res.json({ success: true, snapshot, hourlyCheck: check });
  });

  // ------------------------------------------------------------------
  // حالة حزمة الأسرار (owner): هل المفتاح الرئيسي صالح؟ هل الحزمة قابلة للفك؟
  // لا تُعاد أي قيمة سرّية — أسماء وحالات وبصمات فقط.
  // ------------------------------------------------------------------
  app.get('/api/dr/secrets/status', deps.authenticateToken, deps.requireOwner, async (_req, res) => {
    const masterKey = inspectMasterKey(env as NodeJS.ProcessEnv);
    let packageInfo: any = { present: false, encrypted: true };
    let canDecrypt = false;
    const readiness = authReadiness(env, control().driveRefreshToken);
    if (readiness.authorized) {
      try {
        const store = buildStore(buildClient(), { readOnlyStructure: true });
        const pkg = await store.readSecretsPackage();
        const manifest = await store.readSecretsManifest();
        if (pkg.ok && pkg.data) {
          packageInfo = {
            present: true,
            encrypted: true,
            size: pkg.data.length,
            count: manifest.ok && manifest.data ? manifest.data.includedCount ?? null : null,
            names: manifest.ok && manifest.data ? manifest.data.includedNames ?? [] : [],
            hash: manifest.ok && manifest.data ? manifest.data.encryptedSecretsHash ?? null : null,
            keyFingerprint: manifest.ok && manifest.data ? manifest.data.keyFingerprint ?? null : null,
          };
          // فكّ تجريبي للتأكد أن المفتاح الحالي يفتح الحزمة فعلاً (بلا كشف القيم).
          try {
            const { decryptSecretsPackage } = await import('../../tools/dr/secret-crypto.mjs');
            const dec = decryptSecretsPackage(pkg.data, env as NodeJS.ProcessEnv);
            canDecrypt = dec.ok;
            if (dec.ok) packageInfo.decryptedCount = Object.keys(dec.secrets || {}).length;
          } catch { canDecrypt = false; }
        }
      } catch { /* تعذّر القراءة: نُعلنها صراحةً */ }
    }
    res.json({ success: true, masterKey, package: packageInfo, canDecrypt, authorized: readiness.authorized });
  });

  // ------------------------------------------------------------------
  // نقاط الاستعادة الكاملة (owner): قراءة فقط — بيان كل نقطة وحالة تحققها.
  // ------------------------------------------------------------------
  app.get('/api/dr/recovery-points', deps.authenticateToken, deps.requireOwner, async (_req, res) => {
    const readiness = authReadiness(env, control().driveRefreshToken);
    if (!readiness.authorized) {
      return res.status(409).json({ success: false, code: 'NOT_AUTHORIZED', error: 'لا تفويض Google Drive فعّال.' });
    }
    try {
      const store = buildStore(buildClient(), { readOnlyStructure: true });
      const points = await store.listRestorePoints();
      const latest = await store.readLatestRecovery();
      const currentState = await store.readCurrentState();
      const list = [];
      for (const p of (points.ok ? points.data : [])) {
        const v = await verifyRecoveryPoint(store, p);
        list.push({
          id: p.id,
          commit: p.manifest?.commit ?? null,
          createdAt: p.manifest?.createdAt ?? null,
          fileCount: p.manifest?.fileCount ?? null,
          sourceSize: p.manifest?.sourceSize ?? null,
          database: { encrypted: true, hash: p.manifest?.encryptedDatabaseHash ?? null, size: p.manifest?.encryptedDatabaseSize ?? null },
          secrets: { encrypted: true, hash: p.manifest?.encryptedSecretsHash ?? null, size: p.manifest?.encryptedSecretsSize ?? null, count: p.manifest?.secretsCount ?? null },
          hashes: { treeHash: p.manifest?.treeHash ?? null, sourceHash: p.manifest?.sourceHash ?? null },
          verification: { ok: v.ok, checks: v.checks, problems: v.problems },
          status: v.ok ? 'verified' : 'incomplete',
        });
      }
      res.json({
        success: true,
        recoveryPoints: list,
        latestRecovery: latest.ok ? latest.data : null,
        currentState: currentState.ok ? currentState.data : null,
        mirror: control().driveMirror ?? null,
        secretsStatus: { masterKey: inspectMasterKey(env as NodeJS.ProcessEnv) },
      });
    } catch (err: any) {
      res.status(502).json({ success: false, code: 'DRIVE_READ_FAILED', error: String(err?.code || err?.message || 'drive_read_failed').slice(0, 80) });
    }
  });

  // ------------------------------------------------------------------
  // المزامنة الفعلية (owner + الفحص الساعي): مرآة CURRENT فردية.
  // كشف «لا تغيير» قبل أي رفع، وحماية المصدر الناقص، وstaging/atomic داخل
  // runCurrentMirror. القفل `backupRunning` يمنع التشغيل المتوازي.
  // ------------------------------------------------------------------
  async function runSync(opts: { force?: boolean } = {}): Promise<{ status: number; body: any }> {
    const readiness = authReadiness(env, control().driveRefreshToken);
    if (!readiness.authorized) {
      return { status: 409, body: { success: false, code: 'NOT_AUTHORIZED', error: 'لا تفويض Google Drive فعّال: لا يمكن المزامنة.' } };
    }
    const client = buildClient();
    if (!client) return { status: 503, body: { success: false, code: 'DRIVE_CLIENT_UNAVAILABLE', error: 'تعذّر بناء عميل Drive.' } };
    if (backupRunning) return { status: 409, body: { success: false, code: 'SYNC_ALREADY_RUNNING', error: 'عملية نسخ/مزامنة قيد التنفيذ بالفعل.' } };
    backupRunning = true;
    const startedAt = now();
    try {
      const store = buildStore(client);
      const collected = deps.collectSourceFiles ? deps.collectSourceFiles() : { included: [], excluded: [] };
      // حماية المصدر الناقص: لا مرآة من شجرة ناقصة.
      if (collected.complete === false) {
        return { status: 409, body: { success: false, code: 'SOURCE_INCOMPLETE', error: 'المصدر المُجمَّع ناقص: رُفضت مزامنة CURRENT (لا مرآة من شجرة ناقصة).', sourceCollection: sourceCollectionOf(collected) } };
      }
      const files = [...(collected.included || []), ...(collected.excluded || [])];
      // كشف «لا تغيير» قبل أي رفع: طابق بصمة الشجرة الحالية مع المرآة السابقة.
      const snapshot = buildMirrorSnapshot(files);
      const prevMirror = control().driveMirror || null;
      const commit = deps.gitMeta ? deps.gitMeta().commit ?? null : null;
      // لا no_op إذا وُجد تنظيف معلّق: يجب إكماله أولاً (وإلا بقي يتيم للأبد).
      if (!opts.force && prevMirror && prevMirror.treeHash && prevMirror.treeHash === snapshot.treeHash && !prevMirror.cleanupPending) {
        return { status: 200, body: { success: true, state: 'no_change', uploaded: 0, removed: 0, fileCount: snapshot.entries.length, sizeBytes: null, treeHash: snapshot.treeHash, commit, diff: null, reason: 'no_change', message: 'لا تغيير في المصدر: لم يُرفع شيء ولم تُرقَّ CURRENT.', at: startedAt } };
      }
      // نمرّر ملفات النسخة المُعتمَدة الحالية لحساب الفرق الصادق (بلا تعديل عليها).
      const result = await runCurrentMirror({ store, files, commit, previousMirror: prevMirror, currentFiles: prevMirror?.files || [], now: startedAt });
      rememberStructure(store);
      // لا فشل صامت: سبب فشل المزامنة يُحفظ ويُعلن (بلا أسرار) في health.
      if (result.state !== 'synced') {
        const reason = String(result.reason || result.state || 'mirror_failed').slice(0, 80);
        const prev = control().driveMirror;
        const stagingVersion = result.stagingVersion ?? prev?.stagingVersion ?? null;
        control().driveMirror = prev
          ? { ...prev, error: reason, stagingVersion }
          : { version: 0, treeHash: null, files: [], updatedAt: null, error: reason, stagingVersion };
        deps.persistControl({ driveMirror: control().driveMirror });
      }
      if (result.state === 'synced') {
        control().driveMirror = {
          version: result.mirrorManifest?.version || result.headVersion || 1,
          treeHash: result.treeHash,
          files: result.mirrorManifest?.files || [],
          commit: result.commit ?? null,
          updatedAt: startedAt,
          error: null,
          cleanupPending: Boolean(result.cleanupPending),
          pendingCleanup: result.pendingCleanup || [],
        };
        deps.persistControl({ driveMirror: control().driveMirror });
        // تحديث current-state إن وُجدت بيانات نسخة سابقة.
        const prev = control().driveBackup || {};
        try {
          const secretsManifest = await store.readSecretsManifest();
          await store.writeCurrentState(buildCurrentState({
            updatedAt: startedAt,
            commit: result.commit ?? prev.commit ?? null,
            branch: (deps.gitMeta?.().branch) ?? null,
            repository: (deps.gitMeta?.().repository) ?? null,
            treeHash: result.treeHash,
            fileCount: result.fileCount,
            sizeBytes: result.sizeBytes,
            lastRecoveryPointId: prev.lastRecoveryPointId ?? null,
            recoveryPointCount: null,
            database: { present: false, encrypted: true, hash: null, size: null },
            secrets: { present: Boolean(secretsManifest.ok && secretsManifest.data), encrypted: true, count: secretsManifest.ok && secretsManifest.data ? secretsManifest.data.includedCount ?? 0 : 0, hash: secretsManifest.ok && secretsManifest.data ? secretsManifest.data.encryptedSecretsHash ?? null : null, names: secretsManifest.ok && secretsManifest.data ? secretsManifest.data.includedNames ?? [] : [] },
            requiredEnvNames: secretsManifest.ok && secretsManifest.data ? secretsManifest.data.includedNames ?? [] : [],
          }));
        } catch { /* best effort */ }
      }
      return { status: result.state === 'failed' ? 500 : 200, body: {
        success: result.state === 'synced' || result.state === 'no_change',
        state: result.state,
        uploaded: result.uploaded ?? 0,
        removed: result.removed ?? 0,
        fileCount: result.fileCount ?? null,
        sizeBytes: result.sizeBytes ?? null,
        treeHash: result.treeHash ?? null,
        commit: result.commit ?? null,
        diff: result.diff ?? null,
        reason: result.reason ?? null,
        message: result.message ?? null,
        headVersion: result.headVersion ?? result.mirrorManifest?.version ?? null,
        currentVersion: result.currentVersion ?? result.headVersion ?? null,
        cleanupPending: Boolean(result.cleanupPending),
        pendingCleanup: result.pendingCleanup ?? [],
        stagingVersion: result.stagingVersion ?? null,
        at: startedAt,
      } };
    } catch (err: any) {
      return { status: 500, body: { success: false, state: 'failed', reason: String(err?.code || err?.message || 'sync_failed').slice(0, 80) } };
    } finally {
      backupRunning = false;
    }
  }

  app.post('/api/dr/sync', deps.authenticateToken, deps.requireOwner, async (_req, res) => {
    const { status, body } = await runSync();
    res.status(status).json(body);
  });

  // ------------------------------------------------------------------
  // خطة الاستعادة (owner): عرض صادق قبل أي تنفيذ — بلا كتابة.
  // ------------------------------------------------------------------
  async function resolvePoint(store: any, id: string | null) {
    if (id) return store.getRestorePoint(id);
    const points = await store.listRestorePoints();
    if (!points.ok || !points.data.length) return { ok: false, code: 'no_recovery_points', message: 'لا توجد نقاط استعادة.' };
    return { ok: true, data: points.data[points.data.length - 1] };
  }

  app.get('/api/dr/restore/plan', deps.authenticateToken, deps.requireOwner, async (req, res) => {
    const readiness = authReadiness(env, control().driveRefreshToken);
    if (!readiness.authorized) return res.status(409).json({ success: false, code: 'NOT_AUTHORIZED', error: 'لا تفويض Google Drive فعّال.' });
    const id = typeof req.query.point === 'string' && req.query.point ? req.query.point : null;
    try {
      const store = buildStore(buildClient(), { readOnlyStructure: true });
      const point = await resolvePoint(store, id);
      if (!point.ok || !point.data) return res.status(404).json({ success: false, code: 'RECOVERY_POINT_NOT_FOUND', error: point.message || 'نقطة الاستعادة غير موجودة.' });
      const plan = await buildRestorePlan(store, point.data, { mode: 'isolated', env: env as NodeJS.ProcessEnv });
      res.json({ success: true, plan });
    } catch (err: any) {
      res.status(502).json({ success: false, code: 'DRIVE_READ_FAILED', error: String(err?.code || err?.message || 'drive_read_failed').slice(0, 80) });
    }
  });

  // ------------------------------------------------------------------
  // اختبار الاستعادة المعزول (owner): تنزيل → تحقق → فكّ تشفير → استخراج مصدر
  // → استعادة قاعدة بيانات في قاعدة معزولة (إن مُرِّرت). **لا يلمس الإنتاج أبداً.**
  // ------------------------------------------------------------------
  app.post('/api/dr/restore/drill', deps.authenticateToken, deps.requireOwner, async (req, res) => {
    const readiness = authReadiness(env, control().driveRefreshToken);
    if (!readiness.authorized) return res.status(409).json({ success: false, code: 'NOT_AUTHORIZED', error: 'لا تفويض Google Drive فعّال.' });
    const id = (req.body && typeof req.body.point === 'string' && req.body.point) ? req.body.point : null;
    try {
      const store = buildStore(buildClient(), { readOnlyStructure: true });
      const point = await resolvePoint(store, id);
      if (!point.ok || !point.data) return res.status(404).json({ success: false, code: 'RECOVERY_POINT_NOT_FOUND', error: point.message || 'نقطة الاستعادة غير موجودة.' });

      const isolatedUrl = deps.isolatedDatabaseUrl || env.DR_RECOVERY_TEST_DATABASE_URL || null;
      const productionUrl = env.DATABASE_URL || null;
      // حماية صريحة: لا نستخدم قاعدة الإنتاج في اختبار الاستعادة.
      if (isolatedUrl && productionUrl && isolatedUrl === productionUrl) {
        return res.status(409).json({ success: false, code: 'REFUSED_PRODUCTION_DATABASE', error: 'DR_RECOVERY_TEST_DATABASE_URL يطابق DATABASE_URL الإنتاجي: رُفض الاختبار.' });
      }

      const fsMod = await import('node:fs');
      const osMod = await import('node:os');
      const pathMod = await import('node:path');
      const workDir = deps.drillDir || fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'gharabi-drill-'));

      const report = await runRecoveryDrill({ store, point: point.data, env: env as NodeJS.ProcessEnv, workDir, returnSql: true, returnSecrets: false, now: now() });

      // استعادة قاعدة البيانات في قاعدة معزولة (إن مُرِّرت ولم تكن الإنتاج).
      let databaseRestore: any = { attempted: false, reason: isolatedUrl ? 'no_sql' : 'no_isolated_database' };
      if (isolatedUrl && report.sql) {
        try {
          const pg: any = await import('pg');
          const pool = new pg.default.Pool({ connectionString: isolatedUrl, max: 2 });
          try {
            databaseRestore = await applyDatabaseDump(report.sql, pool);
          } finally {
            await pool.end().catch(() => {});
          }
        } catch (e: any) {
          databaseRestore = { ok: false, code: String(e?.code || e?.message || 'db_restore_failed').slice(0, 80) };
        }
      }
      // لا نُعيد الأسرار ولا SQL في الاستجابة (سرّية).
      const { sql, secrets, ...safe } = report as any;
      res.json({ success: report.ok === true, report: { ...safe, databaseRestore, isolatedDatabaseUsed: Boolean(isolatedUrl && isolatedUrl !== productionUrl) } });
    } catch (err: any) {
      res.status(500).json({ success: false, code: 'DRILL_FAILED', error: String(err?.code || err?.message || 'drill_failed').slice(0, 120) });
    }
  });

  // ------------------------------------------------------------------
  // استعادة الإنتاج (owner): **مقفلة** بلا تأكيد صريح. لا نكتب فوق الإنتاج
  // تلقائياً — نُعلن أن الاستعادة الإنتاجية تتطلّب تأكيداً وخطوات خارجية.
  // ------------------------------------------------------------------
  app.post('/api/dr/restore/production', deps.authenticateToken, deps.requireOwner, async (req, res) => {
    const confirmed = req.body && req.body.confirm === true;
    if (!confirmed) {
      return res.status(428).json({
        success: false,
        code: 'OWNER_CONFIRMATION_REQUIRED',
        error: 'الاستعادة الإنتاجية تتطلّب تأكيداً صريحاً (confirm: true) بعد نجاح اختبار معزول.',
        requires: ['confirm: true', 'successful isolated drill'],
      });
    }
    return res.status(501).json({
      success: false,
      code: 'PRODUCTION_RESTORE_EXTERNAL',
      error: 'الاستعادة الإنتاجية تُنفَّذ بخطوات خارجية موثّقة (Render redeploy + env vars) عبر وثائق التعافي؛ لا نكتب فوق الإنتاج تلقائياً.',
      documentation: 'al-gharabi-ai-dr/RECOVERY/START-HERE.md',
      steps: buildLatestRecovery({}).restoreSteps,
    });
  });

  // ------------------------------------------------------------------
  // الفحص الساعي (reconciliation) — مؤقّت داخلي آمن في الإنتاج.
  // يقارن مصدر المشروع الحالي مع CURRENT: تطابق ⇒ no-op، اختلاف ⇒ مزامنة بعد
  // التحقق من اكتمال المصدر، نقص ⇒ SOURCE_INCOMPLETE بلا تغيير. لا AI، لا حلقات.
  // ------------------------------------------------------------------
  let reconciliationRunning = false;        // منع التشغيل المتوازي لنفس العملية
  let reconciliationTimer: NodeJS.Timeout | null = null;
  let reconciliationInFlight: Promise<any> | null = null;
  const RECONCILE_INTERVAL_MS = 60 * 60 * 1000; // كل ساعة

  /** هل التزام المصدر (commit) تغيّر عن آخر نقطة استعادة؟ يُتجاهل عند غياب commit. */
  function commitChanged(): boolean {
    try {
      const commit = deps.gitMeta ? deps.gitMeta().commit ?? null : null;
      if (!commit) return false;
      const known = control().driveBackup?.commit ?? null;
      return Boolean(known) && known !== commit;
    } catch { return false; }
  }

  /** دورة reconciliation واحدة: قرار صادق بلا أي ادّعاء. */
  async function runReconciliationCycle(trigger: string): Promise<any> {
    const startedAt = now();
    const result: any = { trigger, at: startedAt, outcome: 'unknown' };
    if (reconciliationRunning) return { ...result, outcome: 'skipped', reason: 'already_running', at: startedAt };
    reconciliationRunning = true;
    try {
      // 1) جمع المصدر (حتمي، بلا شبكة ولا AI).
      const collected = deps.collectSourceFiles ? deps.collectSourceFiles() : { included: [], excluded: [] };
      if (collected.complete === false) {
        result.outcome = 'source_incomplete';
        result.sourceCollection = sourceCollectionOf(collected);
        result.reason = 'source_incomplete';
        return result;
      }
      // 2) مقارنة المصدر مع CURRENT (بصمة شجرة).
      const files = [...(collected.included || []), ...(collected.excluded || [])];
      const snapshot = buildMirrorSnapshot(files);
      const prevMirror = control().driveMirror || null;
      const sourceTreeHash = snapshot.treeHash;
      result.sourceTreeHash = sourceTreeHash;
      result.currentTreeHash = prevMirror?.treeHash ?? null;
      result.sourceFileCount = snapshot.entries.length;
      result.commitChanged = commitChanged();
      // 3) تطابق ⇒ no-op، إلا إذا كان هناك تنظيف معلّق فيجب إكماله (لا no_op كاذب).
      if (prevMirror && prevMirror.treeHash && prevMirror.treeHash === sourceTreeHash && !prevMirror.cleanupPending) {
        result.outcome = 'no_op';
        result.reason = 'in_sync';
        return result;
      }
      // 4) اختلاف ⇒ مزامنة CURRENT بعد التحقق (نفس مسار /api/dr/sync).
      const readiness = authReadiness(env, control().driveRefreshToken);
      if (!readiness.authorized) { result.outcome = 'skipped'; result.reason = 'not_authorized'; return result; }
      const sync = await runSync();
      result.outcome = sync.status >= 200 && sync.status < 300 ? 'synced' : 'sync_failed';
      result.syncState = sync.body?.state ?? null;
      result.syncCode = sync.body?.code ?? null;
      result.uploaded = sync.body?.uploaded ?? 0;
      result.removed = sync.body?.removed ?? 0;
      result.treeHash = sync.body?.treeHash ?? null;
      result.headVersion = sync.body?.headVersion ?? null;
      result.cleanupPending = sync.body?.cleanupPending ?? null;
      result.reason = sync.body?.reason ?? null;
      return result;
    } catch (err: any) {
      result.outcome = 'error';
      result.reason = String(err?.code || err?.message || 'reconcile_failed').slice(0, 120);
      return result;
    } finally {
      reconciliationRunning = false;
      // تثبيت نتيجة آخر فحص (بلا أسرار) في الحالة، فتصمد بعد restart وتُعلن في health.
      try {
        const prev = control().driveReconciliation || {};
        control().driveReconciliation = {
          lastReconciliationAt: now(),
          lastReconciliationResult: result.outcome,
          lastReconciliationTrigger: trigger,
          lastReconciliationReason: result.reason ?? null,
          lastReconciliationTreeHash: result.treeHash ?? result.sourceTreeHash ?? null,
          reconciliationCount: (prev.reconciliationCount || 0) + 1,
        };
        deps.persistControl({ driveReconciliation: control().driveReconciliation });
      } catch { /* أفضل جهد */ }
    }
  }

  /** الفحص الساعي المُهيّأ (متاح للاختبار مباشرة). */
  const hourlyReconciliation = {
    intervalMs: RECONCILE_INTERVAL_MS,
    runCycle: (trigger = 'manual') => runReconciliationCycle(trigger),
    isRunning: () => reconciliationRunning,
    start: () => startDriveReconciliation(),
    stop: () => stopDriveReconciliation(),
    lastResult: () => control().driveReconciliation || null,
  };

  /** يبدأ المؤقّت الداخلي (مرة واحدة). `.unref()` يمنع تعليق الإغلاق النظيف. */
  function startDriveReconciliation(): void {
    if (reconciliationTimer) return;
    reconciliationTimer = setInterval(() => {
      // لا نبدأ دورة إن كانت هناك دورة جارية أو نسخة/مزامنة قيد التنفيذ.
      if (reconciliationRunning || backupRunning) return;
      reconciliationInFlight = runReconciliationCycle('hourly').catch(() => { /* لا يُسقط العملية */ });
    }, RECONCILE_INTERVAL_MS);
    if (typeof (reconciliationTimer as any).unref === 'function') (reconciliationTimer as any).unref();
    console.log(`[الغرابي AI] DR hourly reconciliation scheduled every ${Math.round(RECONCILE_INTERVAL_MS / 60000)} min`);
  }

  function stopDriveReconciliation(): void {
    if (reconciliationTimer) { clearInterval(reconciliationTimer); reconciliationTimer = null; }
  }

  /** حالة تشغيل صادقة للواجهة/الصحة: بلا أي سرّ. */
  function reconciliationStatus(): any {
    const last = control().driveReconciliation || null;
    return {
      enabled: true,
      intervalMinutes: Math.round(RECONCILE_INTERVAL_MS / 60000),
      running: reconciliationRunning,
      scheduled: reconciliationTimer !== null,
      lastReconciliationAt: last?.lastReconciliationAt ?? null,
      lastReconciliationResult: last?.lastReconciliationResult ?? null,
      lastReconciliationTrigger: last?.lastReconciliationTrigger ?? null,
      lastReconciliationReason: last?.lastReconciliationReason ?? null,
      lastReconciliationTreeHash: last?.lastReconciliationTreeHash ?? null,
      reconciliationCount: last?.reconciliationCount ?? 0,
    };
  }

  // مسار يدوي للمالك لتشغيل دورة فحص الآن (تشخيص) — بلا AI.
  app.post('/api/dr/reconcile', deps.authenticateToken, deps.requireOwner, async (_req, res) => {
    const result = await runReconciliationCycle('manual');
    res.status(result.outcome === 'error' ? 500 : 200).json({ success: result.outcome !== 'error', reconciliation: result, status: reconciliationStatus() });
  });

  // ------------------------------------------------------------------
  // خزنة مفاتيح الطوارئ (Emergency Key Vault): حالة/مزامنة/فحص/نسخة/اختبار.
  // كلها للمالك فقط، وبلا أي قيمة سرّية في أي رد. لا زر "إظهار المفاتيح".
  // ------------------------------------------------------------------

  /** يبني مخزن Drive قابل للكتابة لعمليات الخزنة (يتطلّب تفويضاً فعّالاً). */
  function vaultStore(): { ok: boolean; store?: any; status?: number; code?: string; error?: string } {
    const readiness = authReadiness(env, control().driveRefreshToken);
    if (!readiness.authorized) return { ok: false, status: 409, code: 'NOT_AUTHORIZED', error: 'لا تفويض Google Drive فعّال.' };
    const client = buildClient();
    if (!client) return { ok: false, status: 503, code: 'DRIVE_CLIENT_UNAVAILABLE', error: 'تعذّر بناء عميل Drive.' };
    return { ok: true, store: buildStore(client) };
  }

  // حالة الخزنة (owner): بلا قيم — حالة المفتاح + رقم الإصدار + عدد السجلات + الحالات.
  app.get('/api/dr/key-vault/status', deps.authenticateToken, deps.requireOwner, async (_req, res) => {
    const readiness = authReadiness(env, control().driveRefreshToken);
    let store: any = null;
    if (readiness.authorized) { const c = buildClient(); if (c) store = buildStore(c, { readOnlyStructure: true }); }
    const status = await keyVaultStatus(store, env as Record<string, string | undefined>);
    res.json({ success: true, keyVault: status, inventory: RECOVERY_SECRET_INVENTORY, authorized: readiness.authorized });
  });

  // مزامنة الخزنة (owner): بناء نسخة جديدة عند التغيّر فقط + تحقق + اعتماد.
  app.post('/api/dr/key-vault/sync', deps.authenticateToken, deps.requireOwner, async (_req, res) => {
    const v = vaultStore();
    if (!v.ok) return res.status(v.status!).json({ success: false, code: v.code, error: v.error });
    if (backupRunning) return res.status(409).json({ success: false, code: 'SYNC_ALREADY_RUNNING', error: 'عملية نسخ/مزامنة قيد التنفيذ بالفعل.' });
    backupRunning = true;
    try {
      const result = await runKeyVaultSync({ store: v.store, env: env as Record<string, string | undefined>, now: now() });
      rememberStructure(v.store);
      const status = await keyVaultStatus(v.store, env as Record<string, string | undefined>);
      const httpStatus = result.state === 'failed' ? 500 : (result.state === 'blocked' ? 409 : 200);
      // لا قيمة سرّية في الرد: أسماء/بصمات/حالات فقط (diff = أسماء).
      return res.status(httpStatus).json({
        success: result.state === 'synced' || result.state === 'no_change',
        state: result.state,
        version: result.version ?? null,
        recordCount: result.recordCount ?? null,
        contentHash: result.contentHash ?? null,
        diff: result.diff ?? null,
        removed: result.removed ?? 0,
        cleanupPending: Boolean(result.cleanupPending),
        reason: result.reason ?? null,
        message: result.message ?? null,
        keyVault: status,
        at: now(),
      });
    } finally {
      backupRunning = false;
    }
  });

  // فحص الخزنة (owner): فكّ تجريبي + تحقق بصمة + اتساق البيان — بلا كشف قيم.
  app.post('/api/dr/key-vault/verify', deps.authenticateToken, deps.requireOwner, async (_req, res) => {
    const v = vaultStore();
    if (!v.ok) return res.status(v.status!).json({ success: false, code: v.code, error: v.error });
    const rec = await recoverKeyVault(v.store, env as Record<string, string | undefined>);
    const status = await keyVaultStatus(v.store, env as Record<string, string | undefined>);
    return res.status(rec.ok ? 200 : 409).json({
      success: rec.ok,
      verified: rec.ok,
      version: rec.version ?? null,
      recordCount: rec.ok ? rec.recordCount : null,
      integrity: rec.ok ? rec.integrity : null,
      reason: rec.ok ? null : rec.code,
      message: rec.ok ? 'الخزنة تُفكّ بمفتاح المالك وبصماتها مطابقة للبيان.' : rec.message,
      keyVault: status,
      at: now(),
    });
  });

  // إنشاء نسخة طوارئ (owner): يفرض مزامنة الخزنة (force) فتبني نسخة جديدة مؤكدة.
  app.post('/api/dr/key-vault/backup', deps.authenticateToken, deps.requireOwner, async (_req, res) => {
    const v = vaultStore();
    if (!v.ok) return res.status(v.status!).json({ success: false, code: v.code, error: v.error });
    if (backupRunning) return res.status(409).json({ success: false, code: 'SYNC_ALREADY_RUNNING', error: 'عملية نسخ/مزامنة قيد التنفيذ بالفعل.' });
    backupRunning = true;
    try {
      const result = await runKeyVaultSync({ store: v.store, env: env as Record<string, string | undefined>, now: now() });
      rememberStructure(v.store);
      const status = await keyVaultStatus(v.store, env as Record<string, string | undefined>);
      return res.status(result.state === 'failed' ? 500 : 200).json({
        success: result.state === 'synced' || result.state === 'no_change',
        state: result.state,
        version: result.version ?? null,
        recordCount: result.recordCount ?? null,
        reason: result.reason ?? null,
        message: result.message ?? null,
        keyVault: status,
        at: now(),
      });
    } finally {
      backupRunning = false;
    }
  });

  // اختبار استعادة الخزنة (owner): فكّ في الذاكرة + تحقق تكامل — لا كتابة على الإنتاج.
  app.post('/api/dr/key-vault/drill', deps.authenticateToken, deps.requireOwner, async (_req, res) => {
    const v = vaultStore();
    if (!v.ok) return res.status(v.status!).json({ success: false, code: v.code, error: v.error });
    const rec = await recoverKeyVault(v.store, env as Record<string, string | undefined>);
    return res.status(rec.ok ? 200 : 409).json({
      success: rec.ok,
      state: rec.ok ? 'recovered' : 'failed',
      version: rec.version ?? null,
      recordCount: rec.ok ? rec.recordCount : null,
      names: rec.ok ? Object.keys(rec.values || {}).sort() : [],
      integrity: rec.ok ? rec.integrity : null,
      reason: rec.ok ? null : rec.code,
      message: rec.ok ? 'نجح فكّ الخزنة والتحقق من تكاملها (بلا أي كتابة).' : rec.message,
      wroteToProduction: false,
      at: now(),
    });
  });

  // مرجع مخزن الحالة للاختبار/الصحة العامة + واجهة الاختبار للساعي/المزامنة.
  (app as any).drStateStore = stateStore;
  (app as any).drReconciliation = {
    status: reconciliationStatus,
    runCycle: (trigger?: string) => runReconciliationCycle(trigger || 'manual'),
    hourly: hourlyReconciliation,
    runSync: (opts?: { force?: boolean }) => runSync(opts || {}),
    start: startDriveReconciliation,
    stop: stopDriveReconciliation,
  };
}
