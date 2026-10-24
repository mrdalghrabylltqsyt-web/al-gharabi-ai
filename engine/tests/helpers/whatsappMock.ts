/**
 * خادم WhatsApp Cloud API وهمي محلي للاختبارات فقط.
 *
 * يُستخدم لتوجيه `WHATSAPP_API_BASE` إليه، فلا يلمس أي اختبار مزود Meta الحقيقي
 * ولا يستهلك أي حصة. يفصل بوضوح بيئة الاختبار عن Runtime (graph.facebook.com).
 * يُحاكي: إثبات رقم الأعمال (GET /{id})، إرسال نصّي، إرسال قالب، وقراءة حالة رسالة.
 */

import express from 'express';
import type { Server } from 'node:http';

export interface WhatsAppMockState {
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  /** يفشل إثبات الرقم (رمز/رقم مرفوض) عند true. */
  failVerify: boolean;
  /** يفشل إرسال الرسائل عند true (خطأ مزوّد عام). */
  failSend: boolean;
  /** كود خطأ Meta المُعاد عند فشل الإرسال (افتراضياً 190 لانتهاء الرمز). */
  sendErrorCode: number;
  sendErrorMessage: string;
  /** يفشل إرسال القوالب وحدها (لاختبار السقوط للقالب). */
  failTemplate: boolean;
  sent: { to: string; text: string; messageId: string }[];
  templates: { to: string; name: string; language: string; bodyParams: string[]; messageId: string }[];
  lastToken: string | null;
}

export function createWhatsAppMock(): WhatsAppMockState {
  return {
    phoneNumberId: '109876543210987',
    displayPhoneNumber: '+964 780 000 0000',
    verifiedName: 'معرض الغرابي للتقسيط',
    failVerify: false,
    failSend: false,
    sendErrorCode: 190,
    sendErrorMessage: 'Session has expired',
    failTemplate: false,
    sent: [],
    templates: [],
    lastToken: null,
  };
}

/** يشغّل الخادم الوهمي ويعيد المنفذ + حالة التحكم. */
export async function startWhatsAppMockServer(
  port: number,
  state: WhatsAppMockState = createWhatsAppMock(),
): Promise<{ server: Server; state: WhatsAppMockState; base: string; stop: () => Promise<void> }> {
  const app = express();
  app.use(express.json());

  // GET /v21.0/{phone-number-id} — إثبات رقم الأعمال.
  // GET /v21.0/{message-id}?fields=status — قراءة حالة رسالة (للمصالحة).
  app.get('/v21.0/:id', (req, res) => {
    state.lastToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
    if (req.query.fields === 'status') return res.json({ id: req.params.id, status: 'delivered' });
    if (state.failVerify) return res.status(400).json({ error: { message: 'Invalid phone number id', code: 100 } });
    return res.json({ id: req.params.id, display_phone_number: state.displayPhoneNumber, verified_name: state.verifiedName });
  });

  // POST /v21.0/{phone-number-id}/messages — إرسال نصّي أو قالب.
  app.post('/v21.0/:id/messages', (req, res) => {
    state.lastToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
    const to = String(req.body?.to || '');
    const type = String(req.body?.type || '');
    if (type === 'template') {
      if (state.failTemplate) return res.status(400).json({ error: { message: 'Template does not exist', code: 132001 } });
      if (state.failSend) return res.status(400).json({ error: { message: state.sendErrorMessage, code: state.sendErrorCode } });
      const t = req.body?.template || {};
      const messageId = `wamid.TPL${1000 + state.templates.length}`;
      state.templates.push({ to, name: String(t.name || ''), language: String(t.language?.code || ''), bodyParams: (t.components?.[0]?.parameters || []).map((p: any) => String(p.text || '')), messageId });
      return res.json({ messaging_product: 'whatsapp', contacts: [{ input: to, wa_id: to }], messages: [{ id: messageId }] });
    }
    if (state.failSend) return res.status(400).json({ error: { message: state.sendErrorMessage, code: state.sendErrorCode } });
    const text = String(req.body?.text?.body || '');
    const messageId = `wamid.TXT${1000 + state.sent.length}`;
    state.sent.push({ to, text, messageId });
    return res.json({ messaging_product: 'whatsapp', contacts: [{ input: to, wa_id: to }], messages: [{ id: messageId }] });
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
