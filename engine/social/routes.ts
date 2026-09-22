/**
 * مسارات مدير السوشيال ميديا.
 *
 * كل المسارات هنا مبنية على قواعد ثابتة في المشروع:
 * - القدرات تُقرأ من سجل الموصلات المركزي وليس من قائمة منفصلة قد تنحرف عنه.
 * - المنصة غير المتصلة تظهر disconnected ولا تُنفَّذ لها أي عملية خارجية.
 * - لا يُسجَّل نشر ناجح إلا بمعرّف منشور حقيقي من المزود.
 * - التصنيف والتحليل حتمي، ولا يستهلك حصة المزود.
 *
 * الحقن عبر `deps` يجعل الوحدة قابلة للاختبار دون تشغيل الخادم بالكامل.
 */

import type express from 'express';
import { buildAdapters, isSupportedPlatform } from './registry';
import {
  buildDeterministicReply,
  canAutoReply,
  classifyComment,
  evaluateReplyGuard,
  isSelfAuthored,
  type ReplyRecord,
} from './comments';
import { analyzeBusinessClaims, type BusinessFacts } from './contentSafety';
import {
  buildPublishRecord,
  collectAvailableMetrics,
  engagementRate,
  metricAvailability,
  publishPreflight,
} from './publishing';
import { buildMarketingDecision, buildMemorySnapshot, type PerformanceRecord } from './brain';

export interface PlatformConnectionLike {
  status: 'connected' | 'reauth_needed' | 'disconnected';
  accountId?: string;
  accountName?: string;
  connectedAt?: string;
  providerVerified?: boolean;
}

export interface SocialRoutesDeps {
  authenticateToken: express.RequestHandler;
  requireOwner: express.RequestHandler;
  /** حالة مساحة العمل المحفوظة (سجلات حقيقية فقط). */
  workspace: any;
  platformConnections: Map<string, PlatformConnectionLike>;
  persistState: () => void;
  audit: (userId: string, action: string, detail?: string) => void;
  workspaceId: (prefix: string) => string;
  /**
   * حقائق المعرض التجارية المسجّلة فعلاً (أسعار، أرقام، روابط، عروض معتمدة).
   * تُستخدم لفحص أي نص رد مقترح قبل حفظه. غياب المنتج يقلّل الحقائق إلى بيانات
   * المعرض العامة فقط، فيُحجب أي ادعاء غير مسجّل بدل تمريره.
   */
  buildFacts?: (productId?: string | null) => BusinessFacts;
}

export function registerSocialManagerRoutes(app: express.Express, deps: SocialRoutesDeps): void {
  const { authenticateToken, requireOwner, workspace, platformConnections, persistState, audit, workspaceId } = deps;

  /**
   * يبني حقائق المعرض التجارية من البيانات المسجّلة فعلاً. بلا `buildFacts`
   * محقونة، تُستخدم بيانات المعرض العامة فقط (بلا أي سعر أو رابط مُختلق).
   */
  const factsFor = (productId?: string | null): BusinessFacts => {
    if (deps.buildFacts) return deps.buildFacts(productId);
    const showroom = workspace.showroom || {};
    return {
      cashPrices: [], derivedAmounts: [], downPaymentPercents: [],
      phones: [showroom.phoneUnified, showroom.whatsappSales].map((p: any) => String(p ?? '').trim()).filter(Boolean),
      urls: [],
      inStock: null,
      hasRecordedPromotion: [showroom.promotions, showroom.activeOffer].some((p: any) => String(p ?? '').trim().length > 0),
      allowedPhrases: [
        ...(Array.isArray(showroom.policies) ? showroom.policies : []),
        typeof showroom.about === 'string' ? showroom.about : '',
        typeof showroom.tagline === 'string' ? showroom.tagline : '',
      ].map((p: any) => String(p ?? '').trim()).filter(Boolean),
    };
  };

  /** حلّ منتج من معرّف أو اسم لربط الحقائق التجارية الصحيحة. */
  const resolveProduct = (productId?: string | null, productName?: string | null) => {
    const products = (workspace.products || []) as any[];
    if (productId && String(productId).trim()) {
      const byId = products.find((p) => p.id === String(productId).trim());
      if (byId) return { product: byId, facts: factsFor(byId.id) };
    }
    if (productName && String(productName).trim()) {
      const byName = products.find((p) => p.name === String(productName).trim());
      if (byName) return { product: byName, facts: factsFor(byName.id) };
    }
    return { product: null, facts: factsFor(null) };
  };

  const connectionFor = (platform: string) => {
    const conn = platformConnections.get(platform);
    if (!conn) return null;
    return {
      status: conn.status,
      accountId: conn.accountId,
      accountName: conn.accountName,
      connectedAt: conn.connectedAt,
      providerVerified: Boolean(conn.providerVerified),
    };
  };

  const adapters = () => buildAdapters((platform) => connectionFor(platform));
  const findAdapter = (platform: string) => adapters().find((a) => a.platform === platform) || null;
  const isVerifiedConnected = (platform: string) => {
    const conn = platformConnections.get(platform);
    return Boolean(conn && conn.status === 'connected' && conn.providerVerified);
  };

  app.get('/api/social/manager/status', authenticateToken, (_req, res) => {
    const list = adapters();
    const posts = workspace.posts || [];
    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      platforms: list.map((a) => a.describe()),
      summary: {
        totalPlatforms: list.length,
        connected: list.filter((a) => a.describe().connection === 'connected').length,
        disconnected: list.filter((a) => a.describe().connection === 'disconnected').length,
        reauthNeeded: list.filter((a) => a.describe().connection === 'reauth_needed').length,
        publishCapable: list.filter((a) => a.supports('publish')).length,
        commentCapable: list.filter((a) => a.supports('comments')).length,
      },
      content: {
        total: posts.length,
        drafts: posts.filter((p: any) => p.status === 'draft').length,
        review: posts.filter((p: any) => p.status === 'review').length,
        approved: posts.filter((p: any) => p.status === 'approved').length,
        scheduled: posts.filter((p: any) => p.status === 'scheduled').length,
        published: posts.filter((p: any) => p.status === 'published').length,
      },
      activity: {
        commentsTracked: (workspace.socialComments || []).length,
        repliesRecorded: (workspace.socialReplies || []).length,
        publishRecords: (workspace.publishRecords || []).length,
      },
      note: 'الأرقام فعلية من حالة الخادم. لا توجد أي بيانات تجريبية أو حسابات مُختلقة.',
    });
  });

  app.get('/api/social/manager/capabilities', authenticateToken, (_req, res) => {
    res.json({
      success: true,
      platforms: adapters().map((a) => ({ ...a.describe(), metrics: metricAvailability(a.platform) })),
      note: 'المنصة لا تُعد متصلة إلا بعد OAuth/API فعلي موثق من المزود.',
    });
  });

  // التصنيف حتمي بالكامل: لا يستهلك أي حصة ذكاء اصطناعي.
  app.post('/api/social/manager/comments/classify', authenticateToken, (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    const platform = typeof req.body?.platform === 'string' ? req.body.platform : '';
    if (!text.trim()) return res.status(400).json({ success: false, error: 'نص التعليق مطلوب.' });
    const classification = classifyComment(text);
    const autoReplyAllowed = canAutoReply(classification);
    // الرد المقترح يمر عبر حارس سلامة المحتوى قبل عرضه للمراجعة البشرية.
    // المسار: تعليق → توليد رد مقترح → contentSafety → مراجعة/عرض.
    const rawSuggestion = autoReplyAllowed ? buildDeterministicReply(classification) : null;
    const { facts } = resolveProduct(req.body?.productId, req.body?.productName);
    const safety = rawSuggestion ? analyzeBusinessClaims(rawSuggestion, facts) : null;
    const suggestedReply = rawSuggestion && safety?.safe ? rawSuggestion : null;
    res.json({
      success: true,
      platform: isSupportedPlatform(platform) ? platform : null,
      classification,
      autoReplyAllowed,
      suggestedDeterministicReply: suggestedReply,
      contentSafety: safety
        ? { safe: safety.safe, violations: safety.blocked.map((v) => v.detail), codes: safety.blocked.map((v) => v.code) }
        : null,
      note: 'التصنيف حتمي ولا يستهلك أي حصة ذكاء اصطناعي، والرد المقترح يمر عبر حارس سلامة المحتوى قبل أي استخدام.',
    });
  });

  app.post('/api/social/manager/comments/reply', authenticateToken, (req, res) => {
    const user = (req as any).user as { id: string };
    const platform = typeof req.body?.platform === 'string' ? req.body.platform : '';
    const externalId = typeof req.body?.externalId === 'string' ? req.body.externalId.trim() : '';
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const authorName = typeof req.body?.authorName === 'string' ? req.body.authorName : undefined;
    const commentText = typeof req.body?.commentText === 'string' ? req.body.commentText : '';

    if (!isSupportedPlatform(platform)) return res.status(400).json({ success: false, error: 'منصة غير معروفة.' });
    if (!externalId) return res.status(400).json({ success: false, error: 'معرّف التعليق لدى المنصة مطلوب لمنع الرد المكرر.' });

    const adapter = findAdapter(platform);
    if (!adapter) return res.status(400).json({ success: false, error: 'لا يوجد موصل لهذه المنصة.' });
    if (!adapter.supports('comment_reply')) {
      return res.status(501).json({
        success: false,
        error: `المنصة ${adapter.displayName} لا تدعم الرد على التعليقات عبر واجهتها الرسمية في هذا النظام.`,
      });
    }
    if (!isVerifiedConnected(platform)) {
      return res.status(409).json({
        success: false,
        error: `المنصة ${adapter.displayName} غير متصلة باتصال موثق؛ لا يمكن إرسال أي رد خارجي.`,
      });
    }

    const classification = classifyComment(commentText || text);
    if (!canAutoReply(classification)) {
      return res.status(422).json({
        success: false,
        error: classification.reviewReason || 'هذا التعليق يستوجب مراجعة بشرية قبل أي رد.',
        classification,
        requiresHumanReview: true,
      });
    }

    const ownNames = [String(workspace.showroom?.name || ''), 'معرض الغرابي'];
    if (isSelfAuthored(authorName, ownNames)) {
      return res.status(409).json({ success: false, error: 'التعليق صادر من حساب المعرض؛ لا يُرد عليه لتجنب حلقة ردود.' });
    }

    // حارس سلامة المحتوى من جهة الخادم قبل التسجيل النهائي أو أي إرسال:
    // لا يُحفظ أو يُرسل نص رد يحمل عرضاً أو رقماً أو رابطاً غير مسجّل.
    const { facts: replyFacts } = resolveProduct(req.body?.productId, req.body?.productName);
    const replySafety = analyzeBusinessClaims(text, replyFacts);
    if (!replySafety.safe) {
      return res.status(422).json({
        success: false,
        error: 'نص الرد يحمل عرضاً تجارياً غير مسجّل في بيانات المعرض، وتم إيقافه قبل أي رد.',
        contentSafety: {
          safe: false,
          violations: replySafety.blocked.map((v) => v.detail),
          codes: replySafety.blocked.map((v) => v.code),
        },
        note: 'سجّل السعر/الشرط/الرقم الحقيقي في بيانات المعرض، أو أزل الادعاء غير المسجّل من نص الرد.',
      });
    }

    const history: ReplyRecord[] = (workspace.socialReplies || []).map((r: any) => ({
      externalId: r.externalId,
      replyFingerprint: r.replyFingerprint,
      repliedAt: r.repliedAt,
    }));
    const decision = evaluateReplyGuard({ externalId, replyText: text, history });
    if (!decision.allowed) return res.status(409).json({ success: false, error: decision.reason, guard: decision });

    // لا يوجد موصل إنتاجي معتمد بعد: يُسجَّل الرد محلياً ولا يُدّعى إرساله.
    const record = {
      id: workspaceId('reply'),
      platform,
      externalId,
      text,
      replyFingerprint: decision.fingerprint,
      classification,
      repliedAt: new Date().toISOString(),
      createdBy: user.id,
      simulated: true,
      delivered: false,
      note: 'لم يُرسل الرد إلى المنصة: لا يوجد موصل إنتاجي معتمد لهذه المنصة بعد.',
    };
    if (!Array.isArray(workspace.socialReplies)) workspace.socialReplies = [];
    workspace.socialReplies.unshift(record);
    if (workspace.socialReplies.length > 5000) workspace.socialReplies.pop();
    audit(user.id, 'social_comment_reply', `${platform}:${externalId}`);
    persistState();

    res.json({ success: true, reply: record, delivered: false, simulated: true, note: record.note });
  });

  app.get('/api/social/manager/comments', authenticateToken, (req, res) => {
    const platform = typeof req.query?.platform === 'string' ? req.query.platform : '';
    const comments = (workspace.socialComments || []) as any[];
    const filtered = platform ? comments.filter((c) => c.platform === platform) : comments;
    const canFetch = Boolean(platform && isVerifiedConnected(platform));
    res.json({
      success: true,
      platform: platform || null,
      externalFetchAvailable: canFetch,
      comments: filtered.slice(0, 200),
      count: filtered.length,
      note: canFetch
        ? 'التعليقات المعروضة مسجلة محلياً. جلب التعليقات من المنصة يتطلب تنفيذ موصل الإنتاج المعتمد.'
        : 'لا يمكن جلب تعليقات من منصة غير متصلة باتصال موثق.',
    });
  });

  // تسجيل تعليق وارد. إعادة إرسال نفس الحدث لا تُنشئ سجلاً مكرراً (حماية replay).
  app.post('/api/social/manager/comments/ingest', authenticateToken, (req, res) => {
    const user = (req as any).user as { id: string };
    const platform = typeof req.body?.platform === 'string' ? req.body.platform : '';
    const externalId = typeof req.body?.externalId === 'string' ? req.body.externalId.trim() : '';
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!isSupportedPlatform(platform)) return res.status(400).json({ success: false, error: 'منصة غير معروفة.' });
    if (!externalId || !text) return res.status(400).json({ success: false, error: 'معرّف التعليق ونصه مطلوبان.' });

    if (!Array.isArray(workspace.socialComments)) workspace.socialComments = [];
    const existing = workspace.socialComments.find((c: any) => c.platform === platform && c.externalId === externalId);
    if (existing) return res.json({ success: true, duplicate: true, comment: existing });

    const classification = classifyComment(text);
    const record = {
      id: workspaceId('comment'),
      platform,
      externalId,
      postExternalId: typeof req.body?.postExternalId === 'string' ? req.body.postExternalId : null,
      authorName: typeof req.body?.authorName === 'string' ? req.body.authorName : null,
      text,
      createdAt: new Date().toISOString(),
      classification,
      requiresHumanReview: classification.requiresHumanReview,
      ingestedBy: user.id,
    };
    workspace.socialComments.unshift(record);
    if (workspace.socialComments.length > 10000) workspace.socialComments.pop();
    persistState();
    res.json({ success: true, duplicate: false, comment: record });
  });

  app.post('/api/social/manager/publish/preflight', authenticateToken, (req, res) => {
    const platform = typeof req.body?.platform === 'string' ? req.body.platform : '';
    const postId = typeof req.body?.postId === 'string' ? req.body.postId : '';
    const post = (workspace.posts || []).find((p: any) => p.id === postId) || null;
    const adapter = findAdapter(platform);
    const result = publishPreflight({
      platform,
      approved: post?.status === 'approved' || req.body?.approved === true,
      hasContent:
        Boolean(post && String(post.content || '').trim().length > 0) ||
        (typeof req.body?.content === 'string' && req.body.content.trim().length > 0),
      connected: platformConnections.get(platform)?.status === 'connected',
      providerVerified: Boolean(platformConnections.get(platform)?.providerVerified),
      supportsPublish: Boolean(adapter?.supports('publish')),
    });
    res.json({ success: result.ready, ready: result.ready, platform, postId: postId || null, checks: result.checks, reasons: result.reasons });
  });

  // لا يُسجَّل نشر ناجح إلا بمعرّف منشور حقيقي من المزود.
  app.post('/api/social/manager/publish/execute', requireOwner, (req, res) => {
    const user = (req as any).user as { id: string };
    const platform = typeof req.body?.platform === 'string' ? req.body.platform : '';
    const postId = typeof req.body?.postId === 'string' ? req.body.postId : '';
    const post = (workspace.posts || []).find((p: any) => p.id === postId);
    if (!post) return res.status(404).json({ success: false, error: 'المنشور غير موجود في مساحة العمل.' });

    const adapter = findAdapter(platform);
    const preflight = publishPreflight({
      platform,
      approved: post.status === 'approved',
      hasContent: String(post.content || '').trim().length > 0,
      connected: platformConnections.get(platform)?.status === 'connected',
      providerVerified: Boolean(platformConnections.get(platform)?.providerVerified),
      supportsPublish: Boolean(adapter?.supports('publish')),
    });
    if (!preflight.ready) {
      return res.status(409).json({ success: false, error: 'فشل فحص ما قبل النشر.', checks: preflight.checks, reasons: preflight.reasons });
    }

    const record = buildPublishRecord({
      platform: platform as any,
      postId,
      scheduledFor: post.scheduledFor || null,
      providerPostId: null,
      simulated: true,
      error: 'لا يوجد موصل نشر إنتاجي معتمد لهذه المنصة. لم يُرسل أي محتوى إلى المنصة.',
    });
    if (!Array.isArray(workspace.publishRecords)) workspace.publishRecords = [];
    workspace.publishRecords.unshift({ ...record, id: workspaceId('publish'), createdBy: user.id });
    if (workspace.publishRecords.length > 5000) workspace.publishRecords.pop();
    audit(user.id, 'social_publish_attempt', `${platform}:${postId}:failed`);
    persistState();

    res.status(501).json({
      success: false,
      executed: false,
      record,
      error: record.error,
      note: 'لا يُسجَّل أي نشر إلا بمعرّف منشور حقيقي من المزود.',
    });
  });

  app.get('/api/social/manager/publish/records', authenticateToken, (_req, res) => {
    const records = (workspace.publishRecords || []) as any[];
    res.json({
      success: true,
      records: records.slice(0, 200),
      count: records.length,
      publishedCount: records.filter((r) => r.state === 'published').length,
      note: 'السجلات تعكس محاولات فعلية. لا يوجد أي نشر حقيقي بلا معرّف منشور من المزود.',
    });
  });

  app.get('/api/social/manager/analytics', authenticateToken, (req, res) => {
    const platform = typeof req.query?.platform === 'string' ? req.query.platform : '';
    if (!isSupportedPlatform(platform)) return res.status(400).json({ success: false, error: 'منصة غير معروفة.' });
    const adapter = findAdapter(platform)!;
    const availability = metricAvailability(platform);
    const records = (workspace.performanceRecords || []).filter((r: any) => r.platform === platform);

    const aggregated: Record<string, number> = {};
    for (const record of records) {
      const available = collectAvailableMetrics(platform, record.values || {});
      for (const [key, value] of Object.entries(available)) aggregated[key] = (aggregated[key] || 0) + value;
    }

    res.json({
      success: true,
      platform,
      displayName: adapter.displayName,
      connection: platformConnections.get(platform)?.status || 'disconnected',
      metrics: availability.map((m) => ({ ...m, value: m.available && m.metric in aggregated ? aggregated[m.metric] : null })),
      engagementRate: engagementRate(aggregated),
      sampleSize: records.length,
      externalFetchAvailable: Boolean(isVerifiedConnected(platform) && adapter.supports('analytics')),
      note: records.length
        ? 'القيم مجمّعة من سجلات أداء فعلية. المؤشرات غير المدعومة من المنصة تظهر كغير متاحة.'
        : 'لا توجد سجلات أداء لهذه المنصة بعد. المؤشرات غير المتاحة لا تُخترع.',
    });
  });

  app.get('/api/social/manager/brain/decision', authenticateToken, (req, res) => {
    const objective = typeof req.query?.objective === 'string' && req.query.objective.trim()
      ? req.query.objective.trim()
      : 'زيادة استفسارات التقسيط من منصات التواصل';
    const requested = typeof req.query?.platforms === 'string'
      ? req.query.platforms.split(',').map((x) => x.trim()).filter((x) => isSupportedPlatform(x))
      : [];

    const list = adapters();
    const connectedPlatforms = list.filter((a) => a.describe().connection === 'connected').map((a) => a.platform);
    // المنصات المطلوبة إن حُددت، وإلا المتصلة، وإلا كل المنصات المدعومة.
    const platforms = requested.length ? requested : connectedPlatforms.length ? connectedPlatforms : list.map((a) => a.platform);

    const performance: PerformanceRecord[] = (workspace.performanceRecords || []).map((r: any) => ({
      platform: r.platform,
      contentType: r.contentType,
      values: r.values || {},
      at: r.at,
    }));

    const memory = buildMemorySnapshot({
      posts: workspace.posts || [],
      comments: (workspace.socialComments || []).map((c: any) => ({ text: c.text, intent: c.classification?.intent })),
      decisions: workspace.marketingDecisions || [],
      strategies: workspace.strategiesTested || [],
    });

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      objective,
      connectedPlatforms,
      decision: buildMarketingDecision({ objective, platforms: platforms as any, performance, memory }),
      memory,
      note: 'التوصيات مبنية على بيانات النظام الفعلية. أي فجوة بيانات تُعلن صراحة ولا تُستبدل بتقدير مضلل.',
    });
  });

  app.get('/api/social/manager/memory', authenticateToken, (_req, res) => {
    const memory = buildMemorySnapshot({
      posts: workspace.posts || [],
      comments: (workspace.socialComments || []).map((c: any) => ({ text: c.text, intent: c.classification?.intent })),
      decisions: workspace.marketingDecisions || [],
      strategies: workspace.strategiesTested || [],
    });
    res.json({ success: true, memory, note: 'الذاكرة مبنية على سجلات تشغيلية فعلية فقط.' });
  });

  app.post('/api/social/manager/analytics/record', requireOwner, (req, res) => {
    const user = (req as any).user as { id: string };
    const platform = typeof req.body?.platform === 'string' ? req.body.platform : '';
    if (!isSupportedPlatform(platform)) return res.status(400).json({ success: false, error: 'منصة غير معروفة.' });
    const values = collectAvailableMetrics(platform, req.body?.values || {});
    if (!Object.keys(values).length) {
      return res.status(400).json({
        success: false,
        error: 'لا توجد مؤشرات مدعومة لهذه المنصة في المدخلات.',
        supported: metricAvailability(platform).filter((m) => m.available),
      });
    }
    const record = {
      id: workspaceId('perf'),
      platform,
      contentType: typeof req.body?.contentType === 'string' ? req.body.contentType : null,
      postExternalId: typeof req.body?.postExternalId === 'string' ? req.body.postExternalId : null,
      values,
      at: new Date().toISOString(),
      recordedBy: user.id,
    };
    if (!Array.isArray(workspace.performanceRecords)) workspace.performanceRecords = [];
    workspace.performanceRecords.unshift(record);
    if (workspace.performanceRecords.length > 20000) workspace.performanceRecords.pop();
    persistState();
    res.json({ success: true, record, note: 'المؤشرات غير المدعومة من المنصة تُستبعد تلقائياً ولا تُخترع قيم لها.' });
  });
}
