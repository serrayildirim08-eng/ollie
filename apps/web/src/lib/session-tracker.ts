/**
 * apps/web · SessionTracker singleton
 *
 * Holds in-memory state for the current session:
 *   - session_id (uuid generated once per app mount)
 *   - started_at timestamp
 *   - voice_used / text_used flags
 *   - brain_dumps_count counter
 *   - modules_opened list (deduped order-preserved)
 *
 * Two telemetry moments:
 *   1. START  — called by App.tsx after auth + consent verified.
 *              Fires trackTable('session_events', startRow).
 *   2. END    — called by App.tsx on beforeunload/visibilitychange.
 *              Fires a SECOND INSERT with ended_at filled in.
 *              Analytics queries coalesce start + end rows by session_id.
 *              We use two INSERTs (not an UPDATE) to keep the client
 *              fire-and-forget and the worker endpoint unchanged.
 *
 * Brain-dump counter + voice/text flags are updated via onBrainDump()
 * which App.tsx calls each time useApplyBrainDump fires.
 */

import type { ResearchClient } from '@ollie/research-stream';

export interface SessionStartContext {
  user_hash: string;
  country: string;
  device_id: string;
  app_version: string;
}

export interface SessionTracker {
  /** Returns the active session_id (null if not started). */
  getSessionId(): string | null;
  /** Start session — generates session_id, emits start row. Idempotent. */
  start(research: Pick<ResearchClient, 'trackTable' | 'hasConsent'>, ctx: SessionStartContext): void;
  /** End session — emits end row. No-op if never started. */
  end(research: Pick<ResearchClient, 'trackTable' | 'hasConsent'>): void;
  /** Record a brain-dump event. */
  onBrainDump(modality: 'voice' | 'text'): void;
  /** Record a module open — adds to modules_opened. */
  onModuleOpened(moduleId: string): void;
  /** Snapshot of current state — for tests. */
  _inspect(): SessionState;
}

export interface SessionState {
  sessionId: string | null;
  startedAt: number | null;
  voiceUsed: boolean;
  textUsed: boolean;
  brainDumpsCount: number;
  modulesOpened: string[];
}

function makeSessionTracker(): SessionTracker {
  let sessionId: string | null = null;
  let startedAt: number | null = null;
  let voiceUsed = false;
  let textUsed = false;
  let brainDumpsCount = 0;
  const modulesOpened: string[] = [];

  function reset() {
    sessionId = null;
    startedAt = null;
    voiceUsed = false;
    textUsed = false;
    brainDumpsCount = 0;
    modulesOpened.length = 0;
  }

  function getSessionId() {
    return sessionId;
  }

  function start(
    research: Pick<ResearchClient, 'trackTable' | 'hasConsent'>,
    ctx: SessionStartContext,
  ) {
    if (sessionId) return; // idempotent
    if (!research.hasConsent()) return;
    if (!ctx.user_hash) return; // pre-sign-in — drop

    sessionId = crypto.randomUUID();
    startedAt = Date.now();

    research.trackTable('session_events', {
      session_id: sessionId,
      user_hash: ctx.user_hash,
      started_at: new Date(startedAt).toISOString(),
      voice_used: false,
      text_used: false,
      brain_dumps_count: 0,
      modules_opened: [],
      country: ctx.country,
      device_id: ctx.device_id,
      app_version: ctx.app_version,
    });
  }

  function end(research: Pick<ResearchClient, 'trackTable' | 'hasConsent'>) {
    if (!sessionId || !startedAt) return;
    if (!research.hasConsent()) return;

    const endedAt = Date.now();
    const durationSeconds = Math.round((endedAt - startedAt) / 1000);

    // Second INSERT — analytics coalesces with the start row by session_id.
    // ended_at being non-null is the discriminator.
    research.trackTable('session_events', {
      session_id: sessionId,
      ended_at: new Date(endedAt).toISOString(),
      duration_seconds: durationSeconds,
      voice_used: voiceUsed,
      text_used: textUsed,
      brain_dumps_count: brainDumpsCount,
      modules_opened: [...modulesOpened],
    });

    reset();
  }

  function onBrainDump(modality: 'voice' | 'text') {
    if (!sessionId) return;
    brainDumpsCount += 1;
    if (modality === 'voice') voiceUsed = true;
    if (modality === 'text') textUsed = true;
  }

  function onModuleOpened(moduleId: string) {
    if (!sessionId) return;
    if (!modulesOpened.includes(moduleId)) {
      modulesOpened.push(moduleId);
    }
  }

  function _inspect(): SessionState {
    return {
      sessionId,
      startedAt,
      voiceUsed,
      textUsed,
      brainDumpsCount,
      modulesOpened: [...modulesOpened],
    };
  }

  return { getSessionId, start, end, onBrainDump, onModuleOpened, _inspect };
}

/** Module-level singleton — shared across App.tsx, ModuleScreen, and tests. */
export const sessionTracker: SessionTracker = makeSessionTracker();
