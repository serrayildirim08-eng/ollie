/**
 * money-v2 · clean-slate v2 design tokens
 *
 * The single source of truth for the v2 "warm notebook" visual language.
 * Copied verbatim from the approved mockups
 * (design/clean-slate-2026-05-18-v2/mockups/money*.html `:root`).
 *
 * These are exported as a plain object — NOT CSS variables — because the
 * v2 module is mounted behind a preview route inside the existing app,
 * and must not leak its palette into the live finance module's `:root`.
 * When body / home / work adopt v2 these tokens become the shared base.
 */

export const v2 = {
  paper: '#FAF6EF',
  ink: '#2A2622',
  mute: '#B6ADA0',
  line: '#EAE2D4',
  accent: '#C9923E',
  sage: '#5B8C7E',
  /**
   * warm umber — the severity ink for "turns soon / critical" states.
   * Added for grocery-v2 (the pantry critical shelf, the turns-soon
   * reframe). A warm earth tone, never red — colour never alarms in v2.
   */
  umber: '#A8703C',
  /** the soft glyph-tile fill behind a submodule icon */
  tile: '#F2EEDF',
  /** card / sheet white */
  card: '#FFFFFF',
  /** the phone-frame backdrop in the mockups (only used by the dev frame) */
  backdrop: '#D8D0C2',
  sans: "-apple-system,'Segoe UI',Roboto,sans-serif",
  mono: "ui-monospace,'SF Mono',Menlo,monospace",
  /** the warm body shadow used under cards */
  cardShadow: '0 16px 38px rgba(42,38,34,.07)',
  /** the amber button glow */
  amberShadow: '0 12px 28px rgba(201,146,62,.32)',
} as const;

export type V2Tokens = typeof v2;
