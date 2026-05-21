/**
 * grocery-v2 · selectors — pure view-models over the live grocery store
 *
 * Every screen of the v2 grocery preview derives its content here, from the
 * SAME `@ollie/logic/grocery` pure functions + `grocery.*` store slices the
 * live `GroceryModule` reads + writes. No rendering, no hooks — just
 * `GrocerySlices` in, view-models out. This is the seam that keeps the
 * redesign a UI rebuild, not a fork: the data + logic layer is untouched,
 * only the rendering changes.
 *
 * Mirrors admin-v2/selectors.ts in spirit: small, tested, deterministic
 * (every fn that needs the wall clock takes an explicit `now`).
 */
import {
  ALIAS_TABLE,
  parseGroceryItem,
  inferRecipe,
  detectPatterns,
  detectInterestCapture,
} from '@ollie/logic/grocery';
import type {
  ParsedGroceryItem,
  PantryItem,
  ShoppingItem,
  RecipeInferredSignal,
} from '@ollie/logic/grocery';

const DAY_MS = 86_400_000;
/** the pantry default shelf life when an item has no alias-table entry */
const DEFAULT_SHELF_DAYS = 14;

// ─── store shapes ────────────────────────────────────────────────────────────

/**
 * One shopping-list row as the live `GroceryModule` stores it on
 * `grocery.items`. It is the `ShoppingItem` shape from `@ollie/logic/grocery`
 * plus the app-level `id`/`addedTs`/`qty` fields the live module appends.
 * Read defensively — old store rows may carry only a `text` or `name`.
 */
export interface GroceryShoppingItem extends ShoppingItem {
  id?: string;
  addedTs?: number;
  qty?: number;
  /** the parsed unit ("bottle", "l", "count", …) — the live module appends it */
  unit?: string;
}

/** One pantry row as the live module stores it on `grocery.pantry`. */
export interface GroceryStoredPantryItem extends PantryItem {
  id?: string;
  qty?: number;
}

/** everything the v2 grocery screens read from the store */
export interface GrocerySlices {
  /** the shopping list — `grocery.items` (the live module's source of truth) */
  items: GroceryShoppingItem[];
  /** the pantry — `grocery.pantry` (filled when a list item is checked off) */
  pantry: GroceryStoredPantryItem[];
  /** the learned alias overrides — `grocery.aliasOverrides` (the teach table) */
  aliasOverrides: Record<string, string>;
}

// ─── small helpers ───────────────────────────────────────────────────────────

/** the canonical key of a pantry / list item, lowercased + trimmed */
export function itemKey(
  it: { normalizedName?: string; name?: string; text?: string } | null | undefined,
): string {
  if (!it) return '';
  return String(it.normalizedName ?? it.name ?? it.text ?? '')
    .toLowerCase()
    .trim();
}

/** the display name of an item — the natural name, else the canonical key */
export function itemName(
  it: { name?: string; normalizedName?: string; text?: string } | null | undefined,
): string {
  if (!it) return 'item';
  const n = String(it.name ?? it.normalizedName ?? it.text ?? '').trim();
  return n || 'item';
}

/** the shelf life of a pantry item in days — explicit, else alias-table */
export function shelfLifeDays(p: GroceryStoredPantryItem): number {
  if (typeof p.shelfLifeDays === 'number' && Number.isFinite(p.shelfLifeDays)) {
    return p.shelfLifeDays;
  }
  const alias = ALIAS_TABLE[itemKey(p)];
  return alias?.shelfLifeDays ?? DEFAULT_SHELF_DAYS;
}

// ─── shop face (grocery.html / grocery-cold.html) ────────────────────────────

/** one rendered shopping-list row */
export interface ShopRow {
  id: string;
  name: string;
  /** the canonical key for replenishment lookup (lowercased itemKey) */
  canonical: string;
  /** the soft quantity line ("1 bottle", "2L", "in pantry", or '') */
  qty: string;
  /** a struck, got-it line — checked off into the pantry */
  got: boolean;
}

export interface ShopVM {
  /** every shopping-list row, open ones first, got ones last */
  rows: ShopRow[];
  /** the count of still-open (un-checked) rows */
  openCount: number;
  /** the calm one-liner lead under the mode switch */
  lead: string;
  /** the "recently bought" drill-row value — last few pantry adds */
  recentValue: string;
  /** true when the recently-bought row should dim (nothing bought yet) */
  recentDim: boolean;
  /** the live pattern line for the sage observation row, or null */
  patternLine: string | null;
  /** true when grocery has zero data — the cold face */
  cold: boolean;
}

/** the soft quantity line for a list row */
function shopQtyLine(it: GroceryShoppingItem): string {
  if (it.checked) return 'in pantry';
  const qty = typeof it.qty === 'number' && it.qty > 0 ? it.qty : null;
  const unit = typeof it.unit === 'string' ? it.unit.trim() : '';
  if (qty == null) return '';
  if (!unit || unit === 'count') {
    return qty === 1 ? '' : `${qty}`;
  }
  // a tidy unit line — "2L", "1 bottle", "3 bags"
  if (unit === 'l' || unit === 'liters' || unit === 'litres') {
    return `${qty}L`;
  }
  const plural = qty === 1 ? unit : `${unit}${unit.endsWith('s') ? '' : 's'}`;
  return `${qty} ${plural}`;
}

export function shopVM(slices: GrocerySlices, now: number): ShopVM {
  const items = slices.items;
  const pantry = slices.pantry;

  const open = items.filter((i) => !i.checked);
  const got = items.filter((i) => i.checked);
  const rows: ShopRow[] = [...open, ...got].map((it, i) => ({
    id: it.id ?? `g-row-${i}`,
    name: itemName(it),
    canonical: itemKey(it),
    qty: shopQtyLine(it),
    got: Boolean(it.checked),
  }));

  // recently bought — the last few things to land in the pantry
  const recentSorted = pantry
    .filter((p) => typeof p.boughtTs === 'number')
    .sort((a, b) => (b.boughtTs ?? 0) - (a.boughtTs ?? 0));
  const recentNames = recentSorted.slice(0, 3).map(itemName);
  const recentValue =
    recentSorted.length === 0
      ? 'nothing checked off yet'
      : `${recentNames.join(', ')} — last ${recentSorted.length}`;

  // the live pattern observation line
  const patterns = patternsVM(slices, now);
  const patternLine = patterns.live
    ? 'a few things ollie noticed about your shopping'
    : null;

  const cold = items.length === 0 && pantry.length === 0;

  return {
    rows,
    openCount: open.length,
    lead:
      open.length === 0
        ? "the list's empty"
        : `${open.length} on the list · tap one when it's in the basket`,
    recentValue,
    recentDim: recentSorted.length === 0,
    patternLine,
    cold,
  };
}

// ─── pantry (grocery-pantry.html) ────────────────────────────────────────────

export type ShelfTier = 'critical' | 'watching' | 'stocked';

/** one rendered pantry item */
export interface PantryRow {
  id: string;
  name: string;
  /** the canonical key for replenishment lookup (lowercased itemKey) */
  canonical: string;
  /** which shelf it lives on */
  tier: ShelfTier;
  /** % of shelf life remaining, 0..1 — the fill-bar width */
  fill: number;
  /** the calm right-side label — "today" / "4 days" / "months" */
  daysLabel: string;
  /** the small caption under it — "use it" / "left" */
  daysSub: string;
}

export interface PantryShelf {
  tier: ShelfTier;
  /** the small caps shelf name */
  name: string;
  /** the plain-words window ("2 days or less") */
  window: string;
  rows: PantryRow[];
}

export interface PantryVM {
  /** the 3 shelves, critical → watching → stocked */
  shelves: PantryShelf[];
  /** total pantry count */
  total: number;
  /** the calm one-liner lead */
  lead: string;
  /** true when the pantry has nothing in it */
  empty: boolean;
}

/** turn a remaining-days count into a calm human label */
function daysLabel(days: number): { label: string; sub: string } {
  if (days <= 0) return { label: 'today', sub: 'use it' };
  if (days === 1) return { label: '1 day', sub: 'left' };
  if (days <= 13) return { label: `${days} days`, sub: 'left' };
  const weeks = Math.round(days / 7);
  if (weeks <= 8) return { label: `${weeks} weeks`, sub: 'left' };
  return { label: 'months', sub: 'left' };
}

export function pantryVM(slices: GrocerySlices, now: number): PantryVM {
  const pantry = slices.pantry;

  const critical: PantryRow[] = [];
  const watching: PantryRow[] = [];
  const stocked: PantryRow[] = [];

  pantry.forEach((p, i) => {
    const shelf = shelfLifeDays(p);
    const bought = typeof p.boughtTs === 'number' ? p.boughtTs : now;
    const expiresAt = bought + shelf * DAY_MS;
    const daysLeft = Math.round((expiresAt - now) / DAY_MS);
    const fill = Math.max(0, Math.min(1, (expiresAt - now) / (shelf * DAY_MS)));
    const { label, sub } = daysLabel(daysLeft);
    const tier: ShelfTier =
      daysLeft <= 2 ? 'critical' : daysLeft <= 7 ? 'watching' : 'stocked';
    const row: PantryRow = {
      id: p.id ?? `g-pan-${i}`,
      name: itemName(p),
      canonical: itemKey(p),
      tier,
      fill,
      daysLabel: label,
      daysSub: sub,
    };
    if (tier === 'critical') critical.push(row);
    else if (tier === 'watching') watching.push(row);
    else stocked.push(row);
  });

  // each shelf sorted soonest-first
  const byFill = (a: PantryRow, b: PantryRow) => a.fill - b.fill;
  critical.sort(byFill);
  watching.sort(byFill);
  stocked.sort(byFill);

  const shelves: PantryShelf[] = [
    {
      tier: 'critical',
      name: 'critical',
      window: '— 2 days or less',
      rows: critical,
    },
    {
      tier: 'watching',
      name: 'watching',
      window: '— within a week',
      rows: watching,
    },
    {
      tier: 'stocked',
      name: 'stocked',
      window: '— plenty of time',
      rows: stocked,
    },
  ];

  return {
    shelves,
    total: pantry.length,
    lead:
      pantry.length === 0
        ? 'nothing in the kitchen yet'
        : `${pantry.length} thing${pantry.length === 1 ? '' : 's'} in the kitchen · sorted by what turns first`,
    empty: pantry.length === 0,
  };
}

// ─── feed me (grocery-recipes.html) ──────────────────────────────────────────

/** one ingredient line in the recipe split */
export interface RecipeIngredient {
  name: string;
  /** true when the ingredient is on hand in the pantry */
  have: boolean;
  /** a soft tag — 'turns today' / 'soon' — when it's a drifting pantry item */
  tag: string;
}

export interface FeedMeVM {
  /** true when a recipe could be inferred / found */
  found: boolean;
  /** the dish name, or null */
  dish: string | null;
  /** the cuisine + time caption */
  cuisine: string;
  /** ingredients on hand */
  have: RecipeIngredient[];
  /** ingredients still needed */
  missing: RecipeIngredient[];
  /** the coverage line — "you have 4 of 6" */
  coverage: string;
  /** total ingredient count (for the pip row) */
  total: number;
  /** count of ingredients on hand (for the pip row) */
  haveCount: number;
  /** the turns-soon reframe, or null when no drifting ingredient is used */
  soonLine: string | null;
  /** the missing names (what the amber action would add to the list) */
  missingNames: string[];
  /** true when the pantry is empty and there's nothing to infer from */
  cold: boolean;
}

/** which pantry items turn within 3 days — drives the soon-tag */
function driftSet(slices: GrocerySlices, now: number): Set<string> {
  const out = new Set<string>();
  slices.pantry.forEach((p) => {
    if (typeof p.boughtTs !== 'number') return;
    const shelf = shelfLifeDays(p);
    const daysLeft = (p.boughtTs + shelf * DAY_MS - now) / DAY_MS;
    if (daysLeft <= 3) out.add(itemKey(p));
  });
  return out;
}

/** which pantry items turn today (≤0 days) — the strongest soon-tag */
function turnsTodaySet(slices: GrocerySlices, now: number): Set<string> {
  const out = new Set<string>();
  slices.pantry.forEach((p) => {
    if (typeof p.boughtTs !== 'number') return;
    const shelf = shelfLifeDays(p);
    const daysLeft = (p.boughtTs + shelf * DAY_MS - now) / DAY_MS;
    if (daysLeft <= 0) out.add(itemKey(p));
  });
  return out;
}

/** build a FeedMeVM from an inferRecipe signal (search or pantry-inferred) */
function feedMeFromSignal(
  signal: RecipeInferredSignal | null,
  slices: GrocerySlices,
  now: number,
): FeedMeVM {
  const cold = slices.pantry.length === 0;
  if (!signal || !signal.found || !signal.dish) {
    return {
      found: false,
      dish: null,
      cuisine: '',
      have: [],
      missing: [],
      coverage: '',
      total: 0,
      haveCount: 0,
      soonLine: null,
      missingNames: [],
      cold,
    };
  }

  const drift = driftSet(slices, now);
  const turnsToday = turnsTodaySet(slices, now);
  const haveNames = signal.have ?? [];
  const missNames = signal.missing ?? [];

  const tagFor = (name: string): string => {
    const k = name.toLowerCase().trim();
    if (turnsToday.has(k)) return 'turns today';
    if (drift.has(k)) return 'soon';
    return '';
  };

  const have: RecipeIngredient[] = haveNames.map((n) => ({
    name: n,
    have: true,
    tag: tagFor(n),
  }));
  const missing: RecipeIngredient[] = missNames.map((n) => ({
    name: n,
    have: false,
    tag: '',
  }));

  const total = haveNames.length + missNames.length;
  const driftingHave = have.filter((h) => h.tag).length;
  const soonLine =
    driftingHave > 0
      ? `picked because it uses ${driftingHave} thing${driftingHave === 1 ? '' : 's'} that turn soon`
      : null;

  return {
    found: true,
    dish: signal.dish,
    cuisine: signal.cuisine
      ? `${signal.cuisine} · about 15 minutes`
      : 'about 15 minutes',
    have,
    missing,
    coverage: `you have ${haveNames.length} of ${total}`,
    total,
    haveCount: haveNames.length,
    soonLine,
    missingNames: missNames.slice(),
    cold,
  };
}

/** the pantry-inferred recipe (the default `feed me` view) */
export function feedMeVM(slices: GrocerySlices, now: number): FeedMeVM {
  const signal = inferRecipe({ pantry: slices.pantry, now }, {});
  return feedMeFromSignal(signal, slices, now);
}

/** a named-dish lookup — drives the recipe search line */
export function feedMeSearchVM(
  slices: GrocerySlices,
  now: number,
  dish: string,
): FeedMeVM {
  const q = dish.trim();
  if (!q) return feedMeVM(slices, now);
  const signal = inferRecipe(
    { pantry: slices.pantry, now },
    { dishHint: q },
  );
  return feedMeFromSignal(signal, slices, now);
}

// ─── add (grocery-add.html) ──────────────────────────────────────────────────

export interface AddParseVM {
  /** true when the line parsed into something actionable */
  ok: boolean;
  /** the detected intent in plain words */
  intentLabel: string;
  /** the item name */
  item: string;
  /** the quantity line ("2 bags", or '') */
  qty: string;
  /** the raw parser result (the action layer commits from this) */
  parsed: ParsedGroceryItem | null;
  /** true when the word is unknown — the teach-me block shows */
  unknown: boolean;
}

/** the plain-words label of a parsed intent */
function intentLabel(parsed: ParsedGroceryItem): string {
  switch (parsed.intent) {
    case 'BOUGHT':
      return 'straight to the pantry';
    case 'REMOVE':
      return 'take off the list';
    case 'ADD':
    default:
      return 'add to the list';
  }
}

/** the quantity line for the parse block */
function parseQtyLine(parsed: ParsedGroceryItem): string {
  if (typeof parsed.qty !== 'number' || parsed.qty <= 0) return '';
  const unit = typeof parsed.unit === 'string' ? parsed.unit.trim() : '';
  if (!unit || unit === 'count') {
    return parsed.qty === 1 ? '1' : `${parsed.qty}`;
  }
  const plural =
    parsed.qty === 1 ? unit : `${unit}${unit.endsWith('s') ? '' : 's'}`;
  return `${parsed.qty} ${plural}`;
}

/** parse a line, swallowing any parser throw into a null result */
function safeParse(text: string): ParsedGroceryItem | null {
  try {
    return parseGroceryItem(text);
  } catch {
    return null;
  }
}

/**
 * Parse a natural-language line into the add-screen view-model.
 * `overrides` is the learned alias table (`grocery.aliasOverrides`) — if
 * the raw line is a known override the item resolves to the canonical.
 */
export function addParseVM(
  raw: string,
  overrides: Record<string, string>,
): AddParseVM {
  const text = raw.trim();
  if (!text) {
    return {
      ok: false,
      intentLabel: '',
      item: '',
      qty: '',
      parsed: null,
      unknown: false,
    };
  }

  const parsed = safeParse(text);
  const overrideCanon = overrides[text.toLowerCase()];

  if (!parsed || parsed.intent === 'UNKNOWN') {
    // the word wasn't recognised — the teach-me block will offer staples
    return {
      ok: false,
      intentLabel: 'add to the list',
      item: text,
      qty: '',
      parsed,
      unknown: true,
    };
  }

  const item = overrideCanon ?? parsed.name;
  const unknown = !parsed.normalizedName && !overrideCanon;

  return {
    ok: true,
    intentLabel: intentLabel(parsed),
    item,
    qty: parseQtyLine(parsed),
    parsed,
    unknown,
  };
}

// ─── patterns (grocery-patterns.html) ────────────────────────────────────────

/** one rendered pattern observation */
export interface PatternRow {
  /** the bold one-line observation */
  line: string;
  /** the soft reframe sub-line */
  frame: string;
  /** the italic citation tag */
  cite: string;
}

export interface PatternGroup {
  /** the small caps group label */
  label: string;
  rows: PatternRow[];
}

export interface PatternsVM {
  /** the grouped observations */
  groups: PatternGroup[];
  /** true when at least one observation is from the user's real data */
  live: boolean;
  /**
   * true when NO real pattern fired and the screen is showing the honest
   * canonical examples instead (reported as a stub fallback).
   */
  exampleFallback: boolean;
}

/** the honest canonical examples — shown when nothing real is live */
const EXAMPLE_GROUPS: PatternGroup[] = [
  {
    label: 'your shopping rhythm',
    rows: [
      {
        line: 'about 6 days between grocery trips, on average',
        frame:
          'a steadier cadence than it feels like — the list can be timed to it instead of done in a panic.',
        cite: 'Altgassen 2014 · prospective memory',
      },
      {
        line: 'milk runs out roughly every 5 days, ahead of most trips',
        frame:
          "a consumable on a clock — this is the kind of thing that's easier as a standing item than a thing to remember.",
        cite: 'Barkley & Murphy 2010 · time blindness',
      },
    ],
  },
  {
    label: 'what you keep getting drawn to',
    rows: [
      {
        line: '3 keyboards in 3 weeks — a pattern, not a medical thing',
        frame:
          "a burst of interest in one corner of the world. worth knowing it's novelty pulling, before a fourth tab opens — it tends to pass on its own.",
        cite: 'Wood & Neal 2007 · habit & novelty',
      },
    ],
  },
];

/** run the batch pattern detectors, swallowing any throw into [] */
function safeDetectPatterns(
  slices: GrocerySlices,
  now: number,
): ReturnType<typeof detectPatterns> {
  try {
    return detectPatterns(
      { pantry: slices.pantry, items: slices.items, now },
      {},
    );
  } catch {
    return [];
  }
}

/** run the interest-capture detector, swallowing any throw into [] */
function safeDetectInterest(
  slices: GrocerySlices,
  now: number,
): ReturnType<typeof detectInterestCapture> {
  try {
    return detectInterestCapture({
      pantry: slices.pantry,
      items: slices.items,
      now,
    });
  } catch {
    return [];
  }
}

export function patternsVM(slices: GrocerySlices, now: number): PatternsVM {
  const groups: PatternGroup[] = [];

  // ── group: your shopping rhythm — the real cadence / stale / drift ──
  const rhythm: PatternRow[] = [];
  const patterns = safeDetectPatterns(slices, now);
  for (const p of patterns) {
    if (p.pattern === 'shopping-cadence') {
      rhythm.push({
        line: `about ${p.avg_gap_days} days between grocery trips, on average`,
        frame:
          'a steadier cadence than it feels like — the list can be timed to it instead of done in a panic.',
        cite: 'Altgassen 2014 · prospective memory',
      });
    } else if (p.pattern === 'stale-shopping-list') {
      rhythm.push({
        line: `${p.stale_count} thing${p.stale_count === 1 ? ' has' : 's have'} sat unbought on the list for over 2 weeks`,
        frame:
          "wishlist drift — if you don't actually want them, clearing them makes the real list easier to see.",
        cite: 'Gollwitzer 1999 · intention follow-through',
      });
    } else if (p.pattern === 'grocery-expiration-drift') {
      const names = p.items.map((i) => i.name).slice(0, 3).join(', ');
      rhythm.push({
        line: `${p.sample_n} thing${p.sample_n === 1 ? '' : 's'} in the pantry turn soon — ${names}`,
        frame:
          'a soft heads-up, not a chore — one or two meals planned around them and nothing composts.',
        cite: 'Barkley & Murphy 2010 · time blindness',
      });
    } else if (p.pattern === 'grocery-stockout-cascade') {
      rhythm.push({
        line: `${p.name} keeps coming back to the list — bought ${p.sample_n} times lately`,
        frame:
          "a consumable on a clock — it's easier as a standing staple than a thing to remember.",
        cite: 'Wood & Neal 2007 · habit & routine',
      });
    }
  }
  if (rhythm.length > 0) {
    groups.push({ label: 'your shopping rhythm', rows: rhythm });
  }

  // ── group: what you keep getting drawn to — the E8 interest capture ──
  const drawn: PatternRow[] = [];
  const interest = safeDetectInterest(slices, now);
  for (const s of interest) {
    drawn.push({
      line: `${s.count} ${s.category} things in ${s.window_days / 7} weeks — a pattern, not a medical thing`,
      frame:
        "a burst of interest in one corner of the world — worth naming, it tends to pass on its own.",
      cite: 'Wood & Neal 2007 · habit & novelty',
    });
  }
  if (drawn.length > 0) {
    groups.push({ label: 'what you keep getting drawn to', rows: drawn });
  }

  const live = groups.length > 0;
  return {
    groups: live ? groups : EXAMPLE_GROUPS,
    live,
    exampleFallback: !live,
  };
}

// ─── notifications reel (grocery-notifications.html) ─────────────────────────

const WEEKDAYS_FULL = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];
const MONTHS_FULL = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** "monday, may 25" — the lock-screen clock day line */
export function fmtClockDay(ts: number): string {
  const d = new Date(ts);
  return `${WEEKDAYS_FULL[d.getDay()]}, ${MONTHS_FULL[d.getMonth()]} ${d.getDate()}`;
}

/** "8:12" — the lock-screen clock time line */
export function fmtClockTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h}:${String(m).padStart(2, '0')}`;
}

export type NotificationGlyph =
  | 'expiration'
  | 'cascade'
  | 'stale'
  | 'cadence'
  | 'weekly';

/** one lock-screen notification card */
export interface NotificationCard {
  glyph: NotificationGlyph;
  /** "monday, may 25" */
  day: string;
  /** "8:12" */
  time: string;
  /** "now" / "2h ago" / "sun" */
  when: string;
  title: string;
  body: string;
}

export interface NotificationsVM {
  cards: NotificationCard[];
}

/**
 * The grocery notification reel — a curated gallery of how each grocery
 * push speaks. This is a PRESENTATION SURFACE (the seven copy frames), not
 * a live feed: the real push engine is the ambient orchestrator. Reported
 * as a presentation stub. The frame dates are derived off the injected
 * `now` so the reel reads as a real iOS lock screen.
 */
export function notificationsVM(now: number): NotificationsVM {
  const at = (dayOffset: number, hour: number, minute: number): number => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  };

  const cards: NotificationCard[] = [
    {
      glyph: 'expiration',
      ...clock(at(0, 8, 12)),
      when: 'now',
      title: 'olive oil turns soon',
      body: "one dinner away, or it composts. just so it's not a surprise.",
    },
    {
      glyph: 'cascade',
      ...clock(at(3, 17, 40)),
      when: '2h ago',
      title: 'you keep rebuying milk — make it a staple?',
      body: "a standing item runs on its own clock, so it's not yours to track.",
    },
    {
      glyph: 'stale',
      ...clock(at(7, 10, 25)),
      when: 'sun',
      title: '4 things have sat on the list 2 weeks',
      body: "clear the ones you don't actually want — the real list gets easier to read.",
    },
    {
      glyph: 'cadence',
      ...clock(at(9, 9, 0)),
      when: 'tue',
      title: 'about 6 days since the last shop — 7 on the list',
      body: "no rush. just timed to your usual rhythm, in case it's a good day.",
    },
    {
      glyph: 'weekly',
      ...clock(at(14, 18, 0)),
      when: 'sun 6pm',
      title: 'your week — 2 shops, nothing went off',
      body: 'a quiet recap. arrives only if you asked for it.',
    },
  ];

  return { cards };
}

/** the day + time pair for a notification card */
function clock(ts: number): { day: string; time: string } {
  return { day: fmtClockDay(ts), time: fmtClockTime(ts) };
}
