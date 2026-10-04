/**
 * مسارات فريق الوكلاء (Agent Team API) — قراءة/تشخيص فقط، بلا تنفيذ خارجي.
 *
 * كل المسارات محمية بـ`authenticateToken`. لا مسار تنفيذ خارجي هنا: الجلسة تنتج
 * قراراً مقترحاً فقط، والتنفيذ يبقى في بوابات المشروع القائمة. مسار التشغيل
 * (`POST /run`) للمالك فقط، ويشغّل جلسة على سياق حقيقي — بلا نشر ولا رد ولا جدولة.
 *
 * الحقن عبر `deps` يجعل الوحدة قابلة للاختبار ببيانات proof-based، والبيانات
 * الحقيقية تُجمَّع في `server.ts` (بلا شبكة وبلا أسرار).
 */

import type express from 'express';
import { TEAM_AGENT_LABELS_AR, type TeamSession } from './types';
import { TEAM_TRUTH_LABELS_AR, TEAM_TRUTH_STATES } from './truth';
import { summarizeTeamState } from './orchestrator';

export interface TeamRoutesDeps {
  authenticateToken: express.RequestHandler;
  requireOwner: express.RequestHandler;
  /** جلسات الفريق المحفوظة (قراءة فقط). */
  sessions: () => TeamSession[];
  /** تشغيل جلسة على سياق حقيقي (owner) — بلا تنفيذ خارجي. يعيد الجلسة والمخرجات. */
  runSession: (trigger: TeamSession['trigger']) => Promise<{ session: TeamSession; memoryWritten: boolean; persistenceError: string | null }> | { session: TeamSession; memoryWritten: boolean; persistenceError: string | null };
  now?: () => number;
}

export function teamLabels() {
  return {
    agents: TEAM_AGENT_LABELS_AR,
    truthStates: TEAM_TRUTH_LABELS_AR,
  };
}

/** يعرض جلسة كاملة بلا أي سرّ (للمالك). */
function presentSession(session: TeamSession) {
  return {
    ...session,
    labels: teamLabels(),
  };
}

export function registerTeamRoutes(app: express.Express, deps: TeamRoutesDeps): void {
  // قائمة جلسات الفريق (أحدث أولاً) — ملخّص بلا تفاصيل حساسة.
  app.get('/api/agent/team', deps.authenticateToken, (_req, res) => {
    const sessions = deps.sessions();
    res.json({
      success: true,
      count: sessions.length,
      summary: summarizeTeamState({ sessions }),
      labels: teamLabels(),
      truthStates: TEAM_TRUTH_STATES,
      sessions: sessions.slice(-50).reverse().map((s) => ({
        teamSessionId: s.teamSessionId,
        task: s.task,
        trigger: s.trigger,
        source: s.source,
        status: s.status,
        participants: s.participants,
        truthState: s.truthState,
        confidence: s.confidence,
        conflicts: s.conflicts.length,
        criticFailed: s.criticFailed,
        verified: Boolean(s.decision?.verified),
        brainFinalStatus: s.brainDecision?.finalStatus ?? null,
        brainFinalStatusLabelAr: s.brainDecision?.finalStatusLabelAr ?? null,
        memoryWritten: s.memoryWritten,
        createdAt: s.createdAt,
      })),
      note: 'فريق الوكلاء الداخلي — قراءة فقط: رصد/تحليل/تحقق/قرار مقترح بلا أي تنفيذ خارجي.',
    });
  });

  // جلسة واحدة بالكامل (أدلة/تحليل/توصيات/اعتراضات/خلافات/قرار/ثقة/حالة صدق/ذاكرة).
  app.get('/api/agent/team/:teamSessionId', deps.authenticateToken, (req, res) => {
    const session = deps.sessions().find((s) => s.teamSessionId === req.params.teamSessionId);
    if (!session) {
      res.status(404).json({ success: false, error: 'جلسة فريق غير موجودة.' });
      return;
    }
    res.json({
      success: true,
      session: presentSession(session),
      note: 'الجلسة الكاملة بلا سرّ؛ الخلافات تبقى ظاهرة ولا يُختار فائز بلا دليل.',
    });
  });

  // تشغيل جلسة الآن (تشخيص، للمالك فقط): على سياق حقيقي — لا تنفيذ خارجي ولا AI بلا داعٍ.
  app.post('/api/agent/team/run', deps.authenticateToken, deps.requireOwner, async (_req, res) => {
    try {
      const out = await Promise.resolve(deps.runSession('manual'));
      res.json({
        success: true,
        session: presentSession(out.session),
        memoryWritten: out.memoryWritten,
        persistenceError: out.persistenceError,
        note: 'جلسة فريق تشخيصية: قرار مقترح فقط؛ لا نشر ولا رد ولا جدولة، والبوابات القائمة تبقى المرجع.',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: String(err?.message || 'تعذّر تشغيل جلسة الفريق.').slice(0, 200) });
    }
  });
}
