/**
 * مخزن حالة CSRF لتفويض Drive: state عشوائي، أحادي الاستخدام، بمهلة TTL.
 *
 * لماذا: رابط التفويض يجب أن يحمل state عشوائياً، ويُتحقق منه عند العودة
 * (حماية CSRF)، ويُستهلك مرة واحدة فقط (منع إعادة التشغيل/العبث)، وينتهي بعد
 * مدة قصيرة (TTL). لا يُخزَّن أي سرّ، ويمكن حقن مخزن دائم (عبر محوّل الحالة)
 * ليصمد بعد إعادة التشغيل.
 *
 * النطاق المطلوب دائماً `drive.file`، وأي نطاق ممنوع يُرفض قبل التوليد.
 */

import crypto from 'node:crypto';
import {
  DRIVE_FILE_SCOPE,
  DRIVE_OAUTH_REDIRECT_URI,
} from './cloud-lib.mjs';
import { buildDriveAuthorizationUrl, enforceDriveFileScope } from './drive-auth.mjs';

export const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000; // 10 دقائق
export const MAX_STATE_ENTRIES = 200;

/** يوحّد مجموعة النطاقات ويضمن drive.file حصراً. */
export function requiredScopes(scopes) {
  return enforceDriveFileScope(scopes ?? [DRIVE_FILE_SCOPE]);
}

export class DriveStateStore {
  /**
   * @param {object} options
   * @param {(state:object)=>void} [options.persist] يُستدعى بعد كل تغيير لتثبيت الحالة.
   * @param {object[]} [options.initial] حالة أولية مُسترجَعة.
   * @param {number} [options.ttlMs]
   * @param {() => number} [options.now]
   * @param {object} [options.env] بيئة OAuth الافتراضية لتوليد الرابط.
   */
  constructor(options = {}) {
    this.ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_STATE_TTL_MS;
    this.now = options.now || (() => Date.now());
    this.persist = options.persist || (() => {});
    /** بيئة OAuth الافتراضية (تُمرَّر لتوليد الرابط إن لم تُحدَّد لكل نداء). */
    this.env = options.env || process.env;
    /** @type {Map<string, {createdAt:number, usedAt:number|null, userId:string, redirectUri:string}>} */
    this.states = new Map();
    if (Array.isArray(options.initial)) {
      for (const s of options.initial) {
        if (s && s.state) this.states.set(s.state, { createdAt: s.createdAt || 0, usedAt: s.usedAt ?? null, userId: s.userId || '', redirectUri: s.redirectUri || DRIVE_OAUTH_REDIRECT_URI });
      }
    }
  }

  snapshot() {
    return [...this.states.entries()].map(([state, v]) => ({ state, ...v }));
  }

  /** يزيل المنتهية والمُستهلكة القديمة للحفاظ على الحجم. */
  prune() {
    const now = this.now();
    for (const [state, v] of this.states) {
      if (now - v.createdAt > this.ttlMs * 4) this.states.delete(state);
    }
    if (this.states.size > MAX_STATE_ENTRIES) {
      const ordered = [...this.states.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
      while (this.states.size > MAX_STATE_ENTRIES && ordered.length) {
        const [state] = ordered.shift();
        this.states.delete(state);
      }
    }
  }

  /**
   * ينشئ state جديداً ويربطه بالمستخدم وredirect، ويعيد الرابط الكامل.
   * يفشل صراحةً عند طلب أي نطاق ممنوع.
   */
  create(userId, options = {}) {
    const scopeCheck = requiredScopes(options.scopes);
    if (!scopeCheck.ok) return scopeCheck;
    const redirectUri = options.redirectUri || DRIVE_OAUTH_REDIRECT_URI;
    const state = crypto.randomBytes(32).toString('hex');
    this.states.set(state, { createdAt: this.now(), usedAt: null, userId: String(userId ?? ''), redirectUri });
    this.prune();
    this.persist(this.snapshot());

    const built = buildDriveAuthorizationUrl({ ...options, env: options.env || this.env, state, redirectUri, scopes: [DRIVE_FILE_SCOPE] });
    if (!built.ok) {
      this.states.delete(state);
      this.persist(this.snapshot());
      return built;
    }
    return { ok: true, state, url: built.url, scope: DRIVE_FILE_SCOPE, redirectUri, ttlMs: this.ttlMs, expiresAt: new Date(this.now() + this.ttlMs).toISOString() };
  }

  /**
   * يستهلك state عند العودة. يرفض: المجهول، المنتهي، المُستهلك، وعدم تطابق
   * المستخدم أو redirect. عند النجاح يُوسَم مستهلكاً فلا يُقبل ثانية.
   */
  consume(state, options = {}) {
    const entry = this.states.get(String(state ?? ''));
    if (!entry) return { ok: false, code: 'unknown_state', message: 'حالة OAuth غير معروفة (CSRF).' };
    if (entry.usedAt) return { ok: false, code: 'state_reused', message: 'حالة OAuth استُخدمت مسبقاً.' };
    if (this.now() - entry.createdAt > this.ttlMs) {
      entry.usedAt = this.now();
      this.persist(this.snapshot());
      return { ok: false, code: 'state_expired', message: 'انتهت مهلة حالة OAuth (TTL).' };
    }
    if (options.userId != null && String(options.userId) !== entry.userId) {
      return { ok: false, code: 'state_user_mismatch', message: 'حالة OAuth تخصّ مستخدماً آخر.' };
    }
    if (options.redirectUri && options.redirectUri !== entry.redirectUri) {
      return { ok: false, code: 'state_redirect_mismatch', message: 'redirect غير مطابق لحالة OAuth.' };
    }
    entry.usedAt = this.now();
    this.persist(this.snapshot());
    return { ok: true, userId: entry.userId, redirectUri: entry.redirectUri };
  }

  size() {
    return this.states.size;
  }
}
