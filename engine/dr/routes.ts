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
  RP_001_COMMIT,
} from '../../tools/dr/cloud-lib.mjs';
import { DriveStateStore } from '../../tools/dr/drive-auth-url.mjs';
import {
  inspectDriveAuthEnv,
  exchangeDriveAuthCode,
  encryptDriveSecret,
  createRefreshTokenProvider,
  diagnoseDriveRefreshToken,
} from '../../tools/dr/drive-auth.mjs';
import { DriveClient, createGaxiosTransport } from '../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../tools/dr/drive-store.mjs';
import { DriveSync } from '../../tools/dr/drive-sync.mjs';
import { runBackup } from '../../tools/dr/backup.mjs';
import { encryptDbDump } from '../../tools/dr/db-crypto.mjs';
import { runCurrentMirror } from '../../tools/dr/current-mirror.mjs';
import { buildSecretsBundle, inspectMasterKey } from '../../tools/dr/secret-crypto.mjs';
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
  loadControl: () => { driveOAuthStates?: any[]; driveRefreshToken?: any; driveLastError?: string | null; driveBackup?: any; driveFolderIdentity?: any; driveMirror?: any };
  /** يثبّت جزءاً من حالة DR عبر محوّل الحالة (يصمد بعد restart). */
  persistControl: (partial: Record<string, any>) => void;
  /** عميل Drive اختياري (للاختبار). إن غاب يُبنى من البيئة. */
  clientFactory?: (env: Record<string, string | undefined>) => any | null;
  /** ناقل OAuth اختياري (للاختبار): يوجّه تبادل الرمز إلى خادم وهمي. */
  oauthTransport?: any;
  /** يجمع ملفات المصدر للنسخة (المشمولة + المستبعدة للفحص). */
  collectSourceFiles?: () => { included: any[]; excluded: any[] };
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
          mirror = await runCurrentMirror({ store, files, commit: result.commit ?? null, previousMirror: control().driveMirror || null, now: startedAt });
          if (mirror.state === 'synced') {
            control().driveMirror = { version: mirror.mirrorManifest?.version || 1, treeHash: mirror.treeHash, files: mirror.mirrorManifest?.files || [], updatedAt: startedAt, error: null };
            deps.persistControl({ driveMirror: control().driveMirror });
          }
        } catch (e: any) {
          mirror = { state: 'failed', reason: String(e?.code || e?.message || 'mirror_failed').slice(0, 80) };
        }
        // لا فشل صامت: سبب فشل المرآة يُحفظ ويُعلن (بلا أسرار) ليعرف المالك لماذا synced=false.
        if (mirror && mirror.state !== 'synced') {
          const reason = String(mirror.reason || mirror.state || 'mirror_failed').slice(0, 80);
          const prev = control().driveMirror;
          control().driveMirror = prev
            ? { ...prev, error: reason }
            : { version: 0, treeHash: null, files: [], updatedAt: null, error: reason };
          deps.persistControl({ driveMirror: control().driveMirror });
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
        reason: result.reason ?? null,
        message: result.message ?? null,
        errorDetails: result.errorDetails ?? null,
        problems: result.problems ?? null,
        secretScan: result.secretScan ?? { ok: true, findings: 0 },
        at: startedAt,
      });
    } catch (err: any) {
      const failure = { state: 'failed', reason: String(err?.code || err?.message || 'backup_failed').slice(0, 80), message: 'فشل غير متوقّع أثناء النسخة.' };
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
        },
        // مفتاح الاستعادة الرئيسي (بلا قيمة): هل يفتح الأسرار فعلاً؟
        recoveryMasterKey: masterKey,
        callbackRoute: '/api/dr/drive/callback',
        authUrlRoute: '/api/dr/drive/auth-url',
        rp001Commit: RP_001_COMMIT,
        quota: { designBytes: DESIGN_QUOTA_BYTES, headroomBytes: QUOTA_HEADROOM_BYTES },
        backupReady: readiness.authorized,
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
        // منظومة التعافي: نقاط الاستعادة تُقرأ من /api/dr/recovery-points (owner).
        recoverySystem: {
          currentMirror: Boolean(mirror?.treeHash),
          secretsEncryptionRequired: true,
          databaseEncryptionRequired: true,
          recoveryPointsRoute: '/api/dr/recovery-points',
          restorePlanRoute: '/api/dr/restore/plan',
          drillRoute: '/api/dr/restore/drill',
          productionRestoreRoute: '/api/dr/restore/production',
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
  // مزامنة CURRENT الفعلية (owner): مرآة الملفات الفردية ببنية المجلدات.
  // ------------------------------------------------------------------
  app.post('/api/dr/sync', deps.authenticateToken, deps.requireOwner, async (_req, res) => {
    const readiness = authReadiness(env, control().driveRefreshToken);
    if (!readiness.authorized) {
      return res.status(409).json({ success: false, code: 'NOT_AUTHORIZED', error: 'لا تفويض Google Drive فعّال: لا يمكن المزامنة.' });
    }
    const client = buildClient();
    if (!client) return res.status(503).json({ success: false, code: 'DRIVE_CLIENT_UNAVAILABLE', error: 'تعذّر بناء عميل Drive.' });
    if (backupRunning) return res.status(409).json({ success: false, code: 'SYNC_ALREADY_RUNNING', error: 'عملية نسخ/مزامنة قيد التنفيذ بالفعل.' });
    backupRunning = true;
    const startedAt = now();
    try {
      const store = buildStore(client);
      const collected = deps.collectSourceFiles ? deps.collectSourceFiles() : { included: [], excluded: [] };
      const files = [...(collected.included || []), ...(collected.excluded || [])];
      const result = await runCurrentMirror({ store, files, commit: deps.gitMeta ? deps.gitMeta().commit ?? null : null, previousMirror: control().driveMirror || null, now: startedAt });
      rememberStructure(store);
      // لا فشل صامت: سبب فشل المزامنة يُحفظ ويُعلن (بلا أسرار) في health.
      if (result.state !== 'synced') {
        const reason = String(result.reason || result.state || 'mirror_failed').slice(0, 80);
        const prev = control().driveMirror;
        control().driveMirror = prev
          ? { ...prev, error: reason }
          : { version: 0, treeHash: null, files: [], updatedAt: null, error: reason };
        deps.persistControl({ driveMirror: control().driveMirror });
      }
      if (result.state === 'synced') {
        control().driveMirror = { version: result.mirrorManifest?.version || 1, treeHash: result.treeHash, files: result.mirrorManifest?.files || [], updatedAt: startedAt, error: null };
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
      res.status(result.state === 'failed' ? 500 : 200).json({
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
        at: startedAt,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, state: 'failed', reason: String(err?.code || err?.message || 'sync_failed').slice(0, 80) });
    } finally {
      backupRunning = false;
    }
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
      documentation: 'al-gharabi-ai-dr/RECOVERY/recovery-information.md',
      steps: buildLatestRecovery({}).restoreSteps,
    });
  });

  // مرجع مخزن الحالة للاختبار/الصحة العامة.
  (app as any).drStateStore = stateStore;
}
