/**
 * work-v2 · selectors — unit tests
 *
 * The selectors are the pure view-model layer over the REAL matter backend
 * (`@ollie/logic/work` — the `Matter` model + dump→matter routing, committed
 * as 9ed51e5 — surfaced through the live `work` store namespace). These tests
 * build `WorkState` from real `Matter` records via `createMatter` /
 * `attachDumpRef` and verify the Phase-1/2-honest view-models:
 *   - the work face (matter count + the top-matters preview)
 *   - the matter list (ordering, plain note counts, the loose foot row)
 *   - the matter detail (identity + RESOLVED raw notes — NO "missing" field)
 *   - the auto-detect / confirm view-model (a real NewMatterSuggestion)
 */
import { describe, it, expect } from 'vitest';
import { createMatter, attachDumpRef } from '@ollie/logic/work';
import type { Matter, NewMatterSuggestion } from '@ollie/logic/work';
import type { LooseDumpRef } from '@ollie/orchestrator';
import {
  whenLabel,
  orderedMatters,
  resolveMatterDumps,
  workFaceVM,
  matterListVM,
  matterDetailVM,
  matterConfirmVM,
  highlightName,
  EMPTY_WORK_STATE,
  type WorkState,
} from './selectors';

const NOW = new Date('2026-05-19T09:00:00').getTime();
const DAY = 86_400_000;

/** build a matter with N routed dumps, all clear-matched unless flagged */
function matterWith(
  id: string,
  name: string,
  type: string,
  dumpIds: string[],
  opts: { createdAt?: number; archived?: boolean; guessIds?: string[] } = {},
): Matter {
  let m = createMatter({
    id,
    name,
    type,
    created_at: opts.createdAt ?? NOW - 5 * DAY,
    status: opts.archived ? 'archived' : 'active',
  });
  const guesses = new Set(opts.guessIds ?? []);
  for (const did of dumpIds) {
    m = attachDumpRef(m, {
      dump_id: did,
      source_slice: 'dump',
      origin: guesses.has(did) ? 'guess' : 'clear',
      routed_at: NOW - 4 * DAY,
      score: guesses.has(did) ? 0.7 : 1,
    });
  }
  return m;
}

/** assemble a WorkState from matters + optional loose / suggestion data */
function state(over: Partial<WorkState> = {}): WorkState {
  return { ...EMPTY_WORK_STATE, ...over };
}

describe('whenLabel', () => {
  it('reads as a calm recency phrase, never exact', () => {
    expect(whenLabel(NOW, NOW)).toBe('today');
    expect(whenLabel(NOW - DAY, NOW)).toBe('yesterday');
    expect(whenLabel(NOW - 3 * DAY, NOW)).toBe('3 days ago');
    expect(whenLabel(NOW - 9 * DAY, NOW)).toBe('last week');
    expect(whenLabel(NOW - 20 * DAY, NOW)).toBe('2 weeks ago');
  });

  it('returns an empty string for a missing timestamp', () => {
    expect(whenLabel(0, NOW)).toBe('');
  });
});

describe('orderedMatters', () => {
  it('puts active matters newest-first, archived ones last', () => {
    const a = matterWith('a', 'Alpha', '', [], { createdAt: NOW - 10 * DAY });
    const b = matterWith('b', 'Beta', '', [], { createdAt: NOW - 2 * DAY });
    const c = matterWith('c', 'Gamma', '', [], {
      createdAt: NOW - DAY,
      archived: true,
    });
    const ordered = orderedMatters([a, c, b]);
    expect(ordered.map((m) => m.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('resolveMatterDumps', () => {
  it('joins a matter dump ref to its raw text from the source slice', () => {
    const m = matterWith('m', 'Yılmaz', 'E-2', ['d1', 'd2']);
    const s = state({
      matters: [m],
      dumpItems: [
        { id: 'd1', text: 'first note', ts: NOW - DAY },
        { id: 'd2', text: 'second note', ts: NOW - 3 * DAY },
      ],
    });
    const resolved = resolveMatterDumps(m, s);
    expect(resolved).toHaveLength(2);
    // newest first
    expect(resolved[0].text).toBe('first note');
    expect(resolved[1].text).toBe('second note');
  });

  it('drops a ref whose source row no longer exists', () => {
    const m = matterWith('m', 'Yılmaz', 'E-2', ['d1', 'gone']);
    const s = state({
      matters: [m],
      dumpItems: [{ id: 'd1', text: 'kept', ts: NOW }],
    });
    expect(resolveMatterDumps(m, s)).toHaveLength(1);
  });

  it('resolves text from work.tasks and work.meetings too', () => {
    const m = matterWith('m', 'Okafor', 'H-1B', ['t1', 'mt1']);
    const s = state({
      matters: [m],
      workTasks: [{ id: 't1', title: 'task note', created_at: NOW - DAY }],
      workMeetings: [{ id: 'mt1', title: 'meeting note', start_at: NOW }],
    });
    const texts = resolveMatterDumps(m, s).map((d) => d.text);
    expect(texts).toContain('task note');
    expect(texts).toContain('meeting note');
  });
});

describe('workFaceVM', () => {
  it('leads with the matter count + previews the top three', () => {
    const matters = [
      matterWith('a', 'Alpha', 'E-2', ['d1'], { createdAt: NOW - DAY }),
      matterWith('b', 'Beta', 'H-1B', ['d2', 'd3'], {
        createdAt: NOW - 2 * DAY,
      }),
      matterWith('c', 'Gamma', '', [], { createdAt: NOW - 3 * DAY }),
      matterWith('d', 'Delta', '', [], { createdAt: NOW - 4 * DAY }),
    ];
    const vm = workFaceVM(state({ matters }));
    expect(vm.matterCount).toBe(4);
    expect(vm.glanceLead).toBe('4 matters');
    expect(vm.topMatters).toHaveLength(3);
    expect(vm.topMatters[0].name).toBe('Alpha');
    expect(vm.topMatters[1].noteLine).toBe('2 notes filed');
  });

  it('reads "no matters yet" when there are none', () => {
    const vm = workFaceVM(state());
    expect(vm.matterCount).toBe(0);
    expect(vm.glanceLead).toBe('no matters yet');
    expect(vm.hasSuggestion).toBe(false);
  });

  it('surfaces a pending new-matter suggestion', () => {
    const sug: NewMatterSuggestion = {
      candidate: 'Park',
      key: 'park',
      occurrences: 4,
      dump_ids: ['d1', 'd2', 'd3', 'd4'],
    };
    const vm = workFaceVM(state({ suggestions: [sug] }));
    expect(vm.hasSuggestion).toBe(true);
    expect(vm.suggestionName).toBe('Park');
  });

  it('NEVER exposes a deficit / missing / needs-you count', () => {
    const vm = workFaceVM(state({ matters: [matterWith('a', 'A', '', [])] }));
    expect(vm).not.toHaveProperty('missing');
    expect(vm).not.toHaveProperty('needCount');
    expect(JSON.stringify(vm).toLowerCase()).not.toContain('missing');
  });
});

describe('matterListVM', () => {
  it('counts matters and lists every one', () => {
    const matters = [
      matterWith('a', 'Alpha', 'E-2', ['d1']),
      matterWith('b', 'Beta', 'H-1B', []),
    ];
    const vm = matterListVM(state({ matters }));
    expect(vm.countLine).toBe('2 matters');
    expect(vm.rows).toHaveLength(2);
    expect(vm.empty).toBe(false);
  });

  it('each row carries a plain note count, never a deficit line', () => {
    const vm = matterListVM(
      state({ matters: [matterWith('a', 'Alpha', 'E-2', ['d1', 'd2'])] }),
    );
    expect(vm.rows[0].noteLine).toBe('2 notes filed');
    expect(vm.rows[0]).not.toHaveProperty('nextLine');
    expect(vm.rows[0]).not.toHaveProperty('warm');
  });

  it('orders active matters before archived ones', () => {
    const matters = [
      matterWith('arch', 'Closed', '', [], { archived: true }),
      matterWith('live', 'Live', '', [], { createdAt: NOW - DAY }),
    ];
    const vm = matterListVM(state({ matters }));
    expect(vm.rows[0].name).toBe('Live');
    expect(vm.rows[1].name).toBe('Closed');
    expect(vm.rows[1].archived).toBe(true);
  });

  it('surfaces the loose / unsorted dump count for the foot row', () => {
    const loose: LooseDumpRef[] = [
      { dump_id: 'l1', source_slice: 'dump', text: 'x', ts: NOW, parked_at: NOW },
      { dump_id: 'l2', source_slice: 'dump', text: 'y', ts: NOW, parked_at: NOW },
    ];
    expect(matterListVM(state({ looseDumps: loose })).looseCount).toBe(2);
    expect(matterListVM(state()).looseCount).toBe(0);
  });

  it('reports empty when there are no matters', () => {
    const vm = matterListVM(state());
    expect(vm.empty).toBe(true);
    expect(vm.rows).toHaveLength(0);
  });
});

describe('matterDetailVM', () => {
  it('returns the matter identity + its resolved raw notes', () => {
    const m = matterWith('m', 'Yılmaz', 'E-2', ['d1', 'd2'], {
      createdAt: NOW - 3 * DAY,
    });
    const s = state({
      matters: [m],
      dumpItems: [
        { id: 'd1', text: 'called USCIS', ts: NOW - DAY },
        { id: 'd2', text: 'lease not signed', ts: NOW - 2 * DAY },
      ],
    });
    const vm = matterDetailVM(s, 'm', NOW);
    expect(vm.found).toBe(true);
    expect(vm.name).toBe('Yılmaz');
    expect(vm.type).toBe('E-2');
    expect(vm.opened).toContain('opened');
    expect(vm.noteCount).toBe(2);
    expect(vm.notes[0].text).toBe('called USCIS');
  });

  it('has NO missing / deficit field — only identity + notes', () => {
    const m = matterWith('m', 'Yılmaz', 'E-2', ['d1']);
    const s = state({
      matters: [m],
      dumpItems: [{ id: 'd1', text: 'note', ts: NOW }],
    });
    const vm = matterDetailVM(s, 'm', NOW);
    expect(vm).not.toHaveProperty('missing');
    expect(vm).not.toHaveProperty('done');
    expect(vm).not.toHaveProperty('pending');
    expect(vm).not.toHaveProperty('next');
    expect(JSON.stringify(vm).toLowerCase()).not.toContain('missing');
  });

  it('marks a fuzzy-guess note distinctly from a clear-matched one', () => {
    const m = matterWith('m', 'Yılmaz', 'E-2', ['d1', 'd2'], {
      guessIds: ['d2'],
    });
    const s = state({
      matters: [m],
      dumpItems: [
        { id: 'd1', text: 'clear note', ts: NOW - DAY },
        { id: 'd2', text: 'guessed note', ts: NOW - 2 * DAY },
      ],
    });
    const vm = matterDetailVM(s, 'm', NOW);
    expect(vm.guessCount).toBe(1);
    expect(vm.notes.find((n) => n.text === 'guessed note')?.isGuess).toBe(true);
    expect(vm.notes.find((n) => n.text === 'clear note')?.isGuess).toBe(false);
  });

  it('returns found:false when the matter id resolves to nothing', () => {
    expect(matterDetailVM(state(), 'no_such_matter', NOW).found).toBe(false);
  });
});

describe('matterConfirmVM', () => {
  it('exposes the detected suggestion — name, why, evidence excerpts', () => {
    const sug: NewMatterSuggestion = {
      candidate: 'Yılmaz',
      key: 'yilmaz',
      occurrences: 3,
      dump_ids: ['d1', 'd2', 'd3'],
    };
    const s = state({
      suggestions: [sug],
      dumpItems: [
        { id: 'd1', text: 'called USCIS about Yılmaz', ts: NOW - DAY },
        { id: 'd2', text: 'Yılmaz lease unsigned', ts: NOW - 2 * DAY },
        { id: 'd3', text: 'DS-160 for Yılmaz', ts: NOW - 3 * DAY },
      ],
    });
    const vm = matterConfirmVM(s, NOW);
    expect(vm.hasSuggestion).toBe(true);
    expect(vm.name).toBe('Yılmaz');
    expect(vm.occurrences).toBe(3);
    expect(vm.why).toContain('3 notes');
    expect(vm.excerpts).toHaveLength(3);
  });

  it('hasSuggestion is false when nothing is pending', () => {
    const vm = matterConfirmVM(state(), NOW);
    expect(vm.hasSuggestion).toBe(false);
    expect(vm.excerpts).toHaveLength(0);
  });
});

describe('highlightName', () => {
  it('splits an excerpt around the candidate name, case-insensitive', () => {
    const { before, match, after } = highlightName(
      'called USCIS about the Yılmaz filing window',
      'yılmaz',
    );
    expect(before).toBe('called USCIS about the ');
    expect(match).toBe('Yılmaz');
    expect(after).toBe(' filing window');
  });

  it('returns the text untouched when the name is absent', () => {
    const r = highlightName('no name here', 'Yılmaz');
    expect(r.before).toBe('no name here');
    expect(r.match).toBe('');
  });
});
