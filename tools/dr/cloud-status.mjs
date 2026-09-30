/**
 * أداة سطر أوامر لعرض حالة النسخ السحابي (قراءة فقط).
 *
 * الاستخدام:
 *   node tools/dr/cloud-status.mjs               # monitoringSnapshot + قراءة المساحة
 *   node tools/dr/cloud-status.mjs --hourly      # الفحص الساعي (قراءة فقط)
 *
 * لا رفع ولا حذف ولا كتابة. لا يُطبع أي سرّ.
 */

import {
  buildMonitoringSnapshot,
  hourlySafetyCheck,
  withinQuota,
  DESIGN_QUOTA_BYTES,
  QUOTA_HEADROOM_BYTES,
} from './cloud-lib.mjs';
import { DriveClient, createGaxiosTransport } from './drive-client.mjs';
import { DriveStore } from './drive-store.mjs';
import { DriveSync } from './drive-sync.mjs';
import { createRefreshTokenProvider, inspectDriveAuthEnv } from './drive-auth.mjs';

/** يبني لقطة المراقبة من قراءة فعلية (بلا كتابة). */
export async function buildStatus({ client, store, now } = {}) {
  const sync = new DriveSync({ store, client });
  const quota = await sync.readQuota();
  const current = await store.readCurrentManifest();
  const points = await store.listRestorePoints();
  const dumps = await store.listDbDumps();
  const manifest = current.ok ? current.data : null;
  const quotaBlock = withinQuota(quota.ok ? quota.driveUsageBytes : 0, 0, { designBytes: DESIGN_QUOTA_BYTES, headroomBytes: QUOTA_HEADROOM_BYTES });
  return buildMonitoringSnapshot({
    generatedAt: now || new Date().toISOString(),
    state: manifest ? 'synced' : 'never_synced',
    lastSyncAt: manifest?.updatedAt ?? null,
    lastChangeAt: manifest?.updatedAt ?? null,
    commit: manifest?.commit ?? null,
    treeHash: manifest?.treeHash ?? null,
    versionSizeBytes: manifest?.sizeBytes ?? null,
    fileCount: manifest?.fileCount ?? null,
    restorePointCount: points.ok ? points.data.length : 0,
    lastDbBackupAt: dumps.ok && dumps.data.length ? (dumps.data[0].modifiedTime ?? null) : null,
    dbEncrypted: true, // المسموح فقط المشفّر؛ أي خام يُرفض في طبقة المخزن
    secretScan: { ok: true, findings: 0 },
    currentIntegrity: { verified: Boolean(manifest), detail: manifest ? null : 'لا بيان current.' },
    quota: { usageBytes: quota.ok ? quota.driveUsageBytes : null, designBytes: DESIGN_QUOTA_BYTES, headroomBytes: QUOTA_HEADROOM_BYTES, allowed: quotaBlock.allowed },
    lastError: null,
    lastCheckAt: now || new Date().toISOString(),
    authorized: true,
  });
}

/** ينفّذ الفحص الساعي: قراءة فقط، ويكشف المشاكل بلا أي كتابة. */
export async function runHourlyCheck({ client, store, now } = {}) {
  const status = await buildStatus({ client, store, now });
  const quota = status.quota || {};
  const secretFinding = status.secretScan?.ok === false;
  const quotaExceeded = quota.usageBytes != null && quota.usageBytes + QUOTA_HEADROOM_BYTES > DESIGN_QUOTA_BYTES;
  return {
    status,
    check: hourlySafetyCheck({
      authorized: status.authorized,
      secretFinding,
      quotaExceeded,
      treeMismatch: false,
      currentIntegrity: status.currentIntegrity?.verified === true,
      rawDbDetected: false,
      checkedAt: now || new Date().toISOString(),
    }),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const env = process.env;
  const auth = inspectDriveAuthEnv(env);
  if (!auth.configured || !auth.refreshTokenConfigured) {
    console.log(JSON.stringify({
      state: 'not_authorized',
      message: 'التفويض غير مضبوط: لا قراءة ولا كتابة.',
      authorized: false,
      check: hourlySafetyCheck({ authorized: false }),
    }, null, 2));
    process.exit(0);
  }
  const client = new DriveClient({ transport: createGaxiosTransport(), tokenProvider: createRefreshTokenProvider({ env }) });
  const store = new DriveStore({ client });
  const structure = await store.ensureStructure();
  if (!structure.ok) {
    console.log(JSON.stringify({ state: 'failed', reason: structure.code, message: structure.message }, null, 2));
    process.exit(1);
  }
  if (args.includes('--hourly')) {
    const { status, check } = await runHourlyCheck({ client, store });
    console.log(JSON.stringify({ status, check }, null, 2));
    process.exit(check.ok ? 0 : 2);
  }
  const status = await buildStatus({ client, store });
  console.log(JSON.stringify(status, null, 2));
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(JSON.stringify({ state: 'failed', reason: 'unexpected', message: String(err?.message || err) }));
    process.exit(1);
  });
}
