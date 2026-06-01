/**
 * apps/native · modules/pets/bridge.ts  —  SQLite → @ollie/store mirror
 *
 * The pets Layer-2 watcher (packages/orchestrator/src/pets.ts — care gaps,
 * health flags, 5 behavioral detectors) reads the @ollie/store keys below.
 * Native captures every pet moment into a single SQLite events table
 * (pets/repo.ts → pets_events: kind ∈ care|observation|vet|feed|supplement,
 * keyed by free-text petName) and never writes the store. This bridge mirrors
 * those rows into the shapes the watcher reads.
 *
 * Store keys written:
 *   pets.pets             — synthesized Pet roster (one per distinct petName)
 *   pets.care_log         — CareLogEntry[] (feed/supplement/vet/care → task)
 *   pets.observations     — Observation[] (the corpus health-flags scan)
 *   pets.vet_schedule     — VetScheduleItem[] (vet cadence per pet)
 *   pets.away             — { active } owner-away window (read-merge: never own)
 *   pets.coregulation_log — CoregulationEntry[] (read-merge: fed by the dump
 *                           mood/pet-mention flow, NOT by this SQLite mirror)
 * (pets.patterns / care_gaps / health_flags / daily_forecast / alert_cooldowns
 *  are OUTPUT keys the watcher writes — never touched here.)
 *
 * ── BUILD GAP (flagged, not fixable here) ─────────────────────────────────
 * Native keys pets by free-text petName only — there is no per-pet species /
 * profile registry. The watcher's care-gap + health-flag engines are
 * species-driven (SPECIES_PROFILES[pet.species]). With no species on record we
 * default every synthesized pet to `guinea_pig` — the household anchors
 * (Tontin + Pinpon) ARE guinea pigs, and it's the only profile whose daily
 * scurvy-critical vitamin_c cadence we can honour. This means per-species care
 * cadence is WRONG for any non-guinea-pig pet until a species registry exists.
 * That registry is a build task (schema + onboarding), out of scope for the
 * rewiring. We feed what exists so the welfare-critical guinea-pig path works.
 *
 * `coregulation_log` is fed by the dump mood/pet-mention flow (a separate
 * concern owned by the dump agent) — we read-merge it so a re-sync never wipes
 * what that flow appended.
 *
 * Edit ONLY this file.
 */

import type { Store } from '@ollie/store';
import { events as eventsRepo } from './repo';
import { normalisePetName, petNameLabel, type PetEvent } from './types';

/** Species we default synthesized pets to — see BUILD GAP above. */
const DEFAULT_SPECIES = 'guinea_pig';

/** Stable, deterministic pet id derived from the normalised name. */
function petIdFor(name: string): string {
  return `pet:${name}`;
}

/**
 * Map a native event kind (+ free-text care `what`) to a guinea_pig care_task
 * key the watcher recognises. Returns null for kinds that are not care actions
 * (observation) or care text we can't confidently map.
 *
 * Mapping rationale (guinea_pig SPECIES_PROFILES.care_tasks):
 *   feed       → fresh_veg   (the daily diet task; guinea_pig has no `feed`)
 *   supplement → vitamin_c   when the supplement is vitamin C (scurvy-critical),
 *                            else the raw supplement key if it's a known task
 *   vet        → vet_checkup
 *   care       → keyword-matched task (hay_refill / cage_clean / nail_trim /
 *                floor_time / water_refresh / fresh_veg), else null
 */
const GUINEA_PIG_TASKS = new Set([
  'hay_refill',
  'cage_clean',
  'vitamin_c',
  'fresh_veg',
  'water_refresh',
  'nail_trim',
  'floor_time',
  'vet_checkup',
]);

/** Lightweight keyword → task hints for free-text care events. */
const CARE_KEYWORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bhay\b/i, 'hay_refill'],
  [/\b(cage|bedding|litter|scrub)/i, 'cage_clean'],
  [/\b(nail|claw)/i, 'nail_trim'],
  [/\b(floor\s*time|lap\s*time|let\s*(them|her|him)\s*out|out of (the )?cage)/i, 'floor_time'],
  [/\b(water)/i, 'water_refresh'],
  [/\b(veg|greens|lettuce|cilantro|parsley|pepper)/i, 'fresh_veg'],
];

function taskForEvent(ev: PetEvent): string | null {
  switch (ev.kind) {
    case 'feed':
      return 'fresh_veg';
    case 'vet':
      return 'vet_checkup';
    case 'supplement': {
      const supp = ev.data.kind === 'supplement' ? ev.data.supplement : '';
      if (supp === 'vitamin_c') return 'vitamin_c';
      return GUINEA_PIG_TASKS.has(supp) ? supp : 'vitamin_c';
    }
    case 'care': {
      const what = ev.data.kind === 'care' ? ev.data.what : '';
      for (const [re, task] of CARE_KEYWORDS) {
        if (re.test(what)) return task;
      }
      return null; // unmappable free-text care — don't fabricate a cadence
    }
    case 'observation':
      return null;
    default:
      return null;
  }
}

export async function syncToStore(store: Store): Promise<void> {
  const rows = await eventsRepo.list(); // most-recent-first

  // ── roster: one Pet per distinct named pet ──────────────────────────────
  const names = new Set<string>();
  for (const ev of rows) {
    const key = normalisePetName(ev.petName);
    if (key) names.add(key);
  }

  const pets = Array.from(names).map((name) => ({
    id: petIdFor(name),
    name: petNameLabel(name),
    species: DEFAULT_SPECIES,
  }));

  // ── care_log: every care-action event keyed to a roster pet + task ───────
  const careLog: Array<{ pet_id: string; task: string; occurred_at: number }> = [];
  const observations: Array<{
    id: string;
    pet_id: string;
    text: string;
    tags: string[];
    kind: 'note';
    occurred_at: number;
    created_at: number;
  }> = [];
  // Track the most recent vet visit per pet so we can hand the watcher a
  // vet_schedule with a real last_completed_at (its vet-adherence detector
  // needs a cadence anchor).
  const lastVetAt: Record<string, number> = {};

  for (const ev of rows) {
    const key = normalisePetName(ev.petName);
    if (!key) continue; // care/health are per-pet; an unnamed row has no anchor
    const petId = petIdFor(key);

    if (ev.kind === 'observation') {
      const note = ev.data.kind === 'observation' ? ev.data.note : '';
      if (note) {
        observations.push({
          id: ev.id,
          pet_id: petId,
          text: note,
          tags: [],
          kind: 'note',
          occurred_at: ev.loggedAt,
          created_at: ev.loggedAt,
        });
      }
      continue;
    }

    const task = taskForEvent(ev);
    if (!task) continue;
    careLog.push({ pet_id: petId, task, occurred_at: ev.loggedAt });
    if (ev.kind === 'vet' && (lastVetAt[petId] === undefined || ev.loggedAt > lastVetAt[petId])) {
      lastVetAt[petId] = ev.loggedAt;
    }
  }

  // ── vet_schedule: 180-day exotic-vet cadence anchored to last visit ──────
  const vetSchedule = Object.entries(lastVetAt).map(([petId, at]) => ({
    id: `vet:${petId}`,
    pet_id: petId,
    kind: 'vet_checkup',
    cadence_days: 180,
    last_completed_at: at,
  }));

  store.set('pets', 'pets', pets);
  store.set('pets', 'care_log', careLog);
  store.set('pets', 'observations', observations);
  store.set('pets', 'vet_schedule', vetSchedule);

  // ── read-merge keys we don't own ─────────────────────────────────────────
  // `away` is an owner-set window; never clobber it — only ensure the key
  // exists so the watcher's defensive read is happy.
  if (store.get('pets', 'away', undefined) === undefined) {
    store.set('pets', 'away', { active: false });
  }
  // `coregulation_log` is appended by the dump mood/pet-mention flow. We must
  // never overwrite it from the SQLite mirror — just ensure it exists.
  if (store.get('pets', 'coregulation_log', undefined) === undefined) {
    store.set('pets', 'coregulation_log', []);
  }
}
