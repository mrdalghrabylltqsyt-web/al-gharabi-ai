/**
 * خادم Google Business Profile وهمي محلي للاختبارات فقط.
 *
 * يُستخدم لتوجيه `GOOGLE_BUSINESS_ACCOUNT_BASE` و`GOOGLE_BUSINESS_INFO_BASE`
 * و`GOOGLE_BUSINESS_POSTS_BASE` إليه، فلا يلمس أي اختبار Google الحقيقي ولا
 * يستهلك أي حصة. يُحاكي: قراءة الحسابات، قراءة المواقع، ونشر localPost.
 */

import express from 'express';
import type { Server } from 'node:http';

export interface GoogleBusinessMockState {
  accountResource: string;
  accountName: string;
  locationId: string;
  locationTitle: string;
  /** يفشل قراءة الحسابات عند true (رمز مرفوض). */
  failAccounts: boolean;
  /** يفشل قراءة المواقع عند true. */
  failLocations: boolean;
  /** يفشل نشر localPost عند true. */
  failPublish: boolean;
  /** كود حالة Google المُعاد عند فشل النشر (مثلاً PERMISSION_DENIED). */
  publishErrorStatus: string;
  publishErrorMessage: string;
  posts: { accountId: string; locationId: string; summary: string; linkUrl: string | null; name: string }[];
  lastToken: string | null;
}

export function createGoogleBusinessMock(): GoogleBusinessMockState {
  return {
    accountResource: 'accounts/1122334455',
    accountName: 'معرض الغرابي للتقسيط',
    locationId: '9988776655',
    locationTitle: 'معرض الغرابي - بغداد',
    failAccounts: false,
    failLocations: false,
    failPublish: false,
    publishErrorStatus: 'PERMISSION_DENIED',
    publishErrorMessage: 'The caller does not have permission',
    posts: [],
    lastToken: null,
  };
}

/** يشغّل الخادم الوهمي ويعيد المنفذ + حالة التحكم. */
export async function startGoogleBusinessMockServer(
  port: number,
  state: GoogleBusinessMockState = createGoogleBusinessMock(),
): Promise<{ server: Server; state: GoogleBusinessMockState; base: string; stop: () => Promise<void> }> {
  const app = express();
  app.use(express.json());

  // GET /v1/accounts — قراءة الحسابات.
  app.get('/v1/accounts', (req, res) => {
    state.lastToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
    if (state.failAccounts) return res.status(403).json({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'The caller does not have permission' } });
    return res.json({ accounts: [{ name: state.accountResource, accountName: state.accountName, type: 'PERSONAL' }] });
  });

  // GET /v1/accounts/{account}/locations — قراءة المواقع.
  app.get('/v1/accounts/:account/locations', (req, res) => {
    state.lastToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
    if (state.failLocations) return res.status(403).json({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'The caller does not have permission' } });
    const accountId = req.params.account;
    return res.json({ locations: [{ name: `accounts/${accountId}/locations/${state.locationId}`, title: state.locationTitle }] });
  });

  // POST /v4/accounts/{account}/locations/{location}/localPosts — نشر منشور.
  app.post('/v4/accounts/:account/locations/:location/localPosts', (req, res) => {
    state.lastToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
    if (state.failPublish) return res.status(403).json({ error: { code: 403, status: state.publishErrorStatus, message: state.publishErrorMessage } });
    const summary = String(req.body?.summary || '');
    const linkUrl = req.body?.callToAction?.url ? String(req.body.callToAction.url) : null;
    const name = `accounts/${req.params.account}/locations/${req.params.location}/localPosts/${7000 + state.posts.length}`;
    state.posts.push({ accountId: req.params.account, locationId: req.params.location, summary, linkUrl, name });
    return res.json({ name, summary, state: 'LIVE', createTime: new Date().toISOString() });
  });

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });
  return {
    server,
    state,
    base: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
