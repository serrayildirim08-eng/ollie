/**
 * Debug seed — apply staged store writes from a URL.
 *
 * Used during the 2026-05-25 feature-verification dogfood pass. The dogfood
 * workflow needs to populate `work.focus_log`, `sleep.records`, `cycle.cycles`,
 * etc. on Serra's iPhone without granting external write access to her
 * encrypted Supabase state. The flow is:
 *
 *   1. Serra enables once:   localStorage['ollie.debug.seed_enabled'] = '1'
 *   2. Claude generates URL: https://ollie/#seed=<base64-json>
 *      or deep link:         ollie://seed?payload=<base64-json>
 *   3. Serra opens URL on phone
 *   4. App boots, this module decodes + applies via @ollie/store
 *   5. Toast confirms; payload fingerprint persisted so reload doesn't re-apply
 *
 * Payload shape (one or more writes):
 *
 *   { "writes": [
 *       { "module": "work", "key": "focus_log", "mode": "append", "data": {...} }
 *     ],
 *     "note": "work session 1 — 252 min deep work"
 *   }
 *
 * modes:
 *   - append:  data is appended to existing array (or wrapped if single item)
 *   - replace: data replaces the existing value entirely
 *   - merge:   data is shallow-merged into existing object
 *
 * Gating: nothing applies unless `ollie.debug.seed_enabled` is '1'. This keeps
 * prod users safe even if a seed URL is shared by accident.
 */

import type { Store } from '@ollie/store';

export interface SeedWrite {
  module: string;
  key: string;
  mode: 'append' | 'replace' | 'merge';
  data: unknown;
}

export interface SeedPayload {
  writes: SeedWrite[];
  note?: string;
}

export interface ApplySeedResult {
  ok: boolean;
  applied: number;
  errors: string[];
}

const SEED_ENABLED_KEY = 'ollie.debug.seed_enabled';
const SEED_APPLIED_KEY = 'ollie.debug.seed_applied';

export function isSeedEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(SEED_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

function decodeBase64Url(b64: string): string {
  // Tolerate URL-safe base64 (-_ instead of +/) and missing padding.
  let normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  return atob(normalized);
}

/** Extract `seed=<payload>` from a hash fragment OR query string. */
export function parseSeedFromString(input: string): SeedPayload | null {
  if (!input) return null;
  const m = input.match(/[#?&]seed=([^&]+)/) ?? input.match(/^seed=([^&]+)/);
  if (!m) return null;
  try {
    const decoded = decodeBase64Url(decodeURIComponent(m[1]));
    const parsed = JSON.parse(decoded) as SeedPayload;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.writes)) return null;
    for (const w of parsed.writes) {
      if (!w || typeof w !== 'object') return null;
      if (typeof w.module !== 'string' || typeof w.key !== 'string') return null;
      if (w.mode !== 'append' && w.mode !== 'replace' && w.mode !== 'merge') return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Extract payload from a Capacitor deep link `ollie://seed?payload=<b64>`. */
export function parseSeedFromDeeplink(url: string): SeedPayload | null {
  if (!url.startsWith('ollie://')) return null;
  const rest = url.slice('ollie://'.length);
  const path = rest.split('?')[0];
  if (path !== 'seed') return null;
  const query = rest.includes('?') ? rest.slice(rest.indexOf('?') + 1) : '';
  const m = query.match(/(?:^|&)payload=([^&]+)/);
  if (!m) return null;
  try {
    const decoded = decodeBase64Url(decodeURIComponent(m[1]));
    const parsed = JSON.parse(decoded) as SeedPayload;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.writes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function applySeed(payload: SeedPayload, store: Store): ApplySeedResult {
  const errors: string[] = [];
  let applied = 0;
  for (const w of payload.writes) {
    try {
      if (w.mode === 'replace') {
        store.set(w.module, w.key, w.data);
      } else if (w.mode === 'append') {
        store.update(w.module, w.key, (current: unknown) => {
          const arr = Array.isArray(current) ? current : [];
          if (Array.isArray(w.data)) return [...arr, ...w.data];
          return [...arr, w.data];
        });
      } else {
        // merge
        store.update(w.module, w.key, (current: unknown) => {
          const base = (current && typeof current === 'object' && !Array.isArray(current))
            ? (current as Record<string, unknown>)
            : {};
          return { ...base, ...(w.data as Record<string, unknown>) };
        });
      }
      applied++;
    } catch (err) {
      errors.push(`${w.module}.${w.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { ok: errors.length === 0, applied, errors };
}

function fingerprint(payload: SeedPayload): string {
  const s = JSON.stringify(payload);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function wasAlreadyApplied(fp: string): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(SEED_APPLIED_KEY) ?? '';
    return raw.split(',').includes(fp);
  } catch {
    return false;
  }
}

function markApplied(fp: string): void {
  try {
    const raw = globalThis.localStorage?.getItem(SEED_APPLIED_KEY) ?? '';
    const next = raw ? `${raw},${fp}` : fp;
    globalThis.localStorage?.setItem(SEED_APPLIED_KEY, next);
  } catch {
    /* ignore */
  }
}

export interface ApplyFromStringOpts {
  store: Store;
  onSuccess?: (note: string | undefined, applied: number) => void;
  onError?: (errors: string[]) => void;
  onDeduped?: (note: string | undefined) => void;
  onDisabled?: () => void;
}

/** End-to-end: read string, gate, dedupe, apply, fire callback. */
export function applySeedFromString(input: string, opts: ApplyFromStringOpts): {
  found: boolean;
  applied: boolean;
} {
  const payload = parseSeedFromString(input) ?? parseSeedFromDeeplink(input);
  if (!payload) return { found: false, applied: false };

  if (!isSeedEnabled()) {
    opts.onDisabled?.();
    return { found: true, applied: false };
  }

  const fp = fingerprint(payload);
  if (wasAlreadyApplied(fp)) {
    opts.onDeduped?.(payload.note);
    return { found: true, applied: false };
  }

  const result = applySeed(payload, opts.store);
  if (result.ok) {
    markApplied(fp);
    opts.onSuccess?.(payload.note, result.applied);
  } else {
    opts.onError?.(result.errors);
  }
  return { found: true, applied: result.ok };
}

/** Custom window event the deep-link handler dispatches for the App-level listener. */
export const OLLIE_SEED_EVENT = 'ollie:seed';
