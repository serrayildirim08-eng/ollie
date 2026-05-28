/**
 * Sleep module · repository.
 *
 * Thin typed wrapper over the SQLite layer. SQL strings live here only.
 * Stores all four kinds in one `sleep_events` table; the kind-specific
 * fields ride in `data` as JSON.
 *
 * Conventions:
 *   - All times are ms-since-epoch integers.
 *   - `add*` functions return the freshly-inserted event.
 *   - `list*` queries always return most-recent-first.
 */

import { sql } from '../../storage';
import {
  hoursBetween,
  type DreamData,
  type InsomniaData,
  type SleepEvent,
  type SleepKind,
  type SleepLogData,
  type WindDownData,
} from './types';

// Index signature satisfies the sql<T extends ShimRow>() constraint; the
// strongly-typed properties still win in autocomplete + narrowing.
interface SleepEventRow {
  id: string;
  kind: string;
  data: string;
  occurred_at: number;
  [col: string]: unknown;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── add ──────────────────────────────────────────────────────────────────

export const sleepRepo = {
  /**
   * Insert a 'sleep' kind row. `bedtime` + `wake` are HH:MM (24h) strings
   * as supplied by the user; `hoursSlept` is computed when both are present.
   * `occurredAt` defaults to now; callers pass an override when the user
   * explicitly logs an earlier night.
   */
  async addSleepLog(input: {
    bedtime?: string | null;
    wake?: string | null;
    quality?: 1 | 2 | 3 | 4 | 5 | null;
    hours?: number | null;
    occurredAt?: number;
  }): Promise<SleepEvent> {
    const id = newId();
    const occurredAt = input.occurredAt ?? Date.now();
    const computedHours = hoursBetween(input.bedtime ?? null, input.wake ?? null);
    const data: SleepLogData = {
      bedtime: input.bedtime ?? null,
      wake: input.wake ?? null,
      quality: input.quality ?? null,
      hoursSlept: computedHours ?? input.hours ?? null,
    };
    await insertRow(id, 'sleep', data, occurredAt);
    return { id, kind: 'sleep', occurredAt, data };
  },

  async addWindDown(input: { note: string; occurredAt?: number }): Promise<SleepEvent> {
    const id = newId();
    const occurredAt = input.occurredAt ?? Date.now();
    const data: WindDownData = { note: input.note };
    await insertRow(id, 'wind_down', data, occurredAt);
    return { id, kind: 'wind_down', occurredAt, data };
  },

  async addDream(input: { text: string; occurredAt?: number }): Promise<SleepEvent> {
    const id = newId();
    const occurredAt = input.occurredAt ?? Date.now();
    const data: DreamData = { text: input.text };
    await insertRow(id, 'dream', data, occurredAt);
    return { id, kind: 'dream', occurredAt, data };
  },

  async addInsomnia(input: {
    durationAttemptedMin?: number | null;
    wokeCount?: number | null;
    occurredAt?: number;
  }): Promise<SleepEvent> {
    const id = newId();
    const occurredAt = input.occurredAt ?? Date.now();
    const data: InsomniaData = {
      durationAttemptedMin: input.durationAttemptedMin ?? null,
      wokeCount: input.wokeCount ?? null,
    };
    await insertRow(id, 'insomnia', data, occurredAt);
    return { id, kind: 'insomnia', occurredAt, data };
  },

  // ─── list ───────────────────────────────────────────────────────────────

  /** Most recent events of a given kind, newest first. */
  async listByKind(kind: SleepKind, limit = 50): Promise<SleepEvent[]> {
    const rows = await sql.select<SleepEventRow>(
      `SELECT id, kind, data, occurred_at
       FROM sleep_events
       WHERE kind = ?
       ORDER BY occurred_at DESC
       LIMIT ?`,
      [kind, limit],
    );
    return rows.map(parseRow);
  },

  /** Single most-recent 'sleep' event, or null when none. */
  async latestSleep(): Promise<SleepEvent | null> {
    const rows = await sql.select<SleepEventRow>(
      `SELECT id, kind, data, occurred_at
       FROM sleep_events
       WHERE kind = 'sleep'
       ORDER BY occurred_at DESC
       LIMIT 1`,
    );
    if (rows.length === 0) return null;
    return parseRow(rows[0]!);
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM sleep_events WHERE id = ?`, [id]);
  },
};

// ─── helpers ──────────────────────────────────────────────────────────────

async function insertRow(
  id: string,
  kind: SleepKind,
  data: unknown,
  occurredAt: number,
): Promise<void> {
  await sql.execute(
    `INSERT INTO sleep_events (id, kind, data, occurred_at)
     VALUES (?, ?, ?, ?)`,
    [id, kind, JSON.stringify(data), occurredAt],
  );
}

function parseRow(r: SleepEventRow): SleepEvent {
  const occurredAt = r.occurred_at;
  // Defensive: JSON.parse can throw on a corrupted row; fall back to empty
  // shape rather than crashing the whole screen.
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.data);
  } catch {
    parsed = {};
  }
  switch (r.kind) {
    case 'sleep': {
      const d = (parsed ?? {}) as Partial<SleepLogData>;
      return {
        id: r.id,
        kind: 'sleep',
        occurredAt,
        data: {
          bedtime: d.bedtime ?? null,
          wake: d.wake ?? null,
          quality: (d.quality ?? null) as SleepLogData['quality'],
          hoursSlept: d.hoursSlept ?? null,
        },
      };
    }
    case 'wind_down': {
      const d = (parsed ?? {}) as Partial<WindDownData>;
      return {
        id: r.id,
        kind: 'wind_down',
        occurredAt,
        data: { note: d.note ?? '' },
      };
    }
    case 'dream': {
      const d = (parsed ?? {}) as Partial<DreamData>;
      return {
        id: r.id,
        kind: 'dream',
        occurredAt,
        data: { text: d.text ?? '' },
      };
    }
    case 'insomnia': {
      const d = (parsed ?? {}) as Partial<InsomniaData>;
      return {
        id: r.id,
        kind: 'insomnia',
        occurredAt,
        data: {
          durationAttemptedMin: d.durationAttemptedMin ?? null,
          wokeCount: d.wokeCount ?? null,
        },
      };
    }
    default:
      // Unknown kind — surface as a wind-down note carrying the raw blob so
      // nothing is lost. Should never happen if writers stick to SleepKind.
      return {
        id: r.id,
        kind: 'wind_down',
        occurredAt,
        data: { note: r.data },
      };
  }
}
