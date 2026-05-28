/**
 * ollie · design tokens · native v1
 *
 * source of truth for the new from-scratch Tauri+React app.
 * read these as the entire vocabulary — no hardcoded values anywhere else.
 *
 * DNA: luxury-editorial. ceramic / cream / sage / sky.
 * references: aesop, kinfolk, monocle. generous whitespace, no SaaS chips.
 * anchors: cream paper (#f5efe6), deep sage ink (#3a4a3a), soft sage (#8a9a8a).
 *
 * structure:
 *   - palette is split light vs dark; both modes share the same role names.
 *   - role-based naming: surface / ink / accent / hairline. role > hue.
 *   - everything else (type, space, radius, shadow, motion) is mode-agnostic.
 *
 * fonts (optional, no deps yet — system stack falls through):
 *   if/when self-hosting, candidates: "Fraunces" (editorial serif) +
 *   "Inter" (sans) + "JetBrains Mono". list here, install separately:
 *
 *   // deps to consider later (NOT installed):
 *   //   @fontsource-variable/fraunces
 *   //   @fontsource-variable/inter
 *   //   @fontsource-variable/jetbrains-mono
 */

// ─────────────────────────────────────────────────────────────────────
// PALETTE · role-based · light + dark
// ─────────────────────────────────────────────────────────────────────

export interface Palette {
  readonly cream: string;        // base page surface
  readonly paper: string;        // secondary surface · cards, callouts
  readonly paper2: string;       // tertiary surface · sticky headers, menu sections
  readonly ink: string;          // primary text
  readonly inkSoft: string;      // secondary text · captions, kicker
  readonly inkFaint: string;     // tertiary text · meta, hints
  readonly inkGhost: string;     // quaternary text · drop caps, watermarks
  readonly sageDeep: string;     // primary accent · headlines on cream, active state
  readonly sage: string;         // mid sage · body emphasis, kicker rules
  readonly sageSoft: string;     // soft sage · secondary text on cream
  readonly sky: string;          // single sky moment · provenance trace
  readonly rubric: string;       // severity ink · HITL stop-points only
  readonly amber: string;        // ledger flag · insist tier
  readonly hairline: string;     // primary divider
  readonly hairlineSoft: string; // secondary divider within sections
  readonly shadow: string;       // shadow base rgb triplet (for rgba use)
}

// Source of truth: apps/web/src/design/tokens.css on the redesign/money-v2
// branch. Values were ported on 2026-05-28 to align native + web visually.
export const lightPalette: Palette = {
  // surfaces · bone-anchored
  cream: '#FAFAF7',   // bone — page background everywhere
  paper: '#F4F1E8',   // pull-quote bleeds, callouts, inner cards
  paper2: '#EFEBE0',  // tertiary · menu sections, sticky headers

  // ink · near-black with editorial warmth (not pure #000)
  ink: '#14140F',
  inkSoft: '#5A574E',
  inkFaint: '#9C9890',
  inkGhost: '#C8C4BA',

  // sage spectrum · accent voice (single accent role per redesign tokens.css)
  sageDeep: '#2E5D43',
  sage: '#2E5D43',
  sageSoft: '#5A574E',

  // sky · body water glasses ONLY (do not extend per redesign tokens)
  sky: '#5B8FB5',

  // severity · HITL exception only · umber/amber/pink per redesign
  rubric: '#B86A8A',  // pink — tier-4 push (fire) / crisis label only
  amber: '#C9974C',   // amber — tier-3 push (insist) / ledger flags

  // hairlines
  hairline: 'rgba(20, 20, 15, 0.10)',
  hairlineSoft: 'rgba(20, 20, 15, 0.05)',

  // shadow base (rgb triplet usable in rgba)
  shadow: '20, 20, 15',
} as const;

export const darkPalette: Palette = {
  // surfaces · graphite-anchored, never pure black
  cream: '#1a1d1a',
  paper: '#222622',
  paper2: '#2a2e2a',

  // ink · cream side
  ink: '#f0eadf',
  inkSoft: '#c8c4ba',
  inkFaint: '#9c9890',
  inkGhost: '#5a574e',

  // sage spectrum · brightened for dark surfaces
  sageDeep: '#a8b8a4',
  sage: '#8a9a8a',
  sageSoft: '#6e7a6e',

  // sky
  sky: '#9ab2c6',

  // severity
  rubric: '#d9574a',
  amber: '#d9a85e',

  // hairlines
  hairline: 'rgba(240, 234, 223, 0.10)',
  hairlineSoft: 'rgba(240, 234, 223, 0.05)',

  // shadow base
  shadow: '0, 0, 0',
} as const;

// ergonomic alias · light is the default voice
export const colors = lightPalette;

// ─────────────────────────────────────────────────────────────────────
// TYPOGRAPHY · editorial scale · 17px body anchor
// hybrid 1.250 step / 1.618 hero jump · no SaaS sizes
// ─────────────────────────────────────────────────────────────────────

// Matches the redesign branch's font system: DM Serif Display + DM Sans + DM
// Mono, loaded via @fontsource/* in main.tsx with platform fallbacks for
// first-paint before the webfont resolves.
export const fonts = {
  serif:
    '"DM Serif Display", "Iowan Old Style", "Charter", "Georgia", "Times New Roman", serif',
  sans:
    '"DM Sans", -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Segoe UI", system-ui, sans-serif',
  mono:
    '"DM Mono", ui-monospace, "JetBrains Mono", "SFMono-Regular", "Menlo", "Consolas", monospace',
} as const;

export const fontSizes = {
  // editorial scale · names describe role, not pixel size.
  hero: '96px',     // one per surface · cover, manifesto break
  display: '64px',  // section openers
  h1: '42px',       // spread headline
  h2: '28px',       // sub-section
  h3: '22px',       // lede / standfirst
  body: '17px',     // running text · anchor
  small: '14px',    // small body, secondary
  caption: '13px',  // image caption, footnote
  kicker: '11px',   // eyebrow, page number · UPPERCASE smcp
  meta: '9px',      // mono small caps · figure numbers
} as const;

export const fontWeights = {
  // editorial uses few weights. don't add semibold without a fight.
  light: 300,
  regular: 400,
  medium: 500,
  bold: 700,
} as const;

export const lineHeights = {
  tight: 1.02,
  display: 1.05,
  headline: 1.10,
  h2: 1.20,
  lede: 1.40,
  body: 1.55,    // matches redesign branch · was 1.62 in v0 native foundation
  caption: 1.45,
} as const;

export const letterSpacings = {
  display: '-0.025em',  // big serif · tighten
  h1: '-0.018em',
  h2: '-0.012em',
  body: '0',
  caps: '0.10em',       // kicker / smcp · NOT 0.20em
  capsTight: '0.06em',
  capsLoose: '0.16em',
} as const;

// ─────────────────────────────────────────────────────────────────────
// SPACING · base 4px · ADHD-friendly · breathing room is the design
// ─────────────────────────────────────────────────────────────────────

// indexed by step (multiples of 4px). use `space[6]` not `space.md`.
export const space = {
  0: '0',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  7: '28px',
  8: '32px',
  10: '40px',
  12: '48px',
  14: '56px',
  16: '64px',
  20: '80px',
  24: '96px',
  30: '120px',
  40: '160px',
  50: '200px',
} as const;

// page-rhythm presets · hero/section padding shortcuts.
// padding goes top/bottom; horizontal handled by container layout.
export const padding = {
  pageHero: { x: space[16], y: space[14] },   // 64 / 56 · hero surfaces
  pageSpread: { x: space[12], y: space[20] }, // 48 / 80 · spreads
  pageLoose: { x: space[16], y: space[30] },  // 64 / 120 · cover moments
  card: space[7],                             // 28 · card interior
  cardLg: space[8],                           // 32 · large card interior
  inputY: space[3],                           // 12 · text input vertical
  inputX: space[4],                           // 16 · text input horizontal
} as const;

// ─────────────────────────────────────────────────────────────────────
// RADIUS · used sparingly · sharp edges are the brand
// ─────────────────────────────────────────────────────────────────────

export const radii = {
  none: '0',
  xs: '2px',
  sm: '4px',     // inputs, small chips
  md: '8px',
  lg: '12px',    // select dropdowns, sheets
  pill: '999px',
} as const;

// ─────────────────────────────────────────────────────────────────────
// SHADOWS · max one drop-shadow level on a surface
// rgb base is intentionally fixed; if you need dark-aware shadow,
// switch to `0 4px 16px rgba(var(--ollie-color-shadow), 0.08)` in CSS.
// ─────────────────────────────────────────────────────────────────────

export const shadows = {
  none: 'none',
  sm: '0 1px 0 rgba(20, 25, 20, 0.04)',
  md: '0 4px 16px rgba(20, 25, 20, 0.06)',
  lg: '0 12px 40px rgba(20, 25, 20, 0.08)',
} as const;

// ─────────────────────────────────────────────────────────────────────
// MOTION · subtle · no bounce, no spring, no scale > 1.04
// ─────────────────────────────────────────────────────────────────────

export const durations = {
  tap: '120ms',
  fade: '200ms',
  fadeUp: '280ms',
  flick: '220ms',
  slide: '400ms',
  drawer: '420ms',
  flight: '600ms',
  settle: '800ms',
  breathe: '6s',
  drift: '18s',
} as const;

export const easings = {
  calmOut: 'cubic-bezier(0.18, 0, 0.22, 1)',
  fadeUp: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  liftSet: 'cubic-bezier(0.42, 0, 0.18, 1)',
  breathe: 'cubic-bezier(0.45, 0, 0.55, 1)',
  step: 'linear',
} as const;

// ─────────────────────────────────────────────────────────────────────
// Z-INDEX · 5 levels · do not invent more
// ─────────────────────────────────────────────────────────────────────

export const zIndex = {
  bg: 0,
  content: 1,
  overlay: 10,
  mast: 100,    // persistent masthead
  modal: 200,   // command palette, sheets
} as const;

// ─────────────────────────────────────────────────────────────────────
// BREAKPOINTS · desktop-leaning · tauri is desktop-first
// ─────────────────────────────────────────────────────────────────────

export const breakpoints = {
  sm: '480px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  xxl: '1600px',
} as const;

// ─────────────────────────────────────────────────────────────────────
// MODE-AWARE TOKEN BUNDLE
// ─────────────────────────────────────────────────────────────────────

export type Mode = 'light' | 'dark';

export interface Tokens {
  readonly mode: Mode;
  readonly palette: Palette;
  readonly fonts: typeof fonts;
  readonly fontSizes: typeof fontSizes;
  readonly fontWeights: typeof fontWeights;
  readonly lineHeights: typeof lineHeights;
  readonly letterSpacings: typeof letterSpacings;
  readonly space: typeof space;
  readonly padding: typeof padding;
  readonly radii: typeof radii;
  readonly shadows: typeof shadows;
  readonly durations: typeof durations;
  readonly easings: typeof easings;
  readonly zIndex: typeof zIndex;
  readonly breakpoints: typeof breakpoints;
}

export function buildTokens(mode: Mode): Tokens {
  return {
    mode,
    palette: mode === 'dark' ? darkPalette : lightPalette,
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
  };
}

// ─────────────────────────────────────────────────────────────────────
// CSS VARIABLE GENERATION
// every token surfaces as --ollie-* for use in plain CSS files.
// keep names role-based · camelCase token → --ollie-kebab-case.
// ─────────────────────────────────────────────────────────────────────

const CSS_PREFIX = '--ollie';

const camelToKebab = (s: string): string =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const emit = (
  scope: string,
  key: string | number,
  value: string | number,
): [string, string] => {
  const k = typeof key === 'number' ? String(key) : camelToKebab(key);
  return [`${CSS_PREFIX}-${scope}-${k}`, String(value)];
};

/**
 * Build a flat record of CSS custom properties from a Tokens bundle.
 * The ThemeProvider applies these to <html> via style.setProperty.
 */
export function tokensToCssVars(t: Tokens): Record<string, string> {
  const out: Record<string, string> = {};

  const writeGroup = (
    scope: string,
    group: Record<string, string | number>,
  ): void => {
    for (const [k, v] of Object.entries(group)) {
      const [name, val] = emit(scope, k, v);
      out[name] = val;
    }
  };

  writeGroup('color', t.palette as unknown as Record<string, string>);
  writeGroup('font', t.fonts as unknown as Record<string, string>);
  writeGroup('text', t.fontSizes as unknown as Record<string, string>);
  writeGroup('weight', t.fontWeights as unknown as Record<string, number>);
  writeGroup('leading', t.lineHeights as unknown as Record<string, number>);
  writeGroup('tracking', t.letterSpacings as unknown as Record<string, string>);
  writeGroup('space', t.space as unknown as Record<string, string>);
  writeGroup('radius', t.radii as unknown as Record<string, string>);
  writeGroup('shadow', t.shadows as unknown as Record<string, string>);
  writeGroup('duration', t.durations as unknown as Record<string, string>);
  writeGroup('ease', t.easings as unknown as Record<string, string>);
  writeGroup('z', t.zIndex as unknown as Record<string, number>);
  writeGroup('bp', t.breakpoints as unknown as Record<string, string>);

  return out;
}
