/**
 * apps/native · notify/datelessLadder.ts  —  escalating reminder ladder for
 * DATE-LESS admin + work tasks.
 *
 * Problem: a task written with no time ("call the bank", "send the deck") has no
 * dueDate, so the normal scheduleTaskReminder path (which needs a `remindIn`
 * hint) never fires — these tasks silently rot. This ladder gives every OPEN,
 * date-less admin/work task a growing-gap series of gentle reminders so it
 * surfaces again and again until acted on, then bows out with a calm offer
 * rather than nagging forever.
 *
 * THE LADDER (gaps grow from creation):
 *   tier 0 → +1 day
 *   tier 1 → +3 more days   (≈ 4 days from creation)
 *   tier 2 → +1 more week   (≈ 11 days from creation)
 *   tier 3 → +1 more month  (≈ 41 days from creation)
 *   after tier 3, if STILL open → a model-C OFFER (a brain noticing) asking
 *     "still want this — or should I archive it?" whose accept ARCHIVES the task
 *     (via the brain executeAction `archive_task` path). No further plain pings.
 *
 * ARCHITECTURE (reuse, do not reinvent):
 *   - OS-local delivery rides scheduleAt (EVENT path → emit
 *     'ollie-schedule-notif', NEVER invoke() — ACL-safe over iOS localhost,
 *     survives app-quit). Each tier carries OLLIE_REMINDER_CATEGORY so the user
 *     gets the "Got it ✓" / "Snooze 1h" buttons; "Got it ✓" completes the task,
 *     which cancels the rest of the ladder.
 *   - The C-offer surfaces through the SAME pattern-card → gatherCandidates →
 *     selectTodaysNoticings pipeline every other C-model offer uses: we write a
 *     card into `<module>.patterns` carrying actionKind:'archive_task'.
 *
 * ROBUST + IDEMPOTENT (harness rule): each task's ladder TIER is persisted in
 * the store (`<module>._datelessLadder`). A tier only ADVANCES — never rewinds —
 * so a re-emit / restart never double-fires. Each OS notification additionally
 * uses a stable per-tier id so even a lost marker can't double-schedule. A tier
 * fires only while the task is still OPEN at sweep time; a completed/removed
 * task is dropped and its pending notifications cancelled.
 *
 * GO-DARK / quiet: the sweep skips ALL scheduling/offering while the user is
 * "taking today off" (partnerRepo.isDarkToday). It does NOT advance the tier on
 * a dark day, so nothing is lost — the same tier fires on the next non-dark
 * sweep. (Dismiss ≈ ignore: a swiped-away reminder just lets the next tier fire
 * on schedule; we never try to detect a swipe.)
 */

import type { Store } from '@ollie/store';

import { scheduleAt } from './systemNotify';
import { OLLIE_REMINDER_CATEGORY } from './notificationActions';
import { partnerRepo } from '../modules/partner/repo';

const DAY_MS = 86_400_000;

/** Per-tier ADDITIONAL gap (ms) on top of the previous tier's fire time. */
const TIER_GAPS_MS: readonly number[] = [
  1 * DAY_MS, // tier 0: +1 day from creation
  3 * DAY_MS, // tier 1: +3 more days
  7 * DAY_MS, // tier 2: +1 more week
  30 * DAY_MS, // tier 3: +1 more month
];

/** Number of plain-reminder tiers before the archive offer (= TIER_GAPS_MS). */
export const LADDER_TIER_COUNT = TIER_GAPS_MS.length;

/** Defensive cap on tracked rows (newest kept). */
const LADDER_CAP = 500;

/** Which task repo the row lives in. */
export type LadderModule = 'admin' | 'work';

/** The persisted ladder state for one date-less task. */
export interface LadderEntry {
  module: LadderModule;
  taskId: string;
  /** The task text — used for the reminder body + the archive-offer copy. */
  text: string;
  /** Task creation time (ladder tier fire times are derived from this). */
  createdAt: number;
  /** The NEXT tier to fire (0..LADDER_TIER_COUNT). === count → all tiers fired. */
  tier: number;
  /** True once the archive C-offer has been surfaced (so we never re-offer). */
  offered: boolean;
}

/** The store key (per module namespace) holding the ladder entries array. */
const LADDER_KEY = '_datelessLadder';

/** Pattern-card key the archive offer is written under (per module namespace). */
const PATTERNS_KEY = 'patterns';

// ─── tier fire-time math ─────────────────────────────────────────────────────

/**
 * Absolute fire time (ms) of `tier`, measured from `createdAt` by summing the
 * cumulative gaps. Tier `LADDER_TIER_COUNT` returns the same as the last tier's
 * fire time (the moment the archive offer becomes eligible).
 */
export function tierFireAt(createdAt: number, tier: number): number {
  let at = createdAt;
  const upTo = Math.min(tier + 1, TIER_GAPS_MS.length);
  for (let i = 0; i < upTo; i += 1) at += TIER_GAPS_MS[i]!;
  return at;
}

// ─── persistence (best-effort) ───────────────────────────────────────────────

function readEntries(store: Store, module: LadderModule): LadderEntry[] {
  const arr = store.get<LadderEntry[]>(module, LADDER_KEY, []) ?? [];
  return arr.filter(
    (e): e is LadderEntry =>
      !!e &&
      (e.module === 'admin' || e.module === 'work') &&
      typeof e.taskId === 'string' &&
      e.taskId.length > 0 &&
      typeof e.createdAt === 'number',
  );
}

function writeEntries(store: Store, module: LadderModule, list: LadderEntry[]): void {
  store.set(module, LADDER_KEY, list.slice(-LADDER_CAP));
}

// ─── public: register a date-less task ───────────────────────────────────────

/**
 * Begin the ladder for a newly-created DATE-LESS task. No-op when a dueDate is
 * present (those ride the normal reminder path) or when an entry already exists
 * for this id (idempotent — re-dispatch never double-registers). Schedules the
 * tier-0 OS notification immediately so it survives app-quit.
 *
 * `dueDate` is the task's due date string (ISO) or null. Only null/empty starts
 * the ladder.
 */
export function startDatelessLadder(
  store: Store,
  input: {
    module: LadderModule;
    taskId: string;
    text: string;
    dueDate?: string | null;
    createdAt?: number;
  },
): void {
  try {
    if (input.dueDate != null && input.dueDate.toString().trim() !== '') return;
    const taskId = input.taskId.trim();
    if (!taskId) return;

    const entries = readEntries(store, input.module);
    if (entries.some((e) => e.taskId === taskId)) return; // already tracked.

    const createdAt = typeof input.createdAt === 'number' ? input.createdAt : Date.now();
    const entry: LadderEntry = {
      module: input.module,
      taskId,
      text: (input.text ?? '').toString().trim() || 'a task',
      createdAt,
      tier: 0,
      offered: false,
    };
    writeEntries(store, input.module, [...entries, entry]);

    // Schedule the tier-0 OS notification up-front (app-quit-safe). The sweep
    // advances the tier + schedules later tiers; scheduling tier 0 here means a
    // user who never reopens the app still gets the first nudge.
    scheduleTierNotification(entry, 0);
  } catch (err) {
    console.error('[ladder] startDatelessLadder failed (non-fatal):', err);
  }
}

// ─── public: cancel a task's ladder (on completion / archive / removal) ───────

/** Stable per-tier OS notification id — unique per (module, task, tier). */
function tierNotifId(module: LadderModule, taskId: string, tier: number): string {
  return `ladder:${module}:${taskId}:${tier}`;
}

/**
 * Cancel every pending ladder notification for a task and forget its state.
 * Called when the task is completed (notification "Got it ✓" OR in-app) or
 * archived. Emits 'ollie-cancel-notif' (via scheduleAt's handle) for each tier
 * id so the OS drops any still-pending fire. Idempotent + best-effort.
 */
export function cancelLadder(module: LadderModule, taskId: string, store?: Store): void {
  try {
    const id = (taskId ?? '').toString().trim();
    if (!id) return;
    // Cancel every tier's OS notification (the Rust cancel handler is a no-op
    // for ids that were never scheduled, so over-cancelling is safe).
    for (let tier = 0; tier < LADDER_TIER_COUNT; tier += 1) {
      cancelTierNotification(module, id, tier);
    }
    // Drop the persisted entry so the sweep stops tracking it.
    const s = store ?? getStoreSync();
    if (s) {
      const remaining = readEntries(s, module).filter((e) => e.taskId !== id);
      writeEntries(s, module, remaining);
    }
  } catch (err) {
    console.error('[ladder] cancelLadder failed (non-fatal):', err);
  }
}

// ─── scheduling helpers ──────────────────────────────────────────────────────

function scheduleTierNotification(entry: LadderEntry, tier: number): void {
  if (tier < 0 || tier >= LADDER_TIER_COUNT) return;
  const fireAt = tierFireAt(entry.createdAt, tier);
  scheduleAt(
    fireAt,
    {
      title: 'still on your list',
      body: entry.text,
      actionTypeId: OLLIE_REMINDER_CATEGORY,
      // "Got it ✓" → completeReminderTarget → markComplete → cancelLadder.
      extra: { module: entry.module, refId: entry.taskId },
    },
    tierNotifId(entry.module, entry.taskId, tier),
  );
}

/** Cache the Tauri `emit` resolver so cancelling N tiers loads the module once
 *  (and so tests can flush a single async hop, not N). Resolves to null
 *  off-Tauri (web / vitest without the mock), where there is nothing to cancel. */
let _emitPromise: Promise<((event: string, payload?: unknown) => unknown) | null> | undefined;
function resolveEmit(): Promise<((event: string, payload?: unknown) => unknown) | null> {
  if (_emitPromise === undefined) {
    _emitPromise = import('@tauri-apps/api/event')
      .then((m) => m.emit as (event: string, payload?: unknown) => unknown)
      .catch(() => null);
  }
  return _emitPromise;
}

function cancelTierNotification(module: LadderModule, taskId: string, tier: number): void {
  // scheduleAt with a past fire time returns a no-op handle, so we can't reuse
  // it to cancel. Emit the native cancel directly for the stable id.
  void resolveEmit()
    .then((emit) => emit?.('ollie-cancel-notif', tierNotifId(module, taskId, tier)))
    .catch(() => {
      /* off-Tauri (web/vitest) — nothing native to cancel. */
    });
}

// ─── the archive C-offer (model-C noticing via a pattern card) ───────────────

/** A pattern card shaped like the ones gatherCandidates → toCandidate reads. */
interface ArchiveOfferCard {
  pattern: string;
  category: string;
  copy: string;
  module: LadderModule;
  ts: number;
  actionKind: 'archive_task';
  taskModule: LadderModule;
  taskId: string;
  /** The task text → the offer copy + facts.items[0]. */
  items: Array<{ name: string }>;
}

/**
 * Surface the archive C-offer for a task that survived the whole ladder. Writes
 * a pattern card into `<module>.patterns` carrying actionKind:'archive_task', so
 * it flows through the normal noticing selection + accept-to-act pipeline. The
 * card's stable `pattern` id makes the resulting noticing id stable, so postpone
 * / dismiss state behaves; re-writing an identical card is harmless.
 */
function surfaceArchiveOffer(store: Store, entry: LadderEntry): void {
  const ns = entry.module;
  const existing = store.get<unknown[]>(ns, PATTERNS_KEY, []) ?? [];
  const list = Array.isArray(existing) ? existing : [];
  const patternId = `dateless-archive:${entry.taskId}`;
  // Don't pile duplicate cards for the same task.
  if (list.some((p) => (p as { pattern?: unknown })?.pattern === patternId)) return;
  const card: ArchiveOfferCard = {
    pattern: patternId,
    category: 'task-archive',
    copy: `"${entry.text}" has sat untouched for a while — still want it, or archive it?`,
    module: ns,
    ts: Date.now(),
    actionKind: 'archive_task',
    taskModule: ns,
    taskId: entry.taskId,
    items: [{ name: entry.text }],
  };
  store.set(ns, PATTERNS_KEY, [...list, card]);
}

// ─── the sweep (boot + recompute) ────────────────────────────────────────────

/**
 * Whether a tracked task is still OPEN. Resolved per module from the live repo.
 * A removed row counts as NOT open (its listOpen won't contain it).
 */
async function openTaskIds(module: LadderModule): Promise<Set<string>> {
  if (module === 'admin') {
    const { migrateAdmin } = await import('../modules/admin/migrate');
    const { tasks } = await import('../modules/admin/repo');
    await migrateAdmin();
    const open = await tasks.listOpen();
    return new Set(open.map((t) => t.id));
  }
  const { migrateWork } = await import('../modules/work/migrate');
  const { tasks } = await import('../modules/work/repo');
  await migrateWork();
  const open = await tasks.listOpen();
  return new Set(open.map((t) => t.id));
}

/**
 * Best-effort go-dark read. Any failure resolves to NOT dark so a broken read
 * never permanently silences a real ladder.
 */
async function isTakingDayOff(): Promise<boolean> {
  try {
    const state = await partnerRepo.load();
    return partnerRepo.isDarkToday(state);
  } catch {
    return false;
  }
}

/**
 * Advance every date-less task's ladder to the present. For each tracked entry:
 *   - drop it (and cancel its notifications) if the task is no longer open;
 *   - otherwise, while the current tier's fire time has passed, advance the
 *     tier and schedule the NEXT tier's OS notification (so it fires app-closed);
 *   - once all tiers have fired AND the post-final fire time has passed, surface
 *     the archive C-offer ONCE.
 *
 * Skips entirely while the user is taking the day off — without advancing any
 * tier — so a dark day defers, never drops, the ladder.
 *
 * Idempotent: tiers only move forward; a re-run with the same clock is a no-op.
 * Returns nothing; never throws. `now` is injectable for tests.
 */
export async function sweepDatelessLadders(
  store: Store,
  now: number = Date.now(),
): Promise<void> {
  try {
    if (await isTakingDayOff()) return; // defer the whole sweep while resting.

    for (const module of ['admin', 'work'] as const) {
      const entries = readEntries(store, module);
      if (entries.length === 0) continue;

      let open: Set<string>;
      try {
        open = await openTaskIds(module);
      } catch (err) {
        console.error(`[ladder] open-task read failed for ${module} (non-fatal):`, err);
        continue; // leave entries untouched; retry next sweep.
      }

      const next: LadderEntry[] = [];
      for (const entry of entries) {
        // Completed / removed → cancel any pending tiers + stop tracking.
        if (!open.has(entry.taskId)) {
          for (let tier = 0; tier < LADDER_TIER_COUNT; tier += 1) {
            cancelTierNotification(module, entry.taskId, tier);
          }
          continue;
        }

        const advanced = advanceEntry(store, entry, now);
        if (advanced) next.push(advanced);
      }
      writeEntries(store, module, next);
    }
  } catch (err) {
    console.error('[ladder] sweep failed (non-fatal):', err);
  }
}

/**
 * Advance ONE open entry against `now`. Schedules any newly-due tier's next-tier
 * notification and, past the final tier, surfaces the archive offer once. Pure
 * w.r.t. timing (mutates a copy); returns the updated entry to keep tracking, or
 * null to stop (offer surfaced — nothing left to do).
 */
function advanceEntry(store: Store, entry: LadderEntry, now: number): LadderEntry | null {
  let tier = entry.tier;
  let offered = entry.offered;

  // Advance through every tier whose fire time has already passed. For each tier
  // crossed, ensure the NEXT tier's OS notification is armed (idempotent — same
  // stable id, scheduleAt dedupes at the OS).
  while (tier < LADDER_TIER_COUNT && now >= tierFireAt(entry.createdAt, tier)) {
    tier += 1;
    if (tier < LADDER_TIER_COUNT) scheduleTierNotification(entry, tier);
  }

  // All plain tiers fired AND the final tier's moment has passed → archive offer.
  if (
    tier >= LADDER_TIER_COUNT &&
    !offered &&
    now >= tierFireAt(entry.createdAt, LADDER_TIER_COUNT - 1)
  ) {
    surfaceArchiveOffer(store, entry);
    offered = true;
    // Offer surfaced: the accept (or dismiss) lives in the noticing surface now,
    // and there are no further plain reminders, so stop tracking the ladder.
    return null;
  }

  if (tier === entry.tier && offered === entry.offered) return entry; // unchanged
  return { ...entry, tier, offered };
}

// ─── store access (for cancelLadder when no store is passed) ─────────────────

/**
 * Synchronously resolve the app store singleton if it has already been imported.
 * cancelLadder is called from both the notification-action path (no store handy)
 * and the brain executor; passing the store explicitly is preferred, but this
 * lets the no-arg call still clear persisted state. Returns null in a bare test
 * env where the store module isn't loaded.
 */
let _storeRef: Store | null = null;
function getStoreSync(): Store | null {
  return _storeRef;
}

/** Wire the store singleton so cancelLadder can clear state without an arg. */
export function setLadderStore(store: Store): void {
  _storeRef = store;
}
