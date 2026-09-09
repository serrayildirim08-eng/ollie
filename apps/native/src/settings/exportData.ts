/**
 * exportData — "download my data" for Settings (report §F, trust layer).
 *
 * Reads every user table out of the local SQLite DB and serialises it to a
 * single JSON file the user can save. SQLCipher decrypts transparently for the
 * app, so the export is plaintext JSON — it's the user's own data, leaving on
 * their command. No cloud round-trip.
 *
 * There is no Tauri fs/dialog plugin in the build, so we hand the file to the
 * webview via a Blob download (standard web API, no new native dependency).
 * The save destination is the webview's download behaviour — verify on device.
 */

import { sql } from '../storage';

export interface ExportBundle {
  app: 'ollie';
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

/** Internal bookkeeping tables that aren't the user's data. */
const INTERNAL_TABLES = new Set(['_ollie_migrations']);

/** Wrap the collected tables in the export envelope + serialise. Pure — tested. */
export function serializeExport(
  tables: Record<string, unknown[]>,
  exportedAtISO: string,
): string {
  const bundle: ExportBundle = {
    app: 'ollie',
    schemaVersion: 1,
    exportedAt: exportedAtISO,
    tables,
  };
  return JSON.stringify(bundle, null, 2);
}

/** Read every user table's rows from SQLite. Table names come from
 *  sqlite_master (not user input); still quoted defensively. */
export async function collectTables(): Promise<Record<string, unknown[]>> {
  const names = await sql.select<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name`,
  );
  const out: Record<string, unknown[]> = {};
  for (const { name } of names) {
    if (INTERNAL_TABLES.has(name)) continue;
    out[name] = await sql.select<Record<string, unknown>>(`SELECT * FROM "${name}"`);
  }
  return out;
}

/** Collect + serialise the full local export. */
export async function buildExportJson(now: Date = new Date()): Promise<string> {
  const tables = await collectTables();
  return serializeExport(tables, now.toISOString());
}

/** Suggested filename, date-stamped: ollie-export-2026-07-02.json */
export function exportFilename(now: Date = new Date()): string {
  const d = now.toISOString().slice(0, 10);
  return `ollie-export-${d}.json`;
}

/** Hand a JSON string to the webview as a downloadable file. */
export function triggerDownload(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
