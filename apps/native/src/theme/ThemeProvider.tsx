/**
 * ollie · ThemeProvider
 *
 * - resolves mode (light/dark) from useMode().
 * - builds the matching Tokens bundle.
 * - injects every token as a CSS custom property on <html>, prefixed --ollie-*.
 * - stamps <html data-theme="light|dark"> so plain CSS can branch on it.
 * - exposes tokens + mode controls to React via useTheme().
 *
 * usage:
 *   <ThemeProvider>
 *     <App />
 *   </ThemeProvider>
 *
 *   const { tokens, mode, setPreference } = useTheme();
 *   // or in CSS:  background: var(--ollie-color-cream);
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
  type ReactElement,
} from 'react';
import { buildTokens, tokensToCssVars, type Tokens, type Mode } from './tokens';
import { useMode, type ModePreference } from './mode';

// ─────────────────────────────────────────────────────────────────────
// context
// ─────────────────────────────────────────────────────────────────────

export interface ThemeContextValue {
  /** current resolved mode (light | dark) */
  mode: Mode;
  /** user's preference (light | dark | system) */
  preference: ModePreference;
  /** full token bundle for the active mode */
  tokens: Tokens;
  /** explicit setter for preference */
  setPreference: (pref: ModePreference) => void;
  /** cycle: light → dark → system → light */
  cyclePreference: () => void;
  /** toggle between light and dark, abandoning system */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────────
// provider
// ─────────────────────────────────────────────────────────────────────

export interface ThemeProviderProps {
  children: ReactNode;
  /** optionally pin to a mode (escape hatch · disables system following) */
  forceMode?: Mode;
}

export function ThemeProvider({
  children,
  forceMode,
}: ThemeProviderProps): ReactElement {
  const { mode, preference, setPreference, cyclePreference, toggle } = useMode();
  const effectiveMode: Mode = forceMode ?? mode;

  const tokens = useMemo<Tokens>(
    () => buildTokens(effectiveMode),
    [effectiveMode],
  );

  // inject CSS vars onto <html> · also stamp data-theme + color-scheme.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const vars = tokensToCssVars(tokens);

    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
    root.setAttribute('data-theme', effectiveMode);
    // hint native form controls + scrollbars
    root.style.colorScheme = effectiveMode;

    // no cleanup: tokens are global, next paint just overwrites.
  }, [tokens, effectiveMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode: effectiveMode,
      preference,
      tokens,
      setPreference,
      cyclePreference,
      toggle,
    }),
    [effectiveMode, preference, tokens, setPreference, cyclePreference, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ─────────────────────────────────────────────────────────────────────
// hook
// ─────────────────────────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error(
      'useTheme() must be used inside <ThemeProvider>. Wrap your app root.',
    );
  }
  return ctx;
}

/** ergonomic shortcut for token-heavy components */
export function useTokens(): Tokens {
  return useTheme().tokens;
}
