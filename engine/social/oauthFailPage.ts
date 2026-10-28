/**
 * صفحة فشل الربط (2026-10-28) — منطق صافٍ قابل للاختبار.
 *
 * كان رفض المزوّد يظهر للمالك سطراً خاماً على صفحة بيضاء («رفض مزود المنصة عملية الربط: access_denied»)
 * بلا شرح ولا طريق للعودة. الآن صفحة عربية واضحة: ما حدث، السبب المرجّح لهذه المنصة بالذات، الخطوات،
 * وزر للعودة إلى مركز ربط المنصات. لا سرّ ولا state ولا code في الصفحة.
 */

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const NAME_AR: Record<string, string> = { youtube: 'يوتيوب', facebook: 'فيسبوك', instagram: 'إنستغرام', threads: 'ثريدز', tiktok: 'تيك توك', google_business: 'Google Business', whatsapp: 'واتساب', telegram: 'تيليغرام', x: 'X', snapchat: 'سناب شات' };

/** شرح رفض المزوّد (access_denied وأشباهه) بحسب المنصة: السبب المرجّح وخطوات العلاج. */
export function oauthDenialHint(platform: string, providerError: string | null): { cause: string; steps: string[] } | null {
  const err = String(providerError || '').toLowerCase();
  if (!err) return null;
  const denied = err === 'access_denied' || err.includes('denied') || err === 'user_cancelled_login' || err === 'user_denied';
  if (!denied) return null;
  const google = platform === 'youtube' || platform === 'google_business';
  if (google) {
    return {
      cause: 'رفضت Google الطلب قبل منح الإذن. يحدث هذا عند الضغط على «إلغاء» أو «Back to safety»، أو حين يكون حساب Google غير مسموح له بتطبيقك.',
      steps: [
        'إن ظهرت شاشة «Google hasn’t verified this app»: اضغط «Advanced» ثم «Go to … (unsafe)» ثم وافق على كل الأذونات — التطبيق تطبيقك أنت.',
        'إن ظهر «Access blocked» أو «has not completed the Google verification process»: التطبيق ما زال في وضع «Testing». من Google Cloud ← OAuth consent screen أضف بريد حسابك في «Test users» أو اضغط «Publish app».',
        'سجّل الدخول بحساب Google الذي يملك القناة نفسها، ثم اضغط «إعادة الربط» من جديد.',
      ],
    };
  }
  if (platform === 'facebook' || platform === 'instagram' || platform === 'threads') {
    return {
      cause: 'رفضت Meta الطلب: إما ضُغط «إلغاء»، أو لم تُمنح كل الأذونات المطلوبة، أو الحساب ليس مسؤولاً عن التطبيق وهو في وضع التطوير.',
      steps: ['أعد الربط واختر «متابعة» ووافق على كل الأذونات والصفحات.', 'إن كان تطبيق Meta في وضع «Development»: أضف حسابك دوراً (Admin/Tester) في التطبيق أو حوّله إلى «Live».'],
    };
  }
  return { cause: 'رفض المزوّد الطلب قبل منح الإذن (غالباً ضُغط «إلغاء» أو لم تُمنح الأذونات).', steps: ['أعد الربط ووافق على كل الأذونات المطلوبة.'] };
}

export function oauthFailPage(input: { platform: string; message: string; providerError?: string | null; appUrl?: string | null }): string {
  const name = NAME_AR[input.platform] || input.platform;
  const hint = oauthDenialHint(input.platform, input.providerError ?? null);
  const back = input.appUrl ? `${String(input.appUrl).replace(/\/$/, '')}/?tab=platform_connections` : '/?tab=platform_connections';
  const steps = hint ? `<p style="margin:16px 0 6px;color:#fbbf24;font-weight:700">السبب المرجّح</p><p style="margin:0;color:#cbd5e1">${esc(hint.cause)}</p><p style="margin:16px 0 6px;color:#34d399;font-weight:700">ماذا تفعل</p><ol style="margin:0;padding-inline-start:20px;color:#e2e8f0">${hint.steps.map((s) => `<li style="margin:6px 0">${esc(s)}</li>`).join('')}</ol>` : '';
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>لم يكتمل ربط ${esc(name)}</title></head>
<body style="margin:0;padding:20px;background:#0f172a;color:#e2e8f0;font-family:'Segoe UI',Tahoma,Arial,sans-serif;font-size:15px;line-height:1.7">
<main style="max-width:560px;margin:24px auto;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:22px" data-oauth-fail="${esc(input.platform)}">
<h1 style="margin:0 0 8px;font-size:19px;color:#fca5a5">لم يكتمل ربط ${esc(name)}</h1>
<p style="margin:0;color:#94a3b8">${esc(input.message)}</p>
${steps}
<a href="${esc(back)}" style="display:inline-block;margin-top:20px;padding:10px 18px;border-radius:12px;background:#10b981;color:#052e16;font-weight:800;text-decoration:none">العودة إلى ربط المنصات</a>
</main></body></html>`;
}
