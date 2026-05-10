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
  for (let v = currentVersion + 1; v <= STORE_VERSION; v++) {
    const migrate = migrations[v];
    if (!migrate) continue;
    try {
      migrate(adapter);
    } catch (err) {
      console.error(`[@ollie/store] migration ${v} failed`, err);
    }
  }
  writeMeta(adapter, {
    version: STORE_VERSION,
    lastOpenedAt: Date.now(),
    migratedAt: Date.now(),
  });
}
