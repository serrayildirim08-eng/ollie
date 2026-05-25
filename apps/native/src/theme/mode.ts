/**
 * ollie · theme mode · light / dark + system
 *
 * three-way preference model:
 *   - 'light'  : forced light
 *   - 'dark'   : forced dark
 *   - 'system' : follows prefers-color-scheme (default)
 *
 * the *resolved* mode (always 'light' or 'dark') is what the
 * ThemeProvider feeds tokens. preference is what the user picked.
 */

import { useEffect, useState, useCallback } from 'react';
import type { Mode } from './tokens';

export type ModePreference = Mode | 'system';

const STORAGE_KEY = 'ollie.theme.preference';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

// ─────────────────────────────────────────────────────────────────────
// storage · safe-guarded against ssr / locked storage
// ─────────────────────────────────────────────────────────────────────

const isBrowser = (): boolean =>
  typeof window !== 'undefined' && typeof document !== 'undefined';

const readPreference = (): ModePreference => {
  if (!isBrowser()) return 'system';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* storage may be blocked (private mode, tauri sandbox edge) */
  }
  return 'system';
};

const writePreference = (pref: ModePreference): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* swallow */
  }
};

// ─────────────────────────────────────────────────────────────────────
// system mode reader
// ─────────────────────────────────────────────────────────────────────

const readSystemMode = (): Mode => {
  if (!isBrowser() || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
};

// ─────────────────────────────────────────────────────────────────────
// resolver
// ─────────────────────────────────────────────────────────────────────

export const resolveMode = (
  preference: ModePreference,
  systemMode: Mode,
): Mode => (preference === 'system' ? systemMode : preference);

// ─────────────────────────────────────────────────────────────────────
// hook · single source of truth for the provider
// ─────────────────────────────────────────────────────────────────────

export interface UseModeResult {
  /** what the user picked: 'light' | 'dark' | 'system' */
  preference: ModePreference;
  /** the actual mode applied right now: 'light' | 'dark' */
  mode: Mode;
  /** set the user's preference (persists to localStorage) */
  setPreference: (next: ModePreference) => void;
  /** cycle preference: light → dark → system → light */
  cyclePreference: () => void;
  /** flip between light and dark explicitly (forces a non-system pick) */
  toggle: () => void;
}

export function useMode(): UseModeResult {
  const [preference, setPreferenceState] = useState<ModePreference>(() =>
    readPreference(),
  );
  const [systemMode, setSystemMode] = useState<Mode>(() => readSystemMode());

  // listen for system mode changes (only matters when preference === 'system')
  useEffect(() => {
    if (!isBrowser() || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(MEDIA_QUERY);
    const handler = (e: MediaQueryListEvent): void => {
      setSystemMode(e.matches ? 'dark' : 'light');
    };
    // modern API; older Safari needs addListener but Tauri webview is modern
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const setPreference = useCallback((next: ModePreference): void => {
    setPreferenceState(next);
    writePreference(next);
  }, []);

  const cyclePreference = useCallback((): void => {
    setPreferenceState((curr) => {
      const next: ModePreference =
        curr === 'light' ? 'dark' : curr === 'dark' ? 'system' : 'light';
      writePreference(next);
      return next;
    });
  }, []);

  const toggle = useCallback((): void => {
    setPreferenceState((curr) => {
      const resolved = resolveMode(curr, systemMode);
      const next: Mode = resolved === 'dark' ? 'light' : 'dark';
      writePreference(next);
      return next;
    });
  }, [systemMode]);

  const mode = resolveMode(preference, systemMode);

  return { preference, mode, setPreference, cyclePreference, toggle };
}
