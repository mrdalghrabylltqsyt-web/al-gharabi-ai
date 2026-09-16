import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiService } from '../../services/api';
import {
  MarketingCampaignDetail,
  MarketingCampaignStatus,
  MarketingDraftAction,
  MarketingDraftBulkResult,
  MarketingCampaignTask,
  MARKETING_DRAFT_STATUS_LABELS,
} from '../../types';
import {
  ArrowRight,
  Layers,
  Package,
  ListChecks,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Send,
  Link2,
  History,
  Clock,
  ShieldAlert,
  Link2Off,
  Square,
  CheckSquare,
  Loader2,
} from 'lucide-react';

const CAMPAIGN_STATUS_LABELS: Record<MarketingCampaignStatus, string> = {
  draft: 'مسودة',
  active: 'نشطة',
  completed: 'مكتملة',
  archived: 'مؤرشفة',
};

const ACTION_ICONS: Record<MarketingDraftAction, React.ReactNode> = {
  review: <Send className="w-3.5 h-3.5" />,
  approve: <CheckCircle2 className="w-3.5 h-3.5" />,
  reject: <XCircle className="w-3.5 h-3.5" />,
};

const ACTION_LABELS: Record<MarketingDraftAction, string> = {
  review: 'إرسال للمراجعة',
  approve: 'اعتماد',
  reject: 'رفض',
};

const formatDateTime = (value?: string | null) => {
  if (!value) return 'غير متوفر';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString('en-GB') : 'غير متوفر';
};

const formatIqd = (value?: number | null) =>
  typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value).toLocaleString('en-US')} د.ع` : 'غير متوفر';

const statusTone = (status: string) => {
  if (status === 'approved') return 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300';
  if (status === 'review') return 'bg-amber-950/70 border-amber-500/40 text-amber-300';
  if (status === 'edited') return 'bg-blue-950/70 border-blue-500/40 text-blue-300';
  if (status === 'scheduled') return 'bg-cyan-950/70 border-cyan-500/40 text-cyan-300';
  if (status === 'published') return 'bg-teal-950/70 border-teal-500/40 text-teal-300';
  if (status === 'deleted') return 'bg-rose-950/70 border-rose-500/40 text-rose-300';
  return 'bg-slate-900 border-slate-700 text-slate-300';
};

interface Props {
  campaign: MarketingCampaignDetail;
  onClose: () => void;
  onChanged: (updated: MarketingCampaignDetail) => void;
  onRefreshList: () => Promise<void>;
}

export const MarketingCampaignDetailView: React.FC<Props> = ({ campaign, onClose, onChanged, onRefreshList }) => {
  const { currentUser, showToast, setActiveTab, refreshWorkspace } = useApp();
  const canDecide = campaign.canDecideDrafts;
  const isOwner = currentUser?.role === 'owner';

  const [selected, setSelected] = useState<string[]>([]);
  const [busyTaskId, setBusyTaskId] = useState<string>('');
  const [bulkBusy, setBulkBusy] = useState<boolean>(false);
  const [linkBusy, setLinkBusy] = useState<string>('');
  const [statusBusy, setStatusBusy] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [lastBulk, setLastBulk] = useState<MarketingDraftBulkResult | null>(null);
  const [linkInfo, setLinkInfo] = useState<{ taskId: string; alreadyLinked: boolean; postId: string } | null>(null);

  const drafts: MarketingCampaignTask[] = campaign.drafts?.length ? campaign.drafts : campaign.tasks || [];

  const bulkableSelection = useMemo(() => {
    const byId = new Map(drafts.map((d) => [d.id, d]));
    return selected.filter((id) => byId.has(id));
  }, [selected, drafts]);

  const toggleOne = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectableFor = (action: MarketingDraftAction) =>
    drafts.filter((d) => d.allowedActions.includes(action)).map((d) => d.id);

  const selectAllFor = (action: MarketingDraftAction) => setSelected(selectableFor(action));
  const clearSelection = () => setSelected([]);

  const runSingleAction = async (taskId: string, action: MarketingDraftAction) => {
    setBusyTaskId(`${taskId}:${action}`);
    setErrorMessage('');
    try {
      const res = await apiService.actOnMarketingDraft(campaign.id, taskId, action);
      showToast(`تم تنفيذ «${ACTION_LABELS[action]}» على المسودة (${res.result.from} ← ${res.result.to}).`);
      const fresh = await apiService.getMarketingCampaign(campaign.id);
      onChanged(fresh);
      await onRefreshList();
    } catch (err: any) {
      setErrorMessage(err?.message || 'تعذر تنفيذ الإجراء على المسودة.');
    } finally {
      setBusyTaskId('');
    }
  };

  const runBulk = async (action: MarketingDraftAction) => {
    if (!bulkableSelection.length) {
      setErrorMessage('حدد مسودة واحدة على الأقل قبل تنفيذ العملية الجماعية.');
      return;
    }
    setBulkBusy(true);
    setErrorMessage('');
    try {
      // The same ids are sent twice on purpose to prove the server collapses duplicates.
      const res = await apiService.bulkMarketingDraftAction(campaign.id, [...bulkableSelection, ...bulkableSelection], action);
      setLastBulk(res);
      showToast(`العملية الجماعية «${res.actionLabel}»: ${res.appliedCount} مسودة نُفّذت، ${res.skippedCount} لم تُنفّذ.`);
      setSelected(res.appliedTaskIds.length ? [] : bulkableSelection);
      const fresh = await apiService.getMarketingCampaign(campaign.id);
      onChanged(fresh);
      await onRefreshList();
    } catch (err: any) {
      setErrorMessage(err?.message || 'تعذر تنفيذ العملية الجماعية.');
    } finally {
      setBulkBusy(false);
    }
  };

  const linkDraft = async (taskId: string) => {
    setLinkBusy(taskId);
    setErrorMessage('');
    try {
      const res = await apiService.linkMarketingDraft(campaign.id, taskId);
      setLinkInfo({ taskId, alreadyLinked: res.alreadyLinked, postId: res.post.id });
      showToast(
        res.alreadyLinked
          ? 'الربط موجود مسبقاً ولم يُنشأ أي منشور مكرر.'
          : 'تم ربط المسودة بالمنشور في مساحة المنشورات (ربط محلي، دون نشر خارجي).'
      );
      await refreshWorkspace();
      await onRefreshList();
    } catch (err: any) {
      setErrorMessage(err?.message || 'تعذر ربط المسودة بالمنشور.');
    } finally {
      setLinkBusy('');
    }
  };

  const changeStatus = async (status: MarketingCampaignStatus) => {
    setStatusBusy(true);
    setErrorMessage('');
    try {
      await apiService.updateMarketingCampaignStatus(campaign.id, status);
      const fresh = await apiService.getMarketingCampaign(campaign.id);
      onChanged(fresh);
      await onRefreshList();
      showToast(`تم تحديث حالة الحملة إلى «${CAMPAIGN_STATUS_LABELS[status]}» (دون أي نشر خارجي).`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'تعذر تحديث حالة الحملة.');
    } finally {
      setStatusBusy(false);
    }
  };

  const approvedDrafts = drafts.filter((d) => d.status === 'approved');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-emerald-500/30 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              onClick={onClose}
              className="mb-2 text-[11px] text-slate-400 hover:text-emerald-300 flex items-center gap-1 transition cursor-pointer"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              العودة إلى مساحة الوكيل
            </button>
            <h3 className="text-base font-black text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              تفاصيل الحملة: {campaign.name}
            </h3>
            <p className="text-[11px] text-slate-400 mt-1">
              {campaign.goalLabel} • {campaign.productsCount} منتجات • {campaign.draftsCount} مسودة •{' '}
              <span className="text-emerald-300">{campaign.statusLabel || CAMPAIGN_STATUS_LABELS[campaign.status]}</span>
            </p>
          </div>
          <div className="text-left text-[10px] text-slate-400 space-y-0.5">
            <p>تاريخ الإنشاء: {formatDateTime(campaign.createdAt)}</p>
            <p>آخر تحديث: {formatDateTime(campaign.updatedAt)}</p>
            <p>معرّف الحملة: <span className="text-slate-300">{campaign.id}</span></p>
          </div>
        </div>

        {/* Description / task / notes */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <p className="text-[10px] text-slate-500 mb-1">وصف الحملة (المهمة المطبقة)</p>
            <p className="text-[11px] text-slate-200 leading-relaxed">{campaign.task || 'غير متوفر'}</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <p className="text-[10px] text-slate-500 mb-1">النبرة</p>
            <p className="text-[11px] text-slate-200">{campaign.tone || 'غير متوفر'}</p>
            <p className="text-[10px] text-slate-500 mt-2 mb-1">ملاحظات</p>
            <p className="text-[11px] text-slate-200">{campaign.notes || 'لا توجد ملاحظات مسجلة'}</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <p className="text-[10px] text-slate-500 mb-1">آخر نشاط</p>
            {campaign.lastActivity ? (
              <>
                <p className="text-[11px] text-slate-200">{campaign.lastActivity.note || campaign.lastActivity.action}</p>
                <p className="text-[10px] text-slate-500 mt-1">
                  {campaign.lastActivity.byUser} • {formatDateTime(campaign.lastActivity.timestamp)}
                </p>
              </>
            ) : (
              <p className="text-[11px] text-slate-400">غير متوفر</p>
            )}
          </div>
        </div>

        {/* Status + counters */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-slate-500 ml-1">حالة الحملة:</span>
          {(['draft', 'active', 'completed', 'archived'] as MarketingCampaignStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => changeStatus(s)}
              disabled={statusBusy || !isOwner}
              title={isOwner ? undefined : 'تغيير حالة الحملة متاح للمالك فقط'}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                campaign.status === s
                  ? 'bg-emerald-500 text-slate-950 border-emerald-500'
                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-emerald-500/40'
              }`}
            >
              {CAMPAIGN_STATUS_LABELS[s]}
            </button>
          ))}
          <span className="text-[10px] text-slate-500 mr-auto">
            منشورات مرتبطة: {campaign.linkedPostsCount} • بانتظار قرار: {campaign.draftsByDecision?.pending ?? 0} • معتمدة:{' '}
            {campaign.draftsByDecision?.approve ?? 0} • مرفوضة: {campaign.draftsByDecision?.reject ?? 0}
          </span>
        </div>

        {/* Products + platforms */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-emerald-400" />
              المنتجات المرتبطة
            </p>
            <div className="space-y-1.5">
              {campaign.products?.length ? (
                campaign.products.map((p) => (
                  <div key={p.id} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-white truncate">{p.name}</p>
                      <p className="text-[10px] text-slate-400">
                        {p.category || 'تصنيف غير مسجل'} • {formatIqd(p.cashPrice)} •{' '}
                        {p.inStock === false ? 'غير متوفر في المخزون' : 'متوفر'}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-slate-500">لا توجد منتجات مرتبطة.</p>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
              <Link2Off className="w-3.5 h-3.5 text-amber-400" />
              المنصات المحددة وحالتها الفعلية
            </p>
            <div className="space-y-1.5">
              {campaign.platformResources?.length ? (
                campaign.platformResources.map((r) => (
                  <div key={r.platform} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-white">{r.name}</p>
                      <p className="text-[10px] text-slate-400">حد النص: {r.textLimit.toLocaleString('en-US')} حرف</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border shrink-0 ${r.connected ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300' : 'bg-slate-900 border-slate-700 text-slate-400'}`}>
                      {r.connected ? 'متصل وموثّق' : 'غير متصل'}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-slate-500">لا توجد منصات محددة.</p>
              )}
            </div>
          </div>
        </div>

        {campaign.warnings?.length > 0 && (
          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 space-y-1">
            <p className="text-[11px] font-bold text-amber-300 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" />
              ملاحظات على بيانات الحملة
            </p>
            {campaign.warnings.map((w) => (
              <p key={w} className="text-[10px] text-amber-200/90">{w}</p>
            ))}
          </div>
        )}
      </div>

      {/* Drafts management */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black text-white flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-emerald-400" />
            إدارة المسودات ({drafts.length})
          </h3>
          <span className="text-[10px] text-slate-500">
            {canDecide ? 'يمكنك الاعتماد والرفض' : 'دورك يسمح بإرسال المسودات للمراجعة فقط'}
          </span>
        </div>

        {/* Bulk toolbar */}
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold text-slate-300">
              عمليات جماعية ({bulkableSelection.length} محددة)
            </span>
            <button
              onClick={() => selectAllFor('review')}
              className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-[10px] text-slate-300 hover:text-white transition cursor-pointer"
            >
              تحديد القابلة للمراجعة
            </button>
            {canDecide && (
              <>
                <button
                  onClick={() => selectAllFor('approve')}
                  className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-[10px] text-slate-300 hover:text-white transition cursor-pointer"
                >
                  تحديد القابلة للاعتماد
                </button>
                <button
                  onClick={() => selectAllFor('reject')}
                  className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-[10px] text-slate-300 hover:text-white transition cursor-pointer"
                >
                  تحديد القابلة للرفض
                </button>
              </>
            )}
            <button
              onClick={clearSelection}
              className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-[10px] text-slate-300 hover:text-white transition cursor-pointer"
            >
              إلغاء التحديد
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['review', 'approve', 'reject'] as MarketingDraftAction[]).map((action) => {
              const blockedByRole = action !== 'review' && !canDecide;
              return (
                <button
                  key={action}
                  onClick={() => runBulk(action)}
                  disabled={bulkBusy || blockedByRole || !bulkableSelection.length}
                  title={blockedByRole ? 'الاعتماد والرفض متاحان للمالك أو المدير العام' : undefined}
                  className={`px-3 py-2 rounded-xl text-[11px] font-bold border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 ${
                    action === 'approve'
                      ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300 hover:text-emerald-200'
                      : action === 'reject'
                        ? 'bg-rose-950/60 border-rose-500/40 text-rose-300 hover:text-rose-200'
                        : 'bg-amber-950/60 border-amber-500/40 text-amber-300 hover:text-amber-200'
                  }`}
                >
                  {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : ACTION_ICONS[action]}
                  {action === 'review' ? 'إرسال المحدد إلى المراجعة' : action === 'approve' ? 'اعتماد المحدد' : 'رفض المحدد'}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-500">
            يُتحقق من الملكية والصلاحيات على الخادم، وتُرفض المسودات غير الموجودة أو غير المنطقية مع بيان سببها.
          </p>

          {lastBulk && (
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-700 space-y-1">
              <p className="text-[11px] font-bold text-slate-200">
                نتيجة «{lastBulk.actionLabel}»: {lastBulk.appliedCount} نُفّذت من {lastBulk.requested}
                {lastBulk.duplicatesRemoved > 0 ? ` • تم تجاهل ${lastBulk.duplicatesRemoved} معرّفاً مكرراً` : ''}
              </p>
              {lastBulk.skipped.map((s) => (
                <p key={s.taskId} className="text-[10px] text-amber-300">
                  {s.taskId}: {s.reason || 'لم تُنفّذ'}
                </p>
              ))}
            </div>
          )}
        </div>

        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30">
            <p className="text-[11px] text-rose-300">{errorMessage}</p>
          </div>
        )}

        {/* Draft rows */}
        {drafts.length === 0 ? (
          <p className="text-[11px] text-slate-500">لا توجد مسودات في هذه الحملة.</p>
        ) : (
          <div className="space-y-2">
            {drafts.map((d) => {
              const isSelected = selected.includes(d.id);
              const isApproved = d.status === 'approved';
              const isDeleted = d.status === 'deleted';
              return (
                <div key={d.id} className={`p-3 rounded-xl border transition ${isSelected ? 'bg-emerald-950/30 border-emerald-500/40' : 'bg-slate-950 border-slate-800'}`}>
                  <div className="flex flex-wrap items-start gap-3">
                    <button
                      onClick={() => toggleOne(d.id)}
                      disabled={isDeleted}
                      className="mt-0.5 text-slate-400 hover:text-emerald-300 disabled:opacity-30 transition cursor-pointer"
                      title="تحديد المسودة"
                    >
                      {isSelected ? <CheckSquare className="w-4 h-4 text-emerald-400" /> : <Square className="w-4 h-4" />}
                    </button>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[11px] font-bold text-white truncate">{d.title}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${statusTone(d.status)}`}>
                          {d.statusLabel || MARKETING_DRAFT_STATUS_LABELS[d.status] || d.status}
                        </span>
                        {d.decisionLabel && (
                          <span className="text-[10px] text-slate-400">آخر قرار: {d.decisionLabel}</span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400">
                        المنصة: {d.platformName || d.platform} • المنتج: {d.productName} • تاريخ الإنشاء: {formatDateTime(d.createdAt)} •{' '}
                        {d.charCount} حرف
                      </p>
                      <p className="text-[11px] text-slate-200 leading-relaxed whitespace-pre-line line-clamp-4">
                        {d.content || d.contentPreview || 'لا يوجد نص مسجل لهذه المسودة.'}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        معرّف المسودة: {d.id} • المنشور: {d.draftPostId}
                        {d.decidedBy ? ` • آخر من قرر: ${d.decidedBy} (${formatDateTime(d.decidedAt)})` : ''}
                      </p>
                      {linkInfo?.taskId === d.id && (
                        <p className="text-[10px] text-emerald-300 flex items-center gap-1">
                          <Link2 className="w-3 h-3" />
                          {linkInfo.alreadyLinked ? 'الربط موجود مسبقاً بالمنشور' : 'تم الربط بالمنشور'} {linkInfo.postId}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        onClick={() => runSingleAction(d.id, 'review')}
                        disabled={!d.allowedActions.includes('review') || busyTaskId === `${d.id}:review`}
                        className="px-2.5 py-1.5 rounded-lg bg-amber-950/60 border border-amber-500/40 text-amber-300 text-[10px] font-bold hover:text-amber-200 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer flex items-center gap-1"
                        title="مراجعة"
                      >
                        {busyTaskId === `${d.id}:review` ? <Loader2 className="w-3 h-3 animate-spin" /> : ACTION_ICONS.review}
                        مراجعة
                      </button>
                      <button
                        onClick={() => runSingleAction(d.id, 'approve')}
                        disabled={!d.allowedActions.includes('approve') || !canDecide || busyTaskId === `${d.id}:approve`}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold hover:text-emerald-200 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer flex items-center gap-1"
                        title="اعتماد"
                      >
                        {busyTaskId === `${d.id}:approve` ? <Loader2 className="w-3 h-3 animate-spin" /> : ACTION_ICONS.approve}
                        اعتماد
                      </button>
                      <button
                        onClick={() => runSingleAction(d.id, 'reject')}
                        disabled={!d.allowedActions.includes('reject') || !canDecide || busyTaskId === `${d.id}:reject`}
                        className="px-2.5 py-1.5 rounded-lg bg-rose-950/60 border border-rose-500/40 text-rose-300 text-[10px] font-bold hover:text-rose-200 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer flex items-center gap-1"
                        title="رفض"
                      >
                        {busyTaskId === `${d.id}:reject` ? <Loader2 className="w-3 h-3 animate-spin" /> : ACTION_ICONS.reject}
                        رفض
                      </button>
                      {isApproved && (
                        <button
                          onClick={() => linkDraft(d.id)}
                          disabled={linkBusy === d.id}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 text-[10px] font-bold hover:text-white disabled:opacity-40 transition cursor-pointer flex items-center gap-1"
                          title="ربط المسودة المعتمدة بالمنشور"
                        >
                          {linkBusy === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                          ربط بالمنشور
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[10px] text-slate-500">
          الانتقالات غير المنطقية ممنوعة على الخادم: المراجعة متاحة من «مسودة» و«تم التعديل»، والاعتماد من «قيد المراجعة» و«تم التعديل»،
          والرفض يعيد المسودة إلى «تم التعديل». الاعتماد والرفض للمالك أو المدير العام فقط، وكل قرار يُسجَّل في سجل الحملة.
        </p>
      </div>

      {/* Approved drafts → posts linkage */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <h3 className="text-sm font-black text-white flex items-center gap-2">
          <Link2 className="w-4 h-4 text-emerald-400" />
          الربط مع مساحة المنشورات ({approvedDrafts.length} مسودة معتمدة)
        </h3>
        {approvedDrafts.length === 0 ? (
          <p className="text-[11px] text-slate-500">لا توجد مسودات معتمدة بعد. اعتمد مسودة أولاً ليظهر خيار الربط.</p>
        ) : (
          <div className="space-y-1.5">
            {approvedDrafts.map((d) => (
              <div key={d.id} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-white truncate">{d.title}</p>
                  <p className="text-[10px] text-slate-400">{d.platformName || d.platform} • المنشور: {d.draftPostId}</p>
                </div>
                <button
                  onClick={() => linkDraft(d.id)}
                  disabled={linkBusy === d.id}
                  className="px-3 py-1.5 rounded-lg bg-emerald-950/70 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold hover:text-emerald-200 disabled:opacity-40 transition cursor-pointer flex items-center gap-1"
                >
                  {linkBusy === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                  ربط / تأكيد الربط
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-slate-500">
          الربط لا ينشئ منشوراً مكرراً: إذا كان المنشور يحمل معرّف الحملة والمسودة يُعاد الرابط كما هو. الحالات المدعومة فعلياً:{' '}
          مسودة، قيد المراجعة، تم التعديل، تمت الموافقة، مجدول، منشور — ولا يُعلن أي نشر خارجي دون إيصال تنفيذ من المزود.
        </p>
      </div>

      {/* Change log */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <h3 className="text-sm font-black text-white flex items-center gap-2">
          <History className="w-4 h-4 text-emerald-400" />
          سجل التغييرات ({campaign.history?.length || 0})
        </h3>
        {campaign.history?.length ? (
          <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
            {[...campaign.history].reverse().map((h, index) => (
              <div key={`${h.timestamp}-${index}`} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <p className="text-[11px] text-slate-200">{h.note || h.actionLabel || h.action}</p>
                <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  {h.actionLabel || h.action} • {h.byUser} ({h.userRole}) • {formatDateTime(h.timestamp)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">لا يوجد سجل تغييرات بعد.</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveTab('approval')}
          className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-emerald-500/40 text-xs text-slate-300 hover:text-white flex items-center gap-1.5 transition cursor-pointer"
        >
          <ListChecks className="w-3.5 h-3.5" />
          فتح مركز الموافقات
        </button>
        <button
          onClick={() => setActiveTab('content')}
          className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-emerald-500/40 text-xs text-slate-300 hover:text-white flex items-center gap-1.5 transition cursor-pointer"
        >
          <Layers className="w-3.5 h-3.5" />
          مساحة المنشورات
        </button>
        <button
          onClick={onClose}
          className="px-3 py-2 rounded-xl bg-emerald-950/60 border border-emerald-500/30 text-xs text-emerald-300 hover:text-emerald-200 flex items-center gap-1.5 transition cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          العودة لمساحة الوكيل
        </button>
      </div>

      {!canDecide && (
        <p className="text-[10px] text-amber-300 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          دورك الحالي لا يملك صلاحية الاعتماد أو الرفض، ويمكنك إرسال المسودات للمراجعة فقط.
        </p>
      )}
    </div>
  );
};
