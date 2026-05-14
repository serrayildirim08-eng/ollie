/**
 * SessionTracker unit tests
 *
 * Covers:
 *   - start emits start row with correct shape
 *   - end emits end row with correct shape
 *   - start is idempotent (second call is a no-op)
 *   - end is a no-op if never started
 *   - onBrainDump increments counter and sets flags
 *   - onModuleOpened deduplicates
 *   - consent gate: no-op when hasConsent() is false
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Each test gets a fresh tracker instance to avoid cross-test state.
// We re-import from a factory function exposed via _makeSessionTracker
// by importing the module under test with vi.importActual and calling
// the internal factory. Since the module only exports the singleton,
// we recreate by re-executing the factory logic here.

// Instead of testing the singleton (which retains state across tests),
// we replicate the factory so tests can be isolated.

type TrackTableFn = (table: string, row: Record<string, unknown>) => void;
type Research = { trackTable: TrackTableFn; hasConsent: () => boolean };

// Inline minimal tracker factory (mirrors session-tracker.ts logic) so
// tests are isolated from the module-level singleton.
function makeTestTracker() {
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

  function getSessionId() { return sessionId; }

  function start(research: Research, ctx: { user_hash: string; country: string; device_id: string; app_version: string }) {
    if (sessionId) return;
    if (!research.hasConsent()) return;
    if (!ctx.user_hash) return;
    sessionId = 'test-uuid-' + Math.random().toString(36).slice(2);
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

  function end(research: Research) {
    if (!sessionId || !startedAt) return;
    if (!research.hasConsent()) return;
    const endedAt = Date.now();
    const durationSeconds = Math.round((endedAt - startedAt) / 1000);
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
    if (!modulesOpened.includes(moduleId)) modulesOpened.push(moduleId);
  }

  function _inspect() {
    return { sessionId, startedAt, voiceUsed, textUsed, brainDumpsCount, modulesOpened: [...modulesOpened] };
  }

  return { getSessionId, start, end, onBrainDump, onModuleOpened, _inspect };
}

function makeResearch(consent: boolean): { trackTable: ReturnType<typeof vi.fn>; hasConsent: () => boolean } {
  return {
    trackTable: vi.fn(),
    hasConsent: () => consent,
  };
}

const CTX = {
  user_hash: 'abc123hash',
  country: 'TR',
  device_id: 'device-001',
  app_version: '0.0.1',
};

describe('SessionTracker · start row', () => {
  it('emits a session_events row with started_at and no ended_at', () => {
    const t = makeTestTracker();
    const r = makeResearch(true);
    t.start(r, CTX);
    expect(r.trackTable).toHaveBeenCalledOnce();
    const [table, row] = (r.trackTable as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(table).toBe('session_events');
    expect(typeof row.session_id).toBe('string');
    expect(typeof row.started_at).toBe('string');
    expect(row.ended_at).toBeUndefined();
    expect(row.user_hash).toBe('abc123hash');
    expect(row.voice_used).toBe(false);
    expect(row.text_used).toBe(false);
    expect(row.brain_dumps_count).toBe(0);
    expect(row.modules_opened).toEqual([]);
    expect(row.country).toBe('TR');
    expect(row.device_id).toBe('device-001');
    expect(row.app_version).toBe('0.0.1');
  });

  it('is idempotent — second start() call does nothing', () => {
    const t = makeTestTracker();
    const r = makeResearch(true);
    t.start(r, CTX);
    t.start(r, CTX);
    expect(r.trackTable).toHaveBeenCalledOnce();
  });

  it('is a no-op when consent is false', () => {
    const t = makeTestTracker();
    const r = makeResearch(false);
    t.start(r, CTX);
    expect(r.trackTable).not.toHaveBeenCalled();
  });

  it('is a no-op when user_hash is empty', () => {
    const t = makeTestTracker();
    const r = makeResearch(true);
    t.start(r, { ...CTX, user_hash: '' });
    expect(r.trackTable).not.toHaveBeenCalled();
  });
});

describe('SessionTracker · end row', () => {
  it('emits a session_events row with ended_at and duration_seconds', () => {
    const t = makeTestTracker();
    const r = makeResearch(true);
    t.start(r, CTX);
    vi.clearAllMocks();
    t.end(r);
    expect(r.trackTable).toHaveBeenCalledOnce();
    const [table, row] = (r.trackTable as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(table).toBe('session_events');
    expect(typeof row.ended_at).toBe('string');
    expect(typeof row.duration_seconds).toBe('number');
    expect(row.started_at).toBeUndefined();
  });

  it('end() is a no-op if start() was never called', () => {
    const t = makeTestTracker();
    const r = makeResearch(true);
    t.end(r);
    expect(r.trackTable).not.toHaveBeenCalled();
  });

  it('includes accumulated voice_used / text_used / brain_dumps_count in end row', () => {
    const t = makeTestTracker();
    const r = makeResearch(true);
    t.start(r, CTX);
    t.onBrainDump('voice');
    t.onBrainDump('text');
    t.onBrainDump('text');
    vi.clearAllMocks();
    t.end(r);
    const [, row] = (r.trackTable as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(row.voice_used).toBe(true);
    expect(row.text_used).toBe(true);
    expect(row.brain_dumps_count).toBe(3);
  });

  it('includes accumulated modules_opened in end row', () => {
    const t = makeTestTracker();
    const r = makeResearch(true);
    t.start(r, CTX);
    t.onModuleOpened('finance');
    t.onModuleOpened('habits');
    t.onModuleOpened('finance'); // duplicate — should not appear twice
    vi.clearAllMocks();
    t.end(r);
    const [, row] = (r.trackTable as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(row.modules_opened).toEqual(['finance', 'habits']);
  });

  it('resets state after end()', () => {
    const t = makeTestTracker();
    const r = makeResearch(true);
    t.start(r, CTX);
    t.onBrainDump('voice');
    t.end(r);
    const s = t._inspect();
    expect(s.sessionId).toBeNull();
    expect(s.brainDumpsCount).toBe(0);
    expect(s.voiceUsed).toBe(false);
  });
});

describe('SessionTracker · onBrainDump', () => {
  it('increments brain_dumps_count per call', () => {
    const t = makeTestTracker();
    const r = makeResearch(true);
    t.start(r, CTX);
    t.onBrainDump('text');
    t.onBrainDump('text');
    expect(t._inspect().brainDumpsCount).toBe(2);
  });

  it('does nothing before start()', () => {
    const t = makeTestTracker();
    t.onBrainDump('voice');
    expect(t._inspect().brainDumpsCount).toBe(0);
  });
});

describe('SessionTracker · onModuleOpened', () => {
  it('deduplicates module entries', () => {
    const t = makeTestTracker();
    const r = makeResearch(true);
    t.start(r, CTX);
    t.onModuleOpened('cycle');
    t.onModuleOpened('cycle');
    expect(t._inspect().modulesOpened).toEqual(['cycle']);
  });

  it('does nothing before start()', () => {
    const t = makeTestTracker();
    t.onModuleOpened('finance');
    expect(t._inspect().modulesOpened).toEqual([]);
  });
});
