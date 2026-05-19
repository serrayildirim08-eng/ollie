/**
 * pets-v2 · usePetsActions — write bridge
 *
 * The mutations the v2 pets screens perform, written through the SAME
 * `pets.*` store keys + row shapes the live `PetsModule` uses. A pet added,
 * a care task logged, an observation recorded, a flag reviewed, away mode
 * toggled in the v2 preview is visible to the live module and vice-versa —
 * they share one pets store.
 *
 *   - `addPet` mirrors `PetsModule.addPet` — a new `pets.pets` row.
 *   - `logCare` mirrors `PetsModule.logManual` — appends a `pets.care_log`
 *     row, with the same 60-second toggle-undo (re-logging the same
 *     pet+task within a minute removes the prior entry), and recomputes
 *     `pets.care_gaps` immediately via `computeCareGaps`.
 *   - `recordObservation` mirrors `PetsModule.recordObservation` — appends
 *     a `pets.observations` row (the corpus the health-flag detector reads).
 *   - `reviewFlag` / `dismissFlag` mirror `PetsModule.reviewFlag` /
 *     `dismissFlag` — flip a `pets.health_flags` row's status.
 *   - `archivePet` mirrors `PetsModule.archivePet`.
 *   - `toggleAway` mirrors `PetsModule.toggleAway` — flips `pets.away`.
 *
 * Mirrors admin-v2/useAdminActions.ts.
 */
import { useCallback } from 'react';
import { SPECIES_PROFILES, computeCareGaps } from '@ollie/logic/pets';
import type { Pet, CareLogEntry, CareGap } from '@ollie/logic/pets';
import { useStoreSlice } from '../../store';
import { mkId } from '../../lib/mkId';
import type {
  StoredPet,
  StoredCareLogEntry,
  StoredObservation,
  StoredHealthFlag,
  AwayState,
} from './selectors';

const DAY_MS = 86_400_000;

/** the draft an add-screen commit hands `addPet` */
export interface PetDraft {
  name: string;
  species: string;
  nickname: string;
  notes: string;
}

/** a structured observation draft from the observe screen */
export interface ObservationDraft {
  petId: string;
  text: string;
  tags: string[];
  /** optional body weight in grams */
  weightGrams?: number;
}

export interface PetsActions {
  /** add a new pet to the notebook; returns the created row's id, or null */
  addPet: (draft: PetDraft) => string | null;
  /** log a care task for a pet — 60s toggle-undo; returns 'logged'|'undone' */
  logCare: (petId: string, task: string) => 'logged' | 'undone' | null;
  /** record an observation; returns the created row's id, or null */
  recordObservation: (draft: ObservationDraft) => string | null;
  /** mark a health flag reviewed */
  reviewFlag: (flagId: string) => void;
  /** dismiss a health flag */
  dismissFlag: (flagId: string) => void;
  /** archive a pet (soft-remove from the active roster) */
  archivePet: (petId: string) => void;
  /** toggle away mode — when turning on, returns 3 days out */
  toggleAway: () => void;
}

export function usePetsActions(now: number): PetsActions {
  const [pets, setPets] = useStoreSlice<StoredPet[]>('pets', 'pets', []);
  const [careLog, setCareLog] = useStoreSlice<StoredCareLogEntry[]>(
    'pets',
    'care_log',
    [],
  );
  const [, setCareGaps] = useStoreSlice<CareGap[]>('pets', 'care_gaps', []);
  const [observations, setObservations] = useStoreSlice<StoredObservation[]>(
    'pets',
    'observations',
    [],
  );
  const [healthFlags, setHealthFlags] = useStoreSlice<StoredHealthFlag[]>(
    'pets',
    'health_flags',
    [],
  );
  const [away, setAway] = useStoreSlice<AwayState>('pets', 'away', {
    active: false,
    returning_at: null,
  });

  const petList = useCallback(
    () => (Array.isArray(pets) ? pets : []),
    [pets],
  );
  const logList = useCallback(
    () => (Array.isArray(careLog) ? careLog : []),
    [careLog],
  );

  const addPet = useCallback(
    (draft: PetDraft): string | null => {
      const name = draft.name.trim();
      if (!name) return null;
      const id = mkId('id');
      const row: StoredPet = {
        id,
        name,
        species: draft.species || 'guinea_pig',
        nickname: draft.nickname.trim() || null,
        notes: draft.notes.trim() || null,
        cohabits_with: [],
        archived: false,
        archived_at: null,
        created_at: now,
      };
      setPets([...petList(), row]);
      return id;
    },
    [petList, setPets, now],
  );

  const logCare = useCallback(
    (petId: string, task: string): 'logged' | 'undone' | null => {
      if (!petId || !task) return null;
      const current = logList();
      // toggle-undo: same pet+task logged <60s ago → remove that entry
      const recent = [...current]
        .reverse()
        .find(
          (e) =>
            e.pet_id === petId &&
            e.task === task &&
            now - e.occurred_at < 60_000 &&
            (e.source ?? 'manual') === 'manual',
        );
      const next: StoredCareLogEntry[] = recent
        ? current.filter((e) => e.id !== recent.id)
        : [
            ...current,
            {
              id: mkId('id'),
              pet_id: petId,
              task,
              occurred_at: now,
              source: 'manual',
              raw_text: null,
              confidence: 1,
            },
          ];
      setCareLog(next);
      // recompute care gaps immediately, exactly like PetsModule.logManual
      const activePetList = petList().filter((p) => !p.archived) as Pet[];
      setCareGaps(
        computeCareGaps(
          activePetList,
          next as CareLogEntry[],
          SPECIES_PROFILES,
          now,
        ),
      );
      return recent ? 'undone' : 'logged';
    },
    [logList, petList, setCareLog, setCareGaps, now],
  );

  const recordObservation = useCallback(
    (draft: ObservationDraft): string | null => {
      const text = draft.text.trim();
      // an observation is meaningful with text, tags, or a weight
      const hasWeight = typeof draft.weightGrams === 'number';
      if (!draft.petId || (!text && draft.tags.length === 0 && !hasWeight)) {
        return null;
      }
      const id = mkId('id');
      const kind: StoredObservation['kind'] = hasWeight
        ? 'weight'
        : text
          ? 'note'
          : 'behavior';
      const row: StoredObservation = {
        id,
        pet_id: draft.petId,
        // the corpus the health-flag engine scans — tags fold into the text
        text: [text, ...draft.tags].filter(Boolean).join(' · '),
        tags: draft.tags,
        kind,
        value_grams: hasWeight ? draft.weightGrams : undefined,
        occurred_at: now,
        created_at: now,
      };
      setObservations([
        ...(Array.isArray(observations) ? observations : []),
        row,
      ]);
      return id;
    },
    [observations, setObservations, now],
  );

  const reviewFlag = useCallback(
    (flagId: string) => {
      setHealthFlags(
        (Array.isArray(healthFlags) ? healthFlags : []).map((f) =>
          f.id === flagId
            ? { ...f, status: 'reviewed', reviewed_at: now }
            : f,
        ),
      );
    },
    [healthFlags, setHealthFlags, now],
  );

  const dismissFlag = useCallback(
    (flagId: string) => {
      setHealthFlags(
        (Array.isArray(healthFlags) ? healthFlags : []).map((f) =>
          f.id === flagId
            ? { ...f, status: 'dismissed', reviewed_at: now }
            : f,
        ),
      );
    },
    [healthFlags, setHealthFlags, now],
  );

  const archivePet = useCallback(
    (petId: string) => {
      setPets(
        petList().map((p) =>
          p.id === petId ? { ...p, archived: true, archived_at: now } : p,
        ),
      );
    },
    [petList, setPets, now],
  );

  const toggleAway = useCallback(() => {
    if (away.active) {
      setAway({ active: false, returning_at: null });
    } else {
      setAway({ active: true, returning_at: now + 3 * DAY_MS });
    }
  }, [away, setAway, now]);

  return {
    addPet,
    logCare,
    recordObservation,
    reviewFlag,
    dismissFlag,
    archivePet,
    toggleAway,
  };
}
