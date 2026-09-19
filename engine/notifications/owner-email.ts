/**
 * إرسال رمز تحقق المالك بالبريد عبر Resend الرسمي.
 *
 * كل الإعدادات من متغيرات البيئة فقط؛ لا مفتاح ولا بريد مرسل مكتوب في الكود.
 * لا يُعاد الرمز ولا يُسجَّل في أي سجل — النتيجة المسجلة حالة إرسال مجرّدة.
 */
import { Resend } from "resend";

export type EmailProvider = "resend";

export interface OwnerEmailConfig {
  /** هل مفتاح المزود متاح للـruntime. */
  configured: boolean;
  /** اسم المزود عند توفره، وإلا null. */
  provider: EmailProvider | null;
  /** هل بريد المرسل (From) مضبوط. */
  fromConfigured: boolean;
}

export interface SendOwnerOtpInput {
  to: string;
  code: string;
}

export interface SendOwnerOtpResult {
  sent: boolean;
  provider: EmailProvider | null;
  /** سبب مختصر عند الفشل — لا يحوي أي سر ولا الرمز. */
  error: string | null;
}

function readSecret(name: string): string {
  return (process.env[name] || "").trim();
}

/** حالة إعداد البريد — بلا كشف أي قيمة سرية. */
export function getOwnerEmailConfig(): OwnerEmailConfig {
  const configured = Boolean(readSecret("RESEND_API_KEY"));
  return {
    configured,
    provider: configured ? "resend" : null,
    fromConfigured: Boolean(readSecret("RESEND_FROM_EMAIL")),
  };
}

/** بناء رسالة HTML عربية واضحة للرمز. */
export function buildOwnerOtpHtml(code: string): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;padding:24px;background:#0f172a;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:16px;">
      <tr><td style="padding:28px 24px;text-align:center;">
        <h1 style="margin:0 0 8px;font-size:18px;color:#34d399;">معرض الغرابي للتقسيط</h1>
        <p style="margin:0 0 20px;font-size:13px;color:#94a3b8;">رمز تحقق مالك النظام</p>
        <div style="display:inline-block;padding:14px 24px;background:#0f172a;border:1px solid #334155;border-radius:12px;font-size:32px;font-weight:700;letter-spacing:8px;color:#34d399;direction:ltr;">${code}</div>
        <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;line-height:1.7;">
          أدخل هذا الرمز في شاشة تسجيل الدخول لإتمام التحقق.<br />
          الرمز صالح لمدة <strong style="color:#e2e8f0;">10 دقائق</strong> فقط.
        </p>
        <p style="margin:16px 0 0;font-size:11px;color:#64748b;line-height:1.7;">
          إن لم تطلب هذا الرمز فتجاهل هذه الرسالة، ولا تشاركها مع أي شخص.
        </p>
      </td></tr>
    </table>
  </body>
</html>`;
}

/**
 * إرسال رسالة واحدة عبر Resend. لا retry: محاولة واحدة فقط.
 * تُعيد sent=false مع سبب مختصر عند غياب الإعداد أو فشل الإرسال.
 */
export async function sendOwnerOtpEmail(input: SendOwnerOtpInput): Promise<SendOwnerOtpResult> {
  const apiKey = readSecret("RESEND_API_KEY");
  const from = readSecret("RESEND_FROM_EMAIL");
  if (!apiKey) return { sent: false, provider: null, error: "email_provider_not_configured" };
  if (!from) return { sent: false, provider: "resend", error: "email_from_not_configured" };

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: input.to,
      subject: "رمز تحقق مالك معرض الغرابي",
      html: buildOwnerOtpHtml(input.code),
    });
    if (error) {
      return { sent: false, provider: "resend", error: String((error as any)?.name || "send_failed") };
    }
    return { sent: true, provider: "resend", error: null };
  } catch (err: any) {
    return { sent: false, provider: "resend", error: String(err?.name || "send_failed") };
  }
}