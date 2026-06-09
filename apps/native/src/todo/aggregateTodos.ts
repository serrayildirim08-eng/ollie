/**
 * /todo aggregator · pure functions.
 *
 * The TodoScreen has no idea what an admin task or a renewal or a shopping
 * row looks like — it speaks one shape, `TodoItem`. This module is the
 * only place that knows how to translate each module's row into that
 * shape, sort the merged list, and bucket by date.
 *
 * It is intentionally pure: no SQL, no React, no Date.now() unless
 * explicitly passed. The TodoScreen calls each module repo's `listOpen()`,
 * passes the rows here, and renders the result. Tests mock the repos and
 * assert this module's outputs.
 *
 * Routed actions covered (from the dump pipeline · 2026-05-29):
 *   admin.create_task         → row.text
 *   admin.create_phone_task   → "call <person>[ about <reason>]"
 *   admin.schedule_appointment→ "<what> · <date|'no date'>"
 *   admin.log_renewal         → "renew <type>[ · by <date>]"
 *   work.create_task          → row.text
 *   work.log_deadline         → "<text> · due <date|'no date'>"
 *   grocery.shopping_list_add → row.name
 *
 * Out of scope per the To-Do brief:
 *   - no user-typed input (the brain dump is the only input)
 *   - no tags / priorities / projects / kanban / drag-reorder
 *   - the new reminder module (backend-senior is shipping in parallel) is
 *     orthogonal and intentionally not aggregated here.
 */

import type { AdminRenewal, AdminTask, RecurringDecisionRow } from '../modules/admin/types';
import type { ShoppingItem } from '../modules/grocery/types';
import type { PendingDecisionRow } from '../modules/finance/repo';
import type { WorkTask } from '../modules/work/types';

// ─── grocery safety-net filter ───────────────────────────────────────────────
//
// When Layer 1 loses the verb in a segmented dump (e.g. "i bought milk" →
// orphan "milk" → admin.create_task("milk")), this set catches the leak and
// silently drops the row before it surfaces on the To-Do screen.
//
// Rule (Serra, 2026-05-30): "to-do is shit i said i needed to do or shit
// with deadlines as today. past purchases are never todo."
//
// Applies only to admin.create_task and work.create_task. Other actions
// (phone tasks, appointments, renewals, deadlines, grocery.shopping_list_add)
// pass through untouched.
//
// Multi-word entries (e.g. "toilet paper") stay as-is; the check is
// `text.trim().toLowerCase() === entry`, so "buy milk" (two words) is KEPT.

export const GROCERY_WORDS: ReadonlySet<string> = new Set([
  // ── EN · food ──────────────────────────────────────────────────────────
  'milk', 'eggs', 'bread', 'butter', 'cheese', 'yogurt', 'rice', 'pasta',
  'oil', 'sugar', 'salt', 'flour', 'honey', 'jam', 'cereal', 'oats',
  'beans', 'lentils', 'chicken', 'beef', 'fish', 'tuna', 'salmon',
  'shrimp', 'tomatoes', 'onions', 'garlic', 'potatoes', 'carrots',
  'lemons', 'apples', 'bananas', 'oranges', 'grapes', 'berries',
  'lettuce', 'spinach', 'broccoli', 'pepper', 'coffee', 'tea', 'juice',
  'water', 'wine', 'beer', 'chocolate', 'biscuits', 'crackers', 'chips',
  'snacks', 'ice cream',
  // ── EN · household / personal care ────────────────────────────────────
  'soap', 'shampoo', 'conditioner', 'toothpaste', 'deodorant', 'tampons',
  'pads', 'toilet paper', 'paper towels', 'detergent', 'dish soap',
  'sponges', 'trash bags', 'diapers', 'wipes',
  // ── TR · food ──────────────────────────────────────────────────────────
  'süt', 'yumurta', 'ekmek', 'tereyağı', 'peynir', 'yoğurt', 'pirinç',
  'makarna', 'yağ', 'şeker', 'tuz', 'un', 'bal', 'reçel',
  'mısır gevreği', 'yulaf', 'fasulye', 'mercimek', 'tavuk', 'et', 'balık',
  'domates', 'soğan', 'sarımsak', 'patates', 'havuç', 'limon', 'elma',
  'muz', 'portakal', 'üzüm', 'çilek', 'marul', 'ıspanak', 'brokoli',
  'biber', 'kahve', 'çay', 'su', 'şarap', 'bira', 'çikolata',
  // ── TR · household / personal care ───────────────────────────────────
  'sabun', 'şampuan', 'diş macunu', 'ped', 'mendil', 'deterjan',
  // ── ES · food ──────────────────────────────────────────────────────────
  'leche', 'huevos', 'pan', 'mantequilla', 'queso', 'yogur', 'arroz',
  'pasta', 'aceite', 'azúcar', 'sal', 'harina', 'miel', 'mermelada',
  'cereales', 'avena', 'frijoles', 'lentejas', 'pollo', 'carne', 'pescado',
  'tomates', 'cebolla', 'ajo', 'papas', 'zanahorias', 'limones',
  'manzanas', 'plátanos', 'naranjas', 'uvas', 'lechuga', 'espinaca',
  'brócoli', 'café', 'té', 'agua', 'vino', 'cerveza',
  // ── ES · household / personal care ───────────────────────────────────
  'jabón', 'champú', 'pasta de dientes', 'toallas', 'detergente',
]);

/**
 * Returns true when `text` is a bare grocery noun that should not appear on
 * the To-Do screen. Normalises whitespace + case before checking.
 */
function isGroceryWord(text: string): boolean {
  return GROCERY_WORDS.has(text.trim().toLowerCase());
}

/**
 * Counts how many raw admin/work create_task rows would be silently dropped
 * by the grocery filter. Useful for a future "n grocery items hidden" footer
 * without coupling it to the render path. Does NOT mutate rows.
 */
export function getGroceryLeakCount(
  rows: ReadonlyArray<{ kind: string; text: string }>,
): number {
  return rows.filter(
    (r) => (r.kind === 'task') && isGroceryWord(r.text),
  ).length;
}

// ─── normalized shape ─────────────────────────────────────────────────────

export type TodoSource = 'admin' | 'work' | 'grocery' | 'admin_decision' | 'finance_decision';

/**
 * The single UI-facing shape. The screen renders one bullet per item;
 * the `id` is composite so React keys + click-to-complete can roundtrip
 * back to the source module's repo via `(source, rowId)`.
 *
 * - `date` is an ISO `yyyy-mm-dd` for sortable dated items, or undefined
 *   for items the user dumped without a date. Bucketing uses this; the
 *   screen also prints it as a quiet caption.
 * - `createdAt` is the row's original creation time (ms since epoch),
 *   used as the tiebreaker for un-dated items.
 * - `kind` discriminates the row variant for the renderer:
 *     'task'     → normal bullet, click-to-complete
 *     'decision' → DECISION variant with cancel / keep / decide-later buttons
 */
export interface TodoItem {
  readonly id: string;
  readonly source: TodoSource;
  readonly action: TodoAction;
  readonly text: string;
  readonly date?: string;
  readonly createdAt: number;
  readonly rowId: string;
  readonly kind: 'task' | 'decision';
}

/** The nine brain-dump actions that surface as to-do bullets. */
export type TodoAction =
  | 'create_task'
  | 'create_phone_task'
  | 'schedule_appointment'
  | 'log_renewal'
  | 'log_deadline'
  | 'shopping_list_add'
  | 'recurring_decision'
  | 'pending_decision';

// ─── normalizers · one per (module, action) pair ──────────────────────────
//
// Each normalizer turns a module-typed row into a TodoItem. They are the
// only place the display copy is shaped — the screen never reaches into
// a row's data envelope itself. Keep these terse + grammatical.

/** admin.create_task / admin.create_phone_task / admin.schedule_appointment
 *  / admin.log_paperwork / admin.recurring_decision all live in
 *  admin_tasks; we surface only the three that count as todos. */
export function normalizeAdminTask(row: AdminTask): TodoItem | null {
  if (row.kind === 'task') {
    // Safety-net: drop single grocery nouns that Layer 1 mis-classified as
    // create_task (e.g. orphan "milk" from "i bought milk").
    if (isGroceryWord(row.text)) return null;
    return {
      id: `admin:${row.id}`,
      source: 'admin',
      action: 'create_task',
      text: row.text,
      date: row.dueDate ?? undefined,
      createdAt: row.createdAt,
      rowId: row.id,
      kind: 'task',
    };
  }
  if (row.kind === 'phone') {
    // data discriminator narrows to { kind: 'phone'; reason?: string }
    const reason = row.data.kind === 'phone' ? row.data.reason : undefined;
    // `row.text` for phone rows holds the person's name (see admin/handler.ts).
    const person = row.text;
    const text =
      reason && reason.length > 0
        ? `call ${person} about ${reason}`
        : `call ${person}`;
    return {
      id: `admin:${row.id}`,
      source: 'admin',
      action: 'create_phone_task',
      text,
      date: row.dueDate ?? undefined,
      createdAt: row.createdAt,
      rowId: row.id,
      kind: 'task',
    };
  }
  if (row.kind === 'appointment') {
    const date = row.data.kind === 'appointment' ? row.data.date : undefined;
    const what = row.text;
    const text = date ? `${what} · ${date}` : `${what} · no date`;
    return {
      id: `admin:${row.id}`,
      source: 'admin',
      action: 'schedule_appointment',
      text,
      date,
      createdAt: row.createdAt,
      rowId: row.id,
      kind: 'task',
    };
  }
  // paperwork / decision are NOT to-do bullets per the brief — they're
  // background admin debris with no "act on it" semantics.
  // (admin.recurring_decision rows come through recurringDecisions.listOpen,
  //  not via admin_tasks — they use a separate normalizer below.)
  return null;
}

/** admin.log_renewal → "renew <type>[ · by <date>]" */
export function normalizeAdminRenewal(row: AdminRenewal): TodoItem {
  const base = `renew ${row.renewalType}`;
  const text = row.dueDate ? `${base} · by ${row.dueDate}` : base;
  return {
    id: `admin:${row.id}`,
    source: 'admin',
    action: 'log_renewal',
    text,
    date: row.dueDate ?? undefined,
    createdAt: row.addedAt,
    rowId: row.id,
    kind: 'task',
  };
}

/**
 * admin.recurring_decision → "decide: <what>"
 *
 * Surfaces as a DECISION variant row with cancel / keep / decide later
 * buttons. Source is 'admin_decision' so the renderer knows which repo
 * helpers to call back.
 */
export function normalizeRecurringDecision(row: RecurringDecisionRow): TodoItem {
  return {
    id: `admin_decision:${row.id}`,
    source: 'admin_decision',
    action: 'recurring_decision',
    text: `decide: ${row.what}`,
    createdAt: row.createdAt,
    rowId: row.id,
    kind: 'decision',
  };
}

/**
 * finance.pending_decision → "decide: <what>"
 *
 * Same DECISION variant. Source 'finance_decision' so cancel routes to
 * pending.decide(id, 'skip') instead of recurringDecisions.decide(id, 'cancel').
 */
export function normalizePendingDecision(row: PendingDecisionRow): TodoItem {
  return {
    id: `finance_decision:${row.id}`,
    source: 'finance_decision',
    action: 'pending_decision',
    text: `decide: ${row.what}`,
    createdAt: row.createdAt,
    rowId: row.id,
    kind: 'decision',
  };
}

/** work.create_task and work.log_deadline both come from work_tasks; the
 *  `kind` discriminator picks which action this row represents. */
export function normalizeWorkTask(row: WorkTask): TodoItem | null {
  if (row.kind === 'deadline') {
    const text = row.dueDate
      ? `${row.text} · due ${row.dueDate}`
      : `${row.text} · due no date`;
    return {
      id: `work:${row.id}`,
      source: 'work',
      action: 'log_deadline',
      text,
      date: row.dueDate ?? undefined,
      createdAt: row.createdAt,
      rowId: row.id,
      kind: 'task',
    };
  }
  // Safety-net: drop single grocery nouns mis-classified as work.create_task.
  if (isGroceryWord(row.text)) return null;
  return {
    id: `work:${row.id}`,
    source: 'work',
    action: 'create_task',
    text: row.text,
    createdAt: row.createdAt,
    rowId: row.id,
    kind: 'task',
  };
}

/** grocery.shopping_list_add → bare item name (the screen renders a small
 *  "grocery" caption next to it). */
export function normalizeGroceryShopping(row: ShoppingItem): TodoItem {
  return {
    id: `grocery:${row.id}`,
    source: 'grocery',
    action: 'shopping_list_add',
    text: row.name,
    createdAt: row.addedAt,
    rowId: row.id,
    kind: 'task',
  };
}

// ─── aggregate · sort · bucket ────────────────────────────────────────────

export interface AggregateInput {
  readonly admin: {
    readonly tasks: readonly AdminTask[];
    readonly renewals: readonly AdminRenewal[];
    readonly decisions: readonly RecurringDecisionRow[];
  };
  readonly work: { readonly tasks: readonly WorkTask[] };
  readonly grocery: { readonly shopping: readonly ShoppingItem[] };
  readonly finance: { readonly pendingDecisions: readonly PendingDecisionRow[] };
}

/**
 * Merge every module's open rows into one TodoItem stream, sorted per the
 * brief:
 *   1. Items with a date come first, ascending (closest first).
 *   2. Items without a date come after, ordered by createdAt descending.
 *
 * Paperwork / decision rows from admin are silently dropped (see the
 * normalizer above) — they're not actionable to-dos.
 */
export function aggregateTodos(input: AggregateInput): TodoItem[] {
  const items: TodoItem[] = [];

  for (const row of input.admin.tasks) {
    const item = normalizeAdminTask(row);
    if (item) items.push(item);
  }
  for (const row of input.admin.renewals) {
    items.push(normalizeAdminRenewal(row));
  }
  for (const row of input.admin.decisions) {
    items.push(normalizeRecurringDecision(row));
  }
  for (const row of input.work.tasks) {
    const item = normalizeWorkTask(row);
    if (item) items.push(item);
  }
  for (const row of input.grocery.shopping) {
    items.push(normalizeGroceryShopping(row));
  }
  for (const row of input.finance.pendingDecisions) {
    items.push(normalizePendingDecision(row));
  }

  return sortTodos(items);
}

/**
 * Pure sort the screen can call on already-normalized items (e.g. for
 * optimistic insert). Exported so tests can assert sort independently of
 * normalization.
 */
export function sortTodos(items: readonly TodoItem[]): TodoItem[] {
  const dated: TodoItem[] = [];
  const undated: TodoItem[] = [];
  for (const item of items) {
    if (item.date) dated.push(item);
    else undated.push(item);
  }
  // dated · ascending (closest date first); ties broken by createdAt desc.
  dated.sort((a, b) => {
    // both a.date and b.date are non-empty here.
    const da = a.date as string;
    const db = b.date as string;
    if (da < db) return -1;
    if (da > db) return 1;
    return b.createdAt - a.createdAt;
  });
  // undated · newest first.
  undated.sort((a, b) => b.createdAt - a.createdAt);
  return [...dated, ...undated];
}

// ─── date bucketing ───────────────────────────────────────────────────────
//
// The screen groups items by date proximity rather than by source module
// (per the brief: ADHD-priority surfaces first). Buckets:
//   today      · date === today's iso day
//   this week  · date within the next 7 days (excludes today)
//   later      · date > 7 days out
//   no date    · undated items (the catch-all tail)
//
// Bucketing is pure; the screen passes `today` as an ISO yyyy-mm-dd so
// tests can pin time.

export type TodoBucketId = 'today' | 'thisWeek' | 'later' | 'noDate';

export interface TodoBucket {
  readonly id: TodoBucketId;
  /** Editorial header for the bucket. Lowercase per DNA. */
  readonly label: string;
  readonly items: readonly TodoItem[];
}

const BUCKET_ORDER: readonly TodoBucketId[] = ['today', 'thisWeek', 'later', 'noDate'];
const BUCKET_LABELS: Readonly<Record<TodoBucketId, string>> = {
  today: 'today',
  thisWeek: 'this week',
  later: 'later',
  noDate: 'no date',
};

/**
 * Bucket already-sorted items by date proximity. `today` is an ISO
 * yyyy-mm-dd; the function only does string compares + a day-diff so
 * it's tz-stable as long as today is computed in the user's local tz.
 */
export function bucketTodos(
  items: readonly TodoItem[],
  today: string,
): TodoBucket[] {
  const groups: Record<TodoBucketId, TodoItem[]> = {
    today: [],
    thisWeek: [],
    later: [],
    noDate: [],
  };

  for (const item of items) {
    if (!item.date) {
      groups.noDate.push(item);
      continue;
    }
    const days = isoDayDiff(today, item.date);
    if (days <= 0) groups.today.push(item);     // today or already-passed
    else if (days <= 7) groups.thisWeek.push(item);
    else groups.later.push(item);
  }

  return BUCKET_ORDER
    .map((id): TodoBucket => ({ id, label: BUCKET_LABELS[id], items: groups[id] }))
    .filter((b) => b.items.length > 0);
}

/** ISO yyyy-mm-dd diff in days (b - a). Positive = b is later than a.
 *  Uses Date.parse so daylight-savings edge cases don't lose a day. */
function isoDayDiff(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  const MS_PER_DAY = 86_400_000;
  return Math.round((tb - ta) / MS_PER_DAY);
}

/**
 * Local ISO yyyy-mm-dd for today, used as the default for the screen's
 * bucketing. Exported so tests can pass a pinned ISO value instead.
 */
export function isoToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
