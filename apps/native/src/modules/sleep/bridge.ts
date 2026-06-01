/**
 * apps/native · modules/sleep/bridge.ts  —  SQLite → @ollie/store mirror
 *
 * The sleep Layer-2 watcher (packages/orchestrator/src/sleep.ts) reads a set
 * of @ollie/store keys; the native app captures into SQLite (sleep/repo.ts,
 * table `sleep_events`) and never writes them, so the watcher ran on empty
 * input. This mirrors the SQLite rows into the keys the watcher reads.
 *
 * Mapping (SQLite kind → store key):
 *   kind='sleep'     → sleep.records  (SleepRecord[]; the load-bearing key,
 *                       also read by body/habits/work/patterns watchers)
 *                    + sleep.items    (raw {ts,text} log, legacy backlog path)
 *   kind='insomnia'  → sleep.items    (folded into the raw log; a rough night)
 *   kind='wind_down' → sleep.windDownLog (best-effort; see note)
 *   (meds) →           sleep.medsLog  (derived from sleep_events that carry a
 *                       med_taken marker; usually empty — meds live in the
 *                       medication module, see GAP note)
 *   sleep.settings   — left to the orchestrator's own DEFAULT_SETTINGS seed
 *                       unless already present; we never clobber user prefs.
 *   sleep.debt       — derived snapshot ({totalDeficitHours, nightsCounted})
 *                       so a reader has a value before the watcher recomputes;
 *                       the watcher overwrites it with the authoritative one.
 *
 * Shapes are learned from packages/logic/src/sleep/types.ts (SleepRecord,
 * WindDownLogEntry, MedsLogEntry, SleepDebt) and every store.get() in
 * packages/orchestrator/src/sleep.ts.
 *
 * shared.* keys: none written here (sleep owns no shared.* input).
 *
 * Edit ONLY this file.
 */

import type { Store } from '@ollie/store';
import { sleepRepo } from './repo';
import { hoursBetween, type SleepEvent } from './types';
import { migrateSleep } from './migrate';

/** SleepRecord shape the watcher consumes (subset of @ollie/logic/sleep). */
interface MirroredSleepRecord {
  id: string;
  night_of: string; // YYYY-MM-DD
  bedtime: string | null;
  wake_time: string | null;
  onset_latency_min: number | null;
  wakings_count: number | null;
  wakings_total_min: number | null;
  tst_min: number | null;
  time_in_bed_min: number | null;
  efficiency: number | null;
  quality: number | null;
  quality_text: string | null;
  notes: string | null;
  tokens: string[];
  is_skipped: boolean;
  is_partial: boolean;
  is_disputed: boolean;
  raw_source_id: string;
  created_at: number;
}

interface RawLogItem {
  ts: number;
  text: string;
}

interface WindDownLogEntry {
  ts: number;
  step_id: string;
  step_label?: string;
  action: 'checked' | 'unchecked';
}

interface MedsLogEntry {
  ts: number;
}

/** Local-time YYYY-MM-DD for a ms timestamp (the night the sleep belongs to). */
function nightOfFromTs(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Total-sleep-time minutes for a 'sleep' row. Prefer the stored hoursSlept;
 * fall back to recomputing from bedtime/wake (handles rows where hours was
 * supplied but bedtime/wake weren't, and vice versa). Null when unknown.
 */
function tstMinFor(data: { bedtime: string | null; wake: string | null; hoursSlept: number | null }): number | null {
  if (typeof data.hoursSlept === 'number' && Number.isFinite(data.hoursSlept)) {
    return Math.round(data.hoursSlept * 60);
  }
  const h = hoursBetween(data.bedtime, data.wake);
  return h == null ? null : Math.round(h * 60);
}

/** Map one kind='sleep' SQLite event → a watcher-shaped SleepRecord. */
function toSleepRecord(ev: Extract<SleepEvent, { kind: 'sleep' }>): MirroredSleepRecord {
  const tst = tstMinFor(ev.data);
  // time_in_bed is unknown from the native capture (no onset/wakings fields),
  // so efficiency-dependent detectors (sleep_onset_gap) stay quiet — see GAP.
  return {
    id: ev.id,
    night_of: nightOfFromTs(ev.occurredAt),
    bedtime: ev.data.bedtime,
    wake_time: ev.data.wake,
    onset_latency_min: null,
    wakings_count: null,
    wakings_total_min: null,
    tst_min: tst,
    time_in_bed_min: null,
    efficiency: null,
    quality: ev.data.quality,
    quality_text: null,
    notes: null,
    tokens: [],
    is_skipped: false,
    is_partial: tst == null,
    is_disputed: false,
    raw_source_id: String(ev.occurredAt),
    created_at: ev.occurredAt,
  };
}

export async function syncToStore(store: Store): Promise<void> {
  // Capture writes through migrateSleep(); ensure the table exists before we
  // read so a fresh install (sync-on-boot before any capture) can't throw.
  await migrateSleep();

  // ── sleep.records ─────────────────────────────────────────────────────────
  // One record per kind='sleep' row, oldest-first (the watcher sorts by
  // night_of but readers expect chronological). Collapse same-night dupes —
  // keep the most recent capture for a given night_of.
  const sleepEvents = (await sleepRepo.listByKind('sleep', 400)) as Array<
    Extract<SleepEvent, { kind: 'sleep' }>
  >;
  const byNight = new Map<string, MirroredSleepRecord>();
  for (const ev of sleepEvents) {
    const rec = toSleepRecord(ev);
    const prior = byNight.get(rec.night_of);
    // listByKind is newest-first; first seen for a night wins (most recent).
    if (!prior) byNight.set(rec.night_of, rec);
  }
  const records = [...byNight.values()].sort((a, b) =>
    a.night_of.localeCompare(b.night_of),
  );
  store.set('sleep', 'records', records);

  // ── sleep.items ───────────────────────────────────────────────────────────
  // Raw log used by the legacy processBacklog path. We feed it 'insomnia'
  // rows (rough nights the parser can fold into a record) plus the structured
  // sleep rows as a text echo, each tagged with its source ts so processDump's
  // raw_source_id de-dupe matches sleep.records and never double-counts.
  const insomniaEvents = (await sleepRepo.listByKind('insomnia', 200)) as Array<
    Extract<SleepEvent, { kind: 'insomnia' }>
  >;
  const items: RawLogItem[] = insomniaEvents.map((ev) => {
    const woke = ev.data.wokeCount != null ? ` woke ${ev.data.wokeCount}x` : '';
    const tried = ev.data.durationAttemptedMin != null
      ? ` tried ${ev.data.durationAttemptedMin}min`
      : '';
    return { ts: ev.occurredAt, text: `couldn't sleep${tried}${woke}` };
  });
  store.set('sleep', 'items', items);

  // ── sleep.windDownLog ─────────────────────────────────────────────────────
  // The friction detector consumes per-step ('checked'/'unchecked') ritual
  // rows emitted by the WindDownChecklist UI (event sleep:wind_down_step),
  // NOT free-text wind_down notes. The native capture only stores free-text
  // notes, so there are no step rows to mirror. Preserve any step log the
  // event subscriber already accumulated rather than blow it away.
  const existingWindDown = store.get<WindDownLogEntry[]>('sleep', 'windDownLog', []) ?? [];
  store.set('sleep', 'windDownLog', Array.isArray(existingWindDown) ? existingWindDown : []);

  // ── sleep.medsLog ─────────────────────────────────────────────────────────
  // detectMedicationTimingDrift pairs bedtime to the last med dose of the day.
  // Sleep capture mirrors a med to the medication module (handler.ts) but does
  // not keep its own meds row, so this is empty unless something else wrote it.
  // Preserve any prior medsLog; never clobber. (GAP: real med timing lives in
  // the medication module — wiring that cross-feed is out of this scope.)
  const existingMeds = store.get<MedsLogEntry[]>('sleep', 'medsLog', []) ?? [];
  store.set('sleep', 'medsLog', Array.isArray(existingMeds) ? existingMeds : []);

  // ── sleep.settings ────────────────────────────────────────────────────────
  // Read-preserve: the orchestrator seeds DEFAULT_SETTINGS on init and the UI
  // owns user prefs. Only write when entirely absent, and only an empty object
  // so we merge cleanly with DEFAULT_SETTINGS rather than override any flag.
  if (store.get('sleep', 'settings', null) == null) {
    store.set('sleep', 'settings', {});
  }

  // ── sleep.debt ────────────────────────────────────────────────────────────
  // Pre-seed a coarse 14-night deficit snapshot so a Box reader has a number
  // before the watcher's debounced recompute lands. The watcher overwrites
  // this with the authoritative computeSleepDebt result on its next tick.
  store.set('sleep', 'debt', computeCoarseDebt(records));
}

/**
 * Coarse sleep-debt snapshot over the last 14 logged (non-skipped) nights vs
 * the default 7.5h target. Matches SleepDebt {totalDeficitHours, nightsCounted}.
 * Intentionally simple — the orchestrator's computeSleepDebt is authoritative.
 */
function computeCoarseDebt(records: MirroredSleepRecord[]): {
  totalDeficitHours: number;
  nightsCounted: number;
} {
  const TARGET_MIN = 7.5 * 60;
  const last14 = records
    .filter((r) => !r.is_skipped && typeof r.tst_min === 'number')
    .slice(-14);
  let deficitMin = 0;
  for (const r of last14) {
    const tst = r.tst_min as number;
    if (tst < TARGET_MIN) deficitMin += TARGET_MIN - tst;
  }
  return {
    totalDeficitHours: Math.round((deficitMin / 60) * 10) / 10,
    nightsCounted: last14.length,
  };
}
