/**
 * @ollie/orchestrator · pets
 *
 * Ported from window.VOID.orchestrator.pets in void-app.html (~lines 23937–24046).
 * The only caller of @ollie/logic/pets functions.
 * UI reads derived keys from the store — it never calls logic directly.
 *
 * Derived keys written (namespace: "pets"):
 *   care_gaps       CareGap[] from computeCareGaps
 *   health_flags    PetHealthFlag records detected across all pets
 *   daily_forecast  Record<pet_id, string> from todayForecast
 *   patterns        AnyPattern[] from detectPatterns (P1–P5 behavioral)
 *   patternsLastComputedAt timestamp of most recent pattern recompute
 *   alert_cooldowns Record<string, number> (persisted to avoid spam)
 *
 * Subscriptions:
 *   pets.pets          → recompute (gaps + health flags + patterns)
 *   pets.care_log      → recomputeGaps + recomputePatterns
 *   pets.observations  → recomputeHealthFlags
 *   pets.vet_schedule  → recomputePatterns
 *   pets.coregulation_log / miss_log / projection_log / micro_steps
 *                      → recomputePatterns
 *
 * consent gate: defaults to true (pass getConsent to override). Gates
 * behavioral pattern detection only — care gaps + health flags are
 * welfare-critical and always run.
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import {
  computeCareGaps,
  detectHealthFlags,
  detectPatterns,
  generateGuiltTripCopy,
  todayForecast,
  SPECIES_PROFILES,
} from '@ollie/logic/pets';
import type {
  Pet,
  CareLogEntry,
  Observation,
  CareGap,
  PetsState,
  AnyPattern,
} from '@ollie/logic/pets';
import type { Orchestrator } from './types';

const COOLDOWN_MS = 72 * 3_600_000;

export interface PetsOrchestratorOptions {
  /** Injected for tests; defaults to Date.now */
  now?: () => number;
  /** Behavioral-pattern consent gate; defaults to true. */
  getConsent?: () => boolean;
}

export function createPetsOrchestrator(
  store: Store,
  opts: PetsOrchestratorOptions = {},
): Orchestrator {
  const nowFn = opts.now ?? (() => Date.now());
  const consentFn = opts.getConsent ?? (() => true);
  let initialized = false;
  const unsubs: Unsubscribe[] = [];

  // ── helpers ──────────────────────────────────────────────────────────────

  function getPets(): Pet[] {
    return store.get<Pet[]>('pets', 'pets', []) ?? [];
  }

  function getCareLog(): CareLogEntry[] {
    return store.get<CareLogEntry[]>('pets', 'care_log', []) ?? [];
  }

  function getObservations(): Observation[] {
    return store.get<Observation[]>('pets', 'observations', []) ?? [];
  }

  function getCooldowns(): Record<string, number> {
    return store.get<Record<string, number>>('pets', 'alert_cooldowns', {}) ?? {};
  }

  function isAwayActive(): boolean {
    const away = store.get<{ active?: boolean }>('pets', 'away', {}) ?? {};
    return !!away.active;
  }

  // ── care gaps ─────────────────────────────────────────────────────────────

  function recomputeGaps(): void {
    const pets = getPets();
    const careLog = getCareLog();
    const now = nowFn();

    const gaps = computeCareGaps(pets, careLog, SPECIES_PROFILES, now);

    const prevGaps = store.get<CareGap[]>('pets', 'care_gaps', []) ?? [];
    const prevByKey: Record<string, string> = {};
    for (const g of prevGaps) {
      prevByKey[`${g.pet_id}:${g.task}`] = g.severity;
    }

    const cooldowns = { ...getCooldowns() };
    const awayActive = isAwayActive();

    for (const g of gaps) {
      if (g.severity === 'ok') continue;
      if (awayActive) continue;

      const prev = prevByKey[`${g.pet_id}:${g.task}`];
      if (prev === g.severity) continue; // no escalation

      const cdKey = `${g.pet_id}:${g.task}:${g.severity}`;
      if (cooldowns[cdKey] !== undefined && now - cooldowns[cdKey] < COOLDOWN_MS) continue;
      cooldowns[cdKey] = now;

      events.emit('pets:care_gap_detected', {
        pet_id: g.pet_id,
        task: g.task,
        severity: g.severity,
        days_since: g.days_since ?? 0,
      });

      const pet = pets.find((p) => p.id === g.pet_id);
      const profile = pet ? SPECIES_PROFILES[pet.species] : undefined;
      if (pet && profile) {
        const copy = generateGuiltTripCopy(g, pet, profile);
        if (copy.text) {
          events.emit('pets:guilt_copy_generated', {
            pet_id: pet.id,
            task: g.task,
            level: copy.level,
            text: copy.text,
          });
        }
      }
    }

    // Per-pet today forecasts.
    const forecasts: Record<string, string> = {};
    for (const pet of pets.filter((p) => !p.archived)) {
      const profile = SPECIES_PROFILES[pet.species];
      if (!profile) continue;
      forecasts[pet.id] = todayForecast(pet, gaps, profile);
    }

    store.set('pets', 'care_gaps', gaps);
    store.set('pets', 'alert_cooldowns', cooldowns);
    store.set('pets', 'daily_forecast', forecasts);
  }

  // ── health flags ──────────────────────────────────────────────────────────

  function recomputeHealthFlags(): void {
    const pets = getPets();
    const observations = getObservations();
    const now = nowFn();
    const cooldowns = { ...getCooldowns() };

    // Build a map of { [species]: profile } limited to this pet for each call.
    const prevFlagRecords = store.get<Array<{
      id: string;
      pet_id: string;
      flag: string;
      detected_at: number;
      last_signal_at: number;
      run_length: number;
      status: string;
      reviewed_at: number | null;
      source_url: string;
    }>>('pets', 'health_flags', []) ?? [];

    const prevKeys = new Set(prevFlagRecords.map((f) => `${f.pet_id}:${f.flag}`));
    const newFlagRecords = [...prevFlagRecords];

    for (const pet of pets) {
      if (pet.archived) continue;
      const profile = SPECIES_PROFILES[pet.species];
      if (!profile) continue;

      const obsForPet = observations.filter((o) => o.pet_id === pet.id);
      const detected = detectHealthFlags(
        pet.id,
        obsForPet,
        { [pet.species]: profile },
        now,
      );

      for (const d of detected) {
        const key = `${pet.id}:${d.flag}`;
        if (prevKeys.has(key)) continue;

        const cdKey = `flag:${key}`;
        if (cooldowns[cdKey] !== undefined && now - cooldowns[cdKey] < COOLDOWN_MS) continue;
        cooldowns[cdKey] = now;

        newFlagRecords.push({
          id: `${pet.id}:${d.flag}:${now}`,
          pet_id: pet.id,
          flag: d.flag,
          detected_at: now,
          last_signal_at: d.last_signal_at,
          run_length: d.run_length,
          status: 'pending',
          reviewed_at: null,
          source_url: d.source_url,
        });

        events.emit('pets:health_flag_raised', {
          pet_id: pet.id,
          flag: d.flag,
          run_length: d.run_length,
          source_url: d.source_url,
        });
      }
    }

    store.set('pets', 'health_flags', newFlagRecords);
    store.set('pets', 'alert_cooldowns', cooldowns);
  }

  // ── behavioral patterns (P1–P5) ───────────────────────────────────────────

  /**
   * Build a PetsState from the store and run all behavioral pattern
   * detectors. The cross-module slices (vet_schedule, coregulation_log,
   * miss_log, projection_log, micro_steps) are read defensively — they
   * may not exist yet; detectors no-op on empty arrays.
   *
   * Consent-gated: when consent is off, detectPatterns returns []. We
   * still write the empty array so the panel reflects the off state.
   */
  function recomputePatterns(): void {
    try {
      const now = nowFn();
      const consent = consentFn();

      const state: PetsState = {
        pets: getPets(),
        care_log: getCareLog(),
        vet_schedule:
          store.get<PetsState['vet_schedule']>('pets', 'vet_schedule', []) ?? [],
        coregulation_log:
          store.get<PetsState['coregulation_log']>('pets', 'coregulation_log', []) ?? [],
        miss_log:
          store.get<PetsState['miss_log']>('pets', 'miss_log', []) ?? [],
        projection_log:
          store.get<PetsState['projection_log']>('pets', 'projection_log', []) ?? [],
        micro_steps:
          store.get<PetsState['micro_steps']>('pets', 'micro_steps', []) ?? [],
      };

      const patterns: AnyPattern[] = detectPatterns(state, {
        now,
        consent,
        speciesProfiles: SPECIES_PROFILES,
      });

      store.set('pets', 'patterns', patterns);
      store.set('pets', 'patternsLastComputedAt', now);
    } catch (e) {
      console.error('[orchestrator/pets] recomputePatterns failed:', e);
    }
  }

  // ── full recompute ────────────────────────────────────────────────────────

  function recompute(): void {
    recomputeGaps();
    recomputeHealthFlags();
    recomputePatterns();
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  function init(): void {
    if (initialized) return;
    initialized = true;

    unsubs.push(store.subscribeKey('pets', 'pets', () => recompute()));
    unsubs.push(store.subscribeKey('pets', 'care_log', () => {
      recomputeGaps();
      recomputePatterns();
    }));
    unsubs.push(store.subscribeKey('pets', 'observations', () => recomputeHealthFlags()));
    unsubs.push(store.subscribeKey('pets', 'vet_schedule', () => recomputePatterns()));
    unsubs.push(store.subscribeKey('pets', 'coregulation_log', () => recomputePatterns()));
    unsubs.push(store.subscribeKey('pets', 'miss_log', () => recomputePatterns()));
    unsubs.push(store.subscribeKey('pets', 'projection_log', () => recomputePatterns()));
    unsubs.push(store.subscribeKey('pets', 'micro_steps', () => recomputePatterns()));

    recompute();
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => fn());
    initialized = false;
  }

  return { init, teardown };
}
