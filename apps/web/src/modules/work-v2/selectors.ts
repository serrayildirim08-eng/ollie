/**
 * work-v2 · selectors — pure view-models over the REAL matter backend
 *
 * ── REAL BACKEND, NOT A STUB ─────────────────────────────────────────────────
 * work-v2 ships the "matters" concept (design/clean-slate-2026-05-18-v2/
 * WORK-VISION.md). The matter container + the deterministic dump→matter
 * routing are REAL — they live in `@ollie/logic/work` (`Matter`, `createMatter`,
 * routing heuristics) and the `matter-routing` orchestrator, committed as
 * 9ed51e5. The orchestrator writes its output into the live `work` store
 * namespace:
 *   - `work.matters`            Matter[]              — the containers
 *   - `work.matter_loose_dumps` LooseDumpRef[]        — unrouted dumps
 *   - `work.matter_suggestions` NewMatterSuggestion[] — "new matter?" nudges
 * work-v2's screens read those keys via `useWorkStore`. There is no private
 * `work_v2` stub namespace and no invented data model — the old build did
 * that; this is the realignment to the real backend.
 *
 * ── PHASE BOUNDARY (WORK-VISION.md, build roadmap) ───────────────────────────
 * Phase 1 (matter container) + Phase 2 (routing) are BUILT — that is the
 * 9ed51e5 backend. Phase 3 (AI extraction + the 6-field secretary briefing)
 * and Phase 4 (recurring-shape learning) are NOT built. So:
 *   - The matter detail screen is the Phase-1/2-honest view: the matter's
 *     identity + its routed raw notes, with a quiet note that the synthesised
 *     briefing arrives in a later phase. It is NOT a fake/stubbed briefing.
 *   - There is NO "missing" / deficit field anywhere (WORK-VISION 2026-05-19:
 *     "NEVER framed as 'missing' / a deficit").
 *   - The briefing's six fields (what it is · left off at · last move · done ·
 *     pending · next) are a Phase-3 DERIVED VIEW; not modelled, not faked here.
 *
 * Everything in this file is pure: store-shaped inputs in, view-models out.
 * No hooks, no rendering. Every fn that needs the wall clock takes `now`.
 */
import type {
  Matter,
  MatterDumpRef,
  NewMatterSuggestion,
} from '@ollie/logic/work';
import type { LooseDumpRef } from '@ollie/orchestrator';

// ─── source-slice row shapes (read-only mirrors) ─────────────────────────────
//
// A `MatterDumpRef` is a POINTER — it carries no text. The raw note text lives
// in the slice the dump was captured into. These mirror the rows the routing
// orchestrator's `collectRoutableDumps` reads, so work-v2 can resolve a ref
// back to its text the same way.

/** a work.tasks[] row — a brain-dump-routed work task */
export interface WorkTaskRow {
  id?: string;
  title?: string;
  created_at?: number;
}

/** a work.meetings[] row — a brain-dump-routed work meeting */
export interface WorkMeetingRow {
  id?: string | null;
  title?: string;
  start_at?: number;
}

/** a dump.items[] row — a generic brain dump */
export interface DumpItemRow {
  id?: string;
  text?: string;
  ts?: number;
}

/**
 * The full work-v2 read state — exactly the four live store reads `useWorkStore`
 * performs, bundled so the pure selectors can be unit-tested without a store.
 */
export interface WorkState {
  /** work.matters — the real Phase-1 containers */
  matters: Matter[];
  /** work.matter_loose_dumps — unrouted dumps (Phase 2, outcome #3) */
  looseDumps: LooseDumpRef[];
  /** work.matter_suggestions — recurring-unknown-name "new matter?" nudges */
  suggestions: NewMatterSuggestion[];
  /** work.tasks — for resolving a dump ref's text */
  workTasks: WorkTaskRow[];
  /** work.meetings — for resolving a dump ref's text */
  workMeetings: WorkMeetingRow[];
  /** dump.items — for resolving a dump ref's text */
  dumpItems: DumpItemRow[];
}

/** an empty read state — the default before the orchestrator has run */
export const EMPTY_WORK_STATE: WorkState = {
  matters: [],
  looseDumps: [],
  suggestions: [],
  workTasks: [],
  workMeetings: [],
  dumpItems: [],
};

// ─── dump-text resolution ────────────────────────────────────────────────────

/** one resolved dump: a ref joined to its raw text + capture time */
export interface ResolvedDump {
  /** the source dump row id */
  id: string;
  /** the raw user note text */
  text: string;
  /** epoch-ms the dump was captured (0 when the source row lacked one) */
  ts: number;
  /**
   * how this dump was attached — 'clear' filed silently, 'guess' filed as a
   * marked guess, 'manual' a user-confirmed correction. Drives the quiet
   * "ollie's guess" marking on the matter detail screen.
   */
  origin: MatterDumpRef['origin'];
}

const DAY_MS = 86_400_000;

/**
 * Build a `dump_id → { text, ts }` index across the three source slices the
 * routing orchestrator pulls from. Pure. Rows missing an id/text are skipped.
 */
function indexSourceText(
  state: WorkState,
): Map<string, { text: string; ts: number }> {
  const idx = new Map<string, { text: string; ts: number }>();
  for (const t of state.workTasks) {
    if (typeof t?.id === 'string' && typeof t.title === 'string') {
      idx.set(t.id, {
        text: t.title,
        ts: typeof t.created_at === 'number' ? t.created_at : 0,
      });
    }
  }
  for (const m of state.workMeetings) {
    if (typeof m?.id === 'string' && typeof m.title === 'string') {
      idx.set(m.id, {
        text: m.title,
        ts: typeof m.start_at === 'number' ? m.start_at : 0,
      });
    }
  }
  for (const d of state.dumpItems) {
    if (typeof d?.id === 'string' && typeof d.text === 'string') {
      idx.set(d.id, {
        text: d.text,
        ts: typeof d.ts === 'number' ? d.ts : 0,
      });
    }
  }
  return idx;
}

/**
 * Resolve a matter's `dumps` (pointer refs) to `ResolvedDump`s with real text,
 * newest first. A ref whose source row can't be found is dropped — defensive,
 * the source row may have been deleted after routing.
 */
export function resolveMatterDumps(
  matter: Matter,
  state: WorkState,
): ResolvedDump[] {
  const idx = indexSourceText(state);
  const out: ResolvedDump[] = [];
  for (const ref of matter.dumps) {
    const src = idx.get(ref.dump_id);
    if (!src) continue;
    out.push({
      id: ref.dump_id,
      text: src.text,
      ts: src.ts > 0 ? src.ts : ref.routed_at,
      origin: ref.origin,
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

// ─── small helpers ───────────────────────────────────────────────────────────

/** a calm, factual recency phrase — "2 days ago", "last week", never exact */
export function whenLabel(ts: number, now: number): string {
  if (ts <= 0) return '';
  const days = Math.max(0, Math.round((dayFloor(now) - dayFloor(ts)) / DAY_MS));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  const w = Math.floor(days / 7);
  return `${w} weeks ago`;
}

/** the midnight-floored day key for an epoch-ms `ts` */
function dayFloor(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Order matters for display: active matters in created order (newest first so
 * a freshly-confirmed matter surfaces), archived matters always last so the
 * file stays findable without crowding the live work.
 */
export function orderedMatters(matters: Matter[]): Matter[] {
  return [...matters]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const ar = a.m.status === 'archived' ? 1 : 0;
      const br = b.m.status === 'archived' ? 1 : 0;
      if (ar !== br) return ar - br;
      return b.m.created_at - a.m.created_at;
    })
    .map((x) => x.m);
}

// ─── work face view-model ────────────────────────────────────────────────────

/** one matter as the work face's at-rest preview renders it */
export interface FaceMatterRow {
  id: string;
  /** the matter's primary name */
  name: string;
  /** the matter's type, or "" — never invents one */
  type: string;
  /** "4 notes filed" — the calm count line, never a deficit */
  noteLine: string;
}

export interface WorkFaceVM {
  /** how many matters exist — drives the glance line */
  matterCount: number;
  /** the glance lead — "3 matters" / "1 matter" / "no matters yet" */
  glanceLead: string;
  /** a calm second clause for the glance line */
  glanceTail: string;
  /** the top three matters previewed at rest */
  topMatters: FaceMatterRow[];
  /** whether ollie has a "new matter?" suggestion pending */
  hasSuggestion: boolean;
  /** the most-recurring suggested name, or "" */
  suggestionName: string;
}

/** "N notes" / "N note" — a plain count, never a chore framing */
function noteCount(n: number): string {
  return `${n} note${n === 1 ? '' : 's'}`;
}

/**
 * The work face view-model — the matters card. The glance LEADS WITH MATTERS:
 * how many the user has + a calm tail. The at-rest preview is the top three by
 * recency. No deficit, no "needs you" count — Phase 1/2 is passive. Pure.
 */
export function workFaceVM(state: WorkState): WorkFaceVM {
  const matters = orderedMatters(state.matters);
  const top = state.suggestions[0];

  const glanceLead =
    matters.length === 0
      ? 'no matters yet'
      : `${matters.length} matter${matters.length === 1 ? '' : 's'}`;

  const glanceTail =
    matters.length === 0
      ? 'ollie opens one when a name keeps coming up'
      : 'ollie files what you throw into them';

  return {
    matterCount: matters.length,
    glanceLead,
    glanceTail,
    topMatters: matters.slice(0, 3).map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      noteLine: `${noteCount(m.dumps.length)} filed`,
    })),
    hasSuggestion: state.suggestions.length > 0,
    suggestionName: top?.candidate ?? '',
  };
}

// ─── matter-list view-model ──────────────────────────────────────────────────

/** one matter row, as the matter list renders it */
export interface MatterListRow {
  id: string;
  name: string;
  /** the matter's type, or "" */
  type: string;
  /** "4 notes filed" — the calm count line */
  noteLine: string;
  /** true when the matter has been archived */
  archived: boolean;
}

export interface MatterListVM {
  /** the calm count line — "5 matters" */
  countLine: string;
  /** the calm sub-line */
  subLine: string;
  /** every matter, active first, archived last */
  rows: MatterListRow[];
  /**
   * how many loose / unsorted dumps Ollie hasn't routed yet — drives the
   * low-emphasis foot row of the list (WORK-VISION Phase 2, outcome #3).
   * Zero → the foot row is not drawn.
   */
  looseCount: number;
  /** whether the matter list is empty (no matters at all) */
  empty: boolean;
}

/**
 * The matter-list view-model. A calm list of every matter — name, type, and a
 * plain note count. No urgency wash, no next-step line: Phase 1/2 is passive,
 * and urgency framing belongs to the Phase-3 briefing. Pure.
 */
export function matterListVM(state: WorkState): MatterListVM {
  const matters = orderedMatters(state.matters);

  return {
    countLine: `${matters.length} matter${matters.length === 1 ? '' : 's'}`,
    subLine: 'all your matters — ollie files your notes into them',
    rows: matters.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      noteLine: `${noteCount(m.dumps.length)} filed`,
      archived: m.status === 'archived',
    })),
    looseCount: state.looseDumps.length,
    empty: matters.length === 0,
  };
}

// ─── matter detail view-model (Phase 1/2-honest) ─────────────────────────────

/** one routed note, as the matter detail renders it */
export interface MatterNoteVM {
  id: string;
  /** the raw user text */
  text: string;
  /** a calm recency phrase, or "" */
  when: string;
  /**
   * true when routing filed this as a fuzzy GUESS rather than a clear match —
   * the screen draws a quiet "ollie's guess" mark on it (WORK-VISION Phase 2:
   * a guess is filed but visibly marked, one-tap to correct).
   */
  isGuess: boolean;
}

export interface MatterDetailVM {
  /** the matter exists? false → the screen shows a calm fallback */
  found: boolean;
  /** the matter's primary name — the page hero */
  name: string;
  /** the matter's type, or "" */
  type: string;
  /** "opened 3 weeks ago" — a calm recency sub-line */
  opened: string;
  /** the matter's routed notes, newest first */
  notes: MatterNoteVM[];
  /** how many notes are filed here */
  noteCount: number;
  /** how many of them were filed as a fuzzy guess */
  guessCount: number;
}

/**
 * The matter detail view-model — the Phase-1/2-honest matter view.
 *
 * WORK-VISION calls the matter view "the secretary briefing" — but the briefing
 * is a Phase-3 AI-synthesised DERIVED VIEW (what it is · left off at · last
 * move · done · pending · next), and Phase 3 is NOT built. So this view shows
 * what Phase 1/2 actually produces: the matter's identity + every raw note
 * routing has filed into it. The screen pairs this with an honest line that
 * the synthesised briefing arrives later. There is deliberately NO "missing" /
 * deficit field — none is ever shown. Returns `found:false` for an unknown id.
 */
export function matterDetailVM(
  state: WorkState,
  matterId: string,
  now: number,
): MatterDetailVM {
  const m = state.matters.find((x) => x.id === matterId);
  if (!m) {
    return {
      found: false,
      name: '',
      type: '',
      opened: '',
      notes: [],
      noteCount: 0,
      guessCount: 0,
    };
  }

  const resolved = resolveMatterDumps(m, state);
  const openedWhen = whenLabel(m.created_at, now);

  return {
    found: true,
    name: m.name,
    type: m.type,
    opened: openedWhen ? `opened ${openedWhen}` : 'opened',
    notes: resolved.map((d) => ({
      id: d.id,
      text: d.text,
      when: whenLabel(d.ts, now),
      isGuess: d.origin === 'guess',
    })),
    noteCount: resolved.length,
    guessCount: resolved.filter((d) => d.origin === 'guess').length,
  };
}

// ─── matter-confirm view-model ───────────────────────────────────────────────

/** one evidence excerpt on the confirm sheet */
export interface ConfirmExcerpt {
  id: string;
  /** a calm recency phrase, or "" */
  when: string;
  /** the raw note text that mentioned the recurring name */
  text: string;
}

export interface MatterConfirmVM {
  /** is there a "new matter?" suggestion to confirm? */
  hasSuggestion: boolean;
  /** the recurring name Ollie noticed */
  name: string;
  /** the plain-language "why ollie is asking" line */
  why: string;
  /** how many dumps the name showed up in */
  occurrences: number;
  /** a few evidence excerpts — the dumps the name recurred in */
  excerpts: ConfirmExcerpt[];
}

/**
 * The matter-confirm view-model — the auto-detect / confirm sheet. Ollie
 * noticed a recurring name (a real `NewMatterSuggestion` from the routing
 * orchestrator) and asks if it's a matter — AUTO-DETECT, USER-CONFIRM. The
 * user never builds a matter from a blank form (WORK-VISION.md). The first
 * (most-recurring) suggestion is the one surfaced. Pure.
 */
export function matterConfirmVM(state: WorkState, now: number): MatterConfirmVM {
  const s = state.suggestions[0];
  if (!s) {
    return {
      hasSuggestion: false,
      name: '',
      why: '',
      occurrences: 0,
      excerpts: [],
    };
  }

  const idx = indexSourceText(state);
  const excerpts: ConfirmExcerpt[] = [];
  for (const id of s.dump_ids.slice(0, 3)) {
    const src = idx.get(id);
    if (!src) continue;
    excerpts.push({
      id,
      when: whenLabel(src.ts, now),
      text: src.text,
    });
  }

  return {
    hasSuggestion: true,
    name: s.candidate,
    why: `the name showed up in ${s.occurrences} note${
      s.occurrences === 1 ? '' : 's'
    } you threw — ollie didn't have a matter to file them in.`,
    occurrences: s.occurrences,
    excerpts,
  };
}

/**
 * Split a dump excerpt around the candidate name so the screen can draw the
 * matched name in ink and the rest muted. Pure; case-insensitive, first hit.
 */
export function highlightName(
  text: string,
  name: string,
): { before: string; match: string; after: string } {
  if (!name) return { before: text, match: '', after: '' };
  const idx = text.toLowerCase().indexOf(name.toLowerCase());
  if (idx < 0) return { before: text, match: '', after: '' };
  return {
    before: text.slice(0, idx),
    match: text.slice(idx, idx + name.length),
    after: text.slice(idx + name.length),
  };
}
