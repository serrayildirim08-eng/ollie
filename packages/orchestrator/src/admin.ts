/**
 * @ollie/orchestrator · admin
 *
 * Boots on app load. The only caller of @ollie/logic/admin detectors.
 * UI reads derived keys from the store — it never calls logic directly.
 *
 * Derived keys written (namespace: "admin"):
 *   patterns                AdminPattern[]  collected signals from A1–A15
 *   patternsLastComputedAt  number          wall-clock ts of last run
 *   phoneTasks              PhoneTaskItem[] "things to handle by phone" cluster,
 *                                           append-only, fed by admin:phone_task_detected
 *
 * Events emitted:
 *   admin:open_loop_missing     — A1 signal for a new dump
 *   admin:phone_task_detected   — A2 signal
 *   admin:renewal_cue           — A3 signal for a task
 *   admin:stale_ball            — A9 signal
 *   admin:activation_classified — A11 signal
 *   admin:last_5pct             — A12 signal
 *   admin:paperwork_split       — A4 signal
 *   admin:firehose_dump         — A5 signal
 *   admin:defer_chain           — A6 signal
 *   admin:two_minute_tasks      — A8 signal
 *   admin:recurring_pattern     — A10 signal
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import {
  detectOpenLoopMissing,
  detectPhoneTask,
  scheduleRenewalCues,
  detectStaleBall,
  detectLast5Pct,
  detectPaperworkSplit,
  detectFirehoseDump,
  detectDeferChain,
  detectTwoMinuteTask,
  detectRecurringPattern,
} from '@ollie/logic/admin';
import type {
  AdminTask,
  DumpEntry,
  AdminHistory,
  OpenLoopSignal,
  PhoneTaskSignal,
  RenewalCueSignal,
  StaleBallSignal,
  Last5PctSignal,
  PaperworkSplitSignal,
  PaperworkSplitExistingSignal,
  FirehoseDumpSignal,
  DeferChainSignal,
  TwoMinuteTaskSignal,
  RecurringPatternSignal,
} from '@ollie/logic/admin';
import type { Orchestrator } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminPattern = { signal: string; pattern: string; ts: number } & Record<string, any>;

/**
 * One entry in the admin "handle by phone" cluster. Append-only — written by
 * the admin:phone_task_detected consumer wired in init(). The UI reads
 * `admin.phoneTasks` to render the phone-task grouping badge. Deduped by
 * `id` (`${verb}:${ts}`).
 */
export interface PhoneTaskItem {
  id: string;
  verb: string;
  ts: number;
}

/** Hard cap on the phoneTasks cluster — keeps the store slice bounded. */
const PHONE_TASKS_CAP = 50;

export interface AdminOrchestratorOptions {
  /** Injected for tests; defaults to Date.now */
  now?: () => number;
}

export function createAdminOrchestrator(
  store: Store,
  opts: AdminOrchestratorOptions = {},
): Orchestrator {
  const nowFn = opts.now ?? (() => Date.now());
  let initialized = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubs: Unsubscribe[] = [];

  // ── helpers ──────────────────────────────────────────────────────────────

  function getTasks(): AdminTask[] {
    return store.get<AdminTask[]>('admin', 'tasks', []) ?? [];
  }

  function getDumps(): DumpEntry[] {
    return store.get<DumpEntry[]>('dump', 'items', []) ?? [];
  }

  function buildHistory(now: number): AdminHistory {
    return {
      now,
      tasks: getTasks(),
      dumps: getDumps(),
    };
  }

  // ── pattern identity ──────────────────────────────────────────────────────

  /**
   * Canonical, UI-facing pattern id derived from a detector's `signal` field.
   * Detectors tag with snake_case `admin_*` signals; the admin UI keys on a
   * hyphenated `pattern` field with the `admin_` prefix stripped
   * (e.g. `admin_stale_ball` → `stale-ball`). We derive `pattern` here so the
   * patterns slice carries one stable identity per notice — the UI dismiss
   * logic depends on it.
   */
  function patternFromSignal(signal: string): string {
    return signal.replace(/^admin_/, '').replace(/_/g, '-');
  }

  /**
   * Returns a stable key for a pattern object so we can dedup against the
   * existing patterns slice without object identity. Keyed on the canonical
   * `pattern` id plus a per-notice discriminator (task/dump id) so distinct
   * notices never collapse into one key.
   */
  function signalKey(s: AdminPattern): string {
    const base = (s['pattern'] as string | undefined)
      ?? patternFromSignal((s['signal'] as string | undefined) ?? '');
    if (typeof s['task_id'] === 'string') return `${base}:${s['task_id']}`;
    if (typeof s['dump_id'] === 'string') return `${base}:${s['dump_id']}`;
    if (typeof s['rule_id'] === 'string') return `${base}:${s['rule_id']}`;
    if (typeof s['category'] === 'string') return `${base}:${s['category']}`;
    return base;
  }

  /**
   * Safely coerce any detector signal object to AdminPattern via unknown.
   * Always stamps a canonical `pattern` id derived from `signal`, and a `ts`
   * when one is missing. `signal` is preserved for registry/event parity.
   */
  function toPattern(s: unknown, extraTs?: number): AdminPattern {
    const obj = { ...(s as Record<string, unknown>) };
    const signal = typeof obj['signal'] === 'string' ? (obj['signal'] as string) : '';
    if (typeof obj['pattern'] !== 'string') {
      obj['pattern'] = patternFromSignal(signal);
    }
    if (extraTs !== undefined && typeof obj['ts'] !== 'number') {
      obj['ts'] = extraTs;
    }
    return obj as AdminPattern;
  }

  // ── recompute ─────────────────────────────────────────────────────────────

  function recomputePatterns(): void {
    const now = nowFn();
    const history = buildHistory(now);

    const prev = store.get<AdminPattern[]>('admin', 'patterns', []) ?? [];
    const prevKeys = new Set(prev.map(signalKey));

    const next: AdminPattern[] = [];

    // A1
    const openLoops = detectOpenLoopMissing(history, { now });
    if (openLoops) {
      for (const s of openLoops) {
        const p = toPattern(s);
        next.push(p);
        if (!prevKeys.has(signalKey(p))) {
          events.emit('admin:open_loop_missing', { dump_id: s.dump_id, ts: s.ts });
        }
      }
    }

    // A2 — run on each dump entry's text
    for (const d of history.dumps ?? []) {
      const s: PhoneTaskSignal | null = detectPhoneTask(d);
      if (s) {
        const p = toPattern({ ...s, ts: d.ts });
        next.push(p);
        if (!prevKeys.has(signalKey(p))) {
          events.emit('admin:phone_task_detected', { verb: s.verb, ts: d.ts });
        }
      }
    }

    // A3
    const renewals = scheduleRenewalCues(history, { now });
    if (renewals) {
      for (const s of renewals) {
        const p = toPattern(s);
        next.push(p);
        if (!prevKeys.has(signalKey(p))) {
          events.emit('admin:renewal_cue', {
            task_id: s.task_id,
            stage: s.stage,
            days_left: s.days_left,
            ts: s.ts,
          });
        }
      }
    }

    // A4
    const paperworkResult = detectPaperworkSplit(history, { now });
    if (paperworkResult) {
      if (Array.isArray(paperworkResult)) {
        for (const s of paperworkResult as PaperworkSplitExistingSignal[]) {
          const p = toPattern({ ...s, ts: now });
          next.push(p);
          if (!prevKeys.has(signalKey(p))) {
            events.emit('admin:paperwork_split', { task_id: s.task_id, ts: now });
          }
        }
      } else {
        const s = paperworkResult as PaperworkSplitSignal;
        const p = toPattern({ ...s, ts: now });
        next.push(p);
        if (!prevKeys.has(signalKey(p))) {
          events.emit('admin:paperwork_split', { dump_match: true, ts: now });
        }
      }
    }

    // A5
    const firehose = detectFirehoseDump(history, { now });
    if (firehose) {
      const p = toPattern({ ...firehose, ts: now });
      next.push(p);
      if (!prevKeys.has(signalKey(p))) {
        events.emit('admin:firehose_dump', {
          candidate_count: firehose.candidate_items?.length ?? 0,
          ts: now,
        });
      }
    }

    // A6
    const deferChains = detectDeferChain(history, { now });
    if (deferChains) {
      for (const s of deferChains) {
        const p = toPattern(s);
        next.push(p);
        if (!prevKeys.has(signalKey(p))) {
          events.emit('admin:defer_chain', {
            task_id: s.task_id,
            defer_count: s.defer_count,
            ts: now,
          });
        }
      }
    }

    // A8
    const twoMin = detectTwoMinuteTask(history, { now });
    if (twoMin) {
      const p = toPattern({ ...twoMin, ts: now });
      next.push(p);
      if (!prevKeys.has(signalKey(p))) {
        events.emit('admin:two_minute_tasks', {
          count: twoMin.count,
          batch: twoMin.batch,
          ts: now,
        });
      }
    }

    // A9
    const staleBalls = detectStaleBall(history, { now });
    if (staleBalls) {
      for (const s of staleBalls) {
        const p = toPattern(s);
        next.push(p);
        if (!prevKeys.has(signalKey(p))) {
          events.emit('admin:stale_ball', {
            task_id: s.task_id,
            kind: s.kind,
            days_overdue: s.days_overdue,
            ts: s.ts,
          });
        }
      }
    }

    // A10
    const recurring = detectRecurringPattern(history, { now });
    if (recurring) {
      for (const s of recurring as RecurringPatternSignal[]) {
        const p = toPattern(s);
        next.push(p);
        if (!prevKeys.has(signalKey(p))) {
          events.emit('admin:recurring_pattern', {
            category_or_label: s.category_or_label,
            predicted_next_ts: s.predicted_next_ts,
            ts: now,
          });
        }
      }
    }

    // A12
    const last5Pct = detectLast5Pct(history, { now });
    if (last5Pct) {
      for (const s of last5Pct) {
        const p = toPattern(s);
        next.push(p);
        if (!prevKeys.has(signalKey(p))) {
          events.emit('admin:last_5pct', {
            task_id: s.task_id,
            days_since_done: s.days_since_done,
            ts: s.ts,
          });
        }
      }
    }

    store.set('admin', 'patterns', next);
    store.set('admin', 'patternsLastComputedAt', now);
  }

  // ── Sprint 3 / D1+D2 · appointment-completed transitions ─────────────────
  //
  // Fires `admin:appointment_completed` whenever a task transitions to
  // state='done' or 'closed'. Marks the kind as 'doctor' when the task's
  // label/text matches a doctor/dr/clinic regex — burhan upgrades that
  // to canopy_fruit (life event > leaf event).

  const DOCTOR_RE = /\b(doctor|dr\.|dr |clinic|gp|optometrist|dentist|gyno|cardio|derma)\b/i;
  const APPT_RE = /\bappointment\b/i;

  function detectAppointmentTransitions(): void {
    const tasks = getTasks() as Array<{
      id?: string;
      label?: string;
      text?: string;
      state?: string;
      done_at?: number;
      closed_at?: number;
    }>;
    const seen = store.get<string[]>('admin', '_appointmentCompletedIds', []) ?? [];
    const seenSet = new Set(seen);
    const newlyFired: string[] = [];
    for (const t of tasks) {
      if (!t?.id) continue;
      const isClosed = t.state === 'done' || t.state === 'closed';
      if (!isClosed) continue;
      if (seenSet.has(t.id)) continue;
      const text = `${t.label ?? ''} ${t.text ?? ''}`;
      // Only fire for appointment-like tasks. Other closed tasks are noise.
      if (!APPT_RE.test(text) && !DOCTOR_RE.test(text)) continue;
      const ts = t.done_at ?? t.closed_at ?? nowFn();
      const kind: 'doctor' | 'appointment' = DOCTOR_RE.test(text) ? 'doctor' : 'appointment';
      try {
        events.emit('admin:appointment_completed', { task_id: t.id, kind, ts });
      } catch { /* non-fatal */ }
      newlyFired.push(t.id);
    }
    if (newlyFired.length) {
      store.set('admin', '_appointmentCompletedIds', [...seen, ...newlyFired]);
    }
  }

  // ── debounce ──────────────────────────────────────────────────────────────

  function schedule(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      recomputePatterns();
    }, 500);
  }

  // ── braindump handler ─────────────────────────────────────────────────────

  function onBraindump(): void {
    schedule();
  }

  // ── admin:phone_task_detected consumer ────────────────────────────────────
  //
  // recomputePatterns() emits admin:phone_task_detected for each newly seen
  // A2 signal. This consumer is the canonical sink: it appends the signal to
  // the `admin.phoneTasks` cluster the UI reads. Append-only, deduped by
  // `${verb}:${ts}`, capped at PHONE_TASKS_CAP (newest kept).
  function onPhoneTaskDetected(raw: unknown): void {
    try {
      const p = (raw ?? {}) as { verb?: unknown; ts?: unknown };
      const verb = typeof p.verb === 'string' ? p.verb : '';
      const ts = typeof p.ts === 'number' ? p.ts : nowFn();
      if (!verb) return;
      const id = `${verb}:${ts}`;
      const existing = store.get<PhoneTaskItem[]>('admin', 'phoneTasks', []) ?? [];
      if (existing.some((t) => t.id === id)) return;
      const next = [...existing, { id, verb, ts }]
        .sort((a, b) => a.ts - b.ts)
        .slice(-PHONE_TASKS_CAP);
      store.set('admin', 'phoneTasks', next);
    } catch (err) {
      console.error('[orchestrator/admin] phone_task_detected sink failed', err);
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  function init(): void {
    if (initialized) return;
    initialized = true;

    unsubs.push(store.subscribeKey('admin', 'tasks', () => {
      schedule();
      try { detectAppointmentTransitions(); }
      catch (err) { console.error('[orchestrator/admin] appointment transition failed', err); }
    }));
    unsubs.push(store.subscribeKey('dump', 'items', () => schedule()));
    unsubs.push(events.on('void:braindump:submitted', onBraindump));
    unsubs.push(events.on('admin:phone_task_detected', onPhoneTaskDetected));

    recomputePatterns();
    try { detectAppointmentTransitions(); } catch { /* non-fatal */ }
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => fn());
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    initialized = false;
  }

  return { init, teardown };
}
