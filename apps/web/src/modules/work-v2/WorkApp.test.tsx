/**
 * work-v2 · WorkApp — integration smoke test
 *
 * Mounts the real preview module against the REAL matter backend. work-v2
 * reads the live `work` store namespace the matter container + dump→matter
 * routing (committed as 9ed51e5) write into — `work.matters`,
 * `work.matter_loose_dumps`, `work.matter_suggestions` — plus the source
 * slices (`work.tasks`, `dump.items`) that hold the routed note text.
 *
 * Each test seeds those keys directly with real `Matter` records (built via
 * `createMatter` / `attachDumpRef`) so the screens render deterministically.
 *
 * Verifies:
 *   - the work face renders the matters card + the top-matters preview
 *   - the in-module nav stack pushes a leaf and pops back
 *   - the matter list renders every matter + the loose foot row
 *   - opening a matter row deep-links its detail view (identity + raw notes)
 *   - the matter view shows NO "missing" / deficit field
 *   - the confirm sheet renders a detected suggestion + its evidence
 *   - confirming a suggestion creates a real matter + clears the suggestion
 *   - the empty state renders when there are no matters
 *   - the Safe dot invokes its handler
 */
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { createMatter, attachDumpRef } from '@ollie/logic/work';
import type { Matter, NewMatterSuggestion } from '@ollie/logic/work';
import type { LooseDumpRef } from '@ollie/orchestrator';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { WorkApp } from './WorkApp';
import { store } from '../../store';

const NOW = new Date('2026-05-19T09:00:00').getTime();
const DAY = 86_400_000;

interface DumpRow {
  id: string;
  text: string;
  ts: number;
}

/** build a matter with N clear-matched dump refs */
function matterWith(
  id: string,
  name: string,
  type: string,
  dumpIds: string[],
  createdAt = NOW - 5 * DAY,
): Matter {
  let m = createMatter({ id, name, type, created_at: createdAt });
  for (const did of dumpIds) {
    m = attachDumpRef(m, {
      dump_id: did,
      source_slice: 'dump',
      origin: 'clear',
      routed_at: NOW - 4 * DAY,
      score: 1,
    });
  }
  return m;
}

/** seed the live `work` namespace the real matter backend writes into */
function seedBackend(opts: {
  matters?: Matter[];
  loose?: LooseDumpRef[];
  suggestions?: NewMatterSuggestion[];
  dumpItems?: DumpRow[];
}): void {
  store.set('work', 'matters', opts.matters ?? []);
  store.set('work', 'matter_loose_dumps', opts.loose ?? []);
  store.set('work', 'matter_suggestions', opts.suggestions ?? []);
  store.set('work', 'tasks', []);
  store.set('work', 'meetings', []);
  store.set('dump', 'items', opts.dumpItems ?? []);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // the app store is a module-level singleton with an in-memory cache that
  // localStorage.clear() does NOT reset — re-seed the backend keys before
  // every test so each one boots from a known state.
  seedBackend({});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** find a button whose trimmed text content contains `text` */
function btnContaining(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
}

describe('WorkApp', () => {
  it('the work face renders the matters card and the top-matters preview', () => {
    seedBackend({
      matters: [
        matterWith('m1', 'Yılmaz', 'E-2', ['d1'], NOW - DAY),
        matterWith('m2', 'Okafor', 'H-1B', ['d2', 'd3'], NOW - 2 * DAY),
      ],
      dumpItems: [
        { id: 'd1', text: 'note one', ts: NOW - DAY },
        { id: 'd2', text: 'note two', ts: NOW - DAY },
        { id: 'd3', text: 'note three', ts: NOW - DAY },
      ],
    });
    act(() => {
      root.render(<WorkApp now={NOW} />);
    });
    expect(container.textContent).toContain('work');
    expect(container.textContent).toContain('matters');
    expect(container.textContent).toContain('2 matters');
    // the at-rest preview shows the seeded matters
    expect(container.textContent).toContain('Yılmaz · E-2');
    expect(container.textContent).toContain('Okafor · H-1B');
  });

  it('the work face renders an empty state when there are no matters', () => {
    act(() => {
      root.render(<WorkApp now={NOW} />);
    });
    expect(container.textContent).toContain('no matters yet');
  });

  it('the work face routes into the matter list and back', () => {
    seedBackend({ matters: [matterWith('m1', 'Yılmaz', 'E-2', [])] });
    act(() => {
      root.render(<WorkApp now={NOW} />);
    });
    const open = btnContaining('open matters');
    expect(open).toBeDefined();
    act(() => open!.click());
    // on the matter list now
    expect(container.textContent).toContain('all your matters');
    expect(container.textContent).toContain('1 matter');
    // back returns to the work face
    const back = container.querySelector('[aria-label="back"]') as HTMLButtonElement;
    act(() => back.click());
    expect(container.textContent).toContain('open matters');
  });

  it('the matter list renders every matter + the loose foot row', () => {
    seedBackend({
      matters: [
        matterWith('m1', 'Yılmaz', 'E-2', ['d1']),
        matterWith('m2', 'Okafor', 'H-1B', []),
      ],
      loose: [
        {
          dump_id: 'l1',
          source_slice: 'dump',
          text: 'unsorted note',
          ts: NOW,
          parked_at: NOW,
        },
      ],
      dumpItems: [{ id: 'd1', text: 'a note', ts: NOW - DAY }],
    });
    act(() => {
      root.render(<WorkApp now={NOW} initialRoute="matters" />);
    });
    expect(container.textContent).toContain('Yılmaz');
    expect(container.textContent).toContain('Okafor');
    expect(container.textContent).toContain('2 matters');
    // the loose / unsorted foot line is surfaced
    expect(container.textContent).toContain('loose');
  });

  it('opening a matter row deep-links its detail view (identity + notes)', () => {
    seedBackend({
      matters: [matterWith('m1', 'Yılmaz', 'E-2', ['d1', 'd2'])],
      dumpItems: [
        { id: 'd1', text: 'called USCIS about the filing window', ts: NOW - DAY },
        { id: 'd2', text: 'lease still not signed', ts: NOW - 2 * DAY },
      ],
    });
    act(() => {
      root.render(<WorkApp now={NOW} initialRoute="matters" />);
    });
    const row = btnContaining('Yılmaz');
    expect(row).toBeDefined();
    act(() => row!.click());
    // the matter detail — identity + the routed raw notes
    expect(container.textContent).toContain('Yılmaz');
    expect(container.textContent).toContain('notes filed here');
    expect(container.textContent).toContain('called USCIS about the filing window');
    expect(container.textContent).toContain('lease still not signed');
    // the honest line — the synthesised briefing is a later phase
    expect(container.textContent).toContain('ollie is gathering');
  });

  it('the matter view shows NO "missing" / deficit field', () => {
    seedBackend({
      matters: [matterWith('m1', 'Yılmaz', 'E-2', ['d1'])],
      dumpItems: [{ id: 'd1', text: 'a note', ts: NOW - DAY }],
    });
    act(() => {
      root.render(
        <WorkApp now={NOW} initialRoute="matter" initialMatterId="m1" />,
      );
    });
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).not.toContain('missing');
    expect(text).not.toContain('deficit');
  });

  it('the confirm sheet renders a detected suggestion and its evidence', () => {
    seedBackend({
      suggestions: [
        {
          candidate: 'Park',
          key: 'park',
          occurrences: 3,
          dump_ids: ['d1', 'd2', 'd3'],
        },
      ],
      dumpItems: [
        { id: 'd1', text: 'Park rec letter signed', ts: NOW - DAY },
        { id: 'd2', text: 'Park O-1 packet', ts: NOW - 2 * DAY },
        { id: 'd3', text: 'follow up with Park', ts: NOW - 3 * DAY },
      ],
    });
    act(() => {
      root.render(<WorkApp now={NOW} initialRoute="confirm" />);
    });
    expect(container.textContent).toContain('ollie noticed');
    expect(container.textContent).toContain('Is it a matter?');
    expect(container.textContent).toContain('3 notes');
    // an evidence excerpt
    expect(container.textContent).toContain('rec letter signed');
    // the two choices
    expect(btnContaining("yes, it’s a matter")).toBeDefined();
    expect(btnContaining('not a matter')).toBeDefined();
  });

  it('confirming a suggestion creates a real matter and clears the sheet', () => {
    seedBackend({
      matters: [],
      suggestions: [
        {
          candidate: 'Park',
          key: 'park',
          occurrences: 3,
          dump_ids: ['d1', 'd2', 'd3'],
        },
      ],
      dumpItems: [
        { id: 'd1', text: 'Park note one', ts: NOW - DAY },
        { id: 'd2', text: 'Park note two', ts: NOW - 2 * DAY },
        { id: 'd3', text: 'Park note three', ts: NOW - 3 * DAY },
      ],
    });
    act(() => {
      root.render(<WorkApp now={NOW} initialRoute="confirm" />);
    });
    const confirm = btnContaining("yes, it’s a matter")!;
    act(() => confirm.click());
    // a real Matter was written into work.matters — its name carries the
    // routing key (createMatter drops an alias equal to the name key, so
    // `park` lives in the name, not the aliases list)
    const matters = store.get<Matter[]>('work', 'matters', []);
    expect(matters).toHaveLength(1);
    expect(matters[0].name).toBe('Park');
    expect(matters[0].name.toLowerCase()).toBe('park');
    // the suggestion was consumed
    expect(store.get('work', 'matter_suggestions', [])).toHaveLength(0);
    // popped back to the work face
    expect(container.textContent).toContain('open matters');
  });

  it('dismissing a suggestion clears it without creating a matter', () => {
    seedBackend({
      suggestions: [
        {
          candidate: 'Park',
          key: 'park',
          occurrences: 3,
          dump_ids: ['d1', 'd2', 'd3'],
        },
      ],
    });
    act(() => {
      root.render(<WorkApp now={NOW} initialRoute="confirm" />);
    });
    act(() => btnContaining('not a matter')!.click());
    expect(store.get('work', 'matters', [])).toHaveLength(0);
    expect(store.get('work', 'matter_suggestions', [])).toHaveLength(0);
  });

  it('Safe dot invokes the onSafe handler', () => {
    let safe = false;
    act(() => {
      root.render(
        <WorkApp
          now={NOW}
          onSafe={() => {
            safe = true;
          }}
        />,
      );
    });
    const safeDot = container.querySelector('[aria-label="safe"]') as HTMLButtonElement;
    act(() => safeDot.click());
    expect(safe).toBe(true);
  });
});
