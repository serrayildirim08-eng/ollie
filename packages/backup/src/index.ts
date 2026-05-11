/**
 * @ollie/backup · encrypted .json export / import (C4)
 *
 * File envelope (versioned, JSON-pretty so a curious user can confirm
 * the file isn't plaintext):
 *
 *   {
 *     "version": 1,
 *     "app": "ollie",
 *     "created_at": "2026-05-12T18:00:00.000Z",
 *     "salt": "<base64>",        // 16 bytes
 *     "iv":   "<base64>",        // 12 bytes
 *     "ciphertext": "<base64>",  // AES-GCM-256 of the JSON payload
 *     "metadata": {              // plaintext, non-sensitive only
 *       "module_count": 12,
 *       "exported_by": "ollie/<commit>",
 *       "device_id": "optional"
 *     }
 *   }
 *
 * The payload encrypted into `ciphertext` is the full store snapshot:
 *   { "<module>": { ...state }, ... }
 *
 * Wrong passphrase → AES auth-tag mismatch → graceful error.
 * Tampered file → same error.
 *
 * Pre-migration auto-snapshot: callers can persist a backup to
 * localStorage with key `void.backup.pre_migration` before applying
 * schema migrations. The snapshot itself is encrypted with the user's
 * current key (caller responsibility — we don't auto-discover the key).
 */

import {
  bytesToBase64,
  base64ToBytes,
  deriveKey,
  encryptData,
  decryptData,
  randomSalt,
  passphraseStrength,
} from '@ollie/crypto';
import type { Store } from '@ollie/store';

export const BACKUP_VERSION = 1;
export const BACKUP_FILE_EXTENSION = '.ollie.backup.json';

export interface BackupEnvelope {
  version: number;
  app: 'ollie';
  created_at: string;
  salt: string;
  iv: string;
  ciphertext: string;
  metadata: {
    module_count: number;
    exported_by?: string;
    device_id?: string;
  };
}

export interface BackupOptions {
  modules?: string[];
  exportedBy?: string;
  deviceId?: string;
  /** Override Date.now() — used by tests for deterministic timestamps. */
  now?: () => number;
}

export interface ImportResult {
  ok: true;
  applied_modules: string[];
  created_at: string;
}

export interface ImportError {
  ok: false;
  /** Stable code callers can branch on. */
  code: 'wrong-passphrase' | 'corrupt-envelope' | 'unsupported-version' | 'not-an-ollie-backup';
  message: string;
}

const DEFAULT_MODULES = [
  'cycle', 'finance', 'grocery', 'pets', 'sleep', 'body', 'habits', 'work',
  'goals', 'admin', 'astrology', 'dump', 'journal', 'burhan', 'shared',
];

// ──────────────────────────────────────────────────────────────────────────
// EXPORT
// ──────────────────────────────────────────────────────────────────────────

/**
 * Build an encrypted backup envelope of the current store state.
 * The returned object is JSON-stringifiable; callers attach it to a
 * Blob/URL and trigger a download. Throws if passphrase is too short.
 */
export async function exportBackup(
  store: Store,
  passphrase: string,
  opts: BackupOptions = {},
): Promise<BackupEnvelope> {
  const strength = passphraseStrength(passphrase);
  if (strength.notes.some((n) => n.startsWith('must be at least'))) {
    throw new Error('@ollie/backup: passphrase too short');
  }
  const modules = opts.modules ?? DEFAULT_MODULES;
  const nowFn = opts.now ?? (() => Date.now());

  const snapshot: Record<string, unknown> = {};
  let moduleCount = 0;
  for (const m of modules) {
    const slice = store.getModule(m);
    if (slice && Object.keys(slice).length > 0) {
      snapshot[m] = slice;
      moduleCount++;
    }
  }

  const salt = randomSalt();
  const key = await deriveKey(passphrase, salt);
  const enc = await encryptData(key, snapshot);

  return {
    version: BACKUP_VERSION,
    app: 'ollie',
    created_at: new Date(nowFn()).toISOString(),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(enc.iv),
    ciphertext: bytesToBase64(enc.ciphertext),
    metadata: {
      module_count: moduleCount,
      exported_by: opts.exportedBy,
      device_id: opts.deviceId,
    },
  };
}

/** Convenience: serialize the envelope as the bytes a user downloads. */
export function envelopeToFileBytes(env: BackupEnvelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(env, null, 2));
}

/**
 * Build a default filename: `ollie-backup-2026-05-12.ollie.backup.json`.
 */
export function defaultFilename(env: BackupEnvelope): string {
  const date = env.created_at.slice(0, 10);
  return `ollie-backup-${date}${BACKUP_FILE_EXTENSION}`;
}

// ──────────────────────────────────────────────────────────────────────────
// IMPORT
// ──────────────────────────────────────────────────────────────────────────

function isEnvelope(x: unknown): x is BackupEnvelope {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    o.app === 'ollie' &&
    typeof o.version === 'number' &&
    typeof o.salt === 'string' &&
    typeof o.iv === 'string' &&
    typeof o.ciphertext === 'string' &&
    typeof o.created_at === 'string'
  );
}

/**
 * Apply an encrypted backup envelope to the store. Either replaces or
 * merges depending on `mode`. Returns a discriminated result.
 */
export async function importBackup(
  store: Store,
  envelopeOrJson: BackupEnvelope | string | Uint8Array | ArrayBuffer,
  passphrase: string,
  opts: { mode?: 'replace' | 'merge' } = {},
): Promise<ImportResult | ImportError> {
  // Parse the envelope
  let envelope: BackupEnvelope;
  try {
    let text: string;
    if (typeof envelopeOrJson === 'string') text = envelopeOrJson;
    else if (envelopeOrJson instanceof Uint8Array) text = new TextDecoder().decode(envelopeOrJson);
    else if (envelopeOrJson instanceof ArrayBuffer) text = new TextDecoder().decode(envelopeOrJson);
    else { envelope = envelopeOrJson; text = ''; }

    if (text) envelope = JSON.parse(text) as BackupEnvelope;
    if (!isEnvelope(envelope!)) {
      return { ok: false, code: 'not-an-ollie-backup', message: 'file is not an ollie backup envelope' };
    }
  } catch {
    return { ok: false, code: 'corrupt-envelope', message: 'envelope is not valid JSON' };
  }

  if (envelope.version > BACKUP_VERSION) {
    return { ok: false, code: 'unsupported-version', message: `backup version ${envelope.version} is newer than this app supports (${BACKUP_VERSION})` };
  }

  let snapshot: Record<string, unknown>;
  try {
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const ciphertext = base64ToBytes(envelope.ciphertext);
    const key = await deriveKey(passphrase, salt);
    snapshot = await decryptData<Record<string, unknown>>(key, { iv, ciphertext });
  } catch {
    return { ok: false, code: 'wrong-passphrase', message: 'wrong passphrase, or backup file is corrupt' };
  }

  const applied: string[] = [];
  const mode = opts.mode ?? 'replace';
  for (const [module, raw] of Object.entries(snapshot)) {
    if (!raw || typeof raw !== 'object') continue;
    if (mode === 'replace') {
      store.setModule(module, raw as Record<string, unknown>);
    } else {
      const cur = store.getModule(module) ?? {};
      store.setModule(module, { ...cur, ...(raw as Record<string, unknown>) });
    }
    applied.push(module);
  }

  return { ok: true, applied_modules: applied, created_at: envelope.created_at };
}

/**
 * Auto-snapshot helper. Writes an encrypted backup to a known store
 * key — the caller passes the in-memory key (NOT the passphrase) so
 * we don't trigger PBKDF2 on the hot migration path.
 *
 * For pre-migration use only. Caller responsible for cleanup.
 */
export async function snapshotPreMigration(
  store: Store,
  key: CryptoKey,
  modules: string[] = DEFAULT_MODULES,
): Promise<{ iv: string; ciphertext: string; created_at: string }> {
  const snapshot: Record<string, unknown> = {};
  for (const m of modules) {
    const slice = store.getModule(m);
    if (slice) snapshot[m] = slice;
  }
  const enc = await encryptData(key, snapshot);
  const out = {
    iv: bytesToBase64(enc.iv),
    ciphertext: bytesToBase64(enc.ciphertext),
    created_at: new Date().toISOString(),
  };
  store.set('shared', '_backup_pre_migration', out);
  return out;
}
