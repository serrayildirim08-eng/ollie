/**
 * @ollie/orchestrator · research:row_written emission tests
 *
 * Sprint B'' (2026-05-14). Per Serra's spec the per-module orchestrators
 * must emit `research:row_written` whenever a scrubbable row is written
 * to one of the 5 corpus tables:
 *   brain_dump_log / finance_records / body_records / home_records / work_records
 *
 * The emit is unconditional — consent gating happens in research.ts, not
 * at the emit site. These tests assert the emit fires with the correct
 * payload shape regardless of consent state. (Consent state isn't even
 * configured in these tests — the orchestrators don't read it.)
 *
 * Each test:
 *   1. subscribes to `research:row_written` via the global event bus,
 *   2. runs the dispatch / orchestrator path that writes a row,
 *   3. asserts at least one matching emit was captured with the right
 *      table + non-empty text.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryAdapter, createStore } from '@ollie/store';
import type { Store } from '@ollie/store';
import * as events from '@ollie/events';
import { dispatchAction, routeBrainDump } from '../src/braindump-dispatch';
import { createDumpOrchestrator } from '../src/dump';
import { createFinanceOrchestrator } from '../src/finance';

interface CapturedRow {
  row_id: string;
  table: string;
  text: string;
  locale: string;
  ts: number;
  sector_hint?: string;
}

function captureRows(): { rows: CapturedRow[]; off: () => void } {
  const rows: CapturedRow[] = [];
  const off = events.on('research:row_written', (raw: unknown) => {
    rows.push(raw as CapturedRow);
  });
  return { rows, off };
}

function makeStore(): Store {
  return createStore(createMemoryAdapter());
}

const FIXED_NOW = new Date('2026-05-14T12:00:00Z').getTime();

describe('research:row_written · braindump-dispatch (work_records)', () => {
  let store: Store;
  let captured: ReturnType<typeof captureRows>;

  beforeEach(() => {
    store = makeStore();
    captured = captureRows();
  });
  afterEach(() => {
    captured.off();
  });

  it('emits work_records on work task write', () => {
    dispatchAction(
      { module: 'work', action: 'add', data: 'finish q3 deck for the board' },
      store,
      FIXED_NOW,
    );

    const workRows = captured.rows.filter((r) => r.table === 'work_records');
    expect(workRows).toHaveLength(1);
    expect(workRows[0].text).toBe('finish q3 deck for the board');
    expect(workRows[0].locale).toBe('en');
    expect(workRows[0].ts).toBe(FIXED_NOW);
    expect(typeof workRows[0].row_id).toBe('string');
    expect(workRows[0].row_id.length).toBeGreaterThan(0);
  });

  it('emits work_records on meeting write (Turkish keyword)', () => {
    dispatchAction(
      { module: 'work', action: 'add', data: 'toplantı with client tomorrow' },
      store,
      FIXED_NOW,
    );

    const workRows = captured.rows.filter((r) => r.table === 'work_records');
    expect(workRows).toHaveLength(1);
    expect(workRows[0].text).toContain('toplantı');
  });

  it('honors getLocale override', () => {
    dispatchAction(
      { module: 'work', action: 'add', data: 'terminar reporte trimestral' },
      store,
      FIXED_NOW,
      { getLocale: () => 'es' },
    );

    const workRows = captured.rows.filter((r) => r.table === 'work_records');
    expect(workRows).toHaveLength(1);
    expect(workRows[0].locale).toBe('es');
  });
});

describe('research:row_written · braindump-dispatch (body_records)', () => {
  let store: Store;
  let captured: ReturnType<typeof captureRows>;

  beforeEach(() => {
    store = makeStore();
    captured = captureRows();
  });
  afterEach(() => {
    captured.off();
  });

  it('emits body_records on generic body item', () => {
    dispatchAction(
      { module: 'body', action: 'add', data: 'lower back pain since saturday' },
      store,
      FIXED_NOW,
    );

    const bodyRows = captured.rows.filter((r) => r.table === 'body_records');
    expect(bodyRows).toHaveLength(1);
    expect(bodyRows[0].text).toBe('lower back pain since saturday');
  });

  it('emits body_records on supplement entry', () => {
    dispatchAction(
      { module: 'body', action: 'add', data: 'took my d3 supplement' },
      store,
      FIXED_NOW,
    );

    const bodyRows = captured.rows.filter((r) => r.table === 'body_records');
    expect(bodyRows).toHaveLength(1);
    expect(bodyRows[0].text).toBe('took my d3 supplement');
  });

  it('does NOT emit for water_log (no scrubbable field)', () => {
    dispatchAction(
      { module: 'body', action: 'add', data: 'glass of water' },
      store,
      FIXED_NOW,
    );

    expect(captured.rows).toHaveLength(0);
  });
});

describe('research:row_written · braindump-dispatch (home_records)', () => {
  let store: Store;
  let captured: ReturnType<typeof captureRows>;

  beforeEach(() => {
    store = makeStore();
    captured = captureRows();
  });
  afterEach(() => {
    captured.off();
  });

  it('emits home_records on admin item (default fallthrough)', () => {
    dispatchAction(
      { module: 'admin', action: 'add', data: 'renew passport before august' },
      store,
      FIXED_NOW,
    );

    const homeRows = captured.rows.filter((r) => r.table === 'home_records');
    expect(homeRows).toHaveLength(1);
    expect(homeRows[0].text).toBe('renew passport before august');
  });

  it('emits home_records on pets item', () => {
    dispatchAction(
      { module: 'pets', action: 'add', data: 'vet appointment for milo on thursday' },
      store,
      FIXED_NOW,
    );

    const homeRows = captured.rows.filter((r) => r.table === 'home_records');
    expect(homeRows).toHaveLength(1);
    expect(homeRows[0].text).toContain('milo');
  });

  it('emits home_records on grocery add + log', () => {
    dispatchAction(
      { module: 'grocery', action: 'add', data: 'oat milk' },
      store,
      FIXED_NOW,
    );
    dispatchAction(
      { module: 'grocery', action: 'log', data: 'paid 4.50 for oat milk' },
      store,
      FIXED_NOW,
    );

    const homeRows = captured.rows.filter((r) => r.table === 'home_records');
    expect(homeRows).toHaveLength(2);
    expect(homeRows[0].text).toBe('oat milk');
    expect(homeRows[1].text).toContain('oat milk');
  });
});

describe('research:row_written · braindump-dispatch (brain_dump_log)', () => {
  let store: Store;
  let captured: ReturnType<typeof captureRows>;

  beforeEach(() => {
    store = makeStore();
    captured = captureRows();
  });
  afterEach(() => {
    captured.off();
  });

  it('emits brain_dump_log when astrology routes to dump', () => {
    dispatchAction(
      { module: 'astrology', action: 'add', data: 'venus retrograde mood crash' },
      store,
      FIXED_NOW,
    );

    const dumpRows = captured.rows.filter((r) => r.table === 'brain_dump_log');
    expect(dumpRows).toHaveLength(1);
    expect(dumpRows[0].text).toBe('venus retrograde mood crash');
  });

  it('emits brain_dump_log when explicit dump module is dispatched', () => {
    dispatchAction(
      { module: 'dump', action: 'add', data: 'long ramble about everything' },
      store,
      FIXED_NOW,
    );

    const dumpRows = captured.rows.filter((r) => r.table === 'brain_dump_log');
    expect(dumpRows).toHaveLength(1);
    expect(dumpRows[0].text).toBe('long ramble about everything');
  });

  it('routeBrainDump emits the right table for a sentence that splits to work', () => {
    const r = routeBrainDump('deadline friday on the deck', makeStore(), FIXED_NOW);
    expect(r.isAnswer).toBe(false);
    const workRows = captured.rows.filter((r2) => r2.table === 'work_records');
    expect(workRows.length).toBeGreaterThanOrEqual(1);
    expect(workRows[0].text).toContain('deadline');
  });
});

describe('research:row_written · dump orchestrator (brain_dump_log)', () => {
  let store: Store;
  let captured: ReturnType<typeof captureRows>;
  let orch: ReturnType<typeof createDumpOrchestrator>;
  const now = vi.fn(() => FIXED_NOW);

  beforeEach(() => {
    vi.useFakeTimers();
    store = makeStore();
    captured = captureRows();
    orch = createDumpOrchestrator(store, { now });
    orch.init();
  });
  afterEach(() => {
    orch.teardown();
    captured.off();
    vi.useRealTimers();
  });

  it('emits brain_dump_log for each new dump.items entry', () => {
    // dump.items starts empty. Append 2 fresh items, advance debounce.
    store.update<Array<{ id?: string; text: string; ts: number }>>(
      'dump',
      'items',
      () => [
        { id: 'i1', text: 'first dump line about a real day', ts: FIXED_NOW - 1000 },
        { id: 'i2', text: 'second line — therapy was useful', ts: FIXED_NOW - 500 },
      ],
    );

    // Advance past debounce (500ms in dump orchestrator).
    vi.advanceTimersByTime(600);

    const dumpRows = captured.rows.filter((r) => r.table === 'brain_dump_log');
    expect(dumpRows).toHaveLength(2);
    expect(dumpRows.map((r) => r.text)).toEqual([
      'first dump line about a real day',
      'second line — therapy was useful',
    ]);
    expect(dumpRows[0].row_id).toBe('i1');
    expect(dumpRows[1].row_id).toBe('i2');
  });

  it('does not re-emit for pre-existing items on next recompute', () => {
    store.update<Array<{ id?: string; text: string; ts: number }>>(
      'dump',
      'items',
      () => [{ id: 'i1', text: 'first dump line', ts: FIXED_NOW - 1000 }],
    );
    vi.advanceTimersByTime(600);
    expect(captured.rows.filter((r) => r.table === 'brain_dump_log')).toHaveLength(1);

    // Trigger another recompute without adding new dump items.
    store.update<Array<{ id?: string; text: string; ts: number }>>(
      'journal',
      'entries',
      () => [{ id: 'j1', text: 'unrelated', ts: FIXED_NOW - 2000 }],
    );
    vi.advanceTimersByTime(600);

    // Still just 1 dump-table emit; no double-emit on retrigger.
    expect(captured.rows.filter((r) => r.table === 'brain_dump_log')).toHaveLength(1);
  });
});

describe('research:row_written · finance orchestrator (finance_records)', () => {
  let store: Store;
  let captured: ReturnType<typeof captureRows>;
  let orch: ReturnType<typeof createFinanceOrchestrator>;

  beforeEach(() => {
    store = makeStore();
    captured = captureRows();
    orch = createFinanceOrchestrator(store, { now: () => FIXED_NOW });
  });
  afterEach(() => {
    captured.off();
  });

  it('emits finance_records when processDump ingests a transaction', () => {
    const res = orch.processDump({
      ts: FIXED_NOW,
      text: 'spent 14.50 on lunch at the cafe',
    });
    expect(res.ok).toBe(true);

    const financeRows = captured.rows.filter((r) => r.table === 'finance_records');
    expect(financeRows).toHaveLength(1);
    expect(financeRows[0].text).toBe('spent 14.50 on lunch at the cafe');
    expect(financeRows[0].locale).toBe('en');
    expect(financeRows[0].ts).toBe(FIXED_NOW);
  });

  it('honors getLocale override', () => {
    const orchEs = createFinanceOrchestrator(store, {
      now: () => FIXED_NOW,
      getLocale: () => 'es',
    });
    orchEs.processDump({
      ts: FIXED_NOW,
      text: 'gasté 14.50 en almuerzo en el café',
    });
    const financeRows = captured.rows.filter((r) => r.table === 'finance_records');
    expect(financeRows.length).toBeGreaterThanOrEqual(1);
    expect(financeRows[financeRows.length - 1].locale).toBe('es');
  });

  it('does not emit when dump is not parseable as finance', () => {
    const res = orch.processDump({ ts: FIXED_NOW, text: 'just rambling, no money here' });
    expect(res.ok).toBe(false);
    expect(captured.rows.filter((r) => r.table === 'finance_records')).toHaveLength(0);
  });
});

describe('research:row_written · opt-in vs opt-out parity (emit-site agnostic)', () => {
  // The emit site doesn't read consent — it always fires. Consent gating
  // is the research orchestrator's job. This test pins that contract so a
  // future refactor doesn't accidentally move the gate upstream.
  let store: Store;
  let captured: ReturnType<typeof captureRows>;

  beforeEach(() => {
    store = makeStore();
    captured = captureRows();
  });
  afterEach(() => {
    captured.off();
  });

  it('emits regardless of any consent shape in the store', () => {
    // Set a research_optin: false-ish shape; the dispatcher must still emit.
    store.set('shared', 'consent', {
      necessary: true,
      marketing: false,
      research_optin: false,
    });

    dispatchAction(
      { module: 'work', action: 'add', data: 'noop work task' },
      store,
      FIXED_NOW,
    );

    const workRows = captured.rows.filter((r) => r.table === 'work_records');
    expect(workRows).toHaveLength(1);
  });
});
