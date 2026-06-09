/**
 * Work module · scheduled-block + hand-off capture tests
 *
 * Two features, both UI-first capture:
 *
 *  1. Scheduled deep-work blocks → work.scheduled_blocks → the orchestrator's
 *     cue scan fires the "deep work ahead" reminder ahead of start. We prove
 *     the *data path*: repo persists a block, the bridge mirrors it into the
 *     store key the cue logic reads, and scanCues() dispatches a reminder for
 *     a block scheduled ~1h out. (A cancelled block is skipped.)
 *
 *  2. Hand-off notes — capture + list/resolve. Capture-only (no watcher), so
 *     we prove persistence + the open/resolved split, not a store sync.
 *
 * The repo tests run against a small stateful in-memory `sql` mock that
 * understands exactly the statements the two new repos emit — the production
 * shim (storage/sqlite.ts) is a no-op, so a real-ish fake is needed to prove
 * persistence end to end.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { createWorkOrchestrator } from '@ollie/orchestrator';
import type { NotificationSpec } from '@ollie/notifications';

// ─── stateful in-memory sql mock ───────────────────────────────────────────
//
// Keyed off table name + statement verb; covers only the queries the
// scheduledBlocks + handoffs repos issue.

interface BlockRow {
  id: string;
  label: string | null;
  start_ts: number;
  duration_min: number | null;
  cancelled_at: number | null;
  created_at: number;
}
interface HandoffRow {
  id: string;
  text: string;
  project: string | null;
  resolved_at: number | null;
  ts: number;
}

const blockTable: BlockRow[] = [];
const handoffTable: HandoffRow[] = [];

vi.mock('../../storage', () => ({
  sql: {
    async execute(query: string, params: unknown[] = []) {
      const q = query.replace(/\s+/g, ' ').trim();
      if (q.startsWith('INSERT INTO work_scheduled_blocks')) {
        const [id, label, start_ts, duration_min, created_at] = params as [
          string,
          string | null,
          number,
          number | null,
          number,
        ];
        blockTable.push({
          id,
          label,
          start_ts,
          duration_min,
          cancelled_at: null,
          created_at,
        });
      } else if (q.startsWith('UPDATE work_scheduled_blocks SET cancelled_at')) {
        const [cancelled_at, id] = params as [number, string];
        const row = blockTable.find((r) => r.id === id);
        if (row) row.cancelled_at = cancelled_at;
      } else if (q.startsWith('INSERT INTO work_handoff_notes')) {
        const [id, text, project, ts] = params as [
          string,
          string,
          string | null,
          number,
        ];
        handoffTable.push({ id, text, project, resolved_at: null, ts });
      } else if (q.startsWith('UPDATE work_handoff_notes SET resolved_at')) {
        const [resolved_at, id] = params as [number, string];
        const row = handoffTable.find((r) => r.id === id);
        if (row) row.resolved_at = resolved_at;
      }
      return { rowsAffected: 1 };
    },
    async select(query: string) {
      const q = query.replace(/\s+/g, ' ').trim();
      if (q.includes('FROM work_scheduled_blocks')) {
        let rows = [...blockTable];
        if (q.includes('cancelled_at IS NULL')) {
          rows = rows.filter((r) => r.cancelled_at == null);
        }
        rows.sort((a, b) => a.start_ts - b.start_ts);
        return rows;
      }
      if (q.includes('FROM work_handoff_notes')) {
        let rows = [...handoffTable];
        if (q.includes('resolved_at IS NULL')) {
          rows = rows.filter((r) => r.resolved_at == null);
        }
        rows.sort((a, b) => b.ts - a.ts);
        return rows;
      }
      return [];
    },
  },
}));

import { scheduledBlocks, handoffs } from './repo';
import { syncToStore } from './bridge';

// repo.list() inside the bridge also reads events + tasks — those go through
// the same mocked sql.select, which returns [] for any table it doesn't know,
// so focus_log / tasks / meetings mirror empty (fine for this test).

const MIN = 60_000;
const FIXED_NOW = new Date('2026-06-01T09:00:00').getTime();

beforeEach(() => {
  blockTable.length = 0;
  handoffTable.length = 0;
});

describe('scheduled deep-work blocks — capture + bridge + cue', () => {
  it('persists a block and lists it (active only)', async () => {
    const startTs = FIXED_NOW + 60 * MIN;
    const added = await scheduledBlocks.add({
      label: 'Q3 deck',
      startTs,
    });
    expect(added.id).toBeTruthy();

    const active = await scheduledBlocks.list();
    expect(active).toHaveLength(1);
    expect(active[0]!.label).toBe('Q3 deck');
    expect(active[0]!.startTs).toBe(startTs);
    expect(active[0]!.cancelledAt).toBeNull();

    // cancel → drops off the active list, stays in listAll
    await scheduledBlocks.cancel(added.id);
    expect(await scheduledBlocks.list()).toHaveLength(0);
    const all = await scheduledBlocks.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.cancelledAt).not.toBeNull();
  });

  it('mirrors blocks into work.scheduled_blocks in the cue shape', async () => {
    const startTs = FIXED_NOW + 60 * MIN;
    await scheduledBlocks.add({ label: 'deep work', startTs });

    const store = createStore(createMemoryAdapter());
    await syncToStore(store);

    const mirrored = store.get<
      Array<{ id: string; start_at: number; duration_min: number; label?: string }>
    >('work', 'scheduled_blocks', []);
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]!.start_at).toBe(startTs);
    // duration snapped onto a FocusDurationMin (null → 25)
    expect([15, 25, 45, 90]).toContain(mirrored[0]!.duration_min);
    expect(mirrored[0]!.label).toBe('deep work');
  });

  it('fires the deep-work reminder for a block ~1h out, skips a cancelled one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    // One block 60 min out (should fire), one cancelled 60 min out (must not).
    const live = await scheduledBlocks.add({
      label: 'Q3 deck',
      startTs: FIXED_NOW + 60 * MIN,
    });
    const dead = await scheduledBlocks.add({
      label: 'cancelled block',
      startTs: FIXED_NOW + 60 * MIN,
    });
    await scheduledBlocks.cancel(dead.id);

    const store = createStore(createMemoryAdapter());
    await syncToStore(store);

    const fired: NotificationSpec[] = [];
    const orch = createWorkOrchestrator(store, {
      now: () => FIXED_NOW,
      scheduleNotification: (spec) => {
        fired.push(spec);
      },
    });

    orch.scanCues();

    // Exactly one deep-work reminder, keyed to the live block.
    const deepWork = fired.filter((f) =>
      f.dedupe_key.startsWith('work:deep_work_tomorrow:'),
    );
    expect(deepWork).toHaveLength(1);
    expect(deepWork[0]!.dedupe_key).toBe(`work:deep_work_tomorrow:${live.id}`);
    expect(deepWork[0]!.dedupe_key).not.toContain(dead.id);

    orch.teardown();
    vi.useRealTimers();
  });
});

describe('hand-off notes — capture + list/resolve', () => {
  it('persists a note, lists it open, then drops it once resolved', async () => {
    const note = await handoffs.add({
      text: 'asked Burhan to send the file',
      project: 'Visa packet',
    });
    expect(note.id).toBeTruthy();
    expect(note.resolvedAt).toBeNull();

    let open = await handoffs.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0]!.text).toBe('asked Burhan to send the file');
    expect(open[0]!.project).toBe('Visa packet');

    await handoffs.resolve(note.id);
    open = await handoffs.listOpen();
    expect(open).toHaveLength(0);

    // still present in the full list, now stamped resolved
    const all = await handoffs.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.resolvedAt).not.toBeNull();
  });

  it('keeps the project optional', async () => {
    await handoffs.add({ text: 'left notes for future me' });
    const open = await handoffs.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0]!.project).toBeNull();
  });
});
