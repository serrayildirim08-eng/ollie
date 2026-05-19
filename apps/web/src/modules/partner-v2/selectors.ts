/**
 * partner-v2 · selectors — pure view-models over the partner stub state
 *
 * ── HONEST STUB NOTE ─────────────────────────────────────────────────────────
 * partner-v2 is a NEW feature. There is NO partner module and NO partner-
 * linking backend in Ollie today. So unlike money-v2 / habits-v2 — which
 * are UI rebuilds over a LIVE store the legacy module already reads — this
 * module owns its OWN small, in-module data layer: a `PartnerState` shape
 * seeded with realistic placeholder data and persisted to a `partner` store
 * namespace (see `usePartnerStore.ts`). When a real partner-linking backend
 * exists, `usePartnerStore` is the single seam that gets re-pointed; these
 * selectors and the 4 screens stay unchanged.
 *
 * Everything here is pure: `PartnerState` in, view-models out. No hooks, no
 * rendering. Every fn that needs the wall clock takes an explicit `now`, so
 * the screens stay deterministic and testable. Mirrors habits-v2/selectors.ts
 * in spirit.
 */

// ─── stub state shapes ───────────────────────────────────────────────────────

/** the four ask categories from partner-ask.html, in render order */
export type AskCategory = 'material' | 'touch' | 'labor' | 'emotional';

/** the soft-state types the user can opt into sharing — partner-sharing.html */
export type SharingKey = 'cycle' | 'sleep' | 'stress' | 'energy' | 'mood';

/** how an ask the user sent is doing — a quiet, calm state, never a metric */
export type AskState = 'sent' | 'seen' | 'done';

/** one soft state the partner chose to share with the user (my-partner.html) */
export interface SharedPattern {
  /** a stable key */
  key: string;
  /** the calm sentence head, ink — e.g. "low on sleep this week" */
  line: string;
  /** the soft em-dash tail, muted — e.g. "running about an hour short" */
  tail: string;
}

/** one ask the user has sent — the focus ask + the quiet history */
export interface PartnerAsk {
  id: string;
  /** the headline category word — "touch", "labor", … */
  kind: AskCategory;
  /** epoch-ms the ask was sent */
  sentAt: number;
  /** the calm state of the ask */
  state: AskState;
}

/** one sharing toggle's persisted on/off bit */
export type SharingToggles = Record<SharingKey, boolean>;

/**
 * The whole partner stub state — what `usePartnerStore` persists. When
 * `linkedPartner` is null the module is in its first-run state and routes
 * to the invite screen.
 */
export interface PartnerState {
  /** the linked partner, or null on first run (→ invite screen) */
  linkedPartner: {
    /** the partner's display name */
    name: string;
    /** a calm "linked since march" recency phrase */
    linkedSince: string;
  } | null;
  /** the soft states the partner is sharing back (read-only to the user) */
  sharedPatterns: SharedPattern[];
  /** the asks the user has sent, newest first */
  asks: PartnerAsk[];
  /** the user's own sharing opt-ins — every key defaults OFF */
  sharing: SharingToggles;
  /** the user's invite code (the part after `OLLIE·`) */
  inviteCode: string;
}

// ─── the seeded stub ─────────────────────────────────────────────────────────

/**
 * The realistic placeholder state the stub seeds on first load. Lifted from
 * the approved mockups so the preview shows the SAME shape the designer drew:
 * a partner "Sam" linked since march, three shared soft states, a recent
 * "touch" ask plus two older ones, and three sharing toggles already on.
 *
 * NOTE: this is placeholder data, NOT a backend read — there is no partner
 * backend. The data is honest about being a stub (see the module header).
 */
export const SEED_PARTNER_STATE: PartnerState = {
  linkedPartner: { name: 'Sam', linkedSince: 'linked since march' },
  sharedPatterns: [
    {
      key: 'sleep',
      line: 'low on sleep this week',
      tail: 'running about an hour short',
    },
    { key: 'cycle', line: 'in luteal', tail: 'be gentle' },
    { key: 'stress', line: 'a stretch of stress', tail: 'the last few days' },
  ],
  asks: [
    { id: 'ask_touch', kind: 'touch', sentAt: dayAgoSeed(2), state: 'seen' },
    { id: 'ask_labor', kind: 'labor', sentAt: dayAgoSeed(7), state: 'done' },
    {
      id: 'ask_emotional',
      kind: 'emotional',
      sentAt: dayAgoSeed(14),
      state: 'done',
    },
  ],
  sharing: {
    cycle: true,
    sleep: true,
    stress: true,
    energy: false,
    mood: false,
  },
  inviteCode: 'K4M9',
};

/** seed-time helper — a fixed-offset epoch for the seeded asks */
function dayAgoSeed(days: number): number {
  // seeded relative to a fixed wall-clock so the stub is stable on first run;
  // `usePartnerStore` persists it after, so it never drifts.
  return Date.now() - days * 86_400_000;
}

// ─── small helpers ───────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** a calm, factual recency phrase — "2 days ago", "last week", never exact */
export function whenLabel(ts: number, now: number): string {
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

/** the calm word for an ask's state — "seen", "sent", "done" */
export function askStateLabel(state: AskState): string {
  return state;
}

/** the first letter of the partner's name, for the linked-mark */
export function partnerInitial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

// ─── my-partner face view-model ──────────────────────────────────────────────

/** one shared-pattern line, as the my-partner face renders it */
export interface SharedPatternVM {
  key: string;
  /** the ink head sentence */
  line: string;
  /** the muted em-dash tail */
  tail: string;
}

/** the focus ask + the quiet history, as the my-partner face renders them */
export interface AskHistoryVM {
  /** the most recent ask — the focus row, or null when no asks sent */
  latest: { kind: string; when: string; state: string } | null;
  /** the older asks, one dim line each */
  past: { id: string; kind: string; when: string }[];
}

export interface MyPartnerVM {
  /** is a partner linked? false → the App routes to the invite screen */
  hasPartner: boolean;
  /** the partner's display name — "Sam" */
  name: string;
  /** the linked-mark initial — "S" */
  initial: string;
  /** the calm recency line — "linked since march" */
  linkedSince: string;
  /** the soft states the partner is sharing */
  patterns: SharedPatternVM[];
  /** the asks the user has sent — focus + history */
  asks: AskHistoryVM;
}

/**
 * The my-partner face view-model — the user's quiet view of their partner.
 * The hero is one calm name; below it the soft states the partner chose to
 * share (never a medical flag), then the user's own ask history. When no
 * partner is linked `hasPartner` is false and the App shows the invite flow.
 */
export function myPartnerVM(state: PartnerState, now: number): MyPartnerVM {
  const p = state.linkedPartner;
  const patterns: SharedPatternVM[] = (state.sharedPatterns ?? []).map((s) => ({
    key: s.key,
    line: s.line,
    tail: s.tail,
  }));

  const asks = [...(state.asks ?? [])].sort((a, b) => b.sentAt - a.sentAt);
  const [latest, ...rest] = asks;

  return {
    hasPartner: p != null,
    name: p?.name ?? '',
    initial: p ? partnerInitial(p.name) : '?',
    linkedSince: p?.linkedSince ?? '',
    patterns,
    asks: {
      latest: latest
        ? {
            kind: latest.kind,
            when: whenLabel(latest.sentAt, now),
            state: askStateLabel(latest.state),
          }
        : null,
      past: rest.map((a) => ({
        id: a.id,
        kind: a.kind,
        when: whenLabel(a.sentAt, now),
      })),
    },
  };
}

// ─── invite view-model ───────────────────────────────────────────────────────

export interface InviteVM {
  /** the bare code — "K4M9" */
  code: string;
  /** the full display code — "OLLIE·K4M9" */
  displayCode: string;
  /** the share link the copy/share actions hand off */
  shareLink: string;
}

/** the invite view-model — the one focus is the invite code */
export function inviteVM(state: PartnerState): InviteVM {
  const code = (state.inviteCode || 'XXXX').toUpperCase();
  return {
    code,
    displayCode: `OLLIE·${code}`,
    shareLink: `https://ollie.app/link/${code}`,
  };
}

// ─── ask flow view-model ─────────────────────────────────────────────────────

/** one selectable option chip inside an ask category */
export interface AskOption {
  /** a stable key */
  key: string;
  /** the chip label */
  label: string;
  /** the fragment this option contributes to ollie's note */
  fragment: string;
}

/** one ask category — a glyph, a word, and its option chips */
export interface AskCategoryDef {
  category: AskCategory;
  /** the uppercase category word */
  label: string;
  options: AskOption[];
}

/**
 * The 4 ask categories with their option chips — lifted verbatim from
 * partner-ask.html. `fragment` is the calm phrase each option folds into
 * ollie's generated note.
 */
export const ASK_CATEGORIES: AskCategoryDef[] = [
  {
    category: 'material',
    label: 'material',
    options: [
      { key: 'heat_pad', label: 'a heat pad', fragment: 'a heat pad' },
      { key: 'snacks', label: 'snacks', fragment: 'a snack' },
      { key: 'meds', label: 'pick up meds', fragment: 'my meds picked up' },
      { key: 'tea', label: 'tea', fragment: 'a cup of tea' },
    ],
  },
  {
    category: 'touch',
    label: 'touch',
    options: [
      { key: 'hug', label: 'a hug', fragment: 'a hug' },
      { key: 'sit_close', label: 'just sit close', fragment: 'to just sit close' },
      { key: 'space', label: 'space, no touch', fragment: 'a little space, no touch' },
      { key: 'back_rub', label: 'back rub', fragment: 'a back rub' },
    ],
  },
  {
    category: 'labor',
    label: 'labor',
    options: [
      { key: 'dinner', label: 'take dinner', fragment: 'dinner taken care of' },
      { key: 'dishes', label: 'handle the dishes', fragment: 'the dishes handled' },
      { key: 'errand', label: 'run an errand', fragment: 'an errand run' },
      { key: 'dog', label: 'walk the dog', fragment: 'the dog walked' },
    ],
  },
  {
    category: 'emotional',
    label: 'emotional',
    options: [
      { key: 'listen', label: 'just listen', fragment: 'you to just listen' },
      { key: 'no_advice', label: 'no advice today', fragment: 'no advice today' },
      { key: 'check_later', label: 'check in later', fragment: 'a check-in later' },
      { key: 'reassure', label: 'reassure me', fragment: 'a little reassurance' },
    ],
  },
];

/** the set of selected option keys, by category */
export type AskSelection = Record<AskCategory, string[]>;

/** an empty ask selection — nothing picked */
export function emptyAskSelection(): AskSelection {
  return { material: [], touch: [], labor: [], emotional: [] };
}

/** total options picked across all categories */
export function askSelectionCount(sel: AskSelection): number {
  return (
    sel.material.length +
    sel.touch.length +
    sel.labor.length +
    sel.emotional.length
  );
}

/**
 * Compose ollie's calm note from the user's picks. Mirrors the voice in
 * partner-ask.html: a soft opener, then the material/touch/labor/emotional
 * fragments folded into one gentle sentence. When nothing is picked, a quiet
 * placeholder line invites the user to choose. Pure + deterministic.
 */
export function composeAskNote(sel: AskSelection): string {
  const frag = (cat: AskCategory): string[] => {
    const def = ASK_CATEGORIES.find((c) => c.category === cat);
    if (!def) return [];
    return sel[cat]
      .map((k) => def.options.find((o) => o.key === k)?.fragment)
      .filter((f): f is string => Boolean(f));
  };

  const material = frag('material');
  const touch = frag('touch');
  const labor = frag('labor');
  const emotional = frag('emotional');

  if (askSelectionCount(sel) === 0) {
    return 'pick a few things above — ollie will turn them into a calm note here.';
  }

  const parts: string[] = ['a low-energy evening'];
  if (material.length) parts.push(`${joinFragments(material)} would help`);
  if (touch.length) parts.push(`i'd love ${joinFragments(touch)}`);
  if (labor.length) parts.push(`if you can take ${joinFragments(labor)}, that's a lot off me`);
  if (emotional.length) parts.push(`mostly i need ${joinFragments(emotional)}`);

  return `${parts.join(' — ')}.`;
}

/** join fragment phrases with calm "and" grammar */
function joinFragments(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** the ask-flow view-model */
export interface AskFlowVM {
  categories: AskCategoryDef[];
  /** the partner's name — for the "send to Sam" button */
  partnerName: string;
  /** the composed note, given the current selection */
  note: string;
  /** is anything picked? gates the send action */
  canSend: boolean;
}

/** the ask-flow view-model — derived from the categories + a live selection */
export function askFlowVM(state: PartnerState, sel: AskSelection): AskFlowVM {
  return {
    categories: ASK_CATEGORIES,
    partnerName: state.linkedPartner?.name ?? 'your partner',
    note: composeAskNote(sel),
    canSend: askSelectionCount(sel) > 0,
  };
}

// ─── sharing view-model ──────────────────────────────────────────────────────

/** one sharing toggle row — partner-sharing.html */
export interface SharingRowDef {
  key: SharingKey;
  /** the row's bold key — "cycle phase" */
  label: string;
  /** the muted sub-line — what the partner would see if on */
  detail: string;
  /** the soft-state line shown in the preview when this toggle is on */
  previewLine: string;
  /** the preview line's muted em-dash tail, or "" */
  previewTail: string;
}

/**
 * The 5 sharing rows — lifted verbatim from partner-sharing.html. Every row
 * defaults OFF; the seeded stub turns cycle / sleep / stress on so the
 * preview is non-empty.
 */
export const SHARING_ROWS: SharingRowDef[] = [
  {
    key: 'cycle',
    label: 'cycle phase',
    detail: 'Sam sees "in luteal — be gentle". never a date, never a flag.',
    previewLine: 'in luteal',
    previewTail: 'be gentle',
  },
  {
    key: 'sleep',
    label: 'sleep',
    detail: 'Sam sees "low on sleep this week". no hours, no log.',
    previewLine: 'low on sleep this week',
    previewTail: '',
  },
  {
    key: 'stress',
    label: 'stress',
    detail: 'Sam sees "a stretch of stress". the feeling, not the cause.',
    previewLine: 'a stretch of stress',
    previewTail: '',
  },
  {
    key: 'energy',
    label: 'energy',
    detail: 'Sam sees "running low" or "good energy".',
    previewLine: 'running low on energy',
    previewTail: '',
  },
  {
    key: 'mood',
    label: 'mood',
    detail: 'Sam sees "a tender few days".',
    previewLine: 'a tender few days',
    previewTail: '',
  },
];

/** one preview line in the "what Sam sees right now" card */
export interface SharingPreviewLine {
  key: SharingKey;
  line: string;
  tail: string;
}

export interface SharingVM {
  /** the toggle rows, each carrying its persisted on/off bit */
  rows: (SharingRowDef & { on: boolean })[];
  /** the partner's name — for the copy lines */
  partnerName: string;
  /** the preview lines — only the rows whose toggle is on */
  preview: SharingPreviewLine[];
  /** the calm note under the preview — names the off rows, or "" */
  previewNote: string;
}

/**
 * The sharing view-model — the granular opt-in control. Every toggle's
 * persisted bit is folded onto its row def, and the preview card derives
 * exactly the lines whose toggle is on, so the user sees what is exposed.
 * The clinical boundary (medical flags never shared) is a fixed line on the
 * screen, NOT a toggle — it has no state here.
 */
export function sharingVM(state: PartnerState): SharingVM {
  const toggles = state.sharing ?? SEED_PARTNER_STATE.sharing;
  const rows = SHARING_ROWS.map((r) => ({ ...r, on: Boolean(toggles[r.key]) }));

  const preview: SharingPreviewLine[] = rows
    .filter((r) => r.on)
    .map((r) => ({ key: r.key, line: r.previewLine, tail: r.previewTail }));

  const partnerName = state.linkedPartner?.name ?? 'your partner';
  const off = rows.filter((r) => !r.on).map((r) => r.label);
  let previewNote: string;
  if (off.length === rows.length) {
    previewNote = `everything is off — ${partnerName} sees nothing here yet. turn one on and its line appears.`;
  } else if (off.length > 0) {
    previewNote = `${joinFragments(off)} ${off.length === 1 ? 'is' : 'are'} off — ${partnerName} doesn't see ${off.length === 1 ? 'it' : 'them'}. turn one on and its line appears here.`;
  } else {
    previewNote = 'every soft state is on — change any of them any time.';
  }

  return {
    rows,
    partnerName,
    preview,
    previewNote,
  };
}
