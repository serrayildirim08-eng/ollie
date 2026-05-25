/**
 * ollie · theme · public surface
 *
 * import everything you need from here, not from individual files:
 *   import { ThemeProvider, useTheme, useTokens, colors, space } from '@/theme';
 */

// tokens · raw + builder
export {
  // palette
  lightPalette,
  darkPalette,
  colors,
  // scales
  fonts,
  fontSizes,
  fontWeights,
  lineHeights,
  letterSpacings,
  space,
  padding,
  radii,
  shadows,
  durations,
  easings,
  zIndex,
  breakpoints,
  // composition + css var emission
  buildTokens,
  tokensToCssVars,
} from './tokens';

export type { Palette, Tokens, Mode } from './tokens';

// mode hook
export { useMode, resolveMode } from './mode';
export type { ModePreference, UseModeResult } from './mode';

// provider + hooks
export { ThemeProvider, useTheme, useTokens } from './ThemeProvider';
export type { ThemeContextValue, ThemeProviderProps } from './ThemeProvider';
