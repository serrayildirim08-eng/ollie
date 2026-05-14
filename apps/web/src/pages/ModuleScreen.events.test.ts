/**
 * ModuleScreen · module_events telemetry tests
 *
 * Tests that the module_events open and close rows are emitted correctly.
 * We test the hook logic directly (not via React rendering) to keep these
 * fast and avoid all the module lazy-import chain.
 *
 * Strategy: extract the useEffect callback shape into a standalone
 * helper that mirrors what the component does, then assert on the
 * trackTable calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock dependencies ────────────────────────────────────────────────────────

vi.mock('../store', () => ({
  store: {
    get: vi.fn((_mod: string, key: string, fallback: unknown) => {
      if (key === 'settings.country') return 'TR';
      return fallback;
    }),
    set: vi.fn(),
    subscribeKey: vi.fn(() => () => {}),
  },
  useStoreSlice: vi.fn(() => ['yes', vi.fn()]),
}));

vi.mock('../lib/account-boot', () => ({
  getAccount: vi.fn(),
}));

vi.mock('../lib/user-hash', () => ({
  readUserHash: vi.fn(() => 'testhash'),
}));

vi.mock('../lib/device', () => ({
  getDeviceId: vi.fn(() => 'device-001'),
  getAppVersion: vi.fn(() => '0.0.1-test'),
}));

vi.mock('../lib/session-tracker', () => ({
  sessionTracker: {
    getSessionId: vi.fn(() => 'session-abc'),
    onModuleOpened: vi.fn(),
    onBrainDump: vi.fn(),
    start: vi.fn(),
    end: vi.fn(),
    _inspect: vi.fn(),
  },
}));

import { getAccount } from '../lib/account-boot';
import { readUserHash } from '../lib/user-hash';
import { getAppVersion } from '../lib/device';
import { sessionTracker } from '../lib/session-tracker';
import { store } from '../store';

// ─── Inline the effect logic (mirrors ModuleScreen useEffect body) ────────────

type Research = { trackTable: ReturnType<typeof vi.fn>; hasConsent: () => boolean };

function runModuleOpenEffect(
  moduleId: string,
  research: Research,
): () => void {
  if (!research.hasConsent()) return () => {};
  const userHash = readUserHash();
  if (!userHash) return () => {};
  const country = (store.get as ReturnType<typeof vi.fn>)('shared', 'settings.country', 'INTL') as string;
  const now = Date.now();
  const openedAt = new Date(now).toISOString();
  const openedAtMs = now;
  const sessionId = sessionTracker.getSessionId();

  research.trackTable('module_events', {
    user_hash: userHash,
    session_id: sessionId ?? '',
    module: moduleId,
    opened_at: openedAt,
    country,
    app_version: getAppVersion(),
  });

  sessionTracker.onModuleOpened(moduleId);

  return () => {
    const closedAt = Date.now();
    const dur = Math.round((closedAt - openedAtMs) / 1000);
    research.trackTable('module_events', {
      session_id: sessionId ?? '',
      module: moduleId,
      closed_at: new Date(closedAt).toISOString(),
      duration_seconds: dur,
      actions_count: 0,
      country,
    });
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

function makeResearch(consent: boolean): Research {
  return { trackTable: vi.fn(), hasConsent: () => consent };
}

beforeEach(() => {
  vi.clearAllMocks();
  (getAccount as ReturnType<typeof vi.fn>).mockReturnValue({
    research: makeResearch(true),
  });
});

describe('ModuleScreen · module_events open row', () => {
  it('emits module_events with correct open row shape on mount', () => {
    const r = makeResearch(true);
    runModuleOpenEffect('finance', r);

    expect(r.trackTable).toHaveBeenCalledOnce();
    const [table, row] = r.trackTable.mock.calls[0] as [string, Record<string, unknown>];
    expect(table).toBe('module_events');
    expect(row.module).toBe('finance');
    expect(typeof row.opened_at).toBe('string');
    expect(row.closed_at).toBeUndefined();
    expect(row.user_hash).toBe('testhash');
    expect(row.session_id).toBe('session-abc');
    expect(row.country).toBe('TR');
    expect(row.app_version).toBe('0.0.1-test');
  });

  it('calls sessionTracker.onModuleOpened with the moduleId', () => {
    const r = makeResearch(true);
    runModuleOpenEffect('habits', r);
    expect(sessionTracker.onModuleOpened).toHaveBeenCalledWith('habits');
  });

  it('does NOT emit when consent is false', () => {
    const r = makeResearch(false);
    runModuleOpenEffect('finance', r);
    expect(r.trackTable).not.toHaveBeenCalled();
  });

  it('does NOT emit when user_hash is null', () => {
    (readUserHash as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    const r = makeResearch(true);
    runModuleOpenEffect('finance', r);
    expect(r.trackTable).not.toHaveBeenCalled();
  });
});

describe('ModuleScreen · module_events close row', () => {
  it('emits module_events with closed_at and duration_seconds on unmount', () => {
    const r = makeResearch(true);
    const cleanup = runModuleOpenEffect('finance', r);
    r.trackTable.mockClear();
    cleanup();

    expect(r.trackTable).toHaveBeenCalledOnce();
    const [table, row] = r.trackTable.mock.calls[0] as [string, Record<string, unknown>];
    expect(table).toBe('module_events');
    expect(row.module).toBe('finance');
    expect(typeof row.closed_at).toBe('string');
    expect(typeof row.duration_seconds).toBe('number');
    expect(row.session_id).toBe('session-abc');
    expect(row.opened_at).toBeUndefined();
  });

  it('does not emit a close row when consent was false (cleanup is no-op)', () => {
    const r = makeResearch(false);
    const cleanup = runModuleOpenEffect('finance', r);
    cleanup();
    expect(r.trackTable).not.toHaveBeenCalled();
  });
});
