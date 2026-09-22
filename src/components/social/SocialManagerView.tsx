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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c, m] = await Promise.all([
        apiService.getSocialManagerStatus(),
        apiService.getSocialCapabilities(),
        apiService.getSocialMemory(),
      ]);
      setStatus(s);
      setCapabilities(c);
      setMemory(m);
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل حالة مدير السوشيال ميديا');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

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
                  <td className="py-3 px-3 font-bold text-white">{p.displayName}</td>
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
