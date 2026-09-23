/**
 * خادم Telegram وهمي محلي للاختبارات فقط.
 *
 * يُستخدم لتوجيه `TELEGRAM_API_BASE` إليه في الاختبارات، فلا يلمس أي اختبار
 * مزود Telegram الحقيقي ولا يستهلك أي حصة. يفصل بوضوح بين بيئة الاختبار
 * والـRuntime الحقيقي (حيث القاعدة الرسمية api.telegram.org).
 */

import express from 'express';
import type { Server } from 'node:http';

export interface TelegramMockState {
  botId: number;
  username: string;
  firstName: string;
  /** يفشل getMe (رمز مرفوض) عند true. */
  failGetMe: boolean;
  /** يفشل sendMessage عند true. */
  failSend: boolean;
  /** يفشل setWebhook عند true. */
  failSetWebhook: boolean;
  sent: { chatId: string; text: string; messageId: string; replyToMessageId: string | null }[];
  webhookUrl: string | null;
  webhookSecret: string | null;
  webhookDeleted: boolean;
  lastToken: string | null;
}

export function createTelegramMock(): TelegramMockState {
  return {
    botId: 987654321,
    username: 'gharabi_test_bot',
    firstName: 'Gharabi Test',
    failGetMe: false,
    failSend: false,
    failSetWebhook: false,
    sent: [],
    webhookUrl: null,
    webhookSecret: null,
    webhookDeleted: false,
    lastToken: null,
  };
}

/** يشغّل الخادم الوهمي ويعيد المنفذ + حالة التحكم. */
export async function startTelegramMockServer(
  port: number,
  state: TelegramMockState = createTelegramMock(),
): Promise<{ server: Server; state: TelegramMockState; base: string; stop: () => Promise<void> }> {
  const app = express();
  app.use(express.json());

  app.all('/bot:token/*', (req, res) => {
    const m = /^\/bot([^/]+)\//.exec(req.path);
    const token = m ? decodeURIComponent(m[1]) : '';
    state.lastToken = token;
    const method = req.path.split('/').pop();
    if (!token) return res.status(404).json({ ok: false, description: 'invalid token' });
    if (method === 'getMe') {
      if (state.failGetMe) return res.status(401).json({ ok: false, error_code: 401, description: 'Unauthorized' });
      return res.json({ ok: true, result: { id: state.botId, is_bot: true, first_name: state.firstName, username: state.username } });
    }
    if (method === 'setWebhook') {
      if (state.failSetWebhook) return res.json({ ok: false, description: 'bad webhook url' });
      state.webhookUrl = String(req.body?.url || '');
      state.webhookSecret = String(req.body?.secret_token || '');
      state.webhookDeleted = false;
      return res.json({ ok: true, result: true, description: 'Webhook was set' });
    }
    if (method === 'deleteWebhook') {
      state.webhookDeleted = true;
      state.webhookUrl = null;
      return res.json({ ok: true, result: true });
    }
    if (method === 'sendMessage') {
      if (state.failSend) return res.json({ ok: false, error_code: 400, description: 'Bad Request: chat not found' });
      const chatId = String(req.body?.chat_id ?? '');
      const text = String(req.body?.text ?? '');
      const replyToMessageId = req.body?.reply_to_message_id !== undefined ? String(req.body.reply_to_message_id) : null;
      const messageId = String(1000 + state.sent.length);
      state.sent.push({ chatId, text, messageId, replyToMessageId });
      return res.json({ ok: true, result: { message_id: Number(messageId), chat: { id: Number(chatId) || 0 }, text } });
    }
    return res.status(404).json({ ok: false, description: 'unknown method' });
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
