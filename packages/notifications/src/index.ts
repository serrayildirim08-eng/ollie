/**
 * @ollie/notifications · public API
 *
 * NL1 + NL4. Cross-platform notification dispatcher with built-in
 * budget, per-category mute, dedupe, scheduling, and aggregation.
 *
 * Host apps install a backend at boot:
 *   import { installCapacitorBackend } from '@ollie/notifications/backends/capacitor';
 *   await installCapacitorBackend();
 *
 * Then any module can call:
 *   await notify({ title, body, category, dedupe_key, ... });
 *
 * Constitutional rule: only REMINDER | PATTERN_ALERT | CONTENT_DELIVERY
 * categories ship. The TS type literally has no other values — adding
 * a new category requires editing both this file AND the engagement-push
 * constitution.
 */

import type { Store } from '@ollie/store';
import * as events from '@ollie/events';
import { createAggregator } from './aggregator';
import {
  appendLog,
  countDeliveredToday,
  DEFAULT_BUDGET,
  isMuted,
  isRecentlySeen,
  readBudget,
} from './budget';
import type {
  NotificationBackend,
  NotificationCategory,
  NotificationDispatchResult,
  NotificationLogEntry,
  NotificationSpec,
} from './types';

export type {
  NotificationBackend,
  NotificationCategory,
  NotificationDispatchResult,
  NotificationLogEntry,
  NotificationSpec,
} from './types';
export { DEFAULT_BUDGET, readBudget, isMuted, isRecentlySeen } from './budget';

const ALLOWED_CATEGORIES: NotificationCategory[] = [
  'REMINDER',
  'PATTERN_ALERT',
  'CONTENT_DELIVERY',
];

// ──────────────────────────────────────────────────────────────────────────
// Module-level dispatcher state
// ──────────────────────────────────────────────────────────────────────────

interface DispatcherState {
  backend: NotificationBackend;
  store: Store | null;
  flushTimers: Map<string, ReturnType<typeof setTimeout>>;
  aggregator: ReturnType<typeof createAggregator> | null;
  windowMs: number;
}

const NOOP_BACKEND: NotificationBackend = {
  name: 'noop',
  deliver(spec) {
    console.log('[notify · noop]', spec.title, spec.dedupe_key);
    return undefined;
  },
  schedule(spec, fireAt) {
    console.log('[notify · noop · scheduled]', new Date(fireAt).toISOString(), spec.title);
    return undefined;
  },
  cancel(key) {
    console.log('[notify · noop · cancel]', key);
  },
};

const state: DispatcherState = {
  backend: NOOP_BACKEND,
  store: null,
  flushTimers: new Map(),
  aggregator: null,
  windowMs: DEFAULT_BUDGET.aggregation_window_ms,
};

/** Install the backend appropriate for the platform. Idempotent. */
export function installBackend(backend: NotificationBackend): void {
  state.backend = backend;
}

/** Wire the dispatcher to the app's store for budget / dedupe / logging. */
export function installStore(store: Store): void {
  state.store = store;
  rebuildAggregator();
  // Resume any scheduled notifications persisted across reloads.
  resumeScheduled();
}

function rebuildAggregator(): void {
  const budget = state.store ? readBudget(state.store) : DEFAULT_BUDGET;
  state.windowMs = budget.aggregation_window_ms;
  state.aggregator = createAggregator(state.windowMs, {
    now: () => Date.now(),
    scheduleFlush: (group, fireAt, flush) => {
      const t = setTimeout(flush, Math.max(0, fireAt - Date.now()));
      state.flushTimers.set(group, t);
    },
    cancelFlush: (group) => {
      const t = state.flushTimers.get(group);
      if (t) clearTimeout(t);
      state.flushTimers.delete(group);
    },
    deliver: (spec) => {
      void deliverNow(spec, /* alreadyAggregated */ true);
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Persistence for schedule_at across reloads
// ──────────────────────────────────────────────────────────────────────────

interface ScheduledRecord {
  spec: NotificationSpec;
  fireAt: number;
  /** platform-assigned id, if any (e.g. capacitor local-notif id). */
  platform_id?: string;
}

function readScheduled(): ScheduledRecord[] {
  if (!state.store) return [];
  return state.store.get<ScheduledRecord[]>('shared', '_notification_scheduled', []) ?? [];
}

function writeScheduled(list: ScheduledRecord[]): void {
  if (!state.store) return;
  state.store.set('shared', '_notification_scheduled', list);
}

const inProcessTimers = new Map<string, ReturnType<typeof setTimeout>>();

function resumeScheduled(): void {
  const list = readScheduled();
  const now = Date.now();
  const survivors: ScheduledRecord[] = [];
  for (const r of list) {
    if (r.fireAt <= now) {
      // Missed firing window while app was closed — deliver now via
      // immediate path. Backends that own native scheduling (Capacitor,
      // Electron) will have fired their own platform notification; this
      // covers the web fallback case.
      void deliverImmediate(r.spec);
    } else {
      survivors.push(r);
      scheduleInProcessTimer(r);
    }
  }
  writeScheduled(survivors);
}

function scheduleInProcessTimer(r: ScheduledRecord): void {
  const existing = inProcessTimers.get(r.spec.dedupe_key);
  if (existing) clearTimeout(existing);
  const delay = Math.max(0, r.fireAt - Date.now());
  const t = setTimeout(() => {
    inProcessTimers.delete(r.spec.dedupe_key);
    writeScheduled(readScheduled().filter((x) => x.spec.dedupe_key !== r.spec.dedupe_key));
    void deliverImmediate(r.spec);
  }, delay);
  inProcessTimers.set(r.spec.dedupe_key, t);
}

// ──────────────────────────────────────────────────────────────────────────
// Public notify() API
// ──────────────────────────────────────────────────────────────────────────

function coerceScheduleAt(s: NotificationSpec['schedule_at']): number | null {
  if (typeof s === 'number') return s;
  if (typeof s === 'string') {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function emitLogEvent(entry: NotificationLogEntry): void {
  // Don't emit on the bus by default — the log slice is the spine. If
  // future code wants to subscribe to "notification fired", add an
  // event entry to the registry.
  void entry;
}

async function deliverImmediate(spec: NotificationSpec): Promise<NotificationDispatchResult> {
  if (!state.backend) {
    return { delivered: false, reason: 'no-backend' };
  }
  try {
    const id = await state.backend.deliver(spec);
    return { delivered: true, platform_id: id ?? undefined };
  } catch (err) {
    console.error('[notify] backend deliver failed', err);
    return { delivered: false, reason: 'no-backend' };
  }
}

async function deliverNow(
  spec: NotificationSpec,
  alreadyAggregated = false,
): Promise<NotificationDispatchResult> {
  const result = await deliverImmediate(spec);
  if (state.store) {
    const entry: NotificationLogEntry = {
      ts: Date.now(),
      dedupe_key: spec.dedupe_key,
      category: spec.category,
      title: spec.title,
      delivered: result.delivered,
      reason: result.reason,
      aggregation_group: spec.aggregation_group,
    };
    appendLog(state.store, entry);
    emitLogEvent(entry);
  }
  if (!alreadyAggregated) {
    try {
      events.emit('notifications:delivered', {
        dedupe_key: spec.dedupe_key,
        category: spec.category,
        ts: Date.now(),
      });
    } catch { /* registry warning ok */ }
  }
  return result;
}

/**
 * Dispatch a notification. Honors:
 *   - dedupe (same dedupe_key within 24h → suppressed)
 *   - per-category mute
 *   - daily cap
 *   - aggregation window
 *   - schedule_at
 */
export async function notify(spec: NotificationSpec): Promise<NotificationDispatchResult> {
  // Constitutional check — the type system enforces at compile time, but
  // belt-and-braces at runtime since brain-dump routing may produce
  // arbitrary strings.
  if (!ALLOWED_CATEGORIES.includes(spec.category)) {
    console.warn('[notify] illegal category', spec.category, '— dropping');
    return { delivered: false, reason: 'muted' };
  }

  if (!spec.dedupe_key) {
    console.warn('[notify] missing dedupe_key — dropping');
    return { delivered: false, reason: 'dedupe' };
  }

  const now = Date.now();
  const fireAt = coerceScheduleAt(spec.schedule_at);

  if (state.store) {
    // Consent rewrite (Sprint 6): the per-feature consent.astrology
    // gate is gone. Astrology is cut from the launch surface (only
    // reachable via the ?astrology=1 URL gate). Daily-reading /
    // transit-ping features don't ship to alpha users, so no
    // per-feature delivery gate is needed here.

    if (isRecentlySeen(state.store, spec.dedupe_key, now)) {
      const entry: NotificationLogEntry = {
        ts: now,
        dedupe_key: spec.dedupe_key,
        category: spec.category,
        title: spec.title,
        delivered: false,
        reason: 'dedupe',
        aggregation_group: spec.aggregation_group,
      };
      appendLog(state.store, entry);
      return { delivered: false, reason: 'dedupe' };
    }

    const budget = readBudget(state.store);
    if (isMuted(budget, spec.category)) {
      appendLog(state.store, {
        ts: now,
        dedupe_key: spec.dedupe_key,
        category: spec.category,
        title: spec.title,
        delivered: false,
        reason: 'muted',
      });
      return { delivered: false, reason: 'muted' };
    }

    // Cap counts only delivered-today entries. Scheduled-for-future
    // doesn't count yet — it counts when it actually fires.
    if (fireAt === null || fireAt <= now) {
      const todayCount = countDeliveredToday(state.store, now);
      if (todayCount >= budget.daily_cap) {
        appendLog(state.store, {
          ts: now,
          dedupe_key: spec.dedupe_key,
          category: spec.category,
          title: spec.title,
          delivered: false,
          reason: 'budget',
        });
        return { delivered: false, reason: 'budget' };
      }
    }
  }

  // Future-scheduled: persist and let the platform OR fallback fire.
  // Credibility audit NC6: previously we scheduled BOTH the native
  // backend AND an in-process timer for the same fireAt — Capacitor /
  // Electron users got duplicate notifications. Now: if the backend
  // returns a truthy platformId, the native scheduler owns the fire;
  // we skip the in-process timer. Otherwise we keep the JS setTimeout
  // as a fallback.
  if (fireAt !== null && fireAt > now) {
    let platformId: string | undefined;
    try {
      const id = await state.backend.schedule(spec, fireAt);
      platformId = id ?? undefined;
    } catch (err) {
      console.error('[notify] backend schedule failed; falling back to in-process timer', err);
    }
    const record: ScheduledRecord = { spec, fireAt, platform_id: platformId };
    const list = readScheduled().filter((r) => r.spec.dedupe_key !== spec.dedupe_key);
    list.push(record);
    writeScheduled(list);
    // Only schedule the JS timer when the backend did NOT take ownership.
    if (!platformId) {
      scheduleInProcessTimer(record);
    }
    if (state.store) {
      appendLog(state.store, {
        ts: now,
        dedupe_key: spec.dedupe_key,
        category: spec.category,
        title: spec.title,
        delivered: false,
        reason: 'scheduled',
      });
    }
    return { delivered: false, reason: 'scheduled' };
  }

  // Aggregation: if the spec carries an explicit aggregation_group,
  // it enters the buffer. Otherwise, deliver immediately.
  if (spec.aggregation_group && state.aggregator) {
    state.aggregator.enqueue(spec);
    if (state.store) {
      appendLog(state.store, {
        ts: now,
        dedupe_key: spec.dedupe_key,
        category: spec.category,
        title: spec.title,
        delivered: false,
        reason: 'aggregated',
        aggregation_group: spec.aggregation_group,
      });
    }
    return { delivered: false, reason: 'aggregated' };
  }

  return deliverNow(spec);
}

/** Cancel a scheduled or sticky notification by dedupe_key. */
export function cancel(dedupeKey: string): void {
  const t = inProcessTimers.get(dedupeKey);
  if (t) clearTimeout(t);
  inProcessTimers.delete(dedupeKey);

  const list = readScheduled();
  const next = list.filter((r) => r.spec.dedupe_key !== dedupeKey);
  if (next.length !== list.length) writeScheduled(next);

  try { void state.backend.cancel(dedupeKey); }
  catch (err) { console.error('[notify] backend cancel failed', err); }
}

/** Attach cancel as a property on notify, matching the spec sketch. */
notify.cancel = cancel;

/** Test helper — drop all in-process state. Not for production use. */
export function _resetForTests(): void {
  for (const t of inProcessTimers.values()) clearTimeout(t);
  inProcessTimers.clear();
  for (const t of state.flushTimers.values()) clearTimeout(t);
  state.flushTimers.clear();
  state.backend = NOOP_BACKEND;
  state.store = null;
  state.aggregator = null;
}

/** Test helper — force-flush all aggregator buffers now. */
export function _flushAggregator(): void {
  state.aggregator?.flushAll();
}

/** Read-only view of the in-process state for debugging. */
export function _inspect(): { backend: string; scheduledCount: number; bufferedCount: number } {
  return {
    backend: state.backend.name,
    scheduledCount: inProcessTimers.size,
    bufferedCount: state.aggregator?.size() ?? 0,
  };
}
