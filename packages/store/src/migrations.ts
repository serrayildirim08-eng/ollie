/**
 * @ollie/store · migrations
 *
 * The migration FRAMEWORK lives here — the actual v1→v5 migration callbacks
 * from the legacy void-app.html are intentionally NOT ported. Reason:
 * ollie is a fresh repo with no legacy v1–v4 data; users start at v5.
 *
 * If a future schema bump requires migrating v5 data, register a callback
 * for version 6 (or higher) and pass it through `runMigrations`.
 *
 * Backup-before-migrate behaviour from the original code (snapshotting
 * every void-namespaced key to `void.state._backup.pre_migration.<ts>`)
 * will land alongside @ollie/backup in a later phase.
 */

import type { StorageAdapter } from './adapter';
import { STORE_VERSION, STORE_META_KEY } from './store';

export type Migration = (adapter: StorageAdapter) => void;
export type MigrationMap = Record<number, Migration>;

export interface StoreMeta {
  version?: number;
  lastOpenedAt?: number;
  migratedAt?: number | null;
}

export const NO_MIGRATIONS: MigrationMap = {};

export function readMeta(adapter: StorageAdapter): StoreMeta {
  const raw = adapter.getItem(STORE_META_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as StoreMeta;
  } catch {
    return {};
  }
}

export function writeMeta(adapter: StorageAdapter, meta: StoreMeta): void {
  adapter.setItem(STORE_META_KEY, JSON.stringify(meta));
}

/**
 * Credibility audit C5: take a snapshot of every void-namespaced key
 * BEFORE running any migrations. Restore on failure. The original
 * legacy behavior is reinstated.
 *
 * Snapshot path: `void.state._backup.pre_migration.<ts>` (a single
 * JSON blob mapping every void.state.* key → value). On failure we
 * restore each key and DO NOT bump the meta version, so the next
 * boot retries the migration with the snapshot still present.
 *
 * Audit item #14: this previously poked at adapter-shape-specific
 * methods (`length`/`key`/`_dump`) that the memory adapter did not
 * implement, so the snapshot was silently EMPTY for every non-browser
 * adapter and the rollback restored nothing. It now uses the
 * `getAllKeys()` method that is part of the StorageAdapter contract and
 * implemented by both adapters.
 */
function snapshotVoidNamespace(adapter: StorageAdapter): { key: string; value: string }[] {
  const snap: { key: string; value: string }[] = [];
  for (const k of adapter.getAllKeys()) {
    if (!k.startsWith('void.state.')) continue;
    // Don't snapshot prior snapshots — they are large and self-referential.
    if (k.startsWith('void.state._backup.pre_migration.')) continue;
    const v = adapter.getItem(k);
    if (v != null) snap.push({ key: k, value: v });
  }
  return snap;
}

function restoreSnapshot(adapter: StorageAdapter, snap: { key: string; value: string }[]): void {
  for (const { key, value } of snap) {
    try { adapter.setItem(key, value); } catch { /* best-effort */ }
  }
}

/**
 * Outcome of a `runMigrations` call (audit item #14).
 *
 * Replaces the `globalThis.__ollie_migration_failed` magic global —
 * callers now get a typed result they can branch on. `failedVersion`
 * is the migration number that threw (undefined when `ok` is true).
 */
export interface MigrationResult {
  /** True when no migration threw (or none were applicable). */
  ok: boolean;
  /** Schema version after the run (unchanged from current on failure). */
  version: number;
  /** True when this run actually executed at least one migration callback. */
  ran: boolean;
  /** The migration version that threw, when `ok` is false. */
  failedVersion?: number;
  /** Number of void.state.* keys captured in the pre-migration snapshot. */
  snapshotKeyCount: number;
}

export function runMigrations(
  adapter: StorageAdapter,
  migrations: MigrationMap = NO_MIGRATIONS,
): MigrationResult {
  const meta = readMeta(adapter);
  const currentVersion = meta.version ?? 0;
  if (currentVersion >= STORE_VERSION) {
    writeMeta(adapter, { ...meta, version: STORE_VERSION, lastOpenedAt: Date.now() });
    return { ok: true, version: STORE_VERSION, ran: false, snapshotKeyCount: 0 };
  }

  // Pre-migration snapshot. Stored as a single blob keyed by ts so we
  // can find it later if the user reports data loss. Capped at the
  // most recent 3 snapshots to bound disk use.
  let snap: { key: string; value: string }[] = [];
  try {
    snap = snapshotVoidNamespace(adapter);
    const snapKey = `void.state._backup.pre_migration.${Date.now()}`;
    adapter.setItem(snapKey, JSON.stringify(snap));
    // Trim older snapshots, keep last 3.
    pruneOldSnapshots(adapter, 3);
  } catch (err) {
    console.warn('[@ollie/store] pre-migration snapshot failed; continuing carefully', err);
  }

  let failedVersion: number | undefined;
  let ran = false;
  for (let v = currentVersion + 1; v <= STORE_VERSION; v++) {
    const migrate = migrations[v];
    if (!migrate) continue;
    ran = true;
    try {
      migrate(adapter);
    } catch (err) {
      console.error(`[@ollie/store] migration ${v} failed; rolling back to snapshot`, err);
      failedVersion = v;
      restoreSnapshot(adapter, snap);
      break;
    }
  }

  if (failedVersion !== undefined) {
    // Do NOT bump meta version — the next boot retries the migration with
    // the snapshot still present. The host app branches on the returned
    // MigrationResult to surface a user-visible message (this replaces
    // the old `globalThis.__ollie_migration_failed` magic global).
    return {
      ok: false,
      version: currentVersion,
      ran,
      failedVersion,
      snapshotKeyCount: snap.length,
    };
  }

  writeMeta(adapter, {
    version: STORE_VERSION,
    lastOpenedAt: Date.now(),
    migratedAt: Date.now(),
  });
  return { ok: true, version: STORE_VERSION, ran, snapshotKeyCount: snap.length };
}

function pruneOldSnapshots(adapter: StorageAdapter, keep: number): void {
  // Uses getAllKeys() (audit item #14) so pruning works on every adapter,
  // not just localStorage. Snapshot keys embed Date.now() so a lexical
  // sort is also chronological.
  const keys = adapter
    .getAllKeys()
    .filter((k) => k.startsWith('void.state._backup.pre_migration.'))
    .sort();
  while (keys.length > keep) {
    const old = keys.shift();
    if (old) {
      try { adapter.removeItem(old); } catch { /* noop */ }
    }
  }
}
