import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiService } from '../../services/api';
import {
  Bot,
  RefreshCw,
  Link2Off,
  ShieldCheck,
  Brain,
  MessageSquare,
  BarChart3,
  Send,
  AlertTriangle,
  Inbox,
  CheckCircle2,
  Clock,
  XCircle,
} from 'lucide-react';
import type {
  SocialManagerStatus,
  SocialCapabilitiesResult,
  SocialAnalyticsResult,
  MarketingDecisionResult,
  SocialMemoryResult,
} from '../../types';

const METRIC_LABELS: Record<string, string> = {
  reach: 'الوصول',
  impressions: 'الظهور',
  views: 'المشاهدات',
  likes: 'الإعجابات',
  comments: 'التعليقات',
  shares: 'المشاركات',
  saves: 'الحفظ',
  audience_growth: 'نمو الجمهور',
};

const INTENT_LABELS: Record<string, string> = {
  business_inquiry: 'استفسار تجاري',
  question: 'سؤال',
  complaint: 'شكوى',
  praise: 'مدح',
  spam: 'سبام',
  other: 'أخرى',
};

/**
 * مدير السوشيال ميديا — يعرض حالة حقيقية من الخادم فقط.
 * لا يظهر أي حساب أو متابع أو منشور أو تحليل غير مثبت من مزود فعلي.
 */
export const SocialManagerView: React.FC = () => {
  const { showToast } = useApp();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<SocialManagerStatus | null>(null);
  const [capabilities, setCapabilities] = useState<SocialCapabilitiesResult | null>(null);
  const [memory, setMemory] = useState<SocialMemoryResult | null>(null);
  const [analyticsPlatform, setAnalyticsPlatform] = useState('instagram');
  const [analytics, setAnalytics] = useState<SocialAnalyticsResult | null>(null);
  const [objective, setObjective] = useState('زيادة استفسارات التقسيط من منصات التواصل');
  const [decision, setDecision] = useState<MarketingDecisionResult | null>(null);
  const [classifyText, setClassifyText] = useState('');
  const [classification, setClassification] = useState<any>(null);
  // مصفوفة جاهزية المنصات (Batch 6): تكشف لكل منصة ما هو منفّذ فعلاً وما يحتاج إعداداً خارجياً.
  const [readiness, setReadiness] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c, m, r] = await Promise.all([
        apiService.getSocialManagerStatus(),
        apiService.getSocialCapabilities(),
        apiService.getSocialMemory(),
        apiService.getReadinessMatrix().catch(() => null),
      ]);
      setStatus(s);
      setCapabilities(c);
      setMemory(m);
      setReadiness(r);
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل حالة مدير السوشيال ميديا');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  // تُحمّل حالة webhook الحقيقية بعد تحميل الحالة؛ لا تُسقط الصفحة إن فشلت (مزود غير مضبوط مثلاً).
  useEffect(() => { void loadTelegramWebhookInfo(); }, [load]);

  const loadAnalytics = useCallback(async (platform: string) => {
    try {
      setAnalytics(await apiService.getSocialAnalytics(platform));
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل التحليلات');
    }
  }, [showToast]);

  useEffect(() => { void loadAnalytics(analyticsPlatform); }, [analyticsPlatform, loadAnalytics]);

  const runDecision = async () => {
    try {
      setDecision(await apiService.getMarketingDecision({ objective }));
    } catch (err: any) {
      showToast(err?.message || 'تعذر توليد قرار العقل التسويقي');
    }
  };

  const runClassify = async () => {
    if (!classifyText.trim()) {
      showToast('أدخل نص التعليق لتصنيفه.');
      return;
    }
    try {
      setClassification(await apiService.classifySocialComment(classifyText, analyticsPlatform));
    } catch (err: any) {
      showToast(err?.message || 'تعذر تصنيف التعليق');
    }
  };

  const platforms = status?.platforms || [];
  const summary = status?.summary;

  // ---- موصل Telegram الحقيقي: أول تكامل اجتماعي خارجي فعلي ----
  const telegram = platforms.find((p) => p.platform === 'telegram');
  const [tgBusy, setTgBusy] = useState(false);
  const [tgExternalId, setTgExternalId] = useState('');
  const [tgReplyText, setTgReplyText] = useState('');
  const [tgWebhookInfo, setTgWebhookInfo] = useState<any | null>(null);
  const [tgIncoming, setTgIncoming] = useState<any[]>([]);

  const loadTelegramWebhookInfo = async () => {
    try { setTgWebhookInfo(await apiService.getTelegramWebhookInfo()); }
    catch { setTgWebhookInfo(null); }
  };

  // الرسائل الواردة من Telegram عبر webhook الحقيقي — تُعرض بحالة استقبال
  // منفصلة عن حالة إرسال الرد، فلا تظهر كـ simulated/not delivered.
  const loadTelegramIncoming = useCallback(async () => {
    try {
      const res = await apiService.getSocialComments('telegram');
      setTgIncoming(res.comments || []);
    } catch { setTgIncoming([]); }
  }, []);

  useEffect(() => { void loadTelegramIncoming(); }, [loadTelegramIncoming]);

  const connectTelegram = async () => {
    setTgBusy(true);
    try {
      // الرمز يُقرأ من بيئة الخادم (TELEGRAM_BOT_TOKEN)؛ لا نطلب نسخ أي سر إلى الواجهة.
      const res = await apiService.configureTelegram();
      showToast(res.verified ? 'تم التحقق من البوت وتسجيل webhook الحقيقي.' : 'تم تنفيذ الربط.');
      await load();
      await loadTelegramWebhookInfo();
    } catch (err: any) {
      showToast(err?.message || 'تعذر ربط Telegram');
    } finally { setTgBusy(false); }
  };

  const sendTelegramReply = async () => {
    if (!tgExternalId.trim() || !tgReplyText.trim()) { showToast('معرّف التعليق ونص الرد مطلوبان.'); return; }
    setTgBusy(true);
    try {
      const res = await apiService.replyTelegram({ externalId: tgExternalId.trim(), text: tgReplyText.trim() });
      showToast(res.delivered ? `أُرسل الرد فعلياً عبر Telegram (معرّف ${res.providerReplyId || '—'}).` : 'لم يُسجَّل تسليم.');
      setTgReplyText('');
      await loadTelegramIncoming();
    } catch (err: any) {
      showToast(err?.message || 'تعذر إرسال الرد عبر Telegram');
    } finally { setTgBusy(false); }
  };

  // ---- موصل Facebook الحقيقي: تعليقات الصفحة + رسائل Messenger (منفصلة) ----
  const facebook = platforms.find((p) => p.platform === 'facebook');
  // حالة «بانتظار اختيار الصفحة» تأتي من مصفوفة الجاهزية الحقيقية (حساب يدير أكثر من صفحة).
  const fbReadinessRow = (readiness?.platforms || []).find((r: any) => r.platform === 'facebook');
  const fbPageSelectionPending = fbReadinessRow?.pageSelectionPending === true;
  const [fbBusy, setFbBusy] = useState(false);
  const [fbWebhookInfo, setFbWebhookInfo] = useState<any | null>(null);
  const [fbIncoming, setFbIncoming] = useState<any[]>([]);
  const [fbPages, setFbPages] = useState<any[] | null>(null);
  const [fbSetup, setFbSetup] = useState<any | null>(null);
  const [fbReplyId, setFbReplyId] = useState('');
  const [fbReplyText, setFbReplyText] = useState('');
  const [fbMsgRecipient, setFbMsgRecipient] = useState('');
  const [fbMsgText, setFbMsgText] = useState('');

  const loadFacebookPages = async () => {
    setFbBusy(true);
    try { const res = await apiService.getFacebookPages(); setFbPages(res.pages || []); }
    catch (err: any) { showToast(err?.message || 'تعذر جلب صفحات Facebook'); }
    finally { setFbBusy(false); }
  };
  const chooseFacebookPage = async (pageId: string) => {
    setFbBusy(true);
    try {
      const res = await apiService.selectFacebookPage(pageId);
      showToast(res.webhookSubscribed ? 'تم ربط الصفحة والاشتراك في webhook.' : 'تم ربط الصفحة، لكن اشتراك webhook لم يُثبت.');
      setFbPages(null);
      await load();
      await loadFacebookWebhookInfo();
    } catch (err: any) { showToast(err?.message || 'تعذر ربط الصفحة'); }
    finally { setFbBusy(false); }
  };

  const loadFacebookWebhookInfo = async () => {
    try { setFbWebhookInfo(await apiService.getFacebookWebhookInfo()); }
    catch { setFbWebhookInfo(null); }
  };
  const loadFacebookIncoming = useCallback(async () => {
    try { const res = await apiService.getSocialComments('facebook'); setFbIncoming(res.comments || []); }
    catch { setFbIncoming([]); }
  }, []);
  useEffect(() => { void loadFacebookIncoming(); }, [loadFacebookIncoming]);

  const connectFacebook = async () => {
    setFbBusy(true);
    try {
      const res = await apiService.startPlatformOAuth('facebook');
      if (res?.authorizationUrl) { window.location.href = res.authorizationUrl; return; }
      showToast('تم بدء ربط Facebook.');
    } catch (err: any) {
      // عند رفض العنوان العام (localhost/بلا https) أو غياب الإعداد، نُبرز الرابط
      // والنطاق الفعليين ليُسجّلهما المالك لدى Meta بدل رسالة فشل غامضة.
      showToast((err?.code ? `[${err.code}] ` : '') + (err?.message || 'تعذر بدء ربط Facebook'));
      try { const setup = await apiService.getPlatformOAuthSetup('facebook'); setFbSetup(setup); } catch { /* اختياري */ }
    }
    finally { setFbBusy(false); }
  };
  const sendFacebookCommentReply = async () => {
    if (!fbReplyId.trim() || !fbReplyText.trim()) { showToast('معرّف التعليق ونص الرد مطلوبان.'); return; }
    setFbBusy(true);
    try {
      const res = await apiService.replyFacebook({ externalId: fbReplyId.trim(), text: fbReplyText.trim() });
      showToast(res.delivered ? `أُرسل الرد فعلياً على التعليق (معرّف ${res.providerReplyId || '—'}).` : 'لم يُسجَّل تسليم من Facebook.');
      setFbReplyText('');
      await loadFacebookIncoming();
    } catch (err: any) { showToast(err?.message || 'تعذر إرسال الرد عبر Facebook'); }
    finally { setFbBusy(false); }
  };
  const sendFacebookMessage = async () => {
    if (!fbMsgRecipient.trim() || !fbMsgText.trim()) { showToast('معرّف المستلم ونص الرسالة مطلوبان.'); return; }
    setFbBusy(true);
    try {
      const res = await apiService.messageReplyFacebook({ recipientId: fbMsgRecipient.trim(), text: fbMsgText.trim() });
      showToast(res.delivered ? `أُرسلت الرسالة فعلياً (معرّف ${res.providerReplyId || '—'}).` : 'لم يُسجَّل تسليم من Facebook.');
      setFbMsgText('');
      await loadFacebookIncoming();
    } catch (err: any) { showToast(err?.message || 'تعذر إرسال الرسالة عبر Facebook'); }
    finally { setFbBusy(false); }
  };
  useEffect(() => { void loadFacebookWebhookInfo(); }, [load]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <Bot className="w-5 h-5 text-emerald-400" />
            مدير السوشيال ميديا الذكي
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            إدارة دورة السوشيال ميديا: التخطيط، المحتوى، التعليقات، النشر، والتحليل — مع بقاء القرار النهائي للمالك.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-white flex items-center gap-2 cursor-pointer disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> تحديث
        </button>
      </div>

      <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-500/20 text-xs text-amber-200 flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          المنصة لا تُعد متصلة إلا بعد إتمام OAuth والتحقق من المزود. لا يُسجَّل أي نشر ناجح بدون معرّف منشور حقيقي
          من المنصة، ولا تُعرض أي متابعين أو تحليلات غير مثبتة من مزود فعلي.
        </span>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
          <span className="text-xs text-slate-400 block font-semibold">المنصات المتصلة</span>
          <div className="text-2xl sm:text-3xl font-black text-emerald-400">{summary?.connected ?? 0}</div>
          <p className="text-[11px] text-slate-500">من أصل {summary?.totalPlatforms ?? 10} منصة مدعومة</p>
        </div>
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
          <span className="text-xs text-slate-400 block font-semibold">غير متصلة</span>
          <div className="text-2xl sm:text-3xl font-black text-slate-300">{summary?.disconnected ?? 0}</div>
          <p className="text-[11px] text-slate-500">لا تُنفَّذ لها أي عملية خارجية</p>
        </div>
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
          <span className="text-xs text-slate-400 block font-semibold">تعليقات مُتابَعة</span>
          <div className="text-2xl sm:text-3xl font-black text-blue-400">{status?.activity.commentsTracked ?? 0}</div>
          <p className="text-[11px] text-slate-500">سجلات فعلية داخل النظام</p>
        </div>
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
          <span className="text-xs text-slate-400 block font-semibold">منشورات مؤكدة</span>
          <div className="text-2xl sm:text-3xl font-black text-white">{status?.content.published ?? 0}</div>
          <p className="text-[11px] text-slate-500">تتطلب إيصالاً حقيقياً من المزود</p>
        </div>
      </div>

      {/* Platforms table */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
        <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-3 mb-5 flex items-center gap-2">
          <Link2Off className="w-4 h-4 text-slate-400" /> حالة المنصات والقدرات الرسمية
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 text-right border-b border-slate-800">
                <th className="py-2 px-3 font-semibold">المنصة</th>
                <th className="py-2 px-3 font-semibold">الحالة</th>
                <th className="py-2 px-3 font-semibold">القدرات المعلنة</th>
                <th className="py-2 px-3 font-semibold">جاهزية النشر</th>
              </tr>
            </thead>
            <tbody>
              {platforms.map((p) => (
                <tr key={p.platform} className="border-b border-slate-800/60">
                  <td className="py-3 px-3 font-bold text-white">
                    <span className="inline-flex items-center gap-2">
                      {p.displayName}
                      {p.realConnector && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-600/40 text-emerald-300 font-semibold">
                          موصل حقيقي
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    {p.connection === 'connected' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> متصلة
                      </span>
                    ) : p.connection === 'reauth_needed' ? (
                      <span className="inline-flex items-center gap-1 text-amber-400 font-bold">
                        <AlertTriangle className="w-3.5 h-3.5" /> تحتاج إعادة ربط
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-500 font-bold">
                        <XCircle className="w-3.5 h-3.5" /> غير متصلة
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex flex-wrap gap-1">
                      {p.capabilities.map((c) => (
                        <span key={c} className="px-2 py-0.5 rounded-md bg-slate-950 border border-slate-700 text-[10px] text-slate-300">
                          {c}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-slate-400">{p.productionReady ? 'جاهزة' : 'غير جاهزة'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500 mt-4">{platforms[0]?.readinessNote}</p>
      </div>

      {/* مصفوفة جاهزية المنصات (Batch 6) — منفّذ فعلاً مقابل ما يحتاج إعداداً خارجياً */}
      {readiness && (
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
          <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-3 mb-2 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" /> مصفوفة جاهزية المنصات العشر
          </h3>
          <p className="text-[11px] text-slate-500 mb-4">
            READY = منفّذ في الكود · <span className="text-amber-400">إعداد خارجي</span> = البنية جاهزة وتحتاج إجراءً من المزود · NOT_SUPPORTED = المنصة لا توفرها رسمياً.
            {readiness.summary && <> — موصل جاهز: {readiness.summary.connectorReady} · أساس جاهز: {readiness.summary.foundationReady}</>}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-slate-400 text-right border-b border-slate-800">
                  <th className="py-2 px-2 font-semibold">المنصة</th>
                  <th className="py-2 px-2 font-semibold">الموصل</th>
                  <th className="py-2 px-2 font-semibold">OAuth</th>
                  <th className="py-2 px-2 font-semibold">التحقق</th>
                  <th className="py-2 px-2 font-semibold">Webhook</th>
                  <th className="py-2 px-2 font-semibold">قراءة</th>
                  <th className="py-2 px-2 font-semibold">رد</th>
                  <th className="py-2 px-2 font-semibold">نشر</th>
                  <th className="py-2 px-2 font-semibold">جدولة</th>
                  <th className="py-2 px-2 font-semibold">تحليلات</th>
                </tr>
              </thead>
              <tbody>
                {(readiness.platforms || []).map((r: any) => {
                  const cell = (v: string) => v === 'READY'
                    ? <span className="text-emerald-400 font-bold">READY</span>
                    : v === 'EXTERNAL_SETUP_REQUIRED'
                      ? <span className="text-amber-400">إعداد خارجي</span>
                      : <span className="text-slate-600">غير مدعوم</span>;
                  return (
                    <tr key={r.platform} className="border-b border-slate-800/60">
                      <td className="py-2 px-2 font-bold text-white whitespace-nowrap">{r.displayName}</td>
                      <td className="py-2 px-2">{cell(r.connector)}</td>
                      <td className="py-2 px-2">{cell(r.oauth)}</td>
                      <td className="py-2 px-2">{cell(r.verification)}</td>
                      <td className="py-2 px-2">{cell(r.webhook)}</td>
                      <td className="py-2 px-2">{cell(r.read)}</td>
                      <td className="py-2 px-2">{cell(r.reply)}</td>
                      <td className="py-2 px-2">{cell(r.publish)}</td>
                      <td className="py-2 px-2">{cell(r.schedule)}</td>
                      <td className="py-2 px-2">{cell(r.analytics)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Telegram real connector — أول تكامل اجتماعي حقيقي */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-5">
        <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-3 flex items-center gap-2">
          <Send className="w-4 h-4 text-sky-400" /> موصل Telegram (تكامل خارجي حقيقي)
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-3">
            <div className="text-xs text-slate-300 space-y-1">
              <div>حالة الاتصال: <span className={telegram?.connection === 'connected' ? 'text-emerald-400 font-bold' : 'text-slate-400 font-bold'}>{telegram?.connection === 'connected' ? 'متصلة وموثقة' : telegram?.connection === 'reauth_needed' ? 'تحتاج إعادة ربط' : 'غير متصلة'}</span></div>
              {telegram?.accountName && <div>الحساب: <span className="font-mono text-slate-200">{telegram.accountName}</span></div>}
              <div>آلية الاعتماد: <span className="font-mono text-slate-200">bot-token</span></div>
            </div>
            <p className="text-[11px] text-slate-500">
              الربط يستدعي Telegram فعلياً (getMe) ويسجّل webhook حقيقياً بسرّ تحقق. رمز البوت يُقرأ من بيئة الخادم
              (TELEGRAM_BOT_TOKEN) ولا يُدخل في الواجهة. لا تُعلن «متصلة» بلا تحقق مزود.
            </p>
            <button
              onClick={() => void connectTelegram()}
              disabled={tgBusy}
              className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer">
              {telegram?.connection === 'connected' ? 'إعادة التحقق من الربط' : 'ربط Telegram والتحقق'}
            </button>
          </div>
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-200">إرسال رد حقيقي على رسالة Telegram واردة</h4>
            {tgIncoming.length > 0 && (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {tgIncoming.slice(0, 12).map((c: any) => {
                  const selected = tgExternalId === c.externalId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setTgExternalId(c.externalId)}
                      className={`w-full text-right p-2.5 rounded-xl border transition cursor-pointer ${
                        selected ? 'bg-emerald-950/40 border-emerald-500/40' : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold text-sky-300">مستلمة فعلياً</span>
                        <span className="text-[10px] font-mono text-slate-400" dir="ltr">{c.externalId}</span>
                      </div>
                      <div className="text-[11px] text-slate-200 mt-1 line-clamp-2">{c.text}</div>
                    </button>
                  );
                })}
              </div>
            )}
            <input
              value={tgExternalId}
              onChange={(e) => setTgExternalId(e.target.value)}
              placeholder="معرّف الرسالة الخارجي (مثال: tg:-100123:42)"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500 box-border"
            />
            <textarea
              rows={3}
              value={tgReplyText}
              onChange={(e) => setTgReplyText(e.target.value)}
              placeholder="نص الرد (يُرسل فعلياً عبر Telegram ويمر بحارس سلامة المحتوى ومنع التكرار على الخادم)"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500 box-border"
            />
            <button
              onClick={() => void sendTelegramReply()}
              disabled={tgBusy}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer">
              إرسال فعلي عبر Telegram
            </button>
            <p className="text-[10px] text-slate-500">
              لا يُسجَّل التسليم إلا باستجابة Telegram حقيقية تحمل معرّف رسالة. فشل الإرسال يُعرض كما هو بلا ادعاء تسليم.
            </p>
          </div>
        </div>

        {/* حالة webhook الحقيقية من Telegram (getWebhookInfo) — إثبات الاستقبال لا لون الزر */}
        <div className="pt-4 border-t border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> حالة استقبال Telegram (getWebhookInfo)
            </h4>
            <button
              onClick={() => void loadTelegramWebhookInfo()}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold cursor-pointer">
              تحديث الحالة
            </button>
          </div>
          {!tgWebhookInfo ? (
            <p className="text-[11px] text-slate-500">لم تُحمّل بعد — اضغط «تحديث الحالة» أو اربط البوت أولاً. الحالة تُقرأ فعلياً من Telegram بلا أي سرّ.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex justify-between">
                <span className="text-slate-400">حالة التسجيل</span>
                <span className={tgWebhookInfo.status === 'registered' ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                  {tgWebhookInfo.status === 'registered' ? 'مسجّل ومطابق'
                    : tgWebhookInfo.status === 'url_mismatch' ? 'رابط غير مطابق'
                    : tgWebhookInfo.status === 'not_registered' ? 'غير مسجّل'
                    : tgWebhookInfo.status === 'secret_missing' ? 'سرّ غير محفوظ'
                    : 'غير متاح'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex justify-between">
                <span className="text-slate-400">تحديثات معلّقة</span>
                <span className="text-slate-100 font-mono">{tgWebhookInfo.pendingUpdateCount}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 sm:col-span-2">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400 whitespace-nowrap">الرابط المسجّل لدى Telegram</span>
                  <span className="text-slate-200 font-mono break-all text-left" dir="ltr">{tgWebhookInfo.registeredUrl || '—'}</span>
                </div>
                <div className="flex justify-between gap-3 mt-1">
                  <span className="text-slate-400 whitespace-nowrap">رابط هذا الخادم</span>
                  <span className="text-slate-200 font-mono break-all text-left" dir="ltr">{tgWebhookInfo.expectedUrl}</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex justify-between">
                <span className="text-slate-400">مصدر السرّ</span>
                <span className="text-slate-100 font-mono">{tgWebhookInfo.secretSource === 'stored' ? 'محفوظ مشفّراً' : tgWebhookInfo.secretSource === 'env' ? 'بيئة الخادم' : 'غير مضبوط'}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex justify-between">
                <span className="text-slate-400">آخر خطأ دفع</span>
                <span className="text-slate-100">{tgWebhookInfo.lastErrorDate ? new Date(tgWebhookInfo.lastErrorDate).toLocaleString('ar') : 'لا يوجد'}</span>
              </div>
              <p className="text-[11px] leading-relaxed sm:col-span-2 text-slate-400">{tgWebhookInfo.detail}</p>
              {tgWebhookInfo.lastErrorMessage && (
                <p className="text-[11px] sm:col-span-2 text-amber-300">آخر خطأ من Telegram: {tgWebhookInfo.lastErrorMessage}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Facebook real connector — تعليقات الصفحة ورسائل Messenger (منفصلان) */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-5">
        <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-3 flex items-center gap-2">
          <Send className="w-4 h-4 text-blue-400" /> موصل Facebook (تكامل خارجي حقيقي)
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="space-y-3">
            <div className="text-xs text-slate-300 space-y-1">
              <div>حالة الاتصال: <span className={facebook?.connection === 'connected' ? 'text-emerald-400 font-bold' : 'text-slate-400 font-bold'}>{facebook?.connection === 'connected' ? 'متصلة وموثقة' : facebook?.connection === 'reauth_needed' ? 'تحتاج إعادة ربط' : 'غير متصلة'}</span></div>
              {facebook?.accountName && <div>الصفحة: <span className="font-mono text-slate-200">{facebook.accountName}</span></div>}
              <div>آلية الاعتماد: <span className="font-mono text-slate-200">oauth2 (Meta)</span></div>
            </div>
            <p className="text-[11px] text-slate-500">
              الربط خاص بصفحات Facebook لا بالحساب الشخصي: OAuth ← اختيار الصفحة ← تبادل رمز الصفحة ← اشتراك في webhook.
              الأسرار من بيئة الخادم فقط (FACEBOOK_OAUTH_CLIENT_ID/SECRET, FACEBOOK_APP_SECRET, FACEBOOK_VERIFY_TOKEN) ولا تُدخل في الواجهة.
            </p>
            {fbPageSelectionPending && (
              <div className="rounded-xl border border-sky-600/40 bg-sky-500/10 p-3 space-y-2">
                <p className="text-[11px] text-sky-200">
                  تم تفويض Facebook بنجاح، لكن الحساب يدير أكثر من صفحة. اختر الصفحة المطلوبة لإتمام الربط والاشتراك في webhook.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void loadFacebookPages()}
                    disabled={fbBusy}
                    className="px-3 py-1.5 rounded-lg bg-sky-500 text-slate-950 text-[11px] font-black cursor-pointer disabled:opacity-50">
                    جلب الصفحات
                  </button>
                </div>
                {fbPages && fbPages.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {fbPages.map((pg: any) => (
                      <button key={pg.pageId} onClick={() => void chooseFacebookPage(pg.pageId)} disabled={fbBusy}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-[11px] font-bold text-white cursor-pointer disabled:opacity-50">
                        {pg.pageName || pg.pageId}
                      </button>
                    ))}
                  </div>
                )}
                {fbPages && fbPages.length === 0 && <p className="text-[11px] text-slate-400">لا صفحات يديرها هذا الحساب.</p>}
              </div>
            )}
            <button
              onClick={() => void connectFacebook()}
              disabled={fbBusy}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer">
              {facebook?.connection === 'connected' ? 'إعادة ربط الصفحة' : 'ربط صفحة Facebook'}
            </button>
            {fbSetup && (
              <div className="rounded-xl border border-amber-600/40 bg-amber-500/10 p-3 space-y-1 text-[11px]" dir="rtl">
                <p className="text-amber-200 font-bold">إعداد OAuth المطلوب لدى Meta (قيَم حقيقية بلا أسرار):</p>
                {fbSetup.publicUrlIsPublic === false && (
                  <p className="text-amber-300">
                    العنوان العام غير إنتاجي ({fbSetup.publicUrlSource}: {fbSetup.publicUrlProblems?.[0] || 'غير صالح'}). اضبط APP_URL على نطاقك العام (https) أولاً، وإلا سيرفض Meta رابط الإرجاع.
                  </p>
                )}
                <div className="flex flex-col gap-0.5">
                  <span className="text-slate-400">Valid OAuth Redirect URIs:</span>
                  <code dir="ltr" className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-emerald-300 break-all text-left select-all">{fbSetup.redirectUri}</code>
                  {fbSetup.appDomainsValue && (<>
                    <span className="text-slate-400 mt-1">App Domains:</span>
                    <code dir="ltr" className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-sky-300 break-all text-left select-all">{fbSetup.appDomainsValue}</code>
                  </>)}
                  {fbSetup.webhookUrl && (<>
                    <span className="text-slate-400 mt-1">Webhook Callback URL:</span>
                    <code dir="ltr" className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-slate-300 break-all text-left select-all">{fbSetup.webhookUrl}</code>
                  </>)}
                </div>
                <p className="text-slate-500">افتح Meta Dashboard ← Facebook Login ← Settings ← Client OAuth Settings، والصق القيم أعلاه ثم احفظ.</p>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-200">رد حقيقي على تعليق Facebook (comment_reply)</h4>
            <input
              value={fbReplyId}
              onChange={(e) => setFbReplyId(e.target.value)}
              placeholder="معرّف التعليق الخارجي (comment_id)"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500 box-border"
            />
            <textarea
              rows={3}
              value={fbReplyText}
              onChange={(e) => setFbReplyText(e.target.value)}
              placeholder="نص الرد على التعليق (يُرسل فعلياً ويمر بحارس سلامة المحتوى ومنع التكرار)"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500 box-border"
            />
            <button
              onClick={() => void sendFacebookCommentReply()}
              disabled={fbBusy}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer">
              إرسال فعلي كرد على تعليق
            </button>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-200">إرسال رسالة Messenger حقيقية (message_reply)</h4>
            <input
              value={fbMsgRecipient}
              onChange={(e) => setFbMsgRecipient(e.target.value)}
              placeholder="معرّف المستلم (PSID)"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500 box-border"
            />
            <textarea
              rows={3}
              value={fbMsgText}
              onChange={(e) => setFbMsgText(e.target.value)}
              placeholder="نص الرسالة (يُرسل فعلياً كرسالة Messenger، وليس تعليقاً)"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500 box-border"
            />
            <button
              onClick={() => void sendFacebookMessage()}
              disabled={fbBusy}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer">
              إرسال فعلي كرسالة
            </button>
            <p className="text-[10px] text-slate-500">لا يُسجَّل التسليم إلا باستجابة Meta حقيقية تحمل معرّفاً. فشل الإرسال يُعرض كما هو.</p>
          </div>
        </div>

        {/* الرسائل والتعليقات الواردة فعلياً عبر webhook Facebook */}
        {fbIncoming.length > 0 && (
          <div className="pt-4 border-t border-slate-800 space-y-2">
            <h4 className="text-xs font-bold text-slate-200">الوارد فعلياً من Facebook عبر webhook</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
              {fbIncoming.slice(0, 12).map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => setFbReplyId(c.externalId)}
                  className="text-right p-2.5 rounded-xl border bg-slate-950 border-slate-800 hover:border-slate-700 cursor-pointer">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-bold ${c.kind === 'message' ? 'text-indigo-300' : 'text-sky-300'}`}>
                      {c.kind === 'message' ? 'رسالة' : 'تعليق'} • مستلمة فعلياً
                    </span>
                    <span className="text-[10px] font-mono text-slate-400" dir="ltr">{c.externalId}</span>
                  </div>
                  <div className="text-[11px] text-slate-200 mt-1 line-clamp-2">{c.text}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* حالة اشتراك صفحة Facebook في webhook — حقيقية من Meta لا لون زر */}
        <div className="pt-4 border-t border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> حالة استقبال Facebook (اشتراك الصفحة)
            </h4>
            <button
              onClick={() => void loadFacebookWebhookInfo()}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold cursor-pointer">
              تحديث الحالة
            </button>
          </div>
          {!fbWebhookInfo ? (
            <p className="text-[11px] text-slate-500">لم تُحمّل بعد — تُقرأ الحالة فعلياً من Meta بلا أي سرّ.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex justify-between">
                <span className="text-slate-400">اشتراك الصفحة</span>
                <span className={fbWebhookInfo.appSubscribed ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                  {fbWebhookInfo.appSubscribed ? 'مشتركة فعلياً' : 'لا اشتراك مثبت'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex justify-between">
                <span className="text-slate-400">رمز التحقق</span>
                <span className={fbWebhookInfo.verifyTokenConfigured ? 'text-emerald-400 font-bold' : 'text-slate-400 font-bold'}>
                  {fbWebhookInfo.verifyTokenConfigured ? 'مضبوط' : 'ناقص'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex justify-between">
                <span className="text-slate-400">سرّ التوقيع (App Secret)</span>
                <span className={fbWebhookInfo.signatureSecretConfigured ? 'text-emerald-400 font-bold' : 'text-slate-400 font-bold'}>
                  {fbWebhookInfo.signatureSecretConfigured ? 'مضبوط' : 'ناقص'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400 whitespace-nowrap">رابط الـwebhook</span>
                  <span className="text-slate-200 font-mono break-all text-left" dir="ltr">{fbWebhookInfo.webhookUrl || '—'}</span>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed sm:col-span-2 text-slate-400">{fbWebhookInfo.detail}</p>
            </div>
          )}
        </div>
      </div>


      {/* Comment classification */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
          <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-3 mb-5 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-blue-400" /> تصنيف التعليقات (حتمي، بلا استهلاك حصة)
          </h3>
          <textarea
            rows={3}
            value={classifyText}
            onChange={(e) => setClassifyText(e.target.value)}
            placeholder="مثال: بكم سعر الغسالة بالتقسيط؟"
            className="w-full px-3 py-3 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500 box-border"
          />
          <button
            onClick={() => void runClassify()}
            className="mt-3 w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold cursor-pointer">
            تصنيف التعليق
          </button>
          {classification && (
            <div className="mt-4 p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">النية</span>
                <span className="text-white font-bold">{INTENT_LABELS[classification.classification.intent] || classification.classification.intent}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">الرد الآلي</span>
                <span className={classification.autoReplyAllowed ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                  {classification.autoReplyAllowed ? 'مسموح' : 'يتطلب مراجعة بشرية'}
                </span>
              </div>
              {classification.suggestedDeterministicReply && (
                <div className="pt-2 border-t border-slate-800 text-slate-300 leading-relaxed">
                  {classification.suggestedDeterministicReply}
                </div>
              )}
              {classification.contentSafety && (
                <div className={`pt-2 border-t border-slate-800 text-[11px] font-bold ${classification.contentSafety.safe ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {classification.contentSafety.safe ? 'الرد المقترح اجتاز حارس سلامة المحتوى.' : 'الرد المقترح محجوب: يحمل عرضاً غير مسجّل في بيانات المعرض.'}
                </div>
              )}
              {!classification.autoReplyAllowed && classification.classification.reviewReason && (
                <p className="text-amber-300 pt-2 border-t border-slate-800">{classification.classification.reviewReason}</p>
              )}
            </div>
          )}
        </div>

        {/* Analytics */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-5">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-400" /> تحليلات المنصة
            </h3>
            <select
              value={analyticsPlatform}
              onChange={(e) => setAnalyticsPlatform(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-[11px] text-white">
              {(capabilities?.platforms || []).map((p) => (
                <option key={p.platform} value={p.platform}>{p.displayName}</option>
              ))}
            </select>
          </div>
          {analytics ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {analytics.metrics.map((m) => (
                  <div key={m.metric} className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">{METRIC_LABELS[m.metric] || m.metric}</span>
                    <span className={`text-sm font-black ${m.available && m.value !== null ? 'text-white' : 'text-slate-600'}`}>
                      {m.available ? (m.value === null ? 'لا توجد بيانات' : m.value.toLocaleString('en-US')) : 'غير متاح'}
                    </span>
                    {!m.available && m.reason && <p className="text-[9px] text-slate-600 mt-1 leading-tight">{m.reason}</p>}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-3">{analytics.note}</p>
            </>
          ) : (
            <p className="text-xs text-slate-500">جارٍ التحميل...</p>
          )}
        </div>
      </div>

      {/* Marketing brain */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
        <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-3 mb-5 flex items-center gap-2">
          <Brain className="w-4 h-4 text-purple-400" /> العقل التسويقي — قرار مبني على البيانات الفعلية
        </h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            className="flex-1 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500"
          />
          <button
            onClick={() => void runDecision()}
            className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold cursor-pointer flex items-center gap-2 justify-center">
            <Send className="w-3.5 h-3.5" /> توليد القرار
          </button>
        </div>

        {decision && (
          <div className="mt-5 space-y-4">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[11px] text-slate-400 block mb-2 font-semibold">شرائح الجمهور</span>
              <div className="flex flex-wrap gap-1.5">
                {decision.decision.audience.segments.map((s) => (
                  <span key={s} className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-[10px] text-slate-200">{s}</span>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-2">{decision.decision.audience.note}</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 text-right border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold">المنصة</th>
                    <th className="py-2 px-3 font-semibold">نوع المحتوى</th>
                    <th className="py-2 px-3 font-semibold">التوقيت</th>
                    <th className="py-2 px-3 font-semibold">مؤشر النجاح</th>
                  </tr>
                </thead>
                <tbody>
                  {decision.decision.plan.map((p) => (
                    <tr key={p.platform} className="border-b border-slate-800/60">
                      <td className="py-3 px-3 font-bold text-white">{p.platform}</td>
                      <td className="py-3 px-3 text-slate-300">{p.contentType}</td>
                      <td className="py-3 px-3 text-slate-300">
                        {p.suggestedTiming}
                        <span className={`block text-[10px] ${p.timingConfidence === 'measured' ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {p.timingConfidence === 'measured' ? 'مقاس من بيانات' : 'تقديري'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-300">
                        {p.successMetric}
                        {!p.metricAvailable && <span className="block text-[10px] text-slate-600">غير متاح من المنصة</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {decision.decision.dataGaps.length > 0 && (
              <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/20">
                <span className="text-[11px] text-amber-300 font-bold block mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> فجوات بيانات معلنة
                </span>
                <ul className="space-y-1">
                  {decision.decision.dataGaps.map((g) => (
                    <li key={g} className="text-[11px] text-amber-200/90">• {g}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[11px] text-slate-400 font-semibold block mb-2">ما تعلمناه</span>
                <ul className="space-y-1">
                  {decision.decision.learnings.map((l) => (
                    <li key={l} className="text-[11px] text-slate-300">• {l}</li>
                  ))}
                </ul>
              </div>
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[11px] text-slate-400 font-semibold block mb-2">تعديل المنشور القادم</span>
                <p className="text-[11px] text-slate-300 leading-relaxed">{decision.decision.nextAdjustment}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Memory */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
        <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-3 mb-5 flex items-center gap-2">
          <Inbox className="w-4 h-4 text-amber-400" /> الذاكرة التشغيلية للسوشيال ميديا
        </h3>
        {memory ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[11px] text-slate-400 block mb-2 font-semibold">النشر</span>
              <p className="text-xs text-slate-300">منشور مؤكد: <span className="text-white font-bold">{memory.memory.publishedCount}</span></p>
              <p className="text-xs text-slate-300 mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3" /> مجدول: <span className="text-white font-bold">{memory.memory.scheduledCount}</span>
              </p>
            </div>
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[11px] text-slate-400 block mb-2 font-semibold">الأسئلة المتكررة</span>
              {memory.memory.frequentQuestions.length ? (
                <ul className="space-y-1">
                  {memory.memory.frequentQuestions.slice(0, 4).map((q) => (
                    <li key={q} className="text-[11px] text-slate-300">• {q}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-slate-500">لا توجد أسئلة مسجلة بعد.</p>
              )}
            </div>
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[11px] text-slate-400 block mb-2 font-semibold">أنواع المحتوى</span>
              {Object.keys(memory.memory.contentTypeBreakdown).length ? (
                <ul className="space-y-1">
                  {Object.entries(memory.memory.contentTypeBreakdown).slice(0, 4).map(([k, v]) => (
                    <li key={k} className="text-[11px] text-slate-300">• {k}: {v}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-slate-500">لا توجد وسوم محتوى مسجلة بعد.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">جارٍ التحميل...</p>
        )}
      </div>
    </div>
  );
};
