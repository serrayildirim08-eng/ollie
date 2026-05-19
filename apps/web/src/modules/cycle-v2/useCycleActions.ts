/**
 * cycle-v2 · useCycleActions — write bridge
 *
 * The handful of mutations the v2 cycle screens perform, written through
 * the SAME `cycle.items` / `cycle.asks` store keys + `CycleItem` shape the
 * live `CycleModule` uses. A period start logged through the v2 preview is
 * visible to the live module and vice-versa — they share one cycle store.
 *
 * The save logic mirrors `CycleModule.saveRecord`:
 *   - a "bleeding" tag that's NOT already a recent start logs a `started`
 *     event (a new cycle); a re-tap inside the 12h dedup window is kept as
 *     a plain symptom so a double-tap can't fork a cycle.
 *   - every other tag is a `symptom` event; a free note is a `log` event.
 *   - `lastEditedByCycle` is bumped so the health-flag cooldown holds.
 */
import { useCallback } from 'react';
import { useStoreSlice } from '../../store';
import type { CycleItem } from '@ollie/logic/cycle';
import { detectBoundaries } from '@ollie/logic/cycle';

const DEDUP_MS = 12 * 60 * 60 * 1000;

export interface LogTodayInput {
  /** the picked symptom tags */
  tags: string[];
  /** an optional free-text note */
  note?: string;
  /** explicit "bleeding — day 1": force a new-cycle start */
  bleedingDayOne?: boolean;
}

export interface CycleActions {
  /** save a day's symptom log; may start a new cycle */
  logToday: (input: LogTodayInput) => void;
  /** log a pill for a given day (defaults to now) */
  logPill: (ts: number) => void;
  /** persist the partner-ask picks */
  setAsks: (picks: string[]) => void;
}

export function useCycleActions(now: number): CycleActions {
  const [items, setItems] = useStoreSlice<CycleItem[]>('cycle', 'items', []);
  const [lastEditedByCycle, setLastEditedByCycle] = useStoreSlice<
    Record<number, number>
  >('cycle', 'lastEditedByCycle', {});
  const [, setAsksSlice] = useStoreSlice<string[]>('cycle', 'asks', []);

  const logToday = useCallback(
    ({ tags, note, bleedingDayOne }: LogTodayInput) => {
      const ts = now;
      const list = Array.isArray(items) ? items : [];
      const next = list.slice();

      const lastStarted = list.reduce<number>(
        (acc, i) => (i && i.action === 'started' && i.ts > acc ? i.ts : acc),
        0,
      );
      const wantsStart =
        bleedingDayOne || tags.some((t) => t.toLowerCase() === 'bleeding');

      if (wantsStart) {
        if (lastStarted && ts - lastStarted < DEDUP_MS) {
          // a re-tap inside the dedup window — keep it a plain symptom
          next.push({ ts, action: 'symptom', text: 'bleeding (day 1 already logged)' });
        } else {
          next.push({ ts, action: 'started', text: 'period started' });
        }
      }

      for (const tag of tags) {
        if (tag.toLowerCase() === 'bleeding') continue; // handled above
        next.push({ ts, action: 'symptom', text: tag });
      }
      if (note && note.trim()) {
        next.push({ ts, action: 'log', text: note.trim() });
      }

      setItems(next);

      // bump the health-flag cooldown for the running cycle
      const records = detectBoundaries(next);
      const lastStart =
        records.length > 0 ? records[records.length - 1].cycleStartTs : null;
      if (lastStart !== null) {
        setLastEditedByCycle({
          ...(lastEditedByCycle ?? {}),
          [lastStart]: ts,
        });
      }
    },
    [items, setItems, lastEditedByCycle, setLastEditedByCycle, now],
  );

  const logPill = useCallback(
    (ts: number) => {
      const list = Array.isArray(items) ? items : [];
      setItems([...list, { ts, action: 'pill' }]);
    },
    [items, setItems],
  );

  const setAsks = useCallback(
    (picks: string[]) => {
      setAsksSlice(picks);
    },
    [setAsksSlice],
  );

  return { logToday, logPill, setAsks };
}
