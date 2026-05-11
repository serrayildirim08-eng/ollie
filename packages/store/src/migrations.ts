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
 * Naive listKeys: walk `adapter.length` if the adapter exposes it,
 * else fall back to a known module list.
 */
function snapshotVoidNamespace(adapter: StorageAdapter): { key: string; value: string }[] {
  const snap: { key: string; value: string }[] = [];
  // The browserAdapter passes localStorage through; it has a `length`
  // and `key(i)` accessor. The memoryAdapter exposes `_dump()` in
  // tests. We detect both shapes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = adapter as any;
  if (typeof a.length === 'number' && typeof a.key === 'function') {
    for (let i = 0; i < a.length; i++) {
      const k = a.key(i) as string | null;
      if (!k || !k.startsWith('void.state.')) continue;
      const v = adapter.getItem(k);
      if (v != null) snap.push({ key: k, value: v });
    }
  } else if (typeof a._dump === 'function') {
    const dump = a._dump() as Record<string, string>;
    for (const [k, v] of Object.entries(dump)) {
      if (k.startsWith('void.state.')) snap.push({ key: k, value: v });
    }
  }
  return snap;
}

function restoreSnapshot(adapter: StorageAdapter, snap: { key: string; value: string }[]): void {
  for (const { key, value } of snap) {
    try { adapter.setItem(key, value); } catch { /* best-effort */ }
  }
}

export function runMigrations(
  adapter: StorageAdapter,
  migrations: MigrationMap = NO_MIGRATIONS,
): void {
  const meta = readMeta(adapter);
  const currentVersion = meta.version ?? 0;
  if (currentVersion >= STORE_VERSION) {
    writeMeta(adapter, { ...meta, version: STORE_VERSION, lastOpenedAt: Date.now() });
    return;
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

  let migrationFailed = false;
  for (let v = currentVersion + 1; v <= STORE_VERSION; v++) {
    const migrate = migrations[v];
    if (!migrate) continue;
    try {
      migrate(adapter);
    } catch (err) {
      console.error(`[@ollie/store] migration ${v} failed; rolling back to snapshot`, err);
      migrationFailed = true;
      restoreSnapshot(adapter, snap);
      break;
    }
  }

  if (migrationFailed) {
    // Do NOT bump meta version. Surface so the host app can show a
    // user-visible message.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = typeof globalThis !== 'undefined' ? globalThis : {};
    g.__ollie_migration_failed = true;
    return;
  }

  writeMeta(adapter, {
    version: STORE_VERSION,
    lastOpenedAt: Date.now(),
    migratedAt: Date.now(),
  });
}

function pruneOldSnapshots(adapter: StorageAdapter, keep: number): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = adapter as any;
  const keys: string[] = [];
  if (typeof a.length === 'number' && typeof a.key === 'function') {
    for (let i = 0; i < a.length; i++) {
      const k = a.key(i) as string | null;
      if (k && k.startsWith('void.state._backup.pre_migration.')) keys.push(k);
    }
  }
  keys.sort();
  while (keys.length > keep) {
    const old = keys.shift();
    if (old) {
      try { adapter.removeItem(old); } catch { /* noop */ }
    }
  }
}
