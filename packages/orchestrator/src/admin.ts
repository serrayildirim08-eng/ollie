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
/** A recurring decision counts as "stale" once it's been open this many days. */
const STALE_DECISION_DAYS = 14;

// ── Wave 2 · renewal 3-tier escalation thresholds ────────────────────────────
// One renewal climbs through three tiers as its due date nears. Each tier fires
// AT MOST ONCE (gated on prevKeys / a persisted marker on the native side), so a
// re-run of recompute never re-notifies or re-adds.
//   • ≤ 90d (~3 months) → a calm CARD noticing only (the wave-1 add-to-todo
//     offer). No push. [tier 'card']
//   • ≤ 30d (~1 month)  → emit admin:renewal_notify_due so the native consumer
//     schedules a real app-closed LOCAL notification (EVENT path). [tier 'notify']
//   • ≤  7d (~1 week)   → emit admin:renewal_autotodo_due so the native consumer
//     AUTO-adds the renewal to /todo — no offer, no tap (the one place we go D,
//     because a week-out ID/legal renewal is too important to wait on). [tier 'auto']
const RENEWAL_TIER_CARD_DAYS = 90;
const RENEWAL_TIER_NOTIFY_DAYS = 30;
const RENEWAL_TIER_AUTO_DAYS = 7;

// ── Wave 2 · paperwork piling (offer) ────────────────────────────────────────
/** A paperwork task counts as "stalled" once untouched this many days. */
const PAPERWORK_PILE_DAYS = 14;
/** Pile only fires once this many paperwork tasks have stalled together. */
const PAPERWORK_PILE_MIN = 3;

// ── Wave 2 · renewal cluster (offer) ─────────────────────────────────────────
/** Cluster fires once this many renewals land in the same calendar month. */
const RENEWAL_CLUSTER_MIN = 2;
/** Only cluster renewals whose due date is within this horizon. */
const RENEWAL_CLUSTER_HORIZON_DAYS = 90;

// NOTE — CHRONIC DEFERRAL (break_down_task offer) is detected NATIVE-side, not
// here. Its true signal is the per-noticing postpone count in the native SQLite
// brain_deferral_events table (defer_count is never persisted on admin rows, and
// the orchestrator can't read native SQLite). See
// apps/native/src/modules/brain/noticings.ts (appendChronicDeferrals).

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

    // ── C-model · renewal 3-TIER escalation (wave 2) ────────────────────────
    // Replaces the wave-1 single renewal offer. For each open renewal with a
    // valid due date, escalate by proximity (each tier fires once):
    //
    //   • ≤ 90d → a calm CARD noticing carrying the add_admin_task offer
    //     ("renew X — add it to your to-do?"). No push. Stable pattern id keyed
    //     on the renewal id so snooze/dismiss persists. This is the wave-1
    //     surface, now stamped with tier:'card'.
    //   • ≤ 30d → ALSO emit admin:renewal_notify_due so the native consumer
    //     schedules a real app-closed local notification (the EVENT path, never
    //     invoke). The orchestrator itself can't notify (no native dep), so it
    //     only emits; the native side performs + dedupes.
    //   • ≤ 7d  → emit admin:renewal_autotodo_due so the native consumer AUTO-
    //     adds the renewal to /todo (no card, no offer — the one tier-D place).
    //
    // The card horizon stays at ≤ 90d INCLUSIVE of the nearer tiers so the user
    // always has the calm card visible while the notify/auto side-effects fire.
    // Reads the bridge-mirrored admin.renewals input (raw rows). The two new
    // signals are gated on prevKeys here AND a persisted marker on the native
    // side, so re-running recompute never double-notifies or double-adds.
    const adminRenewals = store.get<StoreRenewal[]>('admin', 'renewals', []) ?? [];
    for (const r of adminRenewals) {
      if (!r || typeof r.id !== 'string') continue;
      const d = daysUntilDue(r.dueDate, now);
      if (d == null || d < 0 || d > RENEWAL_TIER_CARD_DAYS) continue;

      // Tier C/auto — ≤ 7d: automatic /todo add (no card). Native consumer owns
      // the side effect + its own "already added" marker; we just emit once.
      if (d <= RENEWAL_TIER_AUTO_DAYS) {
        const autoP = toPattern(
          {
            signal: 'admin_renewal_autotodo',
            pattern: `renewal-autotodo:${r.id}`,
            ts: now,
          },
          now,
        );
        if (!prevKeys.has(signalKey(autoP))) {
          events.emit('admin:renewal_autotodo_due', {
            renewal_id: r.id,
            renewalType: r.renewalType,
            dueDate: r.dueDate,
            ts: now,
          });
        }
        // Track the auto tier in `next` (no copy → not a surfaced noticing) so
        // signalKey dedupe persists across recomputes.
        next.push(autoP);
        continue; // a week-out renewal is handled by the auto-add, not a card.
      }

      // Tier 'notify' — ≤ 30d: emit so the native consumer schedules a real
      // app-closed local notification. Gated once via a no-copy marker pattern.
      const tier: 'card' | 'notify' = d <= RENEWAL_TIER_NOTIFY_DAYS ? 'notify' : 'card';
      if (tier === 'notify') {
        const notifyP = toPattern(
          {
            signal: 'admin_renewal_notify',
            pattern: `renewal-notify:${r.id}`,
            ts: now,
          },
          now,
        );
        if (!prevKeys.has(signalKey(notifyP))) {
          events.emit('admin:renewal_notify_due', {
            renewal_id: r.id,
            renewalType: r.renewalType,
            dueDate: r.dueDate,
            days_left: d,
            ts: now,
          });
        }
        next.push(notifyP);
      }

      // Tier 'card' surface — always shown ≤ 90d (including the notify band):
      // the calm add-to-todo offer.
      const months = Math.max(1, Math.round(d / 30));
      const p = toPattern(
        {
          signal: 'admin_renewal_offer',
          pattern: `renewal-offer:${r.id}`,
          category: 'renewal_due',
          tier,
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
        events.emit('admin:renewal_offer', { renewal_id: r.id, days_left: d, tier, ts: now });
      }
    }

    // ── C-model offer · paperwork piling → surface_tasks (wave 2) ───────────
    // ≥3 open admin tasks of kind 'paperwork' each untouched ~2 weeks (by
    // last_transition_at, falling back to created_at) → ONE calm offer to bring
    // them to today's focus. Accept → native executeAction surface_tasks dates
    // each to today so they lead /todo. taskIds is an ARRAY offer fact (new
    // plumbing in noticings.ts factsOf). Stable pattern id (category-keyed) so
    // the offer persists across recomputes until acted on.
    const stalledPaperwork: string[] = [];
    for (const t of history.tasks ?? []) {
      if (!t || typeof t.id !== 'string') continue;
      if (t.kind !== 'paperwork') continue;
      if (t.state === 'done' || t.state === 'closed') continue;
      const touchedAt = typeof t.last_transition_at === 'number'
        ? t.last_transition_at
        : (typeof t.done_at === 'number' ? t.done_at : now);
      const ageDays = (now - touchedAt) / DAY_MS;
      if (ageDays >= PAPERWORK_PILE_DAYS) stalledPaperwork.push(t.id);
    }
    if (stalledPaperwork.length >= PAPERWORK_PILE_MIN) {
      const others = stalledPaperwork.length - 1;
      const p = toPattern(
        {
          signal: 'admin_paperwork_pile',
          pattern: 'paperwork-pile',
          category: 'paperwork_piling',
          copy: `${stalledPaperwork.length} admin things haven't moved in a while — bring them to today's focus?`,
          actionKind: 'surface_tasks',
          taskIds: stalledPaperwork,
          // carried so the copy fallback can say "N admin things" via otherCount.
          items: stalledPaperwork.map(() => ({ name: 'paperwork', count: others })),
        },
        now,
      );
      next.push(p);
      if (!prevKeys.has(signalKey(p))) {
        events.emit('admin:paperwork_pile', { count: stalledPaperwork.length, ts: now });
      }
    }

    // ── C-model offer · renewal cluster → batch_block (wave 2) ──────────────
    // 2+ open renewals whose due dates fall in the SAME calendar month (within
    // ~3 months) → ONE calm offer to batch them one day + schedule an app-closed
    // reminder. Accept → native executeAction batch_block creates a dated block
    // task AND schedules the local notification via the EVENT path. renewalIds
    // is an ARRAY offer fact + batchFireAtMs a NUMERIC offer fact (new plumbing).
    // Stable pattern id keyed on the month bucket. Grouped from the same
    // adminRenewals already read above.
    const byMonth = new Map<string, StoreRenewal[]>();
    for (const r of adminRenewals) {
      if (!r || typeof r.id !== 'string' || !r.dueDate) continue;
      const d = daysUntilDue(r.dueDate, now);
      if (d == null || d < 0 || d > RENEWAL_CLUSTER_HORIZON_DAYS) continue;
      const monthKey = r.dueDate.slice(0, 7); // yyyy-mm
      if (!/^\d{4}-\d{2}$/.test(monthKey)) continue;
      const bucket = byMonth.get(monthKey) ?? [];
      bucket.push(r);
      byMonth.set(monthKey, bucket);
    }
    for (const [monthKey, group] of byMonth) {
      if (group.length < RENEWAL_CLUSTER_MIN) continue;
      // Fire the reminder a week before the EARLIEST renewal in the month, but
      // never in the past — scheduleAt clamps anyway, and a same-day fire is a
      // valid (if tight) batch reminder.
      const earliestDue = group
        .map((r) => Date.parse(r.dueDate ?? ''))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b)[0];
      const fireAt = Number.isFinite(earliestDue)
        ? Math.max(now, earliestDue - 7 * DAY_MS)
        : now;
      const types = group.map((r) => r.renewalType).filter(Boolean);
      const batchLabel = `renewals: ${types.join(', ')}`;
      const p = toPattern(
        {
          signal: 'admin_renewal_cluster',
          pattern: `renewal-cluster:${monthKey}`,
          category: 'renewal-cluster',
          copy: `${group.length} renewals land around the same time — batch them one day?`,
          actionKind: 'batch_block',
          batchLabel,
          batchFireAtMs: fireAt,
          renewalIds: group.map((r) => r.id),
        },
        now,
      );
      next.push(p);
      if (!prevKeys.has(signalKey(p))) {
        events.emit('admin:renewal_cluster', {
          month: monthKey,
          count: group.length,
          ts: now,
        });
      }
    }

    // ── CHRONIC DEFERRAL → break_down_task is detected NATIVE-side ──────────
    // Its honest signal is the per-noticing POSTPONE count (the user actively
    // putting a noticing off), logged in the native SQLite brain_deferral_events
    // table — defer_count is never persisted on admin rows, and the orchestrator
    // can't read native SQLite. So the chronic-deferral offer is synthesized in
    // apps/native/src/modules/brain/noticings.ts (appendChronicDeferrals), which
    // attaches actionKind:'break_down_task'. Nothing to emit here.

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
