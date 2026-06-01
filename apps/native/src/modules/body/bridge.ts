/**
 * apps/native · modules/body/bridge.ts  —  SQLite → @ollie/store mirror
 *
 * The body Layer-2 watcher (packages/orchestrator/src/body.ts + body-signals
 * + body-correlations) reads a set of @ollie/store keys; the native app
 * captures into SQLite (body/repo.ts, table `body_events`) and never writes
 * them, so every body detector ran on empty input. This mirrors the rows in.
 *
 * Mapping (SQLite kind → store key):
 *   kind='water'      → body.water_log    (WaterEntry[] = { ts, glasses })
 *   kind='supplement' → body.supplements  (one row per log; carries `ts` for
 *                        detectSupplementDrift AND id/name for supplement_due)
 *   kind='episode'    → body.episodes     (Episode[]; well-formed so the
 *                        orchestrator's normalizeEpisodes leaves them be)
 *   body.water_target — preserved (UI owns it); seeded to 8 only when absent
 *   body.posture_settings — preserved (opt-in defaults OFF); never enabled here
 *
 * NOTE: symptom / hunger / movement / posture rows are captured but the body
 * orchestrator reads symptom/food/movement signal from `shared.actionLog`
 * (free-text dumps), NOT from body_events — so those detectors are fed by the
 * dump bridge, not here. See GAP notes in the task report.
 *
 * Shapes learned from packages/logic/src/body/types.ts (WaterEntry,
 * SupplementLogEntry, Episode) + every store.get() in
 * packages/orchestrator/src/body.ts.
 *
 * Edit ONLY this file.
 */

import type { Store } from '@ollie/store';
import { events as bodyEvents, profile as bodyProfile } from './repo';
import { waterTargetForAge, type BodyEvent } from './types';
import { migrateBody } from './migrate';

/** WaterEntry object form the watcher accepts (also accepts a bare number). */
interface WaterLogEntry {
  ts: number;
  glasses: number;
}

/**
 * One supplements entry. Dual-purpose by design:
 *   - `ts`            → detectSupplementDrift (counts distinct logging days)
 *   - `id` + `name`   → emitSupplementDue reminder dedupe + copy
 * Carrying both on the same object lets one key satisfy both readers.
 */
interface SupplementEntry {
  id: string;
  name: string;
  ts: number;
  added_at: number;
  dose: string | null;
}

interface EpisodeEntry {
  id: string;
  started_at: number;
  label: string;
  kind: string;
  symptoms: string[];
  meds: unknown[];
  severity_log: unknown[];
  notes: string[];
  tags: string[];
}

const DEFAULT_GLASS_ML = 250;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export async function syncToStore(store: Store): Promise<void> {
  // Capture writes through migrateBody(); ensure the table exists before we
  // read so a sync-on-boot before any capture can't throw on a missing table.
  await migrateBody();

  const all = await bodyEvents.list(); // newest-first

  const water: WaterLogEntry[] = [];
  const supplements: SupplementEntry[] = [];
  const episodes: EpisodeEntry[] = [];

  for (const ev of all) {
    switch (ev.kind) {
      case 'water': {
        // Convert logged mL → glasses so the watcher's per-glass counting
        // (detectInteroceptionDrift, hydration drop) sees one+ glass per row.
        const ml = num(ev.data['amountMl']) ?? DEFAULT_GLASS_ML;
        const glasses = Math.max(1, Math.round(ml / DEFAULT_GLASS_ML));
        water.push({ ts: ev.loggedAt, glasses });
        break;
      }
      case 'supplement': {
        const name = str(ev.data['label']) || 'supplement';
        supplements.push({
          // Per-log id keyed on the event id keeps supplement_due dedupe stable.
          id: ev.id,
          name,
          ts: ev.loggedAt,
          added_at: ev.loggedAt,
          dose: str(ev.data['dose']) || null,
        });
        break;
      }
      case 'episode': {
        const label = str(ev.data['label']) || 'episode';
        episodes.push(toEpisode(ev, label));
        break;
      }
      default:
        // water_target / posture / symptom / hunger / movement are handled
        // elsewhere or not consumed from body_events — skip.
        break;
    }
  }

  // Oldest-first for stable chronological reads (watcher windows by `ts`/range).
  water.reverse();
  supplements.reverse();
  episodes.reverse();

  store.set('body', 'water_log', water);
  store.set('body', 'supplements', supplements);
  store.set('body', 'episodes', episodes);

  // ── body.water_target ─────────────────────────────────────────────────────
  // Age-based daily target (250 mL glasses), the baseline the hydration-drift
  // watcher compares against. Computed from the one-time age in body_profile;
  // falls back to the adult baseline (8) when age was never set. We always
  // write the computed value so editing age in the Box re-sizes the watcher's
  // denominator on the next sync.
  const age = await bodyProfile.getAge();
  store.set('body', 'water_target', waterTargetForAge(age));

  // ── body.posture_settings ─────────────────────────────────────────────────
  // Read-preserve. Posture nudges are opt-in and default OFF — never flip
  // opt_in here. Only seed an explicit opted-out object when entirely absent.
  if (store.get('body', 'posture_settings', null) == null) {
    store.set('body', 'posture_settings', { opt_in: false });
  }
}

/** Build a well-formed Episode so the orchestrator's normalizer leaves it be. */
function toEpisode(ev: BodyEvent, label: string): EpisodeEntry {
  return {
    id: ev.id,
    started_at: ev.loggedAt,
    label,
    kind: 'acute',
    symptoms: [],
    meds: [],
    severity_log: [],
    notes: [],
    tags: [],
  };
}
