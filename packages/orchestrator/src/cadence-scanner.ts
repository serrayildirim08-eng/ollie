/**
 * @ollie/orchestrator · cadence-scanner
 *
 * Generic glue between @ollie/cadence estimates and @ollie/notifications.
 *
 * The two existing per-module `scanCues()` (work.ts, goals.ts) fire on
 * domain-specific signals (meetings, focus blocks, paused goals). They
 * stay as-is — this scanner is additive and covers the orthogonal
 * cadence-overdue signal that the @ollie/cadence package surfaces for
 * every tracked label across grocery / body / habits / (8 more incoming).
 *
 * Design
 * ──────
 * - Sources register with `registerSource(module, enumerate)` and yield
 *   `{ module, key, estimate, label? }` for every tracked entry.
 * - On each scan, we call `isOverdue(estimate, now)`; for each overdue
 *   entry we dispatch a notification via `@ollie/notifications.notify()`.
 *   `notify()` already routes through suppression (quiet hours +
 *   focus-mode), budget, mute, and 24h dedupe — we don't reimplement.
 * - Belt-and-braces: we also persist a small `_cadence_last_fired` map
 *   (dedupe_key → ts) in the store so a foregrounded device never spams
 *   `notify()` with the same key just to have it dedupe — cheaper to skip
 *   in-memory before constructing the spec.
 *
 * Dedupe key shape:
 *   `cadence:<module>:<key>:<YYYY-MM-DD>`
 *
 * The trailing local-calendar-day suffix means:
 *   - within one day, repeated scans collapse (in-process Set + store map +
 *     notify()'s own 24h dedupe — three layers)
 *   - across the day boundary, the key naturally rotates so a still-overdue
 *     item can fire ONCE the next day (per-day, not per-overdue-event)
 *
 * Trigger model
 * ─────────────
 * - On boot (init()) — debounced 1s so it doesn't race the store hydration.
 * - On a 30-min interval timer, but only while the app is foregrounded
 *   (web: document.visibilityState === 'visible'). Background tabs skip.
 * - Public `scanNow()` for ad-hoc triggers (e.g. on visibility-change to
 *   "visible" after a long background pause).
 *
 * Constraints honoured
 * ────────────────────
 *   - Uses @ollie/notifications.notify (not a parallel notifier).
 *   - Uses isOverdue() from @ollie/cadence.
 *   - Routes through notifications/suppression (notify does internally).
 *   - Persisted last-fired in @ollie/store (`shared._cadence_last_fired`),
 *     pruned to entries seen in the last 30 days so it can't grow forever.
 *   - Never invoked from a Box render path — only init/timer/scanNow.
 *   - Additive — does not touch work.ts or goals.ts scanCues.
 */

import { isOverdue, type CadenceEstimate } from '@ollie/cadence';
import { notify, type NotificationCategory } from '@ollie/notifications';
import type { Store } from '@ollie/store';
import type { Orchestrator } from './types';

// ─── module-agnostic types ──────────────────────────────────────────────

/** One row from a source's `enumerate()` — a tracked label and its cadence. */
export interface CadenceTrackedEntry {
  /** Module id, e.g. 'grocery', 'body', 'habits'. */
  module: string;
  /** Stable per-module key, e.g. canonical pantry name, activity, habit id. */
  key: string;
  /** Cadence estimate from @ollie/cadence. */
  estimate: CadenceEstimate;
  /**
   * Optional human-readable label distinct from `key` — used in the copy.
   * If absent, `key` is used verbatim.
   */
  label?: string;
}

/** A source = "this module's adapter, please yield everything you track". */
export type CadenceSourceFn = () => Promise<CadenceTrackedEntry[]> | CadenceTrackedEntry[];

// ─── copy templates ─────────────────────────────────────────────────────

/**
 * Three-variant copy table per module. Variant pick is deterministic
 * (hash of dedupe_key) so the same label gets the same line until the
 * dedupe day rolls over, but Serra doesn't see "running low on coffee"
 * for 12 different pantry items in a row.
 *
 * House voice: lowercase, factual, no alarm, no exclamation marks.
 * Body field stays short — these surface as quiet OS notifications, not
 * essays.
 */
export interface CadenceCopyTemplates {
  variants: Array<(label: string) => { title: string; body?: string }>;
  category: NotificationCategory;
  /** Optional URL the notification opens on tap. */
  actionUrl?: string;
}

export const DEFAULT_CADENCE_COPY: Record<string, CadenceCopyTemplates> = {
  grocery: {
    category: 'PATTERN_ALERT',
    actionUrl: '/grocery',
    variants: [
      (l) => ({ title: `running low on ${l}` }),
      (l) => ({ title: `${l} — might be time to restock` }),
      (l) => ({ title: `usually grab ${l} by now` }),
    ],
  },
  body: {
    category: 'PATTERN_ALERT',
    actionUrl: '/body',
    variants: [
      (l) => ({ title: `haven’t done ${l} in a while` }),
      (l) => ({ title: `${l} — been a minute` }),
      (l) => ({ title: `body usually wants ${l} by now` }),
    ],
  },
  habits: {
    category: 'PATTERN_ALERT',
    actionUrl: '/habits',
    variants: [
      (l) => ({ title: `${l} streak — might want to catch up?` }),
      (l) => ({ title: `${l} hasn’t happened in a few days` }),
      (l) => ({ title: `usual ${l} day is past` }),
    ],
  },
  // Hooks for the 8 incoming modules — fill in as they ship.
  // pets / finance / sleep / cycle / medication / pets / dump / matters.
};

// ─── persistence ────────────────────────────────────────────────────────

/** Store slice key for the persisted dedupe map. */
const LAST_FIRED_KEY = '_cadence_last_fired';
const LAST_FIRED_MOD = 'shared';

/** Prune entries older than this on every scan to keep the slice bounded. */
const PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface LastFiredMap { [dedupeKey: string]: number }

function readLastFired(store: Store): LastFiredMap {
  return store.get<LastFiredMap>(LAST_FIRED_MOD, LAST_FIRED_KEY, {}) ?? {};
}

function writeLastFired(store: Store, map: LastFiredMap): void {
  store.set(LAST_FIRED_MOD, LAST_FIRED_KEY, map);
}

function pruneLastFired(map: LastFiredMap, now: number): LastFiredMap {
  const cutoff = now - PRUNE_AGE_MS;
  const out: LastFiredMap = {};
  for (const [k, ts] of Object.entries(map)) {
    if (typeof ts === 'number' && ts >= cutoff) out[k] = ts;
  }
  return out;
}

// ─── dedupe key + day helpers ───────────────────────────────────────────

/** Local calendar-day, ISO-ish (YYYY-MM-DD), used as a dedupe scope. */
export function localDayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Stable per-day dedupe key — also matches notify()'s 24h dedupe scope. */
export function buildDedupeKey(module: string, key: string, now: number): string {
  return `cadence:${module}:${key}:${localDayKey(now)}`;
}

/** Tiny deterministic hash for copy-variant selection. */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** Pick a copy variant deterministically — same key → same line per day. */
export function pickCopyVariant(
  templates: CadenceCopyTemplates,
  module: string,
  key: string,
  label: string,
): { title: string; body?: string } {
  if (templates.variants.length === 0) {
    return { title: `${label} — heads up` };
  }
  const idx = Math.abs(hashStr(`${module}:${key}`)) % templates.variants.length;
  // Non-null asserted: idx is bounded by length>0.
  const variant = templates.variants[idx]!;
  return variant(label);
}

// ─── scanner ─────────────────────────────────────────────────────────────

export interface CadenceScannerOptions {
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
  /** Override or extend the per-module copy table. Merged onto the defaults. */
  copy?: Record<string, CadenceCopyTemplates>;
  /**
   * `isOverdue` slack — passed to @ollie/cadence's isOverdue(). Defaults
   * to one day so weekly cadence doesn't ping the instant the median
   * interval rolls over.
   */
  overdueSlackMs?: number;
  /**
   * Foreground predicate. Returns true when the app is visible and the
   * timer should keep firing; false to skip. Defaults to
   * document.visibilityState === 'visible' in the browser, else true.
   */
  isForeground?: () => boolean;
  /** Interval for the recurring foreground scan. Defaults to 30 min. */
  intervalMs?: number;
  /** Debounce delay for the boot scan. Defaults to 1s. */
  bootDelayMs?: number;
}

export interface CadenceScanner extends Orchestrator {
  /** Register a source for a module. Idempotent — re-registering overwrites. */
  registerSource(module: string, enumerate: CadenceSourceFn): void;
  /** Drop a source. */
  unregisterSource(module: string): void;
  /** Run a scan now (boot, on-resume, tests). Resolves when complete. */
  scanNow(): Promise<CadenceScanResult>;
}

export interface CadenceScanResult {
  /** How many entries each source yielded. */
  enumeratedByModule: Record<string, number>;
  /** Notification specs we dispatched (one per overdue + un-deduped key). */
  fired: Array<{ module: string; key: string; dedupeKey: string; title: string }>;
  /** Specs we skipped because they were already fired today. */
  skippedDedupe: string[];
  /** Sources that threw — logged, not fatal. */
  errors: Array<{ module: string; message: string }>;
}

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_BOOT_DELAY_MS = 1000;

function defaultIsForeground(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible';
}

export function createCadenceScanner(
  store: Store,
  opts: CadenceScannerOptions = {},
): CadenceScanner {
  const getNow = opts.now ?? (() => Date.now());
  const overdueSlackMs = opts.overdueSlackMs; // undefined → use cadence default (1d)
  const isForeground = opts.isForeground ?? defaultIsForeground;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const bootDelayMs = opts.bootDelayMs ?? DEFAULT_BOOT_DELAY_MS;
  const copy: Record<string, CadenceCopyTemplates> = {
    ...DEFAULT_CADENCE_COPY,
    ...(opts.copy ?? {}),
  };

  const sources = new Map<string, CadenceSourceFn>();
  let initialized = false;
  let bootTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let visibilityHandler: (() => void) | null = null;
  // In-process Set so within a single session repeated scans skip even
  // before we read/write the store. Cleared on teardown only.
  const sessionFired = new Set<string>();

  async function scanOnce(): Promise<CadenceScanResult> {
    const now = getNow();
    const result: CadenceScanResult = {
      enumeratedByModule: {},
      fired: [],
      skippedDedupe: [],
      errors: [],
    };

    // Read-then-prune the last-fired map once per scan.
    const lastFired = pruneLastFired(readLastFired(store), now);
    let lastFiredDirty = false;

    for (const [module, enumerate] of sources.entries()) {
      let entries: CadenceTrackedEntry[];
      try {
        entries = await enumerate();
      } catch (err) {
        result.errors.push({
          module,
          message: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      result.enumeratedByModule[module] = entries.length;

      for (const entry of entries) {
        if (!entry || entry.module !== module) continue;
        const overdue = isOverdue(entry.estimate, now, overdueSlackMs);
        if (overdue !== true) continue;

        const dedupeKey = buildDedupeKey(entry.module, entry.key, now);

        // Layer 1: in-process Set (same session, same day).
        if (sessionFired.has(dedupeKey)) {
          result.skippedDedupe.push(dedupeKey);
          continue;
        }
        // Layer 2: persisted map (across sessions, same day).
        if (typeof lastFired[dedupeKey] === 'number') {
          result.skippedDedupe.push(dedupeKey);
          sessionFired.add(dedupeKey);
          continue;
        }

        const templates = copy[entry.module];
        if (!templates) {
          // No copy registered for this module — skip rather than ship
          // a placeholder. The 8 incoming modules will register theirs.
          continue;
        }
        const label = entry.label ?? entry.key;
        const { title, body } = pickCopyVariant(templates, entry.module, entry.key, label);

        sessionFired.add(dedupeKey);
        lastFired[dedupeKey] = now;
        lastFiredDirty = true;

        result.fired.push({ module: entry.module, key: entry.key, dedupeKey, title });

        // Fire-and-forget — notify() handles suppression, budget, mute.
        // We don't await because one slow backend shouldn't stall the
        // rest of the scan. Errors inside notify are already caught
        // there and logged.
        void notify({
          title,
          body,
          category: templates.category,
          dedupe_key: dedupeKey,
          action_url: templates.actionUrl,
        }).catch((err: unknown) => {
          // Defensive: notify is supposed to swallow its own errors,
          // but if a future change throws synchronously we don't want
          // a global unhandled rejection.
          console.error('[cadence-scanner] notify failed', dedupeKey, err);
        });
      }
    }

    if (lastFiredDirty) writeLastFired(store, lastFired);
    return result;
  }

  return {
    registerSource(module, enumerate) {
      sources.set(module, enumerate);
    },
    unregisterSource(module) {
      sources.delete(module);
    },
    async scanNow() {
      return scanOnce();
    },
    init() {
      if (initialized) return;
      initialized = true;

      // Boot scan, debounced so store hydration / source registration that
      // happens immediately after init() settles first.
      if (bootTimer) clearTimeout(bootTimer);
      bootTimer = setTimeout(() => {
        bootTimer = null;
        void scanOnce().catch((err) => {
          console.error('[cadence-scanner] boot scan failed', err);
        });
      }, bootDelayMs);

      // Recurring foreground timer.
      if (intervalTimer) clearInterval(intervalTimer);
      intervalTimer = setInterval(() => {
        if (!isForeground()) return;
        void scanOnce().catch((err) => {
          console.error('[cadence-scanner] interval scan failed', err);
        });
      }, intervalMs);

      // Re-scan when the app comes back to the foreground (web only).
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        visibilityHandler = () => {
          if (!isForeground()) return;
          void scanOnce().catch((err) => {
            console.error('[cadence-scanner] visibility scan failed', err);
          });
        };
        document.addEventListener('visibilitychange', visibilityHandler);
      }
    },
    teardown() {
      if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
      if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null; }
      if (
        visibilityHandler &&
        typeof document !== 'undefined' &&
        typeof document.removeEventListener === 'function'
      ) {
        document.removeEventListener('visibilitychange', visibilityHandler);
      }
      visibilityHandler = null;
      sessionFired.clear();
      initialized = false;
    },
  };
}
