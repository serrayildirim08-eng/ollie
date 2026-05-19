/**
 * medication-v2 · useMedicationActions — write bridge
 *
 * The handful of mutations the v2 medication screens perform, written
 * through the SAME `medication.items` store key + `MedicationItem` shape
 * the live `MedicationModule` uses. A med added, a dose logged through the
 * v2 preview is visible to the live module and vice-versa — they share one
 * medication store.
 *
 *   - `addMedication` mirrors `MedicationModule.addItem` — a new
 *     `MedicationItem` appended to `medication.items`, name lowercased,
 *     schedule split on commas.
 *   - `logDose` mirrors `MedicationModule.logTaken` — a `{date,time,ts}`
 *     entry appended to the item's `taken` log, and emits the same
 *     `medication:logged` event the live module fires (so the orchestrator
 *     + any cross-module listeners see it).
 *   - `archiveMedication` mirrors `MedicationModule.archive`.
 *
 * Mirrors body-v2/useBodyActions.ts.
 */
import { useCallback } from 'react';
import { emit } from '@ollie/events';
import { isoDate, type MedicationItem, type MedicationKind } from '@ollie/logic/medication';
import { useStoreSlice } from '../../store';
import { mkId } from '../../lib/mkId';

export interface NewMedication {
  name: string;
  dose?: string;
  kind: MedicationKind;
  /** the clean HH:MM 24h slots — empty = manual log only */
  schedule: string[];
}

export interface MedicationActions {
  /** add a new medication; returns the created item, or null when invalid */
  addMedication: (med: NewMedication) => MedicationItem | null;
  /** log a dose taken now against a medication */
  logDose: (itemId: string) => void;
  /** archive (soft-remove) a medication */
  archiveMedication: (itemId: string) => void;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function useMedicationActions(now: number): MedicationActions {
  const [items, setItems] = useStoreSlice<MedicationItem[]>(
    'medication',
    'items',
    [],
  );

  const addMedication = useCallback(
    (med: NewMedication): MedicationItem | null => {
      const name = (med.name ?? '').trim();
      if (!name) return null;
      const item: MedicationItem = {
        id: mkId('m'),
        name: name.toLowerCase(),
        kind: med.kind,
        schedule: Array.isArray(med.schedule)
          ? med.schedule.filter((s) => typeof s === 'string' && s.trim())
          : [],
        taken: [],
        created_at: now,
      };
      const dose = (med.dose ?? '').trim();
      if (dose) item.dose = dose;
      const list = Array.isArray(items) ? items : [];
      setItems([...list, item]);
      return item;
    },
    [items, setItems, now],
  );

  const logDose = useCallback(
    (itemId: string) => {
      const list = Array.isArray(items) ? items : [];
      const target = list.find((it) => it && it.id === itemId);
      if (!target) return;
      const d = new Date(now);
      const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      setItems(
        list.map((it) => {
          if (!it || it.id !== itemId) return it;
          const taken = [
            ...(Array.isArray(it.taken) ? it.taken : []),
            { date: isoDate(now), time, ts: now },
          ];
          return { ...it, taken };
        }),
      );
      // mirror the live module: announce the dose to the orchestrator bus
      try {
        emit('medication:logged', {
          item_id: target.id,
          name: target.name,
          ts: now,
        });
      } catch {
        /* event registry warn is acceptable in the preview */
      }
    },
    [items, setItems, now],
  );

  const archiveMedication = useCallback(
    (itemId: string) => {
      const list = Array.isArray(items) ? items : [];
      setItems(
        list.map((it) =>
          it && it.id === itemId ? { ...it, archived: true } : it,
        ),
      );
    },
    [items, setItems],
  );

  return { addMedication, logDose, archiveMedication };
}
