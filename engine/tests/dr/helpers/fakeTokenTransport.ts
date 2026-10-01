/**
 * ناقل رمز وهمي للاختبارات: Gaxios حقيقي مع `request` مُستبدل (يوفّر interceptors
 * التي تتطلّبها مكتبة OAuth2Client) فلا يُلمس Google الحقيقي إطلاقاً.
 */
import { Gaxios } from 'gaxios';

export interface FakeTokenState {
  fail?: string;
  status?: number;
  lastBody?: any;
  lastUrl?: string;
}

export function makeFakeTokenTransport(state: FakeTokenState = {}) {
  const g = new Gaxios();
  g.request = (async (opts: any) => {
    state.lastUrl = opts.url;
    state.lastBody = opts.data ?? opts.body;
    if (state.fail) {
      // gaxios يرمي عند غير 2xx؛ نحاكي شكل الخطأ نفسه (response.status/data).
      const err: any = new Error(state.fail);
      err.response = { status: state.status || 400, data: { error: state.fail } };
      throw err;
    }
    return {
      status: 200,
      headers: {},
      config: {},
      data: {
        access_token: 'ya29.fake-access-token',
        expires_in: 3600,
        refresh_token: '1//fake-refresh-token-not-real-abcdefghijklmnop',
        scope: 'https://www.googleapis.com/auth/drive.file',
        token_type: 'Bearer',
      },
    };
  }) as any;
  return g;
}
