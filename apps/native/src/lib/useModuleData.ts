/**
 * apps/native · lib/useModuleData
 *
 * The Box-lifecycle scaffold every module screen used to copy-paste (audit
 * #35): run the module's SQLite migration once, do an initial `refresh()`,
 * flip `ready`, then poll every `POLL_MS` and on window focus. This hook is
 * the single source of that behavior so the 12 Boxes don't each re-declare
 * `POLL_MS = 6000` and the mount/poll/focus effects.
 *
 * Migration once-guard (audit #133): Box effects previously re-ran the module
 * migration on EVERY mount — React 18 StrictMode double-invokes effects in dev,
 * and route flips remount the screen, so the migration fired repeatedly. We
 * remember, per module key, that the migration already resolved this session
 * and skip it on subsequent mounts. The guard is keyed by the caller-supplied
 * `migrationKey` (one per module). A failed migration is NOT cached as done —
 * the promise is dropped on rejection so the next mount retries (mirrors the
 * `migrate.ts` rejection-clearing fix).
 */

import { useEffect, useState, type DependencyList } from 'react';

/** Shared poll cadence for every Box's SQLite re-read (audit #35). */
export const POLL_MS = 6000;

// module key → in-flight/resolved migration promise for THIS session.
// A rejected migration deletes its entry so a later mount retries.
const migrationOnce = new Map<string, Promise<void>>();

/** Run a module migration at most once per module per session (#133). */
function runMigrationOnce(key: string, migrate: () => Promise<void>): Promise<void> {
  const existing = migrationOnce.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      await migrate();
    } catch (err) {
      // Don't cache the rejection — let the next mount retry.
      migrationOnce.delete(key);
      throw err;
    }
  })();
  migrationOnce.set(key, p);
  return p;
}

/** Test-only: forget all remembered migrations so a fresh mount re-runs. */
export function _resetModuleMigrations(): void {
  migrationOnce.clear();
}

export interface UseModuleDataOptions {
  /** Stable per-module id used to dedupe the migration (#133). */
  migrationKey: string;
  /** Module migration — run once per session before the first refresh. */
  migrate: () => Promise<void>;
  /** Re-read SQLite into component state. Should be a stable `useCallback`. */
  refresh: () => Promise<void> | void;
  /** Override the poll cadence (defaults to the shared POLL_MS). */
  pollMs?: number;
  /**
   * Optional side-effect to kick after the first successful load (e.g.
   * grocery's non-blocking shelf-life table load). Runs once, after `ready`.
   * Receives a `cancelled()` probe so it can bail if the Box unmounted.
   */
  onFirstLoad?: (cancelled: () => boolean) => void;
}

/**
 * Drive a Box's data lifecycle. Returns `{ ready }` — false until the first
 * migrate+refresh completes. The caller keeps owning its own state setters
 * inside `refresh`; this hook only sequences migrate → refresh → ready and the
 * poll/focus re-reads.
 */
export function useModuleData({
  migrationKey,
  migrate,
  refresh,
  pollMs = POLL_MS,
  onFirstLoad,
}: UseModuleDataOptions): { ready: boolean } {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await runMigrationOnce(migrationKey, migrate);
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      setReady(true);
      onFirstLoad?.(() => cancelled);
    })().catch((err) => {
      // A failed migration/refresh leaves the Box in its loading state rather
      // than crashing the screen; the rejection is already un-cached in
      // runMigrationOnce so the next mount retries. Log, don't throw.
      console.error(`[useModuleData] ${migrationKey} load failed (non-fatal):`, err);
    });
    return () => {
      cancelled = true;
    };
    // `refresh` is the only changing dep callers pass; migrationKey/migrate are
    // module-stable. We intentionally exclude onFirstLoad (callers pass inline).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => {
      void refresh();
    }, pollMs);
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh, pollMs]);

  return { ready };
}

export type { DependencyList };
