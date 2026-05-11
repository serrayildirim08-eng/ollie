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
 *   alert_cooldowns Record<string, number> (persisted to avoid spam)
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import {
  computeCareGaps,
  detectHealthFlags,
  generateGuiltTripCopy,
  todayForecast,
  SPECIES_PROFILES,
} from '@ollie/logic/pets';
import type { Pet, CareLogEntry, Observation, CareGap } from '@ollie/logic/pets';
import type { Orchestrator } from './types';

const COOLDOWN_MS = 72 * 3_600_000;

export interface PetsOrchestratorOptions {
  /** Injected for tests; defaults to Date.now */
  now?: () => number;
}

export function createPetsOrchestrator(
  store: Store,
  opts: PetsOrchestratorOptions = {},
): Orchestrator {
  const nowFn = opts.now ?? (() => Date.now());
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

  // ── full recompute ────────────────────────────────────────────────────────

  function recompute(): void {
    recomputeGaps();
    recomputeHealthFlags();
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  function init(): void {
    if (initialized) return;
    initialized = true;

    unsubs.push(store.subscribeKey('pets', 'pets', () => recompute()));
    unsubs.push(store.subscribeKey('pets', 'care_log', () => recomputeGaps()));
    unsubs.push(store.subscribeKey('pets', 'observations', () => recomputeHealthFlags()));

    recompute();
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => fn());
    initialized = false;
  }

  return { init, teardown };
}
