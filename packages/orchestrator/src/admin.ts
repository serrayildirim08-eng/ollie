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
  // Phase 3 (A7/A11/A13/A14/A15) — wired below in recomputePatterns().
  surfaceCostOfDelay,
  efStateFromDump,
  sortByState,
  detectRecurringDecision,
  getDocRefs,
  detectScheduleDrift,
} from '@ollie/logic/admin';
import type {
  AdminTask,
  DumpEntry,
  AdminHistory,
  AdminState,
  PhoneTaskSignal,
  PaperworkSplitSignal,
  PaperworkSplitExistingSignal,
  RecurringPatternSignal,
} from '@ollie/logic/admin';
import type { Orchestrator } from './types';
import { appendCapped } from './dedup-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminPattern = { signal: string; pattern: string; ts: number } & Record<string, any>;

// ── C-model offer detectors (renewal + stale decision) ───────────────────────
const DAY_MS = 86_400_000;
/** Surface a renewal once it's within this many days of its due date. */
const RENEWAL_OFFER_HORIZON_DAYS = 90;
/** A recurring decision counts as "stale" once it's been open this many days. */
const STALE_DECISION_DAYS = 14;

/** Minimal renewal shape mirrored to admin.renewals by the native bridge. */
interface StoreRenewal {
  id: string;
  renewalType: string;
  /** ISO yyyy-mm-dd or null. */
  dueDate: string | null;
  addedAt: number;
}

/** Minimal recurring-decision shape mirrored to admin.decisions by the bridge. */
interface StoreDecision {
  id: string;
  what: string;
  createdAt: number;
}

/**
 * Whole-day difference between an ISO yyyy-mm-dd due date and `now`. Negative =
 * overdue, null = no/invalid date. Local copy of the native admin `daysUntil`
 * (not exported from @ollie/logic/admin) to keep the orchestrator free of a
 * native dependency. Compares at local-midnight granularity.
 */
function daysUntilDue(dueDate: string | null, now: number): number | null {
  if (!dueDate) return null;
  const due = Date.parse(dueDate);
  if (Number.isNaN(due)) return null;
  return Math.floor(due / DAY_MS) - Math.floor(now / DAY_MS);
}

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

  /**
   * admin.state holds the A13/A15 capture slices (decision_rules,
   * scheduled_log). Native does not persist these yet (flagged in
   * apps/native/src/modules/admin/bridge.ts) — so the Phase-3 recall + drift
   * detectors run on whatever is present, usually empty. Reading defensively.
   */
  function getAdminState(): AdminState {
    return store.get<AdminState>('admin', 'state', {}) ?? {};
  }

  /** Most-recent dump text — the EF-state + recurring-decision cue source. */
  function latestDumpText(dumps: DumpEntry[]): string {
    let newest: DumpEntry | null = null;
    for (const d of dumps) {
      if (!d) continue;
      if (!newest || (typeof d.ts === 'number' && d.ts > (newest.ts ?? 0))) newest = d;
    }
    return (newest?.text ?? newest?.rawText ?? '').toString();
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

    // ── Phase 3 (A7/A11/A13/A14/A15) ────────────────────────────────────────
    // These were coded + exported in @ollie/logic/admin/phase3 but never
    // called here (the audit's "Phase 3 not wired"). Wired below with their
    // real inputs. Several depend on capture fields native does not persist
    // yet (ef_cost / cost_of_delay / decision_rules / scheduled_log) — those
    // degrade to no-op on absence rather than fabricating data.
    const adminState = getAdminState();
    const dumpText = latestDumpText(history.dumps ?? []);
    const opts = { now, consent: true };

    // A7 — cost-of-delay: surface the stored cost on any task deferred ≥2× or
    // past its scheduled_at. Per-task; null when the task carries no
    // cost_of_delay (native rows currently don't).
    for (const t of history.tasks ?? []) {
      const cod = surfaceCostOfDelay(t, opts);
      if (!cod) continue;
      const p = toPattern(
        { signal: 'admin_cost_of_delay', task_id: cod.task_id, copy: cod.copy, copy_es: cod.copy_es },
        now,
      );
      next.push(p);
      if (!prevKeys.has(signalKey(p))) {
        events.emit('admin:cost_of_delay', { task_id: cod.task_id, ts: now });
      }
    }

    // A11 — EF scaffolding: when the latest dump signals an EF state, surface
    // the tasks that fit it (sorted ascending by EF cost). One notice carrying
    // the doable shortlist; only when the dump actually reads as a non-default
    // (crash/low/peak) state, so we don't nag on every recompute.
    if (dumpText) {
      const efState = efStateFromDump(dumpText);
      const doable = sortByState(history.tasks ?? [], efState, opts);
      if (efState !== 3 && doable.length > 0) {
        const titles = doable.slice(0, 3).map((t) => t.title ?? t.label ?? '').filter(Boolean);
        const p = toPattern(
          {
            signal: 'admin_ef_scaffold',
            ef_state: efState,
            task_ids: doable.map((t) => t.id),
            copy: `given where you're at, these fit: ${titles.join(', ')}.`,
            copy_es: `por cómo estás ahora, estas encajan: ${titles.join(', ')}.`,
          },
          now,
        );
        next.push(p);
        if (!prevKeys.has(signalKey(p))) {
          events.emit('admin:ef_scaffold', { ef_state: efState, count: doable.length, ts: now });
        }
      }
    }

    // A13 — recurring-decision recall: cross-reference the latest dump against
    // stored decision rules (admin.state.decision_rules). Null when there are
    // no rules (native doesn't capture them yet) or no topic overlap.
    if (dumpText) {
      const recall = detectRecurringDecision(dumpText, adminState, opts);
      if (recall) {
        const p = toPattern(
          {
            signal: 'admin_decision_recall',
            rule_id: recall.rule_id,
            topic_key: recall.topic_key,
            choice: recall.choice,
            copy: recall.copy,
            copy_es: recall.copy_es,
          },
          now,
        );
        next.push(p);
        if (!prevKeys.has(signalKey(p))) {
          events.emit('admin:decision_recall', { rule_id: recall.rule_id, ts: now });
        }
      }
    }

    // A14 — doc refs: surface that a task has attached document references so
    // the user doesn't re-hunt for them. Per-task; empty when no doc_refs
    // (native rows don't persist them yet).
    for (const t of history.tasks ?? []) {
      const refs = getDocRefs(t);
      if (refs.length === 0) continue;
      const labels = refs.map((r) => r.label).join(', ');
      const p = toPattern(
        {
          signal: 'admin_doc_refs',
          task_id: t.id,
          doc_refs: refs,
          copy: `docs you saved for this: ${labels}.`,
          copy_es: `documentos que guardaste para esto: ${labels}.`,
        },
        now,
      );
      next.push(p);
      if (!prevKeys.has(signalKey(p))) {
        events.emit('admin:doc_refs', { task_id: t.id, count: refs.length, ts: now });
      }
    }

    // A15 — schedule drift: categories scheduled ≥N times without being done
    // (the ADHD "scheduling = doing" illusion). Reads admin.state.scheduled_log
    // (native doesn't capture it yet → empty → no drift).
    const drifts = detectScheduleDrift(adminState, opts);
    for (const d of drifts) {
      const p = toPattern(
        {
          signal: 'admin_schedule_drift',
          category: d.category,
          drift_count: d.drift_count,
          task_ids: d.task_ids,
          copy: d.copy,
          copy_es: d.copy_es,
        },
        now,
      );
      next.push(p);
      if (!prevKeys.has(signalKey(p))) {
        events.emit('admin:schedule_drift', { category: d.category, ts: now });
      }
    }

    // ── C-model offer · renewal approaching → add_admin_task ────────────────
    // For each open renewal due within ~3 months, surface ONE calm offer:
    // "renew X — add it to your to-do?". Accepting it creates an admin task
    // (native executeAction → add_admin_task) so it lands in /todo. Reads the
    // bridge-mirrored admin.renewals input (raw rows; not the patterns output).
    // category 'renewal_due' → copyKindOf maps to 'deadline' (protected); the
    // offer phrasing comes from the attached actionKind. Stable pattern id keyed
    // on the renewal id so snooze/dismiss persists across recomputes.
    const adminRenewals = store.get<StoreRenewal[]>('admin', 'renewals', []) ?? [];
    for (const r of adminRenewals) {
      if (!r || typeof r.id !== 'string') continue;
      const d = daysUntilDue(r.dueDate, now);
      if (d == null || d < 0 || d > RENEWAL_OFFER_HORIZON_DAYS) continue;
      const months = Math.max(1, Math.round(d / 30));
      const p = toPattern(
        {
          signal: 'admin_renewal_offer',
          pattern: `renewal-offer:${r.id}`,
          category: 'renewal_due',
          copy: `${r.renewalType} renews in ~${months} month${months === 1 ? '' : 's'} — add it to your to-do?`,
          actionKind: 'add_admin_task',
          taskText: `renew ${r.renewalType}`,
          dueDate: r.dueDate,
          urgencyAt: Date.parse(r.dueDate ?? '') || now,
        },
        now,
      );
      next.push(p);
      if (!prevKeys.has(signalKey(p))) {
        events.emit('admin:renewal_offer', { renewal_id: r.id, days_left: d, ts: now });
      }
    }

    // ── C-model offer · stale recurring decision → surface_decision ─────────
    // For each open decision left untouched > ~14 days, surface ONE calm offer:
    // "the X decision has been open ~2 weeks — bring it to today?". Accepting it
    // un-snoozes the decision (native executeAction → surface_decision) so it
    // leads /todo. Reads the bridge-mirrored admin.decisions input. No urgencyAt
    // (deferrable judgement, not time-critical); the selector scores it via
    // deferability. category 'pending_decision' → copyKindOf maps to 'decision'.
    const adminDecisions = store.get<StoreDecision[]>('admin', 'decisions', []) ?? [];
    for (const row of adminDecisions) {
      if (!row || typeof row.id !== 'string' || typeof row.createdAt !== 'number') continue;
      const ageDays = (now - row.createdAt) / DAY_MS;
      if (ageDays <= STALE_DECISION_DAYS) continue;
      const p = toPattern(
        {
          signal: 'admin_decision_stale',
          pattern: `decision-stale:${row.id}`,
          category: 'pending_decision',
          copy: `the ${row.what} decision has been open ~2 weeks — bring it to today?`,
          actionKind: 'surface_decision',
          decisionId: row.id,
          decisionWhat: row.what,
        },
        now,
      );
      next.push(p);
      if (!prevKeys.has(signalKey(p))) {
        events.emit('admin:decision_stale', { decision_id: row.id, ts: now });
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
      store.set('admin', '_appointmentCompletedIds', appendCapped([...seen], newlyFired));
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
    // C-model offer inputs — recompute when the bridge mirrors fresh renewals
    // or recurring decisions so the renewal / stale-decision offers stay live.
    unsubs.push(store.subscribeKey('admin', 'renewals', () => schedule()));
    unsubs.push(store.subscribeKey('admin', 'decisions', () => schedule()));
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
